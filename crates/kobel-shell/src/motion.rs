// Spring engine + MOTION table + use_spring hook. Owned by the motion task.
// Springs are interruptible and velocity-preserving; see docs/FREYA-PLAN.md section 4.
//
// The math core (SpringSpec, SpringSim, the MOTION table) has NO freya dependency:
// it is the closed-form damped harmonic oscillator, mass = 1, matching
// Adw.SpringParams.new_full(damping, 1, stiffness) semantics ported from
// ags/lib/spring.ts. The freya hook (use_spring) drives a SpringSim from a freya
// task the same way freya-animation's own hook drives its animated values.

use std::{
    ops::Deref,
    time::Instant,
};

use freya_core::prelude::*;

// -------------------------------------------------------------------------
// Pure math core (no freya deps)
// -------------------------------------------------------------------------

/// A spring is fully described by stiffness `k` and damping `d` (mass is fixed at
/// 1). This maps 1:1 onto `Adw.SpringParams.new_full(d, 1, k)` from the AGS
/// reference: `d` is the raw damping coefficient, not the damping ratio.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringSpec {
    pub k: f32,
    pub d: f32,
}

/// Settle tolerance in units of unit motion (values are typically normalised to
/// [0, 1]). Matches the `epsilon: 0.0005` used by the AGS Adw springs.
pub const SETTLE_EPS: f32 = 0.0005;

/// Damped harmonic oscillator state. `x` is the current value, `v` its velocity,
/// `target` the rest position the spring is pulling towards.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringSim {
    pub x: f32,
    pub v: f32,
    pub target: f32,
}

impl SpringSim {
    /// A spring at rest at `initial` (x = target, v = 0).
    pub fn new(initial: f32) -> Self {
        Self {
            x: initial,
            v: 0.0,
            target: initial,
        }
    }

    /// Advance the spring by `dt` seconds using the CLOSED-FORM solution of
    ///
    ///     y'' + d*y' + k*y = 0,   where y = x - target
    ///
    /// evaluated from the current `(x, v)`. Because this is the exact analytic
    /// solution (not Euler integration), retargeting mid-flight is exact and the
    /// result is timestep-invariant: composing two dt steps equals one 2*dt step.
    pub fn step(&mut self, dt: f32, spec: SpringSpec) {
        if dt <= 0.0 {
            return;
        }

        let k = spec.k;
        let d = spec.d;
        let y0 = self.x - self.target; // displacement from rest
        let v0 = self.v;

        // Characteristic equation r^2 + d*r + k = 0; discriminant d^2 - 4k picks
        // the regime. alpha is the decay rate (half the damping coefficient).
        let alpha = 0.5 * d;
        let disc = d * d - 4.0 * k;

        // Small tolerance so specs that sit essentially on the critical boundary
        // route through the numerically stable critical branch rather than
        // dividing by a near-zero omega/beta.
        let crit_eps = 1e-4 * k.max(1.0);

        let (y, vy) = if disc < -crit_eps {
            // Underdamped: complex roots -alpha +/- i*w. Oscillates, overshoots.
            let w = (k - alpha * alpha).sqrt(); // damped angular frequency
            let e = (-alpha * dt).exp();
            let (s, c) = (w * dt).sin_cos();
            let a = y0;
            let b = (v0 + alpha * y0) / w;
            let y = e * (a * c + b * s);
            let vy = e * ((-alpha * a + w * b) * c + (-alpha * b - w * a) * s);
            (y, vy)
        } else if disc > crit_eps {
            // Overdamped: two distinct real roots, no oscillation.
            let beta = (alpha * alpha - k).sqrt();
            let r1 = -alpha + beta;
            let r2 = -alpha - beta;
            let e1 = (r1 * dt).exp();
            let e2 = (r2 * dt).exp();
            let c1 = (v0 - r2 * y0) / (r1 - r2);
            let c2 = y0 - c1;
            let y = c1 * e1 + c2 * e2;
            let vy = c1 * r1 * e1 + c2 * r2 * e2;
            (y, vy)
        } else {
            // Critically damped: repeated real root -alpha.
            let e = (-alpha * dt).exp();
            let a = y0;
            let b = v0 + alpha * y0;
            let y = e * (a + b * dt);
            let vy = e * (b - alpha * (a + b * dt));
            (y, vy)
        };

        self.x = self.target + y;
        self.v = vy;
    }

