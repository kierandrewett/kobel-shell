// OSD — display-only volume pill above the dock. Prototype: pointer-events none,
// auto-hide 1.4s, translucent (blur via gnoblin window-rule).
import { Astal, Gdk, Gtk } from "astal/gtk4"
import { Variable, bind, timeout } from "astal"
import Wp from "gi://AstalWp"

export default function OSD(monitor: Gdk.Monitor) {
    const speaker = Wp.get_default()?.default_speaker ?? null
    const visible = Variable(false)
    let hide: ReturnType<typeof timeout> | null = null
    if (!speaker) return null

    speaker.connect("notify::volume", () => {
        visible.set(true)
        hide?.cancel()
        hide = timeout(1400, () => visible.set(false))
    })

    return (
        <window
            name="osd"
            namespace="kobel-osd"
            gdkmonitor={monitor}
            anchor={Astal.WindowAnchor.BOTTOM}
            marginBottom={70}
            clickThrough
            visible={bind(visible)}
        >
            <box class="osd" spacing={11} widthRequest={230}>
                <image iconName={bind(speaker, "volume_icon")} />
                <levelbar hexpand value={bind(speaker, "volume")} />
                <label
                    class="sval tn"
                    label={bind(speaker, "volume").as((v) => `${Math.round(v * 100)}%`)}
                />
            </box>
        </window>
    )
}
