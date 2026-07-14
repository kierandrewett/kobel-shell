# kobel-shell

Rust shell infrastructure for [gnoblin](https://github.com/kierandrewett/gnoblin), with a custom wlr-layer-shell host that embeds [Freya](https://github.com/marc2332/freya) without winit.

The concrete UI has been reset. The active workspace now separates reusable shell infrastructure from the human-owned UI crate, which intentionally starts empty.

## Workspace

```text
crates/
|-- kobel-ipc       zero-dependency socket path library and kobelctl binary
|-- kobel-wayland   layer-shell host, EGL/Skia renderer and embedded Freya runtime
|-- kobel-services  UI-free system snapshots and typed commands
|-- kobel-shell     UI-neutral manager, IPC server and spring primitives
`-- kobel-ui        empty concrete UI crate, preview and human development guide
```

`archive/freya-ui-v1` contains the removed bar, dock, launcher, panels, theme and icons as read-only reference. It is not a workspace member. The last runnable version of that UI is Git commit `da3a7ec`.

## Current state

- `kobel-wayland`, `kobel-services`, `kobel-ipc` and the `kobel-shell` core library remain active.
- `kobel-ui::app()` returns one unstyled Freya `rect`.
- The `kobel-ui` production binary creates no layer surfaces until a human chooses the first surface and its behaviour.
- No theme, icons, panel names or concrete surface geometry live in the core crates.
- `kobelctl toggle <surface>` accepts UI-owned names made from lowercase ASCII letters, digits, `-` and `_`.

Start with [`crates/kobel-ui/README.md`](crates/kobel-ui/README.md). It covers the first layer surface, service snapshots, the optional reveal manager, headless component tests and Freya devtools.

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
cargo check -p kobel-ui --bin preview --features devtools
cargo test --workspace --all-targets
```

Build the independent control client with:

```sh
cargo build -p kobel-ipc --bin kobelctl
```

## UI development

Run the empty root and future components in Freya's normal desktop host:

```sh
just ui-preview
```

Install the matching Freya inspector once, then run it beside the preview:

```sh
just install-freya-devtools
just freya-devtools
```

`ui-preview` enables the optional `devtools` feature, which pulls in winit only for this development binary. The production layer-shell path and `kobel-wayland` remain winit-free.

Upstream Freya 0.4.0-rc.24 couples its devtools plugin to `freya-winit`, so the stock inspector cannot attach directly to the custom layer-shell host. Use the preview for component-tree inspection and the real host gates for compositor behaviour. The detailed limitation and source links are in `crates/kobel-ui/README.md`.

## Embedded host gates

Verify the real renderer and input path under headless gnoblin:

```sh
just host-spike
just host-input
```

These gates exercise `kobel-wayland`; they do not require a completed shell UI.

## Core interfaces

- `kobel_wayland::Shell` owns the calloop loop and embedded Freya surfaces.
- `kobel_wayland::SurfaceConfig` owns layer, anchor, margins, size, keyboard and input-region configuration.
- `kobel_services::Services` emits plain snapshots and accepts typed commands.
- `kobel_shell::ShellBus` connects Freya handlers or IPC threads to the shell loop.
- `kobel_shell::Manager` is an optional one-open-at-a-time reveal coordinator with UI-owned `SurfaceKey` names and configurable motion.
- `kobel_shell::motion` exposes spring primitives without a named design motion table.

A UI may use the manager or drive `kobel_wayland::Control` directly. Presentation policy belongs in `kobel-ui`, not in the core crates.

## Historical documentation

- `docs/FREYA-PLAN.md` records the original embedded-host migration and remains useful for renderer internals.
- `DESIGN.md` and `PRODUCT.md` describe the previous product direction; they do not configure the new UI.
- `archive/` contains previous AGS, QML and Freya implementations.
