// Notifications. Prototype-final: floating blurred toasts (top-right, the ONE
// sanctioned translucency) + right drawer (media card on top, panel-less cards
// floating on wallpaper, header chip). The unified pipeline: open the drawer while
// a toast is live and it's ADOPTED into the stack; toasts arriving while open
// insert as cards; Silent routes straight to the store.
import { Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, timeout, GLib, execAsync } from "astal"
import Notifd from "gi://AstalNotifd"
import Mpris from "gi://AstalMpris"
import { makeReveal, register } from "../lib/surface"

// Lazy singleton — calling get_default() at module scope blocks the import while
// AstalNotifd tries to acquire org.freedesktop.Notifications (hangs if gnome-shell
// still owns it). Deferring to first use lets the module import cleanly; the bus is
// released by `gnoblinctl disable notifications` before the daemon actually claims it.
let _notifd: Notifd.Notifd | null = null
const nd = () => (_notifd ??= Notifd.get_default())
const skip = () => !!GLib.getenv("KOBEL_SKIP_NOTIFD")
const TOAST_MS = 3800
// Reactive drawer-open state so the toasts can be ADOPTED (hidden) the instant the
// drawer opens, without polling a looked-up window's visibility.
const drawerOpen = Variable(false)

// Notification cards are a defined width (prototype `pw` ≈ QS panel) so the toast
// doesn't stretch to the hexpand text column; the drawer cards fill the same width.
const NCARD_W = 327
function Card({ n }: { n: Notifd.Notification }) {
    return (
        <box class="ncard" spacing={10} widthRequest={NCARD_W}>
            {/* app icon in a 30×30 r9 tile (prototype .nic) */}
            <box class="nic" valign={Gtk.Align.START}>
                <image iconName={n.app_icon || "dialog-information-symbolic"} pixelSize={20} />
            </box>
            <box orientation={Gtk.Orientation.VERTICAL} hexpand>
                <box>
                    <label halign={Gtk.Align.START} hexpand ellipsize={3} label={n.summary} />
                    <label
                        class="when tn"
                        label={new Date(n.time * 1000).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                        })}
                    />
                </box>
                <label
                    class="body"
                    halign={Gtk.Align.START}
                    xalign={0}
                    wrap
                    maxWidthChars={40}
                    label={n.body}
                />
            </box>
            <button class="nx" valign={Gtk.Align.START} onClicked={() => n.dismiss()}>
                <image iconName="kobel-close-symbolic" />
            </button>
        </box>
    )
}

export function Toasts(monitor: Gdk.Monitor) {
    if (skip()) return null
    // Only render notifications younger than TOAST_MS while the drawer is CLOSED —
    // opening the drawer "adopts" them (they simply continue life as drawer cards,
    // which is the FLIP handoff expressed in retained-mode terms).
    const live = Variable<number[]>([])
    // `shown` = what the toast column renders. Recomputed explicitly on every input
    // change (Variable.derive didn't produce a reactive binding here). Empty while the
    // drawer is open (toasts are ADOPTED into the drawer stack).
    const shown = Variable<number[]>([])
    const recompute = () => shown.set(drawerOpen.get() ? [] : live.get())
    live.subscribe(recompute)
    drawerOpen.subscribe(recompute)
    nd().connect("notified", (_n, id) => {
        if (drawerOpen.get() || nd().dont_disturb) return
        live.set([...live.get(), id])
        timeout(TOAST_MS, () => live.set(live.get().filter((x) => x !== id)))
    })
    return (
        <window
            name="toasts"
            namespace="kobel-toasts"
            gdkmonitor={monitor}
            // Hide the whole toast surface while the drawer is open (toasts are ADOPTED into
            // the drawer) — a reactive window-visibility bind, robust regardless of the
            // per-item list reconciliation.
            visible={bind(drawerOpen).as((o) => !o)}
            // Toasts are a floating overlay (like the prototype's absolute top/right); the
            // float inset clears the floating bar (marginTop 10 + height 42) + a small gap,
            // and the right inset matches the bar's edge margin.
            marginTop={58}
            marginRight={12}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
        >
            {/* fixed toast column width so the card can't stretch to its hexpand text column */}
            <box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                widthRequest={NCARD_W + 26}
                halign={Gtk.Align.END}
            >
                {bind(shown).as((ids) =>
                    ids.map((id) => {
                        const n = nd().get_notification(id)
                        return n ? (
                            <box class="toast">
                                <Card n={n} />
                            </box>
                        ) : (
                            <box />
                        )
                    })
                )}
            </box>
        </window>
    )
}

