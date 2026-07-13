//! Calendar popover -- GNOME-style month view (ags/widget/Calendar.tsx).
//!
//! A sheet (calendar_w wide) whose opacity follows the manager's reveal spring,
//! multiplied into the root opacity exactly like the placeholder panels: a
//! closed-but-mapped surface renders fully transparent. Layout top to bottom:
//!   - hero: weekday sublabel (MUT) + full date (large);
//!   - month nav: left/right chevrons + a month-year label button that jumps to
//!     today;
//!   - grid: a DOW header plus six week rows, each an ISO week number and seven
//!     24x24 day cells (out-of-month dim/inert, weekends dimmed, today a LEAF pill
//!     with INK text, selected-non-today a 1px MUT ring, event days a 3px dot);
//!   - events card: the selected day's events (icon chip + title + time) or a
//!     "No events" empty row.
//!
//! TODAY comes from `chrono::Local`, refreshed on the closed->open reveal edge so
//! the "today" highlight and event keys never go stale across midnight -- the AGS
//! calendar captured `now` once at module load and drifted after midnight
//! (widget-inventory Calendar states). No periodic timer is needed: the surface
//! only shows while open, and every open recomputes today.
//!
//! The grid math (`month_grid` / `step_month` / `ymd_key` / `sample_events`) is
//! pure and unit-tested; the reactive body only wires it to Freya state.

use std::collections::HashMap;

use chrono::{Datelike, Duration, Local, NaiveDate};
use freya_core::prelude::*;
use torin::prelude::{Alignment, Content, Position, Size};

use super::icon;
use super::panels::OpenProgress;
use crate::theme;

// Icons embedded at build time (currentColor SVGs recolored per state by
// `super::icon`), kept local to this module like ui/session.rs so ui/mod.rs stays
// the shared-icon surface only.
macro_rules! calendar_icon {
    ($file:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../ags/icons/hicolor/scalable/actions/",
            $file
        ))
    };
}

const ICON_CHEVRON_LEFT: &[u8] = calendar_icon!("kobel-chevron-left-symbolic.svg");
const ICON_CHEVRON_RIGHT: &[u8] = calendar_icon!("kobel-chevron-right-symbolic.svg");
const ICON_CAKE: &[u8] = calendar_icon!("kobel-cake-symbolic.svg");
const ICON_PIN: &[u8] = calendar_icon!("kobel-pin-symbolic.svg");
const ICON_VIDEO: &[u8] = calendar_icon!("kobel-video-symbolic.svg");
const ICON_CALENDAR: &[u8] = calendar_icon!("kobel-calendar-symbolic.svg");

/// Sheet inner padding (scss `.sheet { padding: 12px }`). Sheet width is
/// `calendar_w`, so content width is `calendar_w - 2 * SHEET_PAD`.
const SHEET_PAD: f32 = 12.0;
/// Week-number column width (Calendar.tsx `widthRequest={39}`).
const WEEK_COL_W: f32 = 39.0;
/// Day cell edge (scss `.day { min-width/height: 24px }`).
const DAY_CELL: f32 = 24.0;
/// Event dot diameter (scss `.evdot { min-width/height: 3px }`).
const DOT: f32 = 3.0;
/// Event dot gap from the cell bottom (scss `.evdot { margin-bottom: 2px }`).
const DOT_BOTTOM: f32 = 2.0;
/// Event icon chip edge (scss `.evic` 26x26).
const EV_CHIP: f32 = 26.0;
/// Colored event-chip fill (scss `.evic { background-color: #628933 }`).
const EV_CHIP_FILL: (u8, u8, u8) = (0x62, 0x89, 0x33);
/// Rising-edge threshold on the reveal opacity: recompute today the instant the
/// manager starts springing the surface open. Closed publishes a bit-exact 0.0
/// (manager snaps to target on settle), so any positive value is an open edge.
/// Mirrors ui/session.rs `OPEN_EPS`.
const OPEN_EPS: f32 = 1e-4;

