//! kobel-services: system state providers (zbus/tokio on a side thread + pulse on
//! its own thread). Snapshots are PLAIN data pushed over a callback; this crate
//! NEVER depends on calloop or freya. See docs/FREYA-PLAN.md section 5.
//!
//! Phase-2 scope: gnoblin (compositor link), audio (pipewire-pulse), battery
//! (UPower DisplayDevice). Other Astal replacements land in later phases.

use std::thread::JoinHandle;

use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::sync::oneshot;

mod apps;
mod audio;
mod battery;
mod gnoblin;
mod mpris;

pub use audio::{AudioSnapshot, AudioStream};
pub use battery::BatterySnapshot;
pub use gnoblin::{GnoblinSnapshot, GnoblinWindow};
pub use apps::{AppEntry, AppsSnapshot};
pub use mpris::{MediaSnapshot, PlayerInfo};

use audio::{AudioCommand, AudioMsg};
use gnoblin::GnoblinCommand;
use apps::AppsCommand;
use mpris::MprisCommand;

/// A state change from one of the services. Plain, thread-safe data only.
#[derive(Debug, Clone)]
pub enum ServiceEvent {
    Gnoblin(GnoblinSnapshot),
    Audio(AudioSnapshot),
    Battery(BatterySnapshot),
    Apps(apps::AppsSnapshot),
    Media(mpris::MediaSnapshot),
}

/// A request routed to the owning service. Fire-and-forget.
#[derive(Debug, Clone)]
pub enum Command {
    /// gnoblin: soft-reload the compositor shell integration.
    Reload,
    /// gnoblin: toggle a named compositor feature.
    SetFeature { name: String, on: bool },
    /// gnoblin: focus a window by id.
    ActivateWindow(String),
    /// gnoblin: minimize a window by id.
    MinimizeWindow(String),
    /// audio: set the default sink volume (normalized, 1.0 == VOLUME_NORM).
    SetVolume(f32),
    /// audio: set the default sink mute state.
    SetMuted(bool),
    /// audio: set a sink-input (per-app stream) volume by its index.
    SetStreamVolume { id: u32, volume: f32 },
    /// apps: launch a desktop application by desktop id.
    LaunchApp(String),
    /// media: toggle play/pause on the active player.
    MediaPlayPause,
    /// media: next track on the active player.
    MediaNext,
    /// media: previous track on the active player.
    MediaPrevious,
}

/// Entry point. `Services::spawn` starts the background threads and returns a
/// handle; drop the handle to shut everything down cleanly.
pub struct Services;

impl Services {
    /// Start all services. `on_event` is invoked (on the services thread) for
    /// every snapshot change. The UI side typically wraps a calloop channel
    /// sender here; this crate imposes no such dependency.
    pub fn spawn(on_event: impl Fn(ServiceEvent) + Send + 'static) -> ServicesHandle {
        let (cmd_tx, cmd_rx) = unbounded_channel::<Command>();
        let (event_tx, event_rx) = unbounded_channel::<ServiceEvent>();
        let (audio_tx, audio_rx) = std::sync::mpsc::channel::<AudioMsg>();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // Dedicated pulse thread (its threaded mainloop spins up its own poll
        // thread internally). It needs a Sender to request refreshes from its
        // subscribe callback, plus the receiver to drain commands/shutdown.
        let audio_event_tx = event_tx.clone();
        let audio_self_tx = audio_tx.clone();
        let audio_thread = std::thread::Builder::new()
            .name("kobel-audio".to_string())
            .spawn(move || audio::run(audio_event_tx, audio_self_tx, audio_rx))
            .expect("[services] failed to spawn audio thread");

        // The single tokio thread hosting the zbus services.
        let audio_router_tx = audio_tx.clone();
        let tokio_thread = std::thread::Builder::new()
            .name("kobel-services".to_string())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(1)
                    .enable_all()
                    .build()
                    .expect("[services] failed to build tokio runtime");
                rt.block_on(run(
                    cmd_rx,
                    event_rx,
                    event_tx,
                    on_event,
                    audio_router_tx,
                    shutdown_rx,
                ));
            })
            .expect("[services] failed to spawn services thread");

        ServicesHandle {
            cmd_tx,
            shutdown: Some(shutdown_tx),
            audio_tx,
            tokio_thread: Some(tokio_thread),
            audio_thread: Some(audio_thread),
        }
    }
}

