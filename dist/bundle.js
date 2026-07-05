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
var main_default = '@charset "UTF-8";\nwindow {\n  font-family: "Inter", "Inter Variable", "InterVariable", sans-serif;\n  font-size: 13px;\n  color: #f3eef3;\n}\n\n.tn {\n  font-feature-settings: "tnum";\n}\n\nwindow {\n  background: transparent;\n}\n\nbutton {\n  background: none;\n  background-color: transparent;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 0;\n  transition: background-color 160ms, color 160ms;\n}\n\nimage {\n  -gtk-icon-style: regular;\n}\n\n.bar {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 0 7px;\n  min-height: 42px;\n  color: #b5adbc;\n}\n.bar .title {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n  margin: 0 9px;\n}\n.bar .clock {\n  color: #f3eef3;\n  font-size: 13.5px;\n  font-weight: 600;\n}\n.bar .date {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.bar .ibtn {\n  padding: 0;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.bar .ibtn image {\n  -gtk-icon-size: 16px;\n}\n.bar .ibtn:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.bar .bcenter {\n  min-height: 0;\n  padding: 6px 12px;\n  border-radius: 9px;\n}\n.bar .bcenter:hover {\n  background-color: #1d1a22;\n}\n.bar .status {\n  min-height: 30px;\n  padding: 0 13px;\n  border-radius: 999px;\n  background-color: #1d1a22;\n}\n.bar .status:hover {\n  background-color: #26232c;\n}\n.bar .status image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.bar .status .pct image {\n  -gtk-icon-size: 15px;\n}\n.bar .status label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 11.5px;\n}\n.bar .status.err .net-icon {\n  color: #edbb64;\n}\n.bar .badge {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 99px;\n  font-size: 9px;\n  font-weight: 700;\n  padding: 0 3px;\n  margin: 2px;\n  min-height: 14px;\n  min-width: 14px;\n}\n.bar .tray-icon {\n  min-width: 28px;\n}\n.bar .tray-icon image {\n  -gtk-icon-size: 14px;\n  color: #b5adbc;\n}\n.bar .tray-lang {\n  font-size: 11px;\n  font-weight: 650;\n  color: #b5adbc;\n  padding: 0 8px;\n  min-width: 0;\n}\n\n.dock {\n  background-color: #100e14;\n  padding: 5px;\n  border-radius: 16px;\n}\n.dock .dbtn {\n  border-radius: 12px;\n}\n.dock .icon-tile {\n  min-width: 30px;\n  min-height: 30px;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.dock .dbtn:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.dock .placeholder .icon-tile {\n  background-color: #1d1a22;\n  color: #8d8693;\n}\n.dock .dots {\n  margin-bottom: 3px;\n}\n.dock .dot {\n  background-color: #8d8693;\n  border-radius: 99px;\n  min-width: 4px;\n  min-height: 4px;\n  transition: min-width 260ms cubic-bezier(0.24, 1.36, 0.35, 1), background-color 220ms;\n}\n.dock .dot.on {\n  background-color: #b5cb48;\n  min-width: 12px;\n}\n.dock .dot.mini {\n  min-width: 3px;\n  min-height: 3px;\n  opacity: 0.7;\n}\n.dock .sep {\n  background-color: #26232c;\n  min-width: 1px;\n  min-height: 34px;\n  margin: 0 3px;\n}\n.dock .dtile {\n  min-width: 42px;\n  min-height: 42px;\n}\n.dock .dwidget .dg {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 9px;\n  padding: 6px;\n}\n.dock levelbar.mprog {\n  min-width: 25px;\n  min-height: 3px;\n  margin-bottom: 6px;\n}\n.dock levelbar.mprog > trough {\n  background-color: rgba(0, 0, 0, 0.35);\n  border-radius: 99px;\n  min-height: 3px;\n}\n.dock levelbar.mprog > trough > block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.dock levelbar.mprog > trough > block.empty {\n  background-color: transparent;\n}\n\n.sheet {\n  background-color: #100e14;\n  border-radius: 24px;\n  padding: 12px;\n  margin: 38px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n}\n\n.qs {\n  min-width: 328px;\n} /* matches panelW(352)\u221224; overridden by config.ts tokenCss at runtime */\n.qs-top {\n  margin-bottom: 12px;\n  padding: 0 2px;\n}\n.qs-top .meta {\n  color: #b5adbc;\n  font-size: 11.5px;\n  font-weight: 600;\n}\n.qs-top .meta image {\n  -gtk-icon-size: 15px;\n  color: #b5adbc;\n  padding: 0;\n  margin: 0;\n}\n.qs-top .rbtn {\n  padding: 9px;\n  border-radius: 99px;\n  background-color: #26232c;\n  color: #b5adbc;\n  margin-left: 7px;\n}\n.qs-top .rbtn image {\n  -gtk-icon-size: 14px;\n}\n.qs-top .rbtn:hover {\n  background-color: #322e39;\n  color: #f3eef3;\n}\n.qs-top .rbtn.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.qs-top .rbtn.leaf image {\n  color: #b5cb48;\n}\n\n.chip {\n  background-color: #1d1a22;\n  border-radius: 999px;\n  min-height: 54px;\n  transition: background-color 220ms;\n}\n.chip .chipb {\n  padding: 9px 8px 9px 12px;\n  border-radius: 999px;\n}\n.chip image {\n  color: #b5adbc;\n  -gtk-icon-size: 17px;\n}\n.chip label {\n  font-size: 12.5px;\n  font-weight: 650;\n  color: #f3eef3;\n}\n.chip .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n  margin-top: 0;\n}\n.chip:hover {\n  background-color: #26232c;\n}\n.chip.on {\n  background-color: #b5cb48;\n}\n.chip.on image {\n  color: #192003;\n}\n.chip.on label {\n  color: #192003;\n}\n.chip.on .sub {\n  color: #333d17;\n}\n.chip.on:hover {\n  background-color: #96ae30;\n}\n.chip.on .chev {\n  color: #192003;\n}\n.chip .chev {\n  min-width: 30px;\n  min-height: 30px;\n  border-radius: 0 999px 999px 0;\n  color: #8d8693;\n  border-left: 1px solid rgba(0, 0, 0, 0.18);\n}\n.chip .chev image {\n  -gtk-icon-size: 15px;\n  color: inherit;\n}\n.chip .chev:hover {\n  background-color: rgba(0, 0, 0, 0.14);\n}\n\n.chips {\n  margin-bottom: 0;\n}\n\n.chips > box:last-child {\n  margin-right: 1px;\n}\n\n.chip-grid {\n  margin-bottom: 10px;\n}\n\nscale, scale:horizontal, scale:vertical {\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 6px 0;\n}\n\nscale > trough, scale:horizontal > trough, scale:vertical > trough {\n  min-height: 6px;\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border-radius: 999px;\n  background-color: #26232c;\n}\n\nscale > trough > highlight,\nscale > trough > progress {\n  min-height: 6px;\n  border-radius: 999px;\n  background-color: #b5cb48;\n}\n\nscale > trough > slider {\n  min-width: 17px;\n  min-height: 17px;\n  margin: -6px; /* prototype knob 17\xD717 */\n  border-radius: 999px;\n  background-color: #f3eef3;\n  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);\n}\n\n.srow {\n  padding: 0 2px 0 2px;\n  min-height: 42px;\n}\n.srow .sval {\n  font-size: 11px;\n  font-weight: 600;\n  color: #b5adbc;\n  min-width: 32px;\n}\n\n.srow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n  padding: 0;\n  margin: 0 -12px 0 12px;\n}\n\n.srow .chev {\n  padding: 6px 8px;\n  color: #8d8693;\n  border-radius: 9px;\n}\n.srow .chev image {\n  -gtk-icon-size: 15px;\n  padding: 0;\n  margin: 0;\n}\n.srow .chev:hover {\n  background-color: #1d1a22;\n}\n\n.gbanner {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n  margin-bottom: 8px;\n}\n.gbanner .t {\n  color: #edbb64;\n  font-weight: 650;\n  font-size: 11.5px;\n}\n.gbanner .s {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.gbanner image {\n  color: #edbb64;\n  -gtk-icon-size: 16px;\n}\n\n.gbtn {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 10px;\n  font-weight: 650;\n  font-size: 11.5px;\n  padding: 7px 12px;\n}\n.gbtn:hover {\n  background-color: #96ae30;\n}\n\n.dhead {\n  padding-bottom: 10px;\n}\n.dhead button {\n  padding: 7px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.dhead button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.dhead label {\n  font-weight: 650;\n  font-size: 14px;\n}\n\nswitch {\n  background-color: #26232c;\n  border-radius: 999px;\n  min-width: 46px;\n  min-height: 26px;\n}\nswitch slider {\n  background-color: #b5adbc;\n  border-radius: 999px;\n  min-width: 20px;\n  min-height: 20px;\n}\nswitch:checked {\n  background-color: #b5cb48;\n}\nswitch:checked slider {\n  background-color: #192003;\n}\n\n.xrow {\n  background-color: transparent;\n  border-radius: 9px;\n  padding: 9px 11px;\n}\n.xrow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.xrow label {\n  font-size: 12.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.xrow .xs {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.xrow:hover {\n  background-color: #1d1a22;\n}\n.xrow.active {\n  background-color: rgba(106, 197, 143, 0.08);\n}\n.xrow.active image {\n  color: #b5cb48;\n}\n.xrow.active .xs {\n  color: #b5cb48;\n}\n\n.mixrow {\n  padding: 4px 2px;\n  min-height: 40px;\n}\n.mixrow .mi {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 6px;\n}\n.mixrow .mi image {\n  color: #b5adbc;\n  -gtk-icon-size: 14px;\n}\n.mixrow .mname {\n  font-size: 12px;\n  color: #b5adbc;\n  min-width: 72px;\n}\n\n.sheet.launcher {\n  min-width: 568px;\n}\n\n.launcher {\n  padding: 8px;\n}\n\n.field {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 3px 12px;\n  margin-bottom: 6px;\n}\n.field image {\n  color: #8d8693;\n  -gtk-icon-size: 16px;\n}\n.field entry {\n  background: none;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  color: #f3eef3;\n  font-size: 14.5px;\n  caret-color: #b5cb48;\n  padding: 8px 0;\n  min-height: 0;\n  min-width: 0;\n}\n.field entry text {\n  min-height: 0;\n}\n.field .lplaceholder {\n  color: #b5adbc;\n  font-size: 14.5px;\n}\n.field .ghost {\n  color: #8d8693;\n  font-size: 14.5px;\n}\n.field .kbd {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 5px;\n  font-size: 10.5px;\n  padding: 3px 7px;\n}\n\n.tiles {\n  padding: 8px 2px 10px;\n}\n\n.tile {\n  padding: 5px 0;\n  border-radius: 10px;\n  min-width: 64px;\n}\n.tile .icon-tile {\n  min-width: 0;\n  min-height: 0;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.tile label {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.tile:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.tile:hover label {\n  color: #f3eef3;\n}\n\n.lfoot {\n  padding: 7px 10px 3px;\n  color: #8d8693;\n  font-size: 11px;\n}\n.lfoot b {\n  color: #b5adbc;\n  font-weight: 650;\n}\n\n.lwidgets {\n  padding: 0 2px 6px;\n}\n\n.widget {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n}\n.widget label {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.widget .hint {\n  color: #b5adbc;\n  font-size: 11px;\n  font-weight: 400;\n}\n\n.lwm .lwart {\n  background-color: #26232c;\n  border-radius: 9px;\n  min-width: 34px;\n  min-height: 34px;\n}\n.lwm .lwart image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.lwm .mbtn {\n  color: #f3eef3;\n  border-radius: 8px;\n  min-width: 29px;\n  min-height: 29px;\n}\n.lwm .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.lwm .mbtn:hover {\n  background-color: #26232c;\n}\n\n.lrows {\n  padding: 4px 2px;\n}\n\n.sec {\n  color: #8d8693;\n  font-size: 10px;\n  font-weight: 650;\n  padding: 8px 10px 2px;\n}\n\n.row {\n  border-radius: 10px;\n  padding: 7px 10px;\n}\n.row .ri {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 2px;\n}\n.row image {\n  -gtk-icon-size: 24px;\n}\n.row label {\n  font-size: 13px;\n  font-weight: 600;\n}\n.row .hint {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.row .runk {\n  background-color: #322e39;\n  color: #b5adbc;\n  border-radius: 6px;\n  font-size: 10.5px;\n  padding: 2px 7px;\n}\n.row:hover {\n  background-color: #1d1a22;\n}\n.row.sel {\n  background-color: #26232c;\n}\n\n.cal {\n  min-width: 309px;\n}\n.cal .sub {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.cal .hero {\n  color: #f3eef3;\n  font-size: 19px;\n  font-weight: 650;\n}\n.cal .calhero {\n  padding: 4px 8px 8px;\n}\n.cal .cal-grid {\n  margin-top: 8px;\n}\n.cal .month {\n  border-radius: 8px;\n  padding: 5px;\n  font-weight: 650;\n  font-size: 13px;\n}\n.cal .month:hover {\n  background-color: #1d1a22;\n}\n.cal centerbox > button {\n  padding: 6px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.cal centerbox > button image {\n  -gtk-icon-size: 14px;\n}\n.cal centerbox > button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.cal .dow {\n  color: #8d8693;\n  font-size: 9.5px;\n  font-weight: 600;\n  padding: 3px 0 5px;\n}\n.cal .wk {\n  color: #8d8693;\n  font-size: 9px;\n  font-weight: 600;\n}\n.cal .day {\n  background: none;\n  background-color: transparent;\n  color: #f3eef3;\n  font-size: 11px;\n  font-weight: 600;\n  min-width: 24px;\n  min-height: 24px;\n  border-radius: 99px;\n}\n.cal .day:hover {\n  background-color: #1d1a22;\n}\n.cal .day.we {\n  color: #8d8693;\n}\n.cal .day.out {\n  color: #8d8693;\n}\n.cal .day.today {\n  background-color: #b5cb48;\n  color: #192003;\n  font-weight: 700;\n}\n.cal .day.today:hover {\n  background-color: #b5cb48;\n}\n.cal .day.sel:not(.today) {\n  box-shadow: inset 0 0 0 1.5px #b5adbc;\n}\n.cal .day.today.sel {\n  box-shadow: inset 0 0 0 1.5px #192003;\n}\n.cal .day .evdot {\n  min-width: 3px;\n  min-height: 3px;\n  border-radius: 99px;\n  background-color: #b5cb48;\n  margin-bottom: 2px;\n}\n.cal .day.today .evdot {\n  background-color: #192003;\n}\n.cal .evcard {\n  margin-top: 10px;\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px;\n}\n.cal .evhead {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n  padding: 1px 3px 8px;\n}\n.cal .evempty {\n  font-size: 11.5px;\n  color: #b5adbc;\n  padding: 2px 3px 3px;\n}\n.cal .evempty image {\n  color: #8d8693;\n  -gtk-icon-size: 14px;\n}\n.cal .evrow {\n  background-color: #100e14;\n  border-radius: 10px;\n  padding: 8px 10px;\n  margin-bottom: 4px;\n}\n.cal .evrow:last-child {\n  margin-bottom: 0;\n}\n.cal .evrow .evic {\n  background-color: #628933;\n  border-radius: 8px;\n  padding: 6px;\n}\n.cal .evrow .evic image {\n  color: #fff;\n  -gtk-icon-size: 14px;\n}\n.cal .evrow label {\n  font-size: 12px;\n  font-weight: 650;\n}\n.cal .evrow .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n\n.drawer {\n  background: transparent;\n}\n\n.toast {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 20px;\n  padding: 11px 13px;\n  box-shadow: 0 18px 40px rgba(5, 3, 10, 0.45);\n}\n.toast .ncard {\n  background: transparent;\n  box-shadow: none;\n  border-radius: 0;\n  padding: 0;\n}\n\n.ncard {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 11px 12px;\n}\n.ncard .nic {\n  background-color: #26232c;\n  min-width: 30px;\n  min-height: 30px;\n  border-radius: 9px;\n}\n.ncard .nic image {\n  color: #b5adbc;\n  -gtk-icon-size: 15px;\n}\n.ncard {\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.ncard label {\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.ncard .body {\n  color: #b5adbc;\n  font-size: 11.8px;\n  font-weight: 400;\n}\n.ncard .when {\n  color: #8d8693;\n  font-size: 10px;\n}\n.ncard .nx {\n  min-width: 22px;\n  min-height: 22px;\n  border-radius: 99px;\n  color: #8d8693;\n}\n.ncard .nx image {\n  -gtk-icon-size: 11px;\n}\n.ncard .nx:hover {\n  background-color: #26232c;\n  color: #ef86a0;\n}\n.ncard.media {\n  padding: 10px 11px 9px;\n  margin-bottom: 2px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n}\n.ncard .mart {\n  background-color: #26232c;\n  border-radius: 10px;\n  min-width: 46px;\n  min-height: 46px;\n}\n.ncard .mart image {\n  color: #b5adbc;\n  -gtk-icon-size: 22px;\n}\n.ncard .mmeta label {\n  font-size: 13px;\n}\n.ncard .mmeta .sub {\n  font-size: 11.5px;\n  color: #b5adbc;\n  font-weight: 400;\n}\n.ncard .mbtn {\n  min-width: 29px;\n  min-height: 29px;\n  border-radius: 8px;\n  color: #b5adbc;\n}\n.ncard .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.ncard .mbtn:hover {\n  background-color: #26232c;\n  color: #f3eef3;\n}\n.ncard .mbar {\n  margin-top: 7px;\n}\n.ncard .mtime {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.ncard levelbar.mtrack {\n  min-height: 4px;\n  border-radius: 99px;\n}\n.ncard levelbar.mtrack > trough {\n  min-height: 4px;\n  border-radius: 99px;\n  background-color: #26232c;\n}\n.ncard levelbar.mtrack > trough > block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.ncard levelbar.mtrack > trough > block.empty {\n  background-color: transparent;\n}\n.ncard .memptyrow label {\n  color: #b5adbc;\n  font-size: 12px;\n  font-weight: 400;\n}\n.ncard .memptyrow .mart image {\n  color: #8d8693;\n}\n.ncard .ghostb {\n  background-color: #26232c;\n  color: #f3eef3;\n  font-size: 11.5px;\n  font-weight: 600;\n  padding: 7px 12px;\n  border-radius: 10px;\n}\n.ncard .ghostb label {\n  font-size: 11.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.ncard .ghostb:hover {\n  background-color: #322e39;\n}\n\n.nhead {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 8px 8px 8px 14px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n  margin-bottom: 8px;\n}\n.nhead label {\n  font-size: 13.5px;\n  font-weight: 650;\n}\n.nhead .sub {\n  font-size: 11px;\n  font-weight: 400;\n  color: #8d8693;\n}\n.nhead .nclear {\n  color: #ef86a0;\n  font-size: 11.5px;\n  font-weight: 600;\n  border-radius: 7px;\n  padding: 4px 9px;\n}\n.nhead .nclear image {\n  -gtk-icon-size: 12px;\n  color: #ef86a0;\n}\n.nhead .nclear label {\n  color: #ef86a0;\n}\n.nhead .nclear:hover {\n  background-color: #1d1a22;\n}\n\n.nempty {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 20px 0 16px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.nempty image {\n  color: #b5adbc;\n  -gtk-icon-size: 22px;\n  margin-bottom: 4px;\n}\n.nempty label {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n}\n\n.osd {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 999px;\n  padding: 10px 15px;\n}\n.osd image {\n  color: #f3eef3;\n  -gtk-icon-size: 15px;\n}\n.osd levelbar > trough {\n  min-height: 8px;\n  border-radius: 99px;\n  background-color: #26232c;\n}\n.osd levelbar > trough > block {\n  min-height: 8px;\n  border-radius: 99px;\n}\n.osd levelbar > trough > block.filled {\n  background-color: #b5cb48;\n}\n.osd levelbar > trough > block.empty {\n  background-color: transparent;\n}\n.osd .sval {\n  min-width: 34px;\n  font-size: 11px;\n  font-weight: 600;\n}\n\n.session {\n  background-color: rgba(9, 3, 14, 0.8);\n}\n.session .sbtn {\n  padding: 6px;\n  border-radius: 12px;\n}\n.session .sic {\n  background-color: #100e14;\n  border-radius: 24px;\n  min-width: 62px;\n  min-height: 62px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n  color: #f3eef3;\n  transition: background-color 200ms, color 200ms;\n}\n.session .red .sic {\n  color: #ef86a0;\n}\n.session .sbtn:hover .sic {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.session .red:hover .sic {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.session label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 12px;\n}\n.session .confirm label {\n  color: #ef86a0;\n  font-weight: 650;\n}\n\npopover.cmenu {\n  background-color: #100e14;\n  border-radius: 12px;\n  padding: 5px;\n  min-width: 180px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n  border: none;\n}\npopover.cmenu > arrow, popover.cmenu > contents {\n  background: transparent;\n  border: none;\n  border-radius: 12px;\n}\n\n.cmi {\n  border-radius: 8px;\n  padding: 8px 10px;\n  font-size: 12px;\n  font-weight: 600;\n}\n.cmi image {\n  -gtk-icon-size: 14px;\n  color: #b5adbc;\n}\n.cmi label {\n  color: #f3eef3;\n  font-size: 12px;\n  font-weight: 600;\n}\n.cmi:hover {\n  background-color: #1d1a22;\n}\n.cmi.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.cmi.danger:hover image {\n  color: #4b0f1f;\n}\n.cmi.danger:hover label {\n  color: #4b0f1f;\n}\n\n.csep {\n  background-color: #1d1a22;\n  min-height: 1px;\n  margin: 4px 8px;\n}\n\n.dtip {\n  background-color: #100e14;\n  color: #f3eef3;\n  border-radius: 10px;\n  padding: 6px 11px;\n  font-size: 11.5px;\n  font-weight: 600;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}';

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
        slots.flatMap(({ id, app }, i) => {
          const sep = i === 4 ? [/* @__PURE__ */ jsx2("box", { class: "sep", valign: Gtk4.Align.CENTER })] : [];
          const btn = app ? /* @__PURE__ */ jsx2(DockButton, { app }) : /* @__PURE__ */ jsx2("button", { class: "dbtn placeholder", tooltipText: id.split(".").pop(), children: /* @__PURE__ */ jsx2(
            "image",
            {
              class: "icon-tile",
              iconName: "application-x-executable-symbolic",
              pixelSize: 30
            }
          ) });
          return [...sep, btn];
        }),
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
      marginTop: 56,
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
  const initVol = DEMO ? D.volume : Math.min(speaker?.volume ?? 0.64, 1);
  const volValue = Variable(initVol);
  const volSlider = new TinySlider({ hexpand: true, cssClasses: ["slider"], value: initVol });
  if (!DEMO && speaker)
    bind(speaker, "volume").subscribe((v) => {
      volSlider.get_adjustment().value = Math.min(v, 1);
      volValue.set(Math.min(v, 1));
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
  const nfd = skip() ? null : nd();
  const list = Variable(nfd?.get_notifications() ?? []);
  if (nfd) {
    const refresh = () => list.set(nfd.get_notifications() ?? []);
    nfd.connect("notified", refresh);
    nfd.connect("resolved", refresh);
  }
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
                  onClicked: () => nfd?.get_notifications().forEach((n2) => n2.dismiss()),
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYXBwLnRzIiwgInNhc3M6L2hvbWUva2llcmFuL2Rldi9rb2JlbC1zaGVsbC9hZ3Mvc3R5bGUvbWFpbi5zY3NzIiwgIi4uL2NvbmZpZy50cyIsICIuLi9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9zZXJ2aWNlcy9ub3RpZmQudHMiLCAiLi4vbGliL2luc3BlY3QudHMiLCAiLi4vbGliL3N1cmZhY2UudHMiLCAiLi4vd2lkZ2V0L0Jhci50c3giLCAiLi4vbGliL2RlbW8udHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2pzeC1ydW50aW1lLnRzIiwgIi4uL3dpZGdldC9Eb2NrLnRzeCIsICIuLi93aWRnZXQvTGF1bmNoZXIudHN4IiwgIi4uL2xpYi9mdXp6eS50cyIsICIuLi93aWRnZXQvQ2FsZW5kYXIudHN4IiwgIi4uL3dpZGdldC9RdWlja1NldHRpbmdzLnRzeCIsICIuLi9saWIvdGlueXNsaWRlci50cyIsICIuLi93aWRnZXQvTm90aWZpY2F0aW9ucy50c3giLCAiLi4vd2lkZ2V0L09TRC50c3giLCAiLi4vd2lkZ2V0L1Nlc3Npb24udHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUgQ29uc3RydWN0UHJvcHMgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmV4cG9ydCB7IEFzdGFsLCBHdGssIEdkayB9XG5leHBvcnQgeyBkZWZhdWx0IGFzIEFwcCB9IGZyb20gXCIuL2FwcC5qc1wiXG5leHBvcnQgeyBhc3RhbGlmeSwgQ29uc3RydWN0UHJvcHMgfVxuZXhwb3J0ICogYXMgV2lkZ2V0IGZyb20gXCIuL3dpZGdldC5qc1wiXG5leHBvcnQgeyBob29rIH0gZnJvbSBcIi4uL19hc3RhbFwiXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEJpbmRpbmcsIHsgdHlwZSBDb25uZWN0YWJsZSwgdHlwZSBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcbmltcG9ydCB7IGludGVydmFsIH0gZnJvbSBcIi4vdGltZS5qc1wiXG5pbXBvcnQgeyBleGVjQXN5bmMsIHN1YnByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcblxuY2xhc3MgVmFyaWFibGVXcmFwcGVyPFQ+IGV4dGVuZHMgRnVuY3Rpb24ge1xuICAgIHByaXZhdGUgdmFyaWFibGUhOiBBc3RhbC5WYXJpYWJsZUJhc2VcbiAgICBwcml2YXRlIGVyckhhbmRsZXI/ID0gY29uc29sZS5lcnJvclxuXG4gICAgcHJpdmF0ZSBfdmFsdWU6IFRcbiAgICBwcml2YXRlIF9wb2xsPzogQXN0YWwuVGltZVxuICAgIHByaXZhdGUgX3dhdGNoPzogQXN0YWwuUHJvY2Vzc1xuXG4gICAgcHJpdmF0ZSBwb2xsSW50ZXJ2YWwgPSAxMDAwXG4gICAgcHJpdmF0ZSBwb2xsRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG4gICAgcHJpdmF0ZSBwb2xsVHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgcHJpdmF0ZSBwb2xsRm4/OiAocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD5cblxuICAgIHByaXZhdGUgd2F0Y2hUcmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICBwcml2YXRlIHdhdGNoRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG5cbiAgICBjb25zdHJ1Y3Rvcihpbml0OiBUKSB7XG4gICAgICAgIHN1cGVyKClcbiAgICAgICAgdGhpcy5fdmFsdWUgPSBpbml0XG4gICAgICAgIHRoaXMudmFyaWFibGUgPSBuZXcgQXN0YWwuVmFyaWFibGVCYXNlKClcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZHJvcHBlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN0b3BXYXRjaCgpXG4gICAgICAgICAgICB0aGlzLnN0b3BQb2xsKClcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gdGhpcy5lcnJIYW5kbGVyPy4oZXJyKSlcbiAgICAgICAgcmV0dXJuIG5ldyBQcm94eSh0aGlzLCB7XG4gICAgICAgICAgICBhcHBseTogKHRhcmdldCwgXywgYXJncykgPT4gdGFyZ2V0Ll9jYWxsKGFyZ3NbMF0pLFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHByaXZhdGUgX2NhbGw8UiA9IFQ+KHRyYW5zZm9ybT86ICh2YWx1ZTogVCkgPT4gUik6IEJpbmRpbmc8Uj4ge1xuICAgICAgICBjb25zdCBiID0gQmluZGluZy5iaW5kKHRoaXMpXG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm0gPyBiLmFzKHRyYW5zZm9ybSkgOiBiIGFzIHVua25vd24gYXMgQmluZGluZzxSPlxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKGBWYXJpYWJsZTwke3RoaXMuZ2V0KCl9PmApXG4gICAgfVxuXG4gICAgZ2V0KCk6IFQgeyByZXR1cm4gdGhpcy5fdmFsdWUgfVxuICAgIHNldCh2YWx1ZTogVCkge1xuICAgICAgICBpZiAodmFsdWUgIT09IHRoaXMuX3ZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLl92YWx1ZSA9IHZhbHVlXG4gICAgICAgICAgICB0aGlzLnZhcmlhYmxlLmVtaXQoXCJjaGFuZ2VkXCIpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFBvbGwoKSB7XG4gICAgICAgIGlmICh0aGlzLl9wb2xsKVxuICAgICAgICAgICAgcmV0dXJuXG5cbiAgICAgICAgaWYgKHRoaXMucG9sbEZuKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2ID0gdGhpcy5wb2xsRm4hKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICAgICAgaWYgKHYgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgICAgICAgICAgIHYudGhlbih2ID0+IHRoaXMuc2V0KHYpKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2V0KHYpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnBvbGxFeGVjKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBleGVjQXN5bmModGhpcy5wb2xsRXhlYyEpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKHYgPT4gdGhpcy5zZXQodGhpcy5wb2xsVHJhbnNmb3JtISh2LCB0aGlzLmdldCgpKSkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFdhdGNoKCkge1xuICAgICAgICBpZiAodGhpcy5fd2F0Y2gpXG4gICAgICAgICAgICByZXR1cm5cblxuICAgICAgICB0aGlzLl93YXRjaCA9IHN1YnByb2Nlc3Moe1xuICAgICAgICAgICAgY21kOiB0aGlzLndhdGNoRXhlYyEsXG4gICAgICAgICAgICBvdXQ6IG91dCA9PiB0aGlzLnNldCh0aGlzLndhdGNoVHJhbnNmb3JtIShvdXQsIHRoaXMuZ2V0KCkpKSxcbiAgICAgICAgICAgIGVycjogZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVyciksXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgc3RvcFBvbGwoKSB7XG4gICAgICAgIHRoaXMuX3BvbGw/LmNhbmNlbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl9wb2xsXG4gICAgfVxuXG4gICAgc3RvcFdhdGNoKCkge1xuICAgICAgICB0aGlzLl93YXRjaD8ua2lsbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl93YXRjaFxuICAgIH1cblxuICAgIGlzUG9sbGluZygpIHsgcmV0dXJuICEhdGhpcy5fcG9sbCB9XG4gICAgaXNXYXRjaGluZygpIHsgcmV0dXJuICEhdGhpcy5fd2F0Y2ggfVxuXG4gICAgZHJvcCgpIHtcbiAgICAgICAgdGhpcy52YXJpYWJsZS5lbWl0KFwiZHJvcHBlZFwiKVxuICAgIH1cblxuICAgIG9uRHJvcHBlZChjYWxsYmFjazogKCkgPT4gdm9pZCkge1xuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJkcm9wcGVkXCIsIGNhbGxiYWNrKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb25FcnJvcihjYWxsYmFjazogKGVycjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmVyckhhbmRsZXJcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gY2FsbGJhY2soZXJyKSlcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGlkID0gdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiY2hhbmdlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICB9KVxuICAgICAgICByZXR1cm4gKCkgPT4gdGhpcy52YXJpYWJsZS5kaXNjb25uZWN0KGlkKVxuICAgIH1cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgY2FsbGJhY2s6IChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPlxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSB8ICgocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD4pLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wUG9sbCgpXG4gICAgICAgIHRoaXMucG9sbEludGVydmFsID0gaW50ZXJ2YWxcbiAgICAgICAgdGhpcy5wb2xsVHJhbnNmb3JtID0gdHJhbnNmb3JtXG4gICAgICAgIGlmICh0eXBlb2YgZXhlYyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxGbiA9IGV4ZWNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBvbGxFeGVjXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxFeGVjID0gZXhlY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucG9sbEZuXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zdGFydFBvbGwoKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgd2F0Y2goXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wV2F0Y2goKVxuICAgICAgICB0aGlzLndhdGNoRXhlYyA9IGV4ZWNcbiAgICAgICAgdGhpcy53YXRjaFRyYW5zZm9ybSA9IHRyYW5zZm9ybVxuICAgICAgICB0aGlzLnN0YXJ0V2F0Y2goKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqczogQXJyYXk8W29iajogQ29ubmVjdGFibGUsIHNpZ25hbDogc3RyaW5nXT4sXG4gICAgICAgIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9iajogQ29ubmVjdGFibGUsXG4gICAgICAgIHNpZ25hbDogc3RyaW5nLFxuICAgICAgICBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmpzOiBDb25uZWN0YWJsZSB8IEFycmF5PFtvYmo6IENvbm5lY3RhYmxlLCBzaWduYWw6IHN0cmluZ10+LFxuICAgICAgICBzaWdPckZuOiBzdHJpbmcgfCAoKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiBUKSxcbiAgICAgICAgY2FsbGJhY2s/OiAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0eXBlb2Ygc2lnT3JGbiA9PT0gXCJmdW5jdGlvblwiID8gc2lnT3JGbiA6IGNhbGxiYWNrID8/ICgoKSA9PiB0aGlzLmdldCgpKVxuICAgICAgICBjb25zdCBzZXQgPSAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IHRoaXMuc2V0KGYob2JqLCAuLi5hcmdzKSlcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvYmpzKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBvYmogb2Ygb2Jqcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtvLCBzXSA9IG9ialxuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gby5jb25uZWN0KHMsIHNldClcbiAgICAgICAgICAgICAgICB0aGlzLm9uRHJvcHBlZCgoKSA9PiBvLmRpc2Nvbm5lY3QoaWQpKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBzaWdPckZuID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWQgPSBvYmpzLmNvbm5lY3Qoc2lnT3JGbiwgc2V0KVxuICAgICAgICAgICAgICAgIHRoaXMub25Ecm9wcGVkKCgpID0+IG9ianMuZGlzY29ubmVjdChpZCkpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgc3RhdGljIGRlcml2ZTxcbiAgICAgICAgY29uc3QgRGVwcyBleHRlbmRzIEFycmF5PFN1YnNjcmliYWJsZTxhbnk+PixcbiAgICAgICAgQXJncyBleHRlbmRzIHtcbiAgICAgICAgICAgIFtLIGluIGtleW9mIERlcHNdOiBEZXBzW0tdIGV4dGVuZHMgU3Vic2NyaWJhYmxlPGluZmVyIFQ+ID8gVCA6IG5ldmVyXG4gICAgICAgIH0sXG4gICAgICAgIFYgPSBBcmdzLFxuICAgID4oZGVwczogRGVwcywgZm46ICguLi5hcmdzOiBBcmdzKSA9PiBWID0gKC4uLmFyZ3MpID0+IGFyZ3MgYXMgdW5rbm93biBhcyBWKSB7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IGZuKC4uLmRlcHMubWFwKGQgPT4gZC5nZXQoKSkgYXMgQXJncylcbiAgICAgICAgY29uc3QgZGVyaXZlZCA9IG5ldyBWYXJpYWJsZSh1cGRhdGUoKSlcbiAgICAgICAgY29uc3QgdW5zdWJzID0gZGVwcy5tYXAoZGVwID0+IGRlcC5zdWJzY3JpYmUoKCkgPT4gZGVyaXZlZC5zZXQodXBkYXRlKCkpKSlcbiAgICAgICAgZGVyaXZlZC5vbkRyb3BwZWQoKCkgPT4gdW5zdWJzLm1hcCh1bnN1YiA9PiB1bnN1YigpKSlcbiAgICAgICAgcmV0dXJuIGRlcml2ZWRcbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmFyaWFibGU8VD4gZXh0ZW5kcyBPbWl0PFZhcmlhYmxlV3JhcHBlcjxUPiwgXCJiaW5kXCI+IHtcbiAgICA8Uj4odHJhbnNmb3JtOiAodmFsdWU6IFQpID0+IFIpOiBCaW5kaW5nPFI+XG4gICAgKCk6IEJpbmRpbmc8VD5cbn1cblxuZXhwb3J0IGNvbnN0IFZhcmlhYmxlID0gbmV3IFByb3h5KFZhcmlhYmxlV3JhcHBlciBhcyBhbnksIHtcbiAgICBhcHBseTogKF90LCBfYSwgYXJncykgPT4gbmV3IFZhcmlhYmxlV3JhcHBlcihhcmdzWzBdKSxcbn0pIGFzIHtcbiAgICBkZXJpdmU6IHR5cGVvZiBWYXJpYWJsZVdyYXBwZXJbXCJkZXJpdmVcIl1cbiAgICA8VD4oaW5pdDogVCk6IFZhcmlhYmxlPFQ+XG4gICAgbmV3PFQ+KGluaXQ6IFQpOiBWYXJpYWJsZTxUPlxufVxuXG5leHBvcnQgY29uc3QgeyBkZXJpdmUgfSA9IFZhcmlhYmxlXG5leHBvcnQgZGVmYXVsdCBWYXJpYWJsZVxuIiwgImV4cG9ydCBjb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuZXhwb3J0IGNvbnN0IGtlYmFiaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMS0kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiX1wiLCBcIi1cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5leHBvcnQgaW50ZXJmYWNlIFN1YnNjcmliYWJsZTxUID0gdW5rbm93bj4ge1xuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKTogKCkgPT4gdm9pZFxuICAgIGdldCgpOiBUXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29ubmVjdGFibGUge1xuICAgIGNvbm5lY3Qoc2lnbmFsOiBzdHJpbmcsIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IHVua25vd24pOiBudW1iZXJcbiAgICBkaXNjb25uZWN0KGlkOiBudW1iZXIpOiB2b2lkXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBjbGFzcyBCaW5kaW5nPFZhbHVlPiB7XG4gICAgcHJpdmF0ZSB0cmFuc2Zvcm1GbiA9ICh2OiBhbnkpID0+IHZcblxuICAgICNlbWl0dGVyOiBTdWJzY3JpYmFibGU8VmFsdWU+IHwgQ29ubmVjdGFibGVcbiAgICAjcHJvcD86IHN0cmluZ1xuXG4gICAgc3RhdGljIGJpbmQ8XG4gICAgICAgIFQgZXh0ZW5kcyBDb25uZWN0YWJsZSxcbiAgICAgICAgUCBleHRlbmRzIGtleW9mIFQsXG4gICAgPihvYmplY3Q6IFQsIHByb3BlcnR5OiBQKTogQmluZGluZzxUW1BdPlxuXG4gICAgc3RhdGljIGJpbmQ8VD4ob2JqZWN0OiBTdWJzY3JpYmFibGU8VD4pOiBCaW5kaW5nPFQ+XG5cbiAgICBzdGF0aWMgYmluZChlbWl0dGVyOiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSwgcHJvcD86IHN0cmluZykge1xuICAgICAgICByZXR1cm4gbmV3IEJpbmRpbmcoZW1pdHRlciwgcHJvcClcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdG9yKGVtaXR0ZXI6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlPFZhbHVlPiwgcHJvcD86IHN0cmluZykge1xuICAgICAgICB0aGlzLiNlbWl0dGVyID0gZW1pdHRlclxuICAgICAgICB0aGlzLiNwcm9wID0gcHJvcCAmJiBrZWJhYmlmeShwcm9wKVxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gYEJpbmRpbmc8JHt0aGlzLiNlbWl0dGVyfSR7dGhpcy4jcHJvcCA/IGAsIFwiJHt0aGlzLiNwcm9wfVwiYCA6IFwiXCJ9PmBcbiAgICB9XG5cbiAgICBhczxUPihmbjogKHY6IFZhbHVlKSA9PiBUKTogQmluZGluZzxUPiB7XG4gICAgICAgIGNvbnN0IGJpbmQgPSBuZXcgQmluZGluZyh0aGlzLiNlbWl0dGVyLCB0aGlzLiNwcm9wKVxuICAgICAgICBiaW5kLnRyYW5zZm9ybUZuID0gKHY6IFZhbHVlKSA9PiBmbih0aGlzLnRyYW5zZm9ybUZuKHYpKVxuICAgICAgICByZXR1cm4gYmluZCBhcyB1bmtub3duIGFzIEJpbmRpbmc8VD5cbiAgICB9XG5cbiAgICBnZXQoKTogVmFsdWUge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuZ2V0ID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyLmdldCgpKVxuXG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jcHJvcCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgY29uc3QgZ2V0dGVyID0gYGdldF8ke3NuYWtlaWZ5KHRoaXMuI3Byb3ApfWBcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlcltnZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlcltnZXR0ZXJdKCkpXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXJbdGhpcy4jcHJvcF0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbiBub3QgZ2V0IHZhbHVlIG9mIGJpbmRpbmdcIilcbiAgICB9XG5cbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVmFsdWUpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLnN1YnNjcmliZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy4jZW1pdHRlci5zdWJzY3JpYmUoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgY29uc3Qgc2lnbmFsID0gYG5vdGlmeTo6JHt0aGlzLiNwcm9wfWBcbiAgICAgICAgICAgIGNvbnN0IGlkID0gdGhpcy4jZW1pdHRlci5jb25uZWN0KHNpZ25hbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICAodGhpcy4jZW1pdHRlci5kaXNjb25uZWN0IGFzIENvbm5lY3RhYmxlW1wiZGlzY29ubmVjdFwiXSkoaWQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgRXJyb3IoYCR7dGhpcy4jZW1pdHRlcn0gaXMgbm90IGJpbmRhYmxlYClcbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCB7IGJpbmQgfSA9IEJpbmRpbmdcbmV4cG9ydCBkZWZhdWx0IEJpbmRpbmdcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5cbmV4cG9ydCB0eXBlIFRpbWUgPSBBc3RhbC5UaW1lXG5leHBvcnQgY29uc3QgVGltZSA9IEFzdGFsLlRpbWVcblxuZXhwb3J0IGZ1bmN0aW9uIGludGVydmFsKGludGVydmFsOiBudW1iZXIsIGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLmludGVydmFsKGludGVydmFsLCAoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXQodGltZW91dDogbnVtYmVyLCBjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS50aW1lb3V0KHRpbWVvdXQsICgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaWRsZShjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS5pZGxlKCgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcblxudHlwZSBBcmdzID0ge1xuICAgIGNtZDogc3RyaW5nIHwgc3RyaW5nW11cbiAgICBvdXQ/OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWRcbiAgICBlcnI/OiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWRcbn1cblxuZXhwb3J0IHR5cGUgUHJvY2VzcyA9IEFzdGFsLlByb2Nlc3NcbmV4cG9ydCBjb25zdCBQcm9jZXNzID0gQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhhcmdzOiBBcmdzKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBjbWQ6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgIG9uT3V0PzogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkLFxuICAgIG9uRXJyPzogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkLFxuKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBhcmdzT3JDbWQ6IEFyZ3MgfCBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICBvbk91dDogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkID0gcHJpbnQsXG4gICAgb25FcnI6IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZCA9IHByaW50ZXJyLFxuKSB7XG4gICAgY29uc3QgYXJncyA9IEFycmF5LmlzQXJyYXkoYXJnc09yQ21kKSB8fCB0eXBlb2YgYXJnc09yQ21kID09PSBcInN0cmluZ1wiXG4gICAgY29uc3QgeyBjbWQsIGVyciwgb3V0IH0gPSB7XG4gICAgICAgIGNtZDogYXJncyA/IGFyZ3NPckNtZCA6IGFyZ3NPckNtZC5jbWQsXG4gICAgICAgIGVycjogYXJncyA/IG9uRXJyIDogYXJnc09yQ21kLmVyciB8fCBvbkVycixcbiAgICAgICAgb3V0OiBhcmdzID8gb25PdXQgOiBhcmdzT3JDbWQub3V0IHx8IG9uT3V0LFxuICAgIH1cblxuICAgIGNvbnN0IHByb2MgPSBBcnJheS5pc0FycmF5KGNtZClcbiAgICAgICAgPyBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3N2KGNtZClcbiAgICAgICAgOiBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3MoY21kKVxuXG4gICAgcHJvYy5jb25uZWN0KFwic3Rkb3V0XCIsIChfLCBzdGRvdXQ6IHN0cmluZykgPT4gb3V0KHN0ZG91dCkpXG4gICAgcHJvYy5jb25uZWN0KFwic3RkZXJyXCIsIChfLCBzdGRlcnI6IHN0cmluZykgPT4gZXJyKHN0ZGVycikpXG4gICAgcmV0dXJuIHByb2Ncbn1cblxuLyoqIEB0aHJvd3Mge0dMaWIuRXJyb3J9IFRocm93cyBzdGRlcnIgKi9cbmV4cG9ydCBmdW5jdGlvbiBleGVjKGNtZDogc3RyaW5nIHwgc3RyaW5nW10pIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShjbWQpXG4gICAgICAgID8gQXN0YWwuUHJvY2Vzcy5leGVjdihjbWQpXG4gICAgICAgIDogQXN0YWwuUHJvY2Vzcy5leGVjKGNtZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4ZWNBc3luYyhjbWQ6IHN0cmluZyB8IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjbWQpKSB7XG4gICAgICAgICAgICBBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmN2KGNtZCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jdl9maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEFzdGFsLlByb2Nlc3MuZXhlY19hc3luYyhjbWQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLlByb2Nlc3MuZXhlY19maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiaW1wb3J0IFZhcmlhYmxlIGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbmltcG9ydCB7IGV4ZWNBc3luYyB9IGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuaW1wb3J0IEJpbmRpbmcsIHsgQ29ubmVjdGFibGUsIGtlYmFiaWZ5LCBzbmFrZWlmeSwgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCBjb25zdCBub0ltcGxpY2l0RGVzdHJveSA9IFN5bWJvbChcIm5vIG5vIGltcGxpY2l0IGRlc3Ryb3lcIilcbmV4cG9ydCBjb25zdCBzZXRDaGlsZHJlbiA9IFN5bWJvbChcImNoaWxkcmVuIHNldHRlciBtZXRob2RcIilcblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQmluZGluZ3MoYXJyYXk6IGFueVtdKSB7XG4gICAgZnVuY3Rpb24gZ2V0VmFsdWVzKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgIGxldCBpID0gMFxuICAgICAgICByZXR1cm4gYXJyYXkubWFwKHZhbHVlID0+IHZhbHVlIGluc3RhbmNlb2YgQmluZGluZ1xuICAgICAgICAgICAgPyBhcmdzW2krK11cbiAgICAgICAgICAgIDogdmFsdWUsXG4gICAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBiaW5kaW5ncyA9IGFycmF5LmZpbHRlcihpID0+IGkgaW5zdGFuY2VvZiBCaW5kaW5nKVxuXG4gICAgaWYgKGJpbmRpbmdzLmxlbmd0aCA9PT0gMClcbiAgICAgICAgcmV0dXJuIGFycmF5XG5cbiAgICBpZiAoYmluZGluZ3MubGVuZ3RoID09PSAxKVxuICAgICAgICByZXR1cm4gYmluZGluZ3NbMF0uYXMoZ2V0VmFsdWVzKVxuXG4gICAgcmV0dXJuIFZhcmlhYmxlLmRlcml2ZShiaW5kaW5ncywgZ2V0VmFsdWVzKSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRQcm9wKG9iajogYW55LCBwcm9wOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzZXR0ZXIgPSBgc2V0XyR7c25ha2VpZnkocHJvcCl9YFxuICAgICAgICBpZiAodHlwZW9mIG9ialtzZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gb2JqW3NldHRlcl0odmFsdWUpXG5cbiAgICAgICAgcmV0dXJuIChvYmpbcHJvcF0gPSB2YWx1ZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBjb3VsZCBub3Qgc2V0IHByb3BlcnR5IFwiJHtwcm9wfVwiIG9uICR7b2JqfTpgLCBlcnJvcilcbiAgICB9XG59XG5cbmV4cG9ydCB0eXBlIEJpbmRhYmxlUHJvcHM8VD4gPSB7XG4gICAgW0sgaW4ga2V5b2YgVF06IEJpbmRpbmc8VFtLXT4gfCBUW0tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaG9vazxXaWRnZXQgZXh0ZW5kcyBDb25uZWN0YWJsZT4oXG4gICAgd2lkZ2V0OiBXaWRnZXQsXG4gICAgb2JqZWN0OiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSxcbiAgICBzaWduYWxPckNhbGxiYWNrOiBzdHJpbmcgfCAoKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQpLFxuICAgIGNhbGxiYWNrPzogKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4pIHtcbiAgICBpZiAodHlwZW9mIG9iamVjdC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIgJiYgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgaWQgPSBvYmplY3QuY29ubmVjdChzaWduYWxPckNhbGxiYWNrLCAoXzogYW55LCAuLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCAoKSA9PiB7XG4gICAgICAgICAgICAob2JqZWN0LmRpc2Nvbm5lY3QgYXMgQ29ubmVjdGFibGVbXCJkaXNjb25uZWN0XCJdKShpZClcbiAgICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvYmplY3Quc3Vic2NyaWJlID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIHNpZ25hbE9yQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCB1bnN1YiA9IG9iamVjdC5zdWJzY3JpYmUoKC4uLmFyZ3M6IHVua25vd25bXSkgPT4ge1xuICAgICAgICAgICAgc2lnbmFsT3JDYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCB1bnN1YilcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25zdHJ1Y3Q8V2lkZ2V0IGV4dGVuZHMgQ29ubmVjdGFibGUgJiB7IFtzZXRDaGlsZHJlbl06IChjaGlsZHJlbjogYW55W10pID0+IHZvaWQgfT4od2lkZ2V0OiBXaWRnZXQsIGNvbmZpZzogYW55KSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHByZWZlci1jb25zdFxuICAgIGxldCB7IHNldHVwLCBjaGlsZCwgY2hpbGRyZW4gPSBbXSwgLi4ucHJvcHMgfSA9IGNvbmZpZ1xuXG4gICAgaWYgKGNoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cbiAgICB9XG5cbiAgICBpZiAoY2hpbGQpIHtcbiAgICAgICAgY2hpbGRyZW4udW5zaGlmdChjaGlsZClcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgdW5kZWZpbmVkIHZhbHVlc1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNvbGxlY3QgYmluZGluZ3NcbiAgICBjb25zdCBiaW5kaW5nczogQXJyYXk8W3N0cmluZywgQmluZGluZzxhbnk+XT4gPSBPYmplY3RcbiAgICAgICAgLmtleXMocHJvcHMpXG4gICAgICAgIC5yZWR1Y2UoKGFjYzogYW55LCBwcm9wKSA9PiB7XG4gICAgICAgICAgICBpZiAocHJvcHNbcHJvcF0gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmluZGluZyA9IHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5hY2MsIFtwcm9wLCBiaW5kaW5nXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBjb2xsZWN0IHNpZ25hbCBoYW5kbGVyc1xuICAgIGNvbnN0IG9uSGFuZGxlcnM6IEFycmF5PFtzdHJpbmcsIHN0cmluZyB8ICgoKSA9PiB1bmtub3duKV0+ID0gT2JqZWN0XG4gICAgICAgIC5rZXlzKHByb3BzKVxuICAgICAgICAucmVkdWNlKChhY2M6IGFueSwga2V5KSA9PiB7XG4gICAgICAgICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoXCJvblwiKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNpZyA9IGtlYmFiaWZ5KGtleSkuc3BsaXQoXCItXCIpLnNsaWNlKDEpLmpvaW4oXCItXCIpXG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlciA9IHByb3BzW2tleV1cbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICAgICAgICAgIHJldHVybiBbLi4uYWNjLCBbc2lnLCBoYW5kbGVyXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBzZXQgY2hpbGRyZW5cbiAgICBjb25zdCBtZXJnZWRDaGlsZHJlbiA9IG1lcmdlQmluZGluZ3MoY2hpbGRyZW4uZmxhdChJbmZpbml0eSkpXG4gICAgaWYgKG1lcmdlZENoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuLmdldCgpKVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgbWVyZ2VkQ2hpbGRyZW4uc3Vic2NyaWJlKCh2KSA9PiB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKHYpXG4gICAgICAgIH0pKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChtZXJnZWRDaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0dXAgc2lnbmFsIGhhbmRsZXJzXG4gICAgZm9yIChjb25zdCBbc2lnbmFsLCBjYWxsYmFja10gb2Ygb25IYW5kbGVycykge1xuICAgICAgICBjb25zdCBzaWcgPSBzaWduYWwuc3RhcnRzV2l0aChcIm5vdGlmeVwiKVxuICAgICAgICAgICAgPyBzaWduYWwucmVwbGFjZShcIi1cIiwgXCI6OlwiKVxuICAgICAgICAgICAgOiBzaWduYWxcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KHNpZywgY2FsbGJhY2spXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChzaWcsICgpID0+IGV4ZWNBc3luYyhjYWxsYmFjaylcbiAgICAgICAgICAgICAgICAudGhlbihwcmludCkuY2F0Y2goY29uc29sZS5lcnJvcikpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZXR1cCBiaW5kaW5ncyBoYW5kbGVyc1xuICAgIGZvciAoY29uc3QgW3Byb3AsIGJpbmRpbmddIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGlmIChwcm9wID09PSBcImNoaWxkXCIgfHwgcHJvcCA9PT0gXCJjaGlsZHJlblwiKSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgYmluZGluZy5zdWJzY3JpYmUoKHY6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0odilcbiAgICAgICAgICAgIH0pKVxuICAgICAgICB9XG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBiaW5kaW5nLnN1YnNjcmliZSgodjogYW55KSA9PiB7XG4gICAgICAgICAgICBzZXRQcm9wKHdpZGdldCwgcHJvcCwgdilcbiAgICAgICAgfSkpXG4gICAgICAgIHNldFByb3Aod2lkZ2V0LCBwcm9wLCBiaW5kaW5nLmdldCgpKVxuICAgIH1cblxuICAgIC8vIGZpbHRlciB1bmRlZmluZWQgdmFsdWVzXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHByb3BzKVxuICAgIHNldHVwPy4od2lkZ2V0KVxuICAgIHJldHVybiB3aWRnZXRcbn1cblxuZnVuY3Rpb24gaXNBcnJvd0Z1bmN0aW9uKGZ1bmM6IGFueSk6IGZ1bmMgaXMgKGFyZ3M6IGFueSkgPT4gYW55IHtcbiAgICByZXR1cm4gIU9iamVjdC5oYXNPd24oZnVuYywgXCJwcm90b3R5cGVcIilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yczogUmVjb3JkPHN0cmluZywgeyBuZXcocHJvcHM6IGFueSk6IGFueSB9IHwgKChwcm9wczogYW55KSA9PiBhbnkpPixcbiAgICBjdG9yOiBzdHJpbmcgfCAoKHByb3BzOiBhbnkpID0+IGFueSkgfCB7IG5ldyhwcm9wczogYW55KTogYW55IH0sXG4gICAgeyBjaGlsZHJlbiwgLi4ucHJvcHMgfTogYW55LFxuKSB7XG4gICAgY2hpbGRyZW4gPz89IFtdXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKVxuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cblxuICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmlsdGVyKEJvb2xlYW4pXG5cbiAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID09PSAxKVxuICAgICAgICBwcm9wcy5jaGlsZCA9IGNoaWxkcmVuWzBdXG4gICAgZWxzZSBpZiAoY2hpbGRyZW4ubGVuZ3RoID4gMSlcbiAgICAgICAgcHJvcHMuY2hpbGRyZW4gPSBjaGlsZHJlblxuXG4gICAgaWYgKHR5cGVvZiBjdG9yID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChpc0Fycm93RnVuY3Rpb24oY3RvcnNbY3Rvcl0pKVxuICAgICAgICAgICAgcmV0dXJuIGN0b3JzW2N0b3JdKHByb3BzKVxuXG4gICAgICAgIHJldHVybiBuZXcgY3RvcnNbY3Rvcl0ocHJvcHMpXG4gICAgfVxuXG4gICAgaWYgKGlzQXJyb3dGdW5jdGlvbihjdG9yKSlcbiAgICAgICAgcmV0dXJuIGN0b3IocHJvcHMpXG5cbiAgICByZXR1cm4gbmV3IGN0b3IocHJvcHMpXG59XG4iLCAiaW1wb3J0IHsgbm9JbXBsaWNpdERlc3Ryb3ksIHNldENoaWxkcmVuLCB0eXBlIEJpbmRhYmxlUHJvcHMsIGNvbnN0cnVjdCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEJpbmRpbmcgZnJvbSBcIi4uL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgY29uc3QgdHlwZSA9IFN5bWJvbChcImNoaWxkIHR5cGVcIilcbmNvbnN0IGR1bW15QnVsZGVyID0gbmV3IEd0ay5CdWlsZGVyXG5cbmZ1bmN0aW9uIF9nZXRDaGlsZHJlbih3aWRnZXQ6IEd0ay5XaWRnZXQpOiBBcnJheTxHdGsuV2lkZ2V0PiB7XG4gICAgaWYgKFwiZ2V0X2NoaWxkXCIgaW4gd2lkZ2V0ICYmIHR5cGVvZiB3aWRnZXQuZ2V0X2NoaWxkID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gd2lkZ2V0LmdldF9jaGlsZCgpID8gW3dpZGdldC5nZXRfY2hpbGQoKV0gOiBbXVxuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkcmVuOiBBcnJheTxHdGsuV2lkZ2V0PiA9IFtdXG4gICAgbGV0IGNoID0gd2lkZ2V0LmdldF9maXJzdF9jaGlsZCgpXG4gICAgd2hpbGUgKGNoICE9PSBudWxsKSB7XG4gICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgIGNoID0gY2guZ2V0X25leHRfc2libGluZygpXG4gICAgfVxuICAgIHJldHVybiBjaGlsZHJlblxufVxuXG5mdW5jdGlvbiBfc2V0Q2hpbGRyZW4od2lkZ2V0OiBHdGsuV2lkZ2V0LCBjaGlsZHJlbjogYW55W10pIHtcbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xuICAgICAgICB3aWRnZXQudmZ1bmNfYWRkX2NoaWxkKFxuICAgICAgICAgICAgZHVtbXlCdWxkZXIsXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIHR5cGUgaW4gY2hpbGQgPyBjaGlsZFt0eXBlXSA6IG51bGwsXG4gICAgICAgIClcbiAgICB9XG59XG5cbnR5cGUgQ29uZmlnPFQgZXh0ZW5kcyBHdGsuV2lkZ2V0PiA9IHtcbiAgICBzZXRDaGlsZHJlbih3aWRnZXQ6IFQsIGNoaWxkcmVuOiBhbnlbXSk6IHZvaWRcbiAgICBnZXRDaGlsZHJlbih3aWRnZXQ6IFQpOiBBcnJheTxHdGsuV2lkZ2V0PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhc3RhbGlmeTxcbiAgICBXaWRnZXQgZXh0ZW5kcyBHdGsuV2lkZ2V0LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzID0gR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4oY2xzOiB7IG5ldyguLi5hcmdzOiBhbnlbXSk6IFdpZGdldCB9LCBjb25maWc6IFBhcnRpYWw8Q29uZmlnPFdpZGdldD4+ID0ge30pIHtcbiAgICBPYmplY3QuYXNzaWduKGNscy5wcm90b3R5cGUsIHtcbiAgICAgICAgW3NldENoaWxkcmVuXShjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIGNvbnN0IHcgPSB0aGlzIGFzIHVua25vd24gYXMgV2lkZ2V0XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIChjb25maWcuZ2V0Q2hpbGRyZW4/Lih3KSB8fCBfZ2V0Q2hpbGRyZW4odykpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgR3RrLldpZGdldCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZC51bnBhcmVudCgpXG4gICAgICAgICAgICAgICAgICAgIGlmICghY2hpbGRyZW4uaW5jbHVkZXMoY2hpbGQpICYmIG5vSW1wbGljaXREZXN0cm95IGluIHRoaXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZC5ydW5fZGlzcG9zZSgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY29uZmlnLnNldENoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnNldENoaWxkcmVuKHcsIGNoaWxkcmVuKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBfc2V0Q2hpbGRyZW4odywgY2hpbGRyZW4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICAgIFtjbHMubmFtZV06IChcbiAgICAgICAgICAgIHByb3BzOiBDb25zdHJ1Y3RQcm9wczxXaWRnZXQsIFByb3BzLCBTaWduYWxzPiA9IHt9LFxuICAgICAgICAgICAgLi4uY2hpbGRyZW46IGFueVtdXG4gICAgICAgICk6IFdpZGdldCA9PiB7XG4gICAgICAgICAgICBjb25zdCB3aWRnZXQgPSBuZXcgY2xzKFwiY3NzTmFtZVwiIGluIHByb3BzID8geyBjc3NOYW1lOiBwcm9wcy5jc3NOYW1lIH0gOiB7fSlcblxuICAgICAgICAgICAgaWYgKFwiY3NzTmFtZVwiIGluIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLmNzc05hbWVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHByb3BzLm5vSW1wbGljaXREZXN0cm95KSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHsgW25vSW1wbGljaXREZXN0cm95XTogdHJ1ZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5ub0ltcGxpY2l0RGVzdHJveVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocHJvcHMudHlwZSkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCB7IFt0eXBlXTogcHJvcHMudHlwZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy50eXBlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihwcm9wcywgeyBjaGlsZHJlbiB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gY29uc3RydWN0KHdpZGdldCBhcyBhbnksIHNldHVwQ29udHJvbGxlcnMod2lkZ2V0LCBwcm9wcyBhcyBhbnkpKVxuICAgICAgICB9LFxuICAgIH1bY2xzLm5hbWVdXG59XG5cbnR5cGUgU2lnSGFuZGxlcjxcbiAgICBXIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBBcmdzIGV4dGVuZHMgQXJyYXk8dW5rbm93bj4sXG4+ID0gKChzZWxmOiBXLCAuLi5hcmdzOiBBcmdzKSA9PiB1bmtub3duKSB8IHN0cmluZyB8IHN0cmluZ1tdXG5cbmV4cG9ydCB7IEJpbmRhYmxlUHJvcHMgfVxuZXhwb3J0IHR5cGUgQmluZGFibGVDaGlsZCA9IEd0ay5XaWRnZXQgfCBCaW5kaW5nPEd0ay5XaWRnZXQ+XG5cbmV4cG9ydCB0eXBlIENvbnN0cnVjdFByb3BzPFxuICAgIFNlbGYgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4gPSBQYXJ0aWFsPHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNhbid0IGFzc2lnbiB0byB1bmtub3duLCBidXQgaXQgd29ya3MgYXMgZXhwZWN0ZWQgdGhvdWdoXG4gICAgW1MgaW4ga2V5b2YgU2lnbmFsc106IFNpZ0hhbmRsZXI8U2VsZiwgU2lnbmFsc1tTXT5cbn0+ICYgUGFydGlhbDx7XG4gICAgW0tleSBpbiBgb24ke3N0cmluZ31gXTogU2lnSGFuZGxlcjxTZWxmLCBhbnlbXT5cbn0+ICYgUGFydGlhbDxCaW5kYWJsZVByb3BzPE9taXQ8UHJvcHMsIFwiY3NzTmFtZVwiIHwgXCJjc3NfbmFtZVwiPj4+ICYge1xuICAgIG5vSW1wbGljaXREZXN0cm95PzogdHJ1ZVxuICAgIHR5cGU/OiBzdHJpbmdcbiAgICBjc3NOYW1lPzogc3RyaW5nXG59ICYgRXZlbnRDb250cm9sbGVyPFNlbGY+ICYge1xuICAgIG9uRGVzdHJveT86IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgc2V0dXA/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxufVxuXG50eXBlIEV2ZW50Q29udHJvbGxlcjxTZWxmIGV4dGVuZHMgR3RrLldpZGdldD4gPSB7XG4gICAgb25Gb2N1c0VudGVyPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbkZvY3VzTGVhdmU/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuXG4gICAgb25LZXlQcmVzc2VkPzogKHNlbGY6IFNlbGYsIGtleXZhbDogbnVtYmVyLCBrZXljb2RlOiBudW1iZXIsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG4gICAgb25LZXlSZWxlYXNlZD86IChzZWxmOiBTZWxmLCBrZXl2YWw6IG51bWJlciwga2V5Y29kZTogbnVtYmVyLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuICAgIG9uS2V5TW9kaWZpZXI/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcblxuICAgIG9uTGVnYWN5PzogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHZvaWRcbiAgICBvbkJ1dHRvblByZXNzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuICAgIG9uQnV0dG9uUmVsZWFzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuXG4gICAgb25Ib3ZlckVudGVyPzogKHNlbGY6IFNlbGYsIHg6IG51bWJlciwgeTogbnVtYmVyKSA9PiB2b2lkXG4gICAgb25Ib3ZlckxlYXZlPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbk1vdGlvbj86IChzZWxmOiBTZWxmLCB4OiBudW1iZXIsIHk6IG51bWJlcikgPT4gdm9pZFxuXG4gICAgb25TY3JvbGw/OiAoc2VsZjogU2VsZiwgZHg6IG51bWJlciwgZHk6IG51bWJlcikgPT4gdm9pZFxuICAgIG9uU2Nyb2xsRGVjZWxlcmF0ZT86IChzZWxmOiBTZWxmLCB2ZWxfeDogbnVtYmVyLCB2ZWxfeTogbnVtYmVyKSA9PiB2b2lkXG59XG5cbmZ1bmN0aW9uIHNldHVwQ29udHJvbGxlcnM8VD4od2lkZ2V0OiBHdGsuV2lkZ2V0LCB7XG4gICAgb25Gb2N1c0VudGVyLFxuICAgIG9uRm9jdXNMZWF2ZSxcbiAgICBvbktleVByZXNzZWQsXG4gICAgb25LZXlSZWxlYXNlZCxcbiAgICBvbktleU1vZGlmaWVyLFxuICAgIG9uTGVnYWN5LFxuICAgIG9uQnV0dG9uUHJlc3NlZCxcbiAgICBvbkJ1dHRvblJlbGVhc2VkLFxuICAgIG9uSG92ZXJFbnRlcixcbiAgICBvbkhvdmVyTGVhdmUsXG4gICAgb25Nb3Rpb24sXG4gICAgb25TY3JvbGwsXG4gICAgb25TY3JvbGxEZWNlbGVyYXRlLFxuICAgIC4uLnByb3BzXG59OiBFdmVudENvbnRyb2xsZXI8R3RrLldpZGdldD4gJiBUKSB7XG4gICAgaWYgKG9uRm9jdXNFbnRlciB8fCBvbkZvY3VzTGVhdmUpIHtcbiAgICAgICAgY29uc3QgZm9jdXMgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckZvY3VzXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihmb2N1cylcblxuICAgICAgICBpZiAob25Gb2N1c0VudGVyKVxuICAgICAgICAgICAgZm9jdXMuY29ubmVjdChcImVudGVyXCIsICgpID0+IG9uRm9jdXNFbnRlcih3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbkZvY3VzTGVhdmUpXG4gICAgICAgICAgICBmb2N1cy5jb25uZWN0KFwibGVhdmVcIiwgKCkgPT4gb25Gb2N1c0xlYXZlKHdpZGdldCkpXG4gICAgfVxuXG4gICAgaWYgKG9uS2V5UHJlc3NlZCB8fCBvbktleVJlbGVhc2VkIHx8IG9uS2V5TW9kaWZpZXIpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJLZXlcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGtleSlcblxuICAgICAgICBpZiAob25LZXlQcmVzc2VkKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJrZXktcHJlc3NlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlQcmVzc2VkKHdpZGdldCwgdmFsLCBjb2RlLCBzdGF0ZSkpXG5cbiAgICAgICAgaWYgKG9uS2V5UmVsZWFzZWQpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcImtleS1yZWxlYXNlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlSZWxlYXNlZCh3aWRnZXQsIHZhbCwgY29kZSwgc3RhdGUpKVxuXG4gICAgICAgIGlmIChvbktleU1vZGlmaWVyKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJtb2RpZmllcnNcIiwgKF8sIHN0YXRlKSA9PiBvbktleU1vZGlmaWVyKHdpZGdldCwgc3RhdGUpKVxuICAgIH1cblxuICAgIGlmIChvbkxlZ2FjeSB8fCBvbkJ1dHRvblByZXNzZWQgfHwgb25CdXR0b25SZWxlYXNlZCkge1xuICAgICAgICBjb25zdCBsZWdhY3kgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckxlZ2FjeVxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIobGVnYWN5KVxuXG4gICAgICAgIGxlZ2FjeS5jb25uZWN0KFwiZXZlbnRcIiwgKF8sIGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuZ2V0X2V2ZW50X3R5cGUoKSA9PT0gR2RrLkV2ZW50VHlwZS5CVVRUT05fUFJFU1MpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblByZXNzZWQ/Lih3aWRnZXQsIGV2ZW50IGFzIEdkay5CdXR0b25FdmVudClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGV2ZW50LmdldF9ldmVudF90eXBlKCkgPT09IEdkay5FdmVudFR5cGUuQlVUVE9OX1JFTEVBU0UpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblJlbGVhc2VkPy4od2lkZ2V0LCBldmVudCBhcyBHZGsuQnV0dG9uRXZlbnQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9uTGVnYWN5Py4od2lkZ2V0LCBldmVudClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob25Nb3Rpb24gfHwgb25Ib3ZlckVudGVyIHx8IG9uSG92ZXJMZWF2ZSkge1xuICAgICAgICBjb25zdCBob3ZlciA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyTW90aW9uXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihob3ZlcilcblxuICAgICAgICBpZiAob25Ib3ZlckVudGVyKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImVudGVyXCIsIChfLCB4LCB5KSA9PiBvbkhvdmVyRW50ZXIod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25Ib3ZlckxlYXZlKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImxlYXZlXCIsICgpID0+IG9uSG92ZXJMZWF2ZSh3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbk1vdGlvbilcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJtb3Rpb25cIiwgKF8sIHgsIHkpID0+IG9uTW90aW9uKHdpZGdldCwgeCwgeSkpXG4gICAgfVxuXG4gICAgaWYgKG9uU2Nyb2xsIHx8IG9uU2Nyb2xsRGVjZWxlcmF0ZSkge1xuICAgICAgICBjb25zdCBzY3JvbGwgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbFxuICAgICAgICBzY3JvbGwuZmxhZ3MgPSBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsRmxhZ3MuQk9USF9BWEVTIHwgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbEZsYWdzLktJTkVUSUNcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKHNjcm9sbClcblxuICAgICAgICBpZiAob25TY3JvbGwpXG4gICAgICAgICAgICBzY3JvbGwuY29ubmVjdChcInNjcm9sbFwiLCAoXywgeCwgeSkgPT4gb25TY3JvbGwod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25TY3JvbGxEZWNlbGVyYXRlKVxuICAgICAgICAgICAgc2Nyb2xsLmNvbm5lY3QoXCJkZWNlbGVyYXRlXCIsIChfLCB4LCB5KSA9PiBvblNjcm9sbERlY2VsZXJhdGUod2lkZ2V0LCB4LCB5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvcHNcbn1cbiIsICJpbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgeyBta0FwcCB9IGZyb20gXCIuLi9fYXBwXCJcblxuR3RrLmluaXQoKVxuXG4vLyBzdG9wIHRoaXMgZnJvbSBsZWFraW5nIGludG8gc3VicHJvY2Vzc2VzXG4vLyBhbmQgZ2lvIGxhdW5jaCBpbnZvY2F0aW9uc1xuR0xpYi51bnNldGVudihcIkxEX1BSRUxPQURcIilcblxuLy8gdXNlcnMgbWlnaHQgd2FudCB0byB1c2UgQWR3YWl0YSBpbiB3aGljaCBjYXNlIGl0IGhhcyB0byBiZSBpbml0aWFsaXplZFxuLy8gaXQgbWlnaHQgYmUgY29tbW9uIHBpdGZhbGwgdG8gZm9yZ2V0IGl0IGJlY2F1c2UgYEFwcGAgaXMgbm90IGBBZHcuQXBwbGljYXRpb25gXG5hd2FpdCBpbXBvcnQoXCJnaTovL0Fkdz92ZXJzaW9uPTFcIilcbiAgICAudGhlbigoeyBkZWZhdWx0OiBBZHcgfSkgPT4gQWR3LmluaXQoKSlcbiAgICAuY2F0Y2goKCkgPT4gdm9pZCAwKVxuXG5leHBvcnQgZGVmYXVsdCBta0FwcChBc3RhbC5BcHBsaWNhdGlvbilcbiIsICIvKipcbiAqIFdvcmthcm91bmQgZm9yIFwiQ2FuJ3QgY29udmVydCBub24tbnVsbCBwb2ludGVyIHRvIEpTIHZhbHVlIFwiXG4gKi9cblxuZXhwb3J0IHsgfVxuXG5jb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuYXN5bmMgZnVuY3Rpb24gc3VwcHJlc3M8VD4obW9kOiBQcm9taXNlPHsgZGVmYXVsdDogVCB9PiwgcGF0Y2g6IChtOiBUKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIG1vZC50aGVuKG0gPT4gcGF0Y2gobS5kZWZhdWx0KSkuY2F0Y2goKCkgPT4gdm9pZCAwKVxufVxuXG5mdW5jdGlvbiBwYXRjaDxQIGV4dGVuZHMgb2JqZWN0Pihwcm90bzogUCwgcHJvcDogRXh0cmFjdDxrZXlvZiBQLCBzdHJpbmc+KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCBwcm9wLCB7XG4gICAgICAgIGdldCgpIHsgcmV0dXJuIHRoaXNbYGdldF8ke3NuYWtlaWZ5KHByb3ApfWBdKCkgfSxcbiAgICB9KVxufVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQXBwc1wiKSwgKHsgQXBwcywgQXBwbGljYXRpb24gfSkgPT4ge1xuICAgIHBhdGNoKEFwcHMucHJvdG90eXBlLCBcImxpc3RcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwia2V5d29yZHNcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwiY2F0ZWdvcmllc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIiksICh7IFVQb3dlciB9KSA9PiB7XG4gICAgcGF0Y2goVVBvd2VyLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQmx1ZXRvb3RoXCIpLCAoeyBBZGFwdGVyLCBCbHVldG9vdGgsIERldmljZSB9KSA9PiB7XG4gICAgcGF0Y2goQWRhcHRlci5wcm90b3R5cGUsIFwidXVpZHNcIilcbiAgICBwYXRjaChCbHVldG9vdGgucHJvdG90eXBlLCBcImFkYXB0ZXJzXCIpXG4gICAgcGF0Y2goQmx1ZXRvb3RoLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goRGV2aWNlLnByb3RvdHlwZSwgXCJ1dWlkc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEh5cHJsYW5kXCIpLCAoeyBIeXBybGFuZCwgTW9uaXRvciwgV29ya3NwYWNlIH0pID0+IHtcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwiYmluZHNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwibW9uaXRvcnNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwid29ya3NwYWNlc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJjbGllbnRzXCIpXG4gICAgcGF0Y2goTW9uaXRvci5wcm90b3R5cGUsIFwiYXZhaWxhYmxlTW9kZXNcIilcbiAgICBwYXRjaChNb25pdG9yLnByb3RvdHlwZSwgXCJhdmFpbGFibGVfbW9kZXNcIilcbiAgICBwYXRjaChXb3Jrc3BhY2UucHJvdG90eXBlLCBcImNsaWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxNcHJpc1wiKSwgKHsgTXByaXMsIFBsYXllciB9KSA9PiB7XG4gICAgcGF0Y2goTXByaXMucHJvdG90eXBlLCBcInBsYXllcnNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZF91cmlfc2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkVXJpU2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkX21pbWVfdHlwZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZE1pbWVUeXBlc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwiY29tbWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxOZXR3b3JrXCIpLCAoeyBXaWZpIH0pID0+IHtcbiAgICBwYXRjaChXaWZpLnByb3RvdHlwZSwgXCJhY2Nlc3NfcG9pbnRzXCIpXG4gICAgcGF0Y2goV2lmaS5wcm90b3R5cGUsIFwiYWNjZXNzUG9pbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTm90aWZkXCIpLCAoeyBOb3RpZmQsIE5vdGlmaWNhdGlvbiB9KSA9PiB7XG4gICAgcGF0Y2goTm90aWZkLnByb3RvdHlwZSwgXCJub3RpZmljYXRpb25zXCIpXG4gICAgcGF0Y2goTm90aWZpY2F0aW9uLnByb3RvdHlwZSwgXCJhY3Rpb25zXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsUG93ZXJQcm9maWxlc1wiKSwgKHsgUG93ZXJQcm9maWxlcyB9KSA9PiB7XG4gICAgcGF0Y2goUG93ZXJQcm9maWxlcy5wcm90b3R5cGUsIFwiYWN0aW9uc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbFdwXCIpLCAoeyBXcCwgQXVkaW8sIFZpZGVvIH0pID0+IHtcbiAgICBwYXRjaChXcC5wcm90b3R5cGUsIFwiZW5kcG9pbnRzXCIpXG4gICAgcGF0Y2goV3AucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3RyZWFtc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJyZWNvcmRlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwibWljcm9waG9uZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3BlYWtlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzdHJlYW1zXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInJlY29yZGVyc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzaW5rc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzb3VyY2VzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcImRldmljZXNcIilcbn0pXG4iLCAiaW1wb3J0IFwiLi9vdmVycmlkZXMuanNcIlxuaW1wb3J0IHsgc2V0Q29uc29sZUxvZ0RvbWFpbiB9IGZyb20gXCJjb25zb2xlXCJcbmltcG9ydCB7IGV4aXQsIHByb2dyYW1BcmdzIH0gZnJvbSBcInN5c3RlbVwiXG5pbXBvcnQgSU8gZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcbmltcG9ydCB0eXBlIEFzdGFsMyBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgdHlwZSBBc3RhbDQgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuXG50eXBlIENvbmZpZyA9IFBhcnRpYWw8e1xuICAgIGluc3RhbmNlTmFtZTogc3RyaW5nXG4gICAgY3NzOiBzdHJpbmdcbiAgICBpY29uczogc3RyaW5nXG4gICAgZ3RrVGhlbWU6IHN0cmluZ1xuICAgIGljb25UaGVtZTogc3RyaW5nXG4gICAgY3Vyc29yVGhlbWU6IHN0cmluZ1xuICAgIGhvbGQ6IGJvb2xlYW5cbiAgICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0OiBzdHJpbmcsIHJlczogKHJlc3BvbnNlOiBhbnkpID0+IHZvaWQpOiB2b2lkXG4gICAgbWFpbiguLi5hcmdzOiBzdHJpbmdbXSk6IHZvaWRcbiAgICBjbGllbnQobWVzc2FnZTogKG1zZzogc3RyaW5nKSA9PiBzdHJpbmcsIC4uLmFyZ3M6IHN0cmluZ1tdKTogdm9pZFxufT5cblxuaW50ZXJmYWNlIEFzdGFsM0pTIGV4dGVuZHMgQXN0YWwzLkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyOiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldD86IGJvb2xlYW4pOiB2b2lkXG4gICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZFxuICAgIHN0YXJ0KGNvbmZpZz86IENvbmZpZyk6IHZvaWRcbn1cblxuaW50ZXJmYWNlIEFzdGFsNEpTIGV4dGVuZHMgQXN0YWw0LkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyPzogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cbiAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQ/OiBib29sZWFuKTogdm9pZFxuICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWRcbiAgICBzdGFydChjb25maWc/OiBDb25maWcpOiB2b2lkXG59XG5cbnR5cGUgQXBwMyA9IHR5cGVvZiBBc3RhbDMuQXBwbGljYXRpb25cbnR5cGUgQXBwNCA9IHR5cGVvZiBBc3RhbDQuQXBwbGljYXRpb25cblxuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwPEFwcCBleHRlbmRzIEFwcDM+KEFwcDogQXBwKTogQXN0YWwzSlNcbmV4cG9ydCBmdW5jdGlvbiBta0FwcDxBcHAgZXh0ZW5kcyBBcHA0PihBcHA6IEFwcCk6IEFzdGFsNEpTXG5cbmV4cG9ydCBmdW5jdGlvbiBta0FwcChBcHA6IEFwcDMgfCBBcHA0KSB7XG4gICAgcmV0dXJuIG5ldyAoY2xhc3MgQXN0YWxKUyBleHRlbmRzIEFwcCB7XG4gICAgICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJBc3RhbEpTXCIgfSwgdGhpcyBhcyBhbnkpIH1cblxuICAgICAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm4gPSBGdW5jdGlvbihgcmV0dXJuIChhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICR7Ym9keS5pbmNsdWRlcyhcIjtcIikgPyBib2R5IDogYHJldHVybiAke2JvZHl9O2B9XG4gICAgICAgICAgICAgICAgICAgIH0pYClcbiAgICAgICAgICAgICAgICAgICAgZm4oKSgpLnRoZW4ocmVzKS5jYXRjaChyZWopXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqKGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXF1ZXN0SGFuZGxlcj86IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG5cbiAgICAgICAgdmZ1bmNfcmVxdWVzdChtc2c6IHN0cmluZywgY29ubjogR2lvLlNvY2tldENvbm5lY3Rpb24pOiB2b2lkIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5yZXF1ZXN0SGFuZGxlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXF1ZXN0SGFuZGxlcihtc2csIChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrKGNvbm4sIFN0cmluZyhyZXNwb25zZSksIChfLCByZXMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrX2ZpbmlzaChyZXMpLFxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3VwZXIudmZ1bmNfcmVxdWVzdChtc2csIGNvbm4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQgPSBmYWxzZSkge1xuICAgICAgICAgICAgc3VwZXIuYXBwbHlfY3NzKHN0eWxlLCByZXNldClcbiAgICAgICAgfVxuXG4gICAgICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWQge1xuICAgICAgICAgICAgc3VwZXIucXVpdCgpXG4gICAgICAgICAgICBleGl0KGNvZGUgPz8gMClcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXJ0KHsgcmVxdWVzdEhhbmRsZXIsIGNzcywgaG9sZCwgbWFpbiwgY2xpZW50LCBpY29ucywgLi4uY2ZnIH06IENvbmZpZyA9IHt9KSB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSB0aGlzIGFzIHVua25vd24gYXMgSW5zdGFuY2VUeXBlPEFwcDMgfCBBcHA0PlxuXG4gICAgICAgICAgICBjbGllbnQgPz89ICgpID0+IHtcbiAgICAgICAgICAgICAgICBwcmludChgQXN0YWwgaW5zdGFuY2UgXCIke2FwcC5pbnN0YW5jZU5hbWV9XCIgYWxyZWFkeSBydW5uaW5nYClcbiAgICAgICAgICAgICAgICBleGl0KDEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgY2ZnKVxuICAgICAgICAgICAgc2V0Q29uc29sZUxvZ0RvbWFpbihhcHAuaW5zdGFuY2VOYW1lKVxuXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RIYW5kbGVyID0gcmVxdWVzdEhhbmRsZXJcbiAgICAgICAgICAgIGFwcC5jb25uZWN0KFwiYWN0aXZhdGVcIiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIG1haW4/LiguLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXBwLmFjcXVpcmVfc29ja2V0KClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudChtc2cgPT4gSU8uc2VuZF9yZXF1ZXN0KGFwcC5pbnN0YW5jZU5hbWUsIG1zZykhLCAuLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGx5X2Nzcyhjc3MsIGZhbHNlKVxuXG4gICAgICAgICAgICBpZiAoaWNvbnMpXG4gICAgICAgICAgICAgICAgYXBwLmFkZF9pY29ucyhpY29ucylcblxuICAgICAgICAgICAgaG9sZCA/Pz0gdHJ1ZVxuICAgICAgICAgICAgaWYgKGhvbGQpXG4gICAgICAgICAgICAgICAgYXBwLmhvbGQoKVxuXG4gICAgICAgICAgICBhcHAucnVuQXN5bmMoW10pXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSwgdHlwZSBDb25zdHJ1Y3RQcm9wcyB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZnVuY3Rpb24gZmlsdGVyKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIHJldHVybiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG59XG5cbi8vIEJveFxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLkJveC5wcm90b3R5cGUsIFwiY2hpbGRyZW5cIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9jaGlsZHJlbih2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5Cb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IEJveCA9IGFzdGFsaWZ5PEFzdGFsLkJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLkJveCwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIHNlbGYuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikgeyByZXR1cm4gc2VsZi5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfSxcbn0pXG5cbi8vIEJ1dHRvblxudHlwZSBCdXR0b25TaWduYWxzID0ge1xuICAgIG9uQ2xpY2tlZDogW11cbn1cblxuZXhwb3J0IHR5cGUgQnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuQnV0dG9uLCBHdGsuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIEJ1dHRvblNpZ25hbHM+XG5leHBvcnQgY29uc3QgQnV0dG9uID0gYXN0YWxpZnk8R3RrLkJ1dHRvbiwgR3RrLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCBCdXR0b25TaWduYWxzPihHdGsuQnV0dG9uKVxuXG4vLyBDZW50ZXJCb3hcbmV4cG9ydCB0eXBlIENlbnRlckJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkNlbnRlckJveCwgR3RrLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IENlbnRlckJveCA9IGFzdGFsaWZ5PEd0ay5DZW50ZXJCb3gsIEd0ay5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz4oR3RrLkNlbnRlckJveCwge1xuICAgIGdldENoaWxkcmVuKGJveCkge1xuICAgICAgICByZXR1cm4gW2JveC5zdGFydFdpZGdldCwgYm94LmNlbnRlcldpZGdldCwgYm94LmVuZFdpZGdldF1cbiAgICB9LFxuICAgIHNldENoaWxkcmVuKGJveCwgY2hpbGRyZW4pIHtcbiAgICAgICAgY29uc3QgY2ggPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIGJveC5zdGFydFdpZGdldCA9IGNoWzBdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIGJveC5jZW50ZXJXaWRnZXQgPSBjaFsxXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICBib3guZW5kV2lkZ2V0ID0gY2hbMl0gfHwgbmV3IEd0ay5Cb3hcbiAgICB9LFxufSlcblxuLy8gVE9ETzogQ2lyY3VsYXJQcm9ncmVzc1xuLy8gVE9ETzogRHJhd2luZ0FyZWFcblxuLy8gRW50cnlcbnR5cGUgRW50cnlTaWduYWxzID0ge1xuICAgIG9uQWN0aXZhdGU6IFtdXG4gICAgb25Ob3RpZnlUZXh0OiBbXVxufVxuXG5leHBvcnQgdHlwZSBFbnRyeVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPlxuZXhwb3J0IGNvbnN0IEVudHJ5ID0gYXN0YWxpZnk8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPihHdGsuRW50cnksIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBJbWFnZVxuZXhwb3J0IHR5cGUgSW1hZ2VQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5JbWFnZSwgR3RrLkltYWdlLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgSW1hZ2UgPSBhc3RhbGlmeTxHdGsuSW1hZ2UsIEd0ay5JbWFnZS5Db25zdHJ1Y3RvclByb3BzPihHdGsuSW1hZ2UsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBMYWJlbFxuZXhwb3J0IHR5cGUgTGFiZWxQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5MYWJlbCwgR3RrLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTGFiZWwgPSBhc3RhbGlmeTxHdGsuTGFiZWwsIEd0ay5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPihHdGsuTGFiZWwsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHsgc2VsZi5sYWJlbCA9IFN0cmluZyhjaGlsZHJlbikgfSxcbn0pXG5cbi8vIExldmVsQmFyXG5leHBvcnQgdHlwZSBMZXZlbEJhclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkxldmVsQmFyLCBHdGsuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBMZXZlbEJhciA9IGFzdGFsaWZ5PEd0ay5MZXZlbEJhciwgR3RrLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5MZXZlbEJhciwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFRPRE86IExpc3RCb3hcblxuLy8gT3ZlcmxheVxuZXhwb3J0IHR5cGUgT3ZlcmxheVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk92ZXJsYXksIEd0ay5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgT3ZlcmxheSA9IGFzdGFsaWZ5PEd0ay5PdmVybGF5LCBHdGsuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPihHdGsuT3ZlcmxheSwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHtcbiAgICAgICAgY29uc3QgY2hpbGRyZW46IEFycmF5PEd0ay5XaWRnZXQ+ID0gW11cbiAgICAgICAgbGV0IGNoID0gc2VsZi5nZXRfZmlyc3RfY2hpbGQoKVxuICAgICAgICB3aGlsZSAoY2ggIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgICAgICBjaCA9IGNoLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNoaWxkcmVuLmZpbHRlcihjaCA9PiBjaCAhPT0gc2VsZi5jaGlsZClcbiAgICB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgY29uc3QgdHlwZXMgPSB0eXBlIGluIGNoaWxkXG4gICAgICAgICAgICAgICAgPyAoY2hpbGRbdHlwZV0gYXMgc3RyaW5nKS5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgICAgICAgOiBbXVxuXG4gICAgICAgICAgICBpZiAodHlwZXMuaW5jbHVkZXMoXCJvdmVybGF5XCIpKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfb3ZlcmxheShjaGlsZClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNlbGYuc2V0X21lYXN1cmVfb3ZlcmxheShjaGlsZCwgdHlwZXMuaW5jbHVkZXMoXCJtZWFzdXJlXCIpKVxuICAgICAgICAgICAgc2VsZi5zZXRfY2xpcF9vdmVybGF5KGNoaWxkLCB0eXBlcy5pbmNsdWRlcyhcImNsaXBcIikpXG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gUmV2ZWFsZXJcbmV4cG9ydCB0eXBlIFJldmVhbGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuUmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFJldmVhbGVyID0gYXN0YWxpZnk8R3RrLlJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlJldmVhbGVyKVxuXG4vLyBTbGlkZXJcbnR5cGUgU2xpZGVyU2lnbmFscyA9IHtcbiAgICBvbkNoYW5nZVZhbHVlOiBbXVxufVxuXG5leHBvcnQgdHlwZSBTbGlkZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLlNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIFNsaWRlclNpZ25hbHM+XG5leHBvcnQgY29uc3QgU2xpZGVyID0gYXN0YWxpZnk8QXN0YWwuU2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywgU2xpZGVyU2lnbmFscz4oQXN0YWwuU2xpZGVyLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gU3RhY2tcbmV4cG9ydCB0eXBlIFN0YWNrUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuU3RhY2ssIEd0ay5TdGFjay5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN0YWNrID0gYXN0YWxpZnk8R3RrLlN0YWNrLCBHdGsuU3RhY2suQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN0YWNrLCB7XG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQubmFtZSAhPSBcIlwiICYmIGNoaWxkLm5hbWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX25hbWVkKGNoaWxkLCBjaGlsZC5uYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBTd2l0Y2hcbmV4cG9ydCB0eXBlIFN3aXRjaFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN3aXRjaCA9IGFzdGFsaWZ5PEd0ay5Td2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN3aXRjaCwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFdpbmRvd1xuZXhwb3J0IHR5cGUgV2luZG93UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5XaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFdpbmRvdyA9IGFzdGFsaWZ5PEFzdGFsLldpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLldpbmRvdylcblxuLy8gTWVudUJ1dHRvblxuZXhwb3J0IHR5cGUgTWVudUJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTWVudUJ1dHRvbiA9IGFzdGFsaWZ5PEd0ay5NZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPihHdGsuTWVudUJ1dHRvbiwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIFtzZWxmLnBvcG92ZXIsIHNlbGYuY2hpbGRdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBHdGsuUG9wb3Zlcikge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X3BvcG92ZXIoY2hpbGQpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFBvcG9wZXJcbmV4cG9ydCB0eXBlIFBvcG92ZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5Qb3BvdmVyLCBHdGsuUG9wb3Zlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFBvcG92ZXIgPSBhc3RhbGlmeTxHdGsuUG9wb3ZlciwgR3RrLlBvcG92ZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlBvcG92ZXIpXG4iLCAiLy8ga29iZWwtc2hlbGwgZW50cnkgXHUyMDE0IEFHUyB2MiAvIGFzdGFsNFxuaW1wb3J0IHsgQXBwIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuLy8gYXN0YWwgYGNvbnN0cnVjdGAgc2V0cyBzdGF0aWMgcHJvcHMgdmlhIE9iamVjdC5hc3NpZ24od2lkZ2V0LCBwcm9wcykgYW5kIGJpbmRpbmdzIHZpYVxuLy8gc2V0UHJvcCBcdTIxOTIgc2V0X2NsYXNzLiBHdGtXaWRnZXQgaGFzIG5laXRoZXIgYSBgY2xhc3NgIEdPYmplY3QgcHJvcCBub3Igc2V0X2NsYXNzLCBzb1xuLy8gYGNsYXNzPVwiLi4uXCJgIHNpbGVudGx5IG5vLW9wcyAodGhlIHJlYWwgcHJvcCBpcyBgY3NzLWNsYXNzZXNgLCBhbiBhcnJheSkuIERlZmluZSBhXG4vLyBgY2xhc3NgIGFjY2Vzc29yIHJvdXRpbmcgQk9USCBwYXRocyB0byBzZXRfY3NzX2NsYXNzZXMsIHNvIGBjbGFzcz1cImEgYlwiYCB3b3Jrcy5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0eSgoR3RrLldpZGdldCBhcyBhbnkpLnByb3RvdHlwZSwgXCJjbGFzc1wiLCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIHNldCh2OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKVxuICAgIH0sXG4gICAgZ2V0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRfY3NzX2NsYXNzZXMoKS5qb2luKFwiIFwiKVxuICAgIH0sXG59KVxuOyhHdGsuV2lkZ2V0LnByb3RvdHlwZSBhcyBhbnkpLnNldF9jbGFzcyA9IGZ1bmN0aW9uICh2OiBzdHJpbmcpIHtcbiAgICB0aGlzLnNldF9jc3NfY2xhc3NlcyhTdHJpbmcodikuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbikpXG59XG5pbXBvcnQgc3R5bGUgZnJvbSBcIi4vc3R5bGUvbWFpbi5zY3NzXCJcbmltcG9ydCB7IHRva2VuQ3NzLCB0b2tlbnMgfSBmcm9tIFwiLi9jb25maWdcIlxuaW1wb3J0ICogYXMgZ25vYmxpbiBmcm9tIFwiLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCAqIGFzIG5vdGlmZFN2YyBmcm9tIFwiLi9zZXJ2aWNlcy9ub3RpZmRcIlxuaW1wb3J0IHsgYXJtRHVtcCB9IGZyb20gXCIuL2xpYi9pbnNwZWN0XCJcbmltcG9ydCB7IHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IEJhciBmcm9tIFwiLi93aWRnZXQvQmFyXCJcbmltcG9ydCBEb2NrIGZyb20gXCIuL3dpZGdldC9Eb2NrXCJcbmltcG9ydCBMYXVuY2hlciBmcm9tIFwiLi93aWRnZXQvTGF1bmNoZXJcIlxuaW1wb3J0IFF1aWNrU2V0dGluZ3MgZnJvbSBcIi4vd2lkZ2V0L1F1aWNrU2V0dGluZ3NcIlxuaW1wb3J0IENhbGVuZGFyIGZyb20gXCIuL3dpZGdldC9DYWxlbmRhclwiXG5pbXBvcnQgeyBUb2FzdHMsIERyYXdlciB9IGZyb20gXCIuL3dpZGdldC9Ob3RpZmljYXRpb25zXCJcbmltcG9ydCBPU0QgZnJvbSBcIi4vd2lkZ2V0L09TRFwiXG5pbXBvcnQgU2Vzc2lvbiBmcm9tIFwiLi93aWRnZXQvU2Vzc2lvblwiXG5cbnByaW50ZXJyKFwiS09CRUw6IG1vZHVsZSB0b3AgcmVhY2hlZFwiKVxuXG4vLyBDdXN0b20gaWNvbiBzZXQgXHUyMDE0IHRoZSBleGFjdCBIZXJvaWNvbnMvTHVjaWRlL1RhYmxlciB0aGUgcHJvdG90eXBlIHVzZXMsIGFzXG4vLyByZWNvbG9yYWJsZSBzeW1ib2xpYyBTVkdzLiBSZWdpc3RlcmVkIG9uIHRoZSBkZWZhdWx0IGljb24gdGhlbWUgc28gaWNvbk5hbWVcbi8vIFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIGV0Yy4gcmVzb2x2ZS4gUGF0aCBvdmVycmlkZSB2aWEgS09CRUxfSUNPTlMgZm9yIHRoZSBkZXZraXQuXG5pbXBvcnQgR0xpYkljb25zIGZyb20gXCJnaTovL0dMaWJcIlxuY29uc3QgSUNPTl9ESVIgPVxuICAgIEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKSA/P1xuICAgIEdMaWJJY29ucy5idWlsZF9maWxlbmFtZXYoW0dMaWJJY29ucy5nZXRfY3VycmVudF9kaXIoKSwgXCJpY29uc1wiXSlcblxuQXBwLnN0YXJ0KHtcbiAgICBpbnN0YW5jZU5hbWU6IFwia29iZWxcIixcbiAgICBpY29uczogSUNPTl9ESVIsXG4gICAgbWFpbigpIHtcbiAgICAgICAgZ25vYmxpbi5pbml0KClcbiAgICAgICAgbm90aWZkU3ZjLmluaXQoKVxuICAgICAgICAvLyBMb2FkIG91ciBzdHlsZXNoZWV0IGF0IFVTRVIgcHJpb3JpdHkgKGhpZ2hlc3QpIHNvIGl0IGJlYXRzIEFkd2FpdGEncyB0aGVtZVxuICAgICAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgICAgICAvLyBgc2NhbGUgPiB0cm91Z2hgIChmYXQgc2xpZGVycykuIFRoaXMgcHJvdmlkZXIgaXMgYXV0aG9yaXRhdGl2ZS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHByb3YgPSBuZXcgR3RrLkNzc1Byb3ZpZGVyKClcbiAgICAgICAgICAgIHByb3YubG9hZF9mcm9tX3N0cmluZyhzdHlsZSArIHRva2VuQ3NzKHRva2VucykpXG4gICAgICAgICAgICBHdGsuU3R5bGVDb250ZXh0LmFkZF9wcm92aWRlcl9mb3JfZGlzcGxheShcbiAgICAgICAgICAgICAgICBHZGsuRGlzcGxheS5nZXRfZGVmYXVsdCgpISxcbiAgICAgICAgICAgICAgICBwcm92LFxuICAgICAgICAgICAgICAgIDgwMCAvKiBVU0VSIHByaW9yaXR5ICovXG4gICAgICAgICAgICApXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApXG4gICAgICAgIH1cbiAgICAgICAgLy8gYXN0YWw0IEpTWCA8d2luZG93PiBpcyBjcmVhdGVkIGhpZGRlbiAodmlzaWJsZT1mYWxzZSkuIFBlcnNpc3RlbnQgY2hyb21lIG11c3RcbiAgICAgICAgLy8gYmUgcHJlc2VudCgpZWQ7IG9uLWRlbWFuZCBzdXJmYWNlcyBzdGF5IGhpZGRlbiBhbmQgYXJlIHNob3duIGJ5IHRvZ2dsZV93aW5kb3cuXG4gICAgICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHcgPSBmbigpXG4gICAgICAgICAgICAgICAgaWYgKHcgJiYgdHlwZW9mIHcucHJlc2VudCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgICAgIEFwcC5hZGRfd2luZG93Py4odylcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogJHtuYW1lfSBGQUlMRUQ6ICR7ZX1cXG4keyhlIGFzIGFueSk/LnN0YWNrID8/IFwiXCJ9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBtb25pdG9ycyA9IEFwcC5nZXRfbW9uaXRvcnMoKVxuICAgICAgICBjb25zdCB0YXJnZXRzID0gbW9uaXRvcnMubGVuZ3RoID8gbW9uaXRvcnMgOiBbdW5kZWZpbmVkIGFzIGFueV1cbiAgICAgICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgICAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgICAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgICAgIH1cbiAgICAgICAgbWFrZShcImxhdW5jaGVyXCIsICgpID0+IExhdW5jaGVyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwiY2FsZW5kYXJcIiwgKCkgPT4gQ2FsZW5kYXIoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJkcmF3ZXJcIiwgKCkgPT4gRHJhd2VyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgICAgICAvLyBLT0JFTF9EVU1QPTx3aW5kb3c+OiBkdW1wIHRoZSBsaXZlIEdUSyBnZW9tZXRyeSB0cmVlIGZvciBET00tdnMtR1RLIGRpZmZpbmcuXG4gICAgICAgIGFybUR1bXAoKG5hbWUpID0+IEFwcC5nZXRfd2luZG93KG5hbWUpIGFzIGFueSlcbiAgICB9LFxuICAgIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICAgIHJlcXVlc3RIYW5kbGVyKHJlcXVlc3QsIHJlcykge1xuICAgICAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICAgICAgaWYgKGNtZCA9PT0gXCJ0b2dnbGVcIikge1xuICAgICAgICAgICAgc3VyZmFjZVRvZ2dsZShhcmcpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kID09PSBcInJlbG9hZC1jc3NcIikge1xuICAgICAgICAgICAgQXBwLmFwcGx5X2NzcyhzdHlsZSArIHRva2VuQ3NzKHRva2VucyksIHRydWUpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICByZXMoXCJ1bmtub3duXCIpXG4gICAgfSxcbn0pXG4iLCAiQGNoYXJzZXQgXCJVVEYtOFwiO1xud2luZG93IHtcbiAgZm9udC1mYW1pbHk6IFwiSW50ZXJcIiwgXCJJbnRlciBWYXJpYWJsZVwiLCBcIkludGVyVmFyaWFibGVcIiwgc2Fucy1zZXJpZjtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLnRuIHtcbiAgZm9udC1mZWF0dXJlLXNldHRpbmdzOiBcInRudW1cIjtcbn1cblxud2luZG93IHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbmJ1dHRvbiB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zLCBjb2xvciAxNjBtcztcbn1cblxuaW1hZ2Uge1xuICAtZ3RrLWljb24tc3R5bGU6IHJlZ3VsYXI7XG59XG5cbi5iYXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiAwIDdweDtcbiAgbWluLWhlaWdodDogNDJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50aXRsZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luOiAwIDlweDtcbn1cbi5iYXIgLmNsb2NrIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmJhciAuZGF0ZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLmlidG4ge1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAuaWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuaWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmJhciAuYmNlbnRlciB7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uYmFyIC5iY2VudGVyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1cyB7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDAgMTNweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uYmFyIC5zdGF0dXM6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLmJhciAuc3RhdHVzIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuc3RhdHVzIC5wY3QgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5iYXIgLnN0YXR1cyBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjAwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLnN0YXR1cy5lcnIgLm5ldC1pY29uIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG4uYmFyIC5iYWRnZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogMCAzcHg7XG4gIG1hcmdpbjogMnB4O1xuICBtaW4taGVpZ2h0OiAxNHB4O1xuICBtaW4td2lkdGg6IDE0cHg7XG59XG4uYmFyIC50cmF5LWljb24ge1xuICBtaW4td2lkdGg6IDI4cHg7XG59XG4uYmFyIC50cmF5LWljb24gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50cmF5LWxhbmcge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwIDhweDtcbiAgbWluLXdpZHRoOiAwO1xufVxuXG4uZG9jayB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIHBhZGRpbmc6IDVweDtcbiAgYm9yZGVyLXJhZGl1czogMTZweDtcbn1cbi5kb2NrIC5kYnRuIHtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5kb2NrIC5pY29uLXRpbGUge1xuICBtaW4td2lkdGg6IDMwcHg7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAxNjBtcztcbn1cbi5kb2NrIC5kYnRuOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLmRvY2sgLnBsYWNlaG9sZGVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5kb2NrIC5kb3RzIHtcbiAgbWFyZ2luLWJvdHRvbTogM3B4O1xufVxuLmRvY2sgLmRvdCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1pbi13aWR0aDogNHB4O1xuICBtaW4taGVpZ2h0OiA0cHg7XG4gIHRyYW5zaXRpb246IG1pbi13aWR0aCAyNjBtcyBjdWJpYy1iZXppZXIoMC4yNCwgMS4zNiwgMC4zNSwgMSksIGJhY2tncm91bmQtY29sb3IgMjIwbXM7XG59XG4uZG9jayAuZG90Lm9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgbWluLXdpZHRoOiAxMnB4O1xufVxuLmRvY2sgLmRvdC5taW5pIHtcbiAgbWluLXdpZHRoOiAzcHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgb3BhY2l0eTogMC43O1xufVxuLmRvY2sgLnNlcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIG1pbi13aWR0aDogMXB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xuICBtYXJnaW46IDAgM3B4O1xufVxuLmRvY2sgLmR0aWxlIHtcbiAgbWluLXdpZHRoOiA0MnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuLmRvY2sgLmR3aWRnZXQgLmRnIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogNnB4O1xufVxuLmRvY2sgbGV2ZWxiYXIubXByb2cge1xuICBtaW4td2lkdGg6IDI1cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmRvY2sgbGV2ZWxiYXIubXByb2cgPiB0cm91Z2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMzUpO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG59XG4uZG9jayBsZXZlbGJhci5tcHJvZyA+IHRyb3VnaCA+IGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4uZG9jayBsZXZlbGJhci5tcHJvZyA+IHRyb3VnaCA+IGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG5cbi5zaGVldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDI0cHg7XG4gIHBhZGRpbmc6IDEycHg7XG4gIG1hcmdpbjogMzhweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xufVxuXG4ucXMge1xuICBtaW4td2lkdGg6IDMyOHB4O1xufSAvKiBtYXRjaGVzIHBhbmVsVygzNTIpXHUyMjEyMjQ7IG92ZXJyaWRkZW4gYnkgY29uZmlnLnRzIHRva2VuQ3NzIGF0IHJ1bnRpbWUgKi9cbi5xcy10b3Age1xuICBtYXJnaW4tYm90dG9tOiAxMnB4O1xuICBwYWRkaW5nOiAwIDJweDtcbn1cbi5xcy10b3AgLm1ldGEge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucXMtdG9wIC5tZXRhIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4ucXMtdG9wIC5yYnRuIHtcbiAgcGFkZGluZzogOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luLWxlZnQ6IDdweDtcbn1cbi5xcy10b3AgLnJidG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5xcy10b3AgLnJidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5xcy10b3AgLnJidG4uZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4ucXMtdG9wIC5yYnRuLmxlYWYgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLmNoaXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLWhlaWdodDogNTRweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5jaGlwIC5jaGlwYiB7XG4gIHBhZGRpbmc6IDlweCA4cHggOXB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xufVxuLmNoaXAgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE3cHg7XG59XG4uY2hpcCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jaGlwIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIG1hcmdpbi10b3A6IDA7XG59XG4uY2hpcDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uY2hpcC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2hpcC5vbiBpbWFnZSB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gbGFiZWwge1xuICBjb2xvcjogIzE5MjAwMztcbn1cbi5jaGlwLm9uIC5zdWIge1xuICBjb2xvcjogIzMzM2QxNztcbn1cbi5jaGlwLm9uOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cbi5jaGlwLm9uIC5jaGV2IHtcbiAgY29sb3I6ICMxOTIwMDM7XG59XG4uY2hpcCAuY2hldiB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogMCA5OTlweCA5OTlweCAwO1xuICBjb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLWxlZnQ6IDFweCBzb2xpZCByZ2JhKDAsIDAsIDAsIDAuMTgpO1xufVxuLmNoaXAgLmNoZXYgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgY29sb3I6IGluaGVyaXQ7XG59XG4uY2hpcCAuY2hldjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4xNCk7XG59XG5cbi5jaGlwcyB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG5cbi5jaGlwcyA+IGJveDpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLXJpZ2h0OiAxcHg7XG59XG5cbi5jaGlwLWdyaWQge1xuICBtYXJnaW4tYm90dG9tOiAxMHB4O1xufVxuXG5zY2FsZSwgc2NhbGU6aG9yaXpvbnRhbCwgc2NhbGU6dmVydGljYWwge1xuICBtaW4taGVpZ2h0OiAwO1xuICBtaW4td2lkdGg6IDA7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogNnB4IDA7XG59XG5cbnNjYWxlID4gdHJvdWdoLCBzY2FsZTpob3Jpem9udGFsID4gdHJvdWdoLCBzY2FsZTp2ZXJ0aWNhbCA+IHRyb3VnaCB7XG4gIG1pbi1oZWlnaHQ6IDZweDtcbiAgbWluLXdpZHRoOiAwO1xuICBtYXJnaW46IDA7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IGhpZ2hsaWdodCxcbnNjYWxlID4gdHJvdWdoID4gcHJvZ3Jlc3Mge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IHNsaWRlciB7XG4gIG1pbi13aWR0aDogMTdweDtcbiAgbWluLWhlaWdodDogMTdweDtcbiAgbWFyZ2luOiAtNnB4OyAvKiBwcm90b3R5cGUga25vYiAxN1x1MDBENzE3ICovXG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3gtc2hhZG93OiAwIDFweCA0cHggcmdiYSgwLCAwLCAwLCAwLjUpO1xufVxuXG4uc3JvdyB7XG4gIHBhZGRpbmc6IDAgMnB4IDAgMnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuLnNyb3cgLnN2YWwge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtaW4td2lkdGg6IDMycHg7XG59XG5cbi5zcm93IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDAgLTEycHggMCAxMnB4O1xufVxuXG4uc3JvdyAuY2hldiB7XG4gIHBhZGRpbmc6IDZweCA4cHg7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uc3JvdyAuY2hldiBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4uc3JvdyAuY2hldjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG5cbi5nYmFubmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xuICBtYXJnaW4tYm90dG9tOiA4cHg7XG59XG4uZ2Jhbm5lciAudCB7XG4gIGNvbG9yOiAjZWRiYjY0O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5nYmFubmVyIC5zIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xufVxuLmdiYW5uZXIgaW1hZ2Uge1xuICBjb2xvcjogI2VkYmI2NDtcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG5cbi5nYnRuIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBwYWRkaW5nOiA3cHggMTJweDtcbn1cbi5nYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cblxuLmRoZWFkIHtcbiAgcGFkZGluZy1ib3R0b206IDEwcHg7XG59XG4uZGhlYWQgYnV0dG9uIHtcbiAgcGFkZGluZzogN3B4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmRoZWFkIGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmRoZWFkIGxhYmVsIHtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxNHB4O1xufVxuXG5zd2l0Y2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiA0NnB4O1xuICBtaW4taGVpZ2h0OiAyNnB4O1xufVxuc3dpdGNoIHNsaWRlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4td2lkdGg6IDIwcHg7XG4gIG1pbi1oZWlnaHQ6IDIwcHg7XG59XG5zd2l0Y2g6Y2hlY2tlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG5zd2l0Y2g6Y2hlY2tlZCBzbGlkZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTkyMDAzO1xufVxuXG4ueHJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIHBhZGRpbmc6IDlweCAxMXB4O1xufVxuLnhyb3cgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4ueHJvdyBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi54cm93IC54cyB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cbi54cm93OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi54cm93LmFjdGl2ZSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMTA2LCAxOTcsIDE0MywgMC4wOCk7XG59XG4ueHJvdy5hY3RpdmUgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cbi54cm93LmFjdGl2ZSAueHMge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLm1peHJvdyB7XG4gIHBhZGRpbmc6IDRweCAycHg7XG4gIG1pbi1oZWlnaHQ6IDQwcHg7XG59XG4ubWl4cm93IC5taSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNnB4O1xufVxuLm1peHJvdyAubWkgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4ubWl4cm93IC5tbmFtZSB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIG1pbi13aWR0aDogNzJweDtcbn1cblxuLnNoZWV0LmxhdW5jaGVyIHtcbiAgbWluLXdpZHRoOiA1NjhweDtcbn1cblxuLmxhdW5jaGVyIHtcbiAgcGFkZGluZzogOHB4O1xufVxuXG4uZmllbGQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAzcHggMTJweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmZpZWxkIGltYWdlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmZpZWxkIGVudHJ5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYm9yZGVyOiBub25lO1xuICBib3gtc2hhZG93OiBub25lO1xuICBvdXRsaW5lOiBub25lO1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxNC41cHg7XG4gIGNhcmV0LWNvbG9yOiAjYjVjYjQ4O1xuICBwYWRkaW5nOiA4cHggMDtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xufVxuLmZpZWxkIGVudHJ5IHRleHQge1xuICBtaW4taGVpZ2h0OiAwO1xufVxuLmZpZWxkIC5scGxhY2Vob2xkZXIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxNC41cHg7XG59XG4uZmllbGQgLmdob3N0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5rYmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogM3B4IDdweDtcbn1cblxuLnRpbGVzIHtcbiAgcGFkZGluZzogOHB4IDJweCAxMHB4O1xufVxuXG4udGlsZSB7XG4gIHBhZGRpbmc6IDVweCAwO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBtaW4td2lkdGg6IDY0cHg7XG59XG4udGlsZSAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAwO1xuICBtaW4taGVpZ2h0OiAwO1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4udGlsZSBsYWJlbCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi50aWxlOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLnRpbGU6aG92ZXIgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLmxmb290IHtcbiAgcGFkZGluZzogN3B4IDEwcHggM3B4O1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMXB4O1xufVxuLmxmb290IGIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmx3aWRnZXRzIHtcbiAgcGFkZGluZzogMCAycHggNnB4O1xufVxuXG4ud2lkZ2V0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xufVxuLndpZGdldCBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi53aWRnZXQgLmhpbnQge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4ubHdtIC5sd2FydCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xufVxuLmx3bSAubHdhcnQgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4ubHdtIC5tYnRuIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgbWluLXdpZHRoOiAyOXB4O1xuICBtaW4taGVpZ2h0OiAyOXB4O1xufVxuLmx3bSAubWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmx3bSAubWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5scm93cyB7XG4gIHBhZGRpbmc6IDRweCAycHg7XG59XG5cbi5zZWMge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBwYWRkaW5nOiA4cHggMTBweCAycHg7XG59XG5cbi5yb3cge1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA3cHggMTBweDtcbn1cbi5yb3cgLnJpIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiAycHg7XG59XG4ucm93IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDI0cHg7XG59XG4ucm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLnJvdyAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5yb3cgLnJ1bmsge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogMnB4IDdweDtcbn1cbi5yb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLnJvdy5zZWwge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG4uY2FsIHtcbiAgbWluLXdpZHRoOiAzMDlweDtcbn1cbi5jYWwgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5jYWwgLmhlcm8ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxOXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuY2FsaGVybyB7XG4gIHBhZGRpbmc6IDRweCA4cHggOHB4O1xufVxuLmNhbCAuY2FsLWdyaWQge1xuICBtYXJnaW4tdG9wOiA4cHg7XG59XG4uY2FsIC5tb250aCB7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDEzcHg7XG59XG4uY2FsIC5tb250aDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5jYWwgY2VudGVyYm94ID4gYnV0dG9uIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmNhbCAuZG93IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIHBhZGRpbmc6IDNweCAwIDVweDtcbn1cbi5jYWwgLndrIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNhbCAuZGF5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIG1pbi13aWR0aDogMjRweDtcbiAgbWluLWhlaWdodDogMjRweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbn1cbi5jYWwgLmRheTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY2FsIC5kYXkud2Uge1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5jYWwgLmRheS5vdXQge1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5jYWwgLmRheS50b2RheSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBmb250LXdlaWdodDogNzAwO1xufVxuLmNhbCAuZGF5LnRvZGF5OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbi5jYWwgLmRheS5zZWw6bm90KC50b2RheSkge1xuICBib3gtc2hhZG93OiBpbnNldCAwIDAgMCAxLjVweCAjYjVhZGJjO1xufVxuLmNhbCAuZGF5LnRvZGF5LnNlbCB7XG4gIGJveC1zaGFkb3c6IGluc2V0IDAgMCAwIDEuNXB4ICMxOTIwMDM7XG59XG4uY2FsIC5kYXkgLmV2ZG90IHtcbiAgbWluLXdpZHRoOiAzcHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgbWFyZ2luLWJvdHRvbTogMnB4O1xufVxuLmNhbCAuZGF5LnRvZGF5IC5ldmRvdCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxOTIwMDM7XG59XG4uY2FsIC5ldmNhcmQge1xuICBtYXJnaW4tdG9wOiAxMHB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4O1xufVxuLmNhbCAuZXZoZWFkIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBwYWRkaW5nOiAxcHggM3B4IDhweDtcbn1cbi5jYWwgLmV2ZW1wdHkge1xuICBmb250LXNpemU6IDExLjVweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIHBhZGRpbmc6IDJweCAzcHggM3B4O1xufVxuLmNhbCAuZXZlbXB0eSBpbWFnZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5jYWwgLmV2cm93IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgcGFkZGluZzogOHB4IDEwcHg7XG4gIG1hcmdpbi1ib3R0b206IDRweDtcbn1cbi5jYWwgLmV2cm93Omxhc3QtY2hpbGQge1xuICBtYXJnaW4tYm90dG9tOiAwO1xufVxuLmNhbCAuZXZyb3cgLmV2aWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjNjI4OTMzO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDZweDtcbn1cbi5jYWwgLmV2cm93IC5ldmljIGltYWdlIHtcbiAgY29sb3I6ICNmZmY7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmNhbCAuZXZyb3cgbGFiZWwge1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4uY2FsIC5ldnJvdyAuc3ViIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4uZHJhd2VyIHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbi50b2FzdCB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMTYsIDEzLCAyMCwgMC44Mik7XG4gIGJvcmRlci1yYWRpdXM6IDIwcHg7XG4gIHBhZGRpbmc6IDExcHggMTNweDtcbiAgYm94LXNoYWRvdzogMCAxOHB4IDQwcHggcmdiYSg1LCAzLCAxMCwgMC40NSk7XG59XG4udG9hc3QgLm5jYXJkIHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIGJvcmRlci1yYWRpdXM6IDA7XG4gIHBhZGRpbmc6IDA7XG59XG5cbi5uY2FyZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDIwcHg7XG4gIHBhZGRpbmc6IDExcHggMTJweDtcbn1cbi5uY2FyZCAubmljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgbWluLXdpZHRoOiAzMHB4O1xuICBtaW4taGVpZ2h0OiAzMHB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4ubmNhcmQgLm5pYyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5uY2FyZCB7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xufVxuLm5jYXJkIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4ubmNhcmQgLmJvZHkge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS44cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgLndoZW4ge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xufVxuLm5jYXJkIC5ueCB7XG4gIG1pbi13aWR0aDogMjJweDtcbiAgbWluLWhlaWdodDogMjJweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4ubmNhcmQgLm54IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDExcHg7XG59XG4ubmNhcmQgLm54OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNlZjg2YTA7XG59XG4ubmNhcmQubWVkaWEge1xuICBwYWRkaW5nOiAxMHB4IDExcHggOXB4O1xuICBtYXJnaW4tYm90dG9tOiAycHg7XG4gIGJveC1zaGFkb3c6IDAgMTVweCAzNHB4IHJnYmEoOCwgNSwgMTYsIDAuNDUpLCAwIDJweCA4cHggcmdiYSgwLCAwLCAwLCAwLjM1KTtcbn1cbi5uY2FyZCAubWFydCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIG1pbi13aWR0aDogNDZweDtcbiAgbWluLWhlaWdodDogNDZweDtcbn1cbi5uY2FyZCAubWFydCBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMjJweDtcbn1cbi5uY2FyZCAubW1ldGEgbGFiZWwge1xuICBmb250LXNpemU6IDEzcHg7XG59XG4ubmNhcmQgLm1tZXRhIC5zdWIge1xuICBmb250LXNpemU6IDExLjVweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgLm1idG4ge1xuICBtaW4td2lkdGg6IDI5cHg7XG4gIG1pbi1oZWlnaHQ6IDI5cHg7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4ubmNhcmQgLm1idG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5uY2FyZCAubWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLm5jYXJkIC5tYmFyIHtcbiAgbWFyZ2luLXRvcDogN3B4O1xufVxuLm5jYXJkIC5tdGltZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cbi5uY2FyZCBsZXZlbGJhci5tdHJhY2sge1xuICBtaW4taGVpZ2h0OiA0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4ubmNhcmQgbGV2ZWxiYXIubXRyYWNrID4gdHJvdWdoIHtcbiAgbWluLWhlaWdodDogNHB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLm5jYXJkIGxldmVsYmFyLm10cmFjayA+IHRyb3VnaCA+IGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4ubmNhcmQgbGV2ZWxiYXIubXRyYWNrID4gdHJvdWdoID4gYmxvY2suZW1wdHkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiB0cmFuc3BhcmVudDtcbn1cbi5uY2FyZCAubWVtcHR5cm93IGxhYmVsIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cbi5uY2FyZCAubWVtcHR5cm93IC5tYXJ0IGltYWdlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4ubmNhcmQgLmdob3N0YiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgcGFkZGluZzogN3B4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG59XG4ubmNhcmQgLmdob3N0YiBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5uY2FyZCAuZ2hvc3RiOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzMyMmUzOTtcbn1cblxuLm5oZWFkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTRweDtcbiAgcGFkZGluZzogOHB4IDhweCA4cHggMTRweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbn1cbi5uaGVhZCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLm5oZWFkIC5zdWIge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5oZWFkIC5uY2xlYXIge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGJvcmRlci1yYWRpdXM6IDdweDtcbiAgcGFkZGluZzogNHB4IDlweDtcbn1cbi5uaGVhZCAubmNsZWFyIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDEycHg7XG4gIGNvbG9yOiAjZWY4NmEwO1xufVxuLm5oZWFkIC5uY2xlYXIgbGFiZWwge1xuICBjb2xvcjogI2VmODZhMDtcbn1cbi5uaGVhZCAubmNsZWFyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLm5lbXB0eSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDIwcHg7XG4gIHBhZGRpbmc6IDIwcHggMCAxNnB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uZW1wdHkgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDIycHg7XG4gIG1hcmdpbi1ib3R0b206IDRweDtcbn1cbi5uZW1wdHkgbGFiZWwge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5vc2Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgcGFkZGluZzogMTBweCAxNXB4O1xufVxuLm9zZCBpbWFnZSB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5vc2QgbGV2ZWxiYXIgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA4cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4ub3NkIGxldmVsYmFyID4gdHJvdWdoID4gYmxvY2sge1xuICBtaW4taGVpZ2h0OiA4cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4ub3NkIGxldmVsYmFyID4gdHJvdWdoID4gYmxvY2suZmlsbGVkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbi5vc2QgbGV2ZWxiYXIgPiB0cm91Z2ggPiBibG9jay5lbXB0eSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xufVxuLm9zZCAuc3ZhbCB7XG4gIG1pbi13aWR0aDogMzRweDtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuXG4uc2Vzc2lvbiB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoOSwgMywgMTQsIDAuOCk7XG59XG4uc2Vzc2lvbiAuc2J0biB7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5zZXNzaW9uIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyNHB4O1xuICBtaW4td2lkdGg6IDYycHg7XG4gIG1pbi1oZWlnaHQ6IDYycHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xuICBjb2xvcjogI2YzZWVmMztcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMDBtcywgY29sb3IgMjAwbXM7XG59XG4uc2Vzc2lvbiAucmVkIC5zaWMge1xuICBjb2xvcjogI2VmODZhMDtcbn1cbi5zZXNzaW9uIC5zYnRuOmhvdmVyIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5zZXNzaW9uIC5yZWQ6aG92ZXIgLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLnNlc3Npb24gbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuLnNlc3Npb24gLmNvbmZpcm0gbGFiZWwge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxucG9wb3Zlci5jbWVudSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDVweDtcbiAgbWluLXdpZHRoOiAxODBweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xuICBib3JkZXI6IG5vbmU7XG59XG5wb3BvdmVyLmNtZW51ID4gYXJyb3csIHBvcG92ZXIuY21lbnUgPiBjb250ZW50cyB7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG59XG5cbi5jbWkge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uY21pIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmNtaSBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uY21pOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5jbWkuZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4uY21pLmRhbmdlcjpob3ZlciBpbWFnZSB7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLmNtaS5kYW5nZXI6aG92ZXIgbGFiZWwge1xuICBjb2xvcjogIzRiMGYxZjtcbn1cblxuLmNzZXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBtaW4taGVpZ2h0OiAxcHg7XG4gIG1hcmdpbjogNHB4IDhweDtcbn1cblxuLmR0aXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBjb2xvcjogI2YzZWVmMztcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgcGFkZGluZzogNnB4IDExcHg7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn0iLCAiLy8gVGhlIHRva2VuIGxheWVyIFx1MjAxNCB0aGUgc2luZ2xlIHBsYWNlIHRoZSBzaGVsbCdzIGdlb21ldHJ5IGNvbWVzIGZyb20uXG4vLyBQcm90b3R5cGUgZXF1aXZhbGVudDogdGhlIENTUyBjdXN0b20gcHJvcGVydGllcyBvbiAuZGVza3RvcCAoMDRiZTcyZSkuXG4vLyBDaGFuZ2UgYSB2YWx1ZSBoZXJlIGFuZCBiYXIsIHBhbmVscywgZG9jaywgc25hcC1hbmNob3JlZCBzdXJmYWNlcyBhbGwgcmVmbG93LlxuXG5leHBvcnQgaW50ZXJmYWNlIFRva2VucyB7XG4gICAgYmFySDogbnVtYmVyIC8vIHB4IFx1MjAxNCBiYXIgaGVpZ2h0OyBjb250cm9scyBkZXJpdmUgZnJvbSBpdFxuICAgIGJhclI6IG51bWJlciAvLyBiYXIgY29ybmVyIHJhZGl1c1xuICAgIGdhcDogbnVtYmVyIC8vIHNjcmVlbiBnYXAgKGJhciB0b3Agb2Zmc2V0LCBkb2NrIGJvdHRvbSBvZmZzZXQpXG4gICAgZWRnZTogbnVtYmVyIC8vIHNpZGUgaW5zZXRzXG4gICAgaWNvbjogbnVtYmVyIC8vIGRvY2svbGF1bmNoZXIgaWNvbiB0aWxlIHNpemVcbiAgICBkb2NrUGFkOiBudW1iZXIgLy8gZG9jayBwYWRkaW5nIChjb25jZW50cmljIHJhZGl1cyBkZXJpdmVzKVxuICAgIHRpbGVIOiBudW1iZXIgLy8gUVMgdGlsZSBoZWlnaHRcbiAgICBwYW5lbFc6IG51bWJlciAvLyBRUy9ub3RpZmljYXRpb25zL3RvYXN0cyB3aWR0aFxuICAgIGxhdW5jaGVyVzogbnVtYmVyXG4gICAgY2FsZW5kYXJXOiBudW1iZXJcbn1cblxuZXhwb3J0IGNvbnN0IGZsb2F0aW5nOiBUb2tlbnMgPSB7XG4gICAgYmFySDogNDIsXG4gICAgYmFyUjogMTQsXG4gICAgZ2FwOiAxMCxcbiAgICBlZGdlOiAxMixcbiAgICBpY29uOiA0NCxcbiAgICBkb2NrUGFkOiA1LFxuICAgIHRpbGVIOiA1NCxcbiAgICBwYW5lbFc6IDM2NSwgLy8gMjguNWNxdyBhdCAxMjgwcHggPSAzNjQuOCBcdTIyNDggMzY1XG4gICAgbGF1bmNoZXJXOiA1ODQsIC8vIDQ2Y3F3IGF0IDEyODBweCA9IDU4OC44IFx1MjE5MiBjbGFtcGVkIHRvIDU4NCBtYXhcbiAgICBjYWxlbmRhclc6IDMzNiwgLy8gMjdjcXcgYXQgMTI4MHB4ID0gMzQ1LjYgXHUyMTkyIGNsYW1wZWQgdG8gMzM2IG1heFxufVxuXG4vLyBnYXBsZXNzID0gYSB0b2tlbiBwcmVzZXQsIGV4YWN0bHkgbGlrZSB0aGUgcHJvdG90eXBlJ3MgLmdhcGxlc3MgY2xhc3NcbmV4cG9ydCBjb25zdCBnYXBsZXNzOiBUb2tlbnMgPSB7XG4gICAgLi4uZmxvYXRpbmcsXG4gICAgYmFySDogMzgsXG4gICAgYmFyUjogMCxcbiAgICBnYXA6IDAsXG4gICAgZWRnZTogMCxcbn1cblxuZXhwb3J0IGxldCB0b2tlbnM6IFRva2VucyA9IGZsb2F0aW5nXG5cbmV4cG9ydCBjb25zdCBjdGwgPSAoKSA9PiB0b2tlbnMuYmFySCAtIDExIC8vIGJhciBjb250cm9sIHNpemVcbmV4cG9ydCBjb25zdCBwYW5lbFRvcCA9ICgpID0+IHRva2Vucy5nYXAgKyB0b2tlbnMuYmFySCArIDZcblxuLy8gR1RLIENTUyBjYW4ndCBjYWxjKCkgZnJvbSBKUyBzdGF0ZTsgd2UgcmVnZW5lcmF0ZSBhIDpyb290LWlzaCBibG9jayBhbmRcbi8vIGxldCBBcHAuYXBwbHlfY3NzIHJlLXNraW4gbGl2ZSAodGhlIFwiYmFyIDQyIGN5Y2xlclwiIG9mIHRoZSBRTUwvQUdTIHdvcmxkKS5cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbkNzcyh0OiBUb2tlbnMgPSB0b2tlbnMpOiBzdHJpbmcge1xuICAgIHJldHVybiBgXG4gIC5iYXIgeyBtaW4taGVpZ2h0OiAke3QuYmFySH1weDsgYm9yZGVyLXJhZGl1czogJHt0LmJhclJ9cHg7XG4gICAgICAgICBtYXJnaW46IDA7IH1cbiAgLmJhciBidXR0b24geyBtaW4td2lkdGg6ICR7Y3RsKCl9cHg7IG1pbi1oZWlnaHQ6ICR7Y3RsKCl9cHg7IH1cbiAgLmRvY2sgeyBwYWRkaW5nOiAke3QuZG9ja1BhZH1weDsgYm9yZGVyLXJhZGl1czogJHsxMiArIHQuZG9ja1BhZCAtIDF9cHg7XG4gICAgICAgICAgbWFyZ2luLWJvdHRvbTogJHt0LmdhcH1weDsgfVxuICAuaWNvbi10aWxlIHsgbWluLXdpZHRoOiAke3QuaWNvbn1weDsgbWluLWhlaWdodDogJHt0Lmljb259cHg7IH1cbiAgLnFzLCAuZHJhd2VyLCAuY2FsZW5kYXIsIC5jYWwgeyBtYXJnaW4tdG9wOiAke3BhbmVsVG9wKCl9cHg7IH1cbiAgLnFzIHsgbWluLXdpZHRoOiAke3QucGFuZWxXIC0gMjR9cHg7IH0gIC8qIHBhbmVsVyBpcyBvdXRlcjsgc3VidHJhY3QgLnNoZWV0IHBhZGRpbmcgMTJweFx1MDBENzIgKi9cbiAgLmxhdW5jaGVyIHsgbWluLXdpZHRoOiAke3QubGF1bmNoZXJXfXB4OyB9XG4gIC5jYWxlbmRhciwgLmNhbCB7IG1pbi13aWR0aDogJHt0LmNhbGVuZGFyVyAtIDI0fXB4OyB9ICAvKiBjYWxlbmRhclcgaXMgb3V0ZXI7IHN1YnRyYWN0IC5zaGVldCBwYWRkaW5nIDEyXHUwMEQ3MiAqL1xuICAuY2hpcCB7IG1pbi1oZWlnaHQ6ICR7dC50aWxlSH1weDsgfVxuICBgXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRUb2tlbnMobmV4dDogUGFydGlhbDxUb2tlbnM+LCBhcHBseTogKGNzczogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgdG9rZW5zID0geyAuLi50b2tlbnMsIC4uLm5leHQgfVxuICAgIGFwcGx5KHRva2VuQ3NzKHRva2VucykpXG59XG4iLCAiLy8gb3JnLmdub2JsaW4uU2hlbGwgXHUyMDE0IHRoZSBjb21wb3NpdG9yIGxpbmsuIERyaXZlczogc29mdC1yZWxvYWQsIGZlYXR1cmUgdG9nZ2xlcyxcbi8vIHRoZSBXSU5ET1cgTElTVCB0aGF0IG1ha2VzIHRoZSBkb2NrIHRydXRoZnVsLCBhbmQgdGhlIGNvbm5lY3RlZC9hbWJlciBzdGF0ZS5cbi8vIFByb3RvdHlwZTogc2VydmljZXMgJ2dub2InIGJhbm5lciArIGJhciBhbWJlciBzZWdtZW50ICsgV00gaW50ZWdyYXRpb24uXG5cbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuaW1wb3J0IHsgVmFyaWFibGUgfSBmcm9tIFwiYXN0YWxcIlxuXG5jb25zdCBCVVMgPSBcIm9yZy5nbm9ibGluLlNoZWxsXCJcbmNvbnN0IFBBVEggPSBcIi9vcmcvZ25vYmxpbi9TaGVsbFwiXG5jb25zdCBJRkFDRSA9IFwib3JnLmdub2JsaW4uU2hlbGxcIlxuXG5leHBvcnQgaW50ZXJmYWNlIEdub2JsaW5XaW5kb3cge1xuICAgIGlkOiBzdHJpbmdcbiAgICBhcHBJZDogc3RyaW5nXG4gICAgdGl0bGU6IHN0cmluZ1xuICAgIGZvY3VzZWQ6IGJvb2xlYW5cbiAgICBtaW5pbWl6ZWQ6IGJvb2xlYW5cbn1cblxuZXhwb3J0IGNvbnN0IGNvbm5lY3RlZCA9IFZhcmlhYmxlKGZhbHNlKVxuZXhwb3J0IGNvbnN0IHdpbmRvd3MgPSBWYXJpYWJsZTxHbm9ibGluV2luZG93W10+KFtdKVxuXG5sZXQgcHJveHk6IEdpby5EQnVzUHJveHkgfCBudWxsID0gbnVsbFxuXG5mdW5jdGlvbiBjYWxsKG1ldGhvZDogc3RyaW5nLCBwYXJhbXM6IEdMaWIuVmFyaWFudCB8IG51bGwgPSBudWxsKTogUHJvbWlzZTxHTGliLlZhcmlhbnQgfCBudWxsPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMsIHJlaikgPT4ge1xuICAgICAgICBpZiAoIXByb3h5KSByZXR1cm4gcmVqKG5ldyBFcnJvcihcImdub2JsaW46IG5vdCBjb25uZWN0ZWRcIikpXG4gICAgICAgIHByb3h5LmNhbGwobWV0aG9kLCBwYXJhbXMsIEdpby5EQnVzQ2FsbEZsYWdzLk5PTkUsIDIwMDAsIG51bGwsIChfLCByKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlcyhwcm94eSEuY2FsbF9maW5pc2gocikpXG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgcmVqKGUpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbn1cblxuZXhwb3J0IGNvbnN0IHJlbG9hZCA9ICgpID0+IGNhbGwoXCJSZWxvYWRcIilcbmV4cG9ydCBjb25zdCBzZXRGZWF0dXJlID0gKG5hbWU6IHN0cmluZywgb246IGJvb2xlYW4pID0+XG4gICAgY2FsbChcIlNldEZlYXR1cmVcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzYilcIiwgW25hbWUsIG9uXSkpXG5cbi8vIFdpbmRvdyB2ZXJicyAodGhlIGRvY2sgY2xpY2sgbW9kZWwpXG5leHBvcnQgY29uc3QgYWN0aXZhdGUgPSAoaWQ6IHN0cmluZykgPT4gY2FsbChcIkFjdGl2YXRlV2luZG93XCIsIG5ldyBHTGliLlZhcmlhbnQoXCIocylcIiwgW2lkXSkpXG5leHBvcnQgY29uc3QgbWluaW1pemUgPSAoaWQ6IHN0cmluZykgPT4gY2FsbChcIk1pbmltaXplV2luZG93XCIsIG5ldyBHTGliLlZhcmlhbnQoXCIocylcIiwgW2lkXSkpXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWZyZXNoV2luZG93cygpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB2ID0gYXdhaXQgY2FsbChcIkxpc3RXaW5kb3dzXCIpXG4gICAgICAgIGlmICghdikgcmV0dXJuXG4gICAgICAgIGNvbnN0IFtsaXN0XSA9IHYuZGVlcF91bnBhY2soKSBhcyBbR25vYmxpbldpbmRvd1tdXVxuICAgICAgICB3aW5kb3dzLnNldChsaXN0KVxuICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiBzdGF5IG9uIGxhc3Qta25vd24gbGlzdDsgY29ubmVjdGVkIGZsYWcgY2FycmllcyB0aGUgdHJ1dGggKi9cbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBXaW5kb3dzKGFwcElkOiBzdHJpbmcpOiBHbm9ibGluV2luZG93W10ge1xuICAgIHJldHVybiB3aW5kb3dzLmdldCgpLmZpbHRlcigodykgPT4gdy5hcHBJZCA9PT0gYXBwSWQpXG59XG5cbi8vIEN5Y2xlID0gdGhlIGRvY2sgY2Fyb3VzZWw6IGZvY3VzIHRoZSBuZXh0IHdpbmRvdyBvZiB0aGUgYXBwXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3ljbGUoYXBwSWQ6IHN0cmluZywgZGlyOiAxIHwgLTEpIHtcbiAgICBjb25zdCB3cyA9IGFwcFdpbmRvd3MoYXBwSWQpXG4gICAgaWYgKHdzLmxlbmd0aCA8IDIpIHJldHVyblxuICAgIGNvbnN0IGkgPSB3cy5maW5kSW5kZXgoKHcpID0+IHcuZm9jdXNlZClcbiAgICBhd2FpdCBhY3RpdmF0ZSh3c1soKGkgPCAwID8gMCA6IGkpICsgZGlyICsgd3MubGVuZ3RoKSAlIHdzLmxlbmd0aF0uaWQpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0KCkge1xuICAgIEdpby5idXNfd2F0Y2hfbmFtZShcbiAgICAgICAgR2lvLkJ1c1R5cGUuU0VTU0lPTixcbiAgICAgICAgQlVTLFxuICAgICAgICBHaW8uQnVzTmFtZVdhdGNoZXJGbGFncy5OT05FLFxuICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAvLyBhcHBlYXJlZFxuICAgICAgICAgICAgR2lvLkRCdXNQcm94eS5uZXdfZm9yX2J1cyhcbiAgICAgICAgICAgICAgICBHaW8uQnVzVHlwZS5TRVNTSU9OLFxuICAgICAgICAgICAgICAgIEdpby5EQnVzUHJveHlGbGFncy5OT05FLFxuICAgICAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAgICAgQlVTLFxuICAgICAgICAgICAgICAgIFBBVEgsXG4gICAgICAgICAgICAgICAgSUZBQ0UsXG4gICAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgICAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHByb3h5ID0gR2lvLkRCdXNQcm94eS5uZXdfZm9yX2J1c19maW5pc2gocmVzKVxuICAgICAgICAgICAgICAgICAgICBwcm94eS5jb25uZWN0KFwiZy1zaWduYWxcIiwgKF9wLCBfcywgc2lnKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2lnID09PSBcIldpbmRvd3NDaGFuZ2VkXCIpIHJlZnJlc2hXaW5kb3dzKClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgY29ubmVjdGVkLnNldCh0cnVlKVxuICAgICAgICAgICAgICAgICAgICByZWZyZXNoV2luZG93cygpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKVxuICAgICAgICB9LFxuICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAvLyB2YW5pc2hlZCBcdTIxOTIgYW1iZXIgZXZlcnl3aGVyZSB0aGF0IGxpc3RlbnNcbiAgICAgICAgICAgIHByb3h5ID0gbnVsbFxuICAgICAgICAgICAgY29ubmVjdGVkLnNldChmYWxzZSlcbiAgICAgICAgfVxuICAgIClcbn1cbiIsICJpbXBvcnQgXCIuL292ZXJyaWRlcy5qc1wiXG5leHBvcnQgeyBkZWZhdWx0IGFzIEFzdGFsSU8gfSBmcm9tIFwiZ2k6Ly9Bc3RhbElPP3ZlcnNpb249MC4xXCJcbmV4cG9ydCAqIGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vdGltZS5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi9maWxlLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL2dvYmplY3QuanNcIlxuZXhwb3J0IHsgQmluZGluZywgYmluZCB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuZXhwb3J0IHsgVmFyaWFibGUsIGRlcml2ZSB9IGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5cbmV4cG9ydCB7IEdpbyB9XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkRmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBBc3RhbC5yZWFkX2ZpbGUocGF0aCkgfHwgXCJcIlxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZEZpbGVBc3luYyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIEFzdGFsLnJlYWRfZmlsZV9hc3luYyhwYXRoLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwucmVhZF9maWxlX2ZpbmlzaChyZXMpIHx8IFwiXCIpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gICAgQXN0YWwud3JpdGVfZmlsZShwYXRoLCBjb250ZW50KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVGaWxlQXN5bmMocGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBBc3RhbC53cml0ZV9maWxlX2FzeW5jKHBhdGgsIGNvbnRlbnQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC53cml0ZV9maWxlX2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vbml0b3JGaWxlKFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBjYWxsYmFjazogKGZpbGU6IHN0cmluZywgZXZlbnQ6IEdpby5GaWxlTW9uaXRvckV2ZW50KSA9PiB2b2lkLFxuKTogR2lvLkZpbGVNb25pdG9yIHtcbiAgICByZXR1cm4gQXN0YWwubW9uaXRvcl9maWxlKHBhdGgsIChmaWxlOiBzdHJpbmcsIGV2ZW50OiBHaW8uRmlsZU1vbml0b3JFdmVudCkgPT4ge1xuICAgICAgICBjYWxsYmFjayhmaWxlLCBldmVudClcbiAgICB9KSFcbn1cbiIsICJpbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcblxuZXhwb3J0IHsgZGVmYXVsdCBhcyBHTGliIH0gZnJvbSBcImdpOi8vR0xpYj92ZXJzaW9uPTIuMFwiXG5leHBvcnQgeyBHT2JqZWN0LCBHT2JqZWN0IGFzIGRlZmF1bHQgfVxuXG5jb25zdCBtZXRhID0gU3ltYm9sKFwibWV0YVwiKVxuY29uc3QgcHJpdiA9IFN5bWJvbChcInByaXZcIilcblxuY29uc3QgeyBQYXJhbVNwZWMsIFBhcmFtRmxhZ3MgfSA9IEdPYmplY3RcblxuY29uc3Qga2ViYWJpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxLSQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJfXCIsIFwiLVwiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbnR5cGUgU2lnbmFsRGVjbGFyYXRpb24gPSB7XG4gICAgZmxhZ3M/OiBHT2JqZWN0LlNpZ25hbEZsYWdzXG4gICAgYWNjdW11bGF0b3I/OiBHT2JqZWN0LkFjY3VtdWxhdG9yVHlwZVxuICAgIHJldHVybl90eXBlPzogR09iamVjdC5HVHlwZVxuICAgIHBhcmFtX3R5cGVzPzogQXJyYXk8R09iamVjdC5HVHlwZT5cbn1cblxudHlwZSBQcm9wZXJ0eURlY2xhcmF0aW9uID1cbiAgICB8IEluc3RhbmNlVHlwZTx0eXBlb2YgR09iamVjdC5QYXJhbVNwZWM+XG4gICAgfCB7ICRndHlwZTogR09iamVjdC5HVHlwZSB9XG4gICAgfCB0eXBlb2YgU3RyaW5nXG4gICAgfCB0eXBlb2YgTnVtYmVyXG4gICAgfCB0eXBlb2YgQm9vbGVhblxuICAgIHwgdHlwZW9mIE9iamVjdFxuXG50eXBlIEdPYmplY3RDb25zdHJ1Y3RvciA9IHtcbiAgICBbbWV0YV0/OiB7XG4gICAgICAgIFByb3BlcnRpZXM/OiB7IFtrZXk6IHN0cmluZ106IEdPYmplY3QuUGFyYW1TcGVjIH1cbiAgICAgICAgU2lnbmFscz86IHsgW2tleTogc3RyaW5nXTogR09iamVjdC5TaWduYWxEZWZpbml0aW9uIH1cbiAgICB9XG4gICAgbmV3KC4uLmFyZ3M6IGFueVtdKTogYW55XG59XG5cbnR5cGUgTWV0YUluZm8gPSBHT2JqZWN0Lk1ldGFJbmZvPG5ldmVyLCBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9PiwgbmV2ZXI+XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlcihvcHRpb25zOiBNZXRhSW5mbyA9IHt9KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChjbHM6IEdPYmplY3RDb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zdCB0ID0gb3B0aW9ucy5UZW1wbGF0ZVxuICAgICAgICBpZiAodHlwZW9mIHQgPT09IFwic3RyaW5nXCIgJiYgIXQuc3RhcnRzV2l0aChcInJlc291cmNlOi8vXCIpICYmICF0LnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpKSB7XG4gICAgICAgICAgICAvLyBhc3N1bWUgeG1sIHRlbXBsYXRlXG4gICAgICAgICAgICBvcHRpb25zLlRlbXBsYXRlID0gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHQpXG4gICAgICAgIH1cblxuICAgICAgICBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3Moe1xuICAgICAgICAgICAgU2lnbmFsczogeyAuLi5jbHNbbWV0YV0/LlNpZ25hbHMgfSxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHsgLi4uY2xzW21ldGFdPy5Qcm9wZXJ0aWVzIH0sXG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB9LCBjbHMpXG5cbiAgICAgICAgZGVsZXRlIGNsc1ttZXRhXVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHByb3BlcnR5KGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uID0gT2JqZWN0KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgcHJvcDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSB7XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXSA/Pz0ge31cbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXMgPz89IHt9XG5cbiAgICAgICAgY29uc3QgbmFtZSA9IGtlYmFiaWZ5KHByb3ApXG5cbiAgICAgICAgaWYgKCFkZXNjKSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBwcm9wLCB7XG4gICAgICAgICAgICAgICAgZ2V0KCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1twcml2XT8uW3Byb3BdID8/IGRlZmF1bHRWYWx1ZShkZWNsYXJhdGlvbilcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHNldCh2OiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHYgIT09IHRoaXNbcHJvcF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJpdl0gPz89IHt9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzW3ByaXZdW3Byb3BdID0gdlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5ub3RpZnkobmFtZSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgc2V0XyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlKHY6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzW3Byb3BdID0gdlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgZ2V0XyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1twcm9wXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllc1trZWJhYmlmeShwcm9wKV0gPSBwc3BlYyhuYW1lLCBQYXJhbUZsYWdzLlJFQURXUklURSwgZGVjbGFyYXRpb24pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsZXQgZmxhZ3MgPSAwXG4gICAgICAgICAgICBpZiAoZGVzYy5nZXQpIGZsYWdzIHw9IFBhcmFtRmxhZ3MuUkVBREFCTEVcbiAgICAgICAgICAgIGlmIChkZXNjLnNldCkgZmxhZ3MgfD0gUGFyYW1GbGFncy5XUklUQUJMRVxuXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllc1trZWJhYmlmeShwcm9wKV0gPSBwc3BlYyhuYW1lLCBmbGFncywgZGVjbGFyYXRpb24pXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoLi4ucGFyYW1zOiBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdD4pOlxuKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikgPT4gdm9pZFxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKGRlY2xhcmF0aW9uPzogU2lnbmFsRGVjbGFyYXRpb24pOlxuKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikgPT4gdm9pZFxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKFxuICAgIGRlY2xhcmF0aW9uPzogU2lnbmFsRGVjbGFyYXRpb24gfCB7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdCxcbiAgICAuLi5wYXJhbXM6IEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0PlxuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpIHtcbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdID8/PSB7fVxuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFscyA/Pz0ge31cblxuICAgICAgICBjb25zdCBuYW1lID0ga2ViYWJpZnkoc2lnbmFsKVxuXG4gICAgICAgIGlmIChkZWNsYXJhdGlvbiB8fCBwYXJhbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBUT0RPOiB0eXBlIGFzc2VydFxuICAgICAgICAgICAgY29uc3QgYXJyID0gW2RlY2xhcmF0aW9uLCAuLi5wYXJhbXNdLm1hcCh2ID0+IHYuJGd0eXBlKVxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHNbbmFtZV0gPSB7XG4gICAgICAgICAgICAgICAgcGFyYW1fdHlwZXM6IGFycixcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzW25hbWVdID0gZGVjbGFyYXRpb24gfHwge1xuICAgICAgICAgICAgICAgIHBhcmFtX3R5cGVzOiBbXSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZGVzYykge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgc2lnbmFsLCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQobmFtZSwgLi4uYXJncylcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IG9nOiAoKC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkKSA9IGRlc2MudmFsdWVcbiAgICAgICAgICAgIGRlc2MudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG5vdCB0eXBlZFxuICAgICAgICAgICAgICAgIHRoaXMuZW1pdChuYW1lLCAuLi5hcmdzKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYG9uXyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9nLmFwcGx5KHRoaXMsIGFyZ3MpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBzcGVjKG5hbWU6IHN0cmluZywgZmxhZ3M6IG51bWJlciwgZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24pIHtcbiAgICBpZiAoZGVjbGFyYXRpb24gaW5zdGFuY2VvZiBQYXJhbVNwZWMpXG4gICAgICAgIHJldHVybiBkZWNsYXJhdGlvblxuXG4gICAgc3dpdGNoIChkZWNsYXJhdGlvbikge1xuICAgICAgICBjYXNlIFN0cmluZzpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuc3RyaW5nKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBcIlwiKVxuICAgICAgICBjYXNlIE51bWJlcjpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuZG91YmxlKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCAtTnVtYmVyLk1BWF9WQUxVRSwgTnVtYmVyLk1BWF9WQUxVRSwgMClcbiAgICAgICAgY2FzZSBCb29sZWFuOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5ib29sZWFuKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBmYWxzZSlcbiAgICAgICAgY2FzZSBPYmplY3Q6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmpzb2JqZWN0KG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzKVxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBtaXNzdHlwZWRcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMub2JqZWN0KG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBkZWNsYXJhdGlvbi4kZ3R5cGUpXG4gICAgfVxufVxuXG5mdW5jdGlvbiBkZWZhdWx0VmFsdWUoZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24pIHtcbiAgICBpZiAoZGVjbGFyYXRpb24gaW5zdGFuY2VvZiBQYXJhbVNwZWMpXG4gICAgICAgIHJldHVybiBkZWNsYXJhdGlvbi5nZXRfZGVmYXVsdF92YWx1ZSgpXG5cbiAgICBzd2l0Y2ggKGRlY2xhcmF0aW9uKSB7XG4gICAgICAgIGNhc2UgU3RyaW5nOlxuICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgY2FzZSBOdW1iZXI6XG4gICAgICAgICAgICByZXR1cm4gMFxuICAgICAgICBjYXNlIEJvb2xlYW46XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgY2FzZSBPYmplY3Q6XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuICAgIH1cbn1cbiIsICIvLyBEZWZlcnJlZCwgbm9uLWJsb2NraW5nIEFzdGFsTm90aWZkIGFjY2Vzcy4gZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYSBoZWFkbGVzcyBvclxuLy8gY29udGVuZGVkIHNlc3Npb24gYnVzIChpdCB0cmllcyB0byBiZWNvbWUgb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnMgYW5kIHdhaXRzKSxcbi8vIHNvIHdlIE5FVkVSIHRvdWNoIGl0IGR1cmluZyB3aWRnZXQgY29uc3RydWN0aW9uLiBpbml0KCkgaXMgY2FsbGVkIG9uY2UgZnJvbSBhbiBpZGxlXG4vLyBhZnRlciB0aGUgc2hlbGwgaXMgbWFwcGVkOyBvbiByZWFsIGhhcmR3YXJlIGl0IHJldHVybnMgZmFzdCwgaW4gdGhlIHN0cmlwcGVkIGRldmtpdFxuLy8gaXQgbWF5IG5vLW9wLiBXaWRnZXRzIGJpbmQgdG8gYHVucmVhZGAvYGxpc3RgIGFuZCBoeWRyYXRlIHdoZW4gaXQgbGFuZHMuXG5pbXBvcnQgeyBWYXJpYWJsZSwgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcbi8vIEltcG9ydGluZyB0aGUgdHlwZWxpYiBpcyBjaGVhcCArIG5vbi1ibG9ja2luZzsgb25seSBnZXRfZGVmYXVsdCgpIG1heSBibG9jayAoaXQgdHJpZXNcbi8vIHRvIGJlY29tZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyksIHNvIHdlIGNhbGwgVEhBVCBsYXppbHkgZnJvbSBhbiBpZGxlLiBUaGUgb2xkXG4vLyBgaW1wb3J0cy5naS5Bc3RhbE5vdGlmZGAgdGhyb3dzIHVuZGVyIGBnanMgLW1gIChFU00gaGFzIG5vIGxlZ2FjeSBgaW1wb3J0c2AgZ2xvYmFsKS5cbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuXG5leHBvcnQgY29uc3QgdW5yZWFkID0gVmFyaWFibGUoMClcbmV4cG9ydCBjb25zdCByZWFkeSA9IFZhcmlhYmxlKGZhbHNlKVxubGV0IG46IE5vdGlmZC5Ob3RpZmQgfCBudWxsID0gbnVsbFxuXG5leHBvcnQgZnVuY3Rpb24gbm90aWZkKCkge1xuICAgIHJldHVybiBuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0KCkge1xuICAgIC8vIGdldGVudiByZXR1cm5zIFwiXCIgKGZhbHN5KSB3aGVuIHRoZSB2YXIgaXMgc2V0LWJ1dC1lbXB0eSwgbnVsbCB3aGVuIHVuc2V0IFx1MjAxNCBib3RoIHNraXBcbiAgICAvLyBjb3JyZWN0bHkgb25seSB3aGVuIHRoZSB2YWx1ZSBpcyB0cnV0aHkgKFwiMVwiKS5cbiAgICBpZiAoR0xpYi5nZXRlbnYoXCJLT0JFTF9TS0lQX05PVElGRFwiKSkgcmV0dXJuXG4gICAgLy8gZGVmZXIgcGFzdCBmaXJzdCBwYWludDsgaWYgZ2V0X2RlZmF1bHQgYmxvY2tzLCBpdCBibG9ja3Mgb25seSB0aGlzIGlkbGUgdGljayxcbiAgICAvLyBuZXZlciBjb25zdHJ1Y3Rpb24vZmlyc3QgcmVuZGVyLlxuICAgIHRpbWVvdXQoNTAsICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG4gPSBOb3RpZmQuZ2V0X2RlZmF1bHQoKVxuICAgICAgICAgICAgcmVhZHkuc2V0KHRydWUpXG4gICAgICAgICAgICBjb25zdCBzeW5jID0gKCkgPT4gdW5yZWFkLnNldChuIS5ub3RpZmljYXRpb25zLmxlbmd0aClcbiAgICAgICAgICAgIG4uY29ubmVjdChcIm5vdGlmaWVkXCIsIHN5bmMpXG4gICAgICAgICAgICBuLmNvbm5lY3QoXCJyZXNvbHZlZFwiLCBzeW5jKVxuICAgICAgICAgICAgc3luYygpXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogbm90aWZkIGluaXQgc2tpcHBlZDogJHtlfWApXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgIi8vIEdUSyB3aWRnZXQtdHJlZSBnZW9tZXRyeSBkdW1wZXIgXHUyMDE0IHRoZSBtaXJyb3Igb2YgdGhlIERPTSdzIGdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLlxuLy8gV2Fsa3MgYSBtYXBwZWQgd2luZG93IGFuZCByZWNvcmRzIGV2ZXJ5IHdpZGdldCdzIHJlYWwgYWxsb2NhdGlvbiAoeC95L3cvaCByZWxhdGl2ZVxuLy8gdG8gdGhlIHdpbmRvdyBjb250ZW50KSArIENTUyBjbGFzc2VzICsgdGV4dCwgc28gYSByZW5kZXJlZCBHVEsgc3VyZmFjZSBjYW4gYmUgZGlmZmVkXG4vLyAxOjEgYWdhaW5zdCB0aGUgcHJvdG90eXBlIERPTS4gR2F0ZWQgYnkgS09CRUxfRFVNUD08d2luZG93PiBpbiBhcHAudHMuXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3JhcGhlbmUgZnJvbSBcImdpOi8vR3JhcGhlbmVcIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgTm9kZSB7XG4gICAgZDogbnVtYmVyXG4gICAgdHlwZTogc3RyaW5nXG4gICAgY2xzOiBzdHJpbmdcbiAgICB4OiBudW1iZXJcbiAgICB5OiBudW1iZXJcbiAgICB3OiBudW1iZXJcbiAgICBoOiBudW1iZXJcbiAgICB0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGR1bXBXaW5kb3cod2luOiBHdGsuV2luZG93KTogTm9kZVtdIHtcbiAgICBjb25zdCBvdXQ6IE5vZGVbXSA9IFtdXG4gICAgY29uc3Qgcm9vdDogYW55ID0gd2luXG4gICAgY29uc3Qgd2FsayA9ICh3OiBhbnksIGRlcHRoOiBudW1iZXIpID0+IHtcbiAgICAgICAgLy8gY29tcHV0ZV9ib3VuZHMgZ2l2ZXMgdGhlIHdpZGdldCdzIEZVTEwgcmVuZGVyZWQgcmVjdCAoaW5jbC4gaXRzIG93biBwYWRkaW5nKSBpblxuICAgICAgICAvLyB0aGUgcm9vdCdzIGNvb3JkcyBcdTIwMTQgbW9yZSByZWxpYWJsZSB0aGFuIGNvbXB1dGVfcG9pbnQgKyBnZXRfd2lkdGggKHdoaWNoIGNhbiByZXBvcnRcbiAgICAgICAgLy8gdGhlIGNoaWxkL2NvbnRlbnQgc2l6ZSBmb3IgcGFkZGVkIGJ1dHRvbnMpLlxuICAgICAgICBsZXQgeCA9IDAsXG4gICAgICAgICAgICB5ID0gMCxcbiAgICAgICAgICAgIHdpZHRoID0gMCxcbiAgICAgICAgICAgIGhlaWdodCA9IDBcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHJlcyA9IHcuY29tcHV0ZV9ib3VuZHMocm9vdClcbiAgICAgICAgICAgIGNvbnN0IHJlY3QgPSBBcnJheS5pc0FycmF5KHJlcykgPyByZXNbMV0gOiByZXNcbiAgICAgICAgICAgIGlmIChyZWN0KSB7XG4gICAgICAgICAgICAgICAgeCA9IHJlY3Qub3JpZ2luLnhcbiAgICAgICAgICAgICAgICB5ID0gcmVjdC5vcmlnaW4ueVxuICAgICAgICAgICAgICAgIHdpZHRoID0gcmVjdC5zaXplLndpZHRoXG4gICAgICAgICAgICAgICAgaGVpZ2h0ID0gcmVjdC5zaXplLmhlaWdodFxuICAgICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgIGlmICghd2lkdGgpIHtcbiAgICAgICAgICAgIHdpZHRoID0gdy5nZXRfd2lkdGg/LigpID8/IDBcbiAgICAgICAgICAgIGhlaWdodCA9IHcuZ2V0X2hlaWdodD8uKCkgPz8gMFxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGNscyA9ICh3LmdldF9jc3NfY2xhc3Nlcz8uKCkgPz8gW10pLmpvaW4oXCIuXCIpXG4gICAgICAgIGNvbnN0IHR5cGUgPSAody5jb25zdHJ1Y3Rvcj8ubmFtZSA/PyBcIj9cIikucmVwbGFjZSgvXy9nLCBcIlwiKVxuICAgICAgICBsZXQgdCA9IFwiXCJcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHQgPSAody5nZXRfbGFiZWw/LigpID8/IHcuZ2V0X3RleHQ/LigpID8/IFwiXCIpLnRvU3RyaW5nKCkuc2xpY2UoMCwgMjgpXG4gICAgICAgIH0gY2F0Y2gge31cbiAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgZDogZGVwdGgsXG4gICAgICAgICAgICB0eXBlLFxuICAgICAgICAgICAgY2xzLFxuICAgICAgICAgICAgeDogTWF0aC5yb3VuZCh4KSxcbiAgICAgICAgICAgIHk6IE1hdGgucm91bmQoeSksXG4gICAgICAgICAgICB3OiBNYXRoLnJvdW5kKHdpZHRoKSxcbiAgICAgICAgICAgIGg6IE1hdGgucm91bmQoaGVpZ2h0KSxcbiAgICAgICAgICAgIHQsXG4gICAgICAgIH0pXG4gICAgICAgIGxldCBjID0gdy5nZXRfZmlyc3RfY2hpbGQ/LigpXG4gICAgICAgIHdoaWxlIChjKSB7XG4gICAgICAgICAgICB3YWxrKGMsIGRlcHRoICsgMSlcbiAgICAgICAgICAgIGMgPSBjLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGNoaWxkID0gd2luLmdldF9jaGlsZD8uKClcbiAgICBpZiAoY2hpbGQpIHdhbGsoY2hpbGQsIDApXG4gICAgcmV0dXJuIG91dFxufVxuXG4vLyBQb2xsIHVudGlsIHRoZSBuYW1lZCB3aW5kb3cgaXMgdmlzaWJsZSArIGxhaWQgb3V0LCB0aGVuIGR1bXAgb25jZSB0byBLT0JFTF9EVU1QX09VVC5cbmV4cG9ydCBmdW5jdGlvbiBhcm1EdW1wKGdldFdpbmRvdzogKG5hbWU6IHN0cmluZykgPT4gR3RrLldpbmRvdyB8IG51bGwpIHtcbiAgICBjb25zdCBuYW1lID0gR0xpYi5nZXRlbnYoXCJLT0JFTF9EVU1QXCIpXG4gICAgaWYgKCFuYW1lKSByZXR1cm5cbiAgICBjb25zdCBwYXRoID0gR0xpYi5nZXRlbnYoXCJLT0JFTF9EVU1QX09VVFwiKSB8fCBcIi90bXAva29iZWwtZHVtcC5qc29uXCJcbiAgICBsZXQgZG9uZSA9IGZhbHNlXG4gICAgR0xpYi50aW1lb3V0X2FkZChHTGliLlBSSU9SSVRZX0RFRkFVTFQsIDQwMCwgKCkgPT4ge1xuICAgICAgICBpZiAoZG9uZSkgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgICAgICBjb25zdCB3ID0gZ2V0V2luZG93KG5hbWUpXG4gICAgICAgIGlmICh3ICYmIHcuZ2V0X21hcHBlZD8uKCkgJiYgKHcuZ2V0X3dpZHRoPy4oKSA/PyAwKSA+IDApIHtcbiAgICAgICAgICAgIC8vIG9uZSBtb3JlIHRpY2sgc28gZmluYWwgYWxsb2NhdGlvbiBzZXR0bGVzXG4gICAgICAgICAgICBHTGliLnRpbWVvdXRfYWRkKEdMaWIuUFJJT1JJVFlfREVGQVVMVCwgMjUwLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdHJlZSA9IGR1bXBXaW5kb3codylcbiAgICAgICAgICAgICAgICAgICAgR0xpYi5maWxlX3NldF9jb250ZW50cyhwYXRoLCBKU09OLnN0cmluZ2lmeSh0cmVlKSlcbiAgICAgICAgICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBkdW1wZWQgJHt0cmVlLmxlbmd0aH0gd2lkZ2V0cyBvZiBcIiR7bmFtZX1cIiBcdTIxOTIgJHtwYXRofWApXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICBwcmludGVycihga29iZWw6IGR1bXAgZmFpbGVkOiAke2V9YClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIGRvbmUgPSB0cnVlXG4gICAgICAgICAgICByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX0NPTlRJTlVFXG4gICAgfSlcbn1cbiIsICIvLyBBbmltYXRlZCBzdXJmYWNlIHJlZ2lzdHJ5IFx1MjAxNCByZXBsYWNlcyBBcHAudG9nZ2xlX3dpbmRvdyBmb3Igc3VyZmFjZXMgdGhhdCB3YW50XG4vLyBhIHJldmVhbCBhbmltYXRpb24uIEVhY2ggc3VyZmFjZSBjYWxscyByZWdpc3RlcigpIG9uY2UsIHRoZW4gQmFyL2FwcC50cyBjYWxsIHRvZ2dsZSgpLlxuLy9cbi8vIFBhdHRlcm46IHdpbmRvdyBhbHdheXMgc3RhcnRzIGhpZGRlbiAodmlzaWJsZT1mYWxzZSkuIE9wZW5pbmcgbWFrZXMgaXQgdmlzaWJsZSxcbi8vIHRoZW4gdHJpZ2dlcnMgdGhlIHJldmVhbGVyOyBjbG9zaW5nIHRyaWdnZXJzIHRoZSByZXZlYWxlciB0aGVuIGhpZGVzIGFmdGVyIHRyYW5zaXRpb24uXG5pbXBvcnQgeyBBcHAgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5cbmV4cG9ydCB0eXBlIFRyYW5zaXRpb25UeXBlID0gR3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGVcblxuY29uc3QgcmVnaXN0cnk6IFJlY29yZDxzdHJpbmcsICgpID0+IHZvaWQ+ID0ge31cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyKG5hbWU6IHN0cmluZywgZm46ICgpID0+IHZvaWQpIHtcbiAgICByZWdpc3RyeVtuYW1lXSA9IGZuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b2dnbGUobmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKHJlZ2lzdHJ5W25hbWVdKSB7XG4gICAgICAgIHJlZ2lzdHJ5W25hbWVdKClcbiAgICB9IGVsc2Uge1xuICAgICAgICAvLyBGYWxsYmFjayBmb3Igc3VyZmFjZXMgd2l0aG91dCBhbmltYXRlZCByZXZlYWxzIChzZXNzaW9uLCBkcmF3ZXIpXG4gICAgICAgIEFwcC50b2dnbGVfd2luZG93KG5hbWUpXG4gICAgfVxufVxuXG4vLyBtYWtlUmV2ZWFsOiBjcmVhdGVzIHRoZSBzdGF0ZSB2YXJpYWJsZXMgYW5kIHRvZ2dsZSBmdW5jdGlvbiBmb3IgYW4gYW5pbWF0ZWQgc3VyZmFjZS5cbi8vICAgLSBvcGVuTXM6IHJldmVhbC1pbiBkdXJhdGlvbiBpbiBtcyAoZGVmYXVsdCAyMjApXG4vLyAgIC0gY2xvc2VNczogcmV2ZWFsLW91dCArIHdpbmRvdy1oaWRlIGRlbGF5IGluIG1zIChkZWZhdWx0IDE1MClcbi8vICAgLSByZXZlYWxlclJlZjogc2V0IHRoaXMgdG8gdGhlIFJldmVhbGVyIHdpZGdldCBpbiBgc2V0dXBgIHNvIHRoZSB0b2dnbGUgY2FuXG4vLyAgICAgZGlyZWN0bHkgY29udHJvbCB0cmFuc2l0aW9uRHVyYXRpb24gcGVyIGRpcmVjdGlvblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSZXZlYWwob3Blbk1zID0gMjIwLCBjbG9zZU1zID0gMTUwKSB7XG4gICAgY29uc3Qgd2luVmlzaWJsZSA9IFZhcmlhYmxlKGZhbHNlKVxuICAgIGNvbnN0IHJldmVhbGVkID0gVmFyaWFibGUoZmFsc2UpXG4gICAgbGV0IHJldmVhbGVyV2lkZ2V0OiBHdGsuUmV2ZWFsZXIgfCBudWxsID0gbnVsbFxuICAgIGxldCBjbG9zZVRpbWVyOiBhbnkgPSBudWxsXG5cbiAgICBjb25zdCBzZXRSZXZlYWxlciA9IChyOiBHdGsuUmV2ZWFsZXIpID0+IHtcbiAgICAgICAgcmV2ZWFsZXJXaWRnZXQgPSByXG4gICAgfVxuXG4gICAgY29uc3Qgb3BlbiA9ICgpID0+IHtcbiAgICAgICAgaWYgKGNsb3NlVGltZXIpIHtcbiAgICAgICAgICAgIGNsb3NlVGltZXIuY2FuY2VsPy4oKVxuICAgICAgICAgICAgY2xvc2VUaW1lciA9IG51bGxcbiAgICAgICAgfVxuICAgICAgICBpZiAocmV2ZWFsZXJXaWRnZXQpIHJldmVhbGVyV2lkZ2V0LnRyYW5zaXRpb25EdXJhdGlvbiA9IG9wZW5Nc1xuICAgICAgICB3aW5WaXNpYmxlLnNldCh0cnVlKVxuICAgICAgICAvLyBPbmUgaWRsZSBmcmFtZSBzbyBHVEsgY2FuIHJlYWxpemUgdGhlIHdpbmRvdyBiZWZvcmUgYW5pbWF0aW5nXG4gICAgICAgIHRpbWVvdXQoMTYsICgpID0+IHJldmVhbGVkLnNldCh0cnVlKSlcbiAgICB9XG5cbiAgICBjb25zdCBjbG9zZSA9ICgpID0+IHtcbiAgICAgICAgaWYgKHJldmVhbGVyV2lkZ2V0KSByZXZlYWxlcldpZGdldC50cmFuc2l0aW9uRHVyYXRpb24gPSBjbG9zZU1zXG4gICAgICAgIHJldmVhbGVkLnNldChmYWxzZSlcbiAgICAgICAgY2xvc2VUaW1lciA9IHRpbWVvdXQoY2xvc2VNcyArIDIwLCAoKSA9PiB7XG4gICAgICAgICAgICB3aW5WaXNpYmxlLnNldChmYWxzZSlcbiAgICAgICAgICAgIGNsb3NlVGltZXIgPSBudWxsXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgdG9nZ2xlRm4gPSAoKSA9PiAocmV2ZWFsZWQuZ2V0KCkgPyBjbG9zZSgpIDogb3BlbigpKVxuXG4gICAgcmV0dXJuIHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBvcGVuLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9XG59XG4iLCAiLy8gVGhlIGJhci4gUHJvdG90eXBlOiBsYXVuY2hlciBidXR0b24gXHUwMEI3IGZvY3VzZWQgdGl0bGUgXHUwMEI3IGNlbnRlcmVkIGNsb2NrIChcdTIxOTIgY2FsZW5kYXIpXG4vLyBcdTAwQjcgdHJheSBcdTAwQjcgc3RhdHVzIHBpbGwgKHdpZmkvdm9sL2JhdHRlcnk7IGFtYmVyIG5ldC1nbHlwaCB3aGVuIGdub2JsaW4gaXMgZG93bilcbi8vIFx1MDBCNyBiZWxsK2JhZGdlIChcdTIxOTIgZHJhd2VyKSBcdTAwQjcgcG93ZXIgKFx1MjE5MiBzZXNzaW9uKS5cbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEJhdHRlcnkgZnJvbSBcImdpOi8vQXN0YWxCYXR0ZXJ5XCJcbmltcG9ydCBXcCBmcm9tIFwiZ2k6Ly9Bc3RhbFdwXCJcbmltcG9ydCBOZXR3b3JrIGZyb20gXCJnaTovL0FzdGFsTmV0d29ya1wiXG5pbXBvcnQgVHJheSBmcm9tIFwiZ2k6Ly9Bc3RhbFRyYXlcIlxuaW1wb3J0IHsgY29ubmVjdGVkLCB3aW5kb3dzIH0gZnJvbSBcIi4uL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0IHsgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IHsgdW5yZWFkIH0gZnJvbSBcIi4uL3NlcnZpY2VzL25vdGlmZFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcblxuY29uc3QgdGltZSA9IFZhcmlhYmxlKEdMaWIuRGF0ZVRpbWUubmV3X25vd19sb2NhbCgpKS5wb2xsKDEwXzAwMCwgKCkgPT5cbiAgICBHTGliLkRhdGVUaW1lLm5ld19ub3dfbG9jYWwoKVxuKVxuXG5mdW5jdGlvbiBGb2N1c2VkVGl0bGUoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICBjbGFzcz1cInRpdGxlXCJcbiAgICAgICAgICAgIGVsbGlwc2l6ZT17MyAvKiBQYW5nby5FbGxpcHNpemVNb2RlLkVORCAqL31cbiAgICAgICAgICAgIG1heFdpZHRoQ2hhcnM9ezI4fVxuICAgICAgICAgICAgbGFiZWw9e1xuICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgPyBELnRpdGxlXG4gICAgICAgICAgICAgICAgICAgIDogYmluZCh3aW5kb3dzKS5hcygod3MpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZiA9IHdzLmZpbmQoKHcpID0+IHcuZm9jdXNlZClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFmKSByZXR1cm4gXCJkZXNrdG9wXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2libGluZ3MgPSB3cy5maWx0ZXIoKHcpID0+IHcuYXBwSWQgPT09IGYuYXBwSWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBzaWJsaW5ncy5sZW5ndGggPiAxXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGAke2YudGl0bGV9IFx1MjAxNCB3aW5kb3cgJHtzaWJsaW5ncy5pbmRleE9mKGYpICsgMX0vJHtzaWJsaW5ncy5sZW5ndGh9YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBmLnRpdGxlXG4gICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgLz5cbiAgICApXG59XG5cbmZ1bmN0aW9uIFN0YXR1c1BpbGwoKSB7XG4gICAgY29uc3Qgc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG4gICAgY29uc3QgbmV0ID0gTmV0d29yay5nZXRfZGVmYXVsdCgpXG4gICAgY29uc3QgYmF0ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpXG4gICAgLy8gV2lmaSBpY29uOiB2YXJpZXMgd2l0aCBjb25uZWN0aW9uIHN0YXRlIC8gdHlwZVxuICAgIGNvbnN0IHdpZmlJY29uID0gbmV0LndpZmlcbiAgICAgICAgPyBiaW5kKG5ldC53aWZpLCBcImVuYWJsZWRcIikuYXMoKG9uKSA9PlxuICAgICAgICAgICAgICBvbiA/IFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIDogXCJrb2JlbC13aWZpLW9mZi1zeW1ib2xpY1wiXG4gICAgICAgICAgKVxuICAgICAgICA6IFwia29iZWwtd2lmaS1vZmYtc3ltYm9saWNcIlxuICAgIC8vIFZvbHVtZSBpY29uOiB0cmFjayB0aGUgc3BlYWtlcidzIG93biB2b2x1bWVfaWNvbiBwcm9wZXJ0eVxuICAgIGNvbnN0IHZvbEljb24gPSBzcGVha2VyXG4gICAgICAgID8gYmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpLmFzKChpKSA9PiBpID8/IFwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIpXG4gICAgICAgIDogXCJrb2JlbC1zcGVha2VyLW11dGUtc3ltYm9saWNcIlxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgIGNsYXNzPXtiaW5kKGNvbm5lY3RlZCkuYXMoKGMpID0+IChjID8gXCJzdGF0dXNcIiA6IFwic3RhdHVzIGVyclwiKSl9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJxdWlja3NldHRpbmdzXCIpfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgY2xhc3M9XCJuZXQtaWNvblwiIGljb25OYW1lPXt3aWZpSWNvbn0gLz5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3ZvbEljb259IC8+XG4gICAgICAgICAgICAgICAgey8qIEJhdHRlcnk6IG9ubHkgcmVuZGVyZWQgd2hlbiBhIGJhdHRlcnkgaXMgcHJlc2VudCAqL31cbiAgICAgICAgICAgICAgICB7KERFTU8gfHwgYmF0KSAmJiAoXG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJwY3RcIiBzcGFjaW5nPXs2fT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJhdHRlcnktc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IEQuYmF0dGVyeVBjdFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiYXRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBiaW5kKGJhdCwgXCJwZXJjZW50YWdlXCIpLmFzKChwKSA9PiBgJHtNYXRoLnJvdW5kKHAgKiAxMDApfSVgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgIClcbn1cblxuZnVuY3Rpb24gQmVsbCgpIHtcbiAgICAvLyBCYWRnZSBoeWRyYXRlcyBvbmNlIG5vdGlmZCBpcyBhdmFpbGFibGUgKGRlZmVycmVkIFx1MjAxNCBnZXRfZGVmYXVsdCgpIGNhbiBibG9jayBvbiBhXG4gICAgLy8gaGVhZGxlc3MvY29udGVuZGVkIGJ1czsgbmV2ZXIgY2FsbCBpdCBkdXJpbmcgY29uc3RydWN0aW9uKS4gdW5yZWFkKCkgaXMgYSBwbGFpblxuICAgIC8vIFZhcmlhYmxlIGFuIGFzeW5jIGluaXQgZmlsbHMgaW4uXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJpYnRuIGJlbGxcIlxuICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwiZHJhd2VyXCIpfVxuICAgICAgICA+XG4gICAgICAgICAgICA8b3ZlcmxheT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1iZWxsLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgdHlwZT1cIm92ZXJsYXlcIlxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImJhZGdlIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17REVNTyA/IHRydWUgOiBiaW5kKHVucmVhZCkuYXMoKG4pID0+IG4gPiAwKX1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBcIjFcIiA6IGJpbmQodW5yZWFkKS5hcygobikgPT4gKG4gPiA5ID8gXCI5K1wiIDogYCR7bn1gKSl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBCYXIobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBjb25zdCB7IFRPUCwgTEVGVCwgUklHSFQgfSA9IEFzdGFsLldpbmRvd0FuY2hvclxuICAgIC8vIEZsb2F0aW5nIGJhcjogbGF5ZXItc2hlbGwgbWFyZ2lucyBpbnNldCBpdCBmcm9tIHRoZSBlZGdlczsgdGhlIC5iYXIgY2hpbGQgaXMgdGhlXG4gICAgLy8gcm91bmRlZCBzdXJmYWNlLiBFeGNsdXNpdmUgc28gdGlsZWQgd2luZG93cyByZXNwZWN0IGl0ICh6b25lID0gbWFyZ2luICsgaGVpZ2h0KS5cbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwiYmFyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWJhclwiXG4gICAgICAgICAgICBjbGFzcz1cImJhci13aW5kb3dcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5FWENMVVNJVkV9XG4gICAgICAgICAgICBtYXJnaW5Ub3A9ezEwfVxuICAgICAgICAgICAgbWFyZ2luTGVmdD17MTJ9XG4gICAgICAgICAgICBtYXJnaW5SaWdodD17MTJ9XG4gICAgICAgICAgICBhbmNob3I9e1RPUCB8IExFRlQgfCBSSUdIVH1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGNlbnRlcmJveCBjbGFzcz1cImJhclwiPlxuICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17NH0+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJsYXVuY2hlclwiKX1cbiAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbWFnbmlmeWluZy1nbGFzcy1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8Rm9jdXNlZFRpdGxlIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImJjZW50ZXJcIlxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcImNhbGVuZGFyXCIpfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiY2xvY2sgdG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkJBU0VMSU5FfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtERU1PID8gRC5jbG9jayA6IGJpbmQodGltZSkuYXMoKHQpID0+IHQuZm9ybWF0KFwiJUg6JU1cIikhKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImRhdGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkJBU0VMSU5FfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtERU1PID8gRC5kYXRlIDogYmluZCh0aW1lKS5hcygodCkgPT4gdC5mb3JtYXQoXCIlYSAlLWQgJWJcIikhKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17NH0+XG4gICAgICAgICAgICAgICAgICAgIHtERU1PID8gKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxfSBtYXJnaW5FbmQ9ezN9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHRpcFRleHQ9XCJEaXNjb3JkXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoYXQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHRpcFRleHQ9XCJTdGVhbVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1nYW1lLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0biB0cmF5LWljb25cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2x0aXBUZXh0PVwiVGVsZWdyYW1cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcGFwZXItcGxhbmUtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuIHRyYXktbGFuZyB0blwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cImVuXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgYmluZChUcmF5LmdldF9kZWZhdWx0KCksIFwiaXRlbXNcIikuYXMoKGl0ZW1zKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zLm1hcCgoaXRlbSkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bWVudWJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHRpcFRleHQ9e2l0ZW0udG9vbHRpcF9tYXJrdXB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZW51TW9kZWw9e2l0ZW0ubWVudV9tb2RlbH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGdpY29uPXtiaW5kKGl0ZW0sIFwiZ2ljb25cIil9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvbWVudWJ1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApKVxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8U3RhdHVzUGlsbCAvPlxuICAgICAgICAgICAgICAgICAgICA8QmVsbCAvPlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKX1cbiAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gRGVtby1kYXRhIG1vZGUgKEtPQkVMX0RFTU89MSk6IG1ha2UgZXZlcnkgc3VyZmFjZSByZW5kZXIgdGhlIEVYQUNUIG1vY2sgdmFsdWVzIGZyb21cbi8vIGRvY3MvcHJvdG90eXBlLmh0bWwsIHNvIGFuIEFHUyByZW5kZXIgY2FuIGJlIHBpeGVsLW92ZXJsYWlkIG9uIHRoZSBwcm90b3R5cGUgcmVuZGVyXG4vLyBmb3IgYSBmYWlyIDE6MSBjb21wYXJpc29uLiBUaGlzIGlzIE5PVCBjaGVhdGluZyBcdTIwMTQgcmVhbCBHVEsgd2lkZ2V0cywgcmVhbCByZW5kZXJpbmc7XG4vLyBvbmx5IHRoZSAqY29udGVudCogaXMgcGlubmVkIHRvIHRoZSBwcm90b3R5cGUncyBzbyB0aGUgY2hyb21lIGNhbiBiZSBkaWZmZWQgZGlyZWN0bHkuXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcblxuZXhwb3J0IGNvbnN0IERFTU8gPSAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfREVNT1wiKVxuXG4vLyBWYWx1ZXMgdHJhbnNjcmliZWQgZnJvbSBwcm90b3R5cGUuaHRtbCdzIG1vY2sgc3RhdGUgKHRoZSByZWZlcmVuY2Ugc2NyZWVuc2hvdHMpLlxuZXhwb3J0IGNvbnN0IEQgPSB7XG4gICAgLy8gYmFyIFx1MjAxNCBtYXRjaCBwcm90b3R5cGUuaHRtbCBtb2NrIHN0YXRlIGV4YWN0bHlcbiAgICBjbG9jazogXCIxMDo0MlwiLFxuICAgIGRhdGU6IFwiRnJpIDMgSnVsXCIsXG4gICAgdGl0bGU6IFwiVGVybWluYWwgXHUyMDE0IHdpbmRvdyAxLzJcIixcbiAgICBiYXR0ZXJ5UGN0OiBcIjEwMCVcIixcbiAgICAvLyBxdWljayBzZXR0aW5nc1xuICAgIG1ldGE6IFwiMTAwJSBcdTAwQjcgRnVsbHkgY2hhcmdlZFwiLFxuICAgIHdpZmlTc2lkOiBcImNob21wZXJzLTVHXCIsXG4gICAgYnREZXZpY2U6IFwiV0gtMTAwMFhNNVwiLFxuICAgIHZvbHVtZTogMC42NzUsIC8vIHRyb3VnaCA1MS4uMjg1IHdpZHRoPTIzNDsga25vYj0oMjA5LTUxKS8yMzQ9MC42NzUgXHUyMTkyIHhcdTIyNDgyMDkgbWF0Y2hlcyBwcm90b1xuICAgIGJyaWdodG5lc3M6IDAuOCwgLy8gbWVhc3VyZWQ6IEFHUyB0cm91Z2ggMnB4IG5hcnJvd2VyIHRoYW4gcHJvdG87IDAuODAwIGFsaWducyBrbm9iIGNlbnRlclxuICAgIGRhcms6IHRydWUsXG4gICAgc2F2ZTogZmFsc2UsXG4gICAgc2lsZW50OiBmYWxzZSxcbiAgICBuaWdodDogZmFsc2UsXG4gICAgLy8gY2FsZW5kYXIgXHUyMDE0IHBpbm5lZCB0byBwcm90b3R5cGUgZGF0ZSAoRnJpZGF5IDMgSnVseSAyMDI2KVxuICAgIHRvZGF5OiB7IHk6IDIwMjYsIG06IDYgLyogSnVseSwgMC1pbmRleGVkICovLCBkOiAzIH0sIC8vIEZyaWRheSAzIEp1bHkgMjAyNlxuICAgIC8vIGxhdW5jaGVyIHBpbm5lZCB0aWxlcyArIHRvZGF5IHdpZGdldFxuICAgIGFwcHM6IFtcIlRlcm1pbmFsXCIsIFwiRmlsZXNcIiwgXCJGaXJlZm94XCIsIFwiWmVkXCIsIFwiU3BvdGlmeVwiLCBcIlNldHRpbmdzXCJdLFxuICAgIHdpZGdldERhdGU6IFwiRnJpZGF5IDMgSnVseVwiLFxuICAgIHdpZGdldEV2ZW50OiBcIjA5OjQ1IFx1MDBCNyBEYWlseSBTdGFuZHVwXCIsXG4gICAgbWVkaWE6IHsgdGl0bGU6IFwiV2VpZ2h0bGVzc1wiLCBhcnRpc3Q6IFwiTWFyY29uaSBVbmlvblwiIH0sXG4gICAgLy8gcHJvdG90eXBlIGluaXRpYWwgbm90aWZpY2F0aW9uIHN0b3JlIChzdG9yZS5wdXNoIGF0IGxvYWQgdGltZSwgd2hlbjpcIjEwOjM4XCIpXG4gICAgbm90aWZpY2F0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgICBpY29uOiBcImtvYmVsLWxlYWYtc3ltYm9saWNcIixcbiAgICAgICAgICAgIHN1bW1hcnk6IFwiZ25vYmxpblwiLFxuICAgICAgICAgICAgYm9keTogXCJTb2Z0LXJlbG9hZCBjb21wbGV0ZSBcdTIwMTQgNCBleHRlbnNpb25zLCAyIHNjcmlwdHMuIFdpbmRvd3MgdW50b3VjaGVkLlwiLFxuICAgICAgICAgICAgd2hlbjogXCIxMDozOFwiLFxuICAgICAgICB9LFxuICAgIF0sXG59XG4iLCAiaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IHsgdHlwZSBCaW5kYWJsZUNoaWxkIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuaW1wb3J0IHsgbWVyZ2VCaW5kaW5ncywganN4IGFzIF9qc3ggfSBmcm9tIFwiLi4vX2FzdGFsLmpzXCJcbmltcG9ydCAqIGFzIFdpZGdldCBmcm9tIFwiLi93aWRnZXQuanNcIlxuXG5leHBvcnQgZnVuY3Rpb24gRnJhZ21lbnQoeyBjaGlsZHJlbiA9IFtdLCBjaGlsZCB9OiB7XG4gICAgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkXG4gICAgY2hpbGRyZW4/OiBBcnJheTxCaW5kYWJsZUNoaWxkPlxufSkge1xuICAgIGlmIChjaGlsZCkgY2hpbGRyZW4ucHVzaChjaGlsZClcbiAgICByZXR1cm4gbWVyZ2VCaW5kaW5ncyhjaGlsZHJlbilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yOiBrZXlvZiB0eXBlb2YgY3RvcnMgfCB0eXBlb2YgR3RrLldpZGdldCxcbiAgICBwcm9wczogYW55LFxuKSB7XG4gICAgcmV0dXJuIF9qc3goY3RvcnMsIGN0b3IgYXMgYW55LCBwcm9wcylcbn1cblxuY29uc3QgY3RvcnMgPSB7XG4gICAgYm94OiBXaWRnZXQuQm94LFxuICAgIGJ1dHRvbjogV2lkZ2V0LkJ1dHRvbixcbiAgICBjZW50ZXJib3g6IFdpZGdldC5DZW50ZXJCb3gsXG4gICAgLy8gY2lyY3VsYXJwcm9ncmVzczogV2lkZ2V0LkNpcmN1bGFyUHJvZ3Jlc3MsXG4gICAgLy8gZHJhd2luZ2FyZWE6IFdpZGdldC5EcmF3aW5nQXJlYSxcbiAgICBlbnRyeTogV2lkZ2V0LkVudHJ5LFxuICAgIGltYWdlOiBXaWRnZXQuSW1hZ2UsXG4gICAgbGFiZWw6IFdpZGdldC5MYWJlbCxcbiAgICBsZXZlbGJhcjogV2lkZ2V0LkxldmVsQmFyLFxuICAgIG92ZXJsYXk6IFdpZGdldC5PdmVybGF5LFxuICAgIHJldmVhbGVyOiBXaWRnZXQuUmV2ZWFsZXIsXG4gICAgc2xpZGVyOiBXaWRnZXQuU2xpZGVyLFxuICAgIHN0YWNrOiBXaWRnZXQuU3RhY2ssXG4gICAgc3dpdGNoOiBXaWRnZXQuU3dpdGNoLFxuICAgIHdpbmRvdzogV2lkZ2V0LldpbmRvdyxcbiAgICBtZW51YnV0dG9uOiBXaWRnZXQuTWVudUJ1dHRvbixcbiAgICBwb3BvdmVyOiBXaWRnZXQuUG9wb3Zlcixcbn1cblxuZGVjbGFyZSBnbG9iYWwge1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbmFtZXNwYWNlXG4gICAgbmFtZXNwYWNlIEpTWCB7XG4gICAgICAgIHR5cGUgRWxlbWVudCA9IEd0ay5XaWRnZXRcbiAgICAgICAgdHlwZSBFbGVtZW50Q2xhc3MgPSBHdGsuV2lkZ2V0XG4gICAgICAgIGludGVyZmFjZSBJbnRyaW5zaWNFbGVtZW50cyB7XG4gICAgICAgICAgICBib3g6IFdpZGdldC5Cb3hQcm9wc1xuICAgICAgICAgICAgYnV0dG9uOiBXaWRnZXQuQnV0dG9uUHJvcHNcbiAgICAgICAgICAgIGNlbnRlcmJveDogV2lkZ2V0LkNlbnRlckJveFByb3BzXG4gICAgICAgICAgICAvLyBjaXJjdWxhcnByb2dyZXNzOiBXaWRnZXQuQ2lyY3VsYXJQcm9ncmVzc1Byb3BzXG4gICAgICAgICAgICAvLyBkcmF3aW5nYXJlYTogV2lkZ2V0LkRyYXdpbmdBcmVhUHJvcHNcbiAgICAgICAgICAgIGVudHJ5OiBXaWRnZXQuRW50cnlQcm9wc1xuICAgICAgICAgICAgaW1hZ2U6IFdpZGdldC5JbWFnZVByb3BzXG4gICAgICAgICAgICBsYWJlbDogV2lkZ2V0LkxhYmVsUHJvcHNcbiAgICAgICAgICAgIGxldmVsYmFyOiBXaWRnZXQuTGV2ZWxCYXJQcm9wc1xuICAgICAgICAgICAgb3ZlcmxheTogV2lkZ2V0Lk92ZXJsYXlQcm9wc1xuICAgICAgICAgICAgcmV2ZWFsZXI6IFdpZGdldC5SZXZlYWxlclByb3BzXG4gICAgICAgICAgICBzbGlkZXI6IFdpZGdldC5TbGlkZXJQcm9wc1xuICAgICAgICAgICAgc3RhY2s6IFdpZGdldC5TdGFja1Byb3BzXG4gICAgICAgICAgICBzd2l0Y2g6IFdpZGdldC5Td2l0Y2hQcm9wc1xuICAgICAgICAgICAgd2luZG93OiBXaWRnZXQuV2luZG93UHJvcHNcbiAgICAgICAgICAgIG1lbnVidXR0b246IFdpZGdldC5NZW51QnV0dG9uUHJvcHNcbiAgICAgICAgICAgIHBvcG92ZXI6IFdpZGdldC5Qb3BvdmVyUHJvcHNcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGpzeHMgPSBqc3hcbiIsICIvLyBUaGUgZG9jay4gQmVoYXZpb3IgbW9kZWwgKHByb3RvdHlwZS1maW5hbCk6XG4vLyAgIGNsaWNrICBcdTIwMTQgbm8gd2luZG93czogbGF1bmNoIChnaG9zdCB6b29tKSBcdTAwQjcgdW5mb2N1c2VkOiBmb2N1cyB0b3Agd2luZG93IChwdWxzZSlcbi8vICAgICAgICAgICAgZm9jdXNlZCArIG11bHRpOiBjeWNsZSBcdTAwQjcgZm9jdXNlZCArIHNpbmdsZTogbWluaW1pemVcbi8vICAgc2Nyb2xsIFx1MjAxNCBzaW5nbGU6IGZvY3VzIFx1MDBCNyBtdWx0aTogY3ljbGUgKGNhcm91c2VsIG51ZGdlLCBzdGFuZGFyZCBkaXJlY3Rpb24pXG4vLyAgIG1pZGRsZS1jbGljayBcdTIwMTQgbmV3IHdpbmRvdyBcdTAwQjcgcmlnaHQtY2xpY2sgXHUyMDE0IGNvbnRleHQgbWVudSAod2luZG93cyBsaXN0ICsgUXVpdClcbi8vIERPVFM6IGFic29sdXRlIG92ZXJsYXkgKEd0ay5PdmVybGF5KSwgc2xpZGluZyA0LWRvdCB2aWV3cG9ydCwgZWRnZSBtaW5pcyBwYXN0IDQsXG4vLyBkeWluZy1kb3QgY2xvc2UgYW5pbWF0aW9uLiBJY29ucyBvd24gQUxMIGdlb21ldHJ5LlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBiaW5kLCBWYXJpYWJsZSwgZXhlY0FzeW5jIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgeyBNT1RJT04sIHNwcmluZywgc3ByaW5nVG8gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgKiBhcyBnbm9ibGluIGZyb20gXCIuLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCB7IERFTU8gfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCBQSU5ORUQgPSBbXG4gICAgXCJvcmcuZ25vbWUuUHR5eGlzXCIsXG4gICAgXCJvcmcuZ25vbWUuTmF1dGlsdXNcIixcbiAgICBcImZpcmVmb3hcIixcbiAgICBcImRldi56ZWQuWmVkXCIsXG4gICAgXCJjb20uc3BvdGlmeS5DbGllbnRcIixcbiAgICBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiLFxuXVxuXG5mdW5jdGlvbiBEb3RzKHsgYXBwSWQgfTogeyBhcHBJZDogc3RyaW5nIH0pIHtcbiAgICAvLyBTbGlkaW5nIHZpZXdwb3J0IGlkZW50aWNhbCB0byB0aGUgcHJvdG90eXBlOiBcdTIyNjQ0IGRvdHMsIGZvY3VzZWQgcGlsbCxcbiAgICAvLyBtaW5pcyB3aGVuIHdpbmRvd3MgZXhpc3QgYmV5b25kIHRoZSB2aXNpYmxlIHNsaWNlLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJkb3RzXCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5FTkR9IHNwYWNpbmc9ezN9PlxuICAgICAgICAgICAge2JpbmQoZ25vYmxpbi53aW5kb3dzKS5hcygoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG4gICAgICAgICAgICAgICAgY29uc3QgdG90YWwgPSB3cy5sZW5ndGhcbiAgICAgICAgICAgICAgICBjb25zdCBuID0gTWF0aC5taW4odG90YWwsIDQpXG4gICAgICAgICAgICAgICAgY29uc3QgY3VyID0gd3MuZmluZEluZGV4KCh3KSA9PiB3LmZvY3VzZWQpXG4gICAgICAgICAgICAgICAgbGV0IHN0YXJ0ID0gMFxuICAgICAgICAgICAgICAgIGlmICh0b3RhbCA+IDQpIHN0YXJ0ID0gTWF0aC5taW4oTWF0aC5tYXgoKGN1ciA8IDAgPyAwIDogY3VyKSAtIDEsIDApLCB0b3RhbCAtIDQpXG4gICAgICAgICAgICAgICAgcmV0dXJuIEFycmF5LmZyb20oeyBsZW5ndGg6IG4gfSwgKF8sIGkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaWR4ID0gc3RhcnQgKyBpXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNscyA9IFtcImRvdFwiXVxuICAgICAgICAgICAgICAgICAgICBpZiAoY3VyID49IDAgJiYgaWR4ID09PSBjdXIpIGNscy5wdXNoKFwib25cIilcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRvdGFsID4gNCAmJiAoKGkgPT09IDAgJiYgc3RhcnQgPiAwKSB8fCAoaSA9PT0gbiAtIDEgJiYgc3RhcnQgKyA0IDwgdG90YWwpKSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGNscy5wdXNoKFwibWluaVwiKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gPGJveCBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBidWlsZENvbnRleHRNZW51KGFwcDogQXBwcy5BcHBsaWNhdGlvbiwgYXBwSWQ6IHN0cmluZyk6IEd0ay5Qb3BvdmVyIHtcbiAgICBjb25zdCB2Ym94ID0gbmV3IEd0ay5Cb3goeyBvcmllbnRhdGlvbjogR3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMLCBzcGFjaW5nOiAwIH0pXG4gICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG5cbiAgICAvLyB3aW5kb3cgcm93cyAoY2xpY2sgdG8gZm9jdXMvcmVzdG9yZSlcbiAgICBmb3IgKGNvbnN0IHcgb2Ygd3MpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gbmV3IEd0ay5CdXR0b24oeyBjc3NDbGFzc2VzOiBbXCJjbWlcIl0gfSlcbiAgICAgICAgY29uc3QgaGJveCA9IG5ldyBHdGsuQm94KHsgc3BhY2luZzogOSB9KVxuICAgICAgICBjb25zdCBpbWcgPSBuZXcgR3RrLkltYWdlKHsgaWNvbk5hbWU6IFwia29iZWwtd2luZG93LXN5bWJvbGljXCIgfSlcbiAgICAgICAgaW1nLmNzc0NsYXNzZXMgPSBbXVxuICAgICAgICBjb25zdCBsYmwgPSBuZXcgR3RrLkxhYmVsKHtcbiAgICAgICAgICAgIGxhYmVsOiB3LnRpdGxlIHx8IGFwcC5uYW1lLFxuICAgICAgICAgICAgaGFsaWduOiBHdGsuQWxpZ24uU1RBUlQsXG4gICAgICAgICAgICBlbGxpcHNpemU6IDMgYXMgYW55LFxuICAgICAgICAgICAgeGFsaWduOiAwLFxuICAgICAgICAgICAgaGV4cGFuZDogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgaGJveC5hcHBlbmQoaW1nKVxuICAgICAgICBoYm94LmFwcGVuZChsYmwpXG4gICAgICAgIHJvdy5zZXRfY2hpbGQoaGJveClcbiAgICAgICAgcm93LmNvbm5lY3QoXCJjbGlja2VkXCIsICgpID0+IHtcbiAgICAgICAgICAgIGdub2JsaW4uYWN0aXZhdGUody5pZClcbiAgICAgICAgICAgIHZib3guZ2V0X3Jvb3QoKT8uaGlkZSgpXG4gICAgICAgIH0pXG4gICAgICAgIHZib3guYXBwZW5kKHJvdylcbiAgICB9XG5cbiAgICBpZiAod3MubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBzZXAgPSBuZXcgR3RrLlNlcGFyYXRvcih7XG4gICAgICAgICAgICBvcmllbnRhdGlvbjogR3RrLk9yaWVudGF0aW9uLkhPUklaT05UQUwsXG4gICAgICAgICAgICBjc3NDbGFzc2VzOiBbXCJjc2VwXCJdLFxuICAgICAgICB9KVxuICAgICAgICB2Ym94LmFwcGVuZChzZXApXG4gICAgfVxuXG4gICAgLy8gcXVpdCByb3dcbiAgICBjb25zdCBxdWl0ID0gbmV3IEd0ay5CdXR0b24oeyBjc3NDbGFzc2VzOiBbXCJjbWlcIiwgXCJkYW5nZXJcIl0gfSlcbiAgICBjb25zdCBxYm94ID0gbmV3IEd0ay5Cb3goeyBzcGFjaW5nOiA5IH0pXG4gICAgY29uc3QgcWltZyA9IG5ldyBHdGsuSW1hZ2UoeyBpY29uTmFtZTogXCJrb2JlbC14LXN5bWJvbGljXCIgfSlcbiAgICBxaW1nLmNzc0NsYXNzZXMgPSBbXVxuICAgIGNvbnN0IHFsYmwgPSBuZXcgR3RrLkxhYmVsKHsgbGFiZWw6IFwiUXVpdFwiLCBoYWxpZ246IEd0ay5BbGlnbi5TVEFSVCwgeGFsaWduOiAwLCBoZXhwYW5kOiB0cnVlIH0pXG4gICAgcWJveC5hcHBlbmQocWltZylcbiAgICBxYm94LmFwcGVuZChxbGJsKVxuICAgIHF1aXQuc2V0X2NoaWxkKHFib3gpXG4gICAgcXVpdC5jb25uZWN0KFwiY2xpY2tlZFwiLCAoKSA9PiB7XG4gICAgICAgIGV4ZWNBc3luYyhgcGtpbGwgLWYgXCIke2FwcElkfVwiYClcbiAgICAgICAgdmJveC5nZXRfcm9vdCgpPy5oaWRlKClcbiAgICB9KVxuICAgIHZib3guYXBwZW5kKHF1aXQpXG5cbiAgICBjb25zdCBwb3BvdmVyID0gbmV3IEd0ay5Qb3BvdmVyKHsgY3NzQ2xhc3NlczogW1wiY21lbnVcIl0sIGNoaWxkOiB2Ym94LCBoYXNBcnJvdzogZmFsc2UgfSlcbiAgICBwb3BvdmVyLnNldF9wb3NpdGlvbihHdGsuUG9zaXRpb25UeXBlLlRPUClcbiAgICByZXR1cm4gcG9wb3ZlclxufVxuXG5mdW5jdGlvbiBEb2NrQnV0dG9uKHsgYXBwIH06IHsgYXBwOiBBcHBzLkFwcGxpY2F0aW9uIH0pIHtcbiAgICBjb25zdCBhcHBJZCA9IGFwcC5lbnRyeS5yZXBsYWNlKC9cXC5kZXNrdG9wJC8sIFwiXCIpXG4gICAgbGV0IHBvcG92ZXI6IEd0ay5Qb3BvdmVyIHwgbnVsbCA9IG51bGxcblxuICAgIGNvbnN0IG9uQ2xpY2sgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICBpZiAoIXdzLmxlbmd0aCkgcmV0dXJuIHZvaWQgYXBwLmxhdW5jaCgpIC8vICsgZ2hvc3Qgem9vbSAocmV2ZWFsZXIgc2NhbGUgYW5pbSlcbiAgICAgICAgY29uc3QgZm9jdXNlZCA9IHdzLmZpbmQoKHcpID0+IHcuZm9jdXNlZClcbiAgICAgICAgaWYgKCFmb2N1c2VkKVxuICAgICAgICAgICAgcmV0dXJuIHZvaWQgZ25vYmxpbi5hY3RpdmF0ZShcbiAgICAgICAgICAgICAgICB3cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmZvY3VzZWQpIC0gTnVtYmVyKGEuZm9jdXNlZCkpWzBdLmlkXG4gICAgICAgICAgICApXG4gICAgICAgIGlmICh3cy5sZW5ndGggPiAxKSByZXR1cm4gdm9pZCBnbm9ibGluLmN5Y2xlKGFwcElkLCAxKVxuICAgICAgICBnbm9ibGluLm1pbmltaXplKGZvY3VzZWQuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJkYnRuXCJcbiAgICAgICAgICAgIHRvb2x0aXBUZXh0PXthcHAubmFtZX1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17b25DbGlja31cbiAgICAgICAgICAgIHNldHVwPXsoc2VsZikgPT4ge1xuICAgICAgICAgICAgICAgIC8vIEF0dGFjaCBhIFBvcG92ZXIgZm9yIHJpZ2h0LWNsaWNrIGNvbnRleHQgbWVudVxuICAgICAgICAgICAgICAgIHBvcG92ZXIgPSBidWlsZENvbnRleHRNZW51KGFwcCwgYXBwSWQpXG4gICAgICAgICAgICAgICAgcG9wb3Zlci5zZXRfcGFyZW50KHNlbGYpXG4gICAgICAgICAgICB9fVxuICAgICAgICAgICAgb25CdXR0b25QcmVzc2VkPXsoX3csIGUpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoZS5nZXRfYnV0dG9uKCkgPT09IEdkay5CVVRUT05fTUlERExFKSBhcHAubGF1bmNoKClcbiAgICAgICAgICAgICAgICBpZiAoZS5nZXRfYnV0dG9uKCkgPT09IEdkay5CVVRUT05fU0VDT05EQVJZKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFJlYnVpbGQgdG8gZ2V0IGZyZXNoIHdpbmRvdyBsaXN0IHRoZW4gc2hvd1xuICAgICAgICAgICAgICAgICAgICBpZiAocG9wb3Zlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgcG9wb3Zlci51bnBhcmVudCgpXG4gICAgICAgICAgICAgICAgICAgICAgICBwb3BvdmVyLnJ1bl9kaXNwb3NlKClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBwb3BvdmVyID0gYnVpbGRDb250ZXh0TWVudShhcHAsIGFwcElkKVxuICAgICAgICAgICAgICAgICAgICBwb3BvdmVyLnNldF9wYXJlbnQoX3cpXG4gICAgICAgICAgICAgICAgICAgIHBvcG92ZXIucG9wdXAoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBvblNjcm9sbD17KF93LCBfZHgsIGR5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG4gICAgICAgICAgICAgICAgaWYgKCF3cy5sZW5ndGgpIHJldHVyblxuICAgICAgICAgICAgICAgIGlmICh3cy5sZW5ndGggPiAxKSBnbm9ibGluLmN5Y2xlKGFwcElkLCBkeSA+IDAgPyAxIDogLTEpXG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoIXdzWzBdLmZvY3VzZWQpIGdub2JsaW4uYWN0aXZhdGUod3NbMF0uaWQpXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8b3ZlcmxheT5cbiAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpY29uLXRpbGVcIlxuICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT17YXBwLmljb25fbmFtZSB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwifVxuICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgey8qIGRvdHMgYXMgT1ZFUkxBWSBcdTIwMTQgemVybyBsYXlvdXQgZm9vdHByaW50ICovfVxuICAgICAgICAgICAgICAgIDxEb3RzIHR5cGU9XCJvdmVybGF5XCIgYXBwSWQ9e2FwcElkfSAvPlxuICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmZ1bmN0aW9uIE1lZGlhV2lkZ2V0KCkge1xuICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgIGNvbnN0IHByb2dyZXNzID0gREVNT1xuICAgICAgICA/IDAuNDJcbiAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwcy5maW5kKChxKSA9PiBxLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORykgPz8gcHNbMF1cbiAgICAgICAgICAgICAgaWYgKCFwIHx8ICFwLmxlbmd0aCB8fCBwLmxlbmd0aCA8PSAwKSByZXR1cm4gMFxuICAgICAgICAgICAgICByZXR1cm4gcC5wb3NpdGlvbiAvIHAubGVuZ3RoXG4gICAgICAgICAgfSlcbiAgICBjb25zdCBpY29uID0gREVNT1xuICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICA6IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcCA9IHBzLmZpbmQoKHEpID0+IHEucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXVxuICAgICAgICAgICAgICBpZiAoIXApIHJldHVybiBcImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgcmV0dXJuIHAucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgOiBcImtvYmVsLXBsYXktc3ltYm9saWNcIlxuICAgICAgICAgIH0pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRidG4gZHdpZGdldFwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHBsYXktcGF1c2VcIil9PlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImR0aWxlXCI+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJkZ1wiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT17aWNvbn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MTh9XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxldmVsYmFyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtcHJvZ1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICB2YWx1ZT17cHJvZ3Jlc3N9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERFTU8gbW9kZTogcmVuZGVyIHRoZSBwcm90b3R5cGUncyBFWEFDVCBkb2NrIChkb2NzL3Byb3RvdHlwZS5odG1sKSB3aXRoIHJlYWwgR1RLXG4vLyB3aWRnZXRzLCBzbyBpdCBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXIgMToxLiBJY29ucyBsb2FkIGZyb20gdGhlXG4vLyBTQU1FIG9uLWRpc2sgZmlsZXMgdGhlIHByb3RvdHlwZSByZWZlcmVuY2VzICh2aWEgYSBGaWxlSWNvbiBnaWNvbikgcmF0aGVyIHRoYW4gYnlcbi8vIHRoZW1lZCBuYW1lIFx1MjAxNCBhIHRoZW1lZCBsb29rdXAgc25hcHMgdG8gYSBkaWZmZXJlbnQgc2l6ZSB2YXJpYW50IChlLmcuIHRoZSAzMnB4IGZpcmVmb3hcbi8vIGluc3RlYWQgb2YgdGhlIHByb3RvdHlwZSdzIDI1NnB4IHBuZykgYW5kIGRvd25zY2FsZXMgZGlmZmVyZW50bHkuIFNhbWUgc291cmNlIGZpbGUgXHUyMTkyXG4vLyBjbG9zZXN0IGNyb3NzLWVuZ2luZSBtYXRjaC4gKHBpeGVsLXNpemUgaXMgaG9ub3VyZWQgbm93IHRoZSBpY29uLXRpbGUgbWluIGlzIDMwLilcbmNvbnN0IERFTU9fQVBQUyA9IFtcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiVGVybWluYWxcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuUHR5eGlzLnN2Z1wiLFxuICAgICAgICBkb3RzOiBbXCJvblwiLCBcImRvdFwiXSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJGaWxlc1wiLFxuICAgICAgICBpY29uOiBcIi91c3Ivc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL29yZy5nbm9tZS5OYXV0aWx1cy5zdmdcIixcbiAgICAgICAgZG90czogW1wiZG90XCJdLFxuICAgIH0sXG4gICAgeyBuYW1lOiBcIkZpcmVmb3hcIiwgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3IvMjU2eDI1Ni9hcHBzL2ZpcmVmb3gucG5nXCIsIGRvdHM6IFtdIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlplZFwiLFxuICAgICAgICBpY29uOiBcIi9ob21lL2tpZXJhbi8ubG9jYWwvemVkLmFwcC9zaGFyZS9pY29ucy9oaWNvbG9yLzUxMng1MTIvYXBwcy96ZWQucG5nXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlNwb3RpZnlcIixcbiAgICAgICAgaWNvbjogXCIvdmFyL2xpYi9mbGF0cGFrL2V4cG9ydHMvc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL2NvbS5zcG90aWZ5LkNsaWVudC5zdmdcIixcbiAgICAgICAgZG90czogW10sXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiU2V0dGluZ3NcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuU2V0dGluZ3Muc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG5dXG5cbmZ1bmN0aW9uIGZpbGVJY29uKHBhdGg6IHN0cmluZyk6IEdpby5JY29uIHtcbiAgICByZXR1cm4gR2lvLkZpbGVJY29uLm5ldyhHaW8uRmlsZS5uZXdfZm9yX3BhdGgocGF0aCkpXG59XG5cbmZ1bmN0aW9uIERlbW9CdXR0b24oeyBhcHAgfTogeyBhcHA6ICh0eXBlb2YgREVNT19BUFBTKVtudW1iZXJdIH0pIHtcbiAgICAvLyBOQjogdGhlIGRvdHMgYm94IGNhcnJpZXMgYHR5cGU9XCJvdmVybGF5XCJgIERJUkVDVExZIChpbnRyaW5zaWMgZWxlbWVudCkgXHUyMDE0IGEgZnVuY3Rpb25cbiAgICAvLyBjb21wb25lbnQgd291bGQgc3dhbGxvdyB0aGUgcHJvcCwgbGV0dGluZyB0aGUgdW50eXBlZCBib3ggcmVwbGFjZSB0aGUgaWNvbiBhcyB0aGVcbiAgICAvLyBvdmVybGF5J3MgbWFpbiBjaGlsZCAoR3RrT3ZlcmxheS5zZXRfY2hpbGQpLiBJY29uIHN0YXlzIG1haW47IGRvdHMgb3ZlcmxheSBvbiB0b3AuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRidG5cIiB0b29sdGlwVGV4dD17YXBwLm5hbWV9PlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgZ2ljb249e2ZpbGVJY29uKGFwcC5pY29uKX1cbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJkb3RzXCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezN9XG4gICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICB7YXBwLmRvdHMubWFwKChjbHMpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9e2NscyA9PT0gXCJvblwiID8gXCJkb3Qgb25cIiA6IFwiZG90XCJ9IC8+XG4gICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmZ1bmN0aW9uIERlbW9Eb2NrKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImRvY2tcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZG9ja1wiXG4gICAgICAgICAgICBjbGFzcz1cImRvY2std2luZG93XCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5CT1RUT019XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkb2NrXCIgc3BhY2luZz17NH0+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMF19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMV19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMl19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbM119IC8+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1s0XX0gLz5cbiAgICAgICAgICAgICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1s1XX0gLz5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIGlmIChERU1PKSByZXR1cm4gRGVtb0RvY2sobW9uaXRvcilcblxuICAgIGNvbnN0IGFwcHMgPSBuZXcgQXBwcy5BcHBzKClcbiAgICAvLyBQaW5uZWQgZW50cmllcyByZXNvbHZlZCBieSBkZXNrdG9wLWlkOyB0aGUgZG9jayBuZXZlciBzaXRzIGVtcHR5LCBzbyBmaWxsIGFueVxuICAgIC8vIHVucmVzb2x2ZWQgc2xvdHMgKGUuZy4gYW4gYXBwIG5vdCBpbnN0YWxsZWQgaW4gdGhlIGRldmtpdCkgZnJvbSB0aGUgaW5zdGFsbGVkXG4gICAgLy8gbGlzdC4gT24gcmVhbCBoYXJkd2FyZSB0aGUgcGlucyByZXNvbHZlIGFuZCB0aGUgZmlsbCBpcyB1bnVzZWQuXG4gICAgY29uc3QgYWxsID0gYXBwcy5nZXRfbGlzdCgpXG4gICAgY29uc3QgcmVzb2x2ZSA9IChpZDogc3RyaW5nKTogQXBwcy5BcHBsaWNhdGlvbiB8IHVuZGVmaW5lZCA9PlxuICAgICAgICBhbGwuZmluZCgoYSkgPT4gYS5lbnRyeSA9PT0gYCR7aWR9LmRlc2t0b3BgIHx8IGEuZW50cnkgPT09IGlkKSA/P1xuICAgICAgICBhbGwuZmluZCgoYSkgPT4gYS5lbnRyeT8udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhpZC50b0xvd2VyQ2FzZSgpLnNwbGl0KFwiLlwiKS5wb3AoKSEpKVxuICAgIC8vIEFsd2F5cyByZW5kZXIgb25lIHNsb3QgcGVyIHBpbiBzbyB0aGUgZG9jayBrZWVwcyBpdHMgc2hhcGU7IHJlc29sdmVkIHBpbnMgZ2V0IHRoZVxuICAgIC8vIHJlYWwgYXBwICsgYmVoYXZpb3IsIHVucmVzb2x2ZWQgb25lcyBhIGxhYmVsbGVkIHBsYWNlaG9sZGVyIHRpbGUuIEEgc2VwYXJhdG9yIHNpdHNcbiAgICAvLyBiZXR3ZWVuIHRoZSBmb3VydGggYW5kIGZpZnRoIHBpbnMgKHByb3RvdHlwZSBwYXJpdHkpLCB0aGVuIGJlZm9yZSB0aGUgbWVkaWEgd2lkZ2V0LlxuICAgIGNvbnN0IHNsb3RzID0gUElOTkVELm1hcCgoaWQpID0+ICh7IGlkLCBhcHA6IHJlc29sdmUoaWQpIH0pKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkb2NrXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIlxuICAgICAgICAgICAgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgIHtzbG90cy5mbGF0TWFwKCh7IGlkLCBhcHAgfSwgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZXAgPSBpID09PSA0ID8gWzxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XSA6IFtdXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGJ0biA9IGFwcCA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxEb2NrQnV0dG9uIGFwcD17YXBwfSAvPlxuICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRidG4gcGxhY2Vob2xkZXJcIiB0b29sdGlwVGV4dD17aWQuc3BsaXQoXCIuXCIpLnBvcCgpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpY29uLXRpbGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbLi4uc2VwLCBidG5dXG4gICAgICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICA8TWVkaWFXaWRnZXQgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gVGhlIHNwb3RsaWdodC4gUHJvdG90eXBlLWZpbmFsIGJlaGF2aW9yOlxuLy8gICBTdXBlciByZWxlYXNlIG9wZW5zIChjb21wb3NpdG9yIGtleWJpbmQgXHUyMTkyIGBhc3RhbCAtaSBrb2JlbCAtdCBsYXVuY2hlcmApXG4vLyAgIGZ1enp5ICsgbGVhZiBoaWdobGlnaHQgXHUwMEI3IGdsb2JhbCBCRVNULU1BVENIIHNsb3QgKHNjb3JlLXJhbmtlZCBhY3Jvc3MgcHJvdmlkZXJzLFxuLy8gICB0eXBlIHdlaWdodHMgYXBwcyAxIC8gYWN0aW9ucyAuOTUgLyBmaWxlcyAuOSkgXHUwMEI3IGNhcHBlZCBsb2cyIGZyZWNlbmN5XG4vLyAgIGdob3N0IGF1dG9jb21wbGV0ZSA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXJcbi8vICAgVGFiIGFsd2F5cyBvd25lZCAoZ2hvc3QgZWxzZSBuZXh0OyBTaGlmdCtUYWIgcHJldikgXHUwMEI3IEN0cmwrTi9QIFx1MDBCNyBFc2MgY2xlYXJzIGZpcnN0XG4vLyAgIHNlY3Rpb25zOiBiZXN0IG1hdGNoIC8gYXBwcyAvIGFjdGlvbnMgLyBmaWxlcyAvIHdlYiAoYWx3YXlzLWxhc3QgcmVhbCByb3cpXG4vLyAgICc9JyBjYWxjdWxhdG9yIFx1MDBCNyAnOicgZ25vYmxpbmN0bCBjb21tYW5kcyBcdTAwQjcgZW1wdHkgc3RhdGU6IGRvY2stdGlsZSBncmlkICsgd2lkZ2V0c1xuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgZXhlY0FzeW5jLCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyLCB0b2dnbGUgYXMgc3VyZmFjZVRvZ2dsZSB9IGZyb20gXCIuLi9saWIvc3VyZmFjZVwiXG5pbXBvcnQgQXBwcyBmcm9tIFwiZ2k6Ly9Bc3RhbEFwcHNcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgZnV6enksIGhsLCBib29zdCwgYnVtcCwgZnJlcXVlbmN5IH0gZnJvbSBcIi4uL2xpYi9mdXp6eVwiXG5pbXBvcnQgeyBFVkVOVFMgfSBmcm9tIFwiLi9DYWxlbmRhclwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcblxuLy8gQ3VyYXRlZCBncmlkOiB0aGUgZG9jaydzIHBpbm5lZCBhcHBzIGZpcnN0IChyZXNvbHZlZCBieSBkZXNrdG9wLWlkKSwgdGhlbiBmaWxsIHRoZVxuLy8gcmVtYWluaW5nIHNsb3RzIGJ5IGZyZWNlbmN5LiBNYXRjaGVzIHRoZSBwcm90b3R5cGUncyBsYXVuY2hlciBlbXB0eS1zdGF0ZS5cbmNvbnN0IFBJTk5FRCA9IFtcbiAgICBcIm9yZy5nbm9tZS5QdHl4aXNcIixcbiAgICBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiLFxuICAgIFwiZmlyZWZveFwiLFxuICAgIFwiZGV2LnplZC5aZWRcIixcbiAgICBcImNvbS5zcG90aWZ5LkNsaWVudFwiLFxuICAgIFwib3JnLmdub21lLlNldHRpbmdzXCIsXG5dXG4vLyBEZW1vIGdyaWQ6IGZpeGVkIG9yZGVyICsgbGFiZWxzIHRyYW5zY3JpYmVkIGZyb20gdGhlIHByb3RvdHlwZSAoRC5hcHBzKSwgZWFjaCBtYXBwZWRcbi8vIHRvIHRoZSByZWFsIC5kZXNrdG9wIGlkIHNvIGl0cyB0aGVtZWQgaWNvbiByZW5kZXJzIChQdHl4aXMvTmF1dGlsdXMvXHUyMDI2KS5cbmNvbnN0IERFTU9fVElMRVMgPSBbXG4gICAgeyBuYW1lOiBcIlRlcm1pbmFsXCIsIGlkOiBcIm9yZy5nbm9tZS5QdHl4aXNcIiB9LFxuICAgIHsgbmFtZTogXCJGaWxlc1wiLCBpZDogXCJvcmcuZ25vbWUuTmF1dGlsdXNcIiB9LFxuICAgIHsgbmFtZTogXCJGaXJlZm94XCIsIGlkOiBcImZpcmVmb3hcIiB9LFxuICAgIHsgbmFtZTogXCJaZWRcIiwgaWQ6IFwiZGV2LnplZC5aZWRcIiB9LFxuICAgIHsgbmFtZTogXCJTcG90aWZ5XCIsIGlkOiBcImNvbS5zcG90aWZ5LkNsaWVudFwiIH0sXG4gICAgeyBuYW1lOiBcIlNldHRpbmdzXCIsIGlkOiBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiIH0sXG5dXG5cbmludGVyZmFjZSBUaWxlIHtcbiAgICBuYW1lOiBzdHJpbmdcbiAgICBpY29uTmFtZTogc3RyaW5nXG4gICAgbGF1bmNoOiAoKSA9PiB2b2lkXG59XG5mdW5jdGlvbiBncmlkVGlsZXMoYXBwczogQXBwcy5BcHBzKTogVGlsZVtdIHtcbiAgICBjb25zdCBhbGwgPSBhcHBzLmdldF9saXN0KClcbiAgICBjb25zdCByZXNvbHZlID0gKGlkOiBzdHJpbmcpOiBBcHBzLkFwcGxpY2F0aW9uIHwgdW5kZWZpbmVkID0+XG4gICAgICAgIGFsbC5maW5kKChhKSA9PiBhLmVudHJ5ID09PSBgJHtpZH0uZGVza3RvcGAgfHwgYS5lbnRyeSA9PT0gaWQpID8/XG4gICAgICAgIGFsbC5maW5kKChhKSA9PiBhLmVudHJ5Py50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGlkLnRvTG93ZXJDYXNlKCkuc3BsaXQoXCIuXCIpLnBvcCgpISkpXG4gICAgY29uc3QgZnJvbUFwcCA9IChhcHA6IEFwcHMuQXBwbGljYXRpb24pOiBUaWxlID0+ICh7XG4gICAgICAgIG5hbWU6IGFwcC5uYW1lLFxuICAgICAgICBpY29uTmFtZTogYXBwLmljb25fbmFtZSB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICBsYXVuY2g6ICgpID0+IHtcbiAgICAgICAgICAgIGJ1bXAoYXBwLm5hbWUpXG4gICAgICAgICAgICBhcHAubGF1bmNoKClcbiAgICAgICAgfSxcbiAgICB9KVxuICAgIGlmIChERU1PKVxuICAgICAgICByZXR1cm4gREVNT19USUxFUy5tYXAoKHsgbmFtZSwgaWQgfSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgYXBwID0gcmVzb2x2ZShpZClcbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgbmFtZSxcbiAgICAgICAgICAgICAgICBpY29uTmFtZTogYXBwPy5pY29uX25hbWUgfHwgaWQgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIixcbiAgICAgICAgICAgICAgICBsYXVuY2g6ICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgYnVtcChuYW1lKVxuICAgICAgICAgICAgICAgICAgICBhcHA/LmxhdW5jaCgpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICBjb25zdCBwaW5uZWQgPSBQSU5ORUQubWFwKHJlc29sdmUpLmZpbHRlcihCb29sZWFuKSBhcyBBcHBzLkFwcGxpY2F0aW9uW11cbiAgICBjb25zdCByZXN0ID0gYWxsXG4gICAgICAgIC5maWx0ZXIoKGEpID0+ICFwaW5uZWQuaW5jbHVkZXMoYSkpXG4gICAgICAgIC5zb3J0KCh4LCB5KSA9PiBmcmVxdWVuY3koeS5uYW1lKSAtIGZyZXF1ZW5jeSh4Lm5hbWUpKVxuICAgIHJldHVybiBbLi4ucGlubmVkLCAuLi5yZXN0XS5zbGljZSgwLCA2KS5tYXAoZnJvbUFwcClcbn1cbmZ1bmN0aW9uIHRvZGF5RXZlbnRMYWJlbCgpOiBzdHJpbmcge1xuICAgIGlmIChERU1PKSByZXR1cm4gRC53aWRnZXRFdmVudFxuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZSgpXG4gICAgY29uc3QgZXZzID0gRVZFTlRTW2Ake2QuZ2V0RnVsbFllYXIoKX0tJHtkLmdldE1vbnRoKCkgKyAxfS0ke2QuZ2V0RGF0ZSgpfWBdID8/IFtdXG4gICAgcmV0dXJuIGV2cy5sZW5ndGggPyBgJHtldnNbMF0udH0gXHUwMEI3ICR7ZXZzWzBdLm59YCA6IFwiTm8gZXZlbnRzIHRvZGF5XCJcbn1cbmZ1bmN0aW9uIHRvZGF5RGF0ZUxhYmVsKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIERFTU9cbiAgICAgICAgPyBELndpZGdldERhdGVcbiAgICAgICAgOiBuZXcgRGF0ZSgpLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIsIGRheTogXCJudW1lcmljXCIsIG1vbnRoOiBcImxvbmdcIiB9KVxufVxuXG5pbnRlcmZhY2UgUm93IHtcbiAgICBuYW1lOiBzdHJpbmdcbiAgICBpY29uOiBzdHJpbmdcbiAgICBoaW50OiBzdHJpbmdcbiAgICBzY29yZTogbnVtYmVyXG4gICAgbWFya3VwOiBzdHJpbmdcbiAgICBydW46ICgpID0+IHZvaWRcbn1cblxuY29uc3QgQUNUSU9OUyA9IFtcbiAgICB7XG4gICAgICAgIG46IFwiU3VzcGVuZFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLW1vb24tc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJTbGVlcCBcdTIwMTQgcmVzdW1lIGluc3RhbnRseVwiLFxuICAgICAgICBhbDogW1wic2xlZXBcIl0sXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwic3lzdGVtY3RsIHN1c3BlbmRcIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG46IFwiTG9ja1wiLFxuICAgICAgICBpY29uOiBcImtvYmVsLWxvY2stc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJMb2NrIHRoZSBzZXNzaW9uXCIsXG4gICAgICAgIGFsOiBbXCJsb2NrIHNjcmVlblwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJsb2dpbmN0bCBsb2NrLXNlc3Npb25cIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG46IFwiTG9nIE91dFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLWxvZ291dC1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIkVuZCB0aGlzIHNlc3Npb25cIixcbiAgICAgICAgYWw6IFtcImV4aXRcIiwgXCJzaWduIG91dFwiLCBcImxvZ291dFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJSZXN0YXJ0XCIsXG4gICAgICAgIGljb246IFwia29iZWwtcmVsb2FkLXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiUmVib290IHRoZSBtYWNoaW5lXCIsXG4gICAgICAgIGFsOiBbXCJyZWJvb3RcIl0sXG4gICAgICAgIHJ1bjogKCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG46IFwiU2h1dCBEb3duXCIsXG4gICAgICAgIGljb246IFwia29iZWwtcG93ZXItc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJQb3dlciBvZmZcIixcbiAgICAgICAgYWw6IFtcInBvd2Vyb2ZmXCIsIFwiaGFsdFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJTb2Z0LXJlbG9hZCBnbm9ibGluXCIsXG4gICAgICAgIGljb246IFwia29iZWwtcmVsb2FkLXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiUmVsb2FkIHRoZSBzaGVsbCBcdTIwMTQgd2luZG93cyBzdXJ2aXZlXCIsXG4gICAgICAgIGFsOiBbXSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJnbm9ibGluY3RsIHJlbG9hZFwiKSxcbiAgICB9LFxuXVxuXG5jb25zdCBDTURTID0gW1xuICAgIHsgYzogXCJyZWxvYWRcIiwgZDogXCJTb2Z0LXJlbG9hZCB0aGUgc2hlbGwgXHUyMDE0IHdpbmRvd3Mgc3Vydml2ZVwiIH0sXG4gICAgeyBjOiBcIm9zZCBvZmZcIiwgZDogXCJrb2JlbCBvd25zIHZvbHVtZS9icmlnaHRuZXNzIHBvcHVwc1wiIH0sXG4gICAgeyBjOiBcIm5vdGlmcyBvZmZcIiwgZDogXCJSZWxlYXNlIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zXCIgfSxcbiAgICB7IGM6IFwiZ3JhbnRzXCIsIGQ6IFwiU2NyZWVuLXJlY29yZGluZyBhY2Nlc3MgcGVyIGFwcFwiIH0sXG5dXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIExhdW5jaGVyKCkge1xuICAgIGNvbnN0IGFwcHMgPSBuZXcgQXBwcy5BcHBzKClcbiAgICAvLyBLT0JFTF9RVUVSWSBwcmUtZmlsbHMgdGhlIHNlYXJjaCBzbyB0aGUgZGV2a2l0IGNhbiByZW5kZXIgdGhlIHJlc3VsdHMgc3RhdGUuXG4gICAgY29uc3QgcXVlcnkgPSBWYXJpYWJsZShHTGliLmdldGVudihcIktPQkVMX1FVRVJZXCIpIHx8IFwiXCIpXG4gICAgY29uc3Qgc2VsZWN0ZWQgPSBWYXJpYWJsZSgwKVxuICAgIGNvbnN0IGdob3N0ID0gVmFyaWFibGUoXCJcIilcblxuICAgIGZ1bmN0aW9uIHJlc3VsdHMocTogc3RyaW5nKTogeyBzZWN0aW9uOiBzdHJpbmc7IHJvd3M6IFJvd1tdIH1bXSB7XG4gICAgICAgIGNvbnN0IHF0ID0gcS50cmltKClcbiAgICAgICAgaWYgKCFxdCkgcmV0dXJuIFtdXG4gICAgICAgIGlmIChxdC5zdGFydHNXaXRoKFwiOlwiKSkge1xuICAgICAgICAgICAgY29uc3QgY3EgPSBxdC5zbGljZSgxKS50cmltKClcbiAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBzZWN0aW9uOiBcImdub2JsaW5jdGxcIixcbiAgICAgICAgICAgICAgICAgICAgcm93czogQ01EUy5maWx0ZXIoKGMpID0+IGMuYy5zdGFydHNXaXRoKGNxKSkubWFwKChjKSA9PiAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogYDoke2MuY31gLFxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogXCJrb2JlbC10ZXJtaW5hbC1zeW1ib2xpY1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgaGludDogYy5kLFxuICAgICAgICAgICAgICAgICAgICAgICAgc2NvcmU6IDk5LFxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBgOiR7Yy5jfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhgZ25vYmxpbmN0bCAke2MuY31gKSxcbiAgICAgICAgICAgICAgICAgICAgfSkpLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb3V0OiB7IHNlY3Rpb246IHN0cmluZzsgcm93czogUm93W10gfVtdID0gW11cbiAgICAgICAgLy8gJz0nIGNhbGN1bGF0b3IgKGNoYXJzZXQtZ3VhcmRlZCwgc2FtZSBhcyBwcm90b3R5cGUpXG4gICAgICAgIGlmICgvXj0/WzAtOStcXC0qLygpLiBdKyQvLnRlc3QocXQpICYmIC9bMC05XS8udGVzdChxdCkgJiYgL1srXFwtKi9dLy50ZXN0KHF0KSkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2ID0gRnVuY3Rpb24oYFwidXNlIHN0cmljdFwiO3JldHVybigke3F0LnJlcGxhY2UoL149LywgXCJcIil9KWApKClcbiAgICAgICAgICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHYpKVxuICAgICAgICAgICAgICAgICAgICBvdXQucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWN0aW9uOiBcImNhbGN1bGF0b3JcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIHJvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IFN0cmluZyh2KSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbjogXCJrb2JlbC1jYWxjdWxhdG9yLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpbnQ6IGAke3F0LnJlcGxhY2UoL149LywgXCJcIil9ID1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzY29yZTogOTgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1hcmt1cDogU3RyaW5nKHYpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhbXCJ3bC1jb3B5XCIsIFN0cmluZyh2KV0pLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSBjYXRjaCB7fVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGFwcFJvd3M6IFJvd1tdID0gYXBwc1xuICAgICAgICAgICAgLmZ1enp5X3F1ZXJ5KHF0KVxuICAgICAgICAgICAgLnNsaWNlKDAsIDUpXG4gICAgICAgICAgICAubWFwKChhKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbSA9IGZ1enp5KHF0LCBhLm5hbWUpID8/IHsgc2NvcmU6IDEsIG1hcmtzOiBudWxsIGFzIGFueSB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYS5uYW1lLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiBhLmljb25fbmFtZSA/PyBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICAgICAgICAgICAgICBoaW50OiBcIkFwcGxpY2F0aW9uXCIsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiBtLnNjb3JlICsgYm9vc3QoYS5uYW1lKSxcbiAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBobChhLm5hbWUsIG0ubWFya3MpLFxuICAgICAgICAgICAgICAgICAgICBydW46ICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJ1bXAoYS5uYW1lKVxuICAgICAgICAgICAgICAgICAgICAgICAgYS5sYXVuY2goKVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIGNvbnN0IGFjdFJvd3M6IFJvd1tdID0gQUNUSU9OUy5tYXAoKHgpID0+IHtcbiAgICAgICAgICAgIGxldCBtID0gZnV6enkocXQsIHgubilcbiAgICAgICAgICAgIGlmICghbSlcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGFsIG9mIHguYWwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYW0gPSBmdXp6eShxdCwgYWwpXG4gICAgICAgICAgICAgICAgICAgIGlmIChhbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgbSA9IHsgc2NvcmU6IGFtLnNjb3JlIC0gMC41LCBtYXJrczogbnVsbCBhcyBhbnkgfVxuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBtXG4gICAgICAgICAgICAgICAgPyAoe1xuICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IHgubixcbiAgICAgICAgICAgICAgICAgICAgICBpY29uOiB4Lmljb24sXG4gICAgICAgICAgICAgICAgICAgICAgaGludDogeC5kLFxuICAgICAgICAgICAgICAgICAgICAgIHNjb3JlOiBtLnNjb3JlICogMC45NSxcbiAgICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGhsKHgubiwgKG0gYXMgYW55KS5tYXJrcyksXG4gICAgICAgICAgICAgICAgICAgICAgcnVuOiB4LnJ1bixcbiAgICAgICAgICAgICAgICAgIH0gYXMgUm93KVxuICAgICAgICAgICAgICAgIDogbnVsbFxuICAgICAgICB9KS5maWx0ZXIoQm9vbGVhbikgYXMgUm93W11cbiAgICAgICAgLy8gZ2xvYmFsIGJlc3QtbWF0Y2ggc2xvdCAoY3JpdGlxdWUgQTEpXG4gICAgICAgIGNvbnN0IGFsbCA9IFsuLi5hcHBSb3dzLCAuLi5hY3RSb3dzXS5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSlcbiAgICAgICAgY29uc3QgYmVzdCA9IGFsbFswXVxuICAgICAgICBpZiAoYmVzdCkgb3V0LnB1c2goeyBzZWN0aW9uOiBcImJlc3QgbWF0Y2hcIiwgcm93czogW2Jlc3RdIH0pXG4gICAgICAgIGNvbnN0IHJlc3QgPSAocm93czogUm93W10pID0+IHJvd3MuZmlsdGVyKChyKSA9PiByICE9PSBiZXN0KVxuICAgICAgICBpZiAocmVzdChhcHBSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhcHBzXCIsIHJvd3M6IHJlc3QoYXBwUm93cykgfSlcbiAgICAgICAgaWYgKHJlc3QoYWN0Um93cykubGVuZ3RoKSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYWN0aW9uc1wiLCByb3dzOiByZXN0KGFjdFJvd3MpLnNsaWNlKDAsIDMpIH0pXG4gICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICAgIHNlY3Rpb246IFwid2ViXCIsXG4gICAgICAgICAgICByb3dzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBgU2VhcmNoIHRoZSB3ZWIgZm9yIFx1MjAxQyR7cXR9XHUyMDFEYCxcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogXCJrb2JlbC1nbG9iZS1zeW1ib2xpY1wiLFxuICAgICAgICAgICAgICAgICAgICBoaW50OiBcIlwiLFxuICAgICAgICAgICAgICAgICAgICBzY29yZTogMCxcbiAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBgU2VhcmNoIHRoZSB3ZWIgZm9yIFx1MjAxQyR7cXR9XHUyMDFEYCxcbiAgICAgICAgICAgICAgICAgICAgcnVuOiAoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgZXhlY0FzeW5jKFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcInhkZy1vcGVuXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYGh0dHBzOi8vZHVja2R1Y2tnby5jb20vP3E9JHtlbmNvZGVVUklDb21wb25lbnQocXQpfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBdKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgfSlcbiAgICAgICAgLy8gZ2hvc3QgPSBmaXJzdCBwcmVmaXgtY29tcGxldGFibGUgbmFtZSBpbiBkaXNwbGF5IG9yZGVyIChjcml0aXF1ZSBBNClcbiAgICAgICAgY29uc3QgZyA9IG91dFxuICAgICAgICAgICAgLmZsYXRNYXAoKHMpID0+IHMucm93cylcbiAgICAgICAgICAgIC5tYXAoKHIpID0+IHIubmFtZSlcbiAgICAgICAgICAgIC5maW5kKChuKSA9PiBuLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChxdC50b0xvd2VyQ2FzZSgpKSAmJiBuLmxlbmd0aCA+IHF0Lmxlbmd0aClcbiAgICAgICAgZ2hvc3Quc2V0KGcgPz8gXCJcIilcbiAgICAgICAgcmV0dXJuIG91dFxuICAgIH1cblxuICAgIGNvbnN0IHNlY3Rpb25zID0gYmluZChxdWVyeSkuYXMocmVzdWx0cylcblxuICAgIGNvbnN0IHtcbiAgICAgICAgd2luVmlzaWJsZSxcbiAgICAgICAgcmV2ZWFsZWQ6IGxhdW5jaFJldmVhbGVkLFxuICAgICAgICBzZXRSZXZlYWxlcjogc2V0TGF1bmNoUmV2ZWFsZXIsXG4gICAgICAgIGNsb3NlOiBsYXVuY2hDbG9zZSxcbiAgICAgICAgdG9nZ2xlOiB0b2dnbGVGbixcbiAgICB9ID0gbWFrZVJldmVhbCgyMjAsIDE1MClcbiAgICByZWdpc3RlcihcImxhdW5jaGVyXCIsIHRvZ2dsZUZuKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJsYXVuY2hlclwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1sYXVuY2hlclwiXG4gICAgICAgICAgICBjbGFzcz1cImxhdW5jaGVyLXdpbmRvd1wiXG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1B9XG4gICAgICAgICAgICBtYXJnaW5Ub3A9ezU2fVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuRVhDTFVTSVZFfVxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXksIF9jb2RlLCBtb2RzKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmxhdCA9IHJlc3VsdHMocXVlcnkuZ2V0KCkpLmZsYXRNYXAoKHMpID0+IHMucm93cylcbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAocXVlcnkuZ2V0KCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChcIlwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfVGFiKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRhYiBpcyBBTFdBWVMgb3duZWRcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZyA9IGdob3N0LmdldCgpLFxuICAgICAgICAgICAgICAgICAgICAgICAgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgICAgICAgICAgICAgIGlmIChnICYmICEobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChnKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoXG4gICAgICAgICAgICAgICAgICAgICAgICAoc2VsZWN0ZWQuZ2V0KCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIChtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5TSElGVF9NQVNLID8gLTEgOiAxKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmxhdC5sZW5ndGgpICVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgIG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLkNPTlRST0xfTUFTSyAmJlxuICAgICAgICAgICAgICAgICAgICAoa2V5ID09PSBHZGsuS0VZX24gfHwga2V5ID09PSBHZGsuS0VZX3ApXG4gICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldChcbiAgICAgICAgICAgICAgICAgICAgICAgIChzZWxlY3RlZC5nZXQoKSArIChrZXkgPT09IEdkay5LRVlfbiA/IDEgOiAtMSkgKyBmbGF0Lmxlbmd0aCkgJVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgubWF4KGZsYXQubGVuZ3RoLCAxKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfRG93bikge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoKHNlbGVjdGVkLmdldCgpICsgMSkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfVXApIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSAtIDEgKyBmbGF0Lmxlbmd0aCkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfUmV0dXJuKSB7XG4gICAgICAgICAgICAgICAgICAgIGZsYXRbc2VsZWN0ZWQuZ2V0KCldPy5ydW4oKVxuICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChcIlwiKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH19XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9ET1dOfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKGxhdW5jaFJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0TGF1bmNoUmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNoZWV0IGxhdW5jaGVyXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJmaWVsZFwiIHNwYWNpbmc9ezExfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW1hZ25pZnlpbmctZ2xhc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPG92ZXJsYXkgaGV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8ZW50cnlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXR1cD17KHNlbGY6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXRfbWF4X3dpZHRoX2NoYXJzKDEpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLnNldF93aWR0aF9jaGFycygxKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0PXtiaW5kKHF1ZXJ5KX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ob3RpZnlUZXh0PXsoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2V0KGUudGV4dClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldCgwKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIHBsYWNlaG9sZGVyIGFzIGFuIE9WRVJMQVkgbGFiZWwgKG5vdCBlbnRyeSBwbGFjZWhvbGRlclRleHQpIHNvIGl0cyB0ZXh0XG4gICAgICAgICAgICAgIHdpZHRoIGNhbid0IGluZmxhdGUgdGhlIGVudHJ5J3MgbmF0dXJhbCBzaXplIFx1MjE5MiBwYW5lbCBzdGF5cyBhdCBtaW4td2lkdGggKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJscGxhY2Vob2xkZXJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChxdWVyeSkuYXMoKHEpID0+ICFxKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJTZWFyY2ggXHUyMDE0IGFwcHMsIGZpbGVzLCBhY3Rpb25zIFx1MDBCNyAnOicgY21kcyBcdTAwQjcgJz0nIG1hdGhzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZ2hvc3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VNYXJrdXBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoZ2hvc3QpLmFzKChnKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBxID0gcXVlcnkuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZyB8fCAhcSB8fCAhZy50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocS50b0xvd2VyQ2FzZSgpKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gXCJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZXNjID0gKHM6IHN0cmluZykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC8+L2csIFwiJmd0O1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gaW52aXNpYmxlIHByZWZpeCAodGFrZXMgdXAgc3BhY2UpICsgZGltIHN1ZmZpeCwgbWF0Y2hpbmdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIHByb3RvdHlwZSdzICNsZy1wcmV7dmlzaWJpbGl0eTpoaWRkZW59IC8gI2xnLXN1Zntjb2xvcjpkaW19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gYDxzcGFuIGFscGhhPVwiMFwiPiR7ZXNjKGcuc2xpY2UoMCwgcS5sZW5ndGgpKX08L3NwYW4+PHNwYW4gY29sb3I9XCIjOGQ4NjkzXCI+JHtlc2MoZy5zbGljZShxLmxlbmd0aCkpfTwvc3Bhbj5gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJrYmRcIiBsYWJlbD1cInN1cGVyXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgICAgICAgICB7LyogZW1wdHkgc3RhdGU6IGN1cmF0ZWQgZnJlY2VuY3kgdGlsZSBncmlkICsgd2lkZ2V0IHJvdyAqL31cbiAgICAgICAgICAgICAgICAgICAgPHJldmVhbGVyIHJldmVhbENoaWxkPXtiaW5kKHF1ZXJ5KS5hcygocSkgPT4gIXEudHJpbSgpKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJ0aWxlc1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17Nn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtncmlkVGlsZXMoYXBwcykubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ0aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdC5sYXVuY2goKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezh9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpY29uLXRpbGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e3QuaWNvbk5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXt0Lm5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXhXaWR0aENoYXJzPXs5fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiB0d28gY2FyZHMgc3BsaXQgdGhlIHJvdyBleGFjdGx5IGluIGhhbGYgXHUyMDE0IHByb3RvIGZsZXg6MS9mbGV4OjEgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3aWRnZXRzXCIgc3BhY2luZz17N30gaG9tb2dlbmVvdXM+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBsZWZ0IGNhcmQgXHUyMDE0IGRhdGUgKyB0b2RheSdzIGZpcnN0IGV2ZW50ICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIndpZGdldCBsd1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3BhY2luZz17Mn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3RvZGF5RGF0ZUxhYmVsKCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJoaW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17dG9kYXlFdmVudExhYmVsKCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIHJpZ2h0IGNhcmQgXHUyMDE0IG1lZGlhIG1pbmktY2FyZDogYXJ0IFx1MDBCNyB0aXRsZS9hcnRpc3QgXHUwMEI3IHBsYXkgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbXByaXMgPSBNcHJpcy5nZXRfZGVmYXVsdCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmVQbGF5ZXIgPSBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHBzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHApID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcC5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzWzBdID8/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG51bGxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lZGlhVGl0bGUgPSBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBELm1lZGlhLnRpdGxlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8udGl0bGUgPz8gXCJOb3RoaW5nIHBsYXlpbmdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lZGlhQXJ0aXN0ID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5tZWRpYS5hcnRpc3RcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHMuZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChxKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHEucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA/PyBwc1swXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBwPy5hcnRpc3QgPz8gXCJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBsYXlJY29uID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8ucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJ3aWRnZXQgbHdtXCIgaGV4cGFuZCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsd2FydFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibHd0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibXRpdGxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e21lZGlhVGl0bGV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJoaW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e21lZGlhQXJ0aXN0fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibWJ0biBwbGF5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHBsYXktcGF1c2VcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17cGxheUljb259IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG5cbiAgICAgICAgICAgICAgICAgICAgey8qIHJlc3VsdHMgKi99XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJscm93c1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAge3NlY3Rpb25zLmFzKChzZWNzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlY3MuZmxhdE1hcCgoc2VjKSA9PiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInNlY1wiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17c2VjLnNlY3Rpb259IC8+LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5zZWMucm93cy5tYXAoKHIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZsYXRJZHggPSBzZWNzLmZsYXRNYXAoKHMpID0+IHMucm93cykuaW5kZXhPZihyKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtiaW5kKHNlbGVjdGVkKS5hcygocykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMgPT09IGZsYXRJZHggPyBcInJvdyBzZWxcIiA6IFwicm93XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByLnJ1bigpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezExfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiAyOFx1MDBENzI4IHI4IHBhbmVsMiBmcmFtZSBhcm91bmQgdGhlIDI0cHggaWNvbiAocHJvdG90eXBlIC5yaSkgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwicmlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17ci5pY29ufSBwaXhlbFNpemU9ezI0fSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPXtyLm1hcmt1cH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17ci5oaW50fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwicnVua1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJcdTIxQjVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoc2VsZWN0ZWQpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocykgPT4gcyA9PT0gZmxhdElkeFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXSlcbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuXG4gICAgICAgICAgICAgICAgICAgIHsvKiBmb290ZXIgaGludCByb3cgXHUyMDE0IG1hdGNoZXMgcHJvdG90eXBlIC5sZm9vdCAqL31cbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImxmb290XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezE0fSBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OnJlbG9hZDwvYj4gc29mdC1yZWxvYWRcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46b3NkPC9iPiB0b2dnbGVcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46Z3JhbnRzPC9iPiBzY3JlZW4gYWNjZXNzXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiXHUyMTkxXHUyMTkzIHNlbGVjdCBcdTAwQjcgXHUyMUI1IHJ1blwiIGhhbGlnbj17R3RrLkFsaWduLkVORH0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L3JldmVhbGVyPlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gTGF1bmNoZXIgbWF0Y2hpbmcgXHUyMDE0IHN0cmFpZ2h0IHBvcnQgb2YgdGhlIHByb3RvdHlwZSAocG9zdC1jcml0aXF1ZSB2ZXJzaW9uKTpcbi8vIHN1YnNlcXVlbmNlIGZ1enp5IHdpdGggd29yZC1ib3VuZGFyeSBib251cywgY2FwcGVkIGxvZzIgZnJlY2VuY3ksIHByZWZpeCBnaG9zdC5cblxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWF0Y2gge1xuICAgIHNjb3JlOiBudW1iZXJcbiAgICBtYXJrczogbnVtYmVyW11cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZ1enp5KHE6IHN0cmluZywgdDogc3RyaW5nKTogTWF0Y2ggfCBudWxsIHtcbiAgICBjb25zdCBxbCA9IHEudG9Mb3dlckNhc2UoKSxcbiAgICAgICAgdGwgPSB0LnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcWkgPSAwLFxuICAgICAgICBzY29yZSA9IDAsXG4gICAgICAgIGxhc3QgPSAtMlxuICAgIGNvbnN0IG1hcmtzOiBudW1iZXJbXSA9IFtdXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0bC5sZW5ndGggJiYgcWkgPCBxbC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAodGxbaV0gPT09IHFsW3FpXSkge1xuICAgICAgICAgICAgbWFya3MucHVzaChpKVxuICAgICAgICAgICAgc2NvcmUgKz0gaSA9PT0gMCB8fCBcIiAtXy4vXCIuaW5jbHVkZXModFtpIC0gMV0pID8gNCA6IGxhc3QgPT09IGkgLSAxID8gMiA6IDFcbiAgICAgICAgICAgIGxhc3QgPSBpXG4gICAgICAgICAgICBxaSsrXG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHFpID09PSBxbC5sZW5ndGggPyB7IHNjb3JlOiBzY29yZSAtIHQubGVuZ3RoICogMC4wMiwgbWFya3MgfSA6IG51bGxcbn1cblxuLy8gUGFuZ28gbWFya3VwIGhpZ2hsaWdodCAoZXNjYXBlczsgbGVhZiBhY2NlbnQgb24gbWF0Y2hlZCBjaGFycylcbmV4cG9ydCBmdW5jdGlvbiBobCh0OiBzdHJpbmcsIG1hcmtzOiBudW1iZXJbXSB8IG51bGwpOiBzdHJpbmcge1xuICAgIGNvbnN0IGVzYyA9IChjOiBzdHJpbmcpID0+IEdMaWIubWFya3VwX2VzY2FwZV90ZXh0KGMsIC0xKVxuICAgIGlmICghbWFya3MpIHJldHVybiBlc2ModClcbiAgICBjb25zdCBtID0gbmV3IFNldChtYXJrcylcbiAgICBsZXQgb3V0ID0gXCJcIlxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdC5sZW5ndGg7IGkrKylcbiAgICAgICAgb3V0ICs9IG0uaGFzKGkpID8gYDxzcGFuIGZvcmVncm91bmQ9XCIjYjVjYjQ4XCI+JHtlc2ModFtpXSl9PC9zcGFuPmAgOiBlc2ModFtpXSlcbiAgICByZXR1cm4gb3V0XG59XG5cbi8vIEZyZWNlbmN5OiBjYXBwZWQgc28gYW4gZXhhY3QgcHJlZml4IG1hdGNoIEFMV0FZUyBiZWF0cyBoYWJpdCAoY3JpdGlxdWUgQTIpLlxuY29uc3QgU1RPUkUgPSBgJHtHTGliLmdldF91c2VyX3N0YXRlX2RpcigpfS9rb2JlbC9mcmVxLmpzb25gXG5sZXQgZnJlcTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9XG50cnkge1xuICAgIGZyZXEgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShHTGliLmZpbGVfZ2V0X2NvbnRlbnRzKFNUT1JFKVsxXSkpXG59IGNhdGNoIHt9XG5cbmV4cG9ydCBjb25zdCBib29zdCA9IChpZDogc3RyaW5nKSA9PiBNYXRoLm1pbihNYXRoLmxvZzIoMSArIChmcmVxW2lkXSA/PyAwKSksIDMpXG5cbmV4cG9ydCBmdW5jdGlvbiBidW1wKGlkOiBzdHJpbmcpIHtcbiAgICBmcmVxW2lkXSA9IChmcmVxW2lkXSA/PyAwKSArIDFcbiAgICBHTGliLm1rZGlyX3dpdGhfcGFyZW50cyhHTGliLnBhdGhfZ2V0X2Rpcm5hbWUoU1RPUkUpLCAwbzc1NSlcbiAgICBHTGliLmZpbGVfc2V0X2NvbnRlbnRzKFNUT1JFLCBKU09OLnN0cmluZ2lmeShmcmVxKSlcbn1cblxuZXhwb3J0IGNvbnN0IGZyZXF1ZW5jeSA9IChpZDogc3RyaW5nKSA9PiBmcmVxW2lkXSA/PyAwXG4iLCAiLy8gQ2FsZW5kYXIgcG9wb3ZlciBcdTIwMTQgR05PTUUgcmVwbGljYSBwZXIgdGhlIHByb3RvdHlwZTogaGVybyBkYXRlLCBcdTIwMzkgbW9udGggXHUyMDNBIG5hdlxuLy8gKHRpdGxlIGNsaWNrID0gdG9kYXkpLCBJU08gd2VlayBudW1iZXJzIGFzIHF1aWV0IGRpbSB0ZXh0LCBESU1NRUQgV0VFS0VORFMsXG4vLyBjbGlja2FibGUgZGF5cyB3LyBzZWxlY3Rpb24gcmluZyAoaW5rIHJpbmcgb24gdG9kYXkpLCBldmVudC1kb3QgbWFya2Vycyxcbi8vIGV2ZW50cyBjYXJkIGluIHRoZSBub3RpZmljYXRpb24tY2FyZCBsYW5ndWFnZS4gTW9udGhzIHNsaWRlIChtdWx0aXZpZXcgbW90aW9uKS5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuXG5pbnRlcmZhY2UgRXYge1xuICAgIHQ6IHN0cmluZ1xuICAgIG46IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xufVxuLy8gXCJ0b2RheVwiIFx1MjAxNCB1bmRlciBLT0JFTF9ERU1PLCBwaW5uZWQgdG8gRC50b2RheTsgcmVhbCBjbG9jayBvdGhlcndpc2UuXG4vLyB0b2RheVZhciBwb2xscyBldmVyeSA2MHMgc28gdGhlIGhlcm8gZGF0ZSB1cGRhdGVzIHdpdGhvdXQgYSByZWxvYWQuXG5jb25zdCB0b2RheVZhciA9IERFTU9cbiAgICA/IFZhcmlhYmxlKG5ldyBEYXRlKEQudG9kYXkueSwgRC50b2RheS5tLCBELnRvZGF5LmQpKVxuICAgIDogVmFyaWFibGUobmV3IERhdGUoKSkucG9sbCg2MF8wMDAsICgpID0+IG5ldyBEYXRlKCkpXG5jb25zdCBub3cgPSB0b2RheVZhci5nZXQoKVxuY29uc3Qga2V5ID0gKHk6IG51bWJlciwgbTogbnVtYmVyLCBkOiBudW1iZXIpID0+IGAke3l9LSR7bSArIDF9LSR7ZH1gXG5leHBvcnQgY29uc3QgRVZFTlRTOiBSZWNvcmQ8c3RyaW5nLCBFdltdPiA9IHtcbiAgICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSldOiBbXG4gICAgICAgIHsgdDogXCIwOTo0NVwiLCBuOiBcIkRhaWx5IFN0YW5kdXBcIiwgaWNvbjogXCJrb2JlbC12aWRlby1zeW1ib2xpY1wiIH0sXG4gICAgXSxcbiAgICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMTEpXTogW1xuICAgICAgICB7IHQ6IFwiMTA6MzBcIiwgbjogXCJLaWVyYW4gQmlydGhkYXlcIiwgaWNvbjogXCJrb2JlbC1jYWtlLXN5bWJvbGljXCIgfSxcbiAgICAgICAgeyB0OiBcIjEzOjAwXCIsIG46IFwiTG9uZG9uIFRoaW5nXCIsIGljb246IFwia29iZWwtcGluLXN5bWJvbGljXCIgfSxcbiAgICBdLFxuICAgIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxMyldOiBbXG4gICAgICAgIHsgdDogXCJBbGwgZGF5XCIsIG46IFwiTXkgQmlydGhkYXlcIiwgaWNvbjogXCJrb2JlbC1jYWtlLXN5bWJvbGljXCIgfSxcbiAgICBdLFxufVxuXG5jb25zdCB2aWV3ID0gVmFyaWFibGUoeyB5OiBub3cuZ2V0RnVsbFllYXIoKSwgbTogbm93LmdldE1vbnRoKCkgfSlcbmNvbnN0IHNlbCA9IFZhcmlhYmxlKG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSkpXG5cbmZ1bmN0aW9uIGlzb1dlZWsoZDogRGF0ZSk6IG51bWJlciB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKERhdGUuVVRDKGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSkpXG4gICAgY29uc3QgZG4gPSAodC5nZXRVVENEYXkoKSArIDYpICUgN1xuICAgIHQuc2V0VVRDRGF0ZSh0LmdldFVUQ0RhdGUoKSAtIGRuICsgMylcbiAgICBjb25zdCBmID0gbmV3IERhdGUoRGF0ZS5VVEModC5nZXRVVENGdWxsWWVhcigpLCAwLCA0KSlcbiAgICByZXR1cm4gMSArIE1hdGgucm91bmQoKCgrdCAtICtmKSAvIDg2NGU1IC0gMyArICgoZi5nZXRVVENEYXkoKSArIDYpICUgNykpIC8gNylcbn1cblxuZnVuY3Rpb24gR3JpZCgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiY2FsLWdyaWRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfT5cbiAgICAgICAgICAgIHtiaW5kKFZhcmlhYmxlLmRlcml2ZShbdmlldywgc2VsXSwgKHYsIHMpID0+ICh7IHYsIHMgfSkpKS5hcygoeyB2LCBzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaXJzdCA9IG5ldyBEYXRlKHYueSwgdi5tLCAxKVxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gKGZpcnN0LmdldERheSgpICsgNikgJSA3XG4gICAgICAgICAgICAgICAgY29uc3QgZGF5cyA9IG5ldyBEYXRlKHYueSwgdi5tICsgMSwgMCkuZ2V0RGF0ZSgpXG4gICAgICAgICAgICAgICAgY29uc3QgcHJldkRheXMgPSBuZXcgRGF0ZSh2LnksIHYubSwgMCkuZ2V0RGF0ZSgpXG4gICAgICAgICAgICAgICAgY29uc3Qgcm93cyA9IFtdXG4gICAgICAgICAgICAgICAgcm93cy5wdXNoKFxuICAgICAgICAgICAgICAgICAgICA8Ym94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHdpZHRoUmVxdWVzdD17MjJ9IGxhYmVsPVwiXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggaG9tb2dlbmVvdXMgaGV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7W1wiTVwiLCBcIlRcIiwgXCJXXCIsIFwiVFwiLCBcIkZcIiwgXCJTXCIsIFwiU1wiXS5tYXAoKGQpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiZG93XCIgbGFiZWw9e2R9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgNjsgcisrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHdrTGFiZWwgPSAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIndrIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB3aWR0aFJlcXVlc3Q9ezIyfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YCR7aXNvV2VlayhuZXcgRGF0ZSh2LnksIHYubSwgciAqIDcgLSBzdGFydCArIDEpKX1gfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBkYXlDZWxscyA9IFtdXG4gICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgNzsgYysrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpID0gciAqIDcgKyBjLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGQgPSBpIC0gc3RhcnQgKyAxXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvdXQgPSBkIDwgMSB8fCBkID4gZGF5c1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBvdXQgPyAoZCA8IDEgPyBwcmV2RGF5cyArIGQgOiBkIC0gZGF5cykgOiBkXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjbHMgPSBbXCJkYXlcIl1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjID49IDUpIGNscy5wdXNoKFwid2VcIikgLy8gV0VFS0VORFMgRElNTUVEXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob3V0KSBjbHMucHVzaChcIm91dFwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9kYXkgPSBub3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGQgPT09IHRvZGF5LmdldERhdGUoKSAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2Lm0gPT09IHRvZGF5LmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdi55ID09PSB0b2RheS5nZXRGdWxsWWVhcigpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHMucHVzaChcInRvZGF5XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEVWRU5UU1trZXkodi55LCB2Lm0sIGQpXSkgY2xzLnB1c2goXCJldlwiKSAvLyBldmVudC1kb3QgKENTUyA6OmFmdGVyIFx1MjE5MiB1bmRlcmxpbmUgZG90KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcy5nZXREYXRlKCkgPT09IGQgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcy5nZXRNb250aCgpID09PSB2Lm0gJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcy5nZXRGdWxsWWVhcigpID09PSB2LnlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNscy5wdXNoKFwic2VsXCIpXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBoYXNFdiA9ICFvdXQgJiYgISFFVkVOVFNba2V5KHYueSwgdi5tLCBkKV1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGRheSBzaXRzIGF0IGl0cyBuYXR1cmFsIDI0XHUwMEQ3MjQgY2VudHJlZCBpbiB0aGUgZ3JpZCBjb2x1bW5cbiAgICAgICAgICAgICAgICAgICAgICAgIGRheUNlbGxzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb3V0ID8gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtjbHMuam9pbihcIiBcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YCR7bGFiZWx9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzZWwuc2V0KG5ldyBEYXRlKHYueSwgdi5tLCBkKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtoYXNFdiA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8b3ZlcmxheT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXtgJHtsYWJlbH1gfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogM3B4IGV2ZW50IGRvdCwgYWJzb2x1dGUgYm90dG9tLWNlbnRlciAoR1RLIGhhcyBubyA6OmFmdGVyKSAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT1cIm92ZXJsYXlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJldmRvdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9e2Ake2xhYmVsfWB9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgLy8gd2sgY29sIGZpeGVkIDI4cHgsIGRheSBjZWxscyBzaGFyZSByZW1haW5pbmcgc3BhY2UgZXF1YWxseSAoaG9tb2dlbmVvdXMpXG4gICAgICAgICAgICAgICAgICAgIHJvd3MucHVzaChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge3drTGFiZWx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBob21vZ2VuZW91cyBoZXhwYW5kPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7ZGF5Q2VsbHN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gcm93c1xuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gRXZlbnRzQ2FyZCgpIHtcbiAgICAvLyBQcm90b3R5cGUgLmNhbGV2OiBhIHBhbmVsMiBjYXJkIChwYWQxMC9yMTIpIHdyYXBwaW5nIHRoZSBkYXRlIGhlYWRlciArIGRhcmtlclxuICAgIC8vICgtLXBhbmVsKSBldmVudCByb3dzOyBoZWFkZXIncyBvd24gYm90dG9tIHBhZGRpbmcgaXMgdGhlIGhlYWRlclx1MjE5MnJvdyBnYXAgKHNwYWNpbmcgMCkuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImV2Y2FyZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAge2JpbmQoc2VsKS5hcygoZCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGV2cyA9IEVWRU5UU1trZXkoZC5nZXRGdWxsWWVhcigpLCBkLmdldE1vbnRoKCksIGQuZ2V0RGF0ZSgpKV0gPz8gW11cbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkID0gKFxuICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZXZoZWFkXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2QudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlZWtkYXk6IFwibG9uZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRheTogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9udGg6IFwibG9uZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIGlmICghZXZzLmxlbmd0aClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWQsXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZXZlbXB0eVwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNhbGVuZGFyLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJObyBldmVudHNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+LFxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICAgICAgaGVhZCxcbiAgICAgICAgICAgICAgICAgICAgLi4uZXZzLm1hcCgoZSkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImV2cm93XCIgc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiAyNlx1MDBENzI2IHI4IGNvbG9yZWQgaWNvbiB0aWxlIChwcm90b3R5cGUgLmV2aWMpLCB3aGl0ZSBnbHlwaCAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZXZpY1wiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17ZS5pY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e2Uubn0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViIHRuXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtlLnR9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgKSksXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQ2FsZW5kYXIoKSB7XG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwiY2FsZW5kYXJcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImNhbGVuZGFyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWNhbGVuZGFyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiY2FsZW5kYXItd2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1B9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChjbG9zZSgpLCB0cnVlKSA6IGZhbHNlKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0RPV059XG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMjB9XG4gICAgICAgICAgICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2hlZXQgY2FsXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjYWxoZXJvXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN1YlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGVyb1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRheTogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb250aDogXCJsb25nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5ZWFyOiBcIm51bWVyaWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDxjZW50ZXJib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0KHYubSA/IHsgeTogdi55LCBtOiB2Lm0gLSAxIH0gOiB7IHk6IHYueSAtIDEsIG06IDExIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLWxlZnQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtb250aFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB2aWV3LnNldCh7IHk6IG5vdy5nZXRGdWxsWWVhcigpLCBtOiBub3cuZ2V0TW9udGgoKSB9KX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodmlldykuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAodikgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgRGF0ZSh2LnksIHYubSkudG9Mb2NhbGVTdHJpbmcoXCJlblwiLCB7IG1vbnRoOiBcImxvbmdcIiB9KSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHYueSAhPT0gbm93LmdldEZ1bGxZZWFyKCkgPyBgICR7di55fWAgOiBcIlwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdiA9IHZpZXcuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlldy5zZXQodi5tID09PSAxMSA/IHsgeTogdi55ICsgMSwgbTogMCB9IDogeyB5OiB2LnksIG06IHYubSArIDEgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICAgICAgICAgICAgICA8R3JpZCAvPlxuICAgICAgICAgICAgICAgICAgICA8RXZlbnRzQ2FyZCAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFF1aWNrIHNldHRpbmdzLiBQcm90b3R5cGUtZmluYWw6IHVuaWZvcm0gcGlsbCB0aWxlcyBmcm9tIGEgQ0FUQUxPRyAoY3VzdG9taXNhYmxlLFxuLy8gcGVyc2lzdGVkKSwgR05PTUUgdGhpbiBzbGlkZXJzLCBkcmlsbGRvd25zIGFzIGEgc3ByaW5nLXNsaWQgdHdvLXZpZXcgc3RhY2tcbi8vIChXaS1GaSBuZXR3b3JrcyAvIEJUIGRldmljZXMgLyBwZXItYXBwIG1peGVyIHdpdGggYSBNYXN0ZXIgcm93KSwgY29tcGFjdCB0b3Agcm93XG4vLyAoYmF0dGVyeSBcdTAwQjcgcGVuY2lsL2xlYWYvbG9jay9wb3dlciksIGdub2JsaW4gYmFubmVyICsgcmVjb25uZWN0IHdoaWxlIGRlZ3JhZGVkLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IEJsdWV0b290aCBmcm9tIFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IHsgY29ubmVjdGVkLCByZWxvYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBNT1RJT04gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciwgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5pbXBvcnQgeyBUaW55U2xpZGVyIH0gZnJvbSBcIi4uL2xpYi90aW55c2xpZGVyXCJcbmltcG9ydCB7IEZpeGVkQ2hldiB9IGZyb20gXCIuLi9saWIvZml4ZWRjaGV2XCJcblxudHlwZSBEcmlsbCA9IG51bGwgfCBcIndpZmlcIiB8IFwiYnRcIiB8IFwibWl4XCJcbi8vIEtPQkVMX0RSSUxMIGxldHMgdGhlIGRldmtpdCByZW5kZXIgYSBkcmlsbGRvd24gZGlyZWN0bHkgKG5vIHBvaW50ZXIgdG8gY2xpY2sgdGhlXG4vLyBjaGV2cm9uIGluIGhlYWRsZXNzKTsgcHJvZHVjdGlvbiBkZWZhdWx0IGlzIG51bGwuXG5jb25zdCBkcmlsbCA9IFZhcmlhYmxlPERyaWxsPigoR0xpYi5nZXRlbnYoXCJLT0JFTF9EUklMTFwiKSBhcyBEcmlsbCkgfHwgbnVsbClcblxuLy8gVGlsZSBjYXRhbG9nIFx1MjAxNCBtaXJyb3JzIHByb3RvdHlwZSBDQVRBTE9HOyBwZXJzaXN0ZWQgbGF5b3V0IGluIHN0YXRlIGRpci5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvcXMtdGlsZXMuanNvbmBcbmxldCB0aWxlczogc3RyaW5nW10gPSBbXCJ3aWZpXCIsIFwiYnRcIiwgXCJzYXZlXCIsIFwiZGFya1wiLCBcInNpbGVudFwiLCBcIm5pZ2h0XCIsIFwidm9sdW1lXCIsIFwiYnJpZ2h0bmVzc1wiXVxudHJ5IHtcbiAgICB0aWxlcyA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKEdMaWIuZmlsZV9nZXRfY29udGVudHMoU1RPUkUpWzFdKSlcbn0gY2F0Y2gge31cblxuZnVuY3Rpb24gQ2hpcChwcm9wczoge1xuICAgIGlkOiBzdHJpbmdcbiAgICBsYWJlbDogc3RyaW5nXG4gICAgaWNvbjogc3RyaW5nXG4gICAgYWN0aXZlOiBhbnlcbiAgICBzdWI/OiBhbnlcbiAgICBvblRvZ2dsZWQ6ICgpID0+IHZvaWRcbiAgICBvbkRyaWxsPzogKCkgPT4gdm9pZFxufSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9e2JpbmQocHJvcHMuYWN0aXZlKS5hcygoYTogYm9vbGVhbikgPT4gKGEgPyBcImNoaXAgcGlsbCBvblwiIDogXCJjaGlwIHBpbGxcIikpfT5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjaGlwYlwiIGhleHBhbmQ9e3RydWV9IG9uQ2xpY2tlZD17cHJvcHMub25Ub2dnbGVkfT5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3Byb3BzLmljb259IC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3Byb3BzLmxhYmVsfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAge3Byb3BzLnN1YiAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ViXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3Byb3BzLnN1Yn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIHsvKiBmaXhlZCAzMnB4IHNlYW0rY2hldnJvbiAocHJvdG8gLmNoZXZiKSBcdTIwMTQgaGV4cGFuZD1mYWxzZSBzbyB0aGUgbWFpbiBidXR0b24gb3ducyBzbGFjayAqL31cbiAgICAgICAgICAgIHtwcm9wcy5vbkRyaWxsICYmIChcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY2hldlwiIGhleHBhbmQ9e2ZhbHNlfSB3aWR0aFJlcXVlc3Q9ezMwfSBvbkNsaWNrZWQ9e3Byb3BzLm9uRHJpbGx9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gU2xpZGVycygpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICAvLyBJbiBERU1PIG1vZGUgcmVuZGVyIHRoZSB0d28gc2xpZGVycyByZWdhcmRsZXNzIG9mIGEgcmVhbCBzcGVha2VyLCBwaW5uZWQgdG8gdGhlXG4gICAgLy8gcHJvdG90eXBlJ3MgbW9jayB2YWx1ZXMgKHZvbHVtZSAwLjY0LCBicmlnaHRuZXNzIDAuODApIGZvciBhIGZhaXIgb3ZlcmxheS5cbiAgICBpZiAoIXNwZWFrZXIgJiYgIURFTU8pIHJldHVybiA8Ym94IC8+XG4gICAgY29uc3Qgdm9sSWNvbiA9IHNwZWFrZXJcbiAgICAgICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoKGkpID0+IGkgPz8gXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIilcbiAgICAgICAgOiBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiXG4gICAgLy8gcHJvdG8gLnNsaWRlcnMgaXMgYSBmbGV4IGNvbHVtbiB3aXRoIE5PIGdhcCBiZXR3ZWVuIHRoZSB0d28gc3Jvd3MgKGVhY2ggbWluLWggNDIpLlxuICAgIC8vIFRpbnlTbGlkZXIgb3ZlcnJpZGVzIHZmdW5jX21lYXN1cmUgdG8gcmVwb3J0IG5hdHVyYWw9MXB4IHNvIHRoZSBzcm93IGRvZXNuJ3RcbiAgICAvLyBpbmZsYXRlIHRoZSBwYW5lbCBiZXlvbmQgdGhlIGNoaXAtZ3JpZCB3aWR0aCAoR1RLIENTUyBtYXgtd2lkdGggaXMgbm90IHJlc3BlY3RlZCkuXG4gICAgY29uc3QgaW5pdFZvbCA9IERFTU8gPyBELnZvbHVtZSA6IE1hdGgubWluKHNwZWFrZXI/LnZvbHVtZSA/PyAwLjY0LCAxKVxuICAgIGNvbnN0IHZvbFZhbHVlID0gVmFyaWFibGUoaW5pdFZvbClcbiAgICBjb25zdCB2b2xTbGlkZXIgPSBuZXcgVGlueVNsaWRlcih7IGhleHBhbmQ6IHRydWUsIGNzc0NsYXNzZXM6IFtcInNsaWRlclwiXSwgdmFsdWU6IGluaXRWb2wgfSlcbiAgICBpZiAoIURFTU8gJiYgc3BlYWtlcilcbiAgICAgICAgYmluZChzcGVha2VyLCBcInZvbHVtZVwiKS5zdWJzY3JpYmUoKHY6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgdm9sU2xpZGVyLmdldF9hZGp1c3RtZW50KCkudmFsdWUgPSBNYXRoLm1pbih2LCAxKVxuICAgICAgICAgICAgdm9sVmFsdWUuc2V0KE1hdGgubWluKHYsIDEpKVxuICAgICAgICB9KVxuICAgIC8vIEd0a1JhbmdlOjpjaGFuZ2UtdmFsdWUgYXJnczogKHJhbmdlLCBzY3JvbGxUeXBlLCB2YWx1ZSlcbiAgICB2b2xTbGlkZXIuY29ubmVjdChcImNoYW5nZS12YWx1ZVwiLCAoX3M6IGFueSwgX3Q6IGFueSwgdjogbnVtYmVyKSA9PiB7XG4gICAgICAgIGlmIChzcGVha2VyKSBzcGVha2VyLnZvbHVtZSA9IHZcbiAgICAgICAgdm9sVmFsdWUuc2V0KHYpXG4gICAgfSlcblxuICAgIGNvbnN0IGJyaWdodFZhbHVlID0gVmFyaWFibGUoREVNTyA/IEQuYnJpZ2h0bmVzcyA6IDAuOClcbiAgICBpZiAoIURFTU8pIHtcbiAgICAgICAgUHJvbWlzZS5hbGwoW2V4ZWNBc3luYyhcImJyaWdodG5lc3NjdGwgZ2V0XCIpLCBleGVjQXN5bmMoXCJicmlnaHRuZXNzY3RsIG1heFwiKV0pXG4gICAgICAgICAgICAudGhlbigoW2N1ciwgbWF4XSkgPT4gYnJpZ2h0VmFsdWUuc2V0KHBhcnNlSW50KGN1ci50cmltKCkpIC8gcGFyc2VJbnQobWF4LnRyaW0oKSkpKVxuICAgICAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAgICAgICAvKiBicmlnaHRuZXNzY3RsIGFic2VudCBvbiBkZXNrdG9wICovXG4gICAgICAgICAgICB9KVxuICAgIH1cbiAgICBjb25zdCBicmlnaHRTbGlkZXIgPSBuZXcgVGlueVNsaWRlcih7XG4gICAgICAgIGhleHBhbmQ6IHRydWUsXG4gICAgICAgIGNzc0NsYXNzZXM6IFtcInNsaWRlclwiXSxcbiAgICAgICAgdmFsdWU6IGJyaWdodFZhbHVlLmdldCgpLFxuICAgIH0pXG4gICAgYnJpZ2h0VmFsdWUuc3Vic2NyaWJlKCh2KSA9PiB7XG4gICAgICAgIGJyaWdodFNsaWRlci5nZXRfYWRqdXN0bWVudCgpLnZhbHVlID0gdlxuICAgIH0pXG4gICAgYnJpZ2h0U2xpZGVyLmNvbm5lY3QoXCJjaGFuZ2UtdmFsdWVcIiwgKF9zOiBhbnksIF90OiBhbnksIHY6IG51bWJlcikgPT5cbiAgICAgICAgZXhlY0FzeW5jKGBicmlnaHRuZXNzY3RsIHNldCAke01hdGgucm91bmQodiAqIDEwMCl9JWApXG4gICAgICAgICAgICAudGhlbigoKSA9PiBicmlnaHRWYWx1ZS5zZXQodikpXG4gICAgICAgICAgICAuY2F0Y2goKCkgPT4ge30pXG4gICAgKVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cInNsaWRlcnNcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzcm93XCIgc3BhY2luZz17OX0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXt2b2xJY29ufSAvPlxuICAgICAgICAgICAgICAgIHt2b2xTbGlkZXJ9XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ZhbCB0blwiXG4gICAgICAgICAgICAgICAgICAgIHhhbGlnbj17MX1cbiAgICAgICAgICAgICAgICAgICAgd2lkdGhSZXF1ZXN0PXszMn1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodm9sVmFsdWUpLmFzKCh2KSA9PiBgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjaGV2XCIgd2lkdGhSZXF1ZXN0PXszMX0gb25DbGlja2VkPXsoKSA9PiBkcmlsbC5zZXQoXCJtaXhcIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1icmlnaHRuZXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICB7YnJpZ2h0U2xpZGVyfVxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN2YWwgdG5cIlxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezF9XG4gICAgICAgICAgICAgICAgICAgIHdpZHRoUmVxdWVzdD17MzJ9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGJyaWdodFZhbHVlKS5hcygodikgPT4gYCR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYCl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICB7LyogZ3V0dGVyIGFsaWducyB3aXRoIGNoZXYgd2lkdGggKFx1MjI0ODMxcHgpOyBzdmFsPTMyICsgc3BhY2luZz05IFx1MjE5MiBzcGFjZSB0YWtlbiAqL31cbiAgICAgICAgICAgICAgICA8Ym94IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBHbm9ibGluQmFubmVyKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJnYmFubmVyXCIgdmlzaWJsZT17REVNTyA/IGZhbHNlIDogYmluZChjb25uZWN0ZWQpLmFzKChjKSA9PiAhYyl9IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXdhcm5pbmctc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBoZXhwYW5kPlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJvcmcuZ25vYmxpbi5TaGVsbCBkaXNjb25uZWN0ZWRcIiAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInNcIlxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJvc2QgKyBub3RpZnMgaGFuZGVkIGJhY2sgdG8gZ25vbWVcIlxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJnYnRuXCIgbGFiZWw9XCJSZWNvbm5lY3RcIiBvbkNsaWNrZWQ9eygpID0+IHJlbG9hZCgpLmNhdGNoKCgpID0+IHt9KX0gLz5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBcdTI1MDBcdTI1MDAgcmVhbC1iYWNrZW5kIHRvZ2dsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4vLyBEYXJrIFN0eWxlOiBvcmcuZ25vbWUuZGVza3RvcC5pbnRlcmZhY2UgY29sb3Itc2NoZW1lXG5jb25zdCBpZmFjZVNldHRpbmdzID0gbmV3IEdpby5TZXR0aW5ncyh7IHNjaGVtYTogXCJvcmcuZ25vbWUuZGVza3RvcC5pbnRlcmZhY2VcIiB9KVxuY29uc3QgdERhcmsgPSBWYXJpYWJsZShpZmFjZVNldHRpbmdzLmdldF9zdHJpbmcoXCJjb2xvci1zY2hlbWVcIikgPT09IFwicHJlZmVyLWRhcmtcIilcbmlmYWNlU2V0dGluZ3MuY29ubmVjdChcImNoYW5nZWQ6OmNvbG9yLXNjaGVtZVwiLCAoKSA9PlxuICAgIHREYXJrLnNldChpZmFjZVNldHRpbmdzLmdldF9zdHJpbmcoXCJjb2xvci1zY2hlbWVcIikgPT09IFwicHJlZmVyLWRhcmtcIilcbilcblxuLy8gTmlnaHQgTGlnaHQ6IG9yZy5nbm9tZS5zZXR0aW5ncy1kYWVtb24ucGx1Z2lucy5jb2xvclxubGV0IGNvbG9yU2V0dGluZ3M6IEdpby5TZXR0aW5ncyB8IG51bGwgPSBudWxsXG5jb25zdCB0TmlnaHQgPSBWYXJpYWJsZShmYWxzZSlcbnRyeSB7XG4gICAgY29sb3JTZXR0aW5ncyA9IG5ldyBHaW8uU2V0dGluZ3MoeyBzY2hlbWE6IFwib3JnLmdub21lLnNldHRpbmdzLWRhZW1vbi5wbHVnaW5zLmNvbG9yXCIgfSlcbiAgICB0TmlnaHQuc2V0KGNvbG9yU2V0dGluZ3MuZ2V0X2Jvb2xlYW4oXCJuaWdodC1saWdodC1lbmFibGVkXCIpKVxuICAgIGNvbG9yU2V0dGluZ3MuY29ubmVjdChcImNoYW5nZWQ6Om5pZ2h0LWxpZ2h0LWVuYWJsZWRcIiwgKCkgPT5cbiAgICAgICAgdE5pZ2h0LnNldChjb2xvclNldHRpbmdzIS5nZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIikpXG4gICAgKVxufSBjYXRjaCB7XG4gICAgLyogc2NoZW1hIGFic2VudCBvbiBzb21lIHN5c3RlbXMgKi9cbn1cblxuLy8gU2lsZW50OiBtdXRlIG9uIHRoZSBkZWZhdWx0IFdpcmVQbHVtYmVyIHNwZWFrZXJcbmNvbnN0IF9zcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbmNvbnN0IHRTaWxlbnQgPSBfc3BlYWtlclxuICAgID8gKGJpbmQoX3NwZWFrZXIsIFwibXV0ZVwiKSBhcyB1bmtub3duIGFzIFZhcmlhYmxlPGJvb2xlYW4+KVxuICAgIDogVmFyaWFibGUoZmFsc2UpXG5cbi8vIFBvd2VyIFNhdmVyOiBwb3dlcnByb2ZpbGVzY3RsIChmYWxscyBiYWNrIHRvIGZhbHNlIGlmIHVuYXZhaWxhYmxlKVxuY29uc3QgdFNhdmUgPSBWYXJpYWJsZShmYWxzZSlcbmV4ZWNBc3luYyhcInBvd2VycHJvZmlsZXNjdGwgZ2V0XCIpXG4gICAgLnRoZW4oKHYpID0+IHRTYXZlLnNldCh2LnRyaW0oKSA9PT0gXCJwb3dlci1zYXZlclwiKSlcbiAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAvKiBwb3dlcnByb2ZpbGVzY3RsIGFic2VudCAqL1xuICAgIH0pXG5cbi8vIGVkaXQtbW9kZSBmb3IgdGhlIHRpbGUgY2F0YWxvZyAocGVuY2lsIGJ1dHRvbikgXHUyMDE0IGhvb2sgZm9yIHRpbGUgcmVhcnJhbmdlL2N1c3RvbWlzZS5cbmNvbnN0IGVkaXRNb2RlID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIFByb3RvdHlwZSB0b2dnbGUgY2hpcHMgYXJlIGxhYmVsLW9ubHksIHZlcnRpY2FsbHkgY2VudGVyZWQgXHUyMDE0IHN0YXRlIGlzIHNob3duIGJ5IHRoZVxuLy8gbGVhZiBmaWxsLCBub3QgYSBzdWItbGluZSAob25seSBXaS1GaS9CbHVldG9vdGggY2FycnkgYSBzdWIpLlxuZnVuY3Rpb24gVG9nZ2xlQ2hpcChwcm9wczoge1xuICAgIGxhYmVsOiBzdHJpbmdcbiAgICBpY29uOiBzdHJpbmdcbiAgICB2OiBWYXJpYWJsZTxib29sZWFuPlxuICAgIG9uVG9nZ2xlZD86ICgpID0+IHZvaWRcbn0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Q2hpcFxuICAgICAgICAgICAgaWQ9e3Byb3BzLmxhYmVsfVxuICAgICAgICAgICAgbGFiZWw9e3Byb3BzLmxhYmVsfVxuICAgICAgICAgICAgaWNvbj17cHJvcHMuaWNvbn1cbiAgICAgICAgICAgIGFjdGl2ZT17YmluZChwcm9wcy52KX1cbiAgICAgICAgICAgIG9uVG9nZ2xlZD17cHJvcHMub25Ub2dnbGVkID8/ICgoKSA9PiBwcm9wcy52LnNldCghcHJvcHMudi5nZXQoKSkpfVxuICAgICAgICAvPlxuICAgIClcbn1cblxuZnVuY3Rpb24gYmF0dGVyeU1ldGEoKTogYW55IHtcbiAgICBjb25zdCBiYXQgPSBCYXR0ZXJ5LmdldF9kZWZhdWx0KClcbiAgICBpZiAoIWJhdCkgcmV0dXJuIG51bGxcbiAgICByZXR1cm4gYmluZChiYXQsIFwicGVyY2VudGFnZVwiKS5hcygocCkgPT4ge1xuICAgICAgICBjb25zdCBwY3QgPSBNYXRoLnJvdW5kKHAgKiAxMDApXG4gICAgICAgIGNvbnN0IHN0YXRlID0gYmF0LmZ1bGwgPyBcIkZ1bGx5IGNoYXJnZWRcIiA6IGJhdC5jaGFyZ2luZyA/IFwiQ2hhcmdpbmdcIiA6IFwiRGlzY2hhcmdpbmdcIlxuICAgICAgICByZXR1cm4gYCR7cGN0fSUgXHUwMEI3ICR7c3RhdGV9YFxuICAgIH0pXG59XG5jb25zdCBoYXNCYXR0ZXJ5ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpICE9IG51bGxcblxuZnVuY3Rpb24gUm9vdCh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gICAgLy8gc3BhY2luZyAwOiBleGFjdCBzZWN0aW9uIGdhcHMgY29tZSBmcm9tIG1hcmdpbnMgKHF0b3BcdTIxOTJjaGlwcyAxLCBjaGlwIHJvd3MgOCxcbiAgICAvLyBjaGlwc1x1MjE5MnNsaWRlcnMgMTApIFx1MjAxNCBhIHVuaWZvcm0gYm94IHNwYWNpbmcgY2FuJ3QgZXhwcmVzcyBhbGwgdGhyZWUuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgIHsvKiB0b3Agcm93OiBiYXR0ZXJ5IFx1MDBCNyByZWxvYWQgXHUwMEI3IGxvY2sgXHUwMEI3IHBvd2VyICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInFzLXRvcFwiIHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgIHsvKiBiYXR0ZXJ5IHBpbGw6IGdseXBoICsgdGFidWxhciBtZXRhIFx1MjAxNCBoaWRkZW4gd2hlbiBubyBiYXR0ZXJ5IHByZXNlbnQgKi99XG4gICAgICAgICAgICAgICAgeyhERU1PIHx8IGhhc0JhdHRlcnkpICYmIChcbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1ldGFcIiBzcGFjaW5nPXs2fSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0blwiIGxhYmVsPXtERU1PID8gRC5tZXRhIDogYmF0dGVyeU1ldGEoKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICA8Ym94IGhleHBhbmQgLz5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0biBsZWFmXCIgb25DbGlja2VkPXsoKSA9PiByZWxvYWQoKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWxlYWYtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuXCIgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJsb2dpbmN0bCBsb2NrLXNlc3Npb25cIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1sb2NrLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZWRpdE1vZGUuc2V0KCFlZGl0TW9kZS5nZXQoKSl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wZW5jaWwtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuIGRhbmdlclwiIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxHbm9ibGluQmFubmVyIC8+XG4gICAgICAgICAgICB7Lyogb25lIGNoaXBzIGdyaWQ6IDMgcm93cyBhdCA4cHgsIG1hcmdpbi1ib3R0b20gMTAgYmVmb3JlIHRoZSBzbGlkZXJzICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXAtZ3JpZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICB7KERFTU8gfHwgbmV0LndpZmkpICYmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWQ9XCJ3aWZpXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIldpLUZpXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtd2lmaS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtERU1PID8gVmFyaWFibGUodHJ1ZSkgOiBiaW5kKG5ldC53aWZpISwgXCJlbmFibGVkXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1Yj17REVNTyA/IEQud2lmaVNzaWQgOiBiaW5kKG5ldC53aWZpISwgXCJzc2lkXCIpLmFzKChzKSA9PiBzID8/IFwiT2ZmXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIURFTU8gJiYgbmV0LndpZmkpIG5ldC53aWZpLmVuYWJsZWQgPSAhbmV0LndpZmkuZW5hYmxlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25EcmlsbD17KCkgPT4gZHJpbGwuc2V0KFwid2lmaVwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDxDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBpZD1cImJ0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiQmx1ZXRvb3RoXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1ibHVldG9vdGgtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gVmFyaWFibGUodHJ1ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoKGQpID0+IGQuc29tZSgoeCkgPT4geC5jb25uZWN0ZWQpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgc3ViPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5idERldmljZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKGQpID0+IGQuZmluZCgoeCkgPT4geC5jb25uZWN0ZWQpPy5hbGlhcyA/PyBcIk9mZlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFERU1PKSBidC50b2dnbGUoKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uRHJpbGw9eygpID0+IGRyaWxsLnNldChcImJ0XCIpfVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJQb3dlciBTYXZlclwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtYm9sdC1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICB2PXt0U2F2ZX1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSAhdFNhdmUuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBleGVjQXN5bmMoYHBvd2VycHJvZmlsZXNjdGwgc2V0ICR7bmV4dCA/IFwicG93ZXItc2F2ZXJcIiA6IFwiYmFsYW5jZWRcIn1gKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGhlbigoKSA9PiB0U2F2ZS5zZXQobmV4dCkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB0U2F2ZS5zZXQobmV4dCkpXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJEYXJrIFN0eWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1tb29uLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3REYXJrfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9ICF0RGFyay5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmYWNlU2V0dGluZ3Muc2V0X3N0cmluZyhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJjb2xvci1zY2hlbWVcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV4dCA/IFwicHJlZmVyLWRhcmtcIiA6IFwiZGVmYXVsdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgPFRvZ2dsZUNoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiU2lsZW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1iZWxsLXNsYXNoLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3RTaWxlbnR9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoX3NwZWFrZXIpIF9zcGVha2VyLm11dGUgPSAhX3NwZWFrZXIubXV0ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPFRvZ2dsZUNoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiTmlnaHQgTGlnaHRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLXN1bi1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICB2PXt0TmlnaHR9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoY29sb3JTZXR0aW5ncylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29sb3JTZXR0aW5ncy5zZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIiwgIXROaWdodC5nZXQoKSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxTbGlkZXJzIC8+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gU2lnbmFsLXN0cmVuZ3RoIGdseXBoIGZvciBhbiBhY2Nlc3MgcG9pbnQgKDBcdTIwMTMxMDAgXHUyMTkyIHdpZmkgdGllcnMpLlxuZnVuY3Rpb24gd2lmaUljb24oc3RyZW5ndGg6IG51bWJlcik6IHN0cmluZyB7XG4gICAgcmV0dXJuIFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIC8vIHNpbmdsZSBnbHlwaDsgc3RyZW5ndGggc2hvd24gYXMgdGV4dCBtZXRhXG59XG5cbi8vIFdpLUZpIEFQIGxpc3QgXHUyMDE0IHJlYWwgQXN0YWxOZXR3b3JrIGFjY2VzcyBwb2ludHMsIGNvbm5lY3RlZCBvbmUgbWFya2VkIC5hY3RpdmUuXG5mdW5jdGlvbiBXaWZpTGlzdCgpIHtcbiAgICBjb25zdCB3aWZpID0gTmV0d29yay5nZXRfZGVmYXVsdCgpLndpZmlcbiAgICBpZiAoIXdpZmkpIHJldHVybiA8Ym94IC8+XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICB7YmluZCh3aWZpLCBcImFjY2Vzc1BvaW50c1wiKS5hcygoYXBzKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gd2lmaS5hY3RpdmVBY2Nlc3NQb2ludFxuICAgICAgICAgICAgICAgIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgICAgICAgICAgICAgIHJldHVybiBhcHNcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigoYXApID0+IGFwLnNzaWQgJiYgIXNlZW4uaGFzKGFwLnNzaWQpICYmIHNlZW4uYWRkKGFwLnNzaWQpKVxuICAgICAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gYi5zdHJlbmd0aCAtIGEuc3RyZW5ndGgpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCA2KVxuICAgICAgICAgICAgICAgICAgICAubWFwKChhcCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb24gPSBhY3RpdmUgJiYgYXAuc3NpZCA9PT0gYWN0aXZlLnNzaWRcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB3aWZpLmFjdGl2YXRlX2Nvbm5lY3Rpb24oYXAsIG51bGwpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3dpZmlJY29uKGFwLnN0cmVuZ3RoKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17YXAuc3NpZH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwieHNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtvbiA/IFwiQ29ubmVjdGVkXCIgOiBgJHthcC5zdHJlbmd0aH0lYH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gQmx1ZXRvb3RoIGRldmljZSBsaXN0IFx1MjAxNCBzYW1lIC54cm93IGdyYW1tYXIgYXMgV2ktRmk7IGNvbm5lY3RlZCBkZXZpY2UgaXMgLmFjdGl2ZS5cbmZ1bmN0aW9uIEJ0TGlzdCgpIHtcbiAgICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICB7YmluZChidCwgXCJkZXZpY2VzXCIpLmFzKChkZXZpY2VzKSA9PlxuICAgICAgICAgICAgICAgIGRldmljZXNcbiAgICAgICAgICAgICAgICAgICAgLmZpbHRlcigoZCkgPT4gZC5uYW1lIHx8IGQuYWxpYXMpXG4gICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBOdW1iZXIoYi5jb25uZWN0ZWQpIC0gTnVtYmVyKGEuY29ubmVjdGVkKSlcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKGRldikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3Qgb24gPSBkZXYuY29ubmVjdGVkXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e29uID8gXCJ4cm93IGFjdGl2ZVwiIDogXCJ4cm93XCJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uID8gZGV2LmRpc2Nvbm5lY3RfZGV2aWNlKCkgOiBkZXYuY29ubmVjdF9kZXZpY2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJsdWV0b290aC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2Rldi5hbGlhcyB8fCBkZXYubmFtZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInhzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uID8gXCJDb25uZWN0ZWRcIiA6IGRldi5wYWlyZWQgPyBcIlBhaXJlZFwiIDogXCJBdmFpbGFibGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBPbmUgbWl4ZXIgcm93ICgubWl4cm93KSBcdTIwMTQgaG9yaXpvbnRhbDogMjZcdTAwRDcyNiBpY29uIHRpbGUgXHUwMEI3IDcycHggbmFtZSBcdTAwQjcgc2xpZGVyIGZpbGxzLlxuZnVuY3Rpb24gTWl4Um93KHByb3BzOiB7IGljb246IHN0cmluZzsgdGl0bGU6IHN0cmluZzsgdGFyZ2V0OiBhbnkgfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJtaXhyb3dcIiBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibWlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17cHJvcHMuaWNvbn0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJtbmFtZVwiXG4gICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICBsYWJlbD17cHJvcHMudGl0bGV9XG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPHNsaWRlclxuICAgICAgICAgICAgICAgIGNsYXNzPVwic2xpZGVyXCJcbiAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIHZhbHVlPXtiaW5kKHByb3BzLnRhcmdldCwgXCJ2b2x1bWVcIil9XG4gICAgICAgICAgICAgICAgb25DaGFuZ2VWYWx1ZT17KF9zLCB2KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHByb3BzLnRhcmdldC52b2x1bWUgPSB2XG4gICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gUGVyLWFwcCB2b2x1bWUgbWl4ZXIgXHUyMDE0IE1hc3RlciAoZGVmYXVsdCBzcGVha2VyKSArIGVhY2ggYXVkaW8gc3RyZWFtIChBc3RhbFdwKS5cbmZ1bmN0aW9uIE1peExpc3QoKSB7XG4gICAgY29uc3Qgd3AgPSBXcC5nZXRfZGVmYXVsdCgpXG4gICAgaWYgKCF3cCkgcmV0dXJuIDxib3ggLz5cbiAgICBjb25zdCBzcGVha2VyID0gd3AuZGVmYXVsdF9zcGVha2VyXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICB7c3BlYWtlciAmJiAoXG4gICAgICAgICAgICAgICAgPE1peFJvdyBpY29uPVwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIgdGl0bGU9XCJPdXRwdXRcIiB0YXJnZXQ9e3NwZWFrZXJ9IC8+XG4gICAgICAgICAgICApfVxuICAgICAgICAgICAge2JpbmQod3AuYXVkaW8sIFwic3RyZWFtc1wiKS5hcygoc3RyZWFtcykgPT5cbiAgICAgICAgICAgICAgICBzdHJlYW1zXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCA1KVxuICAgICAgICAgICAgICAgICAgICAubWFwKChzKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8TWl4Um93XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZT17cy5kZXNjcmlwdGlvbiB8fCBzLm5hbWUgfHwgXCJBcHBsaWNhdGlvblwifVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhcmdldD17c31cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICkpXG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIERyaWxsVmlldyh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IG5hbWU9e25hbWV9IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgPGNlbnRlcmJveCBjbGFzcz1cImRoZWFkXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG5cIiBtYXJnaW5FbmQ9ezE1fSBvbkNsaWNrZWQ9eygpID0+IGRyaWxsLnNldChudWxsKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tbGVmdC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGRyaWxsKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgIGQgPT09IFwid2lmaVwiID8gXCJXaS1GaVwiIDogZCA9PT0gXCJidFwiID8gXCJCbHVldG9vdGhcIiA6IFwiVm9sdW1lXCJcbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDxib3ggd2lkdGhSZXF1ZXN0PXs0Nn0gaGFsaWduPXtHdGsuQWxpZ24uRU5EfT5cbiAgICAgICAgICAgICAgICAgICAge25ldC53aWZpICYmIChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxzd2l0Y2hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e2JpbmQobmV0LndpZmksIFwiZW5hYmxlZFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcygoZCkgPT4gZCA9PT0gXCJ3aWZpXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXsocykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXQud2lmaSEuZW5hYmxlZCA9IHMuYWN0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDxzd2l0Y2hcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZT17YmluZChCbHVldG9vdGguZ2V0X2RlZmF1bHQoKSwgXCJwb3dlcmVkXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChkcmlsbCkuYXMoKGQpID0+IGQgPT09IFwiYnRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICBvbk5vdGlmeUFjdGl2ZT17KHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCbHVldG9vdGguZ2V0X2RlZmF1bHQoKS5hZGFwdGVyLnBvd2VyZWQgPSBzLmFjdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICAgICAge2JpbmQoZHJpbGwpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgIGQgPT09IFwid2lmaVwiID8gKFxuICAgICAgICAgICAgICAgICAgICA8V2lmaUxpc3QgLz5cbiAgICAgICAgICAgICAgICApIDogZCA9PT0gXCJidFwiID8gKFxuICAgICAgICAgICAgICAgICAgICA8QnRMaXN0IC8+XG4gICAgICAgICAgICAgICAgKSA6IGQgPT09IFwibWl4XCIgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxNaXhMaXN0IC8+XG4gICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgPGJveCAvPlxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gUXVpY2tTZXR0aW5ncygpIHtcbiAgICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjIwLCAxNTApXG4gICAgcmVnaXN0ZXIoXCJxdWlja3NldHRpbmdzXCIsIHRvZ2dsZUZuKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJxdWlja3NldHRpbmdzXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLXFzXCJcbiAgICAgICAgICAgIGNsYXNzPVwicXMtd2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFR9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gR2RrLktFWV9Fc2NhcGUpIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgICAgIGlmIChkcmlsbC5nZXQoKSkge1xuICAgICAgICAgICAgICAgICAgICBkcmlsbC5zZXQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9IC8vIEVzYyBzdGVwcyBiYWNrIGZpcnN0XG4gICAgICAgICAgICAgICAgY2xvc2UoKVxuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChyZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzaGVldCBxc1wiPlxuICAgICAgICAgICAgICAgICAgICB7LyogR3RrLlN0YWNrIHdpdGggc2xpZGUtbGVmdC9yaWdodCA9IHRoZSBtdWx0aXZpZXc7IGhlaWdodCBhbmltYXRlc1xuICAgICAgICAgICAgdmlhIEFkdyBzcHJpbmcgb24gYSBzaXplLWdyb3VwIHdyYXBwZXIgKE1PVElPTi5kcmlsbCAvIGRyaWxsQmFjaykgKi99XG4gICAgICAgICAgICAgICAgICAgIDxzdGFja1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5TdGFja1RyYW5zaXRpb25UeXBlLlNMSURFX0xFRlRfUklHSFR9XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGVDaGlsZE5hbWU9e2JpbmQoZHJpbGwpLmFzKChkKSA9PiAoZCA/IFwiZHJpbGxcIiA6IFwicm9vdFwiKSl9XG4gICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxSb290IG5hbWU9XCJyb290XCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxEcmlsbFZpZXcgbmFtZT1cImRyaWxsXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9zdGFjaz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBUaW55U2xpZGVyIFx1MjAxNCBHdGsuU2NhbGUgc3ViY2xhc3MgdGhhdCByZXBvcnRzIG5lYXItemVybyBuYXR1cmFsIHdpZHRoIHNvIGl0XG4vLyBuZXZlciBmb3JjZXMgaXRzIHBhcmVudCBjb250YWluZXIgd2lkZXIgdGhhbiB0aGUgY2hpcC1ncmlkJ3MgbmF0dXJhbCB3aWR0aC5cbi8vIFdlIGV4dGVuZCBHdGsuU2NhbGUgZGlyZWN0bHkgKG5vdCBBc3RhbC5TbGlkZXIpIGJlY2F1c2UgQXN0YWwuU2xpZGVyJ3MgVmFsYVxuLy8gQyB2ZnVuY3MgY2FuIGludGVyY2VwdCB0aGUgbWVhc3VyZSBjaGFpbiBiZWZvcmUgdGhlIEdKUyBvdmVycmlkZSBpcyByZWFjaGVkLlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0a1wiXG5cbmV4cG9ydCBjb25zdCBUaW55U2xpZGVyID0gR09iamVjdC5yZWdpc3RlckNsYXNzKFxuICAgIHtcbiAgICAgICAgR1R5cGVOYW1lOiBcIktvYmVsVGlueVNjYWxlXCIsXG4gICAgfSxcbiAgICBjbGFzcyBUaW55U2xpZGVyIGV4dGVuZHMgR3RrLlNjYWxlIHtcbiAgICAgICAgY29uc3RydWN0b3IocGFyYW1zPzogUGFydGlhbDxHdGsuU2NhbGUuQ29uc3RydWN0b3JQcm9wcyAmIHsgdmFsdWU/OiBudW1iZXIgfT4pIHtcbiAgICAgICAgICAgIGNvbnN0IHsgdmFsdWUsIC4uLnJlc3QgfSA9IChwYXJhbXMgPz8ge30pIGFzIGFueVxuICAgICAgICAgICAgc3VwZXIoe1xuICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uOiBHdGsuT3JpZW50YXRpb24uSE9SSVpPTlRBTCxcbiAgICAgICAgICAgICAgICBhZGp1c3RtZW50OiBuZXcgR3RrLkFkanVzdG1lbnQoe1xuICAgICAgICAgICAgICAgICAgICBsb3dlcjogMCxcbiAgICAgICAgICAgICAgICAgICAgdXBwZXI6IDEsXG4gICAgICAgICAgICAgICAgICAgIHN0ZXBfaW5jcmVtZW50OiAwLjAxLFxuICAgICAgICAgICAgICAgICAgICBwYWdlX2luY3JlbWVudDogMC4xLFxuICAgICAgICAgICAgICAgICAgICBwYWdlX3NpemU6IDAsXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlOiB2YWx1ZSA/PyAwLFxuICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgIGRyYXdfdmFsdWU6IGZhbHNlLFxuICAgICAgICAgICAgICAgIC4uLnJlc3QsXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgdmZ1bmNfbWVhc3VyZShcbiAgICAgICAgICAgIG9yaWVudGF0aW9uOiBHdGsuT3JpZW50YXRpb24sXG4gICAgICAgICAgICBmb3Jfc2l6ZTogbnVtYmVyXG4gICAgICAgICk6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgICAgICAgICAgIGlmIChvcmllbnRhdGlvbiA9PT0gR3RrLk9yaWVudGF0aW9uLkhPUklaT05UQUwpIHtcbiAgICAgICAgICAgICAgICAvLyBSZXBvcnQgbmF0dXJhbD0xIHNvIHRoZSBzcm93L3NsaWRlcnMgY29udGFpbmVyIGRvZXNuJ3QgaW5mbGF0ZSB0aGUgUVMgcGFuZWxcbiAgICAgICAgICAgICAgICAvLyBiZXlvbmQgdGhlIGNoaXAtZ3JpZCBuYXR1cmFsIHdpZHRoLiBUaGUgc2xpZGVyIHN0aWxsIGhleHBhbmRzIHRvIGZpbGwgdGhlXG4gICAgICAgICAgICAgICAgLy8gYXZhaWxhYmxlIHNwYWNlIGF0IGFsbG9jYXRpb24gdGltZSBcdTIwMTQgb25seSB0aGUgbmF0dXJhbCBzaXplIGlzIG92ZXJyaWRkZW4uXG4gICAgICAgICAgICAgICAgcmV0dXJuIFswLCAxLCAtMSwgLTFdXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gc3VwZXIudmZ1bmNfbWVhc3VyZShvcmllbnRhdGlvbiwgZm9yX3NpemUpXG4gICAgICAgIH1cbiAgICB9XG4pXG4iLCAiLy8gTm90aWZpY2F0aW9ucy4gUHJvdG90eXBlLWZpbmFsOiBmbG9hdGluZyBibHVycmVkIHRvYXN0cyAodG9wLXJpZ2h0LCB0aGUgT05FXG4vLyBzYW5jdGlvbmVkIHRyYW5zbHVjZW5jeSkgKyByaWdodCBkcmF3ZXIgKG1lZGlhIGNhcmQgb24gdG9wLCBwYW5lbC1sZXNzIGNhcmRzXG4vLyBmbG9hdGluZyBvbiB3YWxscGFwZXIsIGhlYWRlciBjaGlwKS4gVGhlIHVuaWZpZWQgcGlwZWxpbmU6IG9wZW4gdGhlIGRyYXdlciB3aGlsZVxuLy8gYSB0b2FzdCBpcyBsaXZlIGFuZCBpdCdzIEFET1BURUQgaW50byB0aGUgc3RhY2s7IHRvYXN0cyBhcnJpdmluZyB3aGlsZSBvcGVuXG4vLyBpbnNlcnQgYXMgY2FyZHM7IFNpbGVudCByb3V0ZXMgc3RyYWlnaHQgdG8gdGhlIHN0b3JlLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQsIEdMaWIsIGV4ZWNBc3luYyB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTm90aWZkIGZyb20gXCJnaTovL0FzdGFsTm90aWZkXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG4vLyBMYXp5IHNpbmdsZXRvbiBcdTIwMTQgY2FsbGluZyBnZXRfZGVmYXVsdCgpIGF0IG1vZHVsZSBzY29wZSBibG9ja3MgdGhlIGltcG9ydCB3aGlsZVxuLy8gQXN0YWxOb3RpZmQgdHJpZXMgdG8gYWNxdWlyZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyAoaGFuZ3MgaWYgZ25vbWUtc2hlbGxcbi8vIHN0aWxsIG93bnMgaXQpLiBEZWZlcnJpbmcgdG8gZmlyc3QgdXNlIGxldHMgdGhlIG1vZHVsZSBpbXBvcnQgY2xlYW5seTsgdGhlIGJ1cyBpc1xuLy8gcmVsZWFzZWQgYnkgYGdub2JsaW5jdGwgZGlzYWJsZSBub3RpZmljYXRpb25zYCBiZWZvcmUgdGhlIGRhZW1vbiBhY3R1YWxseSBjbGFpbXMgaXQuXG5sZXQgX25vdGlmZDogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5jb25zdCBuZCA9ICgpID0+IChfbm90aWZkID8/PSBOb3RpZmQuZ2V0X2RlZmF1bHQoKSlcbmNvbnN0IHNraXAgPSAoKSA9PiAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIilcbmNvbnN0IFRPQVNUX01TID0gMzgwMFxuLy8gUmVhY3RpdmUgZHJhd2VyLW9wZW4gc3RhdGUgc28gdGhlIHRvYXN0cyBjYW4gYmUgQURPUFRFRCAoaGlkZGVuKSB0aGUgaW5zdGFudCB0aGVcbi8vIGRyYXdlciBvcGVucywgd2l0aG91dCBwb2xsaW5nIGEgbG9va2VkLXVwIHdpbmRvdydzIHZpc2liaWxpdHkuXG5jb25zdCBkcmF3ZXJPcGVuID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIE5vdGlmaWNhdGlvbiBjYXJkcyBcdTIwMTQgZml4ZWQgd2lkdGggc28gdGhlIHRvYXN0L2RyYXdlciBkb2Vzbid0IHN0cmV0Y2ggdG8gaGV4cGFuZCB0ZXh0LlxuLy8gTkNBUkRfVyA9IDM0MSBcdTIxOTIgbmNhcmQgb3V0ZXIgPSAzNDEgKyAyNHB4IENTUyBwYWRkaW5nID0gMzY1cHggPSBwcm90b3R5cGUgLS1wdyBhdCAxMjgwcHguXG5jb25zdCBOQ0FSRF9XID0gMzQxXG5cbi8vIFByb3RvdHlwZSBJQ0JHIG1hcDogaWNvbi10eXBlIFx1MjE5MiBuaWMgYmFja2dyb3VuZCBjb2xvciAob2tsY2ggaHVlcyBmcm9tIGRvY3MvcHJvdG90eXBlLmh0bWwpXG5jb25zdCBOSUNfQkc6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgXCJrb2JlbC1sZWFmLXN5bWJvbGljXCI6IFwiIzYyODkzM1wiLCAvLyBva2xjaCg1OCUgLjEyIDEzMCkgZ3JlZW4gPSBnbm9ibGluXG4gICAgXCJrb2JlbC1jaGF0LXN5bWJvbGljXCI6IFwiIzdjM2Y4Y1wiLCAvLyBva2xjaCg1NiUgLjEzIDMwMCkgcHVycGxlID0gbWVzc2FnZXNcbiAgICBcImtvYmVsLWRvd25sb2FkLXN5bWJvbGljXCI6IFwiIzNkNmZhNlwiLCAvLyBva2xjaCg1OCUgLjEgMjUwKSBibHVlID0gZG93bmxvYWRzXG59XG5cbmludGVyZmFjZSBDYXJkRGF0YSB7XG4gICAgaWNvbjogc3RyaW5nXG4gICAgc3VtbWFyeTogc3RyaW5nXG4gICAgYm9keTogc3RyaW5nXG4gICAgd2hlbjogc3RyaW5nXG4gICAgZGlzbWlzczogKCkgPT4gdm9pZFxufVxuXG5mdW5jdGlvbiB0b0NhcmREYXRhKG46IE5vdGlmZC5Ob3RpZmljYXRpb24pOiBDYXJkRGF0YSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgaWNvbjogbi5hcHBfaWNvbiB8fCBcImRpYWxvZy1pbmZvcm1hdGlvbi1zeW1ib2xpY1wiLFxuICAgICAgICBzdW1tYXJ5OiBuLnN1bW1hcnksXG4gICAgICAgIGJvZHk6IG4uYm9keSxcbiAgICAgICAgd2hlbjogbmV3IERhdGUobi50aW1lICogMTAwMCkudG9Mb2NhbGVUaW1lU3RyaW5nKFwiZW4tR0JcIiwge1xuICAgICAgICAgICAgaG91cjogXCIyLWRpZ2l0XCIsXG4gICAgICAgICAgICBtaW51dGU6IFwiMi1kaWdpdFwiLFxuICAgICAgICB9KSxcbiAgICAgICAgZGlzbWlzczogKCkgPT4gbi5kaXNtaXNzKCksXG4gICAgfVxufVxuXG5mdW5jdGlvbiBDYXJkKHsgbiB9OiB7IG46IENhcmREYXRhIH0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwibmNhcmRcIiBzcGFjaW5nPXsxMH0gd2lkdGhSZXF1ZXN0PXtOQ0FSRF9XfT5cbiAgICAgICAgICAgIHsvKiBhcHAgaWNvbiBpbiBhIDMwXHUwMEQ3MzAgcjkgdGlsZSAocHJvdG90eXBlIC5uaWMpOyBjb2xvci1jb2RlZCBwZXIgaWNvbiB0eXBlICovfVxuICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgIGNsYXNzPVwibmljXCJcbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICBjc3M9e05JQ19CR1tuLmljb25dID8gYGJhY2tncm91bmQtY29sb3I6ICR7TklDX0JHW24uaWNvbl19O2AgOiBcIlwifVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17bi5pY29ufSBwaXhlbFNpemU9ezE1fSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibnR4XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gaGV4cGFuZD5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwidFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGhleHBhbmQgZWxsaXBzaXplPXszfSBsYWJlbD17bi5zdW1tYXJ5fSAvPlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ3aGVuIHRuXCIgbGFiZWw9e24ud2hlbn0gLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJib2R5XCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgIHhhbGlnbj17MH1cbiAgICAgICAgICAgICAgICAgICAgd3JhcFxuICAgICAgICAgICAgICAgICAgICBtYXhXaWR0aENoYXJzPXs0MH1cbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e24uYm9keX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibnhcIiB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gb25DbGlja2VkPXtuLmRpc21pc3N9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNsb3NlLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUb2FzdHMobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICAgIC8vIE9ubHkgcmVuZGVyIG5vdGlmaWNhdGlvbnMgeW91bmdlciB0aGFuIFRPQVNUX01TIHdoaWxlIHRoZSBkcmF3ZXIgaXMgQ0xPU0VEIFx1MjAxNFxuICAgIC8vIG9wZW5pbmcgdGhlIGRyYXdlciBcImFkb3B0c1wiIHRoZW0gKHRoZXkgc2ltcGx5IGNvbnRpbnVlIGxpZmUgYXMgZHJhd2VyIGNhcmRzLFxuICAgIC8vIHdoaWNoIGlzIHRoZSBGTElQIGhhbmRvZmYgZXhwcmVzc2VkIGluIHJldGFpbmVkLW1vZGUgdGVybXMpLlxuICAgIGNvbnN0IGxpdmUgPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gICAgLy8gYHNob3duYCA9IHdoYXQgdGhlIHRvYXN0IGNvbHVtbiByZW5kZXJzLiBSZWNvbXB1dGVkIGV4cGxpY2l0bHkgb24gZXZlcnkgaW5wdXRcbiAgICAvLyBjaGFuZ2UgKFZhcmlhYmxlLmRlcml2ZSBkaWRuJ3QgcHJvZHVjZSBhIHJlYWN0aXZlIGJpbmRpbmcgaGVyZSkuIEVtcHR5IHdoaWxlIHRoZVxuICAgIC8vIGRyYXdlciBpcyBvcGVuICh0b2FzdHMgYXJlIEFET1BURUQgaW50byB0aGUgZHJhd2VyIHN0YWNrKS5cbiAgICBjb25zdCBzaG93biA9IFZhcmlhYmxlPG51bWJlcltdPihbXSlcbiAgICBjb25zdCByZWNvbXB1dGUgPSAoKSA9PiBzaG93bi5zZXQoZHJhd2VyT3Blbi5nZXQoKSA/IFtdIDogbGl2ZS5nZXQoKSlcbiAgICBsaXZlLnN1YnNjcmliZShyZWNvbXB1dGUpXG4gICAgZHJhd2VyT3Blbi5zdWJzY3JpYmUocmVjb21wdXRlKVxuICAgIG5kKCkuY29ubmVjdChcIm5vdGlmaWVkXCIsIChfbiwgaWQpID0+IHtcbiAgICAgICAgaWYgKGRyYXdlck9wZW4uZ2V0KCkgfHwgbmQoKS5kb250X2Rpc3R1cmIpIHJldHVyblxuICAgICAgICBsaXZlLnNldChbLi4ubGl2ZS5nZXQoKSwgaWRdKVxuICAgICAgICB0aW1lb3V0KFRPQVNUX01TLCAoKSA9PiBsaXZlLnNldChsaXZlLmdldCgpLmZpbHRlcigoeCkgPT4geCAhPT0gaWQpKSlcbiAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJ0b2FzdHNcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtdG9hc3RzXCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICAvLyBIaWRlIHRoZSB3aG9sZSB0b2FzdCBzdXJmYWNlIHdoaWxlIHRoZSBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG9cbiAgICAgICAgICAgIC8vIHRoZSBkcmF3ZXIpIFx1MjAxNCBhIHJlYWN0aXZlIHdpbmRvdy12aXNpYmlsaXR5IGJpbmQsIHJvYnVzdCByZWdhcmRsZXNzIG9mIHRoZVxuICAgICAgICAgICAgLy8gcGVyLWl0ZW0gbGlzdCByZWNvbmNpbGlhdGlvbi5cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJhd2VyT3BlbikuYXMoKG8pID0+ICFvKX1cbiAgICAgICAgICAgIC8vIFRvYXN0cyBhcmUgYSBmbG9hdGluZyBvdmVybGF5IChsaWtlIHRoZSBwcm90b3R5cGUncyBhYnNvbHV0ZSB0b3AvcmlnaHQpOyB0aGVcbiAgICAgICAgICAgIC8vIGZsb2F0IGluc2V0IGNsZWFycyB0aGUgZmxvYXRpbmcgYmFyIChtYXJnaW5Ub3AgMTAgKyBoZWlnaHQgNDIpICsgYSBzbWFsbCBnYXAsXG4gICAgICAgICAgICAvLyBhbmQgdGhlIHJpZ2h0IGluc2V0IG1hdGNoZXMgdGhlIGJhcidzIGVkZ2UgbWFyZ2luLlxuICAgICAgICAgICAgbWFyZ2luVG9wPXs1OH1cbiAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICAgICAgPlxuICAgICAgICAgICAgey8qIGZpeGVkIHRvYXN0IGNvbHVtbiB3aWR0aCBzbyB0aGUgY2FyZCBjYW4ndCBzdHJldGNoIHRvIGl0cyBoZXhwYW5kIHRleHQgY29sdW1uICovfVxuICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgc3BhY2luZz17OH1cbiAgICAgICAgICAgICAgICB3aWR0aFJlcXVlc3Q9e05DQVJEX1cgKyAyNn1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAge2JpbmQoc2hvd24pLmFzKChpZHMpID0+XG4gICAgICAgICAgICAgICAgICAgIGlkcy5tYXAoKGlkKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuID0gbmQoKS5nZXRfbm90aWZpY2F0aW9uKGlkKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG4gPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInRvYXN0XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxDYXJkIG49e3RvQ2FyZERhdGEobil9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cblxuZnVuY3Rpb24gTWVkaWFDYXJkKCkge1xuICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgIGlmICghbXByaXMgJiYgIURFTU8pIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwaWNrID0gKHBzOiBhbnlbXSkgPT5cbiAgICAgICAgcHMuZmluZCgocCkgPT4gcC5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdID8/IG51bGxcblxuICAgIGNvbnN0IG1lZGlhVGl0bGUgPSBERU1PXG4gICAgICAgID8gRC5tZWRpYS50aXRsZVxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwaWNrKHBzKT8udGl0bGUgPz8gXCJcIilcbiAgICBjb25zdCBtZWRpYUFydGlzdCA9IERFTU9cbiAgICAgICAgPyBELm1lZGlhLmFydGlzdFxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwaWNrKHBzKT8uYXJ0aXN0ID8/IFwiXCIpXG4gICAgY29uc3QgcGxheUljb24gPSBERU1PXG4gICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcCA9IHBpY2socHMpXG4gICAgICAgICAgICAgIHJldHVybiBwPy5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICA6IFwia29iZWwtcGxheS1zeW1ib2xpY1wiXG4gICAgICAgICAgfSlcbiAgICBjb25zdCBwcm9ncmVzcyA9IERFTU9cbiAgICAgICAgPyAwLjQyXG4gICAgICAgIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcCA9IHBpY2socHMpXG4gICAgICAgICAgICAgIGlmICghcCB8fCAhcC5sZW5ndGggfHwgcC5sZW5ndGggPD0gMCkgcmV0dXJuIDBcbiAgICAgICAgICAgICAgcmV0dXJuIHAucG9zaXRpb24gLyBwLmxlbmd0aFxuICAgICAgICAgIH0pXG4gICAgY29uc3QgY3VyVGltZSA9IERFTU9cbiAgICAgICAgPyBcIjI6MzdcIlxuICAgICAgICA6IGJpbmQobXByaXMhLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHAgPSBwaWNrKHBzKVxuICAgICAgICAgICAgICBpZiAoIXAgfHwgIXAucG9zaXRpb24pIHJldHVybiBcIjA6MDBcIlxuICAgICAgICAgICAgICBjb25zdCBzID0gTWF0aC5mbG9vcihwLnBvc2l0aW9uKVxuICAgICAgICAgICAgICByZXR1cm4gYCR7TWF0aC5mbG9vcihzIC8gNjApfToke1N0cmluZyhzICUgNjApLnBhZFN0YXJ0KDIsIFwiMFwiKX1gXG4gICAgICAgICAgfSlcbiAgICBjb25zdCB0b3RhbFRpbWUgPSBERU1PXG4gICAgICAgID8gXCI2OjA3XCJcbiAgICAgICAgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBwID0gcGljayhwcylcbiAgICAgICAgICAgICAgaWYgKCFwIHx8ICFwLmxlbmd0aCB8fCBwLmxlbmd0aCA8PSAwKSByZXR1cm4gXCIwOjAwXCJcbiAgICAgICAgICAgICAgY29uc3QgcyA9IE1hdGguZmxvb3IocC5sZW5ndGgpXG4gICAgICAgICAgICAgIHJldHVybiBgJHtNYXRoLmZsb29yKHMgLyA2MCl9OiR7U3RyaW5nKHMgJSA2MCkucGFkU3RhcnQoMiwgXCIwXCIpfWBcbiAgICAgICAgICB9KVxuICAgIGNvbnN0IGhhc1BsYXllciA9IERFTU8gPyB0cnVlIDogYmluZChtcHJpcyEsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHBzLmxlbmd0aCA+IDApXG4gICAgY29uc3Qgbm9QbGF5ZXIgPSBERU1PID8gZmFsc2UgOiBiaW5kKG1wcmlzISwgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4gcHMubGVuZ3RoID09PSAwKVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cIm5jYXJkIG1lZGlhXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICB7LyogLm1yb3cgXHUyMDE0IGFydCBcdTAwQjcgdGl0bGUvYXJ0aXN0IFx1MDBCNyBwcmV2L3BsYXkvbmV4dCAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtcm93XCIgc3BhY2luZz17MTF9IHZpc2libGU9e2hhc1BsYXllcn0+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1hcnRcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXsyMn1cbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgIHZleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibW1ldGFcIlxuICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17bWVkaWFUaXRsZX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e21lZGlhQXJ0aXN0fSAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtYnRuc1wiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17MX0+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJtYnRuXCIgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJwbGF5ZXJjdGwgcHJldmlvdXNcIil9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1iYWNrLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJtYnRuIHBsYXlcIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17cGxheUljb259IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibWJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIG5leHRcIil9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1md2Qtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgey8qIC5tYmFyIFx1MjAxNCBjdXJyZW50IHRpbWUgXHUwMEI3IHRyYWNrIHNsaWRlciBcdTAwQjcgdG90YWwgdGltZSAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtYmFyXCIgc3BhY2luZz17OH0gdmlzaWJsZT17aGFzUGxheWVyfT5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJtdGltZSB0blwiIGxhYmVsPXtjdXJUaW1lfSAvPlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhciBjbGFzcz1cIm10cmFja1wiIGhleHBhbmQgdmFsdWU9e3Byb2dyZXNzfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cIm10aW1lIHRuXCIgbGFiZWw9e3RvdGFsVGltZX0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgey8qIGVtcHR5IHN0YXRlIFx1MjAxNCBkaXNjIGljb24gKyBcIk5vdGhpbmcgcGxheWluZ1wiICsgXCJPcGVuIE11c2ljXCIgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibWVtcHR5cm93XCIgc3BhY2luZz17MTF9IHZpc2libGU9e25vUGxheWVyfT5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibWFydFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJrb2JlbC1kaXNjLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MjJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveCBoZXhwYW5kIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJOb3RoaW5nIHBsYXlpbmdcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ViXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJNZWRpYSBjb250cm9scyBhcHBlYXIgd2hlbiBhIHBsYXllciBzdGFydHNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgd3JhcFxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJnaG9zdGJcIlxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwieGRnLW9wZW4gaHR0cHM6Ly9vcGVuLnNwb3RpZnkuY29tXCIpfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiT3BlbiBNdXNpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gRHJhd2VyKCkge1xuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgyMDAsIDE1MClcbiAgICByZWdpc3RlcihcImRyYXdlclwiLCB0b2dnbGVGbilcbiAgICAvLyBLZWVwIGRyYXdlck9wZW4gaW4gc3luYyB3aXRoIHRoZSByZXZlYWxlZCBzdGF0ZSAodG9hc3RzIGFkb3B0IGludG8gZHJhd2VyIHdoZW4gb3BlbilcbiAgICByZXZlYWxlZC5zdWJzY3JpYmUoKHIpID0+IGRyYXdlck9wZW4uc2V0KHIpKVxuXG4gICAgLy8gREVNTzogc3RhdGljIG5vdGlmaWNhdGlvbiBsaXN0IHBpbm5lZCB0byBwcm90b3R5cGUncyBpbml0aWFsIHN0YXRlXG4gICAgaWYgKERFTU8pIHtcbiAgICAgICAgY29uc3QgZGVtb0NhcmRzOiBDYXJkRGF0YVtdID0gRC5ub3RpZmljYXRpb25zLm1hcCgobikgPT4gKHtcbiAgICAgICAgICAgIC4uLm4sXG4gICAgICAgICAgICBkaXNtaXNzOiAoKSA9PiB7fSxcbiAgICAgICAgfSkpXG4gICAgICAgIGNvbnN0IGRlbW9Db3VudCA9IGAke2RlbW9DYXJkcy5sZW5ndGggfHwgXCJcIn1gXG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICA8d2luZG93XG4gICAgICAgICAgICAgICAgbmFtZT1cImRyYXdlclwiXG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZHJhd2VyXCJcbiAgICAgICAgICAgICAgICBjbGFzcz1cImRyYXdlci13aW5kb3dcIlxuICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICAgICAgbWFyZ2luUmlnaHQ9ezEyfVxuICAgICAgICAgICAgICAgIGFuY2hvcj17XG4gICAgICAgICAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFQgfCBBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXkpID0+IChrZXkgPT09IEdkay5LRVlfRXNjYXBlID8gKGNsb3NlKCksIHRydWUpIDogZmFsc2UpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfTEVGVH1cbiAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMDB9XG4gICAgICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImRyYXdlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPE1lZGlhQ2FyZCAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm5oZWFkXCIgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIk5vdGlmaWNhdGlvbnNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRuIHN1YlwiIGxhYmVsPXtkZW1vQ291bnR9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBoZXhwYW5kIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm5jbGVhclwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezV9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtdHJhc2gtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiQ2xlYXJcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fSB2ZXhwYW5kPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtkZW1vQ2FyZHMubWFwKChuKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxDYXJkIG49e259IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgICAgIDwvd2luZG93PlxuICAgICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgbmZkID0gc2tpcCgpID8gbnVsbCA6IG5kKClcbiAgICBjb25zdCBsaXN0ID0gVmFyaWFibGU8Tm90aWZkLk5vdGlmaWNhdGlvbltdPihuZmQ/LmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gICAgaWYgKG5mZCkge1xuICAgICAgICBjb25zdCByZWZyZXNoID0gKCkgPT4gbGlzdC5zZXQobmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gICAgICAgIG5mZC5jb25uZWN0KFwibm90aWZpZWRcIiwgcmVmcmVzaClcbiAgICAgICAgbmZkLmNvbm5lY3QoXCJyZXNvbHZlZFwiLCByZWZyZXNoKVxuICAgIH1cblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkcmF3ZXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZHJhd2VyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZHJhd2VyLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgbWFyZ2luUmlnaHQ9ezEyfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4gKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9MRUZUfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjAwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImRyYXdlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8TWVkaWFDYXJkIC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIk5vdGlmaWNhdGlvbnNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gc3ViXCIgbGFiZWw9e2JpbmQobGlzdCkuYXMoKG4pID0+IGAke24ubGVuZ3RoIHx8IFwiXCJ9YCl9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGhleHBhbmQgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm5jbGVhclwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBuZmQ/LmdldF9ub3RpZmljYXRpb25zKCkuZm9yRWFjaCgobikgPT4gbi5kaXNtaXNzKCkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17NX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXRyYXNoLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiQ2xlYXJcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9IHZleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICB7YmluZChsaXN0KS5hcygobnMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbnMgJiYgbnMubGVuZ3RoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gbnMubWFwKChuKSA9PiA8Q2FyZCBuPXt0b0NhcmREYXRhKG4pfSAvPilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibmVtcHR5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXsyfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uRklMTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJrb2JlbC1jaGVjay1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IGxhYmVsPVwiQWxsIGNhdWdodCB1cFwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBPU0QgXHUyMDE0IGRpc3BsYXktb25seSB2b2x1bWUgcGlsbCBhYm92ZSB0aGUgZG9jay4gUHJvdG90eXBlOiBwb2ludGVyLWV2ZW50cyBub25lLFxuLy8gYXV0by1oaWRlIDEuNHMsIHRyYW5zbHVjZW50IChibHVyIHZpYSBnbm9ibGluIHdpbmRvdy1ydWxlKS5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBXcCBmcm9tIFwiZ2k6Ly9Bc3RhbFdwXCJcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gT1NEKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gICAgY29uc3Qgc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG4gICAgY29uc3QgdmlzaWJsZSA9IFZhcmlhYmxlKGZhbHNlKVxuICAgIGxldCBoaWRlOiBSZXR1cm5UeXBlPHR5cGVvZiB0aW1lb3V0PiB8IG51bGwgPSBudWxsXG4gICAgaWYgKCFzcGVha2VyKSByZXR1cm4gbnVsbFxuXG4gICAgc3BlYWtlci5jb25uZWN0KFwibm90aWZ5Ojp2b2x1bWVcIiwgKCkgPT4ge1xuICAgICAgICB2aXNpYmxlLnNldCh0cnVlKVxuICAgICAgICBoaWRlPy5jYW5jZWwoKVxuICAgICAgICBoaWRlID0gdGltZW91dCgxNDAwLCAoKSA9PiB2aXNpYmxlLnNldChmYWxzZSkpXG4gICAgfSlcblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJvc2RcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtb3NkXCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5CT1RUT019XG4gICAgICAgICAgICBtYXJnaW5Cb3R0b209ezcyfVxuICAgICAgICAgICAgY2xpY2tUaHJvdWdoXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHZpc2libGUpfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwib3NkXCIgc3BhY2luZz17MTF9IHdpZHRoUmVxdWVzdD17MjMwfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e2JpbmQoc3BlYWtlciwgXCJ2b2x1bWVfaWNvblwiKX0gLz5cbiAgICAgICAgICAgICAgICA8bGV2ZWxiYXIgaGV4cGFuZCB2YWx1ZT17YmluZChzcGVha2VyLCBcInZvbHVtZVwiKX0gLz5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzdmFsIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgeGFsaWduPXsxfVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZChzcGVha2VyLCBcInZvbHVtZVwiKS5hcygodikgPT4gYCR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYCl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gU2Vzc2lvbiBvdmVybGF5IFx1MjAxNCBkaW1tZWQgKDAuOCksIDQgYnV0dG9ucywgYXJyb3ctbmF2LCBQUkVTUy1BR0FJTiBjb25maXJtIG9uXG4vLyBSZXN0YXJ0L1NodXQgZG93biAoYXV0by1yZXZlcnQgNHMpLCByZXN0aW5nIHJvc2Ugb24gU2h1dCBkb3duLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbnZvaWQgREVNT1xudm9pZCBEXG5cbmNvbnN0IEFDVElPTlMgPSBbXG4gICAge1xuICAgICAgICBpZDogXCJsb2NrXCIsXG4gICAgICAgIGxhYmVsOiBcIkxvY2tcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1sb2NrLXN5bWJvbGljXCIsXG4gICAgICAgIGNvbmZpcm06IGZhbHNlLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgaWQ6IFwibG9nb3V0XCIsXG4gICAgICAgIGxhYmVsOiBcIkxvZyBvdXRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1sb2dvdXQtc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogZmFsc2UsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwiZ25vbWUtc2Vzc2lvbi1xdWl0IC0tbG9nb3V0IC0tbm8tcHJvbXB0XCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBpZDogXCJyZXN0YXJ0XCIsXG4gICAgICAgIGxhYmVsOiBcIlJlc3RhcnRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogdHJ1ZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgcmVib290XCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBpZDogXCJzaHV0ZG93blwiLFxuICAgICAgICBsYWJlbDogXCJTaHV0IGRvd25cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiB0cnVlLFxuICAgICAgICByZWQ6IHRydWUsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwic3lzdGVtY3RsIHBvd2Vyb2ZmXCIpLFxuICAgIH0sXG5dXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFNlc3Npb24oKSB7XG4gICAgY29uc3QgYXJtZWQgPSBWYXJpYWJsZTxzdHJpbmcgfCBudWxsPihudWxsKVxuICAgIGxldCByZXZlcnQ6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcblxuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgxODAsIDEzMClcbiAgICByZWdpc3RlcihcInNlc3Npb25cIiwgdG9nZ2xlRm4pXG5cbiAgICBjb25zdCBwcmVzcyA9IChhOiAodHlwZW9mIEFDVElPTlMpW251bWJlcl0pID0+IHtcbiAgICAgICAgaWYgKGEuY29uZmlybSAmJiBhcm1lZC5nZXQoKSAhPT0gYS5pZCkge1xuICAgICAgICAgICAgYXJtZWQuc2V0KGEuaWQpXG4gICAgICAgICAgICByZXZlcnQ/LmNhbmNlbCgpXG4gICAgICAgICAgICByZXZlcnQgPSB0aW1lb3V0KDQwMDAsICgpID0+IGFybWVkLnNldChudWxsKSlcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICAgIGFybWVkLnNldChudWxsKVxuICAgICAgICBjbG9zZSgpXG4gICAgICAgIGEucnVuKClcbiAgICB9XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwic2Vzc2lvblwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1zZXNzaW9uXCJcbiAgICAgICAgICAgIGNsYXNzPVwic2Vzc2lvbi13aW5kb3dcIlxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgIGFuY2hvcj17XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLlRPUCB8XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTSB8XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLkxFRlQgfFxuICAgICAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5FWENMVVNJVkV9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuSUdOT1JFfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfRXNjYXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFybWVkLnNldChudWxsKVxuICAgICAgICAgICAgICAgICAgICBjbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLkNST1NTRkFERX1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezE4MH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChyZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIHsvKiAuc2Vzc2lvbiBmaWxscyB0aGUgd2hvbGUgd2luZG93ICh0aGUgZGltKTsgYnV0dG9ucyBjZW50ZXJlZCBpbnNpZGUgKi99XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlc3Npb25cIiBoZXhwYW5kIHZleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezIwfSBoZXhwYW5kPlxuICAgICAgICAgICAgICAgICAgICAgICAge0FDVElPTlMubWFwKChhKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz17YS5yZWQgPyBcInNidG4gcmVkXCIgOiBcInNidG5cIn0gb25DbGlja2VkPXsoKSA9PiBwcmVzcyhhKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXsxMH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtiaW5kKGFybWVkKS5hcygoeCkgPT4gKHggPT09IGEuaWQgPyBcImNvbmZpcm1cIiA6IFwiXCIpKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic2ljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kPXtmYWxzZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kPXtmYWxzZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBob3Jpem9udGFsIEd0a0JveCBpZ25vcmVzIGEgY2hpbGQncyBtYWluLWF4aXMgaGFsaWduLCBzbyB0aGUgaWNvblxuICAgICAgICAgICAgICAgICAgICBsZWZ0LXBhY2tzOyBoZXhwYW5kIG1ha2VzIHRoZSBpbWFnZSBmaWxsIHRoZSA1OXB4IHRpbGUgXHUyMTkyIEd0a0ltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNlbnRyZXMgdGhlIGdseXBoLiBoZXhwYW5kPXtmYWxzZX0gb24gLnNpYyBibG9ja3MgcHJvcGFnYXRpb24gc28gdGhlXG4gICAgICAgICAgICAgICAgICAgIHRpbGUgc3RheXMgNTkgd2lkZSBpbnN0ZWFkIG9mIHN0cmV0Y2hpbmcgdGhlIHJvdy4gKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPXthLmljb259XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MjJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoYXJtZWQpLmFzKCh4KSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB4ID09PSBhLmlkID8gXCJQcmVzcyBhZ2FpblwiIDogYS5sYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxPQUFPQSxZQUFXO0FBQ2xCLE9BQU9DLFVBQVM7QUFDaEIsT0FBT0MsVUFBUzs7O0FDRmhCLE9BQU9DLFlBQVc7OztBQ0FYLElBQU0sV0FBVyxDQUFDLFFBQWdCLElBQ3BDLFFBQVEsbUJBQW1CLE9BQU8sRUFDbEMsV0FBVyxLQUFLLEdBQUcsRUFDbkIsWUFBWTtBQUVWLElBQU0sV0FBVyxDQUFDLFFBQWdCLElBQ3BDLFFBQVEsbUJBQW1CLE9BQU8sRUFDbEMsV0FBVyxLQUFLLEdBQUcsRUFDbkIsWUFBWTtBQWNWLElBQU0sVUFBTixNQUFNLFNBQWU7QUFBQSxFQUNoQixjQUFjLENBQUMsTUFBVztBQUFBLEVBRWxDO0FBQUEsRUFDQTtBQUFBLEVBU0EsT0FBTyxLQUFLLFNBQXFDLE1BQWU7QUFDNUQsV0FBTyxJQUFJLFNBQVEsU0FBUyxJQUFJO0FBQUEsRUFDcEM7QUFBQSxFQUVRLFlBQVksU0FBNEMsTUFBZTtBQUMzRSxTQUFLLFdBQVc7QUFDaEIsU0FBSyxRQUFRLFFBQVEsU0FBUyxJQUFJO0FBQUEsRUFDdEM7QUFBQSxFQUVBLFdBQVc7QUFDUCxXQUFPLFdBQVcsS0FBSyxRQUFRLEdBQUcsS0FBSyxRQUFRLE1BQU0sS0FBSyxLQUFLLE1BQU0sRUFBRTtBQUFBLEVBQzNFO0FBQUEsRUFFQSxHQUFNLElBQWlDO0FBQ25DLFVBQU1DLFFBQU8sSUFBSSxTQUFRLEtBQUssVUFBVSxLQUFLLEtBQUs7QUFDbEQsSUFBQUEsTUFBSyxjQUFjLENBQUMsTUFBYSxHQUFHLEtBQUssWUFBWSxDQUFDLENBQUM7QUFDdkQsV0FBT0E7QUFBQSxFQUNYO0FBQUEsRUFFQSxNQUFhO0FBQ1QsUUFBSSxPQUFPLEtBQUssU0FBUyxRQUFRO0FBQzdCLGFBQU8sS0FBSyxZQUFZLEtBQUss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QUFRLE1BQU0sR0FBRztBQUNwQyxRQUFJLFFBQVEsVUFBVTtBQUNsQixhQUFjLEdBQUc7QUFDakIsYUFBTyxJQUFJLElBQUk7QUFBQSxJQUNuQjtBQUNBLFFBQUksUUFBUSxjQUFjO0FBQ3RCLGtCQUFJLFVBQVUsZUFBUSxTQUFTLE1BQU0sR0FBRyxJQUFJO0FBQzVDLGFBQU8sSUFBSSxJQUFJO0FBQUEsSUFDbkI7QUFDQSxRQUFJLFNBQVM7QUFBQSxFQUNqQjtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbIkFzdGFsIiwgIkd0ayIsICJHZGsiLCAiQXN0YWwiLCAiYmluZCIsICJpbnRlcnZhbCIsICJ0aW1lb3V0IiwgIkFzdGFsIiwgIkFzdGFsIiwgImluaXQiLCAiQXN0YWwiLCAidiIsICJpbnRlcnZhbCIsICJrZXkiLCAiY3RvcnMiLCAia2V5IiwgIkd0ayIsICJBc3RhbCIsICJzbmFrZWlmeSIsICJwYXRjaCIsICJBcHBzIiwgIkJsdWV0b290aCIsICJNcHJpcyIsICJOb3RpZmQiLCAiV3AiLCAiQXBwIiwgIkd0ayIsICJBc3RhbCIsICJBc3RhbCIsICJHdGsiLCAiR3RrIiwgIkFzdGFsIiwgImNoIiwgIkd0ayIsICJHZGsiLCAiR2lvIiwgIkdMaWIiLCAiZGVmYXVsdCIsICJBc3RhbCIsICJHT2JqZWN0IiwgImRlZmF1bHQiLCAiR09iamVjdCIsICJHaW8iLCAiR0xpYiIsICJHaW8iLCAiR0xpYiIsICJpbml0IiwgIkdMaWIiLCAiR0xpYiIsICJ0eXBlIiwgIkdMaWIiLCAianN4IiwgImRlZmF1bHQiLCAianN4IiwgIndpZmlJY29uIiwgIkd0ayIsICJuIiwgIkFzdGFsIiwgIkdpbyIsICJqc3giLCAiR3RrIiwgIm4iLCAiR2RrIiwgIkdpbyIsICJBc3RhbCIsICJBcHBzIiwgIk1wcmlzIiwgIkdMaWIiLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIlBJTk5FRCIsICJBcHBzIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJHdGsiLCAiTXByaXMiLCAiTmV0d29yayIsICJXcCIsICJHaW8iLCAiQmF0dGVyeSIsICJHT2JqZWN0IiwgIkd0ayIsICJUaW55U2xpZGVyIiwgImRlZmF1bHQiLCAiU1RPUkUiLCAianN4IiwgIkd0ayIsICJXcCIsICJHaW8iLCAiQmF0dGVyeSIsICJOZXR3b3JrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiTm90aWZkIiwgIk1wcmlzIiwgIk5vdGlmZCIsICJkZWZhdWx0IiwgIm4iLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJNcHJpcyIsICJrZXkiLCAiR2RrIiwgIldwIiwgIldwIiwgImpzeCIsICJBc3RhbCIsICJBQ1RJT05TIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJHdGsiLCAiaW5pdCIsICJHZGsiXQp9Cg==
