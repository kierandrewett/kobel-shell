#!/usr/bin/env bash
# Build and smoke-test the independent bar, dock, previews and inspectors under
# a two-output headless gnoblin session.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GNOBLIN="${GNOBLIN:-/home/kieran/dev/gnoblin}"
PREFIX="$GNOBLIN/install"
OUT="${OUT:-/tmp/kobel-bar-dock.png}"
CALENDAR_OUT="${CALENDAR_OUT:-/tmp/kobel-bar-calendar.png}"
QUICK_SETTINGS_OUT="${QUICK_SETTINGS_OUT:-/tmp/kobel-bar-quick-settings.png}"
QUICK_SETTINGS_DRILL_OUT="${QUICK_SETTINGS_DRILL_OUT:-/tmp/kobel-bar-quick-settings-wifi.png}"
BAR_BIN="$ROOT/target/debug/kobel-bar"
DOCK_BIN="$ROOT/target/debug/kobel-dock"
BAR_PREVIEW_BIN="$ROOT/target/debug/kobel-bar-preview"
DOCK_PREVIEW_BIN="$ROOT/target/debug/kobel-dock-preview"
INSPECTOR_BIN="$ROOT/target/debug/freya-devtools-app"
INPUT_DRIVER="$ROOT/scripts/devkit_input.py"

[ -x "$PREFIX/bin/gnome-shell" ] || {
    echo "[bar-dock] no gnome-shell in $PREFIX; build gnoblin first" >&2
    exit 1
}

(
    cd "$ROOT"
    cargo build -p kobel-bar -p kobel-dock
    cargo build -p kobel-bar --bin kobel-bar-preview --features devtools
    cargo build -p kobel-dock --bin kobel-dock-preview --features devtools
    cargo build -p freya-devtools-app
)

for binary in "$BAR_BIN" "$DOCK_BIN" "$BAR_PREVIEW_BIN" "$DOCK_PREVIEW_BIN" "$INSPECTOR_BIN"; do
    [ -x "$binary" ] || {
        echo "[bar-dock] missing binary after build: $binary" >&2
        exit 1
    }
done

export LD_LIBRARY_PATH="$PREFIX/lib64:$PREFIX/lib64/mutter-17"
export GI_TYPELIB_PATH="$PREFIX/lib64/mutter-17"
export PATH="$PREFIX/bin:$PATH"
export GSETTINGS_SCHEMA_DIR="$PREFIX/share/glib-2.0/schemas"
export XDG_DATA_DIRS="$PREFIX/share:/usr/local/share:/usr/share"
export GDK_BACKEND=wayland
export GNOME_SHELL_SESSION_MODE=gnoblin
export XDG_CURRENT_DESKTOP=GNOME:Gnoblin

DK="$(mktemp -d /tmp/kobel-bar-dock.XXXXXX)"
mkdir -p "$DK"/{data,config,cache,home}
export HOME="$DK/home"
export XDG_DATA_HOME="$DK/data"
export XDG_CONFIG_HOME="$DK/config"
export XDG_CACHE_HOME="$DK/cache"
export GIO_USE_VFS=local
export GVFS_DISABLE_FUSE=1
export GSETTINGS_BACKEND=dconf
export GTK_A11Y=none
export NO_AT_BRIDGE=1
export DISP="kobel-bar-dock-$$"
export VIRTUAL_MONITORS="${VIRTUAL_MONITORS:-1280x800 1024x768}"
export DK OUT CALENDAR_OUT QUICK_SETTINGS_OUT QUICK_SETTINGS_DRILL_OUT PREFIX BAR_BIN DOCK_BIN BAR_PREVIEW_BIN DOCK_PREVIEW_BIN INSPECTOR_BIN INPUT_DRIVER

CONF="$(python3 "$GNOBLIN/scripts/devkit_dbus.py" "$DK" "$GNOBLIN")"

cleanup() {
    rm -rf "$DK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set +e
dbus-run-session --config-file="$CONF" -- bash "$ROOT/scripts/_bar_dock_session.sh"
rc=$?
set -e
if [ -e "$DK/devtools-owned" ]; then
    listeners="$(ss -Htnlp 'sport = :7354 or sport = :7355')"
    if [ -n "$listeners" ]; then
        echo "FAIL: smoke left a devtools listener behind"
        echo "$listeners"
        rc=1
    fi
fi


for log in shell bar dock bar-preview dock-preview bar-inspector dock-inspector; do
    cp "$DK/$log.log" "/tmp/kobel-$log.log" 2>/dev/null || true
done
exit "$rc"
