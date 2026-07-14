# kobel-shell - Freya/Rust rewrite plan

Rewrite the entire shell (every layer-shell surface, every service) in Rust, using
[Freya](https://github.com/marc2332/freya) **main** as the UI framework, rendered by our
own Wayland layer-shell host instead of winit. The AGS/TypeScript implementation in
`ags/` stays untouched as the behavioural reference until parity, then gets archived.

> **Status: all 7 phases below shipped; `ags/` archived (see `README.md` for the
> current architecture and layout).** This document is kept as the historical
> record of the original plan -- most of it still describes the real
> architecture accurately, but a few specific claims below (IME, the gnoblin
> service table, calendar) were proven wrong or completed during the build and
> are corrected inline rather than left to mislead a future reader.

The behavioural spec is `ags/` + `docs/prototype.html` + DESIGN.md. Pixel-exact parity
is not the goal of this plan; behavioural parity and the design rules in
`ags/README.md` ("Design rules that MUST survive the port") are. Visual tidy-up happens
at the end, by hand.

---

## 1. What Freya on main actually is (research summary)

Verified against upstream `main` (`0.4.0-rc.24`, workspace at `marc2332/freya`):

- **No Dioxus.** Since the #1351 rewrite, Freya has its own reactive core. UI is a
  Rust builder API: `rect().width(Size::fill()).background((16,14,20)).child(...)`,
  components are structs implementing `Component`, state is `use_state` /
  `State<T>`, context via `provide_context`/`use_consume`, async via Freya tasks
  (`spawn`) with optional tokio integration. The stable docs.rs docs (0.3.x, RSX,
  signals) are obsolete for us.
- **Embeddable without winit.** `examples/feature_embedded.rs` builds Freya purely from
  `freya-core` + `freya-engine`:
  - `Runner` - the reactive runtime (`Runner::new(|| app().into_element())`,
    `provide_root_context`, `sync_and_update() -> Mutations`, `handle_event`).
  - `Tree` - retained tree (`apply_mutations`, `measure_layout(size, fonts, events_sender, scale, fallback_fonts)`).
  - `RenderPipeline { font_collection, font_manager, tree, canvas, scale_factor, background }.render()`
    - paints into **any Skia `Canvas` we provide**. GPU or raster, our choice.
  - Events: we convert host input to `freya_core::PlatformEvent` (Mouse/Keyboard/
    Wheel/Touch/ImePreedit/File), run it through `EventsMeasurerAdapter` (hit testing
    via `ragnarok`, needs a `NodesState<NodeId>`), and dispatch via
    `EventsExecutorAdapter`. `freya-testing` is the reference implementation of this
    loop; `freya-winit` is the production reference.
  - For stock components/hooks to work, the host must provide root contexts:
    `Platform` (with a `sender` for `UserEvent::RequestRedraw`), `RenderingTicker`
    (+ send a tick after each presented frame), `AnimationClock`, clipboard state,
    `AssetCacher`, and optionally the accessibility tree.
- **Feature flags:** `freya` defaults to `winit`. We do NOT depend on the `freya`
  facade at all; we depend on `freya-core`, `freya-engine`, `freya-components`,
  `freya-animation`, `torin` directly from git, pinned to one rev.
- **Skia:** `freya-skia-safe 0.98` (fork of skia-safe) with `textlayout`, `svg`,
  `webp`; on Linux `freya-engine` enables `gl`, `vulkan`, `wayland`, `x11`. GL via a
  wrapped framebuffer (`backend_render_targets::make_gl` +
  `wrap_backend_render_target`) is the well-trodden path.
- **Layout (Torin):** `rect`/`label`/`paragraph`/`image`/`svg` elements;
  `Size::{px,percent,fill,fill_min,auto,flex,dynamic_calc}`; padding/margin/spacing;
  vertical/horizontal direction; main/cross alignment (+ space-between/around/evenly);
  `Position::{stacked, absolute, global}` - absolute positioning gives us the
  "dots are ALWAYS absolute overlays" rule natively; `overflow: clip`; explicit
  `layer` offsets for z-ordering.
- **Styling:** solid/gradient fills, corner_radius (+ smoothing), borders, multiple
  shadows, opacity, rotate/scale, `font_family/size/weight`, tabular-ish data via
  font features is NOT exposed - but Skia paragraph text styles support font
  features through the underlying API; worst case the clock/percentages use a mono
  face (DESIGN.md already allows `ui-monospace` for data).
- **Animation:** `use_animation` + `AnimNum`/`AnimColor`/`AnimSequential`, easing
  functions (Back/Bounce/Circ/Cubic/Elastic/Expo/Linear/Quad/Quart/Sine), triggers
  (`OnCreation`, `OnChange`, `OnFinish`), `use_animation_transition`.
  **There is no spring primitive.** Duration+easing only. See section 4.
- **Components:** Button, Switch, Slider, Input, ScrollView, VirtualScrollView,
  Popup, Menu, Tooltip, ProgressBar, Loader, Chip, Card, context_menu, tile,
  segmented_button, etc. Good skeletons; kobel restyles everything anyway.
- **Custom drawing:** `canvas()` component exposes the Skia canvas directly
  (`CanvasContext`) - escape hatch for the EQ visualizer, event dots, anything odd.

What Freya does NOT give us (we build it):

| Gap | Owner |
|---|---|
| Wayland connection, wlr-layer-shell surfaces, anchors/margins/exclusive zones/keyboard-interactivity | our host crate |
| GL context + Skia surface per layer surface | our host crate |
| Input decoding (pointer, keyboard/xkb, scroll) -> `PlatformEvent` | our host crate |
| Frame scheduling (wl frame callbacks, damage, redraw-on-request) | our host crate |
| Fractional scale (`wp_fractional_scale_v1` + viewporter) | our host crate |
| Springs (interruptible, velocity-preserving) | `kobel motion` module |
| Every system service (Astal replacements) | `kobel-services` crate |
| SNI tray host (Freya's `tray` feature is "app's own tray icon", not a host) | `system-tray` crate |
| IME (`zwp_text_input_v3`) | shipped in `kobel-wayland` (`ime.rs` + `conn.rs`), launcher-only |
| AccessKit bridge | deferred (see risks) |

---

## 2. Architecture

Cargo workspace at the repo root; `ags/` untouched beside it.

```
kobel-shell/
|-- Cargo.toml                # workspace
|-- crates/
|   |-- kobel-wayland/        # THE HOST. sctk + calloop + EGL/Skia + Freya embedding.
|   |   |-- conn.rs           # registry, outputs, seat, compositor, layer shell, fractional scale
|   |   |-- egl.rs            # EGL display/context (one shared), window surfaces per layer surface
|   |   |-- surface.rs        # FreyaLayerSurface: Runner+Tree+fonts+events+NodesState+Platform
|   |   |-- input.rs          # pointer/keyboard/scroll -> PlatformEvent (xkb via sctk, keyboard-types)
|   |   |-- frame.rs          # damage flags, frame callbacks, RequestRedraw plumbing, ticker
|   |   `-- lib.rs            # Shell::run(), SurfaceConfig { anchors, margins, layer, kb_mode, exclusive, namespace }
|   |-- kobel-services/       # system state, zero UI. tokio + zbus on a side thread,
|   |   |                     # snapshots pushed to the UI thread over calloop channels.
|   |   |-- gnoblin.rs        # org.gnoblin.Shell proxy: windows, reload, features, connected
|   |   |-- notifd.rs         # WE OWN org.freedesktop.Notifications (zbus server)
|   |   |-- audio.rs          # default sink vol/mute + per-stream mixer
|   |   |-- network.rs        # NetworkManager (zbus): wifi enabled/ssid/APs/strength/connect
|   |   |-- bluetooth.rs      # BlueZ (zbus): powered, devices, connect/disconnect
|   |   |-- battery.rs        # UPower (zbus)
|   |   |-- mpris.rs          # MPRIS players (zbus, native control - playerctl shelling dies)
|   |   |-- tray.rs           # StatusNotifier host (`system-tray` crate)
|   |   |-- apps.rs           # desktop entries + fuzzy + frecency (port of lib/fuzzy.ts)
|   |   |-- brightness.rs     # logind SetBrightness (fallback: brightnessctl)
|   |   |-- power.rs          # net.hadess.PowerProfiles; session verbs (loginctl/systemctl)
|   |   `-- settings.rs       # color-scheme / night light (gsettings)
|   `-- kobel-shell/          # the bin: theme, motion, surfaces, wiring
|       |-- main.rs           # spawn surfaces per output + singletons, service fan-out, IPC
|       |-- theme.rs          # THE token layer (colors, radii, spacing, type, Tokens presets)
|       |-- motion.rs         # spring engine + MOTION table + use_spring hook
|       |-- manager.rs        # surface open/close registry (makeReveal successor)
|       |-- ipc.rs            # unix socket: `kobelctl toggle launcher` etc.
|       `-- ui/               # bar.rs dock.rs launcher.rs quick_settings.rs calendar.rs
|                             # notifications.rs osd.rs session.rs dismiss.rs + shared bits
`-- ags/                      # reference implementation until parity, then archived
```

Three crates, not five: the host is genuinely separable (candidate to extract as a
`freya-layer-shell` repo later), services are testable headless, and everything
kobel-specific (theme, motion, components) lives in one coherent bin crate.

### 2.1 One process, one surface = one Freya instance

Mirrors the AGS shape exactly. Per-output: `bar`, `dock`, `toasts`, `osd`.
Singletons: `launcher`, `quicksettings`, `calendar`, `drawer`, `session`,
`dismiss-layer`. Each `FreyaLayerSurface` owns its own `Runner`, `Tree`,
`NodesState`, fonts, and events channel; all share one EGL context + Skia
`DirectContext` (N EGL window surfaces, one GL context - standard EGL usage).

### 2.2 The frame loop (per surface)

Straight from the upstream contract (`feature_embedded.rs` + `freya-winit` semantics):

```
input (calloop: wl events)                 update (when dirty)
  pointer/kb/wheel                           drain EventsChunk -> runner.handle_event
  -> PlatformEvent                            mutations = runner.sync_and_update()
  -> EventsMeasurerAdapter::run               runner.run_in(|| tree.apply_mutations(...))
  -> queue EventsChunk::Processed             needs_render? -> request wl frame callback

render (on frame callback)
  if layout dirty: tree.measure_layout(size, fonts, events_sender, scale, fallbacks)
  make current; wrap fbo0 -> Skia Surface; RenderPipeline{..}.render()
  swap buffers (damage-tracked); ticker_sender.send(())
```

`Platform.sender` closes the loop: `UserEvent::RequestRedraw` from hooks/animations
maps to "schedule a frame callback for this surface". Idle shell burns zero CPU: no
dirty state -> no frame callbacks -> nothing runs.

### 2.3 Services fan-out

Services run on a tokio thread (zbus is async). Freya `State<T>` is not thread-safe
and belongs to the UI thread only, so the boundary is strict: service tasks send
plain snapshot structs (e.g. `AudioSnapshot { volume, muted, streams }`) over a
calloop channel and never touch Freya types. The UI thread holds, per surface, the root-context
`State<T>` handles it created at surface construction (the exact
`provide_root_context` + `state.write()` pattern the embedded example uses for
`progress`), writes the new snapshot into every interested surface, and lets the
normal dirty->frame machinery take over. Commands flow the other way over an mpsc
(e.g. `Audio::SetVolume(0.4)`, `Gnoblin::Activate(id)`).

### 2.4 Surface visibility model

Port `lib/surface.ts` semantics, drop the GTK mechanisms:

- On-demand surfaces are created at startup and STAY MAPPED (the AGS warm-open
  trick). Closed state = opacity 0 via the reveal spring + **empty wl input region**
  (the honest version of GTK `can_target=false`) + keyboard-interactivity `None`.
- `manager.rs` holds the registry: opening one surface closes the others, drives
  `dismissVisible`, flips keyboard-interactivity (`Exclusive` for launcher/session,
  `OnDemand` for QS/calendar/drawer) on the fly via `layer_surface.set_keyboard_interactivity`.
- OSD sets an empty input region permanently (click-through, display only).
- Reveal motion: opacity spring `panelOpacity k360 d32` in, `panelClose k640 d48` out
  - same numbers, same interruptibility.

---

## 3. Host stack (concrete)

| Concern | Crate | Notes |
|---|---|---|
| Wayland client | `smithay-client-toolkit` 0.20 (+ `wayland-client` 0.31) | `shell::wlr_layer` gives LayerSurface, anchors, margins, exclusive zone, kb interactivity |
| Event loop | `calloop` | sctk's native loop; timers for OSD auto-hide, toast timeouts |
| GL | `khronos-egl` + `wayland-egl` | one shared context; `eglSwapBuffersWithDamage` |
| Skia | `freya-engine` re-exports | `backend_render_targets::make_gl` + `wrap_backend_render_target` per frame |
| Fractional scale | `wp_fractional_scale_v1` + `wp_viewporter` | fall back to integer `buffer_scale`; scale feeds measure_layout + events + Platform |
| Keyboard | sctk xkb + `keyboard-types` 0.8 | Freya's own key/code types; repeat handled host-side |
| Freya | `freya-core`, `freya-engine`, `freya-components`, `freya-animation`, `torin` | git-pinned to one rev; NO `freya` facade, NO `winit` feature anywhere |

Alternative considered and rejected for now: `layershellev` (waycrate's ready-made
layer-shell event loop) would save some sctk boilerplate but adds a young dependency
exactly where we want full control (input regions, per-surface kb modes, damage,
fractional scale). Forking `freya-winit` onto a layer-shell winit fork is two forks
deep and strictly worse. Plain sctk is boring and proven (ironbar and half the
Rust-shell scene sit on it).

---

## 4. Motion: springs are the product, so we build them

Freya's animation API is duration+easing; there is no spring, and
`use_animation`'s rerun semantics (`OnChange::Rerun` replaces the animated value and
calls `prepare()`) would discard in-flight position/velocity on retarget. That
breaks kobel's non-negotiable "interruptible, velocity-preserving" rule. So we do
NOT wrap springs in `AnimatedValue`. Instead `motion.rs` implements the hook layer
directly, the same way `freya-animation`'s own hook is built internally:

```rust
pub struct SpringSpec { pub k: f32, pub d: f32 }          // MOTION table ports 1:1
pub const PANEL_OPEN:  SpringSpec = SpringSpec { k: 420.0, d: 26.0 };
pub const PANEL_CLOSE: SpringSpec = SpringSpec { k: 640.0, d: 48.0 };
// ... panelOpacity, drill, height, toastIn/Out, badgePop, bellShake, fling, dockCycle, snap

pub fn use_spring(initial: f32) -> UseSpring;  // -> read: f32
impl UseSpring {
    pub fn to(&mut self, target: f32, spec: SpringSpec);  // retarget, KEEPS value+velocity
    pub fn kick(&mut self, velocity: f32);                // impulse (badge pop, bell shake)
    pub fn jump(&mut self, value: f32);                   // settle instantly (reduced motion)
}
```

Internals: a Freya task (`spawn`) that waits on `RenderingTicker::tick()`, sends
`UserEvent::RequestRedraw` while active, integrates the damped harmonic oscillator
with the elapsed time (closed-form underdamped solution from current `(x, v)`, so
retargeting is exact, not accumulated), writes a `State<f32>`, and stops when
settled (`|x-target| < eps && |v| < eps`). This is exactly the mechanism
`use_animation` uses to drive redraws, minus the parts that fight us. Freya's
`AnimNum`/easing stays available for the few things that are genuinely curves
(the dock dot width uses an ease-out-back curve today; spring or `Function::Back`
both acceptable).

`prefers-reduced-motion`: a config/env flag that turns `to()` into `jump()` and
freezes ambient motion (EQ bars).

---

## 5. Service replacements (Astal -> Rust)

| Today (AGS) | Rust replacement | Risk |
|---|---|---|
| `services/gnoblin.ts` (Gio DBus proxy) | zbus proxy `org.gnoblin.Shell`: `Reload`, `SetFeature`, name-owner watch -> `connected`. **Corrected during the build**: `ActivateWindow`/`MinimizeWindow`/`ListWindows`/`WindowsChanged` planned here never existed on that interface (confirmed live: `UnknownMethod`) -- window list/activate/minimize/close is the real `zwlr_foreign_toplevel_manager_v1` Wayland protocol, owned by `kobel-wayland` (`toplevel.rs`), not this proxy. See `crates/kobel-services/src/gnoblin.rs`'s module doc. | low - same bus API for what's left |
| AstalNotifd (owns o.fd.Notifications) | zbus **server** implementing `org.freedesktop.Notifications` (Notify, CloseNotification, GetCapabilities, GetServerInformation; emits NotificationClosed/ActionInvoked). Persist last ~50 to disk. `SetFeature("notifications", false)` on start, hand back on exit | medium - most code, well-specified protocol |
| AstalWp (WirePlumber) | `libpulse-binding` against pipewire-pulse: default sink volume/mute, sink-inputs for the per-app mixer, subscribe events | medium - pragmatic phase-1 bridge; pulse API reflects WirePlumber's default-node choice but is one step removed. If default-device tracking or stream metadata disappoints, upgrade to the native `pipewire` crate later; the service API doesn't change |
| AstalNetwork | zbus proxies for NetworkManager (Device.Wireless, AccessPoint, ActiveConnection) | low - verbose but mechanical |
| AstalBluetooth | zbus proxies for BlueZ (Adapter1, Device1, ObjectManager) | low |
| AstalBattery | zbus proxy UPower DisplayDevice | low |
| AstalMpris + `playerctl` shelling | zbus: enumerate `org.mpris.MediaPlayer2.*`, Player proxy (PlaybackStatus, Metadata, Position, PlayPause/Next/Previous). Control goes native; delete the playerctl split | low |
| AstalTray | `system-tray` crate (SNI watcher/host + DBusMenu). Menus render as kobel context menus | medium - DBusMenu rendering |
| AstalApps + `lib/fuzzy.ts` | `freedesktop-desktop-entry` + port fuzzy/frecency (same freq.json format, same log2 cap) | low - pure logic |
| `brightnessctl` shelling | logind `org.freedesktop.login1.Session.SetBrightness` (no polkit prompt for the session owner); read from sysfs | low |
| `powerprofilesctl` shelling | zbus `net.hadess.PowerProfiles` | low |
| GSettings (dark style, night light) | `gsettings` subprocess for now (set + monitor); revisit if it grates | low |
| session verbs | keep subprocess: `loginctl lock-session`, `gnome-session-quit`, `systemctl reboot/poweroff` | none |
| Calculator (`Function("return...")`!) | tiny expression parser (or `kalk`/`meval` crate) - the JS eval dies with prejudice | none |

---

## 6. Surface port map

Layer config carried over from the AGS inventory (namespace `kobel-*` kept so
gnoblin window rules keep matching):

| Surface | Kind | Anchor / margins | Layer / kb | Notes |
|---|---|---|---|---|
| bar | per-output | TOP+L+R, m 10/12/12, exclusive | top / none | clock poll, gnoblin title, status pill (amber on disconnect), bell+badge, tray |
| dock | per-output | BOTTOM | top / none | pins + gnoblin dots (absolute overlays), click/scroll/middle/right-click model, media tile |
| toasts | per-output | TOP+RIGHT, m 58/12 | top / none | hidden while drawer open; 3.8s expiry; translucent card (blur = gnoblin rule) |
| osd | per-output | BOTTOM, m 72 | top / none | **empty input region**; volume events; 1.4s auto-hide; add mute-change trigger (known gap) |
| launcher | singleton | TOP, m 56 | top / Exclusive when open | custom text field (ghost autocomplete, faux placeholder), sections, `:` commands, `=` calc, tile grid |
| quicksettings | singleton | TOP+RIGHT | top / OnDemand | chip grid, drill stack (wifi/bt/mixer) with slide motion, sliders, gnoblin banner |
| calendar | singleton | TOP | top / OnDemand | grid w/ week numbers, event dots (absolute), month nav; events stay hardcoded for now |
| drawer | singleton | TOP+RIGHT+BOTTOM, m 12 | top / OnDemand | media card, history, clear, empty state |
| session | singleton | all edges, exclusivity ignore | top / Exclusive when open | 4 buttons, arrow nav, press-again confirm w/ 4s revert |
| dismiss | singleton | all edges | top / none | empty->full input region flip with dismissVisible; closes everything on click |

Component style: everything sizes from `theme.rs` tokens (the `Tokens` struct ports
`config.ts` including the `gapless` preset). Shared pieces become real components:
`Sheet`, `Chip`, `IconButton`, `KSlider` (6px rail / 17px knob - no more
GTK measurement lies), `Dots`, `Badge`. Icons: the existing `icons/*.svg` render via
Freya's `svg()` element with `fill` recoloring.

Launcher text field is custom (keydown accumulation on the focused surface), not
`freya-components::Input` - the AGS one is already a custom overlay construction,
and keyboard-exclusive mode delivers us every key. IME and clipboard were
deferred out of stock `Input`'s bundled requirements for phase one, then both
shipped later wired directly into the custom field instead (`ImeFeed` context +
`Editor::apply_ime_commit`; a real Wayland clipboard opted in via
`SurfaceConfig::clipboard`) -- see sections 1 and 8.

---

## 7. Phases

Every phase ends with: tree working, run in the gnoblin devkit
(`INTERACTIVE=1 ./scripts/run-in-gnoblin.sh` grows a `--rust` mode), committed in
small conventional commits.

**Phase 0 - feasibility spike (gate for everything).**
One `spike` bin: connect, create one layer surface on gnoblin (nested devkit),
EGL+Skia up, render a Freya `rect` with a running `AnimNum` animation and an
`on_press` counter, pointer + keyboard input working, fractional scale read,
keyboard-interactivity switchable at runtime. Measure: idle CPU ~0, animation
smooth on real HW, memory per surface. Exit criteria: all of the above true on
gnoblin (NOT just a wlroots compositor), else replan (options: patch gnoblin,
fall back to raster, or stop).

**Phase 1 - kobel-wayland hardened.**
Multi-surface + multi-output lifecycle, seat handling (enter/leave per surface,
xkb + repeat), scroll (discrete + continuous), damage-tracked presentation, the
Platform/ticker/clock root contexts, per-surface `SurfaceConfig`, input regions,
output hotplug. Unit-testable event conversion. Acceptance: two dummy surfaces on
two edges with independent input and animation; unplugging/replugging a monitor
doesn't crash.

**Phase 2 - theme, motion, manager + first chrome (bar skeleton, OSD).**
`theme.rs` tokens, `motion.rs` (`use_spring`, MOTION table), `manager.rs`
(registry, dismiss layer, reveal springs, kb-mode flipping). Services: gnoblin +
audio (volume/mute only). Ship: bar with clock/title/status pill (live volume icon,
amber-on-disconnect) and the OSD (display-only, auto-hide, click-through).
Acceptance: `kobelctl toggle` works against the IPC socket; OSD reacts to real
volume keys; bar title tracks gnoblin windows.

**Phase 3 - dock + apps.**
Apps service (desktop entries, fuzzy, frecency), full dock click model
(launch/focus/cycle/minimize, middle-click new window, scroll cycle, context menu
with real window list, Quit stops using `pkill -f`), absolute-overlay dots with the
4-dot sliding viewport, media mini-tile (mpris service, native control).
Acceptance: dock drives real gnoblin windows in the devkit.

**Phase 4 - launcher + session.**
Custom field (ghost autocomplete, faux placeholder), sections
(best/apps/actions/files/web), `:` gnoblinctl command mode, `=` calculator (real
parser), Tab/arrows/Ctrl-n/p/Enter/Esc handling, frecency bump, empty-state tile
grid + widgets. Session overlay: arrow nav, press-again confirm, 4s revert, rose
resting state on Shut down. Both keyboard-Exclusive surfaces prove the kb-mode
machinery. Acceptance: full keyboard path works; Super-release binding via
gnoblin -> `kobelctl toggle launcher`.

**Phase 5 - quick settings + calendar.**
Network/bluetooth/battery/brightness/power-profiles/settings services. QS root
(top row, chip grid, sliders, gnoblin banner + reconnect), drill stack with spring
slide (wifi list, bt list, per-app mixer). Calendar (grid, week numbers, event
dots, month nav; sliding month motion if cheap, else defer). Acceptance: toggling
wifi/bt/dark style does the real thing; mixer moves real streams.

**Phase 6 - notifications + tray.**
notifd zbus server owning the bus name (with `SetFeature` handshake + hand-back on
exit), toast stack (timeout, DND, adoption into drawer), drawer (media card,
history persistence, clear, empty state), toast in/out springs (`toastIn k360 d23`,
`toastOut k440 d36` - the motion the AGS port never wired). Tray host in the bar
with DBusMenu -> kobel menus. Acceptance: `notify-send` round-trip incl. actions;
gnome's daemon regains the name when kobel exits.

**Phase 7 - parity audit + retirement.**
Walk `ags/README.md` MUST-survive rules and the widget inventory surface by
surface; multi-monitor pass; perf pass (cold start, warm open traces - port the
`KOBEL_PROFILE_ANIM` trace points); reduced-motion pass; README/docs rewrite;
`ags/` -> `archive/ags/` (kept as reference). Fixture mode (`KOBEL_DEMO`
equivalent) + headless raster PNG snapshots (the embedded example's
`raster_n32_premul` path) become the screenshot test rig in CI - no compositor
needed.

Phases 3-6 are internally parallelisable (services vs UI), but land in this order
so every merge keeps a usable shell.

---

## 8. Risks and honest notes

- **Freya main is an RC and moving.** 0.4.0-rc.24, recent giant rewrite (#1351).
  Pin one git rev in the workspace, upgrade deliberately, never track main live.
  Expect occasional API churn on upgrade days.
- **gnoblin (mutter) layer-shell semantics** are the real unknown: keyboard
  interactivity switching while mapped, exclusive keyboard on `top` layer,
  fractional-scale on layer surfaces, empty input regions. That's why Phase 0
  exists and runs against gnoblin, not sway.
- **IME shipped** (`zwp_text_input_v3`, launcher-only). Was originally deferred
  ("keyboard events cover Latin input for the launcher"); the additive
  enable/disable-per-focus design worked out as planned -- see `kobel-wayland/
  src/ime.rs` and `README.md`'s gnoblin integration section for the one
  honestly-unverified piece (an actual composing ibus round-trip, blocked by
  this devkit's missing `gsettings-desktop-schemas`, not the implementation).
- **No AccessKit initially.** Layer-shell a11y is uncharted anyway; kobel's
  keyboard nav is app-managed selection state (as in AGS today). Freya's
  focus-follows-accessibility features stay unused until then; the custom text
  field avoids depending on them.
- **Audio via pulse bindings is a bridge**, not the native WirePlumber view.
  Default-sink + sink-input mixer semantics are fine over pipewire-pulse in
  practice; if stream naming/roles or default-node edge cases disappoint, swap
  `audio.rs` internals for the `pipewire` crate without touching the UI.
- **Skia build cost:** skia-safe compiles Skia unless prebuilt binaries match
  (clang + ninja + python on the build box). CI needs a cache. One-time pain.
- **Per-surface runners:** ~9 Freya instances on a single-monitor session. Each is
  small (the tree is tiny), fonts can share `FontMgr`; the spike measures RSS so we
  know instead of guessing.
- **Tabular numerals:** if Skia font-features plumbing through Freya's text styles
  turns out blocked, data glyphs use the mono face per DESIGN.md. Not a blocker.
- **Blur behind toasts/OSD** remains a gnoblin window-rule concern, orthogonal to
  this rewrite (same as today).
- **`freya-components` context requirements:** stock components expect Platform /
  ticker / clock / clipboard / AssetCacher root contexts - the host provides all of
  them from day one so we can adopt components freely.
- **`cargo audit` flags `quick-xml` 0.39.4 (RUSTSEC-2026-0194/0195, DoS via
  quadratic-time attribute scanning and unbounded namespace allocation).**
  Transitive, several levels deep: `wayland-scanner` (a proc-macro build
  dependency of `wayland-client`/`smithay-client-toolkit`) pins it, and
  0.20.0 is smithay-client-toolkit's latest release -- no newer upstream
  version exists yet that resolves to a fixed quick-xml, and `cargo update`
  cannot bump it past 0.39.x within the semver range wayland-scanner
  declares. Practically inert here: wayland-scanner runs quick-xml only at
  *compile time*, parsing the static, repo-vendored Wayland protocol XML
  bundled in the wayland-protocols crates -- never untrusted or network-
  sourced input at runtime, so neither advisory's DoS vector is reachable
  from this shell's actual attack surface. Re-run `cargo audit` after any
  `smithay-client-toolkit`/`wayland-client` bump to see if it clears.

## 9. Open questions (carry-overs, unchanged by this plan)

- Workspace indicators need a gnoblin protocol addition (`ListWorkspaces` +
  signal) - same as the old QML plan; not blocked on the rewrite.
- ~~Calendar events remain hardcoded until an EDS/ICS decision is made.~~
  Resolved: `kobel-services::calendar` is a real async service subscribing to
  `org.gnome.Shell.CalendarServer` (backed by Evolution Data Server, the same
  source GNOME Shell's own clock dropdown uses) -- no hardcoded sample data.
