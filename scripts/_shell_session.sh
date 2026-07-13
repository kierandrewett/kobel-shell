#!/usr/bin/env bash
# Inner session body for the phase-2 pass -- runs INSIDE dbus-run-session.
set -u
export GNOME_SHELL_DISABLE_EXTENSIONS=1
# VIRTUAL_MONITORS: space-separated WxH list (default one 1280x800); each entry
# becomes a --virtual-monitor so the multi-monitor pass can run the same gate.
MON_ARGS=()
for m in ${VIRTUAL_MONITORS:-1280x800}; do MON_ARGS+=(--virtual-monitor "$m"); done
"$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
  "${MON_ARGS[@]}" --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
SP=$!
for _ in $(seq 1 60); do sleep 0.5; [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break; done
[ -S "$XDG_RUNTIME_DIR/$DISP" ] || { echo "NO-SOCKET"; tail -20 "$DK/shell.log"; exit 1; }
for _ in $(seq 1 40); do grep -q "GNOME Shell started" "$DK/shell.log" && break; sleep 0.5; done
echo "== shell up on $DISP =="

export WAYLAND_DISPLAY="$DISP"
# Forward the motion/profile flags (set by run-shell-in-gnoblin.sh, default empty)
# so KOBEL_PROFILE_ANIM/KOBEL_REDUCED_MOTION reach the real binary; the KOBEL_MOTION
# trace lines then land in kobel.log alongside RUST_LOG output.
RUST_LOG="${RUST_LOG:-info}" \
  KOBEL_PROFILE_ANIM="${KOBEL_PROFILE_ANIM:-}" \
  KOBEL_REDUCED_MOTION="${KOBEL_REDUCED_MOTION:-}" \
  stdbuf -oL -eL "$SHELL_BIN" >"$DK/kobel.log" 2>&1 &
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

# --- phase 6b: toast close button works (per-card input region) ---
# With the "Kobel Gate" toast still visible, click its close button and assert
# notifd dismisses the notification. The close button's SCREEN coordinates are
# derived from the toast layout constants (crates/kobel-shell/src/ui/notifications.rs
# + the toasts_cfg in main.rs), so this stays correct if the layout numbers change:
#   - Toasts surface: TOASTS_SURFACE_W x _H = 392 x 320, anchored TOP|RIGHT with
#     margins top=58 right=12. So the surface origin in screen coords is
#     (MON_W - 12 - 392, 58), where MON_W is the first virtual monitor's width.
#   - The newest card is flush to the surface's top-right corner (the overlay root
#     and the toast column both use cross_align End), width NCARD_W=341, padding
#     (vertical 11, horizontal 13). The close pill (ags .nx) is 22px at the header
#     row's right end. Hence, in surface-local coords:
#       close_x = TOASTS_SURFACE_W - pad_h(13) - NX/2(11) = 368
#       close_y = pad_v(11)      + NX/2(11)               = 22
mon_first="${VIRTUAL_MONITORS:-1280x800}"; mon_first="${mon_first%% *}"; MON_W="${mon_first%%x*}"
TOASTS_W=392; T_MARGIN_TOP=58; T_MARGIN_RIGHT=12; CARD_PAD_H=13; CARD_PAD_V=11; NX=22
surf_x=$(( MON_W - T_MARGIN_RIGHT - TOASTS_W ))
close_x=$(( surf_x + TOASTS_W - CARD_PAD_H - NX / 2 ))
close_y=$(( T_MARGIN_TOP + CARD_PAD_V + NX / 2 ))
closed_notifs() { grep -ac '\[notifd\] closed id=' "$DK/kobel.log"; }
before_x=$(closed_notifs)
python3 "$SCRIPTS_DIR/devkit_input.py" "click:${close_x}:${close_y}" >"$DK/inject-toast-close.log" 2>&1 \
  || { echo "FAIL: injector (toast close) exited nonzero"; cat "$DK/inject-toast-close.log"; fail=1; }
sleep 1
gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot \
  --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/toast-closed.png" >/dev/null 2>&1
cp "$DK/toast-closed.png" /tmp/kobel-toast-closed.png 2>/dev/null || true
if [ "$(closed_notifs)" -gt "$before_x" ]; then
  echo "PASS: toast close button dismissed the notification ([notifd] closed id=)"
else
  echo "FAIL: toast close button did not dismiss the notification (clicked ${close_x},${close_y})"
  grep -a "\[notifd\]" "$DK/kobel.log" | tail -5
  fail=1
fi
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

# --- fractional-scale verification (opt-in via KOBEL_TEST_SCALE, e.g. 1.5) ---
# Deep-host acceptance: drive mutter to a fractional monitor scale, then prove the
# kobel host (crates/kobel-wayland) received the preferred fractional scale and
# sized its PHYSICAL buffer to round(logical*scale) via a wp_viewport mapping (NOT
# integer buffer_scale). Runs LAST so all scale-1 checks above are exercised on the
# untouched 1280x800 monitor; the whole block is skipped unless KOBEL_TEST_SCALE is
# set to a non-1 value, so the default gate is byte-for-byte unaffected.
#
# mutter only offers scales whose logical size stays integer, so 1.5 is unavailable
# for 1280x800 (1280 is not divisible by 3); the helper falls back to the nearest
# supported non-1 scale (1.3333 == 160/120), which is a genuine fractional scale.
if [ -n "${KOBEL_TEST_SCALE:-}" ] && [ "${KOBEL_TEST_SCALE}" != "1" ]; then
  echo "== fractional-scale pass (KOBEL_TEST_SCALE=$KOBEL_TEST_SCALE) =="
  # Enable mutter's fractional scaling so non-integer monitor scales are offered.
  gsettings set org.gnome.mutter experimental-features "['scale-monitor-framebuffer']" 2>/dev/null || true
  sleep 1
  # Apply the (nearest supported) non-1 scale via org.gnome.Mutter.DisplayConfig.
  apply_out="$(python3 - "$KOBEL_TEST_SCALE" <<'PY'
import sys
from gi.repository import Gio, GLib
DESIRED = float(sys.argv[1])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
def call(method, params):
    return bus.call_sync("org.gnome.Mutter.DisplayConfig",
        "/org/gnome/Mutter/DisplayConfig", "org.gnome.Mutter.DisplayConfig",
        method, params, None, Gio.DBusCallFlags.NONE, -1, None)
serial, monitors, logical_monitors, props = call("GetCurrentState", None).unpack()
if not monitors:
    print("NO-MONITORS"); sys.exit(2)
mon = monitors[0]
connector = mon[0][0]
modes = mon[1]
cur = next((m for m in modes if m[6].get("is-current")), modes[0])
mode_id, mw, mh, refresh, pref, supported, mprops = cur
print(f"supported_scales={[round(s,4) for s in supported]}")
chosen = next((s for s in supported if abs(s - DESIRED) < 1e-3), None)
if chosen is None:
    non_one = [s for s in supported if abs(s - 1.0) > 1e-3]
    if not non_one:
        print("NO-NON-1-SCALE"); sys.exit(3)
    chosen = min(non_one, key=lambda s: abs(s - DESIRED))
# Persistent config (method=2) so it sticks for the rest of the pass (headless has
# no confirm dialog, so a temporary config would auto-revert).
logical = [(0, 0, float(chosen), 0, True, [(connector, mode_id, {})])]
args = GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", (serial, 2, logical, {}))
try:
    call("ApplyMonitorsConfig", args)
except GLib.Error as e:
    print(f"APPLY-FAILED {e.message}"); sys.exit(4)
print(f"APPLIED_SCALE={chosen}")
PY
)"
  ac_rc=$?
  echo "$apply_out"
  achieved="$(printf '%s\n' "$apply_out" | sed -n 's/^APPLIED_SCALE=//p' | tail -1)"
  if [ "$ac_rc" = 0 ] && [ -n "$achieved" ]; then
    echo "PASS: applied non-1 monitor scale $achieved via ApplyMonitorsConfig"
  else
    echo "FAIL: could not apply a non-1 monitor scale (rc=$ac_rc)"; fail=1
  fi
  # Let the shell receive preferred_scale + relayout, then screenshot for the orchestrator.
  sleep 3
  gdbus call --session --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$DK/fractional.png" >/dev/null 2>&1
  cp "$DK/fractional.png" /tmp/kobel-fractional.png 2>/dev/null || true
  [ -s "$DK/fractional.png" ] && echo "PASS: fractional-scale screenshot captured (/tmp/kobel-fractional.png)" \
    || { echo "FAIL: fractional-scale screenshot missing"; fail=1; }
  echo "-- host fractional preferred_scale logs --"
  grep -a "fractional preferred_scale=" "$DK/kobel.log" | tail -6
  # Verify: (a) a non-120 numerator was received; (b) every logged physical buffer
  # equals round(logical*num/120) per axis (host-computed vs an independent oracle).
  verify_out="$(python3 - "$DK/kobel.log" <<'PY'
