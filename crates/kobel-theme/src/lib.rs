//! Restyleable design tokens and vendored presentation assets for Kobel UI crates.
//!
//! This crate deliberately knows nothing about Wayland, Freya, services or shell
//! behaviour. Presentation crates consume [`TOKENS`], [`FONT_DATA`] and [`icons`]
//! so visual policy has one human-readable source of truth.

pub mod icons;

/// Family name registered with `kobel_wayland::Shell::with_font`.
pub const FONT_FAMILY: &str = "Geist Sans";

/// Geist Sans variable font, vendored from vercel/geist-font v1.7.2.
pub const FONT_DATA: &[u8] = include_bytes!("../assets/fonts/Geist[wght].ttf");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgba(pub u8, pub u8, pub u8, pub u8);

impl Rgba {
    /// Tuple accepted directly by Freya's `Fill` and `Color` conversions.
    pub const fn rgba(self) -> (u8, u8, u8, u8) {
        (self.0, self.1, self.2, self.3)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    pub colours: ColourTokens,
    pub typography: TypeTokens,
    pub bar: BarTokens,
    pub dock: DockTokens,
    pub popover: PopoverTokens,
    pub motion: MotionTokens,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ColourTokens {
    pub text: Rgba,
    pub text_muted: Rgba,
    pub surface: Rgba,
    pub surface_elevated: Rgba,
    pub surface_hover: Rgba,
    pub surface_active: Rgba,
    pub border: Rgba,
    pub accent: Rgba,
    pub accent_text: Rgba,
    pub danger: Rgba,
    pub shadow: Rgba,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TypeTokens {
    pub family: &'static str,
    pub title_size: f32,
    pub body_size: f32,
    pub small_size: f32,
    pub label_size: f32,
    pub regular_weight: i32,
    pub medium_weight: i32,
    pub semibold_weight: i32,
    /// Applied to labels as a percentage of font size.
    pub tracking_percent: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BarTokens {
    pub height: u32,
    pub horizontal_padding: f32,
    pub module_gap: f32,
    pub control_height: f32,
    pub control_padding: f32,
    pub radius: f32,
    pub icon_size: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DockTokens {
    pub item_size: f32,
    pub icon_size: f32,
    pub padding: f32,
    pub item_gap: f32,
    pub edge_gap: i32,
    pub radius: f32,
    pub background_opacity: u8,
    pub hover_scale: f32,
    pub indicator_active_scale: f32,
    pub indicator_size: f32,
    pub tooltip_offset: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PopoverTokens {
    pub width: u32,
    pub max_height: u32,
    pub padding: f32,
    pub section_gap: f32,
    pub row_gap: f32,
    pub radius: f32,
    pub row_radius: f32,
    pub control_height: f32,
    pub control_padding: f32,
    pub icon_size: f32,
    pub indicator_size: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionTokens {
    pub fast_seconds: f32,
    pub standard_seconds: f32,
    pub dock_seconds: f32,
    pub tooltip_delay_millis: u64,
}

/// Default visual language. Change values here rather than scattering constants
/// through bar, dock or panel components.
pub const TOKENS: Tokens = Tokens {
    colours: ColourTokens {
        text: Rgba(238, 239, 242, 255),
        text_muted: Rgba(170, 173, 183, 255),
        surface: Rgba(28, 29, 33, 255),
        surface_elevated: Rgba(39, 40, 46, 255),
        surface_hover: Rgba(52, 53, 60, 255),
        surface_active: Rgba(69, 71, 81, 255),
        border: Rgba(78, 80, 91, 255),
        accent: Rgba(137, 180, 250, 255),
        accent_text: Rgba(18, 23, 33, 255),
        danger: Rgba(242, 139, 130, 255),
        shadow: Rgba(0, 0, 0, 115),
    },
    typography: TypeTokens {
        family: FONT_FAMILY,
        title_size: 15.0,
        body_size: 13.0,
        small_size: 12.0,
        label_size: 13.0,
        regular_weight: 400,
        medium_weight: 500,
        semibold_weight: 600,
        tracking_percent: -3.0,
    },
    bar: BarTokens {
        height: 32,
        horizontal_padding: 12.0,
        module_gap: 6.0,
        control_height: 24.0,
        control_padding: 8.0,
        radius: 999.0,
        icon_size: 16.0,
    },
    dock: DockTokens {
        item_size: 48.0,
        icon_size: 36.0,
        padding: 8.0,
        item_gap: 4.0,
        edge_gap: 8,
        radius: 18.0,
        background_opacity: 204,
        hover_scale: 1.08,
        indicator_active_scale: 1.75,
        indicator_size: 4.0,
        tooltip_offset: 10,
    },
    popover: PopoverTokens {
        width: 384,
        max_height: 620,
        padding: 16.0,
        section_gap: 16.0,
        row_gap: 8.0,
        radius: 18.0,
        row_radius: 12.0,
        control_height: 36.0,
        control_padding: 12.0,
        icon_size: 16.0,
        indicator_size: 3.0,
    },
    motion: MotionTokens {
        fast_seconds: 0.12,
        standard_seconds: 0.2,
        dock_seconds: 0.2,
        tooltip_delay_millis: 450,
    },
};

#[cfg(test)]
mod tests {
    use super::FONT_DATA;

    #[test]
    fn bundled_font_is_a_nonempty_sfnt() {
        assert_eq!(&FONT_DATA[..4], &[0, 1, 0, 0]);
        assert!(u16::from_be_bytes([FONT_DATA[4], FONT_DATA[5]]) > 0);
    }
}
