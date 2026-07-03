# kobel-shell / ags

The AGS port of the kobel-shell chrome. `docs/prototype.html` (repo root) is the
**executable spec** — every surface, spring value, and interaction here was designed
and critiqued there first (impeccable score trail: 27 → 29 → 32/40). This directory
is the same shell expressed in AGS/Astal TypeScript.

**Target: AGS v2.x (Astal), GTK4 (`astal/gtk4`), gtk4-layer-shell, libadwaita
(Adw.SpringAnimation).** Written against the v2 API as of early 2026 — if Astal has
drifted, the fixes are mechanical (imports/JSX runtime), not architectural.
This scaffold has NOT been runtime-tested (no ags on the build machine); treat first
boot as a porting session with the prototype open beside it.

## Setup

```sh
# Fedora: copr/nix/manual — needs ags v2, astal libraries, gtk4-layer-shell, libadwaita
ags init -d . --gtk 4     # merges tsconfig/@girs types into this dir (keep our files)
ags run .                 # run the shell
ags quit                  # stop
```

Astal libraries used: `AstalApps`, `AstalNetwork`, `AstalBluetooth`, `AstalWp`,
`AstalMpris`, `AstalNotifd`, `AstalBattery`, `AstalTray`.

### gnoblin integration

gnoblin vacates the chrome; kobel claims it:

```sh
gnoblinctl disable osd
gnoblinctl disable notifications     # kobel's AstalNotifd daemon takes the bus name
# keybinding (gnoblin scripts or gsettings): Super release → `astal -i kobel -t launcher`
```

`services/gnoblin.ts` wraps `org.gnoblin.Shell` (soft-reload, features, the window
list that drives the dock). When the bus name vanishes, the bar's status segment goes
amber and QS grows the reconnect banner — the failure canon from the prototype.

## Architecture

| file | prototype source of truth |
|---|---|
| `app.ts` | window registry, per-monitor spawn, layout tokens → CSS |
| `config.ts` | THE token layer (`--bar-h`, `--gap`, `--edge`, `--icon`, …) — change a value, the shell reflows; `gapless` is a token preset |
| `lib/spring.ts` | the Spring engine → `Adw.SpringAnimation` (motion table in one place) |
| `lib/fuzzy.ts` | launcher fuzzy match + highlight + capped log2 frecency |
| `services/gnoblin.ts` | org.gnoblin.Shell D-Bus proxy + connected state |
| `widget/Bar.tsx` | bar: launcher btn, focused title, centered clock, tray, status pill (amber segment on gnoblin-down), bell + badge, power |
| `widget/Dock.tsx` | icon tiles (shared component), window dots (ABSOLUTE overlays, sliding 4-dot viewport + minis), click model (launch/focus/cycle/minimize), scroll, middle-click new window, tooltips, context menu, ghost-zoom launch |
| `widget/Launcher.tsx` | Super-release spotlight: inset field, ghost autocomplete, best-match slot, sections (apps/actions/files/web), `=` calc, `:` commands, dock-tile grid w/ live dots, widget row |
| `widget/QuickSettings.tsx` | uniform pill tiles from the catalog, drilldowns (Wi-Fi/BT/mixer) as a spring-slid stack, GNOME sliders, top row, gnoblin banner |
| `widget/Calendar.tsx` | GNOME-replica grid: week numbers, dimmed weekends, clickable days, event dots, notification-style event card, sliding months |
| `widget/Notifications.tsx` | floating toasts + drawer; toast→drawer adoption; swipe dismiss |
| `widget/OSD.tsx` | display-only volume pill above the dock |
| `widget/Session.tsx` | dimmed overlay, 4 buttons, press-again confirm (auto-revert 4s), resting rose on Shut down |

## Design rules that MUST survive the port

- **Dots are ALWAYS absolute overlays** — icons own the geometry; indicators never
  take layout space (Gtk: `Gtk.Overlay`, never a sibling in a Box).
- Motion is springs (`Adw.SpringAnimation`), interruptible, velocity-preserving;
  open k420/d26 (slight overshoot), close k640/d48 (no bounce). Reveal stagger is
  opacity-only — content moves 1:1 with its surface.
- Accent (leaf) only as solid fill with ink text: active states, primary actions,
  today, badge. Amber = anomaly. Rose = destructive, earned at point of commitment.
- Panels are opaque; the ONLY translucency is toasts/OSD, contingent on a gnoblin
  blur window-rule.
- Everything sizes from tokens (`config.ts`) — no hardcoded surface dimensions.
