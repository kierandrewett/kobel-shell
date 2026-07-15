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
primary_height="${primary_monitor#*x}"
primary_bar_geometry=""
for _ in $(seq 1 40); do
    primary_bar_geometry="$(grep -m1 "\[bar\] output .* resolved to" "$DK/bar.log" || true)"
    [ -n "$primary_bar_geometry" ] && break
    sleep 0.1
done
if [[ "$primary_bar_geometry" =~ resolved\ to\ ([0-9]+)x([0-9]+)$ ]]; then
    primary_width="${BASH_REMATCH[1]}"
    primary_height="${BASH_REMATCH[2]}"
else
    echo "FAIL: bar did not report resolved primary output geometry"
    fail=1
fi

expected_popup_width=$((primary_width - 24))
if [ "$expected_popup_width" -gt 384 ]; then
    expected_popup_width=384
elif [ "$expected_popup_width" -lt 1 ]; then
    expected_popup_width=1
fi
# Mirrors the public bar surface height and popover screen inset exercised by
# PopoverLayout::for_output; a mismatch is exactly what this hosted gate should catch.
expected_popup_height=$((primary_height - 32 - 12))
if [ "$expected_popup_height" -gt 620 ]; then
    expected_popup_height=620
elif [ "$expected_popup_height" -lt 1 ]; then
    expected_popup_height=1
fi
expected_datemenu_width=$((primary_width - 24))
if [ "$expected_datemenu_width" -gt 664 ]; then
    expected_datemenu_width=664
elif [ "$expected_datemenu_width" -lt 1 ]; then
    expected_datemenu_width=1
fi

# Session controls now live inside Quick Settings: a Power control in the QS
# system row opens a keyboard-navigable session view (Lock/Log out/Restart/Shut
# down). Open QS, click Power, then arm Restart from the keyboard -- this also
# exercises the real key delivery path into the embedded session view.
qs_status_x=$((primary_width - 60))
qs_power_x=$((primary_width - 51))
qs_power_y=70
qs_closed_before=$(grep -c "\[bar\] QuickSettings popup .* closed" "$DK/bar.log" || true)
if ! python3 "$INPUT_DRIVER" \
    --settle-prime 1.5 \
    "click:${qs_status_x}:16" \
    "wait:500" \
    "screenshot:${SESSION_OUT}" \
    "click:${qs_power_x}:${qs_power_y}" \
    "wait:500" \
    "key:Down" \
    "wait:200" \
    "key:Return" \
    "wait:500" \
    "screenshot:${SESSION_CONFIRM_OUT}" >"$DK/session-input.log" 2>&1; then
    echo "FAIL: session popup interaction injection failed"
    fail=1
fi
cat "$DK/session-input.log"
if grep -q "\[bar\] opened QuickSettings popup" "$DK/bar.log" \
    && grep -q "\[bar\] quick settings view Session" "$DK/bar.log" \
    && grep -q "\[bar\] session armed Restart" "$DK/bar.log"; then
    echo "PASS: quick settings session view armed restart confirmation"
else
    echo "FAIL: quick settings session view did not arm restart confirmation"
    tail -30 "$DK/bar.log"
    fail=1
fi
if [ -s "$SESSION_OUT" ] && [ -s "$SESSION_CONFIRM_OUT" ]; then
    echo "PASS: captured session and confirmation states"
else
    echo "FAIL: session popup screenshots are missing or empty"
    fail=1
fi

# First Escape disarms the pending Restart without leaving the session view.
if ! python3 "$INPUT_DRIVER" --settle-prime 1.5 "key:Escape" "wait:500"; then
    echo "FAIL: session confirmation Escape injection failed"
    fail=1
fi
qs_closed_after_disarm=$(grep -c "\[bar\] QuickSettings popup .* closed" "$DK/bar.log" || true)
if grep -q "\[bar\] session disarmed Restart" "$DK/bar.log" \
    && [ "$qs_closed_after_disarm" -eq "$qs_closed_before" ]; then
    echo "PASS: first Escape disarmed restart without closing"
