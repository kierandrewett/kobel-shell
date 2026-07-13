// surface.rs -- FreyaLayerSurface: one embedded Freya runtime bound to one wlr layer
// surface. Owns the Runner, Tree, hit-test NodesState, fonts, the events channel,
// and the root contexts (Platform / RenderingTicker / AnimationClock / clipboard /
// AssetCacher / accessibility generator / FrameStats) that let stock freya-components
// and freya-animation work. The GPU present + wl frame scheduling live in conn.rs
// (which owns the shared Egl); everything here is GL-free Freya plumbing plus a
// render_into() that paints the current tree onto a caller-provided Skia canvas.
//
// Frame contract (docs/FREYA-PLAN.md sections 2.2 and freya-embedded.md 4/5/10/12):
//   feed_event -> EventsMeasurerAdapter hit-tests -> queue EventsChunk::Processed
//   process()  -> drain EventsChunk (Processed -> executor, Batch -> handle_event),
//                 pump runner (registering our calloop waker), sync_and_update,
//                 run_in(apply_mutations); needs_render -> mark layout dirty + redraw
//   render     -> measure_layout (dispatching its generated Batch next process),
//                 RenderPipeline.render() into the wrapped fbo
// CRITICAL: measure_layout's generated Batch events are dispatched by the next
// process() (not merely drained), matching freya-testing/freya-winit.

use std::borrow::Cow;
use std::cell::Cell;
use std::pin::pin;
use std::rc::Rc;
use std::task::{Context as TaskContext, Waker};

use accesskit::{Node as AccessNode, Role as AccessRole};
use freya_clipboard::copypasta::ClipboardProvider;
use freya_components::cache::AssetCacher;
use freya_components::integration::integration;
use freya_core::integration::*;
use freya_core::prelude::Color;
use freya_engine::prelude::{Canvas, FontCollection, FontMgr, TypefaceFontProvider};
use ragnarok::{EventsExecutorRunner, EventsMeasurerRunner, NodesState};
use smithay_client_toolkit::compositor::Surface as SctkSurface;
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shell::wlr_layer::LayerSurface;
use torin::prelude::Size2D;
use wayland_client::protocol::wl_output::WlOutput;
use wayland_client::protocol::wl_surface::WlSurface;
use wayland_protocols::wp::fractional_scale::v1::client::wp_fractional_scale_v1::WpFractionalScaleV1;
use wayland_protocols::wp::viewporter::client::wp_viewport::WpViewport;
use wayland_protocols::xdg::shell::client::xdg_popup::XdgPopup;
use wayland_protocols::xdg::shell::client::xdg_positioner::{
    Anchor as XdgAnchor, ConstraintAdjustment, Gravity as XdgGravity,
};
use wayland_protocols::xdg::shell::client::xdg_surface::XdgSurface;

use crate::egl::LayerEglSurface;
use crate::frame::FrameClock;
use crate::{FrameStats, SurfaceId};

/// One layer surface's embedded Freya instance plus its Wayland/EGL handles.
pub(crate) struct FreyaLayerSurface {
    pub(crate) id: SurfaceId,

    // --- Freya runtime ---
    runner: Runner,
    tree: Tree,
    nodes_state: NodesState<NodeId>,
    font_collection: FontCollection,
    font_manager: FontMgr,
    default_fonts: Vec<Cow<'static, str>>,
    events_sender: futures_channel::mpsc::UnboundedSender<EventsChunk>,
    events_receiver: futures_channel::mpsc::UnboundedReceiver<EventsChunk>,
    platform: Platform,
    // Kept alive so the root-context clone stays valid; also lets us tune speed later.
    _animation_clock: AnimationClock,
    ticker_sender: RenderingTickerSender,
    frame_stats: State<FrameStats>,
    /// Set true by the Platform sender (UserEvent::RequestRedraw) and whenever tree
    /// mutations report needs_render. Shared with the sender closure via Rc.
    redraw: Rc<Cell<bool>>,
    /// Wakes the calloop loop to re-pump this runner when a task becomes ready while
    /// the loop is otherwise idle.
    waker: Waker,

    // --- sizing / scale ---
    /// Preferred scale numerator over 120: effective scale factor = scale_num/120.
    /// The integer wl buffer_scale fallback keeps this a multiple of 120.
    scale_num: u32,
    logical_size: (u32, u32),
    physical_size: (i32, i32),

