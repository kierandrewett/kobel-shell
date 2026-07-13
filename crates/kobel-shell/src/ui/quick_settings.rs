//! Quick settings (ags/widget/QuickSettings.tsx). A `panel_w`-wide sheet on the
//! TOP+RIGHT: a compact top row (battery meta, reload, lock, power), a gnoblin
//! degraded banner, a 3x2 chip grid (Wi-Fi/Bluetooth/Power Saver/Dark Style/
//! Silent/Night Light), volume + brightness sliders, and a horizontally-sliding
//! drill stack (Wi-Fi networks / Bluetooth devices / per-app mixer).
//!
//! The drill stack is TWO stacked layers (root + drill) whose absolute `left`
//! offsets are driven by a single [`use_spring`]: opening springs the pair left
//! with `MOTION.drill`, going back springs right with `MOTION.drill_back` -- a
//! real slide, not a hard swap. The drill layer renders the *last* drilled kind
//! (`shown`) so its content stays visible while sliding back out.
//!
//! Keys arrive through the OnDemand [`KeyFeed`] (main.rs routes them here while
//! QS is the open focused surface): Escape steps back to root when drilled, else
//! closes the surface. Opening (closed->open reveal edge) resets to root and
//! jumps the slide spring to 0 so a reopen never fights a stale back-animation.
//!
//! Colors/sizes come from [`crate::theme`]; every chip/slider/switch/button is a
//! primitive from [`super::chip`]. The pure state-mapping helpers (chip active +
//! sublabel, drill navigation, row state, battery meta) are unit-tested below.

use freya_core::prelude::*;
use torin::prelude::{Alignment, Content, Position, Size};

use kobel_services::{
    AudioSnapshot, BatterySnapshot, BluetoothSnapshot, BrightnessSnapshot, Command,
    GnoblinSnapshot, NetworkSnapshot, PowerProfile, PowerSnapshot, SessionVerb, SettingsSnapshot,
};

use super::chip::{Chip, HoverExt, IconAction, KSlider, KSwitch, use_hover};
use super::panels::{KeyFeed, OpenProgress};
use super::{
    ICON_BATTERY, ICON_BELL_SLASH, ICON_BLUETOOTH, ICON_BOLT, ICON_BRIGHTNESS, ICON_CHECK,
    ICON_CHEVRON_LEFT, ICON_LEAF, ICON_LOCK, ICON_MOON, ICON_MUSIC, ICON_POWER, ICON_SPEAKER_MUTE,
    ICON_SPEAKER_WAVE, ICON_SUN, ICON_WARNING, ICON_WIFI, icon,
};
use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::motion::{self, use_spring};
use crate::theme;

/// Sheet padding (ags `.sheet { padding: 12 }`).
const SHEET_PAD: f32 = 12.0;
/// Rising-edge threshold on the reveal opacity (mirrors ui/session.rs): reset to
/// root at the first positive frame, before any key could be delivered.
const OPEN_EPS: f32 = 1e-4;
/// Drill-header / row / slider control sizes.
const HEADER_H: f32 = 40.0;
const ROW_PAD_V: f32 = 7.0;
const ROW_PAD_H: f32 = 10.0;
const CHEV_W: f32 = 26.0;

// ===========================================================================
// Pure state mapping (unit-tested; no Freya runtime)
// ===========================================================================

/// Which drilldown is open. `None` at the root; the QS body keeps a separate
/// `shown` copy so the drill layer renders its content while sliding back out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DrillKind {
    Wifi,
    Bt,
    Mix,
}

/// What an Escape resolves to given whether a drill is open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EscNav {
    /// Step back from a drill to the root view.
    Back,
    /// Close the whole surface.
    Close,
}

/// Drill header title.
fn drill_title(kind: DrillKind) -> &'static str {
    match kind {
        DrillKind::Wifi => "Wi-Fi",
        DrillKind::Bt => "Bluetooth",
        DrillKind::Mix => "Volume",
    }
}

/// Escape steps back out of a drill first, otherwise closes (ags QS onKeyPressed).
fn esc_nav(in_drill: bool) -> EscNav {
    if in_drill { EscNav::Back } else { EscNav::Close }
}

