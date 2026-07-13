// kobel-shell entry point: wire the services fan-out, the Wayland host, per-output
// bar + osd surfaces, the manager loop, and the IPC control socket.
//
// Threading model (docs/FREYA-PLAN.md 2.2/2.3): the host owns the calloop loop on
// this (UI) thread; services run on their own threads and push plain snapshots over a
// channel; the IPC listener runs on a std thread and only sends over the ShellBus.
// Both producers wake the loop, whose app tick drains the channels on the UI thread
// and writes the per-surface State handles -- the normal dirty -> frame machinery
// then repaints only the surfaces that consume the changed snapshot.

pub mod ipc;
pub mod manager;
pub mod motion;
pub mod theme;
pub mod ui;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc;

use freya_core::prelude::{IntoElement, State, WritableUtils};
use kobel_services::{
    AppsSnapshot, AudioSnapshot, BatterySnapshot, BluetoothSnapshot, BrightnessSnapshot,
    GnoblinSnapshot, MediaSnapshot, NetworkSnapshot, NotifdSnapshot, PowerSnapshot, ServiceEvent,
    Services, SettingsSnapshot, TraySnapshot,
};
use kobel_wayland::{
    Anchor, KeyboardInteractivity, Layer, Margins, OutputControl, OutputEvent, OutputId, Shell,
    SurfaceConfig, SurfaceContexts, SurfaceId, SurfaceSize,
};

use crate::manager::{Manager, ShellBus, ShellMsg, SurfaceKey};

/// The per-surface State handles the app tick fans service snapshots into. Tokens is
/// static, so we do not keep its handle; only the live snapshots change.
struct SurfaceStates {
    gnoblin: State<GnoblinSnapshot>,
    audio: State<AudioSnapshot>,
    battery: State<BatterySnapshot>,
    apps: State<AppsSnapshot>,
    media: State<MediaSnapshot>,
    network: State<NetworkSnapshot>,
    bluetooth: State<BluetoothSnapshot>,
    brightness: State<BrightnessSnapshot>,
    power: State<PowerSnapshot>,
    settings: State<SettingsSnapshot>,
    notifd: State<NotifdSnapshot>,
    tray: State<TraySnapshot>,
}

/// Provide the frozen root contexts on a surface and return the mutable snapshot
/// handles. Called once per surface at creation. The frozen contract (manager.rs)
/// is extended additively with the dock's apps + media snapshots and the phase-5
/// QS snapshots (network/bluetooth/brightness/power/settings), all seeded Default:
/// State<Gnoblin/Audio/Battery/Apps/Media/Network/Bluetooth/Brightness/Power/
/// Settings Snapshot>, State<Tokens>, ShellBus.
fn provide_contexts(
    cx: &mut SurfaceContexts<'_>,
    bus: &ShellBus,
    tokens: theme::Tokens,
) -> SurfaceStates {
    let gnoblin = cx.provide(|| State::create(GnoblinSnapshot::default()));
    // AudioSnapshot has no Default; seed a silent, empty-mixer snapshot.
    let audio = cx.provide(|| {
        State::create(AudioSnapshot { volume: 0.0, muted: false, streams: Vec::new() })
    });
    let battery = cx.provide(|| State::create(BatterySnapshot::default()));
    let apps = cx.provide(|| State::create(AppsSnapshot::default()));
    let media = cx.provide(|| State::create(MediaSnapshot::default()));
    let network = cx.provide(|| State::create(NetworkSnapshot::default()));
    let bluetooth = cx.provide(|| State::create(BluetoothSnapshot::default()));
    let brightness = cx.provide(|| State::create(BrightnessSnapshot::default()));
    let power = cx.provide(|| State::create(PowerSnapshot::default()));
    let settings = cx.provide(|| State::create(SettingsSnapshot::default()));
    let notifd = cx.provide(|| State::create(NotifdSnapshot::default()));
    let tray = cx.provide(|| State::create(TraySnapshot::default()));
    cx.provide(|| State::create(tokens));
    cx.provide(|| bus.clone());
    SurfaceStates {
        gnoblin,
        audio,
        battery,
        apps,
        media,
        network,
        bluetooth,
        brightness,
        power,
        settings,
        notifd,
        tray,
    }
}

/// Provide the frozen root contexts plus the additive per-surface OpenProgress (the
/// reveal opacity the manager animates). Returns the snapshot handles for the service
/// fan-out and the OpenProgress inner State<f32> the manager writes each animated
/// frame.
fn provide_panel_contexts(
    cx: &mut SurfaceContexts<'_>,
    bus: &ShellBus,
    tokens: theme::Tokens,
    key: SurfaceKey,
) -> (SurfaceStates, State<f32>, Option<State<Option<ui::panels::KeyEvent>>>) {
    let states = provide_contexts(cx, bus, tokens);
    let progress = cx.provide(|| ui::panels::OpenProgress(State::create(0.0)));
    // KeyFeed on the keyboard-Exclusive surfaces (launcher, session) AND on
    // QuickSettings: QS is OnDemand, but its Escape must route through the feed
    // (in-drill Esc steps back to root, root Esc closes), so main.rs delivers keys
    // to it like the exclusive surfaces. Calendar/Drawer keep plain Esc -> CloseAll.
    let keyfeed = matches!(
        key,
        SurfaceKey::Launcher | SurfaceKey::Session | SurfaceKey::QuickSettings
    )
    .then(|| cx.provide(|| ui::panels::KeyFeed(State::create(None))).0);
    (states, progress.0, keyfeed)
}

