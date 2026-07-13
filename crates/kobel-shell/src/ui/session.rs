//! Session overlay -- the full-screen power menu (ags/widget/Session.tsx).
//!
//! A dim scrim over every edge with a centered row of four actions
//! [Lock, Log out, Restart, Shut down]. Keyboard-first: arrow keys move a
//! wrapping selection, Enter presses, Escape disarms-or-closes; the mouse can
//! hover to select and click to press. Lock/Log out fire on first press;
//! Restart/Shut down use a two-step "press again" confirm that auto-reverts
//! after 4s (DESIGN.md v3 "two-step confirm on Restart/Shut down").
//!
//! The reveal opacity is the manager's per-surface [`OpenProgress`] spring,
//! multiplied into the root opacity exactly like the placeholder panels: a
//! closed-but-mapped surface renders fully transparent. Keys arrive through the
//! exclusive-surface [`KeyFeed`] context (main.rs routes every press to the open
//! exclusive surface).
//!
//! The arm/revert/press decisions are factored into the pure `decide_*` /
//! `step_selection` helpers below (unit-tested; no real commands run in tests);
//! the reactive body only wires those decisions to Freya state, a revert timer
//! (async_io::Timer + a generation guard, like ui/osd.rs) and the [`ShellBus`].

use std::time::Duration;

use async_io::Timer;
use freya_core::prelude::*;
use torin::prelude::{Alignment, Size};

use kobel_services::{Command, SessionVerb};
use kobel_wayland::KeyPress;

use super::icon;
use super::panels::{KeyFeed, OpenProgress, use_open_scale};
use crate::manager::{ShellBus, ShellMsg};
use crate::theme;

// Icons embedded at build time, mirroring ui/mod.rs (currentColor SVGs recolored
// per state by `super::icon`). Shut down reuses the shell-wide `ICON_POWER`.
macro_rules! session_icon {
    ($file:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/assets/hicolor/scalable/actions/",
            $file
        ))
    };
}

const ICON_LOCK: &[u8] = session_icon!("kobel-lock-symbolic.svg");
const ICON_LOGOUT: &[u8] = session_icon!("kobel-logout-symbolic.svg");
const ICON_RESTART: &[u8] = session_icon!("kobel-restart-symbolic.svg");

/// Icon tile edge (scss `.sic { min-width/height: 61px }`).
const TILE: f32 = 61.0;
/// Icon tile corner radius (scss `.sic { border-radius: 24px }`).
const TILE_RADIUS: f32 = 24.0;
/// Glyph size inside the tile (Session.tsx `pixelSize={23}`).
const ICON_SIZE: f32 = 23.0;
/// Row label size / weight (scss `.session label { font-size: 12; weight 600 }`).
const LABEL_SIZE: f32 = 12.0;
/// Confirm revert window (Session.tsx `timeout(4000, ...)`).
const REVERT_MS: u64 = 4000;
/// Rising-edge threshold on the reveal opacity: treat the surface as "open" the
/// instant the manager starts springing it up (input + exclusive keyboard are
/// enabled immediately on open, while opacity is still ~0, so the reset must fire
/// at the very first positive frame -- not at a mid-fade midpoint that could clobber
/// an early keypress). Closed publishes a bit-exact 0.0 (manager snaps to target on
/// settle), so any positive value is an open edge.
const OPEN_EPS: f32 = 1e-4;

