//! The launcher: a keyboard-first spotlight sheet (ags/widget/Launcher.tsx).
//!
//! One custom text field (no `freya-components::Input`): the surface is
//! keyboard-Exclusive while open, so main.rs routes every key into this
//! surface's [`KeyFeed`] context and we accumulate the query ourselves. The
//! field shows a block caret, a faux placeholder when empty, and a DIM ghost
//! autocomplete suffix. Below it: the empty-state curated tile row (the six
//! dock pins) or the ranked results list.
//!
//! Providers (recomputed per keystroke, all pure -- see the unit tests):
//! - `:` prefix -> typed gnoblin command rows ([`command_rows`]).
//! - `=`/math -> a calculator row backed by a tiny recursive-descent parser
//!   ([`calc`]), never `eval`, no new deps.
//! - otherwise -> best-match slot + Apps (fuzzy + frecency) + Actions + Web
//!   ([`results`]).
//!
//! Key editing is factored into [`classify_key`] (host key -> [`Stroke`]) and
//! [`Editor::apply`] (pure text/selection edits), so the whole edit path is
//! testable without a Freya runtime. Colors/sizes come from [`crate::theme`];
//! the reveal opacity multiplies in from [`OpenProgress`] like panels.rs.

use std::path::PathBuf;

use freya_core::prelude::*;
use torin::prelude::{Alignment, Area, Content, Size};

use kobel_services::{AppEntry, AppsSnapshot, Command, SessionVerb};
use kobel_wayland::Preedit;

use super::fuzzy::{Frecency, fuzzy};
use super::panels::{ImeFeed, KeyFeed, OpenProgress, use_open_scale};
use super::{
    AppIcon, ICON_CALCULATOR, ICON_GLOBE, ICON_LOCK, ICON_LOGOUT, ICON_MAGNIFIER,
    ICON_MOON, ICON_POWER, ICON_RESTART, ICON_TERMINAL, dock, icon,
};
use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::theme::{self, Rgb};

// ---------------------------------------------------------------------------
// Field geometry (ags/style/main.scss .field / .row / .tile)
// ---------------------------------------------------------------------------

/// Search text size (`.field` search text 14.5).
const FIELD_FONT: f32 = 14.5;
/// Row / section text size.
const ROW_FONT: f32 = 13.0;
/// Caret geometry: a thin LEAF line at the cursor (docs/prototype.html's
/// `.lsearch input` uses a native `caret-color` -- a real OS text-cursor line,
/// not a block -- so this matches that shape rather than a terminal-style
/// block cursor).
const CARET_W: f32 = 2.0;
const CARET_H: f32 = 18.0;
/// Result-row icon frame; docs/prototype.html `.crow .ri{width:28px;height:28px}`
/// with `.crow .ri img{width:24px;height:24px}` (2px inset) for the glyph.
const RI_FRAME: f32 = 28.0;
const RI_GLYPH: f32 = 24.0;
/// Empty-state tile geometry; docs/prototype.html `.tile{width:calc(var(--icon) + 20px)}`
/// -- at the reference `--icon` value (theme::Tokens::icon, 44px) that's 64px.
/// Icon chip 42 (`TILE_GLYPH + 12.0`), glyph 30.
const TILE_W: f32 = 64.0;
const TILE_GLYPH: f32 = 30.0;
/// Sheet outer padding (`impl Component for Launcher`'s `.padding(SHEET_PAD)`).
const SHEET_PAD: f32 = 8.0;
/// Field row vertical padding (`field_row`'s `.padding((FIELD_PAD_V, 12.0))`);
/// docs/prototype.html `.lsearch { padding: 3px 12px }`.
const FIELD_PAD_V: f32 = 3.0;
/// The query text row's OWN vertical padding, inside `FIELD_PAD_V` -- ports
/// docs/prototype.html `.lsearch input { padding: 8px 0 }`. Two padding layers
/// (this one plus `FIELD_PAD_V`) give the ~39px total field height the
/// prototype renders; using only `FIELD_PAD_V` (as an earlier port did)
/// squashed the field to ~28px, visibly disproportionate against its 584px
/// width.
const FIELD_TEXT_PAD_V: f32 = 8.0;

/// Faux placeholder shown when the query is empty.
const PLACEHOLDER: &str = "Search apps, actions...";

/// The field row's surface-local `(x, y, width, height)`, in the launcher's own
/// coordinate space -- exactly what `zwp_text_input_v3.set_cursor_rectangle`
/// wants ("surface local coordinates", the whole text-input surface, not the
/// screen). A whole-row bounding box rather than the precise glyph-level caret
/// position: this crate has no text-measurement API wired for that, and a
/// row-bounding rect is a legitimate, common approximation for candidate-window
/// placement (correct Y, reasonable X, never obstructs the field). The field's
/// position never changes while the launcher is open (fixed layout, no scroll
/// above it), so this is computed once and never needs to move mid-session.
pub(crate) fn ime_cursor_rect(launcher_w: f32) -> (i32, i32, i32, i32) {
    let pad = SHEET_PAD as i32;
    let w = (launcher_w - 2.0 * SHEET_PAD).round() as i32;
    let h = (2.0 * FIELD_PAD_V + 2.0 * FIELD_TEXT_PAD_V + CARET_H).round() as i32;
    (pad, pad, w, h)
}

// ---------------------------------------------------------------------------
// Keystroke classification (pure; testable without keyboard_types names)
// ---------------------------------------------------------------------------

/// A classified keystroke: exactly the keys the launcher acts on. Decoded from
/// a host key by [`classify_key`] so [`Editor`] never touches key enums.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Stroke {
    /// A typed character (no ctrl/alt/super chord; shift is fine).
    Text(String),
    /// Backspace; `word` = ctrl held (delete the trailing word/selection).
    Backspace { word: bool },
    /// Delete (forward); `word` = ctrl held (delete the leading word/selection).
    Delete { word: bool },
    /// Escape.
    Escape,
    /// Tab; `back` = shift held (cycle backwards / never accept ghost).
    Tab { back: bool },
    /// Selection up (ArrowUp or Ctrl+p) -- result-ROW selection, not the text
    /// cursor (a single-line field has no vertical text motion).
    Up,
    /// Selection down (ArrowDown or Ctrl+n) -- result-ROW selection.
    Down,
    /// Move the text cursor left. `shift` extends/starts a selection instead of
    /// collapsing it; `word` (ctrl) jumps by word instead of by character.
    Left { shift: bool, word: bool },
    /// Move the text cursor right. See [`Stroke::Left`].
    Right { shift: bool, word: bool },
    /// Jump the text cursor to the start of the query. `shift` extends selection.
    Home { shift: bool },
    /// Jump the text cursor to the end of the query. `shift` extends selection.
    End { shift: bool },
    /// Enter (run the selected row).
    Enter,
    /// Ctrl+C: copy the current selection to the system clipboard (no-op if
    /// nothing is selected). Doesn't mutate the query -- the component reads
    /// [`Editor::selected_text`] itself and performs the IO.
    Copy,
    /// Ctrl+X: cut the current selection (copy + delete). Same no-op rule as
    /// [`Stroke::Copy`]; [`Editor::apply`] performs the deletion.
    Cut,
    /// Ctrl+V: paste. The classifier can't fetch clipboard content itself (pure,
    /// no IO) -- the component fetches it and calls [`Editor::paste`] directly,
    /// short-circuiting `apply` for this one stroke; this variant only exists so
    /// `classify_key` can signal "a paste was requested" to that short-circuit.
    Paste,
    /// A key the launcher ignores.
    Ignore,
}

/// Classify a host key into a [`Stroke`]. Named keys win first (layout
/// independent); Ctrl+n/p/c/x/v match the physical code because the key value
/// under Ctrl is usually a control char or Unidentified; plain characters become
/// text unless a ctrl/alt/super chord is held.
pub(crate) fn classify_key(key: &Key, code: &Code, mods: Modifiers) -> Stroke {
    if let Key::Named(named) = key {
        match named {
            NamedKey::Escape => return Stroke::Escape,
            NamedKey::Tab => return Stroke::Tab { back: mods.shift() },
            NamedKey::Enter => return Stroke::Enter,
            NamedKey::Backspace => return Stroke::Backspace { word: mods.ctrl() },
            NamedKey::Delete => return Stroke::Delete { word: mods.ctrl() },
            NamedKey::ArrowUp => return Stroke::Up,
            NamedKey::ArrowDown => return Stroke::Down,
            NamedKey::ArrowLeft => {
                return Stroke::Left { shift: mods.shift(), word: mods.ctrl() };
            }
            NamedKey::ArrowRight => {
                return Stroke::Right { shift: mods.shift(), word: mods.ctrl() };
            }
            NamedKey::Home => return Stroke::Home { shift: mods.shift() },
            NamedKey::End => return Stroke::End { shift: mods.shift() },
            _ => {}
        }
    }
    if mods.ctrl() {
        match code {
            Code::KeyN => return Stroke::Down,
            Code::KeyP => return Stroke::Up,
            Code::KeyC => return Stroke::Copy,
            Code::KeyX => return Stroke::Cut,
            Code::KeyV => return Stroke::Paste,
            _ => {}
        }
    }
    if !mods.ctrl()
        && !mods.alt()
        && !mods.meta()
        && let Key::Character(s) = key
        && !s.is_empty()
    {
        return Stroke::Text(s.clone());
    }
    Stroke::Ignore
}

// ---------------------------------------------------------------------------
// Pure editor (query text + selection index)
// ---------------------------------------------------------------------------

/// The editable launcher state: query text, the selected flat-row index, and
/// a real text cursor (`cursor`, a byte offset always on a char boundary) plus
/// an optional selection anchor (`anchor` -- `None` is a plain blinking-caret
/// cursor, `Some` is a range selection between `anchor` and `cursor`). Kept
/// free of Freya types so the whole edit path is unit-testable.
///
/// Click-to-position ([`Editor::click_at`]) and drag-to-select
/// ([`Editor::drag_to`]) are wired via a hidden hit-test paragraph in
/// [`field_row`] (see its module doc), alongside the keyboard path (arrows,
/// Home/End, word-jump, shift-select) that flows through [`Editor::apply`].
/// Both pointer paths bypass [`Stroke`]/[`Editor::apply`] entirely -- a
/// pointer event is not a keystroke.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Editor {
    pub query: String,
    pub selected: usize,
    pub cursor: usize,
    pub anchor: Option<usize>,
}

/// What the component must do after a stroke is applied to the [`Editor`].
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Outcome {
    /// Query/selection possibly changed -- just re-render.
    Redraw,
    /// Close the launcher (Escape on an empty query).
    Close,
    /// Run the row at `Editor::selected`.
    Run,
}

