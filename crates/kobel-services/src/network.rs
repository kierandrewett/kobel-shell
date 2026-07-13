//! NetworkManager service: Wi-Fi state, access points, connect. CONTRACT TYPES
//! are stable; machinery lands with the phase-5 service task (docs/FREYA-PLAN.md
//! section 5).

use std::collections::HashMap;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::fdo::{DBusProxy, PropertiesChanged, PropertiesProxy};
use zbus::names::BusName;
use zbus::proxy::CacheProperties;
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value};
use zbus::{Connection, proxy};

use crate::ServiceEvent;

const NM: &str = "org.freedesktop.NetworkManager";
/// NM_DEVICE_TYPE_WIFI (NetworkManager.h).
const DEVICE_TYPE_WIFI: u32 = 2;
/// NM_802_11_AP_FLAGS_PRIVACY: association needs a key/password.
const AP_FLAG_PRIVACY: u32 = 0x1;
/// The QS Wi-Fi list shows at most this many APs.
const MAX_APS: usize = 6;

/// A request routed to the network task.
pub(crate) enum NetworkCommand {
    SetEnabled(bool),
    Connect(String),
}
/// One visible access point (deduped by ssid, strongest kept).
#[derive(Debug, Clone, PartialEq)]
pub struct AccessPointInfo {
    pub ssid: String,
    /// 0..=100 signal strength.
    pub strength: u8,
    pub active: bool,
    pub secured: bool,
}

/// Wi-Fi state snapshot. `available` false when there is no Wi-Fi device
/// (desktop case) -- the QS chip hides, matching the AGS behaviour.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NetworkSnapshot {
    pub available: bool,
    pub enabled: bool,
    pub active_ssid: Option<String>,
    /// Strength of the active AP, 0 when none.
    pub active_strength: u8,
    /// Up to ~6 strongest APs, deduped by ssid, active first.
    pub aps: Vec<AccessPointInfo>,
}

#[proxy(
    interface = "org.freedesktop.NetworkManager",
    default_service = "org.freedesktop.NetworkManager",
    default_path = "/org/freedesktop/NetworkManager"
)]
trait NetworkManager {
    fn get_devices(&self) -> zbus::Result<Vec<OwnedObjectPath>>;
    fn activate_connection(
        &self,
        connection: &ObjectPath<'_>,
        device: &ObjectPath<'_>,
        specific_object: &ObjectPath<'_>,
    ) -> zbus::Result<OwnedObjectPath>;
    fn add_and_activate_connection(
        &self,
        connection: HashMap<&str, HashMap<&str, Value<'_>>>,
        device: &ObjectPath<'_>,
        specific_object: &ObjectPath<'_>,
    ) -> zbus::Result<(OwnedObjectPath, OwnedObjectPath)>;

    #[zbus(property)]
    fn wireless_enabled(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn set_wireless_enabled(&self, value: bool) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.Device",
    default_service = "org.freedesktop.NetworkManager"
)]
trait Device {
    #[zbus(property)]
    fn device_type(&self) -> zbus::Result<u32>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.Device.Wireless",
    default_service = "org.freedesktop.NetworkManager"
)]
trait DeviceWireless {
    #[zbus(property)]
    fn access_points(&self) -> zbus::Result<Vec<OwnedObjectPath>>;
    #[zbus(property)]
    fn active_access_point(&self) -> zbus::Result<OwnedObjectPath>;
    #[zbus(signal)]
    fn access_point_added(&self, path: OwnedObjectPath) -> zbus::Result<()>;
    #[zbus(signal)]
    fn access_point_removed(&self, path: OwnedObjectPath) -> zbus::Result<()>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.AccessPoint",
    default_service = "org.freedesktop.NetworkManager"
)]
trait AccessPoint {
    #[zbus(property)]
    fn ssid(&self) -> zbus::Result<Vec<u8>>;
    #[zbus(property)]
    fn strength(&self) -> zbus::Result<u8>;
    #[zbus(property)]
    fn flags(&self) -> zbus::Result<u32>;
    #[zbus(property)]
    fn wpa_flags(&self) -> zbus::Result<u32>;
    #[zbus(property)]
    fn rsn_flags(&self) -> zbus::Result<u32>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.Settings",
    default_service = "org.freedesktop.NetworkManager",
    default_path = "/org/freedesktop/NetworkManager/Settings"
)]
trait Settings {
    fn list_connections(&self) -> zbus::Result<Vec<OwnedObjectPath>>;
}

#[proxy(
    interface = "org.freedesktop.NetworkManager.Settings.Connection",
    default_service = "org.freedesktop.NetworkManager"
)]
trait SettingsConnection {
    fn get_settings(&self) -> zbus::Result<HashMap<String, HashMap<String, OwnedValue>>>;
}

