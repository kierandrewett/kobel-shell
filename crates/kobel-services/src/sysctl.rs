//! Small system controls: brightness (logind SetBrightness + sysfs read),
//! power profiles (net.hadess.PowerProfiles), and the two GNOME settings the
//! shell toggles (dark style, night light). CONTRACT TYPES are stable;
//! machinery lands with the phase-5 service task (docs/FREYA-PLAN.md section 5).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use tokio::io::{AsyncBufReadExt, BufReader, Lines};
use tokio::process::{ChildStdout, Command};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::fdo::{DBusProxy, PropertiesChanged, PropertiesProxy};
use zbus::names::BusName;
use zbus::proxy::CacheProperties;
use zbus::{Connection, proxy};

use crate::ServiceEvent;

const BACKLIGHT_DIR: &str = "/sys/class/backlight";
const POWER_PROFILES: &str = "net.hadess.PowerProfiles";
const POWER_PROFILES_PATH: &str = "/net/hadess/PowerProfiles";

const IFACE_SCHEMA: &str = "org.gnome.desktop.interface";
const COLOR_SCHEME_KEY: &str = "color-scheme";
const COLOR_PLUGIN_SCHEMA: &str = "org.gnome.settings-daemon.plugins.color";
const NIGHT_LIGHT_KEY: &str = "night-light-enabled";

pub(crate) enum BrightnessCommand {
    Set(f32),
}

pub(crate) enum PowerCommand {
    Set(PowerProfile),
}

pub(crate) enum SettingsCommand {
    SetDarkStyle(bool),
    SetNightLight(bool),
}
/// Backlight snapshot. `available` false without a backlight device (desktops).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BrightnessSnapshot {
    pub available: bool,
    /// 0.0..=1.0 of max brightness.
    pub level: f32,
}

/// The active power profile, mirroring net.hadess.PowerProfiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PowerProfile {
    PowerSaver,
    #[default]
    Balanced,
    Performance,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PowerSnapshot {
    pub available: bool,
    pub profile: PowerProfile,
}

/// GNOME interface settings the QS chips drive.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SettingsSnapshot {
    pub dark_style: bool,
    pub night_light: bool,
}

#[proxy(
    interface = "org.freedesktop.login1.Session",
    default_service = "org.freedesktop.login1",
    default_path = "/org/freedesktop/login1/session/auto"
)]
trait LogindSession {
    fn set_brightness(&self, subsystem: &str, name: &str, value: u32) -> zbus::Result<()>;
}

#[proxy(
    interface = "net.hadess.PowerProfiles",
    default_service = "net.hadess.PowerProfiles",
    default_path = "/net/hadess/PowerProfiles"
)]
trait PowerProfiles {
    #[zbus(property)]
    fn active_profile(&self) -> zbus::Result<String>;
    #[zbus(property)]
    fn set_active_profile(&self, value: &str) -> zbus::Result<()>;
}

// ---- brightness -----------------------------------------------------------

/// Backlight task: sysfs read (2s poll -- sysfs has no reliable change signal,
/// permitted by docs/FREYA-PLAN.md section 5) + logind SetBrightness writes.
pub(crate) async fn run_brightness(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<BrightnessCommand>,
) {
    let device = match first_backlight() {
        Some(device) => device,
        None => {
            tracing::info!("[brightness] no backlight device; available=false");
            let _ = events.send(ServiceEvent::Brightness(BrightnessSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };
    let name = device
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_owned();
    let max = read_u64(&device.join("max_brightness")).unwrap_or(0);
    if max == 0 {
        tracing::warn!("[brightness] {name}: max_brightness unreadable; available=false");
        let _ = events.send(ServiceEvent::Brightness(BrightnessSnapshot::default()));
        while cmd_rx.recv().await.is_some() {}
        return;
    }
    tracing::info!("[brightness] device={name} max={max}");

    // logind Session proxy is only needed for writes; reads come from sysfs.
    let session = logind_session().await;

    let mut last_level = read_level(&device, max);
    let _ = events.send(ServiceEvent::Brightness(BrightnessSnapshot {
        available: true,
        level: last_level,
    }));

    let mut poll = tokio::time::interval(Duration::from_secs(2));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = poll.tick() => {
                let level = read_level(&device, max);
                if (level - last_level).abs() > f32::EPSILON {
                    last_level = level;
                    let _ = events.send(ServiceEvent::Brightness(BrightnessSnapshot {
                        available: true,
                        level,
                    }));
                }
            }
            cmd = cmd_rx.recv() => match cmd {
                Some(BrightnessCommand::Set(level)) => {
                    set_brightness(session.as_ref(), &name, level, max).await;
                }
                None => break,
            },
        }
    }
}

async fn logind_session() -> Option<LogindSessionProxy<'static>> {
    let conn = match Connection::system().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[brightness] no system bus for logind: {e}");
            return None;
        }
    };
    match LogindSessionProxy::new(&conn).await {
        Ok(session) => Some(session),
        Err(e) => {
            tracing::warn!("[brightness] logind session proxy: {e}");
            None
        }
    }
}

