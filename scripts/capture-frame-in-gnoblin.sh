#!/usr/bin/env bash
# Capture a kobel-shell GPU frame with RenderDoc, inside a headless gnoblin session.
#
# This is the rendering-debug counterpart to run-shell-in-gnoblin.sh: instead of a
# compositor screenshot (final pixels only), it captures the actual Freya/Skia GLES
# draw calls kobel-shell issues, so you can inspect the pipeline, shaders, render
# targets and pixel history with rdc-cli (see the renderdoc-gpu-debug skill).
#
# We inject RenderDoc into the kobel-shell BINARY (an EGL/GLES3 wayland client that
# presents via eglSwapBuffers on one surface per output+panel), NOT into gnome-shell
# -- mutter's draws are not what we want. Frame boundaries are per-present and the shell
# only presents on damage, so we arm a persistent trigger connection and drive a present
# with a kobelctl surface toggle so the capture lands on a real kobel surface.
#
# Usage:
#   scripts/capture-frame-in-gnoblin.sh [SURFACE] [OUT.rdc]
#     SURFACE  surface to open before capture: launcher|quicksettings|calendar|
#              drawer|session. Default: none -- nudges the launcher to force a present,
#              capturing the launcher/bar chrome.
#     OUT.rdc  capture destination. Default: /tmp/kobel-shell.rdc
#
# Env:
#   GNOBLIN=/path          gnoblin repo (default /home/kieran/dev/gnoblin)
#   RTPNG=/path.png        exported render-target PNG (default /tmp/kobel-rt.png)
#   RDC_TIMEOUT=16         seconds to wait for a present after arming the trigger
#   VIRTUAL_MONITORS="WxH" monitor list (default 1280x800)
#   KOBEL_REDUCED_MOTION=1 instant springs   KOBEL_PROFILE_ANIM=1  reveal traces
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GNOBLIN="${GNOBLIN:-/home/kieran/dev/gnoblin}"
PREFIX="$GNOBLIN/install"
SCRIPTS_DIR="$ROOT/scripts"
SHELL_BIN="$ROOT/target/debug/kobel-shell"
CTL_BIN="$ROOT/target/debug/kobelctl"

SURFACE="${1:-}"
OUTRDC="${2:-/tmp/kobel-shell.rdc}"
RTPNG="${RTPNG:-/tmp/kobel-rt.png}"
RDC_TIMEOUT="${RDC_TIMEOUT:-16}"
export VIRTUAL_MONITORS="${VIRTUAL_MONITORS:-1280x800}"

case "$SURFACE" in
  ""|launcher|quicksettings|calendar|drawer|session) ;;
  *) echo "bad SURFACE '$SURFACE' (want: launcher|quicksettings|calendar|drawer|session)" >&2; exit 2 ;;
esac

# --- preflight ---
[ -x "$PREFIX/bin/gnome-shell" ] || { echo "no gnome-shell in $PREFIX -- build gnoblin first" >&2; exit 1; }
command -v rdc >/dev/null 2>&1 || { echo "rdc not found (pip install rdc-cli)" >&2; exit 1; }
command -v renderdoccmd >/dev/null 2>&1 || { echo "renderdoccmd not found" >&2; exit 1; }
# Build in the pristine outer env (no gnoblin LD_LIBRARY_PATH) so the pass provably
# runs the current source.
( cd "$ROOT" && cargo build -p kobel-shell --bins ) || { echo "shell build failed" >&2; exit 1; }
[ -x "$SHELL_BIN" ] && [ -x "$CTL_BIN" ] || { echo "missing shell/ctl binaries after build" >&2; exit 1; }

