//! Notification daemon: WE OWN org.freedesktop.Notifications (the AGS AstalNotifd
//! replacement, docs/FREYA-PLAN.md section 5). A zbus SERVER interface at
//! /org/freedesktop/Notifications backs the contract types below.
//!
//! Ownership handshake: we try to grab the well-known name WITHOUT replacement
//! first. If it is held (gnoblin or gnome-shell), we ask the gnoblin compositor
//! to `SetFeature("notifications", false)` -- which frees the name in a gnoblin
//! session -- then retry for a few seconds. On a plain host desktop gnome-shell
//! keeps the name; we log once, stay quiet, and run unserved (the persisted
//! store still drives the drawer, but no external Notify calls arrive). On
//! shutdown the name is released and the feature handed back.
//!
//! The store is the source of truth: newest-first, capped at 50, persisted as
//! JSON under $XDG_STATE_HOME/kobel/notifications.json (do-not-disturb included).
//! Every mutation pushes a fresh `ServiceEvent::Notifd` snapshot.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;
use tokio::sync::Notify;
use zbus::fdo::RequestNameFlags;
use zbus::object_server::SignalEmitter;
use zbus::zvariant::OwnedValue;
use zbus::{Connection, interface};

use crate::ServiceEvent;
use crate::gnoblin::ShellProxy;

const BUS: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
/// Newest-first ring cap; matches the AstalNotifd-era ~50 history depth.
const CAP: usize = 50;
/// org.freedesktop.Notifications urgency level 2 == critical.
const URGENCY_CRITICAL: u8 = 2;
/// NotificationClosed reason: dismissed by the user (UI close / clear / an
/// action that closes a non-resident notification). Spec 1.2 table.
const REASON_DISMISSED: u32 = 2;
/// NotificationClosed reason: closed via the CloseNotification method call.
const REASON_CLOSED: u32 = 3;
/// Name-acquisition retry budget after asking gnoblin to release the name.
const ACQUIRE_RETRIES: u32 = 10;
const ACQUIRE_INTERVAL: Duration = Duration::from_millis(500);
/// Debounce window: a burst of store mutations coalesces into one disk write.
const PERSIST_DEBOUNCE: Duration = Duration::from_millis(500);

/// One notification, mirroring the org.freedesktop.Notifications Notify args the
/// shell renders.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    /// Server-assigned id (returned from Notify, used by CloseNotification).
    pub id: u32,
    pub app_name: String,
    /// Themed icon name or file path from app_icon / image hints, if any.
    pub app_icon: Option<String>,
    pub summary: String,
    pub body: String,
    /// (action_key, label) pairs.
    pub actions: Vec<(String, String)>,
    /// True for critical (urgency 2) notifications the UI should not auto-expire.
    pub critical: bool,
    /// Unix seconds at receipt.
    pub time: i64,
}

/// The notification store + do-not-disturb flag. `serving` is false until the
/// bus name is actually owned (e.g. outside a gnoblin session).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NotifdSnapshot {
    pub serving: bool,
    pub dnd: bool,
    /// Newest first, capped (~50, persisted across restarts).
    pub notifications: Vec<Notification>,
}

/// A store mutation routed from the UI (docs/FREYA-PLAN.md section 5). External
/// D-Bus Notify/CloseNotification calls land on the server interface instead.
pub(crate) enum NotifdCommand {
    /// Toggle do-not-disturb (toasts suppressed by the UI; the store still fills).
    SetDnd(bool),
    /// Dismiss one notification by id (user action -> reason "dismissed").
    Close(u32),
    /// Dismiss every stored notification in one snapshot.
    ClearAll,
    /// Invoke an action: emit ActionInvoked, then close unless the notification
    /// is resident.
    InvokeAction { id: u32, action_key: String },
}

// ---- store ----------------------------------------------------------------

/// A stored notification plus the private `resident` bit (the `resident` hint).
/// Residency is NOT part of the public snapshot: it only governs whether an
/// invoked action auto-closes the notification, independent of `critical`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct StoredNotif {
    #[serde(flatten)]
    notif: Notification,
    #[serde(default)]
    resident: bool,
}