// ---------------------------------------------------------------------------
// Pure grid math (unit-tested)
// ---------------------------------------------------------------------------

/// A single day cell in the month grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DayCell {
    /// The actual calendar date this cell shows (may fall in the prev/next month).
    date: NaiveDate,
    /// True when `date` falls in the grid's view month (clickable, full color).
    in_month: bool,
    /// True for the Saturday/Sunday columns (dimmed regardless of month).
    weekend: bool,
}

/// One week row: its ISO-8601 week number plus seven day cells (Monday..Sunday).
#[derive(Debug, Clone, PartialEq, Eq)]
struct WeekRow {
    iso_week: u32,
    days: [DayCell; 7],
}

/// Pure month-grid math: the six Monday-started week rows covering `(year, month)`.
///
/// Ports ags/widget/Calendar.tsx `Grid()`: leading cells backfill from the
/// previous month, trailing cells spill into the next, and each row's ISO week
/// number is taken from that row's Monday -- the six-row window GNOME's calendar
/// shows. `month` is 1-based (chrono convention).
fn month_grid(year: i32, month: u32) -> [WeekRow; 6] {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid year/month");
    // Monday=0 .. Sunday=6: the offset of the 1st within its Monday-started week.
    let start = first.weekday().num_days_from_monday() as i64;
    // Monday of the grid's first row (may sit in the previous month).
    let grid_monday = first - Duration::days(start);

    std::array::from_fn(|r| {
        let row_monday = grid_monday + Duration::days((r * 7) as i64);
        let days = std::array::from_fn(|c| {
            let date = row_monday + Duration::days(c as i64);
            DayCell {
                date,
                in_month: date.month() == month && date.year() == year,
                weekend: c >= 5,
            }
        });
        WeekRow { iso_week: row_monday.iso_week().week(), days }
    })
}

/// Step the (year, month) view one month `forward`/back, wrapping the year.
/// `month` is 1-based.
fn step_month(year: i32, month: u32, forward: bool) -> (i32, u32) {
    if forward {
        if month == 12 { (year + 1, 1) } else { (year, month + 1) }
    } else if month == 1 {
        (year - 1, 12)
    } else {
        (year, month - 1)
    }
}

/// `y-m-d` map key (1-based month, no zero padding), matching ags
/// `key(y, m, d) = ` + "`${y}-${m+1}-${d}`".
fn ymd_key(date: NaiveDate) -> String {
    format!("{}-{}-{}", date.year(), date.month(), date.day())
}

/// A hardcoded sample event (ags/widget/Calendar.tsx `Ev`).
#[derive(Debug, Clone, Copy)]
struct Ev {
    time: &'static str,
    name: &'static str,
    icon: &'static [u8],
}

/// The hardcoded sample event set, ported verbatim from ags/widget/Calendar.tsx
/// `EVENTS`, anchored to `today`'s month: today gets a standup, the 11th two
/// events, the 13th a birthday. Insertion order matches the AGS object literal, so
/// when today is itself the 11th or 13th the later same-key entry wins (JS object
/// literals keep the last duplicate key).
///
/// TODO(EDS/ICS): events stay hardcoded until the EDS/ICS calendar-source open
/// question is decided -- see docs/FREYA-PLAN.md section 7 ("Calendar events remain
/// hardcoded until an EDS/ICS decision is made").
fn sample_events(today: NaiveDate) -> HashMap<String, Vec<Ev>> {
    let (y, m) = (today.year(), today.month());
    let nth = |d: u32| ymd_key(NaiveDate::from_ymd_opt(y, m, d).expect("11th/13th exist"));
    let mut events: HashMap<String, Vec<Ev>> = HashMap::new();
    events.insert(
        ymd_key(today),
        vec![Ev { time: "09:45", name: "Daily Standup", icon: ICON_VIDEO }],
    );
    events.insert(
        nth(11),
        vec![
            Ev { time: "10:30", name: "Kieran Birthday", icon: ICON_CAKE },
            Ev { time: "13:00", name: "London Thing", icon: ICON_PIN },
        ],
    );
    events.insert(nth(13), vec![Ev { time: "All day", name: "My Birthday", icon: ICON_CAKE }]);
    events
}

