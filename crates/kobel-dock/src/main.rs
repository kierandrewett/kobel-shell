use freya_core::prelude::IntoElement;
use kobel_wayland::{OutputEvent, Shell};

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?;
    shell.on_output(|event, control| match event {
        OutputEvent::Added(output) => {
            match control.create_on(
                output,
                kobel_dock::surface_config(),
                |_| (),
                || kobel_dock::dock_app().into_element(),
            ) {
                Ok((surface, ())) => eprintln!("[dock] mounted {surface:?} on {output:?}"),
                Err(error) => eprintln!("[dock] failed to mount on {output:?}: {error:#}"),
            }
        }
        OutputEvent::SurfaceClosed { output, surface } => {
            eprintln!("[dock] surface {surface:?} closed on {output:?}");
        }
        OutputEvent::Removed { output, retired } => {
            eprintln!("[dock] output {output:?} removed; retired {retired:?}");
        }
    });
    shell.run()
}