# --- isolated throwaway home/bus (mirrors run-shell-in-gnoblin.sh) ---
DK="$(mktemp -d /tmp/kobel-shell-capture.XXXXXX)"
mkdir -p "$DK"/{data,config,cache,home}
DISP="kobel-capture-$$"
CONF="$(python3 "$GNOBLIN/scripts/devkit_dbus.py" "$DK" "$GNOBLIN")" || exit 1
# The devkit isolates HOME, which breaks two HOME-derived Python lookups that the capture
# helper (rdc_capture.py) needs. Resolve both in the pristine env and pass them into the
# session:
#   * the rdc CLI package (~/.local/lib/.../site-packages) -> PYTHONPATH
#   * the compiled renderdoc module (~/.local/renderdoc, found via a HOME-derived search
#     path) -> RENDERDOC_PYTHON_PATH (absolute, HOME-independent). rdc_capture.py imports
#     it to open the target-control connection that drives the trigger.
RDC_PYSITE="$(python3 -c 'import os, rdc; print(os.path.dirname(os.path.dirname(rdc.__file__)))')" \
  || { echo "cannot locate rdc python module" >&2; exit 1; }
RDC_MODULE_DIR="$(python3 -c 'import os; from rdc.discover import find_renderdoc; m=find_renderdoc(); print(os.path.dirname(m.__file__) if m else "")')"
[ -n "$RDC_MODULE_DIR" ] || { echo "cannot locate renderdoc module (rdc doctor)" >&2; exit 1; }

cleanup() { rm -rf "$DK"; }
trap cleanup EXIT INT TERM

rm -f "$OUTRDC"
echo ">> capturing kobel-shell frame (surface='${SURFACE:-none}') -> $OUTRDC"

# --- capture phase: run the gnoblin/isolated env ONLY in this subshell, so the
#     replay phase below keeps the pristine outer env (real HOME, DISPLAY, libs). ---
(
  export LD_LIBRARY_PATH="$PREFIX/lib64:$PREFIX/lib64/mutter-17"
  export GI_TYPELIB_PATH="$PREFIX/lib64/mutter-17"
  export PATH="$PREFIX/bin:$PATH"
  export GSETTINGS_SCHEMA_DIR="$PREFIX/share/glib-2.0/schemas"
  export XDG_DATA_DIRS="$PREFIX/share:/usr/local/share:/usr/share"
  export GDK_BACKEND=wayland
  export GNOME_SHELL_SESSION_MODE=gnoblin
  export XDG_CURRENT_DESKTOP=GNOME:Gnoblin
  export HOME="$DK/home" XDG_DATA_HOME="$DK/data" XDG_CONFIG_HOME="$DK/config" XDG_CACHE_HOME="$DK/cache"
  export GIO_USE_VFS=local GVFS_DISABLE_FUSE=1 GSETTINGS_BACKEND=dconf GTK_A11Y=none NO_AT_BRIDGE=1
  export PYTHONPATH="$RDC_PYSITE${PYTHONPATH:+:$PYTHONPATH}"
  export RENDERDOC_PYTHON_PATH="$RDC_MODULE_DIR"
  export KOBEL_SHELL_SOCKET="$DK/kobel-shell.sock"
  export KOBEL_PROFILE_ANIM="${KOBEL_PROFILE_ANIM:-}"
  export KOBEL_REDUCED_MOTION="${KOBEL_REDUCED_MOTION:-}"
  export DISP DK OUTRDC SURFACE RDC_TIMEOUT SCRIPTS_DIR PREFIX SHELL_BIN CTL_BIN
  dbus-run-session --config-file="$CONF" -- bash "$SCRIPTS_DIR/_capture_session.sh"
)
cap_rc=$?
cp "$DK/kobel.log" /tmp/kobel-shell-capture.log 2>/dev/null || true
cp "$DK/shell.log" /tmp/kobel-shell-capture-mutter.log 2>/dev/null || true
# Persist the RenderDoc-side diagnostics before $DK is removed, so a failed run can be
# triaged (target-control timeout vs. no-present vs. injection failure).
cp "$DK/inject.json" /tmp/kobel-shell-capture-inject.json 2>/dev/null || true
cp "$DK/capture.json" /tmp/kobel-shell-capture-result.json 2>/dev/null || true
cp "$DK/capture.err" /tmp/kobel-shell-capture-result.err 2>/dev/null || true

if [ "$cap_rc" != 0 ] || [ ! -s "$OUTRDC" ]; then
  echo "== CAPTURE FAILED (rc=$cap_rc) -- see /tmp/kobel-shell-capture.log =="
  exit 1
fi
echo "== captured $(stat -c%s "$OUTRDC") bytes -> $OUTRDC =="