async fn set_brightness(
    session: Option<&LogindSessionProxy<'_>>,
    name: &str,
    level: f32,
    max: u64,
) {
    let Some(session) = session else {
        tracing::warn!("[brightness] SetBrightness ignored: no logind session");
        return;
    };
    let value = ((level.clamp(0.0, 1.0) * max as f32).round() as u32).min(max as u32);
    if let Err(e) = session.set_brightness("backlight", name, value).await {
        tracing::warn!("[brightness] SetBrightness failed: {e}");
    }
}

/// The first `/sys/class/backlight/*` device by sorted name.
fn first_backlight() -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(BACKLIGHT_DIR)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    entries.sort();
    entries.into_iter().next()
}

fn read_level(device: &Path, max: u64) -> f32 {
    let cur = read_u64(&device.join("brightness")).unwrap_or(0);
    (cur as f32 / max as f32).clamp(0.0, 1.0)
}

fn read_u64(path: &Path) -> Option<u64> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

// ---- power profiles -------------------------------------------------------

/// net.hadess.PowerProfiles task. Absent service -> available=false once.
pub(crate) async fn run_power(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<PowerCommand>,
) {
    let conn = match Connection::system().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[power] no system bus: {e}");
            let _ = events.send(ServiceEvent::Power(PowerSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    let present = match DBusProxy::new(&conn).await {
        Ok(dbus) => dbus
            .name_has_owner(BusName::try_from(POWER_PROFILES).expect("valid bus name"))
            .await
            .unwrap_or(false),
        Err(_) => false,
    };
    if !present {
        tracing::info!("[power] PowerProfiles absent; available=false");
        let _ = events.send(ServiceEvent::Power(PowerSnapshot::default()));
        while cmd_rx.recv().await.is_some() {}
        return;
    }

    let proxy = match PowerProfilesProxy::builder(&conn)
        .cache_properties(CacheProperties::No)
        .build()
        .await
    {
        Ok(proxy) => proxy,
        Err(e) => {
            tracing::warn!("[power] proxy: {e}");
            let _ = events.send(ServiceEvent::Power(PowerSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    let mut last = parse_profile(&proxy.active_profile().await.unwrap_or_default());
    tracing::info!("[power] initial: profile={last:?}");
    let _ = events.send(ServiceEvent::Power(PowerSnapshot {
        available: true,
        profile: last,
    }));

    // ActiveProfile changes via the Properties signal (cache-independent).
    let mut changes = power_changes(&conn).await;

    loop {
        tokio::select! {
            Some(_) = opt_next(&mut changes) => {
                let profile = parse_profile(&proxy.active_profile().await.unwrap_or_default());
                if profile != last {
                    last = profile;
                    let _ = events.send(ServiceEvent::Power(PowerSnapshot {
                        available: true,
                        profile,
                    }));
                }
            }
            cmd = cmd_rx.recv() => match cmd {
                Some(PowerCommand::Set(profile)) => {
                    if let Err(e) = proxy.set_active_profile(profile_str(profile)).await {
                        tracing::warn!("[power] SetPowerProfile failed: {e}");
                    }
                }
                None => break,
            },
        }
    }
}

async fn power_changes(conn: &Connection) -> Option<BoxStream<'static, PropertiesChanged>> {
    let props = PropertiesProxy::builder(conn)
        .destination(POWER_PROFILES)
        .ok()?
        .path(POWER_PROFILES_PATH)
        .ok()?
        .build()
        .await
        .ok()?;
    props
        .receive_properties_changed()
        .await
        .ok()
        .map(StreamExt::boxed)
}

fn parse_profile(value: &str) -> PowerProfile {
    match value {
        "power-saver" => PowerProfile::PowerSaver,
        "performance" => PowerProfile::Performance,
        _ => PowerProfile::Balanced,
    }
}

fn profile_str(profile: PowerProfile) -> &'static str {
    match profile {
        PowerProfile::PowerSaver => "power-saver",
        PowerProfile::Balanced => "balanced",
        PowerProfile::Performance => "performance",
    }
}

// ---- GNOME settings -------------------------------------------------------

type MonitorLines = Lines<BufReader<ChildStdout>>;

/// GNOME color-scheme + night-light task. Reads initial values and follows
/// `gsettings monitor` (subprocess per docs/FREYA-PLAN.md section 5). A missing
/// schema simply leaves its value at the default and never crashes.
pub(crate) async fn run_settings(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<SettingsCommand>,
) {
    let mut snap = SettingsSnapshot::default();
    if let Some(value) = gsettings_get(IFACE_SCHEMA, COLOR_SCHEME_KEY).await {
        snap.dark_style = parse_dark(&value);
    }
    if let Some(value) = gsettings_get(COLOR_PLUGIN_SCHEMA, NIGHT_LIGHT_KEY).await {
        snap.night_light = parse_bool(&value);
    }
    tracing::info!(
        "[settings] initial: dark_style={} night_light={}",
        snap.dark_style,
        snap.night_light
    );
    let _ = events.send(ServiceEvent::Settings(snap.clone()));

    // Keep the monitor children alive next to their line readers; kill_on_drop
    // tears them down when this task is aborted at shutdown.
    let (_dark_child, mut dark_lines) = spawn_monitor(IFACE_SCHEMA, COLOR_SCHEME_KEY);
    let (_nl_child, mut nl_lines) = spawn_monitor(COLOR_PLUGIN_SCHEMA, NIGHT_LIGHT_KEY);

    loop {
        tokio::select! {
            line = next_line(&mut dark_lines) => match line {
                Some(line) => if let Some(value) = monitor_value(&line) {
                    let dark = parse_dark(&value);
                    if dark != snap.dark_style {
                        snap.dark_style = dark;
                        let _ = events.send(ServiceEvent::Settings(snap.clone()));
                    }
                },
                None => dark_lines = None,
            },
            line = next_line(&mut nl_lines) => match line {
                Some(line) => if let Some(value) = monitor_value(&line) {
                    let night = parse_bool(&value);
                    if night != snap.night_light {
                        snap.night_light = night;
                        let _ = events.send(ServiceEvent::Settings(snap.clone()));
                    }
                },
                None => nl_lines = None,
            },
            cmd = cmd_rx.recv() => match cmd {
                Some(SettingsCommand::SetDarkStyle(on)) => {
                    gsettings_set(IFACE_SCHEMA, COLOR_SCHEME_KEY, if on { "prefer-dark" } else { "default" });
                }
                Some(SettingsCommand::SetNightLight(on)) => {
                    gsettings_set(COLOR_PLUGIN_SCHEMA, NIGHT_LIGHT_KEY, if on { "true" } else { "false" });
                }
                None => break,
            },
        }
    }
}

/// Spawn `gsettings monitor schema key`; returns the child (to keep alive) and
/// a line reader over its stdout. Both are `None` if the spawn fails.
fn spawn_monitor(schema: &str, key: &str) -> (Option<tokio::process::Child>, Option<MonitorLines>) {
    let mut child = match Command::new("gsettings")
        .args(["monitor", schema, key])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            tracing::warn!("[settings] gsettings monitor {schema} {key}: {e}");
            return (None, None);
        }
    };
    match child.stdout.take() {
        Some(stdout) => {
            let lines = BufReader::new(stdout).lines();
            (Some(child), Some(lines))
        }
        None => (None, None),
    }
}

/// Next line from an optional monitor; pends forever once the monitor ends.
async fn next_line(lines: &mut Option<MonitorLines>) -> Option<String> {
    match lines {
        Some(reader) => reader.next_line().await.ok().flatten(),
        None => std::future::pending().await,
    }
}

/// Detached `gsettings set schema key value` (fire-and-forget, reaped so it
/// never zombies -- same shape as exec.rs).
fn gsettings_set(schema: &str, key: &str, value: &str) {
    let mut cmd = Command::new("gsettings");
    cmd.args(["set", schema, key, value])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    match cmd.spawn() {
        Ok(mut child) => {
            tokio::spawn(async move {
                let _ = child.wait().await;
            });
        }
        Err(e) => tracing::warn!("[settings] gsettings set {key}: {e}"),
    }
}

/// `gsettings monitor` prints `key: value`; take the value.
fn monitor_value(line: &str) -> Option<String> {
    line.split_once(':').map(|(_, value)| value.trim().to_owned())
}

async fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let output = Command::new("gsettings")
        .args(["get", schema, key])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// color-scheme is `'default'` / `'prefer-dark'` / `'prefer-light'`.
fn parse_dark(value: &str) -> bool {
    value.contains("prefer-dark")
}

fn parse_bool(value: &str) -> bool {
    value.trim().trim_matches('\'').eq_ignore_ascii_case("true")
}

/// `Stream::next` over an `Option<Stream>`: pends forever when `None`.
async fn opt_next<S>(stream: &mut Option<S>) -> Option<S::Item>
where
    S: futures_util::Stream + Unpin,
{
    match stream {
        Some(stream) => stream.next().await,
        None => std::future::pending().await,
    }
}
