// Animated surface registry - replaces App.toggle_window for surfaces that want
// reveal motion. Each surface calls register() once, then Bar/app.ts call toggle().
//
// Pattern: window starts hidden. Opening maps it once, then drives either a
// spring-backed progress value or a legacy Gtk.Revealer fallback. Closing reverses
// the animation and leaves the layer mapped but non-targetable, avoiding remap
// cost on the next warm open.
import { App } from "astal/gtk4"
import { Variable, timeout } from "astal"
import GLib from "gi://GLib"
import Gtk from "gi://Gtk?version=4.0"
import { MOTION, spring, springTo, type SpringSpec } from "./spring"

export type TransitionType = Gtk.RevealerTransitionType

const registry: Record<string, () => void> = {}
const closeRegistry: Record<string, () => void> = {}
const openSurfaces = new Set<string>()
export const dismissVisible = Variable(false)
const PROFILE_ANIM = GLib.getenv("KOBEL_PROFILE_ANIM") === "1"
export function register(name: string, fn: () => void) {
    registry[name] = fn
}

export function toggle(name: string) {
    if (registry[name]) {
        registry[name]()
    } else {
        // Fallback for plain Astal windows that have not registered an animated toggle.
        App.toggle_window(name)
    }
}

const setSurfaceOpen = (name: string, open: boolean) => {
    if (open) {
        openSurfaces.add(name)
    } else {
        openSurfaces.delete(name)
    }
    dismissVisible.set(openSurfaces.size > 0)
}

export function closeOpenSurfaces(except?: string) {
    for (const [name, close] of Object.entries(closeRegistry)) {
        if (name !== except) close()
    }
}
// makeReveal: creates the state variables and toggle function for an animated surface.
//   - openMs: reveal-in duration in ms (default 220)
//   - closeMs: reveal-out + idle delay in ms (default 150)
//   - setRevealer: optional legacy Revealer target for surfaces not yet on the
//     spring path.
//   - setSurface: spring opacity target for surfaces that should not use
//     Gtk.Revealer's allocation/clip transitions.
export function makeReveal(openMs = 220, closeMs = 150, profileName = "surface") {
    const winVisible = Variable(false)
    const revealed = Variable(false)
    const progress = Variable(0)
    let revealerWidget: Gtk.Revealer | null = null
    let progressAnim: ReturnType<typeof spring> | null = null
    let suppressProgressTrace = false
    let surfaceWidget: Gtk.Widget | null = null
    let closeTimer: ReturnType<typeof timeout> | null = null
    let surfaceInputEnabled: boolean | null = null
    let revealerInputEnabled: boolean | null = null
    let traceStart = 0
    let traceLast = 0
    let traceFrames = 0
    let traceMaxGap = 0
    let traceDone = false
    let traceSeq = 0
    let transitionStart = 0
    let traceFirstTick = false
    let openCount = 0
    let traceDirection = "transition"
    let traceWarm = 0

    const emitProfile = (event: string, fields: string[] = []) => {
        if (!PROFILE_ANIM) return
        const parts = ["KOBEL_TRACE", `surface=${profileName}`, `seq=${traceSeq}`, `event=${event}`]
        parts.push(...fields)
        if (transitionStart) {
            const elapsed = GLib.get_monotonic_time() / 1000 - transitionStart
            parts.push(`elapsed_ms=${Math.round(elapsed)}`)
        }
        print(parts.join(" "))
    }

    const beginTrace = (event: string, fields: string[] = [], direction = "transition", warm = 0) => {
        if (!PROFILE_ANIM) return
        const now = GLib.get_monotonic_time() / 1000
        traceSeq += 1
        transitionStart = now
        traceStart = now
        traceLast = now
        traceFrames = 0
        traceMaxGap = 0
        traceDone = false
        traceFirstTick = false
        traceDirection = direction
        traceWarm = warm
        emitProfile(event, fields)
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
        if (!traceFirstTick) {
            traceFirstTick = true
            const sampled = Math.round(value * 1000) / 1000
            emitProfile("first_tick", [`target=${target}`, `value=${sampled}`])
        }
        if ((target === 1 && value >= 0.999) || (target === 0 && value <= 0.001)) {
            traceDone = true
            const elapsed = Math.max(1, now - traceStart)
            const sampleHz = Math.round((traceFrames * 1000) / elapsed)
            const fields = [
                "KOBEL_MOTION",
                `surface=${profileName}`,
                `seq=${traceSeq}`,
                `direction=${traceDirection}`,
                `warm=${traceWarm}`,
                `target=${target}`,
                `elapsed_ms=${Math.round(elapsed)}`,
                `samples=${traceFrames}`,
                `sample_hz=${sampleHz}`,
                `max_gap_ms=${Math.round(traceMaxGap)}`,
            ]
            print(fields.join(" "))
        }
    }

    const setSurfaceInput = (enabled: boolean) => {
        if (!surfaceWidget || surfaceInputEnabled === enabled) return
        surfaceInputEnabled = enabled
        surfaceWidget.sensitive = enabled
        surfaceWidget.set_can_target(enabled)
        emitProfile("surface_input", [`enabled=${enabled ? 1 : 0}`])
    }

    const setRevealerInput = (enabled: boolean) => {
        if (!revealerWidget || revealerInputEnabled === enabled) return
        revealerInputEnabled = enabled
        revealerWidget.sensitive = enabled
        revealerWidget.set_can_target(enabled)
        emitProfile("revealer_input", [`enabled=${enabled ? 1 : 0}`])
    }

    const setProgress = (value: number, trace = true) => {
        const clamped = Math.max(0, Math.min(1, value))
        progress.set(clamped)
        setSurfaceInput(revealed.get() && clamped > 0.001)
        if (trace && !suppressProgressTrace && progressAnim) recordTrace(revealed.get() ? 1 : 0, clamped)
    }

    const setRevealer = (r: Gtk.Revealer) => {
        revealerWidget = r
        setRevealerInput(revealed.get())
    }

    const setSurface = (widget: Gtk.Widget) => {
        surfaceWidget = widget
        setSurfaceInput(revealed.get() && progress.get() > 0.001)
        progressAnim = spring(widget, MOTION.panelOpacity, setProgress, progress.get())
        emitProfile("set_surface")
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
        closeOpenSurfaces(profileName)
        setSurfaceOpen(profileName, true)
        openCount += 1
        const warmOpen = openCount > 1 ? 1 : 0
        beginTrace("open_start", [`warm=${warmOpen}`], "open", warmOpen)
        if (revealerWidget) revealerWidget.transitionDuration = openMs
        setRevealerInput(true)
        winVisible.set(true)
        emitProfile("visible_set")
        timeout(16, () => {
            emitProfile("open_delay")
            revealed.set(true)
            animateProgress(1, MOTION.panelOpacity)
        })
    }

    const close = () => {
        if (!revealed.get() && progress.get() <= 0.001) {
            setSurfaceOpen(profileName, false)
            return
        }
        if (revealerWidget) revealerWidget.transitionDuration = closeMs
        beginTrace("close_start", [], "close", 0)
        revealed.set(false)
        setSurfaceOpen(profileName, false)
        setRevealerInput(false)
        setSurfaceInput(false)
        animateProgress(0, MOTION.panelClose)
        closeTimer = timeout(closeMs + 20, () => {
            setProgress(0)
            emitProfile("idle_mapped")
            closeTimer = null
        })
    }

    const toggleFn = () => (revealed.get() ? close() : open())

    closeRegistry[profileName] = close

    return { winVisible, revealed, progress, setRevealer, setSurface, open, close, toggle: toggleFn }
}
