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
import Gio from "gi://Gio"
import Mpris from "gi://AstalMpris"
import { MOTION, spring, springTo } from "../lib/spring"
import * as gnoblin from "../services/gnoblin"
import { DEMO } from "../lib/demo"

const PINNED = [
    "org.gnome.Ptyxis",
    "org.gnome.Nautilus",
    "firefox",
    "dev.zed.Zed",
    "com.spotify.Client",
    "org.gnome.Settings",
]

function Dots({ appId }: { appId: string }) {
    // Sliding viewport identical to the prototype: ≤4 dots, focused pill,
    // minis when windows exist beyond the visible slice.
    return (
        <box class="dots" halign={Gtk.Align.CENTER} valign={Gtk.Align.END} spacing={3}>
            {bind(gnoblin.windows).as(() => {
                const ws = gnoblin.appWindows(appId)
                const total = ws.length
                const n = Math.min(total, 4)
                const cur = ws.findIndex((w) => w.focused)
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
    )
}

function buildContextMenu(app: Apps.Application, appId: string): Gtk.Popover {
    const vbox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 })
    const ws = gnoblin.appWindows(appId)

    // window rows (click to focus/restore)
    for (const w of ws) {
        const row = new Gtk.Button({ cssClasses: ["cmi"] })
        const hbox = new Gtk.Box({ spacing: 9 })
        const img = new Gtk.Image({ iconName: "kobel-window-symbolic" })
        img.cssClasses = []
        const lbl = new Gtk.Label({
            label: w.title || app.name,
            halign: Gtk.Align.START,
            ellipsize: 3 as any,
            xalign: 0,
            hexpand: true,
        })
        hbox.append(img)
        hbox.append(lbl)
        row.set_child(hbox)
        row.connect("clicked", () => {
            gnoblin.activate(w.id)
            vbox.get_root()?.hide()
        })
        vbox.append(row)
    }

    if (ws.length > 0) {
        const sep = new Gtk.Separator({
            orientation: Gtk.Orientation.HORIZONTAL,
            cssClasses: ["csep"],
        })
        vbox.append(sep)
    }

    // quit row
    const quit = new Gtk.Button({ cssClasses: ["cmi", "danger"] })
    const qbox = new Gtk.Box({ spacing: 9 })
    const qimg = new Gtk.Image({ iconName: "kobel-x-symbolic" })
    qimg.cssClasses = []
    const qlbl = new Gtk.Label({ label: "Quit", halign: Gtk.Align.START, xalign: 0, hexpand: true })
    qbox.append(qimg)
    qbox.append(qlbl)
    quit.set_child(qbox)
    quit.connect("clicked", () => {
        execAsync(`pkill -f "${appId}"`)
        vbox.get_root()?.hide()
    })
    vbox.append(quit)

    const popover = new Gtk.Popover({ cssClasses: ["cmenu"], child: vbox, hasArrow: false })
    popover.set_position(Gtk.PositionType.TOP)
    return popover
}

function DockButton({ app }: { app: Apps.Application }) {
    const appId = app.entry.replace(/\.desktop$/, "")
    let popover: Gtk.Popover | null = null

    const onClick = () => {
        const ws = gnoblin.appWindows(appId)
        if (!ws.length) return void app.launch() // + ghost zoom (revealer scale anim)
        const focused = ws.find((w) => w.focused)
        if (!focused)
            return void gnoblin.activate(
                ws.slice().sort((a, b) => Number(b.focused) - Number(a.focused))[0].id
            )
        if (ws.length > 1) return void gnoblin.cycle(appId, 1)
        gnoblin.minimize(focused.id)
    }

    return (
        <button
            class="dbtn"
            tooltipText={app.name}
            onClicked={onClick}
            setup={(self) => {
                // Attach a Popover for right-click context menu
                popover = buildContextMenu(app, appId)
                popover.set_parent(self)
            }}
            onButtonPressed={(_w, e) => {
                if (e.get_button() === Gdk.BUTTON_MIDDLE) app.launch()
                if (e.get_button() === Gdk.BUTTON_SECONDARY) {
                    // Rebuild to get fresh window list then show
                    if (popover) {
                        popover.unparent()
                        popover.run_dispose()
                    }
                    popover = buildContextMenu(app, appId)
                    popover.set_parent(_w)
                    popover.popup()
                }
            }}
            onScroll={(_w, _dx, dy) => {
                const ws = gnoblin.appWindows(appId)
                if (!ws.length) return
                if (ws.length > 1) gnoblin.cycle(appId, dy > 0 ? 1 : -1)
                else if (!ws[0].focused) gnoblin.activate(ws[0].id)
            }}
        >
            <overlay>
                <image
                    class="icon-tile"
                    iconName={app.icon_name || "kobel-app-symbolic"}
                    pixelSize={31}
                />
                {/* dots as OVERLAY — zero layout footprint */}
                <Dots type="overlay" appId={appId} />
            </overlay>
        </button>
    )
}

function MediaWidget() {
    const mpris = Mpris.get_default()
    const progress = DEMO
        ? 161 / 480
        : bind(mpris, "players").as((ps) => {
              const p = ps.find((q) => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0]
              if (!p || !p.length || p.length <= 0) return 0
              return p.position / p.length
          })
    const icon = DEMO
        ? "kobel-music-symbolic"
        : bind(mpris, "players").as((ps) => {
              const p = ps.find((q) => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0]
              if (!p) return "kobel-music-symbolic"
              return p.playback_status === Mpris.PlaybackStatus.PLAYING
                  ? "kobel-pause-symbolic"
                  : "kobel-play-symbolic"
          })
    return (
        <button class="dbtn dwidget" onClicked={() => execAsync("playerctl play-pause")}>
            <overlay>
                <box class="dtile">
                    <image
                        class="dg"
                        iconName={icon}
                        pixelSize={18}
                        halign={Gtk.Align.CENTER}
                        valign={Gtk.Align.CENTER}
                        hexpand
                        vexpand
                    />
                </box>
                <levelbar
                    type="overlay"
                    class="mprog"
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.END}
                    value={progress}
                />
            </overlay>
        </button>
    )
}

