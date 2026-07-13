#!/usr/bin/env bash
# Run the REAL kobel-shell binary against gnoblin.
#
# Default: the headless verification pass -- boot headless gnoblin, mount the shell,
# assert IPC/input/notifd round-trips, screenshot, tear down.
# INTERACTIVE=1: open the visible nested gnoblin devkit window and run kobel-shell
# inside it until Ctrl-C (the successor of the old AGS INTERACTIVE flow).
#
# Env:
#   GNOBLIN=/path          gnoblin repo (default /home/kieran/dev/gnoblin)
#   OUT=/path.png          headless screenshot destination
#   INTERACTIVE=1          visible nested devkit; run until Ctrl-C
#   KOBEL_PROFILE_ANIM=1   reveal-spring traces   KOBEL_REDUCED_MOTION=1  instant springs
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

if [ "${INTERACTIVE:-0}" = 1 ]; then
  # Visible nested devkit: gnoblin's runner boots the windowed session and execs
  # our command inside it with WAYLAND_DISPLAY pointed at the nested compositor.
  # gnoblin's own OSD is handed to us for the session (notifications hand-off is
  # negotiated by kobel-notifd itself).
  export KOBEL_SHELL_BIN="$SHELL_BIN"
  export KOBEL_PROFILE_ANIM="${KOBEL_PROFILE_ANIM:-}"
  export KOBEL_REDUCED_MOTION="${KOBEL_REDUCED_MOTION:-}"
  # Isolated control socket so the nested shell never unlinks/collides with a
  # real session's kobel-shell.sock. Reach it with:
  #   KOBEL_SHELL_SOCKET=<path> kobelctl toggle launcher
  export KOBEL_SHELL_SOCKET="${XDG_RUNTIME_DIR:-/tmp}/kobel-shell-devkit-$$.sock"
  echo ">> nested shell control socket: $KOBEL_SHELL_SOCKET"
  GNOME_DEVKIT_EXEC="gnoblinctl disable osd 2>/dev/null || true; "
  GNOME_DEVKIT_EXEC+='RUST_LOG="${RUST_LOG:-info}" '
  GNOME_DEVKIT_EXEC+='KOBEL_PROFILE_ANIM="$KOBEL_PROFILE_ANIM" '
  GNOME_DEVKIT_EXEC+='KOBEL_REDUCED_MOTION="$KOBEL_REDUCED_MOTION" '
  GNOME_DEVKIT_EXEC+='KOBEL_SHELL_SOCKET="$KOBEL_SHELL_SOCKET" '
  GNOME_DEVKIT_EXEC+='exec "$KOBEL_SHELL_BIN"'
  export GNOME_DEVKIT_EXEC
  exec "$GNOBLIN/scripts/run-gnome-devkit.sh"
fi

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
# Motion/profile flags forwarded into the shell env (default off). KOBEL_PROFILE_ANIM
# turns on the reveal-spring trace (KOBEL_MOTION lines land in kobel.log);
# KOBEL_REDUCED_MOTION makes every spring settle instantly (accessibility).
export KOBEL_PROFILE_ANIM="${KOBEL_PROFILE_ANIM:-}"
export KOBEL_REDUCED_MOTION="${KOBEL_REDUCED_MOTION:-}"
# Space-separated WxH list; two entries = the multi-monitor pass.
export VIRTUAL_MONITORS="${VIRTUAL_MONITORS:-1280x800}"
export DISP DK OUT PREFIX SHELL_BIN CTL_BIN

cleanup() { rm -rf "$DK"; }
trap cleanup EXIT INT TERM

dbus-run-session --config-file="$CONF" -- bash "$ROOT/scripts/_shell_session.sh"
rc=$?
cp "$DK/kobel.log" /tmp/kobel-shell-run.log 2>/dev/null || true
cp "$DK/shell.log" /tmp/kobel-shell-mutter.log 2>/dev/null || true
exit $rc
