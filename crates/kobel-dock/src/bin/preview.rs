use freya::prelude::*;

fn main() {
    launch(
        LaunchConfig::new()
            .with_font(kobel_theme::FONT_FAMILY, kobel_theme::FONT_DATA)
            .with_window(
                WindowConfig::new(kobel_dock::dock_preview_app)
                    .with_title("Kobel dock preview")
                    .with_transparency(true)
                    .with_background(Color::TRANSPARENT)
                    .with_size(960.0, kobel_dock::SURFACE_HEIGHT as f64),
            ),
    );
}
