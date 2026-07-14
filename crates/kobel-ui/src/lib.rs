//! The concrete kobel UI starts here.
//!
//! This root is intentionally empty. Build surfaces and Freya elements in this
//! crate without adding presentation decisions to `kobel-shell`, `kobel-wayland`
//! or `kobel-services`.

use freya_core::prelude::*;

/// Empty root shared by the desktop preview and future layer-shell surfaces.
pub fn app() -> impl IntoElement {
    rect()
}
