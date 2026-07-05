// Calendar popover — GNOME replica per the prototype: hero date, ‹ month › nav
// (title click = today), ISO week numbers as quiet dim text, DIMMED WEEKENDS,
// clickable days w/ selection ring (ink ring on today), event-dot markers,
// events card in the notification-card language. Months slide (multiview motion).
import { Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, GLib } from "astal"
import { DEMO, D } from "../lib/demo"
import { makeReveal, register } from "../lib/surface"

interface Ev {
    t: string
    n: string
    icon: string
}
// "today" — under KOBEL_DEMO, pinned to D.today; real clock otherwise.
// todayVar polls every 60s so the hero date updates without a reload.
const todayVar = DEMO
    ? Variable(new Date(D.today.y, D.today.m, D.today.d))
    : Variable(new Date()).poll(60_000, () => new Date())
const now = todayVar.get()
const key = (y: number, m: number, d: number) => `${y}-${m + 1}-${d}`
export const EVENTS: Record<string, Ev[]> = {
    [key(now.getFullYear(), now.getMonth(), now.getDate())]: [
        { t: "09:45", n: "Daily Standup", icon: "kobel-video-symbolic" },
    ],
    [key(now.getFullYear(), now.getMonth(), 11)]: [
        { t: "10:30", n: "Kieran Birthday", icon: "kobel-cake-symbolic" },
        { t: "13:00", n: "London Thing", icon: "kobel-pin-symbolic" },
    ],
    [key(now.getFullYear(), now.getMonth(), 13)]: [
        { t: "All day", n: "My Birthday", icon: "kobel-cake-symbolic" },
    ],
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
    return (
        <box class="cal-grid" orientation={Gtk.Orientation.VERTICAL} spacing={2}>
            {bind(Variable.derive([view, sel], (v, s) => ({ v, s }))).as(({ v, s }) => {
                const first = new Date(v.y, v.m, 1)
                const start = (first.getDay() + 6) % 7
                const days = new Date(v.y, v.m + 1, 0).getDate()
                const prevDays = new Date(v.y, v.m, 0).getDate()
                const rows = []
                rows.push(
                    <box>
                        <label widthRequest={22} label="" />
                        <box homogeneous hexpand>
                            {["M", "T", "W", "T", "F", "S", "S"].map((d) => (
                                <label class="dow" label={d} />
                            ))}
                        </box>
                    </box>
                )
                for (let r = 0; r < 6; r++) {
                    const wkLabel = (
                        <label
                            class="wk tn"
                            widthRequest={22}
                            halign={Gtk.Align.CENTER}
                            label={`${isoWeek(new Date(v.y, v.m, r * 7 - start + 1))}`}
                        />
                    )
                    const dayCells = []
                    for (let c = 0; c < 7; c++) {
                        const i = r * 7 + c,
                            d = i - start + 1
                        const out = d < 1 || d > days
                        const label = out ? (d < 1 ? prevDays + d : d - days) : d
                        const cls = ["day"]
                        if (c >= 5) cls.push("we") // WEEKENDS DIMMED
                        if (out) cls.push("out")
                        else {
                            const today = now
                            if (
                                d === today.getDate() &&
                                v.m === today.getMonth() &&
                                v.y === today.getFullYear()
                            )
                                cls.push("today")
                            if (EVENTS[key(v.y, v.m, d)]) cls.push("ev") // event-dot (CSS ::after → underline dot)
                            if (
                                s.getDate() === d &&
                                s.getMonth() === v.m &&
                                s.getFullYear() === v.y
                            )
                                cls.push("sel")
                        }
                        const hasEv = !out && !!EVENTS[key(v.y, v.m, d)]
                        // day sits at its natural 24×24 centred in the grid column
                        dayCells.push(
                            out ? (
                                <label
                                    class={cls.join(" ")}
                                    halign={Gtk.Align.CENTER}
                                    label={`${label}`}
                                />
                            ) : (
                                <button
                                    class={cls.join(" ")}
                                    halign={Gtk.Align.CENTER}
                                    valign={Gtk.Align.CENTER}
                                    onClicked={() => sel.set(new Date(v.y, v.m, d))}
                                >
                                    {hasEv ? (
                                        <overlay>
                                            <label label={`${label}`} />
                                            {/* 3px event dot, absolute bottom-center (GTK has no ::after) */}
                                            <box
                                                type="overlay"
                                                class="evdot"
                                                halign={Gtk.Align.CENTER}
                                                valign={Gtk.Align.END}
                                            />
                                        </overlay>
                                    ) : (
                                        <label label={`${label}`} />
                                    )}
                                </button>
                            )
                        )
                    }
                    // wk col fixed 28px, day cells share remaining space equally (homogeneous)
                    rows.push(
                        <box>
                            {wkLabel}
                            <box homogeneous hexpand>
                                {dayCells}
                            </box>
                        </box>
                    )
                }
                return rows
            })}
        </box>
    )
}