    /// Set for content-sized surfaces: fixed logical width + max height (the
    /// measurement viewport) plus the last logical height we asked the compositor
    /// for (the resize-request loop guard). `None` for `Exact` surfaces.
    content: Option<ContentSized>,

    // --- state flags ---
    pub(crate) configured: bool,
    pub(crate) frame_pending: bool,
    layout_dirty: bool,

    clock: FrameClock,
    frames_since_log: u32,

    // --- Wayland / EGL (egl_surface MUST drop before `role`) ---
    pub(crate) egl_surface: Option<LayerEglSurface>,
    /// wp_viewport driving the logical<-physical mapping. `Some` => fractional
    /// mode: wl buffer_scale stays 1 and the viewport destination carries the
    /// logical size, so the physical buffer may be any round(logical*scale).
    /// `None` => integer buffer_scale fallback (viewporter/fractional-scale absent).
    /// Destroyed with `fractional` in Drop while `wl_surface` is still alive.
    viewport: Option<WpViewport>,
    /// wp_fractional_scale_v1 add-on; kept alive so preferred_scale keeps arriving.
    fractional: Option<WpFractionalScaleV1>,
    /// The wl role backing this surface: a wlr layer surface, or an xdg popup
    /// parented to another surface. Both share every other field (the Freya runtime,
    /// EGL, scale/frame machinery); only the wl protocol object and its
    /// configure/resize semantics differ. Owns the role objects, which the Drop impl
    /// tears down (xdg role objects + wl_surface) while `wl_surface` is still alive.
    role: SurfaceRole,
    wl_surface: WlSurface,
    /// The output this surface is bound to, if any. Recorded so the host can find
    /// and tear down every surface for a destroyed output (see conn.rs
    /// output_destroyed). `None` for a compositor-placed (output-less) surface. A
    /// plain proxy handle -- dropping it sends nothing, so it needs no Drop ordering.
    pub(crate) output: Option<WlOutput>,
}

/// Content-sizing state for a surface: it keeps a fixed logical `width` and sizes
/// its height to its Freya content, bounded by `max_height`. The tree is measured
/// at `(width, max_height)` (the viewport), the root content extent is read back,
/// and a new surface size is requested only when the measured height changed;
/// `last_requested_h` is that guard (and the zero-axis fallback for configure).
struct ContentSized {
    width: u32,
    max_height: u32,
    last_requested_h: u32,
}

/// The wl role object(s) backing a [`FreyaLayerSurface`]. A wlr layer surface is a
/// top-level shell surface; a popup is an `xdg_surface` + `xdg_popup` parented to
/// another surface (a layer surface via `zwlr_layer_surface_v1.get_popup`, or another
/// popup via `xdg_surface.get_popup`). Everything else about the embedded Freya
/// instance is identical, so both share the same struct.
pub(crate) enum SurfaceRole {
    Layer(LayerSurface),
    Popup(PopupRole),
}

impl SurfaceRole {
    /// The wl_surface carrying this role's buffers.
    fn wl_surface(&self) -> &WlSurface {
        match self {
            SurfaceRole::Layer(layer) => layer.wl_surface(),
            SurfaceRole::Popup(popup) => popup.surface.wl_surface(),
        }
    }
}

/// An xdg popup role: the `xdg_surface`/`xdg_popup` pair plus the sctk `Surface` that
/// owns the underlying `wl_surface` (it sends `wl_surface.destroy` on drop, after the
/// xdg role objects are destroyed in [`FreyaLayerSurface`]'s Drop). Kept `pub(crate)`
/// so the host (conn.rs) drives the protocol requests (grab/reposition/ack) while the
/// surface owns the objects' lifetime.
pub(crate) struct PopupRole {
    /// Owns the popup wl_surface; destroys it on drop (ordered after the xdg objects).
    pub(crate) surface: SctkSurface,
    pub(crate) xdg_surface: XdgSurface,
    pub(crate) xdg_popup: XdgPopup,
    /// The surface this popup is anchored to (a layer surface or another popup). A
    /// parent's teardown recursively retires its popups (see conn.rs).
    pub(crate) parent: SurfaceId,
    /// Positioner inputs, retained so a content-size change can rebuild the positioner
    /// and drive `xdg_popup.reposition` -- the popup analogue of a layer `set_size`.
    pub(crate) geometry: PopupGeometry,
    /// Monotonic reposition token (echoed back in `xdg_popup.repositioned`).
    pub(crate) reposition_token: u32,
    /// Size (logical) from the most recent `xdg_popup.configure`, applied on the
    /// paired `xdg_surface.configure` (which carries the serial to ack).
    pub(crate) pending: (u32, u32),
}