/// On-disk shape ($XDG_STATE_HOME/kobel/notifications.json). `serving` is runtime
/// state and never persisted.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Persisted {
    #[serde(default)]
    dnd: bool,
    #[serde(default)]
    notifications: Vec<StoredNotif>,
}

/// Newest-first, capped notification store with disk persistence. Pure logic --
/// no D-Bus -- so it is exercised directly by the unit tests.
#[derive(Debug)]
struct Store {
    path: PathBuf,
    /// Next monotonic id to hand out; continues past the max loaded id.
    next_id: u32,
    /// Whether we own the bus name (drives the snapshot `serving` flag).
    serving: bool,
    dnd: bool,
    /// Newest first.
    items: Vec<StoredNotif>,
    /// Set on any mutation; cleared when the debounce writer takes a snapshot.
    /// Coalesces a burst of mutations into a single disk write.
    dirty: bool,
    /// Wakes the debounce writer when the store becomes dirty. `notify_one` is
    /// non-blocking, so signaling it while holding the store lock is safe.
    wake: Arc<Notify>,
}

impl Store {
    /// Load persisted state (or start empty). `next_id` continues after the
    /// greatest id seen on disk so restarts never reuse an id.
    fn load(path: PathBuf) -> Self {
        let persisted = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| match serde_json::from_str::<Persisted>(&raw) {
                Ok(parsed) => Some(parsed),
                Err(e) => {
                    tracing::warn!("[notifd] ignoring corrupt store {}: {e}", path.display());
                    None
                }
            })
            .unwrap_or_default();
        let next_id = persisted
            .notifications
            .iter()
            .map(|it| it.notif.id)
            .max()
            .map(|m| m.saturating_add(1))
            .unwrap_or(1);
        Store {
            path,
            next_id,
            serving: false,
            dnd: persisted.dnd,
            items: persisted.notifications,
            dirty: false,
            wake: Arc::new(Notify::new()),
        }
    }

    /// Ingest a Notify. `replaces_id` is honored only when it names a currently
    /// stored notification; otherwise a fresh monotonic id is assigned so a
    /// client cannot inject arbitrary ids. Returns the assigned id.
    fn ingest(&mut self, replaces_id: u32, mut notif: Notification, resident: bool) -> u32 {
        let replaces = replaces_id != 0 && self.items.iter().any(|it| it.notif.id == replaces_id);
        let id = if replaces {
            replaces_id
        } else {
            let id = self.next_id;
            self.next_id = self.next_id.saturating_add(1);
            id
        };
        notif.id = id;
        self.items.retain(|it| it.notif.id != id);
        self.items.insert(0, StoredNotif { notif, resident });
        self.items.truncate(CAP);
        self.mark_dirty();
        id
    }

    /// Remove a notification by id. Returns whether it existed.
    fn close(&mut self, id: u32) -> bool {
        let before = self.items.len();
        self.items.retain(|it| it.notif.id != id);
        let removed = self.items.len() != before;
        if removed {
            self.mark_dirty();
        }
        removed
    }

    /// Remove every notification, returning the ids that were present (for
    /// per-id NotificationClosed signals).
    fn clear(&mut self) -> Vec<u32> {
        let ids: Vec<u32> = self.items.iter().map(|it| it.notif.id).collect();
        if !ids.is_empty() {
            self.items.clear();
            self.mark_dirty();
        }
        ids
    }

    /// Set do-not-disturb. Returns whether the flag actually changed.
    fn set_dnd(&mut self, on: bool) -> bool {
        if self.dnd == on {
            return false;
        }
        self.dnd = on;
        self.mark_dirty();
        true
    }

    /// `Some(resident)` if the notification exists; `None` otherwise.
    fn residency(&self, id: u32) -> Option<bool> {
        self.items.iter().find(|it| it.notif.id == id).map(|it| it.resident)
    }

    /// Snapshot for the UI. While unserved (name held elsewhere, e.g. gnome-shell
    /// on a host desktop) the notifications are suppressed: no Notify calls reach
    /// us there, so surfacing stale persisted entries would be wrong. The items
    /// stay loaded for id continuity and become visible once we own the name.
    fn snapshot(&self) -> NotifdSnapshot {
        NotifdSnapshot {
            serving: self.serving,
            dnd: self.dnd,
            notifications: if self.serving {
                self.items.iter().map(|it| it.notif.clone()).collect()
            } else {
                Vec::new()
            },
        }
    }

    /// Mark the store dirty and wake the debounce writer. The writer coalesces
    /// a burst of these into one disk write (~500ms). `notify_one` is a cheap,
    /// non-blocking signal, safe to call while the store lock is held.
    fn mark_dirty(&mut self) {
        self.dirty = true;
        self.wake.notify_one();
    }

    /// If a write is pending, clear the dirty flag and return the path plus a
    /// cloned on-disk snapshot to serialize OUTSIDE the lock. `None` when clean,
    /// so a redundant flush never touches the filesystem.
    fn take_dirty(&mut self) -> Option<(PathBuf, Persisted)> {
        if !self.dirty {
            return None;
        }
        self.dirty = false;
        Some((
            self.path.clone(),
            Persisted {
                dnd: self.dnd,
                notifications: self.items.clone(),
            },
        ))
    }
}

