# Product

## Register

product

## Users

Kieran (the author, a systems developer who lives in his desktop all day) and gnoblin
adopters -- Linux power users who chose a stripped, patched GNOME specifically so they
could bring their own chrome, rendered by a fast native stack. They know exactly what
stock GNOME looks and feels like and will instantly clock anything that is "almost
GNOME but off": wrong spacing, wrong weight, wrong icon language, laggy popovers.
Context of use: every hour of every day, as the ambient frame around all other work.

## Product Purpose

kobel-shell is the complete chrome suite for gnoblin, built in Rust with Freya as the
UI framework, rendered by our own wlr-layer-shell host (no winit, no GTK): top bar,
quick-settings, the clock date menu (calendar + notifications), dock, session controls.
gnoblin vacates the space (no gnome panel/dash/OSD); kobel fills all of it and drives
gnoblin live over org.gnoblin.Shell.

The visual target is a **faithful clone of stock GNOME 49 (Adwaita dark)**. Success =
a gnoblin user cannot tell, at a glance, that the chrome is not the real gnome-shell it
replaced -- same anatomy, same colours, same typeface, same icon language -- while being
buttery and instant because it is native Rust/Skia rather than GJS.

The source of truth for every visual value is the running gnoblin shell theme:
`~/dev/gnoblin/subprojects/gnome-shell/data/theme/gnome-shell-sass` (and the compiled
`gnome-shell-dark.css`). Values are copied from there, never invented.

## Brand Personality

Invisible correctness. The shell should read as stock GNOME, not as a re-skin or a
"GNOME-inspired" theme. Personality lives in performance (native springs, instant
popovers), not in a distinct visual identity. If a detail differs from stock GNOME,
that is a bug, not a style choice.

## Anti-references

- A custom identity layered over GNOME (recoloured accents, bespoke surfaces,
  non-Adwaita icon packs). The earlier "sakura pop" direction was explicitly dropped:
  the shell now clones GNOME rather than replacing its look.
- Phosphor / Lucide / any non-Adwaita icon set in the chrome. Stock GNOME uses Adwaita
  symbolic icons.
- Glassmorphism / blur-behind. gnoblin has no blur-behind protocol; GNOME surfaces are
  honestly opaque and so are ours.
- "Almost GNOME": correct colours on the wrong structure (calendar-only clock popup, an
  invented quick-settings header, a standalone power button in the panel). Structure and
  anatomy must match GNOME, not just the palette.

## Design Principles

1. **Match the source.** Colours, radii, spacing, font and icons come from the gnoblin
   shell SASS, not from taste. When in doubt, read the stylesheet.
2. **Match the anatomy.** The panel is minimal (workspace dots, centred clock, status
   cluster). Power/lock/settings live in Quick Settings; notifications live in the clock
   date menu. There is no bespoke chrome GNOME does not have.
3. **Honest materials.** Opaque panels; no effect the compositor cannot render.
4. **Motion is native.** Every state change is an interruptible spring; if it cannot
   animate at 60fps it does not ship. This is where kobel earns its keep over GJS.
5. **Dogfood gnoblin.** org.gnoblin.Shell is a first-class surface (soft reload, feature
   ownership, screencast grants).

## Accessibility & Inclusion

- `prefers-reduced-motion` honoured everywhere: springs settle instantly on target.
- Text contrast follows Adwaita dark (white / 70% white on the GNOME surface greys).
- Full keyboard path on the keyboard-exclusive surfaces (launcher, session); every other
  surface is pointer/hover-only plus Escape-to-close.
- Hit targets follow GNOME's panel-button and quick-toggle sizing.
