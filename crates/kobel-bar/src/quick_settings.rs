use std::time::Duration;

use async_io::Timer;
use freya_components::button::{Button, ButtonColorsThemePartial};
use freya_components::scrollviews::ScrollView;
use freya_components::slider::{Slider, SliderThemePartial};
use freya_core::prelude::*;
use kobel_services::{
    AudioSnapshot, BluetoothSnapshot, Command, NetworkSnapshot, PowerProfile, PowerSnapshot, SessionVerb,
};
use kobel_theme::{TOKENS, icons};
use kobel_wayland::KeyPress;
use torin::prelude::{Alignment, Content, Size};

use super::{
    BarActionSink, BarContext, BarPanel, button_layout, decorative_icon, icon, popover_frame, use_popover_layout,
};

const MAX_DRILL_ROWS: usize = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QuickSettingsView {
    Root,
    Wifi,
    Bluetooth,
    Mixer,
    Session,
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
        TOKENS.colours.card.rgba()
    };
    let foreground = if active {
        TOKENS.colours.accent_text.rgba()
    } else {
        TOKENS.colours.text.rgba()
    };
    let hover = if active {
        TOKENS.colours.accent.rgba()
    } else {
        TOKENS.colours.hover.rgba()
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
        .background(TOKENS.colours.active.rgba())
        .thumb_background(TOKENS.colours.accent.rgba())
        .thumb_inner_background(TOKENS.colours.accent_text.rgba())
        .border_fill(TOKENS.colours.accent.rgba())
}

fn quick_chip(
    name: &'static str,
    glyph: &'static [u8],
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
            TOKENS.popover.control_height * TOKENS.quick_settings.chip_height_ratio,
            (0.0, TOKENS.popover.control_padding),
            TOKENS.quick_settings.chip_radius,
        ))
        .on_press(on_toggle)
        .child(
            rect()
                .width(Size::fill())
                .horizontal()
                .cross_align(Alignment::Center)
                .spacing(TOKENS.popover.row_gap)
                .child(icon(glyph).color(text_colour))
                .child(
                    rect()
                        .width(Size::flex(1.0))
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
                ),
        );

    let mut chip = rect()
        .width(Size::flex(1.0))
        .height(Size::px(
            TOKENS.popover.control_height * TOKENS.quick_settings.chip_height_ratio,
        ))
        .horizontal()
        .content(Content::Flex)
        .corner_radius(TOKENS.quick_settings.chip_radius)
        .background(if active {
            TOKENS.colours.accent.rgba()
        } else {
            TOKENS.colours.card.rgba()
        })
        .child(main);

    if let Some(on_drill) = on_drill {
        chip = chip.child(
            Button::new()
                .flat()
                .theme_colors(button_colours(active))
                .theme_layout(button_layout(
                    Size::px(TOKENS.popover.control_height),
                    TOKENS.popover.control_height * TOKENS.quick_settings.chip_height_ratio,
                    (0.0, 0.0),
                    TOKENS.quick_settings.chip_radius,
                ))
                .on_press(on_drill)
                .child(
                    icon(icons::CARET_RIGHT)
                        .color(if active {
                            TOKENS.colours.accent_text.rgba()
                        } else {
                            TOKENS.colours.text.rgba()
                        })
                        .a11y_alt(format!("Open {name} details")),
                ),
        );
    }

    chip.into_element()
}

