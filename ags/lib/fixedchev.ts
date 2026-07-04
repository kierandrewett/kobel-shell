// FixedChev — GtkButton subclass that clamps its horizontal natural size to a
// fixed value. Adwaita CSS inflates the chev button to ~44px via image-padding
// bleed; CSS max-width on a Box child doesn't work because GtkBox gives each
// non-expanding child its full natural size regardless of CSS max-width.
// Overriding vfunc_measure here is the reliable solution (same pattern as
// TinySlider): we let GTK compute the content measure, then cap horizontal
// natural to NATURAL_W so the srow allocates the right amount of space to the
// scale and both slider rails end flush.
import GObject from "gi://GObject"
import Gtk from "gi://Gtk"

const NATURAL_W = 31 // px — 8 pad + 15 icon + 8 pad (matching proto chev slot)

export const FixedChev = GObject.registerClass(
    {
        GTypeName: "KobelFixedChev",
    },
    class FixedChev extends Gtk.Button {
        vfunc_measure(
            orientation: Gtk.Orientation,
            for_size: number
        ): [number, number, number, number] {
            const [min, nat, mb, nb] = super.vfunc_measure(orientation, for_size)
            if (orientation === Gtk.Orientation.HORIZONTAL) {
                return [Math.min(min, NATURAL_W), NATURAL_W, mb, nb]
            }
            return [min, nat, mb, nb]
        }
    }
)
