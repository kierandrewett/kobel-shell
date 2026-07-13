//! NetworkManager service: Wi-Fi state, access points, connect. CONTRACT TYPES
//! are stable; machinery lands with the phase-5 service task (docs/FREYA-PLAN.md
//! section 5).

/// One visible access point (deduped by ssid, strongest kept).
#[derive(Debug, Clone, PartialEq)]
pub struct AccessPointInfo {
    pub ssid: String,
    /// 0..=100 signal strength.
    pub strength: u8,
    pub active: bool,
    pub secured: bool,
}

/// Wi-Fi state snapshot. `available` false when there is no Wi-Fi device
/// (desktop case) -- the QS chip hides, matching the AGS behaviour.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NetworkSnapshot {
    pub available: bool,
    pub enabled: bool,
    pub active_ssid: Option<String>,
    /// Strength of the active AP, 0 when none.
    pub active_strength: u8,
    /// Up to ~6 strongest APs, deduped by ssid, active first.
    pub aps: Vec<AccessPointInfo>,
}