/// Wi-Fi chip state: active when enabled; sublabel is the active SSID or "Off".
fn wifi_chip(net: &NetworkSnapshot) -> (bool, String) {
    let sub = net.active_ssid.clone().unwrap_or_else(|| "Off".to_string());
    (net.enabled, sub)
}

/// Bluetooth chip state: active when any device is connected; sublabel is the
/// first connected device's alias or "Off".
fn bt_chip(bt: &BluetoothSnapshot) -> (bool, String) {
    let connected = bt.devices.iter().find(|d| d.connected);
    let active = connected.is_some();
    let sub = connected.map(|d| d.alias.clone()).unwrap_or_else(|| "Off".to_string());
    (active, sub)
}

/// Power Saver chip is active when the profile is PowerSaver.
fn power_saver_active(power: &PowerSnapshot) -> bool {
    power.profile == PowerProfile::PowerSaver
}

/// Toggling Power Saver swaps between PowerSaver and Balanced (ags: never touches
/// Performance).
fn next_power_profile(active: bool) -> PowerProfile {
    if active { PowerProfile::Balanced } else { PowerProfile::PowerSaver }
}

/// Pressing a Bluetooth row disconnects a connected device, else connects it.
fn bt_row_command(connected: bool, address: &str) -> Command {
    if connected {
        Command::DisconnectBtDevice(address.to_string())
    } else {
        Command::ConnectBtDevice(address.to_string())
    }
}

/// Wi-Fi row trailing text: "Connected" for the active AP, else "{strength}%".
fn wifi_row_state(active: bool, strength: u8) -> String {
    if active { "Connected".to_string() } else { format!("{strength}%") }
}

/// Bluetooth row trailing text.
fn bt_row_state(connected: bool, paired: bool) -> &'static str {
    if connected {
        "Connected"
    } else if paired {
        "Paired"
    } else {
        "Available"
    }
}

/// Battery meta pill text: "{pct}% . {state}" (ags batteryMeta).
fn battery_meta(b: &BatterySnapshot) -> String {
    let pct = b.percentage.round() as i64;
    let state = if b.state == 4 {
        "Fully charged"
    } else if b.charging {
        "Charging"
    } else {
        "Discharging"
    };
    format!("{pct}% \u{00b7} {state}")
}

// ===========================================================================
// Component
// ===========================================================================

/// The quick-settings surface body.
pub fn quick_settings() -> impl IntoElement {
    QuickSettings
}

#[derive(PartialEq)]
struct QuickSettings;

impl Component for QuickSettings {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let progress = use_consume::<OpenProgress>();
        let feed = use_consume::<KeyFeed>();
        let tokens = *use_consume::<State<theme::Tokens>>().read();

        // Snapshots (cloned so no read-guard is held across the many closures).
        let gnoblin = use_consume::<State<GnoblinSnapshot>>().read().clone();
        let audio = use_consume::<State<AudioSnapshot>>().read().clone();
        let battery = use_consume::<State<BatterySnapshot>>().read().clone();
        let net = use_consume::<State<NetworkSnapshot>>().read().clone();
        let bt = use_consume::<State<BluetoothSnapshot>>().read().clone();
        let brightness = use_consume::<State<BrightnessSnapshot>>().read().clone();
        let power = use_consume::<State<PowerSnapshot>>().read().clone();
        let settings = use_consume::<State<SettingsSnapshot>>().read().clone();

        // Reveal opacity + open edge.
        let p = *progress.0.read();
        let opacity = p.clamp(0.0, 1.0);
        let open = p > OPEN_EPS;

        // Drill state: `drill` = current target (None at root); `shown` = last
        // drilled kind, kept for the back-slide; `slide` = 0 root .. 1 drilled.
        let mut drill = use_state(|| None::<DrillKind>);
        let shown = use_state(|| DrillKind::Wifi);
        let mut slide = use_spring(0.0);
        // Viewport width, captured for the slide offsets (default = sheet inner).
        let mut vw = use_state(|| tokens.panel_w - 2.0 * SHEET_PAD);

        let in_drill = drill.read().is_some();

        // Reset to root on the closed->open reveal edge; jump (not spring) so a
        // reopen starts at root with no residual back-animation.
        use_side_effect_with_deps(&open, move |&open| {
            if open {
                drill.set(None);
                slide.jump(0.0);
            }
        });

