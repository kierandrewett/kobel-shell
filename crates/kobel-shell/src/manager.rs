// Surface open/close registry (makeReveal successor) + the ShellBus contract.
// The bus is the ONLY channel UI components use to reach the shell: toggling
// surfaces, sending service commands. Contract consumed by ui/* via
// use_consume::<ShellBus>() -- keep these types stable, the manager task owns
// the implementation behind them.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use kobel_services::{Command, ServicesHandle};
use kobel_wayland::{Control, KeyboardInteractivity, SurfaceId};

use crate::motion::{PANEL_CLOSE, PANEL_OPACITY, SETTLE_EPS, SpringSim};

/// The on-demand surfaces of the shell. One typed key shared by UI, manager
/// and IPC so there is exactly one naming convention (kobelctl uses as_str).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SurfaceKey {
    Launcher,
    QuickSettings,
    Calendar,
    Drawer,
    Session,
}

impl SurfaceKey {
    pub const ALL: [SurfaceKey; 5] = [
        SurfaceKey::Launcher,
        SurfaceKey::QuickSettings,
        SurfaceKey::Calendar,
        SurfaceKey::Drawer,
        SurfaceKey::Session,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            SurfaceKey::Launcher => "launcher",
            SurfaceKey::QuickSettings => "quicksettings",
            SurfaceKey::Calendar => "calendar",
            SurfaceKey::Drawer => "drawer",
            SurfaceKey::Session => "session",
        }
    }
}

impl FromStr for SurfaceKey {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        SurfaceKey::ALL
            .into_iter()
            .find(|k| k.as_str() == s)
            .ok_or_else(|| format!("unknown surface: {s}"))
    }
}

/// Messages UI components send to the shell manager.
#[derive(Debug, Clone)]
pub enum ShellMsg {
    /// Toggle a named on-demand surface.
    Toggle(SurfaceKey),
    /// Close every open on-demand surface (dismiss layer / Esc).
    CloseAll,
    /// Forward a command to kobel-services (volume, gnoblin verbs, ...).
    Service(Command),
    /// Quit the shell cleanly.
    Quit,
    /// Additive: set the interactive wl input region on every toasts surface to the
    /// union of the currently-visible toast card rects (surface-local x, y, w, h).
    /// Empty = fully click-through (no live toasts). The union of card rects ONLY --
    /// never the whole surface -- so the gaps between cards stay click-through. Sent
    /// by the Toasts component whenever its visible card layout changes.
    ToastsRegion(Vec<(i32, i32, i32, i32)>),
    /// Activate (raise + focus) a window by its `kobel_wayland::ToplevelInfo` id,
    /// via the real `zwlr_foreign_toplevel_manager_v1` protocol -- NOT routed
    /// through kobel-services/Command, that D-Bus path never existed (see
    /// kobel-services/src/gnoblin.rs's module doc).
    ActivateWindow(String),
    /// Minimize a window by id (same protocol path as `ActivateWindow`).
    MinimizeWindow(String),
    /// Close a window by id -- the real Quit verb (`zwlr_foreign_toplevel_handle_
    /// v1.close`), replacing the old dishonest "Quit minimizes every window"
    /// dock behaviour.
    CloseWindow(String),
    /// The launcher's live text-editing state (query, cursor, anchor byte offsets),
    /// resent to the IME on every change (keystroke or IME commit) so a real input
    /// method (ibus etc.) has fresh context -- surrounding-text reporting is
    /// optional per zwp_text_input_v3, but real CJK compose relies on it (e.g. to
    /// react correctly when the user backspaces mid-composition). Ignored by the
    /// host when the launcher does not currently hold text-input focus.
    ImeSurroundingText { text: String, cursor: i32, anchor: i32 },
}

/// Cloneable handle provided as a root context on every surface.
#[derive(Clone)]
pub struct ShellBus {
    tx: mpsc::Sender<ShellMsg>,
    // Installed once, after the host loop is up, so a send from any thread (a UI
    // event handler, the IPC listener) wakes the loop to drain the receiver on the
    // UI thread. OnceLock, not LazyLock: the waker is runtime input (it wraps the
    // host's loop ping), unknown at construction. Shared across clones via Arc.
    waker: Arc<OnceLock<Box<dyn Fn() + Send + Sync>>>,
}

impl ShellBus {
    pub fn new() -> (Self, mpsc::Receiver<ShellMsg>) {
        let (tx, rx) = mpsc::channel();
        (Self { tx, waker: Arc::new(OnceLock::new()) }, rx)
    }

    pub fn send(&self, msg: ShellMsg) {
        let _ = self.tx.send(msg);
        if let Some(wake) = self.waker.get() {
            wake();
        }
    }

    /// Install the loop-wake callback. Called once by main.rs after the host loop is
    /// up; shared across every clone, so a send on any handle wakes the loop.
    /// Idempotent -- later calls are ignored.
    pub fn install_waker(&self, wake: impl Fn() + Send + Sync + 'static) {
        let _ = self.waker.set(Box::new(wake));
    }
}

/// Sink for service commands. Abstracted so the manager loop is unit-testable
/// without spawning real services.
pub trait CommandSink {
    fn send(&self, cmd: Command);
}

