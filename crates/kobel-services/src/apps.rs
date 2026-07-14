//! Desktop applications service: desktop-entry scan, icon resolution, launch.
//! CONTRACT TYPES are stable; the service machinery behind them is implemented
//! by the apps service task (phase 3, docs/FREYA-PLAN.md section 5).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use freedesktop_desktop_entry::{DesktopEntry, default_paths, desktop_entries, get_languages_from_env};
use futures_util::StreamExt;
use inotify::{Inotify, WatchMask};
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
            self.apps
                .iter()
                .find(|a| a.id.rsplit('.').next().unwrap_or(&a.id).to_lowercase() == last)
        })
    }
}

/// Command routed to the apps task.
pub(crate) enum AppsCommand {
    /// Launch a desktop application by its desktop id.
    Launch(String),
}

/// A burst of filesystem events (a package manager writing several files, or an
/// app installer copying icon + .desktop + mimeinfo) coalesces into ONE rescan
/// fired this long after the LAST event in the burst -- mirrors notifd.rs's
/// `PERSIST_DEBOUNCE` dirty-flag pattern, just longer: install/uninstall is a
/// multi-file filesystem operation that can legitimately take a couple of
/// seconds, and rescanning mid-write risks reading a half-written .desktop file.
const RESCAN_DEBOUNCE: Duration = Duration::from_secs(2);

/// Apps service task: scan desktop entries once at startup, emit the snapshot,
/// then watch the XDG applications dirs (inotify) and re-emit on any install/
/// uninstall/edit, alongside servicing launch commands.
pub(crate) async fn run(events: UnboundedSender<ServiceEvent>, mut cmd_rx: UnboundedReceiver<AppsCommand>) {
    // Scanning hits the filesystem (hundreds of .desktop files) plus one
    // gsettings subprocess; keep it off the single tokio worker thread.
    let (snapshot, mut paths) = match tokio::task::spawn_blocking(scan).await {
        Ok(result) => result,
        Err(e) => {
            tracing::warn!("[apps] scan task failed: {e}");
            (AppsSnapshot::default(), HashMap::new())
        }
    };
    tracing::info!("[apps] scanned {} visible entries", snapshot.apps.len());
    let _ = events.send(ServiceEvent::Apps(snapshot));

    let mut watch_stream = init_watcher();
    let mut dirty = false;
    let debounce = tokio::time::sleep(RESCAN_DEBOUNCE);
    tokio::pin!(debounce);

    loop {
        tokio::select! {
            // `Option<EventStream>::next()` via a match on the Option itself
            // (not `Some(...) =`) so a missing watcher (init failed entirely)
            // makes this arm permanently pending rather than looping hot on
            // `None` -- the command branch below still works either way.
            maybe_event = async {
                match watch_stream.as_mut() {
                    Some(s) => s.next().await,
                    None => std::future::pending().await,
                }
            } => {
                match maybe_event {
                    Some(Ok(event)) => {
                        tracing::debug!("[apps] fs change: {:?} {:?}", event.mask, event.name);
                        dirty = true;
                        debounce.as_mut().reset(tokio::time::Instant::now() + RESCAN_DEBOUNCE);
                    }
                    Some(Err(e)) => tracing::warn!("[apps] inotify read failed: {e}"),
                    None => {
                        tracing::warn!("[apps] inotify stream ended; app list will not auto-refresh");
                        watch_stream = None;
                    }
                }
            }
            () = &mut debounce, if dirty => {
                dirty = false;
                match tokio::task::spawn_blocking(scan).await {
                    Ok((snapshot, new_paths)) => {
                        tracing::info!(
                            "[apps] directory change -> rescanned {} entries",
                            snapshot.apps.len()
                        );
                        paths = new_paths;
                        let _ = events.send(ServiceEvent::Apps(snapshot));
                    }
                    Err(e) => tracing::warn!("[apps] rescan task failed: {e}"),
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(AppsCommand::Launch(id)) => launch(&paths, &id),
                    None => break,
                }
            }
        }
    }
}

