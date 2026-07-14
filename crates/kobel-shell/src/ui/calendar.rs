//! Calendar popover -- GNOME-style month view (ags/widget/Calendar.tsx).
//!
//! A sheet (calendar_w wide) whose opacity follows the manager's reveal spring,
//! multiplied into the root opacity like every on-demand surface (see
//! ui/panels.rs's [`OpenProgress`]) -- a closed-but-mapped surface renders fully
//! transparent. Layout top to bottom:
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
//! Events come from the real desktop calendar, not hardcoded demo data: GNOME
//! Shell's own `org.gnome.Shell.CalendarServer` D-Bus service, read by the
//! `kobel_services::calendar` async service (like every other system source)
//! and fanned in as a [`CalendarSnapshot`] this surface consumes. Whatever's
//! configured system-wide via GNOME Online Accounts / local EDS calendars shows
//! up automatically -- no kobel-shell-specific config file. On open / month
//! change this surface asks the service for the viewed month's range; the
//! snapshot is grouped for display by [`events_by_day`].
//!
//! The grid math (`month_grid` / `step_month` / `ymd_key`) and the
//! [`events_by_day`] transform are pure and unit-tested; the reactive body only
//! wires them to Freya state.

use std::collections::HashMap;

use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};
use freya_core::prelude::*;
use torin::prelude::{Alignment, Content, Position, Size};

use super::icon;
use super::panels::{OpenProgress, use_open_scale};
use crate::manager::{ShellBus, ShellMsg};
use crate::theme;
use kobel_services::{CalendarEvent, CalendarSnapshot, Command};

// Icons embedded at build time (currentColor SVGs recolored per state by
// `super::icon`), kept local to this module like ui/session.rs so ui/mod.rs stays
// the shared-icon surface only.
macro_rules! calendar_icon {
    ($file:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/assets/hicolor/scalable/actions/",
            $file
        ))
    };
}

const ICON_CHEVRON_LEFT: &[u8] = calendar_icon!("kobel-chevron-left-symbolic.svg");
const ICON_CHEVRON_RIGHT: &[u8] = calendar_icon!("kobel-chevron-right-symbolic.svg");
const ICON_CAKE: &[u8] = calendar_icon!("kobel-cake-symbolic.svg");
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
///
/// `(year, month)` is always [`NaiveDate`]-representable here: the `view` state
/// this is called with is seeded from `Local::now()` (always valid), jumped to
/// `today` (also always valid), or stepped via [`step_month`], which clamps at
/// chrono's own representable boundary rather than ever producing an invalid
/// pair -- see its doc for why that clamp exists.
///
/// That guarantees `(year, month, 1)` itself is representable, but the SIX-WEEK
/// GRID this builds reaches up to ~6 days before it and ~35 days after it (the
/// Monday-started backfill/spillover) -- close enough to [`NaiveDate::MIN`]/
/// [`MAX`] (verified: December of `NaiveDate::MAX`'s own year) that plain `+`/`-`
/// on those offsets can still overflow even though the month itself is fine.
/// [`saturating_offset`] absorbs that: every date in the grid clamps to MIN/MAX
/// rather than ever panicking, degrading the display at literally the ends of
/// representable time instead of crashing.
fn month_grid(year: i32, month: u32) -> [WeekRow; 6] {
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid year/month (see fn doc)");
    // Monday=0 .. Sunday=6: the offset of the 1st within its Monday-started week.
    let start = first.weekday().num_days_from_monday() as i64;
    // Monday of the grid's first row (may sit in the previous month).
    let grid_monday = saturating_offset(first, -start);

    std::array::from_fn(|r| {
        let row_monday = saturating_offset(grid_monday, (r * 7) as i64);
        let days = std::array::from_fn(|c| {
            let date = saturating_offset(row_monday, c as i64);
            DayCell {
                date,
                in_month: date.month() == month && date.year() == year,
                weekend: c >= 5,
            }
        });
        WeekRow {
            iso_week: row_monday.iso_week().week(),
            days,
        }
    })
}

