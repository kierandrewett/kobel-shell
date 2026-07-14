//! The bar: one opaque PANEL slab (ags/widget/Bar.tsx).
//!
//! Layout ports the AGS `centerbox.bar`:
//! - Left: launcher icon button -> Launcher, then the focused-window title.
//! - Center: clock+date button -> Calendar.
//! - Right: status pill (wifi/speaker/battery) -> QuickSettings, bell ->
//!   Drawer, power -> Session.
//!
//! Sizing/colors come from [`crate::theme`]; surface toggles go through the
//! [`ShellBus`]. The status pill's Wi-Fi glyph is the anomaly segment (ags
//! `.net-icon`): AMBER while gnoblin is disconnected. Speaker and battery read
//! audio/battery snapshots; the tray row renders SNI items.

use std::time::Duration;

use async_io::Timer;
use freya_core::elements::image::ImageHandle;
use freya_core::prelude::*;
use freya_engine::prelude::AlphaType;
use torin::prelude::{Alignment, Content, Position, Size};

use kobel_services::{
    AudioSnapshot, BatterySnapshot, Command, GnoblinSnapshot, NetworkSnapshot, NotifdSnapshot,
    TrayIcon, TrayItem, TrayMenu, TrayMenuItem, TrayMenuItemKind, TraySnapshot, TrayToggleKind,
};

use super::chip::{
    HoverShape, TOOLTIP_GAP, TOOLTIP_HEADROOM, hover_button, hover_button_with_tooltip,
    tooltip_bubble, use_hover, use_tooltip_hover,
};
use super::menu::{MenuGlyph, MenuModel, MenuRow, PopupHost, PopupPlacement};
use super::notifications::badge_text;
use super::{
    AppIcon, ICON_APP, ICON_BATTERY, ICON_BELL, ICON_MAGNIFIER, ICON_POWER, ICON_SPEAKER_MUTE,
    ICON_SPEAKER_WAVE, ICON_WIFI, ICON_WIFI_OFF, IconButton, icon,
};
use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::theme;

/// The bar SURFACE's total height: `Tokens.bar_h` plus [`super::chip::
/// TOOLTIP_HEADROOM`] below it, reserved so a hovered tray item's tooltip can
/// render without being clipped to the surface bounds (see [`TrayButton`]'s
/// tooltip wiring). The extra space is invisible (no background, no
/// hit-testing) except when a tray tooltip is showing. `bar()`'s own root is
/// TOP-aligned by default (matching the surface's TOP-only anchor), so the
/// headroom naturally sits below the visible bar with no layout changes here
/// -- window tiling still reserves only `bar_h` (main.rs's `bar_config`
/// exclusive zone), never this headroom.
pub fn bar_surface_height(tokens: &theme::Tokens) -> u32 {
    tokens.bar_h as u32 + TOOLTIP_HEADROOM
}

/// The bar. One opaque slab, `Tokens.bar_h` tall with `Tokens.bar_r` corners and
/// 7px horizontal padding; three flex zones so the clock stays centered.
pub fn bar() -> impl IntoElement {
    let tokens = *use_consume::<State<theme::Tokens>>().read();

    let left = rect()
        .horizontal()
        .width(Size::flex(1.0))
        .cross_align(Alignment::Center)
        .main_align(Alignment::Start)
        .spacing(4.0)
        .child(IconButton {
            icon: ICON_MAGNIFIER,
            icon_size: 15.0,
            target: SurfaceKey::Launcher,
        })
        .child(FocusedTitle);

    let right = rect()
        .horizontal()
        .width(Size::flex(1.0))
        .cross_align(Alignment::Center)
        .main_align(Alignment::End)
        .spacing(4.0)
        .child(TrayRow)
        .child(StatusPill)
        .child(BellButton)
        .child(IconButton {
            icon: ICON_POWER,
            icon_size: 15.0,
            target: SurfaceKey::Session,
        });

    rect()
        .width(Size::fill())
        .height(Size::px(tokens.bar_h))
        .background(theme::PANEL.rgb())
        .corner_radius(tokens.bar_r)
        .padding((0.0, 7.0))
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .child(left)
        .child(ClockButton)
        .child(right)
}

// -------------------------------------------------------------------------
// Focused-window title
// -------------------------------------------------------------------------

/// The focused-window title (ags/widget/Bar.tsx `FocusedTitle`): "desktop" when
/// nothing is focused, the bare title for a lone window, or `Title -- window i/n`
/// when the focused app owns several windows.
#[derive(PartialEq)]
struct FocusedTitle;