/// Bind an inotify watch to every XDG applications directory that currently
/// exists (`freedesktop_desktop_entry::default_paths()` -- the SAME directory
/// list [`scan`] reads, so the watch can never drift from what is actually
/// scanned). A directory that doesn't exist yet (e.g. `~/.local/share/
/// applications` before the user has ever installed a user-local app) is
/// skipped, not fatal -- inotify can't watch a path that isn't there, and one
/// missing dir shouldn't cost watching the rest. Returns `None` only if the
/// inotify instance itself couldn't be created (e.g. fd/resource exhaustion) or
/// not a single directory could be watched -- the app list still works, it just
/// won't auto-refresh until next process start.
///
/// Only the top-level `applications/` directories are watched (not a recursive
/// walk of subdirectories, unlike the scanner's own `Iter`, which does recurse)
/// -- real-world package-installed desktop entries are essentially always flat;
/// a custom vendor layout nesting entries in subdirectories is a known, accepted
/// gap (a rescan still happens on any change to the top-level directory itself,
/// e.g. a subdirectory being created, just not to files written deeper inside).
fn init_watcher() -> Option<inotify::EventStream<[u8; 1024]>> {
    let inotify = match Inotify::init() {
        Ok(i) => i,
        Err(e) => {
            tracing::warn!("[apps] inotify init failed: {e}; app list will not auto-refresh");
            return None;
        }
    };
    let mask = WatchMask::CREATE | WatchMask::DELETE | WatchMask::MODIFY | WatchMask::MOVED_FROM | WatchMask::MOVED_TO;
    let mut watched = 0usize;
    for dir in default_paths() {
        if !dir.is_dir() {
            continue;
        }
        match inotify.watches().add(&dir, mask) {
            Ok(_) => {
                watched += 1;
                tracing::debug!("[apps] watching {}", dir.display());
            }
            Err(e) => tracing::warn!("[apps] failed to watch {}: {e}", dir.display()),
        }
    }
    if watched == 0 {
        tracing::warn!("[apps] no applications directories could be watched; app list will not auto-refresh");
        return None;
    }
    match inotify.into_event_stream([0; 1024]) {
        Ok(stream) => Some(stream),
        Err(e) => {
            tracing::warn!("[apps] failed to create inotify event stream: {e}");
            None
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
        let icon = entry.icon().and_then(|icon| resolve_icon(icon, theme.as_deref()));
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
    apps.sort_by_key(|a| a.name.to_lowercase());

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

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str) -> AppEntry {
        AppEntry {
            id: id.to_string(),
            name: name.to_string(),
            icon: None,
            keywords: Vec::new(),
        }
    }

    #[test]
    fn add_keyword_trims_lowercases_and_skips_blanks() {
        let mut keywords = Vec::new();
        add_keyword(&mut keywords, "  Firefox  ");
        add_keyword(&mut keywords, "");
        add_keyword(&mut keywords, "   ");
        assert_eq!(keywords, vec!["firefox".to_string()]);
    }

    #[test]
    fn add_keyword_deduplicates_case_insensitively() {
        let mut keywords = Vec::new();
        add_keyword(&mut keywords, "Web Browser");
        add_keyword(&mut keywords, "web browser");
        add_keyword(&mut keywords, "WEB BROWSER");
        assert_eq!(keywords, vec!["web browser".to_string()]);
    }

    #[test]
    fn add_keyword_keeps_distinct_terms_in_insertion_order() {
        let mut keywords = Vec::new();
        add_keyword(&mut keywords, "Firefox");
        add_keyword(&mut keywords, "Web Browser");
        add_keyword(&mut keywords, "Internet");
        assert_eq!(keywords, vec!["firefox", "web browser", "internet"]);
    }

    #[test]
    fn by_id_matches_exact_desktop_id_first() {
        let snap = AppsSnapshot {
            apps: vec![
                app("org.gnome.Nautilus", "Files"),
                app("org.mozilla.firefox", "Firefox"),
            ],
        };
        assert_eq!(snap.by_id("org.gnome.Nautilus").map(|a| a.name.as_str()), Some("Files"));
    }

    #[test]
    fn by_id_falls_back_to_last_dot_component_case_insensitively() {
        // A loose pin (e.g. "Firefox" or "firefox") matches the desktop id's
        // last dot-component the way the AGS dock's pin resolution did.
        let snap = AppsSnapshot {
            apps: vec![app("org.mozilla.firefox", "Firefox")],
        };
        assert_eq!(snap.by_id("firefox").map(|a| a.name.as_str()), Some("Firefox"));
        assert_eq!(snap.by_id("Firefox").map(|a| a.name.as_str()), Some("Firefox"));
        assert_eq!(snap.by_id("FIREFOX").map(|a| a.name.as_str()), Some("Firefox"));
    }

    #[test]
    fn by_id_returns_none_when_nothing_matches() {
        let snap = AppsSnapshot {
            apps: vec![app("org.mozilla.firefox", "Firefox")],
        };
        assert!(snap.by_id("org.gnome.Nautilus").is_none());
        assert!(snap.by_id("nautilus").is_none());
    }

    #[test]
    fn by_id_on_an_empty_snapshot_never_panics() {
        let snap = AppsSnapshot::default();
        assert!(snap.by_id("anything").is_none());
    }
}
