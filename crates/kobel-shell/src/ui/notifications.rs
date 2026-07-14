//! Notifications: floating translucent toasts (top-right) + the right drawer
//! (media card, header, scrollable history). Ports ags/widget/Notifications.tsx.
//!
//! Two surfaces live here:
//!   - [`toasts`]: a per-output overlay showing up to three of the newest LIVE
//!     notifications. A notification is live for [`TOAST_MS`] after arrival
//!     (critical ones are sticky); toasts are suppressed entirely while
//!     do-not-disturb is set or the drawer is open (the drawer "adopts" them).
//!     Enter uses the [`motion::TOAST_IN`] spring (slide-in from the right +
//!     fade), exit uses [`motion::TOAST_OUT`] -- the springs the AGS port never
//!     wired. Per-id springs live in each [`ToastCard`], like the dock's `Dot`.
//!   - [`drawer`]: the singleton right rail: a media card, a header
//!     (title/count/DND/Clear), then a scrollable newest-first history of cards.
//!
//! DESIGN.md v3: the toast panel is the ONE sanctioned translucency
//! (`rgba(16,13,20,0.82)`). Every other size/color comes from [`crate::theme`].

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use async_io::Timer;
use freya_components::image_viewer::ImageViewer;
use freya_components::scrollviews::ScrollView;
use freya_core::prelude::*;
use torin::prelude::{Alignment, Content, Direction, Size};

use kobel_services::{Command, MediaSnapshot, Notification, NotifdSnapshot};

use super::chip::{HoverExt, use_hover};
use super::panels::OpenProgress;
use super::{
    AppIcon, ICON_BELL, ICON_BELL_SLASH, ICON_CHECK, ICON_CLOSE, ICON_DISC, ICON_MUSIC, ICON_PAUSE,
    ICON_PLAY, ICON_SKIP_BACK, ICON_SKIP_FWD, ICON_TRASH, icon,
};
use crate::manager::{ShellBus, ShellMsg};
use crate::motion::{self, use_spring};
use crate::theme;

// ---------------------------------------------------------------------------
// Constants (ags/widget/Notifications.tsx + ags/style/main.scss notifications)
// ---------------------------------------------------------------------------

/// Fixed notification-card width (ags `NCARD_W = 341`); toasts never stretch.
const NCARD_W: f32 = 341.0;
/// Toast column width: the card plus a little shadow headroom.
const TOAST_COL_W: f32 = NCARD_W + 24.0;
/// Toasts surface size (per-output overlay). Wide enough for a card + its shadow,
/// tall enough to stack [`MAX_TOASTS`] cards; the host uses these as the Exact
/// surface size (the phase-1 host has no content sizing).
pub const TOASTS_SURFACE_W: u32 = 392;
pub const TOASTS_SURFACE_H: u32 = 320;

/// How long (ms) a notification shows as a toast after arrival (ags `TOAST_MS`).
pub(crate) const TOAST_MS: u64 = 3800;
/// The exit-animation tail (ms) a toast stays mounted after its live window ends,
/// so the [`motion::TOAST_OUT`] spring can play before the card unmounts.
pub(crate) const TOAST_OUT_MS: u64 = 480;
/// At most this many LIVE toasts render at once (newest first).
pub(crate) const MAX_TOASTS: usize = 3;
/// Enter/exit horizontal travel (px): the card slides in from this far right.
const TOAST_SLIDE: f32 = 40.0;

// ---------------------------------------------------------------------------
// Pure logic (unit-tested; no freya runtime)
// ---------------------------------------------------------------------------

/// A toast's animation phase, resolved purely from its arrival time.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ToastPhase {
    /// Live: springing in / holding in place.
    In,
    /// Past its window: springing out before it unmounts.
    Out,
}

/// One toast the deck should render: which notification, and its phase.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct LiveToast {
    pub id: u32,
    pub phase: ToastPhase,
}

/// Resolve which notifications render as toasts, newest-first, purely from their
/// recorded arrival times. A notification is LIVE (phase [`ToastPhase::In`]) while
/// critical, or while its age is under [`TOAST_MS`]; it then LEAVES (phase
/// [`ToastPhase::Out`]) for [`TOAST_OUT_MS`] before disappearing. Only ids with a
/// recorded arrival are considered (one that arrived while suppressed has none, so
/// it never shows). Live toasts are capped at [`MAX_TOASTS`] newest; leaving
/// toasts do not consume a live slot.
pub(crate) fn resolve_toasts(
    now_ms: u64,
    store_newest_first: &[(u32, bool)],
    arrivals: &HashMap<u32, u64>,
) -> Vec<LiveToast> {
    let mut out = Vec::new();
    let mut live = 0usize;
    for &(id, critical) in store_newest_first {
        let Some(&arrived) = arrivals.get(&id) else {
            continue;
        };
        let age = now_ms.saturating_sub(arrived);
        if critical || age < TOAST_MS {
            if live < MAX_TOASTS {
                out.push(LiveToast { id, phase: ToastPhase::In });
                live += 1;
            }
        } else if age < TOAST_MS + TOAST_OUT_MS {
            out.push(LiveToast { id, phase: ToastPhase::Out });
        }
    }
    out
}

