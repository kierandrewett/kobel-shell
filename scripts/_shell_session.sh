#!/usr/bin/env bash
# Inner session body for the phase-2 pass -- runs INSIDE dbus-run-session.
set -u
export GNOME_SHELL_DISABLE_EXTENSIONS=1
"$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
  --virtual-monitor 1280x800 --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
SP=$!
for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
[ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
for _ in $(seq 1 40); do grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5; done
echo "== shell up on $DISP =="

export WAYLAND_DISPLAY="$DISP"
RUST_LOG="${RUST_LOG:-info}" stdbuf -oL -eL "$SHELL_BIN" >"$DK/kobel.log" 2>&1 &
AP=$!

sleep 4
if ! kill -0 "$AP" 2>/dev/null; then
  echo "== kobel-shell DIED =="
  tail -30 "$DK/kobel.log"
  kill "$SP" 2>/dev/null
  exit 1
fi

for _ in 1 2 3; do pkill -9 -f gnome-tour 2>/dev/null; sleep 0.3; done

fail=0
# --- IPC round-trip assertions (kobelctl -> socket -> ShellBus -> manager) ---
ping_reply="$("$CTL_BIN" ping 2>&1)"
if [ "$ping_reply" = "ok" ]; then
  echo "PASS: kobelctl ping -> ok"
else
  echo "FAIL: kobelctl ping -> '$ping_reply'"; fail=1
fi
toggle_reply="$("$CTL_BIN" toggle launcher 2>&1)"
sleep 1
if [ "$toggle_reply" = "ok" ] && grep -aq "\[manager\] opened launcher" "$DK/kobel.log"; then
  echo "PASS: kobelctl toggle launcher -> ok + manager reveal log"
else
  echo "FAIL: toggle reply='$toggle_reply', manager reveal log missing"; fail=1
fi
# Restore a known-closed baseline before the dedicated reveal capture below.
"$CTL_BIN" toggle launcher >/dev/null 2>&1
sleep 1
bad_reply="$("$CTL_BIN" toggle nonsense 2>&1)"
case "$bad_reply" in
  err*) echo "PASS: unknown surface rejected ($bad_reply)" ;;
  *) echo "FAIL: expected err for unknown surface, got '$bad_reply'"; fail=1 ;;
esac

# --- dock surface creation (host mounted the kobel-dock layer surface) ---
if grep -aq "ns=kobel-dock" "$DK/kobel.log"; then
  echo "PASS: kobel-dock surface created"
else
  echo "FAIL: kobel-dock surface not created"; fail=1
fi

# --- reveal input paths: Esc closes; dismiss-layer click closes ---
# (100,700) is empty desktop: outside the launcher sheet, bar and dock, so the
# click lands on the dismiss layer's (now full) input region.
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
closes() { grep -ac '\[manager\] closed launcher' "$DK/kobel.log"; }
gdbus wait --session --timeout 15 org.gnome.Mutter.RemoteDesktop 2>/dev/null || true
before=$(closes)
"$CTL_BIN" toggle launcher >/dev/null 2>&1
sleep 1
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Escape" >"$DK/inject-esc.log" 2>&1 \
  || { echo "FAIL: injector (esc) exited nonzero"; cat "$DK/inject-esc.log"; fail=1; }
sleep 1
if [ "$(closes)" -gt "$before" ]; then
  echo "PASS: Escape closed the launcher"
else
  echo "FAIL: Escape did not close the launcher"; fail=1
fi
before=$(closes)
"$CTL_BIN" toggle launcher >/dev/null 2>&1
sleep 1
python3 "$SCRIPTS_DIR/devkit_input.py" "click:100:700" >"$DK/inject-dismiss.log" 2>&1 \
  || { echo "FAIL: injector (dismiss) exited nonzero"; cat "$DK/inject-dismiss.log"; fail=1; }
sleep 1
if [ "$(closes)" -gt "$before" ]; then
  echo "PASS: dismiss-layer click closed the launcher"
