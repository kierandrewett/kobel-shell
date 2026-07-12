// kobel-shell entry point. Placeholder until the host + first chrome land.
// Module owners: theme.rs (tokens), motion.rs (springs). Keep main.rs thin.

pub mod motion;
pub mod theme;

fn main() {
    tracing_subscriber::fmt::init();
    tracing::info!("[shell] kobel-shell placeholder; spike lives in kobel-wayland examples");
}
