// Full-screen transparent click target for popout surfaces.
// It stays mapped to avoid layer-shell remap churn; the backdrop button only targets clicks while a surface is open.
import { Astal } from "astal/gtk4"
import { bind } from "astal"
import { closeOpenSurfaces, dismissVisible } from "../lib/surface"

export default function DismissLayer() {
    return (
        <window
            name="dismiss-layer"
            namespace="kobel-dismiss"
            class="dismiss-window"
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.RIGHT |
                Astal.WindowAnchor.BOTTOM |
                Astal.WindowAnchor.LEFT
            }
            exclusivity={Astal.Exclusivity.IGNORE}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.NONE}
        >
            <button
                class="dismiss-backdrop"
                visible={bind(dismissVisible)}
                sensitive={bind(dismissVisible)}
                canTarget={bind(dismissVisible)}
                hexpand
                vexpand
                onClicked={() => closeOpenSurfaces()}
            />
        </window>
    )
}
