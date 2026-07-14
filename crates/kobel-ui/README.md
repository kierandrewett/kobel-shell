# kobel-ui

This is the human-owned UI crate for kobel-shell. It is deliberately empty:
`app()` returns one unstyled Freya `rect`, and the production `main` creates no
Wayland surfaces.

The core crates provide mechanisms. This crate owns every presentation decision.

| Crate | What to use it for |
|---|---|
| `kobel-ui` | Freya elements, UI state, themes, icons, surface layout and interaction design |
| `kobel-shell` | Optional reveal manager, `ShellBus`, IPC server and spring primitives |
| `kobel-wayland` | Embedded Freya runtime, layer surfaces, input, popups, output lifecycle and rendering |
| `kobel-services` | Plain system snapshots and typed commands |
| `kobel-ipc` | Control socket path and the independent `kobelctl` binary |

The removed UI is preserved under `archive/freya-ui-v1`. It is reference material,
not a template or an active workspace member. The last runnable revision of that UI
is Git commit `da3a7ec`.

## The two development paths

There are deliberately two ways to run UI code:

1. The `preview` binary uses Freya's normal winit host. Use it for fast component
   work and the stock Freya devtools inspector.
2. The production `kobel-ui` binary uses `kobel-wayland`. Use it for layer-shell
   placement, output hotplug, input regions, popups, IME, fractional scaling and
   compositor integration.

Keep the root component reusable between them. Do not add winit or the `freya`
facade to `kobel-wayland`.

## Start with the normal-window preview

Build the first components in `src/lib.rs` and run:

```sh
just ui-preview
```

The equivalent Cargo command is:

```sh
cargo run -p kobel-ui --bin preview --features devtools
```

Install the inspector built from the same pinned Freya revision once:

```sh
just install-freya-devtools
```

Then run it in a second terminal:

```sh
just freya-devtools
```

The inspector connects to port 7354 automatically. Only one devtools-enabled
Freya process can use that port at a time.

The `devtools` feature explicitly enables `freya/winit` and `freya/devtools`. The
`freya` facade is optional, so a normal `cargo build -p kobel-ui` does not compile
it into the production layer-shell binary.

### Devtools limitation

At the pinned 0.4.0-rc.24 revision, `freya-devtools::DevtoolsPlugin` is implemented
against `freya-winit` types, including winit `WindowId` and `EventLoopProxy`. It
cannot attach directly to kobel's custom layer-shell host without a port in Freya
or a second plugin implementation in `kobel-wayland`.

Use the preview for component-tree inspection and the production host for real
compositor behaviour. This limitation is in the upstream API, not a missing Cargo
feature in this crate.

## Mount the first layer surface

Once a component is useful in the preview, replace the empty production `main`
with one explicit surface. Start with one surface and keep its configuration beside
the UI that owns it:

```rust
use freya_core::prelude::{IntoElement, PreferredTheme};
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
            PreferredTheme::Dark,
        )
        .anchor(Anchor::TOP | Anchor::RIGHT),
        || kobel_ui::app().into_element(),
    )?;
    shell.run()
}
```

`anyhow` is already available in this crate so this entry point can return the
host's errors without flattening them.

`SurfaceConfig` owns:

- namespace
- layer
- anchor and margins
- exact or content-sized geometry
- exclusive zone
- keyboard interactivity
- initial click-through state
- preferred colour scheme
- real Wayland clipboard opt-in

The constructor requires the size and preferred colour scheme because those are UI
choices. Read `crates/kobel-wayland/src/lib.rs` for the complete builder API rather
than copying values from the archived UI.

Use `SurfaceSize::ContentSized` only for a root that measures to its content. A
root expanded to the full measurement viewport will always report `max_height`.

## Choose the correct surface constructor

| Need | API |
|---|---|
| One compositor-placed surface | `Shell::create_surface` |
| One copy on every current output | `Shell::create_surface_on_outputs` |
| One surface bound to the primary output | `Shell::create_singleton_surface` |
| Startup and hotplug through one path | `Shell::on_output` plus `OutputControl::create_on` |
| A child menu or contextual surface | `Control::open_popup` |

For a real shell, prefer `Shell::on_output`. It reports current outputs immediately,
then reports output additions, individual surface closure and output removal:

```rust
use kobel_wayland::{OutputEvent, Shell};

let mut shell = Shell::new()?;
shell.on_output(move |event, control| {
    match event {
        OutputEvent::Added(output) => {
            // Build this output's surfaces with control.create_on(...).
            // Record every returned SurfaceId and root-context handle.
        }
        OutputEvent::SurfaceClosed { surface, .. } => {
            // Drop only this surface's UI bookkeeping and manager registration.
        }
        OutputEvent::Removed { output, retired } => {
            // Drop the output bundle. `retired` contains surfaces the host retired
            // here; individually pre-closed surfaces are not repeated.
            let surviving_outputs = control.remaining();
            // Rebind any singleton whose host output died to the first survivor.
        }
    }
});
```

Do not treat `SurfaceClosed` as output death. A compositor can close one layer
surface while its output remains live. Keep registries keyed by `SurfaceId`, and
keep per-output bundles keyed by `OutputId`.

## Provide root contexts

Every layer surface and popup owns a separate Freya runtime. Register root contexts
in the constructor's `setup` callback and keep the returned state handles so the
host tick can update that runtime:

```rust
use freya_core::prelude::{IntoElement, State};
use kobel_services::AppsSnapshot;

let (surface_id, apps_state) = shell.create_singleton_surface(
    config,
    |contexts| contexts.provide(|| State::create(AppsSnapshot::default())),
    || kobel_ui::app().into_element(),
)?;
```

If the same snapshot appears on several surfaces, keep one `State<T>` handle per
surface and fan the event into all of them. A `State<T>` belongs to the runtime that
created it; do not move a Freya state write onto a service thread.

Components read the context with Freya's `use_consume::<State<T>>()` hook.
Only provide contexts a component actually consumes.

## Add system state

`kobel-services` owns D-Bus, PulseAudio and filesystem work on background threads.
It emits plain `ServiceEvent` snapshots and accepts typed `Command` values.

The callback passed to `Services::spawn` runs off the Wayland thread. Send the event
through a standard channel, wake the host, and drain the channel from
`Shell::on_tick`:

```rust
use std::sync::mpsc;

use kobel_services::{ServiceEvent, Services};

let (event_tx, event_rx) = mpsc::channel();
let waker = shell.waker();
let services = Services::spawn(move |event| {
    if event_tx.send(event).is_ok() {
        waker.wake();
    }
});

shell.on_tick(move |_control| {
    while let Ok(event) = event_rx.try_recv() {
        match event {
            ServiceEvent::Apps(snapshot) => {
                // Write `snapshot` into every surface's AppsSnapshot state.
            }
            _ => {
                // Route only the snapshots used by the current UI.
            }
        }
    }
});
```

`Shell` stores one tick callback. Calling `on_tick` again replaces the previous
callback. If the UI also uses `Manager`, drain service events and call
`manager.tick(control)` inside the same closure; do not install one callback for
each concern.

Keep the returned `ServicesHandle` alive for the lifetime of the UI. Dropping it
shuts the service threads down. Send commands through `services.send(command)` or
through `ShellMsg::Service(command)` when using the manager. Do not spawn shell
commands from Freya event handlers.

Useful starting points:

- `ServiceEvent` is the complete snapshot fan-out enum.
- `Command` is the complete typed action enum.
- Every snapshot derives `Clone`. Most also derive `PartialEq` and `Default`;
  check the concrete type before choosing a state-write helper.
- `TraySnapshot` has no `PartialEq`, so write it with `State::set`, not
  `set_if_modified`.
- `AudioSnapshot` has no `Default`, so seed it explicitly if a component consumes it.

## Use direct host controls

The closure passed to `Shell::on_tick`, `Shell::on_key` or `Shell::on_ime` receives
`kobel_wayland::Control`. It can:

- exit the event loop
- switch keyboard interactivity
- set full, empty or rectangular input regions
- open and close xdg popups
- list, activate, minimise and close compositor toplevels
- enable, update and commit Wayland text-input-v3 state

Use `Shell::on_key` for shell-wide keys such as Escape in addition to normal Freya
keyboard events. Use `Shell::on_ime` for text components that need compose or CJK
input. Clipboard-enabled surfaces must opt in with `SurfaceConfig::clipboard(true)`.

## Use the optional reveal manager

