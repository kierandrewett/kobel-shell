//! Freedesktop icon-theme lookup shared by `apps.rs` (desktop-entry icons) and
//! `tray.rs` (StatusNotifierItem icons). Previously two independently-maintained
//! copies of the same SVG/raster resolution policy and "current icon theme"
//! read, which risked silently diverging (a fix landed in one copy but not the
//! other) -- both callers now share this single source of truth. Icon-source
//! specific concerns (a desktop entry's absolute-path `Icon=` values, an SNI
//! item's app-shipped `IconThemePath`) stay in their respective callers.

use std::path::PathBuf;

/// Requested icon pixel size for the RASTER fallback theme lookup. The primary
/// pass prefers a scalable SVG (see [`lookup_icon_name`]); this is only used for
/// png-only themes/apps, where the crate picks the nearest available raster size.
pub(crate) const ICON_SIZE: u16 = 64;

/// Size requested for the SVG-preferring first pass. Deliberately large so
/// freedesktop-icons' closest-size match ranks the theme's `scalable` directory
/// ahead of any same-name fixed-size raster directory (the crate's `force_svg`
/// only prefers SVG *within* a directory, and its exact-size match is
/// directory-order dependent, so `with_size(64).force_svg()` alone can still
/// return a 64px PNG that shadows the scalable SVG).
pub(crate) const SCALABLE_ICON_SIZE: u16 = 512;

/// Look up an icon NAME in the freedesktop theme, strongly preferring a scalable
/// SVG so scaled/HiDPI sessions get a crisp vector instead of a small raster that
/// the shell (and then the compositor) upscale. Two passes:
///   1. request a large size with `force_svg` and accept it only if it actually
///      resolved to a `.svg` (see [`SCALABLE_ICON_SIZE`] for why the large size is
///      needed on top of `force_svg`);
///   2. otherwise fall back to the nearest raster at [`ICON_SIZE`] for png-only
///      themes/apps. The crate handles Inherits -> hicolor -> /usr/share/pixmaps
///      fallback on its own.
pub(crate) fn lookup_icon_name(name: &str, theme: Option<&str>) -> Option<PathBuf> {
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
///
/// This shells out synchronously; callers on the single-worker tokio runtime
/// MUST run it via `spawn_blocking` (see tray.rs's `run()`) rather than calling
/// it directly on an async task.
pub(crate) fn current_icon_theme() -> Option<String> {
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