else
  echo "FAIL: dismiss click did not close the launcher"; fail=1
fi

# --- phase 4: launcher typing (KeyFeed -> query -> fuzzy results) + session nav ---
"$CTL_BIN" toggle launcher >/dev/null 2>&1
sleep 1
python3 "$SCRIPTS_DIR/devkit_input.py" "key:s" "key:e" "key:t" "key:t" >"$DK/inject-type.log" 2>&1 \
  || { echo "FAIL: injector (typing) exited nonzero"; cat "$DK/inject-type.log"; fail=1; }
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/launcher-query.png" >/dev/null 2>&1
cp "$DK/launcher-query.png" /tmp/kobel-launcher-query.png 2>/dev/null || true
[ -s "$DK/launcher-query.png" ] && echo "PASS: launcher query screenshot captured" \
  || { echo "FAIL: launcher query screenshot missing"; fail=1; }
before=$(closes)
# Esc #1 clears the query (stays open), Esc #2 closes.
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Escape" "wait:400" "key:Escape" >"$DK/inject-esc2.log" 2>&1 \
  || { echo "FAIL: injector (esc2) exited nonzero"; cat "$DK/inject-esc2.log"; fail=1; }
sleep 1
if [ "$(closes)" -gt "$before" ]; then
  echo "PASS: launcher clear-then-close Esc semantics"
else
  echo "FAIL: double-Esc did not close the launcher"; fail=1
fi
session_closes() { grep -ac '\[manager\] closed session' "$DK/kobel.log"; }
before_s=$(session_closes)
"$CTL_BIN" toggle session >/dev/null 2>&1
sleep 1
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Right" "key:Right" >"$DK/inject-sess.log" 2>&1 \
  || { echo "FAIL: injector (session nav) exited nonzero"; cat "$DK/inject-sess.log"; fail=1; }
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/session-open.png" >/dev/null 2>&1
cp "$DK/session-open.png" /tmp/kobel-session-open.png 2>/dev/null || true
[ -s "$DK/session-open.png" ] && echo "PASS: session screenshot captured" \
  || { echo "FAIL: session screenshot missing"; fail=1; }
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Escape" >"$DK/inject-sess-esc.log" 2>&1 \
  || { echo "FAIL: injector (session esc) exited nonzero"; fail=1; }
sleep 1
if [ "$(session_closes)" -gt "$before_s" ]; then
  echo "PASS: session Esc closed"
else
  echo "FAIL: session Esc did not close"; fail=1
fi
# Arm/disarm regression (the State borrow-panic class): select Restart, Enter once
# (ARMS only -- a second Enter would fire, never sent), Esc disarms, Esc closes.
before_s=$(session_closes)
"$CTL_BIN" toggle session >/dev/null 2>&1
sleep 1
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Right" "key:Right" "key:Return" "wait:300" "key:Escape" "wait:300" "key:Escape" >"$DK/inject-arm.log" 2>&1 \
  || { echo "FAIL: injector (arm/disarm) exited nonzero"; cat "$DK/inject-arm.log"; fail=1; }
sleep 1
if grep -aq "\[session\] armed Restart" "$DK/kobel.log" \
   && grep -aq "\[session\] disarmed" "$DK/kobel.log" \
   && [ "$(session_closes)" -gt "$before_s" ] \
   && kill -0 "$AP" 2>/dev/null; then
  echo "PASS: session arm/disarm/close survived (no borrow panic)"
else
  echo "FAIL: session arm/disarm path broken (armed=$(grep -ac '\[session\] armed' "$DK/kobel.log"), disarmed=$(grep -ac '\[session\] disarmed' "$DK/kobel.log"), alive=$(kill -0 "$AP" 2>/dev/null && echo yes || echo no))"; fail=1
fi

