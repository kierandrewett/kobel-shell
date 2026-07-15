use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use freya_core::prelude::IntoElement;
use kobel_bar::{BarAction, BarActionSink, BarContext, BarPanel, BarSnapshots};
use kobel_services::{ServiceCapability, ServiceSet, Services};
use kobel_wayland::{KeyPress, OutputEvent, Shell, SurfaceId};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ActivePopup {
    surface: SurfaceId,
    parent: SurfaceId,
    panel: BarPanel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PopupTransition {
    Open,
    Close(SurfaceId),
    Replace(SurfaceId),
}

fn popup_transition(active: Option<ActivePopup>, parent: SurfaceId, panel: BarPanel) -> PopupTransition {
    match active {
        None => PopupTransition::Open,
        Some(popup) if popup.parent == parent && popup.panel == panel => PopupTransition::Close(popup.surface),
        Some(popup) => PopupTransition::Replace(popup.surface),
    }
}

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?.with_font(kobel_theme::FONT_FAMILY, kobel_theme::FONT_DATA);
    let contexts = Rc::new(RefCell::new(HashMap::<SurfaceId, BarContext>::new()));
    let active_popup = Rc::new(Cell::new(None::<ActivePopup>));
    let latest = Rc::new(RefCell::new(BarSnapshots::default()));
    let (action_tx, action_rx) = std::sync::mpsc::channel();
    let action_waker = shell.waker();

    let (service_tx, service_rx) = std::sync::mpsc::channel();
    let service_waker = shell.waker();
    let services = Services::spawn_with(
        ServiceSet::empty()
            .with(ServiceCapability::Audio)
            .with(ServiceCapability::Battery)
            .with(ServiceCapability::Network)
            .with(ServiceCapability::Calendar),
        move |event| {
            if service_tx.send(event).is_ok() {
                service_waker.wake();
            }
        },
    );

    shell.on_output({
        let contexts = contexts.clone();
        let active_popup = active_popup.clone();
        let latest = latest.clone();
        let action_tx = action_tx.clone();
        let action_waker = action_waker.clone();
        move |event, control| match event {
            OutputEvent::Added(output) => {
                let snapshots = latest.borrow().clone();
                let sink = BarActionSink::new(action_tx.clone(), action_waker.clone());
                let setup_sink = sink.clone();
                match control.create_on(
                    output,
                    kobel_bar::surface_config(),
                    move |surface_contexts| {
                        surface_contexts.provide(move || setup_sink);
                        surface_contexts.provide(move || BarContext::from_snapshots(&snapshots))
                    },
                    || kobel_bar::bar_app().into_element(),
                ) {
                    Ok((surface, context)) => {
                        sink.bind_parent(surface);
                        contexts.borrow_mut().insert(surface, context);
                        eprintln!("[bar] mounted {surface:?} on {output:?}");
                    }
                    Err(error) => eprintln!("[bar] failed to mount on {output:?}: {error:#}"),
                }
            }
            OutputEvent::SurfaceClosed { output, surface } => {
                contexts.borrow_mut().remove(&surface);
                if let Some(popup) = active_popup.get().filter(|popup| popup.surface == surface) {
                    active_popup.set(None);
                    eprintln!(
                        "[bar] {:?} popup {surface:?} closed for {:?}",
                        popup.panel, popup.parent
                    );
                } else {
                    eprintln!("[bar] surface {surface:?} closed on {output:?}");
                }
            }
            OutputEvent::Removed { output, retired } => {
                let mut contexts = contexts.borrow_mut();
                for surface in retired {
                    contexts.remove(&surface);
                    if active_popup.get().is_some_and(|popup| popup.surface == surface) {
                        active_popup.set(None);
                    }
                }
                eprintln!("[bar] output {output:?} removed");
            }
        }
    });

    shell.on_key({
        let active_popup = active_popup.clone();
        move |press: KeyPress, control| {
            if !press.is_escape() {
                return;
            }
            if let Some(popup) = active_popup.get() {
                control.close_popup(popup.surface);
            }
        }
    });

    shell.on_tick({
        let contexts = contexts.clone();
        let active_popup = active_popup.clone();
        let latest = latest.clone();
        let action_tx = action_tx.clone();
        move |control| {
            while let Ok(event) = service_rx.try_recv() {
                latest.borrow_mut().apply(&event);
                for context in contexts.borrow().values() {
                    context.apply(&event);
                }
            }

            while let Ok(action) = action_rx.try_recv() {
                match action {
                    BarAction::Service(command) => services.send(command),
                    BarAction::TogglePanel {
                        parent,
                        panel,
                        anchor_rect,
                    } => {
                        match popup_transition(active_popup.get(), parent, panel) {
                            PopupTransition::Open => {}
                            PopupTransition::Close(surface) => {
                                control.close_popup(surface);
                                continue;
                            }
                            PopupTransition::Replace(surface) => control.close_popup(surface),
                        }

                        let snapshots = latest.borrow().clone();
                        let sink = BarActionSink::new(action_tx.clone(), action_waker.clone());
                        sink.bind_parent(parent);
                        let setup_sink = sink.clone();
                        let result = control.open_popup(
                            parent,
                            kobel_bar::popup_config(panel, anchor_rect),
                            move |surface_contexts| {
                                surface_contexts.provide(move || setup_sink);
                                surface_contexts.provide(move || BarContext::from_snapshots(&snapshots))
                            },
                            move || match panel {
                                BarPanel::Calendar => kobel_bar::calendar_popup_app().into_element(),
                            },
                        );
                        match result {
                            Ok((surface, context)) => {
                                contexts.borrow_mut().insert(surface, context);
                                active_popup.set(Some(ActivePopup { surface, parent, panel }));
                                eprintln!("[bar] opened {panel:?} popup {surface:?} for {parent:?}");
                            }
                            Err(error) => eprintln!("[bar] failed to open {panel:?} for {parent:?}: {error:#}"),
                        }
                    }
                }
            }
        }
    });

    shell.run()
}

#[cfg(test)]
mod tests {
    use super::{ActivePopup, PopupTransition, popup_transition};
    use kobel_bar::BarPanel;
    use kobel_wayland::SurfaceId;

    #[test]
    fn repeated_panel_request_closes_without_reopening() {
        let parent = SurfaceId::new(2);
        let popup = ActivePopup {
            surface: SurfaceId::new(3),
            parent,
            panel: BarPanel::Calendar,
        };

        assert_eq!(
            popup_transition(Some(popup), parent, BarPanel::Calendar),
            PopupTransition::Close(popup.surface),
        );
    }

    #[test]
    fn panel_request_opens_or_replaces_as_needed() {
        let parent = SurfaceId::new(2);
        let popup = ActivePopup {
            surface: SurfaceId::new(3),
            parent: SurfaceId::new(4),
            panel: BarPanel::Calendar,
        };

        assert_eq!(
            popup_transition(None, parent, BarPanel::Calendar),
            PopupTransition::Open,
        );
        assert_eq!(
            popup_transition(Some(popup), parent, BarPanel::Calendar),
            PopupTransition::Replace(popup.surface),
        );
    }
}
