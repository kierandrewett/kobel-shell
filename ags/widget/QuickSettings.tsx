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
        <image iconName="kobel-chevron-right-symbolic" />
      </button>}
  </box>
}

function Sliders() {
  const speaker = Wp.get_default()?.default_speaker ?? null
  if (!speaker) return <box />
  return <box class="sliders" orientation={Gtk.Orientation.VERTICAL} spacing={2}>
    <box class="srow" spacing={10}>
      <image iconName={bind(speaker, "volume_icon").as(i => i ?? "kobel-speaker-wave-symbolic")} />
      <slider hexpand class="slider" value={bind(speaker, "volume")}
        onChangeValue={(_s, v) => { speaker.volume = v }} />
      <button class="chev" onClicked={() => drill.set("mix")}>
        <image iconName="kobel-chevron-right-symbolic" />
      </button>
    </box>
    <box class="srow" spacing={10}>
      <image iconName="kobel-brightness-symbolic" />
      <slider hexpand class="slider" value={0.8}
        onChangeValue={(_s, v) => execAsync(`brightnessctl set ${Math.round(v * 100)}%`)} />
      <box widthRequest={30} />  {/* gutter so rails end flush */}
    </box>
  </box>
}

function GnoblinBanner() {
  return <box class="gbanner" visible={bind(connected).as(c => !c)} spacing={10}>
    <image iconName="kobel-warning-symbolic" />
    <box orientation={Gtk.Orientation.VERTICAL} hexpand>
      <label class="t" halign={Gtk.Align.START} label="org.gnoblin.Shell disconnected" />
      <label class="s" halign={Gtk.Align.START} label="osd + notifs handed back to gnome" />
    </box>
    <button class="gbtn" label="Reconnect" onClicked={() => reload().catch(() => { })} />
  </box>
}

// local-state toggles (no real backend for these in the devkit)
const tSave = Variable(false), tDark = Variable(true), tSilent = Variable(false), tNight = Variable(false)

function ToggleChip(props: { label: string, icon: string, sub: [string, string], v: Variable<boolean> }) {
  return <Chip id={props.label} label={props.label} icon={props.icon}
    active={bind(props.v)}
    sub={bind(props.v).as(on => on ? props.sub[0] : props.sub[1])}
    onToggled={() => props.v.set(!props.v.get())} />
}

function Root() {
  const net = Network.get_default()
  const bt = Bluetooth.get_default()
  return <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
    {/* top row: battery · reload · lock · power */}
    <box class="qs-top" spacing={0}>
      <label class="tn meta" label="100% · Fully charged" />
      <box hexpand />
      <button class="rbtn leaf" onClicked={() => reload()}><image iconName="kobel-leaf-symbolic" /></button>
      <button class="rbtn" onClicked={() => execAsync("loginctl lock-session")}>
        <image iconName="kobel-lock-symbolic" /></button>
      <button class="rbtn" onClicked={() => execAsync("gnome-session-quit --logout --no-prompt")}>
        <image iconName="kobel-logout-symbolic" /></button>
      <button class="rbtn danger" onClicked={() => App.toggle_window("session")}>
        <image iconName="kobel-power-symbolic" /></button>
    </box>
    <GnoblinBanner />
    {/* 2-col pill grid */}
    <box class="chips" homogeneous spacing={8}>
      {net.wifi && <Chip id="wifi" label="Wi-Fi" icon="kobel-wifi-symbolic"
        active={bind(net.wifi, "enabled")}
        sub={bind(net.wifi, "ssid").as(s => s ?? "Off")}
        onToggled={() => { net.wifi!.enabled = !net.wifi!.enabled }}
        onDrill={() => drill.set("wifi")} />}
      <Chip id="bt" label="Bluetooth" icon="kobel-bluetooth-symbolic"
        active={bind(bt, "devices").as(d => d.some(x => x.connected))}
        sub={bind(bt, "devices").as(d =>
          d.find(x => x.connected)?.alias ?? "Off")}
        onToggled={() => bt.toggle()}
        onDrill={() => drill.set("bt")} />
    </box>
    <box class="chips" homogeneous spacing={8}>
      <ToggleChip label="Power Saver" icon="kobel-bolt-symbolic" sub={["On", "Off"]} v={tSave} />
      <ToggleChip label="Dark Style" icon="kobel-moon-symbolic" sub={["kobel-sakura", "Light"]} v={tDark} />
    </box>
    <box class="chips" homogeneous spacing={8}>
      <ToggleChip label="Silent" icon="kobel-bell-slash-symbolic" sub={["Muted", "Off"]} v={tSilent} />
      <ToggleChip label="Night Light" icon="kobel-sun-symbolic" sub={["Until 07:00", "Off"]} v={tNight} />
    </box>
    <Sliders />
  </box>
}

function DrillView() {
  const net = Network.get_default()
  return <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
    <centerbox class="dhead">
      <button onClicked={() => drill.set(null)}>
        <image iconName="kobel-chevron-left-symbolic" /></button>
      <label label={bind(drill).as(d =>
        d === "wifi" ? "Wi-Fi" : d === "bt" ? "Bluetooth" : "Volume")} />
      <box widthRequest={46} halign={Gtk.Align.END}>
        {net.wifi && <switch active={bind(net.wifi, "enabled")}
          visible={bind(drill).as(d => d === "wifi")}
          onNotifyActive={s => { net.wifi!.enabled = s.active }} />}
      </box>
    </centerbox>
    {/* wifi: AP list w/ Connected/Connect-on-hover · bt: devices · mix: Master + per-app */}
  </box>
}

export default function QuickSettings() {
  return <window
    name="quicksettings" namespace="kobel-qs" class="qs-window" visible={false}
    anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
    marginTop={34} marginRight={-6}
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
