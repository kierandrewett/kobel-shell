//! `org.gnoblin.Shell` proxy for script reloads, compositor feature toggles and
//! connection state driven by `NameOwnerChanged`.
//!
//! Window discovery and control do not belong to this D-Bus interface. They use
//! `zwlr_foreign_toplevel_manager_v1` through `kobel_wayland::Control`, whose
//! `toplevels` snapshot is the single source of truth.

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::fdo::DBusProxy;
use zbus::names::BusName;
use zbus::{Connection, proxy};

use crate::ServiceEvent;

const BUS: &str = "org.gnoblin.Shell";

/// Snapshot of the compositor link. `connected == false` => amber everywhere.
/// Ping-based liveness only -- see the module doc for why this carries no window
/// state.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GnoblinSnapshot {
    pub connected: bool,
}

pub(crate) enum GnoblinCommand {
    Reload,
    SetFeature { name: String, on: bool },
    ReloadScripts,
    ReloadExtension(String),
}

#[proxy(
    interface = "org.gnoblin.Shell",
    default_service = "org.gnoblin.Shell",
    default_path = "/org/gnoblin/Shell"
)]
pub(crate) trait Shell {
    fn reload(&self) -> zbus::Result<()>;
    fn set_feature(&self, name: &str, on: bool) -> zbus::Result<()>;
    fn reload_scripts(&self) -> zbus::Result<()>;
    fn reload_extension(&self, uuid: &str) -> zbus::Result<()>;
}

pub(crate) async fn run(events: UnboundedSender<ServiceEvent>, mut cmd_rx: UnboundedReceiver<GnoblinCommand>) {
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
    let mut name_changes: BoxStream<'static, _> = match dbus.receive_name_owner_changed_with_args(&[(0, BUS)]).await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[gnoblin] name-owner watch failed: {e}");
            futures_util::stream::pending().boxed()
        }
    };

    let mut proxy: Option<ShellProxy> = None;
    let mut connected = false;

    // Initial state: connect immediately if the service is already up.
    let already_up = dbus
        .name_has_owner(BusName::try_from(BUS).expect("valid bus name"))
        .await
        .unwrap_or(false);
    if already_up {
        if let Ok(p) = ShellProxy::new(&conn).await {
            proxy = Some(p);
            connected = true;
            tracing::info!("[gnoblin] connected");
        } else {
            tracing::warn!("[gnoblin] proxy build failed");
        }
    }
    emit(&events, connected);

    loop {
        tokio::select! {
            Some(signal) = name_changes.next() => {
                let appeared = signal
                    .args()
                    .map(|args| args.new_owner().as_ref().is_some())
                    .unwrap_or(false);
                if appeared {
                    match ShellProxy::new(&conn).await {
                        Ok(p) => {
                            proxy = Some(p);
                            connected = true;
                            tracing::info!("[gnoblin] connected");
                        }
                        Err(e) => tracing::warn!("[gnoblin] proxy build failed: {e}"),
                    }
                } else {
                    proxy = None;
                    connected = false;
                    tracing::info!("[gnoblin] disconnected");
                }
                emit(&events, connected);
            }
            Some(cmd) = cmd_rx.recv() => {
                // org.gnoblin.Shell calls have no default deadline, and this
                // loop also tracks bus ownership (the connected/disconnected
                // amber status) via name_changes -- a hung gnoblin would
                // otherwise freeze that status indicator too, right when the
                // user most needs it to be accurate.
                crate::with_command_timeout("gnoblin", handle_command(proxy.as_ref(), cmd)).await;
            }
            else => break,
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
        GnoblinCommand::ReloadScripts => proxy.reload_scripts().await,
        GnoblinCommand::ReloadExtension(uuid) => proxy.reload_extension(&uuid).await,
    };
    if let Err(e) = result {
        tracing::warn!("[gnoblin] command failed: {e}");
    }
}

fn emit(events: &UnboundedSender<ServiceEvent>, connected: bool) {
    let _ = events.send(ServiceEvent::Gnoblin(GnoblinSnapshot { connected }));
}
