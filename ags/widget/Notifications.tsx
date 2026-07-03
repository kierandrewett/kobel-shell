// Notifications. Prototype-final: floating blurred toasts (top-right, the ONE
// sanctioned translucency) + right drawer (media card on top, panel-less cards
// floating on wallpaper, header chip). The unified pipeline: open the drawer while
// a toast is live and it's ADOPTED into the stack; toasts arriving while open
// insert as cards; Silent routes straight to the store.
import { App, Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, timeout } from "astal"
import Notifd from "gi://AstalNotifd"
import Mpris from "gi://AstalMpris"

const notifd = Notifd.get_default()
const TOAST_MS = 3800

function Card({ n }: { n: Notifd.Notification }) {
  return <box class="ncard" spacing={10}>
    <image iconName={n.app_icon || "dialog-information-symbolic"} pixelSize={24} />
    <box orientation={Gtk.Orientation.VERTICAL} hexpand>
      <box>
        <label halign={Gtk.Align.START} hexpand label={n.summary} />
        <label class="when tn" label={new Date(n.time * 1000)
          .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} />
      </box>
      <label class="body" halign={Gtk.Align.START} wrap maxWidthChars=
        {40} label={n.body} />
    </box>
    <button class="nx" onClicked={() => n.dismiss()}>
      <image iconName="window-close-symbolic" />
    </button>
  </box>
}

export function Toasts(monitor: Gdk.Monitor) {
  // Only render notifications younger than TOAST_MS while the drawer is CLOSED —
  // opening the drawer "adopts" them (they simply continue life as drawer cards,
  // which is the FLIP handoff expressed in retained-mode terms).
  const live = Variable<number[]>([])
  notifd.connect("notified", (_n, id) => {
    if (App.get_window("drawer")?.visible || notifd.dont_disturb) return
    live.set([...live.get(), id])
    timeout(TOAST_MS, () => live.set(live.get().filter(x => x !== id)))
  })
  return <window
    name="toasts" namespace="kobel-toasts" gdkmonitor={monitor}
    anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}>
    <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      {bind(live).as(ids => ids.map(id => {
        const n = notifd.get_notification(id)
        return n ? <box class="toast"><Card n={n} /></box> : <box />
      }))}
    </box>
  </window>
}

function MediaCard() {
  const player = Mpris.get_default().players[0]
  if (!player) return <box />
  return <box class="ncard media" spacing={11}>
    <image pixelSize={46} iconName="emblem-music-symbolic" />
    <box orientation={Gtk.Orientation.VERTICAL} hexpand valign={Gtk.Align.CENTER}>
      <label halign={Gtk.Align.START} ellipsize={3} label={bind(player, "title")} />
      <label class="sub" halign={Gtk.Align.START} label={bind(player, "artist")} />
    </box>
    <button onClicked={() => player.previous()}><image iconName="media-skip-backward-symbolic" /></button>
    <button onClicked={() => player.play_pause()}>
      <image iconName={bind(player, "playback_status").as(s =>
        s === Mpris.PlaybackStatus.PLAYING ? "media-playback-pause-symbolic" : "media-playback-start-symbolic")} />
    </button>
    <button onClicked={() => player.next()}><image iconName="media-skip-forward-symbolic" /></button>
  </box>
}

export function Drawer() {
  return <window
    name="drawer" namespace="kobel-drawer" class="drawer-window" visible={false}
    anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT | Astal.WindowAnchor.BOTTOM}
    keymode={Astal.Keymode.ON_DEMAND}
    onKeyPressed={(self, key) => key === Gdk.KEY_Escape ? (self.hide(), true) : false}>
    <box class="drawer" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <MediaCard />
      <box class="nhead">
        <label hexpand halign={Gtk.Align.START} label="Notifications" />
        <label class="tn sub" label={bind(notifd, "notifications").as(n => `${n.length || ""}`)} />
        <button class="nclear" onClicked={() =>
          notifd.notifications.forEach(n => n.dismiss())}>
          <box spacing={5}><image iconName="user-trash-symbolic" /><label label="Clear" /></box>
        </button>
      </box>
      <scrolledwindow vexpand>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
          {bind(notifd, "notifications").as(ns => ns.length
            ? ns.map(n => <Card n={n} />)
            : [<box class="ncard empty" halign={Gtk.Align.CENTER}>
                <label label="All caught up ✓" />
              </box>])}
        </box>
      </scrolledwindow>
    </box>
  </window>
}
