#!/usr/bin/env python3
"""Persistent-connection RenderDoc trigger capture for an already-injected target.

Why this exists: `rdc capture-trigger` opens a TargetControl connection, fires
TriggerCapture, then disconnects immediately. The NewCapture notification -- which
carries the path/size/API of the .rdc RenderDoc just wrote -- arrives on that same
connection AFTER the next present, so a transient trigger loses both the capture and
its path (observed: trigger + separate `capture-list` returns an empty list).

This helper holds ONE connection for the whole trigger->present->NewCapture handshake
by reusing rdc-cli's own `run_target_control_loop` (drain -> TriggerCapture(1) -> wait
for NewCapture). Frame boundaries are per eglSwapBuffers, so it captures the NEXT
present on whichever kobel surface swaps first after arming (bar clock tick in the
idle/default case; the revealing surface when the caller toggles one). The written
capture is local, so we copy it to DEST.

Usage: rdc_capture.py IDENT DEST [TIMEOUT_SECONDS]
Emits one JSON line on stdout describing the result.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import time

from rdc.capture_core import run_target_control_loop
from rdc.discover import find_renderdoc


def _emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _connect(rd: object, ident: int, deadline: float) -> object | None:
    """Connect to the injected target's control server, retrying until it is up."""
    while time.monotonic() < deadline:
        tc = rd.CreateTargetControl("", ident, "rdc-cli", True)
        if tc is not None and tc.Connected():
            return tc
        if tc is not None:
            tc.Shutdown()
        time.sleep(0.2)
    return None


def main() -> int:
    if len(sys.argv) < 3:
        _emit({"success": False, "error": "usage: rdc_capture.py IDENT DEST [TIMEOUT]"})
        return 2
    ident = int(sys.argv[1])
    dest = sys.argv[2]
    timeout = float(sys.argv[3]) if len(sys.argv) > 3 else 20.0

    rd = find_renderdoc()
    if rd is None:
        _emit({"success": False, "error": "renderdoc module not found"})
        return 1

    tc = _connect(rd, ident, time.monotonic() + 8.0)
    if tc is None:
        _emit({"success": False, "error": f"cannot connect to target ident={ident}"})
        return 1

    try:
        # Arms TriggerCapture(1) then blocks on the same connection for NewCapture.
        cap = run_target_control_loop(tc, frame=None, timeout=timeout)
    finally:
        tc.Shutdown()

    result: dict[str, object] = {
        "success": bool(cap.success),
        "path": cap.path,
        "frame": cap.frame,
        "byte_size": cap.byte_size,
        "api": cap.api,
        "local": cap.local,
        "dest": dest,
        "error": cap.error,
    }
    if cap.success and cap.path and cap.local:
        if os.path.abspath(cap.path) == os.path.abspath(dest):
            # RenderDoc already wrote to the requested destination.
            result["copied"] = False
        else:
            try:
                shutil.copyfile(cap.path, dest)
                result["copied"] = True
            except OSError as exc:
                result["success"] = False
                result["error"] = f"copy {cap.path} -> {dest} failed: {exc}"
    elif cap.success and cap.path and not cap.local:
        result["success"] = False
        result["error"] = "capture is remote; local capture expected"

    _emit(result)
    return 0 if result["success"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
