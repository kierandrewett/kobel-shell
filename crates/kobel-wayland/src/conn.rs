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
use freya_core::integration::{KeyboardEventName, PlatformEvent};
use freya_core::prelude::Element;
use smithay_client_toolkit::compositor::{CompositorHandler, CompositorState, Region};
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
use smithay_client_toolkit::{
    delegate_compositor, delegate_keyboard, delegate_layer, delegate_output, delegate_pointer,
    delegate_registry, delegate_seat, registry_handlers,
};
use torin::prelude::CursorPoint;
use wayland_client::globals::registry_queue_init;
use wayland_client::protocol::{wl_keyboard, wl_output, wl_pointer, wl_seat, wl_surface};
use wayland_client::{Connection, Dispatch, Proxy, QueueHandle};
use wayland_protocols::wp::fractional_scale::v1::client::wp_fractional_scale_manager_v1::{
    self, WpFractionalScaleManagerV1,
};
use wayland_protocols::wp::fractional_scale::v1::client::wp_fractional_scale_v1::{
    self, WpFractionalScaleV1,
};
use wayland_protocols::wp::viewporter::client::wp_viewport::{self, WpViewport};
use wayland_protocols::wp::viewporter::client::wp_viewporter::{self, WpViewporter};

use crate::egl::Egl;
use crate::frame::runner_waker;
use crate::surface::{FreyaLayerSurface, SurfaceContexts};
use crate::{
    KeyPress, LoopWaker, OutputEvent, OutputId, Result, SurfaceConfig, SurfaceId, SurfaceSize, input,
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
        let (globals, event_queue) =
            registry_queue_init::<Host>(&conn).context("initialize Wayland registry")?;
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

        let event_loop: EventLoop<'static, Host> =
            EventLoop::try_new().context("create calloop event loop")?;
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
        // (client_system backend), valid for the lifetime of `conn`.
        let display_ptr = conn.backend().display_ptr() as *mut c_void;
        let egl = Egl::new(display_ptr)?;

        let compositor_state =
            CompositorState::bind(&globals, &qh).map_err(|e| anyhow!("bind wl_compositor: {e}"))?;
        let layer_shell =
            LayerShell::bind(&globals, &qh).map_err(|e| anyhow!("bind wlr-layer-shell: {e}"))?;

        // Fractional scaling: bind wp_viewporter (stable) + staging
        // wp_fractional_scale_manager_v1 when advertised. sctk 0.20 wraps neither,
        // so Host implements their Dispatch directly. Either absent -> integer
        // buffer_scale fallback (surface.rs). Version 1 is the only version.
        let viewporter = globals.bind::<WpViewporter, Host, _>(&qh, 1..=1, ()).ok();
        let fractional_manager =
            globals.bind::<WpFractionalScaleManagerV1, Host, _>(&qh, 1..=1, ()).ok();
        tracing::info!(
            "[host] fractional scaling {}",
            if viewporter.is_some() && fractional_manager.is_some() {
                "enabled (per-surface wp_fractional_scale_v1 + wp_viewport)"
            } else {
                "unavailable; integer buffer_scale fallback"
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
            egl,
            surfaces: Vec::new(),
            next_id: 0,
            keyboard: None,
            pointer: None,
            modifiers: SctkModifiers::default(),
            kb_focus: None,
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
    pub fn create_surface(
        &mut self,
        config: SurfaceConfig,
        app: impl Fn() -> Element + 'static,
    ) -> Result<SurfaceId> {
        self.host.create_surface_impl(config, None, |_| (), app).map(|(id, ())| id)
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
    /// wlr-layer-shell lets the compositor place an output-less surface, but a
    /// singleton (launcher, quicksettings, ...) must land on the user's active
    /// screen, so we bind it to the primary (first-advertised) output. Falls back
    /// to compositor placement when no outputs are advertised (multi-output
    /// follow-focus is a TODO). See docs/FREYA-PLAN.md sections 2.1, 6.
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

    /// Install the per-output mount handler and immediately drive it for every output
    /// already present, then keep driving it as outputs are hotplugged/removed at
    /// runtime. This is the single mount path for output-bound chrome (bar/dock/osd/
    /// toasts) and singletons: [`OutputEvent::Added`] fires once per output (startup
    /// AND hotplug), [`OutputEvent::Removed`] once an output goes away (after the host
    /// has already torn its surfaces down). See docs/FREYA-PLAN.md sections 2.1, 6.
    ///
    /// Register it BEFORE [`Shell::run`]; the eager pass here mounts the startup
    /// outputs synchronously so the caller can wire the manager against them.
    pub fn on_output(
        &mut self,
        handler: impl FnMut(OutputEvent, &mut OutputControl<'_>) + 'static,
    ) {
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
    exit: &'a mut bool,
    surfaces: &'a mut Vec<FreyaLayerSurface>,
    compositor: &'a CompositorState,
}

impl Control<'_> {
    /// Request a clean shutdown of the event loop.
    pub fn exit(&mut self) {
        *self.exit = true;
    }

    /// Change a surface's keyboard-interactivity mode at runtime.
    pub fn set_keyboard_interactivity(&mut self, id: SurfaceId, mode: KeyboardInteractivity) {
        if let Some(s) = self.surfaces.iter().find(|s| s.id == id) {
            s.layer.set_keyboard_interactivity(mode);
            s.layer.commit();
        }
    }

    /// Swap a surface's wl input region between empty (click-through) and full
    /// (whole surface) at runtime, committing the change. The reveal manager uses
    /// this so a closed on-demand surface stays mapped but click-through, and the
    /// dismiss layer only catches clicks while a surface is open
    /// (docs/FREYA-PLAN.md 2.4). Empty delegates to [`set_input_region_rects`] with
    /// no rectangles; full restores the default whole-surface region (`None`).
    pub fn set_input_region_empty(&mut self, id: SurfaceId, empty: bool) {
        if empty {
            self.set_input_region_rects(id, &[]);
            return;
        }
        let Some(s) = self.surfaces.iter().find(|s| s.id == id) else {
            return;
        };
        // None restores the default whole-surface input region.
        s.layer.wl_surface().set_input_region(None);
        s.layer.commit();
    }

    /// Set a surface's wl input region to the union of the given surface-local
    /// rectangles (x, y, width, height), committing the change. An empty slice
    /// builds an empty region -> the whole surface is click-through, so the gaps
    /// between rectangles always pass clicks through (the toasts overlay reports
    /// only its visible card rects here, never the whole surface). Input region is
    /// sticky surface state, so later frame commits keep it.
    pub fn set_input_region_rects(&mut self, id: SurfaceId, rects: &[(i32, i32, i32, i32)]) {
        let Some(s) = self.surfaces.iter().find(|s| s.id == id) else {
            return;
        };
        match Region::new(self.compositor) {
            Ok(region) => {
                for &(x, y, w, h) in rects {
                    region.add(x, y, w, h);
                }
                s.layer.wl_surface().set_input_region(Some(region.wl_region()));
            }
            Err(e) => {
                tracing::warn!("[host] input region unavailable: {e}");
                return;
            }
        }
        s.layer.commit();
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

    egl: Egl,
    surfaces: Vec<FreyaLayerSurface>,
    next_id: u32,

    keyboard: Option<wl_keyboard::WlKeyboard>,
    pointer: Option<wl_pointer::WlPointer>,
    modifiers: SctkModifiers,
    kb_focus: Option<usize>,

    qh: QueueHandle<Host>,
    loop_handle: calloop::LoopHandle<'static, Host>,
    runner_ping: Ping,
    waker: Waker,
    _conn: Connection,

    exit: bool,
    key_handler: Option<Box<dyn FnMut(KeyPress, &mut Control<'_>)>>,
    shell_tick: Option<Box<dyn FnMut(&mut Control<'_>)>>,
    /// Per-output mount handler (see [`Shell::on_output`]). Taken via `.take()` while
    /// it runs so the host can be handed to it as an [`OutputControl`].
    output_handler: Option<Box<dyn FnMut(OutputEvent, &mut OutputControl<'_>)>>,
    /// Outputs we have already fired [`OutputEvent::Added`] for. Guards against
    /// double-mounting a startup output whose sctk `new_output` (fired on its first
    /// `Done`) lands after the eager `on_output` announce pass.
    announced_outputs: HashSet<OutputId>,
}

impl Host {
    fn create_surface_impl<C>(
        &mut self,
        config: SurfaceConfig,
        output: Option<&wl_output::WlOutput>,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        app: impl Fn() -> Element + 'static,
    ) -> Result<(SurfaceId, C)> {
        // Exact uses the configured size directly. ContentSized starts at
        // (width, max_height) -- the tallest it can ever be -- then, once the tree is
        // built below, measures its content and requests the real height before the
        // first commit, so the very first configure already carries a hugged size.
        let (init_w, init_h, content) = match config.size {
            SurfaceSize::Exact { width, height } => (width, height, None),
            SurfaceSize::ContentSized { width, max_height } => {
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
        layer.set_margin(config.margins.top, config.margins.right, config.margins.bottom, config.margins.left);
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
        let (mut surface, extra) =
            FreyaLayerSurface::new(id, layer, (init_w, init_h), self.waker.clone(), app, setup, content);
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
            tracing::info!(
                "[host] surface {id:?} fractional scaling enabled (wp_viewport + wp_fractional_scale_v1)"
            );
        }
        if surface.is_content_sized() {
            if let Some((w, h)) = surface.measure_if_dirty() {
                surface.layer.set_size(w, h);
            }
        }

        // Initial commit with no buffer -> compositor replies with a configure.
        surface.layer.commit();

        self.surfaces.push(surface);
        tracing::info!(
            "[host] created surface {id:?} ns={} size={init_w}x{init_h} content_sized={} on_output={}",
            config.namespace,
            content.is_some(),
            output.is_some(),
        );
        Ok((id, extra))
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
            created.push(self.create_surface_impl(
                config.clone(),
                Some(output),
                &mut setup,
                app.clone(),
            )?);
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

    fn index_of(&self, surface: &wl_surface::WlSurface) -> Option<usize> {
        self.surfaces.iter().position(|s| s.wl_surface() == surface)
    }

    /// One pass over all surfaces: pump runners, kickstart renders, re-arm if busy.
    fn sweep(&mut self) {
        // App tick first: drain the ShellBus / service snapshots and let the shell
        // drive itself (exit, kb interactivity). Running before the surface pump means
        // any root-context writes it makes are picked up by process() this same sweep.
        if let Some(mut tick) = self.shell_tick.take() {
            let mut control = Control {
                exit: &mut self.exit,
                surfaces: &mut self.surfaces,
                compositor: &self.compositor_state,
            };
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

        // Measure at the fixed content viewport (content-sized) or the configured
        // buffer (exact). If content-sizing asks for a new surface size, honour the
        // layer-shell rule: set_size + commit now, but keep rendering into the
        // currently configured EGL buffer (pw x ph, unchanged) until the compositor's
        // next configure resizes it. Guarded against loops by measure_if_dirty only
        // requesting when the measured height actually changed.
        if let Some((w, h)) = s.measure_if_dirty() {
            s.layer.set_size(w, h);
            s.layer.commit();
        }

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

        if let Some(es) = s.egl_surface.as_ref() {
            if let Err(e) = egl.swap(es) {
                tracing::error!("[egl] swap failed: {e:#}");
                return;
            }
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
            let press = KeyPress { key, code, modifiers, repeat, surface: sid };
            let mut control = Control {
                exit: &mut self.exit,
                surfaces: &mut self.surfaces,
                compositor: &self.compositor_state,
            };
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

    fn frame(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        surface: &wl_surface::WlSurface,
        _time: u32,
    ) {
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

    fn output_destroyed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        output: wl_output::WlOutput,
    ) {
        // sctk still lists `output` in OutputState until this returns; destroy_output
        // tears down its surfaces and notifies the app (which excludes it from
        // OutputControl::remaining when rebinding singletons).
        self.destroy_output(&output);
    }
}

impl LayerShellHandler for Host {
    fn closed(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, layer: &LayerSurface) {
        let Some(idx) = self.surfaces.iter().position(|s| s.wl_surface() == layer.wl_surface())
        else {
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
        if let Some(idx) =
            self.surfaces.iter().position(|s| s.wl_surface() == layer.wl_surface())
        {
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
        if capability == Capability::Pointer {
            if let Some(pointer) = self.pointer.take() {
                pointer.release();
            }
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
        _serial: u32,
        event: KeyEvent,
    ) {
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
                    // Hover state clears on the next enter (Phase 0/1).
                }
                PointerEventKind::Press { button, .. } => {
                    self.surfaces[idx].feed_event(input::mouse_button(cursor, button, true));
                }
                PointerEventKind::Release { button, .. } => {
                    self.surfaces[idx].feed_event(input::mouse_button(cursor, button, false));
                }
                PointerEventKind::Axis { horizontal, vertical, .. } => {
                    let dx = input::axis_pixels(horizontal.absolute, horizontal.value120, horizontal.discrete)
                        * scale;
                    let dy = input::axis_pixels(vertical.absolute, vertical.value120, vertical.discrete)
                        * scale;
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
    fn event(
        _: &mut Self,
        _: &WpViewporter,
        _: wp_viewporter::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

impl Dispatch<WpViewport, ()> for Host {
    fn event(
        _: &mut Self,
        _: &WpViewport,
        _: wp_viewport::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
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
fn focus_after_single_close(
    ids: &[SurfaceId],
    focus: Option<usize>,
    removed: usize,
) -> Option<usize> {
    let focused_id = focus.and_then(|i| ids.get(i)).copied();
    focused_id.and_then(|fid| {
        ids.iter()
            .enumerate()
            .filter_map(|(i, &id)| (i != removed).then_some(id))
            .position(|id| id == fid)
    })
}

#[cfg(test)]
mod tests {
    use super::{focus_after_single_close, retire_plan};
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
        let bindings = [
            (sid(0), Some(oid(1))),
            (sid(1), Some(oid(1))),
            (sid(2), Some(oid(2))),
        ];
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
}
