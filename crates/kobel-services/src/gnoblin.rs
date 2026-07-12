//! org.gnoblin.Shell proxy: the compositor link. Faithful port of
//! ags/services/gnoblin.ts: window list, reload, feature toggles, and the
//! connected/amber state driven by a NameOwnerChanged watch.

use std::collections::HashMap;

use futures_util::stream::BoxStream;
use futures_util::{Stream, StreamExt};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::fdo::DBusProxy;
use zbus::names::BusName;
use zbus::zvariant::OwnedValue;
use zbus::{Connection, proxy};

use crate::ServiceEvent;

const BUS: &str = "org.gnoblin.Shell";

/// One compositor window. `app_id` decodes the on-bus `appId` key (see the .ts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GnoblinWindow {
    pub id: String,
    pub app_id: String,
    pub title: String,
    pub focused: bool,
    pub minimized: bool,
}

/// Snapshot of the compositor link. `connected == false` => amber everywhere.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GnoblinSnapshot {
    pub connected: bool,
    pub windows: Vec<GnoblinWindow>,
}

pub(crate) enum GnoblinCommand {
    Reload,
    SetFeature { name: String, on: bool },
    Activate(String),
    Minimize(String),
}

#[proxy(
    interface = "org.gnoblin.Shell",
    default_service = "org.gnoblin.Shell",
    default_path = "/org/gnoblin/Shell"
)]
trait Shell {
    fn reload(&self) -> zbus::Result<()>;
    fn set_feature(&self, name: &str, on: bool) -> zbus::Result<()>;
    fn activate_window(&self, id: &str) -> zbus::Result<()>;
    fn minimize_window(&self, id: &str) -> zbus::Result<()>;
    // ListWindows returns aa{sv}: an array of dicts with camelCase keys, matching
    // the .ts `deep_unpack() as [GnoblinWindow[]]` + `w.appId`/`w.focused` access.
    fn list_windows(&self) -> zbus::Result<Vec<HashMap<String, OwnedValue>>>;

    #[zbus(signal)]
    fn windows_changed(&self) -> zbus::Result<()>;
}

pub(crate) async fn run(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<GnoblinCommand>,
) {
    let conn = match Connection::session().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[gnoblin] no session bus: {e}");
            let _ = events.send(ServiceEvent::Gnoblin(GnoblinSnapshot::default()));
            return;
        }
    };

    let dbus = match DBusProxy::new(&conn).await {
        Ok(dbus) => dbus,
        Err(e) => {
            tracing::warn!("[gnoblin] DBus proxy: {e}");
            let _ = events.send(ServiceEvent::Gnoblin(GnoblinSnapshot::default()));
            return;
        }
    };

    // Watch only our bus name (server-side match on arg 0 == the name).
    let mut name_changes: BoxStream<'static, _> = match dbus
        .receive_name_owner_changed_with_args(&[(0, BUS)])
        .await
    {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[gnoblin] name-owner watch failed: {e}");
            futures_util::stream::pending().boxed()
        }
    };

    let mut proxy: Option<ShellProxy> = None;
    let mut windows_changed: Option<BoxStream<'static, WindowsChanged>> = None;
    let mut windows: Vec<GnoblinWindow> = Vec::new();
    let mut connected = false;

    // Initial state: connect immediately if the service is already up.
    let already_up = dbus
        .name_has_owner(BusName::try_from(BUS).expect("valid bus name"))
        .await
        .unwrap_or(false);
    if already_up {
        if let Some((p, wc)) = build_proxy(&conn).await {
            refresh_windows(&p, &mut windows).await;
            proxy = Some(p);
            windows_changed = Some(wc);
            connected = true;
            tracing::info!("[gnoblin] connected ({} windows)", windows.len());
        }
    }
    emit(&events, connected, &windows);

    loop {
        tokio::select! {
            Some(signal) = name_changes.next() => {
                let appeared = signal
                    .args()
                    .map(|args| args.new_owner().as_ref().is_some())
                    .unwrap_or(false);
                if appeared {
                    if let Some((p, wc)) = build_proxy(&conn).await {
                        refresh_windows(&p, &mut windows).await;
                        proxy = Some(p);
                        windows_changed = Some(wc);
                        connected = true;
                        tracing::info!("[gnoblin] connected ({} windows)", windows.len());
                        emit(&events, connected, &windows);
                    }
                } else {
                    proxy = None;
                    windows_changed = None;
                    connected = false;
                    tracing::info!("[gnoblin] disconnected");
                    // Keep last-known window list; the connected flag carries truth.
                    emit(&events, connected, &windows);
                }
            }
            changed = opt_next(&mut windows_changed) => {
                match changed {
                    Some(_) => {
                        if let Some(p) = proxy.as_ref() {
                            refresh_windows(p, &mut windows).await;
                            emit(&events, connected, &windows);
                        }
                    }
                    None => windows_changed = None,
                }
            }
            Some(cmd) = cmd_rx.recv() => {
                handle_command(proxy.as_ref(), cmd).await;
            }
            else => break,
        }
    }
}

