//! services-probe: connect to the live session, print every ServiceEvent for
//! ~4 seconds, send NO commands, then exit 0. Read-only smoke test the
//! orchestrator runs against a real session.
//!
//! Run:  RUST_LOG=info cargo run -p kobel-services --example services-probe

use std::time::Duration;

use kobel_services::{ServiceEvent, Services};

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!("[probe] starting kobel-services (read-only; no commands sent)");

    let handle = Services::spawn(|event: ServiceEvent| {
        println!("{event:?}");
    });

    std::thread::sleep(Duration::from_secs(4));

    tracing::info!("[probe] elapsed; shutting down");
    drop(handle);
}
