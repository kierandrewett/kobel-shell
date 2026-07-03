#!/usr/bin/env bash
# Inner session body — runs INSIDE dbus-run-session. Env comes from the parent.
set -u
"$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
  --virtual-monitor 1280x800 --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
SP=$!
for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
[ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
for _ in $(seq 1 40); do grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5; done
echo "== shell up on $DISP =="

export WAYLAND_DISPLAY="$DISP" GDK_BACKEND=wayland
gnoblinctl disable osd 2>/dev/null || true
gnoblinctl disable notifications 2>/dev/null || true

KOBEL_ICONS="/home/kieran/dev/kobel-shell/ags/icons" KOBEL_SKIP_NOTIFD=1 stdbuf -oL -eL env LD_PRELOAD="$LAYER_PRELOAD" gjs -m "$BUNDLE" >"$DK/ags.log" 2>&1 &
AP=$!
sleep 8
[ -n "${TOGGLE:-}" ] && { astal -i kobel -t "$TOGGLE" 2>/dev/null || true; sleep 3; }
for _ in 1 2 3; do pkill -9 -f gnome-tour 2>/dev/null; sleep 0.3; done

kill -0 $AP 2>/dev/null && echo "== ags alive ==" || { echo "== ags DIED =="; tail -6 "$DK/ags.log"; }
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" 2>&1 | head -1
cp "$DK/ags.log" /tmp/kobel-ags-run.log 2>/dev/null || true
grep -iE "kobel:|FAILED" "$DK/ags.log" | grep -v "slow path" | tail -8
kill "$AP" "$SP" 2>/dev/null; wait 2>/dev/null
