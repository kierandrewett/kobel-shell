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

/// One atomic payload delivered on `done`: apply in this exact order (matches the
/// protocol's mandated application order) -- delete `delete_before`/`delete_after`
/// bytes around the cursor, insert `commit` at the (now-adjusted) cursor, then show
/// `preedit` as the new composing text at the cursor.
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
/// carries one atomic `done` payload for whichever surface currently holds IME
/// focus (tracked by the caller from the Enter/Leave pair, not carried here --
/// the protocol's `done` event has no surface argument, only a serial).
#[derive(Debug, Clone, PartialEq)]
pub enum ImeEvent {
    /// Text-input focus entered this surface.
    Enter(SurfaceId),
    /// Text-input focus left this surface.
    Leave(SurfaceId),
    /// An atomic `done` payload. Empty commits ([`ImeCommit::is_empty`]) are
    /// filtered out by the host before dispatch -- every `Commit` here carries at
    /// least one real change.
    Commit(ImeCommit),
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
}