impl Component for FocusedTitle {
    fn render(&self) -> impl IntoElement {
        let gnoblin = use_consume::<State<GnoblinSnapshot>>();
        let g = gnoblin.read();

        let text = match g.windows.iter().find(|w| w.focused) {
            None => "desktop".to_string(),
            Some(focused) => {
                let siblings: Vec<&_> =
                    g.windows.iter().filter(|w| w.app_id == focused.app_id).collect();
                if siblings.len() > 1 {
                    let index = siblings
                        .iter()
                        .position(|w| w.id == focused.id)
                        .unwrap_or(0)
                        + 1;
                    format!("{} -- window {}/{}", focused.title, index, siblings.len())
                } else {
                    focused.title.clone()
                }
            }
        };

        label()
            .text(text)
            .color(theme::MUT.rgb())
            .font_size(12.5)
            .max_lines(1usize)
            .text_overflow(TextOverflow::Ellipsis)
            .max_width(Size::px(240.0))
            .margin((0.0, 9.0))
    }
}

// -------------------------------------------------------------------------
// Clock
// -------------------------------------------------------------------------

/// Centered clock+date button -> Calendar. `HH:MM` in the tabular data face plus
/// a short date (ags: `%H:%M` + `%a %-d %b`).
///
/// The wall clock is read on a scope-tied freya task (`spawn`, mirroring the
/// driver-task pattern `freya-animation`'s `hook.rs` uses to advance animated
/// values), never at render time: a `State<(String, String)>` holds the
/// formatted `(time, date)`, seeded once and refreshed every 10s via
/// `async_io::Timer::after` (matching the AGS poll interval), each tick
/// requesting a redraw through `Platform`. This guarantees HH:MM stays correct
/// even when nothing else (input, hover, service snapshot) redraws the bar.
#[derive(PartialEq)]
struct ClockButton;

/// Format the wall clock as `(HH:MM, short date)`.
fn clock_text() -> (String, String) {
    let now = chrono::Local::now();
    (
        now.format("%H:%M").to_string(),
        now.format("%a %-d %b").to_string(),
    )
}

impl Component for ClockButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();

        let clock = use_hook(|| {
            let clock = State::create(clock_text());
            let mut clock_writer = clock;
            let platform = Platform::get();
            spawn(async move {
                loop {
                    Timer::after(Duration::from_secs(10)).await;
                    *clock_writer.write() = clock_text();
                    platform.send(UserEvent::RequestRedraw);
                }
            });
            clock
        });
        let (time, date) = clock.read().clone();

        hover_button(
            hover,
            HoverShape::Row { min_height: 31.0, padding: (0.0, 12.0), spacing: 8.0 },
            theme::RADIUS_BUTTON,
            Color::TRANSPARENT,
            theme::PANEL2.rgb().into(),
            move |_| bus.send(ShellMsg::Toggle(SurfaceKey::Calendar)),
        )
            .child(
                label()
                    .text(time)
                    .color(theme::TX.rgb())
                    .font_size(13.5)
                    .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                    .font_family(theme::FONT_FAMILY_DATA),
            )
            .child(
                label()
                    .text(date)
                    .color(theme::MUT.rgb())
                    .font_size(11.5),
            )
    }
}

// -------------------------------------------------------------------------
// Status pill
// -------------------------------------------------------------------------

/// Status pill -> QuickSettings (ags/widget/Bar.tsx `StatusPill`). A PANEL2 pill
/// carrying the Wi-Fi glyph, the speaker glyph (volume/mute), and, when a battery
/// is present, its percentage. The Wi-Fi glyph is the anomaly segment (ags
/// `.net-icon`): it tints AMBER while gnoblin is disconnected; hover lifts the
/// pill to CHIP.
#[derive(PartialEq)]
struct StatusPill;

impl Component for StatusPill {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let audio = use_consume::<State<AudioSnapshot>>();
        let battery = use_consume::<State<BatterySnapshot>>();
        let gnoblin = use_consume::<State<GnoblinSnapshot>>();
        let network = use_consume::<State<NetworkSnapshot>>();
        let hover = use_hover();

        let (muted, volume) = {
            let a = audio.read();
            (a.muted, a.volume)
        };
        let connected = gnoblin.read().connected;
        let (present, percentage) = {
            let b = battery.read();
            (b.present, b.percentage)
        };

