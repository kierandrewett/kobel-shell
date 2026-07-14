// ime.rs -- pure data for zwp_text_input_v3 preedit and commit events. The
// Wayland glue (global bind, per-seat text-input object and Dispatch impls) lives
// in conn.rs. This file holds the accumulated-state shape and app-facing event
// enum that can be tested without a live Wayland connection.
//
// Protocol: text-input-unstable-v3 (mutter implements it natively as a core input
// method surface, not gated like the wlr-* extensions -- see
// /home/kieran/dev/gnoblin/subprojects/mutter/src/wayland/meta-wayland-text-input.c).
// zwp_text_input_v3's preedit_string/commit_string/delete_surrounding_text events
// are double-buffered: each sets pending state, and a `done` event atomically
// replaces the current state with everything pending, then the pending state
// resets to its initial (empty) value for the next cycle. `ImeCommit` is that one
// atomic payload.

use crate::SurfaceId;

/// The compositor's live composing (not-yet-committed) text, from `preedit_string`.
/// `cursor_begin`/`cursor_end` are byte offsets into `text`; `None` means the
/// compositor asked for the cursor to be hidden (wire value -1 for both, per
/// protocol -- decode_cursor below).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Preedit {
    pub text: String,
    pub cursor_begin: Option<usize>,
    pub cursor_end: Option<usize>,
}

/// One atomic payload delivered on `done`. The protocol's mandated `done`
/// application order (text-input-unstable-v3.xml) has 7 steps; the ones this
/// struct's fields carry, in order, are:
///   1. Remove any PREVIOUSLY shown preedit text (implicit -- there is no
///      field for it; a caller replacing its editor's composing-text region
///      with nothing accomplishes this).
///   2. Delete `delete_before`/`delete_after` bytes around the cursor.
///      Per the protocol, if a preedit was showing, these counts are
///      relative to ITS start/end, not the raw committed-text cursor -- which
///      step 1 already collapsed away, so applying delete against the
///      cursor position AFTER removing the old preedit is correct.
///   3. Insert `commit` at the (now-adjusted) cursor.
///   4. (Recalculate surrounding text to send back -- no field here; a
///      caller re-reports it via `ime_sync_surrounding_text`.)
///   5. Show `preedit` as the new composing text at the cursor.
///
/// Step 6 (cursor-inside-preedit placement) is `preedit`'s own cursor fields.
/// Step 7 (`action`) is a separate `zwp_text_input_v3.action` event, `since="2"`
/// -- this crate binds the manager at version 1 only (`conn.rs`'s
/// `globals.bind::<ZwpTextInputManagerV3, _, _>(&qh, 1..=1, ())`), so a v2+
/// event can never arrive here at all; it is not folded into anything.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ImeCommit {
    pub delete_before: u32,
    pub delete_after: u32,
    pub commit: Option<String>,
    pub preedit: Option<Preedit>,
}

impl ImeCommit {
    /// True when this payload is a no-op (nothing to delete, commit, or preedit) --
    /// worth skipping a dispatch for.
    pub fn is_empty(&self) -> bool {
        self.delete_before == 0 && self.delete_after == 0 && self.commit.is_none() && self.preedit.is_none()
    }
}

/// Decode a `preedit_string` cursor arg pair: both -1 means "hidden" (`None`);
/// mutter never sends one -1 and one real value per the spec's paired semantics, so
/// a lone negative is treated the same as both being -1 (defensive, not a panic).
pub(crate) fn decode_cursor(begin: i32, end: i32) -> (Option<usize>, Option<usize>) {
    if begin < 0 || end < 0 {
        (None, None)
    } else {
        (Some(begin as usize), Some(end as usize))
    }
}

/// Events the app-level `on_ime` handler (installed via `Shell::on_ime`) receives.
/// Enter/Leave mirror keyboard focus (mutter drives them automatically); Commit
/// carries one `done` payload for whichever surface currently holds IME focus
/// (tracked by the caller from the Enter/Leave pair, not carried here -- the
/// protocol's `done` event has no surface argument, only a serial).
///
/// EVERY `done` is dispatched, even an in-sync one with an empty `payload`:
/// the host has no visibility into whether the caller is currently deferring
/// a pending state request (surrounding text, cursor rectangle) behind an
/// earlier out-of-sync `done`, so it cannot safely decide any `done` is
/// "boring" and drop it -- an empty in-sync done reached right after an
/// out-of-sync one IS the release signal such a caller is waiting for, and
/// suppressing it would leave that caller deferred forever.
#[derive(Debug, Clone, PartialEq)]
pub enum ImeEvent {
    /// Text-input focus entered this surface.
    Enter(SurfaceId),
    /// Text-input focus left this surface.
    Leave(SurfaceId),
    /// One `done` event. `serial` is the protocol's "as of this many
    /// `zwp_text_input_v3.commit` requests" counter, as the compositor last
    /// saw it; `in_sync` is true when it matches the number of
    /// [`Control::ime_commit`](crate::Control::ime_commit) calls made so far.
    ///
    /// When `in_sync` is false, a LATER commit the caller already sent is
    /// still in flight and this `done` reflects an OLDER one. `payload` is
    /// still correct to apply as-is -- the protocol requires evaluating and
    /// applying preedit/commit/delete changes unconditionally regardless of
    /// serial match -- but any PENDING state request the caller wants to
    /// (re)send (surrounding text, cursor rectangle) should wait for a
    /// SUBSEQUENT `in_sync` done rather than racing ahead of a commit
    /// already in flight. `payload` is frequently empty when `in_sync` is
    /// true too (a bare acknowledgement, or the specific "you may now
    /// resend" transition after a run of out-of-sync dones) -- callers that
    /// only care about content changes must check `payload.is_empty()`
    /// themselves; the host does not filter on their behalf (see this
    /// enum's own doc for why).
    Commit {
        payload: ImeCommit,
        serial: u32,
        in_sync: bool,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_cursor_both_present() {
        assert_eq!(decode_cursor(2, 5), (Some(2), Some(5)));
    }

    #[test]
    fn decode_cursor_both_hidden() {
        assert_eq!(decode_cursor(-1, -1), (None, None));
    }

    #[test]
    fn decode_cursor_defensive_on_lone_negative() {
        assert_eq!(decode_cursor(-1, 3), (None, None));
        assert_eq!(decode_cursor(3, -1), (None, None));
    }

    #[test]
    fn empty_commit_is_empty() {
        assert!(ImeCommit::default().is_empty());
    }

    #[test]
    fn commit_with_text_is_not_empty() {
        let c = ImeCommit {
            commit: Some("a".to_string()),
            ..Default::default()
        };
        assert!(!c.is_empty());
    }

    #[test]
    fn commit_with_only_delete_is_not_empty() {
        let c = ImeCommit {
            delete_before: 1,
            ..Default::default()
        };
        assert!(!c.is_empty());
    }

    #[test]
    fn commit_with_only_preedit_is_not_empty() {
        let c = ImeCommit {
            preedit: Some(Preedit {
                text: "x".to_string(),
                cursor_begin: None,
                cursor_end: None,
            }),
            ..Default::default()
        };
        assert!(!c.is_empty());
    }

    #[test]
    fn commit_event_carries_serial_and_sync_state_verbatim() {
        let event = ImeEvent::Commit {
            payload: ImeCommit::default(),
            serial: 3,
            in_sync: false,
        };
        assert_eq!(
            event,
            ImeEvent::Commit {
                payload: ImeCommit::default(),
                serial: 3,
                in_sync: false,
            }
        );
    }
}