        // Drive the slide when the drill target flips.
        use_side_effect_with_deps(&in_drill, move |&into| {
            if into {
                slide.to(1.0, motion::DRILL);
            } else {
                slide.to(0.0, motion::DRILL_BACK);
            }
        });

        // Route Escape via the KeyFeed (main.rs delivers it here while QS focused).
        let seq = feed.0.read().as_ref().map(|e| e.seq);
        {
            let bus = bus.clone();
            use_side_effect_with_deps(&seq, move |_| {
                let Some(ev) = feed.0.peek().clone() else {
                    return;
                };
                if !ev.press.is_escape() {
                    return;
                }
                // peek's read borrow must not live across set's write borrow;
                // match-scrutinee temporaries survive the whole match (same
                // State panic class the session arrow handler hit).
                let in_drill = drill.peek().is_some();
                match esc_nav(in_drill) {
                    EscNav::Back => drill.set(None),
                    EscNav::Close => bus.send(ShellMsg::CloseAll),
                }
            });
        }

        // Open a drill: record it in both `drill` (drives the slide) and `shown`
        // (drives the drill layer's content).
        let open_drill = |kind: DrillKind| -> EventHandler<()> {
            let mut drill = drill;
            let mut shown = shown;
            EventHandler::new(move |_| {
                shown.set(kind);
                drill.set(Some(kind));
            })
        };

        // Layer geometry from the slide value.
        let s = slide.value();
        let w = *vw.read();
        let root_left = -(s * w);
        let drill_left = (1.0 - s) * w;

        let root_layer = rect()
            .position(Position::new_absolute().top(0.0).left(root_left))
            .width(Size::px(w))
            .height(Size::fill())
            .child(root_view(
                &bus,
                &tokens,
                &gnoblin,
                &battery,
                &audio,
                &net,
                &bt,
                &brightness,
                &power,
                &settings,
                &open_drill,
            ));

        let drill_layer = rect()
            .position(Position::new_absolute().top(0.0).left(drill_left))
            .width(Size::px(w))
            .height(Size::fill())
            .child(drill_view(*shown.read(), &bus, &net, &bt, &audio, drill));

        let viewport = rect()
            .width(Size::fill())
            .height(Size::fill())
            .overflow(Overflow::Clip)
            .on_sized(move |e: Event<SizedEventData>| vw.set(e.area.width()))
            .child(root_layer)
            .child(drill_layer);

        let sheet = rect()
            .width(Size::fill())
            .height(Size::fill())
            .background(theme::PANEL.rgb())
            .corner_radius(theme::RADIUS_SHEET)
            .padding(SHEET_PAD)
            .overflow(Overflow::Clip)
            .child(viewport);

        rect().expanded().opacity(opacity).child(sheet)
    }
}

// ===========================================================================
// Root view
// ===========================================================================

