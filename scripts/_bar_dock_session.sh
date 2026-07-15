#!/usr/bin/env bash
# Inner smoke-test body. Runs inside the isolated dbus-run-session created by
# run-bar-dock-in-gnoblin.sh.
set -euo pipefail

export GNOME_SHELL_DISABLE_EXTENSIONS=1

pids=()
cleanup() {
    local index

    for ((index = ${#pids[@]} - 1; index > 0; index--)); do
        kill -- "-${pids[$index]}" 2>/dev/null || true
    done
    for ((index = ${#pids[@]} - 1; index > 0; index--)); do
        wait "${pids[$index]}" 2>/dev/null || true
    done
    if ((${#pids[@]} > 0)); then
        kill -- "-${pids[0]}" 2>/dev/null || true
        wait "${pids[0]}" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

monitor_args=()
for monitor in $VIRTUAL_MONITORS; do
    monitor_args+=(--virtual-monitor "$monitor")
done
expected_outputs=$((${#monitor_args[@]} / 2))
if [ "$expected_outputs" -eq 0 ]; then
    echo "FAIL: VIRTUAL_MONITORS did not define any outputs"
    exit 1
fi

setsid "$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
    "${monitor_args[@]}" --wayland-display "$DISP" >"$DK/shell.log" 2>&1 &
shell_pid=$!
pids+=("$shell_pid")

for _ in $(seq 1 60); do
    sleep 0.5
    [ -S "$XDG_RUNTIME_DIR/$DISP" ] && break
done
if [ ! -S "$XDG_RUNTIME_DIR/$DISP" ]; then
    echo "[bar-dock] compositor socket was not created"
    tail -20 "$DK/shell.log"
    exit 1
fi

for _ in $(seq 1 40); do
    grep -q "GNOME Shell started" "$DK/shell.log" && break
    sleep 0.5
done

export WAYLAND_DISPLAY="$DISP"

setsid stdbuf -oL -eL "$BAR_BIN" >"$DK/bar.log" 2>&1 &
bar_pid=$!
pids+=("$bar_pid")
setsid stdbuf -oL -eL "$DOCK_BIN" >"$DK/dock.log" 2>&1 &
dock_pid=$!
pids+=("$dock_pid")

wait_for_mounts() {
    local log="$1"
    local label="$2"
    local count

    for _ in $(seq 1 40); do
        count="$(grep -c "\[$label\] mounted" "$log" || true)"
        [ "$count" -ge "$expected_outputs" ] && return 0
        sleep 0.5
    done
    return 1
}

fail=0
if ! wait_for_mounts "$DK/bar.log" bar; then
    echo "FAIL: bar did not reach $expected_outputs output mounts"
    fail=1
fi
if ! wait_for_mounts "$DK/dock.log" dock; then
    echo "FAIL: dock did not reach $expected_outputs output mounts"
    fail=1
fi

for process in "$bar_pid:$DK/bar.log" "$dock_pid:$DK/dock.log"; do
    pid="${process%%:*}"
    log="${process#*:}"
    if ! kill -0 "$pid" 2>/dev/null; then
        echo "FAIL: layer-shell process exited"
        tail -30 "$log"
        fail=1
    fi
done
primary_monitor="${VIRTUAL_MONITORS%% *}"
primary_width="${primary_monitor%%x*}"
clock_x=$((primary_width / 2))
if ! python3 "$INPUT_DRIVER" --settle-prime 0.5 "click:${clock_x}:16" "wait:500"; then
    echo "FAIL: calendar popup input injection failed"
    fail=1
fi
calendar_opened=0
for _ in $(seq 1 20); do
    if grep -q "\[bar\] opened Calendar popup" "$DK/bar.log"; then
        calendar_opened=1
        break
    fi
    sleep 0.1
done
if [ "$calendar_opened" -ne 1 ]; then
    echo "FAIL: clock click did not open the calendar popup"
    tail -30 "$DK/bar.log"
    fail=1
else
    echo "PASS: clock click opened the calendar popup"
fi

calendar_screenshot="$(
    gdbus call --session \
        --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$CALENDAR_OUT" 2>&1
)"
case "$calendar_screenshot" in
    "(true,"*) ;;
    *)
        echo "FAIL: calendar screenshot call failed: $calendar_screenshot"
        fail=1
        ;;
esac
if [ ! -s "$CALENDAR_OUT" ]; then
    echo "FAIL: calendar screenshot is missing or empty: $CALENDAR_OUT"
    fail=1
else
    echo "PASS: captured $CALENDAR_OUT"
fi

if ! python3 "$INPUT_DRIVER" --settle-prime 0.5 "key:Escape" "wait:500"; then
    echo "FAIL: calendar popup Escape injection failed"
    fail=1
fi
calendar_closed=0
for _ in $(seq 1 20); do
    if grep -q "\[bar\] Calendar popup .* closed" "$DK/bar.log"; then
        calendar_closed=1
        break
    fi
    sleep 0.1
done
if [ "$calendar_closed" -ne 1 ]; then
    echo "FAIL: Escape did not close the calendar popup"
    tail -30 "$DK/bar.log"
    fail=1
else
    echo "PASS: Escape closed the calendar popup"
fi

status_x=$((primary_width - 48))
quick_settings_drill_x=$((primary_width - 220))
quick_settings_closed_before=$(grep -c "\[bar\] QuickSettings popup .* closed" "$DK/bar.log" || true)
if ! python3 "$INPUT_DRIVER" \
    --settle-prime 0.5 \
    "click:${status_x}:16" \
    "wait:500" \
    "screenshot:${QUICK_SETTINGS_OUT}" \
    "click:${quick_settings_drill_x}:126" \
    "wait:500" \
    "screenshot:${QUICK_SETTINGS_DRILL_OUT}" \
    "key:Escape" \
    "wait:500" \
    "key:Escape" \
    "wait:500" >"$DK/quick-settings-input.log" 2>&1; then
    echo "FAIL: quick settings interaction injection failed"
    fail=1
fi
cat "$DK/quick-settings-input.log"

if grep -q "\[bar\] opened QuickSettings popup" "$DK/bar.log"; then
    echo "PASS: status click opened quick settings"
else
    echo "FAIL: status click did not open quick settings"
    tail -30 "$DK/bar.log"
    fail=1
fi

if [ -s "$QUICK_SETTINGS_OUT" ]; then
    echo "PASS: captured $QUICK_SETTINGS_OUT"
else
    echo "FAIL: quick settings screenshot is missing or empty: $QUICK_SETTINGS_OUT"
    fail=1
fi

if grep -q "\[bar\] quick settings view Wifi" "$DK/bar.log"; then
    echo "PASS: Wi-Fi drill opened"
else
    echo "FAIL: Wi-Fi drill did not open"
    tail -30 "$DK/bar.log"
    fail=1
fi

if [ -s "$QUICK_SETTINGS_DRILL_OUT" ]; then
    echo "PASS: captured $QUICK_SETTINGS_DRILL_OUT"
else
    echo "FAIL: quick settings drill screenshot is missing or empty: $QUICK_SETTINGS_DRILL_OUT"
    fail=1
fi

if grep -q "\[bar\] quick settings escape Back" "$DK/bar.log"; then
    echo "PASS: Escape returned from the Wi-Fi drill"
else
    echo "FAIL: Escape did not return from the Wi-Fi drill"
    tail -30 "$DK/bar.log"
    fail=1
fi

quick_settings_closed_after=$(grep -c "\[bar\] QuickSettings popup .* closed" "$DK/bar.log" || true)
if grep -q "\[bar\] quick settings escape Close" "$DK/bar.log" \
    && [ "$quick_settings_closed_after" -gt "$quick_settings_closed_before" ]; then
    echo "PASS: Escape closed quick settings from its root"
else
    echo "FAIL: Escape did not close quick settings from its root"
    tail -30 "$DK/bar.log"
    fail=1
fi

for port in 7354 7355; do
    if [ -n "$(ss -Htnl "sport = :$port")" ]; then
        echo "FAIL: devtools port $port is already in use"
        exit 1
    fi
done
touch "$DK/devtools-owned"

FREYA_DEVTOOLS_ADDR=127.0.0.1:7354 \
    setsid stdbuf -oL -eL "$BAR_PREVIEW_BIN" >"$DK/bar-preview.log" 2>&1 &
bar_preview_pid=$!
pids+=("$bar_preview_pid")
FREYA_DEVTOOLS_ADDR=127.0.0.1:7355 \
    setsid stdbuf -oL -eL "$DOCK_PREVIEW_BIN" >"$DK/dock-preview.log" 2>&1 &
dock_preview_pid=$!
pids+=("$dock_preview_pid")

wait_for_server() {
    local log="$1"
    local port="$2"
    local pid="$3"

    for _ in $(seq 1 40); do
        grep -q "Devtools server error" "$log" && return 1
        ss -Htnlp "sport = :$port" | grep -q "pid=$pid," && return 0
        sleep 0.5
    done
    return 1
}

if ! wait_for_server "$DK/bar-preview.log" 7354 "$bar_preview_pid"; then
    echo "FAIL: bar preview devtools server did not start"
    fail=1
fi
if ! wait_for_server "$DK/dock-preview.log" 7355 "$dock_preview_pid"; then
    echo "FAIL: dock preview devtools server did not start"
    fail=1
fi

FREYA_DEVTOOLS_ADDR=127.0.0.1:7354 \
    setsid stdbuf -oL -eL "$INSPECTOR_BIN" >"$DK/bar-inspector.log" 2>&1 &
bar_inspector_pid=$!
pids+=("$bar_inspector_pid")
FREYA_DEVTOOLS_ADDR=127.0.0.1:7355 \
    setsid stdbuf -oL -eL "$INSPECTOR_BIN" >"$DK/dock-inspector.log" 2>&1 &
dock_inspector_pid=$!
pids+=("$dock_inspector_pid")

wait_for_connection() {
    local port="$1"
    local pid="$2"

    for _ in $(seq 1 40); do
        ss -Htnp "dport = :$port" | grep -q "pid=$pid," && return 0
        sleep 0.5
    done
    return 1
}

if wait_for_connection 7354 "$bar_inspector_pid"; then
    echo "PASS: bar inspector connected on 127.0.0.1:7354"
else
    echo "FAIL: bar inspector did not connect"
    fail=1
fi
if wait_for_connection 7355 "$dock_inspector_pid"; then
    echo "PASS: dock inspector connected on 127.0.0.1:7355"
else
    echo "FAIL: dock inspector did not connect"
    fail=1
fi

for process in \
    "$bar_preview_pid:$DK/bar-preview.log" \
    "$dock_preview_pid:$DK/dock-preview.log" \
    "$bar_inspector_pid:$DK/bar-inspector.log" \
    "$dock_inspector_pid:$DK/dock-inspector.log"; do
    pid="${process%%:*}"
    log="${process#*:}"
    if ! kill -0 "$pid" 2>/dev/null; then
        echo "FAIL: preview or inspector process exited"
        tail -30 "$log"
        fail=1
    fi
done
for log in "$DK/bar-preview.log" "$DK/dock-preview.log"; do
    if grep -q "Devtools server error" "$log"; then
        echo "FAIL: preview reported a devtools server error"
        tail -30 "$log"
        fail=1
    fi
done

for _ in 1 2 3; do
    pkill -9 -f gnome-tour 2>/dev/null || true
    sleep 0.3
done

screenshot_result="$(
    gdbus call --session \
        --dest org.gnome.Shell.Screenshot \
        --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" 2>&1
)"
case "$screenshot_result" in
    "(true,"*) ;;
    *)
        echo "FAIL: screenshot call failed: $screenshot_result"
        fail=1
        ;;
esac
if [ ! -s "$OUT" ]; then
    echo "FAIL: screenshot is missing or empty: $OUT"
    fail=1
else
    echo "PASS: captured $OUT"
fi

# Allow output callbacks to settle, then reject duplicate or missing mounts.
sleep 0.5
assert_mounts() {
    local log="$1"
    local label="$2"
    local count
    local line
    local unique_count
    local -A outputs=()

    count="$(grep -c "\[$label\] mounted" "$log" || true)"
    while IFS= read -r line; do
        if [[ "$line" =~ on\ (OutputId\([0-9]+\)) ]]; then
            outputs["${BASH_REMATCH[1]}"]=1
        fi
    done < <(grep "\[$label\] mounted" "$log" || true)
    unique_count="${#outputs[@]}"

    if [ "$count" -eq "$expected_outputs" ] && [ "$unique_count" -eq "$expected_outputs" ]; then
        echo "PASS: $label mounted exactly once on all $expected_outputs outputs"
        return
    fi
    echo "FAIL: $label logged $count mounts across $unique_count distinct outputs, expected $expected_outputs"
    fail=1
}

assert_mounts "$DK/bar.log" bar
assert_mounts "$DK/dock.log" dock

echo "== bar log =="
cat "$DK/bar.log"
echo "== dock log =="
cat "$DK/dock.log"
echo "== preview endpoints =="
grep -h "Running the Devtools Server" "$DK/bar-preview.log" "$DK/dock-preview.log" || true

if [ "$fail" -ne 0 ]; then
    exit 1
fi

echo "== bar/dock smoke PASS =="