    /// Settled when both the displacement from target and the velocity are below
    /// `eps` (typically [`SETTLE_EPS`]).
    pub fn settled(&self, eps: f32) -> bool {
        (self.x - self.target).abs() < eps && self.v.abs() < eps
    }
}

// -------------------------------------------------------------------------
// MOTION table -- ported verbatim from ags/lib/spring.ts. Do not invent new
// ones casually; every surface picks one of these.
// -------------------------------------------------------------------------

pub const PANEL_OPEN: SpringSpec = SpringSpec { k: 420.0, d: 26.0 }; // slight overshoot
pub const PANEL_OPACITY: SpringSpec = SpringSpec { k: 360.0, d: 32.0 };
pub const PANEL_CLOSE: SpringSpec = SpringSpec { k: 640.0, d: 48.0 }; // fast, no bounce
pub const DRILL: SpringSpec = SpringSpec { k: 400.0, d: 27.0 };
pub const DRILL_BACK: SpringSpec = SpringSpec { k: 440.0, d: 29.0 };
pub const HEIGHT: SpringSpec = SpringSpec { k: 440.0, d: 32.0 };
pub const TOAST_IN: SpringSpec = SpringSpec { k: 360.0, d: 23.0 };
pub const TOAST_OUT: SpringSpec = SpringSpec { k: 440.0, d: 36.0 };
pub const BADGE_POP: SpringSpec = SpringSpec { k: 400.0, d: 17.0 };
pub const BELL_SHAKE: SpringSpec = SpringSpec { k: 330.0, d: 7.0 };
pub const FLING: SpringSpec = SpringSpec { k: 280.0, d: 27.0 };
pub const DOCK_CYCLE: SpringSpec = SpringSpec { k: 430.0, d: 24.0 };
pub const SNAP: SpringSpec = SpringSpec { k: 430.0, d: 28.0 };

// -------------------------------------------------------------------------
// Freya hook: use_spring
// -------------------------------------------------------------------------

/// Handle to a spring living in the current component's scope. `Copy`, like
/// freya's own `UseAnimation`. Read the animated value via [`UseSpring::value`]
/// or the `Deref` to the underlying `State<f32>` (so `spring.read()` /
/// `(*spring)()` also work and subscribe the reader reactively).
#[derive(Clone, Copy, PartialEq)]
pub struct UseSpring {
    /// Published value the UI reads.
    value: State<f32>,
    /// The simulation state. `to`/`kick` mutate target/velocity only; the driver
    /// task integrates it. x and v are NEVER reset on retarget -- that is the
    /// whole point (velocity-preserving interruption).
    sim: State<SpringSim>,
    /// Current spec, so a mid-flight `to(target, spec)` can also change the curve.
    spec: State<SpringSpec>,
    /// The running driver task, or None when the spring is at rest.
    task: State<Option<TaskHandle>>,
}

impl Deref for UseSpring {
    type Target = State<f32>;
    fn deref(&self) -> &Self::Target {
        &self.value
    }
}

impl UseSpring {
    /// Read the current animated value (subscribes the calling component).
    pub fn value(&self) -> f32 {
        *self.value.read()
    }

    /// Retarget the spring. KEEPS the current value and velocity, so interrupting
    /// an in-flight animation continues smoothly from where it is. An optional new
    /// spec changes the curve for the remaining motion.
    pub fn to(&mut self, target: f32, spec: SpringSpec) {
        *self.spec.write() = spec;
        self.sim.write().target = target;
        self.ensure_running();
    }

