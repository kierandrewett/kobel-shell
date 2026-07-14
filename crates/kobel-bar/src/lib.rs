//! The complete presentation and layer-shell policy for the independent top bar.

use freya_core::prelude::*;
use kobel_wayland::{Anchor, KeyboardInteractivity, Margins, SurfaceConfig, SurfaceSize};
use torin::prelude::{Alignment, Size};

pub const SURFACE_HEIGHT: u32 = 40;
pub const OUTER_GAP: i32 = 8;

const SURFACE_RADIUS: f32 = 10.0;
const SURFACE_BACKGROUND: (u8, u8, u8) = (28, 29, 33);
const PRIMARY_TEXT: (u8, u8, u8) = (238, 239, 242);

/// The one component used by both the layer-shell process and native preview.
pub fn bar_app() -> impl IntoElement {
    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background(SURFACE_BACKGROUND)
        .corner_radius(SURFACE_RADIUS)
        .padding((0.0, 12.0))
        .horizontal()
        .cross_align(Alignment::Center)
        .child(label().text("Kobel bar").font_size(14.0).color(PRIMARY_TEXT))
}

/// Keep compositor geometry beside the component that owns it.
pub fn surface_config() -> SurfaceConfig {
    SurfaceConfig::new(
        "kobel-bar",
        SurfaceSize::Exact {
            width: 0,
            height: SURFACE_HEIGHT,
        },
        PreferredTheme::Dark,
    )
    .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
    .margins(Margins {
        top: OUTER_GAP,
        right: OUTER_GAP,
        bottom: 0,
        left: OUTER_GAP,
    })
    .exclusive_zone(OUTER_GAP + SURFACE_HEIGHT as i32)
    .keyboard_interactivity(KeyboardInteractivity::None)
}

#[cfg(test)]
mod tests {
    use freya_testing::launch_test;
    use kobel_wayland::{Anchor, KeyboardInteractivity, SurfaceSize};

    use super::{OUTER_GAP, SURFACE_HEIGHT, bar_app, surface_config};

    #[test]
    fn component_mounts_in_the_headless_runner() {
        let mut runner = launch_test(bar_app);
        runner.sync_and_update();
    }

    #[test]
    fn surface_spans_the_top_and_reserves_its_visual_height() {
        let config = surface_config();

        assert_eq!(
            config.size,
            SurfaceSize::Exact {
                width: 0,
                height: SURFACE_HEIGHT,
            }
        );
        assert_eq!(config.anchor, Anchor::TOP | Anchor::LEFT | Anchor::RIGHT);
        assert_eq!(config.exclusive_zone, OUTER_GAP + SURFACE_HEIGHT as i32);
        assert_eq!(config.keyboard_interactivity, KeyboardInteractivity::None);
    }
}
