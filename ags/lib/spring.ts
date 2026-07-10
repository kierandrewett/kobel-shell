// The prototype's damped-spring engine, expressed as Adw.SpringAnimation.
// Prototype: class Spring { k, d, kick(), set(), jump() } — 1:1 mapping:
//   k (stiffness), d (damping) -> Adw.SpringParams.new_full(damping, mass, stiffness)
//   set(t)  -> value_to = t; play()
//   kick(v) -> initial_velocity += v
//   jump(t) -> skip animation (honors gtk-enable-animations for reduced motion)

import Adw from "gi://Adw?version=1"
import Gtk from "gi://Gtk?version=4.0"

export interface SpringSpec {
    k: number
    d: number
}

// The motion table — every surface uses one of these. Do not invent new ones casually.
export const MOTION = {
    panelOpen: { k: 420, d: 26 }, // slight overshoot
    panelOpacity: { k: 360, d: 32 },
    panelClose: { k: 640, d: 48 }, // fast, no bounce
    drill: { k: 400, d: 27 },
    drillBack: { k: 440, d: 29 },
    height: { k: 440, d: 32 },
    toastIn: { k: 360, d: 23 },
    toastOut: { k: 440, d: 36 },
    badgePop: { k: 400, d: 17 },
    bellShake: { k: 330, d: 7 },
    fling: { k: 280, d: 27 },
    dockCycle: { k: 430, d: 24 },
    snap: { k: 430, d: 28 },
} as const

export function spring(
    widget: Gtk.Widget,
    spec: SpringSpec,
    apply: (v: number) => void,
    from = 0
): Adw.SpringAnimation {
    const target = Adw.CallbackAnimationTarget.new(apply)
    const params = Adw.SpringParams.new_full(spec.d, 1, spec.k)
    const anim = new Adw.SpringAnimation({
        widget,
        spring_params: params,
        value_from: from,
        value_to: from,
        epsilon: 0.0005,
        target,
    })
    return anim
}

export function springTo(anim: Adw.SpringAnimation, to: number, spec?: SpringSpec) {
    if (spec) anim.spring_params = Adw.SpringParams.new_full(spec.d, 1, spec.k)
    anim.value_from = anim.value // interruptible: continue from current
    anim.initial_velocity = anim.velocity
    anim.value_to = to
    anim.play()
}

export function kick(anim: Adw.SpringAnimation, velocity: number) {
    anim.value_from = anim.value
    anim.initial_velocity = anim.velocity + velocity
    anim.play()
}