/// Provide the frozen root contexts plus the additive [`ui::notifications::DrawerOpen`]
/// flag for a toasts surface. Returns the snapshot handles for the fan-out and the
/// inner `State<bool>` main.rs writes from the drawer's reveal callback so toasts
/// suppress while the drawer is open.
fn provide_toast_contexts(
    cx: &mut SurfaceContexts<'_>,
    bus: &ShellBus,
    tokens: theme::Tokens,
) -> (SurfaceStates, State<bool>) {
    let states = provide_contexts(cx, bus, tokens);
    let drawer_open = cx.provide(|| ui::notifications::DrawerOpen(State::create(false)));
    (states, drawer_open.0)
}

/// Keyboard mode a surface takes while open: Exclusive grabs every key (launcher and
/// session are keyboard-first), OnDemand shares focus (quicksettings/calendar/drawer).
/// Ports the AGS per-surface keyboard-interactivity (docs/FREYA-PLAN.md 6).
fn kb_open(key: SurfaceKey) -> KeyboardInteractivity {
    match key {
        SurfaceKey::Launcher | SurfaceKey::Session => KeyboardInteractivity::Exclusive,
        SurfaceKey::QuickSettings | SurfaceKey::Calendar | SurfaceKey::Drawer => {
            KeyboardInteractivity::OnDemand
        }
    }
}

/// Layer config for one on-demand surface, ported from docs/FREYA-PLAN.md section 6.
/// All start closed: keyboard None + empty input region (the manager flips both on
/// reveal). Widths come from theme tokens. Launcher/quicksettings/calendar are
/// content-sized (the host measures their sheet and hugs it, bounded by the
/// max_height); the drawer stays a fixed full-height rail (see its arm). An axis
/// anchored to both opposite edges uses size 0 so the compositor fills it.
fn panel_config(key: SurfaceKey, t: &theme::Tokens) -> SurfaceConfig {
    let panel_top = t.panel_top() as i32;
    let edge = t.edge as i32;
    let base = |ns: &str, size: SurfaceSize| {
        SurfaceConfig::new(ns, size)
            .layer(Layer::Top)
            .keyboard_interactivity(KeyboardInteractivity::None)
            .input_region_empty(true)
    };
    match key {
        // TOP, margin-top 56 (sits below the bar); centered on the primary output.
        SurfaceKey::Launcher => base(
            "kobel-launcher",
            // Content-sized: hugs the sheet (field + results/empty state + footer),
            // bounded at 700px so a long results list scrolls rather than overflows.
            SurfaceSize::ContentSized { width: t.launcher_w as u32, max_height: 700 },
        )
        .anchor(Anchor::TOP)
        .margins(Margins { top: 56, right: 0, bottom: 0, left: 0 }),
        // TOP+RIGHT.
        SurfaceKey::QuickSettings => base(
            "kobel-qs",
            // Content-sized: hugs the sheet; the height changes at runtime as drills
            // (wifi/bt/mixer) open, which the host re-measures. Bounded at 640px.
            SurfaceSize::ContentSized { width: t.panel_w as u32, max_height: 640 },
        )
        .anchor(Anchor::TOP | Anchor::RIGHT)
        .margins(Margins { top: panel_top, right: edge, bottom: 0, left: 0 }),
        // TOP (centered).
        SurfaceKey::Calendar => base(
            "kobel-calendar",
            // Content-sized: hugs the six-week grid + events card, which grows with
            // the selected day's event count. Bounded at 520px.
            SurfaceSize::ContentSized { width: t.calendar_w as u32, max_height: 520 },
        )
        .anchor(Anchor::TOP)
        .margins(Margins { top: panel_top, right: 0, bottom: 0, left: 0 }),
        // TOP+RIGHT+BOTTOM full-height right rail (ags marginRight=12 only): the top
        // and bottom anchors fill the height axis (size 0), and the compositor already
        // seats it below the bar's exclusive zone, so only the right inset is set.
        // Deliberately NOT content-sized: top+bottom anchoring already pins it to the
        // full screen height, so the height axis is compositor-filled (size 0) and
        // content sizing would fight that anchoring. It stays a fixed full-height rail.
        SurfaceKey::Drawer => base(
            "kobel-drawer",
            SurfaceSize::Exact { width: t.panel_w as u32, height: 0 },
        )
        .anchor(Anchor::TOP | Anchor::RIGHT | Anchor::BOTTOM)
        .margins(Margins { top: 0, right: 12, bottom: 0, left: 0 }),
        // All edges: full-screen (both axes filled, so size is 0x0).
        SurfaceKey::Session => base("kobel-session", SurfaceSize::Exact { width: 0, height: 0 })
            .anchor(Anchor::TOP | Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT),
    }
}

