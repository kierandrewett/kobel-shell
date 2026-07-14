//! services-probe: connect to the live session, print every ServiceEvent for
//! ~4 seconds, send NO commands, then exit 0. Read-only smoke test the
//! orchestrator runs against a real session.
//!
//! Run:  RUST_LOG=info cargo run -p kobel-services --example services-probe

use std::time::Duration;

use kobel_services::{ServiceEvent, Services, TrayMenuItem};

/// Total nodes in a menu subtree (the item itself plus all descendants), so the
/// probe reports the full DBusMenu size, not just the top-level row count.
fn count_menu_items(item: &TrayMenuItem) -> usize {
    1 + item.submenu.iter().map(count_menu_items).sum::<usize>()
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
        // The apps list is large, so report counts instead of dumping every entry.
        ServiceEvent::Apps(snapshot) => {
            let resolved_icons = snapshot.apps.iter().filter(|app| app.icon.is_some()).count();
            println!(
                "[probe] Apps snapshot: {} visible entries, {resolved_icons} resolved icons",
                snapshot.apps.len(),
            );
        }
        // Report which tray items expose a DBusMenu and how many items it has.
        ServiceEvent::Tray(snapshot) => {
            println!("[probe] Tray snapshot: {} item(s)", snapshot.items.len());
            for item in &snapshot.items {
                match &item.menu {
                    Some(menu) => {
                        let top = menu.submenus.len();
                        let total = menu.submenus.iter().map(count_menu_items).sum::<usize>();
                        let title = item.protocol.title.as_deref().unwrap_or(&item.protocol.id);
                        println!(
                            "[probe]   {title} ({}) -> menu: {top} top-level, {total} total item(s)",
                            item.address,
                        );
                    }
                    None => {
                        let title = item.protocol.title.as_deref().unwrap_or(&item.protocol.id);
                        println!("[probe]   {title} ({}) -> no menu", item.address);
                    }
                }
            }
        }
        other => println!("{other:?}"),
    });

    std::thread::sleep(Duration::from_secs(4));

    tracing::info!("[probe] elapsed; shutting down");
    drop(handle);
}
