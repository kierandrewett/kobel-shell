//! THE token layer. Every surface (bar, dock, panels, launcher, calendar,
//! ...) sizes and colors from the constants in this file; change a value
//! here and the whole shell reflows. Ports, verbatim (values copied, not
//! invented):
//!   - `ags/config.ts` -- `Tokens` struct, `floating`/`gapless` presets,
//!     `ctl()`/`panelTop()` helpers.
//!   - `ags/style/main.scss` -- color custom properties (lines 4-16), radii
//!     scattered through the component rules.
//!   - `DESIGN.md` -- "Color (OKLCH)", "Typography", and "Shape &
//!     elevation" sections (semantics + cross-check for the scss-resolved
//!     values).
//!
//! See `docs/FREYA-PLAN.md` section 6 ("Component style: everything sizes
//! from theme.rs tokens").

// ---------------------------------------------------------------------------
// Geometry tokens (ags/config.ts)
// ---------------------------------------------------------------------------

/// Geometry tokens. Mirrors `ags/config.ts`'s `Tokens` interface
/// (config.ts:5-16) field for field; AGS ships plain `number` (px), we use
/// `f32` (Freya layout units).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tokens {
    /// Bar height (px); config.ts:6 `barH`. Bar controls and panel offsets
    /// derive from this.
    pub bar_h: f32,
    /// Bar corner radius (px); config.ts:7 `barR`.
    pub bar_r: f32,
    /// Screen gap: bar top offset, dock bottom offset (px); config.ts:8
    /// `gap`.
    pub gap: f32,
    /// Side insets (px); config.ts:9 `edge`.
    pub edge: f32,
    /// Dock/launcher icon tile size (px); config.ts:10 `icon`.
    pub icon: f32,
    /// Dock padding, concentric tile radius derives from it (px);
    /// config.ts:11 `dockPad`.
    pub dock_pad: f32,
    /// Quick-settings tile height (px); config.ts:12 `tileH`.
    pub tile_h: f32,
    /// Quick-settings/notifications/toasts panel width (px);
    /// config.ts:13 `panelW`.
    pub panel_w: f32,
    /// Launcher width (px); config.ts:14 `launcherW`.
    pub launcher_w: f32,
    /// Calendar width (px); config.ts:15 `calendarW`.
    pub calendar_w: f32,
}

impl Tokens {
    /// Bar control size. Ports `ags/config.ts:42` `export const ctl = () =>
    /// tokens.barH - 11`.
    pub const fn ctl(&self) -> f32 {
        self.bar_h - 11.0
    }

    /// Top offset for singleton panels (QS/drawer/calendar/launcher). Ports
    /// `ags/config.ts:43` `export const panelTop = () => tokens.gap +
    /// tokens.barH + 6`.
    pub const fn panel_top(&self) -> f32 {
        self.gap + self.bar_h + 6.0
    }
}

/// Default token preset. Ports `ags/config.ts:18-29` `export const
/// floating`.
pub const FLOATING: Tokens = Tokens {
    bar_h: 42.0,
    bar_r: 14.0,
    gap: 10.0,
    edge: 12.0,
    icon: 44.0,
    dock_pad: 5.0,
    tile_h: 54.0,
    panel_w: 365.0,
    launcher_w: 584.0,
    calendar_w: 336.0,
};

/// Gapless preset. Ports `ags/config.ts:32-38` `export const gapless = {
/// ...floating, barH: 38, barR: 0, gap: 0, edge: 0 }`; every other field is
/// inherited from `FLOATING` unchanged.
pub const GAPLESS: Tokens = Tokens {
    bar_h: 38.0,
    bar_r: 0.0,
    gap: 0.0,
    edge: 0.0,
    ..FLOATING
};

// ---------------------------------------------------------------------------
// Color tokens (ags/style/main.scss:4-16, DESIGN.md "Color (OKLCH)")
// ---------------------------------------------------------------------------

// scss pre-resolves DESIGN.md's OKLCH design values to sRGB hex (GTK CSS has
// no oklch()); we copy those already-resolved hex triples verbatim.

/// A hand-authored sRGB color token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    /// Freya's `.background(...)`/`.color(...)` take `impl Into<Fill>`, and
    /// `Fill`/`Color` implement `From<(u8, u8, u8)>` -- this is the bridge
    /// (see `.background((15, 163, 242))` in freya's own examples).
    pub const fn rgb(self) -> (u8, u8, u8) {
        (self.0, self.1, self.2)
    }
}

