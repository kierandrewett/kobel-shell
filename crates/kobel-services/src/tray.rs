//! StatusNotifier tray host (the AGS AstalTray replacement) via the
//! `system-tray` crate (JakeStanger's async SNI watcher/host, the same one
//! ironbar uses). We run its `Client` -- which starts an
//! `org.kde.StatusNotifierWatcher` and registers us as a host -- on the
//! services runtime, then translate its item events into `TraySnapshot`.
//!
//! Items + activate + DBusMenu tree/actions. The `system-tray` crate already
//! tracks each item's `com.canonical.dbusmenu` layout in its item map (the
//! `data` feature) and re-emits it on menu-update events; we translate that
//! tree into a plain `TrayMenu` snapshot and route about-to-show / clicked
//! calls back. Menu UI is a shared popup component (`kobel-shell`'s
//! `ui/menu.rs`), wired from the bar's tray row on right-click.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use system_tray::client::{ActivateRequest, Client, Event};
use system_tray::item::{IconPixmap, StatusNotifierItem};
use system_tray::menu::{
    MenuItem as SniMenuItem, MenuType, ToggleState, ToggleType, TrayMenu as SniMenu,
};
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
    /// The item's DBusMenu tree, if it advertised a `com.canonical.dbusmenu`
    /// object and the crate has fetched its layout. `None` while the layout is
    /// still loading or if the item exposes no menu.
    pub menu: Option<TrayMenu>,
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

/// A tray item's DBusMenu (`com.canonical.dbusmenu`) tree, flattened to plain
/// data the UI can render directly. Built from the `system-tray` crate's own
/// layout via [`convert_menu`]; `items` are the root menu's children.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TrayMenu {
    pub items: Vec<TrayMenuItem>,
}

/// One node in a [`TrayMenu`]. Ids are the DBusMenu numeric item ids used by
/// the clicked/about-to-show calls; `children` is non-empty for submenus.
#[derive(Debug, Clone, PartialEq)]
pub struct TrayMenuItem {
    /// DBusMenu numeric id, passed back verbatim on a `TrayMenuClicked`.
    pub id: i32,
    /// Display label with GTK/DBusMenu underscore mnemonics stripped (see
    /// [`strip_mnemonics`]). Empty when the item carries no label.
    pub label: String,
    /// Whether the item can be activated.
    pub enabled: bool,
    /// Whether the item should be shown at all.
    pub visible: bool,
    /// Standard row or a separator line.
    pub kind: TrayMenuItemKind,
    /// Present only for checkmark/radio items; carries the current on-state.
    pub toggle: Option<TrayToggle>,
    /// Nested submenu items (empty for leaves).
    pub children: Vec<TrayMenuItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayMenuItemKind {
    Standard,
    Separator,
}

/// Toggle state of a checkmark/radio menu item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrayToggle {
    pub kind: TrayToggleKind,
    /// True when the item is toggled on. DBusMenu's `Indeterminate` maps to
    /// `false` (neither on nor a distinct tri-state in the UI model).
    pub on: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayToggleKind {
    Check,
    Radio,
}

/// Command routed to the tray task; acts on an item by its bus address.
pub(crate) enum TrayCommand {
    /// Primary activation (left click): `Activate(x, y)` with x=y=0.
    Activate(String),
    /// Secondary activation (middle click): `SecondaryActivate(x, y)`, x=y=0.
    SecondaryActivate(String),
    /// DBusMenu `AboutToShow` on the root menu (id 0) before it is displayed,
    /// per the com.canonical.dbusmenu contract. Address is the item's bus name.
    MenuAboutToShow(String),
    /// DBusMenu `Event("clicked", ...)` for one item, with a proper timestamp
    /// supplied by the crate. Address is the item's bus name.
    MenuClicked { address: String, item_id: i32 },
}

/// Tray service task. Starts the SNI host, mirrors its item cache (items +
/// DBusMenu layouts) into a deterministic `TraySnapshot` on every change, and
/// routes activate / menu commands. Menu-update events refresh the tree in
/// place and re-emit; they never remove items from tracking.
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
                // zbus method calls (system-tray's activate/about-to-show
                // wrappers) have no default deadline, and this loop processes
                // one command at a time -- a single hung/broken SNI tray item
                // (never replying on the bus) would otherwise block every
                // OTHER item's clicks and every item add/remove/update event
                // indefinitely. crate::with_command_timeout bounds it so one
                // bad tray app degrades to "this click did nothing", not
                // "the whole tray is dead until the shell restarts".
                Some(cmd) => crate::with_command_timeout("tray", handle_command(&client, cmd)).await,
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
    let raw: Vec<(String, StatusNotifierItem, Option<SniMenu>)> = {
        let guard = map.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        guard
            .iter()
            .map(|(addr, (item, menu))| (addr.clone(), item.clone(), menu.clone()))
            .collect()
    };

