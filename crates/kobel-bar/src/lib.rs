//! The complete presentation and layer-shell policy for the independent top bar.

mod notifications;
mod quick_settings;

pub use quick_settings::quick_settings_popup_app;

use std::cell::Cell;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use async_io::Timer;
use chrono::{Datelike, Days, Local, Months, NaiveDate, NaiveTime, TimeZone};
use freya_components::button::{Button, ButtonColorsThemePartial, ButtonLayoutThemePartial};
use freya_components::scrollviews::ScrollView;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{
    AudioSnapshot, BatterySnapshot, BluetoothSnapshot, BrightnessSnapshot, CalendarSnapshot, Command, GnoblinSnapshot,
    NetworkSnapshot, NotifdSnapshot, PowerSnapshot, ServiceEvent, SettingsSnapshot,
};
use kobel_theme::{TOKENS, icons};
use kobel_wayland::{
    Anchor, KeyPress, KeyboardInteractivity, LoopWaker, Margins, PopupAnchor, PopupConfig, PopupGravity, SurfaceConfig,
    SurfaceId, SurfaceSize,
};
use torin::prelude::{Alignment, Area, Content, Size};

pub const SURFACE_HEIGHT: u32 = TOKENS.bar.height;
const MAX_VISIBLE_EVENTS: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BarPanel {
    Calendar,
    QuickSettings,
}

/// Output-resolved viewport policy shared by an xdg popup and its Freya content.
///
/// The outer surface and inner scroll limits must use the same values; otherwise a
/// compositor clamp can leave a panel measuring against stale desktop-sized bounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PopoverLayout {
    pub width: u32,
    pub max_height: u32,
}

impl PopoverLayout {
    pub fn for_output(output_size: (u32, u32)) -> Self {
        Self::with_max_width(output_size, TOKENS.popover.width)
    }

    /// Panel-aware width: the calendar acts as GNOME's two-column date menu.
    pub fn for_output_panel(output_size: (u32, u32), panel: BarPanel) -> Self {
        let max_width = match panel {
            BarPanel::Calendar => TOKENS.popover.wide_width,
            _ => TOKENS.popover.width,
        };
        Self::with_max_width(output_size, max_width)
    }

    fn with_max_width(output_size: (u32, u32), max_width: u32) -> Self {
        let (output_width, output_height) = output_size;
        let horizontal_insets = TOKENS.popover.screen_inset.saturating_mul(2);
        let vertical_chrome = SURFACE_HEIGHT.saturating_add(TOKENS.popover.screen_inset);

        Self {
            width: output_width.saturating_sub(horizontal_insets).clamp(1, max_width),
            max_height: output_height
                .saturating_sub(vertical_chrome)
                .clamp(1, TOKENS.popover.max_height),
        }
    }

    pub fn inner_max_height(self) -> f32 {
        (self.max_height as f32 - TOKENS.popover.padding * 2.0).max(1.0)
    }

    pub fn compact(self) -> bool {
        self.width < TOKENS.popover.compact_width
    }
}

impl Default for PopoverLayout {
    fn default() -> Self {
        Self {
            width: TOKENS.popover.width,
            max_height: TOKENS.popover.max_height,
        }
    }
}

#[derive(Debug)]
pub enum BarAction {
    TogglePanel {
        parent: SurfaceId,
        panel: BarPanel,
        anchor_rect: (i32, i32, i32, i32),
    },
    ClosePanel {
        parent: SurfaceId,
        panel: BarPanel,
    },
    Service(Command),
}

#[derive(Clone)]
pub struct BarActionSink {
    sender: mpsc::Sender<BarAction>,
    waker: Option<LoopWaker>,
    parent: Rc<Cell<Option<SurfaceId>>>,
}

impl BarActionSink {
    pub fn new(sender: mpsc::Sender<BarAction>, waker: LoopWaker) -> Self {
        Self {
            sender,
            waker: Some(waker),
            parent: Rc::new(Cell::new(None)),
        }
    }

    pub fn bind_parent(&self, parent: SurfaceId) {
        self.parent.set(Some(parent));
    }

    fn inert() -> Self {
        let (sender, _receiver) = mpsc::channel();
        Self {
            sender,
            waker: None,
            parent: Rc::new(Cell::new(None)),
        }
    }
    #[cfg(test)]
    fn testing(sender: mpsc::Sender<BarAction>, parent: SurfaceId) -> Self {
        Self {
            sender,
            waker: None,
            parent: Rc::new(Cell::new(Some(parent))),
        }
    }

    fn toggle(&self, panel: BarPanel, area: Area) {
        let Some(parent) = self.parent.get() else {
            return;
        };
        self.send(BarAction::TogglePanel {
            parent,
            panel,
            anchor_rect: (
                area.min_x().floor() as i32,
                area.min_y().floor() as i32,
                area.width().ceil() as i32,
                area.height().ceil() as i32,
            ),
        });
    }

    fn close(&self, panel: BarPanel) {
        let Some(parent) = self.parent.get() else {
            return;
        };
        self.send(BarAction::ClosePanel { parent, panel });
    }

    fn service(&self, command: Command) {
        self.send(BarAction::Service(command));
    }

    fn send(&self, action: BarAction) {
        if self.sender.send(action).is_ok()
            && let Some(waker) = &self.waker
        {
            waker.wake();
        }
    }
}

/// Latest service values retained independently of mounted output surfaces.
///
/// Output hot-plug can happen after providers have emitted their initial
/// snapshots. Keeping those values here lets a newly mounted bar start from
/// current state instead of waiting for another battery or network change.
#[derive(Clone, Debug, PartialEq)]
pub struct BarSnapshots {
    audio: AudioSnapshot,
    battery: BatterySnapshot,
    network: NetworkSnapshot,
    calendar: CalendarSnapshot,
    bluetooth: BluetoothSnapshot,
    brightness: BrightnessSnapshot,
    power: PowerSnapshot,
    settings: SettingsSnapshot,
    notifications: NotifdSnapshot,
    gnoblin: GnoblinSnapshot,
}

impl Default for BarSnapshots {
    fn default() -> Self {
        Self {
            audio: AudioSnapshot {
                volume: 0.0,
                muted: false,
                streams: Vec::new(),
            },
            battery: BatterySnapshot::default(),
            network: NetworkSnapshot::default(),
            calendar: CalendarSnapshot::default(),
            bluetooth: BluetoothSnapshot::default(),
            brightness: BrightnessSnapshot::default(),
            power: PowerSnapshot::default(),
            settings: SettingsSnapshot::default(),
            notifications: NotifdSnapshot::default(),
            gnoblin: GnoblinSnapshot::default(),
        }
    }
}