fn chip_row(left: Element, right: Element, compact: bool) -> Rect {
    let row = rect().width(Size::fill()).spacing(TOKENS.popover.row_gap);
    let row = if compact {
        row.vertical()
    } else {
        row.horizontal().content(Content::Flex)
    };
    row.child(left).child(right)
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

fn system_icon_button(glyph: &'static [u8], alt: &'static str, sink: &BarActionSink, command: Command) -> Element {
    // Stock GNOME dismisses Quick Settings when a system-row control fires, so the
    // Settings app never opens under a lingering popup and Lock cannot return to an
    // open menu after unlock. Queue the close ahead of the service command.
    let sink = sink.clone();
    let on_press = EventHandler::new(move |_| {
        sink.close(BarPanel::QuickSettings);
        sink.service(command.clone());
    });
    system_action_button(glyph, alt, on_press)
}

fn system_action_button(
    glyph: &'static [u8],
    alt: &'static str,
    on_press: EventHandler<Event<PressEventData>>,
) -> Element {
    let size = TOKENS.popover.control_height * 1.25;
    Button::new()
        .flat()
        .theme_colors(button_colours(false))
        .theme_layout(button_layout(
            Size::px(size),
            size,
            (0.0, 0.0),
            TOKENS.quick_settings.chip_radius,
        ))
        .on_press(on_press)
        .child(icon(glyph).color(TOKENS.colours.text.rgba()).a11y_alt(alt))
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
                .width(Size::px(TOKENS.quick_settings.slider_label_width))
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
                .width(Size::px(TOKENS.quick_settings.slider_value_width))
                .font_size(TOKENS.typography.small_size)
                .color(TOKENS.colours.text_muted.rgba()),
        )
}

