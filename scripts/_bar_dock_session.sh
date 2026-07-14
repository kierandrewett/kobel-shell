#!/usr/bin/env bash
# Inner smoke-test body. Runs inside the isolated dbus-run-session created by
# run-bar-dock-in-gnoblin.sh.
set -euo pipefail

export GNOME_SHELL_DISABLE_EXTENSIONS=1

pids=()
cleanup() {
    local index

    for ((index = ${#pids[@]} - 1; index > 0; index--)); do
        kill "${pids[$index]}" 2>/dev/null || true
    done
    for ((index = ${#pids[@]} - 1; index > 0; index--)); do
        wait "${pids[$index]}" 2>/dev/null || true
    done
    if ((${#pids[@]} > 0)); then
        kill "${pids[0]}" 2>/dev/null || true
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

"$PREFIX/bin/gnome-shell" --headless --wayland --no-x11 --mode=gnoblin \
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

stdbuf -oL -eL "$BAR_BIN" >"$DK/bar.log" 2>&1 &
bar_pid=$!
pids+=("$bar_pid")
stdbuf -oL -eL "$DOCK_BIN" >"$DK/dock.log" 2>&1 &
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

FREYA_DEVTOOLS_ADDR=127.0.0.1:7354 \
    stdbuf -oL -eL "$BAR_PREVIEW_BIN" >"$DK/bar-preview.log" 2>&1 &
bar_preview_pid=$!
pids+=("$bar_preview_pid")
FREYA_DEVTOOLS_ADDR=127.0.0.1:7355 \
    stdbuf -oL -eL "$DOCK_PREVIEW_BIN" >"$DK/dock-preview.log" 2>&1 &
dock_preview_pid=$!
pids+=("$dock_preview_pid")

wait_for_server() {
    local log="$1"
    local port="$2"

    for _ in $(seq 1 40); do
        grep -q "Running the Devtools Server on 127.0.0.1:$port" "$log" && return 0
        sleep 0.5
    done
    return 1
}

if ! wait_for_server "$DK/bar-preview.log" 7354; then
    echo "FAIL: bar preview devtools server did not start"
    fail=1
fi
if ! wait_for_server "$DK/dock-preview.log" 7355; then
    echo "FAIL: dock preview devtools server did not start"
    fail=1
fi

FREYA_DEVTOOLS_ADDR=127.0.0.1:7354 \
    stdbuf -oL -eL "$INSPECTOR_BIN" >"$DK/bar-inspector.log" 2>&1 &
bar_inspector_pid=$!
pids+=("$bar_inspector_pid")
FREYA_DEVTOOLS_ADDR=127.0.0.1:7355 \
    stdbuf -oL -eL "$INSPECTOR_BIN" >"$DK/dock-inspector.log" 2>&1 &
dock_inspector_pid=$!
pids+=("$dock_inspector_pid")

wait_for_connection() {
    local port="$1"

    for _ in $(seq 1 40); do
        ss -Htn state established | grep -q "127.0.0.1:$port" && return 0
        sleep 0.5
    done
    return 1
}

if wait_for_connection 7354; then
    echo "PASS: bar inspector connected on 127.0.0.1:7354"
else
    echo "FAIL: bar inspector did not connect"
    fail=1
fi
if wait_for_connection 7355; then
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