// ---------------------------------------------------------------------------
// Reactive body
// ---------------------------------------------------------------------------

/// The calendar surface body. Returns a full-surface overlay whose opacity follows
/// the manager's reveal spring, holding a top-anchored `calendar_w`-wide sheet.
pub fn calendar() -> impl IntoElement {
    let progress = use_consume::<OpenProgress>();
    let tokens = *use_consume::<State<theme::Tokens>>().read();

    // Reading progress subscribes this scope, so the manager's per-frame reveal
    // writes re-render the sheet (its opacity) as the spring moves.
    let opacity = *progress.0.read();
    let open = opacity > OPEN_EPS;

    // TODAY from the wall clock; view/selected seed from it once at mount.
    let mut today = use_state(|| Local::now().date_naive());
    let init = *today.peek();
    let view = use_state(move || (init.year(), init.month()));
    let selected = use_state(move || init);

    // Refresh today on the closed->open edge (no midnight timer). Firing on the
    // earliest positive frame (OPEN_EPS) keeps the highlight fresh before the sheet
    // is even visible.
    use_side_effect_with_deps(&open, move |open| {
        if *open {
            today.set(Local::now().date_naive());
        }
    });

    let today = *today.read();
    let (vy, vm) = *view.read();
    let sel = *selected.read();
    let events = sample_events(today);

    let sheet = rect()
        .width(Size::px(tokens.calendar_w))
        .background(theme::PANEL.rgb())
        .corner_radius(theme::RADIUS_SHEET)
        .padding(SHEET_PAD)
        .child(hero(today))
        .child(nav_row(vy, vm, today, view, selected))
        .child(grid(vy, vm, today, sel, &events, selected))
        .child(events_card(sel, &events));

    // Full-surface overlay: the sheet sits top-aligned and fills the calendar_w
    // surface width. The whole overlay fades with the reveal opacity.
    rect().expanded().opacity(opacity).child(sheet)
}

/// Hero block: weekday sublabel (MUT 11.5) + full date (19 / 650). scss `.calhero`.
fn hero(today: NaiveDate) -> impl IntoElement {
    rect()
        // scss `.calhero { padding: 4px 8px 8px }` -> top 4, sides 8, bottom 8.
        .padding((4.0, 8.0, 8.0, 8.0))
        .child(
            label()
                .text(today.format("%A").to_string())
                .color(theme::MUT.rgb())
                .font_size(11.5),
        )
        .child(
            label()
                .text(today.format("%-d %B %Y").to_string())
                .color(theme::TX.rgb())
                .font_size(19.0)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32),
        )
}

/// Month navigation row: left chevron, centered month-year label button, right
/// chevron. scss `.cal centerbox`.
fn nav_row(
    vy: i32,
    vm: u32,
    today: NaiveDate,
    view: State<(i32, u32)>,
    selected: State<NaiveDate>,
) -> impl IntoElement {
    // Always month + year (the contract label is month-year); AGS omitted the year
    // in the current year, but the label here is explicitly month+year.
    let label_text = NaiveDate::from_ymd_opt(vy, vm, 1)
        .expect("valid month")
        .format("%B %Y")
        .to_string();

    rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .child(NavButton { icon: ICON_CHEVRON_LEFT, forward: false, view })
        .child(
            rect().width(Size::flex(1.0)).main_align(Alignment::Center).horizontal().child(
                MonthButton { label: label_text, view, selected, today },
            ),
        )
        .child(NavButton { icon: ICON_CHEVRON_RIGHT, forward: true, view })
}

