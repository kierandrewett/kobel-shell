// This example path-includes the whole shell `ui`/`theme`/`motion`/`manager`
// module tree but only renders quicksettings/calendar, so most of it is
// legitimately unused here; silence the resulting dead-code noise crate-wide.
#![allow(dead_code, unused_imports)]

//! render-panel: a headless, compositor-free renderer for a single shell surface
//! body, used to iterate on Torin layout without a live Wayland session.
//!
//! It embeds Freya directly from `freya-core` (the `examples/feature_embedded.rs`
//! pattern: `Runner` + `Tree` + `measure_layout` + `RenderPipeline` into a Skia
//! raster surface) and provides the same root contexts main.rs gives every
//! surface, seeded with plausible fake snapshots (Wi-Fi with 3 APs, Bluetooth
//! with 2 devices, battery present, audio 0.7, dark style on, FLOATING tokens,
//! OpenProgress = 1.0 so the sheet renders fully open, a dummy ShellBus, and an
//! empty KeyFeed). Icons render through `SvgViewer`, which needs `Platform` and
//! `AssetCacher` root contexts, so a minimal stub `Platform` (plus a rendering
//! ticker and animation clock so springs never panic if they run) is provided.
//!
//!   cargo run -p kobel-shell --example render-panel -- <panel> <out.png> <WxH>
//! where <panel> is `bar`, `quicksettings`, or `calendar`, e.g.
//!   cargo run -p kobel-shell --example render-panel -- bar /tmp/bar.png 1000x42
//!   cargo run -p kobel-shell --example render-panel -- quicksettings /tmp/qs.png 365x520
//!   cargo run -p kobel-shell --example render-panel -- calendar /tmp/cal.png 336x432
//!
//! This is a dev tool, not part of the shell binary. It path-includes the shell's
//! source modules (kobel-shell is a bin crate with no lib target) so `crate::theme`
//! / `crate::manager` references inside `ui/*` resolve unchanged.

#[path = "../src/theme.rs"]
mod theme;
#[path = "../src/motion.rs"]
mod motion;
#[path = "../src/manager.rs"]
mod manager;
#[path = "../src/ui/mod.rs"]
mod ui;

use std::rc::Rc;

use freya_core::{integration::*, prelude::*};
use freya_engine::prelude::{
    EncodedImageFormat, FontCollection, FontMgr, TypefaceFontProvider, raster_n32_premul,
};
use freya_components::cache::AssetCacher;
use futures_channel::mpsc::unbounded;
use torin::prelude::Size2D;

use kobel_services::{
    AccessPointInfo, AudioSnapshot, AudioStream, BatterySnapshot, BluetoothSnapshot, BtDevice,
    BrightnessSnapshot, GnoblinSnapshot, NetworkSnapshot, NotifdSnapshot, PowerProfile,
    PowerSnapshot, SettingsSnapshot, TraySnapshot,
};

use crate::manager::ShellBus;
use crate::ui::panels::{KeyFeed, OpenProgress};

#[derive(Clone, Copy)]
enum Panel {
    Bar,
    QuickSettings,
    Calendar,
}

fn fake_gnoblin() -> GnoblinSnapshot {
    GnoblinSnapshot { connected: true, windows: Vec::new() }
}

fn fake_audio() -> AudioSnapshot {
    AudioSnapshot {
        volume: 0.7,
        muted: false,
        streams: vec![
            AudioStream { id: 1, name: "Firefox".into(), volume: 0.5, muted: false },
            AudioStream { id: 2, name: "Spotify".into(), volume: 0.8, muted: false },
        ],
    }
}

fn fake_battery() -> BatterySnapshot {
    BatterySnapshot {
        present: true,
        percentage: 82.0,
        charging: false,
        state: 2, // discharging
        time_to_empty: 7200,
        time_to_full: 0,
    }
}

fn fake_network() -> NetworkSnapshot {
    NetworkSnapshot {
        available: true,
        enabled: true,
        active_ssid: Some("HomeNet".into()),
        active_strength: 78,
        aps: vec![
            AccessPointInfo { ssid: "HomeNet".into(), strength: 78, active: true, secured: true },
            AccessPointInfo { ssid: "Cafe Wifi".into(), strength: 54, active: false, secured: false },
            AccessPointInfo { ssid: "Neighbor 5G".into(), strength: 31, active: false, secured: true },
        ],
    }
}

fn fake_bluetooth() -> BluetoothSnapshot {
    BluetoothSnapshot {
        available: true,
        powered: true,
        devices: vec![
            BtDevice {
                address: "AA:BB:CC:DD:EE:FF".into(),
                alias: "Pixel Buds".into(),
                connected: true,
                paired: true,
            },
            BtDevice {
                address: "11:22:33:44:55:66".into(),
                alias: "Keyboard K3".into(),
                connected: false,
                paired: true,
            },
        ],
    }
}

fn fake_brightness() -> BrightnessSnapshot {
    BrightnessSnapshot { available: true, level: 0.6 }
}

fn fake_power() -> PowerSnapshot {
    PowerSnapshot { available: true, profile: PowerProfile::Balanced }
}

