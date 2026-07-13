#!/usr/bin/env bash
# Phase-2 visual/IPC pass: boot headless gnoblin, run the REAL kobel-shell binary
# (per-output bar + osd), verify the IPC round-trip via kobelctl, screenshot the bar.
#
# Env:
#   GNOBLIN=/path   gnoblin repo (default /home/kieran/dev/gnoblin)
#   OUT=/path.png   screenshot destination (default /tmp/kobel-shell-shot.png)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GNOBLIN="${GNOBLIN:-/home/kieran/dev/gnoblin}"
PREFIX="$GNOBLIN/install"
OUT="${OUT:-/tmp/kobel-shell-shot.png}"
SHELL_BIN="$ROOT/target/debug/kobel-shell"
CTL_BIN="$ROOT/target/debug/kobelctl"

[ -x "$PREFIX/bin/gnome-shell" ] || { echo "no gnome-shell in $PREFIX -- build gnoblin first" >&2; exit 1; }
# Always rebuild so the pass provably runs the current source (fast when clean).
( cd "$ROOT" && cargo build -p kobel-shell --bins ) || { echo "shell build failed" >&2; exit 1; }
[ -x "$SHELL_BIN" ] && [ -x "$CTL_BIN" ] || { echo "missing shell/ctl binaries after build" >&2; exit 1; }

# --- gnoblin runtime env (mirrors scripts/run-spike-in-gnoblin.sh) ---
export LD_LIBRARY_PATH="$PREFIX/lib64:$PREFIX/lib64/mutter-17"
export GI_TYPELIB_PATH="$PREFIX/lib64/mutter-17"
export PATH="$PREFIX/bin:$PATH"
export GSETTINGS_SCHEMA_DIR="$PREFIX/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$PREFIX/share:/usr/local/share:/usr/share"
export GDK_BACKEND=wayland
export GNOME_SHELL_SESSION_MODE=gnoblin
export XDG_CURRENT_DESKTOP=GNOME:Gnoblin

# --- isolated throwaway home/bus ---
DK="$(mktemp -d /tmp/kobel-shell-run.XXXXXX)"
mkdir -p "$DK"/{data,config,cache,home}
export HOME="$DK/home" XDG_DATA_HOME="$DK/data" XDG_CONFIG_HOME="$DK/config" XDG_CACHE_HOME="$DK/cache"
export GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 GSETTINGS_BACKEND=dconf GTK_A11Y=none NO_AT_BRIDGE=1
DISP="kobel-shell-$$"
# Isolated control socket so a devkit run can never unlink/collide with a real
# session's kobel-shell.sock.
export KOBEL_SHELL_SOCKET="$DK/kobel-shell.sock"
CONF="$(python3 "$GNOBLIN/scripts/devkit_dbus.py" "$DK" "$GNOBLIN")" || exit 1
export DISP DK OUT PREFIX SHELL_BIN CTL_BIN

cleanup() { rm -rf "$DK"; }
trap cleanup EXIT INT TERM

dbus-run-session --config-file="$CONF" -- bash "$ROOT/scripts/_shell_session.sh"
rc=$?
cp "$DK/kobel.log" /tmp/kobel-shell-run.log 2>/dev/null || true
cp "$DK/shell.log" /tmp/kobel-shell-mutter.log 2>/dev/null || true
exit $rc
