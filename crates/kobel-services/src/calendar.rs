//! Calendar service: real desktop calendar events from GNOME Shell's own
//! `org.gnome.Shell.CalendarServer` D-Bus service (implemented by
//! `gnome-shell-calendar-server`, backed by Evolution Data Server), the exact
//! source GNOME Calendar and the GNOME Shell clock dropdown read. Whatever's
//! configured system-wide through GNOME Online Accounts or local EDS calendars
//! appears automatically, with no kobel-specific configuration. Like every other
//! source in this crate, it emits typed [`CalendarSnapshot`] values over
//! [`ServiceEvent`] so consumers do not need to access D-Bus directly.
//!
//! Live-verified interface (gdbus introspect against a running gnoblin session;
//! gnoblin ships its own copy of gnome-shell-calendar-server, so this works
//! unchanged inside the shell's real target compositor):
//!   methods: SetTimeRange(x since, x until, b force_reload)
//!   signals: EventsAddedOrUpdated(a(ssxxa{sv}) events), EventsRemoved(as ids),
//!            ClientDisappeared(s source_uid)
//!   properties: Since (x), Until (x), HasCalendars (b)
//! Recurring events are expanded SERVER-SIDE (EDS does the RRULE work): each
//! occurrence within the queried range arrives as its own tuple, so no RRULE
//! parsing is needed here.
//!
//! Protocol quirk, live-verified via `gdbus monitor` across a real SetTimeRange
//! call (3s, no signal): when a query matches events, `EventsAddedOrUpdated`
//! fires quickly; when it matches NONE, the server never emits any signal at
//! all -- there is no explicit "done, zero results" signal. This async service
//! never stalls on that: the UI reads whatever the cache currently holds, and an
//! empty month simply settles whenever (if ever) a signal arrives, without
//! blocking a render (unlike the earlier fetch-on-open blocking round-trip that
//! this service replaces).

use std::collections::HashMap;

use chrono::{DateTime, Local, NaiveTime, TimeZone};
use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::zvariant::OwnedValue;
use zbus::{Connection, proxy};

use crate::ServiceEvent;

/// A request routed to the calendar task.
pub(crate) enum CalendarCommand {
    /// Query the given local-day epoch range `[since, until)`. A no-op if it
    /// equals the current range.
    SetRange { since: i64, until: i64 },
}

/// One calendar event. `all_day` is computed from epoch boundaries (see
/// [`is_all_day`]); `uid` is the server's stable per-occurrence identifier used
/// as the live cache key.
#[derive(Debug, Clone, PartialEq)]
pub struct CalendarEvent {
    pub uid: String,
    pub summary: String,
    pub start_epoch: i64,
    pub end_epoch: i64,
    pub all_day: bool,
}

/// Snapshot emitted on every cache change. `has_calendars` is false when no EDS
/// calendars are configured; `events` may be empty in either state.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CalendarSnapshot {
    pub has_calendars: bool,
    pub events: Vec<CalendarEvent>,
}

/// One event tuple as `EventsAddedOrUpdated` delivers it: `(uid, summary,
/// start_epoch, end_epoch, extras)`. `extras` is accepted for interface-shape
/// correctness but unused -- GNOME Shell's own client (`js/ui/calendar.js`
/// `_onEventsAddedOrUpdated`) doesn't read it either; all-day is inferred from
/// the start/end epoch alignment instead (see [`is_all_day`]).
type RawEvent = (String, String, i64, i64, HashMap<String, OwnedValue>);

#[proxy(
    interface = "org.gnome.Shell.CalendarServer",
    default_service = "org.gnome.Shell.CalendarServer",
    default_path = "/org/gnome/Shell/CalendarServer"
)]
trait CalendarServer {
    fn set_time_range(&self, since: i64, until: i64, force_reload: bool) -> zbus::Result<()>;

    #[zbus(signal)]
    fn events_added_or_updated(&self, events: Vec<RawEvent>) -> zbus::Result<()>;

    #[zbus(signal)]
    fn events_removed(&self, ids: Vec<String>) -> zbus::Result<()>;

    #[zbus(property)]
    fn has_calendars(&self) -> zbus::Result<bool>;
}

