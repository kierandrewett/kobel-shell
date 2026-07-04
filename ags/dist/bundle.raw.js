// ../../../../../usr/share/astal/gjs/gtk4/index.ts
import Astal6 from "gi://Astal?version=4.0";
import Gtk4 from "gi://Gtk?version=4.0";
import Gdk2 from "gi://Gdk?version=4.0";

// ../../../../../usr/share/astal/gjs/variable.ts
import Astal3 from "gi://AstalIO";

// ../../../../../usr/share/astal/gjs/binding.ts
var snakeify = (str) => str.replace(/([a-z])([A-Z])/g, "$1_$2").replaceAll("-", "_").toLowerCase();
var kebabify = (str) => str.replace(/([a-z])([A-Z])/g, "$1-$2").replaceAll("_", "-").toLowerCase();
var Binding = class _Binding {
  transformFn = (v) => v;
  #emitter;
  #prop;
  static bind(emitter, prop) {
    return new _Binding(emitter, prop);
  }
  constructor(emitter, prop) {
    this.#emitter = emitter;
    this.#prop = prop && kebabify(prop);
  }
  toString() {
    return `Binding<${this.#emitter}${this.#prop ? `, "${this.#prop}"` : ""}>`;
  }
  as(fn) {
    const bind2 = new _Binding(this.#emitter, this.#prop);
    bind2.transformFn = (v) => fn(this.transformFn(v));
    return bind2;
  }
  get() {
    if (typeof this.#emitter.get === "function")
      return this.transformFn(this.#emitter.get());
    if (typeof this.#prop === "string") {
      const getter = `get_${snakeify(this.#prop)}`;
      if (typeof this.#emitter[getter] === "function")
        return this.transformFn(this.#emitter[getter]());
      return this.transformFn(this.#emitter[this.#prop]);
    }
    throw Error("can not get value of binding");
  }
  subscribe(callback) {
    if (typeof this.#emitter.subscribe === "function") {
      return this.#emitter.subscribe(() => {
        callback(this.get());
      });
    } else if (typeof this.#emitter.connect === "function") {
      const signal = `notify::${this.#prop}`;
      const id = this.#emitter.connect(signal, () => {
        callback(this.get());
      });
      return () => {
        this.#emitter.disconnect(id);
      };
    }
    throw Error(`${this.#emitter} is not bindable`);
  }
};
var { bind } = Binding;
var binding_default = Binding;

// ../../../../../usr/share/astal/gjs/time.ts
import Astal from "gi://AstalIO";
var Time = Astal.Time;
function interval(interval2, callback) {
  return Astal.Time.interval(interval2, () => void callback?.());
}
function timeout(timeout2, callback) {
  return Astal.Time.timeout(timeout2, () => void callback?.());
}

// ../../../../../usr/share/astal/gjs/process.ts
import Astal2 from "gi://AstalIO";
var Process = Astal2.Process;
function subprocess(argsOrCmd, onOut = print, onErr = printerr) {
  const args = Array.isArray(argsOrCmd) || typeof argsOrCmd === "string";
  const { cmd, err, out } = {
    cmd: args ? argsOrCmd : argsOrCmd.cmd,
    err: args ? onErr : argsOrCmd.err || onErr,
    out: args ? onOut : argsOrCmd.out || onOut
  };
  const proc = Array.isArray(cmd) ? Astal2.Process.subprocessv(cmd) : Astal2.Process.subprocess(cmd);
  proc.connect("stdout", (_, stdout) => out(stdout));
  proc.connect("stderr", (_, stderr) => err(stderr));
  return proc;
}
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    if (Array.isArray(cmd)) {
      Astal2.Process.exec_asyncv(cmd, (_, res) => {
        try {
          resolve(Astal2.Process.exec_asyncv_finish(res));
        } catch (error) {
          reject(error);
        }
      });
    } else {
      Astal2.Process.exec_async(cmd, (_, res) => {
        try {
          resolve(Astal2.Process.exec_finish(res));
        } catch (error) {
          reject(error);
        }
      });
    }
  });
}

// ../../../../../usr/share/astal/gjs/variable.ts
var VariableWrapper = class extends Function {
  variable;
  errHandler = console.error;
  _value;
  _poll;
  _watch;
  pollInterval = 1e3;
  pollExec;
  pollTransform;
  pollFn;
  watchTransform;
  watchExec;
  constructor(init3) {
    super();
    this._value = init3;
    this.variable = new Astal3.VariableBase();
    this.variable.connect("dropped", () => {
      this.stopWatch();
      this.stopPoll();
    });
    this.variable.connect("error", (_, err) => this.errHandler?.(err));
    return new Proxy(this, {
      apply: (target, _, args) => target._call(args[0])
    });
  }
  _call(transform) {
    const b = binding_default.bind(this);
    return transform ? b.as(transform) : b;
  }
  toString() {
    return String(`Variable<${this.get()}>`);
  }
  get() {
    return this._value;
  }
  set(value) {
    if (value !== this._value) {
      this._value = value;
      this.variable.emit("changed");
    }
  }
  startPoll() {
    if (this._poll)
      return;
    if (this.pollFn) {
      this._poll = interval(this.pollInterval, () => {
        const v = this.pollFn(this.get());
        if (v instanceof Promise) {
          v.then((v2) => this.set(v2)).catch((err) => this.variable.emit("error", err));
        } else {
          this.set(v);
        }
      });
    } else if (this.pollExec) {
      this._poll = interval(this.pollInterval, () => {
        execAsync(this.pollExec).then((v) => this.set(this.pollTransform(v, this.get()))).catch((err) => this.variable.emit("error", err));
      });
    }
  }
  startWatch() {
    if (this._watch)
      return;
    this._watch = subprocess({
      cmd: this.watchExec,
      out: (out) => this.set(this.watchTransform(out, this.get())),
      err: (err) => this.variable.emit("error", err)
    });
  }
  stopPoll() {
    this._poll?.cancel();
    delete this._poll;
  }
  stopWatch() {
    this._watch?.kill();
    delete this._watch;
  }
  isPolling() {
    return !!this._poll;
  }
  isWatching() {
    return !!this._watch;
  }
  drop() {
    this.variable.emit("dropped");
  }
  onDropped(callback) {
    this.variable.connect("dropped", callback);
    return this;
  }
  onError(callback) {
    delete this.errHandler;
    this.variable.connect("error", (_, err) => callback(err));
    return this;
  }
  subscribe(callback) {
    const id = this.variable.connect("changed", () => {
      callback(this.get());
    });
    return () => this.variable.disconnect(id);
  }
  poll(interval2, exec, transform = (out) => out) {
    this.stopPoll();
    this.pollInterval = interval2;
    this.pollTransform = transform;
    if (typeof exec === "function") {
      this.pollFn = exec;
      delete this.pollExec;
    } else {
      this.pollExec = exec;
      delete this.pollFn;
    }
    this.startPoll();
    return this;
  }
  watch(exec, transform = (out) => out) {
    this.stopWatch();
    this.watchExec = exec;
    this.watchTransform = transform;
    this.startWatch();
    return this;
  }
  observe(objs, sigOrFn, callback) {
    const f = typeof sigOrFn === "function" ? sigOrFn : callback ?? (() => this.get());
    const set = (obj, ...args) => this.set(f(obj, ...args));
    if (Array.isArray(objs)) {
      for (const obj of objs) {
        const [o, s] = obj;
        const id = o.connect(s, set);
        this.onDropped(() => o.disconnect(id));
      }
    } else {
      if (typeof sigOrFn === "string") {
        const id = objs.connect(sigOrFn, set);
        this.onDropped(() => objs.disconnect(id));
      }
    }
    return this;
  }
  static derive(deps, fn = (...args) => args) {
    const update = () => fn(...deps.map((d) => d.get()));
    const derived = new Variable(update());
    const unsubs = deps.map((dep) => dep.subscribe(() => derived.set(update())));
    derived.onDropped(() => unsubs.map((unsub) => unsub()));
    return derived;
  }
};
var Variable = new Proxy(VariableWrapper, {
  apply: (_t, _a, args) => new VariableWrapper(args[0])
});
var { derive } = Variable;
var variable_default = Variable;

// ../../../../../usr/share/astal/gjs/_astal.ts
var noImplicitDestroy = Symbol("no no implicit destroy");
var setChildren = Symbol("children setter method");
function mergeBindings(array) {
  function getValues(...args) {
    let i = 0;
    return array.map(
      (value) => value instanceof binding_default ? args[i++] : value
    );
  }
  const bindings = array.filter((i) => i instanceof binding_default);
  if (bindings.length === 0)
    return array;
  if (bindings.length === 1)
    return bindings[0].as(getValues);
  return variable_default.derive(bindings, getValues)();
}
function setProp(obj, prop, value) {
  try {
    const setter = `set_${snakeify(prop)}`;
    if (typeof obj[setter] === "function")
      return obj[setter](value);
    return obj[prop] = value;
  } catch (error) {
    console.error(`could not set property "${prop}" on ${obj}:`, error);
  }
}
function construct(widget, config) {
  let { setup, child, children = [], ...props } = config;
  if (children instanceof binding_default) {
    children = [children];
  }
  if (child) {
    children.unshift(child);
  }
  for (const [key2, value] of Object.entries(props)) {
    if (value === void 0) {
      delete props[key2];
    }
  }
  const bindings = Object.keys(props).reduce((acc, prop) => {
    if (props[prop] instanceof binding_default) {
      const binding = props[prop];
      delete props[prop];
      return [...acc, [prop, binding]];
    }
    return acc;
  }, []);
  const onHandlers = Object.keys(props).reduce((acc, key2) => {
    if (key2.startsWith("on")) {
      const sig = kebabify(key2).split("-").slice(1).join("-");
      const handler = props[key2];
      delete props[key2];
      return [...acc, [sig, handler]];
    }
    return acc;
  }, []);
  const mergedChildren = mergeBindings(children.flat(Infinity));
  if (mergedChildren instanceof binding_default) {
    widget[setChildren](mergedChildren.get());
    widget.connect("destroy", mergedChildren.subscribe((v) => {
      widget[setChildren](v);
    }));
  } else {
    if (mergedChildren.length > 0) {
      widget[setChildren](mergedChildren);
    }
  }
  for (const [signal, callback] of onHandlers) {
    const sig = signal.startsWith("notify") ? signal.replace("-", "::") : signal;
    if (typeof callback === "function") {
      widget.connect(sig, callback);
    } else {
      widget.connect(sig, () => execAsync(callback).then(print).catch(console.error));
    }
  }
  for (const [prop, binding] of bindings) {
    if (prop === "child" || prop === "children") {
      widget.connect("destroy", binding.subscribe((v) => {
        widget[setChildren](v);
      }));
    }
    widget.connect("destroy", binding.subscribe((v) => {
      setProp(widget, prop, v);
    }));
    setProp(widget, prop, binding.get());
  }
  for (const [key2, value] of Object.entries(props)) {
    if (value === void 0) {
      delete props[key2];
    }
  }
  Object.assign(widget, props);
  setup?.(widget);
  return widget;
}
function isArrowFunction(func) {
  return !Object.hasOwn(func, "prototype");
}
function jsx(ctors2, ctor, { children, ...props }) {
  children ??= [];
  if (!Array.isArray(children))
    children = [children];
  children = children.filter(Boolean);
  if (children.length === 1)
    props.child = children[0];
  else if (children.length > 1)
    props.children = children;
  if (typeof ctor === "string") {
    if (isArrowFunction(ctors2[ctor]))
      return ctors2[ctor](props);
    return new ctors2[ctor](props);
  }
  if (isArrowFunction(ctor))
    return ctor(props);
  return new ctor(props);
}

// ../../../../../usr/share/astal/gjs/gtk4/astalify.ts
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
var type = Symbol("child type");
var dummyBulder = new Gtk.Builder();
function _getChildren(widget) {
  if ("get_child" in widget && typeof widget.get_child == "function") {
    return widget.get_child() ? [widget.get_child()] : [];
  }
  const children = [];
  let ch = widget.get_first_child();
  while (ch !== null) {
    children.push(ch);
    ch = ch.get_next_sibling();
  }
  return children;
}
function _setChildren(widget, children) {
  children = children.flat(Infinity).map((ch) => ch instanceof Gtk.Widget ? ch : new Gtk.Label({ visible: true, label: String(ch) }));
  for (const child of children) {
    widget.vfunc_add_child(
      dummyBulder,
      child,
      type in child ? child[type] : null
    );
  }
}
function astalify(cls, config = {}) {
  Object.assign(cls.prototype, {
    [setChildren](children) {
      const w = this;
      for (const child of config.getChildren?.(w) || _getChildren(w)) {
        if (child instanceof Gtk.Widget) {
          child.unparent();
          if (!children.includes(child) && noImplicitDestroy in this)
            child.run_dispose();
        }
      }
      if (config.setChildren) {
        config.setChildren(w, children);
      } else {
        _setChildren(w, children);
      }
    }
  });
  return {
    [cls.name]: (props = {}, ...children) => {
      const widget = new cls("cssName" in props ? { cssName: props.cssName } : {});
      if ("cssName" in props) {
        delete props.cssName;
      }
      if (props.noImplicitDestroy) {
        Object.assign(widget, { [noImplicitDestroy]: true });
        delete props.noImplicitDestroy;
      }
      if (props.type) {
        Object.assign(widget, { [type]: props.type });
        delete props.type;
      }
      if (children.length > 0) {
        Object.assign(props, { children });
      }
      return construct(widget, setupControllers(widget, props));
    }
  }[cls.name];
}
function setupControllers(widget, {
  onFocusEnter,
  onFocusLeave,
  onKeyPressed,
  onKeyReleased,
  onKeyModifier,
  onLegacy,
  onButtonPressed,
  onButtonReleased,
  onHoverEnter,
  onHoverLeave,
  onMotion,
  onScroll,
  onScrollDecelerate,
  ...props
}) {
  if (onFocusEnter || onFocusLeave) {
    const focus = new Gtk.EventControllerFocus();
    widget.add_controller(focus);
    if (onFocusEnter)
      focus.connect("enter", () => onFocusEnter(widget));
    if (onFocusLeave)
      focus.connect("leave", () => onFocusLeave(widget));
  }
  if (onKeyPressed || onKeyReleased || onKeyModifier) {
    const key2 = new Gtk.EventControllerKey();
    widget.add_controller(key2);
    if (onKeyPressed)
      key2.connect("key-pressed", (_, val, code, state) => onKeyPressed(widget, val, code, state));
    if (onKeyReleased)
      key2.connect("key-released", (_, val, code, state) => onKeyReleased(widget, val, code, state));
    if (onKeyModifier)
      key2.connect("modifiers", (_, state) => onKeyModifier(widget, state));
  }
  if (onLegacy || onButtonPressed || onButtonReleased) {
    const legacy = new Gtk.EventControllerLegacy();
    widget.add_controller(legacy);
    legacy.connect("event", (_, event) => {
      if (event.get_event_type() === Gdk.EventType.BUTTON_PRESS) {
        onButtonPressed?.(widget, event);
      }
      if (event.get_event_type() === Gdk.EventType.BUTTON_RELEASE) {
        onButtonReleased?.(widget, event);
      }
      onLegacy?.(widget, event);
    });
  }
  if (onMotion || onHoverEnter || onHoverLeave) {
    const hover = new Gtk.EventControllerMotion();
    widget.add_controller(hover);
    if (onHoverEnter)
      hover.connect("enter", (_, x, y) => onHoverEnter(widget, x, y));
    if (onHoverLeave)
      hover.connect("leave", () => onHoverLeave(widget));
    if (onMotion)
      hover.connect("motion", (_, x, y) => onMotion(widget, x, y));
  }
  if (onScroll || onScrollDecelerate) {
    const scroll = new Gtk.EventControllerScroll();
    scroll.flags = Gtk.EventControllerScrollFlags.BOTH_AXES | Gtk.EventControllerScrollFlags.KINETIC;
    widget.add_controller(scroll);
    if (onScroll)
      scroll.connect("scroll", (_, x, y) => onScroll(widget, x, y));
    if (onScrollDecelerate)
      scroll.connect("decelerate", (_, x, y) => onScrollDecelerate(widget, x, y));
  }
  return props;
}

// ../../../../../usr/share/astal/gjs/gtk4/app.ts
import GLib from "gi://GLib?version=2.0";
import Gtk2 from "gi://Gtk?version=4.0";
import Astal4 from "gi://Astal?version=4.0";

// ../../../../../usr/share/astal/gjs/overrides.ts
var snakeify2 = (str) => str.replace(/([a-z])([A-Z])/g, "$1_$2").replaceAll("-", "_").toLowerCase();
async function suppress(mod, patch2) {
  return mod.then((m) => patch2(m.default)).catch(() => void 0);
}
function patch(proto, prop) {
  Object.defineProperty(proto, prop, {
    get() {
      return this[`get_${snakeify2(prop)}`]();
    }
  });
}
await suppress(import("gi://AstalApps"), ({ Apps: Apps3, Application }) => {
  patch(Apps3.prototype, "list");
  patch(Application.prototype, "keywords");
  patch(Application.prototype, "categories");
});
await suppress(import("gi://AstalBattery"), ({ UPower }) => {
  patch(UPower.prototype, "devices");
});
await suppress(import("gi://AstalBluetooth"), ({ Adapter, Bluetooth: Bluetooth2, Device }) => {
  patch(Adapter.prototype, "uuids");
  patch(Bluetooth2.prototype, "adapters");
  patch(Bluetooth2.prototype, "devices");
  patch(Device.prototype, "uuids");
});
await suppress(import("gi://AstalHyprland"), ({ Hyprland, Monitor, Workspace }) => {
  patch(Hyprland.prototype, "binds");
  patch(Hyprland.prototype, "monitors");
  patch(Hyprland.prototype, "workspaces");
  patch(Hyprland.prototype, "clients");
  patch(Monitor.prototype, "availableModes");
  patch(Monitor.prototype, "available_modes");
  patch(Workspace.prototype, "clients");
});
await suppress(import("gi://AstalMpris"), ({ Mpris: Mpris4, Player }) => {
  patch(Mpris4.prototype, "players");
  patch(Player.prototype, "supported_uri_schemes");
  patch(Player.prototype, "supportedUriSchemes");
  patch(Player.prototype, "supported_mime_types");
  patch(Player.prototype, "supportedMimeTypes");
  patch(Player.prototype, "comments");
});
await suppress(import("gi://AstalNetwork"), ({ Wifi }) => {
  patch(Wifi.prototype, "access_points");
  patch(Wifi.prototype, "accessPoints");
});
await suppress(import("gi://AstalNotifd"), ({ Notifd: Notifd3, Notification }) => {
  patch(Notifd3.prototype, "notifications");
  patch(Notification.prototype, "actions");
});
await suppress(import("gi://AstalPowerProfiles"), ({ PowerProfiles }) => {
  patch(PowerProfiles.prototype, "actions");
});
await suppress(import("gi://AstalWp"), ({ Wp: Wp4, Audio, Video }) => {
  patch(Wp4.prototype, "endpoints");
  patch(Wp4.prototype, "devices");
  patch(Audio.prototype, "streams");
  patch(Audio.prototype, "recorders");
  patch(Audio.prototype, "microphones");
  patch(Audio.prototype, "speakers");
  patch(Audio.prototype, "devices");
  patch(Video.prototype, "streams");
  patch(Video.prototype, "recorders");
  patch(Video.prototype, "sinks");
  patch(Video.prototype, "sources");
  patch(Video.prototype, "devices");
});

// ../../../../../usr/share/astal/gjs/_app.ts
import { setConsoleLogDomain } from "console";
import { exit, programArgs } from "system";
import IO from "gi://AstalIO";
import GObject from "gi://GObject";
function mkApp(App4) {
  return new class AstalJS extends App4 {
    static {
      GObject.registerClass({ GTypeName: "AstalJS" }, this);
    }
    eval(body) {
      return new Promise((res, rej) => {
        try {
          const fn = Function(`return (async function() {
                        ${body.includes(";") ? body : `return ${body};`}
                    })`);
          fn()().then(res).catch(rej);
        } catch (error) {
          rej(error);
        }
      });
    }
    requestHandler;
    vfunc_request(msg, conn) {
      if (typeof this.requestHandler === "function") {
        this.requestHandler(msg, (response) => {
          IO.write_sock(
            conn,
            String(response),
            (_, res) => IO.write_sock_finish(res)
          );
        });
      } else {
        super.vfunc_request(msg, conn);
      }
    }
    apply_css(style, reset = false) {
      super.apply_css(style, reset);
    }
    quit(code) {
      super.quit();
      exit(code ?? 0);
    }
    start({ requestHandler, css, hold, main, client, icons, ...cfg } = {}) {
      const app = this;
      client ??= () => {
        print(`Astal instance "${app.instanceName}" already running`);
        exit(1);
      };
      Object.assign(this, cfg);
      setConsoleLogDomain(app.instanceName);
      this.requestHandler = requestHandler;
      app.connect("activate", () => {
        main?.(...programArgs);
      });
      try {
        app.acquire_socket();
      } catch (error) {
        return client((msg) => IO.send_request(app.instanceName, msg), ...programArgs);
      }
      if (css)
        this.apply_css(css, false);
      if (icons)
        app.add_icons(icons);
      hold ??= true;
      if (hold)
        app.hold();
      app.runAsync([]);
    }
  }();
}

// ../../../../../usr/share/astal/gjs/gtk4/app.ts
Gtk2.init();
GLib.unsetenv("LD_PRELOAD");
await import("gi://Adw?version=1").then(({ default: Adw }) => Adw.init()).catch(() => void 0);
var app_default = mkApp(Astal4.Application);

// ../../../../../usr/share/astal/gjs/gtk4/widget.ts
import Astal5 from "gi://Astal?version=4.0";
import Gtk3 from "gi://Gtk?version=4.0";
function filter(children) {
  return children.flat(Infinity).map((ch) => ch instanceof Gtk3.Widget ? ch : new Gtk3.Label({ visible: true, label: String(ch) }));
}
Object.defineProperty(Astal5.Box.prototype, "children", {
  get() {
    return this.get_children();
  },
  set(v) {
    this.set_children(v);
  }
});
var Box = astalify(Astal5.Box, {
  getChildren(self) {
    return self.get_children();
  },
  setChildren(self, children) {
    return self.set_children(filter(children));
  }
});
var Button = astalify(Gtk3.Button);
var CenterBox = astalify(Gtk3.CenterBox, {
  getChildren(box) {
    return [box.startWidget, box.centerWidget, box.endWidget];
  },
  setChildren(box, children) {
    const ch = filter(children);
    box.startWidget = ch[0] || new Gtk3.Box();
    box.centerWidget = ch[1] || new Gtk3.Box();
    box.endWidget = ch[2] || new Gtk3.Box();
  }
});
var Entry = astalify(Gtk3.Entry, {
  getChildren() {
    return [];
  }
});
var Image = astalify(Gtk3.Image, {
  getChildren() {
    return [];
  }
});
var Label = astalify(Gtk3.Label, {
  getChildren() {
    return [];
  },
  setChildren(self, children) {
    self.label = String(children);
  }
});
var LevelBar = astalify(Gtk3.LevelBar, {
  getChildren() {
    return [];
  }
});
var Overlay = astalify(Gtk3.Overlay, {
  getChildren(self) {
    const children = [];
    let ch = self.get_first_child();
    while (ch !== null) {
      children.push(ch);
      ch = ch.get_next_sibling();
    }
    return children.filter((ch2) => ch2 !== self.child);
  },
  setChildren(self, children) {
    for (const child of filter(children)) {
      const types = type in child ? child[type].split(/\s+/) : [];
      if (types.includes("overlay")) {
        self.add_overlay(child);
      } else {
        self.set_child(child);
      }
      self.set_measure_overlay(child, types.includes("measure"));
      self.set_clip_overlay(child, types.includes("clip"));
    }
  }
});
var Revealer = astalify(Gtk3.Revealer);
var Slider = astalify(Astal5.Slider, {
  getChildren() {
    return [];
  }
});
var Stack = astalify(Gtk3.Stack, {
  setChildren(self, children) {
    for (const child of filter(children)) {
      if (child.name != "" && child.name != null) {
        self.add_named(child, child.name);
      } else {
        self.add_child(child);
      }
    }
  }
});
var Switch = astalify(Gtk3.Switch, {
  getChildren() {
    return [];
  }
});
var Window = astalify(Astal5.Window);
var MenuButton = astalify(Gtk3.MenuButton, {
  getChildren(self) {
    return [self.popover, self.child];
  },
  setChildren(self, children) {
    for (const child of filter(children)) {
      if (child instanceof Gtk3.Popover) {
        self.set_popover(child);
      } else {
        self.set_child(child);
      }
    }
  }
});
var Popover = astalify(Gtk3.Popover);

// app.ts
import Gtk7 from "gi://Gtk?version=4.0";
import Gdk5 from "gi://Gdk?version=4.0";

// sass:/home/kieran/dev/kobel-shell/ags/style/main.scss
var main_default = '@charset "UTF-8";\nwindow {\n  font-family: "Inter", "Inter Variable", "InterVariable", sans-serif;\n  font-size: 13px;\n  color: #f3eef3;\n}\n\n.tn {\n  font-feature-settings: "tnum";\n}\n\nwindow {\n  background: transparent;\n}\n\nbutton {\n  background: none;\n  background-color: transparent;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 0;\n  transition: background-color 160ms, color 160ms;\n}\n\nimage {\n  -gtk-icon-style: regular;\n}\n\n.bar {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 0 7px;\n  min-height: 42px;\n  color: #b5adbc;\n}\n.bar .title {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n  margin: 0 9px;\n}\n.bar .clock {\n  color: #f3eef3;\n  font-size: 13.5px;\n  font-weight: 600;\n}\n.bar .date {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.bar .ibtn {\n  padding: 0;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.bar .ibtn image {\n  -gtk-icon-size: 16px;\n}\n.bar .ibtn:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.bar .bcenter {\n  min-height: 0;\n  padding: 6px 12px;\n  border-radius: 9px;\n}\n.bar .bcenter:hover {\n  background-color: #1d1a22;\n}\n.bar .status {\n  min-height: 30px;\n  padding: 0 13px;\n  border-radius: 999px;\n  background-color: #1d1a22;\n}\n.bar .status:hover {\n  background-color: #26232c;\n}\n.bar .status image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.bar .status .pct image {\n  -gtk-icon-size: 15px;\n}\n.bar .status label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 11.5px;\n}\n.bar .status.err .net-icon {\n  color: #edbb64;\n}\n.bar .badge {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 99px;\n  font-size: 9px;\n  font-weight: 700;\n  padding: 0 3px;\n  margin: 2px;\n  min-height: 14px;\n  min-width: 14px;\n}\n.bar .tray-icon {\n  min-width: 28px;\n}\n.bar .tray-icon image {\n  -gtk-icon-size: 14px;\n  color: #b5adbc;\n}\n.bar .tray-lang {\n  font-size: 11px;\n  font-weight: 650;\n  color: #b5adbc;\n  padding: 0 8px;\n  min-width: 0;\n}\n\n.dock {\n  background-color: #100e14;\n  padding: 5px;\n  border-radius: 16px;\n}\n.dock .dbtn {\n  border-radius: 12px;\n}\n.dock .icon-tile {\n  min-width: 30px;\n  min-height: 30px;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.dock .dbtn:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.dock .placeholder .icon-tile {\n  background-color: #1d1a22;\n  color: #8d8693;\n}\n.dock .dots {\n  margin-bottom: 3px;\n}\n.dock .dot {\n  background-color: #8d8693;\n  border-radius: 99px;\n  min-width: 4px;\n  min-height: 4px;\n  transition: min-width 260ms cubic-bezier(0.24, 1.36, 0.35, 1), background-color 220ms;\n}\n.dock .dot.on {\n  background-color: #b5cb48;\n  min-width: 12px;\n}\n.dock .dot.mini {\n  min-width: 3px;\n  min-height: 3px;\n  opacity: 0.7;\n}\n.dock .sep {\n  background-color: #26232c;\n  min-width: 1px;\n  min-height: 33px;\n  margin: 0 3px;\n}\n.dock .dtile {\n  min-width: 42px;\n  min-height: 42px;\n}\n.dock .dwidget .dg {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 9px;\n  padding: 6px;\n}\n.dock levelbar.mprog {\n  min-width: 25px;\n  min-height: 3px;\n  margin-bottom: 6px;\n}\n.dock levelbar.mprog > trough {\n  background-color: rgba(0, 0, 0, 0.35);\n  border-radius: 99px;\n  min-height: 3px;\n}\n.dock levelbar.mprog > trough > block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.dock levelbar.mprog > trough > block.empty {\n  background-color: transparent;\n}\n\n.sheet {\n  background-color: #100e14;\n  border-radius: 24px;\n  padding: 12px;\n  margin: 38px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n}\n\n.qs {\n  min-width: 328px;\n} /* matches panelW(352)\u221224; overridden by config.ts tokenCss at runtime */\n.qs-top {\n  margin-bottom: 12px;\n  padding: 0 2px;\n}\n.qs-top .meta {\n  color: #b5adbc;\n  font-size: 11.5px;\n  font-weight: 600;\n}\n.qs-top .meta image {\n  -gtk-icon-size: 15px;\n  color: #b5adbc;\n  padding: 0;\n  margin: 0;\n}\n.qs-top .rbtn {\n  padding: 9px;\n  border-radius: 99px;\n  background-color: #26232c;\n  color: #b5adbc;\n  margin-left: 7px;\n}\n.qs-top .rbtn image {\n  -gtk-icon-size: 14px;\n}\n.qs-top .rbtn:hover {\n  background-color: #322e39;\n  color: #f3eef3;\n}\n.qs-top .rbtn.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.qs-top .rbtn.leaf image {\n  color: #b5cb48;\n}\n\n.chip {\n  background-color: #1d1a22;\n  border-radius: 999px;\n  min-height: 54px;\n  transition: background-color 220ms;\n}\n.chip .chipb {\n  padding: 9px 8px 9px 12px;\n  border-radius: 999px;\n}\n.chip image {\n  color: #b5adbc;\n  -gtk-icon-size: 17px;\n}\n.chip label {\n  font-size: 12.5px;\n  font-weight: 650;\n  color: #f3eef3;\n}\n.chip .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n  margin-top: 0;\n}\n.chip:hover {\n  background-color: #26232c;\n}\n.chip.on {\n  background-color: #b5cb48;\n}\n.chip.on image {\n  color: #192003;\n}\n.chip.on label {\n  color: #192003;\n}\n.chip.on .sub {\n  color: rgba(25, 32, 3, 0.7);\n}\n.chip.on:hover {\n  background-color: #96ae30;\n}\n.chip.on .chev {\n  color: #192003;\n}\n.chip .chev {\n  min-width: 32px;\n  border-radius: 0 999px 999px 0;\n  color: #8d8693;\n  border-left: 1px solid rgba(0, 0, 0, 0.18);\n}\n.chip .chev image {\n  -gtk-icon-size: 15px;\n  color: inherit;\n}\n.chip .chev:hover {\n  background-color: rgba(0, 0, 0, 0.14);\n}\n\n.chips {\n  margin-bottom: 0;\n}\n\n.chips > box:last-child {\n  margin-right: 1px;\n}\n\n.chip-grid {\n  margin-bottom: 10px;\n}\n\nscale, scale:horizontal, scale:vertical {\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 6px 0;\n}\n\nscale > trough, scale:horizontal > trough, scale:vertical > trough {\n  min-height: 6px;\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border-radius: 999px;\n  background-color: #26232c;\n}\n\nscale > trough > highlight,\nscale > trough > progress {\n  min-height: 6px;\n  border-radius: 999px;\n  background-color: #b5cb48;\n}\n\nscale > trough > slider {\n  min-width: 17px;\n  min-height: 17px;\n  margin: -6px; /* prototype knob 17\xD717 */\n  border-radius: 999px;\n  background-color: #f3eef3;\n  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);\n}\n\n.srow {\n  padding: 0 2px 0 2px;\n  min-height: 42px;\n}\n.srow .sval {\n  font-size: 11px;\n  font-weight: 600;\n  color: #b5adbc;\n}\n\n.srow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n  padding: 0;\n  margin: 0 -12px 0 12px;\n}\n\n.srow .chev {\n  padding: 6px 8px;\n  color: #8d8693;\n  border-radius: 9px;\n}\n.srow .chev image {\n  -gtk-icon-size: 15px;\n  padding: 0;\n  margin: 0;\n}\n.srow .chev:hover {\n  background-color: #1d1a22;\n}\n\n.gbanner {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n  margin-bottom: 8px;\n}\n.gbanner .t {\n  color: #edbb64;\n  font-weight: 650;\n  font-size: 11.5px;\n}\n.gbanner .s {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.gbanner image {\n  color: #edbb64;\n  -gtk-icon-size: 16px;\n}\n\n.gbtn {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 10px;\n  font-weight: 650;\n  font-size: 11.5px;\n  padding: 7px 12px;\n}\n.gbtn:hover {\n  background-color: #96ae30;\n}\n\n.dhead {\n  padding-bottom: 10px;\n}\n.dhead button {\n  padding: 7px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.dhead button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.dhead label {\n  font-weight: 650;\n  font-size: 14px;\n}\n\nswitch {\n  background-color: #26232c;\n  border-radius: 999px;\n  min-width: 42px;\n  min-height: 24px;\n}\nswitch:checked {\n  background-color: #b5cb48;\n}\nswitch slider {\n  background-color: #f3eef3;\n  border-radius: 999px;\n  min-width: 20px;\n  min-height: 20px;\n}\n\n.xrow {\n  background-color: transparent;\n  border-radius: 9px;\n  padding: 9px 11px;\n}\n.xrow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.xrow label {\n  font-size: 12.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.xrow .xs {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.xrow:hover {\n  background-color: #1d1a22;\n}\n.xrow.active {\n  background-color: rgba(106, 197, 143, 0.08);\n}\n.xrow.active image {\n  color: #b5cb48;\n}\n.xrow.active .xs {\n  color: #b5cb48;\n}\n\n.mixrow {\n  padding: 4px 2px;\n}\n.mixrow .mi {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 5px;\n}\n.mixrow .mi image {\n  color: #b5adbc;\n  -gtk-icon-size: 15px;\n}\n.mixrow .mname {\n  font-size: 12px;\n  color: #b5adbc;\n  min-width: 72px;\n}\n\n.sheet.launcher {\n  min-width: 568px;\n}\n\n.launcher {\n  padding: 8px;\n}\n\n.field {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 3px 12px;\n  margin-bottom: 6px;\n}\n.field image {\n  color: #8d8693;\n  -gtk-icon-size: 16px;\n}\n.field entry {\n  background: none;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  color: #f3eef3;\n  font-size: 14.5px;\n  caret-color: #b5cb48;\n  padding: 8px 0;\n  min-height: 0;\n  min-width: 0;\n}\n.field entry text {\n  min-height: 0;\n}\n.field .lplaceholder {\n  color: #b5adbc;\n  font-size: 14.5px;\n}\n.field .ghost {\n  color: #8d8693;\n  font-size: 14.5px;\n}\n.field .kbd {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 5px;\n  font-size: 10.5px;\n  padding: 3px 7px;\n}\n\n.tiles {\n  padding: 8px 2px 10px;\n}\n\n.tile {\n  padding: 5px 0;\n  border-radius: 10px;\n  min-width: 64px;\n  max-width: 64px;\n}\n.tile .icon-tile {\n  min-width: 0;\n  min-height: 0;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.tile label {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.tile:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.tile:hover label {\n  color: #f3eef3;\n}\n\n.lfoot {\n  padding: 7px 10px 3px;\n  color: #8d8693;\n  font-size: 11px;\n}\n.lfoot b {\n  color: #b5adbc;\n  font-weight: 650;\n}\n\n.lwidgets {\n  padding: 0 2px 6px;\n}\n\n.widget {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n}\n.widget label {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.widget .hint {\n  color: #b5adbc;\n  font-size: 11px;\n  font-weight: 400;\n}\n\n.lwm .lwart {\n  background-color: #26232c;\n  border-radius: 9px;\n  min-width: 34px;\n  min-height: 34px;\n}\n.lwm .lwart image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.lwm .mbtn {\n  color: #f3eef3;\n  border-radius: 8px;\n  min-width: 29px;\n  min-height: 29px;\n}\n.lwm .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.lwm .mbtn:hover {\n  background-color: #26232c;\n}\n\n.sec {\n  color: #8d8693;\n  font-size: 10px;\n  font-weight: 650;\n  padding: 8px 10px 2px;\n}\n\n.row {\n  border-radius: 10px;\n  padding: 7px 10px;\n}\n.row .ri {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 2px;\n}\n.row image {\n  -gtk-icon-size: 24px;\n}\n.row label {\n  font-size: 13px;\n  font-weight: 600;\n}\n.row .hint {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.row .runk {\n  background-color: #322e39;\n  color: #b5adbc;\n  border-radius: 6px;\n  font-size: 10.5px;\n  padding: 2px 7px;\n}\n.row:hover {\n  background-color: #1d1a22;\n}\n.row.sel {\n  background-color: #26232c;\n}\n\n.cal {\n  min-width: 309px;\n}\n.cal .sub {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.cal .hero {\n  color: #f3eef3;\n  font-size: 19px;\n  font-weight: 650;\n}\n.cal .calhero {\n  padding: 4px 8px 8px;\n}\n.cal .cal-grid {\n  margin-top: 8px;\n}\n.cal .month {\n  border-radius: 8px;\n  padding: 5px;\n  font-weight: 650;\n  font-size: 13px;\n}\n.cal .month:hover {\n  background-color: #1d1a22;\n}\n.cal centerbox > button {\n  padding: 6px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.cal centerbox > button image {\n  -gtk-icon-size: 14px;\n}\n.cal centerbox > button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.cal .dow {\n  color: #8d8693;\n  font-size: 9.5px;\n  font-weight: 600;\n  padding: 3px 0 6px;\n}\n.cal .wk {\n  color: #8d8693;\n  font-size: 9px;\n  font-weight: 600;\n}\n.cal .day {\n  background: none;\n  background-color: transparent;\n  color: #f3eef3;\n  font-size: 11px;\n  font-weight: 600;\n  min-width: 24px;\n  min-height: 24px;\n  border-radius: 99px;\n  margin: 1px;\n}\n.cal .day:hover {\n  background-color: #1d1a22;\n}\n.cal .day.we {\n  color: #8d8693;\n}\n.cal .day.out {\n  color: #8d8693;\n  font-weight: 400;\n}\n.cal .day.today {\n  background-color: #b5cb48;\n  color: #192003;\n  font-weight: 700;\n}\n.cal .day.today:hover {\n  background-color: #b5cb48;\n}\n.cal .day.sel:not(.today) {\n  box-shadow: inset 0 0 0 1.5px #b5adbc;\n}\n.cal .day.today.sel {\n  box-shadow: inset 0 0 0 1.5px #192003;\n}\n.cal .day .evdot {\n  min-width: 3px;\n  min-height: 3px;\n  border-radius: 99px;\n  background-color: #b5cb48;\n  margin-bottom: 2px;\n}\n.cal .day.today .evdot {\n  background-color: #192003;\n}\n.cal .evcard {\n  margin-top: 10px;\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px;\n}\n.cal .evhead {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n  padding: 1px 3px 8px;\n}\n.cal .evrow {\n  background-color: #100e14;\n  border-radius: 10px;\n  padding: 8px 10px;\n  margin-bottom: 4px;\n}\n.cal .evrow:last-child {\n  margin-bottom: 0;\n}\n.cal .evrow .evic {\n  background-color: #628933;\n  border-radius: 8px;\n  padding: 5px;\n}\n.cal .evrow .evic image {\n  color: #fff;\n  -gtk-icon-size: 15px;\n}\n.cal .evrow label {\n  font-size: 12px;\n  font-weight: 650;\n}\n.cal .evrow .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n\n.drawer {\n  background: transparent;\n}\n\n.toast {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 20px;\n  padding: 11px 13px;\n  box-shadow: 0 18px 40px rgba(5, 3, 10, 0.45);\n}\n\n.ncard {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 11px 12px;\n}\n.ncard .nic {\n  background-color: #26232c;\n  min-width: 30px;\n  min-height: 30px;\n  border-radius: 9px;\n}\n.ncard .nic image {\n  color: #b5adbc;\n  -gtk-icon-size: 15px;\n}\n.ncard {\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.ncard label {\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.ncard .body {\n  color: #b5adbc;\n  font-size: 11.8px;\n  font-weight: 400;\n}\n.ncard .when {\n  color: #8d8693;\n  font-size: 10px;\n}\n.ncard .nx {\n  padding: 5px;\n  border-radius: 99px;\n  color: #8d8693;\n}\n.ncard .nx:hover {\n  background-color: #26232c;\n  color: #ef86a0;\n}\n.ncard.media {\n  padding: 10px 11px 9px;\n  margin-bottom: 2px;\n}\n.ncard .mart {\n  background-color: #26232c;\n  border-radius: 10px;\n  min-width: 46px;\n  min-height: 46px;\n}\n.ncard .mart image {\n  color: #b5adbc;\n  -gtk-icon-size: 22px;\n}\n.ncard .mmeta label {\n  font-size: 13px;\n}\n.ncard .mbtn {\n  min-width: 29px;\n  min-height: 29px;\n  border-radius: 8px;\n  color: #b5adbc;\n}\n.ncard .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.ncard .mbtn:hover {\n  background-color: #26232c;\n  color: #f3eef3;\n}\n.ncard .mbar {\n  margin-top: 7px;\n}\n.ncard .mtime {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.ncard levelbar.mtrack {\n  min-height: 4px;\n  border-radius: 99px;\n}\n.ncard levelbar.mtrack > trough {\n  min-height: 4px;\n  border-radius: 99px;\n  background-color: #26232c;\n}\n.ncard levelbar.mtrack > trough > block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.ncard levelbar.mtrack > trough > block.empty {\n  background-color: transparent;\n}\n.ncard .memptyrow label {\n  color: #b5adbc;\n  font-size: 12px;\n  font-weight: 400;\n}\n.ncard .memptyrow .mart image {\n  color: #8d8693;\n}\n.ncard .ghostb {\n  background-color: #26232c;\n  color: #f3eef3;\n  font-size: 11.5px;\n  font-weight: 600;\n  padding: 7px 12px;\n  border-radius: 10px;\n}\n.ncard .ghostb label {\n  font-size: 11.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.ncard .ghostb:hover {\n  background-color: #322e39;\n}\n\n.nhead {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 8px 8px 8px 14px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.nhead label {\n  font-size: 13.5px;\n  font-weight: 650;\n}\n.nhead .sub {\n  font-size: 11px;\n  font-weight: 400;\n  color: #8d8693;\n}\n.nhead .nclear {\n  color: #ef86a0;\n  font-size: 11.5px;\n  font-weight: 600;\n  border-radius: 7px;\n  padding: 4px 9px;\n}\n.nhead .nclear:hover {\n  background-color: #1d1a22;\n}\n\n.nempty {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 20px 0 16px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.nempty image {\n  color: #8d8693;\n  -gtk-icon-size: 22px;\n  margin-bottom: 4px;\n}\n.nempty label {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n}\n\n.osd {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 999px;\n  padding: 10px 15px;\n}\n.osd image {\n  color: #f3eef3;\n  -gtk-icon-size: 15px;\n}\n.osd levelbar > trough {\n  min-height: 6px;\n  border-radius: 99px;\n  background-color: #26232c;\n}\n.osd levelbar > trough > block {\n  min-height: 6px;\n  border-radius: 99px;\n}\n.osd levelbar > trough > block.filled {\n  background-color: #b5cb48;\n}\n.osd levelbar > trough > block.empty {\n  background-color: transparent;\n}\n.osd .sval {\n  min-width: 32px;\n  color: #b5adbc;\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.session {\n  background-color: rgba(9, 3, 14, 0.8);\n}\n.session .sbtn {\n  padding: 6px;\n  border-radius: 12px;\n}\n.session .sic {\n  background-color: #100e14;\n  border-radius: 24px;\n  min-width: 59px;\n  min-height: 59px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n  color: #f3eef3;\n  transition: background-color 200ms, color 200ms;\n}\n.session .red .sic {\n  color: #ef86a0;\n}\n.session .sbtn:hover .sic {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.session .red:hover .sic {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.session label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 12px;\n}\n.session .confirm label {\n  color: #ef86a0;\n  font-weight: 650;\n}\n\n.cmenu {\n  background-color: #100e14;\n  border-radius: 12px;\n  padding: 5px;\n}\n.cmenu .cmi {\n  border-radius: 8px;\n  padding: 8px 10px;\n  font-size: 12px;\n  font-weight: 600;\n}\n.cmenu .cmi:hover {\n  background-color: #1d1a22;\n}\n.cmenu .cmi.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.cmenu .csep {\n  background-color: #1d1a22;\n  min-height: 1px;\n  margin: 4px 8px;\n}\n\n.dtip {\n  background-color: #100e14;\n  color: #f3eef3;\n  border-radius: 10px;\n  padding: 6px 11px;\n  font-size: 11.5px;\n  font-weight: 600;\n}';

// config.ts
var floating = {
  barH: 42,
  barR: 14,
  gap: 10,
  edge: 12,
  icon: 44,
  dockPad: 5,
  tileH: 54,
  panelW: 365,
  // 28.5cqw at 1280px = 364.8 ≈ 365
  launcherW: 584,
  // 46cqw at 1280px = 588.8 → clamped to 584 max
  calendarW: 336
  // 27cqw at 1280px = 345.6 → clamped to 336 max
};
var gapless = {
  ...floating,
  barH: 38,
  barR: 0,
  gap: 0,
  edge: 0
};
var tokens = floating;
var ctl = () => tokens.barH - 11;
var panelTop = () => tokens.gap + tokens.barH + 6;
function tokenCss(t = tokens) {
  return `
  .bar { min-height: ${t.barH}px; border-radius: ${t.barR}px;
         margin: 0; }
  .bar button { min-width: ${ctl()}px; min-height: ${ctl()}px; }
  .dock { padding: ${t.dockPad}px; border-radius: ${12 + t.dockPad - 1}px;
          margin-bottom: ${t.gap}px; }
  .icon-tile { min-width: ${t.icon}px; min-height: ${t.icon}px; }
  .qs, .drawer, .calendar { margin-top: ${panelTop()}px; }
  .qs { min-width: ${t.panelW - 24}px; }  /* panelW is outer; subtract .sheet padding 12px\xD72 */
  .launcher { min-width: ${t.launcherW}px; }
  .calendar { min-width: ${t.calendarW}px; }
  .chip { min-height: ${t.tileH}px; }
  `;
}

// services/gnoblin.ts
import Gio2 from "gi://Gio";
import GLib2 from "gi://GLib";

// ../../../../../usr/share/astal/gjs/index.ts
import { default as default3 } from "gi://AstalIO?version=0.1";

// ../../../../../usr/share/astal/gjs/file.ts
import Astal7 from "gi://AstalIO";
import Gio from "gi://Gio?version=2.0";

// ../../../../../usr/share/astal/gjs/gobject.ts
import GObject2 from "gi://GObject";
import { default as default2 } from "gi://GLib?version=2.0";
var meta = Symbol("meta");
var priv = Symbol("priv");
var { ParamSpec, ParamFlags } = GObject2;

// services/gnoblin.ts
var BUS = "org.gnoblin.Shell";
var PATH = "/org/gnoblin/Shell";
var IFACE = "org.gnoblin.Shell";
var connected = Variable(false);
var windows = Variable([]);
var proxy = null;
function call(method, params = null) {
  return new Promise((res, rej) => {
    if (!proxy) return rej(new Error("gnoblin: not connected"));
    proxy.call(method, params, Gio2.DBusCallFlags.NONE, 2e3, null, (_, r) => {
      try {
        res(proxy.call_finish(r));
      } catch (e) {
        rej(e);
      }
    });
  });
}
var reload = () => call("Reload");
var activate = (id) => call("ActivateWindow", new GLib2.Variant("(s)", [id]));
var minimize = (id) => call("MinimizeWindow", new GLib2.Variant("(s)", [id]));
async function refreshWindows() {
  try {
    const v = await call("ListWindows");
    if (!v) return;
    const [list] = v.deep_unpack();
    windows.set(list);
  } catch {
  }
}
function appWindows(appId) {
  return windows.get().filter((w) => w.appId === appId);
}
async function cycle(appId, dir) {
  const ws = appWindows(appId);
  if (ws.length < 2) return;
  const i = ws.findIndex((w) => w.focused);
  await activate(ws[((i < 0 ? 0 : i) + dir + ws.length) % ws.length].id);
}
function init() {
  Gio2.bus_watch_name(
    Gio2.BusType.SESSION,
    BUS,
    Gio2.BusNameWatcherFlags.NONE,
    () => {
      Gio2.DBusProxy.new_for_bus(
        Gio2.BusType.SESSION,
        Gio2.DBusProxyFlags.NONE,
        null,
        BUS,
        PATH,
        IFACE,
        null,
        (_, res) => {
          proxy = Gio2.DBusProxy.new_for_bus_finish(res);
          proxy.connect("g-signal", (_p, _s, sig) => {
            if (sig === "WindowsChanged") refreshWindows();
          });
          connected.set(true);
          refreshWindows();
        }
      );
    },
    () => {
      proxy = null;
      connected.set(false);
    }
  );
}

// services/notifd.ts
import GLib3 from "gi://GLib";
import Notifd from "gi://AstalNotifd";
var unread = Variable(0);
var ready = Variable(false);
var n = null;
function init2() {
  if (GLib3.getenv("KOBEL_SKIP_NOTIFD")) return;
  timeout(50, () => {
    try {
      n = Notifd.get_default();
      ready.set(true);
      const sync = () => unread.set(n.notifications.length);
      n.connect("notified", sync);
      n.connect("resolved", sync);
      sync();
    } catch (e) {
      printerr(`kobel: notifd init skipped: ${e}`);
    }
  });
}

// lib/inspect.ts
import GLib4 from "gi://GLib";
function dumpWindow(win) {
  const out = [];
  const root = win;
  const walk = (w, depth) => {
    let x = 0, y = 0, width = 0, height = 0;
    try {
      const res = w.compute_bounds(root);
      const rect = Array.isArray(res) ? res[1] : res;
      if (rect) {
        x = rect.origin.x;
        y = rect.origin.y;
        width = rect.size.width;
        height = rect.size.height;
      }
    } catch {
    }
    if (!width) {
      width = w.get_width?.() ?? 0;
      height = w.get_height?.() ?? 0;
    }
    const cls = (w.get_css_classes?.() ?? []).join(".");
    const type2 = (w.constructor?.name ?? "?").replace(/_/g, "");
    let t = "";
    try {
      t = (w.get_label?.() ?? w.get_text?.() ?? "").toString().slice(0, 28);
    } catch {
    }
    out.push({
      d: depth,
      type: type2,
      cls,
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(width),
      h: Math.round(height),
      t
    });
    let c = w.get_first_child?.();
    while (c) {
      walk(c, depth + 1);
      c = c.get_next_sibling();
    }
  };
  const child = win.get_child?.();
  if (child) walk(child, 0);
  return out;
}
function armDump(getWindow) {
  const name = GLib4.getenv("KOBEL_DUMP");
  if (!name) return;
  const path = GLib4.getenv("KOBEL_DUMP_OUT") || "/tmp/kobel-dump.json";
  let done = false;
  GLib4.timeout_add(GLib4.PRIORITY_DEFAULT, 400, () => {
    if (done) return GLib4.SOURCE_REMOVE;
    const w = getWindow(name);
    if (w && w.get_mapped?.() && (w.get_width?.() ?? 0) > 0) {
      GLib4.timeout_add(GLib4.PRIORITY_DEFAULT, 250, () => {
        try {
          const tree = dumpWindow(w);
          GLib4.file_set_contents(path, JSON.stringify(tree));
          printerr(`kobel: dumped ${tree.length} widgets of "${name}" \u2192 ${path}`);
        } catch (e) {
          printerr(`kobel: dump failed: ${e}`);
        }
        return GLib4.SOURCE_REMOVE;
      });
      done = true;
      return GLib4.SOURCE_REMOVE;
    }
    return GLib4.SOURCE_CONTINUE;
  });
}

// lib/surface.ts
var registry = {};
function register(name, fn) {
  registry[name] = fn;
}
function toggle(name) {
  if (registry[name]) {
    registry[name]();
  } else {
    app_default.toggle_window(name);
  }
}
function makeReveal(openMs = 220, closeMs = 150) {
  const winVisible = Variable(false);
  const revealed = Variable(false);
  let revealerWidget = null;
  let closeTimer = null;
  const setRevealer = (r) => {
    revealerWidget = r;
  };
  const open = () => {
    if (closeTimer) {
      closeTimer.cancel?.();
      closeTimer = null;
    }
    if (revealerWidget) revealerWidget.transitionDuration = openMs;
    winVisible.set(true);
    timeout(16, () => revealed.set(true));
  };
  const close = () => {
    if (revealerWidget) revealerWidget.transitionDuration = closeMs;
    revealed.set(false);
    closeTimer = timeout(closeMs + 20, () => {
      winVisible.set(false);
      closeTimer = null;
    });
  };
  const toggleFn = () => revealed.get() ? close() : open();
  return { winVisible, revealed, setRevealer, open, close, toggle: toggleFn };
}

// widget/Bar.tsx
import Battery from "gi://AstalBattery";
import Wp from "gi://AstalWp";
import Network from "gi://AstalNetwork";
import Tray from "gi://AstalTray";

// lib/demo.ts
import GLib5 from "gi://GLib";
var DEMO = !!GLib5.getenv("KOBEL_DEMO");
var D = {
  // bar — match prototype.html mock state exactly
  clock: "10:42",
  date: "Fri 3 Jul",
  title: "Terminal \u2014 window 1/2",
  batteryPct: "100%",
  // quick settings
  meta: "100% \xB7 Fully charged",
  wifiSsid: "chompers-5G",
  btDevice: "WH-1000XM5",
  volume: 0.675,
  // trough 51..285 width=234; knob=(209-51)/234=0.675 → x≈209 matches proto
  brightness: 0.8,
  // measured: AGS trough 2px narrower than proto; 0.800 aligns knob center
  dark: true,
  save: false,
  silent: false,
  night: false,
  // calendar — pinned to prototype date (Friday 3 July 2026)
  today: { y: 2026, m: 6, d: 3 },
  // Friday 3 July 2026
  // launcher pinned tiles + today widget
  apps: ["Terminal", "Files", "Firefox", "Zed", "Spotify", "Settings"],
  widgetDate: "Friday 3 July",
  widgetEvent: "09:45 \xB7 Daily Standup",
  media: { title: "Weightless", artist: "Marconi Union" },
  // prototype initial notification store (store.push at load time, when:"10:38")
  notifications: [
    {
      icon: "kobel-leaf-symbolic",
      summary: "gnoblin",
      body: "Soft-reload complete \u2014 4 extensions, 2 scripts. Windows untouched.",
      when: "10:38"
    }
  ]
};

// ../../../../../usr/share/astal/gjs/gtk4/jsx-runtime.ts
function jsx2(ctor, props) {
  return jsx(ctors, ctor, props);
}
var ctors = {
  box: Box,
  button: Button,
  centerbox: CenterBox,
  // circularprogress: Widget.CircularProgress,
  // drawingarea: Widget.DrawingArea,
  entry: Entry,
  image: Image,
  label: Label,
  levelbar: LevelBar,
  overlay: Overlay,
  revealer: Revealer,
  slider: Slider,
  stack: Stack,
  switch: Switch,
  window: Window,
  menubutton: MenuButton,
  popover: Popover
};
var jsxs = jsx2;

// widget/Bar.tsx
var time = Variable(default2.DateTime.new_now_local()).poll(
  1e4,
  () => default2.DateTime.new_now_local()
);
function FocusedTitle() {
  return /* @__PURE__ */ jsx2(
    "label",
    {
      class: "title",
      ellipsize: 3,
      maxWidthChars: 28,
      label: DEMO ? D.title : bind(windows).as((ws) => {
        const f = ws.find((w) => w.focused);
        if (!f) return "desktop";
        const siblings = ws.filter((w) => w.appId === f.appId);
        return siblings.length > 1 ? `${f.title} \u2014 window ${siblings.indexOf(f) + 1}/${siblings.length}` : f.title;
      })
    }
  );
}
function StatusPill() {
  const speaker = Wp.get_default()?.default_speaker ?? null;
  const net = Network.get_default();
  const bat = Battery.get_default();
  const wifiIcon2 = net.wifi ? bind(net.wifi, "enabled").as(
    (on) => on ? "kobel-wifi-symbolic" : "kobel-wifi-off-symbolic"
  ) : "kobel-wifi-off-symbolic";
  const volIcon = speaker ? bind(speaker, "volume_icon").as((i) => i ?? "kobel-speaker-wave-symbolic") : "kobel-speaker-mute-symbolic";
  return /* @__PURE__ */ jsx2(
    "button",
    {
      valign: Gtk4.Align.CENTER,
      class: bind(connected).as((c) => c ? "status" : "status err"),
      onClicked: () => toggle("quicksettings"),
      children: /* @__PURE__ */ jsxs("box", { spacing: 10, children: [
        /* @__PURE__ */ jsx2("image", { class: "net-icon", iconName: wifiIcon2 }),
        /* @__PURE__ */ jsx2("image", { iconName: volIcon }),
        (DEMO || bat) && /* @__PURE__ */ jsxs("box", { class: "pct", spacing: 6, children: [
          /* @__PURE__ */ jsx2("image", { iconName: "kobel-battery-symbolic" }),
          /* @__PURE__ */ jsx2(
            "label",
            {
              class: "tn",
              label: DEMO ? D.batteryPct : bat ? bind(bat, "percentage").as((p) => `${Math.round(p * 100)}%`) : ""
            }
          )
        ] })
      ] })
    }
  );
}
function Bell() {
  return /* @__PURE__ */ jsx2(
    "button",
    {
      class: "ibtn bell",
      valign: Gtk4.Align.CENTER,
      onClicked: () => toggle("drawer"),
      children: /* @__PURE__ */ jsxs("overlay", { children: [
        /* @__PURE__ */ jsx2("image", { iconName: "kobel-bell-symbolic" }),
        /* @__PURE__ */ jsx2(
          "label",
          {
            type: "overlay",
            halign: Gtk4.Align.END,
            valign: Gtk4.Align.START,
            class: "badge tn",
            visible: DEMO ? true : bind(unread).as((n2) => n2 > 0),
            label: DEMO ? "1" : bind(unread).as((n2) => n2 > 9 ? "9+" : `${n2}`)
          }
        )
      ] })
    }
  );
}
function Bar(monitor) {
  const { TOP, LEFT, RIGHT } = Astal6.WindowAnchor;
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "bar",
      namespace: "kobel-bar",
      class: "bar-window",
      gdkmonitor: monitor,
      exclusivity: Astal6.Exclusivity.EXCLUSIVE,
      marginTop: 10,
      marginLeft: 12,
      marginRight: 12,
      anchor: TOP | LEFT | RIGHT,
      children: /* @__PURE__ */ jsxs("centerbox", { class: "bar", children: [
        /* @__PURE__ */ jsxs("box", { spacing: 4, children: [
          /* @__PURE__ */ jsx2(
            "button",
            {
              class: "ibtn",
              valign: Gtk4.Align.CENTER,
              onClicked: () => toggle("launcher"),
              children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-magnifying-glass-symbolic" })
            }
          ),
          /* @__PURE__ */ jsx2(FocusedTitle, {})
        ] }),
        /* @__PURE__ */ jsx2(
          "button",
          {
            class: "bcenter",
            valign: Gtk4.Align.CENTER,
            onClicked: () => toggle("calendar"),
            children: /* @__PURE__ */ jsxs("box", { spacing: 8, children: [
              /* @__PURE__ */ jsx2(
                "label",
                {
                  class: "clock tn",
                  valign: Gtk4.Align.BASELINE,
                  label: DEMO ? D.clock : bind(time).as((t) => t.format("%H:%M"))
                }
              ),
              /* @__PURE__ */ jsx2(
                "label",
                {
                  class: "date",
                  valign: Gtk4.Align.BASELINE,
                  label: DEMO ? D.date : bind(time).as((t) => t.format("%a %-d %b"))
                }
              )
            ] })
          }
        ),
        /* @__PURE__ */ jsxs("box", { spacing: 4, children: [
          DEMO ? /* @__PURE__ */ jsxs("box", { spacing: 1, marginEnd: 3, children: [
            /* @__PURE__ */ jsx2(
              "button",
              {
                class: "ibtn tray-icon",
                valign: Gtk4.Align.CENTER,
                tooltipText: "Discord",
                children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chat-symbolic" })
              }
            ),
            /* @__PURE__ */ jsx2(
              "button",
              {
                class: "ibtn tray-icon",
                valign: Gtk4.Align.CENTER,
                tooltipText: "Steam",
                children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-game-symbolic" })
              }
            ),
            /* @__PURE__ */ jsx2(
              "button",
              {
                class: "ibtn tray-icon",
                valign: Gtk4.Align.CENTER,
                tooltipText: "Telegram",
                children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-paper-plane-symbolic" })
              }
            ),
            /* @__PURE__ */ jsx2("button", { class: "ibtn tray-lang tn", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("label", { label: "en" }) })
          ] }) : bind(Tray.get_default(), "items").as(
            (items) => items.map((item) => /* @__PURE__ */ jsx2(
              "menubutton",
              {
                tooltipText: item.tooltip_markup,
                menuModel: item.menu_model,
                children: /* @__PURE__ */ jsx2("image", { gicon: bind(item, "gicon") })
              }
            ))
          ),
          /* @__PURE__ */ jsx2(StatusPill, {}),
          /* @__PURE__ */ jsx2(Bell, {}),
          /* @__PURE__ */ jsx2(
            "button",
            {
              class: "ibtn",
              valign: Gtk4.Align.CENTER,
              onClicked: () => toggle("session"),
              children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-power-symbolic" })
            }
          )
        ] })
      ] })
    }
  );
}

// widget/Dock.tsx
import Apps from "gi://AstalApps";
import Gio3 from "gi://Gio";
import Mpris from "gi://AstalMpris";
var PINNED = [
  "org.gnome.Ptyxis",
  "org.gnome.Nautilus",
  "firefox",
  "dev.zed.Zed",
  "com.spotify.Client",
  "org.gnome.Settings"
];
function Dots({ appId }) {
  return /* @__PURE__ */ jsx2("box", { class: "dots", halign: Gtk4.Align.CENTER, valign: Gtk4.Align.END, spacing: 3, children: bind(windows).as(() => {
    const ws = appWindows(appId);
    const total = ws.length;
    const n2 = Math.min(total, 4);
    const cur = ws.findIndex((w) => w.focused);
    let start = 0;
    if (total > 4) start = Math.min(Math.max((cur < 0 ? 0 : cur) - 1, 0), total - 4);
    return Array.from({ length: n2 }, (_, i) => {
      const idx = start + i;
      const cls = ["dot"];
      if (cur >= 0 && idx === cur) cls.push("on");
      if (total > 4 && (i === 0 && start > 0 || i === n2 - 1 && start + 4 < total))
        cls.push("mini");
      return /* @__PURE__ */ jsx2("box", { class: cls.join(" ") });
    });
  }) });
}
function DockButton({ app }) {
  const appId = app.entry.replace(/\.desktop$/, "");
  const onClick = () => {
    const ws = appWindows(appId);
    if (!ws.length) return void app.launch();
    const focused = ws.find((w) => w.focused);
    if (!focused)
      return void activate(
        ws.slice().sort((a, b) => Number(b.focused) - Number(a.focused))[0].id
      );
    if (ws.length > 1) return void cycle(appId, 1);
    minimize(focused.id);
  };
  return /* @__PURE__ */ jsx2(
    "button",
    {
      class: "dbtn",
      tooltipText: app.name,
      onClicked: onClick,
      onButtonPressed: (_w, e) => {
        if (e.get_button() === Gdk2.BUTTON_MIDDLE) app.launch();
      },
      onScroll: (_w, _dx, dy) => {
        const ws = appWindows(appId);
        if (!ws.length) return;
        if (ws.length > 1) cycle(appId, dy > 0 ? 1 : -1);
        else if (!ws[0].focused) activate(ws[0].id);
      },
      children: /* @__PURE__ */ jsxs("overlay", { children: [
        /* @__PURE__ */ jsx2(
          "image",
          {
            class: "icon-tile",
            iconName: app.icon_name || "application-x-executable",
            pixelSize: 30
          }
        ),
        /* @__PURE__ */ jsx2(Dots, { type: "overlay", appId })
      ] })
    }
  );
}
function MediaWidget() {
  const mpris = Mpris.get_default();
  const progress = DEMO ? 0.42 : bind(mpris, "players").as((ps) => {
    const p = ps.find((q) => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0];
    if (!p || !p.length || p.length <= 0) return 0;
    return p.position / p.length;
  });
  const icon = DEMO ? "kobel-pause-symbolic" : bind(mpris, "players").as((ps) => {
    const p = ps.find((q) => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0];
    if (!p) return "kobel-music-symbolic";
    return p.playback_status === Mpris.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic";
  });
  return /* @__PURE__ */ jsx2("button", { class: "dbtn dwidget", onClicked: () => execAsync("playerctl play-pause"), children: /* @__PURE__ */ jsxs("overlay", { children: [
    /* @__PURE__ */ jsx2("box", { class: "dtile", children: /* @__PURE__ */ jsx2(
      "image",
      {
        class: "dg",
        iconName: icon,
        pixelSize: 18,
        halign: Gtk4.Align.CENTER,
        valign: Gtk4.Align.CENTER,
        hexpand: true,
        vexpand: true
      }
    ) }),
    /* @__PURE__ */ jsx2(
      "levelbar",
      {
        type: "overlay",
        class: "mprog",
        halign: Gtk4.Align.CENTER,
        valign: Gtk4.Align.END,
        value: progress
      }
    )
  ] }) });
}
var DEMO_APPS = [
  {
    name: "Terminal",
    icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Ptyxis.svg",
    dots: ["on", "dot"]
  },
  {
    name: "Files",
    icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Nautilus.svg",
    dots: ["dot"]
  },
  { name: "Firefox", icon: "/usr/share/icons/hicolor/256x256/apps/firefox.png", dots: [] },
  {
    name: "Zed",
    icon: "/home/kieran/.local/zed.app/share/icons/hicolor/512x512/apps/zed.png",
    dots: []
  },
  {
    name: "Spotify",
    icon: "/var/lib/flatpak/exports/share/icons/hicolor/scalable/apps/com.spotify.Client.svg",
    dots: []
  },
  {
    name: "Settings",
    icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Settings.svg",
    dots: []
  }
];
function fileIcon(path) {
  return Gio3.FileIcon.new(Gio3.File.new_for_path(path));
}
function DemoButton({ app }) {
  return /* @__PURE__ */ jsx2("button", { class: "dbtn", tooltipText: app.name, children: /* @__PURE__ */ jsxs("overlay", { children: [
    /* @__PURE__ */ jsx2(
      "image",
      {
        class: "icon-tile",
        gicon: fileIcon(app.icon),
        pixelSize: 30,
        halign: Gtk4.Align.CENTER,
        valign: Gtk4.Align.CENTER
      }
    ),
    /* @__PURE__ */ jsx2(
      "box",
      {
        type: "overlay",
        class: "dots",
        halign: Gtk4.Align.CENTER,
        valign: Gtk4.Align.END,
        spacing: 3,
        children: app.dots.map((cls) => /* @__PURE__ */ jsx2("box", { class: cls === "on" ? "dot on" : "dot" }))
      }
    )
  ] }) });
}
function DemoDock(monitor) {
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "dock",
      namespace: "kobel-dock",
      class: "dock-window",
      gdkmonitor: monitor,
      anchor: Astal6.WindowAnchor.BOTTOM,
      children: /* @__PURE__ */ jsxs("box", { class: "dock", spacing: 4, children: [
        /* @__PURE__ */ jsx2(DemoButton, { app: DEMO_APPS[0] }),
        /* @__PURE__ */ jsx2(DemoButton, { app: DEMO_APPS[1] }),
        /* @__PURE__ */ jsx2(DemoButton, { app: DEMO_APPS[2] }),
        /* @__PURE__ */ jsx2(DemoButton, { app: DEMO_APPS[3] }),
        /* @__PURE__ */ jsx2("box", { class: "sep", valign: Gtk4.Align.CENTER }),
        /* @__PURE__ */ jsx2(DemoButton, { app: DEMO_APPS[4] }),
        /* @__PURE__ */ jsx2(DemoButton, { app: DEMO_APPS[5] }),
        /* @__PURE__ */ jsx2("box", { class: "sep", valign: Gtk4.Align.CENTER }),
        /* @__PURE__ */ jsx2(MediaWidget, {})
      ] })
    }
  );
}
function Dock(monitor) {
  if (DEMO) return DemoDock(monitor);
  const apps = new Apps.Apps();
  const all = apps.get_list();
  const resolve = (id) => all.find((a) => a.entry === `${id}.desktop` || a.entry === id) ?? all.find((a) => a.entry?.toLowerCase().includes(id.toLowerCase().split(".").pop()));
  const slots = PINNED.map((id) => ({ id, app: resolve(id) }));
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "dock",
      namespace: "kobel-dock",
      class: "dock-window",
      gdkmonitor: monitor,
      anchor: Astal6.WindowAnchor.BOTTOM,
      children: /* @__PURE__ */ jsxs("box", { class: "dock", spacing: 4, children: [
        slots.map(({ id, app }, i) => [
          i === 4 ? /* @__PURE__ */ jsx2("box", { class: "sep", valign: Gtk4.Align.CENTER }) : null,
          app ? /* @__PURE__ */ jsx2(DockButton, { app }) : /* @__PURE__ */ jsx2("button", { class: "dbtn placeholder", tooltipText: id.split(".").pop(), children: /* @__PURE__ */ jsx2(
            "image",
            {
              class: "icon-tile",
              iconName: "application-x-executable-symbolic",
              pixelSize: 30
            }
          ) })
        ]),
        /* @__PURE__ */ jsx2("box", { class: "sep", valign: Gtk4.Align.CENTER }),
        /* @__PURE__ */ jsx2(MediaWidget, {})
      ] })
    }
  );
}

// widget/Launcher.tsx
import Apps2 from "gi://AstalApps";
import Mpris2 from "gi://AstalMpris";

// lib/fuzzy.ts
import GLib6 from "gi://GLib";
function fuzzy(q, t) {
  const ql = q.toLowerCase(), tl = t.toLowerCase();
  let qi = 0, score = 0, last = -2;
  const marks = [];
  for (let i = 0; i < tl.length && qi < ql.length; i++) {
    if (tl[i] === ql[qi]) {
      marks.push(i);
      score += i === 0 || " -_./".includes(t[i - 1]) ? 4 : last === i - 1 ? 2 : 1;
      last = i;
      qi++;
    }
  }
  return qi === ql.length ? { score: score - t.length * 0.02, marks } : null;
}
function hl(t, marks) {
  const esc = (c) => GLib6.markup_escape_text(c, -1);
  if (!marks) return esc(t);
  const m = new Set(marks);
  let out = "";
  for (let i = 0; i < t.length; i++)
    out += m.has(i) ? `<span foreground="#b5cb48">${esc(t[i])}</span>` : esc(t[i]);
  return out;
}
var STORE = `${GLib6.get_user_state_dir()}/kobel/freq.json`;
var freq = {};
try {
  freq = JSON.parse(new TextDecoder().decode(GLib6.file_get_contents(STORE)[1]));
} catch {
}
var boost = (id) => Math.min(Math.log2(1 + (freq[id] ?? 0)), 3);
function bump(id) {
  freq[id] = (freq[id] ?? 0) + 1;
  GLib6.mkdir_with_parents(GLib6.path_get_dirname(STORE), 493);
  GLib6.file_set_contents(STORE, JSON.stringify(freq));
}
var frequency = (id) => freq[id] ?? 0;

// widget/Calendar.tsx
var todayVar = DEMO ? Variable(new Date(D.today.y, D.today.m, D.today.d)) : Variable(/* @__PURE__ */ new Date()).poll(6e4, () => /* @__PURE__ */ new Date());
var now = todayVar.get();
var key = (y, m, d) => `${y}-${m + 1}-${d}`;
var EVENTS = {
  [key(now.getFullYear(), now.getMonth(), now.getDate())]: [
    { t: "09:45", n: "Daily Standup", icon: "kobel-video-symbolic" }
  ],
  [key(now.getFullYear(), now.getMonth(), 11)]: [
    { t: "10:30", n: "Kieran Birthday", icon: "kobel-cake-symbolic" },
    { t: "13:00", n: "London Thing", icon: "kobel-pin-symbolic" }
  ],
  [key(now.getFullYear(), now.getMonth(), 13)]: [
    { t: "All day", n: "My Birthday", icon: "kobel-cake-symbolic" }
  ]
};
var view = Variable({ y: now.getFullYear(), m: now.getMonth() });
var sel = Variable(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dn + 3);
  const f = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((+t - +f) / 864e5 - 3 + (f.getUTCDay() + 6) % 7) / 7);
}
function Grid() {
  return /* @__PURE__ */ jsx2("box", { class: "cal-grid", orientation: Gtk4.Orientation.VERTICAL, children: bind(Variable.derive([view, sel], (v, s) => ({ v, s }))).as(({ v, s }) => {
    const first = new Date(v.y, v.m, 1);
    const start = (first.getDay() + 6) % 7;
    const days = new Date(v.y, v.m + 1, 0).getDate();
    const prevDays = new Date(v.y, v.m, 0).getDate();
    const rows = [];
    rows.push(
      /* @__PURE__ */ jsx2("box", { homogeneous: true, children: ["", "M", "T", "W", "T", "F", "S", "S"].map((d) => /* @__PURE__ */ jsx2("label", { class: "dow", label: d })) })
    );
    for (let r = 0; r < 6; r++) {
      const cells = [
        /* @__PURE__ */ jsx2(
          "label",
          {
            class: "wk tn",
            label: `${isoWeek(new Date(v.y, v.m, r * 7 - start + 1))}`
          }
        )
      ];
      for (let c = 0; c < 7; c++) {
        const i = r * 7 + c, d = i - start + 1;
        const out = d < 1 || d > days;
        const label = out ? d < 1 ? prevDays + d : d - days : d;
        const cls = ["day"];
        if (c >= 5) cls.push("we");
        if (out) cls.push("out");
        else {
          const today = now;
          if (d === today.getDate() && v.m === today.getMonth() && v.y === today.getFullYear())
            cls.push("today");
          if (EVENTS[key(v.y, v.m, d)]) cls.push("ev");
          if (s.getDate() === d && s.getMonth() === v.m && s.getFullYear() === v.y)
            cls.push("sel");
        }
        const hasEv = !out && !!EVENTS[key(v.y, v.m, d)];
        cells.push(
          out ? /* @__PURE__ */ jsx2(
            "label",
            {
              class: cls.join(" "),
              halign: Gtk4.Align.CENTER,
              label: `${label}`
            }
          ) : /* @__PURE__ */ jsx2(
            "button",
            {
              class: cls.join(" "),
              halign: Gtk4.Align.CENTER,
              valign: Gtk4.Align.CENTER,
              onClicked: () => sel.set(new Date(v.y, v.m, d)),
              children: hasEv ? /* @__PURE__ */ jsxs("overlay", { children: [
                /* @__PURE__ */ jsx2("label", { label: `${label}` }),
                /* @__PURE__ */ jsx2(
                  "box",
                  {
                    type: "overlay",
                    class: "evdot",
                    halign: Gtk4.Align.CENTER,
                    valign: Gtk4.Align.END
                  }
                )
              ] }) : /* @__PURE__ */ jsx2("label", { label: `${label}` })
            }
          )
        );
      }
      rows.push(/* @__PURE__ */ jsx2("box", { homogeneous: true, children: cells }));
    }
    return rows;
  }) });
}
function EventsCard() {
  return /* @__PURE__ */ jsx2("box", { class: "evcard", orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: bind(sel).as((d) => {
    const evs = EVENTS[key(d.getFullYear(), d.getMonth(), d.getDate())] ?? [];
    const head = /* @__PURE__ */ jsx2(
      "label",
      {
        class: "evhead",
        halign: Gtk4.Align.START,
        label: d.toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long"
        })
      }
    );
    if (!evs.length)
      return [
        head,
        /* @__PURE__ */ jsxs("box", { spacing: 8, children: [
          /* @__PURE__ */ jsx2("image", { iconName: "kobel-calendar-symbolic" }),
          /* @__PURE__ */ jsx2("label", { class: "sub", label: "No events" })
        ] })
      ];
    return [
      head,
      ...evs.map((e) => /* @__PURE__ */ jsxs("box", { class: "evrow", spacing: 10, children: [
        /* @__PURE__ */ jsx2("box", { class: "evic", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("image", { iconName: e.icon }) }),
        /* @__PURE__ */ jsxs(
          "box",
          {
            orientation: Gtk4.Orientation.VERTICAL,
            valign: Gtk4.Align.CENTER,
            hexpand: true,
            children: [
              /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, ellipsize: 3, label: e.n }),
              /* @__PURE__ */ jsx2("label", { class: "sub tn", halign: Gtk4.Align.START, label: e.t })
            ]
          }
        )
      ] }))
    ];
  }) });
}
function Calendar() {
  const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(220, 150);
  register("calendar", toggleFn);
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "calendar",
      namespace: "kobel-calendar",
      class: "calendar-window",
      visible: bind(winVisible),
      anchor: Astal6.WindowAnchor.TOP,
      exclusivity: Astal6.Exclusivity.NORMAL,
      keymode: Astal6.Keymode.ON_DEMAND,
      onKeyPressed: (_self, key2) => key2 === Gdk2.KEY_Escape ? (close(), true) : false,
      children: /* @__PURE__ */ jsx2(
        "revealer",
        {
          transitionType: Gtk4.RevealerTransitionType.SLIDE_DOWN,
          transitionDuration: 220,
          revealChild: bind(revealed),
          setup: (r) => setRevealer(r),
          children: /* @__PURE__ */ jsxs("box", { class: "sheet cal", orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
            /* @__PURE__ */ jsxs("box", { class: "calhero", orientation: Gtk4.Orientation.VERTICAL, children: [
              /* @__PURE__ */ jsx2(
                "label",
                {
                  class: "sub",
                  halign: Gtk4.Align.START,
                  label: bind(todayVar).as(
                    (d) => d.toLocaleDateString("en-GB", { weekday: "long" })
                  )
                }
              ),
              /* @__PURE__ */ jsx2(
                "label",
                {
                  class: "hero",
                  halign: Gtk4.Align.START,
                  label: bind(todayVar).as(
                    (d) => d.toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric"
                    })
                  )
                }
              )
            ] }),
            /* @__PURE__ */ jsxs("centerbox", { children: [
              /* @__PURE__ */ jsx2(
                "button",
                {
                  onClicked: () => {
                    const v = view.get();
                    view.set(v.m ? { y: v.y, m: v.m - 1 } : { y: v.y - 1, m: 11 });
                  },
                  children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-left-symbolic" })
                }
              ),
              /* @__PURE__ */ jsx2(
                "button",
                {
                  class: "month",
                  onClicked: () => view.set({ y: now.getFullYear(), m: now.getMonth() }),
                  children: /* @__PURE__ */ jsx2(
                    "label",
                    {
                      label: bind(view).as(
                        (v) => new Date(v.y, v.m).toLocaleString("en", { month: "long" }) + (v.y !== now.getFullYear() ? ` ${v.y}` : "")
                      )
                    }
                  )
                }
              ),
              /* @__PURE__ */ jsx2(
                "button",
                {
                  onClicked: () => {
                    const v = view.get();
                    view.set(v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 });
                  },
                  children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-right-symbolic" })
                }
              )
            ] }),
            /* @__PURE__ */ jsx2(Grid, {}),
            /* @__PURE__ */ jsx2(EventsCard, {})
          ] })
        }
      )
    }
  );
}

// widget/Launcher.tsx
var PINNED2 = [
  "org.gnome.Ptyxis",
  "org.gnome.Nautilus",
  "firefox",
  "dev.zed.Zed",
  "com.spotify.Client",
  "org.gnome.Settings"
];
var DEMO_TILES = [
  { name: "Terminal", id: "org.gnome.Ptyxis" },
  { name: "Files", id: "org.gnome.Nautilus" },
  { name: "Firefox", id: "firefox" },
  { name: "Zed", id: "dev.zed.Zed" },
  { name: "Spotify", id: "com.spotify.Client" },
  { name: "Settings", id: "org.gnome.Settings" }
];
function gridTiles(apps) {
  const all = apps.get_list();
  const resolve = (id) => all.find((a) => a.entry === `${id}.desktop` || a.entry === id) ?? all.find((a) => a.entry?.toLowerCase().includes(id.toLowerCase().split(".").pop()));
  const fromApp = (app) => ({
    name: app.name,
    iconName: app.icon_name || "application-x-executable",
    launch: () => {
      bump(app.name);
      app.launch();
    }
  });
  if (DEMO)
    return DEMO_TILES.map(({ name, id }) => {
      const app = resolve(id);
      return {
        name,
        iconName: app?.icon_name || id || "application-x-executable",
        launch: () => {
          bump(name);
          app?.launch();
        }
      };
    });
  const pinned = PINNED2.map(resolve).filter(Boolean);
  const rest = all.filter((a) => !pinned.includes(a)).sort((x, y) => frequency(y.name) - frequency(x.name));
  return [...pinned, ...rest].slice(0, 6).map(fromApp);
}
function todayEventLabel() {
  if (DEMO) return D.widgetEvent;
  const d = /* @__PURE__ */ new Date();
  const evs = EVENTS[`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`] ?? [];
  return evs.length ? `${evs[0].t} \xB7 ${evs[0].n}` : "No events today";
}
function todayDateLabel() {
  return DEMO ? D.widgetDate : (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
var ACTIONS = [
  {
    n: "Suspend",
    icon: "kobel-moon-symbolic",
    d: "Sleep \u2014 resume instantly",
    al: ["sleep"],
    run: () => execAsync("systemctl suspend")
  },
  {
    n: "Lock",
    icon: "kobel-lock-symbolic",
    d: "Lock the session",
    al: ["lock screen"],
    run: () => execAsync("loginctl lock-session")
  },
  {
    n: "Log Out",
    icon: "kobel-logout-symbolic",
    d: "End this session",
    al: ["exit", "sign out", "logout"],
    run: () => toggle("session")
  },
  {
    n: "Restart",
    icon: "kobel-reload-symbolic",
    d: "Reboot the machine",
    al: ["reboot"],
    run: () => toggle("session")
  },
  {
    n: "Shut Down",
    icon: "kobel-power-symbolic",
    d: "Power off",
    al: ["poweroff", "halt"],
    run: () => toggle("session")
  },
  {
    n: "Soft-reload gnoblin",
    icon: "kobel-reload-symbolic",
    d: "Reload the shell \u2014 windows survive",
    al: [],
    run: () => execAsync("gnoblinctl reload")
  }
];
var CMDS = [
  { c: "reload", d: "Soft-reload the shell \u2014 windows survive" },
  { c: "osd off", d: "kobel owns volume/brightness popups" },
  { c: "notifs off", d: "Release org.freedesktop.Notifications" },
  { c: "grants", d: "Screen-recording access per app" }
];
function Launcher() {
  const apps = new Apps2.Apps();
  const query = Variable(default2.getenv("KOBEL_QUERY") || "");
  const selected = Variable(0);
  const ghost = Variable("");
  function results(q) {
    const qt = q.trim();
    if (!qt) return [];
    if (qt.startsWith(":")) {
      const cq = qt.slice(1).trim();
      return [
        {
          section: "gnoblinctl",
          rows: CMDS.filter((c) => c.c.startsWith(cq)).map((c) => ({
            name: `:${c.c}`,
            icon: "kobel-terminal-symbolic",
            hint: c.d,
            score: 99,
            markup: `:${c.c}`,
            run: () => execAsync(`gnoblinctl ${c.c}`)
          }))
        }
      ];
    }
    const out = [];
    if (/^=?[0-9+\-*/(). ]+$/.test(qt) && /[0-9]/.test(qt) && /[+\-*/]/.test(qt)) {
      try {
        const v = Function(`"use strict";return(${qt.replace(/^=/, "")})`)();
        if (Number.isFinite(v))
          out.push({
            section: "calculator",
            rows: [
              {
                name: String(v),
                icon: "kobel-calculator-symbolic",
                hint: `${qt.replace(/^=/, "")} =`,
                score: 98,
                markup: String(v),
                run: () => execAsync(["wl-copy", String(v)])
              }
            ]
          });
      } catch {
      }
    }
    const appRows = apps.fuzzy_query(qt).slice(0, 5).map((a) => {
      const m = fuzzy(qt, a.name) ?? { score: 1, marks: null };
      return {
        name: a.name,
        icon: a.icon_name ?? "application-x-executable",
        hint: "Application",
        score: m.score + boost(a.name),
        markup: hl(a.name, m.marks),
        run: () => {
          bump(a.name);
          a.launch();
        }
      };
    });
    const actRows = ACTIONS.map((x) => {
      let m = fuzzy(qt, x.n);
      if (!m)
        for (const al of x.al) {
          const am = fuzzy(qt, al);
          if (am) {
            m = { score: am.score - 0.5, marks: null };
            break;
          }
        }
      return m ? {
        name: x.n,
        icon: x.icon,
        hint: x.d,
        score: m.score * 0.95,
        markup: hl(x.n, m.marks),
        run: x.run
      } : null;
    }).filter(Boolean);
    const all = [...appRows, ...actRows].sort((a, b) => b.score - a.score);
    const best = all[0];
    if (best) out.push({ section: "best match", rows: [best] });
    const rest = (rows) => rows.filter((r) => r !== best);
    if (rest(appRows).length) out.push({ section: "apps", rows: rest(appRows) });
    if (rest(actRows).length) out.push({ section: "actions", rows: rest(actRows).slice(0, 3) });
    out.push({
      section: "web",
      rows: [
        {
          name: `Search the web for \u201C${qt}\u201D`,
          icon: "kobel-globe-symbolic",
          hint: "",
          score: 0,
          markup: `Search the web for \u201C${qt}\u201D`,
          run: () => execAsync([
            "xdg-open",
            `https://duckduckgo.com/?q=${encodeURIComponent(qt)}`
          ])
        }
      ]
    });
    const g = out.flatMap((s) => s.rows).map((r) => r.name).find((n2) => n2.toLowerCase().startsWith(qt.toLowerCase()) && n2.length > qt.length);
    ghost.set(g ?? "");
    return out;
  }
  const sections = bind(query).as(results);
  const {
    winVisible,
    revealed: launchRevealed,
    setRevealer: setLaunchRevealer,
    close: launchClose,
    toggle: toggleFn
  } = makeReveal(220, 150);
  register("launcher", toggleFn);
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "launcher",
      namespace: "kobel-launcher",
      class: "launcher-window",
      anchor: Astal6.WindowAnchor.TOP,
      exclusivity: Astal6.Exclusivity.NORMAL,
      keymode: Astal6.Keymode.EXCLUSIVE,
      visible: bind(winVisible),
      onKeyPressed: (_self, key2, _code, mods) => {
        const flat = results(query.get()).flatMap((s) => s.rows);
        if (key2 === Gdk2.KEY_Escape) {
          if (query.get()) {
            query.set("");
            return true;
          }
          launchClose();
          return true;
        }
        if (key2 === Gdk2.KEY_Tab) {
          const g = ghost.get(), q = query.get();
          if (g && !(mods & Gdk2.ModifierType.SHIFT_MASK)) {
            query.set(g);
            return true;
          }
          selected.set(
            (selected.get() + (mods & Gdk2.ModifierType.SHIFT_MASK ? -1 : 1) + flat.length) % Math.max(flat.length, 1)
          );
          return true;
        }
        if (mods & Gdk2.ModifierType.CONTROL_MASK && (key2 === Gdk2.KEY_n || key2 === Gdk2.KEY_p)) {
          selected.set(
            (selected.get() + (key2 === Gdk2.KEY_n ? 1 : -1) + flat.length) % Math.max(flat.length, 1)
          );
          return true;
        }
        if (key2 === Gdk2.KEY_Down) {
          selected.set((selected.get() + 1) % Math.max(flat.length, 1));
          return true;
        }
        if (key2 === Gdk2.KEY_Up) {
          selected.set((selected.get() - 1 + flat.length) % Math.max(flat.length, 1));
          return true;
        }
        if (key2 === Gdk2.KEY_Return) {
          flat[selected.get()]?.run();
          launchClose();
          query.set("");
          return true;
        }
        return false;
      },
      children: /* @__PURE__ */ jsx2(
        "revealer",
        {
          transitionType: Gtk4.RevealerTransitionType.SLIDE_DOWN,
          transitionDuration: 220,
          revealChild: bind(launchRevealed),
          setup: (r) => setLaunchRevealer(r),
          children: /* @__PURE__ */ jsxs("box", { class: "sheet launcher", orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
            /* @__PURE__ */ jsxs("box", { class: "field", spacing: 11, children: [
              /* @__PURE__ */ jsx2("image", { iconName: "kobel-magnifying-glass-symbolic" }),
              /* @__PURE__ */ jsxs("overlay", { hexpand: true, children: [
                /* @__PURE__ */ jsx2(
                  "entry",
                  {
                    hexpand: true,
                    setup: (self) => {
                      self.set_max_width_chars(1);
                      self.set_width_chars(1);
                    },
                    text: bind(query),
                    onNotifyText: (e) => {
                      query.set(e.text);
                      selected.set(0);
                    }
                  }
                ),
                /* @__PURE__ */ jsx2(
                  "label",
                  {
                    type: "overlay",
                    class: "lplaceholder",
                    halign: Gtk4.Align.START,
                    valign: Gtk4.Align.CENTER,
                    ellipsize: 3,
                    hexpand: true,
                    visible: bind(query).as((q) => !q),
                    label: "Search \u2014 apps, files, actions \xB7 ':' cmds \xB7 '=' maths"
                  }
                ),
                /* @__PURE__ */ jsx2(
                  "label",
                  {
                    type: "overlay",
                    class: "ghost",
                    halign: Gtk4.Align.START,
                    valign: Gtk4.Align.CENTER,
                    useMarkup: true,
                    label: bind(ghost).as((g) => {
                      const q = query.get();
                      if (!g || !q || !g.toLowerCase().startsWith(q.toLowerCase()))
                        return "";
                      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                      return `<span alpha="0">${esc(g.slice(0, q.length))}</span><span color="#8d8693">${esc(g.slice(q.length))}</span>`;
                    })
                  }
                )
              ] }),
              /* @__PURE__ */ jsx2("label", { class: "kbd", label: "super", valign: Gtk4.Align.CENTER })
            ] }),
            /* @__PURE__ */ jsx2("revealer", { revealChild: bind(query).as((q) => !q.trim()), children: /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
              /* @__PURE__ */ jsx2("box", { class: "tiles", halign: Gtk4.Align.CENTER, spacing: 6, children: gridTiles(apps).map((t) => /* @__PURE__ */ jsx2(
                "button",
                {
                  class: "tile",
                  onClicked: () => {
                    t.launch();
                    launchClose();
                  },
                  children: /* @__PURE__ */ jsxs(
                    "box",
                    {
                      orientation: Gtk4.Orientation.VERTICAL,
                      spacing: 8,
                      halign: Gtk4.Align.CENTER,
                      children: [
                        /* @__PURE__ */ jsx2(
                          "image",
                          {
                            class: "icon-tile",
                            iconName: t.iconName,
                            pixelSize: 30,
                            halign: Gtk4.Align.CENTER,
                            valign: Gtk4.Align.CENTER
                          }
                        ),
                        /* @__PURE__ */ jsx2(
                          "label",
                          {
                            label: t.name,
                            halign: Gtk4.Align.CENTER,
                            ellipsize: 3,
                            maxWidthChars: 9
                          }
                        )
                      ]
                    }
                  )
                }
              )) }),
              /* @__PURE__ */ jsxs("box", { class: "lwidgets", spacing: 7, homogeneous: true, children: [
                /* @__PURE__ */ jsxs(
                  "box",
                  {
                    class: "widget lw",
                    hexpand: true,
                    orientation: Gtk4.Orientation.VERTICAL,
                    spacing: 2,
                    valign: Gtk4.Align.CENTER,
                    children: [
                      /* @__PURE__ */ jsx2(
                        "label",
                        {
                          class: "tn",
                          halign: Gtk4.Align.START,
                          label: todayDateLabel()
                        }
                      ),
                      /* @__PURE__ */ jsx2(
                        "label",
                        {
                          class: "hint",
                          halign: Gtk4.Align.START,
                          label: todayEventLabel()
                        }
                      )
                    ]
                  }
                ),
                (() => {
                  const mpris = Mpris2.get_default();
                  const activePlayer = bind(mpris, "players").as(
                    (ps) => ps.find(
                      (p) => p.playback_status === Mpris2.PlaybackStatus.PLAYING
                    ) ?? ps[0] ?? null
                  );
                  const mediaTitle = DEMO ? D.media.title : bind(mpris, "players").as((ps) => {
                    const p = ps.find(
                      (q) => q.playback_status === Mpris2.PlaybackStatus.PLAYING
                    ) ?? ps[0];
                    return p?.title ?? "Nothing playing";
                  });
                  const mediaArtist = DEMO ? D.media.artist : bind(mpris, "players").as((ps) => {
                    const p = ps.find(
                      (q) => q.playback_status === Mpris2.PlaybackStatus.PLAYING
                    ) ?? ps[0];
                    return p?.artist ?? "";
                  });
                  const playIcon = DEMO ? "kobel-pause-symbolic" : bind(mpris, "players").as((ps) => {
                    const p = ps.find(
                      (q) => q.playback_status === Mpris2.PlaybackStatus.PLAYING
                    ) ?? ps[0];
                    return p?.playback_status === Mpris2.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic";
                  });
                  return /* @__PURE__ */ jsxs("box", { class: "widget lwm", hexpand: true, spacing: 10, children: [
                    /* @__PURE__ */ jsx2("box", { class: "lwart", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2(
                      "image",
                      {
                        iconName: "kobel-music-symbolic",
                        halign: Gtk4.Align.CENTER,
                        valign: Gtk4.Align.CENTER
                      }
                    ) }),
                    /* @__PURE__ */ jsxs(
                      "box",
                      {
                        class: "lwt",
                        hexpand: true,
                        orientation: Gtk4.Orientation.VERTICAL,
                        valign: Gtk4.Align.CENTER,
                        children: [
                          /* @__PURE__ */ jsx2(
                            "label",
                            {
                              class: "mtitle",
                              halign: Gtk4.Align.START,
                              ellipsize: 3,
                              label: mediaTitle
                            }
                          ),
                          /* @__PURE__ */ jsx2(
                            "label",
                            {
                              class: "hint",
                              halign: Gtk4.Align.START,
                              ellipsize: 3,
                              label: mediaArtist
                            }
                          )
                        ]
                      }
                    ),
                    /* @__PURE__ */ jsx2(
                      "button",
                      {
                        class: "mbtn play",
                        valign: Gtk4.Align.CENTER,
                        onClicked: () => execAsync("playerctl play-pause"),
                        children: /* @__PURE__ */ jsx2("image", { iconName: playIcon })
                      }
                    )
                  ] });
                })()
              ] })
            ] }) }),
            /* @__PURE__ */ jsx2("box", { class: "lrows", orientation: Gtk4.Orientation.VERTICAL, spacing: 2, children: sections.as(
              (secs) => secs.flatMap((sec) => [
                /* @__PURE__ */ jsx2("label", { class: "sec", halign: Gtk4.Align.START, label: sec.section }),
                ...sec.rows.map((r) => {
                  const flatIdx = secs.flatMap((s) => s.rows).indexOf(r);
                  return /* @__PURE__ */ jsx2(
                    "button",
                    {
                      class: bind(selected).as(
                        (s) => s === flatIdx ? "row sel" : "row"
                      ),
                      onClicked: () => {
                        r.run();
                        launchClose();
                      },
                      children: /* @__PURE__ */ jsxs("box", { spacing: 11, children: [
                        /* @__PURE__ */ jsx2("box", { class: "ri", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("image", { iconName: r.icon, pixelSize: 24 }) }),
                        /* @__PURE__ */ jsx2("label", { useMarkup: true, label: r.markup }),
                        /* @__PURE__ */ jsx2(
                          "label",
                          {
                            class: "hint",
                            hexpand: true,
                            halign: Gtk4.Align.START,
                            ellipsize: 3,
                            label: r.hint
                          }
                        ),
                        /* @__PURE__ */ jsx2(
                          "label",
                          {
                            class: "runk",
                            label: "\u21B5",
                            visible: bind(selected).as(
                              (s) => s === flatIdx
                            )
                          }
                        )
                      ] })
                    }
                  );
                })
              ])
            ) }),
            /* @__PURE__ */ jsxs("box", { class: "lfoot", children: [
              /* @__PURE__ */ jsxs("box", { spacing: 14, hexpand: true, halign: Gtk4.Align.START, children: [
                /* @__PURE__ */ jsx2("label", { useMarkup: true, label: "<b>:reload</b> soft-reload" }),
                /* @__PURE__ */ jsx2("label", { useMarkup: true, label: "<b>:osd</b> toggle" }),
                /* @__PURE__ */ jsx2("label", { useMarkup: true, label: "<b>:grants</b> screen access" })
              ] }),
              /* @__PURE__ */ jsx2("label", { label: "\u2191\u2193 select \xB7 \u21B5 run", halign: Gtk4.Align.END })
            ] })
          ] })
        }
      )
    }
  );
}

// widget/QuickSettings.tsx
import Network2 from "gi://AstalNetwork";
import Bluetooth from "gi://AstalBluetooth";
import Wp2 from "gi://AstalWp";
import Gio4 from "gi://Gio";
import Battery2 from "gi://AstalBattery";

// lib/tinyslider.ts
import GObject3 from "gi://GObject";
import Gtk5 from "gi://Gtk";
var TinySlider = GObject3.registerClass(
  {
    GTypeName: "KobelTinyScale"
  },
  class TinySlider2 extends Gtk5.Scale {
    constructor(params) {
      const { value, ...rest } = params ?? {};
      super({
        orientation: Gtk5.Orientation.HORIZONTAL,
        adjustment: new Gtk5.Adjustment({
          lower: 0,
          upper: 1,
          step_increment: 0.01,
          page_increment: 0.1,
          page_size: 0,
          value: value ?? 0
        }),
        draw_value: false,
        ...rest
      });
    }
    vfunc_measure(orientation, for_size) {
      if (orientation === Gtk5.Orientation.HORIZONTAL) {
        return [0, 1, -1, -1];
      }
      return super.vfunc_measure(orientation, for_size);
    }
  }
);

// widget/QuickSettings.tsx
var drill = Variable(default2.getenv("KOBEL_DRILL") || null);
var STORE2 = `${default2.get_user_state_dir()}/kobel/qs-tiles.json`;
var tiles = ["wifi", "bt", "save", "dark", "silent", "night", "volume", "brightness"];
try {
  tiles = JSON.parse(new TextDecoder().decode(default2.file_get_contents(STORE2)[1]));
} catch {
}
function Chip(props) {
  return /* @__PURE__ */ jsxs("box", { class: bind(props.active).as((a) => a ? "chip pill on" : "chip pill"), children: [
    /* @__PURE__ */ jsx2("button", { class: "chipb", hexpand: true, onClicked: props.onToggled, children: /* @__PURE__ */ jsxs("box", { spacing: 9, children: [
      /* @__PURE__ */ jsx2("image", { iconName: props.icon }),
      /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, valign: Gtk4.Align.CENTER, children: [
        /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, label: props.label }),
        props.sub && /* @__PURE__ */ jsx2(
          "label",
          {
            class: "sub",
            halign: Gtk4.Align.START,
            ellipsize: 3,
            label: props.sub
          }
        )
      ] })
    ] }) }),
    props.onDrill && /* @__PURE__ */ jsx2("button", { class: "chev", hexpand: false, widthRequest: 32, onClicked: props.onDrill, children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-right-symbolic" }) })
  ] });
}
function Sliders() {
  const speaker = Wp2.get_default()?.default_speaker ?? null;
  if (!speaker && !DEMO) return /* @__PURE__ */ jsx2("box", {});
  const volIcon = speaker ? bind(speaker, "volume_icon").as((i) => i ?? "kobel-speaker-wave-symbolic") : "kobel-speaker-wave-symbolic";
  const initVol = DEMO ? D.volume : speaker?.volume ?? 0.64;
  const volValue = Variable(initVol);
  const volSlider = new TinySlider({ hexpand: true, cssClasses: ["slider"], value: initVol });
  if (!DEMO && speaker)
    bind(speaker, "volume").subscribe((v) => {
      volSlider.get_adjustment().value = v;
      volValue.set(v);
    });
  volSlider.connect("change-value", (_s, _t, v) => {
    if (speaker) speaker.volume = v;
    volValue.set(v);
  });
  const brightValue = Variable(DEMO ? D.brightness : 0.8);
  if (!DEMO) {
    Promise.all([execAsync("brightnessctl get"), execAsync("brightnessctl max")]).then(([cur, max]) => brightValue.set(parseInt(cur.trim()) / parseInt(max.trim()))).catch(() => {
    });
  }
  const brightSlider = new TinySlider({
    hexpand: true,
    cssClasses: ["slider"],
    value: brightValue.get()
  });
  brightValue.subscribe((v) => {
    brightSlider.get_adjustment().value = v;
  });
  brightSlider.connect(
    "change-value",
    (_s, _t, v) => execAsync(`brightnessctl set ${Math.round(v * 100)}%`).then(() => brightValue.set(v)).catch(() => {
    })
  );
  return /* @__PURE__ */ jsxs("box", { class: "sliders", orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
    /* @__PURE__ */ jsxs("box", { class: "srow", spacing: 9, children: [
      /* @__PURE__ */ jsx2("image", { iconName: volIcon }),
      volSlider,
      /* @__PURE__ */ jsx2(
        "label",
        {
          class: "sval tn",
          xalign: 1,
          widthRequest: 32,
          label: bind(volValue).as((v) => `${Math.round(v * 100)}%`)
        }
      ),
      /* @__PURE__ */ jsx2("button", { class: "chev", widthRequest: 31, onClicked: () => drill.set("mix"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-right-symbolic" }) })
    ] }),
    /* @__PURE__ */ jsxs("box", { class: "srow", spacing: 9, children: [
      /* @__PURE__ */ jsx2("image", { iconName: "kobel-brightness-symbolic" }),
      brightSlider,
      /* @__PURE__ */ jsx2(
        "label",
        {
          class: "sval tn",
          xalign: 1,
          widthRequest: 32,
          label: bind(brightValue).as((v) => `${Math.round(v * 100)}%`)
        }
      ),
      /* @__PURE__ */ jsx2("box", {})
    ] })
  ] });
}
function GnoblinBanner() {
  return /* @__PURE__ */ jsxs("box", { class: "gbanner", visible: DEMO ? false : bind(connected).as((c) => !c), spacing: 10, children: [
    /* @__PURE__ */ jsx2("image", { iconName: "kobel-warning-symbolic" }),
    /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, hexpand: true, children: [
      /* @__PURE__ */ jsx2("label", { class: "t", halign: Gtk4.Align.START, label: "org.gnoblin.Shell disconnected" }),
      /* @__PURE__ */ jsx2(
        "label",
        {
          class: "s",
          halign: Gtk4.Align.START,
          label: "osd + notifs handed back to gnome"
        }
      )
    ] }),
    /* @__PURE__ */ jsx2("button", { class: "gbtn", label: "Reconnect", onClicked: () => reload().catch(() => {
    }) })
  ] });
}
var ifaceSettings = new Gio4.Settings({ schema: "org.gnome.desktop.interface" });
var tDark = Variable(ifaceSettings.get_string("color-scheme") === "prefer-dark");
ifaceSettings.connect(
  "changed::color-scheme",
  () => tDark.set(ifaceSettings.get_string("color-scheme") === "prefer-dark")
);
var colorSettings = null;
var tNight = Variable(false);
try {
  colorSettings = new Gio4.Settings({ schema: "org.gnome.settings-daemon.plugins.color" });
  tNight.set(colorSettings.get_boolean("night-light-enabled"));
  colorSettings.connect(
    "changed::night-light-enabled",
    () => tNight.set(colorSettings.get_boolean("night-light-enabled"))
  );
} catch {
}
var _speaker = Wp2.get_default()?.default_speaker ?? null;
var tSilent = _speaker ? bind(_speaker, "mute") : Variable(false);
var tSave = Variable(false);
execAsync("powerprofilesctl get").then((v) => tSave.set(v.trim() === "power-saver")).catch(() => {
});
var editMode = Variable(false);
function ToggleChip(props) {
  return /* @__PURE__ */ jsx2(
    Chip,
    {
      id: props.label,
      label: props.label,
      icon: props.icon,
      active: bind(props.v),
      onToggled: props.onToggled ?? (() => props.v.set(!props.v.get()))
    }
  );
}
function batteryMeta() {
  const bat = Battery2.get_default();
  if (!bat) return null;
  return bind(bat, "percentage").as((p) => {
    const pct = Math.round(p * 100);
    const state = bat.full ? "Fully charged" : bat.charging ? "Charging" : "Discharging";
    return `${pct}% \xB7 ${state}`;
  });
}
var hasBattery = Battery2.get_default() != null;
function Root({ name }) {
  const net = Network2.get_default();
  const bt = Bluetooth.get_default();
  return /* @__PURE__ */ jsxs("box", { name, orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
    /* @__PURE__ */ jsxs("box", { class: "qs-top", spacing: 0, children: [
      (DEMO || hasBattery) && /* @__PURE__ */ jsxs("box", { class: "meta", spacing: 6, valign: Gtk4.Align.CENTER, children: [
        /* @__PURE__ */ jsx2("image", { iconName: "kobel-battery-symbolic" }),
        /* @__PURE__ */ jsx2("label", { class: "tn", label: DEMO ? D.meta : batteryMeta() })
      ] }),
      /* @__PURE__ */ jsx2("box", { hexpand: true }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn leaf", onClicked: () => reload(), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-leaf-symbolic" }) }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn", onClicked: () => execAsync("loginctl lock-session"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-lock-symbolic" }) }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn", onClicked: () => editMode.set(!editMode.get()), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-pencil-symbolic" }) }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn danger", onClicked: () => toggle("session"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-power-symbolic" }) })
    ] }),
    /* @__PURE__ */ jsx2(GnoblinBanner, {}),
    /* @__PURE__ */ jsxs("box", { class: "chip-grid", orientation: Gtk4.Orientation.VERTICAL, spacing: 8, children: [
      /* @__PURE__ */ jsxs("box", { class: "chips", homogeneous: true, spacing: 8, children: [
        (DEMO || net.wifi) && /* @__PURE__ */ jsx2(
          Chip,
          {
            id: "wifi",
            label: "Wi-Fi",
            icon: "kobel-wifi-symbolic",
            active: DEMO ? Variable(true) : bind(net.wifi, "enabled"),
            sub: DEMO ? D.wifiSsid : bind(net.wifi, "ssid").as((s) => s ?? "Off"),
            onToggled: () => {
              if (!DEMO && net.wifi) net.wifi.enabled = !net.wifi.enabled;
            },
            onDrill: () => drill.set("wifi")
          }
        ),
        /* @__PURE__ */ jsx2(
          Chip,
          {
            id: "bt",
            label: "Bluetooth",
            icon: "kobel-bluetooth-symbolic",
            active: DEMO ? Variable(true) : bind(bt, "devices").as((d) => d.some((x) => x.connected)),
            sub: DEMO ? D.btDevice : bind(bt, "devices").as(
              (d) => d.find((x) => x.connected)?.alias ?? "Off"
            ),
            onToggled: () => {
              if (!DEMO) bt.toggle();
            },
            onDrill: () => drill.set("bt")
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("box", { class: "chips", homogeneous: true, spacing: 8, children: [
        /* @__PURE__ */ jsx2(
          ToggleChip,
          {
            label: "Power Saver",
            icon: "kobel-bolt-symbolic",
            v: tSave,
            onToggled: () => {
              const next = !tSave.get();
              execAsync(`powerprofilesctl set ${next ? "power-saver" : "balanced"}`).then(() => tSave.set(next)).catch(() => tSave.set(next));
            }
          }
        ),
        /* @__PURE__ */ jsx2(
          ToggleChip,
          {
            label: "Dark Style",
            icon: "kobel-moon-symbolic",
            v: tDark,
            onToggled: () => {
              const next = !tDark.get();
              ifaceSettings.set_string(
                "color-scheme",
                next ? "prefer-dark" : "default"
              );
            }
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("box", { class: "chips", homogeneous: true, spacing: 8, children: [
        /* @__PURE__ */ jsx2(
          ToggleChip,
          {
            label: "Silent",
            icon: "kobel-bell-slash-symbolic",
            v: tSilent,
            onToggled: () => {
              if (_speaker) _speaker.mute = !_speaker.mute;
            }
          }
        ),
        /* @__PURE__ */ jsx2(
          ToggleChip,
          {
            label: "Night Light",
            icon: "kobel-sun-symbolic",
            v: tNight,
            onToggled: () => {
              if (colorSettings)
                colorSettings.set_boolean("night-light-enabled", !tNight.get());
            }
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsx2(Sliders, {})
  ] });
}
function wifiIcon(strength) {
  return "kobel-wifi-symbolic";
}
function WifiList() {
  const wifi = Network2.get_default().wifi;
  if (!wifi) return /* @__PURE__ */ jsx2("box", {});
  return /* @__PURE__ */ jsx2("box", { class: "dlist", orientation: Gtk4.Orientation.VERTICAL, spacing: 2, children: bind(wifi, "accessPoints").as((aps) => {
    const active = wifi.activeAccessPoint;
    const seen = /* @__PURE__ */ new Set();
    return aps.filter((ap) => ap.ssid && !seen.has(ap.ssid) && seen.add(ap.ssid)).sort((a, b) => b.strength - a.strength).slice(0, 6).map((ap) => {
      const on = active && ap.ssid === active.ssid;
      return /* @__PURE__ */ jsx2(
        "button",
        {
          class: on ? "xrow active" : "xrow",
          onClicked: () => wifi.activate_connection(ap, null),
          children: /* @__PURE__ */ jsxs("box", { spacing: 10, children: [
            /* @__PURE__ */ jsx2("image", { iconName: wifiIcon(ap.strength) }),
            /* @__PURE__ */ jsx2("label", { hexpand: true, halign: Gtk4.Align.START, label: ap.ssid }),
            /* @__PURE__ */ jsx2(
              "label",
              {
                class: "xs",
                label: on ? "Connected" : `${ap.strength}%`
              }
            )
          ] })
        }
      );
    });
  }) });
}
function BtList() {
  const bt = Bluetooth.get_default();
  return /* @__PURE__ */ jsx2("box", { class: "dlist", orientation: Gtk4.Orientation.VERTICAL, spacing: 2, children: bind(bt, "devices").as(
    (devices) => devices.filter((d) => d.name || d.alias).sort((a, b) => Number(b.connected) - Number(a.connected)).slice(0, 6).map((dev) => {
      const on = dev.connected;
      return /* @__PURE__ */ jsx2(
        "button",
        {
          class: on ? "xrow active" : "xrow",
          onClicked: () => on ? dev.disconnect_device() : dev.connect_device(),
          children: /* @__PURE__ */ jsxs("box", { spacing: 10, children: [
            /* @__PURE__ */ jsx2("image", { iconName: "kobel-bluetooth-symbolic" }),
            /* @__PURE__ */ jsx2(
              "label",
              {
                hexpand: true,
                halign: Gtk4.Align.START,
                label: dev.alias || dev.name
              }
            ),
            /* @__PURE__ */ jsx2(
              "label",
              {
                class: "xs",
                label: on ? "Connected" : dev.paired ? "Paired" : "Available"
              }
            )
          ] })
        }
      );
    })
  ) });
}
function MixRow(props) {
  return /* @__PURE__ */ jsxs("box", { class: "mixrow", spacing: 10, children: [
    /* @__PURE__ */ jsx2("box", { class: "mi", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("image", { iconName: props.icon }) }),
    /* @__PURE__ */ jsx2(
      "label",
      {
        class: "mname",
        valign: Gtk4.Align.CENTER,
        halign: Gtk4.Align.START,
        ellipsize: 3,
        label: props.title
      }
    ),
    /* @__PURE__ */ jsx2(
      "slider",
      {
        class: "slider",
        hexpand: true,
        valign: Gtk4.Align.CENTER,
        value: bind(props.target, "volume"),
        onChangeValue: (_s, v) => {
          props.target.volume = v;
        }
      }
    )
  ] });
}
function MixList() {
  const wp = Wp2.get_default();
  if (!wp) return /* @__PURE__ */ jsx2("box", {});
  const speaker = wp.default_speaker;
  return /* @__PURE__ */ jsxs("box", { class: "dlist", orientation: Gtk4.Orientation.VERTICAL, spacing: 2, children: [
    speaker && /* @__PURE__ */ jsx2(MixRow, { icon: "kobel-speaker-wave-symbolic", title: "Output", target: speaker }),
    bind(wp.audio, "streams").as(
      (streams) => streams.slice(0, 5).map((s) => /* @__PURE__ */ jsx2(
        MixRow,
        {
          icon: "kobel-music-symbolic",
          title: s.description || s.name || "Application",
          target: s
        }
      ))
    )
  ] });
}
function DrillView({ name }) {
  const net = Network2.get_default();
  return /* @__PURE__ */ jsxs("box", { name, orientation: Gtk4.Orientation.VERTICAL, spacing: 8, children: [
    /* @__PURE__ */ jsxs("centerbox", { class: "dhead", children: [
      /* @__PURE__ */ jsx2("button", { class: "ibtn", marginEnd: 15, onClicked: () => drill.set(null), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-left-symbolic" }) }),
      /* @__PURE__ */ jsx2(
        "label",
        {
          label: bind(drill).as(
            (d) => d === "wifi" ? "Wi-Fi" : d === "bt" ? "Bluetooth" : "Volume"
          )
        }
      ),
      /* @__PURE__ */ jsxs("box", { widthRequest: 46, halign: Gtk4.Align.END, children: [
        net.wifi && /* @__PURE__ */ jsx2(
          "switch",
          {
            active: bind(net.wifi, "enabled"),
            visible: bind(drill).as((d) => d === "wifi"),
            onNotifyActive: (s) => {
              net.wifi.enabled = s.active;
            }
          }
        ),
        /* @__PURE__ */ jsx2(
          "switch",
          {
            active: bind(Bluetooth.get_default(), "powered"),
            visible: bind(drill).as((d) => d === "bt"),
            onNotifyActive: (s) => {
              Bluetooth.get_default().adapter.powered = s.active;
            }
          }
        )
      ] })
    ] }),
    bind(drill).as(
      (d) => d === "wifi" ? /* @__PURE__ */ jsx2(WifiList, {}) : d === "bt" ? /* @__PURE__ */ jsx2(BtList, {}) : d === "mix" ? /* @__PURE__ */ jsx2(MixList, {}) : /* @__PURE__ */ jsx2("box", {})
    )
  ] });
}
function QuickSettings() {
  const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(220, 150);
  register("quicksettings", toggleFn);
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "quicksettings",
      namespace: "kobel-qs",
      class: "qs-window",
      visible: bind(winVisible),
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.RIGHT,
      exclusivity: Astal6.Exclusivity.NORMAL,
      keymode: Astal6.Keymode.ON_DEMAND,
      onKeyPressed: (_self, key2) => {
        if (key2 !== Gdk2.KEY_Escape) return false;
        if (drill.get()) {
          drill.set(null);
          return true;
        }
        close();
        return true;
      },
      children: /* @__PURE__ */ jsx2(
        "revealer",
        {
          transitionType: Gtk4.RevealerTransitionType.SLIDE_DOWN,
          transitionDuration: 220,
          revealChild: bind(revealed),
          setup: (r) => setRevealer(r),
          children: /* @__PURE__ */ jsx2("box", { class: "sheet qs", children: /* @__PURE__ */ jsxs(
            "stack",
            {
              transitionType: Gtk4.StackTransitionType.SLIDE_LEFT_RIGHT,
              transitionDuration: 220,
              visibleChildName: bind(drill).as((d) => d ? "drill" : "root"),
              children: [
                /* @__PURE__ */ jsx2(Root, { name: "root" }),
                /* @__PURE__ */ jsx2(DrillView, { name: "drill" })
              ]
            }
          ) })
        }
      )
    }
  );
}

// widget/Notifications.tsx
import Notifd2 from "gi://AstalNotifd";
import Mpris3 from "gi://AstalMpris";
var _notifd = null;
var nd = () => _notifd ??= Notifd2.get_default();
var skip = () => !!default2.getenv("KOBEL_SKIP_NOTIFD");
var TOAST_MS = 3800;
var drawerOpen = Variable(false);
var NCARD_W = 341;
function toCardData(n2) {
  return {
    icon: n2.app_icon || "dialog-information-symbolic",
    summary: n2.summary,
    body: n2.body,
    when: new Date(n2.time * 1e3).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    }),
    dismiss: () => n2.dismiss()
  };
}
function Card({ n: n2 }) {
  return /* @__PURE__ */ jsxs("box", { class: "ncard", spacing: 10, widthRequest: NCARD_W, children: [
    /* @__PURE__ */ jsx2("box", { class: "nic", valign: Gtk4.Align.START, children: /* @__PURE__ */ jsx2("image", { iconName: n2.icon, pixelSize: 20 }) }),
    /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, hexpand: true, children: [
      /* @__PURE__ */ jsxs("box", { spacing: 8, children: [
        /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, hexpand: true, ellipsize: 3, label: n2.summary }),
        /* @__PURE__ */ jsx2("label", { class: "when tn", label: n2.when })
      ] }),
      /* @__PURE__ */ jsx2(
        "label",
        {
          class: "body",
          halign: Gtk4.Align.START,
          xalign: 0,
          wrap: true,
          maxWidthChars: 40,
          label: n2.body
        }
      )
    ] }),
    /* @__PURE__ */ jsx2("button", { class: "nx", valign: Gtk4.Align.START, onClicked: n2.dismiss, children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-close-symbolic" }) })
  ] });
}
function Toasts(monitor) {
  if (skip()) return null;
  const live = Variable([]);
  const shown = Variable([]);
  const recompute = () => shown.set(drawerOpen.get() ? [] : live.get());
  live.subscribe(recompute);
  drawerOpen.subscribe(recompute);
  nd().connect("notified", (_n, id) => {
    if (drawerOpen.get() || nd().dont_disturb) return;
    live.set([...live.get(), id]);
    timeout(TOAST_MS, () => live.set(live.get().filter((x) => x !== id)));
  });
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "toasts",
      namespace: "kobel-toasts",
      gdkmonitor: monitor,
      visible: bind(drawerOpen).as((o) => !o),
      marginTop: 58,
      marginRight: 12,
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.RIGHT,
      children: /* @__PURE__ */ jsx2(
        "box",
        {
          orientation: Gtk4.Orientation.VERTICAL,
          spacing: 8,
          widthRequest: NCARD_W + 26,
          halign: Gtk4.Align.END,
          children: bind(shown).as(
            (ids) => ids.map((id) => {
              const n2 = nd().get_notification(id);
              return n2 ? /* @__PURE__ */ jsx2("box", { class: "toast", children: /* @__PURE__ */ jsx2(Card, { n: toCardData(n2) }) }) : /* @__PURE__ */ jsx2("box", {});
            })
          )
        }
      )
    }
  );
}
function MediaCard() {
  const mpris = Mpris3.get_default();
  if (!mpris && !DEMO) return null;
  const pick = (ps) => ps.find((p) => p.playback_status === Mpris3.PlaybackStatus.PLAYING) ?? ps[0] ?? null;
  const mediaTitle = DEMO ? D.media.title : bind(mpris, "players").as((ps) => pick(ps)?.title ?? "");
  const mediaArtist = DEMO ? D.media.artist : bind(mpris, "players").as((ps) => pick(ps)?.artist ?? "");
  const playIcon = DEMO ? "kobel-pause-symbolic" : bind(mpris, "players").as((ps) => {
    const p = pick(ps);
    return p?.playback_status === Mpris3.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic";
  });
  const progress = DEMO ? 0.42 : bind(mpris, "players").as((ps) => {
    const p = pick(ps);
    if (!p || !p.length || p.length <= 0) return 0;
    return p.position / p.length;
  });
  const curTime = DEMO ? "2:37" : bind(mpris, "players").as((ps) => {
    const p = pick(ps);
    if (!p || !p.position) return "0:00";
    const s = Math.floor(p.position);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  const totalTime = DEMO ? "6:07" : bind(mpris, "players").as((ps) => {
    const p = pick(ps);
    if (!p || !p.length || p.length <= 0) return "0:00";
    const s = Math.floor(p.length);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  });
  const hasPlayer = DEMO ? true : bind(mpris, "players").as((ps) => ps.length > 0);
  const noPlayer = DEMO ? false : bind(mpris, "players").as((ps) => ps.length === 0);
  return /* @__PURE__ */ jsxs("box", { class: "ncard media", orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
    /* @__PURE__ */ jsxs("box", { class: "mrow", spacing: 11, visible: hasPlayer, children: [
      /* @__PURE__ */ jsx2("box", { class: "mart", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2(
        "image",
        {
          iconName: "kobel-music-symbolic",
          pixelSize: 22,
          halign: Gtk4.Align.CENTER,
          valign: Gtk4.Align.CENTER,
          hexpand: true,
          vexpand: true
        }
      ) }),
      /* @__PURE__ */ jsxs(
        "box",
        {
          class: "mmeta",
          hexpand: true,
          orientation: Gtk4.Orientation.VERTICAL,
          valign: Gtk4.Align.CENTER,
          children: [
            /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, ellipsize: 3, label: mediaTitle }),
            /* @__PURE__ */ jsx2("label", { class: "sub", halign: Gtk4.Align.START, ellipsize: 3, label: mediaArtist })
          ]
        }
      ),
      /* @__PURE__ */ jsxs("box", { class: "mbtns", valign: Gtk4.Align.CENTER, spacing: 1, children: [
        /* @__PURE__ */ jsx2("button", { class: "mbtn", onClicked: () => execAsync("playerctl previous"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-skip-back-symbolic" }) }),
        /* @__PURE__ */ jsx2("button", { class: "mbtn play", onClicked: () => execAsync("playerctl play-pause"), children: /* @__PURE__ */ jsx2("image", { iconName: playIcon }) }),
        /* @__PURE__ */ jsx2("button", { class: "mbtn", onClicked: () => execAsync("playerctl next"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-skip-fwd-symbolic" }) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("box", { class: "mbar", spacing: 8, visible: hasPlayer, children: [
      /* @__PURE__ */ jsx2("label", { class: "mtime tn", label: curTime }),
      /* @__PURE__ */ jsx2("levelbar", { class: "mtrack", hexpand: true, value: progress }),
      /* @__PURE__ */ jsx2("label", { class: "mtime tn", label: totalTime })
    ] }),
    /* @__PURE__ */ jsxs("box", { class: "memptyrow", spacing: 11, visible: noPlayer, children: [
      /* @__PURE__ */ jsx2("box", { class: "mart", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2(
        "image",
        {
          iconName: "kobel-disc-symbolic",
          pixelSize: 22,
          halign: Gtk4.Align.CENTER,
          valign: Gtk4.Align.CENTER,
          hexpand: true,
          vexpand: true
        }
      ) }),
      /* @__PURE__ */ jsxs("box", { hexpand: true, orientation: Gtk4.Orientation.VERTICAL, valign: Gtk4.Align.CENTER, children: [
        /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, label: "Nothing playing" }),
        /* @__PURE__ */ jsx2(
          "label",
          {
            class: "sub",
            halign: Gtk4.Align.START,
            label: "Media controls appear when a player starts",
            wrap: true
          }
        )
      ] }),
      /* @__PURE__ */ jsx2(
        "button",
        {
          class: "ghostb",
          valign: Gtk4.Align.CENTER,
          onClicked: () => execAsync("xdg-open https://open.spotify.com"),
          children: /* @__PURE__ */ jsx2("label", { label: "Open Music" })
        }
      )
    ] })
  ] });
}
function Drawer() {
  if (!DEMO && skip()) return null;
  const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(200, 150);
  register("drawer", toggleFn);
  revealed.subscribe((r) => drawerOpen.set(r));
  if (DEMO) {
    const demoCards = D.notifications.map((n2) => ({
      ...n2,
      dismiss: () => {
      }
    }));
    const demoCount = `${demoCards.length || ""}`;
    return /* @__PURE__ */ jsx2(
      "window",
      {
        name: "drawer",
        namespace: "kobel-drawer",
        class: "drawer-window",
        visible: bind(winVisible),
        anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.RIGHT | Astal6.WindowAnchor.BOTTOM,
        keymode: Astal6.Keymode.ON_DEMAND,
        onKeyPressed: (_self, key2) => key2 === Gdk2.KEY_Escape ? (close(), true) : false,
        children: /* @__PURE__ */ jsx2(
          "revealer",
          {
            transitionType: Gtk4.RevealerTransitionType.SLIDE_LEFT,
            transitionDuration: 200,
            revealChild: bind(revealed),
            setup: (r) => setRevealer(r),
            children: /* @__PURE__ */ jsxs("box", { class: "drawer", orientation: Gtk4.Orientation.VERTICAL, spacing: 8, children: [
              /* @__PURE__ */ jsx2(MediaCard, {}),
              /* @__PURE__ */ jsxs("box", { class: "nhead", spacing: 8, children: [
                /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, label: "Notifications" }),
                /* @__PURE__ */ jsx2("label", { class: "tn sub", label: demoCount }),
                /* @__PURE__ */ jsx2("box", { hexpand: true }),
                /* @__PURE__ */ jsx2("button", { class: "nclear", children: /* @__PURE__ */ jsxs("box", { spacing: 5, children: [
                  /* @__PURE__ */ jsx2("image", { iconName: "kobel-trash-symbolic" }),
                  /* @__PURE__ */ jsx2("label", { label: "Clear" })
                ] }) })
              ] }),
              /* @__PURE__ */ jsx2("box", { orientation: Gtk4.Orientation.VERTICAL, spacing: 8, vexpand: true, children: demoCards.map((n2) => /* @__PURE__ */ jsx2(Card, { n: n2 })) })
            ] })
          }
        )
      }
    );
  }
  const nfd = nd();
  const list = Variable(nfd.get_notifications() ?? []);
  const refresh = () => list.set(nfd.get_notifications() ?? []);
  nfd.connect("notified", refresh);
  nfd.connect("resolved", refresh);
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "drawer",
      namespace: "kobel-drawer",
      class: "drawer-window",
      visible: bind(winVisible),
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.RIGHT | Astal6.WindowAnchor.BOTTOM,
      keymode: Astal6.Keymode.ON_DEMAND,
      onKeyPressed: (_self, key2) => key2 === Gdk2.KEY_Escape ? (close(), true) : false,
      children: /* @__PURE__ */ jsx2(
        "revealer",
        {
          transitionType: Gtk4.RevealerTransitionType.SLIDE_LEFT,
          transitionDuration: 200,
          revealChild: bind(revealed),
          setup: (r) => setRevealer(r),
          children: /* @__PURE__ */ jsxs("box", { class: "drawer", orientation: Gtk4.Orientation.VERTICAL, spacing: 8, children: [
            /* @__PURE__ */ jsx2(MediaCard, {}),
            /* @__PURE__ */ jsxs("box", { class: "nhead", spacing: 8, children: [
              /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, label: "Notifications" }),
              /* @__PURE__ */ jsx2("label", { class: "tn sub", label: bind(list).as((n2) => `${n2.length || ""}`) }),
              /* @__PURE__ */ jsx2("box", { hexpand: true }),
              /* @__PURE__ */ jsx2(
                "button",
                {
                  class: "nclear",
                  onClicked: () => nfd.get_notifications().forEach((n2) => n2.dismiss()),
                  children: /* @__PURE__ */ jsxs("box", { spacing: 5, children: [
                    /* @__PURE__ */ jsx2("image", { iconName: "kobel-trash-symbolic" }),
                    /* @__PURE__ */ jsx2("label", { label: "Clear" })
                  ] })
                }
              )
            ] }),
            /* @__PURE__ */ jsx2("box", { orientation: Gtk4.Orientation.VERTICAL, spacing: 8, vexpand: true, children: bind(list).as(
              (ns) => ns && ns.length ? ns.map((n2) => /* @__PURE__ */ jsx2(Card, { n: toCardData(n2) })) : [
                /* @__PURE__ */ jsxs(
                  "box",
                  {
                    class: "nempty",
                    orientation: Gtk4.Orientation.VERTICAL,
                    spacing: 2,
                    halign: Gtk4.Align.FILL,
                    children: [
                      /* @__PURE__ */ jsx2(
                        "image",
                        {
                          iconName: "kobel-check-symbolic",
                          halign: Gtk4.Align.CENTER
                        }
                      ),
                      /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.CENTER, label: "All caught up" })
                    ]
                  }
                )
              ]
            ) })
          ] })
        }
      )
    }
  );
}

// widget/OSD.tsx
import Wp3 from "gi://AstalWp";
function OSD(monitor) {
  const speaker = Wp3.get_default()?.default_speaker ?? null;
  const visible = Variable(false);
  let hide = null;
  if (!speaker) return null;
  speaker.connect("notify::volume", () => {
    visible.set(true);
    hide?.cancel();
    hide = timeout(1400, () => visible.set(false));
  });
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "osd",
      namespace: "kobel-osd",
      gdkmonitor: monitor,
      anchor: Astal6.WindowAnchor.BOTTOM,
      marginBottom: 70,
      clickThrough: true,
      visible: bind(visible),
      children: /* @__PURE__ */ jsxs("box", { class: "osd", spacing: 11, widthRequest: 230, children: [
        /* @__PURE__ */ jsx2("image", { iconName: bind(speaker, "volume_icon") }),
        /* @__PURE__ */ jsx2("levelbar", { hexpand: true, value: bind(speaker, "volume") }),
        /* @__PURE__ */ jsx2(
          "label",
          {
            class: "sval tn",
            xalign: 1,
            label: bind(speaker, "volume").as((v) => `${Math.round(v * 100)}%`)
          }
        )
      ] })
    }
  );
}

// widget/Session.tsx
var ACTIONS2 = [
  {
    id: "lock",
    label: "Lock",
    icon: "kobel-lock-symbolic",
    confirm: false,
    run: () => execAsync("loginctl lock-session")
  },
  {
    id: "logout",
    label: "Log out",
    icon: "kobel-logout-symbolic",
    confirm: false,
    run: () => execAsync("gnome-session-quit --logout --no-prompt")
  },
  {
    id: "restart",
    label: "Restart",
    icon: "kobel-reload-symbolic",
    confirm: true,
    run: () => execAsync("systemctl reboot")
  },
  {
    id: "shutdown",
    label: "Shut down",
    icon: "kobel-power-symbolic",
    confirm: true,
    red: true,
    run: () => execAsync("systemctl poweroff")
  }
];
function Session() {
  const armed = Variable(null);
  let revert = null;
  const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(180, 130);
  register("session", toggleFn);
  const press = (a) => {
    if (a.confirm && armed.get() !== a.id) {
      armed.set(a.id);
      revert?.cancel();
      revert = timeout(4e3, () => armed.set(null));
      return;
    }
    armed.set(null);
    close();
    a.run();
  };
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "session",
      namespace: "kobel-session",
      class: "session-window",
      visible: bind(winVisible),
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.BOTTOM | Astal6.WindowAnchor.LEFT | Astal6.WindowAnchor.RIGHT,
      keymode: Astal6.Keymode.EXCLUSIVE,
      exclusivity: Astal6.Exclusivity.IGNORE,
      onKeyPressed: (_self, key2) => {
        if (key2 === Gdk2.KEY_Escape) {
          armed.set(null);
          close();
          return true;
        }
        return false;
      },
      children: /* @__PURE__ */ jsx2(
        "revealer",
        {
          transitionType: Gtk4.RevealerTransitionType.CROSSFADE,
          transitionDuration: 180,
          revealChild: bind(revealed),
          setup: (r) => setRevealer(r),
          children: /* @__PURE__ */ jsx2("box", { class: "session", hexpand: true, vexpand: true, children: /* @__PURE__ */ jsx2("box", { halign: Gtk4.Align.CENTER, valign: Gtk4.Align.CENTER, spacing: 20, hexpand: true, children: ACTIONS2.map((a) => /* @__PURE__ */ jsx2("button", { class: a.red ? "sbtn red" : "sbtn", onClicked: () => press(a), children: /* @__PURE__ */ jsxs(
            "box",
            {
              orientation: Gtk4.Orientation.VERTICAL,
              spacing: 10,
              class: bind(armed).as((x) => x === a.id ? "confirm" : ""),
              children: [
                /* @__PURE__ */ jsx2(
                  "box",
                  {
                    class: "sic",
                    hexpand: false,
                    vexpand: false,
                    halign: Gtk4.Align.CENTER,
                    valign: Gtk4.Align.CENTER,
                    children: /* @__PURE__ */ jsx2(
                      "image",
                      {
                        iconName: a.icon,
                        pixelSize: 22,
                        hexpand: true,
                        halign: Gtk4.Align.CENTER,
                        valign: Gtk4.Align.CENTER
                      }
                    )
                  }
                ),
                /* @__PURE__ */ jsx2(
                  "label",
                  {
                    label: bind(armed).as(
                      (x) => x === a.id ? "Press again" : a.label
                    )
                  }
                )
              ]
            }
          ) })) }) })
        }
      )
    }
  );
}

// app.ts
import GLibIcons from "gi://GLib";
Object.defineProperty(Gtk7.Widget.prototype, "class", {
  configurable: true,
  set(v) {
    this.set_css_classes(String(v).split(/\s+/).filter(Boolean));
  },
  get() {
    return this.get_css_classes().join(" ");
  }
});
Gtk7.Widget.prototype.set_class = function(v) {
  this.set_css_classes(String(v).split(/\s+/).filter(Boolean));
};
printerr("KOBEL: module top reached");
var ICON_DIR = GLibIcons.getenv("KOBEL_ICONS") ?? GLibIcons.build_filenamev([GLibIcons.get_current_dir(), "icons"]);
app_default.start({
  instanceName: "kobel",
  icons: ICON_DIR,
  main() {
    init();
    init2();
    try {
      const prov = new Gtk7.CssProvider();
      prov.load_from_string(main_default + tokenCss(tokens));
      Gtk7.StyleContext.add_provider_for_display(
        Gdk5.Display.get_default(),
        prov,
        800
        /* USER priority */
      );
    } catch (e) {
      printerr(`kobel: css provider failed: ${e}`);
    }
    const make = (name, fn, show) => {
      try {
        const w = fn();
        if (w && typeof w.present === "function") {
          app_default.add_window?.(w);
          if (show) w.present();
        }
      } catch (e) {
        printerr(`kobel: ${name} FAILED: ${e}
${e?.stack ?? ""}`);
      }
    };
    const monitors = app_default.get_monitors();
    const targets = monitors.length ? monitors : [void 0];
    for (const monitor of targets) {
      make("bar", () => Bar(monitor), true);
      make("dock", () => Dock(monitor), true);
      make("toasts", () => Toasts(monitor), true);
      make("osd", () => OSD(monitor), true);
    }
    make("launcher", () => Launcher(), false);
    make("quicksettings", () => QuickSettings(), false);
    make("calendar", () => Calendar(), false);
    make("drawer", () => Drawer(), false);
    make("session", () => Session(), false);
    armDump((name) => app_default.get_window(name));
  },
  // `astal -i kobel -t <window>` handled by App's request framework
  requestHandler(request, res) {
    const [cmd, arg] = request.split(" ");
    if (cmd === "toggle") {
      toggle(arg);
      return res("ok");
    }
    if (cmd === "reload-css") {
      app_default.apply_css(main_default + tokenCss(tokens), true);
      return res("ok");
    }
    res("unknown");
  }
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYXBwLnRzIiwgInNhc3M6L2hvbWUva2llcmFuL2Rldi9rb2JlbC1zaGVsbC9hZ3Mvc3R5bGUvbWFpbi5zY3NzIiwgIi4uL2NvbmZpZy50cyIsICIuLi9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9zZXJ2aWNlcy9ub3RpZmQudHMiLCAiLi4vbGliL2luc3BlY3QudHMiLCAiLi4vbGliL3N1cmZhY2UudHMiLCAiLi4vd2lkZ2V0L0Jhci50c3giLCAiLi4vbGliL2RlbW8udHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2pzeC1ydW50aW1lLnRzIiwgIi4uL3dpZGdldC9Eb2NrLnRzeCIsICIuLi93aWRnZXQvTGF1bmNoZXIudHN4IiwgIi4uL2xpYi9mdXp6eS50cyIsICIuLi93aWRnZXQvQ2FsZW5kYXIudHN4IiwgIi4uL3dpZGdldC9RdWlja1NldHRpbmdzLnRzeCIsICIuLi9saWIvdGlueXNsaWRlci50cyIsICIuLi93aWRnZXQvTm90aWZpY2F0aW9ucy50c3giLCAiLi4vd2lkZ2V0L09TRC50c3giLCAiLi4vd2lkZ2V0L1Nlc3Npb24udHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUgQ29uc3RydWN0UHJvcHMgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmV4cG9ydCB7IEFzdGFsLCBHdGssIEdkayB9XG5leHBvcnQgeyBkZWZhdWx0IGFzIEFwcCB9IGZyb20gXCIuL2FwcC5qc1wiXG5leHBvcnQgeyBhc3RhbGlmeSwgQ29uc3RydWN0UHJvcHMgfVxuZXhwb3J0ICogYXMgV2lkZ2V0IGZyb20gXCIuL3dpZGdldC5qc1wiXG5leHBvcnQgeyBob29rIH0gZnJvbSBcIi4uL19hc3RhbFwiXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEJpbmRpbmcsIHsgdHlwZSBDb25uZWN0YWJsZSwgdHlwZSBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcbmltcG9ydCB7IGludGVydmFsIH0gZnJvbSBcIi4vdGltZS5qc1wiXG5pbXBvcnQgeyBleGVjQXN5bmMsIHN1YnByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcblxuY2xhc3MgVmFyaWFibGVXcmFwcGVyPFQ+IGV4dGVuZHMgRnVuY3Rpb24ge1xuICAgIHByaXZhdGUgdmFyaWFibGUhOiBBc3RhbC5WYXJpYWJsZUJhc2VcbiAgICBwcml2YXRlIGVyckhhbmRsZXI/ID0gY29uc29sZS5lcnJvclxuXG4gICAgcHJpdmF0ZSBfdmFsdWU6IFRcbiAgICBwcml2YXRlIF9wb2xsPzogQXN0YWwuVGltZVxuICAgIHByaXZhdGUgX3dhdGNoPzogQXN0YWwuUHJvY2Vzc1xuXG4gICAgcHJpdmF0ZSBwb2xsSW50ZXJ2YWwgPSAxMDAwXG4gICAgcHJpdmF0ZSBwb2xsRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG4gICAgcHJpdmF0ZSBwb2xsVHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgcHJpdmF0ZSBwb2xsRm4/OiAocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD5cblxuICAgIHByaXZhdGUgd2F0Y2hUcmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICBwcml2YXRlIHdhdGNoRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG5cbiAgICBjb25zdHJ1Y3Rvcihpbml0OiBUKSB7XG4gICAgICAgIHN1cGVyKClcbiAgICAgICAgdGhpcy5fdmFsdWUgPSBpbml0XG4gICAgICAgIHRoaXMudmFyaWFibGUgPSBuZXcgQXN0YWwuVmFyaWFibGVCYXNlKClcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZHJvcHBlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN0b3BXYXRjaCgpXG4gICAgICAgICAgICB0aGlzLnN0b3BQb2xsKClcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gdGhpcy5lcnJIYW5kbGVyPy4oZXJyKSlcbiAgICAgICAgcmV0dXJuIG5ldyBQcm94eSh0aGlzLCB7XG4gICAgICAgICAgICBhcHBseTogKHRhcmdldCwgXywgYXJncykgPT4gdGFyZ2V0Ll9jYWxsKGFyZ3NbMF0pLFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHByaXZhdGUgX2NhbGw8UiA9IFQ+KHRyYW5zZm9ybT86ICh2YWx1ZTogVCkgPT4gUik6IEJpbmRpbmc8Uj4ge1xuICAgICAgICBjb25zdCBiID0gQmluZGluZy5iaW5kKHRoaXMpXG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm0gPyBiLmFzKHRyYW5zZm9ybSkgOiBiIGFzIHVua25vd24gYXMgQmluZGluZzxSPlxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKGBWYXJpYWJsZTwke3RoaXMuZ2V0KCl9PmApXG4gICAgfVxuXG4gICAgZ2V0KCk6IFQgeyByZXR1cm4gdGhpcy5fdmFsdWUgfVxuICAgIHNldCh2YWx1ZTogVCkge1xuICAgICAgICBpZiAodmFsdWUgIT09IHRoaXMuX3ZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLl92YWx1ZSA9IHZhbHVlXG4gICAgICAgICAgICB0aGlzLnZhcmlhYmxlLmVtaXQoXCJjaGFuZ2VkXCIpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFBvbGwoKSB7XG4gICAgICAgIGlmICh0aGlzLl9wb2xsKVxuICAgICAgICAgICAgcmV0dXJuXG5cbiAgICAgICAgaWYgKHRoaXMucG9sbEZuKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2ID0gdGhpcy5wb2xsRm4hKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICAgICAgaWYgKHYgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgICAgICAgICAgIHYudGhlbih2ID0+IHRoaXMuc2V0KHYpKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2V0KHYpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnBvbGxFeGVjKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBleGVjQXN5bmModGhpcy5wb2xsRXhlYyEpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKHYgPT4gdGhpcy5zZXQodGhpcy5wb2xsVHJhbnNmb3JtISh2LCB0aGlzLmdldCgpKSkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFdhdGNoKCkge1xuICAgICAgICBpZiAodGhpcy5fd2F0Y2gpXG4gICAgICAgICAgICByZXR1cm5cblxuICAgICAgICB0aGlzLl93YXRjaCA9IHN1YnByb2Nlc3Moe1xuICAgICAgICAgICAgY21kOiB0aGlzLndhdGNoRXhlYyEsXG4gICAgICAgICAgICBvdXQ6IG91dCA9PiB0aGlzLnNldCh0aGlzLndhdGNoVHJhbnNmb3JtIShvdXQsIHRoaXMuZ2V0KCkpKSxcbiAgICAgICAgICAgIGVycjogZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVyciksXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgc3RvcFBvbGwoKSB7XG4gICAgICAgIHRoaXMuX3BvbGw/LmNhbmNlbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl9wb2xsXG4gICAgfVxuXG4gICAgc3RvcFdhdGNoKCkge1xuICAgICAgICB0aGlzLl93YXRjaD8ua2lsbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl93YXRjaFxuICAgIH1cblxuICAgIGlzUG9sbGluZygpIHsgcmV0dXJuICEhdGhpcy5fcG9sbCB9XG4gICAgaXNXYXRjaGluZygpIHsgcmV0dXJuICEhdGhpcy5fd2F0Y2ggfVxuXG4gICAgZHJvcCgpIHtcbiAgICAgICAgdGhpcy52YXJpYWJsZS5lbWl0KFwiZHJvcHBlZFwiKVxuICAgIH1cblxuICAgIG9uRHJvcHBlZChjYWxsYmFjazogKCkgPT4gdm9pZCkge1xuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJkcm9wcGVkXCIsIGNhbGxiYWNrKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb25FcnJvcihjYWxsYmFjazogKGVycjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmVyckhhbmRsZXJcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gY2FsbGJhY2soZXJyKSlcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGlkID0gdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiY2hhbmdlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICB9KVxuICAgICAgICByZXR1cm4gKCkgPT4gdGhpcy52YXJpYWJsZS5kaXNjb25uZWN0KGlkKVxuICAgIH1cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgY2FsbGJhY2s6IChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPlxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSB8ICgocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD4pLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wUG9sbCgpXG4gICAgICAgIHRoaXMucG9sbEludGVydmFsID0gaW50ZXJ2YWxcbiAgICAgICAgdGhpcy5wb2xsVHJhbnNmb3JtID0gdHJhbnNmb3JtXG4gICAgICAgIGlmICh0eXBlb2YgZXhlYyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxGbiA9IGV4ZWNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBvbGxFeGVjXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxFeGVjID0gZXhlY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucG9sbEZuXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zdGFydFBvbGwoKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgd2F0Y2goXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wV2F0Y2goKVxuICAgICAgICB0aGlzLndhdGNoRXhlYyA9IGV4ZWNcbiAgICAgICAgdGhpcy53YXRjaFRyYW5zZm9ybSA9IHRyYW5zZm9ybVxuICAgICAgICB0aGlzLnN0YXJ0V2F0Y2goKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqczogQXJyYXk8W29iajogQ29ubmVjdGFibGUsIHNpZ25hbDogc3RyaW5nXT4sXG4gICAgICAgIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9iajogQ29ubmVjdGFibGUsXG4gICAgICAgIHNpZ25hbDogc3RyaW5nLFxuICAgICAgICBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmpzOiBDb25uZWN0YWJsZSB8IEFycmF5PFtvYmo6IENvbm5lY3RhYmxlLCBzaWduYWw6IHN0cmluZ10+LFxuICAgICAgICBzaWdPckZuOiBzdHJpbmcgfCAoKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiBUKSxcbiAgICAgICAgY2FsbGJhY2s/OiAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0eXBlb2Ygc2lnT3JGbiA9PT0gXCJmdW5jdGlvblwiID8gc2lnT3JGbiA6IGNhbGxiYWNrID8/ICgoKSA9PiB0aGlzLmdldCgpKVxuICAgICAgICBjb25zdCBzZXQgPSAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IHRoaXMuc2V0KGYob2JqLCAuLi5hcmdzKSlcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvYmpzKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBvYmogb2Ygb2Jqcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtvLCBzXSA9IG9ialxuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gby5jb25uZWN0KHMsIHNldClcbiAgICAgICAgICAgICAgICB0aGlzLm9uRHJvcHBlZCgoKSA9PiBvLmRpc2Nvbm5lY3QoaWQpKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBzaWdPckZuID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWQgPSBvYmpzLmNvbm5lY3Qoc2lnT3JGbiwgc2V0KVxuICAgICAgICAgICAgICAgIHRoaXMub25Ecm9wcGVkKCgpID0+IG9ianMuZGlzY29ubmVjdChpZCkpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgc3RhdGljIGRlcml2ZTxcbiAgICAgICAgY29uc3QgRGVwcyBleHRlbmRzIEFycmF5PFN1YnNjcmliYWJsZTxhbnk+PixcbiAgICAgICAgQXJncyBleHRlbmRzIHtcbiAgICAgICAgICAgIFtLIGluIGtleW9mIERlcHNdOiBEZXBzW0tdIGV4dGVuZHMgU3Vic2NyaWJhYmxlPGluZmVyIFQ+ID8gVCA6IG5ldmVyXG4gICAgICAgIH0sXG4gICAgICAgIFYgPSBBcmdzLFxuICAgID4oZGVwczogRGVwcywgZm46ICguLi5hcmdzOiBBcmdzKSA9PiBWID0gKC4uLmFyZ3MpID0+IGFyZ3MgYXMgdW5rbm93biBhcyBWKSB7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IGZuKC4uLmRlcHMubWFwKGQgPT4gZC5nZXQoKSkgYXMgQXJncylcbiAgICAgICAgY29uc3QgZGVyaXZlZCA9IG5ldyBWYXJpYWJsZSh1cGRhdGUoKSlcbiAgICAgICAgY29uc3QgdW5zdWJzID0gZGVwcy5tYXAoZGVwID0+IGRlcC5zdWJzY3JpYmUoKCkgPT4gZGVyaXZlZC5zZXQodXBkYXRlKCkpKSlcbiAgICAgICAgZGVyaXZlZC5vbkRyb3BwZWQoKCkgPT4gdW5zdWJzLm1hcCh1bnN1YiA9PiB1bnN1YigpKSlcbiAgICAgICAgcmV0dXJuIGRlcml2ZWRcbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmFyaWFibGU8VD4gZXh0ZW5kcyBPbWl0PFZhcmlhYmxlV3JhcHBlcjxUPiwgXCJiaW5kXCI+IHtcbiAgICA8Uj4odHJhbnNmb3JtOiAodmFsdWU6IFQpID0+IFIpOiBCaW5kaW5nPFI+XG4gICAgKCk6IEJpbmRpbmc8VD5cbn1cblxuZXhwb3J0IGNvbnN0IFZhcmlhYmxlID0gbmV3IFByb3h5KFZhcmlhYmxlV3JhcHBlciBhcyBhbnksIHtcbiAgICBhcHBseTogKF90LCBfYSwgYXJncykgPT4gbmV3IFZhcmlhYmxlV3JhcHBlcihhcmdzWzBdKSxcbn0pIGFzIHtcbiAgICBkZXJpdmU6IHR5cGVvZiBWYXJpYWJsZVdyYXBwZXJbXCJkZXJpdmVcIl1cbiAgICA8VD4oaW5pdDogVCk6IFZhcmlhYmxlPFQ+XG4gICAgbmV3PFQ+KGluaXQ6IFQpOiBWYXJpYWJsZTxUPlxufVxuXG5leHBvcnQgY29uc3QgeyBkZXJpdmUgfSA9IFZhcmlhYmxlXG5leHBvcnQgZGVmYXVsdCBWYXJpYWJsZVxuIiwgImV4cG9ydCBjb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuZXhwb3J0IGNvbnN0IGtlYmFiaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMS0kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiX1wiLCBcIi1cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5leHBvcnQgaW50ZXJmYWNlIFN1YnNjcmliYWJsZTxUID0gdW5rbm93bj4ge1xuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKTogKCkgPT4gdm9pZFxuICAgIGdldCgpOiBUXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29ubmVjdGFibGUge1xuICAgIGNvbm5lY3Qoc2lnbmFsOiBzdHJpbmcsIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IHVua25vd24pOiBudW1iZXJcbiAgICBkaXNjb25uZWN0KGlkOiBudW1iZXIpOiB2b2lkXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBjbGFzcyBCaW5kaW5nPFZhbHVlPiB7XG4gICAgcHJpdmF0ZSB0cmFuc2Zvcm1GbiA9ICh2OiBhbnkpID0+IHZcblxuICAgICNlbWl0dGVyOiBTdWJzY3JpYmFibGU8VmFsdWU+IHwgQ29ubmVjdGFibGVcbiAgICAjcHJvcD86IHN0cmluZ1xuXG4gICAgc3RhdGljIGJpbmQ8XG4gICAgICAgIFQgZXh0ZW5kcyBDb25uZWN0YWJsZSxcbiAgICAgICAgUCBleHRlbmRzIGtleW9mIFQsXG4gICAgPihvYmplY3Q6IFQsIHByb3BlcnR5OiBQKTogQmluZGluZzxUW1BdPlxuXG4gICAgc3RhdGljIGJpbmQ8VD4ob2JqZWN0OiBTdWJzY3JpYmFibGU8VD4pOiBCaW5kaW5nPFQ+XG5cbiAgICBzdGF0aWMgYmluZChlbWl0dGVyOiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSwgcHJvcD86IHN0cmluZykge1xuICAgICAgICByZXR1cm4gbmV3IEJpbmRpbmcoZW1pdHRlciwgcHJvcClcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdG9yKGVtaXR0ZXI6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlPFZhbHVlPiwgcHJvcD86IHN0cmluZykge1xuICAgICAgICB0aGlzLiNlbWl0dGVyID0gZW1pdHRlclxuICAgICAgICB0aGlzLiNwcm9wID0gcHJvcCAmJiBrZWJhYmlmeShwcm9wKVxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gYEJpbmRpbmc8JHt0aGlzLiNlbWl0dGVyfSR7dGhpcy4jcHJvcCA/IGAsIFwiJHt0aGlzLiNwcm9wfVwiYCA6IFwiXCJ9PmBcbiAgICB9XG5cbiAgICBhczxUPihmbjogKHY6IFZhbHVlKSA9PiBUKTogQmluZGluZzxUPiB7XG4gICAgICAgIGNvbnN0IGJpbmQgPSBuZXcgQmluZGluZyh0aGlzLiNlbWl0dGVyLCB0aGlzLiNwcm9wKVxuICAgICAgICBiaW5kLnRyYW5zZm9ybUZuID0gKHY6IFZhbHVlKSA9PiBmbih0aGlzLnRyYW5zZm9ybUZuKHYpKVxuICAgICAgICByZXR1cm4gYmluZCBhcyB1bmtub3duIGFzIEJpbmRpbmc8VD5cbiAgICB9XG5cbiAgICBnZXQoKTogVmFsdWUge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuZ2V0ID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyLmdldCgpKVxuXG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jcHJvcCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgY29uc3QgZ2V0dGVyID0gYGdldF8ke3NuYWtlaWZ5KHRoaXMuI3Byb3ApfWBcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlcltnZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlcltnZXR0ZXJdKCkpXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXJbdGhpcy4jcHJvcF0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbiBub3QgZ2V0IHZhbHVlIG9mIGJpbmRpbmdcIilcbiAgICB9XG5cbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVmFsdWUpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLnN1YnNjcmliZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy4jZW1pdHRlci5zdWJzY3JpYmUoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgY29uc3Qgc2lnbmFsID0gYG5vdGlmeTo6JHt0aGlzLiNwcm9wfWBcbiAgICAgICAgICAgIGNvbnN0IGlkID0gdGhpcy4jZW1pdHRlci5jb25uZWN0KHNpZ25hbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICAodGhpcy4jZW1pdHRlci5kaXNjb25uZWN0IGFzIENvbm5lY3RhYmxlW1wiZGlzY29ubmVjdFwiXSkoaWQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgRXJyb3IoYCR7dGhpcy4jZW1pdHRlcn0gaXMgbm90IGJpbmRhYmxlYClcbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCB7IGJpbmQgfSA9IEJpbmRpbmdcbmV4cG9ydCBkZWZhdWx0IEJpbmRpbmdcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5cbmV4cG9ydCB0eXBlIFRpbWUgPSBBc3RhbC5UaW1lXG5leHBvcnQgY29uc3QgVGltZSA9IEFzdGFsLlRpbWVcblxuZXhwb3J0IGZ1bmN0aW9uIGludGVydmFsKGludGVydmFsOiBudW1iZXIsIGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLmludGVydmFsKGludGVydmFsLCAoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXQodGltZW91dDogbnVtYmVyLCBjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS50aW1lb3V0KHRpbWVvdXQsICgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaWRsZShjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS5pZGxlKCgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcblxudHlwZSBBcmdzID0ge1xuICAgIGNtZDogc3RyaW5nIHwgc3RyaW5nW11cbiAgICBvdXQ/OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWRcbiAgICBlcnI/OiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWRcbn1cblxuZXhwb3J0IHR5cGUgUHJvY2VzcyA9IEFzdGFsLlByb2Nlc3NcbmV4cG9ydCBjb25zdCBQcm9jZXNzID0gQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhhcmdzOiBBcmdzKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBjbWQ6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgIG9uT3V0PzogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkLFxuICAgIG9uRXJyPzogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkLFxuKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBhcmdzT3JDbWQ6IEFyZ3MgfCBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICBvbk91dDogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkID0gcHJpbnQsXG4gICAgb25FcnI6IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZCA9IHByaW50ZXJyLFxuKSB7XG4gICAgY29uc3QgYXJncyA9IEFycmF5LmlzQXJyYXkoYXJnc09yQ21kKSB8fCB0eXBlb2YgYXJnc09yQ21kID09PSBcInN0cmluZ1wiXG4gICAgY29uc3QgeyBjbWQsIGVyciwgb3V0IH0gPSB7XG4gICAgICAgIGNtZDogYXJncyA/IGFyZ3NPckNtZCA6IGFyZ3NPckNtZC5jbWQsXG4gICAgICAgIGVycjogYXJncyA/IG9uRXJyIDogYXJnc09yQ21kLmVyciB8fCBvbkVycixcbiAgICAgICAgb3V0OiBhcmdzID8gb25PdXQgOiBhcmdzT3JDbWQub3V0IHx8IG9uT3V0LFxuICAgIH1cblxuICAgIGNvbnN0IHByb2MgPSBBcnJheS5pc0FycmF5KGNtZClcbiAgICAgICAgPyBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3N2KGNtZClcbiAgICAgICAgOiBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3MoY21kKVxuXG4gICAgcHJvYy5jb25uZWN0KFwic3Rkb3V0XCIsIChfLCBzdGRvdXQ6IHN0cmluZykgPT4gb3V0KHN0ZG91dCkpXG4gICAgcHJvYy5jb25uZWN0KFwic3RkZXJyXCIsIChfLCBzdGRlcnI6IHN0cmluZykgPT4gZXJyKHN0ZGVycikpXG4gICAgcmV0dXJuIHByb2Ncbn1cblxuLyoqIEB0aHJvd3Mge0dMaWIuRXJyb3J9IFRocm93cyBzdGRlcnIgKi9cbmV4cG9ydCBmdW5jdGlvbiBleGVjKGNtZDogc3RyaW5nIHwgc3RyaW5nW10pIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShjbWQpXG4gICAgICAgID8gQXN0YWwuUHJvY2Vzcy5leGVjdihjbWQpXG4gICAgICAgIDogQXN0YWwuUHJvY2Vzcy5leGVjKGNtZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4ZWNBc3luYyhjbWQ6IHN0cmluZyB8IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjbWQpKSB7XG4gICAgICAgICAgICBBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmN2KGNtZCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jdl9maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEFzdGFsLlByb2Nlc3MuZXhlY19hc3luYyhjbWQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLlByb2Nlc3MuZXhlY19maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiaW1wb3J0IFZhcmlhYmxlIGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbmltcG9ydCB7IGV4ZWNBc3luYyB9IGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuaW1wb3J0IEJpbmRpbmcsIHsgQ29ubmVjdGFibGUsIGtlYmFiaWZ5LCBzbmFrZWlmeSwgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCBjb25zdCBub0ltcGxpY2l0RGVzdHJveSA9IFN5bWJvbChcIm5vIG5vIGltcGxpY2l0IGRlc3Ryb3lcIilcbmV4cG9ydCBjb25zdCBzZXRDaGlsZHJlbiA9IFN5bWJvbChcImNoaWxkcmVuIHNldHRlciBtZXRob2RcIilcblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQmluZGluZ3MoYXJyYXk6IGFueVtdKSB7XG4gICAgZnVuY3Rpb24gZ2V0VmFsdWVzKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgIGxldCBpID0gMFxuICAgICAgICByZXR1cm4gYXJyYXkubWFwKHZhbHVlID0+IHZhbHVlIGluc3RhbmNlb2YgQmluZGluZ1xuICAgICAgICAgICAgPyBhcmdzW2krK11cbiAgICAgICAgICAgIDogdmFsdWUsXG4gICAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBiaW5kaW5ncyA9IGFycmF5LmZpbHRlcihpID0+IGkgaW5zdGFuY2VvZiBCaW5kaW5nKVxuXG4gICAgaWYgKGJpbmRpbmdzLmxlbmd0aCA9PT0gMClcbiAgICAgICAgcmV0dXJuIGFycmF5XG5cbiAgICBpZiAoYmluZGluZ3MubGVuZ3RoID09PSAxKVxuICAgICAgICByZXR1cm4gYmluZGluZ3NbMF0uYXMoZ2V0VmFsdWVzKVxuXG4gICAgcmV0dXJuIFZhcmlhYmxlLmRlcml2ZShiaW5kaW5ncywgZ2V0VmFsdWVzKSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRQcm9wKG9iajogYW55LCBwcm9wOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzZXR0ZXIgPSBgc2V0XyR7c25ha2VpZnkocHJvcCl9YFxuICAgICAgICBpZiAodHlwZW9mIG9ialtzZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gb2JqW3NldHRlcl0odmFsdWUpXG5cbiAgICAgICAgcmV0dXJuIChvYmpbcHJvcF0gPSB2YWx1ZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBjb3VsZCBub3Qgc2V0IHByb3BlcnR5IFwiJHtwcm9wfVwiIG9uICR7b2JqfTpgLCBlcnJvcilcbiAgICB9XG59XG5cbmV4cG9ydCB0eXBlIEJpbmRhYmxlUHJvcHM8VD4gPSB7XG4gICAgW0sgaW4ga2V5b2YgVF06IEJpbmRpbmc8VFtLXT4gfCBUW0tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaG9vazxXaWRnZXQgZXh0ZW5kcyBDb25uZWN0YWJsZT4oXG4gICAgd2lkZ2V0OiBXaWRnZXQsXG4gICAgb2JqZWN0OiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSxcbiAgICBzaWduYWxPckNhbGxiYWNrOiBzdHJpbmcgfCAoKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQpLFxuICAgIGNhbGxiYWNrPzogKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4pIHtcbiAgICBpZiAodHlwZW9mIG9iamVjdC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIgJiYgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgaWQgPSBvYmplY3QuY29ubmVjdChzaWduYWxPckNhbGxiYWNrLCAoXzogYW55LCAuLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCAoKSA9PiB7XG4gICAgICAgICAgICAob2JqZWN0LmRpc2Nvbm5lY3QgYXMgQ29ubmVjdGFibGVbXCJkaXNjb25uZWN0XCJdKShpZClcbiAgICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvYmplY3Quc3Vic2NyaWJlID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIHNpZ25hbE9yQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCB1bnN1YiA9IG9iamVjdC5zdWJzY3JpYmUoKC4uLmFyZ3M6IHVua25vd25bXSkgPT4ge1xuICAgICAgICAgICAgc2lnbmFsT3JDYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCB1bnN1YilcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25zdHJ1Y3Q8V2lkZ2V0IGV4dGVuZHMgQ29ubmVjdGFibGUgJiB7IFtzZXRDaGlsZHJlbl06IChjaGlsZHJlbjogYW55W10pID0+IHZvaWQgfT4od2lkZ2V0OiBXaWRnZXQsIGNvbmZpZzogYW55KSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHByZWZlci1jb25zdFxuICAgIGxldCB7IHNldHVwLCBjaGlsZCwgY2hpbGRyZW4gPSBbXSwgLi4ucHJvcHMgfSA9IGNvbmZpZ1xuXG4gICAgaWYgKGNoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cbiAgICB9XG5cbiAgICBpZiAoY2hpbGQpIHtcbiAgICAgICAgY2hpbGRyZW4udW5zaGlmdChjaGlsZClcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgdW5kZWZpbmVkIHZhbHVlc1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNvbGxlY3QgYmluZGluZ3NcbiAgICBjb25zdCBiaW5kaW5nczogQXJyYXk8W3N0cmluZywgQmluZGluZzxhbnk+XT4gPSBPYmplY3RcbiAgICAgICAgLmtleXMocHJvcHMpXG4gICAgICAgIC5yZWR1Y2UoKGFjYzogYW55LCBwcm9wKSA9PiB7XG4gICAgICAgICAgICBpZiAocHJvcHNbcHJvcF0gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmluZGluZyA9IHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5hY2MsIFtwcm9wLCBiaW5kaW5nXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBjb2xsZWN0IHNpZ25hbCBoYW5kbGVyc1xuICAgIGNvbnN0IG9uSGFuZGxlcnM6IEFycmF5PFtzdHJpbmcsIHN0cmluZyB8ICgoKSA9PiB1bmtub3duKV0+ID0gT2JqZWN0XG4gICAgICAgIC5rZXlzKHByb3BzKVxuICAgICAgICAucmVkdWNlKChhY2M6IGFueSwga2V5KSA9PiB7XG4gICAgICAgICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoXCJvblwiKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNpZyA9IGtlYmFiaWZ5KGtleSkuc3BsaXQoXCItXCIpLnNsaWNlKDEpLmpvaW4oXCItXCIpXG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlciA9IHByb3BzW2tleV1cbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICAgICAgICAgIHJldHVybiBbLi4uYWNjLCBbc2lnLCBoYW5kbGVyXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBzZXQgY2hpbGRyZW5cbiAgICBjb25zdCBtZXJnZWRDaGlsZHJlbiA9IG1lcmdlQmluZGluZ3MoY2hpbGRyZW4uZmxhdChJbmZpbml0eSkpXG4gICAgaWYgKG1lcmdlZENoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuLmdldCgpKVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgbWVyZ2VkQ2hpbGRyZW4uc3Vic2NyaWJlKCh2KSA9PiB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKHYpXG4gICAgICAgIH0pKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChtZXJnZWRDaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0dXAgc2lnbmFsIGhhbmRsZXJzXG4gICAgZm9yIChjb25zdCBbc2lnbmFsLCBjYWxsYmFja10gb2Ygb25IYW5kbGVycykge1xuICAgICAgICBjb25zdCBzaWcgPSBzaWduYWwuc3RhcnRzV2l0aChcIm5vdGlmeVwiKVxuICAgICAgICAgICAgPyBzaWduYWwucmVwbGFjZShcIi1cIiwgXCI6OlwiKVxuICAgICAgICAgICAgOiBzaWduYWxcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KHNpZywgY2FsbGJhY2spXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChzaWcsICgpID0+IGV4ZWNBc3luYyhjYWxsYmFjaylcbiAgICAgICAgICAgICAgICAudGhlbihwcmludCkuY2F0Y2goY29uc29sZS5lcnJvcikpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZXR1cCBiaW5kaW5ncyBoYW5kbGVyc1xuICAgIGZvciAoY29uc3QgW3Byb3AsIGJpbmRpbmddIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGlmIChwcm9wID09PSBcImNoaWxkXCIgfHwgcHJvcCA9PT0gXCJjaGlsZHJlblwiKSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgYmluZGluZy5zdWJzY3JpYmUoKHY6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0odilcbiAgICAgICAgICAgIH0pKVxuICAgICAgICB9XG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBiaW5kaW5nLnN1YnNjcmliZSgodjogYW55KSA9PiB7XG4gICAgICAgICAgICBzZXRQcm9wKHdpZGdldCwgcHJvcCwgdilcbiAgICAgICAgfSkpXG4gICAgICAgIHNldFByb3Aod2lkZ2V0LCBwcm9wLCBiaW5kaW5nLmdldCgpKVxuICAgIH1cblxuICAgIC8vIGZpbHRlciB1bmRlZmluZWQgdmFsdWVzXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHByb3BzKVxuICAgIHNldHVwPy4od2lkZ2V0KVxuICAgIHJldHVybiB3aWRnZXRcbn1cblxuZnVuY3Rpb24gaXNBcnJvd0Z1bmN0aW9uKGZ1bmM6IGFueSk6IGZ1bmMgaXMgKGFyZ3M6IGFueSkgPT4gYW55IHtcbiAgICByZXR1cm4gIU9iamVjdC5oYXNPd24oZnVuYywgXCJwcm90b3R5cGVcIilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yczogUmVjb3JkPHN0cmluZywgeyBuZXcocHJvcHM6IGFueSk6IGFueSB9IHwgKChwcm9wczogYW55KSA9PiBhbnkpPixcbiAgICBjdG9yOiBzdHJpbmcgfCAoKHByb3BzOiBhbnkpID0+IGFueSkgfCB7IG5ldyhwcm9wczogYW55KTogYW55IH0sXG4gICAgeyBjaGlsZHJlbiwgLi4ucHJvcHMgfTogYW55LFxuKSB7XG4gICAgY2hpbGRyZW4gPz89IFtdXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKVxuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cblxuICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmlsdGVyKEJvb2xlYW4pXG5cbiAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID09PSAxKVxuICAgICAgICBwcm9wcy5jaGlsZCA9IGNoaWxkcmVuWzBdXG4gICAgZWxzZSBpZiAoY2hpbGRyZW4ubGVuZ3RoID4gMSlcbiAgICAgICAgcHJvcHMuY2hpbGRyZW4gPSBjaGlsZHJlblxuXG4gICAgaWYgKHR5cGVvZiBjdG9yID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChpc0Fycm93RnVuY3Rpb24oY3RvcnNbY3Rvcl0pKVxuICAgICAgICAgICAgcmV0dXJuIGN0b3JzW2N0b3JdKHByb3BzKVxuXG4gICAgICAgIHJldHVybiBuZXcgY3RvcnNbY3Rvcl0ocHJvcHMpXG4gICAgfVxuXG4gICAgaWYgKGlzQXJyb3dGdW5jdGlvbihjdG9yKSlcbiAgICAgICAgcmV0dXJuIGN0b3IocHJvcHMpXG5cbiAgICByZXR1cm4gbmV3IGN0b3IocHJvcHMpXG59XG4iLCAiaW1wb3J0IHsgbm9JbXBsaWNpdERlc3Ryb3ksIHNldENoaWxkcmVuLCB0eXBlIEJpbmRhYmxlUHJvcHMsIGNvbnN0cnVjdCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEJpbmRpbmcgZnJvbSBcIi4uL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgY29uc3QgdHlwZSA9IFN5bWJvbChcImNoaWxkIHR5cGVcIilcbmNvbnN0IGR1bW15QnVsZGVyID0gbmV3IEd0ay5CdWlsZGVyXG5cbmZ1bmN0aW9uIF9nZXRDaGlsZHJlbih3aWRnZXQ6IEd0ay5XaWRnZXQpOiBBcnJheTxHdGsuV2lkZ2V0PiB7XG4gICAgaWYgKFwiZ2V0X2NoaWxkXCIgaW4gd2lkZ2V0ICYmIHR5cGVvZiB3aWRnZXQuZ2V0X2NoaWxkID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gd2lkZ2V0LmdldF9jaGlsZCgpID8gW3dpZGdldC5nZXRfY2hpbGQoKV0gOiBbXVxuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkcmVuOiBBcnJheTxHdGsuV2lkZ2V0PiA9IFtdXG4gICAgbGV0IGNoID0gd2lkZ2V0LmdldF9maXJzdF9jaGlsZCgpXG4gICAgd2hpbGUgKGNoICE9PSBudWxsKSB7XG4gICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgIGNoID0gY2guZ2V0X25leHRfc2libGluZygpXG4gICAgfVxuICAgIHJldHVybiBjaGlsZHJlblxufVxuXG5mdW5jdGlvbiBfc2V0Q2hpbGRyZW4od2lkZ2V0OiBHdGsuV2lkZ2V0LCBjaGlsZHJlbjogYW55W10pIHtcbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xuICAgICAgICB3aWRnZXQudmZ1bmNfYWRkX2NoaWxkKFxuICAgICAgICAgICAgZHVtbXlCdWxkZXIsXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIHR5cGUgaW4gY2hpbGQgPyBjaGlsZFt0eXBlXSA6IG51bGwsXG4gICAgICAgIClcbiAgICB9XG59XG5cbnR5cGUgQ29uZmlnPFQgZXh0ZW5kcyBHdGsuV2lkZ2V0PiA9IHtcbiAgICBzZXRDaGlsZHJlbih3aWRnZXQ6IFQsIGNoaWxkcmVuOiBhbnlbXSk6IHZvaWRcbiAgICBnZXRDaGlsZHJlbih3aWRnZXQ6IFQpOiBBcnJheTxHdGsuV2lkZ2V0PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhc3RhbGlmeTxcbiAgICBXaWRnZXQgZXh0ZW5kcyBHdGsuV2lkZ2V0LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzID0gR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4oY2xzOiB7IG5ldyguLi5hcmdzOiBhbnlbXSk6IFdpZGdldCB9LCBjb25maWc6IFBhcnRpYWw8Q29uZmlnPFdpZGdldD4+ID0ge30pIHtcbiAgICBPYmplY3QuYXNzaWduKGNscy5wcm90b3R5cGUsIHtcbiAgICAgICAgW3NldENoaWxkcmVuXShjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIGNvbnN0IHcgPSB0aGlzIGFzIHVua25vd24gYXMgV2lkZ2V0XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIChjb25maWcuZ2V0Q2hpbGRyZW4/Lih3KSB8fCBfZ2V0Q2hpbGRyZW4odykpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgR3RrLldpZGdldCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZC51bnBhcmVudCgpXG4gICAgICAgICAgICAgICAgICAgIGlmICghY2hpbGRyZW4uaW5jbHVkZXMoY2hpbGQpICYmIG5vSW1wbGljaXREZXN0cm95IGluIHRoaXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZC5ydW5fZGlzcG9zZSgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY29uZmlnLnNldENoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnNldENoaWxkcmVuKHcsIGNoaWxkcmVuKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBfc2V0Q2hpbGRyZW4odywgY2hpbGRyZW4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICAgIFtjbHMubmFtZV06IChcbiAgICAgICAgICAgIHByb3BzOiBDb25zdHJ1Y3RQcm9wczxXaWRnZXQsIFByb3BzLCBTaWduYWxzPiA9IHt9LFxuICAgICAgICAgICAgLi4uY2hpbGRyZW46IGFueVtdXG4gICAgICAgICk6IFdpZGdldCA9PiB7XG4gICAgICAgICAgICBjb25zdCB3aWRnZXQgPSBuZXcgY2xzKFwiY3NzTmFtZVwiIGluIHByb3BzID8geyBjc3NOYW1lOiBwcm9wcy5jc3NOYW1lIH0gOiB7fSlcblxuICAgICAgICAgICAgaWYgKFwiY3NzTmFtZVwiIGluIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLmNzc05hbWVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHByb3BzLm5vSW1wbGljaXREZXN0cm95KSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHsgW25vSW1wbGljaXREZXN0cm95XTogdHJ1ZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5ub0ltcGxpY2l0RGVzdHJveVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocHJvcHMudHlwZSkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCB7IFt0eXBlXTogcHJvcHMudHlwZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy50eXBlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihwcm9wcywgeyBjaGlsZHJlbiB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gY29uc3RydWN0KHdpZGdldCBhcyBhbnksIHNldHVwQ29udHJvbGxlcnMod2lkZ2V0LCBwcm9wcyBhcyBhbnkpKVxuICAgICAgICB9LFxuICAgIH1bY2xzLm5hbWVdXG59XG5cbnR5cGUgU2lnSGFuZGxlcjxcbiAgICBXIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBBcmdzIGV4dGVuZHMgQXJyYXk8dW5rbm93bj4sXG4+ID0gKChzZWxmOiBXLCAuLi5hcmdzOiBBcmdzKSA9PiB1bmtub3duKSB8IHN0cmluZyB8IHN0cmluZ1tdXG5cbmV4cG9ydCB7IEJpbmRhYmxlUHJvcHMgfVxuZXhwb3J0IHR5cGUgQmluZGFibGVDaGlsZCA9IEd0ay5XaWRnZXQgfCBCaW5kaW5nPEd0ay5XaWRnZXQ+XG5cbmV4cG9ydCB0eXBlIENvbnN0cnVjdFByb3BzPFxuICAgIFNlbGYgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4gPSBQYXJ0aWFsPHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNhbid0IGFzc2lnbiB0byB1bmtub3duLCBidXQgaXQgd29ya3MgYXMgZXhwZWN0ZWQgdGhvdWdoXG4gICAgW1MgaW4ga2V5b2YgU2lnbmFsc106IFNpZ0hhbmRsZXI8U2VsZiwgU2lnbmFsc1tTXT5cbn0+ICYgUGFydGlhbDx7XG4gICAgW0tleSBpbiBgb24ke3N0cmluZ31gXTogU2lnSGFuZGxlcjxTZWxmLCBhbnlbXT5cbn0+ICYgUGFydGlhbDxCaW5kYWJsZVByb3BzPE9taXQ8UHJvcHMsIFwiY3NzTmFtZVwiIHwgXCJjc3NfbmFtZVwiPj4+ICYge1xuICAgIG5vSW1wbGljaXREZXN0cm95PzogdHJ1ZVxuICAgIHR5cGU/OiBzdHJpbmdcbiAgICBjc3NOYW1lPzogc3RyaW5nXG59ICYgRXZlbnRDb250cm9sbGVyPFNlbGY+ICYge1xuICAgIG9uRGVzdHJveT86IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgc2V0dXA/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxufVxuXG50eXBlIEV2ZW50Q29udHJvbGxlcjxTZWxmIGV4dGVuZHMgR3RrLldpZGdldD4gPSB7XG4gICAgb25Gb2N1c0VudGVyPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbkZvY3VzTGVhdmU/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuXG4gICAgb25LZXlQcmVzc2VkPzogKHNlbGY6IFNlbGYsIGtleXZhbDogbnVtYmVyLCBrZXljb2RlOiBudW1iZXIsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG4gICAgb25LZXlSZWxlYXNlZD86IChzZWxmOiBTZWxmLCBrZXl2YWw6IG51bWJlciwga2V5Y29kZTogbnVtYmVyLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuICAgIG9uS2V5TW9kaWZpZXI/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcblxuICAgIG9uTGVnYWN5PzogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHZvaWRcbiAgICBvbkJ1dHRvblByZXNzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuICAgIG9uQnV0dG9uUmVsZWFzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuXG4gICAgb25Ib3ZlckVudGVyPzogKHNlbGY6IFNlbGYsIHg6IG51bWJlciwgeTogbnVtYmVyKSA9PiB2b2lkXG4gICAgb25Ib3ZlckxlYXZlPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbk1vdGlvbj86IChzZWxmOiBTZWxmLCB4OiBudW1iZXIsIHk6IG51bWJlcikgPT4gdm9pZFxuXG4gICAgb25TY3JvbGw/OiAoc2VsZjogU2VsZiwgZHg6IG51bWJlciwgZHk6IG51bWJlcikgPT4gdm9pZFxuICAgIG9uU2Nyb2xsRGVjZWxlcmF0ZT86IChzZWxmOiBTZWxmLCB2ZWxfeDogbnVtYmVyLCB2ZWxfeTogbnVtYmVyKSA9PiB2b2lkXG59XG5cbmZ1bmN0aW9uIHNldHVwQ29udHJvbGxlcnM8VD4od2lkZ2V0OiBHdGsuV2lkZ2V0LCB7XG4gICAgb25Gb2N1c0VudGVyLFxuICAgIG9uRm9jdXNMZWF2ZSxcbiAgICBvbktleVByZXNzZWQsXG4gICAgb25LZXlSZWxlYXNlZCxcbiAgICBvbktleU1vZGlmaWVyLFxuICAgIG9uTGVnYWN5LFxuICAgIG9uQnV0dG9uUHJlc3NlZCxcbiAgICBvbkJ1dHRvblJlbGVhc2VkLFxuICAgIG9uSG92ZXJFbnRlcixcbiAgICBvbkhvdmVyTGVhdmUsXG4gICAgb25Nb3Rpb24sXG4gICAgb25TY3JvbGwsXG4gICAgb25TY3JvbGxEZWNlbGVyYXRlLFxuICAgIC4uLnByb3BzXG59OiBFdmVudENvbnRyb2xsZXI8R3RrLldpZGdldD4gJiBUKSB7XG4gICAgaWYgKG9uRm9jdXNFbnRlciB8fCBvbkZvY3VzTGVhdmUpIHtcbiAgICAgICAgY29uc3QgZm9jdXMgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckZvY3VzXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihmb2N1cylcblxuICAgICAgICBpZiAob25Gb2N1c0VudGVyKVxuICAgICAgICAgICAgZm9jdXMuY29ubmVjdChcImVudGVyXCIsICgpID0+IG9uRm9jdXNFbnRlcih3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbkZvY3VzTGVhdmUpXG4gICAgICAgICAgICBmb2N1cy5jb25uZWN0KFwibGVhdmVcIiwgKCkgPT4gb25Gb2N1c0xlYXZlKHdpZGdldCkpXG4gICAgfVxuXG4gICAgaWYgKG9uS2V5UHJlc3NlZCB8fCBvbktleVJlbGVhc2VkIHx8IG9uS2V5TW9kaWZpZXIpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJLZXlcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGtleSlcblxuICAgICAgICBpZiAob25LZXlQcmVzc2VkKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJrZXktcHJlc3NlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlQcmVzc2VkKHdpZGdldCwgdmFsLCBjb2RlLCBzdGF0ZSkpXG5cbiAgICAgICAgaWYgKG9uS2V5UmVsZWFzZWQpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcImtleS1yZWxlYXNlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlSZWxlYXNlZCh3aWRnZXQsIHZhbCwgY29kZSwgc3RhdGUpKVxuXG4gICAgICAgIGlmIChvbktleU1vZGlmaWVyKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJtb2RpZmllcnNcIiwgKF8sIHN0YXRlKSA9PiBvbktleU1vZGlmaWVyKHdpZGdldCwgc3RhdGUpKVxuICAgIH1cblxuICAgIGlmIChvbkxlZ2FjeSB8fCBvbkJ1dHRvblByZXNzZWQgfHwgb25CdXR0b25SZWxlYXNlZCkge1xuICAgICAgICBjb25zdCBsZWdhY3kgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckxlZ2FjeVxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIobGVnYWN5KVxuXG4gICAgICAgIGxlZ2FjeS5jb25uZWN0KFwiZXZlbnRcIiwgKF8sIGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuZ2V0X2V2ZW50X3R5cGUoKSA9PT0gR2RrLkV2ZW50VHlwZS5CVVRUT05fUFJFU1MpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblByZXNzZWQ/Lih3aWRnZXQsIGV2ZW50IGFzIEdkay5CdXR0b25FdmVudClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGV2ZW50LmdldF9ldmVudF90eXBlKCkgPT09IEdkay5FdmVudFR5cGUuQlVUVE9OX1JFTEVBU0UpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblJlbGVhc2VkPy4od2lkZ2V0LCBldmVudCBhcyBHZGsuQnV0dG9uRXZlbnQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9uTGVnYWN5Py4od2lkZ2V0LCBldmVudClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob25Nb3Rpb24gfHwgb25Ib3ZlckVudGVyIHx8IG9uSG92ZXJMZWF2ZSkge1xuICAgICAgICBjb25zdCBob3ZlciA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyTW90aW9uXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihob3ZlcilcblxuICAgICAgICBpZiAob25Ib3ZlckVudGVyKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImVudGVyXCIsIChfLCB4LCB5KSA9PiBvbkhvdmVyRW50ZXIod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25Ib3ZlckxlYXZlKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImxlYXZlXCIsICgpID0+IG9uSG92ZXJMZWF2ZSh3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbk1vdGlvbilcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJtb3Rpb25cIiwgKF8sIHgsIHkpID0+IG9uTW90aW9uKHdpZGdldCwgeCwgeSkpXG4gICAgfVxuXG4gICAgaWYgKG9uU2Nyb2xsIHx8IG9uU2Nyb2xsRGVjZWxlcmF0ZSkge1xuICAgICAgICBjb25zdCBzY3JvbGwgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbFxuICAgICAgICBzY3JvbGwuZmxhZ3MgPSBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsRmxhZ3MuQk9USF9BWEVTIHwgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbEZsYWdzLktJTkVUSUNcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKHNjcm9sbClcblxuICAgICAgICBpZiAob25TY3JvbGwpXG4gICAgICAgICAgICBzY3JvbGwuY29ubmVjdChcInNjcm9sbFwiLCAoXywgeCwgeSkgPT4gb25TY3JvbGwod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25TY3JvbGxEZWNlbGVyYXRlKVxuICAgICAgICAgICAgc2Nyb2xsLmNvbm5lY3QoXCJkZWNlbGVyYXRlXCIsIChfLCB4LCB5KSA9PiBvblNjcm9sbERlY2VsZXJhdGUod2lkZ2V0LCB4LCB5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvcHNcbn1cbiIsICJpbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgeyBta0FwcCB9IGZyb20gXCIuLi9fYXBwXCJcblxuR3RrLmluaXQoKVxuXG4vLyBzdG9wIHRoaXMgZnJvbSBsZWFraW5nIGludG8gc3VicHJvY2Vzc2VzXG4vLyBhbmQgZ2lvIGxhdW5jaCBpbnZvY2F0aW9uc1xuR0xpYi51bnNldGVudihcIkxEX1BSRUxPQURcIilcblxuLy8gdXNlcnMgbWlnaHQgd2FudCB0byB1c2UgQWR3YWl0YSBpbiB3aGljaCBjYXNlIGl0IGhhcyB0byBiZSBpbml0aWFsaXplZFxuLy8gaXQgbWlnaHQgYmUgY29tbW9uIHBpdGZhbGwgdG8gZm9yZ2V0IGl0IGJlY2F1c2UgYEFwcGAgaXMgbm90IGBBZHcuQXBwbGljYXRpb25gXG5hd2FpdCBpbXBvcnQoXCJnaTovL0Fkdz92ZXJzaW9uPTFcIilcbiAgICAudGhlbigoeyBkZWZhdWx0OiBBZHcgfSkgPT4gQWR3LmluaXQoKSlcbiAgICAuY2F0Y2goKCkgPT4gdm9pZCAwKVxuXG5leHBvcnQgZGVmYXVsdCBta0FwcChBc3RhbC5BcHBsaWNhdGlvbilcbiIsICIvKipcbiAqIFdvcmthcm91bmQgZm9yIFwiQ2FuJ3QgY29udmVydCBub24tbnVsbCBwb2ludGVyIHRvIEpTIHZhbHVlIFwiXG4gKi9cblxuZXhwb3J0IHsgfVxuXG5jb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuYXN5bmMgZnVuY3Rpb24gc3VwcHJlc3M8VD4obW9kOiBQcm9taXNlPHsgZGVmYXVsdDogVCB9PiwgcGF0Y2g6IChtOiBUKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIG1vZC50aGVuKG0gPT4gcGF0Y2gobS5kZWZhdWx0KSkuY2F0Y2goKCkgPT4gdm9pZCAwKVxufVxuXG5mdW5jdGlvbiBwYXRjaDxQIGV4dGVuZHMgb2JqZWN0Pihwcm90bzogUCwgcHJvcDogRXh0cmFjdDxrZXlvZiBQLCBzdHJpbmc+KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCBwcm9wLCB7XG4gICAgICAgIGdldCgpIHsgcmV0dXJuIHRoaXNbYGdldF8ke3NuYWtlaWZ5KHByb3ApfWBdKCkgfSxcbiAgICB9KVxufVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQXBwc1wiKSwgKHsgQXBwcywgQXBwbGljYXRpb24gfSkgPT4ge1xuICAgIHBhdGNoKEFwcHMucHJvdG90eXBlLCBcImxpc3RcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwia2V5d29yZHNcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwiY2F0ZWdvcmllc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIiksICh7IFVQb3dlciB9KSA9PiB7XG4gICAgcGF0Y2goVVBvd2VyLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQmx1ZXRvb3RoXCIpLCAoeyBBZGFwdGVyLCBCbHVldG9vdGgsIERldmljZSB9KSA9PiB7XG4gICAgcGF0Y2goQWRhcHRlci5wcm90b3R5cGUsIFwidXVpZHNcIilcbiAgICBwYXRjaChCbHVldG9vdGgucHJvdG90eXBlLCBcImFkYXB0ZXJzXCIpXG4gICAgcGF0Y2goQmx1ZXRvb3RoLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goRGV2aWNlLnByb3RvdHlwZSwgXCJ1dWlkc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEh5cHJsYW5kXCIpLCAoeyBIeXBybGFuZCwgTW9uaXRvciwgV29ya3NwYWNlIH0pID0+IHtcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwiYmluZHNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwibW9uaXRvcnNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwid29ya3NwYWNlc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJjbGllbnRzXCIpXG4gICAgcGF0Y2goTW9uaXRvci5wcm90b3R5cGUsIFwiYXZhaWxhYmxlTW9kZXNcIilcbiAgICBwYXRjaChNb25pdG9yLnByb3RvdHlwZSwgXCJhdmFpbGFibGVfbW9kZXNcIilcbiAgICBwYXRjaChXb3Jrc3BhY2UucHJvdG90eXBlLCBcImNsaWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxNcHJpc1wiKSwgKHsgTXByaXMsIFBsYXllciB9KSA9PiB7XG4gICAgcGF0Y2goTXByaXMucHJvdG90eXBlLCBcInBsYXllcnNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZF91cmlfc2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkVXJpU2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkX21pbWVfdHlwZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZE1pbWVUeXBlc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwiY29tbWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxOZXR3b3JrXCIpLCAoeyBXaWZpIH0pID0+IHtcbiAgICBwYXRjaChXaWZpLnByb3RvdHlwZSwgXCJhY2Nlc3NfcG9pbnRzXCIpXG4gICAgcGF0Y2goV2lmaS5wcm90b3R5cGUsIFwiYWNjZXNzUG9pbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTm90aWZkXCIpLCAoeyBOb3RpZmQsIE5vdGlmaWNhdGlvbiB9KSA9PiB7XG4gICAgcGF0Y2goTm90aWZkLnByb3RvdHlwZSwgXCJub3RpZmljYXRpb25zXCIpXG4gICAgcGF0Y2goTm90aWZpY2F0aW9uLnByb3RvdHlwZSwgXCJhY3Rpb25zXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsUG93ZXJQcm9maWxlc1wiKSwgKHsgUG93ZXJQcm9maWxlcyB9KSA9PiB7XG4gICAgcGF0Y2goUG93ZXJQcm9maWxlcy5wcm90b3R5cGUsIFwiYWN0aW9uc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbFdwXCIpLCAoeyBXcCwgQXVkaW8sIFZpZGVvIH0pID0+IHtcbiAgICBwYXRjaChXcC5wcm90b3R5cGUsIFwiZW5kcG9pbnRzXCIpXG4gICAgcGF0Y2goV3AucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3RyZWFtc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJyZWNvcmRlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwibWljcm9waG9uZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3BlYWtlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzdHJlYW1zXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInJlY29yZGVyc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzaW5rc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzb3VyY2VzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcImRldmljZXNcIilcbn0pXG4iLCAiaW1wb3J0IFwiLi9vdmVycmlkZXMuanNcIlxuaW1wb3J0IHsgc2V0Q29uc29sZUxvZ0RvbWFpbiB9IGZyb20gXCJjb25zb2xlXCJcbmltcG9ydCB7IGV4aXQsIHByb2dyYW1BcmdzIH0gZnJvbSBcInN5c3RlbVwiXG5pbXBvcnQgSU8gZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcbmltcG9ydCB0eXBlIEFzdGFsMyBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgdHlwZSBBc3RhbDQgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuXG50eXBlIENvbmZpZyA9IFBhcnRpYWw8e1xuICAgIGluc3RhbmNlTmFtZTogc3RyaW5nXG4gICAgY3NzOiBzdHJpbmdcbiAgICBpY29uczogc3RyaW5nXG4gICAgZ3RrVGhlbWU6IHN0cmluZ1xuICAgIGljb25UaGVtZTogc3RyaW5nXG4gICAgY3Vyc29yVGhlbWU6IHN0cmluZ1xuICAgIGhvbGQ6IGJvb2xlYW5cbiAgICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0OiBzdHJpbmcsIHJlczogKHJlc3BvbnNlOiBhbnkpID0+IHZvaWQpOiB2b2lkXG4gICAgbWFpbiguLi5hcmdzOiBzdHJpbmdbXSk6IHZvaWRcbiAgICBjbGllbnQobWVzc2FnZTogKG1zZzogc3RyaW5nKSA9PiBzdHJpbmcsIC4uLmFyZ3M6IHN0cmluZ1tdKTogdm9pZFxufT5cblxuaW50ZXJmYWNlIEFzdGFsM0pTIGV4dGVuZHMgQXN0YWwzLkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyOiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldD86IGJvb2xlYW4pOiB2b2lkXG4gICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZFxuICAgIHN0YXJ0KGNvbmZpZz86IENvbmZpZyk6IHZvaWRcbn1cblxuaW50ZXJmYWNlIEFzdGFsNEpTIGV4dGVuZHMgQXN0YWw0LkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyPzogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cbiAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQ/OiBib29sZWFuKTogdm9pZFxuICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWRcbiAgICBzdGFydChjb25maWc/OiBDb25maWcpOiB2b2lkXG59XG5cbnR5cGUgQXBwMyA9IHR5cGVvZiBBc3RhbDMuQXBwbGljYXRpb25cbnR5cGUgQXBwNCA9IHR5cGVvZiBBc3RhbDQuQXBwbGljYXRpb25cblxuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwPEFwcCBleHRlbmRzIEFwcDM+KEFwcDogQXBwKTogQXN0YWwzSlNcbmV4cG9ydCBmdW5jdGlvbiBta0FwcDxBcHAgZXh0ZW5kcyBBcHA0PihBcHA6IEFwcCk6IEFzdGFsNEpTXG5cbmV4cG9ydCBmdW5jdGlvbiBta0FwcChBcHA6IEFwcDMgfCBBcHA0KSB7XG4gICAgcmV0dXJuIG5ldyAoY2xhc3MgQXN0YWxKUyBleHRlbmRzIEFwcCB7XG4gICAgICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJBc3RhbEpTXCIgfSwgdGhpcyBhcyBhbnkpIH1cblxuICAgICAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm4gPSBGdW5jdGlvbihgcmV0dXJuIChhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICR7Ym9keS5pbmNsdWRlcyhcIjtcIikgPyBib2R5IDogYHJldHVybiAke2JvZHl9O2B9XG4gICAgICAgICAgICAgICAgICAgIH0pYClcbiAgICAgICAgICAgICAgICAgICAgZm4oKSgpLnRoZW4ocmVzKS5jYXRjaChyZWopXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqKGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXF1ZXN0SGFuZGxlcj86IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG5cbiAgICAgICAgdmZ1bmNfcmVxdWVzdChtc2c6IHN0cmluZywgY29ubjogR2lvLlNvY2tldENvbm5lY3Rpb24pOiB2b2lkIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5yZXF1ZXN0SGFuZGxlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXF1ZXN0SGFuZGxlcihtc2csIChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrKGNvbm4sIFN0cmluZyhyZXNwb25zZSksIChfLCByZXMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrX2ZpbmlzaChyZXMpLFxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3VwZXIudmZ1bmNfcmVxdWVzdChtc2csIGNvbm4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQgPSBmYWxzZSkge1xuICAgICAgICAgICAgc3VwZXIuYXBwbHlfY3NzKHN0eWxlLCByZXNldClcbiAgICAgICAgfVxuXG4gICAgICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWQge1xuICAgICAgICAgICAgc3VwZXIucXVpdCgpXG4gICAgICAgICAgICBleGl0KGNvZGUgPz8gMClcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXJ0KHsgcmVxdWVzdEhhbmRsZXIsIGNzcywgaG9sZCwgbWFpbiwgY2xpZW50LCBpY29ucywgLi4uY2ZnIH06IENvbmZpZyA9IHt9KSB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSB0aGlzIGFzIHVua25vd24gYXMgSW5zdGFuY2VUeXBlPEFwcDMgfCBBcHA0PlxuXG4gICAgICAgICAgICBjbGllbnQgPz89ICgpID0+IHtcbiAgICAgICAgICAgICAgICBwcmludChgQXN0YWwgaW5zdGFuY2UgXCIke2FwcC5pbnN0YW5jZU5hbWV9XCIgYWxyZWFkeSBydW5uaW5nYClcbiAgICAgICAgICAgICAgICBleGl0KDEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgY2ZnKVxuICAgICAgICAgICAgc2V0Q29uc29sZUxvZ0RvbWFpbihhcHAuaW5zdGFuY2VOYW1lKVxuXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RIYW5kbGVyID0gcmVxdWVzdEhhbmRsZXJcbiAgICAgICAgICAgIGFwcC5jb25uZWN0KFwiYWN0aXZhdGVcIiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIG1haW4/LiguLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXBwLmFjcXVpcmVfc29ja2V0KClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudChtc2cgPT4gSU8uc2VuZF9yZXF1ZXN0KGFwcC5pbnN0YW5jZU5hbWUsIG1zZykhLCAuLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGx5X2Nzcyhjc3MsIGZhbHNlKVxuXG4gICAgICAgICAgICBpZiAoaWNvbnMpXG4gICAgICAgICAgICAgICAgYXBwLmFkZF9pY29ucyhpY29ucylcblxuICAgICAgICAgICAgaG9sZCA/Pz0gdHJ1ZVxuICAgICAgICAgICAgaWYgKGhvbGQpXG4gICAgICAgICAgICAgICAgYXBwLmhvbGQoKVxuXG4gICAgICAgICAgICBhcHAucnVuQXN5bmMoW10pXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSwgdHlwZSBDb25zdHJ1Y3RQcm9wcyB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZnVuY3Rpb24gZmlsdGVyKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIHJldHVybiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG59XG5cbi8vIEJveFxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLkJveC5wcm90b3R5cGUsIFwiY2hpbGRyZW5cIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9jaGlsZHJlbih2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5Cb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IEJveCA9IGFzdGFsaWZ5PEFzdGFsLkJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLkJveCwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIHNlbGYuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikgeyByZXR1cm4gc2VsZi5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfSxcbn0pXG5cbi8vIEJ1dHRvblxudHlwZSBCdXR0b25TaWduYWxzID0ge1xuICAgIG9uQ2xpY2tlZDogW11cbn1cblxuZXhwb3J0IHR5cGUgQnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuQnV0dG9uLCBHdGsuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIEJ1dHRvblNpZ25hbHM+XG5leHBvcnQgY29uc3QgQnV0dG9uID0gYXN0YWxpZnk8R3RrLkJ1dHRvbiwgR3RrLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCBCdXR0b25TaWduYWxzPihHdGsuQnV0dG9uKVxuXG4vLyBDZW50ZXJCb3hcbmV4cG9ydCB0eXBlIENlbnRlckJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkNlbnRlckJveCwgR3RrLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IENlbnRlckJveCA9IGFzdGFsaWZ5PEd0ay5DZW50ZXJCb3gsIEd0ay5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz4oR3RrLkNlbnRlckJveCwge1xuICAgIGdldENoaWxkcmVuKGJveCkge1xuICAgICAgICByZXR1cm4gW2JveC5zdGFydFdpZGdldCwgYm94LmNlbnRlcldpZGdldCwgYm94LmVuZFdpZGdldF1cbiAgICB9LFxuICAgIHNldENoaWxkcmVuKGJveCwgY2hpbGRyZW4pIHtcbiAgICAgICAgY29uc3QgY2ggPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIGJveC5zdGFydFdpZGdldCA9IGNoWzBdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIGJveC5jZW50ZXJXaWRnZXQgPSBjaFsxXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICBib3guZW5kV2lkZ2V0ID0gY2hbMl0gfHwgbmV3IEd0ay5Cb3hcbiAgICB9LFxufSlcblxuLy8gVE9ETzogQ2lyY3VsYXJQcm9ncmVzc1xuLy8gVE9ETzogRHJhd2luZ0FyZWFcblxuLy8gRW50cnlcbnR5cGUgRW50cnlTaWduYWxzID0ge1xuICAgIG9uQWN0aXZhdGU6IFtdXG4gICAgb25Ob3RpZnlUZXh0OiBbXVxufVxuXG5leHBvcnQgdHlwZSBFbnRyeVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPlxuZXhwb3J0IGNvbnN0IEVudHJ5ID0gYXN0YWxpZnk8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPihHdGsuRW50cnksIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBJbWFnZVxuZXhwb3J0IHR5cGUgSW1hZ2VQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5JbWFnZSwgR3RrLkltYWdlLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgSW1hZ2UgPSBhc3RhbGlmeTxHdGsuSW1hZ2UsIEd0ay5JbWFnZS5Db25zdHJ1Y3RvclByb3BzPihHdGsuSW1hZ2UsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBMYWJlbFxuZXhwb3J0IHR5cGUgTGFiZWxQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5MYWJlbCwgR3RrLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTGFiZWwgPSBhc3RhbGlmeTxHdGsuTGFiZWwsIEd0ay5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPihHdGsuTGFiZWwsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHsgc2VsZi5sYWJlbCA9IFN0cmluZyhjaGlsZHJlbikgfSxcbn0pXG5cbi8vIExldmVsQmFyXG5leHBvcnQgdHlwZSBMZXZlbEJhclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkxldmVsQmFyLCBHdGsuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBMZXZlbEJhciA9IGFzdGFsaWZ5PEd0ay5MZXZlbEJhciwgR3RrLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5MZXZlbEJhciwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFRPRE86IExpc3RCb3hcblxuLy8gT3ZlcmxheVxuZXhwb3J0IHR5cGUgT3ZlcmxheVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk92ZXJsYXksIEd0ay5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgT3ZlcmxheSA9IGFzdGFsaWZ5PEd0ay5PdmVybGF5LCBHdGsuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPihHdGsuT3ZlcmxheSwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHtcbiAgICAgICAgY29uc3QgY2hpbGRyZW46IEFycmF5PEd0ay5XaWRnZXQ+ID0gW11cbiAgICAgICAgbGV0IGNoID0gc2VsZi5nZXRfZmlyc3RfY2hpbGQoKVxuICAgICAgICB3aGlsZSAoY2ggIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgICAgICBjaCA9IGNoLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNoaWxkcmVuLmZpbHRlcihjaCA9PiBjaCAhPT0gc2VsZi5jaGlsZClcbiAgICB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgY29uc3QgdHlwZXMgPSB0eXBlIGluIGNoaWxkXG4gICAgICAgICAgICAgICAgPyAoY2hpbGRbdHlwZV0gYXMgc3RyaW5nKS5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgICAgICAgOiBbXVxuXG4gICAgICAgICAgICBpZiAodHlwZXMuaW5jbHVkZXMoXCJvdmVybGF5XCIpKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfb3ZlcmxheShjaGlsZClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNlbGYuc2V0X21lYXN1cmVfb3ZlcmxheShjaGlsZCwgdHlwZXMuaW5jbHVkZXMoXCJtZWFzdXJlXCIpKVxuICAgICAgICAgICAgc2VsZi5zZXRfY2xpcF9vdmVybGF5KGNoaWxkLCB0eXBlcy5pbmNsdWRlcyhcImNsaXBcIikpXG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gUmV2ZWFsZXJcbmV4cG9ydCB0eXBlIFJldmVhbGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuUmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFJldmVhbGVyID0gYXN0YWxpZnk8R3RrLlJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlJldmVhbGVyKVxuXG4vLyBTbGlkZXJcbnR5cGUgU2xpZGVyU2lnbmFscyA9IHtcbiAgICBvbkNoYW5nZVZhbHVlOiBbXVxufVxuXG5leHBvcnQgdHlwZSBTbGlkZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLlNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIFNsaWRlclNpZ25hbHM+XG5leHBvcnQgY29uc3QgU2xpZGVyID0gYXN0YWxpZnk8QXN0YWwuU2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywgU2xpZGVyU2lnbmFscz4oQXN0YWwuU2xpZGVyLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gU3RhY2tcbmV4cG9ydCB0eXBlIFN0YWNrUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuU3RhY2ssIEd0ay5TdGFjay5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN0YWNrID0gYXN0YWxpZnk8R3RrLlN0YWNrLCBHdGsuU3RhY2suQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN0YWNrLCB7XG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQubmFtZSAhPSBcIlwiICYmIGNoaWxkLm5hbWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX25hbWVkKGNoaWxkLCBjaGlsZC5uYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBTd2l0Y2hcbmV4cG9ydCB0eXBlIFN3aXRjaFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN3aXRjaCA9IGFzdGFsaWZ5PEd0ay5Td2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN3aXRjaCwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFdpbmRvd1xuZXhwb3J0IHR5cGUgV2luZG93UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5XaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFdpbmRvdyA9IGFzdGFsaWZ5PEFzdGFsLldpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLldpbmRvdylcblxuLy8gTWVudUJ1dHRvblxuZXhwb3J0IHR5cGUgTWVudUJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTWVudUJ1dHRvbiA9IGFzdGFsaWZ5PEd0ay5NZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPihHdGsuTWVudUJ1dHRvbiwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIFtzZWxmLnBvcG92ZXIsIHNlbGYuY2hpbGRdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBHdGsuUG9wb3Zlcikge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X3BvcG92ZXIoY2hpbGQpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFBvcG9wZXJcbmV4cG9ydCB0eXBlIFBvcG92ZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5Qb3BvdmVyLCBHdGsuUG9wb3Zlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFBvcG92ZXIgPSBhc3RhbGlmeTxHdGsuUG9wb3ZlciwgR3RrLlBvcG92ZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlBvcG92ZXIpXG4iLCAiLy8ga29iZWwtc2hlbGwgZW50cnkgXHUyMDE0IEFHUyB2MiAvIGFzdGFsNFxuaW1wb3J0IHsgQXBwIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuLy8gYXN0YWwgYGNvbnN0cnVjdGAgc2V0cyBzdGF0aWMgcHJvcHMgdmlhIE9iamVjdC5hc3NpZ24od2lkZ2V0LCBwcm9wcykgYW5kIGJpbmRpbmdzIHZpYVxuLy8gc2V0UHJvcCBcdTIxOTIgc2V0X2NsYXNzLiBHdGtXaWRnZXQgaGFzIG5laXRoZXIgYSBgY2xhc3NgIEdPYmplY3QgcHJvcCBub3Igc2V0X2NsYXNzLCBzb1xuLy8gYGNsYXNzPVwiLi4uXCJgIHNpbGVudGx5IG5vLW9wcyAodGhlIHJlYWwgcHJvcCBpcyBgY3NzLWNsYXNzZXNgLCBhbiBhcnJheSkuIERlZmluZSBhXG4vLyBgY2xhc3NgIGFjY2Vzc29yIHJvdXRpbmcgQk9USCBwYXRocyB0byBzZXRfY3NzX2NsYXNzZXMsIHNvIGBjbGFzcz1cImEgYlwiYCB3b3Jrcy5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0eSgoR3RrLldpZGdldCBhcyBhbnkpLnByb3RvdHlwZSwgXCJjbGFzc1wiLCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIHNldCh2OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKVxuICAgIH0sXG4gICAgZ2V0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRfY3NzX2NsYXNzZXMoKS5qb2luKFwiIFwiKVxuICAgIH0sXG59KVxuOyhHdGsuV2lkZ2V0LnByb3RvdHlwZSBhcyBhbnkpLnNldF9jbGFzcyA9IGZ1bmN0aW9uICh2OiBzdHJpbmcpIHtcbiAgICB0aGlzLnNldF9jc3NfY2xhc3NlcyhTdHJpbmcodikuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbikpXG59XG5pbXBvcnQgc3R5bGUgZnJvbSBcIi4vc3R5bGUvbWFpbi5zY3NzXCJcbmltcG9ydCB7IHRva2VuQ3NzLCB0b2tlbnMgfSBmcm9tIFwiLi9jb25maWdcIlxuaW1wb3J0ICogYXMgZ25vYmxpbiBmcm9tIFwiLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCAqIGFzIG5vdGlmZFN2YyBmcm9tIFwiLi9zZXJ2aWNlcy9ub3RpZmRcIlxuaW1wb3J0IHsgYXJtRHVtcCB9IGZyb20gXCIuL2xpYi9pbnNwZWN0XCJcbmltcG9ydCB7IHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IEJhciBmcm9tIFwiLi93aWRnZXQvQmFyXCJcbmltcG9ydCBEb2NrIGZyb20gXCIuL3dpZGdldC9Eb2NrXCJcbmltcG9ydCBMYXVuY2hlciBmcm9tIFwiLi93aWRnZXQvTGF1bmNoZXJcIlxuaW1wb3J0IFF1aWNrU2V0dGluZ3MgZnJvbSBcIi4vd2lkZ2V0L1F1aWNrU2V0dGluZ3NcIlxuaW1wb3J0IENhbGVuZGFyIGZyb20gXCIuL3dpZGdldC9DYWxlbmRhclwiXG5pbXBvcnQgeyBUb2FzdHMsIERyYXdlciB9IGZyb20gXCIuL3dpZGdldC9Ob3RpZmljYXRpb25zXCJcbmltcG9ydCBPU0QgZnJvbSBcIi4vd2lkZ2V0L09TRFwiXG5pbXBvcnQgU2Vzc2lvbiBmcm9tIFwiLi93aWRnZXQvU2Vzc2lvblwiXG5cbnByaW50ZXJyKFwiS09CRUw6IG1vZHVsZSB0b3AgcmVhY2hlZFwiKVxuXG4vLyBDdXN0b20gaWNvbiBzZXQgXHUyMDE0IHRoZSBleGFjdCBIZXJvaWNvbnMvTHVjaWRlL1RhYmxlciB0aGUgcHJvdG90eXBlIHVzZXMsIGFzXG4vLyByZWNvbG9yYWJsZSBzeW1ib2xpYyBTVkdzLiBSZWdpc3RlcmVkIG9uIHRoZSBkZWZhdWx0IGljb24gdGhlbWUgc28gaWNvbk5hbWVcbi8vIFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIGV0Yy4gcmVzb2x2ZS4gUGF0aCBvdmVycmlkZSB2aWEgS09CRUxfSUNPTlMgZm9yIHRoZSBkZXZraXQuXG5pbXBvcnQgR0xpYkljb25zIGZyb20gXCJnaTovL0dMaWJcIlxuY29uc3QgSUNPTl9ESVIgPVxuICAgIEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKSA/P1xuICAgIEdMaWJJY29ucy5idWlsZF9maWxlbmFtZXYoW0dMaWJJY29ucy5nZXRfY3VycmVudF9kaXIoKSwgXCJpY29uc1wiXSlcblxuQXBwLnN0YXJ0KHtcbiAgICBpbnN0YW5jZU5hbWU6IFwia29iZWxcIixcbiAgICBpY29uczogSUNPTl9ESVIsXG4gICAgbWFpbigpIHtcbiAgICAgICAgZ25vYmxpbi5pbml0KClcbiAgICAgICAgbm90aWZkU3ZjLmluaXQoKVxuICAgICAgICAvLyBMb2FkIG91ciBzdHlsZXNoZWV0IGF0IFVTRVIgcHJpb3JpdHkgKGhpZ2hlc3QpIHNvIGl0IGJlYXRzIEFkd2FpdGEncyB0aGVtZVxuICAgICAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgICAgICAvLyBgc2NhbGUgPiB0cm91Z2hgIChmYXQgc2xpZGVycykuIFRoaXMgcHJvdmlkZXIgaXMgYXV0aG9yaXRhdGl2ZS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHByb3YgPSBuZXcgR3RrLkNzc1Byb3ZpZGVyKClcbiAgICAgICAgICAgIHByb3YubG9hZF9mcm9tX3N0cmluZyhzdHlsZSArIHRva2VuQ3NzKHRva2VucykpXG4gICAgICAgICAgICBHdGsuU3R5bGVDb250ZXh0LmFkZF9wcm92aWRlcl9mb3JfZGlzcGxheShcbiAgICAgICAgICAgICAgICBHZGsuRGlzcGxheS5nZXRfZGVmYXVsdCgpISxcbiAgICAgICAgICAgICAgICBwcm92LFxuICAgICAgICAgICAgICAgIDgwMCAvKiBVU0VSIHByaW9yaXR5ICovXG4gICAgICAgICAgICApXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApXG4gICAgICAgIH1cbiAgICAgICAgLy8gYXN0YWw0IEpTWCA8d2luZG93PiBpcyBjcmVhdGVkIGhpZGRlbiAodmlzaWJsZT1mYWxzZSkuIFBlcnNpc3RlbnQgY2hyb21lIG11c3RcbiAgICAgICAgLy8gYmUgcHJlc2VudCgpZWQ7IG9uLWRlbWFuZCBzdXJmYWNlcyBzdGF5IGhpZGRlbiBhbmQgYXJlIHNob3duIGJ5IHRvZ2dsZV93aW5kb3cuXG4gICAgICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHcgPSBmbigpXG4gICAgICAgICAgICAgICAgaWYgKHcgJiYgdHlwZW9mIHcucHJlc2VudCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgICAgIEFwcC5hZGRfd2luZG93Py4odylcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogJHtuYW1lfSBGQUlMRUQ6ICR7ZX1cXG4keyhlIGFzIGFueSk/LnN0YWNrID8/IFwiXCJ9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBtb25pdG9ycyA9IEFwcC5nZXRfbW9uaXRvcnMoKVxuICAgICAgICBjb25zdCB0YXJnZXRzID0gbW9uaXRvcnMubGVuZ3RoID8gbW9uaXRvcnMgOiBbdW5kZWZpbmVkIGFzIGFueV1cbiAgICAgICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgICAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgICAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgICAgIH1cbiAgICAgICAgbWFrZShcImxhdW5jaGVyXCIsICgpID0+IExhdW5jaGVyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwiY2FsZW5kYXJcIiwgKCkgPT4gQ2FsZW5kYXIoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJkcmF3ZXJcIiwgKCkgPT4gRHJhd2VyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgICAgICAvLyBLT0JFTF9EVU1QPTx3aW5kb3c+OiBkdW1wIHRoZSBsaXZlIEdUSyBnZW9tZXRyeSB0cmVlIGZvciBET00tdnMtR1RLIGRpZmZpbmcuXG4gICAgICAgIGFybUR1bXAoKG5hbWUpID0+IEFwcC5nZXRfd2luZG93KG5hbWUpIGFzIGFueSlcbiAgICB9LFxuICAgIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICAgIHJlcXVlc3RIYW5kbGVyKHJlcXVlc3QsIHJlcykge1xuICAgICAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICAgICAgaWYgKGNtZCA9PT0gXCJ0b2dnbGVcIikge1xuICAgICAgICAgICAgc3VyZmFjZVRvZ2dsZShhcmcpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kID09PSBcInJlbG9hZC1jc3NcIikge1xuICAgICAgICAgICAgQXBwLmFwcGx5X2NzcyhzdHlsZSArIHRva2VuQ3NzKHRva2VucyksIHRydWUpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICByZXMoXCJ1bmtub3duXCIpXG4gICAgfSxcbn0pXG4iLCAiQGNoYXJzZXQgXCJVVEYtOFwiO1xud2luZG93IHtcbiAgZm9udC1mYW1pbHk6IFwiSW50ZXJcIiwgXCJJbnRlciBWYXJpYWJsZVwiLCBcIkludGVyVmFyaWFibGVcIiwgc2Fucy1zZXJpZjtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLnRuIHtcbiAgZm9udC1mZWF0dXJlLXNldHRpbmdzOiBcInRudW1cIjtcbn1cblxud2luZG93IHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbmJ1dHRvbiB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zLCBjb2xvciAxNjBtcztcbn1cblxuaW1hZ2Uge1xuICAtZ3RrLWljb24tc3R5bGU6IHJlZ3VsYXI7XG59XG5cbi5iYXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiAwIDdweDtcbiAgbWluLWhlaWdodDogNDJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50aXRsZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luOiAwIDlweDtcbn1cbi5iYXIgLmNsb2NrIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmJhciAuZGF0ZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLmlidG4ge1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAuaWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuaWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmJhciAuYmNlbnRlciB7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uYmFyIC5iY2VudGVyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1cyB7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDAgMTNweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uYmFyIC5zdGF0dXM6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLmJhciAuc3RhdHVzIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuc3RhdHVzIC5wY3QgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5iYXIgLnN0YXR1cyBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjAwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLnN0YXR1cy5lcnIgLm5ldC1pY29uIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG4uYmFyIC5iYWRnZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogMCAzcHg7XG4gIG1hcmdpbjogMnB4O1xuICBtaW4taGVpZ2h0OiAxNHB4O1xuICBtaW4td2lkdGg6IDE0cHg7XG59XG4uYmFyIC50cmF5LWljb24ge1xuICBtaW4td2lkdGg6IDI4cHg7XG59XG4uYmFyIC50cmF5LWljb24gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50cmF5LWxhbmcge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwIDhweDtcbiAgbWluLXdpZHRoOiAwO1xufVxuXG4uZG9jayB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIHBhZGRpbmc6IDVweDtcbiAgYm9yZGVyLXJhZGl1czogMTZweDtcbn1cbi5kb2NrIC5kYnRuIHtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5kb2NrIC5pY29uLXRpbGUge1xuICBtaW4td2lkdGg6IDMwcHg7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAxNjBtcztcbn1cbi5kb2NrIC5kYnRuOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLmRvY2sgLnBsYWNlaG9sZGVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5kb2NrIC5kb3RzIHtcbiAgbWFyZ2luLWJvdHRvbTogM3B4O1xufVxuLmRvY2sgLmRvdCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1pbi13aWR0aDogNHB4O1xuICBtaW4taGVpZ2h0OiA0cHg7XG4gIHRyYW5zaXRpb246IG1pbi13aWR0aCAyNjBtcyBjdWJpYy1iZXppZXIoMC4yNCwgMS4zNiwgMC4zNSwgMSksIGJhY2tncm91bmQtY29sb3IgMjIwbXM7XG59XG4uZG9jayAuZG90Lm9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgbWluLXdpZHRoOiAxMnB4O1xufVxuLmRvY2sgLmRvdC5taW5pIHtcbiAgbWluLXdpZHRoOiAzcHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgb3BhY2l0eTogMC43O1xufVxuLmRvY2sgLnNlcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIG1pbi13aWR0aDogMXB4O1xuICBtaW4taGVpZ2h0OiAzM3B4O1xuICBtYXJnaW46IDAgM3B4O1xufVxuLmRvY2sgLmR0aWxlIHtcbiAgbWluLXdpZHRoOiA0MnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuLmRvY2sgLmR3aWRnZXQgLmRnIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogNnB4O1xufVxuLmRvY2sgbGV2ZWxiYXIubXByb2cge1xuICBtaW4td2lkdGg6IDI1cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmRvY2sgbGV2ZWxiYXIubXByb2cgPiB0cm91Z2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMzUpO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG59XG4uZG9jayBsZXZlbGJhci5tcHJvZyA+IHRyb3VnaCA+IGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4uZG9jayBsZXZlbGJhci5tcHJvZyA+IHRyb3VnaCA+IGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG5cbi5zaGVldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDI0cHg7XG4gIHBhZGRpbmc6IDEycHg7XG4gIG1hcmdpbjogMzhweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xufVxuXG4ucXMge1xuICBtaW4td2lkdGg6IDMyOHB4O1xufSAvKiBtYXRjaGVzIHBhbmVsVygzNTIpXHUyMjEyMjQ7IG92ZXJyaWRkZW4gYnkgY29uZmlnLnRzIHRva2VuQ3NzIGF0IHJ1bnRpbWUgKi9cbi5xcy10b3Age1xuICBtYXJnaW4tYm90dG9tOiAxMnB4O1xuICBwYWRkaW5nOiAwIDJweDtcbn1cbi5xcy10b3AgLm1ldGEge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucXMtdG9wIC5tZXRhIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4ucXMtdG9wIC5yYnRuIHtcbiAgcGFkZGluZzogOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luLWxlZnQ6IDdweDtcbn1cbi5xcy10b3AgLnJidG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5xcy10b3AgLnJidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5xcy10b3AgLnJidG4uZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4ucXMtdG9wIC5yYnRuLmxlYWYgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLmNoaXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLWhlaWdodDogNTRweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5jaGlwIC5jaGlwYiB7XG4gIHBhZGRpbmc6IDlweCA4cHggOXB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xufVxuLmNoaXAgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE3cHg7XG59XG4uY2hpcCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jaGlwIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIG1hcmdpbi10b3A6IDA7XG59XG4uY2hpcDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uY2hpcC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2hpcC5vbiBpbWFnZSB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gbGFiZWwge1xuICBjb2xvcjogIzE5MjAwMztcbn1cbi5jaGlwLm9uIC5zdWIge1xuICBjb2xvcjogcmdiYSgyNSwgMzIsIDMsIDAuNyk7XG59XG4uY2hpcC5vbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG4uY2hpcC5vbiAuY2hldiB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAgLmNoZXYge1xuICBtaW4td2lkdGg6IDMycHg7XG4gIGJvcmRlci1yYWRpdXM6IDAgOTk5cHggOTk5cHggMDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1sZWZ0OiAxcHggc29saWQgcmdiYSgwLCAwLCAwLCAwLjE4KTtcbn1cbi5jaGlwIC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiBpbmhlcml0O1xufVxuLmNoaXAgLmNoZXY6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMTQpO1xufVxuXG4uY2hpcHMge1xuICBtYXJnaW4tYm90dG9tOiAwO1xufVxuXG4uY2hpcHMgPiBib3g6bGFzdC1jaGlsZCB7XG4gIG1hcmdpbi1yaWdodDogMXB4O1xufVxuXG4uY2hpcC1ncmlkIHtcbiAgbWFyZ2luLWJvdHRvbTogMTBweDtcbn1cblxuc2NhbGUsIHNjYWxlOmhvcml6b250YWwsIHNjYWxlOnZlcnRpY2FsIHtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDZweCAwO1xufVxuXG5zY2FsZSA+IHRyb3VnaCwgc2NhbGU6aG9yaXpvbnRhbCA+IHRyb3VnaCwgc2NhbGU6dmVydGljYWwgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIG1pbi13aWR0aDogMDtcbiAgbWFyZ2luOiAwO1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQsXG5zY2FsZSA+IHRyb3VnaCA+IHByb2dyZXNzIHtcbiAgbWluLWhlaWdodDogNnB4O1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBzbGlkZXIge1xuICBtaW4td2lkdGg6IDE3cHg7XG4gIG1pbi1oZWlnaHQ6IDE3cHg7XG4gIG1hcmdpbjogLTZweDsgLyogcHJvdG90eXBlIGtub2IgMTdcdTAwRDcxNyAqL1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2YzZWVmMztcbiAgYm94LXNoYWRvdzogMCAxcHggNHB4IHJnYmEoMCwgMCwgMCwgMC41KTtcbn1cblxuLnNyb3cge1xuICBwYWRkaW5nOiAwIDJweCAwIDJweDtcbiAgbWluLWhlaWdodDogNDJweDtcbn1cbi5zcm93IC5zdmFsIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBjb2xvcjogI2I1YWRiYztcbn1cblxuLnNyb3cgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMCAtMTJweCAwIDEycHg7XG59XG5cbi5zcm93IC5jaGV2IHtcbiAgcGFkZGluZzogNnB4IDhweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5zcm93IC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMDtcbn1cbi5zcm93IC5jaGV2OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLmdiYW5uZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbn1cbi5nYmFubmVyIC50IHtcbiAgY29sb3I6ICNlZGJiNjQ7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmdiYW5uZXIgLnMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG59XG4uZ2Jhbm5lciBpbWFnZSB7XG4gIGNvbG9yOiAjZWRiYjY0O1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbn1cblxuLmdidG4ge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBjb2xvcjogIzE5MjAwMztcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIHBhZGRpbmc6IDdweCAxMnB4O1xufVxuLmdidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjOTZhZTMwO1xufVxuXG4uZGhlYWQge1xuICBwYWRkaW5nLWJvdHRvbTogMTBweDtcbn1cbi5kaGVhZCBidXR0b24ge1xuICBwYWRkaW5nOiA3cHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uZGhlYWQgYnV0dG9uOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4uZGhlYWQgbGFiZWwge1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDE0cHg7XG59XG5cbnN3aXRjaCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4td2lkdGg6IDQycHg7XG4gIG1pbi1oZWlnaHQ6IDI0cHg7XG59XG5zd2l0Y2g6Y2hlY2tlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG5zd2l0Y2ggc2xpZGVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2YzZWVmMztcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIG1pbi13aWR0aDogMjBweDtcbiAgbWluLWhlaWdodDogMjBweDtcbn1cblxuLnhyb3cge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiB0cmFuc3BhcmVudDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBwYWRkaW5nOiA5cHggMTFweDtcbn1cbi54cm93IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLnhyb3cgbGFiZWwge1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4ueHJvdyAueHMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ueHJvdzpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4ueHJvdy5hY3RpdmUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDEwNiwgMTk3LCAxNDMsIDAuMDgpO1xufVxuLnhyb3cuYWN0aXZlIGltYWdlIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG4ueHJvdy5hY3RpdmUgLnhzIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG5cbi5taXhyb3cge1xuICBwYWRkaW5nOiA0cHggMnB4O1xufVxuLm1peHJvdyAubWkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbn1cbi5taXhyb3cgLm1pIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xufVxuLm1peHJvdyAubW5hbWUge1xuICBmb250LXNpemU6IDEycHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtaW4td2lkdGg6IDcycHg7XG59XG5cbi5zaGVldC5sYXVuY2hlciB7XG4gIG1pbi13aWR0aDogNTY4cHg7XG59XG5cbi5sYXVuY2hlciB7XG4gIHBhZGRpbmc6IDhweDtcbn1cblxuLmZpZWxkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogM3B4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDZweDtcbn1cbi5maWVsZCBpbWFnZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbn1cbi5maWVsZCBlbnRyeSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm94LXNoYWRvdzogbm9uZTtcbiAgb3V0bGluZTogbm9uZTtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xuICBjYXJldC1jb2xvcjogI2I1Y2I0ODtcbiAgcGFkZGluZzogOHB4IDA7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbn1cbi5maWVsZCBlbnRyeSB0ZXh0IHtcbiAgbWluLWhlaWdodDogMDtcbn1cbi5maWVsZCAubHBsYWNlaG9sZGVyIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5naG9zdCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDE0LjVweDtcbn1cbi5maWVsZCAua2JkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDVweDtcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIHBhZGRpbmc6IDNweCA3cHg7XG59XG5cbi50aWxlcyB7XG4gIHBhZGRpbmc6IDhweCAycHggMTBweDtcbn1cblxuLnRpbGUge1xuICBwYWRkaW5nOiA1cHggMDtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgbWluLXdpZHRoOiA2NHB4O1xuICBtYXgtd2lkdGg6IDY0cHg7XG59XG4udGlsZSAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAwO1xuICBtaW4taGVpZ2h0OiAwO1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4udGlsZSBsYWJlbCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi50aWxlOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLnRpbGU6aG92ZXIgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLmxmb290IHtcbiAgcGFkZGluZzogN3B4IDEwcHggM3B4O1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMXB4O1xufVxuLmxmb290IGIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmx3aWRnZXRzIHtcbiAgcGFkZGluZzogMCAycHggNnB4O1xufVxuXG4ud2lkZ2V0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xufVxuLndpZGdldCBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi53aWRnZXQgLmhpbnQge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4ubHdtIC5sd2FydCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xufVxuLmx3bSAubHdhcnQgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4ubHdtIC5tYnRuIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgbWluLXdpZHRoOiAyOXB4O1xuICBtaW4taGVpZ2h0OiAyOXB4O1xufVxuLmx3bSAubWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmx3bSAubWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5zZWMge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBwYWRkaW5nOiA4cHggMTBweCAycHg7XG59XG5cbi5yb3cge1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA3cHggMTBweDtcbn1cbi5yb3cgLnJpIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiAycHg7XG59XG4ucm93IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDI0cHg7XG59XG4ucm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLnJvdyAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5yb3cgLnJ1bmsge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogMnB4IDdweDtcbn1cbi5yb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLnJvdy5zZWwge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG4uY2FsIHtcbiAgbWluLXdpZHRoOiAzMDlweDtcbn1cbi5jYWwgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5jYWwgLmhlcm8ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxOXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuY2FsaGVybyB7XG4gIHBhZGRpbmc6IDRweCA4cHggOHB4O1xufVxuLmNhbCAuY2FsLWdyaWQge1xuICBtYXJnaW4tdG9wOiA4cHg7XG59XG4uY2FsIC5tb250aCB7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDEzcHg7XG59XG4uY2FsIC5tb250aDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5jYWwgY2VudGVyYm94ID4gYnV0dG9uIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmNhbCAuZG93IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIHBhZGRpbmc6IDNweCAwIDZweDtcbn1cbi5jYWwgLndrIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNhbCAuZGF5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIG1pbi13aWR0aDogMjRweDtcbiAgbWluLWhlaWdodDogMjRweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWFyZ2luOiAxcHg7XG59XG4uY2FsIC5kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCAuZGF5LndlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uY2FsIC5kYXkub3V0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4uY2FsIC5kYXkudG9kYXkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBjb2xvcjogIzE5MjAwMztcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbn1cbi5jYWwgLmRheS50b2RheTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2FsIC5kYXkuc2VsOm5vdCgudG9kYXkpIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggI2I1YWRiYztcbn1cbi5jYWwgLmRheS50b2RheS5zZWwge1xuICBib3gtc2hhZG93OiBpbnNldCAwIDAgMCAxLjVweCAjMTkyMDAzO1xufVxuLmNhbCAuZGF5IC5ldmRvdCB7XG4gIG1pbi13aWR0aDogM3B4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIG1hcmdpbi1ib3R0b206IDJweDtcbn1cbi5jYWwgLmRheS50b2RheSAuZXZkb3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTkyMDAzO1xufVxuLmNhbCAuZXZjYXJkIHtcbiAgbWFyZ2luLXRvcDogMTBweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweDtcbn1cbi5jYWwgLmV2aGVhZCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgcGFkZGluZzogMXB4IDNweCA4cHg7XG59XG4uY2FsIC5ldnJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBtYXJnaW4tYm90dG9tOiA0cHg7XG59XG4uY2FsIC5ldnJvdzpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLWJvdHRvbTogMDtcbn1cbi5jYWwgLmV2cm93IC5ldmljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzYyODkzMztcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA1cHg7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyBpbWFnZSB7XG4gIGNvbG9yOiAjZmZmO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5jYWwgLmV2cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuZXZyb3cgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cblxuLmRyYXdlciB7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xufVxuXG4udG9hc3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEzcHg7XG4gIGJveC1zaGFkb3c6IDAgMThweCA0MHB4IHJnYmEoNSwgMywgMTAsIDAuNDUpO1xufVxuXG4ubmNhcmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEycHg7XG59XG4ubmNhcmQgLm5pYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xufVxuLm5jYXJkIC5uaWMgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4ubmNhcmQge1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uY2FyZCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLm5jYXJkIC5ib2R5IHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuOHB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLm5jYXJkIC53aGVuIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTBweDtcbn1cbi5uY2FyZCAubngge1xuICBwYWRkaW5nOiA1cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5jYXJkIC5ueDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjZWY4NmEwO1xufVxuLm5jYXJkLm1lZGlhIHtcbiAgcGFkZGluZzogMTBweCAxMXB4IDlweDtcbiAgbWFyZ2luLWJvdHRvbTogMnB4O1xufVxuLm5jYXJkIC5tYXJ0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgbWluLXdpZHRoOiA0NnB4O1xuICBtaW4taGVpZ2h0OiA0NnB4O1xufVxuLm5jYXJkIC5tYXJ0IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAyMnB4O1xufVxuLm5jYXJkIC5tbWV0YSBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTNweDtcbn1cbi5uY2FyZCAubWJ0biB7XG4gIG1pbi13aWR0aDogMjlweDtcbiAgbWluLWhlaWdodDogMjlweDtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5uY2FyZCAubWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLm5jYXJkIC5tYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4ubmNhcmQgLm1iYXIge1xuICBtYXJnaW4tdG9wOiA3cHg7XG59XG4ubmNhcmQgLm10aW1lIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLm5jYXJkIGxldmVsYmFyLm10cmFjayB7XG4gIG1pbi1oZWlnaHQ6IDRweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbn1cbi5uY2FyZCBsZXZlbGJhci5tdHJhY2sgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4ubmNhcmQgbGV2ZWxiYXIubXRyYWNrID4gdHJvdWdoID4gYmxvY2suZmlsbGVkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbn1cbi5uY2FyZCBsZXZlbGJhci5tdHJhY2sgPiB0cm91Z2ggPiBibG9jay5lbXB0eSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xufVxuLm5jYXJkIC5tZW1wdHlyb3cgbGFiZWwge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLm5jYXJkIC5tZW1wdHlyb3cgLm1hcnQgaW1hZ2Uge1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uY2FyZCAuZ2hvc3RiIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBwYWRkaW5nOiA3cHggMTJweDtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbn1cbi5uY2FyZCAuZ2hvc3RiIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLm5jYXJkIC5naG9zdGI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xufVxuXG4ubmhlYWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiA4cHggOHB4IDhweCAxNHB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uaGVhZCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLm5oZWFkIC5zdWIge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5oZWFkIC5uY2xlYXIge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGJvcmRlci1yYWRpdXM6IDdweDtcbiAgcGFkZGluZzogNHB4IDlweDtcbn1cbi5uaGVhZCAubmNsZWFyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLm5lbXB0eSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDIwcHg7XG4gIHBhZGRpbmc6IDIwcHggMCAxNnB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uZW1wdHkgaW1hZ2Uge1xuICBjb2xvcjogIzhkODY5MztcbiAgLWd0ay1pY29uLXNpemU6IDIycHg7XG4gIG1hcmdpbi1ib3R0b206IDRweDtcbn1cbi5uZW1wdHkgbGFiZWwge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5vc2Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgcGFkZGluZzogMTBweCAxNXB4O1xufVxuLm9zZCBpbWFnZSB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5vc2QgbGV2ZWxiYXIgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4ub3NkIGxldmVsYmFyID4gdHJvdWdoID4gYmxvY2sge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4ub3NkIGxldmVsYmFyID4gdHJvdWdoID4gYmxvY2suZmlsbGVkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbi5vc2QgbGV2ZWxiYXIgPiB0cm91Z2ggPiBibG9jay5lbXB0eSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xufVxuLm9zZCAuc3ZhbCB7XG4gIG1pbi13aWR0aDogMzJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cblxuLnNlc3Npb24ge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDksIDMsIDE0LCAwLjgpO1xufVxuLnNlc3Npb24gLnNidG4ge1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG59XG4uc2Vzc2lvbiAuc2ljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMjRweDtcbiAgbWluLXdpZHRoOiA1OXB4O1xuICBtaW4taGVpZ2h0OiA1OXB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMjAwbXMsIGNvbG9yIDIwMG1zO1xufVxuLnNlc3Npb24gLnJlZCAuc2ljIHtcbiAgY29sb3I6ICNlZjg2YTA7XG59XG4uc2Vzc2lvbiAuc2J0bjpob3ZlciAuc2ljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4uc2Vzc2lvbiAucmVkOmhvdmVyIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5zZXNzaW9uIGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGZvbnQtc2l6ZTogMTJweDtcbn1cbi5zZXNzaW9uIC5jb25maXJtIGxhYmVsIHtcbiAgY29sb3I6ICNlZjg2YTA7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG5cbi5jbWVudSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDVweDtcbn1cbi5jbWVudSAuY21pIHtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA4cHggMTBweDtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNtZW51IC5jbWk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNtZW51IC5jbWkuZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4uY21lbnUgLmNzZXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBtaW4taGVpZ2h0OiAxcHg7XG4gIG1hcmdpbjogNHB4IDhweDtcbn1cblxuLmR0aXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBjb2xvcjogI2YzZWVmMztcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgcGFkZGluZzogNnB4IDExcHg7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufSIsICIvLyBUaGUgdG9rZW4gbGF5ZXIgXHUyMDE0IHRoZSBzaW5nbGUgcGxhY2UgdGhlIHNoZWxsJ3MgZ2VvbWV0cnkgY29tZXMgZnJvbS5cbi8vIFByb3RvdHlwZSBlcXVpdmFsZW50OiB0aGUgQ1NTIGN1c3RvbSBwcm9wZXJ0aWVzIG9uIC5kZXNrdG9wICgwNGJlNzJlKS5cbi8vIENoYW5nZSBhIHZhbHVlIGhlcmUgYW5kIGJhciwgcGFuZWxzLCBkb2NrLCBzbmFwLWFuY2hvcmVkIHN1cmZhY2VzIGFsbCByZWZsb3cuXG5cbmV4cG9ydCBpbnRlcmZhY2UgVG9rZW5zIHtcbiAgICBiYXJIOiBudW1iZXIgLy8gcHggXHUyMDE0IGJhciBoZWlnaHQ7IGNvbnRyb2xzIGRlcml2ZSBmcm9tIGl0XG4gICAgYmFyUjogbnVtYmVyIC8vIGJhciBjb3JuZXIgcmFkaXVzXG4gICAgZ2FwOiBudW1iZXIgLy8gc2NyZWVuIGdhcCAoYmFyIHRvcCBvZmZzZXQsIGRvY2sgYm90dG9tIG9mZnNldClcbiAgICBlZGdlOiBudW1iZXIgLy8gc2lkZSBpbnNldHNcbiAgICBpY29uOiBudW1iZXIgLy8gZG9jay9sYXVuY2hlciBpY29uIHRpbGUgc2l6ZVxuICAgIGRvY2tQYWQ6IG51bWJlciAvLyBkb2NrIHBhZGRpbmcgKGNvbmNlbnRyaWMgcmFkaXVzIGRlcml2ZXMpXG4gICAgdGlsZUg6IG51bWJlciAvLyBRUyB0aWxlIGhlaWdodFxuICAgIHBhbmVsVzogbnVtYmVyIC8vIFFTL25vdGlmaWNhdGlvbnMvdG9hc3RzIHdpZHRoXG4gICAgbGF1bmNoZXJXOiBudW1iZXJcbiAgICBjYWxlbmRhclc6IG51bWJlclxufVxuXG5leHBvcnQgY29uc3QgZmxvYXRpbmc6IFRva2VucyA9IHtcbiAgICBiYXJIOiA0MixcbiAgICBiYXJSOiAxNCxcbiAgICBnYXA6IDEwLFxuICAgIGVkZ2U6IDEyLFxuICAgIGljb246IDQ0LFxuICAgIGRvY2tQYWQ6IDUsXG4gICAgdGlsZUg6IDU0LFxuICAgIHBhbmVsVzogMzY1LCAvLyAyOC41Y3F3IGF0IDEyODBweCA9IDM2NC44IFx1MjI0OCAzNjVcbiAgICBsYXVuY2hlclc6IDU4NCwgLy8gNDZjcXcgYXQgMTI4MHB4ID0gNTg4LjggXHUyMTkyIGNsYW1wZWQgdG8gNTg0IG1heFxuICAgIGNhbGVuZGFyVzogMzM2LCAvLyAyN2NxdyBhdCAxMjgwcHggPSAzNDUuNiBcdTIxOTIgY2xhbXBlZCB0byAzMzYgbWF4XG59XG5cbi8vIGdhcGxlc3MgPSBhIHRva2VuIHByZXNldCwgZXhhY3RseSBsaWtlIHRoZSBwcm90b3R5cGUncyAuZ2FwbGVzcyBjbGFzc1xuZXhwb3J0IGNvbnN0IGdhcGxlc3M6IFRva2VucyA9IHtcbiAgICAuLi5mbG9hdGluZyxcbiAgICBiYXJIOiAzOCxcbiAgICBiYXJSOiAwLFxuICAgIGdhcDogMCxcbiAgICBlZGdlOiAwLFxufVxuXG5leHBvcnQgbGV0IHRva2VuczogVG9rZW5zID0gZmxvYXRpbmdcblxuZXhwb3J0IGNvbnN0IGN0bCA9ICgpID0+IHRva2Vucy5iYXJIIC0gMTEgLy8gYmFyIGNvbnRyb2wgc2l6ZVxuZXhwb3J0IGNvbnN0IHBhbmVsVG9wID0gKCkgPT4gdG9rZW5zLmdhcCArIHRva2Vucy5iYXJIICsgNlxuXG4vLyBHVEsgQ1NTIGNhbid0IGNhbGMoKSBmcm9tIEpTIHN0YXRlOyB3ZSByZWdlbmVyYXRlIGEgOnJvb3QtaXNoIGJsb2NrIGFuZFxuLy8gbGV0IEFwcC5hcHBseV9jc3MgcmUtc2tpbiBsaXZlICh0aGUgXCJiYXIgNDIgY3ljbGVyXCIgb2YgdGhlIFFNTC9BR1Mgd29ybGQpLlxuZXhwb3J0IGZ1bmN0aW9uIHRva2VuQ3NzKHQ6IFRva2VucyA9IHRva2Vucyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBcbiAgLmJhciB7IG1pbi1oZWlnaHQ6ICR7dC5iYXJIfXB4OyBib3JkZXItcmFkaXVzOiAke3QuYmFyUn1weDtcbiAgICAgICAgIG1hcmdpbjogMDsgfVxuICAuYmFyIGJ1dHRvbiB7IG1pbi13aWR0aDogJHtjdGwoKX1weDsgbWluLWhlaWdodDogJHtjdGwoKX1weDsgfVxuICAuZG9jayB7IHBhZGRpbmc6ICR7dC5kb2NrUGFkfXB4OyBib3JkZXItcmFkaXVzOiAkezEyICsgdC5kb2NrUGFkIC0gMX1weDtcbiAgICAgICAgICBtYXJnaW4tYm90dG9tOiAke3QuZ2FwfXB4OyB9XG4gIC5pY29uLXRpbGUgeyBtaW4td2lkdGg6ICR7dC5pY29ufXB4OyBtaW4taGVpZ2h0OiAke3QuaWNvbn1weDsgfVxuICAucXMsIC5kcmF3ZXIsIC5jYWxlbmRhciB7IG1hcmdpbi10b3A6ICR7cGFuZWxUb3AoKX1weDsgfVxuICAucXMgeyBtaW4td2lkdGg6ICR7dC5wYW5lbFcgLSAyNH1weDsgfSAgLyogcGFuZWxXIGlzIG91dGVyOyBzdWJ0cmFjdCAuc2hlZXQgcGFkZGluZyAxMnB4XHUwMEQ3MiAqL1xuICAubGF1bmNoZXIgeyBtaW4td2lkdGg6ICR7dC5sYXVuY2hlcld9cHg7IH1cbiAgLmNhbGVuZGFyIHsgbWluLXdpZHRoOiAke3QuY2FsZW5kYXJXfXB4OyB9XG4gIC5jaGlwIHsgbWluLWhlaWdodDogJHt0LnRpbGVIfXB4OyB9XG4gIGBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldFRva2VucyhuZXh0OiBQYXJ0aWFsPFRva2Vucz4sIGFwcGx5OiAoY3NzOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICB0b2tlbnMgPSB7IC4uLnRva2VucywgLi4ubmV4dCB9XG4gICAgYXBwbHkodG9rZW5Dc3ModG9rZW5zKSlcbn1cbiIsICIvLyBvcmcuZ25vYmxpbi5TaGVsbCBcdTIwMTQgdGhlIGNvbXBvc2l0b3IgbGluay4gRHJpdmVzOiBzb2Z0LXJlbG9hZCwgZmVhdHVyZSB0b2dnbGVzLFxuLy8gdGhlIFdJTkRPVyBMSVNUIHRoYXQgbWFrZXMgdGhlIGRvY2sgdHJ1dGhmdWwsIGFuZCB0aGUgY29ubmVjdGVkL2FtYmVyIHN0YXRlLlxuLy8gUHJvdG90eXBlOiBzZXJ2aWNlcyAnZ25vYicgYmFubmVyICsgYmFyIGFtYmVyIHNlZ21lbnQgKyBXTSBpbnRlZ3JhdGlvbi5cblxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5pbXBvcnQgeyBWYXJpYWJsZSB9IGZyb20gXCJhc3RhbFwiXG5cbmNvbnN0IEJVUyA9IFwib3JnLmdub2JsaW4uU2hlbGxcIlxuY29uc3QgUEFUSCA9IFwiL29yZy9nbm9ibGluL1NoZWxsXCJcbmNvbnN0IElGQUNFID0gXCJvcmcuZ25vYmxpbi5TaGVsbFwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgR25vYmxpbldpbmRvdyB7XG4gICAgaWQ6IHN0cmluZ1xuICAgIGFwcElkOiBzdHJpbmdcbiAgICB0aXRsZTogc3RyaW5nXG4gICAgZm9jdXNlZDogYm9vbGVhblxuICAgIG1pbmltaXplZDogYm9vbGVhblxufVxuXG5leHBvcnQgY29uc3QgY29ubmVjdGVkID0gVmFyaWFibGUoZmFsc2UpXG5leHBvcnQgY29uc3Qgd2luZG93cyA9IFZhcmlhYmxlPEdub2JsaW5XaW5kb3dbXT4oW10pXG5cbmxldCBwcm94eTogR2lvLkRCdXNQcm94eSB8IG51bGwgPSBudWxsXG5cbmZ1bmN0aW9uIGNhbGwobWV0aG9kOiBzdHJpbmcsIHBhcmFtczogR0xpYi5WYXJpYW50IHwgbnVsbCA9IG51bGwpOiBQcm9taXNlPEdMaWIuVmFyaWFudCB8IG51bGw+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgICAgIGlmICghcHJveHkpIHJldHVybiByZWoobmV3IEVycm9yKFwiZ25vYmxpbjogbm90IGNvbm5lY3RlZFwiKSlcbiAgICAgICAgcHJveHkuY2FsbChtZXRob2QsIHBhcmFtcywgR2lvLkRCdXNDYWxsRmxhZ3MuTk9ORSwgMjAwMCwgbnVsbCwgKF8sIHIpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzKHByb3h5IS5jYWxsX2ZpbmlzaChyKSlcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICByZWooZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgY29uc3QgcmVsb2FkID0gKCkgPT4gY2FsbChcIlJlbG9hZFwiKVxuZXhwb3J0IGNvbnN0IHNldEZlYXR1cmUgPSAobmFtZTogc3RyaW5nLCBvbjogYm9vbGVhbikgPT5cbiAgICBjYWxsKFwiU2V0RmVhdHVyZVwiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHNiKVwiLCBbbmFtZSwgb25dKSlcblxuLy8gV2luZG93IHZlcmJzICh0aGUgZG9jayBjbGljayBtb2RlbClcbmV4cG9ydCBjb25zdCBhY3RpdmF0ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiQWN0aXZhdGVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcbmV4cG9ydCBjb25zdCBtaW5pbWl6ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiTWluaW1pemVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hXaW5kb3dzKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHYgPSBhd2FpdCBjYWxsKFwiTGlzdFdpbmRvd3NcIilcbiAgICAgICAgaWYgKCF2KSByZXR1cm5cbiAgICAgICAgY29uc3QgW2xpc3RdID0gdi5kZWVwX3VucGFjaygpIGFzIFtHbm9ibGluV2luZG93W11dXG4gICAgICAgIHdpbmRvd3Muc2V0KGxpc3QpXG4gICAgfSBjYXRjaCB7XG4gICAgICAgIC8qIHN0YXkgb24gbGFzdC1rbm93biBsaXN0OyBjb25uZWN0ZWQgZmxhZyBjYXJyaWVzIHRoZSB0cnV0aCAqL1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcFdpbmRvd3MoYXBwSWQ6IHN0cmluZyk6IEdub2JsaW5XaW5kb3dbXSB7XG4gICAgcmV0dXJuIHdpbmRvd3MuZ2V0KCkuZmlsdGVyKCh3KSA9PiB3LmFwcElkID09PSBhcHBJZClcbn1cblxuLy8gQ3ljbGUgPSB0aGUgZG9jayBjYXJvdXNlbDogZm9jdXMgdGhlIG5leHQgd2luZG93IG9mIHRoZSBhcHBcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjeWNsZShhcHBJZDogc3RyaW5nLCBkaXI6IDEgfCAtMSkge1xuICAgIGNvbnN0IHdzID0gYXBwV2luZG93cyhhcHBJZClcbiAgICBpZiAod3MubGVuZ3RoIDwgMikgcmV0dXJuXG4gICAgY29uc3QgaSA9IHdzLmZpbmRJbmRleCgodykgPT4gdy5mb2N1c2VkKVxuICAgIGF3YWl0IGFjdGl2YXRlKHdzWygoaSA8IDAgPyAwIDogaSkgKyBkaXIgKyB3cy5sZW5ndGgpICUgd3MubGVuZ3RoXS5pZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gICAgR2lvLmJ1c193YXRjaF9uYW1lKFxuICAgICAgICBHaW8uQnVzVHlwZS5TRVNTSU9OLFxuICAgICAgICBCVVMsXG4gICAgICAgIEdpby5CdXNOYW1lV2F0Y2hlckZsYWdzLk5PTkUsXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIGFwcGVhcmVkXG4gICAgICAgICAgICBHaW8uREJ1c1Byb3h5Lm5ld19mb3JfYnVzKFxuICAgICAgICAgICAgICAgIEdpby5CdXNUeXBlLlNFU1NJT04sXG4gICAgICAgICAgICAgICAgR2lvLkRCdXNQcm94eUZsYWdzLk5PTkUsXG4gICAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgICBCVVMsXG4gICAgICAgICAgICAgICAgUEFUSCxcbiAgICAgICAgICAgICAgICBJRkFDRSxcbiAgICAgICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgICAgIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcHJveHkgPSBHaW8uREJ1c1Byb3h5Lm5ld19mb3JfYnVzX2ZpbmlzaChyZXMpXG4gICAgICAgICAgICAgICAgICAgIHByb3h5LmNvbm5lY3QoXCJnLXNpZ25hbFwiLCAoX3AsIF9zLCBzaWcpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzaWcgPT09IFwiV2luZG93c0NoYW5nZWRcIikgcmVmcmVzaFdpbmRvd3MoKVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICBjb25uZWN0ZWQuc2V0KHRydWUpXG4gICAgICAgICAgICAgICAgICAgIHJlZnJlc2hXaW5kb3dzKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApXG4gICAgICAgIH0sXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIHZhbmlzaGVkIFx1MjE5MiBhbWJlciBldmVyeXdoZXJlIHRoYXQgbGlzdGVuc1xuICAgICAgICAgICAgcHJveHkgPSBudWxsXG4gICAgICAgICAgICBjb25uZWN0ZWQuc2V0KGZhbHNlKVxuICAgICAgICB9XG4gICAgKVxufVxuIiwgImltcG9ydCBcIi4vb3ZlcnJpZGVzLmpzXCJcbmV4cG9ydCB7IGRlZmF1bHQgYXMgQXN0YWxJTyB9IGZyb20gXCJnaTovL0FzdGFsSU8/dmVyc2lvbj0wLjFcIlxuZXhwb3J0ICogZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi90aW1lLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL2ZpbGUuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vZ29iamVjdC5qc1wiXG5leHBvcnQgeyBCaW5kaW5nLCBiaW5kIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5leHBvcnQgeyBWYXJpYWJsZSwgZGVyaXZlIH0gZnJvbSBcIi4vdmFyaWFibGUuanNcIlxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcblxuZXhwb3J0IHsgR2lvIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEFzdGFsLnJlYWRfZmlsZShwYXRoKSB8fCBcIlwiXG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkRmlsZUFzeW5jKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgQXN0YWwucmVhZF9maWxlX2FzeW5jKHBhdGgsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5yZWFkX2ZpbGVfZmluaXNoKHJlcykgfHwgXCJcIilcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUZpbGUocGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBBc3RhbC53cml0ZV9maWxlKHBhdGgsIGNvbnRlbnQpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUZpbGVBc3luYyhwYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIEFzdGFsLndyaXRlX2ZpbGVfYXN5bmMocGF0aCwgY29udGVudCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLndyaXRlX2ZpbGVfZmluaXNoKHJlcykpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbW9uaXRvckZpbGUoXG4gICAgcGF0aDogc3RyaW5nLFxuICAgIGNhbGxiYWNrOiAoZmlsZTogc3RyaW5nLCBldmVudDogR2lvLkZpbGVNb25pdG9yRXZlbnQpID0+IHZvaWQsXG4pOiBHaW8uRmlsZU1vbml0b3Ige1xuICAgIHJldHVybiBBc3RhbC5tb25pdG9yX2ZpbGUocGF0aCwgKGZpbGU6IHN0cmluZywgZXZlbnQ6IEdpby5GaWxlTW9uaXRvckV2ZW50KSA9PiB7XG4gICAgICAgIGNhbGxiYWNrKGZpbGUsIGV2ZW50KVxuICAgIH0pIVxufVxuIiwgImltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuXG5leHBvcnQgeyBkZWZhdWx0IGFzIEdMaWIgfSBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmV4cG9ydCB7IEdPYmplY3QsIEdPYmplY3QgYXMgZGVmYXVsdCB9XG5cbmNvbnN0IG1ldGEgPSBTeW1ib2woXCJtZXRhXCIpXG5jb25zdCBwcml2ID0gU3ltYm9sKFwicHJpdlwiKVxuXG5jb25zdCB7IFBhcmFtU3BlYywgUGFyYW1GbGFncyB9ID0gR09iamVjdFxuXG5jb25zdCBrZWJhYmlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDEtJDJcIilcbiAgICAucmVwbGFjZUFsbChcIl9cIiwgXCItXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxudHlwZSBTaWduYWxEZWNsYXJhdGlvbiA9IHtcbiAgICBmbGFncz86IEdPYmplY3QuU2lnbmFsRmxhZ3NcbiAgICBhY2N1bXVsYXRvcj86IEdPYmplY3QuQWNjdW11bGF0b3JUeXBlXG4gICAgcmV0dXJuX3R5cGU/OiBHT2JqZWN0LkdUeXBlXG4gICAgcGFyYW1fdHlwZXM/OiBBcnJheTxHT2JqZWN0LkdUeXBlPlxufVxuXG50eXBlIFByb3BlcnR5RGVjbGFyYXRpb24gPVxuICAgIHwgSW5zdGFuY2VUeXBlPHR5cGVvZiBHT2JqZWN0LlBhcmFtU3BlYz5cbiAgICB8IHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH1cbiAgICB8IHR5cGVvZiBTdHJpbmdcbiAgICB8IHR5cGVvZiBOdW1iZXJcbiAgICB8IHR5cGVvZiBCb29sZWFuXG4gICAgfCB0eXBlb2YgT2JqZWN0XG5cbnR5cGUgR09iamVjdENvbnN0cnVjdG9yID0ge1xuICAgIFttZXRhXT86IHtcbiAgICAgICAgUHJvcGVydGllcz86IHsgW2tleTogc3RyaW5nXTogR09iamVjdC5QYXJhbVNwZWMgfVxuICAgICAgICBTaWduYWxzPzogeyBba2V5OiBzdHJpbmddOiBHT2JqZWN0LlNpZ25hbERlZmluaXRpb24gfVxuICAgIH1cbiAgICBuZXcoLi4uYXJnczogYW55W10pOiBhbnlcbn1cblxudHlwZSBNZXRhSW5mbyA9IEdPYmplY3QuTWV0YUluZm88bmV2ZXIsIEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0+LCBuZXZlcj5cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyKG9wdGlvbnM6IE1ldGFJbmZvID0ge30pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGNsczogR09iamVjdENvbnN0cnVjdG9yKSB7XG4gICAgICAgIGNvbnN0IHQgPSBvcHRpb25zLlRlbXBsYXRlXG4gICAgICAgIGlmICh0eXBlb2YgdCA9PT0gXCJzdHJpbmdcIiAmJiAhdC5zdGFydHNXaXRoKFwicmVzb3VyY2U6Ly9cIikgJiYgIXQuc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgICAgIC8vIGFzc3VtZSB4bWwgdGVtcGxhdGVcbiAgICAgICAgICAgIG9wdGlvbnMuVGVtcGxhdGUgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUodClcbiAgICAgICAgfVxuXG4gICAgICAgIEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7XG4gICAgICAgICAgICBTaWduYWxzOiB7IC4uLmNsc1ttZXRhXT8uU2lnbmFscyB9LFxuICAgICAgICAgICAgUHJvcGVydGllczogeyAuLi5jbHNbbWV0YV0/LlByb3BlcnRpZXMgfSxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgIH0sIGNscylcblxuICAgICAgICBkZWxldGUgY2xzW21ldGFdXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcHJvcGVydHkoZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24gPSBPYmplY3QpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldDogYW55LCBwcm9wOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpIHtcbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdID8/PSB7fVxuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllcyA/Pz0ge31cblxuICAgICAgICBjb25zdCBuYW1lID0ga2ViYWJpZnkocHJvcClcblxuICAgICAgICBpZiAoIWRlc2MpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIHByb3AsIHtcbiAgICAgICAgICAgICAgICBnZXQoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW3ByaXZdPy5bcHJvcF0gPz8gZGVmYXVsdFZhbHVlKGRlY2xhcmF0aW9uKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc2V0KHY6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodiAhPT0gdGhpc1twcm9wXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpc1twcml2XSA/Pz0ge31cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJpdl1bcHJvcF0gPSB2XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeShuYW1lKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBzZXRfJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWUodjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXNbcHJvcF0gPSB2XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBnZXRfJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWUoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW3Byb3BdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzW2tlYmFiaWZ5KHByb3ApXSA9IHBzcGVjKG5hbWUsIFBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBkZWNsYXJhdGlvbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBmbGFncyA9IDBcbiAgICAgICAgICAgIGlmIChkZXNjLmdldCkgZmxhZ3MgfD0gUGFyYW1GbGFncy5SRUFEQUJMRVxuICAgICAgICAgICAgaWYgKGRlc2Muc2V0KSBmbGFncyB8PSBQYXJhbUZsYWdzLldSSVRBQkxFXG5cbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzW2tlYmFiaWZ5KHByb3ApXSA9IHBzcGVjKG5hbWUsIGZsYWdzLCBkZWNsYXJhdGlvbilcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbCguLi5wYXJhbXM6IEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0Pik6XG4odGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB2b2lkXG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoZGVjbGFyYXRpb24/OiBTaWduYWxEZWNsYXJhdGlvbik6XG4odGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB2b2lkXG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoXG4gICAgZGVjbGFyYXRpb24/OiBTaWduYWxEZWNsYXJhdGlvbiB8IHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0LFxuICAgIC4uLnBhcmFtczogQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3Q+XG4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikge1xuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0gPz89IHt9XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzID8/PSB7fVxuXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZWJhYmlmeShzaWduYWwpXG5cbiAgICAgICAgaWYgKGRlY2xhcmF0aW9uIHx8IHBhcmFtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIFRPRE86IHR5cGUgYXNzZXJ0XG4gICAgICAgICAgICBjb25zdCBhcnIgPSBbZGVjbGFyYXRpb24sIC4uLnBhcmFtc10ubWFwKHYgPT4gdi4kZ3R5cGUpXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFsc1tuYW1lXSA9IHtcbiAgICAgICAgICAgICAgICBwYXJhbV90eXBlczogYXJyLFxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHNbbmFtZV0gPSBkZWNsYXJhdGlvbiB8fCB7XG4gICAgICAgICAgICAgICAgcGFyYW1fdHlwZXM6IFtdLFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZXNjKSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBzaWduYWwsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdChuYW1lLCAuLi5hcmdzKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgb2c6ICgoLi4uYXJnczogYW55W10pID0+IHZvaWQpID0gZGVzYy52YWx1ZVxuICAgICAgICAgICAgZGVzYy52YWx1ZSA9IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igbm90IHR5cGVkXG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0KG5hbWUsIC4uLmFyZ3MpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgb25fJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gb2cuYXBwbHkodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gcHNwZWMobmFtZTogc3RyaW5nLCBmbGFnczogbnVtYmVyLCBkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbikge1xuICAgIGlmIChkZWNsYXJhdGlvbiBpbnN0YW5jZW9mIFBhcmFtU3BlYylcbiAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uXG5cbiAgICBzd2l0Y2ggKGRlY2xhcmF0aW9uKSB7XG4gICAgICAgIGNhc2UgU3RyaW5nOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5zdHJpbmcobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIFwiXCIpXG4gICAgICAgIGNhc2UgTnVtYmVyOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5kb3VibGUobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIC1OdW1iZXIuTUFYX1ZBTFVFLCBOdW1iZXIuTUFYX1ZBTFVFLCAwKVxuICAgICAgICBjYXNlIEJvb2xlYW46XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmJvb2xlYW4obmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIGZhbHNlKVxuICAgICAgICBjYXNlIE9iamVjdDpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuanNvYmplY3QobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MpXG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG1pc3N0eXBlZFxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5vYmplY3QobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIGRlY2xhcmF0aW9uLiRndHlwZSlcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRWYWx1ZShkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbikge1xuICAgIGlmIChkZWNsYXJhdGlvbiBpbnN0YW5jZW9mIFBhcmFtU3BlYylcbiAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uLmdldF9kZWZhdWx0X3ZhbHVlKClcblxuICAgIHN3aXRjaCAoZGVjbGFyYXRpb24pIHtcbiAgICAgICAgY2FzZSBTdHJpbmc6XG4gICAgICAgICAgICByZXR1cm4gXCJcIlxuICAgICAgICBjYXNlIE51bWJlcjpcbiAgICAgICAgICAgIHJldHVybiAwXG4gICAgICAgIGNhc2UgQm9vbGVhbjpcbiAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICBjYXNlIE9iamVjdDpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiBudWxsXG4gICAgfVxufVxuIiwgIi8vIERlZmVycmVkLCBub24tYmxvY2tpbmcgQXN0YWxOb3RpZmQgYWNjZXNzLiBnZXRfZGVmYXVsdCgpIGNhbiBibG9jayBvbiBhIGhlYWRsZXNzIG9yXG4vLyBjb250ZW5kZWQgc2Vzc2lvbiBidXMgKGl0IHRyaWVzIHRvIGJlY29tZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyBhbmQgd2FpdHMpLFxuLy8gc28gd2UgTkVWRVIgdG91Y2ggaXQgZHVyaW5nIHdpZGdldCBjb25zdHJ1Y3Rpb24uIGluaXQoKSBpcyBjYWxsZWQgb25jZSBmcm9tIGFuIGlkbGVcbi8vIGFmdGVyIHRoZSBzaGVsbCBpcyBtYXBwZWQ7IG9uIHJlYWwgaGFyZHdhcmUgaXQgcmV0dXJucyBmYXN0LCBpbiB0aGUgc3RyaXBwZWQgZGV2a2l0XG4vLyBpdCBtYXkgbm8tb3AuIFdpZGdldHMgYmluZCB0byBgdW5yZWFkYC9gbGlzdGAgYW5kIGh5ZHJhdGUgd2hlbiBpdCBsYW5kcy5cbmltcG9ydCB7IFZhcmlhYmxlLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuLy8gSW1wb3J0aW5nIHRoZSB0eXBlbGliIGlzIGNoZWFwICsgbm9uLWJsb2NraW5nOyBvbmx5IGdldF9kZWZhdWx0KCkgbWF5IGJsb2NrIChpdCB0cmllc1xuLy8gdG8gYmVjb21lIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zKSwgc28gd2UgY2FsbCBUSEFUIGxhemlseSBmcm9tIGFuIGlkbGUuIFRoZSBvbGRcbi8vIGBpbXBvcnRzLmdpLkFzdGFsTm90aWZkYCB0aHJvd3MgdW5kZXIgYGdqcyAtbWAgKEVTTSBoYXMgbm8gbGVnYWN5IGBpbXBvcnRzYCBnbG9iYWwpLlxuaW1wb3J0IE5vdGlmZCBmcm9tIFwiZ2k6Ly9Bc3RhbE5vdGlmZFwiXG5cbmV4cG9ydCBjb25zdCB1bnJlYWQgPSBWYXJpYWJsZSgwKVxuZXhwb3J0IGNvbnN0IHJlYWR5ID0gVmFyaWFibGUoZmFsc2UpXG5sZXQgbjogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5cbmV4cG9ydCBmdW5jdGlvbiBub3RpZmQoKSB7XG4gICAgcmV0dXJuIG5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gICAgLy8gZ2V0ZW52IHJldHVybnMgXCJcIiAoZmFsc3kpIHdoZW4gdGhlIHZhciBpcyBzZXQtYnV0LWVtcHR5LCBudWxsIHdoZW4gdW5zZXQgXHUyMDE0IGJvdGggc2tpcFxuICAgIC8vIGNvcnJlY3RseSBvbmx5IHdoZW4gdGhlIHZhbHVlIGlzIHRydXRoeSAoXCIxXCIpLlxuICAgIGlmIChHTGliLmdldGVudihcIktPQkVMX1NLSVBfTk9USUZEXCIpKSByZXR1cm5cbiAgICAvLyBkZWZlciBwYXN0IGZpcnN0IHBhaW50OyBpZiBnZXRfZGVmYXVsdCBibG9ja3MsIGl0IGJsb2NrcyBvbmx5IHRoaXMgaWRsZSB0aWNrLFxuICAgIC8vIG5ldmVyIGNvbnN0cnVjdGlvbi9maXJzdCByZW5kZXIuXG4gICAgdGltZW91dCg1MCwgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbiA9IE5vdGlmZC5nZXRfZGVmYXVsdCgpXG4gICAgICAgICAgICByZWFkeS5zZXQodHJ1ZSlcbiAgICAgICAgICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB1bnJlYWQuc2V0KG4hLm5vdGlmaWNhdGlvbnMubGVuZ3RoKVxuICAgICAgICAgICAgbi5jb25uZWN0KFwibm90aWZpZWRcIiwgc3luYylcbiAgICAgICAgICAgIG4uY29ubmVjdChcInJlc29sdmVkXCIsIHN5bmMpXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBub3RpZmQgaW5pdCBza2lwcGVkOiAke2V9YClcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiLy8gR1RLIHdpZGdldC10cmVlIGdlb21ldHJ5IGR1bXBlciBcdTIwMTQgdGhlIG1pcnJvciBvZiB0aGUgRE9NJ3MgZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkuXG4vLyBXYWxrcyBhIG1hcHBlZCB3aW5kb3cgYW5kIHJlY29yZHMgZXZlcnkgd2lkZ2V0J3MgcmVhbCBhbGxvY2F0aW9uICh4L3kvdy9oIHJlbGF0aXZlXG4vLyB0byB0aGUgd2luZG93IGNvbnRlbnQpICsgQ1NTIGNsYXNzZXMgKyB0ZXh0LCBzbyBhIHJlbmRlcmVkIEdUSyBzdXJmYWNlIGNhbiBiZSBkaWZmZWRcbi8vIDE6MSBhZ2FpbnN0IHRoZSBwcm90b3R5cGUgRE9NLiBHYXRlZCBieSBLT0JFTF9EVU1QPTx3aW5kb3c+IGluIGFwcC50cy5cbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHcmFwaGVuZSBmcm9tIFwiZ2k6Ly9HcmFwaGVuZVwiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcblxuZXhwb3J0IGludGVyZmFjZSBOb2RlIHtcbiAgICBkOiBudW1iZXJcbiAgICB0eXBlOiBzdHJpbmdcbiAgICBjbHM6IHN0cmluZ1xuICAgIHg6IG51bWJlclxuICAgIHk6IG51bWJlclxuICAgIHc6IG51bWJlclxuICAgIGg6IG51bWJlclxuICAgIHQ6IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHVtcFdpbmRvdyh3aW46IEd0ay5XaW5kb3cpOiBOb2RlW10ge1xuICAgIGNvbnN0IG91dDogTm9kZVtdID0gW11cbiAgICBjb25zdCByb290OiBhbnkgPSB3aW5cbiAgICBjb25zdCB3YWxrID0gKHc6IGFueSwgZGVwdGg6IG51bWJlcikgPT4ge1xuICAgICAgICAvLyBjb21wdXRlX2JvdW5kcyBnaXZlcyB0aGUgd2lkZ2V0J3MgRlVMTCByZW5kZXJlZCByZWN0IChpbmNsLiBpdHMgb3duIHBhZGRpbmcpIGluXG4gICAgICAgIC8vIHRoZSByb290J3MgY29vcmRzIFx1MjAxNCBtb3JlIHJlbGlhYmxlIHRoYW4gY29tcHV0ZV9wb2ludCArIGdldF93aWR0aCAod2hpY2ggY2FuIHJlcG9ydFxuICAgICAgICAvLyB0aGUgY2hpbGQvY29udGVudCBzaXplIGZvciBwYWRkZWQgYnV0dG9ucykuXG4gICAgICAgIGxldCB4ID0gMCxcbiAgICAgICAgICAgIHkgPSAwLFxuICAgICAgICAgICAgd2lkdGggPSAwLFxuICAgICAgICAgICAgaGVpZ2h0ID0gMFxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzID0gdy5jb21wdXRlX2JvdW5kcyhyb290KVxuICAgICAgICAgICAgY29uc3QgcmVjdCA9IEFycmF5LmlzQXJyYXkocmVzKSA/IHJlc1sxXSA6IHJlc1xuICAgICAgICAgICAgaWYgKHJlY3QpIHtcbiAgICAgICAgICAgICAgICB4ID0gcmVjdC5vcmlnaW4ueFxuICAgICAgICAgICAgICAgIHkgPSByZWN0Lm9yaWdpbi55XG4gICAgICAgICAgICAgICAgd2lkdGggPSByZWN0LnNpemUud2lkdGhcbiAgICAgICAgICAgICAgICBoZWlnaHQgPSByZWN0LnNpemUuaGVpZ2h0XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge31cbiAgICAgICAgaWYgKCF3aWR0aCkge1xuICAgICAgICAgICAgd2lkdGggPSB3LmdldF93aWR0aD8uKCkgPz8gMFxuICAgICAgICAgICAgaGVpZ2h0ID0gdy5nZXRfaGVpZ2h0Py4oKSA/PyAwXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgY2xzID0gKHcuZ2V0X2Nzc19jbGFzc2VzPy4oKSA/PyBbXSkuam9pbihcIi5cIilcbiAgICAgICAgY29uc3QgdHlwZSA9ICh3LmNvbnN0cnVjdG9yPy5uYW1lID8/IFwiP1wiKS5yZXBsYWNlKC9fL2csIFwiXCIpXG4gICAgICAgIGxldCB0ID0gXCJcIlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdCA9ICh3LmdldF9sYWJlbD8uKCkgPz8gdy5nZXRfdGV4dD8uKCkgPz8gXCJcIikudG9TdHJpbmcoKS5zbGljZSgwLCAyOClcbiAgICAgICAgfSBjYXRjaCB7fVxuICAgICAgICBvdXQucHVzaCh7XG4gICAgICAgICAgICBkOiBkZXB0aCxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICBjbHMsXG4gICAgICAgICAgICB4OiBNYXRoLnJvdW5kKHgpLFxuICAgICAgICAgICAgeTogTWF0aC5yb3VuZCh5KSxcbiAgICAgICAgICAgIHc6IE1hdGgucm91bmQod2lkdGgpLFxuICAgICAgICAgICAgaDogTWF0aC5yb3VuZChoZWlnaHQpLFxuICAgICAgICAgICAgdCxcbiAgICAgICAgfSlcbiAgICAgICAgbGV0IGMgPSB3LmdldF9maXJzdF9jaGlsZD8uKClcbiAgICAgICAgd2hpbGUgKGMpIHtcbiAgICAgICAgICAgIHdhbGsoYywgZGVwdGggKyAxKVxuICAgICAgICAgICAgYyA9IGMuZ2V0X25leHRfc2libGluZygpXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY2hpbGQgPSB3aW4uZ2V0X2NoaWxkPy4oKVxuICAgIGlmIChjaGlsZCkgd2FsayhjaGlsZCwgMClcbiAgICByZXR1cm4gb3V0XG59XG5cbi8vIFBvbGwgdW50aWwgdGhlIG5hbWVkIHdpbmRvdyBpcyB2aXNpYmxlICsgbGFpZCBvdXQsIHRoZW4gZHVtcCBvbmNlIHRvIEtPQkVMX0RVTVBfT1VULlxuZXhwb3J0IGZ1bmN0aW9uIGFybUR1bXAoZ2V0V2luZG93OiAobmFtZTogc3RyaW5nKSA9PiBHdGsuV2luZG93IHwgbnVsbCkge1xuICAgIGNvbnN0IG5hbWUgPSBHTGliLmdldGVudihcIktPQkVMX0RVTVBcIilcbiAgICBpZiAoIW5hbWUpIHJldHVyblxuICAgIGNvbnN0IHBhdGggPSBHTGliLmdldGVudihcIktPQkVMX0RVTVBfT1VUXCIpIHx8IFwiL3RtcC9rb2JlbC1kdW1wLmpzb25cIlxuICAgIGxldCBkb25lID0gZmFsc2VcbiAgICBHTGliLnRpbWVvdXRfYWRkKEdMaWIuUFJJT1JJVFlfREVGQVVMVCwgNDAwLCAoKSA9PiB7XG4gICAgICAgIGlmIChkb25lKSByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgICAgIGNvbnN0IHcgPSBnZXRXaW5kb3cobmFtZSlcbiAgICAgICAgaWYgKHcgJiYgdy5nZXRfbWFwcGVkPy4oKSAmJiAody5nZXRfd2lkdGg/LigpID8/IDApID4gMCkge1xuICAgICAgICAgICAgLy8gb25lIG1vcmUgdGljayBzbyBmaW5hbCBhbGxvY2F0aW9uIHNldHRsZXNcbiAgICAgICAgICAgIEdMaWIudGltZW91dF9hZGQoR0xpYi5QUklPUklUWV9ERUZBVUxULCAyNTAsICgpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB0cmVlID0gZHVtcFdpbmRvdyh3KVxuICAgICAgICAgICAgICAgICAgICBHTGliLmZpbGVfc2V0X2NvbnRlbnRzKHBhdGgsIEpTT04uc3RyaW5naWZ5KHRyZWUpKVxuICAgICAgICAgICAgICAgICAgICBwcmludGVycihga29iZWw6IGR1bXBlZCAke3RyZWUubGVuZ3RofSB3aWRnZXRzIG9mIFwiJHtuYW1lfVwiIFx1MjE5MiAke3BhdGh9YClcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogZHVtcCBmYWlsZWQ6ICR7ZX1gKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgZG9uZSA9IHRydWVcbiAgICAgICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gR0xpYi5TT1VSQ0VfQ09OVElOVUVcbiAgICB9KVxufVxuIiwgIi8vIEFuaW1hdGVkIHN1cmZhY2UgcmVnaXN0cnkgXHUyMDE0IHJlcGxhY2VzIEFwcC50b2dnbGVfd2luZG93IGZvciBzdXJmYWNlcyB0aGF0IHdhbnRcbi8vIGEgcmV2ZWFsIGFuaW1hdGlvbi4gRWFjaCBzdXJmYWNlIGNhbGxzIHJlZ2lzdGVyKCkgb25jZSwgdGhlbiBCYXIvYXBwLnRzIGNhbGwgdG9nZ2xlKCkuXG4vL1xuLy8gUGF0dGVybjogd2luZG93IGFsd2F5cyBzdGFydHMgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gT3BlbmluZyBtYWtlcyBpdCB2aXNpYmxlLFxuLy8gdGhlbiB0cmlnZ2VycyB0aGUgcmV2ZWFsZXI7IGNsb3NpbmcgdHJpZ2dlcnMgdGhlIHJldmVhbGVyIHRoZW4gaGlkZXMgYWZ0ZXIgdHJhbnNpdGlvbi5cbmltcG9ydCB7IEFwcCB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcblxuZXhwb3J0IHR5cGUgVHJhbnNpdGlvblR5cGUgPSBHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZVxuXG5jb25zdCByZWdpc3RyeTogUmVjb3JkPHN0cmluZywgKCkgPT4gdm9pZD4gPSB7fVxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXIobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gdm9pZCkge1xuICAgIHJlZ2lzdHJ5W25hbWVdID0gZm5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvZ2dsZShuYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAocmVnaXN0cnlbbmFtZV0pIHtcbiAgICAgICAgcmVnaXN0cnlbbmFtZV0oKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEZhbGxiYWNrIGZvciBzdXJmYWNlcyB3aXRob3V0IGFuaW1hdGVkIHJldmVhbHMgKHNlc3Npb24sIGRyYXdlcilcbiAgICAgICAgQXBwLnRvZ2dsZV93aW5kb3cobmFtZSlcbiAgICB9XG59XG5cbi8vIG1ha2VSZXZlYWw6IGNyZWF0ZXMgdGhlIHN0YXRlIHZhcmlhYmxlcyBhbmQgdG9nZ2xlIGZ1bmN0aW9uIGZvciBhbiBhbmltYXRlZCBzdXJmYWNlLlxuLy8gICAtIG9wZW5NczogcmV2ZWFsLWluIGR1cmF0aW9uIGluIG1zIChkZWZhdWx0IDIyMClcbi8vICAgLSBjbG9zZU1zOiByZXZlYWwtb3V0ICsgd2luZG93LWhpZGUgZGVsYXkgaW4gbXMgKGRlZmF1bHQgMTUwKVxuLy8gICAtIHJldmVhbGVyUmVmOiBzZXQgdGhpcyB0byB0aGUgUmV2ZWFsZXIgd2lkZ2V0IGluIGBzZXR1cGAgc28gdGhlIHRvZ2dsZSBjYW5cbi8vICAgICBkaXJlY3RseSBjb250cm9sIHRyYW5zaXRpb25EdXJhdGlvbiBwZXIgZGlyZWN0aW9uXG5leHBvcnQgZnVuY3Rpb24gbWFrZVJldmVhbChvcGVuTXMgPSAyMjAsIGNsb3NlTXMgPSAxNTApIHtcbiAgICBjb25zdCB3aW5WaXNpYmxlID0gVmFyaWFibGUoZmFsc2UpXG4gICAgY29uc3QgcmV2ZWFsZWQgPSBWYXJpYWJsZShmYWxzZSlcbiAgICBsZXQgcmV2ZWFsZXJXaWRnZXQ6IEd0ay5SZXZlYWxlciB8IG51bGwgPSBudWxsXG4gICAgbGV0IGNsb3NlVGltZXI6IGFueSA9IG51bGxcblxuICAgIGNvbnN0IHNldFJldmVhbGVyID0gKHI6IEd0ay5SZXZlYWxlcikgPT4ge1xuICAgICAgICByZXZlYWxlcldpZGdldCA9IHJcbiAgICB9XG5cbiAgICBjb25zdCBvcGVuID0gKCkgPT4ge1xuICAgICAgICBpZiAoY2xvc2VUaW1lcikge1xuICAgICAgICAgICAgY2xvc2VUaW1lci5jYW5jZWw/LigpXG4gICAgICAgICAgICBjbG9zZVRpbWVyID0gbnVsbFxuICAgICAgICB9XG4gICAgICAgIGlmIChyZXZlYWxlcldpZGdldCkgcmV2ZWFsZXJXaWRnZXQudHJhbnNpdGlvbkR1cmF0aW9uID0gb3Blbk1zXG4gICAgICAgIHdpblZpc2libGUuc2V0KHRydWUpXG4gICAgICAgIC8vIE9uZSBpZGxlIGZyYW1lIHNvIEdUSyBjYW4gcmVhbGl6ZSB0aGUgd2luZG93IGJlZm9yZSBhbmltYXRpbmdcbiAgICAgICAgdGltZW91dCgxNiwgKCkgPT4gcmV2ZWFsZWQuc2V0KHRydWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGNsb3NlID0gKCkgPT4ge1xuICAgICAgICBpZiAocmV2ZWFsZXJXaWRnZXQpIHJldmVhbGVyV2lkZ2V0LnRyYW5zaXRpb25EdXJhdGlvbiA9IGNsb3NlTXNcbiAgICAgICAgcmV2ZWFsZWQuc2V0KGZhbHNlKVxuICAgICAgICBjbG9zZVRpbWVyID0gdGltZW91dChjbG9zZU1zICsgMjAsICgpID0+IHtcbiAgICAgICAgICAgIHdpblZpc2libGUuc2V0KGZhbHNlKVxuICAgICAgICAgICAgY2xvc2VUaW1lciA9IG51bGxcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCB0b2dnbGVGbiA9ICgpID0+IChyZXZlYWxlZC5nZXQoKSA/IGNsb3NlKCkgOiBvcGVuKCkpXG5cbiAgICByZXR1cm4geyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIG9wZW4sIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH1cbn1cbiIsICIvLyBUaGUgYmFyLiBQcm90b3R5cGU6IGxhdW5jaGVyIGJ1dHRvbiBcdTAwQjcgZm9jdXNlZCB0aXRsZSBcdTAwQjcgY2VudGVyZWQgY2xvY2sgKFx1MjE5MiBjYWxlbmRhcilcbi8vIFx1MDBCNyB0cmF5IFx1MDBCNyBzdGF0dXMgcGlsbCAod2lmaS92b2wvYmF0dGVyeTsgYW1iZXIgbmV0LWdseXBoIHdoZW4gZ25vYmxpbiBpcyBkb3duKVxuLy8gXHUwMEI3IGJlbGwrYmFkZ2UgKFx1MjE5MiBkcmF3ZXIpIFx1MDBCNyBwb3dlciAoXHUyMTkyIHNlc3Npb24pLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBUcmF5IGZyb20gXCJnaTovL0FzdGFsVHJheVwiXG5pbXBvcnQgeyBjb25uZWN0ZWQsIHdpbmRvd3MgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyB0b2dnbGUgYXMgc3VyZmFjZVRvZ2dsZSB9IGZyb20gXCIuLi9saWIvc3VyZmFjZVwiXG5pbXBvcnQgeyB1bnJlYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCB0aW1lID0gVmFyaWFibGUoR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKCkpLnBvbGwoMTBfMDAwLCAoKSA9PlxuICAgIEdMaWIuRGF0ZVRpbWUubmV3X25vd19sb2NhbCgpXG4pXG5cbmZ1bmN0aW9uIEZvY3VzZWRUaXRsZSgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgIGNsYXNzPVwidGl0bGVcIlxuICAgICAgICAgICAgZWxsaXBzaXplPXszIC8qIFBhbmdvLkVsbGlwc2l6ZU1vZGUuRU5EICovfVxuICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17Mjh9XG4gICAgICAgICAgICBsYWJlbD17XG4gICAgICAgICAgICAgICAgREVNT1xuICAgICAgICAgICAgICAgICAgICA/IEQudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgOiBiaW5kKHdpbmRvd3MpLmFzKCh3cykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmID0gd3MuZmluZCgodykgPT4gdy5mb2N1c2VkKVxuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWYpIHJldHVybiBcImRlc2t0b3BcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJsaW5ncyA9IHdzLmZpbHRlcigodykgPT4gdy5hcHBJZCA9PT0gZi5hcHBJZClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHNpYmxpbmdzLmxlbmd0aCA+IDFcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYCR7Zi50aXRsZX0gXHUyMDE0IHdpbmRvdyAke3NpYmxpbmdzLmluZGV4T2YoZikgKyAxfS8ke3NpYmxpbmdzLmxlbmd0aH1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGYudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAvPlxuICAgIClcbn1cblxuZnVuY3Rpb24gU3RhdHVzUGlsbCgpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgICBjb25zdCBiYXQgPSBCYXR0ZXJ5LmdldF9kZWZhdWx0KClcbiAgICAvLyBXaWZpIGljb246IHZhcmllcyB3aXRoIGNvbm5lY3Rpb24gc3RhdGUgLyB0eXBlXG4gICAgY29uc3Qgd2lmaUljb24gPSBuZXQud2lmaVxuICAgICAgICA/IGJpbmQobmV0LndpZmksIFwiZW5hYmxlZFwiKS5hcygob24pID0+XG4gICAgICAgICAgICAgIG9uID8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgOiBcImtvYmVsLXdpZmktb2ZmLXN5bWJvbGljXCJcbiAgICAgICAgICApXG4gICAgICAgIDogXCJrb2JlbC13aWZpLW9mZi1zeW1ib2xpY1wiXG4gICAgLy8gVm9sdW1lIGljb246IHRyYWNrIHRoZSBzcGVha2VyJ3Mgb3duIHZvbHVtZV9pY29uIHByb3BlcnR5XG4gICAgY29uc3Qgdm9sSWNvbiA9IHNwZWFrZXJcbiAgICAgICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoKGkpID0+IGkgPz8gXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIilcbiAgICAgICAgOiBcImtvYmVsLXNwZWFrZXItbXV0ZS1zeW1ib2xpY1wiXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgY2xhc3M9e2JpbmQoY29ubmVjdGVkKS5hcygoYykgPT4gKGMgPyBcInN0YXR1c1wiIDogXCJzdGF0dXMgZXJyXCIpKX1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcInF1aWNrc2V0dGluZ3NcIil9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBjbGFzcz1cIm5ldC1pY29uXCIgaWNvbk5hbWU9e3dpZmlJY29ufSAvPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17dm9sSWNvbn0gLz5cbiAgICAgICAgICAgICAgICB7LyogQmF0dGVyeTogb25seSByZW5kZXJlZCB3aGVuIGEgYmF0dGVyeSBpcyBwcmVzZW50ICovfVxuICAgICAgICAgICAgICAgIHsoREVNTyB8fCBiYXQpICYmIChcbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInBjdFwiIHNwYWNpbmc9ezZ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5iYXR0ZXJ5UGN0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJhdFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGJpbmQoYmF0LCBcInBlcmNlbnRhZ2VcIikuYXMoKHApID0+IGAke01hdGgucm91bmQocCAqIDEwMCl9JWApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogXCJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBCZWxsKCkge1xuICAgIC8vIEJhZGdlIGh5ZHJhdGVzIG9uY2Ugbm90aWZkIGlzIGF2YWlsYWJsZSAoZGVmZXJyZWQgXHUyMDE0IGdldF9kZWZhdWx0KCkgY2FuIGJsb2NrIG9uIGFcbiAgICAvLyBoZWFkbGVzcy9jb250ZW5kZWQgYnVzOyBuZXZlciBjYWxsIGl0IGR1cmluZyBjb25zdHJ1Y3Rpb24pLiB1bnJlYWQoKSBpcyBhIHBsYWluXG4gICAgLy8gVmFyaWFibGUgYW4gYXN5bmMgaW5pdCBmaWxscyBpbi5cbiAgICByZXR1cm4gKFxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICBjbGFzcz1cImlidG4gYmVsbFwiXG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJkcmF3ZXJcIil9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJlbGwtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkVORH1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYmFkZ2UgdG5cIlxuICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtERU1PID8gdHJ1ZSA6IGJpbmQodW5yZWFkKS5hcygobikgPT4gbiA+IDApfVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17REVNTyA/IFwiMVwiIDogYmluZCh1bnJlYWQpLmFzKChuKSA9PiAobiA+IDkgPyBcIjkrXCIgOiBgJHtufWApKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEJhcihtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIGNvbnN0IHsgVE9QLCBMRUZULCBSSUdIVCB9ID0gQXN0YWwuV2luZG93QW5jaG9yXG4gICAgLy8gRmxvYXRpbmcgYmFyOiBsYXllci1zaGVsbCBtYXJnaW5zIGluc2V0IGl0IGZyb20gdGhlIGVkZ2VzOyB0aGUgLmJhciBjaGlsZCBpcyB0aGVcbiAgICAvLyByb3VuZGVkIHN1cmZhY2UuIEV4Y2x1c2l2ZSBzbyB0aWxlZCB3aW5kb3dzIHJlc3BlY3QgaXQgKHpvbmUgPSBtYXJnaW4gKyBoZWlnaHQpLlxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJiYXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtYmFyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiYmFyLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIG1hcmdpblRvcD17MTB9XG4gICAgICAgICAgICBtYXJnaW5MZWZ0PXsxMn1cbiAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgIGFuY2hvcj17VE9QIHwgTEVGVCB8IFJJR0hUfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Y2VudGVyYm94IGNsYXNzPVwiYmFyXCI+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcImxhdW5jaGVyXCIpfVxuICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tYWduaWZ5aW5nLWdsYXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDxGb2N1c2VkVGl0bGUgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYmNlbnRlclwiXG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwiY2FsZW5kYXJcIil9XG4gICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjbG9jayB0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQkFTRUxJTkV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmNsb2NrIDogYmluZCh0aW1lKS5hcygodCkgPT4gdC5mb3JtYXQoXCIlSDolTVwiKSEpfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZGF0ZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQkFTRUxJTkV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmRhdGUgOiBiaW5kKHRpbWUpLmFzKCh0KSA9PiB0LmZvcm1hdChcIiVhICUtZCAlYlwiKSEpfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICAgICAge0RFTU8gPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezF9IG1hcmdpbkVuZD17M30+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG4gdHJheS1pY29uXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD1cIkRpc2NvcmRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hhdC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG4gdHJheS1pY29uXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD1cIlN0ZWFtXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWdhbWUtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHRpcFRleHQ9XCJUZWxlZ3JhbVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wYXBlci1wbGFuZS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG4gdHJheS1sYW5nIHRuXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiZW5cIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBiaW5kKFRyYXkuZ2V0X2RlZmF1bHQoKSwgXCJpdGVtc1wiKS5hcygoaXRlbXMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXMubWFwKChpdGVtKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxtZW51YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD17aXRlbS50b29sdGlwX21hcmt1cH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lbnVNb2RlbD17aXRlbS5tZW51X21vZGVsfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgZ2ljb249e2JpbmQoaXRlbSwgXCJnaWNvblwiKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9tZW51YnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDxTdGF0dXNQaWxsIC8+XG4gICAgICAgICAgICAgICAgICAgIDxCZWxsIC8+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpfVxuICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9jZW50ZXJib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBEZW1vLWRhdGEgbW9kZSAoS09CRUxfREVNTz0xKTogbWFrZSBldmVyeSBzdXJmYWNlIHJlbmRlciB0aGUgRVhBQ1QgbW9jayB2YWx1ZXMgZnJvbVxuLy8gZG9jcy9wcm90b3R5cGUuaHRtbCwgc28gYW4gQUdTIHJlbmRlciBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXJcbi8vIGZvciBhIGZhaXIgMToxIGNvbXBhcmlzb24uIFRoaXMgaXMgTk9UIGNoZWF0aW5nIFx1MjAxNCByZWFsIEdUSyB3aWRnZXRzLCByZWFsIHJlbmRlcmluZztcbi8vIG9ubHkgdGhlICpjb250ZW50KiBpcyBwaW5uZWQgdG8gdGhlIHByb3RvdHlwZSdzIHNvIHRoZSBjaHJvbWUgY2FuIGJlIGRpZmZlZCBkaXJlY3RseS5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgY29uc3QgREVNTyA9ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9ERU1PXCIpXG5cbi8vIFZhbHVlcyB0cmFuc2NyaWJlZCBmcm9tIHByb3RvdHlwZS5odG1sJ3MgbW9jayBzdGF0ZSAodGhlIHJlZmVyZW5jZSBzY3JlZW5zaG90cykuXG5leHBvcnQgY29uc3QgRCA9IHtcbiAgICAvLyBiYXIgXHUyMDE0IG1hdGNoIHByb3RvdHlwZS5odG1sIG1vY2sgc3RhdGUgZXhhY3RseVxuICAgIGNsb2NrOiBcIjEwOjQyXCIsXG4gICAgZGF0ZTogXCJGcmkgMyBKdWxcIixcbiAgICB0aXRsZTogXCJUZXJtaW5hbCBcdTIwMTQgd2luZG93IDEvMlwiLFxuICAgIGJhdHRlcnlQY3Q6IFwiMTAwJVwiLFxuICAgIC8vIHF1aWNrIHNldHRpbmdzXG4gICAgbWV0YTogXCIxMDAlIFx1MDBCNyBGdWxseSBjaGFyZ2VkXCIsXG4gICAgd2lmaVNzaWQ6IFwiY2hvbXBlcnMtNUdcIixcbiAgICBidERldmljZTogXCJXSC0xMDAwWE01XCIsXG4gICAgdm9sdW1lOiAwLjY3NSwgLy8gdHJvdWdoIDUxLi4yODUgd2lkdGg9MjM0OyBrbm9iPSgyMDktNTEpLzIzND0wLjY3NSBcdTIxOTIgeFx1MjI0ODIwOSBtYXRjaGVzIHByb3RvXG4gICAgYnJpZ2h0bmVzczogMC44LCAvLyBtZWFzdXJlZDogQUdTIHRyb3VnaCAycHggbmFycm93ZXIgdGhhbiBwcm90bzsgMC44MDAgYWxpZ25zIGtub2IgY2VudGVyXG4gICAgZGFyazogdHJ1ZSxcbiAgICBzYXZlOiBmYWxzZSxcbiAgICBzaWxlbnQ6IGZhbHNlLFxuICAgIG5pZ2h0OiBmYWxzZSxcbiAgICAvLyBjYWxlbmRhciBcdTIwMTQgcGlubmVkIHRvIHByb3RvdHlwZSBkYXRlIChGcmlkYXkgMyBKdWx5IDIwMjYpXG4gICAgdG9kYXk6IHsgeTogMjAyNiwgbTogNiAvKiBKdWx5LCAwLWluZGV4ZWQgKi8sIGQ6IDMgfSwgLy8gRnJpZGF5IDMgSnVseSAyMDI2XG4gICAgLy8gbGF1bmNoZXIgcGlubmVkIHRpbGVzICsgdG9kYXkgd2lkZ2V0XG4gICAgYXBwczogW1wiVGVybWluYWxcIiwgXCJGaWxlc1wiLCBcIkZpcmVmb3hcIiwgXCJaZWRcIiwgXCJTcG90aWZ5XCIsIFwiU2V0dGluZ3NcIl0sXG4gICAgd2lkZ2V0RGF0ZTogXCJGcmlkYXkgMyBKdWx5XCIsXG4gICAgd2lkZ2V0RXZlbnQ6IFwiMDk6NDUgXHUwMEI3IERhaWx5IFN0YW5kdXBcIixcbiAgICBtZWRpYTogeyB0aXRsZTogXCJXZWlnaHRsZXNzXCIsIGFydGlzdDogXCJNYXJjb25pIFVuaW9uXCIgfSxcbiAgICAvLyBwcm90b3R5cGUgaW5pdGlhbCBub3RpZmljYXRpb24gc3RvcmUgKHN0b3JlLnB1c2ggYXQgbG9hZCB0aW1lLCB3aGVuOlwiMTA6MzhcIilcbiAgICBub3RpZmljYXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICAgIGljb246IFwia29iZWwtbGVhZi1zeW1ib2xpY1wiLFxuICAgICAgICAgICAgc3VtbWFyeTogXCJnbm9ibGluXCIsXG4gICAgICAgICAgICBib2R5OiBcIlNvZnQtcmVsb2FkIGNvbXBsZXRlIFx1MjAxNCA0IGV4dGVuc2lvbnMsIDIgc2NyaXB0cy4gV2luZG93cyB1bnRvdWNoZWQuXCIsXG4gICAgICAgICAgICB3aGVuOiBcIjEwOjM4XCIsXG4gICAgICAgIH0sXG4gICAgXSxcbn1cbiIsICJpbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgeyB0eXBlIEJpbmRhYmxlQ2hpbGQgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5pbXBvcnQgeyBtZXJnZUJpbmRpbmdzLCBqc3ggYXMgX2pzeCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0ICogYXMgV2lkZ2V0IGZyb20gXCIuL3dpZGdldC5qc1wiXG5cbmV4cG9ydCBmdW5jdGlvbiBGcmFnbWVudCh7IGNoaWxkcmVuID0gW10sIGNoaWxkIH06IHtcbiAgICBjaGlsZD86IEJpbmRhYmxlQ2hpbGRcbiAgICBjaGlsZHJlbj86IEFycmF5PEJpbmRhYmxlQ2hpbGQ+XG59KSB7XG4gICAgaWYgKGNoaWxkKSBjaGlsZHJlbi5wdXNoKGNoaWxkKVxuICAgIHJldHVybiBtZXJnZUJpbmRpbmdzKGNoaWxkcmVuKVxufVxuXG5leHBvcnQgZnVuY3Rpb24ganN4KFxuICAgIGN0b3I6IGtleW9mIHR5cGVvZiBjdG9ycyB8IHR5cGVvZiBHdGsuV2lkZ2V0LFxuICAgIHByb3BzOiBhbnksXG4pIHtcbiAgICByZXR1cm4gX2pzeChjdG9ycywgY3RvciBhcyBhbnksIHByb3BzKVxufVxuXG5jb25zdCBjdG9ycyA9IHtcbiAgICBib3g6IFdpZGdldC5Cb3gsXG4gICAgYnV0dG9uOiBXaWRnZXQuQnV0dG9uLFxuICAgIGNlbnRlcmJveDogV2lkZ2V0LkNlbnRlckJveCxcbiAgICAvLyBjaXJjdWxhcnByb2dyZXNzOiBXaWRnZXQuQ2lyY3VsYXJQcm9ncmVzcyxcbiAgICAvLyBkcmF3aW5nYXJlYTogV2lkZ2V0LkRyYXdpbmdBcmVhLFxuICAgIGVudHJ5OiBXaWRnZXQuRW50cnksXG4gICAgaW1hZ2U6IFdpZGdldC5JbWFnZSxcbiAgICBsYWJlbDogV2lkZ2V0LkxhYmVsLFxuICAgIGxldmVsYmFyOiBXaWRnZXQuTGV2ZWxCYXIsXG4gICAgb3ZlcmxheTogV2lkZ2V0Lk92ZXJsYXksXG4gICAgcmV2ZWFsZXI6IFdpZGdldC5SZXZlYWxlcixcbiAgICBzbGlkZXI6IFdpZGdldC5TbGlkZXIsXG4gICAgc3RhY2s6IFdpZGdldC5TdGFjayxcbiAgICBzd2l0Y2g6IFdpZGdldC5Td2l0Y2gsXG4gICAgd2luZG93OiBXaWRnZXQuV2luZG93LFxuICAgIG1lbnVidXR0b246IFdpZGdldC5NZW51QnV0dG9uLFxuICAgIHBvcG92ZXI6IFdpZGdldC5Qb3BvdmVyLFxufVxuXG5kZWNsYXJlIGdsb2JhbCB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1uYW1lc3BhY2VcbiAgICBuYW1lc3BhY2UgSlNYIHtcbiAgICAgICAgdHlwZSBFbGVtZW50ID0gR3RrLldpZGdldFxuICAgICAgICB0eXBlIEVsZW1lbnRDbGFzcyA9IEd0ay5XaWRnZXRcbiAgICAgICAgaW50ZXJmYWNlIEludHJpbnNpY0VsZW1lbnRzIHtcbiAgICAgICAgICAgIGJveDogV2lkZ2V0LkJveFByb3BzXG4gICAgICAgICAgICBidXR0b246IFdpZGdldC5CdXR0b25Qcm9wc1xuICAgICAgICAgICAgY2VudGVyYm94OiBXaWRnZXQuQ2VudGVyQm94UHJvcHNcbiAgICAgICAgICAgIC8vIGNpcmN1bGFycHJvZ3Jlc3M6IFdpZGdldC5DaXJjdWxhclByb2dyZXNzUHJvcHNcbiAgICAgICAgICAgIC8vIGRyYXdpbmdhcmVhOiBXaWRnZXQuRHJhd2luZ0FyZWFQcm9wc1xuICAgICAgICAgICAgZW50cnk6IFdpZGdldC5FbnRyeVByb3BzXG4gICAgICAgICAgICBpbWFnZTogV2lkZ2V0LkltYWdlUHJvcHNcbiAgICAgICAgICAgIGxhYmVsOiBXaWRnZXQuTGFiZWxQcm9wc1xuICAgICAgICAgICAgbGV2ZWxiYXI6IFdpZGdldC5MZXZlbEJhclByb3BzXG4gICAgICAgICAgICBvdmVybGF5OiBXaWRnZXQuT3ZlcmxheVByb3BzXG4gICAgICAgICAgICByZXZlYWxlcjogV2lkZ2V0LlJldmVhbGVyUHJvcHNcbiAgICAgICAgICAgIHNsaWRlcjogV2lkZ2V0LlNsaWRlclByb3BzXG4gICAgICAgICAgICBzdGFjazogV2lkZ2V0LlN0YWNrUHJvcHNcbiAgICAgICAgICAgIHN3aXRjaDogV2lkZ2V0LlN3aXRjaFByb3BzXG4gICAgICAgICAgICB3aW5kb3c6IFdpZGdldC5XaW5kb3dQcm9wc1xuICAgICAgICAgICAgbWVudWJ1dHRvbjogV2lkZ2V0Lk1lbnVCdXR0b25Qcm9wc1xuICAgICAgICAgICAgcG9wb3ZlcjogV2lkZ2V0LlBvcG92ZXJQcm9wc1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QganN4cyA9IGpzeFxuIiwgIi8vIFRoZSBkb2NrLiBCZWhhdmlvciBtb2RlbCAocHJvdG90eXBlLWZpbmFsKTpcbi8vICAgY2xpY2sgIFx1MjAxNCBubyB3aW5kb3dzOiBsYXVuY2ggKGdob3N0IHpvb20pIFx1MDBCNyB1bmZvY3VzZWQ6IGZvY3VzIHRvcCB3aW5kb3cgKHB1bHNlKVxuLy8gICAgICAgICAgICBmb2N1c2VkICsgbXVsdGk6IGN5Y2xlIFx1MDBCNyBmb2N1c2VkICsgc2luZ2xlOiBtaW5pbWl6ZVxuLy8gICBzY3JvbGwgXHUyMDE0IHNpbmdsZTogZm9jdXMgXHUwMEI3IG11bHRpOiBjeWNsZSAoY2Fyb3VzZWwgbnVkZ2UsIHN0YW5kYXJkIGRpcmVjdGlvbilcbi8vICAgbWlkZGxlLWNsaWNrIFx1MjAxNCBuZXcgd2luZG93IFx1MDBCNyByaWdodC1jbGljayBcdTIwMTQgY29udGV4dCBtZW51ICh3aW5kb3dzIGxpc3QgKyBRdWl0KVxuLy8gRE9UUzogYWJzb2x1dGUgb3ZlcmxheSAoR3RrLk92ZXJsYXkpLCBzbGlkaW5nIDQtZG90IHZpZXdwb3J0LCBlZGdlIG1pbmlzIHBhc3QgNCxcbi8vIGR5aW5nLWRvdCBjbG9zZSBhbmltYXRpb24uIEljb25zIG93biBBTEwgZ2VvbWV0cnkuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IGJpbmQsIFZhcmlhYmxlLCBleGVjQXN5bmMgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEFwcHMgZnJvbSBcImdpOi8vQXN0YWxBcHBzXCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcbmltcG9ydCB7IE1PVElPTiwgc3ByaW5nLCBzcHJpbmdUbyB9IGZyb20gXCIuLi9saWIvc3ByaW5nXCJcbmltcG9ydCAqIGFzIGdub2JsaW4gZnJvbSBcIi4uL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0IHsgREVNTyB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbmNvbnN0IFBJTk5FRCA9IFtcbiAgICBcIm9yZy5nbm9tZS5QdHl4aXNcIixcbiAgICBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiLFxuICAgIFwiZmlyZWZveFwiLFxuICAgIFwiZGV2LnplZC5aZWRcIixcbiAgICBcImNvbS5zcG90aWZ5LkNsaWVudFwiLFxuICAgIFwib3JnLmdub21lLlNldHRpbmdzXCIsXG5dXG5cbmZ1bmN0aW9uIERvdHMoeyBhcHBJZCB9OiB7IGFwcElkOiBzdHJpbmcgfSkge1xuICAgIC8vIFNsaWRpbmcgdmlld3BvcnQgaWRlbnRpY2FsIHRvIHRoZSBwcm90b3R5cGU6IFx1MjI2NDQgZG90cywgZm9jdXNlZCBwaWxsLFxuICAgIC8vIG1pbmlzIHdoZW4gd2luZG93cyBleGlzdCBiZXlvbmQgdGhlIHZpc2libGUgc2xpY2UuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRvdHNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkVORH0gc3BhY2luZz17M30+XG4gICAgICAgICAgICB7YmluZChnbm9ibGluLndpbmRvd3MpLmFzKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB3cyA9IGdub2JsaW4uYXBwV2luZG93cyhhcHBJZClcbiAgICAgICAgICAgICAgICBjb25zdCB0b3RhbCA9IHdzLmxlbmd0aFxuICAgICAgICAgICAgICAgIGNvbnN0IG4gPSBNYXRoLm1pbih0b3RhbCwgNClcbiAgICAgICAgICAgICAgICBjb25zdCBjdXIgPSB3cy5maW5kSW5kZXgoKHcpID0+IHcuZm9jdXNlZClcbiAgICAgICAgICAgICAgICBsZXQgc3RhcnQgPSAwXG4gICAgICAgICAgICAgICAgaWYgKHRvdGFsID4gNCkgc3RhcnQgPSBNYXRoLm1pbihNYXRoLm1heCgoY3VyIDwgMCA/IDAgOiBjdXIpIC0gMSwgMCksIHRvdGFsIC0gNClcbiAgICAgICAgICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh7IGxlbmd0aDogbiB9LCAoXywgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBzdGFydCArIGlcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xzID0gW1wiZG90XCJdXG4gICAgICAgICAgICAgICAgICAgIGlmIChjdXIgPj0gMCAmJiBpZHggPT09IGN1cikgY2xzLnB1c2goXCJvblwiKVxuICAgICAgICAgICAgICAgICAgICBpZiAodG90YWwgPiA0ICYmICgoaSA9PT0gMCAmJiBzdGFydCA+IDApIHx8IChpID09PSBuIC0gMSAmJiBzdGFydCArIDQgPCB0b3RhbCkpKVxuICAgICAgICAgICAgICAgICAgICAgICAgY2xzLnB1c2goXCJtaW5pXCIpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiA8Ym94IGNsYXNzPXtjbHMuam9pbihcIiBcIil9IC8+XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIERvY2tCdXR0b24oeyBhcHAgfTogeyBhcHA6IEFwcHMuQXBwbGljYXRpb24gfSkge1xuICAgIGNvbnN0IGFwcElkID0gYXBwLmVudHJ5LnJlcGxhY2UoL1xcLmRlc2t0b3AkLywgXCJcIilcblxuICAgIGNvbnN0IG9uQ2xpY2sgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICBpZiAoIXdzLmxlbmd0aCkgcmV0dXJuIHZvaWQgYXBwLmxhdW5jaCgpIC8vICsgZ2hvc3Qgem9vbSAocmV2ZWFsZXIgc2NhbGUgYW5pbSlcbiAgICAgICAgY29uc3QgZm9jdXNlZCA9IHdzLmZpbmQoKHcpID0+IHcuZm9jdXNlZClcbiAgICAgICAgaWYgKCFmb2N1c2VkKVxuICAgICAgICAgICAgcmV0dXJuIHZvaWQgZ25vYmxpbi5hY3RpdmF0ZShcbiAgICAgICAgICAgICAgICB3cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmZvY3VzZWQpIC0gTnVtYmVyKGEuZm9jdXNlZCkpWzBdLmlkXG4gICAgICAgICAgICApXG4gICAgICAgIGlmICh3cy5sZW5ndGggPiAxKSByZXR1cm4gdm9pZCBnbm9ibGluLmN5Y2xlKGFwcElkLCAxKVxuICAgICAgICBnbm9ibGluLm1pbmltaXplKGZvY3VzZWQuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJkYnRuXCJcbiAgICAgICAgICAgIHRvb2x0aXBUZXh0PXthcHAubmFtZX1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17b25DbGlja31cbiAgICAgICAgICAgIG9uQnV0dG9uUHJlc3NlZD17KF93LCBlKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gbWlkZGxlLWNsaWNrIFx1MjE5MiBuZXcgd2luZG93XG4gICAgICAgICAgICAgICAgaWYgKGUuZ2V0X2J1dHRvbigpID09PSBHZGsuQlVUVE9OX01JRERMRSkgYXBwLmxhdW5jaCgpXG4gICAgICAgICAgICB9fVxuICAgICAgICAgICAgb25TY3JvbGw9eyhfdywgX2R4LCBkeSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICAgICAgICAgIGlmICghd3MubGVuZ3RoKSByZXR1cm5cbiAgICAgICAgICAgICAgICBpZiAod3MubGVuZ3RoID4gMSkgZ25vYmxpbi5jeWNsZShhcHBJZCwgZHkgPiAwID8gMSA6IC0xKVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKCF3c1swXS5mb2N1c2VkKSBnbm9ibGluLmFjdGl2YXRlKHdzWzBdLmlkKVxuICAgICAgICAgICAgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2FwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIn1cbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIHsvKiBkb3RzIGFzIE9WRVJMQVkgXHUyMDE0IHplcm8gbGF5b3V0IGZvb3RwcmludCAqL31cbiAgICAgICAgICAgICAgICA8RG90cyB0eXBlPVwib3ZlcmxheVwiIGFwcElkPXthcHBJZH0gLz5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBNZWRpYVdpZGdldCgpIHtcbiAgICBjb25zdCBtcHJpcyA9IE1wcmlzLmdldF9kZWZhdWx0KClcbiAgICBjb25zdCBwcm9ncmVzcyA9IERFTU9cbiAgICAgICAgPyAwLjQyXG4gICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwID0gcHMuZmluZCgocSkgPT4gcS5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdXG4gICAgICAgICAgICAgIGlmICghcCB8fCAhcC5sZW5ndGggfHwgcC5sZW5ndGggPD0gMCkgcmV0dXJuIDBcbiAgICAgICAgICAgICAgcmV0dXJuIHAucG9zaXRpb24gLyBwLmxlbmd0aFxuICAgICAgICAgIH0pXG4gICAgY29uc3QgaWNvbiA9IERFTU9cbiAgICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCJcbiAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwcy5maW5kKChxKSA9PiBxLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORykgPz8gcHNbMF1cbiAgICAgICAgICAgICAgaWYgKCFwKSByZXR1cm4gXCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgIHJldHVybiBwLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuIGR3aWRnZXRcIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkdGlsZVwiPlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZGdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2ljb259XG4gICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezE4fVxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgdmV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhclxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibXByb2dcIlxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkVORH1cbiAgICAgICAgICAgICAgICAgICAgdmFsdWU9e3Byb2dyZXNzfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgIClcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBERU1PIG1vZGU6IHJlbmRlciB0aGUgcHJvdG90eXBlJ3MgRVhBQ1QgZG9jayAoZG9jcy9wcm90b3R5cGUuaHRtbCkgd2l0aCByZWFsIEdUS1xuLy8gd2lkZ2V0cywgc28gaXQgY2FuIGJlIHBpeGVsLW92ZXJsYWlkIG9uIHRoZSBwcm90b3R5cGUgcmVuZGVyIDE6MS4gSWNvbnMgbG9hZCBmcm9tIHRoZVxuLy8gU0FNRSBvbi1kaXNrIGZpbGVzIHRoZSBwcm90b3R5cGUgcmVmZXJlbmNlcyAodmlhIGEgRmlsZUljb24gZ2ljb24pIHJhdGhlciB0aGFuIGJ5XG4vLyB0aGVtZWQgbmFtZSBcdTIwMTQgYSB0aGVtZWQgbG9va3VwIHNuYXBzIHRvIGEgZGlmZmVyZW50IHNpemUgdmFyaWFudCAoZS5nLiB0aGUgMzJweCBmaXJlZm94XG4vLyBpbnN0ZWFkIG9mIHRoZSBwcm90b3R5cGUncyAyNTZweCBwbmcpIGFuZCBkb3duc2NhbGVzIGRpZmZlcmVudGx5LiBTYW1lIHNvdXJjZSBmaWxlIFx1MjE5MlxuLy8gY2xvc2VzdCBjcm9zcy1lbmdpbmUgbWF0Y2guIChwaXhlbC1zaXplIGlzIGhvbm91cmVkIG5vdyB0aGUgaWNvbi10aWxlIG1pbiBpcyAzMC4pXG5jb25zdCBERU1PX0FQUFMgPSBbXG4gICAge1xuICAgICAgICBuYW1lOiBcIlRlcm1pbmFsXCIsXG4gICAgICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlB0eXhpcy5zdmdcIixcbiAgICAgICAgZG90czogW1wib25cIiwgXCJkb3RcIl0sXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiRmlsZXNcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuTmF1dGlsdXMuc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtcImRvdFwiXSxcbiAgICB9LFxuICAgIHsgbmFtZTogXCJGaXJlZm94XCIsIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yLzI1NngyNTYvYXBwcy9maXJlZm94LnBuZ1wiLCBkb3RzOiBbXSB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJaZWRcIixcbiAgICAgICAgaWNvbjogXCIvaG9tZS9raWVyYW4vLmxvY2FsL3plZC5hcHAvc2hhcmUvaWNvbnMvaGljb2xvci81MTJ4NTEyL2FwcHMvemVkLnBuZ1wiLFxuICAgICAgICBkb3RzOiBbXSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJTcG90aWZ5XCIsXG4gICAgICAgIGljb246IFwiL3Zhci9saWIvZmxhdHBhay9leHBvcnRzL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9jb20uc3BvdGlmeS5DbGllbnQuc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlNldHRpbmdzXCIsXG4gICAgICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlNldHRpbmdzLnN2Z1wiLFxuICAgICAgICBkb3RzOiBbXSxcbiAgICB9LFxuXVxuXG5mdW5jdGlvbiBmaWxlSWNvbihwYXRoOiBzdHJpbmcpOiBHaW8uSWNvbiB7XG4gICAgcmV0dXJuIEdpby5GaWxlSWNvbi5uZXcoR2lvLkZpbGUubmV3X2Zvcl9wYXRoKHBhdGgpKVxufVxuXG5mdW5jdGlvbiBEZW1vQnV0dG9uKHsgYXBwIH06IHsgYXBwOiAodHlwZW9mIERFTU9fQVBQUylbbnVtYmVyXSB9KSB7XG4gICAgLy8gTkI6IHRoZSBkb3RzIGJveCBjYXJyaWVzIGB0eXBlPVwib3ZlcmxheVwiYCBESVJFQ1RMWSAoaW50cmluc2ljIGVsZW1lbnQpIFx1MjAxNCBhIGZ1bmN0aW9uXG4gICAgLy8gY29tcG9uZW50IHdvdWxkIHN3YWxsb3cgdGhlIHByb3AsIGxldHRpbmcgdGhlIHVudHlwZWQgYm94IHJlcGxhY2UgdGhlIGljb24gYXMgdGhlXG4gICAgLy8gb3ZlcmxheSdzIG1haW4gY2hpbGQgKEd0a092ZXJsYXkuc2V0X2NoaWxkKS4gSWNvbiBzdGF5cyBtYWluOyBkb3RzIG92ZXJsYXkgb24gdG9wLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuXCIgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfT5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImljb24tdGlsZVwiXG4gICAgICAgICAgICAgICAgICAgIGdpY29uPXtmaWxlSWNvbihhcHAuaWNvbil9XG4gICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZG90c1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXszfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAge2FwcC5kb3RzLm1hcCgoY2xzKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPXtjbHMgPT09IFwib25cIiA/IFwiZG90IG9uXCIgOiBcImRvdFwifSAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBEZW1vRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkb2NrXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIlxuICAgICAgICAgICAgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzBdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzFdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzJdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzNdfSAvPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNF19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNV19IC8+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICA8TWVkaWFXaWRnZXQgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIERvY2sobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoREVNTykgcmV0dXJuIERlbW9Eb2NrKG1vbml0b3IpXG5cbiAgICBjb25zdCBhcHBzID0gbmV3IEFwcHMuQXBwcygpXG4gICAgLy8gUGlubmVkIGVudHJpZXMgcmVzb2x2ZWQgYnkgZGVza3RvcC1pZDsgdGhlIGRvY2sgbmV2ZXIgc2l0cyBlbXB0eSwgc28gZmlsbCBhbnlcbiAgICAvLyB1bnJlc29sdmVkIHNsb3RzIChlLmcuIGFuIGFwcCBub3QgaW5zdGFsbGVkIGluIHRoZSBkZXZraXQpIGZyb20gdGhlIGluc3RhbGxlZFxuICAgIC8vIGxpc3QuIE9uIHJlYWwgaGFyZHdhcmUgdGhlIHBpbnMgcmVzb2x2ZSBhbmQgdGhlIGZpbGwgaXMgdW51c2VkLlxuICAgIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICAgIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZCkgPz9cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgICAvLyBBbHdheXMgcmVuZGVyIG9uZSBzbG90IHBlciBwaW4gc28gdGhlIGRvY2sga2VlcHMgaXRzIHNoYXBlOyByZXNvbHZlZCBwaW5zIGdldCB0aGVcbiAgICAvLyByZWFsIGFwcCArIGJlaGF2aW9yLCB1bnJlc29sdmVkIG9uZXMgYSBsYWJlbGxlZCBwbGFjZWhvbGRlciB0aWxlLiBBIHNlcGFyYXRvciBzaXRzXG4gICAgLy8gYmV0d2VlbiB0aGUgZm91cnRoIGFuZCBmaWZ0aCBwaW5zIChwcm90b3R5cGUgcGFyaXR5KSwgdGhlbiBiZWZvcmUgdGhlIG1lZGlhIHdpZGdldC5cbiAgICBjb25zdCBzbG90cyA9IFBJTk5FRC5tYXAoKGlkKSA9PiAoeyBpZCwgYXBwOiByZXNvbHZlKGlkKSB9KSlcbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwiZG9ja1wiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1kb2NrXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZG9jay13aW5kb3dcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cImRvY2tcIiBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICB7c2xvdHMubWFwKCh7IGlkLCBhcHAgfSwgaSkgPT4gW1xuICAgICAgICAgICAgICAgICAgICBpID09PSA0ID8gPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz4gOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBhcHAgPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8RG9ja0J1dHRvbiBhcHA9e2FwcH0gLz5cbiAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuIHBsYWNlaG9sZGVyXCIgdG9vbHRpcFRleHQ9e2lkLnNwbGl0KFwiLlwiKS5wb3AoKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGUtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICBdKX1cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBUaGUgc3BvdGxpZ2h0LiBQcm90b3R5cGUtZmluYWwgYmVoYXZpb3I6XG4vLyAgIFN1cGVyIHJlbGVhc2Ugb3BlbnMgKGNvbXBvc2l0b3Iga2V5YmluZCBcdTIxOTIgYGFzdGFsIC1pIGtvYmVsIC10IGxhdW5jaGVyYClcbi8vICAgZnV6enkgKyBsZWFmIGhpZ2hsaWdodCBcdTAwQjcgZ2xvYmFsIEJFU1QtTUFUQ0ggc2xvdCAoc2NvcmUtcmFua2VkIGFjcm9zcyBwcm92aWRlcnMsXG4vLyAgIHR5cGUgd2VpZ2h0cyBhcHBzIDEgLyBhY3Rpb25zIC45NSAvIGZpbGVzIC45KSBcdTAwQjcgY2FwcGVkIGxvZzIgZnJlY2VuY3lcbi8vICAgZ2hvc3QgYXV0b2NvbXBsZXRlID0gZmlyc3QgcHJlZml4LWNvbXBsZXRhYmxlIG5hbWUgaW4gZGlzcGxheSBvcmRlclxuLy8gICBUYWIgYWx3YXlzIG93bmVkIChnaG9zdCBlbHNlIG5leHQ7IFNoaWZ0K1RhYiBwcmV2KSBcdTAwQjcgQ3RybCtOL1AgXHUwMEI3IEVzYyBjbGVhcnMgZmlyc3Rcbi8vICAgc2VjdGlvbnM6IGJlc3QgbWF0Y2ggLyBhcHBzIC8gYWN0aW9ucyAvIGZpbGVzIC8gd2ViIChhbHdheXMtbGFzdCByZWFsIHJvdylcbi8vICAgJz0nIGNhbGN1bGF0b3IgXHUwMEI3ICc6JyBnbm9ibGluY3RsIGNvbW1hbmRzIFx1MDBCNyBlbXB0eSBzdGF0ZTogZG9jay10aWxlIGdyaWQgKyB3aWRnZXRzXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIsIHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgeyBmdXp6eSwgaGwsIGJvb3N0LCBidW1wLCBmcmVxdWVuY3kgfSBmcm9tIFwiLi4vbGliL2Z1enp5XCJcbmltcG9ydCB7IEVWRU5UUyB9IGZyb20gXCIuL0NhbGVuZGFyXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG4vLyBDdXJhdGVkIGdyaWQ6IHRoZSBkb2NrJ3MgcGlubmVkIGFwcHMgZmlyc3QgKHJlc29sdmVkIGJ5IGRlc2t0b3AtaWQpLCB0aGVuIGZpbGwgdGhlXG4vLyByZW1haW5pbmcgc2xvdHMgYnkgZnJlY2VuY3kuIE1hdGNoZXMgdGhlIHByb3RvdHlwZSdzIGxhdW5jaGVyIGVtcHR5LXN0YXRlLlxuY29uc3QgUElOTkVEID0gW1xuICAgIFwib3JnLmdub21lLlB0eXhpc1wiLFxuICAgIFwib3JnLmdub21lLk5hdXRpbHVzXCIsXG4gICAgXCJmaXJlZm94XCIsXG4gICAgXCJkZXYuemVkLlplZFwiLFxuICAgIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsXG4gICAgXCJvcmcuZ25vbWUuU2V0dGluZ3NcIixcbl1cbi8vIERlbW8gZ3JpZDogZml4ZWQgb3JkZXIgKyBsYWJlbHMgdHJhbnNjcmliZWQgZnJvbSB0aGUgcHJvdG90eXBlIChELmFwcHMpLCBlYWNoIG1hcHBlZFxuLy8gdG8gdGhlIHJlYWwgLmRlc2t0b3AgaWQgc28gaXRzIHRoZW1lZCBpY29uIHJlbmRlcnMgKFB0eXhpcy9OYXV0aWx1cy9cdTIwMjYpLlxuY29uc3QgREVNT19USUxFUyA9IFtcbiAgICB7IG5hbWU6IFwiVGVybWluYWxcIiwgaWQ6IFwib3JnLmdub21lLlB0eXhpc1wiIH0sXG4gICAgeyBuYW1lOiBcIkZpbGVzXCIsIGlkOiBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiIH0sXG4gICAgeyBuYW1lOiBcIkZpcmVmb3hcIiwgaWQ6IFwiZmlyZWZveFwiIH0sXG4gICAgeyBuYW1lOiBcIlplZFwiLCBpZDogXCJkZXYuemVkLlplZFwiIH0sXG4gICAgeyBuYW1lOiBcIlNwb3RpZnlcIiwgaWQ6IFwiY29tLnNwb3RpZnkuQ2xpZW50XCIgfSxcbiAgICB7IG5hbWU6IFwiU2V0dGluZ3NcIiwgaWQ6IFwib3JnLmdub21lLlNldHRpbmdzXCIgfSxcbl1cblxuaW50ZXJmYWNlIFRpbGUge1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIGljb25OYW1lOiBzdHJpbmdcbiAgICBsYXVuY2g6ICgpID0+IHZvaWRcbn1cbmZ1bmN0aW9uIGdyaWRUaWxlcyhhcHBzOiBBcHBzLkFwcHMpOiBUaWxlW10ge1xuICAgIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICAgIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZCkgPz9cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgICBjb25zdCBmcm9tQXBwID0gKGFwcDogQXBwcy5BcHBsaWNhdGlvbik6IFRpbGUgPT4gKHtcbiAgICAgICAgbmFtZTogYXBwLm5hbWUsXG4gICAgICAgIGljb25OYW1lOiBhcHAuaWNvbl9uYW1lIHx8IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgIGxhdW5jaDogKCkgPT4ge1xuICAgICAgICAgICAgYnVtcChhcHAubmFtZSlcbiAgICAgICAgICAgIGFwcC5sYXVuY2goKVxuICAgICAgICB9LFxuICAgIH0pXG4gICAgaWYgKERFTU8pXG4gICAgICAgIHJldHVybiBERU1PX1RJTEVTLm1hcCgoeyBuYW1lLCBpZCB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSByZXNvbHZlKGlkKVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgICAgIGljb25OYW1lOiBhcHA/Lmljb25fbmFtZSB8fCBpZCB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICAgICAgICAgIGxhdW5jaDogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBidW1wKG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIGFwcD8ubGF1bmNoKClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIGNvbnN0IHBpbm5lZCA9IFBJTk5FRC5tYXAocmVzb2x2ZSkuZmlsdGVyKEJvb2xlYW4pIGFzIEFwcHMuQXBwbGljYXRpb25bXVxuICAgIGNvbnN0IHJlc3QgPSBhbGxcbiAgICAgICAgLmZpbHRlcigoYSkgPT4gIXBpbm5lZC5pbmNsdWRlcyhhKSlcbiAgICAgICAgLnNvcnQoKHgsIHkpID0+IGZyZXF1ZW5jeSh5Lm5hbWUpIC0gZnJlcXVlbmN5KHgubmFtZSkpXG4gICAgcmV0dXJuIFsuLi5waW5uZWQsIC4uLnJlc3RdLnNsaWNlKDAsIDYpLm1hcChmcm9tQXBwKVxufVxuZnVuY3Rpb24gdG9kYXlFdmVudExhYmVsKCk6IHN0cmluZyB7XG4gICAgaWYgKERFTU8pIHJldHVybiBELndpZGdldEV2ZW50XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKClcbiAgICBjb25zdCBldnMgPSBFVkVOVFNbYCR7ZC5nZXRGdWxsWWVhcigpfS0ke2QuZ2V0TW9udGgoKSArIDF9LSR7ZC5nZXREYXRlKCl9YF0gPz8gW11cbiAgICByZXR1cm4gZXZzLmxlbmd0aCA/IGAke2V2c1swXS50fSBcdTAwQjcgJHtldnNbMF0ubn1gIDogXCJObyBldmVudHMgdG9kYXlcIlxufVxuZnVuY3Rpb24gdG9kYXlEYXRlTGFiZWwoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gREVNT1xuICAgICAgICA/IEQud2lkZ2V0RGF0ZVxuICAgICAgICA6IG5ldyBEYXRlKCkudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwgeyB3ZWVrZGF5OiBcImxvbmdcIiwgZGF5OiBcIm51bWVyaWNcIiwgbW9udGg6IFwibG9uZ1wiIH0pXG59XG5cbmludGVyZmFjZSBSb3cge1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIGhpbnQ6IHN0cmluZ1xuICAgIHNjb3JlOiBudW1iZXJcbiAgICBtYXJrdXA6IHN0cmluZ1xuICAgIHJ1bjogKCkgPT4gdm9pZFxufVxuXG5jb25zdCBBQ1RJT05TID0gW1xuICAgIHtcbiAgICAgICAgbjogXCJTdXNwZW5kXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbW9vbi1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlNsZWVwIFx1MjAxNCByZXN1bWUgaW5zdGFudGx5XCIsXG4gICAgICAgIGFsOiBbXCJzbGVlcFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgc3VzcGVuZFwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJMb2NrXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIkxvY2sgdGhlIHNlc3Npb25cIixcbiAgICAgICAgYWw6IFtcImxvY2sgc2NyZWVuXCJdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJMb2cgT3V0XCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiRW5kIHRoaXMgc2Vzc2lvblwiLFxuICAgICAgICBhbDogW1wiZXhpdFwiLCBcInNpZ24gb3V0XCIsIFwibG9nb3V0XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlJlc3RhcnRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJSZWJvb3QgdGhlIG1hY2hpbmVcIixcbiAgICAgICAgYWw6IFtcInJlYm9vdFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJTaHV0IERvd25cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlBvd2VyIG9mZlwiLFxuICAgICAgICBhbDogW1wicG93ZXJvZmZcIiwgXCJoYWx0XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlNvZnQtcmVsb2FkIGdub2JsaW5cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJSZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIixcbiAgICAgICAgYWw6IFtdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImdub2JsaW5jdGwgcmVsb2FkXCIpLFxuICAgIH0sXG5dXG5cbmNvbnN0IENNRFMgPSBbXG4gICAgeyBjOiBcInJlbG9hZFwiLCBkOiBcIlNvZnQtcmVsb2FkIHRoZSBzaGVsbCBcdTIwMTQgd2luZG93cyBzdXJ2aXZlXCIgfSxcbiAgICB7IGM6IFwib3NkIG9mZlwiLCBkOiBcImtvYmVsIG93bnMgdm9sdW1lL2JyaWdodG5lc3MgcG9wdXBzXCIgfSxcbiAgICB7IGM6IFwibm90aWZzIG9mZlwiLCBkOiBcIlJlbGVhc2Ugb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnNcIiB9LFxuICAgIHsgYzogXCJncmFudHNcIiwgZDogXCJTY3JlZW4tcmVjb3JkaW5nIGFjY2VzcyBwZXIgYXBwXCIgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTGF1bmNoZXIoKSB7XG4gICAgY29uc3QgYXBwcyA9IG5ldyBBcHBzLkFwcHMoKVxuICAgIC8vIEtPQkVMX1FVRVJZIHByZS1maWxscyB0aGUgc2VhcmNoIHNvIHRoZSBkZXZraXQgY2FuIHJlbmRlciB0aGUgcmVzdWx0cyBzdGF0ZS5cbiAgICBjb25zdCBxdWVyeSA9IFZhcmlhYmxlKEdMaWIuZ2V0ZW52KFwiS09CRUxfUVVFUllcIikgfHwgXCJcIilcbiAgICBjb25zdCBzZWxlY3RlZCA9IFZhcmlhYmxlKDApXG4gICAgY29uc3QgZ2hvc3QgPSBWYXJpYWJsZShcIlwiKVxuXG4gICAgZnVuY3Rpb24gcmVzdWx0cyhxOiBzdHJpbmcpOiB7IHNlY3Rpb246IHN0cmluZzsgcm93czogUm93W10gfVtdIHtcbiAgICAgICAgY29uc3QgcXQgPSBxLnRyaW0oKVxuICAgICAgICBpZiAoIXF0KSByZXR1cm4gW11cbiAgICAgICAgaWYgKHF0LnN0YXJ0c1dpdGgoXCI6XCIpKSB7XG4gICAgICAgICAgICBjb25zdCBjcSA9IHF0LnNsaWNlKDEpLnRyaW0oKVxuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHNlY3Rpb246IFwiZ25vYmxpbmN0bFwiLFxuICAgICAgICAgICAgICAgICAgICByb3dzOiBDTURTLmZpbHRlcigoYykgPT4gYy5jLnN0YXJ0c1dpdGgoY3EpKS5tYXAoKGMpID0+ICh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBgOiR7Yy5jfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLXRlcm1pbmFsLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBoaW50OiBjLmQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzY29yZTogOTksXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGA6JHtjLmN9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKGBnbm9ibGluY3RsICR7Yy5jfWApLFxuICAgICAgICAgICAgICAgICAgICB9KSksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXQ6IHsgc2VjdGlvbjogc3RyaW5nOyByb3dzOiBSb3dbXSB9W10gPSBbXVxuICAgICAgICAvLyAnPScgY2FsY3VsYXRvciAoY2hhcnNldC1ndWFyZGVkLCBzYW1lIGFzIHByb3RvdHlwZSlcbiAgICAgICAgaWYgKC9ePT9bMC05K1xcLSovKCkuIF0rJC8udGVzdChxdCkgJiYgL1swLTldLy50ZXN0KHF0KSAmJiAvWytcXC0qL10vLnRlc3QocXQpKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHYgPSBGdW5jdGlvbihgXCJ1c2Ugc3RyaWN0XCI7cmV0dXJuKCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0pYCkoKVxuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUodikpXG4gICAgICAgICAgICAgICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlY3Rpb246IFwiY2FsY3VsYXRvclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgcm93czogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogU3RyaW5nKHYpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLWNhbGN1bGF0b3Itc3ltYm9saWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGludDogYCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0gPWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjb3JlOiA5OCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBTdHJpbmcodiksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcIndsLWNvcHlcIiwgU3RyaW5nKHYpXSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXBwUm93czogUm93W10gPSBhcHBzXG4gICAgICAgICAgICAuZnV6enlfcXVlcnkocXQpXG4gICAgICAgICAgICAuc2xpY2UoMCwgNSlcbiAgICAgICAgICAgIC5tYXAoKGEpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtID0gZnV6enkocXQsIGEubmFtZSkgPz8geyBzY29yZTogMSwgbWFya3M6IG51bGwgYXMgYW55IH1cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBhLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGljb246IGEuaWNvbl9uYW1lID8/IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgICAgICAgICAgICAgIGhpbnQ6IFwiQXBwbGljYXRpb25cIixcbiAgICAgICAgICAgICAgICAgICAgc2NvcmU6IG0uc2NvcmUgKyBib29zdChhLm5hbWUpLFxuICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGhsKGEubmFtZSwgbS5tYXJrcyksXG4gICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgYnVtcChhLm5hbWUpXG4gICAgICAgICAgICAgICAgICAgICAgICBhLmxhdW5jaCgpXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgY29uc3QgYWN0Um93czogUm93W10gPSBBQ1RJT05TLm1hcCgoeCkgPT4ge1xuICAgICAgICAgICAgbGV0IG0gPSBmdXp6eShxdCwgeC5uKVxuICAgICAgICAgICAgaWYgKCFtKVxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYWwgb2YgeC5hbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbSA9IGZ1enp5KHF0LCBhbClcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtID0geyBzY29yZTogYW0uc2NvcmUgLSAwLjUsIG1hcmtzOiBudWxsIGFzIGFueSB9XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG1cbiAgICAgICAgICAgICAgICA/ICh7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogeC5uLFxuICAgICAgICAgICAgICAgICAgICAgIGljb246IHguaWNvbixcbiAgICAgICAgICAgICAgICAgICAgICBoaW50OiB4LmQsXG4gICAgICAgICAgICAgICAgICAgICAgc2NvcmU6IG0uc2NvcmUgKiAwLjk1LFxuICAgICAgICAgICAgICAgICAgICAgIG1hcmt1cDogaGwoeC5uLCAobSBhcyBhbnkpLm1hcmtzKSxcbiAgICAgICAgICAgICAgICAgICAgICBydW46IHgucnVuLFxuICAgICAgICAgICAgICAgICAgfSBhcyBSb3cpXG4gICAgICAgICAgICAgICAgOiBudWxsXG4gICAgICAgIH0pLmZpbHRlcihCb29sZWFuKSBhcyBSb3dbXVxuICAgICAgICAvLyBnbG9iYWwgYmVzdC1tYXRjaCBzbG90IChjcml0aXF1ZSBBMSlcbiAgICAgICAgY29uc3QgYWxsID0gWy4uLmFwcFJvd3MsIC4uLmFjdFJvd3NdLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKVxuICAgICAgICBjb25zdCBiZXN0ID0gYWxsWzBdXG4gICAgICAgIGlmIChiZXN0KSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYmVzdCBtYXRjaFwiLCByb3dzOiBbYmVzdF0gfSlcbiAgICAgICAgY29uc3QgcmVzdCA9IChyb3dzOiBSb3dbXSkgPT4gcm93cy5maWx0ZXIoKHIpID0+IHIgIT09IGJlc3QpXG4gICAgICAgIGlmIChyZXN0KGFwcFJvd3MpLmxlbmd0aCkgb3V0LnB1c2goeyBzZWN0aW9uOiBcImFwcHNcIiwgcm93czogcmVzdChhcHBSb3dzKSB9KVxuICAgICAgICBpZiAocmVzdChhY3RSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhY3Rpb25zXCIsIHJvd3M6IHJlc3QoYWN0Um93cykuc2xpY2UoMCwgMykgfSlcbiAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgc2VjdGlvbjogXCJ3ZWJcIixcbiAgICAgICAgICAgIHJvd3M6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLWdsb2JlLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgIGhpbnQ6IFwiXCIsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICAgICAgICAgICAgICBydW46ICgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBleGVjQXN5bmMoW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwieGRnLW9wZW5cIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgaHR0cHM6Ly9kdWNrZHVja2dvLmNvbS8/cT0ke2VuY29kZVVSSUNvbXBvbmVudChxdCl9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0pLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KVxuICAgICAgICAvLyBnaG9zdCA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXIgKGNyaXRpcXVlIEE0KVxuICAgICAgICBjb25zdCBnID0gb3V0XG4gICAgICAgICAgICAuZmxhdE1hcCgocykgPT4gcy5yb3dzKVxuICAgICAgICAgICAgLm1hcCgocikgPT4gci5uYW1lKVxuICAgICAgICAgICAgLmZpbmQoKG4pID0+IG4udG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHF0LnRvTG93ZXJDYXNlKCkpICYmIG4ubGVuZ3RoID4gcXQubGVuZ3RoKVxuICAgICAgICBnaG9zdC5zZXQoZyA/PyBcIlwiKVxuICAgICAgICByZXR1cm4gb3V0XG4gICAgfVxuXG4gICAgY29uc3Qgc2VjdGlvbnMgPSBiaW5kKHF1ZXJ5KS5hcyhyZXN1bHRzKVxuXG4gICAgY29uc3Qge1xuICAgICAgICB3aW5WaXNpYmxlLFxuICAgICAgICByZXZlYWxlZDogbGF1bmNoUmV2ZWFsZWQsXG4gICAgICAgIHNldFJldmVhbGVyOiBzZXRMYXVuY2hSZXZlYWxlcixcbiAgICAgICAgY2xvc2U6IGxhdW5jaENsb3NlLFxuICAgICAgICB0b2dnbGU6IHRvZ2dsZUZuLFxuICAgIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwibGF1bmNoZXJcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImxhdW5jaGVyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWxhdW5jaGVyXCJcbiAgICAgICAgICAgIGNsYXNzPVwibGF1bmNoZXItd2luZG93XCJcbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUH1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5LCBfY29kZSwgbW9kcykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZsYXQgPSByZXN1bHRzKHF1ZXJ5LmdldCgpKS5mbGF0TWFwKChzKSA9PiBzLnJvd3MpXG4gICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHF1ZXJ5LmdldCgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoXCJcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1RhYikge1xuICAgICAgICAgICAgICAgICAgICAvLyBUYWIgaXMgQUxXQVlTIG93bmVkXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGcgPSBnaG9zdC5nZXQoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHEgPSBxdWVyeS5nZXQoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoZyAmJiAhKG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLlNISUZUX01BU0spKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoZylcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KFxuICAgICAgICAgICAgICAgICAgICAgICAgKHNlbGVjdGVkLmdldCgpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSyA/IC0xIDogMSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZsYXQubGVuZ3RoKSAlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICBtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5DT05UUk9MX01BU0sgJiZcbiAgICAgICAgICAgICAgICAgICAgKGtleSA9PT0gR2RrLktFWV9uIHx8IGtleSA9PT0gR2RrLktFWV9wKVxuICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoXG4gICAgICAgICAgICAgICAgICAgICAgICAoc2VsZWN0ZWQuZ2V0KCkgKyAoa2V5ID09PSBHZGsuS0VZX24gPyAxIDogLTEpICsgZmxhdC5sZW5ndGgpICVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0Rvd24pIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArIDEpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1VwKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgLSAxICsgZmxhdC5sZW5ndGgpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1JldHVybikge1xuICAgICAgICAgICAgICAgICAgICBmbGF0W3NlbGVjdGVkLmdldCgpXT8ucnVuKClcbiAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoXCJcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChsYXVuY2hSZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldExhdW5jaFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzaGVldCBsYXVuY2hlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZmllbGRcIiBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tYWduaWZ5aW5nLWdsYXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxvdmVybGF5IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGVudHJ5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dXA9eyhzZWxmOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuc2V0X21heF93aWR0aF9jaGFycygxKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXRfd2lkdGhfY2hhcnMoMSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dD17YmluZChxdWVyeSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5VGV4dD17KGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChlLnRleHQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoMClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBwbGFjZWhvbGRlciBhcyBhbiBPVkVSTEFZIGxhYmVsIChub3QgZW50cnkgcGxhY2Vob2xkZXJUZXh0KSBzbyBpdHMgdGV4dFxuICAgICAgICAgICAgICB3aWR0aCBjYW4ndCBpbmZsYXRlIHRoZSBlbnRyeSdzIG5hdHVyYWwgc2l6ZSBcdTIxOTIgcGFuZWwgc3RheXMgYXQgbWluLXdpZHRoICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibHBsYWNlaG9sZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQocXVlcnkpLmFzKChxKSA9PiAhcSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiU2VhcmNoIFx1MjAxNCBhcHBzLCBmaWxlcywgYWN0aW9ucyBcdTAwQjcgJzonIGNtZHMgXHUwMEI3ICc9JyBtYXRoc1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT1cIm92ZXJsYXlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImdob3N0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlTWFya3VwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGdob3N0KS5hcygoZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWcgfHwgIXEgfHwgIWcudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHEudG9Mb3dlckNhc2UoKSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVzYyA9IChzOiBzdHJpbmcpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGludmlzaWJsZSBwcmVmaXggKHRha2VzIHVwIHNwYWNlKSArIGRpbSBzdWZmaXgsIG1hdGNoaW5nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm90b3R5cGUncyAjbGctcHJle3Zpc2liaWxpdHk6aGlkZGVufSAvICNsZy1zdWZ7Y29sb3I6ZGltfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGA8c3BhbiBhbHBoYT1cIjBcIj4ke2VzYyhnLnNsaWNlKDAsIHEubGVuZ3RoKSl9PC9zcGFuPjxzcGFuIGNvbG9yPVwiIzhkODY5M1wiPiR7ZXNjKGcuc2xpY2UocS5sZW5ndGgpKX08L3NwYW4+YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwia2JkXCIgbGFiZWw9XCJzdXBlclwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG5cbiAgICAgICAgICAgICAgICAgICAgey8qIGVtcHR5IHN0YXRlOiBjdXJhdGVkIGZyZWNlbmN5IHRpbGUgZ3JpZCArIHdpZGdldCByb3cgKi99XG4gICAgICAgICAgICAgICAgICAgIDxyZXZlYWxlciByZXZlYWxDaGlsZD17YmluZChxdWVyeSkuYXMoKHEpID0+ICFxLnRyaW0oKSl9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwidGlsZXNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezZ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7Z3JpZFRpbGVzKGFwcHMpLm1hcCgodCkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidGlsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHQubGF1bmNoKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXs4fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPXt0Lmljb25OYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17dC5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17OX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogdHdvIGNhcmRzIHNwbGl0IHRoZSByb3cgZXhhY3RseSBpbiBoYWxmIFx1MjAxNCBwcm90byBmbGV4OjEvZmxleDoxICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsd2lkZ2V0c1wiIHNwYWNpbmc9ezd9IGhvbW9nZW5lb3VzPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogbGVmdCBjYXJkIFx1MjAxNCBkYXRlICsgdG9kYXkncyBmaXJzdCBldmVudCAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ3aWRnZXQgbHdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXt0b2RheURhdGVMYWJlbCgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3RvZGF5RXZlbnRMYWJlbCgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiByaWdodCBjYXJkIFx1MjAxNCBtZWRpYSBtaW5pLWNhcmQ6IGFydCBcdTAwQjcgdGl0bGUvYXJ0aXN0IFx1MDBCNyBwbGF5ICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlUGxheWVyID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHMuZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHAucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwc1swXSA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudWxsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZWRpYVRpdGxlID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5tZWRpYS50aXRsZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHEpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcS5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHA/LnRpdGxlID8/IFwiTm90aGluZyBwbGF5aW5nXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZWRpYUFydGlzdCA9IERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IEQubWVkaWEuYXJ0aXN0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8uYXJ0aXN0ID8/IFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwbGF5SWNvbiA9IERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHEpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcS5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHA/LnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFwia29iZWwtcGxheS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwid2lkZ2V0IGx3bVwiIGhleHBhbmQgc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibHdhcnRcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImx3dFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm10aXRsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXttZWRpYVRpdGxlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXttZWRpYUFydGlzdH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm1idG4gcGxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3BsYXlJY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkoKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICA8L3JldmVhbGVyPlxuXG4gICAgICAgICAgICAgICAgICAgIHsvKiByZXN1bHRzICovfVxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibHJvd3NcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtzZWN0aW9ucy5hcygoc2VjcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWNzLmZsYXRNYXAoKHNlYykgPT4gW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJzZWNcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3NlYy5zZWN0aW9ufSAvPixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uc2VjLnJvd3MubWFwKChyKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmbGF0SWR4ID0gc2Vjcy5mbGF0TWFwKChzKSA9PiBzLnJvd3MpLmluZGV4T2YocilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17YmluZChzZWxlY3RlZCkuYXMoKHMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzID09PSBmbGF0SWR4ID8gXCJyb3cgc2VsXCIgOiBcInJvd1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgci5ydW4oKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogMjhcdTAwRDcyOCByOCBwYW5lbDIgZnJhbWUgYXJvdW5kIHRoZSAyNHB4IGljb24gKHByb3RvdHlwZSAucmkpICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInJpXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3IuaWNvbn0gcGl4ZWxTaXplPXsyNH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD17ci5tYXJrdXB9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImhpbnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3IuaGludH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInJ1bmtcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiXHUyMUI1XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHNlbGVjdGVkKS5hcyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHMpID0+IHMgPT09IGZsYXRJZHhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF0pXG4gICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgICAgICAgICB7LyogZm9vdGVyIGhpbnQgcm93IFx1MjAxNCBtYXRjaGVzIHByb3RvdHlwZSAubGZvb3QgKi99XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsZm9vdFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxNH0gaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD1cIjxiPjpyZWxvYWQ8L2I+IHNvZnQtcmVsb2FkXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+Om9zZDwvYj4gdG9nZ2xlXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OmdyYW50czwvYj4gc2NyZWVuIGFjY2Vzc1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIlx1MjE5MVx1MjE5MyBzZWxlY3QgXHUwMEI3IFx1MjFCNSBydW5cIiBoYWxpZ249e0d0ay5BbGlnbi5FTkR9IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIExhdW5jaGVyIG1hdGNoaW5nIFx1MjAxNCBzdHJhaWdodCBwb3J0IG9mIHRoZSBwcm90b3R5cGUgKHBvc3QtY3JpdGlxdWUgdmVyc2lvbik6XG4vLyBzdWJzZXF1ZW5jZSBmdXp6eSB3aXRoIHdvcmQtYm91bmRhcnkgYm9udXMsIGNhcHBlZCBsb2cyIGZyZWNlbmN5LCBwcmVmaXggZ2hvc3QuXG5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE1hdGNoIHtcbiAgICBzY29yZTogbnVtYmVyXG4gICAgbWFya3M6IG51bWJlcltdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmdXp6eShxOiBzdHJpbmcsIHQ6IHN0cmluZyk6IE1hdGNoIHwgbnVsbCB7XG4gICAgY29uc3QgcWwgPSBxLnRvTG93ZXJDYXNlKCksXG4gICAgICAgIHRsID0gdC50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHFpID0gMCxcbiAgICAgICAgc2NvcmUgPSAwLFxuICAgICAgICBsYXN0ID0gLTJcbiAgICBjb25zdCBtYXJrczogbnVtYmVyW10gPSBbXVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGwubGVuZ3RoICYmIHFpIDwgcWwubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKHRsW2ldID09PSBxbFtxaV0pIHtcbiAgICAgICAgICAgIG1hcmtzLnB1c2goaSlcbiAgICAgICAgICAgIHNjb3JlICs9IGkgPT09IDAgfHwgXCIgLV8uL1wiLmluY2x1ZGVzKHRbaSAtIDFdKSA/IDQgOiBsYXN0ID09PSBpIC0gMSA/IDIgOiAxXG4gICAgICAgICAgICBsYXN0ID0gaVxuICAgICAgICAgICAgcWkrK1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBxaSA9PT0gcWwubGVuZ3RoID8geyBzY29yZTogc2NvcmUgLSB0Lmxlbmd0aCAqIDAuMDIsIG1hcmtzIH0gOiBudWxsXG59XG5cbi8vIFBhbmdvIG1hcmt1cCBoaWdobGlnaHQgKGVzY2FwZXM7IGxlYWYgYWNjZW50IG9uIG1hdGNoZWQgY2hhcnMpXG5leHBvcnQgZnVuY3Rpb24gaGwodDogc3RyaW5nLCBtYXJrczogbnVtYmVyW10gfCBudWxsKTogc3RyaW5nIHtcbiAgICBjb25zdCBlc2MgPSAoYzogc3RyaW5nKSA9PiBHTGliLm1hcmt1cF9lc2NhcGVfdGV4dChjLCAtMSlcbiAgICBpZiAoIW1hcmtzKSByZXR1cm4gZXNjKHQpXG4gICAgY29uc3QgbSA9IG5ldyBTZXQobWFya3MpXG4gICAgbGV0IG91dCA9IFwiXCJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspXG4gICAgICAgIG91dCArPSBtLmhhcyhpKSA/IGA8c3BhbiBmb3JlZ3JvdW5kPVwiI2I1Y2I0OFwiPiR7ZXNjKHRbaV0pfTwvc3Bhbj5gIDogZXNjKHRbaV0pXG4gICAgcmV0dXJuIG91dFxufVxuXG4vLyBGcmVjZW5jeTogY2FwcGVkIHNvIGFuIGV4YWN0IHByZWZpeCBtYXRjaCBBTFdBWVMgYmVhdHMgaGFiaXQgKGNyaXRpcXVlIEEyKS5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvZnJlcS5qc29uYFxubGV0IGZyZXE6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fVxudHJ5IHtcbiAgICBmcmVxID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoR0xpYi5maWxlX2dldF9jb250ZW50cyhTVE9SRSlbMV0pKVxufSBjYXRjaCB7fVxuXG5leHBvcnQgY29uc3QgYm9vc3QgPSAoaWQ6IHN0cmluZykgPT4gTWF0aC5taW4oTWF0aC5sb2cyKDEgKyAoZnJlcVtpZF0gPz8gMCkpLCAzKVxuXG5leHBvcnQgZnVuY3Rpb24gYnVtcChpZDogc3RyaW5nKSB7XG4gICAgZnJlcVtpZF0gPSAoZnJlcVtpZF0gPz8gMCkgKyAxXG4gICAgR0xpYi5ta2Rpcl93aXRoX3BhcmVudHMoR0xpYi5wYXRoX2dldF9kaXJuYW1lKFNUT1JFKSwgMG83NTUpXG4gICAgR0xpYi5maWxlX3NldF9jb250ZW50cyhTVE9SRSwgSlNPTi5zdHJpbmdpZnkoZnJlcSkpXG59XG5cbmV4cG9ydCBjb25zdCBmcmVxdWVuY3kgPSAoaWQ6IHN0cmluZykgPT4gZnJlcVtpZF0gPz8gMFxuIiwgIi8vIENhbGVuZGFyIHBvcG92ZXIgXHUyMDE0IEdOT01FIHJlcGxpY2EgcGVyIHRoZSBwcm90b3R5cGU6IGhlcm8gZGF0ZSwgXHUyMDM5IG1vbnRoIFx1MjAzQSBuYXZcbi8vICh0aXRsZSBjbGljayA9IHRvZGF5KSwgSVNPIHdlZWsgbnVtYmVycyBhcyBxdWlldCBkaW0gdGV4dCwgRElNTUVEIFdFRUtFTkRTLFxuLy8gY2xpY2thYmxlIGRheXMgdy8gc2VsZWN0aW9uIHJpbmcgKGluayByaW5nIG9uIHRvZGF5KSwgZXZlbnQtZG90IG1hcmtlcnMsXG4vLyBldmVudHMgY2FyZCBpbiB0aGUgbm90aWZpY2F0aW9uLWNhcmQgbGFuZ3VhZ2UuIE1vbnRocyBzbGlkZSAobXVsdGl2aWV3IG1vdGlvbikuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcblxuaW50ZXJmYWNlIEV2IHtcbiAgICB0OiBzdHJpbmdcbiAgICBuOiBzdHJpbmdcbiAgICBpY29uOiBzdHJpbmdcbn1cbi8vIFwidG9kYXlcIiBcdTIwMTQgdW5kZXIgS09CRUxfREVNTywgcGlubmVkIHRvIEQudG9kYXk7IHJlYWwgY2xvY2sgb3RoZXJ3aXNlLlxuLy8gdG9kYXlWYXIgcG9sbHMgZXZlcnkgNjBzIHNvIHRoZSBoZXJvIGRhdGUgdXBkYXRlcyB3aXRob3V0IGEgcmVsb2FkLlxuY29uc3QgdG9kYXlWYXIgPSBERU1PXG4gICAgPyBWYXJpYWJsZShuZXcgRGF0ZShELnRvZGF5LnksIEQudG9kYXkubSwgRC50b2RheS5kKSlcbiAgICA6IFZhcmlhYmxlKG5ldyBEYXRlKCkpLnBvbGwoNjBfMDAwLCAoKSA9PiBuZXcgRGF0ZSgpKVxuY29uc3Qgbm93ID0gdG9kYXlWYXIuZ2V0KClcbmNvbnN0IGtleSA9ICh5OiBudW1iZXIsIG06IG51bWJlciwgZDogbnVtYmVyKSA9PiBgJHt5fS0ke20gKyAxfS0ke2R9YFxuZXhwb3J0IGNvbnN0IEVWRU5UUzogUmVjb3JkPHN0cmluZywgRXZbXT4gPSB7XG4gICAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpXTogW1xuICAgICAgICB7IHQ6IFwiMDk6NDVcIiwgbjogXCJEYWlseSBTdGFuZHVwXCIsIGljb246IFwia29iZWwtdmlkZW8tc3ltYm9saWNcIiB9LFxuICAgIF0sXG4gICAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIDExKV06IFtcbiAgICAgICAgeyB0OiBcIjEwOjMwXCIsIG46IFwiS2llcmFuIEJpcnRoZGF5XCIsIGljb246IFwia29iZWwtY2FrZS1zeW1ib2xpY1wiIH0sXG4gICAgICAgIHsgdDogXCIxMzowMFwiLCBuOiBcIkxvbmRvbiBUaGluZ1wiLCBpY29uOiBcImtvYmVsLXBpbi1zeW1ib2xpY1wiIH0sXG4gICAgXSxcbiAgICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMTMpXTogW1xuICAgICAgICB7IHQ6IFwiQWxsIGRheVwiLCBuOiBcIk15IEJpcnRoZGF5XCIsIGljb246IFwia29iZWwtY2FrZS1zeW1ib2xpY1wiIH0sXG4gICAgXSxcbn1cblxuY29uc3QgdmlldyA9IFZhcmlhYmxlKHsgeTogbm93LmdldEZ1bGxZZWFyKCksIG06IG5vdy5nZXRNb250aCgpIH0pXG5jb25zdCBzZWwgPSBWYXJpYWJsZShuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpKVxuXG5mdW5jdGlvbiBpc29XZWVrKGQ6IERhdGUpOiBudW1iZXIge1xuICAgIGNvbnN0IHQgPSBuZXcgRGF0ZShEYXRlLlVUQyhkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpKVxuICAgIGNvbnN0IGRuID0gKHQuZ2V0VVRDRGF5KCkgKyA2KSAlIDdcbiAgICB0LnNldFVUQ0RhdGUodC5nZXRVVENEYXRlKCkgLSBkbiArIDMpXG4gICAgY29uc3QgZiA9IG5ldyBEYXRlKERhdGUuVVRDKHQuZ2V0VVRDRnVsbFllYXIoKSwgMCwgNCkpXG4gICAgcmV0dXJuIDEgKyBNYXRoLnJvdW5kKCgoK3QgLSArZikgLyA4NjRlNSAtIDMgKyAoKGYuZ2V0VVRDRGF5KCkgKyA2KSAlIDcpKSAvIDcpXG59XG5cbmZ1bmN0aW9uIEdyaWQoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImNhbC1ncmlkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAgICAgICAgICB7YmluZChWYXJpYWJsZS5kZXJpdmUoW3ZpZXcsIHNlbF0sICh2LCBzKSA9PiAoeyB2LCBzIH0pKSkuYXMoKHsgdiwgcyB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlyc3QgPSBuZXcgRGF0ZSh2LnksIHYubSwgMSlcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IChmaXJzdC5nZXREYXkoKSArIDYpICUgN1xuICAgICAgICAgICAgICAgIGNvbnN0IGRheXMgPSBuZXcgRGF0ZSh2LnksIHYubSArIDEsIDApLmdldERhdGUoKVxuICAgICAgICAgICAgICAgIGNvbnN0IHByZXZEYXlzID0gbmV3IERhdGUodi55LCB2Lm0sIDApLmdldERhdGUoKVxuICAgICAgICAgICAgICAgIGNvbnN0IHJvd3MgPSBbXVxuICAgICAgICAgICAgICAgIHJvd3MucHVzaChcbiAgICAgICAgICAgICAgICAgICAgPGJveCBob21vZ2VuZW91cz5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtbXCJcIiwgXCJNXCIsIFwiVFwiLCBcIldcIiwgXCJUXCIsIFwiRlwiLCBcIlNcIiwgXCJTXCJdLm1hcCgoZCkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImRvd1wiIGxhYmVsPXtkfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDY7IHIrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjZWxscyA9IFtcbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwid2sgdG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtgJHtpc29XZWVrKG5ldyBEYXRlKHYueSwgdi5tLCByICogNyAtIHN0YXJ0ICsgMSkpfWB9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPixcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDc7IGMrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaSA9IHIgKiA3ICsgYyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkID0gaSAtIHN0YXJ0ICsgMVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3V0ID0gZCA8IDEgfHwgZCA+IGRheXNcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gb3V0ID8gKGQgPCAxID8gcHJldkRheXMgKyBkIDogZCAtIGRheXMpIDogZFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xzID0gW1wiZGF5XCJdXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYyA+PSA1KSBjbHMucHVzaChcIndlXCIpIC8vIFdFRUtFTkRTIERJTU1FRFxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG91dCkgY2xzLnB1c2goXCJvdXRcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvZGF5ID0gbm93XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkID09PSB0b2RheS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdi5tID09PSB0b2RheS5nZXRNb250aCgpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHYueSA9PT0gdG9kYXkuZ2V0RnVsbFllYXIoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xzLnB1c2goXCJ0b2RheVwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChFVkVOVFNba2V5KHYueSwgdi5tLCBkKV0pIGNscy5wdXNoKFwiZXZcIikgLy8gZXZlbnQtZG90IChDU1MgOjphZnRlciBcdTIxOTIgdW5kZXJsaW5lIGRvdClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMuZ2V0RGF0ZSgpID09PSBkICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMuZ2V0TW9udGgoKSA9PT0gdi5tICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMuZ2V0RnVsbFllYXIoKSA9PT0gdi55XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHMucHVzaChcInNlbFwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaGFzRXYgPSAhb3V0ICYmICEhRVZFTlRTW2tleSh2LnksIHYubSwgZCldXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBkYXkgc2l0cyBhdCBpdHMgbmF0dXJhbCAyNFx1MDBENzI0IGNlbnRyZWQgaW4gdGhlIGdyaWQgY29sdW1uIChub3QgZmlsbGluZyBpdCksXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBzbyB0b2RheSdzIGxlYWYgZmlsbCBpcyBhIHRpZ2h0IGNpcmNsZSByYXRoZXIgdGhhbiBhIGNvbHVtbi13aWRlIG92YWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNlbGxzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3V0ID8gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtjbHMuam9pbihcIiBcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YCR7bGFiZWx9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzZWwuc2V0KG5ldyBEYXRlKHYueSwgdi5tLCBkKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtoYXNFdiA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8b3ZlcmxheT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXtgJHtsYWJlbH1gfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogM3B4IGV2ZW50IGRvdCwgYWJzb2x1dGUgYm90dG9tLWNlbnRlciAoR1RLIGhhcyBubyA6OmFmdGVyKSAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT1cIm92ZXJsYXlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJldmRvdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9e2Ake2xhYmVsfWB9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcm93cy5wdXNoKDxib3ggaG9tb2dlbmVvdXM+e2NlbGxzfTwvYm94PilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJvd3NcbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIEV2ZW50c0NhcmQoKSB7XG4gICAgLy8gUHJvdG90eXBlIC5jYWxldjogYSBwYW5lbDIgY2FyZCAocGFkMTAvcjEyKSB3cmFwcGluZyB0aGUgZGF0ZSBoZWFkZXIgKyBkYXJrZXJcbiAgICAvLyAoLS1wYW5lbCkgZXZlbnQgcm93czsgaGVhZGVyJ3Mgb3duIGJvdHRvbSBwYWRkaW5nIGlzIHRoZSBoZWFkZXJcdTIxOTJyb3cgZ2FwIChzcGFjaW5nIDApLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJldmNhcmRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgIHtiaW5kKHNlbCkuYXMoKGQpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBldnMgPSBFVkVOVFNba2V5KGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSldID8/IFtdXG4gICAgICAgICAgICAgICAgY29uc3QgaGVhZCA9IChcbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImV2aGVhZFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB3ZWVrZGF5OiBcImxvbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXk6IFwibnVtZXJpY1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vbnRoOiBcImxvbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICBpZiAoIWV2cy5sZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkLFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jYWxlbmRhci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViXCIgbGFiZWw9XCJObyBldmVudHNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+LFxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICAgICAgaGVhZCxcbiAgICAgICAgICAgICAgICAgICAgLi4uZXZzLm1hcCgoZSkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImV2cm93XCIgc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiAyNlx1MDBENzI2IHI4IGNvbG9yZWQgaWNvbiB0aWxlIChwcm90b3R5cGUgLmV2aWMpLCB3aGl0ZSBnbHlwaCAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZXZpY1wiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17ZS5pY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e2Uubn0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViIHRuXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtlLnR9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgKSksXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQ2FsZW5kYXIoKSB7XG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwiY2FsZW5kYXJcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImNhbGVuZGFyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWNhbGVuZGFyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiY2FsZW5kYXItd2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1B9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChjbG9zZSgpLCB0cnVlKSA6IGZhbHNlKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0RPV059XG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMjB9XG4gICAgICAgICAgICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2hlZXQgY2FsXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjYWxoZXJvXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN1YlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGVyb1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRheTogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb250aDogXCJsb25nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5ZWFyOiBcIm51bWVyaWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDxjZW50ZXJib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0KHYubSA/IHsgeTogdi55LCBtOiB2Lm0gLSAxIH0gOiB7IHk6IHYueSAtIDEsIG06IDExIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLWxlZnQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtb250aFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB2aWV3LnNldCh7IHk6IG5vdy5nZXRGdWxsWWVhcigpLCBtOiBub3cuZ2V0TW9udGgoKSB9KX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodmlldykuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAodikgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgRGF0ZSh2LnksIHYubSkudG9Mb2NhbGVTdHJpbmcoXCJlblwiLCB7IG1vbnRoOiBcImxvbmdcIiB9KSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHYueSAhPT0gbm93LmdldEZ1bGxZZWFyKCkgPyBgICR7di55fWAgOiBcIlwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdiA9IHZpZXcuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlldy5zZXQodi5tID09PSAxMSA/IHsgeTogdi55ICsgMSwgbTogMCB9IDogeyB5OiB2LnksIG06IHYubSArIDEgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICAgICAgICAgICAgICA8R3JpZCAvPlxuICAgICAgICAgICAgICAgICAgICA8RXZlbnRzQ2FyZCAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFF1aWNrIHNldHRpbmdzLiBQcm90b3R5cGUtZmluYWw6IHVuaWZvcm0gcGlsbCB0aWxlcyBmcm9tIGEgQ0FUQUxPRyAoY3VzdG9taXNhYmxlLFxuLy8gcGVyc2lzdGVkKSwgR05PTUUgdGhpbiBzbGlkZXJzLCBkcmlsbGRvd25zIGFzIGEgc3ByaW5nLXNsaWQgdHdvLXZpZXcgc3RhY2tcbi8vIChXaS1GaSBuZXR3b3JrcyAvIEJUIGRldmljZXMgLyBwZXItYXBwIG1peGVyIHdpdGggYSBNYXN0ZXIgcm93KSwgY29tcGFjdCB0b3Agcm93XG4vLyAoYmF0dGVyeSBcdTAwQjcgcGVuY2lsL2xlYWYvbG9jay9wb3dlciksIGdub2JsaW4gYmFubmVyICsgcmVjb25uZWN0IHdoaWxlIGRlZ3JhZGVkLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IEJsdWV0b290aCBmcm9tIFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IHsgY29ubmVjdGVkLCByZWxvYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBNT1RJT04gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciwgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5pbXBvcnQgeyBUaW55U2xpZGVyIH0gZnJvbSBcIi4uL2xpYi90aW55c2xpZGVyXCJcbmltcG9ydCB7IEZpeGVkQ2hldiB9IGZyb20gXCIuLi9saWIvZml4ZWRjaGV2XCJcblxudHlwZSBEcmlsbCA9IG51bGwgfCBcIndpZmlcIiB8IFwiYnRcIiB8IFwibWl4XCJcbi8vIEtPQkVMX0RSSUxMIGxldHMgdGhlIGRldmtpdCByZW5kZXIgYSBkcmlsbGRvd24gZGlyZWN0bHkgKG5vIHBvaW50ZXIgdG8gY2xpY2sgdGhlXG4vLyBjaGV2cm9uIGluIGhlYWRsZXNzKTsgcHJvZHVjdGlvbiBkZWZhdWx0IGlzIG51bGwuXG5jb25zdCBkcmlsbCA9IFZhcmlhYmxlPERyaWxsPigoR0xpYi5nZXRlbnYoXCJLT0JFTF9EUklMTFwiKSBhcyBEcmlsbCkgfHwgbnVsbClcblxuLy8gVGlsZSBjYXRhbG9nIFx1MjAxNCBtaXJyb3JzIHByb3RvdHlwZSBDQVRBTE9HOyBwZXJzaXN0ZWQgbGF5b3V0IGluIHN0YXRlIGRpci5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvcXMtdGlsZXMuanNvbmBcbmxldCB0aWxlczogc3RyaW5nW10gPSBbXCJ3aWZpXCIsIFwiYnRcIiwgXCJzYXZlXCIsIFwiZGFya1wiLCBcInNpbGVudFwiLCBcIm5pZ2h0XCIsIFwidm9sdW1lXCIsIFwiYnJpZ2h0bmVzc1wiXVxudHJ5IHtcbiAgICB0aWxlcyA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKEdMaWIuZmlsZV9nZXRfY29udGVudHMoU1RPUkUpWzFdKSlcbn0gY2F0Y2gge31cblxuZnVuY3Rpb24gQ2hpcChwcm9wczoge1xuICAgIGlkOiBzdHJpbmdcbiAgICBsYWJlbDogc3RyaW5nXG4gICAgaWNvbjogc3RyaW5nXG4gICAgYWN0aXZlOiBhbnlcbiAgICBzdWI/OiBhbnlcbiAgICBvblRvZ2dsZWQ6ICgpID0+IHZvaWRcbiAgICBvbkRyaWxsPzogKCkgPT4gdm9pZFxufSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9e2JpbmQocHJvcHMuYWN0aXZlKS5hcygoYTogYm9vbGVhbikgPT4gKGEgPyBcImNoaXAgcGlsbCBvblwiIDogXCJjaGlwIHBpbGxcIikpfT5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjaGlwYlwiIGhleHBhbmQ9e3RydWV9IG9uQ2xpY2tlZD17cHJvcHMub25Ub2dnbGVkfT5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3Byb3BzLmljb259IC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3Byb3BzLmxhYmVsfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAge3Byb3BzLnN1YiAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ViXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3Byb3BzLnN1Yn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIHsvKiBmaXhlZCAzMnB4IHNlYW0rY2hldnJvbiAocHJvdG8gLmNoZXZiKSBcdTIwMTQgaGV4cGFuZD1mYWxzZSBzbyB0aGUgbWFpbiBidXR0b24gb3ducyBzbGFjayAqL31cbiAgICAgICAgICAgIHtwcm9wcy5vbkRyaWxsICYmIChcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY2hldlwiIGhleHBhbmQ9e2ZhbHNlfSB3aWR0aFJlcXVlc3Q9ezMyfSBvbkNsaWNrZWQ9e3Byb3BzLm9uRHJpbGx9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gU2xpZGVycygpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICAvLyBJbiBERU1PIG1vZGUgcmVuZGVyIHRoZSB0d28gc2xpZGVycyByZWdhcmRsZXNzIG9mIGEgcmVhbCBzcGVha2VyLCBwaW5uZWQgdG8gdGhlXG4gICAgLy8gcHJvdG90eXBlJ3MgbW9jayB2YWx1ZXMgKHZvbHVtZSAwLjY0LCBicmlnaHRuZXNzIDAuODApIGZvciBhIGZhaXIgb3ZlcmxheS5cbiAgICBpZiAoIXNwZWFrZXIgJiYgIURFTU8pIHJldHVybiA8Ym94IC8+XG4gICAgY29uc3Qgdm9sSWNvbiA9IHNwZWFrZXJcbiAgICAgICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoKGkpID0+IGkgPz8gXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIilcbiAgICAgICAgOiBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiXG4gICAgLy8gcHJvdG8gLnNsaWRlcnMgaXMgYSBmbGV4IGNvbHVtbiB3aXRoIE5PIGdhcCBiZXR3ZWVuIHRoZSB0d28gc3Jvd3MgKGVhY2ggbWluLWggNDIpLlxuICAgIC8vIFRpbnlTbGlkZXIgb3ZlcnJpZGVzIHZmdW5jX21lYXN1cmUgdG8gcmVwb3J0IG5hdHVyYWw9MXB4IHNvIHRoZSBzcm93IGRvZXNuJ3RcbiAgICAvLyBpbmZsYXRlIHRoZSBwYW5lbCBiZXlvbmQgdGhlIGNoaXAtZ3JpZCB3aWR0aCAoR1RLIENTUyBtYXgtd2lkdGggaXMgbm90IHJlc3BlY3RlZCkuXG4gICAgY29uc3QgaW5pdFZvbCA9IERFTU8gPyBELnZvbHVtZSA6IChzcGVha2VyPy52b2x1bWUgPz8gMC42NClcbiAgICBjb25zdCB2b2xWYWx1ZSA9IFZhcmlhYmxlKGluaXRWb2wpXG4gICAgY29uc3Qgdm9sU2xpZGVyID0gbmV3IFRpbnlTbGlkZXIoeyBoZXhwYW5kOiB0cnVlLCBjc3NDbGFzc2VzOiBbXCJzbGlkZXJcIl0sIHZhbHVlOiBpbml0Vm9sIH0pXG4gICAgaWYgKCFERU1PICYmIHNwZWFrZXIpXG4gICAgICAgIGJpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIikuc3Vic2NyaWJlKCh2OiBudW1iZXIpID0+IHtcbiAgICAgICAgICAgIHZvbFNsaWRlci5nZXRfYWRqdXN0bWVudCgpLnZhbHVlID0gdlxuICAgICAgICAgICAgdm9sVmFsdWUuc2V0KHYpXG4gICAgICAgIH0pXG4gICAgLy8gR3RrUmFuZ2U6OmNoYW5nZS12YWx1ZSBhcmdzOiAocmFuZ2UsIHNjcm9sbFR5cGUsIHZhbHVlKVxuICAgIHZvbFNsaWRlci5jb25uZWN0KFwiY2hhbmdlLXZhbHVlXCIsIChfczogYW55LCBfdDogYW55LCB2OiBudW1iZXIpID0+IHtcbiAgICAgICAgaWYgKHNwZWFrZXIpIHNwZWFrZXIudm9sdW1lID0gdlxuICAgICAgICB2b2xWYWx1ZS5zZXQodilcbiAgICB9KVxuXG4gICAgY29uc3QgYnJpZ2h0VmFsdWUgPSBWYXJpYWJsZShERU1PID8gRC5icmlnaHRuZXNzIDogMC44KVxuICAgIGlmICghREVNTykge1xuICAgICAgICBQcm9taXNlLmFsbChbZXhlY0FzeW5jKFwiYnJpZ2h0bmVzc2N0bCBnZXRcIiksIGV4ZWNBc3luYyhcImJyaWdodG5lc3NjdGwgbWF4XCIpXSlcbiAgICAgICAgICAgIC50aGVuKChbY3VyLCBtYXhdKSA9PiBicmlnaHRWYWx1ZS5zZXQocGFyc2VJbnQoY3VyLnRyaW0oKSkgLyBwYXJzZUludChtYXgudHJpbSgpKSkpXG4gICAgICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8qIGJyaWdodG5lc3NjdGwgYWJzZW50IG9uIGRlc2t0b3AgKi9cbiAgICAgICAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IGJyaWdodFNsaWRlciA9IG5ldyBUaW55U2xpZGVyKHtcbiAgICAgICAgaGV4cGFuZDogdHJ1ZSxcbiAgICAgICAgY3NzQ2xhc3NlczogW1wic2xpZGVyXCJdLFxuICAgICAgICB2YWx1ZTogYnJpZ2h0VmFsdWUuZ2V0KCksXG4gICAgfSlcbiAgICBicmlnaHRWYWx1ZS5zdWJzY3JpYmUoKHYpID0+IHtcbiAgICAgICAgYnJpZ2h0U2xpZGVyLmdldF9hZGp1c3RtZW50KCkudmFsdWUgPSB2XG4gICAgfSlcbiAgICBicmlnaHRTbGlkZXIuY29ubmVjdChcImNoYW5nZS12YWx1ZVwiLCAoX3M6IGFueSwgX3Q6IGFueSwgdjogbnVtYmVyKSA9PlxuICAgICAgICBleGVjQXN5bmMoYGJyaWdodG5lc3NjdGwgc2V0ICR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IGJyaWdodFZhbHVlLnNldCh2KSlcbiAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB7fSlcbiAgICApXG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwic2xpZGVyc1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3ZvbEljb259IC8+XG4gICAgICAgICAgICAgICAge3ZvbFNsaWRlcn1cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzdmFsIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgeGFsaWduPXsxfVxuICAgICAgICAgICAgICAgICAgICB3aWR0aFJlcXVlc3Q9ezMyfVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZCh2b2xWYWx1ZSkuYXMoKHYpID0+IGAke01hdGgucm91bmQodiAqIDEwMCl9JWApfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImNoZXZcIiB3aWR0aFJlcXVlc3Q9ezMxfSBvbkNsaWNrZWQ9eygpID0+IGRyaWxsLnNldChcIm1peFwiKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwic3Jvd1wiIHNwYWNpbmc9ezl9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJyaWdodG5lc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIHticmlnaHRTbGlkZXJ9XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ZhbCB0blwiXG4gICAgICAgICAgICAgICAgICAgIHhhbGlnbj17MX1cbiAgICAgICAgICAgICAgICAgICAgd2lkdGhSZXF1ZXN0PXszMn1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoYnJpZ2h0VmFsdWUpLmFzKCh2KSA9PiBgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIHsvKiBndXR0ZXIgYWxpZ25zIHdpdGggY2hldiB3aWR0aCAoXHUyMjQ4MzFweCk7IHN2YWw9MzIgKyBzcGFjaW5nPTkgXHUyMTkyIHNwYWNlIHRha2VuICovfVxuICAgICAgICAgICAgICAgIDxib3ggLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIEdub2JsaW5CYW5uZXIoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImdiYW5uZXJcIiB2aXNpYmxlPXtERU1PID8gZmFsc2UgOiBiaW5kKGNvbm5lY3RlZCkuYXMoKGMpID0+ICFjKX0gc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtd2FybmluZy1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidFwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIm9yZy5nbm9ibGluLlNoZWxsIGRpc2Nvbm5lY3RlZFwiIC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIm9zZCArIG5vdGlmcyBoYW5kZWQgYmFjayB0byBnbm9tZVwiXG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImdidG5cIiBsYWJlbD1cIlJlY29ubmVjdFwiIG9uQ2xpY2tlZD17KCkgPT4gcmVsb2FkKCkuY2F0Y2goKCkgPT4ge30pfSAvPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIFx1MjUwMFx1MjUwMCByZWFsLWJhY2tlbmQgdG9nZ2xlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbi8vIERhcmsgU3R5bGU6IG9yZy5nbm9tZS5kZXNrdG9wLmludGVyZmFjZSBjb2xvci1zY2hlbWVcbmNvbnN0IGlmYWNlU2V0dGluZ3MgPSBuZXcgR2lvLlNldHRpbmdzKHsgc2NoZW1hOiBcIm9yZy5nbm9tZS5kZXNrdG9wLmludGVyZmFjZVwiIH0pXG5jb25zdCB0RGFyayA9IFZhcmlhYmxlKGlmYWNlU2V0dGluZ3MuZ2V0X3N0cmluZyhcImNvbG9yLXNjaGVtZVwiKSA9PT0gXCJwcmVmZXItZGFya1wiKVxuaWZhY2VTZXR0aW5ncy5jb25uZWN0KFwiY2hhbmdlZDo6Y29sb3Itc2NoZW1lXCIsICgpID0+XG4gICAgdERhcmsuc2V0KGlmYWNlU2V0dGluZ3MuZ2V0X3N0cmluZyhcImNvbG9yLXNjaGVtZVwiKSA9PT0gXCJwcmVmZXItZGFya1wiKVxuKVxuXG4vLyBOaWdodCBMaWdodDogb3JnLmdub21lLnNldHRpbmdzLWRhZW1vbi5wbHVnaW5zLmNvbG9yXG5sZXQgY29sb3JTZXR0aW5nczogR2lvLlNldHRpbmdzIHwgbnVsbCA9IG51bGxcbmNvbnN0IHROaWdodCA9IFZhcmlhYmxlKGZhbHNlKVxudHJ5IHtcbiAgICBjb2xvclNldHRpbmdzID0gbmV3IEdpby5TZXR0aW5ncyh7IHNjaGVtYTogXCJvcmcuZ25vbWUuc2V0dGluZ3MtZGFlbW9uLnBsdWdpbnMuY29sb3JcIiB9KVxuICAgIHROaWdodC5zZXQoY29sb3JTZXR0aW5ncy5nZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIikpXG4gICAgY29sb3JTZXR0aW5ncy5jb25uZWN0KFwiY2hhbmdlZDo6bmlnaHQtbGlnaHQtZW5hYmxlZFwiLCAoKSA9PlxuICAgICAgICB0TmlnaHQuc2V0KGNvbG9yU2V0dGluZ3MhLmdldF9ib29sZWFuKFwibmlnaHQtbGlnaHQtZW5hYmxlZFwiKSlcbiAgICApXG59IGNhdGNoIHtcbiAgICAvKiBzY2hlbWEgYWJzZW50IG9uIHNvbWUgc3lzdGVtcyAqL1xufVxuXG4vLyBTaWxlbnQ6IG11dGUgb24gdGhlIGRlZmF1bHQgV2lyZVBsdW1iZXIgc3BlYWtlclxuY29uc3QgX3NwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuY29uc3QgdFNpbGVudCA9IF9zcGVha2VyXG4gICAgPyAoYmluZChfc3BlYWtlciwgXCJtdXRlXCIpIGFzIHVua25vd24gYXMgVmFyaWFibGU8Ym9vbGVhbj4pXG4gICAgOiBWYXJpYWJsZShmYWxzZSlcblxuLy8gUG93ZXIgU2F2ZXI6IHBvd2VycHJvZmlsZXNjdGwgKGZhbGxzIGJhY2sgdG8gZmFsc2UgaWYgdW5hdmFpbGFibGUpXG5jb25zdCB0U2F2ZSA9IFZhcmlhYmxlKGZhbHNlKVxuZXhlY0FzeW5jKFwicG93ZXJwcm9maWxlc2N0bCBnZXRcIilcbiAgICAudGhlbigodikgPT4gdFNhdmUuc2V0KHYudHJpbSgpID09PSBcInBvd2VyLXNhdmVyXCIpKVxuICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIC8qIHBvd2VycHJvZmlsZXNjdGwgYWJzZW50ICovXG4gICAgfSlcblxuLy8gZWRpdC1tb2RlIGZvciB0aGUgdGlsZSBjYXRhbG9nIChwZW5jaWwgYnV0dG9uKSBcdTIwMTQgaG9vayBmb3IgdGlsZSByZWFycmFuZ2UvY3VzdG9taXNlLlxuY29uc3QgZWRpdE1vZGUgPSBWYXJpYWJsZShmYWxzZSlcblxuLy8gUHJvdG90eXBlIHRvZ2dsZSBjaGlwcyBhcmUgbGFiZWwtb25seSwgdmVydGljYWxseSBjZW50ZXJlZCBcdTIwMTQgc3RhdGUgaXMgc2hvd24gYnkgdGhlXG4vLyBsZWFmIGZpbGwsIG5vdCBhIHN1Yi1saW5lIChvbmx5IFdpLUZpL0JsdWV0b290aCBjYXJyeSBhIHN1YikuXG5mdW5jdGlvbiBUb2dnbGVDaGlwKHByb3BzOiB7XG4gICAgbGFiZWw6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIHY6IFZhcmlhYmxlPGJvb2xlYW4+XG4gICAgb25Ub2dnbGVkPzogKCkgPT4gdm9pZFxufSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxDaGlwXG4gICAgICAgICAgICBpZD17cHJvcHMubGFiZWx9XG4gICAgICAgICAgICBsYWJlbD17cHJvcHMubGFiZWx9XG4gICAgICAgICAgICBpY29uPXtwcm9wcy5pY29ufVxuICAgICAgICAgICAgYWN0aXZlPXtiaW5kKHByb3BzLnYpfVxuICAgICAgICAgICAgb25Ub2dnbGVkPXtwcm9wcy5vblRvZ2dsZWQgPz8gKCgpID0+IHByb3BzLnYuc2V0KCFwcm9wcy52LmdldCgpKSl9XG4gICAgICAgIC8+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBiYXR0ZXJ5TWV0YSgpOiBhbnkge1xuICAgIGNvbnN0IGJhdCA9IEJhdHRlcnkuZ2V0X2RlZmF1bHQoKVxuICAgIGlmICghYmF0KSByZXR1cm4gbnVsbFxuICAgIHJldHVybiBiaW5kKGJhdCwgXCJwZXJjZW50YWdlXCIpLmFzKChwKSA9PiB7XG4gICAgICAgIGNvbnN0IHBjdCA9IE1hdGgucm91bmQocCAqIDEwMClcbiAgICAgICAgY29uc3Qgc3RhdGUgPSBiYXQuZnVsbCA/IFwiRnVsbHkgY2hhcmdlZFwiIDogYmF0LmNoYXJnaW5nID8gXCJDaGFyZ2luZ1wiIDogXCJEaXNjaGFyZ2luZ1wiXG4gICAgICAgIHJldHVybiBgJHtwY3R9JSBcdTAwQjcgJHtzdGF0ZX1gXG4gICAgfSlcbn1cbmNvbnN0IGhhc0JhdHRlcnkgPSBCYXR0ZXJ5LmdldF9kZWZhdWx0KCkgIT0gbnVsbFxuXG5mdW5jdGlvbiBSb290KHsgbmFtZSB9OiB7IG5hbWU/OiBzdHJpbmcgfSkge1xuICAgIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICAgIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgICAvLyBzcGFjaW5nIDA6IGV4YWN0IHNlY3Rpb24gZ2FwcyBjb21lIGZyb20gbWFyZ2lucyAocXRvcFx1MjE5MmNoaXBzIDEsIGNoaXAgcm93cyA4LFxuICAgIC8vIGNoaXBzXHUyMTkyc2xpZGVycyAxMCkgXHUyMDE0IGEgdW5pZm9ybSBib3ggc3BhY2luZyBjYW4ndCBleHByZXNzIGFsbCB0aHJlZS5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IG5hbWU9e25hbWV9IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgey8qIHRvcCByb3c6IGJhdHRlcnkgXHUwMEI3IHJlbG9hZCBcdTAwQjcgbG9jayBcdTAwQjcgcG93ZXIgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwicXMtdG9wXCIgc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgey8qIGJhdHRlcnkgcGlsbDogZ2x5cGggKyB0YWJ1bGFyIG1ldGEgXHUyMDE0IGhpZGRlbiB3aGVuIG5vIGJhdHRlcnkgcHJlc2VudCAqL31cbiAgICAgICAgICAgICAgICB7KERFTU8gfHwgaGFzQmF0dGVyeSkgJiYgKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibWV0YVwiIHNwYWNpbmc9ezZ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1iYXR0ZXJ5LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e0RFTU8gPyBELm1ldGEgOiBiYXR0ZXJ5TWV0YSgpfSAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIDxib3ggaGV4cGFuZCAvPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuIGxlYWZcIiBvbkNsaWNrZWQ9eygpID0+IHJlbG9hZCgpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbGVhZi1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG5cIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWxvY2stc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuXCIgb25DbGlja2VkPXsoKSA9PiBlZGl0TW9kZS5zZXQoIWVkaXRNb2RlLmdldCgpKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBlbmNpbC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG4gZGFuZ2VyXCIgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBvd2VyLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPEdub2JsaW5CYW5uZXIgLz5cbiAgICAgICAgICAgIHsvKiBvbmUgY2hpcHMgZ3JpZDogMyByb3dzIGF0IDhweCwgbWFyZ2luLWJvdHRvbSAxMCBiZWZvcmUgdGhlIHNsaWRlcnMgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2hpcC1ncmlkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgIHsoREVNTyB8fCBuZXQud2lmaSkgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgPENoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZD1cIndpZmlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiV2ktRmlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC13aWZpLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e0RFTU8gPyBWYXJpYWJsZSh0cnVlKSA6IGJpbmQobmV0LndpZmkhLCBcImVuYWJsZWRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ViPXtERU1PID8gRC53aWZpU3NpZCA6IGJpbmQobmV0LndpZmkhLCBcInNzaWRcIikuYXMoKHMpID0+IHMgPz8gXCJPZmZcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghREVNTyAmJiBuZXQud2lmaSkgbmV0LndpZmkuZW5hYmxlZCA9ICFuZXQud2lmaS5lbmFibGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkRyaWxsPXsoKSA9PiBkcmlsbC5zZXQoXCJ3aWZpXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPENoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkPVwiYnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJCbHVldG9vdGhcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLWJsdWV0b290aC1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBWYXJpYWJsZSh0cnVlKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcygoZCkgPT4gZC5zb21lKCh4KSA9PiB4LmNvbm5lY3RlZCkpXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWI9e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBELmJ0RGV2aWNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChidCwgXCJkZXZpY2VzXCIpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoZCkgPT4gZC5maW5kKCh4KSA9PiB4LmNvbm5lY3RlZCk/LmFsaWFzID8/IFwiT2ZmXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIURFTU8pIGJ0LnRvZ2dsZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgb25EcmlsbD17KCkgPT4gZHJpbGwuc2V0KFwiYnRcIil9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgIDxUb2dnbGVDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIlBvd2VyIFNhdmVyXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1ib2x0LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3RTYXZlfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9ICF0U2F2ZS5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4ZWNBc3luYyhgcG93ZXJwcm9maWxlc2N0bCBzZXQgJHtuZXh0ID8gXCJwb3dlci1zYXZlclwiIDogXCJiYWxhbmNlZFwifWApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHRTYXZlLnNldChuZXh0KSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKCgpID0+IHRTYXZlLnNldChuZXh0KSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDxUb2dnbGVDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIkRhcmsgU3R5bGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLW1vb24tc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgdj17dERhcmt9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gIXREYXJrLmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWZhY2VTZXR0aW5ncy5zZXRfc3RyaW5nKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcImNvbG9yLXNjaGVtZVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0ID8gXCJwcmVmZXItZGFya1wiIDogXCJkZWZhdWx0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJTaWxlbnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLWJlbGwtc2xhc2gtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgdj17dFNpbGVudH1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChfc3BlYWtlcikgX3NwZWFrZXIubXV0ZSA9ICFfc3BlYWtlci5tdXRlXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJOaWdodCBMaWdodFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtc3VuLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3ROaWdodH1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb2xvclNldHRpbmdzKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvclNldHRpbmdzLnNldF9ib29sZWFuKFwibmlnaHQtbGlnaHQtZW5hYmxlZFwiLCAhdE5pZ2h0LmdldCgpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPFNsaWRlcnMgLz5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBTaWduYWwtc3RyZW5ndGggZ2x5cGggZm9yIGFuIGFjY2VzcyBwb2ludCAoMFx1MjAxMzEwMCBcdTIxOTIgd2lmaSB0aWVycykuXG5mdW5jdGlvbiB3aWZpSWNvbihzdHJlbmd0aDogbnVtYmVyKTogc3RyaW5nIHtcbiAgICByZXR1cm4gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgLy8gc2luZ2xlIGdseXBoOyBzdHJlbmd0aCBzaG93biBhcyB0ZXh0IG1ldGFcbn1cblxuLy8gV2ktRmkgQVAgbGlzdCBcdTIwMTQgcmVhbCBBc3RhbE5ldHdvcmsgYWNjZXNzIHBvaW50cywgY29ubmVjdGVkIG9uZSBtYXJrZWQgLmFjdGl2ZS5cbmZ1bmN0aW9uIFdpZmlMaXN0KCkge1xuICAgIGNvbnN0IHdpZmkgPSBOZXR3b3JrLmdldF9kZWZhdWx0KCkud2lmaVxuICAgIGlmICghd2lmaSkgcmV0dXJuIDxib3ggLz5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgIHtiaW5kKHdpZmksIFwiYWNjZXNzUG9pbnRzXCIpLmFzKChhcHMpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSB3aWZpLmFjdGl2ZUFjY2Vzc1BvaW50XG4gICAgICAgICAgICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGFwc1xuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChhcCkgPT4gYXAuc3NpZCAmJiAhc2Vlbi5oYXMoYXAuc3NpZCkgJiYgc2Vlbi5hZGQoYXAuc3NpZCkpXG4gICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnN0cmVuZ3RoIC0gYS5zdHJlbmd0aClcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKGFwKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvbiA9IGFjdGl2ZSAmJiBhcC5zc2lkID09PSBhY3RpdmUuc3NpZFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtvbiA/IFwieHJvdyBhY3RpdmVcIiA6IFwieHJvd1wifVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHdpZmkuYWN0aXZhdGVfY29ubmVjdGlvbihhcCwgbnVsbCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17d2lmaUljb24oYXAuc3RyZW5ndGgpfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXthcC5zc2lkfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ4c1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e29uID8gXCJDb25uZWN0ZWRcIiA6IGAke2FwLnN0cmVuZ3RofSVgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBCbHVldG9vdGggZGV2aWNlIGxpc3QgXHUyMDE0IHNhbWUgLnhyb3cgZ3JhbW1hciBhcyBXaS1GaTsgY29ubmVjdGVkIGRldmljZSBpcyAuYWN0aXZlLlxuZnVuY3Rpb24gQnRMaXN0KCkge1xuICAgIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgIHtiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoKGRldmljZXMpID0+XG4gICAgICAgICAgICAgICAgZGV2aWNlc1xuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChkKSA9PiBkLm5hbWUgfHwgZC5hbGlhcylcbiAgICAgICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmNvbm5lY3RlZCkgLSBOdW1iZXIoYS5jb25uZWN0ZWQpKVxuICAgICAgICAgICAgICAgICAgICAuc2xpY2UoMCwgNilcbiAgICAgICAgICAgICAgICAgICAgLm1hcCgoZGV2KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvbiA9IGRldi5jb25uZWN0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb24gPyBkZXYuZGlzY29ubmVjdF9kZXZpY2UoKSA6IGRldi5jb25uZWN0X2RldmljZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmx1ZXRvb3RoLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17ZGV2LmFsaWFzIHx8IGRldi5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwieHNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb24gPyBcIkNvbm5lY3RlZFwiIDogZGV2LnBhaXJlZCA/IFwiUGFpcmVkXCIgOiBcIkF2YWlsYWJsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIE9uZSBtaXhlciByb3cgKC5taXhyb3cpIFx1MjAxNCBob3Jpem9udGFsOiAyNlx1MDBENzI2IGljb24gdGlsZSBcdTAwQjcgNzJweCBuYW1lIFx1MDBCNyBzbGlkZXIgZmlsbHMuXG5mdW5jdGlvbiBNaXhSb3cocHJvcHM6IHsgaWNvbjogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyB0YXJnZXQ6IGFueSB9KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cIm1peHJvd1wiIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtaVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtwcm9wcy5pY29ufSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICBjbGFzcz1cIm1uYW1lXCJcbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgIGxhYmVsPXtwcm9wcy50aXRsZX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8c2xpZGVyXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJzbGlkZXJcIlxuICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgdmFsdWU9e2JpbmQocHJvcHMudGFyZ2V0LCBcInZvbHVtZVwiKX1cbiAgICAgICAgICAgICAgICBvbkNoYW5nZVZhbHVlPXsoX3MsIHYpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcHJvcHMudGFyZ2V0LnZvbHVtZSA9IHZcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgLz5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBQZXItYXBwIHZvbHVtZSBtaXhlciBcdTIwMTQgTWFzdGVyIChkZWZhdWx0IHNwZWFrZXIpICsgZWFjaCBhdWRpbyBzdHJlYW0gKEFzdGFsV3ApLlxuZnVuY3Rpb24gTWl4TGlzdCgpIHtcbiAgICBjb25zdCB3cCA9IFdwLmdldF9kZWZhdWx0KClcbiAgICBpZiAoIXdwKSByZXR1cm4gPGJveCAvPlxuICAgIGNvbnN0IHNwZWFrZXIgPSB3cC5kZWZhdWx0X3NwZWFrZXJcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgIHtzcGVha2VyICYmIChcbiAgICAgICAgICAgICAgICA8TWl4Um93IGljb249XCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIiB0aXRsZT1cIk91dHB1dFwiIHRhcmdldD17c3BlYWtlcn0gLz5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgICB7YmluZCh3cC5hdWRpbywgXCJzdHJlYW1zXCIpLmFzKChzdHJlYW1zKSA9PlxuICAgICAgICAgICAgICAgIHN0cmVhbXNcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDUpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKHMpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxNaXhSb3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlPXtzLmRlc2NyaXB0aW9uIHx8IHMubmFtZSB8fCBcIkFwcGxpY2F0aW9uXCJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0PXtzfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKSlcbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gRHJpbGxWaWV3KHsgbmFtZSB9OiB7IG5hbWU/OiBzdHJpbmcgfSkge1xuICAgIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggbmFtZT17bmFtZX0gb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICAgICAgICA8Y2VudGVyYm94IGNsYXNzPVwiZGhlYWRcIj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIG1hcmdpbkVuZD17MTV9IG9uQ2xpY2tlZD17KCkgPT4gZHJpbGwuc2V0KG51bGwpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1sZWZ0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoZHJpbGwpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgZCA9PT0gXCJ3aWZpXCIgPyBcIldpLUZpXCIgOiBkID09PSBcImJ0XCIgPyBcIkJsdWV0b290aFwiIDogXCJWb2x1bWVcIlxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJveCB3aWR0aFJlcXVlc3Q9ezQ2fSBoYWxpZ249e0d0ay5BbGlnbi5FTkR9PlxuICAgICAgICAgICAgICAgICAgICB7bmV0LndpZmkgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgPHN3aXRjaFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZT17YmluZChuZXQud2lmaSwgXCJlbmFibGVkXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJpbGwpLmFzKChkKSA9PiBkID09PSBcIndpZmlcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ob3RpZnlBY3RpdmU9eyhzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5ldC53aWZpIS5lbmFibGVkID0gcy5hY3RpdmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPHN3aXRjaFxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtiaW5kKEJsdWV0b290aC5nZXRfZGVmYXVsdCgpLCBcInBvd2VyZWRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcygoZCkgPT4gZCA9PT0gXCJidFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXsocykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEJsdWV0b290aC5nZXRfZGVmYXVsdCgpLmFkYXB0ZXIucG93ZXJlZCA9IHMuYWN0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9jZW50ZXJib3g+XG4gICAgICAgICAgICB7YmluZChkcmlsbCkuYXMoKGQpID0+XG4gICAgICAgICAgICAgICAgZCA9PT0gXCJ3aWZpXCIgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxXaWZpTGlzdCAvPlxuICAgICAgICAgICAgICAgICkgOiBkID09PSBcImJ0XCIgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxCdExpc3QgLz5cbiAgICAgICAgICAgICAgICApIDogZCA9PT0gXCJtaXhcIiA/IChcbiAgICAgICAgICAgICAgICAgICAgPE1peExpc3QgLz5cbiAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IC8+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBRdWlja1NldHRpbmdzKCkge1xuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgyMjAsIDE1MClcbiAgICByZWdpc3RlcihcInF1aWNrc2V0dGluZ3NcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cInF1aWNrc2V0dGluZ3NcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtcXNcIlxuICAgICAgICAgICAgY2xhc3M9XCJxcy13aW5kb3dcIlxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLk9OX0RFTUFORH1cbiAgICAgICAgICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5ICE9PSBHZGsuS0VZX0VzY2FwZSkgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICAgICAgaWYgKGRyaWxsLmdldCgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGRyaWxsLnNldChudWxsKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH0gLy8gRXNjIHN0ZXBzIGJhY2sgZmlyc3RcbiAgICAgICAgICAgICAgICBjbG9zZSgpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgIH19XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9ET1dOfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNoZWV0IHFzXCI+XG4gICAgICAgICAgICAgICAgICAgIHsvKiBHdGsuU3RhY2sgd2l0aCBzbGlkZS1sZWZ0L3JpZ2h0ID0gdGhlIG11bHRpdmlldzsgaGVpZ2h0IGFuaW1hdGVzXG4gICAgICAgICAgICB2aWEgQWR3IHNwcmluZyBvbiBhIHNpemUtZ3JvdXAgd3JhcHBlciAoTU9USU9OLmRyaWxsIC8gZHJpbGxCYWNrKSAqL31cbiAgICAgICAgICAgICAgICAgICAgPHN0YWNrXG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlN0YWNrVHJhbnNpdGlvblR5cGUuU0xJREVfTEVGVF9SSUdIVH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZUNoaWxkTmFtZT17YmluZChkcmlsbCkuYXMoKGQpID0+IChkID8gXCJkcmlsbFwiIDogXCJyb290XCIpKX1cbiAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgPFJvb3QgbmFtZT1cInJvb3RcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPERyaWxsVmlldyBuYW1lPVwiZHJpbGxcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L3N0YWNrPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFRpbnlTbGlkZXIgXHUyMDE0IEd0ay5TY2FsZSBzdWJjbGFzcyB0aGF0IHJlcG9ydHMgbmVhci16ZXJvIG5hdHVyYWwgd2lkdGggc28gaXRcbi8vIG5ldmVyIGZvcmNlcyBpdHMgcGFyZW50IGNvbnRhaW5lciB3aWRlciB0aGFuIHRoZSBjaGlwLWdyaWQncyBuYXR1cmFsIHdpZHRoLlxuLy8gV2UgZXh0ZW5kIEd0ay5TY2FsZSBkaXJlY3RseSAobm90IEFzdGFsLlNsaWRlcikgYmVjYXVzZSBBc3RhbC5TbGlkZXIncyBWYWxhXG4vLyBDIHZmdW5jcyBjYW4gaW50ZXJjZXB0IHRoZSBtZWFzdXJlIGNoYWluIGJlZm9yZSB0aGUgR0pTIG92ZXJyaWRlIGlzIHJlYWNoZWQuXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrXCJcblxuZXhwb3J0IGNvbnN0IFRpbnlTbGlkZXIgPSBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoXG4gICAge1xuICAgICAgICBHVHlwZU5hbWU6IFwiS29iZWxUaW55U2NhbGVcIixcbiAgICB9LFxuICAgIGNsYXNzIFRpbnlTbGlkZXIgZXh0ZW5kcyBHdGsuU2NhbGUge1xuICAgICAgICBjb25zdHJ1Y3RvcihwYXJhbXM/OiBQYXJ0aWFsPEd0ay5TY2FsZS5Db25zdHJ1Y3RvclByb3BzICYgeyB2YWx1ZT86IG51bWJlciB9Pikge1xuICAgICAgICAgICAgY29uc3QgeyB2YWx1ZSwgLi4ucmVzdCB9ID0gKHBhcmFtcyA/PyB7fSkgYXMgYW55XG4gICAgICAgICAgICBzdXBlcih7XG4gICAgICAgICAgICAgICAgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbi5IT1JJWk9OVEFMLFxuICAgICAgICAgICAgICAgIGFkanVzdG1lbnQ6IG5ldyBHdGsuQWRqdXN0bWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGxvd2VyOiAwLFxuICAgICAgICAgICAgICAgICAgICB1cHBlcjogMSxcbiAgICAgICAgICAgICAgICAgICAgc3RlcF9pbmNyZW1lbnQ6IDAuMDEsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VfaW5jcmVtZW50OiAwLjEsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2Vfc2l6ZTogMCxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlID8/IDAsXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgZHJhd192YWx1ZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgLi4ucmVzdCxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICB2ZnVuY19tZWFzdXJlKFxuICAgICAgICAgICAgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbixcbiAgICAgICAgICAgIGZvcl9zaXplOiBudW1iZXJcbiAgICAgICAgKTogW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICAgICAgICAgICAgaWYgKG9yaWVudGF0aW9uID09PSBHdGsuT3JpZW50YXRpb24uSE9SSVpPTlRBTCkge1xuICAgICAgICAgICAgICAgIC8vIFJlcG9ydCBuYXR1cmFsPTEgc28gdGhlIHNyb3cvc2xpZGVycyBjb250YWluZXIgZG9lc24ndCBpbmZsYXRlIHRoZSBRUyBwYW5lbFxuICAgICAgICAgICAgICAgIC8vIGJleW9uZCB0aGUgY2hpcC1ncmlkIG5hdHVyYWwgd2lkdGguIFRoZSBzbGlkZXIgc3RpbGwgaGV4cGFuZHMgdG8gZmlsbCB0aGVcbiAgICAgICAgICAgICAgICAvLyBhdmFpbGFibGUgc3BhY2UgYXQgYWxsb2NhdGlvbiB0aW1lIFx1MjAxNCBvbmx5IHRoZSBuYXR1cmFsIHNpemUgaXMgb3ZlcnJpZGRlbi5cbiAgICAgICAgICAgICAgICByZXR1cm4gWzAsIDEsIC0xLCAtMV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdXBlci52ZnVuY19tZWFzdXJlKG9yaWVudGF0aW9uLCBmb3Jfc2l6ZSlcbiAgICAgICAgfVxuICAgIH1cbilcbiIsICIvLyBOb3RpZmljYXRpb25zLiBQcm90b3R5cGUtZmluYWw6IGZsb2F0aW5nIGJsdXJyZWQgdG9hc3RzICh0b3AtcmlnaHQsIHRoZSBPTkVcbi8vIHNhbmN0aW9uZWQgdHJhbnNsdWNlbmN5KSArIHJpZ2h0IGRyYXdlciAobWVkaWEgY2FyZCBvbiB0b3AsIHBhbmVsLWxlc3MgY2FyZHNcbi8vIGZsb2F0aW5nIG9uIHdhbGxwYXBlciwgaGVhZGVyIGNoaXApLiBUaGUgdW5pZmllZCBwaXBlbGluZTogb3BlbiB0aGUgZHJhd2VyIHdoaWxlXG4vLyBhIHRvYXN0IGlzIGxpdmUgYW5kIGl0J3MgQURPUFRFRCBpbnRvIHRoZSBzdGFjazsgdG9hc3RzIGFycml2aW5nIHdoaWxlIG9wZW5cbi8vIGluc2VydCBhcyBjYXJkczsgU2lsZW50IHJvdXRlcyBzdHJhaWdodCB0byB0aGUgc3RvcmUuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgdGltZW91dCwgR0xpYiwgZXhlY0FzeW5jIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbi8vIExhenkgc2luZ2xldG9uIFx1MjAxNCBjYWxsaW5nIGdldF9kZWZhdWx0KCkgYXQgbW9kdWxlIHNjb3BlIGJsb2NrcyB0aGUgaW1wb3J0IHdoaWxlXG4vLyBBc3RhbE5vdGlmZCB0cmllcyB0byBhY3F1aXJlIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zIChoYW5ncyBpZiBnbm9tZS1zaGVsbFxuLy8gc3RpbGwgb3ducyBpdCkuIERlZmVycmluZyB0byBmaXJzdCB1c2UgbGV0cyB0aGUgbW9kdWxlIGltcG9ydCBjbGVhbmx5OyB0aGUgYnVzIGlzXG4vLyByZWxlYXNlZCBieSBgZ25vYmxpbmN0bCBkaXNhYmxlIG5vdGlmaWNhdGlvbnNgIGJlZm9yZSB0aGUgZGFlbW9uIGFjdHVhbGx5IGNsYWltcyBpdC5cbmxldCBfbm90aWZkOiBOb3RpZmQuTm90aWZkIHwgbnVsbCA9IG51bGxcbmNvbnN0IG5kID0gKCkgPT4gKF9ub3RpZmQgPz89IE5vdGlmZC5nZXRfZGVmYXVsdCgpKVxuY29uc3Qgc2tpcCA9ICgpID0+ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9TS0lQX05PVElGRFwiKVxuY29uc3QgVE9BU1RfTVMgPSAzODAwXG4vLyBSZWFjdGl2ZSBkcmF3ZXItb3BlbiBzdGF0ZSBzbyB0aGUgdG9hc3RzIGNhbiBiZSBBRE9QVEVEIChoaWRkZW4pIHRoZSBpbnN0YW50IHRoZVxuLy8gZHJhd2VyIG9wZW5zLCB3aXRob3V0IHBvbGxpbmcgYSBsb29rZWQtdXAgd2luZG93J3MgdmlzaWJpbGl0eS5cbmNvbnN0IGRyYXdlck9wZW4gPSBWYXJpYWJsZShmYWxzZSlcblxuLy8gTm90aWZpY2F0aW9uIGNhcmRzIFx1MjAxNCBmaXhlZCB3aWR0aCBzbyB0aGUgdG9hc3QvZHJhd2VyIGRvZXNuJ3Qgc3RyZXRjaCB0byBoZXhwYW5kIHRleHQuXG4vLyBOQ0FSRF9XID0gMzQxIFx1MjE5MiBuY2FyZCBvdXRlciA9IDM0MSArIDI0cHggQ1NTIHBhZGRpbmcgPSAzNjVweCA9IHByb3RvdHlwZSAtLXB3IGF0IDEyODBweC5cbmNvbnN0IE5DQVJEX1cgPSAzNDFcblxuaW50ZXJmYWNlIENhcmREYXRhIHtcbiAgICBpY29uOiBzdHJpbmdcbiAgICBzdW1tYXJ5OiBzdHJpbmdcbiAgICBib2R5OiBzdHJpbmdcbiAgICB3aGVuOiBzdHJpbmdcbiAgICBkaXNtaXNzOiAoKSA9PiB2b2lkXG59XG5cbmZ1bmN0aW9uIHRvQ2FyZERhdGEobjogTm90aWZkLk5vdGlmaWNhdGlvbik6IENhcmREYXRhIHtcbiAgICByZXR1cm4ge1xuICAgICAgICBpY29uOiBuLmFwcF9pY29uIHx8IFwiZGlhbG9nLWluZm9ybWF0aW9uLXN5bWJvbGljXCIsXG4gICAgICAgIHN1bW1hcnk6IG4uc3VtbWFyeSxcbiAgICAgICAgYm9keTogbi5ib2R5LFxuICAgICAgICB3aGVuOiBuZXcgRGF0ZShuLnRpbWUgKiAxMDAwKS50b0xvY2FsZVRpbWVTdHJpbmcoXCJlbi1HQlwiLCB7XG4gICAgICAgICAgICBob3VyOiBcIjItZGlnaXRcIixcbiAgICAgICAgICAgIG1pbnV0ZTogXCIyLWRpZ2l0XCIsXG4gICAgICAgIH0pLFxuICAgICAgICBkaXNtaXNzOiAoKSA9PiBuLmRpc21pc3MoKSxcbiAgICB9XG59XG5cbmZ1bmN0aW9uIENhcmQoeyBuIH06IHsgbjogQ2FyZERhdGEgfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJuY2FyZFwiIHNwYWNpbmc9ezEwfSB3aWR0aFJlcXVlc3Q9e05DQVJEX1d9PlxuICAgICAgICAgICAgey8qIGFwcCBpY29uIGluIGEgMzBcdTAwRDczMCByOSB0aWxlIChwcm90b3R5cGUgLm5pYykgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibmljXCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17bi5pY29ufSBwaXhlbFNpemU9ezIwfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBoZXhwYW5kIGVsbGlwc2l6ZT17M30gbGFiZWw9e24uc3VtbWFyeX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwid2hlbiB0blwiIGxhYmVsPXtuLndoZW59IC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYm9keVwiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezB9XG4gICAgICAgICAgICAgICAgICAgIHdyYXBcbiAgICAgICAgICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17NDB9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtuLmJvZHl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm54XCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IG9uQ2xpY2tlZD17bi5kaXNtaXNzfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jbG9zZS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gVG9hc3RzKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gICAgaWYgKHNraXAoKSkgcmV0dXJuIG51bGxcbiAgICAvLyBPbmx5IHJlbmRlciBub3RpZmljYXRpb25zIHlvdW5nZXIgdGhhbiBUT0FTVF9NUyB3aGlsZSB0aGUgZHJhd2VyIGlzIENMT1NFRCBcdTIwMTRcbiAgICAvLyBvcGVuaW5nIHRoZSBkcmF3ZXIgXCJhZG9wdHNcIiB0aGVtICh0aGV5IHNpbXBseSBjb250aW51ZSBsaWZlIGFzIGRyYXdlciBjYXJkcyxcbiAgICAvLyB3aGljaCBpcyB0aGUgRkxJUCBoYW5kb2ZmIGV4cHJlc3NlZCBpbiByZXRhaW5lZC1tb2RlIHRlcm1zKS5cbiAgICBjb25zdCBsaXZlID0gVmFyaWFibGU8bnVtYmVyW10+KFtdKVxuICAgIC8vIGBzaG93bmAgPSB3aGF0IHRoZSB0b2FzdCBjb2x1bW4gcmVuZGVycy4gUmVjb21wdXRlZCBleHBsaWNpdGx5IG9uIGV2ZXJ5IGlucHV0XG4gICAgLy8gY2hhbmdlIChWYXJpYWJsZS5kZXJpdmUgZGlkbid0IHByb2R1Y2UgYSByZWFjdGl2ZSBiaW5kaW5nIGhlcmUpLiBFbXB0eSB3aGlsZSB0aGVcbiAgICAvLyBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG8gdGhlIGRyYXdlciBzdGFjaykuXG4gICAgY29uc3Qgc2hvd24gPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gICAgY29uc3QgcmVjb21wdXRlID0gKCkgPT4gc2hvd24uc2V0KGRyYXdlck9wZW4uZ2V0KCkgPyBbXSA6IGxpdmUuZ2V0KCkpXG4gICAgbGl2ZS5zdWJzY3JpYmUocmVjb21wdXRlKVxuICAgIGRyYXdlck9wZW4uc3Vic2NyaWJlKHJlY29tcHV0ZSlcbiAgICBuZCgpLmNvbm5lY3QoXCJub3RpZmllZFwiLCAoX24sIGlkKSA9PiB7XG4gICAgICAgIGlmIChkcmF3ZXJPcGVuLmdldCgpIHx8IG5kKCkuZG9udF9kaXN0dXJiKSByZXR1cm5cbiAgICAgICAgbGl2ZS5zZXQoWy4uLmxpdmUuZ2V0KCksIGlkXSlcbiAgICAgICAgdGltZW91dChUT0FTVF9NUywgKCkgPT4gbGl2ZS5zZXQobGl2ZS5nZXQoKS5maWx0ZXIoKHgpID0+IHggIT09IGlkKSkpXG4gICAgfSlcbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwidG9hc3RzXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLXRvYXN0c1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgLy8gSGlkZSB0aGUgd2hvbGUgdG9hc3Qgc3VyZmFjZSB3aGlsZSB0aGUgZHJhd2VyIGlzIG9wZW4gKHRvYXN0cyBhcmUgQURPUFRFRCBpbnRvXG4gICAgICAgICAgICAvLyB0aGUgZHJhd2VyKSBcdTIwMTQgYSByZWFjdGl2ZSB3aW5kb3ctdmlzaWJpbGl0eSBiaW5kLCByb2J1c3QgcmVnYXJkbGVzcyBvZiB0aGVcbiAgICAgICAgICAgIC8vIHBlci1pdGVtIGxpc3QgcmVjb25jaWxpYXRpb24uXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyYXdlck9wZW4pLmFzKChvKSA9PiAhbyl9XG4gICAgICAgICAgICAvLyBUb2FzdHMgYXJlIGEgZmxvYXRpbmcgb3ZlcmxheSAobGlrZSB0aGUgcHJvdG90eXBlJ3MgYWJzb2x1dGUgdG9wL3JpZ2h0KTsgdGhlXG4gICAgICAgICAgICAvLyBmbG9hdCBpbnNldCBjbGVhcnMgdGhlIGZsb2F0aW5nIGJhciAobWFyZ2luVG9wIDEwICsgaGVpZ2h0IDQyKSArIGEgc21hbGwgZ2FwLFxuICAgICAgICAgICAgLy8gYW5kIHRoZSByaWdodCBpbnNldCBtYXRjaGVzIHRoZSBiYXIncyBlZGdlIG1hcmdpbi5cbiAgICAgICAgICAgIG1hcmdpblRvcD17NTh9XG4gICAgICAgICAgICBtYXJnaW5SaWdodD17MTJ9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFR9XG4gICAgICAgID5cbiAgICAgICAgICAgIHsvKiBmaXhlZCB0b2FzdCBjb2x1bW4gd2lkdGggc28gdGhlIGNhcmQgY2FuJ3Qgc3RyZXRjaCB0byBpdHMgaGV4cGFuZCB0ZXh0IGNvbHVtbiAqL31cbiAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgIHNwYWNpbmc9ezh9XG4gICAgICAgICAgICAgICAgd2lkdGhSZXF1ZXN0PXtOQ0FSRF9XICsgMjZ9XG4gICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIHtiaW5kKHNob3duKS5hcygoaWRzKSA9PlxuICAgICAgICAgICAgICAgICAgICBpZHMubWFwKChpZCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbiA9IG5kKCkuZ2V0X25vdGlmaWNhdGlvbihpZClcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBuID8gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJ0b2FzdFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Q2FyZCBuPXt0b0NhcmREYXRhKG4pfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG5cbmZ1bmN0aW9uIE1lZGlhQ2FyZCgpIHtcbiAgICBjb25zdCBtcHJpcyA9IE1wcmlzLmdldF9kZWZhdWx0KClcbiAgICBpZiAoIW1wcmlzICYmICFERU1PKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgcGljayA9IChwczogYW55W10pID0+XG4gICAgICAgIHBzLmZpbmQoKHApID0+IHAucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXSA/PyBudWxsXG5cbiAgICBjb25zdCBtZWRpYVRpdGxlID0gREVNT1xuICAgICAgICA/IEQubWVkaWEudGl0bGVcbiAgICAgICAgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4gcGljayhwcyk/LnRpdGxlID8/IFwiXCIpXG4gICAgY29uc3QgbWVkaWFBcnRpc3QgPSBERU1PXG4gICAgICAgID8gRC5tZWRpYS5hcnRpc3RcbiAgICAgICAgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4gcGljayhwcyk/LmFydGlzdCA/PyBcIlwiKVxuICAgIGNvbnN0IHBsYXlJY29uID0gREVNT1xuICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwaWNrKHBzKVxuICAgICAgICAgICAgICByZXR1cm4gcD8ucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgOiBcImtvYmVsLXBsYXktc3ltYm9saWNcIlxuICAgICAgICAgIH0pXG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBERU1PXG4gICAgICAgID8gMC40MlxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwaWNrKHBzKVxuICAgICAgICAgICAgICBpZiAoIXAgfHwgIXAubGVuZ3RoIHx8IHAubGVuZ3RoIDw9IDApIHJldHVybiAwXG4gICAgICAgICAgICAgIHJldHVybiBwLnBvc2l0aW9uIC8gcC5sZW5ndGhcbiAgICAgICAgICB9KVxuICAgIGNvbnN0IGN1clRpbWUgPSBERU1PXG4gICAgICAgID8gXCIyOjM3XCJcbiAgICAgICAgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwID0gcGljayhwcylcbiAgICAgICAgICAgICAgaWYgKCFwIHx8ICFwLnBvc2l0aW9uKSByZXR1cm4gXCIwOjAwXCJcbiAgICAgICAgICAgICAgY29uc3QgcyA9IE1hdGguZmxvb3IocC5wb3NpdGlvbilcbiAgICAgICAgICAgICAgcmV0dXJuIGAke01hdGguZmxvb3IocyAvIDYwKX06JHtTdHJpbmcocyAlIDYwKS5wYWRTdGFydCgyLCBcIjBcIil9YFxuICAgICAgICAgIH0pXG4gICAgY29uc3QgdG90YWxUaW1lID0gREVNT1xuICAgICAgICA/IFwiNjowN1wiXG4gICAgICAgIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcCA9IHBpY2socHMpXG4gICAgICAgICAgICAgIGlmICghcCB8fCAhcC5sZW5ndGggfHwgcC5sZW5ndGggPD0gMCkgcmV0dXJuIFwiMDowMFwiXG4gICAgICAgICAgICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHAubGVuZ3RoKVxuICAgICAgICAgICAgICByZXR1cm4gYCR7TWF0aC5mbG9vcihzIC8gNjApfToke1N0cmluZyhzICUgNjApLnBhZFN0YXJ0KDIsIFwiMFwiKX1gXG4gICAgICAgICAgfSlcbiAgICBjb25zdCBoYXNQbGF5ZXIgPSBERU1PID8gdHJ1ZSA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwcy5sZW5ndGggPiAwKVxuICAgIGNvbnN0IG5vUGxheWVyID0gREVNTyA/IGZhbHNlIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHBzLmxlbmd0aCA9PT0gMClcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJuY2FyZCBtZWRpYVwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgey8qIC5tcm93IFx1MjAxNCBhcnQgXHUwMEI3IHRpdGxlL2FydGlzdCBcdTAwQjcgcHJldi9wbGF5L25leHQgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibXJvd1wiIHNwYWNpbmc9ezExfSB2aXNpYmxlPXtoYXNQbGF5ZXJ9PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtYXJ0XCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MjJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm1tZXRhXCJcbiAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e21lZGlhVGl0bGV9IC8+XG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YlwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBlbGxpcHNpemU9ezN9IGxhYmVsPXttZWRpYUFydGlzdH0gLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibWJ0bnNcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezF9PlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibWJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHByZXZpb3VzXCIpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXNraXAtYmFjay1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibWJ0biBwbGF5XCIgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJwbGF5ZXJjdGwgcGxheS1wYXVzZVwiKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3BsYXlJY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm1idG5cIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBuZXh0XCIpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXNraXAtZndkLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIHsvKiAubWJhciBcdTIwMTQgY3VycmVudCB0aW1lIFx1MDBCNyB0cmFjayBzbGlkZXIgXHUwMEI3IHRvdGFsIHRpbWUgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibWJhclwiIHNwYWNpbmc9ezh9IHZpc2libGU9e2hhc1BsYXllcn0+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwibXRpbWUgdG5cIiBsYWJlbD17Y3VyVGltZX0gLz5cbiAgICAgICAgICAgICAgICA8bGV2ZWxiYXIgY2xhc3M9XCJtdHJhY2tcIiBoZXhwYW5kIHZhbHVlPXtwcm9ncmVzc30gLz5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJtdGltZSB0blwiIGxhYmVsPXt0b3RhbFRpbWV9IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIHsvKiBlbXB0eSBzdGF0ZSBcdTIwMTQgZGlzYyBpY29uICsgXCJOb3RoaW5nIHBsYXlpbmdcIiArIFwiT3BlbiBNdXNpY1wiICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1lbXB0eXJvd1wiIHNwYWNpbmc9ezExfSB2aXNpYmxlPXtub1BsYXllcn0+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1hcnRcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPVwia29iZWwtZGlzYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezIyfVxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgdmV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggaGV4cGFuZCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPVwiTm90aGluZyBwbGF5aW5nXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN1YlwiXG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiTWVkaWEgY29udHJvbHMgYXBwZWFyIHdoZW4gYSBwbGF5ZXIgc3RhcnRzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdyYXBcbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZ2hvc3RiXCJcbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInhkZy1vcGVuIGh0dHBzOi8vb3Blbi5zcG90aWZ5LmNvbVwiKX1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIk9wZW4gTXVzaWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIERyYXdlcigpIHtcbiAgICBpZiAoIURFTU8gJiYgc2tpcCgpKSByZXR1cm4gbnVsbFxuXG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDIwMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwiZHJhd2VyXCIsIHRvZ2dsZUZuKVxuICAgIC8vIEtlZXAgZHJhd2VyT3BlbiBpbiBzeW5jIHdpdGggdGhlIHJldmVhbGVkIHN0YXRlICh0b2FzdHMgYWRvcHQgaW50byBkcmF3ZXIgd2hlbiBvcGVuKVxuICAgIHJldmVhbGVkLnN1YnNjcmliZSgocikgPT4gZHJhd2VyT3Blbi5zZXQocikpXG5cbiAgICAvLyBERU1POiBzdGF0aWMgbm90aWZpY2F0aW9uIGxpc3QgcGlubmVkIHRvIHByb3RvdHlwZSdzIGluaXRpYWwgc3RhdGVcbiAgICBpZiAoREVNTykge1xuICAgICAgICBjb25zdCBkZW1vQ2FyZHM6IENhcmREYXRhW10gPSBELm5vdGlmaWNhdGlvbnMubWFwKChuKSA9PiAoe1xuICAgICAgICAgICAgLi4ubixcbiAgICAgICAgICAgIGRpc21pc3M6ICgpID0+IHt9LFxuICAgICAgICB9KSlcbiAgICAgICAgY29uc3QgZGVtb0NvdW50ID0gYCR7ZGVtb0NhcmRzLmxlbmd0aCB8fCBcIlwifWBcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgICAgICBuYW1lPVwiZHJhd2VyXCJcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1kcmF3ZXJcIlxuICAgICAgICAgICAgICAgIGNsYXNzPVwiZHJhd2VyLXdpbmRvd1wiXG4gICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgICAgICBhbmNob3I9e1xuICAgICAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLk9OX0RFTUFORH1cbiAgICAgICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChjbG9zZSgpLCB0cnVlKSA6IGZhbHNlKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0xFRlR9XG4gICAgICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjAwfVxuICAgICAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChyZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkcmF3ZXJcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxNZWRpYUNhcmQgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJOb3RpZmljYXRpb25zXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0biBzdWJcIiBsYWJlbD17ZGVtb0NvdW50fSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggaGV4cGFuZCAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJuY2xlYXJcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs1fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXRyYXNoLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIkNsZWFyXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7ZGVtb0NhcmRzLm1hcCgobikgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Q2FyZCBuPXtufSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgICAgICA8L3dpbmRvdz5cbiAgICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IG5mZCA9IG5kKClcbiAgICBjb25zdCBsaXN0ID0gVmFyaWFibGU8Tm90aWZkLk5vdGlmaWNhdGlvbltdPihuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKSA/PyBbXSlcbiAgICBjb25zdCByZWZyZXNoID0gKCkgPT4gbGlzdC5zZXQobmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gICAgbmZkLmNvbm5lY3QoXCJub3RpZmllZFwiLCByZWZyZXNoKVxuICAgIG5mZC5jb25uZWN0KFwicmVzb2x2ZWRcIiwgcmVmcmVzaClcblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkcmF3ZXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZHJhd2VyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZHJhd2VyLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4gKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9MRUZUfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjAwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImRyYXdlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8TWVkaWFDYXJkIC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIk5vdGlmaWNhdGlvbnNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gc3ViXCIgbGFiZWw9e2JpbmQobGlzdCkuYXMoKG4pID0+IGAke24ubGVuZ3RoIHx8IFwiXCJ9YCl9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGhleHBhbmQgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm5jbGVhclwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKS5mb3JFYWNoKChuKSA9PiBuLmRpc21pc3MoKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs1fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtdHJhc2gtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJDbGVhclwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtiaW5kKGxpc3QpLmFzKChucykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBucyAmJiBucy5sZW5ndGhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBucy5tYXAoKG4pID0+IDxDYXJkIG49e3RvQ2FyZERhdGEobil9IC8+KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJuZW1wdHlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5GSUxMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImtvYmVsLWNoZWNrLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gbGFiZWw9XCJBbGwgY2F1Z2h0IHVwXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIE9TRCBcdTIwMTQgZGlzcGxheS1vbmx5IHZvbHVtZSBwaWxsIGFib3ZlIHRoZSBkb2NrLiBQcm90b3R5cGU6IHBvaW50ZXItZXZlbnRzIG5vbmUsXG4vLyBhdXRvLWhpZGUgMS40cywgdHJhbnNsdWNlbnQgKGJsdXIgdmlhIGdub2JsaW4gd2luZG93LXJ1bGUpLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBPU0QobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICBjb25zdCB2aXNpYmxlID0gVmFyaWFibGUoZmFsc2UpXG4gICAgbGV0IGhpZGU6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcbiAgICBpZiAoIXNwZWFrZXIpIHJldHVybiBudWxsXG5cbiAgICBzcGVha2VyLmNvbm5lY3QoXCJub3RpZnk6OnZvbHVtZVwiLCAoKSA9PiB7XG4gICAgICAgIHZpc2libGUuc2V0KHRydWUpXG4gICAgICAgIGhpZGU/LmNhbmNlbCgpXG4gICAgICAgIGhpZGUgPSB0aW1lb3V0KDE0MDAsICgpID0+IHZpc2libGUuc2V0KGZhbHNlKSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cIm9zZFwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1vc2RcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIG1hcmdpbkJvdHRvbT17NzB9XG4gICAgICAgICAgICBjbGlja1Rocm91Z2hcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQodmlzaWJsZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJvc2RcIiBzcGFjaW5nPXsxMX0gd2lkdGhSZXF1ZXN0PXsyMzB9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17YmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhciBoZXhwYW5kIHZhbHVlPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN2YWwgdG5cIlxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezF9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpLmFzKCh2KSA9PiBgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBTZXNzaW9uIG92ZXJsYXkgXHUyMDE0IGRpbW1lZCAoMC44KSwgNCBidXR0b25zLCBhcnJvdy1uYXYsIFBSRVNTLUFHQUlOIGNvbmZpcm0gb25cbi8vIFJlc3RhcnQvU2h1dCBkb3duIChhdXRvLXJldmVydCA0cyksIHJlc3Rpbmcgcm9zZSBvbiBTaHV0IGRvd24uXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgZXhlY0FzeW5jLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxudm9pZCBERU1PXG52b2lkIERcblxuY29uc3QgQUNUSU9OUyA9IFtcbiAgICB7XG4gICAgICAgIGlkOiBcImxvY2tcIixcbiAgICAgICAgbGFiZWw6IFwiTG9ja1wiLFxuICAgICAgICBpY29uOiBcImtvYmVsLWxvY2stc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogZmFsc2UsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBpZDogXCJsb2dvdXRcIixcbiAgICAgICAgbGFiZWw6IFwiTG9nIG91dFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLWxvZ291dC1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiBmYWxzZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJnbm9tZS1zZXNzaW9uLXF1aXQgLS1sb2dvdXQgLS1uby1wcm9tcHRcIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIGlkOiBcInJlc3RhcnRcIixcbiAgICAgICAgbGFiZWw6IFwiUmVzdGFydFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXJlbG9hZC1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiB0cnVlLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCByZWJvb3RcIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIGlkOiBcInNodXRkb3duXCIsXG4gICAgICAgIGxhYmVsOiBcIlNodXQgZG93blwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXBvd2VyLXN5bWJvbGljXCIsXG4gICAgICAgIGNvbmZpcm06IHRydWUsXG4gICAgICAgIHJlZDogdHJ1ZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgcG93ZXJvZmZcIiksXG4gICAgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gU2Vzc2lvbigpIHtcbiAgICBjb25zdCBhcm1lZCA9IFZhcmlhYmxlPHN0cmluZyB8IG51bGw+KG51bGwpXG4gICAgbGV0IHJldmVydDogUmV0dXJuVHlwZTx0eXBlb2YgdGltZW91dD4gfCBudWxsID0gbnVsbFxuXG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDE4MCwgMTMwKVxuICAgIHJlZ2lzdGVyKFwic2Vzc2lvblwiLCB0b2dnbGVGbilcblxuICAgIGNvbnN0IHByZXNzID0gKGE6ICh0eXBlb2YgQUNUSU9OUylbbnVtYmVyXSkgPT4ge1xuICAgICAgICBpZiAoYS5jb25maXJtICYmIGFybWVkLmdldCgpICE9PSBhLmlkKSB7XG4gICAgICAgICAgICBhcm1lZC5zZXQoYS5pZClcbiAgICAgICAgICAgIHJldmVydD8uY2FuY2VsKClcbiAgICAgICAgICAgIHJldmVydCA9IHRpbWVvdXQoNDAwMCwgKCkgPT4gYXJtZWQuc2V0KG51bGwpKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgYXJtZWQuc2V0KG51bGwpXG4gICAgICAgIGNsb3NlKClcbiAgICAgICAgYS5ydW4oKVxuICAgIH1cblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJzZXNzaW9uXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLXNlc3Npb25cIlxuICAgICAgICAgICAgY2xhc3M9XCJzZXNzaW9uLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHxcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NIHxcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuTEVGVCB8XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5JR05PUkV9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgICAgICAgICAgICAgYXJtZWQuc2V0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgIGNsb3NlKClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuQ1JPU1NGQURFfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MTgwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgey8qIC5zZXNzaW9uIGZpbGxzIHRoZSB3aG9sZSB3aW5kb3cgKHRoZSBkaW0pOyBidXR0b25zIGNlbnRlcmVkIGluc2lkZSAqL31cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2Vzc2lvblwiIGhleHBhbmQgdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgPGJveCBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17MjB9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICB7QUNUSU9OUy5tYXAoKGEpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPXthLnJlZCA/IFwic2J0biByZWRcIiA6IFwic2J0blwifSBvbkNsaWNrZWQ9eygpID0+IHByZXNzKGEpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezEwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e2JpbmQoYXJtZWQpLmFzKCh4KSA9PiAoeCA9PT0gYS5pZCA/IFwiY29uZmlybVwiIDogXCJcIikpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzaWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmQ9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZleHBhbmQ9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIGhvcml6b250YWwgR3RrQm94IGlnbm9yZXMgYSBjaGlsZCdzIG1haW4tYXhpcyBoYWxpZ24sIHNvIHRoZSBpY29uXG4gICAgICAgICAgICAgICAgICAgIGxlZnQtcGFja3M7IGhleHBhbmQgbWFrZXMgdGhlIGltYWdlIGZpbGwgdGhlIDU5cHggdGlsZSBcdTIxOTIgR3RrSW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgY2VudHJlcyB0aGUgZ2x5cGguIGhleHBhbmQ9e2ZhbHNlfSBvbiAuc2ljIGJsb2NrcyBwcm9wYWdhdGlvbiBzbyB0aGVcbiAgICAgICAgICAgICAgICAgICAgdGlsZSBzdGF5cyA1OSB3aWRlIGluc3RlYWQgb2Ygc3RyZXRjaGluZyB0aGUgcm93LiAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2EuaWNvbn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXsyMn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZChhcm1lZCkuYXMoKHgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHggPT09IGEuaWQgPyBcIlByZXNzIGFnYWluXCIgOiBhLmxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU9BLFlBQVc7QUFDbEIsT0FBT0MsVUFBUztBQUNoQixPQUFPQyxVQUFTOzs7QUNGaEIsT0FBT0MsWUFBVzs7O0FDQVgsSUFBTSxXQUFXLENBQUMsUUFBZ0IsSUFDcEMsUUFBUSxtQkFBbUIsT0FBTyxFQUNsQyxXQUFXLEtBQUssR0FBRyxFQUNuQixZQUFZO0FBRVYsSUFBTSxXQUFXLENBQUMsUUFBZ0IsSUFDcEMsUUFBUSxtQkFBbUIsT0FBTyxFQUNsQyxXQUFXLEtBQUssR0FBRyxFQUNuQixZQUFZO0FBY1YsSUFBTSxVQUFOLE1BQU0sU0FBZTtBQUFBLEVBQ2hCLGNBQWMsQ0FBQyxNQUFXO0FBQUEsRUFFbEM7QUFBQSxFQUNBO0FBQUEsRUFTQSxPQUFPLEtBQUssU0FBcUMsTUFBZTtBQUM1RCxXQUFPLElBQUksU0FBUSxTQUFTLElBQUk7QUFBQSxFQUNwQztBQUFBLEVBRVEsWUFBWSxTQUE0QyxNQUFlO0FBQzNFLFNBQUssV0FBVztBQUNoQixTQUFLLFFBQVEsUUFBUSxTQUFTLElBQUk7QUFBQSxFQUN0QztBQUFBLEVBRUEsV0FBVztBQUNQLFdBQU8s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UztBQUFBLEVBQ2pCO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFsiQXN0YWwiLCAiR3RrIiwgIkdkayIsICJBc3RhbCIsICJiaW5kIiwgImludGVydmFsIiwgInRpbWVvdXQiLCAiQXN0YWwiLCAiQXN0YWwiLCAiaW5pdCIsICJBc3RhbCIsICJ2IiwgImludGVydmFsIiwgImtleSIsICJjdG9ycyIsICJrZXkiLCAiR3RrIiwgIkFzdGFsIiwgInNuYWtlaWZ5IiwgInBhdGNoIiwgIkFwcHMiLCAiQmx1ZXRvb3RoIiwgIk1wcmlzIiwgIk5vdGlmZCIsICJXcCIsICJBcHAiLCAiR3RrIiwgIkFzdGFsIiwgIkFzdGFsIiwgIkd0ayIsICJHdGsiLCAiQXN0YWwiLCAiY2giLCAiR3RrIiwgIkdkayIsICJHaW8iLCAiR0xpYiIsICJkZWZhdWx0IiwgIkFzdGFsIiwgIkdPYmplY3QiLCAiZGVmYXVsdCIsICJHT2JqZWN0IiwgIkdpbyIsICJHTGliIiwgIkdpbyIsICJHTGliIiwgImluaXQiLCAiR0xpYiIsICJHTGliIiwgInR5cGUiLCAiR0xpYiIsICJqc3giLCAiZGVmYXVsdCIsICJqc3giLCAid2lmaUljb24iLCAiR3RrIiwgIm4iLCAiQXN0YWwiLCAiR2lvIiwgImpzeCIsICJHdGsiLCAibiIsICJHZGsiLCAiR2lvIiwgIkFzdGFsIiwgIkFwcHMiLCAiTXByaXMiLCAiR0xpYiIsICJqc3giLCAiR3RrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiUElOTkVEIiwgIkFwcHMiLCAiZGVmYXVsdCIsICJuIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJNcHJpcyIsICJOZXR3b3JrIiwgIldwIiwgIkdpbyIsICJCYXR0ZXJ5IiwgIkdPYmplY3QiLCAiR3RrIiwgIlRpbnlTbGlkZXIiLCAiZGVmYXVsdCIsICJTVE9SRSIsICJqc3giLCAiR3RrIiwgIldwIiwgIkdpbyIsICJCYXR0ZXJ5IiwgIk5ldHdvcmsiLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJOb3RpZmQiLCAiTXByaXMiLCAiTm90aWZkIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiR3RrIiwgIkFzdGFsIiwgIk1wcmlzIiwgImtleSIsICJHZGsiLCAiV3AiLCAiV3AiLCAianN4IiwgIkFzdGFsIiwgIkFDVElPTlMiLCAianN4IiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiR3RrIiwgIkd0ayIsICJpbml0IiwgIkdkayJdCn0K
