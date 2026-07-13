// org.gnoblin.Shell — the compositor link. Drives: soft-reload, feature toggles,
// the WINDOW LIST that makes the dock truthful, and the connected/amber state.
// Prototype: services 'gnob' banner + bar amber segment + WM integration.

import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { Variable } from "astal"

const BUS = "org.gnoblin.Shell"
const PATH = "/org/gnoblin/Shell"
const IFACE = "org.gnoblin.Shell"

export interface GnoblinWindow {
    id: string
    appId: string
    title: string
    focused: boolean
    minimized: boolean
}

export const connected = Variable(false)
export const windows = Variable<GnoblinWindow[]>([])

let proxy: Gio.DBusProxy | null = null

function call(method: string, params: GLib.Variant | null = null): Promise<GLib.Variant | null> {
    return new Promise((res, rej) => {
        if (!proxy) return rej(new Error("gnoblin: not connected"))
        proxy.call(method, params, Gio.DBusCallFlags.NONE, 2000, null, (_, r) => {
            try {
                res(proxy!.call_finish(r))
            } catch (e) {
                rej(e)
            }
        })
    })
}

export const reload = () => call("Reload")
export const setFeature = (name: string, on: boolean) =>
    call("SetFeature", new GLib.Variant("(sb)", [name, on]))

// Window verbs (the dock click model)
export const activate = (id: string) => call("ActivateWindow", new GLib.Variant("(s)", [id]))
export const minimize = (id: string) => call("MinimizeWindow", new GLib.Variant("(s)", [id]))

export async function refreshWindows() {
    try {
        const v = await call("ListWindows")
        if (!v) return
        const [list] = v.deep_unpack() as [GnoblinWindow[]]
        windows.set(list)
    } catch {
        /* stay on last-known list; connected flag carries the truth */
    }
}

export function appWindows(appId: string): GnoblinWindow[] {
    return windows.get().filter((w) => w.appId === appId)
}

// Cycle = the dock carousel: focus the next window of the app
export async function cycle(appId: string, dir: 1 | -1) {
    const ws = appWindows(appId)
    if (ws.length < 2) return
    const i = ws.findIndex((w) => w.focused)
    await activate(ws[((i < 0 ? 0 : i) + dir + ws.length) % ws.length].id)
}

export function init() {
    Gio.bus_watch_name(
        Gio.BusType.SESSION,
        BUS,
        Gio.BusNameWatcherFlags.NONE,
        () => {
            // appeared
            Gio.DBusProxy.new_for_bus(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                BUS,
                PATH,
                IFACE,
                null,
                (_, res) => {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res)
                    proxy.connect("g-signal", (_p, _s, sig) => {
                        if (sig === "WindowsChanged") refreshWindows()
                    })
                    connected.set(true)
                    refreshWindows()
                }
            )
        },
        () => {
            // vanished → amber everywhere that listens
            proxy = null
            connected.set(false)
        }
    )
}
