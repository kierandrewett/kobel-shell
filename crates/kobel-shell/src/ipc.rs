//! Unix-socket control channel: `kobelctl` talks to a running shell here. One line
//! per request; the shell replies `ok` or `err <msg>`. Parsed requests are fed into
//! the same [`ShellBus`] used by in-process producers.
//!
//! The listener runs on a plain std thread and only ever sends over the bus, which
//! wakes the host loop. Socket lifecycle uses an exclusive, non-blocking `flock()`
//! on a companion `<path>.lock` file as the sole arbiter of whether another instance
//! is running. The kernel makes that decision atomically, so two instances racing
//! to start cannot both pass the check.
//!
//! The lock is held for the process lifetime by leaking its file descriptor. The OS
//! releases it after a clean exit, crash or SIGKILL, so a lock file left on disk
//! never blocks a new process from acquiring it. Once the lock is held, this process
//! owns exclusive rights to unlink and rebind the socket. The production entry point
//! is responsible for removing the path returned by [`serve`] when its host loop
//! exits.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::thread;

use crate::manager::{ShellBus, ShellMsg, SurfaceKey};

/// The control socket path. Re-exported from [`kobel_ipc`] (shared verbatim
/// with `bin/kobelctl.rs` so the two sides can never drift -- see that
/// crate's doc comment for why it lives outside this crate).
pub use kobel_ipc::socket_path;

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
    serve_at_with_timeout(path, bus, REQUEST_TIMEOUT)
}

/// The per-request read/write deadline (see [`handle_conn`]'s doc comment for why
/// it exists). `serve_at` uses this in production; tests use a much shorter one
/// via [`serve_at_with_timeout`] so proving the fix stays fast.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Acquire an exclusive, non-blocking lock on `<socket_path>.lock`, atomically
/// deciding "is another kobel-shell instance already running" with no TOCTOU
/// window. Held for the caller's entire process lifetime (the returned `File`
/// must be leaked/kept alive, never dropped early -- dropping it closes the FD
/// and releases the lock immediately, which would defeat the whole point).
fn acquire_instance_lock(socket_path: &Path) -> std::io::Result<File> {
    let lock_path = socket_path.with_extension("lock");
    // Owner-only at creation (mode set ATOMICALLY via OpenOptions, not a
    // separate chmod after the fact -- same reasoning as notifd's persisted
    // store: no window, however narrow, at a loose umask-masked default).
    // Matters specifically because socket_path()'s `/tmp` fallback (when
    // XDG_RUNTIME_DIR is unset) is world-writable: without this, another
    // local user could pre-create the lock file loosely-permissioned there.
    // A hostile pre-created file this process then can't open in write mode
    // degrades gracefully anyway (serve_at's caller treats anything other
    // than AddrInUse as non-fatal -- the shell still starts, just without
    // kobelctl for that session) -- this closes the narrow window rather
    // than just accepting that fallback.
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(&lock_path)?;
    // SAFETY: `file` is a valid, open file descriptor for the duration of this
    // call (borrowed via as_raw_fd, not consumed); LOCK_EX | LOCK_NB never
    // blocks, and its only failure mode (EWOULDBLOCK, another holder) is
    // handled explicitly via the return value below -- no unchecked errno use.
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AddrInUse,
            format!("another kobel-shell instance already holds {}", lock_path.display()),
        ));
    }
    Ok(file)
}

/// Remove any existing file at `path`, treating "nothing there" as success. A
/// REAL removal failure (permission denied, etc.) is surfaced distinctly --
/// never silently swallowed -- because [`UnixListener::bind`] at a path where
/// something still exists fails with the exact same `io::ErrorKind::AddrInUse`
/// [`acquire_instance_lock`] uses for "another instance is live" (EADDRINUSE
/// is the kernel's only error for "something is already at this path",
/// regardless of cause -- verified directly: a stale socket under a directory
/// this process lacks write access to reproduces errno 98 on bind, identical
/// to the live-instance case). Swallowing a real failure here would let that
/// ambiguity leak into `serve_at`'s caller, which would then misdiagnose
/// "can't remove a stale file" as "another instance is running" and refuse to
/// start over it -- when the flock (already acquired by the time this runs)
/// has ALREADY proven no live instance holds this path. The correct behavior
/// for a stuck stale file is the same graceful non-fatal degrade every OTHER
/// bind failure gets, which requires NOT reporting AddrInUse here.
fn remove_stale_socket(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(std::io::Error::other(format!(
            "cannot remove stale socket at {}: {e}",
            path.display()
        ))),
    }
}

