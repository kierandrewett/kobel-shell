pragma Singleton

// Gnoblin — a thin Quickshell service over gnoblin's org.gnoblin.Shell control
// protocol. gnoblin is "just GNOME + mutter"; this drives its one addition (the
// control component) so your chrome can toggle gnome subsystems it wants to own,
// soft-reload the shell, and hot-reload extensions/scripts.
//
// MVP: shells out to `gnoblinctl` (installed by gnoblin). A future version can
// bind org.gnoblin.Shell over D-Bus directly (or a native Quickshell.Gnoblin
// plugin) — the surface here is deliberately the same as gnoblinctl's.

import QtQuick
import Quickshell
import Quickshell.Io

Singleton {
    id: root

    // Latest values, refreshed by refresh().
    property string version: ""
    property var features: []   // [{id, summary, enabled}]

    function ctl(args) {
        Quickshell.execDetached(["gnoblinctl"].concat(args));
    }

    // --- actions ---
    function reload()             { ctl(["reload"]); }               // Wayland soft-reload; windows survive
    function enable(feature)      { ctl(["enable", feature]); }      // hand a subsystem back to gnome
    function disable(feature)     { ctl(["disable", feature]); }     // your chrome owns it
    function reloadScripts()      { ctl(["reload-scripts"]); }
    function reloadExtension(u)   { ctl(["reload-ext", u]); }

    // --- reads (refresh version; features left as an exercise/extend as needed) ---
    function refresh() { versionProc.running = true; }

    Process {
        id: versionProc
        command: ["gnoblinctl", "version"]
        running: false
        stdout: StdioCollector {
            onStreamFinished: root.version = this.text.trim()
        }
    }

    Component.onCompleted: refresh()
}