impl Editor {
    /// Apply one keystroke. `ghost` is the current ghost completion (a full row
    /// name) and `rows` the flattened row count for selection wrapping.
    pub(crate) fn apply(&mut self, stroke: &Stroke, ghost: Option<&str>, rows: usize) -> Outcome {
        match stroke {
            Stroke::Text(s) => {
                self.insert(s);
                self.selected = 0;
                Outcome::Redraw
            }
            Stroke::Backspace { word } => {
                if self.selection_range().is_some() {
                    self.delete_selection();
                } else if *word {
                    let start = prev_word_boundary(&self.query, self.cursor);
                    self.query.replace_range(start..self.cursor, "");
                    self.cursor = start;
                } else if let Some(prev) = prev_char_boundary(&self.query, self.cursor) {
                    self.query.replace_range(prev..self.cursor, "");
                    self.cursor = prev;
                }
                self.anchor = None;
                self.selected = 0;
                Outcome::Redraw
            }
            Stroke::Delete { word } => {
                if self.selection_range().is_some() {
                    self.delete_selection();
                } else if *word {
                    let end = next_word_boundary(&self.query, self.cursor);
                    self.query.replace_range(self.cursor..end, "");
                } else if let Some(next) = next_char_boundary(&self.query, self.cursor) {
                    self.query.replace_range(self.cursor..next, "");
                }
                self.anchor = None;
                self.selected = 0;
                Outcome::Redraw
            }
            Stroke::Left { shift, word } => {
                let target = if *word {
                    prev_word_boundary(&self.query, self.cursor)
                } else {
                    prev_char_boundary(&self.query, self.cursor).unwrap_or(0)
                };
                self.move_cursor(target, *shift);
                Outcome::Redraw
            }
            Stroke::Right { shift, word } => {
                let target = if *word {
                    next_word_boundary(&self.query, self.cursor)
                } else {
                    next_char_boundary(&self.query, self.cursor).unwrap_or(self.query.len())
                };
                self.move_cursor(target, *shift);
                Outcome::Redraw
            }
            Stroke::Home { shift } => {
                self.move_cursor(0, *shift);
                Outcome::Redraw
            }
            Stroke::End { shift } => {
                let end = self.query.len();
                self.move_cursor(end, *shift);
                Outcome::Redraw
            }
            Stroke::Escape => {
                if self.query.is_empty() {
                    Outcome::Close
                } else {
                    self.query.clear();
                    self.cursor = 0;
                    self.anchor = None;
                    self.selected = 0;
                    Outcome::Redraw
                }
            }
            Stroke::Tab { back } => {
                if !*back
                    && let Some(g) = ghost
                {
                    self.query = g.to_string();
                    self.cursor = self.query.len();
                    self.anchor = None;
                    self.selected = 0;
                    return Outcome::Redraw;
                }
                self.cycle(if *back { -1 } else { 1 }, rows);
                Outcome::Redraw
            }
            Stroke::Down => {
                self.cycle(1, rows);
                Outcome::Redraw
            }
            Stroke::Up => {
                self.cycle(-1, rows);
                Outcome::Redraw
            }
            Stroke::Enter => Outcome::Run,
            Stroke::Copy => Outcome::Redraw,
            Stroke::Cut => {
                self.delete_selection();
                self.selected = 0;
                Outcome::Redraw
            }
            // Paste never reaches apply(): the component fetches clipboard text
            // (IO) and calls Editor::paste directly, short-circuiting before
            // classify_key's stroke would otherwise get here. Treat it as inert
            // rather than panicking if that invariant is ever violated.
            Stroke::Paste => Outcome::Redraw,
            Stroke::Ignore => Outcome::Redraw,
        }
    }

    /// Wrap the selection by `dir` over `rows` entries.
    fn cycle(&mut self, dir: i64, rows: usize) {
        if rows == 0 {
            self.selected = 0;
            return;
        }
        let n = rows as i64;
        self.selected = (((self.selected as i64 + dir) % n + n) % n) as usize;
    }

    /// Move the cursor to `target`. `extend` (shift held) starts or grows a
    /// selection from the pre-move cursor position instead of collapsing one.
    fn move_cursor(&mut self, target: usize, extend: bool) {
        if extend {
            if self.anchor.is_none() {
                self.anchor = Some(self.cursor);
            }
        } else {
            self.anchor = None;
        }
        self.cursor = target;
    }

    /// The active selection as an order-normalized `(start, end)` byte range,
    /// or `None` when there is no selection (anchor absent, or collapsed to a
    /// zero-width range at the cursor).
    pub(crate) fn selection_range(&self) -> Option<(usize, usize)> {
        self.anchor.and_then(|a| {
            let (start, end) = (a.min(self.cursor), a.max(self.cursor));
            (start != end).then_some((start, end))
        })
    }

    /// Delete the active selection (no-op if there is none) and collapse the
    /// cursor to its start.
    fn delete_selection(&mut self) {
        if let Some((start, end)) = self.selection_range() {
            self.query.replace_range(start..end, "");
            self.cursor = start;
            self.anchor = None;
        }
    }

    /// Replace the active selection (if any) with `s`, else insert `s` at the
    /// cursor; the cursor lands just after the inserted text either way.
    fn insert(&mut self, s: &str) {
        if self.selection_range().is_some() {
            self.delete_selection();
        }
        self.query.insert_str(self.cursor, s);
        self.cursor += s.len();
    }

    /// Apply one IME `done` payload's delete + commit parts (the protocol's
    /// mandated apply order: delete around the cursor first, then insert the
    /// commit string at the resulting cursor). The live preedit text is NOT
    /// spliced into `query` -- it is rendering-only state the component tracks
    /// separately (see [`Preedit`]/`ImeFeed`) -- so `delete_before`/`delete_after`
    /// count from the real cursor, exactly as they would with no preedit active.
    /// Any active selection is dropped first ONLY when there is surrounding text
    /// to delete (the protocol defines `delete_before`/`delete_after` relative to
    /// the plain cursor, "excluding the selection"); a bare `commit_string` with
    /// no delete instead replaces the active selection itself, via [`Editor::insert`]
    /// (matching ordinary typed-character behaviour) -- clearing the anchor here
    /// unconditionally would have made `insert` see no selection to replace.
    pub(crate) fn apply_ime_commit(&mut self, delete_before: u32, delete_after: u32, commit: Option<&str>) {
        if delete_before > 0 || delete_after > 0 {
            self.anchor = None;
            let start = clamp_boundary_back(&self.query, self.cursor.saturating_sub(delete_before as usize));
            let end = clamp_boundary_fwd(&self.query, (self.cursor + delete_after as usize).min(self.query.len()));
            self.query.replace_range(start..end, "");
            self.cursor = start;
        }
        if let Some(text) = commit {
            self.insert(text);
        }
        self.selected = 0;
    }

    /// The currently selected text, if any (a collapsed selection doesn't count --
    /// matches [`Editor::selection_range`]). Read by the component for Ctrl+C
    /// (copy) and Ctrl+X (cut, which reads this BEFORE `apply` deletes it).
    pub(crate) fn selected_text(&self) -> Option<&str> {
        self.selection_range().map(|(start, end)| &self.query[start..end])
    }

    /// Paste: replace the active selection (if any) with `text`, else insert it at
    /// the cursor. Thin, documented alias over [`Editor::insert`] for the Ctrl+V
    /// call site -- the component fetches `text` from the system clipboard (IO)
    /// before calling this, since `Editor` never performs IO itself.
    pub(crate) fn paste(&mut self, text: &str) {
        self.insert(text);
        self.selected = 0;
    }

    /// Place the cursor at `byte_offset` (clamped to the query length and
    /// snapped to the nearest char boundary), clearing any selection --
    /// ordinary single-click text-field convention. Bypasses [`Stroke`]/
    /// [`Editor::apply`] like [`Editor::paste`]: a pointer click isn't a
    /// keystroke. `byte_offset` comes from hit-testing the rendered field
    /// (see [`field_row`]'s hidden measurement paragraph); it should already
    /// land on a char boundary, but `clamp_boundary_back` is cheap insurance
    /// against a UTF-16-to-byte conversion landing mid-codepoint.
    pub(crate) fn click_at(&mut self, byte_offset: usize) {
        let target = clamp_boundary_back(&self.query, byte_offset);
        self.move_cursor(target, false);
    }

    /// Extend the selection to `byte_offset` while dragging. Starts a fresh
    /// selection from the current cursor position (set by the preceding
    /// [`Editor::click_at`] on pointer-down) the first time this is called,
    /// exactly like [`Stroke::Left`]/[`Stroke::Right`] with `shift` held --
    /// [`Editor::move_cursor`]'s `extend` flag already implements that anchor-
    /// pinning, so dragging is just repeated cursor moves with `extend: true`.
    /// Bypasses [`Stroke`]/[`Editor::apply`] like [`Editor::click_at`]: a drag
    /// isn't a keystroke.
    pub(crate) fn drag_to(&mut self, byte_offset: usize) {
        let target = clamp_boundary_back(&self.query, byte_offset);
        self.move_cursor(target, true);
    }
}

