//! The dock: one PANEL slab of pinned app tiles + a media tile
//! (ags/widget/Dock.tsx).
//!
//! Layout ports the AGS `box.dock`: horizontal, `dock_pad` padding, spacing 4,
//! a concentric corner radius (`12 + dock_pad - 1`, ags/config.ts tokenCss).
//! Pins come from a fixed default list, overridable once at startup from
//! `~/.config/kobel-shell/dock.json`; the order is ALWAYS the pin order and an
//! unresolved id becomes a labelled placeholder tile rather than being dropped.
//!
//! Per the shell design rule (ags/README.md): window dots are ALWAYS absolute
//! overlays -- the icon owns the geometry, the dots take no layout space. Every
//! size/color comes from [`crate::theme`]; the dot width transition uses
//! [`crate::motion`].
//!
//! The service machinery (apps + mpris) lands in a sibling crate; this file
//! codes against the stable contract types (`AppsSnapshot`/`AppEntry::by_id`,
//! `MediaSnapshot`/`PlayerInfo`) and the `LaunchApp`/`ActivateWindow`/
//! `MinimizeWindow`/`MediaPlayPause` commands.

use std::path::PathBuf;
use std::sync::LazyLock;

use freya_components::image_viewer::ImageViewer;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use torin::prelude::{Alignment, Position, Size};

use kobel_services::{AppsSnapshot, Command, GnoblinSnapshot, GnoblinWindow, MediaSnapshot};

use super::{ICON_APP, ICON_MUSIC, icon};
use crate::manager::{ShellBus, ShellMsg};
use crate::motion::{self, use_spring};
use crate::theme::{self, Tokens};

// ---------------------------------------------------------------------------
// Layout constants (ags/widget/Dock.tsx + ags/style/main.scss dock section)
// ---------------------------------------------------------------------------

/// Gap between dock children (`box.dock spacing={4}`).
const DOCK_SPACING: f32 = 4.0;
/// Separator bar geometry (`.sep { min-width: 1px; min-height: 34px }`).
const SEP_W: f32 = 1.0;
const SEP_H: f32 = 34.0;
/// Media progress bar geometry (`levelbar.mprog 25x3`, `margin-bottom: 6px`).
const MEDIA_PROG_W: f32 = 25.0;
const MEDIA_PROG_H: f32 = 3.0;
const MEDIA_PROG_BOTTOM: f32 = 6.0;
/// Dot bottom inset (`.dots { margin-bottom: 3px }`) and gap (`spacing={3}`).
const DOTS_BOTTOM: f32 = 3.0;
const DOTS_SPACING: f32 = 3.0;
/// Dot widths: resting 4x4, focused pill 12x4, mini edge dot 3x3.
const DOT_REST: f32 = 4.0;
const DOT_PILL: f32 = 12.0;
const DOT_MINI: f32 = 3.0;

/// Default dock pins (ags/widget/Dock.tsx `PINNED`).
pub const DEFAULT_PINS: [&str; 6] = [
    "org.gnome.Ptyxis",
    "org.gnome.Nautilus",
    "firefox",
    "dev.zed.Zed",
    "com.spotify.Client",
    "org.gnome.Settings",
];

// ---------------------------------------------------------------------------
// Pin configuration (read once at startup)
// ---------------------------------------------------------------------------

/// The resolved pin list. Read once from disk at first access, then cached, so
/// main.rs (dock width) and [`dock`] (rendering) always see the identical order.
static PINS: LazyLock<Vec<String>> = LazyLock::new(load_pins);

/// `{ "pins": ["...", ...] }` -- the sole dock config shape.
#[derive(serde::Deserialize)]
struct DockConfig {
    pins: Vec<String>,
}

/// The ordered pin ids for the dock. Deterministic and non-empty.
pub fn pins() -> &'static [String] {
    &PINS
}

/// Parse a `dock.json` body into a non-empty pin list, or `None` to fall back.
fn parse_config(text: &str) -> Option<Vec<String>> {
    serde_json::from_str::<DockConfig>(text)
        .ok()
        .map(|c| c.pins)
        .filter(|pins| !pins.is_empty())
}

/// `$XDG_CONFIG_HOME/kobel-shell/dock.json`, falling back to `~/.config/...`.
fn config_path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(base.join("kobel-shell").join("dock.json"))
}