impl CommandSink for ServicesHandle {
    fn send(&self, cmd: Command) {
        ServicesHandle::send(self, cmd);
    }
}

/// Host-side reveal side effects the manager drives per surface: keyboard focus
/// mode and wl input region. Abstracted like [`CommandSink`] so the reveal state
/// machine is unit-testable without a live compositor; the production impl is for
/// the host's [`Control`] handle, available in the on-tick callback.
pub trait RevealHost {
    fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity);
    fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool);
    /// Set the surface's input region to the union of the given surface-local
    /// rectangles (empty slice = fully click-through). Used to make only the visible
    /// toast cards interactive while the gaps between them stay click-through.
    fn set_input_region_rects(&mut self, id: SurfaceId, rects: &[(i32, i32, i32, i32)]);
    /// Activate (raise + focus) a window by its `ToplevelInfo` id.
    fn activate_window(&mut self, id: &str);
    /// Minimize a window by id.
    fn minimize_window(&mut self, id: &str);
    /// Close a window by id (the real Quit verb).
    fn close_window(&mut self, id: &str);
    /// Report the launcher's live surrounding text to the IME and commit it
    /// immediately. No-op if text input is not currently enabled on any surface
    /// (the host's `Control::ime_set_surrounding_text` is itself a no-op when
    /// `text_input` is `None`; this just always calls through).
    fn ime_sync_surrounding_text(&mut self, text: &str, cursor: i32, anchor: i32);
}

impl RevealHost for Control<'_> {
    fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        Control::set_keyboard_interactivity(self, id, mode);
    }

    fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        Control::set_input_region_empty(self, id, empty);
    }

    fn set_input_region_rects(&mut self, id: SurfaceId, rects: &[(i32, i32, i32, i32)]) {
        Control::set_input_region_rects(self, id, rects);
    }

    fn activate_window(&mut self, id: &str) {
        Control::activate_toplevel(self, id);
    }

    fn minimize_window(&mut self, id: &str) {
        Control::minimize_toplevel(self, id);
    }

    fn close_window(&mut self, id: &str) {
        Control::close_toplevel(self, id);
    }

    fn ime_sync_surrounding_text(&mut self, text: &str, cursor: i32, anchor: i32) {
        Control::ime_set_surrounding_text(self, text, cursor, anchor);
        Control::ime_commit(self);
    }
}

/// ~one 60Hz frame. On a cold start the manager rewinds its clock by this much so
/// the first integrated spring step advances by one frame instead of the whole idle
/// gap: the closed-form solver would otherwise collapse a large dt straight onto the
/// target (an instant, un-animated jump), and writing the unchanged 0/1 progress
/// would never dirty a surface -- so no frame callback would arrive to drive the
/// next step and the spring would stall at rest.
const FRAME_DT: Duration = Duration::from_micros(16_667);

// Profiling trace (KOBEL_PROFILE_ANIM). Ports ags/lib/surface.ts beginTrace/
// recordTrace: the manager integrates the reveal springs, so it sees every sample.
// The accumulator is pure (no freya, no clock) -- fed absolute monotonic timestamps
// in ms, tracking the sample count and the max inter-sample gap, so the math is
// unit-testable and a real stall shows up as a large max_gap_ms.

/// Direction of a reveal transition, for the profiling trace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TraceDir {
    Open,
    Close,
}

impl TraceDir {
    fn as_str(self) -> &'static str {
        match self {
            TraceDir::Open => "open",
            TraceDir::Close => "close",
        }
    }
}

/// Pure per-transition profiling accumulator.
#[derive(Debug, Clone, PartialEq)]
struct RevealTrace {
    /// Per-surface transition sequence number (1-based).
    seq: u64,
    direction: TraceDir,
    /// Whether this open reused an already-warm surface (open_count > 1). Always
    /// false for a close, matching the AGS reference.
    warm: bool,
    /// Transition start (open_start / close_start) timestamp, in ms.
    start_ms: f64,
    /// Last recorded sample timestamp, in ms.
    last_ms: f64,
    /// Samples recorded so far.
    samples: u32,
    /// Largest gap between consecutive samples (and start -> first sample), in ms.
    max_gap_ms: f64,
    /// Whether the first_tick event has been reported yet.
    first_tick_done: bool,
}

impl RevealTrace {
    /// Begin a transition at `now_ms`; no sample yet.
    fn begin(seq: u64, direction: TraceDir, warm: bool, now_ms: f64) -> Self {
        Self {
            seq,
            direction,
            warm,
            start_ms: now_ms,
            last_ms: now_ms,
            samples: 0,
            max_gap_ms: 0.0,
            first_tick_done: false,
        }
    }

    /// Record one animated sample at `now_ms`: bump the count and the max gap
    /// (measured from the previous sample, or from the start for the first). Returns
    /// true exactly once, on the first sample, so the caller emits first_tick.
    fn record(&mut self, now_ms: f64) -> bool {
        let gap = (now_ms - self.last_ms).max(0.0);
        if gap > self.max_gap_ms {
            self.max_gap_ms = gap;
        }
        self.last_ms = now_ms;
        self.samples += 1;
        let first = !self.first_tick_done;
        self.first_tick_done = true;
        first
    }

