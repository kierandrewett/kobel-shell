---
target: docs/prototype.html (v5)
total_score: 29
p0_count: 0
p1_count: 3
timestamp: 2026-07-03T14-20-14Z
slug: docs-prototype-html
---
Method: dual-agent (A: design review · B: detector/evidence)

# Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Silent mode + gnoblin-down invisible outside QS |
| 2 | Match System / Real World | 3 | zero-padded "03" days; "100% · 3h 02m" at full charge |
| 3 | User Control and Freedom | 3 | no undo anywhere; toasts inert (no dismiss/click) |
| 4 | Consistency and Standards | 3 | two chevron treatments; written spec diverged from live spec |
| 5 | Error Prevention | 2 | Log out + Clear-all fire instantly, no undo backstop |
| 6 | Recognition Rather Than Recall | 3 | qtop + tray icon-only, tooltip-only labels |
| 7 | Flexibility and Efficiency | 4 | keyboard-first launcher, : commands, =maths, wheel volume |
| 8 | Aesthetic and Minimalist Design | 3 | BT tall tile = arbitrary emphasis; calendar states date 3× |
| 9 | Error Recovery | 2 | flagship failure (gnoblin-down) = unlabeled amber 32px button |
| 10 | Help and Documentation | 3 | no shortcut cheat-sheet (Super+? overlay) |
| **Total** | | **29/40** | **Good** (baseline 27/40) |

# Anti-Patterns Verdict
LLM: NOT AI-slop — authored (violet-cast neutrals + leaf, opaque panels, seeded sakura, gnoblinctl rows, per-surface spring tuning, designed failure states). Two asterisks: 24px squircle panels contradict the written "nothing above 16px" (renegotiated in code, not on paper); Design Principle 4 "data wears mono" is silently dead — zero monospace glyphs remain, even the fake terminal is proportional Inter.
Detector: 2 hits. bounce-easing on cubic-bezier(.24,1.36,.35,1) = FALSE POSITIVE (single mild overshoot, the signature reveal curve, not bounce). layout-transition width on .dbtn .dot = real but negligible (relayouts only the 14px indicator). Overlay injection unavailable (headless only) — screenshot evidence used instead.
Where they agree: the floating NC drawer header on raw wallpaper. B measured it: "Notifications" 2.09:1, Clear 1.37:1, count 1.16:1 (AA needs 4.5:1).

# Priority Issues
- [P1] NC drawer header text floats on arbitrary wallpaper — measured contrast 1.16–2.09:1. Fix: give the header row a panel chip backing (or move Clear into a pill), don't rely on text-shadow.
- [P1] gnoblin-down demoted to an unlabeled amber icon + tooltip. Violates "org.gnoblin.Shell is a first-class surface". Fix: escalate disconnection to a bar-level signal (status pill goes amber) + a labeled row/banner in QS while degraded.
- [P1] A11y architecture that will port verbatim to QML: (a) chevrons are span[role=button] nested INSIDE buttons — invalid interactive nesting; (b) zero aria-live — toasts/OSD/connecting/badge silent to SR; (c) no real focus trap/inert — Tab escapes panels into occluded content.
- [P2] Destructive inconsistency: press-again on Restart/Shutdown but not Log out; Clear-all instant with no undo.
- [P2] Spec divergence + dead code: DESIGN.md still says 16px cap / mono data / stats+user+gnob rows / workspace dots (removed by explicit user decision — record it); dead CSS: .qclock .ws .wsb .gnob .urow .stats .knob .swoop; "1:1 with QML" overstated (corner-shape, backdrop-filter, Iconify streaming need QML strategies).

# Persona Red Flags
Alex: toasts uninteractable (no click-to-open, no swipe-away outside drawer); wheel target is the 28px icon not the pill; no mixer jump from bar; no Super+? cheat-sheet.
Sam: nested-button chevrons announce as control-in-control; no announcements for volume/connection/notifications; --dim used for informative text (~4:1); NC header contrast unbounded by tokens.
gnoblin adopter: compositor story thin — :grants has no surface, disconnection is a tooltip; portable parts (springs, OKLCH) excellent, copy-blind parts (squircle, backdrop-filter, nested chips) don't survive QML.

# Minor Observations
Zero-padded calendar days add noise; calendar popover repeats the date 3×; "No events" is the only italic; bar says 100% while QS invents "3h 02m" runtime at full charge; BT rows toast "toggled" without state change; Silent has no bar indicator; #fail hash under-demonstrates (media-empty targets a panel it doesn't open); Function() maths eval must not inspire the QML port.

# Questions to Consider
- Should org.gnoblin.Shell disconnection be a bar-level event rather than a QS-internal one, given "motion is the product" and this is the product's heartbeat?
- Which is the contract — DESIGN.md's tables or prototype.html's computed values — and who renegotiates the anti-references (24px, Inter, mono)?
- The dock answers "which apps"; nothing answers "which workspace" (removed by user decision). Does the shell need any spatial affordance, or is that gnoblin's job?