/// Load the pin list: the config override if present and valid, else the
/// defaults. Any IO/parse failure is non-fatal (the dock never sits empty).
fn load_pins() -> Vec<String> {
    if let Some(path) = config_path()
        && let Ok(text) = std::fs::read_to_string(&path)
        && let Some(pins) = parse_config(&text)
    {
        tracing::info!("[dock] loaded {} pin(s) from {}", pins.len(), path.display());
        return pins;
    }
    DEFAULT_PINS.iter().map(|id| id.to_string()).collect()
}

// ---------------------------------------------------------------------------
// Surface geometry (consumed by main.rs for the Exact surface size)
// ---------------------------------------------------------------------------

/// The dock's concentric corner radius: `12 + dock_pad - 1` (ags/config.ts
/// tokenCss), one step larger than the tiles' radius so corners stay concentric.
pub fn dock_radius(tokens: &Tokens) -> f32 {
    theme::RADIUS_TILE + tokens.dock_pad - 1.0
}

/// Exact dock width: `pin_count + 1` icon tiles (pins + media), one separator,
/// the inter-child spacing, and the dock padding on both sides.
pub fn dock_width(tokens: &Tokens, pin_count: usize) -> u32 {
    let tiles = pin_count as f32 + 1.0; // pins + media tile
    let children = tiles + 1.0; // + the separator
    let content = tiles * tokens.icon + SEP_W + DOCK_SPACING * (children - 1.0);
    (content + 2.0 * tokens.dock_pad).ceil() as u32
}

/// Exact dock height: one icon tile plus the dock padding top and bottom.
pub fn dock_height(tokens: &Tokens) -> u32 {
    (tokens.icon + 2.0 * tokens.dock_pad).ceil() as u32
}

// ---------------------------------------------------------------------------
// Window matching + click model (pure, unit-tested)
// ---------------------------------------------------------------------------

/// Windows belonging to a pinned app, using the same loose matching as
/// [`AppsSnapshot::by_id`]: an exact `app_id` match, else the last dot-component
/// lowercased. Order follows the snapshot so cycling is stable.
fn windows_for<'a>(pin_id: &str, windows: &'a [GnoblinWindow]) -> Vec<&'a GnoblinWindow> {
    let exact: Vec<&GnoblinWindow> = windows.iter().filter(|w| w.app_id == pin_id).collect();
    if !exact.is_empty() {
        return exact;
    }
    let last = pin_id.rsplit('.').next().unwrap_or(pin_id).to_lowercase();
    windows
        .iter()
        .filter(|w| w.app_id.rsplit('.').next().unwrap_or(&w.app_id).to_lowercase() == last)
        .collect()
}

/// Primary-click command (ags/widget/Dock.tsx section 4):
/// no windows -> launch; windows but none focused -> focus the first; focused +
/// many -> focus the NEXT (cycle forward); focused + one -> minimize it.
fn click_command(win_ids: &[String], focused: Option<usize>, launch_id: &str) -> Command {
    if win_ids.is_empty() {
        return Command::LaunchApp(launch_id.to_string());
    }
    match focused {
        None => Command::ActivateWindow(win_ids[0].clone()),
        Some(cur) if win_ids.len() > 1 => {
            Command::ActivateWindow(win_ids[(cur + 1) % win_ids.len()].clone())
        }
        Some(cur) => Command::MinimizeWindow(win_ids[cur].clone()),
    }
}

