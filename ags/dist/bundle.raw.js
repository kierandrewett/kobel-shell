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
var main_default = '@charset "UTF-8";\nwindow {\n  font-family: "Inter", "Inter Variable", "InterVariable", sans-serif;\n  font-size: 13px;\n  color: #f3eef3;\n}\n\n.tn {\n  font-feature-settings: "tnum";\n}\n\nwindow {\n  background: transparent;\n}\n\nbutton {\n  background: none;\n  background-color: transparent;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 0;\n  transition: background-color 160ms, color 160ms;\n}\n\nimage {\n  -gtk-icon-style: regular;\n}\n\n.bar {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 0 7px;\n  min-height: 42px;\n  color: #b5adbc;\n}\n.bar .title {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n  margin: 0 9px;\n}\n.bar .clock {\n  color: #f3eef3;\n  font-size: 13.5px;\n  font-weight: 600;\n}\n.bar .date {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.bar .ibtn {\n  padding: 0;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.bar .ibtn image {\n  -gtk-icon-size: 16px;\n}\n.bar .ibtn:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.bar .bcenter {\n  min-height: 0;\n  padding: 6px 12px;\n  border-radius: 9px;\n}\n.bar .bcenter:hover {\n  background-color: #1d1a22;\n}\n.bar .status {\n  min-height: 30px;\n  padding: 0 13px;\n  border-radius: 999px;\n  background-color: #1d1a22;\n}\n.bar .status:hover {\n  background-color: #26232c;\n}\n.bar .status image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.bar .status .pct image {\n  -gtk-icon-size: 15px;\n}\n.bar .status label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 11.5px;\n}\n.bar .status.err .net-icon {\n  color: #edbb64;\n}\n.bar .badge {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 99px;\n  font-size: 9px;\n  font-weight: 700;\n  padding: 0 3px;\n  margin: 2px;\n  min-height: 14px;\n  min-width: 14px;\n}\n.bar .tray-icon {\n  min-width: 28px;\n}\n.bar .tray-icon image {\n  -gtk-icon-size: 14px;\n  color: #b5adbc;\n}\n.bar .tray-lang {\n  font-size: 11px;\n  font-weight: 650;\n  color: #b5adbc;\n  padding: 0 8px;\n  min-width: 0;\n}\n\n.dock {\n  background-color: #100e14;\n  padding: 5px;\n  border-radius: 16px;\n}\n.dock .dbtn {\n  border-radius: 12px;\n}\n.dock .icon-tile {\n  min-width: 30px;\n  min-height: 30px;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.dock .dbtn:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.dock .placeholder .icon-tile {\n  background-color: #1d1a22;\n  color: #8d8693;\n}\n.dock .dots {\n  margin-bottom: 3px;\n}\n.dock .dot {\n  background-color: #8d8693;\n  border-radius: 99px;\n  min-width: 4px;\n  min-height: 4px;\n  transition: min-width 260ms cubic-bezier(0.24, 1.36, 0.35, 1), background-color 220ms;\n}\n.dock .dot.on {\n  background-color: #b5cb48;\n  min-width: 12px;\n}\n.dock .dot.mini {\n  min-width: 3px;\n  min-height: 3px;\n  opacity: 0.7;\n}\n.dock .sep {\n  background-color: #26232c;\n  min-width: 1px;\n  min-height: 34px;\n  margin: 0 3px;\n}\n.dock .dtile {\n  min-width: 42px;\n  min-height: 42px;\n}\n.dock .dwidget .dg {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 9px;\n  padding: 6px;\n}\n.dock levelbar.mprog {\n  min-width: 25px;\n  min-height: 3px;\n  margin-bottom: 6px;\n}\n.dock levelbar.mprog > trough {\n  background-color: rgba(0, 0, 0, 0.35);\n  border-radius: 99px;\n  min-height: 3px;\n}\n.dock levelbar.mprog > trough > block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.dock levelbar.mprog > trough > block.empty {\n  background-color: transparent;\n}\n\n.sheet {\n  background-color: #100e14;\n  border-radius: 24px;\n  padding: 12px;\n  margin: 38px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n}\n\n.qs {\n  min-width: 328px;\n} /* matches panelW(352)\u221224; overridden by config.ts tokenCss at runtime */\n.qs-top {\n  margin-bottom: 12px;\n  padding: 0 2px;\n}\n.qs-top .meta {\n  color: #b5adbc;\n  font-size: 11.5px;\n  font-weight: 600;\n}\n.qs-top .meta image {\n  -gtk-icon-size: 15px;\n  color: #b5adbc;\n  padding: 0;\n  margin: 0;\n}\n.qs-top .rbtn {\n  padding: 9px;\n  border-radius: 99px;\n  background-color: #26232c;\n  color: #b5adbc;\n  margin-left: 7px;\n}\n.qs-top .rbtn image {\n  -gtk-icon-size: 14px;\n}\n.qs-top .rbtn:hover {\n  background-color: #322e39;\n  color: #f3eef3;\n}\n.qs-top .rbtn.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.qs-top .rbtn.leaf image {\n  color: #b5cb48;\n}\n\n.chip {\n  background-color: #1d1a22;\n  border-radius: 999px;\n  min-height: 54px;\n  transition: background-color 220ms;\n}\n.chip .chipb {\n  padding: 9px 8px 9px 12px;\n  border-radius: 999px;\n}\n.chip image {\n  color: #b5adbc;\n  -gtk-icon-size: 17px;\n}\n.chip label {\n  font-size: 12.5px;\n  font-weight: 650;\n  color: #f3eef3;\n}\n.chip .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n  margin-top: 0;\n}\n.chip:hover {\n  background-color: #26232c;\n}\n.chip.on {\n  background-color: #b5cb48;\n}\n.chip.on image {\n  color: #192003;\n}\n.chip.on label {\n  color: #192003;\n}\n.chip.on .sub {\n  color: #333d17;\n}\n.chip.on:hover {\n  background-color: #96ae30;\n}\n.chip.on .chev {\n  color: #192003;\n}\n.chip .chev {\n  min-width: 30px;\n  min-height: 30px;\n  border-radius: 0 999px 999px 0;\n  color: #8d8693;\n  border-left: 1px solid rgba(0, 0, 0, 0.18);\n}\n.chip .chev image {\n  -gtk-icon-size: 15px;\n  color: inherit;\n}\n.chip .chev:hover {\n  background-color: rgba(0, 0, 0, 0.14);\n}\n\n.chips {\n  margin-bottom: 0;\n}\n\n.chips > box:last-child {\n  margin-right: 1px;\n}\n\n.chip-grid {\n  margin-bottom: 10px;\n}\n\nscale, scale:horizontal, scale:vertical {\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 6px 0;\n}\n\nscale > trough, scale:horizontal > trough, scale:vertical > trough {\n  min-height: 6px;\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border-radius: 999px;\n  background-color: #26232c;\n}\n\nscale > trough > highlight,\nscale > trough > progress {\n  min-height: 6px;\n  border-radius: 999px;\n  background-color: #b5cb48;\n}\n\nscale > trough > slider {\n  min-width: 17px;\n  min-height: 17px;\n  margin: -6px; /* prototype knob 17\xD717 */\n  border-radius: 999px;\n  background-color: #f3eef3;\n  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);\n}\n\n.srow {\n  padding: 0 2px 0 2px;\n  min-height: 42px;\n}\n.srow .sval {\n  font-size: 11px;\n  font-weight: 600;\n  color: #b5adbc;\n  min-width: 32px;\n}\n\n.srow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n  padding: 0;\n  margin: 0 -12px 0 12px;\n}\n\n.srow .chev {\n  padding: 6px 8px;\n  color: #8d8693;\n  border-radius: 9px;\n}\n.srow .chev image {\n  -gtk-icon-size: 15px;\n  padding: 0;\n  margin: 0;\n}\n.srow .chev:hover {\n  background-color: #1d1a22;\n}\n\n.gbanner {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n  margin-bottom: 8px;\n}\n.gbanner .t {\n  color: #edbb64;\n  font-weight: 650;\n  font-size: 11.5px;\n}\n.gbanner .s {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.gbanner image {\n  color: #edbb64;\n  -gtk-icon-size: 16px;\n}\n\n.gbtn {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 10px;\n  font-weight: 650;\n  font-size: 11.5px;\n  padding: 7px 12px;\n}\n.gbtn:hover {\n  background-color: #96ae30;\n}\n\n.dhead {\n  padding-bottom: 10px;\n}\n.dhead button {\n  padding: 7px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.dhead button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.dhead label {\n  font-weight: 650;\n  font-size: 14px;\n}\n\nswitch {\n  background-color: #26232c;\n  border-radius: 999px;\n  min-width: 46px;\n  min-height: 26px;\n}\nswitch:checked {\n  background-color: #b5cb48;\n}\nswitch slider {\n  background-color: #f3eef3;\n  border-radius: 999px;\n  min-width: 20px;\n  min-height: 20px;\n}\n\n.xrow {\n  background-color: transparent;\n  border-radius: 9px;\n  padding: 9px 11px;\n}\n.xrow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.xrow label {\n  font-size: 12.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.xrow .xs {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.xrow:hover {\n  background-color: #1d1a22;\n}\n.xrow.active {\n  background-color: rgba(106, 197, 143, 0.08);\n}\n.xrow.active image {\n  color: #b5cb48;\n}\n.xrow.active .xs {\n  color: #b5cb48;\n}\n\n.mixrow {\n  padding: 4px 2px;\n  min-height: 40px;\n}\n.mixrow .mi {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 6px;\n}\n.mixrow .mi image {\n  color: #b5adbc;\n  -gtk-icon-size: 14px;\n}\n.mixrow .mname {\n  font-size: 12px;\n  color: #b5adbc;\n  min-width: 72px;\n}\n\n.sheet.launcher {\n  min-width: 568px;\n}\n\n.launcher {\n  padding: 8px;\n}\n\n.field {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 3px 12px;\n  margin-bottom: 6px;\n}\n.field image {\n  color: #8d8693;\n  -gtk-icon-size: 16px;\n}\n.field entry {\n  background: none;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  color: #f3eef3;\n  font-size: 14.5px;\n  caret-color: #b5cb48;\n  padding: 8px 0;\n  min-height: 0;\n  min-width: 0;\n}\n.field entry text {\n  min-height: 0;\n}\n.field .lplaceholder {\n  color: #b5adbc;\n  font-size: 14.5px;\n}\n.field .ghost {\n  color: #8d8693;\n  font-size: 14.5px;\n}\n.field .kbd {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 5px;\n  font-size: 10.5px;\n  padding: 3px 7px;\n}\n\n.tiles {\n  padding: 8px 2px 10px;\n}\n\n.tile {\n  padding: 5px 0;\n  border-radius: 10px;\n  min-width: 64px;\n  max-width: 64px;\n}\n.tile .icon-tile {\n  min-width: 0;\n  min-height: 0;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.tile label {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.tile:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.tile:hover label {\n  color: #f3eef3;\n}\n\n.lfoot {\n  padding: 7px 10px 3px;\n  color: #8d8693;\n  font-size: 11px;\n}\n.lfoot b {\n  color: #b5adbc;\n  font-weight: 650;\n}\n\n.lwidgets {\n  padding: 0 2px 6px;\n}\n\n.widget {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n}\n.widget label {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.widget .hint {\n  color: #b5adbc;\n  font-size: 11px;\n  font-weight: 400;\n}\n\n.lwm .lwart {\n  background-color: #26232c;\n  border-radius: 9px;\n  min-width: 34px;\n  min-height: 34px;\n}\n.lwm .lwart image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.lwm .mbtn {\n  color: #f3eef3;\n  border-radius: 8px;\n  min-width: 29px;\n  min-height: 29px;\n}\n.lwm .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.lwm .mbtn:hover {\n  background-color: #26232c;\n}\n\n.lrows {\n  padding: 4px 2px;\n}\n\n.sec {\n  color: #8d8693;\n  font-size: 10px;\n  font-weight: 650;\n  padding: 8px 10px 2px;\n}\n\n.row {\n  border-radius: 10px;\n  padding: 7px 10px;\n}\n.row .ri {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 2px;\n}\n.row image {\n  -gtk-icon-size: 24px;\n}\n.row label {\n  font-size: 13px;\n  font-weight: 600;\n}\n.row .hint {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.row .runk {\n  background-color: #322e39;\n  color: #b5adbc;\n  border-radius: 6px;\n  font-size: 10.5px;\n  padding: 2px 7px;\n}\n.row:hover {\n  background-color: #1d1a22;\n}\n.row.sel {\n  background-color: #26232c;\n}\n\n.cal {\n  min-width: 309px;\n}\n.cal .sub {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.cal .hero {\n  color: #f3eef3;\n  font-size: 19px;\n  font-weight: 650;\n}\n.cal .calhero {\n  padding: 4px 8px 8px;\n}\n.cal .cal-grid {\n  margin-top: 8px;\n}\n.cal .month {\n  border-radius: 8px;\n  padding: 5px;\n  font-weight: 650;\n  font-size: 13px;\n}\n.cal .month:hover {\n  background-color: #1d1a22;\n}\n.cal centerbox > button {\n  padding: 6px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.cal centerbox > button image {\n  -gtk-icon-size: 14px;\n}\n.cal centerbox > button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.cal .dow {\n  color: #8d8693;\n  font-size: 9.5px;\n  font-weight: 600;\n  padding: 3px 0 5px;\n}\n.cal .wk {\n  color: #8d8693;\n  font-size: 9px;\n  font-weight: 600;\n}\n.cal .day {\n  background: none;\n  background-color: transparent;\n  color: #f3eef3;\n  font-size: 11px;\n  font-weight: 600;\n  min-width: 24px;\n  min-height: 24px;\n  border-radius: 99px;\n}\n.cal .day:hover {\n  background-color: #1d1a22;\n}\n.cal .day.we {\n  color: #8d8693;\n}\n.cal .day.out {\n  color: #8d8693;\n}\n.cal .day.today {\n  background-color: #b5cb48;\n  color: #192003;\n  font-weight: 700;\n}\n.cal .day.today:hover {\n  background-color: #b5cb48;\n}\n.cal .day.sel:not(.today) {\n  box-shadow: inset 0 0 0 1.5px #b5adbc;\n}\n.cal .day.today.sel {\n  box-shadow: inset 0 0 0 1.5px #192003;\n}\n.cal .day .evdot {\n  min-width: 3px;\n  min-height: 3px;\n  border-radius: 99px;\n  background-color: #b5cb48;\n  margin-bottom: 2px;\n}\n.cal .day.today .evdot {\n  background-color: #192003;\n}\n.cal .evcard {\n  margin-top: 10px;\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px;\n}\n.cal .evhead {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n  padding: 1px 3px 8px;\n}\n.cal .evempty {\n  font-size: 11.5px;\n  color: #b5adbc;\n  padding: 2px 3px 3px;\n}\n.cal .evempty image {\n  color: #8d8693;\n  -gtk-icon-size: 14px;\n}\n.cal .evrow {\n  background-color: #100e14;\n  border-radius: 10px;\n  padding: 8px 10px;\n  margin-bottom: 4px;\n}\n.cal .evrow:last-child {\n  margin-bottom: 0;\n}\n.cal .evrow .evic {\n  background-color: #628933;\n  border-radius: 8px;\n  padding: 6px;\n}\n.cal .evrow .evic image {\n  color: #fff;\n  -gtk-icon-size: 14px;\n}\n.cal .evrow label {\n  font-size: 12px;\n  font-weight: 650;\n}\n.cal .evrow .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n\n.drawer {\n  background: transparent;\n}\n\n.toast {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 20px;\n  padding: 11px 13px;\n  box-shadow: 0 18px 40px rgba(5, 3, 10, 0.45);\n}\n.toast .ncard {\n  background: transparent;\n  box-shadow: none;\n  border-radius: 0;\n  padding: 0;\n}\n\n.ncard {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 11px 12px;\n}\n.ncard .nic {\n  background-color: #26232c;\n  min-width: 30px;\n  min-height: 30px;\n  border-radius: 9px;\n}\n.ncard .nic image {\n  color: #b5adbc;\n  -gtk-icon-size: 15px;\n}\n.ncard {\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.ncard label {\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.ncard .body {\n  color: #b5adbc;\n  font-size: 11.8px;\n  font-weight: 400;\n}\n.ncard .when {\n  color: #8d8693;\n  font-size: 10px;\n}\n.ncard .nx {\n  min-width: 22px;\n  min-height: 22px;\n  border-radius: 99px;\n  color: #8d8693;\n}\n.ncard .nx image {\n  -gtk-icon-size: 11px;\n}\n.ncard .nx:hover {\n  background-color: #26232c;\n  color: #ef86a0;\n}\n.ncard.media {\n  padding: 10px 11px 9px;\n  margin-bottom: 2px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n}\n.ncard .mart {\n  background-color: #26232c;\n  border-radius: 10px;\n  min-width: 46px;\n  min-height: 46px;\n}\n.ncard .mart image {\n  color: #b5adbc;\n  -gtk-icon-size: 22px;\n}\n.ncard .mmeta label {\n  font-size: 13px;\n}\n.ncard .mbtn {\n  min-width: 29px;\n  min-height: 29px;\n  border-radius: 8px;\n  color: #b5adbc;\n}\n.ncard .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.ncard .mbtn:hover {\n  background-color: #26232c;\n  color: #f3eef3;\n}\n.ncard .mbar {\n  margin-top: 7px;\n}\n.ncard .mtime {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.ncard levelbar.mtrack {\n  min-height: 4px;\n  border-radius: 99px;\n}\n.ncard levelbar.mtrack > trough {\n  min-height: 4px;\n  border-radius: 99px;\n  background-color: #26232c;\n}\n.ncard levelbar.mtrack > trough > block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.ncard levelbar.mtrack > trough > block.empty {\n  background-color: transparent;\n}\n.ncard .memptyrow label {\n  color: #b5adbc;\n  font-size: 12px;\n  font-weight: 400;\n}\n.ncard .memptyrow .mart image {\n  color: #8d8693;\n}\n.ncard .ghostb {\n  background-color: #26232c;\n  color: #f3eef3;\n  font-size: 11.5px;\n  font-weight: 600;\n  padding: 7px 12px;\n  border-radius: 10px;\n}\n.ncard .ghostb label {\n  font-size: 11.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.ncard .ghostb:hover {\n  background-color: #322e39;\n}\n\n.nhead {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 8px 8px 8px 14px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n  margin-bottom: 8px;\n}\n.nhead label {\n  font-size: 13.5px;\n  font-weight: 650;\n}\n.nhead .sub {\n  font-size: 11px;\n  font-weight: 400;\n  color: #8d8693;\n}\n.nhead .nclear {\n  color: #ef86a0;\n  font-size: 11.5px;\n  font-weight: 600;\n  border-radius: 7px;\n  padding: 4px 9px;\n}\n.nhead .nclear image {\n  -gtk-icon-size: 12px;\n  color: #ef86a0;\n}\n.nhead .nclear label {\n  color: #ef86a0;\n}\n.nhead .nclear:hover {\n  background-color: #1d1a22;\n}\n\n.nempty {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 20px 0 16px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.nempty image {\n  color: #b5adbc;\n  -gtk-icon-size: 22px;\n  margin-bottom: 4px;\n}\n.nempty label {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n}\n\n.osd {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 999px;\n  padding: 10px 15px;\n}\n.osd image {\n  color: #f3eef3;\n  -gtk-icon-size: 15px;\n}\n.osd levelbar > trough {\n  min-height: 8px;\n  border-radius: 99px;\n  background-color: #26232c;\n}\n.osd levelbar > trough > block {\n  min-height: 8px;\n  border-radius: 99px;\n}\n.osd levelbar > trough > block.filled {\n  background-color: #b5cb48;\n}\n.osd levelbar > trough > block.empty {\n  background-color: transparent;\n}\n.osd .sval {\n  min-width: 34px;\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.session {\n  background-color: rgba(9, 3, 14, 0.8);\n}\n.session .sbtn {\n  padding: 6px;\n  border-radius: 12px;\n}\n.session .sic {\n  background-color: #100e14;\n  border-radius: 24px;\n  min-width: 62px;\n  min-height: 62px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n  color: #f3eef3;\n  transition: background-color 200ms, color 200ms;\n}\n.session .red .sic {\n  color: #ef86a0;\n}\n.session .sbtn:hover .sic {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.session .red:hover .sic {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.session label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 12px;\n}\n.session .confirm label {\n  color: #ef86a0;\n  font-weight: 650;\n}\n\npopover.cmenu {\n  background-color: #100e14;\n  border-radius: 12px;\n  padding: 5px;\n  min-width: 180px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n  border: none;\n}\npopover.cmenu > arrow, popover.cmenu > contents {\n  background: transparent;\n  border: none;\n  border-radius: 12px;\n}\n\n.cmi {\n  border-radius: 8px;\n  padding: 8px 10px;\n  font-size: 12px;\n  font-weight: 600;\n}\n.cmi image {\n  -gtk-icon-size: 14px;\n  color: #b5adbc;\n}\n.cmi label {\n  color: #f3eef3;\n  font-size: 12px;\n  font-weight: 600;\n}\n.cmi:hover {\n  background-color: #1d1a22;\n}\n.cmi.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.cmi.danger:hover image {\n  color: #4b0f1f;\n}\n.cmi.danger:hover label {\n  color: #4b0f1f;\n}\n\n.csep {\n  background-color: #1d1a22;\n  min-height: 1px;\n  margin: 4px 8px;\n}\n\n.dtip {\n  background-color: #100e14;\n  color: #f3eef3;\n  border-radius: 10px;\n  padding: 6px 11px;\n  font-size: 11.5px;\n  font-weight: 600;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}';

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
  .qs, .drawer, .calendar, .cal { margin-top: ${panelTop()}px; }
  .qs { min-width: ${t.panelW - 24}px; }  /* panelW is outer; subtract .sheet padding 12px\xD72 */
  .launcher { min-width: ${t.launcherW}px; }
  .calendar, .cal { min-width: ${t.calendarW - 24}px; }  /* calendarW is outer; subtract .sheet padding 12\xD72 */
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
function buildContextMenu(app, appId) {
  const vbox = new Gtk4.Box({ orientation: Gtk4.Orientation.VERTICAL, spacing: 0 });
  const ws = appWindows(appId);
  for (const w of ws) {
    const row = new Gtk4.Button({ cssClasses: ["cmi"] });
    const hbox = new Gtk4.Box({ spacing: 9 });
    const img = new Gtk4.Image({ iconName: "kobel-window-symbolic" });
    img.cssClasses = [];
    const lbl = new Gtk4.Label({
      label: w.title || app.name,
      halign: Gtk4.Align.START,
      ellipsize: 3,
      xalign: 0,
      hexpand: true
    });
    hbox.append(img);
    hbox.append(lbl);
    row.set_child(hbox);
    row.connect("clicked", () => {
      activate(w.id);
      vbox.get_root()?.hide();
    });
    vbox.append(row);
  }
  if (ws.length > 0) {
    const sep = new Gtk4.Separator({
      orientation: Gtk4.Orientation.HORIZONTAL,
      cssClasses: ["csep"]
    });
    vbox.append(sep);
  }
  const quit = new Gtk4.Button({ cssClasses: ["cmi", "danger"] });
  const qbox = new Gtk4.Box({ spacing: 9 });
  const qimg = new Gtk4.Image({ iconName: "kobel-x-symbolic" });
  qimg.cssClasses = [];
  const qlbl = new Gtk4.Label({ label: "Quit", halign: Gtk4.Align.START, xalign: 0, hexpand: true });
  qbox.append(qimg);
  qbox.append(qlbl);
  quit.set_child(qbox);
  quit.connect("clicked", () => {
    execAsync(`pkill -f "${appId}"`);
    vbox.get_root()?.hide();
  });
  vbox.append(quit);
  const popover = new Gtk4.Popover({ cssClasses: ["cmenu"], child: vbox, hasArrow: false });
  popover.set_position(Gtk4.PositionType.TOP);
  return popover;
}
function DockButton({ app }) {
  const appId = app.entry.replace(/\.desktop$/, "");
  let popover = null;
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
      setup: (self) => {
        popover = buildContextMenu(app, appId);
        popover.set_parent(self);
      },
      onButtonPressed: (_w, e) => {
        if (e.get_button() === Gdk2.BUTTON_MIDDLE) app.launch();
        if (e.get_button() === Gdk2.BUTTON_SECONDARY) {
          if (popover) {
            popover.unparent();
            popover.run_dispose();
          }
          popover = buildContextMenu(app, appId);
          popover.set_parent(_w);
          popover.popup();
        }
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
      /* @__PURE__ */ jsxs("box", { children: [
        /* @__PURE__ */ jsx2("label", { widthRequest: 22, label: "" }),
        /* @__PURE__ */ jsx2("box", { homogeneous: true, hexpand: true, children: ["M", "T", "W", "T", "F", "S", "S"].map((d) => /* @__PURE__ */ jsx2("label", { class: "dow", label: d })) })
      ] })
    );
    for (let r = 0; r < 6; r++) {
      const wkLabel = /* @__PURE__ */ jsx2(
        "label",
        {
          class: "wk tn",
          widthRequest: 22,
          halign: Gtk4.Align.CENTER,
          label: `${isoWeek(new Date(v.y, v.m, r * 7 - start + 1))}`
        }
      );
      const dayCells = [];
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
        dayCells.push(
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
      rows.push(
        /* @__PURE__ */ jsxs("box", { children: [
          wkLabel,
          /* @__PURE__ */ jsx2("box", { homogeneous: true, hexpand: true, children: dayCells })
        ] })
      );
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
        /* @__PURE__ */ jsxs("box", { class: "evempty", spacing: 8, children: [
          /* @__PURE__ */ jsx2("image", { iconName: "kobel-calendar-symbolic" }),
          /* @__PURE__ */ jsx2("label", { label: "No events" })
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
    props.onDrill && /* @__PURE__ */ jsx2("button", { class: "chev", hexpand: false, widthRequest: 30, onClicked: props.onDrill, children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-right-symbolic" }) })
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
var NIC_BG = {
  "kobel-leaf-symbolic": "#628933",
  // oklch(58% .12 130) green = gnoblin
  "kobel-chat-symbolic": "#7c3f8c",
  // oklch(56% .13 300) purple = messages
  "kobel-download-symbolic": "#3d6fa6"
  // oklch(58% .1 250) blue = downloads
};
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
    /* @__PURE__ */ jsx2(
      "box",
      {
        class: "nic",
        valign: Gtk4.Align.START,
        css: NIC_BG[n2.icon] ? `background-color: ${NIC_BG[n2.icon]};` : "",
        children: /* @__PURE__ */ jsx2("image", { iconName: n2.icon, pixelSize: 15 })
      }
    ),
    /* @__PURE__ */ jsxs("box", { class: "ntx", orientation: Gtk4.Orientation.VERTICAL, hexpand: true, children: [
      /* @__PURE__ */ jsxs("box", { class: "t", spacing: 8, children: [
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
        marginRight: 12,
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
      marginRight: 12,
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
      marginBottom: 72,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYXBwLnRzIiwgInNhc3M6L2hvbWUva2llcmFuL2Rldi9rb2JlbC1zaGVsbC9hZ3Mvc3R5bGUvbWFpbi5zY3NzIiwgIi4uL2NvbmZpZy50cyIsICIuLi9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9zZXJ2aWNlcy9ub3RpZmQudHMiLCAiLi4vbGliL2luc3BlY3QudHMiLCAiLi4vbGliL3N1cmZhY2UudHMiLCAiLi4vd2lkZ2V0L0Jhci50c3giLCAiLi4vbGliL2RlbW8udHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2pzeC1ydW50aW1lLnRzIiwgIi4uL3dpZGdldC9Eb2NrLnRzeCIsICIuLi93aWRnZXQvTGF1bmNoZXIudHN4IiwgIi4uL2xpYi9mdXp6eS50cyIsICIuLi93aWRnZXQvQ2FsZW5kYXIudHN4IiwgIi4uL3dpZGdldC9RdWlja1NldHRpbmdzLnRzeCIsICIuLi9saWIvdGlueXNsaWRlci50cyIsICIuLi93aWRnZXQvTm90aWZpY2F0aW9ucy50c3giLCAiLi4vd2lkZ2V0L09TRC50c3giLCAiLi4vd2lkZ2V0L1Nlc3Npb24udHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUgQ29uc3RydWN0UHJvcHMgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmV4cG9ydCB7IEFzdGFsLCBHdGssIEdkayB9XG5leHBvcnQgeyBkZWZhdWx0IGFzIEFwcCB9IGZyb20gXCIuL2FwcC5qc1wiXG5leHBvcnQgeyBhc3RhbGlmeSwgQ29uc3RydWN0UHJvcHMgfVxuZXhwb3J0ICogYXMgV2lkZ2V0IGZyb20gXCIuL3dpZGdldC5qc1wiXG5leHBvcnQgeyBob29rIH0gZnJvbSBcIi4uL19hc3RhbFwiXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEJpbmRpbmcsIHsgdHlwZSBDb25uZWN0YWJsZSwgdHlwZSBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcbmltcG9ydCB7IGludGVydmFsIH0gZnJvbSBcIi4vdGltZS5qc1wiXG5pbXBvcnQgeyBleGVjQXN5bmMsIHN1YnByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcblxuY2xhc3MgVmFyaWFibGVXcmFwcGVyPFQ+IGV4dGVuZHMgRnVuY3Rpb24ge1xuICAgIHByaXZhdGUgdmFyaWFibGUhOiBBc3RhbC5WYXJpYWJsZUJhc2VcbiAgICBwcml2YXRlIGVyckhhbmRsZXI/ID0gY29uc29sZS5lcnJvclxuXG4gICAgcHJpdmF0ZSBfdmFsdWU6IFRcbiAgICBwcml2YXRlIF9wb2xsPzogQXN0YWwuVGltZVxuICAgIHByaXZhdGUgX3dhdGNoPzogQXN0YWwuUHJvY2Vzc1xuXG4gICAgcHJpdmF0ZSBwb2xsSW50ZXJ2YWwgPSAxMDAwXG4gICAgcHJpdmF0ZSBwb2xsRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG4gICAgcHJpdmF0ZSBwb2xsVHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgcHJpdmF0ZSBwb2xsRm4/OiAocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD5cblxuICAgIHByaXZhdGUgd2F0Y2hUcmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICBwcml2YXRlIHdhdGNoRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG5cbiAgICBjb25zdHJ1Y3Rvcihpbml0OiBUKSB7XG4gICAgICAgIHN1cGVyKClcbiAgICAgICAgdGhpcy5fdmFsdWUgPSBpbml0XG4gICAgICAgIHRoaXMudmFyaWFibGUgPSBuZXcgQXN0YWwuVmFyaWFibGVCYXNlKClcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZHJvcHBlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN0b3BXYXRjaCgpXG4gICAgICAgICAgICB0aGlzLnN0b3BQb2xsKClcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gdGhpcy5lcnJIYW5kbGVyPy4oZXJyKSlcbiAgICAgICAgcmV0dXJuIG5ldyBQcm94eSh0aGlzLCB7XG4gICAgICAgICAgICBhcHBseTogKHRhcmdldCwgXywgYXJncykgPT4gdGFyZ2V0Ll9jYWxsKGFyZ3NbMF0pLFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHByaXZhdGUgX2NhbGw8UiA9IFQ+KHRyYW5zZm9ybT86ICh2YWx1ZTogVCkgPT4gUik6IEJpbmRpbmc8Uj4ge1xuICAgICAgICBjb25zdCBiID0gQmluZGluZy5iaW5kKHRoaXMpXG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm0gPyBiLmFzKHRyYW5zZm9ybSkgOiBiIGFzIHVua25vd24gYXMgQmluZGluZzxSPlxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKGBWYXJpYWJsZTwke3RoaXMuZ2V0KCl9PmApXG4gICAgfVxuXG4gICAgZ2V0KCk6IFQgeyByZXR1cm4gdGhpcy5fdmFsdWUgfVxuICAgIHNldCh2YWx1ZTogVCkge1xuICAgICAgICBpZiAodmFsdWUgIT09IHRoaXMuX3ZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLl92YWx1ZSA9IHZhbHVlXG4gICAgICAgICAgICB0aGlzLnZhcmlhYmxlLmVtaXQoXCJjaGFuZ2VkXCIpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFBvbGwoKSB7XG4gICAgICAgIGlmICh0aGlzLl9wb2xsKVxuICAgICAgICAgICAgcmV0dXJuXG5cbiAgICAgICAgaWYgKHRoaXMucG9sbEZuKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2ID0gdGhpcy5wb2xsRm4hKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICAgICAgaWYgKHYgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgICAgICAgICAgIHYudGhlbih2ID0+IHRoaXMuc2V0KHYpKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2V0KHYpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnBvbGxFeGVjKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBleGVjQXN5bmModGhpcy5wb2xsRXhlYyEpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKHYgPT4gdGhpcy5zZXQodGhpcy5wb2xsVHJhbnNmb3JtISh2LCB0aGlzLmdldCgpKSkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFdhdGNoKCkge1xuICAgICAgICBpZiAodGhpcy5fd2F0Y2gpXG4gICAgICAgICAgICByZXR1cm5cblxuICAgICAgICB0aGlzLl93YXRjaCA9IHN1YnByb2Nlc3Moe1xuICAgICAgICAgICAgY21kOiB0aGlzLndhdGNoRXhlYyEsXG4gICAgICAgICAgICBvdXQ6IG91dCA9PiB0aGlzLnNldCh0aGlzLndhdGNoVHJhbnNmb3JtIShvdXQsIHRoaXMuZ2V0KCkpKSxcbiAgICAgICAgICAgIGVycjogZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVyciksXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgc3RvcFBvbGwoKSB7XG4gICAgICAgIHRoaXMuX3BvbGw/LmNhbmNlbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl9wb2xsXG4gICAgfVxuXG4gICAgc3RvcFdhdGNoKCkge1xuICAgICAgICB0aGlzLl93YXRjaD8ua2lsbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl93YXRjaFxuICAgIH1cblxuICAgIGlzUG9sbGluZygpIHsgcmV0dXJuICEhdGhpcy5fcG9sbCB9XG4gICAgaXNXYXRjaGluZygpIHsgcmV0dXJuICEhdGhpcy5fd2F0Y2ggfVxuXG4gICAgZHJvcCgpIHtcbiAgICAgICAgdGhpcy52YXJpYWJsZS5lbWl0KFwiZHJvcHBlZFwiKVxuICAgIH1cblxuICAgIG9uRHJvcHBlZChjYWxsYmFjazogKCkgPT4gdm9pZCkge1xuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJkcm9wcGVkXCIsIGNhbGxiYWNrKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb25FcnJvcihjYWxsYmFjazogKGVycjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmVyckhhbmRsZXJcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gY2FsbGJhY2soZXJyKSlcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGlkID0gdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiY2hhbmdlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICB9KVxuICAgICAgICByZXR1cm4gKCkgPT4gdGhpcy52YXJpYWJsZS5kaXNjb25uZWN0KGlkKVxuICAgIH1cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgY2FsbGJhY2s6IChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPlxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSB8ICgocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD4pLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wUG9sbCgpXG4gICAgICAgIHRoaXMucG9sbEludGVydmFsID0gaW50ZXJ2YWxcbiAgICAgICAgdGhpcy5wb2xsVHJhbnNmb3JtID0gdHJhbnNmb3JtXG4gICAgICAgIGlmICh0eXBlb2YgZXhlYyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxGbiA9IGV4ZWNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBvbGxFeGVjXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxFeGVjID0gZXhlY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucG9sbEZuXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zdGFydFBvbGwoKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgd2F0Y2goXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wV2F0Y2goKVxuICAgICAgICB0aGlzLndhdGNoRXhlYyA9IGV4ZWNcbiAgICAgICAgdGhpcy53YXRjaFRyYW5zZm9ybSA9IHRyYW5zZm9ybVxuICAgICAgICB0aGlzLnN0YXJ0V2F0Y2goKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqczogQXJyYXk8W29iajogQ29ubmVjdGFibGUsIHNpZ25hbDogc3RyaW5nXT4sXG4gICAgICAgIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9iajogQ29ubmVjdGFibGUsXG4gICAgICAgIHNpZ25hbDogc3RyaW5nLFxuICAgICAgICBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmpzOiBDb25uZWN0YWJsZSB8IEFycmF5PFtvYmo6IENvbm5lY3RhYmxlLCBzaWduYWw6IHN0cmluZ10+LFxuICAgICAgICBzaWdPckZuOiBzdHJpbmcgfCAoKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiBUKSxcbiAgICAgICAgY2FsbGJhY2s/OiAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0eXBlb2Ygc2lnT3JGbiA9PT0gXCJmdW5jdGlvblwiID8gc2lnT3JGbiA6IGNhbGxiYWNrID8/ICgoKSA9PiB0aGlzLmdldCgpKVxuICAgICAgICBjb25zdCBzZXQgPSAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IHRoaXMuc2V0KGYob2JqLCAuLi5hcmdzKSlcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvYmpzKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBvYmogb2Ygb2Jqcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtvLCBzXSA9IG9ialxuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gby5jb25uZWN0KHMsIHNldClcbiAgICAgICAgICAgICAgICB0aGlzLm9uRHJvcHBlZCgoKSA9PiBvLmRpc2Nvbm5lY3QoaWQpKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBzaWdPckZuID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWQgPSBvYmpzLmNvbm5lY3Qoc2lnT3JGbiwgc2V0KVxuICAgICAgICAgICAgICAgIHRoaXMub25Ecm9wcGVkKCgpID0+IG9ianMuZGlzY29ubmVjdChpZCkpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgc3RhdGljIGRlcml2ZTxcbiAgICAgICAgY29uc3QgRGVwcyBleHRlbmRzIEFycmF5PFN1YnNjcmliYWJsZTxhbnk+PixcbiAgICAgICAgQXJncyBleHRlbmRzIHtcbiAgICAgICAgICAgIFtLIGluIGtleW9mIERlcHNdOiBEZXBzW0tdIGV4dGVuZHMgU3Vic2NyaWJhYmxlPGluZmVyIFQ+ID8gVCA6IG5ldmVyXG4gICAgICAgIH0sXG4gICAgICAgIFYgPSBBcmdzLFxuICAgID4oZGVwczogRGVwcywgZm46ICguLi5hcmdzOiBBcmdzKSA9PiBWID0gKC4uLmFyZ3MpID0+IGFyZ3MgYXMgdW5rbm93biBhcyBWKSB7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IGZuKC4uLmRlcHMubWFwKGQgPT4gZC5nZXQoKSkgYXMgQXJncylcbiAgICAgICAgY29uc3QgZGVyaXZlZCA9IG5ldyBWYXJpYWJsZSh1cGRhdGUoKSlcbiAgICAgICAgY29uc3QgdW5zdWJzID0gZGVwcy5tYXAoZGVwID0+IGRlcC5zdWJzY3JpYmUoKCkgPT4gZGVyaXZlZC5zZXQodXBkYXRlKCkpKSlcbiAgICAgICAgZGVyaXZlZC5vbkRyb3BwZWQoKCkgPT4gdW5zdWJzLm1hcCh1bnN1YiA9PiB1bnN1YigpKSlcbiAgICAgICAgcmV0dXJuIGRlcml2ZWRcbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmFyaWFibGU8VD4gZXh0ZW5kcyBPbWl0PFZhcmlhYmxlV3JhcHBlcjxUPiwgXCJiaW5kXCI+IHtcbiAgICA8Uj4odHJhbnNmb3JtOiAodmFsdWU6IFQpID0+IFIpOiBCaW5kaW5nPFI+XG4gICAgKCk6IEJpbmRpbmc8VD5cbn1cblxuZXhwb3J0IGNvbnN0IFZhcmlhYmxlID0gbmV3IFByb3h5KFZhcmlhYmxlV3JhcHBlciBhcyBhbnksIHtcbiAgICBhcHBseTogKF90LCBfYSwgYXJncykgPT4gbmV3IFZhcmlhYmxlV3JhcHBlcihhcmdzWzBdKSxcbn0pIGFzIHtcbiAgICBkZXJpdmU6IHR5cGVvZiBWYXJpYWJsZVdyYXBwZXJbXCJkZXJpdmVcIl1cbiAgICA8VD4oaW5pdDogVCk6IFZhcmlhYmxlPFQ+XG4gICAgbmV3PFQ+KGluaXQ6IFQpOiBWYXJpYWJsZTxUPlxufVxuXG5leHBvcnQgY29uc3QgeyBkZXJpdmUgfSA9IFZhcmlhYmxlXG5leHBvcnQgZGVmYXVsdCBWYXJpYWJsZVxuIiwgImV4cG9ydCBjb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuZXhwb3J0IGNvbnN0IGtlYmFiaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMS0kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiX1wiLCBcIi1cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5leHBvcnQgaW50ZXJmYWNlIFN1YnNjcmliYWJsZTxUID0gdW5rbm93bj4ge1xuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKTogKCkgPT4gdm9pZFxuICAgIGdldCgpOiBUXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29ubmVjdGFibGUge1xuICAgIGNvbm5lY3Qoc2lnbmFsOiBzdHJpbmcsIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IHVua25vd24pOiBudW1iZXJcbiAgICBkaXNjb25uZWN0KGlkOiBudW1iZXIpOiB2b2lkXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBjbGFzcyBCaW5kaW5nPFZhbHVlPiB7XG4gICAgcHJpdmF0ZSB0cmFuc2Zvcm1GbiA9ICh2OiBhbnkpID0+IHZcblxuICAgICNlbWl0dGVyOiBTdWJzY3JpYmFibGU8VmFsdWU+IHwgQ29ubmVjdGFibGVcbiAgICAjcHJvcD86IHN0cmluZ1xuXG4gICAgc3RhdGljIGJpbmQ8XG4gICAgICAgIFQgZXh0ZW5kcyBDb25uZWN0YWJsZSxcbiAgICAgICAgUCBleHRlbmRzIGtleW9mIFQsXG4gICAgPihvYmplY3Q6IFQsIHByb3BlcnR5OiBQKTogQmluZGluZzxUW1BdPlxuXG4gICAgc3RhdGljIGJpbmQ8VD4ob2JqZWN0OiBTdWJzY3JpYmFibGU8VD4pOiBCaW5kaW5nPFQ+XG5cbiAgICBzdGF0aWMgYmluZChlbWl0dGVyOiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSwgcHJvcD86IHN0cmluZykge1xuICAgICAgICByZXR1cm4gbmV3IEJpbmRpbmcoZW1pdHRlciwgcHJvcClcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdG9yKGVtaXR0ZXI6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlPFZhbHVlPiwgcHJvcD86IHN0cmluZykge1xuICAgICAgICB0aGlzLiNlbWl0dGVyID0gZW1pdHRlclxuICAgICAgICB0aGlzLiNwcm9wID0gcHJvcCAmJiBrZWJhYmlmeShwcm9wKVxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gYEJpbmRpbmc8JHt0aGlzLiNlbWl0dGVyfSR7dGhpcy4jcHJvcCA/IGAsIFwiJHt0aGlzLiNwcm9wfVwiYCA6IFwiXCJ9PmBcbiAgICB9XG5cbiAgICBhczxUPihmbjogKHY6IFZhbHVlKSA9PiBUKTogQmluZGluZzxUPiB7XG4gICAgICAgIGNvbnN0IGJpbmQgPSBuZXcgQmluZGluZyh0aGlzLiNlbWl0dGVyLCB0aGlzLiNwcm9wKVxuICAgICAgICBiaW5kLnRyYW5zZm9ybUZuID0gKHY6IFZhbHVlKSA9PiBmbih0aGlzLnRyYW5zZm9ybUZuKHYpKVxuICAgICAgICByZXR1cm4gYmluZCBhcyB1bmtub3duIGFzIEJpbmRpbmc8VD5cbiAgICB9XG5cbiAgICBnZXQoKTogVmFsdWUge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuZ2V0ID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyLmdldCgpKVxuXG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jcHJvcCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgY29uc3QgZ2V0dGVyID0gYGdldF8ke3NuYWtlaWZ5KHRoaXMuI3Byb3ApfWBcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlcltnZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlcltnZXR0ZXJdKCkpXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXJbdGhpcy4jcHJvcF0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbiBub3QgZ2V0IHZhbHVlIG9mIGJpbmRpbmdcIilcbiAgICB9XG5cbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVmFsdWUpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLnN1YnNjcmliZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy4jZW1pdHRlci5zdWJzY3JpYmUoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgY29uc3Qgc2lnbmFsID0gYG5vdGlmeTo6JHt0aGlzLiNwcm9wfWBcbiAgICAgICAgICAgIGNvbnN0IGlkID0gdGhpcy4jZW1pdHRlci5jb25uZWN0KHNpZ25hbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICAodGhpcy4jZW1pdHRlci5kaXNjb25uZWN0IGFzIENvbm5lY3RhYmxlW1wiZGlzY29ubmVjdFwiXSkoaWQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgRXJyb3IoYCR7dGhpcy4jZW1pdHRlcn0gaXMgbm90IGJpbmRhYmxlYClcbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCB7IGJpbmQgfSA9IEJpbmRpbmdcbmV4cG9ydCBkZWZhdWx0IEJpbmRpbmdcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5cbmV4cG9ydCB0eXBlIFRpbWUgPSBBc3RhbC5UaW1lXG5leHBvcnQgY29uc3QgVGltZSA9IEFzdGFsLlRpbWVcblxuZXhwb3J0IGZ1bmN0aW9uIGludGVydmFsKGludGVydmFsOiBudW1iZXIsIGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLmludGVydmFsKGludGVydmFsLCAoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXQodGltZW91dDogbnVtYmVyLCBjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS50aW1lb3V0KHRpbWVvdXQsICgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaWRsZShjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS5pZGxlKCgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcblxudHlwZSBBcmdzID0ge1xuICAgIGNtZDogc3RyaW5nIHwgc3RyaW5nW11cbiAgICBvdXQ/OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWRcbiAgICBlcnI/OiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWRcbn1cblxuZXhwb3J0IHR5cGUgUHJvY2VzcyA9IEFzdGFsLlByb2Nlc3NcbmV4cG9ydCBjb25zdCBQcm9jZXNzID0gQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhhcmdzOiBBcmdzKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBjbWQ6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgIG9uT3V0PzogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkLFxuICAgIG9uRXJyPzogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkLFxuKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBhcmdzT3JDbWQ6IEFyZ3MgfCBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICBvbk91dDogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkID0gcHJpbnQsXG4gICAgb25FcnI6IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZCA9IHByaW50ZXJyLFxuKSB7XG4gICAgY29uc3QgYXJncyA9IEFycmF5LmlzQXJyYXkoYXJnc09yQ21kKSB8fCB0eXBlb2YgYXJnc09yQ21kID09PSBcInN0cmluZ1wiXG4gICAgY29uc3QgeyBjbWQsIGVyciwgb3V0IH0gPSB7XG4gICAgICAgIGNtZDogYXJncyA/IGFyZ3NPckNtZCA6IGFyZ3NPckNtZC5jbWQsXG4gICAgICAgIGVycjogYXJncyA/IG9uRXJyIDogYXJnc09yQ21kLmVyciB8fCBvbkVycixcbiAgICAgICAgb3V0OiBhcmdzID8gb25PdXQgOiBhcmdzT3JDbWQub3V0IHx8IG9uT3V0LFxuICAgIH1cblxuICAgIGNvbnN0IHByb2MgPSBBcnJheS5pc0FycmF5KGNtZClcbiAgICAgICAgPyBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3N2KGNtZClcbiAgICAgICAgOiBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3MoY21kKVxuXG4gICAgcHJvYy5jb25uZWN0KFwic3Rkb3V0XCIsIChfLCBzdGRvdXQ6IHN0cmluZykgPT4gb3V0KHN0ZG91dCkpXG4gICAgcHJvYy5jb25uZWN0KFwic3RkZXJyXCIsIChfLCBzdGRlcnI6IHN0cmluZykgPT4gZXJyKHN0ZGVycikpXG4gICAgcmV0dXJuIHByb2Ncbn1cblxuLyoqIEB0aHJvd3Mge0dMaWIuRXJyb3J9IFRocm93cyBzdGRlcnIgKi9cbmV4cG9ydCBmdW5jdGlvbiBleGVjKGNtZDogc3RyaW5nIHwgc3RyaW5nW10pIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShjbWQpXG4gICAgICAgID8gQXN0YWwuUHJvY2Vzcy5leGVjdihjbWQpXG4gICAgICAgIDogQXN0YWwuUHJvY2Vzcy5leGVjKGNtZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4ZWNBc3luYyhjbWQ6IHN0cmluZyB8IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjbWQpKSB7XG4gICAgICAgICAgICBBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmN2KGNtZCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jdl9maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEFzdGFsLlByb2Nlc3MuZXhlY19hc3luYyhjbWQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLlByb2Nlc3MuZXhlY19maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiaW1wb3J0IFZhcmlhYmxlIGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbmltcG9ydCB7IGV4ZWNBc3luYyB9IGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuaW1wb3J0IEJpbmRpbmcsIHsgQ29ubmVjdGFibGUsIGtlYmFiaWZ5LCBzbmFrZWlmeSwgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCBjb25zdCBub0ltcGxpY2l0RGVzdHJveSA9IFN5bWJvbChcIm5vIG5vIGltcGxpY2l0IGRlc3Ryb3lcIilcbmV4cG9ydCBjb25zdCBzZXRDaGlsZHJlbiA9IFN5bWJvbChcImNoaWxkcmVuIHNldHRlciBtZXRob2RcIilcblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQmluZGluZ3MoYXJyYXk6IGFueVtdKSB7XG4gICAgZnVuY3Rpb24gZ2V0VmFsdWVzKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgIGxldCBpID0gMFxuICAgICAgICByZXR1cm4gYXJyYXkubWFwKHZhbHVlID0+IHZhbHVlIGluc3RhbmNlb2YgQmluZGluZ1xuICAgICAgICAgICAgPyBhcmdzW2krK11cbiAgICAgICAgICAgIDogdmFsdWUsXG4gICAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBiaW5kaW5ncyA9IGFycmF5LmZpbHRlcihpID0+IGkgaW5zdGFuY2VvZiBCaW5kaW5nKVxuXG4gICAgaWYgKGJpbmRpbmdzLmxlbmd0aCA9PT0gMClcbiAgICAgICAgcmV0dXJuIGFycmF5XG5cbiAgICBpZiAoYmluZGluZ3MubGVuZ3RoID09PSAxKVxuICAgICAgICByZXR1cm4gYmluZGluZ3NbMF0uYXMoZ2V0VmFsdWVzKVxuXG4gICAgcmV0dXJuIFZhcmlhYmxlLmRlcml2ZShiaW5kaW5ncywgZ2V0VmFsdWVzKSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRQcm9wKG9iajogYW55LCBwcm9wOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzZXR0ZXIgPSBgc2V0XyR7c25ha2VpZnkocHJvcCl9YFxuICAgICAgICBpZiAodHlwZW9mIG9ialtzZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gb2JqW3NldHRlcl0odmFsdWUpXG5cbiAgICAgICAgcmV0dXJuIChvYmpbcHJvcF0gPSB2YWx1ZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBjb3VsZCBub3Qgc2V0IHByb3BlcnR5IFwiJHtwcm9wfVwiIG9uICR7b2JqfTpgLCBlcnJvcilcbiAgICB9XG59XG5cbmV4cG9ydCB0eXBlIEJpbmRhYmxlUHJvcHM8VD4gPSB7XG4gICAgW0sgaW4ga2V5b2YgVF06IEJpbmRpbmc8VFtLXT4gfCBUW0tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaG9vazxXaWRnZXQgZXh0ZW5kcyBDb25uZWN0YWJsZT4oXG4gICAgd2lkZ2V0OiBXaWRnZXQsXG4gICAgb2JqZWN0OiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSxcbiAgICBzaWduYWxPckNhbGxiYWNrOiBzdHJpbmcgfCAoKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQpLFxuICAgIGNhbGxiYWNrPzogKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4pIHtcbiAgICBpZiAodHlwZW9mIG9iamVjdC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIgJiYgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgaWQgPSBvYmplY3QuY29ubmVjdChzaWduYWxPckNhbGxiYWNrLCAoXzogYW55LCAuLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCAoKSA9PiB7XG4gICAgICAgICAgICAob2JqZWN0LmRpc2Nvbm5lY3QgYXMgQ29ubmVjdGFibGVbXCJkaXNjb25uZWN0XCJdKShpZClcbiAgICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvYmplY3Quc3Vic2NyaWJlID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIHNpZ25hbE9yQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCB1bnN1YiA9IG9iamVjdC5zdWJzY3JpYmUoKC4uLmFyZ3M6IHVua25vd25bXSkgPT4ge1xuICAgICAgICAgICAgc2lnbmFsT3JDYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCB1bnN1YilcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25zdHJ1Y3Q8V2lkZ2V0IGV4dGVuZHMgQ29ubmVjdGFibGUgJiB7IFtzZXRDaGlsZHJlbl06IChjaGlsZHJlbjogYW55W10pID0+IHZvaWQgfT4od2lkZ2V0OiBXaWRnZXQsIGNvbmZpZzogYW55KSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHByZWZlci1jb25zdFxuICAgIGxldCB7IHNldHVwLCBjaGlsZCwgY2hpbGRyZW4gPSBbXSwgLi4ucHJvcHMgfSA9IGNvbmZpZ1xuXG4gICAgaWYgKGNoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cbiAgICB9XG5cbiAgICBpZiAoY2hpbGQpIHtcbiAgICAgICAgY2hpbGRyZW4udW5zaGlmdChjaGlsZClcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgdW5kZWZpbmVkIHZhbHVlc1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNvbGxlY3QgYmluZGluZ3NcbiAgICBjb25zdCBiaW5kaW5nczogQXJyYXk8W3N0cmluZywgQmluZGluZzxhbnk+XT4gPSBPYmplY3RcbiAgICAgICAgLmtleXMocHJvcHMpXG4gICAgICAgIC5yZWR1Y2UoKGFjYzogYW55LCBwcm9wKSA9PiB7XG4gICAgICAgICAgICBpZiAocHJvcHNbcHJvcF0gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmluZGluZyA9IHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5hY2MsIFtwcm9wLCBiaW5kaW5nXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBjb2xsZWN0IHNpZ25hbCBoYW5kbGVyc1xuICAgIGNvbnN0IG9uSGFuZGxlcnM6IEFycmF5PFtzdHJpbmcsIHN0cmluZyB8ICgoKSA9PiB1bmtub3duKV0+ID0gT2JqZWN0XG4gICAgICAgIC5rZXlzKHByb3BzKVxuICAgICAgICAucmVkdWNlKChhY2M6IGFueSwga2V5KSA9PiB7XG4gICAgICAgICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoXCJvblwiKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNpZyA9IGtlYmFiaWZ5KGtleSkuc3BsaXQoXCItXCIpLnNsaWNlKDEpLmpvaW4oXCItXCIpXG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlciA9IHByb3BzW2tleV1cbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICAgICAgICAgIHJldHVybiBbLi4uYWNjLCBbc2lnLCBoYW5kbGVyXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBzZXQgY2hpbGRyZW5cbiAgICBjb25zdCBtZXJnZWRDaGlsZHJlbiA9IG1lcmdlQmluZGluZ3MoY2hpbGRyZW4uZmxhdChJbmZpbml0eSkpXG4gICAgaWYgKG1lcmdlZENoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuLmdldCgpKVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgbWVyZ2VkQ2hpbGRyZW4uc3Vic2NyaWJlKCh2KSA9PiB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKHYpXG4gICAgICAgIH0pKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChtZXJnZWRDaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0dXAgc2lnbmFsIGhhbmRsZXJzXG4gICAgZm9yIChjb25zdCBbc2lnbmFsLCBjYWxsYmFja10gb2Ygb25IYW5kbGVycykge1xuICAgICAgICBjb25zdCBzaWcgPSBzaWduYWwuc3RhcnRzV2l0aChcIm5vdGlmeVwiKVxuICAgICAgICAgICAgPyBzaWduYWwucmVwbGFjZShcIi1cIiwgXCI6OlwiKVxuICAgICAgICAgICAgOiBzaWduYWxcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KHNpZywgY2FsbGJhY2spXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChzaWcsICgpID0+IGV4ZWNBc3luYyhjYWxsYmFjaylcbiAgICAgICAgICAgICAgICAudGhlbihwcmludCkuY2F0Y2goY29uc29sZS5lcnJvcikpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZXR1cCBiaW5kaW5ncyBoYW5kbGVyc1xuICAgIGZvciAoY29uc3QgW3Byb3AsIGJpbmRpbmddIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGlmIChwcm9wID09PSBcImNoaWxkXCIgfHwgcHJvcCA9PT0gXCJjaGlsZHJlblwiKSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgYmluZGluZy5zdWJzY3JpYmUoKHY6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0odilcbiAgICAgICAgICAgIH0pKVxuICAgICAgICB9XG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBiaW5kaW5nLnN1YnNjcmliZSgodjogYW55KSA9PiB7XG4gICAgICAgICAgICBzZXRQcm9wKHdpZGdldCwgcHJvcCwgdilcbiAgICAgICAgfSkpXG4gICAgICAgIHNldFByb3Aod2lkZ2V0LCBwcm9wLCBiaW5kaW5nLmdldCgpKVxuICAgIH1cblxuICAgIC8vIGZpbHRlciB1bmRlZmluZWQgdmFsdWVzXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHByb3BzKVxuICAgIHNldHVwPy4od2lkZ2V0KVxuICAgIHJldHVybiB3aWRnZXRcbn1cblxuZnVuY3Rpb24gaXNBcnJvd0Z1bmN0aW9uKGZ1bmM6IGFueSk6IGZ1bmMgaXMgKGFyZ3M6IGFueSkgPT4gYW55IHtcbiAgICByZXR1cm4gIU9iamVjdC5oYXNPd24oZnVuYywgXCJwcm90b3R5cGVcIilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yczogUmVjb3JkPHN0cmluZywgeyBuZXcocHJvcHM6IGFueSk6IGFueSB9IHwgKChwcm9wczogYW55KSA9PiBhbnkpPixcbiAgICBjdG9yOiBzdHJpbmcgfCAoKHByb3BzOiBhbnkpID0+IGFueSkgfCB7IG5ldyhwcm9wczogYW55KTogYW55IH0sXG4gICAgeyBjaGlsZHJlbiwgLi4ucHJvcHMgfTogYW55LFxuKSB7XG4gICAgY2hpbGRyZW4gPz89IFtdXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKVxuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cblxuICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmlsdGVyKEJvb2xlYW4pXG5cbiAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID09PSAxKVxuICAgICAgICBwcm9wcy5jaGlsZCA9IGNoaWxkcmVuWzBdXG4gICAgZWxzZSBpZiAoY2hpbGRyZW4ubGVuZ3RoID4gMSlcbiAgICAgICAgcHJvcHMuY2hpbGRyZW4gPSBjaGlsZHJlblxuXG4gICAgaWYgKHR5cGVvZiBjdG9yID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChpc0Fycm93RnVuY3Rpb24oY3RvcnNbY3Rvcl0pKVxuICAgICAgICAgICAgcmV0dXJuIGN0b3JzW2N0b3JdKHByb3BzKVxuXG4gICAgICAgIHJldHVybiBuZXcgY3RvcnNbY3Rvcl0ocHJvcHMpXG4gICAgfVxuXG4gICAgaWYgKGlzQXJyb3dGdW5jdGlvbihjdG9yKSlcbiAgICAgICAgcmV0dXJuIGN0b3IocHJvcHMpXG5cbiAgICByZXR1cm4gbmV3IGN0b3IocHJvcHMpXG59XG4iLCAiaW1wb3J0IHsgbm9JbXBsaWNpdERlc3Ryb3ksIHNldENoaWxkcmVuLCB0eXBlIEJpbmRhYmxlUHJvcHMsIGNvbnN0cnVjdCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEJpbmRpbmcgZnJvbSBcIi4uL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgY29uc3QgdHlwZSA9IFN5bWJvbChcImNoaWxkIHR5cGVcIilcbmNvbnN0IGR1bW15QnVsZGVyID0gbmV3IEd0ay5CdWlsZGVyXG5cbmZ1bmN0aW9uIF9nZXRDaGlsZHJlbih3aWRnZXQ6IEd0ay5XaWRnZXQpOiBBcnJheTxHdGsuV2lkZ2V0PiB7XG4gICAgaWYgKFwiZ2V0X2NoaWxkXCIgaW4gd2lkZ2V0ICYmIHR5cGVvZiB3aWRnZXQuZ2V0X2NoaWxkID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gd2lkZ2V0LmdldF9jaGlsZCgpID8gW3dpZGdldC5nZXRfY2hpbGQoKV0gOiBbXVxuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkcmVuOiBBcnJheTxHdGsuV2lkZ2V0PiA9IFtdXG4gICAgbGV0IGNoID0gd2lkZ2V0LmdldF9maXJzdF9jaGlsZCgpXG4gICAgd2hpbGUgKGNoICE9PSBudWxsKSB7XG4gICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgIGNoID0gY2guZ2V0X25leHRfc2libGluZygpXG4gICAgfVxuICAgIHJldHVybiBjaGlsZHJlblxufVxuXG5mdW5jdGlvbiBfc2V0Q2hpbGRyZW4od2lkZ2V0OiBHdGsuV2lkZ2V0LCBjaGlsZHJlbjogYW55W10pIHtcbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xuICAgICAgICB3aWRnZXQudmZ1bmNfYWRkX2NoaWxkKFxuICAgICAgICAgICAgZHVtbXlCdWxkZXIsXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIHR5cGUgaW4gY2hpbGQgPyBjaGlsZFt0eXBlXSA6IG51bGwsXG4gICAgICAgIClcbiAgICB9XG59XG5cbnR5cGUgQ29uZmlnPFQgZXh0ZW5kcyBHdGsuV2lkZ2V0PiA9IHtcbiAgICBzZXRDaGlsZHJlbih3aWRnZXQ6IFQsIGNoaWxkcmVuOiBhbnlbXSk6IHZvaWRcbiAgICBnZXRDaGlsZHJlbih3aWRnZXQ6IFQpOiBBcnJheTxHdGsuV2lkZ2V0PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhc3RhbGlmeTxcbiAgICBXaWRnZXQgZXh0ZW5kcyBHdGsuV2lkZ2V0LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzID0gR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4oY2xzOiB7IG5ldyguLi5hcmdzOiBhbnlbXSk6IFdpZGdldCB9LCBjb25maWc6IFBhcnRpYWw8Q29uZmlnPFdpZGdldD4+ID0ge30pIHtcbiAgICBPYmplY3QuYXNzaWduKGNscy5wcm90b3R5cGUsIHtcbiAgICAgICAgW3NldENoaWxkcmVuXShjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIGNvbnN0IHcgPSB0aGlzIGFzIHVua25vd24gYXMgV2lkZ2V0XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIChjb25maWcuZ2V0Q2hpbGRyZW4/Lih3KSB8fCBfZ2V0Q2hpbGRyZW4odykpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgR3RrLldpZGdldCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZC51bnBhcmVudCgpXG4gICAgICAgICAgICAgICAgICAgIGlmICghY2hpbGRyZW4uaW5jbHVkZXMoY2hpbGQpICYmIG5vSW1wbGljaXREZXN0cm95IGluIHRoaXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZC5ydW5fZGlzcG9zZSgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY29uZmlnLnNldENoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnNldENoaWxkcmVuKHcsIGNoaWxkcmVuKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBfc2V0Q2hpbGRyZW4odywgY2hpbGRyZW4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICAgIFtjbHMubmFtZV06IChcbiAgICAgICAgICAgIHByb3BzOiBDb25zdHJ1Y3RQcm9wczxXaWRnZXQsIFByb3BzLCBTaWduYWxzPiA9IHt9LFxuICAgICAgICAgICAgLi4uY2hpbGRyZW46IGFueVtdXG4gICAgICAgICk6IFdpZGdldCA9PiB7XG4gICAgICAgICAgICBjb25zdCB3aWRnZXQgPSBuZXcgY2xzKFwiY3NzTmFtZVwiIGluIHByb3BzID8geyBjc3NOYW1lOiBwcm9wcy5jc3NOYW1lIH0gOiB7fSlcblxuICAgICAgICAgICAgaWYgKFwiY3NzTmFtZVwiIGluIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLmNzc05hbWVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHByb3BzLm5vSW1wbGljaXREZXN0cm95KSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHsgW25vSW1wbGljaXREZXN0cm95XTogdHJ1ZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5ub0ltcGxpY2l0RGVzdHJveVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocHJvcHMudHlwZSkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCB7IFt0eXBlXTogcHJvcHMudHlwZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy50eXBlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihwcm9wcywgeyBjaGlsZHJlbiB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gY29uc3RydWN0KHdpZGdldCBhcyBhbnksIHNldHVwQ29udHJvbGxlcnMod2lkZ2V0LCBwcm9wcyBhcyBhbnkpKVxuICAgICAgICB9LFxuICAgIH1bY2xzLm5hbWVdXG59XG5cbnR5cGUgU2lnSGFuZGxlcjxcbiAgICBXIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBBcmdzIGV4dGVuZHMgQXJyYXk8dW5rbm93bj4sXG4+ID0gKChzZWxmOiBXLCAuLi5hcmdzOiBBcmdzKSA9PiB1bmtub3duKSB8IHN0cmluZyB8IHN0cmluZ1tdXG5cbmV4cG9ydCB7IEJpbmRhYmxlUHJvcHMgfVxuZXhwb3J0IHR5cGUgQmluZGFibGVDaGlsZCA9IEd0ay5XaWRnZXQgfCBCaW5kaW5nPEd0ay5XaWRnZXQ+XG5cbmV4cG9ydCB0eXBlIENvbnN0cnVjdFByb3BzPFxuICAgIFNlbGYgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4gPSBQYXJ0aWFsPHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNhbid0IGFzc2lnbiB0byB1bmtub3duLCBidXQgaXQgd29ya3MgYXMgZXhwZWN0ZWQgdGhvdWdoXG4gICAgW1MgaW4ga2V5b2YgU2lnbmFsc106IFNpZ0hhbmRsZXI8U2VsZiwgU2lnbmFsc1tTXT5cbn0+ICYgUGFydGlhbDx7XG4gICAgW0tleSBpbiBgb24ke3N0cmluZ31gXTogU2lnSGFuZGxlcjxTZWxmLCBhbnlbXT5cbn0+ICYgUGFydGlhbDxCaW5kYWJsZVByb3BzPE9taXQ8UHJvcHMsIFwiY3NzTmFtZVwiIHwgXCJjc3NfbmFtZVwiPj4+ICYge1xuICAgIG5vSW1wbGljaXREZXN0cm95PzogdHJ1ZVxuICAgIHR5cGU/OiBzdHJpbmdcbiAgICBjc3NOYW1lPzogc3RyaW5nXG59ICYgRXZlbnRDb250cm9sbGVyPFNlbGY+ICYge1xuICAgIG9uRGVzdHJveT86IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgc2V0dXA/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxufVxuXG50eXBlIEV2ZW50Q29udHJvbGxlcjxTZWxmIGV4dGVuZHMgR3RrLldpZGdldD4gPSB7XG4gICAgb25Gb2N1c0VudGVyPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbkZvY3VzTGVhdmU/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuXG4gICAgb25LZXlQcmVzc2VkPzogKHNlbGY6IFNlbGYsIGtleXZhbDogbnVtYmVyLCBrZXljb2RlOiBudW1iZXIsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG4gICAgb25LZXlSZWxlYXNlZD86IChzZWxmOiBTZWxmLCBrZXl2YWw6IG51bWJlciwga2V5Y29kZTogbnVtYmVyLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuICAgIG9uS2V5TW9kaWZpZXI/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcblxuICAgIG9uTGVnYWN5PzogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHZvaWRcbiAgICBvbkJ1dHRvblByZXNzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuICAgIG9uQnV0dG9uUmVsZWFzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuXG4gICAgb25Ib3ZlckVudGVyPzogKHNlbGY6IFNlbGYsIHg6IG51bWJlciwgeTogbnVtYmVyKSA9PiB2b2lkXG4gICAgb25Ib3ZlckxlYXZlPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbk1vdGlvbj86IChzZWxmOiBTZWxmLCB4OiBudW1iZXIsIHk6IG51bWJlcikgPT4gdm9pZFxuXG4gICAgb25TY3JvbGw/OiAoc2VsZjogU2VsZiwgZHg6IG51bWJlciwgZHk6IG51bWJlcikgPT4gdm9pZFxuICAgIG9uU2Nyb2xsRGVjZWxlcmF0ZT86IChzZWxmOiBTZWxmLCB2ZWxfeDogbnVtYmVyLCB2ZWxfeTogbnVtYmVyKSA9PiB2b2lkXG59XG5cbmZ1bmN0aW9uIHNldHVwQ29udHJvbGxlcnM8VD4od2lkZ2V0OiBHdGsuV2lkZ2V0LCB7XG4gICAgb25Gb2N1c0VudGVyLFxuICAgIG9uRm9jdXNMZWF2ZSxcbiAgICBvbktleVByZXNzZWQsXG4gICAgb25LZXlSZWxlYXNlZCxcbiAgICBvbktleU1vZGlmaWVyLFxuICAgIG9uTGVnYWN5LFxuICAgIG9uQnV0dG9uUHJlc3NlZCxcbiAgICBvbkJ1dHRvblJlbGVhc2VkLFxuICAgIG9uSG92ZXJFbnRlcixcbiAgICBvbkhvdmVyTGVhdmUsXG4gICAgb25Nb3Rpb24sXG4gICAgb25TY3JvbGwsXG4gICAgb25TY3JvbGxEZWNlbGVyYXRlLFxuICAgIC4uLnByb3BzXG59OiBFdmVudENvbnRyb2xsZXI8R3RrLldpZGdldD4gJiBUKSB7XG4gICAgaWYgKG9uRm9jdXNFbnRlciB8fCBvbkZvY3VzTGVhdmUpIHtcbiAgICAgICAgY29uc3QgZm9jdXMgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckZvY3VzXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihmb2N1cylcblxuICAgICAgICBpZiAob25Gb2N1c0VudGVyKVxuICAgICAgICAgICAgZm9jdXMuY29ubmVjdChcImVudGVyXCIsICgpID0+IG9uRm9jdXNFbnRlcih3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbkZvY3VzTGVhdmUpXG4gICAgICAgICAgICBmb2N1cy5jb25uZWN0KFwibGVhdmVcIiwgKCkgPT4gb25Gb2N1c0xlYXZlKHdpZGdldCkpXG4gICAgfVxuXG4gICAgaWYgKG9uS2V5UHJlc3NlZCB8fCBvbktleVJlbGVhc2VkIHx8IG9uS2V5TW9kaWZpZXIpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJLZXlcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGtleSlcblxuICAgICAgICBpZiAob25LZXlQcmVzc2VkKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJrZXktcHJlc3NlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlQcmVzc2VkKHdpZGdldCwgdmFsLCBjb2RlLCBzdGF0ZSkpXG5cbiAgICAgICAgaWYgKG9uS2V5UmVsZWFzZWQpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcImtleS1yZWxlYXNlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlSZWxlYXNlZCh3aWRnZXQsIHZhbCwgY29kZSwgc3RhdGUpKVxuXG4gICAgICAgIGlmIChvbktleU1vZGlmaWVyKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJtb2RpZmllcnNcIiwgKF8sIHN0YXRlKSA9PiBvbktleU1vZGlmaWVyKHdpZGdldCwgc3RhdGUpKVxuICAgIH1cblxuICAgIGlmIChvbkxlZ2FjeSB8fCBvbkJ1dHRvblByZXNzZWQgfHwgb25CdXR0b25SZWxlYXNlZCkge1xuICAgICAgICBjb25zdCBsZWdhY3kgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckxlZ2FjeVxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIobGVnYWN5KVxuXG4gICAgICAgIGxlZ2FjeS5jb25uZWN0KFwiZXZlbnRcIiwgKF8sIGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuZ2V0X2V2ZW50X3R5cGUoKSA9PT0gR2RrLkV2ZW50VHlwZS5CVVRUT05fUFJFU1MpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblByZXNzZWQ/Lih3aWRnZXQsIGV2ZW50IGFzIEdkay5CdXR0b25FdmVudClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGV2ZW50LmdldF9ldmVudF90eXBlKCkgPT09IEdkay5FdmVudFR5cGUuQlVUVE9OX1JFTEVBU0UpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblJlbGVhc2VkPy4od2lkZ2V0LCBldmVudCBhcyBHZGsuQnV0dG9uRXZlbnQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9uTGVnYWN5Py4od2lkZ2V0LCBldmVudClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob25Nb3Rpb24gfHwgb25Ib3ZlckVudGVyIHx8IG9uSG92ZXJMZWF2ZSkge1xuICAgICAgICBjb25zdCBob3ZlciA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyTW90aW9uXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihob3ZlcilcblxuICAgICAgICBpZiAob25Ib3ZlckVudGVyKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImVudGVyXCIsIChfLCB4LCB5KSA9PiBvbkhvdmVyRW50ZXIod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25Ib3ZlckxlYXZlKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImxlYXZlXCIsICgpID0+IG9uSG92ZXJMZWF2ZSh3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbk1vdGlvbilcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJtb3Rpb25cIiwgKF8sIHgsIHkpID0+IG9uTW90aW9uKHdpZGdldCwgeCwgeSkpXG4gICAgfVxuXG4gICAgaWYgKG9uU2Nyb2xsIHx8IG9uU2Nyb2xsRGVjZWxlcmF0ZSkge1xuICAgICAgICBjb25zdCBzY3JvbGwgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbFxuICAgICAgICBzY3JvbGwuZmxhZ3MgPSBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsRmxhZ3MuQk9USF9BWEVTIHwgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbEZsYWdzLktJTkVUSUNcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKHNjcm9sbClcblxuICAgICAgICBpZiAob25TY3JvbGwpXG4gICAgICAgICAgICBzY3JvbGwuY29ubmVjdChcInNjcm9sbFwiLCAoXywgeCwgeSkgPT4gb25TY3JvbGwod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25TY3JvbGxEZWNlbGVyYXRlKVxuICAgICAgICAgICAgc2Nyb2xsLmNvbm5lY3QoXCJkZWNlbGVyYXRlXCIsIChfLCB4LCB5KSA9PiBvblNjcm9sbERlY2VsZXJhdGUod2lkZ2V0LCB4LCB5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvcHNcbn1cbiIsICJpbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgeyBta0FwcCB9IGZyb20gXCIuLi9fYXBwXCJcblxuR3RrLmluaXQoKVxuXG4vLyBzdG9wIHRoaXMgZnJvbSBsZWFraW5nIGludG8gc3VicHJvY2Vzc2VzXG4vLyBhbmQgZ2lvIGxhdW5jaCBpbnZvY2F0aW9uc1xuR0xpYi51bnNldGVudihcIkxEX1BSRUxPQURcIilcblxuLy8gdXNlcnMgbWlnaHQgd2FudCB0byB1c2UgQWR3YWl0YSBpbiB3aGljaCBjYXNlIGl0IGhhcyB0byBiZSBpbml0aWFsaXplZFxuLy8gaXQgbWlnaHQgYmUgY29tbW9uIHBpdGZhbGwgdG8gZm9yZ2V0IGl0IGJlY2F1c2UgYEFwcGAgaXMgbm90IGBBZHcuQXBwbGljYXRpb25gXG5hd2FpdCBpbXBvcnQoXCJnaTovL0Fkdz92ZXJzaW9uPTFcIilcbiAgICAudGhlbigoeyBkZWZhdWx0OiBBZHcgfSkgPT4gQWR3LmluaXQoKSlcbiAgICAuY2F0Y2goKCkgPT4gdm9pZCAwKVxuXG5leHBvcnQgZGVmYXVsdCBta0FwcChBc3RhbC5BcHBsaWNhdGlvbilcbiIsICIvKipcbiAqIFdvcmthcm91bmQgZm9yIFwiQ2FuJ3QgY29udmVydCBub24tbnVsbCBwb2ludGVyIHRvIEpTIHZhbHVlIFwiXG4gKi9cblxuZXhwb3J0IHsgfVxuXG5jb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuYXN5bmMgZnVuY3Rpb24gc3VwcHJlc3M8VD4obW9kOiBQcm9taXNlPHsgZGVmYXVsdDogVCB9PiwgcGF0Y2g6IChtOiBUKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIG1vZC50aGVuKG0gPT4gcGF0Y2gobS5kZWZhdWx0KSkuY2F0Y2goKCkgPT4gdm9pZCAwKVxufVxuXG5mdW5jdGlvbiBwYXRjaDxQIGV4dGVuZHMgb2JqZWN0Pihwcm90bzogUCwgcHJvcDogRXh0cmFjdDxrZXlvZiBQLCBzdHJpbmc+KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCBwcm9wLCB7XG4gICAgICAgIGdldCgpIHsgcmV0dXJuIHRoaXNbYGdldF8ke3NuYWtlaWZ5KHByb3ApfWBdKCkgfSxcbiAgICB9KVxufVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQXBwc1wiKSwgKHsgQXBwcywgQXBwbGljYXRpb24gfSkgPT4ge1xuICAgIHBhdGNoKEFwcHMucHJvdG90eXBlLCBcImxpc3RcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwia2V5d29yZHNcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwiY2F0ZWdvcmllc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIiksICh7IFVQb3dlciB9KSA9PiB7XG4gICAgcGF0Y2goVVBvd2VyLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQmx1ZXRvb3RoXCIpLCAoeyBBZGFwdGVyLCBCbHVldG9vdGgsIERldmljZSB9KSA9PiB7XG4gICAgcGF0Y2goQWRhcHRlci5wcm90b3R5cGUsIFwidXVpZHNcIilcbiAgICBwYXRjaChCbHVldG9vdGgucHJvdG90eXBlLCBcImFkYXB0ZXJzXCIpXG4gICAgcGF0Y2goQmx1ZXRvb3RoLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goRGV2aWNlLnByb3RvdHlwZSwgXCJ1dWlkc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEh5cHJsYW5kXCIpLCAoeyBIeXBybGFuZCwgTW9uaXRvciwgV29ya3NwYWNlIH0pID0+IHtcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwiYmluZHNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwibW9uaXRvcnNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwid29ya3NwYWNlc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJjbGllbnRzXCIpXG4gICAgcGF0Y2goTW9uaXRvci5wcm90b3R5cGUsIFwiYXZhaWxhYmxlTW9kZXNcIilcbiAgICBwYXRjaChNb25pdG9yLnByb3RvdHlwZSwgXCJhdmFpbGFibGVfbW9kZXNcIilcbiAgICBwYXRjaChXb3Jrc3BhY2UucHJvdG90eXBlLCBcImNsaWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxNcHJpc1wiKSwgKHsgTXByaXMsIFBsYXllciB9KSA9PiB7XG4gICAgcGF0Y2goTXByaXMucHJvdG90eXBlLCBcInBsYXllcnNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZF91cmlfc2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkVXJpU2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkX21pbWVfdHlwZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZE1pbWVUeXBlc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwiY29tbWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxOZXR3b3JrXCIpLCAoeyBXaWZpIH0pID0+IHtcbiAgICBwYXRjaChXaWZpLnByb3RvdHlwZSwgXCJhY2Nlc3NfcG9pbnRzXCIpXG4gICAgcGF0Y2goV2lmaS5wcm90b3R5cGUsIFwiYWNjZXNzUG9pbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTm90aWZkXCIpLCAoeyBOb3RpZmQsIE5vdGlmaWNhdGlvbiB9KSA9PiB7XG4gICAgcGF0Y2goTm90aWZkLnByb3RvdHlwZSwgXCJub3RpZmljYXRpb25zXCIpXG4gICAgcGF0Y2goTm90aWZpY2F0aW9uLnByb3RvdHlwZSwgXCJhY3Rpb25zXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsUG93ZXJQcm9maWxlc1wiKSwgKHsgUG93ZXJQcm9maWxlcyB9KSA9PiB7XG4gICAgcGF0Y2goUG93ZXJQcm9maWxlcy5wcm90b3R5cGUsIFwiYWN0aW9uc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbFdwXCIpLCAoeyBXcCwgQXVkaW8sIFZpZGVvIH0pID0+IHtcbiAgICBwYXRjaChXcC5wcm90b3R5cGUsIFwiZW5kcG9pbnRzXCIpXG4gICAgcGF0Y2goV3AucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3RyZWFtc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJyZWNvcmRlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwibWljcm9waG9uZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3BlYWtlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzdHJlYW1zXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInJlY29yZGVyc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzaW5rc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzb3VyY2VzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcImRldmljZXNcIilcbn0pXG4iLCAiaW1wb3J0IFwiLi9vdmVycmlkZXMuanNcIlxuaW1wb3J0IHsgc2V0Q29uc29sZUxvZ0RvbWFpbiB9IGZyb20gXCJjb25zb2xlXCJcbmltcG9ydCB7IGV4aXQsIHByb2dyYW1BcmdzIH0gZnJvbSBcInN5c3RlbVwiXG5pbXBvcnQgSU8gZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcbmltcG9ydCB0eXBlIEFzdGFsMyBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgdHlwZSBBc3RhbDQgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuXG50eXBlIENvbmZpZyA9IFBhcnRpYWw8e1xuICAgIGluc3RhbmNlTmFtZTogc3RyaW5nXG4gICAgY3NzOiBzdHJpbmdcbiAgICBpY29uczogc3RyaW5nXG4gICAgZ3RrVGhlbWU6IHN0cmluZ1xuICAgIGljb25UaGVtZTogc3RyaW5nXG4gICAgY3Vyc29yVGhlbWU6IHN0cmluZ1xuICAgIGhvbGQ6IGJvb2xlYW5cbiAgICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0OiBzdHJpbmcsIHJlczogKHJlc3BvbnNlOiBhbnkpID0+IHZvaWQpOiB2b2lkXG4gICAgbWFpbiguLi5hcmdzOiBzdHJpbmdbXSk6IHZvaWRcbiAgICBjbGllbnQobWVzc2FnZTogKG1zZzogc3RyaW5nKSA9PiBzdHJpbmcsIC4uLmFyZ3M6IHN0cmluZ1tdKTogdm9pZFxufT5cblxuaW50ZXJmYWNlIEFzdGFsM0pTIGV4dGVuZHMgQXN0YWwzLkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyOiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldD86IGJvb2xlYW4pOiB2b2lkXG4gICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZFxuICAgIHN0YXJ0KGNvbmZpZz86IENvbmZpZyk6IHZvaWRcbn1cblxuaW50ZXJmYWNlIEFzdGFsNEpTIGV4dGVuZHMgQXN0YWw0LkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyPzogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cbiAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQ/OiBib29sZWFuKTogdm9pZFxuICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWRcbiAgICBzdGFydChjb25maWc/OiBDb25maWcpOiB2b2lkXG59XG5cbnR5cGUgQXBwMyA9IHR5cGVvZiBBc3RhbDMuQXBwbGljYXRpb25cbnR5cGUgQXBwNCA9IHR5cGVvZiBBc3RhbDQuQXBwbGljYXRpb25cblxuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwPEFwcCBleHRlbmRzIEFwcDM+KEFwcDogQXBwKTogQXN0YWwzSlNcbmV4cG9ydCBmdW5jdGlvbiBta0FwcDxBcHAgZXh0ZW5kcyBBcHA0PihBcHA6IEFwcCk6IEFzdGFsNEpTXG5cbmV4cG9ydCBmdW5jdGlvbiBta0FwcChBcHA6IEFwcDMgfCBBcHA0KSB7XG4gICAgcmV0dXJuIG5ldyAoY2xhc3MgQXN0YWxKUyBleHRlbmRzIEFwcCB7XG4gICAgICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJBc3RhbEpTXCIgfSwgdGhpcyBhcyBhbnkpIH1cblxuICAgICAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm4gPSBGdW5jdGlvbihgcmV0dXJuIChhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICR7Ym9keS5pbmNsdWRlcyhcIjtcIikgPyBib2R5IDogYHJldHVybiAke2JvZHl9O2B9XG4gICAgICAgICAgICAgICAgICAgIH0pYClcbiAgICAgICAgICAgICAgICAgICAgZm4oKSgpLnRoZW4ocmVzKS5jYXRjaChyZWopXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqKGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXF1ZXN0SGFuZGxlcj86IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG5cbiAgICAgICAgdmZ1bmNfcmVxdWVzdChtc2c6IHN0cmluZywgY29ubjogR2lvLlNvY2tldENvbm5lY3Rpb24pOiB2b2lkIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5yZXF1ZXN0SGFuZGxlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXF1ZXN0SGFuZGxlcihtc2csIChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrKGNvbm4sIFN0cmluZyhyZXNwb25zZSksIChfLCByZXMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrX2ZpbmlzaChyZXMpLFxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3VwZXIudmZ1bmNfcmVxdWVzdChtc2csIGNvbm4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQgPSBmYWxzZSkge1xuICAgICAgICAgICAgc3VwZXIuYXBwbHlfY3NzKHN0eWxlLCByZXNldClcbiAgICAgICAgfVxuXG4gICAgICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWQge1xuICAgICAgICAgICAgc3VwZXIucXVpdCgpXG4gICAgICAgICAgICBleGl0KGNvZGUgPz8gMClcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXJ0KHsgcmVxdWVzdEhhbmRsZXIsIGNzcywgaG9sZCwgbWFpbiwgY2xpZW50LCBpY29ucywgLi4uY2ZnIH06IENvbmZpZyA9IHt9KSB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSB0aGlzIGFzIHVua25vd24gYXMgSW5zdGFuY2VUeXBlPEFwcDMgfCBBcHA0PlxuXG4gICAgICAgICAgICBjbGllbnQgPz89ICgpID0+IHtcbiAgICAgICAgICAgICAgICBwcmludChgQXN0YWwgaW5zdGFuY2UgXCIke2FwcC5pbnN0YW5jZU5hbWV9XCIgYWxyZWFkeSBydW5uaW5nYClcbiAgICAgICAgICAgICAgICBleGl0KDEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgY2ZnKVxuICAgICAgICAgICAgc2V0Q29uc29sZUxvZ0RvbWFpbihhcHAuaW5zdGFuY2VOYW1lKVxuXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RIYW5kbGVyID0gcmVxdWVzdEhhbmRsZXJcbiAgICAgICAgICAgIGFwcC5jb25uZWN0KFwiYWN0aXZhdGVcIiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIG1haW4/LiguLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXBwLmFjcXVpcmVfc29ja2V0KClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudChtc2cgPT4gSU8uc2VuZF9yZXF1ZXN0KGFwcC5pbnN0YW5jZU5hbWUsIG1zZykhLCAuLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGx5X2Nzcyhjc3MsIGZhbHNlKVxuXG4gICAgICAgICAgICBpZiAoaWNvbnMpXG4gICAgICAgICAgICAgICAgYXBwLmFkZF9pY29ucyhpY29ucylcblxuICAgICAgICAgICAgaG9sZCA/Pz0gdHJ1ZVxuICAgICAgICAgICAgaWYgKGhvbGQpXG4gICAgICAgICAgICAgICAgYXBwLmhvbGQoKVxuXG4gICAgICAgICAgICBhcHAucnVuQXN5bmMoW10pXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSwgdHlwZSBDb25zdHJ1Y3RQcm9wcyB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZnVuY3Rpb24gZmlsdGVyKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIHJldHVybiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG59XG5cbi8vIEJveFxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLkJveC5wcm90b3R5cGUsIFwiY2hpbGRyZW5cIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9jaGlsZHJlbih2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5Cb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IEJveCA9IGFzdGFsaWZ5PEFzdGFsLkJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLkJveCwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIHNlbGYuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikgeyByZXR1cm4gc2VsZi5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfSxcbn0pXG5cbi8vIEJ1dHRvblxudHlwZSBCdXR0b25TaWduYWxzID0ge1xuICAgIG9uQ2xpY2tlZDogW11cbn1cblxuZXhwb3J0IHR5cGUgQnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuQnV0dG9uLCBHdGsuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIEJ1dHRvblNpZ25hbHM+XG5leHBvcnQgY29uc3QgQnV0dG9uID0gYXN0YWxpZnk8R3RrLkJ1dHRvbiwgR3RrLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCBCdXR0b25TaWduYWxzPihHdGsuQnV0dG9uKVxuXG4vLyBDZW50ZXJCb3hcbmV4cG9ydCB0eXBlIENlbnRlckJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkNlbnRlckJveCwgR3RrLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IENlbnRlckJveCA9IGFzdGFsaWZ5PEd0ay5DZW50ZXJCb3gsIEd0ay5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz4oR3RrLkNlbnRlckJveCwge1xuICAgIGdldENoaWxkcmVuKGJveCkge1xuICAgICAgICByZXR1cm4gW2JveC5zdGFydFdpZGdldCwgYm94LmNlbnRlcldpZGdldCwgYm94LmVuZFdpZGdldF1cbiAgICB9LFxuICAgIHNldENoaWxkcmVuKGJveCwgY2hpbGRyZW4pIHtcbiAgICAgICAgY29uc3QgY2ggPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIGJveC5zdGFydFdpZGdldCA9IGNoWzBdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIGJveC5jZW50ZXJXaWRnZXQgPSBjaFsxXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICBib3guZW5kV2lkZ2V0ID0gY2hbMl0gfHwgbmV3IEd0ay5Cb3hcbiAgICB9LFxufSlcblxuLy8gVE9ETzogQ2lyY3VsYXJQcm9ncmVzc1xuLy8gVE9ETzogRHJhd2luZ0FyZWFcblxuLy8gRW50cnlcbnR5cGUgRW50cnlTaWduYWxzID0ge1xuICAgIG9uQWN0aXZhdGU6IFtdXG4gICAgb25Ob3RpZnlUZXh0OiBbXVxufVxuXG5leHBvcnQgdHlwZSBFbnRyeVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPlxuZXhwb3J0IGNvbnN0IEVudHJ5ID0gYXN0YWxpZnk8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPihHdGsuRW50cnksIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBJbWFnZVxuZXhwb3J0IHR5cGUgSW1hZ2VQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5JbWFnZSwgR3RrLkltYWdlLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgSW1hZ2UgPSBhc3RhbGlmeTxHdGsuSW1hZ2UsIEd0ay5JbWFnZS5Db25zdHJ1Y3RvclByb3BzPihHdGsuSW1hZ2UsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBMYWJlbFxuZXhwb3J0IHR5cGUgTGFiZWxQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5MYWJlbCwgR3RrLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTGFiZWwgPSBhc3RhbGlmeTxHdGsuTGFiZWwsIEd0ay5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPihHdGsuTGFiZWwsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHsgc2VsZi5sYWJlbCA9IFN0cmluZyhjaGlsZHJlbikgfSxcbn0pXG5cbi8vIExldmVsQmFyXG5leHBvcnQgdHlwZSBMZXZlbEJhclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkxldmVsQmFyLCBHdGsuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBMZXZlbEJhciA9IGFzdGFsaWZ5PEd0ay5MZXZlbEJhciwgR3RrLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5MZXZlbEJhciwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFRPRE86IExpc3RCb3hcblxuLy8gT3ZlcmxheVxuZXhwb3J0IHR5cGUgT3ZlcmxheVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk92ZXJsYXksIEd0ay5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgT3ZlcmxheSA9IGFzdGFsaWZ5PEd0ay5PdmVybGF5LCBHdGsuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPihHdGsuT3ZlcmxheSwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHtcbiAgICAgICAgY29uc3QgY2hpbGRyZW46IEFycmF5PEd0ay5XaWRnZXQ+ID0gW11cbiAgICAgICAgbGV0IGNoID0gc2VsZi5nZXRfZmlyc3RfY2hpbGQoKVxuICAgICAgICB3aGlsZSAoY2ggIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgICAgICBjaCA9IGNoLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNoaWxkcmVuLmZpbHRlcihjaCA9PiBjaCAhPT0gc2VsZi5jaGlsZClcbiAgICB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgY29uc3QgdHlwZXMgPSB0eXBlIGluIGNoaWxkXG4gICAgICAgICAgICAgICAgPyAoY2hpbGRbdHlwZV0gYXMgc3RyaW5nKS5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgICAgICAgOiBbXVxuXG4gICAgICAgICAgICBpZiAodHlwZXMuaW5jbHVkZXMoXCJvdmVybGF5XCIpKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfb3ZlcmxheShjaGlsZClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNlbGYuc2V0X21lYXN1cmVfb3ZlcmxheShjaGlsZCwgdHlwZXMuaW5jbHVkZXMoXCJtZWFzdXJlXCIpKVxuICAgICAgICAgICAgc2VsZi5zZXRfY2xpcF9vdmVybGF5KGNoaWxkLCB0eXBlcy5pbmNsdWRlcyhcImNsaXBcIikpXG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gUmV2ZWFsZXJcbmV4cG9ydCB0eXBlIFJldmVhbGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuUmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFJldmVhbGVyID0gYXN0YWxpZnk8R3RrLlJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlJldmVhbGVyKVxuXG4vLyBTbGlkZXJcbnR5cGUgU2xpZGVyU2lnbmFscyA9IHtcbiAgICBvbkNoYW5nZVZhbHVlOiBbXVxufVxuXG5leHBvcnQgdHlwZSBTbGlkZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLlNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIFNsaWRlclNpZ25hbHM+XG5leHBvcnQgY29uc3QgU2xpZGVyID0gYXN0YWxpZnk8QXN0YWwuU2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywgU2xpZGVyU2lnbmFscz4oQXN0YWwuU2xpZGVyLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gU3RhY2tcbmV4cG9ydCB0eXBlIFN0YWNrUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuU3RhY2ssIEd0ay5TdGFjay5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN0YWNrID0gYXN0YWxpZnk8R3RrLlN0YWNrLCBHdGsuU3RhY2suQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN0YWNrLCB7XG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQubmFtZSAhPSBcIlwiICYmIGNoaWxkLm5hbWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX25hbWVkKGNoaWxkLCBjaGlsZC5uYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBTd2l0Y2hcbmV4cG9ydCB0eXBlIFN3aXRjaFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN3aXRjaCA9IGFzdGFsaWZ5PEd0ay5Td2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN3aXRjaCwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFdpbmRvd1xuZXhwb3J0IHR5cGUgV2luZG93UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5XaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFdpbmRvdyA9IGFzdGFsaWZ5PEFzdGFsLldpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLldpbmRvdylcblxuLy8gTWVudUJ1dHRvblxuZXhwb3J0IHR5cGUgTWVudUJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTWVudUJ1dHRvbiA9IGFzdGFsaWZ5PEd0ay5NZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPihHdGsuTWVudUJ1dHRvbiwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIFtzZWxmLnBvcG92ZXIsIHNlbGYuY2hpbGRdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBHdGsuUG9wb3Zlcikge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X3BvcG92ZXIoY2hpbGQpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFBvcG9wZXJcbmV4cG9ydCB0eXBlIFBvcG92ZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5Qb3BvdmVyLCBHdGsuUG9wb3Zlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFBvcG92ZXIgPSBhc3RhbGlmeTxHdGsuUG9wb3ZlciwgR3RrLlBvcG92ZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlBvcG92ZXIpXG4iLCAiLy8ga29iZWwtc2hlbGwgZW50cnkgXHUyMDE0IEFHUyB2MiAvIGFzdGFsNFxuaW1wb3J0IHsgQXBwIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuLy8gYXN0YWwgYGNvbnN0cnVjdGAgc2V0cyBzdGF0aWMgcHJvcHMgdmlhIE9iamVjdC5hc3NpZ24od2lkZ2V0LCBwcm9wcykgYW5kIGJpbmRpbmdzIHZpYVxuLy8gc2V0UHJvcCBcdTIxOTIgc2V0X2NsYXNzLiBHdGtXaWRnZXQgaGFzIG5laXRoZXIgYSBgY2xhc3NgIEdPYmplY3QgcHJvcCBub3Igc2V0X2NsYXNzLCBzb1xuLy8gYGNsYXNzPVwiLi4uXCJgIHNpbGVudGx5IG5vLW9wcyAodGhlIHJlYWwgcHJvcCBpcyBgY3NzLWNsYXNzZXNgLCBhbiBhcnJheSkuIERlZmluZSBhXG4vLyBgY2xhc3NgIGFjY2Vzc29yIHJvdXRpbmcgQk9USCBwYXRocyB0byBzZXRfY3NzX2NsYXNzZXMsIHNvIGBjbGFzcz1cImEgYlwiYCB3b3Jrcy5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0eSgoR3RrLldpZGdldCBhcyBhbnkpLnByb3RvdHlwZSwgXCJjbGFzc1wiLCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIHNldCh2OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKVxuICAgIH0sXG4gICAgZ2V0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRfY3NzX2NsYXNzZXMoKS5qb2luKFwiIFwiKVxuICAgIH0sXG59KVxuOyhHdGsuV2lkZ2V0LnByb3RvdHlwZSBhcyBhbnkpLnNldF9jbGFzcyA9IGZ1bmN0aW9uICh2OiBzdHJpbmcpIHtcbiAgICB0aGlzLnNldF9jc3NfY2xhc3NlcyhTdHJpbmcodikuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbikpXG59XG5pbXBvcnQgc3R5bGUgZnJvbSBcIi4vc3R5bGUvbWFpbi5zY3NzXCJcbmltcG9ydCB7IHRva2VuQ3NzLCB0b2tlbnMgfSBmcm9tIFwiLi9jb25maWdcIlxuaW1wb3J0ICogYXMgZ25vYmxpbiBmcm9tIFwiLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCAqIGFzIG5vdGlmZFN2YyBmcm9tIFwiLi9zZXJ2aWNlcy9ub3RpZmRcIlxuaW1wb3J0IHsgYXJtRHVtcCB9IGZyb20gXCIuL2xpYi9pbnNwZWN0XCJcbmltcG9ydCB7IHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IEJhciBmcm9tIFwiLi93aWRnZXQvQmFyXCJcbmltcG9ydCBEb2NrIGZyb20gXCIuL3dpZGdldC9Eb2NrXCJcbmltcG9ydCBMYXVuY2hlciBmcm9tIFwiLi93aWRnZXQvTGF1bmNoZXJcIlxuaW1wb3J0IFF1aWNrU2V0dGluZ3MgZnJvbSBcIi4vd2lkZ2V0L1F1aWNrU2V0dGluZ3NcIlxuaW1wb3J0IENhbGVuZGFyIGZyb20gXCIuL3dpZGdldC9DYWxlbmRhclwiXG5pbXBvcnQgeyBUb2FzdHMsIERyYXdlciB9IGZyb20gXCIuL3dpZGdldC9Ob3RpZmljYXRpb25zXCJcbmltcG9ydCBPU0QgZnJvbSBcIi4vd2lkZ2V0L09TRFwiXG5pbXBvcnQgU2Vzc2lvbiBmcm9tIFwiLi93aWRnZXQvU2Vzc2lvblwiXG5cbnByaW50ZXJyKFwiS09CRUw6IG1vZHVsZSB0b3AgcmVhY2hlZFwiKVxuXG4vLyBDdXN0b20gaWNvbiBzZXQgXHUyMDE0IHRoZSBleGFjdCBIZXJvaWNvbnMvTHVjaWRlL1RhYmxlciB0aGUgcHJvdG90eXBlIHVzZXMsIGFzXG4vLyByZWNvbG9yYWJsZSBzeW1ib2xpYyBTVkdzLiBSZWdpc3RlcmVkIG9uIHRoZSBkZWZhdWx0IGljb24gdGhlbWUgc28gaWNvbk5hbWVcbi8vIFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIGV0Yy4gcmVzb2x2ZS4gUGF0aCBvdmVycmlkZSB2aWEgS09CRUxfSUNPTlMgZm9yIHRoZSBkZXZraXQuXG5pbXBvcnQgR0xpYkljb25zIGZyb20gXCJnaTovL0dMaWJcIlxuY29uc3QgSUNPTl9ESVIgPVxuICAgIEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKSA/P1xuICAgIEdMaWJJY29ucy5idWlsZF9maWxlbmFtZXYoW0dMaWJJY29ucy5nZXRfY3VycmVudF9kaXIoKSwgXCJpY29uc1wiXSlcblxuQXBwLnN0YXJ0KHtcbiAgICBpbnN0YW5jZU5hbWU6IFwia29iZWxcIixcbiAgICBpY29uczogSUNPTl9ESVIsXG4gICAgbWFpbigpIHtcbiAgICAgICAgZ25vYmxpbi5pbml0KClcbiAgICAgICAgbm90aWZkU3ZjLmluaXQoKVxuICAgICAgICAvLyBMb2FkIG91ciBzdHlsZXNoZWV0IGF0IFVTRVIgcHJpb3JpdHkgKGhpZ2hlc3QpIHNvIGl0IGJlYXRzIEFkd2FpdGEncyB0aGVtZVxuICAgICAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgICAgICAvLyBgc2NhbGUgPiB0cm91Z2hgIChmYXQgc2xpZGVycykuIFRoaXMgcHJvdmlkZXIgaXMgYXV0aG9yaXRhdGl2ZS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHByb3YgPSBuZXcgR3RrLkNzc1Byb3ZpZGVyKClcbiAgICAgICAgICAgIHByb3YubG9hZF9mcm9tX3N0cmluZyhzdHlsZSArIHRva2VuQ3NzKHRva2VucykpXG4gICAgICAgICAgICBHdGsuU3R5bGVDb250ZXh0LmFkZF9wcm92aWRlcl9mb3JfZGlzcGxheShcbiAgICAgICAgICAgICAgICBHZGsuRGlzcGxheS5nZXRfZGVmYXVsdCgpISxcbiAgICAgICAgICAgICAgICBwcm92LFxuICAgICAgICAgICAgICAgIDgwMCAvKiBVU0VSIHByaW9yaXR5ICovXG4gICAgICAgICAgICApXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApXG4gICAgICAgIH1cbiAgICAgICAgLy8gYXN0YWw0IEpTWCA8d2luZG93PiBpcyBjcmVhdGVkIGhpZGRlbiAodmlzaWJsZT1mYWxzZSkuIFBlcnNpc3RlbnQgY2hyb21lIG11c3RcbiAgICAgICAgLy8gYmUgcHJlc2VudCgpZWQ7IG9uLWRlbWFuZCBzdXJmYWNlcyBzdGF5IGhpZGRlbiBhbmQgYXJlIHNob3duIGJ5IHRvZ2dsZV93aW5kb3cuXG4gICAgICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHcgPSBmbigpXG4gICAgICAgICAgICAgICAgaWYgKHcgJiYgdHlwZW9mIHcucHJlc2VudCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgICAgIEFwcC5hZGRfd2luZG93Py4odylcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogJHtuYW1lfSBGQUlMRUQ6ICR7ZX1cXG4keyhlIGFzIGFueSk/LnN0YWNrID8/IFwiXCJ9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBtb25pdG9ycyA9IEFwcC5nZXRfbW9uaXRvcnMoKVxuICAgICAgICBjb25zdCB0YXJnZXRzID0gbW9uaXRvcnMubGVuZ3RoID8gbW9uaXRvcnMgOiBbdW5kZWZpbmVkIGFzIGFueV1cbiAgICAgICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgICAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgICAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgICAgIH1cbiAgICAgICAgbWFrZShcImxhdW5jaGVyXCIsICgpID0+IExhdW5jaGVyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwiY2FsZW5kYXJcIiwgKCkgPT4gQ2FsZW5kYXIoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJkcmF3ZXJcIiwgKCkgPT4gRHJhd2VyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgICAgICAvLyBLT0JFTF9EVU1QPTx3aW5kb3c+OiBkdW1wIHRoZSBsaXZlIEdUSyBnZW9tZXRyeSB0cmVlIGZvciBET00tdnMtR1RLIGRpZmZpbmcuXG4gICAgICAgIGFybUR1bXAoKG5hbWUpID0+IEFwcC5nZXRfd2luZG93KG5hbWUpIGFzIGFueSlcbiAgICB9LFxuICAgIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICAgIHJlcXVlc3RIYW5kbGVyKHJlcXVlc3QsIHJlcykge1xuICAgICAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICAgICAgaWYgKGNtZCA9PT0gXCJ0b2dnbGVcIikge1xuICAgICAgICAgICAgc3VyZmFjZVRvZ2dsZShhcmcpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kID09PSBcInJlbG9hZC1jc3NcIikge1xuICAgICAgICAgICAgQXBwLmFwcGx5X2NzcyhzdHlsZSArIHRva2VuQ3NzKHRva2VucyksIHRydWUpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICByZXMoXCJ1bmtub3duXCIpXG4gICAgfSxcbn0pXG4iLCAiQGNoYXJzZXQgXCJVVEYtOFwiO1xud2luZG93IHtcbiAgZm9udC1mYW1pbHk6IFwiSW50ZXJcIiwgXCJJbnRlciBWYXJpYWJsZVwiLCBcIkludGVyVmFyaWFibGVcIiwgc2Fucy1zZXJpZjtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLnRuIHtcbiAgZm9udC1mZWF0dXJlLXNldHRpbmdzOiBcInRudW1cIjtcbn1cblxud2luZG93IHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbmJ1dHRvbiB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zLCBjb2xvciAxNjBtcztcbn1cblxuaW1hZ2Uge1xuICAtZ3RrLWljb24tc3R5bGU6IHJlZ3VsYXI7XG59XG5cbi5iYXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiAwIDdweDtcbiAgbWluLWhlaWdodDogNDJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50aXRsZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luOiAwIDlweDtcbn1cbi5iYXIgLmNsb2NrIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmJhciAuZGF0ZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLmlidG4ge1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAuaWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuaWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmJhciAuYmNlbnRlciB7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uYmFyIC5iY2VudGVyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1cyB7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDAgMTNweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uYmFyIC5zdGF0dXM6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLmJhciAuc3RhdHVzIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuc3RhdHVzIC5wY3QgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5iYXIgLnN0YXR1cyBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjAwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLnN0YXR1cy5lcnIgLm5ldC1pY29uIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG4uYmFyIC5iYWRnZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogMCAzcHg7XG4gIG1hcmdpbjogMnB4O1xuICBtaW4taGVpZ2h0OiAxNHB4O1xuICBtaW4td2lkdGg6IDE0cHg7XG59XG4uYmFyIC50cmF5LWljb24ge1xuICBtaW4td2lkdGg6IDI4cHg7XG59XG4uYmFyIC50cmF5LWljb24gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50cmF5LWxhbmcge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwIDhweDtcbiAgbWluLXdpZHRoOiAwO1xufVxuXG4uZG9jayB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIHBhZGRpbmc6IDVweDtcbiAgYm9yZGVyLXJhZGl1czogMTZweDtcbn1cbi5kb2NrIC5kYnRuIHtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5kb2NrIC5pY29uLXRpbGUge1xuICBtaW4td2lkdGg6IDMwcHg7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAxNjBtcztcbn1cbi5kb2NrIC5kYnRuOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLmRvY2sgLnBsYWNlaG9sZGVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5kb2NrIC5kb3RzIHtcbiAgbWFyZ2luLWJvdHRvbTogM3B4O1xufVxuLmRvY2sgLmRvdCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1pbi13aWR0aDogNHB4O1xuICBtaW4taGVpZ2h0OiA0cHg7XG4gIHRyYW5zaXRpb246IG1pbi13aWR0aCAyNjBtcyBjdWJpYy1iZXppZXIoMC4yNCwgMS4zNiwgMC4zNSwgMSksIGJhY2tncm91bmQtY29sb3IgMjIwbXM7XG59XG4uZG9jayAuZG90Lm9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgbWluLXdpZHRoOiAxMnB4O1xufVxuLmRvY2sgLmRvdC5taW5pIHtcbiAgbWluLXdpZHRoOiAzcHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgb3BhY2l0eTogMC43O1xufVxuLmRvY2sgLnNlcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIG1pbi13aWR0aDogMXB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xuICBtYXJnaW46IDAgM3B4O1xufVxuLmRvY2sgLmR0aWxlIHtcbiAgbWluLXdpZHRoOiA0MnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuLmRvY2sgLmR3aWRnZXQgLmRnIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogNnB4O1xufVxuLmRvY2sgbGV2ZWxiYXIubXByb2cge1xuICBtaW4td2lkdGg6IDI1cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmRvY2sgbGV2ZWxiYXIubXByb2cgPiB0cm91Z2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMzUpO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG59XG4uZG9jayBsZXZlbGJhci5tcHJvZyA+IHRyb3VnaCA+IGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4uZG9jayBsZXZlbGJhci5tcHJvZyA+IHRyb3VnaCA+IGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG5cbi5zaGVldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDI0cHg7XG4gIHBhZGRpbmc6IDEycHg7XG4gIG1hcmdpbjogMzhweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xufVxuXG4ucXMge1xuICBtaW4td2lkdGg6IDMyOHB4O1xufSAvKiBtYXRjaGVzIHBhbmVsVygzNTIpXHUyMjEyMjQ7IG92ZXJyaWRkZW4gYnkgY29uZmlnLnRzIHRva2VuQ3NzIGF0IHJ1bnRpbWUgKi9cbi5xcy10b3Age1xuICBtYXJnaW4tYm90dG9tOiAxMnB4O1xuICBwYWRkaW5nOiAwIDJweDtcbn1cbi5xcy10b3AgLm1ldGEge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucXMtdG9wIC5tZXRhIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4ucXMtdG9wIC5yYnRuIHtcbiAgcGFkZGluZzogOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luLWxlZnQ6IDdweDtcbn1cbi5xcy10b3AgLnJidG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5xcy10b3AgLnJidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5xcy10b3AgLnJidG4uZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4ucXMtdG9wIC5yYnRuLmxlYWYgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLmNoaXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLWhlaWdodDogNTRweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5jaGlwIC5jaGlwYiB7XG4gIHBhZGRpbmc6IDlweCA4cHggOXB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xufVxuLmNoaXAgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE3cHg7XG59XG4uY2hpcCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jaGlwIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIG1hcmdpbi10b3A6IDA7XG59XG4uY2hpcDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uY2hpcC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2hpcC5vbiBpbWFnZSB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gbGFiZWwge1xuICBjb2xvcjogIzE5MjAwMztcbn1cbi5jaGlwLm9uIC5zdWIge1xuICBjb2xvcjogIzMzM2QxNztcbn1cbi5jaGlwLm9uOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cbi5jaGlwLm9uIC5jaGV2IHtcbiAgY29sb3I6ICMxOTIwMDM7XG59XG4uY2hpcCAuY2hldiB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogMCA5OTlweCA5OTlweCAwO1xuICBjb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLWxlZnQ6IDFweCBzb2xpZCByZ2JhKDAsIDAsIDAsIDAuMTgpO1xufVxuLmNoaXAgLmNoZXYgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgY29sb3I6IGluaGVyaXQ7XG59XG4uY2hpcCAuY2hldjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4xNCk7XG59XG5cbi5jaGlwcyB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG5cbi5jaGlwcyA+IGJveDpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLXJpZ2h0OiAxcHg7XG59XG5cbi5jaGlwLWdyaWQge1xuICBtYXJnaW4tYm90dG9tOiAxMHB4O1xufVxuXG5zY2FsZSwgc2NhbGU6aG9yaXpvbnRhbCwgc2NhbGU6dmVydGljYWwge1xuICBtaW4taGVpZ2h0OiAwO1xuICBtaW4td2lkdGg6IDA7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogNnB4IDA7XG59XG5cbnNjYWxlID4gdHJvdWdoLCBzY2FsZTpob3Jpem9udGFsID4gdHJvdWdoLCBzY2FsZTp2ZXJ0aWNhbCA+IHRyb3VnaCB7XG4gIG1pbi1oZWlnaHQ6IDZweDtcbiAgbWluLXdpZHRoOiAwO1xuICBtYXJnaW46IDA7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IGhpZ2hsaWdodCxcbnNjYWxlID4gdHJvdWdoID4gcHJvZ3Jlc3Mge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IHNsaWRlciB7XG4gIG1pbi13aWR0aDogMTdweDtcbiAgbWluLWhlaWdodDogMTdweDtcbiAgbWFyZ2luOiAtNnB4OyAvKiBwcm90b3R5cGUga25vYiAxN1x1MDBENzE3ICovXG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3gtc2hhZG93OiAwIDFweCA0cHggcmdiYSgwLCAwLCAwLCAwLjUpO1xufVxuXG4uc3JvdyB7XG4gIHBhZGRpbmc6IDAgMnB4IDAgMnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuLnNyb3cgLnN2YWwge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtaW4td2lkdGg6IDMycHg7XG59XG5cbi5zcm93IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDAgLTEycHggMCAxMnB4O1xufVxuXG4uc3JvdyAuY2hldiB7XG4gIHBhZGRpbmc6IDZweCA4cHg7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uc3JvdyAuY2hldiBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4uc3JvdyAuY2hldjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG5cbi5nYmFubmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xuICBtYXJnaW4tYm90dG9tOiA4cHg7XG59XG4uZ2Jhbm5lciAudCB7XG4gIGNvbG9yOiAjZWRiYjY0O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5nYmFubmVyIC5zIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xufVxuLmdiYW5uZXIgaW1hZ2Uge1xuICBjb2xvcjogI2VkYmI2NDtcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG5cbi5nYnRuIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBwYWRkaW5nOiA3cHggMTJweDtcbn1cbi5nYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cblxuLmRoZWFkIHtcbiAgcGFkZGluZy1ib3R0b206IDEwcHg7XG59XG4uZGhlYWQgYnV0dG9uIHtcbiAgcGFkZGluZzogN3B4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmRoZWFkIGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmRoZWFkIGxhYmVsIHtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxNHB4O1xufVxuXG5zd2l0Y2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiA0NnB4O1xuICBtaW4taGVpZ2h0OiAyNnB4O1xufVxuc3dpdGNoOmNoZWNrZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuc3dpdGNoIHNsaWRlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4td2lkdGg6IDIwcHg7XG4gIG1pbi1oZWlnaHQ6IDIwcHg7XG59XG5cbi54cm93IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogOXB4IDExcHg7XG59XG4ueHJvdyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbn1cbi54cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnhyb3cgLnhzIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLnhyb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLnhyb3cuYWN0aXZlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgxMDYsIDE5NywgMTQzLCAwLjA4KTtcbn1cbi54cm93LmFjdGl2ZSBpbWFnZSB7XG4gIGNvbG9yOiAjYjVjYjQ4O1xufVxuLnhyb3cuYWN0aXZlIC54cyB7XG4gIGNvbG9yOiAjYjVjYjQ4O1xufVxuXG4ubWl4cm93IHtcbiAgcGFkZGluZzogNHB4IDJweDtcbiAgbWluLWhlaWdodDogNDBweDtcbn1cbi5taXhyb3cgLm1pIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA2cHg7XG59XG4ubWl4cm93IC5taSBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5taXhyb3cgLm1uYW1lIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWluLXdpZHRoOiA3MnB4O1xufVxuXG4uc2hlZXQubGF1bmNoZXIge1xuICBtaW4td2lkdGg6IDU2OHB4O1xufVxuXG4ubGF1bmNoZXIge1xuICBwYWRkaW5nOiA4cHg7XG59XG5cbi5maWVsZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDNweCAxMnB4O1xuICBtYXJnaW4tYm90dG9tOiA2cHg7XG59XG4uZmllbGQgaW1hZ2Uge1xuICBjb2xvcjogIzhkODY5MztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4uZmllbGQgZW50cnkge1xuICBiYWNrZ3JvdW5kOiBub25lO1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDE0LjVweDtcbiAgY2FyZXQtY29sb3I6ICNiNWNiNDg7XG4gIHBhZGRpbmc6IDhweCAwO1xuICBtaW4taGVpZ2h0OiAwO1xuICBtaW4td2lkdGg6IDA7XG59XG4uZmllbGQgZW50cnkgdGV4dCB7XG4gIG1pbi1oZWlnaHQ6IDA7XG59XG4uZmllbGQgLmxwbGFjZWhvbGRlciB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDE0LjVweDtcbn1cbi5maWVsZCAuZ2hvc3Qge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxNC41cHg7XG59XG4uZmllbGQgLmtiZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBib3JkZXItcmFkaXVzOiA1cHg7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBwYWRkaW5nOiAzcHggN3B4O1xufVxuXG4udGlsZXMge1xuICBwYWRkaW5nOiA4cHggMnB4IDEwcHg7XG59XG5cbi50aWxlIHtcbiAgcGFkZGluZzogNXB4IDA7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIG1pbi13aWR0aDogNjRweDtcbiAgbWF4LXdpZHRoOiA2NHB4O1xufVxuLnRpbGUgLmljb24tdGlsZSB7XG4gIG1pbi13aWR0aDogMDtcbiAgbWluLWhlaWdodDogMDtcbiAgcGFkZGluZzogNnB4O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zO1xufVxuLnRpbGUgbGFiZWwge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG59XG4udGlsZTpob3ZlciAuaWNvbi10aWxlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgyNTUsIDI1NSwgMjU1LCAwLjA5KTtcbn1cbi50aWxlOmhvdmVyIGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG5cbi5sZm9vdCB7XG4gIHBhZGRpbmc6IDdweCAxMHB4IDNweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTFweDtcbn1cbi5sZm9vdCBiIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG5cbi5sd2lkZ2V0cyB7XG4gIHBhZGRpbmc6IDAgMnB4IDZweDtcbn1cblxuLndpZGdldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDEwcHggMTJweDtcbn1cbi53aWRnZXQgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4ud2lkZ2V0IC5oaW50IHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cblxuLmx3bSAubHdhcnQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIG1pbi13aWR0aDogMzRweDtcbiAgbWluLWhlaWdodDogMzRweDtcbn1cbi5sd20gLmx3YXJ0IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmx3bSAubWJ0biB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIG1pbi13aWR0aDogMjlweDtcbiAgbWluLWhlaWdodDogMjlweDtcbn1cbi5sd20gLm1idG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5sd20gLm1idG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG4ubHJvd3Mge1xuICBwYWRkaW5nOiA0cHggMnB4O1xufVxuXG4uc2VjIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTBweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgcGFkZGluZzogOHB4IDEwcHggMnB4O1xufVxuXG4ucm93IHtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgcGFkZGluZzogN3B4IDEwcHg7XG59XG4ucm93IC5yaSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogMnB4O1xufVxuLnJvdyBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAyNHB4O1xufVxuLnJvdyBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTNweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5yb3cgLmhpbnQge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG59XG4ucm93IC5ydW5rIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzMyMmUzOTtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDZweDtcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIHBhZGRpbmc6IDJweCA3cHg7XG59XG4ucm93OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5yb3cuc2VsIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuLmNhbCB7XG4gIG1pbi13aWR0aDogMzA5cHg7XG59XG4uY2FsIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG59XG4uY2FsIC5oZXJvIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTlweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5jYWwgLmNhbGhlcm8ge1xuICBwYWRkaW5nOiA0cHggOHB4IDhweDtcbn1cbi5jYWwgLmNhbC1ncmlkIHtcbiAgbWFyZ2luLXRvcDogOHB4O1xufVxuLmNhbCAubW9udGgge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxM3B4O1xufVxuLmNhbCAubW9udGg6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b24ge1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbiBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jYWwgLmRvdyB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDkuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBwYWRkaW5nOiAzcHggMCA1cHg7XG59XG4uY2FsIC53ayB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5jYWwgLmRheSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBtaW4td2lkdGg6IDI0cHg7XG4gIG1pbi1oZWlnaHQ6IDI0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4uY2FsIC5kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCAuZGF5LndlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uY2FsIC5kYXkub3V0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uY2FsIC5kYXkudG9kYXkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBjb2xvcjogIzE5MjAwMztcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbn1cbi5jYWwgLmRheS50b2RheTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2FsIC5kYXkuc2VsOm5vdCgudG9kYXkpIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggI2I1YWRiYztcbn1cbi5jYWwgLmRheS50b2RheS5zZWwge1xuICBib3gtc2hhZG93OiBpbnNldCAwIDAgMCAxLjVweCAjMTkyMDAzO1xufVxuLmNhbCAuZGF5IC5ldmRvdCB7XG4gIG1pbi13aWR0aDogM3B4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIG1hcmdpbi1ib3R0b206IDJweDtcbn1cbi5jYWwgLmRheS50b2RheSAuZXZkb3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTkyMDAzO1xufVxuLmNhbCAuZXZjYXJkIHtcbiAgbWFyZ2luLXRvcDogMTBweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweDtcbn1cbi5jYWwgLmV2aGVhZCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgcGFkZGluZzogMXB4IDNweCA4cHg7XG59XG4uY2FsIC5ldmVtcHR5IHtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAycHggM3B4IDNweDtcbn1cbi5jYWwgLmV2ZW1wdHkgaW1hZ2Uge1xuICBjb2xvcjogIzhkODY5MztcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4uY2FsIC5ldnJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBtYXJnaW4tYm90dG9tOiA0cHg7XG59XG4uY2FsIC5ldnJvdzpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLWJvdHRvbTogMDtcbn1cbi5jYWwgLmV2cm93IC5ldmljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzYyODkzMztcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA2cHg7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyBpbWFnZSB7XG4gIGNvbG9yOiAjZmZmO1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5jYWwgLmV2cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuZXZyb3cgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cblxuLmRyYXdlciB7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xufVxuXG4udG9hc3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEzcHg7XG4gIGJveC1zaGFkb3c6IDAgMThweCA0MHB4IHJnYmEoNSwgMywgMTAsIDAuNDUpO1xufVxuLnRvYXN0IC5uY2FyZCB7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBib3gtc2hhZG93OiBub25lO1xuICBib3JkZXItcmFkaXVzOiAwO1xuICBwYWRkaW5nOiAwO1xufVxuXG4ubmNhcmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEycHg7XG59XG4ubmNhcmQgLm5pYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xufVxuLm5jYXJkIC5uaWMgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4ubmNhcmQge1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uY2FyZCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLm5jYXJkIC5ib2R5IHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuOHB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLm5jYXJkIC53aGVuIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTBweDtcbn1cbi5uY2FyZCAubngge1xuICBtaW4td2lkdGg6IDIycHg7XG4gIG1pbi1oZWlnaHQ6IDIycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5jYXJkIC5ueCBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxMXB4O1xufVxuLm5jYXJkIC5ueDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjZWY4NmEwO1xufVxuLm5jYXJkLm1lZGlhIHtcbiAgcGFkZGluZzogMTBweCAxMXB4IDlweDtcbiAgbWFyZ2luLWJvdHRvbTogMnB4O1xuICBib3gtc2hhZG93OiAwIDE1cHggMzRweCByZ2JhKDgsIDUsIDE2LCAwLjQ1KSwgMCAycHggOHB4IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG59XG4ubmNhcmQgLm1hcnQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBtaW4td2lkdGg6IDQ2cHg7XG4gIG1pbi1oZWlnaHQ6IDQ2cHg7XG59XG4ubmNhcmQgLm1hcnQgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDIycHg7XG59XG4ubmNhcmQgLm1tZXRhIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxM3B4O1xufVxuLm5jYXJkIC5tYnRuIHtcbiAgbWluLXdpZHRoOiAyOXB4O1xuICBtaW4taGVpZ2h0OiAyOXB4O1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLm5jYXJkIC5tYnRuIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4ubmNhcmQgLm1idG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5uY2FyZCAubWJhciB7XG4gIG1hcmdpbi10b3A6IDdweDtcbn1cbi5uY2FyZCAubXRpbWUge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgbGV2ZWxiYXIubXRyYWNrIHtcbiAgbWluLWhlaWdodDogNHB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xufVxuLm5jYXJkIGxldmVsYmFyLm10cmFjayA+IHRyb3VnaCB7XG4gIG1pbi1oZWlnaHQ6IDRweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cbi5uY2FyZCBsZXZlbGJhci5tdHJhY2sgPiB0cm91Z2ggPiBibG9jay5maWxsZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xufVxuLm5jYXJkIGxldmVsYmFyLm10cmFjayA+IHRyb3VnaCA+IGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG4ubmNhcmQgLm1lbXB0eXJvdyBsYWJlbCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgLm1lbXB0eXJvdyAubWFydCBpbWFnZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5jYXJkIC5naG9zdGIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIHBhZGRpbmc6IDdweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xufVxuLm5jYXJkIC5naG9zdGIgbGFiZWwge1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4ubmNhcmQgLmdob3N0Yjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMzMjJlMzk7XG59XG5cbi5uaGVhZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDhweCA4cHggOHB4IDE0cHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xuICBtYXJnaW4tYm90dG9tOiA4cHg7XG59XG4ubmhlYWQgbGFiZWwge1xuICBmb250LXNpemU6IDEzLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5uaGVhZCAuc3ViIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uaGVhZCAubmNsZWFyIHtcbiAgY29sb3I6ICNlZjg2YTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIHBhZGRpbmc6IDRweCA5cHg7XG59XG4ubmhlYWQgLm5jbGVhciBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxMnB4O1xuICBjb2xvcjogI2VmODZhMDtcbn1cbi5uaGVhZCAubmNsZWFyIGxhYmVsIHtcbiAgY29sb3I6ICNlZjg2YTA7XG59XG4ubmhlYWQgLm5jbGVhcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG5cbi5uZW1wdHkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAyMHB4IDAgMTZweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG4ubmVtcHR5IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAyMnB4O1xuICBtYXJnaW4tYm90dG9tOiA0cHg7XG59XG4ubmVtcHR5IGxhYmVsIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4ub3NkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgxNiwgMTMsIDIwLCAwLjgyKTtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIHBhZGRpbmc6IDEwcHggMTVweDtcbn1cbi5vc2QgaW1hZ2Uge1xuICBjb2xvcjogI2YzZWVmMztcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4ub3NkIGxldmVsYmFyID4gdHJvdWdoIHtcbiAgbWluLWhlaWdodDogOHB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLm9zZCBsZXZlbGJhciA+IHRyb3VnaCA+IGJsb2NrIHtcbiAgbWluLWhlaWdodDogOHB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xufVxuLm9zZCBsZXZlbGJhciA+IHRyb3VnaCA+IGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4ub3NkIGxldmVsYmFyID4gdHJvdWdoID4gYmxvY2suZW1wdHkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiB0cmFuc3BhcmVudDtcbn1cbi5vc2QgLnN2YWwge1xuICBtaW4td2lkdGg6IDM0cHg7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cblxuLnNlc3Npb24ge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDksIDMsIDE0LCAwLjgpO1xufVxuLnNlc3Npb24gLnNidG4ge1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG59XG4uc2Vzc2lvbiAuc2ljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMjRweDtcbiAgbWluLXdpZHRoOiA2MnB4O1xuICBtaW4taGVpZ2h0OiA2MnB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMjAwbXMsIGNvbG9yIDIwMG1zO1xufVxuLnNlc3Npb24gLnJlZCAuc2ljIHtcbiAgY29sb3I6ICNlZjg2YTA7XG59XG4uc2Vzc2lvbiAuc2J0bjpob3ZlciAuc2ljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4uc2Vzc2lvbiAucmVkOmhvdmVyIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5zZXNzaW9uIGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGZvbnQtc2l6ZTogMTJweDtcbn1cbi5zZXNzaW9uIC5jb25maXJtIGxhYmVsIHtcbiAgY29sb3I6ICNlZjg2YTA7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG5cbnBvcG92ZXIuY21lbnUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiA1cHg7XG4gIG1pbi13aWR0aDogMTgwcHg7XG4gIGJveC1zaGFkb3c6IDAgMTVweCAzNHB4IHJnYmEoOCwgNSwgMTYsIDAuNDUpLCAwIDJweCA4cHggcmdiYSgwLCAwLCAwLCAwLjM1KTtcbiAgYm9yZGVyOiBub25lO1xufVxucG9wb3Zlci5jbWVudSA+IGFycm93LCBwb3BvdmVyLmNtZW51ID4gY29udGVudHMge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgYm9yZGVyOiBub25lO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xufVxuXG4uY21pIHtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA4cHggMTBweDtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNtaSBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5jbWkgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNtaTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY21pLmRhbmdlcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLmNtaS5kYW5nZXI6aG92ZXIgaW1hZ2Uge1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5jbWkuZGFuZ2VyOmhvdmVyIGxhYmVsIHtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG5cbi5jc2VwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgbWluLWhlaWdodDogMXB4O1xuICBtYXJnaW46IDRweCA4cHg7XG59XG5cbi5kdGlwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDZweCAxMXB4O1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59IiwgIi8vIFRoZSB0b2tlbiBsYXllciBcdTIwMTQgdGhlIHNpbmdsZSBwbGFjZSB0aGUgc2hlbGwncyBnZW9tZXRyeSBjb21lcyBmcm9tLlxuLy8gUHJvdG90eXBlIGVxdWl2YWxlbnQ6IHRoZSBDU1MgY3VzdG9tIHByb3BlcnRpZXMgb24gLmRlc2t0b3AgKDA0YmU3MmUpLlxuLy8gQ2hhbmdlIGEgdmFsdWUgaGVyZSBhbmQgYmFyLCBwYW5lbHMsIGRvY2ssIHNuYXAtYW5jaG9yZWQgc3VyZmFjZXMgYWxsIHJlZmxvdy5cblxuZXhwb3J0IGludGVyZmFjZSBUb2tlbnMge1xuICAgIGJhckg6IG51bWJlciAvLyBweCBcdTIwMTQgYmFyIGhlaWdodDsgY29udHJvbHMgZGVyaXZlIGZyb20gaXRcbiAgICBiYXJSOiBudW1iZXIgLy8gYmFyIGNvcm5lciByYWRpdXNcbiAgICBnYXA6IG51bWJlciAvLyBzY3JlZW4gZ2FwIChiYXIgdG9wIG9mZnNldCwgZG9jayBib3R0b20gb2Zmc2V0KVxuICAgIGVkZ2U6IG51bWJlciAvLyBzaWRlIGluc2V0c1xuICAgIGljb246IG51bWJlciAvLyBkb2NrL2xhdW5jaGVyIGljb24gdGlsZSBzaXplXG4gICAgZG9ja1BhZDogbnVtYmVyIC8vIGRvY2sgcGFkZGluZyAoY29uY2VudHJpYyByYWRpdXMgZGVyaXZlcylcbiAgICB0aWxlSDogbnVtYmVyIC8vIFFTIHRpbGUgaGVpZ2h0XG4gICAgcGFuZWxXOiBudW1iZXIgLy8gUVMvbm90aWZpY2F0aW9ucy90b2FzdHMgd2lkdGhcbiAgICBsYXVuY2hlclc6IG51bWJlclxuICAgIGNhbGVuZGFyVzogbnVtYmVyXG59XG5cbmV4cG9ydCBjb25zdCBmbG9hdGluZzogVG9rZW5zID0ge1xuICAgIGJhckg6IDQyLFxuICAgIGJhclI6IDE0LFxuICAgIGdhcDogMTAsXG4gICAgZWRnZTogMTIsXG4gICAgaWNvbjogNDQsXG4gICAgZG9ja1BhZDogNSxcbiAgICB0aWxlSDogNTQsXG4gICAgcGFuZWxXOiAzNjUsIC8vIDI4LjVjcXcgYXQgMTI4MHB4ID0gMzY0LjggXHUyMjQ4IDM2NVxuICAgIGxhdW5jaGVyVzogNTg0LCAvLyA0NmNxdyBhdCAxMjgwcHggPSA1ODguOCBcdTIxOTIgY2xhbXBlZCB0byA1ODQgbWF4XG4gICAgY2FsZW5kYXJXOiAzMzYsIC8vIDI3Y3F3IGF0IDEyODBweCA9IDM0NS42IFx1MjE5MiBjbGFtcGVkIHRvIDMzNiBtYXhcbn1cblxuLy8gZ2FwbGVzcyA9IGEgdG9rZW4gcHJlc2V0LCBleGFjdGx5IGxpa2UgdGhlIHByb3RvdHlwZSdzIC5nYXBsZXNzIGNsYXNzXG5leHBvcnQgY29uc3QgZ2FwbGVzczogVG9rZW5zID0ge1xuICAgIC4uLmZsb2F0aW5nLFxuICAgIGJhckg6IDM4LFxuICAgIGJhclI6IDAsXG4gICAgZ2FwOiAwLFxuICAgIGVkZ2U6IDAsXG59XG5cbmV4cG9ydCBsZXQgdG9rZW5zOiBUb2tlbnMgPSBmbG9hdGluZ1xuXG5leHBvcnQgY29uc3QgY3RsID0gKCkgPT4gdG9rZW5zLmJhckggLSAxMSAvLyBiYXIgY29udHJvbCBzaXplXG5leHBvcnQgY29uc3QgcGFuZWxUb3AgPSAoKSA9PiB0b2tlbnMuZ2FwICsgdG9rZW5zLmJhckggKyA2XG5cbi8vIEdUSyBDU1MgY2FuJ3QgY2FsYygpIGZyb20gSlMgc3RhdGU7IHdlIHJlZ2VuZXJhdGUgYSA6cm9vdC1pc2ggYmxvY2sgYW5kXG4vLyBsZXQgQXBwLmFwcGx5X2NzcyByZS1za2luIGxpdmUgKHRoZSBcImJhciA0MiBjeWNsZXJcIiBvZiB0aGUgUU1ML0FHUyB3b3JsZCkuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5Dc3ModDogVG9rZW5zID0gdG9rZW5zKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYFxuICAuYmFyIHsgbWluLWhlaWdodDogJHt0LmJhckh9cHg7IGJvcmRlci1yYWRpdXM6ICR7dC5iYXJSfXB4O1xuICAgICAgICAgbWFyZ2luOiAwOyB9XG4gIC5iYXIgYnV0dG9uIHsgbWluLXdpZHRoOiAke2N0bCgpfXB4OyBtaW4taGVpZ2h0OiAke2N0bCgpfXB4OyB9XG4gIC5kb2NrIHsgcGFkZGluZzogJHt0LmRvY2tQYWR9cHg7IGJvcmRlci1yYWRpdXM6ICR7MTIgKyB0LmRvY2tQYWQgLSAxfXB4O1xuICAgICAgICAgIG1hcmdpbi1ib3R0b206ICR7dC5nYXB9cHg7IH1cbiAgLmljb24tdGlsZSB7IG1pbi13aWR0aDogJHt0Lmljb259cHg7IG1pbi1oZWlnaHQ6ICR7dC5pY29ufXB4OyB9XG4gIC5xcywgLmRyYXdlciwgLmNhbGVuZGFyLCAuY2FsIHsgbWFyZ2luLXRvcDogJHtwYW5lbFRvcCgpfXB4OyB9XG4gIC5xcyB7IG1pbi13aWR0aDogJHt0LnBhbmVsVyAtIDI0fXB4OyB9ICAvKiBwYW5lbFcgaXMgb3V0ZXI7IHN1YnRyYWN0IC5zaGVldCBwYWRkaW5nIDEycHhcdTAwRDcyICovXG4gIC5sYXVuY2hlciB7IG1pbi13aWR0aDogJHt0LmxhdW5jaGVyV31weDsgfVxuICAuY2FsZW5kYXIsIC5jYWwgeyBtaW4td2lkdGg6ICR7dC5jYWxlbmRhclcgLSAyNH1weDsgfSAgLyogY2FsZW5kYXJXIGlzIG91dGVyOyBzdWJ0cmFjdCAuc2hlZXQgcGFkZGluZyAxMlx1MDBENzIgKi9cbiAgLmNoaXAgeyBtaW4taGVpZ2h0OiAke3QudGlsZUh9cHg7IH1cbiAgYFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0VG9rZW5zKG5leHQ6IFBhcnRpYWw8VG9rZW5zPiwgYXBwbHk6IChjc3M6IHN0cmluZykgPT4gdm9pZCkge1xuICAgIHRva2VucyA9IHsgLi4udG9rZW5zLCAuLi5uZXh0IH1cbiAgICBhcHBseSh0b2tlbkNzcyh0b2tlbnMpKVxufVxuIiwgIi8vIG9yZy5nbm9ibGluLlNoZWxsIFx1MjAxNCB0aGUgY29tcG9zaXRvciBsaW5rLiBEcml2ZXM6IHNvZnQtcmVsb2FkLCBmZWF0dXJlIHRvZ2dsZXMsXG4vLyB0aGUgV0lORE9XIExJU1QgdGhhdCBtYWtlcyB0aGUgZG9jayB0cnV0aGZ1bCwgYW5kIHRoZSBjb25uZWN0ZWQvYW1iZXIgc3RhdGUuXG4vLyBQcm90b3R5cGU6IHNlcnZpY2VzICdnbm9iJyBiYW5uZXIgKyBiYXIgYW1iZXIgc2VnbWVudCArIFdNIGludGVncmF0aW9uLlxuXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcbmltcG9ydCB7IFZhcmlhYmxlIH0gZnJvbSBcImFzdGFsXCJcblxuY29uc3QgQlVTID0gXCJvcmcuZ25vYmxpbi5TaGVsbFwiXG5jb25zdCBQQVRIID0gXCIvb3JnL2dub2JsaW4vU2hlbGxcIlxuY29uc3QgSUZBQ0UgPSBcIm9yZy5nbm9ibGluLlNoZWxsXCJcblxuZXhwb3J0IGludGVyZmFjZSBHbm9ibGluV2luZG93IHtcbiAgICBpZDogc3RyaW5nXG4gICAgYXBwSWQ6IHN0cmluZ1xuICAgIHRpdGxlOiBzdHJpbmdcbiAgICBmb2N1c2VkOiBib29sZWFuXG4gICAgbWluaW1pemVkOiBib29sZWFuXG59XG5cbmV4cG9ydCBjb25zdCBjb25uZWN0ZWQgPSBWYXJpYWJsZShmYWxzZSlcbmV4cG9ydCBjb25zdCB3aW5kb3dzID0gVmFyaWFibGU8R25vYmxpbldpbmRvd1tdPihbXSlcblxubGV0IHByb3h5OiBHaW8uREJ1c1Byb3h5IHwgbnVsbCA9IG51bGxcblxuZnVuY3Rpb24gY2FsbChtZXRob2Q6IHN0cmluZywgcGFyYW1zOiBHTGliLlZhcmlhbnQgfCBudWxsID0gbnVsbCk6IFByb21pc2U8R0xpYi5WYXJpYW50IHwgbnVsbD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzLCByZWopID0+IHtcbiAgICAgICAgaWYgKCFwcm94eSkgcmV0dXJuIHJlaihuZXcgRXJyb3IoXCJnbm9ibGluOiBub3QgY29ubmVjdGVkXCIpKVxuICAgICAgICBwcm94eS5jYWxsKG1ldGhvZCwgcGFyYW1zLCBHaW8uREJ1c0NhbGxGbGFncy5OT05FLCAyMDAwLCBudWxsLCAoXywgcikgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXMocHJveHkhLmNhbGxfZmluaXNoKHIpKVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHJlaihlKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBjb25zdCByZWxvYWQgPSAoKSA9PiBjYWxsKFwiUmVsb2FkXCIpXG5leHBvcnQgY29uc3Qgc2V0RmVhdHVyZSA9IChuYW1lOiBzdHJpbmcsIG9uOiBib29sZWFuKSA9PlxuICAgIGNhbGwoXCJTZXRGZWF0dXJlXCIsIG5ldyBHTGliLlZhcmlhbnQoXCIoc2IpXCIsIFtuYW1lLCBvbl0pKVxuXG4vLyBXaW5kb3cgdmVyYnMgKHRoZSBkb2NrIGNsaWNrIG1vZGVsKVxuZXhwb3J0IGNvbnN0IGFjdGl2YXRlID0gKGlkOiBzdHJpbmcpID0+IGNhbGwoXCJBY3RpdmF0ZVdpbmRvd1wiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHMpXCIsIFtpZF0pKVxuZXhwb3J0IGNvbnN0IG1pbmltaXplID0gKGlkOiBzdHJpbmcpID0+IGNhbGwoXCJNaW5pbWl6ZVdpbmRvd1wiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHMpXCIsIFtpZF0pKVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFdpbmRvd3MoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdiA9IGF3YWl0IGNhbGwoXCJMaXN0V2luZG93c1wiKVxuICAgICAgICBpZiAoIXYpIHJldHVyblxuICAgICAgICBjb25zdCBbbGlzdF0gPSB2LmRlZXBfdW5wYWNrKCkgYXMgW0dub2JsaW5XaW5kb3dbXV1cbiAgICAgICAgd2luZG93cy5zZXQobGlzdClcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc3RheSBvbiBsYXN0LWtub3duIGxpc3Q7IGNvbm5lY3RlZCBmbGFnIGNhcnJpZXMgdGhlIHRydXRoICovXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwV2luZG93cyhhcHBJZDogc3RyaW5nKTogR25vYmxpbldpbmRvd1tdIHtcbiAgICByZXR1cm4gd2luZG93cy5nZXQoKS5maWx0ZXIoKHcpID0+IHcuYXBwSWQgPT09IGFwcElkKVxufVxuXG4vLyBDeWNsZSA9IHRoZSBkb2NrIGNhcm91c2VsOiBmb2N1cyB0aGUgbmV4dCB3aW5kb3cgb2YgdGhlIGFwcFxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGN5Y2xlKGFwcElkOiBzdHJpbmcsIGRpcjogMSB8IC0xKSB7XG4gICAgY29uc3Qgd3MgPSBhcHBXaW5kb3dzKGFwcElkKVxuICAgIGlmICh3cy5sZW5ndGggPCAyKSByZXR1cm5cbiAgICBjb25zdCBpID0gd3MuZmluZEluZGV4KCh3KSA9PiB3LmZvY3VzZWQpXG4gICAgYXdhaXQgYWN0aXZhdGUod3NbKChpIDwgMCA/IDAgOiBpKSArIGRpciArIHdzLmxlbmd0aCkgJSB3cy5sZW5ndGhdLmlkKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdCgpIHtcbiAgICBHaW8uYnVzX3dhdGNoX25hbWUoXG4gICAgICAgIEdpby5CdXNUeXBlLlNFU1NJT04sXG4gICAgICAgIEJVUyxcbiAgICAgICAgR2lvLkJ1c05hbWVXYXRjaGVyRmxhZ3MuTk9ORSxcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gYXBwZWFyZWRcbiAgICAgICAgICAgIEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXMoXG4gICAgICAgICAgICAgICAgR2lvLkJ1c1R5cGUuU0VTU0lPTixcbiAgICAgICAgICAgICAgICBHaW8uREJ1c1Byb3h5RmxhZ3MuTk9ORSxcbiAgICAgICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgICAgIEJVUyxcbiAgICAgICAgICAgICAgICBQQVRILFxuICAgICAgICAgICAgICAgIElGQUNFLFxuICAgICAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAgICAgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBwcm94eSA9IEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXNfZmluaXNoKHJlcylcbiAgICAgICAgICAgICAgICAgICAgcHJveHkuY29ubmVjdChcImctc2lnbmFsXCIsIChfcCwgX3MsIHNpZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNpZyA9PT0gXCJXaW5kb3dzQ2hhbmdlZFwiKSByZWZyZXNoV2luZG93cygpXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIGNvbm5lY3RlZC5zZXQodHJ1ZSlcbiAgICAgICAgICAgICAgICAgICAgcmVmcmVzaFdpbmRvd3MoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIClcbiAgICAgICAgfSxcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gdmFuaXNoZWQgXHUyMTkyIGFtYmVyIGV2ZXJ5d2hlcmUgdGhhdCBsaXN0ZW5zXG4gICAgICAgICAgICBwcm94eSA9IG51bGxcbiAgICAgICAgICAgIGNvbm5lY3RlZC5zZXQoZmFsc2UpXG4gICAgICAgIH1cbiAgICApXG59XG4iLCAiaW1wb3J0IFwiLi9vdmVycmlkZXMuanNcIlxuZXhwb3J0IHsgZGVmYXVsdCBhcyBBc3RhbElPIH0gZnJvbSBcImdpOi8vQXN0YWxJTz92ZXJzaW9uPTAuMVwiXG5leHBvcnQgKiBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL3RpbWUuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vZmlsZS5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi9nb2JqZWN0LmpzXCJcbmV4cG9ydCB7IEJpbmRpbmcsIGJpbmQgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcbmV4cG9ydCB7IFZhcmlhYmxlLCBkZXJpdmUgfSBmcm9tIFwiLi92YXJpYWJsZS5qc1wiXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW8/dmVyc2lvbj0yLjBcIlxuXG5leHBvcnQgeyBHaW8gfVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZEZpbGUocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gQXN0YWwucmVhZF9maWxlKHBhdGgpIHx8IFwiXCJcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGaWxlQXN5bmMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBBc3RhbC5yZWFkX2ZpbGVfYXN5bmMocGF0aCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLnJlYWRfZmlsZV9maW5pc2gocmVzKSB8fCBcIlwiKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlRmlsZShwYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICAgIEFzdGFsLndyaXRlX2ZpbGUocGF0aCwgY29udGVudClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlRmlsZUFzeW5jKHBhdGg6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgQXN0YWwud3JpdGVfZmlsZV9hc3luYyhwYXRoLCBjb250ZW50LCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwud3JpdGVfZmlsZV9maW5pc2gocmVzKSlcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb25pdG9yRmlsZShcbiAgICBwYXRoOiBzdHJpbmcsXG4gICAgY2FsbGJhY2s6IChmaWxlOiBzdHJpbmcsIGV2ZW50OiBHaW8uRmlsZU1vbml0b3JFdmVudCkgPT4gdm9pZCxcbik6IEdpby5GaWxlTW9uaXRvciB7XG4gICAgcmV0dXJuIEFzdGFsLm1vbml0b3JfZmlsZShwYXRoLCAoZmlsZTogc3RyaW5nLCBldmVudDogR2lvLkZpbGVNb25pdG9yRXZlbnQpID0+IHtcbiAgICAgICAgY2FsbGJhY2soZmlsZSwgZXZlbnQpXG4gICAgfSkhXG59XG4iLCAiaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5cbmV4cG9ydCB7IGRlZmF1bHQgYXMgR0xpYiB9IGZyb20gXCJnaTovL0dMaWI/dmVyc2lvbj0yLjBcIlxuZXhwb3J0IHsgR09iamVjdCwgR09iamVjdCBhcyBkZWZhdWx0IH1cblxuY29uc3QgbWV0YSA9IFN5bWJvbChcIm1ldGFcIilcbmNvbnN0IHByaXYgPSBTeW1ib2woXCJwcml2XCIpXG5cbmNvbnN0IHsgUGFyYW1TcGVjLCBQYXJhbUZsYWdzIH0gPSBHT2JqZWN0XG5cbmNvbnN0IGtlYmFiaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMS0kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiX1wiLCBcIi1cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG50eXBlIFNpZ25hbERlY2xhcmF0aW9uID0ge1xuICAgIGZsYWdzPzogR09iamVjdC5TaWduYWxGbGFnc1xuICAgIGFjY3VtdWxhdG9yPzogR09iamVjdC5BY2N1bXVsYXRvclR5cGVcbiAgICByZXR1cm5fdHlwZT86IEdPYmplY3QuR1R5cGVcbiAgICBwYXJhbV90eXBlcz86IEFycmF5PEdPYmplY3QuR1R5cGU+XG59XG5cbnR5cGUgUHJvcGVydHlEZWNsYXJhdGlvbiA9XG4gICAgfCBJbnN0YW5jZVR5cGU8dHlwZW9mIEdPYmplY3QuUGFyYW1TcGVjPlxuICAgIHwgeyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfVxuICAgIHwgdHlwZW9mIFN0cmluZ1xuICAgIHwgdHlwZW9mIE51bWJlclxuICAgIHwgdHlwZW9mIEJvb2xlYW5cbiAgICB8IHR5cGVvZiBPYmplY3RcblxudHlwZSBHT2JqZWN0Q29uc3RydWN0b3IgPSB7XG4gICAgW21ldGFdPzoge1xuICAgICAgICBQcm9wZXJ0aWVzPzogeyBba2V5OiBzdHJpbmddOiBHT2JqZWN0LlBhcmFtU3BlYyB9XG4gICAgICAgIFNpZ25hbHM/OiB7IFtrZXk6IHN0cmluZ106IEdPYmplY3QuU2lnbmFsRGVmaW5pdGlvbiB9XG4gICAgfVxuICAgIG5ldyguLi5hcmdzOiBhbnlbXSk6IGFueVxufVxuXG50eXBlIE1ldGFJbmZvID0gR09iamVjdC5NZXRhSW5mbzxuZXZlciwgQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfT4sIG5ldmVyPlxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXIob3B0aW9uczogTWV0YUluZm8gPSB7fSkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoY2xzOiBHT2JqZWN0Q29uc3RydWN0b3IpIHtcbiAgICAgICAgY29uc3QgdCA9IG9wdGlvbnMuVGVtcGxhdGVcbiAgICAgICAgaWYgKHR5cGVvZiB0ID09PSBcInN0cmluZ1wiICYmICF0LnN0YXJ0c1dpdGgoXCJyZXNvdXJjZTovL1wiKSAmJiAhdC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKSkge1xuICAgICAgICAgICAgLy8gYXNzdW1lIHhtbCB0ZW1wbGF0ZVxuICAgICAgICAgICAgb3B0aW9ucy5UZW1wbGF0ZSA9IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSh0KVxuICAgICAgICB9XG5cbiAgICAgICAgR09iamVjdC5yZWdpc3RlckNsYXNzKHtcbiAgICAgICAgICAgIFNpZ25hbHM6IHsgLi4uY2xzW21ldGFdPy5TaWduYWxzIH0sXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7IC4uLmNsc1ttZXRhXT8uUHJvcGVydGllcyB9LFxuICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgfSwgY2xzKVxuXG4gICAgICAgIGRlbGV0ZSBjbHNbbWV0YV1cbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwcm9wZXJ0eShkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbiA9IE9iamVjdCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAodGFyZ2V0OiBhbnksIHByb3A6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikge1xuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0gPz89IHt9XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzID8/PSB7fVxuXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZWJhYmlmeShwcm9wKVxuXG4gICAgICAgIGlmICghZGVzYykge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgcHJvcCwge1xuICAgICAgICAgICAgICAgIGdldCgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbcHJpdl0/Lltwcm9wXSA/PyBkZWZhdWx0VmFsdWUoZGVjbGFyYXRpb24pXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzZXQodjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2ICE9PSB0aGlzW3Byb3BdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzW3ByaXZdID8/PSB7fVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpc1twcml2XVtwcm9wXSA9IHZcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5KG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYHNldF8ke25hbWUucmVwbGFjZShcIi1cIiwgXCJfXCIpfWAsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSh2OiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpc1twcm9wXSA9IHZcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYGdldF8ke25hbWUucmVwbGFjZShcIi1cIiwgXCJfXCIpfWAsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbcHJvcF1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXNba2ViYWJpZnkocHJvcCldID0gcHNwZWMobmFtZSwgUGFyYW1GbGFncy5SRUFEV1JJVEUsIGRlY2xhcmF0aW9uKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGV0IGZsYWdzID0gMFxuICAgICAgICAgICAgaWYgKGRlc2MuZ2V0KSBmbGFncyB8PSBQYXJhbUZsYWdzLlJFQURBQkxFXG4gICAgICAgICAgICBpZiAoZGVzYy5zZXQpIGZsYWdzIHw9IFBhcmFtRmxhZ3MuV1JJVEFCTEVcblxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXNba2ViYWJpZnkocHJvcCldID0gcHNwZWMobmFtZSwgZmxhZ3MsIGRlY2xhcmF0aW9uKVxuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKC4uLnBhcmFtczogQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3Q+KTpcbih0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpID0+IHZvaWRcblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbChkZWNsYXJhdGlvbj86IFNpZ25hbERlY2xhcmF0aW9uKTpcbih0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpID0+IHZvaWRcblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbChcbiAgICBkZWNsYXJhdGlvbj86IFNpZ25hbERlY2xhcmF0aW9uIHwgeyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3QsXG4gICAgLi4ucGFyYW1zOiBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdD5cbikge1xuICAgIHJldHVybiBmdW5jdGlvbiAodGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSB7XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXSA/Pz0ge31cbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHMgPz89IHt9XG5cbiAgICAgICAgY29uc3QgbmFtZSA9IGtlYmFiaWZ5KHNpZ25hbClcblxuICAgICAgICBpZiAoZGVjbGFyYXRpb24gfHwgcGFyYW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgVE9ETzogdHlwZSBhc3NlcnRcbiAgICAgICAgICAgIGNvbnN0IGFyciA9IFtkZWNsYXJhdGlvbiwgLi4ucGFyYW1zXS5tYXAodiA9PiB2LiRndHlwZSlcbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzW25hbWVdID0ge1xuICAgICAgICAgICAgICAgIHBhcmFtX3R5cGVzOiBhcnIsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFsc1tuYW1lXSA9IGRlY2xhcmF0aW9uIHx8IHtcbiAgICAgICAgICAgICAgICBwYXJhbV90eXBlczogW10sXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWRlc2MpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIHNpZ25hbCwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KG5hbWUsIC4uLmFyZ3MpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBvZzogKCguLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCkgPSBkZXNjLnZhbHVlXG4gICAgICAgICAgICBkZXNjLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBub3QgdHlwZWRcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXQobmFtZSwgLi4uYXJncylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBvbl8ke25hbWUucmVwbGFjZShcIi1cIiwgXCJfXCIpfWAsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBvZy5hcHBseSh0aGlzLCBhcmdzKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwc3BlYyhuYW1lOiBzdHJpbmcsIGZsYWdzOiBudW1iZXIsIGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uKSB7XG4gICAgaWYgKGRlY2xhcmF0aW9uIGluc3RhbmNlb2YgUGFyYW1TcGVjKVxuICAgICAgICByZXR1cm4gZGVjbGFyYXRpb25cblxuICAgIHN3aXRjaCAoZGVjbGFyYXRpb24pIHtcbiAgICAgICAgY2FzZSBTdHJpbmc6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLnN0cmluZyhuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgXCJcIilcbiAgICAgICAgY2FzZSBOdW1iZXI6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmRvdWJsZShuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgLU51bWJlci5NQVhfVkFMVUUsIE51bWJlci5NQVhfVkFMVUUsIDApXG4gICAgICAgIGNhc2UgQm9vbGVhbjpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuYm9vbGVhbihuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgZmFsc2UpXG4gICAgICAgIGNhc2UgT2JqZWN0OlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5qc29iamVjdChuYW1lLCBcIlwiLCBcIlwiLCBmbGFncylcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgbWlzc3R5cGVkXG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLm9iamVjdChuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgZGVjbGFyYXRpb24uJGd0eXBlKVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZGVmYXVsdFZhbHVlKGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uKSB7XG4gICAgaWYgKGRlY2xhcmF0aW9uIGluc3RhbmNlb2YgUGFyYW1TcGVjKVxuICAgICAgICByZXR1cm4gZGVjbGFyYXRpb24uZ2V0X2RlZmF1bHRfdmFsdWUoKVxuXG4gICAgc3dpdGNoIChkZWNsYXJhdGlvbikge1xuICAgICAgICBjYXNlIFN0cmluZzpcbiAgICAgICAgICAgIHJldHVybiBcIlwiXG4gICAgICAgIGNhc2UgTnVtYmVyOlxuICAgICAgICAgICAgcmV0dXJuIDBcbiAgICAgICAgY2FzZSBCb29sZWFuOlxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIGNhc2UgT2JqZWN0OlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG59XG4iLCAiLy8gRGVmZXJyZWQsIG5vbi1ibG9ja2luZyBBc3RhbE5vdGlmZCBhY2Nlc3MuIGdldF9kZWZhdWx0KCkgY2FuIGJsb2NrIG9uIGEgaGVhZGxlc3Mgb3Jcbi8vIGNvbnRlbmRlZCBzZXNzaW9uIGJ1cyAoaXQgdHJpZXMgdG8gYmVjb21lIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zIGFuZCB3YWl0cyksXG4vLyBzbyB3ZSBORVZFUiB0b3VjaCBpdCBkdXJpbmcgd2lkZ2V0IGNvbnN0cnVjdGlvbi4gaW5pdCgpIGlzIGNhbGxlZCBvbmNlIGZyb20gYW4gaWRsZVxuLy8gYWZ0ZXIgdGhlIHNoZWxsIGlzIG1hcHBlZDsgb24gcmVhbCBoYXJkd2FyZSBpdCByZXR1cm5zIGZhc3QsIGluIHRoZSBzdHJpcHBlZCBkZXZraXRcbi8vIGl0IG1heSBuby1vcC4gV2lkZ2V0cyBiaW5kIHRvIGB1bnJlYWRgL2BsaXN0YCBhbmQgaHlkcmF0ZSB3aGVuIGl0IGxhbmRzLlxuaW1wb3J0IHsgVmFyaWFibGUsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG4vLyBJbXBvcnRpbmcgdGhlIHR5cGVsaWIgaXMgY2hlYXAgKyBub24tYmxvY2tpbmc7IG9ubHkgZ2V0X2RlZmF1bHQoKSBtYXkgYmxvY2sgKGl0IHRyaWVzXG4vLyB0byBiZWNvbWUgb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnMpLCBzbyB3ZSBjYWxsIFRIQVQgbGF6aWx5IGZyb20gYW4gaWRsZS4gVGhlIG9sZFxuLy8gYGltcG9ydHMuZ2kuQXN0YWxOb3RpZmRgIHRocm93cyB1bmRlciBgZ2pzIC1tYCAoRVNNIGhhcyBubyBsZWdhY3kgYGltcG9ydHNgIGdsb2JhbCkuXG5pbXBvcnQgTm90aWZkIGZyb20gXCJnaTovL0FzdGFsTm90aWZkXCJcblxuZXhwb3J0IGNvbnN0IHVucmVhZCA9IFZhcmlhYmxlKDApXG5leHBvcnQgY29uc3QgcmVhZHkgPSBWYXJpYWJsZShmYWxzZSlcbmxldCBuOiBOb3RpZmQuTm90aWZkIHwgbnVsbCA9IG51bGxcblxuZXhwb3J0IGZ1bmN0aW9uIG5vdGlmZCgpIHtcbiAgICByZXR1cm4gblxufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdCgpIHtcbiAgICAvLyBnZXRlbnYgcmV0dXJucyBcIlwiIChmYWxzeSkgd2hlbiB0aGUgdmFyIGlzIHNldC1idXQtZW1wdHksIG51bGwgd2hlbiB1bnNldCBcdTIwMTQgYm90aCBza2lwXG4gICAgLy8gY29ycmVjdGx5IG9ubHkgd2hlbiB0aGUgdmFsdWUgaXMgdHJ1dGh5IChcIjFcIikuXG4gICAgaWYgKEdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIikpIHJldHVyblxuICAgIC8vIGRlZmVyIHBhc3QgZmlyc3QgcGFpbnQ7IGlmIGdldF9kZWZhdWx0IGJsb2NrcywgaXQgYmxvY2tzIG9ubHkgdGhpcyBpZGxlIHRpY2ssXG4gICAgLy8gbmV2ZXIgY29uc3RydWN0aW9uL2ZpcnN0IHJlbmRlci5cbiAgICB0aW1lb3V0KDUwLCAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBuID0gTm90aWZkLmdldF9kZWZhdWx0KClcbiAgICAgICAgICAgIHJlYWR5LnNldCh0cnVlKVxuICAgICAgICAgICAgY29uc3Qgc3luYyA9ICgpID0+IHVucmVhZC5zZXQobiEubm90aWZpY2F0aW9ucy5sZW5ndGgpXG4gICAgICAgICAgICBuLmNvbm5lY3QoXCJub3RpZmllZFwiLCBzeW5jKVxuICAgICAgICAgICAgbi5jb25uZWN0KFwicmVzb2x2ZWRcIiwgc3luYylcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBwcmludGVycihga29iZWw6IG5vdGlmZCBpbml0IHNraXBwZWQ6ICR7ZX1gKVxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsICIvLyBHVEsgd2lkZ2V0LXRyZWUgZ2VvbWV0cnkgZHVtcGVyIFx1MjAxNCB0aGUgbWlycm9yIG9mIHRoZSBET00ncyBnZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5cbi8vIFdhbGtzIGEgbWFwcGVkIHdpbmRvdyBhbmQgcmVjb3JkcyBldmVyeSB3aWRnZXQncyByZWFsIGFsbG9jYXRpb24gKHgveS93L2ggcmVsYXRpdmVcbi8vIHRvIHRoZSB3aW5kb3cgY29udGVudCkgKyBDU1MgY2xhc3NlcyArIHRleHQsIHNvIGEgcmVuZGVyZWQgR1RLIHN1cmZhY2UgY2FuIGJlIGRpZmZlZFxuLy8gMToxIGFnYWluc3QgdGhlIHByb3RvdHlwZSBET00uIEdhdGVkIGJ5IEtPQkVMX0RVTVA9PHdpbmRvdz4gaW4gYXBwLnRzLlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdyYXBoZW5lIGZyb20gXCJnaTovL0dyYXBoZW5lXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE5vZGUge1xuICAgIGQ6IG51bWJlclxuICAgIHR5cGU6IHN0cmluZ1xuICAgIGNsczogc3RyaW5nXG4gICAgeDogbnVtYmVyXG4gICAgeTogbnVtYmVyXG4gICAgdzogbnVtYmVyXG4gICAgaDogbnVtYmVyXG4gICAgdDogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkdW1wV2luZG93KHdpbjogR3RrLldpbmRvdyk6IE5vZGVbXSB7XG4gICAgY29uc3Qgb3V0OiBOb2RlW10gPSBbXVxuICAgIGNvbnN0IHJvb3Q6IGFueSA9IHdpblxuICAgIGNvbnN0IHdhbGsgPSAodzogYW55LCBkZXB0aDogbnVtYmVyKSA9PiB7XG4gICAgICAgIC8vIGNvbXB1dGVfYm91bmRzIGdpdmVzIHRoZSB3aWRnZXQncyBGVUxMIHJlbmRlcmVkIHJlY3QgKGluY2wuIGl0cyBvd24gcGFkZGluZykgaW5cbiAgICAgICAgLy8gdGhlIHJvb3QncyBjb29yZHMgXHUyMDE0IG1vcmUgcmVsaWFibGUgdGhhbiBjb21wdXRlX3BvaW50ICsgZ2V0X3dpZHRoICh3aGljaCBjYW4gcmVwb3J0XG4gICAgICAgIC8vIHRoZSBjaGlsZC9jb250ZW50IHNpemUgZm9yIHBhZGRlZCBidXR0b25zKS5cbiAgICAgICAgbGV0IHggPSAwLFxuICAgICAgICAgICAgeSA9IDAsXG4gICAgICAgICAgICB3aWR0aCA9IDAsXG4gICAgICAgICAgICBoZWlnaHQgPSAwXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXMgPSB3LmNvbXB1dGVfYm91bmRzKHJvb3QpXG4gICAgICAgICAgICBjb25zdCByZWN0ID0gQXJyYXkuaXNBcnJheShyZXMpID8gcmVzWzFdIDogcmVzXG4gICAgICAgICAgICBpZiAocmVjdCkge1xuICAgICAgICAgICAgICAgIHggPSByZWN0Lm9yaWdpbi54XG4gICAgICAgICAgICAgICAgeSA9IHJlY3Qub3JpZ2luLnlcbiAgICAgICAgICAgICAgICB3aWR0aCA9IHJlY3Quc2l6ZS53aWR0aFxuICAgICAgICAgICAgICAgIGhlaWdodCA9IHJlY3Quc2l6ZS5oZWlnaHRcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7fVxuICAgICAgICBpZiAoIXdpZHRoKSB7XG4gICAgICAgICAgICB3aWR0aCA9IHcuZ2V0X3dpZHRoPy4oKSA/PyAwXG4gICAgICAgICAgICBoZWlnaHQgPSB3LmdldF9oZWlnaHQ/LigpID8/IDBcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjbHMgPSAody5nZXRfY3NzX2NsYXNzZXM/LigpID8/IFtdKS5qb2luKFwiLlwiKVxuICAgICAgICBjb25zdCB0eXBlID0gKHcuY29uc3RydWN0b3I/Lm5hbWUgPz8gXCI/XCIpLnJlcGxhY2UoL18vZywgXCJcIilcbiAgICAgICAgbGV0IHQgPSBcIlwiXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0ID0gKHcuZ2V0X2xhYmVsPy4oKSA/PyB3LmdldF90ZXh0Py4oKSA/PyBcIlwiKS50b1N0cmluZygpLnNsaWNlKDAsIDI4KVxuICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICAgIGQ6IGRlcHRoLFxuICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgIGNscyxcbiAgICAgICAgICAgIHg6IE1hdGgucm91bmQoeCksXG4gICAgICAgICAgICB5OiBNYXRoLnJvdW5kKHkpLFxuICAgICAgICAgICAgdzogTWF0aC5yb3VuZCh3aWR0aCksXG4gICAgICAgICAgICBoOiBNYXRoLnJvdW5kKGhlaWdodCksXG4gICAgICAgICAgICB0LFxuICAgICAgICB9KVxuICAgICAgICBsZXQgYyA9IHcuZ2V0X2ZpcnN0X2NoaWxkPy4oKVxuICAgICAgICB3aGlsZSAoYykge1xuICAgICAgICAgICAgd2FsayhjLCBkZXB0aCArIDEpXG4gICAgICAgICAgICBjID0gYy5nZXRfbmV4dF9zaWJsaW5nKClcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjaGlsZCA9IHdpbi5nZXRfY2hpbGQ/LigpXG4gICAgaWYgKGNoaWxkKSB3YWxrKGNoaWxkLCAwKVxuICAgIHJldHVybiBvdXRcbn1cblxuLy8gUG9sbCB1bnRpbCB0aGUgbmFtZWQgd2luZG93IGlzIHZpc2libGUgKyBsYWlkIG91dCwgdGhlbiBkdW1wIG9uY2UgdG8gS09CRUxfRFVNUF9PVVQuXG5leHBvcnQgZnVuY3Rpb24gYXJtRHVtcChnZXRXaW5kb3c6IChuYW1lOiBzdHJpbmcpID0+IEd0ay5XaW5kb3cgfCBudWxsKSB7XG4gICAgY29uc3QgbmFtZSA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUFwiKVxuICAgIGlmICghbmFtZSkgcmV0dXJuXG4gICAgY29uc3QgcGF0aCA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUF9PVVRcIikgfHwgXCIvdG1wL2tvYmVsLWR1bXAuanNvblwiXG4gICAgbGV0IGRvbmUgPSBmYWxzZVxuICAgIEdMaWIudGltZW91dF9hZGQoR0xpYi5QUklPUklUWV9ERUZBVUxULCA0MDAsICgpID0+IHtcbiAgICAgICAgaWYgKGRvbmUpIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgICAgY29uc3QgdyA9IGdldFdpbmRvdyhuYW1lKVxuICAgICAgICBpZiAodyAmJiB3LmdldF9tYXBwZWQ/LigpICYmICh3LmdldF93aWR0aD8uKCkgPz8gMCkgPiAwKSB7XG4gICAgICAgICAgICAvLyBvbmUgbW9yZSB0aWNrIHNvIGZpbmFsIGFsbG9jYXRpb24gc2V0dGxlc1xuICAgICAgICAgICAgR0xpYi50aW1lb3V0X2FkZChHTGliLlBSSU9SSVRZX0RFRkFVTFQsIDI1MCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRyZWUgPSBkdW1wV2luZG93KHcpXG4gICAgICAgICAgICAgICAgICAgIEdMaWIuZmlsZV9zZXRfY29udGVudHMocGF0aCwgSlNPTi5zdHJpbmdpZnkodHJlZSkpXG4gICAgICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogZHVtcGVkICR7dHJlZS5sZW5ndGh9IHdpZGdldHMgb2YgXCIke25hbWV9XCIgXHUyMTkyICR7cGF0aH1gKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBkdW1wIGZhaWxlZDogJHtlfWApXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBkb25lID0gdHJ1ZVxuICAgICAgICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9DT05USU5VRVxuICAgIH0pXG59XG4iLCAiLy8gQW5pbWF0ZWQgc3VyZmFjZSByZWdpc3RyeSBcdTIwMTQgcmVwbGFjZXMgQXBwLnRvZ2dsZV93aW5kb3cgZm9yIHN1cmZhY2VzIHRoYXQgd2FudFxuLy8gYSByZXZlYWwgYW5pbWF0aW9uLiBFYWNoIHN1cmZhY2UgY2FsbHMgcmVnaXN0ZXIoKSBvbmNlLCB0aGVuIEJhci9hcHAudHMgY2FsbCB0b2dnbGUoKS5cbi8vXG4vLyBQYXR0ZXJuOiB3aW5kb3cgYWx3YXlzIHN0YXJ0cyBoaWRkZW4gKHZpc2libGU9ZmFsc2UpLiBPcGVuaW5nIG1ha2VzIGl0IHZpc2libGUsXG4vLyB0aGVuIHRyaWdnZXJzIHRoZSByZXZlYWxlcjsgY2xvc2luZyB0cmlnZ2VycyB0aGUgcmV2ZWFsZXIgdGhlbiBoaWRlcyBhZnRlciB0cmFuc2l0aW9uLlxuaW1wb3J0IHsgQXBwIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuXG5leHBvcnQgdHlwZSBUcmFuc2l0aW9uVHlwZSA9IEd0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlXG5cbmNvbnN0IHJlZ2lzdHJ5OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHt9XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlcihuYW1lOiBzdHJpbmcsIGZuOiAoKSA9PiB2b2lkKSB7XG4gICAgcmVnaXN0cnlbbmFtZV0gPSBmblxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9nZ2xlKG5hbWU6IHN0cmluZykge1xuICAgIGlmIChyZWdpc3RyeVtuYW1lXSkge1xuICAgICAgICByZWdpc3RyeVtuYW1lXSgpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmFsbGJhY2sgZm9yIHN1cmZhY2VzIHdpdGhvdXQgYW5pbWF0ZWQgcmV2ZWFscyAoc2Vzc2lvbiwgZHJhd2VyKVxuICAgICAgICBBcHAudG9nZ2xlX3dpbmRvdyhuYW1lKVxuICAgIH1cbn1cblxuLy8gbWFrZVJldmVhbDogY3JlYXRlcyB0aGUgc3RhdGUgdmFyaWFibGVzIGFuZCB0b2dnbGUgZnVuY3Rpb24gZm9yIGFuIGFuaW1hdGVkIHN1cmZhY2UuXG4vLyAgIC0gb3Blbk1zOiByZXZlYWwtaW4gZHVyYXRpb24gaW4gbXMgKGRlZmF1bHQgMjIwKVxuLy8gICAtIGNsb3NlTXM6IHJldmVhbC1vdXQgKyB3aW5kb3ctaGlkZSBkZWxheSBpbiBtcyAoZGVmYXVsdCAxNTApXG4vLyAgIC0gcmV2ZWFsZXJSZWY6IHNldCB0aGlzIHRvIHRoZSBSZXZlYWxlciB3aWRnZXQgaW4gYHNldHVwYCBzbyB0aGUgdG9nZ2xlIGNhblxuLy8gICAgIGRpcmVjdGx5IGNvbnRyb2wgdHJhbnNpdGlvbkR1cmF0aW9uIHBlciBkaXJlY3Rpb25cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUmV2ZWFsKG9wZW5NcyA9IDIyMCwgY2xvc2VNcyA9IDE1MCkge1xuICAgIGNvbnN0IHdpblZpc2libGUgPSBWYXJpYWJsZShmYWxzZSlcbiAgICBjb25zdCByZXZlYWxlZCA9IFZhcmlhYmxlKGZhbHNlKVxuICAgIGxldCByZXZlYWxlcldpZGdldDogR3RrLlJldmVhbGVyIHwgbnVsbCA9IG51bGxcbiAgICBsZXQgY2xvc2VUaW1lcjogYW55ID0gbnVsbFxuXG4gICAgY29uc3Qgc2V0UmV2ZWFsZXIgPSAocjogR3RrLlJldmVhbGVyKSA9PiB7XG4gICAgICAgIHJldmVhbGVyV2lkZ2V0ID0gclxuICAgIH1cblxuICAgIGNvbnN0IG9wZW4gPSAoKSA9PiB7XG4gICAgICAgIGlmIChjbG9zZVRpbWVyKSB7XG4gICAgICAgICAgICBjbG9zZVRpbWVyLmNhbmNlbD8uKClcbiAgICAgICAgICAgIGNsb3NlVGltZXIgPSBudWxsXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJldmVhbGVyV2lkZ2V0KSByZXZlYWxlcldpZGdldC50cmFuc2l0aW9uRHVyYXRpb24gPSBvcGVuTXNcbiAgICAgICAgd2luVmlzaWJsZS5zZXQodHJ1ZSlcbiAgICAgICAgLy8gT25lIGlkbGUgZnJhbWUgc28gR1RLIGNhbiByZWFsaXplIHRoZSB3aW5kb3cgYmVmb3JlIGFuaW1hdGluZ1xuICAgICAgICB0aW1lb3V0KDE2LCAoKSA9PiByZXZlYWxlZC5zZXQodHJ1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgIGlmIChyZXZlYWxlcldpZGdldCkgcmV2ZWFsZXJXaWRnZXQudHJhbnNpdGlvbkR1cmF0aW9uID0gY2xvc2VNc1xuICAgICAgICByZXZlYWxlZC5zZXQoZmFsc2UpXG4gICAgICAgIGNsb3NlVGltZXIgPSB0aW1lb3V0KGNsb3NlTXMgKyAyMCwgKCkgPT4ge1xuICAgICAgICAgICAgd2luVmlzaWJsZS5zZXQoZmFsc2UpXG4gICAgICAgICAgICBjbG9zZVRpbWVyID0gbnVsbFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IHRvZ2dsZUZuID0gKCkgPT4gKHJldmVhbGVkLmdldCgpID8gY2xvc2UoKSA6IG9wZW4oKSlcblxuICAgIHJldHVybiB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgb3BlbiwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfVxufVxuIiwgIi8vIFRoZSBiYXIuIFByb3RvdHlwZTogbGF1bmNoZXIgYnV0dG9uIFx1MDBCNyBmb2N1c2VkIHRpdGxlIFx1MDBCNyBjZW50ZXJlZCBjbG9jayAoXHUyMTkyIGNhbGVuZGFyKVxuLy8gXHUwMEI3IHRyYXkgXHUwMEI3IHN0YXR1cyBwaWxsICh3aWZpL3ZvbC9iYXR0ZXJ5OyBhbWJlciBuZXQtZ2x5cGggd2hlbiBnbm9ibGluIGlzIGRvd24pXG4vLyBcdTAwQjcgYmVsbCtiYWRnZSAoXHUyMTkyIGRyYXdlcikgXHUwMEI3IHBvd2VyIChcdTIxOTIgc2Vzc2lvbikuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBCYXR0ZXJ5IGZyb20gXCJnaTovL0FzdGFsQmF0dGVyeVwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IFRyYXkgZnJvbSBcImdpOi8vQXN0YWxUcmF5XCJcbmltcG9ydCB7IGNvbm5lY3RlZCwgd2luZG93cyB9IGZyb20gXCIuLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCB7IHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCB7IHVucmVhZCB9IGZyb20gXCIuLi9zZXJ2aWNlcy9ub3RpZmRcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbmNvbnN0IHRpbWUgPSBWYXJpYWJsZShHTGliLkRhdGVUaW1lLm5ld19ub3dfbG9jYWwoKSkucG9sbCgxMF8wMDAsICgpID0+XG4gICAgR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKClcbilcblxuZnVuY3Rpb24gRm9jdXNlZFRpdGxlKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgY2xhc3M9XCJ0aXRsZVwiXG4gICAgICAgICAgICBlbGxpcHNpemU9ezMgLyogUGFuZ28uRWxsaXBzaXplTW9kZS5FTkQgKi99XG4gICAgICAgICAgICBtYXhXaWR0aENoYXJzPXsyOH1cbiAgICAgICAgICAgIGxhYmVsPXtcbiAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgID8gRC50aXRsZVxuICAgICAgICAgICAgICAgICAgICA6IGJpbmQod2luZG93cykuYXMoKHdzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGYgPSB3cy5maW5kKCh3KSA9PiB3LmZvY3VzZWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZikgcmV0dXJuIFwiZGVza3RvcFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYmxpbmdzID0gd3MuZmlsdGVyKCh3KSA9PiB3LmFwcElkID09PSBmLmFwcElkKVxuICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gc2libGluZ3MubGVuZ3RoID4gMVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBgJHtmLnRpdGxlfSBcdTIwMTQgd2luZG93ICR7c2libGluZ3MuaW5kZXhPZihmKSArIDF9LyR7c2libGluZ3MubGVuZ3RofWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogZi50aXRsZVxuICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgIC8+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBTdGF0dXNQaWxsKCkge1xuICAgIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICAgIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICAgIGNvbnN0IGJhdCA9IEJhdHRlcnkuZ2V0X2RlZmF1bHQoKVxuICAgIC8vIFdpZmkgaWNvbjogdmFyaWVzIHdpdGggY29ubmVjdGlvbiBzdGF0ZSAvIHR5cGVcbiAgICBjb25zdCB3aWZpSWNvbiA9IG5ldC53aWZpXG4gICAgICAgID8gYmluZChuZXQud2lmaSwgXCJlbmFibGVkXCIpLmFzKChvbikgPT5cbiAgICAgICAgICAgICAgb24gPyBcImtvYmVsLXdpZmktc3ltYm9saWNcIiA6IFwia29iZWwtd2lmaS1vZmYtc3ltYm9saWNcIlxuICAgICAgICAgIClcbiAgICAgICAgOiBcImtvYmVsLXdpZmktb2ZmLXN5bWJvbGljXCJcbiAgICAvLyBWb2x1bWUgaWNvbjogdHJhY2sgdGhlIHNwZWFrZXIncyBvd24gdm9sdW1lX2ljb24gcHJvcGVydHlcbiAgICBjb25zdCB2b2xJY29uID0gc3BlYWtlclxuICAgICAgICA/IGJpbmQoc3BlYWtlciwgXCJ2b2x1bWVfaWNvblwiKS5hcygoaSkgPT4gaSA/PyBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiKVxuICAgICAgICA6IFwia29iZWwtc3BlYWtlci1tdXRlLXN5bWJvbGljXCJcbiAgICByZXR1cm4gKFxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICBjbGFzcz17YmluZChjb25uZWN0ZWQpLmFzKChjKSA9PiAoYyA/IFwic3RhdHVzXCIgOiBcInN0YXR1cyBlcnJcIikpfVxuICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwicXVpY2tzZXR0aW5nc1wiKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGNsYXNzPVwibmV0LWljb25cIiBpY29uTmFtZT17d2lmaUljb259IC8+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXt2b2xJY29ufSAvPlxuICAgICAgICAgICAgICAgIHsvKiBCYXR0ZXJ5OiBvbmx5IHJlbmRlcmVkIHdoZW4gYSBiYXR0ZXJ5IGlzIHByZXNlbnQgKi99XG4gICAgICAgICAgICAgICAgeyhERU1PIHx8IGJhdCkgJiYgKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwicGN0XCIgc3BhY2luZz17Nn0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1iYXR0ZXJ5LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBELmJhdHRlcnlQY3RcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmF0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYmluZChiYXQsIFwicGVyY2VudGFnZVwiKS5hcygocCkgPT4gYCR7TWF0aC5yb3VuZChwICogMTAwKX0lYClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBcIlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmZ1bmN0aW9uIEJlbGwoKSB7XG4gICAgLy8gQmFkZ2UgaHlkcmF0ZXMgb25jZSBub3RpZmQgaXMgYXZhaWxhYmxlIChkZWZlcnJlZCBcdTIwMTQgZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYVxuICAgIC8vIGhlYWRsZXNzL2NvbnRlbmRlZCBidXM7IG5ldmVyIGNhbGwgaXQgZHVyaW5nIGNvbnN0cnVjdGlvbikuIHVucmVhZCgpIGlzIGEgcGxhaW5cbiAgICAvLyBWYXJpYWJsZSBhbiBhc3luYyBpbml0IGZpbGxzIGluLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICAgIGNsYXNzPVwiaWJ0biBiZWxsXCJcbiAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcImRyYXdlclwiKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmVsbC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJiYWRnZSB0blwiXG4gICAgICAgICAgICAgICAgICAgIHZpc2libGU9e0RFTU8gPyB0cnVlIDogYmluZCh1bnJlYWQpLmFzKChuKSA9PiBuID4gMCl9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtERU1PID8gXCIxXCIgOiBiaW5kKHVucmVhZCkuYXMoKG4pID0+IChuID4gOSA/IFwiOStcIiA6IGAke259YCkpfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQmFyKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gICAgY29uc3QgeyBUT1AsIExFRlQsIFJJR0hUIH0gPSBBc3RhbC5XaW5kb3dBbmNob3JcbiAgICAvLyBGbG9hdGluZyBiYXI6IGxheWVyLXNoZWxsIG1hcmdpbnMgaW5zZXQgaXQgZnJvbSB0aGUgZWRnZXM7IHRoZSAuYmFyIGNoaWxkIGlzIHRoZVxuICAgIC8vIHJvdW5kZWQgc3VyZmFjZS4gRXhjbHVzaXZlIHNvIHRpbGVkIHdpbmRvd3MgcmVzcGVjdCBpdCAoem9uZSA9IG1hcmdpbiArIGhlaWdodCkuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImJhclwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1iYXJcIlxuICAgICAgICAgICAgY2xhc3M9XCJiYXItd2luZG93XCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuRVhDTFVTSVZFfVxuICAgICAgICAgICAgbWFyZ2luVG9wPXsxMH1cbiAgICAgICAgICAgIG1hcmdpbkxlZnQ9ezEyfVxuICAgICAgICAgICAgbWFyZ2luUmlnaHQ9ezEyfVxuICAgICAgICAgICAgYW5jaG9yPXtUT1AgfCBMRUZUIHwgUklHSFR9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxjZW50ZXJib3ggY2xhc3M9XCJiYXJcIj5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwibGF1bmNoZXJcIil9XG4gICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW1hZ25pZnlpbmctZ2xhc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPEZvY3VzZWRUaXRsZSAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJiY2VudGVyXCJcbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJjYWxlbmRhclwiKX1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNsb2NrIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5CQVNFTElORX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17REVNTyA/IEQuY2xvY2sgOiBiaW5kKHRpbWUpLmFzKCh0KSA9PiB0LmZvcm1hdChcIiVIOiVNXCIpISl9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJkYXRlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5CQVNFTElORX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17REVNTyA/IEQuZGF0ZSA6IGJpbmQodGltZSkuYXMoKHQpID0+IHQuZm9ybWF0KFwiJWEgJS1kICViXCIpISl9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgICAgICB7REVNTyA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MX0gbWFyZ2luRW5kPXszfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0biB0cmF5LWljb25cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2x0aXBUZXh0PVwiRGlzY29yZFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGF0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0biB0cmF5LWljb25cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2x0aXBUZXh0PVwiU3RlYW1cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtZ2FtZS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG4gdHJheS1pY29uXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD1cIlRlbGVncmFtXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBhcGVyLXBsYW5lLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0biB0cmF5LWxhbmcgdG5cIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJlblwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgIGJpbmQoVHJheS5nZXRfZGVmYXVsdCgpLCBcIml0ZW1zXCIpLmFzKChpdGVtcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpdGVtcy5tYXAoKGl0ZW0pID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPG1lbnVidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2x0aXBUZXh0PXtpdGVtLnRvb2x0aXBfbWFya3VwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVudU1vZGVsPXtpdGVtLm1lbnVfbW9kZWx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBnaWNvbj17YmluZChpdGVtLCBcImdpY29uXCIpfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L21lbnVidXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKSlcbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPFN0YXR1c1BpbGwgLz5cbiAgICAgICAgICAgICAgICAgICAgPEJlbGwgLz5cbiAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIil9XG4gICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBvd2VyLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2NlbnRlcmJveD5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIERlbW8tZGF0YSBtb2RlIChLT0JFTF9ERU1PPTEpOiBtYWtlIGV2ZXJ5IHN1cmZhY2UgcmVuZGVyIHRoZSBFWEFDVCBtb2NrIHZhbHVlcyBmcm9tXG4vLyBkb2NzL3Byb3RvdHlwZS5odG1sLCBzbyBhbiBBR1MgcmVuZGVyIGNhbiBiZSBwaXhlbC1vdmVybGFpZCBvbiB0aGUgcHJvdG90eXBlIHJlbmRlclxuLy8gZm9yIGEgZmFpciAxOjEgY29tcGFyaXNvbi4gVGhpcyBpcyBOT1QgY2hlYXRpbmcgXHUyMDE0IHJlYWwgR1RLIHdpZGdldHMsIHJlYWwgcmVuZGVyaW5nO1xuLy8gb25seSB0aGUgKmNvbnRlbnQqIGlzIHBpbm5lZCB0byB0aGUgcHJvdG90eXBlJ3Mgc28gdGhlIGNocm9tZSBjYW4gYmUgZGlmZmVkIGRpcmVjdGx5LlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBjb25zdCBERU1PID0gISFHTGliLmdldGVudihcIktPQkVMX0RFTU9cIilcblxuLy8gVmFsdWVzIHRyYW5zY3JpYmVkIGZyb20gcHJvdG90eXBlLmh0bWwncyBtb2NrIHN0YXRlICh0aGUgcmVmZXJlbmNlIHNjcmVlbnNob3RzKS5cbmV4cG9ydCBjb25zdCBEID0ge1xuICAgIC8vIGJhciBcdTIwMTQgbWF0Y2ggcHJvdG90eXBlLmh0bWwgbW9jayBzdGF0ZSBleGFjdGx5XG4gICAgY2xvY2s6IFwiMTA6NDJcIixcbiAgICBkYXRlOiBcIkZyaSAzIEp1bFwiLFxuICAgIHRpdGxlOiBcIlRlcm1pbmFsIFx1MjAxNCB3aW5kb3cgMS8yXCIsXG4gICAgYmF0dGVyeVBjdDogXCIxMDAlXCIsXG4gICAgLy8gcXVpY2sgc2V0dGluZ3NcbiAgICBtZXRhOiBcIjEwMCUgXHUwMEI3IEZ1bGx5IGNoYXJnZWRcIixcbiAgICB3aWZpU3NpZDogXCJjaG9tcGVycy01R1wiLFxuICAgIGJ0RGV2aWNlOiBcIldILTEwMDBYTTVcIixcbiAgICB2b2x1bWU6IDAuNjc1LCAvLyB0cm91Z2ggNTEuLjI4NSB3aWR0aD0yMzQ7IGtub2I9KDIwOS01MSkvMjM0PTAuNjc1IFx1MjE5MiB4XHUyMjQ4MjA5IG1hdGNoZXMgcHJvdG9cbiAgICBicmlnaHRuZXNzOiAwLjgsIC8vIG1lYXN1cmVkOiBBR1MgdHJvdWdoIDJweCBuYXJyb3dlciB0aGFuIHByb3RvOyAwLjgwMCBhbGlnbnMga25vYiBjZW50ZXJcbiAgICBkYXJrOiB0cnVlLFxuICAgIHNhdmU6IGZhbHNlLFxuICAgIHNpbGVudDogZmFsc2UsXG4gICAgbmlnaHQ6IGZhbHNlLFxuICAgIC8vIGNhbGVuZGFyIFx1MjAxNCBwaW5uZWQgdG8gcHJvdG90eXBlIGRhdGUgKEZyaWRheSAzIEp1bHkgMjAyNilcbiAgICB0b2RheTogeyB5OiAyMDI2LCBtOiA2IC8qIEp1bHksIDAtaW5kZXhlZCAqLywgZDogMyB9LCAvLyBGcmlkYXkgMyBKdWx5IDIwMjZcbiAgICAvLyBsYXVuY2hlciBwaW5uZWQgdGlsZXMgKyB0b2RheSB3aWRnZXRcbiAgICBhcHBzOiBbXCJUZXJtaW5hbFwiLCBcIkZpbGVzXCIsIFwiRmlyZWZveFwiLCBcIlplZFwiLCBcIlNwb3RpZnlcIiwgXCJTZXR0aW5nc1wiXSxcbiAgICB3aWRnZXREYXRlOiBcIkZyaWRheSAzIEp1bHlcIixcbiAgICB3aWRnZXRFdmVudDogXCIwOTo0NSBcdTAwQjcgRGFpbHkgU3RhbmR1cFwiLFxuICAgIG1lZGlhOiB7IHRpdGxlOiBcIldlaWdodGxlc3NcIiwgYXJ0aXN0OiBcIk1hcmNvbmkgVW5pb25cIiB9LFxuICAgIC8vIHByb3RvdHlwZSBpbml0aWFsIG5vdGlmaWNhdGlvbiBzdG9yZSAoc3RvcmUucHVzaCBhdCBsb2FkIHRpbWUsIHdoZW46XCIxMDozOFwiKVxuICAgIG5vdGlmaWNhdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgICAgaWNvbjogXCJrb2JlbC1sZWFmLXN5bWJvbGljXCIsXG4gICAgICAgICAgICBzdW1tYXJ5OiBcImdub2JsaW5cIixcbiAgICAgICAgICAgIGJvZHk6IFwiU29mdC1yZWxvYWQgY29tcGxldGUgXHUyMDE0IDQgZXh0ZW5zaW9ucywgMiBzY3JpcHRzLiBXaW5kb3dzIHVudG91Y2hlZC5cIixcbiAgICAgICAgICAgIHdoZW46IFwiMTA6MzhcIixcbiAgICAgICAgfSxcbiAgICBdLFxufVxuIiwgImltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCB7IHR5cGUgQmluZGFibGVDaGlsZCB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcbmltcG9ydCB7IG1lcmdlQmluZGluZ3MsIGpzeCBhcyBfanN4IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgKiBhcyBXaWRnZXQgZnJvbSBcIi4vd2lkZ2V0LmpzXCJcblxuZXhwb3J0IGZ1bmN0aW9uIEZyYWdtZW50KHsgY2hpbGRyZW4gPSBbXSwgY2hpbGQgfToge1xuICAgIGNoaWxkPzogQmluZGFibGVDaGlsZFxuICAgIGNoaWxkcmVuPzogQXJyYXk8QmluZGFibGVDaGlsZD5cbn0pIHtcbiAgICBpZiAoY2hpbGQpIGNoaWxkcmVuLnB1c2goY2hpbGQpXG4gICAgcmV0dXJuIG1lcmdlQmluZGluZ3MoY2hpbGRyZW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBqc3goXG4gICAgY3Rvcjoga2V5b2YgdHlwZW9mIGN0b3JzIHwgdHlwZW9mIEd0ay5XaWRnZXQsXG4gICAgcHJvcHM6IGFueSxcbikge1xuICAgIHJldHVybiBfanN4KGN0b3JzLCBjdG9yIGFzIGFueSwgcHJvcHMpXG59XG5cbmNvbnN0IGN0b3JzID0ge1xuICAgIGJveDogV2lkZ2V0LkJveCxcbiAgICBidXR0b246IFdpZGdldC5CdXR0b24sXG4gICAgY2VudGVyYm94OiBXaWRnZXQuQ2VudGVyQm94LFxuICAgIC8vIGNpcmN1bGFycHJvZ3Jlc3M6IFdpZGdldC5DaXJjdWxhclByb2dyZXNzLFxuICAgIC8vIGRyYXdpbmdhcmVhOiBXaWRnZXQuRHJhd2luZ0FyZWEsXG4gICAgZW50cnk6IFdpZGdldC5FbnRyeSxcbiAgICBpbWFnZTogV2lkZ2V0LkltYWdlLFxuICAgIGxhYmVsOiBXaWRnZXQuTGFiZWwsXG4gICAgbGV2ZWxiYXI6IFdpZGdldC5MZXZlbEJhcixcbiAgICBvdmVybGF5OiBXaWRnZXQuT3ZlcmxheSxcbiAgICByZXZlYWxlcjogV2lkZ2V0LlJldmVhbGVyLFxuICAgIHNsaWRlcjogV2lkZ2V0LlNsaWRlcixcbiAgICBzdGFjazogV2lkZ2V0LlN0YWNrLFxuICAgIHN3aXRjaDogV2lkZ2V0LlN3aXRjaCxcbiAgICB3aW5kb3c6IFdpZGdldC5XaW5kb3csXG4gICAgbWVudWJ1dHRvbjogV2lkZ2V0Lk1lbnVCdXR0b24sXG4gICAgcG9wb3ZlcjogV2lkZ2V0LlBvcG92ZXIsXG59XG5cbmRlY2xhcmUgZ2xvYmFsIHtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5hbWVzcGFjZVxuICAgIG5hbWVzcGFjZSBKU1gge1xuICAgICAgICB0eXBlIEVsZW1lbnQgPSBHdGsuV2lkZ2V0XG4gICAgICAgIHR5cGUgRWxlbWVudENsYXNzID0gR3RrLldpZGdldFxuICAgICAgICBpbnRlcmZhY2UgSW50cmluc2ljRWxlbWVudHMge1xuICAgICAgICAgICAgYm94OiBXaWRnZXQuQm94UHJvcHNcbiAgICAgICAgICAgIGJ1dHRvbjogV2lkZ2V0LkJ1dHRvblByb3BzXG4gICAgICAgICAgICBjZW50ZXJib3g6IFdpZGdldC5DZW50ZXJCb3hQcm9wc1xuICAgICAgICAgICAgLy8gY2lyY3VsYXJwcm9ncmVzczogV2lkZ2V0LkNpcmN1bGFyUHJvZ3Jlc3NQcm9wc1xuICAgICAgICAgICAgLy8gZHJhd2luZ2FyZWE6IFdpZGdldC5EcmF3aW5nQXJlYVByb3BzXG4gICAgICAgICAgICBlbnRyeTogV2lkZ2V0LkVudHJ5UHJvcHNcbiAgICAgICAgICAgIGltYWdlOiBXaWRnZXQuSW1hZ2VQcm9wc1xuICAgICAgICAgICAgbGFiZWw6IFdpZGdldC5MYWJlbFByb3BzXG4gICAgICAgICAgICBsZXZlbGJhcjogV2lkZ2V0LkxldmVsQmFyUHJvcHNcbiAgICAgICAgICAgIG92ZXJsYXk6IFdpZGdldC5PdmVybGF5UHJvcHNcbiAgICAgICAgICAgIHJldmVhbGVyOiBXaWRnZXQuUmV2ZWFsZXJQcm9wc1xuICAgICAgICAgICAgc2xpZGVyOiBXaWRnZXQuU2xpZGVyUHJvcHNcbiAgICAgICAgICAgIHN0YWNrOiBXaWRnZXQuU3RhY2tQcm9wc1xuICAgICAgICAgICAgc3dpdGNoOiBXaWRnZXQuU3dpdGNoUHJvcHNcbiAgICAgICAgICAgIHdpbmRvdzogV2lkZ2V0LldpbmRvd1Byb3BzXG4gICAgICAgICAgICBtZW51YnV0dG9uOiBXaWRnZXQuTWVudUJ1dHRvblByb3BzXG4gICAgICAgICAgICBwb3BvdmVyOiBXaWRnZXQuUG9wb3ZlclByb3BzXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCBqc3hzID0ganN4XG4iLCAiLy8gVGhlIGRvY2suIEJlaGF2aW9yIG1vZGVsIChwcm90b3R5cGUtZmluYWwpOlxuLy8gICBjbGljayAgXHUyMDE0IG5vIHdpbmRvd3M6IGxhdW5jaCAoZ2hvc3Qgem9vbSkgXHUwMEI3IHVuZm9jdXNlZDogZm9jdXMgdG9wIHdpbmRvdyAocHVsc2UpXG4vLyAgICAgICAgICAgIGZvY3VzZWQgKyBtdWx0aTogY3ljbGUgXHUwMEI3IGZvY3VzZWQgKyBzaW5nbGU6IG1pbmltaXplXG4vLyAgIHNjcm9sbCBcdTIwMTQgc2luZ2xlOiBmb2N1cyBcdTAwQjcgbXVsdGk6IGN5Y2xlIChjYXJvdXNlbCBudWRnZSwgc3RhbmRhcmQgZGlyZWN0aW9uKVxuLy8gICBtaWRkbGUtY2xpY2sgXHUyMDE0IG5ldyB3aW5kb3cgXHUwMEI3IHJpZ2h0LWNsaWNrIFx1MjAxNCBjb250ZXh0IG1lbnUgKHdpbmRvd3MgbGlzdCArIFF1aXQpXG4vLyBET1RTOiBhYnNvbHV0ZSBvdmVybGF5IChHdGsuT3ZlcmxheSksIHNsaWRpbmcgNC1kb3Qgdmlld3BvcnQsIGVkZ2UgbWluaXMgcGFzdCA0LFxuLy8gZHlpbmctZG90IGNsb3NlIGFuaW1hdGlvbi4gSWNvbnMgb3duIEFMTCBnZW9tZXRyeS5cbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgYmluZCwgVmFyaWFibGUsIGV4ZWNBc3luYyB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQXBwcyBmcm9tIFwiZ2k6Ly9Bc3RhbEFwcHNcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgTU9USU9OLCBzcHJpbmcsIHNwcmluZ1RvIH0gZnJvbSBcIi4uL2xpYi9zcHJpbmdcIlxuaW1wb3J0ICogYXMgZ25vYmxpbiBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBERU1PIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcblxuY29uc3QgUElOTkVEID0gW1xuICAgIFwib3JnLmdub21lLlB0eXhpc1wiLFxuICAgIFwib3JnLmdub21lLk5hdXRpbHVzXCIsXG4gICAgXCJmaXJlZm94XCIsXG4gICAgXCJkZXYuemVkLlplZFwiLFxuICAgIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsXG4gICAgXCJvcmcuZ25vbWUuU2V0dGluZ3NcIixcbl1cblxuZnVuY3Rpb24gRG90cyh7IGFwcElkIH06IHsgYXBwSWQ6IHN0cmluZyB9KSB7XG4gICAgLy8gU2xpZGluZyB2aWV3cG9ydCBpZGVudGljYWwgdG8gdGhlIHByb3RvdHlwZTogXHUyMjY0NCBkb3RzLCBmb2N1c2VkIHBpbGwsXG4gICAgLy8gbWluaXMgd2hlbiB3aW5kb3dzIGV4aXN0IGJleW9uZCB0aGUgdmlzaWJsZSBzbGljZS5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZG90c1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfSBzcGFjaW5nPXszfT5cbiAgICAgICAgICAgIHtiaW5kKGdub2JsaW4ud2luZG93cykuYXMoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICAgICAgICAgIGNvbnN0IHRvdGFsID0gd3MubGVuZ3RoXG4gICAgICAgICAgICAgICAgY29uc3QgbiA9IE1hdGgubWluKHRvdGFsLCA0KVxuICAgICAgICAgICAgICAgIGNvbnN0IGN1ciA9IHdzLmZpbmRJbmRleCgodykgPT4gdy5mb2N1c2VkKVxuICAgICAgICAgICAgICAgIGxldCBzdGFydCA9IDBcbiAgICAgICAgICAgICAgICBpZiAodG90YWwgPiA0KSBzdGFydCA9IE1hdGgubWluKE1hdGgubWF4KChjdXIgPCAwID8gMCA6IGN1cikgLSAxLCAwKSwgdG90YWwgLSA0KVxuICAgICAgICAgICAgICAgIHJldHVybiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sIChfLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHN0YXJ0ICsgaVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbHMgPSBbXCJkb3RcIl1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGN1ciA+PSAwICYmIGlkeCA9PT0gY3VyKSBjbHMucHVzaChcIm9uXCIpXG4gICAgICAgICAgICAgICAgICAgIGlmICh0b3RhbCA+IDQgJiYgKChpID09PSAwICYmIHN0YXJ0ID4gMCkgfHwgKGkgPT09IG4gLSAxICYmIHN0YXJ0ICsgNCA8IHRvdGFsKSkpXG4gICAgICAgICAgICAgICAgICAgICAgICBjbHMucHVzaChcIm1pbmlcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIDxib3ggY2xhc3M9e2Nscy5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gYnVpbGRDb250ZXh0TWVudShhcHA6IEFwcHMuQXBwbGljYXRpb24sIGFwcElkOiBzdHJpbmcpOiBHdGsuUG9wb3ZlciB7XG4gICAgY29uc3QgdmJveCA9IG5ldyBHdGsuQm94KHsgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbi5WRVJUSUNBTCwgc3BhY2luZzogMCB9KVxuICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuXG4gICAgLy8gd2luZG93IHJvd3MgKGNsaWNrIHRvIGZvY3VzL3Jlc3RvcmUpXG4gICAgZm9yIChjb25zdCB3IG9mIHdzKSB7XG4gICAgICAgIGNvbnN0IHJvdyA9IG5ldyBHdGsuQnV0dG9uKHsgY3NzQ2xhc3NlczogW1wiY21pXCJdIH0pXG4gICAgICAgIGNvbnN0IGhib3ggPSBuZXcgR3RrLkJveCh7IHNwYWNpbmc6IDkgfSlcbiAgICAgICAgY29uc3QgaW1nID0gbmV3IEd0ay5JbWFnZSh7IGljb25OYW1lOiBcImtvYmVsLXdpbmRvdy1zeW1ib2xpY1wiIH0pXG4gICAgICAgIGltZy5jc3NDbGFzc2VzID0gW11cbiAgICAgICAgY29uc3QgbGJsID0gbmV3IEd0ay5MYWJlbCh7XG4gICAgICAgICAgICBsYWJlbDogdy50aXRsZSB8fCBhcHAubmFtZSxcbiAgICAgICAgICAgIGhhbGlnbjogR3RrLkFsaWduLlNUQVJULFxuICAgICAgICAgICAgZWxsaXBzaXplOiAzIGFzIGFueSxcbiAgICAgICAgICAgIHhhbGlnbjogMCxcbiAgICAgICAgICAgIGhleHBhbmQ6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIGhib3guYXBwZW5kKGltZylcbiAgICAgICAgaGJveC5hcHBlbmQobGJsKVxuICAgICAgICByb3cuc2V0X2NoaWxkKGhib3gpXG4gICAgICAgIHJvdy5jb25uZWN0KFwiY2xpY2tlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBnbm9ibGluLmFjdGl2YXRlKHcuaWQpXG4gICAgICAgICAgICB2Ym94LmdldF9yb290KCk/LmhpZGUoKVxuICAgICAgICB9KVxuICAgICAgICB2Ym94LmFwcGVuZChyb3cpXG4gICAgfVxuXG4gICAgaWYgKHdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3Qgc2VwID0gbmV3IEd0ay5TZXBhcmF0b3Ioe1xuICAgICAgICAgICAgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbi5IT1JJWk9OVEFMLFxuICAgICAgICAgICAgY3NzQ2xhc3NlczogW1wiY3NlcFwiXSxcbiAgICAgICAgfSlcbiAgICAgICAgdmJveC5hcHBlbmQoc2VwKVxuICAgIH1cblxuICAgIC8vIHF1aXQgcm93XG4gICAgY29uc3QgcXVpdCA9IG5ldyBHdGsuQnV0dG9uKHsgY3NzQ2xhc3NlczogW1wiY21pXCIsIFwiZGFuZ2VyXCJdIH0pXG4gICAgY29uc3QgcWJveCA9IG5ldyBHdGsuQm94KHsgc3BhY2luZzogOSB9KVxuICAgIGNvbnN0IHFpbWcgPSBuZXcgR3RrLkltYWdlKHsgaWNvbk5hbWU6IFwia29iZWwteC1zeW1ib2xpY1wiIH0pXG4gICAgcWltZy5jc3NDbGFzc2VzID0gW11cbiAgICBjb25zdCBxbGJsID0gbmV3IEd0ay5MYWJlbCh7IGxhYmVsOiBcIlF1aXRcIiwgaGFsaWduOiBHdGsuQWxpZ24uU1RBUlQsIHhhbGlnbjogMCwgaGV4cGFuZDogdHJ1ZSB9KVxuICAgIHFib3guYXBwZW5kKHFpbWcpXG4gICAgcWJveC5hcHBlbmQocWxibClcbiAgICBxdWl0LnNldF9jaGlsZChxYm94KVxuICAgIHF1aXQuY29ubmVjdChcImNsaWNrZWRcIiwgKCkgPT4ge1xuICAgICAgICBleGVjQXN5bmMoYHBraWxsIC1mIFwiJHthcHBJZH1cImApXG4gICAgICAgIHZib3guZ2V0X3Jvb3QoKT8uaGlkZSgpXG4gICAgfSlcbiAgICB2Ym94LmFwcGVuZChxdWl0KVxuXG4gICAgY29uc3QgcG9wb3ZlciA9IG5ldyBHdGsuUG9wb3Zlcih7IGNzc0NsYXNzZXM6IFtcImNtZW51XCJdLCBjaGlsZDogdmJveCwgaGFzQXJyb3c6IGZhbHNlIH0pXG4gICAgcG9wb3Zlci5zZXRfcG9zaXRpb24oR3RrLlBvc2l0aW9uVHlwZS5UT1ApXG4gICAgcmV0dXJuIHBvcG92ZXJcbn1cblxuZnVuY3Rpb24gRG9ja0J1dHRvbih7IGFwcCB9OiB7IGFwcDogQXBwcy5BcHBsaWNhdGlvbiB9KSB7XG4gICAgY29uc3QgYXBwSWQgPSBhcHAuZW50cnkucmVwbGFjZSgvXFwuZGVza3RvcCQvLCBcIlwiKVxuICAgIGxldCBwb3BvdmVyOiBHdGsuUG9wb3ZlciB8IG51bGwgPSBudWxsXG5cbiAgICBjb25zdCBvbkNsaWNrID0gKCkgPT4ge1xuICAgICAgICBjb25zdCB3cyA9IGdub2JsaW4uYXBwV2luZG93cyhhcHBJZClcbiAgICAgICAgaWYgKCF3cy5sZW5ndGgpIHJldHVybiB2b2lkIGFwcC5sYXVuY2goKSAvLyArIGdob3N0IHpvb20gKHJldmVhbGVyIHNjYWxlIGFuaW0pXG4gICAgICAgIGNvbnN0IGZvY3VzZWQgPSB3cy5maW5kKCh3KSA9PiB3LmZvY3VzZWQpXG4gICAgICAgIGlmICghZm9jdXNlZClcbiAgICAgICAgICAgIHJldHVybiB2b2lkIGdub2JsaW4uYWN0aXZhdGUoXG4gICAgICAgICAgICAgICAgd3Muc2xpY2UoKS5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYi5mb2N1c2VkKSAtIE51bWJlcihhLmZvY3VzZWQpKVswXS5pZFxuICAgICAgICAgICAgKVxuICAgICAgICBpZiAod3MubGVuZ3RoID4gMSkgcmV0dXJuIHZvaWQgZ25vYmxpbi5jeWNsZShhcHBJZCwgMSlcbiAgICAgICAgZ25vYmxpbi5taW5pbWl6ZShmb2N1c2VkLmlkKVxuICAgIH1cblxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICAgIGNsYXNzPVwiZGJ0blwiXG4gICAgICAgICAgICB0b29sdGlwVGV4dD17YXBwLm5hbWV9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9e29uQ2xpY2t9XG4gICAgICAgICAgICBzZXR1cD17KHNlbGYpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBBdHRhY2ggYSBQb3BvdmVyIGZvciByaWdodC1jbGljayBjb250ZXh0IG1lbnVcbiAgICAgICAgICAgICAgICBwb3BvdmVyID0gYnVpbGRDb250ZXh0TWVudShhcHAsIGFwcElkKVxuICAgICAgICAgICAgICAgIHBvcG92ZXIuc2V0X3BhcmVudChzZWxmKVxuICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIG9uQnV0dG9uUHJlc3NlZD17KF93LCBlKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGUuZ2V0X2J1dHRvbigpID09PSBHZGsuQlVUVE9OX01JRERMRSkgYXBwLmxhdW5jaCgpXG4gICAgICAgICAgICAgICAgaWYgKGUuZ2V0X2J1dHRvbigpID09PSBHZGsuQlVUVE9OX1NFQ09OREFSWSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBSZWJ1aWxkIHRvIGdldCBmcmVzaCB3aW5kb3cgbGlzdCB0aGVuIHNob3dcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBvcG92ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvcG92ZXIudW5wYXJlbnQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgcG9wb3Zlci5ydW5fZGlzcG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgcG9wb3ZlciA9IGJ1aWxkQ29udGV4dE1lbnUoYXBwLCBhcHBJZClcbiAgICAgICAgICAgICAgICAgICAgcG9wb3Zlci5zZXRfcGFyZW50KF93KVxuICAgICAgICAgICAgICAgICAgICBwb3BvdmVyLnBvcHVwKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9fVxuICAgICAgICAgICAgb25TY3JvbGw9eyhfdywgX2R4LCBkeSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICAgICAgICAgIGlmICghd3MubGVuZ3RoKSByZXR1cm5cbiAgICAgICAgICAgICAgICBpZiAod3MubGVuZ3RoID4gMSkgZ25vYmxpbi5jeWNsZShhcHBJZCwgZHkgPiAwID8gMSA6IC0xKVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKCF3c1swXS5mb2N1c2VkKSBnbm9ibGluLmFjdGl2YXRlKHdzWzBdLmlkKVxuICAgICAgICAgICAgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2FwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIn1cbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIHsvKiBkb3RzIGFzIE9WRVJMQVkgXHUyMDE0IHplcm8gbGF5b3V0IGZvb3RwcmludCAqL31cbiAgICAgICAgICAgICAgICA8RG90cyB0eXBlPVwib3ZlcmxheVwiIGFwcElkPXthcHBJZH0gLz5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBNZWRpYVdpZGdldCgpIHtcbiAgICBjb25zdCBtcHJpcyA9IE1wcmlzLmdldF9kZWZhdWx0KClcbiAgICBjb25zdCBwcm9ncmVzcyA9IERFTU9cbiAgICAgICAgPyAwLjQyXG4gICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwID0gcHMuZmluZCgocSkgPT4gcS5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdXG4gICAgICAgICAgICAgIGlmICghcCB8fCAhcC5sZW5ndGggfHwgcC5sZW5ndGggPD0gMCkgcmV0dXJuIDBcbiAgICAgICAgICAgICAgcmV0dXJuIHAucG9zaXRpb24gLyBwLmxlbmd0aFxuICAgICAgICAgIH0pXG4gICAgY29uc3QgaWNvbiA9IERFTU9cbiAgICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCJcbiAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwcy5maW5kKChxKSA9PiBxLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORykgPz8gcHNbMF1cbiAgICAgICAgICAgICAgaWYgKCFwKSByZXR1cm4gXCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgIHJldHVybiBwLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuIGR3aWRnZXRcIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkdGlsZVwiPlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZGdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2ljb259XG4gICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezE4fVxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgdmV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhclxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibXByb2dcIlxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkVORH1cbiAgICAgICAgICAgICAgICAgICAgdmFsdWU9e3Byb2dyZXNzfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgIClcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBERU1PIG1vZGU6IHJlbmRlciB0aGUgcHJvdG90eXBlJ3MgRVhBQ1QgZG9jayAoZG9jcy9wcm90b3R5cGUuaHRtbCkgd2l0aCByZWFsIEdUS1xuLy8gd2lkZ2V0cywgc28gaXQgY2FuIGJlIHBpeGVsLW92ZXJsYWlkIG9uIHRoZSBwcm90b3R5cGUgcmVuZGVyIDE6MS4gSWNvbnMgbG9hZCBmcm9tIHRoZVxuLy8gU0FNRSBvbi1kaXNrIGZpbGVzIHRoZSBwcm90b3R5cGUgcmVmZXJlbmNlcyAodmlhIGEgRmlsZUljb24gZ2ljb24pIHJhdGhlciB0aGFuIGJ5XG4vLyB0aGVtZWQgbmFtZSBcdTIwMTQgYSB0aGVtZWQgbG9va3VwIHNuYXBzIHRvIGEgZGlmZmVyZW50IHNpemUgdmFyaWFudCAoZS5nLiB0aGUgMzJweCBmaXJlZm94XG4vLyBpbnN0ZWFkIG9mIHRoZSBwcm90b3R5cGUncyAyNTZweCBwbmcpIGFuZCBkb3duc2NhbGVzIGRpZmZlcmVudGx5LiBTYW1lIHNvdXJjZSBmaWxlIFx1MjE5MlxuLy8gY2xvc2VzdCBjcm9zcy1lbmdpbmUgbWF0Y2guIChwaXhlbC1zaXplIGlzIGhvbm91cmVkIG5vdyB0aGUgaWNvbi10aWxlIG1pbiBpcyAzMC4pXG5jb25zdCBERU1PX0FQUFMgPSBbXG4gICAge1xuICAgICAgICBuYW1lOiBcIlRlcm1pbmFsXCIsXG4gICAgICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlB0eXhpcy5zdmdcIixcbiAgICAgICAgZG90czogW1wib25cIiwgXCJkb3RcIl0sXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiRmlsZXNcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuTmF1dGlsdXMuc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtcImRvdFwiXSxcbiAgICB9LFxuICAgIHsgbmFtZTogXCJGaXJlZm94XCIsIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yLzI1NngyNTYvYXBwcy9maXJlZm94LnBuZ1wiLCBkb3RzOiBbXSB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJaZWRcIixcbiAgICAgICAgaWNvbjogXCIvaG9tZS9raWVyYW4vLmxvY2FsL3plZC5hcHAvc2hhcmUvaWNvbnMvaGljb2xvci81MTJ4NTEyL2FwcHMvemVkLnBuZ1wiLFxuICAgICAgICBkb3RzOiBbXSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJTcG90aWZ5XCIsXG4gICAgICAgIGljb246IFwiL3Zhci9saWIvZmxhdHBhay9leHBvcnRzL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9jb20uc3BvdGlmeS5DbGllbnQuc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlNldHRpbmdzXCIsXG4gICAgICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlNldHRpbmdzLnN2Z1wiLFxuICAgICAgICBkb3RzOiBbXSxcbiAgICB9LFxuXVxuXG5mdW5jdGlvbiBmaWxlSWNvbihwYXRoOiBzdHJpbmcpOiBHaW8uSWNvbiB7XG4gICAgcmV0dXJuIEdpby5GaWxlSWNvbi5uZXcoR2lvLkZpbGUubmV3X2Zvcl9wYXRoKHBhdGgpKVxufVxuXG5mdW5jdGlvbiBEZW1vQnV0dG9uKHsgYXBwIH06IHsgYXBwOiAodHlwZW9mIERFTU9fQVBQUylbbnVtYmVyXSB9KSB7XG4gICAgLy8gTkI6IHRoZSBkb3RzIGJveCBjYXJyaWVzIGB0eXBlPVwib3ZlcmxheVwiYCBESVJFQ1RMWSAoaW50cmluc2ljIGVsZW1lbnQpIFx1MjAxNCBhIGZ1bmN0aW9uXG4gICAgLy8gY29tcG9uZW50IHdvdWxkIHN3YWxsb3cgdGhlIHByb3AsIGxldHRpbmcgdGhlIHVudHlwZWQgYm94IHJlcGxhY2UgdGhlIGljb24gYXMgdGhlXG4gICAgLy8gb3ZlcmxheSdzIG1haW4gY2hpbGQgKEd0a092ZXJsYXkuc2V0X2NoaWxkKS4gSWNvbiBzdGF5cyBtYWluOyBkb3RzIG92ZXJsYXkgb24gdG9wLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuXCIgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfT5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImljb24tdGlsZVwiXG4gICAgICAgICAgICAgICAgICAgIGdpY29uPXtmaWxlSWNvbihhcHAuaWNvbil9XG4gICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZG90c1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXszfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAge2FwcC5kb3RzLm1hcCgoY2xzKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPXtjbHMgPT09IFwib25cIiA/IFwiZG90IG9uXCIgOiBcImRvdFwifSAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBEZW1vRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkb2NrXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIlxuICAgICAgICAgICAgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzBdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzFdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzJdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzNdfSAvPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNF19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNV19IC8+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICA8TWVkaWFXaWRnZXQgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIERvY2sobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoREVNTykgcmV0dXJuIERlbW9Eb2NrKG1vbml0b3IpXG5cbiAgICBjb25zdCBhcHBzID0gbmV3IEFwcHMuQXBwcygpXG4gICAgLy8gUGlubmVkIGVudHJpZXMgcmVzb2x2ZWQgYnkgZGVza3RvcC1pZDsgdGhlIGRvY2sgbmV2ZXIgc2l0cyBlbXB0eSwgc28gZmlsbCBhbnlcbiAgICAvLyB1bnJlc29sdmVkIHNsb3RzIChlLmcuIGFuIGFwcCBub3QgaW5zdGFsbGVkIGluIHRoZSBkZXZraXQpIGZyb20gdGhlIGluc3RhbGxlZFxuICAgIC8vIGxpc3QuIE9uIHJlYWwgaGFyZHdhcmUgdGhlIHBpbnMgcmVzb2x2ZSBhbmQgdGhlIGZpbGwgaXMgdW51c2VkLlxuICAgIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICAgIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZCkgPz9cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgICAvLyBBbHdheXMgcmVuZGVyIG9uZSBzbG90IHBlciBwaW4gc28gdGhlIGRvY2sga2VlcHMgaXRzIHNoYXBlOyByZXNvbHZlZCBwaW5zIGdldCB0aGVcbiAgICAvLyByZWFsIGFwcCArIGJlaGF2aW9yLCB1bnJlc29sdmVkIG9uZXMgYSBsYWJlbGxlZCBwbGFjZWhvbGRlciB0aWxlLiBBIHNlcGFyYXRvciBzaXRzXG4gICAgLy8gYmV0d2VlbiB0aGUgZm91cnRoIGFuZCBmaWZ0aCBwaW5zIChwcm90b3R5cGUgcGFyaXR5KSwgdGhlbiBiZWZvcmUgdGhlIG1lZGlhIHdpZGdldC5cbiAgICBjb25zdCBzbG90cyA9IFBJTk5FRC5tYXAoKGlkKSA9PiAoeyBpZCwgYXBwOiByZXNvbHZlKGlkKSB9KSlcbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwiZG9ja1wiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1kb2NrXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZG9jay13aW5kb3dcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cImRvY2tcIiBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICB7c2xvdHMubWFwKCh7IGlkLCBhcHAgfSwgaSkgPT4gW1xuICAgICAgICAgICAgICAgICAgICBpID09PSA0ID8gPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz4gOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBhcHAgPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8RG9ja0J1dHRvbiBhcHA9e2FwcH0gLz5cbiAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuIHBsYWNlaG9sZGVyXCIgdG9vbHRpcFRleHQ9e2lkLnNwbGl0KFwiLlwiKS5wb3AoKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGUtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICBdKX1cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBUaGUgc3BvdGxpZ2h0LiBQcm90b3R5cGUtZmluYWwgYmVoYXZpb3I6XG4vLyAgIFN1cGVyIHJlbGVhc2Ugb3BlbnMgKGNvbXBvc2l0b3Iga2V5YmluZCBcdTIxOTIgYGFzdGFsIC1pIGtvYmVsIC10IGxhdW5jaGVyYClcbi8vICAgZnV6enkgKyBsZWFmIGhpZ2hsaWdodCBcdTAwQjcgZ2xvYmFsIEJFU1QtTUFUQ0ggc2xvdCAoc2NvcmUtcmFua2VkIGFjcm9zcyBwcm92aWRlcnMsXG4vLyAgIHR5cGUgd2VpZ2h0cyBhcHBzIDEgLyBhY3Rpb25zIC45NSAvIGZpbGVzIC45KSBcdTAwQjcgY2FwcGVkIGxvZzIgZnJlY2VuY3lcbi8vICAgZ2hvc3QgYXV0b2NvbXBsZXRlID0gZmlyc3QgcHJlZml4LWNvbXBsZXRhYmxlIG5hbWUgaW4gZGlzcGxheSBvcmRlclxuLy8gICBUYWIgYWx3YXlzIG93bmVkIChnaG9zdCBlbHNlIG5leHQ7IFNoaWZ0K1RhYiBwcmV2KSBcdTAwQjcgQ3RybCtOL1AgXHUwMEI3IEVzYyBjbGVhcnMgZmlyc3Rcbi8vICAgc2VjdGlvbnM6IGJlc3QgbWF0Y2ggLyBhcHBzIC8gYWN0aW9ucyAvIGZpbGVzIC8gd2ViIChhbHdheXMtbGFzdCByZWFsIHJvdylcbi8vICAgJz0nIGNhbGN1bGF0b3IgXHUwMEI3ICc6JyBnbm9ibGluY3RsIGNvbW1hbmRzIFx1MDBCNyBlbXB0eSBzdGF0ZTogZG9jay10aWxlIGdyaWQgKyB3aWRnZXRzXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIsIHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgeyBmdXp6eSwgaGwsIGJvb3N0LCBidW1wLCBmcmVxdWVuY3kgfSBmcm9tIFwiLi4vbGliL2Z1enp5XCJcbmltcG9ydCB7IEVWRU5UUyB9IGZyb20gXCIuL0NhbGVuZGFyXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG4vLyBDdXJhdGVkIGdyaWQ6IHRoZSBkb2NrJ3MgcGlubmVkIGFwcHMgZmlyc3QgKHJlc29sdmVkIGJ5IGRlc2t0b3AtaWQpLCB0aGVuIGZpbGwgdGhlXG4vLyByZW1haW5pbmcgc2xvdHMgYnkgZnJlY2VuY3kuIE1hdGNoZXMgdGhlIHByb3RvdHlwZSdzIGxhdW5jaGVyIGVtcHR5LXN0YXRlLlxuY29uc3QgUElOTkVEID0gW1xuICAgIFwib3JnLmdub21lLlB0eXhpc1wiLFxuICAgIFwib3JnLmdub21lLk5hdXRpbHVzXCIsXG4gICAgXCJmaXJlZm94XCIsXG4gICAgXCJkZXYuemVkLlplZFwiLFxuICAgIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsXG4gICAgXCJvcmcuZ25vbWUuU2V0dGluZ3NcIixcbl1cbi8vIERlbW8gZ3JpZDogZml4ZWQgb3JkZXIgKyBsYWJlbHMgdHJhbnNjcmliZWQgZnJvbSB0aGUgcHJvdG90eXBlIChELmFwcHMpLCBlYWNoIG1hcHBlZFxuLy8gdG8gdGhlIHJlYWwgLmRlc2t0b3AgaWQgc28gaXRzIHRoZW1lZCBpY29uIHJlbmRlcnMgKFB0eXhpcy9OYXV0aWx1cy9cdTIwMjYpLlxuY29uc3QgREVNT19USUxFUyA9IFtcbiAgICB7IG5hbWU6IFwiVGVybWluYWxcIiwgaWQ6IFwib3JnLmdub21lLlB0eXhpc1wiIH0sXG4gICAgeyBuYW1lOiBcIkZpbGVzXCIsIGlkOiBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiIH0sXG4gICAgeyBuYW1lOiBcIkZpcmVmb3hcIiwgaWQ6IFwiZmlyZWZveFwiIH0sXG4gICAgeyBuYW1lOiBcIlplZFwiLCBpZDogXCJkZXYuemVkLlplZFwiIH0sXG4gICAgeyBuYW1lOiBcIlNwb3RpZnlcIiwgaWQ6IFwiY29tLnNwb3RpZnkuQ2xpZW50XCIgfSxcbiAgICB7IG5hbWU6IFwiU2V0dGluZ3NcIiwgaWQ6IFwib3JnLmdub21lLlNldHRpbmdzXCIgfSxcbl1cblxuaW50ZXJmYWNlIFRpbGUge1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIGljb25OYW1lOiBzdHJpbmdcbiAgICBsYXVuY2g6ICgpID0+IHZvaWRcbn1cbmZ1bmN0aW9uIGdyaWRUaWxlcyhhcHBzOiBBcHBzLkFwcHMpOiBUaWxlW10ge1xuICAgIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICAgIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZCkgPz9cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgICBjb25zdCBmcm9tQXBwID0gKGFwcDogQXBwcy5BcHBsaWNhdGlvbik6IFRpbGUgPT4gKHtcbiAgICAgICAgbmFtZTogYXBwLm5hbWUsXG4gICAgICAgIGljb25OYW1lOiBhcHAuaWNvbl9uYW1lIHx8IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgIGxhdW5jaDogKCkgPT4ge1xuICAgICAgICAgICAgYnVtcChhcHAubmFtZSlcbiAgICAgICAgICAgIGFwcC5sYXVuY2goKVxuICAgICAgICB9LFxuICAgIH0pXG4gICAgaWYgKERFTU8pXG4gICAgICAgIHJldHVybiBERU1PX1RJTEVTLm1hcCgoeyBuYW1lLCBpZCB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSByZXNvbHZlKGlkKVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgICAgIGljb25OYW1lOiBhcHA/Lmljb25fbmFtZSB8fCBpZCB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICAgICAgICAgIGxhdW5jaDogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBidW1wKG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIGFwcD8ubGF1bmNoKClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIGNvbnN0IHBpbm5lZCA9IFBJTk5FRC5tYXAocmVzb2x2ZSkuZmlsdGVyKEJvb2xlYW4pIGFzIEFwcHMuQXBwbGljYXRpb25bXVxuICAgIGNvbnN0IHJlc3QgPSBhbGxcbiAgICAgICAgLmZpbHRlcigoYSkgPT4gIXBpbm5lZC5pbmNsdWRlcyhhKSlcbiAgICAgICAgLnNvcnQoKHgsIHkpID0+IGZyZXF1ZW5jeSh5Lm5hbWUpIC0gZnJlcXVlbmN5KHgubmFtZSkpXG4gICAgcmV0dXJuIFsuLi5waW5uZWQsIC4uLnJlc3RdLnNsaWNlKDAsIDYpLm1hcChmcm9tQXBwKVxufVxuZnVuY3Rpb24gdG9kYXlFdmVudExhYmVsKCk6IHN0cmluZyB7XG4gICAgaWYgKERFTU8pIHJldHVybiBELndpZGdldEV2ZW50XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKClcbiAgICBjb25zdCBldnMgPSBFVkVOVFNbYCR7ZC5nZXRGdWxsWWVhcigpfS0ke2QuZ2V0TW9udGgoKSArIDF9LSR7ZC5nZXREYXRlKCl9YF0gPz8gW11cbiAgICByZXR1cm4gZXZzLmxlbmd0aCA/IGAke2V2c1swXS50fSBcdTAwQjcgJHtldnNbMF0ubn1gIDogXCJObyBldmVudHMgdG9kYXlcIlxufVxuZnVuY3Rpb24gdG9kYXlEYXRlTGFiZWwoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gREVNT1xuICAgICAgICA/IEQud2lkZ2V0RGF0ZVxuICAgICAgICA6IG5ldyBEYXRlKCkudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwgeyB3ZWVrZGF5OiBcImxvbmdcIiwgZGF5OiBcIm51bWVyaWNcIiwgbW9udGg6IFwibG9uZ1wiIH0pXG59XG5cbmludGVyZmFjZSBSb3cge1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIGhpbnQ6IHN0cmluZ1xuICAgIHNjb3JlOiBudW1iZXJcbiAgICBtYXJrdXA6IHN0cmluZ1xuICAgIHJ1bjogKCkgPT4gdm9pZFxufVxuXG5jb25zdCBBQ1RJT05TID0gW1xuICAgIHtcbiAgICAgICAgbjogXCJTdXNwZW5kXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbW9vbi1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlNsZWVwIFx1MjAxNCByZXN1bWUgaW5zdGFudGx5XCIsXG4gICAgICAgIGFsOiBbXCJzbGVlcFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgc3VzcGVuZFwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJMb2NrXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIkxvY2sgdGhlIHNlc3Npb25cIixcbiAgICAgICAgYWw6IFtcImxvY2sgc2NyZWVuXCJdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJMb2cgT3V0XCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiRW5kIHRoaXMgc2Vzc2lvblwiLFxuICAgICAgICBhbDogW1wiZXhpdFwiLCBcInNpZ24gb3V0XCIsIFwibG9nb3V0XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlJlc3RhcnRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJSZWJvb3QgdGhlIG1hY2hpbmVcIixcbiAgICAgICAgYWw6IFtcInJlYm9vdFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJTaHV0IERvd25cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlBvd2VyIG9mZlwiLFxuICAgICAgICBhbDogW1wicG93ZXJvZmZcIiwgXCJoYWx0XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlNvZnQtcmVsb2FkIGdub2JsaW5cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJSZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIixcbiAgICAgICAgYWw6IFtdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImdub2JsaW5jdGwgcmVsb2FkXCIpLFxuICAgIH0sXG5dXG5cbmNvbnN0IENNRFMgPSBbXG4gICAgeyBjOiBcInJlbG9hZFwiLCBkOiBcIlNvZnQtcmVsb2FkIHRoZSBzaGVsbCBcdTIwMTQgd2luZG93cyBzdXJ2aXZlXCIgfSxcbiAgICB7IGM6IFwib3NkIG9mZlwiLCBkOiBcImtvYmVsIG93bnMgdm9sdW1lL2JyaWdodG5lc3MgcG9wdXBzXCIgfSxcbiAgICB7IGM6IFwibm90aWZzIG9mZlwiLCBkOiBcIlJlbGVhc2Ugb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnNcIiB9LFxuICAgIHsgYzogXCJncmFudHNcIiwgZDogXCJTY3JlZW4tcmVjb3JkaW5nIGFjY2VzcyBwZXIgYXBwXCIgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTGF1bmNoZXIoKSB7XG4gICAgY29uc3QgYXBwcyA9IG5ldyBBcHBzLkFwcHMoKVxuICAgIC8vIEtPQkVMX1FVRVJZIHByZS1maWxscyB0aGUgc2VhcmNoIHNvIHRoZSBkZXZraXQgY2FuIHJlbmRlciB0aGUgcmVzdWx0cyBzdGF0ZS5cbiAgICBjb25zdCBxdWVyeSA9IFZhcmlhYmxlKEdMaWIuZ2V0ZW52KFwiS09CRUxfUVVFUllcIikgfHwgXCJcIilcbiAgICBjb25zdCBzZWxlY3RlZCA9IFZhcmlhYmxlKDApXG4gICAgY29uc3QgZ2hvc3QgPSBWYXJpYWJsZShcIlwiKVxuXG4gICAgZnVuY3Rpb24gcmVzdWx0cyhxOiBzdHJpbmcpOiB7IHNlY3Rpb246IHN0cmluZzsgcm93czogUm93W10gfVtdIHtcbiAgICAgICAgY29uc3QgcXQgPSBxLnRyaW0oKVxuICAgICAgICBpZiAoIXF0KSByZXR1cm4gW11cbiAgICAgICAgaWYgKHF0LnN0YXJ0c1dpdGgoXCI6XCIpKSB7XG4gICAgICAgICAgICBjb25zdCBjcSA9IHF0LnNsaWNlKDEpLnRyaW0oKVxuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHNlY3Rpb246IFwiZ25vYmxpbmN0bFwiLFxuICAgICAgICAgICAgICAgICAgICByb3dzOiBDTURTLmZpbHRlcigoYykgPT4gYy5jLnN0YXJ0c1dpdGgoY3EpKS5tYXAoKGMpID0+ICh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBgOiR7Yy5jfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLXRlcm1pbmFsLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBoaW50OiBjLmQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzY29yZTogOTksXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGA6JHtjLmN9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKGBnbm9ibGluY3RsICR7Yy5jfWApLFxuICAgICAgICAgICAgICAgICAgICB9KSksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXQ6IHsgc2VjdGlvbjogc3RyaW5nOyByb3dzOiBSb3dbXSB9W10gPSBbXVxuICAgICAgICAvLyAnPScgY2FsY3VsYXRvciAoY2hhcnNldC1ndWFyZGVkLCBzYW1lIGFzIHByb3RvdHlwZSlcbiAgICAgICAgaWYgKC9ePT9bMC05K1xcLSovKCkuIF0rJC8udGVzdChxdCkgJiYgL1swLTldLy50ZXN0KHF0KSAmJiAvWytcXC0qL10vLnRlc3QocXQpKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHYgPSBGdW5jdGlvbihgXCJ1c2Ugc3RyaWN0XCI7cmV0dXJuKCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0pYCkoKVxuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUodikpXG4gICAgICAgICAgICAgICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlY3Rpb246IFwiY2FsY3VsYXRvclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgcm93czogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogU3RyaW5nKHYpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLWNhbGN1bGF0b3Itc3ltYm9saWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGludDogYCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0gPWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjb3JlOiA5OCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBTdHJpbmcodiksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcIndsLWNvcHlcIiwgU3RyaW5nKHYpXSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXBwUm93czogUm93W10gPSBhcHBzXG4gICAgICAgICAgICAuZnV6enlfcXVlcnkocXQpXG4gICAgICAgICAgICAuc2xpY2UoMCwgNSlcbiAgICAgICAgICAgIC5tYXAoKGEpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtID0gZnV6enkocXQsIGEubmFtZSkgPz8geyBzY29yZTogMSwgbWFya3M6IG51bGwgYXMgYW55IH1cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBhLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGljb246IGEuaWNvbl9uYW1lID8/IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgICAgICAgICAgICAgIGhpbnQ6IFwiQXBwbGljYXRpb25cIixcbiAgICAgICAgICAgICAgICAgICAgc2NvcmU6IG0uc2NvcmUgKyBib29zdChhLm5hbWUpLFxuICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGhsKGEubmFtZSwgbS5tYXJrcyksXG4gICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgYnVtcChhLm5hbWUpXG4gICAgICAgICAgICAgICAgICAgICAgICBhLmxhdW5jaCgpXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgY29uc3QgYWN0Um93czogUm93W10gPSBBQ1RJT05TLm1hcCgoeCkgPT4ge1xuICAgICAgICAgICAgbGV0IG0gPSBmdXp6eShxdCwgeC5uKVxuICAgICAgICAgICAgaWYgKCFtKVxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYWwgb2YgeC5hbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbSA9IGZ1enp5KHF0LCBhbClcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtID0geyBzY29yZTogYW0uc2NvcmUgLSAwLjUsIG1hcmtzOiBudWxsIGFzIGFueSB9XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG1cbiAgICAgICAgICAgICAgICA/ICh7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogeC5uLFxuICAgICAgICAgICAgICAgICAgICAgIGljb246IHguaWNvbixcbiAgICAgICAgICAgICAgICAgICAgICBoaW50OiB4LmQsXG4gICAgICAgICAgICAgICAgICAgICAgc2NvcmU6IG0uc2NvcmUgKiAwLjk1LFxuICAgICAgICAgICAgICAgICAgICAgIG1hcmt1cDogaGwoeC5uLCAobSBhcyBhbnkpLm1hcmtzKSxcbiAgICAgICAgICAgICAgICAgICAgICBydW46IHgucnVuLFxuICAgICAgICAgICAgICAgICAgfSBhcyBSb3cpXG4gICAgICAgICAgICAgICAgOiBudWxsXG4gICAgICAgIH0pLmZpbHRlcihCb29sZWFuKSBhcyBSb3dbXVxuICAgICAgICAvLyBnbG9iYWwgYmVzdC1tYXRjaCBzbG90IChjcml0aXF1ZSBBMSlcbiAgICAgICAgY29uc3QgYWxsID0gWy4uLmFwcFJvd3MsIC4uLmFjdFJvd3NdLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKVxuICAgICAgICBjb25zdCBiZXN0ID0gYWxsWzBdXG4gICAgICAgIGlmIChiZXN0KSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYmVzdCBtYXRjaFwiLCByb3dzOiBbYmVzdF0gfSlcbiAgICAgICAgY29uc3QgcmVzdCA9IChyb3dzOiBSb3dbXSkgPT4gcm93cy5maWx0ZXIoKHIpID0+IHIgIT09IGJlc3QpXG4gICAgICAgIGlmIChyZXN0KGFwcFJvd3MpLmxlbmd0aCkgb3V0LnB1c2goeyBzZWN0aW9uOiBcImFwcHNcIiwgcm93czogcmVzdChhcHBSb3dzKSB9KVxuICAgICAgICBpZiAocmVzdChhY3RSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhY3Rpb25zXCIsIHJvd3M6IHJlc3QoYWN0Um93cykuc2xpY2UoMCwgMykgfSlcbiAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgc2VjdGlvbjogXCJ3ZWJcIixcbiAgICAgICAgICAgIHJvd3M6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLWdsb2JlLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgIGhpbnQ6IFwiXCIsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICAgICAgICAgICAgICBydW46ICgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBleGVjQXN5bmMoW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwieGRnLW9wZW5cIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgaHR0cHM6Ly9kdWNrZHVja2dvLmNvbS8/cT0ke2VuY29kZVVSSUNvbXBvbmVudChxdCl9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0pLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KVxuICAgICAgICAvLyBnaG9zdCA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXIgKGNyaXRpcXVlIEE0KVxuICAgICAgICBjb25zdCBnID0gb3V0XG4gICAgICAgICAgICAuZmxhdE1hcCgocykgPT4gcy5yb3dzKVxuICAgICAgICAgICAgLm1hcCgocikgPT4gci5uYW1lKVxuICAgICAgICAgICAgLmZpbmQoKG4pID0+IG4udG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHF0LnRvTG93ZXJDYXNlKCkpICYmIG4ubGVuZ3RoID4gcXQubGVuZ3RoKVxuICAgICAgICBnaG9zdC5zZXQoZyA/PyBcIlwiKVxuICAgICAgICByZXR1cm4gb3V0XG4gICAgfVxuXG4gICAgY29uc3Qgc2VjdGlvbnMgPSBiaW5kKHF1ZXJ5KS5hcyhyZXN1bHRzKVxuXG4gICAgY29uc3Qge1xuICAgICAgICB3aW5WaXNpYmxlLFxuICAgICAgICByZXZlYWxlZDogbGF1bmNoUmV2ZWFsZWQsXG4gICAgICAgIHNldFJldmVhbGVyOiBzZXRMYXVuY2hSZXZlYWxlcixcbiAgICAgICAgY2xvc2U6IGxhdW5jaENsb3NlLFxuICAgICAgICB0b2dnbGU6IHRvZ2dsZUZuLFxuICAgIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwibGF1bmNoZXJcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImxhdW5jaGVyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWxhdW5jaGVyXCJcbiAgICAgICAgICAgIGNsYXNzPVwibGF1bmNoZXItd2luZG93XCJcbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUH1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5LCBfY29kZSwgbW9kcykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZsYXQgPSByZXN1bHRzKHF1ZXJ5LmdldCgpKS5mbGF0TWFwKChzKSA9PiBzLnJvd3MpXG4gICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHF1ZXJ5LmdldCgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoXCJcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1RhYikge1xuICAgICAgICAgICAgICAgICAgICAvLyBUYWIgaXMgQUxXQVlTIG93bmVkXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGcgPSBnaG9zdC5nZXQoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHEgPSBxdWVyeS5nZXQoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoZyAmJiAhKG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLlNISUZUX01BU0spKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoZylcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KFxuICAgICAgICAgICAgICAgICAgICAgICAgKHNlbGVjdGVkLmdldCgpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSyA/IC0xIDogMSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZsYXQubGVuZ3RoKSAlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICBtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5DT05UUk9MX01BU0sgJiZcbiAgICAgICAgICAgICAgICAgICAgKGtleSA9PT0gR2RrLktFWV9uIHx8IGtleSA9PT0gR2RrLktFWV9wKVxuICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoXG4gICAgICAgICAgICAgICAgICAgICAgICAoc2VsZWN0ZWQuZ2V0KCkgKyAoa2V5ID09PSBHZGsuS0VZX24gPyAxIDogLTEpICsgZmxhdC5sZW5ndGgpICVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0Rvd24pIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArIDEpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1VwKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgLSAxICsgZmxhdC5sZW5ndGgpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1JldHVybikge1xuICAgICAgICAgICAgICAgICAgICBmbGF0W3NlbGVjdGVkLmdldCgpXT8ucnVuKClcbiAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoXCJcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChsYXVuY2hSZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldExhdW5jaFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzaGVldCBsYXVuY2hlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZmllbGRcIiBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tYWduaWZ5aW5nLWdsYXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxvdmVybGF5IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGVudHJ5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dXA9eyhzZWxmOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuc2V0X21heF93aWR0aF9jaGFycygxKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXRfd2lkdGhfY2hhcnMoMSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dD17YmluZChxdWVyeSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5VGV4dD17KGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChlLnRleHQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoMClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBwbGFjZWhvbGRlciBhcyBhbiBPVkVSTEFZIGxhYmVsIChub3QgZW50cnkgcGxhY2Vob2xkZXJUZXh0KSBzbyBpdHMgdGV4dFxuICAgICAgICAgICAgICB3aWR0aCBjYW4ndCBpbmZsYXRlIHRoZSBlbnRyeSdzIG5hdHVyYWwgc2l6ZSBcdTIxOTIgcGFuZWwgc3RheXMgYXQgbWluLXdpZHRoICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibHBsYWNlaG9sZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQocXVlcnkpLmFzKChxKSA9PiAhcSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiU2VhcmNoIFx1MjAxNCBhcHBzLCBmaWxlcywgYWN0aW9ucyBcdTAwQjcgJzonIGNtZHMgXHUwMEI3ICc9JyBtYXRoc1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT1cIm92ZXJsYXlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImdob3N0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlTWFya3VwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGdob3N0KS5hcygoZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWcgfHwgIXEgfHwgIWcudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHEudG9Mb3dlckNhc2UoKSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVzYyA9IChzOiBzdHJpbmcpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGludmlzaWJsZSBwcmVmaXggKHRha2VzIHVwIHNwYWNlKSArIGRpbSBzdWZmaXgsIG1hdGNoaW5nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm90b3R5cGUncyAjbGctcHJle3Zpc2liaWxpdHk6aGlkZGVufSAvICNsZy1zdWZ7Y29sb3I6ZGltfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGA8c3BhbiBhbHBoYT1cIjBcIj4ke2VzYyhnLnNsaWNlKDAsIHEubGVuZ3RoKSl9PC9zcGFuPjxzcGFuIGNvbG9yPVwiIzhkODY5M1wiPiR7ZXNjKGcuc2xpY2UocS5sZW5ndGgpKX08L3NwYW4+YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwia2JkXCIgbGFiZWw9XCJzdXBlclwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG5cbiAgICAgICAgICAgICAgICAgICAgey8qIGVtcHR5IHN0YXRlOiBjdXJhdGVkIGZyZWNlbmN5IHRpbGUgZ3JpZCArIHdpZGdldCByb3cgKi99XG4gICAgICAgICAgICAgICAgICAgIDxyZXZlYWxlciByZXZlYWxDaGlsZD17YmluZChxdWVyeSkuYXMoKHEpID0+ICFxLnRyaW0oKSl9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwidGlsZXNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezZ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7Z3JpZFRpbGVzKGFwcHMpLm1hcCgodCkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidGlsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHQubGF1bmNoKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXs4fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPXt0Lmljb25OYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17dC5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17OX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogdHdvIGNhcmRzIHNwbGl0IHRoZSByb3cgZXhhY3RseSBpbiBoYWxmIFx1MjAxNCBwcm90byBmbGV4OjEvZmxleDoxICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsd2lkZ2V0c1wiIHNwYWNpbmc9ezd9IGhvbW9nZW5lb3VzPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogbGVmdCBjYXJkIFx1MjAxNCBkYXRlICsgdG9kYXkncyBmaXJzdCBldmVudCAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ3aWRnZXQgbHdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXt0b2RheURhdGVMYWJlbCgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3RvZGF5RXZlbnRMYWJlbCgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiByaWdodCBjYXJkIFx1MjAxNCBtZWRpYSBtaW5pLWNhcmQ6IGFydCBcdTAwQjcgdGl0bGUvYXJ0aXN0IFx1MDBCNyBwbGF5ICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlUGxheWVyID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHMuZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHAucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwc1swXSA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudWxsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZWRpYVRpdGxlID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5tZWRpYS50aXRsZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHEpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcS5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHA/LnRpdGxlID8/IFwiTm90aGluZyBwbGF5aW5nXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZWRpYUFydGlzdCA9IERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IEQubWVkaWEuYXJ0aXN0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8uYXJ0aXN0ID8/IFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwbGF5SWNvbiA9IERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHEpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcS5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHA/LnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFwia29iZWwtcGxheS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwid2lkZ2V0IGx3bVwiIGhleHBhbmQgc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibHdhcnRcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImx3dFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm10aXRsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXttZWRpYVRpdGxlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXttZWRpYUFydGlzdH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm1idG4gcGxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3BsYXlJY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkoKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICA8L3JldmVhbGVyPlxuXG4gICAgICAgICAgICAgICAgICAgIHsvKiByZXN1bHRzICovfVxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibHJvd3NcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtzZWN0aW9ucy5hcygoc2VjcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWNzLmZsYXRNYXAoKHNlYykgPT4gW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJzZWNcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3NlYy5zZWN0aW9ufSAvPixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLi4uc2VjLnJvd3MubWFwKChyKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmbGF0SWR4ID0gc2Vjcy5mbGF0TWFwKChzKSA9PiBzLnJvd3MpLmluZGV4T2YocilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17YmluZChzZWxlY3RlZCkuYXMoKHMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzID09PSBmbGF0SWR4ID8gXCJyb3cgc2VsXCIgOiBcInJvd1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgci5ydW4oKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogMjhcdTAwRDcyOCByOCBwYW5lbDIgZnJhbWUgYXJvdW5kIHRoZSAyNHB4IGljb24gKHByb3RvdHlwZSAucmkpICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInJpXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3IuaWNvbn0gcGl4ZWxTaXplPXsyNH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD17ci5tYXJrdXB9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImhpbnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3IuaGludH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInJ1bmtcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiXHUyMUI1XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHNlbGVjdGVkKS5hcyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHMpID0+IHMgPT09IGZsYXRJZHhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIF0pXG4gICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgICAgICAgICB7LyogZm9vdGVyIGhpbnQgcm93IFx1MjAxNCBtYXRjaGVzIHByb3RvdHlwZSAubGZvb3QgKi99XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsZm9vdFwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxNH0gaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD1cIjxiPjpyZWxvYWQ8L2I+IHNvZnQtcmVsb2FkXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+Om9zZDwvYj4gdG9nZ2xlXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OmdyYW50czwvYj4gc2NyZWVuIGFjY2Vzc1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIlx1MjE5MVx1MjE5MyBzZWxlY3QgXHUwMEI3IFx1MjFCNSBydW5cIiBoYWxpZ249e0d0ay5BbGlnbi5FTkR9IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIExhdW5jaGVyIG1hdGNoaW5nIFx1MjAxNCBzdHJhaWdodCBwb3J0IG9mIHRoZSBwcm90b3R5cGUgKHBvc3QtY3JpdGlxdWUgdmVyc2lvbik6XG4vLyBzdWJzZXF1ZW5jZSBmdXp6eSB3aXRoIHdvcmQtYm91bmRhcnkgYm9udXMsIGNhcHBlZCBsb2cyIGZyZWNlbmN5LCBwcmVmaXggZ2hvc3QuXG5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE1hdGNoIHtcbiAgICBzY29yZTogbnVtYmVyXG4gICAgbWFya3M6IG51bWJlcltdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmdXp6eShxOiBzdHJpbmcsIHQ6IHN0cmluZyk6IE1hdGNoIHwgbnVsbCB7XG4gICAgY29uc3QgcWwgPSBxLnRvTG93ZXJDYXNlKCksXG4gICAgICAgIHRsID0gdC50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHFpID0gMCxcbiAgICAgICAgc2NvcmUgPSAwLFxuICAgICAgICBsYXN0ID0gLTJcbiAgICBjb25zdCBtYXJrczogbnVtYmVyW10gPSBbXVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGwubGVuZ3RoICYmIHFpIDwgcWwubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgaWYgKHRsW2ldID09PSBxbFtxaV0pIHtcbiAgICAgICAgICAgIG1hcmtzLnB1c2goaSlcbiAgICAgICAgICAgIHNjb3JlICs9IGkgPT09IDAgfHwgXCIgLV8uL1wiLmluY2x1ZGVzKHRbaSAtIDFdKSA/IDQgOiBsYXN0ID09PSBpIC0gMSA/IDIgOiAxXG4gICAgICAgICAgICBsYXN0ID0gaVxuICAgICAgICAgICAgcWkrK1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBxaSA9PT0gcWwubGVuZ3RoID8geyBzY29yZTogc2NvcmUgLSB0Lmxlbmd0aCAqIDAuMDIsIG1hcmtzIH0gOiBudWxsXG59XG5cbi8vIFBhbmdvIG1hcmt1cCBoaWdobGlnaHQgKGVzY2FwZXM7IGxlYWYgYWNjZW50IG9uIG1hdGNoZWQgY2hhcnMpXG5leHBvcnQgZnVuY3Rpb24gaGwodDogc3RyaW5nLCBtYXJrczogbnVtYmVyW10gfCBudWxsKTogc3RyaW5nIHtcbiAgICBjb25zdCBlc2MgPSAoYzogc3RyaW5nKSA9PiBHTGliLm1hcmt1cF9lc2NhcGVfdGV4dChjLCAtMSlcbiAgICBpZiAoIW1hcmtzKSByZXR1cm4gZXNjKHQpXG4gICAgY29uc3QgbSA9IG5ldyBTZXQobWFya3MpXG4gICAgbGV0IG91dCA9IFwiXCJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspXG4gICAgICAgIG91dCArPSBtLmhhcyhpKSA/IGA8c3BhbiBmb3JlZ3JvdW5kPVwiI2I1Y2I0OFwiPiR7ZXNjKHRbaV0pfTwvc3Bhbj5gIDogZXNjKHRbaV0pXG4gICAgcmV0dXJuIG91dFxufVxuXG4vLyBGcmVjZW5jeTogY2FwcGVkIHNvIGFuIGV4YWN0IHByZWZpeCBtYXRjaCBBTFdBWVMgYmVhdHMgaGFiaXQgKGNyaXRpcXVlIEEyKS5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvZnJlcS5qc29uYFxubGV0IGZyZXE6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fVxudHJ5IHtcbiAgICBmcmVxID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoR0xpYi5maWxlX2dldF9jb250ZW50cyhTVE9SRSlbMV0pKVxufSBjYXRjaCB7fVxuXG5leHBvcnQgY29uc3QgYm9vc3QgPSAoaWQ6IHN0cmluZykgPT4gTWF0aC5taW4oTWF0aC5sb2cyKDEgKyAoZnJlcVtpZF0gPz8gMCkpLCAzKVxuXG5leHBvcnQgZnVuY3Rpb24gYnVtcChpZDogc3RyaW5nKSB7XG4gICAgZnJlcVtpZF0gPSAoZnJlcVtpZF0gPz8gMCkgKyAxXG4gICAgR0xpYi5ta2Rpcl93aXRoX3BhcmVudHMoR0xpYi5wYXRoX2dldF9kaXJuYW1lKFNUT1JFKSwgMG83NTUpXG4gICAgR0xpYi5maWxlX3NldF9jb250ZW50cyhTVE9SRSwgSlNPTi5zdHJpbmdpZnkoZnJlcSkpXG59XG5cbmV4cG9ydCBjb25zdCBmcmVxdWVuY3kgPSAoaWQ6IHN0cmluZykgPT4gZnJlcVtpZF0gPz8gMFxuIiwgIi8vIENhbGVuZGFyIHBvcG92ZXIgXHUyMDE0IEdOT01FIHJlcGxpY2EgcGVyIHRoZSBwcm90b3R5cGU6IGhlcm8gZGF0ZSwgXHUyMDM5IG1vbnRoIFx1MjAzQSBuYXZcbi8vICh0aXRsZSBjbGljayA9IHRvZGF5KSwgSVNPIHdlZWsgbnVtYmVycyBhcyBxdWlldCBkaW0gdGV4dCwgRElNTUVEIFdFRUtFTkRTLFxuLy8gY2xpY2thYmxlIGRheXMgdy8gc2VsZWN0aW9uIHJpbmcgKGluayByaW5nIG9uIHRvZGF5KSwgZXZlbnQtZG90IG1hcmtlcnMsXG4vLyBldmVudHMgY2FyZCBpbiB0aGUgbm90aWZpY2F0aW9uLWNhcmQgbGFuZ3VhZ2UuIE1vbnRocyBzbGlkZSAobXVsdGl2aWV3IG1vdGlvbikuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcblxuaW50ZXJmYWNlIEV2IHtcbiAgICB0OiBzdHJpbmdcbiAgICBuOiBzdHJpbmdcbiAgICBpY29uOiBzdHJpbmdcbn1cbi8vIFwidG9kYXlcIiBcdTIwMTQgdW5kZXIgS09CRUxfREVNTywgcGlubmVkIHRvIEQudG9kYXk7IHJlYWwgY2xvY2sgb3RoZXJ3aXNlLlxuLy8gdG9kYXlWYXIgcG9sbHMgZXZlcnkgNjBzIHNvIHRoZSBoZXJvIGRhdGUgdXBkYXRlcyB3aXRob3V0IGEgcmVsb2FkLlxuY29uc3QgdG9kYXlWYXIgPSBERU1PXG4gICAgPyBWYXJpYWJsZShuZXcgRGF0ZShELnRvZGF5LnksIEQudG9kYXkubSwgRC50b2RheS5kKSlcbiAgICA6IFZhcmlhYmxlKG5ldyBEYXRlKCkpLnBvbGwoNjBfMDAwLCAoKSA9PiBuZXcgRGF0ZSgpKVxuY29uc3Qgbm93ID0gdG9kYXlWYXIuZ2V0KClcbmNvbnN0IGtleSA9ICh5OiBudW1iZXIsIG06IG51bWJlciwgZDogbnVtYmVyKSA9PiBgJHt5fS0ke20gKyAxfS0ke2R9YFxuZXhwb3J0IGNvbnN0IEVWRU5UUzogUmVjb3JkPHN0cmluZywgRXZbXT4gPSB7XG4gICAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpXTogW1xuICAgICAgICB7IHQ6IFwiMDk6NDVcIiwgbjogXCJEYWlseSBTdGFuZHVwXCIsIGljb246IFwia29iZWwtdmlkZW8tc3ltYm9saWNcIiB9LFxuICAgIF0sXG4gICAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIDExKV06IFtcbiAgICAgICAgeyB0OiBcIjEwOjMwXCIsIG46IFwiS2llcmFuIEJpcnRoZGF5XCIsIGljb246IFwia29iZWwtY2FrZS1zeW1ib2xpY1wiIH0sXG4gICAgICAgIHsgdDogXCIxMzowMFwiLCBuOiBcIkxvbmRvbiBUaGluZ1wiLCBpY29uOiBcImtvYmVsLXBpbi1zeW1ib2xpY1wiIH0sXG4gICAgXSxcbiAgICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMTMpXTogW1xuICAgICAgICB7IHQ6IFwiQWxsIGRheVwiLCBuOiBcIk15IEJpcnRoZGF5XCIsIGljb246IFwia29iZWwtY2FrZS1zeW1ib2xpY1wiIH0sXG4gICAgXSxcbn1cblxuY29uc3QgdmlldyA9IFZhcmlhYmxlKHsgeTogbm93LmdldEZ1bGxZZWFyKCksIG06IG5vdy5nZXRNb250aCgpIH0pXG5jb25zdCBzZWwgPSBWYXJpYWJsZShuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpKVxuXG5mdW5jdGlvbiBpc29XZWVrKGQ6IERhdGUpOiBudW1iZXIge1xuICAgIGNvbnN0IHQgPSBuZXcgRGF0ZShEYXRlLlVUQyhkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpKVxuICAgIGNvbnN0IGRuID0gKHQuZ2V0VVRDRGF5KCkgKyA2KSAlIDdcbiAgICB0LnNldFVUQ0RhdGUodC5nZXRVVENEYXRlKCkgLSBkbiArIDMpXG4gICAgY29uc3QgZiA9IG5ldyBEYXRlKERhdGUuVVRDKHQuZ2V0VVRDRnVsbFllYXIoKSwgMCwgNCkpXG4gICAgcmV0dXJuIDEgKyBNYXRoLnJvdW5kKCgoK3QgLSArZikgLyA4NjRlNSAtIDMgKyAoKGYuZ2V0VVRDRGF5KCkgKyA2KSAlIDcpKSAvIDcpXG59XG5cbmZ1bmN0aW9uIEdyaWQoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImNhbC1ncmlkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAgICAgICAgICB7YmluZChWYXJpYWJsZS5kZXJpdmUoW3ZpZXcsIHNlbF0sICh2LCBzKSA9PiAoeyB2LCBzIH0pKSkuYXMoKHsgdiwgcyB9KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmlyc3QgPSBuZXcgRGF0ZSh2LnksIHYubSwgMSlcbiAgICAgICAgICAgICAgICBjb25zdCBzdGFydCA9IChmaXJzdC5nZXREYXkoKSArIDYpICUgN1xuICAgICAgICAgICAgICAgIGNvbnN0IGRheXMgPSBuZXcgRGF0ZSh2LnksIHYubSArIDEsIDApLmdldERhdGUoKVxuICAgICAgICAgICAgICAgIGNvbnN0IHByZXZEYXlzID0gbmV3IERhdGUodi55LCB2Lm0sIDApLmdldERhdGUoKVxuICAgICAgICAgICAgICAgIGNvbnN0IHJvd3MgPSBbXVxuICAgICAgICAgICAgICAgIHJvd3MucHVzaChcbiAgICAgICAgICAgICAgICAgICAgPGJveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB3aWR0aFJlcXVlc3Q9ezIyfSBsYWJlbD1cIlwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGhvbW9nZW5lb3VzIGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1tcIk1cIiwgXCJUXCIsIFwiV1wiLCBcIlRcIiwgXCJGXCIsIFwiU1wiLCBcIlNcIl0ubWFwKChkKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImRvd1wiIGxhYmVsPXtkfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICBmb3IgKGxldCByID0gMDsgciA8IDY7IHIrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB3a0xhYmVsID0gKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ3ayB0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd2lkdGhSZXF1ZXN0PXsyMn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2Ake2lzb1dlZWsobmV3IERhdGUodi55LCB2Lm0sIHIgKiA3IC0gc3RhcnQgKyAxKSl9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZGF5Q2VsbHMgPSBbXVxuICAgICAgICAgICAgICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDc7IGMrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaSA9IHIgKiA3ICsgYyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkID0gaSAtIHN0YXJ0ICsgMVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb3V0ID0gZCA8IDEgfHwgZCA+IGRheXNcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gb3V0ID8gKGQgPCAxID8gcHJldkRheXMgKyBkIDogZCAtIGRheXMpIDogZFxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xzID0gW1wiZGF5XCJdXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoYyA+PSA1KSBjbHMucHVzaChcIndlXCIpIC8vIFdFRUtFTkRTIERJTU1FRFxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG91dCkgY2xzLnB1c2goXCJvdXRcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRvZGF5ID0gbm93XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkID09PSB0b2RheS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdi5tID09PSB0b2RheS5nZXRNb250aCgpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHYueSA9PT0gdG9kYXkuZ2V0RnVsbFllYXIoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xzLnB1c2goXCJ0b2RheVwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChFVkVOVFNba2V5KHYueSwgdi5tLCBkKV0pIGNscy5wdXNoKFwiZXZcIikgLy8gZXZlbnQtZG90IChDU1MgOjphZnRlciBcdTIxOTIgdW5kZXJsaW5lIGRvdClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMuZ2V0RGF0ZSgpID09PSBkICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMuZ2V0TW9udGgoKSA9PT0gdi5tICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMuZ2V0RnVsbFllYXIoKSA9PT0gdi55XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHMucHVzaChcInNlbFwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaGFzRXYgPSAhb3V0ICYmICEhRVZFTlRTW2tleSh2LnksIHYubSwgZCldXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBkYXkgc2l0cyBhdCBpdHMgbmF0dXJhbCAyNFx1MDBENzI0IGNlbnRyZWQgaW4gdGhlIGdyaWQgY29sdW1uXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXlDZWxscy5wdXNoKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG91dCA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2Ake2xhYmVsfWB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e2Nscy5qb2luKFwiIFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc2VsLnNldChuZXcgRGF0ZSh2LnksIHYubSwgZCkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7aGFzRXYgPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD17YCR7bGFiZWx9YH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIDNweCBldmVudCBkb3QsIGFic29sdXRlIGJvdHRvbS1jZW50ZXIgKEdUSyBoYXMgbm8gOjphZnRlcikgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZXZkb3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXtgJHtsYWJlbH1gfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIC8vIHdrIGNvbCBmaXhlZCAyOHB4LCBkYXkgY2VsbHMgc2hhcmUgcmVtYWluaW5nIHNwYWNlIGVxdWFsbHkgKGhvbW9nZW5lb3VzKVxuICAgICAgICAgICAgICAgICAgICByb3dzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHt3a0xhYmVsfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggaG9tb2dlbmVvdXMgaGV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge2RheUNlbGxzfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJvd3NcbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIEV2ZW50c0NhcmQoKSB7XG4gICAgLy8gUHJvdG90eXBlIC5jYWxldjogYSBwYW5lbDIgY2FyZCAocGFkMTAvcjEyKSB3cmFwcGluZyB0aGUgZGF0ZSBoZWFkZXIgKyBkYXJrZXJcbiAgICAvLyAoLS1wYW5lbCkgZXZlbnQgcm93czsgaGVhZGVyJ3Mgb3duIGJvdHRvbSBwYWRkaW5nIGlzIHRoZSBoZWFkZXJcdTIxOTJyb3cgZ2FwIChzcGFjaW5nIDApLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJldmNhcmRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgIHtiaW5kKHNlbCkuYXMoKGQpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBldnMgPSBFVkVOVFNba2V5KGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSldID8/IFtdXG4gICAgICAgICAgICAgICAgY29uc3QgaGVhZCA9IChcbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImV2aGVhZFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB3ZWVrZGF5OiBcImxvbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXk6IFwibnVtZXJpY1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1vbnRoOiBcImxvbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICBpZiAoIWV2cy5sZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAgICAgICAgICBoZWFkLFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImV2ZW1wdHlcIiBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jYWxlbmRhci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiTm8gZXZlbnRzXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PixcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAgICAgIGhlYWQsXG4gICAgICAgICAgICAgICAgICAgIC4uLmV2cy5tYXAoKGUpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJldnJvd1wiIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogMjZcdTAwRDcyNiByOCBjb2xvcmVkIGljb24gdGlsZSAocHJvdG90eXBlIC5ldmljKSwgd2hpdGUgZ2x5cGggKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImV2aWNcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e2UuaWNvbn0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBlbGxpcHNpemU9ezN9IGxhYmVsPXtlLm59IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YiB0blwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17ZS50fSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICkpLFxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIENhbGVuZGFyKCkge1xuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgyMjAsIDE1MClcbiAgICByZWdpc3RlcihcImNhbGVuZGFyXCIsIHRvZ2dsZUZuKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJjYWxlbmRhclwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1jYWxlbmRhclwiXG4gICAgICAgICAgICBjbGFzcz1cImNhbGVuZGFyLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4gKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9ET1dOfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNoZWV0IGNhbFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2FsaGVyb1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzdWJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHRvZGF5VmFyKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7IHdlZWtkYXk6IFwibG9uZ1wiIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImhlcm9cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHRvZGF5VmFyKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXk6IFwibnVtZXJpY1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9udGg6IFwibG9uZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeWVhcjogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICA8Y2VudGVyYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2ID0gdmlldy5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWV3LnNldCh2Lm0gPyB7IHk6IHYueSwgbTogdi5tIC0gMSB9IDogeyB5OiB2LnkgLSAxLCBtOiAxMSB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1sZWZ0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibW9udGhcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gdmlldy5zZXQoeyB5OiBub3cuZ2V0RnVsbFllYXIoKSwgbTogbm93LmdldE1vbnRoKCkgfSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHZpZXcpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHYpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IERhdGUodi55LCB2Lm0pLnRvTG9jYWxlU3RyaW5nKFwiZW5cIiwgeyBtb250aDogXCJsb25nXCIgfSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICh2LnkgIT09IG5vdy5nZXRGdWxsWWVhcigpID8gYCAke3YueX1gIDogXCJcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0KHYubSA9PT0gMTEgPyB7IHk6IHYueSArIDEsIG06IDAgfSA6IHsgeTogdi55LCBtOiB2Lm0gKyAxIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8L2NlbnRlcmJveD5cbiAgICAgICAgICAgICAgICAgICAgPEdyaWQgLz5cbiAgICAgICAgICAgICAgICAgICAgPEV2ZW50c0NhcmQgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBRdWljayBzZXR0aW5ncy4gUHJvdG90eXBlLWZpbmFsOiB1bmlmb3JtIHBpbGwgdGlsZXMgZnJvbSBhIENBVEFMT0cgKGN1c3RvbWlzYWJsZSxcbi8vIHBlcnNpc3RlZCksIEdOT01FIHRoaW4gc2xpZGVycywgZHJpbGxkb3ducyBhcyBhIHNwcmluZy1zbGlkIHR3by12aWV3IHN0YWNrXG4vLyAoV2ktRmkgbmV0d29ya3MgLyBCVCBkZXZpY2VzIC8gcGVyLWFwcCBtaXhlciB3aXRoIGEgTWFzdGVyIHJvdyksIGNvbXBhY3QgdG9wIHJvd1xuLy8gKGJhdHRlcnkgXHUwMEI3IHBlbmNpbC9sZWFmL2xvY2svcG93ZXIpLCBnbm9ibGluIGJhbm5lciArIHJlY29ubmVjdCB3aGlsZSBkZWdyYWRlZC5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBCbHVldG9vdGggZnJvbSBcImdpOi8vQXN0YWxCbHVldG9vdGhcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IEJhdHRlcnkgZnJvbSBcImdpOi8vQXN0YWxCYXR0ZXJ5XCJcbmltcG9ydCB7IGNvbm5lY3RlZCwgcmVsb2FkIH0gZnJvbSBcIi4uL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0IHsgTU9USU9OIH0gZnJvbSBcIi4uL2xpYi9zcHJpbmdcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIsIHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgVGlueVNsaWRlciB9IGZyb20gXCIuLi9saWIvdGlueXNsaWRlclwiXG5pbXBvcnQgeyBGaXhlZENoZXYgfSBmcm9tIFwiLi4vbGliL2ZpeGVkY2hldlwiXG5cbnR5cGUgRHJpbGwgPSBudWxsIHwgXCJ3aWZpXCIgfCBcImJ0XCIgfCBcIm1peFwiXG4vLyBLT0JFTF9EUklMTCBsZXRzIHRoZSBkZXZraXQgcmVuZGVyIGEgZHJpbGxkb3duIGRpcmVjdGx5IChubyBwb2ludGVyIHRvIGNsaWNrIHRoZVxuLy8gY2hldnJvbiBpbiBoZWFkbGVzcyk7IHByb2R1Y3Rpb24gZGVmYXVsdCBpcyBudWxsLlxuY29uc3QgZHJpbGwgPSBWYXJpYWJsZTxEcmlsbD4oKEdMaWIuZ2V0ZW52KFwiS09CRUxfRFJJTExcIikgYXMgRHJpbGwpIHx8IG51bGwpXG5cbi8vIFRpbGUgY2F0YWxvZyBcdTIwMTQgbWlycm9ycyBwcm90b3R5cGUgQ0FUQUxPRzsgcGVyc2lzdGVkIGxheW91dCBpbiBzdGF0ZSBkaXIuXG5jb25zdCBTVE9SRSA9IGAke0dMaWIuZ2V0X3VzZXJfc3RhdGVfZGlyKCl9L2tvYmVsL3FzLXRpbGVzLmpzb25gXG5sZXQgdGlsZXM6IHN0cmluZ1tdID0gW1wid2lmaVwiLCBcImJ0XCIsIFwic2F2ZVwiLCBcImRhcmtcIiwgXCJzaWxlbnRcIiwgXCJuaWdodFwiLCBcInZvbHVtZVwiLCBcImJyaWdodG5lc3NcIl1cbnRyeSB7XG4gICAgdGlsZXMgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShHTGliLmZpbGVfZ2V0X2NvbnRlbnRzKFNUT1JFKVsxXSkpXG59IGNhdGNoIHt9XG5cbmZ1bmN0aW9uIENoaXAocHJvcHM6IHtcbiAgICBpZDogc3RyaW5nXG4gICAgbGFiZWw6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIGFjdGl2ZTogYW55XG4gICAgc3ViPzogYW55XG4gICAgb25Ub2dnbGVkOiAoKSA9PiB2b2lkXG4gICAgb25EcmlsbD86ICgpID0+IHZvaWRcbn0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPXtiaW5kKHByb3BzLmFjdGl2ZSkuYXMoKGE6IGJvb2xlYW4pID0+IChhID8gXCJjaGlwIHBpbGwgb25cIiA6IFwiY2hpcCBwaWxsXCIpKX0+XG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY2hpcGJcIiBoZXhwYW5kPXt0cnVlfSBvbkNsaWNrZWQ9e3Byb3BzLm9uVG9nZ2xlZH0+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtwcm9wcy5pY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtwcm9wcy5sYWJlbH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtwcm9wcy5zdWIgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN1YlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtwcm9wcy5zdWJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICB7LyogZml4ZWQgMzJweCBzZWFtK2NoZXZyb24gKHByb3RvIC5jaGV2YikgXHUyMDE0IGhleHBhbmQ9ZmFsc2Ugc28gdGhlIG1haW4gYnV0dG9uIG93bnMgc2xhY2sgKi99XG4gICAgICAgICAgICB7cHJvcHMub25EcmlsbCAmJiAoXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImNoZXZcIiBoZXhwYW5kPXtmYWxzZX0gd2lkdGhSZXF1ZXN0PXszMH0gb25DbGlja2VkPXtwcm9wcy5vbkRyaWxsfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIFNsaWRlcnMoKSB7XG4gICAgY29uc3Qgc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG4gICAgLy8gSW4gREVNTyBtb2RlIHJlbmRlciB0aGUgdHdvIHNsaWRlcnMgcmVnYXJkbGVzcyBvZiBhIHJlYWwgc3BlYWtlciwgcGlubmVkIHRvIHRoZVxuICAgIC8vIHByb3RvdHlwZSdzIG1vY2sgdmFsdWVzICh2b2x1bWUgMC42NCwgYnJpZ2h0bmVzcyAwLjgwKSBmb3IgYSBmYWlyIG92ZXJsYXkuXG4gICAgaWYgKCFzcGVha2VyICYmICFERU1PKSByZXR1cm4gPGJveCAvPlxuICAgIGNvbnN0IHZvbEljb24gPSBzcGVha2VyXG4gICAgICAgID8gYmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpLmFzKChpKSA9PiBpID8/IFwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIpXG4gICAgICAgIDogXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIlxuICAgIC8vIHByb3RvIC5zbGlkZXJzIGlzIGEgZmxleCBjb2x1bW4gd2l0aCBOTyBnYXAgYmV0d2VlbiB0aGUgdHdvIHNyb3dzIChlYWNoIG1pbi1oIDQyKS5cbiAgICAvLyBUaW55U2xpZGVyIG92ZXJyaWRlcyB2ZnVuY19tZWFzdXJlIHRvIHJlcG9ydCBuYXR1cmFsPTFweCBzbyB0aGUgc3JvdyBkb2Vzbid0XG4gICAgLy8gaW5mbGF0ZSB0aGUgcGFuZWwgYmV5b25kIHRoZSBjaGlwLWdyaWQgd2lkdGggKEdUSyBDU1MgbWF4LXdpZHRoIGlzIG5vdCByZXNwZWN0ZWQpLlxuICAgIGNvbnN0IGluaXRWb2wgPSBERU1PID8gRC52b2x1bWUgOiAoc3BlYWtlcj8udm9sdW1lID8/IDAuNjQpXG4gICAgY29uc3Qgdm9sVmFsdWUgPSBWYXJpYWJsZShpbml0Vm9sKVxuICAgIGNvbnN0IHZvbFNsaWRlciA9IG5ldyBUaW55U2xpZGVyKHsgaGV4cGFuZDogdHJ1ZSwgY3NzQ2xhc3NlczogW1wic2xpZGVyXCJdLCB2YWx1ZTogaW5pdFZvbCB9KVxuICAgIGlmICghREVNTyAmJiBzcGVha2VyKVxuICAgICAgICBiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpLnN1YnNjcmliZSgodjogbnVtYmVyKSA9PiB7XG4gICAgICAgICAgICB2b2xTbGlkZXIuZ2V0X2FkanVzdG1lbnQoKS52YWx1ZSA9IHZcbiAgICAgICAgICAgIHZvbFZhbHVlLnNldCh2KVxuICAgICAgICB9KVxuICAgIC8vIEd0a1JhbmdlOjpjaGFuZ2UtdmFsdWUgYXJnczogKHJhbmdlLCBzY3JvbGxUeXBlLCB2YWx1ZSlcbiAgICB2b2xTbGlkZXIuY29ubmVjdChcImNoYW5nZS12YWx1ZVwiLCAoX3M6IGFueSwgX3Q6IGFueSwgdjogbnVtYmVyKSA9PiB7XG4gICAgICAgIGlmIChzcGVha2VyKSBzcGVha2VyLnZvbHVtZSA9IHZcbiAgICAgICAgdm9sVmFsdWUuc2V0KHYpXG4gICAgfSlcblxuICAgIGNvbnN0IGJyaWdodFZhbHVlID0gVmFyaWFibGUoREVNTyA/IEQuYnJpZ2h0bmVzcyA6IDAuOClcbiAgICBpZiAoIURFTU8pIHtcbiAgICAgICAgUHJvbWlzZS5hbGwoW2V4ZWNBc3luYyhcImJyaWdodG5lc3NjdGwgZ2V0XCIpLCBleGVjQXN5bmMoXCJicmlnaHRuZXNzY3RsIG1heFwiKV0pXG4gICAgICAgICAgICAudGhlbigoW2N1ciwgbWF4XSkgPT4gYnJpZ2h0VmFsdWUuc2V0KHBhcnNlSW50KGN1ci50cmltKCkpIC8gcGFyc2VJbnQobWF4LnRyaW0oKSkpKVxuICAgICAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAgICAgICAvKiBicmlnaHRuZXNzY3RsIGFic2VudCBvbiBkZXNrdG9wICovXG4gICAgICAgICAgICB9KVxuICAgIH1cbiAgICBjb25zdCBicmlnaHRTbGlkZXIgPSBuZXcgVGlueVNsaWRlcih7XG4gICAgICAgIGhleHBhbmQ6IHRydWUsXG4gICAgICAgIGNzc0NsYXNzZXM6IFtcInNsaWRlclwiXSxcbiAgICAgICAgdmFsdWU6IGJyaWdodFZhbHVlLmdldCgpLFxuICAgIH0pXG4gICAgYnJpZ2h0VmFsdWUuc3Vic2NyaWJlKCh2KSA9PiB7XG4gICAgICAgIGJyaWdodFNsaWRlci5nZXRfYWRqdXN0bWVudCgpLnZhbHVlID0gdlxuICAgIH0pXG4gICAgYnJpZ2h0U2xpZGVyLmNvbm5lY3QoXCJjaGFuZ2UtdmFsdWVcIiwgKF9zOiBhbnksIF90OiBhbnksIHY6IG51bWJlcikgPT5cbiAgICAgICAgZXhlY0FzeW5jKGBicmlnaHRuZXNzY3RsIHNldCAke01hdGgucm91bmQodiAqIDEwMCl9JWApXG4gICAgICAgICAgICAudGhlbigoKSA9PiBicmlnaHRWYWx1ZS5zZXQodikpXG4gICAgICAgICAgICAuY2F0Y2goKCkgPT4ge30pXG4gICAgKVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cInNsaWRlcnNcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzcm93XCIgc3BhY2luZz17OX0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXt2b2xJY29ufSAvPlxuICAgICAgICAgICAgICAgIHt2b2xTbGlkZXJ9XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ZhbCB0blwiXG4gICAgICAgICAgICAgICAgICAgIHhhbGlnbj17MX1cbiAgICAgICAgICAgICAgICAgICAgd2lkdGhSZXF1ZXN0PXszMn1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodm9sVmFsdWUpLmFzKCh2KSA9PiBgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjaGV2XCIgd2lkdGhSZXF1ZXN0PXszMX0gb25DbGlja2VkPXsoKSA9PiBkcmlsbC5zZXQoXCJtaXhcIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1icmlnaHRuZXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICB7YnJpZ2h0U2xpZGVyfVxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN2YWwgdG5cIlxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezF9XG4gICAgICAgICAgICAgICAgICAgIHdpZHRoUmVxdWVzdD17MzJ9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGJyaWdodFZhbHVlKS5hcygodikgPT4gYCR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYCl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICB7LyogZ3V0dGVyIGFsaWducyB3aXRoIGNoZXYgd2lkdGggKFx1MjI0ODMxcHgpOyBzdmFsPTMyICsgc3BhY2luZz05IFx1MjE5MiBzcGFjZSB0YWtlbiAqL31cbiAgICAgICAgICAgICAgICA8Ym94IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBHbm9ibGluQmFubmVyKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJnYmFubmVyXCIgdmlzaWJsZT17REVNTyA/IGZhbHNlIDogYmluZChjb25uZWN0ZWQpLmFzKChjKSA9PiAhYyl9IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXdhcm5pbmctc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBoZXhwYW5kPlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJvcmcuZ25vYmxpbi5TaGVsbCBkaXNjb25uZWN0ZWRcIiAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInNcIlxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJvc2QgKyBub3RpZnMgaGFuZGVkIGJhY2sgdG8gZ25vbWVcIlxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJnYnRuXCIgbGFiZWw9XCJSZWNvbm5lY3RcIiBvbkNsaWNrZWQ9eygpID0+IHJlbG9hZCgpLmNhdGNoKCgpID0+IHt9KX0gLz5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgcmVhbC1iYWNrZW5kIHRvZ2dsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4vLyBEYXJrIFN0eWxlOiBvcmcuZ25vbWUuZGVza3RvcC5pbnRlcmZhY2UgY29sb3Itc2NoZW1lXG5jb25zdCBpZmFjZVNldHRpbmdzID0gbmV3IEdpby5TZXR0aW5ncyh7IHNjaGVtYTogXCJvcmcuZ25vbWUuZGVza3RvcC5pbnRlcmZhY2VcIiB9KVxuY29uc3QgdERhcmsgPSBWYXJpYWJsZShpZmFjZVNldHRpbmdzLmdldF9zdHJpbmcoXCJjb2xvci1zY2hlbWVcIikgPT09IFwicHJlZmVyLWRhcmtcIilcbmlmYWNlU2V0dGluZ3MuY29ubmVjdChcImNoYW5nZWQ6OmNvbG9yLXNjaGVtZVwiLCAoKSA9PlxuICAgIHREYXJrLnNldChpZmFjZVNldHRpbmdzLmdldF9zdHJpbmcoXCJjb2xvci1zY2hlbWVcIikgPT09IFwicHJlZmVyLWRhcmtcIilcbilcblxuLy8gTmlnaHQgTGlnaHQ6IG9yZy5nbm9tZS5zZXR0aW5ncy1kYWVtb24ucGx1Z2lucy5jb2xvclxubGV0IGNvbG9yU2V0dGluZ3M6IEdpby5TZXR0aW5ncyB8IG51bGwgPSBudWxsXG5jb25zdCB0TmlnaHQgPSBWYXJpYWJsZShmYWxzZSlcbnRyeSB7XG4gICAgY29sb3JTZXR0aW5ncyA9IG5ldyBHaW8uU2V0dGluZ3MoeyBzY2hlbWE6IFwib3JnLmdub21lLnNldHRpbmdzLWRhZW1vbi5wbHVnaW5zLmNvbG9yXCIgfSlcbiAgICB0TmlnaHQuc2V0KGNvbG9yU2V0dGluZ3MuZ2V0X2Jvb2xlYW4oXCJuaWdodC1saWdodC1lbmFibGVkXCIpKVxuICAgIGNvbG9yU2V0dGluZ3MuY29ubmVjdChcImNoYW5nZWQ6Om5pZ2h0LWxpZ2h0LWVuYWJsZWRcIiwgKCkgPT5cbiAgICAgICAgdE5pZ2h0LnNldChjb2xvclNldHRpbmdzIS5nZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIikpXG4gICAgKVxufSBjYXRjaCB7XG4gICAgLyogc2NoZW1hIGFic2VudCBvbiBzb21lIHN5c3RlbXMgKi9cbn1cblxuLy8gU2lsZW50OiBtdXRlIG9uIHRoZSBkZWZhdWx0IFdpcmVQbHVtYmVyIHNwZWFrZXJcbmNvbnN0IF9zcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbmNvbnN0IHRTaWxlbnQgPSBfc3BlYWtlclxuICAgID8gKGJpbmQoX3NwZWFrZXIsIFwibXV0ZVwiKSBhcyB1bmtub3duIGFzIFZhcmlhYmxlPGJvb2xlYW4+KVxuICAgIDogVmFyaWFibGUoZmFsc2UpXG5cbi8vIFBvd2VyIFNhdmVyOiBwb3dlcnByb2ZpbGVzY3RsIChmYWxscyBiYWNrIHRvIGZhbHNlIGlmIHVuYXZhaWxhYmxlKVxuY29uc3QgdFNhdmUgPSBWYXJpYWJsZShmYWxzZSlcbmV4ZWNBc3luYyhcInBvd2VycHJvZmlsZXNjdGwgZ2V0XCIpXG4gICAgLnRoZW4oKHYpID0+IHRTYXZlLnNldCh2LnRyaW0oKSA9PT0gXCJwb3dlci1zYXZlclwiKSlcbiAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAvKiBwb3dlcnByb2ZpbGVzY3RsIGFic2VudCAqL1xuICAgIH0pXG5cbi8vIGVkaXQtbW9kZSBmb3IgdGhlIHRpbGUgY2F0YWxvZyAocGVuY2lsIGJ1dHRvbikgXHUyMDE0IGhvb2sgZm9yIHRpbGUgcmVhcnJhbmdlL2N1c3RvbWlzZS5cbmNvbnN0IGVkaXRNb2RlID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIFByb3RvdHlwZSB0b2dnbGUgY2hpcHMgYXJlIGxhYmVsLW9ubHksIHZlcnRpY2FsbHkgY2VudGVyZWQgXHUyMDE0IHN0YXRlIGlzIHNob3duIGJ5IHRoZVxuLy8gbGVhZiBmaWxsLCBub3QgYSBzdWItbGluZSAob25seSBXaS1GaS9CbHVldG9vdGggY2FycnkgYSBzdWIpLlxuZnVuY3Rpb24gVG9nZ2xlQ2hpcChwcm9wczoge1xuICAgIGxhYmVsOiBzdHJpbmdcbiAgICBpY29uOiBzdHJpbmdcbiAgICB2OiBWYXJpYWJsZTxib29sZWFuPlxuICAgIG9uVG9nZ2xlZD86ICgpID0+IHZvaWRcbn0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Q2hpcFxuICAgICAgICAgICAgaWQ9e3Byb3BzLmxhYmVsfVxuICAgICAgICAgICAgbGFiZWw9e3Byb3BzLmxhYmVsfVxuICAgICAgICAgICAgaWNvbj17cHJvcHMuaWNvbn1cbiAgICAgICAgICAgIGFjdGl2ZT17YmluZChwcm9wcy52KX1cbiAgICAgICAgICAgIG9uVG9nZ2xlZD17cHJvcHMub25Ub2dnbGVkID8/ICgoKSA9PiBwcm9wcy52LnNldCghcHJvcHMudi5nZXQoKSkpfVxuICAgICAgICAvPlxuICAgIClcbn1cblxuZnVuY3Rpb24gYmF0dGVyeU1ldGEoKTogYW55IHtcbiAgICBjb25zdCBiYXQgPSBCYXR0ZXJ5LmdldF9kZWZhdWx0KClcbiAgICBpZiAoIWJhdCkgcmV0dXJuIG51bGxcbiAgICByZXR1cm4gYmluZChiYXQsIFwicGVyY2VudGFnZVwiKS5hcygocCkgPT4ge1xuICAgICAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKHAgKiAxMDApXG4gICAgICAgIGNvbnN0IHN0YXRlID0gYmF0LmZ1bGwgPyBcIkZ1bGx5IGNoYXJnZWRcIiA6IGJhdC5jaGFyZ2luZyA/IFwiQ2hhcmdpbmdcIiA6IFwiRGlzY2hhcmdpbmdcIlxuICAgICAgICByZXR1cm4gYCR7cGN0fSUgXHUwMEI3ICR7c3RhdGV9YFxuICAgIH0pXG59XG5jb25zdCBoYXNCYXR0ZXJ5ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpICE9IG51bGxcblxuZnVuY3Rpb24gUm9vdCh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gICAgLy8gc3BhY2luZyAwOiBleGFjdCBzZWN0aW9uIGdhcHMgY29tZSBmcm9tIG1hcmdpbnMgKHF0b3BcdTIxOTJjaGlwcyAxLCBjaGlwIHJvd3MgOCxcbiAgICAvLyBjaGlwc1x1MjE5MnNsaWRlcnMgMTApIFx1MjAxNCBhIHVuaWZvcm0gYm94IHNwYWNpbmcgY2FuJ3QgZXhwcmVzcyBhbGwgdGhyZWUuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgIHsvKiB0b3Agcm93OiBiYXR0ZXJ5IFx1MDBCNyByZWxvYWQgXHUwMEI3IGxvY2sgXHUwMEI3IHBvd2VyICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInFzLXRvcFwiIHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgIHsvKiBiYXR0ZXJ5IHBpbGw6IGdseXBoICsgdGFidWxhciBtZXRhIFx1MjAxNCBoaWRkZW4gd2hlbiBubyBiYXR0ZXJ5IHByZXNlbnQgKi99XG4gICAgICAgICAgICAgICAgeyhERU1PIHx8IGhhc0JhdHRlcnkpICYmIChcbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1ldGFcIiBzcGFjaW5nPXs2fSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0blwiIGxhYmVsPXtERU1PID8gRC5tZXRhIDogYmF0dGVyeU1ldGEoKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICA8Ym94IGhleHBhbmQgLz5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0biBsZWFmXCIgb25DbGlja2VkPXsoKSA9PiByZWxvYWQoKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWxlYWYtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuXCIgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJsb2dpbmN0bCBsb2NrLXNlc3Npb25cIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1sb2NrLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZWRpdE1vZGUuc2V0KCFlZGl0TW9kZS5nZXQoKSl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wZW5jaWwtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuIGRhbmdlclwiIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxHbm9ibGluQmFubmVyIC8+XG4gICAgICAgICAgICB7Lyogb25lIGNoaXBzIGdyaWQ6IDMgcm93cyBhdCA4cHgsIG1hcmdpbi1ib3R0b20gMTAgYmVmb3JlIHRoZSBzbGlkZXJzICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXAtZ3JpZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICB7KERFTU8gfHwgbmV0LndpZmkpICYmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWQ9XCJ3aWZpXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIldpLUZpXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtd2lmaS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtERU1PID8gVmFyaWFibGUodHJ1ZSkgOiBiaW5kKG5ldC53aWZpISwgXCJlbmFibGVkXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Yj17REVNTyA/IEQud2lmaVNzaWQgOiBiaW5kKG5ldC53aWZpISwgXCJzc2lkXCIpLmFzKChzKSA9PiBzID8/IFwiT2ZmXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIURFTU8gJiYgbmV0LndpZmkpIG5ldC53aWZpLmVuYWJsZWQgPSAhbmV0LndpZmkuZW5hYmxlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25EcmlsbD17KCkgPT4gZHJpbGwuc2V0KFwid2lmaVwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDxDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBpZD1cImJ0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiQmx1ZXRvb3RoXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1ibHVldG9vdGgtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gVmFyaWFibGUodHJ1ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoKGQpID0+IGQuc29tZSgoeCkgPT4geC5jb25uZWN0ZWQpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3ViPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5idERldmljZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGQpID0+IGQuZmluZCgoeCkgPT4geC5jb25uZWN0ZWQpPy5hbGlhcyA/PyBcIk9mZlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFERU1PKSBidC50b2dnbGUoKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uRHJpbGw9eygpID0+IGRyaWxsLnNldChcImJ0XCIpfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJQb3dlciBTYXZlclwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtYm9sdC1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICB2PXt0U2F2ZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSAhdFNhdmUuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGVjQXN5bmMoYHBvd2VycHJvZmlsZXNjdGwgc2V0ICR7bmV4dCA/IFwicG93ZXItc2F2ZXJcIiA6IFwiYmFsYW5jZWRcIn1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB0U2F2ZS5zZXQobmV4dCkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB0U2F2ZS5zZXQobmV4dCkpXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJEYXJrIFN0eWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1tb29uLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3REYXJrfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9ICF0RGFyay5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmYWNlU2V0dGluZ3Muc2V0X3N0cmluZyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJjb2xvci1zY2hlbWVcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dCA/IFwicHJlZmVyLWRhcmtcIiA6IFwiZGVmYXVsdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgPFRvZ2dsZUNoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiU2lsZW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1iZWxsLXNsYXNoLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3RTaWxlbnR9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoX3NwZWFrZXIpIF9zcGVha2VyLm11dGUgPSAhX3NwZWFrZXIubXV0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPFRvZ2dsZUNoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiTmlnaHQgTGlnaHRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLXN1bi1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICB2PXt0TmlnaHR9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY29sb3JTZXR0aW5ncylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JTZXR0aW5ncy5zZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIiwgIXROaWdodC5nZXQoKSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxTbGlkZXJzIC8+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gU2lnbmFsLXN0cmVuZ3RoIGdseXBoIGZvciBhbiBhY2Nlc3MgcG9pbnQgKDBcdTIwMTMxMDAgXHUyMTkyIHdpZmkgdGllcnMpLlxuZnVuY3Rpb24gd2lmaUljb24oc3RyZW5ndGg6IG51bWJlcik6IHN0cmluZyB7XG4gICAgcmV0dXJuIFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIC8vIHNpbmdsZSBnbHlwaDsgc3RyZW5ndGggc2hvd24gYXMgdGV4dCBtZXRhXG59XG5cbi8vIFdpLUZpIEFQIGxpc3QgXHUyMDE0IHJlYWwgQXN0YWxOZXR3b3JrIGFjY2VzcyBwb2ludHMsIGNvbm5lY3RlZCBvbmUgbWFya2VkIC5hY3RpdmUuXG5mdW5jdGlvbiBXaWZpTGlzdCgpIHtcbiAgICBjb25zdCB3aWZpID0gTmV0d29yay5nZXRfZGVmYXVsdCgpLndpZmlcbiAgICBpZiAoIXdpZmkpIHJldHVybiA8Ym94IC8+XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICB7YmluZCh3aWZpLCBcImFjY2Vzc1BvaW50c1wiKS5hcygoYXBzKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gd2lmaS5hY3RpdmVBY2Nlc3NQb2ludFxuICAgICAgICAgICAgICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgICAgICAgICAgICAgIHJldHVybiBhcHNcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigoYXApID0+IGFwLnNzaWQgJiYgIXNlZW4uaGFzKGFwLnNzaWQpICYmIHNlZW4uYWRkKGFwLnNzaWQpKVxuICAgICAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYi5zdHJlbmd0aCAtIGEuc3RyZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCA2KVxuICAgICAgICAgICAgICAgICAgICAubWFwKChhcCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb24gPSBhY3RpdmUgJiYgYXAuc3NpZCA9PT0gYWN0aXZlLnNzaWRcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB3aWZpLmFjdGl2YXRlX2Nvbm5lY3Rpb24oYXAsIG51bGwpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3dpZmlJY29uKGFwLnN0cmVuZ3RoKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17YXAuc3NpZH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwieHNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtvbiA/IFwiQ29ubmVjdGVkXCIgOiBgJHthcC5zdHJlbmd0aH0lYH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gQmx1ZXRvb3RoIGRldmljZSBsaXN0IFx1MjAxNCBzYW1lIC54cm93IGdyYW1tYXIgYXMgV2ktRmk7IGNvbm5lY3RlZCBkZXZpY2UgaXMgLmFjdGl2ZS5cbmZ1bmN0aW9uIEJ0TGlzdCgpIHtcbiAgICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICB7YmluZChidCwgXCJkZXZpY2VzXCIpLmFzKChkZXZpY2VzKSA9PlxuICAgICAgICAgICAgICAgIGRldmljZXNcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigoZCkgPT4gZC5uYW1lIHx8IGQuYWxpYXMpXG4gICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYi5jb25uZWN0ZWQpIC0gTnVtYmVyKGEuY29ubmVjdGVkKSlcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKGRldikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb24gPSBkZXYuY29ubmVjdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e29uID8gXCJ4cm93IGFjdGl2ZVwiIDogXCJ4cm93XCJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uID8gZGV2LmRpc2Nvbm5lY3RfZGV2aWNlKCkgOiBkZXYuY29ubmVjdF9kZXZpY2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJsdWV0b290aC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2Rldi5hbGlhcyB8fCBkZXYubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInhzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uID8gXCJDb25uZWN0ZWRcIiA6IGRldi5wYWlyZWQgPyBcIlBhaXJlZFwiIDogXCJBdmFpbGFibGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBPbmUgbWl4ZXIgcm93ICgubWl4cm93KSBcdTIwMTQgaG9yaXpvbnRhbDogMjZcdTAwRDcyNiBpY29uIHRpbGUgXHUwMEI3IDcycHggbmFtZSBcdTAwQjcgc2xpZGVyIGZpbGxzLlxuZnVuY3Rpb24gTWl4Um93KHByb3BzOiB7IGljb246IHN0cmluZzsgdGl0bGU6IHN0cmluZzsgdGFyZ2V0OiBhbnkgfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJtaXhyb3dcIiBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibWlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17cHJvcHMuaWNvbn0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJtbmFtZVwiXG4gICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICBsYWJlbD17cHJvcHMudGl0bGV9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPHNsaWRlclxuICAgICAgICAgICAgICAgIGNsYXNzPVwic2xpZGVyXCJcbiAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIHZhbHVlPXtiaW5kKHByb3BzLnRhcmdldCwgXCJ2b2x1bWVcIil9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2VWYWx1ZT17KF9zLCB2KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHByb3BzLnRhcmdldC52b2x1bWUgPSB2XG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gUGVyLWFwcCB2b2x1bWUgbWl4ZXIgXHUyMDE0IE1hc3RlciAoZGVmYXVsdCBzcGVha2VyKSArIGVhY2ggYXVkaW8gc3RyZWFtIChBc3RhbFdwKS5cbmZ1bmN0aW9uIE1peExpc3QoKSB7XG4gICAgY29uc3Qgd3AgPSBXcC5nZXRfZGVmYXVsdCgpXG4gICAgaWYgKCF3cCkgcmV0dXJuIDxib3ggLz5cbiAgICBjb25zdCBzcGVha2VyID0gd3AuZGVmYXVsdF9zcGVha2VyXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICB7c3BlYWtlciAmJiAoXG4gICAgICAgICAgICAgICAgPE1peFJvdyBpY29uPVwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIgdGl0bGU9XCJPdXRwdXRcIiB0YXJnZXQ9e3NwZWFrZXJ9IC8+XG4gICAgICAgICAgICApfVxuICAgICAgICAgICAge2JpbmQod3AuYXVkaW8sIFwic3RyZWFtc1wiKS5hcygoc3RyZWFtcykgPT5cbiAgICAgICAgICAgICAgICBzdHJlYW1zXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCA1KVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8TWl4Um93XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZT17cy5kZXNjcmlwdGlvbiB8fCBzLm5hbWUgfHwgXCJBcHBsaWNhdGlvblwifVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldD17c31cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICkpXG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIERyaWxsVmlldyh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IG5hbWU9e25hbWV9IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgPGNlbnRlcmJveCBjbGFzcz1cImRoZWFkXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG5cIiBtYXJnaW5FbmQ9ezE1fSBvbkNsaWNrZWQ9eygpID0+IGRyaWxsLnNldChudWxsKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tbGVmdC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGRyaWxsKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgIGQgPT09IFwid2lmaVwiID8gXCJXaS1GaVwiIDogZCA9PT0gXCJidFwiID8gXCJCbHVldG9vdGhcIiA6IFwiVm9sdW1lXCJcbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDxib3ggd2lkdGhSZXF1ZXN0PXs0Nn0gaGFsaWduPXtHdGsuQWxpZ24uRU5EfT5cbiAgICAgICAgICAgICAgICAgICAge25ldC53aWZpICYmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxzd2l0Y2hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e2JpbmQobmV0LndpZmksIFwiZW5hYmxlZFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcygoZCkgPT4gZCA9PT0gXCJ3aWZpXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXsocykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXQud2lmaSEuZW5hYmxlZCA9IHMuYWN0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDxzd2l0Y2hcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZT17YmluZChCbHVldG9vdGguZ2V0X2RlZmF1bHQoKSwgXCJwb3dlcmVkXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChkcmlsbCkuYXMoKGQpID0+IGQgPT09IFwiYnRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICBvbk5vdGlmeUFjdGl2ZT17KHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCbHVldG9vdGguZ2V0X2RlZmF1bHQoKS5hZGFwdGVyLnBvd2VyZWQgPSBzLmFjdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICAgICAge2JpbmQoZHJpbGwpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgIGQgPT09IFwid2lmaVwiID8gKFxuICAgICAgICAgICAgICAgICAgICA8V2lmaUxpc3QgLz5cbiAgICAgICAgICAgICAgICApIDogZCA9PT0gXCJidFwiID8gKFxuICAgICAgICAgICAgICAgICAgICA8QnRMaXN0IC8+XG4gICAgICAgICAgICAgICAgKSA6IGQgPT09IFwibWl4XCIgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxNaXhMaXN0IC8+XG4gICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgPGJveCAvPlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gUXVpY2tTZXR0aW5ncygpIHtcbiAgICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjIwLCAxNTApXG4gICAgcmVnaXN0ZXIoXCJxdWlja3NldHRpbmdzXCIsIHRvZ2dsZUZuKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJxdWlja3NldHRpbmdzXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLXFzXCJcbiAgICAgICAgICAgIGNsYXNzPVwicXMtd2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFR9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gR2RrLktFWV9Fc2NhcGUpIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgICAgIGlmIChkcmlsbC5nZXQoKSkge1xuICAgICAgICAgICAgICAgICAgICBkcmlsbC5zZXQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9IC8vIEVzYyBzdGVwcyBiYWNrIGZpcnN0XG4gICAgICAgICAgICAgICAgY2xvc2UoKVxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChyZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzaGVldCBxc1wiPlxuICAgICAgICAgICAgICAgICAgICB7LyogR3RrLlN0YWNrIHdpdGggc2xpZGUtbGVmdC9yaWdodCA9IHRoZSBtdWx0aXZpZXc7IGhlaWdodCBhbmltYXRlc1xuICAgICAgICAgICAgdmlhIEFkdyBzcHJpbmcgb24gYSBzaXplLWdyb3VwIHdyYXBwZXIgKE1PVElPTi5kcmlsbCAvIGRyaWxsQmFjaykgKi99XG4gICAgICAgICAgICAgICAgICAgIDxzdGFja1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5TdGFja1RyYW5zaXRpb25UeXBlLlNMSURFX0xFRlRfUklHSFR9XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGVDaGlsZE5hbWU9e2JpbmQoZHJpbGwpLmFzKChkKSA9PiAoZCA/IFwiZHJpbGxcIiA6IFwicm9vdFwiKSl9XG4gICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxSb290IG5hbWU9XCJyb290XCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxEcmlsbFZpZXcgbmFtZT1cImRyaWxsXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9zdGFjaz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBUaW55U2xpZGVyIFx1MjAxNCBHdGsuU2NhbGUgc3ViY2xhc3MgdGhhdCByZXBvcnRzIG5lYXItemVybyBuYXR1cmFsIHdpZHRoIHNvIGl0XG4vLyBuZXZlciBmb3JjZXMgaXRzIHBhcmVudCBjb250YWluZXIgd2lkZXIgdGhhbiB0aGUgY2hpcC1ncmlkJ3MgbmF0dXJhbCB3aWR0aC5cbi8vIFdlIGV4dGVuZCBHdGsuU2NhbGUgZGlyZWN0bHkgKG5vdCBBc3RhbC5TbGlkZXIpIGJlY2F1c2UgQXN0YWwuU2xpZGVyJ3MgVmFsYVxuLy8gQyB2ZnVuY3MgY2FuIGludGVyY2VwdCB0aGUgbWVhc3VyZSBjaGFpbiBiZWZvcmUgdGhlIEdKUyBvdmVycmlkZSBpcyByZWFjaGVkLlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0a1wiXG5cbmV4cG9ydCBjb25zdCBUaW55U2xpZGVyID0gR09iamVjdC5yZWdpc3RlckNsYXNzKFxuICAgIHtcbiAgICAgICAgR1R5cGVOYW1lOiBcIktvYmVsVGlueVNjYWxlXCIsXG4gICAgfSxcbiAgICBjbGFzcyBUaW55U2xpZGVyIGV4dGVuZHMgR3RrLlNjYWxlIHtcbiAgICAgICAgY29uc3RydWN0b3IocGFyYW1zPzogUGFydGlhbDxHdGsuU2NhbGUuQ29uc3RydWN0b3JQcm9wcyAmIHsgdmFsdWU/OiBudW1iZXIgfT4pIHtcbiAgICAgICAgICAgIGNvbnN0IHsgdmFsdWUsIC4uLnJlc3QgfSA9IChwYXJhbXMgPz8ge30pIGFzIGFueVxuICAgICAgICAgICAgc3VwZXIoe1xuICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uOiBHdGsuT3JpZW50YXRpb24uSE9SSVpPTlRBTCxcbiAgICAgICAgICAgICAgICBhZGp1c3RtZW50OiBuZXcgR3RrLkFkanVzdG1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBsb3dlcjogMCxcbiAgICAgICAgICAgICAgICAgICAgdXBwZXI6IDEsXG4gICAgICAgICAgICAgICAgICAgIHN0ZXBfaW5jcmVtZW50OiAwLjAxLFxuICAgICAgICAgICAgICAgICAgICBwYWdlX2luY3JlbWVudDogMC4xLFxuICAgICAgICAgICAgICAgICAgICBwYWdlX3NpemU6IDAsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSA/PyAwLFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIGRyYXdfdmFsdWU6IGZhbHNlLFxuICAgICAgICAgICAgICAgIC4uLnJlc3QsXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgdmZ1bmNfbWVhc3VyZShcbiAgICAgICAgICAgIG9yaWVudGF0aW9uOiBHdGsuT3JpZW50YXRpb24sXG4gICAgICAgICAgICBmb3Jfc2l6ZTogbnVtYmVyXG4gICAgICAgICk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgICAgICAgICAgIGlmIChvcmllbnRhdGlvbiA9PT0gR3RrLk9yaWVudGF0aW9uLkhPUklaT05UQUwpIHtcbiAgICAgICAgICAgICAgICAvLyBSZXBvcnQgbmF0dXJhbD0xIHNvIHRoZSBzcm93L3NsaWRlcnMgY29udGFpbmVyIGRvZXNuJ3QgaW5mbGF0ZSB0aGUgUVMgcGFuZWxcbiAgICAgICAgICAgICAgICAvLyBiZXlvbmQgdGhlIGNoaXAtZ3JpZCBuYXR1cmFsIHdpZHRoLiBUaGUgc2xpZGVyIHN0aWxsIGhleHBhbmRzIHRvIGZpbGwgdGhlXG4gICAgICAgICAgICAgICAgLy8gYXZhaWxhYmxlIHNwYWNlIGF0IGFsbG9jYXRpb24gdGltZSBcdTIwMTQgb25seSB0aGUgbmF0dXJhbCBzaXplIGlzIG92ZXJyaWRkZW4uXG4gICAgICAgICAgICAgICAgcmV0dXJuIFswLCAxLCAtMSwgLTFdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3VwZXIudmZ1bmNfbWVhc3VyZShvcmllbnRhdGlvbiwgZm9yX3NpemUpXG4gICAgICAgIH1cbiAgICB9XG4pXG4iLCAiLy8gTm90aWZpY2F0aW9ucy4gUHJvdG90eXBlLWZpbmFsOiBmbG9hdGluZyBibHVycmVkIHRvYXN0cyAodG9wLXJpZ2h0LCB0aGUgT05FXG4vLyBzYW5jdGlvbmVkIHRyYW5zbHVjZW5jeSkgKyByaWdodCBkcmF3ZXIgKG1lZGlhIGNhcmQgb24gdG9wLCBwYW5lbC1sZXNzIGNhcmRzXG4vLyBmbG9hdGluZyBvbiB3YWxscGFwZXIsIGhlYWRlciBjaGlwKS4gVGhlIHVuaWZpZWQgcGlwZWxpbmU6IG9wZW4gdGhlIGRyYXdlciB3aGlsZVxuLy8gYSB0b2FzdCBpcyBsaXZlIGFuZCBpdCdzIEFET1BURUQgaW50byB0aGUgc3RhY2s7IHRvYXN0cyBhcnJpdmluZyB3aGlsZSBvcGVuXG4vLyBpbnNlcnQgYXMgY2FyZHM7IFNpbGVudCByb3V0ZXMgc3RyYWlnaHQgdG8gdGhlIHN0b3JlLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQsIEdMaWIsIGV4ZWNBc3luYyB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTm90aWZkIGZyb20gXCJnaTovL0FzdGFsTm90aWZkXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG4vLyBMYXp5IHNpbmdsZXRvbiBcdTIwMTQgY2FsbGluZyBnZXRfZGVmYXVsdCgpIGF0IG1vZHVsZSBzY29wZSBibG9ja3MgdGhlIGltcG9ydCB3aGlsZVxuLy8gQXN0YWxOb3RpZmQgdHJpZXMgdG8gYWNxdWlyZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyAoaGFuZ3MgaWYgZ25vbWUtc2hlbGxcbi8vIHN0aWxsIG93bnMgaXQpLiBEZWZlcnJpbmcgdG8gZmlyc3QgdXNlIGxldHMgdGhlIG1vZHVsZSBpbXBvcnQgY2xlYW5seTsgdGhlIGJ1cyBpc1xuLy8gcmVsZWFzZWQgYnkgYGdub2JsaW5jdGwgZGlzYWJsZSBub3RpZmljYXRpb25zYCBiZWZvcmUgdGhlIGRhZW1vbiBhY3R1YWxseSBjbGFpbXMgaXQuXG5sZXQgX25vdGlmZDogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5jb25zdCBuZCA9ICgpID0+IChfbm90aWZkID8/PSBOb3RpZmQuZ2V0X2RlZmF1bHQoKSlcbmNvbnN0IHNraXAgPSAoKSA9PiAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIilcbmNvbnN0IFRPQVNUX01TID0gMzgwMFxuLy8gUmVhY3RpdmUgZHJhd2VyLW9wZW4gc3RhdGUgc28gdGhlIHRvYXN0cyBjYW4gYmUgQURPUFRFRCAoaGlkZGVuKSB0aGUgaW5zdGFudCB0aGVcbi8vIGRyYXdlciBvcGVucywgd2l0aG91dCBwb2xsaW5nIGEgbG9va2VkLXVwIHdpbmRvdydzIHZpc2liaWxpdHkuXG5jb25zdCBkcmF3ZXJPcGVuID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIE5vdGlmaWNhdGlvbiBjYXJkcyBcdTIwMTQgZml4ZWQgd2lkdGggc28gdGhlIHRvYXN0L2RyYXdlciBkb2Vzbid0IHN0cmV0Y2ggdG8gaGV4cGFuZCB0ZXh0LlxuLy8gTkNBUkRfVyA9IDM0MSBcdTIxOTIgbmNhcmQgb3V0ZXIgPSAzNDEgKyAyNHB4IENTUyBwYWRkaW5nID0gMzY1cHggPSBwcm90b3R5cGUgLS1wdyBhdCAxMjgwcHguXG5jb25zdCBOQ0FSRF9XID0gMzQxXG5cbi8vIFByb3RvdHlwZSBJQ0JHIG1hcDogaWNvbi10eXBlIFx1MjE5MiBuaWMgYmFja2dyb3VuZCBjb2xvciAob2tsY2ggaHVlcyBmcm9tIGRvY3MvcHJvdG90eXBlLmh0bWwpXG5jb25zdCBOSUNfQkc6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgXCJrb2JlbC1sZWFmLXN5bWJvbGljXCI6IFwiIzYyODkzM1wiLCAvLyBva2xjaCg1OCUgLjEyIDEzMCkgZ3JlZW4gPSBnbm9ibGluXG4gICAgXCJrb2JlbC1jaGF0LXN5bWJvbGljXCI6IFwiIzdjM2Y4Y1wiLCAvLyBva2xjaCg1NiUgLjEzIDMwMCkgcHVycGxlID0gbWVzc2FnZXNcbiAgICBcImtvYmVsLWRvd25sb2FkLXN5bWJvbGljXCI6IFwiIzNkNmZhNlwiLCAvLyBva2xjaCg1OCUgLjEgMjUwKSBibHVlID0gZG93bmxvYWRzXG59XG5cbmludGVyZmFjZSBDYXJkRGF0YSB7XG4gICAgaWNvbjogc3RyaW5nXG4gICAgc3VtbWFyeTogc3RyaW5nXG4gICAgYm9keTogc3RyaW5nXG4gICAgd2hlbjogc3RyaW5nXG4gICAgZGlzbWlzczogKCkgPT4gdm9pZFxufVxuXG5mdW5jdGlvbiB0b0NhcmREYXRhKG46IE5vdGlmZC5Ob3RpZmljYXRpb24pOiBDYXJkRGF0YSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgaWNvbjogbi5hcHBfaWNvbiB8fCBcImRpYWxvZy1pbmZvcm1hdGlvbi1zeW1ib2xpY1wiLFxuICAgICAgICBzdW1tYXJ5OiBuLnN1bW1hcnksXG4gICAgICAgIGJvZHk6IG4uYm9keSxcbiAgICAgICAgd2hlbjogbmV3IERhdGUobi50aW1lICogMTAwMCkudG9Mb2NhbGVUaW1lU3RyaW5nKFwiZW4tR0JcIiwge1xuICAgICAgICAgICAgaG91cjogXCIyLWRpZ2l0XCIsXG4gICAgICAgICAgICBtaW51dGU6IFwiMi1kaWdpdFwiLFxuICAgICAgICB9KSxcbiAgICAgICAgZGlzbWlzczogKCkgPT4gbi5kaXNtaXNzKCksXG4gICAgfVxufVxuXG5mdW5jdGlvbiBDYXJkKHsgbiB9OiB7IG46IENhcmREYXRhIH0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwibmNhcmRcIiBzcGFjaW5nPXsxMH0gd2lkdGhSZXF1ZXN0PXtOQ0FSRF9XfT5cbiAgICAgICAgICAgIHsvKiBhcHAgaWNvbiBpbiBhIDMwXHUwMEQ3MzAgcjkgdGlsZSAocHJvdG90eXBlIC5uaWMpOyBjb2xvci1jb2RlZCBwZXIgaWNvbiB0eXBlICovfVxuICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgIGNsYXNzPVwibmljXCJcbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICBjc3M9e05JQ19CR1tuLmljb25dID8gYGJhY2tncm91bmQtY29sb3I6ICR7TklDX0JHW24uaWNvbl19O2AgOiBcIlwifVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17bi5pY29ufSBwaXhlbFNpemU9ezE1fSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibnR4XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gaGV4cGFuZD5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwidFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGhleHBhbmQgZWxsaXBzaXplPXszfSBsYWJlbD17bi5zdW1tYXJ5fSAvPlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ3aGVuIHRuXCIgbGFiZWw9e24ud2hlbn0gLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJib2R5XCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgIHhhbGlnbj17MH1cbiAgICAgICAgICAgICAgICAgICAgd3JhcFxuICAgICAgICAgICAgICAgICAgICBtYXhXaWR0aENoYXJzPXs0MH1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e24uYm9keX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibnhcIiB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gb25DbGlja2VkPXtuLmRpc21pc3N9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNsb3NlLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUb2FzdHMobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICAgIC8vIE9ubHkgcmVuZGVyIG5vdGlmaWNhdGlvbnMgeW91bmdlciB0aGFuIFRPQVNUX01TIHdoaWxlIHRoZSBkcmF3ZXIgaXMgQ0xPU0VEIFx1MjAxNFxuICAgIC8vIG9wZW5pbmcgdGhlIGRyYXdlciBcImFkb3B0c1wiIHRoZW0gKHRoZXkgc2ltcGx5IGNvbnRpbnVlIGxpZmUgYXMgZHJhd2VyIGNhcmRzLFxuICAgIC8vIHdoaWNoIGlzIHRoZSBGTElQIGhhbmRvZmYgZXhwcmVzc2VkIGluIHJldGFpbmVkLW1vZGUgdGVybXMpLlxuICAgIGNvbnN0IGxpdmUgPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gICAgLy8gYHNob3duYCA9IHdoYXQgdGhlIHRvYXN0IGNvbHVtbiByZW5kZXJzLiBSZWNvbXB1dGVkIGV4cGxpY2l0bHkgb24gZXZlcnkgaW5wdXRcbiAgICAvLyBjaGFuZ2UgKFZhcmlhYmxlLmRlcml2ZSBkaWRuJ3QgcHJvZHVjZSBhIHJlYWN0aXZlIGJpbmRpbmcgaGVyZSkuIEVtcHR5IHdoaWxlIHRoZVxuICAgIC8vIGRyYXdlciBpcyBvcGVuICh0b2FzdHMgYXJlIEFET1BURUQgaW50byB0aGUgZHJhd2VyIHN0YWNrKS5cbiAgICBjb25zdCBzaG93biA9IFZhcmlhYmxlPG51bWJlcltdPihbXSlcbiAgICBjb25zdCByZWNvbXB1dGUgPSAoKSA9PiBzaG93bi5zZXQoZHJhd2VyT3Blbi5nZXQoKSA/IFtdIDogbGl2ZS5nZXQoKSlcbiAgICBsaXZlLnN1YnNjcmliZShyZWNvbXB1dGUpXG4gICAgZHJhd2VyT3Blbi5zdWJzY3JpYmUocmVjb21wdXRlKVxuICAgIG5kKCkuY29ubmVjdChcIm5vdGlmaWVkXCIsIChfbiwgaWQpID0+IHtcbiAgICAgICAgaWYgKGRyYXdlck9wZW4uZ2V0KCkgfHwgbmQoKS5kb250X2Rpc3R1cmIpIHJldHVyblxuICAgICAgICBsaXZlLnNldChbLi4ubGl2ZS5nZXQoKSwgaWRdKVxuICAgICAgICB0aW1lb3V0KFRPQVNUX01TLCAoKSA9PiBsaXZlLnNldChsaXZlLmdldCgpLmZpbHRlcigoeCkgPT4geCAhPT0gaWQpKSlcbiAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJ0b2FzdHNcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtdG9hc3RzXCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICAvLyBIaWRlIHRoZSB3aG9sZSB0b2FzdCBzdXJmYWNlIHdoaWxlIHRoZSBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG9cbiAgICAgICAgICAgIC8vIHRoZSBkcmF3ZXIpIFx1MjAxNCBhIHJlYWN0aXZlIHdpbmRvdy12aXNpYmlsaXR5IGJpbmQsIHJvYnVzdCByZWdhcmRsZXNzIG9mIHRoZVxuICAgICAgICAgICAgLy8gcGVyLWl0ZW0gbGlzdCByZWNvbmNpbGlhdGlvbi5cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJhd2VyT3BlbikuYXMoKG8pID0+ICFvKX1cbiAgICAgICAgICAgIC8vIFRvYXN0cyBhcmUgYSBmbG9hdGluZyBvdmVybGF5IChsaWtlIHRoZSBwcm90b3R5cGUncyBhYnNvbHV0ZSB0b3AvcmlnaHQpOyB0aGVcbiAgICAgICAgICAgIC8vIGZsb2F0IGluc2V0IGNsZWFycyB0aGUgZmxvYXRpbmcgYmFyIChtYXJnaW5Ub3AgMTAgKyBoZWlnaHQgNDIpICsgYSBzbWFsbCBnYXAsXG4gICAgICAgICAgICAvLyBhbmQgdGhlIHJpZ2h0IGluc2V0IG1hdGNoZXMgdGhlIGJhcidzIGVkZ2UgbWFyZ2luLlxuICAgICAgICAgICAgbWFyZ2luVG9wPXs1OH1cbiAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICAgICAgPlxuICAgICAgICAgICAgey8qIGZpeGVkIHRvYXN0IGNvbHVtbiB3aWR0aCBzbyB0aGUgY2FyZCBjYW4ndCBzdHJldGNoIHRvIGl0cyBoZXhwYW5kIHRleHQgY29sdW1uICovfVxuICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgc3BhY2luZz17OH1cbiAgICAgICAgICAgICAgICB3aWR0aFJlcXVlc3Q9e05DQVJEX1cgKyAyNn1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAge2JpbmQoc2hvd24pLmFzKChpZHMpID0+XG4gICAgICAgICAgICAgICAgICAgIGlkcy5tYXAoKGlkKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuID0gbmQoKS5nZXRfbm90aWZpY2F0aW9uKGlkKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG4gPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInRvYXN0XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxDYXJkIG49e3RvQ2FyZERhdGEobil9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cblxuZnVuY3Rpb24gTWVkaWFDYXJkKCkge1xuICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgIGlmICghbXByaXMgJiYgIURFTU8pIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwaWNrID0gKHBzOiBhbnlbXSkgPT5cbiAgICAgICAgcHMuZmluZCgocCkgPT4gcC5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdID8/IG51bGxcblxuICAgIGNvbnN0IG1lZGlhVGl0bGUgPSBERU1PXG4gICAgICAgID8gRC5tZWRpYS50aXRsZVxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwaWNrKHBzKT8udGl0bGUgPz8gXCJcIilcbiAgICBjb25zdCBtZWRpYUFydGlzdCA9IERFTU9cbiAgICAgICAgPyBELm1lZGlhLmFydGlzdFxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwaWNrKHBzKT8uYXJ0aXN0ID8/IFwiXCIpXG4gICAgY29uc3QgcGxheUljb24gPSBERU1PXG4gICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcCA9IHBpY2socHMpXG4gICAgICAgICAgICAgIHJldHVybiBwPy5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICA6IFwia29iZWwtcGxheS1zeW1ib2xpY1wiXG4gICAgICAgICAgfSlcbiAgICBjb25zdCBwcm9ncmVzcyA9IERFTU9cbiAgICAgICAgPyAwLjQyXG4gICAgICAgIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcCA9IHBpY2socHMpXG4gICAgICAgICAgICAgIGlmICghcCB8fCAhcC5sZW5ndGggfHwgcC5sZW5ndGggPD0gMCkgcmV0dXJuIDBcbiAgICAgICAgICAgICAgcmV0dXJuIHAucG9zaXRpb24gLyBwLmxlbmd0aFxuICAgICAgICAgIH0pXG4gICAgY29uc3QgY3VyVGltZSA9IERFTU9cbiAgICAgICAgPyBcIjI6MzdcIlxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwaWNrKHBzKVxuICAgICAgICAgICAgICBpZiAoIXAgfHwgIXAucG9zaXRpb24pIHJldHVybiBcIjA6MDBcIlxuICAgICAgICAgICAgICBjb25zdCBzID0gTWF0aC5mbG9vcihwLnBvc2l0aW9uKVxuICAgICAgICAgICAgICByZXR1cm4gYCR7TWF0aC5mbG9vcihzIC8gNjApfToke1N0cmluZyhzICUgNjApLnBhZFN0YXJ0KDIsIFwiMFwiKX1gXG4gICAgICAgICAgfSlcbiAgICBjb25zdCB0b3RhbFRpbWUgPSBERU1PXG4gICAgICAgID8gXCI2OjA3XCJcbiAgICAgICAgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwID0gcGljayhwcylcbiAgICAgICAgICAgICAgaWYgKCFwIHx8ICFwLmxlbmd0aCB8fCBwLmxlbmd0aCA8PSAwKSByZXR1cm4gXCIwOjAwXCJcbiAgICAgICAgICAgICAgY29uc3QgcyA9IE1hdGguZmxvb3IocC5sZW5ndGgpXG4gICAgICAgICAgICAgIHJldHVybiBgJHtNYXRoLmZsb29yKHMgLyA2MCl9OiR7U3RyaW5nKHMgJSA2MCkucGFkU3RhcnQoMiwgXCIwXCIpfWBcbiAgICAgICAgICB9KVxuICAgIGNvbnN0IGhhc1BsYXllciA9IERFTU8gPyB0cnVlIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHBzLmxlbmd0aCA+IDApXG4gICAgY29uc3Qgbm9QbGF5ZXIgPSBERU1PID8gZmFsc2UgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4gcHMubGVuZ3RoID09PSAwKVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cIm5jYXJkIG1lZGlhXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICB7LyogLm1yb3cgXHUyMDE0IGFydCBcdTAwQjcgdGl0bGUvYXJ0aXN0IFx1MDBCNyBwcmV2L3BsYXkvbmV4dCAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtcm93XCIgc3BhY2luZz17MTF9IHZpc2libGU9e2hhc1BsYXllcn0+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1hcnRcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXsyMn1cbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgIHZleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibW1ldGFcIlxuICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17bWVkaWFUaXRsZX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e21lZGlhQXJ0aXN0fSAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtYnRuc1wiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17MX0+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJtYnRuXCIgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJwbGF5ZXJjdGwgcHJldmlvdXNcIil9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1iYWNrLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJtYnRuIHBsYXlcIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17cGxheUljb259IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibWJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIG5leHRcIil9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1md2Qtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgey8qIC5tYmFyIFx1MjAxNCBjdXJyZW50IHRpbWUgXHUwMEI3IHRyYWNrIHNsaWRlciBcdTAwQjcgdG90YWwgdGltZSAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtYmFyXCIgc3BhY2luZz17OH0gdmlzaWJsZT17aGFzUGxheWVyfT5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJtdGltZSB0blwiIGxhYmVsPXtjdXJUaW1lfSAvPlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhciBjbGFzcz1cIm10cmFja1wiIGhleHBhbmQgdmFsdWU9e3Byb2dyZXNzfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cIm10aW1lIHRuXCIgbGFiZWw9e3RvdGFsVGltZX0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgey8qIGVtcHR5IHN0YXRlIFx1MjAxNCBkaXNjIGljb24gKyBcIk5vdGhpbmcgcGxheWluZ1wiICsgXCJPcGVuIE11c2ljXCIgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibWVtcHR5cm93XCIgc3BhY2luZz17MTF9IHZpc2libGU9e25vUGxheWVyfT5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibWFydFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJrb2JlbC1kaXNjLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MjJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveCBoZXhwYW5kIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJOb3RoaW5nIHBsYXlpbmdcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ViXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJNZWRpYSBjb250cm9scyBhcHBlYXIgd2hlbiBhIHBsYXllciBzdGFydHNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgd3JhcFxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJnaG9zdGJcIlxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwieGRnLW9wZW4gaHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tXCIpfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiT3BlbiBNdXNpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gRHJhd2VyKCkge1xuICAgIGlmICghREVNTyAmJiBza2lwKCkpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjAwLCAxNTApXG4gICAgcmVnaXN0ZXIoXCJkcmF3ZXJcIiwgdG9nZ2xlRm4pXG4gICAgLy8gS2VlcCBkcmF3ZXJPcGVuIGluIHN5bmMgd2l0aCB0aGUgcmV2ZWFsZWQgc3RhdGUgKHRvYXN0cyBhZG9wdCBpbnRvIGRyYXdlciB3aGVuIG9wZW4pXG4gICAgcmV2ZWFsZWQuc3Vic2NyaWJlKChyKSA9PiBkcmF3ZXJPcGVuLnNldChyKSlcblxuICAgIC8vIERFTU86IHN0YXRpYyBub3RpZmljYXRpb24gbGlzdCBwaW5uZWQgdG8gcHJvdG90eXBlJ3MgaW5pdGlhbCBzdGF0ZVxuICAgIGlmIChERU1PKSB7XG4gICAgICAgIGNvbnN0IGRlbW9DYXJkczogQ2FyZERhdGFbXSA9IEQubm90aWZpY2F0aW9ucy5tYXAoKG4pID0+ICh7XG4gICAgICAgICAgICAuLi5uLFxuICAgICAgICAgICAgZGlzbWlzczogKCkgPT4ge30sXG4gICAgICAgIH0pKVxuICAgICAgICBjb25zdCBkZW1vQ291bnQgPSBgJHtkZW1vQ2FyZHMubGVuZ3RoIHx8IFwiXCJ9YFxuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgICAgIG5hbWU9XCJkcmF3ZXJcIlxuICAgICAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWRyYXdlclwiXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJkcmF3ZXItd2luZG93XCJcbiAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgICAgICBhbmNob3I9e1xuICAgICAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLk9OX0RFTUFORH1cbiAgICAgICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChjbG9zZSgpLCB0cnVlKSA6IGZhbHNlKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0xFRlR9XG4gICAgICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjAwfVxuICAgICAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChyZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkcmF3ZXJcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxNZWRpYUNhcmQgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJOb3RpZmljYXRpb25zXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0biBzdWJcIiBsYWJlbD17ZGVtb0NvdW50fSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggaGV4cGFuZCAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJuY2xlYXJcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs1fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXRyYXNoLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIkNsZWFyXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7ZGVtb0NhcmRzLm1hcCgobikgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Q2FyZCBuPXtufSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgICAgICA8L3dpbmRvdz5cbiAgICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IG5mZCA9IG5kKClcbiAgICBjb25zdCBsaXN0ID0gVmFyaWFibGU8Tm90aWZkLk5vdGlmaWNhdGlvbltdPihuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKSA/PyBbXSlcbiAgICBjb25zdCByZWZyZXNoID0gKCkgPT4gbGlzdC5zZXQobmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gICAgbmZkLmNvbm5lY3QoXCJub3RpZmllZFwiLCByZWZyZXNoKVxuICAgIG5mZC5jb25uZWN0KFwicmVzb2x2ZWRcIiwgcmVmcmVzaClcblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkcmF3ZXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZHJhd2VyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZHJhd2VyLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgbWFyZ2luUmlnaHQ9ezEyfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4gKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9MRUZUfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjAwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImRyYXdlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8TWVkaWFDYXJkIC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIk5vdGlmaWNhdGlvbnNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gc3ViXCIgbGFiZWw9e2JpbmQobGlzdCkuYXMoKG4pID0+IGAke24ubGVuZ3RoIHx8IFwiXCJ9YCl9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGhleHBhbmQgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm5jbGVhclwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKS5mb3JFYWNoKChuKSA9PiBuLmRpc21pc3MoKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs1fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtdHJhc2gtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJDbGVhclwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtiaW5kKGxpc3QpLmFzKChucykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBucyAmJiBucy5sZW5ndGhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBucy5tYXAoKG4pID0+IDxDYXJkIG49e3RvQ2FyZERhdGEobil9IC8+KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJuZW1wdHlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5GSUxMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImtvYmVsLWNoZWNrLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gbGFiZWw9XCJBbGwgY2F1Z2h0IHVwXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIE9TRCBcdTIwMTQgZGlzcGxheS1vbmx5IHZvbHVtZSBwaWxsIGFib3ZlIHRoZSBkb2NrLiBQcm90b3R5cGU6IHBvaW50ZXItZXZlbnRzIG5vbmUsXG4vLyBhdXRvLWhpZGUgMS40cywgdHJhbnNsdWNlbnQgKGJsdXIgdmlhIGdub2JsaW4gd2luZG93LXJ1bGUpLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBPU0QobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICBjb25zdCB2aXNpYmxlID0gVmFyaWFibGUoZmFsc2UpXG4gICAgbGV0IGhpZGU6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcbiAgICBpZiAoIXNwZWFrZXIpIHJldHVybiBudWxsXG5cbiAgICBzcGVha2VyLmNvbm5lY3QoXCJub3RpZnk6OnZvbHVtZVwiLCAoKSA9PiB7XG4gICAgICAgIHZpc2libGUuc2V0KHRydWUpXG4gICAgICAgIGhpZGU/LmNhbmNlbCgpXG4gICAgICAgIGhpZGUgPSB0aW1lb3V0KDE0MDAsICgpID0+IHZpc2libGUuc2V0KGZhbHNlKSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cIm9zZFwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1vc2RcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIG1hcmdpbkJvdHRvbT17NzJ9XG4gICAgICAgICAgICBjbGlja1Rocm91Z2hcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQodmlzaWJsZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJvc2RcIiBzcGFjaW5nPXsxMX0gd2lkdGhSZXF1ZXN0PXsyMzB9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17YmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhciBoZXhwYW5kIHZhbHVlPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN2YWwgdG5cIlxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezF9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpLmFzKCh2KSA9PiBgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBTZXNzaW9uIG92ZXJsYXkgXHUyMDE0IGRpbW1lZCAoMC44KSwgNCBidXR0b25zLCBhcnJvdy1uYXYsIFBSRVNTLUFHQUlOIGNvbmZpcm0gb25cbi8vIFJlc3RhcnQvU2h1dCBkb3duIChhdXRvLXJldmVydCA0cyksIHJlc3Rpbmcgcm9zZSBvbiBTaHV0IGRvd24uXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgZXhlY0FzeW5jLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxudm9pZCBERU1PXG52b2lkIERcblxuY29uc3QgQUNUSU9OUyA9IFtcbiAgICB7XG4gICAgICAgIGlkOiBcImxvY2tcIixcbiAgICAgICAgbGFiZWw6IFwiTG9ja1wiLFxuICAgICAgICBpY29uOiBcImtvYmVsLWxvY2stc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogZmFsc2UsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBpZDogXCJsb2dvdXRcIixcbiAgICAgICAgbGFiZWw6IFwiTG9nIG91dFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLWxvZ291dC1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiBmYWxzZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJnbm9tZS1zZXNzaW9uLXF1aXQgLS1sb2dvdXQgLS1uby1wcm9tcHRcIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIGlkOiBcInJlc3RhcnRcIixcbiAgICAgICAgbGFiZWw6IFwiUmVzdGFydFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXJlbG9hZC1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiB0cnVlLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCByZWJvb3RcIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIGlkOiBcInNodXRkb3duXCIsXG4gICAgICAgIGxhYmVsOiBcIlNodXQgZG93blwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXBvd2VyLXN5bWJvbGljXCIsXG4gICAgICAgIGNvbmZpcm06IHRydWUsXG4gICAgICAgIHJlZDogdHJ1ZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgcG93ZXJvZmZcIiksXG4gICAgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gU2Vzc2lvbigpIHtcbiAgICBjb25zdCBhcm1lZCA9IFZhcmlhYmxlPHN0cmluZyB8IG51bGw+KG51bGwpXG4gICAgbGV0IHJldmVydDogUmV0dXJuVHlwZTx0eXBlb2YgdGltZW91dD4gfCBudWxsID0gbnVsbFxuXG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDE4MCwgMTMwKVxuICAgIHJlZ2lzdGVyKFwic2Vzc2lvblwiLCB0b2dnbGVGbilcblxuICAgIGNvbnN0IHByZXNzID0gKGE6ICh0eXBlb2YgQUNUSU9OUylbbnVtYmVyXSkgPT4ge1xuICAgICAgICBpZiAoYS5jb25maXJtICYmIGFybWVkLmdldCgpICE9PSBhLmlkKSB7XG4gICAgICAgICAgICBhcm1lZC5zZXQoYS5pZClcbiAgICAgICAgICAgIHJldmVydD8uY2FuY2VsKClcbiAgICAgICAgICAgIHJldmVydCA9IHRpbWVvdXQoNDAwMCwgKCkgPT4gYXJtZWQuc2V0KG51bGwpKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgIH1cbiAgICAgICAgYXJtZWQuc2V0KG51bGwpXG4gICAgICAgIGNsb3NlKClcbiAgICAgICAgYS5ydW4oKVxuICAgIH1cblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJzZXNzaW9uXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLXNlc3Npb25cIlxuICAgICAgICAgICAgY2xhc3M9XCJzZXNzaW9uLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHxcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NIHxcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuTEVGVCB8XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5JR05PUkV9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgICAgICAgICAgICAgYXJtZWQuc2V0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgIGNsb3NlKClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuQ1JPU1NGQURFfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MTgwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgey8qIC5zZXNzaW9uIGZpbGxzIHRoZSB3aG9sZSB3aW5kb3cgKHRoZSBkaW0pOyBidXR0b25zIGNlbnRlcmVkIGluc2lkZSAqL31cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2Vzc2lvblwiIGhleHBhbmQgdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgPGJveCBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17MjB9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICB7QUNUSU9OUy5tYXAoKGEpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPXthLnJlZCA/IFwic2J0biByZWRcIiA6IFwic2J0blwifSBvbkNsaWNrZWQ9eygpID0+IHByZXNzKGEpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezEwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e2JpbmQoYXJtZWQpLmFzKCh4KSA9PiAoeCA9PT0gYS5pZCA/IFwiY29uZmlybVwiIDogXCJcIikpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzaWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmQ9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZleHBhbmQ9e2ZhbHNlfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIGhvcml6b250YWwgR3RrQm94IGlnbm9yZXMgYSBjaGlsZCdzIG1haW4tYXhpcyBoYWxpZ24sIHNvIHRoZSBpY29uXG4gICAgICAgICAgICAgICAgICAgIGxlZnQtcGFja3M7IGhleHBhbmQgbWFrZXMgdGhlIGltYWdlIGZpbGwgdGhlIDU5cHggdGlsZSBcdTIxOTIgR3RrSW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgY2VudHJlcyB0aGUgZ2x5cGguIGhleHBhbmQ9e2ZhbHNlfSBvbiAuc2ljIGJsb2NrcyBwcm9wYWdhdGlvbiBzbyB0aGVcbiAgICAgICAgICAgICAgICAgICAgdGlsZSBzdGF5cyA1OSB3aWRlIGluc3RlYWQgb2Ygc3RyZXRjaGluZyB0aGUgcm93LiAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2EuaWNvbn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXsyMn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZChhcm1lZCkuYXMoKHgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHggPT09IGEuaWQgPyBcIlByZXNzIGFnYWluXCIgOiBhLmxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU9BLFlBQVc7QUFDbEIsT0FBT0MsVUFBUztBQUNoQixPQUFPQyxVQUFTOzs7QUNGaEIsT0FBT0MsWUFBVzs7O0FDQVgsSUFBTSxXQUFXLENBQUMsUUFBZ0IsSUFDcEMsUUFBUSxtQkFBbUIsT0FBTyxFQUNsQyxXQUFXLEtBQUssR0FBRyxF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QUM5RCxlQUFXLFdBQVcsU0FBUztBQUMzQixXQUFLLE9BQU8sTUFBTSxJQUFJLE9BQU8sR0FBRyxJQUFJO0FBQ3BDLFdBQUssUUFBUSxNQUFNLEtBQUssT0FBTyxHQUFHLElBQUk7QUFDdEMsV0FBSyxVQUFVLE1BQU0sT0FBTyxPQUFPLEdBQUcsSUFBSTtBQUMxQyxXQUFLLE9BQU8sTUFBTSxJQUFJLE9BQU8sR0FBRyxJQUFJO0FBQUEsSUFDeEM7QUFDQSxTQUFLLFlBQVksTUFBTSxTQUFTLEdBQUcsS0FBSztBQUN4QyxTQUFLLGlCQUFpQixNQUFNLGNBQWMsR0FBRyxLQUFLO0FBQ2xELFNBQUssWUFBWSxNQUFNLFNBQVMsR0FBRyxLQUFLO0FBQ3hDLFNBQUssVUFBVSxNQUFNLE9BQU8sR0FBRyxLQUFLO0FBQ3BDLFNBQUssV0FBVyxNQUFNLFFBQVEsR0FBRyxLQUFLO0FBRXRDLFlBQVEsQ0FBQyxTQUFTLFlBQUksV0FBVyxJQUFJLENBQVE7QUFBQSxFQUNqRDtBQUFBO0FBQUEsRUFFQSxlQUFlLFNBQVMsS0FBSztBQUN6QixVQUFNLENBQUMsS0FBSyxHQUFHLElBQUksUUFBUSxNQUFNLEdBQUc7QUFDcEMsUUFBSSxRQUFRLFVBQVU7QUFDbEIsYUFBYyxHQUFHO0FBQ2pCLGFBQU8sSUFBSSxJQUFJO0FBQUEsSUFDbkI7QUFDQSxRQUFJLFFBQVEsY0FBYztBQUN0QixrQkFBSSxVQUFVLGVBQVEsU0FBUyxNQUFNLEdBQUcsSUFBSTtBQUM1QyxhQUFPLElBQUksSUFBSTtBQUFBLElBQ25CO0FBQ0EsUUFBSSxTQUFTO0FBQUEsRUFDakI7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogWyJBc3RhbCIsICJHdGsiLCAiR2RrIiwgIkFzdGFsIiwgImJpbmQiLCAiaW50ZXJ2YWwiLCAidGltZW91dCIsICJBc3RhbCIsICJBc3RhbCIsICJpbml0IiwgIkFzdGFsIiwgInYiLCAiaW50ZXJ2YWwiLCAia2V5IiwgImN0b3JzIiwgImtleSIsICJHdGsiLCAiQXN0YWwiLCAic25ha2VpZnkiLCAicGF0Y2giLCAiQXBwcyIsICJCbHVldG9vdGgiLCAiTXByaXMiLCAiTm90aWZkIiwgIldwIiwgIkFwcCIsICJHdGsiLCAiQXN0YWwiLCAiQXN0YWwiLCAiR3RrIiwgIkd0ayIsICJBc3RhbCIsICJjaCIsICJHdGsiLCAiR2RrIiwgIkdpbyIsICJHTGliIiwgImRlZmF1bHQiLCAiQXN0YWwiLCAiR09iamVjdCIsICJkZWZhdWx0IiwgIkdPYmplY3QiLCAiR2lvIiwgIkdMaWIiLCAiR2lvIiwgIkdMaWIiLCAiaW5pdCIsICJHTGliIiwgIkdMaWIiLCAidHlwZSIsICJHTGliIiwgImpzeCIsICJkZWZhdWx0IiwgImpzeCIsICJ3aWZpSWNvbiIsICJHdGsiLCAibiIsICJBc3RhbCIsICJHaW8iLCAianN4IiwgIkd0ayIsICJuIiwgIkdkayIsICJHaW8iLCAiQXN0YWwiLCAiQXBwcyIsICJNcHJpcyIsICJHTGliIiwgImpzeCIsICJHdGsiLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJQSU5ORUQiLCAiQXBwcyIsICJkZWZhdWx0IiwgIm4iLCAianN4IiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiR3RrIiwgIk1wcmlzIiwgIk5ldHdvcmsiLCAiV3AiLCAiR2lvIiwgIkJhdHRlcnkiLCAiR09iamVjdCIsICJHdGsiLCAiVGlueVNsaWRlciIsICJkZWZhdWx0IiwgIlNUT1JFIiwgImpzeCIsICJHdGsiLCAiV3AiLCAiR2lvIiwgIkJhdHRlcnkiLCAiTmV0d29yayIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIk5vdGlmZCIsICJNcHJpcyIsICJOb3RpZmQiLCAiZGVmYXVsdCIsICJuIiwgImpzeCIsICJHdGsiLCAiQXN0YWwiLCAiTXByaXMiLCAia2V5IiwgIkdkayIsICJXcCIsICJXcCIsICJqc3giLCAiQXN0YWwiLCAiQUNUSU9OUyIsICJqc3giLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJHdGsiLCAiR3RrIiwgImluaXQiLCAiR2RrIl0KfQo=
