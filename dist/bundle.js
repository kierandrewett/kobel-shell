// ../../../../usr/share/astal/gjs/gtk4/index.ts
import Astal6 from "gi://Astal?version=4.0";
import Gtk4 from "gi://Gtk?version=4.0";
import Gdk2 from "gi://Gdk?version=4.0";

// ../../../../usr/share/astal/gjs/variable.ts
import Astal3 from "gi://AstalIO";

// ../../../../usr/share/astal/gjs/binding.ts
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

// ../../../../usr/share/astal/gjs/time.ts
import Astal from "gi://AstalIO";
var Time = Astal.Time;
function interval(interval2, callback) {
  return Astal.Time.interval(interval2, () => void callback?.());
}
function timeout(timeout2, callback) {
  return Astal.Time.timeout(timeout2, () => void callback?.());
}

// ../../../../usr/share/astal/gjs/process.ts
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

// ../../../../usr/share/astal/gjs/variable.ts
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

// ../../../../usr/share/astal/gjs/_astal.ts
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
function hook(widget, object, signalOrCallback, callback) {
  if (typeof object.connect === "function" && callback) {
    const id = object.connect(signalOrCallback, (_, ...args) => {
      return callback(widget, ...args);
    });
    widget.connect("destroy", () => {
      object.disconnect(id);
    });
  } else if (typeof object.subscribe === "function" && typeof signalOrCallback === "function") {
    const unsub = object.subscribe((...args) => {
      signalOrCallback(widget, ...args);
    });
    widget.connect("destroy", unsub);
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

// ../../../../usr/share/astal/gjs/gtk4/astalify.ts
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

// ../../../../usr/share/astal/gjs/gtk4/app.ts
import GLib from "gi://GLib?version=2.0";
import Gtk2 from "gi://Gtk?version=4.0";
import Astal4 from "gi://Astal?version=4.0";

// ../../../../usr/share/astal/gjs/overrides.ts
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

// ../../../../usr/share/astal/gjs/_app.ts
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

// ../../../../usr/share/astal/gjs/gtk4/app.ts
Gtk2.init();
GLib.unsetenv("LD_PRELOAD");
await import("gi://Adw?version=1").then(({ default: Adw }) => Adw.init()).catch(() => void 0);
var app_default = mkApp(Astal4.Application);

// ../../../../usr/share/astal/gjs/gtk4/widget.ts
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

// ags/app.ts
import Gtk9 from "gi://Gtk?version=4.0";
import Gdk5 from "gi://Gdk?version=4.0";

// sass:/home/kieran/dev/kobel-shell/ags/style/main.scss
var main_default = '@charset "UTF-8";\nwindow {\n  font-family: "Inter", "Inter Variable", "InterVariable", sans-serif;\n  font-size: 13px;\n  color: #f3eef3;\n}\n\n.tn {\n  font-feature-settings: "tnum";\n}\n\nwindow {\n  background: transparent;\n}\n\nbutton {\n  background: none;\n  background-color: transparent;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 0;\n  transition: background-color 160ms, color 160ms;\n}\n\nimage {\n  -gtk-icon-style: regular;\n}\n\n.bar {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 0 7px;\n  min-height: 42px;\n  color: #b5adbc;\n}\n.bar .title {\n  color: #b5adbc;\n  font-size: 12.5px;\n  font-weight: 400;\n  margin: 0 9px;\n}\n.bar .clock {\n  color: #f3eef3;\n  font-size: 13.5px;\n  font-weight: 600;\n}\n.bar .date {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.bar .ibtn {\n  padding: 0;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.bar .ibtn image {\n  -gtk-icon-size: 16px;\n}\n.bar .ibtn:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.bar .bcenter {\n  min-height: 0;\n  padding: 6px 12px;\n  border-radius: 9px;\n}\n.bar .bcenter:hover {\n  background-color: #1d1a22;\n}\n.bar .status {\n  min-height: 30px;\n  padding: 0 13px;\n  border-radius: 999px;\n  background-color: #1d1a22;\n}\n.bar .status:hover {\n  background-color: #26232c;\n}\n.bar .status image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n}\n.bar .status .pct image {\n  -gtk-icon-size: 13px;\n}\n.bar .status label {\n  color: #f3eef3;\n  font-weight: 650;\n  font-size: 11.5px;\n}\n.bar .status.err .net-icon {\n  color: #edbb64;\n}\n.bar .badge {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 99px;\n  font-size: 9px;\n  font-weight: 700;\n  padding: 0 3px;\n  margin: 2px;\n  min-height: 14px;\n  min-width: 8px;\n}\n.bar .tray-icon {\n  min-width: 28px;\n}\n.bar .tray-icon image {\n  -gtk-icon-size: 14px;\n  color: #b5adbc;\n}\n.bar .tray-lang {\n  font-size: 11px;\n  font-weight: 650;\n  color: #b5adbc;\n  margin: 0 8px;\n}\n\n.dock {\n  background-color: #100e14;\n  padding: 5px;\n  border-radius: 16px;\n}\n.dock .dbtn {\n  border-radius: 12px;\n}\n.dock .icon-tile {\n  min-width: 30px;\n  min-height: 30px;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.dock .dbtn:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.dock .placeholder .icon-tile {\n  background-color: #1d1a22;\n  color: #8d8693;\n}\n.dock .dots {\n  margin-bottom: 3px;\n}\n.dock .dot {\n  background-color: #8d8693;\n  border-radius: 99px;\n  min-width: 4px;\n  min-height: 4px;\n  transition: min-width 260ms cubic-bezier(0.24, 1.36, 0.35, 1), background-color 220ms;\n}\n.dock .dot.on {\n  background-color: #b5cb48;\n  min-width: 12px;\n}\n.dock .dot.mini {\n  min-width: 3px;\n  min-height: 3px;\n  opacity: 0.7;\n}\n.dock .sep {\n  background-color: #26232c;\n  min-width: 1px;\n  min-height: 33px;\n  margin: 0 3px;\n}\n.dock .dtile {\n  min-width: 42px;\n  min-height: 42px;\n}\n.dock .dwidget .dg {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 9px;\n  padding: 6px;\n}\n.dock .mprog {\n  min-width: 25px;\n  min-height: 3px;\n  margin-bottom: 6px;\n}\n.dock .mprog trough {\n  background-color: rgba(0, 0, 0, 0.35);\n  border-radius: 99px;\n  min-height: 3px;\n}\n.dock .mprog block.filled {\n  background-color: #b5cb48;\n  border-radius: 99px;\n}\n.dock .mprog block.empty {\n  background-color: transparent;\n}\n\n.sheet {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 12px;\n  margin: 38px;\n  box-shadow: 0 15px 34px rgba(8, 5, 16, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);\n}\n\n.qs {\n  min-width: 328px;\n} /* matches panelW(352)\u221224; overridden by config.ts tokenCss at runtime */\n.qs-top {\n  margin-bottom: 12px;\n  padding: 0 2px;\n}\n.qs-top .meta {\n  color: #b5adbc;\n  font-size: 11.5px;\n  font-weight: 600;\n}\n.qs-top .meta image {\n  -gtk-icon-size: 15px;\n  color: #b5adbc;\n  padding: 0;\n  margin: 0;\n}\n.qs-top .rbtn {\n  padding: 9px;\n  border-radius: 99px;\n  background-color: #26232c;\n  color: #b5adbc;\n  margin-left: 7px;\n}\n.qs-top .rbtn image {\n  -gtk-icon-size: 14px;\n}\n.qs-top .rbtn:hover {\n  background-color: #322e39;\n  color: #f3eef3;\n}\n.qs-top .rbtn.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.qs-top .rbtn.leaf image {\n  color: #b5cb48;\n}\n\n.chip {\n  background-color: #1d1a22;\n  border-radius: 999px;\n  min-height: 54px;\n  transition: background-color 220ms;\n}\n.chip .chipb {\n  padding: 9px 8px 9px 12px;\n  border-radius: 999px;\n}\n.chip image {\n  color: #b5adbc;\n  -gtk-icon-size: 17px;\n}\n.chip label {\n  font-size: 12.5px;\n  font-weight: 650;\n  color: #f3eef3;\n}\n.chip .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n  margin-top: 0;\n}\n.chip:hover {\n  background-color: #26232c;\n}\n.chip.on {\n  background-color: #b5cb48;\n}\n.chip.on image {\n  color: #192003;\n}\n.chip.on label {\n  color: #192003;\n}\n.chip.on .sub {\n  color: rgba(25, 32, 3, 0.7);\n}\n.chip.on:hover {\n  background-color: #96ae30;\n}\n.chip.on .chev {\n  color: #192003;\n}\n.chip .chev {\n  min-width: 32px;\n  border-radius: 0 999px 999px 0;\n  color: #8d8693;\n  border-left: 1px solid rgba(0, 0, 0, 0.18);\n}\n.chip .chev image {\n  -gtk-icon-size: 15px;\n  color: inherit;\n}\n.chip .chev:hover {\n  background-color: rgba(0, 0, 0, 0.14);\n}\n\n.chips {\n  margin-bottom: 0;\n}\n\n.chips > box:last-child {\n  margin-right: 1px;\n}\n\n.chip-grid {\n  margin-bottom: 10px;\n}\n\nscale, scale:horizontal, scale:vertical {\n  min-height: 0;\n  min-width: 0;\n  padding: 0;\n  margin: 6px 0;\n}\n\nscale > trough, scale:horizontal > trough, scale:vertical > trough {\n  min-height: 6px;\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border-radius: 999px;\n  background-color: #26232c;\n}\n\nscale > trough > highlight,\nscale > trough > progress {\n  min-height: 6px;\n  border-radius: 999px;\n  background-color: #b5cb48;\n}\n\nscale > trough > slider {\n  min-width: 17px;\n  min-height: 17px;\n  margin: -6px; /* prototype knob 17\xD717 */\n  border-radius: 999px;\n  background-color: #f3eef3;\n  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);\n}\n\n.srow {\n  padding: 0 2px 0 2px;\n  min-height: 42px;\n}\n\n.srow image {\n  color: #b5adbc;\n  -gtk-icon-size: 16px;\n  padding: 0;\n  margin: 0 -12px 0 12px;\n}\n\n.srow .chev {\n  padding: 6px 8px;\n  color: #8d8693;\n  border-radius: 9px;\n}\n.srow .chev image {\n  -gtk-icon-size: 15px;\n  padding: 0;\n  margin: 0;\n}\n.srow .chev:hover {\n  background-color: #1d1a22;\n}\n\n.gbanner {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n  margin-bottom: 8px;\n}\n.gbanner .t {\n  color: #edbb64;\n  font-weight: 650;\n  font-size: 11.5px;\n}\n.gbanner .s {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.gbanner image {\n  color: #edbb64;\n}\n\n.gbtn {\n  background-color: #b5cb48;\n  color: #192003;\n  border-radius: 10px;\n  font-weight: 650;\n  font-size: 11.5px;\n  padding: 7px 12px;\n}\n.gbtn:hover {\n  background-color: #96ae30;\n}\n\n.dhead {\n  padding-bottom: 10px;\n}\n.dhead button {\n  padding: 7px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.dhead button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.dhead label {\n  font-weight: 650;\n  font-size: 14px;\n}\n\nswitch {\n  background-color: #26232c;\n  border-radius: 999px;\n  min-width: 42px;\n  min-height: 24px;\n}\nswitch:checked {\n  background-color: #b5cb48;\n}\nswitch slider {\n  background-color: #f3eef3;\n  border-radius: 999px;\n  min-width: 20px;\n  min-height: 20px;\n}\n\n.xrow {\n  background-color: #1d1a22;\n  border-radius: 9px;\n  padding: 9px 11px;\n}\n.xrow image {\n  color: #b5adbc;\n  -gtk-icon-size: 17px;\n}\n.xrow label {\n  font-size: 12.5px;\n  font-weight: 600;\n  color: #f3eef3;\n}\n.xrow .xs {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n.xrow:hover {\n  background-color: #26232c;\n}\n.xrow.active image {\n  color: #b5cb48;\n}\n.xrow.active .xs {\n  color: #b5cb48;\n}\n\n.mixrow {\n  padding: 4px 2px;\n}\n.mixrow .mi {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 5px;\n}\n.mixrow .mi image {\n  color: #b5adbc;\n  -gtk-icon-size: 15px;\n}\n.mixrow .mname {\n  font-size: 12px;\n  color: #b5adbc;\n  min-width: 72px;\n}\n\n.sheet.launcher {\n  min-width: 551px;\n}\n\n.launcher {\n  padding: 8px;\n}\n\n.field {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 3px 12px;\n  margin-bottom: 6px;\n}\n.field image {\n  color: #8d8693;\n  -gtk-icon-size: 16px;\n}\n.field entry {\n  background: none;\n  border: none;\n  box-shadow: none;\n  outline: none;\n  color: #f3eef3;\n  font-size: 14.5px;\n  caret-color: #b5cb48;\n  padding: 8px 0;\n  min-height: 0;\n  min-width: 0;\n}\n.field entry text {\n  min-height: 0;\n}\n.field .lplaceholder {\n  color: #b5adbc;\n  font-size: 14.5px;\n}\n.field .ghost {\n  color: #8d8693;\n  font-size: 14.5px;\n}\n.field .kbd {\n  background-color: #26232c;\n  color: #b5adbc;\n  border-radius: 5px;\n  font-size: 10.5px;\n  padding: 3px 7px;\n}\n\n.tiles {\n  padding: 8px 2px 10px;\n}\n\n.tile {\n  padding: 5px 0;\n  border-radius: 10px;\n  min-width: 62px;\n  max-width: 62px;\n}\n.tile .icon-tile {\n  min-width: 0;\n  min-height: 0;\n  padding: 6px;\n  border-radius: 12px;\n  transition: background-color 160ms;\n}\n.tile label {\n  color: #b5adbc;\n  font-size: 10.5px;\n}\n.tile:hover .icon-tile {\n  background-color: rgba(255, 255, 255, 0.09);\n}\n.tile:hover label {\n  color: #f3eef3;\n}\n\n.lfoot {\n  padding: 7px 10px 3px;\n  color: #8d8693;\n  font-size: 11px;\n}\n.lfoot b {\n  color: #b5adbc;\n  font-weight: 650;\n}\n\n.lwidgets {\n  padding: 0 2px 6px;\n}\n\n.widget {\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px 12px;\n}\n.widget label {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.widget .hint {\n  color: #b5adbc;\n  font-size: 11px;\n  font-weight: 400;\n}\n\n.lwm .lwart {\n  background-color: #26232c;\n  border-radius: 9px;\n  min-width: 34px;\n  min-height: 34px;\n}\n.lwm .lwart image {\n  color: #b5adbc;\n  -gtk-icon-size: 11px;\n}\n.lwm .mbtn {\n  color: #f3eef3;\n  border-radius: 8px;\n  min-width: 29px;\n  min-height: 29px;\n}\n.lwm .mbtn image {\n  -gtk-icon-size: 14px;\n}\n.lwm .mbtn:hover {\n  background-color: #26232c;\n}\n\n.sec {\n  color: #8d8693;\n  font-size: 10px;\n  font-weight: 650;\n  padding: 8px 10px 2px;\n}\n\n.row {\n  border-radius: 10px;\n  padding: 7px 10px;\n}\n.row .ri {\n  background-color: #1d1a22;\n  border-radius: 8px;\n  padding: 2px;\n}\n.row image {\n  -gtk-icon-size: 24px;\n}\n.row label {\n  font-size: 13px;\n  font-weight: 600;\n}\n.row .hint {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.row .runk {\n  background-color: #322e39;\n  color: #b5adbc;\n  border-radius: 6px;\n  font-size: 10.5px;\n  padding: 2px 7px;\n}\n.row:hover {\n  background-color: #1d1a22;\n}\n.row.sel {\n  background-color: #26232c;\n}\n\n.cal {\n  min-width: 309px;\n}\n.cal .sub {\n  color: #b5adbc;\n  font-size: 11.5px;\n}\n.cal .hero {\n  color: #f3eef3;\n  font-size: 19px;\n  font-weight: 650;\n}\n.cal .calhero {\n  padding: 5px 8px 8px 8px;\n}\n.cal .cal-grid {\n  margin-top: 8px;\n}\n.cal .month {\n  border-radius: 8px;\n  padding: 5px;\n  font-weight: 650;\n  font-size: 13px;\n}\n.cal .month:hover {\n  background-color: #1d1a22;\n}\n.cal centerbox > button {\n  padding: 6px 5px;\n  border-radius: 9px;\n  color: #b5adbc;\n}\n.cal centerbox > button:hover {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.cal .dow {\n  color: #8d8693;\n  font-size: 9.5px;\n  font-weight: 600;\n  padding: 3px 0 6px;\n}\n.cal .wk {\n  color: #8d8693;\n  font-size: 9px;\n  font-weight: 600;\n}\n.cal .day {\n  background: none;\n  background-color: transparent;\n  color: #f3eef3;\n  font-size: 11px;\n  font-weight: 600;\n  min-width: 24px;\n  min-height: 24px;\n  border-radius: 99px;\n  margin: 1px;\n}\n.cal .day:hover {\n  background-color: #1d1a22;\n}\n.cal .day.we {\n  color: #8d8693;\n}\n.cal .day.out {\n  color: #8d8693;\n  font-weight: 400;\n}\n.cal .day.today {\n  background-color: #b5cb48;\n  color: #192003;\n  font-weight: 700;\n}\n.cal .day.today:hover {\n  background-color: #b5cb48;\n}\n.cal .day.sel:not(.today) {\n  box-shadow: inset 0 0 0 1.5px #b5adbc;\n}\n.cal .day.today.sel {\n  box-shadow: inset 0 0 0 1.5px #192003;\n}\n.cal .day .evdot {\n  min-width: 3px;\n  min-height: 3px;\n  border-radius: 99px;\n  background-color: #b5cb48;\n  margin-bottom: 2px;\n}\n.cal .day.today .evdot {\n  background-color: #192003;\n}\n.cal .evcard {\n  margin-top: 10px;\n  background-color: #1d1a22;\n  border-radius: 12px;\n  padding: 10px;\n}\n.cal .evhead {\n  color: #f3eef3;\n  font-size: 12.5px;\n  font-weight: 650;\n  padding: 1px 3px 8px;\n}\n.cal .evrow {\n  background-color: #100e14;\n  border-radius: 10px;\n  padding: 8px 10px;\n  margin-bottom: 4px;\n}\n.cal .evrow:last-child {\n  margin-bottom: 0;\n}\n.cal .evrow .evic {\n  background-color: #628933;\n  border-radius: 8px;\n  padding: 5px;\n}\n.cal .evrow .evic image {\n  color: #fff;\n  -gtk-icon-size: 15px;\n}\n.cal .evrow label {\n  font-size: 12px;\n  font-weight: 650;\n}\n.cal .evrow .sub {\n  color: #b5adbc;\n  font-size: 10.5px;\n  font-weight: 400;\n}\n\n.drawer {\n  background: transparent;\n}\n\n.toast {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 20px;\n  padding: 11px 13px;\n  box-shadow: 0 18px 40px rgba(5, 3, 10, 0.45);\n}\n\n.ncard {\n  background-color: #100e14;\n  border-radius: 20px;\n  padding: 11px 12px;\n}\n.ncard .nic {\n  min-width: 30px;\n  min-height: 30px;\n  border-radius: 9px;\n}\n.ncard {\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.ncard label {\n  font-size: 12.5px;\n  font-weight: 650;\n}\n.ncard .body {\n  color: #b5adbc;\n  font-size: 11.8px;\n  font-weight: 400;\n}\n.ncard .when {\n  color: #8d8693;\n  font-size: 10px;\n}\n.ncard .nx {\n  padding: 5px;\n  border-radius: 99px;\n  color: #8d8693;\n}\n.ncard .nx:hover {\n  background-color: #26232c;\n  color: #ef86a0;\n}\n\n.nhead {\n  background-color: #100e14;\n  border-radius: 14px;\n  padding: 8px 8px 8px 14px;\n  margin-bottom: 8px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n}\n.nhead label {\n  font-size: 13.5px;\n  font-weight: 650;\n}\n.nhead .sub {\n  font-size: 11px;\n  font-weight: 400;\n  color: #8d8693;\n}\n.nhead .nclear {\n  color: #ef86a0;\n  font-size: 11.5px;\n  font-weight: 600;\n  border-radius: 7px;\n  padding: 4px 9px;\n}\n.nhead .nclear:hover {\n  background-color: #1d1a22;\n}\n\n.osd {\n  background-color: rgba(16, 13, 20, 0.82);\n  border-radius: 999px;\n  padding: 10px 15px;\n}\n.osd image {\n  color: #f3eef3;\n  -gtk-icon-size: 15px;\n}\n.osd scale > trough, .osd scale > trough > highlight {\n  min-height: 8px;\n}\n.osd .sval {\n  min-width: 34px;\n  color: #b5adbc;\n  font-size: 12px;\n}\n\n.session {\n  background-color: rgba(9, 3, 14, 0.8);\n}\n.session .sbtn {\n  padding: 6px;\n  border-radius: 12px;\n}\n.session .sic {\n  background-color: #100e14;\n  border-radius: 24px;\n  min-width: 59px;\n  min-height: 59px;\n  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);\n  color: #f3eef3;\n  transition: background-color 200ms, color 200ms;\n}\n.session .red .sic {\n  color: #ef86a0;\n}\n.session .sbtn:hover .sic {\n  background-color: #1d1a22;\n  color: #f3eef3;\n}\n.session .red:hover .sic {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.session label {\n  color: #f3eef3;\n  font-weight: 600;\n  font-size: 12px;\n}\n.session .confirm label {\n  color: #ef86a0;\n  font-weight: 650;\n}\n\n.cmenu {\n  background-color: #100e14;\n  border-radius: 12px;\n  padding: 5px;\n}\n.cmenu .cmi {\n  border-radius: 8px;\n  padding: 8px 10px;\n  font-size: 12px;\n  font-weight: 600;\n}\n.cmenu .cmi:hover {\n  background-color: #1d1a22;\n}\n.cmenu .cmi.danger:hover {\n  background-color: #ef86a0;\n  color: #4b0f1f;\n}\n.cmenu .csep {\n  background-color: #1d1a22;\n  min-height: 1px;\n  margin: 4px 8px;\n}\n\n.dtip {\n  background-color: #100e14;\n  color: #f3eef3;\n  border-radius: 10px;\n  padding: 6px 11px;\n  font-size: 11.5px;\n  font-weight: 600;\n}';

// ags/config.ts
var floating = {
  barH: 42,
  barR: 14,
  gap: 10,
  edge: 12,
  icon: 44,
  dockPad: 5,
  tileH: 54,
  panelW: 352,
  launcherW: 560,
  calendarW: 330
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

// ags/services/gnoblin.ts
import Gio2 from "gi://Gio";
import GLib2 from "gi://GLib";

// ../../../../usr/share/astal/gjs/index.ts
import { default as default3 } from "gi://AstalIO?version=0.1";

// ../../../../usr/share/astal/gjs/file.ts
import Astal7 from "gi://AstalIO";
import Gio from "gi://Gio?version=2.0";

// ../../../../usr/share/astal/gjs/gobject.ts
import GObject2 from "gi://GObject";
import { default as default2 } from "gi://GLib?version=2.0";
var meta = Symbol("meta");
var priv = Symbol("priv");
var { ParamSpec, ParamFlags } = GObject2;

// ags/services/gnoblin.ts
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

// ags/services/notifd.ts
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

// ags/lib/inspect.ts
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

// ags/lib/surface.ts
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

// ags/widget/Bar.tsx
import Battery from "gi://AstalBattery";
import Wp from "gi://AstalWp";
import Network from "gi://AstalNetwork";
import Tray from "gi://AstalTray";

// ags/lib/demo.ts
import GLib5 from "gi://GLib";
var DEMO = !!GLib5.getenv("KOBEL_DEMO");
var D = {
  // bar
  clock: "14:23",
  date: "Sat 4 Jul",
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
  // calendar — pinned "today" so the grid + hero match the prototype exactly
  today: { y: 2026, m: 6, d: 4 },
  // Saturday 4 July 2026
  // launcher pinned tiles + today widget
  apps: ["Terminal", "Files", "Firefox", "Zed", "Spotify", "Settings"],
  widgetDate: "Saturday 4 July",
  widgetEvent: "09:45 \xB7 Daily Standup",
  media: { title: "Weightless", artist: "Marconi Union" }
};

// GTK3 section removed — jsx2 uses GTK4 widgets
var ctors = {
  box: Box,
  button: Button,
  centerbox: CenterBox,
  entry: Entry,
  image: Image,
  label: Label,
  levelbar: LevelBar,
  menubutton: MenuButton,
  overlay: Overlay,
  revealer: Revealer,
  slider: Slider,
  stack: Stack,
  switch: Switch,
  window: Window,
  popover: Popover,
};
function jsx2(ctor, props) {
  return jsx(ctors, ctor, props);
}
var jsxs = jsx2;

// ags/widget/Bar.tsx
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
            /* @__PURE__ */ jsx2("label", { class: "tn tray-lang", valign: Gtk4.Align.CENTER, label: "en" })
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

// ags/widget/Dock.tsx
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
  const player = bind(mpris, "players").as(
    (ps) => ps.find((p) => p.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0] ?? null
  );
  const progress = bind(mpris, "players").as((ps) => {
    const p = ps.find((q) => q.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0];
    if (!p || !p.length || p.length <= 0) return 0;
    return p.position / p.length;
  });
  const icon = bind(mpris, "players").as((ps) => {
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

// ags/widget/Launcher.tsx
import Apps2 from "gi://AstalApps";
import Mpris2 from "gi://AstalMpris";

// ags/lib/fuzzy.ts
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

// ags/widget/Calendar.tsx
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
        /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, valign: Gtk4.Align.CENTER, children: [
          /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, label: e.n }),
          /* @__PURE__ */ jsx2("label", { class: "sub tn", halign: Gtk4.Align.START, label: e.t })
        ] })
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

// ags/widget/Launcher.tsx
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
                  const playIcon = DEMO ? "kobel-play-symbolic" : bind(mpris, "players").as((ps) => {
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

// ags/widget/QuickSettings.tsx
import Network2 from "gi://AstalNetwork";
import Bluetooth from "gi://AstalBluetooth";
import Wp2 from "gi://AstalWp";
import Gio4 from "gi://Gio";
import Battery2 from "gi://AstalBattery";

// ags/lib/tinyslider.ts
import GObject5 from "gi://GObject";
import Gtk7 from "gi://Gtk";
var TinySlider = GObject5.registerClass(
  {
    GTypeName: "KobelTinyScale"
  },
  class TinySlider2 extends Gtk7.Scale {
    constructor(params) {
      const { value, ...rest } = params ?? {};
      super({
        orientation: Gtk7.Orientation.HORIZONTAL,
        adjustment: new Gtk7.Adjustment({
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
      if (orientation === Gtk7.Orientation.HORIZONTAL) {
        return [0, 1, -1, -1];
      }
      return super.vfunc_measure(orientation, for_size);
    }
  }
);

// ags/widget/QuickSettings.tsx
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
  const volValue = DEMO ? D.volume : bind(speaker, "volume");
  const initVol = DEMO ? D.volume : speaker?.volume ?? 0.64;
  const volSlider = new TinySlider({ hexpand: true, cssClasses: ["slider"], value: initVol });
  if (!DEMO && speaker)
    bind(speaker, "volume").subscribe((v) => {
      volSlider.get_adjustment().value = v;
    });
  volSlider.connect("change-value", (_s, _t, v) => {
    if (speaker) speaker.volume = v;
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
      /* @__PURE__ */ jsx2("button", { class: "chev", widthRequest: 31, onClicked: () => drill.set("mix"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-right-symbolic" }) })
    ] }),
    /* @__PURE__ */ jsxs("box", { class: "srow", spacing: 9, children: [
      /* @__PURE__ */ jsx2("image", { iconName: "kobel-brightness-symbolic" }),
      brightSlider,
      /* @__PURE__ */ jsx2("box", { widthRequest: 17 })
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
      /* @__PURE__ */ jsx2("button", { class: "ibtn", onClicked: () => drill.set(null), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-left-symbolic" }) }),
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

// ags/widget/Notifications.tsx
import Notifd2 from "gi://AstalNotifd";
import Mpris3 from "gi://AstalMpris";
var _notifd = null;
var nd = () => _notifd ??= Notifd2.get_default();
var skip = () => !!default2.getenv("KOBEL_SKIP_NOTIFD");
var TOAST_MS = 3800;
var drawerOpen = Variable(false);
var NCARD_W = 327;
function Card({ n: n2 }) {
  return /* @__PURE__ */ jsxs("box", { class: "ncard", spacing: 10, widthRequest: NCARD_W, children: [
    /* @__PURE__ */ jsx2("box", { class: "nic", valign: Gtk4.Align.START, children: /* @__PURE__ */ jsx2("image", { iconName: n2.app_icon || "dialog-information-symbolic", pixelSize: 20 }) }),
    /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, hexpand: true, children: [
      /* @__PURE__ */ jsxs("box", { children: [
        /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, hexpand: true, ellipsize: 3, label: n2.summary }),
        /* @__PURE__ */ jsx2(
          "label",
          {
            class: "when tn",
            label: new Date(n2.time * 1e3).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit"
            })
          }
        )
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
    /* @__PURE__ */ jsx2("button", { class: "nx", valign: Gtk4.Align.START, onClicked: () => n2.dismiss(), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-close-symbolic" }) })
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
              return n2 ? /* @__PURE__ */ jsx2("box", { class: "toast", children: /* @__PURE__ */ jsx2(Card, { n: n2 }) }) : /* @__PURE__ */ jsx2("box", {});
            })
          )
        }
      )
    }
  );
}
function MediaCard() {
  const mpris = Mpris3.get_default();
  if (!mpris) return null;
  const pick = (ps) => ps.find((p) => p.playback_status === Mpris3.PlaybackStatus.PLAYING) ?? ps[0] ?? null;
  const mediaTitle = bind(mpris, "players").as((ps) => pick(ps)?.title ?? "");
  const mediaArtist = bind(mpris, "players").as((ps) => pick(ps)?.artist ?? "");
  const playIcon = bind(mpris, "players").as((ps) => {
    const p = pick(ps);
    return p?.playback_status === Mpris3.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic";
  });
  const hasPlayer = bind(mpris, "players").as((ps) => ps.length > 0);
  return /* @__PURE__ */ jsxs("box", { class: "ncard media", spacing: 11, visible: hasPlayer, children: [
    /* @__PURE__ */ jsx2("image", { pixelSize: 46, iconName: "kobel-music-symbolic" }),
    /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, hexpand: true, valign: Gtk4.Align.CENTER, children: [
      /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, ellipsize: 3, label: mediaTitle }),
      /* @__PURE__ */ jsx2("label", { class: "sub", halign: Gtk4.Align.START, label: mediaArtist })
    ] }),
    /* @__PURE__ */ jsx2("button", { onClicked: () => execAsync("playerctl previous"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-skip-back-symbolic" }) }),
    /* @__PURE__ */ jsx2("button", { onClicked: () => execAsync("playerctl play-pause"), children: /* @__PURE__ */ jsx2("image", { iconName: playIcon }) }),
    /* @__PURE__ */ jsx2("button", { onClicked: () => execAsync("playerctl next"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-skip-fwd-symbolic" }) })
  ] });
}
function Drawer() {
  if (skip()) return null;
  const nfd = nd();
  const list = Variable(nfd.get_notifications() ?? []);
  const refresh = () => list.set(nfd.get_notifications() ?? []);
  nfd.connect("notified", refresh);
  nfd.connect("resolved", refresh);
  const { winVisible, revealed, setRevealer, close, toggle: toggleFn } = makeReveal(200, 150);
  register("drawer", toggleFn);
  revealed.subscribe((r) => drawerOpen.set(r));
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
              /* @__PURE__ */ jsx2("label", { hexpand: true, halign: Gtk4.Align.START, label: "Notifications" }),
              /* @__PURE__ */ jsx2("label", { class: "tn sub", label: bind(list).as((n2) => `${n2.length || ""}`) }),
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
              (ns) => ns && ns.length ? ns.map((n2) => /* @__PURE__ */ jsx2(Card, { n: n2 })) : [
                /* @__PURE__ */ jsx2("box", { class: "ncard empty", halign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("label", { label: "All caught up \u2713" }) })
              ]
            ) })
          ] })
        }
      )
    }
  );
}

// ags/widget/OSD.tsx
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
            class: "tn",
            label: bind(speaker, "volume").as((v) => `${Math.round(v * 100)}%`)
          }
        )
      ] })
    }
  );
}

// ags/widget/Session.tsx
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

// ags/app.ts
import GLibIcons from "gi://GLib";
Object.defineProperty(Gtk9.Widget.prototype, "class", {
  configurable: true,
  set(v) {
    this.set_css_classes(String(v).split(/\s+/).filter(Boolean));
  },
  get() {
    return this.get_css_classes().join(" ");
  }
});
Gtk9.Widget.prototype.set_class = function(v) {
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
      const prov = new Gtk9.CssProvider();
      prov.load_from_string(main_default + tokenCss(tokens));
      Gtk9.StyleContext.add_provider_for_display(
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYXBwLnRzIiwgInNhc3M6L2hvbWUva2llcmFuL2Rldi9rb2JlbC1zaGVsbC9hZ3Mvc3R5bGUvbWFpbi5zY3NzIiwgIi4uL2NvbmZpZy50cyIsICIuLi9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9zZXJ2aWNlcy9ub3RpZmQudHMiLCAiLi4vbGliL2luc3BlY3QudHMiLCAiLi4vbGliL3N1cmZhY2UudHMiLCAiLi4vd2lkZ2V0L0Jhci50c3giLCAiLi4vbGliL2RlbW8udHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGszL3dpZGdldC50cyIsICIuLi8uLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL2d0azMvYXN0YWxpZnkudHMiLCAiLi4vLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGszL2pzeC1ydW50aW1lLnRzIiwgIi4uL3dpZGdldC9Eb2NrLnRzeCIsICIuLi93aWRnZXQvTGF1bmNoZXIudHN4IiwgIi4uL2xpYi9mdXp6eS50cyIsICIuLi93aWRnZXQvQ2FsZW5kYXIudHN4IiwgIi4uL3dpZGdldC9RdWlja1NldHRpbmdzLnRzeCIsICIuLi9saWIvdGlueXNsaWRlci50cyIsICIuLi93aWRnZXQvTm90aWZpY2F0aW9ucy50c3giLCAiLi4vd2lkZ2V0L09TRC50c3giLCAiLi4vd2lkZ2V0L1Nlc3Npb24udHN4Il0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUgQ29uc3RydWN0UHJvcHMgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmV4cG9ydCB7IEFzdGFsLCBHdGssIEdkayB9XG5leHBvcnQgeyBkZWZhdWx0IGFzIEFwcCB9IGZyb20gXCIuL2FwcC5qc1wiXG5leHBvcnQgeyBhc3RhbGlmeSwgQ29uc3RydWN0UHJvcHMgfVxuZXhwb3J0ICogYXMgV2lkZ2V0IGZyb20gXCIuL3dpZGdldC5qc1wiXG5leHBvcnQgeyBob29rIH0gZnJvbSBcIi4uL19hc3RhbFwiXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEJpbmRpbmcsIHsgdHlwZSBDb25uZWN0YWJsZSwgdHlwZSBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcbmltcG9ydCB7IGludGVydmFsIH0gZnJvbSBcIi4vdGltZS5qc1wiXG5pbXBvcnQgeyBleGVjQXN5bmMsIHN1YnByb2Nlc3MgfSBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcblxuY2xhc3MgVmFyaWFibGVXcmFwcGVyPFQ+IGV4dGVuZHMgRnVuY3Rpb24ge1xuICAgIHByaXZhdGUgdmFyaWFibGUhOiBBc3RhbC5WYXJpYWJsZUJhc2VcbiAgICBwcml2YXRlIGVyckhhbmRsZXI/ID0gY29uc29sZS5lcnJvclxuXG4gICAgcHJpdmF0ZSBfdmFsdWU6IFRcbiAgICBwcml2YXRlIF9wb2xsPzogQXN0YWwuVGltZVxuICAgIHByaXZhdGUgX3dhdGNoPzogQXN0YWwuUHJvY2Vzc1xuXG4gICAgcHJpdmF0ZSBwb2xsSW50ZXJ2YWwgPSAxMDAwXG4gICAgcHJpdmF0ZSBwb2xsRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG4gICAgcHJpdmF0ZSBwb2xsVHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgcHJpdmF0ZSBwb2xsRm4/OiAocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD5cblxuICAgIHByaXZhdGUgd2F0Y2hUcmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICBwcml2YXRlIHdhdGNoRXhlYz86IHN0cmluZ1tdIHwgc3RyaW5nXG5cbiAgICBjb25zdHJ1Y3Rvcihpbml0OiBUKSB7XG4gICAgICAgIHN1cGVyKClcbiAgICAgICAgdGhpcy5fdmFsdWUgPSBpbml0XG4gICAgICAgIHRoaXMudmFyaWFibGUgPSBuZXcgQXN0YWwuVmFyaWFibGVCYXNlKClcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZHJvcHBlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN0b3BXYXRjaCgpXG4gICAgICAgICAgICB0aGlzLnN0b3BQb2xsKClcbiAgICAgICAgfSlcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gdGhpcy5lcnJIYW5kbGVyPy4oZXJyKSlcbiAgICAgICAgcmV0dXJuIG5ldyBQcm94eSh0aGlzLCB7XG4gICAgICAgICAgICBhcHBseTogKHRhcmdldCwgXywgYXJncykgPT4gdGFyZ2V0Ll9jYWxsKGFyZ3NbMF0pLFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHByaXZhdGUgX2NhbGw8UiA9IFQ+KHRyYW5zZm9ybT86ICh2YWx1ZTogVCkgPT4gUik6IEJpbmRpbmc8Uj4ge1xuICAgICAgICBjb25zdCBiID0gQmluZGluZy5iaW5kKHRoaXMpXG4gICAgICAgIHJldHVybiB0cmFuc2Zvcm0gPyBiLmFzKHRyYW5zZm9ybSkgOiBiIGFzIHVua25vd24gYXMgQmluZGluZzxSPlxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gU3RyaW5nKGBWYXJpYWJsZTwke3RoaXMuZ2V0KCl9PmApXG4gICAgfVxuXG4gICAgZ2V0KCk6IFQgeyByZXR1cm4gdGhpcy5fdmFsdWUgfVxuICAgIHNldCh2YWx1ZTogVCkge1xuICAgICAgICBpZiAodmFsdWUgIT09IHRoaXMuX3ZhbHVlKSB7XG4gICAgICAgICAgICB0aGlzLl92YWx1ZSA9IHZhbHVlXG4gICAgICAgICAgICB0aGlzLnZhcmlhYmxlLmVtaXQoXCJjaGFuZ2VkXCIpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFBvbGwoKSB7XG4gICAgICAgIGlmICh0aGlzLl9wb2xsKVxuICAgICAgICAgICAgcmV0dXJuXG5cbiAgICAgICAgaWYgKHRoaXMucG9sbEZuKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB2ID0gdGhpcy5wb2xsRm4hKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICAgICAgaWYgKHYgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgICAgICAgICAgIHYudGhlbih2ID0+IHRoaXMuc2V0KHYpKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpKVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2V0KHYpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLnBvbGxFeGVjKSB7XG4gICAgICAgICAgICB0aGlzLl9wb2xsID0gaW50ZXJ2YWwodGhpcy5wb2xsSW50ZXJ2YWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBleGVjQXN5bmModGhpcy5wb2xsRXhlYyEpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKHYgPT4gdGhpcy5zZXQodGhpcy5wb2xsVHJhbnNmb3JtISh2LCB0aGlzLmdldCgpKSkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzdGFydFdhdGNoKCkge1xuICAgICAgICBpZiAodGhpcy5fd2F0Y2gpXG4gICAgICAgICAgICByZXR1cm5cblxuICAgICAgICB0aGlzLl93YXRjaCA9IHN1YnByb2Nlc3Moe1xuICAgICAgICAgICAgY21kOiB0aGlzLndhdGNoRXhlYyEsXG4gICAgICAgICAgICBvdXQ6IG91dCA9PiB0aGlzLnNldCh0aGlzLndhdGNoVHJhbnNmb3JtIShvdXQsIHRoaXMuZ2V0KCkpKSxcbiAgICAgICAgICAgIGVycjogZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVyciksXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgc3RvcFBvbGwoKSB7XG4gICAgICAgIHRoaXMuX3BvbGw/LmNhbmNlbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl9wb2xsXG4gICAgfVxuXG4gICAgc3RvcFdhdGNoKCkge1xuICAgICAgICB0aGlzLl93YXRjaD8ua2lsbCgpXG4gICAgICAgIGRlbGV0ZSB0aGlzLl93YXRjaFxuICAgIH1cblxuICAgIGlzUG9sbGluZygpIHsgcmV0dXJuICEhdGhpcy5fcG9sbCB9XG4gICAgaXNXYXRjaGluZygpIHsgcmV0dXJuICEhdGhpcy5fd2F0Y2ggfVxuXG4gICAgZHJvcCgpIHtcbiAgICAgICAgdGhpcy52YXJpYWJsZS5lbWl0KFwiZHJvcHBlZFwiKVxuICAgIH1cblxuICAgIG9uRHJvcHBlZChjYWxsYmFjazogKCkgPT4gdm9pZCkge1xuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJkcm9wcGVkXCIsIGNhbGxiYWNrKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb25FcnJvcihjYWxsYmFjazogKGVycjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmVyckhhbmRsZXJcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZXJyb3JcIiwgKF8sIGVycikgPT4gY2FsbGJhY2soZXJyKSlcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKSB7XG4gICAgICAgIGNvbnN0IGlkID0gdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiY2hhbmdlZFwiLCAoKSA9PiB7XG4gICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICB9KVxuICAgICAgICByZXR1cm4gKCkgPT4gdGhpcy52YXJpYWJsZS5kaXNjb25uZWN0KGlkKVxuICAgIH1cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgY2FsbGJhY2s6IChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPlxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSB8ICgocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD4pLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wUG9sbCgpXG4gICAgICAgIHRoaXMucG9sbEludGVydmFsID0gaW50ZXJ2YWxcbiAgICAgICAgdGhpcy5wb2xsVHJhbnNmb3JtID0gdHJhbnNmb3JtXG4gICAgICAgIGlmICh0eXBlb2YgZXhlYyA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxGbiA9IGV4ZWNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBvbGxFeGVjXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBvbGxFeGVjID0gZXhlY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucG9sbEZuXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5zdGFydFBvbGwoKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgd2F0Y2goXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgICAgICB0cmFuc2Zvcm06IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVCA9IG91dCA9PiBvdXQgYXMgVCxcbiAgICApIHtcbiAgICAgICAgdGhpcy5zdG9wV2F0Y2goKVxuICAgICAgICB0aGlzLndhdGNoRXhlYyA9IGV4ZWNcbiAgICAgICAgdGhpcy53YXRjaFRyYW5zZm9ybSA9IHRyYW5zZm9ybVxuICAgICAgICB0aGlzLnN0YXJ0V2F0Y2goKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqczogQXJyYXk8W29iajogQ29ubmVjdGFibGUsIHNpZ25hbDogc3RyaW5nXT4sXG4gICAgICAgIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9iajogQ29ubmVjdGFibGUsXG4gICAgICAgIHNpZ25hbDogc3RyaW5nLFxuICAgICAgICBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmpzOiBDb25uZWN0YWJsZSB8IEFycmF5PFtvYmo6IENvbm5lY3RhYmxlLCBzaWduYWw6IHN0cmluZ10+LFxuICAgICAgICBzaWdPckZuOiBzdHJpbmcgfCAoKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiBUKSxcbiAgICAgICAgY2FsbGJhY2s/OiAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKSB7XG4gICAgICAgIGNvbnN0IGYgPSB0eXBlb2Ygc2lnT3JGbiA9PT0gXCJmdW5jdGlvblwiID8gc2lnT3JGbiA6IGNhbGxiYWNrID8/ICgoKSA9PiB0aGlzLmdldCgpKVxuICAgICAgICBjb25zdCBzZXQgPSAob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IHRoaXMuc2V0KGYob2JqLCAuLi5hcmdzKSlcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvYmpzKSkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBvYmogb2Ygb2Jqcykge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtvLCBzXSA9IG9ialxuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gby5jb25uZWN0KHMsIHNldClcbiAgICAgICAgICAgICAgICB0aGlzLm9uRHJvcHBlZCgoKSA9PiBvLmRpc2Nvbm5lY3QoaWQpKVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBzaWdPckZuID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaWQgPSBvYmpzLmNvbm5lY3Qoc2lnT3JGbiwgc2V0KVxuICAgICAgICAgICAgICAgIHRoaXMub25Ecm9wcGVkKCgpID0+IG9ianMuZGlzY29ubmVjdChpZCkpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgc3RhdGljIGRlcml2ZTxcbiAgICAgICAgY29uc3QgRGVwcyBleHRlbmRzIEFycmF5PFN1YnNjcmliYWJsZTxhbnk+PixcbiAgICAgICAgQXJncyBleHRlbmRzIHtcbiAgICAgICAgICAgIFtLIGluIGtleW9mIERlcHNdOiBEZXBzW0tdIGV4dGVuZHMgU3Vic2NyaWJhYmxlPGluZmVyIFQ+ID8gVCA6IG5ldmVyXG4gICAgICAgIH0sXG4gICAgICAgIFYgPSBBcmdzLFxuICAgID4oZGVwczogRGVwcywgZm46ICguLi5hcmdzOiBBcmdzKSA9PiBWID0gKC4uLmFyZ3MpID0+IGFyZ3MgYXMgdW5rbm93biBhcyBWKSB7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IGZuKC4uLmRlcHMubWFwKGQgPT4gZC5nZXQoKSkgYXMgQXJncylcbiAgICAgICAgY29uc3QgZGVyaXZlZCA9IG5ldyBWYXJpYWJsZSh1cGRhdGUoKSlcbiAgICAgICAgY29uc3QgdW5zdWJzID0gZGVwcy5tYXAoZGVwID0+IGRlcC5zdWJzY3JpYmUoKCkgPT4gZGVyaXZlZC5zZXQodXBkYXRlKCkpKSlcbiAgICAgICAgZGVyaXZlZC5vbkRyb3BwZWQoKCkgPT4gdW5zdWJzLm1hcCh1bnN1YiA9PiB1bnN1YigpKSlcbiAgICAgICAgcmV0dXJuIGRlcml2ZWRcbiAgICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmFyaWFibGU8VD4gZXh0ZW5kcyBPbWl0PFZhcmlhYmxlV3JhcHBlcjxUPiwgXCJiaW5kXCI+IHtcbiAgICA8Uj4odHJhbnNmb3JtOiAodmFsdWU6IFQpID0+IFIpOiBCaW5kaW5nPFI+XG4gICAgKCk6IEJpbmRpbmc8VD5cbn1cblxuZXhwb3J0IGNvbnN0IFZhcmlhYmxlID0gbmV3IFByb3h5KFZhcmlhYmxlV3JhcHBlciBhcyBhbnksIHtcbiAgICBhcHBseTogKF90LCBfYSwgYXJncykgPT4gbmV3IFZhcmlhYmxlV3JhcHBlcihhcmdzWzBdKSxcbn0pIGFzIHtcbiAgICBkZXJpdmU6IHR5cGVvZiBWYXJpYWJsZVdyYXBwZXJbXCJkZXJpdmVcIl1cbiAgICA8VD4oaW5pdDogVCk6IFZhcmlhYmxlPFQ+XG4gICAgbmV3PFQ+KGluaXQ6IFQpOiBWYXJpYWJsZTxUPlxufVxuXG5leHBvcnQgY29uc3QgeyBkZXJpdmUgfSA9IFZhcmlhYmxlXG5leHBvcnQgZGVmYXVsdCBWYXJpYWJsZVxuIiwgImV4cG9ydCBjb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuZXhwb3J0IGNvbnN0IGtlYmFiaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMS0kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiX1wiLCBcIi1cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5leHBvcnQgaW50ZXJmYWNlIFN1YnNjcmliYWJsZTxUID0gdW5rbm93bj4ge1xuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBUKSA9PiB2b2lkKTogKCkgPT4gdm9pZFxuICAgIGdldCgpOiBUXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29ubmVjdGFibGUge1xuICAgIGNvbm5lY3Qoc2lnbmFsOiBzdHJpbmcsIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IHVua25vd24pOiBudW1iZXJcbiAgICBkaXNjb25uZWN0KGlkOiBudW1iZXIpOiB2b2lkXG4gICAgW2tleTogc3RyaW5nXTogYW55XG59XG5cbmV4cG9ydCBjbGFzcyBCaW5kaW5nPFZhbHVlPiB7XG4gICAgcHJpdmF0ZSB0cmFuc2Zvcm1GbiA9ICh2OiBhbnkpID0+IHZcblxuICAgICNlbWl0dGVyOiBTdWJzY3JpYmFibGU8VmFsdWU+IHwgQ29ubmVjdGFibGVcbiAgICAjcHJvcD86IHN0cmluZ1xuXG4gICAgc3RhdGljIGJpbmQ8XG4gICAgICAgIFQgZXh0ZW5kcyBDb25uZWN0YWJsZSxcbiAgICAgICAgUCBleHRlbmRzIGtleW9mIFQsXG4gICAgPihvYmplY3Q6IFQsIHByb3BlcnR5OiBQKTogQmluZGluZzxUW1BdPlxuXG4gICAgc3RhdGljIGJpbmQ8VD4ob2JqZWN0OiBTdWJzY3JpYmFibGU8VD4pOiBCaW5kaW5nPFQ+XG5cbiAgICBzdGF0aWMgYmluZChlbWl0dGVyOiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSwgcHJvcD86IHN0cmluZykge1xuICAgICAgICByZXR1cm4gbmV3IEJpbmRpbmcoZW1pdHRlciwgcHJvcClcbiAgICB9XG5cbiAgICBwcml2YXRlIGNvbnN0cnVjdG9yKGVtaXR0ZXI6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlPFZhbHVlPiwgcHJvcD86IHN0cmluZykge1xuICAgICAgICB0aGlzLiNlbWl0dGVyID0gZW1pdHRlclxuICAgICAgICB0aGlzLiNwcm9wID0gcHJvcCAmJiBrZWJhYmlmeShwcm9wKVxuICAgIH1cblxuICAgIHRvU3RyaW5nKCkge1xuICAgICAgICByZXR1cm4gYEJpbmRpbmc8JHt0aGlzLiNlbWl0dGVyfSR7dGhpcy4jcHJvcCA/IGAsIFwiJHt0aGlzLiNwcm9wfVwiYCA6IFwiXCJ9PmBcbiAgICB9XG5cbiAgICBhczxUPihmbjogKHY6IFZhbHVlKSA9PiBUKTogQmluZGluZzxUPiB7XG4gICAgICAgIGNvbnN0IGJpbmQgPSBuZXcgQmluZGluZyh0aGlzLiNlbWl0dGVyLCB0aGlzLiNwcm9wKVxuICAgICAgICBiaW5kLnRyYW5zZm9ybUZuID0gKHY6IFZhbHVlKSA9PiBmbih0aGlzLnRyYW5zZm9ybUZuKHYpKVxuICAgICAgICByZXR1cm4gYmluZCBhcyB1bmtub3duIGFzIEJpbmRpbmc8VD5cbiAgICB9XG5cbiAgICBnZXQoKTogVmFsdWUge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuZ2V0ID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyLmdldCgpKVxuXG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jcHJvcCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgY29uc3QgZ2V0dGVyID0gYGdldF8ke3NuYWtlaWZ5KHRoaXMuI3Byb3ApfWBcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlcltnZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlcltnZXR0ZXJdKCkpXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXJbdGhpcy4jcHJvcF0pXG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBFcnJvcihcImNhbiBub3QgZ2V0IHZhbHVlIG9mIGJpbmRpbmdcIilcbiAgICB9XG5cbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVmFsdWUpID0+IHZvaWQpOiAoKSA9PiB2b2lkIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLnN1YnNjcmliZSA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy4jZW1pdHRlci5zdWJzY3JpYmUoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgY29uc3Qgc2lnbmFsID0gYG5vdGlmeTo6JHt0aGlzLiNwcm9wfWBcbiAgICAgICAgICAgIGNvbnN0IGlkID0gdGhpcy4jZW1pdHRlci5jb25uZWN0KHNpZ25hbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgcmV0dXJuICgpID0+IHtcbiAgICAgICAgICAgICAgICAodGhpcy4jZW1pdHRlci5kaXNjb25uZWN0IGFzIENvbm5lY3RhYmxlW1wiZGlzY29ubmVjdFwiXSkoaWQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgRXJyb3IoYCR7dGhpcy4jZW1pdHRlcn0gaXMgbm90IGJpbmRhYmxlYClcbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCB7IGJpbmQgfSA9IEJpbmRpbmdcbmV4cG9ydCBkZWZhdWx0IEJpbmRpbmdcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5cbmV4cG9ydCB0eXBlIFRpbWUgPSBBc3RhbC5UaW1lXG5leHBvcnQgY29uc3QgVGltZSA9IEFzdGFsLlRpbWVcblxuZXhwb3J0IGZ1bmN0aW9uIGludGVydmFsKGludGVydmFsOiBudW1iZXIsIGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLmludGVydmFsKGludGVydmFsLCAoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXQodGltZW91dDogbnVtYmVyLCBjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS50aW1lb3V0KHRpbWVvdXQsICgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaWRsZShjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS5pZGxlKCgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcblxudHlwZSBBcmdzID0ge1xuICAgIGNtZDogc3RyaW5nIHwgc3RyaW5nW11cbiAgICBvdXQ/OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWRcbiAgICBlcnI/OiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWRcbn1cblxuZXhwb3J0IHR5cGUgUHJvY2VzcyA9IEFzdGFsLlByb2Nlc3NcbmV4cG9ydCBjb25zdCBQcm9jZXNzID0gQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhhcmdzOiBBcmdzKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBjbWQ6IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgIG9uT3V0PzogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkLFxuICAgIG9uRXJyPzogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkLFxuKTogQXN0YWwuUHJvY2Vzc1xuXG5leHBvcnQgZnVuY3Rpb24gc3VicHJvY2VzcyhcbiAgICBhcmdzT3JDbWQ6IEFyZ3MgfCBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICBvbk91dDogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkID0gcHJpbnQsXG4gICAgb25FcnI6IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZCA9IHByaW50ZXJyLFxuKSB7XG4gICAgY29uc3QgYXJncyA9IEFycmF5LmlzQXJyYXkoYXJnc09yQ21kKSB8fCB0eXBlb2YgYXJnc09yQ21kID09PSBcInN0cmluZ1wiXG4gICAgY29uc3QgeyBjbWQsIGVyciwgb3V0IH0gPSB7XG4gICAgICAgIGNtZDogYXJncyA/IGFyZ3NPckNtZCA6IGFyZ3NPckNtZC5jbWQsXG4gICAgICAgIGVycjogYXJncyA/IG9uRXJyIDogYXJnc09yQ21kLmVyciB8fCBvbkVycixcbiAgICAgICAgb3V0OiBhcmdzID8gb25PdXQgOiBhcmdzT3JDbWQub3V0IHx8IG9uT3V0LFxuICAgIH1cblxuICAgIGNvbnN0IHByb2MgPSBBcnJheS5pc0FycmF5KGNtZClcbiAgICAgICAgPyBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3N2KGNtZClcbiAgICAgICAgOiBBc3RhbC5Qcm9jZXNzLnN1YnByb2Nlc3MoY21kKVxuXG4gICAgcHJvYy5jb25uZWN0KFwic3Rkb3V0XCIsIChfLCBzdGRvdXQ6IHN0cmluZykgPT4gb3V0KHN0ZG91dCkpXG4gICAgcHJvYy5jb25uZWN0KFwic3RkZXJyXCIsIChfLCBzdGRlcnI6IHN0cmluZykgPT4gZXJyKHN0ZGVycikpXG4gICAgcmV0dXJuIHByb2Ncbn1cblxuLyoqIEB0aHJvd3Mge0dMaWIuRXJyb3J9IFRocm93cyBzdGRlcnIgKi9cbmV4cG9ydCBmdW5jdGlvbiBleGVjKGNtZDogc3RyaW5nIHwgc3RyaW5nW10pIHtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShjbWQpXG4gICAgICAgID8gQXN0YWwuUHJvY2Vzcy5leGVjdihjbWQpXG4gICAgICAgIDogQXN0YWwuUHJvY2Vzcy5leGVjKGNtZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4ZWNBc3luYyhjbWQ6IHN0cmluZyB8IHN0cmluZ1tdKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShjbWQpKSB7XG4gICAgICAgICAgICBBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmN2KGNtZCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jdl9maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIEFzdGFsLlByb2Nlc3MuZXhlY19hc3luYyhjbWQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLlByb2Nlc3MuZXhlY19maW5pc2gocmVzKSlcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiaW1wb3J0IFZhcmlhYmxlIGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbmltcG9ydCB7IGV4ZWNBc3luYyB9IGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuaW1wb3J0IEJpbmRpbmcsIHsgQ29ubmVjdGFibGUsIGtlYmFiaWZ5LCBzbmFrZWlmeSwgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCBjb25zdCBub0ltcGxpY2l0RGVzdHJveSA9IFN5bWJvbChcIm5vIG5vIGltcGxpY2l0IGRlc3Ryb3lcIilcbmV4cG9ydCBjb25zdCBzZXRDaGlsZHJlbiA9IFN5bWJvbChcImNoaWxkcmVuIHNldHRlciBtZXRob2RcIilcblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlQmluZGluZ3MoYXJyYXk6IGFueVtdKSB7XG4gICAgZnVuY3Rpb24gZ2V0VmFsdWVzKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgIGxldCBpID0gMFxuICAgICAgICByZXR1cm4gYXJyYXkubWFwKHZhbHVlID0+IHZhbHVlIGluc3RhbmNlb2YgQmluZGluZ1xuICAgICAgICAgICAgPyBhcmdzW2krK11cbiAgICAgICAgICAgIDogdmFsdWUsXG4gICAgICAgIClcbiAgICB9XG5cbiAgICBjb25zdCBiaW5kaW5ncyA9IGFycmF5LmZpbHRlcihpID0+IGkgaW5zdGFuY2VvZiBCaW5kaW5nKVxuXG4gICAgaWYgKGJpbmRpbmdzLmxlbmd0aCA9PT0gMClcbiAgICAgICAgcmV0dXJuIGFycmF5XG5cbiAgICBpZiAoYmluZGluZ3MubGVuZ3RoID09PSAxKVxuICAgICAgICByZXR1cm4gYmluZGluZ3NbMF0uYXMoZ2V0VmFsdWVzKVxuXG4gICAgcmV0dXJuIFZhcmlhYmxlLmRlcml2ZShiaW5kaW5ncywgZ2V0VmFsdWVzKSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRQcm9wKG9iajogYW55LCBwcm9wOiBzdHJpbmcsIHZhbHVlOiBhbnkpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBzZXR0ZXIgPSBgc2V0XyR7c25ha2VpZnkocHJvcCl9YFxuICAgICAgICBpZiAodHlwZW9mIG9ialtzZXR0ZXJdID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgICAgICByZXR1cm4gb2JqW3NldHRlcl0odmFsdWUpXG5cbiAgICAgICAgcmV0dXJuIChvYmpbcHJvcF0gPSB2YWx1ZSlcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBjb3VsZCBub3Qgc2V0IHByb3BlcnR5IFwiJHtwcm9wfVwiIG9uICR7b2JqfTpgLCBlcnJvcilcbiAgICB9XG59XG5cbmV4cG9ydCB0eXBlIEJpbmRhYmxlUHJvcHM8VD4gPSB7XG4gICAgW0sgaW4ga2V5b2YgVF06IEJpbmRpbmc8VFtLXT4gfCBUW0tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaG9vazxXaWRnZXQgZXh0ZW5kcyBDb25uZWN0YWJsZT4oXG4gICAgd2lkZ2V0OiBXaWRnZXQsXG4gICAgb2JqZWN0OiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSxcbiAgICBzaWduYWxPckNhbGxiYWNrOiBzdHJpbmcgfCAoKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQpLFxuICAgIGNhbGxiYWNrPzogKHNlbGY6IFdpZGdldCwgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4pIHtcbiAgICBpZiAodHlwZW9mIG9iamVjdC5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIgJiYgY2FsbGJhY2spIHtcbiAgICAgICAgY29uc3QgaWQgPSBvYmplY3QuY29ubmVjdChzaWduYWxPckNhbGxiYWNrLCAoXzogYW55LCAuLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCAoKSA9PiB7XG4gICAgICAgICAgICAob2JqZWN0LmRpc2Nvbm5lY3QgYXMgQ29ubmVjdGFibGVbXCJkaXNjb25uZWN0XCJdKShpZClcbiAgICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBvYmplY3Quc3Vic2NyaWJlID09PSBcImZ1bmN0aW9uXCIgJiYgdHlwZW9mIHNpZ25hbE9yQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCB1bnN1YiA9IG9iamVjdC5zdWJzY3JpYmUoKC4uLmFyZ3M6IHVua25vd25bXSkgPT4ge1xuICAgICAgICAgICAgc2lnbmFsT3JDYWxsYmFjayh3aWRnZXQsIC4uLmFyZ3MpXG4gICAgICAgIH0pXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCB1bnN1YilcbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb25zdHJ1Y3Q8V2lkZ2V0IGV4dGVuZHMgQ29ubmVjdGFibGUgJiB7IFtzZXRDaGlsZHJlbl06IChjaGlsZHJlbjogYW55W10pID0+IHZvaWQgfT4od2lkZ2V0OiBXaWRnZXQsIGNvbmZpZzogYW55KSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIHByZWZlci1jb25zdFxuICAgIGxldCB7IHNldHVwLCBjaGlsZCwgY2hpbGRyZW4gPSBbXSwgLi4ucHJvcHMgfSA9IGNvbmZpZ1xuXG4gICAgaWYgKGNoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cbiAgICB9XG5cbiAgICBpZiAoY2hpbGQpIHtcbiAgICAgICAgY2hpbGRyZW4udW5zaGlmdChjaGlsZClcbiAgICB9XG5cbiAgICAvLyByZW1vdmUgdW5kZWZpbmVkIHZhbHVlc1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNvbGxlY3QgYmluZGluZ3NcbiAgICBjb25zdCBiaW5kaW5nczogQXJyYXk8W3N0cmluZywgQmluZGluZzxhbnk+XT4gPSBPYmplY3RcbiAgICAgICAgLmtleXMocHJvcHMpXG4gICAgICAgIC5yZWR1Y2UoKGFjYzogYW55LCBwcm9wKSA9PiB7XG4gICAgICAgICAgICBpZiAocHJvcHNbcHJvcF0gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYmluZGluZyA9IHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW3Byb3BdXG4gICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5hY2MsIFtwcm9wLCBiaW5kaW5nXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBjb2xsZWN0IHNpZ25hbCBoYW5kbGVyc1xuICAgIGNvbnN0IG9uSGFuZGxlcnM6IEFycmF5PFtzdHJpbmcsIHN0cmluZyB8ICgoKSA9PiB1bmtub3duKV0+ID0gT2JqZWN0XG4gICAgICAgIC5rZXlzKHByb3BzKVxuICAgICAgICAucmVkdWNlKChhY2M6IGFueSwga2V5KSA9PiB7XG4gICAgICAgICAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoXCJvblwiKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNpZyA9IGtlYmFiaWZ5KGtleSkuc3BsaXQoXCItXCIpLnNsaWNlKDEpLmpvaW4oXCItXCIpXG4gICAgICAgICAgICAgICAgY29uc3QgaGFuZGxlciA9IHByb3BzW2tleV1cbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICAgICAgICAgIHJldHVybiBbLi4uYWNjLCBbc2lnLCBoYW5kbGVyXV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhY2NcbiAgICAgICAgfSwgW10pXG5cbiAgICAvLyBzZXQgY2hpbGRyZW5cbiAgICBjb25zdCBtZXJnZWRDaGlsZHJlbiA9IG1lcmdlQmluZGluZ3MoY2hpbGRyZW4uZmxhdChJbmZpbml0eSkpXG4gICAgaWYgKG1lcmdlZENoaWxkcmVuIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuLmdldCgpKVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgbWVyZ2VkQ2hpbGRyZW4uc3Vic2NyaWJlKCh2KSA9PiB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKHYpXG4gICAgICAgIH0pKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChtZXJnZWRDaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKG1lcmdlZENoaWxkcmVuKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0dXAgc2lnbmFsIGhhbmRsZXJzXG4gICAgZm9yIChjb25zdCBbc2lnbmFsLCBjYWxsYmFja10gb2Ygb25IYW5kbGVycykge1xuICAgICAgICBjb25zdCBzaWcgPSBzaWduYWwuc3RhcnRzV2l0aChcIm5vdGlmeVwiKVxuICAgICAgICAgICAgPyBzaWduYWwucmVwbGFjZShcIi1cIiwgXCI6OlwiKVxuICAgICAgICAgICAgOiBzaWduYWxcblxuICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KHNpZywgY2FsbGJhY2spXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChzaWcsICgpID0+IGV4ZWNBc3luYyhjYWxsYmFjaylcbiAgICAgICAgICAgICAgICAudGhlbihwcmludCkuY2F0Y2goY29uc29sZS5lcnJvcikpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZXR1cCBiaW5kaW5ncyBoYW5kbGVyc1xuICAgIGZvciAoY29uc3QgW3Byb3AsIGJpbmRpbmddIG9mIGJpbmRpbmdzKSB7XG4gICAgICAgIGlmIChwcm9wID09PSBcImNoaWxkXCIgfHwgcHJvcCA9PT0gXCJjaGlsZHJlblwiKSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgYmluZGluZy5zdWJzY3JpYmUoKHY6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0odilcbiAgICAgICAgICAgIH0pKVxuICAgICAgICB9XG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBiaW5kaW5nLnN1YnNjcmliZSgodjogYW55KSA9PiB7XG4gICAgICAgICAgICBzZXRQcm9wKHdpZGdldCwgcHJvcCwgdilcbiAgICAgICAgfSkpXG4gICAgICAgIHNldFByb3Aod2lkZ2V0LCBwcm9wLCBiaW5kaW5nLmdldCgpKVxuICAgIH1cblxuICAgIC8vIGZpbHRlciB1bmRlZmluZWQgdmFsdWVzXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHByb3BzKVxuICAgIHNldHVwPy4od2lkZ2V0KVxuICAgIHJldHVybiB3aWRnZXRcbn1cblxuZnVuY3Rpb24gaXNBcnJvd0Z1bmN0aW9uKGZ1bmM6IGFueSk6IGZ1bmMgaXMgKGFyZ3M6IGFueSkgPT4gYW55IHtcbiAgICByZXR1cm4gIU9iamVjdC5oYXNPd24oZnVuYywgXCJwcm90b3R5cGVcIilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yczogUmVjb3JkPHN0cmluZywgeyBuZXcocHJvcHM6IGFueSk6IGFueSB9IHwgKChwcm9wczogYW55KSA9PiBhbnkpPixcbiAgICBjdG9yOiBzdHJpbmcgfCAoKHByb3BzOiBhbnkpID0+IGFueSkgfCB7IG5ldyhwcm9wczogYW55KTogYW55IH0sXG4gICAgeyBjaGlsZHJlbiwgLi4ucHJvcHMgfTogYW55LFxuKSB7XG4gICAgY2hpbGRyZW4gPz89IFtdXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoY2hpbGRyZW4pKVxuICAgICAgICBjaGlsZHJlbiA9IFtjaGlsZHJlbl1cblxuICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmlsdGVyKEJvb2xlYW4pXG5cbiAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID09PSAxKVxuICAgICAgICBwcm9wcy5jaGlsZCA9IGNoaWxkcmVuWzBdXG4gICAgZWxzZSBpZiAoY2hpbGRyZW4ubGVuZ3RoID4gMSlcbiAgICAgICAgcHJvcHMuY2hpbGRyZW4gPSBjaGlsZHJlblxuXG4gICAgaWYgKHR5cGVvZiBjdG9yID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChpc0Fycm93RnVuY3Rpb24oY3RvcnNbY3Rvcl0pKVxuICAgICAgICAgICAgcmV0dXJuIGN0b3JzW2N0b3JdKHByb3BzKVxuXG4gICAgICAgIHJldHVybiBuZXcgY3RvcnNbY3Rvcl0ocHJvcHMpXG4gICAgfVxuXG4gICAgaWYgKGlzQXJyb3dGdW5jdGlvbihjdG9yKSlcbiAgICAgICAgcmV0dXJuIGN0b3IocHJvcHMpXG5cbiAgICByZXR1cm4gbmV3IGN0b3IocHJvcHMpXG59XG4iLCAiaW1wb3J0IHsgbm9JbXBsaWNpdERlc3Ryb3ksIHNldENoaWxkcmVuLCB0eXBlIEJpbmRhYmxlUHJvcHMsIGNvbnN0cnVjdCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEJpbmRpbmcgZnJvbSBcIi4uL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgY29uc3QgdHlwZSA9IFN5bWJvbChcImNoaWxkIHR5cGVcIilcbmNvbnN0IGR1bW15QnVsZGVyID0gbmV3IEd0ay5CdWlsZGVyXG5cbmZ1bmN0aW9uIF9nZXRDaGlsZHJlbih3aWRnZXQ6IEd0ay5XaWRnZXQpOiBBcnJheTxHdGsuV2lkZ2V0PiB7XG4gICAgaWYgKFwiZ2V0X2NoaWxkXCIgaW4gd2lkZ2V0ICYmIHR5cGVvZiB3aWRnZXQuZ2V0X2NoaWxkID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gd2lkZ2V0LmdldF9jaGlsZCgpID8gW3dpZGdldC5nZXRfY2hpbGQoKV0gOiBbXVxuICAgIH1cblxuICAgIGNvbnN0IGNoaWxkcmVuOiBBcnJheTxHdGsuV2lkZ2V0PiA9IFtdXG4gICAgbGV0IGNoID0gd2lkZ2V0LmdldF9maXJzdF9jaGlsZCgpXG4gICAgd2hpbGUgKGNoICE9PSBudWxsKSB7XG4gICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgIGNoID0gY2guZ2V0X25leHRfc2libGluZygpXG4gICAgfVxuICAgIHJldHVybiBjaGlsZHJlblxufVxuXG5mdW5jdGlvbiBfc2V0Q2hpbGRyZW4od2lkZ2V0OiBHdGsuV2lkZ2V0LCBjaGlsZHJlbjogYW55W10pIHtcbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcblxuXG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBjaGlsZHJlbikge1xuICAgICAgICB3aWRnZXQudmZ1bmNfYWRkX2NoaWxkKFxuICAgICAgICAgICAgZHVtbXlCdWxkZXIsXG4gICAgICAgICAgICBjaGlsZCxcbiAgICAgICAgICAgIHR5cGUgaW4gY2hpbGQgPyBjaGlsZFt0eXBlXSA6IG51bGwsXG4gICAgICAgIClcbiAgICB9XG59XG5cbnR5cGUgQ29uZmlnPFQgZXh0ZW5kcyBHdGsuV2lkZ2V0PiA9IHtcbiAgICBzZXRDaGlsZHJlbih3aWRnZXQ6IFQsIGNoaWxkcmVuOiBhbnlbXSk6IHZvaWRcbiAgICBnZXRDaGlsZHJlbih3aWRnZXQ6IFQpOiBBcnJheTxHdGsuV2lkZ2V0PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhc3RhbGlmeTxcbiAgICBXaWRnZXQgZXh0ZW5kcyBHdGsuV2lkZ2V0LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzID0gR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4oY2xzOiB7IG5ldyguLi5hcmdzOiBhbnlbXSk6IFdpZGdldCB9LCBjb25maWc6IFBhcnRpYWw8Q29uZmlnPFdpZGdldD4+ID0ge30pIHtcbiAgICBPYmplY3QuYXNzaWduKGNscy5wcm90b3R5cGUsIHtcbiAgICAgICAgW3NldENoaWxkcmVuXShjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIGNvbnN0IHcgPSB0aGlzIGFzIHVua25vd24gYXMgV2lkZ2V0XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIChjb25maWcuZ2V0Q2hpbGRyZW4/Lih3KSB8fCBfZ2V0Q2hpbGRyZW4odykpKSB7XG4gICAgICAgICAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgR3RrLldpZGdldCkge1xuICAgICAgICAgICAgICAgICAgICBjaGlsZC51bnBhcmVudCgpXG4gICAgICAgICAgICAgICAgICAgIGlmICghY2hpbGRyZW4uaW5jbHVkZXMoY2hpbGQpICYmIG5vSW1wbGljaXREZXN0cm95IGluIHRoaXMpXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZC5ydW5fZGlzcG9zZSgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY29uZmlnLnNldENoaWxkcmVuKSB7XG4gICAgICAgICAgICAgICAgY29uZmlnLnNldENoaWxkcmVuKHcsIGNoaWxkcmVuKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBfc2V0Q2hpbGRyZW4odywgY2hpbGRyZW4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICAgIFtjbHMubmFtZV06IChcbiAgICAgICAgICAgIHByb3BzOiBDb25zdHJ1Y3RQcm9wczxXaWRnZXQsIFByb3BzLCBTaWduYWxzPiA9IHt9LFxuICAgICAgICAgICAgLi4uY2hpbGRyZW46IGFueVtdXG4gICAgICAgICk6IFdpZGdldCA9PiB7XG4gICAgICAgICAgICBjb25zdCB3aWRnZXQgPSBuZXcgY2xzKFwiY3NzTmFtZVwiIGluIHByb3BzID8geyBjc3NOYW1lOiBwcm9wcy5jc3NOYW1lIH0gOiB7fSlcblxuICAgICAgICAgICAgaWYgKFwiY3NzTmFtZVwiIGluIHByb3BzKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLmNzc05hbWVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHByb3BzLm5vSW1wbGljaXREZXN0cm95KSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHsgW25vSW1wbGljaXREZXN0cm95XTogdHJ1ZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5ub0ltcGxpY2l0RGVzdHJveVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocHJvcHMudHlwZSkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCB7IFt0eXBlXTogcHJvcHMudHlwZSB9KVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy50eXBlXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihwcm9wcywgeyBjaGlsZHJlbiB9KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gY29uc3RydWN0KHdpZGdldCBhcyBhbnksIHNldHVwQ29udHJvbGxlcnMod2lkZ2V0LCBwcm9wcyBhcyBhbnkpKVxuICAgICAgICB9LFxuICAgIH1bY2xzLm5hbWVdXG59XG5cbnR5cGUgU2lnSGFuZGxlcjxcbiAgICBXIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBBcmdzIGV4dGVuZHMgQXJyYXk8dW5rbm93bj4sXG4+ID0gKChzZWxmOiBXLCAuLi5hcmdzOiBBcmdzKSA9PiB1bmtub3duKSB8IHN0cmluZyB8IHN0cmluZ1tdXG5cbmV4cG9ydCB7IEJpbmRhYmxlUHJvcHMgfVxuZXhwb3J0IHR5cGUgQmluZGFibGVDaGlsZCA9IEd0ay5XaWRnZXQgfCBCaW5kaW5nPEd0ay5XaWRnZXQ+XG5cbmV4cG9ydCB0eXBlIENvbnN0cnVjdFByb3BzPFxuICAgIFNlbGYgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4gPSBQYXJ0aWFsPHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNhbid0IGFzc2lnbiB0byB1bmtub3duLCBidXQgaXQgd29ya3MgYXMgZXhwZWN0ZWQgdGhvdWdoXG4gICAgW1MgaW4ga2V5b2YgU2lnbmFsc106IFNpZ0hhbmRsZXI8U2VsZiwgU2lnbmFsc1tTXT5cbn0+ICYgUGFydGlhbDx7XG4gICAgW0tleSBpbiBgb24ke3N0cmluZ31gXTogU2lnSGFuZGxlcjxTZWxmLCBhbnlbXT5cbn0+ICYgUGFydGlhbDxCaW5kYWJsZVByb3BzPE9taXQ8UHJvcHMsIFwiY3NzTmFtZVwiIHwgXCJjc3NfbmFtZVwiPj4+ICYge1xuICAgIG5vSW1wbGljaXREZXN0cm95PzogdHJ1ZVxuICAgIHR5cGU/OiBzdHJpbmdcbiAgICBjc3NOYW1lPzogc3RyaW5nXG59ICYgRXZlbnRDb250cm9sbGVyPFNlbGY+ICYge1xuICAgIG9uRGVzdHJveT86IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgc2V0dXA/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxufVxuXG50eXBlIEV2ZW50Q29udHJvbGxlcjxTZWxmIGV4dGVuZHMgR3RrLldpZGdldD4gPSB7XG4gICAgb25Gb2N1c0VudGVyPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbkZvY3VzTGVhdmU/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuXG4gICAgb25LZXlQcmVzc2VkPzogKHNlbGY6IFNlbGYsIGtleXZhbDogbnVtYmVyLCBrZXljb2RlOiBudW1iZXIsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG4gICAgb25LZXlSZWxlYXNlZD86IChzZWxmOiBTZWxmLCBrZXl2YWw6IG51bWJlciwga2V5Y29kZTogbnVtYmVyLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuICAgIG9uS2V5TW9kaWZpZXI/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcblxuICAgIG9uTGVnYWN5PzogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHZvaWRcbiAgICBvbkJ1dHRvblByZXNzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuICAgIG9uQnV0dG9uUmVsZWFzZWQ/OiAoc2VsZjogU2VsZiwgc3RhdGU6IEdkay5CdXR0b25FdmVudCkgPT4gdm9pZFxuXG4gICAgb25Ib3ZlckVudGVyPzogKHNlbGY6IFNlbGYsIHg6IG51bWJlciwgeTogbnVtYmVyKSA9PiB2b2lkXG4gICAgb25Ib3ZlckxlYXZlPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbiAgICBvbk1vdGlvbj86IChzZWxmOiBTZWxmLCB4OiBudW1iZXIsIHk6IG51bWJlcikgPT4gdm9pZFxuXG4gICAgb25TY3JvbGw/OiAoc2VsZjogU2VsZiwgZHg6IG51bWJlciwgZHk6IG51bWJlcikgPT4gdm9pZFxuICAgIG9uU2Nyb2xsRGVjZWxlcmF0ZT86IChzZWxmOiBTZWxmLCB2ZWxfeDogbnVtYmVyLCB2ZWxfeTogbnVtYmVyKSA9PiB2b2lkXG59XG5cbmZ1bmN0aW9uIHNldHVwQ29udHJvbGxlcnM8VD4od2lkZ2V0OiBHdGsuV2lkZ2V0LCB7XG4gICAgb25Gb2N1c0VudGVyLFxuICAgIG9uRm9jdXNMZWF2ZSxcbiAgICBvbktleVByZXNzZWQsXG4gICAgb25LZXlSZWxlYXNlZCxcbiAgICBvbktleU1vZGlmaWVyLFxuICAgIG9uTGVnYWN5LFxuICAgIG9uQnV0dG9uUHJlc3NlZCxcbiAgICBvbkJ1dHRvblJlbGVhc2VkLFxuICAgIG9uSG92ZXJFbnRlcixcbiAgICBvbkhvdmVyTGVhdmUsXG4gICAgb25Nb3Rpb24sXG4gICAgb25TY3JvbGwsXG4gICAgb25TY3JvbGxEZWNlbGVyYXRlLFxuICAgIC4uLnByb3BzXG59OiBFdmVudENvbnRyb2xsZXI8R3RrLldpZGdldD4gJiBUKSB7XG4gICAgaWYgKG9uRm9jdXNFbnRlciB8fCBvbkZvY3VzTGVhdmUpIHtcbiAgICAgICAgY29uc3QgZm9jdXMgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckZvY3VzXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihmb2N1cylcblxuICAgICAgICBpZiAob25Gb2N1c0VudGVyKVxuICAgICAgICAgICAgZm9jdXMuY29ubmVjdChcImVudGVyXCIsICgpID0+IG9uRm9jdXNFbnRlcih3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbkZvY3VzTGVhdmUpXG4gICAgICAgICAgICBmb2N1cy5jb25uZWN0KFwibGVhdmVcIiwgKCkgPT4gb25Gb2N1c0xlYXZlKHdpZGdldCkpXG4gICAgfVxuXG4gICAgaWYgKG9uS2V5UHJlc3NlZCB8fCBvbktleVJlbGVhc2VkIHx8IG9uS2V5TW9kaWZpZXIpIHtcbiAgICAgICAgY29uc3Qga2V5ID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJLZXlcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGtleSlcblxuICAgICAgICBpZiAob25LZXlQcmVzc2VkKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJrZXktcHJlc3NlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlQcmVzc2VkKHdpZGdldCwgdmFsLCBjb2RlLCBzdGF0ZSkpXG5cbiAgICAgICAgaWYgKG9uS2V5UmVsZWFzZWQpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcImtleS1yZWxlYXNlZFwiLCAoXywgdmFsLCBjb2RlLCBzdGF0ZSkgPT4gb25LZXlSZWxlYXNlZCh3aWRnZXQsIHZhbCwgY29kZSwgc3RhdGUpKVxuXG4gICAgICAgIGlmIChvbktleU1vZGlmaWVyKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJtb2RpZmllcnNcIiwgKF8sIHN0YXRlKSA9PiBvbktleU1vZGlmaWVyKHdpZGdldCwgc3RhdGUpKVxuICAgIH1cblxuICAgIGlmIChvbkxlZ2FjeSB8fCBvbkJ1dHRvblByZXNzZWQgfHwgb25CdXR0b25SZWxlYXNlZCkge1xuICAgICAgICBjb25zdCBsZWdhY3kgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlckxlZ2FjeVxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIobGVnYWN5KVxuXG4gICAgICAgIGxlZ2FjeS5jb25uZWN0KFwiZXZlbnRcIiwgKF8sIGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQuZ2V0X2V2ZW50X3R5cGUoKSA9PT0gR2RrLkV2ZW50VHlwZS5CVVRUT05fUFJFU1MpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblByZXNzZWQ/Lih3aWRnZXQsIGV2ZW50IGFzIEdkay5CdXR0b25FdmVudClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGV2ZW50LmdldF9ldmVudF90eXBlKCkgPT09IEdkay5FdmVudFR5cGUuQlVUVE9OX1JFTEVBU0UpIHtcbiAgICAgICAgICAgICAgICBvbkJ1dHRvblJlbGVhc2VkPy4od2lkZ2V0LCBldmVudCBhcyBHZGsuQnV0dG9uRXZlbnQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG9uTGVnYWN5Py4od2lkZ2V0LCBldmVudClcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAob25Nb3Rpb24gfHwgb25Ib3ZlckVudGVyIHx8IG9uSG92ZXJMZWF2ZSkge1xuICAgICAgICBjb25zdCBob3ZlciA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyTW90aW9uXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihob3ZlcilcblxuICAgICAgICBpZiAob25Ib3ZlckVudGVyKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImVudGVyXCIsIChfLCB4LCB5KSA9PiBvbkhvdmVyRW50ZXIod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25Ib3ZlckxlYXZlKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcImxlYXZlXCIsICgpID0+IG9uSG92ZXJMZWF2ZSh3aWRnZXQpKVxuXG4gICAgICAgIGlmIChvbk1vdGlvbilcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJtb3Rpb25cIiwgKF8sIHgsIHkpID0+IG9uTW90aW9uKHdpZGdldCwgeCwgeSkpXG4gICAgfVxuXG4gICAgaWYgKG9uU2Nyb2xsIHx8IG9uU2Nyb2xsRGVjZWxlcmF0ZSkge1xuICAgICAgICBjb25zdCBzY3JvbGwgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbFxuICAgICAgICBzY3JvbGwuZmxhZ3MgPSBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsRmxhZ3MuQk9USF9BWEVTIHwgR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbEZsYWdzLktJTkVUSUNcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKHNjcm9sbClcblxuICAgICAgICBpZiAob25TY3JvbGwpXG4gICAgICAgICAgICBzY3JvbGwuY29ubmVjdChcInNjcm9sbFwiLCAoXywgeCwgeSkgPT4gb25TY3JvbGwod2lkZ2V0LCB4LCB5KSlcblxuICAgICAgICBpZiAob25TY3JvbGxEZWNlbGVyYXRlKVxuICAgICAgICAgICAgc2Nyb2xsLmNvbm5lY3QoXCJkZWNlbGVyYXRlXCIsIChfLCB4LCB5KSA9PiBvblNjcm9sbERlY2VsZXJhdGUod2lkZ2V0LCB4LCB5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gcHJvcHNcbn1cbiIsICJpbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgeyBta0FwcCB9IGZyb20gXCIuLi9fYXBwXCJcblxuR3RrLmluaXQoKVxuXG4vLyBzdG9wIHRoaXMgZnJvbSBsZWFraW5nIGludG8gc3VicHJvY2Vzc2VzXG4vLyBhbmQgZ2lvIGxhdW5jaCBpbnZvY2F0aW9uc1xuR0xpYi51bnNldGVudihcIkxEX1BSRUxPQURcIilcblxuLy8gdXNlcnMgbWlnaHQgd2FudCB0byB1c2UgQWR3YWl0YSBpbiB3aGljaCBjYXNlIGl0IGhhcyB0byBiZSBpbml0aWFsaXplZFxuLy8gaXQgbWlnaHQgYmUgY29tbW9uIHBpdGZhbGwgdG8gZm9yZ2V0IGl0IGJlY2F1c2UgYEFwcGAgaXMgbm90IGBBZHcuQXBwbGljYXRpb25gXG5hd2FpdCBpbXBvcnQoXCJnaTovL0Fkdz92ZXJzaW9uPTFcIilcbiAgICAudGhlbigoeyBkZWZhdWx0OiBBZHcgfSkgPT4gQWR3LmluaXQoKSlcbiAgICAuY2F0Y2goKCkgPT4gdm9pZCAwKVxuXG5leHBvcnQgZGVmYXVsdCBta0FwcChBc3RhbC5BcHBsaWNhdGlvbilcbiIsICIvKipcbiAqIFdvcmthcm91bmQgZm9yIFwiQ2FuJ3QgY29udmVydCBub24tbnVsbCBwb2ludGVyIHRvIEpTIHZhbHVlIFwiXG4gKi9cblxuZXhwb3J0IHsgfVxuXG5jb25zdCBzbmFrZWlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDFfJDJcIilcbiAgICAucmVwbGFjZUFsbChcIi1cIiwgXCJfXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuYXN5bmMgZnVuY3Rpb24gc3VwcHJlc3M8VD4obW9kOiBQcm9taXNlPHsgZGVmYXVsdDogVCB9PiwgcGF0Y2g6IChtOiBUKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIG1vZC50aGVuKG0gPT4gcGF0Y2gobS5kZWZhdWx0KSkuY2F0Y2goKCkgPT4gdm9pZCAwKVxufVxuXG5mdW5jdGlvbiBwYXRjaDxQIGV4dGVuZHMgb2JqZWN0Pihwcm90bzogUCwgcHJvcDogRXh0cmFjdDxrZXlvZiBQLCBzdHJpbmc+KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCBwcm9wLCB7XG4gICAgICAgIGdldCgpIHsgcmV0dXJuIHRoaXNbYGdldF8ke3NuYWtlaWZ5KHByb3ApfWBdKCkgfSxcbiAgICB9KVxufVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQXBwc1wiKSwgKHsgQXBwcywgQXBwbGljYXRpb24gfSkgPT4ge1xuICAgIHBhdGNoKEFwcHMucHJvdG90eXBlLCBcImxpc3RcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwia2V5d29yZHNcIilcbiAgICBwYXRjaChBcHBsaWNhdGlvbi5wcm90b3R5cGUsIFwiY2F0ZWdvcmllc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIiksICh7IFVQb3dlciB9KSA9PiB7XG4gICAgcGF0Y2goVVBvd2VyLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQmx1ZXRvb3RoXCIpLCAoeyBBZGFwdGVyLCBCbHVldG9vdGgsIERldmljZSB9KSA9PiB7XG4gICAgcGF0Y2goQWRhcHRlci5wcm90b3R5cGUsIFwidXVpZHNcIilcbiAgICBwYXRjaChCbHVldG9vdGgucHJvdG90eXBlLCBcImFkYXB0ZXJzXCIpXG4gICAgcGF0Y2goQmx1ZXRvb3RoLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goRGV2aWNlLnByb3RvdHlwZSwgXCJ1dWlkc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEh5cHJsYW5kXCIpLCAoeyBIeXBybGFuZCwgTW9uaXRvciwgV29ya3NwYWNlIH0pID0+IHtcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwiYmluZHNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwibW9uaXRvcnNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwid29ya3NwYWNlc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJjbGllbnRzXCIpXG4gICAgcGF0Y2goTW9uaXRvci5wcm90b3R5cGUsIFwiYXZhaWxhYmxlTW9kZXNcIilcbiAgICBwYXRjaChNb25pdG9yLnByb3RvdHlwZSwgXCJhdmFpbGFibGVfbW9kZXNcIilcbiAgICBwYXRjaChXb3Jrc3BhY2UucHJvdG90eXBlLCBcImNsaWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxNcHJpc1wiKSwgKHsgTXByaXMsIFBsYXllciB9KSA9PiB7XG4gICAgcGF0Y2goTXByaXMucHJvdG90eXBlLCBcInBsYXllcnNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZF91cmlfc2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkVXJpU2NoZW1lc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkX21pbWVfdHlwZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZE1pbWVUeXBlc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwiY29tbWVudHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxOZXR3b3JrXCIpLCAoeyBXaWZpIH0pID0+IHtcbiAgICBwYXRjaChXaWZpLnByb3RvdHlwZSwgXCJhY2Nlc3NfcG9pbnRzXCIpXG4gICAgcGF0Y2goV2lmaS5wcm90b3R5cGUsIFwiYWNjZXNzUG9pbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTm90aWZkXCIpLCAoeyBOb3RpZmQsIE5vdGlmaWNhdGlvbiB9KSA9PiB7XG4gICAgcGF0Y2goTm90aWZkLnByb3RvdHlwZSwgXCJub3RpZmljYXRpb25zXCIpXG4gICAgcGF0Y2goTm90aWZpY2F0aW9uLnByb3RvdHlwZSwgXCJhY3Rpb25zXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsUG93ZXJQcm9maWxlc1wiKSwgKHsgUG93ZXJQcm9maWxlcyB9KSA9PiB7XG4gICAgcGF0Y2goUG93ZXJQcm9maWxlcy5wcm90b3R5cGUsIFwiYWN0aW9uc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbFdwXCIpLCAoeyBXcCwgQXVkaW8sIFZpZGVvIH0pID0+IHtcbiAgICBwYXRjaChXcC5wcm90b3R5cGUsIFwiZW5kcG9pbnRzXCIpXG4gICAgcGF0Y2goV3AucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3RyZWFtc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJyZWNvcmRlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwibWljcm9waG9uZXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwic3BlYWtlcnNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzdHJlYW1zXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInJlY29yZGVyc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzaW5rc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJzb3VyY2VzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcImRldmljZXNcIilcbn0pXG4iLCAiaW1wb3J0IFwiLi9vdmVycmlkZXMuanNcIlxuaW1wb3J0IHsgc2V0Q29uc29sZUxvZ0RvbWFpbiB9IGZyb20gXCJjb25zb2xlXCJcbmltcG9ydCB7IGV4aXQsIHByb2dyYW1BcmdzIH0gZnJvbSBcInN5c3RlbVwiXG5pbXBvcnQgSU8gZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcbmltcG9ydCB0eXBlIEFzdGFsMyBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgdHlwZSBBc3RhbDQgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuXG50eXBlIENvbmZpZyA9IFBhcnRpYWw8e1xuICAgIGluc3RhbmNlTmFtZTogc3RyaW5nXG4gICAgY3NzOiBzdHJpbmdcbiAgICBpY29uczogc3RyaW5nXG4gICAgZ3RrVGhlbWU6IHN0cmluZ1xuICAgIGljb25UaGVtZTogc3RyaW5nXG4gICAgY3Vyc29yVGhlbWU6IHN0cmluZ1xuICAgIGhvbGQ6IGJvb2xlYW5cbiAgICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0OiBzdHJpbmcsIHJlczogKHJlc3BvbnNlOiBhbnkpID0+IHZvaWQpOiB2b2lkXG4gICAgbWFpbiguLi5hcmdzOiBzdHJpbmdbXSk6IHZvaWRcbiAgICBjbGllbnQobWVzc2FnZTogKG1zZzogc3RyaW5nKSA9PiBzdHJpbmcsIC4uLmFyZ3M6IHN0cmluZ1tdKTogdm9pZFxufT5cblxuaW50ZXJmYWNlIEFzdGFsM0pTIGV4dGVuZHMgQXN0YWwzLkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyOiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldD86IGJvb2xlYW4pOiB2b2lkXG4gICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZFxuICAgIHN0YXJ0KGNvbmZpZz86IENvbmZpZyk6IHZvaWRcbn1cblxuaW50ZXJmYWNlIEFzdGFsNEpTIGV4dGVuZHMgQXN0YWw0LkFwcGxpY2F0aW9uIHtcbiAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PlxuICAgIHJlcXVlc3RIYW5kbGVyPzogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cbiAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQ/OiBib29sZWFuKTogdm9pZFxuICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWRcbiAgICBzdGFydChjb25maWc/OiBDb25maWcpOiB2b2lkXG59XG5cbnR5cGUgQXBwMyA9IHR5cGVvZiBBc3RhbDMuQXBwbGljYXRpb25cbnR5cGUgQXBwNCA9IHR5cGVvZiBBc3RhbDQuQXBwbGljYXRpb25cblxuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwPEFwcCBleHRlbmRzIEFwcDM+KEFwcDogQXBwKTogQXN0YWwzSlNcbmV4cG9ydCBmdW5jdGlvbiBta0FwcDxBcHAgZXh0ZW5kcyBBcHA0PihBcHA6IEFwcCk6IEFzdGFsNEpTXG5cbmV4cG9ydCBmdW5jdGlvbiBta0FwcChBcHA6IEFwcDMgfCBBcHA0KSB7XG4gICAgcmV0dXJuIG5ldyAoY2xhc3MgQXN0YWxKUyBleHRlbmRzIEFwcCB7XG4gICAgICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJBc3RhbEpTXCIgfSwgdGhpcyBhcyBhbnkpIH1cblxuICAgICAgICBldmFsKGJvZHk6IHN0cmluZyk6IFByb21pc2U8YW55PiB7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZm4gPSBGdW5jdGlvbihgcmV0dXJuIChhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICR7Ym9keS5pbmNsdWRlcyhcIjtcIikgPyBib2R5IDogYHJldHVybiAke2JvZHl9O2B9XG4gICAgICAgICAgICAgICAgICAgIH0pYClcbiAgICAgICAgICAgICAgICAgICAgZm4oKSgpLnRoZW4ocmVzKS5jYXRjaChyZWopXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqKGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXF1ZXN0SGFuZGxlcj86IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG5cbiAgICAgICAgdmZ1bmNfcmVxdWVzdChtc2c6IHN0cmluZywgY29ubjogR2lvLlNvY2tldENvbm5lY3Rpb24pOiB2b2lkIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdGhpcy5yZXF1ZXN0SGFuZGxlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5yZXF1ZXN0SGFuZGxlcihtc2csIChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrKGNvbm4sIFN0cmluZyhyZXNwb25zZSksIChfLCByZXMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBJTy53cml0ZV9zb2NrX2ZpbmlzaChyZXMpLFxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3VwZXIudmZ1bmNfcmVxdWVzdChtc2csIGNvbm4pXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQgPSBmYWxzZSkge1xuICAgICAgICAgICAgc3VwZXIuYXBwbHlfY3NzKHN0eWxlLCByZXNldClcbiAgICAgICAgfVxuXG4gICAgICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWQge1xuICAgICAgICAgICAgc3VwZXIucXVpdCgpXG4gICAgICAgICAgICBleGl0KGNvZGUgPz8gMClcbiAgICAgICAgfVxuXG4gICAgICAgIHN0YXJ0KHsgcmVxdWVzdEhhbmRsZXIsIGNzcywgaG9sZCwgbWFpbiwgY2xpZW50LCBpY29ucywgLi4uY2ZnIH06IENvbmZpZyA9IHt9KSB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSB0aGlzIGFzIHVua25vd24gYXMgSW5zdGFuY2VUeXBlPEFwcDMgfCBBcHA0PlxuXG4gICAgICAgICAgICBjbGllbnQgPz89ICgpID0+IHtcbiAgICAgICAgICAgICAgICBwcmludChgQXN0YWwgaW5zdGFuY2UgXCIke2FwcC5pbnN0YW5jZU5hbWV9XCIgYWxyZWFkeSBydW5uaW5nYClcbiAgICAgICAgICAgICAgICBleGl0KDEpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIE9iamVjdC5hc3NpZ24odGhpcywgY2ZnKVxuICAgICAgICAgICAgc2V0Q29uc29sZUxvZ0RvbWFpbihhcHAuaW5zdGFuY2VOYW1lKVxuXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RIYW5kbGVyID0gcmVxdWVzdEhhbmRsZXJcbiAgICAgICAgICAgIGFwcC5jb25uZWN0KFwiYWN0aXZhdGVcIiwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIG1haW4/LiguLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXBwLmFjcXVpcmVfc29ja2V0KClcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNsaWVudChtc2cgPT4gSU8uc2VuZF9yZXF1ZXN0KGFwcC5pbnN0YW5jZU5hbWUsIG1zZykhLCAuLi5wcm9ncmFtQXJncylcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNzcylcbiAgICAgICAgICAgICAgICB0aGlzLmFwcGx5X2Nzcyhjc3MsIGZhbHNlKVxuXG4gICAgICAgICAgICBpZiAoaWNvbnMpXG4gICAgICAgICAgICAgICAgYXBwLmFkZF9pY29ucyhpY29ucylcblxuICAgICAgICAgICAgaG9sZCA/Pz0gdHJ1ZVxuICAgICAgICAgICAgaWYgKGhvbGQpXG4gICAgICAgICAgICAgICAgYXBwLmhvbGQoKVxuXG4gICAgICAgICAgICBhcHAucnVuQXN5bmMoW10pXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSwgdHlwZSBDb25zdHJ1Y3RQcm9wcyB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZnVuY3Rpb24gZmlsdGVyKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIHJldHVybiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG59XG5cbi8vIEJveFxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLkJveC5wcm90b3R5cGUsIFwiY2hpbGRyZW5cIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9jaGlsZHJlbih2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5Cb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IEJveCA9IGFzdGFsaWZ5PEFzdGFsLkJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLkJveCwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIHNlbGYuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikgeyByZXR1cm4gc2VsZi5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfSxcbn0pXG5cbi8vIEJ1dHRvblxudHlwZSBCdXR0b25TaWduYWxzID0ge1xuICAgIG9uQ2xpY2tlZDogW11cbn1cblxuZXhwb3J0IHR5cGUgQnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuQnV0dG9uLCBHdGsuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIEJ1dHRvblNpZ25hbHM+XG5leHBvcnQgY29uc3QgQnV0dG9uID0gYXN0YWxpZnk8R3RrLkJ1dHRvbiwgR3RrLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCBCdXR0b25TaWduYWxzPihHdGsuQnV0dG9uKVxuXG4vLyBDZW50ZXJCb3hcbmV4cG9ydCB0eXBlIENlbnRlckJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkNlbnRlckJveCwgR3RrLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IENlbnRlckJveCA9IGFzdGFsaWZ5PEd0ay5DZW50ZXJCb3gsIEd0ay5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz4oR3RrLkNlbnRlckJveCwge1xuICAgIGdldENoaWxkcmVuKGJveCkge1xuICAgICAgICByZXR1cm4gW2JveC5zdGFydFdpZGdldCwgYm94LmNlbnRlcldpZGdldCwgYm94LmVuZFdpZGdldF1cbiAgICB9LFxuICAgIHNldENoaWxkcmVuKGJveCwgY2hpbGRyZW4pIHtcbiAgICAgICAgY29uc3QgY2ggPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIGJveC5zdGFydFdpZGdldCA9IGNoWzBdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIGJveC5jZW50ZXJXaWRnZXQgPSBjaFsxXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICBib3guZW5kV2lkZ2V0ID0gY2hbMl0gfHwgbmV3IEd0ay5Cb3hcbiAgICB9LFxufSlcblxuLy8gVE9ETzogQ2lyY3VsYXJQcm9ncmVzc1xuLy8gVE9ETzogRHJhd2luZ0FyZWFcblxuLy8gRW50cnlcbnR5cGUgRW50cnlTaWduYWxzID0ge1xuICAgIG9uQWN0aXZhdGU6IFtdXG4gICAgb25Ob3RpZnlUZXh0OiBbXVxufVxuXG5leHBvcnQgdHlwZSBFbnRyeVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPlxuZXhwb3J0IGNvbnN0IEVudHJ5ID0gYXN0YWxpZnk8R3RrLkVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywgRW50cnlTaWduYWxzPihHdGsuRW50cnksIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBJbWFnZVxuZXhwb3J0IHR5cGUgSW1hZ2VQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5JbWFnZSwgR3RrLkltYWdlLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgSW1hZ2UgPSBhc3RhbGlmeTxHdGsuSW1hZ2UsIEd0ay5JbWFnZS5Db25zdHJ1Y3RvclByb3BzPihHdGsuSW1hZ2UsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBMYWJlbFxuZXhwb3J0IHR5cGUgTGFiZWxQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5MYWJlbCwgR3RrLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTGFiZWwgPSBhc3RhbGlmeTxHdGsuTGFiZWwsIEd0ay5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPihHdGsuTGFiZWwsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHsgc2VsZi5sYWJlbCA9IFN0cmluZyhjaGlsZHJlbikgfSxcbn0pXG5cbi8vIExldmVsQmFyXG5leHBvcnQgdHlwZSBMZXZlbEJhclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkxldmVsQmFyLCBHdGsuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBMZXZlbEJhciA9IGFzdGFsaWZ5PEd0ay5MZXZlbEJhciwgR3RrLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5MZXZlbEJhciwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFRPRE86IExpc3RCb3hcblxuLy8gT3ZlcmxheVxuZXhwb3J0IHR5cGUgT3ZlcmxheVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk92ZXJsYXksIEd0ay5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgT3ZlcmxheSA9IGFzdGFsaWZ5PEd0ay5PdmVybGF5LCBHdGsuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPihHdGsuT3ZlcmxheSwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHtcbiAgICAgICAgY29uc3QgY2hpbGRyZW46IEFycmF5PEd0ay5XaWRnZXQ+ID0gW11cbiAgICAgICAgbGV0IGNoID0gc2VsZi5nZXRfZmlyc3RfY2hpbGQoKVxuICAgICAgICB3aGlsZSAoY2ggIT09IG51bGwpIHtcbiAgICAgICAgICAgIGNoaWxkcmVuLnB1c2goY2gpXG4gICAgICAgICAgICBjaCA9IGNoLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNoaWxkcmVuLmZpbHRlcihjaCA9PiBjaCAhPT0gc2VsZi5jaGlsZClcbiAgICB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgY29uc3QgdHlwZXMgPSB0eXBlIGluIGNoaWxkXG4gICAgICAgICAgICAgICAgPyAoY2hpbGRbdHlwZV0gYXMgc3RyaW5nKS5zcGxpdCgvXFxzKy8pXG4gICAgICAgICAgICAgICAgOiBbXVxuXG4gICAgICAgICAgICBpZiAodHlwZXMuaW5jbHVkZXMoXCJvdmVybGF5XCIpKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfb3ZlcmxheShjaGlsZClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNlbGYuc2V0X21lYXN1cmVfb3ZlcmxheShjaGlsZCwgdHlwZXMuaW5jbHVkZXMoXCJtZWFzdXJlXCIpKVxuICAgICAgICAgICAgc2VsZi5zZXRfY2xpcF9vdmVybGF5KGNoaWxkLCB0eXBlcy5pbmNsdWRlcyhcImNsaXBcIikpXG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gUmV2ZWFsZXJcbmV4cG9ydCB0eXBlIFJldmVhbGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuUmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFJldmVhbGVyID0gYXN0YWxpZnk8R3RrLlJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlJldmVhbGVyKVxuXG4vLyBTbGlkZXJcbnR5cGUgU2xpZGVyU2lnbmFscyA9IHtcbiAgICBvbkNoYW5nZVZhbHVlOiBbXVxufVxuXG5leHBvcnQgdHlwZSBTbGlkZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLlNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIFNsaWRlclNpZ25hbHM+XG5leHBvcnQgY29uc3QgU2xpZGVyID0gYXN0YWxpZnk8QXN0YWwuU2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywgU2xpZGVyU2lnbmFscz4oQXN0YWwuU2xpZGVyLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gU3RhY2tcbmV4cG9ydCB0eXBlIFN0YWNrUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuU3RhY2ssIEd0ay5TdGFjay5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN0YWNrID0gYXN0YWxpZnk8R3RrLlN0YWNrLCBHdGsuU3RhY2suQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN0YWNrLCB7XG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQubmFtZSAhPSBcIlwiICYmIGNoaWxkLm5hbWUgIT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX25hbWVkKGNoaWxkLCBjaGlsZC5uYW1lKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBTd2l0Y2hcbmV4cG9ydCB0eXBlIFN3aXRjaFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFN3aXRjaCA9IGFzdGFsaWZ5PEd0ay5Td2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz4oR3RrLlN3aXRjaCwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFdpbmRvd1xuZXhwb3J0IHR5cGUgV2luZG93UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5XaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFdpbmRvdyA9IGFzdGFsaWZ5PEFzdGFsLldpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+KEFzdGFsLldpbmRvdylcblxuLy8gTWVudUJ1dHRvblxuZXhwb3J0IHR5cGUgTWVudUJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLk1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTWVudUJ1dHRvbiA9IGFzdGFsaWZ5PEd0ay5NZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPihHdGsuTWVudUJ1dHRvbiwge1xuICAgIGdldENoaWxkcmVuKHNlbGYpIHsgcmV0dXJuIFtzZWxmLnBvcG92ZXIsIHNlbGYuY2hpbGRdIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBHdGsuUG9wb3Zlcikge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X3BvcG92ZXIoY2hpbGQpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFBvcG9wZXJcbmV4cG9ydCB0eXBlIFBvcG92ZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5Qb3BvdmVyLCBHdGsuUG9wb3Zlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IFBvcG92ZXIgPSBhc3RhbGlmeTxHdGsuUG9wb3ZlciwgR3RrLlBvcG92ZXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLlBvcG92ZXIpXG4iLCAiLy8ga29iZWwtc2hlbGwgZW50cnkgXHUyMDE0IEFHUyB2MiAvIGFzdGFsNFxuaW1wb3J0IHsgQXBwIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj00LjBcIlxuLy8gYXN0YWwgYGNvbnN0cnVjdGAgc2V0cyBzdGF0aWMgcHJvcHMgdmlhIE9iamVjdC5hc3NpZ24od2lkZ2V0LCBwcm9wcykgYW5kIGJpbmRpbmdzIHZpYVxuLy8gc2V0UHJvcCBcdTIxOTIgc2V0X2NsYXNzLiBHdGtXaWRnZXQgaGFzIG5laXRoZXIgYSBgY2xhc3NgIEdPYmplY3QgcHJvcCBub3Igc2V0X2NsYXNzLCBzb1xuLy8gYGNsYXNzPVwiLi4uXCJgIHNpbGVudGx5IG5vLW9wcyAodGhlIHJlYWwgcHJvcCBpcyBgY3NzLWNsYXNzZXNgLCBhbiBhcnJheSkuIERlZmluZSBhXG4vLyBgY2xhc3NgIGFjY2Vzc29yIHJvdXRpbmcgQk9USCBwYXRocyB0byBzZXRfY3NzX2NsYXNzZXMsIHNvIGBjbGFzcz1cImEgYlwiYCB3b3Jrcy5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0eSgoR3RrLldpZGdldCBhcyBhbnkpLnByb3RvdHlwZSwgXCJjbGFzc1wiLCB7XG4gICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgIHNldCh2OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKVxuICAgIH0sXG4gICAgZ2V0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRfY3NzX2NsYXNzZXMoKS5qb2luKFwiIFwiKVxuICAgIH0sXG59KVxuOyhHdGsuV2lkZ2V0LnByb3RvdHlwZSBhcyBhbnkpLnNldF9jbGFzcyA9IGZ1bmN0aW9uICh2OiBzdHJpbmcpIHtcbiAgICB0aGlzLnNldF9jc3NfY2xhc3NlcyhTdHJpbmcodikuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbikpXG59XG5pbXBvcnQgc3R5bGUgZnJvbSBcIi4vc3R5bGUvbWFpbi5zY3NzXCJcbmltcG9ydCB7IHRva2VuQ3NzLCB0b2tlbnMgfSBmcm9tIFwiLi9jb25maWdcIlxuaW1wb3J0ICogYXMgZ25vYmxpbiBmcm9tIFwiLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCAqIGFzIG5vdGlmZFN2YyBmcm9tIFwiLi9zZXJ2aWNlcy9ub3RpZmRcIlxuaW1wb3J0IHsgYXJtRHVtcCB9IGZyb20gXCIuL2xpYi9pbnNwZWN0XCJcbmltcG9ydCB7IHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IEJhciBmcm9tIFwiLi93aWRnZXQvQmFyXCJcbmltcG9ydCBEb2NrIGZyb20gXCIuL3dpZGdldC9Eb2NrXCJcbmltcG9ydCBMYXVuY2hlciBmcm9tIFwiLi93aWRnZXQvTGF1bmNoZXJcIlxuaW1wb3J0IFF1aWNrU2V0dGluZ3MgZnJvbSBcIi4vd2lkZ2V0L1F1aWNrU2V0dGluZ3NcIlxuaW1wb3J0IENhbGVuZGFyIGZyb20gXCIuL3dpZGdldC9DYWxlbmRhclwiXG5pbXBvcnQgeyBUb2FzdHMsIERyYXdlciB9IGZyb20gXCIuL3dpZGdldC9Ob3RpZmljYXRpb25zXCJcbmltcG9ydCBPU0QgZnJvbSBcIi4vd2lkZ2V0L09TRFwiXG5pbXBvcnQgU2Vzc2lvbiBmcm9tIFwiLi93aWRnZXQvU2Vzc2lvblwiXG5cbnByaW50ZXJyKFwiS09CRUw6IG1vZHVsZSB0b3AgcmVhY2hlZFwiKVxuXG4vLyBDdXN0b20gaWNvbiBzZXQgXHUyMDE0IHRoZSBleGFjdCBIZXJvaWNvbnMvTHVjaWRlL1RhYmxlciB0aGUgcHJvdG90eXBlIHVzZXMsIGFzXG4vLyByZWNvbG9yYWJsZSBzeW1ib2xpYyBTVkdzLiBSZWdpc3RlcmVkIG9uIHRoZSBkZWZhdWx0IGljb24gdGhlbWUgc28gaWNvbk5hbWVcbi8vIFwia29iZWwtd2lmaS1zeW1ib2xpY1wiIGV0Yy4gcmVzb2x2ZS4gUGF0aCBvdmVycmlkZSB2aWEgS09CRUxfSUNPTlMgZm9yIHRoZSBkZXZraXQuXG5pbXBvcnQgR0xpYkljb25zIGZyb20gXCJnaTovL0dMaWJcIlxuY29uc3QgSUNPTl9ESVIgPVxuICAgIEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKSA/P1xuICAgIEdMaWJJY29ucy5idWlsZF9maWxlbmFtZXYoW0dMaWJJY29ucy5nZXRfY3VycmVudF9kaXIoKSwgXCJpY29uc1wiXSlcblxuQXBwLnN0YXJ0KHtcbiAgICBpbnN0YW5jZU5hbWU6IFwia29iZWxcIixcbiAgICBpY29uczogSUNPTl9ESVIsXG4gICAgbWFpbigpIHtcbiAgICAgICAgZ25vYmxpbi5pbml0KClcbiAgICAgICAgbm90aWZkU3ZjLmluaXQoKVxuICAgICAgICAvLyBMb2FkIG91ciBzdHlsZXNoZWV0IGF0IFVTRVIgcHJpb3JpdHkgKGhpZ2hlc3QpIHNvIGl0IGJlYXRzIEFkd2FpdGEncyB0aGVtZVxuICAgICAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgICAgICAvLyBgc2NhbGUgPiB0cm91Z2hgIChmYXQgc2xpZGVycykuIFRoaXMgcHJvdmlkZXIgaXMgYXV0aG9yaXRhdGl2ZS5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IHByb3YgPSBuZXcgR3RrLkNzc1Byb3ZpZGVyKClcbiAgICAgICAgICAgIHByb3YubG9hZF9mcm9tX3N0cmluZyhzdHlsZSArIHRva2VuQ3NzKHRva2VucykpXG4gICAgICAgICAgICBHdGsuU3R5bGVDb250ZXh0LmFkZF9wcm92aWRlcl9mb3JfZGlzcGxheShcbiAgICAgICAgICAgICAgICBHZGsuRGlzcGxheS5nZXRfZGVmYXVsdCgpISxcbiAgICAgICAgICAgICAgICBwcm92LFxuICAgICAgICAgICAgICAgIDgwMCAvKiBVU0VSIHByaW9yaXR5ICovXG4gICAgICAgICAgICApXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApXG4gICAgICAgIH1cbiAgICAgICAgLy8gYXN0YWw0IEpTWCA8d2luZG93PiBpcyBjcmVhdGVkIGhpZGRlbiAodmlzaWJsZT1mYWxzZSkuIFBlcnNpc3RlbnQgY2hyb21lIG11c3RcbiAgICAgICAgLy8gYmUgcHJlc2VudCgpZWQ7IG9uLWRlbWFuZCBzdXJmYWNlcyBzdGF5IGhpZGRlbiBhbmQgYXJlIHNob3duIGJ5IHRvZ2dsZV93aW5kb3cuXG4gICAgICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHcgPSBmbigpXG4gICAgICAgICAgICAgICAgaWYgKHcgJiYgdHlwZW9mIHcucHJlc2VudCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgICAgIEFwcC5hZGRfd2luZG93Py4odylcbiAgICAgICAgICAgICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogJHtuYW1lfSBGQUlMRUQ6ICR7ZX1cXG4keyhlIGFzIGFueSk/LnN0YWNrID8/IFwiXCJ9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBtb25pdG9ycyA9IEFwcC5nZXRfbW9uaXRvcnMoKVxuICAgICAgICBjb25zdCB0YXJnZXRzID0gbW9uaXRvcnMubGVuZ3RoID8gbW9uaXRvcnMgOiBbdW5kZWZpbmVkIGFzIGFueV1cbiAgICAgICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgICAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgICAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgICAgIH1cbiAgICAgICAgbWFrZShcImxhdW5jaGVyXCIsICgpID0+IExhdW5jaGVyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwiY2FsZW5kYXJcIiwgKCkgPT4gQ2FsZW5kYXIoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJkcmF3ZXJcIiwgKCkgPT4gRHJhd2VyKCksIGZhbHNlKVxuICAgICAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgICAgICAvLyBLT0JFTF9EVU1QPTx3aW5kb3c+OiBkdW1wIHRoZSBsaXZlIEdUSyBnZW9tZXRyeSB0cmVlIGZvciBET00tdnMtR1RLIGRpZmZpbmcuXG4gICAgICAgIGFybUR1bXAoKG5hbWUpID0+IEFwcC5nZXRfd2luZG93KG5hbWUpIGFzIGFueSlcbiAgICB9LFxuICAgIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICAgIHJlcXVlc3RIYW5kbGVyKHJlcXVlc3QsIHJlcykge1xuICAgICAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICAgICAgaWYgKGNtZCA9PT0gXCJ0b2dnbGVcIikge1xuICAgICAgICAgICAgc3VyZmFjZVRvZ2dsZShhcmcpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICBpZiAoY21kID09PSBcInJlbG9hZC1jc3NcIikge1xuICAgICAgICAgICAgQXBwLmFwcGx5X2NzcyhzdHlsZSArIHRva2VuQ3NzKHRva2VucyksIHRydWUpXG4gICAgICAgICAgICByZXR1cm4gcmVzKFwib2tcIilcbiAgICAgICAgfVxuICAgICAgICByZXMoXCJ1bmtub3duXCIpXG4gICAgfSxcbn0pXG4iLCAiQGNoYXJzZXQgXCJVVEYtOFwiO1xud2luZG93IHtcbiAgZm9udC1mYW1pbHk6IFwiSW50ZXJcIiwgXCJJbnRlciBWYXJpYWJsZVwiLCBcIkludGVyVmFyaWFibGVcIiwgc2Fucy1zZXJpZjtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLnRuIHtcbiAgZm9udC1mZWF0dXJlLXNldHRpbmdzOiBcInRudW1cIjtcbn1cblxud2luZG93IHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbmJ1dHRvbiB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zLCBjb2xvciAxNjBtcztcbn1cblxuaW1hZ2Uge1xuICAtZ3RrLWljb24tc3R5bGU6IHJlZ3VsYXI7XG59XG5cbi5iYXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiAwIDdweDtcbiAgbWluLWhlaWdodDogNDJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50aXRsZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luOiAwIDlweDtcbn1cbi5iYXIgLmNsb2NrIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmJhciAuZGF0ZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLmlidG4ge1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAuaWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuaWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmJhciAuYmNlbnRlciB7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uYmFyIC5iY2VudGVyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1cyB7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDAgMTNweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uYmFyIC5zdGF0dXM6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLmJhciAuc3RhdHVzIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuc3RhdHVzIC5wY3QgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTNweDtcbn1cbi5iYXIgLnN0YXR1cyBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLnN0YXR1cy5lcnIgLm5ldC1pY29uIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG4uYmFyIC5iYWRnZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogMCAzcHg7XG4gIG1hcmdpbjogMnB4O1xuICBtaW4taGVpZ2h0OiAxNHB4O1xuICBtaW4td2lkdGg6IDhweDtcbn1cbi5iYXIgLnRyYXktaWNvbiB7XG4gIG1pbi13aWR0aDogMjhweDtcbn1cbi5iYXIgLnRyYXktaWNvbiBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5iYXIgLnRyYXktbGFuZyB7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIG1hcmdpbjogMCA4cHg7XG59XG5cbi5kb2NrIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgcGFkZGluZzogNXB4O1xuICBib3JkZXItcmFkaXVzOiAxNnB4O1xufVxuLmRvY2sgLmRidG4ge1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xufVxuLmRvY2sgLmljb24tdGlsZSB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgcGFkZGluZzogNnB4O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zO1xufVxuLmRvY2sgLmRidG46aG92ZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC4wOSk7XG59XG4uZG9jayAucGxhY2Vob2xkZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLmRvY2sgLmRvdHMge1xuICBtYXJnaW4tYm90dG9tOiAzcHg7XG59XG4uZG9jayAuZG90IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWluLXdpZHRoOiA0cHg7XG4gIG1pbi1oZWlnaHQ6IDRweDtcbiAgdHJhbnNpdGlvbjogbWluLXdpZHRoIDI2MG1zIGN1YmljLWJlemllcigwLjI0LCAxLjM2LCAwLjM1LCAxKSwgYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5kb2NrIC5kb3Qub24ge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBtaW4td2lkdGg6IDEycHg7XG59XG4uZG9jayAuZG90Lm1pbmkge1xuICBtaW4td2lkdGg6IDNweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBvcGFjaXR5OiAwLjc7XG59XG4uZG9jayAuc2VwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgbWluLXdpZHRoOiAxcHg7XG4gIG1pbi1oZWlnaHQ6IDMzcHg7XG4gIG1hcmdpbjogMCAzcHg7XG59XG4uZG9jayAuZHRpbGUge1xuICBtaW4td2lkdGg6IDQycHg7XG4gIG1pbi1oZWlnaHQ6IDQycHg7XG59XG4uZG9jayAuZHdpZGdldCAuZGcge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBwYWRkaW5nOiA2cHg7XG59XG4uZG9jayAubXByb2cge1xuICBtaW4td2lkdGg6IDI1cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmRvY2sgLm1wcm9nIHRyb3VnaCB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbn1cbi5kb2NrIC5tcHJvZyBibG9jay5maWxsZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xufVxuLmRvY2sgLm1wcm9nIGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG5cbi5zaGVldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDEycHg7XG4gIG1hcmdpbjogMzhweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xufVxuXG4ucXMge1xuICBtaW4td2lkdGg6IDMyOHB4O1xufSAvKiBtYXRjaGVzIHBhbmVsVygzNTIpXHUyMjEyMjQ7IG92ZXJyaWRkZW4gYnkgY29uZmlnLnRzIHRva2VuQ3NzIGF0IHJ1bnRpbWUgKi9cbi5xcy10b3Age1xuICBtYXJnaW4tYm90dG9tOiAxMnB4O1xuICBwYWRkaW5nOiAwIDJweDtcbn1cbi5xcy10b3AgLm1ldGEge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucXMtdG9wIC5tZXRhIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4ucXMtdG9wIC5yYnRuIHtcbiAgcGFkZGluZzogOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luLWxlZnQ6IDdweDtcbn1cbi5xcy10b3AgLnJidG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5xcy10b3AgLnJidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5xcy10b3AgLnJidG4uZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4ucXMtdG9wIC5yYnRuLmxlYWYgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLmNoaXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLWhlaWdodDogNTRweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5jaGlwIC5jaGlwYiB7XG4gIHBhZGRpbmc6IDlweCA4cHggOXB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xufVxuLmNoaXAgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE3cHg7XG59XG4uY2hpcCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jaGlwIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIG1hcmdpbi10b3A6IDA7XG59XG4uY2hpcDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uY2hpcC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2hpcC5vbiBpbWFnZSB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gbGFiZWwge1xuICBjb2xvcjogIzE5MjAwMztcbn1cbi5jaGlwLm9uIC5zdWIge1xuICBjb2xvcjogcmdiYSgyNSwgMzIsIDMsIDAuNyk7XG59XG4uY2hpcC5vbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG4uY2hpcC5vbiAuY2hldiB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAgLmNoZXYge1xuICBtaW4td2lkdGg6IDMycHg7XG4gIGJvcmRlci1yYWRpdXM6IDAgOTk5cHggOTk5cHggMDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1sZWZ0OiAxcHggc29saWQgcmdiYSgwLCAwLCAwLCAwLjE4KTtcbn1cbi5jaGlwIC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiBpbmhlcml0O1xufVxuLmNoaXAgLmNoZXY6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMTQpO1xufVxuXG4uY2hpcHMge1xuICBtYXJnaW4tYm90dG9tOiAwO1xufVxuXG4uY2hpcHMgPiBib3g6bGFzdC1jaGlsZCB7XG4gIG1hcmdpbi1yaWdodDogMXB4O1xufVxuXG4uY2hpcC1ncmlkIHtcbiAgbWFyZ2luLWJvdHRvbTogMTBweDtcbn1cblxuc2NhbGUsIHNjYWxlOmhvcml6b250YWwsIHNjYWxlOnZlcnRpY2FsIHtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDZweCAwO1xufVxuXG5zY2FsZSA+IHRyb3VnaCwgc2NhbGU6aG9yaXpvbnRhbCA+IHRyb3VnaCwgc2NhbGU6dmVydGljYWwgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIG1pbi13aWR0aDogMDtcbiAgbWFyZ2luOiAwO1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQsXG5zY2FsZSA+IHRyb3VnaCA+IHByb2dyZXNzIHtcbiAgbWluLWhlaWdodDogNnB4O1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBzbGlkZXIge1xuICBtaW4td2lkdGg6IDE3cHg7XG4gIG1pbi1oZWlnaHQ6IDE3cHg7XG4gIG1hcmdpbjogLTZweDsgLyogcHJvdG90eXBlIGtub2IgMTdcdTAwRDcxNyAqL1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2YzZWVmMztcbiAgYm94LXNoYWRvdzogMCAxcHggNHB4IHJnYmEoMCwgMCwgMCwgMC41KTtcbn1cblxuLnNyb3cge1xuICBwYWRkaW5nOiAwIDJweCAwIDJweDtcbiAgbWluLWhlaWdodDogNDJweDtcbn1cblxuLnNyb3cgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMCAtMTJweCAwIDEycHg7XG59XG5cbi5zcm93IC5jaGV2IHtcbiAgcGFkZGluZzogNnB4IDhweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5zcm93IC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMDtcbn1cbi5zcm93IC5jaGV2OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLmdiYW5uZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbn1cbi5nYmFubmVyIC50IHtcbiAgY29sb3I6ICNlZGJiNjQ7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmdiYW5uZXIgLnMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG59XG4uZ2Jhbm5lciBpbWFnZSB7XG4gIGNvbG9yOiAjZWRiYjY0O1xufVxuXG4uZ2J0biB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbiAgcGFkZGluZzogN3B4IDEycHg7XG59XG4uZ2J0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG5cbi5kaGVhZCB7XG4gIHBhZGRpbmctYm90dG9tOiAxMHB4O1xufVxuLmRoZWFkIGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDdweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5kaGVhZCBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5kaGVhZCBsYWJlbCB7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTRweDtcbn1cblxuc3dpdGNoIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIG1pbi13aWR0aDogNDJweDtcbiAgbWluLWhlaWdodDogMjRweDtcbn1cbnN3aXRjaDpjaGVja2VkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbnN3aXRjaCBzbGlkZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiAyMHB4O1xuICBtaW4taGVpZ2h0OiAyMHB4O1xufVxuXG4ueHJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogOXB4IDExcHg7XG59XG4ueHJvdyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTdweDtcbn1cbi54cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnhyb3cgLnhzIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLnhyb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLnhyb3cuYWN0aXZlIGltYWdlIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG4ueHJvdy5hY3RpdmUgLnhzIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG5cbi5taXhyb3cge1xuICBwYWRkaW5nOiA0cHggMnB4O1xufVxuLm1peHJvdyAubWkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbn1cbi5taXhyb3cgLm1pIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xufVxuLm1peHJvdyAubW5hbWUge1xuICBmb250LXNpemU6IDEycHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtaW4td2lkdGg6IDcycHg7XG59XG5cbi5zaGVldC5sYXVuY2hlciB7XG4gIG1pbi13aWR0aDogNTUxcHg7XG59XG5cbi5sYXVuY2hlciB7XG4gIHBhZGRpbmc6IDhweDtcbn1cblxuLmZpZWxkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogM3B4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDZweDtcbn1cbi5maWVsZCBpbWFnZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbn1cbi5maWVsZCBlbnRyeSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm94LXNoYWRvdzogbm9uZTtcbiAgb3V0bGluZTogbm9uZTtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xuICBjYXJldC1jb2xvcjogI2I1Y2I0ODtcbiAgcGFkZGluZzogOHB4IDA7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbn1cbi5maWVsZCBlbnRyeSB0ZXh0IHtcbiAgbWluLWhlaWdodDogMDtcbn1cbi5maWVsZCAubHBsYWNlaG9sZGVyIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5naG9zdCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDE0LjVweDtcbn1cbi5maWVsZCAua2JkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDVweDtcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIHBhZGRpbmc6IDNweCA3cHg7XG59XG5cbi50aWxlcyB7XG4gIHBhZGRpbmc6IDhweCAycHggMTBweDtcbn1cblxuLnRpbGUge1xuICBwYWRkaW5nOiA1cHggMDtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgbWluLXdpZHRoOiA2MnB4O1xuICBtYXgtd2lkdGg6IDYycHg7XG59XG4udGlsZSAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAwO1xuICBtaW4taGVpZ2h0OiAwO1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4udGlsZSBsYWJlbCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi50aWxlOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLnRpbGU6aG92ZXIgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLmxmb290IHtcbiAgcGFkZGluZzogN3B4IDEwcHggM3B4O1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMXB4O1xufVxuLmxmb290IGIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmx3aWRnZXRzIHtcbiAgcGFkZGluZzogMCAycHggNnB4O1xufVxuXG4ud2lkZ2V0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xufVxuLndpZGdldCBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi53aWRnZXQgLmhpbnQge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4ubHdtIC5sd2FydCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xufVxuLmx3bSAubHdhcnQgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDExcHg7XG59XG4ubHdtIC5tYnRuIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgbWluLXdpZHRoOiAyOXB4O1xuICBtaW4taGVpZ2h0OiAyOXB4O1xufVxuLmx3bSAubWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmx3bSAubWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5zZWMge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBwYWRkaW5nOiA4cHggMTBweCAycHg7XG59XG5cbi5yb3cge1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA3cHggMTBweDtcbn1cbi5yb3cgLnJpIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiAycHg7XG59XG4ucm93IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDI0cHg7XG59XG4ucm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLnJvdyAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5yb3cgLnJ1bmsge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogMnB4IDdweDtcbn1cbi5yb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLnJvdy5zZWwge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG4uY2FsIHtcbiAgbWluLXdpZHRoOiAzMDlweDtcbn1cbi5jYWwgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5jYWwgLmhlcm8ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxOXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuY2FsaGVybyB7XG4gIHBhZGRpbmc6IDVweCA4cHggOHB4IDhweDtcbn1cbi5jYWwgLmNhbC1ncmlkIHtcbiAgbWFyZ2luLXRvcDogOHB4O1xufVxuLmNhbCAubW9udGgge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxM3B4O1xufVxuLmNhbCAubW9udGg6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b24ge1xuICBwYWRkaW5nOiA2cHggNXB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jYWwgLmRvdyB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDkuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBwYWRkaW5nOiAzcHggMCA2cHg7XG59XG4uY2FsIC53ayB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5jYWwgLmRheSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBtaW4td2lkdGg6IDI0cHg7XG4gIG1pbi1oZWlnaHQ6IDI0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1hcmdpbjogMXB4O1xufVxuLmNhbCAuZGF5OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5jYWwgLmRheS53ZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLmNhbCAuZGF5Lm91dCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLmNhbCAuZGF5LnRvZGF5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG59XG4uY2FsIC5kYXkudG9kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuLmNhbCAuZGF5LnNlbDpub3QoLnRvZGF5KSB7XG4gIGJveC1zaGFkb3c6IGluc2V0IDAgMCAwIDEuNXB4ICNiNWFkYmM7XG59XG4uY2FsIC5kYXkudG9kYXkuc2VsIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggIzE5MjAwMztcbn1cbi5jYWwgLmRheSAuZXZkb3Qge1xuICBtaW4td2lkdGg6IDNweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBtYXJnaW4tYm90dG9tOiAycHg7XG59XG4uY2FsIC5kYXkudG9kYXkgLmV2ZG90IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzE5MjAwMztcbn1cbi5jYWwgLmV2Y2FyZCB7XG4gIG1hcmdpbi10b3A6IDEwcHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDEwcHg7XG59XG4uY2FsIC5ldmhlYWQge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIHBhZGRpbmc6IDFweCAzcHggOHB4O1xufVxuLmNhbCAuZXZyb3cge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA4cHggMTBweDtcbiAgbWFyZ2luLWJvdHRvbTogNHB4O1xufVxuLmNhbCAuZXZyb3c6bGFzdC1jaGlsZCB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM2Mjg5MzM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLmNhbCAuZXZyb3cgLmV2aWMgaW1hZ2Uge1xuICBjb2xvcjogI2ZmZjtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4uY2FsIC5ldnJvdyBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5jYWwgLmV2cm93IC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5kcmF3ZXIge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbn1cblxuLnRvYXN0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgxNiwgMTMsIDIwLCAwLjgyKTtcbiAgYm9yZGVyLXJhZGl1czogMjBweDtcbiAgcGFkZGluZzogMTFweCAxM3B4O1xuICBib3gtc2hhZG93OiAwIDE4cHggNDBweCByZ2JhKDUsIDMsIDEwLCAwLjQ1KTtcbn1cblxuLm5jYXJkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMjBweDtcbiAgcGFkZGluZzogMTFweCAxMnB4O1xufVxuLm5jYXJkIC5uaWMge1xuICBtaW4td2lkdGg6IDMwcHg7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5uY2FyZCB7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xufVxuLm5jYXJkIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4ubmNhcmQgLmJvZHkge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS44cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgLndoZW4ge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xufVxuLm5jYXJkIC5ueCB7XG4gIHBhZGRpbmc6IDVweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4ubmNhcmQgLm54OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNlZjg2YTA7XG59XG5cbi5uaGVhZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDhweCA4cHggOHB4IDE0cHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG4ubmhlYWQgbGFiZWwge1xuICBmb250LXNpemU6IDEzLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5uaGVhZCAuc3ViIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uaGVhZCAubmNsZWFyIHtcbiAgY29sb3I6ICNlZjg2YTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIHBhZGRpbmc6IDRweCA5cHg7XG59XG4ubmhlYWQgLm5jbGVhcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG5cbi5vc2Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgcGFkZGluZzogMTBweCAxNXB4O1xufVxuLm9zZCBpbWFnZSB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5vc2Qgc2NhbGUgPiB0cm91Z2gsIC5vc2Qgc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQge1xuICBtaW4taGVpZ2h0OiA4cHg7XG59XG4ub3NkIC5zdmFsIHtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuXG4uc2Vzc2lvbiB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoOSwgMywgMTQsIDAuOCk7XG59XG4uc2Vzc2lvbiAuc2J0biB7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5zZXNzaW9uIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyNHB4O1xuICBtaW4td2lkdGg6IDU5cHg7XG4gIG1pbi1oZWlnaHQ6IDU5cHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xuICBjb2xvcjogI2YzZWVmMztcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMDBtcywgY29sb3IgMjAwbXM7XG59XG4uc2Vzc2lvbiAucmVkIC5zaWMge1xuICBjb2xvcjogI2VmODZhMDtcbn1cbi5zZXNzaW9uIC5zYnRuOmhvdmVyIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5zZXNzaW9uIC5yZWQ6aG92ZXIgLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLnNlc3Npb24gbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuLnNlc3Npb24gLmNvbmZpcm0gbGFiZWwge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmNtZW51IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLmNtZW51IC5jbWkge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uY21lbnUgLmNtaTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY21lbnUgLmNtaS5kYW5nZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5jbWVudSAuY3NlcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIG1pbi1oZWlnaHQ6IDFweDtcbiAgbWFyZ2luOiA0cHggOHB4O1xufVxuXG4uZHRpcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA2cHggMTFweDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59IiwgIi8vIFRoZSB0b2tlbiBsYXllciBcdTIwMTQgdGhlIHNpbmdsZSBwbGFjZSB0aGUgc2hlbGwncyBnZW9tZXRyeSBjb21lcyBmcm9tLlxuLy8gUHJvdG90eXBlIGVxdWl2YWxlbnQ6IHRoZSBDU1MgY3VzdG9tIHByb3BlcnRpZXMgb24gLmRlc2t0b3AgKDA0YmU3MmUpLlxuLy8gQ2hhbmdlIGEgdmFsdWUgaGVyZSBhbmQgYmFyLCBwYW5lbHMsIGRvY2ssIHNuYXAtYW5jaG9yZWQgc3VyZmFjZXMgYWxsIHJlZmxvdy5cblxuZXhwb3J0IGludGVyZmFjZSBUb2tlbnMge1xuICAgIGJhckg6IG51bWJlciAvLyBweCBcdTIwMTQgYmFyIGhlaWdodDsgY29udHJvbHMgZGVyaXZlIGZyb20gaXRcbiAgICBiYXJSOiBudW1iZXIgLy8gYmFyIGNvcm5lciByYWRpdXNcbiAgICBnYXA6IG51bWJlciAvLyBzY3JlZW4gZ2FwIChiYXIgdG9wIG9mZnNldCwgZG9jayBib3R0b20gb2Zmc2V0KVxuICAgIGVkZ2U6IG51bWJlciAvLyBzaWRlIGluc2V0c1xuICAgIGljb246IG51bWJlciAvLyBkb2NrL2xhdW5jaGVyIGljb24gdGlsZSBzaXplXG4gICAgZG9ja1BhZDogbnVtYmVyIC8vIGRvY2sgcGFkZGluZyAoY29uY2VudHJpYyByYWRpdXMgZGVyaXZlcylcbiAgICB0aWxlSDogbnVtYmVyIC8vIFFTIHRpbGUgaGVpZ2h0XG4gICAgcGFuZWxXOiBudW1iZXIgLy8gUVMvbm90aWZpY2F0aW9ucy90b2FzdHMgd2lkdGhcbiAgICBsYXVuY2hlclc6IG51bWJlclxuICAgIGNhbGVuZGFyVzogbnVtYmVyXG59XG5cbmV4cG9ydCBjb25zdCBmbG9hdGluZzogVG9rZW5zID0ge1xuICAgIGJhckg6IDQyLFxuICAgIGJhclI6IDE0LFxuICAgIGdhcDogMTAsXG4gICAgZWRnZTogMTIsXG4gICAgaWNvbjogNDQsXG4gICAgZG9ja1BhZDogNSxcbiAgICB0aWxlSDogNTQsXG4gICAgcGFuZWxXOiAzNTIsXG4gICAgbGF1bmNoZXJXOiA1NjAsXG4gICAgY2FsZW5kYXJXOiAzMzAsXG59XG5cbi8vIGdhcGxlc3MgPSBhIHRva2VuIHByZXNldCwgZXhhY3RseSBsaWtlIHRoZSBwcm90b3R5cGUncyAuZ2FwbGVzcyBjbGFzc1xuZXhwb3J0IGNvbnN0IGdhcGxlc3M6IFRva2VucyA9IHtcbiAgICAuLi5mbG9hdGluZyxcbiAgICBiYXJIOiAzOCxcbiAgICBiYXJSOiAwLFxuICAgIGdhcDogMCxcbiAgICBlZGdlOiAwLFxufVxuXG5leHBvcnQgbGV0IHRva2VuczogVG9rZW5zID0gZmxvYXRpbmdcblxuZXhwb3J0IGNvbnN0IGN0bCA9ICgpID0+IHRva2Vucy5iYXJIIC0gMTEgLy8gYmFyIGNvbnRyb2wgc2l6ZVxuZXhwb3J0IGNvbnN0IHBhbmVsVG9wID0gKCkgPT4gdG9rZW5zLmdhcCArIHRva2Vucy5iYXJIICsgNlxuXG4vLyBHVEsgQ1NTIGNhbid0IGNhbGMoKSBmcm9tIEpTIHN0YXRlOyB3ZSByZWdlbmVyYXRlIGEgOnJvb3QtaXNoIGJsb2NrIGFuZFxuLy8gbGV0IEFwcC5hcHBseV9jc3MgcmUtc2tpbiBsaXZlICh0aGUgXCJiYXIgNDIgY3ljbGVyXCIgb2YgdGhlIFFNTC9BR1Mgd29ybGQpLlxuZXhwb3J0IGZ1bmN0aW9uIHRva2VuQ3NzKHQ6IFRva2VucyA9IHRva2Vucyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGBcbiAgLmJhciB7IG1pbi1oZWlnaHQ6ICR7dC5iYXJIfXB4OyBib3JkZXItcmFkaXVzOiAke3QuYmFyUn1weDtcbiAgICAgICAgIG1hcmdpbjogMDsgfVxuICAuYmFyIGJ1dHRvbiB7IG1pbi13aWR0aDogJHtjdGwoKX1weDsgbWluLWhlaWdodDogJHtjdGwoKX1weDsgfVxuICAuZG9jayB7IHBhZGRpbmc6ICR7dC5kb2NrUGFkfXB4OyBib3JkZXItcmFkaXVzOiAkezEyICsgdC5kb2NrUGFkIC0gMX1weDtcbiAgICAgICAgICBtYXJnaW4tYm90dG9tOiAke3QuZ2FwfXB4OyB9XG4gIC5pY29uLXRpbGUgeyBtaW4td2lkdGg6ICR7dC5pY29ufXB4OyBtaW4taGVpZ2h0OiAke3QuaWNvbn1weDsgfVxuICAucXMsIC5kcmF3ZXIsIC5jYWxlbmRhciB7IG1hcmdpbi10b3A6ICR7cGFuZWxUb3AoKX1weDsgfVxuICAucXMgeyBtaW4td2lkdGg6ICR7dC5wYW5lbFcgLSAyNH1weDsgfSAgLyogcGFuZWxXIGlzIG91dGVyOyBzdWJ0cmFjdCAuc2hlZXQgcGFkZGluZyAxMnB4XHUwMEQ3MiAqL1xuICAubGF1bmNoZXIgeyBtaW4td2lkdGg6ICR7dC5sYXVuY2hlcld9cHg7IH1cbiAgLmNhbGVuZGFyIHsgbWluLXdpZHRoOiAke3QuY2FsZW5kYXJXfXB4OyB9XG4gIC5jaGlwIHsgbWluLWhlaWdodDogJHt0LnRpbGVIfXB4OyB9XG4gIGBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldFRva2VucyhuZXh0OiBQYXJ0aWFsPFRva2Vucz4sIGFwcGx5OiAoY3NzOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICB0b2tlbnMgPSB7IC4uLnRva2VucywgLi4ubmV4dCB9XG4gICAgYXBwbHkodG9rZW5Dc3ModG9rZW5zKSlcbn1cbiIsICIvLyBvcmcuZ25vYmxpbi5TaGVsbCBcdTIwMTQgdGhlIGNvbXBvc2l0b3IgbGluay4gRHJpdmVzOiBzb2Z0LXJlbG9hZCwgZmVhdHVyZSB0b2dnbGVzLFxuLy8gdGhlIFdJTkRPVyBMSVNUIHRoYXQgbWFrZXMgdGhlIGRvY2sgdHJ1dGhmdWwsIGFuZCB0aGUgY29ubmVjdGVkL2FtYmVyIHN0YXRlLlxuLy8gUHJvdG90eXBlOiBzZXJ2aWNlcyAnZ25vYicgYmFubmVyICsgYmFyIGFtYmVyIHNlZ21lbnQgKyBXTSBpbnRlZ3JhdGlvbi5cblxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5pbXBvcnQgeyBWYXJpYWJsZSB9IGZyb20gXCJhc3RhbFwiXG5cbmNvbnN0IEJVUyA9IFwib3JnLmdub2JsaW4uU2hlbGxcIlxuY29uc3QgUEFUSCA9IFwiL29yZy9nbm9ibGluL1NoZWxsXCJcbmNvbnN0IElGQUNFID0gXCJvcmcuZ25vYmxpbi5TaGVsbFwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgR25vYmxpbldpbmRvdyB7XG4gICAgaWQ6IHN0cmluZ1xuICAgIGFwcElkOiBzdHJpbmdcbiAgICB0aXRsZTogc3RyaW5nXG4gICAgZm9jdXNlZDogYm9vbGVhblxuICAgIG1pbmltaXplZDogYm9vbGVhblxufVxuXG5leHBvcnQgY29uc3QgY29ubmVjdGVkID0gVmFyaWFibGUoZmFsc2UpXG5leHBvcnQgY29uc3Qgd2luZG93cyA9IFZhcmlhYmxlPEdub2JsaW5XaW5kb3dbXT4oW10pXG5cbmxldCBwcm94eTogR2lvLkRCdXNQcm94eSB8IG51bGwgPSBudWxsXG5cbmZ1bmN0aW9uIGNhbGwobWV0aG9kOiBzdHJpbmcsIHBhcmFtczogR0xpYi5WYXJpYW50IHwgbnVsbCA9IG51bGwpOiBQcm9taXNlPEdMaWIuVmFyaWFudCB8IG51bGw+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgICAgIGlmICghcHJveHkpIHJldHVybiByZWoobmV3IEVycm9yKFwiZ25vYmxpbjogbm90IGNvbm5lY3RlZFwiKSlcbiAgICAgICAgcHJveHkuY2FsbChtZXRob2QsIHBhcmFtcywgR2lvLkRCdXNDYWxsRmxhZ3MuTk9ORSwgMjAwMCwgbnVsbCwgKF8sIHIpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzKHByb3h5IS5jYWxsX2ZpbmlzaChyKSlcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICByZWooZSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgY29uc3QgcmVsb2FkID0gKCkgPT4gY2FsbChcIlJlbG9hZFwiKVxuZXhwb3J0IGNvbnN0IHNldEZlYXR1cmUgPSAobmFtZTogc3RyaW5nLCBvbjogYm9vbGVhbikgPT5cbiAgICBjYWxsKFwiU2V0RmVhdHVyZVwiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHNiKVwiLCBbbmFtZSwgb25dKSlcblxuLy8gV2luZG93IHZlcmJzICh0aGUgZG9jayBjbGljayBtb2RlbClcbmV4cG9ydCBjb25zdCBhY3RpdmF0ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiQWN0aXZhdGVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcbmV4cG9ydCBjb25zdCBtaW5pbWl6ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiTWluaW1pemVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hXaW5kb3dzKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHYgPSBhd2FpdCBjYWxsKFwiTGlzdFdpbmRvd3NcIilcbiAgICAgICAgaWYgKCF2KSByZXR1cm5cbiAgICAgICAgY29uc3QgW2xpc3RdID0gdi5kZWVwX3VucGFjaygpIGFzIFtHbm9ibGluV2luZG93W11dXG4gICAgICAgIHdpbmRvd3Muc2V0KGxpc3QpXG4gICAgfSBjYXRjaCB7XG4gICAgICAgIC8qIHN0YXkgb24gbGFzdC1rbm93biBsaXN0OyBjb25uZWN0ZWQgZmxhZyBjYXJyaWVzIHRoZSB0cnV0aCAqL1xuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcFdpbmRvd3MoYXBwSWQ6IHN0cmluZyk6IEdub2JsaW5XaW5kb3dbXSB7XG4gICAgcmV0dXJuIHdpbmRvd3MuZ2V0KCkuZmlsdGVyKCh3KSA9PiB3LmFwcElkID09PSBhcHBJZClcbn1cblxuLy8gQ3ljbGUgPSB0aGUgZG9jayBjYXJvdXNlbDogZm9jdXMgdGhlIG5leHQgd2luZG93IG9mIHRoZSBhcHBcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjeWNsZShhcHBJZDogc3RyaW5nLCBkaXI6IDEgfCAtMSkge1xuICAgIGNvbnN0IHdzID0gYXBwV2luZG93cyhhcHBJZClcbiAgICBpZiAod3MubGVuZ3RoIDwgMikgcmV0dXJuXG4gICAgY29uc3QgaSA9IHdzLmZpbmRJbmRleCgodykgPT4gdy5mb2N1c2VkKVxuICAgIGF3YWl0IGFjdGl2YXRlKHdzWygoaSA8IDAgPyAwIDogaSkgKyBkaXIgKyB3cy5sZW5ndGgpICUgd3MubGVuZ3RoXS5pZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gICAgR2lvLmJ1c193YXRjaF9uYW1lKFxuICAgICAgICBHaW8uQnVzVHlwZS5TRVNTSU9OLFxuICAgICAgICBCVVMsXG4gICAgICAgIEdpby5CdXNOYW1lV2F0Y2hlckZsYWdzLk5PTkUsXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIGFwcGVhcmVkXG4gICAgICAgICAgICBHaW8uREJ1c1Byb3h5Lm5ld19mb3JfYnVzKFxuICAgICAgICAgICAgICAgIEdpby5CdXNUeXBlLlNFU1NJT04sXG4gICAgICAgICAgICAgICAgR2lvLkRCdXNQcm94eUZsYWdzLk5PTkUsXG4gICAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgICBCVVMsXG4gICAgICAgICAgICAgICAgUEFUSCxcbiAgICAgICAgICAgICAgICBJRkFDRSxcbiAgICAgICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgICAgIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcHJveHkgPSBHaW8uREJ1c1Byb3h5Lm5ld19mb3JfYnVzX2ZpbmlzaChyZXMpXG4gICAgICAgICAgICAgICAgICAgIHByb3h5LmNvbm5lY3QoXCJnLXNpZ25hbFwiLCAoX3AsIF9zLCBzaWcpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzaWcgPT09IFwiV2luZG93c0NoYW5nZWRcIikgcmVmcmVzaFdpbmRvd3MoKVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICBjb25uZWN0ZWQuc2V0KHRydWUpXG4gICAgICAgICAgICAgICAgICAgIHJlZnJlc2hXaW5kb3dzKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICApXG4gICAgICAgIH0sXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIHZhbmlzaGVkIFx1MjE5MiBhbWJlciBldmVyeXdoZXJlIHRoYXQgbGlzdGVuc1xuICAgICAgICAgICAgcHJveHkgPSBudWxsXG4gICAgICAgICAgICBjb25uZWN0ZWQuc2V0KGZhbHNlKVxuICAgICAgICB9XG4gICAgKVxufVxuIiwgImltcG9ydCBcIi4vb3ZlcnJpZGVzLmpzXCJcbmV4cG9ydCB7IGRlZmF1bHQgYXMgQXN0YWxJTyB9IGZyb20gXCJnaTovL0FzdGFsSU8/dmVyc2lvbj0wLjFcIlxuZXhwb3J0ICogZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi90aW1lLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL2ZpbGUuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vZ29iamVjdC5qc1wiXG5leHBvcnQgeyBCaW5kaW5nLCBiaW5kIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5leHBvcnQgeyBWYXJpYWJsZSwgZGVyaXZlIH0gZnJvbSBcIi4vdmFyaWFibGUuanNcIlxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcblxuZXhwb3J0IHsgR2lvIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEFzdGFsLnJlYWRfZmlsZShwYXRoKSB8fCBcIlwiXG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkRmlsZUFzeW5jKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgQXN0YWwucmVhZF9maWxlX2FzeW5jKHBhdGgsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5yZWFkX2ZpbGVfZmluaXNoKHJlcykgfHwgXCJcIilcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUZpbGUocGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBBc3RhbC53cml0ZV9maWxlKHBhdGgsIGNvbnRlbnQpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUZpbGVBc3luYyhwYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIEFzdGFsLndyaXRlX2ZpbGVfYXN5bmMocGF0aCwgY29udGVudCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLndyaXRlX2ZpbGVfZmluaXNoKHJlcykpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbW9uaXRvckZpbGUoXG4gICAgcGF0aDogc3RyaW5nLFxuICAgIGNhbGxiYWNrOiAoZmlsZTogc3RyaW5nLCBldmVudDogR2lvLkZpbGVNb25pdG9yRXZlbnQpID0+IHZvaWQsXG4pOiBHaW8uRmlsZU1vbml0b3Ige1xuICAgIHJldHVybiBBc3RhbC5tb25pdG9yX2ZpbGUocGF0aCwgKGZpbGU6IHN0cmluZywgZXZlbnQ6IEdpby5GaWxlTW9uaXRvckV2ZW50KSA9PiB7XG4gICAgICAgIGNhbGxiYWNrKGZpbGUsIGV2ZW50KVxuICAgIH0pIVxufVxuIiwgImltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuXG5leHBvcnQgeyBkZWZhdWx0IGFzIEdMaWIgfSBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmV4cG9ydCB7IEdPYmplY3QsIEdPYmplY3QgYXMgZGVmYXVsdCB9XG5cbmNvbnN0IG1ldGEgPSBTeW1ib2woXCJtZXRhXCIpXG5jb25zdCBwcml2ID0gU3ltYm9sKFwicHJpdlwiKVxuXG5jb25zdCB7IFBhcmFtU3BlYywgUGFyYW1GbGFncyB9ID0gR09iamVjdFxuXG5jb25zdCBrZWJhYmlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDEtJDJcIilcbiAgICAucmVwbGFjZUFsbChcIl9cIiwgXCItXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxudHlwZSBTaWduYWxEZWNsYXJhdGlvbiA9IHtcbiAgICBmbGFncz86IEdPYmplY3QuU2lnbmFsRmxhZ3NcbiAgICBhY2N1bXVsYXRvcj86IEdPYmplY3QuQWNjdW11bGF0b3JUeXBlXG4gICAgcmV0dXJuX3R5cGU/OiBHT2JqZWN0LkdUeXBlXG4gICAgcGFyYW1fdHlwZXM/OiBBcnJheTxHT2JqZWN0LkdUeXBlPlxufVxuXG50eXBlIFByb3BlcnR5RGVjbGFyYXRpb24gPVxuICAgIHwgSW5zdGFuY2VUeXBlPHR5cGVvZiBHT2JqZWN0LlBhcmFtU3BlYz5cbiAgICB8IHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH1cbiAgICB8IHR5cGVvZiBTdHJpbmdcbiAgICB8IHR5cGVvZiBOdW1iZXJcbiAgICB8IHR5cGVvZiBCb29sZWFuXG4gICAgfCB0eXBlb2YgT2JqZWN0XG5cbnR5cGUgR09iamVjdENvbnN0cnVjdG9yID0ge1xuICAgIFttZXRhXT86IHtcbiAgICAgICAgUHJvcGVydGllcz86IHsgW2tleTogc3RyaW5nXTogR09iamVjdC5QYXJhbVNwZWMgfVxuICAgICAgICBTaWduYWxzPzogeyBba2V5OiBzdHJpbmddOiBHT2JqZWN0LlNpZ25hbERlZmluaXRpb24gfVxuICAgIH1cbiAgICBuZXcoLi4uYXJnczogYW55W10pOiBhbnlcbn1cblxudHlwZSBNZXRhSW5mbyA9IEdPYmplY3QuTWV0YUluZm88bmV2ZXIsIEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0+LCBuZXZlcj5cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyKG9wdGlvbnM6IE1ldGFJbmZvID0ge30pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGNsczogR09iamVjdENvbnN0cnVjdG9yKSB7XG4gICAgICAgIGNvbnN0IHQgPSBvcHRpb25zLlRlbXBsYXRlXG4gICAgICAgIGlmICh0eXBlb2YgdCA9PT0gXCJzdHJpbmdcIiAmJiAhdC5zdGFydHNXaXRoKFwicmVzb3VyY2U6Ly9cIikgJiYgIXQuc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgICAgIC8vIGFzc3VtZSB4bWwgdGVtcGxhdGVcbiAgICAgICAgICAgIG9wdGlvbnMuVGVtcGxhdGUgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUodClcbiAgICAgICAgfVxuXG4gICAgICAgIEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7XG4gICAgICAgICAgICBTaWduYWxzOiB7IC4uLmNsc1ttZXRhXT8uU2lnbmFscyB9LFxuICAgICAgICAgICAgUHJvcGVydGllczogeyAuLi5jbHNbbWV0YV0/LlByb3BlcnRpZXMgfSxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgIH0sIGNscylcblxuICAgICAgICBkZWxldGUgY2xzW21ldGFdXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcHJvcGVydHkoZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24gPSBPYmplY3QpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldDogYW55LCBwcm9wOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpIHtcbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdID8/PSB7fVxuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllcyA/Pz0ge31cblxuICAgICAgICBjb25zdCBuYW1lID0ga2ViYWJpZnkocHJvcClcblxuICAgICAgICBpZiAoIWRlc2MpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIHByb3AsIHtcbiAgICAgICAgICAgICAgICBnZXQoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW3ByaXZdPy5bcHJvcF0gPz8gZGVmYXVsdFZhbHVlKGRlY2xhcmF0aW9uKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc2V0KHY6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodiAhPT0gdGhpc1twcm9wXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpc1twcml2XSA/Pz0ge31cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJpdl1bcHJvcF0gPSB2XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeShuYW1lKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBzZXRfJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWUodjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXNbcHJvcF0gPSB2XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBnZXRfJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWUoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW3Byb3BdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzW2tlYmFiaWZ5KHByb3ApXSA9IHBzcGVjKG5hbWUsIFBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBkZWNsYXJhdGlvbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBmbGFncyA9IDBcbiAgICAgICAgICAgIGlmIChkZXNjLmdldCkgZmxhZ3MgfD0gUGFyYW1GbGFncy5SRUFEQUJMRVxuICAgICAgICAgICAgaWYgKGRlc2Muc2V0KSBmbGFncyB8PSBQYXJhbUZsYWdzLldSSVRBQkxFXG5cbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzW2tlYmFiaWZ5KHByb3ApXSA9IHBzcGVjKG5hbWUsIGZsYWdzLCBkZWNsYXJhdGlvbilcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbCguLi5wYXJhbXM6IEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0Pik6XG4odGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB2b2lkXG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoZGVjbGFyYXRpb24/OiBTaWduYWxEZWNsYXJhdGlvbik6XG4odGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB2b2lkXG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoXG4gICAgZGVjbGFyYXRpb24/OiBTaWduYWxEZWNsYXJhdGlvbiB8IHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0LFxuICAgIC4uLnBhcmFtczogQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3Q+XG4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikge1xuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0gPz89IHt9XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzID8/PSB7fVxuXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZWJhYmlmeShzaWduYWwpXG5cbiAgICAgICAgaWYgKGRlY2xhcmF0aW9uIHx8IHBhcmFtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIFRPRE86IHR5cGUgYXNzZXJ0XG4gICAgICAgICAgICBjb25zdCBhcnIgPSBbZGVjbGFyYXRpb24sIC4uLnBhcmFtc10ubWFwKHYgPT4gdi4kZ3R5cGUpXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFsc1tuYW1lXSA9IHtcbiAgICAgICAgICAgICAgICBwYXJhbV90eXBlczogYXJyLFxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHNbbmFtZV0gPSBkZWNsYXJhdGlvbiB8fCB7XG4gICAgICAgICAgICAgICAgcGFyYW1fdHlwZXM6IFtdLFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZXNjKSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBzaWduYWwsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdChuYW1lLCAuLi5hcmdzKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgb2c6ICgoLi4uYXJnczogYW55W10pID0+IHZvaWQpID0gZGVzYy52YWx1ZVxuICAgICAgICAgICAgZGVzYy52YWx1ZSA9IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igbm90IHR5cGVkXG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0KG5hbWUsIC4uLmFyZ3MpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgb25fJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gb2cuYXBwbHkodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gcHNwZWMobmFtZTogc3RyaW5nLCBmbGFnczogbnVtYmVyLCBkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbikge1xuICAgIGlmIChkZWNsYXJhdGlvbiBpbnN0YW5jZW9mIFBhcmFtU3BlYylcbiAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uXG5cbiAgICBzd2l0Y2ggKGRlY2xhcmF0aW9uKSB7XG4gICAgICAgIGNhc2UgU3RyaW5nOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5zdHJpbmcobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIFwiXCIpXG4gICAgICAgIGNhc2UgTnVtYmVyOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5kb3VibGUobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIC1OdW1iZXIuTUFYX1ZBTFVFLCBOdW1iZXIuTUFYX1ZBTFVFLCAwKVxuICAgICAgICBjYXNlIEJvb2xlYW46XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmJvb2xlYW4obmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIGZhbHNlKVxuICAgICAgICBjYXNlIE9iamVjdDpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuanNvYmplY3QobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MpXG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG1pc3N0eXBlZFxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5vYmplY3QobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIGRlY2xhcmF0aW9uLiRndHlwZSlcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRWYWx1ZShkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbikge1xuICAgIGlmIChkZWNsYXJhdGlvbiBpbnN0YW5jZW9mIFBhcmFtU3BlYylcbiAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uLmdldF9kZWZhdWx0X3ZhbHVlKClcblxuICAgIHN3aXRjaCAoZGVjbGFyYXRpb24pIHtcbiAgICAgICAgY2FzZSBTdHJpbmc6XG4gICAgICAgICAgICByZXR1cm4gXCJcIlxuICAgICAgICBjYXNlIE51bWJlcjpcbiAgICAgICAgICAgIHJldHVybiAwXG4gICAgICAgIGNhc2UgQm9vbGVhbjpcbiAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICBjYXNlIE9iamVjdDpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiBudWxsXG4gICAgfVxufVxuIiwgIi8vIERlZmVycmVkLCBub24tYmxvY2tpbmcgQXN0YWxOb3RpZmQgYWNjZXNzLiBnZXRfZGVmYXVsdCgpIGNhbiBibG9jayBvbiBhIGhlYWRsZXNzIG9yXG4vLyBjb250ZW5kZWQgc2Vzc2lvbiBidXMgKGl0IHRyaWVzIHRvIGJlY29tZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyBhbmQgd2FpdHMpLFxuLy8gc28gd2UgTkVWRVIgdG91Y2ggaXQgZHVyaW5nIHdpZGdldCBjb25zdHJ1Y3Rpb24uIGluaXQoKSBpcyBjYWxsZWQgb25jZSBmcm9tIGFuIGlkbGVcbi8vIGFmdGVyIHRoZSBzaGVsbCBpcyBtYXBwZWQ7IG9uIHJlYWwgaGFyZHdhcmUgaXQgcmV0dXJucyBmYXN0LCBpbiB0aGUgc3RyaXBwZWQgZGV2a2l0XG4vLyBpdCBtYXkgbm8tb3AuIFdpZGdldHMgYmluZCB0byBgdW5yZWFkYC9gbGlzdGAgYW5kIGh5ZHJhdGUgd2hlbiBpdCBsYW5kcy5cbmltcG9ydCB7IFZhcmlhYmxlLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuLy8gSW1wb3J0aW5nIHRoZSB0eXBlbGliIGlzIGNoZWFwICsgbm9uLWJsb2NraW5nOyBvbmx5IGdldF9kZWZhdWx0KCkgbWF5IGJsb2NrIChpdCB0cmllc1xuLy8gdG8gYmVjb21lIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zKSwgc28gd2UgY2FsbCBUSEFUIGxhemlseSBmcm9tIGFuIGlkbGUuIFRoZSBvbGRcbi8vIGBpbXBvcnRzLmdpLkFzdGFsTm90aWZkYCB0aHJvd3MgdW5kZXIgYGdqcyAtbWAgKEVTTSBoYXMgbm8gbGVnYWN5IGBpbXBvcnRzYCBnbG9iYWwpLlxuaW1wb3J0IE5vdGlmZCBmcm9tIFwiZ2k6Ly9Bc3RhbE5vdGlmZFwiXG5cbmV4cG9ydCBjb25zdCB1bnJlYWQgPSBWYXJpYWJsZSgwKVxuZXhwb3J0IGNvbnN0IHJlYWR5ID0gVmFyaWFibGUoZmFsc2UpXG5sZXQgbjogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5cbmV4cG9ydCBmdW5jdGlvbiBub3RpZmQoKSB7XG4gICAgcmV0dXJuIG5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gICAgLy8gZ2V0ZW52IHJldHVybnMgXCJcIiAoZmFsc3kpIHdoZW4gdGhlIHZhciBpcyBzZXQtYnV0LWVtcHR5LCBudWxsIHdoZW4gdW5zZXQgXHUyMDE0IGJvdGggc2tpcFxuICAgIC8vIGNvcnJlY3RseSBvbmx5IHdoZW4gdGhlIHZhbHVlIGlzIHRydXRoeSAoXCIxXCIpLlxuICAgIGlmIChHTGliLmdldGVudihcIktPQkVMX1NLSVBfTk9USUZEXCIpKSByZXR1cm5cbiAgICAvLyBkZWZlciBwYXN0IGZpcnN0IHBhaW50OyBpZiBnZXRfZGVmYXVsdCBibG9ja3MsIGl0IGJsb2NrcyBvbmx5IHRoaXMgaWRsZSB0aWNrLFxuICAgIC8vIG5ldmVyIGNvbnN0cnVjdGlvbi9maXJzdCByZW5kZXIuXG4gICAgdGltZW91dCg1MCwgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgbiA9IE5vdGlmZC5nZXRfZGVmYXVsdCgpXG4gICAgICAgICAgICByZWFkeS5zZXQodHJ1ZSlcbiAgICAgICAgICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB1bnJlYWQuc2V0KG4hLm5vdGlmaWNhdGlvbnMubGVuZ3RoKVxuICAgICAgICAgICAgbi5jb25uZWN0KFwibm90aWZpZWRcIiwgc3luYylcbiAgICAgICAgICAgIG4uY29ubmVjdChcInJlc29sdmVkXCIsIHN5bmMpXG4gICAgICAgICAgICBzeW5jKClcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBub3RpZmQgaW5pdCBza2lwcGVkOiAke2V9YClcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiLy8gR1RLIHdpZGdldC10cmVlIGdlb21ldHJ5IGR1bXBlciBcdTIwMTQgdGhlIG1pcnJvciBvZiB0aGUgRE9NJ3MgZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkuXG4vLyBXYWxrcyBhIG1hcHBlZCB3aW5kb3cgYW5kIHJlY29yZHMgZXZlcnkgd2lkZ2V0J3MgcmVhbCBhbGxvY2F0aW9uICh4L3kvdy9oIHJlbGF0aXZlXG4vLyB0byB0aGUgd2luZG93IGNvbnRlbnQpICsgQ1NTIGNsYXNzZXMgKyB0ZXh0LCBzbyBhIHJlbmRlcmVkIEdUSyBzdXJmYWNlIGNhbiBiZSBkaWZmZWRcbi8vIDE6MSBhZ2FpbnN0IHRoZSBwcm90b3R5cGUgRE9NLiBHYXRlZCBieSBLT0JFTF9EVU1QPTx3aW5kb3c+IGluIGFwcC50cy5cbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHcmFwaGVuZSBmcm9tIFwiZ2k6Ly9HcmFwaGVuZVwiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcblxuZXhwb3J0IGludGVyZmFjZSBOb2RlIHtcbiAgICBkOiBudW1iZXJcbiAgICB0eXBlOiBzdHJpbmdcbiAgICBjbHM6IHN0cmluZ1xuICAgIHg6IG51bWJlclxuICAgIHk6IG51bWJlclxuICAgIHc6IG51bWJlclxuICAgIGg6IG51bWJlclxuICAgIHQ6IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHVtcFdpbmRvdyh3aW46IEd0ay5XaW5kb3cpOiBOb2RlW10ge1xuICAgIGNvbnN0IG91dDogTm9kZVtdID0gW11cbiAgICBjb25zdCByb290OiBhbnkgPSB3aW5cbiAgICBjb25zdCB3YWxrID0gKHc6IGFueSwgZGVwdGg6IG51bWJlcikgPT4ge1xuICAgICAgICAvLyBjb21wdXRlX2JvdW5kcyBnaXZlcyB0aGUgd2lkZ2V0J3MgRlVMTCByZW5kZXJlZCByZWN0IChpbmNsLiBpdHMgb3duIHBhZGRpbmcpIGluXG4gICAgICAgIC8vIHRoZSByb290J3MgY29vcmRzIFx1MjAxNCBtb3JlIHJlbGlhYmxlIHRoYW4gY29tcHV0ZV9wb2ludCArIGdldF93aWR0aCAod2hpY2ggY2FuIHJlcG9ydFxuICAgICAgICAvLyB0aGUgY2hpbGQvY29udGVudCBzaXplIGZvciBwYWRkZWQgYnV0dG9ucykuXG4gICAgICAgIGxldCB4ID0gMCxcbiAgICAgICAgICAgIHkgPSAwLFxuICAgICAgICAgICAgd2lkdGggPSAwLFxuICAgICAgICAgICAgaGVpZ2h0ID0gMFxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcmVzID0gdy5jb21wdXRlX2JvdW5kcyhyb290KVxuICAgICAgICAgICAgY29uc3QgcmVjdCA9IEFycmF5LmlzQXJyYXkocmVzKSA/IHJlc1sxXSA6IHJlc1xuICAgICAgICAgICAgaWYgKHJlY3QpIHtcbiAgICAgICAgICAgICAgICB4ID0gcmVjdC5vcmlnaW4ueFxuICAgICAgICAgICAgICAgIHkgPSByZWN0Lm9yaWdpbi55XG4gICAgICAgICAgICAgICAgd2lkdGggPSByZWN0LnNpemUud2lkdGhcbiAgICAgICAgICAgICAgICBoZWlnaHQgPSByZWN0LnNpemUuaGVpZ2h0XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge31cbiAgICAgICAgaWYgKCF3aWR0aCkge1xuICAgICAgICAgICAgd2lkdGggPSB3LmdldF93aWR0aD8uKCkgPz8gMFxuICAgICAgICAgICAgaGVpZ2h0ID0gdy5nZXRfaGVpZ2h0Py4oKSA/PyAwXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgY2xzID0gKHcuZ2V0X2Nzc19jbGFzc2VzPy4oKSA/PyBbXSkuam9pbihcIi5cIilcbiAgICAgICAgY29uc3QgdHlwZSA9ICh3LmNvbnN0cnVjdG9yPy5uYW1lID8/IFwiP1wiKS5yZXBsYWNlKC9fL2csIFwiXCIpXG4gICAgICAgIGxldCB0ID0gXCJcIlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdCA9ICh3LmdldF9sYWJlbD8uKCkgPz8gdy5nZXRfdGV4dD8uKCkgPz8gXCJcIikudG9TdHJpbmcoKS5zbGljZSgwLCAyOClcbiAgICAgICAgfSBjYXRjaCB7fVxuICAgICAgICBvdXQucHVzaCh7XG4gICAgICAgICAgICBkOiBkZXB0aCxcbiAgICAgICAgICAgIHR5cGUsXG4gICAgICAgICAgICBjbHMsXG4gICAgICAgICAgICB4OiBNYXRoLnJvdW5kKHgpLFxuICAgICAgICAgICAgeTogTWF0aC5yb3VuZCh5KSxcbiAgICAgICAgICAgIHc6IE1hdGgucm91bmQod2lkdGgpLFxuICAgICAgICAgICAgaDogTWF0aC5yb3VuZChoZWlnaHQpLFxuICAgICAgICAgICAgdCxcbiAgICAgICAgfSlcbiAgICAgICAgbGV0IGMgPSB3LmdldF9maXJzdF9jaGlsZD8uKClcbiAgICAgICAgd2hpbGUgKGMpIHtcbiAgICAgICAgICAgIHdhbGsoYywgZGVwdGggKyAxKVxuICAgICAgICAgICAgYyA9IGMuZ2V0X25leHRfc2libGluZygpXG4gICAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgY2hpbGQgPSB3aW4uZ2V0X2NoaWxkPy4oKVxuICAgIGlmIChjaGlsZCkgd2FsayhjaGlsZCwgMClcbiAgICByZXR1cm4gb3V0XG59XG5cbi8vIFBvbGwgdW50aWwgdGhlIG5hbWVkIHdpbmRvdyBpcyB2aXNpYmxlICsgbGFpZCBvdXQsIHRoZW4gZHVtcCBvbmNlIHRvIEtPQkVMX0RVTVBfT1VULlxuZXhwb3J0IGZ1bmN0aW9uIGFybUR1bXAoZ2V0V2luZG93OiAobmFtZTogc3RyaW5nKSA9PiBHdGsuV2luZG93IHwgbnVsbCkge1xuICAgIGNvbnN0IG5hbWUgPSBHTGliLmdldGVudihcIktPQkVMX0RVTVBcIilcbiAgICBpZiAoIW5hbWUpIHJldHVyblxuICAgIGNvbnN0IHBhdGggPSBHTGliLmdldGVudihcIktPQkVMX0RVTVBfT1VUXCIpIHx8IFwiL3RtcC9rb2JlbC1kdW1wLmpzb25cIlxuICAgIGxldCBkb25lID0gZmFsc2VcbiAgICBHTGliLnRpbWVvdXRfYWRkKEdMaWIuUFJJT1JJVFlfREVGQVVMVCwgNDAwLCAoKSA9PiB7XG4gICAgICAgIGlmIChkb25lKSByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgICAgIGNvbnN0IHcgPSBnZXRXaW5kb3cobmFtZSlcbiAgICAgICAgaWYgKHcgJiYgdy5nZXRfbWFwcGVkPy4oKSAmJiAody5nZXRfd2lkdGg/LigpID8/IDApID4gMCkge1xuICAgICAgICAgICAgLy8gb25lIG1vcmUgdGljayBzbyBmaW5hbCBhbGxvY2F0aW9uIHNldHRsZXNcbiAgICAgICAgICAgIEdMaWIudGltZW91dF9hZGQoR0xpYi5QUklPUklUWV9ERUZBVUxULCAyNTAsICgpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB0cmVlID0gZHVtcFdpbmRvdyh3KVxuICAgICAgICAgICAgICAgICAgICBHTGliLmZpbGVfc2V0X2NvbnRlbnRzKHBhdGgsIEpTT04uc3RyaW5naWZ5KHRyZWUpKVxuICAgICAgICAgICAgICAgICAgICBwcmludGVycihga29iZWw6IGR1bXBlZCAke3RyZWUubGVuZ3RofSB3aWRnZXRzIG9mIFwiJHtuYW1lfVwiIFx1MjE5MiAke3BhdGh9YClcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogZHVtcCBmYWlsZWQ6ICR7ZX1gKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgZG9uZSA9IHRydWVcbiAgICAgICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gR0xpYi5TT1VSQ0VfQ09OVElOVUVcbiAgICB9KVxufVxuIiwgIi8vIEFuaW1hdGVkIHN1cmZhY2UgcmVnaXN0cnkgXHUyMDE0IHJlcGxhY2VzIEFwcC50b2dnbGVfd2luZG93IGZvciBzdXJmYWNlcyB0aGF0IHdhbnRcbi8vIGEgcmV2ZWFsIGFuaW1hdGlvbi4gRWFjaCBzdXJmYWNlIGNhbGxzIHJlZ2lzdGVyKCkgb25jZSwgdGhlbiBCYXIvYXBwLnRzIGNhbGwgdG9nZ2xlKCkuXG4vL1xuLy8gUGF0dGVybjogd2luZG93IGFsd2F5cyBzdGFydHMgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gT3BlbmluZyBtYWtlcyBpdCB2aXNpYmxlLFxuLy8gdGhlbiB0cmlnZ2VycyB0aGUgcmV2ZWFsZXI7IGNsb3NpbmcgdHJpZ2dlcnMgdGhlIHJldmVhbGVyIHRoZW4gaGlkZXMgYWZ0ZXIgdHJhbnNpdGlvbi5cbmltcG9ydCB7IEFwcCB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcblxuZXhwb3J0IHR5cGUgVHJhbnNpdGlvblR5cGUgPSBHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZVxuXG5jb25zdCByZWdpc3RyeTogUmVjb3JkPHN0cmluZywgKCkgPT4gdm9pZD4gPSB7fVxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXIobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gdm9pZCkge1xuICAgIHJlZ2lzdHJ5W25hbWVdID0gZm5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvZ2dsZShuYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAocmVnaXN0cnlbbmFtZV0pIHtcbiAgICAgICAgcmVnaXN0cnlbbmFtZV0oKVxuICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEZhbGxiYWNrIGZvciBzdXJmYWNlcyB3aXRob3V0IGFuaW1hdGVkIHJldmVhbHMgKHNlc3Npb24sIGRyYXdlcilcbiAgICAgICAgQXBwLnRvZ2dsZV93aW5kb3cobmFtZSlcbiAgICB9XG59XG5cbi8vIG1ha2VSZXZlYWw6IGNyZWF0ZXMgdGhlIHN0YXRlIHZhcmlhYmxlcyBhbmQgdG9nZ2xlIGZ1bmN0aW9uIGZvciBhbiBhbmltYXRlZCBzdXJmYWNlLlxuLy8gICAtIG9wZW5NczogcmV2ZWFsLWluIGR1cmF0aW9uIGluIG1zIChkZWZhdWx0IDIyMClcbi8vICAgLSBjbG9zZU1zOiByZXZlYWwtb3V0ICsgd2luZG93LWhpZGUgZGVsYXkgaW4gbXMgKGRlZmF1bHQgMTUwKVxuLy8gICAtIHJldmVhbGVyUmVmOiBzZXQgdGhpcyB0byB0aGUgUmV2ZWFsZXIgd2lkZ2V0IGluIGBzZXR1cGAgc28gdGhlIHRvZ2dsZSBjYW5cbi8vICAgICBkaXJlY3RseSBjb250cm9sIHRyYW5zaXRpb25EdXJhdGlvbiBwZXIgZGlyZWN0aW9uXG5leHBvcnQgZnVuY3Rpb24gbWFrZVJldmVhbChvcGVuTXMgPSAyMjAsIGNsb3NlTXMgPSAxNTApIHtcbiAgICBjb25zdCB3aW5WaXNpYmxlID0gVmFyaWFibGUoZmFsc2UpXG4gICAgY29uc3QgcmV2ZWFsZWQgPSBWYXJpYWJsZShmYWxzZSlcbiAgICBsZXQgcmV2ZWFsZXJXaWRnZXQ6IEd0ay5SZXZlYWxlciB8IG51bGwgPSBudWxsXG4gICAgbGV0IGNsb3NlVGltZXI6IGFueSA9IG51bGxcblxuICAgIGNvbnN0IHNldFJldmVhbGVyID0gKHI6IEd0ay5SZXZlYWxlcikgPT4ge1xuICAgICAgICByZXZlYWxlcldpZGdldCA9IHJcbiAgICB9XG5cbiAgICBjb25zdCBvcGVuID0gKCkgPT4ge1xuICAgICAgICBpZiAoY2xvc2VUaW1lcikge1xuICAgICAgICAgICAgY2xvc2VUaW1lci5jYW5jZWw/LigpXG4gICAgICAgICAgICBjbG9zZVRpbWVyID0gbnVsbFxuICAgICAgICB9XG4gICAgICAgIGlmIChyZXZlYWxlcldpZGdldCkgcmV2ZWFsZXJXaWRnZXQudHJhbnNpdGlvbkR1cmF0aW9uID0gb3Blbk1zXG4gICAgICAgIHdpblZpc2libGUuc2V0KHRydWUpXG4gICAgICAgIC8vIE9uZSBpZGxlIGZyYW1lIHNvIEdUSyBjYW4gcmVhbGl6ZSB0aGUgd2luZG93IGJlZm9yZSBhbmltYXRpbmdcbiAgICAgICAgdGltZW91dCgxNiwgKCkgPT4gcmV2ZWFsZWQuc2V0KHRydWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGNsb3NlID0gKCkgPT4ge1xuICAgICAgICBpZiAocmV2ZWFsZXJXaWRnZXQpIHJldmVhbGVyV2lkZ2V0LnRyYW5zaXRpb25EdXJhdGlvbiA9IGNsb3NlTXNcbiAgICAgICAgcmV2ZWFsZWQuc2V0KGZhbHNlKVxuICAgICAgICBjbG9zZVRpbWVyID0gdGltZW91dChjbG9zZU1zICsgMjAsICgpID0+IHtcbiAgICAgICAgICAgIHdpblZpc2libGUuc2V0KGZhbHNlKVxuICAgICAgICAgICAgY2xvc2VUaW1lciA9IG51bGxcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCB0b2dnbGVGbiA9ICgpID0+IChyZXZlYWxlZC5nZXQoKSA/IGNsb3NlKCkgOiBvcGVuKCkpXG5cbiAgICByZXR1cm4geyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIG9wZW4sIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH1cbn1cbiIsICIvLyBUaGUgYmFyLiBQcm90b3R5cGU6IGxhdW5jaGVyIGJ1dHRvbiBcdTAwQjcgZm9jdXNlZCB0aXRsZSBcdTAwQjcgY2VudGVyZWQgY2xvY2sgKFx1MjE5MiBjYWxlbmRhcilcbi8vIFx1MDBCNyB0cmF5IFx1MDBCNyBzdGF0dXMgcGlsbCAod2lmaS92b2wvYmF0dGVyeTsgYW1iZXIgbmV0LWdseXBoIHdoZW4gZ25vYmxpbiBpcyBkb3duKVxuLy8gXHUwMEI3IGJlbGwrYmFkZ2UgKFx1MjE5MiBkcmF3ZXIpIFx1MDBCNyBwb3dlciAoXHUyMTkyIHNlc3Npb24pLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBUcmF5IGZyb20gXCJnaTovL0FzdGFsVHJheVwiXG5pbXBvcnQgeyBjb25uZWN0ZWQsIHdpbmRvd3MgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyB0b2dnbGUgYXMgc3VyZmFjZVRvZ2dsZSB9IGZyb20gXCIuLi9saWIvc3VyZmFjZVwiXG5pbXBvcnQgeyB1bnJlYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCB0aW1lID0gVmFyaWFibGUoR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKCkpLnBvbGwoMTBfMDAwLCAoKSA9PlxuICAgIEdMaWIuRGF0ZVRpbWUubmV3X25vd19sb2NhbCgpXG4pXG5cbmZ1bmN0aW9uIEZvY3VzZWRUaXRsZSgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgIGNsYXNzPVwidGl0bGVcIlxuICAgICAgICAgICAgZWxsaXBzaXplPXszIC8qIFBhbmdvLkVsbGlwc2l6ZU1vZGUuRU5EICovfVxuICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17Mjh9XG4gICAgICAgICAgICBsYWJlbD17XG4gICAgICAgICAgICAgICAgREVNT1xuICAgICAgICAgICAgICAgICAgICA/IEQudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgOiBiaW5kKHdpbmRvd3MpLmFzKCh3cykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBmID0gd3MuZmluZCgodykgPT4gdy5mb2N1c2VkKVxuICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWYpIHJldHVybiBcImRlc2t0b3BcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBzaWJsaW5ncyA9IHdzLmZpbHRlcigodykgPT4gdy5hcHBJZCA9PT0gZi5hcHBJZClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHNpYmxpbmdzLmxlbmd0aCA+IDFcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYCR7Zi50aXRsZX0gXHUyMDE0IHdpbmRvdyAke3NpYmxpbmdzLmluZGV4T2YoZikgKyAxfS8ke3NpYmxpbmdzLmxlbmd0aH1gXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGYudGl0bGVcbiAgICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfVxuICAgICAgICAvPlxuICAgIClcbn1cblxuZnVuY3Rpb24gU3RhdHVzUGlsbCgpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgICBjb25zdCBiYXQgPSBCYXR0ZXJ5LmdldF9kZWZhdWx0KClcbiAgICAvLyBXaWZpIGljb246IHZhcmllcyB3aXRoIGNvbm5lY3Rpb24gc3RhdGUgLyB0eXBlXG4gICAgY29uc3Qgd2lmaUljb24gPSBuZXQud2lmaVxuICAgICAgICA/IGJpbmQobmV0LndpZmksIFwiZW5hYmxlZFwiKS5hcygob24pID0+XG4gICAgICAgICAgICAgIG9uID8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgOiBcImtvYmVsLXdpZmktb2ZmLXN5bWJvbGljXCJcbiAgICAgICAgICApXG4gICAgICAgIDogXCJrb2JlbC13aWZpLW9mZi1zeW1ib2xpY1wiXG4gICAgLy8gVm9sdW1lIGljb246IHRyYWNrIHRoZSBzcGVha2VyJ3Mgb3duIHZvbHVtZV9pY29uIHByb3BlcnR5XG4gICAgY29uc3Qgdm9sSWNvbiA9IHNwZWFrZXJcbiAgICAgICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoKGkpID0+IGkgPz8gXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIilcbiAgICAgICAgOiBcImtvYmVsLXNwZWFrZXItbXV0ZS1zeW1ib2xpY1wiXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgY2xhc3M9e2JpbmQoY29ubmVjdGVkKS5hcygoYykgPT4gKGMgPyBcInN0YXR1c1wiIDogXCJzdGF0dXMgZXJyXCIpKX1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcInF1aWNrc2V0dGluZ3NcIil9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBjbGFzcz1cIm5ldC1pY29uXCIgaWNvbk5hbWU9e3dpZmlJY29ufSAvPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17dm9sSWNvbn0gLz5cbiAgICAgICAgICAgICAgICB7LyogQmF0dGVyeTogb25seSByZW5kZXJlZCB3aGVuIGEgYmF0dGVyeSBpcyBwcmVzZW50ICovfVxuICAgICAgICAgICAgICAgIHsoREVNTyB8fCBiYXQpICYmIChcbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInBjdFwiIHNwYWNpbmc9ezZ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5iYXR0ZXJ5UGN0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJhdFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IGJpbmQoYmF0LCBcInBlcmNlbnRhZ2VcIikuYXMoKHApID0+IGAke01hdGgucm91bmQocCAqIDEwMCl9JWApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogXCJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBCZWxsKCkge1xuICAgIC8vIEJhZGdlIGh5ZHJhdGVzIG9uY2Ugbm90aWZkIGlzIGF2YWlsYWJsZSAoZGVmZXJyZWQgXHUyMDE0IGdldF9kZWZhdWx0KCkgY2FuIGJsb2NrIG9uIGFcbiAgICAvLyBoZWFkbGVzcy9jb250ZW5kZWQgYnVzOyBuZXZlciBjYWxsIGl0IGR1cmluZyBjb25zdHJ1Y3Rpb24pLiB1bnJlYWQoKSBpcyBhIHBsYWluXG4gICAgLy8gVmFyaWFibGUgYW4gYXN5bmMgaW5pdCBmaWxscyBpbi5cbiAgICByZXR1cm4gKFxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICBjbGFzcz1cImlidG4gYmVsbFwiXG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJkcmF3ZXJcIil9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJlbGwtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkVORH1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYmFkZ2UgdG5cIlxuICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtERU1PID8gdHJ1ZSA6IGJpbmQodW5yZWFkKS5hcygobikgPT4gbiA+IDApfVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17REVNTyA/IFwiMVwiIDogYmluZCh1bnJlYWQpLmFzKChuKSA9PiAobiA+IDkgPyBcIjkrXCIgOiBgJHtufWApKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIEJhcihtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIGNvbnN0IHsgVE9QLCBMRUZULCBSSUdIVCB9ID0gQXN0YWwuV2luZG93QW5jaG9yXG4gICAgLy8gRmxvYXRpbmcgYmFyOiBsYXllci1zaGVsbCBtYXJnaW5zIGluc2V0IGl0IGZyb20gdGhlIGVkZ2VzOyB0aGUgLmJhciBjaGlsZCBpcyB0aGVcbiAgICAvLyByb3VuZGVkIHN1cmZhY2UuIEV4Y2x1c2l2ZSBzbyB0aWxlZCB3aW5kb3dzIHJlc3BlY3QgaXQgKHpvbmUgPSBtYXJnaW4gKyBoZWlnaHQpLlxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJiYXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtYmFyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiYmFyLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIG1hcmdpblRvcD17MTB9XG4gICAgICAgICAgICBtYXJnaW5MZWZ0PXsxMn1cbiAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgIGFuY2hvcj17VE9QIHwgTEVGVCB8IFJJR0hUfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Y2VudGVyYm94IGNsYXNzPVwiYmFyXCI+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcImxhdW5jaGVyXCIpfVxuICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tYWduaWZ5aW5nLWdsYXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDxGb2N1c2VkVGl0bGUgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYmNlbnRlclwiXG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwiY2FsZW5kYXJcIil9XG4gICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJjbG9jayB0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQkFTRUxJTkV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmNsb2NrIDogYmluZCh0aW1lKS5hcygodCkgPT4gdC5mb3JtYXQoXCIlSDolTVwiKSEpfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZGF0ZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQkFTRUxJTkV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmRhdGUgOiBiaW5kKHRpbWUpLmFzKCh0KSA9PiB0LmZvcm1hdChcIiVhICUtZCAlYlwiKSEpfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICAgICAge0RFTU8gPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezF9IG1hcmdpbkVuZD17M30+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG4gdHJheS1pY29uXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD1cIkRpc2NvcmRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hhdC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG4gdHJheS1pY29uXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD1cIlN0ZWFtXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWdhbWUtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHRpcFRleHQ9XCJUZWxlZ3JhbVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wYXBlci1wbGFuZS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gdHJheS1sYW5nXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBsYWJlbD1cImVuXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgYmluZChUcmF5LmdldF9kZWZhdWx0KCksIFwiaXRlbXNcIikuYXMoKGl0ZW1zKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGl0ZW1zLm1hcCgoaXRlbSkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bWVudWJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG9vbHRpcFRleHQ9e2l0ZW0udG9vbHRpcF9tYXJrdXB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZW51TW9kZWw9e2l0ZW0ubWVudV9tb2RlbH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGdpY29uPXtiaW5kKGl0ZW0sIFwiZ2ljb25cIil9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvbWVudWJ1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApKVxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8U3RhdHVzUGlsbCAvPlxuICAgICAgICAgICAgICAgICAgICA8QmVsbCAvPlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKX1cbiAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gRGVtby1kYXRhIG1vZGUgKEtPQkVMX0RFTU89MSk6IG1ha2UgZXZlcnkgc3VyZmFjZSByZW5kZXIgdGhlIEVYQUNUIG1vY2sgdmFsdWVzIGZyb21cbi8vIGRvY3MvcHJvdG90eXBlLmh0bWwsIHNvIGFuIEFHUyByZW5kZXIgY2FuIGJlIHBpeGVsLW92ZXJsYWlkIG9uIHRoZSBwcm90b3R5cGUgcmVuZGVyXG4vLyBmb3IgYSBmYWlyIDE6MSBjb21wYXJpc29uLiBUaGlzIGlzIE5PVCBjaGVhdGluZyBcdTIwMTQgcmVhbCBHVEsgd2lkZ2V0cywgcmVhbCByZW5kZXJpbmc7XG4vLyBvbmx5IHRoZSAqY29udGVudCogaXMgcGlubmVkIHRvIHRoZSBwcm90b3R5cGUncyBzbyB0aGUgY2hyb21lIGNhbiBiZSBkaWZmZWQgZGlyZWN0bHkuXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcblxuZXhwb3J0IGNvbnN0IERFTU8gPSAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfREVNT1wiKVxuXG4vLyBWYWx1ZXMgdHJhbnNjcmliZWQgZnJvbSBwcm90b3R5cGUuaHRtbCdzIG1vY2sgc3RhdGUgKHRoZSByZWZlcmVuY2Ugc2NyZWVuc2hvdHMpLlxuZXhwb3J0IGNvbnN0IEQgPSB7XG4gICAgLy8gYmFyXG4gICAgY2xvY2s6IFwiMTQ6MjNcIixcbiAgICBkYXRlOiBcIlNhdCA0IEp1bFwiLFxuICAgIHRpdGxlOiBcIlRlcm1pbmFsIFx1MjAxNCB3aW5kb3cgMS8yXCIsXG4gICAgYmF0dGVyeVBjdDogXCIxMDAlXCIsXG4gICAgLy8gcXVpY2sgc2V0dGluZ3NcbiAgICBtZXRhOiBcIjEwMCUgXHUwMEI3IEZ1bGx5IGNoYXJnZWRcIixcbiAgICB3aWZpU3NpZDogXCJjaG9tcGVycy01R1wiLFxuICAgIGJ0RGV2aWNlOiBcIldILTEwMDBYTTVcIixcbiAgICB2b2x1bWU6IDAuNjc1LCAvLyB0cm91Z2ggNTEuLjI4NSB3aWR0aD0yMzQ7IGtub2I9KDIwOS01MSkvMjM0PTAuNjc1IFx1MjE5MiB4XHUyMjQ4MjA5IG1hdGNoZXMgcHJvdG9cbiAgICBicmlnaHRuZXNzOiAwLjgsIC8vIG1lYXN1cmVkOiBBR1MgdHJvdWdoIDJweCBuYXJyb3dlciB0aGFuIHByb3RvOyAwLjgwMCBhbGlnbnMga25vYiBjZW50ZXJcbiAgICBkYXJrOiB0cnVlLFxuICAgIHNhdmU6IGZhbHNlLFxuICAgIHNpbGVudDogZmFsc2UsXG4gICAgbmlnaHQ6IGZhbHNlLFxuICAgIC8vIGNhbGVuZGFyIFx1MjAxNCBwaW5uZWQgXCJ0b2RheVwiIHNvIHRoZSBncmlkICsgaGVybyBtYXRjaCB0aGUgcHJvdG90eXBlIGV4YWN0bHlcbiAgICB0b2RheTogeyB5OiAyMDI2LCBtOiA2IC8qIEp1bHksIDAtaW5kZXhlZCAqLywgZDogNCB9LCAvLyBTYXR1cmRheSA0IEp1bHkgMjAyNlxuICAgIC8vIGxhdW5jaGVyIHBpbm5lZCB0aWxlcyArIHRvZGF5IHdpZGdldFxuICAgIGFwcHM6IFtcIlRlcm1pbmFsXCIsIFwiRmlsZXNcIiwgXCJGaXJlZm94XCIsIFwiWmVkXCIsIFwiU3BvdGlmeVwiLCBcIlNldHRpbmdzXCJdLFxuICAgIHdpZGdldERhdGU6IFwiU2F0dXJkYXkgNCBKdWx5XCIsXG4gICAgd2lkZ2V0RXZlbnQ6IFwiMDk6NDUgXHUwMEI3IERhaWx5IFN0YW5kdXBcIixcbiAgICBtZWRpYTogeyB0aXRsZTogXCJXZWlnaHRsZXNzXCIsIGFydGlzdDogXCJNYXJjb25pIFVuaW9uXCIgfSxcbn1cbiIsICIvKiBlc2xpbnQtZGlzYWJsZSBtYXgtbGVuICovXG5pbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSBDb25zdHJ1Y3RQcm9wcywgdHlwZSBCaW5kYWJsZUNoaWxkIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuXG5mdW5jdGlvbiBmaWx0ZXIoY2hpbGRyZW46IGFueVtdKSB7XG4gICAgcmV0dXJuIGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcbn1cblxuLy8gQm94XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoQXN0YWwuQm94LnByb3RvdHlwZSwgXCJjaGlsZHJlblwiLCB7XG4gICAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfY2hpbGRyZW4oKSB9LFxuICAgIHNldCh2KSB7IHRoaXMuc2V0X2NoaWxkcmVuKHYpIH0sXG59KVxuXG5leHBvcnQgdHlwZSBCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgQm94IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuQm94KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkJveFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEJveFByb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7IHRoaXMuc2V0X2NoaWxkcmVuKGZpbHRlcihjaGlsZHJlbikpIH1cbn1cblxuLy8gQnV0dG9uXG5leHBvcnQgdHlwZSBCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEJ1dHRvbiwgQXN0YWwuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkNsaWNrZWQ6IFtdXG4gICAgb25DbGljazogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uQ2xpY2tSZWxlYXNlOiBbZXZlbnQ6IEFzdGFsLkNsaWNrRXZlbnRdXG4gICAgb25Ib3ZlcjogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uSG92ZXJMb3N0OiBbZXZlbnQ6IEFzdGFsLkhvdmVyRXZlbnRdXG4gICAgb25TY3JvbGw6IFtldmVudDogQXN0YWwuU2Nyb2xsRXZlbnRdXG59PlxuZXhwb3J0IGNsYXNzIEJ1dHRvbiBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkJ1dHRvbikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJCdXR0b25cIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBCdXR0b25Qcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIENlbnRlckJveFxuZXhwb3J0IHR5cGUgQ2VudGVyQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxDZW50ZXJCb3gsIEFzdGFsLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIENlbnRlckJveCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkNlbnRlckJveCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJDZW50ZXJCb3hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBDZW50ZXJCb3hQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQge1xuICAgICAgICBjb25zdCBjaCA9IGZpbHRlcihjaGlsZHJlbilcbiAgICAgICAgdGhpcy5zdGFydFdpZGdldCA9IGNoWzBdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIHRoaXMuY2VudGVyV2lkZ2V0ID0gY2hbMV0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgdGhpcy5lbmRXaWRnZXQgPSBjaFsyXSB8fCBuZXcgR3RrLkJveFxuICAgIH1cbn1cblxuLy8gQ2lyY3VsYXJQcm9ncmVzc1xuZXhwb3J0IHR5cGUgQ2lyY3VsYXJQcm9ncmVzc1Byb3BzID0gQ29uc3RydWN0UHJvcHM8Q2lyY3VsYXJQcm9ncmVzcywgQXN0YWwuQ2lyY3VsYXJQcm9ncmVzcy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIENpcmN1bGFyUHJvZ3Jlc3MgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5DaXJjdWxhclByb2dyZXNzKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkNpcmN1bGFyUHJvZ3Jlc3NcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBDaXJjdWxhclByb2dyZXNzUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBEcmF3aW5nQXJlYVxuZXhwb3J0IHR5cGUgRHJhd2luZ0FyZWFQcm9wcyA9IENvbnN0cnVjdFByb3BzPERyYXdpbmdBcmVhLCBHdGsuRHJhd2luZ0FyZWEuQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uRHJhdzogW2NyOiBhbnldIC8vIFRPRE86IGNhaXJvIHR5cGVzXG59PlxuZXhwb3J0IGNsYXNzIERyYXdpbmdBcmVhIGV4dGVuZHMgYXN0YWxpZnkoR3RrLkRyYXdpbmdBcmVhKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkRyYXdpbmdBcmVhXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogRHJhd2luZ0FyZWFQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gRW50cnlcbmV4cG9ydCB0eXBlIEVudHJ5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxFbnRyeSwgR3RrLkVudHJ5LkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkNoYW5nZWQ6IFtdXG4gICAgb25BY3RpdmF0ZTogW11cbn0+XG5leHBvcnQgY2xhc3MgRW50cnkgZXh0ZW5kcyBhc3RhbGlmeShHdGsuRW50cnkpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiRW50cnlcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBFbnRyeVByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBFdmVudEJveFxuZXhwb3J0IHR5cGUgRXZlbnRCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEV2ZW50Qm94LCBBc3RhbC5FdmVudEJveC5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25DbGljazogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uQ2xpY2tSZWxlYXNlOiBbZXZlbnQ6IEFzdGFsLkNsaWNrRXZlbnRdXG4gICAgb25Ib3ZlcjogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uSG92ZXJMb3N0OiBbZXZlbnQ6IEFzdGFsLkhvdmVyRXZlbnRdXG4gICAgb25TY3JvbGw6IFtldmVudDogQXN0YWwuU2Nyb2xsRXZlbnRdXG59PlxuZXhwb3J0IGNsYXNzIEV2ZW50Qm94IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuRXZlbnRCb3gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiRXZlbnRCb3hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBFdmVudEJveFByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gLy8gVE9ETzogRml4ZWRcbi8vIC8vIFRPRE86IEZsb3dCb3hcbi8vXG4vLyBJY29uXG5leHBvcnQgdHlwZSBJY29uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxJY29uLCBBc3RhbC5JY29uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgSWNvbiBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkljb24pIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiSWNvblwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEljb25Qcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gTGFiZWxcbmV4cG9ydCB0eXBlIExhYmVsUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxMYWJlbCwgQXN0YWwuTGFiZWwuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBMYWJlbCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkxhYmVsKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkxhYmVsXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogTGFiZWxQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7IHRoaXMubGFiZWwgPSBTdHJpbmcoY2hpbGRyZW4pIH1cbn1cblxuLy8gTGV2ZWxCYXJcbmV4cG9ydCB0eXBlIExldmVsQmFyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxMZXZlbEJhciwgQXN0YWwuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBMZXZlbEJhciBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkxldmVsQmFyKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkxldmVsQmFyXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogTGV2ZWxCYXJQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gVE9ETzogTGlzdEJveFxuXG4vLyBNZW51QnV0dG9uXG5leHBvcnQgdHlwZSBNZW51QnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxNZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIE1lbnVCdXR0b24gZXh0ZW5kcyBhc3RhbGlmeShHdGsuTWVudUJ1dHRvbikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJNZW51QnV0dG9uXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogTWVudUJ1dHRvblByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gT3ZlcmxheVxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLk92ZXJsYXkucHJvdG90eXBlLCBcIm92ZXJsYXlzXCIsIHtcbiAgICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9vdmVybGF5cygpIH0sXG4gICAgc2V0KHYpIHsgdGhpcy5zZXRfb3ZlcmxheXModikgfSxcbn0pXG5cbmV4cG9ydCB0eXBlIE92ZXJsYXlQcm9wcyA9IENvbnN0cnVjdFByb3BzPE92ZXJsYXksIEFzdGFsLk92ZXJsYXkuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBPdmVybGF5IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuT3ZlcmxheSkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJPdmVybGF5XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogT3ZlcmxheVByb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IFtjaGlsZCwgLi4ub3ZlcmxheXNdID0gZmlsdGVyKGNoaWxkcmVuKVxuICAgICAgICB0aGlzLnNldF9jaGlsZChjaGlsZClcbiAgICAgICAgdGhpcy5zZXRfb3ZlcmxheXMob3ZlcmxheXMpXG4gICAgfVxufVxuXG4vLyBSZXZlYWxlclxuZXhwb3J0IHR5cGUgUmV2ZWFsZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPFJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBSZXZlYWxlciBleHRlbmRzIGFzdGFsaWZ5KEd0ay5SZXZlYWxlcikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJSZXZlYWxlclwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFJldmVhbGVyUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBTY3JvbGxhYmxlXG5leHBvcnQgdHlwZSBTY3JvbGxhYmxlUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxTY3JvbGxhYmxlLCBBc3RhbC5TY3JvbGxhYmxlLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgU2Nyb2xsYWJsZSBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLlNjcm9sbGFibGUpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU2Nyb2xsYWJsZVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFNjcm9sbGFibGVQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIFNsaWRlclxuZXhwb3J0IHR5cGUgU2xpZGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxTbGlkZXIsIEFzdGFsLlNsaWRlci5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25EcmFnZ2VkOiBbXVxufT5cbmV4cG9ydCBjbGFzcyBTbGlkZXIgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5TbGlkZXIpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU2xpZGVyXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogU2xpZGVyUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIFN0YWNrXG5leHBvcnQgdHlwZSBTdGFja1Byb3BzID0gQ29uc3RydWN0UHJvcHM8U3RhY2ssIEFzdGFsLlN0YWNrLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgU3RhY2sgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5TdGFjaykge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJTdGFja1wiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFN0YWNrUHJvcHMsIC4uLmNoaWxkcmVuOiBBcnJheTxCaW5kYWJsZUNoaWxkPikgeyBzdXBlcih7IGNoaWxkcmVuLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHsgdGhpcy5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfVxufVxuXG4vLyBTd2l0Y2hcbmV4cG9ydCB0eXBlIFN3aXRjaFByb3BzID0gQ29uc3RydWN0UHJvcHM8U3dpdGNoLCBHdGsuU3dpdGNoLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgU3dpdGNoIGV4dGVuZHMgYXN0YWxpZnkoR3RrLlN3aXRjaCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJTd2l0Y2hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTd2l0Y2hQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gV2luZG93XG5leHBvcnQgdHlwZSBXaW5kb3dQcm9wcyA9IENvbnN0cnVjdFByb3BzPFdpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgV2luZG93IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuV2luZG93KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIldpbmRvd1wiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFdpbmRvd1Byb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cbiIsICJpbXBvcnQgeyBob29rLCBub0ltcGxpY2l0RGVzdHJveSwgc2V0Q2hpbGRyZW4sIG1lcmdlQmluZGluZ3MsIHR5cGUgQmluZGFibGVQcm9wcywgY29uc3RydWN0IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5pbXBvcnQgQmluZGluZywgeyB0eXBlIENvbm5lY3RhYmxlLCB0eXBlIFN1YnNjcmliYWJsZSB9IGZyb20gXCIuLi9iaW5kaW5nLmpzXCJcblxuZXhwb3J0IHsgQmluZGFibGVQcm9wcywgbWVyZ2VCaW5kaW5ncyB9XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFzdGFsaWZ5PFxuICAgIEMgZXh0ZW5kcyB7IG5ldyguLi5hcmdzOiBhbnlbXSk6IEd0ay5XaWRnZXQgfSxcbj4oY2xzOiBDLCBjbHNOYW1lID0gY2xzLm5hbWUpIHtcbiAgICBjbGFzcyBXaWRnZXQgZXh0ZW5kcyBjbHMge1xuICAgICAgICBnZXQgY3NzKCk6IHN0cmluZyB7IHJldHVybiBBc3RhbC53aWRnZXRfZ2V0X2Nzcyh0aGlzKSB9XG4gICAgICAgIHNldCBjc3MoY3NzOiBzdHJpbmcpIHsgQXN0YWwud2lkZ2V0X3NldF9jc3ModGhpcywgY3NzKSB9XG4gICAgICAgIGdldF9jc3MoKTogc3RyaW5nIHsgcmV0dXJuIHRoaXMuY3NzIH1cbiAgICAgICAgc2V0X2Nzcyhjc3M6IHN0cmluZykgeyB0aGlzLmNzcyA9IGNzcyB9XG5cbiAgICAgICAgZ2V0IGNsYXNzTmFtZSgpOiBzdHJpbmcgeyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jbGFzc19uYW1lcyh0aGlzKS5qb2luKFwiIFwiKSB9XG4gICAgICAgIHNldCBjbGFzc05hbWUoY2xhc3NOYW1lOiBzdHJpbmcpIHsgQXN0YWwud2lkZ2V0X3NldF9jbGFzc19uYW1lcyh0aGlzLCBjbGFzc05hbWUuc3BsaXQoL1xccysvKSkgfVxuICAgICAgICBnZXRfY2xhc3NfbmFtZSgpOiBzdHJpbmcgeyByZXR1cm4gdGhpcy5jbGFzc05hbWUgfVxuICAgICAgICBzZXRfY2xhc3NfbmFtZShjbGFzc05hbWU6IHN0cmluZykgeyB0aGlzLmNsYXNzTmFtZSA9IGNsYXNzTmFtZSB9XG5cbiAgICAgICAgZ2V0IGN1cnNvcigpOiBDdXJzb3IgeyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jdXJzb3IodGhpcykgYXMgQ3Vyc29yIH1cbiAgICAgICAgc2V0IGN1cnNvcihjdXJzb3I6IEN1cnNvcikgeyBBc3RhbC53aWRnZXRfc2V0X2N1cnNvcih0aGlzLCBjdXJzb3IpIH1cbiAgICAgICAgZ2V0X2N1cnNvcigpOiBDdXJzb3IgeyByZXR1cm4gdGhpcy5jdXJzb3IgfVxuICAgICAgICBzZXRfY3Vyc29yKGN1cnNvcjogQ3Vyc29yKSB7IHRoaXMuY3Vyc29yID0gY3Vyc29yIH1cblxuICAgICAgICBnZXQgY2xpY2tUaHJvdWdoKCk6IGJvb2xlYW4geyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jbGlja190aHJvdWdoKHRoaXMpIH1cbiAgICAgICAgc2V0IGNsaWNrVGhyb3VnaChjbGlja1Rocm91Z2g6IGJvb2xlYW4pIHsgQXN0YWwud2lkZ2V0X3NldF9jbGlja190aHJvdWdoKHRoaXMsIGNsaWNrVGhyb3VnaCkgfVxuICAgICAgICBnZXRfY2xpY2tfdGhyb3VnaCgpOiBib29sZWFuIHsgcmV0dXJuIHRoaXMuY2xpY2tUaHJvdWdoIH1cbiAgICAgICAgc2V0X2NsaWNrX3Rocm91Z2goY2xpY2tUaHJvdWdoOiBib29sZWFuKSB7IHRoaXMuY2xpY2tUaHJvdWdoID0gY2xpY2tUaHJvdWdoIH1cblxuICAgICAgICBkZWNsYXJlIHByaXZhdGUgW25vSW1wbGljaXREZXN0cm95XTogYm9vbGVhblxuICAgICAgICBnZXQgbm9JbXBsaWNpdERlc3Ryb3koKTogYm9vbGVhbiB7IHJldHVybiB0aGlzW25vSW1wbGljaXREZXN0cm95XSB9XG4gICAgICAgIHNldCBub0ltcGxpY2l0RGVzdHJveSh2YWx1ZTogYm9vbGVhbikgeyB0aGlzW25vSW1wbGljaXREZXN0cm95XSA9IHZhbHVlIH1cblxuICAgICAgICBzZXQgYWN0aW9uR3JvdXAoW3ByZWZpeCwgZ3JvdXBdOiBBY3Rpb25Hcm91cCkgeyB0aGlzLmluc2VydF9hY3Rpb25fZ3JvdXAocHJlZml4LCBncm91cCkgfVxuICAgICAgICBzZXRfYWN0aW9uX2dyb3VwKGFjdGlvbkdyb3VwOiBBY3Rpb25Hcm91cCkgeyB0aGlzLmFjdGlvbkdyb3VwID0gYWN0aW9uR3JvdXAgfVxuXG4gICAgICAgIHByb3RlY3RlZCBnZXRDaGlsZHJlbigpOiBBcnJheTxHdGsuV2lkZ2V0PiB7XG4gICAgICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIEd0ay5CaW4pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRfY2hpbGQoKSA/IFt0aGlzLmdldF9jaGlsZCgpIV0gOiBbXVxuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkNvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldF9jaGlsZHJlbigpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW11cbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICAgICAgICAgID8gY2hcbiAgICAgICAgICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcblxuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBjaCBvZiBjaGlsZHJlbilcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGQoY2gpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IEVycm9yKGBjYW4gbm90IGFkZCBjaGlsZHJlbiB0byAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgW3NldENoaWxkcmVuXShjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBjaCBvZiB0aGlzLmdldENoaWxkcmVuKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZW1vdmUoY2gpXG4gICAgICAgICAgICAgICAgICAgIGlmICghY2hpbGRyZW4uaW5jbHVkZXMoY2gpICYmICF0aGlzLm5vSW1wbGljaXREZXN0cm95KVxuICAgICAgICAgICAgICAgICAgICAgICAgY2g/LmRlc3Ryb3koKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gYXBwZW5kXG4gICAgICAgICAgICB0aGlzLnNldENoaWxkcmVuKGNoaWxkcmVuKVxuICAgICAgICB9XG5cbiAgICAgICAgdG9nZ2xlQ2xhc3NOYW1lKGNuOiBzdHJpbmcsIGNvbmQgPSB0cnVlKSB7XG4gICAgICAgICAgICBBc3RhbC53aWRnZXRfdG9nZ2xlX2NsYXNzX25hbWUodGhpcywgY24sIGNvbmQpXG4gICAgICAgIH1cblxuICAgICAgICBob29rKFxuICAgICAgICAgICAgb2JqZWN0OiBDb25uZWN0YWJsZSxcbiAgICAgICAgICAgIHNpZ25hbDogc3RyaW5nLFxuICAgICAgICAgICAgY2FsbGJhY2s6IChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgICAgICAgKTogdGhpc1xuICAgICAgICBob29rKFxuICAgICAgICAgICAgb2JqZWN0OiBTdWJzY3JpYmFibGUsXG4gICAgICAgICAgICBjYWxsYmFjazogKHNlbGY6IHRoaXMsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuICAgICAgICApOiB0aGlzXG4gICAgICAgIGhvb2soXG4gICAgICAgICAgICBvYmplY3Q6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlLFxuICAgICAgICAgICAgc2lnbmFsT3JDYWxsYmFjazogc3RyaW5nIHwgKChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCksXG4gICAgICAgICAgICBjYWxsYmFjaz86IChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgICAgICAgKSB7XG4gICAgICAgICAgICBob29rKHRoaXMsIG9iamVjdCwgc2lnbmFsT3JDYWxsYmFjaywgY2FsbGJhY2spXG4gICAgICAgICAgICByZXR1cm4gdGhpc1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3RydWN0b3IoLi4ucGFyYW1zOiBhbnlbXSkge1xuICAgICAgICAgICAgc3VwZXIoKVxuICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBwYXJhbXNbMF0gfHwge31cbiAgICAgICAgICAgIHByb3BzLnZpc2libGUgPz89IHRydWVcbiAgICAgICAgICAgIGNvbnN0cnVjdCh0aGlzLCBwcm9wcylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7XG4gICAgICAgIEdUeXBlTmFtZTogYEFzdGFsXyR7Y2xzTmFtZX1gLFxuICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICBcImNsYXNzLW5hbWVcIjogR09iamVjdC5QYXJhbVNwZWMuc3RyaW5nKFxuICAgICAgICAgICAgICAgIFwiY2xhc3MtbmFtZVwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBcIlwiLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwiY3NzXCI6IEdPYmplY3QuUGFyYW1TcGVjLnN0cmluZyhcbiAgICAgICAgICAgICAgICBcImNzc1wiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBcIlwiLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwiY3Vyc29yXCI6IEdPYmplY3QuUGFyYW1TcGVjLnN0cmluZyhcbiAgICAgICAgICAgICAgICBcImN1cnNvclwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBcImRlZmF1bHRcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcImNsaWNrLXRocm91Z2hcIjogR09iamVjdC5QYXJhbVNwZWMuYm9vbGVhbihcbiAgICAgICAgICAgICAgICBcImNsaWNrLXRocm91Z2hcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgZmFsc2UsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgXCJuby1pbXBsaWNpdC1kZXN0cm95XCI6IEdPYmplY3QuUGFyYW1TcGVjLmJvb2xlYW4oXG4gICAgICAgICAgICAgICAgXCJuby1pbXBsaWNpdC1kZXN0cm95XCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIGZhbHNlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICB9LCBXaWRnZXQpXG5cbiAgICByZXR1cm4gV2lkZ2V0XG59XG5cbnR5cGUgU2lnSGFuZGxlcjxcbiAgICBXIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBBcmdzIGV4dGVuZHMgQXJyYXk8dW5rbm93bj4sXG4+ID0gKChzZWxmOiBXLCAuLi5hcmdzOiBBcmdzKSA9PiB1bmtub3duKSB8IHN0cmluZyB8IHN0cmluZ1tdXG5cbmV4cG9ydCB0eXBlIEJpbmRhYmxlQ2hpbGQgPSBHdGsuV2lkZ2V0IHwgQmluZGluZzxHdGsuV2lkZ2V0PlxuXG5leHBvcnQgdHlwZSBDb25zdHJ1Y3RQcm9wczxcbiAgICBTZWxmIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBQcm9wcyBleHRlbmRzIEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyxcbiAgICBTaWduYWxzIGV4dGVuZHMgUmVjb3JkPGBvbiR7c3RyaW5nfWAsIEFycmF5PHVua25vd24+PiA9IFJlY29yZDxgb24ke3N0cmluZ31gLCBhbnlbXT4sXG4+ID0gUGFydGlhbDx7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjYW4ndCBhc3NpZ24gdG8gdW5rbm93biwgYnV0IGl0IHdvcmtzIGFzIGV4cGVjdGVkIHRob3VnaFxuICAgIFtTIGluIGtleW9mIFNpZ25hbHNdOiBTaWdIYW5kbGVyPFNlbGYsIFNpZ25hbHNbU10+XG59PiAmIFBhcnRpYWw8e1xuICAgIFtLZXkgaW4gYG9uJHtzdHJpbmd9YF06IFNpZ0hhbmRsZXI8U2VsZiwgYW55W10+XG59PiAmIEJpbmRhYmxlUHJvcHM8UGFydGlhbDxQcm9wcyAmIHtcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgICBjc3M/OiBzdHJpbmdcbiAgICBjdXJzb3I/OiBzdHJpbmdcbiAgICBjbGlja1Rocm91Z2g/OiBib29sZWFuXG4gICAgYWN0aW9uR3JvdXA/OiBBY3Rpb25Hcm91cFxufT4+ICYgUGFydGlhbDx7XG4gICAgb25EZXN0cm95OiAoc2VsZjogU2VsZikgPT4gdW5rbm93blxuICAgIG9uRHJhdzogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBvbktleVByZXNzRXZlbnQ6IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB1bmtub3duXG4gICAgb25LZXlSZWxlYXNlRXZlbnQ6IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB1bmtub3duXG4gICAgb25CdXR0b25QcmVzc0V2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uQnV0dG9uUmVsZWFzZUV2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uUmVhbGl6ZTogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBzZXR1cDogKHNlbGY6IFNlbGYpID0+IHZvaWRcbn0+XG5cbnR5cGUgQ3Vyc29yID1cbiAgICB8IFwiZGVmYXVsdFwiXG4gICAgfCBcImhlbHBcIlxuICAgIHwgXCJwb2ludGVyXCJcbiAgICB8IFwiY29udGV4dC1tZW51XCJcbiAgICB8IFwicHJvZ3Jlc3NcIlxuICAgIHwgXCJ3YWl0XCJcbiAgICB8IFwiY2VsbFwiXG4gICAgfCBcImNyb3NzaGFpclwiXG4gICAgfCBcInRleHRcIlxuICAgIHwgXCJ2ZXJ0aWNhbC10ZXh0XCJcbiAgICB8IFwiYWxpYXNcIlxuICAgIHwgXCJjb3B5XCJcbiAgICB8IFwibm8tZHJvcFwiXG4gICAgfCBcIm1vdmVcIlxuICAgIHwgXCJub3QtYWxsb3dlZFwiXG4gICAgfCBcImdyYWJcIlxuICAgIHwgXCJncmFiYmluZ1wiXG4gICAgfCBcImFsbC1zY3JvbGxcIlxuICAgIHwgXCJjb2wtcmVzaXplXCJcbiAgICB8IFwicm93LXJlc2l6ZVwiXG4gICAgfCBcIm4tcmVzaXplXCJcbiAgICB8IFwiZS1yZXNpemVcIlxuICAgIHwgXCJzLXJlc2l6ZVwiXG4gICAgfCBcInctcmVzaXplXCJcbiAgICB8IFwibmUtcmVzaXplXCJcbiAgICB8IFwibnctcmVzaXplXCJcbiAgICB8IFwic3ctcmVzaXplXCJcbiAgICB8IFwic2UtcmVzaXplXCJcbiAgICB8IFwiZXctcmVzaXplXCJcbiAgICB8IFwibnMtcmVzaXplXCJcbiAgICB8IFwibmVzdy1yZXNpemVcIlxuICAgIHwgXCJud3NlLXJlc2l6ZVwiXG4gICAgfCBcInpvb20taW5cIlxuICAgIHwgXCJ6b29tLW91dFwiXG5cbnR5cGUgQWN0aW9uR3JvdXAgPSBbcHJlZml4OiBzdHJpbmcsIGFjdGlvbkdyb3VwOiBHaW8uQWN0aW9uR3JvdXBdXG4iLCAiaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IHsgdHlwZSBCaW5kYWJsZUNoaWxkIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuaW1wb3J0IHsgbWVyZ2VCaW5kaW5ncywganN4IGFzIF9qc3ggfSBmcm9tIFwiLi4vX2FzdGFsLmpzXCJcbmltcG9ydCAqIGFzIFdpZGdldCBmcm9tIFwiLi93aWRnZXQuanNcIlxuXG5leHBvcnQgZnVuY3Rpb24gRnJhZ21lbnQoeyBjaGlsZHJlbiA9IFtdLCBjaGlsZCB9OiB7XG4gICAgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkXG4gICAgY2hpbGRyZW4/OiBBcnJheTxCaW5kYWJsZUNoaWxkPlxufSkge1xuICAgIGlmIChjaGlsZCkgY2hpbGRyZW4ucHVzaChjaGlsZClcbiAgICByZXR1cm4gbWVyZ2VCaW5kaW5ncyhjaGlsZHJlbilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yOiBrZXlvZiB0eXBlb2YgY3RvcnMgfCB0eXBlb2YgR3RrLldpZGdldCxcbiAgICBwcm9wczogYW55LFxuKSB7XG4gICAgcmV0dXJuIF9qc3goY3RvcnMsIGN0b3IgYXMgYW55LCBwcm9wcylcbn1cblxuY29uc3QgY3RvcnMgPSB7XG4gICAgYm94OiBXaWRnZXQuQm94LFxuICAgIGJ1dHRvbjogV2lkZ2V0LkJ1dHRvbixcbiAgICBjZW50ZXJib3g6IFdpZGdldC5DZW50ZXJCb3gsXG4gICAgY2lyY3VsYXJwcm9ncmVzczogV2lkZ2V0LkNpcmN1bGFyUHJvZ3Jlc3MsXG4gICAgZHJhd2luZ2FyZWE6IFdpZGdldC5EcmF3aW5nQXJlYSxcbiAgICBlbnRyeTogV2lkZ2V0LkVudHJ5LFxuICAgIGV2ZW50Ym94OiBXaWRnZXQuRXZlbnRCb3gsXG4gICAgLy8gVE9ETzogZml4ZWRcbiAgICAvLyBUT0RPOiBmbG93Ym94XG4gICAgaWNvbjogV2lkZ2V0Lkljb24sXG4gICAgbGFiZWw6IFdpZGdldC5MYWJlbCxcbiAgICBsZXZlbGJhcjogV2lkZ2V0LkxldmVsQmFyLFxuICAgIC8vIFRPRE86IGxpc3Rib3hcbiAgICBtZW51YnV0dG9uOiBXaWRnZXQuTWVudUJ1dHRvbixcbiAgICBvdmVybGF5OiBXaWRnZXQuT3ZlcmxheSxcbiAgICByZXZlYWxlcjogV2lkZ2V0LlJldmVhbGVyLFxuICAgIHNjcm9sbGFibGU6IFdpZGdldC5TY3JvbGxhYmxlLFxuICAgIHNsaWRlcjogV2lkZ2V0LlNsaWRlcixcbiAgICBzdGFjazogV2lkZ2V0LlN0YWNrLFxuICAgIHN3aXRjaDogV2lkZ2V0LlN3aXRjaCxcbiAgICB3aW5kb3c6IFdpZGdldC5XaW5kb3csXG59XG5cbmRlY2xhcmUgZ2xvYmFsIHtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5hbWVzcGFjZVxuICAgIG5hbWVzcGFjZSBKU1gge1xuICAgICAgICB0eXBlIEVsZW1lbnQgPSBHdGsuV2lkZ2V0XG4gICAgICAgIHR5cGUgRWxlbWVudENsYXNzID0gR3RrLldpZGdldFxuICAgICAgICBpbnRlcmZhY2UgSW50cmluc2ljRWxlbWVudHMge1xuICAgICAgICAgICAgYm94OiBXaWRnZXQuQm94UHJvcHNcbiAgICAgICAgICAgIGJ1dHRvbjogV2lkZ2V0LkJ1dHRvblByb3BzXG4gICAgICAgICAgICBjZW50ZXJib3g6IFdpZGdldC5DZW50ZXJCb3hQcm9wc1xuICAgICAgICAgICAgY2lyY3VsYXJwcm9ncmVzczogV2lkZ2V0LkNpcmN1bGFyUHJvZ3Jlc3NQcm9wc1xuICAgICAgICAgICAgZHJhd2luZ2FyZWE6IFdpZGdldC5EcmF3aW5nQXJlYVByb3BzXG4gICAgICAgICAgICBlbnRyeTogV2lkZ2V0LkVudHJ5UHJvcHNcbiAgICAgICAgICAgIGV2ZW50Ym94OiBXaWRnZXQuRXZlbnRCb3hQcm9wc1xuICAgICAgICAgICAgLy8gVE9ETzogZml4ZWRcbiAgICAgICAgICAgIC8vIFRPRE86IGZsb3dib3hcbiAgICAgICAgICAgIGljb246IFdpZGdldC5JY29uUHJvcHNcbiAgICAgICAgICAgIGxhYmVsOiBXaWRnZXQuTGFiZWxQcm9wc1xuICAgICAgICAgICAgbGV2ZWxiYXI6IFdpZGdldC5MZXZlbEJhclByb3BzXG4gICAgICAgICAgICAvLyBUT0RPOiBsaXN0Ym94XG4gICAgICAgICAgICBtZW51YnV0dG9uOiBXaWRnZXQuTWVudUJ1dHRvblByb3BzXG4gICAgICAgICAgICBvdmVybGF5OiBXaWRnZXQuT3ZlcmxheVByb3BzXG4gICAgICAgICAgICByZXZlYWxlcjogV2lkZ2V0LlJldmVhbGVyUHJvcHNcbiAgICAgICAgICAgIHNjcm9sbGFibGU6IFdpZGdldC5TY3JvbGxhYmxlUHJvcHNcbiAgICAgICAgICAgIHNsaWRlcjogV2lkZ2V0LlNsaWRlclByb3BzXG4gICAgICAgICAgICBzdGFjazogV2lkZ2V0LlN0YWNrUHJvcHNcbiAgICAgICAgICAgIHN3aXRjaDogV2lkZ2V0LlN3aXRjaFByb3BzXG4gICAgICAgICAgICB3aW5kb3c6IFdpZGdldC5XaW5kb3dQcm9wc1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QganN4cyA9IGpzeFxuIiwgIi8vIFRoZSBkb2NrLiBCZWhhdmlvciBtb2RlbCAocHJvdG90eXBlLWZpbmFsKTpcbi8vICAgY2xpY2sgIFx1MjAxNCBubyB3aW5kb3dzOiBsYXVuY2ggKGdob3N0IHpvb20pIFx1MDBCNyB1bmZvY3VzZWQ6IGZvY3VzIHRvcCB3aW5kb3cgKHB1bHNlKVxuLy8gICAgICAgICAgICBmb2N1c2VkICsgbXVsdGk6IGN5Y2xlIFx1MDBCNyBmb2N1c2VkICsgc2luZ2xlOiBtaW5pbWl6ZVxuLy8gICBzY3JvbGwgXHUyMDE0IHNpbmdsZTogZm9jdXMgXHUwMEI3IG11bHRpOiBjeWNsZSAoY2Fyb3VzZWwgbnVkZ2UsIHN0YW5kYXJkIGRpcmVjdGlvbilcbi8vICAgbWlkZGxlLWNsaWNrIFx1MjAxNCBuZXcgd2luZG93IFx1MDBCNyByaWdodC1jbGljayBcdTIwMTQgY29udGV4dCBtZW51ICh3aW5kb3dzIGxpc3QgKyBRdWl0KVxuLy8gRE9UUzogYWJzb2x1dGUgb3ZlcmxheSAoR3RrLk92ZXJsYXkpLCBzbGlkaW5nIDQtZG90IHZpZXdwb3J0LCBlZGdlIG1pbmlzIHBhc3QgNCxcbi8vIGR5aW5nLWRvdCBjbG9zZSBhbmltYXRpb24uIEljb25zIG93biBBTEwgZ2VvbWV0cnkuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IGJpbmQsIFZhcmlhYmxlLCBleGVjQXN5bmMgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEFwcHMgZnJvbSBcImdpOi8vQXN0YWxBcHBzXCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcbmltcG9ydCB7IE1PVElPTiwgc3ByaW5nLCBzcHJpbmdUbyB9IGZyb20gXCIuLi9saWIvc3ByaW5nXCJcbmltcG9ydCAqIGFzIGdub2JsaW4gZnJvbSBcIi4uL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0IHsgREVNTyB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbmNvbnN0IFBJTk5FRCA9IFtcbiAgICBcIm9yZy5nbm9tZS5QdHl4aXNcIixcbiAgICBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiLFxuICAgIFwiZmlyZWZveFwiLFxuICAgIFwiZGV2LnplZC5aZWRcIixcbiAgICBcImNvbS5zcG90aWZ5LkNsaWVudFwiLFxuICAgIFwib3JnLmdub21lLlNldHRpbmdzXCIsXG5dXG5cbmZ1bmN0aW9uIERvdHMoeyBhcHBJZCB9OiB7IGFwcElkOiBzdHJpbmcgfSkge1xuICAgIC8vIFNsaWRpbmcgdmlld3BvcnQgaWRlbnRpY2FsIHRvIHRoZSBwcm90b3R5cGU6IFx1MjI2NDQgZG90cywgZm9jdXNlZCBwaWxsLFxuICAgIC8vIG1pbmlzIHdoZW4gd2luZG93cyBleGlzdCBiZXlvbmQgdGhlIHZpc2libGUgc2xpY2UuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImRvdHNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkVORH0gc3BhY2luZz17M30+XG4gICAgICAgICAgICB7YmluZChnbm9ibGluLndpbmRvd3MpLmFzKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB3cyA9IGdub2JsaW4uYXBwV2luZG93cyhhcHBJZClcbiAgICAgICAgICAgICAgICBjb25zdCB0b3RhbCA9IHdzLmxlbmd0aFxuICAgICAgICAgICAgICAgIGNvbnN0IG4gPSBNYXRoLm1pbih0b3RhbCwgNClcbiAgICAgICAgICAgICAgICBjb25zdCBjdXIgPSB3cy5maW5kSW5kZXgoKHcpID0+IHcuZm9jdXNlZClcbiAgICAgICAgICAgICAgICBsZXQgc3RhcnQgPSAwXG4gICAgICAgICAgICAgICAgaWYgKHRvdGFsID4gNCkgc3RhcnQgPSBNYXRoLm1pbihNYXRoLm1heCgoY3VyIDwgMCA/IDAgOiBjdXIpIC0gMSwgMCksIHRvdGFsIC0gNClcbiAgICAgICAgICAgICAgICByZXR1cm4gQXJyYXkuZnJvbSh7IGxlbmd0aDogbiB9LCAoXywgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBpZHggPSBzdGFydCArIGlcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2xzID0gW1wiZG90XCJdXG4gICAgICAgICAgICAgICAgICAgIGlmIChjdXIgPj0gMCAmJiBpZHggPT09IGN1cikgY2xzLnB1c2goXCJvblwiKVxuICAgICAgICAgICAgICAgICAgICBpZiAodG90YWwgPiA0ICYmICgoaSA9PT0gMCAmJiBzdGFydCA+IDApIHx8IChpID09PSBuIC0gMSAmJiBzdGFydCArIDQgPCB0b3RhbCkpKVxuICAgICAgICAgICAgICAgICAgICAgICAgY2xzLnB1c2goXCJtaW5pXCIpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiA8Ym94IGNsYXNzPXtjbHMuam9pbihcIiBcIil9IC8+XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIERvY2tCdXR0b24oeyBhcHAgfTogeyBhcHA6IEFwcHMuQXBwbGljYXRpb24gfSkge1xuICAgIGNvbnN0IGFwcElkID0gYXBwLmVudHJ5LnJlcGxhY2UoL1xcLmRlc2t0b3AkLywgXCJcIilcblxuICAgIGNvbnN0IG9uQ2xpY2sgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICBpZiAoIXdzLmxlbmd0aCkgcmV0dXJuIHZvaWQgYXBwLmxhdW5jaCgpIC8vICsgZ2hvc3Qgem9vbSAocmV2ZWFsZXIgc2NhbGUgYW5pbSlcbiAgICAgICAgY29uc3QgZm9jdXNlZCA9IHdzLmZpbmQoKHcpID0+IHcuZm9jdXNlZClcbiAgICAgICAgaWYgKCFmb2N1c2VkKVxuICAgICAgICAgICAgcmV0dXJuIHZvaWQgZ25vYmxpbi5hY3RpdmF0ZShcbiAgICAgICAgICAgICAgICB3cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmZvY3VzZWQpIC0gTnVtYmVyKGEuZm9jdXNlZCkpWzBdLmlkXG4gICAgICAgICAgICApXG4gICAgICAgIGlmICh3cy5sZW5ndGggPiAxKSByZXR1cm4gdm9pZCBnbm9ibGluLmN5Y2xlKGFwcElkLCAxKVxuICAgICAgICBnbm9ibGluLm1pbmltaXplKGZvY3VzZWQuaWQpXG4gICAgfVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJkYnRuXCJcbiAgICAgICAgICAgIHRvb2x0aXBUZXh0PXthcHAubmFtZX1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17b25DbGlja31cbiAgICAgICAgICAgIG9uQnV0dG9uUHJlc3NlZD17KF93LCBlKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gbWlkZGxlLWNsaWNrIFx1MjE5MiBuZXcgd2luZG93XG4gICAgICAgICAgICAgICAgaWYgKGUuZ2V0X2J1dHRvbigpID09PSBHZGsuQlVUVE9OX01JRERMRSkgYXBwLmxhdW5jaCgpXG4gICAgICAgICAgICB9fVxuICAgICAgICAgICAgb25TY3JvbGw9eyhfdywgX2R4LCBkeSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICAgICAgICAgIGlmICghd3MubGVuZ3RoKSByZXR1cm5cbiAgICAgICAgICAgICAgICBpZiAod3MubGVuZ3RoID4gMSkgZ25vYmxpbi5jeWNsZShhcHBJZCwgZHkgPiAwID8gMSA6IC0xKVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKCF3c1swXS5mb2N1c2VkKSBnbm9ibGluLmFjdGl2YXRlKHdzWzBdLmlkKVxuICAgICAgICAgICAgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2FwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIn1cbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIHsvKiBkb3RzIGFzIE9WRVJMQVkgXHUyMDE0IHplcm8gbGF5b3V0IGZvb3RwcmludCAqL31cbiAgICAgICAgICAgICAgICA8RG90cyB0eXBlPVwib3ZlcmxheVwiIGFwcElkPXthcHBJZH0gLz5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBNZWRpYVdpZGdldCgpIHtcbiAgICBjb25zdCBtcHJpcyA9IE1wcmlzLmdldF9kZWZhdWx0KClcbiAgICAvLyBQaWNrIHRoZSBmaXJzdCBhY3RpdmUgcGxheWVyLCBvciBudWxsIGlmIG5vdGhpbmcgaXMgcGxheWluZ1xuICAgIGNvbnN0IHBsYXllciA9IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcyhcbiAgICAgICAgKHBzKSA9PiBwcy5maW5kKChwKSA9PiBwLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORykgPz8gcHNbMF0gPz8gbnVsbFxuICAgIClcbiAgICBjb25zdCBwcm9ncmVzcyA9IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgY29uc3QgcCA9IHBzLmZpbmQoKHEpID0+IHEucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXVxuICAgICAgICBpZiAoIXAgfHwgIXAubGVuZ3RoIHx8IHAubGVuZ3RoIDw9IDApIHJldHVybiAwXG4gICAgICAgIHJldHVybiBwLnBvc2l0aW9uIC8gcC5sZW5ndGhcbiAgICB9KVxuICAgIGNvbnN0IGljb24gPSBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgIGNvbnN0IHAgPSBwcy5maW5kKChxKSA9PiBxLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORykgPz8gcHNbMF1cbiAgICAgICAgaWYgKCFwKSByZXR1cm4gXCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgIHJldHVybiBwLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCJcbiAgICAgICAgICAgIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuIGR3aWRnZXRcIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkdGlsZVwiPlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZGdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2ljb259XG4gICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezE4fVxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgdmV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhclxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibXByb2dcIlxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkVORH1cbiAgICAgICAgICAgICAgICAgICAgdmFsdWU9e3Byb2dyZXNzfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgIClcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBERU1PIG1vZGU6IHJlbmRlciB0aGUgcHJvdG90eXBlJ3MgRVhBQ1QgZG9jayAoZG9jcy9wcm90b3R5cGUuaHRtbCkgd2l0aCByZWFsIEdUS1xuLy8gd2lkZ2V0cywgc28gaXQgY2FuIGJlIHBpeGVsLW92ZXJsYWlkIG9uIHRoZSBwcm90b3R5cGUgcmVuZGVyIDE6MS4gSWNvbnMgbG9hZCBmcm9tIHRoZVxuLy8gU0FNRSBvbi1kaXNrIGZpbGVzIHRoZSBwcm90b3R5cGUgcmVmZXJlbmNlcyAodmlhIGEgRmlsZUljb24gZ2ljb24pIHJhdGhlciB0aGFuIGJ5XG4vLyB0aGVtZWQgbmFtZSBcdTIwMTQgYSB0aGVtZWQgbG9va3VwIHNuYXBzIHRvIGEgZGlmZmVyZW50IHNpemUgdmFyaWFudCAoZS5nLiB0aGUgMzJweCBmaXJlZm94XG4vLyBpbnN0ZWFkIG9mIHRoZSBwcm90b3R5cGUncyAyNTZweCBwbmcpIGFuZCBkb3duc2NhbGVzIGRpZmZlcmVudGx5LiBTYW1lIHNvdXJjZSBmaWxlIFx1MjE5MlxuLy8gY2xvc2VzdCBjcm9zcy1lbmdpbmUgbWF0Y2guIChwaXhlbC1zaXplIGlzIGhvbm91cmVkIG5vdyB0aGUgaWNvbi10aWxlIG1pbiBpcyAzMC4pXG5jb25zdCBERU1PX0FQUFMgPSBbXG4gICAge1xuICAgICAgICBuYW1lOiBcIlRlcm1pbmFsXCIsXG4gICAgICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlB0eXhpcy5zdmdcIixcbiAgICAgICAgZG90czogW1wib25cIiwgXCJkb3RcIl0sXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiRmlsZXNcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuTmF1dGlsdXMuc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtcImRvdFwiXSxcbiAgICB9LFxuICAgIHsgbmFtZTogXCJGaXJlZm94XCIsIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yLzI1NngyNTYvYXBwcy9maXJlZm94LnBuZ1wiLCBkb3RzOiBbXSB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJaZWRcIixcbiAgICAgICAgaWNvbjogXCIvaG9tZS9raWVyYW4vLmxvY2FsL3plZC5hcHAvc2hhcmUvaWNvbnMvaGljb2xvci81MTJ4NTEyL2FwcHMvemVkLnBuZ1wiLFxuICAgICAgICBkb3RzOiBbXSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJTcG90aWZ5XCIsXG4gICAgICAgIGljb246IFwiL3Zhci9saWIvZmxhdHBhay9leHBvcnRzL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9jb20uc3BvdGlmeS5DbGllbnQuc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlNldHRpbmdzXCIsXG4gICAgICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlNldHRpbmdzLnN2Z1wiLFxuICAgICAgICBkb3RzOiBbXSxcbiAgICB9LFxuXVxuXG5mdW5jdGlvbiBmaWxlSWNvbihwYXRoOiBzdHJpbmcpOiBHaW8uSWNvbiB7XG4gICAgcmV0dXJuIEdpby5GaWxlSWNvbi5uZXcoR2lvLkZpbGUubmV3X2Zvcl9wYXRoKHBhdGgpKVxufVxuXG5mdW5jdGlvbiBEZW1vQnV0dG9uKHsgYXBwIH06IHsgYXBwOiAodHlwZW9mIERFTU9fQVBQUylbbnVtYmVyXSB9KSB7XG4gICAgLy8gTkI6IHRoZSBkb3RzIGJveCBjYXJyaWVzIGB0eXBlPVwib3ZlcmxheVwiYCBESVJFQ1RMWSAoaW50cmluc2ljIGVsZW1lbnQpIFx1MjAxNCBhIGZ1bmN0aW9uXG4gICAgLy8gY29tcG9uZW50IHdvdWxkIHN3YWxsb3cgdGhlIHByb3AsIGxldHRpbmcgdGhlIHVudHlwZWQgYm94IHJlcGxhY2UgdGhlIGljb24gYXMgdGhlXG4gICAgLy8gb3ZlcmxheSdzIG1haW4gY2hpbGQgKEd0a092ZXJsYXkuc2V0X2NoaWxkKS4gSWNvbiBzdGF5cyBtYWluOyBkb3RzIG92ZXJsYXkgb24gdG9wLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuXCIgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfT5cbiAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImljb24tdGlsZVwiXG4gICAgICAgICAgICAgICAgICAgIGdpY29uPXtmaWxlSWNvbihhcHAuaWNvbil9XG4gICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZG90c1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXszfVxuICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAge2FwcC5kb3RzLm1hcCgoY2xzKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPXtjbHMgPT09IFwib25cIiA/IFwiZG90IG9uXCIgOiBcImRvdFwifSAvPlxuICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBEZW1vRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkb2NrXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIlxuICAgICAgICAgICAgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzBdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzFdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzJdfSAvPlxuICAgICAgICAgICAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzNdfSAvPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNF19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNV19IC8+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICA8TWVkaWFXaWRnZXQgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIERvY2sobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoREVNTykgcmV0dXJuIERlbW9Eb2NrKG1vbml0b3IpXG5cbiAgICBjb25zdCBhcHBzID0gbmV3IEFwcHMuQXBwcygpXG4gICAgLy8gUGlubmVkIGVudHJpZXMgcmVzb2x2ZWQgYnkgZGVza3RvcC1pZDsgdGhlIGRvY2sgbmV2ZXIgc2l0cyBlbXB0eSwgc28gZmlsbCBhbnlcbiAgICAvLyB1bnJlc29sdmVkIHNsb3RzIChlLmcuIGFuIGFwcCBub3QgaW5zdGFsbGVkIGluIHRoZSBkZXZraXQpIGZyb20gdGhlIGluc3RhbGxlZFxuICAgIC8vIGxpc3QuIE9uIHJlYWwgaGFyZHdhcmUgdGhlIHBpbnMgcmVzb2x2ZSBhbmQgdGhlIGZpbGwgaXMgdW51c2VkLlxuICAgIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICAgIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZCkgPz9cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgICAvLyBBbHdheXMgcmVuZGVyIG9uZSBzbG90IHBlciBwaW4gc28gdGhlIGRvY2sga2VlcHMgaXRzIHNoYXBlOyByZXNvbHZlZCBwaW5zIGdldCB0aGVcbiAgICAvLyByZWFsIGFwcCArIGJlaGF2aW9yLCB1bnJlc29sdmVkIG9uZXMgYSBsYWJlbGxlZCBwbGFjZWhvbGRlciB0aWxlLiBBIHNlcGFyYXRvciBzaXRzXG4gICAgLy8gYmV0d2VlbiB0aGUgZm91cnRoIGFuZCBmaWZ0aCBwaW5zIChwcm90b3R5cGUgcGFyaXR5KSwgdGhlbiBiZWZvcmUgdGhlIG1lZGlhIHdpZGdldC5cbiAgICBjb25zdCBzbG90cyA9IFBJTk5FRC5tYXAoKGlkKSA9PiAoeyBpZCwgYXBwOiByZXNvbHZlKGlkKSB9KSlcbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwiZG9ja1wiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1kb2NrXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZG9jay13aW5kb3dcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cImRvY2tcIiBzcGFjaW5nPXs0fT5cbiAgICAgICAgICAgICAgICB7c2xvdHMubWFwKCh7IGlkLCBhcHAgfSwgaSkgPT4gW1xuICAgICAgICAgICAgICAgICAgICBpID09PSA0ID8gPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz4gOiBudWxsLFxuICAgICAgICAgICAgICAgICAgICBhcHAgPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8RG9ja0J1dHRvbiBhcHA9e2FwcH0gLz5cbiAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkYnRuIHBsYWNlaG9sZGVyXCIgdG9vbHRpcFRleHQ9e2lkLnNwbGl0KFwiLlwiKS5wb3AoKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9XCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGUtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgICBdKX1cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBUaGUgc3BvdGxpZ2h0LiBQcm90b3R5cGUtZmluYWwgYmVoYXZpb3I6XG4vLyAgIFN1cGVyIHJlbGVhc2Ugb3BlbnMgKGNvbXBvc2l0b3Iga2V5YmluZCBcdTIxOTIgYGFzdGFsIC1pIGtvYmVsIC10IGxhdW5jaGVyYClcbi8vICAgZnV6enkgKyBsZWFmIGhpZ2hsaWdodCBcdTAwQjcgZ2xvYmFsIEJFU1QtTUFUQ0ggc2xvdCAoc2NvcmUtcmFua2VkIGFjcm9zcyBwcm92aWRlcnMsXG4vLyAgIHR5cGUgd2VpZ2h0cyBhcHBzIDEgLyBhY3Rpb25zIC45NSAvIGZpbGVzIC45KSBcdTAwQjcgY2FwcGVkIGxvZzIgZnJlY2VuY3lcbi8vICAgZ2hvc3QgYXV0b2NvbXBsZXRlID0gZmlyc3QgcHJlZml4LWNvbXBsZXRhYmxlIG5hbWUgaW4gZGlzcGxheSBvcmRlclxuLy8gICBUYWIgYWx3YXlzIG93bmVkIChnaG9zdCBlbHNlIG5leHQ7IFNoaWZ0K1RhYiBwcmV2KSBcdTAwQjcgQ3RybCtOL1AgXHUwMEI3IEVzYyBjbGVhcnMgZmlyc3Rcbi8vICAgc2VjdGlvbnM6IGJlc3QgbWF0Y2ggLyBhcHBzIC8gYWN0aW9ucyAvIGZpbGVzIC8gd2ViIChhbHdheXMtbGFzdCByZWFsIHJvdylcbi8vICAgJz0nIGNhbGN1bGF0b3IgXHUwMEI3ICc6JyBnbm9ibGluY3RsIGNvbW1hbmRzIFx1MDBCNyBlbXB0eSBzdGF0ZTogZG9jay10aWxlIGdyaWQgKyB3aWRnZXRzXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIsIHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgeyBmdXp6eSwgaGwsIGJvb3N0LCBidW1wLCBmcmVxdWVuY3kgfSBmcm9tIFwiLi4vbGliL2Z1enp5XCJcbmltcG9ydCB7IEVWRU5UUyB9IGZyb20gXCIuL0NhbGVuZGFyXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG4vLyBDdXJhdGVkIGdyaWQ6IHRoZSBkb2NrJ3MgcGlubmVkIGFwcHMgZmlyc3QgKHJlc29sdmVkIGJ5IGRlc2t0b3AtaWQpLCB0aGVuIGZpbGwgdGhlXG4vLyByZW1haW5pbmcgc2xvdHMgYnkgZnJlY2VuY3kuIE1hdGNoZXMgdGhlIHByb3RvdHlwZSdzIGxhdW5jaGVyIGVtcHR5LXN0YXRlLlxuY29uc3QgUElOTkVEID0gW1xuICAgIFwib3JnLmdub21lLlB0eXhpc1wiLFxuICAgIFwib3JnLmdub21lLk5hdXRpbHVzXCIsXG4gICAgXCJmaXJlZm94XCIsXG4gICAgXCJkZXYuemVkLlplZFwiLFxuICAgIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsXG4gICAgXCJvcmcuZ25vbWUuU2V0dGluZ3NcIixcbl1cbi8vIERlbW8gZ3JpZDogZml4ZWQgb3JkZXIgKyBsYWJlbHMgdHJhbnNjcmliZWQgZnJvbSB0aGUgcHJvdG90eXBlIChELmFwcHMpLCBlYWNoIG1hcHBlZFxuLy8gdG8gdGhlIHJlYWwgLmRlc2t0b3AgaWQgc28gaXRzIHRoZW1lZCBpY29uIHJlbmRlcnMgKFB0eXhpcy9OYXV0aWx1cy9cdTIwMjYpLlxuY29uc3QgREVNT19USUxFUyA9IFtcbiAgICB7IG5hbWU6IFwiVGVybWluYWxcIiwgaWQ6IFwib3JnLmdub21lLlB0eXhpc1wiIH0sXG4gICAgeyBuYW1lOiBcIkZpbGVzXCIsIGlkOiBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiIH0sXG4gICAgeyBuYW1lOiBcIkZpcmVmb3hcIiwgaWQ6IFwiZmlyZWZveFwiIH0sXG4gICAgeyBuYW1lOiBcIlplZFwiLCBpZDogXCJkZXYuemVkLlplZFwiIH0sXG4gICAgeyBuYW1lOiBcIlNwb3RpZnlcIiwgaWQ6IFwiY29tLnNwb3RpZnkuQ2xpZW50XCIgfSxcbiAgICB7IG5hbWU6IFwiU2V0dGluZ3NcIiwgaWQ6IFwib3JnLmdub21lLlNldHRpbmdzXCIgfSxcbl1cblxuaW50ZXJmYWNlIFRpbGUge1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIGljb25OYW1lOiBzdHJpbmdcbiAgICBsYXVuY2g6ICgpID0+IHZvaWRcbn1cbmZ1bmN0aW9uIGdyaWRUaWxlcyhhcHBzOiBBcHBzLkFwcHMpOiBUaWxlW10ge1xuICAgIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICAgIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZCkgPz9cbiAgICAgICAgYWxsLmZpbmQoKGEpID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgICBjb25zdCBmcm9tQXBwID0gKGFwcDogQXBwcy5BcHBsaWNhdGlvbik6IFRpbGUgPT4gKHtcbiAgICAgICAgbmFtZTogYXBwLm5hbWUsXG4gICAgICAgIGljb25OYW1lOiBhcHAuaWNvbl9uYW1lIHx8IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgIGxhdW5jaDogKCkgPT4ge1xuICAgICAgICAgICAgYnVtcChhcHAubmFtZSlcbiAgICAgICAgICAgIGFwcC5sYXVuY2goKVxuICAgICAgICB9LFxuICAgIH0pXG4gICAgaWYgKERFTU8pXG4gICAgICAgIHJldHVybiBERU1PX1RJTEVTLm1hcCgoeyBuYW1lLCBpZCB9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSByZXNvbHZlKGlkKVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgICAgIGljb25OYW1lOiBhcHA/Lmljb25fbmFtZSB8fCBpZCB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICAgICAgICAgIGxhdW5jaDogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBidW1wKG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIGFwcD8ubGF1bmNoKClcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIGNvbnN0IHBpbm5lZCA9IFBJTk5FRC5tYXAocmVzb2x2ZSkuZmlsdGVyKEJvb2xlYW4pIGFzIEFwcHMuQXBwbGljYXRpb25bXVxuICAgIGNvbnN0IHJlc3QgPSBhbGxcbiAgICAgICAgLmZpbHRlcigoYSkgPT4gIXBpbm5lZC5pbmNsdWRlcyhhKSlcbiAgICAgICAgLnNvcnQoKHgsIHkpID0+IGZyZXF1ZW5jeSh5Lm5hbWUpIC0gZnJlcXVlbmN5KHgubmFtZSkpXG4gICAgcmV0dXJuIFsuLi5waW5uZWQsIC4uLnJlc3RdLnNsaWNlKDAsIDYpLm1hcChmcm9tQXBwKVxufVxuZnVuY3Rpb24gdG9kYXlFdmVudExhYmVsKCk6IHN0cmluZyB7XG4gICAgaWYgKERFTU8pIHJldHVybiBELndpZGdldEV2ZW50XG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKClcbiAgICBjb25zdCBldnMgPSBFVkVOVFNbYCR7ZC5nZXRGdWxsWWVhcigpfS0ke2QuZ2V0TW9udGgoKSArIDF9LSR7ZC5nZXREYXRlKCl9YF0gPz8gW11cbiAgICByZXR1cm4gZXZzLmxlbmd0aCA/IGAke2V2c1swXS50fSBcdTAwQjcgJHtldnNbMF0ubn1gIDogXCJObyBldmVudHMgdG9kYXlcIlxufVxuZnVuY3Rpb24gdG9kYXlEYXRlTGFiZWwoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gREVNT1xuICAgICAgICA/IEQud2lkZ2V0RGF0ZVxuICAgICAgICA6IG5ldyBEYXRlKCkudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwgeyB3ZWVrZGF5OiBcImxvbmdcIiwgZGF5OiBcIm51bWVyaWNcIiwgbW9udGg6IFwibG9uZ1wiIH0pXG59XG5cbmludGVyZmFjZSBSb3cge1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIGhpbnQ6IHN0cmluZ1xuICAgIHNjb3JlOiBudW1iZXJcbiAgICBtYXJrdXA6IHN0cmluZ1xuICAgIHJ1bjogKCkgPT4gdm9pZFxufVxuXG5jb25zdCBBQ1RJT05TID0gW1xuICAgIHtcbiAgICAgICAgbjogXCJTdXNwZW5kXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbW9vbi1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlNsZWVwIFx1MjAxNCByZXN1bWUgaW5zdGFudGx5XCIsXG4gICAgICAgIGFsOiBbXCJzbGVlcFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgc3VzcGVuZFwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJMb2NrXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIkxvY2sgdGhlIHNlc3Npb25cIixcbiAgICAgICAgYWw6IFtcImxvY2sgc2NyZWVuXCJdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJMb2cgT3V0XCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiRW5kIHRoaXMgc2Vzc2lvblwiLFxuICAgICAgICBhbDogW1wiZXhpdFwiLCBcInNpZ24gb3V0XCIsIFwibG9nb3V0XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlJlc3RhcnRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJSZWJvb3QgdGhlIG1hY2hpbmVcIixcbiAgICAgICAgYWw6IFtcInJlYm9vdFwiXSxcbiAgICAgICAgcnVuOiAoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbjogXCJTaHV0IERvd25cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlBvd2VyIG9mZlwiLFxuICAgICAgICBhbDogW1wicG93ZXJvZmZcIiwgXCJoYWx0XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlNvZnQtcmVsb2FkIGdub2JsaW5cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJSZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIixcbiAgICAgICAgYWw6IFtdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImdub2JsaW5jdGwgcmVsb2FkXCIpLFxuICAgIH0sXG5dXG5cbmNvbnN0IENNRFMgPSBbXG4gICAgeyBjOiBcInJlbG9hZFwiLCBkOiBcIlNvZnQtcmVsb2FkIHRoZSBzaGVsbCBcdTIwMTQgd2luZG93cyBzdXJ2aXZlXCIgfSxcbiAgICB7IGM6IFwib3NkIG9mZlwiLCBkOiBcImtvYmVsIG93bnMgdm9sdW1lL2JyaWdodG5lc3MgcG9wdXBzXCIgfSxcbiAgICB7IGM6IFwibm90aWZzIG9mZlwiLCBkOiBcIlJlbGVhc2Ugb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnNcIiB9LFxuICAgIHsgYzogXCJncmFudHNcIiwgZDogXCJTY3JlZW4tcmVjb3JkaW5nIGFjY2VzcyBwZXIgYXBwXCIgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTGF1bmNoZXIoKSB7XG4gICAgY29uc3QgYXBwcyA9IG5ldyBBcHBzLkFwcHMoKVxuICAgIC8vIEtPQkVMX1FVRVJZIHByZS1maWxscyB0aGUgc2VhcmNoIHNvIHRoZSBkZXZraXQgY2FuIHJlbmRlciB0aGUgcmVzdWx0cyBzdGF0ZS5cbiAgICBjb25zdCBxdWVyeSA9IFZhcmlhYmxlKEdMaWIuZ2V0ZW52KFwiS09CRUxfUVVFUllcIikgfHwgXCJcIilcbiAgICBjb25zdCBzZWxlY3RlZCA9IFZhcmlhYmxlKDApXG4gICAgY29uc3QgZ2hvc3QgPSBWYXJpYWJsZShcIlwiKVxuXG4gICAgZnVuY3Rpb24gcmVzdWx0cyhxOiBzdHJpbmcpOiB7IHNlY3Rpb246IHN0cmluZzsgcm93czogUm93W10gfVtdIHtcbiAgICAgICAgY29uc3QgcXQgPSBxLnRyaW0oKVxuICAgICAgICBpZiAoIXF0KSByZXR1cm4gW11cbiAgICAgICAgaWYgKHF0LnN0YXJ0c1dpdGgoXCI6XCIpKSB7XG4gICAgICAgICAgICBjb25zdCBjcSA9IHF0LnNsaWNlKDEpLnRyaW0oKVxuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHNlY3Rpb246IFwiZ25vYmxpbmN0bFwiLFxuICAgICAgICAgICAgICAgICAgICByb3dzOiBDTURTLmZpbHRlcigoYykgPT4gYy5jLnN0YXJ0c1dpdGgoY3EpKS5tYXAoKGMpID0+ICh7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBgOiR7Yy5jfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLXRlcm1pbmFsLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICBoaW50OiBjLmQsXG4gICAgICAgICAgICAgICAgICAgICAgICBzY29yZTogOTksXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGA6JHtjLmN9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKGBnbm9ibGluY3RsICR7Yy5jfWApLFxuICAgICAgICAgICAgICAgICAgICB9KSksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvdXQ6IHsgc2VjdGlvbjogc3RyaW5nOyByb3dzOiBSb3dbXSB9W10gPSBbXVxuICAgICAgICAvLyAnPScgY2FsY3VsYXRvciAoY2hhcnNldC1ndWFyZGVkLCBzYW1lIGFzIHByb3RvdHlwZSlcbiAgICAgICAgaWYgKC9ePT9bMC05K1xcLSovKCkuIF0rJC8udGVzdChxdCkgJiYgL1swLTldLy50ZXN0KHF0KSAmJiAvWytcXC0qL10vLnRlc3QocXQpKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHYgPSBGdW5jdGlvbihgXCJ1c2Ugc3RyaWN0XCI7cmV0dXJuKCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0pYCkoKVxuICAgICAgICAgICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUodikpXG4gICAgICAgICAgICAgICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlY3Rpb246IFwiY2FsY3VsYXRvclwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgcm93czogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogU3RyaW5nKHYpLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLWNhbGN1bGF0b3Itc3ltYm9saWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGludDogYCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0gPWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNjb3JlOiA5OCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBTdHJpbmcodiksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcIndsLWNvcHlcIiwgU3RyaW5nKHYpXSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYXBwUm93czogUm93W10gPSBhcHBzXG4gICAgICAgICAgICAuZnV6enlfcXVlcnkocXQpXG4gICAgICAgICAgICAuc2xpY2UoMCwgNSlcbiAgICAgICAgICAgIC5tYXAoKGEpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtID0gZnV6enkocXQsIGEubmFtZSkgPz8geyBzY29yZTogMSwgbWFya3M6IG51bGwgYXMgYW55IH1cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBhLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIGljb246IGEuaWNvbl9uYW1lID8/IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgICAgICAgICAgICAgIGhpbnQ6IFwiQXBwbGljYXRpb25cIixcbiAgICAgICAgICAgICAgICAgICAgc2NvcmU6IG0uc2NvcmUgKyBib29zdChhLm5hbWUpLFxuICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGhsKGEubmFtZSwgbS5tYXJrcyksXG4gICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgYnVtcChhLm5hbWUpXG4gICAgICAgICAgICAgICAgICAgICAgICBhLmxhdW5jaCgpXG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgY29uc3QgYWN0Um93czogUm93W10gPSBBQ1RJT05TLm1hcCgoeCkgPT4ge1xuICAgICAgICAgICAgbGV0IG0gPSBmdXp6eShxdCwgeC5uKVxuICAgICAgICAgICAgaWYgKCFtKVxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYWwgb2YgeC5hbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBhbSA9IGZ1enp5KHF0LCBhbClcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtID0geyBzY29yZTogYW0uc2NvcmUgLSAwLjUsIG1hcmtzOiBudWxsIGFzIGFueSB9XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIG1cbiAgICAgICAgICAgICAgICA/ICh7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogeC5uLFxuICAgICAgICAgICAgICAgICAgICAgIGljb246IHguaWNvbixcbiAgICAgICAgICAgICAgICAgICAgICBoaW50OiB4LmQsXG4gICAgICAgICAgICAgICAgICAgICAgc2NvcmU6IG0uc2NvcmUgKiAwLjk1LFxuICAgICAgICAgICAgICAgICAgICAgIG1hcmt1cDogaGwoeC5uLCAobSBhcyBhbnkpLm1hcmtzKSxcbiAgICAgICAgICAgICAgICAgICAgICBydW46IHgucnVuLFxuICAgICAgICAgICAgICAgICAgfSBhcyBSb3cpXG4gICAgICAgICAgICAgICAgOiBudWxsXG4gICAgICAgIH0pLmZpbHRlcihCb29sZWFuKSBhcyBSb3dbXVxuICAgICAgICAvLyBnbG9iYWwgYmVzdC1tYXRjaCBzbG90IChjcml0aXF1ZSBBMSlcbiAgICAgICAgY29uc3QgYWxsID0gWy4uLmFwcFJvd3MsIC4uLmFjdFJvd3NdLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKVxuICAgICAgICBjb25zdCBiZXN0ID0gYWxsWzBdXG4gICAgICAgIGlmIChiZXN0KSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYmVzdCBtYXRjaFwiLCByb3dzOiBbYmVzdF0gfSlcbiAgICAgICAgY29uc3QgcmVzdCA9IChyb3dzOiBSb3dbXSkgPT4gcm93cy5maWx0ZXIoKHIpID0+IHIgIT09IGJlc3QpXG4gICAgICAgIGlmIChyZXN0KGFwcFJvd3MpLmxlbmd0aCkgb3V0LnB1c2goeyBzZWN0aW9uOiBcImFwcHNcIiwgcm93czogcmVzdChhcHBSb3dzKSB9KVxuICAgICAgICBpZiAocmVzdChhY3RSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhY3Rpb25zXCIsIHJvd3M6IHJlc3QoYWN0Um93cykuc2xpY2UoMCwgMykgfSlcbiAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgc2VjdGlvbjogXCJ3ZWJcIixcbiAgICAgICAgICAgIHJvd3M6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICAgICAgICAgICAgICBpY29uOiBcImtvYmVsLWdsb2JlLXN5bWJvbGljXCIsXG4gICAgICAgICAgICAgICAgICAgIGhpbnQ6IFwiXCIsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiAwLFxuICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICAgICAgICAgICAgICBydW46ICgpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBleGVjQXN5bmMoW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwieGRnLW9wZW5cIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgaHR0cHM6Ly9kdWNrZHVja2dvLmNvbS8/cT0ke2VuY29kZVVSSUNvbXBvbmVudChxdCl9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIF0pLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICB9KVxuICAgICAgICAvLyBnaG9zdCA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXIgKGNyaXRpcXVlIEE0KVxuICAgICAgICBjb25zdCBnID0gb3V0XG4gICAgICAgICAgICAuZmxhdE1hcCgocykgPT4gcy5yb3dzKVxuICAgICAgICAgICAgLm1hcCgocikgPT4gci5uYW1lKVxuICAgICAgICAgICAgLmZpbmQoKG4pID0+IG4udG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHF0LnRvTG93ZXJDYXNlKCkpICYmIG4ubGVuZ3RoID4gcXQubGVuZ3RoKVxuICAgICAgICBnaG9zdC5zZXQoZyA/PyBcIlwiKVxuICAgICAgICByZXR1cm4gb3V0XG4gICAgfVxuXG4gICAgY29uc3Qgc2VjdGlvbnMgPSBiaW5kKHF1ZXJ5KS5hcyhyZXN1bHRzKVxuXG4gICAgY29uc3Qge1xuICAgICAgICB3aW5WaXNpYmxlLFxuICAgICAgICByZXZlYWxlZDogbGF1bmNoUmV2ZWFsZWQsXG4gICAgICAgIHNldFJldmVhbGVyOiBzZXRMYXVuY2hSZXZlYWxlcixcbiAgICAgICAgY2xvc2U6IGxhdW5jaENsb3NlLFxuICAgICAgICB0b2dnbGU6IHRvZ2dsZUZuLFxuICAgIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwibGF1bmNoZXJcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImxhdW5jaGVyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWxhdW5jaGVyXCJcbiAgICAgICAgICAgIGNsYXNzPVwibGF1bmNoZXItd2luZG93XCJcbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUH1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX1cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5LCBfY29kZSwgbW9kcykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZsYXQgPSByZXN1bHRzKHF1ZXJ5LmdldCgpKS5mbGF0TWFwKChzKSA9PiBzLnJvd3MpXG4gICAgICAgICAgICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHF1ZXJ5LmdldCgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoXCJcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1RhYikge1xuICAgICAgICAgICAgICAgICAgICAvLyBUYWIgaXMgQUxXQVlTIG93bmVkXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGcgPSBnaG9zdC5nZXQoKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHEgPSBxdWVyeS5nZXQoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoZyAmJiAhKG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLlNISUZUX01BU0spKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoZylcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KFxuICAgICAgICAgICAgICAgICAgICAgICAgKHNlbGVjdGVkLmdldCgpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSyA/IC0xIDogMSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZsYXQubGVuZ3RoKSAlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICBtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5DT05UUk9MX01BU0sgJiZcbiAgICAgICAgICAgICAgICAgICAgKGtleSA9PT0gR2RrLktFWV9uIHx8IGtleSA9PT0gR2RrLktFWV9wKVxuICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoXG4gICAgICAgICAgICAgICAgICAgICAgICAoc2VsZWN0ZWQuZ2V0KCkgKyAoa2V5ID09PSBHZGsuS0VZX24gPyAxIDogLTEpICsgZmxhdC5sZW5ndGgpICVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0Rvd24pIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArIDEpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1VwKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgLSAxICsgZmxhdC5sZW5ndGgpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1JldHVybikge1xuICAgICAgICAgICAgICAgICAgICBmbGF0W3NlbGVjdGVkLmdldCgpXT8ucnVuKClcbiAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICBxdWVyeS5zZXQoXCJcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8cmV2ZWFsZXJcbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChsYXVuY2hSZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldExhdW5jaFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzaGVldCBsYXVuY2hlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZmllbGRcIiBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tYWduaWZ5aW5nLWdsYXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxvdmVybGF5IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGVudHJ5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2V0dXA9eyhzZWxmOiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuc2V0X21heF93aWR0aF9jaGFycygxKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXRfd2lkdGhfY2hhcnMoMSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dD17YmluZChxdWVyeSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5VGV4dD17KGUpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChlLnRleHQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoMClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBwbGFjZWhvbGRlciBhcyBhbiBPVkVSTEFZIGxhYmVsIChub3QgZW50cnkgcGxhY2Vob2xkZXJUZXh0KSBzbyBpdHMgdGV4dFxuICAgICAgICAgICAgICB3aWR0aCBjYW4ndCBpbmZsYXRlIHRoZSBlbnRyeSdzIG5hdHVyYWwgc2l6ZSBcdTIxOTIgcGFuZWwgc3RheXMgYXQgbWluLXdpZHRoICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibHBsYWNlaG9sZGVyXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQocXVlcnkpLmFzKChxKSA9PiAhcSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiU2VhcmNoIFx1MjAxNCBhcHBzLCBmaWxlcywgYWN0aW9ucyBcdTAwQjcgJzonIGNtZHMgXHUwMEI3ICc9JyBtYXRoc1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZT1cIm92ZXJsYXlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImdob3N0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlTWFya3VwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGdob3N0KS5hcygoZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWcgfHwgIXEgfHwgIWcudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHEudG9Mb3dlckNhc2UoKSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGVzYyA9IChzOiBzdHJpbmcpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGludmlzaWJsZSBwcmVmaXggKHRha2VzIHVwIHNwYWNlKSArIGRpbSBzdWZmaXgsIG1hdGNoaW5nXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBwcm90b3R5cGUncyAjbGctcHJle3Zpc2liaWxpdHk6aGlkZGVufSAvICNsZy1zdWZ7Y29sb3I6ZGltfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGA8c3BhbiBhbHBoYT1cIjBcIj4ke2VzYyhnLnNsaWNlKDAsIHEubGVuZ3RoKSl9PC9zcGFuPjxzcGFuIGNvbG9yPVwiIzhkODY5M1wiPiR7ZXNjKGcuc2xpY2UocS5sZW5ndGgpKX08L3NwYW4+YFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwia2JkXCIgbGFiZWw9XCJzdXBlclwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG5cbiAgICAgICAgICAgICAgICAgICAgey8qIGVtcHR5IHN0YXRlOiBjdXJhdGVkIGZyZWNlbmN5IHRpbGUgZ3JpZCArIHdpZGdldCByb3cgKi99XG4gICAgICAgICAgICAgICAgICAgIDxyZXZlYWxlciByZXZlYWxDaGlsZD17YmluZChxdWVyeSkuYXMoKHEpID0+ICFxLnRyaW0oKSl9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwidGlsZXNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezZ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7Z3JpZFRpbGVzKGFwcHMpLm1hcCgodCkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidGlsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHQubGF1bmNoKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGF1bmNoQ2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXs4fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPXt0Lmljb25OYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17dC5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17OX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogdHdvIGNhcmRzIHNwbGl0IHRoZSByb3cgZXhhY3RseSBpbiBoYWxmIFx1MjAxNCBwcm90byBmbGV4OjEvZmxleDoxICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsd2lkZ2V0c1wiIHNwYWNpbmc9ezd9IGhvbW9nZW5lb3VzPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogbGVmdCBjYXJkIFx1MjAxNCBkYXRlICsgdG9kYXkncyBmaXJzdCBldmVudCAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ3aWRnZXQgbHdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXt0b2RheURhdGVMYWJlbCgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3RvZGF5RXZlbnRMYWJlbCgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiByaWdodCBjYXJkIFx1MjAxNCBtZWRpYSBtaW5pLWNhcmQ6IGFydCBcdTAwQjcgdGl0bGUvYXJ0aXN0IFx1MDBCNyBwbGF5ICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYWN0aXZlUGxheWVyID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHMuZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHAucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwc1swXSA/P1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBudWxsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZWRpYVRpdGxlID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5tZWRpYS50aXRsZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHAgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHEpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcS5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHA/LnRpdGxlID8/IFwiTm90aGluZyBwbGF5aW5nXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBtZWRpYUFydGlzdCA9IERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IEQubWVkaWEuYXJ0aXN0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8uYXJ0aXN0ID8/IFwiXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwbGF5SWNvbiA9IERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGxheS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8ucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJ3aWRnZXQgbHdtXCIgaGV4cGFuZCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsd2FydFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibHd0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibXRpdGxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e21lZGlhVGl0bGV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJoaW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e21lZGlhQXJ0aXN0fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibWJ0biBwbGF5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHBsYXktcGF1c2VcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17cGxheUljb259IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSgpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG5cbiAgICAgICAgICAgICAgICAgICAgey8qIHJlc3VsdHMgKi99XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJscm93c1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAge3NlY3Rpb25zLmFzKChzZWNzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlY3MuZmxhdE1hcCgoc2VjKSA9PiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInNlY1wiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17c2VjLnNlY3Rpb259IC8+LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuLi5zZWMucm93cy5tYXAoKHIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGZsYXRJZHggPSBzZWNzLmZsYXRNYXAoKHMpID0+IHMucm93cykuaW5kZXhPZihyKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtiaW5kKHNlbGVjdGVkKS5hcygocykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHMgPT09IGZsYXRJZHggPyBcInJvdyBzZWxcIiA6IFwicm93XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByLnJ1bigpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezExfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiAyOFx1MDBENzI4IHI4IHBhbmVsMiBmcmFtZSBhcm91bmQgdGhlIDI0cHggaWNvbiAocHJvdG90eXBlIC5yaSkgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwicmlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17ci5pY29ufSBwaXhlbFNpemU9ezI0fSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPXtyLm1hcmt1cH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGludFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17ci5oaW50fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwicnVua1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJcdTIxQjVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoc2VsZWN0ZWQpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocykgPT4gcyA9PT0gZmxhdElkeFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXSlcbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuXG4gICAgICAgICAgICAgICAgICAgIHsvKiBmb290ZXIgaGludCByb3cgXHUyMDE0IG1hdGNoZXMgcHJvdG90eXBlIC5sZm9vdCAqL31cbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImxmb290XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezE0fSBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OnJlbG9hZDwvYj4gc29mdC1yZWxvYWRcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46b3NkPC9iPiB0b2dnbGVcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46Z3JhbnRzPC9iPiBzY3JlZW4gYWNjZXNzXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiXHUyMTkxXHUyMTkzIHNlbGVjdCBcdTAwQjcgXHUyMUI1IHJ1blwiIGhhbGlnbj17R3RrLkFsaWduLkVORH0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L3JldmVhbGVyPlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gTGF1bmNoZXIgbWF0Y2hpbmcgXHUyMDE0IHN0cmFpZ2h0IHBvcnQgb2YgdGhlIHByb3RvdHlwZSAocG9zdC1jcml0aXF1ZSB2ZXJzaW9uKTpcbi8vIHN1YnNlcXVlbmNlIGZ1enp5IHdpdGggd29yZC1ib3VuZGFyeSBib251cywgY2FwcGVkIGxvZzIgZnJlY2VuY3ksIHByZWZpeCBnaG9zdC5cblxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWF0Y2gge1xuICAgIHNjb3JlOiBudW1iZXJcbiAgICBtYXJrczogbnVtYmVyW11cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGZ1enp5KHE6IHN0cmluZywgdDogc3RyaW5nKTogTWF0Y2ggfCBudWxsIHtcbiAgICBjb25zdCBxbCA9IHEudG9Mb3dlckNhc2UoKSxcbiAgICAgICAgdGwgPSB0LnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcWkgPSAwLFxuICAgICAgICBzY29yZSA9IDAsXG4gICAgICAgIGxhc3QgPSAtMlxuICAgIGNvbnN0IG1hcmtzOiBudW1iZXJbXSA9IFtdXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0bC5sZW5ndGggJiYgcWkgPCBxbC5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAodGxbaV0gPT09IHFsW3FpXSkge1xuICAgICAgICAgICAgbWFya3MucHVzaChpKVxuICAgICAgICAgICAgc2NvcmUgKz0gaSA9PT0gMCB8fCBcIiAtXy4vXCIuaW5jbHVkZXModFtpIC0gMV0pID8gNCA6IGxhc3QgPT09IGkgLSAxID8gMiA6IDFcbiAgICAgICAgICAgIGxhc3QgPSBpXG4gICAgICAgICAgICBxaSsrXG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHFpID09PSBxbC5sZW5ndGggPyB7IHNjb3JlOiBzY29yZSAtIHQubGVuZ3RoICogMC4wMiwgbWFya3MgfSA6IG51bGxcbn1cblxuLy8gUGFuZ28gbWFya3VwIGhpZ2hsaWdodCAoZXNjYXBlczsgbGVhZiBhY2NlbnQgb24gbWF0Y2hlZCBjaGFycylcbmV4cG9ydCBmdW5jdGlvbiBobCh0OiBzdHJpbmcsIG1hcmtzOiBudW1iZXJbXSB8IG51bGwpOiBzdHJpbmcge1xuICAgIGNvbnN0IGVzYyA9IChjOiBzdHJpbmcpID0+IEdMaWIubWFya3VwX2VzY2FwZV90ZXh0KGMsIC0xKVxuICAgIGlmICghbWFya3MpIHJldHVybiBlc2ModClcbiAgICBjb25zdCBtID0gbmV3IFNldChtYXJrcylcbiAgICBsZXQgb3V0ID0gXCJcIlxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdC5sZW5ndGg7IGkrKylcbiAgICAgICAgb3V0ICs9IG0uaGFzKGkpID8gYDxzcGFuIGZvcmVncm91bmQ9XCIjYjVjYjQ4XCI+JHtlc2ModFtpXSl9PC9zcGFuPmAgOiBlc2ModFtpXSlcbiAgICByZXR1cm4gb3V0XG59XG5cbi8vIEZyZWNlbmN5OiBjYXBwZWQgc28gYW4gZXhhY3QgcHJlZml4IG1hdGNoIEFMV0FZUyBiZWF0cyBoYWJpdCAoY3JpdGlxdWUgQTIpLlxuY29uc3QgU1RPUkUgPSBgJHtHTGliLmdldF91c2VyX3N0YXRlX2RpcigpfS9rb2JlbC9mcmVxLmpzb25gXG5sZXQgZnJlcTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9XG50cnkge1xuICAgIGZyZXEgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShHTGliLmZpbGVfZ2V0X2NvbnRlbnRzKFNUT1JFKVsxXSkpXG59IGNhdGNoIHt9XG5cbmV4cG9ydCBjb25zdCBib29zdCA9IChpZDogc3RyaW5nKSA9PiBNYXRoLm1pbihNYXRoLmxvZzIoMSArIChmcmVxW2lkXSA/PyAwKSksIDMpXG5cbmV4cG9ydCBmdW5jdGlvbiBidW1wKGlkOiBzdHJpbmcpIHtcbiAgICBmcmVxW2lkXSA9IChmcmVxW2lkXSA/PyAwKSArIDFcbiAgICBHTGliLm1rZGlyX3dpdGhfcGFyZW50cyhHTGliLnBhdGhfZ2V0X2Rpcm5hbWUoU1RPUkUpLCAwbzc1NSlcbiAgICBHTGliLmZpbGVfc2V0X2NvbnRlbnRzKFNUT1JFLCBKU09OLnN0cmluZ2lmeShmcmVxKSlcbn1cblxuZXhwb3J0IGNvbnN0IGZyZXF1ZW5jeSA9IChpZDogc3RyaW5nKSA9PiBmcmVxW2lkXSA/PyAwXG4iLCAiLy8gQ2FsZW5kYXIgcG9wb3ZlciBcdTIwMTQgR05PTUUgcmVwbGljYSBwZXIgdGhlIHByb3RvdHlwZTogaGVybyBkYXRlLCBcdTIwMzkgbW9udGggXHUyMDNBIG5hdlxuLy8gKHRpdGxlIGNsaWNrID0gdG9kYXkpLCBJU08gd2VlayBudW1iZXJzIGFzIHF1aWV0IGRpbSB0ZXh0LCBESU1NRUQgV0VFS0VORFMsXG4vLyBjbGlja2FibGUgZGF5cyB3LyBzZWxlY3Rpb24gcmluZyAoaW5rIHJpbmcgb24gdG9kYXkpLCBldmVudC1kb3QgbWFya2Vycyxcbi8vIGV2ZW50cyBjYXJkIGluIHRoZSBub3RpZmljYXRpb24tY2FyZCBsYW5ndWFnZS4gTW9udGhzIHNsaWRlIChtdWx0aXZpZXcgbW90aW9uKS5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuXG5pbnRlcmZhY2UgRXYge1xuICAgIHQ6IHN0cmluZ1xuICAgIG46IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xufVxuLy8gXCJ0b2RheVwiIFx1MjAxNCB1bmRlciBLT0JFTF9ERU1PLCBwaW5uZWQgdG8gRC50b2RheTsgcmVhbCBjbG9jayBvdGhlcndpc2UuXG4vLyB0b2RheVZhciBwb2xscyBldmVyeSA2MHMgc28gdGhlIGhlcm8gZGF0ZSB1cGRhdGVzIHdpdGhvdXQgYSByZWxvYWQuXG5jb25zdCB0b2RheVZhciA9IERFTU9cbiAgICA/IFZhcmlhYmxlKG5ldyBEYXRlKEQudG9kYXkueSwgRC50b2RheS5tLCBELnRvZGF5LmQpKVxuICAgIDogVmFyaWFibGUobmV3IERhdGUoKSkucG9sbCg2MF8wMDAsICgpID0+IG5ldyBEYXRlKCkpXG5jb25zdCBub3cgPSB0b2RheVZhci5nZXQoKVxuY29uc3Qga2V5ID0gKHk6IG51bWJlciwgbTogbnVtYmVyLCBkOiBudW1iZXIpID0+IGAke3l9LSR7bSArIDF9LSR7ZH1gXG5leHBvcnQgY29uc3QgRVZFTlRTOiBSZWNvcmQ8c3RyaW5nLCBFdltdPiA9IHtcbiAgICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSldOiBbXG4gICAgICAgIHsgdDogXCIwOTo0NVwiLCBuOiBcIkRhaWx5IFN0YW5kdXBcIiwgaWNvbjogXCJrb2JlbC12aWRlby1zeW1ib2xpY1wiIH0sXG4gICAgXSxcbiAgICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMTEpXTogW1xuICAgICAgICB7IHQ6IFwiMTA6MzBcIiwgbjogXCJLaWVyYW4gQmlydGhkYXlcIiwgaWNvbjogXCJrb2JlbC1jYWtlLXN5bWJvbGljXCIgfSxcbiAgICAgICAgeyB0OiBcIjEzOjAwXCIsIG46IFwiTG9uZG9uIFRoaW5nXCIsIGljb246IFwia29iZWwtcGluLXN5bWJvbGljXCIgfSxcbiAgICBdLFxuICAgIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxMyldOiBbXG4gICAgICAgIHsgdDogXCJBbGwgZGF5XCIsIG46IFwiTXkgQmlydGhkYXlcIiwgaWNvbjogXCJrb2JlbC1jYWtlLXN5bWJvbGljXCIgfSxcbiAgICBdLFxufVxuXG5jb25zdCB2aWV3ID0gVmFyaWFibGUoeyB5OiBub3cuZ2V0RnVsbFllYXIoKSwgbTogbm93LmdldE1vbnRoKCkgfSlcbmNvbnN0IHNlbCA9IFZhcmlhYmxlKG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSkpXG5cbmZ1bmN0aW9uIGlzb1dlZWsoZDogRGF0ZSk6IG51bWJlciB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKERhdGUuVVRDKGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSkpXG4gICAgY29uc3QgZG4gPSAodC5nZXRVVENEYXkoKSArIDYpICUgN1xuICAgIHQuc2V0VVRDRGF0ZSh0LmdldFVUQ0RhdGUoKSAtIGRuICsgMylcbiAgICBjb25zdCBmID0gbmV3IERhdGUoRGF0ZS5VVEModC5nZXRVVENGdWxsWWVhcigpLCAwLCA0KSlcbiAgICByZXR1cm4gMSArIE1hdGgucm91bmQoKCgrdCAtICtmKSAvIDg2NGU1IC0gMyArICgoZi5nZXRVVENEYXkoKSArIDYpICUgNykpIC8gNylcbn1cblxuZnVuY3Rpb24gR3JpZCgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiY2FsLWdyaWRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfT5cbiAgICAgICAgICAgIHtiaW5kKFZhcmlhYmxlLmRlcml2ZShbdmlldywgc2VsXSwgKHYsIHMpID0+ICh7IHYsIHMgfSkpKS5hcygoeyB2LCBzIH0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmaXJzdCA9IG5ldyBEYXRlKHYueSwgdi5tLCAxKVxuICAgICAgICAgICAgICAgIGNvbnN0IHN0YXJ0ID0gKGZpcnN0LmdldERheSgpICsgNikgJSA3XG4gICAgICAgICAgICAgICAgY29uc3QgZGF5cyA9IG5ldyBEYXRlKHYueSwgdi5tICsgMSwgMCkuZ2V0RGF0ZSgpXG4gICAgICAgICAgICAgICAgY29uc3QgcHJldkRheXMgPSBuZXcgRGF0ZSh2LnksIHYubSwgMCkuZ2V0RGF0ZSgpXG4gICAgICAgICAgICAgICAgY29uc3Qgcm93cyA9IFtdXG4gICAgICAgICAgICAgICAgcm93cy5wdXNoKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IGhvbW9nZW5lb3VzPlxuICAgICAgICAgICAgICAgICAgICAgICAge1tcIlwiLCBcIk1cIiwgXCJUXCIsIFwiV1wiLCBcIlRcIiwgXCJGXCIsIFwiU1wiLCBcIlNcIl0ubWFwKChkKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiZG93XCIgbGFiZWw9e2R9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgNjsgcisrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNlbGxzID0gW1xuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ3ayB0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2Ake2lzb1dlZWsobmV3IERhdGUodi55LCB2Lm0sIHIgKiA3IC0gc3RhcnQgKyAxKSl9YH1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+LFxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgNzsgYysrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpID0gciAqIDcgKyBjLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGQgPSBpIC0gc3RhcnQgKyAxXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvdXQgPSBkIDwgMSB8fCBkID4gZGF5c1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBvdXQgPyAoZCA8IDEgPyBwcmV2RGF5cyArIGQgOiBkIC0gZGF5cykgOiBkXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjbHMgPSBbXCJkYXlcIl1cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjID49IDUpIGNscy5wdXNoKFwid2VcIikgLy8gV0VFS0VORFMgRElNTUVEXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob3V0KSBjbHMucHVzaChcIm91dFwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdG9kYXkgPSBub3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGQgPT09IHRvZGF5LmdldERhdGUoKSAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2Lm0gPT09IHRvZGF5LmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdi55ID09PSB0b2RheS5nZXRGdWxsWWVhcigpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbHMucHVzaChcInRvZGF5XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKEVWRU5UU1trZXkodi55LCB2Lm0sIGQpXSkgY2xzLnB1c2goXCJldlwiKSAvLyBldmVudC1kb3QgKENTUyA6OmFmdGVyIFx1MjE5MiB1bmRlcmxpbmUgZG90KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcy5nZXREYXRlKCkgPT09IGQgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcy5nZXRNb250aCgpID09PSB2Lm0gJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcy5nZXRGdWxsWWVhcigpID09PSB2LnlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNscy5wdXNoKFwic2VsXCIpXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBoYXNFdiA9ICFvdXQgJiYgISFFVkVOVFNba2V5KHYueSwgdi5tLCBkKV1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIGRheSBzaXRzIGF0IGl0cyBuYXR1cmFsIDI0XHUwMEQ3MjQgY2VudHJlZCBpbiB0aGUgZ3JpZCBjb2x1bW4gKG5vdCBmaWxsaW5nIGl0KSxcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNvIHRvZGF5J3MgbGVhZiBmaWxsIGlzIGEgdGlnaHQgY2lyY2xlIHJhdGhlciB0aGFuIGEgY29sdW1uLXdpZGUgb3ZhbFxuICAgICAgICAgICAgICAgICAgICAgICAgY2VsbHMucHVzaChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvdXQgPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e2Nscy5qb2luKFwiIFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtgJHtsYWJlbH1gfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtjbHMuam9pbihcIiBcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHNlbC5zZXQobmV3IERhdGUodi55LCB2Lm0sIGQpKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge2hhc0V2ID8gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxvdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9e2Ake2xhYmVsfWB9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiAzcHggZXZlbnQgZG90LCBhYnNvbHV0ZSBib3R0b20tY2VudGVyIChHVEsgaGFzIG5vIDo6YWZ0ZXIpICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImV2ZG90XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkVORH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD17YCR7bGFiZWx9YH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICByb3dzLnB1c2goPGJveCBob21vZ2VuZW91cz57Y2VsbHN9PC9ib3g+KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gcm93c1xuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gRXZlbnRzQ2FyZCgpIHtcbiAgICAvLyBQcm90b3R5cGUgLmNhbGV2OiBhIHBhbmVsMiBjYXJkIChwYWQxMC9yMTIpIHdyYXBwaW5nIHRoZSBkYXRlIGhlYWRlciArIGRhcmtlclxuICAgIC8vICgtLXBhbmVsKSBldmVudCByb3dzOyBoZWFkZXIncyBvd24gYm90dG9tIHBhZGRpbmcgaXMgdGhlIGhlYWRlclx1MjE5MnJvdyBnYXAgKHNwYWNpbmcgMCkuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImV2Y2FyZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAge2JpbmQoc2VsKS5hcygoZCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGV2cyA9IEVWRU5UU1trZXkoZC5nZXRGdWxsWWVhcigpLCBkLmdldE1vbnRoKCksIGQuZ2V0RGF0ZSgpKV0gPz8gW11cbiAgICAgICAgICAgICAgICBjb25zdCBoZWFkID0gKFxuICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZXZoZWFkXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2QudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdlZWtkYXk6IFwibG9uZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRheTogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9udGg6IFwibG9uZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIGlmICghZXZzLmxlbmd0aClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIGhlYWQsXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNhbGVuZGFyLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJzdWJcIiBsYWJlbD1cIk5vIGV2ZW50c1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD4sXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgICAgICBoZWFkLFxuICAgICAgICAgICAgICAgICAgICAuLi5ldnMubWFwKChlKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZXZyb3dcIiBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIDI2XHUwMEQ3MjYgcjggY29sb3JlZCBpY29uIHRpbGUgKHByb3RvdHlwZSAuZXZpYyksIHdoaXRlIGdseXBoICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJldmljXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtlLmljb259IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtlLm59IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YiB0blwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17ZS50fSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICkpLFxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIENhbGVuZGFyKCkge1xuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgyMjAsIDE1MClcbiAgICByZWdpc3RlcihcImNhbGVuZGFyXCIsIHRvZ2dsZUZuKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJjYWxlbmRhclwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1jYWxlbmRhclwiXG4gICAgICAgICAgICBjbGFzcz1cImNhbGVuZGFyLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4gKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9ET1dOfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNoZWV0IGNhbFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2FsaGVyb1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzdWJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHRvZGF5VmFyKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7IHdlZWtkYXk6IFwibG9uZ1wiIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImhlcm9cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHRvZGF5VmFyKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXk6IFwibnVtZXJpY1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbW9udGg6IFwibG9uZ1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeWVhcjogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICA8Y2VudGVyYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB2ID0gdmlldy5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWV3LnNldCh2Lm0gPyB7IHk6IHYueSwgbTogdi5tIC0gMSB9IDogeyB5OiB2LnkgLSAxLCBtOiAxMSB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1sZWZ0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibW9udGhcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gdmlldy5zZXQoeyB5OiBub3cuZ2V0RnVsbFllYXIoKSwgbTogbm93LmdldE1vbnRoKCkgfSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKHZpZXcpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHYpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IERhdGUodi55LCB2Lm0pLnRvTG9jYWxlU3RyaW5nKFwiZW5cIiwgeyBtb250aDogXCJsb25nXCIgfSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICh2LnkgIT09IG5vdy5nZXRGdWxsWWVhcigpID8gYCAke3YueX1gIDogXCJcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0KHYubSA9PT0gMTEgPyB7IHk6IHYueSArIDEsIG06IDAgfSA6IHsgeTogdi55LCBtOiB2Lm0gKyAxIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8L2NlbnRlcmJveD5cbiAgICAgICAgICAgICAgICAgICAgPEdyaWQgLz5cbiAgICAgICAgICAgICAgICAgICAgPEV2ZW50c0NhcmQgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBRdWljayBzZXR0aW5ncy4gUHJvdG90eXBlLWZpbmFsOiB1bmlmb3JtIHBpbGwgdGlsZXMgZnJvbSBhIENBVEFMT0cgKGN1c3RvbWlzYWJsZSxcbi8vIHBlcnNpc3RlZCksIEdOT01FIHRoaW4gc2xpZGVycywgZHJpbGxkb3ducyBhcyBhIHNwcmluZy1zbGlkIHR3by12aWV3IHN0YWNrXG4vLyAoV2ktRmkgbmV0d29ya3MgLyBCVCBkZXZpY2VzIC8gcGVyLWFwcCBtaXhlciB3aXRoIGEgTWFzdGVyIHJvdyksIGNvbXBhY3QgdG9wIHJvd1xuLy8gKGJhdHRlcnkgXHUwMEI3IHBlbmNpbC9sZWFmL2xvY2svcG93ZXIpLCBnbm9ibGluIGJhbm5lciArIHJlY29ubmVjdCB3aGlsZSBkZWdyYWRlZC5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBCbHVldG9vdGggZnJvbSBcImdpOi8vQXN0YWxCbHVldG9vdGhcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IEJhdHRlcnkgZnJvbSBcImdpOi8vQXN0YWxCYXR0ZXJ5XCJcbmltcG9ydCB7IGNvbm5lY3RlZCwgcmVsb2FkIH0gZnJvbSBcIi4uL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0IHsgTU9USU9OIH0gZnJvbSBcIi4uL2xpYi9zcHJpbmdcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIsIHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgVGlueVNsaWRlciB9IGZyb20gXCIuLi9saWIvdGlueXNsaWRlclwiXG5pbXBvcnQgeyBGaXhlZENoZXYgfSBmcm9tIFwiLi4vbGliL2ZpeGVkY2hldlwiXG5cbnR5cGUgRHJpbGwgPSBudWxsIHwgXCJ3aWZpXCIgfCBcImJ0XCIgfCBcIm1peFwiXG4vLyBLT0JFTF9EUklMTCBsZXRzIHRoZSBkZXZraXQgcmVuZGVyIGEgZHJpbGxkb3duIGRpcmVjdGx5IChubyBwb2ludGVyIHRvIGNsaWNrIHRoZVxuLy8gY2hldnJvbiBpbiBoZWFkbGVzcyk7IHByb2R1Y3Rpb24gZGVmYXVsdCBpcyBudWxsLlxuY29uc3QgZHJpbGwgPSBWYXJpYWJsZTxEcmlsbD4oKEdMaWIuZ2V0ZW52KFwiS09CRUxfRFJJTExcIikgYXMgRHJpbGwpIHx8IG51bGwpXG5cbi8vIFRpbGUgY2F0YWxvZyBcdTIwMTQgbWlycm9ycyBwcm90b3R5cGUgQ0FUQUxPRzsgcGVyc2lzdGVkIGxheW91dCBpbiBzdGF0ZSBkaXIuXG5jb25zdCBTVE9SRSA9IGAke0dMaWIuZ2V0X3VzZXJfc3RhdGVfZGlyKCl9L2tvYmVsL3FzLXRpbGVzLmpzb25gXG5sZXQgdGlsZXM6IHN0cmluZ1tdID0gW1wid2lmaVwiLCBcImJ0XCIsIFwic2F2ZVwiLCBcImRhcmtcIiwgXCJzaWxlbnRcIiwgXCJuaWdodFwiLCBcInZvbHVtZVwiLCBcImJyaWdodG5lc3NcIl1cbnRyeSB7XG4gICAgdGlsZXMgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShHTGliLmZpbGVfZ2V0X2NvbnRlbnRzKFNUT1JFKVsxXSkpXG59IGNhdGNoIHt9XG5cbmZ1bmN0aW9uIENoaXAocHJvcHM6IHtcbiAgICBpZDogc3RyaW5nXG4gICAgbGFiZWw6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIGFjdGl2ZTogYW55XG4gICAgc3ViPzogYW55XG4gICAgb25Ub2dnbGVkOiAoKSA9PiB2b2lkXG4gICAgb25EcmlsbD86ICgpID0+IHZvaWRcbn0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPXtiaW5kKHByb3BzLmFjdGl2ZSkuYXMoKGE6IGJvb2xlYW4pID0+IChhID8gXCJjaGlwIHBpbGwgb25cIiA6IFwiY2hpcCBwaWxsXCIpKX0+XG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY2hpcGJcIiBoZXhwYW5kPXt0cnVlfSBvbkNsaWNrZWQ9e3Byb3BzLm9uVG9nZ2xlZH0+XG4gICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtwcm9wcy5pY29ufSAvPlxuICAgICAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtwcm9wcy5sYWJlbH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtwcm9wcy5zdWIgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN1YlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtwcm9wcy5zdWJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICB7LyogZml4ZWQgMzJweCBzZWFtK2NoZXZyb24gKHByb3RvIC5jaGV2YikgXHUyMDE0IGhleHBhbmQ9ZmFsc2Ugc28gdGhlIG1haW4gYnV0dG9uIG93bnMgc2xhY2sgKi99XG4gICAgICAgICAgICB7cHJvcHMub25EcmlsbCAmJiAoXG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImNoZXZcIiBoZXhwYW5kPXtmYWxzZX0gd2lkdGhSZXF1ZXN0PXszMn0gb25DbGlja2VkPXtwcm9wcy5vbkRyaWxsfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIFNsaWRlcnMoKSB7XG4gICAgY29uc3Qgc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG4gICAgLy8gSW4gREVNTyBtb2RlIHJlbmRlciB0aGUgdHdvIHNsaWRlcnMgcmVnYXJkbGVzcyBvZiBhIHJlYWwgc3BlYWtlciwgcGlubmVkIHRvIHRoZVxuICAgIC8vIHByb3RvdHlwZSdzIG1vY2sgdmFsdWVzICh2b2x1bWUgMC42NCwgYnJpZ2h0bmVzcyAwLjgwKSBmb3IgYSBmYWlyIG92ZXJsYXkuXG4gICAgaWYgKCFzcGVha2VyICYmICFERU1PKSByZXR1cm4gPGJveCAvPlxuICAgIGNvbnN0IHZvbEljb24gPSBzcGVha2VyXG4gICAgICAgID8gYmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpLmFzKChpKSA9PiBpID8/IFwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIpXG4gICAgICAgIDogXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIlxuICAgIGNvbnN0IHZvbFZhbHVlOiBhbnkgPSBERU1PID8gRC52b2x1bWUgOiBiaW5kKHNwZWFrZXIhLCBcInZvbHVtZVwiKVxuICAgIC8vIHByb3RvIC5zbGlkZXJzIGlzIGEgZmxleCBjb2x1bW4gd2l0aCBOTyBnYXAgYmV0d2VlbiB0aGUgdHdvIHNyb3dzIChlYWNoIG1pbi1oIDQyKS5cbiAgICAvLyBUaW55U2xpZGVyIG92ZXJyaWRlcyB2ZnVuY19tZWFzdXJlIHRvIHJlcG9ydCBuYXR1cmFsPTFweCBzbyB0aGUgc3JvdyBkb2Vzbid0XG4gICAgLy8gaW5mbGF0ZSB0aGUgcGFuZWwgYmV5b25kIHRoZSBjaGlwLWdyaWQgd2lkdGggKEdUSyBDU1MgbWF4LXdpZHRoIGlzIG5vdCByZXNwZWN0ZWQpLlxuICAgIGNvbnN0IGluaXRWb2wgPSBERU1PID8gRC52b2x1bWUgOiAoc3BlYWtlcj8udm9sdW1lID8/IDAuNjQpXG4gICAgY29uc3Qgdm9sU2xpZGVyID0gbmV3IFRpbnlTbGlkZXIoeyBoZXhwYW5kOiB0cnVlLCBjc3NDbGFzc2VzOiBbXCJzbGlkZXJcIl0sIHZhbHVlOiBpbml0Vm9sIH0pXG4gICAgaWYgKCFERU1PICYmIHNwZWFrZXIpXG4gICAgICAgIGJpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIikuc3Vic2NyaWJlKCh2OiBudW1iZXIpID0+IHtcbiAgICAgICAgICAgIHZvbFNsaWRlci5nZXRfYWRqdXN0bWVudCgpLnZhbHVlID0gdlxuICAgICAgICB9KVxuICAgIC8vIEd0a1JhbmdlOjpjaGFuZ2UtdmFsdWUgYXJnczogKHJhbmdlLCBzY3JvbGxUeXBlLCB2YWx1ZSlcbiAgICB2b2xTbGlkZXIuY29ubmVjdChcImNoYW5nZS12YWx1ZVwiLCAoX3M6IGFueSwgX3Q6IGFueSwgdjogbnVtYmVyKSA9PiB7XG4gICAgICAgIGlmIChzcGVha2VyKSBzcGVha2VyLnZvbHVtZSA9IHZcbiAgICB9KVxuXG4gICAgY29uc3QgYnJpZ2h0VmFsdWUgPSBWYXJpYWJsZShERU1PID8gRC5icmlnaHRuZXNzIDogMC44KVxuICAgIGlmICghREVNTykge1xuICAgICAgICBQcm9taXNlLmFsbChbZXhlY0FzeW5jKFwiYnJpZ2h0bmVzc2N0bCBnZXRcIiksIGV4ZWNBc3luYyhcImJyaWdodG5lc3NjdGwgbWF4XCIpXSlcbiAgICAgICAgICAgIC50aGVuKChbY3VyLCBtYXhdKSA9PiBicmlnaHRWYWx1ZS5zZXQocGFyc2VJbnQoY3VyLnRyaW0oKSkgLyBwYXJzZUludChtYXgudHJpbSgpKSkpXG4gICAgICAgICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAgICAgICAgIC8qIGJyaWdodG5lc3NjdGwgYWJzZW50IG9uIGRlc2t0b3AgKi9cbiAgICAgICAgICAgIH0pXG4gICAgfVxuICAgIGNvbnN0IGJyaWdodFNsaWRlciA9IG5ldyBUaW55U2xpZGVyKHtcbiAgICAgICAgaGV4cGFuZDogdHJ1ZSxcbiAgICAgICAgY3NzQ2xhc3NlczogW1wic2xpZGVyXCJdLFxuICAgICAgICB2YWx1ZTogYnJpZ2h0VmFsdWUuZ2V0KCksXG4gICAgfSlcbiAgICBicmlnaHRWYWx1ZS5zdWJzY3JpYmUoKHYpID0+IHtcbiAgICAgICAgYnJpZ2h0U2xpZGVyLmdldF9hZGp1c3RtZW50KCkudmFsdWUgPSB2XG4gICAgfSlcbiAgICBicmlnaHRTbGlkZXIuY29ubmVjdChcImNoYW5nZS12YWx1ZVwiLCAoX3M6IGFueSwgX3Q6IGFueSwgdjogbnVtYmVyKSA9PlxuICAgICAgICBleGVjQXN5bmMoYGJyaWdodG5lc3NjdGwgc2V0ICR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IGJyaWdodFZhbHVlLnNldCh2KSlcbiAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB7fSlcbiAgICApXG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwic2xpZGVyc1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3ZvbEljb259IC8+XG4gICAgICAgICAgICAgICAge3ZvbFNsaWRlcn1cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY2hldlwiIHdpZHRoUmVxdWVzdD17MzF9IG9uQ2xpY2tlZD17KCkgPT4gZHJpbGwuc2V0KFwibWl4XCIpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzcm93XCIgc3BhY2luZz17OX0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYnJpZ2h0bmVzcy1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAge2JyaWdodFNsaWRlcn1cbiAgICAgICAgICAgICAgICB7LyogZ3V0dGVyOiB3aWR0aFJlcXVlc3Q9MTcgKyB+MTNweCBBZHdhaXRhIG92ZXJoZWFkIFx1MjI0OCAzMHB4LCBtYXRjaGluZyBjaGV2IHdpZHRoICovfVxuICAgICAgICAgICAgICAgIDxib3ggd2lkdGhSZXF1ZXN0PXsxN30gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmZ1bmN0aW9uIEdub2JsaW5CYW5uZXIoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cImdiYW5uZXJcIiB2aXNpYmxlPXtERU1PID8gZmFsc2UgOiBiaW5kKGNvbm5lY3RlZCkuYXMoKGMpID0+ICFjKX0gc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtd2FybmluZy1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidFwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIm9yZy5nbm9ibGluLlNoZWxsIGRpc2Nvbm5lY3RlZFwiIC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIm9zZCArIG5vdGlmcyBoYW5kZWQgYmFjayB0byBnbm9tZVwiXG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImdidG5cIiBsYWJlbD1cIlJlY29ubmVjdFwiIG9uQ2xpY2tlZD17KCkgPT4gcmVsb2FkKCkuY2F0Y2goKCkgPT4ge30pfSAvPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIFx1MjUwMFx1MjUwMCByZWFsLWJhY2tlbmQgdG9nZ2xlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbi8vIERhcmsgU3R5bGU6IG9yZy5nbm9tZS5kZXNrdG9wLmludGVyZmFjZSBjb2xvci1zY2hlbWVcbmNvbnN0IGlmYWNlU2V0dGluZ3MgPSBuZXcgR2lvLlNldHRpbmdzKHsgc2NoZW1hOiBcIm9yZy5nbm9tZS5kZXNrdG9wLmludGVyZmFjZVwiIH0pXG5jb25zdCB0RGFyayA9IFZhcmlhYmxlKGlmYWNlU2V0dGluZ3MuZ2V0X3N0cmluZyhcImNvbG9yLXNjaGVtZVwiKSA9PT0gXCJwcmVmZXItZGFya1wiKVxuaWZhY2VTZXR0aW5ncy5jb25uZWN0KFwiY2hhbmdlZDo6Y29sb3Itc2NoZW1lXCIsICgpID0+XG4gICAgdERhcmsuc2V0KGlmYWNlU2V0dGluZ3MuZ2V0X3N0cmluZyhcImNvbG9yLXNjaGVtZVwiKSA9PT0gXCJwcmVmZXItZGFya1wiKVxuKVxuXG4vLyBOaWdodCBMaWdodDogb3JnLmdub21lLnNldHRpbmdzLWRhZW1vbi5wbHVnaW5zLmNvbG9yXG5sZXQgY29sb3JTZXR0aW5nczogR2lvLlNldHRpbmdzIHwgbnVsbCA9IG51bGxcbmNvbnN0IHROaWdodCA9IFZhcmlhYmxlKGZhbHNlKVxudHJ5IHtcbiAgICBjb2xvclNldHRpbmdzID0gbmV3IEdpby5TZXR0aW5ncyh7IHNjaGVtYTogXCJvcmcuZ25vbWUuc2V0dGluZ3MtZGFlbW9uLnBsdWdpbnMuY29sb3JcIiB9KVxuICAgIHROaWdodC5zZXQoY29sb3JTZXR0aW5ncy5nZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIikpXG4gICAgY29sb3JTZXR0aW5ncy5jb25uZWN0KFwiY2hhbmdlZDo6bmlnaHQtbGlnaHQtZW5hYmxlZFwiLCAoKSA9PlxuICAgICAgICB0TmlnaHQuc2V0KGNvbG9yU2V0dGluZ3MhLmdldF9ib29sZWFuKFwibmlnaHQtbGlnaHQtZW5hYmxlZFwiKSlcbiAgICApXG59IGNhdGNoIHtcbiAgICAvKiBzY2hlbWEgYWJzZW50IG9uIHNvbWUgc3lzdGVtcyAqL1xufVxuXG4vLyBTaWxlbnQ6IG11dGUgb24gdGhlIGRlZmF1bHQgV2lyZVBsdW1iZXIgc3BlYWtlclxuY29uc3QgX3NwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuY29uc3QgdFNpbGVudCA9IF9zcGVha2VyXG4gICAgPyAoYmluZChfc3BlYWtlciwgXCJtdXRlXCIpIGFzIHVua25vd24gYXMgVmFyaWFibGU8Ym9vbGVhbj4pXG4gICAgOiBWYXJpYWJsZShmYWxzZSlcblxuLy8gUG93ZXIgU2F2ZXI6IHBvd2VycHJvZmlsZXNjdGwgKGZhbGxzIGJhY2sgdG8gZmFsc2UgaWYgdW5hdmFpbGFibGUpXG5jb25zdCB0U2F2ZSA9IFZhcmlhYmxlKGZhbHNlKVxuZXhlY0FzeW5jKFwicG93ZXJwcm9maWxlc2N0bCBnZXRcIilcbiAgICAudGhlbigodikgPT4gdFNhdmUuc2V0KHYudHJpbSgpID09PSBcInBvd2VyLXNhdmVyXCIpKVxuICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgIC8qIHBvd2VycHJvZmlsZXNjdGwgYWJzZW50ICovXG4gICAgfSlcblxuLy8gZWRpdC1tb2RlIGZvciB0aGUgdGlsZSBjYXRhbG9nIChwZW5jaWwgYnV0dG9uKSBcdTIwMTQgaG9vayBmb3IgdGlsZSByZWFycmFuZ2UvY3VzdG9taXNlLlxuY29uc3QgZWRpdE1vZGUgPSBWYXJpYWJsZShmYWxzZSlcblxuLy8gUHJvdG90eXBlIHRvZ2dsZSBjaGlwcyBhcmUgbGFiZWwtb25seSwgdmVydGljYWxseSBjZW50ZXJlZCBcdTIwMTQgc3RhdGUgaXMgc2hvd24gYnkgdGhlXG4vLyBsZWFmIGZpbGwsIG5vdCBhIHN1Yi1saW5lIChvbmx5IFdpLUZpL0JsdWV0b290aCBjYXJyeSBhIHN1YikuXG5mdW5jdGlvbiBUb2dnbGVDaGlwKHByb3BzOiB7XG4gICAgbGFiZWw6IHN0cmluZ1xuICAgIGljb246IHN0cmluZ1xuICAgIHY6IFZhcmlhYmxlPGJvb2xlYW4+XG4gICAgb25Ub2dnbGVkPzogKCkgPT4gdm9pZFxufSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxDaGlwXG4gICAgICAgICAgICBpZD17cHJvcHMubGFiZWx9XG4gICAgICAgICAgICBsYWJlbD17cHJvcHMubGFiZWx9XG4gICAgICAgICAgICBpY29uPXtwcm9wcy5pY29ufVxuICAgICAgICAgICAgYWN0aXZlPXtiaW5kKHByb3BzLnYpfVxuICAgICAgICAgICAgb25Ub2dnbGVkPXtwcm9wcy5vblRvZ2dsZWQgPz8gKCgpID0+IHByb3BzLnYuc2V0KCFwcm9wcy52LmdldCgpKSl9XG4gICAgICAgIC8+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBiYXR0ZXJ5TWV0YSgpOiBhbnkge1xuICAgIGNvbnN0IGJhdCA9IEJhdHRlcnkuZ2V0X2RlZmF1bHQoKVxuICAgIGlmICghYmF0KSByZXR1cm4gbnVsbFxuICAgIHJldHVybiBiaW5kKGJhdCwgXCJwZXJjZW50YWdlXCIpLmFzKChwKSA9PiB7XG4gICAgICAgIGNvbnN0IHBjdCA9IE1hdGgucm91bmQocCAqIDEwMClcbiAgICAgICAgY29uc3Qgc3RhdGUgPSBiYXQuZnVsbCA/IFwiRnVsbHkgY2hhcmdlZFwiIDogYmF0LmNoYXJnaW5nID8gXCJDaGFyZ2luZ1wiIDogXCJEaXNjaGFyZ2luZ1wiXG4gICAgICAgIHJldHVybiBgJHtwY3R9JSBcdTAwQjcgJHtzdGF0ZX1gXG4gICAgfSlcbn1cbmNvbnN0IGhhc0JhdHRlcnkgPSBCYXR0ZXJ5LmdldF9kZWZhdWx0KCkgIT0gbnVsbFxuXG5mdW5jdGlvbiBSb290KHsgbmFtZSB9OiB7IG5hbWU/OiBzdHJpbmcgfSkge1xuICAgIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICAgIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgICAvLyBzcGFjaW5nIDA6IGV4YWN0IHNlY3Rpb24gZ2FwcyBjb21lIGZyb20gbWFyZ2lucyAocXRvcFx1MjE5MmNoaXBzIDEsIGNoaXAgcm93cyA4LFxuICAgIC8vIGNoaXBzXHUyMTkyc2xpZGVycyAxMCkgXHUyMDE0IGEgdW5pZm9ybSBib3ggc3BhY2luZyBjYW4ndCBleHByZXNzIGFsbCB0aHJlZS5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IG5hbWU9e25hbWV9IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgey8qIHRvcCByb3c6IGJhdHRlcnkgXHUwMEI3IHJlbG9hZCBcdTAwQjcgbG9jayBcdTAwQjcgcG93ZXIgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwicXMtdG9wXCIgc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgey8qIGJhdHRlcnkgcGlsbDogZ2x5cGggKyB0YWJ1bGFyIG1ldGEgXHUyMDE0IGhpZGRlbiB3aGVuIG5vIGJhdHRlcnkgcHJlc2VudCAqL31cbiAgICAgICAgICAgICAgICB7KERFTU8gfHwgaGFzQmF0dGVyeSkgJiYgKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibWV0YVwiIHNwYWNpbmc9ezZ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1iYXR0ZXJ5LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e0RFTU8gPyBELm1ldGEgOiBiYXR0ZXJ5TWV0YSgpfSAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIDxib3ggaGV4cGFuZCAvPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuIGxlYWZcIiBvbkNsaWNrZWQ9eygpID0+IHJlbG9hZCgpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbGVhZi1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG5cIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWxvY2stc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuXCIgb25DbGlja2VkPXsoKSA9PiBlZGl0TW9kZS5zZXQoIWVkaXRNb2RlLmdldCgpKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBlbmNpbC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG4gZGFuZ2VyXCIgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKX0+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBvd2VyLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPEdub2JsaW5CYW5uZXIgLz5cbiAgICAgICAgICAgIHsvKiBvbmUgY2hpcHMgZ3JpZDogMyByb3dzIGF0IDhweCwgbWFyZ2luLWJvdHRvbSAxMCBiZWZvcmUgdGhlIHNsaWRlcnMgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2hpcC1ncmlkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgIHsoREVNTyB8fCBuZXQud2lmaSkgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgPENoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZD1cIndpZmlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiV2ktRmlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC13aWZpLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e0RFTU8gPyBWYXJpYWJsZSh0cnVlKSA6IGJpbmQobmV0LndpZmkhLCBcImVuYWJsZWRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ViPXtERU1PID8gRC53aWZpU3NpZCA6IGJpbmQobmV0LndpZmkhLCBcInNzaWRcIikuYXMoKHMpID0+IHMgPz8gXCJPZmZcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghREVNTyAmJiBuZXQud2lmaSkgbmV0LndpZmkuZW5hYmxlZCA9ICFuZXQud2lmaS5lbmFibGVkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkRyaWxsPXsoKSA9PiBkcmlsbC5zZXQoXCJ3aWZpXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPENoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkPVwiYnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJCbHVldG9vdGhcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLWJsdWV0b290aC1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBWYXJpYWJsZSh0cnVlKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcygoZCkgPT4gZC5zb21lKCh4KSA9PiB4LmNvbm5lY3RlZCkpXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBzdWI9e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIERFTU9cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBELmJ0RGV2aWNlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChidCwgXCJkZXZpY2VzXCIpLmFzKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoZCkgPT4gZC5maW5kKCh4KSA9PiB4LmNvbm5lY3RlZCk/LmFsaWFzID8/IFwiT2ZmXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIURFTU8pIGJ0LnRvZ2dsZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgb25EcmlsbD17KCkgPT4gZHJpbGwuc2V0KFwiYnRcIil9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgIDxUb2dnbGVDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIlBvd2VyIFNhdmVyXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1ib2x0LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3RTYXZlfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbmV4dCA9ICF0U2F2ZS5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGV4ZWNBc3luYyhgcG93ZXJwcm9maWxlc2N0bCBzZXQgJHtuZXh0ID8gXCJwb3dlci1zYXZlclwiIDogXCJiYWxhbmNlZFwifWApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50aGVuKCgpID0+IHRTYXZlLnNldChuZXh0KSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKCgpID0+IHRTYXZlLnNldChuZXh0KSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDxUb2dnbGVDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIkRhcmsgU3R5bGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLW1vb24tc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgdj17dERhcmt9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gIXREYXJrLmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWZhY2VTZXR0aW5ncy5zZXRfc3RyaW5nKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcImNvbG9yLXNjaGVtZVwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXh0ID8gXCJwcmVmZXItZGFya1wiIDogXCJkZWZhdWx0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJTaWxlbnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLWJlbGwtc2xhc2gtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgdj17dFNpbGVudH1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChfc3BlYWtlcikgX3NwZWFrZXIubXV0ZSA9ICFfc3BlYWtlci5tdXRlXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8VG9nZ2xlQ2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJOaWdodCBMaWdodFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtc3VuLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIHY9e3ROaWdodH1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChjb2xvclNldHRpbmdzKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2xvclNldHRpbmdzLnNldF9ib29sZWFuKFwibmlnaHQtbGlnaHQtZW5hYmxlZFwiLCAhdE5pZ2h0LmdldCgpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPFNsaWRlcnMgLz5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBTaWduYWwtc3RyZW5ndGggZ2x5cGggZm9yIGFuIGFjY2VzcyBwb2ludCAoMFx1MjAxMzEwMCBcdTIxOTIgd2lmaSB0aWVycykuXG5mdW5jdGlvbiB3aWZpSWNvbihzdHJlbmd0aDogbnVtYmVyKTogc3RyaW5nIHtcbiAgICByZXR1cm4gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgLy8gc2luZ2xlIGdseXBoOyBzdHJlbmd0aCBzaG93biBhcyB0ZXh0IG1ldGFcbn1cblxuLy8gV2ktRmkgQVAgbGlzdCBcdTIwMTQgcmVhbCBBc3RhbE5ldHdvcmsgYWNjZXNzIHBvaW50cywgY29ubmVjdGVkIG9uZSBtYXJrZWQgLmFjdGl2ZS5cbmZ1bmN0aW9uIFdpZmlMaXN0KCkge1xuICAgIGNvbnN0IHdpZmkgPSBOZXR3b3JrLmdldF9kZWZhdWx0KCkud2lmaVxuICAgIGlmICghd2lmaSkgcmV0dXJuIDxib3ggLz5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgIHtiaW5kKHdpZmksIFwiYWNjZXNzUG9pbnRzXCIpLmFzKChhcHMpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmUgPSB3aWZpLmFjdGl2ZUFjY2Vzc1BvaW50XG4gICAgICAgICAgICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGFwc1xuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChhcCkgPT4gYXAuc3NpZCAmJiAhc2Vlbi5oYXMoYXAuc3NpZCkgJiYgc2Vlbi5hZGQoYXAuc3NpZCkpXG4gICAgICAgICAgICAgICAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnN0cmVuZ3RoIC0gYS5zdHJlbmd0aClcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKGFwKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvbiA9IGFjdGl2ZSAmJiBhcC5zc2lkID09PSBhY3RpdmUuc3NpZFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtvbiA/IFwieHJvdyBhY3RpdmVcIiA6IFwieHJvd1wifVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHdpZmkuYWN0aXZhdGVfY29ubmVjdGlvbihhcCwgbnVsbCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17d2lmaUljb24oYXAuc3RyZW5ndGgpfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXthcC5zc2lkfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ4c1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e29uID8gXCJDb25uZWN0ZWRcIiA6IGAke2FwLnN0cmVuZ3RofSVgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9KX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBCbHVldG9vdGggZGV2aWNlIGxpc3QgXHUyMDE0IHNhbWUgLnhyb3cgZ3JhbW1hciBhcyBXaS1GaTsgY29ubmVjdGVkIGRldmljZSBpcyAuYWN0aXZlLlxuZnVuY3Rpb24gQnRMaXN0KCkge1xuICAgIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgIHtiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoKGRldmljZXMpID0+XG4gICAgICAgICAgICAgICAgZGV2aWNlc1xuICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKChkKSA9PiBkLm5hbWUgfHwgZC5hbGlhcylcbiAgICAgICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmNvbm5lY3RlZCkgLSBOdW1iZXIoYS5jb25uZWN0ZWQpKVxuICAgICAgICAgICAgICAgICAgICAuc2xpY2UoMCwgNilcbiAgICAgICAgICAgICAgICAgICAgLm1hcCgoZGV2KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBvbiA9IGRldi5jb25uZWN0ZWRcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb24gPyBkZXYuZGlzY29ubmVjdF9kZXZpY2UoKSA6IGRldi5jb25uZWN0X2RldmljZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmx1ZXRvb3RoLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17ZGV2LmFsaWFzIHx8IGRldi5uYW1lfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwieHNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb24gPyBcIkNvbm5lY3RlZFwiIDogZGV2LnBhaXJlZCA/IFwiUGFpcmVkXCIgOiBcIkF2YWlsYWJsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIE9uZSBtaXhlciByb3cgKC5taXhyb3cpIFx1MjAxNCBob3Jpem9udGFsOiAyNlx1MDBENzI2IGljb24gdGlsZSBcdTAwQjcgNzJweCBuYW1lIFx1MDBCNyBzbGlkZXIgZmlsbHMuXG5mdW5jdGlvbiBNaXhSb3cocHJvcHM6IHsgaWNvbjogc3RyaW5nOyB0aXRsZTogc3RyaW5nOyB0YXJnZXQ6IGFueSB9KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cIm1peHJvd1wiIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtaVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtwcm9wcy5pY29ufSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICBjbGFzcz1cIm1uYW1lXCJcbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgIGxhYmVsPXtwcm9wcy50aXRsZX1cbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8c2xpZGVyXG4gICAgICAgICAgICAgICAgY2xhc3M9XCJzbGlkZXJcIlxuICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgdmFsdWU9e2JpbmQocHJvcHMudGFyZ2V0LCBcInZvbHVtZVwiKX1cbiAgICAgICAgICAgICAgICBvbkNoYW5nZVZhbHVlPXsoX3MsIHYpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgcHJvcHMudGFyZ2V0LnZvbHVtZSA9IHZcbiAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgLz5cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG4vLyBQZXItYXBwIHZvbHVtZSBtaXhlciBcdTIwMTQgTWFzdGVyIChkZWZhdWx0IHNwZWFrZXIpICsgZWFjaCBhdWRpbyBzdHJlYW0gKEFzdGFsV3ApLlxuZnVuY3Rpb24gTWl4TGlzdCgpIHtcbiAgICBjb25zdCB3cCA9IFdwLmdldF9kZWZhdWx0KClcbiAgICBpZiAoIXdwKSByZXR1cm4gPGJveCAvPlxuICAgIGNvbnN0IHNwZWFrZXIgPSB3cC5kZWZhdWx0X3NwZWFrZXJcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICAgICAgICAgIHtzcGVha2VyICYmIChcbiAgICAgICAgICAgICAgICA8TWl4Um93IGljb249XCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIiB0aXRsZT1cIk91dHB1dFwiIHRhcmdldD17c3BlYWtlcn0gLz5cbiAgICAgICAgICAgICl9XG4gICAgICAgICAgICB7YmluZCh3cC5hdWRpbywgXCJzdHJlYW1zXCIpLmFzKChzdHJlYW1zKSA9PlxuICAgICAgICAgICAgICAgIHN0cmVhbXNcbiAgICAgICAgICAgICAgICAgICAgLnNsaWNlKDAsIDUpXG4gICAgICAgICAgICAgICAgICAgIC5tYXAoKHMpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxNaXhSb3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlPXtzLmRlc2NyaXB0aW9uIHx8IHMubmFtZSB8fCBcIkFwcGxpY2F0aW9uXCJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFyZ2V0PXtzfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKSlcbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gRHJpbGxWaWV3KHsgbmFtZSB9OiB7IG5hbWU/OiBzdHJpbmcgfSkge1xuICAgIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggbmFtZT17bmFtZX0gb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICAgICAgICA8Y2VudGVyYm94IGNsYXNzPVwiZGhlYWRcIj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZHJpbGwuc2V0KG51bGwpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1sZWZ0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoZHJpbGwpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgZCA9PT0gXCJ3aWZpXCIgPyBcIldpLUZpXCIgOiBkID09PSBcImJ0XCIgPyBcIkJsdWV0b290aFwiIDogXCJWb2x1bWVcIlxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPGJveCB3aWR0aFJlcXVlc3Q9ezQ2fSBoYWxpZ249e0d0ay5BbGlnbi5FTkR9PlxuICAgICAgICAgICAgICAgICAgICB7bmV0LndpZmkgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgPHN3aXRjaFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZT17YmluZChuZXQud2lmaSwgXCJlbmFibGVkXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJpbGwpLmFzKChkKSA9PiBkID09PSBcIndpZmlcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ob3RpZnlBY3RpdmU9eyhzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5ldC53aWZpIS5lbmFibGVkID0gcy5hY3RpdmVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPHN3aXRjaFxuICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtiaW5kKEJsdWV0b290aC5nZXRfZGVmYXVsdCgpLCBcInBvd2VyZWRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcygoZCkgPT4gZCA9PT0gXCJidFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXsocykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEJsdWV0b290aC5nZXRfZGVmYXVsdCgpLmFkYXB0ZXIucG93ZXJlZCA9IHMuYWN0aXZlXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9jZW50ZXJib3g+XG4gICAgICAgICAgICB7YmluZChkcmlsbCkuYXMoKGQpID0+XG4gICAgICAgICAgICAgICAgZCA9PT0gXCJ3aWZpXCIgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxXaWZpTGlzdCAvPlxuICAgICAgICAgICAgICAgICkgOiBkID09PSBcImJ0XCIgPyAoXG4gICAgICAgICAgICAgICAgICAgIDxCdExpc3QgLz5cbiAgICAgICAgICAgICAgICApIDogZCA9PT0gXCJtaXhcIiA/IChcbiAgICAgICAgICAgICAgICAgICAgPE1peExpc3QgLz5cbiAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IC8+XG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBRdWlja1NldHRpbmdzKCkge1xuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgyMjAsIDE1MClcbiAgICByZWdpc3RlcihcInF1aWNrc2V0dGluZ3NcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cInF1aWNrc2V0dGluZ3NcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtcXNcIlxuICAgICAgICAgICAgY2xhc3M9XCJxcy13aW5kb3dcIlxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICAgICAgICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAgICAgICAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLk9OX0RFTUFORH1cbiAgICAgICAgICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5ICE9PSBHZGsuS0VZX0VzY2FwZSkgcmV0dXJuIGZhbHNlXG4gICAgICAgICAgICAgICAgaWYgKGRyaWxsLmdldCgpKSB7XG4gICAgICAgICAgICAgICAgICAgIGRyaWxsLnNldChudWxsKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH0gLy8gRXNjIHN0ZXBzIGJhY2sgZmlyc3RcbiAgICAgICAgICAgICAgICBjbG9zZSgpXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgIH19XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9ET1dOfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNoZWV0IHFzXCI+XG4gICAgICAgICAgICAgICAgICAgIHsvKiBHdGsuU3RhY2sgd2l0aCBzbGlkZS1sZWZ0L3JpZ2h0ID0gdGhlIG11bHRpdmlldzsgaGVpZ2h0IGFuaW1hdGVzXG4gICAgICAgICAgICB2aWEgQWR3IHNwcmluZyBvbiBhIHNpemUtZ3JvdXAgd3JhcHBlciAoTU9USU9OLmRyaWxsIC8gZHJpbGxCYWNrKSAqL31cbiAgICAgICAgICAgICAgICAgICAgPHN0YWNrXG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlN0YWNrVHJhbnNpdGlvblR5cGUuU0xJREVfTEVGVF9SSUdIVH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZUNoaWxkTmFtZT17YmluZChkcmlsbCkuYXMoKGQpID0+IChkID8gXCJkcmlsbFwiIDogXCJyb290XCIpKX1cbiAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgPFJvb3QgbmFtZT1cInJvb3RcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPERyaWxsVmlldyBuYW1lPVwiZHJpbGxcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L3N0YWNrPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFRpbnlTbGlkZXIgXHUyMDE0IEd0ay5TY2FsZSBzdWJjbGFzcyB0aGF0IHJlcG9ydHMgbmVhci16ZXJvIG5hdHVyYWwgd2lkdGggc28gaXRcbi8vIG5ldmVyIGZvcmNlcyBpdHMgcGFyZW50IGNvbnRhaW5lciB3aWRlciB0aGFuIHRoZSBjaGlwLWdyaWQncyBuYXR1cmFsIHdpZHRoLlxuLy8gV2UgZXh0ZW5kIEd0ay5TY2FsZSBkaXJlY3RseSAobm90IEFzdGFsLlNsaWRlcikgYmVjYXVzZSBBc3RhbC5TbGlkZXIncyBWYWxhXG4vLyBDIHZmdW5jcyBjYW4gaW50ZXJjZXB0IHRoZSBtZWFzdXJlIGNoYWluIGJlZm9yZSB0aGUgR0pTIG92ZXJyaWRlIGlzIHJlYWNoZWQuXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrXCJcblxuZXhwb3J0IGNvbnN0IFRpbnlTbGlkZXIgPSBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoXG4gICAge1xuICAgICAgICBHVHlwZU5hbWU6IFwiS29iZWxUaW55U2NhbGVcIixcbiAgICB9LFxuICAgIGNsYXNzIFRpbnlTbGlkZXIgZXh0ZW5kcyBHdGsuU2NhbGUge1xuICAgICAgICBjb25zdHJ1Y3RvcihwYXJhbXM/OiBQYXJ0aWFsPEd0ay5TY2FsZS5Db25zdHJ1Y3RvclByb3BzICYgeyB2YWx1ZT86IG51bWJlciB9Pikge1xuICAgICAgICAgICAgY29uc3QgeyB2YWx1ZSwgLi4ucmVzdCB9ID0gKHBhcmFtcyA/PyB7fSkgYXMgYW55XG4gICAgICAgICAgICBzdXBlcih7XG4gICAgICAgICAgICAgICAgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbi5IT1JJWk9OVEFMLFxuICAgICAgICAgICAgICAgIGFkanVzdG1lbnQ6IG5ldyBHdGsuQWRqdXN0bWVudCh7XG4gICAgICAgICAgICAgICAgICAgIGxvd2VyOiAwLFxuICAgICAgICAgICAgICAgICAgICB1cHBlcjogMSxcbiAgICAgICAgICAgICAgICAgICAgc3RlcF9pbmNyZW1lbnQ6IDAuMDEsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VfaW5jcmVtZW50OiAwLjEsXG4gICAgICAgICAgICAgICAgICAgIHBhZ2Vfc2l6ZTogMCxcbiAgICAgICAgICAgICAgICAgICAgdmFsdWU6IHZhbHVlID8/IDAsXG4gICAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgICAgZHJhd192YWx1ZTogZmFsc2UsXG4gICAgICAgICAgICAgICAgLi4ucmVzdCxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cblxuICAgICAgICB2ZnVuY19tZWFzdXJlKFxuICAgICAgICAgICAgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbixcbiAgICAgICAgICAgIGZvcl9zaXplOiBudW1iZXJcbiAgICAgICAgKTogW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICAgICAgICAgICAgaWYgKG9yaWVudGF0aW9uID09PSBHdGsuT3JpZW50YXRpb24uSE9SSVpPTlRBTCkge1xuICAgICAgICAgICAgICAgIC8vIFJlcG9ydCBuYXR1cmFsPTEgc28gdGhlIHNyb3cvc2xpZGVycyBjb250YWluZXIgZG9lc24ndCBpbmZsYXRlIHRoZSBRUyBwYW5lbFxuICAgICAgICAgICAgICAgIC8vIGJleW9uZCB0aGUgY2hpcC1ncmlkIG5hdHVyYWwgd2lkdGguIFRoZSBzbGlkZXIgc3RpbGwgaGV4cGFuZHMgdG8gZmlsbCB0aGVcbiAgICAgICAgICAgICAgICAvLyBhdmFpbGFibGUgc3BhY2UgYXQgYWxsb2NhdGlvbiB0aW1lIFx1MjAxNCBvbmx5IHRoZSBuYXR1cmFsIHNpemUgaXMgb3ZlcnJpZGRlbi5cbiAgICAgICAgICAgICAgICByZXR1cm4gWzAsIDEsIC0xLCAtMV1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBzdXBlci52ZnVuY19tZWFzdXJlKG9yaWVudGF0aW9uLCBmb3Jfc2l6ZSlcbiAgICAgICAgfVxuICAgIH1cbilcbiIsICIvLyBOb3RpZmljYXRpb25zLiBQcm90b3R5cGUtZmluYWw6IGZsb2F0aW5nIGJsdXJyZWQgdG9hc3RzICh0b3AtcmlnaHQsIHRoZSBPTkVcbi8vIHNhbmN0aW9uZWQgdHJhbnNsdWNlbmN5KSArIHJpZ2h0IGRyYXdlciAobWVkaWEgY2FyZCBvbiB0b3AsIHBhbmVsLWxlc3MgY2FyZHNcbi8vIGZsb2F0aW5nIG9uIHdhbGxwYXBlciwgaGVhZGVyIGNoaXApLiBUaGUgdW5pZmllZCBwaXBlbGluZTogb3BlbiB0aGUgZHJhd2VyIHdoaWxlXG4vLyBhIHRvYXN0IGlzIGxpdmUgYW5kIGl0J3MgQURPUFRFRCBpbnRvIHRoZSBzdGFjazsgdG9hc3RzIGFycml2aW5nIHdoaWxlIG9wZW5cbi8vIGluc2VydCBhcyBjYXJkczsgU2lsZW50IHJvdXRlcyBzdHJhaWdodCB0byB0aGUgc3RvcmUuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgdGltZW91dCwgR0xpYiwgZXhlY0FzeW5jIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuXG4vLyBMYXp5IHNpbmdsZXRvbiBcdTIwMTQgY2FsbGluZyBnZXRfZGVmYXVsdCgpIGF0IG1vZHVsZSBzY29wZSBibG9ja3MgdGhlIGltcG9ydCB3aGlsZVxuLy8gQXN0YWxOb3RpZmQgdHJpZXMgdG8gYWNxdWlyZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyAoaGFuZ3MgaWYgZ25vbWUtc2hlbGxcbi8vIHN0aWxsIG93bnMgaXQpLiBEZWZlcnJpbmcgdG8gZmlyc3QgdXNlIGxldHMgdGhlIG1vZHVsZSBpbXBvcnQgY2xlYW5seTsgdGhlIGJ1cyBpc1xuLy8gcmVsZWFzZWQgYnkgYGdub2JsaW5jdGwgZGlzYWJsZSBub3RpZmljYXRpb25zYCBiZWZvcmUgdGhlIGRhZW1vbiBhY3R1YWxseSBjbGFpbXMgaXQuXG5sZXQgX25vdGlmZDogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5jb25zdCBuZCA9ICgpID0+IChfbm90aWZkID8/PSBOb3RpZmQuZ2V0X2RlZmF1bHQoKSlcbmNvbnN0IHNraXAgPSAoKSA9PiAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIilcbmNvbnN0IFRPQVNUX01TID0gMzgwMFxuLy8gUmVhY3RpdmUgZHJhd2VyLW9wZW4gc3RhdGUgc28gdGhlIHRvYXN0cyBjYW4gYmUgQURPUFRFRCAoaGlkZGVuKSB0aGUgaW5zdGFudCB0aGVcbi8vIGRyYXdlciBvcGVucywgd2l0aG91dCBwb2xsaW5nIGEgbG9va2VkLXVwIHdpbmRvdydzIHZpc2liaWxpdHkuXG5jb25zdCBkcmF3ZXJPcGVuID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIE5vdGlmaWNhdGlvbiBjYXJkcyBhcmUgYSBkZWZpbmVkIHdpZHRoIChwcm90b3R5cGUgYHB3YCBcdTIyNDggUVMgcGFuZWwpIHNvIHRoZSB0b2FzdFxuLy8gZG9lc24ndCBzdHJldGNoIHRvIHRoZSBoZXhwYW5kIHRleHQgY29sdW1uOyB0aGUgZHJhd2VyIGNhcmRzIGZpbGwgdGhlIHNhbWUgd2lkdGguXG5jb25zdCBOQ0FSRF9XID0gMzI3XG5mdW5jdGlvbiBDYXJkKHsgbiB9OiB7IG46IE5vdGlmZC5Ob3RpZmljYXRpb24gfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJuY2FyZFwiIHNwYWNpbmc9ezEwfSB3aWR0aFJlcXVlc3Q9e05DQVJEX1d9PlxuICAgICAgICAgICAgey8qIGFwcCBpY29uIGluIGEgMzBcdTAwRDczMCByOSB0aWxlIChwcm90b3R5cGUgLm5pYykgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibmljXCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17bi5hcHBfaWNvbiB8fCBcImRpYWxvZy1pbmZvcm1hdGlvbi1zeW1ib2xpY1wifSBwaXhlbFNpemU9ezIwfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgPGJveD5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBoZXhwYW5kIGVsbGlwc2l6ZT17M30gbGFiZWw9e24uc3VtbWFyeX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIndoZW4gdG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e25ldyBEYXRlKG4udGltZSAqIDEwMDApLnRvTG9jYWxlVGltZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBob3VyOiBcIjItZGlnaXRcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtaW51dGU6IFwiMi1kaWdpdFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYm9keVwiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezB9XG4gICAgICAgICAgICAgICAgICAgIHdyYXBcbiAgICAgICAgICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17NDB9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtuLmJvZHl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm54XCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IG9uQ2xpY2tlZD17KCkgPT4gbi5kaXNtaXNzKCl9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNsb3NlLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUb2FzdHMobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICAgIC8vIE9ubHkgcmVuZGVyIG5vdGlmaWNhdGlvbnMgeW91bmdlciB0aGFuIFRPQVNUX01TIHdoaWxlIHRoZSBkcmF3ZXIgaXMgQ0xPU0VEIFx1MjAxNFxuICAgIC8vIG9wZW5pbmcgdGhlIGRyYXdlciBcImFkb3B0c1wiIHRoZW0gKHRoZXkgc2ltcGx5IGNvbnRpbnVlIGxpZmUgYXMgZHJhd2VyIGNhcmRzLFxuICAgIC8vIHdoaWNoIGlzIHRoZSBGTElQIGhhbmRvZmYgZXhwcmVzc2VkIGluIHJldGFpbmVkLW1vZGUgdGVybXMpLlxuICAgIGNvbnN0IGxpdmUgPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gICAgLy8gYHNob3duYCA9IHdoYXQgdGhlIHRvYXN0IGNvbHVtbiByZW5kZXJzLiBSZWNvbXB1dGVkIGV4cGxpY2l0bHkgb24gZXZlcnkgaW5wdXRcbiAgICAvLyBjaGFuZ2UgKFZhcmlhYmxlLmRlcml2ZSBkaWRuJ3QgcHJvZHVjZSBhIHJlYWN0aXZlIGJpbmRpbmcgaGVyZSkuIEVtcHR5IHdoaWxlIHRoZVxuICAgIC8vIGRyYXdlciBpcyBvcGVuICh0b2FzdHMgYXJlIEFET1BURUQgaW50byB0aGUgZHJhd2VyIHN0YWNrKS5cbiAgICBjb25zdCBzaG93biA9IFZhcmlhYmxlPG51bWJlcltdPihbXSlcbiAgICBjb25zdCByZWNvbXB1dGUgPSAoKSA9PiBzaG93bi5zZXQoZHJhd2VyT3Blbi5nZXQoKSA/IFtdIDogbGl2ZS5nZXQoKSlcbiAgICBsaXZlLnN1YnNjcmliZShyZWNvbXB1dGUpXG4gICAgZHJhd2VyT3Blbi5zdWJzY3JpYmUocmVjb21wdXRlKVxuICAgIG5kKCkuY29ubmVjdChcIm5vdGlmaWVkXCIsIChfbiwgaWQpID0+IHtcbiAgICAgICAgaWYgKGRyYXdlck9wZW4uZ2V0KCkgfHwgbmQoKS5kb250X2Rpc3R1cmIpIHJldHVyblxuICAgICAgICBsaXZlLnNldChbLi4ubGl2ZS5nZXQoKSwgaWRdKVxuICAgICAgICB0aW1lb3V0KFRPQVNUX01TLCAoKSA9PiBsaXZlLnNldChsaXZlLmdldCgpLmZpbHRlcigoeCkgPT4geCAhPT0gaWQpKSlcbiAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJ0b2FzdHNcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtdG9hc3RzXCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICAvLyBIaWRlIHRoZSB3aG9sZSB0b2FzdCBzdXJmYWNlIHdoaWxlIHRoZSBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG9cbiAgICAgICAgICAgIC8vIHRoZSBkcmF3ZXIpIFx1MjAxNCBhIHJlYWN0aXZlIHdpbmRvdy12aXNpYmlsaXR5IGJpbmQsIHJvYnVzdCByZWdhcmRsZXNzIG9mIHRoZVxuICAgICAgICAgICAgLy8gcGVyLWl0ZW0gbGlzdCByZWNvbmNpbGlhdGlvbi5cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJhd2VyT3BlbikuYXMoKG8pID0+ICFvKX1cbiAgICAgICAgICAgIC8vIFRvYXN0cyBhcmUgYSBmbG9hdGluZyBvdmVybGF5IChsaWtlIHRoZSBwcm90b3R5cGUncyBhYnNvbHV0ZSB0b3AvcmlnaHQpOyB0aGVcbiAgICAgICAgICAgIC8vIGZsb2F0IGluc2V0IGNsZWFycyB0aGUgZmxvYXRpbmcgYmFyIChtYXJnaW5Ub3AgMTAgKyBoZWlnaHQgNDIpICsgYSBzbWFsbCBnYXAsXG4gICAgICAgICAgICAvLyBhbmQgdGhlIHJpZ2h0IGluc2V0IG1hdGNoZXMgdGhlIGJhcidzIGVkZ2UgbWFyZ2luLlxuICAgICAgICAgICAgbWFyZ2luVG9wPXs1OH1cbiAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICAgICAgPlxuICAgICAgICAgICAgey8qIGZpeGVkIHRvYXN0IGNvbHVtbiB3aWR0aCBzbyB0aGUgY2FyZCBjYW4ndCBzdHJldGNoIHRvIGl0cyBoZXhwYW5kIHRleHQgY29sdW1uICovfVxuICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgc3BhY2luZz17OH1cbiAgICAgICAgICAgICAgICB3aWR0aFJlcXVlc3Q9e05DQVJEX1cgKyAyNn1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAge2JpbmQoc2hvd24pLmFzKChpZHMpID0+XG4gICAgICAgICAgICAgICAgICAgIGlkcy5tYXAoKGlkKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuID0gbmQoKS5nZXRfbm90aWZpY2F0aW9uKGlkKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG4gPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInRvYXN0XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxDYXJkIG49e259IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cblxuZnVuY3Rpb24gTWVkaWFDYXJkKCkge1xuICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgIGlmICghbXByaXMpIHJldHVybiBudWxsXG5cbiAgICBjb25zdCBwaWNrID0gKHBzOiBhbnlbXSkgPT5cbiAgICAgICAgcHMuZmluZCgocCkgPT4gcC5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdID8/IG51bGxcblxuICAgIGNvbnN0IG1lZGlhVGl0bGUgPSBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwaWNrKHBzKT8udGl0bGUgPz8gXCJcIilcbiAgICBjb25zdCBtZWRpYUFydGlzdCA9IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHBpY2socHMpPy5hcnRpc3QgPz8gXCJcIilcbiAgICBjb25zdCBwbGF5SWNvbiA9IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgY29uc3QgcCA9IHBpY2socHMpXG4gICAgICAgIHJldHVybiBwPy5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICA6IFwia29iZWwtcGxheS1zeW1ib2xpY1wiXG4gICAgfSlcbiAgICBjb25zdCBoYXNQbGF5ZXIgPSBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiBwcy5sZW5ndGggPiAwKVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBjbGFzcz1cIm5jYXJkIG1lZGlhXCIgc3BhY2luZz17MTF9IHZpc2libGU9e2hhc1BsYXllcn0+XG4gICAgICAgICAgICA8aW1hZ2UgcGl4ZWxTaXplPXs0Nn0gaWNvbk5hbWU9XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e21lZGlhVGl0bGV9IC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXttZWRpYUFydGlzdH0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwcmV2aW91c1wiKX0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1iYWNrLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3BsYXlJY29ufSAvPlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIG5leHRcIil9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXNraXAtZndkLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBEcmF3ZXIoKSB7XG4gICAgaWYgKHNraXAoKSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCBuZmQgPSBuZCgpXG4gICAgY29uc3QgbGlzdCA9IFZhcmlhYmxlPE5vdGlmZC5Ob3RpZmljYXRpb25bXT4obmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gICAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGxpc3Quc2V0KG5mZC5nZXRfbm90aWZpY2F0aW9ucygpID8/IFtdKVxuICAgIG5mZC5jb25uZWN0KFwibm90aWZpZWRcIiwgcmVmcmVzaClcbiAgICBuZmQuY29ubmVjdChcInJlc29sdmVkXCIsIHJlZnJlc2gpXG5cbiAgICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjAwLCAxNTApXG4gICAgcmVnaXN0ZXIoXCJkcmF3ZXJcIiwgdG9nZ2xlRm4pXG4gICAgLy8gS2VlcCBkcmF3ZXJPcGVuIGluIHN5bmMgd2l0aCB0aGUgcmV2ZWFsZWQgc3RhdGUgKHRvYXN0cyBhZG9wdCBpbnRvIGRyYXdlciB3aGVuIG9wZW4pXG4gICAgcmV2ZWFsZWQuc3Vic2NyaWJlKChyKSA9PiBkcmF3ZXJPcGVuLnNldChyKSlcblxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkcmF3ZXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZHJhd2VyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiZHJhd2VyLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4gKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9MRUZUfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjAwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0UmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImRyYXdlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICA8TWVkaWFDYXJkIC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPVwiTm90aWZpY2F0aW9uc1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0biBzdWJcIiBsYWJlbD17YmluZChsaXN0KS5hcygobikgPT4gYCR7bi5sZW5ndGggfHwgXCJcIn1gKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIm5jbGVhclwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKS5mb3JFYWNoKChuKSA9PiBuLmRpc21pc3MoKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXs1fT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtdHJhc2gtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJDbGVhclwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gdmV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtiaW5kKGxpc3QpLmFzKChucykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBucyAmJiBucy5sZW5ndGhcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBucy5tYXAoKG4pID0+IDxDYXJkIG49e259IC8+KVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm5jYXJkIGVtcHR5XCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIkFsbCBjYXVnaHQgdXAgXHUyNzEzXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIE9TRCBcdTIwMTQgZGlzcGxheS1vbmx5IHZvbHVtZSBwaWxsIGFib3ZlIHRoZSBkb2NrLiBQcm90b3R5cGU6IHBvaW50ZXItZXZlbnRzIG5vbmUsXG4vLyBhdXRvLWhpZGUgMS40cywgdHJhbnNsdWNlbnQgKGJsdXIgdmlhIGdub2JsaW4gd2luZG93LXJ1bGUpLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBPU0QobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICBjb25zdCB2aXNpYmxlID0gVmFyaWFibGUoZmFsc2UpXG4gICAgbGV0IGhpZGU6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcbiAgICBpZiAoIXNwZWFrZXIpIHJldHVybiBudWxsXG5cbiAgICBzcGVha2VyLmNvbm5lY3QoXCJub3RpZnk6OnZvbHVtZVwiLCAoKSA9PiB7XG4gICAgICAgIHZpc2libGUuc2V0KHRydWUpXG4gICAgICAgIGhpZGU/LmNhbmNlbCgpXG4gICAgICAgIGhpZGUgPSB0aW1lb3V0KDE0MDAsICgpID0+IHZpc2libGUuc2V0KGZhbHNlKSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cIm9zZFwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1vc2RcIlxuICAgICAgICAgICAgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICAgICAgICAgIG1hcmdpbkJvdHRvbT17NzB9XG4gICAgICAgICAgICBjbGlja1Rocm91Z2hcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQodmlzaWJsZSl9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJvc2RcIiBzcGFjaW5nPXsxMX0gd2lkdGhSZXF1ZXN0PXsyMzB9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17YmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsZXZlbGJhciBoZXhwYW5kIHZhbHVlPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInRuXCJcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIikuYXMoKHYpID0+IGAke01hdGgucm91bmQodiAqIDEwMCl9JWApfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFNlc3Npb24gb3ZlcmxheSBcdTIwMTQgZGltbWVkICgwLjgpLCA0IGJ1dHRvbnMsIGFycm93LW5hdiwgUFJFU1MtQUdBSU4gY29uZmlybSBvblxuLy8gUmVzdGFydC9TaHV0IGRvd24gKGF1dG8tcmV2ZXJ0IDRzKSwgcmVzdGluZyByb3NlIG9uIFNodXQgZG93bi5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciB9IGZyb20gXCIuLi9saWIvc3VyZmFjZVwiXG52b2lkIERFTU9cbnZvaWQgRFxuXG5jb25zdCBBQ1RJT05TID0gW1xuICAgIHtcbiAgICAgICAgaWQ6IFwibG9ja1wiLFxuICAgICAgICBsYWJlbDogXCJMb2NrXCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiBmYWxzZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJsb2dpbmN0bCBsb2NrLXNlc3Npb25cIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIGlkOiBcImxvZ291dFwiLFxuICAgICAgICBsYWJlbDogXCJMb2cgb3V0XCIsXG4gICAgICAgIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsXG4gICAgICAgIGNvbmZpcm06IGZhbHNlLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImdub21lLXNlc3Npb24tcXVpdCAtLWxvZ291dCAtLW5vLXByb21wdFwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgaWQ6IFwicmVzdGFydFwiLFxuICAgICAgICBsYWJlbDogXCJSZXN0YXJ0XCIsXG4gICAgICAgIGljb246IFwia29iZWwtcmVsb2FkLXN5bWJvbGljXCIsXG4gICAgICAgIGNvbmZpcm06IHRydWUsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwic3lzdGVtY3RsIHJlYm9vdFwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgaWQ6IFwic2h1dGRvd25cIixcbiAgICAgICAgbGFiZWw6IFwiU2h1dCBkb3duXCIsXG4gICAgICAgIGljb246IFwia29iZWwtcG93ZXItc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogdHJ1ZSxcbiAgICAgICAgcmVkOiB0cnVlLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCBwb3dlcm9mZlwiKSxcbiAgICB9LFxuXVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBTZXNzaW9uKCkge1xuICAgIGNvbnN0IGFybWVkID0gVmFyaWFibGU8c3RyaW5nIHwgbnVsbD4obnVsbClcbiAgICBsZXQgcmV2ZXJ0OiBSZXR1cm5UeXBlPHR5cGVvZiB0aW1lb3V0PiB8IG51bGwgPSBudWxsXG5cbiAgICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMTgwLCAxMzApXG4gICAgcmVnaXN0ZXIoXCJzZXNzaW9uXCIsIHRvZ2dsZUZuKVxuXG4gICAgY29uc3QgcHJlc3MgPSAoYTogKHR5cGVvZiBBQ1RJT05TKVtudW1iZXJdKSA9PiB7XG4gICAgICAgIGlmIChhLmNvbmZpcm0gJiYgYXJtZWQuZ2V0KCkgIT09IGEuaWQpIHtcbiAgICAgICAgICAgIGFybWVkLnNldChhLmlkKVxuICAgICAgICAgICAgcmV2ZXJ0Py5jYW5jZWwoKVxuICAgICAgICAgICAgcmV2ZXJ0ID0gdGltZW91dCg0MDAwLCAoKSA9PiBhcm1lZC5zZXQobnVsbCkpXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgfVxuICAgICAgICBhcm1lZC5zZXQobnVsbClcbiAgICAgICAgY2xvc2UoKVxuICAgICAgICBhLnJ1bigpXG4gICAgfVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cInNlc3Npb25cIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtc2Vzc2lvblwiXG4gICAgICAgICAgICBjbGFzcz1cInNlc3Npb24td2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e1xuICAgICAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5UT1AgfFxuICAgICAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5CT1RUT00gfFxuICAgICAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5MRUZUIHxcbiAgICAgICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuRVhDTFVTSVZFfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LklHTk9SRX1cbiAgICAgICAgICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSkge1xuICAgICAgICAgICAgICAgICAgICBhcm1lZC5zZXQobnVsbClcbiAgICAgICAgICAgICAgICAgICAgY2xvc2UoKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH19XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5DUk9TU0ZBREV9XG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsxODB9XG4gICAgICAgICAgICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICB7LyogLnNlc3Npb24gZmlsbHMgdGhlIHdob2xlIHdpbmRvdyAodGhlIGRpbSk7IGJ1dHRvbnMgY2VudGVyZWQgaW5zaWRlICovfVxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzZXNzaW9uXCIgaGV4cGFuZCB2ZXhwYW5kPlxuICAgICAgICAgICAgICAgICAgICA8Ym94IGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBzcGFjaW5nPXsyMH0gaGV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgIHtBQ1RJT05TLm1hcCgoYSkgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9e2EucmVkID8gXCJzYnRuIHJlZFwiIDogXCJzYnRuXCJ9IG9uQ2xpY2tlZD17KCkgPT4gcHJlc3MoYSl9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3BhY2luZz17MTB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17YmluZChhcm1lZCkuYXMoKHgpID0+ICh4ID09PSBhLmlkID8gXCJjb25maXJtXCIgOiBcIlwiKSl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInNpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZD17ZmFsc2V9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmV4cGFuZD17ZmFsc2V9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogaG9yaXpvbnRhbCBHdGtCb3ggaWdub3JlcyBhIGNoaWxkJ3MgbWFpbi1heGlzIGhhbGlnbiwgc28gdGhlIGljb25cbiAgICAgICAgICAgICAgICAgICAgbGVmdC1wYWNrczsgaGV4cGFuZCBtYWtlcyB0aGUgaW1hZ2UgZmlsbCB0aGUgNTlweCB0aWxlIFx1MjE5MiBHdGtJbWFnZVxuICAgICAgICAgICAgICAgICAgICBjZW50cmVzIHRoZSBnbHlwaC4gaGV4cGFuZD17ZmFsc2V9IG9uIC5zaWMgYmxvY2tzIHByb3BhZ2F0aW9uIHNvIHRoZVxuICAgICAgICAgICAgICAgICAgICB0aWxlIHN0YXlzIDU5IHdpZGUgaW5zdGVhZCBvZiBzdHJldGNoaW5nIHRoZSByb3cuICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT17YS5pY29ufVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezIyfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtiaW5kKGFybWVkKS5hcygoeCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgeCA9PT0gYS5pZCA/IFwiUHJlc3MgYWdhaW5cIiA6IGEubGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICApKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L3JldmVhbGVyPlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsT0FBT0EsWUFBVztBQUNsQixP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TUFBTSxRQUFRLEdBQUcsS0FBSztBQUV0QyxZQUFRLENBQUMsU0FBUyxZQUFJLFdBQVcsSUFBSSxDQUFRO0FBQUEsRUFDakQ7QUFBQTtBQUFBLEVBRUEsZUFBZSxTQUFTLEtBQUs7QUFDekIsVUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLFFBQVEsTUFBTSxHQUFHO0FBQ3BDLFFBQUksUUFBUSxVQUFVO0FBQ2xCLGFBQWMsR0FBRztBQUNqQixhQUFPLElBQUksSUFBSTtBQUFBLElBQ25CO0FBQ0EsUUFBSSxRQUFRLGNBQWM7QUFDdEIsa0JBQUksVUFBVSxlQUFRLFNBQVMsTUFBTSxHQUFHLElBQUk7QUFDNUMsYUFBTyxJQUFJLElBQUk7QUFBQSxJQUNuQjtBQUNBLFFBQUksU0FBUztBQUFBLEVBQ2pCO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFsiQXN0YWwiLCAiR3RrIiwgIkdkayIsICJBc3RhbCIsICJiaW5kIiwgImludGVydmFsIiwgInRpbWVvdXQiLCAiQXN0YWwiLCAiQXN0YWwiLCAiaW5pdCIsICJBc3RhbCIsICJ2IiwgImludGVydmFsIiwgImtleSIsICJjdG9ycyIsICJrZXkiLCAiR3RrIiwgIkFzdGFsIiwgInNuYWtlaWZ5IiwgInBhdGNoIiwgIkFwcHMiLCAiQmx1ZXRvb3RoIiwgIk1wcmlzIiwgIk5vdGlmZCIsICJXcCIsICJBcHAiLCAiR3RrIiwgIkFzdGFsIiwgIkFzdGFsIiwgIkd0ayIsICJHdGsiLCAiQXN0YWwiLCAiY2giLCAiR3RrIiwgIkdkayIsICJHaW8iLCAiR0xpYiIsICJkZWZhdWx0IiwgIkFzdGFsIiwgIkdPYmplY3QiLCAiZGVmYXVsdCIsICJHT2JqZWN0IiwgIkdpbyIsICJHTGliIiwgIkdpbyIsICJHTGliIiwgImluaXQiLCAiR0xpYiIsICJHTGliIiwgInR5cGUiLCAiR0xpYiIsICJBc3RhbCIsICJHdGsiLCAiR09iamVjdCIsICJBc3RhbCIsICJHdGsiLCAiR09iamVjdCIsICJhc3RhbGlmeSIsICJBc3RhbCIsICJHdGsiLCAiR09iamVjdCIsICJmaWx0ZXIiLCAiR3RrIiwgIkFzdGFsIiwgIkJveCIsICJhc3RhbGlmeSIsICJHT2JqZWN0IiwgIkJ1dHRvbiIsICJDZW50ZXJCb3giLCAiRW50cnkiLCAiTGFiZWwiLCAiTGV2ZWxCYXIiLCAiTWVudUJ1dHRvbiIsICJPdmVybGF5IiwgIlJldmVhbGVyIiwgIlNsaWRlciIsICJTdGFjayIsICJTd2l0Y2giLCAiV2luZG93IiwgImpzeCIsICJCb3giLCAiQnV0dG9uIiwgIkNlbnRlckJveCIsICJFbnRyeSIsICJMYWJlbCIsICJMZXZlbEJhciIsICJNZW51QnV0dG9uIiwgIk92ZXJsYXkiLCAiUmV2ZWFsZXIiLCAiU2xpZGVyIiwgIlN0YWNrIiwgIlN3aXRjaCIsICJXaW5kb3ciLCAiZGVmYXVsdCIsICJqc3giLCAid2lmaUljb24iLCAiR3RrIiwgIm4iLCAiQXN0YWwiLCAiR2lvIiwgImpzeCIsICJHdGsiLCAibiIsICJHZGsiLCAiR2lvIiwgIkFzdGFsIiwgIkFwcHMiLCAiTXByaXMiLCAiR0xpYiIsICJqc3giLCAiR3RrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiUElOTkVEIiwgIkFwcHMiLCAiZGVmYXVsdCIsICJuIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJNcHJpcyIsICJOZXR3b3JrIiwgIldwIiwgIkdpbyIsICJCYXR0ZXJ5IiwgIkdPYmplY3QiLCAiR3RrIiwgIlRpbnlTbGlkZXIiLCAiZGVmYXVsdCIsICJTVE9SRSIsICJqc3giLCAiR3RrIiwgIldwIiwgIkdpbyIsICJCYXR0ZXJ5IiwgIk5ldHdvcmsiLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJOb3RpZmQiLCAiTXByaXMiLCAiTm90aWZkIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiR3RrIiwgIkFzdGFsIiwgIk1wcmlzIiwgImtleSIsICJHZGsiLCAiV3AiLCAiV3AiLCAianN4IiwgIkFzdGFsIiwgIkFDVElPTlMiLCAianN4IiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiR3RrIiwgIkd0ayIsICJpbml0IiwgIkdkayJdCn0K
