//! Exec service: fire-and-forget external processes for session control, URI
//! opening, and clipboard writes. Every process is a leaf in the process tree
//! -- spawned fully detached (no stdio wired back except an optional stdin
//! payload) and reaped in the background, the same shape as apps.rs's
//! `gio launch` handling. This module NEVER blocks the caller and NEVER
//! touches Freya types.

use std::process::Stdio;

use tokio::io::AsyncWriteExt;

use crate::SessionVerb;

/// Pure mapping: session verb -> argv (docs/FREYA-PLAN.md section 5). argv[0]
/// is the binary; the rest are passed through as arguments unmodified.
pub(crate) fn verb_argv(verb: SessionVerb) -> &'static [&'static str] {
    match verb {
        SessionVerb::Lock => &["loginctl", "lock-session"],
        SessionVerb::Logout => &["gnome-session-quit", "--logout", "--no-prompt"],
        SessionVerb::Restart => &["systemctl", "reboot"],
        SessionVerb::Shutdown => &["systemctl", "poweroff"],
        SessionVerb::Suspend => &["systemctl", "suspend"],
    }
}

/// Run a session-control verb: spawn the mapped argv detached.
pub(crate) fn session(verb: SessionVerb) {
    spawn_detached("session", verb_argv(verb), None);
}

/// Open a URI with the desktop default handler.
pub(crate) fn open_uri(uri: &str) {
    spawn_detached("open-uri", &["xdg-open", uri], None);
}

/// Copy text to the Wayland clipboard via `wl-copy`, piping the text on
/// stdin (`wl-copy` reads to EOF, then forks itself to serve the selection).
pub(crate) fn copy_text(text: String) {
    spawn_detached("copy-text", &["wl-copy"], Some(text));
}

/// Spawn `argv` fully detached (stdio null, optional stdin payload), then
/// reap it on a tokio task so it never zombies -- mirrors apps.rs's
/// `gio launch` handling.
fn spawn_detached(label: &'static str, argv: &[&str], stdin_payload: Option<String>) {
    let Some((bin, args)) = argv.split_first() else {
        tracing::warn!("[exec] {label}: empty argv");
        return;
    };

    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .stdin(if stdin_payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    match cmd.spawn() {
        Ok(mut child) => {
            tracing::info!("[exec] {label}: spawned '{bin}'");
            let bin = bin.to_string();
            tokio::spawn(async move {
                if let Some(text) = stdin_payload {
                    if let Some(mut stdin) = child.stdin.take() {
                        if let Err(e) = stdin.write_all(text.as_bytes()).await {
                            tracing::warn!("[exec] {label}: stdin write failed: {e}");
                        }
                        // `stdin` drops here, closing the pipe so the child sees EOF.
                    }
                }
                match child.wait().await {
                    Ok(status) if !status.success() => {
                        tracing::warn!("[exec] {label}: '{bin}' exited: {status}");
                    }
                    Err(e) => tracing::warn!("[exec] {label}: wait failed: {e}"),
                    _ => {}
                }
            });
        }
        Err(e) => tracing::warn!("[exec] {label}: failed to spawn '{bin}': {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure mapping only -- NEVER spawn real session verbs (loginctl/systemctl/
    // gnome-session-quit) from a test.
    #[test]
    fn verb_argv_maps_every_verb() {
        assert_eq!(
            verb_argv(SessionVerb::Lock),
            &["loginctl", "lock-session"]
        );
        assert_eq!(
            verb_argv(SessionVerb::Logout),
            &["gnome-session-quit", "--logout", "--no-prompt"]
        );
        assert_eq!(verb_argv(SessionVerb::Restart), &["systemctl", "reboot"]);
        assert_eq!(verb_argv(SessionVerb::Shutdown), &["systemctl", "poweroff"]);
        assert_eq!(verb_argv(SessionVerb::Suspend), &["systemctl", "suspend"]);
    }
}
