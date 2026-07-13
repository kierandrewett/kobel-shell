//! Shared UI building blocks for the kobel shell surfaces.
//!
//! Design-system driven: every color/size/radius comes from [`crate::theme`],
//! every motion from [`crate::motion`]. Behaviour ports the AGS widgets
//! (ags/widget/Bar.tsx, ags/widget/OSD.tsx) -- the behaviour, not the GTK
//! mechanisms. See docs/FREYA-PLAN.md sections 2 and 6.
//!
//! Component entry points live in the submodules:
//!   - [`bar::bar`] -- the top bar slab.
//!   - [`osd::osd`] -- the display-only volume pill.

pub mod bar;
pub mod calendar;
pub mod chip;
pub mod dock;
pub mod fuzzy;
pub mod launcher;
pub mod osd;
pub mod notifications;
pub mod panels;
pub mod quick_settings;
pub mod session;

use std::path::PathBuf;

use freya_components::image_viewer::ImageViewer;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use torin::prelude::Size;

use chip::{HoverShape, hover_button, use_hover};

use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::theme::{self, Rgb};

// -------------------------------------------------------------------------
// Icons
// -------------------------------------------------------------------------
//
// The shell ships its own symbolic icon set under crates/kobel-shell/assets; every glyph uses
// `fill="currentColor"`, so `SvgViewer::color` (which overrides the SVG's
// currentColor at raster time) recolors each icon per state. Bytes are embedded
// at build time -- no runtime file IO, no theme lookup.

/// Embed a shell icon by file name, resolved relative to this crate's manifest.
macro_rules! shell_icon {
    ($file:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/assets/hicolor/scalable/actions/",
            $file
        ))
    };
}

pub const ICON_MAGNIFIER: &[u8] = shell_icon!("kobel-magnifying-glass-symbolic.svg");
pub const ICON_SPEAKER_WAVE: &[u8] = shell_icon!("kobel-speaker-wave-symbolic.svg");
pub const ICON_SPEAKER_MUTE: &[u8] = shell_icon!("kobel-speaker-mute-symbolic.svg");
pub const ICON_BELL: &[u8] = shell_icon!("kobel-bell-symbolic.svg");
pub const ICON_POWER: &[u8] = shell_icon!("kobel-power-symbolic.svg");
pub const ICON_BATTERY: &[u8] = shell_icon!("kobel-battery-symbolic.svg");
/// Generic app glyph: placeholder for an unresolved dock pin or an app with no
/// resolved icon file (ags/widget/Dock.tsx `kobel-app-symbolic`).
pub const ICON_APP: &[u8] = shell_icon!("kobel-app-symbolic.svg");
/// Media tile glyph when no player art is available (dock `kobel-music-symbolic`).
pub const ICON_MUSIC: &[u8] = shell_icon!("kobel-music-symbolic.svg");
/// Symbolic icons used by launcher result rows (`:` commands, calculator, web,
/// session actions). All ship under crates/kobel-shell/assets and tint via `currentColor`.
pub const ICON_TERMINAL: &[u8] = shell_icon!("kobel-terminal-symbolic.svg");
pub const ICON_CALCULATOR: &[u8] = shell_icon!("kobel-calculator-symbolic.svg");
pub const ICON_GLOBE: &[u8] = shell_icon!("kobel-globe-symbolic.svg");
pub const ICON_LOCK: &[u8] = shell_icon!("kobel-lock-symbolic.svg");
pub const ICON_MOON: &[u8] = shell_icon!("kobel-moon-symbolic.svg");
pub const ICON_LOGOUT: &[u8] = shell_icon!("kobel-logout-symbolic.svg");
pub const ICON_RESTART: &[u8] = shell_icon!("kobel-restart-symbolic.svg");
/// Quick-settings glyphs (chip grid, sliders, drill headers, gnoblin banner).
/// All ship under crates/kobel-shell/assets and tint via `currentColor`.
pub const ICON_WIFI: &[u8] = shell_icon!("kobel-wifi-symbolic.svg");
pub const ICON_WIFI_OFF: &[u8] = shell_icon!("kobel-wifi-off-symbolic.svg");
pub const ICON_BLUETOOTH: &[u8] = shell_icon!("kobel-bluetooth-symbolic.svg");
pub const ICON_BOLT: &[u8] = shell_icon!("kobel-bolt-symbolic.svg");
pub const ICON_BELL_SLASH: &[u8] = shell_icon!("kobel-bell-slash-symbolic.svg");
pub const ICON_SUN: &[u8] = shell_icon!("kobel-sun-symbolic.svg");
pub const ICON_BRIGHTNESS: &[u8] = shell_icon!("kobel-brightness-symbolic.svg");
pub const ICON_CHEVRON_LEFT: &[u8] = shell_icon!("kobel-chevron-left-symbolic.svg");
pub const ICON_CHEVRON_RIGHT: &[u8] = shell_icon!("kobel-chevron-right-symbolic.svg");
pub const ICON_WARNING: &[u8] = shell_icon!("kobel-warning-symbolic.svg");
pub const ICON_LEAF: &[u8] = shell_icon!("kobel-leaf-symbolic.svg");
pub const ICON_CHECK: &[u8] = shell_icon!("kobel-check-symbolic.svg");
/// Notification-surface glyphs (toast/drawer cards, header, media card). All ship
/// under crates/kobel-shell/assets and tint via `currentColor`.
pub const ICON_CLOSE: &[u8] = shell_icon!("kobel-close-symbolic.svg");
pub const ICON_TRASH: &[u8] = shell_icon!("kobel-trash-symbolic.svg");
pub const ICON_DISC: &[u8] = shell_icon!("kobel-disc-symbolic.svg");
pub const ICON_PLAY: &[u8] = shell_icon!("kobel-play-symbolic.svg");
pub const ICON_PAUSE: &[u8] = shell_icon!("kobel-pause-symbolic.svg");
pub const ICON_SKIP_BACK: &[u8] = shell_icon!("kobel-skip-back-symbolic.svg");
pub const ICON_SKIP_FWD: &[u8] = shell_icon!("kobel-skip-fwd-symbolic.svg");

