use freya::prelude::*;

fn main() {
    launch(LaunchConfig::new().with_window(WindowConfig::new(kobel_ui::app).with_title("kobel-ui preview")))
}
