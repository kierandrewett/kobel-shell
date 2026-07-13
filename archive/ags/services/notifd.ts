// Deferred, non-blocking AstalNotifd access. get_default() can block on a headless or
// contended session bus (it tries to become org.freedesktop.Notifications and waits),
// so we NEVER touch it during widget construction. init() is called once from an idle
// after the shell is mapped; on real hardware it returns fast, in the stripped devkit
// it may no-op. Widgets bind to `unread`/`list` and hydrate when it lands.
import { Variable, timeout } from "astal"
import GLib from "gi://GLib"
// Importing the typelib is cheap + non-blocking; only get_default() may block (it tries
// to become org.freedesktop.Notifications), so we call THAT lazily from an idle. The old
// `imports.gi.AstalNotifd` throws under `gjs -m` (ESM has no legacy `imports` global).
import Notifd from "gi://AstalNotifd"

export const unread = Variable(0)
export const ready = Variable(false)
let n: Notifd.Notifd | null = null

export function notifd() {
    return n
}

export function init() {
    // getenv returns "" (falsy) when the var is set-but-empty, null when unset — both skip
    // correctly only when the value is truthy ("1").
    if (GLib.getenv("KOBEL_SKIP_NOTIFD")) return
    // defer past first paint; if get_default blocks, it blocks only this idle tick,
    // never construction/first render.
    timeout(50, () => {
        try {
            n = Notifd.get_default()
            ready.set(true)
            const sync = () => unread.set(n!.notifications.length)
            n.connect("notified", sync)
            n.connect("resolved", sync)
            sync()
        } catch (e) {
            printerr(`kobel: notifd init skipped: ${e}`)
        }
    })
}