    /// Elapsed ms since the transition began, clamped to >= 1 so the sample-rate
    /// division is always well-defined (matches the AGS reference).
    fn elapsed_ms(&self, now_ms: f64) -> f64 {
        (now_ms - self.start_ms).max(1.0)
    }

    /// Mean sample rate over the elapsed window (Hz, rounded).
    fn sample_hz(&self, now_ms: f64) -> u32 {
        ((self.samples as f64 * 1000.0) / self.elapsed_ms(now_ms)).round() as u32
    }
}

/// One on-demand surface's reveal state. The surface is created once and stays
/// mapped forever (the AGS warm-open trick): closed = opacity 0 + empty input region
/// + keyboard None; open = opacity springs to 1 + full input region + its keyboard
/// mode. The spring integrates manager-side (see [`Manager::tick`]).
struct Reveal {
    id: SurfaceId,
    /// Keyboard mode applied while open (Exclusive for launcher/session, OnDemand
    /// for the rest).
    kb_open: KeyboardInteractivity,
    /// Opacity spring (0 = hidden, 1 = revealed). Retargeting keeps x and v, so
    /// interrupting a fade (reopen mid-close) continues from the current value.
    sim: SpringSim,
    /// Desired end state: true = open (spring -> 1), false = closed (spring -> 0).
    target_open: bool,
    /// True while the spring is still moving and must be integrated each frame.
    active: bool,
    /// Writes the animated value into this surface's `OpenProgress` State<f32> root
    /// context, which the surface UI multiplies into its root opacity.
    write_progress: Box<dyn FnMut(f32)>,
    /// Profiling transition counter, bumped per transition when profiling is on.
    trace_seq: u64,
    /// Opens so far, so the profiler can flag a warm reopen (count > 1).
    open_count: u32,
    /// In-flight profiling accumulator; Some only while profiling and a transition
    /// is running.
    trace: Option<RevealTrace>,
}

/// The shell manager loop, living on the UI thread -- the makeReveal successor. The
/// host tick calls [`Manager::tick`] each sweep to drain pending [`ShellMsg`]s and
/// advance the reveal springs: a one-open-at-a-time registry of warm-mapped surfaces
/// whose opacity springs open/closed while keyboard focus and input regions flip on
/// the fly (docs/FREYA-PLAN.md 2.4).
pub struct Manager {
    rx: mpsc::Receiver<ShellMsg>,
    services: Box<dyn CommandSink>,
    /// The warm-mapped on-demand surfaces, keyed by [`SurfaceKey`].
    reveals: HashMap<SurfaceKey, Reveal>,
    /// The currently open surface, if any (the one-open-at-a-time invariant).
    open: Option<SurfaceKey>,
    /// The full-screen dismiss layer: click-through until a surface opens, then it
    /// catches the next click and closes everything.
    dismiss: Option<SurfaceId>,
    /// The per-output toasts overlay surfaces. Each [`ShellMsg::ToastsRegion`] is
    /// applied to all of them so every output's overlay tracks its visible cards.
    toasts: Vec<SurfaceId>,
    /// Wall clock for the reveal springs' integration timestep.
    last_tick: Instant,
    /// Reduced-motion accessibility flag: reveal springs snap 0/1 instantly.
    reduced_motion: bool,
    /// Profiling flag (KOBEL_PROFILE_ANIM): emit the reveal-spring trace and the
    /// machine-readable KOBEL_MOTION settle summary.
    profile: bool,
    /// Monotonic epoch for the trace's absolute-ms timestamps. Independent of the
    /// clamped spring dt, so a real stall surfaces as a large max_gap_ms.
    trace_epoch: Instant,
    /// Additive: closes every open popup (tray/context menus). Popups are host-owned
    /// (main.rs drives `Control::open_popup`/`close_popup`), so the manager cannot
    /// touch them directly; this hook lets a `CloseAll` dismiss any open popup
    /// alongside the panels. `None` in tests and until main.rs installs it.
    close_popups: Option<Box<dyn Fn()>>,
    quit: bool,
}

impl Manager {
    pub fn new(rx: mpsc::Receiver<ShellMsg>, services: impl CommandSink + 'static) -> Self {
        Self {
            rx,
            services: Box::new(services),
            reveals: HashMap::new(),
            open: None,
            dismiss: None,
            toasts: Vec::new(),
            last_tick: Instant::now(),
            reduced_motion: false,
            profile: false,
            trace_epoch: Instant::now(),
            close_popups: None,
            quit: false,
        }
    }

    /// Install the host-side hook that dismisses every open popup. Called once by
    /// main.rs; a `CloseAll` then closes any tray/context menu alongside the panels.
    pub fn set_close_popups(&mut self, close_popups: Box<dyn Fn()>) {
        self.close_popups = Some(close_popups);
    }

