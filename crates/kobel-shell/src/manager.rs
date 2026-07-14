//! Optional one-at-a-time reveal coordination and the [`ShellBus`] contract.
//!
//! Concrete UI crates choose their own surface names, geometry and Freya elements.
//! This module only coordinates registered surface identifiers and host side effects.

use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;
use std::sync::{Arc, OnceLock, mpsc};
use std::time::{Duration, Instant};

use kobel_services::{Command, ServicesHandle};
use kobel_wayland::{Control, KeyboardInteractivity, OutputControl, SurfaceId};

use crate::motion::{SETTLE_EPS, SpringSim, SpringSpec};

/// Stable name for a UI-owned surface.
///
/// Names cross the `kobelctl` IPC boundary, so they are deliberately restricted to
/// lowercase ASCII letters, digits, `-` and `_`. The core crate does not prescribe
/// any particular names.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SurfaceKey(Arc<str>);

impl SurfaceKey {
    pub fn new(name: impl AsRef<str>) -> Result<Self, String> {
        let name = name.as_ref();
        if name.is_empty() {
            return Err("surface name cannot be empty".to_string());
        }
        if !name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_'))
        {
            return Err(format!(
                "invalid surface name {name:?}: use lowercase ASCII letters, digits, '-' or '_'",
            ));
        }
        Ok(Self(Arc::from(name)))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for SurfaceKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl FromStr for SurfaceKey {
    type Err = String;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        Self::new(name)
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
    /// Activate (raise + focus) a window by its `kobel_wayland::ToplevelInfo` id,
    /// via the real `zwlr_foreign_toplevel_manager_v1` protocol -- NOT routed
    /// through kobel-services/Command, that D-Bus path never existed (see
    /// kobel-services/src/gnoblin.rs's module doc).
    ActivateWindow(String),
    /// Minimize a window by id (same protocol path as `ActivateWindow`).
    MinimizeWindow(String),
    /// Close a window by id via `zwlr_foreign_toplevel_handle_v1.close`.
    CloseWindow(String),
    /// A text input surface's live editing state, resent to the IME after each
    /// change so a composing input method has current surrounding text. Ignored
    /// when no surface currently holds text-input focus.
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
        (
            Self {
                tx,
                waker: Arc::new(OnceLock::new()),
            },
            rx,
        )
    }

    pub fn send(&self, msg: ShellMsg) {
        let _ = self.tx.send(msg);
        if let Some(wake) = self.waker.get() {
            wake();
        }
    }

    /// Install the loop-wake callback. The production entry point calls this after
    /// the host loop is ready; every clone shares it, so any send wakes the loop.
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

/// Surface lifecycle side effects shared by normal ticks and output hotplug
/// callbacks. Both [`Control`] and [`OutputControl`] implement this contract.
pub trait SurfaceHost {
    fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity);
    fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool);
}

/// Full manager side effects available during the normal shell tick.
pub trait RevealHost: SurfaceHost {
    /// Activate (raise + focus) a window by its `ToplevelInfo` id.
    fn activate_window(&mut self, id: &str);
    /// Minimize a window by id.
    fn minimize_window(&mut self, id: &str);
    /// Close a window by id.
    fn close_window(&mut self, id: &str);
    /// Report a text-input surface's live surrounding text to the IME and commit it
    /// immediately. No-op if no surface currently has text input enabled.
    fn ime_sync_surrounding_text(&mut self, text: &str, cursor: i32, anchor: i32);
}

impl SurfaceHost for Control<'_> {
    fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        Control::set_keyboard_interactivity(self, id, mode);
    }

    fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        Control::set_input_region_empty(self, id, empty);
    }
}

impl SurfaceHost for OutputControl<'_> {
    fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        OutputControl::set_keyboard_interactivity(self, id, mode);
    }

    fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        OutputControl::set_input_region_empty(self, id, empty);
    }
}

impl RevealHost for Control<'_> {
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

/// Spring choices for the optional reveal manager.
///
/// The defaults preserve the manager's existing fade behaviour, but the concrete
/// UI owns this policy and can replace both specs before registering surfaces.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RevealMotion {
    pub open: SpringSpec,
    pub close: SpringSpec,
}

