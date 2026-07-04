#!/usr/bin/env bash
# Boot a headless gnoblin session, run the kobel AGS shell inside it as layer-shell
# surfaces, screenshot via org.gnome.Shell.Screenshot, tear down. The devkit loop the
# whole AGS port is validated against.
#
# Env:
#   OUT=/path.png        screenshot destination (default /tmp/kobel-ags-shot.png)
#   TOGGLE=<window>      astal window to toggle open before the shot (launcher|quicksettings|calendar|drawer|session)
#   GNOBLIN=/path        gnoblin repo (default /home/kieran/dev/gnoblin)
#   BUNDLE=/path.js      prebuilt bundle to run (default: build ags/app.ts here)
set -uo pipefail

AGSDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GNOBLIN="${GNOBLIN:-/home/kieran/dev/gnoblin}"
PREFIX="$GNOBLIN/install"
OUT="${OUT:-/tmp/kobel-ags-shot.png}"
BUNDLE="${BUNDLE:-}"
LAYER_PRELOAD=/usr/lib64/libgtk4-layer-shell.so.0

[ -x "$PREFIX/bin/gnome-shell" ] || { echo "no gnome-shell in $PREFIX — build gnoblin first" >&2; exit 1; }

# Build the bundle unless one was handed in.
if [ -z "$BUNDLE" ]; then
  BUNDLE=/tmp/kobel-bundle.js
  ( cd "$AGSDIR" && ags bundle app.ts "$BUNDLE" ) >/dev/null 2>&1 \
    || { echo "bundle failed" >&2; exit 1; }
fi

# --- gnoblin runtime env ---
export LD_LIBRARY_PATH="$PREFIX/lib64:$PREFIX/lib64/mutter-17"
export GI_TYPELIB_PATH="$PREFIX/lib64/mutter-17"
export PATH="$PREFIX/bin:$PATH"
export GSETTINGS_SCHEMA_DIR="$PREFIX/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$PREFIX/share:/usr/local/share:/usr/share"
export GDK_BACKEND=wayland
export GNOME_SHELL_SESSION_MODE=gnoblin
export XDG_CURRENT_DESKTOP=GNOME:Gnoblin

# --- isolated throwaway home/bus ---
DK="$(mktemp -d /tmp/kobel-ags.XXXXXX)"
mkdir -p "$DK"/{data,config,cache,home,bin}
export HOME="$DK/home" XDG_DATA_HOME="$DK/data" XDG_CONFIG_HOME="$DK/config" XDG_CACHE_HOME="$DK/cache"
# dconf (not memory) so the shell's SetFeature reaches the SEPARATE-process fdo
# notification daemon via dconf's cross-process change signal — memory gsettings is
# per-process, so `gnoblinctl disable notifications` never releases the fdo bus name
# and gnome-shell keeps owning notifications. dconf DB is isolated under XDG_CONFIG_HOME.
export GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 GSETTINGS_BACKEND=dconf GTK_A11Y=none NO_AT_BRIDGE=1
DISP="kobel-ags-$$"
CONF="$(python3 "$GNOBLIN/scripts/devkit_dbus.py" "$DK" "$GNOBLIN")" || exit 1
export DISP DK OUT AGSDIR BUNDLE TOGGLE LAYER_PRELOAD PREFIX KOBEL_DRILL KOBEL_TEST_NOTIFD KOBEL_QUERY

cleanup() { rm -rf "$DK"; }
trap cleanup EXIT INT TERM

# Inner body lives in its own file — robust vs a giant quoted `bash -c` string.
dbus-run-session --config-file="$CONF" -- bash "$AGSDIR/scripts/_session.sh"
rc=$?
cp "$DK/shell.log" /tmp/kobel-shell-run.log 2>/dev/null || true
exit $rc
