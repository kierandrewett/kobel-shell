//! THE shared chip/tile primitives (docs/FREYA-PLAN.md section 6 "Shared
//! pieces"). This codebase kept re-inlining hover-lit tiles; this module is the
//! reusable home for the ones quick-settings needs:
//!
//!   - [`use_hover`] / [`Hover`] / [`HoverExt`] -- the one-liner hover-state
//!     boilerplate every interactive tile repeats (a `State<bool>` + the two
//!     pointer-enter/leave setters), factored so a chip/slider/button just reads
//!     `.on()` and attaches `.hover(h)`.
//!   - [`hover_button`] -- THE hover-lit `rect()` shell (square or row via
//!     [`HoverShape`], background pick, hover wiring, press target; every
//!     size/padding/radius stays the caller's own) used by bar.rs's clock/
//!     status-pill/tray buttons and this crate's `IconButton`.
//!   - [`Chip`] -- the quick-settings pill chip (ags `.chip`): PANEL2 pill,
//!     radius pill, min-height `tile_h`, icon + label + optional sublabel; active
//!     fills LEAF with INK text; hover lifts to CHIP (LEAF2 when active); an
//!     optional chevron sub-button opens a drill.
//!   - [`IconAction`] -- a hover-lit square icon button firing an
//!     [`EventHandler`] (the QS top-row reload/lock/power buttons, the drill
//!     back button).
//!   - [`KSwitch`] -- the 46x26 pill switch (LEAF on / CHIP off) for drill
//!     headers.
//!   - [`KSlider`] -- the custom slider (6px CHIP rail, 17px knob, LEAF fill):
//!     pointer-down drag maps the pointer to a 0..1 value; no stock component so
//!     the geometry is exactly the prototype's, not a GTK measurement lie.
//!
//! Colors/sizes come from [`crate::theme`]; nothing here reads a service. Callers
//! pass plain data + [`EventHandler`]s (the idiomatic Freya component-callback
//! type, as `freya-components::Slider` does), so these stay design primitives
//! decoupled from quick-settings semantics.
//!
//! bar.rs's ClockButton/StatusPill/TrayButton and the shell's `IconButton`
//! (ui/mod.rs) now build on [`hover_button`] -- their hover state, background
//! pick, and press wiring were identical, just with different sizes/colors
//! per site. FocusedTitle (a plain label, no hover) and BellButton (a
//! non-interactive absolute-badge wrapper around `IconButton`) hand-roll
//! nothing and were left alone. Dock tile shells stay out of scope here too.

use freya_core::prelude::*;
use torin::prelude::{Alignment, Area, Content, Size};

use super::icon;
use crate::theme::{self, Rgb};

// -------------------------------------------------------------------------
// Hover shell
// -------------------------------------------------------------------------

/// Pointer-hover state for an interactive shell. Wraps the `State<bool>` every
/// hover-lit tile in the shell would otherwise re-declare. `Copy` so it drops
/// into event closures freely.
#[derive(Clone, Copy, PartialEq)]
pub struct Hover(State<bool>);

/// Track hover in the current component scope. Read [`Hover::on`] for the state
/// and attach [`HoverExt::hover`] to the rect that should own the enter/leave.
pub fn use_hover() -> Hover {
    Hover(use_state(|| false))
}

impl Hover {
    /// Current hover state (subscribes the caller so the tile re-renders on
    /// enter/leave).
    pub fn on(self) -> bool {
        *self.0.read()
    }

    /// Pick between a resting and a hovered value in one call.
    pub fn pick<T>(self, rest: T, over: T) -> T {
        if self.on() { over } else { rest }
    }
}

/// Attach a [`Hover`]'s pointer-enter/leave handlers to a rect. The one place
/// the enter=true / leave=false setter pair is written for the whole shell.
pub trait HoverExt: Sized {
    fn hover(self, hover: Hover) -> Self;
}

impl HoverExt for Rect {
    fn hover(self, hover: Hover) -> Self {
        let mut enter = hover.0;
        let mut leave = hover.0;
        self.on_pointer_enter(move |_| enter.set(true))
            .on_pointer_leave(move |_| leave.set(false))
    }
}

