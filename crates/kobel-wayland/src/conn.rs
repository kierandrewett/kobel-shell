// conn.rs -- the Shell/host: Wayland connection, sctk registry/compositor/output/
// seat/wlr-layer-shell state, the calloop event loop, and per-frame orchestration
// over the surfaces. Owns the shared Egl. See docs/FREYA-PLAN.md sections 2, 3.
//
// Scheduling model (idle == zero wakeups):
//   * Each surface pumps its Freya runner in process() with a calloop-ping waker, so
//     a task that wakes while the loop is idle pings the loop back awake.
//   * A surface renders only when it wants a redraw and no wl frame callback is
//     already pending; rendering requests the next frame callback (riding the swap's
//     commit) and notifies the rendering ticker, which advances animations one step.
//   * When nothing wants to redraw, no frame callbacks are outstanding and the loop
//     blocks. sweep() runs after every dispatch (wl event or ping).

use std::collections::HashSet;
use std::ffi::c_void;
use std::task::Waker;

use anyhow::{Context as _, anyhow};
use calloop::EventLoop;
use calloop::ping::{Ping, make_ping};
use calloop_wayland_source::WaylandSource;
use freya_clipboard::copypasta::ClipboardProvider;
use freya_core::integration::{KeyboardEventName, PlatformEvent};
use freya_core::prelude::Element;
use smithay_client_toolkit::compositor::Surface as SctkSurface;
use smithay_client_toolkit::compositor::{CompositorHandler, CompositorState, Region};
use smithay_client_toolkit::globals::GlobalData;
use smithay_client_toolkit::output::{OutputHandler, OutputState};
use smithay_client_toolkit::registry::{ProvidesRegistryState, RegistryState};
use smithay_client_toolkit::seat::keyboard::{
    KeyEvent, KeyboardHandler, Keysym, Modifiers as SctkModifiers, RawModifiers,
};
use smithay_client_toolkit::seat::pointer::{PointerEvent, PointerEventKind, PointerHandler};
use smithay_client_toolkit::seat::{Capability, SeatHandler, SeatState};
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shell::wlr_layer::{
    KeyboardInteractivity, LayerShell, LayerShellHandler, LayerSurface, LayerSurfaceConfigure,
};
use smithay_client_toolkit::shell::xdg::{XdgPositioner, XdgShell};
use smithay_client_toolkit::{
    delegate_compositor, delegate_keyboard, delegate_layer, delegate_output, delegate_pointer, delegate_registry,
    delegate_seat, registry_handlers,
};
use torin::prelude::CursorPoint;
use wayland_client::globals::registry_queue_init;
use wayland_client::protocol::{wl_keyboard, wl_output, wl_pointer, wl_seat, wl_surface};
use wayland_client::{Connection, Dispatch, Proxy, QueueHandle};
use wayland_protocols::wp::fractional_scale::v1::client::wp_fractional_scale_manager_v1::{
    self, WpFractionalScaleManagerV1,
};
use wayland_protocols::wp::fractional_scale::v1::client::wp_fractional_scale_v1::{self, WpFractionalScaleV1};
use wayland_protocols::wp::text_input::zv3::client::zwp_text_input_manager_v3::{self, ZwpTextInputManagerV3};
use wayland_protocols::wp::text_input::zv3::client::zwp_text_input_v3::{self, ZwpTextInputV3};
use wayland_protocols::wp::viewporter::client::wp_viewport::{self, WpViewport};
use wayland_protocols::wp::viewporter::client::wp_viewporter::{self, WpViewporter};
use wayland_protocols::xdg::decoration::zv1::client::zxdg_decoration_manager_v1::{self, ZxdgDecorationManagerV1};
use wayland_protocols::xdg::shell::client::xdg_popup::{self, XdgPopup};
use wayland_protocols::xdg::shell::client::xdg_positioner::{
    Anchor as XdgAnchor, ConstraintAdjustment, Gravity as XdgGravity,
};
use wayland_protocols::xdg::shell::client::xdg_surface::{self, XdgSurface};
use wayland_protocols::xdg::shell::client::xdg_wm_base::{self, XdgWmBase};
use wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_handle_v1::{
    self, ZwlrForeignToplevelHandleV1,
};
use wayland_protocols_wlr::foreign_toplevel::v1::client::zwlr_foreign_toplevel_manager_v1::{
    self, ZwlrForeignToplevelManagerV1,
};

use crate::egl::Egl;
use crate::frame::runner_waker;
use crate::ime::{ImeCommit, ImeEvent, Preedit, decode_cursor};
use crate::surface::{FreyaLayerSurface, PopupGeometry, PopupRole, SurfaceContexts, SurfaceRole, floor_content_size};
use crate::toplevel::{ToplevelInfo, ToplevelState, decode_state_array};
use crate::{
    KeyPress, LoopWaker, OutputEvent, OutputId, PopupAnchor, PopupConfig, PopupGravity, Result, SurfaceConfig,
    SurfaceId, SurfaceSize, input,
};

/// The shell host. Create it, add surfaces, then `run()` the event loop.
pub struct Shell {
    event_loop: EventLoop<'static, Host>,
    host: Host,
}

impl Shell {
    /// Connect to the compositor and initialize the EGL/graphics stack.
    pub fn new() -> Result<Self> {
        let conn = Connection::connect_to_env().context("connect to Wayland compositor")?;
        let (globals, event_queue) = registry_queue_init::<Host>(&conn).context("initialize Wayland registry")?;
        let qh = event_queue.handle();

        // Log advertised globals for diagnostics; wp_fractional_scale_manager_v1 +
        // wp_viewporter presence gates the fractional path bound just below.
        globals.contents().with_list(|list| {
            for g in list {
                tracing::debug!("[host] global {} v{}", g.interface, g.version);
            }
            let frac = list.iter().any(|g| g.interface == "wp_fractional_scale_manager_v1");
            let vp = list.iter().any(|g| g.interface == "wp_viewporter");
            tracing::info!("[host] advertised fractional_scale={frac} viewporter={vp}");
        });

        let event_loop: EventLoop<'static, Host> = EventLoop::try_new().context("create calloop event loop")?;
        let loop_handle = event_loop.handle();

        WaylandSource::new(conn.clone(), event_queue)
            .insert(loop_handle.clone())
            .map_err(|e| anyhow!("insert Wayland calloop source: {e}"))?;

        // Ping source used to re-pump the Freya runners when a task wakes.
        let (runner_ping, ping_source) = make_ping().context("create runner ping")?;
        loop_handle
            .insert_source(ping_source, |_, _, host: &mut Host| host.sweep())
            .map_err(|e| anyhow!("insert runner ping source: {e}"))?;
        let waker = runner_waker(runner_ping.clone());

        // SAFETY: display_ptr() is a live libwayland wl_display for this connection
        // (client_system backend), valid for the lifetime of `conn`, which the
        // constructed `Host` holds onto (`_conn` field below) for at least as long
        // as `egl` -- satisfying `Egl::new`'s precondition.
        let display_ptr = conn.backend().display_ptr() as *mut c_void;
        let egl = unsafe { Egl::new(display_ptr) }?;

        let compositor_state = CompositorState::bind(&globals, &qh).map_err(|e| anyhow!("bind wl_compositor: {e}"))?;
        let layer_shell = LayerShell::bind(&globals, &qh).map_err(|e| anyhow!("bind wlr-layer-shell: {e}"))?;

        // xdg shell (xdg_wm_base): the popup primitive. Bound via sctk's XdgShell (it
        // also binds the optional decoration manager, unused here), but popups are
        // driven semi-raw -- our own xdg_surface/xdg_popup + Dispatch -- because a
        // layer surface, not a window, is the popup parent. Absent -> popups disabled.
        let xdg_shell = XdgShell::bind(&globals, &qh).ok();
        tracing::info!(
            "[host] xdg shell {}",
            if xdg_shell.is_some() {
                "bound (xdg popups enabled)"
            } else {
                "absent (popups unavailable)"
            }
        );

        // Fractional scaling: bind wp_viewporter (stable) + staging
        // wp_fractional_scale_manager_v1 when advertised. sctk 0.20 wraps neither,
        // so Host implements their Dispatch directly. Either absent -> integer
        // buffer_scale fallback (surface.rs). Version 1 is the only version.
        let viewporter = globals.bind::<WpViewporter, Host, _>(&qh, 1..=1, ()).ok();
        let fractional_manager = globals.bind::<WpFractionalScaleManagerV1, Host, _>(&qh, 1..=1, ()).ok();
        tracing::info!(
            "[host] fractional scaling {}",
            if viewporter.is_some() && fractional_manager.is_some() {
                "enabled (per-surface wp_fractional_scale_v1 + wp_viewport)"
            } else {
                "unavailable; integer buffer_scale fallback"
            }
        );

        // Window discovery and control via zwlr_foreign_toplevel_manager_v1 (v3).
        // sctk 0.20 has no delegate for it, only the newer listing-only
        // ext-foreign-toplevel-list, so Host implements Dispatch directly. When
        // unavailable, `Control::toplevels` returns an empty snapshot and window
        // commands are no-ops.
        let toplevel_manager = globals
            .bind::<ZwlrForeignToplevelManagerV1, Host, _>(&qh, 1..=3, ())
            .ok();
        tracing::info!(
            "[host] foreign-toplevel management {}",
            if toplevel_manager.is_some() {
                "bound (window list/activate/minimize/close)"
            } else {
                "unavailable"
            }
        );

        // IME (CJK/compose input) for text fields: zwp_text_input_manager_v3, a
        // core mutter input-method surface (not gated like the wlr-* extensions --
        // mutter always advertises it). The per-seat zwp_text_input_v3 object
        // itself is created lazily in new_capability once BOTH this manager and a
        // seat are known (order between the two globals is not guaranteed).
        let text_input_manager = globals.bind::<ZwpTextInputManagerV3, Host, _>(&qh, 1..=1, ()).ok();
        tracing::info!(
            "[host] text input (IME) {}",
            if text_input_manager.is_some() {
                "manager bound"
            } else {
                "unavailable"
            }
        );

        let host = Host {
            registry_state: RegistryState::new(&globals),
            seat_state: SeatState::new(&globals, &qh),
            output_state: OutputState::new(&globals, &qh),
            compositor_state,
            layer_shell,
            viewporter,
            fractional_manager,
            xdg_shell,
            toplevel_manager,
            toplevels: Vec::new(),
            next_toplevel_id: 0,
            text_input_manager,
            text_input: None,
            ime_pending: ImeCommit::default(),
            ime_commit_count: 0,
            ime_handler: None,
            egl,
            surfaces: Vec::new(),
            next_id: 0,
            keyboard: None,
            pointer: None,
            seat: None,
            modifiers: SctkModifiers::default(),
            kb_focus: None,
            last_serial: None,
            qh,
            loop_handle,
            runner_ping,
            waker,
            _conn: conn,
            exit: false,
            key_handler: None,
            shell_tick: None,
            output_handler: None,
            announced_outputs: HashSet::new(),
        };

        Ok(Self { event_loop, host })
    }

    /// Create a layer surface rendering `app`, not bound to a specific output.
    /// Returns its id. Prefer [`Shell::create_surface_on_outputs`] for per-output
    /// chrome (bar/osd); this is for compositor-placed or singleton surfaces.
    pub fn create_surface(&mut self, config: SurfaceConfig, app: impl Fn() -> Element + 'static) -> Result<SurfaceId> {
        self.host
            .create_surface_impl(config, None, |_| (), app)
            .map(|(id, ())| id)
    }

    /// Create one copy of a surface per connected output, binding each to its output.
    /// `app` builds the (identical) UI for every output; `setup` registers each
    /// surface's app-level root contexts and is called once per output, its result
    /// collected so the caller can fan updates into every surface. Returns one
    /// `(SurfaceId, C)` per output (or a single compositor-placed surface if the
    /// compositor advertised no outputs).
    pub fn create_surface_on_outputs<C: 'static>(
        &mut self,
        config: SurfaceConfig,
        setup: impl FnMut(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + Clone + 'static,
    ) -> Result<Vec<(SurfaceId, C)>> {
        self.host.create_surface_on_outputs(config, setup, app)
    }