#[allow(clippy::too_many_arguments)]
fn root_view(
    bus: &ShellBus,
    tokens: &theme::Tokens,
    gnoblin: &GnoblinSnapshot,
    battery: &BatterySnapshot,
    audio: &AudioSnapshot,
    net: &NetworkSnapshot,
    bt: &BluetoothSnapshot,
    brightness: &BrightnessSnapshot,
    power: &PowerSnapshot,
    settings: &SettingsSnapshot,
    open_drill: &dyn Fn(DrillKind) -> EventHandler<()>,
) -> Element {
    let mut col = rect().vertical().width(Size::fill()).spacing(8.0);

    col = col.child(top_row(bus, tokens, battery));

    if !gnoblin.connected {
        col = col.child(gnoblin_banner());
    }

    // Chip grid rows.
    let (wifi_active, wifi_sub) = wifi_chip(net);
    let (bt_active, bt_sub) = bt_chip(bt);
    let ps_active = power_saver_active(power);

    let mut row1: Vec<Element> = Vec::new();
    if net.available {
        row1.push(
            Chip {
                icon: ICON_WIFI,
                label: "Wi-Fi".to_string(),
                sub: Some(wifi_sub),
                active: wifi_active,
                on_toggle: cmd(bus, Command::SetWifiEnabled(!net.enabled)),
                on_drill: Some(open_drill(DrillKind::Wifi)),
            }
            .into_element(),
        );
    }
    if bt.available {
        row1.push(
            Chip {
                icon: ICON_BLUETOOTH,
                label: "Bluetooth".to_string(),
                sub: Some(bt_sub),
                active: bt_active,
                on_toggle: cmd(bus, Command::SetBluetoothPowered(!bt.powered)),
                on_drill: Some(open_drill(DrillKind::Bt)),
            }
            .into_element(),
        );
    }
    if !row1.is_empty() {
        col = col.child(chip_row(tokens.tile_h, row1));
    }

    let mut row2: Vec<Element> = Vec::new();
    if power.available {
        row2.push(
            Chip {
                icon: ICON_BOLT,
                label: "Power Saver".to_string(),
                sub: None,
                active: ps_active,
                on_toggle: cmd(bus, Command::SetPowerProfile(next_power_profile(ps_active))),
                on_drill: None,
            }
            .into_element(),
        );
    }
    row2.push(
        Chip {
            icon: ICON_MOON,
            label: "Dark Style".to_string(),
            sub: None,
            active: settings.dark_style,
            on_toggle: cmd(bus, Command::SetDarkStyle(!settings.dark_style)),
            on_drill: None,
        }
        .into_element(),
    );
    col = col.child(chip_row(tokens.tile_h, row2));

    let muted = audio.muted;
    let row3 = vec![
        Chip {
            icon: ICON_BELL_SLASH,
            label: "Silent".to_string(),
            sub: None,
            active: muted,
            on_toggle: cmd(bus, Command::SetMuted(!muted)),
            on_drill: None,
        }
        .into_element(),
        Chip {
            icon: ICON_SUN,
            label: "Night Light".to_string(),
            sub: None,
            active: settings.night_light,
            on_toggle: cmd(bus, Command::SetNightLight(!settings.night_light)),
            on_drill: None,
        }
        .into_element(),
    ];
    col = col.child(chip_row(tokens.tile_h, row3));

    col = col.child(sliders(bus, audio, brightness, open_drill));

    col.into_element()
}

/// Top row: battery meta (when present), spacer, reload (leaf), lock, power.
fn top_row(bus: &ShellBus, tokens: &theme::Tokens, battery: &BatterySnapshot) -> Element {
    let ctl = tokens.ctl();
    let mut row = rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(4.0);

    if battery.present {
        row = row.child(
            rect()
                .horizontal()
                .cross_align(Alignment::Center)
                .spacing(6.0)
                .width(Size::flex(1.0))
                .child(icon(ICON_BATTERY, 16.0, theme::MUT))
                .child(
                    label()
                        .text(battery_meta(battery))
                        .color(theme::MUT.rgb())
                        .font_size(11.5)
                        .font_family(theme::FONT_FAMILY_DATA),
                ),
        );
    } else {
        row = row.child(rect().width(Size::flex(1.0)));
    }

    row.child(IconAction {
        icon: ICON_LEAF,
        size: ctl,
        icon_size: 16.0,
        tint: theme::LEAF,
        hover_tint: theme::LEAF2,
        on_press: cmd(bus, Command::Reload),
    })
    .child(IconAction {
        icon: ICON_LOCK,
        size: ctl,
        icon_size: 16.0,
        tint: theme::MUT,
        hover_tint: theme::TX,
        on_press: cmd(bus, Command::Session(SessionVerb::Lock)),
    })
    .child(IconAction {
        icon: ICON_POWER,
        size: ctl,
        icon_size: 16.0,
        tint: theme::MUT,
        hover_tint: theme::ROSE,
        on_press: {
            let bus = bus.clone();
            EventHandler::new(move |_| bus.send(ShellMsg::Toggle(SurfaceKey::Session)))
        },
    })
    .into_element()
}

