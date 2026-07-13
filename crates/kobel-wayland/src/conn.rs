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
use wayland_client::{Connection, QueueHandle};

use crate::egl::Egl;
use crate::frame::runner_waker;
use crate::surface::{FreyaLayerSurface, SurfaceContexts};
use crate::{KeyPress, LoopWaker, Result, SurfaceConfig, SurfaceId, SurfaceSize, input};

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

        // Log advertised globals so we learn what gnoblin offers -- especially whether
        // fractional-scale + viewporter are available (we use integer buffer_scale for
        // now; TODO fractional).
        globals.contents().with_list(|list| {
            for g in list {
                tracing::debug!("[host] global {} v{}", g.interface, g.version);
            }
            let frac = list.iter().any(|g| g.interface == "wp_fractional_scale_manager_v1");
            let vp = list.iter().any(|g| g.interface == "wp_viewporter");
            tracing::info!(
                "[host] fractional_scale={frac} viewporter={vp}; using integer buffer_scale (TODO fractional)"
            );
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

        let host = Host {
            registry_state: RegistryState::new(&globals),
            seat_state: SeatState::new(&globals, &qh),
            output_state: OutputState::new(&globals, &qh),
            compositor_state,
            layer_shell,
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

/// The single sctk dispatch + calloop data type. Holds all surfaces and shared state.
struct Host {
    registry_state: RegistryState,
    seat_state: SeatState,
    output_state: OutputState,
    compositor_state: CompositorState,
    layer_shell: LayerShell,

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
            FreyaLayerSurface::new(id, layer, (init_w, init_h), 1, self.waker.clone(), app, setup, content);
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
        // roundtrip needed. Hotplug (new/destroyed outputs at runtime) is a TODO.
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
        let scale = self.surfaces[idx].scale();

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
        s.wl_surface().set_buffer_scale(scale);
        let first = !s.configured;
        s.configured = true;
        if first {
            tracing::info!("[host] surface {:?} configured {pw}x{ph} (scale {scale})", s.id);
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
            let scale = new_factor.max(1);
            if self.surfaces[idx].set_scale(scale) {
                self.surfaces[idx].wl_surface().set_buffer_scale(scale);
                tracing::info!("[host] surface {:?} scale -> {scale}", self.surfaces[idx].id);
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

    fn new_output(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, _output: wl_output::WlOutput) {}

    fn update_output(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, _output: wl_output::WlOutput) {}

    fn output_destroyed(
        &mut self,
        _conn: &Connection,
        _qh: &QueueHandle<Self>,
        _output: wl_output::WlOutput,
    ) {
    }
}

impl LayerShellHandler for Host {
    fn closed(&mut self, _conn: &Connection, _qh: &QueueHandle<Self>, layer: &LayerSurface) {
        if let Some(idx) =
            self.surfaces.iter().position(|s| s.wl_surface() == layer.wl_surface())
        {
            tracing::info!("[host] surface {:?} closed by compositor", self.surfaces[idx].id);
            self.surfaces.remove(idx);
            // Fix up focus index after removal.
            match self.kb_focus {
                Some(f) if f == idx => self.kb_focus = None,
                Some(f) if f > idx => self.kb_focus = Some(f - 1),
                _ => {}
            }
        }
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
            let scale = self.surfaces[idx].scale() as f64;
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