/// A chevron month-nav button. Own component so its hover state is isolated and
/// `PartialEq` lets Freya skip it when nothing changed. scss `.cal centerbox > button`.
#[derive(PartialEq)]
struct NavButton {
    icon: &'static [u8],
    forward: bool,
    view: State<(i32, u32)>,
}

impl Component for NavButton {
    fn render(&self) -> impl IntoElement {
        let mut hovered = use_state(|| false);
        let on = *hovered.read();
        let mut view = self.view;
        let forward = self.forward;

        rect()
            .padding(6.0)
            .corner_radius(theme::RADIUS_BUTTON)
            .background(if on {
                theme::PANEL2.rgb().into()
            } else {
                Color::TRANSPARENT
            })
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| {
                let (y, m) = *view.peek();
                view.set(step_month(y, m, forward));
            })
            .child(icon(self.icon, 14.0, if on { theme::TX } else { theme::MUT }))
    }
}

/// The month-year label rendered as a button that jumps the view and selection to
/// today. scss `.cal .month`.
#[derive(PartialEq)]
struct MonthButton {
    label: String,
    view: State<(i32, u32)>,
    selected: State<NaiveDate>,
    today: NaiveDate,
}

impl Component for MonthButton {
    fn render(&self) -> impl IntoElement {
        let mut hovered = use_state(|| false);
        let on = *hovered.read();
        let mut view = self.view;
        let mut selected = self.selected;
        let today = self.today;

        rect()
            .padding(5.0)
            .corner_radius(8.0)
            .background(if on {
                theme::PANEL2.rgb().into()
            } else {
                Color::TRANSPARENT
            })
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| {
                view.set((today.year(), today.month()));
                selected.set(today);
            })
            .child(
                label()
                    .text(self.label.clone())
                    .color(theme::TX.rgb())
                    .font_size(13.0)
                    .font_weight(theme::FONT_WEIGHT_BOLD as i32),
            )
    }
}

/// Two-letter day-of-week header labels, Monday first.
const DOW: [&str; 7] = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/// The month grid: a DOW header row plus six week rows. scss `.cal-grid`.
fn grid(
    vy: i32,
    vm: u32,
    today: NaiveDate,
    sel: NaiveDate,
    events: &HashMap<String, Vec<Ev>>,
    selected: State<NaiveDate>,
) -> impl IntoElement {
    let rows = month_grid(vy, vm);

    // Header: empty spacer over the week-number column, then seven flex columns of
    // two-letter DOW labels.
    let header = rect()
        .horizontal()
        .child(rect().width(Size::px(WEEK_COL_W)))
        .child(
            rect().horizontal().content(Content::Flex).width(Size::fill()).children((0..7).map(|c| {
                cell_column(
                    label()
                        .text(DOW[c])
                        .color(theme::DIM.rgb())
                        .font_size(9.5)
                        .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
                )
            })),
        );

    let mut children: Vec<Element> = Vec::with_capacity(7);
    children.push(header.into_element());
    for wr in rows.iter() {
        let week_no = rect().width(Size::px(WEEK_COL_W)).main_align(Alignment::Center).horizontal().child(
            label()
                .text(wr.iso_week.to_string())
                .color(theme::DIM.rgb())
                .font_size(9.0)
                .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                .font_family(theme::FONT_FAMILY_DATA),
        );
        let day_cols = rect().horizontal().content(Content::Flex).width(Size::fill()).children(wr.days.iter().map(|cell| {
            let inner: Element = if cell.in_month {
                DayButton {
                    date: cell.date,
                    is_today: cell.date == today,
                    is_selected: cell.date == sel,
                    is_weekend: cell.weekend,
                    has_event: events.contains_key(&ymd_key(cell.date)),
                    selected,
                }
                .into_element()
            } else {
                out_cell(cell.date).into_element()
            };
            cell_column(inner)
        }));
        children.push(
            rect()
                .horizontal()
                .cross_align(Alignment::Center)
                .child(week_no)
                .child(day_cols)
                .into_element(),
        );
    }

    rect()
        // scss `.cal-grid { margin-top: 8px }`.
        .margin((8.0, 0.0, 0.0, 0.0))
        .spacing(2.0)
        .children(children)
}