/// Serialize a persisted snapshot to disk. Best-effort: failures are logged,
/// never fatal. Callers run this on a `spawn_blocking` thread (see
/// [`flush_store`]) so the runtime worker is never blocked on the filesystem.
fn write_persisted(path: &Path, persisted: &Persisted) {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!("[notifd] cannot create state dir {}: {e}", parent.display());
            return;
        }
    }
    // Crash-safe: write a sibling temp file then rename over the target, so a
    // crash or full disk can never truncate the sole store (same pattern as the
    // launcher frecency store).
    let tmp = path.with_extension("json.tmp");
    match serde_json::to_string_pretty(persisted) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&tmp, json) {
                tracing::warn!("[notifd] cannot write store temp {}: {e}", tmp.display());
                return;
            }
            if let Err(e) = std::fs::rename(&tmp, path) {
                tracing::warn!("[notifd] cannot commit store {}: {e}", path.display());
                let _ = std::fs::remove_file(&tmp);
            }
        }
        Err(e) => tracing::warn!("[notifd] cannot serialize store: {e}"),
    }
}

/// The single debounced persistence writer. Waits for a dirty signal, coalesces
/// the rest of the burst over [`PERSIST_DEBOUNCE`], then flushes once. Every disk
/// write happens here, so nothing races the final shutdown flush: on the
/// shutdown signal it flushes the latest snapshot immediately and exits.
async fn persist_loop(
    store: Arc<Mutex<Store>>,
    wake: Arc<Notify>,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    loop {
        tokio::select! {
            biased;
            _ = &mut shutdown_rx => {
                flush_store(&store).await;
                return;
            }
            _ = wake.notified() => {}
        }
        // Coalesce: absorb the rest of the burst, but cut the wait short on
        // shutdown so the final state is flushed promptly.
        tokio::select! {
            biased;
            _ = &mut shutdown_rx => {
                flush_store(&store).await;
                return;
            }
            _ = tokio::time::sleep(PERSIST_DEBOUNCE) => {}
        }
        flush_store(&store).await;
    }
}

/// Flush a pending write if the store is dirty. The snapshot is cloned under the
/// lock and released before the blocking `std::fs::write`, which runs via
/// `spawn_blocking`. Called only from [`persist_loop`], keeping all writes
/// serialized in one task.
async fn flush_store(store: &Arc<Mutex<Store>>) {
    let pending = store.lock().take_dirty();
    let Some((path, persisted)) = pending else {
        return;
    };
    let _ = tokio::task::spawn_blocking(move || write_persisted(&path, &persisted)).await;
}

// ---- zbus server interface ------------------------------------------------

/// The exported org.freedesktop.Notifications object. Holds a shared handle to
/// the store so UI commands and incoming D-Bus calls mutate one source of truth.
struct NotificationsServer {
    store: Arc<Mutex<Store>>,
    events: UnboundedSender<ServiceEvent>,
}

#[interface(name = "org.freedesktop.Notifications")]
impl NotificationsServer {
    /// (name, vendor, version, spec_version).
    #[zbus(out_args("name", "vendor", "version", "spec_version"))]
    fn get_server_information(&self) -> (String, String, String, String) {
        (
            "kobel-shell".to_owned(),
            "kobel".to_owned(),
            "0.1".to_owned(),
            "1.2".to_owned(),
        )
    }