async fn build_proxy(
    conn: &Connection,
) -> Option<(ShellProxy<'static>, BoxStream<'static, WindowsChanged>)> {
    let proxy = match ShellProxy::new(conn).await {
        Ok(proxy) => proxy,
        Err(e) => {
            tracing::warn!("[gnoblin] proxy build failed: {e}");
            return None;
        }
    };
    let windows_changed = match proxy.receive_windows_changed().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[gnoblin] WindowsChanged subscribe failed: {e}");
            return None;
        }
    };
    Some((proxy, windows_changed))
}

async fn refresh_windows(proxy: &ShellProxy<'_>, windows: &mut Vec<GnoblinWindow>) {
    match proxy.list_windows().await {
        Ok(list) => {
            let mut decoded = Vec::with_capacity(list.len());
            let mut skipped = 0usize;
            for entry in &list {
                match decode_window(entry) {
                    Some(win) => decoded.push(win),
                    None => skipped += 1,
                }
            }
            if skipped > 0 {
                tracing::warn!("[gnoblin] ListWindows: skipped {skipped} malformed entries");
            }
            *windows = decoded;
        }
        Err(e) => {
            // Stay on the last-known list; connected flag carries the truth.
            tracing::debug!("[gnoblin] ListWindows failed: {e}");
        }
    }
}

async fn handle_command(proxy: Option<&ShellProxy<'_>>, cmd: GnoblinCommand) {
    let Some(proxy) = proxy else {
        tracing::debug!("[gnoblin] command ignored: not connected");
        return;
    };
    let result = match cmd {
        GnoblinCommand::Reload => proxy.reload().await,
        GnoblinCommand::SetFeature { name, on } => proxy.set_feature(&name, on).await,
        GnoblinCommand::Activate(id) => proxy.activate_window(&id).await,
        GnoblinCommand::Minimize(id) => proxy.minimize_window(&id).await,
    };
    if let Err(e) = result {
        tracing::warn!("[gnoblin] command failed: {e}");
    }
}

fn emit(events: &UnboundedSender<ServiceEvent>, connected: bool, windows: &[GnoblinWindow]) {
    let _ = events.send(ServiceEvent::Gnoblin(GnoblinSnapshot {
        connected,
        windows: windows.to_vec(),
    }));
}

/// Decode one aa{sv} window entry. Required identity fields (`id`, `appId`) must
/// be present and non-empty; otherwise the row is dropped rather than targeting "".
fn decode_window(map: &HashMap<String, OwnedValue>) -> Option<GnoblinWindow> {
    let id = str_field(map, "id")?;
    let app_id = str_field(map, "appId")?;
    Some(GnoblinWindow {
        id,
        app_id,
        title: str_field(map, "title").unwrap_or_default(),
        focused: bool_field(map, "focused"),
        minimized: bool_field(map, "minimized"),
    })
}

fn str_field(map: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
    let value = map.get(key)?;
    let s = <&str>::try_from(value).ok()?;
    if s.is_empty() { None } else { Some(s.to_owned()) }
}

fn bool_field(map: &HashMap<String, OwnedValue>, key: &str) -> bool {
    map.get(key)
        .and_then(|value| bool::try_from(value).ok())
        .unwrap_or(false)
}

/// `Stream::next` over an `Option<Stream>`: pends forever when `None`, so a
/// missing signal stream simply never fires in a `select!`.
async fn opt_next<S>(stream: &mut Option<S>) -> Option<S::Item>
where
    S: Stream + Unpin,
{
    match stream {
        Some(stream) => stream.next().await,
        None => std::future::pending().await,
    }
}
