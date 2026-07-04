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
// KOBEL_DRILL lets the devkit render a drilldown directly (no pointer to click the
// chevron in headless); production default is null.
const drill = Variable<Drill>((GLib.getenv("KOBEL_DRILL") as Drill) || null)

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
    <box class="srow" spacing={9}>
      <image iconName={bind(speaker, "volume_icon").as(i => i ?? "kobel-speaker-wave-symbolic")} />
      <slider hexpand class="slider" value={bind(speaker, "volume")}
        onChangeValue={(_s, v) => { speaker.volume = v }} />
      <button class="chev" onClicked={() => drill.set("mix")}>
        <image iconName="kobel-chevron-right-symbolic" />
      </button>
    </box>
    <box class="srow" spacing={9}>
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
// edit-mode for the tile catalog (pencil button) — hook for tile rearrange/customise.
const editMode = Variable(false)

// Prototype toggle chips are label-only, vertically centered — state is shown by the
// leaf fill, not a sub-line (only Wi-Fi/Bluetooth carry a sub).
function ToggleChip(props: { label: string, icon: string, v: Variable<boolean> }) {
  return <Chip id={props.label} label={props.label} icon={props.icon}
    active={bind(props.v)}
    onToggled={() => props.v.set(!props.v.get())} />
}

function Root({ name }: { name?: string }) {
  const net = Network.get_default()
  const bt = Bluetooth.get_default()
  // spacing 0: exact section gaps come from margins (qtop→chips 1, chip rows 8,
  // chips→sliders 10) — a uniform box spacing can't express all three.
  return <box name={name} orientation={Gtk.Orientation.VERTICAL} spacing={0}>
    {/* top row: battery · reload · lock · power */}
    <box class="qs-top" spacing={0}>
      <label class="tn meta" label="100% · Fully charged" />
      <box hexpand />
      <button class="rbtn leaf" onClicked={() => reload()}><image iconName="kobel-leaf-symbolic" /></button>
      <button class="rbtn" onClicked={() => execAsync("loginctl lock-session")}>
        <image iconName="kobel-lock-symbolic" /></button>
      <button class="rbtn" onClicked={() => editMode.set(!editMode.get())}>
        <image iconName="kobel-pencil-symbolic" /></button>
      <button class="rbtn danger" onClicked={() => App.toggle_window("session")}>
        <image iconName="kobel-power-symbolic" /></button>
    </box>
    <GnoblinBanner />
    {/* one chips grid: 3 rows at 8px, margin-bottom 10 before the sliders */}
    <box class="chip-grid" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
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
        <ToggleChip label="Power Saver" icon="kobel-bolt-symbolic" v={tSave} />
        <ToggleChip label="Dark Style" icon="kobel-moon-symbolic" v={tDark} />
      </box>
      <box class="chips" homogeneous spacing={8}>
        <ToggleChip label="Silent" icon="kobel-bell-slash-symbolic" v={tSilent} />
        <ToggleChip label="Night Light" icon="kobel-sun-symbolic" v={tNight} />
      </box>
    </box>
    <Sliders />
  </box>
}

// Signal-strength glyph for an access point (0–100 → wifi tiers).
function wifiIcon(strength: number): string {
  return "kobel-wifi-symbolic"   // single glyph; strength shown as text meta
}

// Wi-Fi AP list — real AstalNetwork access points, connected one marked .active.
function WifiList() {
  const wifi = Network.get_default().wifi
  if (!wifi) return <box />
  return <box class="dlist" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
    {bind(wifi, "accessPoints").as(aps => {
      const active = wifi.activeAccessPoint
      const seen = new Set<string>()
      return aps
        .filter(ap => ap.ssid && !seen.has(ap.ssid) && seen.add(ap.ssid))
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 6)
        .map(ap => {
          const on = active && ap.ssid === active.ssid
          return <button class={on ? "xrow active" : "xrow"}
            onClicked={() => wifi.activate_connection(ap, null)}>
            <box spacing={10}>
              <image iconName={wifiIcon(ap.strength)} />
              <label hexpand halign={Gtk.Align.START} label={ap.ssid} />
              <label class="xs" label={on ? "Connected" : `${ap.strength}%`} />
            </box>
          </button>
        })
    })}
  </box>
}