impl BarSnapshots {
    pub fn apply(&mut self, event: &ServiceEvent) {
        match event {
            ServiceEvent::Audio(snapshot) => self.audio = snapshot.clone(),
            ServiceEvent::Battery(snapshot) => self.battery = snapshot.clone(),
            ServiceEvent::Network(snapshot) => self.network = snapshot.clone(),
            ServiceEvent::Calendar(snapshot) => self.calendar = snapshot.clone(),
            ServiceEvent::Bluetooth(snapshot) => self.bluetooth = snapshot.clone(),
            ServiceEvent::Brightness(snapshot) => self.brightness = snapshot.clone(),
            ServiceEvent::Power(snapshot) => self.power = snapshot.clone(),
            ServiceEvent::Settings(snapshot) => self.settings = snapshot.clone(),
            ServiceEvent::Gnoblin(snapshot) => self.gnoblin = snapshot.clone(),
            ServiceEvent::Notifd(snapshot) => self.notifications = snapshot.clone(),
            _ => {}
        }
    }
}

#[derive(Clone)]
struct SessionKeyDelivery {
    sequence: u64,
    press: KeyPress,
}

/// Reactive service state installed independently in every output's Freya tree.
#[derive(Clone)]
pub struct BarContext {
    audio: State<AudioSnapshot>,
    battery: State<BatterySnapshot>,
    network: State<NetworkSnapshot>,
    calendar: State<CalendarSnapshot>,
    bluetooth: State<BluetoothSnapshot>,
    brightness: State<BrightnessSnapshot>,
    power: State<PowerSnapshot>,
    settings: State<SettingsSnapshot>,
    gnoblin: State<GnoblinSnapshot>,
    notifications: State<NotifdSnapshot>,
    escape_generation: State<u64>,
    session_key: State<Option<SessionKeyDelivery>>,
    session_sequence: Rc<Cell<u64>>,
}

impl BarContext {
    pub fn create() -> Self {
        Self::from_snapshots(&BarSnapshots::default())
    }

    pub fn from_snapshots(snapshots: &BarSnapshots) -> Self {
        Self {
            audio: State::create(snapshots.audio.clone()),
            battery: State::create(snapshots.battery.clone()),
            network: State::create(snapshots.network.clone()),
            calendar: State::create(snapshots.calendar.clone()),
            bluetooth: State::create(snapshots.bluetooth.clone()),
            brightness: State::create(snapshots.brightness.clone()),
            power: State::create(snapshots.power.clone()),
            settings: State::create(snapshots.settings.clone()),
            gnoblin: State::create(snapshots.gnoblin.clone()),
            notifications: State::create(snapshots.notifications.clone()),
            escape_generation: State::create(0),
            session_key: State::create(None),
            session_sequence: Rc::new(Cell::new(0)),
        }
    }

    pub fn request_escape(&self) {
        let mut escape_generation = self.escape_generation;
        let next = escape_generation.peek().wrapping_add(1);
        escape_generation.set(next);
    }

    pub fn deliver_session_key(&self, press: KeyPress) {
        let sequence = self.session_sequence.get().wrapping_add(1);
        self.session_sequence.set(sequence);
        let mut session_key = self.session_key;
        session_key.set(Some(SessionKeyDelivery { sequence, press }));
    }

