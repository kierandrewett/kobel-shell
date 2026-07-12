#!/usr/bin/env bash
# Inner session body -- runs INSIDE dbus-run-session. Env comes from the parent.
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
RUST_LOG="${RUST_LOG:-info}" stdbuf -oL -eL "$SPIKE_BIN" >"$DK/spike.log" 2>&1 &
AP=$!

sleep 4
if ! kill -0 "$AP" 2>/dev/null; then
  echo "== spike DIED =="
  tail -30 "$DK/spike.log"
  kill "$SP" 2>/dev/null
  exit 1
fi

for _ in 1 2 3; do pkill -9 -f gnome-tour 2>/dev/null; sleep 0.3; done

gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT1" 2>&1 | head -1
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT2" 2>&1 | head -1

kill -0 "$AP" 2>/dev/null && echo "== spike alive ==" || { echo "== spike DIED =="; tail -10 "$DK/spike.log"; }
echo "== spike log (protocol + frames) =="
grep -aE "\[(host|conn|egl|frame|spike)\]|fractional|viewporter|globals|error|panic" "$DK/spike.log" | head -40
kill "$AP" "$SP" 2>/dev/null; wait 2>/dev/null