// ---------------------------------------------------------------------------
// DEMO mode: render the prototype's EXACT dock (docs/prototype.html) with real GTK
// widgets, so it can be pixel-overlaid on the prototype render 1:1. Icons load from the
// SAME on-disk files the prototype references (via a FileIcon gicon) rather than by
// themed name — a themed lookup snaps to a different size variant (e.g. the 32px firefox
// instead of the prototype's 256px png) and downscales differently. Same source file →
// closest cross-engine match. (pixel-size is honoured now the icon-tile min is 30.)
const DEMO_APPS = [
    {
        name: "Terminal",
        icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Ptyxis.svg",
        dots: ["on", "dot"],
    },
    {
        name: "Files",
        icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Nautilus.svg",
        dots: ["dot"],
    },
    { name: "Firefox", icon: "/usr/share/icons/hicolor/256x256/apps/firefox.png", dots: [] },
    {
        name: "Zed",
        icon: "/home/kieran/.local/zed.app/share/icons/hicolor/512x512/apps/zed.png",
        dots: [],
    },
    {
        name: "Spotify",
        icon: "/var/lib/flatpak/exports/share/icons/hicolor/scalable/apps/com.spotify.Client.svg",
        dots: [],
    },
    {
        name: "Settings",
        icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Settings.svg",
        dots: [],
    },
]

function fileIcon(path: string): Gio.Icon {
    return Gio.FileIcon.new(Gio.File.new_for_path(path))
}

function DemoButton({ app }: { app: (typeof DEMO_APPS)[number] }) {
    // NB: the dots box carries `type="overlay"` DIRECTLY (intrinsic element) — a function
    // component would swallow the prop, letting the untyped box replace the icon as the
    // overlay's main child (GtkOverlay.set_child). Icon stays main; dots overlay on top.
    return (
        <button class="dbtn" tooltipText={app.name}>
            <overlay>
                <image
                    class="icon-tile"
                    gicon={fileIcon(app.icon)}
                    pixelSize={31}
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.CENTER}
                />
                <box
                    type="overlay"
                    class="dots"
                    halign={Gtk.Align.CENTER}
                    valign={Gtk.Align.END}
                    spacing={3}
                >
                    {app.dots.map((cls) => (
                        <box class={cls === "on" ? "dot on" : "dot"} />
                    ))}
                </box>
            </overlay>
        </button>
    )
}

function DemoDock(monitor: Gdk.Monitor) {
    return (
        <window
            name="dock"
            namespace="kobel-dock"
            class="dock-window dock-demo"
            gdkmonitor={monitor}
            anchor={Astal.WindowAnchor.BOTTOM}
        >
            <box class="dock" spacing={4}>
                <DemoButton app={DEMO_APPS[0]} />
                <DemoButton app={DEMO_APPS[1]} />
                <DemoButton app={DEMO_APPS[2]} />
                <DemoButton app={DEMO_APPS[3]} />
                <box class="sep" valign={Gtk.Align.CENTER} />
                <DemoButton app={DEMO_APPS[4]} />
                <DemoButton app={DEMO_APPS[5]} />
                <box class="sep" valign={Gtk.Align.CENTER} />
                <MediaWidget />
            </box>
        </window>
    )
}

export default function Dock(monitor: Gdk.Monitor) {
    if (DEMO) return DemoDock(monitor)

    const apps = new Apps.Apps()
    // Pinned entries resolved by desktop-id; the dock never sits empty, so fill any
    // unresolved slots (e.g. an app not installed in the devkit) from the installed
    // list. On real hardware the pins resolve and the fill is unused.
    const all = apps.get_list()
    const resolve = (id: string): Apps.Application | undefined =>
        all.find((a) => a.entry === `${id}.desktop` || a.entry === id) ??
        all.find((a) => a.entry?.toLowerCase().includes(id.toLowerCase().split(".").pop()!))
    // Always render one slot per pin so the dock keeps its shape; resolved pins get the
    // real app + behavior, unresolved ones a labelled placeholder tile. A separator sits
    // between the fourth and fifth pins (prototype parity), then before the media widget.
    const slots = PINNED.map((id) => ({ id, app: resolve(id) }))
    return (
        <window
            name="dock"
            namespace="kobel-dock"
            class="dock-window"
            gdkmonitor={monitor}
            anchor={Astal.WindowAnchor.BOTTOM}
        >
            <box class="dock" spacing={4}>
                {slots.flatMap(({ id, app }, i) => {
                    const sep = i === 4 ? [<box class="sep" valign={Gtk.Align.CENTER} />] : []
                    const btn = app ? (
                        <DockButton app={app} />
                    ) : (
                        <button class="dbtn placeholder" tooltipText={id.split(".").pop()}>
                            <image class="icon-tile" iconName="kobel-app-symbolic" pixelSize={31} />
                        </button>
                    )
                    return [...sep, btn]
                })}
                <box class="sep" valign={Gtk.Align.CENTER} />
                <MediaWidget />
            </box>
        </window>
    )
}
