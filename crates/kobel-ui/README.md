# kobel-ui

This is the human-owned UI crate for kobel-shell. It is deliberately empty: `app()` returns one unstyled Freya `rect`, and the production `main` creates no Wayland surfaces.

The core crates should stay free of presentation decisions:

| Crate | What to use it for |
|---|---|
| `kobel-ui` | Freya elements, themes, icons, surface layout and interaction design |
| `kobel-shell` | Optional reveal manager, `ShellBus`, IPC server and spring primitives |
| `kobel-wayland` | Embedded Freya runtime, layer surfaces, input, popups, output lifecycle and rendering |
| `kobel-services` | System snapshots and typed commands |
| `kobel-ipc` | Control socket path and the independent `kobelctl` binary |

The removed UI is available under `archive/freya-ui-v1`, but it is reference material rather than a template.

## Start with a normal window

Build the first components in `src/lib.rs`. The `preview` binary runs the same `app()` root in a normal winit window, which gives you Freya's stock developer tools without adding winit to the production layer-shell path.

Install the matching devtools application once:

```sh
cargo install --git https://github.com/marc2332/freya \
  --rev 5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6 \
  --locked freya-devtools-app
```

Run the preview and inspector in separate terminals:

```sh
cargo run -p kobel-ui --bin preview --features devtools
freya-devtools-app
```

The inspector connects to port 7354 automatically. Only one devtools-enabled Freya process can use that port at a time.

The preview's winit dependency is feature-gated. A normal `cargo build -p kobel-ui` does not enable it.

## Mount the first layer surface

Once a component is useful in the preview, replace the empty production `main` with an explicit surface configuration. Start with one surface and keep its geometry beside the UI that owns it:

```rust
use kobel_wayland::{Anchor, Shell, SurfaceConfig, SurfaceSize};

fn main() -> anyhow::Result<()> {
    let mut shell = Shell::new()?;
    shell.create_surface(
        SurfaceConfig::new(
            "kobel-first-surface",
            SurfaceSize::Exact {
                width: 420,
                height: 240,
            },
        )
        .anchor(Anchor::TOP | Anchor::RIGHT),
        kobel_ui::app,
    )?;
    shell.run()
}
```

This is only host wiring. Choose the namespace, size, anchor, margins, layer, keyboard mode, exclusive zone and input region based on the surface you are actually designing. `kobel-wayland::SurfaceConfig` is the source of truth for those options.

Use `Shell::on_output` plus `OutputControl::create_on` for per-output surfaces. Use `Shell::on_tick` to drain service events or a `kobel_shell::ShellBus` on the Wayland thread. The host's working embedded-runtime reference is `crates/kobel-wayland`; upstream's minimal embedding example is [feature_embedded.rs](https://github.com/marc2332/freya/blob/5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6/examples/feature_embedded.rs).

## Add system state

`kobel-services` emits plain snapshots from background threads. Wake the Wayland loop after forwarding an event, then write Freya state only from `Shell::on_tick`:

```rust
let waker = shell.waker();
let services = kobel_services::Services::spawn(move |event| {
    // Send `event` through your channel first.
    waker.wake();
});
```

Keep `services` alive for the life of the UI. Send typed `kobel_services::Command` values through its handle rather than spawning shell commands from Freya elements.

`kobel_shell::Manager` is optional. Use it if the UI wants one warm-mapped reveal open at a time. Surface names are chosen by this crate and parsed with `SurfaceKey`; the core no longer prescribes launcher, calendar or panel names. If the UI needs a different visibility model, drive `kobel-wayland::Control` directly rather than extending the core with UI policy.

## Test components without a compositor

`freya-testing` is already configured as a development dependency. The starter smoke test shows the minimum setup:

```sh
cargo test -p kobel-ui
```

Use `TestingRunner` for state transitions, pointer and keyboard interactions, and rendered snapshots. Tests should assert user-visible behaviour rather than source structure.

For the real embedded host, use the existing gnoblin spike:

```sh
./scripts/run-spike-in-gnoblin.sh
INPUT_TEST=1 ./scripts/run-spike-in-gnoblin.sh
```

## Devtools limitation

Freya 0.4.0-rc.24 implements `freya-devtools::DevtoolsPlugin` against `freya-winit` types, including winit `WindowId` and `EventLoopProxy`. It cannot attach directly to kobel's custom layer-shell host without porting that protocol into `kobel-wayland` or changing Freya upstream.

That is why this crate keeps two deliberate paths:

- `preview --features devtools` for the stock component-tree inspector
- `kobel-wayland` for the real no-winit layer-shell runtime

Do not enable the devtools feature in the production binary and do not add the `freya` facade to `kobel-wayland`.

## Useful source references

- `crates/kobel-wayland/src/lib.rs`: public surface configuration and host types
- `crates/kobel-wayland/src/conn.rs`: output, tick, keyboard and IME callbacks
- `crates/kobel-services/src/lib.rs`: snapshots, commands and service lifecycle
- `crates/kobel-shell/src/lib.rs`: UI-neutral shell helpers
- [Freya examples at the pinned revision](https://github.com/marc2332/freya/tree/5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6/examples)
- [Freya devtools documentation](https://github.com/marc2332/freya/blob/5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6/crates/freya/src/_docs/devtools.rs)
