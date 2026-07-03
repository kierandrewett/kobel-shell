// The dock. Behavior model (prototype-final):
//   click  — no windows: launch (ghost zoom) · unfocused: focus top window (pulse)
//            focused + multi: cycle · focused + single: minimize
//   scroll — single: focus · multi: cycle (carousel nudge, standard direction)
//   middle-click — new window · right-click — context menu (windows list + Quit)
// DOTS: absolute overlay (Gtk.Overlay), sliding 4-dot viewport, edge minis past 4,
// dying-dot close animation. Icons own ALL geometry.
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { bind, Variable, execAsync } from "astal"
import Apps from "gi://AstalApps"
import { MOTION, spring, springTo } from "../lib/spring"
import * as gnoblin from "../services/gnoblin"

const PINNED = [
  "org.gnome.Ptyxis", "org.gnome.Nautilus", "firefox",
  "dev.zed.Zed", "com.spotify.Client", "org.gnome.Settings",
]

function Dots({ appId }: { appId: string }) {
  // Sliding viewport identical to the prototype: ≤4 dots, focused pill,
  // minis when windows exist beyond the visible slice.
  return <box class="dots" halign={Gtk.Align.CENTER} valign={Gtk.Align.END} spacing={3}>
    {bind(gnoblin.windows).as(() => {
      const ws = gnoblin.appWindows(appId)
      const total = ws.length
      const n = Math.min(total, 4)
      const cur = ws.findIndex(w => w.focused)
      let start = 0
      if (total > 4) start = Math.min(Math.max((cur < 0 ? 0 : cur) - 1, 0), total - 4)
      return Array.from({ length: n }, (_, i) => {
        const idx = start + i
        const cls = ["dot"]
        if (cur >= 0 && idx === cur) cls.push("on")
        if (total > 4 && ((i === 0 && start > 0) || (i === n - 1 && start + 4 < total)))
          cls.push("mini")
        return <box class={cls.join(" ")} />
      })
    })}
  </box>
}

function DockButton({ app }: { app: Apps.Application }) {
  const appId = app.entry.replace(/\.desktop$/, "")

  const onClick = () => {
    const ws = gnoblin.appWindows(appId)
    if (!ws.length) return void app.launch()          // + ghost zoom (revealer scale anim)
    const focused = ws.find(w => w.focused)
    if (!focused) return void gnoblin.activate(
      ws.slice().sort((a, b) => Number(b.focused) - Number(a.focused))[0].id)
    if (ws.length > 1) return void gnoblin.cycle(appId, 1)
    gnoblin.minimize(focused.id)
  }

  return <button
    class="dbtn" tooltipText={app.name}
    onClicked={onClick}
    onButtonPressed={(_w, e) => {           // middle-click → new window
      if (e.get_button() === Gdk.BUTTON_MIDDLE) app.launch()
    }}
    onScroll={(_w, _dx, dy) => {
      const ws = gnoblin.appWindows(appId)
      if (!ws.length) return
      if (ws.length > 1) gnoblin.cycle(appId, dy > 0 ? 1 : -1)
      else if (!ws[0].focused) gnoblin.activate(ws[0].id)
    }}>
    <overlay>
      <image class="icon-tile" gicon={app.icon_name ? undefined : undefined}
             iconName={app.icon_name} pixelSize={32} />
      {/* dots as OVERLAY — zero layout footprint */}
      <Dots type="overlay" appId={appId} />
    </overlay>
  </button>
}

function MediaWidget() {
  // dock widget proof-of-concept: album glyph + live progress, click = play/pause
  return <button class="dbtn dwidget" onClicked={() => execAsync("playerctl play-pause")}>
    <overlay>
      <image class="icon-tile" iconName="emblem-music-symbolic" pixelSize={20} />
      <levelbar type="overlay" class="mprog" valign={Gtk.Align.END} value={0.34} />
    </overlay>
  </button>
}

export default function Dock(monitor: Gdk.Monitor) {
  const apps = new Apps.Apps()
  // Resolve pinned entries by desktop-id (entry), not fuzzy name match. Fall back to
  // the first fuzzy hit, then to a synthetic entry so the tile still shows in the
  // devkit where the .desktop may be absent.
  const resolve = (id: string): Apps.Application | null => {
    const all = apps.get_list()
    return all.find(a => a.entry === `${id}.desktop` || a.entry === id)
      ?? all.find(a => a.entry?.toLowerCase().includes(id.toLowerCase().split(".").pop()!))
      ?? apps.fuzzy_query(id.split(".").pop()!)[0]
      ?? null
  }
  const found = PINNED.map(resolve)
  return <window
    name="dock" namespace="kobel-dock" class="dock-window"
    gdkmonitor={monitor} anchor={Astal.WindowAnchor.BOTTOM}>
    <box class="dock" spacing={4}>
      {found.map((app, i) =>
        app ? <DockButton app={app} />
            : <button class="dbtn" tooltipText={PINNED[i]}>
                <image class="icon-tile" iconName="application-x-executable" pixelSize={32} />
              </button>)}
      <box class="sep" />
      <MediaWidget />
    </box>
  </window>
}
