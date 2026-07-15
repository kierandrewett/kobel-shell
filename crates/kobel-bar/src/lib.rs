//! The complete presentation and layer-shell policy for the independent top bar.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use async_io::Timer;
use chrono::{Datelike, Days, Local, Months, NaiveDate, NaiveTime, TimeZone};
use freya_components::button::{Button, ButtonColorsThemePartial, ButtonLayoutThemePartial};
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{AudioSnapshot, BatterySnapshot, CalendarSnapshot, Command, NetworkSnapshot, ServiceEvent};
use kobel_theme::{TOKENS, icons};
use kobel_wayland::{
    Anchor, KeyboardInteractivity, LoopWaker, Margins, PopupAnchor, PopupConfig, PopupGravity, SurfaceConfig,
    SurfaceId, SurfaceSize,
};
use torin::prelude::{Alignment, Area, Content, Size};

pub const SURFACE_HEIGHT: u32 = TOKENS.bar.height;
const MAX_VISIBLE_EVENTS: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BarPanel {
    Calendar,
}

#[derive(Debug)]
pub enum BarAction {
    TogglePanel {
        parent: SurfaceId,
        panel: BarPanel,
        anchor_rect: (i32, i32, i32, i32),
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
            _ => {}
        }
    }
}

/// Reactive service state installed independently in every output's Freya tree.
#[derive(Clone)]
pub struct BarContext {
    audio: State<AudioSnapshot>,
    battery: State<BatterySnapshot>,
    network: State<NetworkSnapshot>,
    calendar: State<CalendarSnapshot>,
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
        }
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
            _ => {}
        }
    }
}

fn icon(bytes: &'static [u8]) -> SvgViewer {
    SvgViewer::new(bytes)
        .color(TOKENS.colours.text_muted.rgba())
        .width(Size::px(TOKENS.bar.icon_size))
        .height(Size::px(TOKENS.bar.icon_size))
}

/// The one component used by both the layer-shell process and native preview.
pub fn bar_app() -> impl IntoElement {
    let left = rect()
        .width(Size::flex(1.0))
        .height(Size::fill())
        .horizontal()
        .cross_align(Alignment::Center)
        .main_align(Alignment::Start)
        .child(ActivitiesButton);

    let right = rect()
        .width(Size::flex(1.0))
        .height(Size::fill())
        .horizontal()
        .cross_align(Alignment::Center)
        .main_align(Alignment::End)
        .child(StatusPill);

    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background(TOKENS.colours.surface.rgba())
        .padding((0.0, TOKENS.bar.horizontal_padding))
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .font_family(TOKENS.typography.family)
        .color(TOKENS.colours.text.rgba())
        .child(left)
        .child(ClockButton)
        .child(right)
}

/// Preview wrapper with default service snapshots.
pub fn bar_preview_app() -> impl IntoElement {
    use_provide_context(BarContext::create);
    use_provide_context(BarActionSink::inert);
    bar_app()
}

#[derive(PartialEq)]
struct ActivitiesButton;

impl Component for ActivitiesButton {
    fn render(&self) -> impl IntoElement {
        rect()
            .height(Size::px(TOKENS.bar.control_height))
            .padding((0.0, TOKENS.bar.control_padding))
            .center()
            .child(
                label()
                    .text("Activities")
                    .font_size(TOKENS.typography.label_size)
                    .font_weight(TOKENS.typography.semibold_weight),
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

#[derive(PartialEq)]
struct ClockButton;

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

        rect()
            .on_sized(move |event: Event<SizedEventData>| measured.set(event.area))
            .child(
                Button::new()
                    .flat()
                    .theme_colors(button_colours(
                        Color::TRANSPARENT,
                        TOKENS.colours.surface_hover.rgba().into(),
                    ))
                    .theme_layout(button_layout(
                        Size::auto(),
                        TOKENS.bar.control_height,
                        (0.0, TOKENS.bar.control_padding),
                        TOKENS.bar.radius,
                    ))
                    .on_press(move |_| open_calendar.toggle(BarPanel::Calendar, *bounds.read()))
                    .child(
                        rect()
                            .horizontal()
                            .cross_align(Alignment::Center)
                            .spacing(TOKENS.bar.module_gap)
                            .child(
                                label()
                                    .text(time)
                                    .font_size(TOKENS.typography.label_size)
                                    .font_weight(TOKENS.typography.semibold_weight),
                            )
                            .child(
                                label()
                                    .text(date)
                                    .font_size(TOKENS.typography.small_size)
                                    .color(TOKENS.colours.text_muted.rgba()),
                            ),
                    ),
            )
    }
}

#[derive(PartialEq)]
struct StatusPill;

impl Component for StatusPill {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let audio = context.audio.read();
        let battery = context.battery.read();
        let network = context.network.read();

