// TinySlider — Gtk.Scale subclass that reports near-zero natural width so it
// never forces its parent container wider than the chip-grid's natural width.
// We extend Gtk.Scale directly (not Astal.Slider) because Astal.Slider's Vala
// C vfuncs can intercept the measure chain before the GJS override is reached.
import GObject from "gi://GObject"
import Gtk from "gi://Gtk"

export const TinySlider = GObject.registerClass(
    {
        GTypeName: "KobelTinyScale",
    },
    class TinySlider extends Gtk.Scale {
        constructor(params?: Partial<Gtk.Scale.ConstructorProps & { value?: number }>) {
            const { value, ...rest } = (params ?? {}) as any
            super({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 1,
                    step_increment: 0.01,
                    page_increment: 0.1,
                    page_size: 0,
                    value: value ?? 0,
                }),
                draw_value: false,
                ...rest,
            })
        }

        vfunc_measure(
            orientation: Gtk.Orientation,
            for_size: number
        ): [number, number, number, number] {
            if (orientation === Gtk.Orientation.HORIZONTAL) {
                // Report natural=1 so the srow/sliders container doesn't inflate the QS panel
                // beyond the chip-grid natural width. The slider still hexpands to fill the
                // available space at allocation time — only the natural size is overridden.
                return [0, 1, -1, -1]
            }
            return super.vfunc_measure(orientation, for_size)
        }
    }
)
