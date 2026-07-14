# Archived Freya UI

This directory preserves the first complete Freya UI removed from the active workspace when `kobel-shell` became a UI-neutral core library.

It is reference material, not a Cargo package and not a starting template. The new UI belongs in `crates/kobel-ui`; copy individual ideas deliberately rather than restoring this tree wholesale.

The last directly runnable version is Git commit `da3a7ec`. Use that commit when exact build context or history matters.

Contents:

- `src/ui/`: concrete bar, dock, launcher, panels, notifications and menus
- `src/main.rs`: old surface mounting and service fan-out implementation
- `src/theme.rs`: old sakura-pop design tokens
- `src/motion.rs`: compatibility copy of the old named motion values
- `assets/`: old shell icon assets
- `examples/render_panel.rs`: old headless panel renderer
