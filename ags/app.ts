// kobel-shell entry — AGS v2 / astal4
import { App } from "astal/gtk4"
import style from "./style/main.scss"
import { tokenCss, tokens } from "./config"
import * as gnoblin from "./services/gnoblin"
import Bar from "./widget/Bar"
import Dock from "./widget/Dock"
import Launcher from "./widget/Launcher"
import QuickSettings from "./widget/QuickSettings"
import Calendar from "./widget/Calendar"
import { Toasts, Drawer } from "./widget/Notifications"
import OSD from "./widget/OSD"
import Session from "./widget/Session"

App.start({
  instanceName: "kobel",
  css: style + tokenCss(tokens),
  main() {
    gnoblin.init()
    for (const monitor of App.get_monitors()) {
      Bar(monitor)
      Dock(monitor)
      Toasts(monitor)
      OSD(monitor)
    }
    // singletons on the focused monitor, toggled by name:
    //   astal -i kobel -t launcher | quicksettings | calendar | drawer | session
    Launcher()
    QuickSettings()
    Calendar()
    Drawer()
    Session()
  },
  // `astal -i kobel -t <window>` handled by App's request framework
  requestHandler(request, res) {
    const [cmd, arg] = request.split(" ")
    if (cmd === "toggle") { App.toggle_window(arg); return res("ok") }
    if (cmd === "reload-css") { App.apply_css(style + tokenCss(tokens), true); return res("ok") }
    res("unknown")
  },
})
