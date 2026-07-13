// kobel-shell — a Quickshell configuration for gnoblin.
//
// Run with:  qs -p ~/dev/kobel-shell    (or symlink to ~/.config/quickshell/kobel-shell)
//
// gnoblin (patched gnome-shell + mutter) strips its own top bar / overview / dash
// and exposes wlr-layer-shell + the org.gnoblin.Shell control protocol, so this
// draws the chrome. Start here and grow: add dock, launcher, notifications, OSD…
// each as a module, each toggling the matching gnome subsystem off via the Gnoblin
// service (e.g. Gnoblin.disable("notifications") once you ship your own daemon).

import Quickshell
import "modules" as Modules

ShellRoot {
    // One bar per monitor.
    Variants {
        model: Quickshell.screens
        Modules.Bar { }
    }
}