    /// Create a singleton (non-per-output) surface bound to the primary output.
    ///
    /// wlr-layer-shell permits an output-less surface, but a singleton normally
    /// needs deterministic placement. This binds it to the first advertised output
    /// and falls back to compositor placement when no output is available.
    pub fn create_singleton_surface<C>(
        &mut self,
        config: SurfaceConfig,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        self.host.create_singleton_surface(config, setup, app)
    }

    /// Install the app tick: a callback run at the start of every sweep (and whenever
    /// [`Shell::waker`] is woken from another thread), before the surfaces are pumped,
    /// so any root-context writes it makes are picked up in the same frame. Use it to
    /// drain the ShellBus / service snapshots and to drive the shell via [`Control`].
    pub fn on_tick(&mut self, handler: impl FnMut(&mut Control<'_>) + 'static) {
        self.host.shell_tick = Some(Box::new(handler));
    }

    /// A thread-safe handle for waking the loop (thus running the app tick) from a
    /// producer thread (service fan-out, IPC listener).
    pub fn waker(&self) -> LoopWaker {
        LoopWaker::new(self.host.runner_ping.clone())
    }

    /// Install an app-level key handler. It runs on every key *press* (and host-side
    /// repeat), in addition to the event being dispatched into the focused surface's
    /// Freya tree, and can drive the shell via [`Control`] (exit, kb interactivity).
    pub fn on_key(&mut self, handler: impl FnMut(KeyPress, &mut Control<'_>) + 'static) {
        self.host.key_handler = Some(Box::new(handler));
    }

    /// Install the app-level IME handler: fires for text-input `enter`/`leave`
    /// (mirrors keyboard focus) and `Commit` (one atomic `done` payload -- see
    /// [`ImeEvent`]). The caller opts each text-input surface in through
    /// [`Control::ime_enable`] and [`Control::ime_disable`].
    pub fn on_ime(&mut self, handler: impl FnMut(ImeEvent, &mut Control<'_>) + 'static) {
        self.host.ime_handler = Some(Box::new(handler));
    }

    /// Install the per-output mount handler and immediately drive it for every output
    /// already present, then continue as outputs are added or removed. Use this as
    /// the single mount path for output-bound and singleton surfaces:
    /// [`OutputEvent::Added`] fires at startup and on hotplug; [`OutputEvent::Removed`]
    /// fires after the host has torn down that output's surfaces.
    ///
    /// Register it BEFORE [`Shell::run`]; the eager pass here mounts the startup
    /// outputs synchronously so the caller can wire the manager against them.
    pub fn on_output(&mut self, handler: impl FnMut(OutputEvent, &mut OutputControl<'_>) + 'static) {
        self.host.output_handler = Some(Box::new(handler));
        self.host.announce_present_outputs();
    }

    /// Run the event loop until exit.
    pub fn run(mut self) -> Result<()> {
        let signal = self.event_loop.get_signal();
        self.event_loop
            .run(None, &mut self.host, move |host| {
                host.sweep();
                if host.exit {
                    signal.stop();
                }
            })
            .map_err(|e| anyhow!("event loop error: {e}"))?;
        Ok(())
    }
}

/// Handle passed to the app-level key handler for driving the shell.
pub struct Control<'a> {
    host: &'a mut Host,
}

impl Control<'_> {
    /// Request a clean shutdown of the event loop.
    pub fn exit(&mut self) {
        self.host.exit = true;
    }

    /// Change a surface's keyboard-interactivity mode at runtime. No-op for a popup
    /// (popups take input via their grab, not layer-shell keyboard-interactivity).
    pub fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        if let Some(s) = self.host.surfaces.iter().find(|s| s.id == id)
            && let Some(layer) = s.layer_surface()
        {
            layer.set_keyboard_interactivity(mode);
            s.commit();
        }
    }

    /// Open an xdg popup anchored to `parent` (a layer surface, or another popup for a
    /// submenu), rendering `app` with the same embedded-Freya machinery as a layer
    /// surface. `setup` registers the popup's app-level root contexts (ShellBus,
    /// theme tokens, ...) just like the other surface constructors. The grab uses the
    /// last input serial, so an outside click dismisses the popup (`popup_done`, routed
    /// back through [`OutputEvent::SurfaceClosed`]). Returns the popup's id + `setup`'s
    /// value. Errors if the parent is unknown or xdg_wm_base is unavailable.
    pub fn open_popup<C>(
        &mut self,
        parent: SurfaceId,
        config: PopupConfig,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        self.host.create_popup(parent, config, setup, app)
    }

    /// Programmatically dismiss a popup (and any submenus parented to it). No-op if
    /// `id` is not a live popup. The app is notified via [`OutputEvent::SurfaceClosed`].
    pub fn close_popup(&mut self, id: SurfaceId) {
        self.host.close_popup(id);
    }

    /// Swap a surface's wl input region between empty (click-through) and full
    /// (whole surface) at runtime, committing the change. The reveal manager uses
    /// this so a closed on-demand surface stays mapped but click-through, and the
    /// dismiss layer only catches clicks while a surface is open
    /// (docs/FREYA-PLAN.md 2.4). Empty delegates to [`Control::set_input_region_rects`] with
    /// no rectangles; full restores the default whole-surface region (`None`).
    pub fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        if empty {
            self.set_input_region_rects(id, &[]);
            return;
        }
        let Some(s) = self.host.surfaces.iter().find(|s| s.id == id) else {
            return;
        };
        // None restores the default whole-surface input region.
        s.wl_surface().set_input_region(None);
        s.commit();
    }

    /// Set a surface's wl input region to the union of the given surface-local
    /// rectangles (x, y, width, height), committing the change. An empty slice
    /// builds an empty region -> the whole surface is click-through, so the gaps
    /// between rectangles always pass clicks through (the toasts overlay reports
    /// only its visible card rects here, never the whole surface). Input region is
    /// sticky surface state, so later frame commits keep it.
    pub fn set_input_region_rects(&mut self, id: SurfaceId, rects: &[(i32, i32, i32, i32)]) {
        let Some(s) = self.host.surfaces.iter().find(|s| s.id == id) else {
            return;
        };
        match Region::new(&self.host.compositor_state) {
            Ok(region) => {
                for &(x, y, w, h) in rects {
                    region.add(x, y, w, h);
                }
                s.wl_surface().set_input_region(Some(region.wl_region()));
            }
            Err(e) => {
                tracing::warn!("[host] input region unavailable: {e}");
                return;
            }
        }
        s.commit();
    }

    /// Current window snapshot from `zwlr_foreign_toplevel_manager_v1`, oldest-
    /// announced first. Empty if the compositor never advertised the protocol.
    pub fn toplevels(&self) -> Vec<ToplevelInfo> {
        self.host.toplevels()
    }

    /// Request the toplevel be activated (raised + focused) on the bound seat.
    /// No-op (logged) if `id` is unknown or no seat has been bound yet.
    pub fn activate_toplevel(&mut self, id: &str) {
        self.host.activate_toplevel(id);
    }

    /// Request the toplevel be minimized. No-op (logged) if `id` is unknown.
    pub fn minimize_toplevel(&mut self, id: &str) {
        self.host.minimize_toplevel(id);
    }

    /// Request the toplevel close itself (the real Quit -- no guarantee it
    /// actually closes; a `closed` event removes it from [`Control::toplevels`]
    /// if and when it does). No-op (logged) if `id` is unknown.
    pub fn close_toplevel(&mut self, id: &str) {
        self.host.close_toplevel(id);
    }

    /// Request text input be enabled on the surface that just fired
    /// [`ImeEvent::Enter`] (the protocol scopes `enable` to "the surface
    /// previously obtained from the enter event" -- there is exactly one
    /// zwp_text_input_v3 per seat, so this always targets the current focus).
    /// Requests are double-buffered; call [`Control::ime_commit`] to apply.
    pub fn ime_enable(&mut self) {
        if let Some(ti) = self.host.text_input.as_ref() {
            ti.enable();
        }
    }

    /// Explicitly disable text input on the current surface (no editable focus).
    /// Double-buffered; call [`Control::ime_commit`] to apply.
    pub fn ime_disable(&mut self) {
        if let Some(ti) = self.host.text_input.as_ref() {
            ti.disable();
        }
    }

    /// Report the plain text around the cursor (excluding any preedit), so the
    /// input method can position its candidate window and react to context
    /// (backspace-to-edit-previous-word, etc). `cursor`/`anchor` are byte offsets
    /// into `text`; `anchor == cursor` when nothing is selected. The protocol caps
    /// this at 4000 bytes -- an over-limit call is skipped (logged) rather than
    /// risking a protocol violation; double-buffered, call [`Control::ime_commit`].
    pub fn ime_set_surrounding_text(&mut self, text: &str, cursor: i32, anchor: i32) {
        if text.len() > 4000 {
            tracing::warn!(
                "[host] ime_set_surrounding_text: {} bytes exceeds the 4000 byte protocol cap, skipped",
                text.len()
            );
            return;
        }
        if let Some(ti) = self.host.text_input.as_ref() {
            ti.set_surrounding_text(text.to_string(), cursor, anchor);
        }
    }

    /// Mark the area around the cursor (surface-local coordinates) so the
    /// compositor can place a candidate window near it without obstructing the
    /// text. Double-buffered, call [`Control::ime_commit`].
    pub fn ime_set_cursor_rectangle(&mut self, x: i32, y: i32, w: i32, h: i32) {
        if let Some(ti) = self.host.text_input.as_ref() {
            ti.set_cursor_rectangle(x, y, w, h);
        }
    }

    /// Atomically apply every pending `ime_*` request sent since the last commit
    /// (or since `enable`/`disable`). Required after any of the above to take
    /// effect -- the protocol's state is otherwise inert pending state.
    pub fn ime_commit(&mut self) {
        if let Some(ti) = self.host.text_input.as_ref() {
            ti.commit();
            self.host.ime_commit_count += 1;
        }
    }
}

/// Handle passed to the [`Shell::on_output`] handler for mounting per-output
/// surfaces. Wraps the host so the handler can create surfaces bound to a specific
/// output and enumerate the outputs that survive a removal.
pub struct OutputControl<'a> {
    host: &'a mut Host,
    /// The output being removed (for an [`OutputEvent::Removed`]). sctk keeps the
    /// removed proxy in its `OutputState` until the output_destroyed callback
    /// returns, so [`OutputControl::remaining`] filters it out. `None` for Added.
    removing: Option<wl_output::WlOutput>,
}

impl OutputControl<'_> {
    /// Create a layer surface bound to `output`, rendering `app`; `setup` registers
    /// the surface's app-level root contexts. The single-output analogue of
    /// [`Shell::create_surface_on_outputs`]: mounts one output's chrome, or (re)binds
    /// a singleton to a chosen output. Errors if `output` is no longer present.
    pub fn create_on<C>(
        &mut self,
        output: OutputId,
        config: SurfaceConfig,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        let Some(wl) = self.host.wl_output_for(output) else {
            return Err(anyhow!("create_on: output {output:?} is no longer present"));
        };
        self.host.create_surface_impl(config, Some(&wl), setup, app)
    }

    /// Change keyboard interactivity while handling output lifecycle events.
    /// This is the [`OutputControl`] counterpart to
    /// [`Control::set_keyboard_interactivity`].
    pub fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        Control { host: &mut *self.host }.set_keyboard_interactivity(id, mode);
    }

    /// Change click-through state while handling output lifecycle events. This is
    /// the [`OutputControl`] counterpart to [`Control::set_input_region_empty`].
    pub fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        Control { host: &mut *self.host }.set_input_region_empty(id, empty);
    }

    /// The outputs currently present, EXCLUDING the one being removed (if this is a
    /// Removed event). Use the first entry as the rebind target for singletons whose
    /// host output died (the simple primary-death policy, docs/FREYA-PLAN.md 2.1).
    pub fn remaining(&self) -> Vec<OutputId> {
        self.host
            .output_state
            .outputs()
            .filter(|o| self.removing.as_ref() != Some(o))
            .map(|o| output_id_of(&o))
            .collect()
    }
}