/// Clamp `pos` (a byte offset that may land mid-codepoint -- e.g. a possibly-
/// misaligned `delete_surrounding_text` byte count) to the nearest valid char
/// boundary AT or BEFORE `pos`. Defensive: the protocol requires boundary-aligned
/// indices, but a compositor bug should degrade gracefully, never panic.
fn clamp_boundary_back(s: &str, pos: usize) -> usize {
    let mut i = pos.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Clamp `pos` to the nearest valid char boundary AT or AFTER `pos`.
fn clamp_boundary_fwd(s: &str, pos: usize) -> usize {
    let mut i = pos.min(s.len());
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Convert a Skia paragraph hit-test's UTF-16 code-unit offset into a byte
/// offset into `s`. Skia's `Paragraph::get_glyph_position_at_coordinate`
/// reports positions in UTF-16 code units (confirmed empirically against the
/// pinned Freya rev: a BMP char costs 1 unit, an astral char -- e.g. an emoji
/// -- costs 2, matching `str::encode_utf16`), but [`Editor::cursor`] is a Rust
/// byte offset. Walks `char_indices` so the result always lands on a char
/// boundary; `utf16_offset` past the string's end clamps to `s.len()`.
fn utf16_offset_to_byte(s: &str, utf16_offset: usize) -> usize {
    let mut units = 0usize;
    for (byte_idx, ch) in s.char_indices() {
        if units >= utf16_offset {
            return byte_idx;
        }
        units += ch.len_utf16();
    }
    s.len()
}

/// The previous char boundary strictly before `pos`, or `None` at the string
/// start. `pos` must already be on a char boundary (Editor invariant).
fn prev_char_boundary(s: &str, pos: usize) -> Option<usize> {
    if pos == 0 {
        return None;
    }
    let mut i = pos - 1;
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    Some(i)
}

/// The next char boundary strictly after `pos`, or `None` at the string end.
fn next_char_boundary(s: &str, pos: usize) -> Option<usize> {
    if pos >= s.len() {
        return None;
    }
    let mut i = pos + 1;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    Some(i)
}

/// The Ctrl+Left/Ctrl+Backspace word-jump target before `pos`: skip trailing
/// whitespace, then skip the trailing run of non-whitespace chars. Pure
/// boundary query (replaces the old mutating `clear_last_word`, which is now
/// just `query.replace_range(prev_word_boundary(&query, cursor)..cursor, "")`).
fn prev_word_boundary(s: &str, pos: usize) -> usize {
    let chars: Vec<(usize, char)> = s[..pos].char_indices().collect();
    let mut i = chars.len();
    while i > 0 && chars[i - 1].1.is_whitespace() {
        i -= 1;
    }
    while i > 0 && !chars[i - 1].1.is_whitespace() {
        i -= 1;
    }
    if i == 0 { 0 } else { chars[i].0 }
}

/// The Ctrl+Right/Ctrl+Delete word-jump target after `pos`: skip leading
/// whitespace, then skip the leading run of non-whitespace chars.
fn next_word_boundary(s: &str, pos: usize) -> usize {
    let chars: Vec<(usize, char)> = s[pos..].char_indices().collect();
    let mut i = 0;
    while i < chars.len() && chars[i].1.is_whitespace() {
        i += 1;
    }
    while i < chars.len() && !chars[i].1.is_whitespace() {
        i += 1;
    }
    if i >= chars.len() { s.len() } else { pos + chars[i].0 }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// A row's icon: an app entry's resolved icon (rendered via [`AppIcon`]) or a
/// tinted symbolic glyph.
#[derive(Debug, Clone)]
enum RowIcon {
    App(Option<PathBuf>),
    Symbol(&'static [u8]),
}

/// What Enter/click does with a row.
#[derive(Debug, Clone)]
enum RowAction {
    /// Launch a desktop app by id (bump frecency by the row name, then close).
    Launch { id: String },
    /// Fire a service command, then close.
    Command(Command),
    /// Open another surface (the session confirm flow lives there); no CloseAll.
    OpenSurface(SurfaceKey),
    /// A hint row that does nothing (unknown `:` command).
    Inert,
}

/// One result row.
#[derive(Debug, Clone)]
struct Row {
    icon: RowIcon,
    name: String,
    /// Matched CHAR indices in `name`, painted LEAF (from [`fuzzy`]).
    marks: Vec<usize>,
    hint: String,
    score: f32,
    action: RowAction,
}

/// A labelled group of rows.
#[derive(Debug, Clone)]
struct Section {
    title: &'static str,
    rows: Vec<Row>,
}

/// Type weight: actions rank just under apps (ags critique A1).
const ACTION_WEIGHT: f32 = 0.95;
/// Penalty for an alias (non-name) match, so name matches win.
const ALIAS_PENALTY: f32 = 0.5;

/// Build the ranked provider sections for `query`. Pure over its inputs.
fn results(query: &str, apps: &AppsSnapshot, frecency: &Frecency) -> Vec<Section> {
    let qt = query.trim();
    if qt.is_empty() {
        return Vec::new();
    }

    // ':' -> typed gnoblin command rows only.
    if let Some(rest) = qt.strip_prefix(':') {
        return vec![Section { title: "commands", rows: command_rows(rest.trim()) }];
    }

    let mut out: Vec<Section> = Vec::new();

    // '=' prefix or math-looking -> a calculator row.
    if let Some(row) = calculator_row(qt) {
        out.push(Section { title: "calculator", rows: vec![row] });
    }

    // Apps: fuzzy over name (with keyword fallback), score + frecency boost.
    let mut app_rows: Vec<Row> = apps
        .apps
        .iter()
        .filter_map(|a| {
            app_match(qt, a).map(|(score, marks)| Row {
                icon: RowIcon::App(a.icon.clone()),
                name: a.name.clone(),
                marks,
                hint: "Application".to_string(),
                score: score + frecency.boost(&a.name),
                action: RowAction::Launch { id: a.id.clone() },
            })
        })
        .collect();
    app_rows.sort_by(|a, b| b.score.total_cmp(&a.score));
    app_rows.truncate(6);

    // Actions: fixed verbs, matched by name then alias.
    let mut act_rows: Vec<Row> = action_defs()
        .into_iter()
        .filter_map(|def| {
            let (score, marks) = match fuzzy(qt, def.name) {
                Some(m) => (m.score, m.marks),
                None => {
                    let alias = def
                        .aliases
                        .iter()
                        .filter_map(|a| fuzzy(qt, a).map(|m| m.score))
                        .fold(f32::NEG_INFINITY, f32::max);
                    if alias.is_finite() {
                        (alias - ALIAS_PENALTY, Vec::new())
                    } else {
                        return None;
                    }
                }
            };
            Some(Row {
                icon: RowIcon::Symbol(def.icon),
                name: def.name.to_string(),
                marks,
                hint: def.hint.to_string(),
                score: score * ACTION_WEIGHT,
                action: def.action,
            })
        })
        .collect();
    act_rows.sort_by(|a, b| b.score.total_cmp(&a.score));

    // Global best-match slot across apps + actions (ags critique A1).
    let best_from_apps = match (app_rows.first(), act_rows.first()) {
        (Some(a), Some(b)) => a.score >= b.score,
        (Some(_), None) => true,
        _ => false,
    };
    if !app_rows.is_empty() || !act_rows.is_empty() {
        let best = if best_from_apps { app_rows.remove(0) } else { act_rows.remove(0) };
        out.push(Section { title: "best match", rows: vec![best] });
    }
    if !app_rows.is_empty() {
        out.push(Section { title: "apps", rows: app_rows });
    }
    act_rows.truncate(3);
    if !act_rows.is_empty() {
        out.push(Section { title: "actions", rows: act_rows });
    }

    // Web: always the last real row.
    out.push(Section { title: "web", rows: vec![web_row(qt)] });
    out
}

/// Fuzzy-match an app by name, falling back to its keywords (no name marks).
fn app_match(qt: &str, a: &AppEntry) -> Option<(f32, Vec<usize>)> {
    if let Some(m) = fuzzy(qt, &a.name) {
        return Some((m.score, m.marks));
    }
    let best = a
        .keywords
        .iter()
        .filter_map(|kw| fuzzy(qt, kw).map(|m| m.score))
        .fold(f32::NEG_INFINITY, f32::max);
    best.is_finite().then(|| (best - ALIAS_PENALTY, Vec::new()))
}

/// A fixed launcher action.
struct ActionDef {
    name: &'static str,
    icon: &'static [u8],
    hint: &'static str,
    aliases: &'static [&'static str],
    action: RowAction,
}

/// The action rows (ags/widget/Launcher.tsx ACTIONS). Lock/Suspend fire the
/// verb directly; the destructive verbs open the session surface so its
/// press-again confirm flow guards them.
fn action_defs() -> Vec<ActionDef> {
    vec![
        ActionDef {
            name: "Suspend",
            icon: ICON_MOON,
            hint: "Sleep -- resume instantly",
            aliases: &["sleep"],
            action: RowAction::Command(Command::Session(SessionVerb::Suspend)),
        },
        ActionDef {
            name: "Lock",
            icon: ICON_LOCK,
            hint: "Lock the session",
            aliases: &["lock screen"],
            action: RowAction::Command(Command::Session(SessionVerb::Lock)),
        },
        ActionDef {
            name: "Log Out",
            icon: ICON_LOGOUT,
            hint: "End this session",
            aliases: &["exit", "sign out", "logout"],
            action: RowAction::OpenSurface(SurfaceKey::Session),
        },
        ActionDef {
            name: "Restart",
            icon: ICON_RESTART,
            hint: "Reboot the machine",
            aliases: &["reboot"],
            action: RowAction::OpenSurface(SurfaceKey::Session),
        },
        ActionDef {
            name: "Shut Down",
            icon: ICON_POWER,
            hint: "Power off",
            aliases: &["poweroff", "halt"],
            action: RowAction::OpenSurface(SurfaceKey::Session),
        },
    ]
}

/// The always-last web-search row.
fn web_row(qt: &str) -> Row {
    Row {
        icon: RowIcon::Symbol(ICON_GLOBE),
        name: format!("Search the web for \u{201c}{qt}\u{201d}"),
        marks: Vec::new(),
        hint: String::new(),
        score: 0.0,
        action: RowAction::Command(Command::OpenUri(format!(
            "https://duckduckgo.com/?q={}",
            url_encode(qt)
        ))),
    }
}

/// Percent-encode a query string for a URL (RFC 3986 unreserved set kept).
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// ':' command provider
// ---------------------------------------------------------------------------

/// A typed `:` command template: a verb, its display usage, a hint, and a
/// resolver that maps the argument tail to a concrete [`Command`] (or `None`
/// when the args are missing/invalid, making the row an inert usage hint).
struct CmdSpec {
    verb: &'static str,
    usage: &'static str,
    hint: &'static str,
    resolve: fn(&str) -> Option<Command>,
}

/// The typed command set (docs/FREYA-PLAN.md 6). Never raw argv -- each maps to
/// a stable [`Command`] variant.
const CMD_SPECS: &[CmdSpec] = &[
    CmdSpec {
        verb: "reload",
        usage: "reload",
        hint: "Soft-reload the shell -- windows survive",
        resolve: |_| Some(Command::Reload),
    },
    CmdSpec {
        verb: "scripts",
        usage: "scripts",
        hint: "Reload user scripts",
        resolve: |_| Some(Command::ReloadScripts),
    },
    CmdSpec {
        verb: "ext",
        usage: "ext <uuid>",
        hint: "Reload one extension by uuid",
        resolve: |arg| {
            let uuid = arg.trim();
            (!uuid.is_empty()).then(|| Command::ReloadExtension(uuid.to_string()))
        },
    },
    CmdSpec {
        verb: "osd",
        usage: "osd on|off",
        hint: "Toggle kobel's volume/brightness OSD",
        resolve: |arg| parse_on_off(arg).map(|on| Command::SetFeature { name: "osd".into(), on }),
    },
    CmdSpec {
        verb: "notifs",
        usage: "notifs on|off",
        hint: "Release/own org.freedesktop.Notifications",
        resolve: |arg| {
            parse_on_off(arg).map(|on| Command::SetFeature { name: "notifications".into(), on })
        },
    },
];

/// Parse an `on`/`off` toggle argument.
fn parse_on_off(arg: &str) -> Option<bool> {
    match arg.trim() {
        "on" => Some(true),
        "off" => Some(false),
        _ => None,
    }
}

/// Build the `:` command rows for the text after the colon. Templates whose
/// verb starts with the typed verb are shown; each is runnable only when its
/// resolver accepts the args, else it is an inert usage hint. An unknown verb
/// yields a single inert "unknown command" row.
fn command_rows(rest: &str) -> Vec<Row> {
    let verb = rest.split_whitespace().next().unwrap_or("");
    let args: String = rest.split_whitespace().skip(1).collect::<Vec<_>>().join(" ");

    let rows: Vec<Row> = CMD_SPECS
        .iter()
        .filter(|s| s.verb.starts_with(verb))
        .map(|s| {
            let action = match (s.resolve)(&args) {
                Some(cmd) => RowAction::Command(cmd),
                None => RowAction::Inert,
            };
            Row {
                icon: RowIcon::Symbol(ICON_TERMINAL),
                name: format!(":{}", s.verb),
                marks: Vec::new(),
                hint: format!("{} -- {}", s.usage, s.hint),
                score: 99.0,
                action,
            }
        })
        .collect();

    if rows.is_empty() {
        vec![Row {
            icon: RowIcon::Symbol(ICON_TERMINAL),
            name: format!(":{rest}"),
            marks: Vec::new(),
            hint: "Unknown command".to_string(),
            score: 0.0,
            action: RowAction::Inert,
        }]
    } else {
        rows
    }
}

// ---------------------------------------------------------------------------
// '=' calculator (tiny recursive-descent parser -- NO eval, NO deps)
// ---------------------------------------------------------------------------

/// Build the calculator row, if the query is `=`-prefixed or math-looking and
/// evaluates to a finite number.
fn calculator_row(qt: &str) -> Option<Row> {
    let expr = qt.strip_prefix('=').unwrap_or(qt).trim();
    if !qt.starts_with('=') && !looks_like_math(qt) {
        return None;
    }
    let value = calc(expr)?;
    if !value.is_finite() {
        return None;
    }
    let text = format_number(value);
    Some(Row {
        icon: RowIcon::Symbol(ICON_CALCULATOR),
        name: text.clone(),
        marks: Vec::new(),
        hint: format!("{expr} ="),
        score: 98.0,
        action: RowAction::Command(Command::CopyText(text)),
    })
}

/// True when the query is only calculator characters and has both a digit and
/// an operator (ags charset guard).
fn looks_like_math(s: &str) -> bool {
    let s = s.strip_prefix('=').unwrap_or(s);
    let mut has_digit = false;
    let mut has_op = false;
    for c in s.chars() {
        match c {
            '0'..='9' => has_digit = true,
            '+' | '-' | '*' | '/' => has_op = true,
            '(' | ')' | '.' | ' ' | '\t' => {}
            _ => return false,
        }
    }
    has_digit && has_op
}

/// Format an f64 result: integers without a trailing `.0`, else the shortest
/// round-tripping decimal.
fn format_number(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

/// A calculator token.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Tok {
    Num(f64),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

/// Tokenize an arithmetic expression, rejecting any unexpected character.
fn tokenize(s: &str) -> Option<Vec<Tok>> {
    let chars: Vec<char> = s.chars().collect();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            ' ' | '\t' => i += 1,
            '+' => {
                toks.push(Tok::Plus);
                i += 1;
            }
            '-' => {
                toks.push(Tok::Minus);
                i += 1;
            }
            '*' => {
                toks.push(Tok::Star);
                i += 1;
            }
            '/' => {
                toks.push(Tok::Slash);
                i += 1;
            }
            '(' => {
                toks.push(Tok::LParen);
                i += 1;
            }
            ')' => {
                toks.push(Tok::RParen);
                i += 1;
            }
            '0'..='9' | '.' => {
                let start = i;
                let mut seen_dot = false;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    if chars[i] == '.' {
                        if seen_dot {
                            return None;
                        }
                        seen_dot = true;
                    }
                    i += 1;
                }
                let text: String = chars[start..i].iter().collect();
                toks.push(Tok::Num(text.parse().ok()?));
            }
            _ => return None,
        }
    }
    Some(toks)
}

/// A recursive-descent parser over pre-tokenized input.
struct Parser<'a> {
    toks: &'a [Tok],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<Tok> {
        self.toks.get(self.pos).copied()
    }

    fn expr(&mut self) -> Option<f64> {
        let mut acc = self.term()?;
        while let Some(op) = self.peek() {
            match op {
                Tok::Plus => {
                    self.pos += 1;
                    acc += self.term()?;
                }
                Tok::Minus => {
                    self.pos += 1;
                    acc -= self.term()?;
                }
                _ => break,
            }
        }
        Some(acc)
    }

    fn term(&mut self) -> Option<f64> {
        let mut acc = self.factor()?;
        while let Some(op) = self.peek() {
            match op {
                Tok::Star => {
                    self.pos += 1;
                    acc *= self.factor()?;
                }
                Tok::Slash => {
                    self.pos += 1;
                    acc /= self.factor()?;
                }
                _ => break,
            }
        }
        Some(acc)
    }

    fn factor(&mut self) -> Option<f64> {
        match self.peek()? {
            Tok::Plus => {
                self.pos += 1;
                self.factor()
            }
            Tok::Minus => {
                self.pos += 1;
                Some(-self.factor()?)
            }
            _ => self.primary(),
        }
    }

    fn primary(&mut self) -> Option<f64> {
        match self.peek()? {
            Tok::Num(v) => {
                self.pos += 1;
                Some(v)
            }
            Tok::LParen => {
                self.pos += 1;
                let v = self.expr()?;
                match self.peek()? {
                    Tok::RParen => {
                        self.pos += 1;
                        Some(v)
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

/// Evaluate an arithmetic expression (`+ - * /`, parens, unary sign, f64).
/// Returns `None` on any parse error or trailing garbage.
fn calc(input: &str) -> Option<f64> {
    let toks = tokenize(input)?;
    if toks.is_empty() {
        return None;
    }
    let mut p = Parser { toks: &toks, pos: 0 };
    let value = p.expr()?;
    (p.pos == toks.len()).then_some(value)
}

// ---------------------------------------------------------------------------
// Ghost autocomplete + flat helpers
// ---------------------------------------------------------------------------

/// The ghost completion: the first row name (display order) that starts with
/// the query (case-insensitive) and is strictly longer.
fn ghost_for(query: &str, sections: &[Section]) -> Option<String> {
    let ql = query.to_lowercase();
    let qn = query.chars().count();
    flat_rows(sections)
        .map(|r| &r.name)
        .find(|n| n.to_lowercase().starts_with(&ql) && n.chars().count() > qn)
        .cloned()
}

/// Iterate rows across all sections in display (selection) order.
fn flat_rows(sections: &[Section]) -> impl Iterator<Item = &Row> {
    sections.iter().flat_map(|s| s.rows.iter())
}

/// The row at flat index `idx`, if any.
fn flat_get(sections: &[Section], idx: usize) -> Option<&Row> {
    flat_rows(sections).nth(idx)
}

// ---------------------------------------------------------------------------
// Row execution (shared by Enter and click)
// ---------------------------------------------------------------------------

/// Close the launcher and reset its query + selection.
fn close_and_reset(bus: &ShellBus, mut query: State<String>, mut selected: State<usize>) {
    bus.send(ShellMsg::CloseAll);
    query.set(String::new());
    selected.set(0);
}

/// Report the editor's current text/cursor/selection to the IME so a real input
/// method (ibus etc.) has fresh context, right after ANY edit -- keystroke or IME
/// commit alike (the protocol asks for this on both: "including changes caused by
/// handling incoming text-input events as well as changes caused by other
/// mechanisms like keyboard typing"). Ignored host-side when the launcher does not
/// currently hold text-input focus (main.rs's `on_ime` gates `enable` on that).
fn sync_ime_surrounding_text(bus: &ShellBus, editor: &Editor) {
    let anchor = editor.anchor.unwrap_or(editor.cursor);
    bus.send(ShellMsg::ImeSurroundingText {
        text: editor.query.clone(),
        cursor: editor.cursor as i32,
        anchor: anchor as i32,
    });
}

/// Run a row's action. App launches bump frecency (by `name`) and close;
/// commands fire and close; surface opens toggle and reset without a CloseAll
/// (the surface itself closes the launcher via the one-open-at-a-time rule);
/// inert rows do nothing.
fn run_action(
    action: &RowAction,
    name: &str,
    bus: &ShellBus,
    mut frecency: State<Frecency>,
    mut query: State<String>,
    mut selected: State<usize>,
) {
    match action {
        RowAction::Inert => {}
        RowAction::Launch { id } => {
            frecency.write().bump(name);
            bus.send(ShellMsg::Service(Command::LaunchApp(id.clone())));
            close_and_reset(bus, query, selected);
        }
        RowAction::Command(cmd) => {
            bus.send(ShellMsg::Service(cmd.clone()));
            close_and_reset(bus, query, selected);
        }
        RowAction::OpenSurface(key) => {
            bus.send(ShellMsg::Toggle(*key));
            query.set(String::new());
            selected.set(0);
        }
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/// The launcher surface body.
pub fn launcher() -> impl IntoElement {
    Launcher
}

#[derive(PartialEq)]
struct Launcher;

impl Component for Launcher {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let apps = use_consume::<State<AppsSnapshot>>();
        let progress = use_consume::<OpenProgress>();
        let feed = use_consume::<KeyFeed>();
        let ime_feed = use_consume::<ImeFeed>();

        let mut query = use_state(String::new);
        let mut selected = use_state(|| 0usize);
        let mut cursor = use_state(|| 0usize);
        let mut anchor = use_state(|| None::<usize>);
        let mut preedit = use_state(|| None::<Preedit>);
        let frecency = use_state(Frecency::load);

        // Reveal opacity + open-state (subscribes this scope to the spring).
        let p = *progress.0.read();
        let opacity = p.clamp(0.0, 1.0);
        let open_now = p > 0.01;

        // Reset the query/selection/cursor/preedit on the closed -> open transition.
        use_side_effect_with_deps(&open_now, move |&now| {
            if now {
                query.set(String::new());
                selected.set(0);
                cursor.set(0);
                anchor.set(None);
                preedit.set(None);
            }
        });

        // Route keys: the effect re-runs only when a new key arrives (its dep is
        // the KeyFeed seq). Everything else is peeked so typing never re-fires it.
        let seq = feed.0.read().as_ref().map(|e| e.seq).unwrap_or(0);
        {
            let bus = bus.clone();
            use_side_effect_with_deps(&seq, move |_| {
                let event = feed.0.peek();
                let Some(event) = event.as_ref() else {
                    return;
                };
                let stroke =
                    classify_key(&event.press.key, &event.press.code, event.press.modifiers);

                // Paste needs the clipboard fetched (IO) before Editor can apply it --
                // Editor never performs IO itself, so this short-circuits before the
                // normal apply()-driven path below (whose Stroke::Paste arm is an inert
                // fallback that should never actually run).
                if stroke == Stroke::Paste {
                    let text = freya_clipboard::prelude::Clipboard::get().unwrap_or_else(|e| {
                        tracing::warn!("[launcher] clipboard read failed: {e:?}");
                        String::new()
                    });
                    let mut editor = Editor {
                        query: query.peek().clone(),
                        selected: *selected.peek(),
                        cursor: *cursor.peek(),
                        anchor: *anchor.peek(),
                    };
                    editor.paste(&text);
                    sync_ime_surrounding_text(&bus, &editor);
                    query.set(editor.query);
                    selected.set(editor.selected);
                    cursor.set(editor.cursor);
                    anchor.set(editor.anchor);
                    return;
                }

                let q = query.peek().clone();
                let sections = {
                    let snap = apps.peek();
                    let frec = frecency.peek();
                    results(&q, &snap, &frec)
                };
                let rows: usize = sections.iter().map(|s| s.rows.len()).sum();
                let ghost = ghost_for(&q, &sections);
                let mut editor = Editor {
                    query: q,
                    selected: *selected.peek(),
                    cursor: *cursor.peek(),
                    anchor: *anchor.peek(),
                };
                // Copy/Cut read the selection BEFORE apply() (Cut deletes it); a
                // collapsed/absent selection means nothing to copy, matching ordinary
                // Ctrl+C-with-nothing-selected = no-op convention.
                let copy_text = if matches!(stroke, Stroke::Copy | Stroke::Cut) {
                    editor.selected_text().map(str::to_string)
                } else {
                    None
                };
                match editor.apply(&stroke, ghost.as_deref(), rows) {
                    Outcome::Redraw => {
                        if let Some(text) = copy_text
                            && let Err(e) = freya_clipboard::prelude::Clipboard::set(text)
                        {
                            tracing::warn!("[launcher] clipboard write failed: {e:?}");
                        }
                        sync_ime_surrounding_text(&bus, &editor);
                        query.set(editor.query);
                        selected.set(editor.selected);
                        cursor.set(editor.cursor);
                        anchor.set(editor.anchor);
                    }
                    Outcome::Close => bus.send(ShellMsg::CloseAll),
                    Outcome::Run => match flat_get(&sections, editor.selected) {
                        Some(row) => {
                            run_action(&row.action, &row.name, &bus, frecency, query, selected)
                        }
                        None => close_and_reset(&bus, query, selected),
                    },
                }
            });
        }

        // Route IME `done` payloads (delete + commit -> the Editor; the live
        // preedit -> its own state, rendered inline by field_row -- never spliced
        // into `query`). The effect re-runs only on a new commit (its dep is the
        // ImeFeed seq); Enter/Leave are handled host-side (main.rs), not here.
        let ime_seq = ime_feed.0.read().as_ref().map(|e| e.seq).unwrap_or(0);
        {
            let bus = bus.clone();
            use_side_effect_with_deps(&ime_seq, move |_| {
                let event = ime_feed.0.peek();
                let Some(event) = event.as_ref() else {
                    return;
                };
                let payload = &event.commit;
                if payload.delete_before > 0 || payload.delete_after > 0 || payload.commit.is_some() {
                    let mut editor = Editor {
                        query: query.peek().clone(),
                        selected: *selected.peek(),
                        cursor: *cursor.peek(),
                        anchor: *anchor.peek(),
                    };
                    editor.apply_ime_commit(
                        payload.delete_before,
                        payload.delete_after,
                        payload.commit.as_deref(),
                    );
                    sync_ime_surrounding_text(&bus, &editor);
                    query.set(editor.query);
                    selected.set(editor.selected);
                    cursor.set(editor.cursor);
                    anchor.set(editor.anchor);
                }
                preedit.set(payload.preedit.clone());
            });
        }

        // Providers for display (same pure path the key effect uses).
        let q = query.read();
        let sel = *selected.read();
        let snap = apps.read();
        let sections = results(&q, &snap, &frecency.peek());
        let ghost = ghost_for(&q, &sections);

        // Click-to-position: reassemble/apply/write-back mirrors the key-
        // routing effect above, but through Editor::click_at (a pointer click
        // isn't a keystroke -- see its doc comment).
        let on_field_click = {
            let bus = bus.clone();
            EventHandler::new(move |byte_offset: usize| {
                let mut editor = Editor {
                    query: query.peek().clone(),
                    selected: *selected.peek(),
                    cursor: *cursor.peek(),
                    anchor: *anchor.peek(),
                };
                editor.click_at(byte_offset);
                sync_ime_surrounding_text(&bus, &editor);
                cursor.set(editor.cursor);
                anchor.set(editor.anchor);
            })
        };
        let on_field_drag = {
            let bus = bus.clone();
            EventHandler::new(move |byte_offset: usize| {
                let mut editor = Editor {
                    query: query.peek().clone(),
                    selected: *selected.peek(),
                    cursor: *cursor.peek(),
                    anchor: *anchor.peek(),
                };
                editor.drag_to(byte_offset);
                sync_ime_surrounding_text(&bus, &editor);
                cursor.set(editor.cursor);
                anchor.set(editor.anchor);
            })
        };
        let field = field_row(
            &q,
            ghost.as_deref(),
            *cursor.read(),
            *anchor.read(),
            preedit.read().as_ref(),
            on_field_click,
            on_field_drag,
        );

        let body: Element = if q.trim().is_empty() {
            empty_state(&snap, frecency)
        } else {
            results_list(&sections, sel, &bus, frecency, query, selected)
        };

        let scale = use_open_scale(opacity);
        let sheet = rect()
            .width(Size::fill())
            .background(theme::PANEL.rgb())
            .corner_radius(theme::RADIUS_SHEET)
            .padding(SHEET_PAD)
            .vertical()
            .spacing(6.0)
            .scale(scale)
            .child(field)
            .child(body)
            .child(footer());

        // Fill the (content-sized) surface width, but AUTO height so the surface hugs
        // the sheet (host reads ROOT content height). `.expanded()` would fill height
        // and defeat content sizing.
        rect().width(Size::fill()).opacity(opacity).child(sheet)
    }
}

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------

/// The search field: magnifier, the query text with a real byte-offset cursor
/// (not always trailing -- see [`Editor`]) and an optional selection
/// highlight, the faux placeholder (empty) or the DIM ghost suffix (only
/// shown when the cursor sits at the very end -- mid-string it would read as
/// text inserted ahead of the cursor), and a `super` kbd chip.
///
/// `preedit` is the IME's live composing text (see [`kobel_wayland::Preedit`]):
/// when present and non-empty it takes over rendering entirely (no ghost, no
/// selection highlight -- the IME owns the cursor while composing), shown as a
/// CHIP-background span spliced in at `cursor`, with its own inner caret at the
/// preedit's cursor position when the compositor reports one.
fn field_row(
    query: &str,
    ghost: Option<&str>,
    cursor: usize,
    anchor: Option<usize>,
    preedit: Option<&Preedit>,
    on_click: EventHandler<usize>,
    on_drag: EventHandler<usize>,
) -> Element {
    let selection = anchor.and_then(|a| {
        let (start, end) = (a.min(cursor), a.max(cursor));
        (start != end).then_some((start, end))
    });
    let preedit = preedit.filter(|p| !p.text.is_empty());

    let mk_caret = || {
        rect()
            .width(Size::px(CARET_W))
            .height(Size::px(CARET_H))
            .corner_radius(1.0)
            .background(theme::LEAF.rgb())
    };

    let plain = |s: &str| {
        label().text(s.to_string()).color(theme::TX.rgb()).font_size(FIELD_FONT).max_lines(1usize)
    };

    let mut text = rect()
        .horizontal()
        .width(Size::flex(1.0))
        .cross_align(Alignment::Center)
        .height(Size::px(2.0 * FIELD_TEXT_PAD_V + CARET_H))
        .overflow(Overflow::Clip);

    // Click-to-position + drag-to-select. While composing (preedit active) a
    // click/drag is a no-op: repositioning mid-composition isn't verified
    // against a real IME in this environment (see README's IME gap), so the
    // safest behavior is to leave the cursor alone rather than risk
    // desyncing the compositor's notion of the surrounding text. Otherwise,
    // a hidden 0x0-clipped paragraph mirrors `query` at the SAME font/size
    // as the visible text; Skia's `get_glyph_position_at_coordinate` needs a
    // real, laid-out paragraph (FontCollection is never exposed to
    // component code, confirmed against freya-core's element/render context
    // types -- there's no way to build one outside the render tree), so
    // this is attached via `paragraph().holder(_)` and hit-tested on click
    // and drag. Zero visible/layout footprint: width(0) takes no flex
    // space, and it's the FIRST child so its own origin sits at the same
    // x=0 the visible text starts at. `get_glyph_position_at_coordinate`
    // reports UTF-16 code-unit offsets (verified empirically), hence
    // `utf16_offset_to_byte`.
    //
    // Down uses `element_location()` (local to `text`, matches the hidden
    // paragraph's own coordinate space directly); a drag needs
    // `on_global_pointer_move` to keep tracking past `text`'s own bounds
    // (dragging the selection beyond the field, matching ordinary text-field
    // UX), whose `global_location()` is screen-absolute, so it's converted
    // via `text`'s own tracked Area -- same technique as chip.rs's KSlider.
    if preedit.is_none() {
        let owned_query = query.to_string();
        let holder = use_hook(ParagraphHolder::default);
        let mut dragging = use_state(|| false);
        let mut drag_area = use_state(Area::default);

        text = text.child(
            rect().width(Size::px(0.0)).height(Size::px(0.0)).overflow(Overflow::Clip).child(
                paragraph()
                    .width(Size::px(2000.0))
                    .max_lines(Some(1usize))
                    .holder(holder.clone())
                    .span(Span::new(owned_query.clone()).font_size(FIELD_FONT)),
            ),
        );

        text = text.on_sized(move |e: Event<SizedEventData>| drag_area.set(e.area));

        let down_holder = holder.clone();
        let down_query = owned_query.clone();
        text = text.on_pointer_down(move |e: Event<PointerEventData>| {
            if !e.data().is_primary() {
                return;
            }
            let Some(sk_paragraph) = down_holder.0.borrow().as_ref().map(|h| h.paragraph.clone())
            else {
                return;
            };
            let x = e.element_location().x as f32;
            let pos = sk_paragraph.get_glyph_position_at_coordinate((x, 1.0));
            on_click.call(utf16_offset_to_byte(&down_query, pos.position as usize));
            dragging.set(true);
        });

        let move_holder = holder.clone();
        let move_query = owned_query.clone();
        text = text.on_global_pointer_move(move |e: Event<PointerEventData>| {
            if !*dragging.peek() {
                return;
            }
            let Some(sk_paragraph) = move_holder.0.borrow().as_ref().map(|h| h.paragraph.clone())
            else {
                return;
            };
            let area = drag_area.read();
            let x = (e.global_location().x - area.min_x() as f64) as f32;
            let pos = sk_paragraph.get_glyph_position_at_coordinate((x, 1.0));
            on_drag.call(utf16_offset_to_byte(&move_query, pos.position as usize));
        });

        text = text.on_global_pointer_press(move |_: Event<PointerEventData>| dragging.set(false));
    }

    if let Some(pe) = preedit {
        // Composing: before-cursor text, the preedit span (CHIP background --
        // distinct from the LEAF selection highlight, "still composing" reads as
        // a different affordance than "selected"), after-cursor text. The inner
        // caret sits at the preedit's own cursor when the compositor reports one
        // collapsed (cursor_begin == cursor_end); a real range or a hidden cursor
        // (both None) renders the span with no inner caret.
        let (before, after) = (&query[..cursor], &query[cursor..]);
        if !before.is_empty() {
            text = text.child(plain(before));
        }
        let pe_text = |s: &str| {
            label().text(s.to_string()).color(theme::TX.rgb()).font_size(FIELD_FONT).max_lines(1usize)
        };
        let mut pe_row = rect().horizontal().background(theme::CHIP.rgb()).corner_radius(2.0);
        match (pe.cursor_begin, pe.cursor_end) {
            (Some(b), Some(e)) if b == e => {
                let (pb, pa) = (&pe.text[..b], &pe.text[b..]);
                if !pb.is_empty() {
                    pe_row = pe_row.child(pe_text(pb));
                }
                pe_row = pe_row.child(mk_caret());
                if !pa.is_empty() {
                    pe_row = pe_row.child(pe_text(pa));
                }
            }
            _ => pe_row = pe_row.child(pe_text(&pe.text)),
        }
        text = text.child(pe_row);
        if !after.is_empty() {
            text = text.child(plain(after));
        }
    } else if query.is_empty() {
        text = text.child(mk_caret()).child(
            label()
                .text(PLACEHOLDER)
                .color(theme::DIM.rgb())
                .font_size(FIELD_FONT),
        );
    } else if let Some((start, end)) = selection {
        // A range is selected: before / highlighted-selection / after, no
        // blinking caret (matches ordinary text-field convention).
        let (before, selected_text, after) = (&query[..start], &query[start..end], &query[end..]);
        if !before.is_empty() {
            text = text.child(plain(before));
        }
        text = text.child(
            rect().background(theme::LEAF.rgb()).corner_radius(2.0).child(
                label()
                    .text(selected_text.to_string())
                    .color(theme::INK.rgb())
                    .font_size(FIELD_FONT)
                    .max_lines(1usize),
            ),
        );
        if !after.is_empty() {
            text = text.child(plain(after));
        }
    } else {
        // A plain cursor: before-cursor text, the caret, after-cursor text.
        let (before, after) = (&query[..cursor], &query[cursor..]);
        if !before.is_empty() {
            text = text.child(plain(before));
        }
        text = text.child(mk_caret());
        if !after.is_empty() {
            text = text.child(plain(after));
        }
        if cursor == query.len()
            && let Some(g) = ghost
        {
            let suffix: String = g.chars().skip(query.chars().count()).collect();
            if !suffix.is_empty() {
                text = text.child(
                    label()
                        .text(suffix)
                        .color(theme::DIM.rgb())
                        .font_size(FIELD_FONT)
                        .max_lines(1usize),
                );
            }
        }
    }

    rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(11.0)
        .background(theme::PANEL2.rgb())
        .corner_radius(theme::RADIUS_TILE)
        .padding((FIELD_PAD_V, 12.0))
        .child(icon(ICON_MAGNIFIER, 16.0, theme::MUT))
        .child(text)
        .child(kbd_chip("super"))
        .into_element()
}

/// A small keycap chip (`.kbd`).
fn kbd_chip(text: &str) -> Element {
    rect()
        .background(theme::CHIP.rgb())
        .corner_radius(6.0)
        .padding((2.0, 7.0))
        .cross_align(Alignment::Center)
        .child(
            label()
                .text(text.to_string())
                .color(theme::DIM.rgb())
                .font_size(theme::FONT_SIZE_MIN)
                .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
        )
        .into_element()
}

// ---------------------------------------------------------------------------
// Empty-state tile row (the six dock pins)
// ---------------------------------------------------------------------------

/// The curated tile row: the dock pins resolved via [`AppsSnapshot`], each
/// launching + bumping frecency on press.
fn empty_state(apps: &AppsSnapshot, frecency: State<Frecency>) -> Element {
    let tiles: Vec<Element> = dock::pins()
        .iter()
        .map(|pin| {
            let (launch_id, name, icon_path) = match apps.by_id(pin) {
                Some(app) => (app.id.clone(), app.name.clone(), app.icon.clone()),
                None => (pin.clone(), pin.clone(), None),
            };
            AppTile { launch_id, name, icon_path, frecency }.into_element()
        })
        .collect();

    rect()
        .horizontal()
        .main_align(Alignment::Center)
        .cross_align(Alignment::Start)
        .spacing(6.0)
        .padding((10.0, 0.0))
        .width(Size::fill())
        .children(tiles)
        .into_element()
}

/// One curated launcher tile. Its own component so its hover state lives in an
/// isolated scope.
#[derive(PartialEq)]
struct AppTile {
    launch_id: String,
    name: String,
    icon_path: Option<PathBuf>,
    frecency: State<Frecency>,
}

impl Component for AppTile {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let mut hovered = use_state(|| false);
        let on = *hovered.read();

        let chip_bg: Color = if on {
            theme::PANEL2.rgb().into()
        } else {
            Color::TRANSPARENT
        };

        let launch_id = self.launch_id.clone();
        let name = self.name.clone();
        let mut frecency = self.frecency;

        let chip = rect()
            .width(Size::px(TILE_GLYPH + 12.0))
            .height(Size::px(TILE_GLYPH + 12.0))
            .corner_radius(theme::RADIUS_TILE)
            .background(chip_bg)
            .center()
            .overflow(Overflow::Clip)
            .child(AppIcon { path: self.icon_path.clone(), size: TILE_GLYPH });

        rect()
            .vertical()
            .width(Size::px(TILE_W))
            .cross_align(Alignment::Center)
            .spacing(6.0)
            .padding((6.0, 4.0))
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| {
                frecency.write().bump(&name);
                bus.send(ShellMsg::Service(Command::LaunchApp(launch_id.clone())));
                bus.send(ShellMsg::CloseAll);
            })
            .child(chip)
            .child(
                label()
                    .text(self.name.clone())
                    .color(theme::MUT.rgb())
                    .font_size(theme::FONT_SIZE_MIN)
                    .max_lines(1usize)
                    .width(Size::px(TILE_W - 8.0))
                    .text_align(TextAlign::Center),
            )
    }
}

// ---------------------------------------------------------------------------
// Results list
// ---------------------------------------------------------------------------

/// The ranked results list: DIM section headers and clickable rows, the
/// selected row lifted to a CHIP with a return-glyph hint.
fn results_list(
    sections: &[Section],
    selected: usize,
    bus: &ShellBus,
    frecency: State<Frecency>,
    query: State<String>,
    selected_state: State<usize>,
) -> Element {
    let mut list = rect().vertical().width(Size::fill()).spacing(2.0);
    let mut flat_idx = 0usize;

    for section in sections {
        list = list.child(
            label()
                .text(section.title)
                .color(theme::DIM.rgb())
                .font_size(theme::FONT_SIZE_MIN)
                .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
        );
        for row in &section.rows {
            let is_sel = flat_idx == selected;
            list = list.child(row_view(
                row,
                is_sel,
                bus.clone(),
                frecency,
                query,
                selected_state,
            ));
            flat_idx += 1;
        }
    }
    list.into_element()
}

/// One result row element.
fn row_view(
    row: &Row,
    selected: bool,
    bus: ShellBus,
    frecency: State<Frecency>,
    query: State<String>,
    selected_state: State<usize>,
) -> Element {
    let bg: Color = if selected {
        theme::CHIP.rgb().into()
    } else {
        Color::TRANSPARENT
    };

    // Icon frame: a 28x28 PANEL2 well around the row glyph.
    let glyph: Element = match &row.icon {
        RowIcon::App(path) => AppIcon { path: path.clone(), size: RI_GLYPH }.into_element(),
        RowIcon::Symbol(bytes) => icon(bytes, 16.0, theme::MUT).into_element(),
    };
    let frame = rect()
        .width(Size::px(RI_FRAME))
        .height(Size::px(RI_FRAME))
        .corner_radius(8.0)
        .background(theme::PANEL2.rgb())
        .center()
        .overflow(Overflow::Clip)
        .child(glyph);

    let name = name_element(&row.name, &row.marks);

    let hint = label()
        .text(row.hint.clone())
        .color(theme::DIM.rgb())
        .font_size(theme::FONT_SIZE_MIN)
        .max_lines(1usize)
        .width(Size::flex(1.0));

    let action = row.action.clone();
    let run_name = row.name.clone();

    let mut r = rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(11.0)
        .width(Size::fill())
        .corner_radius(theme::RADIUS_ROW)
        .padding((7.0, 10.0))
        .background(bg)
        .on_press(move |_| {
            run_action(&action, &run_name, &bus, frecency, query, selected_state)
        })
        .child(frame)
        .child(name)
        .child(hint);

    if selected {
        r = r.child(
            label()
                .text("\u{21B5}")
                .color(theme::MUT.rgb())
                .font_size(ROW_FONT),
        );
    }
    r.into_element()
}

/// Render a row name, painting the fuzzy-matched chars LEAF (via a paragraph of
/// spans) or a plain TX label when there are no marks.
fn name_element(name: &str, marks: &[usize]) -> Element {
    if marks.is_empty() {
        return label()
            .text(name.to_string())
            .color(theme::TX.rgb())
            .font_size(ROW_FONT)
            .max_lines(1usize)
            .into_element();
    }

    let mut para = paragraph().max_lines(Some(1usize));
    let mut run = String::new();
    let mut run_marked = false;
    for (i, ch) in name.chars().enumerate() {
        let marked = marks.contains(&i);
        if marked != run_marked && !run.is_empty() {
            para = para.span(span(&run, run_marked));
            run.clear();
        }
        run_marked = marked;
        run.push(ch);
    }
    if !run.is_empty() {
        para = para.span(span(&run, run_marked));
    }
    para.into_element()
}

/// A styled name span: LEAF when matched, TX otherwise.
fn span(text: &str, marked: bool) -> Span<'static> {
    let color: Rgb = if marked { theme::LEAF } else { theme::TX };
    Span::new(text.to_string())
        .color(color.rgb())
        .font_size(ROW_FONT)
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

/// The footer hint row (`.lfoot`): command hints left, nav hint right.
fn footer() -> Element {
    let hints = rect()
        .horizontal()
        .width(Size::flex(1.0))
        .main_align(Alignment::Start)
        .spacing(14.0)
        .child(foot_hint(":reload"))
        .child(foot_hint(":osd on|off"))
        .child(foot_hint(":ext <uuid>"));

    rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .padding((4.0, 4.0))
        .child(hints)
        .child(
            label()
                .text("Tab complete  |  arrows select  |  Enter run")
                .color(theme::DIM.rgb())
                .font_size(theme::FONT_SIZE_MIN),
        )
        .into_element()
}

/// One DIM footer hint chip.
fn foot_hint(text: &str) -> Element {
    label()
        .text(text.to_string())
        .color(theme::MUT.rgb())
        .font_size(theme::FONT_SIZE_MIN)
        .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
        .into_element()
}

// ---------------------------------------------------------------------------
// Tests -- pure logic only (no Freya runtime).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str, keywords: &[&str]) -> AppEntry {
        AppEntry {
            id: id.to_string(),
            name: name.to_string(),
            icon: None,
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// End-to-end integration test (via `freya_testing::TestingRunner`) for the
    /// ACTUAL Freya wiring in [`field_row`] -- the hidden hit-test paragraph,
    /// its `on_mouse_down` handler, and the UTF-16-to-byte conversion -- as
    /// opposed to the [`Editor::click_at`]/[`utf16_offset_to_byte`] unit tests
    /// above, which only exercise the pure post-hit-test logic. Renders
    /// `field_row` for real, sends real mouse-down events at real screen
    /// coordinates, and reads back what `on_click` was actually called with.
    #[test]
    fn field_row_click_hit_tests_the_real_rendered_paragraph() {
        use std::cell::Cell;
        use std::rc::Rc;

        use freya_core::elements::paragraph::Paragraph;
        use freya_testing::launch_test;

        let query = "hello world";
        let reported: Rc<Cell<Option<usize>>> = Rc::new(Cell::new(None));
        let reported_for_app = reported.clone();
        let app = move || {
            let reported = reported_for_app.clone();
            field_row(
                query,
                None,
                query.len(),
                None,
                None,
                EventHandler::new(move |offset: usize| reported.set(Some(offset))),
                EventHandler::new(move |_offset: usize| {}),
            )
        };

        let mut test = launch_test(app);
        test.sync_and_update();

        // Locate the hidden hit-test paragraph's own rendered area directly
        // (rather than guessing the field's icon/padding/spacing offsets), so
        // the click coordinates below are exact regardless of field_row's
        // surrounding layout. `field_row` renders exactly one `paragraph()`
        // element -- the hidden one -- in this minimal test app.
        let area = test
            .find(|node, element| Paragraph::try_downcast(element).map(|_| node.layout().area))
            .expect("field_row renders a hidden hit-test paragraph");
        let y = area.min_y() + 5.0;

        // A click right at the paragraph's own left edge hits the very first
        // glyph.
        test.press_cursor((area.min_x() as f64 + 1.0, y as f64));
        let near_start = reported.get().expect("on_click fired for a click near the start");
        assert!(near_start <= 2, "click near x=0 should land at/near byte 0, got {near_start}");

        // A click within the field but past the rendered text's ~74px extent
        // (the paragraph's own clip-parent `text` is ~396px wide here, well
        // past "hello world" at 14.5px -- see the layout dump this offset was
        // chosen against) clamps to the end of the query, never panics.
        reported.set(None);
        test.press_cursor((area.min_x() as f64 + 150.0, y as f64));
        assert_eq!(
            reported.get(),
            Some(query.len()),
            "click far past the text should clamp to the query's byte length"
        );
    }

    #[test]
    fn field_row_drag_extends_the_selection_past_the_down_point() {
        use std::cell::Cell;
        use std::rc::Rc;

        use freya_core::elements::paragraph::Paragraph;
        use freya_testing::launch_test;

        let query = "hello world";
        let reported_click: Rc<Cell<Option<usize>>> = Rc::new(Cell::new(None));
        let reported_drag: Rc<Cell<Option<usize>>> = Rc::new(Cell::new(None));
        let click_for_app = reported_click.clone();
        let drag_for_app = reported_drag.clone();
        let app = move || {
            let click_for_app = click_for_app.clone();
            let drag_for_app = drag_for_app.clone();
            field_row(
                query,
                None,
                query.len(),
                None,
                None,
                EventHandler::new(move |offset: usize| click_for_app.set(Some(offset))),
                EventHandler::new(move |offset: usize| drag_for_app.set(Some(offset))),
            )
        };

        let mut test = launch_test(app);
        test.sync_and_update();

        let area = test
            .find(|node, element| Paragraph::try_downcast(element).map(|_| node.layout().area))
            .expect("field_row renders a hidden hit-test paragraph");
        let y = (area.min_y() + 5.0) as f64;
        let start_x = area.min_x() as f64 + 1.0;
        let end_x = area.min_x() as f64 + 150.0;

        // Press near the start (fires on_click, arms the drag), then move
        // WITHOUT releasing -- on_drag should fire, extending the selection
        // from the down-point to wherever the drag currently is.
        test.press_cursor((start_x, y));
        assert!(reported_click.get().is_some(), "press fires on_click first");
        test.move_cursor((end_x, y));
        test.sync_and_update();
        let dragged = reported_drag.get().expect("on_drag fired while dragging past the down-point");
        assert_eq!(dragged, query.len(), "drag past the text clamps to the query's byte length");

        // Release, then move again: on_drag must NOT keep firing once the
        // drag has ended (a stray move after release would silently keep
        // rewriting the selection).
        test.release_cursor((end_x, y));
        reported_drag.set(None);
        test.move_cursor((start_x, y));
        test.sync_and_update();
        assert_eq!(reported_drag.get(), None, "on_drag must not fire after release");
    }

    fn snapshot() -> AppsSnapshot {
        AppsSnapshot {
            apps: vec![
                app("org.mozilla.firefox", "Firefox", &["browser", "web"]),
                app("dev.zed.Zed", "Zed", &["editor"]),
                app("org.gnome.Settings", "Settings", &["preferences"]),
            ],
        }
    }

    fn empty_frecency() -> Frecency {
        Frecency::load_from(std::env::temp_dir().join("kobel-launcher-test-freq.json"))
    }

    // ----- calculator ------------------------------------------------------

    #[test]
    fn calc_basic_arithmetic() {
        assert_eq!(calc("2+2"), Some(4.0));
        assert_eq!(calc("2 + 3 * 4"), Some(14.0));
        assert_eq!(calc("(2 + 3) * 4"), Some(20.0));
        assert_eq!(calc("10 / 4"), Some(2.5));
        assert_eq!(calc("-3 + 5"), Some(2.0));
        assert_eq!(calc("2 * -(1 + 2)"), Some(-6.0));
    }

    #[test]
    fn calc_rejects_garbage_and_unbalanced() {
        assert_eq!(calc("2 +"), None);
        assert_eq!(calc("(2 + 3"), None);
        assert_eq!(calc("2 3"), None);
        assert_eq!(calc("abc"), None);
        assert_eq!(calc("2..3"), None);
        assert_eq!(calc(""), None);
    }

    #[test]
    fn calc_division_by_zero_is_not_finite() {
        assert!(calc("1/0").is_some_and(|v| !v.is_finite()));
        // The calculator row filters non-finite results out.
        assert!(calculator_row("1/0").is_none());
    }

    #[test]
    fn looks_like_math_needs_digit_and_operator() {
        assert!(looks_like_math("2+2"));
        assert!(looks_like_math("3 * (4 - 1)"));
        assert!(!looks_like_math("2"), "bare number is not math");
        assert!(!looks_like_math("hello"));
        assert!(!looks_like_math("++"));
    }

    #[test]
    fn calculator_row_prefix_and_shape() {
        // '=' prefix forces the calculator even without an operator.
        let row = calculator_row("=5").expect("= prefix");
        assert_eq!(row.name, "5");
        assert!(matches!(&row.action, RowAction::Command(Command::CopyText(_))));
        // Integer result has no trailing .0; the hint echoes the expression.
        let row = calculator_row("2+2").expect("math-looking");
        assert_eq!(row.name, "4");
        assert_eq!(row.hint, "2+2 =");
    }

    #[test]
    fn format_number_trims_integers() {
        assert_eq!(format_number(4.0), "4");
        assert_eq!(format_number(2.5), "2.5");
        assert_eq!(format_number(-6.0), "-6");
    }

    // ----- ':' commands ----------------------------------------------------

    #[test]
    fn command_rows_resolve_typed_commands() {
        // reload / scripts need no args.
        assert!(matches!(&command_rows("reload")[0].action, RowAction::Command(Command::Reload)));
        assert!(matches!(
            &command_rows("scripts")[0].action,
            RowAction::Command(Command::ReloadScripts)
        ));
        // ext needs a uuid.
        assert!(matches!(&command_rows("ext")[0].action, RowAction::Inert));
        match &command_rows("ext abc-123")[0].action {
            RowAction::Command(Command::ReloadExtension(u)) => assert_eq!(u, "abc-123"),
            other => panic!("expected ReloadExtension, got {other:?}"),
        }
        // osd/notifs need on|off.
        assert!(matches!(&command_rows("osd")[0].action, RowAction::Inert));
        match &command_rows("osd off")[0].action {
            RowAction::Command(Command::SetFeature { name, on }) => {
                assert_eq!(name, "osd");
                assert!(!on);
            }
            other => panic!("expected SetFeature, got {other:?}"),
        }
        match &command_rows("notifs on")[0].action {
            RowAction::Command(Command::SetFeature { name, on }) => {
                assert_eq!(name, "notifications");
                assert!(on);
            }
            other => panic!("expected SetFeature, got {other:?}"),
        }
    }

    #[test]
    fn command_rows_partial_verb_lists_candidates() {
        // ':' alone lists every command.
        assert_eq!(command_rows("").len(), CMD_SPECS.len());
        // A prefix narrows to matching verbs and stays runnable for no-arg ones.
        let re = command_rows("re");
        assert_eq!(re.len(), 1);
        assert_eq!(re[0].name, ":reload");
        assert!(matches!(&re[0].action, RowAction::Command(Command::Reload)));
        // Unknown verb -> a single inert hint row.
        let unknown = command_rows("zzz");
        assert_eq!(unknown.len(), 1);
        assert!(matches!(&unknown[0].action, RowAction::Inert));
    }

    #[test]
    fn results_colon_prefix_is_commands_only() {
        let secs = results(":osd off", &snapshot(), &empty_frecency());
        assert_eq!(secs.len(), 1);
        assert_eq!(secs[0].title, "commands");
    }

    // ----- provider selection ---------------------------------------------

    #[test]
    fn results_general_has_best_apps_and_web() {
        let secs = results("fire", &snapshot(), &empty_frecency());
        let titles: Vec<&str> = secs.iter().map(|s| s.title).collect();
        assert_eq!(titles.first(), Some(&"best match"));
        assert!(titles.contains(&"web"), "web is always present");
        // The best match is Firefox, and its name marks the matched chars.
        let best = &secs[0].rows[0];
        assert_eq!(best.name, "Firefox");
        assert_eq!(best.marks, vec![0, 1, 2, 3]);
        assert!(matches!(&best.action, RowAction::Launch { .. }));
    }

    #[test]
    fn results_calculator_leads_when_math() {
        let secs = results("2+2", &snapshot(), &empty_frecency());
        assert_eq!(secs[0].title, "calculator");
        assert_eq!(secs[0].rows[0].name, "4");
    }

    #[test]
    fn results_actions_match_by_name_and_alias() {
        // "reboot" is a Restart alias -> opens the session surface.
        let secs = results("reboot", &snapshot(), &empty_frecency());
        let restart = flat_rows(&secs).find(|r| r.name == "Restart");
        assert!(matches!(
            restart.map(|r| &r.action),
            Some(RowAction::OpenSurface(SurfaceKey::Session))
        ));
        // "lock" fires the verb directly.
        let secs = results("lock", &snapshot(), &empty_frecency());
        let lock = flat_rows(&secs).find(|r| r.name == "Lock");
        assert!(matches!(
            lock.map(|r| &r.action),
            Some(RowAction::Command(Command::Session(SessionVerb::Lock)))
        ));
    }

    #[test]
    fn frecency_boost_reorders_best_match() {
        let apps = AppsSnapshot {
            apps: vec![app("a.Ab", "Application", &[]), app("b.Ap", "Applesauce", &[])],
        };
        // Without history, the shorter/tighter match tends to win; bump the other
        // hard and it should take the best slot.
        let mut frec = empty_frecency();
        for _ in 0..8 {
            frec.bump("Applesauce");
        }
        let secs = results("app", &apps, &frec);
        assert_eq!(secs[0].rows[0].name, "Applesauce");
    }

    // ----- ghost -----------------------------------------------------------

    #[test]
    fn ghost_completes_first_prefix_row() {
        let secs = results("fir", &snapshot(), &empty_frecency());
        assert_eq!(ghost_for("fir", &secs).as_deref(), Some("Firefox"));
        // No row starts with a query that matches nothing prefix-wise.
        let secs = results("zzz", &snapshot(), &empty_frecency());
        assert_eq!(ghost_for("zzz", &secs), None);
    }

    // ----- classify_key ----------------------------------------------------

    #[test]
    fn classify_named_and_text_keys() {
        let none = Modifiers::empty();
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Escape), &Code::Escape, none),
            Stroke::Escape
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Enter), &Code::Enter, none),
            Stroke::Enter
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Tab), &Code::Tab, none),
            Stroke::Tab { back: false }
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Tab), &Code::Tab, Modifiers::SHIFT),
            Stroke::Tab { back: true }
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Backspace), &Code::Backspace, none),
            Stroke::Backspace { word: false }
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Backspace), &Code::Backspace, Modifiers::CONTROL),
            Stroke::Backspace { word: true }
        );
        assert_eq!(
            classify_key(&Key::Character("a".into()), &Code::KeyA, none),
            Stroke::Text("a".to_string())
        );
    }

    #[test]
    fn classify_ctrl_np_cycle_via_physical_code() {
        // Under Ctrl the key value is often a control char / Unidentified, so we
        // match the physical code instead.
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Unidentified), &Code::KeyN, Modifiers::CONTROL),
            Stroke::Down
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Unidentified), &Code::KeyP, Modifiers::CONTROL),
            Stroke::Up
        );
    }

    #[test]
    fn classify_ignores_modifier_chords_for_text() {
        // Ctrl+a is not text input.
        assert_eq!(
            classify_key(&Key::Character("a".into()), &Code::KeyA, Modifiers::CONTROL),
            Stroke::Ignore
        );
    }

    #[test]
    fn classify_ctrl_cxv_matches_physical_code() {
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Unidentified), &Code::KeyC, Modifiers::CONTROL),
            Stroke::Copy
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Unidentified), &Code::KeyX, Modifiers::CONTROL),
            Stroke::Cut
        );
        assert_eq!(
            classify_key(&Key::Named(NamedKey::Unidentified), &Code::KeyV, Modifiers::CONTROL),
            Stroke::Paste
        );
    }

    // ----- editor ----------------------------------------------------------

    #[test]
    fn editor_types_and_backspaces() {
        let mut e = Editor::default();
        assert_eq!(e.apply(&Stroke::Text("h".into()), None, 0), Outcome::Redraw);
        e.apply(&Stroke::Text("i".into()), None, 0);
        assert_eq!(e.query, "hi");
        e.apply(&Stroke::Backspace { word: false }, None, 0);
        assert_eq!(e.query, "h");
    }

    #[test]
    fn editor_ctrl_backspace_clears_word() {
        let mut e = Editor { query: "hello world  ".into(), selected: 0, cursor: 13, anchor: None };
        e.apply(&Stroke::Backspace { word: true }, None, 0);
        assert_eq!(e.query, "hello ");
        e.apply(&Stroke::Backspace { word: true }, None, 0);
        assert_eq!(e.query, "");
    }

    #[test]
    fn editor_escape_clears_then_closes() {
        let mut e = Editor { query: "abc".into(), selected: 2, cursor: 3, anchor: None };
        assert_eq!(e.apply(&Stroke::Escape, None, 5), Outcome::Redraw);
        assert_eq!(e.query, "");
        assert_eq!(e.selected, 0);
        assert_eq!(e.apply(&Stroke::Escape, None, 0), Outcome::Close);
    }

    #[test]
    fn editor_tab_accepts_ghost_then_cycles() {
        let mut e = Editor { query: "fir".into(), selected: 0, cursor: 3, anchor: None };
        // Plain Tab with a ghost accepts the completion.
        e.apply(&Stroke::Tab { back: false }, Some("Firefox"), 3);
        assert_eq!(e.query, "Firefox");
        // Shift+Tab never accepts the ghost; it cycles backwards (wraps).
        let mut e = Editor { query: "fir".into(), selected: 0, cursor: 3, anchor: None };
        e.apply(&Stroke::Tab { back: true }, Some("Firefox"), 3);
        assert_eq!(e.query, "fir");
        assert_eq!(e.selected, 2);
        // Tab with no ghost cycles forward.
        e.apply(&Stroke::Tab { back: false }, None, 3);
        assert_eq!(e.selected, 0);
    }

    #[test]
    fn editor_arrows_wrap_selection() {
        let mut e = Editor { query: "x".into(), selected: 0, cursor: 1, anchor: None };
        e.apply(&Stroke::Up, None, 3);
        assert_eq!(e.selected, 2);
        e.apply(&Stroke::Down, None, 3);
        assert_eq!(e.selected, 0);
        // Zero rows never panics.
        e.apply(&Stroke::Down, None, 0);
        assert_eq!(e.selected, 0);
    }

    #[test]
    fn editor_enter_requests_run() {
        let mut e = Editor { query: "fire".into(), selected: 0, cursor: 4, anchor: None };
        assert_eq!(e.apply(&Stroke::Enter, None, 3), Outcome::Run);
    }

    #[test]
    fn editor_left_right_move_the_cursor_without_selecting() {
        let mut e = Editor { query: "abc".into(), selected: 0, cursor: 3, anchor: None };
        e.apply(&Stroke::Left { shift: false, word: false }, None, 0);
        assert_eq!(e.cursor, 2);
        assert_eq!(e.anchor, None);
        e.apply(&Stroke::Right { shift: false, word: false }, None, 0);
        assert_eq!(e.cursor, 3);
        // Left/Right at the string edges are no-ops, never panic.
        e.apply(&Stroke::Right { shift: false, word: false }, None, 0);
        assert_eq!(e.cursor, 3);
    }

    #[test]
    fn editor_insert_and_backspace_operate_at_the_cursor_not_the_end() {
        // Cursor placed between "ab" and "cd" -- typing/backspacing must act
        // there, not append/trim at the string end (the old hand-rolled bug).
        let mut e = Editor { query: "abcd".into(), selected: 0, cursor: 2, anchor: None };
        e.apply(&Stroke::Text("X".into()), None, 0);
        assert_eq!(e.query, "abXcd");
        assert_eq!(e.cursor, 3);
        e.apply(&Stroke::Backspace { word: false }, None, 0);
        assert_eq!(e.query, "abcd");
        assert_eq!(e.cursor, 2);
    }

    #[test]
    fn editor_ctrl_left_right_jump_by_word() {
        let mut e = Editor { query: "foo bar baz".into(), selected: 0, cursor: 11, anchor: None };
        e.apply(&Stroke::Left { shift: false, word: true }, None, 0);
        assert_eq!(e.cursor, 8); // start of "baz"
        e.apply(&Stroke::Left { shift: false, word: true }, None, 0);
        assert_eq!(e.cursor, 4); // start of "bar"
        e.apply(&Stroke::Right { shift: false, word: true }, None, 0);
        assert_eq!(e.cursor, 7); // end of "bar"
    }

    #[test]
    fn editor_home_end_jump_to_string_edges() {
        let mut e = Editor { query: "hello".into(), selected: 0, cursor: 2, anchor: None };
        e.apply(&Stroke::Home { shift: false }, None, 0);
        assert_eq!(e.cursor, 0);
        e.apply(&Stroke::End { shift: false }, None, 0);
        assert_eq!(e.cursor, 5);
    }

    #[test]
    fn editor_click_at_places_cursor_and_clears_selection() {
        let mut e = Editor { query: "hello world".into(), selected: 3, cursor: 11, anchor: Some(0) };
        e.click_at(5);
        assert_eq!(e.cursor, 5);
        assert_eq!(e.anchor, None);
        assert_eq!(e.selection_range(), None);
        // Selected (result-row index) is untouched -- a text click never
        // changes which row is highlighted.
        assert_eq!(e.selected, 3);
    }

    #[test]
    fn editor_click_at_clamps_past_end_and_snaps_mid_codepoint() {
        let mut e = Editor { query: "café".into(), selected: 0, cursor: 0, anchor: None };
        // Past the end of the (5-byte) string clamps to the length.
        e.click_at(999);
        assert_eq!(e.cursor, e.query.len());
        // 'é' is a 2-byte UTF-8 char starting at byte 3; landing on byte 4
        // (mid-codepoint) snaps back to the char boundary at 3.
        e.click_at(4);
        assert_eq!(e.cursor, 3);
        assert!(e.query.is_char_boundary(e.cursor));
    }

    #[test]
    fn utf16_offset_to_byte_matches_ascii_identity() {
        // Pure ASCII: UTF-16 units, chars, and bytes all coincide.
        assert_eq!(utf16_offset_to_byte("hello", 0), 0);
        assert_eq!(utf16_offset_to_byte("hello", 3), 3);
        assert_eq!(utf16_offset_to_byte("hello", 999), 5);
    }

    #[test]
    fn utf16_offset_to_byte_handles_astral_and_bmp_multibyte_chars() {
        // "café " (BMP 'é', 1 UTF-16 unit / 2 UTF-8 bytes) + an emoji (astral,
        // 2 UTF-16 units / 4 UTF-8 bytes, i.e. a surrogate pair).
        let s = "café \u{1f600}!";
        // Before 'é': 3 UTF-16 units in == byte 3 (matches char count so far).
        assert_eq!(utf16_offset_to_byte(s, 3), 3);
        // After 'é' (1 unit) and the space (1 unit): unit 5 == byte 6 ('é' is
        // 2 bytes, so "caf" (3) + "é" (2) + " " (1) = byte 6).
        assert_eq!(utf16_offset_to_byte(s, 5), 6);
        // Landing inside the emoji's surrogate pair (unit 6, the low
        // surrogate): the loop only returns a `char_indices` boundary, so a
        // target strictly inside a multi-unit char rounds FORWARD to the next
        // char's start (byte 10, the '!'), never splitting the glyph.
        let emoji_end_byte = "café ".len() + "\u{1f600}".len();
        assert_eq!(utf16_offset_to_byte(s, 6), emoji_end_byte);
        // Past the emoji (unit 7, its 2 units consumed): the '!' starts there.
        assert_eq!(utf16_offset_to_byte(s, 7), emoji_end_byte);
        // Past the whole string clamps to its byte length.
        assert_eq!(utf16_offset_to_byte(s, 999), s.len());
    }

    #[test]
    fn editor_shift_left_starts_and_grows_a_selection() {
        let mut e = Editor { query: "hello".into(), selected: 0, cursor: 5, anchor: None };
        e.apply(&Stroke::Left { shift: true, word: false }, None, 0);
        assert_eq!(e.selection_range(), Some((4, 5)));
        e.apply(&Stroke::Left { shift: true, word: false }, None, 0);
        assert_eq!(e.selection_range(), Some((3, 5)));
        // A non-shift move collapses the selection to the cursor.
        e.apply(&Stroke::Right { shift: false, word: false }, None, 0);
        assert_eq!(e.selection_range(), None);
    }

    #[test]
    fn editor_typing_replaces_the_selection() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        e.apply(&Stroke::Text("Goodbye".into()), None, 0);
        assert_eq!(e.query, "Goodbye world");
        assert_eq!(e.cursor, 7);
        assert_eq!(e.anchor, None);
    }

    #[test]
    fn editor_backspace_deletes_the_selection_instead_of_one_char() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        e.apply(&Stroke::Backspace { word: false }, None, 0);
        assert_eq!(e.query, " world");
        assert_eq!(e.cursor, 0);
        assert_eq!(e.anchor, None);
    }

    #[test]
    fn editor_delete_key_removes_forward() {
        let mut e = Editor { query: "abcd".into(), selected: 0, cursor: 1, anchor: None };
        e.apply(&Stroke::Delete { word: false }, None, 0);
        assert_eq!(e.query, "acd");
        assert_eq!(e.cursor, 1);
    }

    #[test]
    fn editor_cursor_stays_on_char_boundaries_with_multibyte_text() {
        // "cafe\u{301}" (e + combining acute) has a multi-byte tail; left/right
        // must never land inside a UTF-8 sequence.
        let s = "caf\u{e9}"; // "caf" + latin small e with acute (2-byte UTF-8)
        let mut e = Editor { query: s.into(), selected: 0, cursor: s.len(), anchor: None };
        e.apply(&Stroke::Left { shift: false, word: false }, None, 0);
        assert!(s.is_char_boundary(e.cursor));
        assert_eq!(&s[e.cursor..], "\u{e9}");
    }

    #[test]
    fn prev_next_word_boundary_skip_whitespace_runs() {
        assert_eq!(prev_word_boundary("foo   bar", 9), 6);
        assert_eq!(next_word_boundary("foo   bar", 0), 3);
        assert_eq!(prev_word_boundary("word", 4), 0);
        assert_eq!(next_word_boundary("word", 0), 4);
    }

    #[test]
    fn ime_commit_inserts_at_cursor() {
        // A plain commit_string (no preceding preedit/delete) inserts at the
        // cursor and advances it, just like typing -- the common case for a
        // single-keystroke CJK candidate accept with no compose sequence.
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: None };
        e.apply_ime_commit(0, 0, Some(""));
        assert_eq!(e.query, "hello world"); // empty commit is a no-op insert
        e.apply_ime_commit(0, 0, Some("!"));
        assert_eq!(e.query, "hello! world");
        assert_eq!(e.cursor, 6);
    }

    #[test]
    fn ime_commit_replaces_a_selection() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        e.apply_ime_commit(0, 0, Some("goodbye"));
        assert_eq!(e.query, "goodbye world");
        assert_eq!(e.cursor, 7);
        assert_eq!(e.anchor, None);
    }

    #[test]
    fn ime_commit_deletes_surrounding_text_before_and_after() {
        // A CJK correction round-trip: the IME asks to delete 2 bytes before and
        // 1 after the cursor (e.g. replacing a mis-composed syllable), then
        // commits the corrected text.
        let mut e = Editor { query: "abXcd".into(), selected: 0, cursor: 3, anchor: None };
        e.apply_ime_commit(2, 1, Some("Y"));
        // delete_before=2 removes "bX" ([1,3)); delete_after=1 removes "c" ([3,4));
        // the combined [1,4) range leaves "a"+"d", "Y" lands at the resulting cursor 1.
        assert_eq!(e.query, "aYd");
        assert_eq!(e.cursor, 2);
    }

    #[test]
    fn ime_commit_delete_only_no_commit_text() {
        let mut e = Editor { query: "hello".into(), selected: 0, cursor: 5, anchor: None };
        e.apply_ime_commit(3, 0, None);
        assert_eq!(e.query, "he");
        assert_eq!(e.cursor, 2);
    }

    #[test]
    fn ime_commit_delete_before_clamps_at_string_start() {
        let mut e = Editor { query: "ab".into(), selected: 0, cursor: 1, anchor: None };
        e.apply_ime_commit(100, 0, Some("Z"));
        assert_eq!(e.query, "Zb");
        assert_eq!(e.cursor, 1);
    }

    #[test]
    fn ime_commit_delete_after_clamps_at_string_end() {
        let mut e = Editor { query: "ab".into(), selected: 0, cursor: 1, anchor: None };
        e.apply_ime_commit(0, 100, Some("Z")); // delete "b" onward, then insert Z
        assert_eq!(e.query, "aZ");
        assert_eq!(e.cursor, 2);
    }

    #[test]
    fn ime_commit_never_splits_a_multibyte_codepoint() {
        // Cursor sits right after the 2-byte "e" (cafe with an acute accent);
        // deleting 1 byte before must clamp back to the FULL codepoint's start,
        // not land mid-UTF-8-sequence (which would panic on the replace_range).
        let s = "caf\u{e9}"; // "caf" + 2-byte e-acute
        let mut e = Editor { query: s.into(), selected: 0, cursor: s.len(), anchor: None };
        e.apply_ime_commit(1, 0, Some("e"));
        assert_eq!(e.query, "cafe");
        assert_eq!(e.cursor, 4);
    }

    #[test]
    fn ime_commit_resets_selected_row() {
        let mut e = Editor { query: String::new(), selected: 3, cursor: 0, anchor: None };
        e.apply_ime_commit(0, 0, Some("x"));
        assert_eq!(e.selected, 0);
    }

    #[test]
    fn selected_text_none_without_a_real_selection() {
        let e = Editor { query: "hello".into(), selected: 0, cursor: 2, anchor: None };
        assert_eq!(e.selected_text(), None);
        // A collapsed anchor==cursor is not a selection either.
        let e = Editor { query: "hello".into(), selected: 0, cursor: 2, anchor: Some(2) };
        assert_eq!(e.selected_text(), None);
    }

    #[test]
    fn selected_text_returns_the_selected_range() {
        let e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        assert_eq!(e.selected_text(), Some("hello"));
    }

    #[test]
    fn cut_returns_text_and_deletes_it() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        assert_eq!(e.selected_text().map(str::to_string), Some("hello".to_string()));
        assert!(e.apply(&Stroke::Cut, None, 0) == Outcome::Redraw);
        assert_eq!(e.query, " world");
        assert_eq!(e.cursor, 0);
        assert_eq!(e.anchor, None);
    }

    #[test]
    fn copy_never_mutates_the_query() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        e.apply(&Stroke::Copy, None, 0);
        assert_eq!(e.query, "hello world");
        assert_eq!(e.anchor, Some(0));
    }

    #[test]
    fn cut_with_nothing_selected_is_a_no_op() {
        let mut e = Editor { query: "hello".into(), selected: 0, cursor: 2, anchor: None };
        e.apply(&Stroke::Cut, None, 0);
        assert_eq!(e.query, "hello");
        assert_eq!(e.cursor, 2);
    }

    #[test]
    fn paste_inserts_at_cursor() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: None };
        e.paste(",");
        assert_eq!(e.query, "hello, world");
        assert_eq!(e.cursor, 6);
    }

    #[test]
    fn paste_replaces_a_selection() {
        let mut e = Editor { query: "hello world".into(), selected: 0, cursor: 5, anchor: Some(0) };
        e.paste("goodbye");
        assert_eq!(e.query, "goodbye world");
        assert_eq!(e.cursor, 7);
        assert_eq!(e.anchor, None);
    }

    #[test]
    fn decode_preedit_cursor_hidden_vs_collapsed() {
        use kobel_wayland::Preedit;
        // A collapsed cursor (begin == end) is what field_row renders an inner
        // caret for; hidden (None, None) renders no inner caret.
        let collapsed = Preedit { text: "n".into(), cursor_begin: Some(1), cursor_end: Some(1) };
        assert_eq!(collapsed.cursor_begin, collapsed.cursor_end);
        let hidden = Preedit { text: "n".into(), cursor_begin: None, cursor_end: None };
        assert!(hidden.cursor_begin.is_none() && hidden.cursor_end.is_none());
    }

    #[test]
    fn ime_cursor_rect_is_within_the_launcher_width_and_has_positive_height() {
        let (x, y, w, h) = ime_cursor_rect(584.0);
        assert_eq!((x, y), (8, 8));
        assert_eq!(w, 584 - 16);
        assert!(h > 0);
    }
}
