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
mod bluetooth;
mod exec;
mod gnoblin;
mod mpris;
mod network;
mod notifd;
mod sysctl;
mod tray;

pub use audio::{AudioSnapshot, AudioStream};
pub use battery::BatterySnapshot;
pub use gnoblin::{GnoblinSnapshot, GnoblinWindow};
pub use apps::{AppEntry, AppsSnapshot};
pub use mpris::{MediaSnapshot, PlayerInfo};
pub use bluetooth::{BluetoothSnapshot, BtDevice};
pub use network::{AccessPointInfo, NetworkSnapshot};
pub use sysctl::{BrightnessSnapshot, PowerProfile, PowerSnapshot, SettingsSnapshot};
pub use notifd::{NotifdSnapshot, Notification};
pub use tray::{TrayIcon, TrayItem, TraySnapshot};

use audio::{AudioCommand, AudioMsg};
use gnoblin::GnoblinCommand;
use apps::AppsCommand;
use mpris::MprisCommand;
use network::NetworkCommand;
use bluetooth::BtCommand;
use sysctl::{BrightnessCommand, PowerCommand, SettingsCommand};

/// A state change from one of the services. Plain, thread-safe data only.
#[derive(Debug, Clone)]
pub enum ServiceEvent {
    Gnoblin(GnoblinSnapshot),
    Audio(AudioSnapshot),
    Battery(BatterySnapshot),
    Apps(apps::AppsSnapshot),
    Media(mpris::MediaSnapshot),
    Network(network::NetworkSnapshot),
    Bluetooth(bluetooth::BluetoothSnapshot),
    Brightness(sysctl::BrightnessSnapshot),
    Power(sysctl::PowerSnapshot),
    Settings(sysctl::SettingsSnapshot),
    Notifd(notifd::NotifdSnapshot),
    Tray(tray::TraySnapshot),
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
    /// exec: run a session verb (lock/logout/restart/shutdown/suspend). The
    /// SERVICE spawns the underlying command; UI components never run processes.
    Session(SessionVerb),
    /// exec: open a URI with the default handler (xdg-open).
    OpenUri(String),
    /// exec: copy text to the Wayland clipboard (wl-copy).
    CopyText(String),
    /// gnoblin: reload user scripts (org.gnoblin.Shell.ReloadScripts). Typed --
    /// the launcher's `:` command rows map to these variants, never raw argv.
    ReloadScripts,
    /// gnoblin: reload one extension by uuid (org.gnoblin.Shell.ReloadExtension).
    ReloadExtension(String),
    /// network: enable/disable Wi-Fi.
    SetWifiEnabled(bool),
    /// network: activate a known/open access point by ssid.
    ConnectWifi(String),
    /// bluetooth: power the adapter on/off.
    SetBluetoothPowered(bool),
    /// bluetooth: connect a device by address.
    ConnectBtDevice(String),
    /// bluetooth: disconnect a device by address.
    DisconnectBtDevice(String),
    /// brightness: set the backlight level (0.0..=1.0 of max).
    SetBrightness(f32),
    /// power: set the active power profile.
    SetPowerProfile(PowerProfile),
    /// settings: toggle the GNOME dark style.
    SetDarkStyle(bool),
    /// settings: toggle GNOME night light.
    SetNightLight(bool),
    /// notifd: set do-not-disturb (toasts suppressed, store still fills).
    SetDnd(bool),
    /// notifd: dismiss one notification by id (emits NotificationClosed).
    CloseNotification(u32),
    /// notifd: dismiss every stored notification.
    ClearNotifications,
    /// notifd: invoke a notification action (emits ActionInvoked).
    InvokeNotificationAction { id: u32, action_key: String },
    /// tray: primary-activate an item by address (left click).
    ActivateTrayItem(String),
    /// tray: secondary-activate an item by address (middle click).
    SecondaryActivateTrayItem(String),
}

/// A session-control verb, executed by the exec service (docs/FREYA-PLAN.md
/// section 5: loginctl / gnome-session-quit / systemctl).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionVerb {
    Lock,
    Logout,
    Restart,
    Shutdown,
    Suspend,
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
    let (network_tx, network_rx) = unbounded_channel::<NetworkCommand>();
    let network = tokio::spawn(network::run(event_tx.clone(), network_rx));
    let (bt_tx, bt_rx) = unbounded_channel::<BtCommand>();
    let bluetooth = tokio::spawn(bluetooth::run(event_tx.clone(), bt_rx));
    let (brightness_tx, brightness_rx) = unbounded_channel::<BrightnessCommand>();
    let brightness = tokio::spawn(sysctl::run_brightness(event_tx.clone(), brightness_rx));
    let (power_tx, power_rx) = unbounded_channel::<PowerCommand>();
    let power = tokio::spawn(sysctl::run_power(event_tx.clone(), power_rx));
    let (settings_tx, settings_rx) = unbounded_channel::<SettingsCommand>();
    let settings = tokio::spawn(sysctl::run_settings(event_tx.clone(), settings_rx));

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
                Command::Session(verb) => exec::session(verb),
                Command::OpenUri(uri) => exec::open_uri(&uri),
                Command::CopyText(text) => exec::copy_text(text),
                Command::ReloadScripts => {
                    let _ = gnoblin_tx.send(GnoblinCommand::ReloadScripts);
                }
                Command::ReloadExtension(uuid) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::ReloadExtension(uuid));
                }
                Command::SetWifiEnabled(on) => {
                    let _ = network_tx.send(NetworkCommand::SetEnabled(on));
                }
                Command::ConnectWifi(ssid) => {
                    let _ = network_tx.send(NetworkCommand::Connect(ssid));
                }
                Command::SetBluetoothPowered(on) => {
                    let _ = bt_tx.send(BtCommand::SetPowered(on));
                }
                Command::ConnectBtDevice(address) => {
                    let _ = bt_tx.send(BtCommand::Connect(address));
                }
                Command::DisconnectBtDevice(address) => {
                    let _ = bt_tx.send(BtCommand::Disconnect(address));
                }
                Command::SetBrightness(level) => {
                    let _ = brightness_tx.send(BrightnessCommand::Set(level));
                }
                Command::SetPowerProfile(profile) => {
                    let _ = power_tx.send(PowerCommand::Set(profile));
                }
                Command::SetDarkStyle(on) => {
                    let _ = settings_tx.send(SettingsCommand::SetDarkStyle(on));
                }
                Command::SetNightLight(on) => {
                    let _ = settings_tx.send(SettingsCommand::SetNightLight(on));
                }
                // Routed once the phase-6 notifd/tray service tasks land.
                other @ (Command::SetDnd(_)
                | Command::CloseNotification(_)
                | Command::ClearNotifications
                | Command::InvokeNotificationAction { .. }
                | Command::ActivateTrayItem(_)
                | Command::SecondaryActivateTrayItem(_)) => {
                    tracing::warn!("[services] command not yet routed: {other:?}");
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
    network.abort();
    bluetooth.abort();
    brightness.abort();
    power.abort();
    settings.abort();
}
