use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc;

use freya_core::prelude::IntoElement;
use kobel_dock::{DockActionSink, DockContext, DockRequest};
use kobel_services::{AppsSnapshot, Command, ServiceCapability, ServiceEvent, ServiceSet, Services};
use kobel_wayland::{OutputEvent, Shell, SurfaceId};

#[derive(Clone, PartialEq)]
struct MountedDock {
    context: DockContext,
    output_width: u32,
    input_rect: (i32, i32, i32, i32),
}

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?.with_font(kobel_theme::FONT_FAMILY, kobel_theme::FONT_DATA);
    let docks = Rc::new(RefCell::new(HashMap::<SurfaceId, MountedDock>::new()));
    let favourites = kobel_dock::load_favourite_apps();
    let latest_apps = Rc::new(RefCell::new(AppsSnapshot::default()));
    let latest_windows = Rc::new(RefCell::new(Vec::new()));
    let (action_tx, action_rx) = mpsc::channel();
    let action_waker = shell.waker();

    let (service_tx, service_rx) = mpsc::channel();
    let service_waker = shell.waker();
    let services = Services::spawn_with(ServiceSet::empty().with(ServiceCapability::Apps), move |event| {
        if service_tx.send(event).is_ok() {
            service_waker.wake();
        }
    });

    shell.on_output({
        let action_tx = action_tx.clone();
        let action_waker = action_waker.clone();
        let docks = docks.clone();
        let favourites = favourites.clone();
        let latest_apps = latest_apps.clone();
        let latest_windows = latest_windows.clone();
        move |event, control| match event {
            OutputEvent::Added(output) => {
                let output_width = control.logical_size(output).map_or_else(
                    || {
                        eprintln!("[dock] no logical width for {output:?}; using 1920 until the output is rebound");
                        1920
                    },
                    |(width, _)| width,
                );
                let sink = DockActionSink::new(action_tx.clone(), action_waker.clone());
                let setup_sink = sink.clone();
                let setup_favourites = favourites.clone();
                let snapshot = latest_apps.borrow().clone();
                let windows = latest_windows.borrow().clone();
                match control.create_on(
                    output,
                    kobel_dock::surface_config(),
                    move |surface_contexts| {
                        surface_contexts.provide(move || setup_sink);
                        surface_contexts.provide(move || {
                            let context = DockContext::create(setup_favourites, output_width);
                            context.apply(&ServiceEvent::Apps(snapshot));
                            context.set_windows(windows);
                            context
                        })
                    },
                    || kobel_dock::dock_app().into_element(),
                ) {
                    Ok((surface, context)) => {
                        let input_rect = context.metrics().input_rect(output_width);
                        control.set_input_region_rects(surface, &[input_rect]);
                        docks.borrow_mut().insert(
                            surface,
                            MountedDock {
                                context,
                                output_width,
                                input_rect,
                            },
                        );
                        eprintln!("[dock] mounted {surface:?} on {output:?}");
                    }
                    Err(error) => eprintln!("[dock] failed to mount on {output:?}: {error:#}"),
                }
            }
            OutputEvent::SurfaceClosed { output, surface } => {
                docks.borrow_mut().remove(&surface);
                eprintln!("[dock] surface {surface:?} closed on {output:?}");
            }
            OutputEvent::Removed { output, retired } => {
                let mut docks = docks.borrow_mut();
                for surface in retired {
                    docks.remove(&surface);
                }
                eprintln!("[dock] output {output:?} removed");
            }
        }
    });

    shell.on_tick({
        let docks = docks.clone();
        let latest_apps = latest_apps.clone();
        let latest_windows = latest_windows.clone();
        move |control| {
            let mut regions_dirty = false;
            while let Ok(event) = service_rx.try_recv() {
                if let ServiceEvent::Apps(snapshot) = &event {
                    let changed = *latest_apps.borrow() != *snapshot;
                    if changed {
                        *latest_apps.borrow_mut() = snapshot.clone();
                        for dock in docks.borrow().values() {
                            dock.context.apply(&event);
                        }
                        regions_dirty = true;
                    }
                }
            }

            let windows = control.toplevels();
            let windows_changed = *latest_windows.borrow() != windows;
            if windows_changed {
                *latest_windows.borrow_mut() = windows.clone();
                for dock in docks.borrow().values() {
                    dock.context.set_windows(windows.clone());
                }
                regions_dirty = true;
            }

            if regions_dirty {
                for (surface, dock) in docks.borrow_mut().iter_mut() {
                    let input_rect = dock.context.metrics().input_rect(dock.output_width);
                    if input_rect != dock.input_rect {
                        control.set_input_region_rects(*surface, &[input_rect]);
                        dock.input_rect = input_rect;
                    }
                }
            }

            while let Ok(request) = action_rx.try_recv() {
                match request {
                    DockRequest::Launch(app_id) => services.send(Command::LaunchApp(app_id)),
                    DockRequest::Activate(window_id) => control.activate_toplevel(&window_id),
                    DockRequest::Minimize(window_id) => control.minimize_toplevel(&window_id),
                    DockRequest::ShowApplications => {
                        eprintln!("[dock] Show Applications requires the native launcher, which is not mounted yet");
                    }
                }
            }
        }
    });

    shell.run()
}