/// Layout shape for [`hover_button`]'s shell: a centered square (icon
/// buttons, tray items) or a horizontal row (clock button, status pill).
/// Every dimension is the caller's own exact number -- no shared defaults.
pub enum HoverShape {
    Square { side: f32 },
    Row { min_height: f32, padding: (f32, f32), spacing: f32 },
}

/// THE hover-lit button shell every bar icon/pill/tile hand-rolls: a fresh
/// `rect()` laid out per [`HoverShape`], with the hover-picked background,
/// [`Hover`] pointer wiring, and the press target already wired. Callers
/// chain their own extras (overflow clip, secondary mouse handlers) and
/// children; every size/padding/radius/color stays the caller's exact
/// number -- only the layout-shape branch, background pick, and hover/press
/// plumbing are shared.
pub fn hover_button(
    hover: Hover,
    shape: HoverShape,
    radius: f32,
    rest_bg: Color,
    hover_bg: Color,
    on_press: impl Into<EventHandler<Event<PressEventData>>>,
) -> Rect {
    let shell = match shape {
        HoverShape::Square { side } => {
            rect().width(Size::px(side)).height(Size::px(side)).center()
        }
        HoverShape::Row { min_height, padding, spacing } => rect()
            .horizontal()
            .min_height(Size::px(min_height))
            .padding(padding)
            .spacing(spacing)
            .cross_align(Alignment::Center),
    };
    shell
        .corner_radius(radius)
        .background(hover.pick(rest_bg, hover_bg))
        .hover(hover)
        .on_press(on_press)
}

// -------------------------------------------------------------------------
// Chip
// -------------------------------------------------------------------------

/// A quick-settings pill chip (ags/style/main.scss `.chip`). One `tile_h`-tall
/// PANEL2 pill: an 18px glyph, a label, and an optional muted sublabel stacked
/// under it. `active` fills LEAF with INK text/glyph (DESIGN.md: solid fill, ink
/// text -- never a tint). Hover lifts an inactive chip to CHIP, an active one to
/// LEAF2. An optional chevron sub-button on the right fires [`Chip::on_drill`]
/// to open a drilldown; the whole pill hovers together (matching `.chip:hover`).
#[derive(PartialEq)]
pub struct Chip {
    /// Embedded SVG bytes for the leading glyph (a `super::ICON_*`).
    pub icon: &'static [u8],
    /// The chip's primary label.
    pub label: String,
    /// Optional sublabel (Wi-Fi ssid, BT alias, or "Off").
    pub sub: Option<String>,
    /// Active = the toggle is on: LEAF fill + INK content.
    pub active: bool,
    /// Fired when the main button area is pressed (the toggle).
    pub on_toggle: EventHandler<()>,
    /// Present iff the chip drills: fired by the chevron sub-button.
    pub on_drill: Option<EventHandler<()>>,
}

impl Component for Chip {
    fn render(&self) -> impl IntoElement {
        let tokens = *use_consume::<State<theme::Tokens>>().read();
        let hover = use_hover();
        let active = self.active;

        let bg = if active {
            hover.pick(theme::LEAF, theme::LEAF2)
        } else {
            hover.pick(theme::PANEL2, theme::CHIP)
        };
        let fg = if active { theme::INK } else { theme::TX };
        let sub_fg = if active { theme::INK } else { theme::MUT };

        // Label column: label, plus a sublabel when carried.
        let mut col = rect()
            .vertical()
            .width(Size::flex(1.0))
            .main_align(Alignment::Center)
            .cross_align(Alignment::Start)
            .child(
                label()
                    .text(self.label.clone())
                    .color(fg.rgb())
                    .font_size(theme::FONT_SIZE_BASE)
                    .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                    .max_lines(1usize)
                    .text_overflow(TextOverflow::Ellipsis),
            );
        if let Some(sub) = &self.sub {
            col = col.child(
                label()
                    .text(sub.clone())
                    .color(sub_fg.rgb())
                    .font_size(theme::FONT_SIZE_MIN)
                    .max_lines(1usize)
                    .text_overflow(TextOverflow::Ellipsis),
            );
        }

        let on_toggle = self.on_toggle.clone();
        let main = rect()
            .horizontal()
            .width(Size::flex(1.0))
            .cross_align(Alignment::Center)
            .spacing(9.0)
            .padding((0.0, 13.0))
            .on_press(move |_| on_toggle.call(()))
            .child(icon(self.icon, 18.0, fg))
            .child(col);

        let mut shell = rect()
            .horizontal()
            .content(Content::Flex)
            .min_height(Size::px(tokens.tile_h))
            .corner_radius(theme::RADIUS_PILL)
            .background(bg.rgb())
            .cross_align(Alignment::Center)
            .hover(hover)
            .child(main);

        if let Some(on_drill) = &self.on_drill {
            let on_drill = on_drill.clone();
            let chev = rect()
                .width(Size::px(30.0))
                .height(Size::fill())
                .center()
                .on_press(move |_| on_drill.call(()))
                .child(icon(super::ICON_CHEVRON_RIGHT, 16.0, fg));
            shell = shell.child(chev);
        }

        shell
    }
}