/// Bar layer config: per-output, top layer, anchored TOP|LEFT|RIGHT. Margins are the
/// FLOATING gap (top) and edge (sides); the exclusive zone reserves gap + bar_h so
/// tiled windows sit below it; height is bar_h.
fn bar_config(t: &theme::Tokens) -> SurfaceConfig {
    let bar_h = t.bar_h as u32;
    SurfaceConfig::new("kobel-bar", SurfaceSize::Exact { width: 0, height: bar_h })
        .layer(Layer::Top)
        .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
        .margins(Margins { top: t.gap as i32, right: t.edge as i32, bottom: 0, left: t.edge as i32 })
        .exclusive_zone(t.gap as i32 + bar_h as i32)
        .keyboard_interactivity(KeyboardInteractivity::None)
}

/// OSD layer config: per-output, bottom-anchored, 72px up, fixed ~230x44,
/// display-only (empty input region -> click-through). A transient volume/brightness
/// pill.
fn osd_config() -> SurfaceConfig {
    SurfaceConfig::new("kobel-osd", SurfaceSize::Exact { width: 230, height: 44 })
        .layer(Layer::Top)
        .anchor(Anchor::BOTTOM)
        .margins(Margins { top: 0, right: 0, bottom: 72, left: 0 })
        .keyboard_interactivity(KeyboardInteractivity::None)
        .input_region_empty(true)
}

/// Dock layer config: per-output, bottom-anchored, `gap` up. Width is computed from
/// the pin count; top layer, no keyboard. The exclusive zone reserves gap + dock
/// height so maximized/tiled windows sit ABOVE the floating dock.
fn dock_config(t: &theme::Tokens) -> SurfaceConfig {
    let dock_h = ui::dock::dock_height(t);
    SurfaceConfig::new(
        "kobel-dock",
        SurfaceSize::Exact { width: ui::dock::dock_width(t, ui::dock::pins().len()), height: dock_h },
    )
    .layer(Layer::Top)
    .anchor(Anchor::BOTTOM)
    .margins(Margins { top: 0, right: 0, bottom: t.gap as i32, left: 0 })
    .exclusive_zone(t.gap as i32 + dock_h as i32)
    .keyboard_interactivity(KeyboardInteractivity::None)
}

/// Toasts layer config: per-output, top-right, below the bar (ags marginTop 58 /
/// marginRight 12). Top layer, no keyboard, NO exclusive zone. Starts fully
/// click-through (empty input region); the Toasts component reports each visible
/// card's bounds and the manager sets the region to their union only.
fn toasts_config() -> SurfaceConfig {
    SurfaceConfig::new(
        "kobel-toasts",
        SurfaceSize::Exact {
            width: ui::notifications::TOASTS_SURFACE_W,
            height: ui::notifications::TOASTS_SURFACE_H,
        },
    )
    .layer(Layer::Top)
    .anchor(Anchor::TOP | Anchor::RIGHT)
    .margins(Margins { top: 58, right: 12, bottom: 0, left: 0 })
    .keyboard_interactivity(KeyboardInteractivity::None)
    .input_region_empty(true)
}

/// Dismiss-layer config: full-screen, top layer, no keyboard, starts click-through.
/// Created FIRST among singletons so it sits beneath the panels: an open panel gets
/// its own clicks; a click outside falls through to the dismiss layer (closes all).
fn dismiss_config() -> SurfaceConfig {
    SurfaceConfig::new("kobel-dismiss", SurfaceSize::Exact { width: 0, height: 0 })
        .layer(Layer::Top)
        .anchor(Anchor::TOP | Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT)
        .keyboard_interactivity(KeyboardInteractivity::None)
        .input_region_empty(true)
}

/// One mounted per-output chrome surface (bar/osd/dock/toasts) plus its fan-out
/// handles, so a per-surface `closed` can drop exactly its bookkeeping without
/// touching its siblings.
struct ChromeSurface {
    /// The host surface id (matched against an [`OutputEvent::SurfaceClosed`]).
    id: SurfaceId,
    /// Service fan-out handles for this surface.
    states: SurfaceStates,
    /// `Some` only on the toasts overlay surface: its DrawerOpen flag (the drawer's
    /// reveal fans open-state into every output's flag). Its presence also marks this
    /// as the manager's toast-region target, so dropping this surface removes both the
    /// dead State it would otherwise write and the surface from the toast registration.
    drawer_flag: Option<State<bool>>,
}

/// Per-output shell bookkeeping. The chrome list shrinks per-surface as the compositor
/// closes surfaces individually, and the whole bundle is dropped when its output goes
/// away -- either way the surfaces' fan-out handles leave the registry, so no stale
/// service snapshot is ever written into a torn-down surface's (dead) State.
struct OutputBundle {
    /// The chrome surfaces mounted for this output (bar/osd/dock/toasts).
    chrome: Vec<ChromeSurface>,
}