fn fake_settings() -> SettingsSnapshot {
    SettingsSnapshot { dark_style: true, night_light: false }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!(
            "usage: render-panel <bar|quicksettings|calendar> <out.png> <WxH>\n\
             e.g.   render-panel bar /tmp/bar.png 1000x42"
        );
        std::process::exit(2);
    }

    let panel = match args[1].as_str() {
        "bar" => Panel::Bar,
        "quicksettings" | "qs" => Panel::QuickSettings,
        "calendar" | "cal" => Panel::Calendar,
        other => {
            eprintln!("unknown panel {other:?}; expected bar|quicksettings|calendar");
            std::process::exit(2);
        }
    };
    let out = args[2].clone();
    let (w, h) = args[3]
        .split_once('x')
        .and_then(|(w, h)| Some((w.parse::<f32>().ok()?, h.parse::<f32>().ok()?)))
        .unwrap_or_else(|| {
            eprintln!("bad size {:?}; expected WxH like 365x520", args[3]);
            std::process::exit(2);
        });

    let size = Size2D::new(w, h);
    let scale_factor = 1.0f64;

    // Dummy bus: keep the receiver alive so sends never error; nothing drains it.
    let (bus, _bus_rx) = ShellBus::new();

    let (events_sender, mut events_receiver) = unbounded();

    let mut runner = Runner::new(move || match panel {
        Panel::Bar => ui::bar::bar().into_element(),
        Panel::QuickSettings => ui::quick_settings::quick_settings().into_element(),
        Panel::Calendar => ui::calendar::calendar().into_element(),
    });

    // --- Render-critical contexts (SvgViewer needs Platform + AssetCacher). ---
    runner.provide_root_context(AssetCacher::create);
    let (_ticker_tx, ticker) = RenderingTicker::new();
    runner.provide_root_context(|| ticker);
    runner.provide_root_context(AnimationClock::new);
    runner.provide_root_context(move || Platform {
        focused_accessibility_id: State::create(ACCESSIBILITY_ROOT_ID),
        focused_accessibility_node: State::create(Default::default()),
        root_size: State::create(size),
        scale_factor: State::create(scale_factor),
        navigation_mode: State::create(Default::default()),
        preferred_theme: State::create(PreferredTheme::Dark),
        is_app_focused: State::create(true),
        accent_color: State::create(Default::default()),
        sender: Rc::new(|_ev: UserEvent| {}),
    });

    // --- The frozen per-surface contexts main.rs provides, with fakes. ---
    runner.provide_root_context(|| State::create(theme::FLOATING));
    runner.provide_root_context(|| State::create(fake_gnoblin()));
    runner.provide_root_context(|| State::create(fake_audio()));
    runner.provide_root_context(|| State::create(fake_battery()));
    runner.provide_root_context(|| State::create(fake_network()));
    runner.provide_root_context(|| State::create(fake_bluetooth()));
    runner.provide_root_context(|| State::create(fake_brightness()));
    runner.provide_root_context(|| State::create(fake_power()));
    runner.provide_root_context(|| State::create(fake_settings()));
    runner.provide_root_context(|| State::create(NotifdSnapshot::default()));
    runner.provide_root_context(|| State::create(TraySnapshot::default()));
    runner.provide_root_context(|| bus.clone());
    runner.provide_root_context(|| OpenProgress(State::create(1.0)));
    runner.provide_root_context(|| KeyFeed(State::create(None::<crate::ui::panels::KeyEvent>)));

    // --- Fonts (mirrors feature_embedded.rs / freya-testing). ---
    let mut font_collection = FontCollection::new();
    let default_font_manager = FontMgr::default();
    let dynamic_font_manager: FontMgr = TypefaceFontProvider::new().into();
    font_collection.set_default_font_manager(default_font_manager, None);
    font_collection.set_dynamic_font_manager(dynamic_font_manager.clone());
    let default_fonts = default_fonts();

    let mut tree = Tree::default();

    // Advance several frames: SvgViewer rasterizes synchronously but the first
    // frame still matches the pre-update Pending asset, so cached icons only paint
    // on a later frame. Three sync+measure cycles is plenty.
    for _ in 0..3 {
        let mutations = runner.sync_and_update();
        runner.run_in(|| tree.apply_mutations(mutations));
        tree.measure_layout(
            size,
            &mut font_collection,
            &dynamic_font_manager,
            &events_sender,
            scale_factor,
            &default_fonts,
        );
        while events_receiver.try_recv().is_ok() {}
    }

    // --- Render into a CPU raster surface and encode a PNG. ---
    let mut surface = raster_n32_premul((w as i32, h as i32))
        .expect("failed to create raster surface");
    RenderPipeline {
        font_collection: &mut font_collection,
        font_manager: &dynamic_font_manager,
        tree: &tree,
        canvas: surface.canvas(),
        scale_factor,
        background: Color::from_rgb(24, 24, 28),
    }
    .render();

    let image = surface.image_snapshot();
    let mut ctx = surface.direct_context();
    let data = image
        .encode(ctx.as_mut(), EncodedImageFormat::PNG, None)
        .expect("failed to encode PNG");
    std::fs::write(&out, data.as_bytes()).expect("failed to write PNG");
    println!("wrote {out} ({w}x{h})");
}