/// Wheel command: multiple windows -> cycle by direction (forward on a positive
/// delta); a single unfocused window -> focus it; otherwise nothing.
fn wheel_command(win_ids: &[String], focused: Option<usize>, forward: bool) -> Option<Command> {
    let len = win_ids.len();
    if len == 0 {
        return None;
    }
    if len > 1 {
        let base = focused.unwrap_or(0);
        let next = if forward { (base + 1) % len } else { (base + len - 1) % len };
        Some(Command::ActivateWindow(win_ids[next].clone()))
    } else if focused.is_none() {
        Some(Command::ActivateWindow(win_ids[0].clone()))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Icon loading (memoized, svg or raster from raw bytes)
// ---------------------------------------------------------------------------

/// A loaded icon: parsed once from its file. The cache key (its path string)
/// travels with the bytes so a Some(old)->Some(new) path change can never cache
/// stale bytes under the new key.
#[derive(Debug, Clone, PartialEq)]
enum IconData {
    Svg(String, Bytes),
    Raster(String, Bytes),
    /// No path, or the file could not be read -> caller draws a glyph fallback.
    Missing,
}

/// Read an icon file into bytes and classify it svg vs raster by extension
/// (the contract resolves each entry to a concrete `.svg`/`.png` path).
fn load_icon(path: &Option<PathBuf>) -> IconData {
    let Some(path) = path else {
        return IconData::Missing;
    };
    let Ok(bytes) = std::fs::read(path) else {
        return IconData::Missing;
    };
    let key = path.to_string_lossy().into_owned();
    let is_svg = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("svg"));
    let bytes = Bytes::from(bytes);
    if is_svg {
        IconData::Svg(key, bytes)
    } else {
        IconData::Raster(key, bytes)
    }
}

/// One app icon rendered from the resolved icon path. Its own component so the
/// memoized byte-load survives the tile's frequent re-renders (window churn),
/// re-running only when the path itself changes.
#[derive(PartialEq)]
struct AppIcon {
    path: Option<PathBuf>,
    size: f32,
}

impl Component for AppIcon {
    fn render(&self) -> impl IntoElement {
        // React to path changes, and memoize the (blocking) read so window churn
        // never re-reads the file.
        let path = use_reactive(&self.path);
        let data = use_memo(move || load_icon(&path.read()));
        let size = self.size;

        let data = data.read();
        match &*data {
            IconData::Svg(key, bytes) => SvgViewer::new((key.clone(), bytes.clone()))
                .width(Size::px(size))
                .height(Size::px(size))
                .into_element(),
            IconData::Raster(key, bytes) => ImageViewer::new((key.clone(), bytes.clone()))
                .width(Size::px(size))
                .height(Size::px(size))
                .into_element(),
            IconData::Missing => icon(ICON_APP, size, theme::MUT).into_element(),
        }
    }
}

// ---------------------------------------------------------------------------
// Window dots (absolute overlay, sliding 4-dot viewport)
// ---------------------------------------------------------------------------

/// One window dot. Its own component so the width transition owns an isolated,
/// persistent spring; the pill/mini/resting width animates when its role flips.
#[derive(PartialEq)]
struct Dot {
    on: bool,
    mini: bool,
}

impl Component for Dot {
    fn render(&self) -> impl IntoElement {
        let target = if self.on {
            DOT_PILL
        } else if self.mini {
            DOT_MINI
        } else {
            DOT_REST
        };
        let mut width = use_spring(target);
        use_side_effect_with_deps(&(self.on, self.mini), move |_| {
            width.to(target, motion::DOCK_CYCLE);
        });

        let height = if self.mini { DOT_MINI } else { DOT_REST };
        let color = if self.on { theme::LEAF } else { theme::DIM };
        let opacity = if self.mini { 0.7 } else { 1.0 };

        rect()
            .width(Size::px(width.value()))
            .height(Size::px(height))
            .corner_radius(theme::RADIUS_PILL)
            .background(color.rgb())
            .opacity(opacity)
    }
}

/// The dots overlay for a tile: absolute, zero layout footprint, pinned to the
/// tile's bottom-center. Ports the sliding 4-dot viewport (ags/widget/Dock.tsx
/// `Dots`): up to four dots, the focused one a pill, edge minis past four.
fn dots_overlay(total: usize, focused: Option<usize>, tokens: Tokens) -> Element {
    let n = total.min(4);
    // Slide the 4-window viewport so the focused window stays in view.
    let start = if total > 4 {
        let cur = focused.unwrap_or(0) as i64;
        ((cur - 1).max(0) as usize).min(total - 4)
    } else {
        0
    };
    let dots: Vec<Element> = (0..n)
        .map(|i| {
            let idx = start + i;
            let on = focused == Some(idx);
            let mini =
                total > 4 && ((i == 0 && start > 0) || (i == n - 1 && start + 4 < total));
            Dot { on, mini }.into_element()
        })
        .collect();

    rect()
        .position(Position::new_absolute().top(0.0).left(0.0))
        .width(Size::px(tokens.icon))
        .height(Size::px(tokens.icon))
        .horizontal()
        .main_align(Alignment::Center)
        .cross_align(Alignment::End)
        .spacing(DOTS_SPACING)
        .padding((0.0, 0.0, DOTS_BOTTOM, 0.0))
        .interactive(false)
        .children(dots)
        .into_element()
}

// ---------------------------------------------------------------------------
// DockTile
// ---------------------------------------------------------------------------

/// One pinned dock slot: the app icon on a hover-CHIP tile, the absolute dots
/// overlay, and the full click model. Unresolved pins render a labelled
/// PANEL2 placeholder but keep their slot and behaviour.
#[derive(PartialEq)]
struct DockTile {
    pin_id: String,
}

impl Component for DockTile {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let tokens = *use_consume::<State<Tokens>>().read();
        let apps = use_consume::<State<AppsSnapshot>>();
        let gnoblin = use_consume::<State<GnoblinSnapshot>>();
        let mut hovered = use_state(|| false);

        let pin_id = self.pin_id.clone();

        // Resolve the pin -> desktop entry (exact, then loose last-component).
        let (resolved, launch_id, icon_path) = {
            let snap = apps.read();
            match snap.by_id(&pin_id) {
                Some(app) => (true, app.id.clone(), app.icon.clone()),
                None => (false, pin_id.clone(), None),
            }
        };

        // Windows of this app: loose app_id match, for the dots + click model.
        let (total, focused_idx, win_ids) = {
            let snap = gnoblin.read();
            let ws = windows_for(&pin_id, &snap.windows);
            let focused = ws.iter().position(|w| w.focused);
            let ids: Vec<String> = ws.iter().map(|w| w.id.clone()).collect();
            (ids.len(), focused, ids)
        };

        // Icon content: the resolved icon (falling back to a glyph) or, for an
        // unresolved pin, a labelled placeholder that shows the source id.
        let glyph = tokens.icon * 0.7; // AGS pixelSize 31 within the 44 tile
        let content: Element = if resolved {
            AppIcon { path: icon_path, size: glyph }.into_element()
        } else {
            placeholder(&pin_id, tokens)
        };

        let bg: Color = if !resolved {
            theme::PANEL2.rgb().into()
        } else if *hovered.read() {
            theme::CHIP.rgb().into()
        } else {
            Color::TRANSPARENT
        };

        // Event closures. DockTile re-renders on every window change, so each
        // closure captures a fresh snapshot of the app's windows.
        let click_bus = bus.clone();
        let click_ids = win_ids.clone();
        let click_launch = launch_id.clone();
        let mid_bus = bus.clone();
        let mid_launch = launch_id.clone();
        let wheel_bus = bus.clone();
        let wheel_ids = win_ids;

        let mut tile = rect()
            .width(Size::px(tokens.icon))
            .height(Size::px(tokens.icon))
            .corner_radius(theme::RADIUS_TILE)
            .background(bg)
            .center()
            .overflow(Overflow::Clip)
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| {
                click_bus
                    .send(ShellMsg::Service(click_command(&click_ids, focused_idx, &click_launch)));
            })
            .on_mouse_down(move |e: Event<MouseEventData>| {
                // Middle-click always opens a new window (ags: BUTTON_MIDDLE).
                if e.button == Some(MouseButton::Middle) {
                    mid_bus.send(ShellMsg::Service(Command::LaunchApp(mid_launch.clone())));
                }
            })
            .on_wheel(move |e: Event<WheelEventData>| {
                if let Some(cmd) = wheel_command(&wheel_ids, focused_idx, e.delta_y > 0.0) {
                    wheel_bus.send(ShellMsg::Service(cmd));
                }
            })
            .child(content);

        // Dots are an absolute overlay only when the app owns windows.
        if total > 0 {
            tile = tile.child(dots_overlay(total, focused_idx, tokens));
        }

        // TODO(phase-later): right-click context menu (window list + Quit). A
        // layer-surface popup escaping the ~54px dock needs its own surface
        // design; deferred out of this phase.
        tile
    }
}