/// The bell unread badge text: hidden (`None`) at zero, the exact count through 9,
/// then capped at `9+` (ags/widget/Bar.tsx bell badge).
pub(crate) fn badge_text(count: usize) -> Option<String> {
    match count {
        0 => None,
        1..=9 => Some(count.to_string()),
        _ => Some("9+".to_string()),
    }
}

/// Advance the toast baseline gate for one snapshot. `seeded` is whether we have
/// already baselined; `serving` is the snapshot's serving flag. Returns
/// `(is_baseline_run, seeded_next)`: baseline holds through the first
/// `serving=true` snapshot (so the persisted store is silently marked seen, never
/// flashed), and stays seeded thereafter even if serving flaps.
pub(crate) fn baseline_step(seeded: bool, serving: bool) -> (bool, bool) {
    (!seeded, seeded || serving)
}

// ---------------------------------------------------------------------------
// Toasts surface
// ---------------------------------------------------------------------------

/// Additive per-toasts-surface root context: `true` while the drawer is open, so
/// toasts suppress (the drawer adopts them). main.rs writes it from the drawer's
/// reveal callback. A newtype so it never collides with the frozen contexts.
#[derive(Clone, Copy, PartialEq)]
pub struct DrawerOpen(pub State<bool>);

/// The per-output toasts overlay (ags `Toasts`). Renders up to [`MAX_TOASTS`]
/// newest live notifications, top-right, suppressed while dnd or the drawer is
/// open.
pub fn toasts() -> impl IntoElement {
    Toasts
}

#[derive(PartialEq)]
struct Toasts;

impl Component for Toasts {
    fn render(&self) -> impl IntoElement {
        let notifd = use_consume::<State<NotifdSnapshot>>();
        let drawer_open = use_consume::<DrawerOpen>();

        // Arrival bookkeeping. `seen` dedups every id ever observed; `arrivals`
        // records first-seen ms for ids that earned a live window (post-baseline,
        // not suppressed at arrival). `tick` is bumped by expiry tasks to force a
        // re-render when a toast should flip to Out / disappear.
        let arrivals = use_state(HashMap::<u32, u64>::new);
        let seen = use_state(HashSet::<u32>::new);
        let seeded = use_state(|| false);
        let tick = use_state(|| 0u64);
        let base = use_hook(Instant::now);

        // Interactive input-region bridge: each ToastCard writes its measured
        // surface-local bounds into `card_rects` (keyed by id); we union the visible
        // cards below and push them to the manager over the bus, which sets the
        // toasts surfaces' wl input region so the cards (close + action buttons)
        // become clickable again while the gaps stay click-through.
        let bus = use_consume::<ShellBus>();
        let card_rects = use_state(HashMap::<u32, (i32, i32, i32, i32)>::new);

        let serving = notifd.read().serving;
        let dnd = notifd.read().dnd;
        let suppressed = dnd || *drawer_open.0.read();
        let store: Vec<(u32, bool)> = notifd
            .read()
            .notifications
            .iter()
            .map(|n| (n.id, n.critical))
            .collect();

        // Subscribe to expiry bumps so 3.8s-later re-renders actually happen.
        let _ = *tick.read();

        // Arrival reconcile. The callback is installed once (use_hook), so it must
        // read the live store/suppressed from `deps`, never captured render locals;
        // the State handles + `base` are stable across renders, so capturing them
        // is fine (mirrors the osd reveal effect).
        use_side_effect_with_deps(
            &(store.clone(), suppressed, serving),
            move |(store, suppressed, serving): &(Vec<(u32, bool)>, bool, bool)| {
                let now = base.elapsed().as_millis() as u64;
                let mut seeded = seeded;
                let mut seen = seen;
                let mut arrivals = arrivals;
                // notifd emits an empty `serving=false` snapshot first, then a
                // `serving=true` snapshot carrying the persisted store. Baseline
                // (mark seen, never toast) through that first serving snapshot, so
                // persisted notifications never flash on startup (see baseline_step).
                let (baseline, seeded_next) = baseline_step(*seeded.peek(), *serving);
                if seeded_next != *seeded.peek() {
                    seeded.set(seeded_next);
                }

                let mut new_non_critical = 0usize;
                let mut added = false;
                {
                    let mut seen_w = seen.write();
                    let mut arr_w = arrivals.write();
                    for &(id, critical) in store {
                        if seen_w.contains(&id) {
                            continue;
                        }
                        seen_w.insert(id);
                        // Baseline the pre-existing store (never flash it), and drop
                        // arrivals that land while suppressed (ags gating): no window.
                        if baseline || *suppressed {
                            continue;
                        }
                        arr_w.insert(id, now);
                        added = true;
                        if !critical {
                            new_non_critical += 1;
                        }
                    }
                    // Bound memory: forget arrivals for ids no longer in the store.
                    let present: HashSet<u32> = store.iter().map(|(id, _)| *id).collect();
                    arr_w.retain(|id, _| present.contains(id));
                }

                // One lifecycle task per newly-live non-critical toast: bump at the
                // window end (In -> Out), then again after the out tail (drop).
                for _ in 0..new_non_critical {
                    let mut tick = tick;
                    let platform = Platform::get();
                    spawn(async move {
                        Timer::after(Duration::from_millis(TOAST_MS)).await;
                        *tick.write() += 1;
                        platform.send(UserEvent::RequestRedraw);
                        Timer::after(Duration::from_millis(TOAST_OUT_MS)).await;
                        *tick.write() += 1;
                        platform.send(UserEvent::RequestRedraw);
                    });
                }

                if added {
                    // A fresh arrival was recorded after this render (including sticky
                    // criticals, which have no task): repaint so it appears now.
                    Platform::get().send(UserEvent::RequestRedraw);
                }
            },
        );

        let now = base.elapsed().as_millis() as u64;
        let live = resolve_toasts(now, &store, &arrivals.read());

        let snap = notifd.read();
        let cards: Vec<Element> = live
            .iter()
            .filter_map(|lt| {
                let n = snap.notifications.iter().find(|n| n.id == lt.id)?;
                Some(
                    rect()
                        .key(lt.id)
                        .child(ToastCard { n: n.clone(), phase: lt.phase, rects: card_rects })
                        .into_element(),
                )
            })
            .collect();
        drop(snap);

        // Assemble the wl input region: the union of the CURRENTLY VISIBLE toast card
        // rects ONLY (surface-local), so the gaps between cards -- and the whole
        // surface when there are no toasts -- stay click-through. Suppression (dnd or
        // drawer open) yields an empty region: the drawer adopts the toasts.
        let live_ids: Vec<u32> = live.iter().map(|lt| lt.id).collect();
        let region: Vec<(i32, i32, i32, i32)> = if suppressed {
            Vec::new()
        } else {
            let map = card_rects.read();
            live_ids.iter().filter_map(|id| map.get(id).copied()).collect()
        };
        // Publish on change only (deps dedup vs the last-sent region), and prune
        // bounds for unmounted toasts so `card_rects` never grows without bound.
        use_side_effect_with_deps(
            &(region.clone(), live_ids.clone()),
            move |(region, live_ids)| {
                let mut card_rects = card_rects;
                let alive: HashSet<u32> = live_ids.iter().copied().collect();
                // Hoist the peek() borrow out before write() (State gotcha).
                let stale = card_rects.peek().keys().any(|id| !alive.contains(id));
                if stale {
                    card_rects.write().retain(|id, _| alive.contains(id));
                }
                bus.send(ShellMsg::ToastsRegion(region.clone()));
            },
        );

        let column = rect()
            .vertical()
            .width(Size::px(TOAST_COL_W))
            .spacing(8.0)
            .cross_align(Alignment::End)
            .children(cards);

        // Full-surface overlay pinned top-right; suppression hides it (the drawer
        // adopts the toasts) while keeping the springs/arrivals ticking underneath.
        rect()
            .expanded()
            .vertical()
            .main_align(Alignment::Start)
            .cross_align(Alignment::End)
            .opacity(if suppressed { 0.0 } else { 1.0 })
            .interactive(!suppressed)
            .child(column)
    }
}

