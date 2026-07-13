//! Placeholder on-demand surface bodies for the reveal wave.
//!
//! Every on-demand surface (launcher/quicksettings/calendar/drawer/session) mounts
//! this same sheet-styled placeholder this wave, so the reveal machinery is provable
//! end to end before the real surface UIs land. The body reads the additive
//! per-surface [`OpenProgress`] context -- the opacity the manager's reveal spring
//! animates (docs/FREYA-PLAN.md 2.4) -- and multiplies it into its root opacity, so
//! a closed-but-mapped surface renders fully transparent.
//!
//! [`dismiss`] is the dismiss layer's body: a transparent full-screen catcher that
//! closes everything on a press. The host swaps its wl input region empty/full so it
//! only catches clicks while a surface is open; the body itself is always mounted.

use freya_core::prelude::*;

use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::theme;

/// Additive per-surface root context: the reveal opacity (0 hidden .. 1 revealed)
/// the manager's spring writes every animated frame. The surface UI multiplies it
/// into its root opacity. A newtype (not a bare `State<f32>`) so it never collides
/// with the frozen snapshot contexts and reads as intent at the consume site.
#[derive(Clone, Copy, PartialEq)]
pub struct OpenProgress(pub State<f32>);

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

/// The shared placeholder panel body for `key`: a sheet (PANEL fill, sheet radius)
/// labelled with the surface name, faded by the surface's [`OpenProgress`].
pub fn panel(key: SurfaceKey) -> impl IntoElement {
    Panel { key }
}

#[derive(PartialEq)]
struct Panel {
    key: SurfaceKey,
}

impl Component for Panel {
    fn render(&self) -> impl IntoElement {
        // Reading the progress subscribes this scope, so the manager's per-frame
        // writes re-render the panel (its opacity) as the reveal spring moves.
        let progress = use_consume::<OpenProgress>();
        let opacity = *progress.0.read();

        rect().expanded().opacity(opacity).child(
            rect()
                .expanded()
                .center()
                .background(theme::PANEL.rgb())
                .corner_radius(theme::RADIUS_SHEET)
                .child(
                    label()
                        .text(placeholder_name(self.key))
                        .color(theme::TX.rgb())
                        .font_size(theme::FONT_SIZE_MAX)
                        .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
                ),
        )
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

/// Human-readable label naming the surface, shown on its placeholder sheet.
fn placeholder_name(key: SurfaceKey) -> &'static str {
    match key {
        SurfaceKey::Launcher => "Launcher",
        SurfaceKey::QuickSettings => "Quick Settings",
        SurfaceKey::Calendar => "Calendar",
        SurfaceKey::Drawer => "Drawer",
        SurfaceKey::Session => "Session",
    }
}