    let mut items: Vec<TrayItem> = Vec::with_capacity(raw.len());
    for (address, item, menu) in &raw {
        let icon = resolve_icon_cached(item, theme, icon_cache).await;
        items.push(TrayItem {
            address: address.clone(),
            title: item.title.clone().unwrap_or_else(|| item.id.clone()),
            tooltip: tooltip_text(item),
            icon,
            menu: menu.as_ref().map(convert_menu),
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

/// Route a command to the SNI item / its DBusMenu.
///
/// Activate/SecondaryActivate use x=y=0 (we have no screen-position hint to
/// offer; items use it only to place their own popups). Menu commands need the
/// item's `com.canonical.dbusmenu` object path, which lives on the item's
/// `menu` property; we resolve it from the crate's item map by address.
async fn handle_command(client: &Client, cmd: TrayCommand) {
    match cmd {
        TrayCommand::Activate(address) => {
            activate(client, ActivateRequest::Default { address, x: 0, y: 0 }).await;
        }
        TrayCommand::SecondaryActivate(address) => {
            activate(client, ActivateRequest::Secondary { address, x: 0, y: 0 }).await;
        }
        TrayCommand::MenuAboutToShow(address) => {
            let Some(menu_path) = menu_path_for(client, &address) else {
                tracing::warn!("[tray] about-to-show: no menu path for {address}");
                return;
            };
            // Root menu id is 0 per the DBusMenu contract; ignore needsUpdate
            // (the crate refreshes the layout on its own layout-updated signal).
            if let Err(e) = client.about_to_show_menuitem(address, menu_path, 0).await {
                tracing::warn!("[tray] about-to-show failed: {e}");
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

/// Send an activate request, logging any failure. Shared by every command.
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

/// Convert the crate's DBusMenu layout into the plain [`TrayMenu`] the UI
/// renders. The crate's `TrayMenu.submenus` are the root menu's children.
fn convert_menu(menu: &SniMenu) -> TrayMenu {
    TrayMenu {
        items: menu.submenus.iter().map(convert_menu_item).collect(),
    }
}

/// Convert one DBusMenu item, recursing into its submenu. Maps the crate's
/// `menu_type`/`toggle_type`/`toggle_state` onto our flat model and strips
/// underscore mnemonics from the label.
fn convert_menu_item(item: &SniMenuItem) -> TrayMenuItem {
    let kind = match item.menu_type {
        MenuType::Separator => TrayMenuItemKind::Separator,
        MenuType::Standard => TrayMenuItemKind::Standard,
    };
    // DBusMenu `On` == toggled; `Off`/`Indeterminate` render as not-on.
    let on = item.toggle_state == ToggleState::On;
    let toggle = match item.toggle_type {
        ToggleType::Checkmark => Some(TrayToggle { kind: TrayToggleKind::Check, on }),
        ToggleType::Radio => Some(TrayToggle { kind: TrayToggleKind::Radio, on }),
        ToggleType::CannotBeToggled => None,
    };
    TrayMenuItem {
        id: item.id,
        label: item.label.as_deref().map(strip_mnemonics).unwrap_or_default(),
        enabled: item.enabled,
        visible: item.visible,
        kind,
        toggle,
        children: item.submenu.iter().map(convert_menu_item).collect(),
    }
}

/// Strip GTK/DBusMenu underscore mnemonics from a menu label. Per the
/// com.canonical.dbusmenu `label` contract: a doubled underscore "__" renders
/// as one literal underscore; any other underscore is a mnemonic marker and is
/// dropped. GTK does this transparently via the menu model (which AGS used);
/// we do it explicitly so labels read as plain text.
fn strip_mnemonics(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut chars = label.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '_' {
            if chars.peek() == Some(&'_') {
                chars.next();
                out.push('_');
            }
            // A lone underscore is a mnemonic marker: drop it.
        } else {
            out.push(c);
        }
    }
    out
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

    use system_tray::item::{Category, Status, Tooltip};

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

    /// Build a standard, enabled, visible fixture menu item.
    fn item(id: i32, label: Option<&str>) -> SniMenuItem {
        SniMenuItem {
            id,
            label: label.map(str::to_owned),
            enabled: true,
            visible: true,
            ..Default::default()
        }
    }

    #[test]
    fn strip_mnemonics_matches_dbusmenu_spec() {
        // Lone underscore is a mnemonic marker and vanishes.
        assert_eq!(strip_mnemonics("_File"), "File");
        assert_eq!(strip_mnemonics("Save _As"), "Save As");
        assert_eq!(strip_mnemonics("trailing_"), "trailing");
        // Doubled underscore renders as one literal underscore.
        assert_eq!(strip_mnemonics("a__b"), "a_b");
        assert_eq!(strip_mnemonics("__leading"), "_leading");
        // Mixed: markers drop, doubles collapse.
        assert_eq!(strip_mnemonics("_a__b_c"), "a_bc");
        // No markers: passthrough.
        assert_eq!(strip_mnemonics("no marker"), "no marker");
    }

    #[test]
    fn convert_menu_flattens_tree() {
        let sni = SniMenu {
            id: 0,
            submenus: vec![
                // A submenu with a nested item, a separator, and a doubled label.
                SniMenuItem {
                    submenu: vec![
                        item(11, Some("_Open")),
                        SniMenuItem {
                            menu_type: MenuType::Separator,
                            ..item(12, None)
                        },
                        item(13, Some("Save __as__")),
                    ],
                    ..item(1, Some("_File"))
                },
                // Checkmark, toggled on.
                SniMenuItem {
                    toggle_type: ToggleType::Checkmark,
                    toggle_state: ToggleState::On,
                    ..item(2, Some("Show _hidden"))
                },
                // Radio, off.
                SniMenuItem {
                    toggle_type: ToggleType::Radio,
                    toggle_state: ToggleState::Off,
                    ..item(3, Some("Option A"))
                },
                // Disabled + invisible flags carried through.
                SniMenuItem {
                    enabled: false,
                    ..item(4, Some("_Disabled"))
                },
                SniMenuItem {
                    visible: false,
                    ..item(5, Some("Hidden"))
                },
            ],
        };

        let menu = convert_menu(&sni);
        assert_eq!(menu.items.len(), 5);

        let file = &menu.items[0];
        assert_eq!(file.id, 1);
        assert_eq!(file.label, "File", "mnemonic marker stripped");
        assert!(file.enabled && file.visible);
        assert_eq!(file.kind, TrayMenuItemKind::Standard);
        assert_eq!(file.toggle, None);
        assert_eq!(file.children.len(), 3, "submenu recursed");
        assert_eq!(file.children[0].label, "Open");
        assert_eq!(file.children[1].kind, TrayMenuItemKind::Separator);
        assert_eq!(file.children[1].label, "", "separator has no label");
        assert_eq!(file.children[2].label, "Save _as_", "doubled underscore kept");

        assert_eq!(
            menu.items[1].toggle,
            Some(TrayToggle { kind: TrayToggleKind::Check, on: true }),
        );
        assert_eq!(
            menu.items[2].toggle,
            Some(TrayToggle { kind: TrayToggleKind::Radio, on: false }),
        );

        assert!(!menu.items[3].enabled, "disabled flag carried");
        assert!(!menu.items[4].visible, "invisible flag carried");
    }

    fn pixmap(width: i32, height: i32, pixel_count: usize) -> IconPixmap {
        IconPixmap { width, height, pixels: vec![0u8; pixel_count] }
    }

    #[test]
    fn largest_pixmap_picks_the_biggest_valid_one() {
        let pixmaps =
            vec![pixmap(16, 16, 1024), pixmap(64, 64, 16384), pixmap(32, 32, 4096)];
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
            IconPixmap { width: 32, height: 32, pixels: Vec::new() },
        ];
        assert!(largest_pixmap(&malformed).is_none(), "no valid pixmap among malformed entries");

        // A single valid entry among malformed ones is still found.
        let mixed = vec![pixmap(0, 64, 1024), pixmap(16, 16, 256)];
        let picked = largest_pixmap(&mixed).expect("the one valid entry is found");
        assert_eq!((picked.width, picked.height), (16, 16));
    }

    #[test]
    fn largest_pixmap_none_for_an_empty_list() {
        assert!(largest_pixmap(&[]).is_none());
    }

    /// Build a minimal `StatusNotifierItem` fixture with an optional tooltip.
    fn sni_item(tool_tip: Option<Tooltip>) -> StatusNotifierItem {
        StatusNotifierItem {
            id: "test".to_string(),
            category: Category::ApplicationStatus,
            title: None,
            status: Status::Active,
            window_id: 0,
            icon_theme_path: None,
            icon_name: None,
            icon_pixmap: None,
            overlay_icon_name: None,
            overlay_icon_pixmap: None,
            attention_icon_name: None,
            attention_icon_pixmap: None,
            attention_movie_name: None,
            tool_tip,
            item_is_menu: false,
            menu: None,
        }
    }

    fn tooltip(title: &str, description: &str) -> Tooltip {
        Tooltip {
            icon_name: String::new(),
            icon_data: Vec::new(),
            title: title.to_string(),
            description: description.to_string(),
        }
    }

    #[test]
    fn tooltip_text_joins_title_and_description() {
        let item = sni_item(Some(tooltip("Firefox", "3 unread tabs")));
        assert_eq!(tooltip_text(&item), Some("Firefox\n3 unread tabs".to_string()));
    }

    #[test]
    fn tooltip_text_falls_back_to_whichever_half_is_present() {
        assert_eq!(
            tooltip_text(&sni_item(Some(tooltip("Firefox", "")))),
            Some("Firefox".to_string()),
            "title only"
        );
        assert_eq!(
            tooltip_text(&sni_item(Some(tooltip("", "3 unread tabs")))),
            Some("3 unread tabs".to_string()),
            "description only"
        );
    }

    #[test]
    fn tooltip_text_trims_whitespace_and_treats_blank_as_absent() {
        // Both fields present but all-whitespace: no tooltip to show.
        assert_eq!(tooltip_text(&sni_item(Some(tooltip("   ", "\t\n")))), None);
        // No tool_tip at all.
        assert_eq!(tooltip_text(&sni_item(None)), None);
        // Padding around real content is trimmed.
        assert_eq!(
            tooltip_text(&sni_item(Some(tooltip("  Firefox  ", "")))),
            Some("Firefox".to_string())
        );
    }
}
