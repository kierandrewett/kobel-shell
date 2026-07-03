# kobel-shell

A [Quickshell](https://quickshell.org) configuration for **[gnoblin](https://github.com/kierandrewett/gnoblin)** —
Kieran's patched GNOME Shell + Mutter desktop.

gnoblin is *just GNOME + mutter*: it strips its own top bar, overview and dash, and
exposes `wlr-layer-shell` plus the `org.gnoblin.Shell` control protocol. It draws no
chrome itself — that's bring-your-own. **kobel-shell is that chrome.**

> The name `kobel` was taken (an unrelated Smithay compositor), so this lives at
> `kobel-shell`.

## Layout

```
shell.qml            entry point — one Bar per monitor
modules/Bar.qml      a minimal top bar (wlr-layer-shell surface, namespace quickshell:bar)
services/Gnoblin.qml singleton over gnoblin's control protocol (via gnoblinctl)
```

## Run

Needs a running **gnoblin** session (patched gnome-shell + mutter) and `gnoblinctl`
on `PATH`.

**Easiest (nested devkit).** From the gnoblin repo, `just gnome-devkit` opens a nested
gnoblin session + a terminal wired to it. In that terminal:

```sh
qs -p ~/dev/kobel-shell
```

and the bar appears inside the nested gnoblin.

**Real session.** In a gnoblin session:

```sh
qs -p ~/dev/kobel-shell
# or register it: ln -s ~/dev/kobel-shell ~/.config/quickshell/kobel-shell && qs -c kobel-shell
```

Click the "gnoblin" badge in the bar to trigger a **Wayland soft-reload** (theme +
extensions + scripts reload in-place; your windows survive).

## The `Gnoblin` service

`services/Gnoblin.qml` wraps `org.gnoblin.Shell` (currently by shelling out to
`gnoblinctl`; a native D-Bus / `Quickshell.Gnoblin` plugin can replace it later):

- `Gnoblin.reload()` — Wayland soft-reload.
- `Gnoblin.disable("osd")` / `Gnoblin.enable("osd")` — hand a gnome subsystem to your
  chrome (or back). Toggleable: `osd` (+ `osd-volume`/`osd-microphone`/`osd-brightness`/
  `osd-keyboard-brightness`), `screenshot`, `notifications`.
- `Gnoblin.reloadScripts()`, `Gnoblin.reloadExtension(uuid)`.

As you build a module that owns a subsystem (e.g. your own notification daemon or
OSD), disable the matching gnome one so they don't both appear.

## Roadmap

- Modules: dock, launcher, notifications, OSD, control center.
- Workspaces + window list via gnoblin's `wlr-foreign-toplevel-management`.
- A native `Quickshell.Gnoblin` plugin (typed workspaces / IPC events / global
  shortcuts, à la `Quickshell.Hyprland`) in its own repo, backed by `org.gnoblin.*`.