/// [`serve_at`]'s implementation, with the per-request timeout as a parameter so
/// tests can use a short one instead of waiting out the production default.
fn serve_at_with_timeout(path: PathBuf, bus: ShellBus, timeout: std::time::Duration) -> std::io::Result<PathBuf> {
    // Atomically refuse to start a second instance -- see acquire_instance_lock's
    // doc and this module's doc comment for why flock (not a connect() probe)
    // is the right primitive here. Leaked deliberately: the lock must outlive
    // this function, for as long as this process runs.
    std::mem::forget(acquire_instance_lock(&path)?);

    // The lock guarantees no other process can be racing this same section, so
    // unlinking a stale socket file (if any) and rebinding is now safe: nothing
    // else could have created a live listener at `path` without first winning
    // the lock above, and only one process can ever hold it.
    remove_stale_socket(&path)?;
    let listener = UnixListener::bind(&path)?;
    // Owner-only: UnixListener::bind creates the socket at the umask-masked
    // default (typically 0755, world-connectable), and this accepts unauthenticated
    // commands (including `quit`) from anyone who can reach it -- restrict to the
    // owning user explicitly rather than relying solely on the containing
    // directory's protection (XDG_RUNTIME_DIR is usually 0700, but the `/tmp`
    // fallback in socket_path() is world-traversable).
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    tracing::info!("[ipc] listening at {}", path.display());
    let listen_path = path.clone();
    thread::Builder::new().name("kobel-ipc".to_string()).spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => handle_conn(stream, &bus, timeout),
                Err(e) => tracing::warn!("[ipc] accept failed: {e}"),
            }
        }
        tracing::info!("[ipc] listener stopped ({})", listen_path.display());
    })?;
    Ok(path)
}