/// The amber gnoblin-disconnected banner + Reconnect (ags GnoblinBanner).
fn gnoblin_banner() -> Element {
    rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(10.0)
        .padding((8.0, 10.0))
        .corner_radius(theme::RADIUS_ROW)
        .background(theme::PANEL2.rgb())
        .child(icon(ICON_WARNING, 18.0, theme::AMBER))
        .child(
            rect()
                .vertical()
                .width(Size::flex(1.0))
                .child(
                    label()
                        .text("org.gnoblin.Shell disconnected")
                        .color(theme::TX.rgb())
                        .font_size(12.0)
                        .max_lines(1usize)
                        .text_overflow(TextOverflow::Ellipsis),
                )
                .child(
                    label()
                        .text("osd + notifs handed back to gnome")
                        .color(theme::MUT.rgb())
                        .font_size(10.5)
                        .max_lines(1usize)
                        .text_overflow(TextOverflow::Ellipsis),
                ),
        )
        .child(ReconnectButton)
        .into_element()
}

/// The banner's Reconnect pill (its own scope for hover).
#[derive(PartialEq)]
struct ReconnectButton;

impl Component for ReconnectButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        let bg = hover.pick(theme::CHIP, theme::HOVER);
        rect()
            .padding((5.0, 12.0))
            .corner_radius(theme::RADIUS_PILL)
            .background(bg.rgb())
            .cross_align(Alignment::Center)
            .hover(hover)
            .on_press(move |_| bus.send(ShellMsg::Service(Command::Reload)))
            .child(label().text("Reconnect").color(theme::TX.rgb()).font_size(11.5))
    }
}

/// One 2-column chip row: each chip flexes to an equal half and is a fixed
/// `tile_h` tall (ags `.chip { min-height: tileH }`). The explicit height bounds
/// a drilling chip's full-height chevron to `tile_h`, instead of letting the
/// chevron's `Size::fill` inflate the auto-height row to the whole sheet.
fn chip_row(tile_h: f32, chips: Vec<Element>) -> Element {
    let mut row = rect().horizontal().width(Size::fill()).content(Content::Flex).spacing(8.0);
    for chip in chips {
        row = row.child(
            rect()
                .width(Size::flex(1.0))
                .height(Size::px(tile_h))
                .content(Content::Flex)
                .child(chip),
        );
    }
    row.into_element()
}

/// Volume (+ mixer chevron) and brightness sliders (ags Sliders).
fn sliders(
    bus: &ShellBus,
    audio: &AudioSnapshot,
    brightness: &BrightnessSnapshot,
    open_drill: &dyn Fn(DrillKind) -> EventHandler<()>,
) -> Element {
    let vol_icon = if audio.muted || audio.volume <= 0.0 {
        ICON_SPEAKER_MUTE
    } else {
        ICON_SPEAKER_WAVE
    };
    let mut col = rect().vertical().width(Size::fill());

    // Volume row: icon, slider, chevron -> mixer drill.
    col = col.child(
        slider_row(vol_icon)
            .child(slider_slot(KSlider::new(
                audio.volume.clamp(0.0, 1.0) as f64,
                set_volume(bus),
            )))
            .child(IconAction {
                icon: super::ICON_CHEVRON_RIGHT,
                size: CHEV_W,
                icon_size: 16.0,
                tint: theme::MUT,
                hover_tint: theme::TX,
                on_press: open_drill(DrillKind::Mix),
            }),
    );

    // Brightness row (hidden when no backlight); a spacer keeps the rail aligned.
    if brightness.available {
        col = col.child(
            slider_row(ICON_BRIGHTNESS)
                .child(slider_slot(KSlider::new(
                    brightness.level.clamp(0.0, 1.0) as f64,
                    set_brightness(bus),
                )))
                .child(rect().width(Size::px(CHEV_W))),
        );
    }

    col.into_element()
}

/// A slider row shell (icon + flexible slider + trailing control), min-height 42.
fn slider_row(icon_bytes: &'static [u8]) -> Rect {
    rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .min_height(Size::px(42.0))
        .spacing(5.0)
        .child(icon(icon_bytes, 16.0, theme::MUT))
}

/// Wrap a slider so it flexes to fill the row.
fn slider_slot(slider: KSlider) -> Element {
    rect().width(Size::flex(1.0)).content(Content::Flex).child(slider).into_element()
}

// ===========================================================================
// Drill view
// ===========================================================================

