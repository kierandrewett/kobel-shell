//! The bar: one opaque PANEL slab (ags/widget/Bar.tsx).
//!
//! Layout ports the AGS `centerbox.bar`:
//!   - Left:  launcher icon button -> Launcher, then the focused-window title.
//!   - Center: clock+date button -> Calendar.
//!   - Right: status pill (speaker/battery) -> QuickSettings, bell -> Drawer,
//!            power -> Session.
//!
//! Sizing/colors come from [`crate::theme`]; surface toggles go through the
//! [`ShellBus`]. Wi-Fi glyph and tray are intentionally omitted: kobel-services
//! ships gnoblin/audio/battery only, so there is no network/tray state to read
//! yet (see the module TODOs).

use freya_core::prelude::*;
use torin::prelude::{Alignment, Content, Size};

use kobel_services::{AudioSnapshot, BatterySnapshot, GnoblinSnapshot};

use super::{
    IconButton, ICON_BATTERY, ICON_BELL, ICON_MAGNIFIER, ICON_POWER, ICON_SPEAKER_MUTE,
    ICON_SPEAKER_WAVE, icon,
};
use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::theme;

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
        .child(StatusPill)
        .child(IconButton {
            icon: ICON_BELL,
            icon_size: 15.0,
            target: SurfaceKey::Drawer,
        })
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
/// NOTE: the time is read from the wall clock at render, so it is exact on every
/// redraw (input, hover, service snapshot). A guaranteed periodic self-refresh
/// (AGS polls every 10s) needs a freya-task wall-clock timer -- see the module
/// TODO on the missing async timer dependency.
#[derive(PartialEq)]
struct ClockButton;

impl Component for ClockButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let mut hovered = use_state(|| false);

        let now = chrono::Local::now();
        let time = now.format("%H:%M").to_string();
        let date = now.format("%a %-d %b").to_string();

        let bg: Color = if *hovered.read() {
            theme::PANEL2.rgb().into()
        } else {
            Color::TRANSPARENT
        };

        rect()
            .horizontal()
            .min_height(Size::px(31.0))
            .padding((0.0, 12.0))
            .corner_radius(theme::RADIUS_BUTTON)
            .background(bg)
            .cross_align(Alignment::Center)
            .spacing(8.0)
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| bus.send(ShellMsg::Toggle(SurfaceKey::Calendar)))
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
/// carrying the speaker glyph (volume/mute) and, when a battery is present, its
/// percentage. The glyph tints AMBER while gnoblin is disconnected; hover lifts
/// the pill to CHIP.
#[derive(PartialEq)]
struct StatusPill;

impl Component for StatusPill {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let audio = use_consume::<State<AudioSnapshot>>();
        let battery = use_consume::<State<BatterySnapshot>>();
        let gnoblin = use_consume::<State<GnoblinSnapshot>>();
        let mut hovered = use_state(|| false);

        let (muted, volume) = {
            let a = audio.read();
            (a.muted, a.volume)
        };
        let connected = gnoblin.read().connected;
        let (present, percentage) = {
            let b = battery.read();
            (b.present, b.percentage)
        };

        // Speaker glyph tracks volume/mute; the tint (not the glyph) carries the
        // gnoblin-disconnected anomaly as AMBER.
        let speaker = if muted || volume <= 0.0 {
            ICON_SPEAKER_MUTE
        } else {
            ICON_SPEAKER_WAVE
        };
        let tint = if connected { theme::MUT } else { theme::AMBER };

        let bg: Color = if *hovered.read() {
            theme::CHIP.rgb().into()
        } else {
            theme::PANEL2.rgb().into()
        };

        let mut pill = rect()
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(10.0)
            .padding((0.0, 13.0))
            .min_height(Size::px(30.0))
            .corner_radius(theme::RADIUS_PILL)
            .background(bg)
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| bus.send(ShellMsg::Toggle(SurfaceKey::QuickSettings)))
            .child(icon(speaker, 16.0, tint));

        if present {
            pill = pill.child(
                rect()
                    .horizontal()
                    .cross_align(Alignment::Center)
                    .spacing(6.0)
                    .child(icon(ICON_BATTERY, 16.0, tint))
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