        // Speaker glyph tracks volume/mute; the Wi-Fi glyph is the anomaly
        // segment (ags `.net-icon`): its tint goes AMBER while gnoblin is
        // disconnected. Speaker and battery stay MUT.
        let (net_available, net_enabled) = {
            let n = network.read();
            (n.available, n.enabled)
        };
        let speaker = if muted || volume <= 0.0 {
            ICON_SPEAKER_MUTE
        } else {
            ICON_SPEAKER_WAVE
        };
        let wifi = if net_available && net_enabled {
            ICON_WIFI
        } else {
            ICON_WIFI_OFF
        };
        let net_tint = if connected { theme::MUT } else { theme::AMBER };

        let mut pill = hover_button(
            hover,
            HoverShape::Row { min_height: 30.0, padding: (0.0, 13.0), spacing: 10.0 },
            theme::RADIUS_PILL,
            theme::PANEL2.rgb().into(),
            theme::CHIP.rgb().into(),
            move |_| bus.send(ShellMsg::Toggle(SurfaceKey::QuickSettings)),
        )
        .child(icon(wifi, 16.0, net_tint))
        .child(icon(speaker, 16.0, theme::MUT));

        if present {
            pill = pill.child(
                rect()
                    .horizontal()
                    .cross_align(Alignment::Center)
                    .spacing(6.0)
                    .child(icon(ICON_BATTERY, 16.0, theme::MUT))
                    .child(
                        label()
                            .text(format!("{}%", percentage.round() as i64))
                            .color(theme::TX.rgb())
                            .font_size(11.5)
                            .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                            .font_family(theme::FONT_FAMILY_DATA),
                    ),
            );
        }

        pill
    }
}

// -------------------------------------------------------------------------
// Bell + unread badge
// -------------------------------------------------------------------------

/// The bell button (-> Drawer) with an unread-count badge overlaid at its
/// top-right (ags/widget/Bar.tsx bell badge). The badge is an absolute overlay,
/// so it adds zero layout footprint; it is hidden at zero and capped at `9+`.
#[derive(PartialEq)]
struct BellButton;

impl Component for BellButton {
    fn render(&self) -> impl IntoElement {
        let tokens = *use_consume::<State<theme::Tokens>>().read();
        let notifd = use_consume::<State<NotifdSnapshot>>();
        let count = notifd.read().notifications.len();
        let ctl = tokens.ctl();

        let mut root = rect()
            .width(Size::px(ctl))
            .height(Size::px(ctl))
            .child(IconButton { icon: ICON_BELL, icon_size: 15.0, target: SurfaceKey::Drawer });

        if let Some(text) = badge_text(count) {
            // Absolute overlay pinned to the button's top-right; a leaf pill with
            // 9px/700 ink text. Non-interactive so the click falls to the button.
            let pill = rect()
                .min_width(Size::px(14.0))
                .height(Size::px(14.0))
                .corner_radius(theme::RADIUS_PILL)
                .background(theme::LEAF.rgb())
                .center()
                .padding((0.0, 3.0))
                .child(
                    label()
                        .text(text)
                        .color(theme::INK.rgb())
                        .font_size(9.0)
                        .font_weight(theme::FONT_WEIGHT_BOLD as i32),
                );
            let overlay = rect()
                .position(Position::new_absolute().top(-2.0).right(-2.0))
                .interactive(false)
                .child(pill);
            root = root.child(overlay);
        }

        root
    }
}

// -------------------------------------------------------------------------
// Tray (StatusNotifier items)
// -------------------------------------------------------------------------

/// The tray icons row, placed before the status pill (ags/widget/Bar.tsx tray).
/// One 28px button per StatusNotifierItem; empty (zero footprint) with no items.
#[derive(PartialEq)]
struct TrayRow;

impl Component for TrayRow {
    fn render(&self) -> impl IntoElement {
        let tray = use_consume::<State<TraySnapshot>>();
        let items = tray.read().items.clone();
        let buttons: Vec<Element> =
            items.into_iter().map(|item| TrayButton { item }.into_element()).collect();
        rect()
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(2.0)
            .children(buttons)
    }
}

/// One tray item button: primary-click activates, middle-click secondary-activates
/// (ags menubutton -> our typed Activate/SecondaryActivate commands). Narrower than
/// a normal icon button (28px), matching the AGS tray sizing.
#[derive(PartialEq)]
struct TrayButton {
    item: TrayItem,
}

