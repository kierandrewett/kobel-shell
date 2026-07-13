#!/usr/bin/env bash
# Inner session body for the RenderDoc capture pass -- runs INSIDE dbus-run-session,
# invoked by scripts/capture-frame-in-gnoblin.sh. It boots headless gnoblin exactly
# like scripts/_shell_session.sh, then runs the kobel-shell BINARY under RenderDoc
# injection (NOT gnome-shell -- we want Freya/Skia GLES draw calls, not mutter's) and
# captures one GPU frame via a persistent trigger connection.
#
# Frame boundaries are per eglSwapBuffers, and kobel-shell only presents on damage, so
# an armed trigger needs a fresh present to land on. We drive one with kobelctl toggles:
#   * surface given: toggle <surface> -> reveal-spring present burst on that surface.
#   * default (none): the idle shell is silent, so toggle the launcher (it slides in
#     over the still-visible bar chrome) purely to force a present to capture.
#
# Env in (exported by the outer script): PREFIX DISP DK SHELL_BIN CTL_BIN OUTRDC
#   SURFACE RDC_TIMEOUT SCRIPTS_DIR VIRTUAL_MONITORS KOBEL_PROFILE_ANIM
#   KOBEL_REDUCED_MOTION RUST_LOG KOBEL_SHELL_SOCKET
set -u

export GNOME_SHELL_DISABLE_EXTENSIONS=1

# --- boot headless gnoblin (mirrors scripts/_shell_session.sh) ---
MON_ARGS=()
for m in ${VIRTUAL_MONITORS:-1280x800}; do MON_ARGS+=(--virtual-monitor "$m"); done
"$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
  "${MON_ARGS[@]}" --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