/// One toast: the translucent card plus its enter/exit spring. Keyed by id so the
/// spring state stays with the right notification across reorders. `rects` is the
/// parent's shared surface-local bounds map: each card writes its own measured rect
/// keyed by id so [`Toasts`] can assemble the per-card input region.
#[derive(PartialEq)]
struct ToastCard {
    n: Notification,
    phase: ToastPhase,
    rects: State<HashMap<u32, (i32, i32, i32, i32)>>,
}

impl Component for ToastCard {
    fn render(&self) -> impl IntoElement {
        // 0 = entering (off-screen right + faded), 1 = fully in place.
        let mut slide = use_spring(0.0);
        // Compute the target/spec from the dependency (not captured render locals):
        // the callback is installed once, so an In -> Out flip must re-derive them.
        use_side_effect_with_deps(&self.phase, move |phase: &ToastPhase| {
            let (target, spec) = match phase {
                ToastPhase::In => (1.0, motion::TOAST_IN),
                ToastPhase::Out => (0.0, motion::TOAST_OUT),
            };
            slide.to(target, spec);
        });

        let t = slide.value();
        let id = self.n.id;
        let mut rects = self.rects;
        // offset_x shifts the wrapper's CHILD (the inner panel), not the wrapper
        // itself, so the whole card translates without reflowing the column. We
        // measure that inner child, NOT the stable outer wrapper: torin's offset_x
        // translates descendants and notifies their layout references, so on_sized
        // here reports the card's ACTUAL moving surface-local rect (an invisible
        // input strip would otherwise linger where the wrapper sits during the
        // slide). The parent unions these into the input region; per-frame updates
        // during the slide are correct, and the parent dedups unchanged values.
        rect()
            .offset_x((1.0 - t) * TOAST_SLIDE)
            .opacity(t)
            .child(
                rect()
                    .on_sized(move |e: Event<SizedEventData>| {
                        // Wayland regions take integer rects: floor the top-left and
                        // ceil the bottom-right so the integer rect fully COVERS the
                        // fractional (spring-translated) card bounds instead of
                        // under-covering an edge.
                        let a = e.area;
                        let left = a.origin.x.floor() as i32;
                        let top = a.origin.y.floor() as i32;
                        let right = (a.origin.x + a.size.width).ceil() as i32;
                        let bottom = (a.origin.y + a.size.height).ceil() as i32;
                        let next = (left, top, right - left, bottom - top);
                        // Hoist the peek() borrow out before write() (State gotcha).
                        let prev = rects.peek().get(&id).copied();
                        if prev != Some(next) {
                            rects.write().insert(id, next);
                        }
                    })
                    .child(notif_card(&self.n, true, true, Size::px(NCARD_W))),
            )
    }
}