/// Whether a `(start_epoch, end_epoch)` pair encodes an all-day event: an
/// all-day event's start AND end both land on an exact local midnight, end after
/// start (matches how EDS/iCal `DATE`-only values convert to a UTC instant),
/// rather than trusting `extras` (which GNOME Shell's own client does not read
/// either). Pure epoch math; unrepresentable epochs are treated as not-all-day
/// (defensive; should not happen for real EDS data).
fn is_all_day(start_epoch: i64, end_epoch: i64) -> bool {
    let (Some(start), Some(end)) = (
        Local.timestamp_opt(start_epoch, 0).single(),
        Local.timestamp_opt(end_epoch, 0).single(),
    ) else {
        return false;
    };
    let is_midnight = |dt: DateTime<Local>| dt.time() == NaiveTime::MIN;
    is_midnight(start) && is_midnight(end) && end > start
}

/// Convert one raw `(uid, summary, start_epoch, end_epoch, extras)` tuple into a
/// [`CalendarEvent`], computing `all_day` from the epoch alignment.
fn raw_to_event(raw: RawEvent) -> CalendarEvent {
    let (uid, summary, start_epoch, end_epoch, _extras) = raw;
    let all_day = is_all_day(start_epoch, end_epoch);
    CalendarEvent {
        uid,
        summary,
        start_epoch,
        end_epoch,
        all_day,
    }
}

/// Build a deterministic chronological snapshot from the current cache.
fn snapshot(has_calendars: bool, cache: &HashMap<String, CalendarEvent>) -> CalendarSnapshot {
    let mut events = cache.values().cloned().collect::<Vec<_>>();
    sort_calendar_events(&mut events);
    CalendarSnapshot { has_calendars, events }
}

fn sort_calendar_events(events: &mut [CalendarEvent]) {
    events.sort_by(|a, b| {
        a.start_epoch
            .cmp(&b.start_epoch)
            .then(a.end_epoch.cmp(&b.end_epoch))
            .then_with(|| a.uid.cmp(&b.uid))
    });
}

