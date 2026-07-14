// toplevel.rs -- pure data and batching logic for
// zwlr_foreign_toplevel_manager_v1 window discovery and control. The Wayland glue
// lives in conn.rs with the other raw Dispatch implementations. This module keeps
// the public snapshot, wire-state decoder and stage-then-publish state machine
// independently testable without a live Wayland connection.
//
// Protocol: /home/kieran/dev/gnoblin/src/protocols/foreign-toplevel-management/
// wlr-foreign-toplevel-management-unstable-v1.xml (v3, gnoblin's mutter implements
// it natively and gates it on by default -- no gnoblin-side changes needed). This
// replaces kobel-services' old org.gnoblin.Shell ListWindows/ActivateWindow/
// MinimizeWindow D-Bus calls, which never existed on that interface (see
// crates/kobel-services/src/gnoblin.rs and README.md).

/// One compositor window, sourced from `zwlr_foreign_toplevel_handle_v1`. `id` is a
/// host-minted stable string rather than a Wayland object id, whose representation is
/// an implementation detail. This type is the single source of truth for window
/// state and is exposed through `Control::toplevels`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ToplevelInfo {
    pub id: String,
    pub app_id: String,
    pub title: String,
    pub focused: bool,
    pub minimized: bool,
}

/// Decode the `state` event's wire array: a sequence of native-endian u32 enum
/// values (the standard wayland-scanner array-of-enum convention -- see e.g. sctk's
/// own xdg_toplevel configure-states decoding). Values per the protocol's `state`
/// enum: `maximized=0, minimized=1, activated=2, fullscreen=3`. Returns the
/// `(focused, minimized)` fields exposed by [`ToplevelInfo`]. A malformed trailing
/// remainder is ignored rather than panicking.
pub(crate) fn decode_state_array(bytes: &[u8]) -> (bool, bool) {
    const STATE_MINIMIZED: u32 = 1;
    const STATE_ACTIVATED: u32 = 2;
    let mut focused = false;
    let mut minimized = false;
    for chunk in bytes.chunks_exact(4) {
        let value = u32::from_ne_bytes(chunk.try_into().expect("chunks_exact(4) yields 4 bytes"));
        match value {
            STATE_MINIMIZED => minimized = true,
            STATE_ACTIVATED => focused = true,
            _ => {}
        }
    }
    (focused, minimized)
}

/// Pure batching state-machine for one `zwlr_foreign_toplevel_handle_v1`: stages
/// Title/AppId/State field writes and exposes them via [`ToplevelState::published`]
/// only after [`ToplevelState::publish`] (called on `done`) has run at least once.
/// Extracted from the `Dispatch` impl in conn.rs (which owns the real
/// `ZwlrForeignToplevelHandleV1` proxy and can't be constructed off-compositor) so
/// the stage-then-publish invariant -- required by the protocol's documented
/// atomicity guarantee for `done` -- is unit-testable on its own, without a live
/// Wayland connection.
#[derive(Debug, Clone, Default)]
pub(crate) struct ToplevelState {
    pending: ToplevelInfo,
    published: Option<ToplevelInfo>,
}

impl ToplevelState {
    /// A freshly-created toplevel: `id` is known immediately (host-minted), every
    /// other field starts empty, and nothing is published yet.
    pub(crate) fn new(id: String) -> Self {
        Self {
            pending: ToplevelInfo {
                id,
                ..Default::default()
            },
            published: None,
        }
    }

    /// The host-minted id, stable for this toplevel's whole lifetime -- valid even
    /// before the first `publish`, so lookups (activate/minimize/close) work
    /// regardless of publish state.
    pub(crate) fn id(&self) -> &str {
        &self.pending.id
    }

    /// The latest known fields, published or not -- for logging only (e.g. on
    /// `closed`, where "whatever we knew" is more useful than nothing).
    pub(crate) fn pending(&self) -> &ToplevelInfo {
        &self.pending
    }

    pub(crate) fn set_title(&mut self, title: String) {
        self.pending.title = title;
    }

    pub(crate) fn set_app_id(&mut self, app_id: String) {
        self.pending.app_id = app_id;
    }

    pub(crate) fn set_focus_and_minimized(&mut self, focused: bool, minimized: bool) {
        self.pending.focused = focused;
        self.pending.minimized = minimized;
    }