else
    echo "FAIL: first Escape did not disarm restart cleanly"
    tail -30 "$DK/bar.log"
    fail=1
fi

# Second Escape returns to the QS root; third closes the popup.
if ! python3 "$INPUT_DRIVER" --settle-prime 1.5 "key:Escape" "wait:500" "key:Escape" "wait:500"; then
    echo "FAIL: session close Escape injection failed"
    fail=1
fi
qs_closed_after=$(grep -c "\[bar\] QuickSettings popup .* closed" "$DK/bar.log" || true)
if [ "$qs_closed_after" -gt "$qs_closed_after_disarm" ]; then
    echo "PASS: Escape returned to root and closed quick settings from the session view"
else
    echo "FAIL: Escape did not close quick settings from the session view"
    tail -30 "$DK/bar.log"
    fail=1
fi

clock_x=$((primary_width / 2))
if [ "$primary_width" -le 520 ]; then
    clock_x=36
fi
if ! python3 "$INPUT_DRIVER" --settle-prime 1.5 "click:${clock_x}:16" "wait:500" "screenshot:${CALENDAR_OUT}"; then
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

if [ ! -s "$CALENDAR_OUT" ]; then
    echo "FAIL: calendar screenshot is missing or empty: $CALENDAR_OUT"
    fail=1
else
    echo "PASS: captured $CALENDAR_OUT"
fi

if ! python3 "$INPUT_DRIVER" --settle-prime 1.5 "key:Escape" "wait:500"; then
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

notifications_x=$((primary_width / 2))
if [ "$primary_width" -le 520 ]; then
    notifications_x=36
fi
notifications_closed_before=$(grep -c "\[bar\] Calendar popup .* closed" "$DK/bar.log" || true)
notifications_opened_before=$(grep -c "\[bar\] opened Calendar popup" "$DK/bar.log" || true)
if ! gdbus call --session \
    --dest org.freedesktop.Notifications \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "Kobel smoke" 0 "" "Smoke notification" "Service-backed notification content" "[]" "{}" 5000 \
    >"$DK/notification-send.log" 2>&1; then
    echo "FAIL: could not send a test notification"
    cat "$DK/notification-send.log"
    fail=1
fi

status_x=$((primary_width - 60))
quick_settings_drill_x=$((primary_width - 227))
if [ "$primary_width" -lt 408 ]; then
    quick_settings_drill_x=$((primary_width - 58))
elif [ "$quick_settings_drill_x" -lt 48 ]; then
    quick_settings_drill_x=48
fi
quick_settings_closed_before=$(grep -c "\[bar\] QuickSettings popup .* closed" "$DK/bar.log" || true)
if ! python3 "$INPUT_DRIVER" \
    --settle-prime 1.5 \
    "click:${status_x}:16" \
    "wait:500" \
    "screenshot:${QUICK_SETTINGS_OUT}" \
    "click:${quick_settings_drill_x}:126" \
    "wait:500" \
    "screenshot:${QUICK_SETTINGS_DRILL_OUT}" \
    "key:Escape" \
    "wait:500" \
    "key:Escape" \
    "wait:500" \
    "move:${notifications_x}:16" \
    "wait:250" \
    "click" \
    "wait:500" \
    "screenshot:${NOTIFICATIONS_OUT}" \
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

notifications_opened_after=$(grep -c "\[bar\] opened Calendar popup" "$DK/bar.log" || true)
notifications_closed_after=$(grep -c "\[bar\] Calendar popup .* closed" "$DK/bar.log" || true)
if [ "$notifications_opened_after" -gt "$notifications_opened_before" ] \
    && [ "$notifications_closed_after" -gt "$notifications_closed_before" ]; then
    echo "PASS: clock date menu opened notifications and Escape closed it"
else
    echo "FAIL: notification popup lifecycle did not complete"
    tail -30 "$DK/bar.log"
    fail=1
fi
if [ -s "$NOTIFICATIONS_OUT" ]; then
    echo "PASS: captured $NOTIFICATIONS_OUT"