function MediaCard() {
    const mpris = Mpris.get_default()
    if (!mpris) return null

    const pick = (ps: any[]) =>
        ps.find((p) => p.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0] ?? null

    const mediaTitle = bind(mpris, "players").as((ps) => pick(ps)?.title ?? "")
    const mediaArtist = bind(mpris, "players").as((ps) => pick(ps)?.artist ?? "")
    const playIcon = bind(mpris, "players").as((ps) => {
        const p = pick(ps)
        return p?.playback_status === Mpris.PlaybackStatus.PLAYING
            ? "kobel-pause-symbolic"
            : "kobel-play-symbolic"
    })
    const progress = bind(mpris, "players").as((ps) => {
        const p = pick(ps)
        if (!p || !p.length || p.length <= 0) return 0
        return p.position / p.length
    })
    const curTime = bind(mpris, "players").as((ps) => {
        const p = pick(ps)
        if (!p || !p.position) return "0:00"
        const s = Math.floor(p.position)
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
    })
    const totalTime = bind(mpris, "players").as((ps) => {
        const p = pick(ps)
        if (!p || !p.length || p.length <= 0) return "0:00"
        const s = Math.floor(p.length)
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
    })
    const hasPlayer = bind(mpris, "players").as((ps) => ps.length > 0)
    const noPlayer = bind(mpris, "players").as((ps) => ps.length === 0)

    return (
        <box class="ncard media" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
            {/* .mrow — art · title/artist · prev/play/next */}
            <box class="mrow" spacing={11} visible={hasPlayer}>
                <box class="mart" valign={Gtk.Align.CENTER}>
                    <image
                        iconName="kobel-music-symbolic"
                        pixelSize={22}
                        halign={Gtk.Align.CENTER}
                        valign={Gtk.Align.CENTER}
                        hexpand
                        vexpand
                    />
                </box>
                <box
                    class="mmeta"
                    hexpand
                    orientation={Gtk.Orientation.VERTICAL}
                    valign={Gtk.Align.CENTER}
                >
                    <label halign={Gtk.Align.START} ellipsize={3} label={mediaTitle} />
                    <label class="sub" halign={Gtk.Align.START} ellipsize={3} label={mediaArtist} />
                </box>
                <box class="mbtns" valign={Gtk.Align.CENTER} spacing={1}>
                    <button class="mbtn" onClicked={() => execAsync("playerctl previous")}>
                        <image iconName="kobel-skip-back-symbolic" />
                    </button>
                    <button class="mbtn play" onClicked={() => execAsync("playerctl play-pause")}>
                        <image iconName={playIcon} />
                    </button>
                    <button class="mbtn" onClicked={() => execAsync("playerctl next")}>
                        <image iconName="kobel-skip-fwd-symbolic" />
                    </button>
                </box>
            </box>
            {/* .mbar — current time · track slider · total time */}
            <box class="mbar" spacing={8} visible={hasPlayer}>
                <label class="mtime tn" label={curTime} />
                <levelbar class="mtrack" hexpand value={progress} />
                <label class="mtime tn" label={totalTime} />
            </box>
            {/* empty state — disc icon + "Nothing playing" + "Open Music" */}
            <box class="memptyrow" spacing={11} visible={noPlayer}>
                <box class="mart" valign={Gtk.Align.CENTER}>
                    <image
                        iconName="kobel-disc-symbolic"
                        pixelSize={22}
                        halign={Gtk.Align.CENTER}
                        valign={Gtk.Align.CENTER}
                        hexpand
                        vexpand
                    />
                </box>
                <box hexpand orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
                    <label halign={Gtk.Align.START} label="Nothing playing" />
                    <label
                        class="sub"
                        halign={Gtk.Align.START}
                        label="Media controls appear when a player starts"
                        wrap
                    />
                </box>
                <button
                    class="ghostb"
                    valign={Gtk.Align.CENTER}
                    onClicked={() => execAsync("xdg-open https://open.spotify.com")}
                >
                    <label label="Open Music" />
                </button>
            </box>
        </box>
    )
}

export function Drawer() {
    if (skip()) return null
    const nfd = nd()
    const list = Variable<Notifd.Notification[]>(nfd.get_notifications() ?? [])
    const refresh = () => list.set(nfd.get_notifications() ?? [])
    nfd.connect("notified", refresh)
    nfd.connect("resolved", refresh)

    const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(200, 150)
    register("drawer", toggleFn)
    // Keep drawerOpen in sync with the revealed state (toasts adopt into drawer when open)
    revealed.subscribe((r) => drawerOpen.set(r))

    return (
        <window
            name="drawer"
            namespace="kobel-drawer"
            class="drawer-window"
            visible={bind(winVisible)}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT | Astal.WindowAnchor.BOTTOM}
            keymode={Astal.Keymode.ON_DEMAND}
            onKeyPressed={(_self, key) => (key === Gdk.KEY_Escape ? (close(), true) : false)}
        >
            <revealer
                transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
                transitionDuration={200}
                revealChild={bind(revealed)}
                setup={(r: Gtk.Revealer) => setRevealer(r)}
            >
                <box class="drawer" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                    <MediaCard />
                    <box class="nhead" spacing={8}>
                        <label hexpand halign={Gtk.Align.START} label="Notifications" />
                        <label class="tn sub" label={bind(list).as((n) => `${n.length || ""}`)} />
                        <button
                            class="nclear"
                            onClicked={() => nfd.get_notifications().forEach((n) => n.dismiss())}
                        >
                            <box spacing={5}>
                                <image iconName="kobel-trash-symbolic" />
                                <label label="Clear" />
                            </box>
                        </button>
                    </box>
                    <box orientation={Gtk.Orientation.VERTICAL} spacing={8} vexpand>
                        {bind(list).as((ns) =>
                            ns && ns.length
                                ? ns.map((n) => <Card n={n} />)
                                : [
                                      <box class="ncard empty" halign={Gtk.Align.CENTER}>
                                          <label label="All caught up ✓" />
                                      </box>,
                                  ]
                        )}
                    </box>
                </box>
            </revealer>
        </window>
    )
}
