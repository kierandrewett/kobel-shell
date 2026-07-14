# Design

Visual system for kobel-shell ("sakura pop"). Register: **product** — see PRODUCT.md.
Design reference: `docs/prototype.html` (open in a browser) is the source of the
tokens below (colour, type, radii, spacing) but is a richer standalone mockup, not
a literal feature contract -- it includes a wallpaper/petal canvas the Rust build
deliberately never paints (see Wallpaper below). `crates/kobel-shell/src/theme.rs`
is the authoritative source for exact values; this document explains what they mean.

## Theme

One theme: dark chrome over warm art. Panels are **fully opaque** (gnoblin has no
blur-behind protocol — translucency would be a lie). Elevation comes from surface
value steps and shadow, never from borders + shadows together.

## Color (OKLCH)

| token | value | use |
|---|---|---|
| `panel` | `oklch(17% .012 300)` | floating surfaces (bar, sheets, OSD, toasts) |
| `panel2` | `oklch(22.5% .015 300)` | tiles/rows inside a panel |
| `chip` | `oklch(26.5% .017 300)` | tracks, inset wells, hover-of-panel2 |
| `hover` | `oklch(31% .019 300)` | hover-of-chip |
| `tx` | `oklch(95.5% .008 320)` | primary text |
| `mut` | `oklch(76% .022 310)` | secondary text (≥4.5:1 on panel) |
| `dim` | `oklch(63% .022 310)` | tertiary/decorative text only |
| `leaf` | `oklch(80% .155 118)` | THE accent — active fills, primary actions, live data |
| `leaf2` | `oklch(71% .15 120)` | accent hover/pressed |
| `ink` | `oklch(23% .05 122)` | text/icons on leaf fills |
| `rose` | `oklch(74% .13 5)` | destructive (Clear, dismiss, shutdown hover) |
| `amber` | `oklch(82% .12 80)` | warnings (reserved) |

Rules: the leaf accent appears **only as a solid fill with ink text** (active chips,
primary buttons, today-in-calendar, slider fills, badge) — never as a tint,
outline, or decorative wash. Neutrals are violet-cast (hue 300–320, chroma ≤ .022)
to sit with the sakura art. Rose is semantic-destructive only.

## Typography

- UI: system sans (`system-ui`, Cantarell…). Weights 400/600/650. Sizes 10.5–14.5px
  fixed rem-free scale (product register: no fluid type).
- Data: `ui-monospace` with `font-variant-numeric: tabular-nums` for **every**
  number — clock, %, times, dates, D-Bus names.
- No display faces, no letter-spacing tricks, no uppercase-tracked eyebrows.

## Shape & elevation

- Radii: sheets (bar/panels/OSD/toasts/launcher) 24px · cards (notification cards,
  toasts, empty states) 20px · tiles (dock/launcher/media art) 12px · rows
  (notification/calendar rows) 10px · buttons 9px · pills/knobs/badges 999.
  (`crates/kobel-shell/src/theme.rs`'s `RADIUS_*` constants are the source of
  truth; this table trails an earlier iteration -- see the v3 addenda below for
  what actually shipped.)
- Panel/sheet roots (bar, launcher, QS, calendar, drawer, session, OSD, dock,
  menu) carry **no shadow at all** -- elevation there comes entirely from
  surface value steps (panel/panel2/chip), not shadow. Shadow is reserved for
  smaller floating elements sitting on top of a panel: tooltips, session
  action tiles, and drawer header/empty-state cards use `0 6px 18px` (~30%
  black); toast cards (which float directly over desktop content, not over a
  panel background) use a deeper `0 15px 34px` (~45% black). No border
  anywhere in either case.
- Inner tiles: surface-step only (panel2 on panel), **no border, no shadow**.
- Focus: 2px leaf `:focus-visible` outline, 2px offset — the only outline in the system.

## Motion