/// Per-key-press callback registered via [`Shell::on_key`].
type KeyHandler = Box<dyn FnMut(KeyPress, &mut Control<'_>)>;
/// Per-sweep callback registered via [`Shell::on_tick`].
type ShellTickHandler = Box<dyn FnMut(&mut Control<'_>)>;
/// IME event callback registered via [`Shell::on_ime`].
type ImeHandler = Box<dyn FnMut(ImeEvent, &mut Control<'_>)>;
/// Output add/remove callback registered via [`Shell::on_output`].
type MountHandler = Box<dyn FnMut(OutputEvent, &mut OutputControl<'_>)>;

/// The single sctk dispatch + calloop data type. Holds all surfaces and shared state.
struct Host {
    registry_state: RegistryState,
    seat_state: SeatState,
    output_state: OutputState,
    compositor_state: CompositorState,
    layer_shell: LayerShell,
    /// wp_viewporter global (surface cropping/scaling). `None` => not advertised.
    viewporter: Option<WpViewporter>,
    /// wp_fractional_scale_manager_v1 global. `None` => not advertised. Both this
    /// and `viewporter` are required to drive a surface fractionally.
    fractional_manager: Option<WpFractionalScaleManagerV1>,
    /// xdg shell (`xdg_wm_base`) binding, used to create xdg popups on non-window
    /// (layer) parents. `None` when the compositor does not advertise xdg_wm_base ->
    /// popups are unavailable (layer surfaces still work). See [`Host::create_popup`].
    xdg_shell: Option<XdgShell>,
    /// zwlr_foreign_toplevel_manager_v1 global for window discovery and control.
    /// `None` when the compositor does not advertise the protocol.
    toplevel_manager: Option<ZwlrForeignToplevelManagerV1>,
    /// Live tracked toplevels, kept in the order the compositor announced them.
    /// Populated/updated by the manager's `toplevel` event and the handle's
    /// `title`/`app_id`/`state` events; removed on `closed` (see toplevel.rs for
    /// the pure `ToplevelInfo` shape and `state` array decode).
    toplevels: Vec<TrackedToplevel>,
    /// Monotonic counter minting each `ToplevelInfo::id`: a host-owned stable
    /// string returned to callers rather than a Wayland object id.
    next_toplevel_id: u32,
    /// zwp_text_input_manager_v3 global (IME text input). `None` => not
    /// advertised -> IME never available (mutter always advertises this in
    /// practice; `None` only on a non-mutter compositor).
    text_input_manager: Option<ZwpTextInputManagerV3>,
    /// The per-seat zwp_text_input_v3 object, created once a seat AND the
    /// manager are both known. `None` until then.
    text_input: Option<ZwpTextInputV3>,
    /// Accumulates preedit_string/commit_string/delete_surrounding_text events
    /// between `done`s (double-buffered per protocol); reset to default after
    /// each `done` is dispatched. See ime.rs's module doc for the exact
    /// apply-order contract.
    ime_pending: ImeCommit,
    /// Number of `zwp_text_input_v3.commit` requests sent so far (via
    /// [`Control::ime_commit`]). Compared against `done`'s `serial` argument,
    /// which the protocol defines as "the number of commit requests already
    /// issued" as the compositor last saw them -- a mismatch means a LATER
    /// commit is still in flight and this `done` reflects an older one.
    ime_commit_count: u32,
    egl: Egl,
    surfaces: Vec<FreyaLayerSurface>,
    next_id: u32,

    keyboard: Option<wl_keyboard::WlKeyboard>,
    pointer: Option<wl_pointer::WlPointer>,
    /// The seat carrying pointer/keyboard, retained so a popup grab can name it.
    seat: Option<wl_seat::WlSeat>,
    modifiers: SctkModifiers,
    kb_focus: Option<usize>,
    /// The serial of the most recent pointer button / key press, used as the popup
    /// grab serial (`xdg_popup.grab(seat, serial)`) so the compositor accepts the
    /// grab and dismisses the popup on outside-click (`popup_done`).
    last_serial: Option<u32>,

    qh: QueueHandle<Host>,
    loop_handle: calloop::LoopHandle<'static, Host>,
    runner_ping: Ping,
    waker: Waker,
    _conn: Connection,

    exit: bool,
    key_handler: Option<KeyHandler>,
    shell_tick: Option<ShellTickHandler>,
    /// App-level IME handler (see [`Shell::on_ime`]). Taken via `.take()` while it
    /// runs, like key_handler/shell_tick, so the host can be borrowed by [`Control`].
    ime_handler: Option<ImeHandler>,
    /// Per-output mount handler (see [`Shell::on_output`]). Taken via `.take()` while
    /// it runs so the host can be handed to it as an [`OutputControl`].
    output_handler: Option<MountHandler>,
    /// Outputs we have already fired [`OutputEvent::Added`] for. Guards against
    /// double-mounting a startup output whose sctk `new_output` (fired on its first
    /// `Done`) lands after the eager `on_output` announce pass.
    announced_outputs: HashSet<OutputId>,
}

/// One live `zwlr_foreign_toplevel_handle_v1` plus its batched, publish-gated
/// snapshot. The handle is kept to send activate/set_minimized/close requests;
/// [`ToplevelState`] (toplevel.rs) owns the stage-then-publish invariant itself,
/// unit-tested there without a live Wayland connection.
struct TrackedToplevel {
    handle: ZwlrForeignToplevelHandleV1,
    state: ToplevelState,
}

impl Host {
    /// Current toplevel snapshot, oldest-announced first. Only toplevels with at
    /// least one published batch are included (see [`ToplevelState::published`]).
    /// Cloned (not borrowed) so `Control` can hand it to the app tick without
    /// holding a `Host` borrow open -- mirrors [`Shell::remaining`]'s
    /// `Vec<OutputId>` convention for the same reason.
    fn toplevels(&self) -> Vec<ToplevelInfo> {
        self.toplevels
            .iter()
            .filter_map(|t| t.state.published().cloned())
            .collect()
    }

    /// Look up a tracked toplevel by its host-minted id, published or not (see
    /// [`ToplevelState::id`]). Shared by every id-addressed toplevel request below
    /// so the lookup logic exists exactly once.
    fn find_toplevel(&self, id: &str) -> Option<&TrackedToplevel> {
        self.toplevels.iter().find(|t| t.state.id() == id)
    }

    fn activate_toplevel(&mut self, id: &str) {
        let Some(seat) = self.seat.clone() else {
            tracing::warn!("[host] activate_toplevel({id}): no seat bound yet");
            return;
        };
        match self.find_toplevel(id) {
            Some(t) => t.handle.activate(&seat),
            None => tracing::debug!("[host] activate_toplevel({id}): unknown toplevel"),
        }
    }

    fn minimize_toplevel(&mut self, id: &str) {
        match self.find_toplevel(id) {
            Some(t) => t.handle.set_minimized(),
            None => tracing::debug!("[host] minimize_toplevel({id}): unknown toplevel"),
        }
    }

    fn close_toplevel(&mut self, id: &str) {
        match self.find_toplevel(id) {
            Some(t) => t.handle.close(),
            None => tracing::debug!("[host] close_toplevel({id}): unknown toplevel"),
        }
    }

    fn create_clipboard(&self, enabled: bool) -> Option<Box<dyn ClipboardProvider>> {
        enabled.then(|| {
            let display_ptr = self._conn.backend().display_ptr() as *mut c_void;
            // SAFETY: `display_ptr` is the live libwayland display owned by this
            // connection and remains valid for the host's lifetime.
            let (_primary, clipboard) =
                unsafe { freya_clipboard::copypasta::wayland_clipboard::create_clipboards_from_external(display_ptr) };
            Box::new(clipboard) as Box<dyn ClipboardProvider>
        })
    }

    fn create_surface_impl<C>(
        &mut self,
        config: SurfaceConfig,
        output: Option<&wl_output::WlOutput>,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        // Exact uses the configured size directly (0 is protocol-legal there --
        // "let the compositor decide" -- and physical_dim's own floor makes it
        // safe downstream). ContentSized starts at (width, max_height) -- the
        // tallest it can ever be -- then, once the tree is built below, measures
        // its content and requests the real height before the first commit, so
        // the very first configure already carries a hugged size. A zero axis
        // here is NOT protocol-shorthand for anything -- content_logical_height
        // clamps to `[1, max_height]`, which panics if max_height is 0 -- so both
        // the initial layer size AND the stored content bound are floored at 1.
        let (init_w, init_h, content) = match config.size {
            SurfaceSize::Exact { width, height } => (width, height, None),
            SurfaceSize::ContentSized { width, max_height } => {
                let (width, max_height) = floor_content_size(width, max_height);
                (width, max_height, Some((width, max_height)))
            }
        };

        let id = SurfaceId(self.next_id);
        self.next_id += 1;

        let wl_surface = self.compositor_state.create_surface(&self.qh);
        let layer = self.layer_shell.create_layer_surface(
            &self.qh,
            wl_surface,
            config.layer,
            Some(config.namespace.clone()),
            output,
        );
        layer.set_anchor(config.anchor);
        layer.set_margin(
            config.margins.top,
            config.margins.right,
            config.margins.bottom,
            config.margins.left,
        );
        layer.set_exclusive_zone(config.exclusive_zone);
        layer.set_keyboard_interactivity(config.keyboard_interactivity);
        layer.set_size(init_w, init_h);

        // Empty input region -> the surface is click-through (OSD, display-only). A
        // region with no rectangles added is empty; set_input_region copies it at
        // request time, so dropping the Region before the commit is fine. Input region
        // is sticky surface state, so later frame commits keep it.
        if config.input_region_empty {
            match Region::new(&self.compositor_state) {
                Ok(region) => layer.wl_surface().set_input_region(Some(region.wl_region())),
                Err(e) => tracing::warn!("[host] empty input region unavailable: {e}"),
            }
        }

        // Build the Freya runtime first: new() mounts the app and builds the tree,
        // so a content-sized surface can measure its content and request the right
        // height before the initial (buffer-less) commit that triggers the first
        // configure. The EGL buffer is created later, on that configure.
        //
        // The opt-in clipboard owns a dedicated Wayland event queue, so it does not
        // compete with the host's calloop-driven queue.
        let clipboard = self.create_clipboard(config.clipboard);
        let (mut surface, extra) = FreyaLayerSurface::new(
            id,
            SurfaceRole::Layer(layer),
            (init_w, init_h),
            self.waker.clone(),
            app,
            setup,
            content,
            config.preferred_theme,
            clipboard,
        );
        // Record the bound output so output_destroyed can find every surface to tear
        // down when this output goes away (None for a compositor-placed surface).
        surface.output = output.cloned();

        // Fractional scaling: attach a wp_fractional_scale_v1 (its preferred_scale
        // event routes back to this surface by the SurfaceId udata) and a wp_viewport
        // when the compositor advertised both globals. Absent -> integer buffer_scale
        // path in surface.rs. The wl_surface handle is cloned so the manager calls
        // do not hold a borrow across enable_fractional.
        if let (Some(viewporter), Some(manager)) = (&self.viewporter, &self.fractional_manager) {
            let wl = surface.wl_surface().clone();
            let viewport = viewporter.get_viewport(&wl, &self.qh, ());
            let fractional = manager.get_fractional_scale(&wl, &self.qh, id);
            surface.enable_fractional(viewport, fractional);
            tracing::info!("[host] surface {id:?} fractional scaling enabled (wp_viewport + wp_fractional_scale_v1)");
        }
        if surface.is_content_sized()
            && let Some((w, h)) = surface.measure_if_dirty()
            && let Some(layer) = surface.layer_surface()
        {
            layer.set_size(w, h);
        }

        // Initial commit with no buffer -> compositor replies with a configure.
        surface.commit();

        self.surfaces.push(surface);
        tracing::info!(
            "[host] created surface {id:?} ns={} size={init_w}x{init_h} content_sized={} on_output={}",
            config.namespace,
            content.is_some(),
            output.is_some(),
        );
        Ok((id, extra))
    }

    /// Create an xdg popup anchored to `parent` (a layer surface, or another popup for
    /// a submenu), rendering `app` with the same embedded-Freya machinery as a layer
    /// surface. Returns the popup's [`SurfaceId`]. The popup is positioned by an
    /// `xdg_positioner` (anchor rect in parent-local logical coords + anchor/gravity +
    /// slide/flip so the compositor keeps it on-screen), given an explicit grab on the
    /// last input serial (so the compositor dismisses it on outside-click ->
    /// `popup_done`) and, when available, fractional scaling like the main surfaces.
    fn create_popup<C>(
        &mut self,
        parent: SurfaceId,
        config: PopupConfig,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        if self.xdg_shell.is_none() {
            return Err(anyhow!("create_popup: xdg_wm_base not advertised (popups unavailable)"));
        }
        if !self.surfaces.iter().any(|s| s.id == parent) {
            return Err(anyhow!("create_popup: parent {parent:?} not found"));
        }

        // Keep at most one live child popup per parent. This makes a new child
        // replace its sibling rather than stack over it, covering both submenu
        // switches and repeated context-popup requests. `retire_popup` also removes
        // every descendant of the retired child, so replacing a nested chain takes
        // one call. Compute and apply this before the parent_idx lookup below:
        // retiring a sibling mutates `self.surfaces`, and Vec::remove shifts every
        // later index.
        let links: Vec<(SurfaceId, Option<SurfaceId>)> = self
            .surfaces
            .iter()
            .map(|s| (s.id, s.popup().map(|p| p.parent)))
            .collect();
        for child in direct_popup_children(&links, parent) {
            self.retire_popup(child);
        }

        let Some(parent_idx) = self.surfaces.iter().position(|s| s.id == parent) else {
            return Err(anyhow!("create_popup: parent {parent:?} not found"));
        };

        // Exact and ContentSized both feed `positioner.set_size` (int32 per the xdg
        // protocol) and, for ContentSized, content_logical_height's `[1, max_height]`
        // clamp -- so both branches route through the same u32-safe-for-i32 floor/cap
        // rather than a bare `.max(1)` that could still wrap negative above i32::MAX.
        let (init_w, init_h, content) = match config.size {
            SurfaceSize::Exact { width, height } => {
                let (width, height) = floor_content_size(width, height);
                (width, height, None)
            }
            SurfaceSize::ContentSized { width, max_height } => {
                let (width, max_height) = floor_content_size(width, max_height);
                (width, max_height, Some((width, max_height)))
            }
        };

        let id = SurfaceId(self.next_id);
        self.next_id += 1;

        // A plain wl_surface owned by an sctk Surface (sends wl_surface.destroy on
        // drop, after the xdg role objects are destroyed in FreyaLayerSurface::drop).
        let wl = self.compositor_state.create_surface(&self.qh);
        let sctk_surface = SctkSurface::from(wl);
        let wl_clone = sctk_surface.wl_surface().clone();

        let anchor = map_popup_anchor(config.anchor);
        let gravity = map_popup_gravity(config.gravity);
        // Slide then flip on both axes: keep the menu fully on-screen, flipping to the
        // opposite side of the anchor when it would overflow (standard menu behaviour).
        let constraint = ConstraintAdjustment::SlideX
            | ConstraintAdjustment::SlideY
            | ConstraintAdjustment::FlipX
            | ConstraintAdjustment::FlipY;
        let (ax, ay, aw, ah) = config.anchor_rect;
        let (aw, ah) = (aw.max(1), ah.max(1));
        let geometry = PopupGeometry {
            anchor_rect: (ax, ay, aw, ah),
            anchor,
            gravity,
            constraint,
        };

        // xdg objects. The parent xdg_surface is passed directly for a popup-parented
        // popup (submenu); for a layer-parented popup it is None and the layer surface
        // adopts the popup via zwlr_layer_surface_v1.get_popup below.
        let parent_popup_xdg = self.surfaces[parent_idx].popup().map(|p| p.xdg_surface.clone());
        let xdg_shell = self.xdg_shell.as_ref().expect("xdg_shell present (checked above)");
        let positioner = XdgPositioner::new(xdg_shell).map_err(|e| anyhow!("create xdg_positioner: {e}"))?;
        positioner.set_size(init_w as i32, init_h as i32);
        positioner.set_anchor_rect(ax, ay, aw, ah);
        positioner.set_anchor(anchor);
        positioner.set_gravity(gravity);
        positioner.set_constraint_adjustment(constraint);
        let xdg_surface = xdg_shell.xdg_wm_base().get_xdg_surface(&wl_clone, &self.qh, id);
        let xdg_popup = xdg_surface.get_popup(parent_popup_xdg.as_ref(), &positioner, &self.qh, id);
        // The positioner is a one-shot; drop it now (its Drop sends destroy). A later
        // content-size change rebuilds an equivalent one for reposition.
        drop(positioner);

        // Parent link for a layer-parented popup.
        if let Some(layer) = self.surfaces[parent_idx].layer_surface() {
            layer.get_popup(&xdg_popup);
        }

        // Explicit grab on the last input serial: the compositor then routes input to
        // the popup and dismisses it (popup_done) when the user clicks outside it.
        match (&self.seat, self.last_serial) {
            (Some(seat), Some(serial)) => {
                xdg_popup.grab(seat, serial);
                tracing::info!("[host] popup {id:?} grab(serial={serial})");
            }
            _ => tracing::warn!("[host] popup {id:?} opened without a grab (no seat/serial yet)"),
        }

        let role = SurfaceRole::Popup(PopupRole {
            surface: sctk_surface,
            xdg_surface,
            xdg_popup,
            parent,
            geometry,
            reposition_token: 0,
            pending: (init_w, init_h),
        });

        let clipboard = self.create_clipboard(config.clipboard);
        let (mut surface, extra) = FreyaLayerSurface::new(
            id,
            role,
            (init_w, init_h),
            self.waker.clone(),
            app,
            setup,
            content,
            config.preferred_theme,
            clipboard,
        );

        // Fractional scaling + viewport, exactly like a layer surface.
        if let (Some(viewporter), Some(manager)) = (&self.viewporter, &self.fractional_manager) {
            let wl = surface.wl_surface().clone();
            let viewport = viewporter.get_viewport(&wl, &self.qh, ());
            let fractional = manager.get_fractional_scale(&wl, &self.qh, id);
            surface.enable_fractional(viewport, fractional);
        }

        // Initial commit with no buffer -> xdg_popup.configure + xdg_surface.configure.
        surface.commit();
        self.surfaces.push(surface);
        tracing::info!(
            "[host] created popup {id:?} ns={} parent={parent:?} anchor_rect=({ax},{ay},{aw}x{ah}) size={init_w}x{init_h} content_sized={}",
            config.namespace,
            content.is_some(),
        );
        Ok((id, extra))
    }

    /// Programmatically dismiss a popup (and its submenus). No-op if `id` is not a
    /// live popup. Notifies the app via [`OutputEvent::SurfaceClosed`] per popup.
    fn close_popup(&mut self, id: SurfaceId) {
        let is_popup = self.surfaces.iter().any(|s| s.id == id && s.is_popup());
        if !is_popup {
            tracing::debug!("[host] close_popup {id:?}: not a live popup");
            return;
        }
        tracing::info!("[host] close_popup {id:?} (programmatic dismissal)");
        self.retire_popup(id);
    }

    /// Retire a popup `id` plus every popup transitively parented to it (submenus
    /// first), dropping each surface (its Drop tears down the xdg + wl objects) and
    /// firing [`OutputEvent::SurfaceClosed`] so the app drops its bookkeeping. Shared
    /// by `popup_done` and [`Host::close_popup`].
    fn retire_popup(&mut self, id: SurfaceId) {
        self.retire_descendant_popups(&[id]);
        if let Some(pos) = self.surfaces.iter().position(|s| s.id == id) {
            let ids: Vec<SurfaceId> = self.surfaces.iter().map(|s| s.id).collect();
            self.kb_focus = focus_after_single_close(&ids, self.kb_focus, pos);
            self.surfaces.remove(pos);
            self.dispatch_output(
                OutputEvent::SurfaceClosed {
                    output: None,
                    surface: id,
                },
                None,
            );
        }
        if self.surfaces.is_empty() {
            self.exit = true;
        }
    }

    /// Retire every popup transitively parented to any id in `roots` (the roots
    /// themselves are NOT removed). Used when a parent surface (layer or popup) is
    /// torn down so its open menus go with it. Fires [`OutputEvent::SurfaceClosed`]
    /// for each retired popup.
    fn retire_descendant_popups(&mut self, roots: &[SurfaceId]) {
        let links: Vec<(SurfaceId, Option<SurfaceId>)> = self
            .surfaces
            .iter()
            .map(|s| (s.id, s.popup().map(|p| p.parent)))
            .collect();
        let doomed = popup_descendants(&links, roots);
        // Remove child-first (reverse of the breadth-first discovery order) so a nested
        // popup is destroyed before its parent popup -- xdg requires popups be torn
        // down topmost-first. Focus is fixed BY ID after each removal (never a shifted
        // index), matching the single-close path.
        for &id in doomed.iter().rev() {
            if let Some(pos) = self.surfaces.iter().position(|s| s.id == id) {
                let ids: Vec<SurfaceId> = self.surfaces.iter().map(|s| s.id).collect();
                self.kb_focus = focus_after_single_close(&ids, self.kb_focus, pos);
                self.surfaces.remove(pos);
                tracing::info!("[host] popup {id:?} retired (parent torn down)");
            }
        }
        for id in doomed {
            self.dispatch_output(
                OutputEvent::SurfaceClosed {
                    output: None,
                    surface: id,
                },
                None,
            );
        }
    }

    /// Apply a role-appropriate surface resize request for a content-sized surface: a
    /// layer surface uses `set_size`; a popup rebuilds its positioner and repositions.
    /// Both then commit so the request rides the next frame.
    fn request_surface_size(&mut self, idx: usize, w: u32, h: u32) {
        if self.surfaces[idx].is_popup() {
            self.reposition_popup(idx, w, h);
        } else if let Some(layer) = self.surfaces[idx].layer_surface() {
            layer.set_size(w, h);
        }
        self.surfaces[idx].commit();
    }

    /// Rebuild an equivalent positioner at the new size and drive `xdg_popup.reposition`
    /// (+ set_window_geometry) so a content-sized popup hugs its measured content.
    fn reposition_popup(&mut self, idx: usize, w: u32, h: u32) {
        let Some(geom) = self.surfaces[idx].popup().map(|p| p.geometry) else {
            return;
        };
        let Some(xdg_shell) = self.xdg_shell.as_ref() else {
            return;
        };
        let positioner = match XdgPositioner::new(xdg_shell) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("[host] popup reposition positioner unavailable: {e}");
                return;
            }
        };
        let (ax, ay, aw, ah) = geom.anchor_rect;
        positioner.set_size(w as i32, h as i32);
        positioner.set_anchor_rect(ax, ay, aw, ah);
        positioner.set_anchor(geom.anchor);
        positioner.set_gravity(geom.gravity);
        positioner.set_constraint_adjustment(geom.constraint);
        if let Some(p) = self.surfaces[idx].popup_mut() {
            p.reposition_token = p.reposition_token.wrapping_add(1);
            let token = p.reposition_token;
            p.xdg_surface.set_window_geometry(0, 0, w as i32, h as i32);
            p.xdg_popup.reposition(&positioner, token);
        }
        drop(positioner);
    }

    fn create_surface_on_outputs<C>(
        &mut self,
        config: SurfaceConfig,
        mut setup: impl FnMut(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + Clone + 'static,
    ) -> Result<Vec<(SurfaceId, C)>> {
        // OutputState::bind_all made the proxies available at registry init; no
        // roundtrip needed. This mounts a fixed snapshot of the outputs present now;
        // runtime hotplug is handled by [`Shell::on_output`] instead (which the shell
        // uses), so this convenience path is not the lifecycle-aware one.
        let outputs: Vec<wl_output::WlOutput> = self.output_state.outputs().collect();
        if outputs.is_empty() {
            tracing::warn!(
                "[host] no outputs advertised; creating one compositor-placed '{}' surface",
                config.namespace
            );
            return Ok(vec![self.create_surface_impl(config, None, &mut setup, app)?]);
        }
        let mut created = Vec::with_capacity(outputs.len());
        for output in &outputs {
            created.push(self.create_surface_impl(config.clone(), Some(output), &mut setup, app.clone())?);
        }
        Ok(created)
    }

    fn create_singleton_surface<C>(
        &mut self,
        config: SurfaceConfig,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        // Bind to the primary (first-advertised) output so the singleton lands on
        // the user's active screen instead of wherever the compositor defaults an
        // output-less layer surface.
        let primary = self.output_state.outputs().next();
        if primary.is_none() {
            tracing::warn!(
                "[host] no outputs advertised; placing singleton '{}' via compositor",
                config.namespace
            );
        }
        self.create_surface_impl(config, primary.as_ref(), setup, app)
    }

    /// Resolve an [`OutputId`] back to its live `wl_output` proxy, if still present.
    fn wl_output_for(&self, id: OutputId) -> Option<wl_output::WlOutput> {
        self.output_state.outputs().find(|o| output_id_of(o) == id)
    }

    /// Fire [`OutputEvent::Added`] for every output present now. Called once by
    /// [`Shell::on_output`] so the startup outputs mount synchronously before the
    /// loop runs; sctk's later `new_output` for those same outputs is deduped by
    /// `announced_outputs`.
    fn announce_present_outputs(&mut self) {
        let present: Vec<wl_output::WlOutput> = self.output_state.outputs().collect();
        for output in present {
            self.announce_added(&output);
        }
    }

    /// Mark `output` announced and fire [`OutputEvent::Added`] for it, unless it was
    /// already announced (startup output whose `new_output` arrives after the eager
    /// pass). Idempotent per output.
    fn announce_added(&mut self, output: &wl_output::WlOutput) {
        let id = output_id_of(output);
        if !self.announced_outputs.insert(id) {
            return;
        }
        tracing::info!(
            "[host] output {id:?} added; {} output(s) present",
            self.output_state.outputs().count()
        );
        self.dispatch_output(OutputEvent::Added(id), None);
    }

    /// Tear down every surface bound to `target` (already-departed output), then fire
    /// [`OutputEvent::Removed`] so the app drops its matching bookkeeping. No-op if
    /// the output was never announced.
    fn destroy_output(&mut self, output: &wl_output::WlOutput) {
        let id = output_id_of(output);
        if !self.announced_outputs.remove(&id) {
            return;
        }
        let retired = self.retire_output_surfaces(id);
        // Any popups parented to a retired surface are torn down with it (they are
        // output-less, so retire_output_surfaces did not catch them).
        self.retire_descendant_popups(&retired);
        tracing::info!(
            "[host] output {id:?} removed; retired {} surface(s), {} output(s) remain",
            retired.len(),
            self.output_state.outputs().count().saturating_sub(1),
        );
        self.dispatch_output(OutputEvent::Removed { output: id, retired }, Some(output.clone()));
    }

    /// Remove every surface bound to `target` from `self.surfaces`, in the safe Drop
    /// order (each `remove()` runs FreyaLayerSurface::drop: viewport/fractional
    /// destroy, then egl_surface, then layer -> wl_surface). Fixes up `kb_focus` and
    /// returns the retired ids. A retired surface may still have an in-flight wl frame
    /// callback; once its wl_surface is gone the callback is orphaned server-side and
    /// CompositorHandler::frame already guards with index_of(), so no mid-frame panic.
    fn retire_output_surfaces(&mut self, target: OutputId) -> Vec<SurfaceId> {
        let bindings: Vec<(SurfaceId, Option<OutputId>)> = self
            .surfaces
            .iter()
            .map(|s| (s.id, s.output.as_ref().map(output_id_of)))
            .collect();
        let (doomed, new_focus) = retire_plan(&bindings, self.kb_focus, target);
        if doomed.is_empty() {
            return Vec::new();
        }
        let retired: Vec<SurfaceId> = doomed.iter().map(|&i| self.surfaces[i].id).collect();
        self.kb_focus = new_focus;
        // Remove high-to-low so the lower indices stay valid as we go.
        for &i in doomed.iter().rev() {
            let s = self.surfaces.remove(i);
            tracing::info!("[host] retired surface {:?} (output {target:?} gone)", s.id);
        }
        retired
    }

    /// Run the output handler for one event, handing it an [`OutputControl`]. Taken
    /// out and restored around the call (like key_handler/shell_tick) so the host can
    /// be borrowed by the control. No-op when no handler is installed.
    fn dispatch_output(&mut self, event: OutputEvent, removing: Option<wl_output::WlOutput>) {
        let Some(mut handler) = self.output_handler.take() else {
            return;
        };
        {
            let mut control = OutputControl { host: self, removing };
            handler(event, &mut control);
        }
        self.output_handler = Some(handler);
    }

    /// Run the app-level IME handler for one event, handing it a [`Control`]. Taken
    /// out and restored around the call (like key_handler/output_handler) so the
    /// host can be borrowed by the control. No-op when no handler is installed.
    fn dispatch_ime(&mut self, event: ImeEvent) {
        let Some(mut handler) = self.ime_handler.take() else {
            return;
        };
        {
            let mut control = Control { host: self };
            handler(event, &mut control);
        }
        self.ime_handler = Some(handler);
    }

    fn index_of(&self, surface: &wl_surface::WlSurface) -> Option<usize> {
        self.surfaces.iter().position(|s| s.wl_surface() == surface)
    }

    /// One pass over all surfaces: pump runners, kickstart renders, re-arm if busy.
    fn sweep(&mut self) {
        // App tick first: drain the ShellBus / service snapshots and let the shell
        // drive itself (exit, kb interactivity). Running before the surface pump means
        // any root-context writes it makes are picked up by process() this same sweep.
        if let Some(mut tick) = self.shell_tick.take() {
            let mut control = Control { host: self };
            tick(&mut control);
            self.shell_tick = Some(tick);
        }
        let mut rearm = false;
        for idx in 0..self.surfaces.len() {
            rearm |= self.surfaces[idx].process();
            let s = &self.surfaces[idx];
            if s.configured && s.wants_redraw() && !s.frame_pending && s.egl_surface.is_some() {
                self.render_surface(idx);
            }
        }
        if rearm {
            self.runner_ping.ping();
        }
    }

    /// Present one surface: measure if needed, paint into the wrapped fbo, request the
    /// next frame callback, swap, and notify the ticker.
    fn render_surface(&mut self, idx: usize) {
        // Measure at the fixed content viewport (content-sized) or the configured
        // buffer (exact), and, when content-sizing asks for a new surface size, make
        // the role-appropriate resize request (layer set_size / popup reposition)
        // before binding GL. We keep rendering into the currently configured EGL
        // buffer until the compositor's next configure resizes it. Guarded against
        // loops by measure_if_dirty only requesting when the measured height changed.
        if let Some((w, h)) = self.surfaces[idx].measure_if_dirty() {
            self.request_surface_size(idx, w, h);
        }

        let Self { egl, surfaces, qh, .. } = self;
        let qh: &QueueHandle<Host> = qh;
        let s = &mut surfaces[idx];

        let (pw, ph) = s.physical_size();
        if let Some(es) = s.egl_surface.as_mut() {
            es.resize(pw, ph);
        }
        {
            let Some(es) = s.egl_surface.as_ref() else {
                return;
            };
            if let Err(e) = egl.make_current(es) {
                tracing::error!("[egl] make_current failed: {e:#}");
                return;
            }
        }

        // Content-size measurement + resize request already happened at the top of
        // this function (it must run before the role borrow below).

        let mut sk_surface = match egl.wrap_frame(pw, ph) {
            Ok(surface) => surface,
            Err(e) => {
                tracing::error!("[egl] wrap_frame failed: {e:#}");
                return;
            }
        };
        s.render_into(sk_surface.canvas());
        egl.flush();

        // Request the next frame callback before the swap so it rides the presenting
        // commit that eglSwapBuffers performs.
        s.wl_surface().frame(qh, s.wl_surface().clone());

        if let Some(es) = s.egl_surface.as_ref()
            && let Err(e) = egl.swap(es)
        {
            tracing::error!("[egl] swap failed: {e:#}");
            return;
        }
        s.frame_pending = true;
        s.after_present();
    }

    fn configure_surface(&mut self, idx: usize, new_size: (u32, u32)) {
        self.surfaces[idx].on_configure(new_size);
        let (pw, ph) = self.surfaces[idx].physical_size();

        // Apply the scale mapping first (viewport destination for fractional mode,
        // wl buffer_scale for the integer fallback), then size the EGL buffer to
        // physical. Both are pre-commit -- the next render swap presents them
        // together, so a buffer is never shown against a stale mapping.
        self.surfaces[idx].apply_surface_scaling();

        {
            let Self { egl, surfaces, .. } = self;
            let s = &mut surfaces[idx];
            if s.egl_surface.is_some() {
                if let Some(es) = s.egl_surface.as_mut() {
                    es.resize(pw, ph);
                }
            } else {
                match egl.create_surface(s.wl_surface(), pw, ph) {
                    Ok(es) => s.egl_surface = Some(es),
                    Err(e) => {
                        tracing::error!("[egl] create window surface failed: {e:#}");
                        return;
                    }
                }
            }
        }

        let s = &mut self.surfaces[idx];
        let first = !s.configured;
        s.configured = true;
        let (lw, lh) = s.logical_size();
        if first {
            tracing::info!(
                "[host] surface {:?} configured logical {lw}x{lh} physical {pw}x{ph} scale {:.4} fractional={}",
                s.id,
                s.scale_factor(),
                s.is_fractional(),
            );
        } else if s.is_fractional() {
            tracing::info!(
                "[host] surface {:?} fractional buffer logical {lw}x{lh} scale {:.4} physical {pw}x{ph}",
                s.id,
                s.scale_factor(),
            );
        }
    }

    /// Decode a key press/repeat, dispatch into the focused surface, and run the
    /// app-level key handler.
    fn on_key_press(&mut self, event: KeyEvent, repeat: bool) {
        let Some(idx) = self.kb_focus else {
            return;
        };
        let key = input::map_key(event.keysym, event.utf8.as_deref());
        let code = input::map_code(event.raw_code);
        let modifiers = input::map_modifiers(self.modifiers);
        let sid = self.surfaces[idx].id;

        self.surfaces[idx].feed_event(PlatformEvent::Keyboard {
            name: KeyboardEventName::KeyDown,
            key: key.clone(),
            code,
            modifiers,
        });

        if let Some(mut handler) = self.key_handler.take() {
            let press = KeyPress {
                key,
                code,
                modifiers,
                repeat,
                surface: sid,
            };
            let mut control = Control { host: self };
            handler(press, &mut control);
            self.key_handler = Some(handler);
        }
    }

    fn on_key_release(&mut self, event: KeyEvent) {
        let Some(idx) = self.kb_focus else {
            return;
        };
        let key = input::map_key(event.keysym, event.utf8.as_deref());
        let code = input::map_code(event.raw_code);
        let modifiers = input::map_modifiers(self.modifiers);
        self.surfaces[idx].feed_event(PlatformEvent::Keyboard {
            name: KeyboardEventName::KeyUp,
            key,
            code,
            modifiers,
        });
    }
}

impl CompositorHandler for Host {
    fn scale_factor_changed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        surface: &wl_surface::WlSurface,
        new_factor: i32,
    ) {
        if let Some(idx) = self.index_of(surface) {
            // Integer wl_output scale. Ignored in fractional mode (the
            // wp_fractional_scale protocol drives the scale and buffer_scale stays
            // 1); set_integer_scale returns false there.
            if self.surfaces[idx].set_integer_scale(new_factor.max(1)) {
                self.surfaces[idx].apply_surface_scaling();
                tracing::info!(
                    "[host] surface {:?} integer buffer_scale -> {}",
                    self.surfaces[idx].id,
                    new_factor.max(1)
                );
            }
        }
    }

    fn transform_changed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _new_transform: wl_output::Transform,
    ) {
    }

    fn frame(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, surface: &wl_surface::WlSurface, _time: u32) {
        if let Some(idx) = self.index_of(surface) {
            self.surfaces[idx].frame_pending = false;
        }
    }

    fn surface_enter(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _output: &wl_output::WlOutput,
    ) {
    }

    fn surface_leave(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _surface: &wl_surface::WlSurface,
        _output: &wl_output::WlOutput,
    ) {
    }
}

impl OutputHandler for Host {
    fn output_state(&mut self) -> &mut OutputState {
        &mut self.output_state
    }

    fn new_output(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, output: wl_output::WlOutput) {
        // Fires on the output's first `Done`. Startup outputs were already announced
        // eagerly by Shell::on_output, so this only mounts genuinely-new (hotplugged)
        // outputs; announce_added dedupes via announced_outputs.
        self.announce_added(&output);
    }

    fn update_output(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, _output: wl_output::WlOutput) {}

    fn output_destroyed(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, output: wl_output::WlOutput) {
        // sctk still lists `output` in OutputState until this returns; destroy_output
        // tears down its surfaces and notifies the app (which excludes it from
        // OutputControl::remaining when rebinding singletons).
        self.destroy_output(&output);
    }
}

impl LayerShellHandler for Host {
    fn closed(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, layer: &LayerSurface) {
        let Some(idx) = self.surfaces.iter().position(|s| s.wl_surface() == layer.wl_surface()) else {
            return;
        };
        let id = self.surfaces[idx].id;
        let output = self.surfaces[idx].output.as_ref().map(output_id_of);
        tracing::info!("[host] surface {id:?} closed by compositor");
        // Per wlr-layer-shell, `closed` retires exactly ONE surface. The compositor MAY
        // close a surface while its output stays alive, so this is NOT output death --
        // mutter's close-before-global ordering (an output's surfaces closed before its
        // wl_output global is dropped) must not be load-bearing. Drop only this surface
        // (FreyaLayerSurface::drop runs the documented teardown: viewport/fractional
        // destroy, then egl_surface, then layer -> wl_surface), fix keyboard focus by
        // id, then notify the app of the single retirement. Real output death stays
        // solely in output_destroyed -> destroy_output -> OutputEvent::Removed.
        // Re-resolve keyboard focus BY ID (never by a shifted index) so the removal
        // never mis-points it -- the same id-based fixup a bulk retire uses.
        // Any popups parented to this surface (open menus) are torn down with it.
        self.retire_descendant_popups(&[id]);
        let Some(idx) = self.surfaces.iter().position(|s| s.id == id) else {
            return;
        };
        let ids: Vec<SurfaceId> = self.surfaces.iter().map(|s| s.id).collect();
        self.kb_focus = focus_after_single_close(&ids, self.kb_focus, idx);
        self.surfaces.remove(idx);
        // Fire synchronously, in this dispatch, AFTER the surface is dropped, so the app
        // drops the closed surface's fan-out State this same turn -- never fanning a
        // service snapshot into a dead State. removing=None: no output is going away, so
        // OutputControl::remaining lists every current output. A singleton handler may
        // recreate a replacement here, so re-check emptiness afterwards.
        self.dispatch_output(OutputEvent::SurfaceClosed { output, surface: id }, None);
        if self.surfaces.is_empty() {
            self.exit = true;
        }
    }

    fn configure(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        layer: &LayerSurface,
        configure: LayerSurfaceConfigure,
        _serial: u32,
    ) {
        if let Some(idx) = self.surfaces.iter().position(|s| s.wl_surface() == layer.wl_surface()) {
            self.configure_surface(idx, configure.new_size);
        }
    }
}

impl SeatHandler for Host {
    fn seat_state(&mut self) -> &mut SeatState {
        &mut self.seat_state
    }

    fn new_seat(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, _seat: wl_seat::WlSeat) {}

    fn new_capability(
        &mut self,
        _conn: &Connection,
        qh: &QueueHandle<Self>,
        seat: wl_seat::WlSeat,
        capability: Capability,
    ) {
        // Retain the seat so a popup grab can name it (xdg_popup.grab(seat, serial)).
        self.seat = Some(seat.clone());
        // The text-input object is per-seat, not per-capability -- created once,
        // as soon as both a seat and the manager global are known (order of the
        // two is not guaranteed; new_capability fires per seat capability, so this
        // runs on whichever capability arrives first for the first seat).
        if self.text_input.is_none()
            && let Some(manager) = self.text_input_manager.as_ref()
        {
            self.text_input = Some(manager.get_text_input(&seat, qh, ()));
        }
        if capability == Capability::Keyboard && self.keyboard.is_none() {
            match self.seat_state.get_keyboard_with_repeat(
                qh,
                &seat,
                None,
                self.loop_handle.clone(),
                Box::new(|host: &mut Host, _kb, event: KeyEvent| {
                    host.on_key_press(event, true);
                }),
            ) {
                Ok(kb) => self.keyboard = Some(kb),
                Err(e) => tracing::warn!("[host] failed to get keyboard: {e}"),
            }
        }
        if capability == Capability::Pointer && self.pointer.is_none() {
            match self.seat_state.get_pointer(qh, &seat) {
                Ok(pointer) => self.pointer = Some(pointer),
                Err(e) => tracing::warn!("[host] failed to get pointer: {e}"),
            }
        }
    }

    fn remove_capability(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _seat: wl_seat::WlSeat,
        capability: Capability,
    ) {
        if capability == Capability::Keyboard {
            if let Some(kb) = self.keyboard.take() {
                kb.release();
            }
            self.kb_focus = None;
        }
        if capability == Capability::Pointer
            && let Some(pointer) = self.pointer.take()
        {
            pointer.release();
        }
    }

    fn remove_seat(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, _seat: wl_seat::WlSeat) {}
}

impl KeyboardHandler for Host {
    fn enter(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _keyboard: &wl_keyboard::WlKeyboard,
        surface: &wl_surface::WlSurface,
        _serial: u32,
        _raw: &[u32],
        _keysyms: &[Keysym],
    ) {
        self.kb_focus = self.index_of(surface);
    }

    fn leave(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _keyboard: &wl_keyboard::WlKeyboard,
        surface: &wl_surface::WlSurface,
        _serial: u32,
    ) {
        if self.index_of(surface) == self.kb_focus {
            self.kb_focus = None;
        }
    }

    fn press_key(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _keyboard: &wl_keyboard::WlKeyboard,
        serial: u32,
        event: KeyEvent,
    ) {
        // Track the press serial so a popup opened from this key can grab the seat.
        self.last_serial = Some(serial);
        self.on_key_press(event, false);
    }

    fn repeat_key(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _keyboard: &wl_keyboard::WlKeyboard,
        _serial: u32,
        _event: KeyEvent,
    ) {
        // Host-side repeat is delivered via the get_keyboard_with_repeat callback; this
        // (compositor-driven) path is intentionally unused to avoid double repeats.
    }

    fn release_key(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _keyboard: &wl_keyboard::WlKeyboard,
        _serial: u32,
        event: KeyEvent,
    ) {
        self.on_key_release(event);
    }

    fn update_modifiers(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _keyboard: &wl_keyboard::WlKeyboard,
        _serial: u32,
        modifiers: SctkModifiers,
        _raw_modifiers: RawModifiers,
        _layout: u32,
    ) {
        self.modifiers = modifiers;
    }
}

impl PointerHandler for Host {
    fn pointer_frame(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _pointer: &wl_pointer::WlPointer,
        events: &[PointerEvent],
    ) {
        for event in events {
            let Some(idx) = self.index_of(&event.surface) else {
                continue;
            };
            // Coordinate story (identical for integer + fractional scale, only the
            // factor differs): Torin measures the tree logically then scales node
            // areas by scale_factor, so layout/hit-test areas live in PHYSICAL space.
            // The compositor delivers pointer positions in LOGICAL surface-local
            // coordinates, so we multiply by the surface's scale_factor to hand
            // feed_event a physical-space cursor (what EventsMeasurerAdapter hit-tests
            // against). Freya then divides the event data by the same scale_factor in
            // EmmitableEvent::new, so app handlers still receive logical coordinates.
            let scale = self.surfaces[idx].scale_factor();
            let (lx, ly) = event.position;
            let cursor = CursorPoint::new(lx * scale, ly * scale);
            match event.kind {
                PointerEventKind::Enter { .. } | PointerEventKind::Motion { .. } => {
                    self.surfaces[idx].feed_event(input::mouse_move(cursor));
                }
                PointerEventKind::Leave { .. } => {
                    // See input::mouse_leave's doc: freya-core has no raw "pointer
                    // left" platform event, only MouseMove hit-test diffing, so a
                    // real Wayland Leave must be translated into a synthetic
                    // out-of-bounds move or whatever was hovered stays stuck.
                    self.surfaces[idx].feed_event(input::mouse_leave());
                }
                PointerEventKind::Press { button, serial, .. } => {
                    // Track the press serial so a popup opened from this click can grab
                    // the seat (xdg requires a recent input serial for the grab).
                    self.last_serial = Some(serial);
                    self.surfaces[idx].feed_event(input::mouse_button(cursor, button, true));
                }
                PointerEventKind::Release { button, .. } => {
                    self.surfaces[idx].feed_event(input::mouse_button(cursor, button, false));
                }
                PointerEventKind::Axis {
                    horizontal, vertical, ..
                } => {
                    let dx = input::axis_pixels(horizontal.absolute, horizontal.value120, horizontal.discrete) * scale;
                    let dy = input::axis_pixels(vertical.absolute, vertical.value120, vertical.discrete) * scale;
                    if dx != 0.0 || dy != 0.0 {
                        self.surfaces[idx].feed_event(input::wheel(cursor, dx, dy));
                    }
                }
            }
        }
    }
}

impl ProvidesRegistryState for Host {
    fn registry(&mut self) -> &mut RegistryState {
        &mut self.registry_state
    }
    registry_handlers![OutputState, SeatState];
}

delegate_compositor!(Host);
delegate_output!(Host);
delegate_seat!(Host);
delegate_keyboard!(Host);
delegate_pointer!(Host);
delegate_layer!(Host);
delegate_registry!(Host);

// --- Fractional-scale + viewporter raw Dispatch (sctk 0.20 wraps neither) ---
// The managers and wp_viewport carry no events; only wp_fractional_scale_v1 does
// (preferred_scale), routed to its surface by the SurfaceId udata.

impl Dispatch<WpViewporter, ()> for Host {
    fn event(_: &mut Self, _: &WpViewporter, _: wp_viewporter::Event, _: &(), _: &Connection, _: &QueueHandle<Self>) {}
}

impl Dispatch<WpViewport, ()> for Host {
    fn event(_: &mut Self, _: &WpViewport, _: wp_viewport::Event, _: &(), _: &Connection, _: &QueueHandle<Self>) {}
}

impl Dispatch<WpFractionalScaleManagerV1, ()> for Host {
    fn event(
        _: &mut Self,
        _: &WpFractionalScaleManagerV1,
        _: wp_fractional_scale_manager_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WpFractionalScaleV1, SurfaceId> for Host {
    fn event(
        state: &mut Self,
        _obj: &WpFractionalScaleV1,
        event: wp_fractional_scale_v1::Event,
        id: &SurfaceId,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        // preferred_scale carries the numerator of a scale fraction over 120.
        if let wp_fractional_scale_v1::Event::PreferredScale { scale } = event {
            let Some(idx) = state.surfaces.iter().position(|s| s.id == *id) else {
                return;
            };
            let changed = state.surfaces[idx].set_fractional_scale(scale);
            let s = &state.surfaces[idx];
            let (pw, ph) = s.physical_size();
            let (lw, lh) = s.logical_size();
            tracing::info!(
                "[host] surface {:?} fractional preferred_scale={}/120 ({:.4}); logical {lw}x{lh} -> physical {pw}x{ph} (changed={changed})",
                s.id,
                scale,
                scale as f64 / 120.0,
            );
        }
    }
}

// --- Foreign-toplevel management raw Dispatch (sctk 0.20 has no delegate for the
// control protocol, only the newer listing-only ext-foreign-toplevel-list) ---
// The manager's `toplevel` event hands us a new_id-created handle; its user data is
// () (event_created_child below), and we track it by inserting a TrackedToplevel
// with a freshly-minted id. `title`/`app_id`/`state` stage into `ToplevelState`
// (toplevel.rs); `done` publishes the batch atomically (see the comment on the
// Done arm below); `closed` removes it and sends the required `destroy` request.

impl Dispatch<ZwlrForeignToplevelManagerV1, ()> for Host {
    fn event(
        host: &mut Self,
        _manager: &ZwlrForeignToplevelManagerV1,
        event: zwlr_foreign_toplevel_manager_v1::Event,
        _data: &(),
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        match event {
            zwlr_foreign_toplevel_manager_v1::Event::Toplevel { toplevel } => {
                let id = host.next_toplevel_id;
                host.next_toplevel_id += 1;
                tracing::debug!("[host] toplevel {id} created ({:?})", toplevel.id());
                host.toplevels.push(TrackedToplevel {
                    handle: toplevel,
                    state: ToplevelState::new(id.to_string()),
                });
            }
            zwlr_foreign_toplevel_manager_v1::Event::Finished => {
                tracing::warn!(
                    "[host] zwlr_foreign_toplevel_manager_v1 finished (compositor withdrew it); window list frozen"
                );
                host.toplevel_manager = None;
            }
            _ => {}
        }
    }

    wayland_client::event_created_child!(Host, ZwlrForeignToplevelManagerV1, [
        zwlr_foreign_toplevel_manager_v1::EVT_TOPLEVEL_OPCODE => (ZwlrForeignToplevelHandleV1, ()),
    ]);
}

impl Dispatch<ZwlrForeignToplevelHandleV1, ()> for Host {
    fn event(
        host: &mut Self,
        handle: &ZwlrForeignToplevelHandleV1,
        event: zwlr_foreign_toplevel_handle_v1::Event,
        _data: &(),
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        use zwlr_foreign_toplevel_handle_v1::Event;
        match event {
            Event::Title { title } => {
                if let Some(t) = host.toplevels.iter_mut().find(|t| t.handle.id() == handle.id()) {
                    t.state.set_title(title);
                }
            }
            Event::AppId { app_id } => {
                if let Some(t) = host.toplevels.iter_mut().find(|t| t.handle.id() == handle.id()) {
                    t.state.set_app_id(app_id);
                }
            }
            Event::State { state } => {
                let (focused, minimized) = decode_state_array(&state);
                if let Some(t) = host.toplevels.iter_mut().find(|t| t.handle.id() == handle.id()) {
                    t.state.set_focus_and_minimized(focused, minimized);
                }
            }
            Event::Closed => {
                if let Some(pos) = host.toplevels.iter().position(|t| t.handle.id() == handle.id()) {
                    let closed = host.toplevels.remove(pos);
                    closed.handle.destroy();
                    let snap = closed.state.pending();
                    tracing::debug!("[host] toplevel {} closed ({}/{})", snap.id, snap.app_id, snap.title);
                }
            }
            // `done` is the ONLY point at which the batched Title/AppId/State
            // fields staged in `ToplevelState` become visible via `Host::toplevels`
            // -- publishing eagerly per-event (as this used to do) let a caller
            // observe a torn snapshot (e.g. new title, stale app_id) mid-batch,
            // violating the protocol's documented atomicity guarantee. Same
            // pattern as `ime_pending` below. The first `done` also makes the
            // toplevel visible at all (see [`ToplevelState::published`]), so a
            // brand-new toplevel with no confirmed data never appears in a
            // snapshot. output_enter/leave and parent are not exposed through the
            // public toplevel snapshot.
            Event::Done => {
                if let Some(t) = host.toplevels.iter_mut().find(|t| t.handle.id() == handle.id()) {
                    t.state.publish();
                    let info = t.state.published().expect("just published");
                    tracing::info!(
                        "[host] toplevel {} ready: app_id={:?} title={:?} focused={} minimized={}",
                        info.id,
                        info.app_id,
                        info.title,
                        info.focused,
                        info.minimized,
                    );
                }
            }
            Event::OutputEnter { .. } | Event::OutputLeave { .. } | Event::Parent { .. } => {}
            // Non-exhaustive enum: a future protocol version may add variants.
            _ => {}
        }
    }
}

// --- Text input (IME) raw Dispatch (no companion crate carries zwp_text_input_v3;
// wayland-protocols itself does, gated behind its `unstable` feature) ---
// preedit_string/commit_string/delete_surrounding_text are double-buffered: each
// overwrites the corresponding `ime_pending` field, and `done` atomically hands the
// accumulated payload to the app then resets `ime_pending` to its initial (empty)
// value for the next cycle, per the protocol's mandated semantics.

impl Dispatch<ZwpTextInputManagerV3, ()> for Host {
    fn event(
        _: &mut Self,
        _: &ZwpTextInputManagerV3,
        _: zwp_text_input_manager_v3::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        // The manager carries no events (factory-only interface).
    }
}

impl Dispatch<ZwpTextInputV3, ()> for Host {
    fn event(
        host: &mut Self,
        _obj: &ZwpTextInputV3,
        event: zwp_text_input_v3::Event,
        _data: &(),
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        use zwp_text_input_v3::Event;
        match event {
            Event::Enter { surface } => {
                if let Some(idx) = host.index_of(&surface) {
                    let sid = host.surfaces[idx].id;
                    tracing::debug!("[host] ime entered surface {sid:?}");
                    host.dispatch_ime(ImeEvent::Enter(sid));
                }
            }
            Event::Leave { surface } => {
                if let Some(idx) = host.index_of(&surface) {
                    let sid = host.surfaces[idx].id;
                    tracing::debug!("[host] ime left surface {sid:?}");
                    host.dispatch_ime(ImeEvent::Leave(sid));
                }
            }
            Event::PreeditString {
                text,
                cursor_begin,
                cursor_end,
            } => {
                host.ime_pending.preedit = text.map(|text| {
                    let (cursor_begin, cursor_end) = decode_cursor(cursor_begin, cursor_end);
                    Preedit {
                        text,
                        cursor_begin,
                        cursor_end,
                    }
                });
            }
            Event::CommitString { text } => {
                host.ime_pending.commit = text;
            }
            Event::DeleteSurroundingText {
                before_length,
                after_length,
            } => {
                host.ime_pending.delete_before = before_length;
                host.ime_pending.delete_after = after_length;
            }
            Event::Done { serial } => {
                let payload = std::mem::take(&mut host.ime_pending);
                let in_sync = serial == host.ime_commit_count;
                tracing::debug!("[host] ime done serial={serial} in_sync={in_sync} payload={payload:?}");
                host.dispatch_ime(ImeEvent::Commit {
                    payload,
                    serial,
                    in_sync,
                });
            }
            // Non-exhaustive enum: a future protocol version may add variants.
            _ => {}
        }
    }
}

// --- xdg shell raw Dispatch (semi-raw popups on layer parents) ---
// XdgShell::bind requires Host to dispatch xdg_wm_base + the (optional) decoration
// manager; the wm_base ping/pong keeps the connection live, the decoration manager
// carries no events. The xdg_surface/xdg_popup objects are created with a SurfaceId
// udata so their configure/popup_done route straight back to the owning surface.

impl Dispatch<XdgWmBase, GlobalData> for Host {
    fn event(
        _state: &mut Self,
        wm_base: &XdgWmBase,
        event: xdg_wm_base::Event,
        _data: &GlobalData,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        if let xdg_wm_base::Event::Ping { serial } = event {
            wm_base.pong(serial);
        }
    }
}

impl Dispatch<ZxdgDecorationManagerV1, GlobalData> for Host {
    fn event(
        _state: &mut Self,
        _mgr: &ZxdgDecorationManagerV1,
        _event: zxdg_decoration_manager_v1::Event,
        _data: &GlobalData,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        // zxdg_decoration_manager_v1 carries no events.
    }
}

impl Dispatch<XdgSurface, SurfaceId> for Host {
    fn event(
        state: &mut Self,
        xdg_surface: &XdgSurface,
        event: xdg_surface::Event,
        id: &SurfaceId,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        // The xdg_surface configure carries the serial to ack. Its size came from the
        // paired xdg_popup.configure just before (stored as `pending`). Set the window
        // geometry to that size, ack, then wire the size into the measure/EGL path.
        if let xdg_surface::Event::Configure { serial } = event {
            let Some(idx) = state.surfaces.iter().position(|s| s.id == *id) else {
                return;
            };
            let Some(size) = state.surfaces[idx].popup().map(|p| {
                p.xdg_surface
                    .set_window_geometry(0, 0, p.pending.0 as i32, p.pending.1 as i32);
                p.pending
            }) else {
                return;
            };
            xdg_surface.ack_configure(serial);
            state.configure_surface(idx, size);
            tracing::info!(
                "[host] popup {id:?} xdg_surface configure serial={serial} acked; size {}x{}",
                size.0,
                size.1,
            );
        }
    }
}

impl Dispatch<XdgPopup, SurfaceId> for Host {
    fn event(
        state: &mut Self,
        _popup: &XdgPopup,
        event: xdg_popup::Event,
        id: &SurfaceId,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
    ) {
        match event {
            xdg_popup::Event::Configure { x, y, width, height } => {
                let (w, h) = (width.max(1) as u32, height.max(1) as u32);
                if let Some(idx) = state.surfaces.iter().position(|s| s.id == *id) {
                    if let Some(p) = state.surfaces[idx].popup_mut() {
                        p.pending = (w, h);
                    }
                    tracing::info!("[host] popup {id:?} configured {w}x{h} at ({x},{y})");
                }
            }
            xdg_popup::Event::PopupDone => {
                // The compositor dismissed the popup (outside-click on the grab, or a
                // parent going away). Retire it + its submenus and notify the app.
                tracing::info!("[host] popup {id:?} popup_done (dismissed by compositor)");
                state.retire_popup(*id);
            }
            xdg_popup::Event::Repositioned { token } => {
                tracing::debug!("[host] popup {id:?} repositioned (token={token})");
            }
            _ => {}
        }
    }
}

/// Map a public [`PopupAnchor`] to the xdg_positioner anchor enum.
fn map_popup_anchor(anchor: PopupAnchor) -> XdgAnchor {
    match anchor {
        PopupAnchor::Top => XdgAnchor::Top,
        PopupAnchor::Bottom => XdgAnchor::Bottom,
        PopupAnchor::Left => XdgAnchor::Left,
        PopupAnchor::Right => XdgAnchor::Right,
        PopupAnchor::TopLeft => XdgAnchor::TopLeft,
        PopupAnchor::TopRight => XdgAnchor::TopRight,
        PopupAnchor::BottomLeft => XdgAnchor::BottomLeft,
        PopupAnchor::BottomRight => XdgAnchor::BottomRight,
        PopupAnchor::Center => XdgAnchor::None,
    }
}

/// Map a public [`PopupGravity`] to the xdg_positioner gravity enum.
fn map_popup_gravity(gravity: PopupGravity) -> XdgGravity {
    match gravity {
        PopupGravity::Top => XdgGravity::Top,
        PopupGravity::Bottom => XdgGravity::Bottom,
        PopupGravity::Left => XdgGravity::Left,
        PopupGravity::Right => XdgGravity::Right,
        PopupGravity::TopLeft => XdgGravity::TopLeft,
        PopupGravity::TopRight => XdgGravity::TopRight,
        PopupGravity::BottomLeft => XdgGravity::BottomLeft,
        PopupGravity::BottomRight => XdgGravity::BottomRight,
    }
}

/// Stable [`OutputId`] for a `wl_output`: its protocol object id. Two proxy clones of
/// the same output share the id, and it is stable for the output's lifetime.
fn output_id_of(output: &wl_output::WlOutput) -> OutputId {
    OutputId(output.id().protocol_id())
}

/// Pure teardown plan for a destroyed output. Given each live surface's
/// `(id, bound-output)` in surface order, the current keyboard-focus index, and the
/// output going away, return the indices to remove (ascending) and the focus index
/// that survives the removal (`None` if the focused surface is among the removed).
/// Extracted from [`Host::retire_output_surfaces`] so the index/focus bookkeeping is
/// unit-testable without a live compositor.
fn retire_plan(
    bindings: &[(SurfaceId, Option<OutputId>)],
    focus: Option<usize>,
    target: OutputId,
) -> (Vec<usize>, Option<usize>) {
    let doomed: Vec<usize> = bindings
        .iter()
        .enumerate()
        .filter(|(_, (_, out))| *out == Some(target))
        .map(|(i, _)| i)
        .collect();
    let new_focus = focus.and_then(|f| {
        if doomed.contains(&f) {
            return None;
        }
        let below = doomed.iter().filter(|&&i| i < f).count();
        Some(f - below)
    });
    (doomed, new_focus)
}

/// New keyboard-focus index after the single surface at `removed` is dropped from a
/// surface list, resolved BY ID so a shifted index never mis-points. `ids` are the
/// surface ids in order BEFORE the removal; returns the focused surface's index in
/// the post-removal list, or `None` if the focused surface WAS the removed one. This
/// is the exact id-based fixup LayerShellHandler::closed applies, extracted so it is
/// unit-testable without a live compositor (companion to [`retire_plan`]).
fn focus_after_single_close(ids: &[SurfaceId], focus: Option<usize>, removed: usize) -> Option<usize> {
    let focused_id = focus.and_then(|i| ids.get(i)).copied();
    focused_id.and_then(|fid| {
        ids.iter()
            .enumerate()
            .filter_map(|(i, &id)| (i != removed).then_some(id))
            .position(|id| id == fid)
    })
}

/// Transitive popup descendants of `roots`, given each live surface's
/// `(id, popup_parent)` (a layer surface's parent is `None`; a popup's parent is its
/// anchor surface). Returns the descendant ids in breadth-first discovery order
/// (roots EXCLUDED); the caller removes them in reverse so nested popups are torn
/// down before their parents. Extracted from [`Host::retire_descendant_popups`] so
/// the parent-teardown fan-out is unit-testable without a live compositor.
fn popup_descendants(links: &[(SurfaceId, Option<SurfaceId>)], roots: &[SurfaceId]) -> Vec<SurfaceId> {
    let mut frontier: Vec<SurfaceId> = roots.to_vec();
    let mut out: Vec<SurfaceId> = Vec::new();
    while let Some(parent) = frontier.pop() {
        for &(id, link) in links {
            if link == Some(parent) && id != parent && !roots.contains(&id) && !out.contains(&id) {
                out.push(id);
                frontier.push(id);
            }
        }
    }
    out
}

/// The DIRECT (non-transitive) popup children of `parent` among `links`: the
/// existing sibling(s) [`Host::create_popup`] must retire before creating a new
/// popup under the same parent (see its doc comment for why) -- swapping one
/// submenu flyout, or one chrome context menu, for another rather than
/// stacking both. Extracted alongside [`popup_descendants`] for the same
/// reason: unit-testable without a live compositor.
fn direct_popup_children(links: &[(SurfaceId, Option<SurfaceId>)], parent: SurfaceId) -> Vec<SurfaceId> {
    links
        .iter()
        .filter(|&&(id, link)| link == Some(parent) && id != parent)
        .map(|&(id, _)| id)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{direct_popup_children, focus_after_single_close, popup_descendants, retire_plan};
    use crate::{OutputId, SurfaceId};

    fn sid(n: u32) -> SurfaceId {
        SurfaceId::new(n)
    }
    fn oid(n: u32) -> OutputId {
        OutputId::new(n)
    }

    #[test]
    fn retires_only_surfaces_bound_to_the_target_output() {
        // Two outputs, two surfaces each, interleaved, plus one output-less surface.
        let bindings = [
            (sid(0), Some(oid(1))),
            (sid(1), Some(oid(2))),
            (sid(2), Some(oid(1))),
            (sid(3), None),
            (sid(4), Some(oid(2))),
        ];
        let (doomed, _) = retire_plan(&bindings, None, oid(2));
        // Indices 1 and 4 are bound to output 2, ascending.
        assert_eq!(doomed, vec![1, 4]);
    }

    #[test]
    fn empty_plan_when_no_surface_bound_to_target() {
        let bindings = [(sid(0), Some(oid(1))), (sid(1), None)];
        let (doomed, focus) = retire_plan(&bindings, Some(0), oid(9));
        assert!(doomed.is_empty());
        // Nothing removed -> focus index unchanged.
        assert_eq!(focus, Some(0));
    }

    #[test]
    fn focus_survives_and_shifts_down_by_removed_below_it() {
        // Focus is on index 3; indices 1 and 2 (below it) are removed -> focus shifts
        // down by two to index 1.
        let bindings = [
            (sid(0), Some(oid(1))),
            (sid(1), Some(oid(2))),
            (sid(2), Some(oid(2))),
            (sid(3), Some(oid(1))),
        ];
        let (doomed, focus) = retire_plan(&bindings, Some(3), oid(2));
        assert_eq!(doomed, vec![1, 2]);
        assert_eq!(focus, Some(1));
    }

    #[test]
    fn focus_clears_when_the_focused_surface_is_retired() {
        let bindings = [(sid(0), Some(oid(1))), (sid(1), Some(oid(2)))];
        let (_, focus) = retire_plan(&bindings, Some(1), oid(2));
        assert_eq!(focus, None);
    }

    #[test]
    fn focus_above_all_removed_is_unchanged() {
        // Focus on index 0; a later surface (index 2) is removed -> index 0 unchanged.
        let bindings = [(sid(0), Some(oid(1))), (sid(1), Some(oid(1))), (sid(2), Some(oid(2)))];
        let (doomed, focus) = retire_plan(&bindings, Some(0), oid(2));
        assert_eq!(doomed, vec![2]);
        assert_eq!(focus, Some(0));
    }

    #[test]
    fn single_close_clears_focus_when_the_focused_surface_is_removed() {
        let ids = [sid(0), sid(1), sid(2)];
        assert_eq!(focus_after_single_close(&ids, Some(1), 1), None);
    }

    #[test]
    fn single_close_shifts_focus_down_when_a_lower_surface_is_removed() {
        // Focus on index 2 (sid 2); index 0 removed -> sid 2 is now at index 1.
        let ids = [sid(0), sid(1), sid(2)];
        assert_eq!(focus_after_single_close(&ids, Some(2), 0), Some(1));
    }

    #[test]
    fn single_close_keeps_focus_when_a_higher_surface_is_removed() {
        // Focus on index 0 (sid 0); index 2 removed -> sid 0 stays at index 0.
        let ids = [sid(0), sid(1), sid(2)];
        assert_eq!(focus_after_single_close(&ids, Some(0), 2), Some(0));
    }

    #[test]
    fn single_close_with_no_focus_stays_none() {
        let ids = [sid(0), sid(1)];
        assert_eq!(focus_after_single_close(&ids, None, 0), None);
    }

    #[test]
    fn single_close_with_stale_focus_index_stays_none() {
        // A focus index past the end (stale bookkeeping) resolves to no surface, so
        // the fixup yields None rather than panicking or mis-pointing.
        let ids = [sid(0), sid(1)];
        assert_eq!(focus_after_single_close(&ids, Some(5), 0), None);
    }

    #[test]
    fn popup_descendants_collects_direct_children() {
        // Surface 0 is a layer surface (parent None); 1 and 2 are popups on it; 3 is a
        // popup on a different layer surface (4).
        let links = [
            (sid(0), None),
            (sid(1), Some(sid(0))),
            (sid(2), Some(sid(0))),
            (sid(4), None),
            (sid(3), Some(sid(4))),
        ];
        let mut got = popup_descendants(&links, &[sid(0)]);
        got.sort_by_key(|s| s.0);
        assert_eq!(got, vec![sid(1), sid(2)]);
    }

    #[test]
    fn popup_descendants_is_transitive_for_submenus() {
        // A submenu chain: layer 0 -> popup 1 -> popup 2 -> popup 3. Tearing down 0
        // takes the whole chain (roots excluded).
        let links = [
            (sid(0), None),
            (sid(1), Some(sid(0))),
            (sid(2), Some(sid(1))),
            (sid(3), Some(sid(2))),
        ];
        let mut got = popup_descendants(&links, &[sid(0)]);
        got.sort_by_key(|s| s.0);
        assert_eq!(got, vec![sid(1), sid(2), sid(3)]);
    }

    #[test]
    fn popup_descendants_excludes_the_roots_and_unrelated() {
        // Retiring popup 1 takes its child 2 but not its parent 0 or sibling-tree 3.
        let links = [
            (sid(0), None),
            (sid(1), Some(sid(0))),
            (sid(2), Some(sid(1))),
            (sid(3), Some(sid(0))),
        ];
        assert_eq!(popup_descendants(&links, &[sid(1)]), vec![sid(2)]);
    }

    #[test]
    fn popup_descendants_empty_when_no_children() {
        let links = [(sid(0), None), (sid(1), Some(sid(0)))];
        assert!(popup_descendants(&links, &[sid(1)]).is_empty());
    }

    #[test]
    fn direct_popup_children_finds_only_the_immediate_children() {
        // Layer 0 has two direct popup children (1, 2); popup 2 has its own child
        // (3), which is NOT a direct child of 0.
        let links = [
            (sid(0), None),
            (sid(1), Some(sid(0))),
            (sid(2), Some(sid(0))),
            (sid(3), Some(sid(2))),
        ];
        let mut got = direct_popup_children(&links, sid(0));
        got.sort_by_key(|s| s.0);
        assert_eq!(got, vec![sid(1), sid(2)]);
    }

    #[test]
    fn direct_popup_children_empty_for_a_childless_parent() {
        let links = [(sid(0), None), (sid(1), Some(sid(0)))];
        assert!(direct_popup_children(&links, sid(1)).is_empty());
    }

    #[test]
    fn direct_popup_children_ignores_unrelated_trees() {
        // Two independent layer surfaces (0 and 4), each with their own popup;
        // asking for 0's children must never see 3 (a child of 4).
        let links = [
            (sid(0), None),
            (sid(1), Some(sid(0))),
            (sid(4), None),
            (sid(3), Some(sid(4))),
        ];
        assert_eq!(direct_popup_children(&links, sid(0)), vec![sid(1)]);
    }

    #[test]
    fn direct_popup_children_this_is_the_sibling_swap_scenario() {
        // The actual bug this guards: a submenu-bearing popup 0 has an open child
        // submenu (1); the user hovers/clicks a SIBLING submenu row, requesting a
        // new popup under the SAME parent (0). create_popup must retire exactly
        // {1} before creating the new one, never leaving both live.
        let links = [(sid(0), None), (sid(1), Some(sid(0)))];
        assert_eq!(direct_popup_children(&links, sid(0)), vec![sid(1)]);
    }
}