/// Which singleton a surface is, so a per-surface `closed` can identify the retired
/// surface and recreate exactly it.
#[derive(Debug, Clone, Copy)]
enum SingletonRole {
    /// The full-screen dismiss layer (not a reveal panel).
    Dismiss,
    /// One of the on-demand reveal panels.
    Panel(SurfaceKey),
}

/// One mounted singleton surface plus its role and fan-out handles.
struct SingletonSurface {
    role: SingletonRole,
    /// The host surface id (matched against an [`OutputEvent::SurfaceClosed`]).
    id: SurfaceId,
    /// Service fan-out handles for this surface.
    states: SurfaceStates,
}

/// The singleton surfaces (launcher/quicksettings/calendar/drawer/session + dismiss),
/// which live on ONE output (the primary). Rebuilt on that output's removal, and each
/// surface is recreated individually when the compositor closes just it.
struct Singletons {
    /// The output currently hosting the singletons.
    output: OutputId,
    /// The mounted singleton surfaces (dismiss + the five panels).
    surfaces: Vec<SingletonSurface>,
}

/// The shared per-output registry: the single source of truth for the service
/// fan-out list plus the toasts/keyfeed bookkeeping, kept in sync as outputs come and
/// go. Shared (`Rc<RefCell>`) between the output handler (mutates it), the app tick
/// (reads it for the fan-out) and the key handler (reads keyfeeds). All three run on
/// the one UI thread and never re-enter each other, so the RefCell never conflicts.
#[derive(Default)]
struct Registry {
    per_output: HashMap<OutputId, OutputBundle>,
    singletons: Option<Singletons>,
    /// surface id -> KeyFeed, so the app key handler can route each press into
    /// whichever surface holds the keyboard. Rebuilt for the new ids on primary death.
    keyfeeds: HashMap<SurfaceId, State<Option<ui::panels::KeyEvent>>>,
}

impl Registry {
    /// Every surface's fan-out handles (per-output chrome + singletons), for the
    /// service snapshot fan-out. Callers copy the `State` handles they touch.
    fn all_states(&self) -> impl Iterator<Item = &SurfaceStates> {
        self.per_output
            .values()
            .flat_map(|b| b.chrome.iter().map(|c| &c.states))
            .chain(self.singletons.iter().flat_map(|s| s.surfaces.iter().map(|ss| &ss.states)))
    }

    /// The toasts overlay ids across all outputs (for `Manager::register_toasts`). The
    /// toasts surface is the chrome surface carrying a DrawerOpen flag; a per-surface
    /// close drops its record, so this naturally excludes a closed toasts overlay.
    fn toast_ids(&self) -> Vec<SurfaceId> {
        self.per_output
            .values()
            .flat_map(|b| b.chrome.iter().filter(|c| c.drawer_flag.is_some()).map(|c| c.id))
            .collect()
    }

    /// Total mounted surface count, for a startup log line.
    fn surface_count(&self) -> usize {
        self.per_output.values().map(|b| b.chrome.len()).sum::<usize>()
            + self.singletons.as_ref().map_or(0, |s| s.surfaces.len())
    }
}

/// Mount the per-output chrome (bar/osd/dock/toasts) on `output`. Called for every
/// output -- present at startup AND hotplugged -- via the [`Shell::on_output`] handler.
fn mount_output_chrome(
    control: &mut OutputControl<'_>,
    output: OutputId,
    bus: &ShellBus,
    tokens: theme::Tokens,
) -> anyhow::Result<OutputBundle> {
    let mut chrome = Vec::new();

    let (bar_id, bar_states) = control.create_on(
        output,
        bar_config(&tokens),
        |cx| provide_contexts(cx, bus, tokens),
        || ui::bar::bar().into_element(),
    )?;
    chrome.push(ChromeSurface { id: bar_id, states: bar_states, drawer_flag: None });

    let (osd_id, osd_states) = control.create_on(
        output,
        osd_config(),
        |cx| provide_contexts(cx, bus, tokens),
        || ui::osd::osd().into_element(),
    )?;
    chrome.push(ChromeSurface { id: osd_id, states: osd_states, drawer_flag: None });

    let (dock_id, dock_states) = control.create_on(
        output,
        dock_config(&tokens),
        |cx| provide_contexts(cx, bus, tokens),
        || ui::dock::dock().into_element(),
    )?;
    chrome.push(ChromeSurface { id: dock_id, states: dock_states, drawer_flag: None });

    let (toasts_id, (toast_states, drawer_flag)) = control.create_on(
        output,
        toasts_config(),
        |cx| provide_toast_contexts(cx, bus, tokens),
        || ui::notifications::toasts().into_element(),
    )?;
    chrome.push(ChromeSurface { id: toasts_id, states: toast_states, drawer_flag: Some(drawer_flag) });

    Ok(OutputBundle { chrome })
}

