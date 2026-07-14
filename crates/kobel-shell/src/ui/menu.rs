//! THE shared context-menu component + the popup-request plumbing every menu
//! rides on (tray DBusMenus, the dock's right-click menu).
//!
//! A menu is rendered inside an xdg popup surface (host-owned; see
//! crates/kobel-wayland `Control::open_popup`). UI components never touch the host
//! directly: they consume a [`PopupHost`] root context and call
//! [`PopupHost::open`], which enqueues a [`PopupOp`] the app tick (main.rs) drains
//! on the loop thread -- the one place that owns `Control` and can mint/tear down
//! popup surfaces. This mirrors the `ShellBus` split (UI enqueues, the loop
//! applies) and the proven flow in crates/kobel-wayland/examples/popup.rs.
//!
//! The visual body ports the AGS `.cmenu`/`.cmi`/`.csep`/`.danger` rules: a PANEL2
//! sheet of rows, 1px CHIP separators, hover lifts a row to CHIP, danger rows read
//! ROSE. A row is one of:
//!   - standard: a label + an optional check/radio glyph (reflecting a
//!     [`kobel_services::TrayToggle`]); pressing fires its action then closes the
//!     whole menu.
//!   - separator: a 1px CHIP divider.
//!   - submenu: a label + a chevron; hovering (after a short delay) or pressing
//!     opens a NESTED popup parented to THIS popup, so sibling submenus resolve
//!     against the correct parent.
//!
//! Every color/size comes from [`crate::theme`]. The action a standard row fires
//! is a plain [`EventHandler`] the CALLER builds (bar.rs / dock.rs), so this module
//! stays free of tray/dock semantics.

use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

use async_io::Timer;
use freya_core::prelude::*;
use kobel_wayland::{PopupAnchor, PopupGravity, SurfaceId};
use torin::prelude::{Alignment, Size};

use super::chip::{HoverExt, use_hover};
use super::{ICON_CHECK, ICON_CHEVRON_RIGHT, icon};
use crate::theme;

// ---------------------------------------------------------------------------
// Row metrics (ags .cmenu/.cmi/.csep). Fixed so the popup can be Exact-sized
// deterministically (no reposition round-trip) and submenu anchors are exact.
// ---------------------------------------------------------------------------

/// Popup width (px). Wide enough for a label plus the check/chevron gutters.
pub const MENU_W: f32 = 236.0;
/// Standard/submenu row height (px).
const ITEM_H: f32 = 30.0;
/// Separator row height (px): a 1px line with vertical breathing room.
const SEP_H: f32 = 9.0;
/// Vertical padding at the sheet's top and bottom (px).
const PAD_V: f32 = 6.0;
/// Horizontal inset for a row's content (px).
const PAD_H: f32 = 10.0;
/// Leading glyph gutter width (check/radio slot), so labels align (px).
const GUTTER: f32 = 20.0;
/// Hover-open delay for a submenu (ms), matching typical menu UX.
const SUBMENU_DELAY_MS: u64 = 180;

// ---------------------------------------------------------------------------
// Menu model (plain data + a per-row action callback)
// ---------------------------------------------------------------------------

/// A rendered context menu: an ordered list of rows.
#[derive(Clone, PartialEq)]
pub struct MenuModel {
    pub rows: Vec<MenuRow>,
}

impl MenuModel {
    pub fn new(rows: Vec<MenuRow>) -> Self {
        Self { rows }
    }

    /// The Exact popup height for this model (px, rounded up): the sheet's padding
    /// plus each row's fixed height. Used by main.rs so a menu popup is sized
    /// deterministically without a content-measure reposition.
    pub fn measured_height(&self) -> u32 {
        let rows: f32 = self
            .rows
            .iter()
            .map(|r| match r {
                MenuRow::Separator => SEP_H,
                _ => ITEM_H,
            })
            .sum();
        (2.0 * PAD_V + rows).ceil() as u32
    }
}

/// The leading glyph on a standard row: reflects a DBusMenu check/radio toggle.
#[derive(Clone, Copy, PartialEq)]
pub enum MenuGlyph {
    /// No leading glyph (the gutter stays empty so labels still align).
    None,
    /// A checkmark shown only when `on`.
    Check(bool),
    /// A radio dot shown only when `on`.
    Radio(bool),
}