// ---------------------------------------------------------------------------
// Drawer surface
// ---------------------------------------------------------------------------

/// The singleton notification drawer (ags `Drawer`): media card on top, a header
/// (title / count / DND / Clear), then a scrollable newest-first history. Faded by
/// the reveal spring's [`OpenProgress`]; Esc closes it via the plain CloseAll path
/// (main.rs routes non-exclusive Escape to CloseAll, so no KeyFeed is needed).
pub fn drawer() -> impl IntoElement {
    Drawer
}

#[derive(PartialEq)]
struct Drawer;

impl Component for Drawer {
    fn render(&self) -> impl IntoElement {
        let progress = use_consume::<OpenProgress>();
        let opacity = *progress.0.read();
        let notifd = use_consume::<State<NotifdSnapshot>>();

        let snap = notifd.read();
        let count = snap.notifications.len();
        let dnd = snap.dnd;
        let list: Element = if count == 0 {
            empty_state()
        } else {
            // Key each card by notification id (matching the toast list above):
            // the drawer re-sorts/dismisses entries, so stateful card
            // reconciliation must track the notification, not the list index.
            let cards: Vec<Element> = snap
                .notifications
                .iter()
                .map(|n| rect().key(n.id).child(DrawerCard { n: n.clone() }).into_element())
                .collect();
            ScrollView::new()
                .direction(Direction::Vertical)
                .spacing(8.0)
                .width(Size::fill())
                .height(Size::fill())
                .children(cards)
                .into_element()
        };
        drop(snap);

        // The drawer body is transparent -- the cards float on the wallpaper.
        rect().expanded().opacity(opacity).child(
            rect()
                .expanded()
                .vertical()
                .spacing(8.0)
                .child(MediaCard)
                .child(drawer_header(count, dnd))
                .child(rect().width(Size::fill()).height(Size::fill()).child(list)),
        )
    }
}

/// The drawer header (ags `.nhead`): PANEL pill with the title, unread count, a
/// DND toggle, and the Clear button.
fn drawer_header(count: usize, dnd: bool) -> Element {
    let count_text = if count == 0 { String::new() } else { count.to_string() };
    rect()
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(8.0)
        .padding((8.0, 8.0, 8.0, 14.0))
        .background(theme::PANEL.rgb())
        .corner_radius(14.0)
        .shadow((0.0, 6.0, 18.0, 0.0, (0, 0, 0, 77)))
        .child(
            label()
                .text("Notifications")
                .color(theme::TX.rgb())
                .font_size(13.5)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32),
        )
        .child(
            label()
                .text(count_text)
                .color(theme::DIM.rgb())
                .font_size(11.0)
                .font_family(theme::FONT_FAMILY_DATA),
        )
        .child(rect().width(Size::flex(1.0)))
        .child(DndToggle { active: dnd })
        .child(ClearButton)
        .into_element()
}

/// The "All caught up" empty state (ags `.nempty`).
fn empty_state() -> Element {
    rect()
        .width(Size::fill())
        .vertical()
        .cross_align(Alignment::Center)
        .spacing(4.0)
        .padding((20.0, 0.0, 16.0, 0.0))
        .background(theme::PANEL.rgb())
        .corner_radius(theme::RADIUS_CARD)
        .shadow((0.0, 6.0, 18.0, 0.0, (0, 0, 0, 77)))
        .child(icon(ICON_CHECK, 22.0, theme::MUT))
        .child(
            label()
                .text("All caught up")
                .color(theme::MUT.rgb())
                .font_size(12.5),
        )
        .into_element()
}

/// One drawer history card (opaque PANEL, action buttons enabled).
#[derive(PartialEq)]
struct DrawerCard {
    n: Notification,
}

impl Component for DrawerCard {
    fn render(&self) -> impl IntoElement {
        notif_card(&self.n, false, true, Size::fill())
    }
}

// ---------------------------------------------------------------------------
// Shared notification card
// ---------------------------------------------------------------------------

/// (background, horizontal padding, shadow) for [`notif_card`]'s translucent
/// (toast) vs opaque (drawer) backing.
type CardStyle = (Color, f32, (f32, f32, f32, f32, (u8, u8, u8, u8)));

