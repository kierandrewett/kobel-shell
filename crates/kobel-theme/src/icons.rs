//! Adwaita symbolic SVG sources used by the shell chrome.
//!
//! Vendored from adwaita-icon-theme (GNOME 49) and normalised to
//! `fill="currentColor"` so Freya's `SvgViewer::color(...)` tints them. Constant
//! names are bar/dock roles; the file each points at is the matching stock GNOME
//! symbolic glyph. Render the byte slices at 16 logical pixels.

pub const ARROW_CLOCKWISE: &[u8] = include_bytes!("../assets/icons/view-refresh-symbolic.svg");
pub const BATTERY_HIGH: &[u8] = include_bytes!("../assets/icons/battery-level-100-symbolic.svg");
pub const BELL: &[u8] = include_bytes!("../assets/icons/bell-symbolic.svg");
pub const CARET_LEFT: &[u8] = include_bytes!("../assets/icons/go-previous-symbolic.svg");
pub const CARET_RIGHT: &[u8] = include_bytes!("../assets/icons/go-next-symbolic.svg");
pub const CALENDAR_BLANK: &[u8] = include_bytes!("../assets/icons/x-office-calendar-symbolic.svg");
pub const DOTS_NINE: &[u8] = include_bytes!("../assets/icons/view-app-grid-symbolic.svg");
pub const CARET_DOWN: &[u8] = include_bytes!("../assets/icons/pan-down-symbolic.svg");
pub const LOCK: &[u8] = include_bytes!("../assets/icons/system-lock-screen-symbolic.svg");
pub const SETTINGS: &[u8] = include_bytes!("../assets/icons/preferences-system-symbolic.svg");
pub const SUSPEND: &[u8] = include_bytes!("../assets/icons/media-playback-pause-symbolic.svg");
pub const SPEAKER_HIGH: &[u8] = include_bytes!("../assets/icons/audio-volume-high-symbolic.svg");
pub const WIFI_HIGH: &[u8] = include_bytes!("../assets/icons/network-wireless-signal-excellent-symbolic.svg");
pub const POWER: &[u8] = include_bytes!("../assets/icons/system-shutdown-symbolic.svg");
pub const SIGN_OUT: &[u8] = include_bytes!("../assets/icons/system-log-out-symbolic.svg");
pub const X: &[u8] = include_bytes!("../assets/icons/window-close-symbolic.svg");
pub const BLUETOOTH: &[u8] = include_bytes!("../assets/icons/bluetooth-active-symbolic.svg");
pub const POWER_SAVER: &[u8] = include_bytes!("../assets/icons/power-profile-power-saver-symbolic.svg");
pub const DARK_STYLE: &[u8] = include_bytes!("../assets/icons/weather-clear-night-symbolic.svg");
pub const MUTED: &[u8] = include_bytes!("../assets/icons/audio-volume-muted-symbolic.svg");
pub const NIGHT_LIGHT: &[u8] = include_bytes!("../assets/icons/night-light-symbolic.svg");

#[cfg(test)]
mod tests {
    use super::{
        ARROW_CLOCKWISE, BATTERY_HIGH, BELL, BLUETOOTH, CALENDAR_BLANK, CARET_DOWN, CARET_LEFT, CARET_RIGHT,
        DARK_STYLE, DOTS_NINE, LOCK, MUTED, NIGHT_LIGHT, POWER, POWER_SAVER, SETTINGS, SIGN_OUT, SPEAKER_HIGH, SUSPEND,
        WIFI_HIGH, X,
    };

    #[test]
    fn every_icon_is_a_current_colour_svg() {
        for icon in [
            ARROW_CLOCKWISE,
            BATTERY_HIGH,
            BELL,
            CALENDAR_BLANK,
            DOTS_NINE,
            CARET_DOWN,
            CARET_LEFT,
            CARET_RIGHT,
            LOCK,
            SETTINGS,
            SUSPEND,
            POWER,
            SIGN_OUT,
            SPEAKER_HIGH,
            WIFI_HIGH,
            X,
            BLUETOOTH,
            POWER_SAVER,
            DARK_STYLE,
            MUTED,
            NIGHT_LIGHT,
        ] {
            let icon = std::str::from_utf8(icon).expect("symbolic SVG must be UTF-8");
            assert!(icon.starts_with("<svg "));
            assert!(icon.contains("viewBox=\"0 0 16 16\""));
            assert!(icon.contains("fill=\"currentColor\""));
        }
    }
}
