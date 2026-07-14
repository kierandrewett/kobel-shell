use freya::prelude::*;

fn main() {
    launch(
        LaunchConfig::new().with_window(
            WindowConfig::new(kobel_bar::bar_app)
                .with_title("Kobel bar preview")
                .with_transparency(true)
                .with_background(Color::TRANSPARENT)
                .with_size(1200.0, kobel_bar::SURFACE_HEIGHT as f64),
        ),
    );
}
