//! The kobel-shell control-socket path, shared verbatim by the shell's `ipc`
//! module (server) and `kobelctl` (client) so the two sides can never drift.
//! Split into its own crate (rather than living in `kobel-shell` and being
//! duplicated in `bin/kobelctl.rs`) because `kobelctl` is deliberately a tiny,
//! fast-building CLI independent of the shell's Freya/Wayland/D-Bus stack --
//! depending on the shell crate just for this one function would force
//! linking that entire dependency tree into a binary that only opens a Unix
//! socket. This crate has zero dependencies, so it costs `kobelctl` nothing.

use std::path::PathBuf;

/// The control socket path: `$KOBEL_SHELL_SOCKET` when set (devkit/test
/// isolation), else `$XDG_RUNTIME_DIR/kobel-shell.sock` (falling back to
/// `/tmp` if `XDG_RUNTIME_DIR` is unset).
pub fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("KOBEL_SHELL_SOCKET") {
        return PathBuf::from(path);
    }
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    dir.join("kobel-shell.sock")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One sequential test, not three independent `#[test]`s: `socket_path`
    /// reads process-global env vars, and Rust's default test runner executes
    /// `#[test]` functions on separate threads, so two tests mutating
    /// `KOBEL_SHELL_SOCKET`/`XDG_RUNTIME_DIR` concurrently would race. Doing
    /// all three cases in one function with `std::env::set_var`/`remove_var`
    /// (`unsafe` since 2024 edition -- not thread-safe against a concurrent
    /// reader) keeps the mutations serialized against themselves; this is the
    /// crate's only test, so there is no other reader to race against.
    #[test]
    fn resolves_in_priority_order() {
        // SAFETY: mutates process-global env state; safe here because this is
        // the crate's only test (no concurrent reader of these two vars) and
        // every mutation below is sequenced within this single test function.
        unsafe {
            std::env::remove_var("KOBEL_SHELL_SOCKET");
            std::env::remove_var("XDG_RUNTIME_DIR");
        }

        // Neither set: falls back to /tmp.
        assert_eq!(socket_path(), PathBuf::from("/tmp/kobel-shell.sock"));

        // XDG_RUNTIME_DIR set, override absent: joins under it.
        // SAFETY: see above.
        unsafe {
            std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        }
        assert_eq!(socket_path(), PathBuf::from("/run/user/1000/kobel-shell.sock"));

        // KOBEL_SHELL_SOCKET set: wins outright, XDG_RUNTIME_DIR ignored even
        // though it is also set (devkit/test isolation must be absolute).
        // SAFETY: see above.
        unsafe {
            std::env::set_var("KOBEL_SHELL_SOCKET", "/tmp/kobel-test-42.sock");
        }
        assert_eq!(socket_path(), PathBuf::from("/tmp/kobel-test-42.sock"));

        // SAFETY: see above; restore a clean slate for any test added later.
        unsafe {
            std::env::remove_var("KOBEL_SHELL_SOCKET");
            std::env::remove_var("XDG_RUNTIME_DIR");
        }
    }
}
