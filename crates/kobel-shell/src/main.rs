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

use std::sync::mpsc;

use freya_core::prelude::{IntoElement, State, WritableUtils};
use kobel_services::{AudioSnapshot, BatterySnapshot, GnoblinSnapshot, ServiceEvent, Services};
use kobel_wayland::{
    Anchor, KeyboardInteractivity, Layer, Margins, Shell, SurfaceConfig, SurfaceContexts,
    SurfaceSize,
};

use crate::manager::{Manager, ShellBus};

/// The per-surface State handles the app tick fans service snapshots into. Tokens is
/// static, so we do not keep its handle; only the three live snapshots change.
struct SurfaceStates {
    gnoblin: State<GnoblinSnapshot>,
    audio: State<AudioSnapshot>,
    battery: State<BatterySnapshot>,
}

/// Provide the five frozen root contexts on a surface and return the mutable snapshot
/// handles. Called once per surface at creation. The exact context set is the frozen
/// contract in manager.rs: State<Gnoblin/Audio/Battery Snapshot>, State<Tokens>, ShellBus.
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
    cx.provide(|| State::create(tokens));
    cx.provide(|| bus.clone());
    SurfaceStates { gnoblin, audio, battery }
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,kobel_shell=debug,kobel_wayland=debug".into()),
        )
        .init();

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
                }
            }
        }
        if manager.drain() {
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