/// Positioner inputs for an xdg popup: the anchor rectangle (parent-local logical
/// coords) plus the anchor/gravity/constraint-adjustment. Retained so a content-size
/// change can rebuild an equivalent positioner for `xdg_popup.reposition`.
#[derive(Clone, Copy)]
pub(crate) struct PopupGeometry {
    pub(crate) anchor_rect: (i32, i32, i32, i32),
    pub(crate) anchor: XdgAnchor,
    pub(crate) gravity: XdgGravity,
    pub(crate) constraint: ConstraintAdjustment,
}

/// Handle for registering app-level root contexts before a surface mounts.
///
/// Passed to the `setup` closure of [`crate::Shell::create_surface_on_outputs`];
/// each [`SurfaceContexts::provide`] registers a value resolvable in the surface's
/// UI via `use_consume::<T>()` and returns the created handle so the host thread can
/// keep writing into it (e.g. a `State<Snapshot>` fanned service updates into).
pub struct SurfaceContexts<'a> {
    runner: &'a mut Runner,
}

impl SurfaceContexts<'_> {
    /// Provide a root context. `factory` runs inside the runner's root scope, so
    /// `State::create(...)` and other context-dependent constructors are valid here.
    pub fn provide<T: Clone + 'static>(&mut self, factory: impl FnOnce() -> T) -> T {
        self.runner.provide_root_context(factory)
    }
}