else
    echo "FAIL: notification popup screenshot is missing or empty: $NOTIFICATIONS_OUT"
    fail=1
fi

history_send_failed=0
for index in {2..9}; do
    if ! gdbus call --session \
        --dest org.freedesktop.Notifications \
        --object-path /org/freedesktop/Notifications \
        --method org.freedesktop.Notifications.Notify \
        "Kobel history" 0 "" "History item ${index}" "Scrollable notification history ${index}" "[]" "{}" 30000 \
        >>"$DK/notification-history-send.log" 2>&1; then
        history_send_failed=1
    fi
done
if [ "$history_send_failed" -ne 0 ]; then
    echo "FAIL: could not populate notification history"
    cat "$DK/notification-history-send.log"
    fail=1
fi

# A new devkit RemoteDesktop session can inherit the last pointer coordinate.
# Force a real in-bounds move away before targeting the same top-bar control.
notifications_history_opened_before=$(grep -c "\[bar\] opened Calendar popup" "$DK/bar.log" || true)
notifications_history_closed_before=$(grep -c "\[bar\] Calendar popup .* closed" "$DK/bar.log" || true)
if ! python3 "$INPUT_DRIVER" \
    --settle-prime 1.5 \
    "move:$((primary_width / 2)):$((primary_height / 2))" \
    "wait:250" \
    "move:${notifications_x}:16" \
    "wait:250" \
    "click" \
    "wait:500" \
    "screenshot:${NOTIFICATIONS_HISTORY_OUT}" \
    "key:Escape" \
    "wait:500" >"$DK/notifications-history-input.log" 2>&1; then
    echo "FAIL: notification history interaction injection failed"
    fail=1
fi
cat "$DK/notifications-history-input.log"
notifications_history_opened_after=$(grep -c "\[bar\] opened Calendar popup" "$DK/bar.log" || true)
notifications_history_closed_after=$(grep -c "\[bar\] Calendar popup .* closed" "$DK/bar.log" || true)
if [ "$notifications_history_opened_after" -gt "$notifications_history_opened_before" ] \
    && [ "$notifications_history_closed_after" -gt "$notifications_history_closed_before" ]; then
    echo "PASS: long notification history opened and closed"
else
    echo "FAIL: long notification history lifecycle did not complete"
    tail -30 "$DK/bar.log"
    fail=1
fi
if [ -s "$NOTIFICATIONS_HISTORY_OUT" ]; then
    echo "PASS: captured $NOTIFICATIONS_HISTORY_OUT"
else
    echo "FAIL: notification history screenshot is missing or empty: $NOTIFICATIONS_HISTORY_OUT"
    fail=1
fi
for panel in QuickSettings; do
    if grep -q "\[bar\] opened $panel popup .* at ${expected_popup_width}x${expected_popup_height}" "$DK/bar.log"; then
        echo "PASS: $panel popup resolved to ${expected_popup_width}x${expected_popup_height}"
    else
        echo "FAIL: $panel popup did not use ${expected_popup_width}x${expected_popup_height}"
        tail -30 "$DK/bar.log"
        fail=1
    fi
done
if grep -q "\[bar\] opened Calendar popup .* at ${expected_datemenu_width}x${expected_popup_height}" "$DK/bar.log"; then
    echo "PASS: Calendar popup resolved to ${expected_datemenu_width}x${expected_popup_height}"
else
    echo "FAIL: Calendar popup did not use ${expected_datemenu_width}x${expected_popup_height}"
    tail -30 "$DK/bar.log"
    fail=1
fi


primary_output_line="$(grep -m1 "\[dock\] mounted" "$DK/dock.log" || true)"
if [[ "$primary_output_line" =~ on\ (OutputId\([0-9]+\)) ]]; then
    primary_output="${BASH_REMATCH[1]}"
else
    primary_output=""