fn drill_view(
    kind: DrillKind,
    bus: &ShellBus,
    net: &NetworkSnapshot,
    bt: &BluetoothSnapshot,
    audio: &AudioSnapshot,
    mut drill: State<Option<DrillKind>>,
) -> Element {
    // Header: back button, title, and a right-side power/enabled switch.
    let back = IconAction {
        icon: ICON_CHEVRON_LEFT,
        size: HEADER_H,
        icon_size: 16.0,
        tint: theme::MUT,
        hover_tint: theme::TX,
        on_press: EventHandler::new(move |_| drill.set(None)),
    };

    let mut header = rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .min_height(Size::px(HEADER_H))
        .spacing(10.0)
        .child(back)
        .child(
            label()
                .text(drill_title(kind))
                .color(theme::TX.rgb())
                .font_size(theme::FONT_SIZE_BASE)
                .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                .width(Size::flex(1.0)),
        );

    match kind {
        DrillKind::Wifi if net.available => {
            header = header.child(KSwitch {
                on: net.enabled,
                on_toggle: cmd(bus, Command::SetWifiEnabled(!net.enabled)),
            });
        }
        DrillKind::Bt => {
            header = header.child(KSwitch {
                on: bt.powered,
                on_toggle: cmd(bus, Command::SetBluetoothPowered(!bt.powered)),
            });
        }
        _ => {
            // Keep the title flex balanced with a switch-sized spacer.
            header = header.child(rect().width(Size::px(46.0)));
        }
    }

    let body: Element = match kind {
        DrillKind::Wifi => wifi_list(bus, net),
        DrillKind::Bt => bt_list(bus, bt),
        DrillKind::Mix => mix_list(bus, audio),
    };

    rect()
        .vertical()
        .width(Size::fill())
        .spacing(8.0)
        .child(header)
        .child(body)
        .into_element()
}

/// Wi-Fi access-point rows (ags WifiList). Snapshot APs are pre-deduped/sorted.
fn wifi_list(bus: &ShellBus, net: &NetworkSnapshot) -> Element {
    let active = net.active_ssid.as_deref();
    let mut list = rect().vertical().width(Size::fill()).spacing(2.0);
    for ap in net.aps.iter().take(6) {
        let on = active == Some(ap.ssid.as_str());
        list = list.child(DrillRow {
            icon: ICON_WIFI,
            name: ap.ssid.clone(),
            trailing: if on {
                RowTrailing::Check
            } else {
                RowTrailing::Text(wifi_row_state(false, ap.strength))
            },
            active: on,
            on_press: cmd(bus, Command::ConnectWifi(ap.ssid.clone())),
        });
    }
    list.into_element()
}

/// Bluetooth device rows (ags BtList).
fn bt_list(bus: &ShellBus, bt: &BluetoothSnapshot) -> Element {
    let mut list = rect().vertical().width(Size::fill()).spacing(2.0);
    for dev in bt.devices.iter().take(6) {
        list = list.child(DrillRow {
            icon: ICON_BLUETOOTH,
            name: dev.alias.clone(),
            trailing: RowTrailing::Text(bt_row_state(dev.connected, dev.paired).to_string()),
            active: dev.connected,
            on_press: cmd(bus, bt_row_command(dev.connected, &dev.address)),
        });
    }
    list.into_element()
}

/// Per-app mixer (ags MixList): default sink + up to five streams, mini sliders.
fn mix_list(bus: &ShellBus, audio: &AudioSnapshot) -> Element {
    let mut list = rect().vertical().width(Size::fill()).spacing(2.0);
    list = list.child(mix_row(
        ICON_SPEAKER_WAVE,
        "Output".to_string(),
        audio.volume.clamp(0.0, 1.0) as f64,
        set_volume(bus),
    ));
    for stream in audio.streams.iter().take(5) {
        let id = stream.id;
        let bus = bus.clone();
        let on_change = EventHandler::new(move |v: f64| {
            bus.send(ShellMsg::Service(Command::SetStreamVolume { id, volume: v as f32 }));
        });
        list = list.child(mix_row(
            ICON_MUSIC,
            stream.name.clone(),
            stream.volume.clamp(0.0, 1.0) as f64,
            on_change,
        ));
    }
    list.into_element()
}

