// kobel-wayland: a Wayland wlr-layer-shell host that embeds Freya without winit.
//
// One process drives N layer surfaces; each owns its own Freya runtime (Runner +
// Tree + fonts + events) and all share a single EGL context and Skia DirectContext.
// Input (pointer/keyboard/scroll) is decoded into freya_core::PlatformEvent, frames
// are scheduled off wl frame callbacks, and animations/tasks are pumped through a
// calloop-integrated runner waker so an idle shell burns zero CPU.
//
// Layout of the crate (see docs/FREYA-PLAN.md sections 2, 3, 7):
//   conn.rs     -- Shell/host entry, sctk registry/compositor/output/seat/layer-shell
//   egl.rs      -- shared EGL display/context + per-surface window surface + Skia GL
//   surface.rs  -- FreyaLayerSurface: the embedded Freya runtime + frame pipeline
//   input.rs    -- sctk pointer/keyboard -> PlatformEvent (pure, unit-tested)
//   frame.rs    -- runner waker (calloop ping) + frame-time clock
//   toplevel.rs -- zwlr_foreign_toplevel_manager_v1 snapshot type + state decode
//                  (pure, unit-tested; the Dispatch glue lives in conn.rs with
//                  every other raw protocol since Host is private to that module)
//   ime.rs      -- zwp_text_input_v3 (IME preedit/commit) snapshot types + cursor
//                  decode (pure, unit-tested; Dispatch glue lives in conn.rs)

mod conn;
mod egl;
mod frame;
mod ime;
mod input;
mod surface;
mod toplevel;

pub use conn::{Control, OutputControl, Shell};
pub use ime::{ImeCommit, ImeEvent, Preedit};
pub use surface::SurfaceContexts;
pub use toplevel::ToplevelInfo;

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

/// Opaque, stable identifier for a connected output (`wl_output`). Derived from the
/// output's protocol object id, so it stays stable for the output's lifetime and two
/// handles to the same output compare equal. Minted by the host; [`OutputId::new`]
/// exists so callers can build and unit-test per-output registries without a live
/// compositor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct OutputId(pub(crate) u32);

impl OutputId {
    /// Construct an output id from its raw value (the wl_output protocol object id).
    /// Real ids are minted by the host; this exists for unit tests.
    pub const fn new(raw: u32) -> Self {
        Self(raw)
    }

    /// The raw wl_output protocol object id.
    pub const fn raw(self) -> u32 {
        self.0
    }
}

/// An output lifecycle event delivered to the handler installed with
/// [`Shell::on_output`]. The host fires [`OutputEvent::Added`] for every output --
/// those present at startup AND those hotplugged at runtime -- so the app has one
/// mount path; [`OutputEvent::SurfaceClosed`] when the compositor retires a single
/// surface (its output may stay live); and [`OutputEvent::Removed`] once an output
/// goes away.
#[derive(Clone, Debug)]
pub enum OutputEvent {
    /// An output became available (present at startup or hotplugged). Mount the
    /// per-output surfaces for it via [`OutputControl::create_on`].
    Added(OutputId),
    /// The compositor closed exactly ONE surface (wlr-layer-shell `closed`). Per the
    /// protocol this retires a single surface and does NOT imply its output died --
    /// the compositor MAY close a surface while the output stays live, so mutter's
    /// close-before-global ordering is never load-bearing. The host has already
    /// dropped that surface (its safe Drop order) and fixed keyboard focus; the app
    /// must drop just that surface's bookkeeping (its fan-out State, keyfeed, toast
    /// registration) WITHOUT dropping the whole output bundle. `output` identifies the
    /// surface's bound output (`None` for a compositor-placed surface) -- identity, not
    /// a liveness guarantee; use [`OutputControl::remaining`] for the outputs live at
    /// handler time. A closed singleton should be recreated on the primary output (see
    /// the shell's handler).
    SurfaceClosed {
        /// The output the closed surface was bound to (`None` if output-less).
        output: Option<OutputId>,
        /// The surface the compositor retired.
        surface: SurfaceId,
    },
    /// An output was removed. The host has torn down every surface STILL bound to it
    /// (each via its safe Drop order); `retired` lists their ids. Surfaces the
    /// compositor pre-closed individually were already delivered via
    /// [`OutputEvent::SurfaceClosed`] and are NOT repeated here, so `retired` is the
    /// REMAINING set (possibly empty) -- the app drops the whole output bundle
    /// regardless. If any retired surface was a singleton bound to this output,
    /// rebind it to a surviving output (see [`OutputControl::remaining`]).
    Removed {
        /// The output that went away.
        output: OutputId,
        /// The ids of the surfaces still bound to the output at removal (the ones not
        /// already retired via [`OutputEvent::SurfaceClosed`]).
        retired: Vec<SurfaceId>,
    },
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
    /// Content-sized: the surface keeps a fixed logical `width` and sizes its height
    /// to its Freya content, bounded by `max_height` (the measurement viewport and
    /// the clamp ceiling). The host measures the tree at `(width, max_height)` after
    /// each layout-dirty frame, reads the root content height, and requests a new
    /// surface size only when it changed; it keeps rendering into the currently
    /// configured buffer until the compositor's next configure honours the request.
    ContentSized { width: u32, max_height: u32 },
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
    /// When true, this surface's `ClipboardProvider` root context is a real
    /// Wayland clipboard (smithay-clipboard via `freya_clipboard::copypasta`,
    /// constructed from the host's own `wl_display`) instead of the default
    /// `None` stub. Opt-in per surface (`false` by default) since only surfaces
    /// with an actual text field need one -- the launcher's is the only one today.
    pub clipboard: bool,
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
            clipboard: false,
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