/// The session overlay body. Returns a full-surface dim scrim (all edges) whose
/// opacity follows the manager's reveal spring; a centered row of four action
/// tiles sits on top.
pub fn session() -> impl IntoElement {
    let progress = use_consume::<OpenProgress>();
    let keyfeed = use_consume::<KeyFeed>();
    let bus = use_consume::<ShellBus>();

    // Reading progress subscribes this scope, so the manager's per-frame reveal
    // writes re-render the overlay (its opacity) as the spring moves.
    let opacity = *progress.0.read();
    let open = opacity > OPEN_EPS;

    let mut selected = use_state(|| 0usize);
    let mut armed = use_state(|| None::<Action>);
    // Revert guard, same shape as ui/osd.rs: every arm bumps `generation` and the
    // 4s revert task only disarms if its captured generation is still current. A
    // second press, an Esc-disarm, or an open/close edge bumps it again, turning a
    // stale in-flight revert into a no-op.
    let mut generation = use_state(|| 0u64);

    // Reset selection to 0 + disarm on the closed->open edge (and disarm on close,
    // matching the AGS `revealed.subscribe`). Firing on the earliest positive frame
    // (OPEN_EPS) keeps the reset ahead of any key the host could deliver.
    use_side_effect_with_deps(&open, move |open| {
        *generation.write() += 1;
        armed.set(None);
        if *open {
            selected.set(0);
        }
    });

    // Route each delivered key press. Reading the feed subscribes the scope to key
    // deliveries; the effect (keyed on the delivery `seq`) processes exactly the new
    // press. main.rs only routes keys here while session is the open exclusive
    // surface, so no open-state guard is needed.
    let seq = keyfeed.0.read().as_ref().map(|e| e.seq);
    {
        let bus = bus.clone();
        use_side_effect_with_deps(&seq, move |_| {
            let Some(ev) = keyfeed.0.peek().clone() else {
                return;
            };
            handle_key(&ev.press, selected, armed, generation, &bus);
        });
    }

    let sel = *selected.read();
    let armed_now = *armed.read();

    let scale = use_open_scale(opacity);
    let row = rect()
        .horizontal()
        .cross_align(Alignment::Center)
        .spacing(20.0)
        .scale(scale)
        .children(ACTIONS.iter().copied().enumerate().map(|(i, action)| {
            action_button(
                i,
                action,
                sel == i,
                armed_now == Some(action),
                selected,
                armed,
                generation,
                bus.clone(),
            )
            .into_element()
        }));

    // Full-screen dim scrim (rgba(9,3,14,0.8)); the whole overlay -- scrim and
    // tiles -- fades together with the reveal opacity, so a closed surface is fully
    // transparent. The tile row additionally grows in from 96% (use_open_scale) --
    // the scrim itself stays a plain fade, only the actual content "pops".
    rect()
        .expanded()
        .center()
        .opacity(opacity)
        .background(Color::from_af32rgb(0.8, 9, 3, 14))
        .child(row)
}

/// One action tile: a 61px icon tile (PANEL fill, radius 24, contact shadow) with
/// a label below. `selected` gets the 2px leaf focus ring (DESIGN.md "the only
/// outline in the system") plus `.sel` fill; `armed` swaps to the rose "Press
/// again" confirm state; the destructive Shut down tile rests rose and fills rose
/// on select/hover.
#[allow(clippy::too_many_arguments)]
fn action_button(
    i: usize,
    action: Action,
    is_selected: bool,
    is_armed: bool,
    selected: State<usize>,
    armed: State<Option<Action>>,
    generation: State<u64>,
    bus: ShellBus,
) -> impl IntoElement {
    let (tile_bg, glyph) = tile_colors(action, is_selected, is_armed);
    let (text, label_color, weight): (&'static str, theme::Rgb, u16) = if is_armed {
        ("Press again", theme::ROSE, theme::FONT_WEIGHT_BOLD)
    } else {
        (action.label(), theme::TX, theme::FONT_WEIGHT_SEMIBOLD)
    };
    // Focus ring: the one sanctioned outline. Inner alignment so it never shifts
    // layout or gets clipped by the row.
    let ring = is_selected.then(|| {
        Border::new()
            .fill(theme::LEAF.rgb())
            .width(2.0)
            .alignment(BorderAlignment::Inner)
    });

    let tile = rect()
        .width(Size::px(TILE))
        .height(Size::px(TILE))
        .center()
        .corner_radius(TILE_RADIUS)
        .background(tile_bg)
        // scss `.sic { box-shadow: 0 6px 18px rgba(0,0,0,0.3) }` (DESIGN --shadow-sm).
        .shadow((0.0, 6.0, 18.0, 0.0, (0u8, 0u8, 0u8, 76u8)))
        .border(ring)
        .child(icon(action.icon(), ICON_SIZE, glyph));

    let mut hover_sel = selected;
    rect()
        .cross_align(Alignment::Center)
        .spacing(10.0)
        .padding(6.0)
        .corner_radius(theme::RADIUS_TILE)
        .on_pointer_enter(move |_| hover_sel.set(i))
        .on_press(move |_| {
            let mut click_sel = selected;
            click_sel.set(i);
            do_press(action, armed, generation, &bus);
        })
        .child(tile)
        .child(
            label()
                .text(text)
                .color(label_color.rgb())
                .font_size(LABEL_SIZE)
                .font_weight(weight as i32),
        )
}

/// Resting/selected/armed tile fill + glyph tint, ports scss `.sic` / `.sel` /
/// `.red` rules plus the v3 "ROSEINK tile tint" confirm state.
fn tile_colors(action: Action, selected: bool, armed: bool) -> (Color, theme::Rgb) {
    if armed {
        // Confirm state: dark-rose tile, rose glyph (matches the rose "Press again").
        (theme::ROSEINK.rgb().into(), theme::ROSE)
    } else if action.destructive() {
        if selected {
            (theme::ROSE.rgb().into(), theme::ROSEINK)
        } else {
            (theme::PANEL.rgb().into(), theme::ROSE)
        }
    } else if selected {
        (theme::PANEL2.rgb().into(), theme::TX)
    } else {
        (theme::PANEL.rgb().into(), theme::TX)
    }
}

