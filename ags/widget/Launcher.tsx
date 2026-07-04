// The spotlight. Prototype-final behavior:
//   Super release opens (compositor keybind → `astal -i kobel -t launcher`)
//   fuzzy + leaf highlight · global BEST-MATCH slot (score-ranked across providers,
//   type weights apps 1 / actions .95 / files .9) · capped log2 frecency
//   ghost autocomplete = first prefix-completable name in display order
//   Tab always owned (ghost else next; Shift+Tab prev) · Ctrl+N/P · Esc clears first
//   sections: best match / apps / actions / files / web (always-last real row)
//   '=' calculator · ':' gnoblinctl commands · empty state: dock-tile grid + widgets
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, execAsync, GLib } from "astal"
import { makeReveal, register, toggle as surfaceToggle } from "../lib/surface"
import Apps from "gi://AstalApps"
import Mpris from "gi://AstalMpris"
import { fuzzy, hl, boost, bump, frequency } from "../lib/fuzzy"
import { EVENTS } from "./Calendar"
import { DEMO, D } from "../lib/demo"

// Curated grid: the dock's pinned apps first (resolved by desktop-id), then fill the
// remaining slots by frecency. Matches the prototype's launcher empty-state.
const PINNED = ["org.gnome.Ptyxis", "org.gnome.Nautilus", "firefox",
  "dev.zed.Zed", "com.spotify.Client", "org.gnome.Settings"]
// Demo grid: fixed order + labels transcribed from the prototype (D.apps), each mapped
// to the real .desktop id so its themed icon renders (Ptyxis/Nautilus/…).
const DEMO_TILES = [
  { name: "Terminal", id: "org.gnome.Ptyxis" },
  { name: "Files", id: "org.gnome.Nautilus" },
  { name: "Firefox", id: "firefox" },
  { name: "Zed", id: "dev.zed.Zed" },
  { name: "Spotify", id: "com.spotify.Client" },
  { name: "Settings", id: "org.gnome.Settings" },
]

interface Tile { name: string; iconName: string; launch: () => void }
function gridTiles(apps: Apps.Apps): Tile[] {
  const all = apps.get_list()
  const resolve = (id: string): Apps.Application | undefined =>
    all.find(a => a.entry === `${id}.desktop` || a.entry === id)
    ?? all.find(a => a.entry?.toLowerCase().includes(id.toLowerCase().split(".").pop()!))
  const fromApp = (app: Apps.Application): Tile => ({
    name: app.name, iconName: app.icon_name || "application-x-executable",
    launch: () => { bump(app.name); app.launch() },
  })
  if (DEMO) return DEMO_TILES.map(({ name, id }) => {
    const app = resolve(id)
    return { name, iconName: app?.icon_name || id || "application-x-executable",
      launch: () => { bump(name); app?.launch() } }
  })
  const pinned = PINNED.map(resolve).filter(Boolean) as Apps.Application[]
  const rest = all.filter(a => !pinned.includes(a))
    .sort((x, y) => frequency(y.name) - frequency(x.name))
  return [...pinned, ...rest].slice(0, 6).map(fromApp)
}
function todayEventLabel(): string {
  if (DEMO) return D.widgetEvent
  const d = new Date()
  const evs = EVENTS[`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`] ?? []
  return evs.length ? `${evs[0].t} · ${evs[0].n}` : "No events today"
}
function todayDateLabel(): string {
  return DEMO ? D.widgetDate
    : new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
}

interface Row {
  name: string; icon: string; hint: string; score: number
  markup: string; run: () => void
}

const ACTIONS = [
  { n: "Suspend", icon: "kobel-moon-symbolic", d: "Sleep — resume instantly",
    al: ["sleep"], run: () => execAsync("systemctl suspend") },
  { n: "Lock", icon: "kobel-lock-symbolic", d: "Lock the session",
    al: ["lock screen"], run: () => execAsync("loginctl lock-session") },
  { n: "Log Out", icon: "kobel-logout-symbolic", d: "End this session",
    al: ["exit", "sign out", "logout"], run: () => surfaceToggle("session") },
  { n: "Restart", icon: "kobel-reload-symbolic", d: "Reboot the machine",
    al: ["reboot"], run: () => surfaceToggle("session") },
  { n: "Shut Down", icon: "kobel-power-symbolic", d: "Power off",
    al: ["poweroff", "halt"], run: () => surfaceToggle("session") },
  { n: "Soft-reload gnoblin", icon: "kobel-reload-symbolic",
    d: "Reload the shell — windows survive", al: [],
    run: () => execAsync("gnoblinctl reload") },
]