        let mut status = rect()
            .height(Size::px(TOKENS.bar.control_height))
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(TOKENS.bar.module_gap)
            .corner_radius(TOKENS.bar.radius)
            .padding((0.0, TOKENS.bar.control_padding))
            .background(TOKENS.colours.surface_elevated.rgba())
            .child(icon(icons::WIFI_HIGH))
            .child(icon(icons::SPEAKER_HIGH));

        if battery.present {
            status = status.child(icon(icons::BATTERY_HIGH)).child(
                label()
                    .text(format!("{}%", battery.percentage.round() as i64))
                    .font_size(TOKENS.typography.small_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            );
        }

        if !network.available || !network.enabled || audio.muted {
            status = status.opacity(0.65);
        }

        status
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
                    TOKENS.colours.surface_active.rgba().into()
                } else if date == today {
                    TOKENS.colours.surface_hover.rgba().into()
                } else {
                    Color::TRANSPARENT
                };
                row = row.child(
                    Button::new()
                        .flat()
                        .theme_colors(button_colours(background, TOKENS.colours.surface_hover.rgba().into()))
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
                        .background(TOKENS.colours.surface_elevated.rgba())
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
                TOKENS.colours.surface_elevated.rgba().into(),
                TOKENS.colours.surface_hover.rgba().into(),
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
                label()
                    .text("<")
                    .a11y_alt("Previous month")
                    .font_size(TOKENS.typography.title_size),
            );

        let next_sink = sink.clone();
        let mut next_month_state = viewed_month;
        let mut next_selected = selected;
        let next = Button::new()
            .flat()
            .theme_colors(button_colours(
                TOKENS.colours.surface_elevated.rgba().into(),
                TOKENS.colours.surface_hover.rgba().into(),
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
                label()
                    .text(">")
                    .a11y_alt("Next month")
                    .font_size(TOKENS.typography.title_size),
            );

        rect()
            .width(Size::fill())
            .padding(TOKENS.popover.padding)
            .corner_radius(TOKENS.popover.radius)
            .background(TOKENS.colours.surface.rgba())
            .border(Border::new().fill(TOKENS.colours.border.rgba()).width(1.0))
            .vertical()
            .spacing(TOKENS.popover.section_gap)
            .font_family(TOKENS.typography.family)
            .color(TOKENS.colours.text.rgba())
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
            .child(events)
    }
}

pub fn calendar_popup_app() -> impl IntoElement {
    CalendarPanel
}

pub fn popup_config(panel: BarPanel, anchor_rect: (i32, i32, i32, i32)) -> PopupConfig {
    match panel {
        BarPanel::Calendar => PopupConfig::new(
            "kobel-calendar",
            anchor_rect,
            SurfaceSize::ContentSized {
                width: TOKENS.popover.width,
                max_height: TOKENS.popover.max_height,
            },
            PreferredTheme::Dark,
        )
        .anchor(PopupAnchor::Bottom)
        .gravity(PopupGravity::Bottom),
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
    use freya_core::prelude::{IntoElement, use_provide_context};
    use freya_testing::launch_test;
    use kobel_services::CalendarEvent;
    use kobel_services::{AudioSnapshot, BatterySnapshot, NetworkSnapshot, ServiceEvent};
    use kobel_wayland::{Anchor, KeyboardInteractivity, PopupAnchor, PopupGravity, SurfaceSize};

    use super::{
        BarActionSink, BarContext, BarPanel, BarSnapshots, MAX_VISIBLE_EVENTS, SURFACE_HEIGHT, bar_preview_app,
        calendar_popup_app, event_occurs_on, event_time_label, local_midnight_epoch, popup_config, surface_config,
        visible_events_for_day,
    };

    #[test]
    fn component_mounts_in_the_headless_runner() {
        let mut runner = launch_test(bar_preview_app);
        runner.sync_and_update();
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

        let mut latest = BarSnapshots::default();
        latest.apply(&ServiceEvent::Audio(audio.clone()));
        latest.apply(&ServiceEvent::Battery(battery.clone()));
        latest.apply(&ServiceEvent::Network(network.clone()));

        assert_eq!(latest.audio, audio);
        assert_eq!(latest.battery, battery);
        assert_eq!(latest.network, network);
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
    fn popup_is_anchored_below_the_clock() {
        let anchor = (120, 4, 150, 24);
        let config = popup_config(BarPanel::Calendar, anchor);

        assert_eq!(config.anchor_rect, anchor);
        assert_eq!(config.anchor, PopupAnchor::Bottom);
        assert_eq!(config.gravity, PopupGravity::Bottom);
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
