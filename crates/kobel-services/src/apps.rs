//! Desktop applications service: desktop-entry scan, icon resolution, launch.
//! CONTRACT TYPES are stable; the service machinery behind them is implemented
//! by the apps service task (phase 3, docs/FREYA-PLAN.md section 5).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;

use freedesktop_desktop_entry::{DesktopEntry, desktop_entries, get_languages_from_env};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

use crate::ServiceEvent;

/// Requested icon pixel size for the RASTER fallback theme lookup. The primary
/// pass prefers a scalable SVG (see [`lookup_icon_name`]); this is only used for
/// png-only themes/apps, where the crate picks the nearest available raster size.
const ICON_SIZE: u16 = 64;

/// Size requested for the SVG-preferring first pass. Deliberately large so
/// freedesktop-icons' closest-size match ranks the theme's `scalable` directory
/// ahead of any same-name fixed-size raster directory (the crate's `force_svg`
/// only prefers SVG *within* a directory, and its exact-size match is
/// directory-order dependent, so `with_size(64).force_svg()` alone can still
/// return a 64px PNG that shadows the scalable SVG).
const SCALABLE_ICON_SIZE: u16 = 512;

/// One resolved desktop application.
#[derive(Debug, Clone, PartialEq)]
pub struct AppEntry {
    /// Desktop file id, e.g. `org.gnome.Nautilus` (no `.desktop` suffix).
    pub id: String,
    /// Display name from the entry.
    pub name: String,
    /// Resolved icon file (theme lookup already done; png or svg path).
    pub icon: Option<PathBuf>,
    /// Search terms (name + keywords + generic name), lowercased, for the launcher.
    pub keywords: Vec<String>,
}

/// The full resolved application list. Emitted once at startup and again when
/// the desktop-entry directories change.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AppsSnapshot {
    pub apps: Vec<AppEntry>,
}

impl AppsSnapshot {
    /// Look up an entry by desktop id (exact match, then last-dot-component
    /// fallback like the AGS dock used for loose pins).
    pub fn by_id(&self, id: &str) -> Option<&AppEntry> {
        self.apps.iter().find(|a| a.id == id).or_else(|| {
            let last = id.rsplit('.').next().unwrap_or(id).to_lowercase();
            self.apps.iter().find(|a| {
                a.id.rsplit('.').next().unwrap_or(&a.id).to_lowercase() == last
            })
        })
    }
}

/// Command routed to the apps task.
pub(crate) enum AppsCommand {
    /// Launch a desktop application by its desktop id.
    Launch(String),
}

/// Apps service task: scan desktop entries once at startup, emit the snapshot,
/// then service launch commands. Directory watching is a later phase.
pub(crate) async fn run(
    events: UnboundedSender<ServiceEvent>,
    mut cmd_rx: UnboundedReceiver<AppsCommand>,
) {
    // Scanning hits the filesystem (hundreds of .desktop files) plus one
    // gsettings subprocess; keep it off the single tokio worker thread.
    let (snapshot, paths) = match tokio::task::spawn_blocking(scan).await {
        Ok(result) => result,
        Err(e) => {
            tracing::warn!("[apps] scan task failed: {e}");
            (AppsSnapshot::default(), HashMap::new())
        }
    };
    tracing::info!("[apps] scanned {} visible entries", snapshot.apps.len());
    let _ = events.send(ServiceEvent::Apps(snapshot));

    // TODO: watch the XDG applications dirs (inotify) and re-emit AppsSnapshot on
    // change. This phase emits the startup snapshot only.
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            AppsCommand::Launch(id) => launch(&paths, &id),
        }
    }
}

