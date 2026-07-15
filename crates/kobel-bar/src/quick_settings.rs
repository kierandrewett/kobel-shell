use freya_components::button::{Button, ButtonColorsThemePartial};
use freya_components::slider::{Slider, SliderThemePartial};
use freya_core::prelude::*;
use kobel_services::{
    AudioSnapshot, BluetoothSnapshot, Command, NetworkSnapshot, PowerProfile, PowerSnapshot, SessionVerb,
};
use kobel_theme::TOKENS;
use torin::prelude::{Alignment, Content, Size};

use super::{BarActionSink, BarContext, BarPanel, button_layout};

const MAX_DRILL_ROWS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QuickSettingsView {
    Root,
    Wifi,
    Bluetooth,
    Mixer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EscapeAction {
    Back,
    Close,
}

fn escape_action(view: QuickSettingsView) -> EscapeAction {
    if view == QuickSettingsView::Root {
        EscapeAction::Close
    } else {
        EscapeAction::Back
    }
}

fn wifi_detail(network: &NetworkSnapshot) -> String {
    if !network.available {
        return "Unavailable".to_string();
    }
    if !network.enabled {
        return "Off".to_string();
    }
    network
        .active_ssid
        .clone()
        .unwrap_or_else(|| "Not connected".to_string())
}

fn bluetooth_detail(bluetooth: &BluetoothSnapshot) -> String {
    if !bluetooth.available {
        return "Unavailable".to_string();
    }
    if !bluetooth.powered {
        return "Off".to_string();
    }
    bluetooth
        .devices
        .iter()
        .find(|device| device.connected)
        .map(|device| device.alias.clone())
        .unwrap_or_else(|| "Not connected".to_string())
}

fn next_power_profile(power: &PowerSnapshot) -> PowerProfile {
    if power.profile == PowerProfile::PowerSaver {
        PowerProfile::Balanced
    } else {
        PowerProfile::PowerSaver
    }
}

fn bluetooth_device_command(address: &str, connected: bool) -> Command {
    if connected {
        Command::DisconnectBtDevice(address.to_string())
    } else {
        Command::ConnectBtDevice(address.to_string())
    }
}

fn command_handler(sink: &BarActionSink, command: Command) -> EventHandler<Event<PressEventData>> {
    let sink = sink.clone();
    EventHandler::new(move |_| sink.service(command.clone()))
}

fn view_handler(view: State<QuickSettingsView>, target: QuickSettingsView) -> EventHandler<Event<PressEventData>> {
    EventHandler::new(move |_| {
        eprintln!("[bar] quick settings view {target:?}");
        let mut view = view;
        view.set(target);
    })
}

fn button_colours(active: bool) -> ButtonColorsThemePartial {
    let background = if active {
        TOKENS.colours.accent.rgba()
    } else {
        TOKENS.colours.surface_elevated.rgba()
    };
    let foreground = if active {
        TOKENS.colours.accent_text.rgba()
    } else {
        TOKENS.colours.text.rgba()
    };
    let hover = if active {
        TOKENS.colours.accent.rgba()
    } else {
        TOKENS.colours.surface_hover.rgba()
    };

    ButtonColorsThemePartial::new()
        .background(background)
        .hover_background(hover)
        .border_fill(Color::TRANSPARENT)
        .focus_border_fill(TOKENS.colours.accent.rgba())
        .color(foreground)
}

fn slider_theme() -> SliderThemePartial {
    SliderThemePartial::new()
        .background(TOKENS.colours.surface_active.rgba())
        .thumb_background(TOKENS.colours.accent.rgba())
        .thumb_inner_background(TOKENS.colours.accent_text.rgba())
        .border_fill(TOKENS.colours.accent.rgba())
}

fn quick_chip(
    name: &'static str,
    detail: String,
    active: bool,
    on_toggle: EventHandler<Event<PressEventData>>,
    on_drill: Option<EventHandler<Event<PressEventData>>>,
) -> Element {
    let text_colour = if active {
        TOKENS.colours.accent_text.rgba()
    } else {
        TOKENS.colours.text.rgba()
    };
    let detail_colour = if active {
        TOKENS.colours.accent_text.rgba()
    } else {
        TOKENS.colours.text_muted.rgba()
    };
    let main_width = if on_drill.is_some() {
        Size::flex(1.0)
    } else {
        Size::fill()
    };

    let main = Button::new()
        .flat()
        .theme_colors(button_colours(active))
        .theme_layout(button_layout(
            main_width,
            TOKENS.popover.control_height * 1.5,
            (0.0, TOKENS.popover.control_padding),
            TOKENS.popover.row_radius,
        ))
        .on_press(on_toggle)
        .child(
            rect()
                .width(Size::fill())
                .vertical()
                .main_align(Alignment::Center)
                .child(
                    label()
                        .text(name)
                        .font_size(TOKENS.typography.label_size)
                        .font_weight(TOKENS.typography.semibold_weight)
                        .color(text_colour),
                )
                .child(
                    label()
                        .text(detail)
                        .max_lines(1)
                        .text_overflow(TextOverflow::Ellipsis)
                        .font_size(TOKENS.typography.small_size)
                        .color(detail_colour),
                ),
        );

    let mut chip = rect()
        .width(Size::flex(1.0))
        .height(Size::px(TOKENS.popover.control_height * 1.5))
        .horizontal()
        .content(Content::Flex)
        .corner_radius(TOKENS.popover.row_radius)
        .background(if active {
            TOKENS.colours.accent.rgba()
        } else {
            TOKENS.colours.surface_elevated.rgba()
        })
        .child(main);

    if let Some(on_drill) = on_drill {
        chip = chip.child(
            Button::new()
                .flat()
                .theme_colors(button_colours(active))
                .theme_layout(button_layout(
                    Size::px(TOKENS.popover.control_height),
                    TOKENS.popover.control_height * 1.5,
                    (0.0, 0.0),
                    TOKENS.popover.row_radius,
                ))
                .on_press(on_drill)
                .child(label().text(">").a11y_alt(format!("Open {name} details"))),
        );
    }

    chip.into_element()
}

fn chip_row(left: Element, right: Element) -> Rect {
    rect()
        .width(Size::fill())
        .horizontal()
        .content(Content::Flex)
        .spacing(TOKENS.popover.row_gap)
        .child(left)
        .child(right)
}

fn action_button(label_text: &'static str, sink: &BarActionSink, command: Command, active: bool) -> Element {
    Button::new()
        .flat()
        .theme_colors(button_colours(active))
        .theme_layout(button_layout(
            Size::auto(),
            TOKENS.popover.control_height,
            (0.0, TOKENS.popover.control_padding),
            TOKENS.popover.row_radius,
        ))
        .on_press(command_handler(sink, command))
        .child(
            label()
                .text(label_text)
                .font_size(TOKENS.typography.small_size)
                .font_weight(TOKENS.typography.semibold_weight),
        )
        .into_element()
}

fn slider_row(label_text: impl Into<String>, value: f32, enabled: bool, on_moved: EventHandler<f64>) -> Rect {
    let label_text = label_text.into();
    rect()
        .width(Size::fill())
        .height(Size::px(TOKENS.popover.control_height))
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(TOKENS.popover.row_gap)
        .child(
            label()
                .text(label_text)
                .width(Size::px(72.0))
                .font_size(TOKENS.typography.small_size)
                .font_weight(TOKENS.typography.medium_weight),
        )
        .child(
            rect()
                .width(Size::flex(1.0))
                .height(Size::px(TOKENS.popover.control_height))
                .center()
                .child(
                    Slider::new(on_moved)
                        .value((value.clamp(0.0, 1.0) * 100.0) as f64)
                        .enabled(enabled)
                        .theme(slider_theme())
                        .size(Size::fill()),
                ),
        )
        .child(
            label()
                .text(format!("{}%", (value.clamp(0.0, 1.0) * 100.0).round() as i64))
                .width(Size::px(40.0))
                .font_size(TOKENS.typography.small_size)
                .color(TOKENS.colours.text_muted.rgba()),
        )
}

fn root_view(context: &BarContext, sink: &BarActionSink, view: State<QuickSettingsView>) -> Element {
    let audio = context.audio.read().clone();
    let battery = context.battery.read().clone();
    let network = context.network.read().clone();
    let bluetooth = context.bluetooth.read().clone();
    let brightness = context.brightness.read().clone();
    let power = context.power.read().clone();
    let settings = context.settings.read().clone();
    let gnoblin = context.gnoblin.read().clone();

    let wifi = quick_chip(
        "Wi-Fi",
        wifi_detail(&network),
        network.available && network.enabled,
        command_handler(sink, Command::SetWifiEnabled(!network.enabled)),
        Some(view_handler(view, QuickSettingsView::Wifi)),
    );
    let bluetooth_chip = quick_chip(
        "Bluetooth",
        bluetooth_detail(&bluetooth),
        bluetooth.available && bluetooth.powered,
        command_handler(sink, Command::SetBluetoothPowered(!bluetooth.powered)),
        Some(view_handler(view, QuickSettingsView::Bluetooth)),
    );
    let power_saver = power.profile == PowerProfile::PowerSaver;
    let power_chip = quick_chip(
        "Power Saver",
        if power.available {
            format!("{:?}", power.profile)
        } else {
            "Unavailable".to_string()
        },
        power.available && power_saver,
        command_handler(sink, Command::SetPowerProfile(next_power_profile(&power))),
        None,
    );
    let dark_style = quick_chip(
        "Dark Style",
        if settings.dark_style { "On" } else { "Off" }.to_string(),
        settings.dark_style,
        command_handler(sink, Command::SetDarkStyle(!settings.dark_style)),
        None,
    );
    let silent = quick_chip(
        "Silent",
        if audio.muted { "On" } else { "Off" }.to_string(),
        audio.muted,
        command_handler(sink, Command::SetMuted(!audio.muted)),
        None,
    );
    let night_light = quick_chip(
        "Night Light",
        if settings.night_light { "On" } else { "Off" }.to_string(),
        settings.night_light,
        command_handler(sink, Command::SetNightLight(!settings.night_light)),
        None,
    );

    let volume_sink = sink.clone();
    let volume = slider_row(
        "Volume",
        audio.volume,
        true,
        EventHandler::new(move |value| volume_sink.service(Command::SetVolume((value / 100.0) as f32))),
    );
    let brightness_sink = sink.clone();
    let brightness_row = slider_row(
        "Brightness",
        brightness.level,
        brightness.available,
        EventHandler::new(move |value| brightness_sink.service(Command::SetBrightness((value / 100.0) as f32))),
    );

    let battery_text = if battery.present {
        format!("{}% battery", battery.percentage.round() as i64)
    } else {
        "Desktop power".to_string()
    };
    let mut root = rect()
        .width(Size::fill())
        .vertical()
        .spacing(TOKENS.popover.section_gap)
        .child(
            rect()
                .width(Size::fill())
                .horizontal()
                .content(Content::Flex)
                .cross_align(Alignment::Center)
                .spacing(TOKENS.popover.row_gap)
                .child(
                    label()
                        .text(battery_text)
                        .width(Size::flex(1.0))
                        .font_size(TOKENS.typography.small_size)
                        .color(TOKENS.colours.text_muted.rgba()),
                )
                .child(action_button("Reload", sink, Command::Reload, true))
                .child(action_button("Lock", sink, Command::Session(SessionVerb::Lock), false)),
        );

    if !gnoblin.connected {
        root = root.child(
            rect()
                .width(Size::fill())
                .padding(TOKENS.popover.control_padding)
                .corner_radius(TOKENS.popover.row_radius)
                .background(TOKENS.colours.surface_active.rgba())
                .horizontal()
                .content(Content::Flex)
                .cross_align(Alignment::Center)
                .spacing(TOKENS.popover.row_gap)
                .child(
                    label()
                        .text("gnoblin controls unavailable")
                        .width(Size::flex(1.0))
                        .font_size(TOKENS.typography.small_size),
                )
                .child(action_button("Reconnect", sink, Command::Reload, true)),
        );
    }

    root.child(chip_row(wifi, bluetooth_chip))
        .child(chip_row(power_chip, dark_style))
        .child(chip_row(silent, night_light))
        .child(volume)
        .child(brightness_row)
        .child(
            Button::new()
                .flat()
                .theme_colors(button_colours(false))
                .theme_layout(button_layout(
                    Size::fill(),
                    TOKENS.popover.control_height,
                    (0.0, TOKENS.popover.control_padding),
                    TOKENS.popover.row_radius,
                ))
                .on_press(view_handler(view, QuickSettingsView::Mixer))
                .child(
                    label()
                        .text("Per-application volume >")
                        .font_size(TOKENS.typography.small_size),
                ),
        )
        .into_element()
}

fn drill_header(title: &'static str, view: State<QuickSettingsView>) -> Rect {
    rect()
        .width(Size::fill())
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .child(
            Button::new()
                .flat()
                .theme_colors(button_colours(false))
                .theme_layout(button_layout(
                    Size::px(TOKENS.popover.control_height),
                    TOKENS.popover.control_height,
                    (0.0, 0.0),
                    TOKENS.popover.row_radius,
                ))
                .on_press(view_handler(view, QuickSettingsView::Root))
                .child(label().text("<").a11y_alt("Back to quick settings")),
        )
        .child(
            label()
                .text(title)
                .width(Size::flex(1.0))
                .font_size(TOKENS.typography.title_size)
                .font_weight(TOKENS.typography.semibold_weight),
        )
}

fn drill_row(name: String, detail: String, active: bool, on_press: EventHandler<Event<PressEventData>>) -> Element {
    Button::new()
        .flat()
        .theme_colors(button_colours(active))
        .theme_layout(button_layout(
            Size::fill(),
            TOKENS.popover.control_height,
            (0.0, TOKENS.popover.control_padding),
            TOKENS.popover.row_radius,
        ))
        .on_press(on_press)
        .child(
            rect()
                .width(Size::fill())
                .horizontal()
                .content(Content::Flex)
                .cross_align(Alignment::Center)
                .child(
                    label()
                        .text(name)
                        .max_lines(1)
                        .text_overflow(TextOverflow::Ellipsis)
                        .width(Size::flex(1.0))
                        .font_size(TOKENS.typography.label_size),
                )
                .child(
                    label()
                        .text(detail)
                        .font_size(TOKENS.typography.small_size)
                        .color(if active {
                            TOKENS.colours.accent_text.rgba()
                        } else {
                            TOKENS.colours.text_muted.rgba()
                        }),
                ),
        )
        .into_element()
}

fn wifi_drill(network: &NetworkSnapshot, sink: &BarActionSink, view: State<QuickSettingsView>) -> Element {
    let mut panel = rect()
        .width(Size::fill())
        .vertical()
        .spacing(TOKENS.popover.row_gap)
        .child(drill_header("Wi-Fi", view))
        .child(action_button(
            if network.enabled {
                "Turn Wi-Fi off"
            } else {
                "Turn Wi-Fi on"
            },
            sink,
            Command::SetWifiEnabled(!network.enabled),
            network.enabled,
        ));

    if network.aps.is_empty() {
        panel = panel.child(
            label()
                .text(if network.enabled {
                    "No Wi-Fi networks found"
                } else {
                    "Wi-Fi is turned off"
                })
                .font_size(TOKENS.typography.body_size)
                .color(TOKENS.colours.text_muted.rgba()),
        );
    } else {
        for access_point in network.aps.iter().take(MAX_DRILL_ROWS) {
            let detail = if access_point.active {
                "Connected".to_string()
            } else if access_point.secured {
                format!("Secured · {}%", access_point.strength)
            } else {
                format!("{}%", access_point.strength)
            };
            panel = panel.child(drill_row(
                access_point.ssid.clone(),
                detail,
                access_point.active,
                command_handler(sink, Command::ConnectWifi(access_point.ssid.clone())),
            ));
        }
    }

    panel.into_element()
}

fn bluetooth_drill(bluetooth: &BluetoothSnapshot, sink: &BarActionSink, view: State<QuickSettingsView>) -> Element {
    let mut panel = rect()
        .width(Size::fill())
        .vertical()
        .spacing(TOKENS.popover.row_gap)
        .child(drill_header("Bluetooth", view))
        .child(action_button(
            if bluetooth.powered {
                "Turn Bluetooth off"
            } else {
                "Turn Bluetooth on"
            },
            sink,
            Command::SetBluetoothPowered(!bluetooth.powered),
            bluetooth.powered,
        ));

    if bluetooth.devices.is_empty() {
        panel = panel.child(
            label()
                .text(if bluetooth.powered {
                    "No paired devices"
                } else {
                    "Bluetooth is turned off"
                })
                .font_size(TOKENS.typography.body_size)
                .color(TOKENS.colours.text_muted.rgba()),
        );
    } else {
        for device in bluetooth.devices.iter().take(MAX_DRILL_ROWS) {
            let detail = if device.connected {
                "Connected"
            } else if device.paired {
                "Paired"
            } else {
                "Available"
            };
            panel = panel.child(drill_row(
                device.alias.clone(),
                detail.to_string(),
                device.connected,
                command_handler(sink, bluetooth_device_command(&device.address, device.connected)),
            ));
        }
    }

    panel.into_element()
}

fn mixer_drill(audio: &AudioSnapshot, sink: &BarActionSink, view: State<QuickSettingsView>) -> Element {
    let output_sink = sink.clone();
    let mut panel = rect()
        .width(Size::fill())
        .vertical()
        .spacing(TOKENS.popover.row_gap)
        .child(drill_header("Application volume", view))
        .child(slider_row(
            "Output",
            audio.volume,
            true,
            EventHandler::new(move |value| output_sink.service(Command::SetVolume((value / 100.0) as f32))),
        ));

    if audio.streams.is_empty() {
        panel = panel.child(
            label()
                .text("No applications are playing audio")
                .font_size(TOKENS.typography.body_size)
                .color(TOKENS.colours.text_muted.rgba()),
        );
    } else {
        for stream in audio.streams.iter().take(MAX_DRILL_ROWS) {
            let stream_sink = sink.clone();
            let id = stream.id;
            panel = panel.child(slider_row(
                stream.name.clone(),
                stream.volume,
                true,
                EventHandler::new(move |value| {
                    stream_sink.service(Command::SetStreamVolume {
                        id,
                        volume: (value / 100.0) as f32,
                    });
                }),
            ));
        }
    }

    panel.into_element()
}

#[derive(PartialEq)]
struct QuickSettingsPanel;

impl Component for QuickSettingsPanel {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let sink = use_consume::<BarActionSink>();
        let view = use_state(|| QuickSettingsView::Root);
        let escape_generation = context.escape_generation;
        let handled_escape = use_state(|| *escape_generation.peek());
        let mut effect_view = view;
        let mut effect_handled_escape = handled_escape;
        let close_sink = sink.clone();

        use_side_effect(move || {
            let generation = *escape_generation.read();
            if generation == *effect_handled_escape.peek() {
                return;
            }
            effect_handled_escape.set(generation);
            let action = escape_action(*effect_view.peek());
            eprintln!("[bar] quick settings escape {action:?}");
            match action {
                EscapeAction::Back => effect_view.set(QuickSettingsView::Root),
                EscapeAction::Close => close_sink.close(BarPanel::QuickSettings),
            }
        });

        let content = match *view.read() {
            QuickSettingsView::Root => root_view(&context, &sink, view),
            QuickSettingsView::Wifi => wifi_drill(&context.network.read(), &sink, view),
            QuickSettingsView::Bluetooth => bluetooth_drill(&context.bluetooth.read(), &sink, view),
            QuickSettingsView::Mixer => mixer_drill(&context.audio.read(), &sink, view),
        };

        rect()
            .width(Size::fill())
            .padding(TOKENS.popover.padding)
            .corner_radius(TOKENS.popover.radius)
            .background(TOKENS.colours.surface.rgba())
            .border(Border::new().fill(TOKENS.colours.border.rgba()).width(1.0))
            .font_family(TOKENS.typography.family)
            .color(TOKENS.colours.text.rgba())
            .child(content)
    }
}