/// Add `days` to `date`, clamping to [`NaiveDate::MIN`]/[`MAX`] instead of
/// overflowing/panicking (chrono's plain `+`/`-` on `NaiveDate` panics past
/// those bounds; `checked_add_signed`/`checked_sub_signed` are the non-panicking
/// primitives this saturates through). Used by [`month_grid`]'s six-week window,
/// which can walk a handful of days beyond even a representable month at either
/// extreme of chrono's range.
fn saturating_offset(date: NaiveDate, days: i64) -> NaiveDate {
    let delta = Duration::days(days);
    if days >= 0 {
        date.checked_add_signed(delta).unwrap_or(NaiveDate::MAX)
    } else {
        date.checked_sub_signed(-delta).unwrap_or(NaiveDate::MIN)
    }
}

/// Step the (year, month) view one month `forward`/back, wrapping the year, but
/// clamped so it never walks past what [`NaiveDate`] can represent (roughly
/// years -262143..=262142 -- `NaiveDate::MIN`/`MAX`). Without this, enough
/// presses of the nav chevron (a few million) would produce a `(year, month)`
/// `NaiveDate::from_ymd_opt` can't construct, and `month_grid`'s `.expect()`
/// below -- plus `nav_row`'s label formatting -- would panic on it. Checked via
/// `from_ymd_opt` directly (not a hardcoded boundary constant) so the bound
/// always matches whatever chrono itself can actually represent. Clamped, not
/// wrapped: at the edge, another press in the same direction is a no-op --
/// there is nowhere further to go, same as a real calendar at the end of time.
/// `month` is 1-based.
fn step_month(year: i32, month: u32, forward: bool) -> (i32, u32) {
    let next = if forward {
        if month == 12 { (year + 1, 1) } else { (year, month + 1) }
    } else if month == 1 {
        (year - 1, 12)
    } else {
        (year, month - 1)
    };
    if NaiveDate::from_ymd_opt(next.0, next.1, 1).is_some() {
        next
    } else {
        (year, month)
    }
}

/// `y-m-d` map key (1-based month, no zero padding), matching ags
/// `key(y, m, d) = ` + "`${y}-${m+1}-${d}`".
fn ymd_key(date: NaiveDate) -> String {
    format!("{}-{}-{}", date.year(), date.month(), date.day())
}

/// One calendar event resolved for display: a title, a formatted time (or
/// "All day"), and a symbolic icon chosen by simple keyword heuristics over the
/// title (real events carry no category metadata the way the old hardcoded demo
/// data did).
#[derive(Debug, Clone, PartialEq)]
struct Ev {
    time: String,
    name: String,
    icon: &'static [u8],
}

// ---------------------------------------------------------------------------
// Event data transform (pure; unit-tested)
// ---------------------------------------------------------------------------

/// Pick a symbolic icon for an event from simple keyword heuristics over its
/// title -- real events carry no category metadata, this is a best-effort
/// approximation, not a real classification system.
fn pick_event_icon(name: &str) -> &'static [u8] {
    let lower = name.to_lowercase();
    if lower.contains("birthday") {
        ICON_CAKE
    } else if lower.contains("call") || lower.contains("standup") || lower.contains("meeting") {
        ICON_VIDEO
    } else {
        ICON_CALENDAR
    }
}

/// Group events by their local start day (`ymd_key`), resolving each into a
/// display [`Ev`]: "All day" when the service flagged it, else the local start
/// time (`%H:%M`), with an icon from [`pick_event_icon`]. A PURE data transform
/// over the consumed [`CalendarSnapshot`] -- no D-Bus -- so it is directly
/// unit-testable with [`CalendarEvent`] fixtures. Events whose epoch is
/// unrepresentable are skipped (defensive; should not happen for real EDS data).
fn events_by_day(events: &[CalendarEvent]) -> HashMap<String, Vec<Ev>> {
    let mut out: HashMap<String, Vec<Ev>> = HashMap::new();
    for event in events {
        let Some(start) = Local.timestamp_opt(event.start_epoch, 0).single() else {
            continue;
        };
        let time = if event.all_day {
            "All day".to_string()
        } else {
            start.format("%H:%M").to_string()
        };
        let icon = pick_event_icon(&event.summary);
        out.entry(ymd_key(start.date_naive())).or_default().push(Ev {
            time,
            name: event.summary.clone(),
            icon,
        });
    }
    out
}

