//! Motion values used by the archived Freya UI.
//!
//! The spring implementation now lives in the UI-neutral `kobel-shell` crate. These
//! named values are retained here only so the archived components remain readable.

pub use kobel_shell::motion::*;

pub const PANEL_OPEN: SpringSpec = SpringSpec { k: 420.0, d: 26.0 };
pub const PANEL_OPACITY: SpringSpec = SpringSpec { k: 360.0, d: 32.0 };
pub const PANEL_CLOSE: SpringSpec = SpringSpec { k: 640.0, d: 48.0 };
pub const DRILL: SpringSpec = SpringSpec { k: 400.0, d: 27.0 };
pub const DRILL_BACK: SpringSpec = SpringSpec { k: 440.0, d: 29.0 };
pub const HEIGHT: SpringSpec = SpringSpec { k: 440.0, d: 32.0 };
pub const TOAST_IN: SpringSpec = SpringSpec { k: 360.0, d: 23.0 };
pub const TOAST_OUT: SpringSpec = SpringSpec { k: 440.0, d: 36.0 };
pub const BADGE_POP: SpringSpec = SpringSpec { k: 400.0, d: 17.0 };
pub const BELL_SHAKE: SpringSpec = SpringSpec { k: 330.0, d: 7.0 };
pub const FLING: SpringSpec = SpringSpec { k: 280.0, d: 27.0 };
pub const DOCK_CYCLE: SpringSpec = SpringSpec { k: 430.0, d: 24.0 };
pub const SNAP: SpringSpec = SpringSpec { k: 430.0, d: 28.0 };