impl Component for TrayButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let popup = use_consume::<PopupHost>();
        let hover = use_hover();
        let tooltip_hover = use_tooltip_hover();

        let address = self.item.address.clone();
        let mid_bus = bus.clone();
        let mid_address = address.clone();

        // Right-click opens the item's DBusMenu (when it has one). Left-click still
        // activates; middle-click secondary-activates -- the AGS tray gesture set.
        let menu_bus = bus.clone();
        let menu_address = address.clone();
        let menu = self.item.menu.clone();

        // The real StatusNotifierItem ToolTip property (title + description),
        // falling back to the item's title -- both already resolved by the
        // tray service (kobel-services::tray::tooltip_text), just never
        // rendered until now.
        let tooltip_text = self.item.tooltip.clone().unwrap_or_else(|| self.item.title.clone());

        let button = hover_button_with_tooltip(
            hover,
            tooltip_hover,
            HoverShape::Square { side: 28.0 },
            theme::RADIUS_BUTTON,
            Color::TRANSPARENT,
            theme::PANEL2.rgb().into(),
            move |_| bus.send(ShellMsg::Service(Command::ActivateTrayItem(address.clone()))),
        )
        .overflow(Overflow::Clip)
            .on_mouse_down(move |e: Event<MouseEventData>| {
                if e.button == Some(MouseButton::Middle) {
                    mid_bus.send(ShellMsg::Service(Command::SecondaryActivateTrayItem(
                        mid_address.clone(),
                    )));
                }
            })
            .on_secondary_down(move |e: Event<PressEventData>| {
                let Some(menu) = menu.as_ref() else {
                    return;
                };
                // Ask the item to refresh its menu just before we show it, per the
                // com.canonical.dbusmenu AboutToShow contract.
                menu_bus.send(ShellMsg::Service(Command::TrayMenuAboutToShow {
                    address: menu_address.clone(),
                }));
                let model = tray_menu_model(&menu_address, menu, &menu_bus);
                let anchor = press_anchor(&e);
                // The bar sits at the top, so the menu grows downward from the click.
                popup.open(anchor, PopupPlacement::below(), model);
            })
            .child(tray_glyph(&self.item.icon));

        // The tooltip must escape the button's own clip (Overflow::Clip above is
        // for the icon), so it is a sibling in a NON-clipping wrapper, not a
        // child of `button` -- same shape as dock.rs's DockTile tooltip wrapper.
        // The bar sits at the TOP of the screen, so the tooltip grows DOWNWARD
        // from the icon's bottom edge (dock's tooltip grows upward instead).
        let mut wrapper = rect().child(button);
        if tooltip_hover.visible() {
            // Left-anchored (matching dock's tiles): a tray icon can sit
            // close to the bar's right edge, so a very long two-line tooltip
            // could still clip against the screen edge in the worst case --
            // acceptable for now (see main.rs's `bar_config` TOOLTIP_HEADROOM
            // comment); a right-growing xdg_popup-style edge flip would need
            // real popup infrastructure, out of scope here.
            let position = Position::new_absolute().top(28.0 + TOOLTIP_GAP).left(0.0);
            wrapper = wrapper.child(tooltip_bubble(&tooltip_text, position));
        }
        wrapper
    }
}

/// The 1x1 anchor rectangle at a right-click's surface-local position. The
/// compositor slides/flips the popup to keep it on-screen.
fn press_anchor(e: &Event<PressEventData>) -> (i32, i32, i32, i32) {
    match &**e {
        PressEventData::Mouse(m) => (m.global_location.x as i32, m.global_location.y as i32, 1, 1),
        _ => (0, 0, 1, 1),
    }
}

/// Convert an item's [`TrayMenu`] into the shared [`MenuModel`]. Each activatable
/// leaf fires a `TrayMenuClicked` (by id) then the menu closes itself.
fn tray_menu_model(address: &str, menu: &TrayMenu, bus: &ShellBus) -> MenuModel {
    MenuModel::new(tray_rows(address, &menu.items, bus))
}

/// Convert a level of DBusMenu items, recursing into submenus. Hidden items are
/// dropped; separators and toggles map onto the shared row model.
fn tray_rows(address: &str, items: &[TrayMenuItem], bus: &ShellBus) -> Vec<MenuRow> {
    items
        .iter()
        .filter(|it| it.visible)
        .map(|it| tray_row(address, it, bus))
        .collect()
}

