use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use freya_core::prelude::{IntoElement, State, WritableUtils};
use kobel_bar::{BarAction, BarActionSink, BarContext, BarPanel, BarSnapshots, PopoverLayout};
use kobel_services::{ServiceCapability, ServiceSet, Services};
use kobel_wayland::{KeyPress, OutputEvent, OutputId, Shell, SurfaceId};

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
    let parent_outputs = Rc::new(RefCell::new(HashMap::<SurfaceId, OutputId>::new()));
    let output_sizes = Rc::new(RefCell::new(HashMap::<OutputId, (u32, u32)>::new()));
    let popup_layouts = Rc::new(RefCell::new(HashMap::<SurfaceId, State<PopoverLayout>>::new()));
    let active_popup = Rc::new(Cell::new(None::<ActivePopup>));
    let latest = Rc::new(RefCell::new(BarSnapshots::default()));
    let (action_tx, action_rx) = std::sync::mpsc::channel();
    let action_waker = shell.waker();

    let (service_tx, service_rx) = std::sync::mpsc::channel();
    let service_waker = shell.waker();
    let services = Services::spawn_with(
        ServiceSet::empty()
            .with(ServiceCapability::Gnoblin)
            .with(ServiceCapability::Audio)
            .with(ServiceCapability::Battery)
            .with(ServiceCapability::Network)
            .with(ServiceCapability::Bluetooth)
            .with(ServiceCapability::Brightness)
            .with(ServiceCapability::Power)
            .with(ServiceCapability::Settings)
            .with(ServiceCapability::Notifications)
            .with(ServiceCapability::Calendar)
            .with(ServiceCapability::Exec),
        move |event| {
            if service_tx.send(event).is_ok() {
                service_waker.wake();
            }
        },
    );

    shell.on_output({
        let contexts = contexts.clone();
        let parent_outputs = parent_outputs.clone();
        let output_sizes = output_sizes.clone();
        let popup_layouts = popup_layouts.clone();
        let active_popup = active_popup.clone();
        let latest = latest.clone();
        let action_tx = action_tx.clone();
        let action_waker = action_waker.clone();
        move |event, control| match event {
            OutputEvent::Added(output) => {
                let output_size = control.logical_size(output);
                if let Some(output_size) = output_size {
                    output_sizes.borrow_mut().insert(output, output_size);
                }
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
                        parent_outputs.borrow_mut().insert(surface, output);
                        match output_size {
                            Some((width, height)) => {
                                eprintln!("[bar] mounted {surface:?} on {output:?} at {width}x{height}");
                            }
                            None => eprintln!("[bar] mounted {surface:?} on {output:?} without resolved geometry"),
                        }
                    }
                    Err(error) => eprintln!("[bar] failed to mount on {output:?}: {error:#}"),
                }
            }
            OutputEvent::Updated(output) => {
                let Some(output_size) = control.logical_size(output) else {
                    return;
                };
                output_sizes.borrow_mut().insert(output, output_size);
                eprintln!(
                    "[bar] output {output:?} resolved to {}x{}",
                    output_size.0, output_size.1
                );
                let Some(popup) = active_popup.get() else {
                    return;
                };
                if parent_outputs.borrow().get(&popup.parent).copied() != Some(output) {
                    return;
                }

                let layout = PopoverLayout::for_output_panel(output_size, popup.panel);
                if let Some(layout_state) = popup_layouts.borrow().get(&popup.surface).copied()
                    && *layout_state.peek() != layout
                {
                    let mut layout_state = layout_state;
                    layout_state.set(layout);
                }
                control.set_content_bounds(popup.surface, layout.width, layout.max_height);
                eprintln!(
                    "[bar] resized {:?} popup {:?} on {output:?} to {}x{}",
                    popup.panel, popup.surface, layout.width, layout.max_height,
                );
            }
            OutputEvent::SurfaceClosed { output, surface } => {
                contexts.borrow_mut().remove(&surface);
                parent_outputs.borrow_mut().remove(&surface);
                popup_layouts.borrow_mut().remove(&surface);
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
                output_sizes.borrow_mut().remove(&output);
                let mut contexts = contexts.borrow_mut();
                for surface in retired {
                    contexts.remove(&surface);
                    parent_outputs.borrow_mut().remove(&surface);
                    popup_layouts.borrow_mut().remove(&surface);
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
        let contexts = contexts.clone();
        move |press: KeyPress, control| {
            let Some(popup) = active_popup.get() else {
                return;
            };
            if popup.panel == BarPanel::Session {
                if let Some(context) = contexts.borrow().get(&popup.surface) {
                    context.deliver_session_key(press);
                }
                return;
            }
            if !press.is_escape() {
                return;
            }
            if popup.panel == BarPanel::QuickSettings
                && let Some(context) = contexts.borrow().get(&popup.surface)
            {
                context.request_escape();
            } else {
                control.close_popup(popup.surface);
            }
        }
    });

    shell.on_tick({
        let contexts = contexts.clone();
        let active_popup = active_popup.clone();
        let latest = latest.clone();
        let action_tx = action_tx.clone();
        let parent_outputs = parent_outputs.clone();
        let output_sizes = output_sizes.clone();
        let popup_layouts = popup_layouts.clone();
        move |control| {
            while let Ok(event) = service_rx.try_recv() {
                latest.borrow_mut().apply(&event);
                for context in contexts.borrow().values() {
                    context.apply(&event);
                }
            }

            while let Ok(action) = action_rx.try_recv() {
                match action {
                    BarAction::ClosePanel { parent, panel } => {
                        if let Some(popup) = active_popup
                            .get()
                            .filter(|popup| popup.parent == parent && popup.panel == panel)
                        {
                            control.close_popup(popup.surface);
                        }
                    }
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

                        let parent_output = parent_outputs.borrow().get(&parent).copied();
                        let layout = parent_output
                            .and_then(|output| output_sizes.borrow().get(&output).copied())
                            .map(|size| PopoverLayout::for_output_panel(size, panel))
                            .unwrap_or_default();

                        let snapshots = latest.borrow().clone();
                        let sink = BarActionSink::new(action_tx.clone(), action_waker.clone());
                        sink.bind_parent(parent);
                        let setup_sink = sink.clone();
                        let result = control.open_popup(
                            parent,
                            kobel_bar::popup_config(panel, anchor_rect, layout),
                            move |surface_contexts| {
                                surface_contexts.provide(move || setup_sink);
                                let context = surface_contexts.provide(move || BarContext::from_snapshots(&snapshots));
                                let layout_state = surface_contexts.provide(move || State::create(layout));
                                (context, layout_state)
                            },
                            move || match panel {
                                BarPanel::Calendar => kobel_bar::calendar_popup_app().into_element(),
                                BarPanel::QuickSettings => kobel_bar::quick_settings_popup_app().into_element(),
                                BarPanel::Notifications => kobel_bar::notifications_popup_app().into_element(),
                                BarPanel::Session => kobel_bar::session_popup_app().into_element(),
                            },
                        );
                        match result {
                            Ok((surface, (context, layout_state))) => {
                                contexts.borrow_mut().insert(surface, context);
                                popup_layouts.borrow_mut().insert(surface, layout_state);
                                active_popup.set(Some(ActivePopup { surface, parent, panel }));
                                eprintln!(
                                    "[bar] opened {panel:?} popup {surface:?} for {parent:?} at {}x{}",
                                    layout.width, layout.max_height,
                                );
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
