# Design

Visual system for kobel-shell: a faithful clone of **stock GNOME 49 (Adwaita dark)**.
See PRODUCT.md for the register and intent.

**Source of truth:** the running gnoblin shell theme, not this document.
`~/dev/gnoblin/subprojects/gnome-shell/data/theme/gnome-shell-sass/` (`_colors.scss`,
`_default-colors.scss`, `widgets/_panel.scss`, `_quick-settings.scss`, `_calendar.scss`,
`_message-list.scss`, `_dash.scss`) and the compiled `gnome-shell-dark.css`.
`crates/kobel-theme/src/lib.rs` holds the copied values; this file explains what they mean.

## Theme

One theme: Adwaita dark. Panels are fully opaque (gnoblin has no blur-behind protocol).
Elevation comes from surface value steps, matching GNOME.

## Colour (Adwaita dark, from _colors.scss / _default-colors.scss)

| token (`kobel_theme`) | value | GNOME source | use |
|---|---|---|---|
| `panel` | `#000000` | `$panel_bg_color` (`$dark_5`) | top bar |
| `popover` | `#36363a` | `$bg_color` | menu / sheet content |
| `card` | `#47474c` | `$card_bg_color` (`lighten($bg,7%)`) | cards, tiles, inactive toggles |
| `system` | `#38383b` | `$system_overlay_bg_color` | dash slab (opaque) |
| `hover` / `active` | lighter steps | `lighten($bg,...)` | hover / pressed fills |
| `text` | `#ffffff` | `stage` colour | primary text |
| `text_muted` | 70% white | `transparentize($fg,0.3)` | subtitles / secondary |
| `border` | 10% white | `transparentize($fg,0.9)` | hairline dividers |
| `accent` | `#3584e4` | `-st-accent-color` (default blue) | active toggles, today, sliders, focus |
| `accent_text` | `#ffffff` | `-st-accent-fg-color` | ink on accent |
| `danger` | `#c01c28` | `$red_4` (dark variant) | destructive |

The accent is GNOME's default blue. Runtime accent-colour following
(`org.gnome.desktop.interface accent-color`) is a known follow-up; blue is the baseline.

## Typography

- Font: **Adwaita Sans** (GNOME 48+ UI typeface), vendored variable weight axis.
- Panel: bold. Weights 400 / 500 / 700.
- No letter-spacing.
- Data (clock, %): GNOME applies `tnum` via `@extend %numeric`. Freya's pinned rev has no
  OpenType font-feature API, so the clock is Adwaita Sans bold **without** tabular figures.
  Wiring `tnum` needs a Freya patch (Skia paragraph `add_font_feature`). Accepted limitation.

## Icons

Adwaita symbolic icons, vendored from adwaita-icon-theme 49 and normalised to
`fill="currentColor"` so Freya's `SvgViewer::color(...)` tints them. Chrome glyph size is
16 logical pixels (`system-status-icon` = `1.091em`). Application artwork in the dock uses
`dock.icon_size` from the system icon theme, unchanged.

## Shape & elevation (from the widget SASS)

- Radii: quick-settings sheet 36 · datemenu popover 30 · popup-menu content 20 · cards /
  toggle-menu 12/24 · quick-toggle pills 999 (`$forced_circular_radius`) · calendar day 999.
- Panel/sheet roots carry no shadow; elevation is surface value steps. Shadow is reserved
  for tooltips and toasts.
- Focus: accent focus ring.

## Anatomy (from _panel.scss and status/system.js)

- **Panel** (`#panel`, 2.2em, black): workspace dots left, centred clock (opens the date
  menu), status-indicator cluster right (opens Quick Settings). No standalone power or
  notification button -- GNOME has neither in the panel.
- **Date menu** (clock): two columns -- notifications + media left, calendar + events right.
- **Quick Settings**: pill toggle grid (2 columns), brightness + volume sliders, a system
  row (settings / lock / power, with a shutdown submenu), drill submenus for Wi-Fi / BT /
  mixer.
- **Dock**: opaque `$system_overlay_bg_color` slab, flat tiles, running dots, a separator
  before unpinned apps, Show Applications grid.
- **Session**: the shutdown flow reached from the Quick Settings power button.

## Motion

Physics, not keyframes: an interruptible damped-spring engine drives every surface.
`prefers-reduced-motion` settles springs instantly.

## Implementation status

Landed (all core surfaces): Adwaita dark palette + semantic roles, Adwaita Sans, Adwaita
symbolic icons, pure-black panel with workspace dot and centred clock, the two-column date
menu (notifications + calendar, no standalone notification button), the grouped
status-indicator cluster opening Quick Settings, QS pill toggles + sliders + a system row
(settings / lock / power) whose power control opens a keyboard-navigable shutdown submenu
(Suspend / Restart / Power Off / Log out), the drill submenus, and the opaque dash with
running-dot indicators and GNOME rounding.
Known limitation: Freya's pinned rev exposes no OpenType font-feature API, so the panel clock
cannot use tabular figures (tnum) the way stock GNOME does.
