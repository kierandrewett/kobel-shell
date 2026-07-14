use freya_core::prelude::IntoElement;
use kobel_wayland::Shell;

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?;
    shell.create_surface(kobel_dock::surface_config(), || kobel_dock::dock_app().into_element())?;
    shell.run()
}
