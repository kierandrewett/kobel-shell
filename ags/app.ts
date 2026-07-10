// kobel-shell entry — AGS v2 / astal4
import { App } from "astal/gtk4"
import Gtk from "gi://Gtk?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
// astal `construct` sets static props via Object.assign(widget, props) and bindings via
// setProp → set_class. GtkWidget has neither a `class` GObject prop nor set_class, so
// `class="..."` silently no-ops (the real prop is `css-classes`, an array). Define a
// `class` accessor routing BOTH paths to set_css_classes, so `class="a b"` works.
Object.defineProperty((Gtk.Widget as any).prototype, "class", {
    configurable: true,
    set(v: string) {
        this.set_css_classes(String(v).split(/\s+/).filter(Boolean))
    },
    get() {
        return this.get_css_classes().join(" ")
    },
})
;(Gtk.Widget.prototype as any).set_class = function (v: string) {
    this.set_css_classes(String(v).split(/\s+/).filter(Boolean))
}
import style from "./style/main.scss"
import { tokenCss, tokens } from "./config"
import * as gnoblin from "./services/gnoblin"
import * as notifdSvc from "./services/notifd"
import { armDump } from "./lib/inspect"
import { toggle as surfaceToggle } from "./lib/surface"
import DismissLayer from "./widget/DismissLayer"
import Bar from "./widget/Bar"
import Dock from "./widget/Dock"
import Launcher from "./widget/Launcher"
import QuickSettings from "./widget/QuickSettings"
import Calendar from "./widget/Calendar"
import { Toasts, Drawer } from "./widget/Notifications"
import OSD from "./widget/OSD"
import Session from "./widget/Session"

printerr("KOBEL: module top reached")

// Custom icon set — the exact Heroicons/Lucide/Tabler the prototype uses, as
// recolorable symbolic SVGs. Registered on the default icon theme so iconName
// "kobel-wifi-symbolic" etc. resolve. Path override via KOBEL_ICONS for the devkit.
import GLibIcons from "gi://GLib"
const ICON_DIR =
    GLibIcons.getenv("KOBEL_ICONS") ??
    GLibIcons.build_filenamev([GLibIcons.get_current_dir(), "icons"])

const shellCss = () => (style + tokenCss(tokens)).replace(/^@charset "UTF-8";\n?/, "")

App.start({
    instanceName: "kobel",
    icons: ICON_DIR,
    main() {
        gnoblin.init()
        notifdSvc.init()
        // Load our stylesheet at USER priority (highest) so it beats Adwaita's theme
        // rules — astal's own css option applies too low, letting Adwaita win on e.g.
        // `scale > trough` (fat sliders). This provider is authoritative.
        try {
            const prov = new Gtk.CssProvider()
            prov.load_from_string(shellCss())
            Gtk.StyleContext.add_provider_for_display(
                Gdk.Display.get_default()!,
                prov,
                800 /* USER priority */
            )
        } catch (e) {
            printerr(`kobel: css provider failed: ${e}`)
        }
        // astal4 JSX <window> is created hidden (visible=false). Persistent chrome must
        // be present()ed; on-demand surfaces stay hidden and are shown by toggle_window.
        const make = (name: string, fn: () => any, show: boolean) => {
            try {
                const w = fn()
                if (w && typeof w.present === "function") {
                    App.add_window?.(w)
                    if (show) w.present()
                }
            } catch (e) {
                printerr(`kobel: ${name} FAILED: ${e}\n${(e as any)?.stack ?? ""}`)
            }
        }
        make("dismiss-layer", () => DismissLayer(), true)
        const monitors = App.get_monitors()
        const targets = monitors.length ? monitors : [undefined as any]
        for (const monitor of targets) {
            make("bar", () => Bar(monitor), true)
            make("dock", () => Dock(monitor), true)
            make("toasts", () => Toasts(monitor), true)
            make("osd", () => OSD(monitor), true)
        }
        make("launcher", () => Launcher(), false)
        make("quicksettings", () => QuickSettings(), false)
        make("calendar", () => Calendar(), false)
        make("drawer", () => Drawer(), false)
        make("session", () => Session(), false)
        // KOBEL_DUMP=<window>: dump the live GTK geometry tree for DOM-vs-GTK diffing.
        armDump((name) => App.get_window(name) as any)
    },
    // `astal -i kobel -t <window>` handled by App's request framework
    requestHandler(request, res) {
        const [cmd, arg] = request.split(" ")
        if (cmd === "toggle") {
            surfaceToggle(arg)
            return res("ok")
        }
        if (cmd === "reload-css") {
            App.apply_css(shellCss(), true)
            return res("ok")
        }
        res("unknown")
    },
})