# --- replay/inspect loop ---
# Runs in the pristine outer env (real HOME/DISPLAY). GPU replay is headless: it needs
# no window/Wayland, only a working replay driver for the capture's API. `rdc open`
# starts a daemon that loads the capture; the inspection commands talk to that daemon.
RTPNG_THUMB="${RTPNG%.png}-thumb.png"
rdc close >/dev/null 2>&1 || true
echo "== rdc open =="
if rdc open "$OUTRDC" >"$DK/open.log" 2>&1; then
  cat "$DK/open.log"
  echo "== rdc info --json =="
  rdc info --json | tee "$DK/info.json"
  echo "== rdc stats --json =="
  rdc stats --json | tee "$DK/stats.json"
  echo "== rdc draws --limit 10 =="
  rdc draws --limit 10 | tee "$DK/draws.txt"

  # Pick the last draw EID (its bound render target holds the final surface content).
  rdc draws --json >"$DK/draws.json" 2>/dev/null || echo '[]' >"$DK/draws.json"
  EID="$(python3 - "$DK/draws.json" <<'PY'
import json, sys
try:
    draws = json.load(open(sys.argv[1]))
except Exception:
    draws = []
if isinstance(draws, dict):
    draws = draws.get("draws", draws.get("rows", []))
eids = [int(d["eid"]) for d in draws if isinstance(d, dict) and str(d.get("eid", "")).isdigit()]
print(max(eids) if eids else "")
PY
)"
  rt_rc=1
  if [ -n "$EID" ]; then
    echo "== rdc rt $EID -o $RTPNG =="
    if rdc rt "$EID" -o "$RTPNG" && [ -s "$RTPNG" ]; then rt_rc=0; fi
  fi
  rdc close >/dev/null 2>&1 || true
  if [ "$rt_rc" = 0 ]; then
    echo "== RENDER TARGET exported -> $RTPNG ($(stat -c%s "$RTPNG") bytes) =="
    echo "== inspect it with the Read tool; full debugging via: skill renderdoc-gpu-debug =="
    exit 0
  fi
  # Replay opened but the RT export failed -- per the acceptance path a thumbnail is
  # NOT a substitute, so emit it only as a diagnostic and fail.
  echo "== rdc rt failed (EID='$EID'); diagnostic thumbnail -> $RTPNG_THUMB =="
  renderdoccmd thumb -o "$RTPNG_THUMB" "$OUTRDC" >/dev/null 2>&1 || true
  echo "== capture OK ($OUTRDC) but 'rdc rt' render-target export failed =="
  exit 1
fi

# --- rdc open failed: no replay driver for this capture's API on this install ---
cat "$DK/open.log"
CAPDRV="$(python3 - "$OUTRDC" <<'PY'
import sys
try:
    from rdc.discover import find_renderdoc
    rd = find_renderdoc()
    cf = rd.OpenCaptureFile(); cf.OpenFile(sys.argv[1], "", None)
    print(cf.DriverName()); cf.Shutdown()
except Exception:
    print("unknown")
PY
)"
echo "== [warn] rdc replay unavailable for this capture (driver: $CAPDRV) =="
echo "   Root cause: the local rdc python module links a librenderdoc built WITHOUT the"
echo "   OpenGL/GLES replay driver (Vulkan-only). The system librenderdoc used by"
echo "   renderdoccmd (/usr/lib64/renderdoc) DOES have GLES+EGL replay, but ships no"
echo "   matching python module and its version differs, so the remoteserver proxy is"
echo "   refused. Open $OUTRDC on a box/CI whose rdc module has GL replay, or in the GUI."
echo "== best available visual: capture's embedded backbuffer thumbnail -> $RTPNG =="
if renderdoccmd thumb -o "$RTPNG" "$OUTRDC" >/dev/null 2>&1 && [ -s "$RTPNG" ]; then
  echo "== THUMBNAIL exported -> $RTPNG ($(stat -c%s "$RTPNG") bytes); inspect with the Read tool =="
  echo "== capture is valid at $OUTRDC (replay it later with a GL-replay-capable rdc) =="
  exit 0
fi
echo "== capture OK ($OUTRDC) but neither replay nor thumbnail export worked =="
exit 1
