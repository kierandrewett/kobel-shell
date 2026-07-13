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
//!   - `:` prefix  -> typed gnoblin command rows ([`command_rows`]).
//!   - `=`/math    -> a calculator row backed by a tiny recursive-descent
//!                    parser ([`calc`]), never `eval`, no new deps.
//!   - otherwise   -> best-match slot + Apps (fuzzy + frecency) + Actions +
//!                    Web ([`results`]).
//!
//! Key editing is factored into [`classify_key`] (host key -> [`Stroke`]) and
//! [`Editor::apply`] (pure text/selection edits), so the whole edit path is
//! testable without a Freya runtime. Colors/sizes come from [`crate::theme`];
//! the reveal opacity multiplies in from [`OpenProgress`] like panels.rs.

use std::path::PathBuf;

use freya_core::prelude::*;
use torin::prelude::{Alignment, Content, Size};

use kobel_services::{AppEntry, AppsSnapshot, Command, SessionVerb};

use super::fuzzy::{Frecency, fuzzy};
use super::panels::{KeyFeed, OpenProgress};
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
/// Block caret geometry: a filled LEAF block a glyph wide at the cursor.
const CARET_W: f32 = 8.0;
const CARET_H: f32 = 18.0;
/// Result-row icon frame (`.ri` 28x28 with a 24px glyph inside).
const RI_FRAME: f32 = 28.0;
const RI_GLYPH: f32 = 20.0;
/// Empty-state tile geometry (`.tile` min-width 64, icon chip 42, glyph 30).
const TILE_W: f32 = 72.0;
const TILE_GLYPH: f32 = 30.0;

/// Faux placeholder shown when the query is empty.
const PLACEHOLDER: &str = "Search apps, actions...";

// ---------------------------------------------------------------------------
// Keystroke classification (pure; testable without keyboard_types names)
// ---------------------------------------------------------------------------

/// A classified keystroke: exactly the keys the launcher acts on. Decoded from
/// a host key by [`classify_key`] so [`Editor`] never touches key enums.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Stroke {
    /// A typed character (no ctrl/alt/super chord; shift is fine).
    Text(String),
    /// Backspace; `word` = ctrl held (delete the trailing word).
    Backspace { word: bool },
    /// Escape.
    Escape,
    /// Tab; `back` = shift held (cycle backwards / never accept ghost).
    Tab { back: bool },
    /// Selection up (ArrowUp or Ctrl+p).
    Up,
    /// Selection down (ArrowDown or Ctrl+n).
    Down,
    /// Enter (run the selected row).
    Enter,
    /// A key the launcher ignores.
    Ignore,
}

/// Classify a host key into a [`Stroke`]. Named keys win first (layout
/// independent); Ctrl+n/p match the physical code because the key value under
/// Ctrl is usually a control char or Unidentified; plain characters become
/// text unless a ctrl/alt/super chord is held.
pub(crate) fn classify_key(key: &Key, code: &Code, mods: Modifiers) -> Stroke {
    if let Key::Named(named) = key {
        match named {
            NamedKey::Escape => return Stroke::Escape,
            NamedKey::Tab => return Stroke::Tab { back: mods.shift() },
            NamedKey::Enter => return Stroke::Enter,
            NamedKey::Backspace => return Stroke::Backspace { word: mods.ctrl() },
            NamedKey::ArrowUp => return Stroke::Up,
            NamedKey::ArrowDown => return Stroke::Down,
            _ => {}
        }
    }
    if mods.ctrl() {
        match code {
            Code::KeyN => return Stroke::Down,
            Code::KeyP => return Stroke::Up,
            _ => {}
        }
    }
    if !mods.ctrl() && !mods.alt() && !mods.meta() {
        if let Key::Character(s) = key {
            if !s.is_empty() {
                return Stroke::Text(s.clone());
            }
        }
    }
    Stroke::Ignore
}

// ---------------------------------------------------------------------------
// Pure editor (query text + selection index)
// ---------------------------------------------------------------------------

