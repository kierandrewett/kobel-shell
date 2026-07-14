use freya::prelude::*;

fn main() {
    launch(
        LaunchConfig::new().with_window(
            WindowConfig::new(kobel_dock::dock_app)
                .with_title("Kobel dock preview")
                .with_transparency(true)
                .with_background(Color::TRANSPARENT)
                .with_size(kobel_dock::SURFACE_WIDTH as f64, kobel_dock::SURFACE_HEIGHT as f64),
        ),
    );
}