    fn get_capabilities(&self) -> Vec<String> {
        vec![
            "body".to_owned(),
            "actions".to_owned(),
            "icon-static".to_owned(),
            "persistence".to_owned(),
        ]
    }

    /// Store a notification and return its id. `expire_timeout` is intentionally
    /// ignored -- the UI owns toast timing.
    #[allow(clippy::too_many_arguments)]
    async fn notify(
        &self,
        app_name: String,
        replaces_id: u32,
        app_icon: String,
        summary: String,
        body: String,
        actions: Vec<String>,
        hints: HashMap<String, OwnedValue>,
        _expire_timeout: i32,
    ) -> u32 {
        let critical = hint_u8(&hints, "urgency") == Some(URGENCY_CRITICAL);
        let resident = hint_bool(&hints, "resident");
        let notif = Notification {
            id: 0,
            app_name,
            app_icon: pick_icon(&app_icon, &hints),
            summary,
            body,
            actions: pair_actions(actions),
            critical,
            time: now_secs(),
        };
        let (id, snapshot) = {
            let mut store = self.store.lock();
            let id = store.ingest(replaces_id, notif, resident);
            (id, store.snapshot())
        };
        let _ = self.events.send(ServiceEvent::Notifd(snapshot));
        id
    }

    /// Close a notification by id (emits NotificationClosed reason 3). A no-op
    /// if the id is unknown, per common-daemon behavior.
    async fn close_notification(
        &self,
        id: u32,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) {
        let removed = self.store.lock().close(id);
        if removed {
            let _ = emitter.notification_closed(id, REASON_CLOSED).await;
            let snapshot = self.store.lock().snapshot();
            let _ = self.events.send(ServiceEvent::Notifd(snapshot));
        }
    }

