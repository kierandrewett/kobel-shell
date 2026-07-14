//! StatusNotifierItem host built on the `system-tray` crate. Its client starts an
//! `org.kde.StatusNotifierWatcher`, registers this process as a host and emits item
//! changes, which this module converts into plain [`TraySnapshot`] values.
//!
//! `system-tray` also tracks each item's `com.canonical.dbusmenu` layout. This module
//! converts that tree into [`TrayMenu`] data and routes activate, about-to-show and
//! clicked commands back to the owning item. Presentation remains the caller's
//! responsibility.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use system_tray::client::{ActivateRequest, Client, Event};
use system_tray::item::IconPixmap;
pub use system_tray::item::{
    Category as TrayCategory, Status as TrayStatus, StatusNotifierItem as TrayProtocolItem, Tooltip as TrayTooltip,
};
pub use system_tray::menu::{
    Disposition as TrayMenuDisposition, MenuItem as TrayMenuItem, MenuType as TrayMenuItemKind,
    ToggleState as TrayToggleState, ToggleType as TrayToggleKind, TrayMenu,
};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use zbus::Connection;

#[zbus::proxy(interface = "org.kde.StatusNotifierItem")]
trait StatusNotifierActions {
    fn context_menu(&self, x: i32, y: i32) -> zbus::Result<()>;
    fn scroll(&self, delta: i32, orientation: &str) -> zbus::Result<()>;
    fn activate(&self, x: i32, y: i32) -> zbus::Result<()>;
    fn secondary_activate(&self, x: i32, y: i32) -> zbus::Result<()>;
}

#[zbus::proxy(
    interface = "org.kde.StatusNotifierWatcher",
    default_service = "org.kde.StatusNotifierWatcher",
    default_path = "/StatusNotifierWatcher"
)]
trait StatusNotifierWatcherQuery {
    #[zbus(property)]
    fn registered_status_notifier_items(&self) -> zbus::Result<Vec<String>>;
}

use crate::ServiceEvent;

/// Requested icon pixel size for the RASTER fallback theme lookup. The primary
/// pass prefers a scalable SVG (see [`lookup_icon_name`]); this only applies to
/// png-only themes/apps, where the crate picks the nearest available size.
/// Matches the value apps.rs uses for desktop-entry icons.
const ICON_SIZE: u16 = 64;

/// Size requested for the SVG-preferring first pass. Large so freedesktop-icons'
/// closest-size match ranks the theme's `scalable` dir ahead of a same-name
/// fixed-size raster dir. Mirrors apps.rs (`force_svg` alone is directory-order
/// dependent, so it can still return a PNG that shadows the scalable SVG).
const SCALABLE_ICON_SIZE: u16 = 512;

/// Hard cap on `icon_cache`'s entry count. Real usage never comes close (a
/// handful of long-running tray apps x icon-name/theme variations); this only
/// guards against a misbehaving/malicious SNI item that cycles its
/// `icon_name` on every update, which would otherwise grow the cache without
/// bound for the shell's entire (multi-day) runtime -- the same threat model
/// [`scan_theme_tree`] already bounds for a single walk. On overflow the whole
/// cache is cleared (simplest correct eviction for a HashMap with no
/// insertion-order tracking); this only degrades to "re-walk the theme once
/// more" under attack, never anything worse.
const ICON_CACHE_CAP: usize = 512;

/// One StatusNotifierItem with its complete protocol data and host-derived
/// conveniences kept separate.
#[derive(Debug, Clone)]
pub struct TrayItem {
    /// The item's bus address (stable key, used by activate commands).
    pub address: String,
    /// Registered SNI object path. `None` only when the watcher query failed.
    pub object_path: Option<String>,
    /// Complete StatusNotifierItem properties from the pinned `system-tray`
    /// protocol model, including status, category, attention/overlay icons,
    /// structured tooltip data and activation policy.
    pub protocol: TrayProtocolItem,
    /// The primary icon resolved against the current icon theme for convenience.
    /// Raw icon names and every supplied pixmap remain available in `protocol`.
    pub resolved_icon: TrayIcon,
    /// The complete DBusMenu tree, if the item advertised one and its layout has
    /// loaded. Labels, icons, shortcuts, dispositions and toggle states are
    /// preserved verbatim.
    pub menu: Option<TrayMenu>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TrayIcon {
    Path(PathBuf),
    /// Highest-resolution valid primary icon bitmap, retained in the SNI's
    /// network-order ARGB32 byte layout.
    Pixmap {
        width: u32,
        height: u32,
        argb: Vec<u8>,
    },
    None,
}

#[derive(Debug, Clone, Default)]
pub struct TraySnapshot {
    pub items: Vec<TrayItem>,
}

/// Axis reported to the StatusNotifierItem `Scroll` method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayScrollOrientation {
    Horizontal,
    Vertical,
}