/// One equal-width grid column that centers its 24x24 content. Homogeneous columns
/// match the AGS `<box homogeneous hexpand>`.
fn cell_column(child: impl IntoElement) -> Element {
    rect()
        .width(Size::flex(1.0))
        .main_align(Alignment::Center)
        .horizontal()
        .child(child)
        .into_element()
}

/// An in-month day cell: a clickable 24x24 pill. today = LEAF fill + INK text (700);
/// weekend = DIM; selected-non-today = 1px MUT ring; event days get a 3px dot.
#[derive(PartialEq)]
struct DayButton {
    date: NaiveDate,
    is_today: bool,
    is_selected: bool,
    is_weekend: bool,
    has_event: bool,
    selected: State<NaiveDate>,
}

impl Component for DayButton {
    fn render(&self) -> impl IntoElement {
        let mut hovered = use_state(|| false);
        let on = *hovered.read();
        let date = self.date;
        let is_today = self.is_today;

        // Fill: today keeps its LEAF pill (even on hover); otherwise hover lifts to
        // PANEL2. scss `.day`, `.today`, `.day:hover`.
        let bg: Color = if is_today {
            theme::LEAF.rgb().into()
        } else if on {
            theme::PANEL2.rgb().into()
        } else {
            Color::TRANSPARENT
        };
        // Text: today INK; in-month weekend DIM; else TX. scss `.day`, `.we`, `.today`.
        let tint = if is_today {
            theme::INK
        } else if self.is_weekend {
            theme::DIM
        } else {
            theme::TX
        };
        // Weight: today 700, in-month 600. scss CDP note.
        let weight = if is_today { 700 } else { theme::FONT_WEIGHT_SEMIBOLD };
        // Selection ring: 1px MUT inner border on selected-non-today (today keeps the
        // solid leaf fill). Inner alignment never shifts layout. scss `.plain-sel`.
        let ring = (self.is_selected && !is_today).then(|| {
            Border::new()
                .fill(theme::MUT.rgb())
                .width(1.0)
                .alignment(BorderAlignment::Inner)
        });

        let mut sel = self.selected;
        let cell = rect()
            .width(Size::px(DAY_CELL))
            .height(Size::px(DAY_CELL))
            .center()
            .corner_radius(theme::RADIUS_PILL)
            .background(bg)
            .border(ring)
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| sel.set(date))
            .child(
                label()
                    .text(date.day().to_string())
                    .color(tint.rgb())
                    .font_size(11.0)
                    .font_weight(weight as i32),
            );

        if self.has_event {
            // 3px dot, absolute bottom-center; INK on today's leaf fill, else LEAF.
            let dot_color = if is_today { theme::INK } else { theme::LEAF };
            cell.child(
                rect()
                    .width(Size::px(DOT))
                    .height(Size::px(DOT))
                    .corner_radius(theme::RADIUS_PILL)
                    .background(dot_color.rgb())
                    .position(
                        Position::new_absolute()
                            .bottom(DOT_BOTTOM)
                            .left((DAY_CELL - DOT) / 2.0),
                    ),
            )
        } else {
            cell
        }
    }
}

/// An out-of-month day cell: an inert, dimmed 24x24 label (weight 400). scss `.out`.
fn out_cell(date: NaiveDate) -> impl IntoElement {
    rect()
        .width(Size::px(DAY_CELL))
        .height(Size::px(DAY_CELL))
        .center()
        .child(
            label()
                .text(date.day().to_string())
                .color(theme::DIM.rgb())
                .font_size(11.0)
                .font_weight(theme::FONT_WEIGHT_REGULAR as i32),
        )
}

