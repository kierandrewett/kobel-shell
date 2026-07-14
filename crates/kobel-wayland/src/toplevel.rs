// toplevel.rs -- pure data/logic for zwlr_foreign_toplevel_manager_v1 (window list +
// activate/minimize/close for the dock/bar). The Wayland glue (global bind, Dispatch
// impls, Host fields) lives in conn.rs alongside every other raw-Dispatch protocol
// (fractional-scale, viewporter, xdg shell) -- Host is private to that module, so
// there is nowhere else for the glue to live. This file holds only what can be
// tested without a live Wayland connection: the public snapshot type and the
// `state` event's wire decode.
//
// Protocol: /home/kieran/dev/gnoblin/src/protocols/foreign-toplevel-management/
// wlr-foreign-toplevel-management-unstable-v1.xml (v3, gnoblin's mutter implements
// it natively and gates it on by default -- no gnoblin-side changes needed). This
// replaces kobel-services' old org.gnoblin.Shell ListWindows/ActivateWindow/
// MinimizeWindow D-Bus calls, which never existed on that interface (see
// crates/kobel-services/src/gnoblin.rs and README.md).

/// One compositor window, sourced from `zwlr_foreign_toplevel_handle_v1`. `id` is a
/// host-minted stable string (a monotonic counter, not a Wayland object id -- object
/// ids are an implementation detail and not guaranteed stable-shaped across
/// wayland-client versions), matching the shape `kobel_services::GnoblinWindow` used
/// to carry over D-Bus so `crates/kobel-shell/src/main.rs` can map 1:1.
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
/// enum: `maximized=0, minimized=1, activated=2, fullscreen=3`. Returns
/// `(focused, minimized)`; maximized/fullscreen are not surfaced (the dock only
/// needs focus + minimized). A malformed (non-multiple-of-4) trailing remainder is
/// ignored rather than panicking -- the compositor is trusted but not blindly.
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
}
