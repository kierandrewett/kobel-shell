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
use smithay_client_toolkit::shell::WaylandSurface;
use smithay_client_toolkit::shell::wlr_layer::LayerSurface;
use torin::prelude::Size2D;
use wayland_client::protocol::wl_surface::WlSurface;

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
    scale: i32,
    logical_size: (u32, u32),
    physical_size: (i32, i32),

    // --- state flags ---
    pub(crate) configured: bool,
    pub(crate) frame_pending: bool,
    layout_dirty: bool,

    clock: FrameClock,
    frames_since_log: u32,

    // --- Wayland / EGL (egl_surface MUST drop before `layer`) ---
    pub(crate) egl_surface: Option<LayerEglSurface>,
    pub(crate) layer: LayerSurface,
    wl_surface: WlSurface,
}

impl FreyaLayerSurface {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        id: SurfaceId,
        layer: LayerSurface,
        initial_logical: (u32, u32),
        scale: i32,
        waker: Waker,
        app: impl Fn() -> Element + 'static,
    ) -> Self {
        let scale = scale.max(1);
        let wl_surface = layer.wl_surface().clone();
        let physical = ((initial_logical.0 as i32 * scale).max(1), (initial_logical.1 as i32 * scale).max(1));

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
                scale_factor: State::create(scale as f64),
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
            scale,
            logical_size: initial_logical,
            physical_size: physical,
            configured: false,
            frame_pending: false,
            layout_dirty: true,
            clock: FrameClock::new(),
            frames_since_log: 0,
            egl_surface: None,
            layer,
            wl_surface,
        };
        // Build the initial tree and mount the app (spawns animations, etc.).
        surface.process();
        surface
    }

    pub(crate) fn wl_surface(&self) -> &WlSurface {
        &self.wl_surface
    }

    pub(crate) fn physical_size(&self) -> (i32, i32) {
        self.physical_size
    }

    pub(crate) fn wants_redraw(&self) -> bool {
        self.redraw.get()
    }

    /// Current integer buffer scale in effect for this surface.
    pub(crate) fn scale(&self) -> i32 {
        self.scale
    }

    /// Update the integer buffer scale (from output/compositor). Recomputes the
    /// physical buffer size and forces a relayout.
    pub(crate) fn set_scale(&mut self, scale: i32) -> bool {
        let scale = scale.max(1);
        if scale == self.scale {
            return false;
        }
        self.scale = scale;
        self.recompute_physical();
        self.platform.scale_factor.set_if_modified(scale as f64);
        self.layout_dirty = true;
        self.redraw.set(true);
        true
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
        let (cw, ch) = new_size;
        let width = if cw != 0 { cw } else { self.logical_size.0 };
        let height = if ch != 0 { ch } else { self.logical_size.1 };
        self.set_logical_size(width, height);
    }

    fn recompute_physical(&mut self) {
        let (lw, lh) = self.logical_size;
        self.physical_size = ((lw as i32 * self.scale).max(1), (lh as i32 * self.scale).max(1));
    }

    /// Hit-test an input event and queue it for dispatch on the next `process()`.
    /// `cursor` coordinates inside `event` must already be surface-local *physical*
    /// pixels (see input.rs / conn.rs).
    pub(crate) fn feed_event(&mut self, event: PlatformEvent) {
        let processed = EventsMeasurerAdapter { tree: &mut self.tree, scale_factor: self.scale as f64 }
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

    /// Run Torin layout if dirty. Cheap no-op otherwise. Called just before render.
    pub(crate) fn measure_if_dirty(&mut self) {
        if !self.layout_dirty {
            return;
        }
        let (pw, ph) = self.physical_size;
        let size = Size2D::new(pw as f32, ph as f32);
        self.tree.measure_layout(
            size,
            &mut self.font_collection,
            &self.font_manager,
            &self.events_sender,
            self.scale as f64,
            &self.default_fonts,
        );
        self.platform.root_size.set_if_modified(size);
        self.layout_dirty = false;
    }

    /// Paint the current tree onto `canvas`. The tree must already be measured.
    pub(crate) fn render_into(&mut self, canvas: &Canvas) {
        RenderPipeline {
            font_collection: &mut self.font_collection,
            font_manager: &self.font_manager,
            tree: &self.tree,
            canvas,
            scale_factor: self.scale as f64,
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
            scale: self.scale as f32,
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
