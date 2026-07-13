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
pub mod osd;

use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use torin::prelude::Size;

use crate::manager::{ShellBus, ShellMsg, SurfaceKey};
use crate::theme::{self, Rgb};

// -------------------------------------------------------------------------
// Icons
// -------------------------------------------------------------------------
//
// The shell ships its own symbolic icon set under ags/icons; every glyph uses
// `fill="currentColor"`, so `SvgViewer::color` (which overrides the SVG's
// currentColor at raster time) recolors each icon per state. Bytes are embedded
// at build time -- no runtime file IO, no theme lookup.

/// Embed a shell icon by file name, resolved relative to this crate's manifest.
macro_rules! shell_icon {
    ($file:literal) => {
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../ags/icons/hicolor/scalable/actions/",
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
        let mut hovered = use_state(|| false);

        let on = *hovered.read();
        let bg: Color = if on {
            theme::PANEL2.rgb().into()
        } else {
            Color::TRANSPARENT
        };
        let tint = if on { theme::TX } else { theme::MUT };
        let ctl = tokens.ctl();
        let target = self.target;

        rect()
            .width(Size::px(ctl))
            .height(Size::px(ctl))
            .center()
            .corner_radius(theme::RADIUS_BUTTON)
            .background(bg)
            .on_pointer_enter(move |_| hovered.set(true))
            .on_pointer_leave(move |_| hovered.set(false))
            .on_press(move |_| bus.send(ShellMsg::Toggle(target)))
            .child(icon(self.icon, self.icon_size, tint))
    }
}
