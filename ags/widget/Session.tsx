// Session overlay — dimmed (0.8), 4 buttons, arrow-nav, PRESS-AGAIN confirm on
// Restart/Shut down (auto-revert 4s), resting rose on Shut down.
import { Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, execAsync, timeout } from "astal"
// Pin a deterministic render for the DOM-vs-GTK overlay diff (labels/icons already
// fixed; importing DEMO keeps the surface render consistent under KOBEL_DEMO).
import { DEMO, D } from "../lib/demo"
void DEMO
void D

const ACTIONS = [
    {
        id: "lock",
        label: "Lock",
        icon: "kobel-lock-symbolic",
        confirm: false,
        run: () => execAsync("loginctl lock-session"),
    },
    {
        id: "logout",
        label: "Log out",
        icon: "kobel-logout-symbolic",
        confirm: false,
        run: () => execAsync("gnome-session-quit --logout --no-prompt"),
    },
    {
        id: "restart",
        label: "Restart",
        icon: "kobel-reload-symbolic",
        confirm: true,
        run: () => execAsync("systemctl reboot"),
    },
    {
        id: "shutdown",
        label: "Shut down",
        icon: "kobel-power-symbolic",
        confirm: true,
        red: true,
        run: () => execAsync("systemctl poweroff"),
    },
]

export default function Session() {
    const armed = Variable<string | null>(null)
    let revert: ReturnType<typeof timeout> | null = null

    const press = (a: (typeof ACTIONS)[number], hide: () => void) => {
        if (a.confirm && armed.get() !== a.id) {
            armed.set(a.id)
            revert?.cancel()
            revert = timeout(4000, () => armed.set(null)) // auto-revert (critique)
            return
        }
        armed.set(null)
        hide()
        a.run()
    }

    return (
        <window
            name="session"
            namespace="kobel-session"
            class="session-window"
            visible={false}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            keymode={Astal.Keymode.EXCLUSIVE}
            exclusivity={Astal.Exclusivity.IGNORE}
            onKeyPressed={(self, key) => {
                if (key === Gdk.KEY_Escape) {
                    armed.set(null)
                    self.hide()
                    return true
                }
                return false
            }}
        >
            {/* .session fills the whole window (the dim); buttons centered inside */}
            <box class="session" hexpand vexpand>
                <box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} spacing={20} hexpand>
                    {ACTIONS.map((a) => (
                        <button
                            class={a.red ? "sbtn red" : "sbtn"}
                            onClicked={(self) => press(a, () => self.get_root()?.hide?.())}
                        >
                            <box
                                orientation={Gtk.Orientation.VERTICAL}
                                spacing={10}
                                class={bind(armed).as((x) => (x === a.id ? "confirm" : ""))}
                            >
                                <box
                                    class="sic"
                                    hexpand={false}
                                    vexpand={false}
                                    halign={Gtk.Align.CENTER}
                                    valign={Gtk.Align.CENTER}
                                >
                                    {/* horizontal GtkBox ignores a child's main-axis halign, so the icon
                    left-packs; hexpand makes the image fill the 59px tile → GtkImage
                    centres the glyph. hexpand={false} on .sic blocks propagation so the
                    tile stays 59 wide instead of stretching the row. */}
                                    <image
                                        iconName={a.icon}
                                        pixelSize={22}
                                        hexpand
                                        halign={Gtk.Align.CENTER}
                                        valign={Gtk.Align.CENTER}
                                    />
                                </box>
                                <label
                                    label={bind(armed).as((x) =>
                                        x === a.id ? "Press again" : a.label
                                    )}
                                />
                            </box>
                        </button>
                    ))}
                </box>
            </box>
        </window>
    )
}
