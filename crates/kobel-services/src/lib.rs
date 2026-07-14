//! kobel-services: system state providers (zbus/tokio on a side thread + pulse on
//! its own thread). Snapshots are PLAIN data pushed over a callback; this crate
//! NEVER depends on calloop or freya. See docs/FREYA-PLAN.md section 5.
//!
//! Twelve services: gnoblin (compositor link), audio (pipewire-pulse), battery
//! (UPower DisplayDevice), apps (desktop entries + inotify watch), bluetooth,
//! calendar (GNOME.Shell.CalendarServer), exec (session/uri/clipboard verbs),
//! mpris, network (NetworkManager), notifd (org.freedesktop.Notifications,
//! owns the bus name itself), sysctl (brightness/power/settings), tray (SNI).

use std::thread::JoinHandle;
use std::time::Duration;

use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::sync::oneshot;

mod apps;
mod audio;
mod battery;
mod bluetooth;
mod calendar;
mod exec;
mod gnoblin;
mod icons;
mod mpris;
mod network;
mod notifd;
mod sysctl;
#[cfg(feature = "tray")]
mod tray;

pub use apps::{AppEntry, AppsSnapshot};
pub use audio::{AudioSnapshot, AudioStream};
pub use battery::BatterySnapshot;
pub use bluetooth::{BluetoothSnapshot, BtDevice};
pub use calendar::{CalendarEvent, CalendarSnapshot};
pub use gnoblin::GnoblinSnapshot;
pub use mpris::{MediaSnapshot, PlayerInfo};
pub use network::{AccessPointInfo, NetworkSnapshot};
pub use notifd::{NotifdSnapshot, Notification};
pub use sysctl::{BrightnessSnapshot, PowerProfile, PowerSnapshot, SettingsSnapshot};
#[cfg(feature = "tray")]
pub use tray::{
    TrayCategory, TrayIcon, TrayItem, TrayMenu, TrayMenuDisposition, TrayMenuItem, TrayMenuItemKind, TrayProtocolItem,
    TraySnapshot, TrayStatus, TrayToggleKind, TrayToggleState, TrayTooltip,
};

use apps::AppsCommand;
use audio::{AudioCommand, AudioMsg};
use bluetooth::BtCommand;
use calendar::CalendarCommand;
use gnoblin::GnoblinCommand;
use mpris::MprisCommand;
use network::NetworkCommand;
use notifd::NotifdCommand;
use sysctl::{BrightnessCommand, PowerCommand, SettingsCommand};
#[cfg(feature = "tray")]
use tray::TrayCommand;

/// Axis reported to a StatusNotifierItem `Scroll` method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayScrollOrientation {
    Horizontal,
    Vertical,
}

#[cfg(feature = "tray")]
impl TrayScrollOrientation {
    fn as_dbus_str(self) -> &'static str {
        match self {
            Self::Horizontal => "horizontal",
            Self::Vertical => "vertical",
        }
    }
}

/// Deadline for one command's D-Bus round-trip inside a service's sequential
/// event loop (a `tokio::select!` processing one command/event at a time).
/// zbus method calls have no default timeout, so a hung external service
/// (NetworkManager, BlueZ, power-profiles-daemon, a stray tray app, an
/// unresponsive media player) would otherwise block that whole loop --
/// discovery, snapshot updates, and every other command -- indefinitely.
pub(crate) const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

/// Run `fut` under [`COMMAND_TIMEOUT`], logging (and swallowing) a timeout as
/// a warning so the caller's event loop always continues to the next
/// iteration -- one hung command degrades to "this one did nothing", never
/// "the whole service stalled". `label` is the service's log tag, e.g. "tray".
///
/// Shell shutdown is never delayed by an in-flight timeout: every service
/// task (except notifd, which gets its own graceful handshake) is torn down
/// via `JoinHandle::abort()` in [`run`]'s shutdown sequence, which cancels
/// the task at its next await point regardless of what it is currently
/// doing -- including sitting inside this function's `tokio::time::timeout`.
/// Verified directly: raising `COMMAND_TIMEOUT` cannot slow down `quit`.
pub(crate) async fn with_command_timeout<F>(label: &str, fut: F)
where
    F: Future<Output = ()>,
{
    if tokio::time::timeout(COMMAND_TIMEOUT, fut).await.is_err() {
        tracing::warn!("[{label}] command timed out after {COMMAND_TIMEOUT:?}");
    }
}

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
    #[cfg(feature = "tray")]
    Tray(tray::TraySnapshot),
    Calendar(calendar::CalendarSnapshot),
}