/// Calendar service task. Connects once, subscribes to `EventsAddedOrUpdated` +
/// `EventsRemoved` BEFORE any `SetTimeRange` (so a reply signal can never fire in
/// the window before we start listening -- the same subscribe-then-call ordering
/// the blocking predecessor relied on), maintains a live per-uid cache, applies
/// adds/removes as they stream in, and emits `ServiceEvent::Calendar` on every
/// change. Never claims a bus name, so shutdown just aborts the task.
pub(crate) async fn run(events: UnboundedSender<ServiceEvent>, mut cmd_rx: UnboundedReceiver<CalendarCommand>) {
    let conn = match Connection::session().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[calendar] no session bus: {e}");
            let _ = events.send(ServiceEvent::Calendar(CalendarSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };
    let proxy = match CalendarServerProxy::new(&conn).await {
        Ok(proxy) => proxy,
        Err(e) => {
            tracing::warn!("[calendar] proxy: {e}");
            let _ = events.send(ServiceEvent::Calendar(CalendarSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    // Subscribe BEFORE any SetTimeRange so the reply signal can never fire in the
    // window before we start listening.
    let mut added: BoxStream<'static, _> = match proxy.receive_events_added_or_updated().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[calendar] EventsAddedOrUpdated watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };
    let mut removed: BoxStream<'static, _> = match proxy.receive_events_removed().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[calendar] EventsRemoved watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };

    let has_calendars = proxy.has_calendars().await.unwrap_or(false);
    tracing::info!("[calendar] connected; has_calendars={has_calendars}");
    let mut cache: HashMap<String, CalendarEvent> = HashMap::new();
    // The range currently loaded; a SetRange for the same range is a no-op.
    let mut range: Option<(i64, i64)> = None;
    // Baseline emit so the UI has an initial (empty) snapshot before any query.
    let _ = events.send(ServiceEvent::Calendar(snapshot(has_calendars, &cache)));

    loop {
        tokio::select! {
            Some(signal) = added.next() => {
                if let Ok(args) = signal.args() {
                    for raw in args.events {
                        let ev = raw_to_event(raw);
                        cache.insert(ev.uid.clone(), ev);
                    }
                    let _ = events.send(ServiceEvent::Calendar(snapshot(has_calendars, &cache)));
                }
            }
            Some(signal) = removed.next() => {
                if let Ok(args) = signal.args() {
                    let mut changed = false;
                    for id in args.ids {
                        changed |= cache.remove(&id).is_some();
                    }
                    if changed {
                        let _ =
                            events.send(ServiceEvent::Calendar(snapshot(has_calendars, &cache)));
                    }
                }
            }
            Some(cmd) = cmd_rx.recv() => {
                match cmd {
                    CalendarCommand::SetRange { since, until } => {
                        if range == Some((since, until)) {
                            continue;
                        }
                        range = Some((since, until));
                        // Clear the cache first: the server re-emits every event
                        // for the new window (force_reload=true), matching GNOME
                        // Shell's own client behaviour. Emit the cleared snapshot
                        // now so the UI drops the old month immediately; the new
                        // month streams in via EventsAddedOrUpdated.
                        cache.clear();
                        let _ =
                            events.send(ServiceEvent::Calendar(snapshot(has_calendars, &cache)));
                        // CalendarServer's SetTimeRange has no default
                        // deadline; bound it so a hung EDS backend doesn't
                        // stall event add/remove signal processing too.
                        crate::with_command_timeout("calendar", async {
                            if let Err(e) = proxy.set_time_range(since, until, true).await {
                                tracing::warn!("[calendar] SetTimeRange failed: {e}");
                            }
                        })
                        .await;
                    }
                }
            }
            else => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    /// Local-time epoch for a `(year, month, day, hour, minute)` wall-clock time.
    fn epoch(y: i32, mo: u32, day: u32, h: u32, mi: u32) -> i64 {
        Local
            .from_local_datetime(
                &NaiveDate::from_ymd_opt(y, mo, day)
                    .unwrap()
                    .and_hms_opt(h, mi, 0)
                    .unwrap(),
            )
            .single()
            .unwrap()
            .timestamp()
    }

    #[test]
    fn is_all_day_detects_midnight_to_midnight() {
        // A one-day all-day event: DTSTART/DTEND both land on a local midnight,
        // one day apart (how an iCal DATE-only value round-trips through this
        // interface's epoch-second encoding).
        assert!(is_all_day(epoch(2026, 7, 13, 0, 0), epoch(2026, 7, 14, 0, 0)));
    }

    #[test]
    fn is_all_day_false_for_midnight_start_only() {
        // Starts exactly at midnight but does NOT end on a midnight boundary --
        // a real (if unusual) timed event, not an all-day one.
        assert!(!is_all_day(epoch(2026, 7, 13, 0, 0), epoch(2026, 7, 13, 0, 30)));
    }

    #[test]
    fn is_all_day_false_for_timed_event() {
        assert!(!is_all_day(epoch(2026, 7, 6, 9, 45), epoch(2026, 7, 6, 10, 0)));
    }

    #[test]
    fn is_all_day_false_for_zero_length_midnight() {
        // Both on midnight but end == start (not end > start): not all-day.
        let m = epoch(2026, 7, 13, 0, 0);
        assert!(!is_all_day(m, m));
    }

    #[test]
    fn raw_to_event_carries_fields_and_computes_all_day() {
        let raw = (
            "uid-1".to_string(),
            "My Birthday".to_string(),
            epoch(2026, 7, 13, 0, 0),
            epoch(2026, 7, 14, 0, 0),
            HashMap::new(),
        );
        let ev = raw_to_event(raw);
        assert_eq!(ev.uid, "uid-1");
        assert_eq!(ev.summary, "My Birthday");
        assert!(ev.all_day);

        let timed = (
            "uid-2".to_string(),
            "Daily Standup".to_string(),
            epoch(2026, 7, 6, 9, 45),
            epoch(2026, 7, 6, 10, 0),
            HashMap::new(),
        );
        let ev = raw_to_event(timed);
        assert!(!ev.all_day);
        assert_eq!(ev.start_epoch, epoch(2026, 7, 6, 9, 45));
    }
    #[test]
    fn calendar_events_have_a_stable_chronological_order() {
        let mut events = vec![
            CalendarEvent {
                uid: "delta".to_string(),
                summary: String::new(),
                start_epoch: 20,
                end_epoch: 30,
                all_day: false,
            },
            CalendarEvent {
                uid: "zulu".to_string(),
                summary: String::new(),
                start_epoch: 10,
                end_epoch: 15,
                all_day: false,
            },
            CalendarEvent {
                uid: "alpha".to_string(),
                summary: String::new(),
                start_epoch: 10,
                end_epoch: 15,
                all_day: false,
            },
            CalendarEvent {
                uid: "beta".to_string(),
                summary: String::new(),
                start_epoch: 10,
                end_epoch: 20,
                all_day: false,
            },
        ];

        sort_calendar_events(&mut events);

        assert_eq!(
            events.iter().map(|event| event.uid.as_str()).collect::<Vec<_>>(),
            vec!["alpha", "zulu", "beta", "delta"],
        );
    }
}
