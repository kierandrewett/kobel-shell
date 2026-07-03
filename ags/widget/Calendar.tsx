// Calendar popover — GNOME replica per the prototype: hero date, ‹ month › nav
// (title click = today), ISO week numbers as quiet dim text, DIMMED WEEKENDS,
// clickable days w/ selection ring (ink ring on today), event-dot markers,
// events card in the notification-card language. Months slide (multiview motion).
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind } from "astal"

interface Ev { t: string; n: string; icon: string }
const now = new Date()
const key = (y: number, m: number, d: number) => `${y}-${m + 1}-${d}`
export const EVENTS: Record<string, Ev[]> = {
  [key(now.getFullYear(), now.getMonth(), now.getDate())]:
    [{ t: "09:45", n: "Daily Standup", icon: "kobel-video-symbolic" }],
  [key(now.getFullYear(), now.getMonth(), 11)]:
    [{ t: "10:30", n: "Kieran Birthday", icon: "kobel-cake-symbolic" },
     { t: "13:00", n: "London Thing", icon: "kobel-pin-symbolic" }],
}

const view = Variable({ y: now.getFullYear(), m: now.getMonth() })
const sel = Variable(new Date(now.getFullYear(), now.getMonth(), now.getDate()))

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dn = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - dn + 3)
  const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((+t - +f) / 864e5 - 3 + ((f.getUTCDay() + 6) % 7)) / 7)
}

function Grid() {
  return <box class="cal-grid" orientation={Gtk.Orientation.VERTICAL}>
    {bind(Variable.derive([view, sel], (v, s) => ({ v, s }))).as(({ v, s }) => {
      const first = new Date(v.y, v.m, 1)
      const start = (first.getDay() + 6) % 7
      const days = new Date(v.y, v.m + 1, 0).getDate()
      const prevDays = new Date(v.y, v.m, 0).getDate()
      const rows = []
      rows.push(<box homogeneous>
        {["", "M", "T", "W", "T", "F", "S", "S"].map(d =>
          <label class="dow" label={d} />)}
      </box>)
      for (let r = 0; r < 6; r++) {
        const cells = [<label class="wk tn"
          label={`${isoWeek(new Date(v.y, v.m, r * 7 - start + 1))}`} />]
        for (let c = 0; c < 7; c++) {
          const i = r * 7 + c, d = i - start + 1
          const out = d < 1 || d > days
          const label = out ? (d < 1 ? prevDays + d : d - days) : d
          const cls = ["day"]
          if (c >= 5) cls.push("we")                       // WEEKENDS DIMMED
          if (out) cls.push("out")
          else {
            const today = new Date()
            if (d === today.getDate() && v.m === today.getMonth() && v.y === today.getFullYear())
              cls.push("today")
            if (EVENTS[key(v.y, v.m, d)]) cls.push("ev")   // event-dot (CSS ::after → underline dot)
            if (s.getDate() === d && s.getMonth() === v.m && s.getFullYear() === v.y)
              cls.push("sel")
          }
          cells.push(out
            ? <label class={cls.join(" ")} label={`${label}`} />
            : <button class={cls.join(" ")} label={`${label}`}
                onClicked={() => sel.set(new Date(v.y, v.m, d))} />)
        }
        rows.push(<box homogeneous>{cells}</box>)
      }
      return rows
    })}
  </box>
}

function EventsCard() {
  return <box class="evcard" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
    {bind(sel).as(d => {
      const evs = EVENTS[key(d.getFullYear(), d.getMonth(), d.getDate())] ?? []
      const head = <label class="evhead" halign={Gtk.Align.START}
        label={d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} />
      if (!evs.length) return [head,
        <box spacing={8}><image iconName="kobel-calendar-symbolic" />
          <label class="sub" label="No events" /></box>]
      return [head, ...evs.map(e =>
        <box class="evrow" spacing={10}>
          <image iconName={e.icon} />
          <box orientation={Gtk.Orientation.VERTICAL}>
            <label halign={Gtk.Align.START} label={e.n} />
            <label class="sub tn" halign={Gtk.Align.START} label={e.t} />
          </box>
        </box>)]
    })}
  </box>
}

export default function Calendar() {
  return <window
    name="calendar" namespace="kobel-calendar" class="calendar-window" visible={false}
    anchor={Astal.WindowAnchor.TOP} keymode={Astal.Keymode.ON_DEMAND}
    onKeyPressed={(self, key) => key === Gdk.KEY_Escape ? (self.hide(), true) : false}>
    <box class="sheet cal" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box orientation={Gtk.Orientation.VERTICAL}>
        <label class="sub" halign={Gtk.Align.START}
          label={new Date().toLocaleDateString("en-GB", { weekday: "long" })} />
        <label class="hero" halign={Gtk.Align.START}
          label={new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} />
      </box>
      <centerbox>
        <button onClicked={() => {
          const v = view.get()
          view.set(v.m ? { y: v.y, m: v.m - 1 } : { y: v.y - 1, m: 11 })
        }}><image iconName="kobel-chevron-left-symbolic" /></button>
        <button class="month" onClicked={() =>
          view.set({ y: now.getFullYear(), m: now.getMonth() })}>
          <label label={bind(view).as(v =>
            new Date(v.y, v.m).toLocaleString("en", { month: "long" })
            + (v.y !== now.getFullYear() ? ` ${v.y}` : ""))} />
        </button>
        <button onClicked={() => {
          const v = view.get()
          view.set(v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })
        }}><image iconName="kobel-chevron-right-symbolic" /></button>
      </centerbox>
      <Grid />
      <EventsCard />
    </box>
  </window>
}
