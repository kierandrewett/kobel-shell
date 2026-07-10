#!/usr/bin/env bash
# Inner session body — runs INSIDE dbus-run-session. Env comes from the parent.
set -u
export GNOME_SHELL_DISABLE_EXTENSIONS=1
"$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
  --virtual-monitor 1280x800 --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
SP=$!
for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
[ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
for _ in $(seq 1 40); do grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5; done
echo "== shell up on $DISP =="

export WAYLAND_DISPLAY="$DISP" GDK_BACKEND=wayland

# Leave gnoblin background at its default — do not touch gnoblin config.

gnoblinctl disable osd 2>/dev/null || true
gnoblinctl disable notifications 2>/dev/null || true
if [ -n "${KOBEL_TEST_NOTIFD:-}" ]; then
  sleep 1
  echo "NOTIF-OWNER-AFTER-DISABLE: $(busctl --user --no-pager call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s org.freedesktop.Notifications 2>&1 | head -1)"
fi

# KOBEL_TEST_NOTIFD=1 enables the real notifd (bus was freed above) so the drawer/toasts
# can be rendered; otherwise notifd is skipped (default, avoids blocking on a busy bus).
if [ -n "${KOBEL_TEST_NOTIFD:-}" ]; then SKIP=""; else SKIP="1"; fi
KOBEL_ICONS="/home/kieran/dev/kobel-shell/ags/icons" KOBEL_DEMO="${KOBEL_DEMO:-}" KOBEL_SKIP_NOTIFD="$SKIP" KOBEL_DRILL="${KOBEL_DRILL:-}" KOBEL_QUERY="${KOBEL_QUERY:-}" KOBEL_DUMP="${KOBEL_DUMP:-}" KOBEL_DUMP_OUT="${KOBEL_DUMP_OUT:-}" KOBEL_PROFILE_ANIM="${KOBEL_PROFILE_ANIM:-}" stdbuf -oL -eL env LD_PRELOAD="$LAYER_PRELOAD" gjs -m "$BUNDLE" >"$DK/ags.log" 2>&1 &
AP=$!
sleep 8
if [ -n "${KOBEL_TEST_NOTIFD:-}" ]; then
  gdbus call --session --dest org.freedesktop.Notifications \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "Spotify" 0 "" "Now Playing" "Weightless — Marconi Union" "[]" "{}" 0 >/dev/null 2>&1 || true
  gdbus call --session --dest org.freedesktop.Notifications \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "Calendar" 0 "" "Daily Standup" "Starting in 5 minutes" "[]" "{}" 0 >/dev/null 2>&1 || true
  sleep 2
fi
[ -n "${TOGGLE:-}" ] && { ags request -i kobel "toggle $TOGGLE" 2>/dev/null || astal -i kobel -t "$TOGGLE" 2>/dev/null || true; sleep 3; }
[ -n "${KOBEL_TEST_NOTIFD:-}" ] && echo "WINDOWS: $(ags list -i kobel 2>&1 || astal -i kobel --list 2>&1 | tr '\n' ' ')"
for _ in 1 2 3; do pkill -9 -f gnome-tour 2>/dev/null; sleep 0.3; done

if [ -n "${KOBEL_TEST_NOTIFD:-}" ]; then
  echo "NOTIF-OWNER-AFTER-AGS: $(busctl --user --no-pager call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetNameOwner s org.freedesktop.Notifications 2>&1 | head -1)"
  echo "AGS-UNIQUE-NAME: gjs pid=$AP"
  busctl --user --no-pager list 2>/dev/null | grep -iE 'Notif' | head
fi
kill -0 $AP 2>/dev/null && echo "== ags alive ==" || { echo "== ags DIED =="; tail -6 "$DK/ags.log"; }
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" 2>&1 | head -1
cp "$DK/ags.log" /tmp/kobel-ags-run.log 2>/dev/null || true
grep -iE "kobel:|FAILED" "$DK/ags.log" | grep -v "slow path" | tail -8
kill "$AP" "$SP" 2>/dev/null; wait 2>/dev/null