Physics, not keyframes. A shared damped-spring engine (stiffness k, damping d,
velocity-preserving, interruptible) drives every surface -- a closed-form damped
harmonic oscillator (`crates/kobel-shell/src/motion.rs`'s `SpringSpec`/`SpringSim`),
not a keyframed timeline; matches `Adw.SpringParams.new_full(damping, 1, stiffness)`
semantics.

| motion | spring | wired? |
|---|---|---|
| panel open | y/scale k420 d26 (slight overshoot), opacity k360 d32 | yes -- every panel |
| panel close | k640 d48 (fast, no bounce) | yes -- every panel |
| toast in / out | x k360 d23 / k440 d36 | yes -- `ToastCard` |
| QS drill in / back | k400 d27 / k440 d29 | yes -- `quick_settings.rs` |
| QS sheet height-adapt | k440 d32 | yes -- content-sized resize |
| dock dot width (rest → focused pill) | k430 d24 | yes -- `Dot` |
| badge pop / bell shake | velocity impulse (`kick`), k400 d17 / k330 d7 | **no** -- `UseSpring::kick()`, `BADGE_POP`/`BELL_SHAKE` are implemented and unit-tested at the math level but have zero call sites in the UI (see FREYA-PLAN.md's risk notes) |
| swipe-dismiss fling / snap | k280 d27 / k430 d28 | **no** -- `FLING`/`SNAP` are defined constants, zero call sites anywhere |

There is no per-row stagger and no "ease-out-back curve" panel-children reveal --
every panel's children fade in together with the panel's own opacity spring, not
individually offset. Ambient motion: none currently loops continuously (no
"falling petals" or "EQ bars" -- neither was ever built in this codebase or the
AGS port it replaced, verified by grep). `prefers-reduced-motion` freezes the
wired springs listed above (settle instantly on `to()`); there is no separate
ambient-animation category to freeze because none exists yet.

## Components

Bar (42px, single opaque slab): launcher toggle · focused window title ·
centered clock+date (→ calendar) · status pill (wifi/speaker/battery glyphs,
click → quick settings; no wheel handling) · tray icons · bell+badge (→ drawer).
No workspace indicators (gnoblin's wlr-foreign-toplevel-management carries no
workspace state; see FREYA-PLAN.md's open questions).
Launcher: search + flat-color icon tiles, `:` switches to gnoblinctl command
rows; full keyboard path.
Quick settings: 2-col filled chips → per-app-mixer/network/bluetooth drill
sections with a slide transition → volume/brightness sliders → an amber
gnoblin-disconnected banner with Reconnect. No EQ visualizer, no CPU/MEM
stats, no user row -- none of those were ever implemented. Media playback
lives in the drawer (`MediaCard`) and the dock's media mini-tile, not here.
Drawer + Calendar: two separate singleton surfaces (see v3 addenda below) --
drawer is a header with rose Clear + DND toggle over a scrollable notification
history and an "All caught up" empty state; calendar is its own month grid.
Neither cards nor calendar days have a swipe-to-dismiss gesture (matches the
unwired `FLING`/`SNAP` finding above): notifications dismiss by clicking their
close button.
OSD: volume/brightness pill, auto-hide, display-only (click-through, no drag).
Session: dim overlay, 4 action tiles, press-again confirm on the destructive
two, no per-tile stagger-pop entrance.

## Wallpaper

The compositor/desktop's own wallpaper shows through; kobel-shell paints no
wallpaper of its own (no canvas/PRNG generative art, no drifting petals --
neither was ever implemented in this codebase or the AGS port). The shell's
neutrals assume warm/violet art but don't require it.

## Anti-patterns enforced

No glassmorphism, no border+shadow ghost cards, no gradient
monogram icons, no dashed borders, no gradient text, no eyebrow labels, accent
never decorative. If a new surface needs one of these, redesign the surface.

## v3 addenda (post-critique rebuild)

- **Dock**: bottom-center opaque slab; flat icon tiles (CHIP background on hover,
  no scale/translate spring -- tile hover is a plain fill swap, not a magnify
  effect), running 4x4 dot → focused 12x4 leaf pill via a width spring
  (`DOCK_CYCLE`). Pinned + running, separator before unpinned.
- **Notifications**: right **drawer** (full-height rail, TOP+RIGHT+BOTTOM anchor),
  revealed by the same universal opacity spring every panel uses -- no x-axis
  slide on the drawer itself. Calendar is its own separate singleton surface
  (bar clock click), not part of the drawer. Toasts are the ones that actually
  slide (`motion::TOAST_IN`/`TOAST_OUT`, in from the right + fade, per-card) and
  float over content macOS-style at 82% opacity + blur — **the one sanctioned
  translucency**, contingent on a gnoblin blur window-rule (the archived C++
  stack proved the effect). OSD shares the treatment. Toasts suppress (route
  straight to the drawer's history) specifically while the drawer is open or
  DND is on -- not "any panel open".
- **Control centre**: chips drill into full sections (Wi-Fi networks with signal +
  connect flow, BT devices, per-app mixer under volume) via a slide transition
  (`motion::DRILL`/`DRILL_BACK`), swapping a forward chevron at the root for a
  distinct back chevron in the drill header -- not the same glyph rotating in
  place. The sheet's own height adapts to the active layer's measured content.
- **Quiet accent**: leaf fills = active chips, slider fills, primary buttons, today, badge, focus ring.
  Media art / decorative glyphs = neutral. Amber = anomaly (connecting…, gnoblin disconnected).
- **Failure states are canon**: media-empty ("Nothing playing" + Open Music), Wi-Fi connecting/…,
  gnoblin disconnected (amber row, "Reconnect", "osd + notifs handed back to gnome"), launcher
  no-results (a permanent last-row "Search the web for..." fallback, so results are never truly empty).
- **Keyboard path**: full keyboard-first interaction (typing, arrow-nav, Enter,
  Escape) exists on the two `KeyboardInteractivity::Exclusive` surfaces only --
  launcher (results list) and session (action tiles, press-again confirm on
  Restart/Shut down). Every other surface (quick settings, calendar, drawer,
  dock, bar) is pointer/hover-only -- sliders drag, notifications dismiss by
  click -- except Escape, which main.rs routes to close any open surface
  regardless of its keyboard-interactivity mode.
- OSD is display-only (pointer-events: none), compact, above the dock.