    #[zbus(signal)]
    async fn notification_closed(
        emitter: &SignalEmitter<'_>,
        id: u32,
        reason: u32,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn action_invoked(
        emitter: &SignalEmitter<'_>,
        id: u32,
        action_key: &str,
    ) -> zbus::Result<()>;
}

// ---- service task ---------------------------------------------------------

/// Outcome of the name-acquisition handshake.
struct Acquired {
    /// Whether we now own the well-known name.
    owned: bool,
    /// Whether we asked gnoblin to disable its notifications feature (so we hand
    /// it back on shutdown).
    disabled_gnoblin: bool,
    /// Whether a shutdown arrived mid-acquisition. The caller must then skip the
    /// command loop, since the shutdown receiver is already consumed.
    interrupted: bool,
}

/// The notifd service task: bring up the server, own the name (or run unserved),
/// route UI commands, and hand the name back on shutdown.
pub(crate) async fn run(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<NotifdCommand>,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    let store = Arc::new(Mutex::new(
        tokio::task::spawn_blocking(|| Store::load(state_file_path()))
            .await
            .expect("[notifd] store load task panicked"),
    ));

    // Debounced persistence: mutations set a dirty flag and wake this writer,
    // which coalesces a burst into one off-worker disk write. Every disk write
    // lives in this single task, so nothing races the final shutdown flush.
    let wake = store.lock().wake.clone();
    let (persist_shutdown_tx, persist_shutdown_rx) = oneshot::channel::<()>();
    let persist = tokio::spawn(persist_loop(Arc::clone(&store), wake, persist_shutdown_rx));

    let conn = match Connection::session().await {
        Ok(conn) => Some(conn),
        Err(e) => {
            tracing::warn!("[notifd] no session bus: {e}");
            None
        }
    };

    let mut emitter: Option<SignalEmitter<'static>> = None;
    let mut owned = false;
    let mut disabled_gnoblin = false;
    let mut interrupted = false;

    // Emit an immediate snapshot (serving=false, notifications suppressed) so the
    // UI has state before the possibly multi-second name-acquisition handshake.
    emit_snapshot(&events, &store);

    if let Some(conn) = conn.as_ref() {
        // Register the interface BEFORE requesting the name: zbus drops method
        // calls that arrive before the object is served.
        let iface = NotificationsServer {
            store: Arc::clone(&store),
            events: events.clone(),
        };
        if let Err(e) = conn.object_server().at(PATH, iface).await {
            tracing::warn!("[notifd] failed to serve interface: {e}");
        }
        emitter = SignalEmitter::new(conn, PATH).ok().map(|e| e.into_owned());

        let acquired = acquire_name(conn, &mut shutdown_rx).await;
        owned = acquired.owned;
        disabled_gnoblin = acquired.disabled_gnoblin;
        interrupted = acquired.interrupted;
    }

    if owned {
        store.lock().serving = true;
        tracing::info!("[notifd] serving {BUS}");
        // Re-emit now that the stored notifications are visible.
        emit_snapshot(&events, &store);
    } else {
        let stored = store.lock().items.len();
        tracing::info!(
            "[notifd] not serving (name held elsewhere); {stored} persisted notifications loaded but suppressed"
        );
    }

    // Serve UI commands until shutdown (skipped when acquisition already saw it).
    if !interrupted {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                cmd = cmd_rx.recv() => match cmd {
                    Some(cmd) => handle_command(cmd, &store, &events, emitter.as_ref()).await,
                    None => break,
                },
            }
        }
    }

    // Quiesce mutations before the final flush: pull our interface off the bus so
    // no late Notify can dirty the store after the persist writer has exited (UI
    // commands already stopped when the loop above broke).
    if let Some(conn) = conn.as_ref() {
        if let Err(e) = conn
            .object_server()
            .remove::<NotificationsServer, _>(PATH)
            .await
        {
            tracing::debug!("[notifd] interface remove on shutdown failed: {e}");
        }
    }

    // Stop the debounce writer: signal it, let it flush the latest snapshot, and
    // wait for it to finish BEFORE releasing the name. All disk writes happen in
    // that one task, so no in-flight write can race this final flush.
    let _ = persist_shutdown_tx.send(());
    let _ = persist.await;

    // Hand the name back so gnome-shell / gnoblin regains it. Release our claim
    // first, then re-enable the gnoblin feature so it can re-acquire.
    if let Some(conn) = conn.as_ref() {
        if owned {
            match conn.release_name(BUS).await {
                Ok(_) => tracing::info!("[notifd] released {BUS}"),
                Err(e) => tracing::warn!("[notifd] release_name failed: {e}"),
            }
        }
        if disabled_gnoblin {
            match ShellProxy::new(conn).await {
                Ok(proxy) => {
                    if let Err(e) = proxy.set_feature("notifications", true).await {
                        tracing::warn!("[notifd] hand-back SetFeature failed: {e}");
                    }
                }
                Err(e) => tracing::warn!("[notifd] hand-back proxy unavailable: {e}"),
            }
        }
    }
}

/// Try to own the name without replacement; if held, ask gnoblin to free it and
/// retry over ~5s. Never uses ReplaceExisting, so gnome-shell keeps the name on
/// a host desktop (we simply run unserved).
async fn acquire_name(conn: &Connection, shutdown_rx: &mut oneshot::Receiver<()>) -> Acquired {
    match conn
        .request_name_with_flags(BUS, RequestNameFlags::DoNotQueue.into())
        .await
    {
        Ok(_) => {
            return Acquired {
                owned: true,
                disabled_gnoblin: false,
                interrupted: false,
            };
        }
        Err(zbus::Error::NameTaken) => {}
        Err(e) => {
            tracing::warn!("[notifd] RequestName failed: {e}");
            return Acquired {
                owned: false,
                disabled_gnoblin: false,
                interrupted: false,
            };
        }
    }

    // Name held elsewhere -> ask the gnoblin compositor to release it.
    let mut disabled_gnoblin = false;
    match ShellProxy::new(conn).await {
        Ok(proxy) => match proxy.set_feature("notifications", false).await {
            Ok(_) => {
                disabled_gnoblin = true;
                tracing::info!("[notifd] asked gnoblin to release notifications");
            }
            Err(e) => tracing::debug!("[notifd] gnoblin SetFeature(false) failed: {e}"),
        },
        Err(e) => tracing::debug!("[notifd] gnoblin proxy unavailable: {e}"),
    }

    for attempt in 1..=ACQUIRE_RETRIES {
        tokio::select! {
            biased;
            _ = &mut *shutdown_rx => {
                tracing::debug!("[notifd] name acquisition interrupted by shutdown");
                return Acquired { owned: false, disabled_gnoblin, interrupted: true };
            }
            _ = tokio::time::sleep(ACQUIRE_INTERVAL) => {}
        }
        match conn
            .request_name_with_flags(BUS, RequestNameFlags::DoNotQueue.into())
            .await
        {
            Ok(_) => {
                tracing::info!("[notifd] acquired {BUS} after {attempt} retries");
                return Acquired {
                    owned: true,
                    disabled_gnoblin,
                    interrupted: false,
                };
            }
            Err(zbus::Error::NameTaken) => continue,
            Err(e) => {
                tracing::warn!("[notifd] RequestName retry failed: {e}");
                break;
            }
        }
    }

    tracing::info!("[notifd] name still held elsewhere; running unserved (gnome-shell keeps it)");
    Acquired {
        owned: false,
        disabled_gnoblin,
        interrupted: false,
    }
}

