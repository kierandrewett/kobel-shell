# kobel-shell

An AGS/Astal GTK4 shell for **[gnoblin](https://github.com/kierandrewett/gnoblin)**, Kieran's
patched GNOME Shell + Mutter desktop.

gnoblin is *just GNOME + mutter*: it strips its own top bar, overview and dash, and
exposes `wlr-layer-shell` plus the `org.gnoblin.Shell` control protocol. It draws no
chrome itself — that's bring-your-own. **kobel-shell is that chrome.**

> The name `kobel` was taken (an unrelated Smithay compositor), so this lives at
> `kobel-shell`.

## Layout

```
ags/                 active AGS/Astal GTK4 shell implementation
  app.ts             entry point - bar, dock, launcher, QS, notifications, OSD, session
  widget/            shell surfaces
  services/gnoblin.ts wrapper over gnoblin's control protocol
shell.qml            older Quickshell/QML sketch kept as reference, not the active path
```

## Run

Needs a running **gnoblin** session (patched gnome-shell + mutter) and `gnoblinctl`
on `PATH`.

**Easiest interactive path.** From this repo:

```sh
INTERACTIVE=1 ./ags/scripts/run-in-gnoblin.sh
```

That opens a visible nested gnoblin devkit window and runs the AGS shell inside it until
you stop the command with `Ctrl-C`.

**Manual devkit path.** From the gnoblin repo, `just gnome-devkit` opens a nested
gnoblin session + a terminal wired to it. In that terminal:

```sh
cd ~/dev/kobel-shell/ags
ags run .
```

**Real session.** In a gnoblin session:

```sh
cd ~/dev/kobel-shell/ags
ags run .
```

Click the "gnoblin" badge in the bar to trigger a **Wayland soft-reload** (theme +
extensions + scripts reload in-place; your windows survive).

## The `Gnoblin` service

`ags/services/gnoblin.ts` wraps `org.gnoblin.Shell`:

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