    pub fn apply(&self, event: &ServiceEvent) {
        match event {
            ServiceEvent::Audio(snapshot) => {
                let mut audio = self.audio;
                audio.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Battery(snapshot) => {
                let mut battery = self.battery;
                battery.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Network(snapshot) => {
                let mut network = self.network;
                network.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Calendar(snapshot) => {
                let mut calendar = self.calendar;
                calendar.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Bluetooth(snapshot) => {
                let mut bluetooth = self.bluetooth;
                bluetooth.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Brightness(snapshot) => {
                let mut brightness = self.brightness;
                brightness.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Power(snapshot) => {
                let mut power = self.power;
                power.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Settings(snapshot) => {
                let mut settings = self.settings;
                settings.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Gnoblin(snapshot) => {
                let mut gnoblin = self.gnoblin;
                gnoblin.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Notifd(snapshot) => {
                let mut notifications = self.notifications;
                notifications.set_if_modified(snapshot.clone());
            }
            _ => {}
        }
    }
}

pub(crate) fn icon(bytes: &'static [u8]) -> SvgViewer {
    SvgViewer::new(bytes)
        .color(TOKENS.colours.text_muted.rgba())
        .width(Size::px(TOKENS.chrome_icon_size))
        .height(Size::px(TOKENS.chrome_icon_size))
}

pub(crate) fn decorative_icon(bytes: &'static [u8]) -> SvgViewer {
    icon(bytes).a11y_builder(|node| node.set_hidden())
}

fn compact_bar_width(physical_width: f32, scale_factor: f64) -> bool {
    let logical_width = physical_width / scale_factor.max(f64::EPSILON) as f32;
    logical_width <= TOKENS.bar.compact_width
}

/// The one component used by both the layer-shell process and native preview.
pub fn bar_app() -> impl IntoElement {
    let platform = Platform::get();
    let compact = compact_bar_width(platform.root_size.read().width, *platform.scale_factor.read());
    let right = rect()
        .width(if compact { Size::auto() } else { Size::flex(1.0) })
        .height(Size::fill())
        .horizontal()
        .cross_align(Alignment::Center)
        .main_align(Alignment::End)
        .spacing(TOKENS.bar.module_gap)
        .child(StatusPill { compact });

    let mut bar = rect()
        .width(Size::fill())
        .height(Size::fill())
        .background(TOKENS.colours.panel.rgba())
        .padding((0.0, TOKENS.bar.horizontal_padding))
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .font_family(TOKENS.typography.family)
        .color(TOKENS.colours.text.rgba());

    if compact {
        bar = bar
            .child(ClockButton { compact })
            .child(rect().width(Size::flex(1.0)).height(Size::fill()))
            .child(right);
    } else {
        bar = bar
            .child(
                rect()
                    .width(Size::flex(1.0))
                    .height(Size::fill())
                    .horizontal()
                    .cross_align(Alignment::Center)
                    .main_align(Alignment::Start)
                    .child(WorkspaceIndicator),
            )
            .child(ClockButton { compact })
            .child(right);
    }

    bar
}

/// Preview wrapper with default service snapshots.
pub fn bar_preview_app() -> impl IntoElement {
    use_provide_context(BarContext::create);
    use_provide_context(BarActionSink::inert);
    bar_app()
}

#[derive(PartialEq)]
struct WorkspaceIndicator;

impl Component for WorkspaceIndicator {
    fn render(&self) -> impl IntoElement {
        // GNOME 48+ shows workspace dots here. gnoblin exposes no workspace state,
        // so render a single dot for the one workspace. Matches `.workspace-dot`:
        // circular, panel foreground, half the status-icon size.
        let dot = TOKENS.chrome_icon_size * 0.5;
        rect()
            .height(Size::px(TOKENS.bar.control_height))
            .padding((0.0, TOKENS.bar.control_padding))
            .center()
            .child(
                rect()
                    .width(Size::px(dot))
                    .height(Size::px(dot))
                    .corner_radius(999.0)
                    .background(TOKENS.colours.text.rgba()),
            )
    }
}

fn button_colours(background: Color, hover_background: Color) -> ButtonColorsThemePartial {
    ButtonColorsThemePartial::new()
        .background(background)
        .hover_background(hover_background)
        .border_fill(Color::TRANSPARENT)
        .focus_border_fill(TOKENS.colours.accent.rgba())
        .color(TOKENS.colours.text.rgba())
}

fn button_layout(width: Size, height: f32, padding: (f32, f32), corner_radius: f32) -> ButtonLayoutThemePartial {
    ButtonLayoutThemePartial::new()
        .margin(0.0)
        .corner_radius(corner_radius)
        .width(width)
        .height(Size::px(height))
        .padding(padding)
}

pub(crate) fn popover_frame() -> Rect {
    rect()
        .width(Size::fill())
        .padding(TOKENS.popover.padding)
        .corner_radius(TOKENS.popover.radius)
        .background(TOKENS.colours.popover.rgba())
        .border(
            Border::new()
                .fill(TOKENS.colours.border.rgba())
                .width(TOKENS.popover.border_width),
        )
        .font_family(TOKENS.typography.family)
        .color(TOKENS.colours.text.rgba())
}

pub(crate) fn use_popover_layout() -> PopoverLayout {
    use_try_consume::<State<PopoverLayout>>()
        .map(|layout| *layout.read())
        .unwrap_or_default()
}

#[derive(PartialEq)]
struct ClockButton {
    compact: bool,
}

fn clock_text() -> (String, String) {
    let now = Local::now();
    (now.format("%H:%M").to_string(), now.format("%a %-d %b").to_string())
}

impl Component for ClockButton {
    fn render(&self) -> impl IntoElement {
        let sink = use_consume::<BarActionSink>();
        let bounds = use_state(Area::default);
        let mut measured = bounds;
        let open_calendar = sink.clone();
        let clock = use_hook(|| {
            let clock = State::create(clock_text());
            let mut writer = clock;
            let platform = Platform::get();
            spawn(async move {
                loop {
                    Timer::after(Duration::from_secs(10)).await;
                    writer.set(clock_text());
                    platform.send(UserEvent::RequestRedraw);
                }
            });
            clock
        });
        let (time, date) = clock.read().clone();
        let accessible_clock = format!("Open calendar, {date}, {time}");

        rect()
            .on_sized(move |event: Event<SizedEventData>| measured.set(event.area))
            .child(
                Button::new()
                    .flat()
                    .theme_colors(button_colours(Color::TRANSPARENT, TOKENS.colours.hover.rgba().into()))
                    .theme_layout(button_layout(
                        Size::auto(),
                        TOKENS.bar.control_height,
                        (0.0, TOKENS.bar.control_padding),
                        TOKENS.bar.radius,
                    ))
                    .on_press(move |_| open_calendar.toggle(BarPanel::Calendar, *bounds.read()))
                    .child({
                        let mut content = rect()
                            .horizontal()
                            .cross_align(Alignment::Center)
                            .spacing(TOKENS.bar.module_gap)
                            .child(
                                label()
                                    .text(time)
                                    .a11y_alt(accessible_clock)
                                    .font_size(TOKENS.typography.label_size)
                                    .font_weight(TOKENS.typography.semibold_weight),
                            );
                        if !self.compact {
                            content = content.child(
                                label()
                                    .text(date)
                                    .font_size(TOKENS.typography.small_size)
                                    .color(TOKENS.colours.text_muted.rgba()),
                            );
                        }
                        content
                    }),
            )
    }
}

#[derive(PartialEq)]
struct StatusPill {
    compact: bool,
}

impl Component for StatusPill {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let sink = use_consume::<BarActionSink>();
        let bounds = use_state(Area::default);
        let mut measured = bounds;
        let open_quick_settings = sink.clone();
        let audio = context.audio.read();
        let battery = context.battery.read();
        let network = context.network.read();

        let mut status = rect()
            .height(Size::px(TOKENS.bar.control_height))
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(TOKENS.bar.module_gap)
            .padding((0.0, TOKENS.bar.control_padding))
            .child(decorative_icon(icons::WIFI_HIGH))
            .child(decorative_icon(icons::SPEAKER_HIGH));

        if battery.present {
            status = status.child(decorative_icon(icons::BATTERY_HIGH));
            if !self.compact {
                status = status.child(
                    label()
                        .text(format!("{}%", battery.percentage.round() as i64))
                        .font_size(TOKENS.typography.small_size)
                        .font_weight(TOKENS.typography.semibold_weight),
                );
            }
        }

        if !network.available || !network.enabled || audio.muted {
            status = status.opacity(TOKENS.bar.muted_opacity);
        }

        rect()
            .on_sized(move |event: Event<SizedEventData>| measured.set(event.area))
            .child(
                Button::new()
                    .flat()
                    .theme_colors(button_colours(
                        TOKENS.colours.card.rgba().into(),
                        TOKENS.colours.hover.rgba().into(),
                    ))
                    .theme_layout(button_layout(
                        Size::auto(),
                        TOKENS.bar.control_height,
                        (0.0, 0.0),
                        TOKENS.bar.radius,
                    ))
                    .on_press(move |_| open_quick_settings.toggle(BarPanel::QuickSettings, *bounds.read()))
                    .child(status.child(label().text("").a11y_alt("Open quick settings"))),
            )
    }
}

fn month_start(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap_or(date)
}

fn local_midnight_epoch(date: NaiveDate) -> Option<i64> {
    Local
        .from_local_datetime(&date.and_time(NaiveTime::MIN))
        .earliest()
        .map(|value| value.timestamp())
}

fn request_month(sink: &BarActionSink, start: NaiveDate) {
    let Some(end) = start.checked_add_months(Months::new(1)) else {
        return;
    };
    let (Some(since), Some(until)) = (local_midnight_epoch(start), local_midnight_epoch(end)) else {
        return;
    };
    sink.service(Command::SetCalendarRange { since, until });
}

fn event_occurs_on(event: &kobel_services::CalendarEvent, date: NaiveDate) -> bool {
    let Some(next_date) = date.checked_add_days(Days::new(1)) else {
        return false;
    };
    let (Some(day_start), Some(day_end)) = (local_midnight_epoch(date), local_midnight_epoch(next_date)) else {
        return false;
    };
    let event_end = if event.end_epoch > event.start_epoch {
        event.end_epoch
    } else {
        event.start_epoch.saturating_add(1)
    };
    event.start_epoch < day_end && event_end > day_start
}
fn event_time_label(event: &kobel_services::CalendarEvent, date: NaiveDate) -> String {
    if event.all_day {
        return "All day".to_string();
    }
    let Some(start) = Local.timestamp_opt(event.start_epoch, 0).single() else {
        return "Unknown time".to_string();
    };
    if start.date_naive() == date {
        start.format("%H:%M").to_string()
    } else {
        "Ongoing".to_string()
    }
}

fn visible_events_for_day(
    events: &[kobel_services::CalendarEvent],
    date: NaiveDate,
) -> (Vec<&kobel_services::CalendarEvent>, usize) {
    let mut visible = Vec::with_capacity(MAX_VISIBLE_EVENTS);
    let mut total = 0_usize;
    for event in events.iter().filter(|event| event_occurs_on(event, date)) {
        total += 1;
        if visible.len() < MAX_VISIBLE_EVENTS {
            visible.push(event);
        }
    }
    (visible, total.saturating_sub(MAX_VISIBLE_EVENTS))
}

#[derive(PartialEq)]
struct CalendarPanel;

impl Component for CalendarPanel {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let sink = use_consume::<BarActionSink>();
        let layout = use_popover_layout();
        let initial_month = month_start(Local::now().date_naive());
        let viewed_month = use_state(move || initial_month);
        let selected = use_state(|| Local::now().date_naive());

        let initial_request = sink.clone();
        use_hook(move || request_month(&initial_request, initial_month));

        let month_start = *viewed_month.read();
        let next_month = month_start.checked_add_months(Months::new(1)).unwrap_or(month_start);
        let today = Local::now().date_naive();
        let selected_date = *selected.read();
        let leading_days = month_start.weekday().num_days_from_monday();
        let days_in_month = (next_month - month_start).num_days() as u32;

        let mut weekday_row = rect()
            .width(Size::fill())
            .horizontal()
            .content(Content::Flex)
            .spacing(TOKENS.popover.row_gap);
        for weekday in ["M", "T", "W", "T", "F", "S", "S"] {
            weekday_row = weekday_row.child(
                rect().width(Size::flex(1.0)).center().child(
                    label()
                        .text(weekday)
                        .font_size(TOKENS.typography.small_size)
                        .color(TOKENS.colours.text_muted.rgba()),
                ),
            );
        }

        let calendar = context.calendar.read();
        let mut grid = rect()
            .width(Size::fill())
            .vertical()
            .spacing(TOKENS.popover.row_gap)
            .child(weekday_row);
        for week in 0..6_u32 {
            let mut row = rect()
                .width(Size::fill())
                .horizontal()
                .content(Content::Flex)
                .spacing(TOKENS.popover.row_gap);
            for weekday in 0..7_u32 {
                let index = week * 7 + weekday;
                let day = index.checked_sub(leading_days).map(|value| value + 1);
                let Some(day) = day.filter(|day| *day <= days_in_month) else {
                    row = row.child(
                        rect()
                            .width(Size::flex(1.0))
                            .height(Size::px(TOKENS.popover.control_height)),
                    );
                    continue;
                };
                let date = month_start.with_day(day).unwrap_or(month_start);
                let has_event = calendar.events.iter().any(|event| event_occurs_on(event, date));
                let is_selected = date == selected_date;
                let mut selected_writer = selected;

                let mut day_content = rect().vertical().center().child(
                    label()
                        .text(day.to_string())
                        .a11y_alt(date.format("%A, %-d %B %Y").to_string())
                        .font_size(TOKENS.typography.body_size)
                        .font_weight(if date == today {
                            TOKENS.typography.semibold_weight
                        } else {
                            TOKENS.typography.regular_weight
                        }),
                );
                if has_event {
                    day_content = day_content.child(
                        rect()
                            .width(Size::px(TOKENS.popover.indicator_size))
                            .height(Size::px(TOKENS.popover.indicator_size))
                            .corner_radius(TOKENS.popover.indicator_size / 2.0)
                            .background(TOKENS.colours.accent.rgba()),
                    );
                }

                let background = if is_selected {
                    TOKENS.colours.active.rgba().into()
                } else if date == today {
                    TOKENS.colours.hover.rgba().into()
                } else {
                    Color::TRANSPARENT
                };
                row = row.child(
                    Button::new()
                        .flat()
                        .theme_colors(button_colours(background, TOKENS.colours.hover.rgba().into()))
                        .theme_layout(button_layout(
                            Size::flex(1.0),
                            TOKENS.popover.control_height,
                            (0.0, 0.0),
                            TOKENS.popover.row_radius,
                        ))
                        .on_press(move |_| selected_writer.set(date))
                        .child(day_content),
                );
            }
            grid = grid.child(row);
        }

        let has_calendars = calendar.has_calendars;
        let (matching_events, overflow_count) = visible_events_for_day(&calendar.events, selected_date);
        let event_rows = matching_events
            .into_iter()
            .map(|event| {
                let when = event_time_label(event, selected_date);
                (event.summary.clone(), when)
            })
            .collect::<Vec<_>>();
        drop(calendar);

        let mut events = rect().width(Size::fill()).vertical().spacing(TOKENS.popover.row_gap);
        if !has_calendars {
            events = events.child(
                label()
                    .text("No calendars connected")
                    .font_size(TOKENS.typography.body_size)
                    .color(TOKENS.colours.text_muted.rgba()),
            );
        } else if event_rows.is_empty() {
            events = events.child(
                label()
                    .text("No events for this day")
                    .font_size(TOKENS.typography.body_size)
                    .color(TOKENS.colours.text_muted.rgba()),
            );
        } else {
            for (summary, when) in event_rows {
                events = events.child(
                    rect()
                        .width(Size::fill())
                        .padding(TOKENS.popover.control_padding)
                        .corner_radius(TOKENS.popover.row_radius)
                        .background(TOKENS.colours.card.rgba())
                        .vertical()
                        .spacing(TOKENS.bar.module_gap)
                        .child(
                            label()
                                .text(summary)
                                .max_lines(2)
                                .text_overflow(TextOverflow::Ellipsis)
                                .font_size(TOKENS.typography.body_size)
                                .font_weight(TOKENS.typography.medium_weight),
                        )
                        .child(
                            label()
                                .text(when)
                                .max_lines(1)
                                .font_size(TOKENS.typography.small_size)
                                .color(TOKENS.colours.text_muted.rgba()),
                        ),
                );
            }
            if overflow_count > 0 {
                events = events.child(
                    label()
                        .text(format!(
                            "+{overflow_count} more event{}",
                            if overflow_count == 1 { "" } else { "s" }
                        ))
                        .font_size(TOKENS.typography.small_size)
                        .color(TOKENS.colours.text_muted.rgba()),
                );
            }
        }

        let previous_sink = sink.clone();
        let mut previous_month = viewed_month;
        let mut previous_selected = selected;
        let previous = Button::new()
            .flat()
            .theme_colors(button_colours(
                TOKENS.colours.card.rgba().into(),
                TOKENS.colours.hover.rgba().into(),
            ))
            .theme_layout(button_layout(
                Size::px(TOKENS.popover.control_height),
                TOKENS.popover.control_height,
                (0.0, 0.0),
                TOKENS.popover.row_radius,
            ))
            .on_press(move |_| {
                let Some(month) = (*previous_month.read()).checked_sub_months(Months::new(1)) else {
                    return;
                };
                previous_month.set(month);
                previous_selected.set(month);
                request_month(&previous_sink, month);
            })
            .child(
                icon(icons::CARET_LEFT)
                    .color(TOKENS.colours.text.rgba())
                    .a11y_alt("Previous month"),
            );

        let next_sink = sink.clone();
        let mut next_month_state = viewed_month;
        let mut next_selected = selected;
        let next = Button::new()
            .flat()
            .theme_colors(button_colours(
                TOKENS.colours.card.rgba().into(),
                TOKENS.colours.hover.rgba().into(),
            ))
            .theme_layout(button_layout(
                Size::px(TOKENS.popover.control_height),
                TOKENS.popover.control_height,
                (0.0, 0.0),
                TOKENS.popover.row_radius,
            ))
            .on_press(move |_| {
                let Some(month) = (*next_month_state.read()).checked_add_months(Months::new(1)) else {
                    return;
                };
                next_month_state.set(month);
                next_selected.set(month);
                request_month(&next_sink, month);
            })
            .child(
                icon(icons::CARET_RIGHT)
                    .color(TOKENS.colours.text.rgba())
                    .a11y_alt("Next month"),
            );

        let content = rect()
            .width(Size::fill())
            .vertical()
            .spacing(TOKENS.popover.section_gap)
            .child(
                rect()
                    .width(Size::fill())
                    .horizontal()
                    .cross_align(Alignment::Center)
                    .content(Content::Flex)
                    .child(previous)
                    .child(
                        rect().width(Size::flex(1.0)).center().child(
                            label()
                                .text(month_start.format("%B %Y").to_string())
                                .font_size(TOKENS.typography.title_size)
                                .font_weight(TOKENS.typography.semibold_weight),
                        ),
                    )
                    .child(next),
            )
            .child(grid)
            .child(
                label()
                    .text(selected_date.format("%A, %-d %B").to_string())
                    .font_size(TOKENS.typography.label_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            )
            .child(events);

        let calendar_column = ScrollView::new()
            .height(Size::auto())
            .max_height(Size::px(layout.inner_max_height()))
            .show_scrollbar(true)
            .scroll_with_arrows(true)
            .child(content);

        if layout.compact() {
            popover_frame().child(calendar_column)
        } else {
            popover_frame()
                .horizontal()
                .content(Content::Flex)
                .spacing(TOKENS.popover.section_gap)
                .child(rect().width(Size::flex(1.0)).child(notifications::notification_column(
                    &context,
                    &sink,
                    layout.inner_max_height(),
                    false,
                )))
                .child(
                    rect()
                        .width(Size::px(1.0))
                        .height(Size::px(layout.inner_max_height()))
                        .background(TOKENS.colours.border.rgba()),
                )
                .child(rect().width(Size::flex(1.0)).child(calendar_column))
        }
    }
}

pub fn calendar_popup_app() -> impl IntoElement {
    CalendarPanel
}

pub fn popup_config(panel: BarPanel, anchor_rect: (i32, i32, i32, i32), layout: PopoverLayout) -> PopupConfig {
    match panel {
        BarPanel::Calendar => PopupConfig::new(
            "kobel-calendar",
            anchor_rect,
            SurfaceSize::ContentSized {
                width: layout.width,
                max_height: layout.max_height,
            },
            PreferredTheme::Dark,
        )
        .anchor(PopupAnchor::Bottom)
        .gravity(PopupGravity::Bottom),
        BarPanel::QuickSettings => PopupConfig::new(
            "kobel-quick-settings",
            anchor_rect,
            SurfaceSize::ContentSized {
                width: layout.width,
                max_height: layout.max_height,
            },
            PreferredTheme::Dark,
        )
        .anchor(PopupAnchor::BottomRight)
        .gravity(PopupGravity::BottomLeft),
    }
}

/// Keep compositor geometry beside the component that owns it.
pub fn surface_config() -> SurfaceConfig {
    SurfaceConfig::new(
        "kobel-bar",
        SurfaceSize::Exact {
            width: 0,
            height: SURFACE_HEIGHT,
        },
        PreferredTheme::Dark,
    )
    .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
    .margins(Margins::default())
    .exclusive_zone(SURFACE_HEIGHT as i32)
    .keyboard_interactivity(KeyboardInteractivity::OnDemand)
}

#[cfg(test)]
mod tests {
    use chrono::{Days, NaiveDate};
    use freya_core::elements::image::Image;
    use freya_core::prelude::{IntoElement, Label, State, use_provide_context};
    use freya_testing::{TestingRunner, launch_test};
    use kobel_services::{
        AudioSnapshot, BatterySnapshot, CalendarEvent, Command, NetworkSnapshot, NotifdSnapshot, Notification,
        ServiceEvent,
    };
    use kobel_wayland::{Anchor, KeyboardInteractivity, PopupAnchor, PopupGravity, SurfaceSize};

    use super::notifications::notification_column;
    use super::{
        BarActionSink, BarContext, BarPanel, BarSnapshots, MAX_VISIBLE_EVENTS, PopoverLayout, SURFACE_HEIGHT, TOKENS,
        bar_preview_app, calendar_popup_app, event_occurs_on, event_time_label, local_midnight_epoch, popup_config,
        surface_config, visible_events_for_day,
    };

    #[test]
    fn component_mounts_in_the_headless_runner() {
        let mut runner = launch_test(bar_preview_app);
        runner.sync_and_update();
    }

    #[test]
    fn bar_icons_render_at_the_shared_chrome_size() {
        let mut runner = launch_test(bar_preview_app);
        runner.sync_and_update();
        runner.sync_and_update();
        let icon_areas = runner.find_many(|node, element| Image::try_downcast(element).map(|_| node.layout().area));
        assert!(!icon_areas.is_empty(), "bar preview did not render any chrome icons");
        for area in icon_areas {
            assert_eq!(area.width(), TOKENS.chrome_icon_size);
            assert_eq!(area.height(), TOKENS.chrome_icon_size);
        }
    }

    #[test]
    fn compact_bar_keeps_every_control_inside_phone_widths_at_one_and_two_x() {
        for (scale_factor, width) in [(1.0, 320.0), (2.0, 640.0)] {
            let mut runner = TestingRunner::new(
                bar_preview_app,
                (width, SURFACE_HEIGHT as f32 * scale_factor as f32).into(),
                |_| {},
                scale_factor,
            )
            .0;
            runner.sync_and_update();
            runner.sync_and_update();
            let overflow = runner.find_many(|node, _| {
                let area = node.layout().area;
                (area.min_x() < -0.01 || area.max_x() > width + 0.01).then_some(area)
            });
            assert!(
                overflow.is_empty(),
                "bar descendants escaped the {width}px viewport at {scale_factor}x: {overflow:?}",
            );

            assert!(
                runner
                    .find(|_, element| {
                        Label::try_downcast(element).filter(|label| label.text.as_ref() == "Activities")
                    })
                    .is_none(),
                "compact bars must surrender the decorative Activities label before controls collide",
            );
            assert!(
                runner
                    .find(|_, element| {
                        Label::try_downcast(element).filter(|label| {
                            label
                                .accessibility
                                .builder
                                .label()
                                .is_some_and(|name| name.starts_with("Open calendar, "))
                        })
                    })
                    .is_some(),
                "compact clock lost its calendar action name at {scale_factor}x",
            );
            assert!(
                runner
                    .find(|_, element| {
                        Label::try_downcast(element)
                            .filter(|label| label.accessibility.builder.label() == Some("Open quick settings"))
                    })
                    .is_some(),
                "missing compact bar control `Open quick settings` at {scale_factor}x",
            );
        }
    }

    fn assert_compact_popup_fits_width(mut runner: TestingRunner, width: f32, expected_label: &str) {
        runner.sync_and_update();
        runner.sync_and_update();
        assert!(
            runner
                .find(|_, element| Label::try_downcast(element).filter(|label| label.text.as_ref() == expected_label))
                .is_some(),
            "compact popup did not render its `{expected_label}` content",
        );
        let overflow = runner.find_many(|node, _| {
            let area = node.layout().area;
            (area.min_x() < -0.01 || area.max_x() > width + 0.01).then_some(area)
        });
        assert!(
            overflow.is_empty(),
            "popup descendants escaped the {width}px viewport: {overflow:?}"
        );
    }

    #[test]
    fn every_popup_renders_inside_a_short_phone_viewport() {
        let layout = PopoverLayout::for_output((320, 480));
        assert!(layout.compact());
        let viewport = (layout.width as f32, layout.max_height as f32).into();
        fn calendar() -> impl IntoElement {
            use_provide_context(BarContext::create);
            use_provide_context(BarActionSink::inert);
            use_provide_context(|| State::create(PopoverLayout::for_output((320, 480))));
            calendar_popup_app()
        }
        fn quick_settings() -> impl IntoElement {
            use_provide_context(BarContext::create);
            use_provide_context(BarActionSink::inert);
            use_provide_context(|| State::create(PopoverLayout::for_output((320, 480))));
            super::quick_settings_popup_app()
        }

        for (runner, expected_label) in [
            (TestingRunner::new(calendar, viewport, |_| {}, 1.0).0, "M"),
            (TestingRunner::new(quick_settings, viewport, |_| {}, 1.0).0, "Volume"),
        ] {
            assert_compact_popup_fits_width(runner, layout.width as f32, expected_label);
        }
    }

    #[test]
    fn latest_snapshots_survive_without_a_mounted_surface() {
        let audio = AudioSnapshot {
            volume: 0.42,
            muted: true,
            streams: Vec::new(),
        };
        let battery = BatterySnapshot {
            present: true,
            percentage: 73.0,
            charging: true,
            ..BatterySnapshot::default()
        };
        let network = NetworkSnapshot {
            available: true,
            enabled: true,
            active_ssid: Some("Kobel".to_string()),
            active_strength: 81,
            aps: Vec::new(),
        };
        let notifications = NotifdSnapshot {
            serving: true,
            dnd: true,
            notifications: Vec::new(),
        };

        let mut latest = BarSnapshots::default();
        latest.apply(&ServiceEvent::Audio(audio.clone()));
        latest.apply(&ServiceEvent::Battery(battery.clone()));
        latest.apply(&ServiceEvent::Network(network.clone()));
        latest.apply(&ServiceEvent::Notifd(notifications.clone()));

        assert_eq!(latest.audio, audio);
        assert_eq!(latest.battery, battery);
        assert_eq!(latest.network, network);
        assert_eq!(latest.notifications, notifications);
    }

    #[test]
    fn surface_spans_the_top_and_reserves_its_visual_height() {
        let config = surface_config();

        assert_eq!(
            config.size,
            SurfaceSize::Exact {
                width: 0,
                height: SURFACE_HEIGHT,
            }
        );
        assert_eq!(config.anchor, Anchor::TOP | Anchor::LEFT | Anchor::RIGHT);
        assert_eq!(config.exclusive_zone, SURFACE_HEIGHT as i32);
        assert_eq!(config.keyboard_interactivity, KeyboardInteractivity::OnDemand);
    }
    #[test]
    fn calendar_popup_mounts_in_the_headless_runner() {
        fn preview() -> impl IntoElement {
            use_provide_context(BarContext::create);
            use_provide_context(BarActionSink::inert);
            calendar_popup_app()
        }

        let mut runner = launch_test(preview);
        runner.sync_and_update();
    }

    #[test]
    fn quick_settings_popup_mounts_in_the_headless_runner() {
        fn preview() -> impl IntoElement {
            use_provide_context(BarContext::create);
            use_provide_context(BarActionSink::inert);
            super::quick_settings_popup_app()
        }

        let mut runner = launch_test(preview);
        runner.sync_and_update();
        let icons = runner.find_many(|_, element| Image::try_downcast(element).map(|_| ()));
        assert!(
            icons.len() >= 6,
            "quick settings should render a leading icon on each toggle, found {} icons",
            icons.len()
        );
    }

    #[test]
    fn notification_popup_mounts_with_an_empty_state() {
        fn preview() -> impl IntoElement {
            let context = use_provide_context(BarContext::create);
            let sink = use_provide_context(BarActionSink::inert);
            notification_column(&context, &sink, 480.0, false)
        }

        let mut runner = launch_test(preview);
        runner.sync_and_update();
        assert!(
            runner
                .find(|_, element| Label::try_downcast(element).filter(|label| label.text.as_ref() == "All caught up"))
                .is_some(),
        );
    }

    #[test]
    fn notification_controls_dispatch_service_commands() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let context_slot = std::rc::Rc::new(std::cell::RefCell::new(None::<BarContext>));
        let app_context_slot = context_slot.clone();
        let sink = BarActionSink::testing(sender, kobel_wayland::SurfaceId::new(7));
        let mut runner = launch_test(move || {
            let provided_sink = sink.clone();
            let context = use_provide_context(BarContext::create);
            app_context_slot.replace(Some(context.clone()));
            let sink = use_provide_context(move || provided_sink);
            notification_column(&context, &sink, 480.0, false)
        });
        runner.sync_and_update();

        context_slot
            .borrow()
            .as_ref()
            .expect("test context")
            .apply(&ServiceEvent::Notifd(NotifdSnapshot {
                serving: true,
                dnd: false,
                notifications: vec![Notification {
                    id: 42,
                    app_name: "Kobel test".to_string(),
                    app_icon: None,
                    summary: "Notification".to_string(),
                    body: "Body".to_string(),
                    actions: vec![("open".to_string(), "Open".to_string())],
                    critical: false,
                    time: 0,
                }],
            }));
        runner.sync_and_update();
        runner.sync_and_update();

        let dnd_area = runner
            .find(|node, element| {
                Label::try_downcast(element)
                    .filter(|label| label.text.as_ref() == "Do not disturb")
                    .map(|_| node.layout().area)
            })
            .expect("Do not disturb control");
        runner.click_cursor(dnd_area.center().to_f64());
        assert!(matches!(
            receiver.try_recv(),
            Ok(super::BarAction::Service(Command::SetDnd(true)))
        ));

        let clear_area = runner
            .find(|node, element| {
                Label::try_downcast(element)
                    .filter(|label| label.text.as_ref() == "Clear")
                    .map(|_| node.layout().area)
            })
            .expect("Clear control");
        runner.click_cursor(clear_area.center().to_f64());
        assert!(matches!(
            receiver.try_recv(),
            Ok(super::BarAction::Service(Command::ClearNotifications))
        ));

        let action_area = runner
            .find(|node, element| {
                Label::try_downcast(element)
                    .filter(|label| label.text.as_ref() == "Open")
                    .map(|_| node.layout().area)
            })
            .expect("notification action control");
        runner.click_cursor(action_area.center().to_f64());
        assert!(matches!(
            receiver.try_recv(),
            Ok(super::BarAction::Service(Command::InvokeNotificationAction {
                id: 42,
                action_key,
            })) if action_key == "open"
        ));
        let dismiss_area = runner
            .find(|node, element| {
                Image::try_downcast(element)
                    .filter(|icon| icon.accessibility.builder.label() == Some("Dismiss Notification"))
                    .map(|_| node.layout().area)
            })
            .expect("notification dismiss control");
        runner.click_cursor(dismiss_area.center().to_f64());
        assert!(matches!(
            receiver.try_recv(),
            Ok(super::BarAction::Service(Command::CloseNotification(42)))
        ));
    }

    #[test]
    fn quick_settings_power_control_opens_session_actions() {
        fn preview() -> impl IntoElement {
            use_provide_context(BarContext::create);
            use_provide_context(BarActionSink::inert);
            use_provide_context(|| State::create(PopoverLayout::for_output((320, 480))));
            super::quick_settings_popup_app()
        }

        let mut runner = launch_test(preview);
        runner.sync_and_update();
        let power_area = runner
            .find(|node, element| {
                Image::try_downcast(element)
                    .filter(|icon| icon.accessibility.builder.label() == Some("Power off / Log out"))
                    .map(|_| node.layout().area)
            })
            .expect("power control");
        runner.click_cursor(power_area.center().to_f64());
        runner.sync_and_update();
        for expected in ["Suspend", "Restart", "Power Off", "Log out"] {
            assert!(
                runner
                    .find(|_, element| Label::try_downcast(element).filter(|label| label.text.as_ref() == expected))
                    .is_some(),
                "missing session action text {expected}",
            );
            assert!(
                runner
                    .find(|_, element| {
                        Image::try_downcast(element).filter(|icon| icon.accessibility.builder.label() == Some(expected))
                    })
                    .is_some(),
                "session action button is not named {expected}",
            );
        }
    }

    #[test]
    fn quick_settings_system_row_dispatches_lock_and_settings() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let parent = kobel_wayland::SurfaceId::new(7);
        let sink = BarActionSink::testing(sender, parent);
        let mut runner = launch_test(move || {
            let provided = sink.clone();
            use_provide_context(BarContext::create);
            use_provide_context(move || provided);
            use_provide_context(|| State::create(PopoverLayout::for_output((320, 480))));
            super::quick_settings_popup_app()
        });
        runner.sync_and_update();

        let settings = runner
            .find(|node, element| {
                Image::try_downcast(element)
                    .filter(|icon| icon.accessibility.builder.label() == Some("Settings"))
                    .map(|_| node.layout().area)
            })
            .expect("settings control");
        runner.click_cursor(settings.center().to_f64());
        assert!(matches!(
            receiver.try_recv(),
            Ok(super::BarAction::Service(Command::LaunchApp(app))) if app == "org.gnome.Settings"
        ));

        let lock = runner
            .find(|node, element| {
                Image::try_downcast(element)
                    .filter(|icon| icon.accessibility.builder.label() == Some("Lock screen"))
                    .map(|_| node.layout().area)
            })
            .expect("lock control");
        runner.click_cursor(lock.center().to_f64());
        assert!(matches!(
            receiver.try_recv(),
            Ok(super::BarAction::Service(Command::Session(
                kobel_services::SessionVerb::Lock
            )))
        ));
    }

    #[test]
    fn session_back_disarms_so_reopened_destructive_action_rearms() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let parent = kobel_wayland::SurfaceId::new(7);
        let sink = BarActionSink::testing(sender, parent);
        let mut runner = launch_test(move || {
            let provided = sink.clone();
            use_provide_context(BarContext::create);
            use_provide_context(move || provided);
            use_provide_context(|| State::create(PopoverLayout::for_output((320, 480))));
            super::quick_settings_popup_app()
        });
        runner.sync_and_update();

        let open_power = |runner: &mut TestingRunner| {
            let area = runner
                .find(|node, element| {
                    Image::try_downcast(element)
                        .filter(|icon| icon.accessibility.builder.label() == Some("Power off / Log out"))
                        .map(|_| node.layout().area)
                })
                .expect("power control");
            runner.click_cursor(area.center().to_f64());
            runner.sync_and_update();
        };
        let click_restart = |runner: &mut TestingRunner| {
            let area = runner
                .find(|node, element| {
                    Image::try_downcast(element)
                        .filter(|icon| icon.accessibility.builder.label() == Some("Restart"))
                        .map(|_| node.layout().area)
                })
                .expect("restart row");
            runner.click_cursor(area.center().to_f64());
            runner.sync_and_update();
        };

        // Arm Restart (first press), then leave via the Back control.
        open_power(&mut runner);
        click_restart(&mut runner);
        let back = runner
            .find(|node, element| {
                Image::try_downcast(element)
                    .filter(|icon| icon.accessibility.builder.label() == Some("Back to quick settings"))
                    .map(|_| node.layout().area)
            })
            .expect("session back control");
        runner.click_cursor(back.center().to_f64());
        runner.sync_and_update();

        // Reopening must present a disarmed Restart row again...
        open_power(&mut runner);
        assert!(
            runner
                .find(|_, element| {
                    Label::try_downcast(element).filter(|label| label.text.as_ref() == "Press again to confirm restart")
                })
                .is_none(),
            "Back must disarm the armed destructive action before reopening",
        );
        // ...so its first press re-arms (dispatches nothing) rather than firing.
        click_restart(&mut runner);
        assert!(
            !matches!(receiver.try_recv(), Ok(super::BarAction::Service(Command::Session(_)))),
            "reopened destructive action fired on the first press",
        );
    }
    #[test]
    fn quick_settings_wifi_drill_is_reachable() {
        fn preview() -> impl IntoElement {
            use_provide_context(BarContext::create);
            use_provide_context(BarActionSink::inert);
            super::quick_settings_popup_app()
        }

        let mut runner = launch_test(preview);
        runner.sync_and_update();
        let drill = runner
            .find(|node, element| {
                Image::try_downcast(element)
                    .filter(|icon| icon.accessibility.builder.label() == Some("Open Wi-Fi details"))
                    .map(|_| node)
            })
            .expect("Wi-Fi drill button label");
        let area = drill.layout().area;
        runner.click_cursor((
            (area.min_x() + area.width() / 2.0) as f64,
            (area.min_y() + area.height() / 2.0) as f64,
        ));

        assert!(
            runner
                .find(|_, element| {
                    Label::try_downcast(element).filter(|label| label.text.as_ref() == "Turn Wi-Fi on")
                })
                .is_some(),
            "clicking the Wi-Fi drill control should replace the root view",
        );
    }

    #[test]
    fn popup_is_anchored_below_the_clock() {
        let anchor = (120, 4, 150, 24);
        let config = popup_config(BarPanel::Calendar, anchor, PopoverLayout::default());

        assert_eq!(config.anchor_rect, anchor);
        assert_eq!(config.anchor, PopupAnchor::Bottom);
        assert_eq!(config.gravity, PopupGravity::Bottom);
    }

    #[test]
    fn quick_settings_popup_aligns_its_right_edge_below_the_status_pill() {
        let anchor = (980, 4, 180, 24);
        let config = popup_config(BarPanel::QuickSettings, anchor, PopoverLayout::default());

        assert_eq!(config.anchor_rect, anchor);
        assert_eq!(config.anchor, PopupAnchor::BottomRight);
        assert_eq!(config.gravity, PopupGravity::BottomLeft);
    }

    #[test]
    fn popup_layout_uses_desktop_defaults_when_the_output_has_room() {
        let layout = PopoverLayout::for_output((1920, 1080));

        assert_eq!(layout, PopoverLayout::default());
        assert!(!layout.compact());
    }

    #[test]
    fn popup_layout_stays_inside_narrow_and_short_outputs() {
        let layout = PopoverLayout::for_output((320, 240));
        let config = popup_config(BarPanel::QuickSettings, (260, 4, 28, 24), layout);

        assert_eq!(
            config.size,
            SurfaceSize::ContentSized {
                width: 296,
                max_height: 196,
            },
        );
        assert!(layout.compact());
        assert_eq!(
            PopoverLayout::for_output((10, 10)),
            PopoverLayout {
                width: 1,
                max_height: 1
            }
        );
    }

    #[test]
    fn multi_day_and_zero_length_events_remain_visible_on_their_days() {
        let first = NaiveDate::from_ymd_opt(2026, 7, 10).expect("valid date");
        let second = first.checked_add_days(Days::new(1)).expect("valid next day");
        let third = second.checked_add_days(Days::new(1)).expect("valid next day");
        let first_epoch = local_midnight_epoch(first).expect("valid local midnight");
        let third_epoch = local_midnight_epoch(third).expect("valid local midnight");
        let multi_day = CalendarEvent {
            uid: "multi-day".to_string(),
            summary: "Conference".to_string(),
            start_epoch: first_epoch,
            end_epoch: third_epoch,
            all_day: true,
        };
        let zero_length = CalendarEvent {
            uid: "zero-length".to_string(),
            summary: "Reminder".to_string(),
            start_epoch: local_midnight_epoch(second).expect("valid local midnight") + 3_600,
            end_epoch: local_midnight_epoch(second).expect("valid local midnight") + 3_600,
            all_day: false,
        };

        assert!(event_occurs_on(&multi_day, first));
        assert!(event_occurs_on(&multi_day, second));
        assert!(!event_occurs_on(&multi_day, third));
        assert!(event_occurs_on(&zero_length, second));
        let timed_multi_day = CalendarEvent {
            uid: "timed-multi-day".to_string(),
            summary: "Migration".to_string(),
            start_epoch: first_epoch + 43_200,
            end_epoch: third_epoch + 43_200,
            all_day: false,
        };
        assert_ne!(event_time_label(&timed_multi_day, first), "Ongoing");
        assert_eq!(event_time_label(&timed_multi_day, second), "Ongoing");
    }

    #[test]
    fn busy_days_keep_a_bounded_preview_and_report_overflow() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 14).expect("valid date");
        let start = local_midnight_epoch(date).expect("valid local midnight") + 3_600;
        let events = (0..5)
            .map(|index| CalendarEvent {
                uid: format!("event-{index}"),
                summary: format!("Event {index}"),
                start_epoch: start + i64::from(index) * 60,
                end_epoch: start + i64::from(index) * 60 + 30,
                all_day: false,
            })
            .collect::<Vec<_>>();

        let (visible, overflow) = visible_events_for_day(&events, date);

        assert_eq!(visible.len(), MAX_VISIBLE_EVENTS);
        assert_eq!(visible[0].uid, "event-0");
        assert_eq!(visible[1].uid, "event-1");
        assert_eq!(overflow, 3);
    }
}