/// Events card (PANEL2 / radius 12): an "Events" + selected-date header, then the
/// selected day's event rows or a "No events" empty row. scss `.evcard`.
fn events_card(sel: NaiveDate, events: &HashMap<String, Vec<Ev>>) -> impl IntoElement {
    // Header combines the task's "Events" title with the AGS selected-date line:
    // "Events" on the left, the long selected date (MUT) on the right.
    let header = rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        // scss `.evhead { padding: 1px 3px 8px }`.
        .padding((1.0, 3.0, 8.0, 3.0))
        .child(
            label()
                .text("Events")
                .color(theme::TX.rgb())
                .font_size(12.5)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32),
        )
        .child(
            rect().width(Size::flex(1.0)).horizontal().main_align(Alignment::End).child(
                label()
                    .text(sel.format("%A, %-d %B").to_string())
                    .color(theme::MUT.rgb())
                    .font_size(11.5),
            ),
        );

    let card = rect()
        // scss `.evcard { margin-top: 12px }`.
        .margin((12.0, 0.0, 0.0, 0.0))
        .background(theme::PANEL2.rgb())
        .corner_radius(theme::RADIUS_TILE)
        .padding(10.0)
        .child(header);

    match events.get(&ymd_key(sel)) {
        None => card.child(
            rect()
                .horizontal()
                .cross_align(Alignment::Center)
                .spacing(8.0)
                // scss `.evempty { padding: 2px 3px 3px }`.
                .padding((2.0, 3.0, 3.0, 3.0))
                .child(icon(ICON_CALENDAR, 14.0, theme::DIM))
                .child(label().text("No events").color(theme::MUT.rgb()).font_size(11.5)),
        ),
        Some(evs) => {
            let last = evs.len().saturating_sub(1);
            card.children(
                evs.iter()
                    .enumerate()
                    .map(|(i, e)| event_row(e, i == last).into_element()),
            )
        }
    }
}