    /// Apply `done`: publish every field staged since the last publish (or since
    /// creation, for the first `done`) as one atomic snapshot. A field the
    /// compositor did not resend this batch keeps whatever `pending` already held
    /// (its own last-published value) -- it is never reset to default.
    pub(crate) fn publish(&mut self) {
        self.published = Some(self.pending.clone());
    }

    /// The last-published snapshot, or `None` if `publish` has never run -- the
    /// toplevel has no confirmed data yet and must not appear in a caller-visible
    /// list.
    pub(crate) fn published(&self) -> Option<&ToplevelInfo> {
        self.published.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_bytes(values: &[u32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_ne_bytes()).collect()
    }

    #[test]
    fn empty_state_is_unfocused_and_not_minimized() {
        assert_eq!(decode_state_array(&[]), (false, false));
    }

    #[test]
    fn activated_only() {
        assert_eq!(decode_state_array(&state_bytes(&[2])), (true, false));
    }

    #[test]
    fn minimized_only() {
        assert_eq!(decode_state_array(&state_bytes(&[1])), (false, true));
    }

    #[test]
    fn maximized_and_activated_ignores_maximized() {
        assert_eq!(decode_state_array(&state_bytes(&[0, 2])), (true, false));
    }

    #[test]
    fn fullscreen_and_minimized_ignores_fullscreen() {
        assert_eq!(decode_state_array(&state_bytes(&[3, 1])), (false, true));
    }

    #[test]
    fn order_independent() {
        assert_eq!(decode_state_array(&state_bytes(&[2, 1])), (true, true));
        assert_eq!(decode_state_array(&state_bytes(&[1, 2])), (true, true));
    }

    #[test]
    fn malformed_trailing_bytes_ignored_not_panicking() {
        let mut bytes = state_bytes(&[2]);
        bytes.push(0xFF); // 1 trailing byte, not a full u32
        assert_eq!(decode_state_array(&bytes), (true, false));
    }

    #[test]
    fn new_toplevel_has_no_published_snapshot() {
        let state = ToplevelState::new("0".into());
        assert_eq!(state.published(), None);
    }

    #[test]
    fn staged_fields_stay_invisible_until_publish() {
        let mut state = ToplevelState::new("0".into());
        state.set_title("Firefox".into());
        state.set_app_id("org.mozilla.firefox".into());
        state.set_focus_and_minimized(true, false);
        // Nothing published yet: a caller must not see this in-progress batch.
        assert_eq!(state.published(), None);
    }

    #[test]
    fn publish_makes_every_staged_field_visible_together() {
        let mut state = ToplevelState::new("0".into());
        state.set_title("Firefox".into());
        state.set_app_id("org.mozilla.firefox".into());
        state.set_focus_and_minimized(true, false);
        state.publish();
        let info = state.published().expect("published after done");
        assert_eq!(info.id, "0");
        assert_eq!(info.title, "Firefox");
        assert_eq!(info.app_id, "org.mozilla.firefox");
        assert!(info.focused);
        assert!(!info.minimized);
    }

    #[test]
    fn later_batch_omitting_a_field_keeps_its_prior_value() {
        let mut state = ToplevelState::new("0".into());
        state.set_title("Firefox".into());
        state.set_app_id("org.mozilla.firefox".into());
        state.publish();
        // A tab switch resends only the title; app_id is not part of this batch.
        state.set_title("Firefox - New Tab".into());
        state.publish();
        let info = state.published().unwrap();
        assert_eq!(info.title, "Firefox - New Tab");
        assert_eq!(info.app_id, "org.mozilla.firefox"); // preserved, not reset
    }

    #[test]
    fn a_write_after_publish_is_invisible_until_the_next_publish() {
        let mut state = ToplevelState::new("0".into());
        state.set_title("Firefox".into());
        state.publish();
        state.set_title("Firefox - New Tab".into()); // mid next batch, no done yet
        // The published snapshot must still reflect the LAST publish, not this
        // still-accumulating write -- this is the exact bug being regression-
        // tested: a caller polling mid-batch must never see a torn update.
        assert_eq!(state.published().unwrap().title, "Firefox");
    }

    #[test]
    fn id_is_stable_and_readable_before_the_first_publish() {
        let state = ToplevelState::new("42".into());
        assert_eq!(state.id(), "42");
        assert_eq!(state.published(), None);
    }
}
