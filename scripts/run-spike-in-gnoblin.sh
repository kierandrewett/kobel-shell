#!/usr/bin/env bash
# Phase-0 gate runner: boot a headless gnoblin session, run the Rust kobel-wayland
# spike example inside it as a native wlr-layer-shell client, take two screenshots
# (1s apart, proving the animation advances), tear down.
#
# Env:
#   GNOBLIN=/path   gnoblin repo (default /home/kieran/dev/gnoblin)
#   OUT1/OUT2       screenshot destinations (default /tmp/kobel-spike-{1,2}.png)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GNOBLIN="${GNOBLIN:-/home/kieran/dev/gnoblin}"
PREFIX="$GNOBLIN/install"
OUT1="${OUT1:-/tmp/kobel-spike-1.png}"
OUT2="${OUT2:-/tmp/kobel-spike-2.png}"
SPIKE_BIN="$ROOT/target/debug/examples/spike"

[ -x "$PREFIX/bin/gnome-shell" ] || { echo "no gnome-shell in $PREFIX -- build gnoblin first" >&2; exit 1; }
[ -x "$SPIKE_BIN" ] || { echo "no spike binary -- run: cargo build -p kobel-wayland --example spike" >&2; exit 1; }

# --- gnoblin runtime env (mirrors ags/scripts/run-in-gnoblin.sh) ---
export LD_LIBRARY_PATH="$PREFIX/lib64:$PREFIX/lib64/mutter-17"
export GI_TYPELIB_PATH="$PREFIX/lib64/mutter-17"
export PATH="$PREFIX/bin:$PATH"
export GSETTINGS_SCHEMA_DIR="$PREFIX/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$PREFIX/share:/usr/local/share:/usr/share"
export GDK_BACKEND=wayland
export GNOME_SHELL_SESSION_MODE=gnoblin
export XDG_CURRENT_DESKTOP=GNOME:Gnoblin

# --- isolated throwaway home/bus ---
DK="$(mktemp -d /tmp/kobel-spike.XXXXXX)"
mkdir -p "$DK"/{data,config,cache,home}
export HOME="$DK/home" XDG_DATA_HOME="$DK/data" XDG_CONFIG_HOME="$DK/config" XDG_CACHE_HOME="$DK/cache"
export GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 GSETTINGS_BACKEND=dconf GTK_A11Y=none NO_AT_BRIDGE=1
DISP="kobel-spike-$$"
CONF="$(python3 "$GNOBLIN/scripts/devkit_dbus.py" "$DK" "$GNOBLIN")" || exit 1
export DISP DK OUT1 OUT2 PREFIX SPIKE_BIN

cleanup() { rm -rf "$DK"; }
trap cleanup EXIT INT TERM

dbus-run-session --config-file="$CONF" -- bash "$ROOT/scripts/_spike_session.sh"
rc=$?
cp "$DK/spike.log" /tmp/kobel-spike-run.log 2>/dev/null || true
cp "$DK/shell.log" /tmp/kobel-spike-shell.log 2>/dev/null || true
exit $rc