/// Mount ONE singleton surface on `output` and register it with the manager: the
/// dismiss layer (set_dismiss), or an on-demand reveal panel (register_reveal +
/// keyfeed). Returns the [`SingletonSurface`] record. Shared by [`mount_singletons`]
/// (the full startup/rebind set) and the per-surface recreate path (one closed
/// singleton), so both mint identical bookkeeping.
fn mount_one_singleton(
    control: &mut OutputControl<'_>,
    output: OutputId,
    role: SingletonRole,
    bus: &ShellBus,
    tokens: theme::Tokens,
    manager: &Rc<RefCell<Manager>>,
    registry: &Rc<RefCell<Registry>>,
) -> anyhow::Result<SingletonSurface> {
    match role {
        SingletonRole::Dismiss => {
            let (id, states) = control.create_on(
                output,
                dismiss_config(),
                |cx| provide_contexts(cx, bus, tokens),
                || ui::panels::dismiss().into_element(),
            )?;
            manager.borrow_mut().set_dismiss(id);
            Ok(SingletonSurface { role, id, states })
        }
        SingletonRole::Panel(key) => {
            let (id, (states, progress, keyfeed)) = control.create_on(
                output,
                panel_config(key, &tokens),
                |cx| provide_panel_contexts(cx, bus, tokens, key),
                move || match key {
                    SurfaceKey::Launcher => ui::launcher::launcher().into_element(),
                    SurfaceKey::Session => ui::session::session().into_element(),
                    SurfaceKey::QuickSettings => ui::quick_settings::quick_settings().into_element(),
                    SurfaceKey::Calendar => ui::calendar::calendar().into_element(),
                    SurfaceKey::Drawer => ui::notifications::drawer().into_element(),
                },
            )?;
            if let Some(feed) = keyfeed {
                registry.borrow_mut().keyfeeds.insert(id, feed);
            }
            // The drawer's reveal callback mirrors its open state into EVERY output's
            // toasts DrawerOpen flag (read live from the registry, so hotplugged outputs
            // are included and removed ones excluded), so toasts suppress while it is open.
            let write: Box<dyn FnMut(f32)> = if key == SurfaceKey::Drawer {
                let registry = registry.clone();
                let mut progress = progress;
                Box::new(move |value: f32| {
                    progress.set_if_modified(value);
                    let open = value > 0.001;
                    for bundle in registry.borrow().per_output.values() {
                        for surface in &bundle.chrome {
                            if let Some(mut flag) = surface.drawer_flag {
                                flag.set_if_modified(open);
                            }
                        }
                    }
                })
            } else {
                let mut progress = progress;
                Box::new(move |value: f32| {
                    progress.set_if_modified(value);
                })
            };
            manager.borrow_mut().register_reveal(key, id, kb_open(key), write);
            Ok(SingletonSurface { role, id, states })
        }
    }
}

/// Mount the singleton surfaces (dismiss layer + the five on-demand panels) on
/// `output` and register their reveals/dismiss/keyfeeds with the manager. Called on
/// the first output at startup and again on a surviving output if the primary dies.
/// Dismiss FIRST so it sits beneath the panels (created earliest = lowest).
fn mount_singletons(
    control: &mut OutputControl<'_>,
    output: OutputId,
    bus: &ShellBus,
    tokens: theme::Tokens,
    manager: &Rc<RefCell<Manager>>,
    registry: &Rc<RefCell<Registry>>,
) -> anyhow::Result<Singletons> {
    let mut surfaces = Vec::with_capacity(1 + SurfaceKey::ALL.len());
    surfaces.push(mount_one_singleton(
        control, output, SingletonRole::Dismiss, bus, tokens, manager, registry,
    )?);
    for key in SurfaceKey::ALL {
        surfaces.push(mount_one_singleton(
            control, output, SingletonRole::Panel(key), bus, tokens, manager, registry,
        )?);
    }
    Ok(Singletons { output, surfaces })
}