/// Apply a UI command to the store, emit the matching D-Bus signals, and push a
/// fresh snapshot on any change.
async fn handle_command(
    cmd: NotifdCommand,
    store: &Arc<Mutex<Store>>,
    events: &UnboundedSender<ServiceEvent>,
    emitter: Option<&SignalEmitter<'static>>,
) {
    match cmd {
        NotifdCommand::SetDnd(on) => {
            if store.lock().set_dnd(on) {
                emit_snapshot(events, store);
            }
        }
        NotifdCommand::Close(id) => {
            if store.lock().close(id) {
                tracing::info!("[notifd] closed id={id}");
                if let Some(emitter) = emitter {
                    let _ = emitter.notification_closed(id, REASON_DISMISSED).await;
                }
                emit_snapshot(events, store);
            }
        }
        NotifdCommand::ClearAll => {
            let ids = store.lock().clear();
            if !ids.is_empty() {
                if let Some(emitter) = emitter {
                    for id in &ids {
                        let _ = emitter.notification_closed(*id, REASON_DISMISSED).await;
                    }
                }
                emit_snapshot(events, store);
            }
        }
        NotifdCommand::InvokeAction { id, action_key } => {
            let Some(resident) = store.lock().residency(id) else {
                return;
            };
            if let Some(emitter) = emitter {
                let _ = emitter.action_invoked(id, &action_key).await;
            }
            if !resident && store.lock().close(id) {
                if let Some(emitter) = emitter {
                    let _ = emitter.notification_closed(id, REASON_DISMISSED).await;
                }
                emit_snapshot(events, store);
            }
        }
    }
}

fn emit_snapshot(events: &UnboundedSender<ServiceEvent>, store: &Arc<Mutex<Store>>) {
    let snapshot = store.lock().snapshot();
    let _ = events.send(ServiceEvent::Notifd(snapshot));
}

// ---- helpers --------------------------------------------------------------

/// $XDG_STATE_HOME/kobel/notifications.json, falling back to
/// ~/.local/state/kobel/notifications.json.
fn state_file_path() -> PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
            home.join(".local").join("state")
        });
    base.join("kobel").join("notifications.json")
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Icon selection: prefer `app_icon`, else the `image-path` hint (spec 1.2), else
/// the legacy `image_path` hint.
fn pick_icon(app_icon: &str, hints: &HashMap<String, OwnedValue>) -> Option<String> {
    if !app_icon.is_empty() {
        return Some(app_icon.to_owned());
    }
    hint_str(hints, "image-path").or_else(|| hint_str(hints, "image_path"))
}

/// Fold the flat [key, label, key, label, ...] actions array into pairs, dropping
/// a trailing unpaired key.
fn pair_actions(actions: Vec<String>) -> Vec<(String, String)> {
    let mut iter = actions.into_iter();
    let mut pairs = Vec::with_capacity(iter.len() / 2);
    while let (Some(key), Some(label)) = (iter.next(), iter.next()) {
        pairs.push((key, label));
    }
    pairs
}

fn hint_str(hints: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
    let value = hints.get(key)?;
    let s = <&str>::try_from(value).ok()?;
    if s.is_empty() { None } else { Some(s.to_owned()) }
}

fn hint_u8(hints: &HashMap<String, OwnedValue>, key: &str) -> Option<u8> {
    hints.get(key).and_then(|value| u8::try_from(value).ok())
}

