use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc;

use freya_core::prelude::IntoElement;
use kobel_dock::{DockActionSink, DockContext, DockMetrics, DockRequest, OUTER_GAP, SURFACE_HEIGHT};
use kobel_services::{AppsSnapshot, Command, ServiceCapability, ServiceEvent, ServiceSet, Services};
use kobel_wayland::{OutputEvent, OutputId, Shell, SurfaceId};

#[derive(Clone, Copy, PartialEq, Eq)]
struct DockGeometry {
    input_rect: (i32, i32, i32, i32),
    show_applications_point: (i32, i32),
}

#[derive(Clone, PartialEq)]
struct MountedDock {
    context: DockContext,
    output: OutputId,
    output_width: u32,
    output_height: u32,
    geometry: DockGeometry,
    geometry_resolved: bool,
}

fn dock_geometry(metrics: DockMetrics, output_width: u32, output_height: u32) -> DockGeometry {
    let input_rect = metrics.input_rect(output_width);
    let item_centre = (kobel_theme::TOKENS.dock.padding + metrics.item_size / 2.0).round() as i32;
    DockGeometry {
        input_rect,
        show_applications_point: (
            input_rect.0 + item_centre,
            output_height as i32 - OUTER_GAP - SURFACE_HEIGHT as i32 + input_rect.1 + item_centre,
        ),
    }
}

fn log_show_applications_point(surface: SurfaceId, output: OutputId, point: (i32, i32)) {
    let (x, y) = point;
    eprintln!("[dock] resolved Show Applications point for {surface:?} on {output:?}: x={x} y={y}");
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
                let logical_size = control.logical_size(output);
                let (output_width, output_height) = logical_size.unwrap_or_else(|| {
                    eprintln!("[dock] no logical width for {output:?}; using provisional 1920");
                    (1920, 1080)
                });
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
                        let geometry = dock_geometry(context.metrics(), output_width, output_height);
                        control.set_input_region_rects(surface, &[geometry.input_rect]);
                        if logical_size.is_some() {
                            log_show_applications_point(surface, output, geometry.show_applications_point);
                        }
                        docks.borrow_mut().insert(
                            surface,
                            MountedDock {
                                context,
                                output,
                                output_width,
                                output_height,
                                geometry,
                                geometry_resolved: logical_size.is_some(),
                            },
                        );
                        eprintln!("[dock] mounted {surface:?} on {output:?}");
                    }
                    Err(error) => eprintln!("[dock] failed to mount on {output:?}: {error:#}"),
                }
            }
            OutputEvent::Updated(output) => {
                let Some((output_width, output_height)) = control.logical_size(output) else {
                    return;
                };
                for (surface, dock) in docks.borrow_mut().iter_mut() {
                    if dock.output != output
                        || (dock.geometry_resolved
                            && dock.output_width == output_width
                            && dock.output_height == output_height)
                    {
                        continue;
                    }
                    dock.output_width = output_width;
                    dock.output_height = output_height;
                    dock.geometry_resolved = true;
                    dock.context.set_output_width(output_width);
                    let geometry = dock_geometry(dock.context.metrics(), output_width, output_height);
                    if geometry.input_rect != dock.geometry.input_rect {
                        control.set_input_region_rects(*surface, &[geometry.input_rect]);
                    }
                    dock.geometry = geometry;
                    eprintln!(
                        "[dock] updated {surface:?} on {output:?} to logical width {output_width} height {output_height}"
                    );
                    log_show_applications_point(*surface, output, geometry.show_applications_point);
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
                    let geometry = dock_geometry(dock.context.metrics(), dock.output_width, dock.output_height);
                    if geometry.input_rect != dock.geometry.input_rect {
                        control.set_input_region_rects(*surface, &[geometry.input_rect]);
                    }
                    if dock.geometry_resolved
                        && geometry.show_applications_point != dock.geometry.show_applications_point
                    {
                        log_show_applications_point(*surface, dock.output, geometry.show_applications_point);
                    }
                    dock.geometry = geometry;
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