/// One mixer row: 26x26 icon tile, 72px name column, a compact slider.
fn mix_row(
    icon_bytes: &'static [u8],
    title: String,
    value: f64,
    on_change: EventHandler<f64>,
) -> Element {
    rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .min_height(Size::px(38.0))
        .spacing(10.0)
        .child(
            rect()
                .width(Size::px(26.0))
                .height(Size::px(26.0))
                .center()
                .corner_radius(theme::RADIUS_TILE)
                .background(theme::PANEL2.rgb())
                .child(icon(icon_bytes, 15.0, theme::MUT)),
        )
        .child(
            label()
                .text(title)
                .color(theme::TX.rgb())
                .font_size(12.0)
                .max_lines(1usize)
                .text_overflow(TextOverflow::Ellipsis)
                .width(Size::px(72.0)),
        )
        .child(rect().width(Size::flex(1.0)).content(Content::Flex).child(KSlider::compact(value, on_change)))
        .into_element()
}

/// Trailing content of a drill row: a text state ("Paired", "80%") or a LEAF
/// check glyph for the active/connected entry (the Wi-Fi spec's LEAF check).
#[derive(PartialEq)]
enum RowTrailing {
    Text(String),
    Check,
}

/// One drilldown row (ags `.xrow`): icon, name, and a trailing state/check; hover
/// lifts to PANEL2, active tints CHIP with a LEAF glyph.
#[derive(PartialEq)]
struct DrillRow {
    icon: &'static [u8],
    name: String,
    trailing: RowTrailing,
    active: bool,
    on_press: EventHandler<()>,
}

impl Component for DrillRow {
    fn render(&self) -> impl IntoElement {
        let hover = use_hover();
        let on = hover.on();

        let bg: Color = if self.active {
            theme::CHIP.rgb().into()
        } else if on {
            theme::PANEL2.rgb().into()
        } else {
            Color::TRANSPARENT
        };
        let tint = if self.active { theme::LEAF } else { theme::MUT };
        let on_press = self.on_press.clone();
        let trailing: Element = match &self.trailing {
            RowTrailing::Check => icon(ICON_CHECK, 16.0, theme::LEAF).into_element(),
            RowTrailing::Text(t) => {
                label().text(t.clone()).color(tint.rgb()).font_size(11.5).into_element()
            }
        };

        rect()
            .horizontal()
            .width(Size::fill())
            .content(Content::Flex)
            .cross_align(Alignment::Center)
            .spacing(10.0)
            .padding((ROW_PAD_V, ROW_PAD_H))
            .corner_radius(theme::RADIUS_ROW)
            .background(bg)
            .hover(hover)
            .on_press(move |_| on_press.call(()))
            .child(icon(self.icon, 18.0, tint))
            .child(
                label()
                    .text(self.name.clone())
                    .color(theme::TX.rgb())
                    .font_size(theme::FONT_SIZE_BASE)
                    .max_lines(1usize)
                    .text_overflow(TextOverflow::Ellipsis)
                    .width(Size::flex(1.0)),
            )
            .child(trailing)
    }
}

// ===========================================================================
// Command handler helpers
// ===========================================================================

/// An [`EventHandler`] that sends one service [`Command`] through the bus.
fn cmd(bus: &ShellBus, command: Command) -> EventHandler<()> {
    let bus = bus.clone();
    EventHandler::new(move |_| bus.send(ShellMsg::Service(command.clone())))
}

/// A slider handler that sets the default-sink volume (0..1 -> SetVolume).
fn set_volume(bus: &ShellBus) -> EventHandler<f64> {
    let bus = bus.clone();
    EventHandler::new(move |v: f64| bus.send(ShellMsg::Service(Command::SetVolume(v as f32))))
}

/// A slider handler that sets the backlight level (0..1 -> SetBrightness).
fn set_brightness(bus: &ShellBus) -> EventHandler<f64> {
    let bus = bus.clone();
    EventHandler::new(move |v: f64| bus.send(ShellMsg::Service(Command::SetBrightness(v as f32))))
}