/// Render a `currentColor` SVG icon, tinted to `tint` and laid out `size` square.
/// The one place SVG tinting is expressed for the whole shell.
pub fn icon(bytes: &'static [u8], size: f32, tint: Rgb) -> SvgViewer {
    SvgViewer::new(bytes)
        .color(tint.rgb())
        .width(Size::px(size))
        .height(Size::px(size))
}

// -------------------------------------------------------------------------
// IconButton
// -------------------------------------------------------------------------

/// A bar icon button (`ags/style/main.scss` `.ibtn`): a `ctl()`-sized square that
/// toggles an on-demand surface through the [`ShellBus`]. Resting state is a muted
/// glyph on a transparent slab; on hover it lifts to `PANEL2` with a `TX` glyph.
///
/// Each button is its own component so its hover state lives in an isolated scope
/// and `PartialEq` lets Freya skip it when neither the icon nor the target change.
#[derive(PartialEq)]
pub struct IconButton {
    /// Embedded SVG bytes (a `pub const ICON_*`).
    pub icon: &'static [u8],
    /// Glyph size in layout px (scss uses 15 for bar ibtn icons).
    pub icon_size: f32,
    /// Surface toggled on press.
    pub target: SurfaceKey,
}

impl Component for IconButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let tokens = *use_consume::<State<theme::Tokens>>().read();
        let hover = use_hover();

        let on = hover.on();
        let tint = if on { theme::TX } else { theme::MUT };
        let ctl = tokens.ctl();
        let target = self.target;

        hover_button(
            hover,
            HoverShape::Square { side: ctl },
            theme::RADIUS_BUTTON,
            Color::TRANSPARENT,
            theme::PANEL2.rgb().into(),
            move |_| bus.send(ShellMsg::Toggle(target)),
        )
        .child(icon(self.icon, self.icon_size, tint))
    }
}

// -------------------------------------------------------------------------
// App icons (shared: dock tiles + launcher tiles/rows)
// -------------------------------------------------------------------------

/// A loaded icon: parsed once from its file. The cache key (its path string)
/// travels with the bytes so a Some(old)->Some(new) path change can never cache
/// stale bytes under the new key.
#[derive(Debug, Clone, PartialEq)]
enum IconData {
    Svg(String, Bytes),
    Raster(String, Bytes),
    /// No path, or the file could not be read -> caller draws a glyph fallback.
    Missing,
}

/// Read an icon file into bytes and classify it svg vs raster by extension
/// (the contract resolves each entry to a concrete `.svg`/`.png` path).
fn load_icon(path: &Option<PathBuf>) -> IconData {
    let Some(path) = path else {
        return IconData::Missing;
    };
    let Ok(bytes) = std::fs::read(path) else {
        return IconData::Missing;
    };
    let key = path.to_string_lossy().into_owned();
    let is_svg = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("svg"));
    let bytes = Bytes::from(bytes);
    if is_svg {
        IconData::Svg(key, bytes)
    } else {
        IconData::Raster(key, bytes)
    }
}

/// One app icon rendered from a resolved icon path (dock tile, launcher tile or
/// row). Its own component so the memoized (blocking) byte-load survives
/// frequent re-renders, re-running only when the path itself changes.
#[derive(PartialEq)]
pub(crate) struct AppIcon {
    pub path: Option<PathBuf>,
    pub size: f32,
}

impl Component for AppIcon {
    fn render(&self) -> impl IntoElement {
        // React to path changes, and memoize the (blocking) read so churn never
        // re-reads the file.
        let path = use_reactive(&self.path);
        let data = use_memo(move || load_icon(&path.read()));
        let size = self.size;

        let data = data.read();
        match &*data {
            IconData::Svg(key, bytes) => SvgViewer::new((key.clone(), bytes.clone()))
                .width(Size::px(size))
                .height(Size::px(size))
                .into_element(),
            IconData::Raster(key, bytes) => ImageViewer::new((key.clone(), bytes.clone()))
                .width(Size::px(size))
                .height(Size::px(size))
                .into_element(),
            IconData::Missing => icon(ICON_APP, size, theme::MUT).into_element(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_missing_when_no_path() {
        assert_eq!(load_icon(&None), IconData::Missing);
        assert_eq!(load_icon(&Some(PathBuf::from("/no/such/icon.svg"))), IconData::Missing);
    }
}