/// A request routed to the owning service. Fire-and-forget.
#[derive(Debug, Clone)]
pub enum Command {
    /// gnoblin: soft-reload the compositor shell integration.
    Reload,
    /// gnoblin: toggle a named compositor feature.
    SetFeature { name: String, on: bool },
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
    /// exec: run a session verb (lock/logout/restart/shutdown/suspend). The service
    /// owns process creation; callers send only the typed command.
    Session(SessionVerb),
    /// exec: open a URI with the default handler (xdg-open).
    OpenUri(String),
    /// exec: copy text to the Wayland clipboard (wl-copy).
    CopyText(String),
    /// gnoblin: reload user scripts (org.gnoblin.Shell.ReloadScripts).
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
    /// notifd: set do-not-disturb while continuing to store notifications.
    SetDnd(bool),
    /// notifd: dismiss one notification by id (emits NotificationClosed).
    CloseNotification(u32),
    /// notifd: dismiss every stored notification.
    ClearNotifications,
    /// notifd: invoke a notification action (emits ActionInvoked).
    InvokeNotificationAction { id: u32, action_key: String },
    /// tray: primary-activate an item with a screen-coordinate placement hint.
    ActivateTrayItem { address: String, x: i32, y: i32 },
    /// tray: secondary-activate an item with a screen-coordinate placement hint.
    SecondaryActivateTrayItem { address: String, x: i32, y: i32 },
    /// tray: ask an item to open its context menu at a screen-coordinate hint.
    ContextMenuTrayItem { address: String, x: i32, y: i32 },
    /// tray: forward a scroll gesture with its protocol orientation.
    ScrollTrayItem {
        address: String,
        delta: i32,
        orientation: TrayScrollOrientation,
    },
    /// tray: fire DBusMenu `AboutToShow` for a menu item before displaying it.
    TrayMenuAboutToShow { address: String, item_id: i32 },
    /// tray: send a DBusMenu `clicked` event for a menu item (proper timestamp
    /// supplied by the crate). `item_id` is the DBusMenu numeric id.
    TrayMenuClicked { address: String, item_id: i32 },
    /// calendar: query events for an epoch range `[since, until)`.
    SetCalendarRange { since: i64, until: i64 },
}

/// A session-control verb executed by the exec service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionVerb {
    Lock,
    Logout,
    Restart,
    Shutdown,
    Suspend,
}

/// One independently selectable system capability. UI processes request only the
/// providers they consume, so a small surface cannot accidentally claim a
/// process-global bus name or start unrelated background work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum ServiceCapability {
    Gnoblin = 1 << 0,
    Audio = 1 << 1,
    Battery = 1 << 2,
    Apps = 1 << 3,
    Media = 1 << 4,
    Network = 1 << 5,
    Bluetooth = 1 << 6,
    Brightness = 1 << 7,
    Power = 1 << 8,
    Settings = 1 << 9,
    Notifications = 1 << 10,
    Tray = 1 << 11,
    Calendar = 1 << 12,
    Exec = 1 << 13,
}

/// Capability set used by [`Services::spawn_with`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceSet(u16);

impl ServiceSet {
    #[cfg(feature = "tray")]
    const ALL: u16 = (1 << 14) - 1;
    #[cfg(not(feature = "tray"))]
    const ALL: u16 = ((1 << 14) - 1) & !(ServiceCapability::Tray as u16);

    /// No providers or command executors.
    pub const fn empty() -> Self {
        Self(0)
    }

    /// Every provider and command executor used by a complete shell.
    pub const fn all() -> Self {
        Self(Self::ALL)
    }

    /// Return a set containing `capability` in addition to the current entries.
    pub const fn with(self, capability: ServiceCapability) -> Self {
        Self(self.0 | capability as u16)
    }

    /// Whether this set includes `capability`.
    pub const fn contains(self, capability: ServiceCapability) -> bool {
        self.0 & capability as u16 != 0
    }
}

impl Default for ServiceSet {
    fn default() -> Self {
        Self::all()
    }
}

/// Entry point. `Services::spawn` starts the background threads and returns a
/// handle; drop the handle to shut everything down cleanly.
pub struct Services;

impl Services {
    /// Start the complete service suite.
    pub fn spawn(on_event: impl Fn(ServiceEvent) + Send + 'static) -> ServicesHandle {
        Self::spawn_with(ServiceSet::all(), on_event)
    }