# --- phase 5: quick settings (Esc-at-root closes) + calendar surfaces ---
surface_closes() { grep -ac "\[manager\] closed $1" "$DK/kobel.log"; }
before_q=$(surface_closes quicksettings)
"$CTL_BIN" toggle quicksettings >/dev/null 2>&1
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/qs-open.png" >/dev/null 2>&1
cp "$DK/qs-open.png" /tmp/kobel-qs-open.png 2>/dev/null || true
[ -s "$DK/qs-open.png" ] && echo "PASS: quicksettings screenshot captured" \
  || { echo "FAIL: quicksettings screenshot missing"; fail=1; }
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Escape" >"$DK/inject-qs-esc.log" 2>&1 \
  || { echo "FAIL: injector (qs esc) exited nonzero"; fail=1; }
sleep 1
if [ "$(surface_closes quicksettings)" -gt "$before_q" ]; then
  echo "PASS: quicksettings Esc closed"
else
  echo "FAIL: quicksettings Esc did not close"; fail=1
fi
before_c=$(surface_closes calendar)
"$CTL_BIN" toggle calendar >/dev/null 2>&1
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/calendar-open.png" >/dev/null 2>&1
cp "$DK/calendar-open.png" /tmp/kobel-calendar-open.png 2>/dev/null || true
[ -s "$DK/calendar-open.png" ] && echo "PASS: calendar screenshot captured" \
  || { echo "FAIL: calendar screenshot missing"; fail=1; }
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Escape" >"$DK/inject-cal-esc.log" 2>&1 \
  || { echo "FAIL: injector (calendar esc) exited nonzero"; fail=1; }
sleep 1
if [ "$(surface_closes calendar)" -gt "$before_c" ]; then
  echo "PASS: calendar Esc closed"
else
  echo "FAIL: calendar Esc did not close"; fail=1
fi

# --- phase 6: notifd owns the bus name, notify-send round-trip, drawer ---
# kobel-notifd does its own handshake (SetFeature notifications=false -> RequestName
# retries ~5s); wait for the serving log rather than racing it.
served=no
for _ in $(seq 1 16); do
  grep -aq "\[notifd\] serving org.freedesktop.Notifications" "$DK/kobel.log" && { served=yes; break; }
  sleep 0.5
done
if [ "$served" = yes ]; then
  echo "PASS: notifd acquired org.freedesktop.Notifications"
else
  echo "FAIL: notifd never acquired the bus name"
  grep -a "\[notifd\]" "$DK/kobel.log" | head -5
  fail=1
fi
notify-send "Kobel Gate" "toast round-trip body" 2>/dev/null \
  || { echo "FAIL: notify-send errored"; fail=1; }
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/toast.png" >/dev/null 2>&1
cp "$DK/toast.png" /tmp/kobel-toast.png 2>/dev/null || true
[ -s "$DK/toast.png" ] && echo "PASS: toast screenshot captured" \
  || { echo "FAIL: toast screenshot missing"; fail=1; }
before_d=$(surface_closes drawer)
"$CTL_BIN" toggle drawer >/dev/null 2>&1
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/drawer.png" >/dev/null 2>&1
cp "$DK/drawer.png" /tmp/kobel-drawer.png 2>/dev/null || true
[ -s "$DK/drawer.png" ] && echo "PASS: drawer screenshot captured" \
  || { echo "FAIL: drawer screenshot missing"; fail=1; }
python3 "$SCRIPTS_DIR/devkit_input.py" "key:Escape" >"$DK/inject-drawer-esc.log" 2>&1 \
  || { echo "FAIL: injector (drawer esc) exited nonzero"; fail=1; }
sleep 1
if [ "$(surface_closes drawer)" -gt "$before_d" ]; then
  echo "PASS: drawer Esc closed"
else
  echo "FAIL: drawer Esc did not close"; fail=1
fi