impl FreyaLayerSurface {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new<C>(
        id: SurfaceId,
        role: SurfaceRole,
        initial_logical: (u32, u32),
        waker: Waker,
        app: impl Fn() -> Element + 'static,
        setup: impl FnOnce(&mut SurfaceContexts<'_>) -> C,
        content: Option<(u32, u32)>,
    ) -> (Self, C) {
        let wl_surface = role.wl_surface().clone();
        // Start at scale 1.0 (num=120); the compositor updates it via
        // wp_fractional_scale_v1::preferred_scale (fractional mode) or the integer
        // wl_output buffer scale (integer fallback).
        let scale_num = SCALE_DENOM;
        let physical = (
            physical_dim(initial_logical.0, scale_num),
            physical_dim(initial_logical.1, scale_num),
        );

        let (events_sender, events_receiver) = futures_channel::mpsc::unbounded();

        // Fonts: a dynamic provider for app-registered faces plus the OS default.
        let mut font_collection = FontCollection::new();
        let default_font_manager = FontMgr::default();
        let dynamic_font_manager: FontMgr = TypefaceFontProvider::new().into();
        font_collection.set_default_font_manager(default_font_manager, None);
        font_collection.set_dynamic_font_manager(dynamic_font_manager.clone());

        // Root component, wrapped like freya-winit so global accessibility keys work.
        let app = Rc::new(app);
        let mut runner = Runner::new({
            let app = app.clone();
            move || {
                let app = app.clone();
                integration(AppComponent::from(move || app())).into_element()
            }
        });

        // Root contexts, mirroring freya-winit's AppWindow::new so stock components,
        // hooks, animations, clipboard and assets all resolve their contexts.
        runner.provide_root_context(ScreenReader::new);

        let (ticker_sender, ticker) = RenderingTicker::new();
        runner.provide_root_context(|| ticker);

        let animation_clock = AnimationClock::new();
        runner.provide_root_context(|| animation_clock.clone());

        runner.provide_root_context(AssetCacher::create);

        let redraw = Rc::new(Cell::new(false));
        let platform = runner.provide_root_context({
            let redraw = redraw.clone();
            let pw = physical.0 as f32;
            let ph = physical.1 as f32;
            move || Platform {
                focused_accessibility_id: State::create(ACCESSIBILITY_ROOT_ID),
                focused_accessibility_node: State::create(AccessNode::new(AccessRole::Window)),
                root_size: State::create(Size2D::new(pw, ph)),
                scale_factor: State::create(scale_num as f64 / SCALE_DENOM as f64),
                navigation_mode: State::create(NavigationMode::NotKeyboard),
                // kobel is a dark-first shell.
                preferred_theme: State::create(PreferredTheme::Dark),
                is_app_focused: State::create(true),
                accent_color: State::create(AccentColor::default()),
                // Any UserEvent (RequestRedraw from hooks/animations, and best-effort
                // for the deferred focus/cursor events) schedules a redraw. Since all
                // Freya runtime work is single-threaded on the loop thread, setting a
                // flag is enough; the sweep acts on it after process() returns.
                sender: Rc::new(move |_event: UserEvent| {
                    redraw.set(true);
                }),
            }
        });

        // Clipboard context. Phase 0/1 provides an empty clipboard (the launcher uses
        // a custom text field, not stock Input); wiring copypasta's Wayland clipboard
        // from the display pointer is a later addition. TODO real clipboard.
        runner.provide_root_context(|| State::create(None::<Box<dyn ClipboardProvider>>));

        let frame_stats = runner.provide_root_context(|| State::create(FrameStats::default()));

        let tree = Tree::default();
        runner.provide_root_context(|| tree.accessibility_generator.clone());
        runner.provide_root_context(|| font_collection.clone());

        // App-level root contexts (ShellBus, service snapshots, theme tokens) are
        // registered here, after the host-owned contexts and before the first mount,
        // so the surface's UI resolves them on its initial render. The returned
        // handles let the host thread fan updates into each surface.
        let extra = setup(&mut SurfaceContexts { runner: &mut runner });

        let mut surface = Self {
            id,
            runner,
            tree,
            nodes_state: NodesState::default(),
            font_collection,
            font_manager: dynamic_font_manager,
            default_fonts: default_fonts(),
            events_sender,
            events_receiver,
            platform,
            _animation_clock: animation_clock,
            ticker_sender,
            frame_stats,
            redraw,
            waker,
            scale_num,
            logical_size: initial_logical,
            physical_size: physical,
            content: content
                .map(|(width, max_height)| ContentSized { width, max_height, last_requested_h: 0 }),
            configured: false,
            frame_pending: false,
            layout_dirty: true,
            clock: FrameClock::new(),
            frames_since_log: 0,
            egl_surface: None,
            viewport: None,
            fractional: None,
            role,
            wl_surface,
            // Set by the host after construction (create_surface_impl) once the
            // bound output is known; new() is output-agnostic.
            output: None,
        };
        // Build the initial tree and mount the app (spawns animations, etc.).
        surface.process();
        (surface, extra)
    }

    pub(crate) fn wl_surface(&self) -> &WlSurface {
        &self.wl_surface
    }

    /// Commit pending double-buffered surface state (equivalent for either role).
    pub(crate) fn commit(&self) {
        self.wl_surface.commit();
    }

    /// The wlr layer role, if this surface is a layer surface (`None` for a popup).
    /// Layer-only requests (set_size/anchor/keyboard-interactivity) go through here.
    pub(crate) fn layer_surface(&self) -> Option<&LayerSurface> {
        match &self.role {
            SurfaceRole::Layer(layer) => Some(layer),
            SurfaceRole::Popup(_) => None,
        }
    }

    /// Whether this surface is an xdg popup.
    pub(crate) fn is_popup(&self) -> bool {
        matches!(self.role, SurfaceRole::Popup(_))
    }

    /// The popup role, if this surface is a popup (`None` for a layer surface).
    pub(crate) fn popup(&self) -> Option<&PopupRole> {
        match &self.role {
            SurfaceRole::Popup(popup) => Some(popup),
            SurfaceRole::Layer(_) => None,
        }
    }

    /// The popup role for mutation (pending size, reposition token).
    pub(crate) fn popup_mut(&mut self) -> Option<&mut PopupRole> {
        match &mut self.role {
            SurfaceRole::Popup(popup) => Some(popup),
            SurfaceRole::Layer(_) => None,
        }
    }

    pub(crate) fn physical_size(&self) -> (i32, i32) {
        self.physical_size
    }

    pub(crate) fn wants_redraw(&self) -> bool {
        self.redraw.get()
    }

    /// Effective scale factor in effect (scale_num/120). Feeds measure_layout,
    /// RenderPipeline, Platform.scale_factor and the events hit-test path.
    pub(crate) fn scale_factor(&self) -> f64 {
        self.scale_num as f64 / SCALE_DENOM as f64
    }

    /// Current surface-local logical size (what the layer surface is sized to).
    pub(crate) fn logical_size(&self) -> (u32, u32) {
        self.logical_size
    }

    /// Update the integer wl buffer scale (wl_output/compositor). No-op in
    /// fractional mode -- wp_fractional_scale_v1 owns the scale there and
    /// buffer_scale must stay 1. Returns true if the effective scale changed.
    pub(crate) fn set_integer_scale(&mut self, scale: i32) -> bool {
        if self.viewport.is_some() {
            return false;
        }
        self.apply_scale_num((scale.max(1) as u32).saturating_mul(SCALE_DENOM))
    }

    /// Apply a preferred fractional scale (numerator over 120) from
    /// wp_fractional_scale_v1::preferred_scale. Only meaningful in fractional mode.
    /// Returns true if the effective scale changed.
    pub(crate) fn set_fractional_scale(&mut self, num: u32) -> bool {
        if self.viewport.is_none() {
            return false;
        }
        self.apply_scale_num(num.max(1))
    }

    /// Common scale update: recompute the physical buffer, push the new scale
    /// factor to Platform, and reset the layout + text caches so Torin/Skia
    /// re-measure at the new scale (mirrors freya-winit's ScaleFactorChanged).
    fn apply_scale_num(&mut self, num: u32) -> bool {
        if num == self.scale_num {
            return false;
        }
        self.scale_num = num;
        self.recompute_physical();
        self.platform.scale_factor.set_if_modified(self.scale_factor());
        self.tree.layout.reset();
        self.tree.text_cache.reset();
        self.layout_dirty = true;
        self.redraw.set(true);
        true
    }

    /// Attach the wp_viewport + wp_fractional_scale_v1 add-ons, switching this
    /// surface to fractional scaling. Called once by the host right after
    /// construction when the compositor advertised both globals.
    pub(crate) fn enable_fractional(
        &mut self,
        viewport: WpViewport,
        fractional: WpFractionalScaleV1,
    ) {
        self.viewport = Some(viewport);
        self.fractional = Some(fractional);
    }

    /// Whether this surface is driven by fractional scaling (viewport present).
    pub(crate) fn is_fractional(&self) -> bool {
        self.viewport.is_some()
    }

    /// Commit the scale mapping for the current logical size (sticky double-buffered
    /// state, applied on the next surface commit -- the render swap): fractional
    /// mode sets the viewport destination to the logical size and leaves
    /// buffer_scale at 1; the integer fallback sets wl buffer_scale. The viewport
    /// destination needs positive axes, so a not-yet-configured zero axis (e.g. a
    /// both-edges-anchored bar) is skipped until the first real configure.
    pub(crate) fn apply_surface_scaling(&mut self) {
        match &self.viewport {
            Some(vp) => {
                let (lw, lh) = self.logical_size;
                if lw > 0 && lh > 0 && lw <= i32::MAX as u32 && lh <= i32::MAX as u32 {
                    vp.set_destination(lw as i32, lh as i32);
                    tracing::info!(
                        "[host] surface {:?} viewport destination {lw}x{lh} (buffer_scale=1)",
                        self.id
                    );
                }
            }
            None => {
                let scale = (self.scale_num / SCALE_DENOM).max(1) as i32;
                self.wl_surface.set_buffer_scale(scale);
            }
        }
    }

    /// Update the surface-local logical size (from a layer-shell configure).
    pub(crate) fn set_logical_size(&mut self, width: u32, height: u32) {
        if (width, height) == self.logical_size {
            return;
        }
        self.logical_size = (width, height);
        self.recompute_physical();
        self.layout_dirty = true;
        self.redraw.set(true);
    }

    /// Apply a layer-shell configure's suggested size. A zero axis (we set width 0 on
    /// a bar anchored to both horizontal edges) keeps the current logical size for
    /// that axis. The Host owns the `configured` flag and EGL surface creation.
    pub(crate) fn on_configure(&mut self, new_size: (u32, u32)) {
        // Sanitize the compositor-provided size: a layer-surface axis always fits in
        // i32, so a value beyond i32::MAX (a negative int arriving as u32, which a
        // just-appeared output can send while its geometry is still settling) is
        // treated as unspecified (0) so we fall back below rather than hand
        // wp_viewport a negative destination -- a fatal protocol error (see the
        // hotplug lifecycle work). A correct configure follows once geometry settles.
        let (cw, ch) = (sane_axis(new_size.0), sane_axis(new_size.1));
        let width = if cw != 0 { cw } else { self.logical_size.0 };
        // A zero height axis means "you choose": for a content-sized surface fall
        // back to the height we last requested, otherwise keep the current logical
        // height (a bar/drawer whose height is compositor-filled).
        let height = if ch != 0 {
            ch
        } else if let Some(c) = &self.content {
            c.last_requested_h.max(1)
        } else {
            self.logical_size.1
        };
        self.set_logical_size(width, height);
    }

    fn recompute_physical(&mut self) {
        let (lw, lh) = self.logical_size;
        self.physical_size = (physical_dim(lw, self.scale_num), physical_dim(lh, self.scale_num));
    }

    /// Hit-test an input event and queue it for dispatch on the next `process()`.
    /// `cursor` coordinates inside `event` must already be surface-local *physical*
    /// pixels (see input.rs / conn.rs).
    pub(crate) fn feed_event(&mut self, event: PlatformEvent) {
        let scale_factor = self.scale_factor();
        let processed = EventsMeasurerAdapter { tree: &mut self.tree, scale_factor }
            .run(&mut vec![event], &mut self.nodes_state, None);
        let _ = self.events_sender.unbounded_send(EventsChunk::Processed(processed));
    }

    /// Pump the Freya runtime once. Returns true if the runner still had ready work
    /// (the caller should re-arm another pump), false once it is idle (our waker is
    /// now registered to wake the loop on the next task readiness).
    pub(crate) fn process(&mut self) -> bool {
        // 1. Dispatch queued event chunks. Batch chunks are the events generated by
        //    the previous frame's measure_layout -- they are dispatched here, not
        //    merely drained.
        while let Ok(chunk) = self.events_receiver.try_recv() {
            match chunk {
                EventsChunk::Processed(processed) => {
                    EventsExecutorAdapter { runner: &mut self.runner }
                        .run(&mut self.nodes_state, processed);
                }
                EventsChunk::Batch(events) => {
                    for ev in events {
                        self.runner.handle_event(ev.node_id, ev.name, ev.data, ev.bubbles);
                    }
                }
            }
        }

        // 2. Pump the runner with our calloop-ping waker so a later idle task wake
        //    (animation ticker/Timer) pings the loop back awake.
        let ready = {
            let mut cx = TaskContext::from_waker(&self.waker);
            let mut fut = pin!(self.runner.handle_events());
            fut.as_mut().poll(&mut cx).is_ready()
        };

        // 3. Compute + apply tree mutations.
        let mutations = self.runner.sync_and_update();
        let result = self.runner.run_in(|| self.tree.apply_mutations(mutations));
        if result.needs_render {
            self.layout_dirty = true;
            self.redraw.set(true);
        }
        ready
    }

    /// Run Torin layout if dirty (a cheap no-op otherwise), then, for a content-sized
    /// surface, read the root content height and return the surface size to request
    /// when it differs from the last requested one (the caller does the
    /// `set_size + commit`, without touching the EGL buffer). Returns `None` for an
    /// `Exact` surface or when no new size is needed.
    ///
    /// A content-sized surface is ALWAYS measured at its fixed `(width, max_height)`
    /// viewport -- never at the currently configured buffer size -- so a compositor
    /// configure can never cap future growth and there is no measure/configure loop.
    #[must_use]
    pub(crate) fn measure_if_dirty(&mut self) -> Option<(u32, u32)> {
        if self.layout_dirty {
            let size = self.measure_size();
            let scale_factor = self.scale_factor();
            self.tree.measure_layout(
                size,
                &mut self.font_collection,
                &self.font_manager,
                &self.events_sender,
                scale_factor,
                &self.default_fonts,
            );
            self.platform.root_size.set_if_modified(size);
            self.layout_dirty = false;
        }
        self.poll_content_request()
    }

    /// The physical size Torin measures at: the fixed content viewport for a
    /// content-sized surface, otherwise the currently configured buffer size.
    fn measure_size(&self) -> Size2D {
        match &self.content {
            Some(c) => Size2D::new(
                physical_dim(c.width, self.scale_num) as f32,
                physical_dim(c.max_height, self.scale_num) as f32,
            ),
            None => {
                let (pw, ph) = self.physical_size;
                Size2D::new(pw as f32, ph as f32)
            }
        }
    }

    /// Whether this surface sizes itself to its content.
    pub(crate) fn is_content_sized(&self) -> bool {
        self.content.is_some()
    }

    /// Read the freshly measured root content extent and, for a content-sized
    /// surface, decide the new surface size to request. The synthetic Torin root is
    /// hard-coded to `Size::Fill` (freya-core's TreeAdapterFreya), so its `area` is
    /// always the whole viewport; the measured CONTENT extent is its `inner_sizes`
    /// (the vertical stack accumulates child heights there). Physical -> logical is
    /// rounded up so the last row is never clipped, then clamped to `[1, max_height]`.
    fn poll_content_request(&mut self) -> Option<(u32, u32)> {
        let (width, max_height) = match &self.content {
            Some(c) => (c.width, c.max_height),
            None => return None,
        };
        let content_phys =
            self.tree.layout.get(&NodeId::ROOT).map(|n| n.inner_sizes.height).unwrap_or(0.0);
        let logical_h = content_logical_height(content_phys, self.scale_factor(), max_height);
        let c = self.content.as_mut().expect("content present");
        if logical_h != c.last_requested_h {
            c.last_requested_h = logical_h;
            Some((width, logical_h))
        } else {
            None
        }
    }

    /// Paint the current tree onto `canvas`. The tree must already be measured.
    pub(crate) fn render_into(&mut self, canvas: &Canvas) {
        let scale_factor = self.scale_factor();
        RenderPipeline {
            font_collection: &mut self.font_collection,
            font_manager: &self.font_manager,
            tree: &self.tree,
            canvas,
            scale_factor,
            // Transparent so the compositor blends the surface (translucent panels).
            background: Color::TRANSPARENT,
        }
        .render();
    }

    /// Called just after a successful present: reset the redraw flag, notify the
    /// rendering ticker (advancing animation tasks), and record frame timing.
    pub(crate) fn after_present(&mut self) {
        self.redraw.set(false);
        let _ = self.ticker_sender.send(());
        let ms = self.clock.tick();
        let stats = FrameStats {
            fps: self.clock.fps().round(),
            scale: self.scale_factor() as f32,
            last_frame_ms: (ms * 10.0).round() / 10.0,
        };
        // set_if_modified: only dirties consumers when the rounded value changes, so
        // a non-consuming surface stays idle and a consumer redraws at most ~1/frame.
        self.frame_stats.set_if_modified(stats);
        // Throttled frame-time log (~every 120 frames) so the devkit can watch smoothness.
        self.frames_since_log += 1;
        if self.frames_since_log >= 120 {
            self.frames_since_log = 0;
            tracing::info!(
                "[host] surface {:?} fps={:.0} frame={:.1}ms",
                self.id, stats.fps, stats.last_frame_ms
            );
        }
    }
}

impl Drop for FreyaLayerSurface {
    fn drop(&mut self) {
        // wp_viewport / wp_fractional_scale_v1 have explicit `destroy` requests that
        // dropping the Rust proxy does NOT send. Tear them down here, before the
        // fields drop, so the wl_surface is still alive and no inert server-side
        // objects linger for a compositor-closed surface.
        if let Some(vp) = &self.viewport {
            vp.destroy();
        }
        if let Some(fs) = &self.fractional {
            fs.destroy();
        }
        // A popup's xdg role objects also have explicit destructors. Destroy them
        // child-first (xdg_popup before its xdg_surface) while the wl_surface is
        // still alive; the owning sctk Surface (in the PopupRole) then sends
        // wl_surface.destroy when the `role` field drops, after egl_surface.
        if let SurfaceRole::Popup(popup) = &self.role {
            popup.xdg_popup.destroy();
            popup.xdg_surface.destroy();
        }
    }
}

/// Wayland fractional-scale denominator: wp_fractional_scale_v1::preferred_scale is
/// a numerator over 120 (so scale 1.5 == 180/120).
const SCALE_DENOM: u32 = 120;

/// Sanitize a compositor-provided configure axis. Layer-surface sizes always fit in
/// i32; a value beyond i32::MAX is a negative int arriving as u32 (a just-appeared
/// output can send one while its logical geometry is still settling), so it is mapped
/// to 0 ("unspecified") and on_configure falls back to the current/requested size --
/// never passing wp_viewport a negative destination, which is a fatal protocol error.
fn sane_axis(v: u32) -> u32 {
    if v > i32::MAX as u32 { 0 } else { v }
}

/// Physical pixels for a logical dimension at a scale numerator over 120. Uses the
/// protocol's round-half-away-from-zero (round(logical * num / 120)), computed in
/// integer math so it matches the compositor exactly; floors at 1 so a zero axis
/// still yields a valid 1px buffer. Integer buffer_scale is the num = 120*k case.
fn physical_dim(logical: u32, scale_num: u32) -> i32 {
    let num = scale_num.max(1) as u128;
    let denom = SCALE_DENOM as u128;
    let phys = (logical as u128 * num + denom / 2) / denom;
    phys.clamp(1, i32::MAX as u128) as i32
}

/// Convert a measured physical content height into the logical surface height to
/// request for a content-sized surface. Rounds UP (so a fractional last row is
/// never clipped) and clamps to `[1, max_height]` (never a zero-height surface,
/// never taller than the configured viewport bound).
fn content_logical_height(content_phys: f32, scale: f64, max_height: u32) -> u32 {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    ((content_phys as f64 / scale).ceil() as i64).clamp(1, max_height as i64) as u32
}

#[cfg(test)]
mod tests {
    use super::{SCALE_DENOM, content_logical_height, physical_dim, sane_axis};

