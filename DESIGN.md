# Design

Visual system for kobel-shell ("sakura pop"). Register: **product** — see PRODUCT.md.
Live reference: `docs/prototype.html` (open in a browser; every value below is
implemented there and is the source of truth for the kobel-shell Rust/Freya build).

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
primary buttons, today-in-calendar, slider fills, badge/EQ data) — never as a tint,
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
- Floating panels: shadow only (`0 18px 40px` deep + `0 2px 8px` contact), **no border**.
- Inner tiles: surface-step only (panel2 on panel), **no border, no shadow**.
- Focus: 2px leaf `:focus-visible` outline, 2px offset — the only outline in the system.

## Motion

Physics, not keyframes. A shared damped-spring engine (stiffness k, damping d,
velocity-preserving, interruptible) drives every surface -- a closed-form damped
harmonic oscillator (`crates/kobel-shell/src/motion.rs`'s `SpringSpec`/`SpringSim`),
not a keyframed timeline; matches `Adw.SpringParams.new_full(damping, 1, stiffness)`
semantics.

| motion | spring |
|---|---|
| panel open | y/scale k420 d26 (slight overshoot), opacity k360 d32 |
| panel close | k640 d48 (fast, no bounce) |
| workspace pill morph | width k460 d21 |
| slider knob grab/release | scale k620 d20 → k420 d25 |
| toast in / out | x k360 d23 / k440 d36 |
| swipe dismiss | 1:1 drag, release fling inherits gesture velocity, k280 d27 |
| badge pop / bell shake | velocity impulse (`kick`), k400 d17 / k330 d7 |

Panel children stagger 34ms/row with an ease-out-back curve. Ambient motion
(falling petals, EQ bars) pauses under `prefers-reduced-motion`; springs settle
instantly.

## Components

Bar (42px, single opaque slab): launcher · workspace dots (active = 24px leaf pill) ·
running-app mini icons · focused title · centered clock+date (→ calendar/notifs) ·
status pill (net/vol/battery, wheelable volume) · bell+badge · power.
Launcher: search + flat-color icon tiles, `:` switches to gnoblinctl command rows;
full keyboard path. Quick settings: 2-col filled chips → sliders (+ per-app chevron) →
media card with EQ visualizer → CPU/MEM stats → user row → org.gnoblin.Shell row.
Notification centre: month calendar → header with rose Clear → swipeable cards
(velocity fling, height-collapse) → "All caught up" empty state.
OSD: volume pill, auto-hide 1.5s, draggable. Session: dim overlay, 4 stagger-pop
round buttons, shutdown hovers rose.

## Wallpaper

Generative sakura (canvas, seeded PRNG): periwinkle sky gradient, tapered dark
boughs with clustered 5-petal blossoms (pink-dominant), soft pink cluster glows,
edge vignette, 9 drifting petals animated at ~0 cost. In production this is a
user wallpaper; the shell's neutrals assume warm/violet art but don't require it.

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
  EQ/stats/avatar/art/decorative = neutral. Amber = anomaly (connecting…, gnoblin disconnected).
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
