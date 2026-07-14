//! Shared root contexts + hooks for the on-demand surfaces (launcher/quicksettings/
//! calendar/drawer/session): the reveal-opacity context every panel multiplies into
//! its root opacity, the "grow in" scale spring layered on top of it, the routed
//! key/IME event feeds for keyboard-Exclusive surfaces, and the dismiss layer's
//! body (a transparent full-screen press catcher that closes any open surface --
//! the host swaps its wl input region empty/full so it only catches clicks while a
//! surface is open, so the body itself is always mounted).

use freya_core::prelude::*;

use crate::manager::{ShellBus, ShellMsg};

/// Additive per-surface root context: the reveal opacity (0 hidden .. 1 revealed)
/// the manager's spring writes every animated frame. The surface UI multiplies it
/// into its root opacity. A newtype (not a bare `State<f32>`) so it never collides
/// with the frozen snapshot contexts and reads as intent at the consume site.
#[derive(Clone, Copy, PartialEq)]
pub struct OpenProgress(pub State<f32>);

/// Rest scale for [`use_open_scale`] -- a panel starts at 96% size and springs
/// up to 100% on open. Small enough to read as a subtle "grow in", not a
/// jarring pop.
const OPEN_SCALE_REST: f32 = 0.96;

/// Rising-edge threshold on the reveal opacity, shared by every caller of
/// [`use_open_scale`]. Mirrors the per-surface `OPEN_EPS` constants already
/// defined in calendar.rs/session.rs for their own "did the surface just
/// start opening" checks -- kept local here rather than importing theirs so
/// this module has no dependency on them.
const OPEN_SCALE_EPS: f32 = 1e-4;

/// A local, per-panel "grow in" scale spring, layered on top of the manager's
/// opacity fade rather than replacing it. The manager (manager.rs) only ever
/// drove opacity -- `PANEL_OPACITY` (k=360, d=32) on open, `PANEL_CLOSE`
/// (k=640, d=48) on close -- ported verbatim from the original AGS reveal
/// (archive/ags/lib/surface.ts `animateProgress`). `motion::PANEL_OPEN`
/// (k=420, d=26, "slight overshoot") was defined from day one in both the AGS
/// spring table and this port but never actually wired to anything visible:
/// dead code with clear "the panel should grow in with a slight bounce"
/// intent that nothing consumed. This is that wiring.
///
/// Deliberately implemented as a LOCAL per-panel effect (not a manager.rs
/// change): manager.rs currently carries substantial unrelated in-progress
/// work this pass must not disturb, and the manager's opacity-only contract
/// is exactly right anyway -- visual flourish belongs in the UI layer, the
/// manager stays a pure reveal state machine.
///
/// Call once per panel body with that panel's live [`OpenProgress`] value.
/// Returns a scale factor: apply it via `.scale(value)` on the panel's root
/// `rect()` (the `.scale()` default `transform_origin` is the element's
/// center, which reads well for every current panel -- no per-surface anchor
/// special-casing needed). Rests at [`OPEN_SCALE_REST`], springs to `1.0` the
/// instant `opacity` rises off zero (the same closed->open edge every panel
/// already keys its own today/query/events-refresh effects on), and
/// deliberately never reverses on close: the overshoot is an entrance-only
/// flourish -- AGS's close is a plain fast fade with no bounce, and this port
/// keeps that closing behaviour unchanged.
pub(crate) fn use_open_scale(opacity: f32) -> f32 {
    let mut spring = crate::motion::use_spring(OPEN_SCALE_REST);
    let open = opacity > OPEN_SCALE_EPS;
    use_side_effect_with_deps(&open, move |&open| {
        if open {
            spring.to(1.0, crate::motion::PANEL_OPEN);
        }
    });
    spring.value()
}

/// Additive root context for keyboard-Exclusive surfaces (launcher, session):
/// the host's key stream, routed by main.rs to whichever exclusive surface is
/// open. `seq` increments per event so consumers can detect delivery of
/// repeated identical presses. `None` until the first key arrives.
#[derive(Clone, Copy, PartialEq)]
pub struct KeyFeed(pub State<Option<KeyEvent>>);

/// One delivered key press (host [`kobel_wayland::KeyPress`] plus a sequence
/// number). Compared by `seq` alone: two events are "equal" only if they are
/// the same delivery, which is exactly what change-detection wants.
#[derive(Clone)]
pub struct KeyEvent {
    pub seq: u64,
    pub press: kobel_wayland::KeyPress,
}

impl PartialEq for KeyEvent {
    fn eq(&self, other: &Self) -> bool {
        self.seq == other.seq
    }
}

/// Additive root context for the launcher's text field (the only surface with a
/// real text-editing IME target): the host's IME `done` stream, routed by main.rs
/// while the launcher currently holds text-input focus (`ImeEvent::Enter` matched
/// against the launcher's `SurfaceId`). `seq` increments per delivery so consumers
/// can detect repeats. `None` until the first commit arrives, and reset to `None`
/// whenever text-input focus leaves the launcher (clears any live preedit).
#[derive(Clone, Copy, PartialEq)]
pub struct ImeFeed(pub State<Option<ImeFeedEvent>>);

/// One delivered IME `done` payload (host [`kobel_wayland::ImeCommit`]) plus a
/// sequence number. Compared by `seq` alone, like [`KeyEvent`].
#[derive(Clone)]
pub struct ImeFeedEvent {
    pub seq: u64,
    pub commit: kobel_wayland::ImeCommit,
}

impl PartialEq for ImeFeedEvent {
    fn eq(&self, other: &Self) -> bool {
        self.seq == other.seq
    }
}

/// The dismiss layer body: a transparent full-screen press catcher that closes any
/// open surface. Click-through vs catching is decided host-side by swapping the wl
/// input region (empty when nothing is open), so this body is always mounted.
pub fn dismiss() -> impl IntoElement {
    Dismiss
}

#[derive(PartialEq)]
struct Dismiss;

impl Component for Dismiss {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        rect().expanded().on_press(move |_| bus.send(ShellMsg::CloseAll))
    }
}