    /// Start only the requested service capabilities.
    ///
    /// This matters for independently runnable UI processes: notification
    /// delivery owns `org.freedesktop.Notifications`, while audio, network and
    /// tray providers each carry their own external resources. A dock that needs
    /// only [`ServiceCapability::Apps`] and [`ServiceCapability::Media`] should
    /// not start or compete for any of those unrelated facilities.
    pub fn spawn_with(services: ServiceSet, on_event: impl Fn(ServiceEvent) + Send + 'static) -> ServicesHandle {
        #[cfg(not(feature = "tray"))]
        if services.contains(ServiceCapability::Tray) {
            tracing::warn!("[services] tray capability requested, but kobel-services was built without feature `tray`");
        }

        let (cmd_tx, cmd_rx) = unbounded_channel::<Command>();
        let (event_tx, event_rx) = unbounded_channel::<ServiceEvent>();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let (audio_tx, audio_thread) = if services.contains(ServiceCapability::Audio) {
            let (audio_tx, audio_rx) = std::sync::mpsc::channel::<AudioMsg>();
            let audio_event_tx = event_tx.clone();
            let audio_self_tx = audio_tx.clone();
            let audio_thread = std::thread::Builder::new()
                .name("kobel-audio".to_string())
                .spawn(move || audio::run(audio_event_tx, audio_self_tx, audio_rx))
                .expect("[services] failed to spawn audio thread");
            (Some(audio_tx), Some(audio_thread))
        } else {
            (None, None)
        };

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
                    services,
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
            audio_thread,
        }
    }
}

/// Live handle to the running services. Dropping it shuts down both threads.
pub struct ServicesHandle {
    cmd_tx: UnboundedSender<Command>,
    shutdown: Option<oneshot::Sender<()>>,
    audio_tx: Option<std::sync::mpsc::Sender<AudioMsg>>,
    tokio_thread: Option<JoinHandle<()>>,
    audio_thread: Option<JoinHandle<()>>,
}

impl ServicesHandle {
    /// Route a command to its owning enabled capability. Non-blocking; ignored if
    /// that provider is not part of this service set or has already stopped.
    pub fn send(&self, cmd: Command) {
        if self.cmd_tx.send(cmd).is_err() {
            tracing::warn!("[services] command dropped: services thread is gone");
        }
    }
}

