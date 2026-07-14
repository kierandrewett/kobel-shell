//! BlueZ service: adapter power + devices. CONTRACT TYPES are stable; machinery
//! lands with the phase-5 service task (docs/FREYA-PLAN.md section 5).

use std::collections::HashMap;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::fdo::{DBusProxy, ObjectManagerProxy};
use zbus::names::{BusName, OwnedInterfaceName};
use zbus::zvariant::{OwnedObjectPath, OwnedValue};
use zbus::{Connection, MatchRule, MessageStream, proxy};

use crate::ServiceEvent;

const BLUEZ: &str = "org.bluez";
const ADAPTER_IFACE: &str = "org.bluez.Adapter1";
const DEVICE_IFACE: &str = "org.bluez.Device1";

/// A request routed to the bluetooth task.
pub(crate) enum BtCommand {
    SetPowered(bool),
    Connect(String),
    Disconnect(String),
}
/// One known bluetooth device.
#[derive(Debug, Clone, PartialEq)]
pub struct BtDevice {
    /// Object-path-safe address, e.g. `AA:BB:CC:DD:EE:FF`.
    pub address: String,
    pub alias: String,
    pub connected: bool,
    pub paired: bool,
}

/// Bluetooth snapshot. `available` false when no adapter exists.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BluetoothSnapshot {
    pub available: bool,
    pub powered: bool,
    /// Paired/known devices, connected first.
    pub devices: Vec<BtDevice>,
}

#[proxy(interface = "org.bluez.Adapter1", default_service = "org.bluez")]
trait Adapter1 {
    #[zbus(property)]
    fn powered(&self) -> zbus::Result<bool>;
    #[zbus(property)]
    fn set_powered(&self, value: bool) -> zbus::Result<()>;
}

#[proxy(interface = "org.bluez.Device1", default_service = "org.bluez")]
trait Device1 {
    fn connect(&self) -> zbus::Result<()>;
    fn disconnect(&self) -> zbus::Result<()>;
}

