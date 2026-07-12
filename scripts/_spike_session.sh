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

shot() {
  # org.gnome.Shell.Screenshot returns (true, path) on success; assert the call
  # succeeded AND the file landed non-empty so a silent failure cannot pass the gate.
  local out="$1" res
  res=$(gdbus call --session --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$out" 2>&1 | head -1)
  echo "$res"
  case "$res" in "(true,"*) ;; *) echo "FAIL: screenshot call failed for $out"; return 1;; esac
  [ -s "$out" ] || { echo "FAIL: screenshot $out missing or empty"; return 1; }
}
shot "$OUT1" || { kill "$AP" "$SP" 2>/dev/null; exit 1; }

# INPUT_TEST proves the input half of the phase-0 gate (docs/FREYA-PLAN.md section 7):
# a synthetic pointer press must reach a Freya on_press handler, 'k' must cycle the
# surface's keyboard-interactivity, and Esc must cleanly exit the spike. It runs after
# the first screenshot and then exits, so the default render-only path below is left
# byte-identical.
if [ "${INPUT_TEST:-0}" = 1 ]; then
  echo "== INPUT_TEST: injecting pointer + keyboard =="
  SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # The private Mutter RemoteDesktop API appears once the shell is fully up.
  gdbus wait --session --timeout 15 org.gnome.Mutter.RemoteDesktop 2>/dev/null || true
  python3 "$SCRIPTS_DIR/devkit_input.py" >"$DK/inject.log" 2>&1
  echo "-- injector output --"
  cat "$DK/inject.log"
  # After Esc the spike shuts its event loop and exits 0 on its own. Wait for it with a
  # watchdog so a lost Esc surfaces as an unclean exit instead of hanging the harness.
  ( sleep 12; kill -0 "$AP" 2>/dev/null && kill -TERM "$AP" 2>/dev/null ) &
  WATCH=$!
  wait "$AP"; spike_rc=$?
  kill "$WATCH" 2>/dev/null

  echo "== INPUT_TEST assertions (spike exit status $spike_rc) =="
  fail=0
  if grep -aqE "\[spike\] pressed count=[1-9]" "$DK/spike.log"; then
    echo "PASS: pointer press reached Freya on_press ($(grep -aoE 'pressed count=[0-9]+' "$DK/spike.log" | tail -1))"
  else
    echo "FAIL: no '[spike] pressed count>=1' line"; fail=1
  fi
  cyc=$(grep -acE "\[spike\] 'k' -> keyboard interactivity" "$DK/spike.log")
  # The injected sequence sends 'k' three times from the initial OnDemand mode, so a
  # correct run cycles OnDemand -> Exclusive -> None -> OnDemand and logs all three. A
  # weaker threshold would hide a focus drop at None (which would swallow the 3rd 'k').
  if [ "$cyc" -ge 3 ] \
     && grep -aq "\[spike\] 'k' -> keyboard interactivity Exclusive" "$DK/spike.log" \
     && grep -aq "\[spike\] 'k' -> keyboard interactivity None" "$DK/spike.log" \
     && grep -aq "\[spike\] 'k' -> keyboard interactivity OnDemand" "$DK/spike.log"; then
    echo "PASS: keyboard-interactivity cycled through all modes ($cyc transitions via 'k')"
    grep -aE "\[spike\] 'k' -> keyboard interactivity" "$DK/spike.log"
  else
    echo "FAIL: expected 3 keyboard-interactivity transitions (Exclusive/None/OnDemand), got $cyc"
    grep -aE "\[spike\] 'k' -> keyboard interactivity" "$DK/spike.log"
    fail=1
  fi
  esc_logged=no
  grep -aq "\[spike\] Esc -> exit" "$DK/spike.log" && esc_logged=yes
  if [ "$esc_logged" = yes ] && [ "$spike_rc" = 0 ]; then
    echo "PASS: Esc -> clean exit (waitpid status 0)"
  else
    echo "FAIL: spike did not exit cleanly on Esc (Esc logged=$esc_logged, waitpid status $spike_rc)"; fail=1
  fi
  echo "== spike log (protocol + frames) =="
  grep -aE "\[(host|conn|egl|frame|spike)\]|fractional|viewporter|globals|error|panic" "$DK/spike.log" | head -60
  kill "$AP" "$SP" 2>/dev/null; wait 2>/dev/null
  if [ "$fail" = 0 ]; then echo "== INPUT_TEST PASS =="; exit 0; else echo "== INPUT_TEST FAIL =="; exit 1; fi
fi
sleep 1
shot "$OUT2" || { kill "$AP" "$SP" 2>/dev/null; exit 1; }

kill -0 "$AP" 2>/dev/null && echo "== spike alive ==" || { echo "== spike DIED =="; tail -10 "$DK/spike.log"; }
echo "== spike log (protocol + frames) =="
grep -aE "\[(host|conn|egl|frame|spike)\]|fractional|viewporter|globals|error|panic" "$DK/spike.log" | head -40
kill "$AP" "$SP" 2>/dev/null; wait 2>/dev/null