const CMDS = [
  { c: "reload", d: "Soft-reload the shell — windows survive" },
  { c: "osd off", d: "kobel owns volume/brightness popups" },
  { c: "notifs off", d: "Release org.freedesktop.Notifications" },
  { c: "grants", d: "Screen-recording access per app" },
]

export default function Launcher() {
  const apps = new Apps.Apps()
  // KOBEL_QUERY pre-fills the search so the devkit can render the results state.
  const query = Variable(GLib.getenv("KOBEL_QUERY") || "")
  const selected = Variable(0)
  const ghost = Variable("")

  function results(q: string): { section: string, rows: Row[] }[] {
    const qt = q.trim()
    if (!qt) return []
    if (qt.startsWith(":")) {
      const cq = qt.slice(1).trim()
      return [{
        section: "gnoblinctl",
        rows: CMDS.filter(c => c.c.startsWith(cq)).map(c => ({
          name: `:${c.c}`, icon: "kobel-terminal-symbolic", hint: c.d, score: 99,
          markup: `:${c.c}`, run: () => execAsync(`gnoblinctl ${c.c}`),
        })),
      }]
    }
    const out: { section: string, rows: Row[] }[] = []
    // '=' calculator (charset-guarded, same as prototype)
    if (/^=?[0-9+\-*/(). ]+$/.test(qt) && /[0-9]/.test(qt) && /[+\-*/]/.test(qt)) {
      try {
        const v = Function(`"use strict";return(${qt.replace(/^=/, "")})`)()
        if (Number.isFinite(v)) out.push({
          section: "calculator",
          rows: [{ name: String(v), icon: "kobel-calculator-symbolic",
            hint: `${qt.replace(/^=/, "")} =`, score: 98, markup: String(v),
            run: () => execAsync(["wl-copy", String(v)]) }],
        })
      } catch { }
    }
    const appRows: Row[] = apps.fuzzy_query(qt).slice(0, 5).map(a => {
      const m = fuzzy(qt, a.name) ?? { score: 1, marks: null as any }
      return {
        name: a.name, icon: a.icon_name ?? "application-x-executable",
        hint: "Application", score: m.score + boost(a.name),
        markup: hl(a.name, m.marks),
        run: () => { bump(a.name); a.launch() },
      }
    })
    const actRows: Row[] = ACTIONS.map(x => {
      let m = fuzzy(qt, x.n)
      if (!m) for (const al of x.al) { const am = fuzzy(qt, al); if (am) { m = { score: am.score - .5, marks: null as any }; break } }
      return m ? { name: x.n, icon: x.icon, hint: x.d, score: m.score * .95,
        markup: hl(x.n, (m as any).marks), run: x.run } as Row : null
    }).filter(Boolean) as Row[]
    // global best-match slot (critique A1)
    const all = [...appRows, ...actRows].sort((a, b) => b.score - a.score)
    const best = all[0]
    if (best) out.push({ section: "best match", rows: [best] })
    const rest = (rows: Row[]) => rows.filter(r => r !== best)
    if (rest(appRows).length) out.push({ section: "apps", rows: rest(appRows) })
    if (rest(actRows).length) out.push({ section: "actions", rows: rest(actRows).slice(0, 3) })
    out.push({
      section: "web",
      rows: [{ name: `Search the web for “${qt}”`, icon: "kobel-globe-symbolic",
        hint: "", score: 0, markup: `Search the web for “${qt}”`,
        run: () => execAsync(["xdg-open", `https://duckduckgo.com/?q=${encodeURIComponent(qt)}`]) }],
    })
    // ghost = first prefix-completable name in display order (critique A4)
    const g = out.flatMap(s => s.rows).map(r => r.name)
      .find(n => n.toLowerCase().startsWith(qt.toLowerCase()) && n.length > qt.length)
    ghost.set(g ?? "")
    return out
  }

  const sections = bind(query).as(results)

  const { winVisible, revealed: launchRevealed, setRevealer: setLaunchRevealer, close: launchClose, toggle: toggleFn } = makeReveal(220, 150)
  register("launcher", toggleFn)
  return <window
    name="launcher" namespace="kobel-launcher" class="launcher-window"
    anchor={Astal.WindowAnchor.TOP} exclusivity={Astal.Exclusivity.NORMAL}
    keymode={Astal.Keymode.EXCLUSIVE}
    visible={bind(winVisible)}
    onKeyPressed={(_self, key, _code, mods) => {
      const flat = results(query.get()).flatMap(s => s.rows)
      if (key === Gdk.KEY_Escape) {
        if (query.get()) { query.set(""); return true }
        launchClose(); return true
      }
      if (key === Gdk.KEY_Tab) {                       // Tab is ALWAYS owned
        const g = ghost.get(), q = query.get()
        if (g && !(mods & Gdk.ModifierType.SHIFT_MASK)) { query.set(g); return true }
        selected.set((selected.get() + ((mods & Gdk.ModifierType.SHIFT_MASK) ? -1 : 1)
          + flat.length) % Math.max(flat.length, 1))
        return true
      }
      if ((mods & Gdk.ModifierType.CONTROL_MASK) &&
          (key === Gdk.KEY_n || key === Gdk.KEY_p)) {
        selected.set((selected.get() + (key === Gdk.KEY_n ? 1 : -1) + flat.length)
          % Math.max(flat.length, 1))
        return true
      }
      if (key === Gdk.KEY_Down) { selected.set((selected.get() + 1) % Math.max(flat.length, 1)); return true }
      if (key === Gdk.KEY_Up) { selected.set((selected.get() - 1 + flat.length) % Math.max(flat.length, 1)); return true }
      if (key === Gdk.KEY_Return) {
        flat[selected.get()]?.run(); launchClose(); query.set(""); return true
      }
      return false
    }}>
    <revealer
      transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
      transitionDuration={220}
      revealChild={bind(launchRevealed)}
      setup={(r: Gtk.Revealer) => setLaunchRevealer(r)}>
    <box class="sheet launcher" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
      <box class="field" spacing={11}>
        <image iconName="kobel-magnifying-glass-symbolic" />
        <overlay hexpand>
          <entry
            hexpand
            setup={(self: any) => { self.set_max_width_chars(1); self.set_width_chars(1) }}
            text={bind(query)}
            onNotifyText={e => { query.set(e.text); selected.set(0) }} />
          {/* placeholder as an OVERLAY label (not entry placeholderText) so its text
              width can't inflate the entry's natural size → panel stays at min-width */}
          <label type="overlay" class="lplaceholder" halign={Gtk.Align.START}
            valign={Gtk.Align.CENTER} ellipsize={3} hexpand
            visible={bind(query).as(q => !q)}
            label="Search — apps, files, actions · ':' cmds · '=' maths" />
          <label type="overlay" class="ghost" halign={Gtk.Align.START}
            valign={Gtk.Align.CENTER}
            label={bind(ghost).as(g => {
              const q = query.get()
              return g.toLowerCase().startsWith(q.toLowerCase()) && q ? g : ""
            })} />
        </overlay>
        <label class="kbd" label="super" valign={Gtk.Align.CENTER} />
      </box>

      {/* empty state: curated frecency tile grid + widget row */}
      <revealer revealChild={bind(query).as(q => !q.trim())}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={0}>
          <box class="tiles" halign={Gtk.Align.CENTER} spacing={6}>
            {gridTiles(apps).map(t =>
              <button class="tile" onClicked={() => { t.launch(); launchClose() }}>
                <box orientation={Gtk.Orientation.VERTICAL} spacing={8} halign={Gtk.Align.CENTER}>
                  <image class="icon-tile" iconName={t.iconName} pixelSize={30}
                    halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} />
                  <label label={t.name} halign={Gtk.Align.CENTER}
                    ellipsize={3} maxWidthChars={9} />
                </box>
              </button>)}
          </box>
          {/* two cards split the row exactly in half — proto flex:1/flex:1 */}
          <box class="lwidgets" spacing={7} homogeneous>
            {/* left card — date + today's first event */}
            <box class="widget lw" hexpand orientation={Gtk.Orientation.VERTICAL} spacing={2}
              valign={Gtk.Align.CENTER}>
              <label class="tn" halign={Gtk.Align.START} label={todayDateLabel()} />
              <label class="hint" halign={Gtk.Align.START} label={todayEventLabel()} />
            </box>
            {/* right card — media mini-card: art · title/artist · play */}
            {(() => {
              const mpris = Mpris.get_default()
              const activePlayer = bind(mpris, "players").as(ps =>
                ps.find(p => p.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0] ?? null)
              const mediaTitle = DEMO ? D.media.title : bind(mpris, "players").as(ps => {
                const p = ps.find(q => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0]
                return p?.title ?? "Nothing playing"
              })
              const mediaArtist = DEMO ? D.media.artist : bind(mpris, "players").as(ps => {
                const p = ps.find(q => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0]
                return p?.artist ?? ""
              })
              const playIcon = DEMO ? "kobel-play-symbolic" : bind(mpris, "players").as(ps => {
                const p = ps.find(q => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0]
                return p?.playback_status === Mpris.PlaybackStatus.PLAYING
                  ? "kobel-pause-symbolic" : "kobel-play-symbolic"
              })
              return <box class="widget lwm" hexpand spacing={10}>
                <box class="lwart" valign={Gtk.Align.CENTER}>
                  <image iconName="kobel-music-symbolic"
                    halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} />
                </box>
                <box class="lwt" hexpand orientation={Gtk.Orientation.VERTICAL}
                  valign={Gtk.Align.CENTER}>
                  <label class="mtitle" halign={Gtk.Align.START} ellipsize={3} label={mediaTitle} />
                  <label class="hint" halign={Gtk.Align.START} ellipsize={3} label={mediaArtist} />
                </box>
                <button class="mbtn play" valign={Gtk.Align.CENTER}
                  onClicked={() => execAsync("playerctl play-pause")}>
                  <image iconName={playIcon} />
                </button>
              </box>
            })()}
          </box>
        </box>
      </revealer>

      {/* results */}
      <box class="lrows" orientation={Gtk.Orientation.VERTICAL} spacing={2}>
        {sections.as(secs => secs.flatMap(sec => [
          <label class="sec" halign={Gtk.Align.START} label={sec.section} />,
          ...sec.rows.map(r => {
            const flatIdx = secs.flatMap(s => s.rows).indexOf(r)
            return <button
              class={bind(selected).as(s => s === flatIdx ? "row sel" : "row")}
              onClicked={() => { r.run(); launchClose() }}>
              <box spacing={11}>
                {/* 28×28 r8 panel2 frame around the 24px icon (prototype .ri) */}
                <box class="ri" valign={Gtk.Align.CENTER}>
                  <image iconName={r.icon} pixelSize={24} />
                </box>
                <label useMarkup label={r.markup} />
                <label class="hint" hexpand halign={Gtk.Align.START}
                  ellipsize={3} label={r.hint} />
                <label class="runk" label="↵"
                  visible={bind(selected).as(s => s === flatIdx)} />
              </box>
            </button>
          }),
        ]))}
      </box>

      {/* footer hint row — matches prototype .lfoot */}
      <box class="lfoot">
        <box spacing={14} hexpand halign={Gtk.Align.START}>
          <label useMarkup label="<b>:reload</b> soft-reload" />
          <label useMarkup label="<b>:osd</b> toggle" />
          <label useMarkup label="<b>:grants</b> screen access" />
        </box>
        <label label="↑↓ select · ↵ run" halign={Gtk.Align.END} />
      </box>
    </box>
    </revealer>
  </window>
}
