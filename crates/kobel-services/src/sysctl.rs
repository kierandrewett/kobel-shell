//! Small system controls: brightness (logind SetBrightness + sysfs read),
//! power profiles (net.hadess.PowerProfiles), and the two GNOME settings the
//! shell toggles (dark style, night light). CONTRACT TYPES are stable;
//! machinery lands with the phase-5 service task (docs/FREYA-PLAN.md section 5).

/// Backlight snapshot. `available` false without a backlight device (desktops).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BrightnessSnapshot {
    pub available: bool,
    /// 0.0..=1.0 of max brightness.
    pub level: f32,
}

/// The active power profile, mirroring net.hadess.PowerProfiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PowerProfile {
    PowerSaver,
    #[default]
    Balanced,
    Performance,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PowerSnapshot {
    pub available: bool,
    pub profile: PowerProfile,
}

/// GNOME interface settings the QS chips drive.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SettingsSnapshot {
    pub dark_style: bool,
    pub night_light: bool,
}
