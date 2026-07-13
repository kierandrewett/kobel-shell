// Surface open/close registry (makeReveal successor) + the ShellBus contract.
// The bus is the ONLY channel UI components use to reach the shell: toggling
// surfaces, sending service commands. Contract consumed by ui/* via
// use_consume::<ShellBus>() -- keep these types stable, the manager task owns
// the implementation behind them.

use std::str::FromStr;
use std::sync::{Arc, OnceLock, mpsc};

use kobel_services::{Command, ServicesHandle};

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

/// The shell manager loop, living on the UI thread. The host tick calls
/// [`Manager::drain`] each sweep to apply every pending [`ShellMsg`]. On-demand
/// surfaces are not built yet (later phases), so Toggle/CloseAll only log.
pub struct Manager {
    rx: mpsc::Receiver<ShellMsg>,
    services: Box<dyn CommandSink>,
    quit: bool,
}

impl Manager {
    pub fn new(rx: mpsc::Receiver<ShellMsg>, services: impl CommandSink + 'static) -> Self {
        Self { rx, services: Box::new(services), quit: false }
    }

    /// Drain and apply every pending message. Service commands forward to
    /// kobel-services; Quit latches an exit request. Returns true once a Quit has been
    /// seen (the caller should exit the loop).
    pub fn drain(&mut self) -> bool {
        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                ShellMsg::Toggle(key) => {
                    tracing::info!("[manager] toggle {} (surface not yet built)", key.as_str());
                }
                ShellMsg::CloseAll => {
                    tracing::info!("[manager] close-all (no on-demand surfaces yet)");
                }
                ShellMsg::Service(cmd) => self.services.send(cmd),
                ShellMsg::Quit => {
                    tracing::info!("[manager] quit");
                    self.quit = true;
                }
            }
        }
        self.quit
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

    #[test]
    fn surface_key_round_trips() {
        for key in SurfaceKey::ALL {
            assert_eq!(SurfaceKey::from_str(key.as_str()), Ok(key));
        }
        assert!(SurfaceKey::from_str("nope").is_err());
    }

    #[test]
    fn drain_forwards_service_commands_and_ignores_toggle() {
        let (bus, rx) = ShellBus::new();
        let recorded = Rc::new(RefCell::new(Vec::new()));
        let mut manager = Manager::new(rx, RecordingSink(recorded.clone()));

        bus.send(ShellMsg::Toggle(SurfaceKey::Launcher));
        bus.send(ShellMsg::Service(Command::SetMuted(true)));
        bus.send(ShellMsg::CloseAll);

        assert!(!manager.drain(), "no quit seen yet");
        assert_eq!(recorded.borrow().len(), 1);
        assert!(matches!(recorded.borrow().first(), Some(Command::SetMuted(true))));
    }

    #[test]
    fn drain_latches_quit() {
        let (bus, rx) = ShellBus::new();
        let mut manager = Manager::new(rx, RecordingSink::default());
        bus.send(ShellMsg::Quit);
        assert!(manager.drain());
        // Quit stays latched across further empty drains.
        assert!(manager.drain());
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
