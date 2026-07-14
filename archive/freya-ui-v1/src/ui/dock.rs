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
//! `MediaSnapshot`/`PlayerInfo`), the `LaunchApp`/`MediaPlayPause` kobel-services
//! commands, and the `ActivateWindow`/`MinimizeWindow`/`CloseWindow` `ShellMsg`
//! verbs that go straight to the Wayland host (`zwlr_foreign_toplevel_manager_v1`,
//! not kobel-services -- `org.gnoblin.Shell` never had window D-Bus methods).

use std::path::PathBuf;
use std::sync::LazyLock;

use freya_components::image_viewer::ImageViewer;
use freya_core::prelude::*;
use torin::prelude::{Alignment, Position, Size};

use kobel_services::{AppsSnapshot, Command, GnoblinSnapshot, GnoblinWindow, MediaSnapshot};

use super::chip::{TOOLTIP_GAP, TOOLTIP_HEADROOM, TooltipHover, tooltip_bubble, use_tooltip_hover};
use super::menu::{MenuGlyph, MenuModel, MenuRow, PopupHost, PopupPlacement};
use super::{AppIcon, ICON_APP, ICON_MUSIC, icon};
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

/// Additive per-dock root context: the live, mutable pin list the dock renders
/// from. Seeded from [`pins`] at surface creation (so the initial set matches the
/// width main.rs computed), then edited in-session by the context menu's Pin/Unpin
/// row. A newtype (not a bare `State<Vec<String>>`) so it never collides with the
/// frozen snapshot contexts and reads as intent at the consume site.
#[derive(Clone, Copy, PartialEq)]
pub struct DockPins(pub State<Vec<String>>);

