// Animated surface registry - replaces App.toggle_window for surfaces that want
// reveal motion. Each surface calls register() once, then Bar/app.ts call toggle().
//
// Pattern: window starts hidden. Opening makes it visible, then drives either a
// Gtk.Revealer fallback or a spring-backed progress value; closing reverses and
// hides the window after the transition.
import { App } from "astal/gtk4"
import { Variable, timeout } from "astal"
import Gtk from "gi://Gtk?version=4.0"
import { MOTION, spring, springTo, type SpringSpec } from "./spring"

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
//   - revealerRef: optional legacy Revealer fallback for surfaces not yet on the
//     spring path.
//   - surfaceRef: optional spring opacity target for surfaces that should not use
//     Gtk.Revealer's allocation/clip transitions.
export function makeReveal(openMs = 220, closeMs = 150) {
    const winVisible = Variable(false)
    const revealed = Variable(false)
    const progress = Variable(0)
    let revealerWidget: Gtk.Revealer | null = null
    let progressAnim: ReturnType<typeof spring> | null = null
    let closeTimer: ReturnType<typeof timeout> | null = null

    const setProgress = (value: number) => {
        progress.set(Math.max(0, Math.min(1, value)))
    }

    const setRevealer = (r: Gtk.Revealer) => {
        revealerWidget = r
    }

    const setSurface = (widget: Gtk.Widget) => {
        progressAnim = spring(widget, MOTION.panelOpacity, setProgress, progress.get())
    }

    const animateProgress = (value: number, spec: SpringSpec) => {
        if (progressAnim) {
            springTo(progressAnim, value, spec)
            return
        }

        setProgress(value)
    }

    const open = () => {
        if (closeTimer) {
            closeTimer.cancel?.()
            closeTimer = null
        }
        if (revealerWidget) revealerWidget.transitionDuration = openMs
        winVisible.set(true)
        // One idle frame so GTK can realize the window before animating
        timeout(16, () => {
            revealed.set(true)
            animateProgress(1, MOTION.panelOpacity)
        })
    }

    const close = () => {
        if (revealerWidget) revealerWidget.transitionDuration = closeMs
        revealed.set(false)
        animateProgress(0, MOTION.panelClose)
        closeTimer = timeout(closeMs + 20, () => {
            setProgress(0)
            winVisible.set(false)
            closeTimer = null
        })
    }

    const toggleFn = () => (revealed.get() ? close() : open())

    return { winVisible, revealed, progress, setRevealer, setSurface, open, close, toggle: toggleFn }
}