impl TrayScrollOrientation {
    fn as_dbus_str(self) -> &'static str {
        match self {
            Self::Horizontal => "horizontal",
            Self::Vertical => "vertical",
        }
    }
}

/// Command routed to the tray task; acts on an item by its bus address.
pub(crate) enum TrayCommand {
    /// Primary activation with the caller's screen-coordinate placement hint.
    Activate { address: String, x: i32, y: i32 },
    /// Secondary activation with the caller's screen-coordinate placement hint.
    SecondaryActivate { address: String, x: i32, y: i32 },
    /// Ask the item to open its own context menu at a screen-coordinate hint.
    ContextMenu { address: String, x: i32, y: i32 },
    /// Forward a scroll gesture without choosing a UI-specific interpretation.
    Scroll {
        address: String,
        delta: i32,
        orientation: TrayScrollOrientation,
    },
    /// DBusMenu `AboutToShow` for any menu item.
    MenuAboutToShow { address: String, item_id: i32 },
    /// DBusMenu `Event("clicked", ...)` for one item, with a proper timestamp
    /// supplied by the crate. Address is the item's bus name.
    MenuClicked { address: String, item_id: i32 },
}

/// Tray service task. Starts the SNI host, mirrors its item cache (items +
/// DBusMenu layouts) into a deterministic `TraySnapshot` on every change, and
/// routes activate / menu commands. Menu-update events refresh the tree in
/// place and re-emit; they never remove items from tracking.
pub(crate) async fn run(events: UnboundedSender<ServiceEvent>, mut cmd_rx: UnboundedReceiver<TrayCommand>) {
    // `Client::new` starts the watcher server, registers us as a host, and
    // spawns the item/menu listeners. It also maintains an authoritative item
    // cache (the crate's default `data` feature) which we read on every event.
    let client = match Client::new().await {
        Ok(client) => client,
        Err(e) => {
            tracing::warn!("[tray] SNI host failed to start: {e:?}");
            let _ = events.send(ServiceEvent::Tray(TraySnapshot::default()));
            return;
        }
    };
    let action_connection = match Connection::session().await {
        Ok(connection) => Some(connection),
        Err(error) => {
            tracing::warn!("[tray] action connection unavailable: {error}");
            None
        }
    };

    // Subscribe BEFORE the first snapshot: the crate recommends new -> subscribe
    // -> read state so no registration is missed in the gap.
    let mut tray_rx = client.subscribe();
    let mut item_paths = match action_connection.as_ref() {
        Some(connection) => refresh_registered_item_paths(connection).await.unwrap_or_default(),
        None => HashMap::new(),
    };
    // The user's icon theme is read once (matches apps.rs). A live theme switch
    // is not tracked; icons re-resolve whenever an item next changes.
    let theme = current_icon_theme();
    // Memoize name -> path resolution: a storm of update events must not repeat
    // the synchronous freedesktop theme walk. Valid for the task's lifetime
    // since the theme is read once and never live-tracked.
    let mut icon_cache: HashMap<IconKey, Option<PathBuf>> = HashMap::new();
    tracing::info!("[tray] SNI host started");

    // Baseline emit so the UI has an initial (possibly empty) snapshot; real
    // content follows as items register and fire Add events.
    emit_snapshot(&events, &client, &item_paths, theme.as_deref(), &mut icon_cache).await;

    loop {
        tokio::select! {
            event = tray_rx.recv() => match event {
                Ok(event) => {
                    match &event {
                        Event::Add(addr, _) => {
                            tracing::debug!("[tray] item added: {addr}");
                            if let Some(connection) = action_connection.as_ref()
                                && let Some(refreshed) = refresh_registered_item_paths(connection).await
                            {
                                item_paths = refreshed;
                            }
                        }
                        Event::Remove(addr) => {
                            tracing::debug!("[tray] item removed: {addr}");
                            if let Some(connection) = action_connection.as_ref()
                                && let Some(refreshed) = refresh_registered_item_paths(connection).await
                            {
                                item_paths = refreshed;
                            }
                        }
                        Event::Update(addr, _) => tracing::trace!("[tray] item updated: {addr}"),
                    }
                    // Every add/remove/update re-emits a fresh sorted snapshot.
                    // Menu-only updates leave the item fields untouched, so the
                    // rebuilt snapshot is identical and harmless.
                    emit_snapshot(&events, &client, &item_paths, theme.as_deref(), &mut icon_cache).await;
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("[tray] event stream lagged, dropped {n}; resyncing");
                    if let Some(connection) = action_connection.as_ref()
                        && let Some(refreshed) = refresh_registered_item_paths(connection).await
                    {
                        item_paths = refreshed;
                    }
                    emit_snapshot(&events, &client, &item_paths, theme.as_deref(), &mut icon_cache).await;
                }
                Err(RecvError::Closed) => {
                    tracing::warn!("[tray] event stream closed");
                    break;
                }
            },
            cmd = cmd_rx.recv() => match cmd {
                // D-Bus methods have no default deadline and this loop processes
                // one command at a time. Bound each request so one broken item
                // cannot block every other item and snapshot update.
                Some(cmd) => {
                    crate::with_command_timeout(
                        "tray",
                        handle_command(&client, action_connection.as_ref(), &item_paths, cmd),
                    )
                    .await
                }
                None => break,
            },
        }
    }
}