impl Default for RevealMotion {
    fn default() -> Self {
        Self {
            open: SpringSpec { k: 360.0, d: 32.0 },
            close: SpringSpec { k: 640.0, d: 48.0 },
        }
    }
}

/// ~one 60Hz frame. On a cold start the manager rewinds its clock by this much so
/// the first integrated spring step advances by one frame instead of the whole idle
/// gap: the closed-form solver would otherwise collapse a large dt straight onto the
/// target (an instant, un-animated jump), and writing the unchanged 0/1 progress
/// would never dirty a surface -- so no frame callback would arrive to drive the
/// next step and the spring would stall at rest.
const FRAME_DT: Duration = Duration::from_micros(16_667);

// Profiling trace (KOBEL_PROFILE_ANIM). The manager integrates the reveal springs,
// so it sees every sample. The accumulator is pure (no Freya, no clock): callers
// feed it absolute monotonic timestamps in milliseconds, making stalls visible as
// a large max_gap_ms while keeping the calculations unit-testable.

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
    /// Whether this open reused an already-warm surface (open_count > 1).
    /// Always false for a close.
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
    /// division is always well-defined.
    fn elapsed_ms(&self, now_ms: f64) -> f64 {
        (now_ms - self.start_ms).max(1.0)
    }

    /// Mean sample rate over the elapsed window (Hz, rounded).
    fn sample_hz(&self, now_ms: f64) -> u32 {
        ((self.samples as f64 * 1000.0) / self.elapsed_ms(now_ms)).round() as u32
    }
}

/// One registered surface's reveal state. The surface is created once and remains
/// mapped: closed = opacity 0, empty input region, keyboard None; open = opacity
/// springs to 1, full input region, its configured keyboard mode. The spring
/// integrates manager-side (see [`Manager::tick`]).
struct Reveal {
    id: SurfaceId,
    /// Keyboard mode applied while this surface is open.
    kb_open: KeyboardInteractivity,
    /// Opacity spring (0 = hidden, 1 = revealed). Retargeting keeps x and v, so
    /// interrupting a fade (reopen mid-close) continues from the current value.
    sim: SpringSim,
    /// Desired end state: true = open (spring -> 1), false = closed (spring -> 0).
    target_open: bool,
    /// True while the spring is still moving and must be integrated each frame.
    active: bool,
    /// Writes animated progress into state owned by the registered surface.
    write_progress: Box<dyn FnMut(f32)>,
    /// Profiling transition counter, bumped per transition when profiling is on.
    trace_seq: u64,
    /// Opens so far, so the profiler can flag a warm reopen (count > 1).
    open_count: u32,
    /// In-flight profiling accumulator; Some only while profiling and a transition
    /// is running.
    trace: Option<RevealTrace>,
}