fn hint_bool(hints: &HashMap<String, OwnedValue>, key: &str) -> bool {
    hints
        .get(key)
        .and_then(|value| bool::try_from(value).ok())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("kobel-notifd-{tag}-{}-{nanos}", std::process::id()))
            .join("notifications.json")
    }

    fn cleanup(path: &PathBuf) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
    }

    fn notif(summary: &str) -> Notification {
        Notification {
            id: 0,
            app_name: "app".to_owned(),
            app_icon: None,
            summary: summary.to_owned(),
            body: String::new(),
            actions: Vec::new(),
            critical: false,
            time: 0,
        }
    }

    #[test]
    fn cap_keeps_newest_fifty() {
        let path = temp_path("cap");
        let mut store = Store::load(path.clone());
        for i in 0..60 {
            store.ingest(0, notif(&format!("n{i}")), false);
        }
        assert_eq!(store.items.len(), CAP);
        // Newest first: the last ingested sits at index 0.
        assert_eq!(store.items[0].notif.summary, "n59");
        // n0..=n9 evicted; oldest kept is n10.
        assert_eq!(store.items.last().unwrap().notif.summary, "n10");
        cleanup(&path);
    }

    #[test]
    fn replaces_existing_id_in_place() {
        let path = temp_path("replace");
        let mut store = Store::load(path.clone());
        let a = store.ingest(0, notif("a"), false);
        let b = store.ingest(0, notif("b"), false);
        assert_eq!((a, b), (1, 2));

        let replaced = store.ingest(a, notif("a-updated"), false);
        assert_eq!(replaced, a, "replaces_id must be returned unchanged");
        assert_eq!(store.items.len(), 2, "replacement must not grow the store");
        assert_eq!(store.items[0].notif.summary, "a-updated");
        assert_eq!(store.items[0].notif.id, a);
        assert_eq!(
            store.items.iter().filter(|it| it.notif.id == a).count(),
            1,
            "exactly one entry keeps the replaced id"
        );
        cleanup(&path);
    }

    #[test]
    fn unknown_replaces_id_gets_fresh_monotonic_id() {
        let path = temp_path("replace-unknown");
        let mut store = Store::load(path.clone());
        let a = store.ingest(0, notif("a"), false);
        let b = store.ingest(0, notif("b"), false);
        // 999 is not present -> fresh id, not the injected value.
        let c = store.ingest(999, notif("c"), false);
        assert_eq!((a, b), (1, 2));
        assert_eq!(c, 3, "unknown replaces_id must not be reused as the id");
        assert_eq!(store.items.len(), 3);
        cleanup(&path);
    }

    #[tokio::test]
    async fn persistence_round_trip() {
        let path = temp_path("persist");
        let store = Arc::new(Mutex::new(Store::load(path.clone())));
        let two = {
            let mut s = store.lock();
            s.set_dnd(true);
            s.ingest(0, notif("one"), false);
            s.ingest(0, notif("two"), true)
        };
        // Mutations only mark the store dirty now; the debounced writer persists.
        // Flush once, then reload from disk.
        flush_store(&store).await;

        let reloaded = Store::load(path.clone());
        assert!(reloaded.dnd);
        assert_eq!(reloaded.items.len(), 2);
        // Newest-first order survives the round trip.
        assert_eq!(reloaded.items[0].notif.summary, "two");
        assert_eq!(reloaded.items[1].notif.summary, "one");
        assert_eq!(reloaded.items, store.lock().items, "exact round trip");
        // Private residency metadata persists too.
        assert_eq!(reloaded.residency(two), Some(true));
        // Ids continue after the max loaded id.
        let mut reloaded = reloaded;
        assert_eq!(reloaded.ingest(0, notif("three"), false), two + 1);
        cleanup(&path);
    }

    #[test]
    fn rapid_mutations_coalesce_to_one_pending_write() {
        let path = temp_path("coalesce");
        let mut store = Store::load(path.clone());
        // A burst of rapid mutations, as a client hammering Notify would produce.
        for i in 0..20 {
            store.ingest(0, notif(&format!("n{i}")), false);
        }
        store.set_dnd(true);
        // The whole burst collapses into a SINGLE pending write carrying the
        // final state -- not one write per mutation.
        let pending = store.take_dirty();
        assert!(pending.is_some(), "a burst leaves exactly one pending write");
        let (_, persisted) = pending.unwrap();
        assert_eq!(persisted.notifications.len(), 20);
        assert!(persisted.dnd);
        assert_eq!(persisted.notifications[0].notif.summary, "n19");
        // Nothing is left pending: the burst did not queue N separate writes.
        assert!(
            store.take_dirty().is_none(),
            "no residual pending writes after the coalesced flush"
        );
        cleanup(&path);
    }

    #[tokio::test]
    async fn debounced_flush_writes_once_for_a_burst() {
        let path = temp_path("debounce");
        let store = Arc::new(Mutex::new(Store::load(path.clone())));
        // Burst of rapid mutations under one lock, then a single debounced flush.
        {
            let mut s = store.lock();
            for i in 0..25 {
                s.ingest(0, notif(&format!("n{i}")), false);
            }
            s.set_dnd(true);
        }
        flush_store(&store).await;
        let reloaded = Store::load(path.clone());
        assert_eq!(reloaded.items.len(), 25);
        assert!(reloaded.dnd);
        assert_eq!(reloaded.items[0].notif.summary, "n24");

        // The burst produced exactly ONE write: with nothing newly dirty, a
        // second flush must not touch the fs. Prove it by deleting the file
        // first -- a no-op flush leaves it absent.
        std::fs::remove_file(&path).unwrap();
        flush_store(&store).await;
        assert!(!path.exists(), "no residual write after the coalesced flush");
        cleanup(&path);
    }

    #[test]
    fn close_and_clear() {
        let path = temp_path("close");
        let mut store = Store::load(path.clone());
        let a = store.ingest(0, notif("a"), false);
        let b = store.ingest(0, notif("b"), false);
        assert!(store.close(a));
        assert!(!store.close(a), "closing a gone id is a no-op");
        assert_eq!(store.items.len(), 1);
        assert_eq!(store.clear(), vec![b]);
        assert!(store.items.is_empty());
        assert!(store.clear().is_empty(), "clearing an empty store yields no ids");
        cleanup(&path);
    }

    #[test]
    fn residency_is_independent_of_critical() {
        let path = temp_path("resident");
        let mut store = Store::load(path.clone());
        // Critical (urgency 2) but NOT resident -> action must still close it.
        let mut crit = notif("crit");
        crit.critical = true;
        let crit_id = store.ingest(0, crit, false);
        assert_eq!(store.residency(crit_id), Some(false));
        // Resident but not critical -> action keeps it.
        let res_id = store.ingest(0, notif("res"), true);
        assert_eq!(store.residency(res_id), Some(true));
        assert_eq!(store.residency(4242), None);
        cleanup(&path);
    }

    #[test]
    fn snapshot_hides_notifications_until_serving() {
        let path = temp_path("serving");
        let mut store = Store::load(path.clone());
        store.ingest(0, notif("a"), false);
        // Unserved (host-desktop case): notifications are suppressed, dnd is not.
        store.set_dnd(true);
        let snap = store.snapshot();
        assert!(!snap.serving);
        assert!(snap.dnd);
        assert!(snap.notifications.is_empty());
        // Once we own the name the loaded/live notifications surface.
        store.serving = true;
        let snap = store.snapshot();
        assert!(snap.serving);
        assert_eq!(snap.notifications.len(), 1);
        assert_eq!(snap.notifications[0].summary, "a");
        cleanup(&path);
    }

    #[test]
    fn set_dnd_reports_change() {
        let path = temp_path("dnd");
        let mut store = Store::load(path.clone());
        assert!(store.set_dnd(true));
        assert!(!store.set_dnd(true), "no-op toggle reports no change");
        assert!(store.set_dnd(false));
        cleanup(&path);
    }

    #[test]
    fn pair_actions_drops_trailing_key() {
        let pairs = pair_actions(vec![
            "default".to_owned(),
            "Open".to_owned(),
            "reply".to_owned(),
            "Reply".to_owned(),
            "orphan".to_owned(),
        ]);
        assert_eq!(
            pairs,
            vec![
                ("default".to_owned(), "Open".to_owned()),
                ("reply".to_owned(), "Reply".to_owned()),
            ]
        );
    }
}