/// One menu row.
#[derive(Clone, PartialEq)]
pub enum MenuRow {
    /// A standard, activatable row.
    Item {
        label: String,
        glyph: MenuGlyph,
        enabled: bool,
        /// Destructive styling (ROSE label), e.g. the dock's Quit row.
        danger: bool,
        /// Fired on press; the menu then closes itself.
        on_activate: EventHandler<()>,
    },
    /// A 1px CHIP divider.
    Separator,
    /// A row that opens a nested submenu popup.
    Submenu {
        label: String,
        enabled: bool,
        model: MenuModel,
    },
}

// ---------------------------------------------------------------------------
// Popup request plumbing (UI -> app tick)
// ---------------------------------------------------------------------------

/// How a popup hangs off its anchor rectangle (mapped to `xdg_positioner`).
#[derive(Clone, Copy)]
pub struct PopupPlacement {
    pub anchor: PopupAnchor,
    pub gravity: PopupGravity,
}

impl PopupPlacement {
    /// Grow downward from the bottom of the anchor (a menu under a bar button).
    pub fn below() -> Self {
        Self {
            anchor: PopupAnchor::Bottom,
            gravity: PopupGravity::Bottom,
        }
    }

    /// Grow upward from the top of the anchor (a menu above a dock tile).
    pub fn above() -> Self {
        Self {
            anchor: PopupAnchor::Top,
            gravity: PopupGravity::Top,
        }
    }

    /// Grow to the right of the anchor (a submenu flyout).
    pub fn rightward() -> Self {
        Self {
            anchor: PopupAnchor::TopRight,
            gravity: PopupGravity::BottomRight,
        }
    }
}

/// A popup lifecycle request the app tick drains and applies via `Control`.
pub enum PopupOp {
    /// Open a menu popup parented to `parent`, anchored at `anchor_rect`
    /// (parent-surface-local logical px), placed per `placement`, rendering `model`.
    Open {
        parent: SurfaceId,
        anchor_rect: (i32, i32, i32, i32),
        placement: PopupPlacement,
        model: MenuModel,
    },
    /// Close every open popup (menu item activation, Esc, or a panel CloseAll).
    CloseAll,
}

/// The shared, single-threaded popup command queue plus the loop waker. Created
/// once in main.rs; the app tick drains it on the loop thread (which owns
/// `Control`). Single-threaded (`RefCell`), like the rest of the UI thread.
pub struct PopupInner {
    queue: std::cell::RefCell<Vec<PopupOp>>,
    wake: Box<dyn Fn()>,
}

impl PopupInner {
    pub fn new(wake: Box<dyn Fn()>) -> Self {
        Self {
            queue: std::cell::RefCell::new(Vec::new()),
            wake,
        }
    }

    fn push(&self, op: PopupOp) {
        self.queue.borrow_mut().push(op);
        (self.wake)();
    }

    /// Enqueue a close-all request (used by the manager's CloseAll hook).
    pub fn request_close_all(&self) {
        self.push(PopupOp::CloseAll);
    }

    /// Take every pending op (called by the app tick).
    pub fn drain(&self) -> Vec<PopupOp> {
        self.queue.borrow_mut().drain(..).collect()
    }
}

/// The per-surface popup handle provided as a root context. `owner` is the surface
/// a popup opened from here parents to; it is filled AFTER the surface is created
/// (its id is only known then), so `open` no-ops until then. For a chrome surface
/// (bar/dock) `owner` is that surface; for a popup body it is the popup itself, so
/// a submenu parents to the correct popup rather than "whatever is deepest".
#[derive(Clone)]
pub struct PopupHost {
    inner: Rc<PopupInner>,
    owner: Rc<Cell<Option<SurfaceId>>>,
}

impl PopupHost {
    pub fn new(inner: Rc<PopupInner>, owner: Rc<Cell<Option<SurfaceId>>>) -> Self {
        Self { inner, owner }
    }

    /// Request a menu popup anchored at `anchor_rect` (this surface's local px).
    pub fn open(&self, anchor_rect: (i32, i32, i32, i32), placement: PopupPlacement, model: MenuModel) {
        let Some(parent) = self.owner.get() else {
            tracing::warn!("[menu] open ignored: owner surface not resolved yet");
            return;
        };
        self.inner.push(PopupOp::Open {
            parent,
            anchor_rect,
            placement,
            model,
        });
    }