// -------------------------------------------------------------------------
// IconAction
// -------------------------------------------------------------------------

/// A hover-lit square icon button that fires an [`EventHandler`] (unlike
/// [`super::IconButton`], which only toggles a surface). Resting = a `tint`
/// glyph on the [`IconAction::rest_bg`] slab (transparent by default); hover
/// lifts one step up the elevation ladder and swaps the glyph to `hover_tint`.
/// Opt-in [`IconAction::rest_bg`]/[`IconAction::radius`]/[`IconAction::danger`]
/// give the QS top-row `.rbtn` treatment (CHIP pill, ROSE danger hover); the
/// drill back/chevron buttons keep the transparent `RADIUS_BUTTON` defaults.
#[derive(PartialEq)]
pub struct IconAction {
    /// Embedded SVG bytes (a `super::ICON_*`).
    icon: &'static [u8],
    /// Control box edge (square).
    size: f32,
    /// Glyph size inside the box.
    icon_size: f32,
    /// Resting glyph tint.
    tint: Rgb,
    /// Glyph tint while hovered.
    hover_tint: Rgb,
    /// Fired on press.
    on_press: EventHandler<()>,
    /// Resting background fill (default `Color::TRANSPARENT`).
    rest_bg: Color,
    /// Corner radius (default `theme::RADIUS_BUTTON`).
    radius: f32,
    /// Destructive treatment: hover fills ROSE with a ROSEINK glyph.
    danger: bool,
}

impl IconAction {
    /// A square icon button: an `icon_size` glyph in a `size` box, resting
    /// `tint` -> hovered `hover_tint`, pressing fires `on_press`. Defaults to a
    /// transparent slab, `RADIUS_BUTTON` corners, and non-danger; the setters
    /// below opt into the `.rbtn` treatment.
    pub fn new(
        icon: &'static [u8],
        size: f32,
        icon_size: f32,
        tint: Rgb,
        hover_tint: Rgb,
        on_press: impl Into<EventHandler<()>>,
    ) -> Self {
        Self {
            icon,
            size,
            icon_size,
            tint,
            hover_tint,
            on_press: on_press.into(),
            rest_bg: Color::TRANSPARENT,
            radius: theme::RADIUS_BUTTON,
            danger: false,
        }
    }

    /// Set the resting background fill (default transparent).
    pub fn rest_bg(mut self, rest_bg: Rgb) -> Self {
        self.rest_bg = rest_bg.rgb().into();
        self
    }

    /// Set the corner radius (default `theme::RADIUS_BUTTON`).
    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = radius;
        self
    }

    /// Enable the destructive treatment: hover fills ROSE with a ROSEINK glyph
    /// (scss `.rbtn.danger:hover`, main.scss:351-354).
    pub fn danger(mut self, danger: bool) -> Self {
        self.danger = danger;
        self
    }
}

