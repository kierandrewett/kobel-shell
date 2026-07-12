// spike.rs -- Phase 0 feasibility gate (docs/FREYA-PLAN.md section 7).
//
// One wlr-layer-shell surface anchored TOP+LEFT+RIGHT, ~120px tall, namespace
// "kobel-spike", rendering a Freya UI with:
//   * an animated rect (freya-animation AnimNum, looping via OnFinish::reverse),
//   * a label counter incremented by an on_press Button,
//   * a live scale / fps / frame-time readout (from the host's FrameStats context).
// Key handling: Esc exits cleanly; 'k' cycles keyboard-interactivity
// None -> OnDemand -> Exclusive (logged). Frame times are logged via [spike].
//
// Cannot be run here (no compositor); the orchestrator runs it in the gnoblin devkit.

use freya_animation::prelude::*;
use freya_components::button::Button;
use freya_core::prelude::*;
use kobel_wayland::{
    Anchor, Control, FrameStats, KeyPress, KeyboardInteractivity, Layer, Margins, Shell,
    SurfaceConfig, SurfaceSize,
};
use torin::prelude::{Alignment, Size};

fn spike_ui() -> impl IntoElement {
    let mut count = use_state(|| 0i32);
    let stats = use_consume::<State<FrameStats>>();

    // Looping numeric animation (0 -> 1 -> 0 ...), duration + easing (no springs here;
    // springs are the shell's own motion module). Drives the moving/hue-shifting rect.
    let animation = use_animation(|conf| {
        conf.on_creation(OnCreation::Run);
        conf.on_finish(OnFinish::reverse());
        AnimNum::new(0.0, 1.0).time(1200)
    });
    let t = animation.get().value();
    let stats = stats.read();

    let bar_width = 40.0 + t * 320.0;
    let hue = (60.0 + t * 160.0) as u8;

    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background((16, 14, 20))
        .horizontal()
        .main_align(Alignment::center())
        .cross_align(Alignment::center())
        .spacing(16.0)
        // Whole-strip press target. The phase-0 input gate only cares that a
        // wl_pointer press reaches a Freya on_press handler, not pixel-perfect aim at
        // the (animating, moving) button. Making the root rect pressable lets the
        // headless injector click anywhere on the ~1256x120 surface and still exercise
        // the press path; 'k'/Esc keyboard assertions stay strict.
        .on_press(move |_| {
            let n = {
                let mut c = count.write();
                *c += 1;
                *c
            };
            tracing::info!("[spike] pressed count={n}");
        })
        .child(
            rect()
                .width(Size::px(bar_width))
                .height(Size::px(28.0))
                .corner_radius(14.0)
                .background((hue, 120, 220)),
        )
        .child(
            Button::new()
                .on_press(move |_| {
                    let n = {
                        let mut c = count.write();
                        *c += 1;
                        *c
                    };
                    tracing::info!("[spike] pressed count={n}");
                })
                .child(format!("count: {}", count.read())),
        )
        .child(
            label()
                .text(format!(
                    "scale {:.0}   fps {:.0}   {:.1} ms",
                    stats.scale, stats.fps, stats.last_frame_ms
                ))
                .color((220, 220, 232)),
        )
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,kobel_wayland=debug".into()),
        )
        .init();

    let mut shell = Shell::new()?;

    let config = SurfaceConfig::new("kobel-spike", SurfaceSize::Exact { width: 0, height: 120 })
        .layer(Layer::Top)
        .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
        .margins(Margins { top: 10, right: 12, bottom: 0, left: 12 })
        .exclusive_zone(0)
        .keyboard_interactivity(KeyboardInteractivity::OnDemand);

    shell.create_surface(config, || spike_ui().into_element())?;

    // Esc exits; 'k' cycles keyboard interactivity. The current mode is tracked here.
    let mut current = KeyboardInteractivity::OnDemand;
    shell.on_key(move |press: KeyPress, control: &mut Control<'_>| {
        match &press.key {
            Key::Named(NamedKey::Escape) => {
                tracing::info!("[spike] Esc -> exit");
                control.exit();
            }
            Key::Character(c) if c == "k" && !press.repeat => {
                current = match current {
                    KeyboardInteractivity::None => KeyboardInteractivity::OnDemand,
                    KeyboardInteractivity::OnDemand => KeyboardInteractivity::Exclusive,
                    KeyboardInteractivity::Exclusive => KeyboardInteractivity::None,
                    _ => KeyboardInteractivity::OnDemand,
                };
                tracing::info!("[spike] 'k' -> keyboard interactivity {current:?}");
                control.set_keyboard_interactivity(press.surface, current);
            }
            _ => {}
        }
    });

    tracing::info!("[spike] running; Esc to exit, 'k' to cycle keyboard interactivity");
    shell.run()
}
