// kobel-shell entry — AGS v2 / astal4
import { App } from "astal/gtk4"
import style from "./style/main.scss"
import { tokenCss, tokens } from "./config"
import * as gnoblin from "./services/gnoblin"
import * as notifdSvc from "./services/notifd"
import Bar from "./widget/Bar"
import Dock from "./widget/Dock"
import Launcher from "./widget/Launcher"
import QuickSettings from "./widget/QuickSettings"
import Calendar from "./widget/Calendar"
import { Toasts, Drawer } from "./widget/Notifications"
import OSD from "./widget/OSD"
import Session from "./widget/Session"

printerr("KOBEL: module top reached")
App.start({
  instanceName: "kobel",
  css: style + tokenCss(tokens),
  main() {
    gnoblin.init()
    notifdSvc.init()
    // astal4 JSX <window> is created hidden (visible=false). Persistent chrome must
    // be present()ed; on-demand surfaces stay hidden and are shown by toggle_window.
    const make = (name: string, fn: () => any, show: boolean) => {
      try {
        const w = fn()
        if (w && typeof w.present === "function") {
          App.add_window?.(w)
          if (show) w.present()
        }
      } catch (e) { printerr(`kobel: ${name} FAILED: ${e}`) }
    }
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
  },
  // `astal -i kobel -t <window>` handled by App's request framework
  requestHandler(request, res) {
    const [cmd, arg] = request.split(" ")
    if (cmd === "toggle") { App.toggle_window(arg); return res("ok") }
    if (cmd === "reload-css") { App.apply_css(style + tokenCss(tokens), true); return res("ok") }
    res("unknown")
  },
})
