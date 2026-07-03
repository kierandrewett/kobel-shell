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
export GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 GSETTINGS_BACKEND=memory GTK_A11Y=none NO_AT_BRIDGE=1
DISP="kobel-ags-$$"
CONF="$(python3 "$GNOBLIN/scripts/devkit_dbus.py" "$DK" "$GNOBLIN")" || exit 1
export DISP DK OUT AGSDIR BUNDLE TOGGLE LAYER_PRELOAD PREFIX

cleanup() { rm -rf "$DK"; }
trap cleanup EXIT INT TERM

dbus-run-session --config-file="$CONF" -- bash -c '
  set -u
  "$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
    --virtual-monitor 1280x800 --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
  SP=$!
  for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
  [ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
  for _ in $(seq 1 40); do grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5; done
  echo "== shell up on $DISP =="

  export WAYLAND_DISPLAY="$DISP" GDK_BACKEND=wayland
  # gnoblin vacates the chrome; kobel claims it
  gnoblinctl disable osd 2>/dev/null || true
  gnoblinctl disable notifications 2>/dev/null || true

  KOBEL_SKIP_NOTIFD=1 stdbuf -oL -eL \
    env LD_PRELOAD="$LAYER_PRELOAD" gjs -m "$BUNDLE" >"$DK/ags.log" 2>&1 &
  AP=$!
  sleep 8
  [ -n "${TOGGLE:-}" ] && { astal -i kobel -t "$TOGGLE" 2>/dev/null || true; sleep 3; }
  # gnome-tour is dbus-activated + late; nuke it right before the shot
  for _ in 1 2 3; do pkill -9 -f gnome-tour 2>/dev/null; sleep 0.3; done

  kill -0 $AP 2>/dev/null && echo "== ags alive ==" || { echo "== ags DIED =="; tail -6 "$DK/ags.log"; }
  gdbus call --session --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" 2>&1 | head -1
  cp "$DK/ags.log" /tmp/kobel-ags-run.log 2>/dev/null || true
  grep -iE "kobel:|FAILED" "$DK/ags.log" | grep -v "slow path" | tail -8
  kill $AP $SP 2>/dev/null; wait 2>/dev/null
'
rc=$?
cp "$DK/shell.log" /tmp/kobel-shell-run.log 2>/dev/null || true
exit $rc