/// The viewed month's local-day epoch range `[since, until)` -- midnight on the
/// 1st to midnight on the 1st of the following month -- to query the calendar
/// service for. `None` if the (year, month) is unrepresentable.
fn month_range(year: i32, month: u32) -> Option<(i64, i64)> {
    let first = NaiveDate::from_ymd_opt(year, month, 1)?;
    let (ny, nm) = step_month(year, month, true);
    let next_first = NaiveDate::from_ymd_opt(ny, nm, 1)?;
    let since = Local
        .from_local_datetime(&first.and_time(chrono::NaiveTime::MIN))
        .single()?;
    let until = Local
        .from_local_datetime(&next_first.and_time(chrono::NaiveTime::MIN))
        .single()?;
    Some((since.timestamp(), until.timestamp()))
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
    let cal = use_consume::<State<CalendarSnapshot>>();
    let bus = use_consume::<ShellBus>();

    let (vy, vm) = *view.read();

    // Refresh today on the closed->open edge (no midnight timer). Firing on the
    // earliest positive frame (OPEN_EPS) keeps the highlight fresh before the sheet
    // is even visible.
    use_side_effect_with_deps(&open, move |open| {
        if *open {
            today.set(Local::now().date_naive());
        }
    });

    // Ask the calendar service for the viewed month on the open edge, and again
    // whenever the viewed month changes while open (nav_row lets the user page
    // months without closing the sheet). This surface re-renders each spring tick
    // while the reveal animates, so keying the effect on `(open, vy, vm)` -- not
    // the render body -- keeps it to exactly one request per real transition. The
    // service owns a persistent subscription + live cache and fans the snapshot
    // back via use_consume, so nothing blocks here.
    use_side_effect_with_deps(&(open, vy, vm), move |deps| {
        let (open, vy, vm) = *deps;
        if open && let Some((since, until)) = month_range(vy, vm) {
            bus.send(ShellMsg::Service(Command::SetCalendarRange { since, until }));
        }
    });

    let today = *today.read();
    let sel = *selected.read();
    let events = events_by_day(&cal.read().events);

    let scale = use_open_scale(opacity);
    let sheet = rect()
        .width(Size::px(tokens.calendar_w))
        .background(theme::PANEL.rgb())
        .corner_radius(theme::RADIUS_SHEET)
        .padding(SHEET_PAD)
        .scale(scale)
        .child(hero(today))
        .child(nav_row(vy, vm, today, view, selected))
        .child(grid(vy, vm, today, sel, &events, selected))
        .child(events_card(sel, &events));

    // Fill the (content-sized) surface width; AUTO height so the surface hugs the
    // top-aligned sheet (host reads ROOT content height). `.expanded()` would fill
    // the height and defeat content sizing.
    rect().width(Size::fill()).opacity(opacity).child(sheet)
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
    // See month_grid's doc for why (vy, vm) is always representable here.
    let label_text = NaiveDate::from_ymd_opt(vy, vm, 1)
        .expect("valid month (see month_grid's doc)")
        .format("%B %Y")
        .to_string();

    rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .child(NavButton {
            icon: ICON_CHEVRON_LEFT,
            forward: false,
            view,
        })
        .child(
            rect()
                .width(Size::flex(1.0))
                .main_align(Alignment::Center)
                .horizontal()
                .child(MonthButton {
                    label: label_text,
                    view,
                    selected,
                    today,
                }),
        )
        .child(NavButton {
            icon: ICON_CHEVRON_RIGHT,
            forward: true,
            view,
        })
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
    let header = rect().horizontal().child(rect().width(Size::px(WEEK_COL_W))).child(
        rect()
            .horizontal()
            .content(Content::Flex)
            .width(Size::fill())
            .children((0..7).map(|c| {
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
        let week_no = rect()
            .width(Size::px(WEEK_COL_W))
            .main_align(Alignment::Center)
            .horizontal()
            .child(
                label()
                    .text(wr.iso_week.to_string())
                    .color(theme::DIM.rgb())
                    .font_size(9.0)
                    .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                    .font_family(theme::FONT_FAMILY_DATA),
            );
        let day_cols = rect()
            .horizontal()
            .content(Content::Flex)
            .width(Size::fill())
            .children(wr.days.iter().map(|cell| {
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
                    .position(Position::new_absolute().bottom(DOT_BOTTOM).left((DAY_CELL - DOT) / 2.0)),
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
            rect()
                .width(Size::flex(1.0))
                .horizontal()
                .main_align(Alignment::End)
                .child(
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
        .background(theme::EVENT_CHIP.rgb())
        // Pure white glyph, not TX: scss `.evrow .evic image { color: #fff }`
        // (main.scss:946) is literal white on the colored chip, not $tx.
        .child(icon(e.icon, 14.0, theme::Rgb(255, 255, 255)));

    let meta = rect()
        .width(Size::flex(1.0))
        .cross_align(Alignment::Start)
        .child(
            label()
                .text(e.name.clone())
                .color(theme::TX.rgb())
                .font_size(12.0)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32),
        )
        .child(
            label()
                .text(e.time.clone())
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
        .margin(if last {
            (0.0, 0.0, 0.0, 0.0)
        } else {
            (0.0, 0.0, 4.0, 0.0)
        })
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
        for row in &g {
            assert!(!row.days[0].weekend, "Monday column is never a weekend");
            assert!(row.days[6].weekend, "Sunday column is always a weekend");
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
    fn month_grid_january_2027_backfills_from_december_previous_year() {
        // 2027-01-01 is a Friday -> the grid's first row starts Monday
        // 2026-12-28 (a DIFFERENT year from the viewed 2027), so in_month must
        // key on year AND month, not month alone -- a month-only check would
        // wrongly treat these as unrelated (December != January) but this
        // specifically locks down that the year half of the check is exercised
        // at a real year-crossing boundary, not just within one calendar year.
        let g = month_grid(2027, 1);
        assert_eq!(g[0].days[0].date, d(2026, 12, 28));
        assert!(!g[0].days[0].in_month, "Dec 28 2026 is not in the viewed January 2027");
        assert_eq!(g[0].days[3].date, d(2026, 12, 31));
        assert!(!g[0].days[3].in_month);
        assert_eq!(g[0].days[4].date, d(2027, 1, 1));
        assert!(g[0].days[4].in_month, "Jan 1 2027 is the viewed month");
        // The grid's last row spills forward into February 2027 (same year).
        assert_eq!(g[5].days[0].date, d(2027, 2, 1));
        assert!(!g[5].days[0].in_month);
        // Every day strictly within January (rows 1..=4, all seven columns) is
        // in_month.
        for row in &g[1..=4] {
            for cell in &row.days {
                assert!(
                    cell.in_month,
                    "{:?} should be in-month for January 2027 view",
                    cell.date
                );
            }
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
    fn step_month_clamps_at_naivedate_max_instead_of_overflowing() {
        // NaiveDate::MAX is the last representable date; December of its year is
        // the last representable MONTH. One more "forward" press must be a no-op
        // (there is nowhere further to go), never an unrepresentable pair that
        // would later panic in month_grid/nav_row.
        let last_month = (NaiveDate::MAX.year(), 12);
        assert_eq!(step_month(last_month.0, last_month.1, true), last_month);
        // Pressing repeatedly stays pinned, never drifts past the boundary.
        let mut cur = last_month;
        for _ in 0..5 {
            cur = step_month(cur.0, cur.1, true);
        }
        assert_eq!(cur, last_month);
        // Sanity: month_grid must not panic when actually called at this edge.
        month_grid(last_month.0, last_month.1);
    }

    #[test]
    fn step_month_clamps_at_naivedate_min_instead_of_overflowing() {
        let first_month = (NaiveDate::MIN.year(), 1);
        assert_eq!(step_month(first_month.0, first_month.1, false), first_month);
        let mut cur = first_month;
        for _ in 0..5 {
            cur = step_month(cur.0, cur.1, false);
        }
        assert_eq!(cur, first_month);
        month_grid(first_month.0, first_month.1);
    }

    #[test]
    fn step_month_still_steps_normally_one_short_of_either_boundary() {
        // Regression guard: the clamp must only bite exactly at the edge, never
        // one month early.
        let near_max = (NaiveDate::MAX.year(), 11);
        assert_eq!(step_month(near_max.0, near_max.1, true), (NaiveDate::MAX.year(), 12));
        let near_min = (NaiveDate::MIN.year(), 2);
        assert_eq!(step_month(near_min.0, near_min.1, false), (NaiveDate::MIN.year(), 1));
    }

    #[test]
    fn ymd_key_is_unpadded_one_based_month() {
        assert_eq!(ymd_key(d(2026, 7, 1)), "2026-7-1");
        assert_eq!(ymd_key(d(2026, 12, 25)), "2026-12-25");
    }

    #[test]
    fn month_range_covers_the_viewed_month() {
        let (since, until) = month_range(2026, 7).expect("valid month");
        let s = Local.timestamp_opt(since, 0).single().unwrap();
        let u = Local.timestamp_opt(until, 0).single().unwrap();
        assert_eq!(s.date_naive(), d(2026, 7, 1));
        assert_eq!(s.time(), chrono::NaiveTime::MIN);
        assert_eq!(u.date_naive(), d(2026, 8, 1));
        assert!(until > since);
    }

    /// A `CalendarEvent` fixture as the service would produce it: `all_day` is
    /// pre-computed there (see `kobel_services::calendar::is_all_day`), so these
    /// tests supply it directly and exercise only `events_by_day`'s day-keying and
    /// display formatting.
    fn cal_event(name: &str, start: (i32, u32, u32, u32, u32), all_day: bool) -> CalendarEvent {
        let (y, mo, day, h, mi) = start;
        let start_epoch = Local
            .from_local_datetime(&d(y, mo, day).and_hms_opt(h, mi, 0).unwrap())
            .single()
            .unwrap()
            .timestamp();
        CalendarEvent {
            uid: "uid".to_string(),
            summary: name.to_string(),
            start_epoch,
            end_epoch: start_epoch,
            all_day,
        }
    }

    #[test]
    fn events_by_day_formats_a_timed_event() {
        let map = events_by_day(&[cal_event("Daily Standup", (2026, 7, 6, 9, 45), false)]);
        let day = map.get(&ymd_key(d(2026, 7, 6))).expect("keyed under its start day");
        assert_eq!(day.len(), 1);
        assert_eq!(day[0].name, "Daily Standup");
        assert_eq!(day[0].time, "09:45");
    }

    #[test]
    fn events_by_day_renders_all_day_flag() {
        // The service flagged this all-day; events_by_day must show "All day",
        // not a clock time, filed under the local start day.
        let map = events_by_day(&[cal_event("My Birthday", (2026, 7, 13, 0, 0), true)]);
        let day = map.get(&ymd_key(d(2026, 7, 13))).expect("keyed under its start day");
        assert_eq!(day[0].time, "All day");
    }

    #[test]
    fn events_by_day_midnight_start_not_flagged_shows_clock_time() {
        // A timed event that happens to start at midnight (all_day=false) formats
        // as "00:00", never "All day".
        let map = events_by_day(&[cal_event("Midnight Release", (2026, 7, 13, 0, 0), false)]);
        let day = map.get(&ymd_key(d(2026, 7, 13))).unwrap();
        assert_eq!(day[0].time, "00:00");
    }

    #[test]
    fn events_by_day_groups_by_local_day() {
        let map = events_by_day(&[
            cal_event("A", (2026, 7, 6, 9, 0), false),
            cal_event("B", (2026, 7, 11, 10, 0), false),
            cal_event("C", (2026, 7, 11, 13, 0), false),
        ]);
        assert_eq!(map.get(&ymd_key(d(2026, 7, 6))).map(Vec::len), Some(1));
        assert_eq!(map.get(&ymd_key(d(2026, 7, 11))).map(Vec::len), Some(2));
        // A day with no events resolves to None (the "No events" path).
        assert!(!map.contains_key(&ymd_key(d(2026, 7, 20))));
    }

    #[test]
    fn pick_event_icon_keyword_heuristics() {
        // `const` byte-slice items get independently promoted per use site, so
        // comparing by address (`ptr::eq`) across call sites is unreliable --
        // compare content instead (the SVGs are genuinely distinct byte strings).
        assert_eq!(pick_event_icon("Kieran Birthday"), ICON_CAKE);
        assert_eq!(pick_event_icon("Team Standup"), ICON_VIDEO);
        assert_eq!(pick_event_icon("Quarterly Planning"), ICON_CALENDAR);
    }
}
