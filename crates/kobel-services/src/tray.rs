//! StatusNotifier tray host (the AGS AstalTray replacement) via the
//! `system-tray` crate (JakeStanger's async SNI watcher/host, the same one
//! ironbar uses). We run its `Client` -- which starts an
//! `org.kde.StatusNotifierWatcher` and registers us as a host -- on the
//! services runtime, then translate its item events into `TraySnapshot`.
//!
//! Phase-6 scope: items + activate. DBusMenu rendering needs popup surface
//! design and is an explicit follow-up (docs/FREYA-PLAN.md section 6 note);
//! menu events are ignored here without disturbing item tracking.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use system_tray::client::{ActivateRequest, Client, Event};
use system_tray::item::{IconPixmap, StatusNotifierItem};
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

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

/// One StatusNotifierItem as the bar renders it.
#[derive(Debug, Clone, PartialEq)]
pub struct TrayItem {
    /// The item's bus address (stable key, used by activate commands).
    pub address: String,
    pub title: String,
    pub tooltip: Option<String>,
    /// Resolved icon: a theme/file path when available, else raw ARGB32 pixmap
    /// bytes with dimensions.
    pub icon: TrayIcon,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TrayIcon {
    Path(std::path::PathBuf),
    /// Raw icon bitmap taken verbatim from the SNI `IconPixmap` property.
    ///
    /// Byte order is ARGB32 in NETWORK (big-endian) byte order, i.e. each pixel
    /// is four bytes `[A, R, G, B]`, exactly as delivered over the bus (see the
    /// StatusNotifierItem spec, "Icons"). The bytes are kept as-is; a renderer
    /// wanting Skia's little-endian BGRA8888/`N32` layout must byte-swap per
    /// pixel (`A,R,G,B` -> `B,G,R,A`).
    Pixmap { width: u32, height: u32, argb: Vec<u8> },
    None,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TraySnapshot {
    pub items: Vec<TrayItem>,
}

/// Command routed to the tray task; acts on an item by its bus address.
pub(crate) enum TrayCommand {
    /// Primary activation (left click): `Activate(x, y)` with x=y=0.
    Activate(String),
    /// Secondary activation (middle click): `SecondaryActivate(x, y)`, x=y=0.
    SecondaryActivate(String),
}

/// Tray service task. Starts the SNI host, mirrors its item cache into a
/// deterministic `TraySnapshot` on every change, and routes activate commands.
/// Menu events are ignored (out of scope) but never remove items from tracking.
pub(crate) async fn run(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<TrayCommand>,
) {
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

    // Subscribe BEFORE the first snapshot: the crate recommends new -> subscribe
    // -> read state so no registration is missed in the gap.
    let mut tray_rx = client.subscribe();
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
    emit_snapshot(&events, &client, theme.as_deref(), &mut icon_cache).await;

    loop {
        tokio::select! {
            event = tray_rx.recv() => match event {
                Ok(event) => {
                    match &event {
                        Event::Add(addr, _) => tracing::debug!("[tray] item added: {addr}"),
                        Event::Remove(addr) => tracing::debug!("[tray] item removed: {addr}"),
                        Event::Update(addr, _) => tracing::trace!("[tray] item updated: {addr}"),
                    }
                    // Every add/remove/update re-emits a fresh sorted snapshot.
                    // Menu-only updates leave the item fields untouched, so the
                    // rebuilt snapshot is identical and harmless.
                    emit_snapshot(&events, &client, theme.as_deref(), &mut icon_cache).await;
                }
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!("[tray] event stream lagged, dropped {n}; resyncing");
                    emit_snapshot(&events, &client, theme.as_deref(), &mut icon_cache).await;
                }
                Err(RecvError::Closed) => {
                    tracing::warn!("[tray] event stream closed");
                    break;
                }
            },
            cmd = cmd_rx.recv() => match cmd {
                Some(cmd) => handle_command(&client, cmd).await,
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
    theme: Option<&str>,
    icon_cache: &mut HashMap<IconKey, Option<PathBuf>>,
) {
    let map = client.items();
    let raw: Vec<(String, StatusNotifierItem)> = {
        let guard = map.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        guard
            .iter()
            .map(|(addr, (item, _menu))| (addr.clone(), item.clone()))
            .collect()
    };

    let mut items: Vec<TrayItem> = Vec::with_capacity(raw.len());
    for (address, item) in &raw {
        let icon = resolve_icon_cached(item, theme, icon_cache).await;
        items.push(TrayItem {
            address: address.clone(),
            title: item.title.clone().unwrap_or_else(|| item.id.clone()),
            tooltip: tooltip_text(item),
            icon,
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
    item: &StatusNotifierItem,
    theme: Option<&str>,
    icon_cache: &mut HashMap<IconKey, Option<PathBuf>>,
) -> TrayIcon {
    if let Some(name) = item
        .icon_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
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
    let found = tokio::task::spawn_blocking(resolve).await.unwrap_or(None);
    cache.insert(key, found.clone());
    found
}

/// Route an activate command to the SNI item. x=y=0 (we have no screen-position
/// hint to offer; items use it only to place their own popups).
async fn handle_command(client: &Client, cmd: TrayCommand) {
    let req = match cmd {
        TrayCommand::Activate(address) => ActivateRequest::Default { address, x: 0, y: 0 },
        TrayCommand::SecondaryActivate(address) => {
            ActivateRequest::Secondary { address, x: 0, y: 0 }
        }
    };
    if let Err(e) = client.activate(req).await {
        tracing::warn!("[tray] activate failed: {e}");
    }
}

/// Collapse the SNI tooltip (title + description) into one display string.
fn tooltip_text(item: &StatusNotifierItem) -> Option<String> {
    let tooltip = item.tool_tip.as_ref()?;
    let title = tooltip.title.trim();
    let description = tooltip.description.trim();
    match (title.is_empty(), description.is_empty()) {
        (false, false) => Some(format!("{title}\n{description}")),
        (false, true) => Some(title.to_owned()),
        (true, false) => Some(description.to_owned()),
        (true, true) => None,
    }
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
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "a cached miss is not re-resolved"
        );
    }
}