    /// Add an impulse to the current velocity (badge pop, bell shake). Does not
    /// touch position or target.
    pub fn kick(&mut self, velocity: f32) {
        self.sim.write().v += velocity;
        self.ensure_running();
    }

    /// Settle instantly to `value` (the reduced-motion path). Cancels any driver
    /// task and publishes immediately with zero velocity.
    pub fn jump(&mut self, value: f32) {
        if let Some(task) = self.task.write().take() {
            task.cancel();
        }
        {
            let mut sim = self.sim.write();
            sim.x = value;
            sim.v = 0.0;
            sim.target = value;
        }
        *self.value.write() = value;
    }

    /// Spawn the driver task if the spring is in motion and not already running.
    /// An already-running task picks up the new target/spec/velocity on its next
    /// tick, so we never restart (and never lose x/v) on retarget.
    fn ensure_running(&mut self) {
        if self.task.peek().is_some() {
            return;
        }
        if self.sim.peek().settled(SETTLE_EPS) {
            // Nothing to animate; keep the published value in sync and stay idle.
            let x = self.sim.peek().x;
            *self.value.write() = x;
            return;
        }

        let mut value = self.value;
        let mut sim = self.sim;
        let spec = self.spec;
        let mut task = self.task;

        let mut ticker = RenderingTicker::get();
        let platform = Platform::get();
        let animation_clock = AnimationClock::get();

        let handle = spawn(async move {
            // Kick the first frame, then advance one integration per rendered frame.
            platform.send(UserEvent::RequestRedraw);
            let mut prev = Instant::now();

            loop {
                ticker.tick().await;
                // Schedule the next frame while we are still in motion.
                platform.send(UserEvent::RequestRedraw);

                let elapsed = animation_clock.correct_elapsed_duration(prev.elapsed());
                prev = Instant::now();
                let dt = elapsed.as_secs_f32();

                let cur_spec = *spec.peek();
                let (x, target, done) = {
                    let mut s = sim.write();
                    s.step(dt, cur_spec);
                    (s.x, s.target, s.settled(SETTLE_EPS))
                };

                if done {
                    // Snap exactly onto the target so no residual drift lingers.
                    {
                        let mut s = sim.write();
                        s.x = target;
                        s.v = 0.0;
                    }
                    *value.write() = target;
                    break;
                }

                *value.write() = x;
            }

            tracing::trace!("[motion] spring settled");
            task.write().take();
        });

        self.task.write().replace(handle);
    }
}

/// Create a spring at rest at `initial`. Idle until the first `to`/`kick`, so a
/// quiescent shell spawns no tasks and burns no CPU.
pub fn use_spring(initial: f32) -> UseSpring {
    use_hook(|| UseSpring {
        value: State::create(initial),
        sim: State::create(SpringSim::new(initial)),
        spec: State::create(SNAP),
        task: State::create(None),
    })
}