import re, sys
lines = open(sys.argv[1], errors="ignore").read().splitlines()
pat = re.compile(r"fractional preferred_scale=(\d+)/120 .* logical (\d+)x(\d+) -> physical (\d+)x(\d+)")
nonone = []; bad = 0
for ln in lines:
    m = pat.search(ln)
    if not m:
        continue
    num, lw, lh, pw, ph = (int(x) for x in m.groups())
    ew = max(1, (lw * num + 60) // 120)   # round-half-up(logical*num/120), floored at 1
    eh = max(1, (lh * num + 60) // 120)
    if (pw, ph) != (ew, eh):
        print(f"MISMATCH num={num} logical {lw}x{lh} physical {pw}x{ph} expected {ew}x{eh}")
        bad += 1
    if num != 120:
        nonone.append((num, lw, lh, pw, ph))
print(f"RECEIVED={1 if nonone else 0}")
print(f"SIZING={'bad' if bad else 'ok'}")
if nonone:
    n = nonone[-1]
    print(f"detail: num={n[0]} scale={n[0]/120:.4f} logical {n[1]}x{n[2]} -> physical {n[3]}x{n[4]}")
PY
)"
  echo "$verify_out"
  recv="$(printf '%s\n' "$verify_out" | sed -n 's/^RECEIVED=//p' | tail -1)"
  sizing="$(printf '%s\n' "$verify_out" | sed -n 's/^SIZING=//p' | tail -1)"
  if [ "$recv" = 1 ]; then
    echo "PASS: host received a non-1 preferred fractional scale"
  else
    echo "FAIL: host never received a non-1 fractional preferred_scale"; fail=1
  fi
  if [ "$sizing" = ok ]; then
    echo "PASS: physical buffer dims == round(logical*scale) for every logged frame"
  else
    echo "FAIL: physical buffer sizing mismatch (see MISMATCH lines)"; fail=1
  fi
  if grep -aq "viewport destination" "$DK/kobel.log"; then
    echo "PASS: wp_viewport destination drives the mapping (buffer_scale stays 1)"
  else
    echo "FAIL: no viewport destination log (viewport mapping not active)"; fail=1
  fi
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
