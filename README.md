# kobel-shell

Rust shell infrastructure for [gnoblin](https://github.com/kierandrewett/gnoblin), with a custom wlr-layer-shell host that embeds [Freya](https://github.com/marc2332/freya) without winit.

The concrete UI now starts as two deliberately basic, independently runnable crates: a top bar and a dock.

## Workspace

```text
crates/
|-- kobel-ipc       zero-dependency socket path library and kobelctl binary
|-- kobel-wayland   layer-shell host, EGL/Skia renderer and embedded Freya runtime
|-- kobel-services  UI-free system snapshots and typed commands
|-- kobel-shell     UI-neutral manager, IPC server and spring primitives
|-- kobel-bar       independent top-bar component, preview and layer-shell process
`-- kobel-dock      independent dock component, preview and layer-shell process

third_party/freya-devtools   pinned inspector server with a configurable address
tools/freya-devtools-app     matching standalone Freya inspector
```

`archive/freya-ui-v1` contains the removed bar, dock, launcher, panels, theme and icons as read-only reference. It is not a workspace member. The last runnable version of that UI is Git commit `da3a7ec`.

## Current state

- `kobel-wayland`, `kobel-services`, `kobel-ipc` and `kobel-shell` remain reusable infrastructure.
- `kobel-bar` and `kobel-dock` are independent processes with no dependency on each other.
- Each UI crate exposes the exact component used by its layer-shell process and native preview.
- The bar is a transparent top-layer surface with an exclusive zone.
- The dock is a transparent bottom-layer surface with an exclusive zone and outer margin.
- Both components are deliberately basic starting points for human-owned UI work.
- No theme, icons or larger shell surface vocabulary has been restored from the archived UI.
- `kobelctl toggle <surface>` accepts UI-owned names made from lowercase ASCII letters, digits, `-` and `_`.

## Requirements

- Rust 1.95 or newer
- clang and ninja for Skia
- Wayland, EGL and xkbcommon development libraries
- `just` for the documented developer commands
- a gnoblin session for real layer-shell surfaces

Freya dependencies are pinned to revision `5810dc4a2304ee1a653eb63b5cbb40d41bbff4d6`. Upgrade the complete set together.

## Build and test

```sh
just check
just test
```

The equivalent Cargo commands are:

```sh
cargo check --workspace --all-targets
cargo check -p kobel-bar --bin kobel-bar-preview --features devtools
cargo check -p kobel-dock --bin kobel-dock-preview --features devtools
cargo test --workspace --all-targets
```

Build the independent control client with:

```sh
cargo build -p kobel-ipc --bin kobelctl
```

## Bar and dock development

Run the real layer-shell processes in separate terminals inside a gnoblin session:

```sh
just bar
just dock
```

For normal-window component work, run either devtools-enabled preview:

```sh
just bar-preview
just dock-preview
```

Each preview renders the same `bar_app` or `dock_app` component used in production.
Run its matching inspector in another terminal:

```sh
just bar-inspector
just dock-inspector
```

The bar pair uses `127.0.0.1:7354`; the dock pair uses `127.0.0.1:7355`, so both
can run at the same time. `FREYA_DEVTOOLS_ADDR` overrides either endpoint when
the preview and inspector receive the same value.

The inspector source is copied from the pinned Freya revision and kept in this
workspace because upstream hard-codes one IPv6 loopback endpoint. The local
change only makes that address configurable and IPv4-capable. Upstream still
couples `DevtoolsPlugin` to `freya-winit`, so inspection applies to the native
previews rather than directly to `kobel-wayland` surfaces.

The human iteration loop is:

1. Edit `crates/kobel-bar/src/lib.rs` or `crates/kobel-dock/src/lib.rs`.
2. Run the matching preview and inspector.
3. Inspect live tree, layout, style and accessibility state. Code changes still
   require restarting the preview; the inspector reconnects automatically.
4. Run `just bar-test` or `just dock-test`.
5. Run `just bar` or `just dock` in gnoblin to verify layer-shell geometry,
   transparency, exclusive zones, scaling and compositor behaviour.

## Embedded host gates

Verify the real bar, dock and inspector paths under a two-output headless gnoblin session:

```sh
just host-bar-dock
```

The gate mounts one bar and dock per output, launches both native previews and
both inspectors on their independent ports, verifies the WebSocket connections
and captures `/tmp/kobel-bar-dock.png`.

The lower-level renderer and input gates remain available:

```sh
just host-spike
just host-input
```

## Core interfaces

- `kobel_wayland::Shell` owns the calloop loop and embedded Freya surfaces.
- `kobel_wayland::SurfaceConfig` owns layer, anchor, margins, size, keyboard and input-region configuration.
- `kobel_services::Services` emits plain snapshots and accepts typed commands.
- `kobel_shell::ShellBus` connects Freya handlers or IPC threads to the shell loop.
- `kobel_shell::Manager` is an optional one-open-at-a-time reveal coordinator with UI-owned `SurfaceKey` names and configurable motion.
- `kobel_shell::motion` exposes spring primitives without a named design motion table.

The bar and dock may use the manager or drive `kobel_wayland::Control` directly. Presentation policy belongs in their owning UI crates, not in the core crates.

## Historical documentation

- `docs/FREYA-PLAN.md` records the original embedded-host migration and remains useful for renderer internals.
- `DESIGN.md` and `PRODUCT.md` describe the previous product direction; they do not configure the new UI.
- `archive/` contains previous AGS, QML and Freya implementations.
