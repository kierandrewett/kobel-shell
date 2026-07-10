// Animated surface registry - replaces App.toggle_window for surfaces that want
// reveal motion. Each surface calls register() once, then Bar/app.ts call toggle().
//
// Pattern: window starts hidden. Opening makes it visible, then drives either a
// Gtk.Revealer fallback or a spring-backed progress value; closing reverses and
// hides the window after the transition.
import { App } from "astal/gtk4"
import { Variable, timeout } from "astal"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { MOTION, spring, springTo, type SpringSpec } from "./spring"

export type TransitionType = Gtk.RevealerTransitionType

const registry: Record<string, () => void> = {}
const PROFILE_ANIM = GLib.getenv("KOBEL_PROFILE_ANIM") === "1"


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
export function makeReveal(openMs = 220, closeMs = 150, profileName = "surface") {
    const winVisible = Variable(false)
    const revealed = Variable(false)
    const progress = Variable(0)
    let revealerWidget: Gtk.Revealer | null = null
    let progressAnim: ReturnType<typeof spring> | null = null
    let closeTimer: ReturnType<typeof timeout> | null = null
    let traceStart = 0
    let traceLast = 0
    let traceFrames = 0
    let traceMaxGap = 0
    let traceDone = false

    const resetTrace = () => {
        if (!PROFILE_ANIM) return
        const now = GLib.get_monotonic_time() / 1000
        traceStart = now
        traceLast = now
        traceFrames = 0
        traceMaxGap = 0
        traceDone = false
    }

    const recordTrace = (target: number, value: number) => {
        if (!PROFILE_ANIM || traceDone) return
        const now = GLib.get_monotonic_time() / 1000
        if (!traceStart) {
            traceStart = now
            traceLast = now
        } else {
            traceMaxGap = Math.max(traceMaxGap, now - traceLast)
            traceLast = now
        }
        traceFrames += 1
        if ((target === 1 && value >= 0.999) || (target === 0 && value <= 0.001)) {
            traceDone = true
            const elapsed = Math.max(1, now - traceStart)
            const sampleHz = Math.round((traceFrames * 1000) / elapsed)
            const fields = [
                "KOBEL_MOTION",
                `surface=${profileName}`,
                `target=${target}`,
                `elapsed_ms=${Math.round(elapsed)}`,
                `samples=${traceFrames}`,
                `sample_hz=${sampleHz}`,
                `max_gap_ms=${Math.round(traceMaxGap)}`,
            ]
            print(fields.join(" "))
        }
    }

    const setProgress = (value: number) => {
        const clamped = Math.max(0, Math.min(1, value))
        progress.set(clamped)
        if (progressAnim) recordTrace(revealed.get() ? 1 : 0, clamped)
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
        resetTrace()
        if (revealerWidget) revealerWidget.transitionDuration = openMs
        winVisible.set(true)
        timeout(16, () => {
            revealed.set(true)
            animateProgress(1, MOTION.panelOpacity)
        })
    }

    const close = () => {
        if (revealerWidget) revealerWidget.transitionDuration = closeMs
        resetTrace()
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
