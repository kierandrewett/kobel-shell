#!/usr/bin/env python3
"""Headless input injector for the kobel phase-0 spike (docs/FREYA-PLAN.md section 7).

Drives synthetic pointer + keyboard input into a headless gnoblin (mutter) session
over the private Mutter remote-desktop D-Bus API, so the INPUT half of the phase-0
gate can be proven without a human at a keyboard.

Injection path (verified against mutter's own reference consumers -- see
subprojects/gnome-control-center/.../headless/headless-input-tests.py and
src/backends/meta-remote-desktop-session.c):

  1. org.gnome.Mutter.RemoteDesktop.CreateSession()            -> RD session object
  2. read RD session SessionId property
  3. org.gnome.Mutter.ScreenCast.CreateSession(
         {"remote-desktop-session-id": <SessionId>})           -> linked SC session
  4. <SC session>.RecordMonitor("Meta-0", {})                  -> SC stream object path
  5. <RD session>.Start()   (this also starts the linked SC session + its streams;
                             the SC session must NOT be Start()ed directly -- mutter
                             errors "Must be started from remote desktop session")
  6. inject:
       NotifyPointerMotionAbsolute(<stream path>, x, y)   (stream path passed as a
                                                           plain string 's' arg -- it
                                                           is the SC stream object path)
       NotifyPointerButton(0x110 = BTN_LEFT, state)
       NotifyKeyboardKeysym(keysym, state)

Absolute pointer motion is transformed by mutter through the recorded monitor stream
(meta_screen_cast_monitor_stream_transform_position): with a headless 1280x800
virtual monitor at scale 1, stream coordinates map 1:1 to stage coordinates, so
(x, y) here are just stage pixels. That is why absolute motion needs a screencast
stream handle -- there is no other way to give mutter a coordinate space.

Uses only GLib/Gio (python3-gi); pydbus is not installed in the devkit.

Command language (argv tokens, applied in order; ':'-separated fields):

  move:X:Y        absolute pointer move to stage (X, Y)
  click:X:Y       move to (X, Y) then press+release BTN_LEFT (a full Freya on_press)
  click           press+release BTN_LEFT at the current position
  btndown / btnup press / release BTN_LEFT at the current position
  key:NAME        press+release a key (NAME: single char like 'k', an X keysym name
                  like 'Escape'/'Control_L', or a number '0x6b'/'107')
  kdown:NAME / kup:NAME   press / release a key
  wait:MS         sleep MS milliseconds
  screenshot:PATH capture the full stage through org.gnome.Shell.Screenshot

With no command tokens the built-in phase-0 script runs (see DEFAULT_SCRIPT): click
the top-bar strip, then 'k' three times (cycles keyboard-interactivity
OnDemand -> Exclusive -> None -> OnDemand), then Escape (clean exit).

Options:
  --connector NAME     monitor connector to record (default: Meta-0)
  --settle MS          default inter-command sleep in milliseconds when a step has no
                       explicit wait (default 250)
  --settle-prime SECS  seconds to wait after priming the virtual devices, before the
                       first real move/click, so the client can process the seat
                       capability event and bind wl_pointer/wl_keyboard (default 1.5).
                       Without this the first input races the bind and is dropped.
"""

from __future__ import annotations

import sys
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

RD_DEST = "org.gnome.Mutter.RemoteDesktop"
RD_PATH = "/org/gnome/Mutter/RemoteDesktop"
RD_IFACE = "org.gnome.Mutter.RemoteDesktop"
RD_SESSION_IFACE = "org.gnome.Mutter.RemoteDesktop.Session"

SC_DEST = "org.gnome.Mutter.ScreenCast"
SC_PATH = "/org/gnome/Mutter/ScreenCast"
SC_IFACE = "org.gnome.Mutter.ScreenCast"
SC_SESSION_IFACE = "org.gnome.Mutter.ScreenCast.Session"

SHELL_SCREENSHOT_DEST = "org.gnome.Shell.Screenshot"
SHELL_SCREENSHOT_PATH = "/org/gnome/Shell/Screenshot"
SHELL_SCREENSHOT_IFACE = "org.gnome.Shell.Screenshot"
PROPS_IFACE = "org.freedesktop.DBus.Properties"

BTN_LEFT = 0x110
BTN_RIGHT = 0x111

# X keysyms we need by name (XK_*). Anything else is taken as a literal number or,
# for a single printable character, its ordinal (which equals the keysym for the
# ASCII/Latin-1 range, e.g. 'k' -> 0x6b).
KEYSYMS = {
    "Escape": 0xFF1B,
    "Return": 0xFF0D,
    "Tab": 0xFF09,
    "BackSpace": 0xFF08,
    "Left": 0xFF51,
    "Up": 0xFF52,
    "Right": 0xFF53,
    "Down": 0xFF54,
    "space": 0x0020,
    "Control_L": 0xFFE3,
    "Control_R": 0xFFE4,
    "Shift_L": 0xFFE1,
    "Shift_R": 0xFFE2,
    "Super_L": 0xFFEB,
}