`kobel_shell::Manager` coordinates warm-mapped surfaces when the UI wants exactly
one reveal open at a time. It does not choose names, geometry, components or visual
styles.

The basic wiring is:

1. Build `(ShellBus, Receiver<ShellMsg>)` with `ShellBus::new()`.
2. Install the host waker on the bus.
3. Build `Manager::new(receiver, services_handle)`.
4. Create each reveal with an empty input region and its closed visual state.
5. Register its UI-owned `SurfaceKey`, `SurfaceId`, open keyboard mode and progress
   writer with `Manager::register_reveal`.
6. Call `manager.tick(control)` from `Shell::on_tick`; call `control.exit()` when it
   returns `true`.
7. Send `ShellMsg::Toggle(key)` and `ShellMsg::CloseAll` from Freya handlers.

A progress writer normally updates a per-surface `State<f32>` supplied as a root
context:

```rust
let mut progress = progress_state;
let registered = manager.register_reveal(
    "settings".parse()?,
    surface_id,
    kobel_wayland::KeyboardInteractivity::OnDemand,
    Box::new(move |value| progress.set_if_modified(value)),
);
assert!(registered, "surface keys must be unique");
```

Surface keys accept lowercase ASCII letters, digits, `-` and `_`. They cross the
`kobelctl` socket boundary, but the core does not reserve names.

The manager lifecycle API is hotplug-safe:

- call `unregister_reveal(key, output_control)` when a managed surface closes
- call `set_dismiss(id, output_control)` when a dismiss layer is created or replaced
- call `clear_dismiss(id, output_control)` when that layer is retired

Both `Control` and `OutputControl` implement `kobel_shell::SurfaceHost`, so these
operations restore keyboard and input-region state from either callback. Never
reuse a live key: unregister the retired surface first.

`RevealMotion`, `SpringSpec` and reduced-motion behaviour are configurable. Use the
manager only if its one-open-at-a-time policy matches the UI. Otherwise drive
`Control` directly.

## Expose the control socket

`kobel_shell::ipc::serve(bus.clone())` starts the line-based Unix socket server and
returns the bound path. Keep the returned path and remove it during clean shutdown.
The independent client is:

```sh
cargo run -p kobel-ipc --bin kobelctl -- ping
cargo run -p kobel-ipc --bin kobelctl -- toggle settings
cargo run -p kobel-ipc --bin kobelctl -- close-all
cargo run -p kobel-ipc --bin kobelctl -- quit
```

The socket listener only sends messages through `ShellBus`; it never mutates Freya
state directly.

## Test without a compositor

`freya-testing` is configured as a development dependency. The starter smoke test
covers the empty root:

```sh
cargo test -p kobel-ui
```

Use `TestingRunner` for component state transitions, pointer and keyboard
interactions, and rendered snapshots. Assert user-visible behaviour rather than
source structure.

For the embedded runtime and real input path, run:

```sh
just host-spike
just host-input
```

These test `kobel-wayland` under the gnoblin devkit without requiring a completed
shell UI. Once the production crate mounts surfaces, add a UI-specific devkit gate
rather than weakening the host spike.

## Source map

- `crates/kobel-ui/src/lib.rs`: shared preview and production root
- `crates/kobel-ui/src/main.rs`: production layer-shell entry point
- `crates/kobel-ui/src/bin/preview.rs`: winit and devtools entry point
- `crates/kobel-wayland/src/lib.rs`: surface and popup configuration
- `crates/kobel-wayland/src/conn.rs`: shell constructors, callbacks and controls
- `crates/kobel-wayland/src/surface.rs`: embedded Freya runtime and root contexts
- `crates/kobel-services/src/lib.rs`: snapshots, commands and service lifecycle
- `crates/kobel-shell/src/lib.rs`: UI-neutral manager, bus, IPC and motion exports
- `archive/freya-ui-v1`: removed concrete UI, read-only reference

Upstream references pinned to the workspace revision:

- [embedded Freya example](https://github.com/marc2332/freya/blob/5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6/examples/feature_embedded.rs)
- [Freya examples](https://github.com/marc2332/freya/tree/5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6/examples)
- [Freya devtools documentation](https://github.com/marc2332/freya/blob/5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6/crates/freya/src/_docs/devtools.rs)
