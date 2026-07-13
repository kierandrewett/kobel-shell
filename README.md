# kobel-shell

The chrome suite for **[gnoblin](https://github.com/kierandrewett/gnoblin)** (Kieran's
patched GNOME Shell + Mutter), written in Rust with
[Freya](https://github.com/marc2332/freya) as the UI framework, rendered by our own
wlr-layer-shell host -- no winit, no GTK.

gnoblin is *just GNOME + mutter*: it strips its own top bar, overview and dash, and
exposes `wlr-layer-shell` plus the `org.gnoblin.Shell` control protocol. It draws no
chrome itself -- that's bring-your-own. **kobel-shell is that chrome**: bar, dock,
launcher, quick settings, calendar, notifications (kobel owns
`org.freedesktop.Notifications`), OSD, session overlay, tray.

The design language is "sakura pop" (DESIGN.md): opaque panels, one leaf accent as
solid fill with ink text, interruptible velocity-preserving springs everywhere. The
architecture and the full migration story live in `docs/FREYA-PLAN.md`.

## Layout

```
crates/
|-- kobel-wayland     the host: sctk + calloop + EGL/Skia, embeds freya-core per
|                     layer surface (no winit); input, frame scheduling, regions
|-- kobel-services    system state, zero UI: gnoblin, audio (pipewire-pulse),
|                     battery, network, bluetooth, apps, mpris, notifd (owns the
|                     o.fd.Notifications bus name), tray (SNI), exec, sysctl
`-- kobel-shell       the bin: theme tokens, spring engine, surface manager,
                      IPC (kobelctl), every surface under src/ui/, icon assets
scripts/              devkit gates: headless gnoblin + injected-input assertions
docs/FREYA-PLAN.md    the rewrite plan (phases 0-7, all landed)
archive/              the previous AGS/TypeScript shell + the QML sketch, frozen
                      as reference (self-contained, including an icons copy)
```

## Build and run

Rust 1.95+, clang/ninja (skia ships prebuilt), wayland/egl/xkbcommon headers.

```sh
cargo build --release --bins
# In a gnoblin session:
./target/release/kobel-shell
# Or in a visible nested devkit window (from any session), until Ctrl-C:
INTERACTIVE=1 ./scripts/run-shell-in-gnoblin.sh
# Control a running shell:
./target/release/kobelctl ping
./target/release/kobelctl toggle launcher   # launcher|quicksettings|calendar|drawer|session
./target/release/kobelctl quit
```

Environment flags:

- `KOBEL_REDUCED_MOTION=1` -- every spring settles instantly.
- `KOBEL_PROFILE_ANIM=1` -- reveal-spring traces (`KOBEL_MOTION` lines).
- `KOBEL_SHELL_SOCKET=/path` -- control-socket override (used by the devkit gates).

## Verification

Everything is verified headlessly against a real gnoblin session (no visible
compositor needed):

```sh
./scripts/run-spike-in-gnoblin.sh            # host render gate
INPUT_TEST=1 ./scripts/run-spike-in-gnoblin.sh   # host input gate (injected HID)
./scripts/run-shell-in-gnoblin.sh            # full shell gate: 25 assertions incl.
                                             # notify-send round-trip, injected
                                             # keyboard/click paths, screenshots
VIRTUAL_MONITORS="1280x800 1024x768" ./scripts/run-shell-in-gnoblin.sh  # multi-monitor
cargo run -p kobel-shell --example render-panel -- quicksettings /tmp/qs.png  # headless panel PNG
```

`scripts/devkit_input.py` injects real pointer/keyboard events through Mutter's
RemoteDesktop API -- devkit sessions only.

### Rendering debug (RenderDoc)

For *rendering* bugs -- wrong colours, clipping, blend/overdraw, a surface that
paints wrong -- capture the actual GPU frame instead of a screenshot. RenderDoc
injects into the kobel-shell binary (an EGL/GLES3 client) and records every
Freya/Skia GL draw call for one present:

```sh
./scripts/capture-frame-in-gnoblin.sh quicksettings /tmp/kobel-shell.rdc  # capture a surface
./scripts/capture-frame-in-gnoblin.sh                                     # default: launcher/bar chrome
```

This boots the same headless gnoblin session as the gates, runs kobel-shell under
`renderdoccmd` injection (NOT gnome-shell -- we want Freya/Skia draws, not
mutter's), drives a present with a `kobelctl` toggle so the trigger lands on a real
surface, records which present/swapchain it caught, and writes the `.rdc`. It then
opens the capture and exports one render target to `/tmp/kobel-rt.png`. Inspect
further with `rdc` (the `renderdoc-gpu-debug` skill; run `rdc doctor` first):

```sh
# Scope every call to a session so you never disturb another open rdc session:
S="--session kobel-debug"
rdc $S open /tmp/kobel-shell.rdc
rdc $S info --json                   # API, GPU, resolution, frame number
rdc $S stats --json                  # per-pass breakdown, top draws
rdc $S draws --limit 10              # first draw calls (EIDs)
rdc $S rt <EID> -o /tmp/kobel-rt.png # export a draw's render target to PNG
rdc $S close
```

GLES capture *replay* needs an `rdc` python module built with the GL replay driver.
Where the local module is Vulkan-only (`rdc open` -> "local replay not supported"),
the script still writes a valid `.rdc` and exports the frame's embedded backbuffer
thumbnail via `renderdoccmd thumb`; open the `.rdc` in the RenderDoc GUI or on a
GL-replay-capable box for the full pipeline.

The screenshot gates above stay the CI correctness assertions (IPC/input/notify
round-trips, reveal machinery); RenderDoc is the tool for diagnosing *how* a frame
was drawn, not a replacement for them.

## gnoblin integration

- All surfaces are `kobel-*` namespaced layer surfaces (window rules key on these).
- `kobel-services` talks `org.gnoblin.Shell`: soft reload, feature toggles, the
  window list that drives the dock and bar title.
- The notification daemon negotiates bus-name ownership itself: it asks gnoblin to
  release `notifications`, claims `org.freedesktop.Notifications`, and hands the
  feature back on exit.
- The bar's status pill goes amber when the gnoblin bus name vanishes; quick
  settings grows a reconnect banner.

## Follow-ups (known, deliberate)

- DBusMenu rendering for tray items (needs popup-surface design).
- Dynamic toast input regions (toasts are click-through; dismiss lives in the drawer).
- Fractional scale (gnoblin advertises it; the host uses integer buffer scale).
- IME (`zwp_text_input_v3`) for CJK input in the launcher.
- Calendar events remain sample data pending an EDS/ICS decision.