/// The shared notification card body (ags `Card`): a 30px icon tile, the
/// summary/time/body text column, and (when `interactive`) a close button + action
/// buttons. Both toasts and drawer cards are interactive: the toasts surface gets a
/// per-card wl input region (the Toasts component reports each card's measured
/// bounds; main.rs registers the surfaces and the manager applies the region), so
/// the close/action buttons are live while the gaps stay click-through.
/// `translucent` selects the toast backing (the one sanctioned translucency) vs the
/// opaque drawer PANEL.
fn notif_card(n: &Notification, translucent: bool, interactive: bool, width: Size) -> Element {
    let (bg, pad_h, shadow): CardStyle = if translucent
    {
        (
            Color::from_af32rgb(0.82, 16, 13, 20),
            13.0,
            (0.0, 18.0, 40.0, 0.0, (5, 3, 10, 115)),
        )
    } else {
        (
            theme::PANEL.rgb().into(),
            12.0,
            (0.0, 6.0, 18.0, 0.0, (0, 0, 0, 77)),
        )
    };

    let tile = rect()
        .width(Size::px(30.0))
        .height(Size::px(30.0))
        .corner_radius(theme::RADIUS_BUTTON)
        .background(theme::CHIP.rgb())
        .center()
        .overflow(Overflow::Clip)
        .child(card_glyph(n));

    // Content::Flex is REQUIRED here: without it the flex(1) summary consumes the
    // whole row and the time label collapses to ~1ch and wraps vertically (the same
    // Torin class as the calendar column bug).
    let top = rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Start)
        .spacing(8.0)
        .child(
            label()
                .text(n.summary.clone())
                .color(theme::TX.rgb())
                .font_size(12.5)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32)
                .max_lines(1usize)
                .text_overflow(TextOverflow::Ellipsis)
                .width(Size::flex(1.0)),
        )
        .child(
            label()
                .text(fmt_when(n.time))
                .color(theme::DIM.rgb())
                .font_size(10.0)
                .max_lines(1usize)
                .font_family(theme::FONT_FAMILY_DATA),
        );

    let mut text = rect().vertical().width(Size::flex(1.0)).spacing(2.0).child(top);
    if !n.body.is_empty() {
        text = text.child(
            label()
                .text(n.body.clone())
                .color(theme::MUT.rgb())
                .font_size(11.8)
                .max_lines(2usize)
                .text_overflow(TextOverflow::Ellipsis)
                .width(Size::fill()),
        );
    }

    let mut row = rect()
        .horizontal()
        // Content::Flex is REQUIRED so the flex(1) text column reserves room for the
        // fixed icon tile and (interactive) close button instead of eating the whole
        // row -- without it the close button overflows off the card's right edge
        // (same Torin rule as the summary/time row above).
        .content(Content::Flex)
        .width(Size::fill())
        .cross_align(Alignment::Start)
        .spacing(10.0)
        .child(tile)
        .child(text);
    if interactive {
        row = row.child(CloseButton { id: n.id });
    }

    let mut card = rect()
        .vertical()
        .width(width)
        .spacing(8.0)
        .padding((11.0, pad_h))
        .background(bg)
        .corner_radius(theme::RADIUS_CARD)
        .shadow(shadow)
        .child(row);

    if interactive {
        let actions: Vec<Element> = n
            .actions
            .iter()
            .filter(|(_, label)| !label.is_empty())
            .map(|(key, label)| {
                ActionButton { id: n.id, action_key: key.clone(), label: label.clone() }
                    .into_element()
            })
            .collect();
        if !actions.is_empty() {
            card = card.child(
                rect()
                    .horizontal()
                    .spacing(6.0)
                    .cross_align(Alignment::Center)
                    .children(actions),
            );
        }
    }

    card.into_element()
}

/// The card icon: a file-path app icon when one was supplied, else the bell glyph.
/// Themed icon *names* are not resolvable without an icon theme, so they fall back.
fn card_glyph(n: &Notification) -> Element {
    match n.app_icon.as_deref() {
        Some(path) if path.starts_with('/') => {
            AppIcon { path: Some(PathBuf::from(path)), size: 15.0 }.into_element()
        }
        _ => icon(ICON_BELL, 15.0, theme::MUT).into_element(),
    }
}

/// Format a Unix-seconds receipt time as local `HH:MM` (ags `toCardData.when`).
fn fmt_when(time: i64) -> String {
    chrono::DateTime::from_timestamp(time, 0)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%H:%M")
                .to_string()
        })
        .unwrap_or_default()
}

/// A card's close button: 22px pill, dim glyph, rose on hover (ags `.nx`).
#[derive(PartialEq)]
struct CloseButton {
    id: u32,
}

