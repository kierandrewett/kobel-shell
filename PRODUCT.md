# Product

## Register

product

## Users

Kieran (the author, a systems developer who lives in his desktop all day) and gnoblin
adopters — Linux power users who chose a stripped, patched GNOME specifically so they
could bring their own chrome. They are fluent in the category's best work (AGS/Aylur
shells, end-4's illogical-impulse, caelestia) and will instantly clock anything
generic, laggy, or "vibe-coded". Context of use: every hour of every day, as the
ambient frame around all other work.

## Product Purpose

kobel-shell is the complete chrome suite for gnoblin, built in Rust with Freya as
the UI framework, rendered by our own wlr-layer-shell host (no winit, no GTK): top
bar, launcher, quick-settings dashboard, notification centre with calendar, media +
OSD, session controls. gnoblin vacates the space (no gnome panel/dash/OSD); kobel
fills all of it and drives gnoblin live over org.gnoblin.Shell. Success = it feels
better than the gnome-shell it replaced — buttery, instant, personal — and other
gnoblin users want to steal it.

## Brand Personality

Playful precision. Three words: **buttery, playful, exacting**. The energy of the
sakura-pop rice scene (bright filled chips, colourful icons, warm art behind dark
chrome) executed with instrument-grade discipline (real spring physics, tabular
numerals, consistent affordances). Delight lives in motion and moments, never in
decoration for its own sake.

## Anti-references

- The 70 rejected explorations from July 2026: recolored rice templates, corporate
  design-system cosplay, static pictures of shells.
- Glassmorphism-by-default — gnoblin has no blur-behind protocol; fake frost is a lie.
  Surfaces are honestly opaque.
- The AI-default azure/indigo accent, cream/sand surfaces, ghost-cards
  (1px border + soft wide shadow), 24px+ rounding, gradient-monogram "app icons".
- Stock GNOME Adwaita — the thing gnoblin exists to strip.

## Design Principles

1. **Motion is the product.** Every state change is a spring — interruptible,
   velocity-preserving, never a keyframe that snaps. If it can't animate at 60fps,
   it doesn't ship.
2. **Honest materials.** Opaque panels with real elevation. No effect the real
   compositor can't render.
3. **Accent is earned.** The leaf accent appears only as active state, primary action,
   and live data — solid fills with dark ink text, never tints-as-decoration.
4. **Data wears tabular.** Times, percentages, metrics render in a monospace face
   with tabular numerals (`tnum`) so digits align like an instrument (see
   DESIGN.md's typography section for the exact family split).
5. **Dogfood gnoblin.** org.gnoblin.Shell is a visible, first-class surface (soft
   reload, feature ownership, screencast grants) — the shell demos the compositor.

## Accessibility & Inclusion

- `prefers-reduced-motion` honored everywhere: springs settle instantly, ambient
  animation (visualizer, petals) freezes.
- Text contrast ≥ 4.5:1 on all surfaces, including muted/secondary text.
- Full keyboard path: launcher is keyboard-first (type, arrows, Enter, Escape),
  every interactive element has a visible :focus-visible ring.
- Hit targets ≥ 24px in the bar, ≥ 32px in panels.
