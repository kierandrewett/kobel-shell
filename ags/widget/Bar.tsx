// The bar. Prototype: launcher button · focused title · centered clock (→ calendar)
// · tray · status pill (wifi/vol/battery; amber net-glyph when gnoblin is down)
// · bell+badge (→ drawer) · power (→ session).
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, GLib } from "astal"
import Battery from "gi://AstalBattery"
import Wp from "gi://AstalWp"
import Network from "gi://AstalNetwork"
import Tray from "gi://AstalTray"
import { connected, windows } from "../services/gnoblin"
import { unread } from "../services/notifd"
import { DEMO, D } from "../lib/demo"

const time = Variable(GLib.DateTime.new_now_local()).poll(10_000,
  () => GLib.DateTime.new_now_local())

function FocusedTitle() {
  return <label
    class="title"
    ellipsize={3 /* Pango.EllipsizeMode.END */}
    maxWidthChars={28}
    label={DEMO ? D.title : bind(windows).as(ws => {
      const f = ws.find(w => w.focused)
      if (!f) return "desktop"
      const siblings = ws.filter(w => w.appId === f.appId)
      return siblings.length > 1
        ? `${f.title} — window ${siblings.indexOf(f) + 1}/${siblings.length}`
        : f.title
    })} />
}

function StatusPill() {
  const speaker = Wp.get_default()?.default_speaker ?? null
  const net = Network.get_default()
  const bat = Battery.get_default()
  return <button valign={Gtk.Align.CENTER}
    class={bind(connected).as(c => c ? "status" : "status err")}
    onClicked={() => App.toggle_window("quicksettings")}>
    <box spacing={10}>
      <image class="net-icon" iconName="kobel-wifi-symbolic" />
      <image iconName="kobel-speaker-wave-symbolic" />
      <box class="pct" spacing={6}>
        <image iconName="kobel-battery-symbolic" />
        <label class="tn" label={DEMO ? D.batteryPct : (bat
          ? bind(bat, "percentage").as(p => `${Math.round(p * 100)}%`)
          : "100%")} />
      </box>
    </box>
  </button>
}

function Bell() {
  // Badge hydrates once notifd is available (deferred — get_default() can block on a
  // headless/contended bus; never call it during construction). unread() is a plain
  // Variable an async init fills in.
  return <button class="ibtn bell" valign={Gtk.Align.CENTER}
    onClicked={() => App.toggle_window("drawer")}>
    <overlay>
      <image iconName="kobel-bell-symbolic" />
      <label type="overlay" halign={Gtk.Align.END} valign={Gtk.Align.START}
        class="badge tn" visible={DEMO ? true : bind(unread).as(n => n > 0)}
        label={DEMO ? "1" : bind(unread).as(n => n > 9 ? "9+" : `${n}`)} />
    </overlay>
  </button>
}

export default function Bar(monitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  // Floating bar: layer-shell margins inset it from the edges; the .bar child is the
  // rounded surface. Exclusive so tiled windows respect it (zone = margin + height).
  return <window
    name="bar" namespace="kobel-bar" class="bar-window"
    gdkmonitor={monitor} exclusivity={Astal.Exclusivity.EXCLUSIVE}
    marginTop={10} marginLeft={12} marginRight={12}
    anchor={TOP | LEFT | RIGHT}>
    <centerbox class="bar">
      <box spacing={4}>
        <button class="ibtn" valign={Gtk.Align.CENTER}
          onClicked={() => App.toggle_window("launcher")}>
          <image iconName="kobel-magnifying-glass-symbolic" />
        </button>
        <FocusedTitle />
      </box>
      <button class="bcenter" valign={Gtk.Align.CENTER}
        onClicked={() => App.toggle_window("calendar")}>
        <box spacing={8}>
          <label class="clock tn" valign={Gtk.Align.BASELINE}
            label={DEMO ? D.clock : bind(time).as(t => t.format("%H:%M")!)} />
          <label class="date" valign={Gtk.Align.BASELINE}
            label={DEMO ? D.date : bind(time).as(t => t.format("%a %-d %b")!)} />
        </box>
      </button>
      <box spacing={4}>
        {DEMO
          ? <box spacing={1} marginEnd={3}>
              <button class="ibtn tray-icon" valign={Gtk.Align.CENTER} tooltipText="Discord">
                <image iconName="kobel-chat-symbolic" /></button>
              <button class="ibtn tray-icon" valign={Gtk.Align.CENTER} tooltipText="Steam">
                <image iconName="kobel-game-symbolic" /></button>
              <button class="ibtn tray-icon" valign={Gtk.Align.CENTER} tooltipText="Telegram">
                <image iconName="kobel-paper-plane-symbolic" /></button>
              <label class="tn tray-lang" valign={Gtk.Align.CENTER} label="en" />
            </box>
          : bind(Tray.get_default(), "items").as(items => items.map(item =>
              <menubutton tooltipText={item.tooltip_markup} menuModel={item.menu_model}>
                <image gicon={bind(item, "gicon")} />
              </menubutton>))}
        <StatusPill />
        <Bell />
        <button class="ibtn" valign={Gtk.Align.CENTER}
          onClicked={() => App.toggle_window("session")}>
          <image iconName="kobel-power-symbolic" />
        </button>
      </box>
    </centerbox>
  </window>
}
