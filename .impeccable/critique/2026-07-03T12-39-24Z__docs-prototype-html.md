---
target: docs/prototype.html
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-07-03T12-39-24Z
slug: docs-prototype-html
---
Method: dual-agent (A: design-review sub-agent · B: detector/evidence sub-agent, isolated)

# Critique — kobel-shell `docs/prototype.html` (sakura pop)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Rich state everywhere, but the bar's leaf `100%` beside the speaker icon reads as volume and is actually battery; no transitional (connecting…) states |
| 2 | Match System / Real World | 3 | Register nails the audience (gnoblinctl, D-Bus names); ⌘ glyphs on a Linux shell break world-fidelity |
| 3 | User Control and Freedom | 3 | Esc/scrim everywhere, springs interruptible, swipe-dismiss — but Clear/dismiss are irreversible, no undo |
| 4 | Consistency and Standards | 3 | Strong system that breaks its own written rules (accent-as-text ×4, rose album art, 22px radius, sans bar-date) |
| 5 | Error Prevention | 2 | Shutdown-hovers-rose is the only guard; no confirm/hold on session actions; Clear fires instantly |
| 6 | Recognition Rather Than Recall | 3 | `:` command mode is taught in-surface; wheel-volume is pure recall (title-attr only) |
| 7 | Flexibility and Efficiency | 3 | Keyboard-first launcher + gestures; but QS/NC/session have no keyboard path, sliders keyboard-dead |
| 8 | Aesthetic and Minimalist Design | 4 | Genuinely excellent surfaces; only blemish is the QS "leaf wall" when everything is healthy |
| 9 | Error Recovery | 1 | No failure state designed anywhere: Wi-Fi fail, no-media, gnoblin disconnected, launcher no-results |
| 10 | Help and Documentation | 2 | In-surface hints exist; gestures documented only in the meta strip, which is not the shell |
| **Total** | | **27/40** | **Acceptable→Good: strong visible half, undesigned failure half** |

## Anti-Patterns Verdict

**LLM assessment: not slop.** Every canonical tell is absent — no ghost-cards, no gradient text, no glassmorphism, no default azure, no eyebrows, disciplined radii (one exception), honest opaque materials. The worldbuilding (chompers-5G, WH-1000XM5, "Soft-reload complete — 4 extensions, 2 scripts. Windows untouched.") is copy no template produces, and leaf-on-violet is genuinely uncommon in the rice scene. Residual slop-adjacent notes: flat single-glyph launcher "icons" read as placeholder monogram energy; ⌘ glyphs + traffic-light dots are a macOS muscle-memory leak on a Linux product.

**Deterministic scan: 2 warnings, no errors.**
- `bounce-easing` at line 20 (`cubic-bezier(.24,1.36,.35,1)`) — borderline **false positive vs rule intent**: single back-out overshoot used once as the signature `--ovr` curve, not bounce/elastic oscillation; it matches the documented motion vocabulary.
- `layout-transition` at line 123 (`transition: width` on launcher `.tile`) — **true positive**: search filtering animates layout width. Low practical jank at 6 tiles, but the QML translation should collapse via transform/opacity instead.

Mechanical checks (agent B): zero border+shadow ghost pairs, zero z-index ≥999 (coherent 5–70 scale), `prefers-reduced-motion` engineered in CSS *and* the spring engine, global `:focus-visible`, fully self-contained file (no external URLs). Exactly one radius >16px: `.sbtn .sic` at 22px — confirming Assessment A's rule-break finding mechanically.

**Visual overlays**: not available — no interactive browser automation in this session; headless screenshot evidence (5 surface states + 700px narrow render) was used instead.

## Overall Impression

This is the rare prototype where the motion system, the copy, and the material honesty all carry real intent — it would pass the "would Rin screenshot it for r/unixporn" test on the QS panel and launcher. The gap is asymmetric: the *happy path* is crafted to spec while the *failure half* (error states, keyboard access outside the launcher, destructive-action guards) is essentially undesigned. Since this file is the QML source of truth, those gaps will be translated faithfully unless fixed here. Single biggest opportunity: design the failure states and keyboard path now, before translation.

## What's Working

1. **The spring engine is the design, not a garnish.** One damped-spring class drives panels, badge pops, bell shake, workspace morph, and velocity-inheriting swipe-fling — all interruptible, all honored under reduced-motion, all 1:1 with QML `SpringAnimation`. Exactly what "motion is the product" should look like as an executable spec.
2. **Copy as craft.** Chips carry `chompers-5G` / `WH-1000XM5` / `Until 07:00` rather than on/off booleans — personal, specific, and it defeats color-alone meaning. The `org.gnoblin.Shell` row dogfoods the compositor relationship as a visible feature.
3. **Material honesty holds under inspection.** Opaque violet-cast panels, elevation purely by surface steps + shadow, leaf as fill-with-ink; contrast verified (mut ≈ 8.9:1, dim ≈ 5.5:1). Both agents independently confirmed the token discipline.