/// The editable launcher state: query text plus the selected flat-row index.
/// Kept free of Freya types so the whole edit path is unit-testable.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Editor {
    pub query: String,
    pub selected: usize,
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
                self.query.push_str(s);
                self.selected = 0;
                Outcome::Redraw
            }
            Stroke::Backspace { word } => {
                if *word {
                    clear_last_word(&mut self.query);
                } else {
                    self.query.pop();
                }
                self.selected = 0;
                Outcome::Redraw
            }
            Stroke::Escape => {
                if self.query.is_empty() {
                    Outcome::Close
                } else {
                    self.query.clear();
                    self.selected = 0;
                    Outcome::Redraw
                }
            }
            Stroke::Tab { back } => {
                if !*back {
                    if let Some(g) = ghost {
                        self.query = g.to_string();
                        self.selected = 0;
                        return Outcome::Redraw;
                    }
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
}

/// Delete the trailing whitespace then the trailing word (Ctrl+Backspace).
fn clear_last_word(q: &mut String) {
    while q.chars().next_back().is_some_and(char::is_whitespace) {
        q.pop();
    }
    while q.chars().next_back().is_some_and(|c| !c.is_whitespace()) {
        q.pop();
    }
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

        let mut query = use_state(String::new);
        let mut selected = use_state(|| 0usize);
        let frecency = use_state(Frecency::load);

        // Reveal opacity + open-state (subscribes this scope to the spring).
        let p = *progress.0.read();
        let opacity = p.clamp(0.0, 1.0);
        let open_now = p > 0.01;

        // Reset the query/selection on the closed -> open transition.
        use_side_effect_with_deps(&open_now, move |&now| {
            if now {
                query.set(String::new());
                selected.set(0);
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
                let q = query.peek().clone();
                let sections = {
                    let snap = apps.peek();
                    let frec = frecency.peek();
                    results(&q, &snap, &frec)
                };
                let rows: usize = sections.iter().map(|s| s.rows.len()).sum();
                let ghost = ghost_for(&q, &sections);
                let mut editor = Editor { query: q, selected: *selected.peek() };
                match editor.apply(&stroke, ghost.as_deref(), rows) {
                    Outcome::Redraw => {
                        query.set(editor.query);
                        selected.set(editor.selected);
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

        // Providers for display (same pure path the key effect uses).
        let q = query.read();
        let sel = *selected.read();
        let snap = apps.read();
        let sections = results(&q, &snap, &frecency.peek());
        let ghost = ghost_for(&q, &sections);

        let field = field_row(&q, ghost.as_deref());

        let body: Element = if q.trim().is_empty() {
            empty_state(&snap, frecency)
        } else {
            results_list(&sections, sel, &bus, frecency, query, selected)
        };

        let sheet = rect()
            .width(Size::fill())
            .background(theme::PANEL.rgb())
            .corner_radius(theme::RADIUS_SHEET)
            .padding(8.0)
            .vertical()
            .spacing(6.0)
            .child(field)
            .child(body)
            .child(footer());

        rect().expanded().opacity(opacity).child(sheet)
    }
}

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------

/// The search field: magnifier, the query text with a block caret, the faux
/// placeholder (empty) or the DIM ghost suffix, and a `super` kbd chip.
fn field_row(query: &str, ghost: Option<&str>) -> Element {
    let caret = rect()
        .width(Size::px(CARET_W))
        .height(Size::px(CARET_H))
        .corner_radius(2.0)
        .background(theme::LEAF.rgb());

    let mut text = rect()
        .horizontal()
        .width(Size::flex(1.0))
        .cross_align(Alignment::Center)
        .height(Size::px(CARET_H + 4.0))
        .overflow(Overflow::Clip);

    if query.is_empty() {
        text = text.child(caret).child(
            label()
                .text(PLACEHOLDER)
                .color(theme::DIM.rgb())
                .font_size(FIELD_FONT),
        );
    } else {
        text = text
            .child(
                label()
                    .text(query.to_string())
                    .color(theme::TX.rgb())
                    .font_size(FIELD_FONT)
                    .max_lines(1usize),
            )
            .child(caret);
        if let Some(g) = ghost {
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
        .padding((3.0, 12.0))
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
        let mut e = Editor { query: "hello world  ".into(), selected: 0 };
        e.apply(&Stroke::Backspace { word: true }, None, 0);
        assert_eq!(e.query, "hello ");
        e.apply(&Stroke::Backspace { word: true }, None, 0);
        assert_eq!(e.query, "");
    }

    #[test]
    fn editor_escape_clears_then_closes() {
        let mut e = Editor { query: "abc".into(), selected: 2 };
        assert_eq!(e.apply(&Stroke::Escape, None, 5), Outcome::Redraw);
        assert_eq!(e.query, "");
        assert_eq!(e.selected, 0);
        assert_eq!(e.apply(&Stroke::Escape, None, 0), Outcome::Close);
    }

    #[test]
    fn editor_tab_accepts_ghost_then_cycles() {
        let mut e = Editor { query: "fir".into(), selected: 0 };
        // Plain Tab with a ghost accepts the completion.
        e.apply(&Stroke::Tab { back: false }, Some("Firefox"), 3);
        assert_eq!(e.query, "Firefox");
        // Shift+Tab never accepts the ghost; it cycles backwards (wraps).
        let mut e = Editor { query: "fir".into(), selected: 0 };
        e.apply(&Stroke::Tab { back: true }, Some("Firefox"), 3);
        assert_eq!(e.query, "fir");
        assert_eq!(e.selected, 2);
        // Tab with no ghost cycles forward.
        e.apply(&Stroke::Tab { back: false }, None, 3);
        assert_eq!(e.selected, 0);
    }

    #[test]
    fn editor_arrows_wrap_selection() {
        let mut e = Editor { query: "x".into(), selected: 0 };
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
        let mut e = Editor { query: "fire".into(), selected: 0 };
        assert_eq!(e.apply(&Stroke::Enter, None, 3), Outcome::Run);
    }
}