/// Scan every visible desktop entry across XDG_DATA_HOME + XDG_DATA_DIRS. Returns
/// the UI snapshot plus an id -> .desktop file-path map used by `LaunchApp`.
fn scan() -> (AppsSnapshot, HashMap<String, PathBuf>) {
    let locales = get_languages_from_env();
    let theme = current_icon_theme();
    let entries = desktop_entries(&locales);

    let mut apps = Vec::new();
    let mut paths = HashMap::new();
    let mut seen = HashSet::new();
    for entry in &entries {
        if entry.no_display() || entry.hidden() {
            continue;
        }
        let id = entry.id().to_owned();
        // `desktop_entries` yields XDG_DATA_HOME dirs before XDG_DATA_DIRS; the
        // first entry for an id is the highest-precedence one, so keep it.
        if !seen.insert(id.clone()) {
            continue;
        }
        let name = entry
            .name(&locales)
            .map(|n| n.into_owned())
            .unwrap_or_else(|| id.clone());
        let icon = entry
            .icon()
            .and_then(|icon| resolve_icon(icon, theme.as_deref()));
        let keywords = build_keywords(entry, &name, &locales);
        paths.insert(id.clone(), entry.path.clone());
        apps.push(AppEntry {
            id,
            name,
            icon,
            keywords,
        });
    }
    // Stable, case-insensitive display order (fuzzy/frecency ranking is a later
    // phase); dedup already guarantees unique ids so ordering is cosmetic.
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    (AppsSnapshot { apps }, paths)
}

/// Search terms for the launcher: lowercased name + GenericName + Keywords,
/// de-duplicated, blanks dropped.
fn build_keywords(entry: &DesktopEntry, name: &str, locales: &[String]) -> Vec<String> {
    let mut keywords = Vec::new();
    add_keyword(&mut keywords, name);
    if let Some(generic) = entry.generic_name(locales) {
        add_keyword(&mut keywords, &generic);
    }
    if let Some(list) = entry.keywords(locales) {
        for keyword in list {
            add_keyword(&mut keywords, &keyword);
        }
    }
    keywords
}

fn add_keyword(keywords: &mut Vec<String>, value: &str) {
    let value = value.trim().to_lowercase();
    if !value.is_empty() && !keywords.iter().any(|k| k == &value) {
        keywords.push(value);
    }
}

/// Resolve an `Icon=` value to a concrete file. Absolute paths pass through;
/// names go through the SVG-preferring freedesktop theme lookup.
fn resolve_icon(icon: &str, theme: Option<&str>) -> Option<PathBuf> {
    if icon.is_empty() {
        return None;
    }
    let path = Path::new(icon);
    if path.is_absolute() {
        return path.exists().then(|| path.to_path_buf());
    }
    lookup_icon_name(icon, theme)
}

/// Look up an icon NAME in the freedesktop theme, strongly preferring a scalable
/// SVG so scaled/HiDPI sessions get a crisp vector instead of a small raster that
/// the shell (and then the compositor) upscale. Two passes:
///   1. request a large size with `force_svg` and accept it only if it actually
///      resolved to a `.svg` (see [`SCALABLE_ICON_SIZE`] for why the large size is
///      needed on top of `force_svg`);
///   2. otherwise fall back to the nearest raster at [`ICON_SIZE`] for png-only
///      themes/apps. The crate handles Inherits -> hicolor -> /usr/share/pixmaps
///      fallback on its own.
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

/// The user's current icon theme directory name, read straight from gsettings.
/// We use the raw value (the theme dir key freedesktop-icons indexes by) rather
/// than `default_theme_gtk`, whose returned display name can miss the lookup.
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

/// Launch an app DETACHED via `gio launch <desktop-file>` -- gio applies the
/// correct env / D-Bus activation semantics for ~zero code. We reap the
/// short-lived gio process so it never zombies; the app itself stays detached.
fn launch(paths: &HashMap<String, PathBuf>, id: &str) {
    let Some(path) = paths.get(id) else {
        tracing::warn!("[apps] launch: unknown app id '{id}'");
        return;
    };
    match tokio::process::Command::new("gio")
        .arg("launch")
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(mut child) => {
            tracing::info!("[apps] launching '{id}' via gio launch");
            let id = id.to_owned();
            tokio::spawn(async move {
                match child.wait().await {
                    Ok(status) if !status.success() => {
                        tracing::warn!("[apps] gio launch for '{id}' exited: {status}");
                    }
                    Err(e) => tracing::warn!("[apps] gio launch wait failed: {e}"),
                    _ => {}
                }
            });
        }
        Err(e) => tracing::warn!("[apps] launch '{id}' failed to spawn gio: {e}"),
    }
}