// Bluetooth device list — same .xrow grammar as Wi-Fi; connected device is .active.
function BtList() {
  const bt = Bluetooth.get_default()
  return <box class="dlist" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
    {bind(bt, "devices").as(devices => devices
      .filter(d => d.name || d.alias)
      .sort((a, b) => Number(b.connected) - Number(a.connected))
      .slice(0, 6)
      .map(dev => {
        const on = dev.connected
        return <button class={on ? "xrow active" : "xrow"}
          onClicked={() => on ? dev.disconnect_device() : dev.connect_device()}>
          <box spacing={10}>
            <image iconName="kobel-bluetooth-symbolic" />
            <label hexpand halign={Gtk.Align.START} label={dev.alias || dev.name} />
            <label class="xs" label={on ? "Connected" : dev.paired ? "Paired" : "Available"} />
          </box>
        </button>
      }))}
  </box>
}

// One mixer row: 46×46 art tile + name + its own volume slider.
function MixRow(props: { icon: string, title: string, target: any }) {
  return <box class="mrow" spacing={11}>
    <box class="art" valign={Gtk.Align.CENTER}>
      <image iconName={props.icon} pixelSize={22} /></box>
    <box class="mmeta" orientation={Gtk.Orientation.VERTICAL} hexpand valign={Gtk.Align.CENTER}>
      <label halign={Gtk.Align.START} label={props.title} />
      <slider class="slider" value={bind(props.target, "volume")}
        onChangeValue={(_s, v) => { props.target.volume = v }} />
    </box>
  </box>
}

// Per-app volume mixer — Master (default speaker) + each audio stream (AstalWp).
function MixList() {
  const wp = Wp.get_default()
  if (!wp) return <box />
  const speaker = wp.default_speaker
  return <box class="dlist" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
    {speaker && <MixRow icon="kobel-speaker-wave-symbolic" title="Output" target={speaker} />}
    {bind(wp.audio, "streams").as(streams => streams.slice(0, 5).map(s =>
      <MixRow icon="kobel-music-symbolic"
        title={s.description || s.name || "Application"} target={s} />))}
  </box>
}

function DrillView({ name }: { name?: string }) {
  const net = Network.get_default()
  return <box name={name} orientation={Gtk.Orientation.VERTICAL} spacing={8}>
    <centerbox class="dhead">
      <button class="ibtn" onClicked={() => drill.set(null)}>
        <image iconName="kobel-chevron-left-symbolic" /></button>
      <label label={bind(drill).as(d =>
        d === "wifi" ? "Wi-Fi" : d === "bt" ? "Bluetooth" : "Volume")} />
      <box widthRequest={46} halign={Gtk.Align.END}>
        {net.wifi && <switch active={bind(net.wifi, "enabled")}
          visible={bind(drill).as(d => d === "wifi")}
          onNotifyActive={s => { net.wifi!.enabled = s.active }} />}
        <switch active={bind(Bluetooth.get_default(), "powered")}
          visible={bind(drill).as(d => d === "bt")}
          onNotifyActive={s => { Bluetooth.get_default().adapter.powered = s.active }} />
      </box>
    </centerbox>
    {bind(drill).as(d =>
      d === "wifi" ? <WifiList /> : d === "bt" ? <BtList /> :
      d === "mix" ? <MixList /> : <box />)}
  </box>
}

export default function QuickSettings() {
  return <window
    name="quicksettings" namespace="kobel-qs" class="qs-window" visible={false}
    anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
    exclusivity={Astal.Exclusivity.NORMAL}
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
