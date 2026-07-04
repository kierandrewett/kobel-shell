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

// ../../../../usr/share/astal/gjs/gtk3/widget.ts
import Astal9 from "gi://Astal?version=3.0";
import Gtk6 from "gi://Gtk?version=3.0";
import GObject4 from "gi://GObject";

// ../../../../usr/share/astal/gjs/gtk3/astalify.ts
import Astal8 from "gi://Astal?version=3.0";
import Gtk5 from "gi://Gtk?version=3.0";
import GObject3 from "gi://GObject";
function astalify2(cls, clsName = cls.name) {
  class Widget extends cls {
    get css() {
      return Astal8.widget_get_css(this);
    }
    set css(css) {
      Astal8.widget_set_css(this, css);
    }
    get_css() {
      return this.css;
    }
    set_css(css) {
      this.css = css;
    }
    get className() {
      return Astal8.widget_get_class_names(this).join(" ");
    }
    set className(className) {
      Astal8.widget_set_class_names(this, className.split(/\s+/));
    }
    get_class_name() {
      return this.className;
    }
    set_class_name(className) {
      this.className = className;
    }
    get cursor() {
      return Astal8.widget_get_cursor(this);
    }
    set cursor(cursor) {
      Astal8.widget_set_cursor(this, cursor);
    }
    get_cursor() {
      return this.cursor;
    }
    set_cursor(cursor) {
      this.cursor = cursor;
    }
    get clickThrough() {
      return Astal8.widget_get_click_through(this);
    }
    set clickThrough(clickThrough) {
      Astal8.widget_set_click_through(this, clickThrough);
    }
    get_click_through() {
      return this.clickThrough;
    }
    set_click_through(clickThrough) {
      this.clickThrough = clickThrough;
    }
    get noImplicitDestroy() {
      return this[noImplicitDestroy];
    }
    set noImplicitDestroy(value) {
      this[noImplicitDestroy] = value;
    }
    set actionGroup([prefix, group]) {
      this.insert_action_group(prefix, group);
    }
    set_action_group(actionGroup) {
      this.actionGroup = actionGroup;
    }
    getChildren() {
      if (this instanceof Gtk5.Bin) {
        return this.get_child() ? [this.get_child()] : [];
      } else if (this instanceof Gtk5.Container) {
        return this.get_children();
      }
      return [];
    }
    setChildren(children) {
      children = children.flat(Infinity).map((ch) => ch instanceof Gtk5.Widget ? ch : new Gtk5.Label({ visible: true, label: String(ch) }));
      if (this instanceof Gtk5.Container) {
        for (const ch of children)
          this.add(ch);
      } else {
        throw Error(`can not add children to ${this.constructor.name}`);
      }
    }
    [setChildren](children) {
      if (this instanceof Gtk5.Container) {
        for (const ch of this.getChildren()) {
          this.remove(ch);
          if (!children.includes(ch) && !this.noImplicitDestroy)
            ch?.destroy();
        }
      }
      this.setChildren(children);
    }
    toggleClassName(cn, cond = true) {
      Astal8.widget_toggle_class_name(this, cn, cond);
    }
    hook(object, signalOrCallback, callback) {
      hook(this, object, signalOrCallback, callback);
      return this;
    }
    constructor(...params) {
      super();
      const props = params[0] || {};
      props.visible ??= true;
      construct(this, props);
    }
  }
  GObject3.registerClass({
    GTypeName: `Astal_${clsName}`,
    Properties: {
      "class-name": GObject3.ParamSpec.string(
        "class-name",
        "",
        "",
        GObject3.ParamFlags.READWRITE,
        ""
      ),
      "css": GObject3.ParamSpec.string(
        "css",
        "",
        "",
        GObject3.ParamFlags.READWRITE,
        ""
      ),
      "cursor": GObject3.ParamSpec.string(
        "cursor",
        "",
        "",
        GObject3.ParamFlags.READWRITE,
        "default"
      ),
      "click-through": GObject3.ParamSpec.boolean(
        "click-through",
        "",
        "",
        GObject3.ParamFlags.READWRITE,
        false
      ),
      "no-implicit-destroy": GObject3.ParamSpec.boolean(
        "no-implicit-destroy",
        "",
        "",
        GObject3.ParamFlags.READWRITE,
        false
      )
    }
  }, Widget);
  return Widget;
}

// ../../../../usr/share/astal/gjs/gtk3/widget.ts
function filter2(children) {
  return children.flat(Infinity).map((ch) => ch instanceof Gtk6.Widget ? ch : new Gtk6.Label({ visible: true, label: String(ch) }));
}
Object.defineProperty(Astal9.Box.prototype, "children", {
  get() {
    return this.get_children();
  },
  set(v) {
    this.set_children(v);
  }
});
var Box2 = class extends astalify2(Astal9.Box) {
  static {
    GObject4.registerClass({ GTypeName: "Box" }, this);
  }
  constructor(props, ...children) {
    super({ children, ...props });
  }
  setChildren(children) {
    this.set_children(filter2(children));
  }
};
var Button2 = class extends astalify2(Astal9.Button) {
  static {
    GObject4.registerClass({ GTypeName: "Button" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};
var CenterBox2 = class extends astalify2(Astal9.CenterBox) {
  static {
    GObject4.registerClass({ GTypeName: "CenterBox" }, this);
  }
  constructor(props, ...children) {
    super({ children, ...props });
  }
  setChildren(children) {
    const ch = filter2(children);
    this.startWidget = ch[0] || new Gtk6.Box();
    this.centerWidget = ch[1] || new Gtk6.Box();
    this.endWidget = ch[2] || new Gtk6.Box();
  }
};
var CircularProgress = class extends astalify2(Astal9.CircularProgress) {
  static {
    GObject4.registerClass({ GTypeName: "CircularProgress" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};
var DrawingArea = class extends astalify2(Gtk6.DrawingArea) {
  static {
    GObject4.registerClass({ GTypeName: "DrawingArea" }, this);
  }
  constructor(props) {
    super(props);
  }
};
var Entry2 = class extends astalify2(Gtk6.Entry) {
  static {
    GObject4.registerClass({ GTypeName: "Entry" }, this);
  }
  constructor(props) {
    super(props);
  }
};
var EventBox = class extends astalify2(Astal9.EventBox) {
  static {
    GObject4.registerClass({ GTypeName: "EventBox" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};
var Icon = class extends astalify2(Astal9.Icon) {
  static {
    GObject4.registerClass({ GTypeName: "Icon" }, this);
  }
  constructor(props) {
    super(props);
  }
};
var Label2 = class extends astalify2(Astal9.Label) {
  static {
    GObject4.registerClass({ GTypeName: "Label" }, this);
  }
  constructor(props) {
    super(props);
  }
  setChildren(children) {
    this.label = String(children);
  }
};
var LevelBar2 = class extends astalify2(Astal9.LevelBar) {
  static {
    GObject4.registerClass({ GTypeName: "LevelBar" }, this);
  }
  constructor(props) {
    super(props);
  }
};
var MenuButton2 = class extends astalify2(Gtk6.MenuButton) {
  static {
    GObject4.registerClass({ GTypeName: "MenuButton" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};
Object.defineProperty(Astal9.Overlay.prototype, "overlays", {
  get() {
    return this.get_overlays();
  },
  set(v) {
    this.set_overlays(v);
  }
});
var Overlay2 = class extends astalify2(Astal9.Overlay) {
  static {
    GObject4.registerClass({ GTypeName: "Overlay" }, this);
  }
  constructor(props, ...children) {
    super({ children, ...props });
  }
  setChildren(children) {
    const [child, ...overlays] = filter2(children);
    this.set_child(child);
    this.set_overlays(overlays);
  }
};
var Revealer2 = class extends astalify2(Gtk6.Revealer) {
  static {
    GObject4.registerClass({ GTypeName: "Revealer" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};
var Scrollable = class extends astalify2(Astal9.Scrollable) {
  static {
    GObject4.registerClass({ GTypeName: "Scrollable" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};
var Slider2 = class extends astalify2(Astal9.Slider) {
  static {
    GObject4.registerClass({ GTypeName: "Slider" }, this);
  }
  constructor(props) {
    super(props);
  }
};
var Stack2 = class extends astalify2(Astal9.Stack) {
  static {
    GObject4.registerClass({ GTypeName: "Stack" }, this);
  }
  constructor(props, ...children) {
    super({ children, ...props });
  }
  setChildren(children) {
    this.set_children(filter2(children));
  }
};
var Switch2 = class extends astalify2(Gtk6.Switch) {
  static {
    GObject4.registerClass({ GTypeName: "Switch" }, this);
  }
  constructor(props) {
    super(props);
  }
};
var Window2 = class extends astalify2(Astal9.Window) {
  static {
    GObject4.registerClass({ GTypeName: "Window" }, this);
  }
  constructor(props, child) {
    super({ child, ...props });
  }
};

// ../../../../usr/share/astal/gjs/gtk3/jsx-runtime.ts
function jsx2(ctor, props) {
  return jsx(ctors, ctor, props);
}
var ctors = {
  box: Box2,
  button: Button2,
  centerbox: CenterBox2,
  circularprogress: CircularProgress,
  drawingarea: DrawingArea,
  entry: Entry2,
  eventbox: EventBox,
  // TODO: fixed
  // TODO: flowbox
  icon: Icon,
  label: Label2,
  levelbar: LevelBar2,
  // TODO: listbox
  menubutton: MenuButton2,
  overlay: Overlay2,
  revealer: Revealer2,
  scrollable: Scrollable,
  slider: Slider2,
  stack: Stack2,
  switch: Switch2,
  window: Window2
};
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
                    label: bind(ghost).as((g) => {
                      const q = query.get();
                      return g.toLowerCase().startsWith(q.toLowerCase()) && q ? g : "";
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
  let player = null;
  try {
    player = Mpris3.get_default()?.players?.[0] ?? null;
  } catch {
    player = null;
  }
  if (!player) return /* @__PURE__ */ jsx2("box", { visible: false });
  return /* @__PURE__ */ jsxs("box", { class: "ncard media", spacing: 11, children: [
    /* @__PURE__ */ jsx2("image", { pixelSize: 46, iconName: "kobel-music-symbolic" }),
    /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, hexpand: true, valign: Gtk4.Align.CENTER, children: [
      /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, ellipsize: 3, label: bind(player, "title") }),
      /* @__PURE__ */ jsx2("label", { class: "sub", halign: Gtk4.Align.START, label: bind(player, "artist") })
    ] }),
    /* @__PURE__ */ jsx2("button", { onClicked: () => player.previous(), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-skip-back-symbolic" }) }),
    /* @__PURE__ */ jsx2("button", { onClicked: () => player.play_pause(), children: /* @__PURE__ */ jsx2(
      "image",
      {
        iconName: bind(player, "playback_status").as(
          (s) => s === Mpris3.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic"
        )
      }
    ) }),
    /* @__PURE__ */ jsx2("button", { onClicked: () => player.next(), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-skip-fwd-symbolic" }) })
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYWdzL2FwcC50cyIsICJzYXNzOi9ob21lL2tpZXJhbi9kZXYva29iZWwtc2hlbGwvYWdzL3N0eWxlL21haW4uc2NzcyIsICIuLi9hZ3MvY29uZmlnLnRzIiwgIi4uL2Fncy9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9hZ3Mvc2VydmljZXMvbm90aWZkLnRzIiwgIi4uL2Fncy9saWIvaW5zcGVjdC50cyIsICIuLi9hZ3MvbGliL3N1cmZhY2UudHMiLCAiLi4vYWdzL3dpZGdldC9CYXIudHN4IiwgIi4uL2Fncy9saWIvZGVtby50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL2d0azMvd2lkZ2V0LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrMy9hc3RhbGlmeS50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL2d0azMvanN4LXJ1bnRpbWUudHMiLCAiLi4vYWdzL3dpZGdldC9Eb2NrLnRzeCIsICIuLi9hZ3Mvd2lkZ2V0L0xhdW5jaGVyLnRzeCIsICIuLi9hZ3MvbGliL2Z1enp5LnRzIiwgIi4uL2Fncy93aWRnZXQvQ2FsZW5kYXIudHN4IiwgIi4uL2Fncy93aWRnZXQvUXVpY2tTZXR0aW5ncy50c3giLCAiLi4vYWdzL2xpYi90aW55c2xpZGVyLnRzIiwgIi4uL2Fncy93aWRnZXQvTm90aWZpY2F0aW9ucy50c3giLCAiLi4vYWdzL3dpZGdldC9PU0QudHN4IiwgIi4uL2Fncy93aWRnZXQvU2Vzc2lvbi50c3giXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSBDb25zdHJ1Y3RQcm9wcyB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZXhwb3J0IHsgQXN0YWwsIEd0aywgR2RrIH1cbmV4cG9ydCB7IGRlZmF1bHQgYXMgQXBwIH0gZnJvbSBcIi4vYXBwLmpzXCJcbmV4cG9ydCB7IGFzdGFsaWZ5LCBDb25zdHJ1Y3RQcm9wcyB9XG5leHBvcnQgKiBhcyBXaWRnZXQgZnJvbSBcIi4vd2lkZ2V0LmpzXCJcbmV4cG9ydCB7IGhvb2sgfSBmcm9tIFwiLi4vX2FzdGFsXCJcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgQmluZGluZywgeyB0eXBlIENvbm5lY3RhYmxlLCB0eXBlIFN1YnNjcmliYWJsZSB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuaW1wb3J0IHsgaW50ZXJ2YWwgfSBmcm9tIFwiLi90aW1lLmpzXCJcbmltcG9ydCB7IGV4ZWNBc3luYywgc3VicHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuXG5jbGFzcyBWYXJpYWJsZVdyYXBwZXI8VD4gZXh0ZW5kcyBGdW5jdGlvbiB7XG4gICAgcHJpdmF0ZSB2YXJpYWJsZSE6IEFzdGFsLlZhcmlhYmxlQmFzZVxuICAgIHByaXZhdGUgZXJySGFuZGxlcj8gPSBjb25zb2xlLmVycm9yXG5cbiAgICBwcml2YXRlIF92YWx1ZTogVFxuICAgIHByaXZhdGUgX3BvbGw/OiBBc3RhbC5UaW1lXG4gICAgcHJpdmF0ZSBfd2F0Y2g/OiBBc3RhbC5Qcm9jZXNzXG5cbiAgICBwcml2YXRlIHBvbGxJbnRlcnZhbCA9IDEwMDBcbiAgICBwcml2YXRlIHBvbGxFeGVjPzogc3RyaW5nW10gfCBzdHJpbmdcbiAgICBwcml2YXRlIHBvbGxUcmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICBwcml2YXRlIHBvbGxGbj86IChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPlxuXG4gICAgcHJpdmF0ZSB3YXRjaFRyYW5zZm9ybT86IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVFxuICAgIHByaXZhdGUgd2F0Y2hFeGVjPzogc3RyaW5nW10gfCBzdHJpbmdcblxuICAgIGNvbnN0cnVjdG9yKGluaXQ6IFQpIHtcbiAgICAgICAgc3VwZXIoKVxuICAgICAgICB0aGlzLl92YWx1ZSA9IGluaXRcbiAgICAgICAgdGhpcy52YXJpYWJsZSA9IG5ldyBBc3RhbC5WYXJpYWJsZUJhc2UoKVxuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJkcm9wcGVkXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3RvcFdhdGNoKClcbiAgICAgICAgICAgIHRoaXMuc3RvcFBvbGwoKVxuICAgICAgICB9KVxuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJlcnJvclwiLCAoXywgZXJyKSA9PiB0aGlzLmVyckhhbmRsZXI/LihlcnIpKVxuICAgICAgICByZXR1cm4gbmV3IFByb3h5KHRoaXMsIHtcbiAgICAgICAgICAgIGFwcGx5OiAodGFyZ2V0LCBfLCBhcmdzKSA9PiB0YXJnZXQuX2NhbGwoYXJnc1swXSksXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2FsbDxSID0gVD4odHJhbnNmb3JtPzogKHZhbHVlOiBUKSA9PiBSKTogQmluZGluZzxSPiB7XG4gICAgICAgIGNvbnN0IGIgPSBCaW5kaW5nLmJpbmQodGhpcylcbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybSA/IGIuYXModHJhbnNmb3JtKSA6IGIgYXMgdW5rbm93biBhcyBCaW5kaW5nPFI+XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBTdHJpbmcoYFZhcmlhYmxlPCR7dGhpcy5nZXQoKX0+YClcbiAgICB9XG5cbiAgICBnZXQoKTogVCB7IHJldHVybiB0aGlzLl92YWx1ZSB9XG4gICAgc2V0KHZhbHVlOiBUKSB7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gdGhpcy5fdmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMuX3ZhbHVlID0gdmFsdWVcbiAgICAgICAgICAgIHRoaXMudmFyaWFibGUuZW1pdChcImNoYW5nZWRcIilcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXJ0UG9sbCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3BvbGwpXG4gICAgICAgICAgICByZXR1cm5cblxuICAgICAgICBpZiAodGhpcy5wb2xsRm4pIHtcbiAgICAgICAgICAgIHRoaXMuX3BvbGwgPSBpbnRlcnZhbCh0aGlzLnBvbGxJbnRlcnZhbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB0aGlzLnBvbGxGbiEodGhpcy5nZXQoKSlcbiAgICAgICAgICAgICAgICBpZiAodiBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgdi50aGVuKHYgPT4gdGhpcy5zZXQodikpXG4gICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVycikpXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXQodilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMucG9sbEV4ZWMpIHtcbiAgICAgICAgICAgIHRoaXMuX3BvbGwgPSBpbnRlcnZhbCh0aGlzLnBvbGxJbnRlcnZhbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGV4ZWNBc3luYyh0aGlzLnBvbGxFeGVjISlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4odiA9PiB0aGlzLnNldCh0aGlzLnBvbGxUcmFuc2Zvcm0hKHYsIHRoaXMuZ2V0KCkpKSlcbiAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXJ0V2F0Y2goKSB7XG4gICAgICAgIGlmICh0aGlzLl93YXRjaClcbiAgICAgICAgICAgIHJldHVyblxuXG4gICAgICAgIHRoaXMuX3dhdGNoID0gc3VicHJvY2Vzcyh7XG4gICAgICAgICAgICBjbWQ6IHRoaXMud2F0Y2hFeGVjISxcbiAgICAgICAgICAgIG91dDogb3V0ID0+IHRoaXMuc2V0KHRoaXMud2F0Y2hUcmFuc2Zvcm0hKG91dCwgdGhpcy5nZXQoKSkpLFxuICAgICAgICAgICAgZXJyOiBlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSxcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBzdG9wUG9sbCgpIHtcbiAgICAgICAgdGhpcy5fcG9sbD8uY2FuY2VsKClcbiAgICAgICAgZGVsZXRlIHRoaXMuX3BvbGxcbiAgICB9XG5cbiAgICBzdG9wV2F0Y2goKSB7XG4gICAgICAgIHRoaXMuX3dhdGNoPy5raWxsKClcbiAgICAgICAgZGVsZXRlIHRoaXMuX3dhdGNoXG4gICAgfVxuXG4gICAgaXNQb2xsaW5nKCkgeyByZXR1cm4gISF0aGlzLl9wb2xsIH1cbiAgICBpc1dhdGNoaW5nKCkgeyByZXR1cm4gISF0aGlzLl93YXRjaCB9XG5cbiAgICBkcm9wKCkge1xuICAgICAgICB0aGlzLnZhcmlhYmxlLmVtaXQoXCJkcm9wcGVkXCIpXG4gICAgfVxuXG4gICAgb25Ecm9wcGVkKGNhbGxiYWNrOiAoKSA9PiB2b2lkKSB7XG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImRyb3BwZWRcIiwgY2FsbGJhY2spXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBvbkVycm9yKGNhbGxiYWNrOiAoZXJyOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuZXJySGFuZGxlclxuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJlcnJvclwiLCAoXywgZXJyKSA9PiBjYWxsYmFjayhlcnIpKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgc3Vic2NyaWJlKGNhbGxiYWNrOiAodmFsdWU6IFQpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgaWQgPSB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJjaGFuZ2VkXCIsICgpID0+IHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgIH0pXG4gICAgICAgIHJldHVybiAoKSA9PiB0aGlzLnZhcmlhYmxlLmRpc2Nvbm5lY3QoaWQpXG4gICAgfVxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgZXhlYzogc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgICAgIHRyYW5zZm9ybT86IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBjYWxsYmFjazogKHByZXY6IFQpID0+IFQgfCBQcm9taXNlPFQ+XG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdIHwgKChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPiksXG4gICAgICAgIHRyYW5zZm9ybTogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUID0gb3V0ID0+IG91dCBhcyBULFxuICAgICkge1xuICAgICAgICB0aGlzLnN0b3BQb2xsKClcbiAgICAgICAgdGhpcy5wb2xsSW50ZXJ2YWwgPSBpbnRlcnZhbFxuICAgICAgICB0aGlzLnBvbGxUcmFuc2Zvcm0gPSB0cmFuc2Zvcm1cbiAgICAgICAgaWYgKHR5cGVvZiBleGVjID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRoaXMucG9sbEZuID0gZXhlY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucG9sbEV4ZWNcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucG9sbEV4ZWMgPSBleGVjXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5wb2xsRm5cbiAgICAgICAgfVxuICAgICAgICB0aGlzLnN0YXJ0UG9sbCgpXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICB3YXRjaChcbiAgICAgICAgZXhlYzogc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgICAgIHRyYW5zZm9ybTogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUID0gb3V0ID0+IG91dCBhcyBULFxuICAgICkge1xuICAgICAgICB0aGlzLnN0b3BXYXRjaCgpXG4gICAgICAgIHRoaXMud2F0Y2hFeGVjID0gZXhlY1xuICAgICAgICB0aGlzLndhdGNoVHJhbnNmb3JtID0gdHJhbnNmb3JtXG4gICAgICAgIHRoaXMuc3RhcnRXYXRjaCgpXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmpzOiBBcnJheTxbb2JqOiBDb25uZWN0YWJsZSwgc2lnbmFsOiBzdHJpbmddPixcbiAgICAgICAgY2FsbGJhY2s6ICguLi5hcmdzOiBhbnlbXSkgPT4gVCxcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqOiBDb25uZWN0YWJsZSxcbiAgICAgICAgc2lnbmFsOiBzdHJpbmcsXG4gICAgICAgIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9ianM6IENvbm5lY3RhYmxlIHwgQXJyYXk8W29iajogQ29ubmVjdGFibGUsIHNpZ25hbDogc3RyaW5nXT4sXG4gICAgICAgIHNpZ09yRm46IHN0cmluZyB8ICgob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IFQpLFxuICAgICAgICBjYWxsYmFjaz86IChvYmo6IENvbm5lY3RhYmxlLCAuLi5hcmdzOiBhbnlbXSkgPT4gVCxcbiAgICApIHtcbiAgICAgICAgY29uc3QgZiA9IHR5cGVvZiBzaWdPckZuID09PSBcImZ1bmN0aW9uXCIgPyBzaWdPckZuIDogY2FsbGJhY2sgPz8gKCgpID0+IHRoaXMuZ2V0KCkpXG4gICAgICAgIGNvbnN0IHNldCA9IChvYmo6IENvbm5lY3RhYmxlLCAuLi5hcmdzOiBhbnlbXSkgPT4gdGhpcy5zZXQoZihvYmosIC4uLmFyZ3MpKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9ianMpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG9iaiBvZiBvYmpzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgW28sIHNdID0gb2JqXG4gICAgICAgICAgICAgICAgY29uc3QgaWQgPSBvLmNvbm5lY3Qocywgc2V0KVxuICAgICAgICAgICAgICAgIHRoaXMub25Ecm9wcGVkKCgpID0+IG8uZGlzY29ubmVjdChpZCkpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHNpZ09yRm4gPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZCA9IG9ianMuY29ubmVjdChzaWdPckZuLCBzZXQpXG4gICAgICAgICAgICAgICAgdGhpcy5vbkRyb3BwZWQoKCkgPT4gb2Jqcy5kaXNjb25uZWN0KGlkKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBzdGF0aWMgZGVyaXZlPFxuICAgICAgICBjb25zdCBEZXBzIGV4dGVuZHMgQXJyYXk8U3Vic2NyaWJhYmxlPGFueT4+LFxuICAgICAgICBBcmdzIGV4dGVuZHMge1xuICAgICAgICAgICAgW0sgaW4ga2V5b2YgRGVwc106IERlcHNbS10gZXh0ZW5kcyBTdWJzY3JpYmFibGU8aW5mZXIgVD4gPyBUIDogbmV2ZXJcbiAgICAgICAgfSxcbiAgICAgICAgViA9IEFyZ3MsXG4gICAgPihkZXBzOiBEZXBzLCBmbjogKC4uLmFyZ3M6IEFyZ3MpID0+IFYgPSAoLi4uYXJncykgPT4gYXJncyBhcyB1bmtub3duIGFzIFYpIHtcbiAgICAgICAgY29uc3QgdXBkYXRlID0gKCkgPT4gZm4oLi4uZGVwcy5tYXAoZCA9PiBkLmdldCgpKSBhcyBBcmdzKVxuICAgICAgICBjb25zdCBkZXJpdmVkID0gbmV3IFZhcmlhYmxlKHVwZGF0ZSgpKVxuICAgICAgICBjb25zdCB1bnN1YnMgPSBkZXBzLm1hcChkZXAgPT4gZGVwLnN1YnNjcmliZSgoKSA9PiBkZXJpdmVkLnNldCh1cGRhdGUoKSkpKVxuICAgICAgICBkZXJpdmVkLm9uRHJvcHBlZCgoKSA9PiB1bnN1YnMubWFwKHVuc3ViID0+IHVuc3ViKCkpKVxuICAgICAgICByZXR1cm4gZGVyaXZlZFxuICAgIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBWYXJpYWJsZTxUPiBleHRlbmRzIE9taXQ8VmFyaWFibGVXcmFwcGVyPFQ+LCBcImJpbmRcIj4ge1xuICAgIDxSPih0cmFuc2Zvcm06ICh2YWx1ZTogVCkgPT4gUik6IEJpbmRpbmc8Uj5cbiAgICAoKTogQmluZGluZzxUPlxufVxuXG5leHBvcnQgY29uc3QgVmFyaWFibGUgPSBuZXcgUHJveHkoVmFyaWFibGVXcmFwcGVyIGFzIGFueSwge1xuICAgIGFwcGx5OiAoX3QsIF9hLCBhcmdzKSA9PiBuZXcgVmFyaWFibGVXcmFwcGVyKGFyZ3NbMF0pLFxufSkgYXMge1xuICAgIGRlcml2ZTogdHlwZW9mIFZhcmlhYmxlV3JhcHBlcltcImRlcml2ZVwiXVxuICAgIDxUPihpbml0OiBUKTogVmFyaWFibGU8VD5cbiAgICBuZXc8VD4oaW5pdDogVCk6IFZhcmlhYmxlPFQ+XG59XG5cbmV4cG9ydCBjb25zdCB7IGRlcml2ZSB9ID0gVmFyaWFibGVcbmV4cG9ydCBkZWZhdWx0IFZhcmlhYmxlXG4iLCAiZXhwb3J0IGNvbnN0IHNuYWtlaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMV8kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5leHBvcnQgY29uc3Qga2ViYWJpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxLSQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJfXCIsIFwiLVwiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3Vic2NyaWJhYmxlPFQgPSB1bmtub3duPiB7XG4gICAgc3Vic2NyaWJlKGNhbGxiYWNrOiAodmFsdWU6IFQpID0+IHZvaWQpOiAoKSA9PiB2b2lkXG4gICAgZ2V0KCk6IFRcbiAgICBba2V5OiBzdHJpbmddOiBhbnlcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb25uZWN0YWJsZSB7XG4gICAgY29ubmVjdChzaWduYWw6IHN0cmluZywgY2FsbGJhY2s6ICguLi5hcmdzOiBhbnlbXSkgPT4gdW5rbm93bik6IG51bWJlclxuICAgIGRpc2Nvbm5lY3QoaWQ6IG51bWJlcik6IHZvaWRcbiAgICBba2V5OiBzdHJpbmddOiBhbnlcbn1cblxuZXhwb3J0IGNsYXNzIEJpbmRpbmc8VmFsdWU+IHtcbiAgICBwcml2YXRlIHRyYW5zZm9ybUZuID0gKHY6IGFueSkgPT4gdlxuXG4gICAgI2VtaXR0ZXI6IFN1YnNjcmliYWJsZTxWYWx1ZT4gfCBDb25uZWN0YWJsZVxuICAgICNwcm9wPzogc3RyaW5nXG5cbiAgICBzdGF0aWMgYmluZDxcbiAgICAgICAgVCBleHRlbmRzIENvbm5lY3RhYmxlLFxuICAgICAgICBQIGV4dGVuZHMga2V5b2YgVCxcbiAgICA+KG9iamVjdDogVCwgcHJvcGVydHk6IFApOiBCaW5kaW5nPFRbUF0+XG5cbiAgICBzdGF0aWMgYmluZDxUPihvYmplY3Q6IFN1YnNjcmliYWJsZTxUPik6IEJpbmRpbmc8VD5cblxuICAgIHN0YXRpYyBiaW5kKGVtaXR0ZXI6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlLCBwcm9wPzogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBuZXcgQmluZGluZyhlbWl0dGVyLCBwcm9wKVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0b3IoZW1pdHRlcjogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGU8VmFsdWU+LCBwcm9wPzogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuI2VtaXR0ZXIgPSBlbWl0dGVyXG4gICAgICAgIHRoaXMuI3Byb3AgPSBwcm9wICYmIGtlYmFiaWZ5KHByb3ApXG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBgQmluZGluZzwke3RoaXMuI2VtaXR0ZXJ9JHt0aGlzLiNwcm9wID8gYCwgXCIke3RoaXMuI3Byb3B9XCJgIDogXCJcIn0+YFxuICAgIH1cblxuICAgIGFzPFQ+KGZuOiAodjogVmFsdWUpID0+IFQpOiBCaW5kaW5nPFQ+IHtcbiAgICAgICAgY29uc3QgYmluZCA9IG5ldyBCaW5kaW5nKHRoaXMuI2VtaXR0ZXIsIHRoaXMuI3Byb3ApXG4gICAgICAgIGJpbmQudHJhbnNmb3JtRm4gPSAodjogVmFsdWUpID0+IGZuKHRoaXMudHJhbnNmb3JtRm4odikpXG4gICAgICAgIHJldHVybiBiaW5kIGFzIHVua25vd24gYXMgQmluZGluZzxUPlxuICAgIH1cblxuICAgIGdldCgpOiBWYWx1ZSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlci5nZXQgPT09IFwiZnVuY3Rpb25cIilcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXIuZ2V0KCkpXG5cbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNwcm9wID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBjb25zdCBnZXR0ZXIgPSBgZ2V0XyR7c25ha2VpZnkodGhpcy4jcHJvcCl9YFxuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyW2dldHRlcl0gPT09IFwiZnVuY3Rpb25cIilcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyW2dldHRlcl0oKSlcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlclt0aGlzLiNwcm9wXSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IEVycm9yKFwiY2FuIG5vdCBnZXQgdmFsdWUgb2YgYmluZGluZ1wiKVxuICAgIH1cblxuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBWYWx1ZSkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuc3Vic2NyaWJlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLiNlbWl0dGVyLnN1YnNjcmliZSgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sodGhpcy5nZXQoKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICBjb25zdCBzaWduYWwgPSBgbm90aWZ5Ojoke3RoaXMuI3Byb3B9YFxuICAgICAgICAgICAgY29uc3QgaWQgPSB0aGlzLiNlbWl0dGVyLmNvbm5lY3Qoc2lnbmFsLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sodGhpcy5nZXQoKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgICAgICh0aGlzLiNlbWl0dGVyLmRpc2Nvbm5lY3QgYXMgQ29ubmVjdGFibGVbXCJkaXNjb25uZWN0XCJdKShpZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBFcnJvcihgJHt0aGlzLiNlbWl0dGVyfSBpcyBub3QgYmluZGFibGVgKVxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IHsgYmluZCB9ID0gQmluZGluZ1xuZXhwb3J0IGRlZmF1bHQgQmluZGluZ1xuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcblxuZXhwb3J0IHR5cGUgVGltZSA9IEFzdGFsLlRpbWVcbmV4cG9ydCBjb25zdCBUaW1lID0gQXN0YWwuVGltZVxuXG5leHBvcnQgZnVuY3Rpb24gaW50ZXJ2YWwoaW50ZXJ2YWw6IG51bWJlciwgY2FsbGJhY2s/OiAoKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIEFzdGFsLlRpbWUuaW50ZXJ2YWwoaW50ZXJ2YWwsICgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZW91dCh0aW1lb3V0OiBudW1iZXIsIGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLnRpbWVvdXQodGltZW91dCwgKCkgPT4gdm9pZCBjYWxsYmFjaz8uKCkpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpZGxlKGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLmlkbGUoKCkgPT4gdm9pZCBjYWxsYmFjaz8uKCkpXG59XG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuXG50eXBlIEFyZ3MgPSB7XG4gICAgY21kOiBzdHJpbmcgfCBzdHJpbmdbXVxuICAgIG91dD86IChzdGRvdXQ6IHN0cmluZykgPT4gdm9pZFxuICAgIGVycj86IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZFxufVxuXG5leHBvcnQgdHlwZSBQcm9jZXNzID0gQXN0YWwuUHJvY2Vzc1xuZXhwb3J0IGNvbnN0IFByb2Nlc3MgPSBBc3RhbC5Qcm9jZXNzXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJwcm9jZXNzKGFyZ3M6IEFyZ3MpOiBBc3RhbC5Qcm9jZXNzXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJwcm9jZXNzKFxuICAgIGNtZDogc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgb25PdXQ/OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWQsXG4gICAgb25FcnI/OiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWQsXG4pOiBBc3RhbC5Qcm9jZXNzXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJwcm9jZXNzKFxuICAgIGFyZ3NPckNtZDogQXJncyB8IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgIG9uT3V0OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWQgPSBwcmludCxcbiAgICBvbkVycjogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkID0gcHJpbnRlcnIsXG4pIHtcbiAgICBjb25zdCBhcmdzID0gQXJyYXkuaXNBcnJheShhcmdzT3JDbWQpIHx8IHR5cGVvZiBhcmdzT3JDbWQgPT09IFwic3RyaW5nXCJcbiAgICBjb25zdCB7IGNtZCwgZXJyLCBvdXQgfSA9IHtcbiAgICAgICAgY21kOiBhcmdzID8gYXJnc09yQ21kIDogYXJnc09yQ21kLmNtZCxcbiAgICAgICAgZXJyOiBhcmdzID8gb25FcnIgOiBhcmdzT3JDbWQuZXJyIHx8IG9uRXJyLFxuICAgICAgICBvdXQ6IGFyZ3MgPyBvbk91dCA6IGFyZ3NPckNtZC5vdXQgfHwgb25PdXQsXG4gICAgfVxuXG4gICAgY29uc3QgcHJvYyA9IEFycmF5LmlzQXJyYXkoY21kKVxuICAgICAgICA/IEFzdGFsLlByb2Nlc3Muc3VicHJvY2Vzc3YoY21kKVxuICAgICAgICA6IEFzdGFsLlByb2Nlc3Muc3VicHJvY2VzcyhjbWQpXG5cbiAgICBwcm9jLmNvbm5lY3QoXCJzdGRvdXRcIiwgKF8sIHN0ZG91dDogc3RyaW5nKSA9PiBvdXQoc3Rkb3V0KSlcbiAgICBwcm9jLmNvbm5lY3QoXCJzdGRlcnJcIiwgKF8sIHN0ZGVycjogc3RyaW5nKSA9PiBlcnIoc3RkZXJyKSlcbiAgICByZXR1cm4gcHJvY1xufVxuXG4vKiogQHRocm93cyB7R0xpYi5FcnJvcn0gVGhyb3dzIHN0ZGVyciAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4ZWMoY21kOiBzdHJpbmcgfCBzdHJpbmdbXSkge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KGNtZClcbiAgICAgICAgPyBBc3RhbC5Qcm9jZXNzLmV4ZWN2KGNtZClcbiAgICAgICAgOiBBc3RhbC5Qcm9jZXNzLmV4ZWMoY21kKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZXhlY0FzeW5jKGNtZDogc3RyaW5nIHwgc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNtZCkpIHtcbiAgICAgICAgICAgIEFzdGFsLlByb2Nlc3MuZXhlY19hc3luY3YoY21kLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmN2X2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jKGNtZCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwuUHJvY2Vzcy5leGVjX2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsICJpbXBvcnQgVmFyaWFibGUgZnJvbSBcIi4vdmFyaWFibGUuanNcIlxuaW1wb3J0IHsgZXhlY0FzeW5jIH0gZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5pbXBvcnQgQmluZGluZywgeyBDb25uZWN0YWJsZSwga2ViYWJpZnksIHNuYWtlaWZ5LCBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcblxuZXhwb3J0IGNvbnN0IG5vSW1wbGljaXREZXN0cm95ID0gU3ltYm9sKFwibm8gbm8gaW1wbGljaXQgZGVzdHJveVwiKVxuZXhwb3J0IGNvbnN0IHNldENoaWxkcmVuID0gU3ltYm9sKFwiY2hpbGRyZW4gc2V0dGVyIG1ldGhvZFwiKVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCaW5kaW5ncyhhcnJheTogYW55W10pIHtcbiAgICBmdW5jdGlvbiBnZXRWYWx1ZXMoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgbGV0IGkgPSAwXG4gICAgICAgIHJldHVybiBhcnJheS5tYXAodmFsdWUgPT4gdmFsdWUgaW5zdGFuY2VvZiBCaW5kaW5nXG4gICAgICAgICAgICA/IGFyZ3NbaSsrXVxuICAgICAgICAgICAgOiB2YWx1ZSxcbiAgICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGJpbmRpbmdzID0gYXJyYXkuZmlsdGVyKGkgPT4gaSBpbnN0YW5jZW9mIEJpbmRpbmcpXG5cbiAgICBpZiAoYmluZGluZ3MubGVuZ3RoID09PSAwKVxuICAgICAgICByZXR1cm4gYXJyYXlcblxuICAgIGlmIChiaW5kaW5ncy5sZW5ndGggPT09IDEpXG4gICAgICAgIHJldHVybiBiaW5kaW5nc1swXS5hcyhnZXRWYWx1ZXMpXG5cbiAgICByZXR1cm4gVmFyaWFibGUuZGVyaXZlKGJpbmRpbmdzLCBnZXRWYWx1ZXMpKClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldFByb3Aob2JqOiBhbnksIHByb3A6IHN0cmluZywgdmFsdWU6IGFueSkge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNldHRlciA9IGBzZXRfJHtzbmFrZWlmeShwcm9wKX1gXG4gICAgICAgIGlmICh0eXBlb2Ygb2JqW3NldHRlcl0gPT09IFwiZnVuY3Rpb25cIilcbiAgICAgICAgICAgIHJldHVybiBvYmpbc2V0dGVyXSh2YWx1ZSlcblxuICAgICAgICByZXR1cm4gKG9ialtwcm9wXSA9IHZhbHVlKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYGNvdWxkIG5vdCBzZXQgcHJvcGVydHkgXCIke3Byb3B9XCIgb24gJHtvYmp9OmAsIGVycm9yKVxuICAgIH1cbn1cblxuZXhwb3J0IHR5cGUgQmluZGFibGVQcm9wczxUPiA9IHtcbiAgICBbSyBpbiBrZXlvZiBUXTogQmluZGluZzxUW0tdPiB8IFRbS107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBob29rPFdpZGdldCBleHRlbmRzIENvbm5lY3RhYmxlPihcbiAgICB3aWRnZXQ6IFdpZGdldCxcbiAgICBvYmplY3Q6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlLFxuICAgIHNpZ25hbE9yQ2FsbGJhY2s6IHN0cmluZyB8ICgoc2VsZjogV2lkZ2V0LCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCksXG4gICAgY2FsbGJhY2s/OiAoc2VsZjogV2lkZ2V0LCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbikge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIiAmJiBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBpZCA9IG9iamVjdC5jb25uZWN0KHNpZ25hbE9yQ2FsbGJhY2ssIChfOiBhbnksIC4uLmFyZ3M6IHVua25vd25bXSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHdpZGdldCwgLi4uYXJncylcbiAgICAgICAgfSlcbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsICgpID0+IHtcbiAgICAgICAgICAgIChvYmplY3QuZGlzY29ubmVjdCBhcyBDb25uZWN0YWJsZVtcImRpc2Nvbm5lY3RcIl0pKGlkKVxuICAgICAgICB9KVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIG9iamVjdC5zdWJzY3JpYmUgPT09IFwiZnVuY3Rpb25cIiAmJiB0eXBlb2Ygc2lnbmFsT3JDYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGNvbnN0IHVuc3ViID0gb2JqZWN0LnN1YnNjcmliZSgoLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgICAgICAgICBzaWduYWxPckNhbGxiYWNrKHdpZGdldCwgLi4uYXJncylcbiAgICAgICAgfSlcbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIHVuc3ViKVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnN0cnVjdDxXaWRnZXQgZXh0ZW5kcyBDb25uZWN0YWJsZSAmIHsgW3NldENoaWxkcmVuXTogKGNoaWxkcmVuOiBhbnlbXSkgPT4gdm9pZCB9Pih3aWRnZXQ6IFdpZGdldCwgY29uZmlnOiBhbnkpIHtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcHJlZmVyLWNvbnN0XG4gICAgbGV0IHsgc2V0dXAsIGNoaWxkLCBjaGlsZHJlbiA9IFtdLCAuLi5wcm9wcyB9ID0gY29uZmlnXG5cbiAgICBpZiAoY2hpbGRyZW4gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIGNoaWxkcmVuID0gW2NoaWxkcmVuXVxuICAgIH1cblxuICAgIGlmIChjaGlsZCkge1xuICAgICAgICBjaGlsZHJlbi51bnNoaWZ0KGNoaWxkKVxuICAgIH1cblxuICAgIC8vIHJlbW92ZSB1bmRlZmluZWQgdmFsdWVzXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gY29sbGVjdCBiaW5kaW5nc1xuICAgIGNvbnN0IGJpbmRpbmdzOiBBcnJheTxbc3RyaW5nLCBCaW5kaW5nPGFueT5dPiA9IE9iamVjdFxuICAgICAgICAua2V5cyhwcm9wcylcbiAgICAgICAgLnJlZHVjZSgoYWNjOiBhbnksIHByb3ApID0+IHtcbiAgICAgICAgICAgIGlmIChwcm9wc1twcm9wXSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiaW5kaW5nID0gcHJvcHNbcHJvcF1cbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNbcHJvcF1cbiAgICAgICAgICAgICAgICByZXR1cm4gWy4uLmFjYywgW3Byb3AsIGJpbmRpbmddXVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjY1xuICAgICAgICB9LCBbXSlcblxuICAgIC8vIGNvbGxlY3Qgc2lnbmFsIGhhbmRsZXJzXG4gICAgY29uc3Qgb25IYW5kbGVyczogQXJyYXk8W3N0cmluZywgc3RyaW5nIHwgKCgpID0+IHVua25vd24pXT4gPSBPYmplY3RcbiAgICAgICAgLmtleXMocHJvcHMpXG4gICAgICAgIC5yZWR1Y2UoKGFjYzogYW55LCBrZXkpID0+IHtcbiAgICAgICAgICAgIGlmIChrZXkuc3RhcnRzV2l0aChcIm9uXCIpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc2lnID0ga2ViYWJpZnkoa2V5KS5zcGxpdChcIi1cIikuc2xpY2UoMSkuam9pbihcIi1cIilcbiAgICAgICAgICAgICAgICBjb25zdCBoYW5kbGVyID0gcHJvcHNba2V5XVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1trZXldXG4gICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5hY2MsIFtzaWcsIGhhbmRsZXJdXVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjY1xuICAgICAgICB9LCBbXSlcblxuICAgIC8vIHNldCBjaGlsZHJlblxuICAgIGNvbnN0IG1lcmdlZENoaWxkcmVuID0gbWVyZ2VCaW5kaW5ncyhjaGlsZHJlbi5mbGF0KEluZmluaXR5KSlcbiAgICBpZiAobWVyZ2VkQ2hpbGRyZW4gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0obWVyZ2VkQ2hpbGRyZW4uZ2V0KCkpXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBtZXJnZWRDaGlsZHJlbi5zdWJzY3JpYmUoKHYpID0+IHtcbiAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0odilcbiAgICAgICAgfSkpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKG1lcmdlZENoaWxkcmVuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0obWVyZ2VkQ2hpbGRyZW4pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZXR1cCBzaWduYWwgaGFuZGxlcnNcbiAgICBmb3IgKGNvbnN0IFtzaWduYWwsIGNhbGxiYWNrXSBvZiBvbkhhbmRsZXJzKSB7XG4gICAgICAgIGNvbnN0IHNpZyA9IHNpZ25hbC5zdGFydHNXaXRoKFwibm90aWZ5XCIpXG4gICAgICAgICAgICA/IHNpZ25hbC5yZXBsYWNlKFwiLVwiLCBcIjo6XCIpXG4gICAgICAgICAgICA6IHNpZ25hbFxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgd2lkZ2V0LmNvbm5lY3Qoc2lnLCBjYWxsYmFjaylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KHNpZywgKCkgPT4gZXhlY0FzeW5jKGNhbGxiYWNrKVxuICAgICAgICAgICAgICAgIC50aGVuKHByaW50KS5jYXRjaChjb25zb2xlLmVycm9yKSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNldHVwIGJpbmRpbmdzIGhhbmRsZXJzXG4gICAgZm9yIChjb25zdCBbcHJvcCwgYmluZGluZ10gb2YgYmluZGluZ3MpIHtcbiAgICAgICAgaWYgKHByb3AgPT09IFwiY2hpbGRcIiB8fCBwcm9wID09PSBcImNoaWxkcmVuXCIpIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBiaW5kaW5nLnN1YnNjcmliZSgodjogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXSh2KVxuICAgICAgICAgICAgfSkpXG4gICAgICAgIH1cbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIGJpbmRpbmcuc3Vic2NyaWJlKCh2OiBhbnkpID0+IHtcbiAgICAgICAgICAgIHNldFByb3Aod2lkZ2V0LCBwcm9wLCB2KVxuICAgICAgICB9KSlcbiAgICAgICAgc2V0UHJvcCh3aWRnZXQsIHByb3AsIGJpbmRpbmcuZ2V0KCkpXG4gICAgfVxuXG4gICAgLy8gZmlsdGVyIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1trZXldXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBPYmplY3QuYXNzaWduKHdpZGdldCwgcHJvcHMpXG4gICAgc2V0dXA/Lih3aWRnZXQpXG4gICAgcmV0dXJuIHdpZGdldFxufVxuXG5mdW5jdGlvbiBpc0Fycm93RnVuY3Rpb24oZnVuYzogYW55KTogZnVuYyBpcyAoYXJnczogYW55KSA9PiBhbnkge1xuICAgIHJldHVybiAhT2JqZWN0Lmhhc093bihmdW5jLCBcInByb3RvdHlwZVwiKVxufVxuXG5leHBvcnQgZnVuY3Rpb24ganN4KFxuICAgIGN0b3JzOiBSZWNvcmQ8c3RyaW5nLCB7IG5ldyhwcm9wczogYW55KTogYW55IH0gfCAoKHByb3BzOiBhbnkpID0+IGFueSk+LFxuICAgIGN0b3I6IHN0cmluZyB8ICgocHJvcHM6IGFueSkgPT4gYW55KSB8IHsgbmV3KHByb3BzOiBhbnkpOiBhbnkgfSxcbiAgICB7IGNoaWxkcmVuLCAuLi5wcm9wcyB9OiBhbnksXG4pIHtcbiAgICBjaGlsZHJlbiA/Pz0gW11cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShjaGlsZHJlbikpXG4gICAgICAgIGNoaWxkcmVuID0gW2NoaWxkcmVuXVxuXG4gICAgY2hpbGRyZW4gPSBjaGlsZHJlbi5maWx0ZXIoQm9vbGVhbilcblxuICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPT09IDEpXG4gICAgICAgIHByb3BzLmNoaWxkID0gY2hpbGRyZW5bMF1cbiAgICBlbHNlIGlmIChjaGlsZHJlbi5sZW5ndGggPiAxKVxuICAgICAgICBwcm9wcy5jaGlsZHJlbiA9IGNoaWxkcmVuXG5cbiAgICBpZiAodHlwZW9mIGN0b3IgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaWYgKGlzQXJyb3dGdW5jdGlvbihjdG9yc1tjdG9yXSkpXG4gICAgICAgICAgICByZXR1cm4gY3RvcnNbY3Rvcl0ocHJvcHMpXG5cbiAgICAgICAgcmV0dXJuIG5ldyBjdG9yc1tjdG9yXShwcm9wcylcbiAgICB9XG5cbiAgICBpZiAoaXNBcnJvd0Z1bmN0aW9uKGN0b3IpKVxuICAgICAgICByZXR1cm4gY3Rvcihwcm9wcylcblxuICAgIHJldHVybiBuZXcgY3Rvcihwcm9wcylcbn1cbiIsICJpbXBvcnQgeyBub0ltcGxpY2l0RGVzdHJveSwgc2V0Q2hpbGRyZW4sIHR5cGUgQmluZGFibGVQcm9wcywgY29uc3RydWN0IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgQmluZGluZyBmcm9tIFwiLi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCBjb25zdCB0eXBlID0gU3ltYm9sKFwiY2hpbGQgdHlwZVwiKVxuY29uc3QgZHVtbXlCdWxkZXIgPSBuZXcgR3RrLkJ1aWxkZXJcblxuZnVuY3Rpb24gX2dldENoaWxkcmVuKHdpZGdldDogR3RrLldpZGdldCk6IEFycmF5PEd0ay5XaWRnZXQ+IHtcbiAgICBpZiAoXCJnZXRfY2hpbGRcIiBpbiB3aWRnZXQgJiYgdHlwZW9mIHdpZGdldC5nZXRfY2hpbGQgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiB3aWRnZXQuZ2V0X2NoaWxkKCkgPyBbd2lkZ2V0LmdldF9jaGlsZCgpXSA6IFtdXG4gICAgfVxuXG4gICAgY29uc3QgY2hpbGRyZW46IEFycmF5PEd0ay5XaWRnZXQ+ID0gW11cbiAgICBsZXQgY2ggPSB3aWRnZXQuZ2V0X2ZpcnN0X2NoaWxkKClcbiAgICB3aGlsZSAoY2ggIT09IG51bGwpIHtcbiAgICAgICAgY2hpbGRyZW4ucHVzaChjaClcbiAgICAgICAgY2ggPSBjaC5nZXRfbmV4dF9zaWJsaW5nKClcbiAgICB9XG4gICAgcmV0dXJuIGNoaWxkcmVuXG59XG5cbmZ1bmN0aW9uIF9zZXRDaGlsZHJlbih3aWRnZXQ6IEd0ay5XaWRnZXQsIGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICA/IGNoXG4gICAgICAgIDogbmV3IEd0ay5MYWJlbCh7IHZpc2libGU6IHRydWUsIGxhYmVsOiBTdHJpbmcoY2gpIH0pKVxuXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgIHdpZGdldC52ZnVuY19hZGRfY2hpbGQoXG4gICAgICAgICAgICBkdW1teUJ1bGRlcixcbiAgICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgICAgdHlwZSBpbiBjaGlsZCA/IGNoaWxkW3R5cGVdIDogbnVsbCxcbiAgICAgICAgKVxuICAgIH1cbn1cblxudHlwZSBDb25maWc8VCBleHRlbmRzIEd0ay5XaWRnZXQ+ID0ge1xuICAgIHNldENoaWxkcmVuKHdpZGdldDogVCwgY2hpbGRyZW46IGFueVtdKTogdm9pZFxuICAgIGdldENoaWxkcmVuKHdpZGdldDogVCk6IEFycmF5PEd0ay5XaWRnZXQ+XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFzdGFsaWZ5PFxuICAgIFdpZGdldCBleHRlbmRzIEd0ay5XaWRnZXQsXG4gICAgUHJvcHMgZXh0ZW5kcyBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMgPSBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMsXG4gICAgU2lnbmFscyBleHRlbmRzIFJlY29yZDxgb24ke3N0cmluZ31gLCBBcnJheTx1bmtub3duPj4gPSBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgYW55W10+LFxuPihjbHM6IHsgbmV3KC4uLmFyZ3M6IGFueVtdKTogV2lkZ2V0IH0sIGNvbmZpZzogUGFydGlhbDxDb25maWc8V2lkZ2V0Pj4gPSB7fSkge1xuICAgIE9iamVjdC5hc3NpZ24oY2xzLnByb3RvdHlwZSwge1xuICAgICAgICBbc2V0Q2hpbGRyZW5dKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgICAgICAgICAgY29uc3QgdyA9IHRoaXMgYXMgdW5rbm93biBhcyBXaWRnZXRcbiAgICAgICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgKGNvbmZpZy5nZXRDaGlsZHJlbj8uKHcpIHx8IF9nZXRDaGlsZHJlbih3KSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBHdGsuV2lkZ2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLnVucGFyZW50KClcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjaGlsZHJlbi5pbmNsdWRlcyhjaGlsZCkgJiYgbm9JbXBsaWNpdERlc3Ryb3kgaW4gdGhpcylcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkLnJ1bl9kaXNwb3NlKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjb25maWcuc2V0Q2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICBjb25maWcuc2V0Q2hpbGRyZW4odywgY2hpbGRyZW4pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIF9zZXRDaGlsZHJlbih3LCBjaGlsZHJlbilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgW2Nscy5uYW1lXTogKFxuICAgICAgICAgICAgcHJvcHM6IENvbnN0cnVjdFByb3BzPFdpZGdldCwgUHJvcHMsIFNpZ25hbHM+ID0ge30sXG4gICAgICAgICAgICAuLi5jaGlsZHJlbjogYW55W11cbiAgICAgICAgKTogV2lkZ2V0ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdpZGdldCA9IG5ldyBjbHMoXCJjc3NOYW1lXCIgaW4gcHJvcHMgPyB7IGNzc05hbWU6IHByb3BzLmNzc05hbWUgfSA6IHt9KVxuXG4gICAgICAgICAgICBpZiAoXCJjc3NOYW1lXCIgaW4gcHJvcHMpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMuY3NzTmFtZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocHJvcHMubm9JbXBsaWNpdERlc3Ryb3kpIHtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHdpZGdldCwgeyBbbm9JbXBsaWNpdERlc3Ryb3ldOiB0cnVlIH0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLm5vSW1wbGljaXREZXN0cm95XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChwcm9wcy50eXBlKSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHsgW3R5cGVdOiBwcm9wcy50eXBlIH0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLnR5cGVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNoaWxkcmVuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHByb3BzLCB7IGNoaWxkcmVuIH0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBjb25zdHJ1Y3Qod2lkZ2V0IGFzIGFueSwgc2V0dXBDb250cm9sbGVycyh3aWRnZXQsIHByb3BzIGFzIGFueSkpXG4gICAgICAgIH0sXG4gICAgfVtjbHMubmFtZV1cbn1cblxudHlwZSBTaWdIYW5kbGVyPFxuICAgIFcgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIEFyZ3MgZXh0ZW5kcyBBcnJheTx1bmtub3duPixcbj4gPSAoKHNlbGY6IFcsIC4uLmFyZ3M6IEFyZ3MpID0+IHVua25vd24pIHwgc3RyaW5nIHwgc3RyaW5nW11cblxuZXhwb3J0IHsgQmluZGFibGVQcm9wcyB9XG5leHBvcnQgdHlwZSBCaW5kYWJsZUNoaWxkID0gR3RrLldpZGdldCB8IEJpbmRpbmc8R3RrLldpZGdldD5cblxuZXhwb3J0IHR5cGUgQ29uc3RydWN0UHJvcHM8XG4gICAgU2VsZiBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgUHJvcHMgZXh0ZW5kcyBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMsXG4gICAgU2lnbmFscyBleHRlbmRzIFJlY29yZDxgb24ke3N0cmluZ31gLCBBcnJheTx1bmtub3duPj4gPSBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgYW55W10+LFxuPiA9IFBhcnRpYWw8e1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY2FuJ3QgYXNzaWduIHRvIHVua25vd24sIGJ1dCBpdCB3b3JrcyBhcyBleHBlY3RlZCB0aG91Z2hcbiAgICBbUyBpbiBrZXlvZiBTaWduYWxzXTogU2lnSGFuZGxlcjxTZWxmLCBTaWduYWxzW1NdPlxufT4gJiBQYXJ0aWFsPHtcbiAgICBbS2V5IGluIGBvbiR7c3RyaW5nfWBdOiBTaWdIYW5kbGVyPFNlbGYsIGFueVtdPlxufT4gJiBQYXJ0aWFsPEJpbmRhYmxlUHJvcHM8T21pdDxQcm9wcywgXCJjc3NOYW1lXCIgfCBcImNzc19uYW1lXCI+Pj4gJiB7XG4gICAgbm9JbXBsaWNpdERlc3Ryb3k/OiB0cnVlXG4gICAgdHlwZT86IHN0cmluZ1xuICAgIGNzc05hbWU/OiBzdHJpbmdcbn0gJiBFdmVudENvbnRyb2xsZXI8U2VsZj4gJiB7XG4gICAgb25EZXN0cm95PzogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBzZXR1cD86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG59XG5cbnR5cGUgRXZlbnRDb250cm9sbGVyPFNlbGYgZXh0ZW5kcyBHdGsuV2lkZ2V0PiA9IHtcbiAgICBvbkZvY3VzRW50ZXI/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuICAgIG9uRm9jdXNMZWF2ZT86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG5cbiAgICBvbktleVByZXNzZWQ/OiAoc2VsZjogU2VsZiwga2V5dmFsOiBudW1iZXIsIGtleWNvZGU6IG51bWJlciwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcbiAgICBvbktleVJlbGVhc2VkPzogKHNlbGY6IFNlbGYsIGtleXZhbDogbnVtYmVyLCBrZXljb2RlOiBudW1iZXIsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG4gICAgb25LZXlNb2RpZmllcj86IChzZWxmOiBTZWxmLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuXG4gICAgb25MZWdhY3k/OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdm9pZFxuICAgIG9uQnV0dG9uUHJlc3NlZD86IChzZWxmOiBTZWxmLCBzdGF0ZTogR2RrLkJ1dHRvbkV2ZW50KSA9PiB2b2lkXG4gICAgb25CdXR0b25SZWxlYXNlZD86IChzZWxmOiBTZWxmLCBzdGF0ZTogR2RrLkJ1dHRvbkV2ZW50KSA9PiB2b2lkXG5cbiAgICBvbkhvdmVyRW50ZXI/OiAoc2VsZjogU2VsZiwgeDogbnVtYmVyLCB5OiBudW1iZXIpID0+IHZvaWRcbiAgICBvbkhvdmVyTGVhdmU/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuICAgIG9uTW90aW9uPzogKHNlbGY6IFNlbGYsIHg6IG51bWJlciwgeTogbnVtYmVyKSA9PiB2b2lkXG5cbiAgICBvblNjcm9sbD86IChzZWxmOiBTZWxmLCBkeDogbnVtYmVyLCBkeTogbnVtYmVyKSA9PiB2b2lkXG4gICAgb25TY3JvbGxEZWNlbGVyYXRlPzogKHNlbGY6IFNlbGYsIHZlbF94OiBudW1iZXIsIHZlbF95OiBudW1iZXIpID0+IHZvaWRcbn1cblxuZnVuY3Rpb24gc2V0dXBDb250cm9sbGVyczxUPih3aWRnZXQ6IEd0ay5XaWRnZXQsIHtcbiAgICBvbkZvY3VzRW50ZXIsXG4gICAgb25Gb2N1c0xlYXZlLFxuICAgIG9uS2V5UHJlc3NlZCxcbiAgICBvbktleVJlbGVhc2VkLFxuICAgIG9uS2V5TW9kaWZpZXIsXG4gICAgb25MZWdhY3ksXG4gICAgb25CdXR0b25QcmVzc2VkLFxuICAgIG9uQnV0dG9uUmVsZWFzZWQsXG4gICAgb25Ib3ZlckVudGVyLFxuICAgIG9uSG92ZXJMZWF2ZSxcbiAgICBvbk1vdGlvbixcbiAgICBvblNjcm9sbCxcbiAgICBvblNjcm9sbERlY2VsZXJhdGUsXG4gICAgLi4ucHJvcHNcbn06IEV2ZW50Q29udHJvbGxlcjxHdGsuV2lkZ2V0PiAmIFQpIHtcbiAgICBpZiAob25Gb2N1c0VudGVyIHx8IG9uRm9jdXNMZWF2ZSkge1xuICAgICAgICBjb25zdCBmb2N1cyA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyRm9jdXNcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGZvY3VzKVxuXG4gICAgICAgIGlmIChvbkZvY3VzRW50ZXIpXG4gICAgICAgICAgICBmb2N1cy5jb25uZWN0KFwiZW50ZXJcIiwgKCkgPT4gb25Gb2N1c0VudGVyKHdpZGdldCkpXG5cbiAgICAgICAgaWYgKG9uRm9jdXNMZWF2ZSlcbiAgICAgICAgICAgIGZvY3VzLmNvbm5lY3QoXCJsZWF2ZVwiLCAoKSA9PiBvbkZvY3VzTGVhdmUod2lkZ2V0KSlcbiAgICB9XG5cbiAgICBpZiAob25LZXlQcmVzc2VkIHx8IG9uS2V5UmVsZWFzZWQgfHwgb25LZXlNb2RpZmllcikge1xuICAgICAgICBjb25zdCBrZXkgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlcktleVxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoa2V5KVxuXG4gICAgICAgIGlmIChvbktleVByZXNzZWQpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcImtleS1wcmVzc2VkXCIsIChfLCB2YWwsIGNvZGUsIHN0YXRlKSA9PiBvbktleVByZXNzZWQod2lkZ2V0LCB2YWwsIGNvZGUsIHN0YXRlKSlcblxuICAgICAgICBpZiAob25LZXlSZWxlYXNlZClcbiAgICAgICAgICAgIGtleS5jb25uZWN0KFwia2V5LXJlbGVhc2VkXCIsIChfLCB2YWwsIGNvZGUsIHN0YXRlKSA9PiBvbktleVJlbGVhc2VkKHdpZGdldCwgdmFsLCBjb2RlLCBzdGF0ZSkpXG5cbiAgICAgICAgaWYgKG9uS2V5TW9kaWZpZXIpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcIm1vZGlmaWVyc1wiLCAoXywgc3RhdGUpID0+IG9uS2V5TW9kaWZpZXIod2lkZ2V0LCBzdGF0ZSkpXG4gICAgfVxuXG4gICAgaWYgKG9uTGVnYWN5IHx8IG9uQnV0dG9uUHJlc3NlZCB8fCBvbkJ1dHRvblJlbGVhc2VkKSB7XG4gICAgICAgIGNvbnN0IGxlZ2FjeSA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyTGVnYWN5XG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihsZWdhY3kpXG5cbiAgICAgICAgbGVnYWN5LmNvbm5lY3QoXCJldmVudFwiLCAoXywgZXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmIChldmVudC5nZXRfZXZlbnRfdHlwZSgpID09PSBHZGsuRXZlbnRUeXBlLkJVVFRPTl9QUkVTUykge1xuICAgICAgICAgICAgICAgIG9uQnV0dG9uUHJlc3NlZD8uKHdpZGdldCwgZXZlbnQgYXMgR2RrLkJ1dHRvbkV2ZW50KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZXZlbnQuZ2V0X2V2ZW50X3R5cGUoKSA9PT0gR2RrLkV2ZW50VHlwZS5CVVRUT05fUkVMRUFTRSkge1xuICAgICAgICAgICAgICAgIG9uQnV0dG9uUmVsZWFzZWQ/Lih3aWRnZXQsIGV2ZW50IGFzIEdkay5CdXR0b25FdmVudClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb25MZWdhY3k/Lih3aWRnZXQsIGV2ZW50KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGlmIChvbk1vdGlvbiB8fCBvbkhvdmVyRW50ZXIgfHwgb25Ib3ZlckxlYXZlKSB7XG4gICAgICAgIGNvbnN0IGhvdmVyID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJNb3Rpb25cbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGhvdmVyKVxuXG4gICAgICAgIGlmIChvbkhvdmVyRW50ZXIpXG4gICAgICAgICAgICBob3Zlci5jb25uZWN0KFwiZW50ZXJcIiwgKF8sIHgsIHkpID0+IG9uSG92ZXJFbnRlcih3aWRnZXQsIHgsIHkpKVxuXG4gICAgICAgIGlmIChvbkhvdmVyTGVhdmUpXG4gICAgICAgICAgICBob3Zlci5jb25uZWN0KFwibGVhdmVcIiwgKCkgPT4gb25Ib3ZlckxlYXZlKHdpZGdldCkpXG5cbiAgICAgICAgaWYgKG9uTW90aW9uKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcIm1vdGlvblwiLCAoXywgeCwgeSkgPT4gb25Nb3Rpb24od2lkZ2V0LCB4LCB5KSlcbiAgICB9XG5cbiAgICBpZiAob25TY3JvbGwgfHwgb25TY3JvbGxEZWNlbGVyYXRlKSB7XG4gICAgICAgIGNvbnN0IHNjcm9sbCA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsXG4gICAgICAgIHNjcm9sbC5mbGFncyA9IEd0ay5FdmVudENvbnRyb2xsZXJTY3JvbGxGbGFncy5CT1RIX0FYRVMgfCBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsRmxhZ3MuS0lORVRJQ1xuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoc2Nyb2xsKVxuXG4gICAgICAgIGlmIChvblNjcm9sbClcbiAgICAgICAgICAgIHNjcm9sbC5jb25uZWN0KFwic2Nyb2xsXCIsIChfLCB4LCB5KSA9PiBvblNjcm9sbCh3aWRnZXQsIHgsIHkpKVxuXG4gICAgICAgIGlmIChvblNjcm9sbERlY2VsZXJhdGUpXG4gICAgICAgICAgICBzY3JvbGwuY29ubmVjdChcImRlY2VsZXJhdGVcIiwgKF8sIHgsIHkpID0+IG9uU2Nyb2xsRGVjZWxlcmF0ZSh3aWRnZXQsIHgsIHkpKVxuICAgIH1cblxuICAgIHJldHVybiBwcm9wc1xufVxuIiwgImltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWI/dmVyc2lvbj0yLjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcbmltcG9ydCB7IG1rQXBwIH0gZnJvbSBcIi4uL19hcHBcIlxuXG5HdGsuaW5pdCgpXG5cbi8vIHN0b3AgdGhpcyBmcm9tIGxlYWtpbmcgaW50byBzdWJwcm9jZXNzZXNcbi8vIGFuZCBnaW8gbGF1bmNoIGludm9jYXRpb25zXG5HTGliLnVuc2V0ZW52KFwiTERfUFJFTE9BRFwiKVxuXG4vLyB1c2VycyBtaWdodCB3YW50IHRvIHVzZSBBZHdhaXRhIGluIHdoaWNoIGNhc2UgaXQgaGFzIHRvIGJlIGluaXRpYWxpemVkXG4vLyBpdCBtaWdodCBiZSBjb21tb24gcGl0ZmFsbCB0byBmb3JnZXQgaXQgYmVjYXVzZSBgQXBwYCBpcyBub3QgYEFkdy5BcHBsaWNhdGlvbmBcbmF3YWl0IGltcG9ydChcImdpOi8vQWR3P3ZlcnNpb249MVwiKVxuICAgIC50aGVuKCh7IGRlZmF1bHQ6IEFkdyB9KSA9PiBBZHcuaW5pdCgpKVxuICAgIC5jYXRjaCgoKSA9PiB2b2lkIDApXG5cbmV4cG9ydCBkZWZhdWx0IG1rQXBwKEFzdGFsLkFwcGxpY2F0aW9uKVxuIiwgIi8qKlxuICogV29ya2Fyb3VuZCBmb3IgXCJDYW4ndCBjb252ZXJ0IG5vbi1udWxsIHBvaW50ZXIgdG8gSlMgdmFsdWUgXCJcbiAqL1xuXG5leHBvcnQgeyB9XG5cbmNvbnN0IHNuYWtlaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMV8kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5hc3luYyBmdW5jdGlvbiBzdXBwcmVzczxUPihtb2Q6IFByb21pc2U8eyBkZWZhdWx0OiBUIH0+LCBwYXRjaDogKG06IFQpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gbW9kLnRoZW4obSA9PiBwYXRjaChtLmRlZmF1bHQpKS5jYXRjaCgoKSA9PiB2b2lkIDApXG59XG5cbmZ1bmN0aW9uIHBhdGNoPFAgZXh0ZW5kcyBvYmplY3Q+KHByb3RvOiBQLCBwcm9wOiBFeHRyYWN0PGtleW9mIFAsIHN0cmluZz4pIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG8sIHByb3AsIHtcbiAgICAgICAgZ2V0KCkgeyByZXR1cm4gdGhpc1tgZ2V0XyR7c25ha2VpZnkocHJvcCl9YF0oKSB9LFxuICAgIH0pXG59XG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxBcHBzXCIpLCAoeyBBcHBzLCBBcHBsaWNhdGlvbiB9KSA9PiB7XG4gICAgcGF0Y2goQXBwcy5wcm90b3R5cGUsIFwibGlzdFwiKVxuICAgIHBhdGNoKEFwcGxpY2F0aW9uLnByb3RvdHlwZSwgXCJrZXl3b3Jkc1wiKVxuICAgIHBhdGNoKEFwcGxpY2F0aW9uLnByb3RvdHlwZSwgXCJjYXRlZ29yaWVzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQmF0dGVyeVwiKSwgKHsgVVBvd2VyIH0pID0+IHtcbiAgICBwYXRjaChVUG93ZXIucHJvdG90eXBlLCBcImRldmljZXNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxCbHVldG9vdGhcIiksICh7IEFkYXB0ZXIsIEJsdWV0b290aCwgRGV2aWNlIH0pID0+IHtcbiAgICBwYXRjaChBZGFwdGVyLnByb3RvdHlwZSwgXCJ1dWlkc1wiKVxuICAgIHBhdGNoKEJsdWV0b290aC5wcm90b3R5cGUsIFwiYWRhcHRlcnNcIilcbiAgICBwYXRjaChCbHVldG9vdGgucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChEZXZpY2UucHJvdG90eXBlLCBcInV1aWRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsSHlwcmxhbmRcIiksICh7IEh5cHJsYW5kLCBNb25pdG9yLCBXb3Jrc3BhY2UgfSkgPT4ge1xuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJiaW5kc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJtb25pdG9yc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJ3b3Jrc3BhY2VzXCIpXG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcImNsaWVudHNcIilcbiAgICBwYXRjaChNb25pdG9yLnByb3RvdHlwZSwgXCJhdmFpbGFibGVNb2Rlc1wiKVxuICAgIHBhdGNoKE1vbml0b3IucHJvdG90eXBlLCBcImF2YWlsYWJsZV9tb2Rlc1wiKVxuICAgIHBhdGNoKFdvcmtzcGFjZS5wcm90b3R5cGUsIFwiY2xpZW50c1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbE1wcmlzXCIpLCAoeyBNcHJpcywgUGxheWVyIH0pID0+IHtcbiAgICBwYXRjaChNcHJpcy5wcm90b3R5cGUsIFwicGxheWVyc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkX3VyaV9zY2hlbWVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRVcmlTY2hlbWVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRfbWltZV90eXBlc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkTWltZVR5cGVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJjb21tZW50c1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIiksICh7IFdpZmkgfSkgPT4ge1xuICAgIHBhdGNoKFdpZmkucHJvdG90eXBlLCBcImFjY2Vzc19wb2ludHNcIilcbiAgICBwYXRjaChXaWZpLnByb3RvdHlwZSwgXCJhY2Nlc3NQb2ludHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxOb3RpZmRcIiksICh7IE5vdGlmZCwgTm90aWZpY2F0aW9uIH0pID0+IHtcbiAgICBwYXRjaChOb3RpZmQucHJvdG90eXBlLCBcIm5vdGlmaWNhdGlvbnNcIilcbiAgICBwYXRjaChOb3RpZmljYXRpb24ucHJvdG90eXBlLCBcImFjdGlvbnNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxQb3dlclByb2ZpbGVzXCIpLCAoeyBQb3dlclByb2ZpbGVzIH0pID0+IHtcbiAgICBwYXRjaChQb3dlclByb2ZpbGVzLnByb3RvdHlwZSwgXCJhY3Rpb25zXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsV3BcIiksICh7IFdwLCBBdWRpbywgVmlkZW8gfSkgPT4ge1xuICAgIHBhdGNoKFdwLnByb3RvdHlwZSwgXCJlbmRwb2ludHNcIilcbiAgICBwYXRjaChXcC5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJzdHJlYW1zXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcInJlY29yZGVyc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJtaWNyb3Bob25lc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJzcGVha2Vyc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInN0cmVhbXNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwicmVjb3JkZXJzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInNpbmtzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInNvdXJjZXNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxufSlcbiIsICJpbXBvcnQgXCIuL292ZXJyaWRlcy5qc1wiXG5pbXBvcnQgeyBzZXRDb25zb2xlTG9nRG9tYWluIH0gZnJvbSBcImNvbnNvbGVcIlxuaW1wb3J0IHsgZXhpdCwgcHJvZ3JhbUFyZ3MgfSBmcm9tIFwic3lzdGVtXCJcbmltcG9ydCBJTyBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW8/dmVyc2lvbj0yLjBcIlxuaW1wb3J0IHR5cGUgQXN0YWwzIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249My4wXCJcbmltcG9ydCB0eXBlIEFzdGFsNCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5cbnR5cGUgQ29uZmlnID0gUGFydGlhbDx7XG4gICAgaW5zdGFuY2VOYW1lOiBzdHJpbmdcbiAgICBjc3M6IHN0cmluZ1xuICAgIGljb25zOiBzdHJpbmdcbiAgICBndGtUaGVtZTogc3RyaW5nXG4gICAgaWNvblRoZW1lOiBzdHJpbmdcbiAgICBjdXJzb3JUaGVtZTogc3RyaW5nXG4gICAgaG9sZDogYm9vbGVhblxuICAgIHJlcXVlc3RIYW5kbGVyKHJlcXVlc3Q6IHN0cmluZywgcmVzOiAocmVzcG9uc2U6IGFueSkgPT4gdm9pZCk6IHZvaWRcbiAgICBtYWluKC4uLmFyZ3M6IHN0cmluZ1tdKTogdm9pZFxuICAgIGNsaWVudChtZXNzYWdlOiAobXNnOiBzdHJpbmcpID0+IHN0cmluZywgLi4uYXJnczogc3RyaW5nW10pOiB2b2lkXG59PlxuXG5pbnRlcmZhY2UgQXN0YWwzSlMgZXh0ZW5kcyBBc3RhbDMuQXBwbGljYXRpb24ge1xuICAgIGV2YWwoYm9keTogc3RyaW5nKTogUHJvbWlzZTxhbnk+XG4gICAgcmVxdWVzdEhhbmRsZXI6IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG4gICAgYXBwbHlfY3NzKHN0eWxlOiBzdHJpbmcsIHJlc2V0PzogYm9vbGVhbik6IHZvaWRcbiAgICBxdWl0KGNvZGU/OiBudW1iZXIpOiB2b2lkXG4gICAgc3RhcnQoY29uZmlnPzogQ29uZmlnKTogdm9pZFxufVxuXG5pbnRlcmZhY2UgQXN0YWw0SlMgZXh0ZW5kcyBBc3RhbDQuQXBwbGljYXRpb24ge1xuICAgIGV2YWwoYm9keTogc3RyaW5nKTogUHJvbWlzZTxhbnk+XG4gICAgcmVxdWVzdEhhbmRsZXI/OiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldD86IGJvb2xlYW4pOiB2b2lkXG4gICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZFxuICAgIHN0YXJ0KGNvbmZpZz86IENvbmZpZyk6IHZvaWRcbn1cblxudHlwZSBBcHAzID0gdHlwZW9mIEFzdGFsMy5BcHBsaWNhdGlvblxudHlwZSBBcHA0ID0gdHlwZW9mIEFzdGFsNC5BcHBsaWNhdGlvblxuXG5leHBvcnQgZnVuY3Rpb24gbWtBcHA8QXBwIGV4dGVuZHMgQXBwMz4oQXBwOiBBcHApOiBBc3RhbDNKU1xuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwPEFwcCBleHRlbmRzIEFwcDQ+KEFwcDogQXBwKTogQXN0YWw0SlNcblxuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwKEFwcDogQXBwMyB8IEFwcDQpIHtcbiAgICByZXR1cm4gbmV3IChjbGFzcyBBc3RhbEpTIGV4dGVuZHMgQXBwIHtcbiAgICAgICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkFzdGFsSlNcIiB9LCB0aGlzIGFzIGFueSkgfVxuXG4gICAgICAgIGV2YWwoYm9keTogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzLCByZWopID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmbiA9IEZ1bmN0aW9uKGByZXR1cm4gKGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgJHtib2R5LmluY2x1ZGVzKFwiO1wiKSA/IGJvZHkgOiBgcmV0dXJuICR7Ym9keX07YH1cbiAgICAgICAgICAgICAgICAgICAgfSlgKVxuICAgICAgICAgICAgICAgICAgICBmbigpKCkudGhlbihyZXMpLmNhdGNoKHJlailcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWooZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcXVlc3RIYW5kbGVyPzogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cblxuICAgICAgICB2ZnVuY19yZXF1ZXN0KG1zZzogc3RyaW5nLCBjb25uOiBHaW8uU29ja2V0Q29ubmVjdGlvbik6IHZvaWQge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzLnJlcXVlc3RIYW5kbGVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlcXVlc3RIYW5kbGVyKG1zZywgKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIElPLndyaXRlX3NvY2soY29ubiwgU3RyaW5nKHJlc3BvbnNlKSwgKF8sIHJlcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgIElPLndyaXRlX3NvY2tfZmluaXNoKHJlcyksXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdXBlci52ZnVuY19yZXF1ZXN0KG1zZywgY29ubilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldCA9IGZhbHNlKSB7XG4gICAgICAgICAgICBzdXBlci5hcHBseV9jc3Moc3R5bGUsIHJlc2V0KVxuICAgICAgICB9XG5cbiAgICAgICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZCB7XG4gICAgICAgICAgICBzdXBlci5xdWl0KClcbiAgICAgICAgICAgIGV4aXQoY29kZSA/PyAwKVxuICAgICAgICB9XG5cbiAgICAgICAgc3RhcnQoeyByZXF1ZXN0SGFuZGxlciwgY3NzLCBob2xkLCBtYWluLCBjbGllbnQsIGljb25zLCAuLi5jZmcgfTogQ29uZmlnID0ge30pIHtcbiAgICAgICAgICAgIGNvbnN0IGFwcCA9IHRoaXMgYXMgdW5rbm93biBhcyBJbnN0YW5jZVR5cGU8QXBwMyB8IEFwcDQ+XG5cbiAgICAgICAgICAgIGNsaWVudCA/Pz0gKCkgPT4ge1xuICAgICAgICAgICAgICAgIHByaW50KGBBc3RhbCBpbnN0YW5jZSBcIiR7YXBwLmluc3RhbmNlTmFtZX1cIiBhbHJlYWR5IHJ1bm5pbmdgKVxuICAgICAgICAgICAgICAgIGV4aXQoMSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBjZmcpXG4gICAgICAgICAgICBzZXRDb25zb2xlTG9nRG9tYWluKGFwcC5pbnN0YW5jZU5hbWUpXG5cbiAgICAgICAgICAgIHRoaXMucmVxdWVzdEhhbmRsZXIgPSByZXF1ZXN0SGFuZGxlclxuICAgICAgICAgICAgYXBwLmNvbm5lY3QoXCJhY3RpdmF0ZVwiLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgbWFpbj8uKC4uLnByb2dyYW1BcmdzKVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhcHAuYWNxdWlyZV9zb2NrZXQoKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50KG1zZyA9PiBJTy5zZW5kX3JlcXVlc3QoYXBwLmluc3RhbmNlTmFtZSwgbXNnKSEsIC4uLnByb2dyYW1BcmdzKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY3NzKVxuICAgICAgICAgICAgICAgIHRoaXMuYXBwbHlfY3NzKGNzcywgZmFsc2UpXG5cbiAgICAgICAgICAgIGlmIChpY29ucylcbiAgICAgICAgICAgICAgICBhcHAuYWRkX2ljb25zKGljb25zKVxuXG4gICAgICAgICAgICBob2xkID8/PSB0cnVlXG4gICAgICAgICAgICBpZiAoaG9sZClcbiAgICAgICAgICAgICAgICBhcHAuaG9sZCgpXG5cbiAgICAgICAgICAgIGFwcC5ydW5Bc3luYyhbXSlcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBhc3RhbGlmeSwgeyB0eXBlLCB0eXBlIENvbnN0cnVjdFByb3BzIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuXG5mdW5jdGlvbiBmaWx0ZXIoY2hpbGRyZW46IGFueVtdKSB7XG4gICAgcmV0dXJuIGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcbn1cblxuLy8gQm94XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoQXN0YWwuQm94LnByb3RvdHlwZSwgXCJjaGlsZHJlblwiLCB7XG4gICAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfY2hpbGRyZW4oKSB9LFxuICAgIHNldCh2KSB7IHRoaXMuc2V0X2NoaWxkcmVuKHYpIH0sXG59KVxuXG5leHBvcnQgdHlwZSBCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLkJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgQm94ID0gYXN0YWxpZnk8QXN0YWwuQm94LCBBc3RhbC5Cb3guQ29uc3RydWN0b3JQcm9wcz4oQXN0YWwuQm94LCB7XG4gICAgZ2V0Q2hpbGRyZW4oc2VsZikgeyByZXR1cm4gc2VsZi5nZXRfY2hpbGRyZW4oKSB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7IHJldHVybiBzZWxmLnNldF9jaGlsZHJlbihmaWx0ZXIoY2hpbGRyZW4pKSB9LFxufSlcblxuLy8gQnV0dG9uXG50eXBlIEJ1dHRvblNpZ25hbHMgPSB7XG4gICAgb25DbGlja2VkOiBbXVxufVxuXG5leHBvcnQgdHlwZSBCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5CdXR0b24sIEd0ay5CdXR0b24uQ29uc3RydWN0b3JQcm9wcywgQnV0dG9uU2lnbmFscz5cbmV4cG9ydCBjb25zdCBCdXR0b24gPSBhc3RhbGlmeTxHdGsuQnV0dG9uLCBHdGsuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIEJ1dHRvblNpZ25hbHM+KEd0ay5CdXR0b24pXG5cbi8vIENlbnRlckJveFxuZXhwb3J0IHR5cGUgQ2VudGVyQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuQ2VudGVyQm94LCBHdGsuQ2VudGVyQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgQ2VudGVyQm94ID0gYXN0YWxpZnk8R3RrLkNlbnRlckJveCwgR3RrLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPihHdGsuQ2VudGVyQm94LCB7XG4gICAgZ2V0Q2hpbGRyZW4oYm94KSB7XG4gICAgICAgIHJldHVybiBbYm94LnN0YXJ0V2lkZ2V0LCBib3guY2VudGVyV2lkZ2V0LCBib3guZW5kV2lkZ2V0XVxuICAgIH0sXG4gICAgc2V0Q2hpbGRyZW4oYm94LCBjaGlsZHJlbikge1xuICAgICAgICBjb25zdCBjaCA9IGZpbHRlcihjaGlsZHJlbilcbiAgICAgICAgYm94LnN0YXJ0V2lkZ2V0ID0gY2hbMF0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgYm94LmNlbnRlcldpZGdldCA9IGNoWzFdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIGJveC5lbmRXaWRnZXQgPSBjaFsyXSB8fCBuZXcgR3RrLkJveFxuICAgIH0sXG59KVxuXG4vLyBUT0RPOiBDaXJjdWxhclByb2dyZXNzXG4vLyBUT0RPOiBEcmF3aW5nQXJlYVxuXG4vLyBFbnRyeVxudHlwZSBFbnRyeVNpZ25hbHMgPSB7XG4gICAgb25BY3RpdmF0ZTogW11cbiAgICBvbk5vdGlmeVRleHQ6IFtdXG59XG5cbmV4cG9ydCB0eXBlIEVudHJ5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuRW50cnksIEd0ay5FbnRyeS5Db25zdHJ1Y3RvclByb3BzLCBFbnRyeVNpZ25hbHM+XG5leHBvcnQgY29uc3QgRW50cnkgPSBhc3RhbGlmeTxHdGsuRW50cnksIEd0ay5FbnRyeS5Db25zdHJ1Y3RvclByb3BzLCBFbnRyeVNpZ25hbHM+KEd0ay5FbnRyeSwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIEltYWdlXG5leHBvcnQgdHlwZSBJbWFnZVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkltYWdlLCBHdGsuSW1hZ2UuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBJbWFnZSA9IGFzdGFsaWZ5PEd0ay5JbWFnZSwgR3RrLkltYWdlLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5JbWFnZSwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIExhYmVsXG5leHBvcnQgdHlwZSBMYWJlbFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkxhYmVsLCBHdGsuTGFiZWwuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBMYWJlbCA9IGFzdGFsaWZ5PEd0ay5MYWJlbCwgR3RrLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5MYWJlbCwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikgeyBzZWxmLmxhYmVsID0gU3RyaW5nKGNoaWxkcmVuKSB9LFxufSlcblxuLy8gTGV2ZWxCYXJcbmV4cG9ydCB0eXBlIExldmVsQmFyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuTGV2ZWxCYXIsIEd0ay5MZXZlbEJhci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IExldmVsQmFyID0gYXN0YWxpZnk8R3RrLkxldmVsQmFyLCBHdGsuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLkxldmVsQmFyLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gVE9ETzogTGlzdEJveFxuXG4vLyBPdmVybGF5XG5leHBvcnQgdHlwZSBPdmVybGF5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuT3ZlcmxheSwgR3RrLk92ZXJsYXkuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBPdmVybGF5ID0gYXN0YWxpZnk8R3RrLk92ZXJsYXksIEd0ay5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5PdmVybGF5LCB7XG4gICAgZ2V0Q2hpbGRyZW4oc2VsZikge1xuICAgICAgICBjb25zdCBjaGlsZHJlbjogQXJyYXk8R3RrLldpZGdldD4gPSBbXVxuICAgICAgICBsZXQgY2ggPSBzZWxmLmdldF9maXJzdF9jaGlsZCgpXG4gICAgICAgIHdoaWxlIChjaCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2hpbGRyZW4ucHVzaChjaClcbiAgICAgICAgICAgIGNoID0gY2guZ2V0X25leHRfc2libGluZygpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY2hpbGRyZW4uZmlsdGVyKGNoID0+IGNoICE9PSBzZWxmLmNoaWxkKVxuICAgIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBjb25zdCB0eXBlcyA9IHR5cGUgaW4gY2hpbGRcbiAgICAgICAgICAgICAgICA/IChjaGlsZFt0eXBlXSBhcyBzdHJpbmcpLnNwbGl0KC9cXHMrLylcbiAgICAgICAgICAgICAgICA6IFtdXG5cbiAgICAgICAgICAgIGlmICh0eXBlcy5pbmNsdWRlcyhcIm92ZXJsYXlcIikpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9vdmVybGF5KGNoaWxkKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLnNldF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2VsZi5zZXRfbWVhc3VyZV9vdmVybGF5KGNoaWxkLCB0eXBlcy5pbmNsdWRlcyhcIm1lYXN1cmVcIikpXG4gICAgICAgICAgICBzZWxmLnNldF9jbGlwX292ZXJsYXkoY2hpbGQsIHR5cGVzLmluY2x1ZGVzKFwiY2xpcFwiKSlcbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBSZXZlYWxlclxuZXhwb3J0IHR5cGUgUmV2ZWFsZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5SZXZlYWxlciwgR3RrLlJldmVhbGVyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgUmV2ZWFsZXIgPSBhc3RhbGlmeTxHdGsuUmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPihHdGsuUmV2ZWFsZXIpXG5cbi8vIFNsaWRlclxudHlwZSBTbGlkZXJTaWduYWxzID0ge1xuICAgIG9uQ2hhbmdlVmFsdWU6IFtdXG59XG5cbmV4cG9ydCB0eXBlIFNsaWRlclByb3BzID0gQ29uc3RydWN0UHJvcHM8QXN0YWwuU2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywgU2xpZGVyU2lnbmFscz5cbmV4cG9ydCBjb25zdCBTbGlkZXIgPSBhc3RhbGlmeTxBc3RhbC5TbGlkZXIsIEFzdGFsLlNsaWRlci5Db25zdHJ1Y3RvclByb3BzLCBTbGlkZXJTaWduYWxzPihBc3RhbC5TbGlkZXIsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBTdGFja1xuZXhwb3J0IHR5cGUgU3RhY2tQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5TdGFjaywgR3RrLlN0YWNrLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgU3RhY2sgPSBhc3RhbGlmeTxHdGsuU3RhY2ssIEd0ay5TdGFjay5Db25zdHJ1Y3RvclByb3BzPihHdGsuU3RhY2ssIHtcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZpbHRlcihjaGlsZHJlbikpIHtcbiAgICAgICAgICAgIGlmIChjaGlsZC5uYW1lICE9IFwiXCIgJiYgY2hpbGQubmFtZSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfbmFtZWQoY2hpbGQsIGNoaWxkLm5hbWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFN3aXRjaFxuZXhwb3J0IHR5cGUgU3dpdGNoUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuU3dpdGNoLCBHdGsuU3dpdGNoLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgU3dpdGNoID0gYXN0YWxpZnk8R3RrLlN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPihHdGsuU3dpdGNoLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gV2luZG93XG5leHBvcnQgdHlwZSBXaW5kb3dQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLldpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgV2luZG93ID0gYXN0YWxpZnk8QXN0YWwuV2luZG93LCBBc3RhbC5XaW5kb3cuQ29uc3RydWN0b3JQcm9wcz4oQXN0YWwuV2luZG93KVxuXG4vLyBNZW51QnV0dG9uXG5leHBvcnQgdHlwZSBNZW51QnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuTWVudUJ1dHRvbiwgR3RrLk1lbnVCdXR0b24uQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBNZW51QnV0dG9uID0gYXN0YWxpZnk8R3RrLk1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5NZW51QnV0dG9uLCB7XG4gICAgZ2V0Q2hpbGRyZW4oc2VsZikgeyByZXR1cm4gW3NlbGYucG9wb3Zlciwgc2VsZi5jaGlsZF0gfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZpbHRlcihjaGlsZHJlbikpIHtcbiAgICAgICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEd0ay5Qb3BvdmVyKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfcG9wb3ZlcihjaGlsZClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gUG9wb3BlclxuZXhwb3J0IHR5cGUgUG9wb3ZlclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlBvcG92ZXIsIEd0ay5Qb3BvdmVyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgUG9wb3ZlciA9IGFzdGFsaWZ5PEd0ay5Qb3BvdmVyLCBHdGsuUG9wb3Zlci5Db25zdHJ1Y3RvclByb3BzPihHdGsuUG9wb3ZlcilcbiIsICIvLyBrb2JlbC1zaGVsbCBlbnRyeSBcdTIwMTQgQUdTIHYyIC8gYXN0YWw0XG5pbXBvcnQgeyBBcHAgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTQuMFwiXG4vLyBhc3RhbCBgY29uc3RydWN0YCBzZXRzIHN0YXRpYyBwcm9wcyB2aWEgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHByb3BzKSBhbmQgYmluZGluZ3MgdmlhXG4vLyBzZXRQcm9wIFx1MjE5MiBzZXRfY2xhc3MuIEd0a1dpZGdldCBoYXMgbmVpdGhlciBhIGBjbGFzc2AgR09iamVjdCBwcm9wIG5vciBzZXRfY2xhc3MsIHNvXG4vLyBgY2xhc3M9XCIuLi5cImAgc2lsZW50bHkgbm8tb3BzICh0aGUgcmVhbCBwcm9wIGlzIGBjc3MtY2xhc3Nlc2AsIGFuIGFycmF5KS4gRGVmaW5lIGFcbi8vIGBjbGFzc2AgYWNjZXNzb3Igcm91dGluZyBCT1RIIHBhdGhzIHRvIHNldF9jc3NfY2xhc3Nlcywgc28gYGNsYXNzPVwiYSBiXCJgIHdvcmtzLlxuT2JqZWN0LmRlZmluZVByb3BlcnR5KChHdGsuV2lkZ2V0IGFzIGFueSkucHJvdG90eXBlLCBcImNsYXNzXCIsIHtcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgc2V0KHY6IHN0cmluZykge1xuICAgICAgICB0aGlzLnNldF9jc3NfY2xhc3NlcyhTdHJpbmcodikuc3BsaXQoL1xccysvKS5maWx0ZXIoQm9vbGVhbikpXG4gICAgfSxcbiAgICBnZXQoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldF9jc3NfY2xhc3NlcygpLmpvaW4oXCIgXCIpXG4gICAgfSxcbn0pXG47KEd0ay5XaWRnZXQucHJvdG90eXBlIGFzIGFueSkuc2V0X2NsYXNzID0gZnVuY3Rpb24gKHY6IHN0cmluZykge1xuICAgIHRoaXMuc2V0X2Nzc19jbGFzc2VzKFN0cmluZyh2KS5zcGxpdCgvXFxzKy8pLmZpbHRlcihCb29sZWFuKSlcbn1cbmltcG9ydCBzdHlsZSBmcm9tIFwiLi9zdHlsZS9tYWluLnNjc3NcIlxuaW1wb3J0IHsgdG9rZW5Dc3MsIHRva2VucyB9IGZyb20gXCIuL2NvbmZpZ1wiXG5pbXBvcnQgKiBhcyBnbm9ibGluIGZyb20gXCIuL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0ICogYXMgbm90aWZkU3ZjIGZyb20gXCIuL3NlcnZpY2VzL25vdGlmZFwiXG5pbXBvcnQgeyBhcm1EdW1wIH0gZnJvbSBcIi4vbGliL2luc3BlY3RcIlxuaW1wb3J0IHsgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi9saWIvc3VyZmFjZVwiXG5pbXBvcnQgQmFyIGZyb20gXCIuL3dpZGdldC9CYXJcIlxuaW1wb3J0IERvY2sgZnJvbSBcIi4vd2lkZ2V0L0RvY2tcIlxuaW1wb3J0IExhdW5jaGVyIGZyb20gXCIuL3dpZGdldC9MYXVuY2hlclwiXG5pbXBvcnQgUXVpY2tTZXR0aW5ncyBmcm9tIFwiLi93aWRnZXQvUXVpY2tTZXR0aW5nc1wiXG5pbXBvcnQgQ2FsZW5kYXIgZnJvbSBcIi4vd2lkZ2V0L0NhbGVuZGFyXCJcbmltcG9ydCB7IFRvYXN0cywgRHJhd2VyIH0gZnJvbSBcIi4vd2lkZ2V0L05vdGlmaWNhdGlvbnNcIlxuaW1wb3J0IE9TRCBmcm9tIFwiLi93aWRnZXQvT1NEXCJcbmltcG9ydCBTZXNzaW9uIGZyb20gXCIuL3dpZGdldC9TZXNzaW9uXCJcblxucHJpbnRlcnIoXCJLT0JFTDogbW9kdWxlIHRvcCByZWFjaGVkXCIpXG5cbi8vIEN1c3RvbSBpY29uIHNldCBcdTIwMTQgdGhlIGV4YWN0IEhlcm9pY29ucy9MdWNpZGUvVGFibGVyIHRoZSBwcm90b3R5cGUgdXNlcywgYXNcbi8vIHJlY29sb3JhYmxlIHN5bWJvbGljIFNWR3MuIFJlZ2lzdGVyZWQgb24gdGhlIGRlZmF1bHQgaWNvbiB0aGVtZSBzbyBpY29uTmFtZVxuLy8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgZXRjLiByZXNvbHZlLiBQYXRoIG92ZXJyaWRlIHZpYSBLT0JFTF9JQ09OUyBmb3IgdGhlIGRldmtpdC5cbmltcG9ydCBHTGliSWNvbnMgZnJvbSBcImdpOi8vR0xpYlwiXG5jb25zdCBJQ09OX0RJUiA9XG4gICAgR0xpYkljb25zLmdldGVudihcIktPQkVMX0lDT05TXCIpID8/XG4gICAgR0xpYkljb25zLmJ1aWxkX2ZpbGVuYW1ldihbR0xpYkljb25zLmdldF9jdXJyZW50X2RpcigpLCBcImljb25zXCJdKVxuXG5BcHAuc3RhcnQoe1xuICAgIGluc3RhbmNlTmFtZTogXCJrb2JlbFwiLFxuICAgIGljb25zOiBJQ09OX0RJUixcbiAgICBtYWluKCkge1xuICAgICAgICBnbm9ibGluLmluaXQoKVxuICAgICAgICBub3RpZmRTdmMuaW5pdCgpXG4gICAgICAgIC8vIExvYWQgb3VyIHN0eWxlc2hlZXQgYXQgVVNFUiBwcmlvcml0eSAoaGlnaGVzdCkgc28gaXQgYmVhdHMgQWR3YWl0YSdzIHRoZW1lXG4gICAgICAgIC8vIHJ1bGVzIFx1MjAxNCBhc3RhbCdzIG93biBjc3Mgb3B0aW9uIGFwcGxpZXMgdG9vIGxvdywgbGV0dGluZyBBZHdhaXRhIHdpbiBvbiBlLmcuXG4gICAgICAgIC8vIGBzY2FsZSA+IHRyb3VnaGAgKGZhdCBzbGlkZXJzKS4gVGhpcyBwcm92aWRlciBpcyBhdXRob3JpdGF0aXZlLlxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgcHJvdiA9IG5ldyBHdGsuQ3NzUHJvdmlkZXIoKVxuICAgICAgICAgICAgcHJvdi5sb2FkX2Zyb21fc3RyaW5nKHN0eWxlICsgdG9rZW5Dc3ModG9rZW5zKSlcbiAgICAgICAgICAgIEd0ay5TdHlsZUNvbnRleHQuYWRkX3Byb3ZpZGVyX2Zvcl9kaXNwbGF5KFxuICAgICAgICAgICAgICAgIEdkay5EaXNwbGF5LmdldF9kZWZhdWx0KCkhLFxuICAgICAgICAgICAgICAgIHByb3YsXG4gICAgICAgICAgICAgICAgODAwIC8qIFVTRVIgcHJpb3JpdHkgKi9cbiAgICAgICAgICAgIClcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBjc3MgcHJvdmlkZXIgZmFpbGVkOiAke2V9YClcbiAgICAgICAgfVxuICAgICAgICAvLyBhc3RhbDQgSlNYIDx3aW5kb3c+IGlzIGNyZWF0ZWQgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gUGVyc2lzdGVudCBjaHJvbWUgbXVzdFxuICAgICAgICAvLyBiZSBwcmVzZW50KCllZDsgb24tZGVtYW5kIHN1cmZhY2VzIHN0YXkgaGlkZGVuIGFuZCBhcmUgc2hvd24gYnkgdG9nZ2xlX3dpbmRvdy5cbiAgICAgICAgY29uc3QgbWFrZSA9IChuYW1lOiBzdHJpbmcsIGZuOiAoKSA9PiBhbnksIHNob3c6IGJvb2xlYW4pID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdyA9IGZuKClcbiAgICAgICAgICAgICAgICBpZiAodyAmJiB0eXBlb2Ygdy5wcmVzZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgQXBwLmFkZF93aW5kb3c/Lih3KVxuICAgICAgICAgICAgICAgICAgICBpZiAoc2hvdykgdy5wcmVzZW50KClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiAke25hbWV9IEZBSUxFRDogJHtlfVxcbiR7KGUgYXMgYW55KT8uc3RhY2sgPz8gXCJcIn1gKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG1vbml0b3JzID0gQXBwLmdldF9tb25pdG9ycygpXG4gICAgICAgIGNvbnN0IHRhcmdldHMgPSBtb25pdG9ycy5sZW5ndGggPyBtb25pdG9ycyA6IFt1bmRlZmluZWQgYXMgYW55XVxuICAgICAgICBmb3IgKGNvbnN0IG1vbml0b3Igb2YgdGFyZ2V0cykge1xuICAgICAgICAgICAgbWFrZShcImJhclwiLCAoKSA9PiBCYXIobW9uaXRvciksIHRydWUpXG4gICAgICAgICAgICBtYWtlKFwiZG9ja1wiLCAoKSA9PiBEb2NrKG1vbml0b3IpLCB0cnVlKVxuICAgICAgICAgICAgbWFrZShcInRvYXN0c1wiLCAoKSA9PiBUb2FzdHMobW9uaXRvciksIHRydWUpXG4gICAgICAgICAgICBtYWtlKFwib3NkXCIsICgpID0+IE9TRChtb25pdG9yKSwgdHJ1ZSlcbiAgICAgICAgfVxuICAgICAgICBtYWtlKFwibGF1bmNoZXJcIiwgKCkgPT4gTGF1bmNoZXIoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJxdWlja3NldHRpbmdzXCIsICgpID0+IFF1aWNrU2V0dGluZ3MoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJjYWxlbmRhclwiLCAoKSA9PiBDYWxlbmRhcigpLCBmYWxzZSlcbiAgICAgICAgbWFrZShcImRyYXdlclwiLCAoKSA9PiBEcmF3ZXIoKSwgZmFsc2UpXG4gICAgICAgIG1ha2UoXCJzZXNzaW9uXCIsICgpID0+IFNlc3Npb24oKSwgZmFsc2UpXG4gICAgICAgIC8vIEtPQkVMX0RVTVA9PHdpbmRvdz46IGR1bXAgdGhlIGxpdmUgR1RLIGdlb21ldHJ5IHRyZWUgZm9yIERPTS12cy1HVEsgZGlmZmluZy5cbiAgICAgICAgYXJtRHVtcCgobmFtZSkgPT4gQXBwLmdldF93aW5kb3cobmFtZSkgYXMgYW55KVxuICAgIH0sXG4gICAgLy8gYGFzdGFsIC1pIGtvYmVsIC10IDx3aW5kb3c+YCBoYW5kbGVkIGJ5IEFwcCdzIHJlcXVlc3QgZnJhbWV3b3JrXG4gICAgcmVxdWVzdEhhbmRsZXIocmVxdWVzdCwgcmVzKSB7XG4gICAgICAgIGNvbnN0IFtjbWQsIGFyZ10gPSByZXF1ZXN0LnNwbGl0KFwiIFwiKVxuICAgICAgICBpZiAoY21kID09PSBcInRvZ2dsZVwiKSB7XG4gICAgICAgICAgICBzdXJmYWNlVG9nZ2xlKGFyZylcbiAgICAgICAgICAgIHJldHVybiByZXMoXCJva1wiKVxuICAgICAgICB9XG4gICAgICAgIGlmIChjbWQgPT09IFwicmVsb2FkLWNzc1wiKSB7XG4gICAgICAgICAgICBBcHAuYXBwbHlfY3NzKHN0eWxlICsgdG9rZW5Dc3ModG9rZW5zKSwgdHJ1ZSlcbiAgICAgICAgICAgIHJldHVybiByZXMoXCJva1wiKVxuICAgICAgICB9XG4gICAgICAgIHJlcyhcInVua25vd25cIilcbiAgICB9LFxufSlcbiIsICJAY2hhcnNldCBcIlVURi04XCI7XG53aW5kb3cge1xuICBmb250LWZhbWlseTogXCJJbnRlclwiLCBcIkludGVyIFZhcmlhYmxlXCIsIFwiSW50ZXJWYXJpYWJsZVwiLCBzYW5zLXNlcmlmO1xuICBmb250LXNpemU6IDEzcHg7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuXG4udG4ge1xuICBmb250LWZlYXR1cmUtc2V0dGluZ3M6IFwidG51bVwiO1xufVxuXG53aW5kb3cge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbn1cblxuYnV0dG9uIHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm94LXNoYWRvdzogbm9uZTtcbiAgb3V0bGluZTogbm9uZTtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXMsIGNvbG9yIDE2MG1zO1xufVxuXG5pbWFnZSB7XG4gIC1ndGstaWNvbi1zdHlsZTogcmVndWxhcjtcbn1cblxuLmJhciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDAgN3B4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5iYXIgLnRpdGxlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xuICBtYXJnaW46IDAgOXB4O1xufVxuLmJhciAuY2xvY2sge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMy41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uYmFyIC5kYXRlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmJhciAuaWJ0biB7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC5pYnRuIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4uYmFyIC5pYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4uYmFyIC5iY2VudGVyIHtcbiAgbWluLWhlaWdodDogMDtcbiAgcGFkZGluZzogNnB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5iYXIgLmJjZW50ZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmJhciAuc3RhdHVzIHtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgcGFkZGluZzogMCAxM3B4O1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1czpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uYmFyIC5zdGF0dXMgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4uYmFyIC5zdGF0dXMgLnBjdCBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxM3B4O1xufVxuLmJhciAuc3RhdHVzIGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmJhciAuc3RhdHVzLmVyciAubmV0LWljb24ge1xuICBjb2xvcjogI2VkYmI2NDtcbn1cbi5iYXIgLmJhZGdlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBwYWRkaW5nOiAwIDNweDtcbiAgbWFyZ2luOiAycHg7XG4gIG1pbi1oZWlnaHQ6IDE0cHg7XG4gIG1pbi13aWR0aDogOHB4O1xufVxuLmJhciAudHJheS1pY29uIHtcbiAgbWluLXdpZHRoOiAyOHB4O1xufVxuLmJhciAudHJheS1pY29uIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAudHJheS1sYW5nIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luOiAwIDhweDtcbn1cblxuLmRvY2sge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBwYWRkaW5nOiA1cHg7XG4gIGJvcmRlci1yYWRpdXM6IDE2cHg7XG59XG4uZG9jayAuZGJ0biB7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG59XG4uZG9jayAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAzMHB4O1xuICBtaW4taGVpZ2h0OiAzMHB4O1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4uZG9jayAuZGJ0bjpob3ZlciAuaWNvbi10aWxlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgyNTUsIDI1NSwgMjU1LCAwLjA5KTtcbn1cbi5kb2NrIC5wbGFjZWhvbGRlciAuaWNvbi10aWxlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uZG9jayAuZG90cyB7XG4gIG1hcmdpbi1ib3R0b206IDNweDtcbn1cbi5kb2NrIC5kb3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjOGQ4NjkzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBtaW4td2lkdGg6IDRweDtcbiAgbWluLWhlaWdodDogNHB4O1xuICB0cmFuc2l0aW9uOiBtaW4td2lkdGggMjYwbXMgY3ViaWMtYmV6aWVyKDAuMjQsIDEuMzYsIDAuMzUsIDEpLCBiYWNrZ3JvdW5kLWNvbG9yIDIyMG1zO1xufVxuLmRvY2sgLmRvdC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIG1pbi13aWR0aDogMTJweDtcbn1cbi5kb2NrIC5kb3QubWluaSB7XG4gIG1pbi13aWR0aDogM3B4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG4gIG9wYWNpdHk6IDAuNztcbn1cbi5kb2NrIC5zZXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBtaW4td2lkdGg6IDFweDtcbiAgbWluLWhlaWdodDogMzNweDtcbiAgbWFyZ2luOiAwIDNweDtcbn1cbi5kb2NrIC5kdGlsZSB7XG4gIG1pbi13aWR0aDogNDJweDtcbiAgbWluLWhlaWdodDogNDJweDtcbn1cbi5kb2NrIC5kd2lkZ2V0IC5kZyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIHBhZGRpbmc6IDZweDtcbn1cbi5kb2NrIC5tcHJvZyB7XG4gIG1pbi13aWR0aDogMjVweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBtYXJnaW4tYm90dG9tOiA2cHg7XG59XG4uZG9jayAubXByb2cgdHJvdWdoIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgwLCAwLCAwLCAwLjM1KTtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWluLWhlaWdodDogM3B4O1xufVxuLmRvY2sgLm1wcm9nIGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4uZG9jayAubXByb2cgYmxvY2suZW1wdHkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiB0cmFuc3BhcmVudDtcbn1cblxuLnNoZWV0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTRweDtcbiAgcGFkZGluZzogMTJweDtcbiAgbWFyZ2luOiAzOHB4O1xuICBib3gtc2hhZG93OiAwIDE1cHggMzRweCByZ2JhKDgsIDUsIDE2LCAwLjQ1KSwgMCAycHggOHB4IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG59XG5cbi5xcyB7XG4gIG1pbi13aWR0aDogMzI4cHg7XG59IC8qIG1hdGNoZXMgcGFuZWxXKDM1MilcdTIyMTIyNDsgb3ZlcnJpZGRlbiBieSBjb25maWcudHMgdG9rZW5Dc3MgYXQgcnVudGltZSAqL1xuLnFzLXRvcCB7XG4gIG1hcmdpbi1ib3R0b206IDEycHg7XG4gIHBhZGRpbmc6IDAgMnB4O1xufVxuLnFzLXRvcCAubWV0YSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5xcy10b3AgLm1ldGEgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMDtcbn1cbi5xcy10b3AgLnJidG4ge1xuICBwYWRkaW5nOiA5cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtYXJnaW4tbGVmdDogN3B4O1xufVxuLnFzLXRvcCAucmJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLnFzLXRvcCAucmJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMzMjJlMzk7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnFzLXRvcCAucmJ0bi5kYW5nZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5xcy10b3AgLnJidG4ubGVhZiBpbWFnZSB7XG4gIGNvbG9yOiAjYjVjYjQ4O1xufVxuXG4uY2hpcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4taGVpZ2h0OiA1NHB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDIyMG1zO1xufVxuLmNoaXAgLmNoaXBiIHtcbiAgcGFkZGluZzogOXB4IDhweCA5cHggMTJweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG59XG4uY2hpcCBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTdweDtcbn1cbi5jaGlwIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmNoaXAgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luLXRvcDogMDtcbn1cbi5jaGlwOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cbi5jaGlwLm9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbi5jaGlwLm9uIGltYWdlIHtcbiAgY29sb3I6ICMxOTIwMDM7XG59XG4uY2hpcC5vbiBsYWJlbCB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gLnN1YiB7XG4gIGNvbG9yOiByZ2JhKDI1LCAzMiwgMywgMC43KTtcbn1cbi5jaGlwLm9uOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cbi5jaGlwLm9uIC5jaGV2IHtcbiAgY29sb3I6ICMxOTIwMDM7XG59XG4uY2hpcCAuY2hldiB7XG4gIG1pbi13aWR0aDogMzJweDtcbiAgYm9yZGVyLXJhZGl1czogMCA5OTlweCA5OTlweCAwO1xuICBjb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLWxlZnQ6IDFweCBzb2xpZCByZ2JhKDAsIDAsIDAsIDAuMTgpO1xufVxuLmNoaXAgLmNoZXYgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgY29sb3I6IGluaGVyaXQ7XG59XG4uY2hpcCAuY2hldjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4xNCk7XG59XG5cbi5jaGlwcyB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG5cbi5jaGlwcyA+IGJveDpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLXJpZ2h0OiAxcHg7XG59XG5cbi5jaGlwLWdyaWQge1xuICBtYXJnaW4tYm90dG9tOiAxMHB4O1xufVxuXG5zY2FsZSwgc2NhbGU6aG9yaXpvbnRhbCwgc2NhbGU6dmVydGljYWwge1xuICBtaW4taGVpZ2h0OiAwO1xuICBtaW4td2lkdGg6IDA7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogNnB4IDA7XG59XG5cbnNjYWxlID4gdHJvdWdoLCBzY2FsZTpob3Jpem9udGFsID4gdHJvdWdoLCBzY2FsZTp2ZXJ0aWNhbCA+IHRyb3VnaCB7XG4gIG1pbi1oZWlnaHQ6IDZweDtcbiAgbWluLXdpZHRoOiAwO1xuICBtYXJnaW46IDA7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IGhpZ2hsaWdodCxcbnNjYWxlID4gdHJvdWdoID4gcHJvZ3Jlc3Mge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IHNsaWRlciB7XG4gIG1pbi13aWR0aDogMTdweDtcbiAgbWluLWhlaWdodDogMTdweDtcbiAgbWFyZ2luOiAtNnB4OyAvKiBwcm90b3R5cGUga25vYiAxN1x1MDBENzE3ICovXG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3gtc2hhZG93OiAwIDFweCA0cHggcmdiYSgwLCAwLCAwLCAwLjUpO1xufVxuXG4uc3JvdyB7XG4gIHBhZGRpbmc6IDAgMnB4IDAgMnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuXG4uc3JvdyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwIC0xMnB4IDAgMTJweDtcbn1cblxuLnNyb3cgLmNoZXYge1xuICBwYWRkaW5nOiA2cHggOHB4O1xuICBjb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xufVxuLnNyb3cgLmNoZXYgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xufVxuLnNyb3cgLmNoZXY6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuXG4uZ2Jhbm5lciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDEwcHggMTJweDtcbiAgbWFyZ2luLWJvdHRvbTogOHB4O1xufVxuLmdiYW5uZXIgLnQge1xuICBjb2xvcjogI2VkYmI2NDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG59XG4uZ2Jhbm5lciAucyB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi5nYmFubmVyIGltYWdlIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG5cbi5nYnRuIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBwYWRkaW5nOiA3cHggMTJweDtcbn1cbi5nYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cblxuLmRoZWFkIHtcbiAgcGFkZGluZy1ib3R0b206IDEwcHg7XG59XG4uZGhlYWQgYnV0dG9uIHtcbiAgcGFkZGluZzogN3B4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmRoZWFkIGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmRoZWFkIGxhYmVsIHtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxNHB4O1xufVxuXG5zd2l0Y2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiA0MnB4O1xuICBtaW4taGVpZ2h0OiAyNHB4O1xufVxuc3dpdGNoOmNoZWNrZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuc3dpdGNoIHNsaWRlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4td2lkdGg6IDIwcHg7XG4gIG1pbi1oZWlnaHQ6IDIwcHg7XG59XG5cbi54cm93IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBwYWRkaW5nOiA5cHggMTFweDtcbn1cbi54cm93IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxN3B4O1xufVxuLnhyb3cgbGFiZWwge1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4ueHJvdyAueHMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ueHJvdzpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4ueHJvdy5hY3RpdmUgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cbi54cm93LmFjdGl2ZSAueHMge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLm1peHJvdyB7XG4gIHBhZGRpbmc6IDRweCAycHg7XG59XG4ubWl4cm93IC5taSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLm1peHJvdyAubWkgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4ubWl4cm93IC5tbmFtZSB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIG1pbi13aWR0aDogNzJweDtcbn1cblxuLnNoZWV0LmxhdW5jaGVyIHtcbiAgbWluLXdpZHRoOiA1NTFweDtcbn1cblxuLmxhdW5jaGVyIHtcbiAgcGFkZGluZzogOHB4O1xufVxuXG4uZmllbGQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAzcHggMTJweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmZpZWxkIGltYWdlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmZpZWxkIGVudHJ5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYm9yZGVyOiBub25lO1xuICBib3gtc2hhZG93OiBub25lO1xuICBvdXRsaW5lOiBub25lO1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxNC41cHg7XG4gIGNhcmV0LWNvbG9yOiAjYjVjYjQ4O1xuICBwYWRkaW5nOiA4cHggMDtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xufVxuLmZpZWxkIGVudHJ5IHRleHQge1xuICBtaW4taGVpZ2h0OiAwO1xufVxuLmZpZWxkIC5scGxhY2Vob2xkZXIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxNC41cHg7XG59XG4uZmllbGQgLmdob3N0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5rYmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogM3B4IDdweDtcbn1cblxuLnRpbGVzIHtcbiAgcGFkZGluZzogOHB4IDJweCAxMHB4O1xufVxuXG4udGlsZSB7XG4gIHBhZGRpbmc6IDVweCAwO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBtaW4td2lkdGg6IDYycHg7XG4gIG1heC13aWR0aDogNjJweDtcbn1cbi50aWxlIC5pY29uLXRpbGUge1xuICBtaW4td2lkdGg6IDA7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAxNjBtcztcbn1cbi50aWxlIGxhYmVsIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xufVxuLnRpbGU6aG92ZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC4wOSk7XG59XG4udGlsZTpob3ZlciBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuXG4ubGZvb3Qge1xuICBwYWRkaW5nOiA3cHggMTBweCAzcHg7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDExcHg7XG59XG4ubGZvb3QgYiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXdlaWdodDogNjUwO1xufVxuXG4ubHdpZGdldHMge1xuICBwYWRkaW5nOiAwIDJweCA2cHg7XG59XG5cbi53aWRnZXQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4IDEycHg7XG59XG4ud2lkZ2V0IGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLndpZGdldCAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5sd20gLmx3YXJ0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBtaW4td2lkdGg6IDM0cHg7XG4gIG1pbi1oZWlnaHQ6IDM0cHg7XG59XG4ubHdtIC5sd2FydCBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTFweDtcbn1cbi5sd20gLm1idG4ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBtaW4td2lkdGg6IDI5cHg7XG4gIG1pbi1oZWlnaHQ6IDI5cHg7XG59XG4ubHdtIC5tYnRuIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4ubHdtIC5tYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuLnNlYyB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIHBhZGRpbmc6IDhweCAxMHB4IDJweDtcbn1cblxuLnJvdyB7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDdweCAxMHB4O1xufVxuLnJvdyAucmkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDJweDtcbn1cbi5yb3cgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMjRweDtcbn1cbi5yb3cgbGFiZWwge1xuICBmb250LXNpemU6IDEzcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucm93IC5oaW50IHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLnJvdyAucnVuayB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMzMjJlMzk7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBib3JkZXItcmFkaXVzOiA2cHg7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBwYWRkaW5nOiAycHggN3B4O1xufVxuLnJvdzpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4ucm93LnNlbCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5jYWwge1xuICBtaW4td2lkdGg6IDMwOXB4O1xufVxuLmNhbCAuc3ViIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmNhbCAuaGVybyB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDE5cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4uY2FsIC5jYWxoZXJvIHtcbiAgcGFkZGluZzogNXB4IDhweCA4cHggOHB4O1xufVxuLmNhbCAuY2FsLWdyaWQge1xuICBtYXJnaW4tdG9wOiA4cHg7XG59XG4uY2FsIC5tb250aCB7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDEzcHg7XG59XG4uY2FsIC5tb250aDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDZweCA1cHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmNhbCAuZG93IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIHBhZGRpbmc6IDNweCAwIDZweDtcbn1cbi5jYWwgLndrIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNhbCAuZGF5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIG1pbi13aWR0aDogMjRweDtcbiAgbWluLWhlaWdodDogMjRweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWFyZ2luOiAxcHg7XG59XG4uY2FsIC5kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCAuZGF5LndlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uY2FsIC5kYXkub3V0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4uY2FsIC5kYXkudG9kYXkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBjb2xvcjogIzE5MjAwMztcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbn1cbi5jYWwgLmRheS50b2RheTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2FsIC5kYXkuc2VsOm5vdCgudG9kYXkpIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggI2I1YWRiYztcbn1cbi5jYWwgLmRheS50b2RheS5zZWwge1xuICBib3gtc2hhZG93OiBpbnNldCAwIDAgMCAxLjVweCAjMTkyMDAzO1xufVxuLmNhbCAuZGF5IC5ldmRvdCB7XG4gIG1pbi13aWR0aDogM3B4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIG1hcmdpbi1ib3R0b206IDJweDtcbn1cbi5jYWwgLmRheS50b2RheSAuZXZkb3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTkyMDAzO1xufVxuLmNhbCAuZXZjYXJkIHtcbiAgbWFyZ2luLXRvcDogMTBweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweDtcbn1cbi5jYWwgLmV2aGVhZCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgcGFkZGluZzogMXB4IDNweCA4cHg7XG59XG4uY2FsIC5ldnJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBtYXJnaW4tYm90dG9tOiA0cHg7XG59XG4uY2FsIC5ldnJvdzpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLWJvdHRvbTogMDtcbn1cbi5jYWwgLmV2cm93IC5ldmljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzYyODkzMztcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA1cHg7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyBpbWFnZSB7XG4gIGNvbG9yOiAjZmZmO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5jYWwgLmV2cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuZXZyb3cgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cblxuLmRyYXdlciB7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xufVxuXG4udG9hc3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEzcHg7XG4gIGJveC1zaGFkb3c6IDAgMThweCA0MHB4IHJnYmEoNSwgMywgMTAsIDAuNDUpO1xufVxuXG4ubmNhcmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEycHg7XG59XG4ubmNhcmQgLm5pYyB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xufVxuLm5jYXJkIHtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG4ubmNhcmQgbGFiZWwge1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5uY2FyZCAuYm9keSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjhweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cbi5uY2FyZCAud2hlbiB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDEwcHg7XG59XG4ubmNhcmQgLm54IHtcbiAgcGFkZGluZzogNXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uY2FyZCAubng6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2VmODZhMDtcbn1cblxuLm5oZWFkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTRweDtcbiAgcGFkZGluZzogOHB4IDhweCA4cHggMTRweDtcbiAgbWFyZ2luLWJvdHRvbTogOHB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uaGVhZCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLm5oZWFkIC5zdWIge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5oZWFkIC5uY2xlYXIge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGJvcmRlci1yYWRpdXM6IDdweDtcbiAgcGFkZGluZzogNHB4IDlweDtcbn1cbi5uaGVhZCAubmNsZWFyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLm9zZCB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMTYsIDEzLCAyMCwgMC44Mik7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBwYWRkaW5nOiAxMHB4IDE1cHg7XG59XG4ub3NkIGltYWdlIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xufVxuLm9zZCBzY2FsZSA+IHRyb3VnaCwgLm9zZCBzY2FsZSA+IHRyb3VnaCA+IGhpZ2hsaWdodCB7XG4gIG1pbi1oZWlnaHQ6IDhweDtcbn1cbi5vc2QgLnN2YWwge1xuICBtaW4td2lkdGg6IDM0cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEycHg7XG59XG5cbi5zZXNzaW9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSg5LCAzLCAxNCwgMC44KTtcbn1cbi5zZXNzaW9uIC5zYnRuIHtcbiAgcGFkZGluZzogNnB4O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xufVxuLnNlc3Npb24gLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDI0cHg7XG4gIG1pbi13aWR0aDogNTlweDtcbiAgbWluLWhlaWdodDogNTlweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDIwMG1zLCBjb2xvciAyMDBtcztcbn1cbi5zZXNzaW9uIC5yZWQgLnNpYyB7XG4gIGNvbG9yOiAjZWY4NmEwO1xufVxuLnNlc3Npb24gLnNidG46aG92ZXIgLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnNlc3Npb24gLnJlZDpob3ZlciAuc2ljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4uc2Vzc2lvbiBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjAwO1xuICBmb250LXNpemU6IDEycHg7XG59XG4uc2Vzc2lvbiAuY29uZmlybSBsYWJlbCB7XG4gIGNvbG9yOiAjZWY4NmEwO1xuICBmb250LXdlaWdodDogNjUwO1xufVxuXG4uY21lbnUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiA1cHg7XG59XG4uY21lbnUgLmNtaSB7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogOHB4IDEwcHg7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5jbWVudSAuY21pOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5jbWVudSAuY21pLmRhbmdlcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLmNtZW51IC5jc2VwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgbWluLWhlaWdodDogMXB4O1xuICBtYXJnaW46IDRweCA4cHg7XG59XG5cbi5kdGlwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDZweCAxMXB4O1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn0iLCAiLy8gVGhlIHRva2VuIGxheWVyIFx1MjAxNCB0aGUgc2luZ2xlIHBsYWNlIHRoZSBzaGVsbCdzIGdlb21ldHJ5IGNvbWVzIGZyb20uXG4vLyBQcm90b3R5cGUgZXF1aXZhbGVudDogdGhlIENTUyBjdXN0b20gcHJvcGVydGllcyBvbiAuZGVza3RvcCAoMDRiZTcyZSkuXG4vLyBDaGFuZ2UgYSB2YWx1ZSBoZXJlIGFuZCBiYXIsIHBhbmVscywgZG9jaywgc25hcC1hbmNob3JlZCBzdXJmYWNlcyBhbGwgcmVmbG93LlxuXG5leHBvcnQgaW50ZXJmYWNlIFRva2VucyB7XG4gICAgYmFySDogbnVtYmVyIC8vIHB4IFx1MjAxNCBiYXIgaGVpZ2h0OyBjb250cm9scyBkZXJpdmUgZnJvbSBpdFxuICAgIGJhclI6IG51bWJlciAvLyBiYXIgY29ybmVyIHJhZGl1c1xuICAgIGdhcDogbnVtYmVyIC8vIHNjcmVlbiBnYXAgKGJhciB0b3Agb2Zmc2V0LCBkb2NrIGJvdHRvbSBvZmZzZXQpXG4gICAgZWRnZTogbnVtYmVyIC8vIHNpZGUgaW5zZXRzXG4gICAgaWNvbjogbnVtYmVyIC8vIGRvY2svbGF1bmNoZXIgaWNvbiB0aWxlIHNpemVcbiAgICBkb2NrUGFkOiBudW1iZXIgLy8gZG9jayBwYWRkaW5nIChjb25jZW50cmljIHJhZGl1cyBkZXJpdmVzKVxuICAgIHRpbGVIOiBudW1iZXIgLy8gUVMgdGlsZSBoZWlnaHRcbiAgICBwYW5lbFc6IG51bWJlciAvLyBRUy9ub3RpZmljYXRpb25zL3RvYXN0cyB3aWR0aFxuICAgIGxhdW5jaGVyVzogbnVtYmVyXG4gICAgY2FsZW5kYXJXOiBudW1iZXJcbn1cblxuZXhwb3J0IGNvbnN0IGZsb2F0aW5nOiBUb2tlbnMgPSB7XG4gICAgYmFySDogNDIsXG4gICAgYmFyUjogMTQsXG4gICAgZ2FwOiAxMCxcbiAgICBlZGdlOiAxMixcbiAgICBpY29uOiA0NCxcbiAgICBkb2NrUGFkOiA1LFxuICAgIHRpbGVIOiA1NCxcbiAgICBwYW5lbFc6IDM1MixcbiAgICBsYXVuY2hlclc6IDU2MCxcbiAgICBjYWxlbmRhclc6IDMzMCxcbn1cblxuLy8gZ2FwbGVzcyA9IGEgdG9rZW4gcHJlc2V0LCBleGFjdGx5IGxpa2UgdGhlIHByb3RvdHlwZSdzIC5nYXBsZXNzIGNsYXNzXG5leHBvcnQgY29uc3QgZ2FwbGVzczogVG9rZW5zID0ge1xuICAgIC4uLmZsb2F0aW5nLFxuICAgIGJhckg6IDM4LFxuICAgIGJhclI6IDAsXG4gICAgZ2FwOiAwLFxuICAgIGVkZ2U6IDAsXG59XG5cbmV4cG9ydCBsZXQgdG9rZW5zOiBUb2tlbnMgPSBmbG9hdGluZ1xuXG5leHBvcnQgY29uc3QgY3RsID0gKCkgPT4gdG9rZW5zLmJhckggLSAxMSAvLyBiYXIgY29udHJvbCBzaXplXG5leHBvcnQgY29uc3QgcGFuZWxUb3AgPSAoKSA9PiB0b2tlbnMuZ2FwICsgdG9rZW5zLmJhckggKyA2XG5cbi8vIEdUSyBDU1MgY2FuJ3QgY2FsYygpIGZyb20gSlMgc3RhdGU7IHdlIHJlZ2VuZXJhdGUgYSA6cm9vdC1pc2ggYmxvY2sgYW5kXG4vLyBsZXQgQXBwLmFwcGx5X2NzcyByZS1za2luIGxpdmUgKHRoZSBcImJhciA0MiBjeWNsZXJcIiBvZiB0aGUgUU1ML0FHUyB3b3JsZCkuXG5leHBvcnQgZnVuY3Rpb24gdG9rZW5Dc3ModDogVG9rZW5zID0gdG9rZW5zKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYFxuICAuYmFyIHsgbWluLWhlaWdodDogJHt0LmJhckh9cHg7IGJvcmRlci1yYWRpdXM6ICR7dC5iYXJSfXB4O1xuICAgICAgICAgbWFyZ2luOiAwOyB9XG4gIC5iYXIgYnV0dG9uIHsgbWluLXdpZHRoOiAke2N0bCgpfXB4OyBtaW4taGVpZ2h0OiAke2N0bCgpfXB4OyB9XG4gIC5kb2NrIHsgcGFkZGluZzogJHt0LmRvY2tQYWR9cHg7IGJvcmRlci1yYWRpdXM6ICR7MTIgKyB0LmRvY2tQYWQgLSAxfXB4O1xuICAgICAgICAgIG1hcmdpbi1ib3R0b206ICR7dC5nYXB9cHg7IH1cbiAgLmljb24tdGlsZSB7IG1pbi13aWR0aDogJHt0Lmljb259cHg7IG1pbi1oZWlnaHQ6ICR7dC5pY29ufXB4OyB9XG4gIC5xcywgLmRyYXdlciwgLmNhbGVuZGFyIHsgbWFyZ2luLXRvcDogJHtwYW5lbFRvcCgpfXB4OyB9XG4gIC5xcyB7IG1pbi13aWR0aDogJHt0LnBhbmVsVyAtIDI0fXB4OyB9ICAvKiBwYW5lbFcgaXMgb3V0ZXI7IHN1YnRyYWN0IC5zaGVldCBwYWRkaW5nIDEycHhcdTAwRDcyICovXG4gIC5sYXVuY2hlciB7IG1pbi13aWR0aDogJHt0LmxhdW5jaGVyV31weDsgfVxuICAuY2FsZW5kYXIgeyBtaW4td2lkdGg6ICR7dC5jYWxlbmRhcld9cHg7IH1cbiAgLmNoaXAgeyBtaW4taGVpZ2h0OiAke3QudGlsZUh9cHg7IH1cbiAgYFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0VG9rZW5zKG5leHQ6IFBhcnRpYWw8VG9rZW5zPiwgYXBwbHk6IChjc3M6IHN0cmluZykgPT4gdm9pZCkge1xuICAgIHRva2VucyA9IHsgLi4udG9rZW5zLCAuLi5uZXh0IH1cbiAgICBhcHBseSh0b2tlbkNzcyh0b2tlbnMpKVxufVxuIiwgIi8vIG9yZy5nbm9ibGluLlNoZWxsIFx1MjAxNCB0aGUgY29tcG9zaXRvciBsaW5rLiBEcml2ZXM6IHNvZnQtcmVsb2FkLCBmZWF0dXJlIHRvZ2dsZXMsXG4vLyB0aGUgV0lORE9XIExJU1QgdGhhdCBtYWtlcyB0aGUgZG9jayB0cnV0aGZ1bCwgYW5kIHRoZSBjb25uZWN0ZWQvYW1iZXIgc3RhdGUuXG4vLyBQcm90b3R5cGU6IHNlcnZpY2VzICdnbm9iJyBiYW5uZXIgKyBiYXIgYW1iZXIgc2VnbWVudCArIFdNIGludGVncmF0aW9uLlxuXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcbmltcG9ydCB7IFZhcmlhYmxlIH0gZnJvbSBcImFzdGFsXCJcblxuY29uc3QgQlVTID0gXCJvcmcuZ25vYmxpbi5TaGVsbFwiXG5jb25zdCBQQVRIID0gXCIvb3JnL2dub2JsaW4vU2hlbGxcIlxuY29uc3QgSUZBQ0UgPSBcIm9yZy5nbm9ibGluLlNoZWxsXCJcblxuZXhwb3J0IGludGVyZmFjZSBHbm9ibGluV2luZG93IHtcbiAgICBpZDogc3RyaW5nXG4gICAgYXBwSWQ6IHN0cmluZ1xuICAgIHRpdGxlOiBzdHJpbmdcbiAgICBmb2N1c2VkOiBib29sZWFuXG4gICAgbWluaW1pemVkOiBib29sZWFuXG59XG5cbmV4cG9ydCBjb25zdCBjb25uZWN0ZWQgPSBWYXJpYWJsZShmYWxzZSlcbmV4cG9ydCBjb25zdCB3aW5kb3dzID0gVmFyaWFibGU8R25vYmxpbldpbmRvd1tdPihbXSlcblxubGV0IHByb3h5OiBHaW8uREJ1c1Byb3h5IHwgbnVsbCA9IG51bGxcblxuZnVuY3Rpb24gY2FsbChtZXRob2Q6IHN0cmluZywgcGFyYW1zOiBHTGliLlZhcmlhbnQgfCBudWxsID0gbnVsbCk6IFByb21pc2U8R0xpYi5WYXJpYW50IHwgbnVsbD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzLCByZWopID0+IHtcbiAgICAgICAgaWYgKCFwcm94eSkgcmV0dXJuIHJlaihuZXcgRXJyb3IoXCJnbm9ibGluOiBub3QgY29ubmVjdGVkXCIpKVxuICAgICAgICBwcm94eS5jYWxsKG1ldGhvZCwgcGFyYW1zLCBHaW8uREJ1c0NhbGxGbGFncy5OT05FLCAyMDAwLCBudWxsLCAoXywgcikgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXMocHJveHkhLmNhbGxfZmluaXNoKHIpKVxuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIHJlaihlKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBjb25zdCByZWxvYWQgPSAoKSA9PiBjYWxsKFwiUmVsb2FkXCIpXG5leHBvcnQgY29uc3Qgc2V0RmVhdHVyZSA9IChuYW1lOiBzdHJpbmcsIG9uOiBib29sZWFuKSA9PlxuICAgIGNhbGwoXCJTZXRGZWF0dXJlXCIsIG5ldyBHTGliLlZhcmlhbnQoXCIoc2IpXCIsIFtuYW1lLCBvbl0pKVxuXG4vLyBXaW5kb3cgdmVyYnMgKHRoZSBkb2NrIGNsaWNrIG1vZGVsKVxuZXhwb3J0IGNvbnN0IGFjdGl2YXRlID0gKGlkOiBzdHJpbmcpID0+IGNhbGwoXCJBY3RpdmF0ZVdpbmRvd1wiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHMpXCIsIFtpZF0pKVxuZXhwb3J0IGNvbnN0IG1pbmltaXplID0gKGlkOiBzdHJpbmcpID0+IGNhbGwoXCJNaW5pbWl6ZVdpbmRvd1wiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHMpXCIsIFtpZF0pKVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFdpbmRvd3MoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdiA9IGF3YWl0IGNhbGwoXCJMaXN0V2luZG93c1wiKVxuICAgICAgICBpZiAoIXYpIHJldHVyblxuICAgICAgICBjb25zdCBbbGlzdF0gPSB2LmRlZXBfdW5wYWNrKCkgYXMgW0dub2JsaW5XaW5kb3dbXV1cbiAgICAgICAgd2luZG93cy5zZXQobGlzdClcbiAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogc3RheSBvbiBsYXN0LWtub3duIGxpc3Q7IGNvbm5lY3RlZCBmbGFnIGNhcnJpZXMgdGhlIHRydXRoICovXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwV2luZG93cyhhcHBJZDogc3RyaW5nKTogR25vYmxpbldpbmRvd1tdIHtcbiAgICByZXR1cm4gd2luZG93cy5nZXQoKS5maWx0ZXIoKHcpID0+IHcuYXBwSWQgPT09IGFwcElkKVxufVxuXG4vLyBDeWNsZSA9IHRoZSBkb2NrIGNhcm91c2VsOiBmb2N1cyB0aGUgbmV4dCB3aW5kb3cgb2YgdGhlIGFwcFxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGN5Y2xlKGFwcElkOiBzdHJpbmcsIGRpcjogMSB8IC0xKSB7XG4gICAgY29uc3Qgd3MgPSBhcHBXaW5kb3dzKGFwcElkKVxuICAgIGlmICh3cy5sZW5ndGggPCAyKSByZXR1cm5cbiAgICBjb25zdCBpID0gd3MuZmluZEluZGV4KCh3KSA9PiB3LmZvY3VzZWQpXG4gICAgYXdhaXQgYWN0aXZhdGUod3NbKChpIDwgMCA/IDAgOiBpKSArIGRpciArIHdzLmxlbmd0aCkgJSB3cy5sZW5ndGhdLmlkKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdCgpIHtcbiAgICBHaW8uYnVzX3dhdGNoX25hbWUoXG4gICAgICAgIEdpby5CdXNUeXBlLlNFU1NJT04sXG4gICAgICAgIEJVUyxcbiAgICAgICAgR2lvLkJ1c05hbWVXYXRjaGVyRmxhZ3MuTk9ORSxcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gYXBwZWFyZWRcbiAgICAgICAgICAgIEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXMoXG4gICAgICAgICAgICAgICAgR2lvLkJ1c1R5cGUuU0VTU0lPTixcbiAgICAgICAgICAgICAgICBHaW8uREJ1c1Byb3h5RmxhZ3MuTk9ORSxcbiAgICAgICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgICAgIEJVUyxcbiAgICAgICAgICAgICAgICBQQVRILFxuICAgICAgICAgICAgICAgIElGQUNFLFxuICAgICAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAgICAgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgICAgICBwcm94eSA9IEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXNfZmluaXNoKHJlcylcbiAgICAgICAgICAgICAgICAgICAgcHJveHkuY29ubmVjdChcImctc2lnbmFsXCIsIChfcCwgX3MsIHNpZykgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNpZyA9PT0gXCJXaW5kb3dzQ2hhbmdlZFwiKSByZWZyZXNoV2luZG93cygpXG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIGNvbm5lY3RlZC5zZXQodHJ1ZSlcbiAgICAgICAgICAgICAgICAgICAgcmVmcmVzaFdpbmRvd3MoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIClcbiAgICAgICAgfSxcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gdmFuaXNoZWQgXHUyMTkyIGFtYmVyIGV2ZXJ5d2hlcmUgdGhhdCBsaXN0ZW5zXG4gICAgICAgICAgICBwcm94eSA9IG51bGxcbiAgICAgICAgICAgIGNvbm5lY3RlZC5zZXQoZmFsc2UpXG4gICAgICAgIH1cbiAgICApXG59XG4iLCAiaW1wb3J0IFwiLi9vdmVycmlkZXMuanNcIlxuZXhwb3J0IHsgZGVmYXVsdCBhcyBBc3RhbElPIH0gZnJvbSBcImdpOi8vQXN0YWxJTz92ZXJzaW9uPTAuMVwiXG5leHBvcnQgKiBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL3RpbWUuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vZmlsZS5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi9nb2JqZWN0LmpzXCJcbmV4cG9ydCB7IEJpbmRpbmcsIGJpbmQgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcbmV4cG9ydCB7IFZhcmlhYmxlLCBkZXJpdmUgfSBmcm9tIFwiLi92YXJpYWJsZS5qc1wiXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW8/dmVyc2lvbj0yLjBcIlxuXG5leHBvcnQgeyBHaW8gfVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZEZpbGUocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICByZXR1cm4gQXN0YWwucmVhZF9maWxlKHBhdGgpIHx8IFwiXCJcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGaWxlQXN5bmMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBBc3RhbC5yZWFkX2ZpbGVfYXN5bmMocGF0aCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLnJlYWRfZmlsZV9maW5pc2gocmVzKSB8fCBcIlwiKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlRmlsZShwYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IHZvaWQge1xuICAgIEFzdGFsLndyaXRlX2ZpbGUocGF0aCwgY29udGVudClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHdyaXRlRmlsZUFzeW5jKHBhdGg6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgQXN0YWwud3JpdGVfZmlsZV9hc3luYyhwYXRoLCBjb250ZW50LCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwud3JpdGVfZmlsZV9maW5pc2gocmVzKSlcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtb25pdG9yRmlsZShcbiAgICBwYXRoOiBzdHJpbmcsXG4gICAgY2FsbGJhY2s6IChmaWxlOiBzdHJpbmcsIGV2ZW50OiBHaW8uRmlsZU1vbml0b3JFdmVudCkgPT4gdm9pZCxcbik6IEdpby5GaWxlTW9uaXRvciB7XG4gICAgcmV0dXJuIEFzdGFsLm1vbml0b3JfZmlsZShwYXRoLCAoZmlsZTogc3RyaW5nLCBldmVudDogR2lvLkZpbGVNb25pdG9yRXZlbnQpID0+IHtcbiAgICAgICAgY2FsbGJhY2soZmlsZSwgZXZlbnQpXG4gICAgfSkhXG59XG4iLCAiaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5cbmV4cG9ydCB7IGRlZmF1bHQgYXMgR0xpYiB9IGZyb20gXCJnaTovL0dMaWI/dmVyc2lvbj0yLjBcIlxuZXhwb3J0IHsgR09iamVjdCwgR09iamVjdCBhcyBkZWZhdWx0IH1cblxuY29uc3QgbWV0YSA9IFN5bWJvbChcIm1ldGFcIilcbmNvbnN0IHByaXYgPSBTeW1ib2woXCJwcml2XCIpXG5cbmNvbnN0IHsgUGFyYW1TcGVjLCBQYXJhbUZsYWdzIH0gPSBHT2JqZWN0XG5cbmNvbnN0IGtlYmFiaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMS0kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiX1wiLCBcIi1cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG50eXBlIFNpZ25hbERlY2xhcmF0aW9uID0ge1xuICAgIGZsYWdzPzogR09iamVjdC5TaWduYWxGbGFnc1xuICAgIGFjY3VtdWxhdG9yPzogR09iamVjdC5BY2N1bXVsYXRvclR5cGVcbiAgICByZXR1cm5fdHlwZT86IEdPYmplY3QuR1R5cGVcbiAgICBwYXJhbV90eXBlcz86IEFycmF5PEdPYmplY3QuR1R5cGU+XG59XG5cbnR5cGUgUHJvcGVydHlEZWNsYXJhdGlvbiA9XG4gICAgfCBJbnN0YW5jZVR5cGU8dHlwZW9mIEdPYmplY3QuUGFyYW1TcGVjPlxuICAgIHwgeyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfVxuICAgIHwgdHlwZW9mIFN0cmluZ1xuICAgIHwgdHlwZW9mIE51bWJlclxuICAgIHwgdHlwZW9mIEJvb2xlYW5cbiAgICB8IHR5cGVvZiBPYmplY3RcblxudHlwZSBHT2JqZWN0Q29uc3RydWN0b3IgPSB7XG4gICAgW21ldGFdPzoge1xuICAgICAgICBQcm9wZXJ0aWVzPzogeyBba2V5OiBzdHJpbmddOiBHT2JqZWN0LlBhcmFtU3BlYyB9XG4gICAgICAgIFNpZ25hbHM/OiB7IFtrZXk6IHN0cmluZ106IEdPYmplY3QuU2lnbmFsRGVmaW5pdGlvbiB9XG4gICAgfVxuICAgIG5ldyguLi5hcmdzOiBhbnlbXSk6IGFueVxufVxuXG50eXBlIE1ldGFJbmZvID0gR09iamVjdC5NZXRhSW5mbzxuZXZlciwgQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfT4sIG5ldmVyPlxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXIob3B0aW9uczogTWV0YUluZm8gPSB7fSkge1xuICAgIHJldHVybiBmdW5jdGlvbiAoY2xzOiBHT2JqZWN0Q29uc3RydWN0b3IpIHtcbiAgICAgICAgY29uc3QgdCA9IG9wdGlvbnMuVGVtcGxhdGVcbiAgICAgICAgaWYgKHR5cGVvZiB0ID09PSBcInN0cmluZ1wiICYmICF0LnN0YXJ0c1dpdGgoXCJyZXNvdXJjZTovL1wiKSAmJiAhdC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKSkge1xuICAgICAgICAgICAgLy8gYXNzdW1lIHhtbCB0ZW1wbGF0ZVxuICAgICAgICAgICAgb3B0aW9ucy5UZW1wbGF0ZSA9IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSh0KVxuICAgICAgICB9XG5cbiAgICAgICAgR09iamVjdC5yZWdpc3RlckNsYXNzKHtcbiAgICAgICAgICAgIFNpZ25hbHM6IHsgLi4uY2xzW21ldGFdPy5TaWduYWxzIH0sXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7IC4uLmNsc1ttZXRhXT8uUHJvcGVydGllcyB9LFxuICAgICAgICAgICAgLi4ub3B0aW9ucyxcbiAgICAgICAgfSwgY2xzKVxuXG4gICAgICAgIGRlbGV0ZSBjbHNbbWV0YV1cbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwcm9wZXJ0eShkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbiA9IE9iamVjdCkge1xuICAgIHJldHVybiBmdW5jdGlvbiAodGFyZ2V0OiBhbnksIHByb3A6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikge1xuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0gPz89IHt9XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzID8/PSB7fVxuXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZWJhYmlmeShwcm9wKVxuXG4gICAgICAgIGlmICghZGVzYykge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgcHJvcCwge1xuICAgICAgICAgICAgICAgIGdldCgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbcHJpdl0/Lltwcm9wXSA/PyBkZWZhdWx0VmFsdWUoZGVjbGFyYXRpb24pXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBzZXQodjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh2ICE9PSB0aGlzW3Byb3BdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzW3ByaXZdID8/PSB7fVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpc1twcml2XVtwcm9wXSA9IHZcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5KG5hbWUpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYHNldF8ke25hbWUucmVwbGFjZShcIi1cIiwgXCJfXCIpfWAsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSh2OiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpc1twcm9wXSA9IHZcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYGdldF8ke25hbWUucmVwbGFjZShcIi1cIiwgXCJfXCIpfWAsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZSgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXNbcHJvcF1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXNba2ViYWJpZnkocHJvcCldID0gcHNwZWMobmFtZSwgUGFyYW1GbGFncy5SRUFEV1JJVEUsIGRlY2xhcmF0aW9uKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbGV0IGZsYWdzID0gMFxuICAgICAgICAgICAgaWYgKGRlc2MuZ2V0KSBmbGFncyB8PSBQYXJhbUZsYWdzLlJFQURBQkxFXG4gICAgICAgICAgICBpZiAoZGVzYy5zZXQpIGZsYWdzIHw9IFBhcmFtRmxhZ3MuV1JJVEFCTEVcblxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXNba2ViYWJpZnkocHJvcCldID0gcHNwZWMobmFtZSwgZmxhZ3MsIGRlY2xhcmF0aW9uKVxuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKC4uLnBhcmFtczogQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3Q+KTpcbih0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpID0+IHZvaWRcblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbChkZWNsYXJhdGlvbj86IFNpZ25hbERlY2xhcmF0aW9uKTpcbih0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpID0+IHZvaWRcblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbChcbiAgICBkZWNsYXJhdGlvbj86IFNpZ25hbERlY2xhcmF0aW9uIHwgeyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3QsXG4gICAgLi4ucGFyYW1zOiBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdD5cbikge1xuICAgIHJldHVybiBmdW5jdGlvbiAodGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSB7XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXSA/Pz0ge31cbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHMgPz89IHt9XG5cbiAgICAgICAgY29uc3QgbmFtZSA9IGtlYmFiaWZ5KHNpZ25hbClcblxuICAgICAgICBpZiAoZGVjbGFyYXRpb24gfHwgcGFyYW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgVE9ETzogdHlwZSBhc3NlcnRcbiAgICAgICAgICAgIGNvbnN0IGFyciA9IFtkZWNsYXJhdGlvbiwgLi4ucGFyYW1zXS5tYXAodiA9PiB2LiRndHlwZSlcbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzW25hbWVdID0ge1xuICAgICAgICAgICAgICAgIHBhcmFtX3R5cGVzOiBhcnIsXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFsc1tuYW1lXSA9IGRlY2xhcmF0aW9uIHx8IHtcbiAgICAgICAgICAgICAgICBwYXJhbV90eXBlczogW10sXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWRlc2MpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIHNpZ25hbCwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0KG5hbWUsIC4uLmFyZ3MpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBvZzogKCguLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCkgPSBkZXNjLnZhbHVlXG4gICAgICAgICAgICBkZXNjLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBub3QgdHlwZWRcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXQobmFtZSwgLi4uYXJncylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBvbl8ke25hbWUucmVwbGFjZShcIi1cIiwgXCJfXCIpfWAsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBvZy5hcHBseSh0aGlzLCBhcmdzKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxufVxuXG5mdW5jdGlvbiBwc3BlYyhuYW1lOiBzdHJpbmcsIGZsYWdzOiBudW1iZXIsIGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uKSB7XG4gICAgaWYgKGRlY2xhcmF0aW9uIGluc3RhbmNlb2YgUGFyYW1TcGVjKVxuICAgICAgICByZXR1cm4gZGVjbGFyYXRpb25cblxuICAgIHN3aXRjaCAoZGVjbGFyYXRpb24pIHtcbiAgICAgICAgY2FzZSBTdHJpbmc6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLnN0cmluZyhuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgXCJcIilcbiAgICAgICAgY2FzZSBOdW1iZXI6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmRvdWJsZShuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgLU51bWJlci5NQVhfVkFMVUUsIE51bWJlci5NQVhfVkFMVUUsIDApXG4gICAgICAgIGNhc2UgQm9vbGVhbjpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuYm9vbGVhbihuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgZmFsc2UpXG4gICAgICAgIGNhc2UgT2JqZWN0OlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5qc29iamVjdChuYW1lLCBcIlwiLCBcIlwiLCBmbGFncylcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgbWlzc3R5cGVkXG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLm9iamVjdChuYW1lLCBcIlwiLCBcIlwiLCBmbGFncywgZGVjbGFyYXRpb24uJGd0eXBlKVxuICAgIH1cbn1cblxuZnVuY3Rpb24gZGVmYXVsdFZhbHVlKGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uKSB7XG4gICAgaWYgKGRlY2xhcmF0aW9uIGluc3RhbmNlb2YgUGFyYW1TcGVjKVxuICAgICAgICByZXR1cm4gZGVjbGFyYXRpb24uZ2V0X2RlZmF1bHRfdmFsdWUoKVxuXG4gICAgc3dpdGNoIChkZWNsYXJhdGlvbikge1xuICAgICAgICBjYXNlIFN0cmluZzpcbiAgICAgICAgICAgIHJldHVybiBcIlwiXG4gICAgICAgIGNhc2UgTnVtYmVyOlxuICAgICAgICAgICAgcmV0dXJuIDBcbiAgICAgICAgY2FzZSBCb29sZWFuOlxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICAgIGNhc2UgT2JqZWN0OlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG59XG4iLCAiLy8gRGVmZXJyZWQsIG5vbi1ibG9ja2luZyBBc3RhbE5vdGlmZCBhY2Nlc3MuIGdldF9kZWZhdWx0KCkgY2FuIGJsb2NrIG9uIGEgaGVhZGxlc3Mgb3Jcbi8vIGNvbnRlbmRlZCBzZXNzaW9uIGJ1cyAoaXQgdHJpZXMgdG8gYmVjb21lIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zIGFuZCB3YWl0cyksXG4vLyBzbyB3ZSBORVZFUiB0b3VjaCBpdCBkdXJpbmcgd2lkZ2V0IGNvbnN0cnVjdGlvbi4gaW5pdCgpIGlzIGNhbGxlZCBvbmNlIGZyb20gYW4gaWRsZVxuLy8gYWZ0ZXIgdGhlIHNoZWxsIGlzIG1hcHBlZDsgb24gcmVhbCBoYXJkd2FyZSBpdCByZXR1cm5zIGZhc3QsIGluIHRoZSBzdHJpcHBlZCBkZXZraXRcbi8vIGl0IG1heSBuby1vcC4gV2lkZ2V0cyBiaW5kIHRvIGB1bnJlYWRgL2BsaXN0YCBhbmQgaHlkcmF0ZSB3aGVuIGl0IGxhbmRzLlxuaW1wb3J0IHsgVmFyaWFibGUsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG4vLyBJbXBvcnRpbmcgdGhlIHR5cGVsaWIgaXMgY2hlYXAgKyBub24tYmxvY2tpbmc7IG9ubHkgZ2V0X2RlZmF1bHQoKSBtYXkgYmxvY2sgKGl0IHRyaWVzXG4vLyB0byBiZWNvbWUgb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnMpLCBzbyB3ZSBjYWxsIFRIQVQgbGF6aWx5IGZyb20gYW4gaWRsZS4gVGhlIG9sZFxuLy8gYGltcG9ydHMuZ2kuQXN0YWxOb3RpZmRgIHRocm93cyB1bmRlciBgZ2pzIC1tYCAoRVNNIGhhcyBubyBsZWdhY3kgYGltcG9ydHNgIGdsb2JhbCkuXG5pbXBvcnQgTm90aWZkIGZyb20gXCJnaTovL0FzdGFsTm90aWZkXCJcblxuZXhwb3J0IGNvbnN0IHVucmVhZCA9IFZhcmlhYmxlKDApXG5leHBvcnQgY29uc3QgcmVhZHkgPSBWYXJpYWJsZShmYWxzZSlcbmxldCBuOiBOb3RpZmQuTm90aWZkIHwgbnVsbCA9IG51bGxcblxuZXhwb3J0IGZ1bmN0aW9uIG5vdGlmZCgpIHtcbiAgICByZXR1cm4gblxufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdCgpIHtcbiAgICAvLyBnZXRlbnYgcmV0dXJucyBcIlwiIChmYWxzeSkgd2hlbiB0aGUgdmFyIGlzIHNldC1idXQtZW1wdHksIG51bGwgd2hlbiB1bnNldCBcdTIwMTQgYm90aCBza2lwXG4gICAgLy8gY29ycmVjdGx5IG9ubHkgd2hlbiB0aGUgdmFsdWUgaXMgdHJ1dGh5IChcIjFcIikuXG4gICAgaWYgKEdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIikpIHJldHVyblxuICAgIC8vIGRlZmVyIHBhc3QgZmlyc3QgcGFpbnQ7IGlmIGdldF9kZWZhdWx0IGJsb2NrcywgaXQgYmxvY2tzIG9ubHkgdGhpcyBpZGxlIHRpY2ssXG4gICAgLy8gbmV2ZXIgY29uc3RydWN0aW9uL2ZpcnN0IHJlbmRlci5cbiAgICB0aW1lb3V0KDUwLCAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBuID0gTm90aWZkLmdldF9kZWZhdWx0KClcbiAgICAgICAgICAgIHJlYWR5LnNldCh0cnVlKVxuICAgICAgICAgICAgY29uc3Qgc3luYyA9ICgpID0+IHVucmVhZC5zZXQobiEubm90aWZpY2F0aW9ucy5sZW5ndGgpXG4gICAgICAgICAgICBuLmNvbm5lY3QoXCJub3RpZmllZFwiLCBzeW5jKVxuICAgICAgICAgICAgbi5jb25uZWN0KFwicmVzb2x2ZWRcIiwgc3luYylcbiAgICAgICAgICAgIHN5bmMoKVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBwcmludGVycihga29iZWw6IG5vdGlmZCBpbml0IHNraXBwZWQ6ICR7ZX1gKVxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsICIvLyBHVEsgd2lkZ2V0LXRyZWUgZ2VvbWV0cnkgZHVtcGVyIFx1MjAxNCB0aGUgbWlycm9yIG9mIHRoZSBET00ncyBnZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5cbi8vIFdhbGtzIGEgbWFwcGVkIHdpbmRvdyBhbmQgcmVjb3JkcyBldmVyeSB3aWRnZXQncyByZWFsIGFsbG9jYXRpb24gKHgveS93L2ggcmVsYXRpdmVcbi8vIHRvIHRoZSB3aW5kb3cgY29udGVudCkgKyBDU1MgY2xhc3NlcyArIHRleHQsIHNvIGEgcmVuZGVyZWQgR1RLIHN1cmZhY2UgY2FuIGJlIGRpZmZlZFxuLy8gMToxIGFnYWluc3QgdGhlIHByb3RvdHlwZSBET00uIEdhdGVkIGJ5IEtPQkVMX0RVTVA9PHdpbmRvdz4gaW4gYXBwLnRzLlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdyYXBoZW5lIGZyb20gXCJnaTovL0dyYXBoZW5lXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE5vZGUge1xuICAgIGQ6IG51bWJlclxuICAgIHR5cGU6IHN0cmluZ1xuICAgIGNsczogc3RyaW5nXG4gICAgeDogbnVtYmVyXG4gICAgeTogbnVtYmVyXG4gICAgdzogbnVtYmVyXG4gICAgaDogbnVtYmVyXG4gICAgdDogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBkdW1wV2luZG93KHdpbjogR3RrLldpbmRvdyk6IE5vZGVbXSB7XG4gICAgY29uc3Qgb3V0OiBOb2RlW10gPSBbXVxuICAgIGNvbnN0IHJvb3Q6IGFueSA9IHdpblxuICAgIGNvbnN0IHdhbGsgPSAodzogYW55LCBkZXB0aDogbnVtYmVyKSA9PiB7XG4gICAgICAgIC8vIGNvbXB1dGVfYm91bmRzIGdpdmVzIHRoZSB3aWRnZXQncyBGVUxMIHJlbmRlcmVkIHJlY3QgKGluY2wuIGl0cyBvd24gcGFkZGluZykgaW5cbiAgICAgICAgLy8gdGhlIHJvb3QncyBjb29yZHMgXHUyMDE0IG1vcmUgcmVsaWFibGUgdGhhbiBjb21wdXRlX3BvaW50ICsgZ2V0X3dpZHRoICh3aGljaCBjYW4gcmVwb3J0XG4gICAgICAgIC8vIHRoZSBjaGlsZC9jb250ZW50IHNpemUgZm9yIHBhZGRlZCBidXR0b25zKS5cbiAgICAgICAgbGV0IHggPSAwLFxuICAgICAgICAgICAgeSA9IDAsXG4gICAgICAgICAgICB3aWR0aCA9IDAsXG4gICAgICAgICAgICBoZWlnaHQgPSAwXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCByZXMgPSB3LmNvbXB1dGVfYm91bmRzKHJvb3QpXG4gICAgICAgICAgICBjb25zdCByZWN0ID0gQXJyYXkuaXNBcnJheShyZXMpID8gcmVzWzFdIDogcmVzXG4gICAgICAgICAgICBpZiAocmVjdCkge1xuICAgICAgICAgICAgICAgIHggPSByZWN0Lm9yaWdpbi54XG4gICAgICAgICAgICAgICAgeSA9IHJlY3Qub3JpZ2luLnlcbiAgICAgICAgICAgICAgICB3aWR0aCA9IHJlY3Quc2l6ZS53aWR0aFxuICAgICAgICAgICAgICAgIGhlaWdodCA9IHJlY3Quc2l6ZS5oZWlnaHRcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7fVxuICAgICAgICBpZiAoIXdpZHRoKSB7XG4gICAgICAgICAgICB3aWR0aCA9IHcuZ2V0X3dpZHRoPy4oKSA/PyAwXG4gICAgICAgICAgICBoZWlnaHQgPSB3LmdldF9oZWlnaHQ/LigpID8/IDBcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBjbHMgPSAody5nZXRfY3NzX2NsYXNzZXM/LigpID8/IFtdKS5qb2luKFwiLlwiKVxuICAgICAgICBjb25zdCB0eXBlID0gKHcuY29uc3RydWN0b3I/Lm5hbWUgPz8gXCI/XCIpLnJlcGxhY2UoL18vZywgXCJcIilcbiAgICAgICAgbGV0IHQgPSBcIlwiXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB0ID0gKHcuZ2V0X2xhYmVsPy4oKSA/PyB3LmdldF90ZXh0Py4oKSA/PyBcIlwiKS50b1N0cmluZygpLnNsaWNlKDAsIDI4KVxuICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgIG91dC5wdXNoKHtcbiAgICAgICAgICAgIGQ6IGRlcHRoLFxuICAgICAgICAgICAgdHlwZSxcbiAgICAgICAgICAgIGNscyxcbiAgICAgICAgICAgIHg6IE1hdGgucm91bmQoeCksXG4gICAgICAgICAgICB5OiBNYXRoLnJvdW5kKHkpLFxuICAgICAgICAgICAgdzogTWF0aC5yb3VuZCh3aWR0aCksXG4gICAgICAgICAgICBoOiBNYXRoLnJvdW5kKGhlaWdodCksXG4gICAgICAgICAgICB0LFxuICAgICAgICB9KVxuICAgICAgICBsZXQgYyA9IHcuZ2V0X2ZpcnN0X2NoaWxkPy4oKVxuICAgICAgICB3aGlsZSAoYykge1xuICAgICAgICAgICAgd2FsayhjLCBkZXB0aCArIDEpXG4gICAgICAgICAgICBjID0gYy5nZXRfbmV4dF9zaWJsaW5nKClcbiAgICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBjaGlsZCA9IHdpbi5nZXRfY2hpbGQ/LigpXG4gICAgaWYgKGNoaWxkKSB3YWxrKGNoaWxkLCAwKVxuICAgIHJldHVybiBvdXRcbn1cblxuLy8gUG9sbCB1bnRpbCB0aGUgbmFtZWQgd2luZG93IGlzIHZpc2libGUgKyBsYWlkIG91dCwgdGhlbiBkdW1wIG9uY2UgdG8gS09CRUxfRFVNUF9PVVQuXG5leHBvcnQgZnVuY3Rpb24gYXJtRHVtcChnZXRXaW5kb3c6IChuYW1lOiBzdHJpbmcpID0+IEd0ay5XaW5kb3cgfCBudWxsKSB7XG4gICAgY29uc3QgbmFtZSA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUFwiKVxuICAgIGlmICghbmFtZSkgcmV0dXJuXG4gICAgY29uc3QgcGF0aCA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUF9PVVRcIikgfHwgXCIvdG1wL2tvYmVsLWR1bXAuanNvblwiXG4gICAgbGV0IGRvbmUgPSBmYWxzZVxuICAgIEdMaWIudGltZW91dF9hZGQoR0xpYi5QUklPUklUWV9ERUZBVUxULCA0MDAsICgpID0+IHtcbiAgICAgICAgaWYgKGRvbmUpIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgICAgY29uc3QgdyA9IGdldFdpbmRvdyhuYW1lKVxuICAgICAgICBpZiAodyAmJiB3LmdldF9tYXBwZWQ/LigpICYmICh3LmdldF93aWR0aD8uKCkgPz8gMCkgPiAwKSB7XG4gICAgICAgICAgICAvLyBvbmUgbW9yZSB0aWNrIHNvIGZpbmFsIGFsbG9jYXRpb24gc2V0dGxlc1xuICAgICAgICAgICAgR0xpYi50aW1lb3V0X2FkZChHTGliLlBSSU9SSVRZX0RFRkFVTFQsIDI1MCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHRyZWUgPSBkdW1wV2luZG93KHcpXG4gICAgICAgICAgICAgICAgICAgIEdMaWIuZmlsZV9zZXRfY29udGVudHMocGF0aCwgSlNPTi5zdHJpbmdpZnkodHJlZSkpXG4gICAgICAgICAgICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogZHVtcGVkICR7dHJlZS5sZW5ndGh9IHdpZGdldHMgb2YgXCIke25hbWV9XCIgXHUyMTkyICR7cGF0aH1gKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBkdW1wIGZhaWxlZDogJHtlfWApXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBkb25lID0gdHJ1ZVxuICAgICAgICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9DT05USU5VRVxuICAgIH0pXG59XG4iLCAiLy8gQW5pbWF0ZWQgc3VyZmFjZSByZWdpc3RyeSBcdTIwMTQgcmVwbGFjZXMgQXBwLnRvZ2dsZV93aW5kb3cgZm9yIHN1cmZhY2VzIHRoYXQgd2FudFxuLy8gYSByZXZlYWwgYW5pbWF0aW9uLiBFYWNoIHN1cmZhY2UgY2FsbHMgcmVnaXN0ZXIoKSBvbmNlLCB0aGVuIEJhci9hcHAudHMgY2FsbCB0b2dnbGUoKS5cbi8vXG4vLyBQYXR0ZXJuOiB3aW5kb3cgYWx3YXlzIHN0YXJ0cyBoaWRkZW4gKHZpc2libGU9ZmFsc2UpLiBPcGVuaW5nIG1ha2VzIGl0IHZpc2libGUsXG4vLyB0aGVuIHRyaWdnZXJzIHRoZSByZXZlYWxlcjsgY2xvc2luZyB0cmlnZ2VycyB0aGUgcmV2ZWFsZXIgdGhlbiBoaWRlcyBhZnRlciB0cmFuc2l0aW9uLlxuaW1wb3J0IHsgQXBwIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuXG5leHBvcnQgdHlwZSBUcmFuc2l0aW9uVHlwZSA9IEd0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlXG5cbmNvbnN0IHJlZ2lzdHJ5OiBSZWNvcmQ8c3RyaW5nLCAoKSA9PiB2b2lkPiA9IHt9XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlcihuYW1lOiBzdHJpbmcsIGZuOiAoKSA9PiB2b2lkKSB7XG4gICAgcmVnaXN0cnlbbmFtZV0gPSBmblxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9nZ2xlKG5hbWU6IHN0cmluZykge1xuICAgIGlmIChyZWdpc3RyeVtuYW1lXSkge1xuICAgICAgICByZWdpc3RyeVtuYW1lXSgpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgLy8gRmFsbGJhY2sgZm9yIHN1cmZhY2VzIHdpdGhvdXQgYW5pbWF0ZWQgcmV2ZWFscyAoc2Vzc2lvbiwgZHJhd2VyKVxuICAgICAgICBBcHAudG9nZ2xlX3dpbmRvdyhuYW1lKVxuICAgIH1cbn1cblxuLy8gbWFrZVJldmVhbDogY3JlYXRlcyB0aGUgc3RhdGUgdmFyaWFibGVzIGFuZCB0b2dnbGUgZnVuY3Rpb24gZm9yIGFuIGFuaW1hdGVkIHN1cmZhY2UuXG4vLyAgIC0gb3Blbk1zOiByZXZlYWwtaW4gZHVyYXRpb24gaW4gbXMgKGRlZmF1bHQgMjIwKVxuLy8gICAtIGNsb3NlTXM6IHJldmVhbC1vdXQgKyB3aW5kb3ctaGlkZSBkZWxheSBpbiBtcyAoZGVmYXVsdCAxNTApXG4vLyAgIC0gcmV2ZWFsZXJSZWY6IHNldCB0aGlzIHRvIHRoZSBSZXZlYWxlciB3aWRnZXQgaW4gYHNldHVwYCBzbyB0aGUgdG9nZ2xlIGNhblxuLy8gICAgIGRpcmVjdGx5IGNvbnRyb2wgdHJhbnNpdGlvbkR1cmF0aW9uIHBlciBkaXJlY3Rpb25cbmV4cG9ydCBmdW5jdGlvbiBtYWtlUmV2ZWFsKG9wZW5NcyA9IDIyMCwgY2xvc2VNcyA9IDE1MCkge1xuICAgIGNvbnN0IHdpblZpc2libGUgPSBWYXJpYWJsZShmYWxzZSlcbiAgICBjb25zdCByZXZlYWxlZCA9IFZhcmlhYmxlKGZhbHNlKVxuICAgIGxldCByZXZlYWxlcldpZGdldDogR3RrLlJldmVhbGVyIHwgbnVsbCA9IG51bGxcbiAgICBsZXQgY2xvc2VUaW1lcjogYW55ID0gbnVsbFxuXG4gICAgY29uc3Qgc2V0UmV2ZWFsZXIgPSAocjogR3RrLlJldmVhbGVyKSA9PiB7XG4gICAgICAgIHJldmVhbGVyV2lkZ2V0ID0gclxuICAgIH1cblxuICAgIGNvbnN0IG9wZW4gPSAoKSA9PiB7XG4gICAgICAgIGlmIChjbG9zZVRpbWVyKSB7XG4gICAgICAgICAgICBjbG9zZVRpbWVyLmNhbmNlbD8uKClcbiAgICAgICAgICAgIGNsb3NlVGltZXIgPSBudWxsXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJldmVhbGVyV2lkZ2V0KSByZXZlYWxlcldpZGdldC50cmFuc2l0aW9uRHVyYXRpb24gPSBvcGVuTXNcbiAgICAgICAgd2luVmlzaWJsZS5zZXQodHJ1ZSlcbiAgICAgICAgLy8gT25lIGlkbGUgZnJhbWUgc28gR1RLIGNhbiByZWFsaXplIHRoZSB3aW5kb3cgYmVmb3JlIGFuaW1hdGluZ1xuICAgICAgICB0aW1lb3V0KDE2LCAoKSA9PiByZXZlYWxlZC5zZXQodHJ1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgY2xvc2UgPSAoKSA9PiB7XG4gICAgICAgIGlmIChyZXZlYWxlcldpZGdldCkgcmV2ZWFsZXJXaWRnZXQudHJhbnNpdGlvbkR1cmF0aW9uID0gY2xvc2VNc1xuICAgICAgICByZXZlYWxlZC5zZXQoZmFsc2UpXG4gICAgICAgIGNsb3NlVGltZXIgPSB0aW1lb3V0KGNsb3NlTXMgKyAyMCwgKCkgPT4ge1xuICAgICAgICAgICAgd2luVmlzaWJsZS5zZXQoZmFsc2UpXG4gICAgICAgICAgICBjbG9zZVRpbWVyID0gbnVsbFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IHRvZ2dsZUZuID0gKCkgPT4gKHJldmVhbGVkLmdldCgpID8gY2xvc2UoKSA6IG9wZW4oKSlcblxuICAgIHJldHVybiB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgb3BlbiwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfVxufVxuIiwgIi8vIFRoZSBiYXIuIFByb3RvdHlwZTogbGF1bmNoZXIgYnV0dG9uIFx1MDBCNyBmb2N1c2VkIHRpdGxlIFx1MDBCNyBjZW50ZXJlZCBjbG9jayAoXHUyMTkyIGNhbGVuZGFyKVxuLy8gXHUwMEI3IHRyYXkgXHUwMEI3IHN0YXR1cyBwaWxsICh3aWZpL3ZvbC9iYXR0ZXJ5OyBhbWJlciBuZXQtZ2x5cGggd2hlbiBnbm9ibGluIGlzIGRvd24pXG4vLyBcdTAwQjcgYmVsbCtiYWRnZSAoXHUyMTkyIGRyYXdlcikgXHUwMEI3IHBvd2VyIChcdTIxOTIgc2Vzc2lvbikuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBCYXR0ZXJ5IGZyb20gXCJnaTovL0FzdGFsQmF0dGVyeVwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IFRyYXkgZnJvbSBcImdpOi8vQXN0YWxUcmF5XCJcbmltcG9ydCB7IGNvbm5lY3RlZCwgd2luZG93cyB9IGZyb20gXCIuLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCB7IHRvZ2dsZSBhcyBzdXJmYWNlVG9nZ2xlIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbmltcG9ydCB7IHVucmVhZCB9IGZyb20gXCIuLi9zZXJ2aWNlcy9ub3RpZmRcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbmNvbnN0IHRpbWUgPSBWYXJpYWJsZShHTGliLkRhdGVUaW1lLm5ld19ub3dfbG9jYWwoKSkucG9sbCgxMF8wMDAsICgpID0+XG4gICAgR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKClcbilcblxuZnVuY3Rpb24gRm9jdXNlZFRpdGxlKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgY2xhc3M9XCJ0aXRsZVwiXG4gICAgICAgICAgICBlbGxpcHNpemU9ezMgLyogUGFuZ28uRWxsaXBzaXplTW9kZS5FTkQgKi99XG4gICAgICAgICAgICBtYXhXaWR0aENoYXJzPXsyOH1cbiAgICAgICAgICAgIGxhYmVsPXtcbiAgICAgICAgICAgICAgICBERU1PXG4gICAgICAgICAgICAgICAgICAgID8gRC50aXRsZVxuICAgICAgICAgICAgICAgICAgICA6IGJpbmQod2luZG93cykuYXMoKHdzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGYgPSB3cy5maW5kKCh3KSA9PiB3LmZvY3VzZWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZikgcmV0dXJuIFwiZGVza3RvcFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNpYmxpbmdzID0gd3MuZmlsdGVyKCh3KSA9PiB3LmFwcElkID09PSBmLmFwcElkKVxuICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gc2libGluZ3MubGVuZ3RoID4gMVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBgJHtmLnRpdGxlfSBcdTIwMTQgd2luZG93ICR7c2libGluZ3MuaW5kZXhPZihmKSArIDF9LyR7c2libGluZ3MubGVuZ3RofWBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogZi50aXRsZVxuICAgICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9XG4gICAgICAgIC8+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBTdGF0dXNQaWxsKCkge1xuICAgIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICAgIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICAgIGNvbnN0IGJhdCA9IEJhdHRlcnkuZ2V0X2RlZmF1bHQoKVxuICAgIC8vIFdpZmkgaWNvbjogdmFyaWVzIHdpdGggY29ubmVjdGlvbiBzdGF0ZSAvIHR5cGVcbiAgICBjb25zdCB3aWZpSWNvbiA9IG5ldC53aWZpXG4gICAgICAgID8gYmluZChuZXQud2lmaSwgXCJlbmFibGVkXCIpLmFzKChvbikgPT5cbiAgICAgICAgICAgICAgb24gPyBcImtvYmVsLXdpZmktc3ltYm9saWNcIiA6IFwia29iZWwtd2lmaS1vZmYtc3ltYm9saWNcIlxuICAgICAgICAgIClcbiAgICAgICAgOiBcImtvYmVsLXdpZmktb2ZmLXN5bWJvbGljXCJcbiAgICAvLyBWb2x1bWUgaWNvbjogdHJhY2sgdGhlIHNwZWFrZXIncyBvd24gdm9sdW1lX2ljb24gcHJvcGVydHlcbiAgICBjb25zdCB2b2xJY29uID0gc3BlYWtlclxuICAgICAgICA/IGJpbmQoc3BlYWtlciwgXCJ2b2x1bWVfaWNvblwiKS5hcygoaSkgPT4gaSA/PyBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiKVxuICAgICAgICA6IFwia29iZWwtc3BlYWtlci1tdXRlLXN5bWJvbGljXCJcbiAgICByZXR1cm4gKFxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICBjbGFzcz17YmluZChjb25uZWN0ZWQpLmFzKChjKSA9PiAoYyA/IFwic3RhdHVzXCIgOiBcInN0YXR1cyBlcnJcIikpfVxuICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwicXVpY2tzZXR0aW5nc1wiKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGNsYXNzPVwibmV0LWljb25cIiBpY29uTmFtZT17d2lmaUljb259IC8+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXt2b2xJY29ufSAvPlxuICAgICAgICAgICAgICAgIHsvKiBCYXR0ZXJ5OiBvbmx5IHJlbmRlcmVkIHdoZW4gYSBiYXR0ZXJ5IGlzIHByZXNlbnQgKi99XG4gICAgICAgICAgICAgICAgeyhERU1PIHx8IGJhdCkgJiYgKFxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwicGN0XCIgc3BhY2luZz17Nn0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1iYXR0ZXJ5LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBELmJhdHRlcnlQY3RcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmF0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gYmluZChiYXQsIFwicGVyY2VudGFnZVwiKS5hcygocCkgPT4gYCR7TWF0aC5yb3VuZChwICogMTAwKX0lYClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBcIlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmZ1bmN0aW9uIEJlbGwoKSB7XG4gICAgLy8gQmFkZ2UgaHlkcmF0ZXMgb25jZSBub3RpZmQgaXMgYXZhaWxhYmxlIChkZWZlcnJlZCBcdTIwMTQgZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYVxuICAgIC8vIGhlYWRsZXNzL2NvbnRlbmRlZCBidXM7IG5ldmVyIGNhbGwgaXQgZHVyaW5nIGNvbnN0cnVjdGlvbikuIHVucmVhZCgpIGlzIGEgcGxhaW5cbiAgICAvLyBWYXJpYWJsZSBhbiBhc3luYyBpbml0IGZpbGxzIGluLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICAgIGNsYXNzPVwiaWJ0biBiZWxsXCJcbiAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc3VyZmFjZVRvZ2dsZShcImRyYXdlclwiKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmVsbC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJiYWRnZSB0blwiXG4gICAgICAgICAgICAgICAgICAgIHZpc2libGU9e0RFTU8gPyB0cnVlIDogYmluZCh1bnJlYWQpLmFzKChuKSA9PiBuID4gMCl9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtERU1PID8gXCIxXCIgOiBiaW5kKHVucmVhZCkuYXMoKG4pID0+IChuID4gOSA/IFwiOStcIiA6IGAke259YCkpfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQmFyKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gICAgY29uc3QgeyBUT1AsIExFRlQsIFJJR0hUIH0gPSBBc3RhbC5XaW5kb3dBbmNob3JcbiAgICAvLyBGbG9hdGluZyBiYXI6IGxheWVyLXNoZWxsIG1hcmdpbnMgaW5zZXQgaXQgZnJvbSB0aGUgZWRnZXM7IHRoZSAuYmFyIGNoaWxkIGlzIHRoZVxuICAgIC8vIHJvdW5kZWQgc3VyZmFjZS4gRXhjbHVzaXZlIHNvIHRpbGVkIHdpbmRvd3MgcmVzcGVjdCBpdCAoem9uZSA9IG1hcmdpbiArIGhlaWdodCkuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImJhclwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1iYXJcIlxuICAgICAgICAgICAgY2xhc3M9XCJiYXItd2luZG93XCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuRVhDTFVTSVZFfVxuICAgICAgICAgICAgbWFyZ2luVG9wPXsxMH1cbiAgICAgICAgICAgIG1hcmdpbkxlZnQ9ezEyfVxuICAgICAgICAgICAgbWFyZ2luUmlnaHQ9ezEyfVxuICAgICAgICAgICAgYW5jaG9yPXtUT1AgfCBMRUZUIHwgUklHSFR9XG4gICAgICAgID5cbiAgICAgICAgICAgIDxjZW50ZXJib3ggY2xhc3M9XCJiYXJcIj5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwibGF1bmNoZXJcIil9XG4gICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW1hZ25pZnlpbmctZ2xhc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgPEZvY3VzZWRUaXRsZSAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJiY2VudGVyXCJcbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJjYWxlbmRhclwiKX1cbiAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImNsb2NrIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5CQVNFTElORX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17REVNTyA/IEQuY2xvY2sgOiBiaW5kKHRpbWUpLmFzKCh0KSA9PiB0LmZvcm1hdChcIiVIOiVNXCIpISl9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJkYXRlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5CQVNFTElORX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17REVNTyA/IEQuZGF0ZSA6IGJpbmQodGltZSkuYXMoKHQpID0+IHQuZm9ybWF0KFwiJWEgJS1kICViXCIpISl9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgICAgICB7REVNTyA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MX0gbWFyZ2luRW5kPXszfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0biB0cmF5LWljb25cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2x0aXBUZXh0PVwiRGlzY29yZFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGF0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0biB0cmF5LWljb25cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRvb2x0aXBUZXh0PVwiU3RlYW1cIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtZ2FtZS1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImlidG4gdHJheS1pY29uXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD1cIlRlbGVncmFtXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBhcGVyLXBsYW5lLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0biB0cmF5LWxhbmdcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IGxhYmVsPVwiZW5cIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgICAgICBiaW5kKFRyYXkuZ2V0X2RlZmF1bHQoKSwgXCJpdGVtc1wiKS5hcygoaXRlbXMpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaXRlbXMubWFwKChpdGVtKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxtZW51YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b29sdGlwVGV4dD17aXRlbS50b29sdGlwX21hcmt1cH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lbnVNb2RlbD17aXRlbS5tZW51X21vZGVsfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgZ2ljb249e2JpbmQoaXRlbSwgXCJnaWNvblwiKX0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9tZW51YnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpXG4gICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgIDxTdGF0dXNQaWxsIC8+XG4gICAgICAgICAgICAgICAgICAgIDxCZWxsIC8+XG4gICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWJ0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpfVxuICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9jZW50ZXJib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBEZW1vLWRhdGEgbW9kZSAoS09CRUxfREVNTz0xKTogbWFrZSBldmVyeSBzdXJmYWNlIHJlbmRlciB0aGUgRVhBQ1QgbW9jayB2YWx1ZXMgZnJvbVxuLy8gZG9jcy9wcm90b3R5cGUuaHRtbCwgc28gYW4gQUdTIHJlbmRlciBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXJcbi8vIGZvciBhIGZhaXIgMToxIGNvbXBhcmlzb24uIFRoaXMgaXMgTk9UIGNoZWF0aW5nIFx1MjAxNCByZWFsIEdUSyB3aWRnZXRzLCByZWFsIHJlbmRlcmluZztcbi8vIG9ubHkgdGhlICpjb250ZW50KiBpcyBwaW5uZWQgdG8gdGhlIHByb3RvdHlwZSdzIHNvIHRoZSBjaHJvbWUgY2FuIGJlIGRpZmZlZCBkaXJlY3RseS5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgY29uc3QgREVNTyA9ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9ERU1PXCIpXG5cbi8vIFZhbHVlcyB0cmFuc2NyaWJlZCBmcm9tIHByb3RvdHlwZS5odG1sJ3MgbW9jayBzdGF0ZSAodGhlIHJlZmVyZW5jZSBzY3JlZW5zaG90cykuXG5leHBvcnQgY29uc3QgRCA9IHtcbiAgICAvLyBiYXJcbiAgICBjbG9jazogXCIxNDoyM1wiLFxuICAgIGRhdGU6IFwiU2F0IDQgSnVsXCIsXG4gICAgdGl0bGU6IFwiVGVybWluYWwgXHUyMDE0IHdpbmRvdyAxLzJcIixcbiAgICBiYXR0ZXJ5UGN0OiBcIjEwMCVcIixcbiAgICAvLyBxdWljayBzZXR0aW5nc1xuICAgIG1ldGE6IFwiMTAwJSBcdTAwQjcgRnVsbHkgY2hhcmdlZFwiLFxuICAgIHdpZmlTc2lkOiBcImNob21wZXJzLTVHXCIsXG4gICAgYnREZXZpY2U6IFwiV0gtMTAwMFhNNVwiLFxuICAgIHZvbHVtZTogMC42NzUsIC8vIHRyb3VnaCA1MS4uMjg1IHdpZHRoPTIzNDsga25vYj0oMjA5LTUxKS8yMzQ9MC42NzUgXHUyMTkyIHhcdTIyNDgyMDkgbWF0Y2hlcyBwcm90b1xuICAgIGJyaWdodG5lc3M6IDAuOCwgLy8gbWVhc3VyZWQ6IEFHUyB0cm91Z2ggMnB4IG5hcnJvd2VyIHRoYW4gcHJvdG87IDAuODAwIGFsaWducyBrbm9iIGNlbnRlclxuICAgIGRhcms6IHRydWUsXG4gICAgc2F2ZTogZmFsc2UsXG4gICAgc2lsZW50OiBmYWxzZSxcbiAgICBuaWdodDogZmFsc2UsXG4gICAgLy8gY2FsZW5kYXIgXHUyMDE0IHBpbm5lZCBcInRvZGF5XCIgc28gdGhlIGdyaWQgKyBoZXJvIG1hdGNoIHRoZSBwcm90b3R5cGUgZXhhY3RseVxuICAgIHRvZGF5OiB7IHk6IDIwMjYsIG06IDYgLyogSnVseSwgMC1pbmRleGVkICovLCBkOiA0IH0sIC8vIFNhdHVyZGF5IDQgSnVseSAyMDI2XG4gICAgLy8gbGF1bmNoZXIgcGlubmVkIHRpbGVzICsgdG9kYXkgd2lkZ2V0XG4gICAgYXBwczogW1wiVGVybWluYWxcIiwgXCJGaWxlc1wiLCBcIkZpcmVmb3hcIiwgXCJaZWRcIiwgXCJTcG90aWZ5XCIsIFwiU2V0dGluZ3NcIl0sXG4gICAgd2lkZ2V0RGF0ZTogXCJTYXR1cmRheSA0IEp1bHlcIixcbiAgICB3aWRnZXRFdmVudDogXCIwOTo0NSBcdTAwQjcgRGFpbHkgU3RhbmR1cFwiLFxuICAgIG1lZGlhOiB7IHRpdGxlOiBcIldlaWdodGxlc3NcIiwgYXJ0aXN0OiBcIk1hcmNvbmkgVW5pb25cIiB9LFxufVxuIiwgIi8qIGVzbGludC1kaXNhYmxlIG1heC1sZW4gKi9cbmltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBhc3RhbGlmeSwgeyB0eXBlIENvbnN0cnVjdFByb3BzLCB0eXBlIEJpbmRhYmxlQ2hpbGQgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmZ1bmN0aW9uIGZpbHRlcihjaGlsZHJlbjogYW55W10pIHtcbiAgICByZXR1cm4gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICA/IGNoXG4gICAgICAgIDogbmV3IEd0ay5MYWJlbCh7IHZpc2libGU6IHRydWUsIGxhYmVsOiBTdHJpbmcoY2gpIH0pKVxufVxuXG4vLyBCb3hcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShBc3RhbC5Cb3gucHJvdG90eXBlLCBcImNoaWxkcmVuXCIsIHtcbiAgICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9jaGlsZHJlbigpIH0sXG4gICAgc2V0KHYpIHsgdGhpcy5zZXRfY2hpbGRyZW4odikgfSxcbn0pXG5cbmV4cG9ydCB0eXBlIEJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8Qm94LCBBc3RhbC5Cb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBCb3ggZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5Cb3gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQm94XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQm94UHJvcHMsIC4uLmNoaWxkcmVuOiBBcnJheTxCaW5kYWJsZUNoaWxkPikgeyBzdXBlcih7IGNoaWxkcmVuLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHsgdGhpcy5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfVxufVxuXG4vLyBCdXR0b25cbmV4cG9ydCB0eXBlIEJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8QnV0dG9uLCBBc3RhbC5CdXR0b24uQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uQ2xpY2tlZDogW11cbiAgICBvbkNsaWNrOiBbZXZlbnQ6IEFzdGFsLkNsaWNrRXZlbnRdXG4gICAgb25DbGlja1JlbGVhc2U6IFtldmVudDogQXN0YWwuQ2xpY2tFdmVudF1cbiAgICBvbkhvdmVyOiBbZXZlbnQ6IEFzdGFsLkhvdmVyRXZlbnRdXG4gICAgb25Ib3Zlckxvc3Q6IFtldmVudDogQXN0YWwuSG92ZXJFdmVudF1cbiAgICBvblNjcm9sbDogW2V2ZW50OiBBc3RhbC5TY3JvbGxFdmVudF1cbn0+XG5leHBvcnQgY2xhc3MgQnV0dG9uIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuQnV0dG9uKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkJ1dHRvblwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEJ1dHRvblByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gQ2VudGVyQm94XG5leHBvcnQgdHlwZSBDZW50ZXJCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPENlbnRlckJveCwgQXN0YWwuQ2VudGVyQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgQ2VudGVyQm94IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuQ2VudGVyQm94KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkNlbnRlckJveFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IENlbnRlckJveFByb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IGNoID0gZmlsdGVyKGNoaWxkcmVuKVxuICAgICAgICB0aGlzLnN0YXJ0V2lkZ2V0ID0gY2hbMF0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgdGhpcy5jZW50ZXJXaWRnZXQgPSBjaFsxXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICB0aGlzLmVuZFdpZGdldCA9IGNoWzJdIHx8IG5ldyBHdGsuQm94XG4gICAgfVxufVxuXG4vLyBDaXJjdWxhclByb2dyZXNzXG5leHBvcnQgdHlwZSBDaXJjdWxhclByb2dyZXNzUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxDaXJjdWxhclByb2dyZXNzLCBBc3RhbC5DaXJjdWxhclByb2dyZXNzLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgQ2lyY3VsYXJQcm9ncmVzcyBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkNpcmN1bGFyUHJvZ3Jlc3MpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQ2lyY3VsYXJQcm9ncmVzc1wiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IENpcmN1bGFyUHJvZ3Jlc3NQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIERyYXdpbmdBcmVhXG5leHBvcnQgdHlwZSBEcmF3aW5nQXJlYVByb3BzID0gQ29uc3RydWN0UHJvcHM8RHJhd2luZ0FyZWEsIEd0ay5EcmF3aW5nQXJlYS5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25EcmF3OiBbY3I6IGFueV0gLy8gVE9ETzogY2Fpcm8gdHlwZXNcbn0+XG5leHBvcnQgY2xhc3MgRHJhd2luZ0FyZWEgZXh0ZW5kcyBhc3RhbGlmeShHdGsuRHJhd2luZ0FyZWEpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiRHJhd2luZ0FyZWFcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBEcmF3aW5nQXJlYVByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBFbnRyeVxuZXhwb3J0IHR5cGUgRW50cnlQcm9wcyA9IENvbnN0cnVjdFByb3BzPEVudHJ5LCBHdGsuRW50cnkuQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uQ2hhbmdlZDogW11cbiAgICBvbkFjdGl2YXRlOiBbXVxufT5cbmV4cG9ydCBjbGFzcyBFbnRyeSBleHRlbmRzIGFzdGFsaWZ5KEd0ay5FbnRyeSkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJFbnRyeVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEVudHJ5UHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIEV2ZW50Qm94XG5leHBvcnQgdHlwZSBFdmVudEJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8RXZlbnRCb3gsIEFzdGFsLkV2ZW50Qm94LkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkNsaWNrOiBbZXZlbnQ6IEFzdGFsLkNsaWNrRXZlbnRdXG4gICAgb25DbGlja1JlbGVhc2U6IFtldmVudDogQXN0YWwuQ2xpY2tFdmVudF1cbiAgICBvbkhvdmVyOiBbZXZlbnQ6IEFzdGFsLkhvdmVyRXZlbnRdXG4gICAgb25Ib3Zlckxvc3Q6IFtldmVudDogQXN0YWwuSG92ZXJFdmVudF1cbiAgICBvblNjcm9sbDogW2V2ZW50OiBBc3RhbC5TY3JvbGxFdmVudF1cbn0+XG5leHBvcnQgY2xhc3MgRXZlbnRCb3ggZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5FdmVudEJveCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJFdmVudEJveFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEV2ZW50Qm94UHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyAvLyBUT0RPOiBGaXhlZFxuLy8gLy8gVE9ETzogRmxvd0JveFxuLy9cbi8vIEljb25cbmV4cG9ydCB0eXBlIEljb25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEljb24sIEFzdGFsLkljb24uQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBJY29uIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuSWNvbikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJJY29uXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogSWNvblByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBMYWJlbFxuZXhwb3J0IHR5cGUgTGFiZWxQcm9wcyA9IENvbnN0cnVjdFByb3BzPExhYmVsLCBBc3RhbC5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIExhYmVsIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuTGFiZWwpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiTGFiZWxcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBMYWJlbFByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHsgdGhpcy5sYWJlbCA9IFN0cmluZyhjaGlsZHJlbikgfVxufVxuXG4vLyBMZXZlbEJhclxuZXhwb3J0IHR5cGUgTGV2ZWxCYXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPExldmVsQmFyLCBBc3RhbC5MZXZlbEJhci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIExldmVsQmFyIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuTGV2ZWxCYXIpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiTGV2ZWxCYXJcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBMZXZlbEJhclByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBUT0RPOiBMaXN0Qm94XG5cbi8vIE1lbnVCdXR0b25cbmV4cG9ydCB0eXBlIE1lbnVCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPE1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgTWVudUJ1dHRvbiBleHRlbmRzIGFzdGFsaWZ5KEd0ay5NZW51QnV0dG9uKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIk1lbnVCdXR0b25cIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBNZW51QnV0dG9uUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBPdmVybGF5XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoQXN0YWwuT3ZlcmxheS5wcm90b3R5cGUsIFwib3ZlcmxheXNcIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X292ZXJsYXlzKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9vdmVybGF5cyh2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgT3ZlcmxheVByb3BzID0gQ29uc3RydWN0UHJvcHM8T3ZlcmxheSwgQXN0YWwuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIE92ZXJsYXkgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5PdmVybGF5KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIk92ZXJsYXlcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBPdmVybGF5UHJvcHMsIC4uLmNoaWxkcmVuOiBBcnJheTxCaW5kYWJsZUNoaWxkPikgeyBzdXBlcih7IGNoaWxkcmVuLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHtcbiAgICAgICAgY29uc3QgW2NoaWxkLCAuLi5vdmVybGF5c10gPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIHRoaXMuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICB0aGlzLnNldF9vdmVybGF5cyhvdmVybGF5cylcbiAgICB9XG59XG5cbi8vIFJldmVhbGVyXG5leHBvcnQgdHlwZSBSZXZlYWxlclByb3BzID0gQ29uc3RydWN0UHJvcHM8UmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFJldmVhbGVyIGV4dGVuZHMgYXN0YWxpZnkoR3RrLlJldmVhbGVyKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlJldmVhbGVyXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogUmV2ZWFsZXJQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIFNjcm9sbGFibGVcbmV4cG9ydCB0eXBlIFNjcm9sbGFibGVQcm9wcyA9IENvbnN0cnVjdFByb3BzPFNjcm9sbGFibGUsIEFzdGFsLlNjcm9sbGFibGUuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBTY3JvbGxhYmxlIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuU2Nyb2xsYWJsZSkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJTY3JvbGxhYmxlXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogU2Nyb2xsYWJsZVByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gU2xpZGVyXG5leHBvcnQgdHlwZSBTbGlkZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPFNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkRyYWdnZWQ6IFtdXG59PlxuZXhwb3J0IGNsYXNzIFNsaWRlciBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLlNsaWRlcikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJTbGlkZXJcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTbGlkZXJQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gU3RhY2tcbmV4cG9ydCB0eXBlIFN0YWNrUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxTdGFjaywgQXN0YWwuU3RhY2suQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBTdGFjayBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLlN0YWNrKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlN0YWNrXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogU3RhY2tQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQgeyB0aGlzLnNldF9jaGlsZHJlbihmaWx0ZXIoY2hpbGRyZW4pKSB9XG59XG5cbi8vIFN3aXRjaFxuZXhwb3J0IHR5cGUgU3dpdGNoUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxTd2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBTd2l0Y2ggZXh0ZW5kcyBhc3RhbGlmeShHdGsuU3dpdGNoKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlN3aXRjaFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFN3aXRjaFByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBXaW5kb3dcbmV4cG9ydCB0eXBlIFdpbmRvd1Byb3BzID0gQ29uc3RydWN0UHJvcHM8V2luZG93LCBBc3RhbC5XaW5kb3cuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBXaW5kb3cgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5XaW5kb3cpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiV2luZG93XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogV2luZG93UHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuIiwgImltcG9ydCB7IGhvb2ssIG5vSW1wbGljaXREZXN0cm95LCBzZXRDaGlsZHJlbiwgbWVyZ2VCaW5kaW5ncywgdHlwZSBCaW5kYWJsZVByb3BzLCBjb25zdHJ1Y3QgfSBmcm9tIFwiLi4vX2FzdGFsLmpzXCJcbmltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcbmltcG9ydCBCaW5kaW5nLCB7IHR5cGUgQ29ubmVjdGFibGUsIHR5cGUgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4uL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgeyBCaW5kYWJsZVByb3BzLCBtZXJnZUJpbmRpbmdzIH1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYXN0YWxpZnk8XG4gICAgQyBleHRlbmRzIHsgbmV3KC4uLmFyZ3M6IGFueVtdKTogR3RrLldpZGdldCB9LFxuPihjbHM6IEMsIGNsc05hbWUgPSBjbHMubmFtZSkge1xuICAgIGNsYXNzIFdpZGdldCBleHRlbmRzIGNscyB7XG4gICAgICAgIGdldCBjc3MoKTogc3RyaW5nIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY3NzKHRoaXMpIH1cbiAgICAgICAgc2V0IGNzcyhjc3M6IHN0cmluZykgeyBBc3RhbC53aWRnZXRfc2V0X2Nzcyh0aGlzLCBjc3MpIH1cbiAgICAgICAgZ2V0X2NzcygpOiBzdHJpbmcgeyByZXR1cm4gdGhpcy5jc3MgfVxuICAgICAgICBzZXRfY3NzKGNzczogc3RyaW5nKSB7IHRoaXMuY3NzID0gY3NzIH1cblxuICAgICAgICBnZXQgY2xhc3NOYW1lKCk6IHN0cmluZyB7IHJldHVybiBBc3RhbC53aWRnZXRfZ2V0X2NsYXNzX25hbWVzKHRoaXMpLmpvaW4oXCIgXCIpIH1cbiAgICAgICAgc2V0IGNsYXNzTmFtZShjbGFzc05hbWU6IHN0cmluZykgeyBBc3RhbC53aWRnZXRfc2V0X2NsYXNzX25hbWVzKHRoaXMsIGNsYXNzTmFtZS5zcGxpdCgvXFxzKy8pKSB9XG4gICAgICAgIGdldF9jbGFzc19uYW1lKCk6IHN0cmluZyB7IHJldHVybiB0aGlzLmNsYXNzTmFtZSB9XG4gICAgICAgIHNldF9jbGFzc19uYW1lKGNsYXNzTmFtZTogc3RyaW5nKSB7IHRoaXMuY2xhc3NOYW1lID0gY2xhc3NOYW1lIH1cblxuICAgICAgICBnZXQgY3Vyc29yKCk6IEN1cnNvciB7IHJldHVybiBBc3RhbC53aWRnZXRfZ2V0X2N1cnNvcih0aGlzKSBhcyBDdXJzb3IgfVxuICAgICAgICBzZXQgY3Vyc29yKGN1cnNvcjogQ3Vyc29yKSB7IEFzdGFsLndpZGdldF9zZXRfY3Vyc29yKHRoaXMsIGN1cnNvcikgfVxuICAgICAgICBnZXRfY3Vyc29yKCk6IEN1cnNvciB7IHJldHVybiB0aGlzLmN1cnNvciB9XG4gICAgICAgIHNldF9jdXJzb3IoY3Vyc29yOiBDdXJzb3IpIHsgdGhpcy5jdXJzb3IgPSBjdXJzb3IgfVxuXG4gICAgICAgIGdldCBjbGlja1Rocm91Z2goKTogYm9vbGVhbiB7IHJldHVybiBBc3RhbC53aWRnZXRfZ2V0X2NsaWNrX3Rocm91Z2godGhpcykgfVxuICAgICAgICBzZXQgY2xpY2tUaHJvdWdoKGNsaWNrVGhyb3VnaDogYm9vbGVhbikgeyBBc3RhbC53aWRnZXRfc2V0X2NsaWNrX3Rocm91Z2godGhpcywgY2xpY2tUaHJvdWdoKSB9XG4gICAgICAgIGdldF9jbGlja190aHJvdWdoKCk6IGJvb2xlYW4geyByZXR1cm4gdGhpcy5jbGlja1Rocm91Z2ggfVxuICAgICAgICBzZXRfY2xpY2tfdGhyb3VnaChjbGlja1Rocm91Z2g6IGJvb2xlYW4pIHsgdGhpcy5jbGlja1Rocm91Z2ggPSBjbGlja1Rocm91Z2ggfVxuXG4gICAgICAgIGRlY2xhcmUgcHJpdmF0ZSBbbm9JbXBsaWNpdERlc3Ryb3ldOiBib29sZWFuXG4gICAgICAgIGdldCBub0ltcGxpY2l0RGVzdHJveSgpOiBib29sZWFuIHsgcmV0dXJuIHRoaXNbbm9JbXBsaWNpdERlc3Ryb3ldIH1cbiAgICAgICAgc2V0IG5vSW1wbGljaXREZXN0cm95KHZhbHVlOiBib29sZWFuKSB7IHRoaXNbbm9JbXBsaWNpdERlc3Ryb3ldID0gdmFsdWUgfVxuXG4gICAgICAgIHNldCBhY3Rpb25Hcm91cChbcHJlZml4LCBncm91cF06IEFjdGlvbkdyb3VwKSB7IHRoaXMuaW5zZXJ0X2FjdGlvbl9ncm91cChwcmVmaXgsIGdyb3VwKSB9XG4gICAgICAgIHNldF9hY3Rpb25fZ3JvdXAoYWN0aW9uR3JvdXA6IEFjdGlvbkdyb3VwKSB7IHRoaXMuYWN0aW9uR3JvdXAgPSBhY3Rpb25Hcm91cCB9XG5cbiAgICAgICAgcHJvdGVjdGVkIGdldENoaWxkcmVuKCk6IEFycmF5PEd0ay5XaWRnZXQ+IHtcbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkJpbikge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldF9jaGlsZCgpID8gW3RoaXMuZ2V0X2NoaWxkKCkhXSA6IFtdXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBbXVxuICAgICAgICB9XG5cbiAgICAgICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgICAgICAgICAgY2hpbGRyZW4gPSBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgICAgICAgICAgPyBjaFxuICAgICAgICAgICAgICAgIDogbmV3IEd0ay5MYWJlbCh7IHZpc2libGU6IHRydWUsIGxhYmVsOiBTdHJpbmcoY2gpIH0pKVxuXG4gICAgICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIEd0ay5Db250YWluZXIpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGNoIG9mIGNoaWxkcmVuKVxuICAgICAgICAgICAgICAgICAgICB0aGlzLmFkZChjaClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgRXJyb3IoYGNhbiBub3QgYWRkIGNoaWxkcmVuIHRvICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBbc2V0Q2hpbGRyZW5dKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgICAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIEd0ay5Db250YWluZXIpIHtcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IGNoIG9mIHRoaXMuZ2V0Q2hpbGRyZW4oKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlbW92ZShjaClcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjaGlsZHJlbi5pbmNsdWRlcyhjaCkgJiYgIXRoaXMubm9JbXBsaWNpdERlc3Ryb3kpXG4gICAgICAgICAgICAgICAgICAgICAgICBjaD8uZGVzdHJveSgpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBhcHBlbmRcbiAgICAgICAgICAgIHRoaXMuc2V0Q2hpbGRyZW4oY2hpbGRyZW4pXG4gICAgICAgIH1cblxuICAgICAgICB0b2dnbGVDbGFzc05hbWUoY246IHN0cmluZywgY29uZCA9IHRydWUpIHtcbiAgICAgICAgICAgIEFzdGFsLndpZGdldF90b2dnbGVfY2xhc3NfbmFtZSh0aGlzLCBjbiwgY29uZClcbiAgICAgICAgfVxuXG4gICAgICAgIGhvb2soXG4gICAgICAgICAgICBvYmplY3Q6IENvbm5lY3RhYmxlLFxuICAgICAgICAgICAgc2lnbmFsOiBzdHJpbmcsXG4gICAgICAgICAgICBjYWxsYmFjazogKHNlbGY6IHRoaXMsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuICAgICAgICApOiB0aGlzXG4gICAgICAgIGhvb2soXG4gICAgICAgICAgICBvYmplY3Q6IFN1YnNjcmliYWJsZSxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4gICAgICAgICk6IHRoaXNcbiAgICAgICAgaG9vayhcbiAgICAgICAgICAgIG9iamVjdDogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGUsXG4gICAgICAgICAgICBzaWduYWxPckNhbGxiYWNrOiBzdHJpbmcgfCAoKHNlbGY6IHRoaXMsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkKSxcbiAgICAgICAgICAgIGNhbGxiYWNrPzogKHNlbGY6IHRoaXMsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuICAgICAgICApIHtcbiAgICAgICAgICAgIGhvb2sodGhpcywgb2JqZWN0LCBzaWduYWxPckNhbGxiYWNrLCBjYWxsYmFjaylcbiAgICAgICAgICAgIHJldHVybiB0aGlzXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdHJ1Y3RvciguLi5wYXJhbXM6IGFueVtdKSB7XG4gICAgICAgICAgICBzdXBlcigpXG4gICAgICAgICAgICBjb25zdCBwcm9wcyA9IHBhcmFtc1swXSB8fCB7fVxuICAgICAgICAgICAgcHJvcHMudmlzaWJsZSA/Pz0gdHJ1ZVxuICAgICAgICAgICAgY29uc3RydWN0KHRoaXMsIHByb3BzKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgR09iamVjdC5yZWdpc3RlckNsYXNzKHtcbiAgICAgICAgR1R5cGVOYW1lOiBgQXN0YWxfJHtjbHNOYW1lfWAsXG4gICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgIFwiY2xhc3MtbmFtZVwiOiBHT2JqZWN0LlBhcmFtU3BlYy5zdHJpbmcoXG4gICAgICAgICAgICAgICAgXCJjbGFzcy1uYW1lXCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIFwiXCIsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgXCJjc3NcIjogR09iamVjdC5QYXJhbVNwZWMuc3RyaW5nKFxuICAgICAgICAgICAgICAgIFwiY3NzXCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIFwiXCIsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgXCJjdXJzb3JcIjogR09iamVjdC5QYXJhbVNwZWMuc3RyaW5nKFxuICAgICAgICAgICAgICAgIFwiY3Vyc29yXCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIFwiZGVmYXVsdFwiLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwiY2xpY2stdGhyb3VnaFwiOiBHT2JqZWN0LlBhcmFtU3BlYy5ib29sZWFuKFxuICAgICAgICAgICAgICAgIFwiY2xpY2stdGhyb3VnaFwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBmYWxzZSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcIm5vLWltcGxpY2l0LWRlc3Ryb3lcIjogR09iamVjdC5QYXJhbVNwZWMuYm9vbGVhbihcbiAgICAgICAgICAgICAgICBcIm5vLWltcGxpY2l0LWRlc3Ryb3lcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgZmFsc2UsXG4gICAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgIH0sIFdpZGdldClcblxuICAgIHJldHVybiBXaWRnZXRcbn1cblxudHlwZSBTaWdIYW5kbGVyPFxuICAgIFcgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIEFyZ3MgZXh0ZW5kcyBBcnJheTx1bmtub3duPixcbj4gPSAoKHNlbGY6IFcsIC4uLmFyZ3M6IEFyZ3MpID0+IHVua25vd24pIHwgc3RyaW5nIHwgc3RyaW5nW11cblxuZXhwb3J0IHR5cGUgQmluZGFibGVDaGlsZCA9IEd0ay5XaWRnZXQgfCBCaW5kaW5nPEd0ay5XaWRnZXQ+XG5cbmV4cG9ydCB0eXBlIENvbnN0cnVjdFByb3BzPFxuICAgIFNlbGYgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIFByb3BzIGV4dGVuZHMgR3RrLldpZGdldC5Db25zdHJ1Y3RvclByb3BzLFxuICAgIFNpZ25hbHMgZXh0ZW5kcyBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgQXJyYXk8dW5rbm93bj4+ID0gUmVjb3JkPGBvbiR7c3RyaW5nfWAsIGFueVtdPixcbj4gPSBQYXJ0aWFsPHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNhbid0IGFzc2lnbiB0byB1bmtub3duLCBidXQgaXQgd29ya3MgYXMgZXhwZWN0ZWQgdGhvdWdoXG4gICAgW1MgaW4ga2V5b2YgU2lnbmFsc106IFNpZ0hhbmRsZXI8U2VsZiwgU2lnbmFsc1tTXT5cbn0+ICYgUGFydGlhbDx7XG4gICAgW0tleSBpbiBgb24ke3N0cmluZ31gXTogU2lnSGFuZGxlcjxTZWxmLCBhbnlbXT5cbn0+ICYgQmluZGFibGVQcm9wczxQYXJ0aWFsPFByb3BzICYge1xuICAgIGNsYXNzTmFtZT86IHN0cmluZ1xuICAgIGNzcz86IHN0cmluZ1xuICAgIGN1cnNvcj86IHN0cmluZ1xuICAgIGNsaWNrVGhyb3VnaD86IGJvb2xlYW5cbiAgICBhY3Rpb25Hcm91cD86IEFjdGlvbkdyb3VwXG59Pj4gJiBQYXJ0aWFsPHtcbiAgICBvbkRlc3Ryb3k6IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgb25EcmF3OiAoc2VsZjogU2VsZikgPT4gdW5rbm93blxuICAgIG9uS2V5UHJlc3NFdmVudDogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHVua25vd25cbiAgICBvbktleVJlbGVhc2VFdmVudDogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHVua25vd25cbiAgICBvbkJ1dHRvblByZXNzRXZlbnQ6IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB1bmtub3duXG4gICAgb25CdXR0b25SZWxlYXNlRXZlbnQ6IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB1bmtub3duXG4gICAgb25SZWFsaXplOiAoc2VsZjogU2VsZikgPT4gdW5rbm93blxuICAgIHNldHVwOiAoc2VsZjogU2VsZikgPT4gdm9pZFxufT5cblxudHlwZSBDdXJzb3IgPVxuICAgIHwgXCJkZWZhdWx0XCJcbiAgICB8IFwiaGVscFwiXG4gICAgfCBcInBvaW50ZXJcIlxuICAgIHwgXCJjb250ZXh0LW1lbnVcIlxuICAgIHwgXCJwcm9ncmVzc1wiXG4gICAgfCBcIndhaXRcIlxuICAgIHwgXCJjZWxsXCJcbiAgICB8IFwiY3Jvc3NoYWlyXCJcbiAgICB8IFwidGV4dFwiXG4gICAgfCBcInZlcnRpY2FsLXRleHRcIlxuICAgIHwgXCJhbGlhc1wiXG4gICAgfCBcImNvcHlcIlxuICAgIHwgXCJuby1kcm9wXCJcbiAgICB8IFwibW92ZVwiXG4gICAgfCBcIm5vdC1hbGxvd2VkXCJcbiAgICB8IFwiZ3JhYlwiXG4gICAgfCBcImdyYWJiaW5nXCJcbiAgICB8IFwiYWxsLXNjcm9sbFwiXG4gICAgfCBcImNvbC1yZXNpemVcIlxuICAgIHwgXCJyb3ctcmVzaXplXCJcbiAgICB8IFwibi1yZXNpemVcIlxuICAgIHwgXCJlLXJlc2l6ZVwiXG4gICAgfCBcInMtcmVzaXplXCJcbiAgICB8IFwidy1yZXNpemVcIlxuICAgIHwgXCJuZS1yZXNpemVcIlxuICAgIHwgXCJudy1yZXNpemVcIlxuICAgIHwgXCJzdy1yZXNpemVcIlxuICAgIHwgXCJzZS1yZXNpemVcIlxuICAgIHwgXCJldy1yZXNpemVcIlxuICAgIHwgXCJucy1yZXNpemVcIlxuICAgIHwgXCJuZXN3LXJlc2l6ZVwiXG4gICAgfCBcIm53c2UtcmVzaXplXCJcbiAgICB8IFwiem9vbS1pblwiXG4gICAgfCBcInpvb20tb3V0XCJcblxudHlwZSBBY3Rpb25Hcm91cCA9IFtwcmVmaXg6IHN0cmluZywgYWN0aW9uR3JvdXA6IEdpby5BY3Rpb25Hcm91cF1cbiIsICJpbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTMuMFwiXG5pbXBvcnQgeyB0eXBlIEJpbmRhYmxlQ2hpbGQgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5pbXBvcnQgeyBtZXJnZUJpbmRpbmdzLCBqc3ggYXMgX2pzeCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0ICogYXMgV2lkZ2V0IGZyb20gXCIuL3dpZGdldC5qc1wiXG5cbmV4cG9ydCBmdW5jdGlvbiBGcmFnbWVudCh7IGNoaWxkcmVuID0gW10sIGNoaWxkIH06IHtcbiAgICBjaGlsZD86IEJpbmRhYmxlQ2hpbGRcbiAgICBjaGlsZHJlbj86IEFycmF5PEJpbmRhYmxlQ2hpbGQ+XG59KSB7XG4gICAgaWYgKGNoaWxkKSBjaGlsZHJlbi5wdXNoKGNoaWxkKVxuICAgIHJldHVybiBtZXJnZUJpbmRpbmdzKGNoaWxkcmVuKVxufVxuXG5leHBvcnQgZnVuY3Rpb24ganN4KFxuICAgIGN0b3I6IGtleW9mIHR5cGVvZiBjdG9ycyB8IHR5cGVvZiBHdGsuV2lkZ2V0LFxuICAgIHByb3BzOiBhbnksXG4pIHtcbiAgICByZXR1cm4gX2pzeChjdG9ycywgY3RvciBhcyBhbnksIHByb3BzKVxufVxuXG5jb25zdCBjdG9ycyA9IHtcbiAgICBib3g6IFdpZGdldC5Cb3gsXG4gICAgYnV0dG9uOiBXaWRnZXQuQnV0dG9uLFxuICAgIGNlbnRlcmJveDogV2lkZ2V0LkNlbnRlckJveCxcbiAgICBjaXJjdWxhcnByb2dyZXNzOiBXaWRnZXQuQ2lyY3VsYXJQcm9ncmVzcyxcbiAgICBkcmF3aW5nYXJlYTogV2lkZ2V0LkRyYXdpbmdBcmVhLFxuICAgIGVudHJ5OiBXaWRnZXQuRW50cnksXG4gICAgZXZlbnRib3g6IFdpZGdldC5FdmVudEJveCxcbiAgICAvLyBUT0RPOiBmaXhlZFxuICAgIC8vIFRPRE86IGZsb3dib3hcbiAgICBpY29uOiBXaWRnZXQuSWNvbixcbiAgICBsYWJlbDogV2lkZ2V0LkxhYmVsLFxuICAgIGxldmVsYmFyOiBXaWRnZXQuTGV2ZWxCYXIsXG4gICAgLy8gVE9ETzogbGlzdGJveFxuICAgIG1lbnVidXR0b246IFdpZGdldC5NZW51QnV0dG9uLFxuICAgIG92ZXJsYXk6IFdpZGdldC5PdmVybGF5LFxuICAgIHJldmVhbGVyOiBXaWRnZXQuUmV2ZWFsZXIsXG4gICAgc2Nyb2xsYWJsZTogV2lkZ2V0LlNjcm9sbGFibGUsXG4gICAgc2xpZGVyOiBXaWRnZXQuU2xpZGVyLFxuICAgIHN0YWNrOiBXaWRnZXQuU3RhY2ssXG4gICAgc3dpdGNoOiBXaWRnZXQuU3dpdGNoLFxuICAgIHdpbmRvdzogV2lkZ2V0LldpbmRvdyxcbn1cblxuZGVjbGFyZSBnbG9iYWwge1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbmFtZXNwYWNlXG4gICAgbmFtZXNwYWNlIEpTWCB7XG4gICAgICAgIHR5cGUgRWxlbWVudCA9IEd0ay5XaWRnZXRcbiAgICAgICAgdHlwZSBFbGVtZW50Q2xhc3MgPSBHdGsuV2lkZ2V0XG4gICAgICAgIGludGVyZmFjZSBJbnRyaW5zaWNFbGVtZW50cyB7XG4gICAgICAgICAgICBib3g6IFdpZGdldC5Cb3hQcm9wc1xuICAgICAgICAgICAgYnV0dG9uOiBXaWRnZXQuQnV0dG9uUHJvcHNcbiAgICAgICAgICAgIGNlbnRlcmJveDogV2lkZ2V0LkNlbnRlckJveFByb3BzXG4gICAgICAgICAgICBjaXJjdWxhcnByb2dyZXNzOiBXaWRnZXQuQ2lyY3VsYXJQcm9ncmVzc1Byb3BzXG4gICAgICAgICAgICBkcmF3aW5nYXJlYTogV2lkZ2V0LkRyYXdpbmdBcmVhUHJvcHNcbiAgICAgICAgICAgIGVudHJ5OiBXaWRnZXQuRW50cnlQcm9wc1xuICAgICAgICAgICAgZXZlbnRib3g6IFdpZGdldC5FdmVudEJveFByb3BzXG4gICAgICAgICAgICAvLyBUT0RPOiBmaXhlZFxuICAgICAgICAgICAgLy8gVE9ETzogZmxvd2JveFxuICAgICAgICAgICAgaWNvbjogV2lkZ2V0Lkljb25Qcm9wc1xuICAgICAgICAgICAgbGFiZWw6IFdpZGdldC5MYWJlbFByb3BzXG4gICAgICAgICAgICBsZXZlbGJhcjogV2lkZ2V0LkxldmVsQmFyUHJvcHNcbiAgICAgICAgICAgIC8vIFRPRE86IGxpc3Rib3hcbiAgICAgICAgICAgIG1lbnVidXR0b246IFdpZGdldC5NZW51QnV0dG9uUHJvcHNcbiAgICAgICAgICAgIG92ZXJsYXk6IFdpZGdldC5PdmVybGF5UHJvcHNcbiAgICAgICAgICAgIHJldmVhbGVyOiBXaWRnZXQuUmV2ZWFsZXJQcm9wc1xuICAgICAgICAgICAgc2Nyb2xsYWJsZTogV2lkZ2V0LlNjcm9sbGFibGVQcm9wc1xuICAgICAgICAgICAgc2xpZGVyOiBXaWRnZXQuU2xpZGVyUHJvcHNcbiAgICAgICAgICAgIHN0YWNrOiBXaWRnZXQuU3RhY2tQcm9wc1xuICAgICAgICAgICAgc3dpdGNoOiBXaWRnZXQuU3dpdGNoUHJvcHNcbiAgICAgICAgICAgIHdpbmRvdzogV2lkZ2V0LldpbmRvd1Byb3BzXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBjb25zdCBqc3hzID0ganN4XG4iLCAiLy8gVGhlIGRvY2suIEJlaGF2aW9yIG1vZGVsIChwcm90b3R5cGUtZmluYWwpOlxuLy8gICBjbGljayAgXHUyMDE0IG5vIHdpbmRvd3M6IGxhdW5jaCAoZ2hvc3Qgem9vbSkgXHUwMEI3IHVuZm9jdXNlZDogZm9jdXMgdG9wIHdpbmRvdyAocHVsc2UpXG4vLyAgICAgICAgICAgIGZvY3VzZWQgKyBtdWx0aTogY3ljbGUgXHUwMEI3IGZvY3VzZWQgKyBzaW5nbGU6IG1pbmltaXplXG4vLyAgIHNjcm9sbCBcdTIwMTQgc2luZ2xlOiBmb2N1cyBcdTAwQjcgbXVsdGk6IGN5Y2xlIChjYXJvdXNlbCBudWRnZSwgc3RhbmRhcmQgZGlyZWN0aW9uKVxuLy8gICBtaWRkbGUtY2xpY2sgXHUyMDE0IG5ldyB3aW5kb3cgXHUwMEI3IHJpZ2h0LWNsaWNrIFx1MjAxNCBjb250ZXh0IG1lbnUgKHdpbmRvd3MgbGlzdCArIFF1aXQpXG4vLyBET1RTOiBhYnNvbHV0ZSBvdmVybGF5IChHdGsuT3ZlcmxheSksIHNsaWRpbmcgNC1kb3Qgdmlld3BvcnQsIGVkZ2UgbWluaXMgcGFzdCA0LFxuLy8gZHlpbmctZG90IGNsb3NlIGFuaW1hdGlvbi4gSWNvbnMgb3duIEFMTCBnZW9tZXRyeS5cbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgYmluZCwgVmFyaWFibGUsIGV4ZWNBc3luYyB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQXBwcyBmcm9tIFwiZ2k6Ly9Bc3RhbEFwcHNcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgTU9USU9OLCBzcHJpbmcsIHNwcmluZ1RvIH0gZnJvbSBcIi4uL2xpYi9zcHJpbmdcIlxuaW1wb3J0ICogYXMgZ25vYmxpbiBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBERU1PIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcblxuY29uc3QgUElOTkVEID0gW1xuICAgIFwib3JnLmdub21lLlB0eXhpc1wiLFxuICAgIFwib3JnLmdub21lLk5hdXRpbHVzXCIsXG4gICAgXCJmaXJlZm94XCIsXG4gICAgXCJkZXYuemVkLlplZFwiLFxuICAgIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsXG4gICAgXCJvcmcuZ25vbWUuU2V0dGluZ3NcIixcbl1cblxuZnVuY3Rpb24gRG90cyh7IGFwcElkIH06IHsgYXBwSWQ6IHN0cmluZyB9KSB7XG4gICAgLy8gU2xpZGluZyB2aWV3cG9ydCBpZGVudGljYWwgdG8gdGhlIHByb3RvdHlwZTogXHUyMjY0NCBkb3RzLCBmb2N1c2VkIHBpbGwsXG4gICAgLy8gbWluaXMgd2hlbiB3aW5kb3dzIGV4aXN0IGJleW9uZCB0aGUgdmlzaWJsZSBzbGljZS5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZG90c1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfSBzcGFjaW5nPXszfT5cbiAgICAgICAgICAgIHtiaW5kKGdub2JsaW4ud2luZG93cykuYXMoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgICAgICAgICAgIGNvbnN0IHRvdGFsID0gd3MubGVuZ3RoXG4gICAgICAgICAgICAgICAgY29uc3QgbiA9IE1hdGgubWluKHRvdGFsLCA0KVxuICAgICAgICAgICAgICAgIGNvbnN0IGN1ciA9IHdzLmZpbmRJbmRleCgodykgPT4gdy5mb2N1c2VkKVxuICAgICAgICAgICAgICAgIGxldCBzdGFydCA9IDBcbiAgICAgICAgICAgICAgICBpZiAodG90YWwgPiA0KSBzdGFydCA9IE1hdGgubWluKE1hdGgubWF4KChjdXIgPCAwID8gMCA6IGN1cikgLSAxLCAwKSwgdG90YWwgLSA0KVxuICAgICAgICAgICAgICAgIHJldHVybiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sIChfLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGlkeCA9IHN0YXJ0ICsgaVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBjbHMgPSBbXCJkb3RcIl1cbiAgICAgICAgICAgICAgICAgICAgaWYgKGN1ciA+PSAwICYmIGlkeCA9PT0gY3VyKSBjbHMucHVzaChcIm9uXCIpXG4gICAgICAgICAgICAgICAgICAgIGlmICh0b3RhbCA+IDQgJiYgKChpID09PSAwICYmIHN0YXJ0ID4gMCkgfHwgKGkgPT09IG4gLSAxICYmIHN0YXJ0ICsgNCA8IHRvdGFsKSkpXG4gICAgICAgICAgICAgICAgICAgICAgICBjbHMucHVzaChcIm1pbmlcIilcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIDxib3ggY2xhc3M9e2Nscy5qb2luKFwiIFwiKX0gLz5cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gRG9ja0J1dHRvbih7IGFwcCB9OiB7IGFwcDogQXBwcy5BcHBsaWNhdGlvbiB9KSB7XG4gICAgY29uc3QgYXBwSWQgPSBhcHAuZW50cnkucmVwbGFjZSgvXFwuZGVza3RvcCQvLCBcIlwiKVxuXG4gICAgY29uc3Qgb25DbGljayA9ICgpID0+IHtcbiAgICAgICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG4gICAgICAgIGlmICghd3MubGVuZ3RoKSByZXR1cm4gdm9pZCBhcHAubGF1bmNoKCkgLy8gKyBnaG9zdCB6b29tIChyZXZlYWxlciBzY2FsZSBhbmltKVxuICAgICAgICBjb25zdCBmb2N1c2VkID0gd3MuZmluZCgodykgPT4gdy5mb2N1c2VkKVxuICAgICAgICBpZiAoIWZvY3VzZWQpXG4gICAgICAgICAgICByZXR1cm4gdm9pZCBnbm9ibGluLmFjdGl2YXRlKFxuICAgICAgICAgICAgICAgIHdzLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gTnVtYmVyKGIuZm9jdXNlZCkgLSBOdW1iZXIoYS5mb2N1c2VkKSlbMF0uaWRcbiAgICAgICAgICAgIClcbiAgICAgICAgaWYgKHdzLmxlbmd0aCA+IDEpIHJldHVybiB2b2lkIGdub2JsaW4uY3ljbGUoYXBwSWQsIDEpXG4gICAgICAgIGdub2JsaW4ubWluaW1pemUoZm9jdXNlZC5pZClcbiAgICB9XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICBjbGFzcz1cImRidG5cIlxuICAgICAgICAgICAgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfVxuICAgICAgICAgICAgb25DbGlja2VkPXtvbkNsaWNrfVxuICAgICAgICAgICAgb25CdXR0b25QcmVzc2VkPXsoX3csIGUpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBtaWRkbGUtY2xpY2sgXHUyMTkyIG5ldyB3aW5kb3dcbiAgICAgICAgICAgICAgICBpZiAoZS5nZXRfYnV0dG9uKCkgPT09IEdkay5CVVRUT05fTUlERExFKSBhcHAubGF1bmNoKClcbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBvblNjcm9sbD17KF93LCBfZHgsIGR5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG4gICAgICAgICAgICAgICAgaWYgKCF3cy5sZW5ndGgpIHJldHVyblxuICAgICAgICAgICAgICAgIGlmICh3cy5sZW5ndGggPiAxKSBnbm9ibGluLmN5Y2xlKGFwcElkLCBkeSA+IDAgPyAxIDogLTEpXG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoIXdzWzBdLmZvY3VzZWQpIGdub2JsaW4uYWN0aXZhdGUod3NbMF0uaWQpXG4gICAgICAgICAgICB9fVxuICAgICAgICA+XG4gICAgICAgICAgICA8b3ZlcmxheT5cbiAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpY29uLXRpbGVcIlxuICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT17YXBwLmljb25fbmFtZSB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwifVxuICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgey8qIGRvdHMgYXMgT1ZFUkxBWSBcdTIwMTQgemVybyBsYXlvdXQgZm9vdHByaW50ICovfVxuICAgICAgICAgICAgICAgIDxEb3RzIHR5cGU9XCJvdmVybGF5XCIgYXBwSWQ9e2FwcElkfSAvPlxuICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmZ1bmN0aW9uIE1lZGlhV2lkZ2V0KCkge1xuICAgIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAgIC8vIFBpY2sgdGhlIGZpcnN0IGFjdGl2ZSBwbGF5ZXIsIG9yIG51bGwgaWYgbm90aGluZyBpcyBwbGF5aW5nXG4gICAgY29uc3QgcGxheWVyID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKFxuICAgICAgICAocHMpID0+IHBzLmZpbmQoKHApID0+IHAucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXSA/PyBudWxsXG4gICAgKVxuICAgIGNvbnN0IHByb2dyZXNzID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKChwcykgPT4ge1xuICAgICAgICBjb25zdCBwID0gcHMuZmluZCgocSkgPT4gcS5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdXG4gICAgICAgIGlmICghcCB8fCAhcC5sZW5ndGggfHwgcC5sZW5ndGggPD0gMCkgcmV0dXJuIDBcbiAgICAgICAgcmV0dXJuIHAucG9zaXRpb24gLyBwLmxlbmd0aFxuICAgIH0pXG4gICAgY29uc3QgaWNvbiA9IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgY29uc3QgcCA9IHBzLmZpbmQoKHEpID0+IHEucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXVxuICAgICAgICBpZiAoIXApIHJldHVybiBcImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgcmV0dXJuIHAucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgOiBcImtvYmVsLXBsYXktc3ltYm9saWNcIlxuICAgIH0pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRidG4gZHdpZGdldFwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHBsYXktcGF1c2VcIil9PlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImR0aWxlXCI+XG4gICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJkZ1wiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT17aWNvbn1cbiAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MTh9XG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxldmVsYmFyXG4gICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtcHJvZ1wiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICB2YWx1ZT17cHJvZ3Jlc3N9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPC9idXR0b24+XG4gICAgKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERFTU8gbW9kZTogcmVuZGVyIHRoZSBwcm90b3R5cGUncyBFWEFDVCBkb2NrIChkb2NzL3Byb3RvdHlwZS5odG1sKSB3aXRoIHJlYWwgR1RLXG4vLyB3aWRnZXRzLCBzbyBpdCBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXIgMToxLiBJY29ucyBsb2FkIGZyb20gdGhlXG4vLyBTQU1FIG9uLWRpc2sgZmlsZXMgdGhlIHByb3RvdHlwZSByZWZlcmVuY2VzICh2aWEgYSBGaWxlSWNvbiBnaWNvbikgcmF0aGVyIHRoYW4gYnlcbi8vIHRoZW1lZCBuYW1lIFx1MjAxNCBhIHRoZW1lZCBsb29rdXAgc25hcHMgdG8gYSBkaWZmZXJlbnQgc2l6ZSB2YXJpYW50IChlLmcuIHRoZSAzMnB4IGZpcmVmb3hcbi8vIGluc3RlYWQgb2YgdGhlIHByb3RvdHlwZSdzIDI1NnB4IHBuZykgYW5kIGRvd25zY2FsZXMgZGlmZmVyZW50bHkuIFNhbWUgc291cmNlIGZpbGUgXHUyMTkyXG4vLyBjbG9zZXN0IGNyb3NzLWVuZ2luZSBtYXRjaC4gKHBpeGVsLXNpemUgaXMgaG9ub3VyZWQgbm93IHRoZSBpY29uLXRpbGUgbWluIGlzIDMwLilcbmNvbnN0IERFTU9fQVBQUyA9IFtcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiVGVybWluYWxcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuUHR5eGlzLnN2Z1wiLFxuICAgICAgICBkb3RzOiBbXCJvblwiLCBcImRvdFwiXSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgbmFtZTogXCJGaWxlc1wiLFxuICAgICAgICBpY29uOiBcIi91c3Ivc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL29yZy5nbm9tZS5OYXV0aWx1cy5zdmdcIixcbiAgICAgICAgZG90czogW1wiZG90XCJdLFxuICAgIH0sXG4gICAgeyBuYW1lOiBcIkZpcmVmb3hcIiwgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3IvMjU2eDI1Ni9hcHBzL2ZpcmVmb3gucG5nXCIsIGRvdHM6IFtdIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlplZFwiLFxuICAgICAgICBpY29uOiBcIi9ob21lL2tpZXJhbi8ubG9jYWwvemVkLmFwcC9zaGFyZS9pY29ucy9oaWNvbG9yLzUxMng1MTIvYXBwcy96ZWQucG5nXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuYW1lOiBcIlNwb3RpZnlcIixcbiAgICAgICAgaWNvbjogXCIvdmFyL2xpYi9mbGF0cGFrL2V4cG9ydHMvc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL2NvbS5zcG90aWZ5LkNsaWVudC5zdmdcIixcbiAgICAgICAgZG90czogW10sXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG5hbWU6IFwiU2V0dGluZ3NcIixcbiAgICAgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuU2V0dGluZ3Muc3ZnXCIsXG4gICAgICAgIGRvdHM6IFtdLFxuICAgIH0sXG5dXG5cbmZ1bmN0aW9uIGZpbGVJY29uKHBhdGg6IHN0cmluZyk6IEdpby5JY29uIHtcbiAgICByZXR1cm4gR2lvLkZpbGVJY29uLm5ldyhHaW8uRmlsZS5uZXdfZm9yX3BhdGgocGF0aCkpXG59XG5cbmZ1bmN0aW9uIERlbW9CdXR0b24oeyBhcHAgfTogeyBhcHA6ICh0eXBlb2YgREVNT19BUFBTKVtudW1iZXJdIH0pIHtcbiAgICAvLyBOQjogdGhlIGRvdHMgYm94IGNhcnJpZXMgYHR5cGU9XCJvdmVybGF5XCJgIERJUkVDVExZIChpbnRyaW5zaWMgZWxlbWVudCkgXHUyMDE0IGEgZnVuY3Rpb25cbiAgICAvLyBjb21wb25lbnQgd291bGQgc3dhbGxvdyB0aGUgcHJvcCwgbGV0dGluZyB0aGUgdW50eXBlZCBib3ggcmVwbGFjZSB0aGUgaWNvbiBhcyB0aGVcbiAgICAvLyBvdmVybGF5J3MgbWFpbiBjaGlsZCAoR3RrT3ZlcmxheS5zZXRfY2hpbGQpLiBJY29uIHN0YXlzIG1haW47IGRvdHMgb3ZlcmxheSBvbiB0b3AuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRidG5cIiB0b29sdGlwVGV4dD17YXBwLm5hbWV9PlxuICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaWNvbi10aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgZ2ljb249e2ZpbGVJY29uKGFwcC5pY29uKX1cbiAgICAgICAgICAgICAgICAgICAgcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJkb3RzXCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezN9XG4gICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICB7YXBwLmRvdHMubWFwKChjbHMpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9e2NscyA9PT0gXCJvblwiID8gXCJkb3Qgb25cIiA6IFwiZG90XCJ9IC8+XG4gICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICApXG59XG5cbmZ1bmN0aW9uIERlbW9Eb2NrKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImRvY2tcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtZG9ja1wiXG4gICAgICAgICAgICBjbGFzcz1cImRvY2std2luZG93XCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5CT1RUT019XG4gICAgICAgID5cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJkb2NrXCIgc3BhY2luZz17NH0+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMF19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMV19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMl19IC8+XG4gICAgICAgICAgICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbM119IC8+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1s0XX0gLz5cbiAgICAgICAgICAgICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1s1XX0gLz5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIGlmIChERU1PKSByZXR1cm4gRGVtb0RvY2sobW9uaXRvcilcblxuICAgIGNvbnN0IGFwcHMgPSBuZXcgQXBwcy5BcHBzKClcbiAgICAvLyBQaW5uZWQgZW50cmllcyByZXNvbHZlZCBieSBkZXNrdG9wLWlkOyB0aGUgZG9jayBuZXZlciBzaXRzIGVtcHR5LCBzbyBmaWxsIGFueVxuICAgIC8vIHVucmVzb2x2ZWQgc2xvdHMgKGUuZy4gYW4gYXBwIG5vdCBpbnN0YWxsZWQgaW4gdGhlIGRldmtpdCkgZnJvbSB0aGUgaW5zdGFsbGVkXG4gICAgLy8gbGlzdC4gT24gcmVhbCBoYXJkd2FyZSB0aGUgcGlucyByZXNvbHZlIGFuZCB0aGUgZmlsbCBpcyB1bnVzZWQuXG4gICAgY29uc3QgYWxsID0gYXBwcy5nZXRfbGlzdCgpXG4gICAgY29uc3QgcmVzb2x2ZSA9IChpZDogc3RyaW5nKTogQXBwcy5BcHBsaWNhdGlvbiB8IHVuZGVmaW5lZCA9PlxuICAgICAgICBhbGwuZmluZCgoYSkgPT4gYS5lbnRyeSA9PT0gYCR7aWR9LmRlc2t0b3BgIHx8IGEuZW50cnkgPT09IGlkKSA/P1xuICAgICAgICBhbGwuZmluZCgoYSkgPT4gYS5lbnRyeT8udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhpZC50b0xvd2VyQ2FzZSgpLnNwbGl0KFwiLlwiKS5wb3AoKSEpKVxuICAgIC8vIEFsd2F5cyByZW5kZXIgb25lIHNsb3QgcGVyIHBpbiBzbyB0aGUgZG9jayBrZWVwcyBpdHMgc2hhcGU7IHJlc29sdmVkIHBpbnMgZ2V0IHRoZVxuICAgIC8vIHJlYWwgYXBwICsgYmVoYXZpb3IsIHVucmVzb2x2ZWQgb25lcyBhIGxhYmVsbGVkIHBsYWNlaG9sZGVyIHRpbGUuIEEgc2VwYXJhdG9yIHNpdHNcbiAgICAvLyBiZXR3ZWVuIHRoZSBmb3VydGggYW5kIGZpZnRoIHBpbnMgKHByb3RvdHlwZSBwYXJpdHkpLCB0aGVuIGJlZm9yZSB0aGUgbWVkaWEgd2lkZ2V0LlxuICAgIGNvbnN0IHNsb3RzID0gUElOTkVELm1hcCgoaWQpID0+ICh7IGlkLCBhcHA6IHJlc29sdmUoaWQpIH0pKVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJkb2NrXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIlxuICAgICAgICAgICAgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICA+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAgICAgICAgICAgIHtzbG90cy5tYXAoKHsgaWQsIGFwcCB9LCBpKSA9PiBbXG4gICAgICAgICAgICAgICAgICAgIGkgPT09IDQgPyA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPiA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGFwcCA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxEb2NrQnV0dG9uIGFwcD17YXBwfSAvPlxuICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRidG4gcGxhY2Vob2xkZXJcIiB0b29sdGlwVGV4dD17aWQuc3BsaXQoXCIuXCIpLnBvcCgpfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpY29uLXRpbGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpY29uTmFtZT1cImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZS1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICAgIF0pfVxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgICAgPE1lZGlhV2lkZ2V0IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFRoZSBzcG90bGlnaHQuIFByb3RvdHlwZS1maW5hbCBiZWhhdmlvcjpcbi8vICAgU3VwZXIgcmVsZWFzZSBvcGVucyAoY29tcG9zaXRvciBrZXliaW5kIFx1MjE5MiBgYXN0YWwgLWkga29iZWwgLXQgbGF1bmNoZXJgKVxuLy8gICBmdXp6eSArIGxlYWYgaGlnaGxpZ2h0IFx1MDBCNyBnbG9iYWwgQkVTVC1NQVRDSCBzbG90IChzY29yZS1yYW5rZWQgYWNyb3NzIHByb3ZpZGVycyxcbi8vICAgdHlwZSB3ZWlnaHRzIGFwcHMgMSAvIGFjdGlvbnMgLjk1IC8gZmlsZXMgLjkpIFx1MDBCNyBjYXBwZWQgbG9nMiBmcmVjZW5jeVxuLy8gICBnaG9zdCBhdXRvY29tcGxldGUgPSBmaXJzdCBwcmVmaXgtY29tcGxldGFibGUgbmFtZSBpbiBkaXNwbGF5IG9yZGVyXG4vLyAgIFRhYiBhbHdheXMgb3duZWQgKGdob3N0IGVsc2UgbmV4dDsgU2hpZnQrVGFiIHByZXYpIFx1MDBCNyBDdHJsK04vUCBcdTAwQjcgRXNjIGNsZWFycyBmaXJzdFxuLy8gICBzZWN0aW9uczogYmVzdCBtYXRjaCAvIGFwcHMgLyBhY3Rpb25zIC8gZmlsZXMgLyB3ZWIgKGFsd2F5cy1sYXN0IHJlYWwgcm93KVxuLy8gICAnPScgY2FsY3VsYXRvciBcdTAwQjcgJzonIGdub2JsaW5jdGwgY29tbWFuZHMgXHUwMEI3IGVtcHR5IHN0YXRlOiBkb2NrLXRpbGUgZ3JpZCArIHdpZGdldHNcbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciwgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IEFwcHMgZnJvbSBcImdpOi8vQXN0YWxBcHBzXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcbmltcG9ydCB7IGZ1enp5LCBobCwgYm9vc3QsIGJ1bXAsIGZyZXF1ZW5jeSB9IGZyb20gXCIuLi9saWIvZnV6enlcIlxuaW1wb3J0IHsgRVZFTlRTIH0gZnJvbSBcIi4vQ2FsZW5kYXJcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbi8vIEN1cmF0ZWQgZ3JpZDogdGhlIGRvY2sncyBwaW5uZWQgYXBwcyBmaXJzdCAocmVzb2x2ZWQgYnkgZGVza3RvcC1pZCksIHRoZW4gZmlsbCB0aGVcbi8vIHJlbWFpbmluZyBzbG90cyBieSBmcmVjZW5jeS4gTWF0Y2hlcyB0aGUgcHJvdG90eXBlJ3MgbGF1bmNoZXIgZW1wdHktc3RhdGUuXG5jb25zdCBQSU5ORUQgPSBbXG4gICAgXCJvcmcuZ25vbWUuUHR5eGlzXCIsXG4gICAgXCJvcmcuZ25vbWUuTmF1dGlsdXNcIixcbiAgICBcImZpcmVmb3hcIixcbiAgICBcImRldi56ZWQuWmVkXCIsXG4gICAgXCJjb20uc3BvdGlmeS5DbGllbnRcIixcbiAgICBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiLFxuXVxuLy8gRGVtbyBncmlkOiBmaXhlZCBvcmRlciArIGxhYmVscyB0cmFuc2NyaWJlZCBmcm9tIHRoZSBwcm90b3R5cGUgKEQuYXBwcyksIGVhY2ggbWFwcGVkXG4vLyB0byB0aGUgcmVhbCAuZGVza3RvcCBpZCBzbyBpdHMgdGhlbWVkIGljb24gcmVuZGVycyAoUHR5eGlzL05hdXRpbHVzL1x1MjAyNikuXG5jb25zdCBERU1PX1RJTEVTID0gW1xuICAgIHsgbmFtZTogXCJUZXJtaW5hbFwiLCBpZDogXCJvcmcuZ25vbWUuUHR5eGlzXCIgfSxcbiAgICB7IG5hbWU6IFwiRmlsZXNcIiwgaWQ6IFwib3JnLmdub21lLk5hdXRpbHVzXCIgfSxcbiAgICB7IG5hbWU6IFwiRmlyZWZveFwiLCBpZDogXCJmaXJlZm94XCIgfSxcbiAgICB7IG5hbWU6IFwiWmVkXCIsIGlkOiBcImRldi56ZWQuWmVkXCIgfSxcbiAgICB7IG5hbWU6IFwiU3BvdGlmeVwiLCBpZDogXCJjb20uc3BvdGlmeS5DbGllbnRcIiB9LFxuICAgIHsgbmFtZTogXCJTZXR0aW5nc1wiLCBpZDogXCJvcmcuZ25vbWUuU2V0dGluZ3NcIiB9LFxuXVxuXG5pbnRlcmZhY2UgVGlsZSB7XG4gICAgbmFtZTogc3RyaW5nXG4gICAgaWNvbk5hbWU6IHN0cmluZ1xuICAgIGxhdW5jaDogKCkgPT4gdm9pZFxufVxuZnVuY3Rpb24gZ3JpZFRpbGVzKGFwcHM6IEFwcHMuQXBwcyk6IFRpbGVbXSB7XG4gICAgY29uc3QgYWxsID0gYXBwcy5nZXRfbGlzdCgpXG4gICAgY29uc3QgcmVzb2x2ZSA9IChpZDogc3RyaW5nKTogQXBwcy5BcHBsaWNhdGlvbiB8IHVuZGVmaW5lZCA9PlxuICAgICAgICBhbGwuZmluZCgoYSkgPT4gYS5lbnRyeSA9PT0gYCR7aWR9LmRlc2t0b3BgIHx8IGEuZW50cnkgPT09IGlkKSA/P1xuICAgICAgICBhbGwuZmluZCgoYSkgPT4gYS5lbnRyeT8udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhpZC50b0xvd2VyQ2FzZSgpLnNwbGl0KFwiLlwiKS5wb3AoKSEpKVxuICAgIGNvbnN0IGZyb21BcHAgPSAoYXBwOiBBcHBzLkFwcGxpY2F0aW9uKTogVGlsZSA9PiAoe1xuICAgICAgICBuYW1lOiBhcHAubmFtZSxcbiAgICAgICAgaWNvbk5hbWU6IGFwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIixcbiAgICAgICAgbGF1bmNoOiAoKSA9PiB7XG4gICAgICAgICAgICBidW1wKGFwcC5uYW1lKVxuICAgICAgICAgICAgYXBwLmxhdW5jaCgpXG4gICAgICAgIH0sXG4gICAgfSlcbiAgICBpZiAoREVNTylcbiAgICAgICAgcmV0dXJuIERFTU9fVElMRVMubWFwKCh7IG5hbWUsIGlkIH0pID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGFwcCA9IHJlc29sdmUoaWQpXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgICAgICAgaWNvbk5hbWU6IGFwcD8uaWNvbl9uYW1lIHx8IGlkIHx8IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICAgICAgICAgICAgbGF1bmNoOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGJ1bXAobmFtZSlcbiAgICAgICAgICAgICAgICAgICAgYXBwPy5sYXVuY2goKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgY29uc3QgcGlubmVkID0gUElOTkVELm1hcChyZXNvbHZlKS5maWx0ZXIoQm9vbGVhbikgYXMgQXBwcy5BcHBsaWNhdGlvbltdXG4gICAgY29uc3QgcmVzdCA9IGFsbFxuICAgICAgICAuZmlsdGVyKChhKSA9PiAhcGlubmVkLmluY2x1ZGVzKGEpKVxuICAgICAgICAuc29ydCgoeCwgeSkgPT4gZnJlcXVlbmN5KHkubmFtZSkgLSBmcmVxdWVuY3koeC5uYW1lKSlcbiAgICByZXR1cm4gWy4uLnBpbm5lZCwgLi4ucmVzdF0uc2xpY2UoMCwgNikubWFwKGZyb21BcHApXG59XG5mdW5jdGlvbiB0b2RheUV2ZW50TGFiZWwoKTogc3RyaW5nIHtcbiAgICBpZiAoREVNTykgcmV0dXJuIEQud2lkZ2V0RXZlbnRcbiAgICBjb25zdCBkID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IGV2cyA9IEVWRU5UU1tgJHtkLmdldEZ1bGxZZWFyKCl9LSR7ZC5nZXRNb250aCgpICsgMX0tJHtkLmdldERhdGUoKX1gXSA/PyBbXVxuICAgIHJldHVybiBldnMubGVuZ3RoID8gYCR7ZXZzWzBdLnR9IFx1MDBCNyAke2V2c1swXS5ufWAgOiBcIk5vIGV2ZW50cyB0b2RheVwiXG59XG5mdW5jdGlvbiB0b2RheURhdGVMYWJlbCgpOiBzdHJpbmcge1xuICAgIHJldHVybiBERU1PXG4gICAgICAgID8gRC53aWRnZXREYXRlXG4gICAgICAgIDogbmV3IERhdGUoKS50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7IHdlZWtkYXk6IFwibG9uZ1wiLCBkYXk6IFwibnVtZXJpY1wiLCBtb250aDogXCJsb25nXCIgfSlcbn1cblxuaW50ZXJmYWNlIFJvdyB7XG4gICAgbmFtZTogc3RyaW5nXG4gICAgaWNvbjogc3RyaW5nXG4gICAgaGludDogc3RyaW5nXG4gICAgc2NvcmU6IG51bWJlclxuICAgIG1hcmt1cDogc3RyaW5nXG4gICAgcnVuOiAoKSA9PiB2b2lkXG59XG5cbmNvbnN0IEFDVElPTlMgPSBbXG4gICAge1xuICAgICAgICBuOiBcIlN1c3BlbmRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1tb29uLXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiU2xlZXAgXHUyMDE0IHJlc3VtZSBpbnN0YW50bHlcIixcbiAgICAgICAgYWw6IFtcInNsZWVwXCJdLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCBzdXNwZW5kXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIkxvY2tcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1sb2NrLXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiTG9jayB0aGUgc2Vzc2lvblwiLFxuICAgICAgICBhbDogW1wibG9jayBzY3JlZW5cIl0sXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIkxvZyBPdXRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1sb2dvdXQtc3ltYm9saWNcIixcbiAgICAgICAgZDogXCJFbmQgdGhpcyBzZXNzaW9uXCIsXG4gICAgICAgIGFsOiBbXCJleGl0XCIsIFwic2lnbiBvdXRcIiwgXCJsb2dvdXRcIl0sXG4gICAgICAgIHJ1bjogKCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG46IFwiUmVzdGFydFwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXJlbG9hZC1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlJlYm9vdCB0aGUgbWFjaGluZVwiLFxuICAgICAgICBhbDogW1wicmVib290XCJdLFxuICAgICAgICBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBuOiBcIlNodXQgRG93blwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXBvd2VyLXN5bWJvbGljXCIsXG4gICAgICAgIGQ6IFwiUG93ZXIgb2ZmXCIsXG4gICAgICAgIGFsOiBbXCJwb3dlcm9mZlwiLCBcImhhbHRcIl0sXG4gICAgICAgIHJ1bjogKCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIiksXG4gICAgfSxcbiAgICB7XG4gICAgICAgIG46IFwiU29mdC1yZWxvYWQgZ25vYmxpblwiLFxuICAgICAgICBpY29uOiBcImtvYmVsLXJlbG9hZC1zeW1ib2xpY1wiLFxuICAgICAgICBkOiBcIlJlbG9hZCB0aGUgc2hlbGwgXHUyMDE0IHdpbmRvd3Mgc3Vydml2ZVwiLFxuICAgICAgICBhbDogW10sXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwiZ25vYmxpbmN0bCByZWxvYWRcIiksXG4gICAgfSxcbl1cblxuY29uc3QgQ01EUyA9IFtcbiAgICB7IGM6IFwicmVsb2FkXCIsIGQ6IFwiU29mdC1yZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIiB9LFxuICAgIHsgYzogXCJvc2Qgb2ZmXCIsIGQ6IFwia29iZWwgb3ducyB2b2x1bWUvYnJpZ2h0bmVzcyBwb3B1cHNcIiB9LFxuICAgIHsgYzogXCJub3RpZnMgb2ZmXCIsIGQ6IFwiUmVsZWFzZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9uc1wiIH0sXG4gICAgeyBjOiBcImdyYW50c1wiLCBkOiBcIlNjcmVlbi1yZWNvcmRpbmcgYWNjZXNzIHBlciBhcHBcIiB9LFxuXVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBMYXVuY2hlcigpIHtcbiAgICBjb25zdCBhcHBzID0gbmV3IEFwcHMuQXBwcygpXG4gICAgLy8gS09CRUxfUVVFUlkgcHJlLWZpbGxzIHRoZSBzZWFyY2ggc28gdGhlIGRldmtpdCBjYW4gcmVuZGVyIHRoZSByZXN1bHRzIHN0YXRlLlxuICAgIGNvbnN0IHF1ZXJ5ID0gVmFyaWFibGUoR0xpYi5nZXRlbnYoXCJLT0JFTF9RVUVSWVwiKSB8fCBcIlwiKVxuICAgIGNvbnN0IHNlbGVjdGVkID0gVmFyaWFibGUoMClcbiAgICBjb25zdCBnaG9zdCA9IFZhcmlhYmxlKFwiXCIpXG5cbiAgICBmdW5jdGlvbiByZXN1bHRzKHE6IHN0cmluZyk6IHsgc2VjdGlvbjogc3RyaW5nOyByb3dzOiBSb3dbXSB9W10ge1xuICAgICAgICBjb25zdCBxdCA9IHEudHJpbSgpXG4gICAgICAgIGlmICghcXQpIHJldHVybiBbXVxuICAgICAgICBpZiAocXQuc3RhcnRzV2l0aChcIjpcIikpIHtcbiAgICAgICAgICAgIGNvbnN0IGNxID0gcXQuc2xpY2UoMSkudHJpbSgpXG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgc2VjdGlvbjogXCJnbm9ibGluY3RsXCIsXG4gICAgICAgICAgICAgICAgICAgIHJvd3M6IENNRFMuZmlsdGVyKChjKSA9PiBjLmMuc3RhcnRzV2l0aChjcSkpLm1hcCgoYykgPT4gKHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG5hbWU6IGA6JHtjLmN9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb246IFwia29iZWwtdGVybWluYWwtc3ltYm9saWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgIGhpbnQ6IGMuZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNjb3JlOiA5OSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmt1cDogYDoke2MuY31gLFxuICAgICAgICAgICAgICAgICAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoYGdub2JsaW5jdGwgJHtjLmN9YCksXG4gICAgICAgICAgICAgICAgICAgIH0pKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG91dDogeyBzZWN0aW9uOiBzdHJpbmc7IHJvd3M6IFJvd1tdIH1bXSA9IFtdXG4gICAgICAgIC8vICc9JyBjYWxjdWxhdG9yIChjaGFyc2V0LWd1YXJkZWQsIHNhbWUgYXMgcHJvdG90eXBlKVxuICAgICAgICBpZiAoL149P1swLTkrXFwtKi8oKS4gXSskLy50ZXN0KHF0KSAmJiAvWzAtOV0vLnRlc3QocXQpICYmIC9bK1xcLSovXS8udGVzdChxdCkpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdiA9IEZ1bmN0aW9uKGBcInVzZSBzdHJpY3RcIjtyZXR1cm4oJHtxdC5yZXBsYWNlKC9ePS8sIFwiXCIpfSlgKSgpXG4gICAgICAgICAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZSh2KSlcbiAgICAgICAgICAgICAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VjdGlvbjogXCJjYWxjdWxhdG9yXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICByb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiBTdHJpbmcodiksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb246IFwia29iZWwtY2FsY3VsYXRvci1zeW1ib2xpY1wiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaW50OiBgJHtxdC5yZXBsYWNlKC9ePS8sIFwiXCIpfSA9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2NvcmU6IDk4LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrdXA6IFN0cmluZyh2KSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoW1wid2wtY29weVwiLCBTdHJpbmcodildKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0gY2F0Y2gge31cbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhcHBSb3dzOiBSb3dbXSA9IGFwcHNcbiAgICAgICAgICAgIC5mdXp6eV9xdWVyeShxdClcbiAgICAgICAgICAgIC5zbGljZSgwLCA1KVxuICAgICAgICAgICAgLm1hcCgoYSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IG0gPSBmdXp6eShxdCwgYS5uYW1lKSA/PyB7IHNjb3JlOiAxLCBtYXJrczogbnVsbCBhcyBhbnkgfVxuICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IGEubmFtZSxcbiAgICAgICAgICAgICAgICAgICAgaWNvbjogYS5pY29uX25hbWUgPz8gXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIixcbiAgICAgICAgICAgICAgICAgICAgaGludDogXCJBcHBsaWNhdGlvblwiLFxuICAgICAgICAgICAgICAgICAgICBzY29yZTogbS5zY29yZSArIGJvb3N0KGEubmFtZSksXG4gICAgICAgICAgICAgICAgICAgIG1hcmt1cDogaGwoYS5uYW1lLCBtLm1hcmtzKSxcbiAgICAgICAgICAgICAgICAgICAgcnVuOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBidW1wKGEubmFtZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGEubGF1bmNoKClcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICBjb25zdCBhY3RSb3dzOiBSb3dbXSA9IEFDVElPTlMubWFwKCh4KSA9PiB7XG4gICAgICAgICAgICBsZXQgbSA9IGZ1enp5KHF0LCB4Lm4pXG4gICAgICAgICAgICBpZiAoIW0pXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbCBvZiB4LmFsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFtID0gZnV6enkocXQsIGFsKVxuICAgICAgICAgICAgICAgICAgICBpZiAoYW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG0gPSB7IHNjb3JlOiBhbS5zY29yZSAtIDAuNSwgbWFya3M6IG51bGwgYXMgYW55IH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gbVxuICAgICAgICAgICAgICAgID8gKHtcbiAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB4Lm4sXG4gICAgICAgICAgICAgICAgICAgICAgaWNvbjogeC5pY29uLFxuICAgICAgICAgICAgICAgICAgICAgIGhpbnQ6IHguZCxcbiAgICAgICAgICAgICAgICAgICAgICBzY29yZTogbS5zY29yZSAqIDAuOTUsXG4gICAgICAgICAgICAgICAgICAgICAgbWFya3VwOiBobCh4Lm4sIChtIGFzIGFueSkubWFya3MpLFxuICAgICAgICAgICAgICAgICAgICAgIHJ1bjogeC5ydW4sXG4gICAgICAgICAgICAgICAgICB9IGFzIFJvdylcbiAgICAgICAgICAgICAgICA6IG51bGxcbiAgICAgICAgfSkuZmlsdGVyKEJvb2xlYW4pIGFzIFJvd1tdXG4gICAgICAgIC8vIGdsb2JhbCBiZXN0LW1hdGNoIHNsb3QgKGNyaXRpcXVlIEExKVxuICAgICAgICBjb25zdCBhbGwgPSBbLi4uYXBwUm93cywgLi4uYWN0Um93c10uc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpXG4gICAgICAgIGNvbnN0IGJlc3QgPSBhbGxbMF1cbiAgICAgICAgaWYgKGJlc3QpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJiZXN0IG1hdGNoXCIsIHJvd3M6IFtiZXN0XSB9KVxuICAgICAgICBjb25zdCByZXN0ID0gKHJvd3M6IFJvd1tdKSA9PiByb3dzLmZpbHRlcigocikgPT4gciAhPT0gYmVzdClcbiAgICAgICAgaWYgKHJlc3QoYXBwUm93cykubGVuZ3RoKSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYXBwc1wiLCByb3dzOiByZXN0KGFwcFJvd3MpIH0pXG4gICAgICAgIGlmIChyZXN0KGFjdFJvd3MpLmxlbmd0aCkgb3V0LnB1c2goeyBzZWN0aW9uOiBcImFjdGlvbnNcIiwgcm93czogcmVzdChhY3RSb3dzKS5zbGljZSgwLCAzKSB9KVxuICAgICAgICBvdXQucHVzaCh7XG4gICAgICAgICAgICBzZWN0aW9uOiBcIndlYlwiLFxuICAgICAgICAgICAgcm93czogW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogYFNlYXJjaCB0aGUgd2ViIGZvciBcdTIwMUMke3F0fVx1MjAxRGAsXG4gICAgICAgICAgICAgICAgICAgIGljb246IFwia29iZWwtZ2xvYmUtc3ltYm9saWNcIixcbiAgICAgICAgICAgICAgICAgICAgaGludDogXCJcIixcbiAgICAgICAgICAgICAgICAgICAgc2NvcmU6IDAsXG4gICAgICAgICAgICAgICAgICAgIG1hcmt1cDogYFNlYXJjaCB0aGUgd2ViIGZvciBcdTIwMUMke3F0fVx1MjAxRGAsXG4gICAgICAgICAgICAgICAgICAgIHJ1bjogKCkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgIGV4ZWNBc3luYyhbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXCJ4ZGctb3BlblwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGBodHRwczovL2R1Y2tkdWNrZ28uY29tLz9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHF0KX1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgXSksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgIH0pXG4gICAgICAgIC8vIGdob3N0ID0gZmlyc3QgcHJlZml4LWNvbXBsZXRhYmxlIG5hbWUgaW4gZGlzcGxheSBvcmRlciAoY3JpdGlxdWUgQTQpXG4gICAgICAgIGNvbnN0IGcgPSBvdXRcbiAgICAgICAgICAgIC5mbGF0TWFwKChzKSA9PiBzLnJvd3MpXG4gICAgICAgICAgICAubWFwKChyKSA9PiByLm5hbWUpXG4gICAgICAgICAgICAuZmluZCgobikgPT4gbi50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocXQudG9Mb3dlckNhc2UoKSkgJiYgbi5sZW5ndGggPiBxdC5sZW5ndGgpXG4gICAgICAgIGdob3N0LnNldChnID8/IFwiXCIpXG4gICAgICAgIHJldHVybiBvdXRcbiAgICB9XG5cbiAgICBjb25zdCBzZWN0aW9ucyA9IGJpbmQocXVlcnkpLmFzKHJlc3VsdHMpXG5cbiAgICBjb25zdCB7XG4gICAgICAgIHdpblZpc2libGUsXG4gICAgICAgIHJldmVhbGVkOiBsYXVuY2hSZXZlYWxlZCxcbiAgICAgICAgc2V0UmV2ZWFsZXI6IHNldExhdW5jaFJldmVhbGVyLFxuICAgICAgICBjbG9zZTogbGF1bmNoQ2xvc2UsXG4gICAgICAgIHRvZ2dsZTogdG9nZ2xlRm4sXG4gICAgfSA9IG1ha2VSZXZlYWwoMjIwLCAxNTApXG4gICAgcmVnaXN0ZXIoXCJsYXVuY2hlclwiLCB0b2dnbGVGbilcbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwibGF1bmNoZXJcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtbGF1bmNoZXJcIlxuICAgICAgICAgICAgY2xhc3M9XCJsYXVuY2hlci13aW5kb3dcIlxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuRVhDTFVTSVZFfVxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXksIF9jb2RlLCBtb2RzKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmxhdCA9IHJlc3VsdHMocXVlcnkuZ2V0KCkpLmZsYXRNYXAoKHMpID0+IHMucm93cylcbiAgICAgICAgICAgICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAocXVlcnkuZ2V0KCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChcIlwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfVGFiKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFRhYiBpcyBBTFdBWVMgb3duZWRcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZyA9IGdob3N0LmdldCgpLFxuICAgICAgICAgICAgICAgICAgICAgICAgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgICAgICAgICAgICAgIGlmIChnICYmICEobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSykpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChnKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoXG4gICAgICAgICAgICAgICAgICAgICAgICAoc2VsZWN0ZWQuZ2V0KCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIChtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5TSElGVF9NQVNLID8gLTEgOiAxKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZmxhdC5sZW5ndGgpICVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgIG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLkNPTlRST0xfTUFTSyAmJlxuICAgICAgICAgICAgICAgICAgICAoa2V5ID09PSBHZGsuS0VZX24gfHwga2V5ID09PSBHZGsuS0VZX3ApXG4gICAgICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldChcbiAgICAgICAgICAgICAgICAgICAgICAgIChzZWxlY3RlZC5nZXQoKSArIChrZXkgPT09IEdkay5LRVlfbiA/IDEgOiAtMSkgKyBmbGF0Lmxlbmd0aCkgJVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hdGgubWF4KGZsYXQubGVuZ3RoLCAxKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfRG93bikge1xuICAgICAgICAgICAgICAgICAgICBzZWxlY3RlZC5zZXQoKHNlbGVjdGVkLmdldCgpICsgMSkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfVXApIHtcbiAgICAgICAgICAgICAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSAtIDEgKyBmbGF0Lmxlbmd0aCkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfUmV0dXJuKSB7XG4gICAgICAgICAgICAgICAgICAgIGZsYXRbc2VsZWN0ZWQuZ2V0KCldPy5ydW4oKVxuICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5LnNldChcIlwiKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgIH19XG4gICAgICAgID5cbiAgICAgICAgICAgIDxyZXZlYWxlclxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZS5TTElERV9ET1dOfVxuICAgICAgICAgICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICAgICAgICAgIHJldmVhbENoaWxkPXtiaW5kKGxhdW5jaFJldmVhbGVkKX1cbiAgICAgICAgICAgICAgICBzZXR1cD17KHI6IEd0ay5SZXZlYWxlcikgPT4gc2V0TGF1bmNoUmV2ZWFsZXIocil9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNoZWV0IGxhdW5jaGVyXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJmaWVsZFwiIHNwYWNpbmc9ezExfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW1hZ25pZnlpbmctZ2xhc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPG92ZXJsYXkgaGV4cGFuZD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8ZW50cnlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXR1cD17KHNlbGY6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5zZXRfbWF4X3dpZHRoX2NoYXJzKDEpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZWxmLnNldF93aWR0aF9jaGFycygxKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0PXtiaW5kKHF1ZXJ5KX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25Ob3RpZnlUZXh0PXsoZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVlcnkuc2V0KGUudGV4dClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlbGVjdGVkLnNldCgwKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIHBsYWNlaG9sZGVyIGFzIGFuIE9WRVJMQVkgbGFiZWwgKG5vdCBlbnRyeSBwbGFjZWhvbGRlclRleHQpIHNvIGl0cyB0ZXh0XG4gICAgICAgICAgICAgIHdpZHRoIGNhbid0IGluZmxhdGUgdGhlIGVudHJ5J3MgbmF0dXJhbCBzaXplIFx1MjE5MiBwYW5lbCBzdGF5cyBhdCBtaW4td2lkdGggKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJscGxhY2Vob2xkZXJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChxdWVyeSkuYXMoKHEpID0+ICFxKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJTZWFyY2ggXHUyMDE0IGFwcHMsIGZpbGVzLCBhY3Rpb25zIFx1MDBCNyAnOicgY21kcyBcdTAwQjcgJz0nIG1hdGhzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlPVwib3ZlcmxheVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZ2hvc3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZChnaG9zdCkuYXMoKGcpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHEgPSBxdWVyeS5nZXQoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGcudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKHEudG9Mb3dlckNhc2UoKSkgJiYgcSA/IGcgOiBcIlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJrYmRcIiBsYWJlbD1cInN1cGVyXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cblxuICAgICAgICAgICAgICAgICAgICB7LyogZW1wdHkgc3RhdGU6IGN1cmF0ZWQgZnJlY2VuY3kgdGlsZSBncmlkICsgd2lkZ2V0IHJvdyAqL31cbiAgICAgICAgICAgICAgICAgICAgPHJldmVhbGVyIHJldmVhbENoaWxkPXtiaW5kKHF1ZXJ5KS5hcygocSkgPT4gIXEudHJpbSgpKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJ0aWxlc1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17Nn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtncmlkVGlsZXMoYXBwcykubWFwKCh0KSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ0aWxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdC5sYXVuY2goKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXVuY2hDbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNwYWNpbmc9ezh9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJpY29uLXRpbGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e3QuaWNvbk5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXt0Lm5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXhXaWR0aENoYXJzPXs5fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiB0d28gY2FyZHMgc3BsaXQgdGhlIHJvdyBleGFjdGx5IGluIGhhbGYgXHUyMDE0IHByb3RvIGZsZXg6MS9mbGV4OjEgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3aWRnZXRzXCIgc3BhY2luZz17N30gaG9tb2dlbmVvdXM+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBsZWZ0IGNhcmQgXHUyMDE0IGRhdGUgKyB0b2RheSdzIGZpcnN0IGV2ZW50ICovfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIndpZGdldCBsd1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3BhY2luZz17Mn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ0blwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3RvZGF5RGF0ZUxhYmVsKCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJoaW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17dG9kYXlFdmVudExhYmVsKCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIHJpZ2h0IGNhcmQgXHUyMDE0IG1lZGlhIG1pbmktY2FyZDogYXJ0IFx1MDBCNyB0aXRsZS9hcnRpc3QgXHUwMEI3IHBsYXkgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgbXByaXMgPSBNcHJpcy5nZXRfZGVmYXVsdCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBhY3RpdmVQbGF5ZXIgPSBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHBzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcy5maW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHApID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcC5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApID8/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzWzBdID8/XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG51bGxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lZGlhVGl0bGUgPSBERU1PXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBELm1lZGlhLnRpdGxlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMoKHBzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcCA9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBzLmZpbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocSkgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxLnBsYXliYWNrX3N0YXR1cyA9PT1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgPz8gcHNbMF1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcD8udGl0bGUgPz8gXCJOb3RoaW5nIHBsYXlpbmdcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lZGlhQXJ0aXN0ID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gRC5tZWRpYS5hcnRpc3RcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHMuZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChxKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHEucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA/PyBwc1swXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBwPy5hcnRpc3QgPz8gXCJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBsYXlJY29uID0gREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcygocHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwID1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHMuZmluZChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChxKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHEucGxheWJhY2tfc3RhdHVzID09PVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA/PyBwc1swXVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBwPy5wbGF5YmFja19zdGF0dXMgPT09XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBcImtvYmVsLXBsYXktc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIndpZGdldCBsd21cIiBoZXhwYW5kIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3YXJ0XCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJsd3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtdGl0bGVcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17bWVkaWFUaXRsZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cImhpbnRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17bWVkaWFBcnRpc3R9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtYnRuIHBsYXlcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJwbGF5ZXJjdGwgcGxheS1wYXVzZVwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtwbGF5SWNvbn0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pKCl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgPC9yZXZlYWxlcj5cblxuICAgICAgICAgICAgICAgICAgICB7LyogcmVzdWx0cyAqL31cbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImxyb3dzXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgICAgICAgICAgICAgICAgICB7c2VjdGlvbnMuYXMoKHNlY3MpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2Vjcy5mbGF0TWFwKChzZWMpID0+IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic2VjXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtzZWMuc2VjdGlvbn0gLz4sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLnNlYy5yb3dzLm1hcCgocikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmxhdElkeCA9IHNlY3MuZmxhdE1hcCgocykgPT4gcy5yb3dzKS5pbmRleE9mKHIpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e2JpbmQoc2VsZWN0ZWQpLmFzKChzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcyA9PT0gZmxhdElkeCA/IFwicm93IHNlbFwiIDogXCJyb3dcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHIucnVuKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhdW5jaENsb3NlKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTF9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIDI4XHUwMEQ3MjggcjggcGFuZWwyIGZyYW1lIGFyb3VuZCB0aGUgMjRweCBpY29uIChwcm90b3R5cGUgLnJpKSAqL31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJyaVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtyLmljb259IHBpeGVsU2l6ZT17MjR9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9e3IubWFya3VwfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJoaW50XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtyLmhpbnR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJydW5rXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIlx1MjFCNVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChzZWxlY3RlZCkuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChzKSA9PiBzID09PSBmbGF0SWR4XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdKVxuICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG5cbiAgICAgICAgICAgICAgICAgICAgey8qIGZvb3RlciBoaW50IHJvdyBcdTIwMTQgbWF0Y2hlcyBwcm90b3R5cGUgLmxmb290ICovfVxuICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibGZvb3RcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTR9IGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46cmVsb2FkPC9iPiBzb2Z0LXJlbG9hZFwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD1cIjxiPjpvc2Q8L2I+IHRvZ2dsZVwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD1cIjxiPjpncmFudHM8L2I+IHNjcmVlbiBhY2Nlc3NcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJcdTIxOTFcdTIxOTMgc2VsZWN0IFx1MDBCNyBcdTIxQjUgcnVuXCIgaGFsaWduPXtHdGsuQWxpZ24uRU5EfSAvPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiIsICIvLyBMYXVuY2hlciBtYXRjaGluZyBcdTIwMTQgc3RyYWlnaHQgcG9ydCBvZiB0aGUgcHJvdG90eXBlIChwb3N0LWNyaXRpcXVlIHZlcnNpb24pOlxuLy8gc3Vic2VxdWVuY2UgZnV6enkgd2l0aCB3b3JkLWJvdW5kYXJ5IGJvbnVzLCBjYXBwZWQgbG9nMiBmcmVjZW5jeSwgcHJlZml4IGdob3N0LlxuXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcblxuZXhwb3J0IGludGVyZmFjZSBNYXRjaCB7XG4gICAgc2NvcmU6IG51bWJlclxuICAgIG1hcmtzOiBudW1iZXJbXVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZnV6enkocTogc3RyaW5nLCB0OiBzdHJpbmcpOiBNYXRjaCB8IG51bGwge1xuICAgIGNvbnN0IHFsID0gcS50b0xvd2VyQ2FzZSgpLFxuICAgICAgICB0bCA9IHQudG9Mb3dlckNhc2UoKVxuICAgIGxldCBxaSA9IDAsXG4gICAgICAgIHNjb3JlID0gMCxcbiAgICAgICAgbGFzdCA9IC0yXG4gICAgY29uc3QgbWFya3M6IG51bWJlcltdID0gW11cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRsLmxlbmd0aCAmJiBxaSA8IHFsLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmICh0bFtpXSA9PT0gcWxbcWldKSB7XG4gICAgICAgICAgICBtYXJrcy5wdXNoKGkpXG4gICAgICAgICAgICBzY29yZSArPSBpID09PSAwIHx8IFwiIC1fLi9cIi5pbmNsdWRlcyh0W2kgLSAxXSkgPyA0IDogbGFzdCA9PT0gaSAtIDEgPyAyIDogMVxuICAgICAgICAgICAgbGFzdCA9IGlcbiAgICAgICAgICAgIHFpKytcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcWkgPT09IHFsLmxlbmd0aCA/IHsgc2NvcmU6IHNjb3JlIC0gdC5sZW5ndGggKiAwLjAyLCBtYXJrcyB9IDogbnVsbFxufVxuXG4vLyBQYW5nbyBtYXJrdXAgaGlnaGxpZ2h0IChlc2NhcGVzOyBsZWFmIGFjY2VudCBvbiBtYXRjaGVkIGNoYXJzKVxuZXhwb3J0IGZ1bmN0aW9uIGhsKHQ6IHN0cmluZywgbWFya3M6IG51bWJlcltdIHwgbnVsbCk6IHN0cmluZyB7XG4gICAgY29uc3QgZXNjID0gKGM6IHN0cmluZykgPT4gR0xpYi5tYXJrdXBfZXNjYXBlX3RleHQoYywgLTEpXG4gICAgaWYgKCFtYXJrcykgcmV0dXJuIGVzYyh0KVxuICAgIGNvbnN0IG0gPSBuZXcgU2V0KG1hcmtzKVxuICAgIGxldCBvdXQgPSBcIlwiXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0Lmxlbmd0aDsgaSsrKVxuICAgICAgICBvdXQgKz0gbS5oYXMoaSkgPyBgPHNwYW4gZm9yZWdyb3VuZD1cIiNiNWNiNDhcIj4ke2VzYyh0W2ldKX08L3NwYW4+YCA6IGVzYyh0W2ldKVxuICAgIHJldHVybiBvdXRcbn1cblxuLy8gRnJlY2VuY3k6IGNhcHBlZCBzbyBhbiBleGFjdCBwcmVmaXggbWF0Y2ggQUxXQVlTIGJlYXRzIGhhYml0IChjcml0aXF1ZSBBMikuXG5jb25zdCBTVE9SRSA9IGAke0dMaWIuZ2V0X3VzZXJfc3RhdGVfZGlyKCl9L2tvYmVsL2ZyZXEuanNvbmBcbmxldCBmcmVxOiBSZWNvcmQ8c3RyaW5nLCBudW1iZXI+ID0ge31cbnRyeSB7XG4gICAgZnJlcSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKEdMaWIuZmlsZV9nZXRfY29udGVudHMoU1RPUkUpWzFdKSlcbn0gY2F0Y2gge31cblxuZXhwb3J0IGNvbnN0IGJvb3N0ID0gKGlkOiBzdHJpbmcpID0+IE1hdGgubWluKE1hdGgubG9nMigxICsgKGZyZXFbaWRdID8/IDApKSwgMylcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1bXAoaWQ6IHN0cmluZykge1xuICAgIGZyZXFbaWRdID0gKGZyZXFbaWRdID8/IDApICsgMVxuICAgIEdMaWIubWtkaXJfd2l0aF9wYXJlbnRzKEdMaWIucGF0aF9nZXRfZGlybmFtZShTVE9SRSksIDBvNzU1KVxuICAgIEdMaWIuZmlsZV9zZXRfY29udGVudHMoU1RPUkUsIEpTT04uc3RyaW5naWZ5KGZyZXEpKVxufVxuXG5leHBvcnQgY29uc3QgZnJlcXVlbmN5ID0gKGlkOiBzdHJpbmcpID0+IGZyZXFbaWRdID8/IDBcbiIsICIvLyBDYWxlbmRhciBwb3BvdmVyIFx1MjAxNCBHTk9NRSByZXBsaWNhIHBlciB0aGUgcHJvdG90eXBlOiBoZXJvIGRhdGUsIFx1MjAzOSBtb250aCBcdTIwM0EgbmF2XG4vLyAodGl0bGUgY2xpY2sgPSB0b2RheSksIElTTyB3ZWVrIG51bWJlcnMgYXMgcXVpZXQgZGltIHRleHQsIERJTU1FRCBXRUVLRU5EUyxcbi8vIGNsaWNrYWJsZSBkYXlzIHcvIHNlbGVjdGlvbiByaW5nIChpbmsgcmluZyBvbiB0b2RheSksIGV2ZW50LWRvdCBtYXJrZXJzLFxuLy8gZXZlbnRzIGNhcmQgaW4gdGhlIG5vdGlmaWNhdGlvbi1jYXJkIGxhbmd1YWdlLiBNb250aHMgc2xpZGUgKG11bHRpdmlldyBtb3Rpb24pLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciB9IGZyb20gXCIuLi9saWIvc3VyZmFjZVwiXG5cbmludGVyZmFjZSBFdiB7XG4gICAgdDogc3RyaW5nXG4gICAgbjogc3RyaW5nXG4gICAgaWNvbjogc3RyaW5nXG59XG4vLyBcInRvZGF5XCIgXHUyMDE0IHVuZGVyIEtPQkVMX0RFTU8sIHBpbm5lZCB0byBELnRvZGF5OyByZWFsIGNsb2NrIG90aGVyd2lzZS5cbi8vIHRvZGF5VmFyIHBvbGxzIGV2ZXJ5IDYwcyBzbyB0aGUgaGVybyBkYXRlIHVwZGF0ZXMgd2l0aG91dCBhIHJlbG9hZC5cbmNvbnN0IHRvZGF5VmFyID0gREVNT1xuICAgID8gVmFyaWFibGUobmV3IERhdGUoRC50b2RheS55LCBELnRvZGF5Lm0sIEQudG9kYXkuZCkpXG4gICAgOiBWYXJpYWJsZShuZXcgRGF0ZSgpKS5wb2xsKDYwXzAwMCwgKCkgPT4gbmV3IERhdGUoKSlcbmNvbnN0IG5vdyA9IHRvZGF5VmFyLmdldCgpXG5jb25zdCBrZXkgPSAoeTogbnVtYmVyLCBtOiBudW1iZXIsIGQ6IG51bWJlcikgPT4gYCR7eX0tJHttICsgMX0tJHtkfWBcbmV4cG9ydCBjb25zdCBFVkVOVFM6IFJlY29yZDxzdHJpbmcsIEV2W10+ID0ge1xuICAgIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpKV06IFtcbiAgICAgICAgeyB0OiBcIjA5OjQ1XCIsIG46IFwiRGFpbHkgU3RhbmR1cFwiLCBpY29uOiBcImtvYmVsLXZpZGVvLXN5bWJvbGljXCIgfSxcbiAgICBdLFxuICAgIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxMSldOiBbXG4gICAgICAgIHsgdDogXCIxMDozMFwiLCBuOiBcIktpZXJhbiBCaXJ0aGRheVwiLCBpY29uOiBcImtvYmVsLWNha2Utc3ltYm9saWNcIiB9LFxuICAgICAgICB7IHQ6IFwiMTM6MDBcIiwgbjogXCJMb25kb24gVGhpbmdcIiwgaWNvbjogXCJrb2JlbC1waW4tc3ltYm9saWNcIiB9LFxuICAgIF0sXG4gICAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIDEzKV06IFtcbiAgICAgICAgeyB0OiBcIkFsbCBkYXlcIiwgbjogXCJNeSBCaXJ0aGRheVwiLCBpY29uOiBcImtvYmVsLWNha2Utc3ltYm9saWNcIiB9LFxuICAgIF0sXG59XG5cbmNvbnN0IHZpZXcgPSBWYXJpYWJsZSh7IHk6IG5vdy5nZXRGdWxsWWVhcigpLCBtOiBub3cuZ2V0TW9udGgoKSB9KVxuY29uc3Qgc2VsID0gVmFyaWFibGUobmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpKSlcblxuZnVuY3Rpb24gaXNvV2VlayhkOiBEYXRlKTogbnVtYmVyIHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoRGF0ZS5VVEMoZC5nZXRGdWxsWWVhcigpLCBkLmdldE1vbnRoKCksIGQuZ2V0RGF0ZSgpKSlcbiAgICBjb25zdCBkbiA9ICh0LmdldFVUQ0RheSgpICsgNikgJSA3XG4gICAgdC5zZXRVVENEYXRlKHQuZ2V0VVRDRGF0ZSgpIC0gZG4gKyAzKVxuICAgIGNvbnN0IGYgPSBuZXcgRGF0ZShEYXRlLlVUQyh0LmdldFVUQ0Z1bGxZZWFyKCksIDAsIDQpKVxuICAgIHJldHVybiAxICsgTWF0aC5yb3VuZCgoKCt0IC0gK2YpIC8gODY0ZTUgLSAzICsgKChmLmdldFVUQ0RheSgpICsgNikgJSA3KSkgLyA3KVxufVxuXG5mdW5jdGlvbiBHcmlkKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJjYWwtZ3JpZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9PlxuICAgICAgICAgICAge2JpbmQoVmFyaWFibGUuZGVyaXZlKFt2aWV3LCBzZWxdLCAodiwgcykgPT4gKHsgdiwgcyB9KSkpLmFzKCh7IHYsIHMgfSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGZpcnN0ID0gbmV3IERhdGUodi55LCB2Lm0sIDEpXG4gICAgICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSAoZmlyc3QuZ2V0RGF5KCkgKyA2KSAlIDdcbiAgICAgICAgICAgICAgICBjb25zdCBkYXlzID0gbmV3IERhdGUodi55LCB2Lm0gKyAxLCAwKS5nZXREYXRlKClcbiAgICAgICAgICAgICAgICBjb25zdCBwcmV2RGF5cyA9IG5ldyBEYXRlKHYueSwgdi5tLCAwKS5nZXREYXRlKClcbiAgICAgICAgICAgICAgICBjb25zdCByb3dzID0gW11cbiAgICAgICAgICAgICAgICByb3dzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgIDxib3ggaG9tb2dlbmVvdXM+XG4gICAgICAgICAgICAgICAgICAgICAgICB7W1wiXCIsIFwiTVwiLCBcIlRcIiwgXCJXXCIsIFwiVFwiLCBcIkZcIiwgXCJTXCIsIFwiU1wiXS5tYXAoKGQpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJkb3dcIiBsYWJlbD17ZH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCA2OyByKyspIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2VsbHMgPSBbXG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIndrIHRuXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17YCR7aXNvV2VlayhuZXcgRGF0ZSh2LnksIHYubSwgciAqIDcgLSBzdGFydCArIDEpKX1gfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz4sXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA3OyBjKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGkgPSByICogNyArIGMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZCA9IGkgLSBzdGFydCArIDFcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG91dCA9IGQgPCAxIHx8IGQgPiBkYXlzXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsYWJlbCA9IG91dCA/IChkIDwgMSA/IHByZXZEYXlzICsgZCA6IGQgLSBkYXlzKSA6IGRcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNscyA9IFtcImRheVwiXVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGMgPj0gNSkgY2xzLnB1c2goXCJ3ZVwiKSAvLyBXRUVLRU5EUyBESU1NRURcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvdXQpIGNscy5wdXNoKFwib3V0XCIpXG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB0b2RheSA9IG5vd1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZCA9PT0gdG9kYXkuZ2V0RGF0ZSgpICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHYubSA9PT0gdG9kYXkuZ2V0TW9udGgoKSAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2LnkgPT09IHRvZGF5LmdldEZ1bGxZZWFyKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNscy5wdXNoKFwidG9kYXlcIilcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoRVZFTlRTW2tleSh2LnksIHYubSwgZCldKSBjbHMucHVzaChcImV2XCIpIC8vIGV2ZW50LWRvdCAoQ1NTIDo6YWZ0ZXIgXHUyMTkyIHVuZGVybGluZSBkb3QpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzLmdldERhdGUoKSA9PT0gZCAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzLmdldE1vbnRoKCkgPT09IHYubSAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzLmdldEZ1bGxZZWFyKCkgPT09IHYueVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xzLnB1c2goXCJzZWxcIilcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGhhc0V2ID0gIW91dCAmJiAhIUVWRU5UU1trZXkodi55LCB2Lm0sIGQpXVxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZGF5IHNpdHMgYXQgaXRzIG5hdHVyYWwgMjRcdTAwRDcyNCBjZW50cmVkIGluIHRoZSBncmlkIGNvbHVtbiAobm90IGZpbGxpbmcgaXQpLFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gc28gdG9kYXkncyBsZWFmIGZpbGwgaXMgYSB0aWdodCBjaXJjbGUgcmF0aGVyIHRoYW4gYSBjb2x1bW4td2lkZSBvdmFsXG4gICAgICAgICAgICAgICAgICAgICAgICBjZWxscy5wdXNoKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG91dCA/IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2Ake2xhYmVsfWB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKSA6IChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e2Nscy5qb2luKFwiIFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc2VsLnNldChuZXcgRGF0ZSh2LnksIHYubSwgZCkpfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7aGFzRXYgPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD17YCR7bGFiZWx9YH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgey8qIDNweCBldmVudCBkb3QsIGFic29sdXRlIGJvdHRvbS1jZW50ZXIgKEdUSyBoYXMgbm8gOjphZnRlcikgKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU9XCJvdmVybGF5XCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiZXZkb3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXtgJHtsYWJlbH1gfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIHJvd3MucHVzaCg8Ym94IGhvbW9nZW5lb3VzPntjZWxsc308L2JveD4pXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiByb3dzXG4gICAgICAgICAgICB9KX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBFdmVudHNDYXJkKCkge1xuICAgIC8vIFByb3RvdHlwZSAuY2FsZXY6IGEgcGFuZWwyIGNhcmQgKHBhZDEwL3IxMikgd3JhcHBpbmcgdGhlIGRhdGUgaGVhZGVyICsgZGFya2VyXG4gICAgLy8gKC0tcGFuZWwpIGV2ZW50IHJvd3M7IGhlYWRlcidzIG93biBib3R0b20gcGFkZGluZyBpcyB0aGUgaGVhZGVyXHUyMTkycm93IGdhcCAoc3BhY2luZyAwKS5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZXZjYXJkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICB7YmluZChzZWwpLmFzKChkKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZXZzID0gRVZFTlRTW2tleShkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpXSA/PyBbXVxuICAgICAgICAgICAgICAgIGNvbnN0IGhlYWQgPSAoXG4gICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJldmhlYWRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17ZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd2Vla2RheTogXCJsb25nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF5OiBcIm51bWVyaWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb250aDogXCJsb25nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICB9KX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgaWYgKCFldnMubGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2FsZW5kYXItc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YlwiIGxhYmVsPVwiTm8gZXZlbnRzXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PixcbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgICAgICAgIGhlYWQsXG4gICAgICAgICAgICAgICAgICAgIC4uLmV2cy5tYXAoKGUpID0+IChcbiAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJldnJvd1wiIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7LyogMjZcdTAwRDcyNiByOCBjb2xvcmVkIGljb24gdGlsZSAocHJvdG90eXBlIC5ldmljKSwgd2hpdGUgZ2x5cGggKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImV2aWNcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e2UuaWNvbn0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2Uubn0gLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViIHRuXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtlLnR9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgKSksXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgfSl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQ2FsZW5kYXIoKSB7XG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwiY2FsZW5kYXJcIiwgdG9nZ2xlRm4pXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImNhbGVuZGFyXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLWNhbGVuZGFyXCJcbiAgICAgICAgICAgIGNsYXNzPVwiY2FsZW5kYXItd2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1B9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChjbG9zZSgpLCB0cnVlKSA6IGZhbHNlKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0RPV059XG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMjB9XG4gICAgICAgICAgICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2hlZXQgY2FsXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjYWxoZXJvXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInN1YlwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiaGVyb1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKChkKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRheTogXCJudW1lcmljXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtb250aDogXCJsb25nXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB5ZWFyOiBcIm51bWVyaWNcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgIDxjZW50ZXJib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0KHYubSA/IHsgeTogdi55LCBtOiB2Lm0gLSAxIH0gOiB7IHk6IHYueSAtIDEsIG06IDExIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLWxlZnQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJtb250aFwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB2aWV3LnNldCh7IHk6IG5vdy5nZXRGdWxsWWVhcigpLCBtOiBub3cuZ2V0TW9udGgoKSB9KX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQodmlldykuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAodikgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgRGF0ZSh2LnksIHYubSkudG9Mb2NhbGVTdHJpbmcoXCJlblwiLCB7IG1vbnRoOiBcImxvbmdcIiB9KSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKHYueSAhPT0gbm93LmdldEZ1bGxZZWFyKCkgPyBgICR7di55fWAgOiBcIlwiKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgdiA9IHZpZXcuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlldy5zZXQodi5tID09PSAxMSA/IHsgeTogdi55ICsgMSwgbTogMCB9IDogeyB5OiB2LnksIG06IHYubSArIDEgfSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgIDwvY2VudGVyYm94PlxuICAgICAgICAgICAgICAgICAgICA8R3JpZCAvPlxuICAgICAgICAgICAgICAgICAgICA8RXZlbnRzQ2FyZCAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9yZXZlYWxlcj5cbiAgICAgICAgPC93aW5kb3c+XG4gICAgKVxufVxuIiwgIi8vIFF1aWNrIHNldHRpbmdzLiBQcm90b3R5cGUtZmluYWw6IHVuaWZvcm0gcGlsbCB0aWxlcyBmcm9tIGEgQ0FUQUxPRyAoY3VzdG9taXNhYmxlLFxuLy8gcGVyc2lzdGVkKSwgR05PTUUgdGhpbiBzbGlkZXJzLCBkcmlsbGRvd25zIGFzIGEgc3ByaW5nLXNsaWQgdHdvLXZpZXcgc3RhY2tcbi8vIChXaS1GaSBuZXR3b3JrcyAvIEJUIGRldmljZXMgLyBwZXItYXBwIG1peGVyIHdpdGggYSBNYXN0ZXIgcm93KSwgY29tcGFjdCB0b3Agcm93XG4vLyAoYmF0dGVyeSBcdTAwQjcgcGVuY2lsL2xlYWYvbG9jay9wb3dlciksIGdub2JsaW4gYmFubmVyICsgcmVjb25uZWN0IHdoaWxlIGRlZ3JhZGVkLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IEJsdWV0b290aCBmcm9tIFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IHsgY29ubmVjdGVkLCByZWxvYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBNT1RJT04gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciwgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5pbXBvcnQgeyBUaW55U2xpZGVyIH0gZnJvbSBcIi4uL2xpYi90aW55c2xpZGVyXCJcbmltcG9ydCB7IEZpeGVkQ2hldiB9IGZyb20gXCIuLi9saWIvZml4ZWRjaGV2XCJcblxudHlwZSBEcmlsbCA9IG51bGwgfCBcIndpZmlcIiB8IFwiYnRcIiB8IFwibWl4XCJcbi8vIEtPQkVMX0RSSUxMIGxldHMgdGhlIGRldmtpdCByZW5kZXIgYSBkcmlsbGRvd24gZGlyZWN0bHkgKG5vIHBvaW50ZXIgdG8gY2xpY2sgdGhlXG4vLyBjaGV2cm9uIGluIGhlYWRsZXNzKTsgcHJvZHVjdGlvbiBkZWZhdWx0IGlzIG51bGwuXG5jb25zdCBkcmlsbCA9IFZhcmlhYmxlPERyaWxsPigoR0xpYi5nZXRlbnYoXCJLT0JFTF9EUklMTFwiKSBhcyBEcmlsbCkgfHwgbnVsbClcblxuLy8gVGlsZSBjYXRhbG9nIFx1MjAxNCBtaXJyb3JzIHByb3RvdHlwZSBDQVRBTE9HOyBwZXJzaXN0ZWQgbGF5b3V0IGluIHN0YXRlIGRpci5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvcXMtdGlsZXMuanNvbmBcbmxldCB0aWxlczogc3RyaW5nW10gPSBbXCJ3aWZpXCIsIFwiYnRcIiwgXCJzYXZlXCIsIFwiZGFya1wiLCBcInNpbGVudFwiLCBcIm5pZ2h0XCIsIFwidm9sdW1lXCIsIFwiYnJpZ2h0bmVzc1wiXVxudHJ5IHtcbiAgICB0aWxlcyA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKEdMaWIuZmlsZV9nZXRfY29udGVudHMoU1RPUkUpWzFdKSlcbn0gY2F0Y2gge31cblxuZnVuY3Rpb24gQ2hpcChwcm9wczoge1xuICAgIGlkOiBzdHJpbmdcbiAgICBsYWJlbDogc3RyaW5nXG4gICAgaWNvbjogc3RyaW5nXG4gICAgYWN0aXZlOiBhbnlcbiAgICBzdWI/OiBhbnlcbiAgICBvblRvZ2dsZWQ6ICgpID0+IHZvaWRcbiAgICBvbkRyaWxsPzogKCkgPT4gdm9pZFxufSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9e2JpbmQocHJvcHMuYWN0aXZlKS5hcygoYTogYm9vbGVhbikgPT4gKGEgPyBcImNoaXAgcGlsbCBvblwiIDogXCJjaGlwIHBpbGxcIikpfT5cbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjaGlwYlwiIGhleHBhbmQ9e3RydWV9IG9uQ2xpY2tlZD17cHJvcHMub25Ub2dnbGVkfT5cbiAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3Byb3BzLmljb259IC8+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3Byb3BzLmxhYmVsfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAge3Byb3BzLnN1YiAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic3ViXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M31cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e3Byb3BzLnN1Yn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIHsvKiBmaXhlZCAzMnB4IHNlYW0rY2hldnJvbiAocHJvdG8gLmNoZXZiKSBcdTIwMTQgaGV4cGFuZD1mYWxzZSBzbyB0aGUgbWFpbiBidXR0b24gb3ducyBzbGFjayAqL31cbiAgICAgICAgICAgIHtwcm9wcy5vbkRyaWxsICYmIChcbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY2hldlwiIGhleHBhbmQ9e2ZhbHNlfSB3aWR0aFJlcXVlc3Q9ezMyfSBvbkNsaWNrZWQ9e3Byb3BzLm9uRHJpbGx9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gU2xpZGVycygpIHtcbiAgICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgICAvLyBJbiBERU1PIG1vZGUgcmVuZGVyIHRoZSB0d28gc2xpZGVycyByZWdhcmRsZXNzIG9mIGEgcmVhbCBzcGVha2VyLCBwaW5uZWQgdG8gdGhlXG4gICAgLy8gcHJvdG90eXBlJ3MgbW9jayB2YWx1ZXMgKHZvbHVtZSAwLjY0LCBicmlnaHRuZXNzIDAuODApIGZvciBhIGZhaXIgb3ZlcmxheS5cbiAgICBpZiAoIXNwZWFrZXIgJiYgIURFTU8pIHJldHVybiA8Ym94IC8+XG4gICAgY29uc3Qgdm9sSWNvbiA9IHNwZWFrZXJcbiAgICAgICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoKGkpID0+IGkgPz8gXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIilcbiAgICAgICAgOiBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiXG4gICAgY29uc3Qgdm9sVmFsdWU6IGFueSA9IERFTU8gPyBELnZvbHVtZSA6IGJpbmQoc3BlYWtlciEsIFwidm9sdW1lXCIpXG4gICAgLy8gcHJvdG8gLnNsaWRlcnMgaXMgYSBmbGV4IGNvbHVtbiB3aXRoIE5PIGdhcCBiZXR3ZWVuIHRoZSB0d28gc3Jvd3MgKGVhY2ggbWluLWggNDIpLlxuICAgIC8vIFRpbnlTbGlkZXIgb3ZlcnJpZGVzIHZmdW5jX21lYXN1cmUgdG8gcmVwb3J0IG5hdHVyYWw9MXB4IHNvIHRoZSBzcm93IGRvZXNuJ3RcbiAgICAvLyBpbmZsYXRlIHRoZSBwYW5lbCBiZXlvbmQgdGhlIGNoaXAtZ3JpZCB3aWR0aCAoR1RLIENTUyBtYXgtd2lkdGggaXMgbm90IHJlc3BlY3RlZCkuXG4gICAgY29uc3QgaW5pdFZvbCA9IERFTU8gPyBELnZvbHVtZSA6IChzcGVha2VyPy52b2x1bWUgPz8gMC42NClcbiAgICBjb25zdCB2b2xTbGlkZXIgPSBuZXcgVGlueVNsaWRlcih7IGhleHBhbmQ6IHRydWUsIGNzc0NsYXNzZXM6IFtcInNsaWRlclwiXSwgdmFsdWU6IGluaXRWb2wgfSlcbiAgICBpZiAoIURFTU8gJiYgc3BlYWtlcilcbiAgICAgICAgYmluZChzcGVha2VyLCBcInZvbHVtZVwiKS5zdWJzY3JpYmUoKHY6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgdm9sU2xpZGVyLmdldF9hZGp1c3RtZW50KCkudmFsdWUgPSB2XG4gICAgICAgIH0pXG4gICAgLy8gR3RrUmFuZ2U6OmNoYW5nZS12YWx1ZSBhcmdzOiAocmFuZ2UsIHNjcm9sbFR5cGUsIHZhbHVlKVxuICAgIHZvbFNsaWRlci5jb25uZWN0KFwiY2hhbmdlLXZhbHVlXCIsIChfczogYW55LCBfdDogYW55LCB2OiBudW1iZXIpID0+IHtcbiAgICAgICAgaWYgKHNwZWFrZXIpIHNwZWFrZXIudm9sdW1lID0gdlxuICAgIH0pXG5cbiAgICBjb25zdCBicmlnaHRWYWx1ZSA9IFZhcmlhYmxlKERFTU8gPyBELmJyaWdodG5lc3MgOiAwLjgpXG4gICAgaWYgKCFERU1PKSB7XG4gICAgICAgIFByb21pc2UuYWxsKFtleGVjQXN5bmMoXCJicmlnaHRuZXNzY3RsIGdldFwiKSwgZXhlY0FzeW5jKFwiYnJpZ2h0bmVzc2N0bCBtYXhcIildKVxuICAgICAgICAgICAgLnRoZW4oKFtjdXIsIG1heF0pID0+IGJyaWdodFZhbHVlLnNldChwYXJzZUludChjdXIudHJpbSgpKSAvIHBhcnNlSW50KG1heC50cmltKCkpKSlcbiAgICAgICAgICAgIC5jYXRjaCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgLyogYnJpZ2h0bmVzc2N0bCBhYnNlbnQgb24gZGVza3RvcCAqL1xuICAgICAgICAgICAgfSlcbiAgICB9XG4gICAgY29uc3QgYnJpZ2h0U2xpZGVyID0gbmV3IFRpbnlTbGlkZXIoe1xuICAgICAgICBoZXhwYW5kOiB0cnVlLFxuICAgICAgICBjc3NDbGFzc2VzOiBbXCJzbGlkZXJcIl0sXG4gICAgICAgIHZhbHVlOiBicmlnaHRWYWx1ZS5nZXQoKSxcbiAgICB9KVxuICAgIGJyaWdodFZhbHVlLnN1YnNjcmliZSgodikgPT4ge1xuICAgICAgICBicmlnaHRTbGlkZXIuZ2V0X2FkanVzdG1lbnQoKS52YWx1ZSA9IHZcbiAgICB9KVxuICAgIGJyaWdodFNsaWRlci5jb25uZWN0KFwiY2hhbmdlLXZhbHVlXCIsIChfczogYW55LCBfdDogYW55LCB2OiBudW1iZXIpID0+XG4gICAgICAgIGV4ZWNBc3luYyhgYnJpZ2h0bmVzc2N0bCBzZXQgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gYnJpZ2h0VmFsdWUuc2V0KHYpKVxuICAgICAgICAgICAgLmNhdGNoKCgpID0+IHt9KVxuICAgIClcblxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJzbGlkZXJzXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwic3Jvd1wiIHNwYWNpbmc9ezl9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17dm9sSWNvbn0gLz5cbiAgICAgICAgICAgICAgICB7dm9sU2xpZGVyfVxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjaGV2XCIgd2lkdGhSZXF1ZXN0PXszMX0gb25DbGlja2VkPXsoKSA9PiBkcmlsbC5zZXQoXCJtaXhcIil9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1icmlnaHRuZXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICB7YnJpZ2h0U2xpZGVyfVxuICAgICAgICAgICAgICAgIHsvKiBndXR0ZXI6IHdpZHRoUmVxdWVzdD0xNyArIH4xM3B4IEFkd2FpdGEgb3ZlcmhlYWQgXHUyMjQ4IDMwcHgsIG1hdGNoaW5nIGNoZXYgd2lkdGggKi99XG4gICAgICAgICAgICAgICAgPGJveCB3aWR0aFJlcXVlc3Q9ezE3fSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZnVuY3Rpb24gR25vYmxpbkJhbm5lcigpIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwiZ2Jhbm5lclwiIHZpc2libGU9e0RFTU8gPyBmYWxzZSA6IGJpbmQoY29ubmVjdGVkKS5hcygoYykgPT4gIWMpfSBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC13YXJuaW5nLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gaGV4cGFuZD5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPVwib3JnLmdub2JsaW4uU2hlbGwgZGlzY29ubmVjdGVkXCIgLz5cbiAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJzXCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPVwib3NkICsgbm90aWZzIGhhbmRlZCBiYWNrIHRvIGdub21lXCJcbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZ2J0blwiIGxhYmVsPVwiUmVjb25uZWN0XCIgb25DbGlja2VkPXsoKSA9PiByZWxvYWQoKS5jYXRjaCgoKSA9PiB7fSl9IC8+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gXHUyNTAwXHUyNTAwIHJlYWwtYmFja2VuZCB0b2dnbGVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuLy8gRGFyayBTdHlsZTogb3JnLmdub21lLmRlc2t0b3AuaW50ZXJmYWNlIGNvbG9yLXNjaGVtZVxuY29uc3QgaWZhY2VTZXR0aW5ncyA9IG5ldyBHaW8uU2V0dGluZ3MoeyBzY2hlbWE6IFwib3JnLmdub21lLmRlc2t0b3AuaW50ZXJmYWNlXCIgfSlcbmNvbnN0IHREYXJrID0gVmFyaWFibGUoaWZhY2VTZXR0aW5ncy5nZXRfc3RyaW5nKFwiY29sb3Itc2NoZW1lXCIpID09PSBcInByZWZlci1kYXJrXCIpXG5pZmFjZVNldHRpbmdzLmNvbm5lY3QoXCJjaGFuZ2VkOjpjb2xvci1zY2hlbWVcIiwgKCkgPT5cbiAgICB0RGFyay5zZXQoaWZhY2VTZXR0aW5ncy5nZXRfc3RyaW5nKFwiY29sb3Itc2NoZW1lXCIpID09PSBcInByZWZlci1kYXJrXCIpXG4pXG5cbi8vIE5pZ2h0IExpZ2h0OiBvcmcuZ25vbWUuc2V0dGluZ3MtZGFlbW9uLnBsdWdpbnMuY29sb3JcbmxldCBjb2xvclNldHRpbmdzOiBHaW8uU2V0dGluZ3MgfCBudWxsID0gbnVsbFxuY29uc3QgdE5pZ2h0ID0gVmFyaWFibGUoZmFsc2UpXG50cnkge1xuICAgIGNvbG9yU2V0dGluZ3MgPSBuZXcgR2lvLlNldHRpbmdzKHsgc2NoZW1hOiBcIm9yZy5nbm9tZS5zZXR0aW5ncy1kYWVtb24ucGx1Z2lucy5jb2xvclwiIH0pXG4gICAgdE5pZ2h0LnNldChjb2xvclNldHRpbmdzLmdldF9ib29sZWFuKFwibmlnaHQtbGlnaHQtZW5hYmxlZFwiKSlcbiAgICBjb2xvclNldHRpbmdzLmNvbm5lY3QoXCJjaGFuZ2VkOjpuaWdodC1saWdodC1lbmFibGVkXCIsICgpID0+XG4gICAgICAgIHROaWdodC5zZXQoY29sb3JTZXR0aW5ncyEuZ2V0X2Jvb2xlYW4oXCJuaWdodC1saWdodC1lbmFibGVkXCIpKVxuICAgIClcbn0gY2F0Y2gge1xuICAgIC8qIHNjaGVtYSBhYnNlbnQgb24gc29tZSBzeXN0ZW1zICovXG59XG5cbi8vIFNpbGVudDogbXV0ZSBvbiB0aGUgZGVmYXVsdCBXaXJlUGx1bWJlciBzcGVha2VyXG5jb25zdCBfc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG5jb25zdCB0U2lsZW50ID0gX3NwZWFrZXJcbiAgICA/IChiaW5kKF9zcGVha2VyLCBcIm11dGVcIikgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxib29sZWFuPilcbiAgICA6IFZhcmlhYmxlKGZhbHNlKVxuXG4vLyBQb3dlciBTYXZlcjogcG93ZXJwcm9maWxlc2N0bCAoZmFsbHMgYmFjayB0byBmYWxzZSBpZiB1bmF2YWlsYWJsZSlcbmNvbnN0IHRTYXZlID0gVmFyaWFibGUoZmFsc2UpXG5leGVjQXN5bmMoXCJwb3dlcnByb2ZpbGVzY3RsIGdldFwiKVxuICAgIC50aGVuKCh2KSA9PiB0U2F2ZS5zZXQodi50cmltKCkgPT09IFwicG93ZXItc2F2ZXJcIikpXG4gICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgLyogcG93ZXJwcm9maWxlc2N0bCBhYnNlbnQgKi9cbiAgICB9KVxuXG4vLyBlZGl0LW1vZGUgZm9yIHRoZSB0aWxlIGNhdGFsb2cgKHBlbmNpbCBidXR0b24pIFx1MjAxNCBob29rIGZvciB0aWxlIHJlYXJyYW5nZS9jdXN0b21pc2UuXG5jb25zdCBlZGl0TW9kZSA9IFZhcmlhYmxlKGZhbHNlKVxuXG4vLyBQcm90b3R5cGUgdG9nZ2xlIGNoaXBzIGFyZSBsYWJlbC1vbmx5LCB2ZXJ0aWNhbGx5IGNlbnRlcmVkIFx1MjAxNCBzdGF0ZSBpcyBzaG93biBieSB0aGVcbi8vIGxlYWYgZmlsbCwgbm90IGEgc3ViLWxpbmUgKG9ubHkgV2ktRmkvQmx1ZXRvb3RoIGNhcnJ5IGEgc3ViKS5cbmZ1bmN0aW9uIFRvZ2dsZUNoaXAocHJvcHM6IHtcbiAgICBsYWJlbDogc3RyaW5nXG4gICAgaWNvbjogc3RyaW5nXG4gICAgdjogVmFyaWFibGU8Ym9vbGVhbj5cbiAgICBvblRvZ2dsZWQ/OiAoKSA9PiB2b2lkXG59KSB7XG4gICAgcmV0dXJuIChcbiAgICAgICAgPENoaXBcbiAgICAgICAgICAgIGlkPXtwcm9wcy5sYWJlbH1cbiAgICAgICAgICAgIGxhYmVsPXtwcm9wcy5sYWJlbH1cbiAgICAgICAgICAgIGljb249e3Byb3BzLmljb259XG4gICAgICAgICAgICBhY3RpdmU9e2JpbmQocHJvcHMudil9XG4gICAgICAgICAgICBvblRvZ2dsZWQ9e3Byb3BzLm9uVG9nZ2xlZCA/PyAoKCkgPT4gcHJvcHMudi5zZXQoIXByb3BzLnYuZ2V0KCkpKX1cbiAgICAgICAgLz5cbiAgICApXG59XG5cbmZ1bmN0aW9uIGJhdHRlcnlNZXRhKCk6IGFueSB7XG4gICAgY29uc3QgYmF0ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpXG4gICAgaWYgKCFiYXQpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGJpbmQoYmF0LCBcInBlcmNlbnRhZ2VcIikuYXMoKHApID0+IHtcbiAgICAgICAgY29uc3QgcGN0ID0gTWF0aC5yb3VuZChwICogMTAwKVxuICAgICAgICBjb25zdCBzdGF0ZSA9IGJhdC5mdWxsID8gXCJGdWxseSBjaGFyZ2VkXCIgOiBiYXQuY2hhcmdpbmcgPyBcIkNoYXJnaW5nXCIgOiBcIkRpc2NoYXJnaW5nXCJcbiAgICAgICAgcmV0dXJuIGAke3BjdH0lIFx1MDBCNyAke3N0YXRlfWBcbiAgICB9KVxufVxuY29uc3QgaGFzQmF0dGVyeSA9IEJhdHRlcnkuZ2V0X2RlZmF1bHQoKSAhPSBudWxsXG5cbmZ1bmN0aW9uIFJvb3QoeyBuYW1lIH06IHsgbmFtZT86IHN0cmluZyB9KSB7XG4gICAgY29uc3QgbmV0ID0gTmV0d29yay5nZXRfZGVmYXVsdCgpXG4gICAgY29uc3QgYnQgPSBCbHVldG9vdGguZ2V0X2RlZmF1bHQoKVxuICAgIC8vIHNwYWNpbmcgMDogZXhhY3Qgc2VjdGlvbiBnYXBzIGNvbWUgZnJvbSBtYXJnaW5zIChxdG9wXHUyMTkyY2hpcHMgMSwgY2hpcCByb3dzIDgsXG4gICAgLy8gY2hpcHNcdTIxOTJzbGlkZXJzIDEwKSBcdTIwMTQgYSB1bmlmb3JtIGJveCBzcGFjaW5nIGNhbid0IGV4cHJlc3MgYWxsIHRocmVlLlxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggbmFtZT17bmFtZX0gb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgICB7LyogdG9wIHJvdzogYmF0dGVyeSBcdTAwQjcgcmVsb2FkIFx1MDBCNyBsb2NrIFx1MDBCNyBwb3dlciAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJxcy10b3BcIiBzcGFjaW5nPXswfT5cbiAgICAgICAgICAgICAgICB7LyogYmF0dGVyeSBwaWxsOiBnbHlwaCArIHRhYnVsYXIgbWV0YSBcdTIwMTQgaGlkZGVuIHdoZW4gbm8gYmF0dGVyeSBwcmVzZW50ICovfVxuICAgICAgICAgICAgICAgIHsoREVNTyB8fCBoYXNCYXR0ZXJ5KSAmJiAoXG4gICAgICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJtZXRhXCIgc3BhY2luZz17Nn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJhdHRlcnktc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG5cIiBsYWJlbD17REVNTyA/IEQubWV0YSA6IGJhdHRlcnlNZXRhKCl9IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgPGJveCBoZXhwYW5kIC8+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG4gbGVhZlwiIG9uQ2xpY2tlZD17KCkgPT4gcmVsb2FkKCl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1sZWFmLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbG9jay1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG5cIiBvbkNsaWNrZWQ9eygpID0+IGVkaXRNb2RlLnNldCghZWRpdE1vZGUuZ2V0KCkpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcGVuY2lsLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0biBkYW5nZXJcIiBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpfT5cbiAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8R25vYmxpbkJhbm5lciAvPlxuICAgICAgICAgICAgey8qIG9uZSBjaGlwcyBncmlkOiAzIHJvd3MgYXQgOHB4LCBtYXJnaW4tYm90dG9tIDEwIGJlZm9yZSB0aGUgc2xpZGVycyAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJjaGlwLWdyaWRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgeyhERU1PIHx8IG5ldC53aWZpKSAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8Q2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlkPVwid2lmaVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9XCJXaS1GaVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLXdpZmktc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZT17REVNTyA/IFZhcmlhYmxlKHRydWUpIDogYmluZChuZXQud2lmaSEsIFwiZW5hYmxlZFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdWI9e0RFTU8gPyBELndpZmlTc2lkIDogYmluZChuZXQud2lmaSEsIFwic3NpZFwiKS5hcygocykgPT4gcyA/PyBcIk9mZlwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFERU1PICYmIG5ldC53aWZpKSBuZXQud2lmaS5lbmFibGVkID0gIW5ldC53aWZpLmVuYWJsZWRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uRHJpbGw9eygpID0+IGRyaWxsLnNldChcIndpZmlcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8Q2hpcFxuICAgICAgICAgICAgICAgICAgICAgICAgaWQ9XCJidFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIkJsdWV0b290aFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtYmx1ZXRvb3RoLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFjdGl2ZT17XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFZhcmlhYmxlKHRydWUpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogYmluZChidCwgXCJkZXZpY2VzXCIpLmFzKChkKSA9PiBkLnNvbWUoKHgpID0+IHguY29ubmVjdGVkKSlcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHN1Yj17XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgREVNT1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IEQuYnREZXZpY2VcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChkKSA9PiBkLmZpbmQoKHgpID0+IHguY29ubmVjdGVkKT8uYWxpYXMgPz8gXCJPZmZcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghREVNTykgYnQudG9nZ2xlKClcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICBvbkRyaWxsPXsoKSA9PiBkcmlsbC5zZXQoXCJidFwiKX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgICAgICAgICAgPFRvZ2dsZUNoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiUG93ZXIgU2F2ZXJcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaWNvbj1cImtvYmVsLWJvbHQtc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgdj17dFNhdmV9XG4gICAgICAgICAgICAgICAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuZXh0ID0gIXRTYXZlLmdldCgpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXhlY0FzeW5jKGBwb3dlcnByb2ZpbGVzY3RsIHNldCAke25leHQgPyBcInBvd2VyLXNhdmVyXCIgOiBcImJhbGFuY2VkXCJ9YClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnRoZW4oKCkgPT4gdFNhdmUuc2V0KG5leHQpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKCkgPT4gdFNhdmUuc2V0KG5leHQpKVxuICAgICAgICAgICAgICAgICAgICAgICAgfX1cbiAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgPFRvZ2dsZUNoaXBcbiAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPVwiRGFyayBTdHlsZVwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtbW9vbi1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICB2PXt0RGFya31cbiAgICAgICAgICAgICAgICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG5leHQgPSAhdERhcmsuZ2V0KClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZmFjZVNldHRpbmdzLnNldF9zdHJpbmcoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFwiY29sb3Itc2NoZW1lXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5leHQgPyBcInByZWZlci1kYXJrXCIgOiBcImRlZmF1bHRcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgIDxUb2dnbGVDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIlNpbGVudFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBpY29uPVwia29iZWwtYmVsbC1zbGFzaC1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICB2PXt0U2lsZW50fVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKF9zcGVha2VyKSBfc3BlYWtlci5tdXRlID0gIV9zcGVha2VyLm11dGVcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgICAgIDxUb2dnbGVDaGlwXG4gICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD1cIk5pZ2h0IExpZ2h0XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1zdW4tc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgdj17dE5pZ2h0fVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGNvbG9yU2V0dGluZ3MpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbG9yU2V0dGluZ3Muc2V0X2Jvb2xlYW4oXCJuaWdodC1saWdodC1lbmFibGVkXCIsICF0TmlnaHQuZ2V0KCkpXG4gICAgICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8U2xpZGVycyAvPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIFNpZ25hbC1zdHJlbmd0aCBnbHlwaCBmb3IgYW4gYWNjZXNzIHBvaW50ICgwXHUyMDEzMTAwIFx1MjE5MiB3aWZpIHRpZXJzKS5cbmZ1bmN0aW9uIHdpZmlJY29uKHN0cmVuZ3RoOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIHJldHVybiBcImtvYmVsLXdpZmktc3ltYm9saWNcIiAvLyBzaW5nbGUgZ2x5cGg7IHN0cmVuZ3RoIHNob3duIGFzIHRleHQgbWV0YVxufVxuXG4vLyBXaS1GaSBBUCBsaXN0IFx1MjAxNCByZWFsIEFzdGFsTmV0d29yayBhY2Nlc3MgcG9pbnRzLCBjb25uZWN0ZWQgb25lIG1hcmtlZCAuYWN0aXZlLlxuZnVuY3Rpb24gV2lmaUxpc3QoKSB7XG4gICAgY29uc3Qgd2lmaSA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKS53aWZpXG4gICAgaWYgKCF3aWZpKSByZXR1cm4gPGJveCAvPlxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgICAgICAgICAge2JpbmQod2lmaSwgXCJhY2Nlc3NQb2ludHNcIikuYXMoKGFwcykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGFjdGl2ZSA9IHdpZmkuYWN0aXZlQWNjZXNzUG9pbnRcbiAgICAgICAgICAgICAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICAgICAgICAgICAgICByZXR1cm4gYXBzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKGFwKSA9PiBhcC5zc2lkICYmICFzZWVuLmhhcyhhcC5zc2lkKSAmJiBzZWVuLmFkZChhcC5zc2lkKSlcbiAgICAgICAgICAgICAgICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc3RyZW5ndGggLSBhLnN0cmVuZ3RoKVxuICAgICAgICAgICAgICAgICAgICAuc2xpY2UoMCwgNilcbiAgICAgICAgICAgICAgICAgICAgLm1hcCgoYXApID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9uID0gYWN0aXZlICYmIGFwLnNzaWQgPT09IGFjdGl2ZS5zc2lkXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9e29uID8gXCJ4cm93IGFjdGl2ZVwiIDogXCJ4cm93XCJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gd2lmaS5hY3RpdmF0ZV9jb25uZWN0aW9uKGFwLCBudWxsKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXt3aWZpSWNvbihhcC5zdHJlbmd0aCl9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2FwLnNzaWR9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInhzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYWJlbD17b24gPyBcIkNvbm5lY3RlZFwiIDogYCR7YXAuc3RyZW5ndGh9JWB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIH0pfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIEJsdWV0b290aCBkZXZpY2UgbGlzdCBcdTIwMTQgc2FtZSAueHJvdyBncmFtbWFyIGFzIFdpLUZpOyBjb25uZWN0ZWQgZGV2aWNlIGlzIC5hY3RpdmUuXG5mdW5jdGlvbiBCdExpc3QoKSB7XG4gICAgY29uc3QgYnQgPSBCbHVldG9vdGguZ2V0X2RlZmF1bHQoKVxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgICAgICAgICAge2JpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcygoZGV2aWNlcykgPT5cbiAgICAgICAgICAgICAgICBkZXZpY2VzXG4gICAgICAgICAgICAgICAgICAgIC5maWx0ZXIoKGQpID0+IGQubmFtZSB8fCBkLmFsaWFzKVxuICAgICAgICAgICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gTnVtYmVyKGIuY29ubmVjdGVkKSAtIE51bWJlcihhLmNvbm5lY3RlZCkpXG4gICAgICAgICAgICAgICAgICAgIC5zbGljZSgwLCA2KVxuICAgICAgICAgICAgICAgICAgICAubWFwKChkZXYpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG9uID0gZGV2LmNvbm5lY3RlZFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtvbiA/IFwieHJvdyBhY3RpdmVcIiA6IFwieHJvd1wifVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbiA/IGRldi5kaXNjb25uZWN0X2RldmljZSgpIDogZGV2LmNvbm5lY3RfZGV2aWNlKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1ibHVldG9vdGgtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhYmVsPXtkZXYuYWxpYXMgfHwgZGV2Lm5hbWV9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ4c1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbiA/IFwiQ29ubmVjdGVkXCIgOiBkZXYucGFpcmVkID8gXCJQYWlyZWRcIiA6IFwiQXZhaWxhYmxlXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICl9XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuLy8gT25lIG1peGVyIHJvdyAoLm1peHJvdykgXHUyMDE0IGhvcml6b250YWw6IDI2XHUwMEQ3MjYgaWNvbiB0aWxlIFx1MDBCNyA3MnB4IG5hbWUgXHUwMEI3IHNsaWRlciBmaWxscy5cbmZ1bmN0aW9uIE1peFJvdyhwcm9wczogeyBpY29uOiBzdHJpbmc7IHRpdGxlOiBzdHJpbmc7IHRhcmdldDogYW55IH0pIHtcbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwibWl4cm93XCIgc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cIm1pXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3Byb3BzLmljb259IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgIGNsYXNzPVwibW5hbWVcIlxuICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9XG4gICAgICAgICAgICAgICAgbGFiZWw9e3Byb3BzLnRpdGxlfVxuICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDxzbGlkZXJcbiAgICAgICAgICAgICAgICBjbGFzcz1cInNsaWRlclwiXG4gICAgICAgICAgICAgICAgaGV4cGFuZFxuICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICB2YWx1ZT17YmluZChwcm9wcy50YXJnZXQsIFwidm9sdW1lXCIpfVxuICAgICAgICAgICAgICAgIG9uQ2hhbmdlVmFsdWU9eyhfcywgdikgPT4ge1xuICAgICAgICAgICAgICAgICAgICBwcm9wcy50YXJnZXQudm9sdW1lID0gdlxuICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAvPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbi8vIFBlci1hcHAgdm9sdW1lIG1peGVyIFx1MjAxNCBNYXN0ZXIgKGRlZmF1bHQgc3BlYWtlcikgKyBlYWNoIGF1ZGlvIHN0cmVhbSAoQXN0YWxXcCkuXG5mdW5jdGlvbiBNaXhMaXN0KCkge1xuICAgIGNvbnN0IHdwID0gV3AuZ2V0X2RlZmF1bHQoKVxuICAgIGlmICghd3ApIHJldHVybiA8Ym94IC8+XG4gICAgY29uc3Qgc3BlYWtlciA9IHdwLmRlZmF1bHRfc3BlYWtlclxuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgICAgICAgICAge3NwZWFrZXIgJiYgKFxuICAgICAgICAgICAgICAgIDxNaXhSb3cgaWNvbj1cImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiIHRpdGxlPVwiT3V0cHV0XCIgdGFyZ2V0PXtzcGVha2VyfSAvPlxuICAgICAgICAgICAgKX1cbiAgICAgICAgICAgIHtiaW5kKHdwLmF1ZGlvLCBcInN0cmVhbXNcIikuYXMoKHN0cmVhbXMpID0+XG4gICAgICAgICAgICAgICAgc3RyZWFtc1xuICAgICAgICAgICAgICAgICAgICAuc2xpY2UoMCwgNSlcbiAgICAgICAgICAgICAgICAgICAgLm1hcCgocykgPT4gKFxuICAgICAgICAgICAgICAgICAgICAgICAgPE1peFJvd1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb249XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU9e3MuZGVzY3JpcHRpb24gfHwgcy5uYW1lIHx8IFwiQXBwbGljYXRpb25cIn1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXJnZXQ9e3N9XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApKVxuICAgICAgICAgICAgKX1cbiAgICAgICAgPC9ib3g+XG4gICAgKVxufVxuXG5mdW5jdGlvbiBEcmlsbFZpZXcoeyBuYW1lIH06IHsgbmFtZT86IHN0cmluZyB9KSB7XG4gICAgY29uc3QgbmV0ID0gTmV0d29yay5nZXRfZGVmYXVsdCgpXG4gICAgcmV0dXJuIChcbiAgICAgICAgPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICAgICAgICAgIDxjZW50ZXJib3ggY2xhc3M9XCJkaGVhZFwiPlxuICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuXCIgb25DbGlja2VkPXsoKSA9PiBkcmlsbC5zZXQobnVsbCl9PlxuICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLWxlZnQtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDxsYWJlbFxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZChkcmlsbCkuYXMoKGQpID0+XG4gICAgICAgICAgICAgICAgICAgICAgICBkID09PSBcIndpZmlcIiA/IFwiV2ktRmlcIiA6IGQgPT09IFwiYnRcIiA/IFwiQmx1ZXRvb3RoXCIgOiBcIlZvbHVtZVwiXG4gICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICA8Ym94IHdpZHRoUmVxdWVzdD17NDZ9IGhhbGlnbj17R3RrLkFsaWduLkVORH0+XG4gICAgICAgICAgICAgICAgICAgIHtuZXQud2lmaSAmJiAoXG4gICAgICAgICAgICAgICAgICAgICAgICA8c3dpdGNoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWN0aXZlPXtiaW5kKG5ldC53aWZpLCBcImVuYWJsZWRcIil9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChkcmlsbCkuYXMoKGQpID0+IGQgPT09IFwid2lmaVwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbk5vdGlmeUFjdGl2ZT17KHMpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV0LndpZmkhLmVuYWJsZWQgPSBzLmFjdGl2ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgICAgICA8c3dpdGNoXG4gICAgICAgICAgICAgICAgICAgICAgICBhY3RpdmU9e2JpbmQoQmx1ZXRvb3RoLmdldF9kZWZhdWx0KCksIFwicG93ZXJlZFwiKX1cbiAgICAgICAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJpbGwpLmFzKChkKSA9PiBkID09PSBcImJ0XCIpfVxuICAgICAgICAgICAgICAgICAgICAgICAgb25Ob3RpZnlBY3RpdmU9eyhzKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgQmx1ZXRvb3RoLmdldF9kZWZhdWx0KCkuYWRhcHRlci5wb3dlcmVkID0gcy5hY3RpdmVcbiAgICAgICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2NlbnRlcmJveD5cbiAgICAgICAgICAgIHtiaW5kKGRyaWxsKS5hcygoZCkgPT5cbiAgICAgICAgICAgICAgICBkID09PSBcIndpZmlcIiA/IChcbiAgICAgICAgICAgICAgICAgICAgPFdpZmlMaXN0IC8+XG4gICAgICAgICAgICAgICAgKSA6IGQgPT09IFwiYnRcIiA/IChcbiAgICAgICAgICAgICAgICAgICAgPEJ0TGlzdCAvPlxuICAgICAgICAgICAgICAgICkgOiBkID09PSBcIm1peFwiID8gKFxuICAgICAgICAgICAgICAgICAgICA8TWl4TGlzdCAvPlxuICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICAgIDxib3ggLz5cbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApfVxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFF1aWNrU2V0dGluZ3MoKSB7XG4gICAgY29uc3QgeyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH0gPSBtYWtlUmV2ZWFsKDIyMCwgMTUwKVxuICAgIHJlZ2lzdGVyKFwicXVpY2tzZXR0aW5nc1wiLCB0b2dnbGVGbilcbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwicXVpY2tzZXR0aW5nc1wiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1xc1wiXG4gICAgICAgICAgICBjbGFzcz1cInFzLXdpbmRvd1wiXG4gICAgICAgICAgICB2aXNpYmxlPXtiaW5kKHdpblZpc2libGUpfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUfVxuICAgICAgICAgICAgZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH1cbiAgICAgICAgICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChrZXkgIT09IEdkay5LRVlfRXNjYXBlKSByZXR1cm4gZmFsc2VcbiAgICAgICAgICAgICAgICBpZiAoZHJpbGwuZ2V0KCkpIHtcbiAgICAgICAgICAgICAgICAgICAgZHJpbGwuc2V0KG51bGwpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfSAvLyBFc2Mgc3RlcHMgYmFjayBmaXJzdFxuICAgICAgICAgICAgICAgIGNsb3NlKClcbiAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgICAgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0RPV059XG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMjB9XG4gICAgICAgICAgICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2hlZXQgcXNcIj5cbiAgICAgICAgICAgICAgICAgICAgey8qIEd0ay5TdGFjayB3aXRoIHNsaWRlLWxlZnQvcmlnaHQgPSB0aGUgbXVsdGl2aWV3OyBoZWlnaHQgYW5pbWF0ZXNcbiAgICAgICAgICAgIHZpYSBBZHcgc3ByaW5nIG9uIGEgc2l6ZS1ncm91cCB3cmFwcGVyIChNT1RJT04uZHJpbGwgLyBkcmlsbEJhY2spICovfVxuICAgICAgICAgICAgICAgICAgICA8c3RhY2tcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyYW5zaXRpb25UeXBlPXtHdGsuU3RhY2tUcmFuc2l0aW9uVHlwZS5TTElERV9MRUZUX1JJR0hUfVxuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMjB9XG4gICAgICAgICAgICAgICAgICAgICAgICB2aXNpYmxlQ2hpbGROYW1lPXtiaW5kKGRyaWxsKS5hcygoZCkgPT4gKGQgPyBcImRyaWxsXCIgOiBcInJvb3RcIikpfVxuICAgICAgICAgICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAgICAgICAgICA8Um9vdCBuYW1lPVwicm9vdFwiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8RHJpbGxWaWV3IG5hbWU9XCJkcmlsbFwiIC8+XG4gICAgICAgICAgICAgICAgICAgIDwvc3RhY2s+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L3JldmVhbGVyPlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gVGlueVNsaWRlciBcdTIwMTQgR3RrLlNjYWxlIHN1YmNsYXNzIHRoYXQgcmVwb3J0cyBuZWFyLXplcm8gbmF0dXJhbCB3aWR0aCBzbyBpdFxuLy8gbmV2ZXIgZm9yY2VzIGl0cyBwYXJlbnQgY29udGFpbmVyIHdpZGVyIHRoYW4gdGhlIGNoaXAtZ3JpZCdzIG5hdHVyYWwgd2lkdGguXG4vLyBXZSBleHRlbmQgR3RrLlNjYWxlIGRpcmVjdGx5IChub3QgQXN0YWwuU2xpZGVyKSBiZWNhdXNlIEFzdGFsLlNsaWRlcidzIFZhbGFcbi8vIEMgdmZ1bmNzIGNhbiBpbnRlcmNlcHQgdGhlIG1lYXN1cmUgY2hhaW4gYmVmb3JlIHRoZSBHSlMgb3ZlcnJpZGUgaXMgcmVhY2hlZC5cbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGtcIlxuXG5leHBvcnQgY29uc3QgVGlueVNsaWRlciA9IEdPYmplY3QucmVnaXN0ZXJDbGFzcyhcbiAgICB7XG4gICAgICAgIEdUeXBlTmFtZTogXCJLb2JlbFRpbnlTY2FsZVwiLFxuICAgIH0sXG4gICAgY2xhc3MgVGlueVNsaWRlciBleHRlbmRzIEd0ay5TY2FsZSB7XG4gICAgICAgIGNvbnN0cnVjdG9yKHBhcmFtcz86IFBhcnRpYWw8R3RrLlNjYWxlLkNvbnN0cnVjdG9yUHJvcHMgJiB7IHZhbHVlPzogbnVtYmVyIH0+KSB7XG4gICAgICAgICAgICBjb25zdCB7IHZhbHVlLCAuLi5yZXN0IH0gPSAocGFyYW1zID8/IHt9KSBhcyBhbnlcbiAgICAgICAgICAgIHN1cGVyKHtcbiAgICAgICAgICAgICAgICBvcmllbnRhdGlvbjogR3RrLk9yaWVudGF0aW9uLkhPUklaT05UQUwsXG4gICAgICAgICAgICAgICAgYWRqdXN0bWVudDogbmV3IEd0ay5BZGp1c3RtZW50KHtcbiAgICAgICAgICAgICAgICAgICAgbG93ZXI6IDAsXG4gICAgICAgICAgICAgICAgICAgIHVwcGVyOiAxLFxuICAgICAgICAgICAgICAgICAgICBzdGVwX2luY3JlbWVudDogMC4wMSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZV9pbmNyZW1lbnQ6IDAuMSxcbiAgICAgICAgICAgICAgICAgICAgcGFnZV9zaXplOiAwLFxuICAgICAgICAgICAgICAgICAgICB2YWx1ZTogdmFsdWUgPz8gMCxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgICBkcmF3X3ZhbHVlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAuLi5yZXN0LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHZmdW5jX21lYXN1cmUoXG4gICAgICAgICAgICBvcmllbnRhdGlvbjogR3RrLk9yaWVudGF0aW9uLFxuICAgICAgICAgICAgZm9yX3NpemU6IG51bWJlclxuICAgICAgICApOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSB7XG4gICAgICAgICAgICBpZiAob3JpZW50YXRpb24gPT09IEd0ay5PcmllbnRhdGlvbi5IT1JJWk9OVEFMKSB7XG4gICAgICAgICAgICAgICAgLy8gUmVwb3J0IG5hdHVyYWw9MSBzbyB0aGUgc3Jvdy9zbGlkZXJzIGNvbnRhaW5lciBkb2Vzbid0IGluZmxhdGUgdGhlIFFTIHBhbmVsXG4gICAgICAgICAgICAgICAgLy8gYmV5b25kIHRoZSBjaGlwLWdyaWQgbmF0dXJhbCB3aWR0aC4gVGhlIHNsaWRlciBzdGlsbCBoZXhwYW5kcyB0byBmaWxsIHRoZVxuICAgICAgICAgICAgICAgIC8vIGF2YWlsYWJsZSBzcGFjZSBhdCBhbGxvY2F0aW9uIHRpbWUgXHUyMDE0IG9ubHkgdGhlIG5hdHVyYWwgc2l6ZSBpcyBvdmVycmlkZGVuLlxuICAgICAgICAgICAgICAgIHJldHVybiBbMCwgMSwgLTEsIC0xXVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHN1cGVyLnZmdW5jX21lYXN1cmUob3JpZW50YXRpb24sIGZvcl9zaXplKVxuICAgICAgICB9XG4gICAgfVxuKVxuIiwgIi8vIE5vdGlmaWNhdGlvbnMuIFByb3RvdHlwZS1maW5hbDogZmxvYXRpbmcgYmx1cnJlZCB0b2FzdHMgKHRvcC1yaWdodCwgdGhlIE9ORVxuLy8gc2FuY3Rpb25lZCB0cmFuc2x1Y2VuY3kpICsgcmlnaHQgZHJhd2VyIChtZWRpYSBjYXJkIG9uIHRvcCwgcGFuZWwtbGVzcyBjYXJkc1xuLy8gZmxvYXRpbmcgb24gd2FsbHBhcGVyLCBoZWFkZXIgY2hpcCkuIFRoZSB1bmlmaWVkIHBpcGVsaW5lOiBvcGVuIHRoZSBkcmF3ZXIgd2hpbGVcbi8vIGEgdG9hc3QgaXMgbGl2ZSBhbmQgaXQncyBBRE9QVEVEIGludG8gdGhlIHN0YWNrOyB0b2FzdHMgYXJyaXZpbmcgd2hpbGUgb3BlblxuLy8gaW5zZXJ0IGFzIGNhcmRzOyBTaWxlbnQgcm91dGVzIHN0cmFpZ2h0IHRvIHRoZSBzdG9yZS5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCB0aW1lb3V0LCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgbWFrZVJldmVhbCwgcmVnaXN0ZXIgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuXG4vLyBMYXp5IHNpbmdsZXRvbiBcdTIwMTQgY2FsbGluZyBnZXRfZGVmYXVsdCgpIGF0IG1vZHVsZSBzY29wZSBibG9ja3MgdGhlIGltcG9ydCB3aGlsZVxuLy8gQXN0YWxOb3RpZmQgdHJpZXMgdG8gYWNxdWlyZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyAoaGFuZ3MgaWYgZ25vbWUtc2hlbGxcbi8vIHN0aWxsIG93bnMgaXQpLiBEZWZlcnJpbmcgdG8gZmlyc3QgdXNlIGxldHMgdGhlIG1vZHVsZSBpbXBvcnQgY2xlYW5seTsgdGhlIGJ1cyBpc1xuLy8gcmVsZWFzZWQgYnkgYGdub2JsaW5jdGwgZGlzYWJsZSBub3RpZmljYXRpb25zYCBiZWZvcmUgdGhlIGRhZW1vbiBhY3R1YWxseSBjbGFpbXMgaXQuXG5sZXQgX25vdGlmZDogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5jb25zdCBuZCA9ICgpID0+IChfbm90aWZkID8/PSBOb3RpZmQuZ2V0X2RlZmF1bHQoKSlcbmNvbnN0IHNraXAgPSAoKSA9PiAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIilcbmNvbnN0IFRPQVNUX01TID0gMzgwMFxuLy8gUmVhY3RpdmUgZHJhd2VyLW9wZW4gc3RhdGUgc28gdGhlIHRvYXN0cyBjYW4gYmUgQURPUFRFRCAoaGlkZGVuKSB0aGUgaW5zdGFudCB0aGVcbi8vIGRyYXdlciBvcGVucywgd2l0aG91dCBwb2xsaW5nIGEgbG9va2VkLXVwIHdpbmRvdydzIHZpc2liaWxpdHkuXG5jb25zdCBkcmF3ZXJPcGVuID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIE5vdGlmaWNhdGlvbiBjYXJkcyBhcmUgYSBkZWZpbmVkIHdpZHRoIChwcm90b3R5cGUgYHB3YCBcdTIyNDggUVMgcGFuZWwpIHNvIHRoZSB0b2FzdFxuLy8gZG9lc24ndCBzdHJldGNoIHRvIHRoZSBoZXhwYW5kIHRleHQgY29sdW1uOyB0aGUgZHJhd2VyIGNhcmRzIGZpbGwgdGhlIHNhbWUgd2lkdGguXG5jb25zdCBOQ0FSRF9XID0gMzI3XG5mdW5jdGlvbiBDYXJkKHsgbiB9OiB7IG46IE5vdGlmZC5Ob3RpZmljYXRpb24gfSkge1xuICAgIHJldHVybiAoXG4gICAgICAgIDxib3ggY2xhc3M9XCJuY2FyZFwiIHNwYWNpbmc9ezEwfSB3aWR0aFJlcXVlc3Q9e05DQVJEX1d9PlxuICAgICAgICAgICAgey8qIGFwcCBpY29uIGluIGEgMzBcdTAwRDczMCByOSB0aWxlIChwcm90b3R5cGUgLm5pYykgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwibmljXCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17bi5hcHBfaWNvbiB8fCBcImRpYWxvZy1pbmZvcm1hdGlvbi1zeW1ib2xpY1wifSBwaXhlbFNpemU9ezIwfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICAgICAgICAgICAgPGJveD5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBoZXhwYW5kIGVsbGlwc2l6ZT17M30gbGFiZWw9e24uc3VtbWFyeX0gLz5cbiAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cIndoZW4gdG5cIlxuICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e25ldyBEYXRlKG4udGltZSAqIDEwMDApLnRvTG9jYWxlVGltZVN0cmluZyhcImVuLUdCXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBob3VyOiBcIjItZGlnaXRcIixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtaW51dGU6IFwiMi1kaWdpdFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSl9XG4gICAgICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwiYm9keVwiXG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgICAgICAgICB4YWxpZ249ezB9XG4gICAgICAgICAgICAgICAgICAgIHdyYXBcbiAgICAgICAgICAgICAgICAgICAgbWF4V2lkdGhDaGFycz17NDB9XG4gICAgICAgICAgICAgICAgICAgIGxhYmVsPXtuLmJvZHl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm54XCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IG9uQ2xpY2tlZD17KCkgPT4gbi5kaXNtaXNzKCl9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNsb3NlLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8L2JveD5cbiAgICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUb2FzdHMobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICAgIC8vIE9ubHkgcmVuZGVyIG5vdGlmaWNhdGlvbnMgeW91bmdlciB0aGFuIFRPQVNUX01TIHdoaWxlIHRoZSBkcmF3ZXIgaXMgQ0xPU0VEIFx1MjAxNFxuICAgIC8vIG9wZW5pbmcgdGhlIGRyYXdlciBcImFkb3B0c1wiIHRoZW0gKHRoZXkgc2ltcGx5IGNvbnRpbnVlIGxpZmUgYXMgZHJhd2VyIGNhcmRzLFxuICAgIC8vIHdoaWNoIGlzIHRoZSBGTElQIGhhbmRvZmYgZXhwcmVzc2VkIGluIHJldGFpbmVkLW1vZGUgdGVybXMpLlxuICAgIGNvbnN0IGxpdmUgPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gICAgLy8gYHNob3duYCA9IHdoYXQgdGhlIHRvYXN0IGNvbHVtbiByZW5kZXJzLiBSZWNvbXB1dGVkIGV4cGxpY2l0bHkgb24gZXZlcnkgaW5wdXRcbiAgICAvLyBjaGFuZ2UgKFZhcmlhYmxlLmRlcml2ZSBkaWRuJ3QgcHJvZHVjZSBhIHJlYWN0aXZlIGJpbmRpbmcgaGVyZSkuIEVtcHR5IHdoaWxlIHRoZVxuICAgIC8vIGRyYXdlciBpcyBvcGVuICh0b2FzdHMgYXJlIEFET1BURUQgaW50byB0aGUgZHJhd2VyIHN0YWNrKS5cbiAgICBjb25zdCBzaG93biA9IFZhcmlhYmxlPG51bWJlcltdPihbXSlcbiAgICBjb25zdCByZWNvbXB1dGUgPSAoKSA9PiBzaG93bi5zZXQoZHJhd2VyT3Blbi5nZXQoKSA/IFtdIDogbGl2ZS5nZXQoKSlcbiAgICBsaXZlLnN1YnNjcmliZShyZWNvbXB1dGUpXG4gICAgZHJhd2VyT3Blbi5zdWJzY3JpYmUocmVjb21wdXRlKVxuICAgIG5kKCkuY29ubmVjdChcIm5vdGlmaWVkXCIsIChfbiwgaWQpID0+IHtcbiAgICAgICAgaWYgKGRyYXdlck9wZW4uZ2V0KCkgfHwgbmQoKS5kb250X2Rpc3R1cmIpIHJldHVyblxuICAgICAgICBsaXZlLnNldChbLi4ubGl2ZS5nZXQoKSwgaWRdKVxuICAgICAgICB0aW1lb3V0KFRPQVNUX01TLCAoKSA9PiBsaXZlLnNldChsaXZlLmdldCgpLmZpbHRlcigoeCkgPT4geCAhPT0gaWQpKSlcbiAgICB9KVxuICAgIHJldHVybiAoXG4gICAgICAgIDx3aW5kb3dcbiAgICAgICAgICAgIG5hbWU9XCJ0b2FzdHNcIlxuICAgICAgICAgICAgbmFtZXNwYWNlPVwia29iZWwtdG9hc3RzXCJcbiAgICAgICAgICAgIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgICAgICAgICAvLyBIaWRlIHRoZSB3aG9sZSB0b2FzdCBzdXJmYWNlIHdoaWxlIHRoZSBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG9cbiAgICAgICAgICAgIC8vIHRoZSBkcmF3ZXIpIFx1MjAxNCBhIHJlYWN0aXZlIHdpbmRvdy12aXNpYmlsaXR5IGJpbmQsIHJvYnVzdCByZWdhcmRsZXNzIG9mIHRoZVxuICAgICAgICAgICAgLy8gcGVyLWl0ZW0gbGlzdCByZWNvbmNpbGlhdGlvbi5cbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJhd2VyT3BlbikuYXMoKG8pID0+ICFvKX1cbiAgICAgICAgICAgIC8vIFRvYXN0cyBhcmUgYSBmbG9hdGluZyBvdmVybGF5IChsaWtlIHRoZSBwcm90b3R5cGUncyBhYnNvbHV0ZSB0b3AvcmlnaHQpOyB0aGVcbiAgICAgICAgICAgIC8vIGZsb2F0IGluc2V0IGNsZWFycyB0aGUgZmxvYXRpbmcgYmFyIChtYXJnaW5Ub3AgMTAgKyBoZWlnaHQgNDIpICsgYSBzbWFsbCBnYXAsXG4gICAgICAgICAgICAvLyBhbmQgdGhlIHJpZ2h0IGluc2V0IG1hdGNoZXMgdGhlIGJhcidzIGVkZ2UgbWFyZ2luLlxuICAgICAgICAgICAgbWFyZ2luVG9wPXs1OH1cbiAgICAgICAgICAgIG1hcmdpblJpZ2h0PXsxMn1cbiAgICAgICAgICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICAgICAgPlxuICAgICAgICAgICAgey8qIGZpeGVkIHRvYXN0IGNvbHVtbiB3aWR0aCBzbyB0aGUgY2FyZCBjYW4ndCBzdHJldGNoIHRvIGl0cyBoZXhwYW5kIHRleHQgY29sdW1uICovfVxuICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgc3BhY2luZz17OH1cbiAgICAgICAgICAgICAgICB3aWR0aFJlcXVlc3Q9e05DQVJEX1cgKyAyNn1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICA+XG4gICAgICAgICAgICAgICAge2JpbmQoc2hvd24pLmFzKChpZHMpID0+XG4gICAgICAgICAgICAgICAgICAgIGlkcy5tYXAoKGlkKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBuID0gbmQoKS5nZXRfbm90aWZpY2F0aW9uKGlkKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG4gPyAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInRvYXN0XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxDYXJkIG49e259IC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgICAgICAgICApIDogKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3ggLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cblxuZnVuY3Rpb24gTWVkaWFDYXJkKCkge1xuICAgIGxldCBwbGF5ZXI6IGFueSA9IG51bGxcbiAgICB0cnkge1xuICAgICAgICBwbGF5ZXIgPSBNcHJpcy5nZXRfZGVmYXVsdCgpPy5wbGF5ZXJzPy5bMF0gPz8gbnVsbFxuICAgIH0gY2F0Y2gge1xuICAgICAgICBwbGF5ZXIgPSBudWxsXG4gICAgfVxuICAgIGlmICghcGxheWVyKSByZXR1cm4gPGJveCB2aXNpYmxlPXtmYWxzZX0gLz5cbiAgICByZXR1cm4gKFxuICAgICAgICA8Ym94IGNsYXNzPVwibmNhcmQgbWVkaWFcIiBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICA8aW1hZ2UgcGl4ZWxTaXplPXs0Nn0gaWNvbk5hbWU9XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e2JpbmQocGxheWVyLCBcInRpdGxlXCIpfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YlwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17YmluZChwbGF5ZXIsIFwiYXJ0aXN0XCIpfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4gcGxheWVyLnByZXZpb3VzKCl9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXNraXAtYmFjay1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDxidXR0b24gb25DbGlja2VkPXsoKSA9PiBwbGF5ZXIucGxheV9wYXVzZSgpfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgaWNvbk5hbWU9e2JpbmQocGxheWVyLCBcInBsYXliYWNrX3N0YXR1c1wiKS5hcygocykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgIHMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4gcGxheWVyLm5leHQoKX0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1md2Qtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgIDwvYm94PlxuICAgIClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIERyYXdlcigpIHtcbiAgICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICAgIGNvbnN0IG5mZCA9IG5kKClcbiAgICBjb25zdCBsaXN0ID0gVmFyaWFibGU8Tm90aWZkLk5vdGlmaWNhdGlvbltdPihuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKSA/PyBbXSlcbiAgICBjb25zdCByZWZyZXNoID0gKCkgPT4gbGlzdC5zZXQobmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gICAgbmZkLmNvbm5lY3QoXCJub3RpZmllZFwiLCByZWZyZXNoKVxuICAgIG5mZC5jb25uZWN0KFwicmVzb2x2ZWRcIiwgcmVmcmVzaClcblxuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgyMDAsIDE1MClcbiAgICByZWdpc3RlcihcImRyYXdlclwiLCB0b2dnbGVGbilcbiAgICAvLyBLZWVwIGRyYXdlck9wZW4gaW4gc3luYyB3aXRoIHRoZSByZXZlYWxlZCBzdGF0ZSAodG9hc3RzIGFkb3B0IGludG8gZHJhd2VyIHdoZW4gb3BlbilcbiAgICByZXZlYWxlZC5zdWJzY3JpYmUoKHIpID0+IGRyYXdlck9wZW4uc2V0KHIpKVxuXG4gICAgcmV0dXJuIChcbiAgICAgICAgPHdpbmRvd1xuICAgICAgICAgICAgbmFtZT1cImRyYXdlclwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1kcmF3ZXJcIlxuICAgICAgICAgICAgY2xhc3M9XCJkcmF3ZXItd2luZG93XCJcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgICAgICAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFQgfCBBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgICAgICAgICBvbktleVByZXNzZWQ9eyhfc2VsZiwga2V5KSA9PiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChjbG9zZSgpLCB0cnVlKSA6IGZhbHNlKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0xFRlR9XG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMDB9XG4gICAgICAgICAgICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgICAgICAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX1cbiAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwiZHJhd2VyXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgIDxNZWRpYUNhcmQgLz5cbiAgICAgICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cIm5oZWFkXCIgc3BhY2luZz17OH0+XG4gICAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJOb3RpZmljYXRpb25zXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRuIHN1YlwiIGxhYmVsPXtiaW5kKGxpc3QpLmFzKChuKSA9PiBgJHtuLmxlbmd0aCB8fCBcIlwifWApfSAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwibmNsZWFyXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IG5mZC5nZXRfbm90aWZpY2F0aW9ucygpLmZvckVhY2goKG4pID0+IG4uZGlzbWlzcygpKX1cbiAgICAgICAgICAgICAgICAgICAgICAgID5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezV9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC10cmFzaC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIkNsZWFyXCIgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fSB2ZXhwYW5kPlxuICAgICAgICAgICAgICAgICAgICAgICAge2JpbmQobGlzdCkuYXMoKG5zKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG5zICYmIG5zLmxlbmd0aFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA/IG5zLm1hcCgobikgPT4gPENhcmQgbj17bn0gLz4pXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibmNhcmQgZW1wdHlcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiQWxsIGNhdWdodCB1cCBcdTI3MTNcIiAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD4sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICAgICAgKX1cbiAgICAgICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L3JldmVhbGVyPlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gT1NEIFx1MjAxNCBkaXNwbGF5LW9ubHkgdm9sdW1lIHBpbGwgYWJvdmUgdGhlIGRvY2suIFByb3RvdHlwZTogcG9pbnRlci1ldmVudHMgbm9uZSxcbi8vIGF1dG8taGlkZSAxLjRzLCB0cmFuc2x1Y2VudCAoYmx1ciB2aWEgZ25vYmxpbiB3aW5kb3ctcnVsZSkuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIE9TRChtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICAgIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICAgIGNvbnN0IHZpc2libGUgPSBWYXJpYWJsZShmYWxzZSlcbiAgICBsZXQgaGlkZTogUmV0dXJuVHlwZTx0eXBlb2YgdGltZW91dD4gfCBudWxsID0gbnVsbFxuICAgIGlmICghc3BlYWtlcikgcmV0dXJuIG51bGxcblxuICAgIHNwZWFrZXIuY29ubmVjdChcIm5vdGlmeTo6dm9sdW1lXCIsICgpID0+IHtcbiAgICAgICAgdmlzaWJsZS5zZXQodHJ1ZSlcbiAgICAgICAgaGlkZT8uY2FuY2VsKClcbiAgICAgICAgaGlkZSA9IHRpbWVvdXQoMTQwMCwgKCkgPT4gdmlzaWJsZS5zZXQoZmFsc2UpKVxuICAgIH0pXG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwib3NkXCJcbiAgICAgICAgICAgIG5hbWVzcGFjZT1cImtvYmVsLW9zZFwiXG4gICAgICAgICAgICBnZGttb25pdG9yPXttb25pdG9yfVxuICAgICAgICAgICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgICAgICAgICAgbWFyZ2luQm90dG9tPXs3MH1cbiAgICAgICAgICAgIGNsaWNrVGhyb3VnaFxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh2aXNpYmxlKX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPGJveCBjbGFzcz1cIm9zZFwiIHNwYWNpbmc9ezExfSB3aWR0aFJlcXVlc3Q9ezIzMH0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIil9IC8+XG4gICAgICAgICAgICAgICAgPGxldmVsYmFyIGhleHBhbmQgdmFsdWU9e2JpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIil9IC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgIGNsYXNzPVwidG5cIlxuICAgICAgICAgICAgICAgICAgICBsYWJlbD17YmluZChzcGVha2VyLCBcInZvbHVtZVwiKS5hcygodikgPT4gYCR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYCl9XG4gICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L3dpbmRvdz5cbiAgICApXG59XG4iLCAiLy8gU2Vzc2lvbiBvdmVybGF5IFx1MjAxNCBkaW1tZWQgKDAuOCksIDQgYnV0dG9ucywgYXJyb3ctbmF2LCBQUkVTUy1BR0FJTiBjb25maXJtIG9uXG4vLyBSZXN0YXJ0L1NodXQgZG93biAoYXV0by1yZXZlcnQgNHMpLCByZXN0aW5nIHJvc2Ugb24gU2h1dCBkb3duLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcbnZvaWQgREVNT1xudm9pZCBEXG5cbmNvbnN0IEFDVElPTlMgPSBbXG4gICAge1xuICAgICAgICBpZDogXCJsb2NrXCIsXG4gICAgICAgIGxhYmVsOiBcIkxvY2tcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1sb2NrLXN5bWJvbGljXCIsXG4gICAgICAgIGNvbmZpcm06IGZhbHNlLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSxcbiAgICB9LFxuICAgIHtcbiAgICAgICAgaWQ6IFwibG9nb3V0XCIsXG4gICAgICAgIGxhYmVsOiBcIkxvZyBvdXRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1sb2dvdXQtc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogZmFsc2UsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwiZ25vbWUtc2Vzc2lvbi1xdWl0IC0tbG9nb3V0IC0tbm8tcHJvbXB0XCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBpZDogXCJyZXN0YXJ0XCIsXG4gICAgICAgIGxhYmVsOiBcIlJlc3RhcnRcIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICAgICAgY29uZmlybTogdHJ1ZSxcbiAgICAgICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgcmVib290XCIpLFxuICAgIH0sXG4gICAge1xuICAgICAgICBpZDogXCJzaHV0ZG93blwiLFxuICAgICAgICBsYWJlbDogXCJTaHV0IGRvd25cIixcbiAgICAgICAgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLFxuICAgICAgICBjb25maXJtOiB0cnVlLFxuICAgICAgICByZWQ6IHRydWUsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwic3lzdGVtY3RsIHBvd2Vyb2ZmXCIpLFxuICAgIH0sXG5dXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFNlc3Npb24oKSB7XG4gICAgY29uc3QgYXJtZWQgPSBWYXJpYWJsZTxzdHJpbmcgfCBudWxsPihudWxsKVxuICAgIGxldCByZXZlcnQ6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcblxuICAgIGNvbnN0IHsgd2luVmlzaWJsZSwgcmV2ZWFsZWQsIHNldFJldmVhbGVyLCBjbG9zZSwgdG9nZ2xlOiB0b2dnbGVGbiB9ID0gbWFrZVJldmVhbCgxODAsIDEzMClcbiAgICByZWdpc3RlcihcInNlc3Npb25cIiwgdG9nZ2xlRm4pXG5cbiAgICBjb25zdCBwcmVzcyA9IChhOiAodHlwZW9mIEFDVElPTlMpW251bWJlcl0pID0+IHtcbiAgICAgICAgaWYgKGEuY29uZmlybSAmJiBhcm1lZC5nZXQoKSAhPT0gYS5pZCkge1xuICAgICAgICAgICAgYXJtZWQuc2V0KGEuaWQpXG4gICAgICAgICAgICByZXZlcnQ/LmNhbmNlbCgpXG4gICAgICAgICAgICByZXZlcnQgPSB0aW1lb3V0KDQwMDAsICgpID0+IGFybWVkLnNldChudWxsKSlcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICB9XG4gICAgICAgIGFybWVkLnNldChudWxsKVxuICAgICAgICBjbG9zZSgpXG4gICAgICAgIGEucnVuKClcbiAgICB9XG5cbiAgICByZXR1cm4gKFxuICAgICAgICA8d2luZG93XG4gICAgICAgICAgICBuYW1lPVwic2Vzc2lvblwiXG4gICAgICAgICAgICBuYW1lc3BhY2U9XCJrb2JlbC1zZXNzaW9uXCJcbiAgICAgICAgICAgIGNsYXNzPVwic2Vzc2lvbi13aW5kb3dcIlxuICAgICAgICAgICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICAgICAgICAgIGFuY2hvcj17XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLlRPUCB8XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTSB8XG4gICAgICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLkxFRlQgfFxuICAgICAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5FWENMVVNJVkV9XG4gICAgICAgICAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuSUdOT1JFfVxuICAgICAgICAgICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfRXNjYXBlKSB7XG4gICAgICAgICAgICAgICAgICAgIGFybWVkLnNldChudWxsKVxuICAgICAgICAgICAgICAgICAgICBjbG9zZSgpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICAgICAgfX1cbiAgICAgICAgPlxuICAgICAgICAgICAgPHJldmVhbGVyXG4gICAgICAgICAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLkNST1NTRkFERX1cbiAgICAgICAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezE4MH1cbiAgICAgICAgICAgICAgICByZXZlYWxDaGlsZD17YmluZChyZXZlYWxlZCl9XG4gICAgICAgICAgICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldFJldmVhbGVyKHIpfVxuICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgIHsvKiAuc2Vzc2lvbiBmaWxscyB0aGUgd2hvbGUgd2luZG93ICh0aGUgZGltKTsgYnV0dG9ucyBjZW50ZXJlZCBpbnNpZGUgKi99XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNlc3Npb25cIiBoZXhwYW5kIHZleHBhbmQ+XG4gICAgICAgICAgICAgICAgICAgIDxib3ggaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezIwfSBoZXhwYW5kPlxuICAgICAgICAgICAgICAgICAgICAgICAge0FDVElPTlMubWFwKChhKSA9PiAoXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz17YS5yZWQgPyBcInNidG4gcmVkXCIgOiBcInNidG5cIn0gb25DbGlja2VkPXsoKSA9PiBwcmVzcyhhKX0+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxib3hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcGFjaW5nPXsxMH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPXtiaW5kKGFybWVkKS5hcygoeCkgPT4gKHggPT09IGEuaWQgPyBcImNvbmZpcm1cIiA6IFwiXCIpKX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJveFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNsYXNzPVwic2ljXCJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoZXhwYW5kPXtmYWxzZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXhwYW5kPXtmYWxzZX1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHsvKiBob3Jpem9udGFsIEd0a0JveCBpZ25vcmVzIGEgY2hpbGQncyBtYWluLWF4aXMgaGFsaWduLCBzbyB0aGUgaWNvblxuICAgICAgICAgICAgICAgICAgICBsZWZ0LXBhY2tzOyBoZXhwYW5kIG1ha2VzIHRoZSBpbWFnZSBmaWxsIHRoZSA1OXB4IHRpbGUgXHUyMTkyIEd0a0ltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNlbnRyZXMgdGhlIGdseXBoLiBoZXhwYW5kPXtmYWxzZX0gb24gLnNpYyBibG9ja3MgcHJvcGFnYXRpb24gc28gdGhlXG4gICAgICAgICAgICAgICAgICAgIHRpbGUgc3RheXMgNTkgd2lkZSBpbnN0ZWFkIG9mIHN0cmV0Y2hpbmcgdGhlIHJvdy4gKi99XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGltYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGljb25OYW1lPXthLmljb259XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpeGVsU2l6ZT17MjJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGxhYmVsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFiZWw9e2JpbmQoYXJtZWQpLmFzKCh4KSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB4ID09PSBhLmlkID8gXCJQcmVzcyBhZ2FpblwiIDogYS5sYWJlbFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICl9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgICAgICAgICkpfVxuICAgICAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIDwvcmV2ZWFsZXI+XG4gICAgICAgIDwvd2luZG93PlxuICAgIClcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxPQUFPQSxZQUFXO0FBQ2xCLE9BQU9DLFVBQVM7QUFDaEIsT0FBT0MsVUFBUzs7O0FDRmhCLE9BQU9DLFlBQVc7OztBQ0FYLElBQU0sV0FBVyxDQUFDLFFBQWdCLElBQ3BDLFFBQVEsbUJBQW1CLE9BQU8sRUFDbEMsV0FBVyxLQUFLLEdBQUcsRUFDbkIsWUFB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QUFNLElBQUksT0FBTyxHQUFHLElBQUk7QUFDcEMsV0FBSyxRQUFRLE1BQU0sS0FBSyxPQUFPLEdBQUcsSUFBSTtBQUN0QyxXQUFLLFVBQVUsTUFBTSxPQUFPLE9BQU8sR0FBRyxJQUFJO0FBQzFDLFdBQUssT0FBTyxNQUFNLElBQUksT0FBTyxHQUFHLElBQUk7QUFBQSxJQUN4QztBQUNBLFNBQUssWUFBWSxNQUFNLFNBQVMsR0FBRyxLQUFLO0FBQ3hDLFNBQUssaUJBQWlCLE1BQU0sY0FBYyxHQUFHLEtBQUs7QUFDbEQsU0FBSyxZQUFZLE1BQU0sU0FBUyxHQUFHLEtBQUs7QUFDeEMsU0FBSyxVQUFVLE1BQU0sT0FBTyxHQUFHLEtBQUs7QUFDcEMsU0FBSyxXQUFXLE1BQU0sUUFBUSxHQUFHLEtBQUs7QUFFdEMsWUFBUSxDQUFDLFNBQVMsWUFBSSxXQUFXLElBQUksQ0FBUTtBQUFBLEVBQ2pEO0FBQUE7QUFBQSxFQUVBLGVBQWUsU0FBUyxLQUFLO0FBQ3pCLFVBQU0sQ0FBQyxLQUFLLEdBQUcsSUFBSSxRQUFRLE1BQU0sR0FBRztBQUNwQyxRQUFJLFFBQVEsVUFBVTtBQUNsQixhQUFjLEdBQUc7QUFDakIsYUFBTyxJQUFJLElBQUk7QUFBQSxJQUNuQjtBQUNBLFFBQUksUUFBUSxjQUFjO0FBQ3RCLGtCQUFJLFVBQVUsZUFBUSxTQUFTLE1BQU0sR0FBRyxJQUFJO0FBQzVDLGFBQU8sSUFBSSxJQUFJO0FBQUEsSUFDbkI7QUFDQSxRQUFJLFNBQVM7QUFBQSxFQUNqQjtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbIkFzdGFsIiwgIkd0ayIsICJHZGsiLCAiQXN0YWwiLCAiYmluZCIsICJpbnRlcnZhbCIsICJ0aW1lb3V0IiwgIkFzdGFsIiwgIkFzdGFsIiwgImluaXQiLCAiQXN0YWwiLCAidiIsICJpbnRlcnZhbCIsICJrZXkiLCAiY3RvcnMiLCAia2V5IiwgIkd0ayIsICJBc3RhbCIsICJzbmFrZWlmeSIsICJwYXRjaCIsICJBcHBzIiwgIkJsdWV0b290aCIsICJNcHJpcyIsICJOb3RpZmQiLCAiV3AiLCAiQXBwIiwgIkd0ayIsICJBc3RhbCIsICJBc3RhbCIsICJHdGsiLCAiR3RrIiwgIkFzdGFsIiwgImNoIiwgIkd0ayIsICJHZGsiLCAiR2lvIiwgIkdMaWIiLCAiZGVmYXVsdCIsICJBc3RhbCIsICJHT2JqZWN0IiwgImRlZmF1bHQiLCAiR09iamVjdCIsICJHaW8iLCAiR0xpYiIsICJHaW8iLCAiR0xpYiIsICJpbml0IiwgIkdMaWIiLCAiR0xpYiIsICJ0eXBlIiwgIkdMaWIiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiYXN0YWxpZnkiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiZmlsdGVyIiwgIkd0ayIsICJBc3RhbCIsICJCb3giLCAiYXN0YWxpZnkiLCAiR09iamVjdCIsICJCdXR0b24iLCAiQ2VudGVyQm94IiwgIkVudHJ5IiwgIkxhYmVsIiwgIkxldmVsQmFyIiwgIk1lbnVCdXR0b24iLCAiT3ZlcmxheSIsICJSZXZlYWxlciIsICJTbGlkZXIiLCAiU3RhY2siLCAiU3dpdGNoIiwgIldpbmRvdyIsICJqc3giLCAiQm94IiwgIkJ1dHRvbiIsICJDZW50ZXJCb3giLCAiRW50cnkiLCAiTGFiZWwiLCAiTGV2ZWxCYXIiLCAiTWVudUJ1dHRvbiIsICJPdmVybGF5IiwgIlJldmVhbGVyIiwgIlNsaWRlciIsICJTdGFjayIsICJTd2l0Y2giLCAiV2luZG93IiwgImRlZmF1bHQiLCAianN4IiwgIndpZmlJY29uIiwgIkd0ayIsICJuIiwgIkFzdGFsIiwgIkdpbyIsICJqc3giLCAiR3RrIiwgIm4iLCAiR2RrIiwgIkdpbyIsICJBc3RhbCIsICJBcHBzIiwgIk1wcmlzIiwgIkdMaWIiLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIlBJTk5FRCIsICJBcHBzIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJHdGsiLCAiTXByaXMiLCAiTmV0d29yayIsICJXcCIsICJHaW8iLCAiQmF0dGVyeSIsICJHT2JqZWN0IiwgIkd0ayIsICJUaW55U2xpZGVyIiwgImRlZmF1bHQiLCAiU1RPUkUiLCAianN4IiwgIkd0ayIsICJXcCIsICJHaW8iLCAiQmF0dGVyeSIsICJOZXR3b3JrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiTm90aWZkIiwgIk1wcmlzIiwgIk5vdGlmZCIsICJkZWZhdWx0IiwgIm4iLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJNcHJpcyIsICJrZXkiLCAiR2RrIiwgIldwIiwgIldwIiwgImpzeCIsICJBc3RhbCIsICJBQ1RJT05TIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJHdGsiLCAiaW5pdCIsICJHZGsiXQp9Cg==