impl From<Rgb> for (u8, u8, u8) {
    fn from(c: Rgb) -> Self {
        c.rgb()
    }
}

/// Floating surfaces: bar, sheets, OSD, toasts.
/// `main.scss:4` `$panel: #100e14;` / DESIGN.md "panel".
pub const PANEL: Rgb = Rgb(16, 14, 20);
/// Tiles/rows inside a panel.
/// `main.scss:5` `$panel2: #1d1a22;` / DESIGN.md "panel2".
pub const PANEL2: Rgb = Rgb(29, 26, 34);
/// Tracks, inset wells, hover-of-panel2.
/// `main.scss:6` `$chip: #26232c;` / DESIGN.md "chip".
pub const CHIP: Rgb = Rgb(38, 35, 44);
/// Hover-of-chip.
/// `main.scss:7` `$hover: #322e39;` / DESIGN.md "hover".
pub const HOVER: Rgb = Rgb(50, 46, 57);
/// Primary text.
/// `main.scss:8` `$tx: #f3eef3;` / DESIGN.md "tx".
pub const TX: Rgb = Rgb(243, 238, 243);
/// Secondary text (>=4.5:1 contrast on `PANEL`).
/// `main.scss:9` `$mut: #b5adbc;` / DESIGN.md "mut".
pub const MUT: Rgb = Rgb(181, 173, 188);
/// Tertiary/decorative text only.
/// `main.scss:10` `$dim: #8d8693;` / DESIGN.md "dim".
pub const DIM: Rgb = Rgb(141, 134, 147);
/// THE accent: active fills, primary actions, live data. DESIGN.md rule:
/// solid fill + ink text only, never a tint/outline/wash.
/// `main.scss:11` `$leaf: #b5cb48;` / DESIGN.md "leaf".
pub const LEAF: Rgb = Rgb(181, 203, 72);
/// Accent hover/pressed.
/// `main.scss:12` `$leaf2: #96ae30;` / DESIGN.md "leaf2".
pub const LEAF2: Rgb = Rgb(150, 174, 48);
/// Text/icons painted on top of `LEAF` fills.
/// `main.scss:13` `$ink: #192003;` / DESIGN.md "ink".
pub const INK: Rgb = Rgb(25, 32, 3);
/// Destructive (Clear, dismiss, shutdown hover).
/// `main.scss:14` `$rose: #ef86a0;` / DESIGN.md "rose".
pub const ROSE: Rgb = Rgb(239, 134, 160);
/// Text/icons painted on top of `ROSE` fills (the rose analogue of `INK`).
/// Not itemized in DESIGN.md's color table; `main.scss:15` `$roseink:
/// #4b0f1f;`.
pub const ROSEINK: Rgb = Rgb(75, 15, 31);
/// Warnings / anomaly state (gnoblin disconnected, connecting...). Reserved
/// per DESIGN.md; used for the v3 amber anomaly rows.
/// `main.scss:16` `$amber: #edbb64;` / DESIGN.md "amber".
pub const AMBER: Rgb = Rgb(237, 187, 100);
/// Calendar event-chip fill: the colored 26x26 icon slab on a calendar event
/// row. A one-off decorative fill, not a core palette token; `main.scss:942`
/// `.evrow .evic { background-color: #628933; }`.
pub const EVENT_CHIP: Rgb = Rgb(98, 137, 51);

// ---------------------------------------------------------------------------
// Radii (ags/style/main.scss, DESIGN.md "Shape & elevation")
// ---------------------------------------------------------------------------

// Bar radius is NOT a constant here: it is `Tokens::bar_r` (14 in FLOATING,
// 0 in GAPLESS) since it is a per-preset value, not a fixed design constant.