    pub fn clipboard(mut self, enabled: bool) -> Self {
        self.clipboard = enabled;
        self
    }
}

/// Where a popup attaches on its parent's anchor rectangle, and which way it grows.
/// A menu below a bar/dock button is the common case: anchor the popup's edge to the
/// BOTTOM of the anchor rect and grow with BOTTOM gravity (downward). The host maps
/// these to `xdg_positioner` anchor/gravity; the compositor keeps the popup on-screen
/// via slide+flip constraint adjustment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PopupAnchor {
    Top,
    Bottom,
    Left,
    Right,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

/// The direction a popup expands away from its anchor point (its `xdg_positioner`
/// gravity).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PopupGravity {
    Top,
    Bottom,
    Left,
    Right,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Configuration for one xdg popup surface (a tray/context menu, tooltip, ...).
///
/// A popup is parented to another surface (a layer surface, or another popup for a
/// submenu) and positioned by an `xdg_positioner`: the `anchor_rect` is a rectangle
/// in the PARENT's surface-local logical coordinates (e.g. the button that opened the
/// menu), and `anchor`/`gravity` say how the popup hangs off it. The compositor is
/// free to slide/flip the popup to keep it on-screen. Its own size is chosen exactly
/// like a layer surface (`SurfaceSize::Exact` or `ContentSized`).
#[derive(Clone, Debug)]
pub struct PopupConfig {
    /// A diagnostic namespace (`kobel-*`), mirrored into tracing logs.
    pub namespace: String,
    /// Anchor rectangle in the parent's surface-local logical pixels (x, y, w, h).
    pub anchor_rect: (i32, i32, i32, i32),
    /// Popup size behaviour.
    pub size: SurfaceSize,
    /// Which point of the anchor rectangle the popup attaches to.
    pub anchor: PopupAnchor,
    /// Which direction the popup grows from that point.
    pub gravity: PopupGravity,
}

impl PopupConfig {
    /// A menu-below-a-button default: anchored to the bottom edge of `anchor_rect`,
    /// growing downward (bottom gravity). Override with [`PopupConfig::anchor`] /
    /// [`PopupConfig::gravity`].
    pub fn new(
        namespace: impl Into<String>,
        anchor_rect: (i32, i32, i32, i32),
        size: SurfaceSize,
    ) -> Self {
        Self {
            namespace: namespace.into(),
            anchor_rect,
            size,
            anchor: PopupAnchor::Bottom,
            gravity: PopupGravity::Bottom,
        }
    }

    pub fn anchor(mut self, anchor: PopupAnchor) -> Self {
        self.anchor = anchor;
        self
    }

    pub fn gravity(mut self, gravity: PopupGravity) -> Self {
        self.gravity = gravity;
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
    /// Effective scale factor in effect (fractional under wp_fractional_scale_v1,
    /// otherwise the integer wl buffer scale).
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
