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
if [ "$toggle_reply" = "ok" ] && grep -aq "\[manager\] toggle launcher" "$DK/kobel.log"; then
  echo "PASS: kobelctl toggle launcher -> ok + manager log"
else
  echo "FAIL: toggle reply='$toggle_reply', manager log line missing"; fail=1
fi
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
kill "$SP" 2>/dev/null; wait 2>/dev/null
if [ "$fail" = 0 ]; then echo "== SHELL PASS =="; exit 0; else echo "== SHELL FAIL =="; exit 1; fi