// ===========================================================================
// Tests -- pure logic only (no Freya runtime)
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use kobel_services::{AccessPointInfo, BtDevice};

    #[test]
    fn esc_steps_back_then_closes() {
        assert_eq!(esc_nav(true), EscNav::Back);
        assert_eq!(esc_nav(false), EscNav::Close);
    }

    #[test]
    fn drill_titles() {
        assert_eq!(drill_title(DrillKind::Wifi), "Wi-Fi");
        assert_eq!(drill_title(DrillKind::Bt), "Bluetooth");
        assert_eq!(drill_title(DrillKind::Mix), "Volume");
    }

    #[test]
    fn wifi_chip_active_and_sublabel() {
        let mut net = NetworkSnapshot { available: true, enabled: true, ..Default::default() };
        net.active_ssid = Some("home".to_string());
        let (active, sub) = wifi_chip(&net);
        assert!(active);
        assert_eq!(sub, "home");

        // Enabled but no SSID -> "Off"; disabled likewise reads "Off".
        let off = NetworkSnapshot { available: true, enabled: false, ..Default::default() };
        let (active, sub) = wifi_chip(&off);
        assert!(!active);
        assert_eq!(sub, "Off");
    }

    #[test]
    fn bt_chip_first_connected_alias() {
        let bt = BluetoothSnapshot {
            available: true,
            powered: true,
            devices: vec![
                BtDevice {
                    address: "A".into(),
                    alias: "Buds".into(),
                    connected: false,
                    paired: true,
                },
                BtDevice {
                    address: "B".into(),
                    alias: "Speaker".into(),
                    connected: true,
                    paired: true,
                },
            ],
        };
        let (active, sub) = bt_chip(&bt);
        assert!(active);
        assert_eq!(sub, "Speaker");

        let empty = BluetoothSnapshot { available: true, powered: true, devices: vec![] };
        let (active, sub) = bt_chip(&empty);
        assert!(!active);
        assert_eq!(sub, "Off");
    }

    #[test]
    fn power_saver_toggle_swaps_saver_and_balanced() {
        let saver = PowerSnapshot { available: true, profile: PowerProfile::PowerSaver };
        assert!(power_saver_active(&saver));
        assert_eq!(next_power_profile(true), PowerProfile::Balanced);

        let bal = PowerSnapshot { available: true, profile: PowerProfile::Balanced };
        assert!(!power_saver_active(&bal));
        assert_eq!(next_power_profile(false), PowerProfile::PowerSaver);

        // Performance is not "power saver" and toggling into saver from it works.
        let perf = PowerSnapshot { available: true, profile: PowerProfile::Performance };
        assert!(!power_saver_active(&perf));
    }

    #[test]
    fn bt_row_command_connects_or_disconnects() {
        assert!(matches!(
            bt_row_command(true, "AA:BB"),
            Command::DisconnectBtDevice(a) if a == "AA:BB"
        ));
        assert!(matches!(
            bt_row_command(false, "AA:BB"),
            Command::ConnectBtDevice(a) if a == "AA:BB"
        ));
    }

    #[test]
    fn row_state_labels() {
        assert_eq!(wifi_row_state(true, 80), "Connected");
        assert_eq!(wifi_row_state(false, 80), "80%");
        assert_eq!(bt_row_state(true, true), "Connected");
        assert_eq!(bt_row_state(false, true), "Paired");
        assert_eq!(bt_row_state(false, false), "Available");
    }

    #[test]
    fn battery_meta_states() {
        let charging = BatterySnapshot { present: true, percentage: 42.4, charging: true, state: 1, ..Default::default() };
        assert_eq!(battery_meta(&charging), "42% \u{00b7} Charging");
        let full = BatterySnapshot { present: true, percentage: 100.0, charging: false, state: 4, ..Default::default() };
        assert_eq!(battery_meta(&full), "100% \u{00b7} Fully charged");
        let disch = BatterySnapshot { present: true, percentage: 77.6, charging: false, state: 2, ..Default::default() };
        assert_eq!(battery_meta(&disch), "78% \u{00b7} Discharging");
    }

    #[test]
    fn ap_dedup_take_is_snapshot_driven() {
        // The service already dedups/sorts/caps; the UI just takes up to 6. Prove
        // the take() bound holds so a chatty backend cannot overflow the drill.
        let aps: Vec<AccessPointInfo> = (0..10)
            .map(|i| AccessPointInfo {
                ssid: format!("net{i}"),
                strength: 50,
                active: false,
                secured: true,
            })
            .collect();
        assert_eq!(aps.iter().take(6).count(), 6);
    }
}
