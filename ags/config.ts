// The token layer — the single place the shell's geometry comes from.
// Prototype equivalent: the CSS custom properties on .desktop (04be72e).
// Change a value here and bar, panels, dock, snap-anchored surfaces all reflow.

export interface Tokens {
    barH: number // px — bar height; controls derive from it
    barR: number // bar corner radius
    gap: number // screen gap (bar top offset, dock bottom offset)
    edge: number // side insets
    icon: number // dock/launcher icon tile size
    dockPad: number // dock padding (concentric radius derives)
    tileH: number // QS tile height
    panelW: number // QS/notifications/toasts width
    launcherW: number
    calendarW: number
}

export const floating: Tokens = {
    barH: 42,
    barR: 14,
    gap: 10,
    edge: 12,
    icon: 44,
    dockPad: 5,
    tileH: 54,
    panelW: 365, // 28.5cqw at 1280px = 364.8 ≈ 365
    launcherW: 584, // 46cqw at 1280px = 588.8 → clamped to 584 max
    calendarW: 336, // 27cqw at 1280px = 345.6 → clamped to 336 max
}

// gapless = a token preset, exactly like the prototype's .gapless class
export const gapless: Tokens = {
    ...floating,
    barH: 38,
    barR: 0,
    gap: 0,
    edge: 0,
}

export let tokens: Tokens = floating

export const ctl = () => tokens.barH - 11 // bar control size
export const panelTop = () => tokens.gap + tokens.barH + 6

// GTK CSS can't calc() from JS state; we regenerate a :root-ish block and
// let App.apply_css re-skin live (the "bar 42 cycler" of the QML/AGS world).
export function tokenCss(t: Tokens = tokens): string {
    return `
  .bar { min-height: ${t.barH}px; border-radius: ${t.barR}px;
         margin: 0; }
  .bar button { min-width: ${ctl()}px; min-height: ${ctl()}px; }
  .dock { padding: ${t.dockPad}px; border-radius: ${12 + t.dockPad - 1}px;
          margin-bottom: ${t.gap}px; }
  .icon-tile { min-width: ${t.icon}px; min-height: ${t.icon}px; }
  .qs, .drawer, .calendar, .cal { margin-top: ${panelTop()}px; }
  .qs { min-width: ${t.panelW - 24}px; }  /* panelW is outer; subtract .sheet padding 12px×2 */
  .launcher { min-width: ${t.launcherW}px; }
  .calendar, .cal { min-width: ${t.calendarW - 24}px; }  /* calendarW is outer; subtract .sheet padding 12×2 */
  .chip { min-height: ${t.tileH}px; }
  `
}

export function setTokens(next: Partial<Tokens>, apply: (css: string) => void) {
    tokens = { ...tokens, ...next }
    apply(tokenCss(tokens))
}
