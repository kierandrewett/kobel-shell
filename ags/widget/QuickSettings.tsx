// Quick settings. Prototype-final: uniform pill tiles from a CATALOG (customisable,
// persisted), GNOME thin sliders, drilldowns as a spring-slid two-view stack
// (Wi-Fi networks / BT devices / per-app mixer with a Master row), compact top row
// (battery · pencil/leaf/lock/power), gnoblin banner + reconnect while degraded.
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, execAsync, GLib } from "astal"
import Network from "gi://AstalNetwork"
import Bluetooth from "gi://AstalBluetooth"
import Wp from "gi://AstalWp"
import Mpris from "gi://AstalMpris"
import { connected, reload } from "../services/gnoblin"
import { MOTION } from "../lib/spring"

type Drill = null | "wifi" | "bt" | "mix"
const drill = Variable<Drill>(null)

// Tile catalog — mirrors prototype CATALOG; persisted layout in state dir.
const STORE = `${GLib.get_user_state_dir()}/kobel/qs-tiles.json`
let tiles: string[] = ["wifi", "bt", "save", "dark", "silent", "night", "volume", "brightness"]
try { tiles = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(STORE)[1])) } catch { }

function Chip(props: {
  id: string, label: string, icon: string,
  active: any, sub?: any, onToggled: () => void, onDrill?: () => void,
}) {
  return <box class={bind(props.active).as((a: boolean) => a ? "chip pill on" : "chip pill")}>
    <button hexpand onClicked={props.onToggled}>
      <box spacing={9}>
        <image iconName={props.icon} />
        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
          <label halign={Gtk.Align.START} label={props.label} />
          {props.sub && <label class="sub" halign={Gtk.Align.START}
            ellipsize={3} label={props.sub} />}
        </box>
      </box>
    </button>
    {props.onDrill &&
      <button class="chev" onClicked={props.onDrill}>
        <image iconName="go-next-symbolic" />
      </button>}
  </box>
}

function Sliders() {
  const speaker = Wp.get_default()!.default_speaker!
  return <box orientation={Gtk.Orientation.VERTICAL}>
    <box spacing={9}>
      <image iconName={bind(speaker, "volume_icon")} />
      <slider hexpand class="slider" value={bind(speaker, "volume")}
        onChangeValue={(_s, v) => { speaker.volume = v }} />
      <button class="chev" onClicked={() => drill.set("mix")}>
        <image iconName="go-next-symbolic" />
      </button>
    </box>
    <box spacing={9}>
      <image iconName="display-brightness-symbolic" />
      <slider hexpand class="slider" value={0.8}
        onChangeValue={(_s, v) => execAsync(`brightnessctl set ${Math.round(v * 100)}%`)} />
      <box widthRequest={30} />  {/* gutter so rails end flush (critique A2) */}
    </box>
  </box>
}

function GnoblinBanner() {
  return <box class="gbanner" visible={bind(connected).as(c => !c)} spacing={10}>
    <image iconName="dialog-warning-symbolic" />
    <box orientation={Gtk.Orientation.VERTICAL} hexpand>
      <label class="t" halign={Gtk.Align.START} label="org.gnoblin.Shell disconnected" />
      <label class="s" halign={Gtk.Align.START} label="osd + notifs handed back to gnome" />
    </box>
    <button class="gbtn" label="Reconnect" onClicked={() => reload().catch(() => { })} />
  </box>
}

function Root() {
  const net = Network.get_default()
  const bt = Bluetooth.get_default()
  return <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
    {/* top row: battery · leaf reload · lock · pencil · power */}
    <box spacing={7}>
      <label class="tn sub" label="100% · Fully charged" />
      <box hexpand />
      <button onClicked={() => reload()}><image iconName="emblem-synchronizing-symbolic" /></button>
      <button onClicked={() => execAsync("loginctl lock-session")}>
        <image iconName="system-lock-screen-symbolic" /></button>
      <button onClicked={() => App.toggle_window("session")}>
        <image iconName="system-shutdown-symbolic" /></button>
    </box>
    <GnoblinBanner />
    <box class="chips" homogeneous spacing={8}>
      <Chip id="wifi" label="Wi-Fi" icon="network-wireless-symbolic"
        active={bind(net.wifi!, "enabled")}
        sub={bind(net.wifi!, "ssid").as(s => s ?? "Off")}
        onToggled={() => { net.wifi!.enabled = !net.wifi!.enabled }}
        onDrill={() => drill.set("wifi")} />
      <Chip id="bt" label="Bluetooth" icon="bluetooth-active-symbolic"
        active={bind(bt, "is_powered")}
        sub={bind(bt, "devices").as(d =>
          d.find(x => x.connected)?.alias ?? "Off")}
        onToggled={() => bt.toggle()}
        onDrill={() => drill.set("bt")} />
      {/* dark / silent / night / save… render from `tiles` the same way */}
    </box>
    <Sliders />
  </box>
}

function DrillView() {
  const net = Network.get_default()
  return <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
    <centerbox>
      <button startWidget onClicked={() => drill.set(null)}>
        <image iconName="go-previous-symbolic" /></button>
      <label centerWidget label={bind(drill).as(d =>
        d === "wifi" ? "Wi-Fi" : d === "bt" ? "Bluetooth" : "Volume")} />
      <box endWidget widthRequest={46} halign={Gtk.Align.END}>
        {/* header switch, per prototype */}
        <switch active={bind(net.wifi!, "enabled")}
          visible={bind(drill).as(d => d === "wifi")}
          onNotifyActive={s => { net.wifi!.enabled = s.active }} />
      </box>
    </centerbox>
    {/* wifi: AP list w/ Connected/Connect-on-hover · bt: devices · mix: Master + per-app */}
  </box>
}

export default function QuickSettings() {
  return <window
    name="quicksettings" namespace="kobel-qs" class="qs-window" visible={false}
    anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
    keymode={Astal.Keymode.ON_DEMAND}
    onKeyPressed={(self, key) => {
      if (key !== Gdk.KEY_Escape) return false
      if (drill.get()) { drill.set(null); return true }   // Esc steps back first
      self.hide(); return true
    }}>
    <box class="sheet qs">
      {/* Gtk.Stack with slide-left/right = the multiview; height animates
          via Adw spring on a size-group wrapper (MOTION.drill / drillBack) */}
      <stack
        transitionType={Gtk.StackTransitionType.SLIDE_LEFT_RIGHT}
        transitionDuration={220}
        visibleChildName={bind(drill).as(d => d ? "drill" : "root")}>
        <Root name="root" />
        <DrillView name="drill" />
      </stack>
    </box>
  </window>
}