    /// Register one warm-mapped on-demand surface, called once per surface at
    /// startup (main.rs) after it is created: its id, the keyboard mode to use while
    /// open, and a writer into its `OpenProgress` context.
    pub fn register_reveal(
        &mut self,
        key: SurfaceKey,
        id: SurfaceId,
        kb_open: KeyboardInteractivity,
        write_progress: Box<dyn FnMut(f32)>,
    ) {
        self.reveals.insert(
            key,
            Reveal {
                id,
                kb_open,
                sim: SpringSim::new(0.0),
                target_open: false,
                active: false,
                write_progress,
                trace_seq: 0,
                open_count: 0,
                trace: None,
            },
        );
    }

    /// Register the full-screen dismiss layer surface.
    pub fn set_dismiss(&mut self, id: SurfaceId) {
        self.dismiss = Some(id);
    }

    /// Register the per-output toasts overlay surfaces (one per output). Each
    /// [`ShellMsg::ToastsRegion`] is applied to all of them, so every output's
    /// overlay tracks its own visible toast cards.
    pub fn register_toasts(&mut self, ids: Vec<SurfaceId>) {
        self.toasts = ids;
    }

    /// Apply the toast input region (surface-local card rects) to every registered
    /// toasts surface. An empty slice makes them fully click-through (no live
    /// toasts), so the gaps between cards always pass clicks through.
    fn apply_toasts_region(&self, rects: &[(i32, i32, i32, i32)], host: &mut impl RevealHost) {
        for &id in &self.toasts {
            host.set_input_region_rects(id, rects);
        }
    }

    /// Enable the reduced-motion reveal path: opacity springs snap to 0/1 instead of
    /// fading. Set once at startup from KOBEL_REDUCED_MOTION (DESIGN.md accessibility).
    pub fn set_reduced_motion(&mut self, on: bool) {
        self.reduced_motion = on;
    }

    /// Enable reveal-spring profiling (KOBEL_PROFILE_ANIM): per-transition trace
    /// lines plus the machine-readable KOBEL_MOTION settle summary.
    pub fn set_profile_anim(&mut self, on: bool) {
        self.profile = on;
    }

    /// Absolute monotonic time in ms since the manager was built. Feeds the profiling
    /// accumulator directly (not the clamped spring dt) so a real stall stays visible.
    fn now_ms(&self) -> f64 {
        self.trace_epoch.elapsed().as_secs_f64() * 1000.0
    }

    /// Human-readable per-event profiling line (open_start / close_start, first_tick,
    /// settled), tagged `[trace]`. The machine-readable summary is [`emit_motion`].
    fn log_trace_event(key: SurfaceKey, t: &RevealTrace, event: &str, now_ms: f64) {
        tracing::info!(
            "[trace] surface={} seq={} event={} direction={} warm={} elapsed_ms={:.0} samples={} sample_hz={} max_gap_ms={:.0}",
            key.as_str(),
            t.seq,
            event,
            t.direction.as_str(),
            t.warm as u8,
            t.elapsed_ms(now_ms),
            t.samples,
            t.sample_hz(now_ms),
            t.max_gap_ms,
        );
    }

    /// The machine-readable settle summary, emitted as a raw stdout line beginning
    /// exactly with `KOBEL_MOTION ` so ags/scripts/profile-surfaces.sh's
    /// `startswith("KOBEL_MOTION ")` parser (and a plain grep of kobel.log) both pick
    /// it up. Ports the KOBEL_MOTION line from ags/lib/surface.ts recordTrace.
    fn emit_motion(key: SurfaceKey, t: &RevealTrace, now_ms: f64) {
        let target = match t.direction {
            TraceDir::Open => 1,
            TraceDir::Close => 0,
        };
        println!(
            "KOBEL_MOTION surface={} seq={} direction={} warm={} target={} elapsed_ms={} samples={} sample_hz={} max_gap_ms={}",
            key.as_str(),
            t.seq,
            t.direction.as_str(),
            t.warm as u8,
            target,
            t.elapsed_ms(now_ms).round() as u64,
            t.samples,
            t.sample_hz(now_ms),
            t.max_gap_ms.round() as u64,
        );
    }