/// Icon-cache key: `(name, theme, theme_path)`. The finding requires memoizing
/// on name+theme; the item's app-shipped `IconThemePath` is part of the theme
/// context, so all three participate. The global theme is fixed for the task's
/// lifetime, but keying on it keeps the cache contract explicit and correct even
/// if the resolver is ever reused across themes.
type IconKey = (String, Option<String>, Option<String>);

/// Snapshot the crate's item cache into a `TraySnapshot`, sorted by address.
/// Named-icon resolution is memoized and cache misses run on a `spawn_blocking`
/// thread, so the runtime worker never does synchronous theme walks. Items are
/// cloned OUTSIDE the mutex so filesystem lookups never stall the client's
/// writer tasks.
async fn emit_snapshot(
    events: &UnboundedSender<ServiceEvent>,
    client: &Client,
    item_paths: &HashMap<String, String>,
    theme: Option<&str>,
    icon_cache: &mut HashMap<IconKey, Option<PathBuf>>,
) {
    let map = client.items();
    let raw: Vec<(String, TrayProtocolItem, Option<TrayMenu>)> = {
        let guard = map.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        guard
            .iter()
            .map(|(addr, (item, menu))| (addr.clone(), item.clone(), menu.clone()))
            .collect()
    };

    let mut items: Vec<TrayItem> = Vec::with_capacity(raw.len());
    for (address, protocol, menu) in raw {
        let resolved_icon = resolve_icon_cached(&protocol, theme, icon_cache).await;
        let object_path = item_paths.get(&address).cloned();
        items.push(TrayItem {
            address,
            object_path,
            protocol,
            resolved_icon,
            menu,
        });
    }
    // HashMap iteration is unordered; sort by address for determinism.
    items.sort_by(|a, b| a.address.cmp(&b.address));

    let _ = events.send(ServiceEvent::Tray(TraySnapshot { items }));
}

/// Resolve an item's icon, memoizing named-icon lookups. Prefer the freedesktop
/// icon NAME (resolved off-worker via [`cached_or_resolve`], honoring the item's
/// `IconThemePath`); fall back to the largest provided ARGB pixmap (in-memory);
/// else `None`.
async fn resolve_icon_cached(
    item: &TrayProtocolItem,
    theme: Option<&str>,
    icon_cache: &mut HashMap<IconKey, Option<PathBuf>>,
) -> TrayIcon {
    if let Some(name) = item.icon_name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let theme_path = item.icon_theme_path.clone();
        let key = (name.to_owned(), theme.map(str::to_owned), theme_path.clone());
        let name_owned = name.to_owned();
        let theme_owned = theme.map(str::to_owned);
        let resolved = cached_or_resolve(icon_cache, key, move || {
            resolve_named_icon(&name_owned, theme_path.as_deref(), theme_owned.as_deref())
        })
        .await;
        if let Some(path) = resolved {
            return TrayIcon::Path(path);
        }
    }

    if let Some(pixmap) = item.icon_pixmap.as_deref().and_then(largest_pixmap) {
        return TrayIcon::Pixmap {
            width: pixmap.width as u32,
            height: pixmap.height as u32,
            argb: pixmap.pixels.clone(),
        };
    }

    TrayIcon::None
}

