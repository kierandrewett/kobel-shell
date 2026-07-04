// Animated surface registry — replaces App.toggle_window for surfaces that want
// a reveal animation. Each surface calls register() once, then Bar/app.ts call toggle().
//
// Pattern: window always starts hidden (visible=false). Opening makes it visible,
// then triggers the revealer; closing triggers the revealer then hides after transition.
import { App } from "astal/gtk4"
import { Variable, timeout } from "astal"
import Gtk from "gi://Gtk?version=4.0"

export type TransitionType = Gtk.RevealerTransitionType

const registry: Record<string, () => void> = {}

export function register(name: string, fn: () => void) {
    registry[name] = fn
}

export function toggle(name: string) {
    if (registry[name]) {
        registry[name]()
    } else {
        // Fallback for surfaces without animated reveals (session, drawer)
        App.toggle_window(name)
    }
}

// makeReveal: creates the state variables and toggle function for an animated surface.
//   - openMs: reveal-in duration in ms (default 220)
//   - closeMs: reveal-out + window-hide delay in ms (default 150)
//   - revealerRef: set this to the Revealer widget in `setup` so the toggle can
//     directly control transitionDuration per direction
export function makeReveal(openMs = 220, closeMs = 150) {
    const winVisible = Variable(false)
    const revealed = Variable(false)
    let revealerWidget: Gtk.Revealer | null = null
    let closeTimer: any = null

    const setRevealer = (r: Gtk.Revealer) => {
        revealerWidget = r
    }

    const open = () => {
        if (closeTimer) {
            closeTimer.cancel?.()
            closeTimer = null
        }
        if (revealerWidget) revealerWidget.transitionDuration = openMs
        winVisible.set(true)
        // One idle frame so GTK can realize the window before animating
        timeout(16, () => revealed.set(true))
    }

    const close = () => {
        if (revealerWidget) revealerWidget.transitionDuration = closeMs
        revealed.set(false)
        closeTimer = timeout(closeMs + 20, () => {
            winVisible.set(false)
            closeTimer = null
        })
    }

    const toggleFn = () => (revealed.get() ? close() : open())

    return { winVisible, revealed, setRevealer, open, close, toggle: toggleFn }
}