impl Component for CloseButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        let id = self.id;
        rect()
            .width(Size::px(22.0))
            .height(Size::px(22.0))
            .corner_radius(theme::RADIUS_PILL)
            .background(hover.pick::<Color>(Color::TRANSPARENT, theme::CHIP.rgb().into()))
            .center()
            .hover(hover)
            .on_press(move |_| bus.send(ShellMsg::Service(Command::CloseNotification(id))))
            .child(icon(ICON_CLOSE, 11.0, hover.pick(theme::DIM, theme::ROSE)))
    }
}

/// A notification action button (ags action -> InvokeNotificationAction).
#[derive(PartialEq)]
struct ActionButton {
    id: u32,
    action_key: String,
    label: String,
}

impl Component for ActionButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        let id = self.id;
        let action_key = self.action_key.clone();
        rect()
            .padding((6.0, 12.0))
            .corner_radius(8.0)
            .background(hover.pick(theme::PANEL2, theme::CHIP).rgb())
            .center()
            .hover(hover)
            .on_press(move |_| {
                bus.send(ShellMsg::Service(Command::InvokeNotificationAction {
                    id,
                    action_key: action_key.clone(),
                }));
            })
            .child(
                label()
                    .text(self.label.clone())
                    .color(theme::TX.rgb())
                    .font_size(11.5)
                    .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
            )
    }
}

/// The header's do-not-disturb toggle: a compact pill that fills LEAF when active
/// (ags Silent routes to the store; here the chip drives `SetDnd`).
#[derive(PartialEq)]
struct DndToggle {
    active: bool,
}

impl Component for DndToggle {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        let active = self.active;
        let bg = if active {
            hover.pick(theme::LEAF, theme::LEAF2)
        } else {
            hover.pick(theme::PANEL2, theme::CHIP)
        };
        let tint = if active { theme::INK } else { theme::MUT };
        rect()
            .min_height(Size::px(28.0))
            .padding((0.0, 10.0))
            .corner_radius(theme::RADIUS_PILL)
            .background(bg.rgb())
            .center()
            .hover(hover)
            .on_press(move |_| bus.send(ShellMsg::Service(Command::SetDnd(!active))))
            .child(icon(ICON_BELL_SLASH, 15.0, tint))
    }
}

/// The header's Clear button: dismisses every stored notification (ags `.nclear`).
#[derive(PartialEq)]
struct ClearButton;

impl Component for ClearButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        rect()
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(5.0)
            .padding((4.0, 9.0))
            .corner_radius(7.0)
            .background(hover.pick::<Color>(Color::TRANSPARENT, theme::PANEL2.rgb().into()))
            .hover(hover)
            .on_press(move |_| bus.send(ShellMsg::Service(Command::ClearNotifications)))
            .child(icon(ICON_TRASH, 12.0, theme::ROSE))
            .child(
                label()
                    .text("Clear")
                    .color(theme::ROSE.rgb())
                    .font_size(11.5)
                    .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
            )
    }
}

// ---------------------------------------------------------------------------
// Media card (ags MediaCard)
// ---------------------------------------------------------------------------

/// The drawer's media card: the active player's art, title/artist, prev/play/next
/// controls and a progress bar; an empty "Nothing playing" state with an Open
/// Music shortcut when no player is present.
#[derive(PartialEq)]
struct MediaCard;