/// The strongest AP seen for one ssid during a scan.
struct ApRow {
    strength: u8,
    secured: bool,
    path: OwnedObjectPath,
}

/// Result of one scan: the snapshot, the active AP path (to drive the
/// per-AP Strength watch) and an ssid -> (strongest path, secured) index used
/// by ConnectWifi.
struct Scan {
    snapshot: NetworkSnapshot,
    active_ap_path: Option<OwnedObjectPath>,
    index: HashMap<String, (OwnedObjectPath, bool)>,
}

pub(crate) async fn run(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<NetworkCommand>,
) {
    let conn = match Connection::system().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[network] no system bus: {e}");
            let _ = events.send(ServiceEvent::Network(NetworkSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    // Desktop / NM-absent case: available=false once, then ignore commands.
    let nm_present = match DBusProxy::new(&conn).await {
        Ok(dbus) => dbus
            .name_has_owner(BusName::try_from(NM).expect("valid bus name"))
            .await
            .unwrap_or(false),
        Err(_) => false,
    };
    if !nm_present {
        tracing::info!("[network] NetworkManager absent; reporting available=false");
        let _ = events.send(ServiceEvent::Network(NetworkSnapshot::default()));
        while cmd_rx.recv().await.is_some() {}
        return;
    }

    let nm = match NetworkManagerProxy::builder(&conn)
        .cache_properties(CacheProperties::No)
        .build()
        .await
    {
        Ok(nm) => nm,
        Err(e) => {
            tracing::warn!("[network] NM proxy: {e}");
            let _ = events.send(ServiceEvent::Network(NetworkSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    let device_path = match find_wifi_device(&conn, &nm).await {
        Some(path) => path,
        None => {
            tracing::info!("[network] no wifi device; reporting available=false");
            let _ = events.send(ServiceEvent::Network(NetworkSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };
    tracing::info!("[network] wifi device: {}", device_path.as_str());

    let wireless = match DeviceWirelessProxy::builder(&conn)
        .path(device_path.clone().into_inner())
        .expect("valid device path")
        .cache_properties(CacheProperties::No)
        .build()
        .await
    {
        Ok(wireless) => wireless,
        Err(e) => {
            tracing::warn!("[network] wireless proxy: {e}");
            let _ = events.send(ServiceEvent::Network(NetworkSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    let mut scan = scan(&conn, &nm, &wireless).await;
    let mut last = scan.snapshot.clone();
    let mut index = std::mem::take(&mut scan.index);
    let mut active_ap = scan.active_ap_path.take();
    tracing::info!(
        "[network] initial: enabled={} active={:?} aps={}",
        last.enabled,
        last.active_ssid,
        last.aps.len()
    );
    let _ = events.send(ServiceEvent::Network(last.clone()));

    // WirelessEnabled (NM prop) changes: watched via the NM root object's
    // PropertiesChanged signal, which fires regardless of property caching
    // (a property-change stream would need caching, which this proxy disables).
    let nm_root =
        OwnedObjectPath::try_from("/org/freedesktop/NetworkManager").expect("valid NM path");
    let mut nm_changes = props_stream(&conn, Some(&nm_root)).await;
    // Device AP add/remove.
    let mut ap_added: BoxStream<'static, _> = match wireless.receive_access_point_added().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[network] AccessPointAdded watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };
    let mut ap_removed: BoxStream<'static, _> = match wireless.receive_access_point_removed().await
    {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[network] AccessPointRemoved watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };
    // Device-object properties: ActiveAccessPoint + ActiveConnection changes.
    let mut dev_changes = props_stream(&conn, Some(&device_path)).await;
    // Active AP properties: Strength updates. Rebuilt whenever the active AP path
    // changes (see refresh_and_emit).
    let mut active_changes = props_stream(&conn, active_ap.as_ref()).await;

    loop {
        tokio::select! {
            Some(_) = opt_next(&mut nm_changes) => {
                refresh_and_emit(&conn, &nm, &wireless, &events, &mut last, &mut index, &mut active_ap, &mut active_changes).await;
            }
            Some(_) = ap_added.next() => {
                refresh_and_emit(&conn, &nm, &wireless, &events, &mut last, &mut index, &mut active_ap, &mut active_changes).await;
            }
            Some(_) = ap_removed.next() => {
                refresh_and_emit(&conn, &nm, &wireless, &events, &mut last, &mut index, &mut active_ap, &mut active_changes).await;
            }
            Some(_) = opt_next(&mut dev_changes) => {
                refresh_and_emit(&conn, &nm, &wireless, &events, &mut last, &mut index, &mut active_ap, &mut active_changes).await;
            }
            Some(_) = opt_next(&mut active_changes) => {
                refresh_and_emit(&conn, &nm, &wireless, &events, &mut last, &mut index, &mut active_ap, &mut active_changes).await;
            }
            Some(cmd) = cmd_rx.recv() => {
                handle_command(&conn, &nm, &device_path, &index, cmd).await;
            }
            else => break,
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn refresh_and_emit(
    conn: &Connection,
    nm: &NetworkManagerProxy<'_>,
    wireless: &DeviceWirelessProxy<'_>,
    events: &UnboundedSender<ServiceEvent>,
    last: &mut NetworkSnapshot,
    index: &mut HashMap<String, (OwnedObjectPath, bool)>,
    active_ap: &mut Option<OwnedObjectPath>,
    active_changes: &mut Option<BoxStream<'static, PropertiesChanged>>,
) {
    let scan = scan(conn, nm, wireless).await;
    *index = scan.index;
    if scan.active_ap_path != *active_ap {
        *active_ap = scan.active_ap_path;
        *active_changes = props_stream(conn, active_ap.as_ref()).await;
    }
    if scan.snapshot != *last {
        *last = scan.snapshot.clone();
        let _ = events.send(ServiceEvent::Network(scan.snapshot));
    }
}

/// Read every property the snapshot needs, deduping APs by ssid.
async fn scan(
    conn: &Connection,
    nm: &NetworkManagerProxy<'_>,
    wireless: &DeviceWirelessProxy<'_>,
) -> Scan {
    let enabled = nm.wireless_enabled().await.unwrap_or(false);

    let active_ap_path = match wireless.active_access_point().await {
        Ok(path) if path.as_str() != "/" => Some(path),
        _ => None,
    };
    let mut active_ssid: Option<String> = None;
    let mut active_strength: u8 = 0;
    if let Some(path) = &active_ap_path {
        if let Some(ap) = ap_proxy(conn, path).await {
            active_ssid = ssid_string(&ap).await;
            active_strength = ap.strength().await.unwrap_or(0);
        }
    }

    let mut best: HashMap<String, ApRow> = HashMap::new();
    if let Ok(paths) = wireless.access_points().await {
        for path in paths {
            let Some(ap) = ap_proxy(conn, &path).await else {
                continue;
            };
            let Some(ssid) = ssid_string(&ap).await else {
                continue;
            };
            let strength = ap.strength().await.unwrap_or(0);
            let secured = ap_secured(&ap).await;
            best.entry(ssid)
                .and_modify(|row| {
                    if strength > row.strength {
                        row.strength = strength;
                        row.secured = secured;
                        row.path = path.clone();
                    }
                })
                .or_insert(ApRow {
                    strength,
                    secured,
                    path,
                });
        }
    }

    let mut index = HashMap::with_capacity(best.len());
    let mut aps = Vec::with_capacity(best.len());
    for (ssid, row) in best {
        let active = active_ssid.as_deref() == Some(ssid.as_str());
        index.insert(ssid.clone(), (row.path, row.secured));
        aps.push(AccessPointInfo {
            ssid,
            strength: row.strength,
            active,
            secured: row.secured,
        });
    }
    // Active first, then strength descending.
    aps.sort_by(|a, b| b.active.cmp(&a.active).then(b.strength.cmp(&a.strength)));
    aps.truncate(MAX_APS);

    Scan {
        snapshot: NetworkSnapshot {
            available: true,
            enabled,
            active_ssid,
            active_strength,
            aps,
        },
        active_ap_path,
        index,
    }
}

async fn handle_command(
    conn: &Connection,
    nm: &NetworkManagerProxy<'_>,
    device_path: &OwnedObjectPath,
    index: &HashMap<String, (OwnedObjectPath, bool)>,
    cmd: NetworkCommand,
) {
    match cmd {
        NetworkCommand::SetEnabled(on) => {
            if let Err(e) = nm.set_wireless_enabled(on).await {
                tracing::warn!("[network] SetWifiEnabled failed: {e}");
            }
        }
        NetworkCommand::Connect(ssid) => connect(conn, nm, device_path, index, &ssid).await,
    }
}

async fn connect(
    conn: &Connection,
    nm: &NetworkManagerProxy<'_>,
    device_path: &OwnedObjectPath,
    index: &HashMap<String, (OwnedObjectPath, bool)>,
    ssid: &str,
) {
    let Some((ap_path, secured)) = index.get(ssid) else {
        tracing::warn!("[network] connect: no visible AP for {ssid}");
        return;
    };

    // A saved connection wins: activate it against this device + AP.
    if let Some(conn_path) = find_connection(conn, ssid).await {
        match nm
            .activate_connection(&conn_path, device_path, ap_path)
            .await
        {
            Ok(_) => tracing::info!("[network] activating saved connection for {ssid}"),
            Err(e) => tracing::warn!("[network] ActivateConnection failed: {e}"),
        }
        return;
    }

    // Secured + unknown: password UX is out of scope (matches AGS).
    if *secured {
        tracing::info!("[network] no saved connection for {ssid}");
        return;
    }

    // Open AP: create + activate a minimal connection.
    match nm
        .add_and_activate_connection(open_settings(ssid), device_path, ap_path)
        .await
    {
        Ok(_) => tracing::info!("[network] added+activated open network {ssid}"),
        Err(e) => tracing::warn!("[network] AddAndActivateConnection failed: {e}"),
    }
}

/// Minimal `a{sa{sv}}` for an open (unsecured) network.
fn open_settings(ssid: &str) -> HashMap<&str, HashMap<&str, Value<'_>>> {
    let mut connection: HashMap<&str, Value<'_>> = HashMap::new();
    connection.insert("id", Value::from(ssid));
    connection.insert("type", Value::from("802-11-wireless"));
    let mut wifi: HashMap<&str, Value<'_>> = HashMap::new();
    wifi.insert("ssid", Value::from(ssid.as_bytes().to_vec()));
    wifi.insert("mode", Value::from("infrastructure"));
    let mut settings = HashMap::new();
    settings.insert("connection", connection);
    settings.insert("802-11-wireless", wifi);
    settings
}

/// The first NM device whose type is Wi-Fi.
async fn find_wifi_device(
    conn: &Connection,
    nm: &NetworkManagerProxy<'_>,
) -> Option<OwnedObjectPath> {
    let devices = nm.get_devices().await.ok()?;
    for path in devices {
        let dev = match DeviceProxy::builder(conn)
            .path(path.clone().into_inner())
            .ok()?
            .cache_properties(CacheProperties::No)
            .build()
            .await
        {
            Ok(dev) => dev,
            Err(_) => continue,
        };
        if dev.device_type().await.unwrap_or(0) == DEVICE_TYPE_WIFI {
            return Some(path);
        }
    }
    None
}

/// The saved connection whose 802-11-wireless ssid matches, if any.
async fn find_connection(conn: &Connection, ssid: &str) -> Option<OwnedObjectPath> {
    let settings = SettingsProxy::new(conn).await.ok()?;
    let connections = settings.list_connections().await.ok()?;
    for path in connections {
        let sc = match SettingsConnectionProxy::builder(conn).path(path.clone().into_inner()) {
            Ok(builder) => match builder.build().await {
                Ok(sc) => sc,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let Ok(map) = sc.get_settings().await else {
            continue;
        };
        if connection_ssid(&map).as_deref() == Some(ssid) {
            return Some(path);
        }
    }
    None
}

/// Extract the ssid from a connection's 802-11-wireless settings group.
fn connection_ssid(map: &HashMap<String, HashMap<String, OwnedValue>>) -> Option<String> {
    let ssid_val = map.get("802-11-wireless")?.get("ssid")?;
    let bytes = Vec::<u8>::try_from(ssid_val.clone()).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

async fn ap_proxy(conn: &Connection, path: &OwnedObjectPath) -> Option<AccessPointProxy<'static>> {
    AccessPointProxy::builder(conn)
        .path(path.clone().into_inner())
        .ok()?
        .cache_properties(CacheProperties::No)
        .build()
        .await
        .ok()
}

/// Non-empty ssid of an AP as a lossy UTF-8 string; None for hidden ssids.
async fn ssid_string(ap: &AccessPointProxy<'_>) -> Option<String> {
    let bytes = ap.ssid().await.ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

async fn ap_secured(ap: &AccessPointProxy<'_>) -> bool {
    let flags = ap.flags().await.unwrap_or(0);
    let wpa = ap.wpa_flags().await.unwrap_or(0);
    let rsn = ap.rsn_flags().await.unwrap_or(0);
    flags & AP_FLAG_PRIVACY != 0 || wpa != 0 || rsn != 0
}

/// A PropertiesChanged signal stream for one NM object path (detached from the
/// temporary proxy -- zbus signal streams own their subscription).
async fn props_stream(
    conn: &Connection,
    path: Option<&OwnedObjectPath>,
) -> Option<BoxStream<'static, PropertiesChanged>> {
    let path = path?;
    let props = PropertiesProxy::builder(conn)
        .destination(NM)
        .ok()?
        .path(path.clone().into_inner())
        .ok()?
        .build()
        .await
        .ok()?;
    props.receive_properties_changed().await.ok().map(StreamExt::boxed)
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
