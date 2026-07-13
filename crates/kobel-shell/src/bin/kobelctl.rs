// kobelctl: tiny CLI over the kobel-shell control socket.
//
//   kobelctl toggle launcher
//   kobelctl close-all
//   kobelctl quit
//   kobelctl ping
//
// argv joins into one line, sent to $XDG_RUNTIME_DIR/kobel-shell.sock; the reply is
// printed. Exit 0 on 'ok', 1 otherwise. No clap: this stays deliberately small and
// independent of the shell crate's internals.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::ExitCode;

// Keep in sync with ipc::socket_path (bins cannot import the shell's modules).
fn socket_path() -> PathBuf {
    if let Some(path) = std::env::var_os("KOBEL_SHELL_SOCKET") {
        return PathBuf::from(path);
    }
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    dir.join("kobel-shell.sock")
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("usage: kobelctl <toggle <surface>|close-all|quit|ping>");
        return ExitCode::from(2);
    }
    let line = args.join(" ");
    let path = socket_path();

    let mut stream = match UnixStream::connect(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("kobelctl: cannot connect to {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
    };
    if let Err(e) = writeln!(stream, "{line}") {
        eprintln!("kobelctl: write failed: {e}");
        return ExitCode::FAILURE;
    }

    let mut reply = String::new();
    let mut reader = BufReader::new(&stream);
    if let Err(e) = reader.read_line(&mut reply) {
        eprintln!("kobelctl: read failed: {e}");
        return ExitCode::FAILURE;
    }
    let reply = reply.trim();
    println!("{reply}");
    if reply == "ok" { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