## Priority Issues

1. **[P1] Bar battery/volume ambiguity.** The leaf `100%` sits directly after the speaker icon in the status pill; it's battery, there's no battery glyph, and actual volume is 64%. The most-glanced readout on an 8h/day surface misleads. **Fix:** give battery its own glyph+% pair (mono, `tx` — leaf only when charging/low), keep the speaker icon stateful (mute/level variants). *Command: `$impeccable clarify`*
2. **[P1] Keyboard path collapses outside the launcher — violating PRODUCT.md's own commitment.** QS and NC open from non-focusable `div`s; session buttons are `div`s (Lock/Shutdown unreachable); sliders have no keyboard/ARIA; notification dismiss X is invisible under focus; swipe has no keyboard equivalent. **Fix:** real `<button>`s everywhere, `role=slider` + arrow keys, arrow-nav + Enter in session, `.nx` visible on focus-within, Del-to-dismiss. *Command: `$impeccable harden` (a11y scope) or `$impeccable audit`*
3. **[P1] The failure half of the shell is undesigned.** No nothing-playing media card, no Wi-Fi connecting/failed state, no `org.gnoblin.Shell` *disconnected* treatment (hardcoded "connected" — and shell-demos-compositor makes this a brand moment), no launcher no-results state (garbage query = silent empty strip). **Fix:** design the four failure states before QML translation. *Command: `$impeccable harden`*
4. **[P2] The system breaks its own written rules.** Accent-as-text (bar `.pct`, `.crow b`, `.lfoot b`), accent outline on `.tile.sel`, decorative leaf fills (avatar, gnob icon), **rose album art** (rose is documented destructive-only, inches from real destructive rose), 22px session-button radius (mechanically confirmed the only >16px), sans bar-date where the spec says data wears mono. Aggregate effect: the QS panel becomes a leaf wall when healthy, and accent stops signalling. **Fix:** per-element sweep; neutral `chip` album placeholder; demote decorative fills; non-accent selection treatment for tiles. *Command: `$impeccable polish`*
5. **[P2] Surface collisions.** (a) Toasts render at the same coordinates as an open QS/NC panel and z-index above it — a toast will sit on the calendar. (b) At narrow widths the absolutely-centered clock visibly overlaps the focused-window title (garbled glyphs at 700px — matters for small/split monitors). **Fix:** route toasts to the list when NC is open / offset below when QS is open; give the bar center a min-gap layout instead of absolute centering. *Command: `$impeccable adapt` + `$impeccable polish`*

## Persona Red Flags

- **Alex (power user):** cannot open QS/NC/session from the keyboard at all; can't Enter-confirm shutdown; can't arrow-nudge sliders; only two shortcuts exist in the whole spec and they're written in macOS ⌘; no jump-back-to-today after paging the calendar.
- **Sam (accessibility):** blocked outright from QS/NC/session by focusability; hover-only dismiss X; swipe-only dismissal; sliders unusable. Visual side passes: real contrast, text-not-color state, size+color workspace indicator, engineered reduced-motion — the failures are all keyboard.
- **Rin (r/unixporn ricer):** would screenshot QS-over-sakura and the launcher; would instantly clock the placeholder glyph icons ("where are your real icon themes?"), macOS traffic lights, ⌘ glyphs, and a bar whose only signature moment is the workspace pill morph — Rin crops the bar out.

## Minor Observations

- Hit targets below the spec's own minima: workspace dots 8px, dismiss X 19px, calendar arrows 26px, mixer chevrons 24px.
- Toasts: fixed 3.6s regardless of length, no hover-to-persist; notification cards carry no actions (freedesktop actions are a real shell requirement).
- OSD: volume only (no brightness OSD, no mute/0% icon variant); timer can expire mid-drag.
- No disabled state exists anywhere in the system; QML build needs one on day one.
- Closing a panel drops focus on the floor (no focus return to the invoking control).
- Calendar day cells imply clickability next to two working arrow buttons but are inert; launcher behavior at >6 results is undefined.
- Right-middle wallpaper bough reads sparse/procedural next to the lush top canopy.
- Launcher tile filtering animates `width` (detector-confirmed); use transform/opacity in QML.

## Questions to Consider

1. When everything is healthy, QS is a green wall — if leaf marks "active + live," what's left to mark *anomalous*? Should "on" be quieter so the one thing that needs you can be loud?
2. The bar gets more eyeball-hours than every panel combined and is the least signature surface in the design. Where does sakura-pop live in the bar at hour six of a workday?
3. The session dialog holds the four most consequential actions in the product and received the least design — no keyboard, no confirmation, no hold-to-commit. Does peak-end demand this be the *most* engineered surface instead?
