//! BlueZ service: adapter power + devices. CONTRACT TYPES are stable; machinery
//! lands with the phase-5 service task (docs/FREYA-PLAN.md section 5).

/// One known bluetooth device.
#[derive(Debug, Clone, PartialEq)]
pub struct BtDevice {
    /// Object-path-safe address, e.g. `AA:BB:CC:DD:EE:FF`.
    pub address: String,
    pub alias: String,
    pub connected: bool,
    pub paired: bool,
}

/// Bluetooth snapshot. `available` false when no adapter exists.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BluetoothSnapshot {
    pub available: bool,
    pub powered: bool,
    /// Paired/known devices, connected first.
    pub devices: Vec<BtDevice>,
}
