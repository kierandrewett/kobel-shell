#!/usr/bin/env bash
# Boot headless gnoblin, run the kobel AGS shell inside it, screenshot, exit.
set -uo pipefail
ROOT=/home/kieran/dev/gnoblin
PREFIX=$ROOT/install
AGSDIR=/home/kieran/dev/kobel-shell/ags
OUT=${OUT:-/tmp/kobel-ags-shot.png}
export LD_LIBRARY_PATH="$PREFIX/lib64:$PREFIX/lib64/mutter-17"
export GI_TYPELIB_PATH="$PREFIX/lib64/mutter-17"
export PATH="$PREFIX/bin:$PATH"
export GSETTINGS_SCHEMA_DIR="$PREFIX/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$PREFIX/share:/usr/local/share:/usr/share"
export GDK_BACKEND=wayland
export GNOME_SHELL_SESSION_MODE=gnoblin
export XDG_CURRENT_DESKTOP=GNOME:Gnoblin
DK="$(mktemp -d /tmp/kobel-ags.XXXXXX)"
mkdir -p "$DK"/{data,config,cache,home}
export HOME="$DK/home" XDG_DATA_HOME="$DK/data" XDG_CONFIG_HOME="$DK/config" XDG_CACHE_HOME="$DK/cache"
export GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 GSETTINGS_BACKEND=memory GTK_A11Y=none NO_AT_BRIDGE=1
DISP="kobel-ags-$$"
CONF="$(python3 "$ROOT/scripts/devkit_dbus.py" "$DK" "$ROOT")" || exit 1
export DISP DK OUT AGSDIR
dbus-run-session --config-file="$CONF" -- bash -c '
  set -u
  "'"$PREFIX"'/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
    --virtual-monitor 1280x800 --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
  SP=$!
  for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
  [ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
  for _ in $(seq 1 40); do
    grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5
  done
  echo "== shell up on $DISP =="
  export WAYLAND_DISPLAY="$DISP" GDK_BACKEND=wayland
  gnoblinctl disable osd 2>/dev/null || true
  "/bin/gnoblinctl" disable notifications 2>/dev/null; "/bin/gnoblinctl" disable osd 2>/dev/null
  ( cd "$AGSDIR" && ags bundle app.ts "$DK/bundle.js" ) >>"$DK/ags.log" 2>&1
  LD_PRELOAD=/usr/lib64/libgtk4-layer-shell.so.0 \
    KOBEL_SKIP_NOTIFD=1 stdbuf -oL -eL gjs -m "$DK/bundle.js" >>"$DK/ags.log" 2>&1 &
  AP=$!
  sleep 12
  kill -0 $AP 2>/dev/null && echo "== ags alive ==" || echo "== ags DIED =="
  gdbus call --session --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" 2>&1 | head -2
  cp "$DK/ags.log" /tmp/kobel-ags-run.log
  grep -cE "JS ERROR|CRITICAL" "$DK/shell.log" | sed "s/^/shell-log errors: /"
  kill $AP $SP 2>/dev/null
  wait 2>/dev/null
'
rc=$?
cp "$DK/shell.log" /tmp/kobel-shell-run.log 2>/dev/null
rm -rf "$DK"
exit $rc