// -------------------------------------------------------------------------
// Unit tests -- pure math only, no freya runtime.
// -------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // Fixed simulation frame for deterministic tests (~60 fps).
    const FRAME: f32 = 1.0 / 60.0;

    #[test]
    fn converges_to_target() {
        let mut s = SpringSim::new(0.0);
        s.target = 1.0;
        // ~3 seconds is far past every spec's settling time.
        for _ in 0..180 {
            s.step(FRAME, PANEL_OPEN);
        }
        assert!(s.settled(SETTLE_EPS), "expected settled, got {s:?}");
        assert!((s.x - s.target).abs() < SETTLE_EPS);
        assert!(s.v.abs() < SETTLE_EPS);
    }

    #[test]
    fn underdamped_overshoots() {
        // panelOpen (420/26) is underdamped, so the step response must cross the
        // target at least once.
        let mut s = SpringSim::new(0.0);
        s.target = 1.0;
        let mut peak = f32::MIN;
        for _ in 0..240 {
            s.step(FRAME, PANEL_OPEN);
            peak = peak.max(s.x);
        }
        assert!(
            peak > 1.0 + 1e-3,
            "expected overshoot past target, peak was {peak}"
        );
    }

    #[test]
    fn retarget_preserves_velocity_continuity() {
        let mut s = SpringSim::new(0.0);
        s.target = 1.0;
        for _ in 0..6 {
            s.step(FRAME, PANEL_OPEN);
        }
        let x_before = s.x;
        let v_before = s.v;
        assert!(v_before > 0.0, "sanity: spring should be moving upward");

        // Retarget mid-flight (this is exactly what `to` does): only `target`
        // moves. x and v are preserved with no discontinuity in sign OR magnitude.
        s.target = -0.5;
        assert_eq!(s.x, x_before, "retarget must not teleport position");
        assert_eq!(s.v, v_before, "retarget must not reset velocity");

        // The trajectory then continues smoothly. Over a small dt, position
        // advances by ~v*dt and velocity by ~a*dt (a is the damped-oscillator
        // acceleration -k*y - d*v); neither jumps. Compare against those analytic
        // first-order terms, even with a different spec than before the retarget.
        let dt = 1e-4_f32;
        let accel = -DRILL.k * (x_before - s.target) - DRILL.d * v_before;
        s.step(dt, DRILL);
        let dx = s.x - x_before;
        let dv = s.v - v_before;
        assert!(
            (dx - v_before * dt).abs() < 1e-3,
            "position discontinuity on retarget: dx={dx}, expected ~{}",
            v_before * dt
        );
        assert!(
            (dv - accel * dt).abs() < 1e-3,
            "velocity discontinuity on retarget: dv={dv}, expected ~{}",
            accel * dt
        );
        // Motion continues in the velocity's direction for that instant.
        assert_eq!(dx.signum(), v_before.signum());
    }

    #[test]
    fn kick_changes_velocity() {
        // At rest on the target -> settled.
        let mut s = SpringSim::new(0.0);
        assert!(s.settled(SETTLE_EPS));

        // kick(): add to velocity only.
        s.v += 8.0;
        assert!(!s.settled(SETTLE_EPS), "kick should break the settled state");

        let x_before = s.x;
        let v_before = s.v;
        s.step(FRAME, FLING);
        assert!(s.x > x_before, "impulse should carry the value forward");
        assert!(
            s.v < v_before,
            "spring + damping should bleed the kicked velocity"
        );
    }

    #[test]
    fn jump_settles_immediately() {
        // Put a spring mid-flight, then jump() -> instant settle at a new value.
        let mut s = SpringSim::new(0.0);
        s.target = 1.0;
        s.step(0.05, PANEL_OPEN);
        assert!(!s.settled(SETTLE_EPS));

        // jump(): x = target = value, v = 0.
        let value = 0.7;
        s.x = value;
        s.v = 0.0;
        s.target = value;
        assert!(s.settled(SETTLE_EPS), "jump must settle immediately");
        assert_eq!(s.x, value);
    }

    #[test]
    fn closed_form_is_timestep_invariant() {
        // Start from a non-trivial state (moving, off-target) to exercise the full
        // solution, not just the rest response.
        let start = SpringSim {
            x: 0.3,
            v: 2.0,
            target: 1.0,
        };

        let mut one = start;
        one.step(0.032, PANEL_OPEN);

        let mut two = start;
        two.step(0.016, PANEL_OPEN);
        two.step(0.016, PANEL_OPEN);

        assert!(
            (one.x - two.x).abs() < 1e-3,
            "x mismatch: one-step {} vs two-step {}",
            one.x,
            two.x
        );
        assert!(
            (one.v - two.v).abs() < 1e-3,
            "v mismatch: one-step {} vs two-step {}",
            one.v,
            two.v
        );
    }
}
