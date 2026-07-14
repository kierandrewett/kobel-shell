use freya_core::prelude::IntoElement;
use kobel_wayland::{OutputEvent, Shell};

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?;
    shell.on_output(|event, control| match event {
        OutputEvent::Added(output) => {
            match control.create_on(
                output,
                kobel_bar::surface_config(),
                |_| (),
                || kobel_bar::bar_app().into_element(),
            ) {
                Ok((surface, ())) => eprintln!("[bar] mounted {surface:?} on {output:?}"),
                Err(error) => eprintln!("[bar] failed to mount on {output:?}: {error:#}"),
            }
        }
        OutputEvent::SurfaceClosed { output, surface } => {
            eprintln!("[bar] surface {surface:?} closed on {output:?}");
        }
        OutputEvent::Removed { output, retired } => {
            eprintln!("[bar] output {output:?} removed; retired {retired:?}");
        }
    });
    shell.run()
}