impl Component for IconAction {
    fn render(&self) -> impl IntoElement {
        let hover = use_hover();
        let on = hover.on();

        // Hover lifts one step up the elevation ladder: transparent -> PANEL2
        // (drill back/chevron), CHIP -> HOVER (QS top-row `.rbtn:hover`,
        // main.scss:347-350). Danger overrides to ROSE bg + ROSEINK glyph
        // (`.rbtn.danger:hover`, main.scss:351-354).
        let chip: Color = theme::CHIP.rgb().into();
        let bg: Color = if on {
            if self.danger {
                theme::ROSE.rgb().into()
            } else if self.rest_bg == chip {
                theme::HOVER.rgb().into()
            } else {
                theme::PANEL2.rgb().into()
            }
        } else {
            self.rest_bg
        };
        let tint = if on {
            if self.danger { theme::ROSEINK } else { self.hover_tint }
        } else {
            self.tint
        };
        let on_press = self.on_press.clone();

        rect()
            .width(Size::px(self.size))
            .height(Size::px(self.size))
            .center()
            .corner_radius(self.radius)
            .background(bg)
            .hover(hover)
            .on_press(move |_| on_press.call(()))
            .child(icon(self.icon, self.icon_size, tint))
    }
}

// -------------------------------------------------------------------------
// KSwitch
// -------------------------------------------------------------------------

/// The 46x26 pill switch (ags drill-header switch). LEAF track + INK knob when
/// on, CHIP track + TX knob when off; the 20px knob slides to the active end.
/// A custom component (not `freya-components::Switch`) so the fill reads LEAF/INK
/// with no theming DSL.
#[derive(PartialEq)]
pub struct KSwitch {
    /// Current toggle state.
    pub on: bool,
    /// Fired on press.
    pub on_toggle: EventHandler<()>,
}

impl Component for KSwitch {
    fn render(&self) -> impl IntoElement {
        let track = if self.on { theme::LEAF } else { theme::CHIP };
        let knob = if self.on { theme::INK } else { theme::TX };
        let align = if self.on { Alignment::End } else { Alignment::Start };
        let on_toggle = self.on_toggle.clone();

        rect()
            .width(Size::px(46.0))
            .height(Size::px(26.0))
            .corner_radius(theme::RADIUS_PILL)
            .background(track.rgb())
            .padding((0.0, 3.0))
            .horizontal()
            .cross_align(Alignment::Center)
            .main_align(align)
            .on_press(move |_| on_toggle.call(()))
            .child(
                rect()
                    .width(Size::px(20.0))
                    .height(Size::px(20.0))
                    .corner_radius(theme::RADIUS_PILL)
                    .background(knob.rgb()),
            )
    }
}

// -------------------------------------------------------------------------
// KSlider
// -------------------------------------------------------------------------

/// Default rail height / knob edge (ags: 6px rail, 17px knob).
const RAIL: f32 = 6.0;
const KNOB: f32 = 17.0;
/// Compact rail/knob for the per-app mixer rows.
const RAIL_MINI: f32 = 4.0;
const KNOB_MINI: f32 = 12.0;

/// Map a pointer x (relative to the slider's left edge) plus the slider's total
/// width to a 0..1 value. The usable travel is `width - knob`; the pointer maps
/// from the left knob-centre to the right knob-centre, so the reported value and
/// the rendered knob position agree. Pure so it is unit-tested.
fn slider_pct(x: f64, width: f64, knob: f64) -> f64 {
    let usable = (width - knob).max(1.0);
    ((x - knob / 2.0) / usable).clamp(0.0, 1.0)
}

/// A custom slider: a full-width CHIP rail with a LEAF fill and a round knob that
/// rides the fill's end. Pointer-down (and drag past the element via global
/// move) sets a 0..1 value through [`KSlider::on_change`]. The rail/knob sizes
/// are the prototype's exact 6px/17px (or the compact mixer sizes).
#[derive(PartialEq)]
pub struct KSlider {
    /// Current value, 0..1.
    pub value: f64,
    /// Fired with the new 0..1 value while dragging.
    pub on_change: EventHandler<f64>,
    /// Rail height.
    pub rail: f32,
    /// Knob edge.
    pub knob: f32,
}

impl KSlider {
    /// Full-size slider (volume/brightness rows).
    pub fn new(value: f64, on_change: impl Into<EventHandler<f64>>) -> Self {
        Self { value, on_change: on_change.into(), rail: RAIL, knob: KNOB }
    }