/// Serve one request on an accepted connection: read a line, reply ok/err.
///
/// The listener processes connections sequentially on one thread (no per-
/// connection spawn), so a connected peer that never sends a terminating
/// newline would otherwise block `read_line` forever and wedge every future
/// `kobelctl` command -- including `quit` -- until the shell is killed
/// externally. A bounded read/write deadline turns that into "this one
/// request times out", not "the control channel is dead for the session".
fn handle_conn(stream: UnixStream, bus: &ShellBus, timeout: std::time::Duration) {
    if let Err(e) = stream.set_read_timeout(Some(timeout)) {
        tracing::warn!("[ipc] cannot set read timeout: {e}");
    }
    if let Err(e) = stream.set_write_timeout(Some(timeout)) {
        tracing::warn!("[ipc] cannot set write timeout: {e}");
    }
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
    fn key(name: &str) -> SurfaceKey {
        name.parse().expect("valid test surface key")
    }

    #[test]
    fn parses_ui_owned_surface_name() {
        let expected = key("status-panel_2");
        match parse_line("toggle status-panel_2") {
            Ok(Request::Forward(ShellMsg::Toggle(actual))) => assert_eq!(actual, expected),
            other => panic!("expected toggle request, got {other:?}"),
        }
    }

    #[test]
    fn parses_close_all_quit_ping() {
        assert!(matches!(
            parse_line("close-all"),
            Ok(Request::Forward(ShellMsg::CloseAll))
        ));
        assert!(matches!(parse_line("quit"), Ok(Request::Forward(ShellMsg::Quit))));
        assert!(matches!(parse_line("ping"), Ok(Request::Ping)));
    }

    #[test]
    fn tolerates_surrounding_whitespace() {
        assert!(matches!(
            parse_line("   toggle   surface-a   "),
            Ok(Request::Forward(ShellMsg::Toggle(key))) if key == self::key("surface-a")
        ));
    }

    #[test]
    fn rejects_trailing_tokens() {
        assert_eq!(
            parse_line("toggle surface-a extra").unwrap_err(),
            "unexpected argument: extra"
        );
        assert_eq!(parse_line("quit now").unwrap_err(), "unexpected argument: now");
        assert_eq!(parse_line("ping pong").unwrap_err(), "unexpected argument: pong");
        assert_eq!(
            parse_line("close-all please").unwrap_err(),
            "unexpected argument: please"
        );
    }

    #[test]
    fn rejects_unknown_empty_and_invalid_surface() {
        assert_eq!(parse_line("bogus").unwrap_err(), "unknown command: bogus");
        assert_eq!(parse_line("").unwrap_err(), "empty command");
        assert_eq!(parse_line("   ").unwrap_err(), "empty command");
        assert!(parse_line("toggle").is_err());
        assert!(parse_line("toggle InvalidName").is_err());
    }

    #[test]
    fn round_trips_over_a_real_socket() {
        use std::os::unix::net::UnixStream;

        let (bus, rx) = ShellBus::new();
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-test-{}.sock", std::process::id()));
        serve_at(path.clone(), bus).expect("bind test control socket");

        let send = |cmd: &str| -> String {
            let mut stream = UnixStream::connect(&path).expect("connect to control socket");
            writeln!(stream, "{cmd}").expect("write request");
            let mut reply = String::new();
            BufReader::new(&stream).read_line(&mut reply).expect("read reply");
            reply.trim().to_string()
        };

        assert_eq!(send("ping"), "ok");
        assert_eq!(send("toggle surface-a"), "ok");
        assert_eq!(send("close-all"), "ok");
        assert_eq!(send("bogus"), "err unknown command: bogus");
        assert!(send("toggle InvalidName").starts_with("err invalid surface name"));

        // Forwarded requests actually reached the bus (order preserved).
        let mut got = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            got.push(msg);
        }
        assert!(
            got.iter()
                .any(|message| matches!(message, ShellMsg::Toggle(surface) if surface == &key("surface-a")))
        );
        assert!(got.iter().any(|m| matches!(m, ShellMsg::CloseAll)));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refuses_to_steal_a_live_instances_socket() {
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-live-test-{}.sock", std::process::id()));
        // Hold the instance lock directly -- simulates another kobel-shell
        // instance already running (holding it for this process's lifetime,
        // exactly like serve_at itself does via std::mem::forget).
        let held = acquire_instance_lock(&path).expect("acquire the 'other instance' lock");

        let (bus, _rx) = ShellBus::new();
        let err = serve_at(path.clone(), bus).expect_err("must refuse to bind while the lock is held elsewhere");
        assert_eq!(err.kind(), std::io::ErrorKind::AddrInUse);

        // The lock holder is unaffected: still holds it, could keep running as
        // the one live instance. Drop it explicitly here only to clean up the
        // test's own fixture, not because serve_at touched it.
        drop(held);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("lock"));
    }

    #[test]
    fn flock_prevents_the_toctou_race() {
        // The core atomicity guarantee: two lock attempts on the SAME path,
        // with the first's lock still held, must never both succeed -- there
        // is no window (unlike a plain connect()-based probe) where a second
        // concurrent attempt could pass a "is anyone here" check before the
        // first has finished claiming exclusivity.
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-race-test-{}.sock", std::process::id()));
        let first = acquire_instance_lock(&path).expect("first acquire must succeed");
        let second = acquire_instance_lock(&path);
        assert!(
            matches!(&second, Err(e) if e.kind() == std::io::ErrorKind::AddrInUse),
            "a second concurrent acquire must fail while the first is held, got {second:?}"
        );
        drop(first);
        // Releasing the first frees the lock immediately (flock semantics: tied
        // to the open file description, not any explicit unlock call) -- a
        // subsequent attempt must now succeed.
        acquire_instance_lock(&path).expect("acquire must succeed once the prior holder releases");
        let _ = std::fs::remove_file(path.with_extension("lock"));
    }

    #[test]
    fn reclaims_a_genuinely_stale_socket() {
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-stale-test-{}.sock", std::process::id()));
        // Bind a socket AND acquire+drop a lock, both without unlinking: files
        // left on disk by a crashed/killed previous instance. The lock itself
        // was released the instant its file descriptor closed (flock is tied to
        // the open file description, not any explicit unlock or the file's
        // on-disk presence), so nothing is actually held anymore.
        {
            let _dangling_socket = UnixListener::bind(&path).expect("create a socket file to abandon");
            let _dangling_lock = acquire_instance_lock(&path).expect("create a lock file to abandon");
        }
        assert!(path.exists(), "the dangling socket file must still be on disk");
        assert!(
            path.with_extension("lock").exists(),
            "the dangling lock file must still be on disk"
        );

        let (bus, _rx) = ShellBus::new();
        serve_at(path.clone(), bus).expect("a stale (unheld) lock must be reclaimed, not refused");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("lock"));
    }

    #[test]
    fn stale_socket_removal_failure_is_never_reported_as_addrinuse() {
        // Reproduces "the stale file exists but this process cannot remove it"
        // WITHOUT needing a different UID: unlinking a file requires write
        // permission on its CONTAINING DIRECTORY, not the file itself, so
        // locking the directory to read+execute-only reproduces the exact same
        // failure a different-owner file under a sticky /tmp would (verified
        // directly against the real syscalls: both surface as EADDRINUSE on a
        // bind() at that path if left unguarded).
        //
        // Calls remove_stale_socket directly rather than the full serve_at:
        // going through serve_at would first try to CREATE the lock file in
        // this SAME (about-to-be-read-only) directory, failing there instead
        // and never exercising the removal-guard code this test targets.
        let dir = std::env::temp_dir().join(format!("kobel-shell-ipc-noremove-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create test dir");
        let path = dir.join("sock.sock");
        {
            let _dangling = UnixListener::bind(&path).expect("create a socket file to abandon");
        }
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).expect("lock the dir read-only");

        let err = remove_stale_socket(&path).expect_err("must fail: the stale file cannot be removed");
        assert_ne!(
            err.kind(),
            std::io::ErrorKind::AddrInUse,
            "a removal failure must never be reported as AddrInUse -- that kind specifically means \
             'another live instance holds the flock', which a merely-undeletable stale file is not"
        );

        // Restore write access so the fixture can be cleaned up.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).expect("restore dir perms");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn control_socket_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let (bus, _rx) = ShellBus::new();
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-perm-test-{}.sock", std::process::id()));
        serve_at(path.clone(), bus).expect("bind test control socket");

        let mode = std::fs::metadata(&path).expect("stat socket").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "control socket must not be group/other accessible");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn instance_lock_file_is_owner_only() {
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-lock-perm-test-{}.sock", std::process::id()));
        let held = acquire_instance_lock(&path).expect("acquire the lock");

        let lock_path = path.with_extension("lock");
        let mode = std::fs::metadata(&lock_path)
            .expect("stat lock file")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(
            mode, 0o600,
            "the instance lock file must not be group/other accessible, even via the /tmp fallback"
        );

        drop(held);
        let _ = std::fs::remove_file(&lock_path);
    }

    #[test]
    fn a_silent_connection_never_wedges_the_listener() {
        use std::os::unix::net::UnixStream;
        use std::time::{Duration, Instant};

        let (bus, _rx) = ShellBus::new();
        let path = std::env::temp_dir().join(format!("kobel-shell-ipc-silent-test-{}.sock", std::process::id()));
        // A short deadline keeps this test fast; production uses REQUEST_TIMEOUT (5s).
        serve_at_with_timeout(path.clone(), bus, Duration::from_millis(200)).expect("bind test control socket");

        // Connect but never send a byte, let alone a newline -- and hold the
        // connection open past the timeout so the fix's read (not just the
        // accept) actually has to time out.
        let silent = UnixStream::connect(&path).expect("connect silently");

        // A second connection, sent only after the first's read has had time to
        // block, must still be served promptly -- proving the listener thread
        // recovered rather than staying wedged on the silent peer forever.
        let started = Instant::now();
        let mut second = UnixStream::connect(&path).expect("connect for ping");
        writeln!(second, "ping").expect("write ping");
        let mut reply = String::new();
        BufReader::new(&second).read_line(&mut reply).expect("read ping reply");
        assert_eq!(reply.trim(), "ok");
        // Bounded well under a wedged-forever listener, and consistent with one
        // ~200ms timeout elapsing before the second connection could be served.
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "ping took {:?}, the listener looks wedged on the silent connection",
            started.elapsed()
        );

        drop(silent);
        let _ = std::fs::remove_file(&path);
    }
}
