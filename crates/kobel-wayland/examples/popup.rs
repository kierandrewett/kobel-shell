// popup.rs -- end-to-end proof of the xdg-popup-on-layer-surface primitive
// (the shape tray menus and the dock context menu are built on).
//
// One wlr-layer-shell surface anchored TOP+LEFT+RIGHT (a mock bar). Pressing it asks
// the host tick to open an xdg popup -- an `xdg_surface`/`xdg_popup` parented to the
// bar via `zwlr_layer_surface_v1.get_popup`, with a pointer/keyboard grab so the
// compositor dismisses it on an outside click (`popup_done`). The popup renders its
// own embedded-Freya instance (a label) exactly like a layer surface. Esc while the
// popup is open dismisses it programmatically via `Control::close_popup`; Esc with no
// popup exits.
//
// The parent surface's press target is the whole strip (like the spike), so a
// headless injector can click anywhere on the bar to open the popup without aiming at
// a moving widget. Log tags: [popup-demo] for app events, [host] for protocol events.
//
// Cannot run here (no compositor); run it in the gnoblin devkit like the spike.

use std::cell::Cell;
use std::rc::Rc;

use freya_core::prelude::*;
use kobel_wayland::{
    Anchor, Control, KeyPress, KeyboardInteractivity, Layer, Margins, OutputEvent, PopupConfig,
    Shell, SurfaceConfig, SurfaceId, SurfaceSize,
};
use torin::prelude::{Alignment, Size};

/// Single-threaded state linking the parent UI (a button press, on the Freya side) to
/// the host tick (which owns [`Control`], and thus popup creation) and to the popup
/// bookkeeping. All access is on the loop thread, so `Cell` is enough.
struct Shared {
    /// Bumped by the parent's on_press; the tick opens a popup when it changes.
    open_req: Cell<u32>,
    /// The last `open_req` value the tick acted on.
    seen: Cell<u32>,
    /// The parent (bar) surface id, set once created.
    parent: Cell<Option<SurfaceId>>,
    /// The currently-open popup id (cleared when the host reports it closed).
    popup: Cell<Option<SurfaceId>>,
}

fn parent_ui(shared: Rc<Shared>) -> impl IntoElement {
    let mut count = use_state(|| 0i32);
    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background((16, 14, 20))
        .horizontal()
        .main_align(Alignment::center())
        .cross_align(Alignment::center())
        .spacing(16.0)
        // Whole-strip press target: a click anywhere on the bar requests a popup, so
        // the headless injector need not aim at a specific widget.
        .on_press(move |_| {
            let n = {
                let mut c = count.write();
                *c += 1;
                *c
            };
            shared.open_req.set(shared.open_req.get() + 1);
            tracing::info!("[popup-demo] bar pressed count={n}; requested popup open");
        })
        // Reading `count` here makes the press mutate a subscribed State, so it forces
        // a redraw -> frame callback -> next sweep, on which the tick opens the popup.
        .child(
            label()
                .text(format!("click to open a popup (opened {})", count.read()))
                .color((220, 220, 232)),
        )
}

fn popup_ui() -> impl IntoElement {
    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background((40, 30, 62))
        .corner_radius(10.0)
        .main_align(Alignment::center())
        .cross_align(Alignment::center())
        .child(label().text("popup!").color((236, 236, 248)))
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,kobel_wayland=debug".into()),
        )
        .init();

    let shared = Rc::new(Shared {
        open_req: Cell::new(0),
        seen: Cell::new(0),
        parent: Cell::new(None),
        popup: Cell::new(None),
    });

    let mut shell = Shell::new()?;

    // The mock bar (parent for the popup).
    let config = SurfaceConfig::new("kobel-popup-demo", SurfaceSize::Exact { width: 0, height: 120 })
        .layer(Layer::Top)
        .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
        .margins(Margins { top: 10, right: 12, bottom: 0, left: 12 })
        .exclusive_zone(0)
        .keyboard_interactivity(KeyboardInteractivity::OnDemand);
    let parent_id = {
        let shared = shared.clone();
        shell.create_surface(config, move || parent_ui(shared.clone()).into_element())?
    };
    shared.parent.set(Some(parent_id));
    tracing::info!("[popup-demo] bar surface {parent_id:?} created");

    // Tick: open a popup anchored under the bar when the parent requested one and none
    // is open. Runs on the loop thread, so it can drive Control directly.
    {
        let shared = shared.clone();
        shell.on_tick(move |control: &mut Control<'_>| {
            let req = shared.open_req.get();
            if req == shared.seen.get() {
                return;
            }
            shared.seen.set(req);
            if shared.popup.get().is_some() {
                return;
            }
            let Some(parent) = shared.parent.get() else {
                return;
            };
            // Anchor near the left of the bar, growing downward (a menu below a button).
            let cfg = PopupConfig::new(
                "kobel-popup",
                (40, 96, 140, 24),
                SurfaceSize::Exact { width: 220, height: 96 },
            );
            match control.open_popup(parent, cfg, |_| (), || popup_ui().into_element()) {
                Ok((pid, ())) => {
                    shared.popup.set(Some(pid));
                    tracing::info!("[popup-demo] opened popup {pid:?} under {parent:?}");
                }
                Err(e) => tracing::error!("[popup-demo] open_popup failed: {e:#}"),
            }
        });
    }

    // Esc dismisses the popup programmatically (Control::close_popup) when one is open,
    // otherwise it exits. When the popup has the grab, its keyboard focus routes Esc
    // here; an outside click is handled by the compositor (popup_done) instead.
    {
        let shared = shared.clone();
        shell.on_key(move |press: KeyPress, control: &mut Control<'_>| {
            if !press.is_escape() {
                return;
            }
            if let Some(pid) = shared.popup.get() {
                tracing::info!("[popup-demo] Esc -> close_popup {pid:?}");
                control.close_popup(pid);
            } else {
                tracing::info!("[popup-demo] Esc -> exit");
                control.exit();
            }
        });
    }

    // Observe popup teardown (popup_done OR close_popup) via the SurfaceClosed path,
    // clearing the bookkeeping so the bar can open a fresh popup.
    {
        let shared = shared.clone();
        shell.on_output(move |event, _control| {
            if let OutputEvent::SurfaceClosed { surface, .. } = event
                && shared.popup.get() == Some(surface) {
                    shared.popup.set(None);
                    tracing::info!("[popup-demo] app notified: popup {surface:?} closed");
                }
        });
    }

    tracing::info!("[popup-demo] running; click the bar to open a popup, Esc/outside-click to dismiss");
    shell.run()
}