/// One event row: a 26x26 colored icon chip, the title (12 / 650) and the time
/// (10.5, tabular data font). scss `.evrow`.
fn event_row(e: &Ev, last: bool) -> impl IntoElement {
    let chip = rect()
        .width(Size::px(EV_CHIP))
        .height(Size::px(EV_CHIP))
        .center()
        .corner_radius(8.0)
        .background(EV_CHIP_FILL)
        .child(icon(e.icon, 14.0, theme::Rgb(255, 255, 255)));

    let meta = rect()
        .width(Size::flex(1.0))
        .cross_align(Alignment::Start)
        .child(
            label()
                .text(e.name)
                .color(theme::TX.rgb())
                .font_size(12.0)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32),
        )
        .child(
            label()
                .text(e.time)
                .color(theme::MUT.rgb())
                .font_size(10.5)
                .font_family(theme::FONT_FAMILY_DATA),
        );

    rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(10.0)
        // scss `.evrow { padding: 8px 10px }`.
        .padding((8.0, 10.0))
        // scss `.evrow { margin-bottom: 4px } .evrow.last { margin-bottom: 0 }`.
        .margin(if last { (0.0, 0.0, 0.0, 0.0) } else { (0.0, 0.0, 4.0, 0.0) })
        .corner_radius(theme::RADIUS_ROW)
        .background(theme::PANEL.rgb())
        .child(chip)
        .child(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn month_grid_july_2026_iso_weeks() {
        // July 2026 spans ISO weeks 27..=32 (verified against the standard ISO
        // calendar): row 0's Monday is 2026-06-29 (week 27).
        let g = month_grid(2026, 7);
        let weeks: Vec<u32> = g.iter().map(|r| r.iso_week).collect();
        assert_eq!(weeks, vec![27, 28, 29, 30, 31, 32]);
    }

    #[test]
    fn month_grid_july_2026_first_day_offset() {
        // 2026-07-01 is a Wednesday -> Monday-started offset 2, so the 1st lands at
        // row 0 column 2 and row 0 column 0 backfills to 2026-06-29 (prev month).
        let g = month_grid(2026, 7);
        assert_eq!(g[0].days[0].date, d(2026, 6, 29));
        assert!(!g[0].days[0].in_month);
        assert!(!g[0].days[0].weekend);

        assert_eq!(g[0].days[2].date, d(2026, 7, 1));
        assert!(g[0].days[2].in_month);
        assert_eq!(g[0].days[2].date.weekday(), chrono::Weekday::Wed);
    }

    #[test]
    fn month_grid_july_2026_weekends_and_placement() {
        let g = month_grid(2026, 7);
        // Columns 5 and 6 are the weekend (Sat/Sun).
        assert_eq!(g[0].days[5].date, d(2026, 7, 4));
        assert!(g[0].days[5].weekend);
        assert_eq!(g[0].days[6].date, d(2026, 7, 5));
        assert!(g[0].days[6].weekend);
        for r in 0..6 {
            assert!(!g[r].days[0].weekend, "Monday column is never a weekend");
            assert!(g[r].days[6].weekend, "Sunday column is always a weekend");
        }
        // Row 2 Monday is 2026-07-13 (in-month); the grid's last cell spills to August.
        assert_eq!(g[2].days[0].date, d(2026, 7, 13));
        assert!(g[2].days[0].in_month);
        assert_eq!(g[5].days[6].date, d(2026, 8, 9));
        assert!(!g[5].days[6].in_month);
    }

    #[test]
    fn month_grid_every_row_is_seven_consecutive_days() {
        let g = month_grid(2026, 7);
        for row in g.iter() {
            for c in 1..7 {
                assert_eq!(row.days[c].date, row.days[c - 1].date + Duration::days(1));
            }
        }
        // Rows are consecutive weeks.
        for r in 1..6 {
            assert_eq!(g[r].days[0].date, g[r - 1].days[0].date + Duration::days(7));
        }
    }

    #[test]
    fn step_month_wraps_year() {
        assert_eq!(step_month(2026, 12, true), (2027, 1));
        assert_eq!(step_month(2026, 1, false), (2025, 12));
        assert_eq!(step_month(2026, 7, true), (2026, 8));
        assert_eq!(step_month(2026, 7, false), (2026, 6));
    }

    #[test]
    fn ymd_key_is_unpadded_one_based_month() {
        assert_eq!(ymd_key(d(2026, 7, 1)), "2026-7-1");
        assert_eq!(ymd_key(d(2026, 12, 25)), "2026-12-25");
    }

    #[test]
    fn sample_events_anchor_to_today_month() {
        // Pick a today that is neither the 11th nor 13th so all three sample keys
        // are distinct.
        let today = d(2026, 7, 6);
        let ev = sample_events(today);
        assert_eq!(ev.len(), 3);
        assert_eq!(ev.get(&ymd_key(d(2026, 7, 6))).map(Vec::len), Some(1));
        assert_eq!(ev.get(&ymd_key(d(2026, 7, 6))).unwrap()[0].name, "Daily Standup");
        assert_eq!(ev.get(&ymd_key(d(2026, 7, 11))).map(Vec::len), Some(2));
        assert_eq!(ev.get(&ymd_key(d(2026, 7, 13))).map(Vec::len), Some(1));
        // A day with no sample events resolves to None (the "No events" path).
        assert!(ev.get(&ymd_key(d(2026, 7, 20))).is_none());
    }

    #[test]
    fn sample_events_today_collision_lets_later_key_win() {
        // When today IS the 11th, the two-event 11th entry overwrites the standup
        // (matches the AGS object-literal "last duplicate key wins").
        let ev = sample_events(d(2026, 7, 11));
        assert_eq!(ev.get(&ymd_key(d(2026, 7, 11))).map(Vec::len), Some(2));
        // When today IS the 13th, the birthday entry overwrites the standup.
        let ev = sample_events(d(2026, 7, 13));
        assert_eq!(ev.get(&ymd_key(d(2026, 7, 13))).unwrap()[0].name, "My Birthday");
    }
}