    #[test]
    fn sane_axis_maps_out_of_i32_range_to_zero() {
        // In-range sizes pass through unchanged.
        assert_eq!(sane_axis(0), 0);
        assert_eq!(sane_axis(1280), 1280);
        assert_eq!(sane_axis(i32::MAX as u32), i32::MAX as u32);
        // A negative int arriving as u32 (compositor bug on an unsettled output) is
        // treated as unspecified so on_configure falls back instead of crashing.
        assert_eq!(sane_axis(i32::MAX as u32 + 1), 0);
        assert_eq!(sane_axis(4294967287), 0); // seen in practice: -9 as u32
        assert_eq!(sane_axis(u32::MAX), 0);
    }

    #[test]
    fn divides_physical_by_scale_and_rounds_up() {
        // 420px content at scale 1 -> 420 logical.
        assert_eq!(content_logical_height(420.0, 1.0, 700), 420);
        // A fractional extent rounds up so the last row is never clipped.
        assert_eq!(content_logical_height(420.2, 1.0, 700), 421);
        // HiDPI: physical is scale x logical, so divide back down.
        assert_eq!(content_logical_height(840.0, 2.0, 700), 420);
        assert_eq!(content_logical_height(841.0, 2.0, 700), 421);
        // Fractional scale (1.5): 630 physical -> 420 logical.
        assert_eq!(content_logical_height(630.0, 1.5, 700), 420);
        assert_eq!(content_logical_height(630.1, 1.5, 700), 421);
    }