impl Component for MediaCard {
    fn render(&self) -> impl IntoElement {
        let media = use_consume::<State<MediaSnapshot>>();
        let snap = media.read();

        let body: Element = match snap.player.as_ref() {
            Some(p) => {
                let progress = if p.length_secs > 0.0 {
                    (p.position_secs / p.length_secs).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                media_player_row(
                    p.art_path.clone(),
                    p.title.clone(),
                    p.artist.clone(),
                    p.playing,
                    progress,
                    p.position_secs,
                    p.length_secs,
                )
            }
            None => media_empty_row(),
        };
        drop(snap);

        rect()
            .vertical()
            .width(Size::fill())
            .padding((10.0, 11.0, 9.0, 11.0))
            .background(theme::PANEL.rgb())
            .corner_radius(theme::RADIUS_CARD)
            .shadow((0.0, 15.0, 34.0, 0.0, (8, 5, 16, 115)))
            .child(body)
    }
}

/// The active-player row + progress bar.
fn media_player_row(
    art: Option<PathBuf>,
    title: String,
    artist: String,
    playing: bool,
    progress: f64,
    position: f64,
    length: f64,
) -> Element {
    let art_inner: Element = match art {
        Some(path) => ImageViewer::new(path)
            .width(Size::px(46.0))
            .height(Size::px(46.0))
            .into_element(),
        None => icon(ICON_MUSIC, 22.0, theme::MUT).into_element(),
    };
    let art_tile = rect()
        .width(Size::px(46.0))
        .height(Size::px(46.0))
        .corner_radius(10.0)
        .background(theme::CHIP.rgb())
        .center()
        .overflow(Overflow::Clip)
        .child(art_inner);

    let meta = rect()
        .vertical()
        .width(Size::flex(1.0))
        .main_align(Alignment::Center)
        .cross_align(Alignment::Start)
        .child(
            label()
                .text(title)
                .color(theme::TX.rgb())
                .font_size(13.0)
                .font_weight(theme::FONT_WEIGHT_BOLD as i32)
                .max_lines(1usize)
                .text_overflow(TextOverflow::Ellipsis),
        )
        .child(
            label()
                .text(artist)
                .color(theme::MUT.rgb())
                .font_size(11.5)
                .max_lines(1usize)
                .text_overflow(TextOverflow::Ellipsis),
        );

    let btns = rect()
        .horizontal()
        .cross_align(Alignment::Center)
        .spacing(1.0)
        .child(MediaButton { action: MediaAction::Prev, playing })
        .child(MediaButton { action: MediaAction::PlayPause, playing })
        .child(MediaButton { action: MediaAction::Next, playing });

    let row = rect()
        .horizontal()
        .width(Size::fill())
        .cross_align(Alignment::Center)
        .spacing(11.0)
        .child(art_tile)
        .child(meta)
        .child(btns);

    let bar = rect()
        .horizontal()
        .width(Size::fill())
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .spacing(8.0)
        .margin((7.0, 0.0, 0.0, 0.0))
        .child(media_time(position))
        .child(media_track(progress))
        .child(media_time(length));

    rect()
        .vertical()
        .width(Size::fill())
        .child(row)
        .child(bar)
        .into_element()
}

/// The "Nothing playing" empty state with an Open Music shortcut.
fn media_empty_row() -> Element {
    let art_tile = rect()
        .width(Size::px(46.0))
        .height(Size::px(46.0))
        .corner_radius(10.0)
        .background(theme::CHIP.rgb())
        .center()
        .child(icon(ICON_DISC, 22.0, theme::DIM));

    let meta = rect()
        .vertical()
        .width(Size::flex(1.0))
        .main_align(Alignment::Center)
        .cross_align(Alignment::Start)
        .spacing(2.0)
        .child(
            label()
                .text("Nothing playing")
                .color(theme::MUT.rgb())
                .font_size(12.0),
        )
        .child(
            label()
                .text("Media controls appear when a player starts")
                .color(theme::MUT.rgb())
                .font_size(11.5)
                .max_lines(2usize)
                .text_overflow(TextOverflow::Ellipsis)
                .width(Size::fill()),
        );

    rect()
        .horizontal()
        .width(Size::fill())
        .cross_align(Alignment::Center)
        .spacing(11.0)
        .child(art_tile)
        .child(meta)
        .child(OpenMusicButton)
        .into_element()
}

/// A tabular `m:ss` media time label.
fn media_time(secs: f64) -> Element {
    let total = secs.max(0.0) as u64;
    label()
        .text(format!("{}:{:02}", total / 60, total % 60))
        .color(theme::MUT.rgb())
        .font_size(10.5)
        .font_family(theme::FONT_FAMILY_DATA)
        .into_element()
}

/// The 4px CHIP rail with a LEAF fill sized to `progress` (ags `.mtrack`).
fn media_track(progress: f64) -> Element {
    let fill = rect()
        .width(Size::percent((progress.clamp(0.0, 1.0) * 100.0) as f32))
        .height(Size::px(4.0))
        .corner_radius(theme::RADIUS_PILL)
        .background(theme::LEAF.rgb());
    rect()
        .width(Size::flex(1.0))
        .height(Size::px(4.0))
        .corner_radius(theme::RADIUS_PILL)
        .background(theme::CHIP.rgb())
        .child(fill)
        .into_element()
}

/// Which transport control a [`MediaButton`] fires.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MediaAction {
    Prev,
    PlayPause,
    Next,
}

/// A 29px transport control (ags `.mbtn`): prev/play-pause/next.
#[derive(PartialEq)]
struct MediaButton {
    action: MediaAction,
    playing: bool,
}

impl Component for MediaButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        let (glyph, cmd) = match self.action {
            MediaAction::Prev => (ICON_SKIP_BACK, Command::MediaPrevious),
            MediaAction::PlayPause => (
                if self.playing { ICON_PAUSE } else { ICON_PLAY },
                Command::MediaPlayPause,
            ),
            MediaAction::Next => (ICON_SKIP_FWD, Command::MediaNext),
        };
        rect()
            .width(Size::px(29.0))
            .height(Size::px(29.0))
            .corner_radius(8.0)
            .background(hover.pick::<Color>(Color::TRANSPARENT, theme::CHIP.rgb().into()))
            .center()
            .hover(hover)
            .on_press(move |_| bus.send(ShellMsg::Service(cmd.clone())))
            .child(icon(glyph, 14.0, hover.pick(theme::MUT, theme::TX)))
    }
}

/// The empty-state "Open Music" ghost button (ags `.ghostb`).
#[derive(PartialEq)]
struct OpenMusicButton;

impl Component for OpenMusicButton {
    fn render(&self) -> impl IntoElement {
        let bus = use_consume::<ShellBus>();
        let hover = use_hover();
        rect()
            .padding((7.0, 12.0))
            .corner_radius(10.0)
            .background(hover.pick(theme::CHIP, theme::HOVER).rgb())
            .center()
            .hover(hover)
            .on_press(move |_| {
                bus.send(ShellMsg::Service(Command::OpenUri(
                    "https://open.spotify.com".to_string(),
                )))
            })
            .child(
                label()
                    .text("Open Music")
                    .color(theme::TX.rgb())
                    .font_size(11.5)
                    .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32),
            )
    }
}