/// Optional reveal coordinator intended to run on the host event-loop thread.
/// [`Manager::tick`] drains pending [`ShellMsg`]s and advances a one-open-at-a-time
/// registry of mapped surfaces, coordinating opacity, keyboard focus and input
/// regions without prescribing any surface names or presentation.
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
    motion: RevealMotion,
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
    /// Additive popup closer. Popups are host-owned, so the manager cannot close
    /// them directly; the production entry point may install this hook so
    /// [`ShellMsg::CloseAll`] also dismisses every open popup.
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
            motion: RevealMotion::default(),
            last_tick: Instant::now(),
            reduced_motion: false,
            profile: false,
            trace_epoch: Instant::now(),
            close_popups: None,
            quit: false,
        }
    }

    /// Install a host-side hook that dismisses every open popup when a reveal opens
    /// or closes. UI implementations that do not use popups can leave this unset.
    pub fn set_close_popups(&mut self, close_popups: Box<dyn Fn()>) {
        self.close_popups = Some(close_popups);
    }

    /// Register one warm-mapped reveal surface with its UI-owned name, host id,
    /// open keyboard mode and animated progress writer.
    ///
    /// Returns `false` and leaves the existing registration untouched when `key`
    /// is already live. Retire old surfaces with [`Manager::unregister_reveal`]
    /// before reusing their key during compositor close or output hotplug.
    pub fn register_reveal(
        &mut self,
        key: SurfaceKey,
        id: SurfaceId,
        kb_open: KeyboardInteractivity,
        write_progress: Box<dyn FnMut(f32)>,
    ) -> bool {
        if self.reveals.contains_key(&key) {
            tracing::warn!("[manager] register {}: key already live", key.as_str());
            return false;
        }
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
        true
    }

    /// Forget a reveal surface and restore safe host state before dropping it.
    /// If it was open, also restore the dismiss layer to click-through and dismiss
    /// any host-owned popup. Host calls are harmless no-ops if the compositor has
    /// already retired the surface.
    ///
    /// Returns whether a registration existed.
    pub fn unregister_reveal(&mut self, key: &SurfaceKey, host: &mut impl SurfaceHost) -> bool {
        let Some(reveal) = self.reveals.remove(key) else {
            return false;
        };
        host.set_keyboard_interactivity(reveal.id, KeyboardInteractivity::None);
        host.set_input_region_empty(reveal.id, true);
        if self.open.as_ref() == Some(key) {
            self.open = None;
            self.dismiss_popups();
            self.sync_dismiss(host);
        }
        true
    }

    /// Register or replace the full-screen dismiss layer and immediately apply the
    /// manager's current open/closed state. A replaced live layer is made
    /// click-through before it is forgotten.
    pub fn set_dismiss(&mut self, id: SurfaceId, host: &mut impl SurfaceHost) {
        if let Some(previous) = self.dismiss.replace(id)
            && previous != id
        {
            host.set_input_region_empty(previous, true);
        }
        self.sync_dismiss(host);
    }

    /// Forget a dismiss layer after making it click-through. Returns whether the
    /// matching registration was cleared.
    pub fn clear_dismiss(&mut self, id: SurfaceId, host: &mut impl SurfaceHost) -> bool {
        if self.dismiss != Some(id) {
            return false;
        }
        host.set_input_region_empty(id, true);
        self.dismiss = None;
        true
    }

    /// Replace the reveal springs. Call this before opening a registered surface.
    pub fn set_reveal_motion(&mut self, motion: RevealMotion) {
        self.motion = motion;
    }

    /// Enable the reduced-motion reveal path: opacity springs snap to 0/1 instead of
    /// fading.
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
    fn log_trace_event(key: &SurfaceKey, t: &RevealTrace, event: &str, now_ms: f64) {
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

    /// Emit a stable machine-readable settle summary as a raw stdout line beginning
    /// with `KOBEL_MOTION `.
    fn emit_motion(key: &SurfaceKey, t: &RevealTrace, now_ms: f64) {
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
        if self.open.as_ref() == Some(&key) {
            self.dismiss_popups();
            self.close(&key, host);
        } else {
            self.open_key(key, host);
        }
    }

    /// Whether `key` is the currently open on-demand surface.
    pub fn is_open(&self, key: &SurfaceKey) -> bool {
        self.open.as_ref() == Some(key)
    }

    fn dismiss_popups(&self) {
        if let Some(close_popups) = &self.close_popups {
            close_popups();
        }
    }

    fn open_key(&mut self, key: SurfaceKey, host: &mut impl RevealHost) {
        if !self.reveals.contains_key(&key) {
            tracing::warn!("[manager] toggle {}: surface not registered", key.as_str());
            return;
        }
        // Popups are host-owned and can outlive the surface that opened them. Close
        // them before revealing a different surface so two independent focus grabs
        // never remain interactive at once.
        self.dismiss_popups();
        // One-open-at-a-time: close whatever else is open first.
        if let Some(current) = self.open.clone()
            && current != key
        {
            self.close(&current, host);
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
        self.open = Some(key.clone());
        // Reveal: full input region + this surface's keyboard mode.
        host.set_input_region_empty(id, false);
        host.set_keyboard_interactivity(id, kb);
        self.sync_dismiss(host);
        tracing::info!("[manager] opened {key}");
        if let Some(t) = opened_trace {
            Self::log_trace_event(&key, &t, "open_start", now);
        }
    }

    fn close(&mut self, key: &SurfaceKey, host: &mut impl RevealHost) {
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
        if self.open.as_ref() == Some(key) {
            self.open = None;
        }
        // Drop keyboard interactivity immediately, before the fade plays. An
        // exclusive surface that held focus through its close fade would swallow
        // keys while invisible and could misroute input during a rapid switch.
        if let Some(id) = close_id {
            host.set_keyboard_interactivity(id, KeyboardInteractivity::None);
        }
        self.sync_dismiss(host);
        if did_close {
            tracing::info!("[manager] closed {key}");
        }
        if let Some(t) = started_trace {
            Self::log_trace_event(key, &t, "close_start", now);
        }
        // The empty input region is restored on settle (in advance), not here, so it
        // holds through the whole close fade (keyboard None was already dropped above).
    }

    fn close_all(&mut self, host: &mut impl RevealHost) {
        // Dismiss host-owned popups alongside the registered reveal surface.
        self.dismiss_popups();
        if let Some(current) = self.open.clone() {
            self.close(&current, host);
        } else {
            tracing::debug!("[manager] close-all: nothing open");
        }
    }

    /// The dismiss layer catches clicks only while a surface is open.
    fn sync_dismiss(&mut self, host: &mut impl SurfaceHost) {
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
            let spec = if r.target_open {
                self.motion.open
            } else {
                self.motion.close
            };
            r.sim.step(dt, spec);
            let settled = r.sim.settled(SETTLE_EPS);
            if settled {
                r.sim.x = r.sim.target;
                r.sim.v = 0.0;
                r.active = false;
            }
            // Publish a valid opacity even when the chosen spring overshoots.
            let x = r.sim.x.clamp(0.0, 1.0);
            (r.write_progress)(x);
            if profile {
                if let Some(t) = r.trace.as_mut()
                    && t.record(now)
                {
                    Self::log_trace_event(key, t, "first_tick", now);
                }
                if settled && let Some(t) = r.trace.take() {
                    Self::log_trace_event(key, &t, "settled", now);
                    Self::emit_motion(key, &t, now);
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
        window_calls: Vec<(&'static str, String)>,
        ime_calls: Vec<(String, i32, i32)>,
    }
    impl SurfaceHost for FakeHost {
        fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
            self.kb.push((id, mode));
        }
        fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
            self.region.push((id, empty));
        }
    }
    impl RevealHost for FakeHost {
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

    fn key(name: &str) -> SurfaceKey {
        name.parse().expect("valid test surface key")
    }

    fn recording(recorded: &Rc<RefCell<Vec<f32>>>) -> Box<dyn FnMut(f32)> {
        let recorded = recorded.clone();
        Box::new(move |v| recorded.borrow_mut().push(v))
    }

    #[test]
    fn surface_key_round_trips_and_rejects_unsafe_names() {
        let surface = key("quick-settings_2");
        assert_eq!(SurfaceKey::from_str(surface.as_str()), Ok(surface));
        assert!(SurfaceKey::from_str("").is_err());
        assert!(SurfaceKey::from_str("UpperCase").is_err());
        assert!(SurfaceKey::from_str("contains spaces").is_err());
    }

    #[test]
    fn tick_forwards_service_commands_and_ignores_unregistered_toggle() {
        let (bus, rx) = ShellBus::new();
        let recorded = Rc::new(RefCell::new(Vec::new()));
        let mut manager = Manager::new(rx, RecordingSink(recorded.clone()));
        let mut host = FakeHost::default();

        // No reveal registered for this UI-owned name, so the toggle is ignored.
        bus.send(ShellMsg::Toggle(key("unregistered-surface")));
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
        let exclusive_surface = SurfaceId::new(1);
        let on_demand_surface = SurfaceId::new(2);
        let dismiss = SurfaceId::new(9);
        let lp = Rc::new(RefCell::new(Vec::new()));
        let on_demand_progress = Rc::new(RefCell::new(Vec::new()));
        manager.register_reveal(
            key("exclusive-surface"),
            exclusive_surface,
            KeyboardInteractivity::Exclusive,
            recording(&lp),
        );
        manager.register_reveal(
            key("on-demand-surface"),
            on_demand_surface,
            KeyboardInteractivity::OnDemand,
            recording(&on_demand_progress),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(dismiss, &mut host);

        bus.send(ShellMsg::Toggle(key("exclusive-surface")));
        manager.tick(&mut host);
        assert!(
            host.region.contains(&(exclusive_surface, false)),
            "exclusive surface gets a full input region"
        );
        assert!(host.kb.contains(&(exclusive_surface, KeyboardInteractivity::Exclusive)));
        assert!(
            host.region.contains(&(dismiss, false)),
            "dismiss catches clicks while open"
        );
        assert!(
            lp.borrow().last().is_some_and(|&v| v > 0.0),
            "exclusive surface opacity springs off zero"
        );

        // Opening the on-demand surface displaces the exclusive surface and
        // eventually makes it click-through.
        host.kb.clear();
        host.region.clear();
        bus.send(ShellMsg::Toggle(key("on-demand-surface")));
        manager.tick(&mut host);
        assert!(host.region.contains(&(on_demand_surface, false)));
        assert!(host.kb.contains(&(on_demand_surface, KeyboardInteractivity::OnDemand)));
        manager.advance(1.0, &mut host);
        assert!(
            host.region.contains(&(exclusive_surface, true)),
            "displaced exclusive surface becomes click-through on settle"
        );
        assert!(host.kb.contains(&(exclusive_surface, KeyboardInteractivity::None)));
    }

    #[test]
    fn close_settles_to_click_through_and_kb_none() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let id = SurfaceId::new(7);
        manager.register_reveal(key("surface"), id, KeyboardInteractivity::OnDemand, Box::new(|_| {}));
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        bus.send(ShellMsg::Toggle(key("surface")));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        host.kb.clear();
        host.region.clear();

        bus.send(ShellMsg::CloseAll);
        manager.tick(&mut host);
        assert!(
            host.region.contains(&(SurfaceId::new(0), true)),
            "dismiss goes click-through once nothing is open"
        );
        manager.advance(1.0, &mut host); // settle close
        assert!(host.region.contains(&(id, true)));
        assert!(host.kb.contains(&(id, KeyboardInteractivity::None)));
    }

    #[test]
    fn surface_lifecycle_can_unregister_reveals_and_dismiss_layers() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let reveal_key = key("surface");
        let reveal_id = SurfaceId::new(7);
        let dismiss_id = SurfaceId::new(8);
        assert!(manager.register_reveal(
            reveal_key.clone(),
            reveal_id,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        ));
        assert!(!manager.register_reveal(
            reveal_key.clone(),
            SurfaceId::new(99),
            KeyboardInteractivity::Exclusive,
            Box::new(|_| {}),
        ));
        let mut host = FakeHost::default();
        manager.set_dismiss(dismiss_id, &mut host);

        bus.send(ShellMsg::Toggle(reveal_key.clone()));
        manager.tick(&mut host);
        host.region.clear();
        host.kb.clear();

        let replacement_dismiss = SurfaceId::new(9);
        manager.set_dismiss(replacement_dismiss, &mut host);
        assert!(host.region.contains(&(dismiss_id, true)));
        assert!(host.region.contains(&(replacement_dismiss, false)));
        host.region.clear();

        assert!(manager.unregister_reveal(&reveal_key, &mut host));
        assert!(!manager.is_open(&reveal_key));
        assert!(host.kb.contains(&(reveal_id, KeyboardInteractivity::None)));
        assert!(host.region.contains(&(reveal_id, true)));
        assert!(host.region.contains(&(replacement_dismiss, true)));
        assert!(!manager.clear_dismiss(SurfaceId::new(99), &mut host));
        assert!(manager.clear_dismiss(replacement_dismiss, &mut host));
        assert!(!manager.clear_dismiss(replacement_dismiss, &mut host));

        host.region.clear();
        bus.send(ShellMsg::Toggle(reveal_key));
        manager.tick(&mut host);
        assert!(
            host.region.is_empty(),
            "an unregistered key cannot reopen a retired surface"
        );
    }

    #[test]
    fn reopen_mid_close_keeps_surface_open() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let id = SurfaceId::new(5);
        manager.register_reveal(
            key("reopened-surface"),
            id,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        bus.send(ShellMsg::Toggle(key("reopened-surface")));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        bus.send(ShellMsg::Toggle(key("reopened-surface")));
        manager.tick(&mut host);
        manager.advance(0.01, &mut host); // begin close, still fading
        host.kb.clear();
        host.region.clear();
        bus.send(ShellMsg::Toggle(key("reopened-surface")));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle -> should settle OPEN, not tear down
        assert!(
            !host
                .kb
                .iter()
                .any(|&(i, m)| i == id && m == KeyboardInteractivity::None),
            "reopened surface must not be torn down to kb None"
        );
        assert!(
            host.region.contains(&(id, false)),
            "reopened surface keeps a full input region"
        );
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
        manager.register_reveal(
            key("on-demand-surface"),
            id,
            KeyboardInteractivity::OnDemand,
            recording(&p),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        bus.send(ShellMsg::Toggle(key("on-demand-surface")));
        manager.tick(&mut host);
        assert_eq!(
            p.borrow().last().copied(),
            Some(1.0),
            "reduced motion opens fully in one tick"
        );
        assert!(!manager.any_active(), "no spring left running after a snapped open");
        assert!(host.region.contains(&(id, false)));
        assert!(host.kb.contains(&(id, KeyboardInteractivity::OnDemand)));

        host.kb.clear();
        host.region.clear();
        bus.send(ShellMsg::Toggle(key("on-demand-surface")));
        manager.tick(&mut host);
        assert_eq!(
            p.borrow().last().copied(),
            Some(0.0),
            "reduced motion closes fully in one tick"
        );
        assert!(!manager.any_active());
        assert!(
            host.region.contains(&(id, true)),
            "closed surface becomes click-through immediately"
        );
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
        let exclusive_surface = SurfaceId::new(1);
        manager.register_reveal(
            key("exclusive-surface"),
            exclusive_surface,
            KeyboardInteractivity::Exclusive,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        bus.send(ShellMsg::Toggle(key("exclusive-surface")));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        host.kb.clear();
        host.region.clear();

        // Begin closing. The kb drop must land during this tick, not on settle.
        bus.send(ShellMsg::Toggle(key("exclusive-surface")));
        manager.tick(&mut host);
        assert!(
            host.kb.contains(&(exclusive_surface, KeyboardInteractivity::None)),
            "keyboard drops to None immediately in close(), not deferred to settle"
        );
        assert!(
            !host.region.contains(&(exclusive_surface, true)),
            "input region is NOT restored yet -- it holds through the fade"
        );
        // The interruptible spring is still running (fade has not settled).
        manager.advance(0.001, &mut host);
        assert!(manager.any_active(), "close fade still running after a tiny step");
    }

    #[test]
    fn displaced_surface_drops_keyboard_before_new_surface_grabs_it() {
        // Rapid switch: the outgoing exclusive surface must drop its keyboard mode
        // before the incoming on-demand surface takes focus, so no key press routes
        // to the wrong surface.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let exclusive_surface = SurfaceId::new(1);
        let on_demand_surface = SurfaceId::new(2);
        manager.register_reveal(
            key("exclusive-surface"),
            exclusive_surface,
            KeyboardInteractivity::Exclusive,
            Box::new(|_| {}),
        );
        manager.register_reveal(
            key("on-demand-surface"),
            on_demand_surface,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        bus.send(ShellMsg::Toggle(key("exclusive-surface")));
        manager.tick(&mut host);
        manager.advance(1.0, &mut host); // settle open
        host.kb.clear();

        bus.send(ShellMsg::Toggle(key("on-demand-surface")));
        manager.tick(&mut host);

        let exclusive_none = host
            .kb
            .iter()
            .position(|&(i, m)| i == exclusive_surface && m == KeyboardInteractivity::None);
        let on_demand_mode = host
            .kb
            .iter()
            .position(|&(i, m)| i == on_demand_surface && m == KeyboardInteractivity::OnDemand);
        assert!(exclusive_none.is_some(), "displaced surface drops to keyboard None");
        assert!(
            on_demand_mode.is_some(),
            "incoming surface takes its OnDemand keyboard mode"
        );
        assert!(
            exclusive_none < on_demand_mode,
            "keyboard None must be applied before the incoming surface takes focus"
        );
    }

    #[test]
    fn opening_a_surface_dismisses_a_stray_popup() {
        // Popups are host-owned and tracked outside `self.open`. Opening a reveal
        // must close any existing popup before its grab can compete for focus.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let surface_id = SurfaceId::new(2);
        let surface = key("surface");
        manager.register_reveal(
            surface.clone(),
            surface_id,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);
        let popup_closes = Rc::new(RefCell::new(0u32));
        let counter = popup_closes.clone();
        manager.set_close_popups(Box::new(move || {
            *counter.borrow_mut() += 1;
        }));

        bus.send(ShellMsg::Toggle(surface));
        manager.tick(&mut host);
        assert_eq!(
            *popup_closes.borrow(),
            1,
            "opening a surface must dismiss a stray popup",
        );
        assert!(
            host.region.contains(&(surface_id, false)),
            "surface still opens normally"
        );
    }

    #[test]
    fn toggling_the_open_surface_closed_dismisses_popups() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let surface = key("surface");
        manager.register_reveal(
            surface.clone(),
            SurfaceId::new(1),
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);
        let popup_closes = Rc::new(RefCell::new(0u32));
        let counter = popup_closes.clone();
        manager.set_close_popups(Box::new(move || {
            *counter.borrow_mut() += 1;
        }));

        bus.send(ShellMsg::Toggle(surface.clone()));
        manager.tick(&mut host);
        assert_eq!(*popup_closes.borrow(), 1, "opening dismisses popups");

        bus.send(ShellMsg::Toggle(surface));
        manager.tick(&mut host);
        assert_eq!(*popup_closes.borrow(), 2, "closing by toggle also dismisses popups");
    }

    #[test]
    fn close_all_dismisses_popups() {
        // CloseAll dismisses a stray popup even when no reveal surface is open.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);
        let popup_closes = Rc::new(RefCell::new(0u32));
        let counter = popup_closes.clone();
        manager.set_close_popups(Box::new(move || {
            *counter.borrow_mut() += 1;
        }));

        bus.send(ShellMsg::CloseAll);
        manager.tick(&mut host);
        assert_eq!(
            *popup_closes.borrow(),
            1,
            "CloseAll dismisses a popup with nothing else open"
        );
    }

    #[test]
    fn no_close_popups_hook_installed_is_a_harmless_no_op() {
        // A UI without popups leaves the optional hook unset. Opening and closing
        // surfaces must remain harmless in that configuration.
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let on_demand_surface = SurfaceId::new(2);
        manager.register_reveal(
            key("on-demand-surface"),
            on_demand_surface,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        bus.send(ShellMsg::Toggle(key("on-demand-surface")));
        bus.send(ShellMsg::CloseAll);
        manager.tick(&mut host); // must not panic
    }

    #[test]
    fn is_open_reflects_live_manager_state() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        let primary_surface = SurfaceId::new(1);
        let primary_key = key("primary");
        let secondary_surface = SurfaceId::new(2);
        let secondary_key = key("secondary");
        manager.register_reveal(
            primary_key.clone(),
            primary_surface,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        manager.register_reveal(
            secondary_key.clone(),
            secondary_surface,
            KeyboardInteractivity::OnDemand,
            Box::new(|_| {}),
        );
        let mut host = FakeHost::default();
        manager.set_dismiss(SurfaceId::new(0), &mut host);

        assert!(!manager.is_open(&primary_key), "nothing open at startup");

        bus.send(ShellMsg::Toggle(primary_key.clone()));
        manager.tick(&mut host);
        assert!(manager.is_open(&primary_key), "primary surface now open");
        assert!(
            !manager.is_open(&secondary_key),
            "a different key must never read as open",
        );

        bus.send(ShellMsg::Toggle(secondary_key.clone()));
        manager.tick(&mut host);
        assert!(!manager.is_open(&primary_key), "displaced by another surface");
        assert!(manager.is_open(&secondary_key));

        bus.send(ShellMsg::CloseAll);
        manager.tick(&mut host);
        assert!(!manager.is_open(&secondary_key), "closed by CloseAll");
    }
}
