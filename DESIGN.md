# Design

Visual system for kobel-shell ("sakura pop"). Register: **product** — see PRODUCT.md.
Live reference: `docs/prototype.html` (open in a browser; every value below is
implemented there and is the source of truth for the QML build).

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

- Radii: panels 16px · tiles/rows 12px · buttons 10px · pills/knobs/badges 999.
  Nothing above 16px.
- Floating panels: shadow only (`0 18px 40px` deep + `0 2px 8px` contact), **no border**.
- Inner tiles: surface-step only (panel2 on panel), **no border, no shadow**.
- Focus: 2px leaf `:focus-visible` outline, 2px offset — the only outline in the system.

## Motion

Physics, not keyframes. A shared damped-spring engine (stiffness k, damping d,
velocity-preserving, interruptible) drives every surface; maps 1:1 to QML
`SpringAnimation { spring; damping }`.

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

No glassmorphism, no border+shadow ghost cards, no >16px radii, no gradient
monogram icons, no dashed borders, no gradient text, no eyebrow labels, accent
never decorative. If a new surface needs one of these, redesign the surface.

## v3 addenda (post-critique rebuild)

- **Dock**: bottom-center opaque slab; flat icon tiles, spring magnify (k420 d22, scale 1.16 / y −4),
  running dot → focused 14px leaf pill. Pinned + running, separator before unpinned.
- **Notifications**: right **slide-out drawer** (full height, x-axis spring) with calendar + today
  button; toasts float over content macOS-style at 82% opacity + blur — **the one sanctioned
  translucency**, contingent on a gnoblin blur window-rule (the archived C++ stack proved the effect).
  OSD shares the treatment. Toasts route straight to the drawer when any panel is open or Silent is on.
- **Control centre**: chips grow chevron-expandable sections (Wi-Fi networks with signal + connect
  flow, BT devices, per-app mixer under volume) — height springs, chevron rotates 90°.
- **Quiet accent**: leaf fills = active chips, slider fills, primary buttons, today, badge, focus ring.
  EQ/stats/avatar/art/decorative = neutral. Amber = anomaly (connecting…, gnoblin disconnected).
- **Failure states are canon**: media-empty ("Nothing playing" + Open Music), Wi-Fi connecting/…,
  gnoblin disconnected (amber row, "Reconnect", "osd handed back to gnome"), launcher no-results
  ("↵ to search the web"). Failure tour: the 4th demo button or `#fail`.
- **Keyboard path**: everything is a real button; sliders are `role=slider` with arrow keys; session
  has arrow-nav + focus trap entry + two-step confirm on Restart/Shut down; Del dismisses a focused
  notification; focus returns to the invoker on close.
- OSD is display-only (pointer-events: none), compact, above the dock.
