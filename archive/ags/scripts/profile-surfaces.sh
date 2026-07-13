#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT/scripts/run-in-gnoblin.sh"
GAP="${KOBEL_PROFILE_GAP:-3}"
REPEATS="${KOBEL_PROFILE_REPEATS:-2}"
OUTDIR="${KOBEL_PROFILE_OUTDIR:-/tmp/kobel-profile}"

mkdir -p "$OUTDIR"

if [ "$#" -gt 0 ]; then
  surfaces=("$@")
else
  surfaces=(quicksettings drawer launcher calendar session)
fi

printf '%-14s %-6s %-4s %8s %7s %9s %10s %12s %10s\n' \
  surface dir warm elapsed samples sample_hz max_gap_ms input_closed pixman_bug

for surface in "${surfaces[@]}"; do
  rm -f /tmp/kobel-ags-run.log /tmp/kobel-shell-run.log

  if ! OUT="$OUTDIR/$surface.png" \
    TOGGLE="$surface" \
    KOBEL_DEMO=1 \
    KOBEL_PROFILE_ANIM=1 \
    KOBEL_TOGGLE_REPEATS="$REPEATS" \
    KOBEL_TOGGLE_GAP="$GAP" \
    "$RUNNER" >/tmp/kobel-profile-run.out 2>&1; then
    cat /tmp/kobel-profile-run.out >&2
    printf '%-14s %-6s %-4s %8s %7s %9s %10s %12s %10s\n' \
      "$surface" failed - - - - - - -
    continue
  fi

  cp /tmp/kobel-ags-run.log "$OUTDIR/$surface.ags.log" 2>/dev/null || true
  cp /tmp/kobel-shell-run.log "$OUTDIR/$surface.shell.log" 2>/dev/null || true

  python3 - "$surface" "$OUTDIR/$surface.ags.log" <<'PY'
import sys
from pathlib import Path

surface = sys.argv[1]
log_path = Path(sys.argv[2])
text = log_path.read_text(errors="replace") if log_path.exists() else ""
lines = text.splitlines()
pixman_bug = "yes" if "*** BUG ***" in text else "no"
motion_lines = [line for line in lines if line.startswith("KOBEL_MOTION ")]
snap_lines = [
    line
    for line in lines
    if line.startswith("KOBEL_TRACE ")
    and f"surface={surface}" in line
    and "event=cold_snap" in line
]

close_blocks = []
current = None
for line in lines:
    if f"surface={surface}" not in line:
        continue
    if "event=close_start" in line:
        current = []
        close_blocks.append(current)
        continue
    if "event=open_start" in line and current is not None:
        current = None
        continue
    if current is not None:
        current.append(line)

input_closed = "n/a"
if close_blocks:
    input_closed = "yes"
    for block in close_blocks:
        def input_gate(line: str, enabled: str) -> bool:
            input_event = "event=surface_input" in line or "event=revealer_input" in line
            return input_event and f"enabled={enabled}" in line

        saw_disabled = any(input_gate(line, "0") for line in block)
        reenabled = any(input_gate(line, "1") for line in block)
        if not saw_disabled or reenabled:
            input_closed = "no"
            break

if not motion_lines and not snap_lines:
    row = f"{surface:<14} {'none':<6} {'-':<4} {'-':>8} {'-':>7} {'-':>9}"
    row += f" {'-':>10} {input_closed:>12} {pixman_bug:>10}"
    print(row)
    raise SystemExit

for line in snap_lines:
    fields = dict(part.split("=", 1) for part in line.split()[1:] if "=" in part)
    print(
        f"{surface:<14} "
        f"{'snap':<6} "
        f"{'0':<4} "
        f"{fields.get('elapsed_ms', '-'):>8} "
        f"{'-':>7} "
        f"{'-':>9} "
        f"{'-':>10} "
        f"{input_closed:>12} "
        f"{pixman_bug:>10}"
    )

for line in motion_lines:
    fields = dict(part.split("=", 1) for part in line.split()[1:] if "=" in part)
    print(
        f"{surface:<14} "
        f"{fields.get('direction', '-'):<6} "
        f"{fields.get('warm', '-'):<4} "
        f"{fields.get('elapsed_ms', '-'):>8} "
        f"{fields.get('samples', '-'):>7} "
        f"{fields.get('sample_hz', '-'):>9} "
        f"{fields.get('max_gap_ms', '-'):>10} "
        f"{input_closed:>12} "
        f"{pixman_bug:>10}"
    )
PY
done
