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
    /// Phosphor Bold chrome glyph size. Application artwork uses `dock.icon_size`.
    pub chrome_icon_size: f32,
    pub bar: BarTokens,
    pub dock: DockTokens,
    pub popover: PopoverTokens,
    pub notifications: NotificationTokens,
    pub quick_settings: QuickSettingsTokens,
    pub session: SessionTokens,
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
    pub muted_opacity: f32,
    pub notification_gap: f32,
    pub compact_width: f32,
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
    pub surface_height: u32,
    pub max_width_ratio: f32,
    pub min_item_size: f32,
    pub separator_width: f32,
    pub item_radius_ratio: f32,
    pub fallback_radius_ratio: f32,
    pub fallback_icon_scale: f32,
    pub focus_border_width: f32,
    pub indicator_gap: f32,
    pub indicator_bottom: f32,
    pub tooltip_headroom: u32,
    pub tooltip_initial_scale: f32,
    pub tooltip_padding: (f32, f32),
    pub tooltip_shadow_y: f32,
    pub tooltip_shadow_blur: f32,
    pub open_initial_scale: f32,
    pub shadow_y: f32,
    pub shadow_blur: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PopoverTokens {
    pub width: u32,
    pub max_height: u32,
    pub screen_inset: u32,
    pub compact_width: u32,
    pub padding: f32,
    pub section_gap: f32,
    pub row_gap: f32,
    pub radius: f32,
    pub row_radius: f32,
    pub control_height: f32,
    pub control_padding: f32,
    pub indicator_size: f32,
    pub border_width: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NotificationTokens {
    pub card_padding: f32,
    pub card_gap: f32,
    pub empty_state_height: f32,
    pub header_height: f32,
    pub header_text_gap: f32,
    pub body_text_gap: f32,
    pub dismiss_size: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QuickSettingsTokens {
    pub chip_height_ratio: f32,
    pub slider_label_width: f32,
    pub slider_value_width: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SessionTokens {
    pub tile_width: f32,
    pub tile_gap: f32,
    pub tile_size: f32,
    pub tile_radius: f32,
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
    chrome_icon_size: 16.0,
    bar: BarTokens {
        height: 32,
        horizontal_padding: 12.0,
        module_gap: 6.0,
        control_height: 24.0,
        control_padding: 8.0,
        radius: 999.0,
        muted_opacity: 0.65,
        notification_gap: 4.0,
        compact_width: 520.0,
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
        surface_height: 120,
        max_width_ratio: 0.9,
        min_item_size: 24.0,
        separator_width: 1.0,
        item_radius_ratio: 0.66,
        fallback_radius_ratio: 0.55,
        fallback_icon_scale: 0.5,
        focus_border_width: 2.0,
        indicator_gap: 2.0,
        indicator_bottom: 3.0,
        tooltip_headroom: 56,
        tooltip_initial_scale: 0.96,
        tooltip_padding: (6.0, 10.0),
        tooltip_shadow_y: 5.0,
        tooltip_shadow_blur: 16.0,
        open_initial_scale: 0.94,
        shadow_y: 4.0,
        shadow_blur: 18.0,
    },
    popover: PopoverTokens {
        width: 384,
        max_height: 620,
        screen_inset: 12,
        compact_width: 368,
        padding: 16.0,
        section_gap: 16.0,
        row_gap: 8.0,
        radius: 18.0,
        row_radius: 12.0,
        control_height: 36.0,
        control_padding: 12.0,
        indicator_size: 3.0,
        border_width: 1.0,
    },
    notifications: NotificationTokens {
        card_padding: 12.0,
        card_gap: 8.0,
        empty_state_height: 96.0,
        header_height: 38.0,
        header_text_gap: 2.0,
        body_text_gap: 4.0,
        dismiss_size: 28.0,
    },
    quick_settings: QuickSettingsTokens {
        chip_height_ratio: 1.5,
        slider_label_width: 72.0,
        slider_value_width: 40.0,
    },
    session: SessionTokens {
        tile_width: 78.0,
        tile_gap: 8.0,
        tile_size: 64.0,
        tile_radius: 20.0,
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
    use super::{FONT_DATA, TOKENS};

    #[test]
    fn bundled_font_is_a_nonempty_sfnt() {
        assert_eq!(&FONT_DATA[..4], &[0, 1, 0, 0]);
        assert!(u16::from_be_bytes([FONT_DATA[4], FONT_DATA[5]]) > 0);
    }

    #[test]
    fn phosphor_chrome_icons_use_sixteen_logical_pixels() {
        assert_eq!(TOKENS.chrome_icon_size, 16.0);
    }

    #[test]
    fn dock_surface_reserves_exact_tooltip_headroom() {
        let slab_height = (TOKENS.dock.item_size + TOKENS.dock.padding * 2.0).ceil() as u32;
        assert_eq!(TOKENS.dock.surface_height, TOKENS.dock.tooltip_headroom + slab_height,);
    }
}
