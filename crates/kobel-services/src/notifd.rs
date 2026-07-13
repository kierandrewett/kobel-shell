//! Notification daemon: WE OWN org.freedesktop.Notifications (the AGS AstalNotifd
//! replacement, docs/FREYA-PLAN.md section 5). CONTRACT TYPES are stable; the zbus
//! server machinery lands with the phase-6 service task.
//!
//! Ownership handshake: `SetFeature("notifications", false)` frees the bus name
//! from gnoblin/gnome-shell before we claim it; on shutdown the feature is handed
//! back. Requires a running gnoblin session to actually take over.

/// One notification, mirroring the org.freedesktop.Notifications Notify args the
/// shell renders.
#[derive(Debug, Clone, PartialEq)]
pub struct Notification {
    /// Server-assigned id (returned from Notify, used by CloseNotification).
    pub id: u32,
    pub app_name: String,
    /// Themed icon name or file path from app_icon / image hints, if any.
    pub app_icon: Option<String>,
    pub summary: String,
    pub body: String,
    /// (action_key, label) pairs.
    pub actions: Vec<(String, String)>,
    /// True for resident/critical notifications that should not auto-expire.
    pub critical: bool,
    /// Unix seconds at receipt.
    pub time: i64,
}

/// The notification store + do-not-disturb flag. `serving` is false until the
/// bus name is actually owned (e.g. outside a gnoblin session).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NotifdSnapshot {
    pub serving: bool,
    pub dnd: bool,
    /// Newest first, capped (~50, persisted across restarts).
    pub notifications: Vec<Notification>,
}