# Built-in phase-0 gate script. Coordinates are stage pixels. The spike surface is a
# top-bar strip anchored TOP+LEFT+RIGHT with top/left/right margins 10/12/12 and
# height 120, i.e. it covers roughly x in [12, 1268], y in [10, 130] on a 1280x800
# monitor. (120, 70) is safely inside it and to the left of the centered button, so a
# click there hits the root rect's on_press exactly once.
DEFAULT_SCRIPT = [
    "click:120:70",
    "wait:500",
    "key:k",     # OnDemand -> Exclusive
    "wait:400",
    "key:k",     # Exclusive -> None
    "wait:400",
    "key:k",     # None -> OnDemand
    "wait:400",
    "key:Escape",  # clean exit
    "wait:400",
]


def log(msg: str) -> None:
    print(f"[inject] {msg}", flush=True)


def keysym_of(name: str) -> int:
    if name in KEYSYMS:
        return KEYSYMS[name]
    try:
        return int(name, 0)
    except ValueError:
        pass
    if len(name) == 1:
        return ord(name)
    raise SystemExit(f"[inject] unknown keysym: {name!r}")


class Injector:
    def __init__(self, connector: str, settle_after_prime: float = 1.5) -> None:
        self.connector = connector
        self.settle_after_prime = settle_after_prime
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.rd_session_path: str | None = None
        self.sc_session_path: str | None = None
        self.stream_path: str | None = None

    def _call(self, dest, path, iface, method, params, reply_type):
        rt = GLib.VariantType.new(reply_type) if reply_type else None
        return self.bus.call_sync(
            dest, path, iface, method, params, rt,
            Gio.DBusCallFlags.NONE, 15000, None,
        )

    def setup(self) -> None:
        # Wait for the private RemoteDesktop API to be available (shell just booted).
        last_err = None
        for attempt in range(60):
            try:
                res = self._call(RD_DEST, RD_PATH, RD_IFACE, "CreateSession", None, "(o)")
                self.rd_session_path = res.unpack()[0]
                break
            except GLib.Error as e:  # noqa: PERF203
                last_err = e
                time.sleep(0.5)
        if self.rd_session_path is None:
            raise SystemExit(f"[inject] RemoteDesktop.CreateSession failed: {last_err}")
        log(f"RemoteDesktop session {self.rd_session_path}")

        res = self._call(
            RD_DEST, self.rd_session_path, PROPS_IFACE, "Get",
            GLib.Variant("(ss)", (RD_SESSION_IFACE, "SessionId")), "(v)",
        )
        session_id = res.unpack()[0]
        log(f"SessionId {session_id!r}")

        props = {"remote-desktop-session-id": GLib.Variant("s", session_id)}
        res = self._call(
            SC_DEST, SC_PATH, SC_IFACE, "CreateSession",
            GLib.Variant("(a{sv})", (props,)), "(o)",
        )
        self.sc_session_path = res.unpack()[0]
        log(f"ScreenCast session {self.sc_session_path}")

        res = self._call(
            SC_DEST, self.sc_session_path, SC_SESSION_IFACE, "RecordMonitor",
            GLib.Variant("(sa{sv})", (self.connector, {})), "(o)",
        )
        self.stream_path = res.unpack()[0]
        log(f"stream {self.stream_path} (connector {self.connector})")

        # Starting the RD session also starts the linked screen-cast session/streams.
        self._call(RD_DEST, self.rd_session_path, RD_SESSION_IFACE, "Start", None, "()")
        log("RemoteDesktop session started")

        # Work around lazily-created virtual devices: a first keyboard tap + a pointer
        # move off-screen make mutter instantiate the virtual keyboard/pointer before
        # the real sequence (mirrors gnome's own headless-input-tests.py).
        self._keysym(KEYSYMS["Control_L"], True)
        self._keysym(KEYSYMS["Control_L"], False)
        self._motion(-100.0, -100.0)
        log("virtual devices primed")
        # Priming is what makes mutter add pointer/keyboard capabilities to the seat;
        # the client only creates its wl_pointer/wl_keyboard reactively when it sees
        # that capability event. Give it time to process the capability roundtrip and
        # bind those objects, otherwise the first move/click/keys race the bind and are
        # dropped (no wl_pointer resource yet -> no enter, no press, no kb focus).
        time.sleep(self.settle_after_prime)
        log("settled after priming")

    def _motion(self, x: float, y: float) -> None:
        self._call(
            RD_DEST, self.rd_session_path, RD_SESSION_IFACE,
            "NotifyPointerMotionAbsolute",
            GLib.Variant("(sdd)", (self.stream_path, float(x), float(y))), "()",
        )

    def _button(self, button: int, state: bool) -> None:
        self._call(
            RD_DEST, self.rd_session_path, RD_SESSION_IFACE, "NotifyPointerButton",
            GLib.Variant("(ib)", (button, state)), "()",
        )

    def _keysym(self, keysym: int, state: bool) -> None:
        self._call(
            RD_DEST, self.rd_session_path, RD_SESSION_IFACE, "NotifyKeyboardKeysym",
            GLib.Variant("(ub)", (keysym, state)), "()",
        )

    def run(self, script: list[str], settle_ms: int) -> None:
        for cmd in script:
            parts = cmd.split(":")
            op = parts[0]
            explicit_wait = False
            if op == "move":
                x, y = float(parts[1]), float(parts[2])
                log(f"move {x} {y}")
                self._motion(x, y)
            elif op == "click":
                if len(parts) >= 3:
                    x, y = float(parts[1]), float(parts[2])
                    log(f"move {x} {y}")
                    self._motion(x, y)
                    time.sleep(0.08)
                log("click BTN_LEFT")
                self._button(BTN_LEFT, True)
                time.sleep(0.05)
                self._button(BTN_LEFT, False)
            elif op == "rclick":
                if len(parts) >= 3:
                    x, y = float(parts[1]), float(parts[2])
                    log(f"move {x} {y}")
                    self._motion(x, y)
                    time.sleep(0.08)
                log("click BTN_RIGHT")
                self._button(BTN_RIGHT, True)
                time.sleep(0.05)
                self._button(BTN_RIGHT, False)
            elif op == "btndown":
                log("btndown BTN_LEFT")
                self._button(BTN_LEFT, True)
            elif op == "btnup":
                log("btnup BTN_LEFT")
                self._button(BTN_LEFT, False)
            elif op == "key":
                ks = keysym_of(parts[1])
                log(f"key {parts[1]} (0x{ks:x})")
                self._keysym(ks, True)
                time.sleep(0.05)
                self._keysym(ks, False)
            elif op == "kdown":
                ks = keysym_of(parts[1])
                log(f"kdown {parts[1]} (0x{ks:x})")
                self._keysym(ks, True)
            elif op == "kup":
                ks = keysym_of(parts[1])
                log(f"kup {parts[1]} (0x{ks:x})")
                self._keysym(ks, False)
            elif op == "screenshot":
                path = parts[1]
                result = self._call(
                    SHELL_SCREENSHOT_DEST,
                    SHELL_SCREENSHOT_PATH,
                    SHELL_SCREENSHOT_IFACE,
                    "Screenshot",
                    GLib.Variant("(bbs)", (False, False, path)),
                    "(bs)",
                )
                success, written_path = result.unpack()
                if not success:
                    raise SystemExit(f"[inject] screenshot failed: {path}")
                log(f"screenshot {written_path}")
            elif op == "wait":
                ms = int(parts[1])
                log(f"wait {ms}ms")
                time.sleep(ms / 1000.0)
                explicit_wait = True
            else:
                raise SystemExit(f"[inject] unknown command: {cmd!r}")
            if not explicit_wait:
                time.sleep(settle_ms / 1000.0)

    def teardown(self) -> None:
        if self.rd_session_path is not None:
            try:
                self._call(RD_DEST, self.rd_session_path, RD_SESSION_IFACE, "Stop", None, "()")
                log("RemoteDesktop session stopped")
            except GLib.Error as e:
                log(f"Stop failed (ignored): {e}")