pub fn quick_settings_popup_app() -> impl IntoElement {
    QuickSettingsPanel
}

#[cfg(test)]
mod tests {
    use kobel_services::{BluetoothSnapshot, GnoblinSnapshot, NetworkSnapshot, PowerProfile, PowerSnapshot};

    use super::{
        EscapeAction, QuickSettingsView, bluetooth_detail, bluetooth_device_command, escape_action, next_power_profile,
        wifi_detail,
    };

    #[test]
    fn escape_steps_back_before_closing() {
        assert_eq!(escape_action(QuickSettingsView::Wifi), EscapeAction::Back);
        assert_eq!(escape_action(QuickSettingsView::Bluetooth), EscapeAction::Back);
        assert_eq!(escape_action(QuickSettingsView::Mixer), EscapeAction::Back);
        assert_eq!(escape_action(QuickSettingsView::Root), EscapeAction::Close);
    }

    #[test]
    fn snapshot_details_cover_unavailable_off_and_connected_states() {
        assert_eq!(wifi_detail(&NetworkSnapshot::default()), "Unavailable");
        assert_eq!(bluetooth_detail(&BluetoothSnapshot::default()), "Unavailable");

        let network = NetworkSnapshot {
            available: true,
            enabled: true,
            active_ssid: Some("Kobel".to_string()),
            ..NetworkSnapshot::default()
        };
        assert_eq!(wifi_detail(&network), "Kobel");

        let mut bluetooth = BluetoothSnapshot {
            available: true,
            powered: true,
            ..BluetoothSnapshot::default()
        };
        bluetooth.devices.push(kobel_services::BtDevice {
            address: "AA:BB".to_string(),
            alias: "Headphones".to_string(),
            connected: true,
            paired: true,
        });
        assert_eq!(bluetooth_detail(&bluetooth), "Headphones");
    }

    #[test]
    fn power_and_bluetooth_actions_reverse_current_state() {
        assert_eq!(
            next_power_profile(&PowerSnapshot {
                available: true,
                profile: PowerProfile::PowerSaver,
            }),
            PowerProfile::Balanced,
        );
        assert!(matches!(
            bluetooth_device_command("AA:BB", true),
            kobel_services::Command::DisconnectBtDevice(address) if address == "AA:BB"
        ));
        assert!(matches!(
            bluetooth_device_command("AA:BB", false),
            kobel_services::Command::ConnectBtDevice(address) if address == "AA:BB"
        ));

        let _ = GnoblinSnapshot::default();
    }
}