    /// Request that every open popup be dismissed.
    pub fn close_all(&self) {
        self.inner.request_close_all();
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// The menu popup body for `model`: a PANEL2 sheet of rows. Consumes the popup's
/// [`PopupHost`] (submenu open + self close) from its root context.
pub fn menu(model: MenuModel) -> impl IntoElement {
    Menu { model }
}

#[derive(PartialEq)]
struct Menu {
    model: MenuModel,
}

impl Component for Menu {
    fn render(&self) -> impl IntoElement {
        let mut children: Vec<Element> = Vec::with_capacity(self.model.rows.len());
        // Track each row's top offset so a submenu row can anchor its flyout at its
        // own laid-out position (deterministic from the fixed row metrics).
        let mut y = PAD_V;
        for row in &self.model.rows {
            match row {
                MenuRow::Separator => {
                    children.push(separator());
                    y += SEP_H;
                }
                MenuRow::Item {
                    label,
                    glyph,
                    enabled,
                    danger,
                    on_activate,
                } => {
                    children.push(
                        MenuItem {
                            label: label.clone(),
                            glyph: *glyph,
                            enabled: *enabled,
                            danger: *danger,
                            on_activate: on_activate.clone(),
                        }
                        .into_element(),
                    );
                    y += ITEM_H;
                }
                MenuRow::Submenu { label, enabled, model } => {
                    children.push(
                        SubmenuItem {
                            label: label.clone(),
                            enabled: *enabled,
                            model: model.clone(),
                            y_top: y,
                        }
                        .into_element(),
                    );
                    y += ITEM_H;
                }
            }
        }

        rect()
            .width(Size::fill())
            .background(theme::PANEL2.rgb())
            .corner_radius(theme::RADIUS_ROW)
            .padding((PAD_V, 0.0))
            .children(children)
    }
}

/// A 1px CHIP divider row (ags `.csep`).
fn separator() -> Element {
    rect()
        .width(Size::fill())
        .height(Size::px(SEP_H))
        .center()
        .padding((0.0, PAD_H))
        .child(
            rect()
                .width(Size::fill())
                .height(Size::px(1.0))
                .background(theme::CHIP.rgb()),
        )
        .into_element()
}

/// The leading check/radio gutter for a standard row.
fn glyph_slot(glyph: MenuGlyph, tint: theme::Rgb) -> Element {
    let inner: Option<Element> = match glyph {
        MenuGlyph::None => None,
        MenuGlyph::Check(on) => on.then(|| icon(ICON_CHECK, 14.0, tint).into_element()),
        MenuGlyph::Radio(on) => on.then(|| {
            rect()
                .width(Size::px(7.0))
                .height(Size::px(7.0))
                .corner_radius(theme::RADIUS_PILL)
                .background(tint.rgb())
                .into_element()
        }),
    };
    rect()
        .width(Size::px(GUTTER))
        .height(Size::px(ITEM_H))
        .center()
        .maybe_child(inner)
        .into_element()
}

/// A standard, activatable menu row. Its own component so hover state is isolated.
#[derive(PartialEq)]
struct MenuItem {
    label: String,
    glyph: MenuGlyph,
    enabled: bool,
    danger: bool,
    on_activate: EventHandler<()>,
}

impl Component for MenuItem {
    fn render(&self) -> impl IntoElement {
        let popup = use_consume::<PopupHost>();
        let hover = use_hover();
        let on = hover.on();

        let label_color = if !self.enabled {
            theme::DIM
        } else if self.danger {
            theme::ROSE
        } else {
            theme::TX
        };
        // Hover lifts to CHIP; a disabled row never highlights.
        let bg: Color = if on && self.enabled {
            theme::CHIP.rgb().into()
        } else {
            Color::TRANSPARENT
        };

        let on_activate = self.on_activate.clone();
        let enabled = self.enabled;

        let mut row = rect()
            .width(Size::fill())
            .height(Size::px(ITEM_H))
            .horizontal()
            .cross_align(Alignment::Center)
            .corner_radius(theme::RADIUS_BUTTON)
            .background(bg)
            .hover(hover)
            .child(glyph_slot(self.glyph, label_color))
            .child(
                rect().width(Size::fill()).padding((0.0, 2.0)).child(
                    label()
                        .text(self.label.clone())
                        .color(label_color.rgb())
                        .font_size(13.0),
                ),
            )
            .child(rect().width(Size::px(PAD_H)));

        if enabled {
            row = row.on_press(move |_| {
                on_activate.call(());
                popup.close_all();
            });
        }
        row
    }
}

/// A submenu row: a chevron on the right, opening a nested popup on hover (after a
/// short delay) or on press.
#[derive(PartialEq)]
struct SubmenuItem {
    label: String,
    enabled: bool,
    model: MenuModel,
    /// This row's top offset inside the popup (px), for the flyout anchor.
    y_top: f32,
}

impl Component for SubmenuItem {
    fn render(&self) -> impl IntoElement {
        let popup = use_consume::<PopupHost>();
        let hover = use_hover();
        let on = hover.on();
        // Opened-once guard so a hover that lingers does not stack duplicate flyouts.
        let opened = use_state(|| false);

        let label_color = if self.enabled { theme::TX } else { theme::DIM };
        let bg: Color = if on && self.enabled {
            theme::CHIP.rgb().into()
        } else {
            Color::TRANSPARENT
        };

        // The flyout anchors on this row's rect (popup-local), growing rightward.
        let anchor = (0, self.y_top as i32, MENU_W as i32, ITEM_H as i32);
        let model = self.model.clone();
        let enabled = self.enabled;

        let open_submenu = {
            let popup = popup.clone();
            let model = model.clone();
            move |mut opened: State<bool>| {
                if *opened.read() {
                    return;
                }
                opened.set(true);
                popup.open(anchor, PopupPlacement::rightward(), model.clone());
            }
        };

        let hover_open = open_submenu.clone();
        let press_open = open_submenu;

        let mut row = rect()
            .width(Size::fill())
            .height(Size::px(ITEM_H))
            .horizontal()
            .cross_align(Alignment::Center)
            .corner_radius(theme::RADIUS_BUTTON)
            .background(bg)
            .hover(hover)
            .child(glyph_slot(MenuGlyph::None, label_color))
            .child(
                rect().width(Size::fill()).padding((0.0, 2.0)).child(
                    label()
                        .text(self.label.clone())
                        .color(label_color.rgb())
                        .font_size(13.0),
                ),
            )
            .child(
                rect()
                    .width(Size::px(PAD_H + 8.0))
                    .center()
                    .child(icon(ICON_CHEVRON_RIGHT, 12.0, theme::MUT)),
            );

        if enabled {
            row = row
                .on_pointer_enter(move |_| {
                    // Open after a short delay if still un-opened (hover-open UX).
                    let hover_open = hover_open.clone();
                    let platform = Platform::get();
                    spawn(async move {
                        Timer::after(Duration::from_millis(SUBMENU_DELAY_MS)).await;
                        hover_open(opened);
                        platform.send(UserEvent::RequestRedraw);
                    });
                })
                .on_press(move |_| press_open(opened));
        }
        row
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(label: &str) -> MenuRow {
        MenuRow::Item {
            label: label.to_string(),
            glyph: MenuGlyph::None,
            enabled: true,
            danger: false,
            on_activate: EventHandler::new(move |_: ()| {}),
        }
    }

    fn submenu(label: &str) -> MenuRow {
        MenuRow::Submenu {
            label: label.to_string(),
            enabled: true,
            model: MenuModel::new(vec![item("nested")]),
        }
    }

    /// An empty menu is still padding-only, never a zero/negative-height popup.
    #[test]
    fn empty_model_is_just_the_vertical_padding() {
        assert_eq!(MenuModel::new(vec![]).measured_height(), (2.0 * PAD_V).ceil() as u32);
    }

    /// Items and submenu rows count identically (both are one ITEM_H row); a
    /// submenu row's own nested model does NOT recurse into the parent's height.
    #[test]
    fn items_and_submenus_each_count_one_item_height() {
        let model = MenuModel::new(vec![item("a"), submenu("b"), item("c")]);
        let expected = (2.0 * PAD_V + 3.0 * ITEM_H).ceil() as u32;
        assert_eq!(model.measured_height(), expected);
    }

    /// Separators use their own, shorter fixed height, not ITEM_H.
    #[test]
    fn separators_use_the_shorter_row_height() {
        let model = MenuModel::new(vec![MenuRow::Separator, MenuRow::Separator]);
        let expected = (2.0 * PAD_V + 2.0 * SEP_H).ceil() as u32;
        assert_eq!(model.measured_height(), expected);
    }

    /// A realistic mixed menu (dock's context menu shape: items, a separator,
    /// a danger item) sums each row's own fixed height plus the sheet padding.
    #[test]
    fn mixed_rows_sum_their_own_fixed_heights() {
        let model = MenuModel::new(vec![item("Open"), item("Unpin"), MenuRow::Separator, item("Quit")]);
        let expected = (2.0 * PAD_V + 3.0 * ITEM_H + SEP_H).ceil() as u32;
        assert_eq!(model.measured_height(), expected);
    }
}