/// Sheet (floating panel) corner radius: bar/sheets/OSD/toasts/launcher/etc.
/// `main.scss:294` `.sheet { border-radius: 24px; }`.
pub const RADIUS_SHEET: f32 = 24.0;
/// Tile / icon-tile corner radius (dock tiles, launcher tiles, media art).
/// `main.scss:212` `.dbtn { border-radius: 12px; }`, `:218` `.icon-tile {
/// ... }`.
pub const RADIUS_TILE: f32 = 12.0;
/// Row corner radius (notification rows, calendar event rows, etc).
/// `main.scss:771` `.row { border-radius: 10px; }`.
pub const RADIUS_ROW: f32 = 10.0;
/// Button corner radius (bar icon buttons, quick-settings buttons).
/// `main.scss:126` `.ibtn { ... border-radius: 9px; }`.
pub const RADIUS_BUTTON: f32 = 9.0;
/// Pill / knob / badge corner radius (fully round at any realistic size).
/// `main.scss:150` `.status { ... border-radius: 999px; }` (one of many
/// 999px sites: chips, switches, sliders, badges).
pub const RADIUS_PILL: f32 = 999.0;
/// Card corner radius (notification cards, toasts, empty-state cards).
/// `main.scss:986` `.ncard { border-radius: 20px; }` (`.toast`:973 and
/// `.nempty`:1163 share the same 20px radius).
pub const RADIUS_CARD: f32 = 20.0;

// ---------------------------------------------------------------------------
// Typography (ags/style/main.scss:21-28, DESIGN.md "Typography")
// ---------------------------------------------------------------------------

/// Base UI font size (px). `main.scss:23` `window { font-size: 13px; }`.
pub const FONT_SIZE_BASE: f32 = 13.0;
/// Smallest size in the fixed, non-fluid type scale.
/// DESIGN.md "Typography": "Sizes 10.5-14.5px fixed rem-free scale (product
/// register: no fluid type)".
pub const FONT_SIZE_MIN: f32 = 10.5;
/// Largest size in the fixed, non-fluid type scale (see `FONT_SIZE_MIN`).
pub const FONT_SIZE_MAX: f32 = 14.5;

/// UI font weights actually used in the system.
/// DESIGN.md "Typography": "Weights 400/600/650".
pub const FONT_WEIGHT_REGULAR: u16 = 400;
/// See `FONT_WEIGHT_REGULAR`.
pub const FONT_WEIGHT_SEMIBOLD: u16 = 600;
/// See `FONT_WEIGHT_REGULAR`.
pub const FONT_WEIGHT_BOLD: u16 = 650;

/// UI font family stack. `main.scss:22` `font-family: "Inter", "Inter
/// Variable", "InterVariable", sans-serif;`.
pub const FONT_FAMILY_UI: &[&str] = &["Inter", "Inter Variable", "InterVariable", "sans-serif"];

/// Data font family: every number (clock, %, times, dates, D-Bus names)
/// uses this with tabular figures instead of the UI font.
/// DESIGN.md "Typography": "Data: `ui-monospace` with
/// `font-variant-numeric: tabular-nums` for every number -- clock, %,
/// times, dates, D-Bus names."
/// `main.scss:26-28` `.tn { font-feature-settings: "tnum"; }` is the GTK
/// CSS mechanism for the same rule.
pub const FONT_FAMILY_DATA: &str = "ui-monospace";
/// OpenType feature tag enabling tabular figures for `FONT_FAMILY_DATA`
/// text. `main.scss:27` `font-feature-settings: "tnum";`.
pub const FONT_FEATURE_TABULAR: &str = "tnum";

#[cfg(test)]
mod tests {
    use super::*;

    /// Locks `ctl()`/`panel_top()` against their AGS-ported values (config.ts:42-43)
    /// for both presets -- this file's own doc says "change a value here and the
    /// whole shell reflows", so a silent edit to either formula (not just the raw
    /// constants) should fail a test, not just look different live.
    #[test]
    fn floating_preset_derived_values_match_ags_config_ts() {
        // config.ts: ctl() = barH - 11 = 42 - 11 = 31.
        assert_eq!(FLOATING.ctl(), 31.0);
        // config.ts: panelTop() = gap + barH + 6 = 10 + 42 + 6 = 58.
        assert_eq!(FLOATING.panel_top(), 58.0);
    }

    #[test]
    fn gapless_preset_derived_values_match_ags_config_ts() {
        // config.ts: ctl() = barH - 11 = 38 - 11 = 27.
        assert_eq!(GAPLESS.ctl(), 27.0);
        // config.ts: panelTop() = gap + barH + 6 = 0 + 38 + 6 = 44.
        assert_eq!(GAPLESS.panel_top(), 44.0);
    }
}