/// Persist the pin list to `dock.json` (the writer counterpart of [`load_pins`]).
/// Best-effort: an IO failure is logged, never fatal. The on-disk change takes
/// effect for the whole dock (width included) on the next launch; in-session the
/// edited [`DockPins`] state re-renders the tiles immediately.
pub fn save_pins(pins: &[String]) {
    let Some(path) = config_path() else {
        tracing::warn!("[dock] cannot locate dock.json to save pins");
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let body = serde_json::json!({ "pins": pins }).to_string();
    match std::fs::write(&path, body) {
        Ok(()) => tracing::info!("[dock] saved {} pin(s) to {}", pins.len(), path.display()),
        Err(e) => tracing::warn!("[dock] failed to save pins to {}: {e}", path.display()),
    }
}

// ---------------------------------------------------------------------------
// Surface geometry (consumed by main.rs for the Exact surface size)
// ---------------------------------------------------------------------------

/// The dock's concentric corner radius: `12 + dock_pad - 1` (ags/config.ts
/// tokenCss), one step larger than the tiles' radius so corners stay concentric.
pub fn dock_radius(tokens: &Tokens) -> f32 {
    theme::RADIUS_TILE + tokens.dock_pad - 1.0
}

/// Exact dock width: `pin_count + 1` icon tiles (pins + media), the pin-group
/// separator (present when there is a fifth pin, AGS `i === 4`), the media
/// separator, the inter-child spacing, and the dock padding on both sides.
pub fn dock_width(tokens: &Tokens, pin_count: usize) -> u32 {
    let tiles = pin_count as f32 + 1.0; // pins + media tile
    let seps = if pin_count > 4 { 2.0 } else { 1.0 };
    let children = tiles + seps;
    let content = tiles * tokens.icon + seps * SEP_W + DOCK_SPACING * (children - 1.0);
    (content + 2.0 * tokens.dock_pad).ceil() as u32
}

/// Exact dock height: one icon tile plus the dock padding top and bottom.
pub fn dock_height(tokens: &Tokens) -> u32 {
    (tokens.icon + 2.0 * tokens.dock_pad).ceil() as u32
}

/// The dock SURFACE's total height: the visual dock height plus
/// [`TOOLTIP_HEADROOM`] above it. The extra space is invisible (no
/// background, no hit-testing) except when a tile's tooltip is showing --
/// see the tooltip wiring in [`DockTile`] and [`dock`]'s bottom-aligned root.
/// Window tiling reserves only [`dock_height`] (main.rs's `dock_config`
/// exclusive zone), never this taller surface height.
pub fn dock_surface_height(tokens: &Tokens) -> u32 {
    dock_height(tokens) + TOOLTIP_HEADROOM
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

/// Primary-click message (ags/widget/Dock.tsx section 4):
/// no windows -> launch; windows but none focused -> focus the first; focused +
/// many -> focus the NEXT (cycle forward); focused + one -> minimize it. Window
/// verbs go straight to the Wayland host (`ShellMsg::ActivateWindow`/
/// `MinimizeWindow`), not through kobel-services -- see gnoblin.rs's module doc.
fn click_command(win_ids: &[String], focused: Option<usize>, launch_id: &str) -> ShellMsg {
    if win_ids.is_empty() {
        return ShellMsg::Service(Command::LaunchApp(launch_id.to_string()));
    }
    match focused {
        None => ShellMsg::ActivateWindow(win_ids[0].clone()),
        Some(cur) if win_ids.len() > 1 => ShellMsg::ActivateWindow(win_ids[(cur + 1) % win_ids.len()].clone()),
        Some(cur) => ShellMsg::MinimizeWindow(win_ids[cur].clone()),
    }
}

/// Wheel message: multiple windows -> cycle by direction (forward on a positive
/// delta); a single unfocused window -> focus it; otherwise nothing.
fn wheel_command(win_ids: &[String], focused: Option<usize>, forward: bool) -> Option<ShellMsg> {
    let len = win_ids.len();
    if len == 0 {
        return None;
    }
    if len > 1 {
        let base = focused.unwrap_or(0);
        let next = if forward {
            (base + 1) % len
        } else {
            (base + len - 1) % len
        };
        Some(ShellMsg::ActivateWindow(win_ids[next].clone()))
    } else if focused.is_none() {
        Some(ShellMsg::ActivateWindow(win_ids[0].clone()))
    } else {
        None
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

/// Pure sliding-viewport math for the 4-dot overlay: which window index the
/// viewport starts at, and how many dots to render (`total.min(4)`). Ports
/// ags/widget/Dock.tsx `Dots`'s window math -- factored out of [`dots_overlay`]
/// (which returns an [`Element`] and so cannot be unit-tested directly) so this
/// index arithmetic gets the same direct test coverage as calendar.rs's
/// `month_grid`/`step_month` (a past real bug lived in exactly this shape of
/// untested slide/clamp arithmetic -- see that module's history).
fn dot_window(total: usize, focused: Option<usize>) -> (usize, usize) {
    let n = total.min(4);
    if total <= 4 {
        return (0, n);
    }
    // Slide the 4-window viewport so the focused window stays in view: centre
    // it one step back from `cur` (so `cur` isn't pinned to the trailing edge),
    // clamped so the viewport never runs past the last 4 windows.
    let cur = focused.unwrap_or(0) as i64;
    let start = ((cur - 1).max(0) as usize).min(total - 4);
    (start, n)
}

/// Whether the dot at viewport position `i` (of `n` visible, `total` real
/// windows, viewport starting at `start`) is the smaller "there are more
/// windows this way" edge indicator rather than a full rest/pill dot: the
/// first dot when the viewport has scrolled past window 0, or the last dot
/// when it hasn't reached the final window yet.
fn dot_is_mini(i: usize, n: usize, start: usize, total: usize) -> bool {
    total > 4 && ((i == 0 && start > 0) || (i == n - 1 && start + 4 < total))
}

/// The dots overlay for a tile: absolute, zero layout footprint, pinned to the
/// tile's bottom-center. Ports the sliding 4-dot viewport (ags/widget/Dock.tsx
/// `Dots`): up to four dots, the focused one a pill, edge minis past four.
fn dots_overlay(total: usize, focused: Option<usize>, tokens: Tokens) -> Element {
    let (start, n) = dot_window(total, focused);
    let dots: Vec<Element> = (0..n)
        .map(|i| {
            let idx = start + i;
            let on = focused == Some(idx);
            let mini = dot_is_mini(i, n, start, total);
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
/// overlay, a hover-delayed name tooltip, and the full click model. Unresolved
/// pins render a labelled PANEL2 placeholder but keep their slot and behaviour.
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
        let popup = use_consume::<PopupHost>();
        let dock_pins = use_consume::<DockPins>();
        let mut hovered = use_state(|| false);
        let tooltip_hover: TooltipHover = use_tooltip_hover();

        let pin_id = self.pin_id.clone();

        // Resolve the pin -> desktop entry (exact, then loose last-component).
        let (resolved, launch_id, icon_path, app_name) = {
            let snap = apps.read();
            match snap.by_id(&pin_id) {
                Some(app) => (true, app.id.clone(), app.icon.clone(), app.name.clone()),
                None => (false, pin_id.clone(), None, pin_id.clone()),
            }
        };

        // Windows of this app: loose app_id match, for the dots, the click model
        // and the context menu's window list.
        let (total, focused_idx, win_ids, windows) = {
            let snap = gnoblin.read();
            let ws = windows_for(&pin_id, &snap.windows);
            let focused = ws.iter().position(|w| w.focused);
            let ids: Vec<String> = ws.iter().map(|w| w.id.clone()).collect();
            let list: Vec<(String, String)> = ws.iter().map(|w| (w.id.clone(), w.title.clone())).collect();
            (ids.len(), focused, ids, list)
        };

        // Icon content: the resolved icon (falling back to a glyph) or, for an
        // unresolved pin, a labelled placeholder that shows the source id.
        let tooltip_name = app_name.clone();
        let glyph = tokens.icon * 0.7; // AGS pixelSize 31 within the 44 tile
        let content: Element = if resolved {
            AppIcon {
                path: icon_path,
                size: glyph,
            }
            .into_element()
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
        let wheel_ids = win_ids.clone();

        // Right-click context menu: Pin/Unpin, window list, Quit (docs/FREYA-PLAN.md
        // dock right-click model). Anchored at the click, growing up out of the dock.
        let menu_bus = bus.clone();
        let menu_pin = pin_id.clone();
        let menu_windows = windows;
        let menu_ids = win_ids;

        let mut icon_tile = rect()
            .width(Size::px(tokens.icon))
            .height(Size::px(tokens.icon))
            .corner_radius(theme::RADIUS_TILE)
            .background(bg)
            .center()
            .overflow(Overflow::Clip)
            .on_pointer_enter(move |_| {
                hovered.set(true);
                tooltip_hover.on_enter();
            })
            .on_pointer_leave(move |_| {
                hovered.set(false);
                tooltip_hover.on_leave();
            })
            .on_press(move |_| {
                click_bus.send(click_command(&click_ids, focused_idx, &click_launch));
            })
            .on_mouse_down(move |e: Event<MouseEventData>| {
                // Middle-click always opens a new window (ags: BUTTON_MIDDLE).
                if e.button == Some(MouseButton::Middle) {
                    mid_bus.send(ShellMsg::Service(Command::LaunchApp(mid_launch.clone())));
                }
            })
            .on_wheel(move |e: Event<WheelEventData>| {
                if let Some(msg) = wheel_command(&wheel_ids, focused_idx, e.delta_y > 0.0) {
                    wheel_bus.send(msg);
                }
            })
            .on_secondary_down(move |e: Event<PressEventData>| {
                let anchor = tile_anchor(&e);
                tracing::info!("[dock] context menu requested for {menu_pin} at {anchor:?}");
                let model = dock_menu_model(
                    &menu_pin,
                    &app_name,
                    &menu_windows,
                    &menu_ids,
                    focused_idx,
                    dock_pins,
                    &menu_bus,
                );
                popup.open(anchor, PopupPlacement::above(), model);
            })
            .child(content);

        // Dots are an absolute overlay only when the app owns windows.
        if total > 0 {
            icon_tile = icon_tile.child(dots_overlay(total, focused_idx, tokens));
        }

        // The tooltip must escape the icon tile's own clip (its `Overflow::Clip`
        // is for the icon's corner rounding), so it is a sibling in a NON-clipping
        // wrapper, not a child of `icon_tile`. The wrapper auto-sizes to the icon
        // tile (its only in-flow child); the tooltip is absolute and takes no
        // layout space either way.
        let mut wrapper = rect().child(icon_tile);
        if tooltip_hover.visible() {
            let position = Position::new_absolute().bottom(tokens.icon + TOOLTIP_GAP).left(0.0);
            wrapper = wrapper.child(tooltip_bubble(&tooltip_name, position));
        }
        wrapper
    }
}

/// The 1x1 anchor rectangle at a right-click's dock-surface-local position. The
/// compositor slides/flips the popup to keep it on-screen.
fn tile_anchor(e: &Event<PressEventData>) -> (i32, i32, i32, i32) {
    match &**e {
        PressEventData::Mouse(m) => (m.global_location.x as i32, m.global_location.y as i32, 1, 1),
        _ => (0, 0, 1, 1),
    }
}

/// Build the dock tile's right-click context menu (docs/FREYA-PLAN.md dock model):
/// an Unpin row (persists to dock.json + re-renders live), a window-list section
/// that activates a window on click (the focused one carries a radio dot), and a
/// danger Quit row that closes every window of the app via the real
/// `zwlr_foreign_toplevel_manager_v1` protocol (`ShellMsg::CloseWindow`, one per
/// window -- previously minimized them instead, a stand-in from before window
/// control moved off the never-existent `org.gnoblin.Shell` D-Bus methods).
fn dock_menu_model(
    pin_id: &str,
    app_name: &str,
    windows: &[(String, String)],
    win_ids: &[String],
    focused: Option<usize>,
    dock_pins: DockPins,
    bus: &ShellBus,
) -> MenuModel {
    let mut rows: Vec<MenuRow> = Vec::new();

    // Dock tiles are always pinned, so Pin/Unpin unpins: drop the id, persist, and
    // mutate the live DockPins so the tile disappears this session too.
    let unpin_pin = pin_id.to_string();
    rows.push(MenuRow::Item {
        label: format!("Unpin {app_name}"),
        glyph: MenuGlyph::None,
        enabled: true,
        danger: false,
        on_activate: EventHandler::new(move |_: ()| {
            let mut state = dock_pins.0;
            let mut list = state.read().clone();
            list.retain(|p| p != &unpin_pin);
            save_pins(&list);
            state.set(list);
        }),
    });

    // Window list: activate on click; the focused window carries a radio dot.
    if !windows.is_empty() {
        rows.push(MenuRow::Separator);
        for (i, (id, title)) in windows.iter().enumerate() {
            let label = if title.trim().is_empty() {
                format!("Window {}", i + 1)
            } else {
                title.clone()
            };
            let bus = bus.clone();
            let id = id.clone();
            rows.push(MenuRow::Item {
                label,
                glyph: MenuGlyph::Radio(focused == Some(i)),
                enabled: true,
                danger: false,
                on_activate: EventHandler::new(move |_: ()| {
                    bus.send(ShellMsg::ActivateWindow(id.clone()));
                }),
            });
        }
    }

    // Quit (danger): close every window of the app for real.
    rows.push(MenuRow::Separator);
    let quit_ids = win_ids.to_vec();
    let quit_bus = bus.clone();
    rows.push(MenuRow::Item {
        label: "Quit".to_string(),
        glyph: MenuGlyph::None,
        enabled: !quit_ids.is_empty(),
        danger: true,
        on_activate: EventHandler::new(move |_: ()| {
            for id in &quit_ids {
                quit_bus.send(ShellMsg::CloseWindow(id.clone()));
            }
        }),
    });

    MenuModel::new(rows)
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

/// The dock. One PANEL slab: pinned tiles (with the prototype's group separator
/// between the fourth and fifth pins), a separator, then the media tile --
/// matching ags/widget/Dock.tsx which inserts `.sep` at `i === 4` and again
/// before the media widget.
pub fn dock() -> impl IntoElement {
    let tokens = *use_consume::<State<Tokens>>().read();
    // Render from the live pin list (seeded from disk, edited by the context menu's
    // Unpin row) rather than the static startup list.
    let pins = use_consume::<DockPins>().0.read().clone();

    let mut children: Vec<Element> = Vec::new();
    for (i, id) in pins.iter().enumerate() {
        if i == 4 {
            children.push(separator());
        }
        children.push(DockTile { pin_id: id.clone() }.into_element());
    }
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

    // Bottom-align the slab (not centered): the surface is now
    // dock_surface_height() tall (visual dock height + TOOLTIP_HEADROOM), so
    // centering would float the slab into the middle of that extra space. The
    // headroom above stays empty except when a hovered tile's tooltip renders
    // into it (see DockTile/tile_tooltip).
    rect()
        .expanded()
        .vertical()
        .main_align(Alignment::End)
        .cross_align(Alignment::Center)
        .child(slab)
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
        // 6 pins + media = 7 tiles @44 + 2 seps + 4*(9-1) spacing + 2*5 pad.
        assert_eq!(dock_width(&theme::FLOATING, 6), 352);
        // 4 pins or fewer: only the media separator.
        assert_eq!(dock_width(&theme::FLOATING, 4), 5 * 44 + 1 + 4 * 5 + 10);
        assert_eq!(dock_height(&theme::FLOATING), 54);
        // Surface height adds TOOLTIP_HEADROOM above the visual dock height,
        // but never changes the visual height/exclusive-zone math itself.
        assert_eq!(dock_surface_height(&theme::FLOATING), 54 + TOOLTIP_HEADROOM);
        // Concentric radius: 12 + dock_pad - 1.
        assert_eq!(dock_radius(&theme::FLOATING), 16.0);
    }

    #[test]
    fn windows_match_exact_then_loosely() {
        let ws = vec![win("1", "firefox", false), win("2", "org.gnome.Nautilus", true)];
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
            ShellMsg::Service(Command::LaunchApp(id)) => assert_eq!(id, "dev.zed.Zed"),
            other => panic!("expected launch, got {other:?}"),
        }
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        // Windows, none focused -> focus first.
        match click_command(&ids, None, "x") {
            ShellMsg::ActivateWindow(id) => assert_eq!(id, "a"),
            other => panic!("expected activate a, got {other:?}"),
        }
        // Focused + many -> cycle forward (wraps).
        match click_command(&ids, Some(2), "x") {
            ShellMsg::ActivateWindow(id) => assert_eq!(id, "a"),
            other => panic!("expected activate a, got {other:?}"),
        }
        match click_command(&ids, Some(0), "x") {
            ShellMsg::ActivateWindow(id) => assert_eq!(id, "b"),
            other => panic!("expected activate b, got {other:?}"),
        }
        // Focused + single -> minimize it.
        match click_command(&["only".to_string()], Some(0), "x") {
            ShellMsg::MinimizeWindow(id) => assert_eq!(id, "only"),
            other => panic!("expected minimize, got {other:?}"),
        }
    }

    #[test]
    fn wheel_model_cycles_and_focuses() {
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        // Forward from focused 0 -> b.
        match wheel_command(&ids, Some(0), true) {
            Some(ShellMsg::ActivateWindow(id)) => assert_eq!(id, "b"),
            other => panic!("expected activate b, got {other:?}"),
        }
        // Backward from focused 0 -> c (wraps).
        match wheel_command(&ids, Some(0), false) {
            Some(ShellMsg::ActivateWindow(id)) => assert_eq!(id, "c"),
            other => panic!("expected activate c, got {other:?}"),
        }
        // Single unfocused window -> focus it.
        match wheel_command(&["only".to_string()], None, true) {
            Some(ShellMsg::ActivateWindow(id)) => assert_eq!(id, "only"),
            other => panic!("expected activate only, got {other:?}"),
        }
        // Single focused window -> nothing.
        assert!(wheel_command(&["only".to_string()], Some(0), true).is_none());
        // No windows -> nothing.
        assert!(wheel_command(&[], None, true).is_none());
    }

    #[test]
    fn dot_window_shows_everything_at_or_under_four_windows() {
        // total <= 4 never slides: the viewport always starts at 0 and shows
        // every window, regardless of which one is focused.
        assert_eq!(dot_window(0, None), (0, 0));
        assert_eq!(dot_window(1, Some(0)), (0, 1));
        assert_eq!(dot_window(4, None), (0, 4));
        assert_eq!(dot_window(4, Some(3)), (0, 4));
    }

    #[test]
    fn dot_window_slides_to_keep_the_focused_window_in_view() {
        // 6 windows (indices 0..6): the viewport is 4 wide, starting one step
        // behind the focused window so it's never pinned to the trailing edge,
        // but never sliding past showing the final 4 (start caps at total-4).
        assert_eq!(dot_window(6, None), (0, 4), "unfocused defaults to the start");
        assert_eq!(dot_window(6, Some(0)), (0, 4));
        assert_eq!(dot_window(6, Some(1)), (0, 4), "cur-1 clamps at 0, not negative");
        assert_eq!(dot_window(6, Some(2)), (1, 4));
        assert_eq!(dot_window(6, Some(3)), (2, 4), "start caps at total-4 = 2");
        assert_eq!(dot_window(6, Some(4)), (2, 4), "still capped: showing the last 4");
        assert_eq!(dot_window(6, Some(5)), (2, 4), "last window: viewport shows [2,3,4,5]");
    }

    #[test]
    fn dot_window_five_windows_boundary() {
        // The smallest total that actually slides (total-4 = 1, so there is
        // exactly one possible slid position beyond the rest position).
        assert_eq!(dot_window(5, Some(0)), (0, 4));
        assert_eq!(dot_window(5, Some(4)), (1, 4), "start caps at total-4 = 1");
    }

    #[test]
    fn dot_is_mini_marks_only_the_scrolled_edge() {
        // total <= 4: no edge is ever mini, there's nothing hidden to hint at.
        assert!(!dot_is_mini(0, 4, 0, 4));
        assert!(!dot_is_mini(3, 4, 0, 4));

        // total > 4, viewport at the rest position (start = 0): only the LAST
        // dot is mini (there are more windows after, none before).
        assert!(!dot_is_mini(0, 4, 0, 6), "first dot: nothing scrolled off before it");
        assert!(!dot_is_mini(1, 4, 0, 6), "middle dots are never mini");
        assert!(!dot_is_mini(2, 4, 0, 6));
        assert!(
            dot_is_mini(3, 4, 0, 6),
            "last dot: 2 more windows exist past the viewport"
        );

        // Viewport fully slid to the end (start = total-4): only the FIRST dot
        // is mini now (windows exist before; none hidden after).
        assert!(dot_is_mini(0, 4, 2, 6));
        assert!(
            !dot_is_mini(3, 4, 2, 6),
            "start+4 == total: nothing hidden past the last dot"
        );

        // Viewport in the middle: BOTH edges are mini simultaneously.
        assert!(dot_is_mini(0, 4, 1, 6));
        assert!(dot_is_mini(3, 4, 1, 6));
    }

    #[test]
    fn dot_window_and_mini_agree_on_a_real_slide_sequence() {
        // End-to-end sanity: walk focus across 7 windows and confirm the mini
        // flags on the viewport dot_window actually returns are self-consistent
        // (exactly the windows genuinely off-screen get flagged).
        for focused in 0..7 {
            let (start, n) = dot_window(7, Some(focused));
            assert_eq!(n, 4);
            assert!(start <= 3, "start must never exceed total-4=3, got {start}");
            let hidden_before = start > 0;
            let hidden_after = start + 4 < 7;
            assert_eq!(dot_is_mini(0, n, start, 7), hidden_before);
            assert_eq!(dot_is_mini(n - 1, n, start, 7), hidden_after);
            // The focused window is always inside the visible viewport.
            assert!(
                (start..start + n).contains(&focused),
                "focused window {focused} must stay visible, viewport was [{start},{})",
                start + n
            );
        }
    }
}