    /// Compact slider (mixer rows).
    pub fn compact(value: f64, on_change: impl Into<EventHandler<f64>>) -> Self {
        Self { value, on_change: on_change.into(), rail: RAIL_MINI, knob: KNOB_MINI }
    }
}

impl Component for KSlider {
    fn render(&self) -> impl IntoElement {
        let mut size = use_state(Area::default);
        let mut dragging = use_state(|| false);
        let knob = self.knob;
        let rail = self.rail;
        let value = self.value.clamp(0.0, 1.0);

        // Pointer down: begin a drag and jump to the pressed value.
        let on_down = {
            let on_change = self.on_change.clone();
            move |e: Event<PointerEventData>| {
                if !e.data().is_primary() {
                    return;
                }
                e.stop_propagation();
                dragging.set(true);
                let c = e.element_location();
                let w = size.read().width() as f64;
                on_change.call(slider_pct(c.x, w, knob as f64));
            }
        };

        // Global move: keep tracking while dragging even past the element bounds.
        let on_move = {
            let on_change = self.on_change.clone();
            move |e: Event<PointerEventData>| {
                if !*dragging.peek() {
                    return;
                }
                e.stop_propagation();
                let g = e.global_location();
                let area = size.read();
                let x = g.x - area.min_x() as f64;
                on_change.call(slider_pct(x, area.width() as f64, knob as f64));
            }
        };

        let on_up = move |_: Event<PointerEventData>| dragging.set(false);

        // Fill + thumb are siblings inside the CHIP rail (freya's slider shape).
        // The LEAF fill takes `value` of the rail travel (percent of the rail's
        // inner width, which is `W - knob` after the root's knob/2 padding); the
        // thumb wrapper takes the rest, and its knob child is offset_x(-knob/2) so
        // the knob centre lands on the fill's end -- i.e. at value*(W - knob) from
        // the rail's left, exactly slider_pct's inverse. offset_y recentres the
        // oversized knob over the thin rail.
        let fill = rect()
            .width(Size::percent((value * 100.0) as f32))
            .height(Size::px(rail))
            .corner_radius(theme::RADIUS_PILL)
            .background(theme::LEAF.rgb());

        let thumb = rect()
            .width(Size::fill())
            .height(Size::px(rail))
            .offset_x(-knob / 2.0)
            .offset_y((rail - knob) / 2.0)
            .child(
                rect()
                    .width(Size::px(knob))
                    .height(Size::px(knob))
                    .corner_radius(theme::RADIUS_PILL)
                    .background(theme::TX.rgb()),
            );

        let track = rect()
            .width(Size::fill())
            .height(Size::px(rail))
            .corner_radius(theme::RADIUS_PILL)
            .background(theme::CHIP.rgb())
            .horizontal()
            .main_align(Alignment::Start)
            .child(fill)
            .child(thumb);

        rect()
            .width(Size::fill())
            .height(Size::px(knob))
            .padding((0.0, knob / 2.0))
            .horizontal()
            .cross_align(Alignment::Center)
            .on_sized(move |e: Event<SizedEventData>| size.set(e.area))
            .on_pointer_down(on_down)
            .on_global_pointer_move(on_move)
            .on_global_pointer_press(on_up)
            .child(track)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slider_pct_maps_endpoints_and_midpoint() {
        // width 100, knob 20 -> usable 80, left knob-centre at x=10, right at x=90.
        assert_eq!(slider_pct(10.0, 100.0, 20.0), 0.0);
        assert_eq!(slider_pct(90.0, 100.0, 20.0), 1.0);
        assert!((slider_pct(50.0, 100.0, 20.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn slider_pct_clamps_outside_travel() {
        // Left of the knob-centre and right of it saturate, never past 0..1.
        assert_eq!(slider_pct(0.0, 100.0, 20.0), 0.0);
        assert_eq!(slider_pct(1000.0, 100.0, 20.0), 1.0);
    }

    #[test]
    fn slider_pct_survives_degenerate_width() {
        // A zero/negative usable width must not divide by zero or NaN.
        let v = slider_pct(5.0, 10.0, 20.0);
        assert!((0.0..=1.0).contains(&v));
    }
}