impl Drop for ServicesHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(audio_tx) = &self.audio_tx {
            let _ = audio_tx.send(AudioMsg::Shutdown);
        }
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
    services: ServiceSet,
    mut cmd_rx: UnboundedReceiver<Command>,
    mut event_rx: UnboundedReceiver<ServiceEvent>,
    event_tx: UnboundedSender<ServiceEvent>,
    on_event: impl Fn(ServiceEvent) + Send + 'static,
    audio_tx: Option<std::sync::mpsc::Sender<AudioMsg>>,
    shutdown_rx: oneshot::Receiver<()>,
) {
    let consumer = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            on_event(event);
        }
    });

    let mut tasks = Vec::new();

    let (gnoblin_tx, gnoblin_rx) = unbounded_channel::<GnoblinCommand>();
    if services.contains(ServiceCapability::Gnoblin) {
        tasks.push(tokio::spawn(gnoblin::run(event_tx.clone(), gnoblin_rx)));
    }
    if services.contains(ServiceCapability::Battery) {
        tasks.push(tokio::spawn(battery::run(event_tx.clone())));
    }

    let (apps_tx, apps_rx) = unbounded_channel::<AppsCommand>();
    if services.contains(ServiceCapability::Apps) {
        tasks.push(tokio::spawn(apps::run(event_tx.clone(), apps_rx)));
    }
    let (mpris_tx, mpris_rx) = unbounded_channel::<MprisCommand>();
    if services.contains(ServiceCapability::Media) {
        tasks.push(tokio::spawn(mpris::run(event_tx.clone(), mpris_rx)));
    }
    let (network_tx, network_rx) = unbounded_channel::<NetworkCommand>();
    if services.contains(ServiceCapability::Network) {
        tasks.push(tokio::spawn(network::run(event_tx.clone(), network_rx)));
    }
    let (bt_tx, bt_rx) = unbounded_channel::<BtCommand>();
    if services.contains(ServiceCapability::Bluetooth) {
        tasks.push(tokio::spawn(bluetooth::run(event_tx.clone(), bt_rx)));
    }
    let (brightness_tx, brightness_rx) = unbounded_channel::<BrightnessCommand>();
    if services.contains(ServiceCapability::Brightness) {
        tasks.push(tokio::spawn(sysctl::run_brightness(event_tx.clone(), brightness_rx)));
    }
    let (power_tx, power_rx) = unbounded_channel::<PowerCommand>();
    if services.contains(ServiceCapability::Power) {
        tasks.push(tokio::spawn(sysctl::run_power(event_tx.clone(), power_rx)));
    }
    let (settings_tx, settings_rx) = unbounded_channel::<SettingsCommand>();
    if services.contains(ServiceCapability::Settings) {
        tasks.push(tokio::spawn(sysctl::run_settings(event_tx.clone(), settings_rx)));
    }
    #[cfg(feature = "tray")]
    let (tray_tx, tray_rx) = unbounded_channel::<TrayCommand>();
    #[cfg(feature = "tray")]
    if services.contains(ServiceCapability::Tray) {
        tasks.push(tokio::spawn(tray::run(event_tx.clone(), tray_rx)));
    }

    let (notifd_tx, notifd_rx) = unbounded_channel::<NotifdCommand>();
    let notifd = if services.contains(ServiceCapability::Notifications) {
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let task = tokio::spawn(notifd::run(event_tx.clone(), notifd_rx, shutdown_rx));
        Some((shutdown_tx, task))
    } else {
        None
    };

    let (calendar_tx, calendar_rx) = unbounded_channel::<CalendarCommand>();
    if services.contains(ServiceCapability::Calendar) {
        tasks.push(tokio::spawn(calendar::run(event_tx.clone(), calendar_rx)));
    }

    let router = tokio::spawn(async move {
        while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                Command::Reload if services.contains(ServiceCapability::Gnoblin) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::Reload);
                }
                Command::SetFeature { name, on } if services.contains(ServiceCapability::Gnoblin) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::SetFeature { name, on });
                }
                Command::SetVolume(v) if services.contains(ServiceCapability::Audio) => {
                    if let Some(audio_tx) = &audio_tx {
                        let _ = audio_tx.send(AudioMsg::Command(AudioCommand::SetVolume(v)));
                    }
                }
                Command::SetMuted(m) if services.contains(ServiceCapability::Audio) => {
                    if let Some(audio_tx) = &audio_tx {
                        let _ = audio_tx.send(AudioMsg::Command(AudioCommand::SetMuted(m)));
                    }
                }
                Command::SetStreamVolume { id, volume } if services.contains(ServiceCapability::Audio) => {
                    if let Some(audio_tx) = &audio_tx {
                        let _ = audio_tx.send(AudioMsg::Command(AudioCommand::SetStreamVolume { id, volume }));
                    }
                }
                Command::LaunchApp(id) if services.contains(ServiceCapability::Apps) => {
                    let _ = apps_tx.send(AppsCommand::Launch(id));
                }
                Command::MediaPlayPause if services.contains(ServiceCapability::Media) => {
                    let _ = mpris_tx.send(MprisCommand::PlayPause);
                }
                Command::MediaNext if services.contains(ServiceCapability::Media) => {
                    let _ = mpris_tx.send(MprisCommand::Next);
                }
                Command::MediaPrevious if services.contains(ServiceCapability::Media) => {
                    let _ = mpris_tx.send(MprisCommand::Previous);
                }
                Command::Session(verb) if services.contains(ServiceCapability::Exec) => exec::session(verb),
                Command::OpenUri(uri) if services.contains(ServiceCapability::Exec) => exec::open_uri(&uri),
                Command::CopyText(text) if services.contains(ServiceCapability::Exec) => exec::copy_text(text),
                Command::ReloadScripts if services.contains(ServiceCapability::Gnoblin) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::ReloadScripts);
                }
                Command::ReloadExtension(uuid) if services.contains(ServiceCapability::Gnoblin) => {
                    let _ = gnoblin_tx.send(GnoblinCommand::ReloadExtension(uuid));
                }
                Command::SetWifiEnabled(on) if services.contains(ServiceCapability::Network) => {
                    let _ = network_tx.send(NetworkCommand::SetEnabled(on));
                }
                Command::ConnectWifi(ssid) if services.contains(ServiceCapability::Network) => {
                    let _ = network_tx.send(NetworkCommand::Connect(ssid));
                }
                Command::SetBluetoothPowered(on) if services.contains(ServiceCapability::Bluetooth) => {
                    let _ = bt_tx.send(BtCommand::SetPowered(on));
                }
                Command::ConnectBtDevice(address) if services.contains(ServiceCapability::Bluetooth) => {
                    let _ = bt_tx.send(BtCommand::Connect(address));
                }
                Command::DisconnectBtDevice(address) if services.contains(ServiceCapability::Bluetooth) => {
                    let _ = bt_tx.send(BtCommand::Disconnect(address));
                }
                Command::SetBrightness(level) if services.contains(ServiceCapability::Brightness) => {
                    let _ = brightness_tx.send(BrightnessCommand::Set(level));
                }
                Command::SetPowerProfile(profile) if services.contains(ServiceCapability::Power) => {
                    let _ = power_tx.send(PowerCommand::Set(profile));
                }
                Command::SetDarkStyle(on) if services.contains(ServiceCapability::Settings) => {
                    let _ = settings_tx.send(SettingsCommand::SetDarkStyle(on));
                }
                Command::SetNightLight(on) if services.contains(ServiceCapability::Settings) => {
                    let _ = settings_tx.send(SettingsCommand::SetNightLight(on));
                }
                #[cfg(feature = "tray")]
                Command::ActivateTrayItem { address, x, y } if services.contains(ServiceCapability::Tray) => {
                    let _ = tray_tx.send(TrayCommand::Activate { address, x, y });
                }
                #[cfg(feature = "tray")]
                Command::SecondaryActivateTrayItem { address, x, y } if services.contains(ServiceCapability::Tray) => {
                    let _ = tray_tx.send(TrayCommand::SecondaryActivate { address, x, y });
                }
                #[cfg(feature = "tray")]
                Command::ContextMenuTrayItem { address, x, y } if services.contains(ServiceCapability::Tray) => {
                    let _ = tray_tx.send(TrayCommand::ContextMenu { address, x, y });
                }
                #[cfg(feature = "tray")]
                Command::ScrollTrayItem {
                    address,
                    delta,
                    orientation,
                } if services.contains(ServiceCapability::Tray) => {
                    let _ = tray_tx.send(TrayCommand::Scroll {
                        address,
                        delta,
                        orientation,
                    });
                }
                #[cfg(feature = "tray")]
                Command::TrayMenuAboutToShow { address, item_id } if services.contains(ServiceCapability::Tray) => {
                    let _ = tray_tx.send(TrayCommand::MenuAboutToShow { address, item_id });
                }
                #[cfg(feature = "tray")]
                Command::TrayMenuClicked { address, item_id } if services.contains(ServiceCapability::Tray) => {
                    let _ = tray_tx.send(TrayCommand::MenuClicked { address, item_id });
                }
                Command::SetDnd(on) if services.contains(ServiceCapability::Notifications) => {
                    let _ = notifd_tx.send(NotifdCommand::SetDnd(on));
                }
                Command::CloseNotification(id) if services.contains(ServiceCapability::Notifications) => {
                    let _ = notifd_tx.send(NotifdCommand::Close(id));
                }
                Command::ClearNotifications if services.contains(ServiceCapability::Notifications) => {
                    let _ = notifd_tx.send(NotifdCommand::ClearAll);
                }
                Command::InvokeNotificationAction { id, action_key }
                    if services.contains(ServiceCapability::Notifications) =>
                {
                    let _ = notifd_tx.send(NotifdCommand::InvokeAction { id, action_key });
                }
                Command::SetCalendarRange { since, until } if services.contains(ServiceCapability::Calendar) => {
                    let _ = calendar_tx.send(CalendarCommand::SetRange { since, until });
                }
                unsupported => {
                    tracing::debug!("[services] command ignored by selected capability set: {unsupported:?}");
                }
            }
        }
    });

    let _ = shutdown_rx.await;
    if let Some((notifd_shutdown, notifd_task)) = notifd {
        let _ = notifd_shutdown.send(());
        let _ = tokio::time::timeout(Duration::from_secs(3), notifd_task).await;
    }
    consumer.abort();
    router.abort();
    for task in tasks {
        task.abort();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{ServiceCapability, ServiceSet, Services};

    #[test]
    fn service_set_composes_independent_capabilities() {
        let set = ServiceSet::empty()
            .with(ServiceCapability::Apps)
            .with(ServiceCapability::Media);

        assert!(set.contains(ServiceCapability::Apps));
        assert!(set.contains(ServiceCapability::Media));
        assert!(!set.contains(ServiceCapability::Notifications));
        assert!(!set.contains(ServiceCapability::Audio));
    }

    #[test]
    fn all_services_matches_compiled_tray_provider() {
        assert_eq!(
            ServiceSet::all().contains(ServiceCapability::Tray),
            cfg!(feature = "tray"),
        );
    }

    #[test]
    fn empty_service_set_starts_and_stops_without_events() {
        let events = Arc::new(AtomicUsize::new(0));
        let observed = events.clone();
        let handle = Services::spawn_with(ServiceSet::empty(), move |_| {
            observed.fetch_add(1, Ordering::Relaxed);
        });

        drop(handle);

        assert_eq!(events.load(Ordering::Relaxed), 0);
    }
}