    /// Drain and apply every pending message, then advance any active reveal spring.
    /// Runs on the UI thread at the start of each host sweep, before the surfaces are
    /// pumped, so the `OpenProgress` writes it makes are picked up in the same frame.
    /// Returns true once a Quit has been seen (the caller should exit the loop).
    pub fn tick(&mut self, host: &mut impl RevealHost) -> bool {
        let was_active = self.any_active();
        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                ShellMsg::Toggle(key) => self.toggle(key, host),
                ShellMsg::CloseAll => self.close_all(host),
                ShellMsg::Service(cmd) => self.services.send(cmd),
                ShellMsg::Quit => {
                    tracing::info!("[manager] quit");
                    self.quit = true;
                }
                ShellMsg::ToastsRegion(rects) => self.apply_toasts_region(&rects, host),
                ShellMsg::ActivateWindow(id) => host.activate_window(&id),
                ShellMsg::MinimizeWindow(id) => host.minimize_window(&id),
                ShellMsg::CloseWindow(id) => host.close_window(&id),
                ShellMsg::ImeSurroundingText { text, cursor, anchor } => {
                    host.ime_sync_surrounding_text(&text, cursor, anchor)
                }
            }
        }
        if self.any_active() {
            let now = Instant::now();
            if !was_active {
                // Cold start: measure the first step as one frame, not the idle gap.
                self.last_tick = now - FRAME_DT;
            }
            let dt = (now - self.last_tick).as_secs_f32().min(0.05);
            self.last_tick = now;
            self.advance(dt, host);
        }
        self.quit
    }

    fn any_active(&self) -> bool {
        self.reveals.values().any(|r| r.active)
    }

    fn toggle(&mut self, key: SurfaceKey, host: &mut impl RevealHost) {
        if self.open == Some(key) {
            self.close(key, host);
        } else {
            self.open_key(key, host);
        }
    }

    fn open_key(&mut self, key: SurfaceKey, host: &mut impl RevealHost) {
        if !self.reveals.contains_key(&key) {
            tracing::warn!("[manager] toggle {}: surface not registered", key.as_str());
            return;
        }
        // One-open-at-a-time: close whatever else is open first.
        if let Some(cur) = self.open {
            if cur != key {
                self.close(cur, host);
            }
        }
        let reduced = self.reduced_motion;
        let profile = self.profile;
        let now = if profile { self.now_ms() } else { 0.0 };
        let (id, kb, opened_trace) = {
            let r = self.reveals.get_mut(&key).expect("registered above");
            r.target_open = true;
            r.active = true;
            r.sim.target = 1.0; // retarget; x and v preserved -> interruptible
            if reduced {
                r.sim.snap(1.0); // accessibility: reveal instantly, no fade
            }
            let opened_trace = if profile {
                r.trace_seq += 1;
                r.open_count += 1;
                let warm = r.open_count > 1;
                let t = RevealTrace::begin(r.trace_seq, TraceDir::Open, warm, now);
                r.trace = Some(t.clone());
                Some(t)
            } else {
                None
            };
            (r.id, r.kb_open, opened_trace)
        };
        self.open = Some(key);
        // Reveal: full input region + this surface's keyboard mode.
        host.set_input_region_empty(id, false);
        host.set_keyboard_interactivity(id, kb);
        self.sync_dismiss(host);
        tracing::info!("[manager] opened {}", key.as_str());
        if let Some(t) = opened_trace {
            Self::log_trace_event(key, &t, "open_start", now);
        }
    }

    fn close(&mut self, key: SurfaceKey, host: &mut impl RevealHost) {
        let reduced = self.reduced_motion;
        let profile = self.profile;
        let now = if profile { self.now_ms() } else { 0.0 };
        let mut started_trace = None;
        let mut close_id = None;
        let did_close = match self.reveals.get_mut(&key) {
            Some(r) if r.target_open || r.active => {
                r.target_open = false;
                r.active = true;
                r.sim.target = 0.0; // retarget; x and v preserved -> interruptible
                if reduced {
                    r.sim.snap(0.0); // accessibility: hide instantly, no fade
                }
                if profile {
                    r.trace_seq += 1;
                    let t = RevealTrace::begin(r.trace_seq, TraceDir::Close, false, now);
                    started_trace = Some(t.clone());
                    r.trace = Some(t);
                }
                close_id = Some(r.id);
                true
            }
            _ => false,
        };
        if self.open == Some(key) {
            self.open = None;
        }
        // Drop keyboard-interactivity to None IMMEDIATELY, before the fade plays: an
        // Exclusive surface (launcher/session) that held keyboard focus through the
        // whole close fade would swallow every key while invisible, and a rapid
        // switch would misroute the first presses to the outgoing surface. The input
        // region restore stays gated on settle (in advance), so the surface still
        // fades out visibly while already deaf to the keyboard.
        if let Some(id) = close_id {
            host.set_keyboard_interactivity(id, KeyboardInteractivity::None);
        }
        self.sync_dismiss(host);
        if did_close {
            tracing::info!("[manager] closed {}", key.as_str());
        }
        if let Some(t) = started_trace {
            Self::log_trace_event(key, &t, "close_start", now);
        }
        // The empty input region is restored on settle (in advance), not here, so it
        // holds through the whole close fade (keyboard None was already dropped above).
    }

    fn close_all(&mut self, host: &mut impl RevealHost) {
        // Dismiss any open popup (tray/context menu) alongside the panels.
        if let Some(close_popups) = &self.close_popups {
            close_popups();
        }
        match self.open {
            Some(cur) => self.close(cur, host),
            None => tracing::debug!("[manager] close-all: nothing open"),
        }
    }

    /// The dismiss layer catches clicks only while a surface is open.
    fn sync_dismiss(&mut self, host: &mut impl RevealHost) {
        if let Some(id) = self.dismiss {
            host.set_input_region_empty(id, self.open.is_none());
        }
    }

    /// Integrate every active reveal spring by `dt` seconds and publish the new
    /// opacity. When a closing spring settles, restore the surface's click-through
    /// (empty input region) and keyboard None -- gated on `!target_open`, so a
    /// reopen mid-close (which flips target_open back to true) never tears down a
    /// surface that is now reopening.
    fn advance(&mut self, dt: f32, host: &mut impl RevealHost) {
        if dt <= 0.0 {
            return;
        }
        let profile = self.profile;
        let now = if profile { self.now_ms() } else { 0.0 };
        for (key, r) in self.reveals.iter_mut() {
            if !r.active {
                continue;
            }
            let spec = if r.target_open { PANEL_OPACITY } else { PANEL_CLOSE };
            r.sim.step(dt, spec);
            let settled = r.sim.settled(SETTLE_EPS);
            if settled {
                r.sim.x = r.sim.target;
                r.sim.v = 0.0;
                r.active = false;
            }
            // Clamp for publication: PANEL_OPACITY is underdamped and can overshoot
            // past 1 (the spring's own x keeps its true physics for correct settling).
            let x = r.sim.x.clamp(0.0, 1.0);
            (r.write_progress)(x);
            if profile {
                if let Some(t) = r.trace.as_mut() {
                    if t.record(now) {
                        Self::log_trace_event(*key, t, "first_tick", now);
                    }
                }
                if settled {
                    if let Some(t) = r.trace.take() {
                        Self::log_trace_event(*key, &t, "settled", now);
                        Self::emit_motion(*key, &t, now);
                    }
                }
            }
            if settled && !r.target_open {
                // Keyboard was already dropped to None in close(); only the
                // click-through input region is restored here, gated on settle so the
                // fade stays visible and the surface never eats keys mid-fade.
                host.set_input_region_empty(r.id, true);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[derive(Default)]
    struct RecordingSink(Rc<RefCell<Vec<Command>>>);
    impl CommandSink for RecordingSink {
        fn send(&self, cmd: Command) {
            self.0.borrow_mut().push(cmd);
        }
    }

    #[derive(Default)]
    struct FakeHost {
        kb: Vec<(SurfaceId, KeyboardInteractivity)>,
        region: Vec<(SurfaceId, bool)>,
        rects: Vec<(SurfaceId, Vec<(i32, i32, i32, i32)>)>,
        window_calls: Vec<(&'static str, String)>,
        ime_calls: Vec<(String, i32, i32)>,
    }
    impl RevealHost for FakeHost {
        fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
            self.kb.push((id, mode));
        }
        fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
            self.region.push((id, empty));
        }
        fn set_input_region_rects(&mut self, id: SurfaceId, rects: &[(i32, i32, i32, i32)]) {
            self.rects.push((id, rects.to_vec()));
        }
        fn activate_window(&mut self, id: &str) {
            self.window_calls.push(("activate", id.to_string()));
        }
        fn minimize_window(&mut self, id: &str) {
            self.window_calls.push(("minimize", id.to_string()));
        }
        fn close_window(&mut self, id: &str) {
            self.window_calls.push(("close", id.to_string()));
        }
        fn ime_sync_surrounding_text(&mut self, text: &str, cursor: i32, anchor: i32) {
            self.ime_calls.push((text.to_string(), cursor, anchor));
        }
    }

    fn recording(recorded: &Rc<RefCell<Vec<f32>>>) -> Box<dyn FnMut(f32)> {
        let recorded = recorded.clone();
        Box::new(move |v| recorded.borrow_mut().push(v))
    }

    #[test]
    fn surface_key_round_trips() {
        for key in SurfaceKey::ALL {
            assert_eq!(SurfaceKey::from_str(key.as_str()), Ok(key));
        }
        assert!(SurfaceKey::from_str("nope").is_err());
    }

    #[test]
    fn tick_forwards_service_commands_and_ignores_unregistered_toggle() {
        let (bus, rx) = ShellBus::new();
        let recorded = Rc::new(RefCell::new(Vec::new()));
        let mut manager = Manager::new(rx, RecordingSink(recorded.clone()));
        let mut host = FakeHost::default();

        // No reveal registered for Launcher -> the toggle is ignored, not a panic.
        bus.send(ShellMsg::Toggle(SurfaceKey::Launcher));
        bus.send(ShellMsg::Service(Command::SetMuted(true)));
        bus.send(ShellMsg::CloseAll);

        assert!(!manager.tick(&mut host), "no quit seen yet");
        assert_eq!(recorded.borrow().len(), 1);
        assert!(matches!(recorded.borrow().first(), Some(Command::SetMuted(true))));
        assert!(host.kb.is_empty() && host.region.is_empty());
    }

    #[test]
    fn tick_latches_quit() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let mut host = FakeHost::default();
        bus.send(ShellMsg::Quit);
        assert!(manager.tick(&mut host));
        // Quit stays latched across further empty ticks.
        assert!(manager.tick(&mut host));
    }

    #[test]
    fn open_reveals_and_enforces_one_open() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let launcher = SurfaceId::new(1);
        let qs = SurfaceId::new(2);
        let dismiss = SurfaceId::new(9);
        let lp = Rc::new(RefCell::new(Vec::new()));
        let qp = Rc::new(RefCell::new(Vec::new()));
        manager.register_reveal(SurfaceKey::Launcher, launcher, KeyboardInteractivity::Exclusive, recording(&lp));
        manager.register_reveal(SurfaceKey::QuickSettings, qs, KeyboardInteractivity::OnDemand, recording(&qp));
        manager.set_dismiss(dismiss);
        let mut host = FakeHost::default();

        bus.send(ShellMsg::Toggle(SurfaceKey::Launcher));
        manager.tick(&mut host);
        assert!(host.region.contains(&(launcher, false)), "launcher gets a full input region");
        assert!(host.kb.contains(&(launcher, KeyboardInteractivity::Exclusive)));
        assert!(host.region.contains(&(dismiss, false)), "dismiss catches clicks while open");
        assert!(lp.borrow().last().is_some_and(|&v| v > 0.0), "launcher opacity springs off zero");

        // Opening QS closes the launcher (one-open rule) and settles it click-through.
        host.kb.clear();
        host.region.clear();
        bus.send(ShellMsg::Toggle(SurfaceKey::QuickSettings));
        manager.tick(&mut host);
        assert!(host.region.contains(&(qs, false)));
        assert!(host.kb.contains(&(qs, KeyboardInteractivity::OnDemand)));
        manager.advance(1.0, &mut host);
        assert!(host.region.contains(&(launcher, true)), "displaced launcher becomes click-through on settle");
        assert!(host.kb.contains(&(launcher, KeyboardInteractivity::None)));
    }

    #[test]
    fn close_settles_to_click_through_and_kb_none() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let id = SurfaceId::new(7);
        manager.register_reveal(SurfaceKey::Drawer, id, KeyboardInteractivity::OnDemand, Box::new(|_| {}));
        manager.set_dismiss(SurfaceId::new(0));
        let mut host = FakeHost::default();

        bus.send(ShellMsg::Toggle(SurfaceKey::Drawer));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        host.kb.clear();
        host.region.clear();

        bus.send(ShellMsg::CloseAll);
        manager.tick(&mut host);
        assert!(host.region.contains(&(SurfaceId::new(0), true)), "dismiss goes click-through once nothing is open");
        manager.advance(1.0, &mut host); // settle close
        assert!(host.region.contains(&(id, true)));
        assert!(host.kb.contains(&(id, KeyboardInteractivity::None)));
    }

    #[test]
    fn reopen_mid_close_keeps_surface_open() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let id = SurfaceId::new(5);
        manager.register_reveal(SurfaceKey::Calendar, id, KeyboardInteractivity::OnDemand, Box::new(|_| {}));
        manager.set_dismiss(SurfaceId::new(0));
        let mut host = FakeHost::default();

        bus.send(ShellMsg::Toggle(SurfaceKey::Calendar));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        bus.send(ShellMsg::Toggle(SurfaceKey::Calendar));
        manager.tick(&mut host);
        manager.advance(0.01, &mut host); // begin close, still fading
        host.kb.clear();
        host.region.clear();
        bus.send(ShellMsg::Toggle(SurfaceKey::Calendar));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle -> should settle OPEN, not tear down
        assert!(
            !host.kb.iter().any(|&(i, m)| i == id && m == KeyboardInteractivity::None),
            "reopened surface must not be torn down to kb None"
        );
        assert!(host.region.contains(&(id, false)), "reopened surface keeps a full input region");
    }

    #[test]
    fn install_waker_fires_on_every_send() {
        let (bus, _rx) = ShellBus::new();
        let hits = Arc::new(AtomicUsize::new(0));
        let hits2 = hits.clone();
        bus.install_waker(move || {
            hits2.fetch_add(1, Ordering::SeqCst);
        });
        bus.send(ShellMsg::CloseAll);
        bus.send(ShellMsg::CloseAll);
        assert_eq!(hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn reduced_motion_reveal_snaps_instantly() {
        // With reduced motion the reveal spring snaps: one tick opens fully (progress
        // 1.0, nothing left animating) and one tick closes fully (0.0 + click-through
        // + kb None), instead of fading over many frames.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        manager.set_reduced_motion(true);
        let id = SurfaceId::new(3);
        let p = Rc::new(RefCell::new(Vec::new()));
        manager.register_reveal(SurfaceKey::QuickSettings, id, KeyboardInteractivity::OnDemand, recording(&p));
        manager.set_dismiss(SurfaceId::new(0));
        let mut host = FakeHost::default();

        bus.send(ShellMsg::Toggle(SurfaceKey::QuickSettings));
        manager.tick(&mut host);
        assert_eq!(p.borrow().last().copied(), Some(1.0), "reduced motion opens fully in one tick");
        assert!(!manager.any_active(), "no spring left running after a snapped open");
        assert!(host.region.contains(&(id, false)));
        assert!(host.kb.contains(&(id, KeyboardInteractivity::OnDemand)));

        host.kb.clear();
        host.region.clear();
        bus.send(ShellMsg::Toggle(SurfaceKey::QuickSettings));
        manager.tick(&mut host);
        assert_eq!(p.borrow().last().copied(), Some(0.0), "reduced motion closes fully in one tick");
        assert!(!manager.any_active());
        assert!(host.region.contains(&(id, true)), "closed surface becomes click-through immediately");
        assert!(host.kb.contains(&(id, KeyboardInteractivity::None)));
    }

    #[test]
    fn reveal_trace_accumulates_samples_and_gaps() {
        // begin at t=0, then samples at 16/32/80/96 ms: a 48 ms stall between the 2nd
        // and 3rd sample. The accumulator must count 4 samples, pick the 48 ms gap as
        // the max, and derive the mean sample rate over the 96 ms window.
        let mut t = RevealTrace::begin(1, TraceDir::Open, false, 0.0);
        assert_eq!(t.samples, 0);

        assert!(t.record(16.0), "first sample reports first_tick");
        assert!(!t.record(32.0));
        assert!(!t.record(80.0)); // the stall
        assert!(!t.record(96.0));

        assert_eq!(t.samples, 4);
        assert_eq!(t.max_gap_ms, 48.0, "max gap is the 48 ms stall, not a spring frame");
        assert_eq!(t.elapsed_ms(96.0), 96.0);
        assert_eq!(t.sample_hz(96.0), 42, "round(4 * 1000 / 96) = 42 Hz");
    }

    #[test]
    fn reveal_trace_elapsed_clamps_to_one() {
        // A zero-duration transition must never divide by zero.
        let t = RevealTrace::begin(1, TraceDir::Close, false, 5.0);
        assert_eq!(t.elapsed_ms(5.0), 1.0);
        assert_eq!(t.sample_hz(5.0), 0);
    }

    #[test]
    fn close_drops_keyboard_immediately_before_settle() {
        // Review HIGH: an Exclusive surface must lose keyboard-interactivity the
        // instant it starts closing -- before the fade settles -- so it cannot
        // swallow keys while still visible but on its way out. The input region,
        // by contrast, is only restored on settle so the fade stays visible.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let launcher = SurfaceId::new(1);
        manager.register_reveal(
            SurfaceKey::Launcher,
            launcher,
            KeyboardInteractivity::Exclusive,
            Box::new(|_| {}),
        );
        manager.set_dismiss(SurfaceId::new(0));
        let mut host = FakeHost::default();

        bus.send(ShellMsg::Toggle(SurfaceKey::Launcher));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        host.kb.clear();
        host.region.clear();

        // Begin closing. The kb drop must land during this tick, not on settle.
        bus.send(ShellMsg::Toggle(SurfaceKey::Launcher));
        manager.tick(&mut host);
        assert!(
            host.kb.contains(&(launcher, KeyboardInteractivity::None)),
            "keyboard drops to None immediately in close(), not deferred to settle"
        );
        assert!(
            !host.region.contains(&(launcher, true)),
            "input region is NOT restored yet -- it holds through the fade"
        );
        // The interruptible spring is still running (fade has not settled).
        manager.advance(0.001, &mut host);
        assert!(manager.any_active(), "close fade still running after a tiny step");
    }

    #[test]
    fn displaced_surface_drops_keyboard_before_new_surface_grabs_it() {
        // Rapid switch: opening QuickSettings while the launcher is open must drop
        // the launcher's keyboard to None BEFORE QuickSettings takes its own mode,
        // so the first presses never misroute to the outgoing Exclusive surface.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let launcher = SurfaceId::new(1);
        let qs = SurfaceId::new(2);
        manager.register_reveal(
            SurfaceKey::Launcher,
            launcher,
            KeyboardInteractivity::Exclusive,
            Box::new(|_| {}),
        );
        manager.register_reveal(
            SurfaceKey::QuickSettings,
            qs,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        manager.set_dismiss(SurfaceId::new(0));
        let mut host = FakeHost::default();

        bus.send(ShellMsg::Toggle(SurfaceKey::Launcher));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        host.kb.clear();

        bus.send(ShellMsg::Toggle(SurfaceKey::QuickSettings));
        manager.tick(&mut host);

        let launcher_none = host
            .kb
            .iter()
            .position(|&(i, m)| i == launcher && m == KeyboardInteractivity::None);
        let qs_mode = host
            .kb
            .iter()
            .position(|&(i, m)| i == qs && m == KeyboardInteractivity::OnDemand);
        assert!(launcher_none.is_some(), "displaced launcher drops to kb None");
        assert!(qs_mode.is_some(), "QuickSettings takes its OnDemand keyboard mode");
        assert!(
            launcher_none < qs_mode,
            "launcher kb None must be applied BEFORE QuickSettings grabs the keyboard"
        );
    }

    #[test]
    fn toasts_region_applies_to_every_toast_surface() {
        // A ToastsRegion message updates the wl input region of every registered
        // toasts surface (one per output). An empty region == fully click-through.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let t0 = SurfaceId::new(10);
        let t1 = SurfaceId::new(11);
        manager.register_toasts(vec![t0, t1]);
        let mut host = FakeHost::default();

        let cards = vec![(5, 6, 100, 40), (5, 60, 100, 40)];
        bus.send(ShellMsg::ToastsRegion(cards.clone()));
        manager.tick(&mut host);
        assert!(host.rects.contains(&(t0, cards.clone())), "output 0 gets the card rects");
        assert!(host.rects.contains(&(t1, cards.clone())), "output 1 gets the card rects");

        host.rects.clear();
        bus.send(ShellMsg::ToastsRegion(Vec::new()));
        manager.tick(&mut host);
        assert!(host.rects.contains(&(t0, Vec::new())), "no toasts -> empty (click-through) region");
        assert!(host.rects.contains(&(t1, Vec::new())));
    }
}