fi
show_point_line=""
if [ -n "$primary_output" ]; then
    for _ in $(seq 1 40); do
        show_point_line="$(grep -F "resolved Show Applications point" "$DK/dock.log" | grep -F "on $primary_output:" | tail -1 || true)"
        [ -n "$show_point_line" ] && break
        sleep 0.25
    done
fi
show_request_before=$(grep -c "Show Applications requires the native launcher" "$DK/dock.log" || true)
show_clicked=0
if [[ "$show_point_line" =~ x=([0-9]+)\ y=([0-9]+) ]]; then
    away_x=$((primary_width / 2))
    for attempt in 1 2 3; do
        show_point_line="$(grep -F "resolved Show Applications point" "$DK/dock.log" | grep -F "on $primary_output:" | tail -1 || true)"
        if [[ ! "$show_point_line" =~ x=([0-9]+)\ y=([0-9]+) ]]; then
            continue
        fi
        show_x="${BASH_REMATCH[1]}"
        show_y="${BASH_REMATCH[2]}"
        if python3 "$INPUT_DRIVER" \
            --settle-prime 1.5 \
            "move:${away_x}:$((primary_height / 2))" \
            "wait:250" \
            "move:${show_x}:${show_y}" \
            "wait:250" \
            "click" \
            "wait:500" >"$DK/dock-input.log" 2>&1; then
            show_request_after=$(grep -c "Show Applications requires the native launcher" "$DK/dock.log" || true)
            if [ "$show_request_after" -gt "$show_request_before" ]; then
                show_clicked=1
                break
            fi
        fi
    done
    cat "$DK/dock-input.log"
else
    echo "FAIL: no resolved Show Applications coordinate for the primary output"
fi
if [ "$show_clicked" -eq 1 ]; then
    echo "PASS: dock Show Applications click crossed the precise input region"
else
    echo "FAIL: dock Show Applications click did not reach its typed action"
    tail -30 "$DK/dock.log"
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

if ! python3 "$INPUT_DRIVER" --settle-prime 1.5 "screenshot:${OUT}" >"$DK/bar-dock-capture.log" 2>&1; then
    echo "FAIL: bar-dock screenshot injection failed"
    cat "$DK/bar-dock-capture.log"
    fail=1
fi
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

assert_provisional_widths_resolved() {
    local log="$1"
    local line
    local monitor
    local output
    local width
    local unresolved=0
    local -A expected_widths=()
    local -A provisional=()
    local -A resolved=()
    local -A resolved_widths=()

    for monitor in $VIRTUAL_MONITORS; do
        width="${monitor%%x*}"
        expected_widths["$width"]=$(( ${expected_widths[$width]:-0} + 1 ))
    done

    while IFS= read -r line; do
        if [[ "$line" =~ no\ logical\ width\ for\ (OutputId\([0-9]+\)) ]]; then
            provisional["${BASH_REMATCH[1]}"]=1
        elif [[ "$line" =~ updated\ SurfaceId\([0-9]+\)\ on\ (OutputId\([0-9]+\))\ to\ logical\ width\ ([0-9]+) ]]; then
            resolved["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        fi
    done < "$log"

    for output in "${!provisional[@]}"; do
        if [ -z "${resolved[$output]:-}" ]; then
            echo "FAIL: dock kept provisional geometry for $output"
            unresolved=1
        fi
    done
    for output in "${!resolved[@]}"; do
        width="${resolved[$output]}"
        resolved_widths["$width"]=$(( ${resolved_widths[$width]:-0} + 1 ))
    done
    for width in "${!expected_widths[@]}"; do
        if [ "${resolved_widths[$width]:-0}" -ne "${expected_widths[$width]}" ]; then
            echo "FAIL: dock resolved ${resolved_widths[$width]:-0} output(s) at ${width}px, expected ${expected_widths[$width]}"
            unresolved=1
        fi
    done

    if [ "$unresolved" -eq 0 ]; then
        echo "PASS: dock resolved every provisional output width to the virtual-monitor geometry"
    else
        fail=1
    fi
}

assert_provisional_widths_resolved "$DK/dock.log"

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