    #[test]
    fn clamps_to_max_height_ceiling() {
        // Content taller than the bound is capped (the surface scrolls instead).
        assert_eq!(content_logical_height(900.0, 1.0, 640), 640);
        assert_eq!(content_logical_height(1400.0, 2.0, 640), 640);
    }

    #[test]
    fn never_requests_a_zero_height_surface() {
        // Empty/unmeasured content floors at 1px, not 0.
        assert_eq!(content_logical_height(0.0, 1.0, 520), 1);
        assert_eq!(content_logical_height(0.4, 1.0, 520), 1);
    }

    #[test]
    fn guards_a_nonpositive_scale() {
        // A bogus scale is treated as 1 rather than dividing by zero.
        assert_eq!(content_logical_height(300.0, 0.0, 700), 300);
    }

    #[test]
    fn physical_dim_integer_scale_is_exact_multiple() {
        // Integer buffer_scale is num = 120*k: physical = logical*k, no rounding.
        assert_eq!(physical_dim(100, SCALE_DENOM), 100);
        assert_eq!(physical_dim(100, 2 * SCALE_DENOM), 200);
        assert_eq!(physical_dim(1280, 3 * SCALE_DENOM), 3840);
    }

    #[test]
    fn physical_dim_fractional_rounds_half_up() {
        // Protocol example: 100x50 logical at 1.5 (num=180) -> 150x75 buffer.
        assert_eq!(physical_dim(100, 180), 150);
        assert_eq!(physical_dim(50, 180), 75);
        // round(logical*num/120), half away from zero.
        // 101*180/120 = 151.5 -> 152.
        assert_eq!(physical_dim(101, 180), 152);
        // 1*125/120 = 1.041.. -> 1; 12*125/120 = 12.5 -> 13.
        assert_eq!(physical_dim(12, 125), 13);
        // 1280 at 1.25 (num=150) -> 1600 exactly.
        assert_eq!(physical_dim(1280, 150), 1600);
    }

    #[test]
    fn physical_dim_floors_at_one() {
        // A zero axis (both-edges-anchored bar before configure) still yields 1px.
        assert_eq!(physical_dim(0, 180), 1);
        // A bogus zero numerator is treated as 1 rather than collapsing to 0.
        assert_eq!(physical_dim(100, 0), 1);
    }

    #[test]
    fn physical_dim_saturates_instead_of_overflowing() {
        // Absurd inputs must clamp to i32::MAX (u128 intermediate), never wrap
        // negative or panic.
        assert_eq!(physical_dim(u32::MAX, u32::MAX), i32::MAX);
    }
}