/// Return `key`'s cached path if present; on a miss, run the synchronous
/// `resolve` closure on a `spawn_blocking` thread, cache the result (hit OR
/// miss), and return it. Caching misses too means repeated unresolved names
/// never re-walk the theme.
async fn cached_or_resolve<F>(
    cache: &mut HashMap<IconKey, Option<PathBuf>>,
    key: IconKey,
    resolve: F,
) -> Option<PathBuf>
where
    F: FnOnce() -> Option<PathBuf> + Send + 'static,
{
    if let Some(hit) = cache.get(&key) {
        return hit.clone();
    }
    if cache.len() >= ICON_CACHE_CAP {
        tracing::debug!("[tray] icon cache hit its {ICON_CACHE_CAP}-entry cap; clearing");
        cache.clear();
    }
    let found = tokio::task::spawn_blocking(resolve).await.unwrap_or(None);
    cache.insert(key, found.clone());
    found
}

/// Route a command to the SNI item or its DBusMenu.
///
/// Menu commands need the item's `com.canonical.dbusmenu` object path, which
/// lives on the item's `menu` property; resolve it by bus address.
async fn handle_command(
    client: &Client,
    action_connection: Option<&Connection>,
    item_paths: &HashMap<String, String>,
    cmd: TrayCommand,
) {
    match cmd {
        TrayCommand::Activate { address, x, y } => {
            let (Some(connection), Some(path)) = (action_connection, item_paths.get(&address)) else {
                tracing::warn!("[tray] activate ignored: no object path for {address}");
                return;
            };
            if let Err(error) = primary_activate(connection, &address, path, x, y).await {
                tracing::warn!("[tray] activate failed: {error}");
            }
        }
        TrayCommand::SecondaryActivate { address, x, y } => {
            let (Some(connection), Some(path)) = (action_connection, item_paths.get(&address)) else {
                tracing::warn!("[tray] secondary activate ignored: no object path for {address}");
                return;
            };
            if let Err(error) = secondary_activate(connection, &address, path, x, y).await {
                tracing::warn!("[tray] secondary activate failed: {error}");
            }
        }
        TrayCommand::ContextMenu { address, x, y } => {
            let Some(connection) = action_connection else {
                tracing::warn!("[tray] context menu ignored: no action connection");
                return;
            };
            let Some(path) = item_paths.get(&address) else {
                tracing::warn!("[tray] context menu: no object path for {address}");
                return;
            };
            if let Err(error) = context_menu(connection, &address, path, x, y).await {
                tracing::warn!("[tray] context menu failed: {error}");
            }
        }
        TrayCommand::Scroll {
            address,
            delta,
            orientation,
        } => {
            let Some(connection) = action_connection else {
                tracing::warn!("[tray] scroll ignored: no action connection");
                return;
            };
            let Some(path) = item_paths.get(&address) else {
                tracing::warn!("[tray] scroll: no object path for {address}");
                return;
            };
            if let Err(error) = scroll(connection, &address, path, delta, orientation).await {
                tracing::warn!("[tray] scroll failed: {error}");
            }
        }
        TrayCommand::MenuAboutToShow { address, item_id } => {
            let Some(menu_path) = menu_path_for(client, &address) else {
                tracing::warn!("[tray] about-to-show: no menu path for {address}");
                return;
            };
            if let Err(error) = client.about_to_show_menuitem(address, menu_path, item_id).await {
                tracing::warn!("[tray] about-to-show failed: {error}");
            }
        }
        TrayCommand::MenuClicked { address, item_id } => {
            let Some(menu_path) = menu_path_for(client, &address) else {
                tracing::warn!("[tray] menu click: no menu path for {address}");
                return;
            };
            activate(
                client,
                ActivateRequest::MenuItem {
                    address,
                    menu_path,
                    submenu_id: item_id,
                },
            )
            .await;
        }
    }
}

async fn primary_activate(connection: &Connection, address: &str, path: &str, x: i32, y: i32) -> zbus::Result<()> {
    let proxy = StatusNotifierActionsProxy::builder(connection)
        .destination(address)?
        .path(path)?
        .build()
        .await?;
    proxy.activate(x, y).await
}

