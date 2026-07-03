// The spotlight. Prototype-final behavior:
//   Super release opens (compositor keybind → `astal -i kobel -t launcher`)
//   fuzzy + leaf highlight · global BEST-MATCH slot (score-ranked across providers,
//   type weights apps 1 / actions .95 / files .9) · capped log2 frecency
//   ghost autocomplete = first prefix-completable name in display order
//   Tab always owned (ghost else next; Shift+Tab prev) · Ctrl+N/P · Esc clears first
//   sections: best match / apps / actions / files / web (always-last real row)
//   '=' calculator · ':' gnoblinctl commands · empty state: dock-tile grid + widgets
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, execAsync } from "astal"
import Apps from "gi://AstalApps"
import { fuzzy, hl, boost, bump } from "../lib/fuzzy"

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
    al: ["exit", "sign out", "logout"], run: () => App.toggle_window("session") },
  { n: "Restart", icon: "kobel-reload-symbolic", d: "Reboot the machine",
    al: ["reboot"], run: () => App.toggle_window("session") },
  { n: "Shut Down", icon: "kobel-power-symbolic", d: "Power off",
    al: ["poweroff", "halt"], run: () => App.toggle_window("session") },
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
  const query = Variable("")
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

  return <window
    name="launcher" namespace="kobel-launcher" class="launcher-window"
    keymode={Astal.Keymode.EXCLUSIVE} visible={false}
    onKeyPressed={(self, key, _code, mods) => {
      const flat = results(query.get()).flatMap(s => s.rows)
      if (key === Gdk.KEY_Escape) {
        if (query.get()) { query.set(""); return true }
        self.hide(); return true
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
        flat[selected.get()]?.run(); self.hide(); query.set(""); return true
      }
      return false
    }}>
    <box class="sheet launcher" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <box class="field">
        <image iconName="kobel-magnifying-glass-symbolic" />
        <overlay hexpand>
          <entry
            placeholderText="Search — apps, files, actions · ':' cmds · '=' maths"
            text={bind(query)}
            onNotifyText={e => { query.set(e.text); selected.set(0) }} />
          <label type="overlay" class="ghost" halign={Gtk.Align.START}
            label={bind(ghost).as(g => {
              const q = query.get()
              return g.toLowerCase().startsWith(q.toLowerCase()) && q ? g : ""
            })} />
        </overlay>
        <label class="kbd" label="super" />
      </box>

      {/* empty state: dock-tile grid (shared component, live dots) + widget row */}
      <revealer revealChild={bind(query).as(q => !q.trim())}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
          <box class="tiles" halign={Gtk.Align.CENTER} spacing={6}>
            {apps.list.slice(0, 6).map(a =>
              <button class="tile" onClicked={() => { bump(a.name); a.launch(); App.get_window("launcher")?.hide() }}>
                <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                  <image class="icon-tile" iconName={a.icon_name} pixelSize={32} />
                  <label label={a.name} />
                </box>
              </button>)}
          </box>
          <box spacing={7}>
            <box class="widget" hexpand orientation={Gtk.Orientation.VERTICAL}>
              <label class="tn" halign={Gtk.Align.START}
                label={new Date().toLocaleDateString("en-GB",
                  { weekday: "long", day: "numeric", month: "long" })} />
              <label class="hint" halign={Gtk.Align.START} label="No events today" />
            </box>
            <box class="widget" hexpand>{/* Mpris mini-card: title/artist/play */}</box>
          </box>
        </box>
      </revealer>

      {/* results */}
      <box orientation={Gtk.Orientation.VERTICAL}>
        {sections.as(secs => secs.flatMap(sec => [
          <label class="sec" halign={Gtk.Align.START} label={sec.section} />,
          ...sec.rows.map(r => {
            const flatIdx = secs.flatMap(s => s.rows).indexOf(r)
            return <button
              class={bind(selected).as(s => s === flatIdx ? "row sel" : "row")}
              onClicked={() => { r.run(); App.get_window("launcher")?.hide() }}>
              <box spacing={11}>
                <image iconName={r.icon} pixelSize={24} />
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
    </box>
  </window>
}