USAGE = """usage: devkit_input.py [--connector NAME] [--settle MS] [--settle-prime S] [ACTION ...]

Actions (colon-separated args): move:X:Y  click[:X:Y]  rclick[:X:Y]  btndown  btnup
  key:NAME  kdown:NAME  kup:NAME  wait:MS  screenshot:PATH
No actions -> the built-in spike sequence. Runs against the CURRENT session
bus and creates a Mutter RemoteDesktop session: devkit sessions only.
"""


def main(argv: list[str]) -> int:
    connector = "Meta-0"
    settle_ms = 250
    settle_prime = 1.5
    script: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            # Side-effect free: exits before any bus connection or session setup.
            print(USAGE, end="")
            return 0
        if a.startswith("--") and a not in ("--connector", "--settle", "--settle-prime"):
            print(USAGE, end="", file=sys.stderr)
            print(f"[inject] unknown flag: {a}", file=sys.stderr)
            return 2
        if a == "--connector":
            connector = argv[i + 1]
            i += 2
        elif a == "--settle":
            settle_ms = int(argv[i + 1])
            i += 2
        elif a == "--settle-prime":
            settle_prime = float(argv[i + 1])
            i += 2
        else:
            script.append(a)
            i += 1
    if not script:
        script = DEFAULT_SCRIPT

    inj = Injector(connector, settle_after_prime=settle_prime)
    inj.setup()
    try:
        inj.run(script, settle_ms)
    finally:
        inj.teardown()
    log("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
