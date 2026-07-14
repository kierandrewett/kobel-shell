use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use freya_core::prelude::IntoElement;
use kobel_bar::{BarContext, BarSnapshots};
use kobel_services::{ServiceCapability, ServiceSet, Services};
use kobel_wayland::{OutputEvent, Shell, SurfaceId};

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?.with_font(kobel_theme::FONT_FAMILY, kobel_theme::FONT_DATA);
    let contexts = Rc::new(RefCell::new(HashMap::<SurfaceId, BarContext>::new()));
    let latest = Rc::new(RefCell::new(BarSnapshots::default()));

    let (service_tx, service_rx) = std::sync::mpsc::channel();
    let service_waker = shell.waker();
    let _services = Services::spawn_with(
        ServiceSet::empty()
            .with(ServiceCapability::Audio)
            .with(ServiceCapability::Battery)
            .with(ServiceCapability::Network),
        move |event| {
            if service_tx.send(event).is_ok() {
                service_waker.wake();
            }
        },
    );

    shell.on_output({
        let contexts = contexts.clone();
        let latest = latest.clone();
        move |event, control| match event {
            OutputEvent::Added(output) => {
                let snapshots = latest.borrow().clone();
                match control.create_on(
                    output,
                    kobel_bar::surface_config(),
                    move |surface_contexts| surface_contexts.provide(move || BarContext::from_snapshots(&snapshots)),
                    || kobel_bar::bar_app().into_element(),
                ) {
                    Ok((surface, context)) => {
                        contexts.borrow_mut().insert(surface, context);
                        eprintln!("[bar] mounted {surface:?} on {output:?}");
                    }
                    Err(error) => eprintln!("[bar] failed to mount on {output:?}: {error:#}"),
                }
            }
            OutputEvent::SurfaceClosed { output, surface } => {
                contexts.borrow_mut().remove(&surface);
                eprintln!("[bar] surface {surface:?} closed on {output:?}");
            }
            OutputEvent::Removed { output, retired } => {
                let mut contexts = contexts.borrow_mut();
                for surface in retired {
                    contexts.remove(&surface);
                }
                eprintln!("[bar] output {output:?} removed");
            }
        }
    });

    shell.on_tick({
        let contexts = contexts.clone();
        let latest = latest.clone();
        move |_control| {
            while let Ok(event) = service_rx.try_recv() {
                latest.borrow_mut().apply(&event);
                for context in contexts.borrow().values() {
                    context.apply(&event);
                }
            }
        }
    });

    shell.run()
}
