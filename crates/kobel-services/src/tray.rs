//! StatusNotifier tray host (the AGS AstalTray replacement) via the
//! `system-tray` crate. CONTRACT TYPES are stable; machinery lands with the
//! phase-6 service task.
//!
//! Phase-6 scope: items + activate. DBusMenu rendering needs popup surface
//! design and is an explicit follow-up (docs/FREYA-PLAN.md section 6 note).

/// One StatusNotifierItem as the bar renders it.
#[derive(Debug, Clone, PartialEq)]
pub struct TrayItem {
    /// The item's bus address (stable key, used by activate commands).
    pub address: String,
    pub title: String,
    pub tooltip: Option<String>,
    /// Resolved icon: a theme/file path when available, else raw ARGB32 pixmap
    /// bytes with dimensions.
    pub icon: TrayIcon,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TrayIcon {
    Path(std::path::PathBuf),
    Pixmap { width: u32, height: u32, argb: Vec<u8> },
    None,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TraySnapshot {
    pub items: Vec<TrayItem>,
}
