---
target: docs/prototype.html (full v6)
total_score: 32
p0_count: 0
p1_count: 2
timestamp: 2026-07-03T17-14-43Z
slug: docs-prototype-html
---
Method: dual-agent (A: design re-score · B: evidence sweep). Applied same-day as commit 632a970.

# Design Health Score — 32/40 (Good) · trend 27 → 29 → 32

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | System status | 4 | truthful indicators driven by real windows |
| 2 | Real-world match | 3 | zero-padded calendar digits (FIXED), casing drift (FIXED) |
| 3 | User control | 3 | no Clear undo; confirm never times out (timeout FIXED) |
| 4 | Consistency | 3 | badge placement split (FIXED), ragged rails (FIXED), tooltip split bar/dock |
| 5 | Error prevention | 3 | Clear-all unguarded remains |
| 6 | Recognition | 3 | icon-only utility row; invisible gesture vocabulary |
| 7 | Flexibility | 4 | accelerator-dense launcher/QS |
| 8 | Minimalist | 3 | static EQ (pause-collapse FIXED), week chips (FIXED) |
| 9 | Error recovery | 4 | failure canon is the product's best part |
| 10 | Help | 2 | gestures taught nowhere in-shell |

# Applied fixes (A top-6 + B highs/meds)
Calendar digits un-padded + week numbers quieted; slider rails equalized + icon columns aligned; session dim .8 + tx labels + resting rose on Shut down; remove-badges unified/chip-bg/keyboard-reachable; gnoblin amber scoped to its own glyph (battery stops crying wolf); media fill seeded + cava collapses on pause; phantom drill scrollbar (inactive view leaves layout); launcher super-chip visible; Mic label; edit title centered; dock widget de-cloned from Spotify fallback; day cells true circles; widget typography unified; focus transfers on window close; pointercancel handled; press-again auto-reverts; APPS seed flags deleted; dead corner-shape tokens pruned.

# Outstanding (accepted/QML backlog)
Clear-all undo; context-menu arrow-nav; gesture teaching (Super+? overlay); bar tooltips = dock dtip treatment; toast .when contrast on translucent surface over glow (3.84:1) — needs solid chip behind timestamp or darker panelT; DESIGN.md v5 rewrite (radius law, mono→tabular, current components); Clear-during-toast stagger race (renderNC rebuild orphans flinging cards); drag-during-panel pointer-capture edge; corner-shape:squircle needs a QML strategy.

# Verdict (Assessment A)
"Freeze as the QML spec once fixes 1–5 land" — they landed.