/// The placeholder body for an unresolved pin: a generic glyph over the source
/// id (clipped to the tile), so an unknown pin is still identifiable.
fn placeholder(pin_id: &str, tokens: Tokens) -> Element {
    rect()
        .width(Size::px(tokens.icon))
        .height(Size::px(tokens.icon))
        .vertical()
        .center()
        .spacing(2.0)
        .overflow(Overflow::Clip)
        .child(icon(ICON_APP, tokens.icon * 0.38, theme::DIM))
        .child(
            label()
                .text(pin_id.to_string())
                .color(theme::DIM.rgb())
                .font_size(theme::FONT_SIZE_MIN)
                .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                .max_lines(1usize)
                .width(Size::px(tokens.icon - 4.0))
                .text_align(TextAlign::Center),
        )
        .into_element()
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

/// The 1x34 CHIP divider before the media tile (`.sep`).
fn separator() -> Element {
    rect()
        .width(Size::px(SEP_W))
        .height(Size::px(SEP_H))
        .background(theme::CHIP.rgb())
        .into_element()
}

// ---------------------------------------------------------------------------
// MediaTile
// ---------------------------------------------------------------------------

/// The media mini-tile at the dock's end: a CHIP tile showing the active
/// player's art (or a music glyph), a LEAF progress bar, and a play/pause
/// click. Dimmed and inert when no player is present.
#[derive(PartialEq)]
struct MediaTile;

impl Component for MediaTile {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let tokens = *use_consume::<State<Tokens>>().read();
        let media = use_consume::<State<MediaSnapshot>>();

        let snap = media.read();
        let (has_player, playing, art, progress) = match snap.player.as_ref() {
            Some(p) => {
                let progress = if p.length_secs > 0.0 {
                    (p.position_secs / p.length_secs).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                (true, p.playing, p.art_path.clone(), progress)
            }
            None => (false, false, None, 0.0),
        };
        drop(snap);

        let glyph = tokens.icon * 0.42; // AGS media pixelSize 18

        // Art if present, else the music glyph. Playing/paused is reflected as a
        // subtle opacity change; no player -> dimmed glyph.
        let inner: Element = match (&art, has_player) {
            (Some(path), _) => ImageViewer::new(path.clone())
                .width(Size::px(tokens.icon))
                .height(Size::px(tokens.icon))
                .into_element(),
            (None, true) => icon(ICON_MUSIC, glyph, theme::MUT).into_element(),
            (None, false) => icon(ICON_MUSIC, glyph, theme::DIM).into_element(),
        };
        let inner_opacity = if !has_player {
            0.5
        } else if playing {
            1.0
        } else {
            0.6
        };

        let mut tile = rect()
            .width(Size::px(tokens.icon))
            .height(Size::px(tokens.icon))
            .corner_radius(theme::RADIUS_TILE)
            .background(theme::CHIP.rgb())
            .center()
            .overflow(Overflow::Clip)
            .child(rect().opacity(inner_opacity).child(inner));

        // Play/pause only when a player exists; no-op otherwise (ags parity).
        if has_player {
            let click_bus = bus.clone();
            tile = tile.on_press(move |_| {
                click_bus.send(ShellMsg::Service(Command::MediaPlayPause));
            });
            tile = tile.child(media_progress(progress, tokens.icon));
        }

        tile
    }
}

/// The 25x3 LEAF progress bar, absolute at the tile's bottom-center. The CHIP
/// track blends into the CHIP tile, so only the LEAF fill reads (LEAF on CHIP).
fn media_progress(progress: f64, tile: f32) -> Element {
    let fill = rect()
        .width(Size::percent((progress * 100.0) as f32))
        .height(Size::px(MEDIA_PROG_H))
        .corner_radius(theme::RADIUS_PILL)
        .background(theme::LEAF.rgb());
    let track = rect()
        .width(Size::px(MEDIA_PROG_W))
        .height(Size::px(MEDIA_PROG_H))
        .corner_radius(theme::RADIUS_PILL)
        .background(theme::CHIP.rgb())
        .child(fill);
    rect()
        .position(Position::new_absolute().top(0.0).left(0.0))
        .width(Size::px(tile))
        .height(Size::px(tile))
        .horizontal()
        .main_align(Alignment::Center)
        .cross_align(Alignment::End)
        .padding((0.0, 0.0, MEDIA_PROG_BOTTOM, 0.0))
        .interactive(false)
        .child(track)
        .into_element()
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// The dock. One PANEL slab: pinned tiles, a separator, then the media tile.
pub fn dock() -> impl IntoElement {
    let tokens = *use_consume::<State<Tokens>>().read();

    let mut children: Vec<Element> = pins()
        .iter()
        .map(|id| DockTile { pin_id: id.clone() }.into_element())
        .collect();
    children.push(separator());
    children.push(MediaTile.into_element());

    let slab = rect()
        .horizontal()
        .cross_align(Alignment::Center)
        .spacing(DOCK_SPACING)
        .padding(tokens.dock_pad)
        .corner_radius(dock_radius(&tokens))
        .background(theme::PANEL.rgb())
        .children(children);

    // Center the slab in the (exactly sized) surface, transparent elsewhere.
    rect().expanded().center().child(slab)
}

// ---------------------------------------------------------------------------
// Tests -- pure logic only (no freya runtime).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn win(id: &str, app_id: &str, focused: bool) -> GnoblinWindow {
        GnoblinWindow {
            id: id.to_string(),
            app_id: app_id.to_string(),
            title: String::new(),
            focused,
            minimized: false,
        }
    }

    #[test]
    fn default_pins_are_the_six_pins() {
        assert_eq!(DEFAULT_PINS.len(), 6);
        assert_eq!(DEFAULT_PINS[0], "org.gnome.Ptyxis");
    }

    #[test]
    fn config_parse_overrides_and_falls_back() {
        let parsed = parse_config(r#"{"pins":["a","b"]}"#).unwrap();
        assert_eq!(parsed, vec!["a".to_string(), "b".to_string()]);
        // Empty list and malformed json both fall back (None).
        assert!(parse_config(r#"{"pins":[]}"#).is_none());
        assert!(parse_config("not json").is_none());
    }

    #[test]
    fn width_matches_the_floating_dock_math() {
        // 6 pins + media = 7 tiles @44 + 1 sep + 4*(8-1) spacing + 2*5 pad.
        assert_eq!(dock_width(&theme::FLOATING, 6), 347);
        assert_eq!(dock_height(&theme::FLOATING), 54);
        // Concentric radius: 12 + dock_pad - 1.
        assert_eq!(dock_radius(&theme::FLOATING), 16.0);
    }

    #[test]
    fn windows_match_exact_then_loosely() {
        let ws = vec![
            win("1", "firefox", false),
            win("2", "org.gnome.Nautilus", true),
        ];
        // Exact.
        assert_eq!(windows_for("firefox", &ws).len(), 1);
        // Loose: pin id differs but shares the last dot component.
        let loose = windows_for("org.mozilla.firefox", &ws);
        assert_eq!(loose.len(), 1);
        assert_eq!(loose[0].id, "1");
        // No match.
        assert!(windows_for("com.spotify.Client", &ws).is_empty());
    }

    #[test]
    fn click_model_maps_each_case() {
        // No windows -> launch.
        match click_command(&[], None, "dev.zed.Zed") {
            Command::LaunchApp(id) => assert_eq!(id, "dev.zed.Zed"),
            other => panic!("expected launch, got {other:?}"),
        }
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        // Windows, none focused -> focus first.
        match click_command(&ids, None, "x") {
            Command::ActivateWindow(id) => assert_eq!(id, "a"),
            other => panic!("expected activate a, got {other:?}"),
        }
        // Focused + many -> cycle forward (wraps).
        match click_command(&ids, Some(2), "x") {
            Command::ActivateWindow(id) => assert_eq!(id, "a"),
            other => panic!("expected activate a, got {other:?}"),
        }
        match click_command(&ids, Some(0), "x") {
            Command::ActivateWindow(id) => assert_eq!(id, "b"),
            other => panic!("expected activate b, got {other:?}"),
        }
        // Focused + single -> minimize it.
        match click_command(&["only".to_string()], Some(0), "x") {
            Command::MinimizeWindow(id) => assert_eq!(id, "only"),
            other => panic!("expected minimize, got {other:?}"),
        }
    }

    #[test]
    fn wheel_model_cycles_and_focuses() {
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        // Forward from focused 0 -> b.
        match wheel_command(&ids, Some(0), true) {
            Some(Command::ActivateWindow(id)) => assert_eq!(id, "b"),
            other => panic!("expected activate b, got {other:?}"),
        }
        // Backward from focused 0 -> c (wraps).
        match wheel_command(&ids, Some(0), false) {
            Some(Command::ActivateWindow(id)) => assert_eq!(id, "c"),
            other => panic!("expected activate c, got {other:?}"),
        }
        // Single unfocused window -> focus it.
        match wheel_command(&["only".to_string()], None, true) {
            Some(Command::ActivateWindow(id)) => assert_eq!(id, "only"),
            other => panic!("expected activate only, got {other:?}"),
        }
        // Single focused window -> nothing.
        assert!(wheel_command(&["only".to_string()], Some(0), true).is_none());
        // No windows -> nothing.
        assert!(wheel_command(&[], None, true).is_none());
    }

    #[test]
    fn icon_missing_when_no_path() {
        assert_eq!(load_icon(&None), IconData::Missing);
        assert_eq!(load_icon(&Some(PathBuf::from("/no/such/icon.svg"))), IconData::Missing);
    }
}