/// Apply a press to `action`: arm a confirm-required action (starting the revert
/// timer) or fire it (send the service verb, then close). Non-confirm actions and
/// an already-armed action fire immediately.
fn do_press(
    action: Action,
    mut armed: State<Option<Action>>,
    mut generation: State<u64>,
    bus: &ShellBus,
) {
    // peek's temporary must not live across the arms (match-scrutinee temporaries
    // survive the whole match; the arms write `armed`).
    let armed_now = *armed.peek();
    match decide_press(armed_now, action) {
        PressOutcome::Arm(target) => {
            tracing::info!("[session] armed {target:?} (press again to confirm)");
            armed.set(Some(target));
            let this_gen = {
                *generation.write() += 1;
                *generation.peek()
            };
            spawn(async move {
                Timer::after(Duration::from_millis(REVERT_MS)).await;
                if *generation.peek() == this_gen {
                    armed.set(None);
                }
            });
        }
        PressOutcome::Fire(verb) => {
            // Cancel any pending revert, disarm, then run + close.
            *generation.write() += 1;
            armed.set(None);
            bus.send(ShellMsg::Service(Command::Session(verb)));
            bus.send(ShellMsg::CloseAll);
        }
    }
}

/// Clear an armed confirm without firing (Esc while armed).
fn disarm(mut armed: State<Option<Action>>, mut generation: State<u64>) {
    tracing::info!("[session] disarmed");
    *generation.write() += 1;
    armed.set(None);
}

/// Translate one host key press into a selection move / press / escape.
///
/// Arrow repeats are honored (hold-to-cycle); Enter and Escape ignore key repeats
/// so a held Enter can never turn "arm" into the second confirm, and a held Escape
/// cannot disarm-then-close in one hold.
fn handle_key(
    press: &KeyPress,
    mut selected: State<usize>,
    armed: State<Option<Action>>,
    generation: State<u64>,
    bus: &ShellBus,
) {
    if press.is_escape() {
        if press.repeat {
            return;
        }
        let armed_now = *armed.peek();
        match decide_escape(armed_now) {
            EscOutcome::Disarm => disarm(armed, generation),
            EscOutcome::Close => bus.send(ShellMsg::CloseAll),
        }
        return;
    }
    match &press.key {
        Key::Named(NamedKey::ArrowRight) | Key::Named(NamedKey::ArrowDown) => {
            // peek's read borrow must end before set's write borrow (State panics
            // on nested borrow, freya writable_utils.rs).
            let cur = *selected.peek();
            selected.set(step_selection(cur, true, ACTIONS.len()));
        }
        Key::Named(NamedKey::ArrowLeft) | Key::Named(NamedKey::ArrowUp) => {
            let cur = *selected.peek();
            selected.set(step_selection(cur, false, ACTIONS.len()));
        }
        Key::Named(NamedKey::Enter) => {
            if press.repeat {
                return;
            }
            let action = ACTIONS[*selected.peek()];
            do_press(action, armed, generation, bus);
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Pure state machine (unit-tested; runs no commands)
// ---------------------------------------------------------------------------

/// The four session actions, in row order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Lock,
    Logout,
    Restart,
    Shutdown,
}

/// Row order, wired to the selection index and the centered row.
const ACTIONS: [Action; 4] = [
    Action::Lock,
    Action::Logout,
    Action::Restart,
    Action::Shutdown,
];

impl Action {
    fn label(self) -> &'static str {
        match self {
            Action::Lock => "Lock",
            Action::Logout => "Log out",
            Action::Restart => "Restart",
            Action::Shutdown => "Shut down",
        }
    }

    fn icon(self) -> &'static [u8] {
        match self {
            Action::Lock => ICON_LOCK,
            Action::Logout => ICON_LOGOUT,
            Action::Restart => ICON_RESTART,
            Action::Shutdown => super::ICON_POWER,
        }
    }

    fn verb(self) -> SessionVerb {
        match self {
            Action::Lock => SessionVerb::Lock,
            Action::Logout => SessionVerb::Logout,
            Action::Restart => SessionVerb::Restart,
            Action::Shutdown => SessionVerb::Shutdown,
        }
    }

    /// Restart/Shut down require a two-step "press again" confirm.
    fn confirms(self) -> bool {
        matches!(self, Action::Restart | Action::Shutdown)
    }

    /// Shut down is destructive: rose resting glyph, rose fill on select/hover.
    fn destructive(self) -> bool {
        matches!(self, Action::Shutdown)
    }
}

