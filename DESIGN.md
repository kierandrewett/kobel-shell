# kobel-shell — design & build plan

The full chrome suite for [gnoblin](https://github.com/kierandrewett/gnoblin), built in
Quickshell. gnoblin vacates the space (no top bar, no dash, no overview, toggleable
OSD/notifications/screenshot); kobel-shell fills all of it.

**Interactive mockups:** see the published design artifact (bar, dock, control centre,
notifications, OSD, launcher, session — all clickable).

Inspiration studied: [end-4/dots-hyprland](https://github.com/end-4/dots-hyprland)
(illogical-impulse — fluid Material-3-ish everything-in-Quickshell),
[caelestia-dots/shell](https://github.com/caelestia-dots/shell) (drawers system,
`>` command mode, dashboard). We steal the *ideas* — centralized drawer/visibility state,
launcher command mode, per-screen instancing — not the look. kobel has its own identity.

---

## 1. Design language

### Palette — "goblin green on green-cast ink"
Every neutral is green-biased; the accent is the identity.

| token | value | use |
|---|---|---|
| `ink` | `#0C100D` | deepest ground (session scrim base) |
| `surface` | `rgba(20,27,22,0.94)` | all floating chrome (bar, dock, panels) |
| `raised` | `#1C241E` | tiles, rows, hover states |
| `line` | `rgba(232,239,233,0.08)` | 1px hairline borders on every surface |
| `text` | `#E8EFE9` | primary |
| `muted` | `#8FA093` | secondary (sage) |
| `accent` | `#7FE08E` | goblin green — active states, focus, fills |
| `accentDeep` | `#3F9D5C` | accent borders/hover |
| `accentInk` | `#0A2213` | text on accent |
| `amber` | `#E8C267` | media, warnings |
| `coral` | `#E07A6B` | destructive |
| `sky` | `#7BB8E0` | downloads/info |

### Shape
- **Pill geometry**: bar and OSD are full pills (`radius: height/2`); dock is a 22px
  super-ellipse-ish rounded slab; panels 20px, tiles 14px, rows 9px.
- Every surface: 1px `line` border + heavy soft shadow (`0 18px 50px rgba(0,0,0,.55)`).
- No blur-behind (mutter has no blur protocol) — surfaces are 94% opaque instead.
  If gnoblin ever grows a blur extension, drop opacity to ~80% and it upgrades for free.

### Type
- UI: the system font (Adwaita Sans/Cantarell — whatever the desktop runs).
- Data (clock, %, metrics): monospace with tabular figures. Quickshell `Text`
  with `font.features` or the fixed system mono.

### Motion
- **Springy in, quick out**: reveals use an overshoot curve
  (`Easing.OutBack`-family, ~280ms); dismissals are 150ms OutQuad.
- Workspace pill morphs width (8px dot → 26px pill) — the signature micro-interaction.
- Dock icons translate up + scale 1.12 on hover, spring curve.
- OSD slides up 8px + fades, auto-hides after 2.2s.
- All durations/curves in `Theme.qml` so they're tunable in one place.

---

## 2. Architecture

```
kobel-shell/
├── shell.qml                 # ShellRoot: per-screen Variants of Bar+Dock, singleton overlays
├── Theme.qml                 # singleton: palette, radii, motion, spacing (THE token file)
├── services/                 # headless singletons, no UI
│   ├── Gnoblin.qml           # org.gnoblin.Shell (exists — grow: features cache, grants)
│   ├── Audio.qml             # Quickshell.Services.Pipewire: sink/source vol+mute
│   ├── Network.qml           # nmcli monitor -> ssid/strength/state
│   ├── Bluetooth.qml         # bluetoothctl -> powered/connected device
│   ├── Battery.qml           # Quickshell.Services.UPower
│   ├── Brightness.qml        # brightnessctl get/set
│   ├── Media.qml             # Quickshell.Services.Mpris: active player
│   ├── Notifd.qml            # Quickshell.Services.NotificationServer (owns o.fd.Notifications)
│   ├── Tray.qml              # Quickshell.Services.SystemTray
│   ├── Toplevels.qml         # Quickshell.Wayland.ToplevelManager (gnoblin ships wlr-f-t-m)
│   ├── Apps.qml              # Quickshell DesktopEntries + frecency ranking
│   └── Visibility.qml        # THE drawer state machine (caelestia idea): one enum of
│                             #   open surface {none,cc,notifs,launcher,session}; opening one
│                             #   closes others; scrim-dismiss; per-screen aware
├── modules/
│   ├── bar/    Bar.qml, Workspaces.qml, Clock.qml, SysCluster.qml, TrayRow.qml
│   ├── dock/   Dock.qml, DockApp.qml
│   ├── controlcentre/  ControlCentre.qml, Tile.qml, VolumeSlider.qml, MediaCard.qml, GnoblinRow.qml
│   ├── notifications/  Popups.qml (toasts), Centre.qml (history list), Toast.qml
│   ├── osd/    Osd.qml (volume/brightness/caps pill)
│   ├── launcher/  Launcher.qml, ResultRow.qml, CommandMode.qml
│   └── session/   Session.qml (lock/logout/restart/shutdown scrim)
└── components/  StyledSlider.qml, IconButton.qml, Scrim.qml, Pill.qml
```

Key structural decisions:
- **`Visibility.qml` is the one source of truth** for which overlay is open (stolen from
  caelestia's drawers). Bar/dock/hotkeys *request*; the service arbitrates. No two
  overlays fight; Esc/scrim always work.
- **Per-screen**: Bar + Dock instantiate per screen via `Variants`; overlays are
  singletons that appear on the focused screen.
- **Every module toggles its gnome counterpart** on load via `Gnoblin` service:
  Notifd → `disable notifications`, Osd → `disable osd`. On shell exit (Component.
  onDestruction), hand them back. gnoblin's whole feature-toggle system exists for this.

## 3. The modules

### Bar (exists, grows)
Floating pill, 40px, 10px inset. Left: workspace dots (morphing active pill; data from
`Toplevels`/gnoblin workspaces), focused window title. Center: clock (mono, click →
notification centre). Right: tray icons, sys cluster (net/vol/battery → control centre),
bell (unread badge).

### Dock
Bottom-center floating slab. Pinned apps (config list) + running apps (from
`Toplevels`, matched by app-id). States: running dot, focused = accent pill. Click:
launch / focus / cycle windows. Hover: spring magnify + tooltip. Right-click: pin/unpin,
close. Separator, then Settings (gnoblin-control-center) + "all apps" grid button →
launcher. Auto-hide optional (config), hides when a window intersects.

### Control Centre
352px panel, top-right, springs from the sys cluster. Rows:
1. Header — avatar, host + uptime, Settings gear (launches `gnome-control-center gnoblin`),
   power → Session.
2. Toggle grid (2-col): Wi-Fi, Bluetooth, DND (drives Notifd), Night Light, Screen Share
   (shows grant count; click → gnoblin Settings grants), gnome OSD (SetFeature dogfooding!).
3. Sliders: volume (Pipewire), brightness (brightnessctl).
4. Media card: MPRIS art/title/artist, prev/play/next, progress.
5. **gnoblin row** (signature): live `org.gnoblin.Shell` status + Soft-reload button.

### Notifications
Two faces, one `Notifd` service:
- **Toasts**: top-right stack (max 3 + "N more"), app icon, actions, inline progress
  (`x-kde-`/`value` hint), swipe/click dismiss, 5s timeout (sticky for critical).
- **Centre**: clock-click panel; history (persist last ~50 to disk), Clear all, DND toggle.
Owns `org.freedesktop.Notifications` — requires `gnoblinctl disable notifications`
(automated by the service; gnoblin releases the name live, no restart — already verified).

### OSD
Bottom-center pill (300px): icon + fill slider + tabular %. Triggers: volume/mute
(Pipewire events), brightness, caps lock. Auto-hide 2.2s, re-trigger resets timer,
slider is draggable (sets the real volume). Requires `gnoblinctl disable osd`.

### Launcher
Centered panel at 16% from top, Super-key summoned (gnoblin keybind → `qs ipc` or
gnoblinctl script). Fuzzy search over `Apps` (frecency-ranked). **`>` command mode**
(caelestia idea, gnoblin twist): `>reload` soft-reload, `>osd off` / `>notifs on`
feature toggles, `>grants` screencast grants, `>ext <uuid>` reload extension —
all straight through the `Gnoblin` service. Kb-nav, Enter launches.

### Session
Full-screen scrim (72% ink + blur-less), 4 big spring-hover buttons: Lock (loginctl
lock-session), Log out (gnome-session-quit), Restart, Shut down (systemctl). Esc/scrim
dismisses. Danger buttons get coral hover.

## 4. gnoblin integration contract

| kobel piece | gnoblin mechanism |
|---|---|
| all surfaces | wlr-layer-shell v5 (namespace `quickshell:<module>`) |
| Notifd ownership | `SetFeature("notifications", false)` → bus name released live |
| OSD ownership | `SetFeature("osd", false)` (or per-type) |
| soft-reload button / `>reload` | `Reload()` — windows survive |
| screen-share tile | `ListScreencastGrants` / `RevokeScreencastGrant` |
| launcher summon | gnoblin keybind/script → `qs ipc call` |
| dock/workspaces | wlr-foreign-toplevel-management (gnoblin ships it) |
| dev loop | `just gnome-devkit` → host terminal → `qs -p ~/dev/kobel-shell` |

Rule: kobel *requests* ownership and hands it back on exit. gnoblin never knows kobel
exists (chrome-agnostic stays true).

## 5. Build order

1. **Foundations** — `Theme.qml`, `Visibility.qml`, `components/`; restyle existing Bar
   to the design (pill, workspace morph, clusters). *Verifiable in devkit headless (loads
   clean) + nested (visual).*
2. **Services** — Audio, Battery, Network, Bluetooth, Media, Toplevels, Apps. Each is
   UI-free → testable by logging in devkit.
3. **OSD + Notifications** — first ownership handoffs (osd, notifications features).
   The devkit can verify the bus handoff mechanically (`NameHasOwner`).
4. **Dock** — Toplevels-driven; pin config in `~/.config/kobel-shell/dock.json`.
5. **Control Centre** — tiles wired to services; gnoblin row; media card.
6. **Launcher + command mode**, then **Session**.
7. **Polish pass** — motion audit against Theme curves, multi-monitor, cold-start time,
   `>` command help, README screenshots.

Each phase: small commits, pushed; `qs -p` load-clean check in the devkit; visual/input
verification on real HW (llvmpipe won't do the shell justice — per project memory,
verify on the real instance).

## 6. Risks / honest notes

- **Quickshell Qt mismatch**: the installed quickshell (COPR) is built against Qt 6.10.1
  vs system 6.10.3 and warns it "must be rebuilt" — rebuild before trusting rendering.
- **No blur-behind**: designed around it (94% opacity). Revisit if gnoblin grows blur.
- **Workspaces**: gnome workspace state isn't in wlr-f-t-m; may need a tiny
  `org.gnoblin.Shell` addition (`ListWorkspaces` + `WorkspaceChanged`) — protocol work
  in gnoblin, small.
- **Idle inhibit / lock**: session Lock defers to GNOME's locker initially.
