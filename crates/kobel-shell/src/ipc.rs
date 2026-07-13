//! Unix-socket control channel: `kobelctl` talks to a running shell here. One line
//! per request; the shell replies `ok` or `err <msg>`. Parsed requests are fed into
//! the same ShellBus the UI uses, so IPC and UI drive the manager identically.
//!
//! The listener runs on a plain std thread and only ever sends over the bus (which
//! wakes the loop). Socket lifecycle: unlink any stale socket on start, remove ours
//! on exit (main.rs, after the loop returns).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::str::FromStr;
use std::thread;

use crate::manager::{ShellBus, ShellMsg, SurfaceKey};

/// The control socket path: `$KOBEL_SHELL_SOCKET` when set (devkit/test isolation),
/// else `$XDG_RUNTIME_DIR/kobel-shell.sock` (falling back to `/tmp`). Keep in sync
/// with the copy in bin/kobelctl.rs (bins cannot import the shell's modules).
pub fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("KOBEL_SHELL_SOCKET") {
        return PathBuf::from(path);
    }
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    dir.join("kobel-shell.sock")
}

/// A parsed control request.
#[derive(Debug)]
pub enum Request {
    /// Forward this message onto the ShellBus.
    Forward(ShellMsg),
    /// `ping` -- health check; reply ok, nothing to forward.
    Ping,
}

/// Parse one protocol line into a request. The error string is echoed to the client
/// as `err <msg>`. This is the pure core of the protocol; `serve` is the plumbing.
pub fn parse_line(line: &str) -> Result<Request, String> {
    let mut parts = line.split_whitespace();
    let cmd = parts.next();
    // Reject any trailing tokens so the protocol is exact (typos don't get an `ok`).
    let end = |mut rest: std::str::SplitWhitespace<'_>| match rest.next() {
        Some(extra) => Err(format!("unexpected argument: {extra}")),
        None => Ok(()),
    };
    match cmd {
        Some("toggle") => {
            let name = parts.next().ok_or("toggle requires a surface name")?;
            let key = SurfaceKey::from_str(name)?;
            end(parts)?;
            Ok(Request::Forward(ShellMsg::Toggle(key)))
        }
        Some("close-all") => {
            end(parts)?;
            Ok(Request::Forward(ShellMsg::CloseAll))
        }
        Some("quit") => {
            end(parts)?;
            Ok(Request::Forward(ShellMsg::Quit))
        }
        Some("ping") => {
            end(parts)?;
            Ok(Request::Ping)
        }
        Some(other) => Err(format!("unknown command: {other}")),
        None => Err("empty command".to_string()),
    }
}

/// Bind the control socket and spawn the listener thread. Returns the bound path so
/// the caller can unlink it on exit.
pub fn serve(bus: ShellBus) -> std::io::Result<PathBuf> {
    serve_at(socket_path(), bus)
}

/// Bind the control socket at `path` and spawn the listener thread. Unlinks any stale
/// socket first, then returns the bound path. Split from [`serve`] so the socket +
/// protocol can be exercised end-to-end against a temp path with no compositor.
pub fn serve_at(path: PathBuf, bus: ShellBus) -> std::io::Result<PathBuf> {
    // Unlink a stale socket from a previous run; bind fails with EADDRINUSE otherwise.
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    tracing::info!("[ipc] listening at {}", path.display());
    let listen_path = path.clone();
    thread::Builder::new().name("kobel-ipc".to_string()).spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => handle_conn(stream, &bus),
                Err(e) => tracing::warn!("[ipc] accept failed: {e}"),
            }
        }
        tracing::info!("[ipc] listener stopped ({})", listen_path.display());
    })?;
    Ok(path)
}

/// Serve one request on an accepted connection: read a line, reply ok/err.
fn handle_conn(stream: UnixStream, bus: &ShellBus) {
    let read_half = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("[ipc] connection clone failed: {e}");
            return;
        }
    };
    let mut reader = BufReader::new(read_half);
    let mut writer = stream;
    let mut line = String::new();
    if let Err(e) = reader.read_line(&mut line) {
        tracing::warn!("[ipc] read failed: {e}");
        return;
    }
    let reply = match parse_line(line.trim()) {
        Ok(Request::Forward(msg)) => {
            bus.send(msg);
            "ok".to_string()
        }
        Ok(Request::Ping) => "ok".to_string(),
        Err(e) => format!("err {e}"),
    };
    if let Err(e) = writeln!(writer, "{reply}") {
        tracing::warn!("[ipc] reply failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_toggle_for_every_surface() {
        for key in SurfaceKey::ALL {
            let line = format!("toggle {}", key.as_str());
            match parse_line(&line) {
                Ok(Request::Forward(ShellMsg::Toggle(k))) => assert_eq!(k, key),
                other => panic!("expected toggle {key:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn parses_close_all_quit_ping() {
        assert!(matches!(parse_line("close-all"), Ok(Request::Forward(ShellMsg::CloseAll))));
        assert!(matches!(parse_line("quit"), Ok(Request::Forward(ShellMsg::Quit))));
        assert!(matches!(parse_line("ping"), Ok(Request::Ping)));
    }

    #[test]
    fn tolerates_surrounding_whitespace() {
        assert!(matches!(
            parse_line("   toggle   launcher   "),
            Ok(Request::Forward(ShellMsg::Toggle(SurfaceKey::Launcher)))
        ));
    }

    #[test]
    fn rejects_trailing_tokens() {
        assert_eq!(parse_line("toggle launcher extra").unwrap_err(), "unexpected argument: extra");
        assert_eq!(parse_line("quit now").unwrap_err(), "unexpected argument: now");
        assert_eq!(parse_line("ping pong").unwrap_err(), "unexpected argument: pong");
        assert_eq!(parse_line("close-all please").unwrap_err(), "unexpected argument: please");
    }

    #[test]
    fn rejects_unknown_empty_and_bad_surface() {
        assert_eq!(parse_line("bogus").unwrap_err(), "unknown command: bogus");
        assert_eq!(parse_line("").unwrap_err(), "empty command");
        assert_eq!(parse_line("   ").unwrap_err(), "empty command");
        assert!(parse_line("toggle").is_err());
        assert!(parse_line("toggle nope").is_err());
    }

    #[test]
    fn round_trips_over_a_real_socket() {
        use std::os::unix::net::UnixStream;

        let (bus, rx) = ShellBus::new();
        let path = std::env::temp_dir()
            .join(format!("kobel-shell-ipc-test-{}.sock", std::process::id()));
        serve_at(path.clone(), bus).expect("bind test control socket");

        let send = |cmd: &str| -> String {
            let mut stream = UnixStream::connect(&path).expect("connect to control socket");
            writeln!(stream, "{cmd}").expect("write request");
            let mut reply = String::new();
            BufReader::new(&stream).read_line(&mut reply).expect("read reply");
            reply.trim().to_string()
        };

        assert_eq!(send("ping"), "ok");
        assert_eq!(send("toggle launcher"), "ok");
        assert_eq!(send("close-all"), "ok");
        assert_eq!(send("bogus"), "err unknown command: bogus");
        assert_eq!(send("toggle nope"), "err unknown surface: nope");

        // Forwarded requests actually reached the bus (order preserved).
        let mut got = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            got.push(msg);
        }
        assert!(got.iter().any(|m| matches!(m, ShellMsg::Toggle(SurfaceKey::Launcher))));
        assert!(got.iter().any(|m| matches!(m, ShellMsg::CloseAll)));
        let _ = std::fs::remove_file(&path);
    }
}