/// Handle an [`OutputEvent::SurfaceClosed`]: the compositor retired exactly ONE
/// surface (its output stays live). Drop just that surface's registry bookkeeping --
/// never the whole output bundle, which is reserved for real output death
/// ([`OutputEvent::Removed`]). Two paths, both kept in sync with the manager:
///
///  * Per-output chrome (bar/osd/dock/toasts): remove its [`ChromeSurface`] record
///    (its fan-out State + any DrawerOpen flag go with it) and rebuild the manager's
///    toast registration, which now excludes a closed toasts overlay.
///  * A singleton (launcher/quicksettings/calendar/drawer/session/dismiss): remove its
///    record + keyfeed, then recreate it on the primary output -- its own output if
///    still present, else the first surviving one -- so the persistent singleton comes
///    back. A recreated panel's `register_reveal` replaces the manager's stale reveal;
///    when no output is live or the recreate fails, a panel's reveal is replaced with
///    an INERT callback so the queued `CloseAll` never animates a dead `OpenProgress`
///    State. `CloseAll` then resets the one-open-at-a-time state (same policy as the
///    primary-death rebind).
///
/// Convergence never leans on mutter's close-before-global ordering: real output death
/// is owned by the Removed handler's wholesale rebind, and once a dying output's global
/// is gone `create_on` fails cleanly, so a recreate can never spin.
fn handle_surface_closed(
    control: &mut OutputControl<'_>,
    output: Option<OutputId>,
    surface: SurfaceId,
    bus: &ShellBus,
    tokens: theme::Tokens,
    manager: &Rc<RefCell<Manager>>,
    registry: &Rc<RefCell<Registry>>,
) {
    // Drop any keyfeed for the retired surface first (chrome has none; launcher /
    // session / quicksettings do) so key routing never points at a dead surface.
    registry.borrow_mut().keyfeeds.remove(&surface);

    // 1) Per-output chrome: drop just this surface's record from its bundle. The
    //    bundle and the other outputs' bundles stay; the wholesale drop is Removed's.
    let was_chrome = {
        let mut reg = registry.borrow_mut();
        let mut removed = false;
        for bundle in reg.per_output.values_mut() {
            if let Some(pos) = bundle.chrome.iter().position(|c| c.id == surface) {
                bundle.chrome.remove(pos); // drops SurfaceStates (+ DrawerOpen flag if toasts)
                removed = true;
                break;
            }
        }
        removed
    };
    if was_chrome {
        // A toasts overlay may have been the closed surface; rebuild the manager's
        // toast-surface list from the survivors (its DrawerOpen flag went with it).
        let ids = registry.borrow().toast_ids();
        manager.borrow_mut().register_toasts(ids);
        tracing::info!(
            "[shell] surface {surface:?} closed: dropped chrome bookkeeping (output {output:?})"
        );
        return;
    }

    // 2) Singleton: capture its role AND the registry's authoritative primary output
    //    (where every singleton lives), then drop its record.
    let (role, primary) = {
        let mut reg = registry.borrow_mut();
        let Some(singletons) = reg.singletons.as_mut() else {
            tracing::debug!("[shell] surface {surface:?} closed: no singletons registered");
            return;
        };
        let Some(pos) = singletons.surfaces.iter().position(|s| s.id == surface) else {
            tracing::debug!("[shell] surface {surface:?} closed: not a tracked surface");
            return;
        };
        let primary = singletons.output;
        (singletons.surfaces.remove(pos).role, primary) // drops its SurfaceStates
    };

    // Recreate on the shell's primary output (where the rest of the singletons live).
    // If that output is gone, the primary itself is dying: defer the restore to the
    // Removed handler's wholesale rebind rather than stranding this one singleton on a
    // survivor while the registry still records the primary as their host.
    if !control.remaining().contains(&primary) {
        tracing::info!(
            "[shell] singleton {surface:?} ({role:?}) closed but primary {primary:?} is gone; deferring restore to the output-removal rebind"
        );
        // Meanwhile leave a panel pointing at an inert reveal so the queued CloseAll
        // never animates its dead OpenProgress State (the rebind replaces it).
        if let SingletonRole::Panel(key) = role {
            manager.borrow_mut().register_reveal(key, surface, kb_open(key), Box::new(|_| {}));
            bus.send(ShellMsg::CloseAll);
        }
        return;
    }
    let target = primary;

    match mount_one_singleton(control, target, role, bus, tokens, manager, registry) {
        Ok(new_surface) => {
            let new_id = new_surface.id;
            if let Some(singletons) = registry.borrow_mut().singletons.as_mut() {
                singletons.surfaces.push(new_surface);
            }
            // A recreated panel's register_reveal replaced the stale reveal; reset the
            // manager's one-open-at-a-time state so the fresh (closed) reveal toggles
            // cleanly. The dismiss layer has no reveal state, so it needs no reset.
            if matches!(role, SingletonRole::Panel(_)) {
                bus.send(ShellMsg::CloseAll);
            }
            tracing::info!(
                "[shell] singleton {surface:?} ({role:?}) closed; recreated as {new_id:?} on {target:?}"
            );
        }
        Err(e) => {
            tracing::error!("[shell] recreate singleton {surface:?} ({role:?}) failed: {e:#}");
            // Replace the stale reveal with an inert one so CloseAll clears the
            // manager's open-state without writing a dead OpenProgress State.
            if let SingletonRole::Panel(key) = role {
                manager.borrow_mut().register_reveal(key, surface, kb_open(key), Box::new(|_| {}));
                bus.send(ShellMsg::CloseAll);
            }
        }
    }
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,kobel_shell=debug,kobel_wayland=debug".into()),
        )
        .init();

    // Accessibility + profiling flags, read once at startup. KOBEL_REDUCED_MOTION
    // makes every spring settle instantly (DESIGN.md accessibility contract);
    // KOBEL_PROFILE_ANIM turns on the reveal-spring trace + KOBEL_MOTION settle lines
    // (ports ags/lib/surface.ts). Plumbed into the motion global (UI spring hooks)
    // and the manager (reveal springs) below.
    let reduced_motion = matches!(std::env::var("KOBEL_REDUCED_MOTION").as_deref(), Ok("1"));
    let profile_anim = matches!(std::env::var("KOBEL_PROFILE_ANIM").as_deref(), Ok("1"));
    motion::set_reduced_motion(reduced_motion);
    if reduced_motion {
        tracing::info!("[motion] reduced motion enabled: springs settle instantly");
    }
    if profile_anim {
        tracing::info!("[trace] anim profiling enabled (KOBEL_PROFILE_ANIM=1)");
    }

    // The bus every surface + IPC uses to reach the manager.
    let (bus, bus_rx) = ShellBus::new();
    // Service snapshots flow UI-ward over this channel; the app tick drains it.
    let (snap_tx, snap_rx) = mpsc::channel::<ServiceEvent>();

    // The host. Fails cleanly without a compositor (e.g. WAYLAND_DISPLAY unset): log
    // and exit non-zero. The IPC/manager units are exercised by `cargo test` regardless.
    let mut shell = match Shell::new() {
        Ok(shell) => shell,
        Err(e) => {
            tracing::error!("[shell] cannot start Wayland host: {e:#}");
            std::process::exit(1);
        }
    };

    // Wake handle for producer threads. Installing it on the bus makes UI/IPC sends
    // wake the loop, so the app tick drains promptly instead of only on wl events.
    let waker = shell.waker();
    bus.install_waker({
        let waker = waker.clone();
        move || waker.wake()
    });

    let tokens = theme::FLOATING;

    // Services fan-out: runs on the services thread, pushes each snapshot UI-ward and
    // wakes the loop. Spawned before the manager, which owns the handle.
    let services = Services::spawn({
        let snap_tx = snap_tx.clone();
        let waker = waker.clone();
        move |event| {
            let _ = snap_tx.send(event);
            waker.wake();
        }
    });

    // The manager owns the services handle and drains the bus. Behind Rc<RefCell> so
    // both the app tick (ticks it) and the per-output handler (registers/re-registers
    // reveals + toasts as outputs come and go) reach it; both run on the one UI thread
    // and never re-enter each other, so the RefCell never conflicts.
    let manager = Rc::new(RefCell::new(Manager::new(bus_rx, services)));
    {
        let mut m = manager.borrow_mut();
        m.set_reduced_motion(reduced_motion);
        m.set_profile_anim(profile_anim);
    }

    // The shared per-output registry: service fan-out list + toasts/keyfeed
    // bookkeeping, kept in sync as outputs come and go.
    let registry: Rc<RefCell<Registry>> = Rc::new(RefCell::new(Registry::default()));

    // Per-output mount handler -- the single mount path for output-bound surfaces. The
    // host fires Added for every output present at startup AND every one hotplugged
    // later (mount its chrome; the first output also gets the singletons), and Removed
    // once an output goes away, AFTER it has torn that output's surfaces down. On
    // removal we drop the matching bookkeeping so no service snapshot is ever fanned
    // into a dead surface's State, and rebind the singletons if their host died.
    shell.on_output({
        let bus = bus.clone();
        let registry = registry.clone();
        let manager = manager.clone();
        move |event, control| match event {
            OutputEvent::Added(output) => {
                match mount_output_chrome(control, output, &bus, tokens) {
                    Ok(bundle) => {
                        let ids: Vec<SurfaceId> = bundle.chrome.iter().map(|c| c.id).collect();
                        tracing::info!("[shell] output {output:?} added: mounted chrome {ids:?}");
                        registry.borrow_mut().per_output.insert(output, bundle);
                    }
                    Err(e) => {
                        tracing::error!("[shell] output {output:?}: chrome mount failed: {e:#}");
                    }
                }
                // The first output to appear hosts the singletons (launcher, etc.).
                let want_singletons = registry.borrow().singletons.is_none();
                if want_singletons {
                    match mount_singletons(control, output, &bus, tokens, &manager, &registry) {
                        Ok(singletons) => {
                            tracing::info!("[shell] mounted singletons on primary {output:?}");
                            registry.borrow_mut().singletons = Some(singletons);
                        }
                        Err(e) => {
                            tracing::error!("[shell] output {output:?}: singleton mount failed: {e:#}");
                        }
                    }
                }
                let ids = registry.borrow().toast_ids();
                manager.borrow_mut().register_toasts(ids);
            }
            OutputEvent::SurfaceClosed { output, surface } => {
                handle_surface_closed(control, output, surface, &bus, tokens, &manager, &registry);
            }
            OutputEvent::Removed { output, retired } => {
                // Drop this output's chrome bundle -- its fan-out State handles go with
                // it, so no snapshot is ever written into the torn-down (dead) surfaces.
                // Dropping the Copy State handles is always safe (never a read/write).
                if registry.borrow_mut().per_output.remove(&output).is_some() {
                    tracing::info!("[shell] output {output:?} removed: dropped chrome bookkeeping");
                }
                // Clear keyfeeds for any retired surface (the singletons live here).
                {
                    let mut reg = registry.borrow_mut();
                    for id in &retired {
                        reg.keyfeeds.remove(id);
                    }
                }
                // Primary death: if this output hosted the singletons, rebind them to
                // the first surviving output (the simple policy, FREYA-PLAN 2.1). A
                // panel open at the moment of death is dropped; the fresh reveals all
                // start closed and CloseAll resets the manager's stale open state.
                let was_primary =
                    registry.borrow().singletons.as_ref().map(|s| s.output) == Some(output);
                if was_primary {
                    registry.borrow_mut().singletons = None;
                    match control.remaining().into_iter().next() {
                        Some(survivor) => {
                            match mount_singletons(control, survivor, &bus, tokens, &manager, &registry) {
                                Ok(singletons) => {
                                    registry.borrow_mut().singletons = Some(singletons);
                                    bus.send(ShellMsg::CloseAll);
                                    tracing::info!(
                                        "[shell] primary {output:?} died; rebound singletons to {survivor:?}"
                                    );
                                }
                                Err(e) => {
                                    tracing::error!("[shell] rebind singletons to {survivor:?} failed: {e:#}");
                                }
                            }
                        }
                        None => tracing::warn!(
                            "[shell] primary {output:?} died with no surviving output; singletons offline until an output returns"
                        ),
                    }
                }
                let ids = registry.borrow().toast_ids();
                manager.borrow_mut().register_toasts(ids);
            }
        }
    });

    tracing::info!("[shell] mounted {} surface(s)", registry.borrow().surface_count());

    // Route keyboard input by focus. While a keyboard-Exclusive surface (launcher /
    // session) holds focus, EVERY press -- including Escape -- goes into that surface's
    // KeyFeed and the surface decides (launcher Esc clears the query first, session Esc
    // disarms). While any other (OnDemand) surface holds focus, plain Escape means
    // CloseAll. A press whose surface has no KeyFeed mapping is an OnDemand surface.
    // Keyfeeds live in the shared registry so a primary-death rebind re-points them.
    shell.on_key({
        let bus = bus.clone();
        let registry = registry.clone();
        let mut seq: u64 = 0;
        move |press, _control| {
            let feed = registry.borrow().keyfeeds.get(&press.surface).copied();
            if let Some(mut feed) = feed {
                seq += 1;
                feed.set(Some(ui::panels::KeyEvent { seq, press }));
            } else if press.is_escape() {
                bus.send(ShellMsg::CloseAll);
            }
        }
    });

    // App tick: drain service snapshots into every live surface's State, then tick the
    // manager. Runs on the UI thread at the start of each sweep, before surfaces are
    // pumped. The registry borrow is scoped and released before the manager tick so
    // the drawer's reveal callback (which reads the registry) never double-borrows.
    shell.on_tick({
        let registry = registry.clone();
        let manager = manager.clone();
        move |control| {
            {
                let reg = registry.borrow();
                while let Ok(event) = snap_rx.try_recv() {
                    for surface in reg.all_states() {
                        match &event {
                            ServiceEvent::Gnoblin(snapshot) => {
                                let mut handle = surface.gnoblin;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Audio(snapshot) => {
                                let mut handle = surface.audio;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Battery(snapshot) => {
                                let mut handle = surface.battery;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Apps(snapshot) => {
                                let mut handle = surface.apps;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Media(snapshot) => {
                                let mut handle = surface.media;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Network(snapshot) => {
                                let mut handle = surface.network;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Bluetooth(snapshot) => {
                                let mut handle = surface.bluetooth;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Brightness(snapshot) => {
                                let mut handle = surface.brightness;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Power(snapshot) => {
                                let mut handle = surface.power;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Settings(snapshot) => {
                                let mut handle = surface.settings;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Notifd(snapshot) => {
                                let mut handle = surface.notifd;
                                handle.set_if_modified(snapshot.clone());
                            }
                            ServiceEvent::Tray(snapshot) => {
                                let mut handle = surface.tray;
                                handle.set_if_modified(snapshot.clone());
                            }
                        }
                    }
                }
            }
            if manager.borrow_mut().tick(control) {
                tracing::info!("[shell] exit requested");
                control.exit();
            }
        }
    });

    // IPC control socket. Runs on its own thread; only sends over the bus (which wakes
    // us). Failure to bind is non-fatal -- the shell still runs, just without kobelctl.
    let socket = match ipc::serve(bus.clone()) {
        Ok(path) => Some(path),
        Err(e) => {
            tracing::warn!("[ipc] control socket unavailable: {e}");
            None
        }
    };

    tracing::info!("[shell] running");
    let result = shell.run();

    // Remove our control socket on a clean exit.
    if let Some(path) = socket {
        let _ = std::fs::remove_file(&path);
    }
    result
}
