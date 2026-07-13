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
}

impl RevealHost for Control<'_> {
    fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        Control::set_keyboard_interactivity(self, id, mode);
    }

    fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        Control::set_input_region_empty(self, id, empty);
    }
}

/// ~one 60Hz frame. On a cold start the manager rewinds its clock by this much so
/// the first integrated spring step advances by one frame instead of the whole idle
/// gap: the closed-form solver would otherwise collapse a large dt straight onto the
/// target (an instant, un-animated jump), and writing the unchanged 0/1 progress
/// would never dirty a surface -- so no frame callback would arrive to drive the
/// next step and the spring would stall at rest.
const FRAME_DT: Duration = Duration::from_micros(16_667);

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
    /// Wall clock for the reveal springs' integration timestep.
    last_tick: Instant,
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
            last_tick: Instant::now(),
            quit: false,
        }
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
            },
        );
    }

    /// Register the full-screen dismiss layer surface.
    pub fn set_dismiss(&mut self, id: SurfaceId) {
        self.dismiss = Some(id);
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
        let (id, kb) = {
            let r = self.reveals.get_mut(&key).expect("registered above");
            r.target_open = true;
            r.active = true;
            r.sim.target = 1.0; // retarget; x and v preserved -> interruptible
            (r.id, r.kb_open)
        };
        self.open = Some(key);
        // Reveal: full input region + this surface's keyboard mode.
        host.set_input_region_empty(id, false);
        host.set_keyboard_interactivity(id, kb);
        self.sync_dismiss(host);
        tracing::info!("[manager] opened {}", key.as_str());
    }

    fn close(&mut self, key: SurfaceKey, host: &mut impl RevealHost) {
        let did_close = match self.reveals.get_mut(&key) {
            Some(r) if r.target_open || r.active => {
                r.target_open = false;
                r.active = true;
                r.sim.target = 0.0; // retarget; x and v preserved -> interruptible
                true
            }
            _ => false,
        };
        if self.open == Some(key) {
            self.open = None;
        }
        self.sync_dismiss(host);
        if did_close {
            tracing::info!("[manager] closed {}", key.as_str());
        }
        // Keyboard None + empty input region are restored on settle (in advance),
        // not here, so they hold through the whole close fade.
    }

    fn close_all(&mut self, host: &mut impl RevealHost) {
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
        for r in self.reveals.values_mut() {
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
            if settled && !r.target_open {
                host.set_input_region_empty(r.id, true);
                host.set_keyboard_interactivity(r.id, KeyboardInteractivity::None);
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
    }
    impl RevealHost for FakeHost {
        fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
            self.kb.push((id, mode));
        }
        fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
            self.region.push((id, empty));
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
}