SP=$!
for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
[ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
for _ in $(seq 1 40); do grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5; done
echo "== gnoblin up on $DISP =="

export WAYLAND_DISPLAY="$DISP"

# --- launch kobel-shell under RenderDoc injection via renderdoccmd ---
# We use `renderdoccmd capture`, NOT `rdc capture` (the Python ExecuteAndInject path):
# on Linux only renderdoccmd sets LD_PRELOAD=librenderdoc.so before the binary starts,
# which is REQUIRED to hook GLES-on-EGL. The Python inject path registers Vulkan hooks
# only, so eglSwapBuffers is never intercepted, no frame boundary is ever seen, and the
# trigger just times out. (Confirmed via the injected process's RenderDoc log.)
#
# renderdoccmd capture RETURNS as soon as it has injected (it does not wait for the app
# unless -w is given), leaving the shell running. We drive the capture through the
# target-control server it registers ("Launched as ID <n>"). The shell keeps the
# stdout/stderr renderdoccmd handed it -> kobel.log (RUST_LOG + tracing) after it exits.
# NOTE: renderdoccmd has no `--` separator -- the executable follows the options.
: >"$DK/kobel.log"
RUST_LOG="${RUST_LOG:-info}" \
  KOBEL_PROFILE_ANIM="${KOBEL_PROFILE_ANIM:-}" \
  KOBEL_REDUCED_MOTION="${KOBEL_REDUCED_MOTION:-}" \
  KOBEL_SHELL_SOCKET="$KOBEL_SHELL_SOCKET" \
  renderdoccmd capture --opt-disallow-vsync -c "$DK/capture-template" "$SHELL_BIN" \
  >"$DK/kobel.log" 2>&1 &
RCPID=$!

# Parse the target-control ident from "Launched as ID <n>". renderdoccmd RETURNS as
# soon as it has injected (it does not wait for the app), so the shell then runs
# independently -- we track it by its unique isolated socket, not renderdoccmd's pid.
IDENT=""
for _ in $(seq 1 60); do
  IDENT="$(sed -n 's/.*Launched as ID \([0-9][0-9]*\).*/\1/p' "$DK/kobel.log" | head -1)"
  [ -n "$IDENT" ] && break
  grep -aq "Failed to create & inject\|couldn't\|error" "$DK/kobel.log" && break
  sleep 0.25
done
wait "$RCPID" 2>/dev/null || true   # reap renderdoccmd (already returned)
echo "== injected kobel-shell via renderdoccmd (ident=$IDENT) =="
if [ -z "$IDENT" ]; then
  echo "FAIL: renderdoccmd did not report a target ident (injection failed)"
  echo "--- kobel.log tail ---"; tail -20 "$DK/kobel.log"
  kill "$SP" 2>/dev/null; wait 2>/dev/null
  exit 1
fi

CTL() { KOBEL_SHELL_SOCKET="$KOBEL_SHELL_SOCKET" "$CTL_BIN" "$@"; }
# PIDs of OUR devkit shell only -- filtered by the unique isolated control socket in the
# process environ, so the user's real kobel-shell (if any) is never matched or killed.
our_shell_pids() {
  local p
  for p in $(pgrep -x kobel-shell 2>/dev/null); do
    tr '\0' '\n' <"/proc/$p/environ" 2>/dev/null \
      | grep -qxF "KOBEL_SHELL_SOCKET=$KOBEL_SHELL_SOCKET" && echo "$p"
  done
}
shell_alive() { [ -n "$(our_shell_pids)" ]; }

# --- wait for the shell to mount its surfaces and settle ---
for _ in $(seq 1 40); do
  grep -aq "\[shell\] running" "$DK/kobel.log" && break
  shell_alive || { echo "FAIL: kobel-shell died during startup"; tail -30 "$DK/kobel.log"; kill "$SP" 2>/dev/null; exit 1; }
  sleep 0.5
done
grep -aq "\[shell\] mounted" "$DK/kobel.log" && echo "== $(grep -a "\[shell\] mounted" "$DK/kobel.log" | tail -1 | sed 's/.*\[shell\]/[shell]/') =="
sleep 3   # let the initial reveal springs settle so the arm+drive below is deterministic

# --- arm the persistent trigger, drive presents, wait for the capture ---
# Background the helper (connects, drains, arms TriggerCapture(1), blocks for the next
# present), give it time to arm, then keep generating presents across the wait window so
# the armed trigger reliably lands on a real kobel surface even if one burst is missed.
# kobel-shell only presents on damage and the idle shell is silent (the bar clock only
# repaints when the minute actually rolls over), so we always drive presents via toggles.
attempt_capture() {
  : >"$DK/capture.json"
  python3 "$SCRIPTS_DIR/rdc_capture.py" "$IDENT" "$OUTRDC" "${RDC_TIMEOUT:-16}" \
    >"$DK/capture.json" 2>"$DK/capture.err" &
  local hp=$!
  sleep 2.5   # let the helper connect + drain + arm before the first present
  # SURFACE mode reveals the requested surface; default mode nudges the launcher (which
  # slides in over the still-visible bar chrome) purely to force a present.
  local target="${SURFACE:-launcher}"
  echo "== drive: toggling $target (reveal bursts to force presents) =="
  CTL close-all >/dev/null 2>&1; sleep 0.3
  local i
  for i in 1 2 3 4 5 6; do
    kill -0 "$hp" 2>/dev/null || break   # helper already captured -> stop toggling
    CTL toggle "$target" >/dev/null 2>&1
    sleep 0.8
  done
  wait "$hp"
  return $?
}

cap_ok=0
# Two attempts: the second re-arms and re-drives if the first burst was missed.
if attempt_capture; then cap_ok=1; fi
if [ "$cap_ok" = 0 ]; then
  echo "== capture attempt 1 empty; retrying =="
  if attempt_capture; then cap_ok=1; fi
fi

echo "== capture.json =="; cat "$DK/capture.json"
[ -s "$DK/capture.err" ] && { echo "== capture.err =="; cat "$DK/capture.err"; }

# --- clean shutdown: kobelctl quit -> shell exits; then hard-stop any lingering
#     devkit shell (matched by our unique socket) and gnome-shell. ---
CTL quit >/dev/null 2>&1
for _ in $(seq 1 12); do shell_alive || break; sleep 0.5; done
for p in $(our_shell_pids); do kill -TERM "$p" 2>/dev/null; done
sleep 0.5
for p in $(our_shell_pids); do kill -9 "$p" 2>/dev/null; done
kill "$SP" 2>/dev/null; wait 2>/dev/null

if [ "$cap_ok" = 1 ] && [ -s "$OUTRDC" ]; then
  echo "== CAPTURE OK: $OUTRDC ($(stat -c%s "$OUTRDC" 2>/dev/null) bytes) =="
  exit 0
fi
echo "== CAPTURE FAIL =="
exit 1
