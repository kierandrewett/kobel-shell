//! Phosphor Bold SVG sources used by the shell chrome.
//!
//! Assets are copied verbatim from phosphor-icons/core v2.0.8. Render them at
//! 16 logical pixels with Freya's `SvgViewer` and set `current_color` at the callsite.

pub const BATTERY_HIGH: &str = include_str!("../assets/icons/battery-high.svg");
pub const CALENDAR_BLANK: &str = include_str!("../assets/icons/calendar-blank.svg");
pub const CARET_DOWN: &str = include_str!("../assets/icons/caret-down.svg");
pub const SPEAKER_HIGH: &str = include_str!("../assets/icons/speaker-high.svg");
pub const WIFI_HIGH: &str = include_str!("../assets/icons/wifi-high.svg");

#[cfg(test)]
mod tests {
    use super::{BATTERY_HIGH, CALENDAR_BLANK, CARET_DOWN, SPEAKER_HIGH, WIFI_HIGH};

    #[test]
    fn every_icon_is_a_current_colour_svg() {
        for icon in [BATTERY_HIGH, CALENDAR_BLANK, CARET_DOWN, SPEAKER_HIGH, WIFI_HIGH] {
            assert!(icon.starts_with("<svg "));
            assert!(icon.contains("viewBox=\"0 0 256 256\""));
            assert!(icon.contains("fill=\"currentColor\""));
        }
    }
}