async fn secondary_activate(connection: &Connection, address: &str, path: &str, x: i32, y: i32) -> zbus::Result<()> {
    let proxy = StatusNotifierActionsProxy::builder(connection)
        .destination(address)?
        .path(path)?
        .build()
        .await?;
    proxy.secondary_activate(x, y).await
}

async fn context_menu(connection: &Connection, address: &str, path: &str, x: i32, y: i32) -> zbus::Result<()> {
    let proxy = StatusNotifierActionsProxy::builder(connection)
        .destination(address)?
        .path(path)?
        .build()
        .await?;
    proxy.context_menu(x, y).await
}

async fn scroll(
    connection: &Connection,
    address: &str,
    path: &str,
    delta: i32,
    orientation: TrayScrollOrientation,
) -> zbus::Result<()> {
    let proxy = StatusNotifierActionsProxy::builder(connection)
        .destination(address)?
        .path(path)?
        .build()
        .await?;
    proxy.scroll(delta, orientation.as_dbus_str()).await
}

async fn refresh_registered_item_paths(connection: &Connection) -> Option<HashMap<String, String>> {
    match tokio::time::timeout(crate::COMMAND_TIMEOUT, query_registered_item_paths(connection)).await {
        Ok(Ok(paths)) => Some(paths),
        Ok(Err(error)) => {
            tracing::warn!("[tray] cannot read registered item paths: {error}");
            None
        }
        Err(_) => {
            tracing::warn!(
                "[tray] registered item path query timed out after {:?}",
                crate::COMMAND_TIMEOUT
            );
            None
        }
    }
}

async fn query_registered_item_paths(connection: &Connection) -> zbus::Result<HashMap<String, String>> {
    let proxy = StatusNotifierWatcherQueryProxy::new(connection).await?;
    let items = proxy.registered_status_notifier_items().await?;
    Ok(collect_registered_item_paths(items))
}

fn collect_registered_item_paths(mut registered: Vec<String>) -> HashMap<String, String> {
    registered.sort();
    let mut paths = HashMap::new();
    for item in registered {
        let Some((address, path)) = registered_item_parts(&item) else {
            tracing::warn!("[tray] watcher returned an item without an object path: {item}");
            continue;
        };
        if paths.contains_key(address) {
            tracing::warn!(
                "[tray] multiple SNI objects share {address}; system-tray exposes one item, using the first path"
            );
            continue;
        }
        paths.insert(address.to_owned(), path.to_owned());
    }
    paths
}

fn registered_item_parts(registered: &str) -> Option<(&str, &str)> {
    let slash = registered.find('/')?;
    Some((&registered[..slash], &registered[slash..]))
}

/// Send a DBusMenu activation request, logging any failure.
async fn activate(client: &Client, req: ActivateRequest) {
    if let Err(e) = client.activate(req).await {
        tracing::warn!("[tray] activate failed: {e}");
    }
}

/// Look up an item's DBusMenu object path (the `menu` property) by bus address.
/// Read straight from the crate's item map; cheap and never held across await.
fn menu_path_for(client: &Client, address: &str) -> Option<String> {
    let map = client.items();
    let guard = map.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    guard.get(address).and_then(|(item, _menu)| item.menu.clone())
}

/// Resolve an icon name to a concrete file. Absolute paths pass through; the
/// item's `IconThemePath` (an app-shipped icon dir) takes precedence over the
/// shared freedesktop theme search, per the SNI spec.
fn resolve_named_icon(name: &str, theme_path: Option<&str>, theme: Option<&str>) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.is_absolute() {
        return path.exists().then(|| path.to_path_buf());
    }

    if let Some(dir) = theme_path.map(str::trim).filter(|d| !d.is_empty())
        && let Some(found) = find_in_theme_path(Path::new(dir), name)
    {
        return Some(found);
    }

    // Standard freedesktop theme lookup, SVG-preferring (Inherits -> hicolor ->
    // pixmaps fallback handled by the crate). Same shape as apps.rs, kept local to
    // stay in this crate's assigned files.
    lookup_icon_name(name, theme)
}