/// What a press resolves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PressOutcome {
    /// A confirm-required action, not yet armed: arm it and start the revert timer.
    Arm(Action),
    /// Fire now: send this verb, then close.
    Fire(SessionVerb),
}

/// Decide a press given the currently-armed action. A confirm action fires only
/// when it is itself already armed; pressing a *different* action (even with
/// something else armed) re-arms the new one rather than firing it.
fn decide_press(armed: Option<Action>, action: Action) -> PressOutcome {
    if action.confirms() && armed != Some(action) {
        PressOutcome::Arm(action)
    } else {
        PressOutcome::Fire(action.verb())
    }
}

/// What an Escape resolves to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EscOutcome {
    /// Something is armed: clear it, stay open.
    Disarm,
    /// Nothing armed: close the surface.
    Close,
}

fn decide_escape(armed: Option<Action>) -> EscOutcome {
    if armed.is_some() {
        EscOutcome::Disarm
    } else {
        EscOutcome::Close
    }
}

/// Wrapping selection step: `forward` advances, otherwise retreats.
fn step_selection(sel: usize, forward: bool, len: usize) -> usize {
    if forward {
        (sel + 1) % len
    } else {
        (sel + len - 1) % len
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_metadata() {
        assert!(!Action::Lock.confirms());
        assert!(!Action::Logout.confirms());
        assert!(Action::Restart.confirms());
        assert!(Action::Shutdown.confirms());

        assert!(!Action::Lock.destructive());
        assert!(!Action::Restart.destructive());
        assert!(Action::Shutdown.destructive());

        assert_eq!(Action::Lock.verb(), SessionVerb::Lock);
        assert_eq!(Action::Logout.verb(), SessionVerb::Logout);
        assert_eq!(Action::Restart.verb(), SessionVerb::Restart);
        assert_eq!(Action::Shutdown.verb(), SessionVerb::Shutdown);
    }

    #[test]
    fn non_confirm_actions_fire_immediately() {
        // Lock/Log out fire on first press regardless of what is armed.
        assert_eq!(decide_press(None, Action::Lock), PressOutcome::Fire(SessionVerb::Lock));
        assert_eq!(
            decide_press(None, Action::Logout),
            PressOutcome::Fire(SessionVerb::Logout)
        );
        assert_eq!(
            decide_press(Some(Action::Restart), Action::Lock),
            PressOutcome::Fire(SessionVerb::Lock)
        );
    }

    #[test]
    fn confirm_actions_arm_then_fire() {
        // First press arms; a second press of the *same* action fires.
        assert_eq!(decide_press(None, Action::Restart), PressOutcome::Arm(Action::Restart));
        assert_eq!(
            decide_press(Some(Action::Restart), Action::Restart),
            PressOutcome::Fire(SessionVerb::Restart)
        );
        assert_eq!(decide_press(None, Action::Shutdown), PressOutcome::Arm(Action::Shutdown));
        assert_eq!(
            decide_press(Some(Action::Shutdown), Action::Shutdown),
            PressOutcome::Fire(SessionVerb::Shutdown)
        );
    }

    #[test]
    fn pressing_a_different_confirm_action_rearms_never_fires() {
        // Restart armed, then Shut down pressed once: arm Shut down, do NOT poweroff.
        assert_eq!(
            decide_press(Some(Action::Restart), Action::Shutdown),
            PressOutcome::Arm(Action::Shutdown)
        );
        // ...and symmetrically.
        assert_eq!(
            decide_press(Some(Action::Shutdown), Action::Restart),
            PressOutcome::Arm(Action::Restart)
        );
    }

    #[test]
    fn escape_disarms_then_closes() {
        assert_eq!(decide_escape(None), EscOutcome::Close);
        assert_eq!(decide_escape(Some(Action::Restart)), EscOutcome::Disarm);
        assert_eq!(decide_escape(Some(Action::Shutdown)), EscOutcome::Disarm);
    }

    #[test]
    fn selection_wraps_both_directions() {
        let len = ACTIONS.len();
        assert_eq!(step_selection(0, true, len), 1);
        assert_eq!(step_selection(1, true, len), 2);
        assert_eq!(step_selection(3, true, len), 0); // forward wrap
        assert_eq!(step_selection(0, false, len), 3); // back wrap
        assert_eq!(step_selection(2, false, len), 1);
    }
}