/// Convert one DBusMenu item into a [`MenuRow`].
fn tray_row(address: &str, item: &TrayMenuItem, bus: &ShellBus) -> MenuRow {
    if item.kind == TrayMenuItemKind::Separator {
        return MenuRow::Separator;
    }
    if !item.children.is_empty() {
        return MenuRow::Submenu {
            label: item.label.clone(),
            enabled: item.enabled,
            model: MenuModel::new(tray_rows(address, &item.children, bus)),
        };
    }
    let glyph = match item.toggle {
        Some(t) => match t.kind {
            TrayToggleKind::Check => MenuGlyph::Check(t.on),
            TrayToggleKind::Radio => MenuGlyph::Radio(t.on),
        },
        None => MenuGlyph::None,
    };
    let bus = bus.clone();
    let address = address.to_string();
    let item_id = item.id;
    MenuRow::Item {
        label: item.label.clone(),
        glyph,
        enabled: item.enabled,
        danger: false,
        on_activate: EventHandler::new(move |_: ()| {
            bus.send(ShellMsg::Service(Command::TrayMenuClicked {
                address: address.clone(),
                item_id,
            }));
        }),
    }
}

/// Render a tray item's icon: a file/theme path via [`AppIcon`], a raw ARGB32
/// pixmap decoded into a Skia image, or the generic app glyph as a fallback.
fn tray_glyph(tray_icon: &TrayIcon) -> Element {
    match tray_icon {
        TrayIcon::Path(path) => AppIcon { path: Some(path.clone()), size: 18.0 }.into_element(),
        TrayIcon::Pixmap { width, height, argb } => pixmap_image(*width, *height, argb)
            .unwrap_or_else(|| icon(ICON_APP, 18.0, theme::MUT).into_element()),
        TrayIcon::None => icon(ICON_APP, 18.0, theme::MUT).into_element(),
    }
}

/// Decode a StatusNotifier ARGB32 (network byte order: bytes are `[A, R, G, B]`)
/// pixmap into a Skia raster image handle, swizzled to the RGBA8888 layout Skia
/// expects. Returns None on a malformed buffer so the caller can fall back.
fn pixmap_handle(width: u32, height: u32, argb: &[u8]) -> Option<ImageHandle> {
    let expected = (width as usize).checked_mul(height as usize)?.checked_mul(4)?;
    if expected == 0 || argb.len() < expected {
        return None;
    }
    let mut rgba = Vec::with_capacity(expected);
    for px in argb[..expected].chunks_exact(4) {
        // [A, R, G, B] -> [R, G, B, A]
        rgba.push(px[1]);
        rgba.push(px[2]);
        rgba.push(px[3]);
        rgba.push(px[0]);
    }
    ImageHandle::from_rgba(width, height, Bytes::from(rgba), AlphaType::Unpremul)
}

/// Render a tray pixmap as a sized 18px image, or None to fall back to a glyph.
fn pixmap_image(width: u32, height: u32, argb: &[u8]) -> Option<Element> {
    let handle = pixmap_handle(width, height, argb)?;
    // The low-level image() element has no width/height setters (no ContainerSizeExt),
    // so size it through a LayoutData, exactly as ImageViewer does internally.
    let mut layout = LayoutData::default();
    layout.layout.width = Size::px(18.0);
    layout.layout.height = Size::px(18.0);
    Some(image(handle).layout(layout).into_element())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixmap_rejects_malformed_buffers() {
        // Zero dimensions and short buffers never decode.
        assert!(pixmap_handle(0, 0, &[]).is_none());
        assert!(pixmap_handle(2, 2, &[0u8; 4]).is_none()); // needs 2*2*4 = 16 bytes
    }

    #[test]
    fn pixmap_decodes_valid_argb() {
        // A 2x2 opaque-white ARGB32 buffer decodes into a real Skia image.
        let buf = vec![0xFFu8; 2 * 2 * 4];
        assert!(pixmap_handle(2, 2, &buf).is_some());
    }

    #[test]
    fn bar_surface_height_adds_tooltip_headroom_never_changing_visual_height() {
        // Surface height adds chip::TOOLTIP_HEADROOM below the visual bar
        // height, but never changes bar_h itself -- callers still read
        // Tokens.bar_h directly for the visual/exclusive-zone math.
        assert_eq!(
            bar_surface_height(&theme::FLOATING),
            theme::FLOATING.bar_h as u32 + TOOLTIP_HEADROOM
        );
    }
}