/// Look up an icon NAME in the freedesktop theme, strongly preferring a scalable
/// SVG so scaled/HiDPI sessions get a crisp vector instead of a small raster
/// upscaled by the shell (and again by the compositor). Two passes: a large
/// `force_svg` request accepted only if it resolved to a `.svg`, then the nearest
/// raster at [`ICON_SIZE`] for png-only themes. Mirrors apps.rs::lookup_icon_name.
fn lookup_icon_name(name: &str, theme: Option<&str>) -> Option<PathBuf> {
    let build = |size: u16, force_svg: bool| {
        let mut builder = freedesktop_icons::lookup(name).with_size(size).with_scale(1);
        if let Some(theme) = theme {
            builder = builder.with_theme(theme);
        }
        if force_svg {
            builder = builder.force_svg();
        }
        builder.find()
    };
    // Pass 1: prefer a scalable SVG.
    if let Some(svg) = build(SCALABLE_ICON_SIZE, true)
        && svg.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg"))
    {
        return Some(svg);
    }
    // Pass 2: nearest raster (png-only theme, or a name with no SVG anywhere).
    build(ICON_SIZE, false)
}

/// Look for `name` inside an app-provided `IconThemePath`. Handles both the
/// common flat layout (`<dir>/<name>.<ext>`) and a small size-organized theme
/// tree, preferring a scalable SVG.
fn find_in_theme_path(dir: &Path, name: &str) -> Option<PathBuf> {
    const EXTS: [&str; 3] = ["svg", "png", "xpm"];
    for ext in EXTS {
        let candidate = dir.join(format!("{name}.{ext}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    scan_theme_tree(dir, name)
}

/// Bounded depth-first walk of an app icon dir for `<name>.{svg,png,xpm}`.
/// SVG wins outright; otherwise the first raster match is returned. Bounded on
/// BOTH depth and total entries so a pathological `IconThemePath` cannot make
/// this synchronous walk stall the single services runtime.
fn scan_theme_tree(root: &Path, name: &str) -> Option<PathBuf> {
    const MAX_DEPTH: usize = 5;
    const MAX_ENTRIES: usize = 2048;
    let svg = format!("{name}.svg");
    let raster = [format!("{name}.png"), format!("{name}.xpm")];

    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut raster_hit: Option<PathBuf> = None;
    let mut seen = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                tracing::debug!("[tray] icon walk hit entry cap under {}", root.display());
                return raster_hit;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            let Some(file_name) = path.file_name().and_then(|f| f.to_str()) else {
                continue;
            };
            if file_name == svg {
                return Some(path);
            }
            if raster_hit.is_none() && raster.iter().any(|r| r == file_name) {
                raster_hit = Some(path);
            }
        }
    }
    raster_hit
}

/// Pick the highest-resolution non-empty pixmap (the crate delivers several
/// sizes). Guards against the zero/negative dimensions some apps send.
fn largest_pixmap(pixmaps: &[IconPixmap]) -> Option<&IconPixmap> {
    pixmaps
        .iter()
        .filter(|p| p.width > 0 && p.height > 0 && !p.pixels.is_empty())
        .max_by_key(|p| i64::from(p.width) * i64::from(p.height))
}

/// The user's current icon theme directory name, read straight from gsettings
/// (duplicated from apps.rs to keep tray.rs self-contained). We use the raw
/// value -- the theme dir key freedesktop-icons indexes by.
fn current_icon_theme() -> Option<String> {
    let output = std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "icon-theme"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8(output.stdout).ok()?;
    let theme = raw.trim().trim_matches(|c| c == '\'' || c == '"').trim();
    (!theme.is_empty()).then(|| theme.to_owned())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[tokio::test]
    async fn icon_cache_resolves_each_key_once() {
        let calls = Arc::new(AtomicUsize::new(0));
        let mut cache: HashMap<IconKey, Option<PathBuf>> = HashMap::new();
        let key = ("firefox".to_owned(), Some("Adwaita".to_owned()), None);

        // Five lookups of one icon (a storm of update events) resolve exactly once.
        for _ in 0..5 {
            let c = Arc::clone(&calls);
            let out = cached_or_resolve(&mut cache, key.clone(), move || {
                c.fetch_add(1, Ordering::SeqCst);
                Some(PathBuf::from("/icons/firefox.svg"))
            })
            .await;
            assert_eq!(out, Some(PathBuf::from("/icons/firefox.svg")));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1, "one icon resolves exactly once");

        // A different key resolves once more; a cached MISS is not re-resolved.
        let c = Arc::clone(&calls);
        let miss = cached_or_resolve(&mut cache, ("nope".to_owned(), None, None), move || {
            c.fetch_add(1, Ordering::SeqCst);
            None
        })
        .await;
        assert_eq!(miss, None);
        assert_eq!(calls.load(Ordering::SeqCst), 2);

        let c = Arc::clone(&calls);
        let _ = cached_or_resolve(&mut cache, ("nope".to_owned(), None, None), move || {
            c.fetch_add(1, Ordering::SeqCst);
            Some(PathBuf::from("/should/not/happen"))
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 2, "a cached miss is not re-resolved");
    }

    #[tokio::test]
    async fn icon_cache_never_exceeds_its_cap() {
        // Simulate a misbehaving tray item cycling a unique icon_name on every
        // update: far more distinct keys than ICON_CACHE_CAP. The cache must
        // never grow past its bound (it clears-and-restarts on overflow
        // instead), proving a hostile/buggy SNI item cannot leak memory over
        // this shell's multi-day runtime.
        let mut cache: HashMap<IconKey, Option<PathBuf>> = HashMap::new();
        for i in 0..(ICON_CACHE_CAP * 3) {
            let key = (format!("icon-{i}"), None, None);
            let _ = cached_or_resolve(&mut cache, key, || Some(PathBuf::from("/icons/x.svg"))).await;
            assert!(
                cache.len() <= ICON_CACHE_CAP,
                "cache grew to {} entries past its {ICON_CACHE_CAP}-entry cap at i={i}",
                cache.len()
            );
        }
    }

    fn pixmap(width: i32, height: i32, pixel_count: usize) -> IconPixmap {
        IconPixmap {
            width,
            height,
            pixels: vec![0u8; pixel_count],
        }
    }

    #[test]
    fn largest_pixmap_picks_the_biggest_valid_one() {
        let pixmaps = vec![pixmap(16, 16, 1024), pixmap(64, 64, 16384), pixmap(32, 32, 4096)];
        let picked = largest_pixmap(&pixmaps).expect("a valid pixmap exists");
        assert_eq!((picked.width, picked.height), (64, 64), "largest area wins");
    }

    #[test]
    fn largest_pixmap_skips_zero_dimension_and_empty_entries() {
        // Zero width, zero height, and empty pixel data are all malformed
        // entries some apps send; none of them may be picked even though a
        // naive max-by-area would treat a 0x0 "pixmap" as harmless.
        let malformed = vec![
            pixmap(0, 64, 1024),
            pixmap(64, 0, 1024),
            IconPixmap {
                width: 32,
                height: 32,
                pixels: Vec::new(),
            },
        ];
        assert!(
            largest_pixmap(&malformed).is_none(),
            "no valid pixmap among malformed entries"
        );

        // A single valid entry among malformed ones is still found.
        let mixed = vec![pixmap(0, 64, 1024), pixmap(16, 16, 256)];
        let picked = largest_pixmap(&mixed).expect("the one valid entry is found");
        assert_eq!((picked.width, picked.height), (16, 16));
    }

    #[test]
    fn largest_pixmap_none_for_an_empty_list() {
        assert!(largest_pixmap(&[]).is_none());
    }

    #[test]
    fn registered_item_path_cache_is_deterministic() {
        let paths = collect_registered_item_paths(vec![
            ":1.72/org/example/Z".to_string(),
            ":1.58/StatusNotifierItem".to_string(),
            ":1.72/org/example/A".to_string(),
        ]);
        assert_eq!(paths.get(":1.58").map(String::as_str), Some("/StatusNotifierItem"));
        assert_eq!(
            paths.get(":1.72").map(String::as_str),
            Some("/org/example/A"),
            "the first lexical path wins when the upstream map collapses duplicate bus names",
        );
    }

    #[test]
    fn scroll_orientation_matches_the_sni_wire_contract() {
        assert_eq!(TrayScrollOrientation::Horizontal.as_dbus_str(), "horizontal");
        assert_eq!(TrayScrollOrientation::Vertical.as_dbus_str(), "vertical");
    }

    #[test]
    fn registered_item_paths_preserve_custom_objects() {
        assert_eq!(
            registered_item_parts(":1.72/org/ayatana/NotificationItem/dropbox"),
            Some((":1.72", "/org/ayatana/NotificationItem/dropbox")),
        );
        assert_eq!(
            registered_item_parts(":1.58/StatusNotifierItem"),
            Some((":1.58", "/StatusNotifierItem")),
        );
        assert_eq!(registered_item_parts(":1.72"), None);
    }
}
