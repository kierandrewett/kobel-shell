//! The complete presentation and layer-shell policy for the independent dock.

use freya_core::prelude::*;
use kobel_wayland::{Anchor, KeyboardInteractivity, Margins, SurfaceConfig, SurfaceSize};
use torin::prelude::{Alignment, Size};

pub const SURFACE_WIDTH: u32 = 240;
pub const SURFACE_HEIGHT: u32 = 56;
pub const OUTER_GAP: i32 = 12;

const SURFACE_RADIUS: f32 = 14.0;
const SURFACE_BACKGROUND: (u8, u8, u8) = (28, 29, 33);
const PRIMARY_TEXT: (u8, u8, u8) = (238, 239, 242);

/// The one component used by both the layer-shell process and native preview.
pub fn dock_app() -> impl IntoElement {
    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background(SURFACE_BACKGROUND)
        .corner_radius(SURFACE_RADIUS)
        .horizontal()
        .main_align(Alignment::Center)
        .cross_align(Alignment::Center)
        .child(label().text("Kobel dock").font_size(14.0).color(PRIMARY_TEXT))
}

/// Keep compositor geometry beside the component that owns it.
pub fn surface_config() -> SurfaceConfig {
    SurfaceConfig::new(
        "kobel-dock",
        SurfaceSize::Exact {
            width: SURFACE_WIDTH,
            height: SURFACE_HEIGHT,
        },
        PreferredTheme::Dark,
    )
    .anchor(Anchor::BOTTOM)
    .margins(Margins {
        top: 0,
        right: 0,
        bottom: OUTER_GAP,
        left: 0,
    })
    .exclusive_zone(OUTER_GAP + SURFACE_HEIGHT as i32)
    .keyboard_interactivity(KeyboardInteractivity::None)
}

#[cfg(test)]
mod tests {
    use freya_testing::launch_test;
    use kobel_wayland::{Anchor, KeyboardInteractivity, SurfaceSize};

    use super::{OUTER_GAP, SURFACE_HEIGHT, SURFACE_WIDTH, dock_app, surface_config};

    #[test]
    fn component_mounts_in_the_headless_runner() {
        let mut runner = launch_test(dock_app);
        runner.sync_and_update();
    }

    #[test]
    fn surface_is_bottom_anchored_and_reserves_its_visual_height() {
        let config = surface_config();

        assert_eq!(
            config.size,
            SurfaceSize::Exact {
                width: SURFACE_WIDTH,
                height: SURFACE_HEIGHT,
            }
        );
        assert_eq!(config.anchor, Anchor::BOTTOM);
        assert_eq!(config.exclusive_zone, OUTER_GAP + SURFACE_HEIGHT as i32);
        assert_eq!(config.keyboard_interactivity, KeyboardInteractivity::None);
    }
}
