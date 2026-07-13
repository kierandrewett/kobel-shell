// kobel-wayland: a Wayland wlr-layer-shell host that embeds Freya without winit.
//
// One process drives N layer surfaces; each owns its own Freya runtime (Runner +
// Tree + fonts + events) and all share a single EGL context and Skia DirectContext.
// Input (pointer/keyboard/scroll) is decoded into freya_core::PlatformEvent, frames
// are scheduled off wl frame callbacks, and animations/tasks are pumped through a
// calloop-integrated runner waker so an idle shell burns zero CPU.
//
// Layout of the crate (see docs/FREYA-PLAN.md sections 2, 3, 7):
//   conn.rs    -- Shell/host entry, sctk registry/compositor/output/seat/layer-shell
//   egl.rs     -- shared EGL display/context + per-surface window surface + Skia GL
//   surface.rs -- FreyaLayerSurface: the embedded Freya runtime + frame pipeline
//   input.rs   -- sctk pointer/keyboard -> PlatformEvent (pure, unit-tested)
//   frame.rs   -- runner waker (calloop ping) + frame-time clock

mod conn;
mod egl;
mod frame;
mod input;
mod surface;

pub use conn::{Control, Shell};
pub use surface::SurfaceContexts;

// Re-export the layer-shell config vocabulary so callers need not depend on sctk.
pub use smithay_client_toolkit::shell::wlr_layer::{Anchor, KeyboardInteractivity, Layer};

/// Crate result type. The error type is a defaulted parameter so common call sites
/// stay short while precise error types remain available.
pub type Result<T, E = anyhow::Error> = std::result::Result<T, E>;

/// Opaque identifier for a created layer surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SurfaceId(pub(crate) u32);

impl SurfaceId {
    /// Construct a surface id from its raw value. Real ids are minted by the host
    /// when a surface is created; this exists so callers can build and unit-test
    /// surface registries keyed by id without a live compositor.
    pub const fn new(raw: u32) -> Self {
        Self(raw)
    }
}

/// A thread-safe handle for waking the shell's event loop from a producer thread
/// (service fan-out, IPC listener). Waking schedules the app tick (see
/// [`Shell::on_tick`]) plus a sweep on the loop thread.
#[derive(Clone)]
pub struct LoopWaker(calloop::ping::Ping);

impl LoopWaker {
    pub(crate) fn new(ping: calloop::ping::Ping) -> Self {
        Self(ping)
    }

    /// Wake the loop. Safe to call from any thread.
    pub fn wake(&self) {
        self.0.ping();
    }
}

/// Edge margins in surface-local logical pixels, matching the wlr-layer-shell order.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Margins {
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub left: i32,
}

impl Margins {
    /// Uniform margin on all edges.
    pub fn all(value: i32) -> Self {
        Self { top: value, right: value, bottom: value, left: value }
    }
}

/// How a surface's size is chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SurfaceSize {
    /// Exact surface-local logical size. Use `0` on an axis that is anchored to both
    /// opposite edges to let the compositor fill it (e.g. a full-width bar is
    /// `Exact { width: 0, height: 120 }` with `Anchor::TOP | LEFT | RIGHT`).
    Exact { width: u32, height: u32 },
    /// Content-sized: the surface should size itself to its Freya content, bounded
    /// by the given maxima. NOT YET IMPLEMENTED in the Phase 0/1 host -- it needs an
    /// initial off-screen measure pass before the first commit, so creating a surface
    /// with this variant currently returns an error. Kept in the API so callers can
    /// express the intent (fixed bar vs content-sized) today.
    ContentSized { max_width: u32, max_height: u32 },
}

/// Configuration for one layer surface.
#[derive(Clone, Debug)]
pub struct SurfaceConfig {
    /// wlr-layer-shell namespace (kept as `kobel-*` so gnoblin window rules match).
    pub namespace: String,
    /// Z-depth layer.
    pub layer: Layer,
    /// Which edges to anchor to.
    pub anchor: Anchor,
    /// Edge margins.
    pub margins: Margins,
    /// Exclusive zone in logical pixels (`0` = none, `-1` = ignore others' zones).
    pub exclusive_zone: i32,
    /// Keyboard focus mode.
    pub keyboard_interactivity: KeyboardInteractivity,
    /// Size behaviour.
    pub size: SurfaceSize,
    /// When true, the surface is given an empty wl input region at creation, making
    /// it click-through (display-only). Used by the OSD (docs/FREYA-PLAN.md 2.4).
    pub input_region_empty: bool,
}

impl SurfaceConfig {
    /// A sensible default: top layer, no anchor, on-demand keyboard, exact size.
    pub fn new(namespace: impl Into<String>, size: SurfaceSize) -> Self {
        Self {
            namespace: namespace.into(),
            layer: Layer::Top,
            anchor: Anchor::empty(),
            margins: Margins::default(),
            exclusive_zone: 0,
            keyboard_interactivity: KeyboardInteractivity::None,
            size,
            input_region_empty: false,
        }
    }

    pub fn layer(mut self, layer: Layer) -> Self {
        self.layer = layer;
        self
    }

    pub fn anchor(mut self, anchor: Anchor) -> Self {
        self.anchor = anchor;
        self
    }

    pub fn margins(mut self, margins: Margins) -> Self {
        self.margins = margins;
        self
    }

    pub fn exclusive_zone(mut self, zone: i32) -> Self {
        self.exclusive_zone = zone;
        self
    }

    pub fn keyboard_interactivity(mut self, mode: KeyboardInteractivity) -> Self {
        self.keyboard_interactivity = mode;
        self
    }

    pub fn input_region_empty(mut self, empty: bool) -> Self {
        self.input_region_empty = empty;
        self
    }
}

/// A frame-timing / scale snapshot, provided to every surface as a Freya root
/// context (`State<FrameStats>`). Apps that consume it (e.g. an fps readout) will
/// naturally redraw as it changes; surfaces that do not consume it stay idle.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameStats {
    /// Smoothed frames per second.
    pub fps: f32,
    /// Integer buffer scale in effect.
    pub scale: f32,
    /// Milliseconds between the last two presents.
    pub last_frame_ms: f32,
}

/// A decoded keyboard press delivered to the app-level key handler, in addition to
/// being dispatched into the surface's Freya tree.
#[derive(Clone, Debug)]
pub struct KeyPress {
    pub key: keyboard_types::Key,
    pub code: keyboard_types::Code,
    pub modifiers: keyboard_types::Modifiers,
    /// True when this press is a host-generated key repeat.
    pub repeat: bool,
    /// Which surface currently holds keyboard focus.
    pub surface: SurfaceId,
}

impl KeyPress {
    /// True when this press is the Escape key, regardless of keyboard layout.
    /// Lets shells act on Escape without depending on `keyboard-types` directly.
    pub fn is_escape(&self) -> bool {
        self.key == keyboard_types::Key::Named(keyboard_types::NamedKey::Escape)
    }
}