// ---------------------------------------------------------------------------
// Tests -- pure logic only (no freya runtime).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn badge_hidden_at_zero() {
        assert_eq!(badge_text(0), None);
    }

    #[test]
    fn badge_shows_exact_through_nine() {
        assert_eq!(badge_text(1).as_deref(), Some("1"));
        assert_eq!(badge_text(9).as_deref(), Some("9"));
    }

    #[test]
    fn badge_caps_past_nine() {
        assert_eq!(badge_text(10).as_deref(), Some("9+"));
        assert_eq!(badge_text(999).as_deref(), Some("9+"));
    }

    #[test]
    fn baseline_holds_through_first_serving_snapshot() {
        // Pre-serving empty snapshot: baseline, still not seeded.
        assert_eq!(baseline_step(false, false), (true, false));
        // First serving snapshot (persisted store): baseline (no flash), now seeded.
        assert_eq!(baseline_step(false, true), (true, true));
        // Subsequent serving snapshots: no longer baseline -> new ids admitted.
        assert_eq!(baseline_step(true, true), (false, true));
        // Serving flapping back to false never un-seeds us.
        assert_eq!(baseline_step(true, false), (false, true));
    }

    #[test]
    fn fmt_when_formats_local_hh_mm() {
        // Round-trip through Local, same pattern as calendar.rs's event tests:
        // build a known local wall-clock time, convert to its epoch, then assert
        // fmt_when reproduces the same HH:MM -- timezone-independent either way.
        let local = chrono::Local
            .with_ymd_and_hms(2026, 7, 13, 9, 45, 0)
            .single()
            .expect("unambiguous local time");
        assert_eq!(fmt_when(local.timestamp()), local.format("%H:%M").to_string());
    }

    #[test]
    fn fmt_when_falls_back_to_empty_on_an_unrepresentable_timestamp() {
        // i64::MIN is far outside chrono's representable range -- from_timestamp
        // returns None, and fmt_when must degrade to an empty label, never panic.
        assert_eq!(fmt_when(i64::MIN), "");
    }

    fn arrivals(pairs: &[(u32, u64)]) -> HashMap<u32, u64> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn fresh_toast_is_live() {
        let live = resolve_toasts(0, &[(1, false)], &arrivals(&[(1, 0)]));
        assert_eq!(live, vec![LiveToast { id: 1, phase: ToastPhase::In }]);
    }

    #[test]
    fn toast_leaves_after_window_then_disappears() {
        let store = [(1, false)];
        let arr = arrivals(&[(1, 0)]);
        // Still live one ms before the window closes.
        assert_eq!(
            resolve_toasts(TOAST_MS - 1, &store, &arr),
            vec![LiveToast { id: 1, phase: ToastPhase::In }]
        );
        // Leaving at the window edge.
        assert_eq!(
            resolve_toasts(TOAST_MS, &store, &arr),
            vec![LiveToast { id: 1, phase: ToastPhase::Out }]
        );
        // Gone once the out tail elapses.
        assert!(resolve_toasts(TOAST_MS + TOAST_OUT_MS, &store, &arr).is_empty());
    }

    #[test]
    fn critical_toast_is_sticky() {
        let live = resolve_toasts(10_000_000, &[(7, true)], &arrivals(&[(7, 0)]));
        assert_eq!(live, vec![LiveToast { id: 7, phase: ToastPhase::In }]);
    }

    #[test]
    fn without_arrival_never_shows() {
        assert!(resolve_toasts(0, &[(1, false)], &arrivals(&[])).is_empty());
    }

    #[test]
    fn live_toasts_capped_at_max_newest() {
        // Newest-first store of four fresh non-critical toasts.
        let store = [(4, false), (3, false), (2, false), (1, false)];
        let arr = arrivals(&[(1, 0), (2, 0), (3, 0), (4, 0)]);
        let live = resolve_toasts(0, &store, &arr);
        assert_eq!(live.len(), MAX_TOASTS);
        assert_eq!(
            live.iter().map(|t| t.id).collect::<Vec<_>>(),
            vec![4, 3, 2]
        );
    }

    #[test]
    fn leaving_toast_does_not_consume_live_slot() {
        // Three fresh live + one older toast in its out tail; all four render.
        let store = [(4, false), (3, false), (2, false), (1, false)];
        let now = TOAST_MS + 100;
        let arr = arrivals(&[(1, 0), (2, now), (3, now), (4, now)]);
        let live = resolve_toasts(now, &store, &arr);
        // 3 live (4, 3, 2) + 1 leaving (1) -- the leaving toast is not capped out.
        assert_eq!(live.len(), 4);
        assert_eq!(live[3], LiveToast { id: 1, phase: ToastPhase::Out });
    }
}
