//! UPower DisplayDevice (org.freedesktop.UPower). Reports battery presence,
//! percentage, charging state, and time-to-empty/full; re-snapshots on
//! PropertiesChanged. On a desktop (no battery) it emits present=false once and
//! stays quiet.

use futures_util::StreamExt;
use tokio::sync::mpsc::UnboundedSender;
use zbus::fdo::{DBusProxy, PropertiesProxy};
use zbus::names::{BusName, InterfaceName};
use zbus::proxy::CacheProperties;
use zbus::{Connection, proxy};

use crate::ServiceEvent;

const UPOWER: &str = "org.freedesktop.UPower";
const DISPLAY_DEVICE_PATH: &str = "/org/freedesktop/UPower/devices/DisplayDevice";
const DEVICE_INTERFACE: &str = "org.freedesktop.UPower.Device";

// UPower enum values (upower.h).
const KIND_BATTERY: u32 = 2;
const STATE_CHARGING: u32 = 1;

/// Snapshot of the UPower DisplayDevice (the aggregate battery view).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct BatterySnapshot {
    pub present: bool,
    pub percentage: f64,
    pub charging: bool,
    /// Raw UPower state (1=charging, 2=discharging, 4=fully charged, ...).
    pub state: u32,
    pub time_to_empty: i64,
    pub time_to_full: i64,
}

#[proxy(
    interface = "org.freedesktop.UPower.Device",
    default_service = "org.freedesktop.UPower",
    default_path = "/org/freedesktop/UPower/devices/DisplayDevice"
)]
trait UPowerDevice {
    #[zbus(property)]
    fn is_present(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn percentage(&self) -> zbus::Result<f64>;
    #[zbus(property)]
    fn state(&self) -> zbus::Result<u32>;
    #[zbus(property, name = "Type")]
    fn device_type(&self) -> zbus::Result<u32>;
    #[zbus(property)]
    fn time_to_empty(&self) -> zbus::Result<i64>;
    #[zbus(property)]
    fn time_to_full(&self) -> zbus::Result<i64>;
}

pub(crate) async fn run(events: UnboundedSender<ServiceEvent>) {
    let conn = match Connection::system().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[battery] no system bus: {e}");
            let _ = events.send(ServiceEvent::Battery(BatterySnapshot::default()));
            return;
        }
    };

    // Desktop case: UPower not on the bus -> present=false, then stay quiet.
    let upower_present = match DBusProxy::new(&conn).await {
        Ok(dbus) => dbus
            .name_has_owner(BusName::try_from(UPOWER).expect("valid bus name"))
            .await
            .unwrap_or(false),
        Err(_) => false,
    };
    if !upower_present {
        tracing::info!("[battery] UPower absent; reporting present=false");
        let _ = events.send(ServiceEvent::Battery(BatterySnapshot::default()));
        return;
    }

    // Read fresh each time (caching off) so post-signal reads never lag.
    let device = match UPowerDeviceProxy::builder(&conn)
        .cache_properties(CacheProperties::No)
        .build()
        .await
    {
        Ok(device) => device,
        Err(e) => {
            tracing::warn!("[battery] DisplayDevice proxy: {e}");
            let _ = events.send(ServiceEvent::Battery(BatterySnapshot::default()));
            return;
        }
    };

    let mut last = read_snapshot(&device).await;
    tracing::info!(
        "[battery] initial: present={} state={} {:.0}%",
        last.present,
        last.state,
        last.percentage
    );
    let _ = events.send(ServiceEvent::Battery(last.clone()));

    let props = match PropertiesProxy::builder(&conn)
        .destination(UPOWER)
        .and_then(|b| b.path(DISPLAY_DEVICE_PATH))
        .expect("valid destination/path")
        .build()
        .await
    {
        Ok(props) => props,
        Err(e) => {
            tracing::warn!("[battery] properties proxy: {e}");
            return;
        }
    };

    let iface = InterfaceName::try_from(DEVICE_INTERFACE).expect("valid interface");
    let mut changes = match props.receive_properties_changed().await {
        Ok(stream) => stream,
        Err(e) => {
            tracing::warn!("[battery] PropertiesChanged watch: {e}");
            return;
        }
    };

    while let Some(signal) = changes.next().await {
        // Only react to the Device interface's changes.
        if let Ok(args) = signal.args()
            && args.interface_name != iface {
                continue;
            }
        let snapshot = read_snapshot(&device).await;
        if snapshot != last {
            last = snapshot.clone();
            let _ = events.send(ServiceEvent::Battery(snapshot));
        }
    }
}

async fn read_snapshot(device: &UPowerDeviceProxy<'_>) -> BatterySnapshot {
    let is_present = device.is_present().await.unwrap_or(false);
    let kind = device.device_type().await.unwrap_or(0);
    if !(is_present && kind == KIND_BATTERY) {
        return BatterySnapshot::default();
    }
    let state = device.state().await.unwrap_or(0);
    BatterySnapshot {
        present: true,
        percentage: device.percentage().await.unwrap_or(0.0),
        charging: state == STATE_CHARGING,
        state,
        time_to_empty: device.time_to_empty().await.unwrap_or(0),
        time_to_full: device.time_to_full().await.unwrap_or(0),
    }
}