fn root_view(context: &BarContext, sink: &BarActionSink, view: State<QuickSettingsView>, compact: bool) -> Element {
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
        icons::WIFI_HIGH,
        wifi_detail(&network),
        network.available && network.enabled,
        command_handler(sink, Command::SetWifiEnabled(!network.enabled)),
        Some(view_handler(view, QuickSettingsView::Wifi)),
    );
    let bluetooth_chip = quick_chip(
        "Bluetooth",
        icons::BLUETOOTH,
        bluetooth_detail(&bluetooth),
        bluetooth.available && bluetooth.powered,
        command_handler(sink, Command::SetBluetoothPowered(!bluetooth.powered)),
        Some(view_handler(view, QuickSettingsView::Bluetooth)),
    );
    let power_saver = power.profile == PowerProfile::PowerSaver;
    let power_chip = quick_chip(
        "Power Saver",
        icons::POWER_SAVER,
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
        icons::DARK_STYLE,
        if settings.dark_style { "On" } else { "Off" }.to_string(),
        settings.dark_style,
        command_handler(sink, Command::SetDarkStyle(!settings.dark_style)),
        None,
    );
    let silent = quick_chip(
        "Silent",
        icons::MUTED,
        if audio.muted { "On" } else { "Off" }.to_string(),
        audio.muted,
        command_handler(sink, Command::SetMuted(!audio.muted)),
        None,
    );
    let night_light = quick_chip(
        "Night Light",
        icons::NIGHT_LIGHT,
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
        format!("{}%", battery.percentage.round() as i64)
    } else {
        String::new()
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
                        .font_weight(TOKENS.typography.semibold_weight)
                        .color(TOKENS.colours.text_muted.rgba()),
                )
                .child(system_icon_button(
                    icons::SETTINGS,
                    "Settings",
                    sink,
                    Command::LaunchApp("org.gnome.Settings".to_string()),
                ))
                .child(system_icon_button(
                    icons::LOCK,
                    "Lock screen",
                    sink,
                    Command::Session(SessionVerb::Lock),
                ))
                .child(system_action_button(
                    icons::POWER,
                    "Power off / Log out",
                    view_handler(view, QuickSettingsView::Session),
                )),
        );

    if !gnoblin.connected {
        root = root.child(
            rect()
                .width(Size::fill())
                .padding(TOKENS.popover.control_padding)
                .corner_radius(TOKENS.popover.row_radius)
                .background(TOKENS.colours.active.rgba())
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

    root.child(chip_row(wifi, bluetooth_chip, compact))
        .child(chip_row(power_chip, dark_style, compact))
        .child(chip_row(silent, night_light, compact))
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
                    rect()
                        .width(Size::fill())
                        .horizontal()
                        .content(Content::Flex)
                        .cross_align(Alignment::Center)
                        .child(
                            label()
                                .text("Per-application volume")
                                .width(Size::flex(1.0))
                                .font_size(TOKENS.typography.small_size),
                        )
                        .child(decorative_icon(icons::CARET_RIGHT).color(TOKENS.colours.text.rgba())),
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
                .child(
                    icon(icons::CARET_LEFT)
                        .color(TOKENS.colours.text.rgba())
                        .a11y_alt("Back to quick settings"),
                ),
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

// ---- Session submenu (GNOME system-menu power controls) --------------------
// The power control in the system row opens this view, which lists the session
// actions as keyboard- and pointer-navigable rows. Destructive actions (restart,
// shut down) arm on the first activation and fire on the second (press-again
// confirm), auto-reverting after SESSION_REVERT_MS.

const SESSION_ACTIONS: [SessionAction; 4] = [
    SessionAction::Suspend,
    SessionAction::Restart,
    SessionAction::Shutdown,
    SessionAction::Logout,
];
const SESSION_REVERT_MS: u64 = 4000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionAction {
    Suspend,
    Restart,
    Shutdown,
    Logout,
}

impl SessionAction {
    fn label(self) -> &'static str {
        match self {
            Self::Suspend => "Suspend",
            Self::Restart => "Restart",
            Self::Shutdown => "Power Off",
            Self::Logout => "Log out",
        }
    }

    fn accessibility_label(self, armed: bool) -> String {
        if armed {
            format!("Press again to confirm {}", self.label().to_lowercase())
        } else {
            self.label().to_string()
        }
    }

    fn icon(self) -> &'static [u8] {
        match self {
            Self::Suspend => icons::SUSPEND,
            Self::Restart => icons::ARROW_CLOCKWISE,
            Self::Shutdown => icons::POWER,
            Self::Logout => icons::SIGN_OUT,
        }
    }

    fn verb(self) -> SessionVerb {
        match self {
            Self::Suspend => SessionVerb::Suspend,
            Self::Restart => SessionVerb::Restart,
            Self::Shutdown => SessionVerb::Shutdown,
            Self::Logout => SessionVerb::Logout,
        }
    }

    fn confirms(self) -> bool {
        matches!(self, Self::Restart | Self::Shutdown)
    }

    fn destructive(self) -> bool {
        matches!(self, Self::Restart | Self::Shutdown)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PressOutcome {
    Arm(SessionAction),
    Fire(SessionVerb),
}

fn decide_press(armed: Option<SessionAction>, action: SessionAction) -> PressOutcome {
    if action.confirms() && armed != Some(action) {
        PressOutcome::Arm(action)
    } else {
        PressOutcome::Fire(action.verb())
    }
}

fn press_action(
    action: SessionAction,
    mut armed: State<Option<SessionAction>>,
    mut generation: State<u64>,
    sink: &BarActionSink,
) {
    let outcome = decide_press(*armed.peek(), action);
    match outcome {
        PressOutcome::Arm(target) => {
            eprintln!("[bar] session armed {target:?}");
            armed.set(Some(target));
            let next_generation = generation.peek().wrapping_add(1);
            generation.set(next_generation);
            spawn(async move {
                Timer::after(Duration::from_millis(SESSION_REVERT_MS)).await;
                if *generation.peek() == next_generation {
                    armed.set(None);
                }
            });
        }
        PressOutcome::Fire(verb) => {
            let next_generation = generation.peek().wrapping_add(1);
            generation.set(next_generation);
            armed.set(None);
            sink.service(Command::Session(verb));
            sink.close(BarPanel::QuickSettings);
        }
    }
}

fn disarm(mut armed: State<Option<SessionAction>>, mut generation: State<u64>) {
    if let Some(action) = *armed.peek() {
        eprintln!("[bar] session disarmed {action:?}");
    }
    let next_generation = generation.peek().wrapping_add(1);
    generation.set(next_generation);
    armed.set(None);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Navigation {
    Up,
    Down,
}

fn move_selection(current: usize, direction: Navigation, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let current = current.min(len - 1);
    match direction {
        Navigation::Up => (current + len - 1) % len,
        Navigation::Down => (current + 1) % len,
    }
}

fn handle_key(
    press: &KeyPress,
    mut selected: State<usize>,
    armed: State<Option<SessionAction>>,
    generation: State<u64>,
    sink: &BarActionSink,
) {
    let direction = match &press.key {
        Key::Named(NamedKey::ArrowDown) => Some(Navigation::Down),
        Key::Named(NamedKey::ArrowUp) => Some(Navigation::Up),
        _ => None,
    };
    if let Some(direction) = direction {
        let current = *selected.peek();
        selected.set(move_selection(current, direction, SESSION_ACTIONS.len()));
        return;
    }
    if matches!(&press.key, Key::Named(NamedKey::Enter)) && !press.repeat {
        press_action(SESSION_ACTIONS[*selected.peek()], armed, generation, sink);
    }
}

#[allow(clippy::too_many_arguments)]
fn session_view(
    selected_now: usize,
    armed_now: Option<SessionAction>,
    view: State<QuickSettingsView>,
    selection: State<usize>,
    armed: State<Option<SessionAction>>,
    generation: State<u64>,
    sink: &BarActionSink,
) -> Element {
    let mut list = rect().width(Size::fill()).vertical().spacing(TOKENS.popover.row_gap);
    for (index, action) in SESSION_ACTIONS.iter().copied().enumerate() {
        list = list.child(session_row(
            index,
            action,
            selected_now == index,
            armed_now == Some(action),
            selection,
            armed,
            generation,
            sink.clone(),
        ));
    }
    rect()
        .width(Size::fill())
        .vertical()
        .spacing(TOKENS.popover.section_gap)
        .child(session_header(view, armed, generation))
        .child(list)
        .into_element()
}

fn session_header(view: State<QuickSettingsView>, armed: State<Option<SessionAction>>, generation: State<u64>) -> Rect {
    let mut view = view;
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
                .on_press(move |_| {
                    disarm(armed, generation);
                    view.set(QuickSettingsView::Root);
                })
                .child(
                    icon(icons::CARET_LEFT)
                        .color(TOKENS.colours.text.rgba())
                        .a11y_alt("Back to quick settings"),
                ),
        )
        .child(
            label()
                .text("Power Off / Log Out")
                .width(Size::flex(1.0))
                .font_size(TOKENS.typography.title_size)
                .font_weight(TOKENS.typography.semibold_weight),
        )
}

#[allow(clippy::too_many_arguments)]
fn session_row(
    index: usize,
    action: SessionAction,
    selected: bool,
    armed: bool,
    selection: State<usize>,
    armed_state: State<Option<SessionAction>>,
    generation: State<u64>,
    sink: BarActionSink,
) -> Element {
    let mut hover_selection = selection;
    let mut click_selection = selection;
    let label_text = if armed {
        action.accessibility_label(true)
    } else {
        action.label().to_string()
    };
    let highlighted = selected || armed;
    let glyph_colour = if highlighted {
        TOKENS.colours.accent_text.rgba()
    } else if action.destructive() {
        TOKENS.colours.danger.rgba()
    } else {
        TOKENS.colours.text.rgba()
    };
    let text_colour = if highlighted {
        TOKENS.colours.accent_text.rgba()
    } else {
        TOKENS.colours.text.rgba()
    };
    // Armed destructive rows use a danger background with white ink (GNOME's
    // confirm styling); a plain accent-blue highlight would leave red-on-blue.
    let row_colours = if armed {
        ButtonColorsThemePartial::new()
            .background(TOKENS.colours.danger.rgba())
            .hover_background(TOKENS.colours.danger.rgba())
            .border_fill(Color::TRANSPARENT)
            .focus_border_fill(TOKENS.colours.accent.rgba())
            .color(TOKENS.colours.accent_text.rgba())
    } else {
        button_colours(selected)
    };
    rect()
        .width(Size::fill())
        .on_pointer_enter(move |_| hover_selection.set(index))
        .child(
            Button::new()
                .flat()
                .theme_colors(row_colours)
                .theme_layout(button_layout(
                    Size::fill(),
                    TOKENS.popover.control_height,
                    (0.0, TOKENS.popover.control_padding),
                    TOKENS.popover.row_radius,
                ))
                .on_press(move |_| {
                    click_selection.set(index);
                    press_action(action, armed_state, generation, &sink);
                })
                .child(
                    rect()
                        .width(Size::fill())
                        .horizontal()
                        .content(Content::Flex)
                        .cross_align(Alignment::Center)
                        .spacing(TOKENS.popover.row_gap)
                        .child(
                            icon(action.icon())
                                .color(glyph_colour)
                                .a11y_alt(action.accessibility_label(armed)),
                        )
                        .child(
                            label()
                                .text(label_text)
                                .width(Size::flex(1.0))
                                .font_size(TOKENS.typography.label_size)
                                .color(text_colour),
                        ),
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
                format!("Secured - {}%", access_point.strength)
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
        let layout = use_popover_layout();
        let view = use_state(|| QuickSettingsView::Root);
        let selected = use_state(|| 0_usize);
        let armed = use_state(|| None::<SessionAction>);
        let generation = use_state(|| 0_u64);
        let escape_generation = context.escape_generation;
        let handled_escape = use_state(|| *escape_generation.peek());
        let key_sequence = context.session_key.read().as_ref().map(|event| event.sequence);
        let mut effect_view = view;
        let mut effect_handled_escape = handled_escape;
        let mut effect_armed = armed;
        let effect_generation = generation;
        let close_sink = sink.clone();

        {
            let context = context.clone();
            let sink = sink.clone();
            use_side_effect_with_deps(&key_sequence, move |_| {
                if *view.peek() != QuickSettingsView::Session {
                    return;
                }
                let Some(event) = context.session_key.peek().clone() else {
                    return;
                };
                handle_key(&event.press, selected, armed, generation, &sink);
            });
        }

        use_side_effect(move || {
            let generation = *escape_generation.read();
            if generation == *effect_handled_escape.peek() {
                return;
            }
            effect_handled_escape.set(generation);
            let view_now = *effect_view.peek();
            if view_now == QuickSettingsView::Session && effect_armed.peek().is_some() {
                disarm(effect_armed, effect_generation);
                return;
            }
            let action = escape_action(view_now);
            eprintln!("[bar] quick settings escape {action:?}");
            match action {
                EscapeAction::Back => {
                    effect_armed.set(None);
                    effect_view.set(QuickSettingsView::Root);
                }
                EscapeAction::Close => close_sink.close(BarPanel::QuickSettings),
            }
        });

        let content = match *view.read() {
            QuickSettingsView::Root => root_view(&context, &sink, view, layout.compact()),
            QuickSettingsView::Wifi => wifi_drill(&context.network.read(), &sink, view),
            QuickSettingsView::Bluetooth => bluetooth_drill(&context.bluetooth.read(), &sink, view),
            QuickSettingsView::Mixer => mixer_drill(&context.audio.read(), &sink, view),
            QuickSettingsView::Session => session_view(
                *selected.read(),
                *armed.read(),
                view,
                selected,
                armed,
                generation,
                &sink,
            ),
        };

        popover_frame().child(
            ScrollView::new()
                .height(Size::auto())
                .max_height(Size::px(layout.inner_max_height()))
                .show_scrollbar(true)
                .scroll_with_arrows(true)
                .child(content),
        )
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