/// Live handle to the running services. Dropping it shuts down both threads.
pub struct ServicesHandle {
    cmd_tx: UnboundedSender<Command>,
    shutdown: Option<oneshot::Sender<()>>,
    audio_tx: std::sync::mpsc::Sender<AudioMsg>,
    tokio_thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<()>>,
}

impl ServicesHandle {
    /// Route a command to its owning service. Non-blocking; dropped if the
    /// services thread has already gone away.
    pub fn send(&self, cmd: Command) {
        if self.cmd_tx.send(cmd).is_err() {
            tracing::warn!("[services] command dropped: services thread is gone");
        }
    }
}

impl Drop for ServicesHandle {
    fn drop(&mut self) {
        // Tell the tokio side to stop, then the pulse owner loop.
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        let _ = self.audio_tx.send(AudioMsg::Shutdown);
        if let Some(handle) = self.tokio_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.audio_thread.take() {
            let _ = handle.join();
        }
    }
}

/// Tokio-side orchestration: fan snapshots out to `on_event`, run the zbus
/// services, and route commands until shutdown.
async fn run(
    mut cmd_rx: UnboundedReceiver<Command>,
    mut event_rx: UnboundedReceiver<ServiceEvent>,
    event_tx: UnboundedSender<ServiceEvent>,
    on_event: impl Fn(ServiceEvent) + Send + 'static,
    audio_tx: std::sync::mpsc::Sender<AudioMsg>,
    shutdown_rx: oneshot::Receiver<()>,
) {
    // Single consumer owns the user callback so `on_event` need not be Sync.
    let consumer = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            on_event(event);
        }
    });

    let (gnoblin_tx, gnoblin_rx) = unbounded_channel::<GnoblinCommand>();
    let gnoblin = tokio::spawn(gnoblin::run(event_tx.clone(), gnoblin_rx));
    let battery = tokio::spawn(battery::run(event_tx.clone()));

    let (apps_tx, apps_rx) = unbounded_channel::<AppsCommand>();
    let apps = tokio::spawn(apps::run(event_tx.clone(), apps_rx));
    let (mpris_tx, mpris_rx) = unbounded_channel::<MprisCommand>();
    let mpris = tokio::spawn(mpris::run(event_tx.clone(), mpris_rx));

    let router = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                Command::Reload => {
                    let _ = gnoblin_tx.send(GnoblinCommand::Reload);
                }
                Command::SetFeature { name, on } => {
                    let _ = gnoblin_tx.send(GnoblinCommand::SetFeature { name, on });
                }
                Command::ActivateWindow(id) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::Activate(id));
                }
                Command::MinimizeWindow(id) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::Minimize(id));
                }
                Command::SetVolume(v) => {
                    let _ = audio_tx.send(AudioMsg::Command(AudioCommand::SetVolume(v)));
                }
                Command::SetMuted(m) => {
                    let _ = audio_tx.send(AudioMsg::Command(AudioCommand::SetMuted(m)));
                }
                Command::SetStreamVolume { id, volume } => {
                    let _ = audio_tx.send(AudioMsg::Command(AudioCommand::SetStreamVolume {
                        id,
                        volume,
                    }));
                }
                Command::LaunchApp(id) => {
                    let _ = apps_tx.send(AppsCommand::Launch(id));
                }
                Command::MediaPlayPause => {
                    let _ = mpris_tx.send(MprisCommand::PlayPause);
                }
                Command::MediaNext => {
                    let _ = mpris_tx.send(MprisCommand::Next);
                }
                Command::MediaPrevious => {
                    let _ = mpris_tx.send(MprisCommand::Previous);
                }
            }
        }
    });

    let _ = shutdown_rx.await;
    consumer.abort();
    gnoblin.abort();
    battery.abort();
    router.abort();
    apps.abort();
    mpris.abort();
}