# --- screenshot (bar visible at top) ---
res=$(gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" 2>&1 | head -1)
echo "$res"
case "$res" in "(true,"*) ;; *) echo "FAIL: screenshot call failed"; fail=1;; esac
[ -s "$OUT" ] || { echo "FAIL: screenshot missing/empty"; fail=1; }

kill -0 "$AP" 2>/dev/null && echo "== kobel-shell alive ==" || { echo "== kobel-shell DIED =="; tail -10 "$DK/kobel.log"; fail=1; }
echo "== kobel log =="
grep -aE "\[(shell|manager|ipc|host|conn|egl)\]|error|panic|WARN" "$DK/kobel.log" | head -30

# --- reveal machinery end to end (this wave): toggle reveals the launcher, capture it
#     while open, toggle hides it; assert the manager reveal/hide logs (FREYA-PLAN 2.4). ---
open_reply="$("$CTL_BIN" toggle launcher 2>&1)"
sleep 1
shot=$(gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/open.png" 2>&1 | head -1)
if [ "$open_reply" = "ok" ] && grep -aq "\[manager\] opened launcher" "$DK/kobel.log"; then
  echo "PASS: reveal -> [manager] opened launcher"
else
  echo "FAIL: reveal open_reply='$open_reply', opened-launcher log missing"; fail=1
fi
case "$shot" in "(true,"*) ;; *) echo "FAIL: open screenshot call failed ($shot)"; fail=1;; esac
[ -s "$DK/open.png" ] && echo "PASS: open launcher screenshot captured" || { echo "FAIL: open screenshot missing/empty"; fail=1; }
cp "$DK/open.png" /tmp/kobel-reveal-open.png 2>/dev/null || true
close_reply="$("$CTL_BIN" toggle launcher 2>&1)"
sleep 1
if [ "$close_reply" = "ok" ] && grep -aq "\[manager\] closed launcher" "$DK/kobel.log"; then
  echo "PASS: hide -> [manager] closed launcher"
else
  echo "FAIL: hide close_reply='$close_reply', closed-launcher log missing"; fail=1
fi

# --- toasts must be click-through: click INSIDE the fixed top-right toasts rect
# (empty input region) with the launcher open; it must fall through to the dismiss
# layer and close the launcher rather than being eaten by the invisible overlay. ---
before=$(closes)
"$CTL_BIN" toggle launcher >/dev/null 2>&1
sleep 1
python3 "$SCRIPTS_DIR/devkit_input.py" "click:1200:100" >"$DK/inject-toastrect.log" 2>&1 \
  || { echo "FAIL: injector (toast-rect click) exited nonzero"; fail=1; }
sleep 1
if [ "$(closes)" -gt "$before" ]; then
  echo "PASS: toasts overlay is click-through (dismiss fired under toast rect)"
else
  echo "FAIL: click inside the toasts rect was eaten (launcher stayed open)"; fail=1
fi

# Clean shutdown via IPC: wait on the child (kill -0 can see a zombie) and require
# exit status 0, watchdogged so a lost quit surfaces as FAIL instead of a hang.
"$CTL_BIN" quit >/dev/null 2>&1
( sleep 8; kill -0 "$AP" 2>/dev/null && kill -TERM "$AP" 2>/dev/null ) &
WATCH=$!
wait "$AP"; shell_rc=$?
kill "$WATCH" 2>/dev/null
if [ "$shell_rc" = 0 ]; then
  echo "PASS: kobelctl quit -> clean shutdown (exit 0)"
else
  echo "FAIL: kobel-shell exit status $shell_rc after kobelctl quit"; fail=1
fi
if grep -aq "\[notifd\] released org.freedesktop.Notifications" "$DK/kobel.log"; then
  echo "PASS: notifd released the bus name on shutdown"
else
  echo "FAIL: notifd release log missing after quit"; fail=1
fi
kill "$SP" 2>/dev/null; wait 2>/dev/null
if [ "$fail" = 0 ]; then echo "== SHELL PASS =="; exit 0; else echo "== SHELL FAIL =="; exit 1; fi