function EventsCard() {
    // Prototype .calev: a panel2 card (pad10/r12) wrapping the date header + darker
    // (--panel) event rows; header's own bottom padding is the header→row gap (spacing 0).
    return (
        <box class="evcard" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
            {bind(sel).as((d) => {
                const evs = EVENTS[key(d.getFullYear(), d.getMonth(), d.getDate())] ?? []
                const head = (
                    <label
                        class="evhead"
                        halign={Gtk.Align.START}
                        label={d.toLocaleDateString("en-GB", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                        })}
                    />
                )
                if (!evs.length)
                    return [
                        head,
                        <box class="evempty" spacing={8}>
                            <image iconName="kobel-calendar-symbolic" />
                            <label label="No events" />
                        </box>,
                    ]
                return [
                    head,
                    ...evs.map((e) => (
                        <box class="evrow" spacing={10}>
                            {/* 26×26 r8 colored icon tile (prototype .evic), white glyph */}
                            <box class="evic" valign={Gtk.Align.CENTER}>
                                <image iconName={e.icon} />
                            </box>
                            <box
                                orientation={Gtk.Orientation.VERTICAL}
                                valign={Gtk.Align.CENTER}
                                hexpand
                            >
                                <label halign={Gtk.Align.START} ellipsize={3} label={e.n} />
                                <label class="sub tn" halign={Gtk.Align.START} label={e.t} />
                            </box>
                        </box>
                    )),
                ]
            })}
        </box>
    )
}

export default function Calendar() {
    const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(220, 150)
    register("calendar", toggleFn)
    return (
        <window
            name="calendar"
            namespace="kobel-calendar"
            class="calendar-window"
            visible={bind(winVisible)}
            anchor={Astal.WindowAnchor.TOP}
            exclusivity={Astal.Exclusivity.NORMAL}
            keymode={Astal.Keymode.ON_DEMAND}
            onKeyPressed={(_self, key) => (key === Gdk.KEY_Escape ? (close(), true) : false)}
        >
            <revealer
                transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
                transitionDuration={220}
                revealChild={bind(revealed)}
                setup={(r: Gtk.Revealer) => setRevealer(r)}
            >
                <box class="sheet cal" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
                    <box class="calhero" orientation={Gtk.Orientation.VERTICAL}>
                        <label
                            class="sub"
                            halign={Gtk.Align.START}
                            label={bind(todayVar).as((d) =>
                                d.toLocaleDateString("en-GB", { weekday: "long" })
                            )}
                        />
                        <label
                            class="hero"
                            halign={Gtk.Align.START}
                            label={bind(todayVar).as((d) =>
                                d.toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric",
                                })
                            )}
                        />
                    </box>
                    <centerbox>
                        <button
                            onClicked={() => {
                                const v = view.get()
                                view.set(v.m ? { y: v.y, m: v.m - 1 } : { y: v.y - 1, m: 11 })
                            }}
                        >
                            <image iconName="kobel-chevron-left-symbolic" />
                        </button>
                        <button
                            class="month"
                            onClicked={() => view.set({ y: now.getFullYear(), m: now.getMonth() })}
                        >
                            <label
                                label={bind(view).as(
                                    (v) =>
                                        new Date(v.y, v.m).toLocaleString("en", { month: "long" }) +
                                        (v.y !== now.getFullYear() ? ` ${v.y}` : "")
                                )}
                            />
                        </button>
                        <button
                            onClicked={() => {
                                const v = view.get()
                                view.set(v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })
                            }}
                        >
                            <image iconName="kobel-chevron-right-symbolic" />
                        </button>
                    </centerbox>
                    <Grid />
                    <EventsCard />
                </box>
            </revealer>
        </window>
    )
}
