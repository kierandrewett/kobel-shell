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

use std::collections::HashMap;
use std::sync::mpsc;

use freya_core::prelude::{IntoElement, State, WritableUtils};
use kobel_services::{
    AppsSnapshot, AudioSnapshot, BatterySnapshot, BluetoothSnapshot, BrightnessSnapshot,
    GnoblinSnapshot, MediaSnapshot, NetworkSnapshot, NotifdSnapshot, PowerSnapshot, ServiceEvent,
    Services, SettingsSnapshot, TraySnapshot,
};
use kobel_wayland::{
    Anchor, KeyboardInteractivity, Layer, Margins, Shell, SurfaceConfig, SurfaceContexts,
    SurfaceId, SurfaceSize,
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
/// reveal). Widths come from theme tokens; heights are fixed placeholders for this
/// wave (the real surfaces size to content later). An axis anchored to both opposite
/// edges uses size 0 so the compositor fills it (as the bar does for width).
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
            SurfaceSize::Exact { width: t.launcher_w as u32, height: 480 },
        )
        .anchor(Anchor::TOP)
        .margins(Margins { top: 56, right: 0, bottom: 0, left: 0 }),
        // TOP+RIGHT.
        SurfaceKey::QuickSettings => base(
            "kobel-qs",
            SurfaceSize::Exact { width: t.panel_w as u32, height: 520 },
        )
        .anchor(Anchor::TOP | Anchor::RIGHT)
        .margins(Margins { top: panel_top, right: edge, bottom: 0, left: 0 }),
        // TOP (centered).
        SurfaceKey::Calendar => base(
            "kobel-calendar",
            // Height fits the six-week grid + events card with headroom for a
            // two-event day (measured sheet content ~372px for one event, ~422px
            // for two); the phase-1 host has no ContentSized, so this is fixed.
            SurfaceSize::Exact { width: t.calendar_w as u32, height: 432 },
        )
        .anchor(Anchor::TOP)
        .margins(Margins { top: panel_top, right: 0, bottom: 0, left: 0 }),
        // TOP+RIGHT+BOTTOM full-height right rail (ags marginRight=12 only): the top
        // and bottom anchors fill the height axis (size 0), and the compositor already
        // seats it below the bar's exclusive zone, so only the right inset is set.
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

    // Bar: per-output, top layer, anchored TOP|LEFT|RIGHT. Margins are the FLOATING gap
    // (top) and edge (sides); the exclusive zone reserves gap + bar_h so tiled windows
    // sit below it; height is bar_h.
    let bar_h = tokens.bar_h as u32;
    let bar_cfg = SurfaceConfig::new("kobel-bar", SurfaceSize::Exact { width: 0, height: bar_h })
        .layer(Layer::Top)
        .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
        .margins(Margins {
            top: tokens.gap as i32,
            right: tokens.edge as i32,
            bottom: 0,
            left: tokens.edge as i32,
        })
        .exclusive_zone(tokens.gap as i32 + bar_h as i32)
        .keyboard_interactivity(KeyboardInteractivity::None);

    // OSD: per-output, bottom-anchored, 72px up, fixed ~230x44, display-only (empty
    // input region -> click-through). ContentSized isn't supported by the phase-1 host.
    let osd_cfg = SurfaceConfig::new("kobel-osd", SurfaceSize::Exact { width: 230, height: 44 })
        .layer(Layer::Top)
        .anchor(Anchor::BOTTOM)
        .margins(Margins { top: 0, right: 0, bottom: 72, left: 0 })
        .keyboard_interactivity(KeyboardInteractivity::None)
        .input_region_empty(true);

    // Dock: per-output, bottom-anchored, `gap` up. Width is computed from the pin
    // count (pins + media tile + separator + paddings/spacing via tokens); top layer,
    // no keyboard. The exclusive zone reserves gap + dock height at the bottom edge
    // so maximized/tiled windows sit ABOVE the floating dock instead of extending
    // under it (mirrors the bar's margin + slab pattern). This is a deliberate change
    // from the AGS dock, which floated with no exclusive zone.
    let dock_pin_count = ui::dock::pins().len();
    let dock_h = ui::dock::dock_height(&tokens);
    let dock_cfg = SurfaceConfig::new(
        "kobel-dock",
        SurfaceSize::Exact {
            width: ui::dock::dock_width(&tokens, dock_pin_count),
            height: dock_h,
        },
    )
    .layer(Layer::Top)
    .anchor(Anchor::BOTTOM)
    .margins(Margins { top: 0, right: 0, bottom: tokens.gap as i32, left: 0 })
    .exclusive_zone(tokens.gap as i32 + dock_h as i32)
    .keyboard_interactivity(KeyboardInteractivity::None);

    // Toasts: per-output, top-right, below the bar (ags marginTop 58 / marginRight
    // 12). Top layer, no keyboard, NO exclusive zone. Input region EMPTY: a fixed
    // surface with a full region would eat clicks over its whole rect even with no
    // visible toast, so toasts are display-only this phase (dismiss/actions live in
    // the drawer). TODO: flip the region dynamically with toast visibility so toast
    // close buttons work (needs a UI -> manager visibility bridge).
    let toasts_cfg = SurfaceConfig::new(
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
    .input_region_empty(true);

    let mut states: Vec<SurfaceStates> = Vec::new();

    let bars = shell.create_surface_on_outputs(
        bar_cfg,
        |cx| provide_contexts(cx, &bus, tokens),
        || ui::bar::bar().into_element(),
    )?;
    states.extend(bars.into_iter().map(|(_, s)| s));

    let osds = shell.create_surface_on_outputs(
        osd_cfg,
        |cx| provide_contexts(cx, &bus, tokens),
        || ui::osd::osd().into_element(),
    )?;
    states.extend(osds.into_iter().map(|(_, s)| s));

    let docks = shell.create_surface_on_outputs(
        dock_cfg,
        |cx| provide_contexts(cx, &bus, tokens),
        || ui::dock::dock().into_element(),
    )?;
    states.extend(docks.into_iter().map(|(_, s)| s));

    // Toasts per-output. Collect each surface's DrawerOpen flag so the drawer's
    // reveal callback can suppress toasts while the drawer is open.
    let mut toast_drawer_flags: Vec<State<bool>> = Vec::new();
    let toasts = shell.create_surface_on_outputs(
        toasts_cfg,
        |cx| provide_toast_contexts(cx, &bus, tokens),
        || ui::notifications::toasts().into_element(),
    )?;
    for (_, (surface_states, drawer_open)) in toasts {
        states.push(surface_states);
        toast_drawer_flags.push(drawer_open);
    }

    // On-demand singletons + dismiss layer (docs/FREYA-PLAN.md 2.4, 6). Each is
    // created once and stays mapped forever (the warm-open trick): closed = opacity 0
    // + empty input region + keyboard None; the manager reveals them on demand.
    //
    // The dismiss layer is created FIRST so it sits beneath the panels: an open panel
    // receives its own clicks, while a click outside falls through to the dismiss
    // layer (which closes everything). Its input region stays empty until a surface
    // opens. Per the frozen contract it gets the same base contexts as every surface.
    let dismiss_cfg = SurfaceConfig::new("kobel-dismiss", SurfaceSize::Exact { width: 0, height: 0 })
        .layer(Layer::Top)
        .anchor(Anchor::TOP | Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT)
        .keyboard_interactivity(KeyboardInteractivity::None)
        .input_region_empty(true);
    let (dismiss_id, dismiss_states) = shell.create_singleton_surface(
        dismiss_cfg,
        |cx| provide_contexts(cx, &bus, tokens),
        || ui::panels::dismiss().into_element(),
    )?;
    states.push(dismiss_states);

    // The five on-demand surfaces. Each provides the frozen contexts plus its
    // additive OpenProgress; we keep (key, id, kb-when-open, progress) to build the
    // reveal registry once the manager exists.
    let mut reveal_regs: Vec<(SurfaceKey, SurfaceId, KeyboardInteractivity, State<f32>)> =
        Vec::new();
    // The focused Exclusive surface's KeyFeed, keyed by surface id, so the app-level
    // key handler can route every press into whichever surface holds the keyboard.
    let mut keyfeeds: HashMap<SurfaceId, State<Option<ui::panels::KeyEvent>>> = HashMap::new();
    for key in SurfaceKey::ALL {
        let cfg = panel_config(key, &tokens);
        let (id, (surface_states, progress, keyfeed)) = shell.create_singleton_surface(
            cfg,
            |cx| provide_panel_contexts(cx, &bus, tokens, key),
            move || match key {
                SurfaceKey::Launcher => ui::launcher::launcher().into_element(),
                SurfaceKey::Session => ui::session::session().into_element(),
                SurfaceKey::QuickSettings => ui::quick_settings::quick_settings().into_element(),
                SurfaceKey::Calendar => ui::calendar::calendar().into_element(),
                SurfaceKey::Drawer => ui::notifications::drawer().into_element(),
            },
        )?;
        states.push(surface_states);
        reveal_regs.push((key, id, kb_open(key), progress));
        if let Some(feed) = keyfeed {
            keyfeeds.insert(id, feed);
        }
    }

    tracing::info!("[shell] mounted {} surface(s)", states.len());

    // Services fan-out: runs on the services thread, pushes each snapshot UI-ward and
    // wakes the loop.
    let services = Services::spawn({
        let snap_tx = snap_tx.clone();
        let waker = waker.clone();
        move |event| {
            let _ = snap_tx.send(event);
            waker.wake();
        }
    });

    // The manager owns the services handle (keeping it alive for the loop's lifetime)
    // and drains the bus.
    let mut manager = Manager::new(bus_rx, services);
    manager.set_reduced_motion(reduced_motion);
    manager.set_profile_anim(profile_anim);
    manager.set_dismiss(dismiss_id);
    for (key, id, kb, progress) in reveal_regs {
        // The drawer's reveal callback also mirrors its open state into every toasts
        // surface's DrawerOpen flag, so toasts suppress while the drawer is open.
        let write: Box<dyn FnMut(f32)> = if key == SurfaceKey::Drawer {
            let flags = std::mem::take(&mut toast_drawer_flags);
            let mut progress = progress;
            Box::new(move |value: f32| {
                progress.set_if_modified(value);
                let open = value > 0.001;
                for flag in &flags {
                    let mut flag = *flag;
                    flag.set_if_modified(open);
                }
            })
        } else {
            let mut progress = progress;
            Box::new(move |value: f32| {
                progress.set_if_modified(value);
            })
        };
        manager.register_reveal(key, id, kb, write);
    }

    // Route keyboard input by focus. While a keyboard-Exclusive surface (launcher /
    // session) holds focus, EVERY press -- including Escape -- goes into that surface's
    // KeyFeed and the surface decides (launcher Esc clears the query first, session Esc
    // disarms). While any other (OnDemand) surface holds focus, plain Escape means
    // CloseAll. The host only calls this while one of our surfaces has keyboard focus,
    // so a press whose surface has no KeyFeed mapping is an OnDemand surface.
    shell.on_key({
        let bus = bus.clone();
        let mut seq: u64 = 0;
        move |press, _control| {
            if let Some(mut feed) = keyfeeds.get(&press.surface).copied() {
                seq += 1;
                feed.set(Some(ui::panels::KeyEvent { seq, press }));
            } else if press.is_escape() {
                bus.send(ShellMsg::CloseAll);
            }
        }
    });

    // App tick: drain service snapshots into every surface's State, then drain the bus.
    // Runs on the UI thread at the start of each sweep, before surfaces are pumped.
    shell.on_tick(move |control| {
        while let Ok(event) = snap_rx.try_recv() {
            for surface in &states {
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
        if manager.tick(control) {
            tracing::info!("[shell] exit requested");
            control.exit();
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
