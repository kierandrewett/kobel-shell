//! services-probe: connect to the live session, print every ServiceEvent for
//! ~4 seconds, send NO commands, then exit 0. Read-only smoke test the
//! orchestrator runs against a real session.
//!
//! Run:  RUST_LOG=info cargo run -p kobel-services --example services-probe

use std::time::Duration;

use kobel_services::{ServiceEvent, Services, TrayMenuItem};

/// The six dock pins the shell ships with; we report whether each resolves via
/// `AppsSnapshot::by_id` and whether an icon file was found.
const PINS: &[&str] = &[
    "org.gnome.Ptyxis",
    "org.gnome.Nautilus",
    "firefox",
    "dev.zed.Zed",
    "com.spotify.Client",
    "org.gnome.Settings",
];

/// Total nodes in a menu subtree (the item itself plus all descendants), so the
/// probe reports the full DBusMenu size, not just the top-level row count.
fn count_menu_items(item: &TrayMenuItem) -> usize {
    1 + item.children.iter().map(count_menu_items).sum::<usize>()
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!("[probe] starting kobel-services (read-only; no commands sent)");

    let handle = Services::spawn(|event: ServiceEvent| match &event {
        // The apps list is hundreds of entries; print a concise summary plus the
        // pin resolution instead of the full Debug dump.
        ServiceEvent::Apps(snapshot) => {
            println!("[probe] Apps snapshot: {} visible entries", snapshot.apps.len());
            for pin in PINS {
                match snapshot.by_id(pin) {
                    Some(app) => {
                        let icon = app
                            .icon
                            .as_ref()
                            .map(|p| p.display().to_string())
                            .unwrap_or_else(|| "<no icon>".to_string());
                        println!("[probe]   {pin} -> id={} icon={}", app.id, icon);
                    }
                    None => println!("[probe]   {pin} -> <not found>"),
                }
            }
        }
        // Report which tray items expose a DBusMenu and how many items it has.
        ServiceEvent::Tray(snapshot) => {
            println!("[probe] Tray snapshot: {} item(s)", snapshot.items.len());
            for item in &snapshot.items {
                match &item.menu {
                    Some(menu) => {
                        let top = menu.items.len();
                        let total = menu.items.iter().map(count_menu_items).sum::<usize>();
                        println!(
                            "[probe]   {} ({}) -> menu: {top} top-level, {total} total item(s)",
                            item.title, item.address,
                        );
                    }
                    None => println!("[probe]   {} ({}) -> no menu", item.title, item.address,),
                }
            }
        }
        other => println!("{other:?}"),
    });

    std::thread::sleep(Duration::from_secs(4));

    tracing::info!("[probe] elapsed; shutting down");
    drop(handle);
}