pub(crate) async fn run(events: UnboundedSender<ServiceEvent>, mut cmd_rx: UnboundedReceiver<BtCommand>) {
    let conn = match Connection::system().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[bluetooth] no system bus: {e}");
            let _ = events.send(ServiceEvent::Bluetooth(BluetoothSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    // No BlueZ daemon (common on this desktop): available=false, then ignore.
    let bluez_present = match DBusProxy::new(&conn).await {
        Ok(dbus) => dbus
            .name_has_owner(BusName::try_from(BLUEZ).expect("valid bus name"))
            .await
            .unwrap_or(false),
        Err(_) => false,
    };
    if !bluez_present {
        tracing::info!("[bluetooth] BlueZ absent; reporting available=false");
        let _ = events.send(ServiceEvent::Bluetooth(BluetoothSnapshot::default()));
        while cmd_rx.recv().await.is_some() {}
        return;
    }

    let om = match ObjectManagerProxy::builder(&conn)
        .destination(BLUEZ)
        .and_then(|b| b.path("/"))
        .expect("valid destination/path")
        .build()
        .await
    {
        Ok(om) => om,
        Err(e) => {
            tracing::warn!("[bluetooth] ObjectManager proxy: {e}");
            let _ = events.send(ServiceEvent::Bluetooth(BluetoothSnapshot::default()));
            while cmd_rx.recv().await.is_some() {}
            return;
        }
    };

    let mut adapter_path: Option<OwnedObjectPath> = None;
    let mut dev_index: HashMap<String, OwnedObjectPath> = HashMap::new();
    let mut last = BluetoothSnapshot::default();

    // Baseline emit, then the real state from GetManagedObjects.
    let _ = events.send(ServiceEvent::Bluetooth(BluetoothSnapshot::default()));
    refresh(&om, &mut adapter_path, &mut dev_index, &mut last, &events).await;
    tracing::info!(
        "[bluetooth] initial: available={} powered={} devices={}",
        last.available,
        last.powered,
        last.devices.len()
    );

    let mut added: BoxStream<'static, _> = match om.receive_interfaces_added().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[bluetooth] InterfacesAdded watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };
    let mut removed: BoxStream<'static, _> = match om.receive_interfaces_removed().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[bluetooth] InterfacesRemoved watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };
    // Adapter1/Device1 property changes (Powered, Connected, Paired, ...).
    let mut props: BoxStream<'static, ()> = match props_stream(&conn).await {
        Some(stream) => stream,
        None => futures_util::stream::pending().boxed(),
    };

    loop {
        tokio::select! {
            Some(_) = added.next() => {
                refresh(&om, &mut adapter_path, &mut dev_index, &mut last, &events).await;
            }
            Some(_) = removed.next() => {
                refresh(&om, &mut adapter_path, &mut dev_index, &mut last, &events).await;
            }
            Some(_) = props.next() => {
                refresh(&om, &mut adapter_path, &mut dev_index, &mut last, &events).await;
            }
            Some(cmd) = cmd_rx.recv() => {
                // BlueZ D-Bus calls have no default deadline (zbus itself
                // implements none -- see device_action's note below); a hung
                // adapter (SetPowered) would otherwise block this whole
                // refresh loop indefinitely.
                crate::with_command_timeout(
                    "bluetooth",
                    handle_command(&conn, adapter_path.as_ref(), &dev_index, cmd),
                )
                .await;
            }
            else => break,
        }
    }
}

/// Snapshot from GetManagedObjects: first adapter (sorted path) + its power,
/// and the paired/connected devices sorted connected-first then alias.
async fn refresh(
    om: &ObjectManagerProxy<'_>,
    adapter_path: &mut Option<OwnedObjectPath>,
    dev_index: &mut HashMap<String, OwnedObjectPath>,
    last: &mut BluetoothSnapshot,
    events: &UnboundedSender<ServiceEvent>,
) {
    let objects = match om.get_managed_objects().await {
        Ok(objects) => objects,
        Err(e) => {
            tracing::debug!("[bluetooth] GetManagedObjects: {e}");
            return;
        }
    };

    // First adapter by sorted path (ManagedObjects order is unspecified).
    let mut adapters: Vec<(&OwnedObjectPath, &HashMap<String, OwnedValue>)> = objects
        .iter()
        .filter_map(|(path, ifaces)| iface_props(ifaces, ADAPTER_IFACE).map(|props| (path, props)))
        .collect();
    adapters.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
    let (available, powered) = match adapters.first() {
        Some((path, props)) => {
            *adapter_path = Some((*path).clone());
            (true, bool_prop(props, "Powered"))
        }
        None => {
            *adapter_path = None;
            (false, false)
        }
    };

    // Devices: paired or connected only.
    let mut device_objs: Vec<(&OwnedObjectPath, &HashMap<String, OwnedValue>)> = objects
        .iter()
        .filter_map(|(path, ifaces)| iface_props(ifaces, DEVICE_IFACE).map(|props| (path, props)))
        .collect();
    device_objs.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));

    let mut devices: Vec<BtDevice> = Vec::new();
    let mut index: HashMap<String, OwnedObjectPath> = HashMap::new();
    for (path, props) in device_objs {
        let connected = bool_prop(props, "Connected");
        let paired = bool_prop(props, "Paired");
        if !(connected || paired) {
            continue;
        }
        let Some(address) = str_prop(props, "Address") else {
            continue;
        };
        let alias = str_prop(props, "Alias").unwrap_or_else(|| address.clone());
        index.insert(address.clone(), (*path).clone());
        devices.push(BtDevice {
            address,
            alias,
            connected,
            paired,
        });
    }
    devices.sort_by(|a, b| b.connected.cmp(&a.connected).then_with(|| a.alias.cmp(&b.alias)));
    *dev_index = index;

    let snapshot = BluetoothSnapshot {
        available,
        powered,
        devices,
    };
    if snapshot != *last {
        *last = snapshot.clone();
        let _ = events.send(ServiceEvent::Bluetooth(snapshot));
    }
}

async fn handle_command(
    conn: &Connection,
    adapter_path: Option<&OwnedObjectPath>,
    dev_index: &HashMap<String, OwnedObjectPath>,
    cmd: BtCommand,
) {
    match cmd {
        BtCommand::SetPowered(on) => {
            let Some(path) = adapter_path else {
                tracing::debug!("[bluetooth] SetPowered ignored: no adapter");
                return;
            };
            let adapter = match Adapter1Proxy::builder(conn).path(path.clone().into_inner()) {
                Ok(builder) => match builder.build().await {
                    Ok(adapter) => adapter,
                    Err(e) => {
                        tracing::warn!("[bluetooth] adapter proxy: {e}");
                        return;
                    }
                },
                Err(e) => {
                    tracing::warn!("[bluetooth] adapter path: {e}");
                    return;
                }
            };
            if let Err(e) = adapter.set_powered(on).await {
                tracing::warn!("[bluetooth] SetPowered failed: {e}");
            }
        }
        BtCommand::Connect(address) => device_action(conn, dev_index, &address, true),
        BtCommand::Disconnect(address) => device_action(conn, dev_index, &address, false),
    }
}

/// Connect/Disconnect a device. Runs on its own task (NOT awaited inline in
/// the main select! loop): zbus itself implements no default reply timeout
/// for method calls (confirmed against zbus's own source -- call_method has
/// no deadline of its own), so without this isolation a stuck BlueZ
/// connect/disconnect would otherwise block the refresh loop indefinitely.
/// A generous 30s bound (real pairing/reconnect handshakes can legitimately
/// take several seconds) still catches a genuinely wedged call rather than
/// leaking the task and its connection/proxy clones forever.
const DEVICE_ACTION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

fn device_action(conn: &Connection, dev_index: &HashMap<String, OwnedObjectPath>, address: &str, connect: bool) {
    let verb = if connect { "connect" } else { "disconnect" };
    let Some(path) = dev_index.get(address) else {
        tracing::warn!("[bluetooth] {verb} target not found: {address}");
        return;
    };
    let conn = conn.clone();
    let path = path.clone();
    let address = address.to_owned();
    tokio::spawn(async move {
        let device = match Device1Proxy::builder(&conn).path(path.into_inner()) {
            Ok(builder) => match builder.build().await {
                Ok(device) => device,
                Err(e) => {
                    tracing::warn!("[bluetooth] device proxy: {e}");
                    return;
                }
            },
            Err(e) => {
                tracing::warn!("[bluetooth] device path: {e}");
                return;
            }
        };
        let call = async {
            if connect {
                device.connect().await
            } else {
                device.disconnect().await
            }
        };
        match tokio::time::timeout(DEVICE_ACTION_TIMEOUT, call).await {
            Ok(Ok(())) => tracing::info!("[bluetooth] {verb} {address} ok"),
            Ok(Err(e)) => tracing::warn!("[bluetooth] {verb} {address} failed: {e}"),
            Err(_) => tracing::warn!("[bluetooth] {verb} {address} timed out after {DEVICE_ACTION_TIMEOUT:?}"),
        }
    });
}

/// A stream that fires once per BlueZ `PropertiesChanged` signal (content
/// ignored; every hit triggers a full GetManagedObjects refresh).
async fn props_stream(conn: &Connection) -> Option<BoxStream<'static, ()>> {
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender(BLUEZ)
        .ok()?
        .interface("org.freedesktop.DBus.Properties")
        .ok()?
        .member("PropertiesChanged")
        .ok()?
        .build();
    let stream = match MessageStream::for_match_rule(rule, conn, Some(32)).await {
        Ok(stream) => stream,
        Err(e) => {
            tracing::warn!("[bluetooth] PropertiesChanged watch: {e}");
            return None;
        }
    };
    Some(stream.map(|_| ()).boxed())
}

/// The property map for `name` within one object's interface set.
fn iface_props<'a>(
    ifaces: &'a HashMap<OwnedInterfaceName, HashMap<String, OwnedValue>>,
    name: &str,
) -> Option<&'a HashMap<String, OwnedValue>> {
    ifaces
        .iter()
        .find(|(iface, _)| iface.as_str() == name)
        .map(|(_, props)| props)
}

fn bool_prop(props: &HashMap<String, OwnedValue>, key: &str) -> bool {
    props
        .get(key)
        .and_then(|value| bool::try_from(value).ok())
        .unwrap_or(false)
}

fn str_prop(props: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
    let value = props.get(key)?;
    <&str>::try_from(value).ok().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use zbus::names::OwnedInterfaceName;
    use zbus::zvariant::Value;

    use super::*;

    fn owned(v: impl Into<Value<'static>>) -> OwnedValue {
        OwnedValue::try_from(v.into()).expect("value converts")
    }

    #[test]
    fn iface_props_finds_the_named_interface() {
        let mut ifaces: HashMap<OwnedInterfaceName, HashMap<String, OwnedValue>> = HashMap::new();
        let mut dev_props = HashMap::new();
        dev_props.insert("Connected".to_string(), owned(true));
        ifaces.insert(OwnedInterfaceName::try_from("org.bluez.Device1").unwrap(), dev_props);

        let found = iface_props(&ifaces, "org.bluez.Device1");
        assert!(found.is_some());
        assert!(bool_prop(found.unwrap(), "Connected"));
    }

    #[test]
    fn iface_props_none_for_an_absent_interface() {
        let ifaces: HashMap<OwnedInterfaceName, HashMap<String, OwnedValue>> = HashMap::new();
        assert!(iface_props(&ifaces, "org.bluez.Device1").is_none());
    }

    #[test]
    fn bool_prop_defaults_to_false_when_missing_or_wrong_type() {
        let mut props = HashMap::new();
        props.insert("Paired".to_string(), owned(true));
        props.insert("Name".to_string(), owned("headset"));
        assert!(bool_prop(&props, "Paired"));
        assert!(!bool_prop(&props, "Missing"));
        // Wrong type (a string where a bool is expected) also defaults false
        // rather than panicking.
        assert!(!bool_prop(&props, "Name"));
    }

    #[test]
    fn str_prop_returns_none_when_missing_or_wrong_type() {
        let mut props = HashMap::new();
        props.insert("Name".to_string(), owned("Pixel Buds"));
        props.insert("Connected".to_string(), owned(true));
        assert_eq!(str_prop(&props, "Name"), Some("Pixel Buds".to_string()));
        assert_eq!(str_prop(&props, "Missing"), None);
        assert_eq!(str_prop(&props, "Connected"), None);
    }
}
