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
await suppress(import("gi://AstalMpris"), ({ Mpris: Mpris2, Player }) => {
  patch(Mpris2.prototype, "players");
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
  return /* @__PURE__ */ jsx2(
    "button",
    {
      valign: Gtk4.Align.CENTER,
      class: bind(connected).as((c) => c ? "status" : "status err"),
      onClicked: () => app_default.toggle_window("quicksettings"),
      children: /* @__PURE__ */ jsxs("box", { spacing: 10, children: [
        /* @__PURE__ */ jsx2("image", { class: "net-icon", iconName: "kobel-wifi-symbolic" }),
        /* @__PURE__ */ jsx2("image", { iconName: "kobel-speaker-wave-symbolic" }),
        /* @__PURE__ */ jsxs("box", { class: "pct", spacing: 6, children: [
          /* @__PURE__ */ jsx2("image", { iconName: "kobel-battery-symbolic" }),
          /* @__PURE__ */ jsx2("label", { class: "tn", label: DEMO ? D.batteryPct : bat ? bind(bat, "percentage").as((p) => `${Math.round(p * 100)}%`) : "100%" })
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
      onClicked: () => app_default.toggle_window("drawer"),
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
              onClicked: () => app_default.toggle_window("launcher"),
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
            onClicked: () => app_default.toggle_window("calendar"),
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
            /* @__PURE__ */ jsx2("button", { class: "ibtn tray-icon", valign: Gtk4.Align.CENTER, tooltipText: "Discord", children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chat-symbolic" }) }),
            /* @__PURE__ */ jsx2("button", { class: "ibtn tray-icon", valign: Gtk4.Align.CENTER, tooltipText: "Steam", children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-game-symbolic" }) }),
            /* @__PURE__ */ jsx2("button", { class: "ibtn tray-icon", valign: Gtk4.Align.CENTER, tooltipText: "Telegram", children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-paper-plane-symbolic" }) }),
            /* @__PURE__ */ jsx2("label", { class: "tn tray-lang", valign: Gtk4.Align.CENTER, label: "en" })
          ] }) : bind(Tray.get_default(), "items").as((items) => items.map((item) => /* @__PURE__ */ jsx2("menubutton", { tooltipText: item.tooltip_markup, menuModel: item.menu_model, children: /* @__PURE__ */ jsx2("image", { gicon: bind(item, "gicon") }) }))),
          /* @__PURE__ */ jsx2(StatusPill, {}),
          /* @__PURE__ */ jsx2(Bell, {}),
          /* @__PURE__ */ jsx2(
            "button",
            {
              class: "ibtn",
              valign: Gtk4.Align.CENTER,
              onClicked: () => app_default.toggle_window("session"),
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
    if (!focused) return void activate(
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
  return /* @__PURE__ */ jsx2("button", { class: "dbtn dwidget", onClicked: () => execAsync("playerctl play-pause"), children: /* @__PURE__ */ jsxs("overlay", { children: [
    /* @__PURE__ */ jsx2("box", { class: "dtile", children: /* @__PURE__ */ jsx2(
      "image",
      {
        class: "dg",
        iconName: "kobel-music-symbolic",
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
        value: 0.34
      }
    )
  ] }) });
}
var DEMO_APPS = [
  { name: "Terminal", icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Ptyxis.svg", dots: ["on", "dot"] },
  { name: "Files", icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Nautilus.svg", dots: ["dot"] },
  { name: "Firefox", icon: "/usr/share/icons/hicolor/256x256/apps/firefox.png", dots: [] },
  { name: "Zed", icon: "/home/kieran/.local/zed.app/share/icons/hicolor/512x512/apps/zed.png", dots: [] },
  { name: "Spotify", icon: "/var/lib/flatpak/exports/share/icons/hicolor/scalable/apps/com.spotify.Client.svg", dots: [] },
  { name: "Settings", icon: "/usr/share/icons/hicolor/scalable/apps/org.gnome.Settings.svg", dots: [] }
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
    /* @__PURE__ */ jsx2("box", { type: "overlay", class: "dots", halign: Gtk4.Align.CENTER, valign: Gtk4.Align.END, spacing: 3, children: app.dots.map((cls) => /* @__PURE__ */ jsx2("box", { class: cls === "on" ? "dot on" : "dot" })) })
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
          app ? /* @__PURE__ */ jsx2(DockButton, { app }) : /* @__PURE__ */ jsx2("button", { class: "dbtn placeholder", tooltipText: id.split(".").pop(), children: /* @__PURE__ */ jsx2("image", { class: "icon-tile", iconName: "application-x-executable-symbolic", pixelSize: 30 }) })
        ]),
        /* @__PURE__ */ jsx2("box", { class: "sep", valign: Gtk4.Align.CENTER }),
        /* @__PURE__ */ jsx2(MediaWidget, {})
      ] })
    }
  );
}

// ags/widget/Launcher.tsx
import Apps2 from "gi://AstalApps";

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
var now = DEMO ? new Date(D.today.y, D.today.m, D.today.d) : /* @__PURE__ */ new Date();
var key = (y, m, d) => `${y}-${m + 1}-${d}`;
var EVENTS = {
  [key(now.getFullYear(), now.getMonth(), now.getDate())]: [{ t: "09:45", n: "Daily Standup", icon: "kobel-video-symbolic" }],
  [key(now.getFullYear(), now.getMonth(), 11)]: [
    { t: "10:30", n: "Kieran Birthday", icon: "kobel-cake-symbolic" },
    { t: "13:00", n: "London Thing", icon: "kobel-pin-symbolic" }
  ],
  [key(now.getFullYear(), now.getMonth(), 13)]: [{ t: "All day", n: "My Birthday", icon: "kobel-cake-symbolic" }]
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
    rows.push(/* @__PURE__ */ jsx2("box", { homogeneous: true, children: ["", "M", "T", "W", "T", "F", "S", "S"].map((d) => /* @__PURE__ */ jsx2("label", { class: "dow", label: d })) }));
    for (let r = 0; r < 6; r++) {
      const cells = [/* @__PURE__ */ jsx2(
        "label",
        {
          class: "wk tn",
          label: `${isoWeek(new Date(v.y, v.m, r * 7 - start + 1))}`
        }
      )];
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
        cells.push(out ? /* @__PURE__ */ jsx2("label", { class: cls.join(" "), halign: Gtk4.Align.CENTER, label: `${label}` }) : /* @__PURE__ */ jsx2(
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
        ));
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
        label: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
      }
    );
    if (!evs.length) return [
      head,
      /* @__PURE__ */ jsxs("box", { spacing: 8, children: [
        /* @__PURE__ */ jsx2("image", { iconName: "kobel-calendar-symbolic" }),
        /* @__PURE__ */ jsx2("label", { class: "sub", label: "No events" })
      ] })
    ];
    return [head, ...evs.map((e) => /* @__PURE__ */ jsxs("box", { class: "evrow", spacing: 10, children: [
      /* @__PURE__ */ jsx2("box", { class: "evic", valign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("image", { iconName: e.icon }) }),
      /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, valign: Gtk4.Align.CENTER, children: [
        /* @__PURE__ */ jsx2("label", { halign: Gtk4.Align.START, label: e.n }),
        /* @__PURE__ */ jsx2("label", { class: "sub tn", halign: Gtk4.Align.START, label: e.t })
      ] })
    ] }))];
  }) });
}
function Calendar() {
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "calendar",
      namespace: "kobel-calendar",
      class: "calendar-window",
      visible: false,
      anchor: Astal6.WindowAnchor.TOP,
      exclusivity: Astal6.Exclusivity.NORMAL,
      keymode: Astal6.Keymode.ON_DEMAND,
      onKeyPressed: (self, key2) => key2 === Gdk2.KEY_Escape ? (self.hide(), true) : false,
      children: /* @__PURE__ */ jsxs("box", { class: "sheet cal", orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
        /* @__PURE__ */ jsxs("box", { class: "calhero", orientation: Gtk4.Orientation.VERTICAL, children: [
          /* @__PURE__ */ jsx2(
            "label",
            {
              class: "sub",
              halign: Gtk4.Align.START,
              label: now.toLocaleDateString("en-GB", { weekday: "long" })
            }
          ),
          /* @__PURE__ */ jsx2(
            "label",
            {
              class: "hero",
              halign: Gtk4.Align.START,
              label: now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("centerbox", { children: [
          /* @__PURE__ */ jsx2("button", { onClicked: () => {
            const v = view.get();
            view.set(v.m ? { y: v.y, m: v.m - 1 } : { y: v.y - 1, m: 11 });
          }, children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-left-symbolic" }) }),
          /* @__PURE__ */ jsx2("button", { class: "month", onClicked: () => view.set({ y: now.getFullYear(), m: now.getMonth() }), children: /* @__PURE__ */ jsx2("label", { label: bind(view).as((v) => new Date(v.y, v.m).toLocaleString("en", { month: "long" }) + (v.y !== now.getFullYear() ? ` ${v.y}` : "")) }) }),
          /* @__PURE__ */ jsx2("button", { onClicked: () => {
            const v = view.get();
            view.set(v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 });
          }, children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-right-symbolic" }) })
        ] }),
        /* @__PURE__ */ jsx2(Grid, {}),
        /* @__PURE__ */ jsx2(EventsCard, {})
      ] })
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
  if (DEMO) return DEMO_TILES.map(({ name, id }) => {
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
    run: () => app_default.toggle_window("session")
  },
  {
    n: "Restart",
    icon: "kobel-reload-symbolic",
    d: "Reboot the machine",
    al: ["reboot"],
    run: () => app_default.toggle_window("session")
  },
  {
    n: "Shut Down",
    icon: "kobel-power-symbolic",
    d: "Power off",
    al: ["poweroff", "halt"],
    run: () => app_default.toggle_window("session")
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
      return [{
        section: "gnoblinctl",
        rows: CMDS.filter((c) => c.c.startsWith(cq)).map((c) => ({
          name: `:${c.c}`,
          icon: "kobel-terminal-symbolic",
          hint: c.d,
          score: 99,
          markup: `:${c.c}`,
          run: () => execAsync(`gnoblinctl ${c.c}`)
        }))
      }];
    }
    const out = [];
    if (/^=?[0-9+\-*/(). ]+$/.test(qt) && /[0-9]/.test(qt) && /[+\-*/]/.test(qt)) {
      try {
        const v = Function(`"use strict";return(${qt.replace(/^=/, "")})`)();
        if (Number.isFinite(v)) out.push({
          section: "calculator",
          rows: [{
            name: String(v),
            icon: "kobel-calculator-symbolic",
            hint: `${qt.replace(/^=/, "")} =`,
            score: 98,
            markup: String(v),
            run: () => execAsync(["wl-copy", String(v)])
          }]
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
      if (!m) for (const al of x.al) {
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
      rows: [{
        name: `Search the web for \u201C${qt}\u201D`,
        icon: "kobel-globe-symbolic",
        hint: "",
        score: 0,
        markup: `Search the web for \u201C${qt}\u201D`,
        run: () => execAsync(["xdg-open", `https://duckduckgo.com/?q=${encodeURIComponent(qt)}`])
      }]
    });
    const g = out.flatMap((s) => s.rows).map((r) => r.name).find((n2) => n2.toLowerCase().startsWith(qt.toLowerCase()) && n2.length > qt.length);
    ghost.set(g ?? "");
    return out;
  }
  const sections = bind(query).as(results);
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "launcher",
      namespace: "kobel-launcher",
      class: "launcher-window",
      anchor: Astal6.WindowAnchor.TOP,
      exclusivity: Astal6.Exclusivity.NORMAL,
      keymode: Astal6.Keymode.EXCLUSIVE,
      visible: false,
      onKeyPressed: (self, key2, _code, mods) => {
        const flat = results(query.get()).flatMap((s) => s.rows);
        if (key2 === Gdk2.KEY_Escape) {
          if (query.get()) {
            query.set("");
            return true;
          }
          self.hide();
          return true;
        }
        if (key2 === Gdk2.KEY_Tab) {
          const g = ghost.get(), q = query.get();
          if (g && !(mods & Gdk2.ModifierType.SHIFT_MASK)) {
            query.set(g);
            return true;
          }
          selected.set((selected.get() + (mods & Gdk2.ModifierType.SHIFT_MASK ? -1 : 1) + flat.length) % Math.max(flat.length, 1));
          return true;
        }
        if (mods & Gdk2.ModifierType.CONTROL_MASK && (key2 === Gdk2.KEY_n || key2 === Gdk2.KEY_p)) {
          selected.set((selected.get() + (key2 === Gdk2.KEY_n ? 1 : -1) + flat.length) % Math.max(flat.length, 1));
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
          self.hide();
          query.set("");
          return true;
        }
        return false;
      },
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
          /* @__PURE__ */ jsx2("box", { class: "tiles", halign: Gtk4.Align.CENTER, spacing: 6, children: gridTiles(apps).map((t) => /* @__PURE__ */ jsx2("button", { class: "tile", onClicked: () => {
            t.launch();
            app_default.get_window("launcher")?.hide();
          }, children: /* @__PURE__ */ jsxs("box", { orientation: Gtk4.Orientation.VERTICAL, spacing: 8, halign: Gtk4.Align.CENTER, children: [
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
          ] }) })) }),
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
                  /* @__PURE__ */ jsx2("label", { class: "tn", halign: Gtk4.Align.START, label: todayDateLabel() }),
                  /* @__PURE__ */ jsx2("label", { class: "hint", halign: Gtk4.Align.START, label: todayEventLabel() })
                ]
              }
            ),
            /* @__PURE__ */ jsxs("box", { class: "widget lwm", hexpand: true, spacing: 10, children: [
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
                    /* @__PURE__ */ jsx2("label", { class: "mtitle", halign: Gtk4.Align.START, ellipsize: 3, label: D.media.title }),
                    /* @__PURE__ */ jsx2("label", { class: "hint", halign: Gtk4.Align.START, ellipsize: 3, label: D.media.artist })
                  ]
                }
              ),
              /* @__PURE__ */ jsx2(
                "button",
                {
                  class: "mbtn play",
                  valign: Gtk4.Align.CENTER,
                  onClicked: () => execAsync("playerctl play-pause"),
                  children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-play-symbolic" })
                }
              )
            ] })
          ] })
        ] }) }),
        /* @__PURE__ */ jsx2("box", { class: "lrows", orientation: Gtk4.Orientation.VERTICAL, spacing: 2, children: sections.as((secs) => secs.flatMap((sec) => [
          /* @__PURE__ */ jsx2("label", { class: "sec", halign: Gtk4.Align.START, label: sec.section }),
          ...sec.rows.map((r) => {
            const flatIdx = secs.flatMap((s) => s.rows).indexOf(r);
            return /* @__PURE__ */ jsx2(
              "button",
              {
                class: bind(selected).as((s) => s === flatIdx ? "row sel" : "row"),
                onClicked: () => {
                  r.run();
                  app_default.get_window("launcher")?.hide();
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
                      visible: bind(selected).as((s) => s === flatIdx)
                    }
                  )
                ] })
              }
            );
          })
        ])) }),
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
  );
}

// ags/widget/QuickSettings.tsx
import Network2 from "gi://AstalNetwork";
import Bluetooth from "gi://AstalBluetooth";
import Wp2 from "gi://AstalWp";

// ags/lib/tinyslider.ts
import GObject5 from "gi://GObject";
import Gtk7 from "gi://Gtk";
var TinySlider = GObject5.registerClass({
  GTypeName: "KobelTinyScale"
}, class TinySlider2 extends Gtk7.Scale {
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
});

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
  if (!DEMO && speaker) bind(speaker, "volume").subscribe((v) => {
    volSlider.get_adjustment().value = v;
  });
  volSlider.connect("change-value", (_s, _t, v) => {
    if (speaker) speaker.volume = v;
  });
  const brightSlider = new TinySlider({ hexpand: true, cssClasses: ["slider"], value: DEMO ? D.brightness : 0.8 });
  brightSlider.connect("change-value", (_s, _t, v) => execAsync(`brightnessctl set ${Math.round(v * 100)}%`));
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
      /* @__PURE__ */ jsx2("label", { class: "s", halign: Gtk4.Align.START, label: "osd + notifs handed back to gnome" })
    ] }),
    /* @__PURE__ */ jsx2("button", { class: "gbtn", label: "Reconnect", onClicked: () => reload().catch(() => {
    }) })
  ] });
}
var tSave = Variable(false);
var tDark = Variable(true);
var tSilent = Variable(false);
var tNight = Variable(false);
var editMode = Variable(false);
function ToggleChip(props) {
  return /* @__PURE__ */ jsx2(
    Chip,
    {
      id: props.label,
      label: props.label,
      icon: props.icon,
      active: bind(props.v),
      onToggled: () => props.v.set(!props.v.get())
    }
  );
}
function Root({ name }) {
  const net = Network2.get_default();
  const bt = Bluetooth.get_default();
  return /* @__PURE__ */ jsxs("box", { name, orientation: Gtk4.Orientation.VERTICAL, spacing: 0, children: [
    /* @__PURE__ */ jsxs("box", { class: "qs-top", spacing: 0, children: [
      /* @__PURE__ */ jsxs("box", { class: "meta", spacing: 6, valign: Gtk4.Align.CENTER, children: [
        /* @__PURE__ */ jsx2("image", { iconName: "kobel-battery-symbolic" }),
        /* @__PURE__ */ jsx2("label", { class: "tn", label: DEMO ? D.meta : "100% \xB7 Fully charged" })
      ] }),
      /* @__PURE__ */ jsx2("box", { hexpand: true }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn leaf", onClicked: () => reload(), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-leaf-symbolic" }) }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn", onClicked: () => execAsync("loginctl lock-session"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-lock-symbolic" }) }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn", onClicked: () => editMode.set(!editMode.get()), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-pencil-symbolic" }) }),
      /* @__PURE__ */ jsx2("button", { class: "rbtn danger", onClicked: () => app_default.toggle_window("session"), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-power-symbolic" }) })
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
            sub: DEMO ? D.btDevice : bind(bt, "devices").as((d) => d.find((x) => x.connected)?.alias ?? "Off"),
            onToggled: () => {
              if (!DEMO) bt.toggle();
            },
            onDrill: () => drill.set("bt")
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("box", { class: "chips", homogeneous: true, spacing: 8, children: [
        /* @__PURE__ */ jsx2(ToggleChip, { label: "Power Saver", icon: "kobel-bolt-symbolic", v: tSave }),
        /* @__PURE__ */ jsx2(ToggleChip, { label: "Dark Style", icon: "kobel-moon-symbolic", v: tDark })
      ] }),
      /* @__PURE__ */ jsxs("box", { class: "chips", homogeneous: true, spacing: 8, children: [
        /* @__PURE__ */ jsx2(ToggleChip, { label: "Silent", icon: "kobel-bell-slash-symbolic", v: tSilent }),
        /* @__PURE__ */ jsx2(ToggleChip, { label: "Night Light", icon: "kobel-sun-symbolic", v: tNight })
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
            /* @__PURE__ */ jsx2("label", { class: "xs", label: on ? "Connected" : `${ap.strength}%` })
          ] })
        }
      );
    });
  }) });
}
function BtList() {
  const bt = Bluetooth.get_default();
  return /* @__PURE__ */ jsx2("box", { class: "dlist", orientation: Gtk4.Orientation.VERTICAL, spacing: 2, children: bind(bt, "devices").as((devices) => devices.filter((d) => d.name || d.alias).sort((a, b) => Number(b.connected) - Number(a.connected)).slice(0, 6).map((dev) => {
    const on = dev.connected;
    return /* @__PURE__ */ jsx2(
      "button",
      {
        class: on ? "xrow active" : "xrow",
        onClicked: () => on ? dev.disconnect_device() : dev.connect_device(),
        children: /* @__PURE__ */ jsxs("box", { spacing: 10, children: [
          /* @__PURE__ */ jsx2("image", { iconName: "kobel-bluetooth-symbolic" }),
          /* @__PURE__ */ jsx2("label", { hexpand: true, halign: Gtk4.Align.START, label: dev.alias || dev.name }),
          /* @__PURE__ */ jsx2("label", { class: "xs", label: on ? "Connected" : dev.paired ? "Paired" : "Available" })
        ] })
      }
    );
  })) });
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
    bind(wp.audio, "streams").as((streams) => streams.slice(0, 5).map((s) => /* @__PURE__ */ jsx2(
      MixRow,
      {
        icon: "kobel-music-symbolic",
        title: s.description || s.name || "Application",
        target: s
      }
    )))
  ] });
}
function DrillView({ name }) {
  const net = Network2.get_default();
  return /* @__PURE__ */ jsxs("box", { name, orientation: Gtk4.Orientation.VERTICAL, spacing: 8, children: [
    /* @__PURE__ */ jsxs("centerbox", { class: "dhead", children: [
      /* @__PURE__ */ jsx2("button", { class: "ibtn", onClicked: () => drill.set(null), children: /* @__PURE__ */ jsx2("image", { iconName: "kobel-chevron-left-symbolic" }) }),
      /* @__PURE__ */ jsx2("label", { label: bind(drill).as((d) => d === "wifi" ? "Wi-Fi" : d === "bt" ? "Bluetooth" : "Volume") }),
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
    bind(drill).as((d) => d === "wifi" ? /* @__PURE__ */ jsx2(WifiList, {}) : d === "bt" ? /* @__PURE__ */ jsx2(BtList, {}) : d === "mix" ? /* @__PURE__ */ jsx2(MixList, {}) : /* @__PURE__ */ jsx2("box", {}))
  ] });
}
function QuickSettings() {
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "quicksettings",
      namespace: "kobel-qs",
      class: "qs-window",
      visible: false,
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.RIGHT,
      exclusivity: Astal6.Exclusivity.NORMAL,
      keymode: Astal6.Keymode.ON_DEMAND,
      onKeyPressed: (self, key2) => {
        if (key2 !== Gdk2.KEY_Escape) return false;
        if (drill.get()) {
          drill.set(null);
          return true;
        }
        self.hide();
        return true;
      },
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
  );
}

// ags/widget/Notifications.tsx
import Notifd2 from "gi://AstalNotifd";
import Mpris from "gi://AstalMpris";
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
        /* @__PURE__ */ jsx2("label", { class: "when tn", label: new Date(n2.time * 1e3).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) })
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
          children: bind(shown).as((ids) => ids.map((id) => {
            const n2 = nd().get_notification(id);
            return n2 ? /* @__PURE__ */ jsx2("box", { class: "toast", children: /* @__PURE__ */ jsx2(Card, { n: n2 }) }) : /* @__PURE__ */ jsx2("box", {});
          }))
        }
      )
    }
  );
}
function MediaCard() {
  let player = null;
  try {
    player = Mpris.get_default()?.players?.[0] ?? null;
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
    /* @__PURE__ */ jsx2("button", { onClicked: () => player.play_pause(), children: /* @__PURE__ */ jsx2("image", { iconName: bind(player, "playback_status").as((s) => s === Mpris.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic") }) }),
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
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "drawer",
      namespace: "kobel-drawer",
      class: "drawer-window",
      visible: false,
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.RIGHT | Astal6.WindowAnchor.BOTTOM,
      keymode: Astal6.Keymode.ON_DEMAND,
      setup: (self) => self.connect(
        "notify::visible",
        () => drawerOpen.set(self.visible)
      ),
      onKeyPressed: (self, key2) => key2 === Gdk2.KEY_Escape ? (self.hide(), true) : false,
      children: /* @__PURE__ */ jsxs("box", { class: "drawer", orientation: Gtk4.Orientation.VERTICAL, spacing: 8, children: [
        /* @__PURE__ */ jsx2(MediaCard, {}),
        /* @__PURE__ */ jsxs("box", { class: "nhead", spacing: 8, children: [
          /* @__PURE__ */ jsx2("label", { hexpand: true, halign: Gtk4.Align.START, label: "Notifications" }),
          /* @__PURE__ */ jsx2("label", { class: "tn sub", label: bind(list).as((n2) => `${n2.length || ""}`) }),
          /* @__PURE__ */ jsx2("button", { class: "nclear", onClicked: () => nfd.get_notifications().forEach((n2) => n2.dismiss()), children: /* @__PURE__ */ jsxs("box", { spacing: 5, children: [
            /* @__PURE__ */ jsx2("image", { iconName: "kobel-trash-symbolic" }),
            /* @__PURE__ */ jsx2("label", { label: "Clear" })
          ] }) })
        ] }),
        /* @__PURE__ */ jsx2("box", { orientation: Gtk4.Orientation.VERTICAL, spacing: 8, vexpand: true, children: bind(list).as((ns) => ns && ns.length ? ns.map((n2) => /* @__PURE__ */ jsx2(Card, { n: n2 })) : [/* @__PURE__ */ jsx2("box", { class: "ncard empty", halign: Gtk4.Align.CENTER, children: /* @__PURE__ */ jsx2("label", { label: "All caught up \u2713" }) })]) })
      ] })
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
        /* @__PURE__ */ jsx2("label", { class: "tn", label: bind(speaker, "volume").as((v) => `${Math.round(v * 100)}%`) })
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
  const press = (a, hide) => {
    if (a.confirm && armed.get() !== a.id) {
      armed.set(a.id);
      revert?.cancel();
      revert = timeout(4e3, () => armed.set(null));
      return;
    }
    armed.set(null);
    hide();
    a.run();
  };
  return /* @__PURE__ */ jsx2(
    "window",
    {
      name: "session",
      namespace: "kobel-session",
      class: "session-window",
      visible: false,
      anchor: Astal6.WindowAnchor.TOP | Astal6.WindowAnchor.BOTTOM | Astal6.WindowAnchor.LEFT | Astal6.WindowAnchor.RIGHT,
      keymode: Astal6.Keymode.EXCLUSIVE,
      exclusivity: Astal6.Exclusivity.IGNORE,
      onKeyPressed: (self, key2) => {
        if (key2 === Gdk2.KEY_Escape) {
          armed.set(null);
          self.hide();
          return true;
        }
        return false;
      },
      children: /* @__PURE__ */ jsx2("box", { class: "session", hexpand: true, vexpand: true, children: /* @__PURE__ */ jsx2("box", { halign: Gtk4.Align.CENTER, valign: Gtk4.Align.CENTER, spacing: 20, hexpand: true, children: ACTIONS2.map((a) => /* @__PURE__ */ jsx2(
        "button",
        {
          class: a.red ? "sbtn red" : "sbtn",
          onClicked: (self) => press(a, () => self.get_root()?.hide?.()),
          children: /* @__PURE__ */ jsxs(
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
                /* @__PURE__ */ jsx2("label", { label: bind(armed).as((x) => x === a.id ? "Press again" : a.label) })
              ]
            }
          )
        }
      )) }) })
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
      app_default.toggle_window(arg);
      return res("ok");
    }
    if (cmd === "reload-css") {
      app_default.apply_css(main_default + tokenCss(tokens), true);
      return res("ok");
    }
    res("unknown");
  }
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYWdzL2FwcC50cyIsICJzYXNzOi9ob21lL2tpZXJhbi9kZXYva29iZWwtc2hlbGwvYWdzL3N0eWxlL21haW4uc2NzcyIsICIuLi9hZ3MvY29uZmlnLnRzIiwgIi4uL2Fncy9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9hZ3Mvc2VydmljZXMvbm90aWZkLnRzIiwgIi4uL2Fncy9saWIvaW5zcGVjdC50cyIsICIuLi9hZ3Mvd2lkZ2V0L0Jhci50c3giLCAiLi4vYWdzL2xpYi9kZW1vLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrMy93aWRnZXQudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGszL2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrMy9qc3gtcnVudGltZS50cyIsICIuLi9hZ3Mvd2lkZ2V0L0RvY2sudHN4IiwgIi4uL2Fncy93aWRnZXQvTGF1bmNoZXIudHN4IiwgIi4uL2Fncy9saWIvZnV6enkudHMiLCAiLi4vYWdzL3dpZGdldC9DYWxlbmRhci50c3giLCAiLi4vYWdzL3dpZGdldC9RdWlja1NldHRpbmdzLnRzeCIsICIuLi9hZ3MvbGliL3RpbnlzbGlkZXIudHMiLCAiLi4vYWdzL3dpZGdldC9Ob3RpZmljYXRpb25zLnRzeCIsICIuLi9hZ3Mvd2lkZ2V0L09TRC50c3giLCAiLi4vYWdzL3dpZGdldC9TZXNzaW9uLnRzeCJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBhc3RhbGlmeSwgeyB0eXBlIENvbnN0cnVjdFByb3BzIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuXG5leHBvcnQgeyBBc3RhbCwgR3RrLCBHZGsgfVxuZXhwb3J0IHsgZGVmYXVsdCBhcyBBcHAgfSBmcm9tIFwiLi9hcHAuanNcIlxuZXhwb3J0IHsgYXN0YWxpZnksIENvbnN0cnVjdFByb3BzIH1cbmV4cG9ydCAqIGFzIFdpZGdldCBmcm9tIFwiLi93aWRnZXQuanNcIlxuZXhwb3J0IHsgaG9vayB9IGZyb20gXCIuLi9fYXN0YWxcIlxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBCaW5kaW5nLCB7IHR5cGUgQ29ubmVjdGFibGUsIHR5cGUgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5pbXBvcnQgeyBpbnRlcnZhbCB9IGZyb20gXCIuL3RpbWUuanNcIlxuaW1wb3J0IHsgZXhlY0FzeW5jLCBzdWJwcm9jZXNzIH0gZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5cbmNsYXNzIFZhcmlhYmxlV3JhcHBlcjxUPiBleHRlbmRzIEZ1bmN0aW9uIHtcbiAgICBwcml2YXRlIHZhcmlhYmxlITogQXN0YWwuVmFyaWFibGVCYXNlXG4gICAgcHJpdmF0ZSBlcnJIYW5kbGVyPyA9IGNvbnNvbGUuZXJyb3JcblxuICAgIHByaXZhdGUgX3ZhbHVlOiBUXG4gICAgcHJpdmF0ZSBfcG9sbD86IEFzdGFsLlRpbWVcbiAgICBwcml2YXRlIF93YXRjaD86IEFzdGFsLlByb2Nlc3NcblxuICAgIHByaXZhdGUgcG9sbEludGVydmFsID0gMTAwMFxuICAgIHByaXZhdGUgcG9sbEV4ZWM/OiBzdHJpbmdbXSB8IHN0cmluZ1xuICAgIHByaXZhdGUgcG9sbFRyYW5zZm9ybT86IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVFxuICAgIHByaXZhdGUgcG9sbEZuPzogKHByZXY6IFQpID0+IFQgfCBQcm9taXNlPFQ+XG5cbiAgICBwcml2YXRlIHdhdGNoVHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgcHJpdmF0ZSB3YXRjaEV4ZWM/OiBzdHJpbmdbXSB8IHN0cmluZ1xuXG4gICAgY29uc3RydWN0b3IoaW5pdDogVCkge1xuICAgICAgICBzdXBlcigpXG4gICAgICAgIHRoaXMuX3ZhbHVlID0gaW5pdFxuICAgICAgICB0aGlzLnZhcmlhYmxlID0gbmV3IEFzdGFsLlZhcmlhYmxlQmFzZSgpXG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImRyb3BwZWRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdG9wV2F0Y2goKVxuICAgICAgICAgICAgdGhpcy5zdG9wUG9sbCgpXG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImVycm9yXCIsIChfLCBlcnIpID0+IHRoaXMuZXJySGFuZGxlcj8uKGVycikpXG4gICAgICAgIHJldHVybiBuZXcgUHJveHkodGhpcywge1xuICAgICAgICAgICAgYXBwbHk6ICh0YXJnZXQsIF8sIGFyZ3MpID0+IHRhcmdldC5fY2FsbChhcmdzWzBdKSxcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwcml2YXRlIF9jYWxsPFIgPSBUPih0cmFuc2Zvcm0/OiAodmFsdWU6IFQpID0+IFIpOiBCaW5kaW5nPFI+IHtcbiAgICAgICAgY29uc3QgYiA9IEJpbmRpbmcuYmluZCh0aGlzKVxuICAgICAgICByZXR1cm4gdHJhbnNmb3JtID8gYi5hcyh0cmFuc2Zvcm0pIDogYiBhcyB1bmtub3duIGFzIEJpbmRpbmc8Uj5cbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhgVmFyaWFibGU8JHt0aGlzLmdldCgpfT5gKVxuICAgIH1cblxuICAgIGdldCgpOiBUIHsgcmV0dXJuIHRoaXMuX3ZhbHVlIH1cbiAgICBzZXQodmFsdWU6IFQpIHtcbiAgICAgICAgaWYgKHZhbHVlICE9PSB0aGlzLl92YWx1ZSkge1xuICAgICAgICAgICAgdGhpcy5fdmFsdWUgPSB2YWx1ZVxuICAgICAgICAgICAgdGhpcy52YXJpYWJsZS5lbWl0KFwiY2hhbmdlZFwiKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc3RhcnRQb2xsKCkge1xuICAgICAgICBpZiAodGhpcy5fcG9sbClcbiAgICAgICAgICAgIHJldHVyblxuXG4gICAgICAgIGlmICh0aGlzLnBvbGxGbikge1xuICAgICAgICAgICAgdGhpcy5fcG9sbCA9IGludGVydmFsKHRoaXMucG9sbEludGVydmFsLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdiA9IHRoaXMucG9sbEZuISh0aGlzLmdldCgpKVxuICAgICAgICAgICAgICAgIGlmICh2IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICAgICAgICB2LnRoZW4odiA9PiB0aGlzLnNldCh2KSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSlcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnNldCh2KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5wb2xsRXhlYykge1xuICAgICAgICAgICAgdGhpcy5fcG9sbCA9IGludGVydmFsKHRoaXMucG9sbEludGVydmFsLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgZXhlY0FzeW5jKHRoaXMucG9sbEV4ZWMhKVxuICAgICAgICAgICAgICAgICAgICAudGhlbih2ID0+IHRoaXMuc2V0KHRoaXMucG9sbFRyYW5zZm9ybSEodiwgdGhpcy5nZXQoKSkpKVxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVycikpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc3RhcnRXYXRjaCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3dhdGNoKVxuICAgICAgICAgICAgcmV0dXJuXG5cbiAgICAgICAgdGhpcy5fd2F0Y2ggPSBzdWJwcm9jZXNzKHtcbiAgICAgICAgICAgIGNtZDogdGhpcy53YXRjaEV4ZWMhLFxuICAgICAgICAgICAgb3V0OiBvdXQgPT4gdGhpcy5zZXQodGhpcy53YXRjaFRyYW5zZm9ybSEob3V0LCB0aGlzLmdldCgpKSksXG4gICAgICAgICAgICBlcnI6IGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpLFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHN0b3BQb2xsKCkge1xuICAgICAgICB0aGlzLl9wb2xsPy5jYW5jZWwoKVxuICAgICAgICBkZWxldGUgdGhpcy5fcG9sbFxuICAgIH1cblxuICAgIHN0b3BXYXRjaCgpIHtcbiAgICAgICAgdGhpcy5fd2F0Y2g/LmtpbGwoKVxuICAgICAgICBkZWxldGUgdGhpcy5fd2F0Y2hcbiAgICB9XG5cbiAgICBpc1BvbGxpbmcoKSB7IHJldHVybiAhIXRoaXMuX3BvbGwgfVxuICAgIGlzV2F0Y2hpbmcoKSB7IHJldHVybiAhIXRoaXMuX3dhdGNoIH1cblxuICAgIGRyb3AoKSB7XG4gICAgICAgIHRoaXMudmFyaWFibGUuZW1pdChcImRyb3BwZWRcIilcbiAgICB9XG5cbiAgICBvbkRyb3BwZWQoY2FsbGJhY2s6ICgpID0+IHZvaWQpIHtcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZHJvcHBlZFwiLCBjYWxsYmFjaylcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIG9uRXJyb3IoY2FsbGJhY2s6IChlcnI6IHN0cmluZykgPT4gdm9pZCkge1xuICAgICAgICBkZWxldGUgdGhpcy5lcnJIYW5kbGVyXG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImVycm9yXCIsIChfLCBlcnIpID0+IGNhbGxiYWNrKGVycikpXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVCkgPT4gdm9pZCkge1xuICAgICAgICBjb25zdCBpZCA9IHRoaXMudmFyaWFibGUuY29ubmVjdChcImNoYW5nZWRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY2FsbGJhY2sodGhpcy5nZXQoKSlcbiAgICAgICAgfSlcbiAgICAgICAgcmV0dXJuICgpID0+IHRoaXMudmFyaWFibGUuZGlzY29ubmVjdChpZClcbiAgICB9XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICAgICAgdHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGNhbGxiYWNrOiAocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD5cbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgZXhlYzogc3RyaW5nIHwgc3RyaW5nW10gfCAoKHByZXY6IFQpID0+IFQgfCBQcm9taXNlPFQ+KSxcbiAgICAgICAgdHJhbnNmb3JtOiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFQgPSBvdXQgPT4gb3V0IGFzIFQsXG4gICAgKSB7XG4gICAgICAgIHRoaXMuc3RvcFBvbGwoKVxuICAgICAgICB0aGlzLnBvbGxJbnRlcnZhbCA9IGludGVydmFsXG4gICAgICAgIHRoaXMucG9sbFRyYW5zZm9ybSA9IHRyYW5zZm9ybVxuICAgICAgICBpZiAodHlwZW9mIGV4ZWMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhpcy5wb2xsRm4gPSBleGVjXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5wb2xsRXhlY1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5wb2xsRXhlYyA9IGV4ZWNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBvbGxGblxuICAgICAgICB9XG4gICAgICAgIHRoaXMuc3RhcnRQb2xsKClcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHdhdGNoKFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICAgICAgdHJhbnNmb3JtOiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFQgPSBvdXQgPT4gb3V0IGFzIFQsXG4gICAgKSB7XG4gICAgICAgIHRoaXMuc3RvcFdhdGNoKClcbiAgICAgICAgdGhpcy53YXRjaEV4ZWMgPSBleGVjXG4gICAgICAgIHRoaXMud2F0Y2hUcmFuc2Zvcm0gPSB0cmFuc2Zvcm1cbiAgICAgICAgdGhpcy5zdGFydFdhdGNoKClcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9ianM6IEFycmF5PFtvYmo6IENvbm5lY3RhYmxlLCBzaWduYWw6IHN0cmluZ10+LFxuICAgICAgICBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmo6IENvbm5lY3RhYmxlLFxuICAgICAgICBzaWduYWw6IHN0cmluZyxcbiAgICAgICAgY2FsbGJhY2s6ICguLi5hcmdzOiBhbnlbXSkgPT4gVCxcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqczogQ29ubmVjdGFibGUgfCBBcnJheTxbb2JqOiBDb25uZWN0YWJsZSwgc2lnbmFsOiBzdHJpbmddPixcbiAgICAgICAgc2lnT3JGbjogc3RyaW5nIHwgKChvYmo6IENvbm5lY3RhYmxlLCAuLi5hcmdzOiBhbnlbXSkgPT4gVCksXG4gICAgICAgIGNhbGxiYWNrPzogKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICkge1xuICAgICAgICBjb25zdCBmID0gdHlwZW9mIHNpZ09yRm4gPT09IFwiZnVuY3Rpb25cIiA/IHNpZ09yRm4gOiBjYWxsYmFjayA/PyAoKCkgPT4gdGhpcy5nZXQoKSlcbiAgICAgICAgY29uc3Qgc2V0ID0gKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiB0aGlzLnNldChmKG9iaiwgLi4uYXJncykpXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob2JqcykpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgb2JqIG9mIG9ianMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBbbywgc10gPSBvYmpcbiAgICAgICAgICAgICAgICBjb25zdCBpZCA9IG8uY29ubmVjdChzLCBzZXQpXG4gICAgICAgICAgICAgICAgdGhpcy5vbkRyb3BwZWQoKCkgPT4gby5kaXNjb25uZWN0KGlkKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2lnT3JGbiA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gb2Jqcy5jb25uZWN0KHNpZ09yRm4sIHNldClcbiAgICAgICAgICAgICAgICB0aGlzLm9uRHJvcHBlZCgoKSA9PiBvYmpzLmRpc2Nvbm5lY3QoaWQpKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHN0YXRpYyBkZXJpdmU8XG4gICAgICAgIGNvbnN0IERlcHMgZXh0ZW5kcyBBcnJheTxTdWJzY3JpYmFibGU8YW55Pj4sXG4gICAgICAgIEFyZ3MgZXh0ZW5kcyB7XG4gICAgICAgICAgICBbSyBpbiBrZXlvZiBEZXBzXTogRGVwc1tLXSBleHRlbmRzIFN1YnNjcmliYWJsZTxpbmZlciBUPiA/IFQgOiBuZXZlclxuICAgICAgICB9LFxuICAgICAgICBWID0gQXJncyxcbiAgICA+KGRlcHM6IERlcHMsIGZuOiAoLi4uYXJnczogQXJncykgPT4gViA9ICguLi5hcmdzKSA9PiBhcmdzIGFzIHVua25vd24gYXMgVikge1xuICAgICAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiBmbiguLi5kZXBzLm1hcChkID0+IGQuZ2V0KCkpIGFzIEFyZ3MpXG4gICAgICAgIGNvbnN0IGRlcml2ZWQgPSBuZXcgVmFyaWFibGUodXBkYXRlKCkpXG4gICAgICAgIGNvbnN0IHVuc3VicyA9IGRlcHMubWFwKGRlcCA9PiBkZXAuc3Vic2NyaWJlKCgpID0+IGRlcml2ZWQuc2V0KHVwZGF0ZSgpKSkpXG4gICAgICAgIGRlcml2ZWQub25Ecm9wcGVkKCgpID0+IHVuc3Vicy5tYXAodW5zdWIgPT4gdW5zdWIoKSkpXG4gICAgICAgIHJldHVybiBkZXJpdmVkXG4gICAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFZhcmlhYmxlPFQ+IGV4dGVuZHMgT21pdDxWYXJpYWJsZVdyYXBwZXI8VD4sIFwiYmluZFwiPiB7XG4gICAgPFI+KHRyYW5zZm9ybTogKHZhbHVlOiBUKSA9PiBSKTogQmluZGluZzxSPlxuICAgICgpOiBCaW5kaW5nPFQ+XG59XG5cbmV4cG9ydCBjb25zdCBWYXJpYWJsZSA9IG5ldyBQcm94eShWYXJpYWJsZVdyYXBwZXIgYXMgYW55LCB7XG4gICAgYXBwbHk6IChfdCwgX2EsIGFyZ3MpID0+IG5ldyBWYXJpYWJsZVdyYXBwZXIoYXJnc1swXSksXG59KSBhcyB7XG4gICAgZGVyaXZlOiB0eXBlb2YgVmFyaWFibGVXcmFwcGVyW1wiZGVyaXZlXCJdXG4gICAgPFQ+KGluaXQ6IFQpOiBWYXJpYWJsZTxUPlxuICAgIG5ldzxUPihpbml0OiBUKTogVmFyaWFibGU8VD5cbn1cblxuZXhwb3J0IGNvbnN0IHsgZGVyaXZlIH0gPSBWYXJpYWJsZVxuZXhwb3J0IGRlZmF1bHQgVmFyaWFibGVcbiIsICJleHBvcnQgY29uc3Qgc25ha2VpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxXyQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbmV4cG9ydCBjb25zdCBrZWJhYmlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDEtJDJcIilcbiAgICAucmVwbGFjZUFsbChcIl9cIiwgXCItXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuZXhwb3J0IGludGVyZmFjZSBTdWJzY3JpYmFibGU8VCA9IHVua25vd24+IHtcbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVCkgPT4gdm9pZCk6ICgpID0+IHZvaWRcbiAgICBnZXQoKTogVFxuICAgIFtrZXk6IHN0cmluZ106IGFueVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbm5lY3RhYmxlIHtcbiAgICBjb25uZWN0KHNpZ25hbDogc3RyaW5nLCBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiB1bmtub3duKTogbnVtYmVyXG4gICAgZGlzY29ubmVjdChpZDogbnVtYmVyKTogdm9pZFxuICAgIFtrZXk6IHN0cmluZ106IGFueVxufVxuXG5leHBvcnQgY2xhc3MgQmluZGluZzxWYWx1ZT4ge1xuICAgIHByaXZhdGUgdHJhbnNmb3JtRm4gPSAodjogYW55KSA9PiB2XG5cbiAgICAjZW1pdHRlcjogU3Vic2NyaWJhYmxlPFZhbHVlPiB8IENvbm5lY3RhYmxlXG4gICAgI3Byb3A/OiBzdHJpbmdcblxuICAgIHN0YXRpYyBiaW5kPFxuICAgICAgICBUIGV4dGVuZHMgQ29ubmVjdGFibGUsXG4gICAgICAgIFAgZXh0ZW5kcyBrZXlvZiBULFxuICAgID4ob2JqZWN0OiBULCBwcm9wZXJ0eTogUCk6IEJpbmRpbmc8VFtQXT5cblxuICAgIHN0YXRpYyBiaW5kPFQ+KG9iamVjdDogU3Vic2NyaWJhYmxlPFQ+KTogQmluZGluZzxUPlxuXG4gICAgc3RhdGljIGJpbmQoZW1pdHRlcjogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGUsIHByb3A/OiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBCaW5kaW5nKGVtaXR0ZXIsIHByb3ApXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihlbWl0dGVyOiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZTxWYWx1ZT4sIHByb3A/OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy4jZW1pdHRlciA9IGVtaXR0ZXJcbiAgICAgICAgdGhpcy4jcHJvcCA9IHByb3AgJiYga2ViYWJpZnkocHJvcClcbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIGBCaW5kaW5nPCR7dGhpcy4jZW1pdHRlcn0ke3RoaXMuI3Byb3AgPyBgLCBcIiR7dGhpcy4jcHJvcH1cImAgOiBcIlwifT5gXG4gICAgfVxuXG4gICAgYXM8VD4oZm46ICh2OiBWYWx1ZSkgPT4gVCk6IEJpbmRpbmc8VD4ge1xuICAgICAgICBjb25zdCBiaW5kID0gbmV3IEJpbmRpbmcodGhpcy4jZW1pdHRlciwgdGhpcy4jcHJvcClcbiAgICAgICAgYmluZC50cmFuc2Zvcm1GbiA9ICh2OiBWYWx1ZSkgPT4gZm4odGhpcy50cmFuc2Zvcm1Gbih2KSlcbiAgICAgICAgcmV0dXJuIGJpbmQgYXMgdW5rbm93biBhcyBCaW5kaW5nPFQ+XG4gICAgfVxuXG4gICAgZ2V0KCk6IFZhbHVlIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLmdldCA9PT0gXCJmdW5jdGlvblwiKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlci5nZXQoKSlcblxuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI3Byb3AgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGdldHRlciA9IGBnZXRfJHtzbmFrZWlmeSh0aGlzLiNwcm9wKX1gXG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXJbZ2V0dGVyXSA9PT0gXCJmdW5jdGlvblwiKVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXJbZ2V0dGVyXSgpKVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyW3RoaXMuI3Byb3BdKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgRXJyb3IoXCJjYW4gbm90IGdldCB2YWx1ZSBvZiBiaW5kaW5nXCIpXG4gICAgfVxuXG4gICAgc3Vic2NyaWJlKGNhbGxiYWNrOiAodmFsdWU6IFZhbHVlKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlci5zdWJzY3JpYmUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuI2VtaXR0ZXIuc3Vic2NyaWJlKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlci5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpZ25hbCA9IGBub3RpZnk6OiR7dGhpcy4jcHJvcH1gXG4gICAgICAgICAgICBjb25zdCBpZCA9IHRoaXMuI2VtaXR0ZXIuY29ubmVjdChzaWduYWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgKHRoaXMuI2VtaXR0ZXIuZGlzY29ubmVjdCBhcyBDb25uZWN0YWJsZVtcImRpc2Nvbm5lY3RcIl0pKGlkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRocm93IEVycm9yKGAke3RoaXMuI2VtaXR0ZXJ9IGlzIG5vdCBiaW5kYWJsZWApXG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QgeyBiaW5kIH0gPSBCaW5kaW5nXG5leHBvcnQgZGVmYXVsdCBCaW5kaW5nXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuXG5leHBvcnQgdHlwZSBUaW1lID0gQXN0YWwuVGltZVxuZXhwb3J0IGNvbnN0IFRpbWUgPSBBc3RhbC5UaW1lXG5cbmV4cG9ydCBmdW5jdGlvbiBpbnRlcnZhbChpbnRlcnZhbDogbnVtYmVyLCBjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS5pbnRlcnZhbChpbnRlcnZhbCwgKCkgPT4gdm9pZCBjYWxsYmFjaz8uKCkpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0KHRpbWVvdXQ6IG51bWJlciwgY2FsbGJhY2s/OiAoKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIEFzdGFsLlRpbWUudGltZW91dCh0aW1lb3V0LCAoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlkbGUoY2FsbGJhY2s/OiAoKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIEFzdGFsLlRpbWUuaWRsZSgoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5cbnR5cGUgQXJncyA9IHtcbiAgICBjbWQ6IHN0cmluZyB8IHN0cmluZ1tdXG4gICAgb3V0PzogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkXG4gICAgZXJyPzogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkXG59XG5cbmV4cG9ydCB0eXBlIFByb2Nlc3MgPSBBc3RhbC5Qcm9jZXNzXG5leHBvcnQgY29uc3QgUHJvY2VzcyA9IEFzdGFsLlByb2Nlc3NcblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnByb2Nlc3MoYXJnczogQXJncyk6IEFzdGFsLlByb2Nlc3NcblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnByb2Nlc3MoXG4gICAgY21kOiBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICBvbk91dD86IChzdGRvdXQ6IHN0cmluZykgPT4gdm9pZCxcbiAgICBvbkVycj86IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZCxcbik6IEFzdGFsLlByb2Nlc3NcblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnByb2Nlc3MoXG4gICAgYXJnc09yQ21kOiBBcmdzIHwgc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgb25PdXQ6IChzdGRvdXQ6IHN0cmluZykgPT4gdm9pZCA9IHByaW50LFxuICAgIG9uRXJyOiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWQgPSBwcmludGVycixcbikge1xuICAgIGNvbnN0IGFyZ3MgPSBBcnJheS5pc0FycmF5KGFyZ3NPckNtZCkgfHwgdHlwZW9mIGFyZ3NPckNtZCA9PT0gXCJzdHJpbmdcIlxuICAgIGNvbnN0IHsgY21kLCBlcnIsIG91dCB9ID0ge1xuICAgICAgICBjbWQ6IGFyZ3MgPyBhcmdzT3JDbWQgOiBhcmdzT3JDbWQuY21kLFxuICAgICAgICBlcnI6IGFyZ3MgPyBvbkVyciA6IGFyZ3NPckNtZC5lcnIgfHwgb25FcnIsXG4gICAgICAgIG91dDogYXJncyA/IG9uT3V0IDogYXJnc09yQ21kLm91dCB8fCBvbk91dCxcbiAgICB9XG5cbiAgICBjb25zdCBwcm9jID0gQXJyYXkuaXNBcnJheShjbWQpXG4gICAgICAgID8gQXN0YWwuUHJvY2Vzcy5zdWJwcm9jZXNzdihjbWQpXG4gICAgICAgIDogQXN0YWwuUHJvY2Vzcy5zdWJwcm9jZXNzKGNtZClcblxuICAgIHByb2MuY29ubmVjdChcInN0ZG91dFwiLCAoXywgc3Rkb3V0OiBzdHJpbmcpID0+IG91dChzdGRvdXQpKVxuICAgIHByb2MuY29ubmVjdChcInN0ZGVyclwiLCAoXywgc3RkZXJyOiBzdHJpbmcpID0+IGVycihzdGRlcnIpKVxuICAgIHJldHVybiBwcm9jXG59XG5cbi8qKiBAdGhyb3dzIHtHTGliLkVycm9yfSBUaHJvd3Mgc3RkZXJyICovXG5leHBvcnQgZnVuY3Rpb24gZXhlYyhjbWQ6IHN0cmluZyB8IHN0cmluZ1tdKSB7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoY21kKVxuICAgICAgICA/IEFzdGFsLlByb2Nlc3MuZXhlY3YoY21kKVxuICAgICAgICA6IEFzdGFsLlByb2Nlc3MuZXhlYyhjbWQpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBleGVjQXN5bmMoY21kOiBzdHJpbmcgfCBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY21kKSkge1xuICAgICAgICAgICAgQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jdihjbWQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLlByb2Nlc3MuZXhlY19hc3luY3ZfZmluaXNoKHJlcykpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmMoY21kLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5Qcm9jZXNzLmV4ZWNfZmluaXNoKHJlcykpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgImltcG9ydCBWYXJpYWJsZSBmcm9tIFwiLi92YXJpYWJsZS5qc1wiXG5pbXBvcnQgeyBleGVjQXN5bmMgfSBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcbmltcG9ydCBCaW5kaW5nLCB7IENvbm5lY3RhYmxlLCBrZWJhYmlmeSwgc25ha2VpZnksIFN1YnNjcmliYWJsZSB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgY29uc3Qgbm9JbXBsaWNpdERlc3Ryb3kgPSBTeW1ib2woXCJubyBubyBpbXBsaWNpdCBkZXN0cm95XCIpXG5leHBvcnQgY29uc3Qgc2V0Q2hpbGRyZW4gPSBTeW1ib2woXCJjaGlsZHJlbiBzZXR0ZXIgbWV0aG9kXCIpXG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUJpbmRpbmdzKGFycmF5OiBhbnlbXSkge1xuICAgIGZ1bmN0aW9uIGdldFZhbHVlcyguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICBsZXQgaSA9IDBcbiAgICAgICAgcmV0dXJuIGFycmF5Lm1hcCh2YWx1ZSA9PiB2YWx1ZSBpbnN0YW5jZW9mIEJpbmRpbmdcbiAgICAgICAgICAgID8gYXJnc1tpKytdXG4gICAgICAgICAgICA6IHZhbHVlLFxuICAgICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgYmluZGluZ3MgPSBhcnJheS5maWx0ZXIoaSA9PiBpIGluc3RhbmNlb2YgQmluZGluZylcblxuICAgIGlmIChiaW5kaW5ncy5sZW5ndGggPT09IDApXG4gICAgICAgIHJldHVybiBhcnJheVxuXG4gICAgaWYgKGJpbmRpbmdzLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgcmV0dXJuIGJpbmRpbmdzWzBdLmFzKGdldFZhbHVlcylcblxuICAgIHJldHVybiBWYXJpYWJsZS5kZXJpdmUoYmluZGluZ3MsIGdldFZhbHVlcykoKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0UHJvcChvYmo6IGFueSwgcHJvcDogc3RyaW5nLCB2YWx1ZTogYW55KSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc2V0dGVyID0gYHNldF8ke3NuYWtlaWZ5KHByb3ApfWBcbiAgICAgICAgaWYgKHR5cGVvZiBvYmpbc2V0dGVyXSA9PT0gXCJmdW5jdGlvblwiKVxuICAgICAgICAgICAgcmV0dXJuIG9ialtzZXR0ZXJdKHZhbHVlKVxuXG4gICAgICAgIHJldHVybiAob2JqW3Byb3BdID0gdmFsdWUpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgY291bGQgbm90IHNldCBwcm9wZXJ0eSBcIiR7cHJvcH1cIiBvbiAke29ian06YCwgZXJyb3IpXG4gICAgfVxufVxuXG5leHBvcnQgdHlwZSBCaW5kYWJsZVByb3BzPFQ+ID0ge1xuICAgIFtLIGluIGtleW9mIFRdOiBCaW5kaW5nPFRbS10+IHwgVFtLXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhvb2s8V2lkZ2V0IGV4dGVuZHMgQ29ubmVjdGFibGU+KFxuICAgIHdpZGdldDogV2lkZ2V0LFxuICAgIG9iamVjdDogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGUsXG4gICAgc2lnbmFsT3JDYWxsYmFjazogc3RyaW5nIHwgKChzZWxmOiBXaWRnZXQsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkKSxcbiAgICBjYWxsYmFjaz86IChzZWxmOiBXaWRnZXQsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuKSB7XG4gICAgaWYgKHR5cGVvZiBvYmplY3QuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiICYmIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGlkID0gb2JqZWN0LmNvbm5lY3Qoc2lnbmFsT3JDYWxsYmFjaywgKF86IGFueSwgLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2sod2lkZ2V0LCAuLi5hcmdzKVxuICAgICAgICB9KVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgKCkgPT4ge1xuICAgICAgICAgICAgKG9iamVjdC5kaXNjb25uZWN0IGFzIENvbm5lY3RhYmxlW1wiZGlzY29ubmVjdFwiXSkoaWQpXG4gICAgICAgIH0pXG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygb2JqZWN0LnN1YnNjcmliZSA9PT0gXCJmdW5jdGlvblwiICYmIHR5cGVvZiBzaWduYWxPckNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY29uc3QgdW5zdWIgPSBvYmplY3Quc3Vic2NyaWJlKCguLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICAgICAgICAgIHNpZ25hbE9yQ2FsbGJhY2sod2lkZ2V0LCAuLi5hcmdzKVxuICAgICAgICB9KVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgdW5zdWIpXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29uc3RydWN0PFdpZGdldCBleHRlbmRzIENvbm5lY3RhYmxlICYgeyBbc2V0Q2hpbGRyZW5dOiAoY2hpbGRyZW46IGFueVtdKSA9PiB2b2lkIH0+KHdpZGdldDogV2lkZ2V0LCBjb25maWc6IGFueSkge1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBwcmVmZXItY29uc3RcbiAgICBsZXQgeyBzZXR1cCwgY2hpbGQsIGNoaWxkcmVuID0gW10sIC4uLnByb3BzIH0gPSBjb25maWdcblxuICAgIGlmIChjaGlsZHJlbiBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgY2hpbGRyZW4gPSBbY2hpbGRyZW5dXG4gICAgfVxuXG4gICAgaWYgKGNoaWxkKSB7XG4gICAgICAgIGNoaWxkcmVuLnVuc2hpZnQoY2hpbGQpXG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1trZXldXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjb2xsZWN0IGJpbmRpbmdzXG4gICAgY29uc3QgYmluZGluZ3M6IEFycmF5PFtzdHJpbmcsIEJpbmRpbmc8YW55Pl0+ID0gT2JqZWN0XG4gICAgICAgIC5rZXlzKHByb3BzKVxuICAgICAgICAucmVkdWNlKChhY2M6IGFueSwgcHJvcCkgPT4ge1xuICAgICAgICAgICAgaWYgKHByb3BzW3Byb3BdIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJpbmRpbmcgPSBwcm9wc1twcm9wXVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1twcm9wXVxuICAgICAgICAgICAgICAgIHJldHVybiBbLi4uYWNjLCBbcHJvcCwgYmluZGluZ11dXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjXG4gICAgICAgIH0sIFtdKVxuXG4gICAgLy8gY29sbGVjdCBzaWduYWwgaGFuZGxlcnNcbiAgICBjb25zdCBvbkhhbmRsZXJzOiBBcnJheTxbc3RyaW5nLCBzdHJpbmcgfCAoKCkgPT4gdW5rbm93bildPiA9IE9iamVjdFxuICAgICAgICAua2V5cyhwcm9wcylcbiAgICAgICAgLnJlZHVjZSgoYWNjOiBhbnksIGtleSkgPT4ge1xuICAgICAgICAgICAgaWYgKGtleS5zdGFydHNXaXRoKFwib25cIikpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzaWcgPSBrZWJhYmlmeShrZXkpLnNwbGl0KFwiLVwiKS5zbGljZSgxKS5qb2luKFwiLVwiKVxuICAgICAgICAgICAgICAgIGNvbnN0IGhhbmRsZXIgPSBwcm9wc1trZXldXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgICAgICAgICByZXR1cm4gWy4uLmFjYywgW3NpZywgaGFuZGxlcl1dXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjXG4gICAgICAgIH0sIFtdKVxuXG4gICAgLy8gc2V0IGNoaWxkcmVuXG4gICAgY29uc3QgbWVyZ2VkQ2hpbGRyZW4gPSBtZXJnZUJpbmRpbmdzKGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpKVxuICAgIGlmIChtZXJnZWRDaGlsZHJlbiBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXShtZXJnZWRDaGlsZHJlbi5nZXQoKSlcbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIG1lcmdlZENoaWxkcmVuLnN1YnNjcmliZSgodikgPT4ge1xuICAgICAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXSh2KVxuICAgICAgICB9KSlcbiAgICB9IGVsc2Uge1xuICAgICAgICBpZiAobWVyZ2VkQ2hpbGRyZW4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXShtZXJnZWRDaGlsZHJlbilcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNldHVwIHNpZ25hbCBoYW5kbGVyc1xuICAgIGZvciAoY29uc3QgW3NpZ25hbCwgY2FsbGJhY2tdIG9mIG9uSGFuZGxlcnMpIHtcbiAgICAgICAgY29uc3Qgc2lnID0gc2lnbmFsLnN0YXJ0c1dpdGgoXCJub3RpZnlcIilcbiAgICAgICAgICAgID8gc2lnbmFsLnJlcGxhY2UoXCItXCIsIFwiOjpcIilcbiAgICAgICAgICAgIDogc2lnbmFsXG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChzaWcsIGNhbGxiYWNrKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgd2lkZ2V0LmNvbm5lY3Qoc2lnLCAoKSA9PiBleGVjQXN5bmMoY2FsbGJhY2spXG4gICAgICAgICAgICAgICAgLnRoZW4ocHJpbnQpLmNhdGNoKGNvbnNvbGUuZXJyb3IpKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0dXAgYmluZGluZ3MgaGFuZGxlcnNcbiAgICBmb3IgKGNvbnN0IFtwcm9wLCBiaW5kaW5nXSBvZiBiaW5kaW5ncykge1xuICAgICAgICBpZiAocHJvcCA9PT0gXCJjaGlsZFwiIHx8IHByb3AgPT09IFwiY2hpbGRyZW5cIikge1xuICAgICAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIGJpbmRpbmcuc3Vic2NyaWJlKCh2OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKHYpXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgfVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgYmluZGluZy5zdWJzY3JpYmUoKHY6IGFueSkgPT4ge1xuICAgICAgICAgICAgc2V0UHJvcCh3aWRnZXQsIHByb3AsIHYpXG4gICAgICAgIH0pKVxuICAgICAgICBzZXRQcm9wKHdpZGdldCwgcHJvcCwgYmluZGluZy5nZXQoKSlcbiAgICB9XG5cbiAgICAvLyBmaWx0ZXIgdW5kZWZpbmVkIHZhbHVlc1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCBwcm9wcylcbiAgICBzZXR1cD8uKHdpZGdldClcbiAgICByZXR1cm4gd2lkZ2V0XG59XG5cbmZ1bmN0aW9uIGlzQXJyb3dGdW5jdGlvbihmdW5jOiBhbnkpOiBmdW5jIGlzIChhcmdzOiBhbnkpID0+IGFueSB7XG4gICAgcmV0dXJuICFPYmplY3QuaGFzT3duKGZ1bmMsIFwicHJvdG90eXBlXCIpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBqc3goXG4gICAgY3RvcnM6IFJlY29yZDxzdHJpbmcsIHsgbmV3KHByb3BzOiBhbnkpOiBhbnkgfSB8ICgocHJvcHM6IGFueSkgPT4gYW55KT4sXG4gICAgY3Rvcjogc3RyaW5nIHwgKChwcm9wczogYW55KSA9PiBhbnkpIHwgeyBuZXcocHJvcHM6IGFueSk6IGFueSB9LFxuICAgIHsgY2hpbGRyZW4sIC4uLnByb3BzIH06IGFueSxcbikge1xuICAgIGNoaWxkcmVuID8/PSBbXVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGNoaWxkcmVuKSlcbiAgICAgICAgY2hpbGRyZW4gPSBbY2hpbGRyZW5dXG5cbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZpbHRlcihCb29sZWFuKVxuXG4gICAgaWYgKGNoaWxkcmVuLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgcHJvcHMuY2hpbGQgPSBjaGlsZHJlblswXVxuICAgIGVsc2UgaWYgKGNoaWxkcmVuLmxlbmd0aCA+IDEpXG4gICAgICAgIHByb3BzLmNoaWxkcmVuID0gY2hpbGRyZW5cblxuICAgIGlmICh0eXBlb2YgY3RvciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBpZiAoaXNBcnJvd0Z1bmN0aW9uKGN0b3JzW2N0b3JdKSlcbiAgICAgICAgICAgIHJldHVybiBjdG9yc1tjdG9yXShwcm9wcylcblxuICAgICAgICByZXR1cm4gbmV3IGN0b3JzW2N0b3JdKHByb3BzKVxuICAgIH1cblxuICAgIGlmIChpc0Fycm93RnVuY3Rpb24oY3RvcikpXG4gICAgICAgIHJldHVybiBjdG9yKHByb3BzKVxuXG4gICAgcmV0dXJuIG5ldyBjdG9yKHByb3BzKVxufVxuIiwgImltcG9ydCB7IG5vSW1wbGljaXREZXN0cm95LCBzZXRDaGlsZHJlbiwgdHlwZSBCaW5kYWJsZVByb3BzLCBjb25zdHJ1Y3QgfSBmcm9tIFwiLi4vX2FzdGFsLmpzXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBCaW5kaW5nIGZyb20gXCIuLi9iaW5kaW5nLmpzXCJcblxuZXhwb3J0IGNvbnN0IHR5cGUgPSBTeW1ib2woXCJjaGlsZCB0eXBlXCIpXG5jb25zdCBkdW1teUJ1bGRlciA9IG5ldyBHdGsuQnVpbGRlclxuXG5mdW5jdGlvbiBfZ2V0Q2hpbGRyZW4od2lkZ2V0OiBHdGsuV2lkZ2V0KTogQXJyYXk8R3RrLldpZGdldD4ge1xuICAgIGlmIChcImdldF9jaGlsZFwiIGluIHdpZGdldCAmJiB0eXBlb2Ygd2lkZ2V0LmdldF9jaGlsZCA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIHdpZGdldC5nZXRfY2hpbGQoKSA/IFt3aWRnZXQuZ2V0X2NoaWxkKCldIDogW11cbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZHJlbjogQXJyYXk8R3RrLldpZGdldD4gPSBbXVxuICAgIGxldCBjaCA9IHdpZGdldC5nZXRfZmlyc3RfY2hpbGQoKVxuICAgIHdoaWxlIChjaCAhPT0gbnVsbCkge1xuICAgICAgICBjaGlsZHJlbi5wdXNoKGNoKVxuICAgICAgICBjaCA9IGNoLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgIH1cbiAgICByZXR1cm4gY2hpbGRyZW5cbn1cblxuZnVuY3Rpb24gX3NldENoaWxkcmVuKHdpZGdldDogR3RrLldpZGdldCwgY2hpbGRyZW46IGFueVtdKSB7XG4gICAgY2hpbGRyZW4gPSBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG5cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY2hpbGRyZW4pIHtcbiAgICAgICAgd2lkZ2V0LnZmdW5jX2FkZF9jaGlsZChcbiAgICAgICAgICAgIGR1bW15QnVsZGVyLFxuICAgICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgICB0eXBlIGluIGNoaWxkID8gY2hpbGRbdHlwZV0gOiBudWxsLFxuICAgICAgICApXG4gICAgfVxufVxuXG50eXBlIENvbmZpZzxUIGV4dGVuZHMgR3RrLldpZGdldD4gPSB7XG4gICAgc2V0Q2hpbGRyZW4od2lkZ2V0OiBULCBjaGlsZHJlbjogYW55W10pOiB2b2lkXG4gICAgZ2V0Q2hpbGRyZW4od2lkZ2V0OiBUKTogQXJyYXk8R3RrLldpZGdldD5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYXN0YWxpZnk8XG4gICAgV2lkZ2V0IGV4dGVuZHMgR3RrLldpZGdldCxcbiAgICBQcm9wcyBleHRlbmRzIEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyA9IEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyxcbiAgICBTaWduYWxzIGV4dGVuZHMgUmVjb3JkPGBvbiR7c3RyaW5nfWAsIEFycmF5PHVua25vd24+PiA9IFJlY29yZDxgb24ke3N0cmluZ31gLCBhbnlbXT4sXG4+KGNsczogeyBuZXcoLi4uYXJnczogYW55W10pOiBXaWRnZXQgfSwgY29uZmlnOiBQYXJ0aWFsPENvbmZpZzxXaWRnZXQ+PiA9IHt9KSB7XG4gICAgT2JqZWN0LmFzc2lnbihjbHMucHJvdG90eXBlLCB7XG4gICAgICAgIFtzZXRDaGlsZHJlbl0oY2hpbGRyZW46IGFueVtdKSB7XG4gICAgICAgICAgICBjb25zdCB3ID0gdGhpcyBhcyB1bmtub3duIGFzIFdpZGdldFxuICAgICAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiAoY29uZmlnLmdldENoaWxkcmVuPy4odykgfHwgX2dldENoaWxkcmVuKHcpKSkge1xuICAgICAgICAgICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEd0ay5XaWRnZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQudW5wYXJlbnQoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoIWNoaWxkcmVuLmluY2x1ZGVzKGNoaWxkKSAmJiBub0ltcGxpY2l0RGVzdHJveSBpbiB0aGlzKVxuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGQucnVuX2Rpc3Bvc2UoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNvbmZpZy5zZXRDaGlsZHJlbikge1xuICAgICAgICAgICAgICAgIGNvbmZpZy5zZXRDaGlsZHJlbih3LCBjaGlsZHJlbilcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgX3NldENoaWxkcmVuKHcsIGNoaWxkcmVuKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgICBbY2xzLm5hbWVdOiAoXG4gICAgICAgICAgICBwcm9wczogQ29uc3RydWN0UHJvcHM8V2lkZ2V0LCBQcm9wcywgU2lnbmFscz4gPSB7fSxcbiAgICAgICAgICAgIC4uLmNoaWxkcmVuOiBhbnlbXVxuICAgICAgICApOiBXaWRnZXQgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2lkZ2V0ID0gbmV3IGNscyhcImNzc05hbWVcIiBpbiBwcm9wcyA/IHsgY3NzTmFtZTogcHJvcHMuY3NzTmFtZSB9IDoge30pXG5cbiAgICAgICAgICAgIGlmIChcImNzc05hbWVcIiBpbiBwcm9wcykge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5jc3NOYW1lXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChwcm9wcy5ub0ltcGxpY2l0RGVzdHJveSkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCB7IFtub0ltcGxpY2l0RGVzdHJveV06IHRydWUgfSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubm9JbXBsaWNpdERlc3Ryb3lcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHByb3BzLnR5cGUpIHtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHdpZGdldCwgeyBbdHlwZV06IHByb3BzLnR5cGUgfSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMudHlwZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24ocHJvcHMsIHsgY2hpbGRyZW4gfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGNvbnN0cnVjdCh3aWRnZXQgYXMgYW55LCBzZXR1cENvbnRyb2xsZXJzKHdpZGdldCwgcHJvcHMgYXMgYW55KSlcbiAgICAgICAgfSxcbiAgICB9W2Nscy5uYW1lXVxufVxuXG50eXBlIFNpZ0hhbmRsZXI8XG4gICAgVyBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgQXJncyBleHRlbmRzIEFycmF5PHVua25vd24+LFxuPiA9ICgoc2VsZjogVywgLi4uYXJnczogQXJncykgPT4gdW5rbm93bikgfCBzdHJpbmcgfCBzdHJpbmdbXVxuXG5leHBvcnQgeyBCaW5kYWJsZVByb3BzIH1cbmV4cG9ydCB0eXBlIEJpbmRhYmxlQ2hpbGQgPSBHdGsuV2lkZ2V0IHwgQmluZGluZzxHdGsuV2lkZ2V0PlxuXG5leHBvcnQgdHlwZSBDb25zdHJ1Y3RQcm9wczxcbiAgICBTZWxmIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBQcm9wcyBleHRlbmRzIEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyxcbiAgICBTaWduYWxzIGV4dGVuZHMgUmVjb3JkPGBvbiR7c3RyaW5nfWAsIEFycmF5PHVua25vd24+PiA9IFJlY29yZDxgb24ke3N0cmluZ31gLCBhbnlbXT4sXG4+ID0gUGFydGlhbDx7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjYW4ndCBhc3NpZ24gdG8gdW5rbm93biwgYnV0IGl0IHdvcmtzIGFzIGV4cGVjdGVkIHRob3VnaFxuICAgIFtTIGluIGtleW9mIFNpZ25hbHNdOiBTaWdIYW5kbGVyPFNlbGYsIFNpZ25hbHNbU10+XG59PiAmIFBhcnRpYWw8e1xuICAgIFtLZXkgaW4gYG9uJHtzdHJpbmd9YF06IFNpZ0hhbmRsZXI8U2VsZiwgYW55W10+XG59PiAmIFBhcnRpYWw8QmluZGFibGVQcm9wczxPbWl0PFByb3BzLCBcImNzc05hbWVcIiB8IFwiY3NzX25hbWVcIj4+PiAmIHtcbiAgICBub0ltcGxpY2l0RGVzdHJveT86IHRydWVcbiAgICB0eXBlPzogc3RyaW5nXG4gICAgY3NzTmFtZT86IHN0cmluZ1xufSAmIEV2ZW50Q29udHJvbGxlcjxTZWxmPiAmIHtcbiAgICBvbkRlc3Ryb3k/OiAoc2VsZjogU2VsZikgPT4gdW5rbm93blxuICAgIHNldHVwPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbn1cblxudHlwZSBFdmVudENvbnRyb2xsZXI8U2VsZiBleHRlbmRzIEd0ay5XaWRnZXQ+ID0ge1xuICAgIG9uRm9jdXNFbnRlcj86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG4gICAgb25Gb2N1c0xlYXZlPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcblxuICAgIG9uS2V5UHJlc3NlZD86IChzZWxmOiBTZWxmLCBrZXl2YWw6IG51bWJlciwga2V5Y29kZTogbnVtYmVyLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuICAgIG9uS2V5UmVsZWFzZWQ/OiAoc2VsZjogU2VsZiwga2V5dmFsOiBudW1iZXIsIGtleWNvZGU6IG51bWJlciwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcbiAgICBvbktleU1vZGlmaWVyPzogKHNlbGY6IFNlbGYsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG5cbiAgICBvbkxlZ2FjeT86IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB2b2lkXG4gICAgb25CdXR0b25QcmVzc2VkPzogKHNlbGY6IFNlbGYsIHN0YXRlOiBHZGsuQnV0dG9uRXZlbnQpID0+IHZvaWRcbiAgICBvbkJ1dHRvblJlbGVhc2VkPzogKHNlbGY6IFNlbGYsIHN0YXRlOiBHZGsuQnV0dG9uRXZlbnQpID0+IHZvaWRcblxuICAgIG9uSG92ZXJFbnRlcj86IChzZWxmOiBTZWxmLCB4OiBudW1iZXIsIHk6IG51bWJlcikgPT4gdm9pZFxuICAgIG9uSG92ZXJMZWF2ZT86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG4gICAgb25Nb3Rpb24/OiAoc2VsZjogU2VsZiwgeDogbnVtYmVyLCB5OiBudW1iZXIpID0+IHZvaWRcblxuICAgIG9uU2Nyb2xsPzogKHNlbGY6IFNlbGYsIGR4OiBudW1iZXIsIGR5OiBudW1iZXIpID0+IHZvaWRcbiAgICBvblNjcm9sbERlY2VsZXJhdGU/OiAoc2VsZjogU2VsZiwgdmVsX3g6IG51bWJlciwgdmVsX3k6IG51bWJlcikgPT4gdm9pZFxufVxuXG5mdW5jdGlvbiBzZXR1cENvbnRyb2xsZXJzPFQ+KHdpZGdldDogR3RrLldpZGdldCwge1xuICAgIG9uRm9jdXNFbnRlcixcbiAgICBvbkZvY3VzTGVhdmUsXG4gICAgb25LZXlQcmVzc2VkLFxuICAgIG9uS2V5UmVsZWFzZWQsXG4gICAgb25LZXlNb2RpZmllcixcbiAgICBvbkxlZ2FjeSxcbiAgICBvbkJ1dHRvblByZXNzZWQsXG4gICAgb25CdXR0b25SZWxlYXNlZCxcbiAgICBvbkhvdmVyRW50ZXIsXG4gICAgb25Ib3ZlckxlYXZlLFxuICAgIG9uTW90aW9uLFxuICAgIG9uU2Nyb2xsLFxuICAgIG9uU2Nyb2xsRGVjZWxlcmF0ZSxcbiAgICAuLi5wcm9wc1xufTogRXZlbnRDb250cm9sbGVyPEd0ay5XaWRnZXQ+ICYgVCkge1xuICAgIGlmIChvbkZvY3VzRW50ZXIgfHwgb25Gb2N1c0xlYXZlKSB7XG4gICAgICAgIGNvbnN0IGZvY3VzID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJGb2N1c1xuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoZm9jdXMpXG5cbiAgICAgICAgaWYgKG9uRm9jdXNFbnRlcilcbiAgICAgICAgICAgIGZvY3VzLmNvbm5lY3QoXCJlbnRlclwiLCAoKSA9PiBvbkZvY3VzRW50ZXIod2lkZ2V0KSlcblxuICAgICAgICBpZiAob25Gb2N1c0xlYXZlKVxuICAgICAgICAgICAgZm9jdXMuY29ubmVjdChcImxlYXZlXCIsICgpID0+IG9uRm9jdXNMZWF2ZSh3aWRnZXQpKVxuICAgIH1cblxuICAgIGlmIChvbktleVByZXNzZWQgfHwgb25LZXlSZWxlYXNlZCB8fCBvbktleU1vZGlmaWVyKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyS2V5XG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihrZXkpXG5cbiAgICAgICAgaWYgKG9uS2V5UHJlc3NlZClcbiAgICAgICAgICAgIGtleS5jb25uZWN0KFwia2V5LXByZXNzZWRcIiwgKF8sIHZhbCwgY29kZSwgc3RhdGUpID0+IG9uS2V5UHJlc3NlZCh3aWRnZXQsIHZhbCwgY29kZSwgc3RhdGUpKVxuXG4gICAgICAgIGlmIChvbktleVJlbGVhc2VkKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJrZXktcmVsZWFzZWRcIiwgKF8sIHZhbCwgY29kZSwgc3RhdGUpID0+IG9uS2V5UmVsZWFzZWQod2lkZ2V0LCB2YWwsIGNvZGUsIHN0YXRlKSlcblxuICAgICAgICBpZiAob25LZXlNb2RpZmllcilcbiAgICAgICAgICAgIGtleS5jb25uZWN0KFwibW9kaWZpZXJzXCIsIChfLCBzdGF0ZSkgPT4gb25LZXlNb2RpZmllcih3aWRnZXQsIHN0YXRlKSlcbiAgICB9XG5cbiAgICBpZiAob25MZWdhY3kgfHwgb25CdXR0b25QcmVzc2VkIHx8IG9uQnV0dG9uUmVsZWFzZWQpIHtcbiAgICAgICAgY29uc3QgbGVnYWN5ID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJMZWdhY3lcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGxlZ2FjeSlcblxuICAgICAgICBsZWdhY3kuY29ubmVjdChcImV2ZW50XCIsIChfLCBldmVudCkgPT4ge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmdldF9ldmVudF90eXBlKCkgPT09IEdkay5FdmVudFR5cGUuQlVUVE9OX1BSRVNTKSB7XG4gICAgICAgICAgICAgICAgb25CdXR0b25QcmVzc2VkPy4od2lkZ2V0LCBldmVudCBhcyBHZGsuQnV0dG9uRXZlbnQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChldmVudC5nZXRfZXZlbnRfdHlwZSgpID09PSBHZGsuRXZlbnRUeXBlLkJVVFRPTl9SRUxFQVNFKSB7XG4gICAgICAgICAgICAgICAgb25CdXR0b25SZWxlYXNlZD8uKHdpZGdldCwgZXZlbnQgYXMgR2RrLkJ1dHRvbkV2ZW50KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBvbkxlZ2FjeT8uKHdpZGdldCwgZXZlbnQpXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKG9uTW90aW9uIHx8IG9uSG92ZXJFbnRlciB8fCBvbkhvdmVyTGVhdmUpIHtcbiAgICAgICAgY29uc3QgaG92ZXIgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlck1vdGlvblxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoaG92ZXIpXG5cbiAgICAgICAgaWYgKG9uSG92ZXJFbnRlcilcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJlbnRlclwiLCAoXywgeCwgeSkgPT4gb25Ib3ZlckVudGVyKHdpZGdldCwgeCwgeSkpXG5cbiAgICAgICAgaWYgKG9uSG92ZXJMZWF2ZSlcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJsZWF2ZVwiLCAoKSA9PiBvbkhvdmVyTGVhdmUod2lkZ2V0KSlcblxuICAgICAgICBpZiAob25Nb3Rpb24pXG4gICAgICAgICAgICBob3Zlci5jb25uZWN0KFwibW90aW9uXCIsIChfLCB4LCB5KSA9PiBvbk1vdGlvbih3aWRnZXQsIHgsIHkpKVxuICAgIH1cblxuICAgIGlmIChvblNjcm9sbCB8fCBvblNjcm9sbERlY2VsZXJhdGUpIHtcbiAgICAgICAgY29uc3Qgc2Nyb2xsID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJTY3JvbGxcbiAgICAgICAgc2Nyb2xsLmZsYWdzID0gR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbEZsYWdzLkJPVEhfQVhFUyB8IEd0ay5FdmVudENvbnRyb2xsZXJTY3JvbGxGbGFncy5LSU5FVElDXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihzY3JvbGwpXG5cbiAgICAgICAgaWYgKG9uU2Nyb2xsKVxuICAgICAgICAgICAgc2Nyb2xsLmNvbm5lY3QoXCJzY3JvbGxcIiwgKF8sIHgsIHkpID0+IG9uU2Nyb2xsKHdpZGdldCwgeCwgeSkpXG5cbiAgICAgICAgaWYgKG9uU2Nyb2xsRGVjZWxlcmF0ZSlcbiAgICAgICAgICAgIHNjcm9sbC5jb25uZWN0KFwiZGVjZWxlcmF0ZVwiLCAoXywgeCwgeSkgPT4gb25TY3JvbGxEZWNlbGVyYXRlKHdpZGdldCwgeCwgeSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3BzXG59XG4iLCAiaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYj92ZXJzaW9uPTIuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IHsgbWtBcHAgfSBmcm9tIFwiLi4vX2FwcFwiXG5cbkd0ay5pbml0KClcblxuLy8gc3RvcCB0aGlzIGZyb20gbGVha2luZyBpbnRvIHN1YnByb2Nlc3Nlc1xuLy8gYW5kIGdpbyBsYXVuY2ggaW52b2NhdGlvbnNcbkdMaWIudW5zZXRlbnYoXCJMRF9QUkVMT0FEXCIpXG5cbi8vIHVzZXJzIG1pZ2h0IHdhbnQgdG8gdXNlIEFkd2FpdGEgaW4gd2hpY2ggY2FzZSBpdCBoYXMgdG8gYmUgaW5pdGlhbGl6ZWRcbi8vIGl0IG1pZ2h0IGJlIGNvbW1vbiBwaXRmYWxsIHRvIGZvcmdldCBpdCBiZWNhdXNlIGBBcHBgIGlzIG5vdCBgQWR3LkFwcGxpY2F0aW9uYFxuYXdhaXQgaW1wb3J0KFwiZ2k6Ly9BZHc/dmVyc2lvbj0xXCIpXG4gICAgLnRoZW4oKHsgZGVmYXVsdDogQWR3IH0pID0+IEFkdy5pbml0KCkpXG4gICAgLmNhdGNoKCgpID0+IHZvaWQgMClcblxuZXhwb3J0IGRlZmF1bHQgbWtBcHAoQXN0YWwuQXBwbGljYXRpb24pXG4iLCAiLyoqXG4gKiBXb3JrYXJvdW5kIGZvciBcIkNhbid0IGNvbnZlcnQgbm9uLW51bGwgcG9pbnRlciB0byBKUyB2YWx1ZSBcIlxuICovXG5cbmV4cG9ydCB7IH1cblxuY29uc3Qgc25ha2VpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxXyQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbmFzeW5jIGZ1bmN0aW9uIHN1cHByZXNzPFQ+KG1vZDogUHJvbWlzZTx7IGRlZmF1bHQ6IFQgfT4sIHBhdGNoOiAobTogVCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBtb2QudGhlbihtID0+IHBhdGNoKG0uZGVmYXVsdCkpLmNhdGNoKCgpID0+IHZvaWQgMClcbn1cblxuZnVuY3Rpb24gcGF0Y2g8UCBleHRlbmRzIG9iamVjdD4ocHJvdG86IFAsIHByb3A6IEV4dHJhY3Q8a2V5b2YgUCwgc3RyaW5nPikge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwcm90bywgcHJvcCwge1xuICAgICAgICBnZXQoKSB7IHJldHVybiB0aGlzW2BnZXRfJHtzbmFrZWlmeShwcm9wKX1gXSgpIH0sXG4gICAgfSlcbn1cblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEFwcHNcIiksICh7IEFwcHMsIEFwcGxpY2F0aW9uIH0pID0+IHtcbiAgICBwYXRjaChBcHBzLnByb3RvdHlwZSwgXCJsaXN0XCIpXG4gICAgcGF0Y2goQXBwbGljYXRpb24ucHJvdG90eXBlLCBcImtleXdvcmRzXCIpXG4gICAgcGF0Y2goQXBwbGljYXRpb24ucHJvdG90eXBlLCBcImNhdGVnb3JpZXNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxCYXR0ZXJ5XCIpLCAoeyBVUG93ZXIgfSkgPT4ge1xuICAgIHBhdGNoKFVQb3dlci5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiKSwgKHsgQWRhcHRlciwgQmx1ZXRvb3RoLCBEZXZpY2UgfSkgPT4ge1xuICAgIHBhdGNoKEFkYXB0ZXIucHJvdG90eXBlLCBcInV1aWRzXCIpXG4gICAgcGF0Y2goQmx1ZXRvb3RoLnByb3RvdHlwZSwgXCJhZGFwdGVyc1wiKVxuICAgIHBhdGNoKEJsdWV0b290aC5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKERldmljZS5wcm90b3R5cGUsIFwidXVpZHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxIeXBybGFuZFwiKSwgKHsgSHlwcmxhbmQsIE1vbml0b3IsIFdvcmtzcGFjZSB9KSA9PiB7XG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcImJpbmRzXCIpXG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcIm1vbml0b3JzXCIpXG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcIndvcmtzcGFjZXNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwiY2xpZW50c1wiKVxuICAgIHBhdGNoKE1vbml0b3IucHJvdG90eXBlLCBcImF2YWlsYWJsZU1vZGVzXCIpXG4gICAgcGF0Y2goTW9uaXRvci5wcm90b3R5cGUsIFwiYXZhaWxhYmxlX21vZGVzXCIpXG4gICAgcGF0Y2goV29ya3NwYWNlLnByb3RvdHlwZSwgXCJjbGllbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTXByaXNcIiksICh7IE1wcmlzLCBQbGF5ZXIgfSkgPT4ge1xuICAgIHBhdGNoKE1wcmlzLnByb3RvdHlwZSwgXCJwbGF5ZXJzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRfdXJpX3NjaGVtZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZFVyaVNjaGVtZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZF9taW1lX3R5cGVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRNaW1lVHlwZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcImNvbW1lbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTmV0d29ya1wiKSwgKHsgV2lmaSB9KSA9PiB7XG4gICAgcGF0Y2goV2lmaS5wcm90b3R5cGUsIFwiYWNjZXNzX3BvaW50c1wiKVxuICAgIHBhdGNoKFdpZmkucHJvdG90eXBlLCBcImFjY2Vzc1BvaW50c1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbE5vdGlmZFwiKSwgKHsgTm90aWZkLCBOb3RpZmljYXRpb24gfSkgPT4ge1xuICAgIHBhdGNoKE5vdGlmZC5wcm90b3R5cGUsIFwibm90aWZpY2F0aW9uc1wiKVxuICAgIHBhdGNoKE5vdGlmaWNhdGlvbi5wcm90b3R5cGUsIFwiYWN0aW9uc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbFBvd2VyUHJvZmlsZXNcIiksICh7IFBvd2VyUHJvZmlsZXMgfSkgPT4ge1xuICAgIHBhdGNoKFBvd2VyUHJvZmlsZXMucHJvdG90eXBlLCBcImFjdGlvbnNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxXcFwiKSwgKHsgV3AsIEF1ZGlvLCBWaWRlbyB9KSA9PiB7XG4gICAgcGF0Y2goV3AucHJvdG90eXBlLCBcImVuZHBvaW50c1wiKVxuICAgIHBhdGNoKFdwLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcInN0cmVhbXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwicmVjb3JkZXJzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcIm1pY3JvcGhvbmVzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcInNwZWFrZXJzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwic3RyZWFtc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJyZWNvcmRlcnNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwic2lua3NcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwic291cmNlc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG59KVxuIiwgImltcG9ydCBcIi4vb3ZlcnJpZGVzLmpzXCJcbmltcG9ydCB7IHNldENvbnNvbGVMb2dEb21haW4gfSBmcm9tIFwiY29uc29sZVwiXG5pbXBvcnQgeyBleGl0LCBwcm9ncmFtQXJncyB9IGZyb20gXCJzeXN0ZW1cIlxuaW1wb3J0IElPIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5pbXBvcnQgdHlwZSBBc3RhbDMgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IHR5cGUgQXN0YWw0IGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcblxudHlwZSBDb25maWcgPSBQYXJ0aWFsPHtcbiAgICBpbnN0YW5jZU5hbWU6IHN0cmluZ1xuICAgIGNzczogc3RyaW5nXG4gICAgaWNvbnM6IHN0cmluZ1xuICAgIGd0a1RoZW1lOiBzdHJpbmdcbiAgICBpY29uVGhlbWU6IHN0cmluZ1xuICAgIGN1cnNvclRoZW1lOiBzdHJpbmdcbiAgICBob2xkOiBib29sZWFuXG4gICAgcmVxdWVzdEhhbmRsZXIocmVxdWVzdDogc3RyaW5nLCByZXM6IChyZXNwb25zZTogYW55KSA9PiB2b2lkKTogdm9pZFxuICAgIG1haW4oLi4uYXJnczogc3RyaW5nW10pOiB2b2lkXG4gICAgY2xpZW50KG1lc3NhZ2U6IChtc2c6IHN0cmluZykgPT4gc3RyaW5nLCAuLi5hcmdzOiBzdHJpbmdbXSk6IHZvaWRcbn0+XG5cbmludGVyZmFjZSBBc3RhbDNKUyBleHRlbmRzIEFzdGFsMy5BcHBsaWNhdGlvbiB7XG4gICAgZXZhbChib2R5OiBzdHJpbmcpOiBQcm9taXNlPGFueT5cbiAgICByZXF1ZXN0SGFuZGxlcjogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cbiAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQ/OiBib29sZWFuKTogdm9pZFxuICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWRcbiAgICBzdGFydChjb25maWc/OiBDb25maWcpOiB2b2lkXG59XG5cbmludGVyZmFjZSBBc3RhbDRKUyBleHRlbmRzIEFzdGFsNC5BcHBsaWNhdGlvbiB7XG4gICAgZXZhbChib2R5OiBzdHJpbmcpOiBQcm9taXNlPGFueT5cbiAgICByZXF1ZXN0SGFuZGxlcj86IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG4gICAgYXBwbHlfY3NzKHN0eWxlOiBzdHJpbmcsIHJlc2V0PzogYm9vbGVhbik6IHZvaWRcbiAgICBxdWl0KGNvZGU/OiBudW1iZXIpOiB2b2lkXG4gICAgc3RhcnQoY29uZmlnPzogQ29uZmlnKTogdm9pZFxufVxuXG50eXBlIEFwcDMgPSB0eXBlb2YgQXN0YWwzLkFwcGxpY2F0aW9uXG50eXBlIEFwcDQgPSB0eXBlb2YgQXN0YWw0LkFwcGxpY2F0aW9uXG5cbmV4cG9ydCBmdW5jdGlvbiBta0FwcDxBcHAgZXh0ZW5kcyBBcHAzPihBcHA6IEFwcCk6IEFzdGFsM0pTXG5leHBvcnQgZnVuY3Rpb24gbWtBcHA8QXBwIGV4dGVuZHMgQXBwND4oQXBwOiBBcHApOiBBc3RhbDRKU1xuXG5leHBvcnQgZnVuY3Rpb24gbWtBcHAoQXBwOiBBcHAzIHwgQXBwNCkge1xuICAgIHJldHVybiBuZXcgKGNsYXNzIEFzdGFsSlMgZXh0ZW5kcyBBcHAge1xuICAgICAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQXN0YWxKU1wiIH0sIHRoaXMgYXMgYW55KSB9XG5cbiAgICAgICAgZXZhbChib2R5OiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMsIHJlaikgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZuID0gRnVuY3Rpb24oYHJldHVybiAoYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAke2JvZHkuaW5jbHVkZXMoXCI7XCIpID8gYm9keSA6IGByZXR1cm4gJHtib2R5fTtgfVxuICAgICAgICAgICAgICAgICAgICB9KWApXG4gICAgICAgICAgICAgICAgICAgIGZuKCkoKS50aGVuKHJlcykuY2F0Y2gocmVqKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlaihlcnJvcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxdWVzdEhhbmRsZXI/OiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuXG4gICAgICAgIHZmdW5jX3JlcXVlc3QobXNnOiBzdHJpbmcsIGNvbm46IEdpby5Tb2NrZXRDb25uZWN0aW9uKTogdm9pZCB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMucmVxdWVzdEhhbmRsZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgICAgIHRoaXMucmVxdWVzdEhhbmRsZXIobXNnLCAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgSU8ud3JpdGVfc29jayhjb25uLCBTdHJpbmcocmVzcG9uc2UpLCAoXywgcmVzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgSU8ud3JpdGVfc29ja19maW5pc2gocmVzKSxcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN1cGVyLnZmdW5jX3JlcXVlc3QobXNnLCBjb25uKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXBwbHlfY3NzKHN0eWxlOiBzdHJpbmcsIHJlc2V0ID0gZmFsc2UpIHtcbiAgICAgICAgICAgIHN1cGVyLmFwcGx5X2NzcyhzdHlsZSwgcmVzZXQpXG4gICAgICAgIH1cblxuICAgICAgICBxdWl0KGNvZGU/OiBudW1iZXIpOiB2b2lkIHtcbiAgICAgICAgICAgIHN1cGVyLnF1aXQoKVxuICAgICAgICAgICAgZXhpdChjb2RlID8/IDApXG4gICAgICAgIH1cblxuICAgICAgICBzdGFydCh7IHJlcXVlc3RIYW5kbGVyLCBjc3MsIGhvbGQsIG1haW4sIGNsaWVudCwgaWNvbnMsIC4uLmNmZyB9OiBDb25maWcgPSB7fSkge1xuICAgICAgICAgICAgY29uc3QgYXBwID0gdGhpcyBhcyB1bmtub3duIGFzIEluc3RhbmNlVHlwZTxBcHAzIHwgQXBwND5cblxuICAgICAgICAgICAgY2xpZW50ID8/PSAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcHJpbnQoYEFzdGFsIGluc3RhbmNlIFwiJHthcHAuaW5zdGFuY2VOYW1lfVwiIGFscmVhZHkgcnVubmluZ2ApXG4gICAgICAgICAgICAgICAgZXhpdCgxKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIGNmZylcbiAgICAgICAgICAgIHNldENvbnNvbGVMb2dEb21haW4oYXBwLmluc3RhbmNlTmFtZSlcblxuICAgICAgICAgICAgdGhpcy5yZXF1ZXN0SGFuZGxlciA9IHJlcXVlc3RIYW5kbGVyXG4gICAgICAgICAgICBhcHAuY29ubmVjdChcImFjdGl2YXRlXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBtYWluPy4oLi4ucHJvZ3JhbUFyZ3MpXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGFwcC5hY3F1aXJlX3NvY2tldCgpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBjbGllbnQobXNnID0+IElPLnNlbmRfcmVxdWVzdChhcHAuaW5zdGFuY2VOYW1lLCBtc2cpISwgLi4ucHJvZ3JhbUFyZ3MpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICAgICAgdGhpcy5hcHBseV9jc3MoY3NzLCBmYWxzZSlcblxuICAgICAgICAgICAgaWYgKGljb25zKVxuICAgICAgICAgICAgICAgIGFwcC5hZGRfaWNvbnMoaWNvbnMpXG5cbiAgICAgICAgICAgIGhvbGQgPz89IHRydWVcbiAgICAgICAgICAgIGlmIChob2xkKVxuICAgICAgICAgICAgICAgIGFwcC5ob2xkKClcblxuICAgICAgICAgICAgYXBwLnJ1bkFzeW5jKFtdKVxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUsIHR5cGUgQ29uc3RydWN0UHJvcHMgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmZ1bmN0aW9uIGZpbHRlcihjaGlsZHJlbjogYW55W10pIHtcbiAgICByZXR1cm4gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICA/IGNoXG4gICAgICAgIDogbmV3IEd0ay5MYWJlbCh7IHZpc2libGU6IHRydWUsIGxhYmVsOiBTdHJpbmcoY2gpIH0pKVxufVxuXG4vLyBCb3hcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShBc3RhbC5Cb3gucHJvdG90eXBlLCBcImNoaWxkcmVuXCIsIHtcbiAgICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9jaGlsZHJlbigpIH0sXG4gICAgc2V0KHYpIHsgdGhpcy5zZXRfY2hpbGRyZW4odikgfSxcbn0pXG5cbmV4cG9ydCB0eXBlIEJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8QXN0YWwuQm94LCBBc3RhbC5Cb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBCb3ggPSBhc3RhbGlmeTxBc3RhbC5Cb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPihBc3RhbC5Cb3gsIHtcbiAgICBnZXRDaGlsZHJlbihzZWxmKSB7IHJldHVybiBzZWxmLmdldF9jaGlsZHJlbigpIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHsgcmV0dXJuIHNlbGYuc2V0X2NoaWxkcmVuKGZpbHRlcihjaGlsZHJlbikpIH0sXG59KVxuXG4vLyBCdXR0b25cbnR5cGUgQnV0dG9uU2lnbmFscyA9IHtcbiAgICBvbkNsaWNrZWQ6IFtdXG59XG5cbmV4cG9ydCB0eXBlIEJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkJ1dHRvbiwgR3RrLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCBCdXR0b25TaWduYWxzPlxuZXhwb3J0IGNvbnN0IEJ1dHRvbiA9IGFzdGFsaWZ5PEd0ay5CdXR0b24sIEd0ay5CdXR0b24uQ29uc3RydWN0b3JQcm9wcywgQnV0dG9uU2lnbmFscz4oR3RrLkJ1dHRvbilcblxuLy8gQ2VudGVyQm94XG5leHBvcnQgdHlwZSBDZW50ZXJCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5DZW50ZXJCb3gsIEd0ay5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBDZW50ZXJCb3ggPSBhc3RhbGlmeTxHdGsuQ2VudGVyQm94LCBHdGsuQ2VudGVyQm94LkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5DZW50ZXJCb3gsIHtcbiAgICBnZXRDaGlsZHJlbihib3gpIHtcbiAgICAgICAgcmV0dXJuIFtib3guc3RhcnRXaWRnZXQsIGJveC5jZW50ZXJXaWRnZXQsIGJveC5lbmRXaWRnZXRdXG4gICAgfSxcbiAgICBzZXRDaGlsZHJlbihib3gsIGNoaWxkcmVuKSB7XG4gICAgICAgIGNvbnN0IGNoID0gZmlsdGVyKGNoaWxkcmVuKVxuICAgICAgICBib3guc3RhcnRXaWRnZXQgPSBjaFswXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICBib3guY2VudGVyV2lkZ2V0ID0gY2hbMV0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgYm94LmVuZFdpZGdldCA9IGNoWzJdIHx8IG5ldyBHdGsuQm94XG4gICAgfSxcbn0pXG5cbi8vIFRPRE86IENpcmN1bGFyUHJvZ3Jlc3Ncbi8vIFRPRE86IERyYXdpbmdBcmVhXG5cbi8vIEVudHJ5XG50eXBlIEVudHJ5U2lnbmFscyA9IHtcbiAgICBvbkFjdGl2YXRlOiBbXVxuICAgIG9uTm90aWZ5VGV4dDogW11cbn1cblxuZXhwb3J0IHR5cGUgRW50cnlQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5FbnRyeSwgR3RrLkVudHJ5LkNvbnN0cnVjdG9yUHJvcHMsIEVudHJ5U2lnbmFscz5cbmV4cG9ydCBjb25zdCBFbnRyeSA9IGFzdGFsaWZ5PEd0ay5FbnRyeSwgR3RrLkVudHJ5LkNvbnN0cnVjdG9yUHJvcHMsIEVudHJ5U2lnbmFscz4oR3RrLkVudHJ5LCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gSW1hZ2VcbmV4cG9ydCB0eXBlIEltYWdlUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuSW1hZ2UsIEd0ay5JbWFnZS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IEltYWdlID0gYXN0YWxpZnk8R3RrLkltYWdlLCBHdGsuSW1hZ2UuQ29uc3RydWN0b3JQcm9wcz4oR3RrLkltYWdlLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gTGFiZWxcbmV4cG9ydCB0eXBlIExhYmVsUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuTGFiZWwsIEd0ay5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IExhYmVsID0gYXN0YWxpZnk8R3RrLkxhYmVsLCBHdGsuTGFiZWwuQ29uc3RydWN0b3JQcm9wcz4oR3RrLkxhYmVsLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7IHNlbGYubGFiZWwgPSBTdHJpbmcoY2hpbGRyZW4pIH0sXG59KVxuXG4vLyBMZXZlbEJhclxuZXhwb3J0IHR5cGUgTGV2ZWxCYXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5MZXZlbEJhciwgR3RrLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTGV2ZWxCYXIgPSBhc3RhbGlmeTxHdGsuTGV2ZWxCYXIsIEd0ay5MZXZlbEJhci5Db25zdHJ1Y3RvclByb3BzPihHdGsuTGV2ZWxCYXIsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBUT0RPOiBMaXN0Qm94XG5cbi8vIE92ZXJsYXlcbmV4cG9ydCB0eXBlIE92ZXJsYXlQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5PdmVybGF5LCBHdGsuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IE92ZXJsYXkgPSBhc3RhbGlmeTxHdGsuT3ZlcmxheSwgR3RrLk92ZXJsYXkuQ29uc3RydWN0b3JQcm9wcz4oR3RrLk92ZXJsYXksIHtcbiAgICBnZXRDaGlsZHJlbihzZWxmKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkcmVuOiBBcnJheTxHdGsuV2lkZ2V0PiA9IFtdXG4gICAgICAgIGxldCBjaCA9IHNlbGYuZ2V0X2ZpcnN0X2NoaWxkKClcbiAgICAgICAgd2hpbGUgKGNoICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjaGlsZHJlbi5wdXNoKGNoKVxuICAgICAgICAgICAgY2ggPSBjaC5nZXRfbmV4dF9zaWJsaW5nKClcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjaGlsZHJlbi5maWx0ZXIoY2ggPT4gY2ggIT09IHNlbGYuY2hpbGQpXG4gICAgfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZpbHRlcihjaGlsZHJlbikpIHtcbiAgICAgICAgICAgIGNvbnN0IHR5cGVzID0gdHlwZSBpbiBjaGlsZFxuICAgICAgICAgICAgICAgID8gKGNoaWxkW3R5cGVdIGFzIHN0cmluZykuc3BsaXQoL1xccysvKVxuICAgICAgICAgICAgICAgIDogW11cblxuICAgICAgICAgICAgaWYgKHR5cGVzLmluY2x1ZGVzKFwib3ZlcmxheVwiKSkge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX292ZXJsYXkoY2hpbGQpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZWxmLnNldF9tZWFzdXJlX292ZXJsYXkoY2hpbGQsIHR5cGVzLmluY2x1ZGVzKFwibWVhc3VyZVwiKSlcbiAgICAgICAgICAgIHNlbGYuc2V0X2NsaXBfb3ZlcmxheShjaGlsZCwgdHlwZXMuaW5jbHVkZXMoXCJjbGlwXCIpKVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFJldmVhbGVyXG5leHBvcnQgdHlwZSBSZXZlYWxlclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBSZXZlYWxlciA9IGFzdGFsaWZ5PEd0ay5SZXZlYWxlciwgR3RrLlJldmVhbGVyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5SZXZlYWxlcilcblxuLy8gU2xpZGVyXG50eXBlIFNsaWRlclNpZ25hbHMgPSB7XG4gICAgb25DaGFuZ2VWYWx1ZTogW11cbn1cblxuZXhwb3J0IHR5cGUgU2xpZGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5TbGlkZXIsIEFzdGFsLlNsaWRlci5Db25zdHJ1Y3RvclByb3BzLCBTbGlkZXJTaWduYWxzPlxuZXhwb3J0IGNvbnN0IFNsaWRlciA9IGFzdGFsaWZ5PEFzdGFsLlNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIFNsaWRlclNpZ25hbHM+KEFzdGFsLlNsaWRlciwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFN0YWNrXG5leHBvcnQgdHlwZSBTdGFja1Byb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlN0YWNrLCBHdGsuU3RhY2suQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBTdGFjayA9IGFzdGFsaWZ5PEd0ay5TdGFjaywgR3RrLlN0YWNrLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5TdGFjaywge1xuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgaWYgKGNoaWxkLm5hbWUgIT0gXCJcIiAmJiBjaGlsZC5uYW1lICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9uYW1lZChjaGlsZCwgY2hpbGQubmFtZSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gU3dpdGNoXG5leHBvcnQgdHlwZSBTd2l0Y2hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5Td2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBTd2l0Y2ggPSBhc3RhbGlmeTxHdGsuU3dpdGNoLCBHdGsuU3dpdGNoLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5Td2l0Y2gsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBXaW5kb3dcbmV4cG9ydCB0eXBlIFdpbmRvd1Byb3BzID0gQ29uc3RydWN0UHJvcHM8QXN0YWwuV2luZG93LCBBc3RhbC5XaW5kb3cuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBXaW5kb3cgPSBhc3RhbGlmeTxBc3RhbC5XaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPihBc3RhbC5XaW5kb3cpXG5cbi8vIE1lbnVCdXR0b25cbmV4cG9ydCB0eXBlIE1lbnVCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5NZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IE1lbnVCdXR0b24gPSBhc3RhbGlmeTxHdGsuTWVudUJ1dHRvbiwgR3RrLk1lbnVCdXR0b24uQ29uc3RydWN0b3JQcm9wcz4oR3RrLk1lbnVCdXR0b24sIHtcbiAgICBnZXRDaGlsZHJlbihzZWxmKSB7IHJldHVybiBbc2VsZi5wb3BvdmVyLCBzZWxmLmNoaWxkXSB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgR3RrLlBvcG92ZXIpIHtcbiAgICAgICAgICAgICAgICBzZWxmLnNldF9wb3BvdmVyKGNoaWxkKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLnNldF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBQb3BvcGVyXG5leHBvcnQgdHlwZSBQb3BvdmVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuUG9wb3ZlciwgR3RrLlBvcG92ZXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBQb3BvdmVyID0gYXN0YWxpZnk8R3RrLlBvcG92ZXIsIEd0ay5Qb3BvdmVyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5Qb3BvdmVyKVxuIiwgIi8vIGtvYmVsLXNoZWxsIGVudHJ5IFx1MjAxNCBBR1MgdjIgLyBhc3RhbDRcbmltcG9ydCB7IEFwcCB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249NC4wXCJcbi8vIGFzdGFsIGBjb25zdHJ1Y3RgIHNldHMgc3RhdGljIHByb3BzIHZpYSBPYmplY3QuYXNzaWduKHdpZGdldCwgcHJvcHMpIGFuZCBiaW5kaW5ncyB2aWFcbi8vIHNldFByb3AgXHUyMTkyIHNldF9jbGFzcy4gR3RrV2lkZ2V0IGhhcyBuZWl0aGVyIGEgYGNsYXNzYCBHT2JqZWN0IHByb3Agbm9yIHNldF9jbGFzcywgc29cbi8vIGBjbGFzcz1cIi4uLlwiYCBzaWxlbnRseSBuby1vcHMgKHRoZSByZWFsIHByb3AgaXMgYGNzcy1jbGFzc2VzYCwgYW4gYXJyYXkpLiBEZWZpbmUgYVxuLy8gYGNsYXNzYCBhY2Nlc3NvciByb3V0aW5nIEJPVEggcGF0aHMgdG8gc2V0X2Nzc19jbGFzc2VzLCBzbyBgY2xhc3M9XCJhIGJcImAgd29ya3MuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoKEd0ay5XaWRnZXQgYXMgYW55KS5wcm90b3R5cGUsIFwiY2xhc3NcIiwge1xuICBjb25maWd1cmFibGU6IHRydWUsXG4gIHNldCh2OiBzdHJpbmcpIHsgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKSB9LFxuICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9jc3NfY2xhc3NlcygpLmpvaW4oXCIgXCIpIH0sXG59KVxuOyhHdGsuV2lkZ2V0LnByb3RvdHlwZSBhcyBhbnkpLnNldF9jbGFzcyA9IGZ1bmN0aW9uICh2OiBzdHJpbmcpIHtcbiAgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKVxufVxuaW1wb3J0IHN0eWxlIGZyb20gXCIuL3N0eWxlL21haW4uc2Nzc1wiXG5pbXBvcnQgeyB0b2tlbkNzcywgdG9rZW5zIH0gZnJvbSBcIi4vY29uZmlnXCJcbmltcG9ydCAqIGFzIGdub2JsaW4gZnJvbSBcIi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgKiBhcyBub3RpZmRTdmMgZnJvbSBcIi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IGFybUR1bXAgfSBmcm9tIFwiLi9saWIvaW5zcGVjdFwiXG5pbXBvcnQgQmFyIGZyb20gXCIuL3dpZGdldC9CYXJcIlxuaW1wb3J0IERvY2sgZnJvbSBcIi4vd2lkZ2V0L0RvY2tcIlxuaW1wb3J0IExhdW5jaGVyIGZyb20gXCIuL3dpZGdldC9MYXVuY2hlclwiXG5pbXBvcnQgUXVpY2tTZXR0aW5ncyBmcm9tIFwiLi93aWRnZXQvUXVpY2tTZXR0aW5nc1wiXG5pbXBvcnQgQ2FsZW5kYXIgZnJvbSBcIi4vd2lkZ2V0L0NhbGVuZGFyXCJcbmltcG9ydCB7IFRvYXN0cywgRHJhd2VyIH0gZnJvbSBcIi4vd2lkZ2V0L05vdGlmaWNhdGlvbnNcIlxuaW1wb3J0IE9TRCBmcm9tIFwiLi93aWRnZXQvT1NEXCJcbmltcG9ydCBTZXNzaW9uIGZyb20gXCIuL3dpZGdldC9TZXNzaW9uXCJcblxucHJpbnRlcnIoXCJLT0JFTDogbW9kdWxlIHRvcCByZWFjaGVkXCIpXG5cbi8vIEN1c3RvbSBpY29uIHNldCBcdTIwMTQgdGhlIGV4YWN0IEhlcm9pY29ucy9MdWNpZGUvVGFibGVyIHRoZSBwcm90b3R5cGUgdXNlcywgYXNcbi8vIHJlY29sb3JhYmxlIHN5bWJvbGljIFNWR3MuIFJlZ2lzdGVyZWQgb24gdGhlIGRlZmF1bHQgaWNvbiB0aGVtZSBzbyBpY29uTmFtZVxuLy8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgZXRjLiByZXNvbHZlLiBQYXRoIG92ZXJyaWRlIHZpYSBLT0JFTF9JQ09OUyBmb3IgdGhlIGRldmtpdC5cbmltcG9ydCBHTGliSWNvbnMgZnJvbSBcImdpOi8vR0xpYlwiXG5jb25zdCBJQ09OX0RJUiA9IEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKVxuICA/PyBHTGliSWNvbnMuYnVpbGRfZmlsZW5hbWV2KFtHTGliSWNvbnMuZ2V0X2N1cnJlbnRfZGlyKCksIFwiaWNvbnNcIl0pXG5cbkFwcC5zdGFydCh7XG4gIGluc3RhbmNlTmFtZTogXCJrb2JlbFwiLFxuICBpY29uczogSUNPTl9ESVIsXG4gIG1haW4oKSB7XG4gICAgZ25vYmxpbi5pbml0KClcbiAgICBub3RpZmRTdmMuaW5pdCgpXG4gICAgLy8gTG9hZCBvdXIgc3R5bGVzaGVldCBhdCBVU0VSIHByaW9yaXR5IChoaWdoZXN0KSBzbyBpdCBiZWF0cyBBZHdhaXRhJ3MgdGhlbWVcbiAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgIC8vIGBzY2FsZSA+IHRyb3VnaGAgKGZhdCBzbGlkZXJzKS4gVGhpcyBwcm92aWRlciBpcyBhdXRob3JpdGF0aXZlLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm92ID0gbmV3IEd0ay5Dc3NQcm92aWRlcigpXG4gICAgICBwcm92LmxvYWRfZnJvbV9zdHJpbmcoc3R5bGUgKyB0b2tlbkNzcyh0b2tlbnMpKVxuICAgICAgR3RrLlN0eWxlQ29udGV4dC5hZGRfcHJvdmlkZXJfZm9yX2Rpc3BsYXkoXG4gICAgICAgIEdkay5EaXNwbGF5LmdldF9kZWZhdWx0KCkhLCBwcm92LCA4MDAgLyogVVNFUiBwcmlvcml0eSAqLylcbiAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApIH1cbiAgICAvLyBhc3RhbDQgSlNYIDx3aW5kb3c+IGlzIGNyZWF0ZWQgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gUGVyc2lzdGVudCBjaHJvbWUgbXVzdFxuICAgIC8vIGJlIHByZXNlbnQoKWVkOyBvbi1kZW1hbmQgc3VyZmFjZXMgc3RheSBoaWRkZW4gYW5kIGFyZSBzaG93biBieSB0b2dnbGVfd2luZG93LlxuICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB3ID0gZm4oKVxuICAgICAgICBpZiAodyAmJiB0eXBlb2Ygdy5wcmVzZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICBBcHAuYWRkX3dpbmRvdz8uKHcpXG4gICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHsgcHJpbnRlcnIoYGtvYmVsOiAke25hbWV9IEZBSUxFRDogJHtlfVxcbiR7KGUgYXMgYW55KT8uc3RhY2sgPz8gXCJcIn1gKSB9XG4gICAgfVxuICAgIGNvbnN0IG1vbml0b3JzID0gQXBwLmdldF9tb25pdG9ycygpXG4gICAgY29uc3QgdGFyZ2V0cyA9IG1vbml0b3JzLmxlbmd0aCA/IG1vbml0b3JzIDogW3VuZGVmaW5lZCBhcyBhbnldXG4gICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgfVxuICAgIG1ha2UoXCJsYXVuY2hlclwiLCAoKSA9PiBMYXVuY2hlcigpLCBmYWxzZSlcbiAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgIG1ha2UoXCJjYWxlbmRhclwiLCAoKSA9PiBDYWxlbmRhcigpLCBmYWxzZSlcbiAgICBtYWtlKFwiZHJhd2VyXCIsICgpID0+IERyYXdlcigpLCBmYWxzZSlcbiAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgIC8vIEtPQkVMX0RVTVA9PHdpbmRvdz46IGR1bXAgdGhlIGxpdmUgR1RLIGdlb21ldHJ5IHRyZWUgZm9yIERPTS12cy1HVEsgZGlmZmluZy5cbiAgICBhcm1EdW1wKChuYW1lKSA9PiBBcHAuZ2V0X3dpbmRvdyhuYW1lKSBhcyBhbnkpXG4gIH0sXG4gIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0LCByZXMpIHtcbiAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICBpZiAoY21kID09PSBcInRvZ2dsZVwiKSB7IEFwcC50b2dnbGVfd2luZG93KGFyZyk7IHJldHVybiByZXMoXCJva1wiKSB9XG4gICAgaWYgKGNtZCA9PT0gXCJyZWxvYWQtY3NzXCIpIHsgQXBwLmFwcGx5X2NzcyhzdHlsZSArIHRva2VuQ3NzKHRva2VucyksIHRydWUpOyByZXR1cm4gcmVzKFwib2tcIikgfVxuICAgIHJlcyhcInVua25vd25cIilcbiAgfSxcbn0pXG4iLCAiQGNoYXJzZXQgXCJVVEYtOFwiO1xud2luZG93IHtcbiAgZm9udC1mYW1pbHk6IFwiSW50ZXJcIiwgXCJJbnRlciBWYXJpYWJsZVwiLCBcIkludGVyVmFyaWFibGVcIiwgc2Fucy1zZXJpZjtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLnRuIHtcbiAgZm9udC1mZWF0dXJlLXNldHRpbmdzOiBcInRudW1cIjtcbn1cblxud2luZG93IHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbmJ1dHRvbiB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zLCBjb2xvciAxNjBtcztcbn1cblxuaW1hZ2Uge1xuICAtZ3RrLWljb24tc3R5bGU6IHJlZ3VsYXI7XG59XG5cbi5iYXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiAwIDdweDtcbiAgbWluLWhlaWdodDogNDJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50aXRsZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luOiAwIDlweDtcbn1cbi5iYXIgLmNsb2NrIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmJhciAuZGF0ZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLmlidG4ge1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAuaWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuaWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmJhciAuYmNlbnRlciB7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uYmFyIC5iY2VudGVyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1cyB7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDAgMTNweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uYmFyIC5zdGF0dXM6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLmJhciAuc3RhdHVzIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuc3RhdHVzIC5wY3QgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTNweDtcbn1cbi5iYXIgLnN0YXR1cyBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLnN0YXR1cy5lcnIgLm5ldC1pY29uIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG4uYmFyIC5iYWRnZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogMCAzcHg7XG4gIG1hcmdpbjogMnB4O1xuICBtaW4taGVpZ2h0OiAxNHB4O1xuICBtaW4td2lkdGg6IDhweDtcbn1cbi5iYXIgLnRyYXktaWNvbiB7XG4gIG1pbi13aWR0aDogMjhweDtcbn1cbi5iYXIgLnRyYXktaWNvbiBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5iYXIgLnRyYXktbGFuZyB7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIG1hcmdpbjogMCA4cHg7XG59XG5cbi5kb2NrIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgcGFkZGluZzogNXB4O1xuICBib3JkZXItcmFkaXVzOiAxNnB4O1xufVxuLmRvY2sgLmRidG4ge1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xufVxuLmRvY2sgLmljb24tdGlsZSB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgcGFkZGluZzogNnB4O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zO1xufVxuLmRvY2sgLmRidG46aG92ZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC4wOSk7XG59XG4uZG9jayAucGxhY2Vob2xkZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLmRvY2sgLmRvdHMge1xuICBtYXJnaW4tYm90dG9tOiAzcHg7XG59XG4uZG9jayAuZG90IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWluLXdpZHRoOiA0cHg7XG4gIG1pbi1oZWlnaHQ6IDRweDtcbiAgdHJhbnNpdGlvbjogbWluLXdpZHRoIDI2MG1zIGN1YmljLWJlemllcigwLjI0LCAxLjM2LCAwLjM1LCAxKSwgYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5kb2NrIC5kb3Qub24ge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBtaW4td2lkdGg6IDEycHg7XG59XG4uZG9jayAuZG90Lm1pbmkge1xuICBtaW4td2lkdGg6IDNweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBvcGFjaXR5OiAwLjc7XG59XG4uZG9jayAuc2VwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgbWluLXdpZHRoOiAxcHg7XG4gIG1pbi1oZWlnaHQ6IDMzcHg7XG4gIG1hcmdpbjogMCAzcHg7XG59XG4uZG9jayAuZHRpbGUge1xuICBtaW4td2lkdGg6IDQycHg7XG4gIG1pbi1oZWlnaHQ6IDQycHg7XG59XG4uZG9jayAuZHdpZGdldCAuZGcge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBwYWRkaW5nOiA2cHg7XG59XG4uZG9jayAubXByb2cge1xuICBtaW4td2lkdGg6IDI1cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmRvY2sgLm1wcm9nIHRyb3VnaCB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbn1cbi5kb2NrIC5tcHJvZyBibG9jay5maWxsZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xufVxuLmRvY2sgLm1wcm9nIGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG5cbi5zaGVldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDI0cHg7XG4gIHBhZGRpbmc6IDEycHg7XG4gIG1hcmdpbjogMzhweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xufVxuXG4ucXMge1xuICBtaW4td2lkdGg6IDMyOHB4O1xufSAvKiBtYXRjaGVzIHBhbmVsVygzNTIpXHUyMjEyMjQ7IG92ZXJyaWRkZW4gYnkgY29uZmlnLnRzIHRva2VuQ3NzIGF0IHJ1bnRpbWUgKi9cbi5xcy10b3Age1xuICBtYXJnaW4tYm90dG9tOiAxMnB4O1xuICBwYWRkaW5nOiAwIDJweDtcbn1cbi5xcy10b3AgLm1ldGEge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucXMtdG9wIC5tZXRhIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4ucXMtdG9wIC5yYnRuIHtcbiAgcGFkZGluZzogOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luLWxlZnQ6IDdweDtcbn1cbi5xcy10b3AgLnJidG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5xcy10b3AgLnJidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5xcy10b3AgLnJidG4uZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4ucXMtdG9wIC5yYnRuLmxlYWYgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLmNoaXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLWhlaWdodDogNTRweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5jaGlwIC5jaGlwYiB7XG4gIHBhZGRpbmc6IDlweCA4cHggOXB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xufVxuLmNoaXAgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE3cHg7XG59XG4uY2hpcCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jaGlwIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIG1hcmdpbi10b3A6IDA7XG59XG4uY2hpcDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uY2hpcC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2hpcC5vbiBpbWFnZSB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gbGFiZWwge1xuICBjb2xvcjogIzE5MjAwMztcbn1cbi5jaGlwLm9uIC5zdWIge1xuICBjb2xvcjogcmdiYSgyNSwgMzIsIDMsIDAuNyk7XG59XG4uY2hpcC5vbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG4uY2hpcC5vbiAuY2hldiB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAgLmNoZXYge1xuICBtaW4td2lkdGg6IDMycHg7XG4gIGJvcmRlci1yYWRpdXM6IDAgOTk5cHggOTk5cHggMDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1sZWZ0OiAxcHggc29saWQgcmdiYSgwLCAwLCAwLCAwLjE4KTtcbn1cbi5jaGlwIC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiBpbmhlcml0O1xufVxuLmNoaXAgLmNoZXY6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMTQpO1xufVxuXG4uY2hpcHMge1xuICBtYXJnaW4tYm90dG9tOiAwO1xufVxuXG4uY2hpcC1ncmlkIHtcbiAgbWFyZ2luLWJvdHRvbTogMTBweDtcbn1cblxuc2NhbGUsIHNjYWxlOmhvcml6b250YWwsIHNjYWxlOnZlcnRpY2FsIHtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDZweCAwO1xufVxuXG5zY2FsZSA+IHRyb3VnaCwgc2NhbGU6aG9yaXpvbnRhbCA+IHRyb3VnaCwgc2NhbGU6dmVydGljYWwgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIG1pbi13aWR0aDogMDtcbiAgbWFyZ2luOiAwO1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQsXG5zY2FsZSA+IHRyb3VnaCA+IHByb2dyZXNzIHtcbiAgbWluLWhlaWdodDogNnB4O1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBzbGlkZXIge1xuICBtaW4td2lkdGg6IDE3cHg7XG4gIG1pbi1oZWlnaHQ6IDE3cHg7XG4gIG1hcmdpbjogLTZweDsgLyogcHJvdG90eXBlIGtub2IgMTdcdTAwRDcxNyAqL1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2YzZWVmMztcbiAgYm94LXNoYWRvdzogMCAxcHggNHB4IHJnYmEoMCwgMCwgMCwgMC41KTtcbn1cblxuLnNyb3cge1xuICBwYWRkaW5nOiAwIDJweCAwIDJweDtcbiAgbWluLWhlaWdodDogNDJweDtcbn1cblxuLnNyb3cgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMCAtMTJweCAwIDEycHg7XG59XG5cbi5zcm93IC5jaGV2IHtcbiAgcGFkZGluZzogNnB4IDhweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5zcm93IC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMDtcbn1cbi5zcm93IC5jaGV2OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLmdiYW5uZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbn1cbi5nYmFubmVyIC50IHtcbiAgY29sb3I6ICNlZGJiNjQ7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmdiYW5uZXIgLnMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG59XG4uZ2Jhbm5lciBpbWFnZSB7XG4gIGNvbG9yOiAjZWRiYjY0O1xufVxuXG4uZ2J0biB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbiAgcGFkZGluZzogN3B4IDEycHg7XG59XG4uZ2J0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG5cbi5kaGVhZCB7XG4gIHBhZGRpbmctYm90dG9tOiAxMHB4O1xufVxuLmRoZWFkIGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDdweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5kaGVhZCBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5kaGVhZCBsYWJlbCB7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTRweDtcbn1cblxuc3dpdGNoIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIG1pbi13aWR0aDogNDJweDtcbiAgbWluLWhlaWdodDogMjRweDtcbn1cbnN3aXRjaDpjaGVja2VkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbnN3aXRjaCBzbGlkZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiAyMHB4O1xuICBtaW4taGVpZ2h0OiAyMHB4O1xufVxuXG4ueHJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogOXB4IDExcHg7XG59XG4ueHJvdyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTdweDtcbn1cbi54cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnhyb3cgLnhzIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLnhyb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLnhyb3cuYWN0aXZlIGltYWdlIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG4ueHJvdy5hY3RpdmUgLnhzIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG5cbi5taXhyb3cge1xuICBwYWRkaW5nOiA0cHggMnB4O1xufVxuLm1peHJvdyAubWkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbn1cbi5taXhyb3cgLm1pIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xufVxuLm1peHJvdyAubW5hbWUge1xuICBmb250LXNpemU6IDEycHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtaW4td2lkdGg6IDcycHg7XG59XG5cbi5zaGVldC5sYXVuY2hlciB7XG4gIG1pbi13aWR0aDogNTUxcHg7XG59XG5cbi5sYXVuY2hlciB7XG4gIHBhZGRpbmc6IDhweDtcbn1cblxuLmZpZWxkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogM3B4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDZweDtcbn1cbi5maWVsZCBpbWFnZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbn1cbi5maWVsZCBlbnRyeSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm94LXNoYWRvdzogbm9uZTtcbiAgb3V0bGluZTogbm9uZTtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xuICBjYXJldC1jb2xvcjogI2I1Y2I0ODtcbiAgcGFkZGluZzogOHB4IDA7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbn1cbi5maWVsZCBlbnRyeSB0ZXh0IHtcbiAgbWluLWhlaWdodDogMDtcbn1cbi5maWVsZCAubHBsYWNlaG9sZGVyIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5naG9zdCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDE0LjVweDtcbn1cbi5maWVsZCAua2JkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDVweDtcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIHBhZGRpbmc6IDNweCA3cHg7XG59XG5cbi50aWxlcyB7XG4gIHBhZGRpbmc6IDhweCAycHggMTBweDtcbn1cblxuLnRpbGUge1xuICBwYWRkaW5nOiA1cHggMDtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgbWluLXdpZHRoOiA2MnB4O1xuICBtYXgtd2lkdGg6IDYycHg7XG59XG4udGlsZSAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAwO1xuICBtaW4taGVpZ2h0OiAwO1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4udGlsZSBsYWJlbCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi50aWxlOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLnRpbGU6aG92ZXIgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLmxmb290IHtcbiAgcGFkZGluZzogN3B4IDEwcHggM3B4O1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMXB4O1xufVxuLmxmb290IGIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmx3aWRnZXRzIHtcbiAgcGFkZGluZzogMCAycHggNnB4O1xufVxuXG4ud2lkZ2V0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xufVxuLndpZGdldCBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi53aWRnZXQgLmhpbnQge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4ubHdtIC5sd2FydCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xufVxuLmx3bSAubHdhcnQgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDExcHg7XG59XG4ubHdtIC5tYnRuIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgbWluLXdpZHRoOiAyOXB4O1xuICBtaW4taGVpZ2h0OiAyOXB4O1xufVxuLmx3bSAubWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmx3bSAubWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5zZWMge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBwYWRkaW5nOiA4cHggMTBweCAycHg7XG59XG5cbi5yb3cge1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA3cHggMTBweDtcbn1cbi5yb3cgLnJpIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiAycHg7XG59XG4ucm93IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDI0cHg7XG59XG4ucm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLnJvdyAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5yb3cgLnJ1bmsge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogMnB4IDdweDtcbn1cbi5yb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLnJvdy5zZWwge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG4uY2FsIHtcbiAgbWluLXdpZHRoOiAzMDlweDtcbn1cbi5jYWwgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5jYWwgLmhlcm8ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxOXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuY2FsaGVybyB7XG4gIHBhZGRpbmc6IDVweCA4cHggOHB4IDhweDtcbn1cbi5jYWwgLmNhbC1ncmlkIHtcbiAgbWFyZ2luLXRvcDogOHB4O1xufVxuLmNhbCAubW9udGgge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxM3B4O1xufVxuLmNhbCAubW9udGg6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b24ge1xuICBwYWRkaW5nOiA2cHggNXB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jYWwgLmRvdyB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDkuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBwYWRkaW5nOiAzcHggMCA2cHg7XG59XG4uY2FsIC53ayB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5jYWwgLmRheSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBtaW4td2lkdGg6IDI0cHg7XG4gIG1pbi1oZWlnaHQ6IDI0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1hcmdpbjogMXB4O1xufVxuLmNhbCAuZGF5OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5jYWwgLmRheS53ZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLmNhbCAuZGF5Lm91dCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLmNhbCAuZGF5LnRvZGF5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG59XG4uY2FsIC5kYXkudG9kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuLmNhbCAuZGF5LnNlbDpub3QoLnRvZGF5KSB7XG4gIGJveC1zaGFkb3c6IGluc2V0IDAgMCAwIDEuNXB4ICNiNWFkYmM7XG59XG4uY2FsIC5kYXkudG9kYXkuc2VsIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggIzE5MjAwMztcbn1cbi5jYWwgLmRheSAuZXZkb3Qge1xuICBtaW4td2lkdGg6IDNweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBtYXJnaW4tYm90dG9tOiAycHg7XG59XG4uY2FsIC5kYXkudG9kYXkgLmV2ZG90IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzE5MjAwMztcbn1cbi5jYWwgLmV2Y2FyZCB7XG4gIG1hcmdpbi10b3A6IDEwcHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDEwcHg7XG59XG4uY2FsIC5ldmhlYWQge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIHBhZGRpbmc6IDFweCAzcHggOHB4O1xufVxuLmNhbCAuZXZyb3cge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA4cHggMTBweDtcbiAgbWFyZ2luLWJvdHRvbTogNHB4O1xufVxuLmNhbCAuZXZyb3c6bGFzdC1jaGlsZCB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM2Mjg5MzM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLmNhbCAuZXZyb3cgLmV2aWMgaW1hZ2Uge1xuICBjb2xvcjogI2ZmZjtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4uY2FsIC5ldnJvdyBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5jYWwgLmV2cm93IC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5kcmF3ZXIge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbn1cblxuLnRvYXN0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgxNiwgMTMsIDIwLCAwLjgyKTtcbiAgYm9yZGVyLXJhZGl1czogMjBweDtcbiAgcGFkZGluZzogMTFweCAxM3B4O1xuICBib3gtc2hhZG93OiAwIDE4cHggNDBweCByZ2JhKDUsIDMsIDEwLCAwLjQ1KTtcbn1cblxuLm5jYXJkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMjBweDtcbiAgcGFkZGluZzogMTFweCAxMnB4O1xufVxuLm5jYXJkIC5uaWMge1xuICBtaW4td2lkdGg6IDMwcHg7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5uY2FyZCB7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xufVxuLm5jYXJkIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4ubmNhcmQgLmJvZHkge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS44cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgLndoZW4ge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xufVxuLm5jYXJkIC5ueCB7XG4gIHBhZGRpbmc6IDVweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4ubmNhcmQgLm54OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNlZjg2YTA7XG59XG5cbi5uaGVhZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDhweCA4cHggOHB4IDE0cHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG4ubmhlYWQgbGFiZWwge1xuICBmb250LXNpemU6IDEzLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5uaGVhZCAuc3ViIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uaGVhZCAubmNsZWFyIHtcbiAgY29sb3I6ICNlZjg2YTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIHBhZGRpbmc6IDRweCA5cHg7XG59XG4ubmhlYWQgLm5jbGVhcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG5cbi5vc2Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgcGFkZGluZzogMTBweCAxNXB4O1xufVxuLm9zZCBpbWFnZSB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5vc2Qgc2NhbGUgPiB0cm91Z2gsIC5vc2Qgc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQge1xuICBtaW4taGVpZ2h0OiA4cHg7XG59XG4ub3NkIC5zdmFsIHtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuXG4uc2Vzc2lvbiB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoOSwgMywgMTQsIDAuOCk7XG59XG4uc2Vzc2lvbiAuc2J0biB7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5zZXNzaW9uIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyNHB4O1xuICBtaW4td2lkdGg6IDU5cHg7XG4gIG1pbi1oZWlnaHQ6IDU5cHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xuICBjb2xvcjogI2YzZWVmMztcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMDBtcywgY29sb3IgMjAwbXM7XG59XG4uc2Vzc2lvbiAucmVkIC5zaWMge1xuICBjb2xvcjogI2VmODZhMDtcbn1cbi5zZXNzaW9uIC5zYnRuOmhvdmVyIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5zZXNzaW9uIC5yZWQ6aG92ZXIgLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLnNlc3Npb24gbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuLnNlc3Npb24gLmNvbmZpcm0gbGFiZWwge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmNtZW51IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLmNtZW51IC5jbWkge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uY21lbnUgLmNtaTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY21lbnUgLmNtaS5kYW5nZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5jbWVudSAuY3NlcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIG1pbi1oZWlnaHQ6IDFweDtcbiAgbWFyZ2luOiA0cHggOHB4O1xufVxuXG4uZHRpcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA2cHggMTFweDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59IiwgIi8vIFRoZSB0b2tlbiBsYXllciBcdTIwMTQgdGhlIHNpbmdsZSBwbGFjZSB0aGUgc2hlbGwncyBnZW9tZXRyeSBjb21lcyBmcm9tLlxuLy8gUHJvdG90eXBlIGVxdWl2YWxlbnQ6IHRoZSBDU1MgY3VzdG9tIHByb3BlcnRpZXMgb24gLmRlc2t0b3AgKDA0YmU3MmUpLlxuLy8gQ2hhbmdlIGEgdmFsdWUgaGVyZSBhbmQgYmFyLCBwYW5lbHMsIGRvY2ssIHNuYXAtYW5jaG9yZWQgc3VyZmFjZXMgYWxsIHJlZmxvdy5cblxuZXhwb3J0IGludGVyZmFjZSBUb2tlbnMge1xuICBiYXJIOiBudW1iZXIgICAgICAvLyBweCBcdTIwMTQgYmFyIGhlaWdodDsgY29udHJvbHMgZGVyaXZlIGZyb20gaXRcbiAgYmFyUjogbnVtYmVyICAgICAgLy8gYmFyIGNvcm5lciByYWRpdXNcbiAgZ2FwOiBudW1iZXIgICAgICAgLy8gc2NyZWVuIGdhcCAoYmFyIHRvcCBvZmZzZXQsIGRvY2sgYm90dG9tIG9mZnNldClcbiAgZWRnZTogbnVtYmVyICAgICAgLy8gc2lkZSBpbnNldHNcbiAgaWNvbjogbnVtYmVyICAgICAgLy8gZG9jay9sYXVuY2hlciBpY29uIHRpbGUgc2l6ZVxuICBkb2NrUGFkOiBudW1iZXIgICAvLyBkb2NrIHBhZGRpbmcgKGNvbmNlbnRyaWMgcmFkaXVzIGRlcml2ZXMpXG4gIHRpbGVIOiBudW1iZXIgICAgIC8vIFFTIHRpbGUgaGVpZ2h0XG4gIHBhbmVsVzogbnVtYmVyICAgIC8vIFFTL25vdGlmaWNhdGlvbnMvdG9hc3RzIHdpZHRoXG4gIGxhdW5jaGVyVzogbnVtYmVyXG4gIGNhbGVuZGFyVzogbnVtYmVyXG59XG5cbmV4cG9ydCBjb25zdCBmbG9hdGluZzogVG9rZW5zID0ge1xuICBiYXJIOiA0MiwgYmFyUjogMTQsIGdhcDogMTAsIGVkZ2U6IDEyLFxuICBpY29uOiA0NCwgZG9ja1BhZDogNSwgdGlsZUg6IDU0LFxuICBwYW5lbFc6IDM1MiwgbGF1bmNoZXJXOiA1NjAsIGNhbGVuZGFyVzogMzMwLFxufVxuXG4vLyBnYXBsZXNzID0gYSB0b2tlbiBwcmVzZXQsIGV4YWN0bHkgbGlrZSB0aGUgcHJvdG90eXBlJ3MgLmdhcGxlc3MgY2xhc3NcbmV4cG9ydCBjb25zdCBnYXBsZXNzOiBUb2tlbnMgPSB7XG4gIC4uLmZsb2F0aW5nLCBiYXJIOiAzOCwgYmFyUjogMCwgZ2FwOiAwLCBlZGdlOiAwLFxufVxuXG5leHBvcnQgbGV0IHRva2VuczogVG9rZW5zID0gZmxvYXRpbmdcblxuZXhwb3J0IGNvbnN0IGN0bCA9ICgpID0+IHRva2Vucy5iYXJIIC0gMTEgICAgICAgICAgICAgIC8vIGJhciBjb250cm9sIHNpemVcbmV4cG9ydCBjb25zdCBwYW5lbFRvcCA9ICgpID0+IHRva2Vucy5nYXAgKyB0b2tlbnMuYmFySCArIDZcblxuLy8gR1RLIENTUyBjYW4ndCBjYWxjKCkgZnJvbSBKUyBzdGF0ZTsgd2UgcmVnZW5lcmF0ZSBhIDpyb290LWlzaCBibG9jayBhbmRcbi8vIGxldCBBcHAuYXBwbHlfY3NzIHJlLXNraW4gbGl2ZSAodGhlIFwiYmFyIDQyIGN5Y2xlclwiIG9mIHRoZSBRTUwvQUdTIHdvcmxkKS5cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbkNzcyh0OiBUb2tlbnMgPSB0b2tlbnMpOiBzdHJpbmcge1xuICByZXR1cm4gYFxuICAuYmFyIHsgbWluLWhlaWdodDogJHt0LmJhckh9cHg7IGJvcmRlci1yYWRpdXM6ICR7dC5iYXJSfXB4O1xuICAgICAgICAgbWFyZ2luOiAwOyB9XG4gIC5iYXIgYnV0dG9uIHsgbWluLXdpZHRoOiAke2N0bCgpfXB4OyBtaW4taGVpZ2h0OiAke2N0bCgpfXB4OyB9XG4gIC5kb2NrIHsgcGFkZGluZzogJHt0LmRvY2tQYWR9cHg7IGJvcmRlci1yYWRpdXM6ICR7MTIgKyB0LmRvY2tQYWQgLSAxfXB4O1xuICAgICAgICAgIG1hcmdpbi1ib3R0b206ICR7dC5nYXB9cHg7IH1cbiAgLmljb24tdGlsZSB7IG1pbi13aWR0aDogJHt0Lmljb259cHg7IG1pbi1oZWlnaHQ6ICR7dC5pY29ufXB4OyB9XG4gIC5xcywgLmRyYXdlciwgLmNhbGVuZGFyIHsgbWFyZ2luLXRvcDogJHtwYW5lbFRvcCgpfXB4OyB9XG4gIC5xcyB7IG1pbi13aWR0aDogJHt0LnBhbmVsVyAtIDI0fXB4OyB9ICAvKiBwYW5lbFcgaXMgb3V0ZXI7IHN1YnRyYWN0IC5zaGVldCBwYWRkaW5nIDEycHhcdTAwRDcyICovXG4gIC5sYXVuY2hlciB7IG1pbi13aWR0aDogJHt0LmxhdW5jaGVyV31weDsgfVxuICAuY2FsZW5kYXIgeyBtaW4td2lkdGg6ICR7dC5jYWxlbmRhcld9cHg7IH1cbiAgLmNoaXAgeyBtaW4taGVpZ2h0OiAke3QudGlsZUh9cHg7IH1cbiAgYFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0VG9rZW5zKG5leHQ6IFBhcnRpYWw8VG9rZW5zPiwgYXBwbHk6IChjc3M6IHN0cmluZykgPT4gdm9pZCkge1xuICB0b2tlbnMgPSB7IC4uLnRva2VucywgLi4ubmV4dCB9XG4gIGFwcGx5KHRva2VuQ3NzKHRva2VucykpXG59XG4iLCAiLy8gb3JnLmdub2JsaW4uU2hlbGwgXHUyMDE0IHRoZSBjb21wb3NpdG9yIGxpbmsuIERyaXZlczogc29mdC1yZWxvYWQsIGZlYXR1cmUgdG9nZ2xlcyxcbi8vIHRoZSBXSU5ET1cgTElTVCB0aGF0IG1ha2VzIHRoZSBkb2NrIHRydXRoZnVsLCBhbmQgdGhlIGNvbm5lY3RlZC9hbWJlciBzdGF0ZS5cbi8vIFByb3RvdHlwZTogc2VydmljZXMgJ2dub2InIGJhbm5lciArIGJhciBhbWJlciBzZWdtZW50ICsgV00gaW50ZWdyYXRpb24uXG5cbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuaW1wb3J0IHsgVmFyaWFibGUgfSBmcm9tIFwiYXN0YWxcIlxuXG5jb25zdCBCVVMgPSBcIm9yZy5nbm9ibGluLlNoZWxsXCJcbmNvbnN0IFBBVEggPSBcIi9vcmcvZ25vYmxpbi9TaGVsbFwiXG5jb25zdCBJRkFDRSA9IFwib3JnLmdub2JsaW4uU2hlbGxcIlxuXG5leHBvcnQgaW50ZXJmYWNlIEdub2JsaW5XaW5kb3cge1xuICBpZDogc3RyaW5nXG4gIGFwcElkOiBzdHJpbmdcbiAgdGl0bGU6IHN0cmluZ1xuICBmb2N1c2VkOiBib29sZWFuXG4gIG1pbmltaXplZDogYm9vbGVhblxufVxuXG5leHBvcnQgY29uc3QgY29ubmVjdGVkID0gVmFyaWFibGUoZmFsc2UpXG5leHBvcnQgY29uc3Qgd2luZG93cyA9IFZhcmlhYmxlPEdub2JsaW5XaW5kb3dbXT4oW10pXG5cbmxldCBwcm94eTogR2lvLkRCdXNQcm94eSB8IG51bGwgPSBudWxsXG5cbmZ1bmN0aW9uIGNhbGwobWV0aG9kOiBzdHJpbmcsIHBhcmFtczogR0xpYi5WYXJpYW50IHwgbnVsbCA9IG51bGwpOiBQcm9taXNlPEdMaWIuVmFyaWFudCB8IG51bGw+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMsIHJlaikgPT4ge1xuICAgIGlmICghcHJveHkpIHJldHVybiByZWoobmV3IEVycm9yKFwiZ25vYmxpbjogbm90IGNvbm5lY3RlZFwiKSlcbiAgICBwcm94eS5jYWxsKG1ldGhvZCwgcGFyYW1zLCBHaW8uREJ1c0NhbGxGbGFncy5OT05FLCAyMDAwLCBudWxsLCAoXywgcikgPT4ge1xuICAgICAgdHJ5IHsgcmVzKHByb3h5IS5jYWxsX2ZpbmlzaChyKSkgfSBjYXRjaCAoZSkgeyByZWooZSkgfVxuICAgIH0pXG4gIH0pXG59XG5cbmV4cG9ydCBjb25zdCByZWxvYWQgPSAoKSA9PiBjYWxsKFwiUmVsb2FkXCIpXG5leHBvcnQgY29uc3Qgc2V0RmVhdHVyZSA9IChuYW1lOiBzdHJpbmcsIG9uOiBib29sZWFuKSA9PlxuICBjYWxsKFwiU2V0RmVhdHVyZVwiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHNiKVwiLCBbbmFtZSwgb25dKSlcblxuLy8gV2luZG93IHZlcmJzICh0aGUgZG9jayBjbGljayBtb2RlbClcbmV4cG9ydCBjb25zdCBhY3RpdmF0ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiQWN0aXZhdGVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcbmV4cG9ydCBjb25zdCBtaW5pbWl6ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiTWluaW1pemVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hXaW5kb3dzKCkge1xuICB0cnkge1xuICAgIGNvbnN0IHYgPSBhd2FpdCBjYWxsKFwiTGlzdFdpbmRvd3NcIilcbiAgICBpZiAoIXYpIHJldHVyblxuICAgIGNvbnN0IFtsaXN0XSA9IHYuZGVlcF91bnBhY2soKSBhcyBbR25vYmxpbldpbmRvd1tdXVxuICAgIHdpbmRvd3Muc2V0KGxpc3QpXG4gIH0gY2F0Y2ggeyAvKiBzdGF5IG9uIGxhc3Qta25vd24gbGlzdDsgY29ubmVjdGVkIGZsYWcgY2FycmllcyB0aGUgdHJ1dGggKi8gfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwV2luZG93cyhhcHBJZDogc3RyaW5nKTogR25vYmxpbldpbmRvd1tdIHtcbiAgcmV0dXJuIHdpbmRvd3MuZ2V0KCkuZmlsdGVyKHcgPT4gdy5hcHBJZCA9PT0gYXBwSWQpXG59XG5cbi8vIEN5Y2xlID0gdGhlIGRvY2sgY2Fyb3VzZWw6IGZvY3VzIHRoZSBuZXh0IHdpbmRvdyBvZiB0aGUgYXBwXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3ljbGUoYXBwSWQ6IHN0cmluZywgZGlyOiAxIHwgLTEpIHtcbiAgY29uc3Qgd3MgPSBhcHBXaW5kb3dzKGFwcElkKVxuICBpZiAod3MubGVuZ3RoIDwgMikgcmV0dXJuXG4gIGNvbnN0IGkgPSB3cy5maW5kSW5kZXgodyA9PiB3LmZvY3VzZWQpXG4gIGF3YWl0IGFjdGl2YXRlKHdzWygoaSA8IDAgPyAwIDogaSkgKyBkaXIgKyB3cy5sZW5ndGgpICUgd3MubGVuZ3RoXS5pZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gIEdpby5idXNfd2F0Y2hfbmFtZShcbiAgICBHaW8uQnVzVHlwZS5TRVNTSU9OLCBCVVMsIEdpby5CdXNOYW1lV2F0Y2hlckZsYWdzLk5PTkUsXG4gICAgKCkgPT4geyAgLy8gYXBwZWFyZWRcbiAgICAgIEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXMoXG4gICAgICAgIEdpby5CdXNUeXBlLlNFU1NJT04sIEdpby5EQnVzUHJveHlGbGFncy5OT05FLCBudWxsLFxuICAgICAgICBCVVMsIFBBVEgsIElGQUNFLCBudWxsLFxuICAgICAgICAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgcHJveHkgPSBHaW8uREJ1c1Byb3h5Lm5ld19mb3JfYnVzX2ZpbmlzaChyZXMpXG4gICAgICAgICAgcHJveHkuY29ubmVjdChcImctc2lnbmFsXCIsIChfcCwgX3MsIHNpZykgPT4ge1xuICAgICAgICAgICAgaWYgKHNpZyA9PT0gXCJXaW5kb3dzQ2hhbmdlZFwiKSByZWZyZXNoV2luZG93cygpXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25uZWN0ZWQuc2V0KHRydWUpXG4gICAgICAgICAgcmVmcmVzaFdpbmRvd3MoKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgKCkgPT4geyAgLy8gdmFuaXNoZWQgXHUyMTkyIGFtYmVyIGV2ZXJ5d2hlcmUgdGhhdCBsaXN0ZW5zXG4gICAgICBwcm94eSA9IG51bGxcbiAgICAgIGNvbm5lY3RlZC5zZXQoZmFsc2UpXG4gICAgfSlcbn1cbiIsICJpbXBvcnQgXCIuL292ZXJyaWRlcy5qc1wiXG5leHBvcnQgeyBkZWZhdWx0IGFzIEFzdGFsSU8gfSBmcm9tIFwiZ2k6Ly9Bc3RhbElPP3ZlcnNpb249MC4xXCJcbmV4cG9ydCAqIGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vdGltZS5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi9maWxlLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL2dvYmplY3QuanNcIlxuZXhwb3J0IHsgQmluZGluZywgYmluZCB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuZXhwb3J0IHsgVmFyaWFibGUsIGRlcml2ZSB9IGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5cbmV4cG9ydCB7IEdpbyB9XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkRmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBBc3RhbC5yZWFkX2ZpbGUocGF0aCkgfHwgXCJcIlxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZEZpbGVBc3luYyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIEFzdGFsLnJlYWRfZmlsZV9hc3luYyhwYXRoLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwucmVhZF9maWxlX2ZpbmlzaChyZXMpIHx8IFwiXCIpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gICAgQXN0YWwud3JpdGVfZmlsZShwYXRoLCBjb250ZW50KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVGaWxlQXN5bmMocGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBBc3RhbC53cml0ZV9maWxlX2FzeW5jKHBhdGgsIGNvbnRlbnQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC53cml0ZV9maWxlX2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vbml0b3JGaWxlKFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBjYWxsYmFjazogKGZpbGU6IHN0cmluZywgZXZlbnQ6IEdpby5GaWxlTW9uaXRvckV2ZW50KSA9PiB2b2lkLFxuKTogR2lvLkZpbGVNb25pdG9yIHtcbiAgICByZXR1cm4gQXN0YWwubW9uaXRvcl9maWxlKHBhdGgsIChmaWxlOiBzdHJpbmcsIGV2ZW50OiBHaW8uRmlsZU1vbml0b3JFdmVudCkgPT4ge1xuICAgICAgICBjYWxsYmFjayhmaWxlLCBldmVudClcbiAgICB9KSFcbn1cbiIsICJpbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcblxuZXhwb3J0IHsgZGVmYXVsdCBhcyBHTGliIH0gZnJvbSBcImdpOi8vR0xpYj92ZXJzaW9uPTIuMFwiXG5leHBvcnQgeyBHT2JqZWN0LCBHT2JqZWN0IGFzIGRlZmF1bHQgfVxuXG5jb25zdCBtZXRhID0gU3ltYm9sKFwibWV0YVwiKVxuY29uc3QgcHJpdiA9IFN5bWJvbChcInByaXZcIilcblxuY29uc3QgeyBQYXJhbVNwZWMsIFBhcmFtRmxhZ3MgfSA9IEdPYmplY3RcblxuY29uc3Qga2ViYWJpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxLSQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJfXCIsIFwiLVwiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbnR5cGUgU2lnbmFsRGVjbGFyYXRpb24gPSB7XG4gICAgZmxhZ3M/OiBHT2JqZWN0LlNpZ25hbEZsYWdzXG4gICAgYWNjdW11bGF0b3I/OiBHT2JqZWN0LkFjY3VtdWxhdG9yVHlwZVxuICAgIHJldHVybl90eXBlPzogR09iamVjdC5HVHlwZVxuICAgIHBhcmFtX3R5cGVzPzogQXJyYXk8R09iamVjdC5HVHlwZT5cbn1cblxudHlwZSBQcm9wZXJ0eURlY2xhcmF0aW9uID1cbiAgICB8IEluc3RhbmNlVHlwZTx0eXBlb2YgR09iamVjdC5QYXJhbVNwZWM+XG4gICAgfCB7ICRndHlwZTogR09iamVjdC5HVHlwZSB9XG4gICAgfCB0eXBlb2YgU3RyaW5nXG4gICAgfCB0eXBlb2YgTnVtYmVyXG4gICAgfCB0eXBlb2YgQm9vbGVhblxuICAgIHwgdHlwZW9mIE9iamVjdFxuXG50eXBlIEdPYmplY3RDb25zdHJ1Y3RvciA9IHtcbiAgICBbbWV0YV0/OiB7XG4gICAgICAgIFByb3BlcnRpZXM/OiB7IFtrZXk6IHN0cmluZ106IEdPYmplY3QuUGFyYW1TcGVjIH1cbiAgICAgICAgU2lnbmFscz86IHsgW2tleTogc3RyaW5nXTogR09iamVjdC5TaWduYWxEZWZpbml0aW9uIH1cbiAgICB9XG4gICAgbmV3KC4uLmFyZ3M6IGFueVtdKTogYW55XG59XG5cbnR5cGUgTWV0YUluZm8gPSBHT2JqZWN0Lk1ldGFJbmZvPG5ldmVyLCBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9PiwgbmV2ZXI+XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlcihvcHRpb25zOiBNZXRhSW5mbyA9IHt9KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChjbHM6IEdPYmplY3RDb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zdCB0ID0gb3B0aW9ucy5UZW1wbGF0ZVxuICAgICAgICBpZiAodHlwZW9mIHQgPT09IFwic3RyaW5nXCIgJiYgIXQuc3RhcnRzV2l0aChcInJlc291cmNlOi8vXCIpICYmICF0LnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpKSB7XG4gICAgICAgICAgICAvLyBhc3N1bWUgeG1sIHRlbXBsYXRlXG4gICAgICAgICAgICBvcHRpb25zLlRlbXBsYXRlID0gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHQpXG4gICAgICAgIH1cblxuICAgICAgICBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3Moe1xuICAgICAgICAgICAgU2lnbmFsczogeyAuLi5jbHNbbWV0YV0/LlNpZ25hbHMgfSxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHsgLi4uY2xzW21ldGFdPy5Qcm9wZXJ0aWVzIH0sXG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB9LCBjbHMpXG5cbiAgICAgICAgZGVsZXRlIGNsc1ttZXRhXVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHByb3BlcnR5KGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uID0gT2JqZWN0KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgcHJvcDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSB7XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXSA/Pz0ge31cbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXMgPz89IHt9XG5cbiAgICAgICAgY29uc3QgbmFtZSA9IGtlYmFiaWZ5KHByb3ApXG5cbiAgICAgICAgaWYgKCFkZXNjKSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBwcm9wLCB7XG4gICAgICAgICAgICAgICAgZ2V0KCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1twcml2XT8uW3Byb3BdID8/IGRlZmF1bHRWYWx1ZShkZWNsYXJhdGlvbilcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHNldCh2OiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHYgIT09IHRoaXNbcHJvcF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJpdl0gPz89IHt9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzW3ByaXZdW3Byb3BdID0gdlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5ub3RpZnkobmFtZSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgc2V0XyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlKHY6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzW3Byb3BdID0gdlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgZ2V0XyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1twcm9wXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllc1trZWJhYmlmeShwcm9wKV0gPSBwc3BlYyhuYW1lLCBQYXJhbUZsYWdzLlJFQURXUklURSwgZGVjbGFyYXRpb24pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsZXQgZmxhZ3MgPSAwXG4gICAgICAgICAgICBpZiAoZGVzYy5nZXQpIGZsYWdzIHw9IFBhcmFtRmxhZ3MuUkVBREFCTEVcbiAgICAgICAgICAgIGlmIChkZXNjLnNldCkgZmxhZ3MgfD0gUGFyYW1GbGFncy5XUklUQUJMRVxuXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllc1trZWJhYmlmeShwcm9wKV0gPSBwc3BlYyhuYW1lLCBmbGFncywgZGVjbGFyYXRpb24pXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoLi4ucGFyYW1zOiBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdD4pOlxuKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikgPT4gdm9pZFxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKGRlY2xhcmF0aW9uPzogU2lnbmFsRGVjbGFyYXRpb24pOlxuKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikgPT4gdm9pZFxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKFxuICAgIGRlY2xhcmF0aW9uPzogU2lnbmFsRGVjbGFyYXRpb24gfCB7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdCxcbiAgICAuLi5wYXJhbXM6IEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0PlxuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpIHtcbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdID8/PSB7fVxuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFscyA/Pz0ge31cblxuICAgICAgICBjb25zdCBuYW1lID0ga2ViYWJpZnkoc2lnbmFsKVxuXG4gICAgICAgIGlmIChkZWNsYXJhdGlvbiB8fCBwYXJhbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBUT0RPOiB0eXBlIGFzc2VydFxuICAgICAgICAgICAgY29uc3QgYXJyID0gW2RlY2xhcmF0aW9uLCAuLi5wYXJhbXNdLm1hcCh2ID0+IHYuJGd0eXBlKVxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHNbbmFtZV0gPSB7XG4gICAgICAgICAgICAgICAgcGFyYW1fdHlwZXM6IGFycixcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzW25hbWVdID0gZGVjbGFyYXRpb24gfHwge1xuICAgICAgICAgICAgICAgIHBhcmFtX3R5cGVzOiBbXSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZGVzYykge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgc2lnbmFsLCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQobmFtZSwgLi4uYXJncylcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IG9nOiAoKC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkKSA9IGRlc2MudmFsdWVcbiAgICAgICAgICAgIGRlc2MudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG5vdCB0eXBlZFxuICAgICAgICAgICAgICAgIHRoaXMuZW1pdChuYW1lLCAuLi5hcmdzKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYG9uXyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9nLmFwcGx5KHRoaXMsIGFyZ3MpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBzcGVjKG5hbWU6IHN0cmluZywgZmxhZ3M6IG51bWJlciwgZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24pIHtcbiAgICBpZiAoZGVjbGFyYXRpb24gaW5zdGFuY2VvZiBQYXJhbVNwZWMpXG4gICAgICAgIHJldHVybiBkZWNsYXJhdGlvblxuXG4gICAgc3dpdGNoIChkZWNsYXJhdGlvbikge1xuICAgICAgICBjYXNlIFN0cmluZzpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuc3RyaW5nKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBcIlwiKVxuICAgICAgICBjYXNlIE51bWJlcjpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuZG91YmxlKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCAtTnVtYmVyLk1BWF9WQUxVRSwgTnVtYmVyLk1BWF9WQUxVRSwgMClcbiAgICAgICAgY2FzZSBCb29sZWFuOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5ib29sZWFuKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBmYWxzZSlcbiAgICAgICAgY2FzZSBPYmplY3Q6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmpzb2JqZWN0KG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzKVxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBtaXNzdHlwZWRcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMub2JqZWN0KG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBkZWNsYXJhdGlvbi4kZ3R5cGUpXG4gICAgfVxufVxuXG5mdW5jdGlvbiBkZWZhdWx0VmFsdWUoZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24pIHtcbiAgICBpZiAoZGVjbGFyYXRpb24gaW5zdGFuY2VvZiBQYXJhbVNwZWMpXG4gICAgICAgIHJldHVybiBkZWNsYXJhdGlvbi5nZXRfZGVmYXVsdF92YWx1ZSgpXG5cbiAgICBzd2l0Y2ggKGRlY2xhcmF0aW9uKSB7XG4gICAgICAgIGNhc2UgU3RyaW5nOlxuICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgY2FzZSBOdW1iZXI6XG4gICAgICAgICAgICByZXR1cm4gMFxuICAgICAgICBjYXNlIEJvb2xlYW46XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgY2FzZSBPYmplY3Q6XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuICAgIH1cbn1cbiIsICIvLyBEZWZlcnJlZCwgbm9uLWJsb2NraW5nIEFzdGFsTm90aWZkIGFjY2Vzcy4gZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYSBoZWFkbGVzcyBvclxuLy8gY29udGVuZGVkIHNlc3Npb24gYnVzIChpdCB0cmllcyB0byBiZWNvbWUgb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnMgYW5kIHdhaXRzKSxcbi8vIHNvIHdlIE5FVkVSIHRvdWNoIGl0IGR1cmluZyB3aWRnZXQgY29uc3RydWN0aW9uLiBpbml0KCkgaXMgY2FsbGVkIG9uY2UgZnJvbSBhbiBpZGxlXG4vLyBhZnRlciB0aGUgc2hlbGwgaXMgbWFwcGVkOyBvbiByZWFsIGhhcmR3YXJlIGl0IHJldHVybnMgZmFzdCwgaW4gdGhlIHN0cmlwcGVkIGRldmtpdFxuLy8gaXQgbWF5IG5vLW9wLiBXaWRnZXRzIGJpbmQgdG8gYHVucmVhZGAvYGxpc3RgIGFuZCBoeWRyYXRlIHdoZW4gaXQgbGFuZHMuXG5pbXBvcnQgeyBWYXJpYWJsZSwgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcbi8vIEltcG9ydGluZyB0aGUgdHlwZWxpYiBpcyBjaGVhcCArIG5vbi1ibG9ja2luZzsgb25seSBnZXRfZGVmYXVsdCgpIG1heSBibG9jayAoaXQgdHJpZXNcbi8vIHRvIGJlY29tZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyksIHNvIHdlIGNhbGwgVEhBVCBsYXppbHkgZnJvbSBhbiBpZGxlLiBUaGUgb2xkXG4vLyBgaW1wb3J0cy5naS5Bc3RhbE5vdGlmZGAgdGhyb3dzIHVuZGVyIGBnanMgLW1gIChFU00gaGFzIG5vIGxlZ2FjeSBgaW1wb3J0c2AgZ2xvYmFsKS5cbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuXG5leHBvcnQgY29uc3QgdW5yZWFkID0gVmFyaWFibGUoMClcbmV4cG9ydCBjb25zdCByZWFkeSA9IFZhcmlhYmxlKGZhbHNlKVxubGV0IG46IE5vdGlmZC5Ob3RpZmQgfCBudWxsID0gbnVsbFxuXG5leHBvcnQgZnVuY3Rpb24gbm90aWZkKCkgeyByZXR1cm4gbiB9XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0KCkge1xuICAvLyBnZXRlbnYgcmV0dXJucyBcIlwiIChmYWxzeSkgd2hlbiB0aGUgdmFyIGlzIHNldC1idXQtZW1wdHksIG51bGwgd2hlbiB1bnNldCBcdTIwMTQgYm90aCBza2lwXG4gIC8vIGNvcnJlY3RseSBvbmx5IHdoZW4gdGhlIHZhbHVlIGlzIHRydXRoeSAoXCIxXCIpLlxuICBpZiAoR0xpYi5nZXRlbnYoXCJLT0JFTF9TS0lQX05PVElGRFwiKSkgcmV0dXJuXG4gIC8vIGRlZmVyIHBhc3QgZmlyc3QgcGFpbnQ7IGlmIGdldF9kZWZhdWx0IGJsb2NrcywgaXQgYmxvY2tzIG9ubHkgdGhpcyBpZGxlIHRpY2ssXG4gIC8vIG5ldmVyIGNvbnN0cnVjdGlvbi9maXJzdCByZW5kZXIuXG4gIHRpbWVvdXQoNTAsICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgbiA9IE5vdGlmZC5nZXRfZGVmYXVsdCgpXG4gICAgICByZWFkeS5zZXQodHJ1ZSlcbiAgICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB1bnJlYWQuc2V0KG4hLm5vdGlmaWNhdGlvbnMubGVuZ3RoKVxuICAgICAgbi5jb25uZWN0KFwibm90aWZpZWRcIiwgc3luYyk7IG4uY29ubmVjdChcInJlc29sdmVkXCIsIHN5bmMpOyBzeW5jKClcbiAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogbm90aWZkIGluaXQgc2tpcHBlZDogJHtlfWApIH1cbiAgfSlcbn1cbiIsICIvLyBHVEsgd2lkZ2V0LXRyZWUgZ2VvbWV0cnkgZHVtcGVyIFx1MjAxNCB0aGUgbWlycm9yIG9mIHRoZSBET00ncyBnZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5cbi8vIFdhbGtzIGEgbWFwcGVkIHdpbmRvdyBhbmQgcmVjb3JkcyBldmVyeSB3aWRnZXQncyByZWFsIGFsbG9jYXRpb24gKHgveS93L2ggcmVsYXRpdmVcbi8vIHRvIHRoZSB3aW5kb3cgY29udGVudCkgKyBDU1MgY2xhc3NlcyArIHRleHQsIHNvIGEgcmVuZGVyZWQgR1RLIHN1cmZhY2UgY2FuIGJlIGRpZmZlZFxuLy8gMToxIGFnYWluc3QgdGhlIHByb3RvdHlwZSBET00uIEdhdGVkIGJ5IEtPQkVMX0RVTVA9PHdpbmRvdz4gaW4gYXBwLnRzLlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdyYXBoZW5lIGZyb20gXCJnaTovL0dyYXBoZW5lXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE5vZGUge1xuICBkOiBudW1iZXI7IHR5cGU6IHN0cmluZzsgY2xzOiBzdHJpbmdcbiAgeDogbnVtYmVyOyB5OiBudW1iZXI7IHc6IG51bWJlcjsgaDogbnVtYmVyOyB0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGR1bXBXaW5kb3cod2luOiBHdGsuV2luZG93KTogTm9kZVtdIHtcbiAgY29uc3Qgb3V0OiBOb2RlW10gPSBbXVxuICBjb25zdCByb290OiBhbnkgPSB3aW5cbiAgY29uc3Qgd2FsayA9ICh3OiBhbnksIGRlcHRoOiBudW1iZXIpID0+IHtcbiAgICAvLyBjb21wdXRlX2JvdW5kcyBnaXZlcyB0aGUgd2lkZ2V0J3MgRlVMTCByZW5kZXJlZCByZWN0IChpbmNsLiBpdHMgb3duIHBhZGRpbmcpIGluXG4gICAgLy8gdGhlIHJvb3QncyBjb29yZHMgXHUyMDE0IG1vcmUgcmVsaWFibGUgdGhhbiBjb21wdXRlX3BvaW50ICsgZ2V0X3dpZHRoICh3aGljaCBjYW4gcmVwb3J0XG4gICAgLy8gdGhlIGNoaWxkL2NvbnRlbnQgc2l6ZSBmb3IgcGFkZGVkIGJ1dHRvbnMpLlxuICAgIGxldCB4ID0gMCwgeSA9IDAsIHdpZHRoID0gMCwgaGVpZ2h0ID0gMFxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSB3LmNvbXB1dGVfYm91bmRzKHJvb3QpXG4gICAgICBjb25zdCByZWN0ID0gQXJyYXkuaXNBcnJheShyZXMpID8gcmVzWzFdIDogcmVzXG4gICAgICBpZiAocmVjdCkge1xuICAgICAgICB4ID0gcmVjdC5vcmlnaW4ueDsgeSA9IHJlY3Qub3JpZ2luLnlcbiAgICAgICAgd2lkdGggPSByZWN0LnNpemUud2lkdGg7IGhlaWdodCA9IHJlY3Quc2l6ZS5oZWlnaHRcbiAgICAgIH1cbiAgICB9IGNhdGNoIHsgfVxuICAgIGlmICghd2lkdGgpIHsgd2lkdGggPSB3LmdldF93aWR0aD8uKCkgPz8gMDsgaGVpZ2h0ID0gdy5nZXRfaGVpZ2h0Py4oKSA/PyAwIH1cbiAgICBjb25zdCBjbHMgPSAody5nZXRfY3NzX2NsYXNzZXM/LigpID8/IFtdKS5qb2luKFwiLlwiKVxuICAgIGNvbnN0IHR5cGUgPSAody5jb25zdHJ1Y3Rvcj8ubmFtZSA/PyBcIj9cIikucmVwbGFjZSgvXy9nLCBcIlwiKVxuICAgIGxldCB0ID0gXCJcIlxuICAgIHRyeSB7IHQgPSAody5nZXRfbGFiZWw/LigpID8/IHcuZ2V0X3RleHQ/LigpID8/IFwiXCIpLnRvU3RyaW5nKCkuc2xpY2UoMCwgMjgpIH0gY2F0Y2ggeyB9XG4gICAgb3V0LnB1c2goe1xuICAgICAgZDogZGVwdGgsIHR5cGUsIGNscyxcbiAgICAgIHg6IE1hdGgucm91bmQoeCksIHk6IE1hdGgucm91bmQoeSksXG4gICAgICB3OiBNYXRoLnJvdW5kKHdpZHRoKSwgaDogTWF0aC5yb3VuZChoZWlnaHQpLCB0LFxuICAgIH0pXG4gICAgbGV0IGMgPSB3LmdldF9maXJzdF9jaGlsZD8uKClcbiAgICB3aGlsZSAoYykgeyB3YWxrKGMsIGRlcHRoICsgMSk7IGMgPSBjLmdldF9uZXh0X3NpYmxpbmcoKSB9XG4gIH1cbiAgY29uc3QgY2hpbGQgPSB3aW4uZ2V0X2NoaWxkPy4oKVxuICBpZiAoY2hpbGQpIHdhbGsoY2hpbGQsIDApXG4gIHJldHVybiBvdXRcbn1cblxuLy8gUG9sbCB1bnRpbCB0aGUgbmFtZWQgd2luZG93IGlzIHZpc2libGUgKyBsYWlkIG91dCwgdGhlbiBkdW1wIG9uY2UgdG8gS09CRUxfRFVNUF9PVVQuXG5leHBvcnQgZnVuY3Rpb24gYXJtRHVtcChnZXRXaW5kb3c6IChuYW1lOiBzdHJpbmcpID0+IEd0ay5XaW5kb3cgfCBudWxsKSB7XG4gIGNvbnN0IG5hbWUgPSBHTGliLmdldGVudihcIktPQkVMX0RVTVBcIilcbiAgaWYgKCFuYW1lKSByZXR1cm5cbiAgY29uc3QgcGF0aCA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUF9PVVRcIikgfHwgXCIvdG1wL2tvYmVsLWR1bXAuanNvblwiXG4gIGxldCBkb25lID0gZmFsc2VcbiAgR0xpYi50aW1lb3V0X2FkZChHTGliLlBSSU9SSVRZX0RFRkFVTFQsIDQwMCwgKCkgPT4ge1xuICAgIGlmIChkb25lKSByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgY29uc3QgdyA9IGdldFdpbmRvdyhuYW1lKVxuICAgIGlmICh3ICYmIHcuZ2V0X21hcHBlZD8uKCkgJiYgKHcuZ2V0X3dpZHRoPy4oKSA/PyAwKSA+IDApIHtcbiAgICAgIC8vIG9uZSBtb3JlIHRpY2sgc28gZmluYWwgYWxsb2NhdGlvbiBzZXR0bGVzXG4gICAgICBHTGliLnRpbWVvdXRfYWRkKEdMaWIuUFJJT1JJVFlfREVGQVVMVCwgMjUwLCAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdHJlZSA9IGR1bXBXaW5kb3codylcbiAgICAgICAgICBHTGliLmZpbGVfc2V0X2NvbnRlbnRzKHBhdGgsIEpTT04uc3RyaW5naWZ5KHRyZWUpKVxuICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogZHVtcGVkICR7dHJlZS5sZW5ndGh9IHdpZGdldHMgb2YgXCIke25hbWV9XCIgXHUyMTkyICR7cGF0aH1gKVxuICAgICAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogZHVtcCBmYWlsZWQ6ICR7ZX1gKSB9XG4gICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgIH0pXG4gICAgICBkb25lID0gdHJ1ZVxuICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgIH1cbiAgICByZXR1cm4gR0xpYi5TT1VSQ0VfQ09OVElOVUVcbiAgfSlcbn1cbiIsICIvLyBUaGUgYmFyLiBQcm90b3R5cGU6IGxhdW5jaGVyIGJ1dHRvbiBcdTAwQjcgZm9jdXNlZCB0aXRsZSBcdTAwQjcgY2VudGVyZWQgY2xvY2sgKFx1MjE5MiBjYWxlbmRhcilcbi8vIFx1MDBCNyB0cmF5IFx1MDBCNyBzdGF0dXMgcGlsbCAod2lmaS92b2wvYmF0dGVyeTsgYW1iZXIgbmV0LWdseXBoIHdoZW4gZ25vYmxpbiBpcyBkb3duKVxuLy8gXHUwMEI3IGJlbGwrYmFkZ2UgKFx1MjE5MiBkcmF3ZXIpIFx1MDBCNyBwb3dlciAoXHUyMTkyIHNlc3Npb24pLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBUcmF5IGZyb20gXCJnaTovL0FzdGFsVHJheVwiXG5pbXBvcnQgeyBjb25uZWN0ZWQsIHdpbmRvd3MgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyB1bnJlYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCB0aW1lID0gVmFyaWFibGUoR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKCkpLnBvbGwoMTBfMDAwLFxuICAoKSA9PiBHTGliLkRhdGVUaW1lLm5ld19ub3dfbG9jYWwoKSlcblxuZnVuY3Rpb24gRm9jdXNlZFRpdGxlKCkge1xuICByZXR1cm4gPGxhYmVsXG4gICAgY2xhc3M9XCJ0aXRsZVwiXG4gICAgZWxsaXBzaXplPXszIC8qIFBhbmdvLkVsbGlwc2l6ZU1vZGUuRU5EICovfVxuICAgIG1heFdpZHRoQ2hhcnM9ezI4fVxuICAgIGxhYmVsPXtERU1PID8gRC50aXRsZSA6IGJpbmQod2luZG93cykuYXMod3MgPT4ge1xuICAgICAgY29uc3QgZiA9IHdzLmZpbmQodyA9PiB3LmZvY3VzZWQpXG4gICAgICBpZiAoIWYpIHJldHVybiBcImRlc2t0b3BcIlxuICAgICAgY29uc3Qgc2libGluZ3MgPSB3cy5maWx0ZXIodyA9PiB3LmFwcElkID09PSBmLmFwcElkKVxuICAgICAgcmV0dXJuIHNpYmxpbmdzLmxlbmd0aCA+IDFcbiAgICAgICAgPyBgJHtmLnRpdGxlfSBcdTIwMTQgd2luZG93ICR7c2libGluZ3MuaW5kZXhPZihmKSArIDF9LyR7c2libGluZ3MubGVuZ3RofWBcbiAgICAgICAgOiBmLnRpdGxlXG4gICAgfSl9IC8+XG59XG5cbmZ1bmN0aW9uIFN0YXR1c1BpbGwoKSB7XG4gIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgY29uc3QgYmF0ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpXG4gIHJldHVybiA8YnV0dG9uIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICBjbGFzcz17YmluZChjb25uZWN0ZWQpLmFzKGMgPT4gYyA/IFwic3RhdHVzXCIgOiBcInN0YXR1cyBlcnJcIil9XG4gICAgb25DbGlja2VkPXsoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcInF1aWNrc2V0dGluZ3NcIil9PlxuICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgPGltYWdlIGNsYXNzPVwibmV0LWljb25cIiBpY29uTmFtZT1cImtvYmVsLXdpZmktc3ltYm9saWNcIiAvPlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIgLz5cbiAgICAgIDxib3ggY2xhc3M9XCJwY3RcIiBzcGFjaW5nPXs2fT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e0RFTU8gPyBELmJhdHRlcnlQY3QgOiAoYmF0XG4gICAgICAgICAgPyBiaW5kKGJhdCwgXCJwZXJjZW50YWdlXCIpLmFzKHAgPT4gYCR7TWF0aC5yb3VuZChwICogMTAwKX0lYClcbiAgICAgICAgICA6IFwiMTAwJVwiKX0gLz5cbiAgICAgIDwvYm94PlxuICAgIDwvYm94PlxuICA8L2J1dHRvbj5cbn1cblxuZnVuY3Rpb24gQmVsbCgpIHtcbiAgLy8gQmFkZ2UgaHlkcmF0ZXMgb25jZSBub3RpZmQgaXMgYXZhaWxhYmxlIChkZWZlcnJlZCBcdTIwMTQgZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYVxuICAvLyBoZWFkbGVzcy9jb250ZW5kZWQgYnVzOyBuZXZlciBjYWxsIGl0IGR1cmluZyBjb25zdHJ1Y3Rpb24pLiB1bnJlYWQoKSBpcyBhIHBsYWluXG4gIC8vIFZhcmlhYmxlIGFuIGFzeW5jIGluaXQgZmlsbHMgaW4uXG4gIHJldHVybiA8YnV0dG9uIGNsYXNzPVwiaWJ0biBiZWxsXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgIG9uQ2xpY2tlZD17KCkgPT4gQXBwLnRvZ2dsZV93aW5kb3coXCJkcmF3ZXJcIil9PlxuICAgIDxvdmVybGF5PlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmVsbC1zeW1ib2xpY1wiIC8+XG4gICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBoYWxpZ249e0d0ay5BbGlnbi5FTkR9IHZhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICBjbGFzcz1cImJhZGdlIHRuXCIgdmlzaWJsZT17REVNTyA/IHRydWUgOiBiaW5kKHVucmVhZCkuYXMobiA9PiBuID4gMCl9XG4gICAgICAgIGxhYmVsPXtERU1PID8gXCIxXCIgOiBiaW5kKHVucmVhZCkuYXMobiA9PiBuID4gOSA/IFwiOStcIiA6IGAke259YCl9IC8+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQmFyKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIGNvbnN0IHsgVE9QLCBMRUZULCBSSUdIVCB9ID0gQXN0YWwuV2luZG93QW5jaG9yXG4gIC8vIEZsb2F0aW5nIGJhcjogbGF5ZXItc2hlbGwgbWFyZ2lucyBpbnNldCBpdCBmcm9tIHRoZSBlZGdlczsgdGhlIC5iYXIgY2hpbGQgaXMgdGhlXG4gIC8vIHJvdW5kZWQgc3VyZmFjZS4gRXhjbHVzaXZlIHNvIHRpbGVkIHdpbmRvd3MgcmVzcGVjdCBpdCAoem9uZSA9IG1hcmdpbiArIGhlaWdodCkuXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImJhclwiIG5hbWVzcGFjZT1cImtvYmVsLWJhclwiIGNsYXNzPVwiYmFyLXdpbmRvd1wiXG4gICAgZ2RrbW9uaXRvcj17bW9uaXRvcn0gZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LkVYQ0xVU0lWRX1cbiAgICBtYXJnaW5Ub3A9ezEwfSBtYXJnaW5MZWZ0PXsxMn0gbWFyZ2luUmlnaHQ9ezEyfVxuICAgIGFuY2hvcj17VE9QIHwgTEVGVCB8IFJJR0hUfT5cbiAgICA8Y2VudGVyYm94IGNsYXNzPVwiYmFyXCI+XG4gICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IEFwcC50b2dnbGVfd2luZG93KFwibGF1bmNoZXJcIil9PlxuICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW1hZ25pZnlpbmctZ2xhc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgPEZvY3VzZWRUaXRsZSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwiYmNlbnRlclwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgb25DbGlja2VkPXsoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcImNhbGVuZGFyXCIpfT5cbiAgICAgICAgPGJveCBzcGFjaW5nPXs4fT5cbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJjbG9jayB0blwiIHZhbGlnbj17R3RrLkFsaWduLkJBU0VMSU5FfVxuICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmNsb2NrIDogYmluZCh0aW1lKS5hcyh0ID0+IHQuZm9ybWF0KFwiJUg6JU1cIikhKX0gLz5cbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJkYXRlXCIgdmFsaWduPXtHdGsuQWxpZ24uQkFTRUxJTkV9XG4gICAgICAgICAgICBsYWJlbD17REVNTyA/IEQuZGF0ZSA6IGJpbmQodGltZSkuYXModCA9PiB0LmZvcm1hdChcIiVhICUtZCAlYlwiKSEpfSAvPlxuICAgICAgICA8L2JveD5cbiAgICAgIDwvYnV0dG9uPlxuICAgICAgPGJveCBzcGFjaW5nPXs0fT5cbiAgICAgICAge0RFTU9cbiAgICAgICAgICA/IDxib3ggc3BhY2luZz17MX0gbWFyZ2luRW5kPXszfT5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG4gdHJheS1pY29uXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB0b29sdGlwVGV4dD1cIkRpc2NvcmRcIj5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGF0LXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG4gdHJheS1pY29uXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB0b29sdGlwVGV4dD1cIlN0ZWFtXCI+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtZ2FtZS1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdG9vbHRpcFRleHQ9XCJUZWxlZ3JhbVwiPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBhcGVyLXBsYW5lLXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gdHJheS1sYW5nXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBsYWJlbD1cImVuXCIgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgIDogYmluZChUcmF5LmdldF9kZWZhdWx0KCksIFwiaXRlbXNcIikuYXMoaXRlbXMgPT4gaXRlbXMubWFwKGl0ZW0gPT5cbiAgICAgICAgICAgICAgPG1lbnVidXR0b24gdG9vbHRpcFRleHQ9e2l0ZW0udG9vbHRpcF9tYXJrdXB9IG1lbnVNb2RlbD17aXRlbS5tZW51X21vZGVsfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgZ2ljb249e2JpbmQoaXRlbSwgXCJnaWNvblwiKX0gLz5cbiAgICAgICAgICAgICAgPC9tZW51YnV0dG9uPikpfVxuICAgICAgICA8U3RhdHVzUGlsbCAvPlxuICAgICAgICA8QmVsbCAvPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IEFwcC50b2dnbGVfd2luZG93KFwic2Vzc2lvblwiKX0+XG4gICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgIDwvYm94PlxuICAgIDwvY2VudGVyYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBEZW1vLWRhdGEgbW9kZSAoS09CRUxfREVNTz0xKTogbWFrZSBldmVyeSBzdXJmYWNlIHJlbmRlciB0aGUgRVhBQ1QgbW9jayB2YWx1ZXMgZnJvbVxuLy8gZG9jcy9wcm90b3R5cGUuaHRtbCwgc28gYW4gQUdTIHJlbmRlciBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXJcbi8vIGZvciBhIGZhaXIgMToxIGNvbXBhcmlzb24uIFRoaXMgaXMgTk9UIGNoZWF0aW5nIFx1MjAxNCByZWFsIEdUSyB3aWRnZXRzLCByZWFsIHJlbmRlcmluZztcbi8vIG9ubHkgdGhlICpjb250ZW50KiBpcyBwaW5uZWQgdG8gdGhlIHByb3RvdHlwZSdzIHNvIHRoZSBjaHJvbWUgY2FuIGJlIGRpZmZlZCBkaXJlY3RseS5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgY29uc3QgREVNTyA9ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9ERU1PXCIpXG5cbi8vIFZhbHVlcyB0cmFuc2NyaWJlZCBmcm9tIHByb3RvdHlwZS5odG1sJ3MgbW9jayBzdGF0ZSAodGhlIHJlZmVyZW5jZSBzY3JlZW5zaG90cykuXG5leHBvcnQgY29uc3QgRCA9IHtcbiAgLy8gYmFyXG4gIGNsb2NrOiBcIjE0OjIzXCIsXG4gIGRhdGU6IFwiU2F0IDQgSnVsXCIsXG4gIHRpdGxlOiBcIlRlcm1pbmFsIFx1MjAxNCB3aW5kb3cgMS8yXCIsXG4gIGJhdHRlcnlQY3Q6IFwiMTAwJVwiLFxuICAvLyBxdWljayBzZXR0aW5nc1xuICBtZXRhOiBcIjEwMCUgXHUwMEI3IEZ1bGx5IGNoYXJnZWRcIixcbiAgd2lmaVNzaWQ6IFwiY2hvbXBlcnMtNUdcIixcbiAgYnREZXZpY2U6IFwiV0gtMTAwMFhNNVwiLFxuICB2b2x1bWU6IDAuNjc1LCAgICAgLy8gdHJvdWdoIDUxLi4yODUgd2lkdGg9MjM0OyBrbm9iPSgyMDktNTEpLzIzND0wLjY3NSBcdTIxOTIgeFx1MjI0ODIwOSBtYXRjaGVzIHByb3RvXG4gIGJyaWdodG5lc3M6IDAuNzk0LCAvLyB0cm91Z2ggNTEuLjI5OSB3aWR0aD0yNDg7IGtub2I9KDI0OC01MSkvMjQ4PTAuNzk0IFx1MjE5MiB4XHUyMjQ4MjQ4IG1hdGNoZXMgcHJvdG9cbiAgZGFyazogdHJ1ZSwgc2F2ZTogZmFsc2UsIHNpbGVudDogZmFsc2UsIG5pZ2h0OiBmYWxzZSxcbiAgLy8gY2FsZW5kYXIgXHUyMDE0IHBpbm5lZCBcInRvZGF5XCIgc28gdGhlIGdyaWQgKyBoZXJvIG1hdGNoIHRoZSBwcm90b3R5cGUgZXhhY3RseVxuICB0b2RheTogeyB5OiAyMDI2LCBtOiA2IC8qIEp1bHksIDAtaW5kZXhlZCAqLywgZDogNCB9LCAgLy8gU2F0dXJkYXkgNCBKdWx5IDIwMjZcbiAgLy8gbGF1bmNoZXIgcGlubmVkIHRpbGVzICsgdG9kYXkgd2lkZ2V0XG4gIGFwcHM6IFtcIlRlcm1pbmFsXCIsIFwiRmlsZXNcIiwgXCJGaXJlZm94XCIsIFwiWmVkXCIsIFwiU3BvdGlmeVwiLCBcIlNldHRpbmdzXCJdLFxuICB3aWRnZXREYXRlOiBcIlNhdHVyZGF5IDQgSnVseVwiLFxuICB3aWRnZXRFdmVudDogXCIwOTo0NSBcdTAwQjcgRGFpbHkgU3RhbmR1cFwiLFxuICBtZWRpYTogeyB0aXRsZTogXCJXZWlnaHRsZXNzXCIsIGFydGlzdDogXCJNYXJjb25pIFVuaW9uXCIgfSxcbn1cbiIsICIvKiBlc2xpbnQtZGlzYWJsZSBtYXgtbGVuICovXG5pbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSBDb25zdHJ1Y3RQcm9wcywgdHlwZSBCaW5kYWJsZUNoaWxkIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuXG5mdW5jdGlvbiBmaWx0ZXIoY2hpbGRyZW46IGFueVtdKSB7XG4gICAgcmV0dXJuIGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcbn1cblxuLy8gQm94XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoQXN0YWwuQm94LnByb3RvdHlwZSwgXCJjaGlsZHJlblwiLCB7XG4gICAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfY2hpbGRyZW4oKSB9LFxuICAgIHNldCh2KSB7IHRoaXMuc2V0X2NoaWxkcmVuKHYpIH0sXG59KVxuXG5leHBvcnQgdHlwZSBCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgQm94IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuQm94KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkJveFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEJveFByb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7IHRoaXMuc2V0X2NoaWxkcmVuKGZpbHRlcihjaGlsZHJlbikpIH1cbn1cblxuLy8gQnV0dG9uXG5leHBvcnQgdHlwZSBCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEJ1dHRvbiwgQXN0YWwuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkNsaWNrZWQ6IFtdXG4gICAgb25DbGljazogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uQ2xpY2tSZWxlYXNlOiBbZXZlbnQ6IEFzdGFsLkNsaWNrRXZlbnRdXG4gICAgb25Ib3ZlcjogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uSG92ZXJMb3N0OiBbZXZlbnQ6IEFzdGFsLkhvdmVyRXZlbnRdXG4gICAgb25TY3JvbGw6IFtldmVudDogQXN0YWwuU2Nyb2xsRXZlbnRdXG59PlxuZXhwb3J0IGNsYXNzIEJ1dHRvbiBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkJ1dHRvbikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJCdXR0b25cIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBCdXR0b25Qcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIENlbnRlckJveFxuZXhwb3J0IHR5cGUgQ2VudGVyQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxDZW50ZXJCb3gsIEFzdGFsLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIENlbnRlckJveCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkNlbnRlckJveCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJDZW50ZXJCb3hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBDZW50ZXJCb3hQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQge1xuICAgICAgICBjb25zdCBjaCA9IGZpbHRlcihjaGlsZHJlbilcbiAgICAgICAgdGhpcy5zdGFydFdpZGdldCA9IGNoWzBdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIHRoaXMuY2VudGVyV2lkZ2V0ID0gY2hbMV0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgdGhpcy5lbmRXaWRnZXQgPSBjaFsyXSB8fCBuZXcgR3RrLkJveFxuICAgIH1cbn1cblxuLy8gQ2lyY3VsYXJQcm9ncmVzc1xuZXhwb3J0IHR5cGUgQ2lyY3VsYXJQcm9ncmVzc1Byb3BzID0gQ29uc3RydWN0UHJvcHM8Q2lyY3VsYXJQcm9ncmVzcywgQXN0YWwuQ2lyY3VsYXJQcm9ncmVzcy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIENpcmN1bGFyUHJvZ3Jlc3MgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5DaXJjdWxhclByb2dyZXNzKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkNpcmN1bGFyUHJvZ3Jlc3NcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBDaXJjdWxhclByb2dyZXNzUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBEcmF3aW5nQXJlYVxuZXhwb3J0IHR5cGUgRHJhd2luZ0FyZWFQcm9wcyA9IENvbnN0cnVjdFByb3BzPERyYXdpbmdBcmVhLCBHdGsuRHJhd2luZ0FyZWEuQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uRHJhdzogW2NyOiBhbnldIC8vIFRPRE86IGNhaXJvIHR5cGVzXG59PlxuZXhwb3J0IGNsYXNzIERyYXdpbmdBcmVhIGV4dGVuZHMgYXN0YWxpZnkoR3RrLkRyYXdpbmdBcmVhKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkRyYXdpbmdBcmVhXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogRHJhd2luZ0FyZWFQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gRW50cnlcbmV4cG9ydCB0eXBlIEVudHJ5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxFbnRyeSwgR3RrLkVudHJ5LkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkNoYW5nZWQ6IFtdXG4gICAgb25BY3RpdmF0ZTogW11cbn0+XG5leHBvcnQgY2xhc3MgRW50cnkgZXh0ZW5kcyBhc3RhbGlmeShHdGsuRW50cnkpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiRW50cnlcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBFbnRyeVByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBFdmVudEJveFxuZXhwb3J0IHR5cGUgRXZlbnRCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEV2ZW50Qm94LCBBc3RhbC5FdmVudEJveC5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25DbGljazogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uQ2xpY2tSZWxlYXNlOiBbZXZlbnQ6IEFzdGFsLkNsaWNrRXZlbnRdXG4gICAgb25Ib3ZlcjogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uSG92ZXJMb3N0OiBbZXZlbnQ6IEFzdGFsLkhvdmVyRXZlbnRdXG4gICAgb25TY3JvbGw6IFtldmVudDogQXN0YWwuU2Nyb2xsRXZlbnRdXG59PlxuZXhwb3J0IGNsYXNzIEV2ZW50Qm94IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuRXZlbnRCb3gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiRXZlbnRCb3hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBFdmVudEJveFByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gLy8gVE9ETzogRml4ZWRcbi8vIC8vIFRPRE86IEZsb3dCb3hcbi8vXG4vLyBJY29uXG5leHBvcnQgdHlwZSBJY29uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxJY29uLCBBc3RhbC5JY29uLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgSWNvbiBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkljb24pIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiSWNvblwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IEljb25Qcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gTGFiZWxcbmV4cG9ydCB0eXBlIExhYmVsUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxMYWJlbCwgQXN0YWwuTGFiZWwuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBMYWJlbCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkxhYmVsKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkxhYmVsXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogTGFiZWxQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7IHRoaXMubGFiZWwgPSBTdHJpbmcoY2hpbGRyZW4pIH1cbn1cblxuLy8gTGV2ZWxCYXJcbmV4cG9ydCB0eXBlIExldmVsQmFyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxMZXZlbEJhciwgQXN0YWwuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBMZXZlbEJhciBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkxldmVsQmFyKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkxldmVsQmFyXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogTGV2ZWxCYXJQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gVE9ETzogTGlzdEJveFxuXG4vLyBNZW51QnV0dG9uXG5leHBvcnQgdHlwZSBNZW51QnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxNZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIE1lbnVCdXR0b24gZXh0ZW5kcyBhc3RhbGlmeShHdGsuTWVudUJ1dHRvbikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJNZW51QnV0dG9uXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogTWVudUJ1dHRvblByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gT3ZlcmxheVxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLk92ZXJsYXkucHJvdG90eXBlLCBcIm92ZXJsYXlzXCIsIHtcbiAgICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9vdmVybGF5cygpIH0sXG4gICAgc2V0KHYpIHsgdGhpcy5zZXRfb3ZlcmxheXModikgfSxcbn0pXG5cbmV4cG9ydCB0eXBlIE92ZXJsYXlQcm9wcyA9IENvbnN0cnVjdFByb3BzPE92ZXJsYXksIEFzdGFsLk92ZXJsYXkuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBPdmVybGF5IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuT3ZlcmxheSkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJPdmVybGF5XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogT3ZlcmxheVByb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7XG4gICAgICAgIGNvbnN0IFtjaGlsZCwgLi4ub3ZlcmxheXNdID0gZmlsdGVyKGNoaWxkcmVuKVxuICAgICAgICB0aGlzLnNldF9jaGlsZChjaGlsZClcbiAgICAgICAgdGhpcy5zZXRfb3ZlcmxheXMob3ZlcmxheXMpXG4gICAgfVxufVxuXG4vLyBSZXZlYWxlclxuZXhwb3J0IHR5cGUgUmV2ZWFsZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPFJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBSZXZlYWxlciBleHRlbmRzIGFzdGFsaWZ5KEd0ay5SZXZlYWxlcikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJSZXZlYWxlclwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFJldmVhbGVyUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBTY3JvbGxhYmxlXG5leHBvcnQgdHlwZSBTY3JvbGxhYmxlUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxTY3JvbGxhYmxlLCBBc3RhbC5TY3JvbGxhYmxlLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgU2Nyb2xsYWJsZSBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLlNjcm9sbGFibGUpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU2Nyb2xsYWJsZVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFNjcm9sbGFibGVQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIFNsaWRlclxuZXhwb3J0IHR5cGUgU2xpZGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxTbGlkZXIsIEFzdGFsLlNsaWRlci5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25EcmFnZ2VkOiBbXVxufT5cbmV4cG9ydCBjbGFzcyBTbGlkZXIgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5TbGlkZXIpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU2xpZGVyXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogU2xpZGVyUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIFN0YWNrXG5leHBvcnQgdHlwZSBTdGFja1Byb3BzID0gQ29uc3RydWN0UHJvcHM8U3RhY2ssIEFzdGFsLlN0YWNrLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgU3RhY2sgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5TdGFjaykge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJTdGFja1wiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFN0YWNrUHJvcHMsIC4uLmNoaWxkcmVuOiBBcnJheTxCaW5kYWJsZUNoaWxkPikgeyBzdXBlcih7IGNoaWxkcmVuLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHsgdGhpcy5zZXRfY2hpbGRyZW4oZmlsdGVyKGNoaWxkcmVuKSkgfVxufVxuXG4vLyBTd2l0Y2hcbmV4cG9ydCB0eXBlIFN3aXRjaFByb3BzID0gQ29uc3RydWN0UHJvcHM8U3dpdGNoLCBHdGsuU3dpdGNoLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgU3dpdGNoIGV4dGVuZHMgYXN0YWxpZnkoR3RrLlN3aXRjaCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJTd2l0Y2hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTd2l0Y2hQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gV2luZG93XG5leHBvcnQgdHlwZSBXaW5kb3dQcm9wcyA9IENvbnN0cnVjdFByb3BzPFdpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgV2luZG93IGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuV2luZG93KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIldpbmRvd1wiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFdpbmRvd1Byb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cbiIsICJpbXBvcnQgeyBob29rLCBub0ltcGxpY2l0RGVzdHJveSwgc2V0Q2hpbGRyZW4sIG1lcmdlQmluZGluZ3MsIHR5cGUgQmluZGFibGVQcm9wcywgY29uc3RydWN0IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEdkayBmcm9tIFwiZ2k6Ly9HZGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5pbXBvcnQgQmluZGluZywgeyB0eXBlIENvbm5lY3RhYmxlLCB0eXBlIFN1YnNjcmliYWJsZSB9IGZyb20gXCIuLi9iaW5kaW5nLmpzXCJcblxuZXhwb3J0IHsgQmluZGFibGVQcm9wcywgbWVyZ2VCaW5kaW5ncyB9XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFzdGFsaWZ5PFxuICAgIEMgZXh0ZW5kcyB7IG5ldyguLi5hcmdzOiBhbnlbXSk6IEd0ay5XaWRnZXQgfSxcbj4oY2xzOiBDLCBjbHNOYW1lID0gY2xzLm5hbWUpIHtcbiAgICBjbGFzcyBXaWRnZXQgZXh0ZW5kcyBjbHMge1xuICAgICAgICBnZXQgY3NzKCk6IHN0cmluZyB7IHJldHVybiBBc3RhbC53aWRnZXRfZ2V0X2Nzcyh0aGlzKSB9XG4gICAgICAgIHNldCBjc3MoY3NzOiBzdHJpbmcpIHsgQXN0YWwud2lkZ2V0X3NldF9jc3ModGhpcywgY3NzKSB9XG4gICAgICAgIGdldF9jc3MoKTogc3RyaW5nIHsgcmV0dXJuIHRoaXMuY3NzIH1cbiAgICAgICAgc2V0X2Nzcyhjc3M6IHN0cmluZykgeyB0aGlzLmNzcyA9IGNzcyB9XG5cbiAgICAgICAgZ2V0IGNsYXNzTmFtZSgpOiBzdHJpbmcgeyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jbGFzc19uYW1lcyh0aGlzKS5qb2luKFwiIFwiKSB9XG4gICAgICAgIHNldCBjbGFzc05hbWUoY2xhc3NOYW1lOiBzdHJpbmcpIHsgQXN0YWwud2lkZ2V0X3NldF9jbGFzc19uYW1lcyh0aGlzLCBjbGFzc05hbWUuc3BsaXQoL1xccysvKSkgfVxuICAgICAgICBnZXRfY2xhc3NfbmFtZSgpOiBzdHJpbmcgeyByZXR1cm4gdGhpcy5jbGFzc05hbWUgfVxuICAgICAgICBzZXRfY2xhc3NfbmFtZShjbGFzc05hbWU6IHN0cmluZykgeyB0aGlzLmNsYXNzTmFtZSA9IGNsYXNzTmFtZSB9XG5cbiAgICAgICAgZ2V0IGN1cnNvcigpOiBDdXJzb3IgeyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jdXJzb3IodGhpcykgYXMgQ3Vyc29yIH1cbiAgICAgICAgc2V0IGN1cnNvcihjdXJzb3I6IEN1cnNvcikgeyBBc3RhbC53aWRnZXRfc2V0X2N1cnNvcih0aGlzLCBjdXJzb3IpIH1cbiAgICAgICAgZ2V0X2N1cnNvcigpOiBDdXJzb3IgeyByZXR1cm4gdGhpcy5jdXJzb3IgfVxuICAgICAgICBzZXRfY3Vyc29yKGN1cnNvcjogQ3Vyc29yKSB7IHRoaXMuY3Vyc29yID0gY3Vyc29yIH1cblxuICAgICAgICBnZXQgY2xpY2tUaHJvdWdoKCk6IGJvb2xlYW4geyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jbGlja190aHJvdWdoKHRoaXMpIH1cbiAgICAgICAgc2V0IGNsaWNrVGhyb3VnaChjbGlja1Rocm91Z2g6IGJvb2xlYW4pIHsgQXN0YWwud2lkZ2V0X3NldF9jbGlja190aHJvdWdoKHRoaXMsIGNsaWNrVGhyb3VnaCkgfVxuICAgICAgICBnZXRfY2xpY2tfdGhyb3VnaCgpOiBib29sZWFuIHsgcmV0dXJuIHRoaXMuY2xpY2tUaHJvdWdoIH1cbiAgICAgICAgc2V0X2NsaWNrX3Rocm91Z2goY2xpY2tUaHJvdWdoOiBib29sZWFuKSB7IHRoaXMuY2xpY2tUaHJvdWdoID0gY2xpY2tUaHJvdWdoIH1cblxuICAgICAgICBkZWNsYXJlIHByaXZhdGUgW25vSW1wbGljaXREZXN0cm95XTogYm9vbGVhblxuICAgICAgICBnZXQgbm9JbXBsaWNpdERlc3Ryb3koKTogYm9vbGVhbiB7IHJldHVybiB0aGlzW25vSW1wbGljaXREZXN0cm95XSB9XG4gICAgICAgIHNldCBub0ltcGxpY2l0RGVzdHJveSh2YWx1ZTogYm9vbGVhbikgeyB0aGlzW25vSW1wbGljaXREZXN0cm95XSA9IHZhbHVlIH1cblxuICAgICAgICBzZXQgYWN0aW9uR3JvdXAoW3ByZWZpeCwgZ3JvdXBdOiBBY3Rpb25Hcm91cCkgeyB0aGlzLmluc2VydF9hY3Rpb25fZ3JvdXAocHJlZml4LCBncm91cCkgfVxuICAgICAgICBzZXRfYWN0aW9uX2dyb3VwKGFjdGlvbkdyb3VwOiBBY3Rpb25Hcm91cCkgeyB0aGlzLmFjdGlvbkdyb3VwID0gYWN0aW9uR3JvdXAgfVxuXG4gICAgICAgIHByb3RlY3RlZCBnZXRDaGlsZHJlbigpOiBBcnJheTxHdGsuV2lkZ2V0PiB7XG4gICAgICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIEd0ay5CaW4pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRfY2hpbGQoKSA/IFt0aGlzLmdldF9jaGlsZCgpIV0gOiBbXVxuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkNvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldF9jaGlsZHJlbigpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gW11cbiAgICAgICAgfVxuXG4gICAgICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICAgICAgICAgID8gY2hcbiAgICAgICAgICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcblxuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBjaCBvZiBjaGlsZHJlbilcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5hZGQoY2gpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRocm93IEVycm9yKGBjYW4gbm90IGFkZCBjaGlsZHJlbiB0byAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgW3NldENoaWxkcmVuXShjaGlsZHJlbjogYW55W10pIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQ29udGFpbmVyKSB7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBjaCBvZiB0aGlzLmdldENoaWxkcmVuKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5yZW1vdmUoY2gpXG4gICAgICAgICAgICAgICAgICAgIGlmICghY2hpbGRyZW4uaW5jbHVkZXMoY2gpICYmICF0aGlzLm5vSW1wbGljaXREZXN0cm95KVxuICAgICAgICAgICAgICAgICAgICAgICAgY2g/LmRlc3Ryb3koKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gYXBwZW5kXG4gICAgICAgICAgICB0aGlzLnNldENoaWxkcmVuKGNoaWxkcmVuKVxuICAgICAgICB9XG5cbiAgICAgICAgdG9nZ2xlQ2xhc3NOYW1lKGNuOiBzdHJpbmcsIGNvbmQgPSB0cnVlKSB7XG4gICAgICAgICAgICBBc3RhbC53aWRnZXRfdG9nZ2xlX2NsYXNzX25hbWUodGhpcywgY24sIGNvbmQpXG4gICAgICAgIH1cblxuICAgICAgICBob29rKFxuICAgICAgICAgICAgb2JqZWN0OiBDb25uZWN0YWJsZSxcbiAgICAgICAgICAgIHNpZ25hbDogc3RyaW5nLFxuICAgICAgICAgICAgY2FsbGJhY2s6IChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgICAgICAgKTogdGhpc1xuICAgICAgICBob29rKFxuICAgICAgICAgICAgb2JqZWN0OiBTdWJzY3JpYmFibGUsXG4gICAgICAgICAgICBjYWxsYmFjazogKHNlbGY6IHRoaXMsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuICAgICAgICApOiB0aGlzXG4gICAgICAgIGhvb2soXG4gICAgICAgICAgICBvYmplY3Q6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlLFxuICAgICAgICAgICAgc2lnbmFsT3JDYWxsYmFjazogc3RyaW5nIHwgKChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCksXG4gICAgICAgICAgICBjYWxsYmFjaz86IChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgICAgICAgKSB7XG4gICAgICAgICAgICBob29rKHRoaXMsIG9iamVjdCwgc2lnbmFsT3JDYWxsYmFjaywgY2FsbGJhY2spXG4gICAgICAgICAgICByZXR1cm4gdGhpc1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3RydWN0b3IoLi4ucGFyYW1zOiBhbnlbXSkge1xuICAgICAgICAgICAgc3VwZXIoKVxuICAgICAgICAgICAgY29uc3QgcHJvcHMgPSBwYXJhbXNbMF0gfHwge31cbiAgICAgICAgICAgIHByb3BzLnZpc2libGUgPz89IHRydWVcbiAgICAgICAgICAgIGNvbnN0cnVjdCh0aGlzLCBwcm9wcylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7XG4gICAgICAgIEdUeXBlTmFtZTogYEFzdGFsXyR7Y2xzTmFtZX1gLFxuICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICBcImNsYXNzLW5hbWVcIjogR09iamVjdC5QYXJhbVNwZWMuc3RyaW5nKFxuICAgICAgICAgICAgICAgIFwiY2xhc3MtbmFtZVwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBcIlwiLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwiY3NzXCI6IEdPYmplY3QuUGFyYW1TcGVjLnN0cmluZyhcbiAgICAgICAgICAgICAgICBcImNzc1wiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBcIlwiLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwiY3Vyc29yXCI6IEdPYmplY3QuUGFyYW1TcGVjLnN0cmluZyhcbiAgICAgICAgICAgICAgICBcImN1cnNvclwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBcImRlZmF1bHRcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcImNsaWNrLXRocm91Z2hcIjogR09iamVjdC5QYXJhbVNwZWMuYm9vbGVhbihcbiAgICAgICAgICAgICAgICBcImNsaWNrLXRocm91Z2hcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgZmFsc2UsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgXCJuby1pbXBsaWNpdC1kZXN0cm95XCI6IEdPYmplY3QuUGFyYW1TcGVjLmJvb2xlYW4oXG4gICAgICAgICAgICAgICAgXCJuby1pbXBsaWNpdC1kZXN0cm95XCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIGZhbHNlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICB9LCBXaWRnZXQpXG5cbiAgICByZXR1cm4gV2lkZ2V0XG59XG5cbnR5cGUgU2lnSGFuZGxlcjxcbiAgICBXIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBBcmdzIGV4dGVuZHMgQXJyYXk8dW5rbm93bj4sXG4+ID0gKChzZWxmOiBXLCAuLi5hcmdzOiBBcmdzKSA9PiB1bmtub3duKSB8IHN0cmluZyB8IHN0cmluZ1tdXG5cbmV4cG9ydCB0eXBlIEJpbmRhYmxlQ2hpbGQgPSBHdGsuV2lkZ2V0IHwgQmluZGluZzxHdGsuV2lkZ2V0PlxuXG5leHBvcnQgdHlwZSBDb25zdHJ1Y3RQcm9wczxcbiAgICBTZWxmIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBQcm9wcyBleHRlbmRzIEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyxcbiAgICBTaWduYWxzIGV4dGVuZHMgUmVjb3JkPGBvbiR7c3RyaW5nfWAsIEFycmF5PHVua25vd24+PiA9IFJlY29yZDxgb24ke3N0cmluZ31gLCBhbnlbXT4sXG4+ID0gUGFydGlhbDx7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjYW4ndCBhc3NpZ24gdG8gdW5rbm93biwgYnV0IGl0IHdvcmtzIGFzIGV4cGVjdGVkIHRob3VnaFxuICAgIFtTIGluIGtleW9mIFNpZ25hbHNdOiBTaWdIYW5kbGVyPFNlbGYsIFNpZ25hbHNbU10+XG59PiAmIFBhcnRpYWw8e1xuICAgIFtLZXkgaW4gYG9uJHtzdHJpbmd9YF06IFNpZ0hhbmRsZXI8U2VsZiwgYW55W10+XG59PiAmIEJpbmRhYmxlUHJvcHM8UGFydGlhbDxQcm9wcyAmIHtcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgICBjc3M/OiBzdHJpbmdcbiAgICBjdXJzb3I/OiBzdHJpbmdcbiAgICBjbGlja1Rocm91Z2g/OiBib29sZWFuXG4gICAgYWN0aW9uR3JvdXA/OiBBY3Rpb25Hcm91cFxufT4+ICYgUGFydGlhbDx7XG4gICAgb25EZXN0cm95OiAoc2VsZjogU2VsZikgPT4gdW5rbm93blxuICAgIG9uRHJhdzogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBvbktleVByZXNzRXZlbnQ6IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB1bmtub3duXG4gICAgb25LZXlSZWxlYXNlRXZlbnQ6IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB1bmtub3duXG4gICAgb25CdXR0b25QcmVzc0V2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uQnV0dG9uUmVsZWFzZUV2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uUmVhbGl6ZTogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBzZXR1cDogKHNlbGY6IFNlbGYpID0+IHZvaWRcbn0+XG5cbnR5cGUgQ3Vyc29yID1cbiAgICB8IFwiZGVmYXVsdFwiXG4gICAgfCBcImhlbHBcIlxuICAgIHwgXCJwb2ludGVyXCJcbiAgICB8IFwiY29udGV4dC1tZW51XCJcbiAgICB8IFwicHJvZ3Jlc3NcIlxuICAgIHwgXCJ3YWl0XCJcbiAgICB8IFwiY2VsbFwiXG4gICAgfCBcImNyb3NzaGFpclwiXG4gICAgfCBcInRleHRcIlxuICAgIHwgXCJ2ZXJ0aWNhbC10ZXh0XCJcbiAgICB8IFwiYWxpYXNcIlxuICAgIHwgXCJjb3B5XCJcbiAgICB8IFwibm8tZHJvcFwiXG4gICAgfCBcIm1vdmVcIlxuICAgIHwgXCJub3QtYWxsb3dlZFwiXG4gICAgfCBcImdyYWJcIlxuICAgIHwgXCJncmFiYmluZ1wiXG4gICAgfCBcImFsbC1zY3JvbGxcIlxuICAgIHwgXCJjb2wtcmVzaXplXCJcbiAgICB8IFwicm93LXJlc2l6ZVwiXG4gICAgfCBcIm4tcmVzaXplXCJcbiAgICB8IFwiZS1yZXNpemVcIlxuICAgIHwgXCJzLXJlc2l6ZVwiXG4gICAgfCBcInctcmVzaXplXCJcbiAgICB8IFwibmUtcmVzaXplXCJcbiAgICB8IFwibnctcmVzaXplXCJcbiAgICB8IFwic3ctcmVzaXplXCJcbiAgICB8IFwic2UtcmVzaXplXCJcbiAgICB8IFwiZXctcmVzaXplXCJcbiAgICB8IFwibnMtcmVzaXplXCJcbiAgICB8IFwibmVzdy1yZXNpemVcIlxuICAgIHwgXCJud3NlLXJlc2l6ZVwiXG4gICAgfCBcInpvb20taW5cIlxuICAgIHwgXCJ6b29tLW91dFwiXG5cbnR5cGUgQWN0aW9uR3JvdXAgPSBbcHJlZml4OiBzdHJpbmcsIGFjdGlvbkdyb3VwOiBHaW8uQWN0aW9uR3JvdXBdXG4iLCAiaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IHsgdHlwZSBCaW5kYWJsZUNoaWxkIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuaW1wb3J0IHsgbWVyZ2VCaW5kaW5ncywganN4IGFzIF9qc3ggfSBmcm9tIFwiLi4vX2FzdGFsLmpzXCJcbmltcG9ydCAqIGFzIFdpZGdldCBmcm9tIFwiLi93aWRnZXQuanNcIlxuXG5leHBvcnQgZnVuY3Rpb24gRnJhZ21lbnQoeyBjaGlsZHJlbiA9IFtdLCBjaGlsZCB9OiB7XG4gICAgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkXG4gICAgY2hpbGRyZW4/OiBBcnJheTxCaW5kYWJsZUNoaWxkPlxufSkge1xuICAgIGlmIChjaGlsZCkgY2hpbGRyZW4ucHVzaChjaGlsZClcbiAgICByZXR1cm4gbWVyZ2VCaW5kaW5ncyhjaGlsZHJlbilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGpzeChcbiAgICBjdG9yOiBrZXlvZiB0eXBlb2YgY3RvcnMgfCB0eXBlb2YgR3RrLldpZGdldCxcbiAgICBwcm9wczogYW55LFxuKSB7XG4gICAgcmV0dXJuIF9qc3goY3RvcnMsIGN0b3IgYXMgYW55LCBwcm9wcylcbn1cblxuY29uc3QgY3RvcnMgPSB7XG4gICAgYm94OiBXaWRnZXQuQm94LFxuICAgIGJ1dHRvbjogV2lkZ2V0LkJ1dHRvbixcbiAgICBjZW50ZXJib3g6IFdpZGdldC5DZW50ZXJCb3gsXG4gICAgY2lyY3VsYXJwcm9ncmVzczogV2lkZ2V0LkNpcmN1bGFyUHJvZ3Jlc3MsXG4gICAgZHJhd2luZ2FyZWE6IFdpZGdldC5EcmF3aW5nQXJlYSxcbiAgICBlbnRyeTogV2lkZ2V0LkVudHJ5LFxuICAgIGV2ZW50Ym94OiBXaWRnZXQuRXZlbnRCb3gsXG4gICAgLy8gVE9ETzogZml4ZWRcbiAgICAvLyBUT0RPOiBmbG93Ym94XG4gICAgaWNvbjogV2lkZ2V0Lkljb24sXG4gICAgbGFiZWw6IFdpZGdldC5MYWJlbCxcbiAgICBsZXZlbGJhcjogV2lkZ2V0LkxldmVsQmFyLFxuICAgIC8vIFRPRE86IGxpc3Rib3hcbiAgICBtZW51YnV0dG9uOiBXaWRnZXQuTWVudUJ1dHRvbixcbiAgICBvdmVybGF5OiBXaWRnZXQuT3ZlcmxheSxcbiAgICByZXZlYWxlcjogV2lkZ2V0LlJldmVhbGVyLFxuICAgIHNjcm9sbGFibGU6IFdpZGdldC5TY3JvbGxhYmxlLFxuICAgIHNsaWRlcjogV2lkZ2V0LlNsaWRlcixcbiAgICBzdGFjazogV2lkZ2V0LlN0YWNrLFxuICAgIHN3aXRjaDogV2lkZ2V0LlN3aXRjaCxcbiAgICB3aW5kb3c6IFdpZGdldC5XaW5kb3csXG59XG5cbmRlY2xhcmUgZ2xvYmFsIHtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5hbWVzcGFjZVxuICAgIG5hbWVzcGFjZSBKU1gge1xuICAgICAgICB0eXBlIEVsZW1lbnQgPSBHdGsuV2lkZ2V0XG4gICAgICAgIHR5cGUgRWxlbWVudENsYXNzID0gR3RrLldpZGdldFxuICAgICAgICBpbnRlcmZhY2UgSW50cmluc2ljRWxlbWVudHMge1xuICAgICAgICAgICAgYm94OiBXaWRnZXQuQm94UHJvcHNcbiAgICAgICAgICAgIGJ1dHRvbjogV2lkZ2V0LkJ1dHRvblByb3BzXG4gICAgICAgICAgICBjZW50ZXJib3g6IFdpZGdldC5DZW50ZXJCb3hQcm9wc1xuICAgICAgICAgICAgY2lyY3VsYXJwcm9ncmVzczogV2lkZ2V0LkNpcmN1bGFyUHJvZ3Jlc3NQcm9wc1xuICAgICAgICAgICAgZHJhd2luZ2FyZWE6IFdpZGdldC5EcmF3aW5nQXJlYVByb3BzXG4gICAgICAgICAgICBlbnRyeTogV2lkZ2V0LkVudHJ5UHJvcHNcbiAgICAgICAgICAgIGV2ZW50Ym94OiBXaWRnZXQuRXZlbnRCb3hQcm9wc1xuICAgICAgICAgICAgLy8gVE9ETzogZml4ZWRcbiAgICAgICAgICAgIC8vIFRPRE86IGZsb3dib3hcbiAgICAgICAgICAgIGljb246IFdpZGdldC5JY29uUHJvcHNcbiAgICAgICAgICAgIGxhYmVsOiBXaWRnZXQuTGFiZWxQcm9wc1xuICAgICAgICAgICAgbGV2ZWxiYXI6IFdpZGdldC5MZXZlbEJhclByb3BzXG4gICAgICAgICAgICAvLyBUT0RPOiBsaXN0Ym94XG4gICAgICAgICAgICBtZW51YnV0dG9uOiBXaWRnZXQuTWVudUJ1dHRvblByb3BzXG4gICAgICAgICAgICBvdmVybGF5OiBXaWRnZXQuT3ZlcmxheVByb3BzXG4gICAgICAgICAgICByZXZlYWxlcjogV2lkZ2V0LlJldmVhbGVyUHJvcHNcbiAgICAgICAgICAgIHNjcm9sbGFibGU6IFdpZGdldC5TY3JvbGxhYmxlUHJvcHNcbiAgICAgICAgICAgIHNsaWRlcjogV2lkZ2V0LlNsaWRlclByb3BzXG4gICAgICAgICAgICBzdGFjazogV2lkZ2V0LlN0YWNrUHJvcHNcbiAgICAgICAgICAgIHN3aXRjaDogV2lkZ2V0LlN3aXRjaFByb3BzXG4gICAgICAgICAgICB3aW5kb3c6IFdpZGdldC5XaW5kb3dQcm9wc1xuICAgICAgICB9XG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QganN4cyA9IGpzeFxuIiwgIi8vIFRoZSBkb2NrLiBCZWhhdmlvciBtb2RlbCAocHJvdG90eXBlLWZpbmFsKTpcbi8vICAgY2xpY2sgIFx1MjAxNCBubyB3aW5kb3dzOiBsYXVuY2ggKGdob3N0IHpvb20pIFx1MDBCNyB1bmZvY3VzZWQ6IGZvY3VzIHRvcCB3aW5kb3cgKHB1bHNlKVxuLy8gICAgICAgICAgICBmb2N1c2VkICsgbXVsdGk6IGN5Y2xlIFx1MDBCNyBmb2N1c2VkICsgc2luZ2xlOiBtaW5pbWl6ZVxuLy8gICBzY3JvbGwgXHUyMDE0IHNpbmdsZTogZm9jdXMgXHUwMEI3IG11bHRpOiBjeWNsZSAoY2Fyb3VzZWwgbnVkZ2UsIHN0YW5kYXJkIGRpcmVjdGlvbilcbi8vICAgbWlkZGxlLWNsaWNrIFx1MjAxNCBuZXcgd2luZG93IFx1MDBCNyByaWdodC1jbGljayBcdTIwMTQgY29udGV4dCBtZW51ICh3aW5kb3dzIGxpc3QgKyBRdWl0KVxuLy8gRE9UUzogYWJzb2x1dGUgb3ZlcmxheSAoR3RrLk92ZXJsYXkpLCBzbGlkaW5nIDQtZG90IHZpZXdwb3J0LCBlZGdlIG1pbmlzIHBhc3QgNCxcbi8vIGR5aW5nLWRvdCBjbG9zZSBhbmltYXRpb24uIEljb25zIG93biBBTEwgZ2VvbWV0cnkuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IGJpbmQsIFZhcmlhYmxlLCBleGVjQXN5bmMgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEFwcHMgZnJvbSBcImdpOi8vQXN0YWxBcHBzXCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvXCJcbmltcG9ydCB7IE1PVElPTiwgc3ByaW5nLCBzcHJpbmdUbyB9IGZyb20gXCIuLi9saWIvc3ByaW5nXCJcbmltcG9ydCAqIGFzIGdub2JsaW4gZnJvbSBcIi4uL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0IHsgREVNTyB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbmNvbnN0IFBJTk5FRCA9IFtcbiAgXCJvcmcuZ25vbWUuUHR5eGlzXCIsIFwib3JnLmdub21lLk5hdXRpbHVzXCIsIFwiZmlyZWZveFwiLFxuICBcImRldi56ZWQuWmVkXCIsIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsIFwib3JnLmdub21lLlNldHRpbmdzXCIsXG5dXG5cbmZ1bmN0aW9uIERvdHMoeyBhcHBJZCB9OiB7IGFwcElkOiBzdHJpbmcgfSkge1xuICAvLyBTbGlkaW5nIHZpZXdwb3J0IGlkZW50aWNhbCB0byB0aGUgcHJvdG90eXBlOiBcdTIyNjQ0IGRvdHMsIGZvY3VzZWQgcGlsbCxcbiAgLy8gbWluaXMgd2hlbiB3aW5kb3dzIGV4aXN0IGJleW9uZCB0aGUgdmlzaWJsZSBzbGljZS5cbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJkb3RzXCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5FTkR9IHNwYWNpbmc9ezN9PlxuICAgIHtiaW5kKGdub2JsaW4ud2luZG93cykuYXMoKCkgPT4ge1xuICAgICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG4gICAgICBjb25zdCB0b3RhbCA9IHdzLmxlbmd0aFxuICAgICAgY29uc3QgbiA9IE1hdGgubWluKHRvdGFsLCA0KVxuICAgICAgY29uc3QgY3VyID0gd3MuZmluZEluZGV4KHcgPT4gdy5mb2N1c2VkKVxuICAgICAgbGV0IHN0YXJ0ID0gMFxuICAgICAgaWYgKHRvdGFsID4gNCkgc3RhcnQgPSBNYXRoLm1pbihNYXRoLm1heCgoY3VyIDwgMCA/IDAgOiBjdXIpIC0gMSwgMCksIHRvdGFsIC0gNClcbiAgICAgIHJldHVybiBBcnJheS5mcm9tKHsgbGVuZ3RoOiBuIH0sIChfLCBpKSA9PiB7XG4gICAgICAgIGNvbnN0IGlkeCA9IHN0YXJ0ICsgaVxuICAgICAgICBjb25zdCBjbHMgPSBbXCJkb3RcIl1cbiAgICAgICAgaWYgKGN1ciA+PSAwICYmIGlkeCA9PT0gY3VyKSBjbHMucHVzaChcIm9uXCIpXG4gICAgICAgIGlmICh0b3RhbCA+IDQgJiYgKChpID09PSAwICYmIHN0YXJ0ID4gMCkgfHwgKGkgPT09IG4gLSAxICYmIHN0YXJ0ICsgNCA8IHRvdGFsKSkpXG4gICAgICAgICAgY2xzLnB1c2goXCJtaW5pXCIpXG4gICAgICAgIHJldHVybiA8Ym94IGNsYXNzPXtjbHMuam9pbihcIiBcIil9IC8+XG4gICAgICB9KVxuICAgIH0pfVxuICA8L2JveD5cbn1cblxuZnVuY3Rpb24gRG9ja0J1dHRvbih7IGFwcCB9OiB7IGFwcDogQXBwcy5BcHBsaWNhdGlvbiB9KSB7XG4gIGNvbnN0IGFwcElkID0gYXBwLmVudHJ5LnJlcGxhY2UoL1xcLmRlc2t0b3AkLywgXCJcIilcblxuICBjb25zdCBvbkNsaWNrID0gKCkgPT4ge1xuICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgIGlmICghd3MubGVuZ3RoKSByZXR1cm4gdm9pZCBhcHAubGF1bmNoKCkgICAgICAgICAgLy8gKyBnaG9zdCB6b29tIChyZXZlYWxlciBzY2FsZSBhbmltKVxuICAgIGNvbnN0IGZvY3VzZWQgPSB3cy5maW5kKHcgPT4gdy5mb2N1c2VkKVxuICAgIGlmICghZm9jdXNlZCkgcmV0dXJuIHZvaWQgZ25vYmxpbi5hY3RpdmF0ZShcbiAgICAgIHdzLnNsaWNlKCkuc29ydCgoYSwgYikgPT4gTnVtYmVyKGIuZm9jdXNlZCkgLSBOdW1iZXIoYS5mb2N1c2VkKSlbMF0uaWQpXG4gICAgaWYgKHdzLmxlbmd0aCA+IDEpIHJldHVybiB2b2lkIGdub2JsaW4uY3ljbGUoYXBwSWQsIDEpXG4gICAgZ25vYmxpbi5taW5pbWl6ZShmb2N1c2VkLmlkKVxuICB9XG5cbiAgcmV0dXJuIDxidXR0b25cbiAgICBjbGFzcz1cImRidG5cIiB0b29sdGlwVGV4dD17YXBwLm5hbWV9XG4gICAgb25DbGlja2VkPXtvbkNsaWNrfVxuICAgIG9uQnV0dG9uUHJlc3NlZD17KF93LCBlKSA9PiB7ICAgICAgICAgICAvLyBtaWRkbGUtY2xpY2sgXHUyMTkyIG5ldyB3aW5kb3dcbiAgICAgIGlmIChlLmdldF9idXR0b24oKSA9PT0gR2RrLkJVVFRPTl9NSURETEUpIGFwcC5sYXVuY2goKVxuICAgIH19XG4gICAgb25TY3JvbGw9eyhfdywgX2R4LCBkeSkgPT4ge1xuICAgICAgY29uc3Qgd3MgPSBnbm9ibGluLmFwcFdpbmRvd3MoYXBwSWQpXG4gICAgICBpZiAoIXdzLmxlbmd0aCkgcmV0dXJuXG4gICAgICBpZiAod3MubGVuZ3RoID4gMSkgZ25vYmxpbi5jeWNsZShhcHBJZCwgZHkgPiAwID8gMSA6IC0xKVxuICAgICAgZWxzZSBpZiAoIXdzWzBdLmZvY3VzZWQpIGdub2JsaW4uYWN0aXZhdGUod3NbMF0uaWQpXG4gICAgfX0+XG4gICAgPG92ZXJsYXk+XG4gICAgICA8aW1hZ2UgY2xhc3M9XCJpY29uLXRpbGVcIiBpY29uTmFtZT17YXBwLmljb25fbmFtZSB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwifVxuICAgICAgICAgICAgIHBpeGVsU2l6ZT17MzB9IC8+XG4gICAgICB7LyogZG90cyBhcyBPVkVSTEFZIFx1MjAxNCB6ZXJvIGxheW91dCBmb290cHJpbnQgKi99XG4gICAgICA8RG90cyB0eXBlPVwib3ZlcmxheVwiIGFwcElkPXthcHBJZH0gLz5cbiAgICA8L292ZXJsYXk+XG4gIDwvYnV0dG9uPlxufVxuXG5mdW5jdGlvbiBNZWRpYVdpZGdldCgpIHtcbiAgLy8gZG9jayB3aWRnZXQgcHJvb2Ytb2YtY29uY2VwdDogYWxidW0gZ2x5cGggKHJvdW5kZWQgY2hpcCkgKyBsaXZlIHByb2dyZXNzLCBjbGljayA9IHBsYXkvcGF1c2VcbiAgcmV0dXJuIDxidXR0b24gY2xhc3M9XCJkYnRuIGR3aWRnZXRcIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICA8b3ZlcmxheT5cbiAgICAgIDxib3ggY2xhc3M9XCJkdGlsZVwiPlxuICAgICAgICA8aW1hZ2UgY2xhc3M9XCJkZ1wiIGljb25OYW1lPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIiBwaXhlbFNpemU9ezE4fVxuICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IGhleHBhbmQgdmV4cGFuZCAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8bGV2ZWxiYXIgdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cIm1wcm9nXCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5FTkR9XG4gICAgICAgICAgICAgICAgdmFsdWU9ezAuMzR9IC8+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBERU1PIG1vZGU6IHJlbmRlciB0aGUgcHJvdG90eXBlJ3MgRVhBQ1QgZG9jayAoZG9jcy9wcm90b3R5cGUuaHRtbCkgd2l0aCByZWFsIEdUS1xuLy8gd2lkZ2V0cywgc28gaXQgY2FuIGJlIHBpeGVsLW92ZXJsYWlkIG9uIHRoZSBwcm90b3R5cGUgcmVuZGVyIDE6MS4gSWNvbnMgbG9hZCBmcm9tIHRoZVxuLy8gU0FNRSBvbi1kaXNrIGZpbGVzIHRoZSBwcm90b3R5cGUgcmVmZXJlbmNlcyAodmlhIGEgRmlsZUljb24gZ2ljb24pIHJhdGhlciB0aGFuIGJ5XG4vLyB0aGVtZWQgbmFtZSBcdTIwMTQgYSB0aGVtZWQgbG9va3VwIHNuYXBzIHRvIGEgZGlmZmVyZW50IHNpemUgdmFyaWFudCAoZS5nLiB0aGUgMzJweCBmaXJlZm94XG4vLyBpbnN0ZWFkIG9mIHRoZSBwcm90b3R5cGUncyAyNTZweCBwbmcpIGFuZCBkb3duc2NhbGVzIGRpZmZlcmVudGx5LiBTYW1lIHNvdXJjZSBmaWxlIFx1MjE5MlxuLy8gY2xvc2VzdCBjcm9zcy1lbmdpbmUgbWF0Y2guIChwaXhlbC1zaXplIGlzIGhvbm91cmVkIG5vdyB0aGUgaWNvbi10aWxlIG1pbiBpcyAzMC4pXG5jb25zdCBERU1PX0FQUFMgPSBbXG4gIHsgbmFtZTogXCJUZXJtaW5hbFwiLCBpY29uOiBcIi91c3Ivc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL29yZy5nbm9tZS5QdHl4aXMuc3ZnXCIsICAgICAgICAgICBkb3RzOiBbXCJvblwiLCBcImRvdFwiXSB9LFxuICB7IG5hbWU6IFwiRmlsZXNcIiwgICAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuTmF1dGlsdXMuc3ZnXCIsICAgICAgICAgZG90czogW1wiZG90XCJdIH0sXG4gIHsgbmFtZTogXCJGaXJlZm94XCIsICBpY29uOiBcIi91c3Ivc2hhcmUvaWNvbnMvaGljb2xvci8yNTZ4MjU2L2FwcHMvZmlyZWZveC5wbmdcIiwgICAgICAgICAgICAgICAgICAgICBkb3RzOiBbXSB9LFxuICB7IG5hbWU6IFwiWmVkXCIsICAgICAgaWNvbjogXCIvaG9tZS9raWVyYW4vLmxvY2FsL3plZC5hcHAvc2hhcmUvaWNvbnMvaGljb2xvci81MTJ4NTEyL2FwcHMvemVkLnBuZ1wiLCAgZG90czogW10gfSxcbiAgeyBuYW1lOiBcIlNwb3RpZnlcIiwgIGljb246IFwiL3Zhci9saWIvZmxhdHBhay9leHBvcnRzL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9jb20uc3BvdGlmeS5DbGllbnQuc3ZnXCIsIGRvdHM6IFtdIH0sXG4gIHsgbmFtZTogXCJTZXR0aW5nc1wiLCBpY29uOiBcIi91c3Ivc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL29yZy5nbm9tZS5TZXR0aW5ncy5zdmdcIiwgICAgICAgICBkb3RzOiBbXSB9LFxuXVxuXG5mdW5jdGlvbiBmaWxlSWNvbihwYXRoOiBzdHJpbmcpOiBHaW8uSWNvbiB7XG4gIHJldHVybiBHaW8uRmlsZUljb24ubmV3KEdpby5GaWxlLm5ld19mb3JfcGF0aChwYXRoKSlcbn1cblxuZnVuY3Rpb24gRGVtb0J1dHRvbih7IGFwcCB9OiB7IGFwcDogKHR5cGVvZiBERU1PX0FQUFMpW251bWJlcl0gfSkge1xuICAvLyBOQjogdGhlIGRvdHMgYm94IGNhcnJpZXMgYHR5cGU9XCJvdmVybGF5XCJgIERJUkVDVExZIChpbnRyaW5zaWMgZWxlbWVudCkgXHUyMDE0IGEgZnVuY3Rpb25cbiAgLy8gY29tcG9uZW50IHdvdWxkIHN3YWxsb3cgdGhlIHByb3AsIGxldHRpbmcgdGhlIHVudHlwZWQgYm94IHJlcGxhY2UgdGhlIGljb24gYXMgdGhlXG4gIC8vIG92ZXJsYXkncyBtYWluIGNoaWxkIChHdGtPdmVybGF5LnNldF9jaGlsZCkuIEljb24gc3RheXMgbWFpbjsgZG90cyBvdmVybGF5IG9uIHRvcC5cbiAgcmV0dXJuIDxidXR0b24gY2xhc3M9XCJkYnRuXCIgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfT5cbiAgICA8b3ZlcmxheT5cbiAgICAgIDxpbWFnZSBjbGFzcz1cImljb24tdGlsZVwiIGdpY29uPXtmaWxlSWNvbihhcHAuaWNvbil9IHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICA8Ym94IHR5cGU9XCJvdmVybGF5XCIgY2xhc3M9XCJkb3RzXCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5FTkR9IHNwYWNpbmc9ezN9PlxuICAgICAgICB7YXBwLmRvdHMubWFwKGNscyA9PiA8Ym94IGNsYXNzPXtjbHMgPT09IFwib25cIiA/IFwiZG90IG9uXCIgOiBcImRvdFwifSAvPil9XG4gICAgICA8L2JveD5cbiAgICA8L292ZXJsYXk+XG4gIDwvYnV0dG9uPlxufVxuXG5mdW5jdGlvbiBEZW1vRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJkb2NrXCIgbmFtZXNwYWNlPVwia29iZWwtZG9ja1wiIGNsYXNzPVwiZG9jay13aW5kb3dcIlxuICAgIGdka21vbml0b3I9e21vbml0b3J9IGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX0+XG4gICAgPGJveCBjbGFzcz1cImRvY2tcIiBzcGFjaW5nPXs0fT5cbiAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzBdfSAvPlxuICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMV19IC8+XG4gICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1syXX0gLz5cbiAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzNdfSAvPlxuICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzRdfSAvPlxuICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNV19IC8+XG4gICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgPE1lZGlhV2lkZ2V0IC8+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBEb2NrKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIGlmIChERU1PKSByZXR1cm4gRGVtb0RvY2sobW9uaXRvcilcblxuICBjb25zdCBhcHBzID0gbmV3IEFwcHMuQXBwcygpXG4gIC8vIFBpbm5lZCBlbnRyaWVzIHJlc29sdmVkIGJ5IGRlc2t0b3AtaWQ7IHRoZSBkb2NrIG5ldmVyIHNpdHMgZW1wdHksIHNvIGZpbGwgYW55XG4gIC8vIHVucmVzb2x2ZWQgc2xvdHMgKGUuZy4gYW4gYXBwIG5vdCBpbnN0YWxsZWQgaW4gdGhlIGRldmtpdCkgZnJvbSB0aGUgaW5zdGFsbGVkXG4gIC8vIGxpc3QuIE9uIHJlYWwgaGFyZHdhcmUgdGhlIHBpbnMgcmVzb2x2ZSBhbmQgdGhlIGZpbGwgaXMgdW51c2VkLlxuICBjb25zdCBhbGwgPSBhcHBzLmdldF9saXN0KClcbiAgY29uc3QgcmVzb2x2ZSA9IChpZDogc3RyaW5nKTogQXBwcy5BcHBsaWNhdGlvbiB8IHVuZGVmaW5lZCA9PlxuICAgIGFsbC5maW5kKGEgPT4gYS5lbnRyeSA9PT0gYCR7aWR9LmRlc2t0b3BgIHx8IGEuZW50cnkgPT09IGlkKVxuICAgID8/IGFsbC5maW5kKGEgPT4gYS5lbnRyeT8udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhpZC50b0xvd2VyQ2FzZSgpLnNwbGl0KFwiLlwiKS5wb3AoKSEpKVxuICAvLyBBbHdheXMgcmVuZGVyIG9uZSBzbG90IHBlciBwaW4gc28gdGhlIGRvY2sga2VlcHMgaXRzIHNoYXBlOyByZXNvbHZlZCBwaW5zIGdldCB0aGVcbiAgLy8gcmVhbCBhcHAgKyBiZWhhdmlvciwgdW5yZXNvbHZlZCBvbmVzIGEgbGFiZWxsZWQgcGxhY2Vob2xkZXIgdGlsZS4gQSBzZXBhcmF0b3Igc2l0c1xuICAvLyBiZXR3ZWVuIHRoZSBmb3VydGggYW5kIGZpZnRoIHBpbnMgKHByb3RvdHlwZSBwYXJpdHkpLCB0aGVuIGJlZm9yZSB0aGUgbWVkaWEgd2lkZ2V0LlxuICBjb25zdCBzbG90cyA9IFBJTk5FRC5tYXAoaWQgPT4gKHsgaWQsIGFwcDogcmVzb2x2ZShpZCkgfSkpXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImRvY2tcIiBuYW1lc3BhY2U9XCJrb2JlbC1kb2NrXCIgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgZ2RrbW9uaXRvcj17bW9uaXRvcn0gYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfT5cbiAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAge3Nsb3RzLm1hcCgoeyBpZCwgYXBwIH0sIGkpID0+IFtcbiAgICAgICAgaSA9PT0gNCA/IDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+IDogbnVsbCxcbiAgICAgICAgYXBwXG4gICAgICAgICAgPyA8RG9ja0J1dHRvbiBhcHA9e2FwcH0gLz5cbiAgICAgICAgICA6IDxidXR0b24gY2xhc3M9XCJkYnRuIHBsYWNlaG9sZGVyXCIgdG9vbHRpcFRleHQ9e2lkLnNwbGl0KFwiLlwiKS5wb3AoKX0+XG4gICAgICAgICAgICAgIDxpbWFnZSBjbGFzcz1cImljb24tdGlsZVwiIGljb25OYW1lPVwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlLXN5bWJvbGljXCIgcGl4ZWxTaXplPXszMH0gLz5cbiAgICAgICAgICAgIDwvYnV0dG9uPixcbiAgICAgIF0pfVxuICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBUaGUgc3BvdGxpZ2h0LiBQcm90b3R5cGUtZmluYWwgYmVoYXZpb3I6XG4vLyAgIFN1cGVyIHJlbGVhc2Ugb3BlbnMgKGNvbXBvc2l0b3Iga2V5YmluZCBcdTIxOTIgYGFzdGFsIC1pIGtvYmVsIC10IGxhdW5jaGVyYClcbi8vICAgZnV6enkgKyBsZWFmIGhpZ2hsaWdodCBcdTAwQjcgZ2xvYmFsIEJFU1QtTUFUQ0ggc2xvdCAoc2NvcmUtcmFua2VkIGFjcm9zcyBwcm92aWRlcnMsXG4vLyAgIHR5cGUgd2VpZ2h0cyBhcHBzIDEgLyBhY3Rpb25zIC45NSAvIGZpbGVzIC45KSBcdTAwQjcgY2FwcGVkIGxvZzIgZnJlY2VuY3lcbi8vICAgZ2hvc3QgYXV0b2NvbXBsZXRlID0gZmlyc3QgcHJlZml4LWNvbXBsZXRhYmxlIG5hbWUgaW4gZGlzcGxheSBvcmRlclxuLy8gICBUYWIgYWx3YXlzIG93bmVkIChnaG9zdCBlbHNlIG5leHQ7IFNoaWZ0K1RhYiBwcmV2KSBcdTAwQjcgQ3RybCtOL1AgXHUwMEI3IEVzYyBjbGVhcnMgZmlyc3Rcbi8vICAgc2VjdGlvbnM6IGJlc3QgbWF0Y2ggLyBhcHBzIC8gYWN0aW9ucyAvIGZpbGVzIC8gd2ViIChhbHdheXMtbGFzdCByZWFsIHJvdylcbi8vICAgJz0nIGNhbGN1bGF0b3IgXHUwMEI3ICc6JyBnbm9ibGluY3RsIGNvbW1hbmRzIFx1MDBCNyBlbXB0eSBzdGF0ZTogZG9jay10aWxlIGdyaWQgKyB3aWRnZXRzXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IEFwcHMgZnJvbSBcImdpOi8vQXN0YWxBcHBzXCJcbmltcG9ydCB7IGZ1enp5LCBobCwgYm9vc3QsIGJ1bXAsIGZyZXF1ZW5jeSB9IGZyb20gXCIuLi9saWIvZnV6enlcIlxuaW1wb3J0IHsgRVZFTlRTIH0gZnJvbSBcIi4vQ2FsZW5kYXJcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbi8vIEN1cmF0ZWQgZ3JpZDogdGhlIGRvY2sncyBwaW5uZWQgYXBwcyBmaXJzdCAocmVzb2x2ZWQgYnkgZGVza3RvcC1pZCksIHRoZW4gZmlsbCB0aGVcbi8vIHJlbWFpbmluZyBzbG90cyBieSBmcmVjZW5jeS4gTWF0Y2hlcyB0aGUgcHJvdG90eXBlJ3MgbGF1bmNoZXIgZW1wdHktc3RhdGUuXG5jb25zdCBQSU5ORUQgPSBbXCJvcmcuZ25vbWUuUHR5eGlzXCIsIFwib3JnLmdub21lLk5hdXRpbHVzXCIsIFwiZmlyZWZveFwiLFxuICBcImRldi56ZWQuWmVkXCIsIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsIFwib3JnLmdub21lLlNldHRpbmdzXCJdXG4vLyBEZW1vIGdyaWQ6IGZpeGVkIG9yZGVyICsgbGFiZWxzIHRyYW5zY3JpYmVkIGZyb20gdGhlIHByb3RvdHlwZSAoRC5hcHBzKSwgZWFjaCBtYXBwZWRcbi8vIHRvIHRoZSByZWFsIC5kZXNrdG9wIGlkIHNvIGl0cyB0aGVtZWQgaWNvbiByZW5kZXJzIChQdHl4aXMvTmF1dGlsdXMvXHUyMDI2KS5cbmNvbnN0IERFTU9fVElMRVMgPSBbXG4gIHsgbmFtZTogXCJUZXJtaW5hbFwiLCBpZDogXCJvcmcuZ25vbWUuUHR5eGlzXCIgfSxcbiAgeyBuYW1lOiBcIkZpbGVzXCIsIGlkOiBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiIH0sXG4gIHsgbmFtZTogXCJGaXJlZm94XCIsIGlkOiBcImZpcmVmb3hcIiB9LFxuICB7IG5hbWU6IFwiWmVkXCIsIGlkOiBcImRldi56ZWQuWmVkXCIgfSxcbiAgeyBuYW1lOiBcIlNwb3RpZnlcIiwgaWQ6IFwiY29tLnNwb3RpZnkuQ2xpZW50XCIgfSxcbiAgeyBuYW1lOiBcIlNldHRpbmdzXCIsIGlkOiBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiIH0sXG5dXG5cbmludGVyZmFjZSBUaWxlIHsgbmFtZTogc3RyaW5nOyBpY29uTmFtZTogc3RyaW5nOyBsYXVuY2g6ICgpID0+IHZvaWQgfVxuZnVuY3Rpb24gZ3JpZFRpbGVzKGFwcHM6IEFwcHMuQXBwcyk6IFRpbGVbXSB7XG4gIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICBjb25zdCByZXNvbHZlID0gKGlkOiBzdHJpbmcpOiBBcHBzLkFwcGxpY2F0aW9uIHwgdW5kZWZpbmVkID0+XG4gICAgYWxsLmZpbmQoYSA9PiBhLmVudHJ5ID09PSBgJHtpZH0uZGVza3RvcGAgfHwgYS5lbnRyeSA9PT0gaWQpXG4gICAgPz8gYWxsLmZpbmQoYSA9PiBhLmVudHJ5Py50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGlkLnRvTG93ZXJDYXNlKCkuc3BsaXQoXCIuXCIpLnBvcCgpISkpXG4gIGNvbnN0IGZyb21BcHAgPSAoYXBwOiBBcHBzLkFwcGxpY2F0aW9uKTogVGlsZSA9PiAoe1xuICAgIG5hbWU6IGFwcC5uYW1lLCBpY29uTmFtZTogYXBwLmljb25fbmFtZSB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgIGxhdW5jaDogKCkgPT4geyBidW1wKGFwcC5uYW1lKTsgYXBwLmxhdW5jaCgpIH0sXG4gIH0pXG4gIGlmIChERU1PKSByZXR1cm4gREVNT19USUxFUy5tYXAoKHsgbmFtZSwgaWQgfSkgPT4ge1xuICAgIGNvbnN0IGFwcCA9IHJlc29sdmUoaWQpXG4gICAgcmV0dXJuIHsgbmFtZSwgaWNvbk5hbWU6IGFwcD8uaWNvbl9uYW1lIHx8IGlkIHx8IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICBsYXVuY2g6ICgpID0+IHsgYnVtcChuYW1lKTsgYXBwPy5sYXVuY2goKSB9IH1cbiAgfSlcbiAgY29uc3QgcGlubmVkID0gUElOTkVELm1hcChyZXNvbHZlKS5maWx0ZXIoQm9vbGVhbikgYXMgQXBwcy5BcHBsaWNhdGlvbltdXG4gIGNvbnN0IHJlc3QgPSBhbGwuZmlsdGVyKGEgPT4gIXBpbm5lZC5pbmNsdWRlcyhhKSlcbiAgICAuc29ydCgoeCwgeSkgPT4gZnJlcXVlbmN5KHkubmFtZSkgLSBmcmVxdWVuY3koeC5uYW1lKSlcbiAgcmV0dXJuIFsuLi5waW5uZWQsIC4uLnJlc3RdLnNsaWNlKDAsIDYpLm1hcChmcm9tQXBwKVxufVxuZnVuY3Rpb24gdG9kYXlFdmVudExhYmVsKCk6IHN0cmluZyB7XG4gIGlmIChERU1PKSByZXR1cm4gRC53aWRnZXRFdmVudFxuICBjb25zdCBkID0gbmV3IERhdGUoKVxuICBjb25zdCBldnMgPSBFVkVOVFNbYCR7ZC5nZXRGdWxsWWVhcigpfS0ke2QuZ2V0TW9udGgoKSArIDF9LSR7ZC5nZXREYXRlKCl9YF0gPz8gW11cbiAgcmV0dXJuIGV2cy5sZW5ndGggPyBgJHtldnNbMF0udH0gXHUwMEI3ICR7ZXZzWzBdLm59YCA6IFwiTm8gZXZlbnRzIHRvZGF5XCJcbn1cbmZ1bmN0aW9uIHRvZGF5RGF0ZUxhYmVsKCk6IHN0cmluZyB7XG4gIHJldHVybiBERU1PID8gRC53aWRnZXREYXRlXG4gICAgOiBuZXcgRGF0ZSgpLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIsIGRheTogXCJudW1lcmljXCIsIG1vbnRoOiBcImxvbmdcIiB9KVxufVxuXG5pbnRlcmZhY2UgUm93IHtcbiAgbmFtZTogc3RyaW5nOyBpY29uOiBzdHJpbmc7IGhpbnQ6IHN0cmluZzsgc2NvcmU6IG51bWJlclxuICBtYXJrdXA6IHN0cmluZzsgcnVuOiAoKSA9PiB2b2lkXG59XG5cbmNvbnN0IEFDVElPTlMgPSBbXG4gIHsgbjogXCJTdXNwZW5kXCIsIGljb246IFwia29iZWwtbW9vbi1zeW1ib2xpY1wiLCBkOiBcIlNsZWVwIFx1MjAxNCByZXN1bWUgaW5zdGFudGx5XCIsXG4gICAgYWw6IFtcInNsZWVwXCJdLCBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCBzdXNwZW5kXCIpIH0sXG4gIHsgbjogXCJMb2NrXCIsIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLCBkOiBcIkxvY2sgdGhlIHNlc3Npb25cIixcbiAgICBhbDogW1wibG9jayBzY3JlZW5cIl0sIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpIH0sXG4gIHsgbjogXCJMb2cgT3V0XCIsIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsIGQ6IFwiRW5kIHRoaXMgc2Vzc2lvblwiLFxuICAgIGFsOiBbXCJleGl0XCIsIFwic2lnbiBvdXRcIiwgXCJsb2dvdXRcIl0sIHJ1bjogKCkgPT4gQXBwLnRvZ2dsZV93aW5kb3coXCJzZXNzaW9uXCIpIH0sXG4gIHsgbjogXCJSZXN0YXJ0XCIsIGljb246IFwia29iZWwtcmVsb2FkLXN5bWJvbGljXCIsIGQ6IFwiUmVib290IHRoZSBtYWNoaW5lXCIsXG4gICAgYWw6IFtcInJlYm9vdFwiXSwgcnVuOiAoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcInNlc3Npb25cIikgfSxcbiAgeyBuOiBcIlNodXQgRG93blwiLCBpY29uOiBcImtvYmVsLXBvd2VyLXN5bWJvbGljXCIsIGQ6IFwiUG93ZXIgb2ZmXCIsXG4gICAgYWw6IFtcInBvd2Vyb2ZmXCIsIFwiaGFsdFwiXSwgcnVuOiAoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcInNlc3Npb25cIikgfSxcbiAgeyBuOiBcIlNvZnQtcmVsb2FkIGdub2JsaW5cIiwgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICBkOiBcIlJlbG9hZCB0aGUgc2hlbGwgXHUyMDE0IHdpbmRvd3Mgc3Vydml2ZVwiLCBhbDogW10sXG4gICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJnbm9ibGluY3RsIHJlbG9hZFwiKSB9LFxuXVxuXG5jb25zdCBDTURTID0gW1xuICB7IGM6IFwicmVsb2FkXCIsIGQ6IFwiU29mdC1yZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIiB9LFxuICB7IGM6IFwib3NkIG9mZlwiLCBkOiBcImtvYmVsIG93bnMgdm9sdW1lL2JyaWdodG5lc3MgcG9wdXBzXCIgfSxcbiAgeyBjOiBcIm5vdGlmcyBvZmZcIiwgZDogXCJSZWxlYXNlIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zXCIgfSxcbiAgeyBjOiBcImdyYW50c1wiLCBkOiBcIlNjcmVlbi1yZWNvcmRpbmcgYWNjZXNzIHBlciBhcHBcIiB9LFxuXVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBMYXVuY2hlcigpIHtcbiAgY29uc3QgYXBwcyA9IG5ldyBBcHBzLkFwcHMoKVxuICAvLyBLT0JFTF9RVUVSWSBwcmUtZmlsbHMgdGhlIHNlYXJjaCBzbyB0aGUgZGV2a2l0IGNhbiByZW5kZXIgdGhlIHJlc3VsdHMgc3RhdGUuXG4gIGNvbnN0IHF1ZXJ5ID0gVmFyaWFibGUoR0xpYi5nZXRlbnYoXCJLT0JFTF9RVUVSWVwiKSB8fCBcIlwiKVxuICBjb25zdCBzZWxlY3RlZCA9IFZhcmlhYmxlKDApXG4gIGNvbnN0IGdob3N0ID0gVmFyaWFibGUoXCJcIilcblxuICBmdW5jdGlvbiByZXN1bHRzKHE6IHN0cmluZyk6IHsgc2VjdGlvbjogc3RyaW5nLCByb3dzOiBSb3dbXSB9W10ge1xuICAgIGNvbnN0IHF0ID0gcS50cmltKClcbiAgICBpZiAoIXF0KSByZXR1cm4gW11cbiAgICBpZiAocXQuc3RhcnRzV2l0aChcIjpcIikpIHtcbiAgICAgIGNvbnN0IGNxID0gcXQuc2xpY2UoMSkudHJpbSgpXG4gICAgICByZXR1cm4gW3tcbiAgICAgICAgc2VjdGlvbjogXCJnbm9ibGluY3RsXCIsXG4gICAgICAgIHJvd3M6IENNRFMuZmlsdGVyKGMgPT4gYy5jLnN0YXJ0c1dpdGgoY3EpKS5tYXAoYyA9PiAoe1xuICAgICAgICAgIG5hbWU6IGA6JHtjLmN9YCwgaWNvbjogXCJrb2JlbC10ZXJtaW5hbC1zeW1ib2xpY1wiLCBoaW50OiBjLmQsIHNjb3JlOiA5OSxcbiAgICAgICAgICBtYXJrdXA6IGA6JHtjLmN9YCwgcnVuOiAoKSA9PiBleGVjQXN5bmMoYGdub2JsaW5jdGwgJHtjLmN9YCksXG4gICAgICAgIH0pKSxcbiAgICAgIH1dXG4gICAgfVxuICAgIGNvbnN0IG91dDogeyBzZWN0aW9uOiBzdHJpbmcsIHJvd3M6IFJvd1tdIH1bXSA9IFtdXG4gICAgLy8gJz0nIGNhbGN1bGF0b3IgKGNoYXJzZXQtZ3VhcmRlZCwgc2FtZSBhcyBwcm90b3R5cGUpXG4gICAgaWYgKC9ePT9bMC05K1xcLSovKCkuIF0rJC8udGVzdChxdCkgJiYgL1swLTldLy50ZXN0KHF0KSAmJiAvWytcXC0qL10vLnRlc3QocXQpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB2ID0gRnVuY3Rpb24oYFwidXNlIHN0cmljdFwiO3JldHVybigke3F0LnJlcGxhY2UoL149LywgXCJcIil9KWApKClcbiAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZSh2KSkgb3V0LnB1c2goe1xuICAgICAgICAgIHNlY3Rpb246IFwiY2FsY3VsYXRvclwiLFxuICAgICAgICAgIHJvd3M6IFt7IG5hbWU6IFN0cmluZyh2KSwgaWNvbjogXCJrb2JlbC1jYWxjdWxhdG9yLXN5bWJvbGljXCIsXG4gICAgICAgICAgICBoaW50OiBgJHtxdC5yZXBsYWNlKC9ePS8sIFwiXCIpfSA9YCwgc2NvcmU6IDk4LCBtYXJrdXA6IFN0cmluZyh2KSxcbiAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcIndsLWNvcHlcIiwgU3RyaW5nKHYpXSkgfV0sXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIHsgfVxuICAgIH1cbiAgICBjb25zdCBhcHBSb3dzOiBSb3dbXSA9IGFwcHMuZnV6enlfcXVlcnkocXQpLnNsaWNlKDAsIDUpLm1hcChhID0+IHtcbiAgICAgIGNvbnN0IG0gPSBmdXp6eShxdCwgYS5uYW1lKSA/PyB7IHNjb3JlOiAxLCBtYXJrczogbnVsbCBhcyBhbnkgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogYS5uYW1lLCBpY29uOiBhLmljb25fbmFtZSA/PyBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICBoaW50OiBcIkFwcGxpY2F0aW9uXCIsIHNjb3JlOiBtLnNjb3JlICsgYm9vc3QoYS5uYW1lKSxcbiAgICAgICAgbWFya3VwOiBobChhLm5hbWUsIG0ubWFya3MpLFxuICAgICAgICBydW46ICgpID0+IHsgYnVtcChhLm5hbWUpOyBhLmxhdW5jaCgpIH0sXG4gICAgICB9XG4gICAgfSlcbiAgICBjb25zdCBhY3RSb3dzOiBSb3dbXSA9IEFDVElPTlMubWFwKHggPT4ge1xuICAgICAgbGV0IG0gPSBmdXp6eShxdCwgeC5uKVxuICAgICAgaWYgKCFtKSBmb3IgKGNvbnN0IGFsIG9mIHguYWwpIHsgY29uc3QgYW0gPSBmdXp6eShxdCwgYWwpOyBpZiAoYW0pIHsgbSA9IHsgc2NvcmU6IGFtLnNjb3JlIC0gLjUsIG1hcmtzOiBudWxsIGFzIGFueSB9OyBicmVhayB9IH1cbiAgICAgIHJldHVybiBtID8geyBuYW1lOiB4Lm4sIGljb246IHguaWNvbiwgaGludDogeC5kLCBzY29yZTogbS5zY29yZSAqIC45NSxcbiAgICAgICAgbWFya3VwOiBobCh4Lm4sIChtIGFzIGFueSkubWFya3MpLCBydW46IHgucnVuIH0gYXMgUm93IDogbnVsbFxuICAgIH0pLmZpbHRlcihCb29sZWFuKSBhcyBSb3dbXVxuICAgIC8vIGdsb2JhbCBiZXN0LW1hdGNoIHNsb3QgKGNyaXRpcXVlIEExKVxuICAgIGNvbnN0IGFsbCA9IFsuLi5hcHBSb3dzLCAuLi5hY3RSb3dzXS5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSlcbiAgICBjb25zdCBiZXN0ID0gYWxsWzBdXG4gICAgaWYgKGJlc3QpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJiZXN0IG1hdGNoXCIsIHJvd3M6IFtiZXN0XSB9KVxuICAgIGNvbnN0IHJlc3QgPSAocm93czogUm93W10pID0+IHJvd3MuZmlsdGVyKHIgPT4gciAhPT0gYmVzdClcbiAgICBpZiAocmVzdChhcHBSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhcHBzXCIsIHJvd3M6IHJlc3QoYXBwUm93cykgfSlcbiAgICBpZiAocmVzdChhY3RSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhY3Rpb25zXCIsIHJvd3M6IHJlc3QoYWN0Um93cykuc2xpY2UoMCwgMykgfSlcbiAgICBvdXQucHVzaCh7XG4gICAgICBzZWN0aW9uOiBcIndlYlwiLFxuICAgICAgcm93czogW3sgbmFtZTogYFNlYXJjaCB0aGUgd2ViIGZvciBcdTIwMUMke3F0fVx1MjAxRGAsIGljb246IFwia29iZWwtZ2xvYmUtc3ltYm9saWNcIixcbiAgICAgICAgaGludDogXCJcIiwgc2NvcmU6IDAsIG1hcmt1cDogYFNlYXJjaCB0aGUgd2ViIGZvciBcdTIwMUMke3F0fVx1MjAxRGAsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcInhkZy1vcGVuXCIsIGBodHRwczovL2R1Y2tkdWNrZ28uY29tLz9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHF0KX1gXSkgfV0sXG4gICAgfSlcbiAgICAvLyBnaG9zdCA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXIgKGNyaXRpcXVlIEE0KVxuICAgIGNvbnN0IGcgPSBvdXQuZmxhdE1hcChzID0+IHMucm93cykubWFwKHIgPT4gci5uYW1lKVxuICAgICAgLmZpbmQobiA9PiBuLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChxdC50b0xvd2VyQ2FzZSgpKSAmJiBuLmxlbmd0aCA+IHF0Lmxlbmd0aClcbiAgICBnaG9zdC5zZXQoZyA/PyBcIlwiKVxuICAgIHJldHVybiBvdXRcbiAgfVxuXG4gIGNvbnN0IHNlY3Rpb25zID0gYmluZChxdWVyeSkuYXMocmVzdWx0cylcblxuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJsYXVuY2hlclwiIG5hbWVzcGFjZT1cImtvYmVsLWxhdW5jaGVyXCIgY2xhc3M9XCJsYXVuY2hlci13aW5kb3dcIlxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUH0gZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH1cbiAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX0gdmlzaWJsZT17ZmFsc2V9XG4gICAgb25LZXlQcmVzc2VkPXsoc2VsZiwga2V5LCBfY29kZSwgbW9kcykgPT4ge1xuICAgICAgY29uc3QgZmxhdCA9IHJlc3VsdHMocXVlcnkuZ2V0KCkpLmZsYXRNYXAocyA9PiBzLnJvd3MpXG4gICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSkge1xuICAgICAgICBpZiAocXVlcnkuZ2V0KCkpIHsgcXVlcnkuc2V0KFwiXCIpOyByZXR1cm4gdHJ1ZSB9XG4gICAgICAgIHNlbGYuaGlkZSgpOyByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9UYWIpIHsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRhYiBpcyBBTFdBWVMgb3duZWRcbiAgICAgICAgY29uc3QgZyA9IGdob3N0LmdldCgpLCBxID0gcXVlcnkuZ2V0KClcbiAgICAgICAgaWYgKGcgJiYgIShtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5TSElGVF9NQVNLKSkgeyBxdWVyeS5zZXQoZyk7IHJldHVybiB0cnVlIH1cbiAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArICgobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSykgPyAtMSA6IDEpXG4gICAgICAgICAgKyBmbGF0Lmxlbmd0aCkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoKG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLkNPTlRST0xfTUFTSykgJiZcbiAgICAgICAgICAoa2V5ID09PSBHZGsuS0VZX24gfHwga2V5ID09PSBHZGsuS0VZX3ApKSB7XG4gICAgICAgIHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgKyAoa2V5ID09PSBHZGsuS0VZX24gPyAxIDogLTEpICsgZmxhdC5sZW5ndGgpXG4gICAgICAgICAgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0Rvd24pIHsgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArIDEpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKTsgcmV0dXJuIHRydWUgfVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9VcCkgeyBzZWxlY3RlZC5zZXQoKHNlbGVjdGVkLmdldCgpIC0gMSArIGZsYXQubGVuZ3RoKSAlIE1hdGgubWF4KGZsYXQubGVuZ3RoLCAxKSk7IHJldHVybiB0cnVlIH1cbiAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfUmV0dXJuKSB7XG4gICAgICAgIGZsYXRbc2VsZWN0ZWQuZ2V0KCldPy5ydW4oKTsgc2VsZi5oaWRlKCk7IHF1ZXJ5LnNldChcIlwiKTsgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH19PlxuICAgIDxib3ggY2xhc3M9XCJzaGVldCBsYXVuY2hlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgICAgPGJveCBjbGFzcz1cImZpZWxkXCIgc3BhY2luZz17MTF9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tYWduaWZ5aW5nLWdsYXNzLXN5bWJvbGljXCIgLz5cbiAgICAgICAgPG92ZXJsYXkgaGV4cGFuZD5cbiAgICAgICAgICA8ZW50cnlcbiAgICAgICAgICAgIGhleHBhbmRcbiAgICAgICAgICAgIHNldHVwPXsoc2VsZjogYW55KSA9PiB7IHNlbGYuc2V0X21heF93aWR0aF9jaGFycygxKTsgc2VsZi5zZXRfd2lkdGhfY2hhcnMoMSkgfX1cbiAgICAgICAgICAgIHRleHQ9e2JpbmQocXVlcnkpfVxuICAgICAgICAgICAgb25Ob3RpZnlUZXh0PXtlID0+IHsgcXVlcnkuc2V0KGUudGV4dCk7IHNlbGVjdGVkLnNldCgwKSB9fSAvPlxuICAgICAgICAgIHsvKiBwbGFjZWhvbGRlciBhcyBhbiBPVkVSTEFZIGxhYmVsIChub3QgZW50cnkgcGxhY2Vob2xkZXJUZXh0KSBzbyBpdHMgdGV4dFxuICAgICAgICAgICAgICB3aWR0aCBjYW4ndCBpbmZsYXRlIHRoZSBlbnRyeSdzIG5hdHVyYWwgc2l6ZSBcdTIxOTIgcGFuZWwgc3RheXMgYXQgbWluLXdpZHRoICovfVxuICAgICAgICAgIDxsYWJlbCB0eXBlPVwib3ZlcmxheVwiIGNsYXNzPVwibHBsYWNlaG9sZGVyXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IGVsbGlwc2l6ZT17M30gaGV4cGFuZFxuICAgICAgICAgICAgdmlzaWJsZT17YmluZChxdWVyeSkuYXMocSA9PiAhcSl9XG4gICAgICAgICAgICBsYWJlbD1cIlNlYXJjaCBcdTIwMTQgYXBwcywgZmlsZXMsIGFjdGlvbnMgXHUwMEI3ICc6JyBjbWRzIFx1MDBCNyAnPScgbWF0aHNcIiAvPlxuICAgICAgICAgIDxsYWJlbCB0eXBlPVwib3ZlcmxheVwiIGNsYXNzPVwiZ2hvc3RcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgIGxhYmVsPXtiaW5kKGdob3N0KS5hcyhnID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgICAgICAgIHJldHVybiBnLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChxLnRvTG93ZXJDYXNlKCkpICYmIHEgPyBnIDogXCJcIlxuICAgICAgICAgICAgfSl9IC8+XG4gICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgPGxhYmVsIGNsYXNzPVwia2JkXCIgbGFiZWw9XCJzdXBlclwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgIDwvYm94PlxuXG4gICAgICB7LyogZW1wdHkgc3RhdGU6IGN1cmF0ZWQgZnJlY2VuY3kgdGlsZSBncmlkICsgd2lkZ2V0IHJvdyAqL31cbiAgICAgIDxyZXZlYWxlciByZXZlYWxDaGlsZD17YmluZChxdWVyeSkuYXMocSA9PiAhcS50cmltKCkpfT5cbiAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgICAgICA8Ym94IGNsYXNzPVwidGlsZXNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezZ9PlxuICAgICAgICAgICAge2dyaWRUaWxlcyhhcHBzKS5tYXAodCA9PlxuICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidGlsZVwiIG9uQ2xpY2tlZD17KCkgPT4geyB0LmxhdW5jaCgpOyBBcHAuZ2V0X3dpbmRvdyhcImxhdW5jaGVyXCIpPy5oaWRlKCkgfX0+XG4gICAgICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fSBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgPGltYWdlIGNsYXNzPVwiaWNvbi10aWxlXCIgaWNvbk5hbWU9e3QuaWNvbk5hbWV9IHBpeGVsU2l6ZT17MzB9XG4gICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXt0Lm5hbWV9IGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgICAgZWxsaXBzaXplPXszfSBtYXhXaWR0aENoYXJzPXs5fSAvPlxuICAgICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICA8L2J1dHRvbj4pfVxuICAgICAgICAgIDwvYm94PlxuICAgICAgICAgIHsvKiB0d28gY2FyZHMgc3BsaXQgdGhlIHJvdyBleGFjdGx5IGluIGhhbGYgXHUyMDE0IHByb3RvIGZsZXg6MS9mbGV4OjEgKi99XG4gICAgICAgICAgPGJveCBjbGFzcz1cImx3aWRnZXRzXCIgc3BhY2luZz17N30gaG9tb2dlbmVvdXM+XG4gICAgICAgICAgICB7LyogbGVmdCBjYXJkIFx1MjAxNCBkYXRlICsgdG9kYXkncyBmaXJzdCBldmVudCAqL31cbiAgICAgICAgICAgIDxib3ggY2xhc3M9XCJ3aWRnZXQgbHdcIiBoZXhwYW5kIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9XG4gICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXt0b2RheURhdGVMYWJlbCgpfSAvPlxuICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJoaW50XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXt0b2RheUV2ZW50TGFiZWwoKX0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgey8qIHJpZ2h0IGNhcmQgXHUyMDE0IG1lZGlhIG1pbmktY2FyZDogYXJ0IFx1MDBCNyB0aXRsZS9hcnRpc3QgXHUwMEI3IHBsYXkgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwid2lkZ2V0IGx3bVwiIGhleHBhbmQgc3BhY2luZz17MTB9PlxuICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwibHdhcnRcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3dFwiIGhleHBhbmQgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cIm10aXRsZVwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBlbGxpcHNpemU9ezN9IGxhYmVsPXtELm1lZGlhLnRpdGxlfSAvPlxuICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImhpbnRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17RC5tZWRpYS5hcnRpc3R9IC8+XG4gICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwibWJ0biBwbGF5XCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHBsYXktcGF1c2VcIil9PlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBsYXktc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICAgIDwvcmV2ZWFsZXI+XG5cbiAgICAgIHsvKiByZXN1bHRzICovfVxuICAgICAgPGJveCBjbGFzcz1cImxyb3dzXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgIHtzZWN0aW9ucy5hcyhzZWNzID0+IHNlY3MuZmxhdE1hcChzZWMgPT4gW1xuICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInNlY1wiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17c2VjLnNlY3Rpb259IC8+LFxuICAgICAgICAgIC4uLnNlYy5yb3dzLm1hcChyID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZsYXRJZHggPSBzZWNzLmZsYXRNYXAocyA9PiBzLnJvd3MpLmluZGV4T2YocilcbiAgICAgICAgICAgIHJldHVybiA8YnV0dG9uXG4gICAgICAgICAgICAgIGNsYXNzPXtiaW5kKHNlbGVjdGVkKS5hcyhzID0+IHMgPT09IGZsYXRJZHggPyBcInJvdyBzZWxcIiA6IFwicm93XCIpfVxuICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHsgci5ydW4oKTsgQXBwLmdldF93aW5kb3coXCJsYXVuY2hlclwiKT8uaGlkZSgpIH19PlxuICAgICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezExfT5cbiAgICAgICAgICAgICAgICB7LyogMjhcdTAwRDcyOCByOCBwYW5lbDIgZnJhbWUgYXJvdW5kIHRoZSAyNHB4IGljb24gKHByb3RvdHlwZSAucmkpICovfVxuICAgICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJyaVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3IuaWNvbn0gcGl4ZWxTaXplPXsyNH0gLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPXtyLm1hcmt1cH0gLz5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJoaW50XCIgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M30gbGFiZWw9e3IuaGludH0gLz5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJydW5rXCIgbGFiZWw9XCJcdTIxQjVcIlxuICAgICAgICAgICAgICAgICAgdmlzaWJsZT17YmluZChzZWxlY3RlZCkuYXMocyA9PiBzID09PSBmbGF0SWR4KX0gLz5cbiAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICB9KSxcbiAgICAgICAgXSkpfVxuICAgICAgPC9ib3g+XG5cbiAgICAgIHsvKiBmb290ZXIgaGludCByb3cgXHUyMDE0IG1hdGNoZXMgcHJvdG90eXBlIC5sZm9vdCAqL31cbiAgICAgIDxib3ggY2xhc3M9XCJsZm9vdFwiPlxuICAgICAgICA8Ym94IHNwYWNpbmc9ezE0fSBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfT5cbiAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OnJlbG9hZDwvYj4gc29mdC1yZWxvYWRcIiAvPlxuICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46b3NkPC9iPiB0b2dnbGVcIiAvPlxuICAgICAgICAgIDxsYWJlbCB1c2VNYXJrdXAgbGFiZWw9XCI8Yj46Z3JhbnRzPC9iPiBzY3JlZW4gYWNjZXNzXCIgLz5cbiAgICAgICAgPC9ib3g+XG4gICAgICAgIDxsYWJlbCBsYWJlbD1cIlx1MjE5MVx1MjE5MyBzZWxlY3QgXHUwMEI3IFx1MjFCNSBydW5cIiBoYWxpZ249e0d0ay5BbGlnbi5FTkR9IC8+XG4gICAgICA8L2JveD5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gTGF1bmNoZXIgbWF0Y2hpbmcgXHUyMDE0IHN0cmFpZ2h0IHBvcnQgb2YgdGhlIHByb3RvdHlwZSAocG9zdC1jcml0aXF1ZSB2ZXJzaW9uKTpcbi8vIHN1YnNlcXVlbmNlIGZ1enp5IHdpdGggd29yZC1ib3VuZGFyeSBib251cywgY2FwcGVkIGxvZzIgZnJlY2VuY3ksIHByZWZpeCBnaG9zdC5cblxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWF0Y2ggeyBzY29yZTogbnVtYmVyOyBtYXJrczogbnVtYmVyW10gfVxuXG5leHBvcnQgZnVuY3Rpb24gZnV6enkocTogc3RyaW5nLCB0OiBzdHJpbmcpOiBNYXRjaCB8IG51bGwge1xuICBjb25zdCBxbCA9IHEudG9Mb3dlckNhc2UoKSwgdGwgPSB0LnRvTG93ZXJDYXNlKClcbiAgbGV0IHFpID0gMCwgc2NvcmUgPSAwLCBsYXN0ID0gLTJcbiAgY29uc3QgbWFya3M6IG51bWJlcltdID0gW11cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0bC5sZW5ndGggJiYgcWkgPCBxbC5sZW5ndGg7IGkrKykge1xuICAgIGlmICh0bFtpXSA9PT0gcWxbcWldKSB7XG4gICAgICBtYXJrcy5wdXNoKGkpXG4gICAgICBzY29yZSArPSAoaSA9PT0gMCB8fCBcIiAtXy4vXCIuaW5jbHVkZXModFtpIC0gMV0pKSA/IDQgOiAobGFzdCA9PT0gaSAtIDEgPyAyIDogMSlcbiAgICAgIGxhc3QgPSBpOyBxaSsrXG4gICAgfVxuICB9XG4gIHJldHVybiBxaSA9PT0gcWwubGVuZ3RoID8geyBzY29yZTogc2NvcmUgLSB0Lmxlbmd0aCAqIDAuMDIsIG1hcmtzIH0gOiBudWxsXG59XG5cbi8vIFBhbmdvIG1hcmt1cCBoaWdobGlnaHQgKGVzY2FwZXM7IGxlYWYgYWNjZW50IG9uIG1hdGNoZWQgY2hhcnMpXG5leHBvcnQgZnVuY3Rpb24gaGwodDogc3RyaW5nLCBtYXJrczogbnVtYmVyW10gfCBudWxsKTogc3RyaW5nIHtcbiAgY29uc3QgZXNjID0gKGM6IHN0cmluZykgPT4gR0xpYi5tYXJrdXBfZXNjYXBlX3RleHQoYywgLTEpXG4gIGlmICghbWFya3MpIHJldHVybiBlc2ModClcbiAgY29uc3QgbSA9IG5ldyBTZXQobWFya3MpXG4gIGxldCBvdXQgPSBcIlwiXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdC5sZW5ndGg7IGkrKylcbiAgICBvdXQgKz0gbS5oYXMoaSkgPyBgPHNwYW4gZm9yZWdyb3VuZD1cIiNiNWNiNDhcIj4ke2VzYyh0W2ldKX08L3NwYW4+YCA6IGVzYyh0W2ldKVxuICByZXR1cm4gb3V0XG59XG5cbi8vIEZyZWNlbmN5OiBjYXBwZWQgc28gYW4gZXhhY3QgcHJlZml4IG1hdGNoIEFMV0FZUyBiZWF0cyBoYWJpdCAoY3JpdGlxdWUgQTIpLlxuY29uc3QgU1RPUkUgPSBgJHtHTGliLmdldF91c2VyX3N0YXRlX2RpcigpfS9rb2JlbC9mcmVxLmpzb25gXG5sZXQgZnJlcTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9XG50cnkgeyBmcmVxID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoR0xpYi5maWxlX2dldF9jb250ZW50cyhTVE9SRSlbMV0pKSB9IGNhdGNoIHsgfVxuXG5leHBvcnQgY29uc3QgYm9vc3QgPSAoaWQ6IHN0cmluZykgPT4gTWF0aC5taW4oTWF0aC5sb2cyKDEgKyAoZnJlcVtpZF0gPz8gMCkpLCAzKVxuXG5leHBvcnQgZnVuY3Rpb24gYnVtcChpZDogc3RyaW5nKSB7XG4gIGZyZXFbaWRdID0gKGZyZXFbaWRdID8/IDApICsgMVxuICBHTGliLm1rZGlyX3dpdGhfcGFyZW50cyhHTGliLnBhdGhfZ2V0X2Rpcm5hbWUoU1RPUkUpLCAwbzc1NSlcbiAgR0xpYi5maWxlX3NldF9jb250ZW50cyhTVE9SRSwgSlNPTi5zdHJpbmdpZnkoZnJlcSkpXG59XG5cbmV4cG9ydCBjb25zdCBmcmVxdWVuY3kgPSAoaWQ6IHN0cmluZykgPT4gZnJlcVtpZF0gPz8gMFxuIiwgIi8vIENhbGVuZGFyIHBvcG92ZXIgXHUyMDE0IEdOT01FIHJlcGxpY2EgcGVyIHRoZSBwcm90b3R5cGU6IGhlcm8gZGF0ZSwgXHUyMDM5IG1vbnRoIFx1MjAzQSBuYXZcbi8vICh0aXRsZSBjbGljayA9IHRvZGF5KSwgSVNPIHdlZWsgbnVtYmVycyBhcyBxdWlldCBkaW0gdGV4dCwgRElNTUVEIFdFRUtFTkRTLFxuLy8gY2xpY2thYmxlIGRheXMgdy8gc2VsZWN0aW9uIHJpbmcgKGluayByaW5nIG9uIHRvZGF5KSwgZXZlbnQtZG90IG1hcmtlcnMsXG4vLyBldmVudHMgY2FyZCBpbiB0aGUgbm90aWZpY2F0aW9uLWNhcmQgbGFuZ3VhZ2UuIE1vbnRocyBzbGlkZSAobXVsdGl2aWV3IG1vdGlvbikuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5pbnRlcmZhY2UgRXYgeyB0OiBzdHJpbmc7IG46IHN0cmluZzsgaWNvbjogc3RyaW5nIH1cbi8vIFwidG9kYXlcIiBcdTIwMTQgdW5kZXIgS09CRUxfREVNTywgcGlubmVkIHRvIEQudG9kYXkgKHRoZSBkZW1vJ3MgbW9jayBcInRvZGF5XCIsIGtlcHQgaW4gc3luY1xuLy8gd2l0aCB0aGUgcHJvdG90eXBlIHNvIHRoZSBoZXJvLCBncmlkIGhpZ2hsaWdodCwgZXZlbnQtZG90cyBhbmQgZXZlbnRzIGNhcmQgb3ZlcmxheSBpdFxuLy8gMToxKTsgcmVhbCBjbG9jayBvdGhlcndpc2UuIEV2ZXJ5IFwidG9kYXlcIi9zZWxlY3RlZCBkZWZhdWx0IGZsb3dzIGZyb20gdGhpcyBzaW5nbGUgYG5vd2AuXG5jb25zdCBub3cgPSBERU1PID8gbmV3IERhdGUoRC50b2RheS55LCBELnRvZGF5Lm0sIEQudG9kYXkuZCkgOiBuZXcgRGF0ZSgpXG5jb25zdCBrZXkgPSAoeTogbnVtYmVyLCBtOiBudW1iZXIsIGQ6IG51bWJlcikgPT4gYCR7eX0tJHttICsgMX0tJHtkfWBcbmV4cG9ydCBjb25zdCBFVkVOVFM6IFJlY29yZDxzdHJpbmcsIEV2W10+ID0ge1xuICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSldOlxuICAgIFt7IHQ6IFwiMDk6NDVcIiwgbjogXCJEYWlseSBTdGFuZHVwXCIsIGljb246IFwia29iZWwtdmlkZW8tc3ltYm9saWNcIiB9XSxcbiAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIDExKV06XG4gICAgW3sgdDogXCIxMDozMFwiLCBuOiBcIktpZXJhbiBCaXJ0aGRheVwiLCBpY29uOiBcImtvYmVsLWNha2Utc3ltYm9saWNcIiB9LFxuICAgICB7IHQ6IFwiMTM6MDBcIiwgbjogXCJMb25kb24gVGhpbmdcIiwgaWNvbjogXCJrb2JlbC1waW4tc3ltYm9saWNcIiB9XSxcbiAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIDEzKV06XG4gICAgW3sgdDogXCJBbGwgZGF5XCIsIG46IFwiTXkgQmlydGhkYXlcIiwgaWNvbjogXCJrb2JlbC1jYWtlLXN5bWJvbGljXCIgfV0sXG59XG5cbmNvbnN0IHZpZXcgPSBWYXJpYWJsZSh7IHk6IG5vdy5nZXRGdWxsWWVhcigpLCBtOiBub3cuZ2V0TW9udGgoKSB9KVxuY29uc3Qgc2VsID0gVmFyaWFibGUobmV3IERhdGUobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpKSlcblxuZnVuY3Rpb24gaXNvV2VlayhkOiBEYXRlKTogbnVtYmVyIHtcbiAgY29uc3QgdCA9IG5ldyBEYXRlKERhdGUuVVRDKGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSkpXG4gIGNvbnN0IGRuID0gKHQuZ2V0VVRDRGF5KCkgKyA2KSAlIDdcbiAgdC5zZXRVVENEYXRlKHQuZ2V0VVRDRGF0ZSgpIC0gZG4gKyAzKVxuICBjb25zdCBmID0gbmV3IERhdGUoRGF0ZS5VVEModC5nZXRVVENGdWxsWWVhcigpLCAwLCA0KSlcbiAgcmV0dXJuIDEgKyBNYXRoLnJvdW5kKCgoK3QgLSArZikgLyA4NjRlNSAtIDMgKyAoKGYuZ2V0VVRDRGF5KCkgKyA2KSAlIDcpKSAvIDcpXG59XG5cbmZ1bmN0aW9uIEdyaWQoKSB7XG4gIHJldHVybiA8Ym94IGNsYXNzPVwiY2FsLWdyaWRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfT5cbiAgICB7YmluZChWYXJpYWJsZS5kZXJpdmUoW3ZpZXcsIHNlbF0sICh2LCBzKSA9PiAoeyB2LCBzIH0pKSkuYXMoKHsgdiwgcyB9KSA9PiB7XG4gICAgICBjb25zdCBmaXJzdCA9IG5ldyBEYXRlKHYueSwgdi5tLCAxKVxuICAgICAgY29uc3Qgc3RhcnQgPSAoZmlyc3QuZ2V0RGF5KCkgKyA2KSAlIDdcbiAgICAgIGNvbnN0IGRheXMgPSBuZXcgRGF0ZSh2LnksIHYubSArIDEsIDApLmdldERhdGUoKVxuICAgICAgY29uc3QgcHJldkRheXMgPSBuZXcgRGF0ZSh2LnksIHYubSwgMCkuZ2V0RGF0ZSgpXG4gICAgICBjb25zdCByb3dzID0gW11cbiAgICAgIHJvd3MucHVzaCg8Ym94IGhvbW9nZW5lb3VzPlxuICAgICAgICB7W1wiXCIsIFwiTVwiLCBcIlRcIiwgXCJXXCIsIFwiVFwiLCBcIkZcIiwgXCJTXCIsIFwiU1wiXS5tYXAoZCA9PlxuICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImRvd1wiIGxhYmVsPXtkfSAvPil9XG4gICAgICA8L2JveD4pXG4gICAgICBmb3IgKGxldCByID0gMDsgciA8IDY7IHIrKykge1xuICAgICAgICBjb25zdCBjZWxscyA9IFs8bGFiZWwgY2xhc3M9XCJ3ayB0blwiXG4gICAgICAgICAgbGFiZWw9e2Ake2lzb1dlZWsobmV3IERhdGUodi55LCB2Lm0sIHIgKiA3IC0gc3RhcnQgKyAxKSl9YH0gLz5dXG4gICAgICAgIGZvciAobGV0IGMgPSAwOyBjIDwgNzsgYysrKSB7XG4gICAgICAgICAgY29uc3QgaSA9IHIgKiA3ICsgYywgZCA9IGkgLSBzdGFydCArIDFcbiAgICAgICAgICBjb25zdCBvdXQgPSBkIDwgMSB8fCBkID4gZGF5c1xuICAgICAgICAgIGNvbnN0IGxhYmVsID0gb3V0ID8gKGQgPCAxID8gcHJldkRheXMgKyBkIDogZCAtIGRheXMpIDogZFxuICAgICAgICAgIGNvbnN0IGNscyA9IFtcImRheVwiXVxuICAgICAgICAgIGlmIChjID49IDUpIGNscy5wdXNoKFwid2VcIikgICAgICAgICAgICAgICAgICAgICAgIC8vIFdFRUtFTkRTIERJTU1FRFxuICAgICAgICAgIGlmIChvdXQpIGNscy5wdXNoKFwib3V0XCIpXG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBjb25zdCB0b2RheSA9IG5vd1xuICAgICAgICAgICAgaWYgKGQgPT09IHRvZGF5LmdldERhdGUoKSAmJiB2Lm0gPT09IHRvZGF5LmdldE1vbnRoKCkgJiYgdi55ID09PSB0b2RheS5nZXRGdWxsWWVhcigpKVxuICAgICAgICAgICAgICBjbHMucHVzaChcInRvZGF5XCIpXG4gICAgICAgICAgICBpZiAoRVZFTlRTW2tleSh2LnksIHYubSwgZCldKSBjbHMucHVzaChcImV2XCIpICAgLy8gZXZlbnQtZG90IChDU1MgOjphZnRlciBcdTIxOTIgdW5kZXJsaW5lIGRvdClcbiAgICAgICAgICAgIGlmIChzLmdldERhdGUoKSA9PT0gZCAmJiBzLmdldE1vbnRoKCkgPT09IHYubSAmJiBzLmdldEZ1bGxZZWFyKCkgPT09IHYueSlcbiAgICAgICAgICAgICAgY2xzLnB1c2goXCJzZWxcIilcbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgaGFzRXYgPSAhb3V0ICYmICEhRVZFTlRTW2tleSh2LnksIHYubSwgZCldXG4gICAgICAgICAgLy8gZGF5IHNpdHMgYXQgaXRzIG5hdHVyYWwgMjRcdTAwRDcyNCBjZW50cmVkIGluIHRoZSBncmlkIGNvbHVtbiAobm90IGZpbGxpbmcgaXQpLFxuICAgICAgICAgIC8vIHNvIHRvZGF5J3MgbGVhZiBmaWxsIGlzIGEgdGlnaHQgY2lyY2xlIHJhdGhlciB0aGFuIGEgY29sdW1uLXdpZGUgb3ZhbFxuICAgICAgICAgIGNlbGxzLnB1c2gob3V0XG4gICAgICAgICAgICA/IDxsYWJlbCBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfSBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IGxhYmVsPXtgJHtsYWJlbH1gfSAvPlxuICAgICAgICAgICAgOiA8YnV0dG9uIGNsYXNzPXtjbHMuam9pbihcIiBcIil9XG4gICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzZWwuc2V0KG5ldyBEYXRlKHYueSwgdi5tLCBkKSl9PlxuICAgICAgICAgICAgICAgIHtoYXNFdlxuICAgICAgICAgICAgICAgICAgPyA8b3ZlcmxheT5cbiAgICAgICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9e2Ake2xhYmVsfWB9IC8+XG4gICAgICAgICAgICAgICAgICAgICAgey8qIDNweCBldmVudCBkb3QsIGFic29sdXRlIGJvdHRvbS1jZW50ZXIgKEdUSyBoYXMgbm8gOjphZnRlcikgKi99XG4gICAgICAgICAgICAgICAgICAgICAgPGJveCB0eXBlPVwib3ZlcmxheVwiIGNsYXNzPVwiZXZkb3RcIlxuICAgICAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5FTkR9IC8+XG4gICAgICAgICAgICAgICAgICAgIDwvb3ZlcmxheT5cbiAgICAgICAgICAgICAgICAgIDogPGxhYmVsIGxhYmVsPXtgJHtsYWJlbH1gfSAvPn1cbiAgICAgICAgICAgICAgPC9idXR0b24+KVxuICAgICAgICB9XG4gICAgICAgIHJvd3MucHVzaCg8Ym94IGhvbW9nZW5lb3VzPntjZWxsc308L2JveD4pXG4gICAgICB9XG4gICAgICByZXR1cm4gcm93c1xuICAgIH0pfVxuICA8L2JveD5cbn1cblxuZnVuY3Rpb24gRXZlbnRzQ2FyZCgpIHtcbiAgLy8gUHJvdG90eXBlIC5jYWxldjogYSBwYW5lbDIgY2FyZCAocGFkMTAvcjEyKSB3cmFwcGluZyB0aGUgZGF0ZSBoZWFkZXIgKyBkYXJrZXJcbiAgLy8gKC0tcGFuZWwpIGV2ZW50IHJvd3M7IGhlYWRlcidzIG93biBib3R0b20gcGFkZGluZyBpcyB0aGUgaGVhZGVyXHUyMTkycm93IGdhcCAoc3BhY2luZyAwKS5cbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJldmNhcmRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICB7YmluZChzZWwpLmFzKGQgPT4ge1xuICAgICAgY29uc3QgZXZzID0gRVZFTlRTW2tleShkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpXSA/PyBbXVxuICAgICAgY29uc3QgaGVhZCA9IDxsYWJlbCBjbGFzcz1cImV2aGVhZFwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICBsYWJlbD17ZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7IHdlZWtkYXk6IFwibG9uZ1wiLCBkYXk6IFwibnVtZXJpY1wiLCBtb250aDogXCJsb25nXCIgfSl9IC8+XG4gICAgICBpZiAoIWV2cy5sZW5ndGgpIHJldHVybiBbaGVhZCxcbiAgICAgICAgPGJveCBzcGFjaW5nPXs4fT48aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jYWxlbmRhci1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViXCIgbGFiZWw9XCJObyBldmVudHNcIiAvPjwvYm94Pl1cbiAgICAgIHJldHVybiBbaGVhZCwgLi4uZXZzLm1hcChlID0+XG4gICAgICAgIDxib3ggY2xhc3M9XCJldnJvd1wiIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICB7LyogMjZcdTAwRDcyNiByOCBjb2xvcmVkIGljb24gdGlsZSAocHJvdG90eXBlIC5ldmljKSwgd2hpdGUgZ2x5cGggKi99XG4gICAgICAgICAgPGJveCBjbGFzcz1cImV2aWNcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtlLmljb259IC8+PC9ib3g+XG4gICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17ZS5ufSAvPlxuICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwic3ViIHRuXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtlLnR9IC8+XG4gICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvYm94PildXG4gICAgfSl9XG4gIDwvYm94PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBDYWxlbmRhcigpIHtcbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwiY2FsZW5kYXJcIiBuYW1lc3BhY2U9XCJrb2JlbC1jYWxlbmRhclwiIGNsYXNzPVwiY2FsZW5kYXItd2luZG93XCIgdmlzaWJsZT17ZmFsc2V9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QfSBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfSBrZXltb2RlPXtBc3RhbC5LZXltb2RlLk9OX0RFTUFORH1cbiAgICBvbktleVByZXNzZWQ9eyhzZWxmLCBrZXkpID0+IGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoc2VsZi5oaWRlKCksIHRydWUpIDogZmFsc2V9PlxuICAgIDxib3ggY2xhc3M9XCJzaGVldCBjYWxcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgIDxib3ggY2xhc3M9XCJjYWxoZXJvXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YlwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgIGxhYmVsPXtub3cudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwgeyB3ZWVrZGF5OiBcImxvbmdcIiB9KX0gLz5cbiAgICAgICAgPGxhYmVsIGNsYXNzPVwiaGVyb1wiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgIGxhYmVsPXtub3cudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwgeyBkYXk6IFwibnVtZXJpY1wiLCBtb250aDogXCJsb25nXCIsIHllYXI6IFwibnVtZXJpY1wiIH0pfSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8Y2VudGVyYm94PlxuICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgdmlldy5zZXQodi5tID8geyB5OiB2LnksIG06IHYubSAtIDEgfSA6IHsgeTogdi55IC0gMSwgbTogMTEgfSlcbiAgICAgICAgfX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1sZWZ0LXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm1vbnRoXCIgb25DbGlja2VkPXsoKSA9PlxuICAgICAgICAgIHZpZXcuc2V0KHsgeTogbm93LmdldEZ1bGxZZWFyKCksIG06IG5vdy5nZXRNb250aCgpIH0pfT5cbiAgICAgICAgICA8bGFiZWwgbGFiZWw9e2JpbmQodmlldykuYXModiA9PlxuICAgICAgICAgICAgbmV3IERhdGUodi55LCB2Lm0pLnRvTG9jYWxlU3RyaW5nKFwiZW5cIiwgeyBtb250aDogXCJsb25nXCIgfSlcbiAgICAgICAgICAgICsgKHYueSAhPT0gbm93LmdldEZ1bGxZZWFyKCkgPyBgICR7di55fWAgOiBcIlwiKSl9IC8+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgdmlldy5zZXQodi5tID09PSAxMSA/IHsgeTogdi55ICsgMSwgbTogMCB9IDogeyB5OiB2LnksIG06IHYubSArIDEgfSlcbiAgICAgICAgfX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8L2NlbnRlcmJveD5cbiAgICAgIDxHcmlkIC8+XG4gICAgICA8RXZlbnRzQ2FyZCAvPlxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBRdWljayBzZXR0aW5ncy4gUHJvdG90eXBlLWZpbmFsOiB1bmlmb3JtIHBpbGwgdGlsZXMgZnJvbSBhIENBVEFMT0cgKGN1c3RvbWlzYWJsZSxcbi8vIHBlcnNpc3RlZCksIEdOT01FIHRoaW4gc2xpZGVycywgZHJpbGxkb3ducyBhcyBhIHNwcmluZy1zbGlkIHR3by12aWV3IHN0YWNrXG4vLyAoV2ktRmkgbmV0d29ya3MgLyBCVCBkZXZpY2VzIC8gcGVyLWFwcCBtaXhlciB3aXRoIGEgTWFzdGVyIHJvdyksIGNvbXBhY3QgdG9wIHJvd1xuLy8gKGJhdHRlcnkgXHUwMEI3IHBlbmNpbC9sZWFmL2xvY2svcG93ZXIpLCBnbm9ibGluIGJhbm5lciArIHJlY29ubmVjdCB3aGlsZSBkZWdyYWRlZC5cbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IEJsdWV0b290aCBmcm9tIFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgeyBjb25uZWN0ZWQsIHJlbG9hZCB9IGZyb20gXCIuLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCB7IE1PVElPTiB9IGZyb20gXCIuLi9saWIvc3ByaW5nXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuaW1wb3J0IHsgVGlueVNsaWRlciB9IGZyb20gXCIuLi9saWIvdGlueXNsaWRlclwiXG5pbXBvcnQgeyBGaXhlZENoZXYgfSBmcm9tIFwiLi4vbGliL2ZpeGVkY2hldlwiXG5cbnR5cGUgRHJpbGwgPSBudWxsIHwgXCJ3aWZpXCIgfCBcImJ0XCIgfCBcIm1peFwiXG4vLyBLT0JFTF9EUklMTCBsZXRzIHRoZSBkZXZraXQgcmVuZGVyIGEgZHJpbGxkb3duIGRpcmVjdGx5IChubyBwb2ludGVyIHRvIGNsaWNrIHRoZVxuLy8gY2hldnJvbiBpbiBoZWFkbGVzcyk7IHByb2R1Y3Rpb24gZGVmYXVsdCBpcyBudWxsLlxuY29uc3QgZHJpbGwgPSBWYXJpYWJsZTxEcmlsbD4oKEdMaWIuZ2V0ZW52KFwiS09CRUxfRFJJTExcIikgYXMgRHJpbGwpIHx8IG51bGwpXG5cbi8vIFRpbGUgY2F0YWxvZyBcdTIwMTQgbWlycm9ycyBwcm90b3R5cGUgQ0FUQUxPRzsgcGVyc2lzdGVkIGxheW91dCBpbiBzdGF0ZSBkaXIuXG5jb25zdCBTVE9SRSA9IGAke0dMaWIuZ2V0X3VzZXJfc3RhdGVfZGlyKCl9L2tvYmVsL3FzLXRpbGVzLmpzb25gXG5sZXQgdGlsZXM6IHN0cmluZ1tdID0gW1wid2lmaVwiLCBcImJ0XCIsIFwic2F2ZVwiLCBcImRhcmtcIiwgXCJzaWxlbnRcIiwgXCJuaWdodFwiLCBcInZvbHVtZVwiLCBcImJyaWdodG5lc3NcIl1cbnRyeSB7IHRpbGVzID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoR0xpYi5maWxlX2dldF9jb250ZW50cyhTVE9SRSlbMV0pKSB9IGNhdGNoIHsgfVxuXG5mdW5jdGlvbiBDaGlwKHByb3BzOiB7XG4gIGlkOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcsIGljb246IHN0cmluZyxcbiAgYWN0aXZlOiBhbnksIHN1Yj86IGFueSwgb25Ub2dnbGVkOiAoKSA9PiB2b2lkLCBvbkRyaWxsPzogKCkgPT4gdm9pZCxcbn0pIHtcbiAgcmV0dXJuIDxib3ggY2xhc3M9e2JpbmQocHJvcHMuYWN0aXZlKS5hcygoYTogYm9vbGVhbikgPT4gYSA/IFwiY2hpcCBwaWxsIG9uXCIgOiBcImNoaXAgcGlsbFwiKX0+XG4gICAgPGJ1dHRvbiBjbGFzcz1cImNoaXBiXCIgaGV4cGFuZD17dHJ1ZX0gb25DbGlja2VkPXtwcm9wcy5vblRvZ2dsZWR9PlxuICAgICAgPGJveCBzcGFjaW5nPXs5fT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPXtwcm9wcy5pY29ufSAvPlxuICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17cHJvcHMubGFiZWx9IC8+XG4gICAgICAgICAge3Byb3BzLnN1YiAmJiA8bGFiZWwgY2xhc3M9XCJzdWJcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICAgIGVsbGlwc2l6ZT17M30gbGFiZWw9e3Byb3BzLnN1Yn0gLz59XG4gICAgICAgIDwvYm94PlxuICAgICAgPC9ib3g+XG4gICAgPC9idXR0b24+XG4gICAgey8qIGZpeGVkIDMycHggc2VhbStjaGV2cm9uIChwcm90byAuY2hldmIpIFx1MjAxNCBoZXhwYW5kPWZhbHNlIHNvIHRoZSBtYWluIGJ1dHRvbiBvd25zIHNsYWNrICovfVxuICAgIHtwcm9wcy5vbkRyaWxsICYmXG4gICAgICA8YnV0dG9uIGNsYXNzPVwiY2hldlwiIGhleHBhbmQ9e2ZhbHNlfSB3aWR0aFJlcXVlc3Q9ezMyfSBvbkNsaWNrZWQ9e3Byb3BzLm9uRHJpbGx9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLXJpZ2h0LXN5bWJvbGljXCIgLz5cbiAgICAgIDwvYnV0dG9uPn1cbiAgPC9ib3g+XG59XG5cbmZ1bmN0aW9uIFNsaWRlcnMoKSB7XG4gIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICAvLyBJbiBERU1PIG1vZGUgcmVuZGVyIHRoZSB0d28gc2xpZGVycyByZWdhcmRsZXNzIG9mIGEgcmVhbCBzcGVha2VyLCBwaW5uZWQgdG8gdGhlXG4gIC8vIHByb3RvdHlwZSdzIG1vY2sgdmFsdWVzICh2b2x1bWUgMC42NCwgYnJpZ2h0bmVzcyAwLjgwKSBmb3IgYSBmYWlyIG92ZXJsYXkuXG4gIGlmICghc3BlYWtlciAmJiAhREVNTykgcmV0dXJuIDxib3ggLz5cbiAgY29uc3Qgdm9sSWNvbiA9IHNwZWFrZXJcbiAgICA/IGJpbmQoc3BlYWtlciwgXCJ2b2x1bWVfaWNvblwiKS5hcyhpID0+IGkgPz8gXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIilcbiAgICA6IFwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCJcbiAgY29uc3Qgdm9sVmFsdWU6IGFueSA9IERFTU8gPyBELnZvbHVtZSA6IGJpbmQoc3BlYWtlciEsIFwidm9sdW1lXCIpXG4gIC8vIHByb3RvIC5zbGlkZXJzIGlzIGEgZmxleCBjb2x1bW4gd2l0aCBOTyBnYXAgYmV0d2VlbiB0aGUgdHdvIHNyb3dzIChlYWNoIG1pbi1oIDQyKS5cbiAgLy8gVGlueVNsaWRlciBvdmVycmlkZXMgdmZ1bmNfbWVhc3VyZSB0byByZXBvcnQgbmF0dXJhbD0xcHggc28gdGhlIHNyb3cgZG9lc24ndFxuICAvLyBpbmZsYXRlIHRoZSBwYW5lbCBiZXlvbmQgdGhlIGNoaXAtZ3JpZCB3aWR0aCAoR1RLIENTUyBtYXgtd2lkdGggaXMgbm90IHJlc3BlY3RlZCkuXG4gIGNvbnN0IGluaXRWb2wgPSBERU1PID8gRC52b2x1bWUgOiAoc3BlYWtlcj8udm9sdW1lID8/IDAuNjQpXG4gIGNvbnN0IHZvbFNsaWRlciA9IG5ldyBUaW55U2xpZGVyKHsgaGV4cGFuZDogdHJ1ZSwgY3NzQ2xhc3NlczogW1wic2xpZGVyXCJdLCB2YWx1ZTogaW5pdFZvbCB9KVxuICBpZiAoIURFTU8gJiYgc3BlYWtlcikgYmluZChzcGVha2VyLCBcInZvbHVtZVwiKS5zdWJzY3JpYmUoKHY6IG51bWJlcikgPT4geyB2b2xTbGlkZXIuZ2V0X2FkanVzdG1lbnQoKS52YWx1ZSA9IHYgfSlcbiAgLy8gR3RrUmFuZ2U6OmNoYW5nZS12YWx1ZSBhcmdzOiAocmFuZ2UsIHNjcm9sbFR5cGUsIHZhbHVlKVxuICB2b2xTbGlkZXIuY29ubmVjdChcImNoYW5nZS12YWx1ZVwiLCAoX3M6IGFueSwgX3Q6IGFueSwgdjogbnVtYmVyKSA9PiB7IGlmIChzcGVha2VyKSBzcGVha2VyLnZvbHVtZSA9IHYgfSlcblxuICBjb25zdCBicmlnaHRTbGlkZXIgPSBuZXcgVGlueVNsaWRlcih7IGhleHBhbmQ6IHRydWUsIGNzc0NsYXNzZXM6IFtcInNsaWRlclwiXSwgdmFsdWU6IERFTU8gPyBELmJyaWdodG5lc3MgOiAwLjggfSlcbiAgYnJpZ2h0U2xpZGVyLmNvbm5lY3QoXCJjaGFuZ2UtdmFsdWVcIiwgKF9zOiBhbnksIF90OiBhbnksIHY6IG51bWJlcikgPT5cbiAgICBleGVjQXN5bmMoYGJyaWdodG5lc3NjdGwgc2V0ICR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYCkpXG5cbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJzbGlkZXJzXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17dm9sSWNvbn0gLz5cbiAgICAgIHt2b2xTbGlkZXJ9XG4gICAgICA8YnV0dG9uIGNsYXNzPVwiY2hldlwiIHdpZHRoUmVxdWVzdD17MzF9IG9uQ2xpY2tlZD17KCkgPT4gZHJpbGwuc2V0KFwibWl4XCIpfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+XG4gICAgICA8L2J1dHRvbj5cbiAgICA8L2JveD5cbiAgICA8Ym94IGNsYXNzPVwic3Jvd1wiIHNwYWNpbmc9ezl9PlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYnJpZ2h0bmVzcy1zeW1ib2xpY1wiIC8+XG4gICAgICB7YnJpZ2h0U2xpZGVyfVxuICAgICAgey8qIGd1dHRlcjogd2lkdGhSZXF1ZXN0PTE3ICsgfjEzcHggQWR3YWl0YSBvdmVyaGVhZCBcdTIyNDggMzBweCwgbWF0Y2hpbmcgY2hldiB3aWR0aCAqL31cbiAgICAgIDxib3ggd2lkdGhSZXF1ZXN0PXsxN30gLz5cbiAgICA8L2JveD5cbiAgPC9ib3g+XG59XG5cbmZ1bmN0aW9uIEdub2JsaW5CYW5uZXIoKSB7XG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZ2Jhbm5lclwiIHZpc2libGU9e0RFTU8gPyBmYWxzZSA6IGJpbmQoY29ubmVjdGVkKS5hcyhjID0+ICFjKX0gc3BhY2luZz17MTB9PlxuICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXdhcm5pbmctc3ltYm9saWNcIiAvPlxuICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gaGV4cGFuZD5cbiAgICAgIDxsYWJlbCBjbGFzcz1cInRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJvcmcuZ25vYmxpbi5TaGVsbCBkaXNjb25uZWN0ZWRcIiAvPlxuICAgICAgPGxhYmVsIGNsYXNzPVwic1wiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIm9zZCArIG5vdGlmcyBoYW5kZWQgYmFjayB0byBnbm9tZVwiIC8+XG4gICAgPC9ib3g+XG4gICAgPGJ1dHRvbiBjbGFzcz1cImdidG5cIiBsYWJlbD1cIlJlY29ubmVjdFwiIG9uQ2xpY2tlZD17KCkgPT4gcmVsb2FkKCkuY2F0Y2goKCkgPT4geyB9KX0gLz5cbiAgPC9ib3g+XG59XG5cbi8vIGxvY2FsLXN0YXRlIHRvZ2dsZXMgKG5vIHJlYWwgYmFja2VuZCBmb3IgdGhlc2UgaW4gdGhlIGRldmtpdClcbmNvbnN0IHRTYXZlID0gVmFyaWFibGUoZmFsc2UpLCB0RGFyayA9IFZhcmlhYmxlKHRydWUpLCB0U2lsZW50ID0gVmFyaWFibGUoZmFsc2UpLCB0TmlnaHQgPSBWYXJpYWJsZShmYWxzZSlcbi8vIGVkaXQtbW9kZSBmb3IgdGhlIHRpbGUgY2F0YWxvZyAocGVuY2lsIGJ1dHRvbikgXHUyMDE0IGhvb2sgZm9yIHRpbGUgcmVhcnJhbmdlL2N1c3RvbWlzZS5cbmNvbnN0IGVkaXRNb2RlID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIFByb3RvdHlwZSB0b2dnbGUgY2hpcHMgYXJlIGxhYmVsLW9ubHksIHZlcnRpY2FsbHkgY2VudGVyZWQgXHUyMDE0IHN0YXRlIGlzIHNob3duIGJ5IHRoZVxuLy8gbGVhZiBmaWxsLCBub3QgYSBzdWItbGluZSAob25seSBXaS1GaS9CbHVldG9vdGggY2FycnkgYSBzdWIpLlxuZnVuY3Rpb24gVG9nZ2xlQ2hpcChwcm9wczogeyBsYWJlbDogc3RyaW5nLCBpY29uOiBzdHJpbmcsIHY6IFZhcmlhYmxlPGJvb2xlYW4+IH0pIHtcbiAgcmV0dXJuIDxDaGlwIGlkPXtwcm9wcy5sYWJlbH0gbGFiZWw9e3Byb3BzLmxhYmVsfSBpY29uPXtwcm9wcy5pY29ufVxuICAgIGFjdGl2ZT17YmluZChwcm9wcy52KX1cbiAgICBvblRvZ2dsZWQ9eygpID0+IHByb3BzLnYuc2V0KCFwcm9wcy52LmdldCgpKX0gLz5cbn1cblxuZnVuY3Rpb24gUm9vdCh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgY29uc3QgbmV0ID0gTmV0d29yay5nZXRfZGVmYXVsdCgpXG4gIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgLy8gc3BhY2luZyAwOiBleGFjdCBzZWN0aW9uIGdhcHMgY29tZSBmcm9tIG1hcmdpbnMgKHF0b3BcdTIxOTJjaGlwcyAxLCBjaGlwIHJvd3MgOCxcbiAgLy8gY2hpcHNcdTIxOTJzbGlkZXJzIDEwKSBcdTIwMTQgYSB1bmlmb3JtIGJveCBzcGFjaW5nIGNhbid0IGV4cHJlc3MgYWxsIHRocmVlLlxuICByZXR1cm4gPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICB7LyogdG9wIHJvdzogYmF0dGVyeSBcdTAwQjcgcmVsb2FkIFx1MDBCNyBsb2NrIFx1MDBCNyBwb3dlciAqL31cbiAgICA8Ym94IGNsYXNzPVwicXMtdG9wXCIgc3BhY2luZz17MH0+XG4gICAgICB7LyogYmF0dGVyeSBwaWxsOiBnbHlwaCArIHRhYnVsYXIgbWV0YSAobWF0Y2hlcyBwcm90b3R5cGUgLnFiKSAqL31cbiAgICAgIDxib3ggY2xhc3M9XCJtZXRhXCIgc3BhY2luZz17Nn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e0RFTU8gPyBELm1ldGEgOiBcIjEwMCUgXHUwMEI3IEZ1bGx5IGNoYXJnZWRcIn0gLz5cbiAgICAgIDwvYm94PlxuICAgICAgPGJveCBoZXhwYW5kIC8+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0biBsZWFmXCIgb25DbGlja2VkPXsoKSA9PiByZWxvYWQoKX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtbGVhZi1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbG9jay1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZWRpdE1vZGUuc2V0KCFlZGl0TW9kZS5nZXQoKSl9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wZW5jaWwtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG4gZGFuZ2VyXCIgb25DbGlja2VkPXsoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcInNlc3Npb25cIil9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgPC9ib3g+XG4gICAgPEdub2JsaW5CYW5uZXIgLz5cbiAgICB7Lyogb25lIGNoaXBzIGdyaWQ6IDMgcm93cyBhdCA4cHgsIG1hcmdpbi1ib3R0b20gMTAgYmVmb3JlIHRoZSBzbGlkZXJzICovfVxuICAgIDxib3ggY2xhc3M9XCJjaGlwLWdyaWRcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICB7KERFTU8gfHwgbmV0LndpZmkpICYmIDxDaGlwIGlkPVwid2lmaVwiIGxhYmVsPVwiV2ktRmlcIiBpY29uPVwia29iZWwtd2lmaS1zeW1ib2xpY1wiXG4gICAgICAgICAgYWN0aXZlPXtERU1PID8gVmFyaWFibGUodHJ1ZSkgOiBiaW5kKG5ldC53aWZpISwgXCJlbmFibGVkXCIpfVxuICAgICAgICAgIHN1Yj17REVNTyA/IEQud2lmaVNzaWQgOiBiaW5kKG5ldC53aWZpISwgXCJzc2lkXCIpLmFzKHMgPT4gcyA/PyBcIk9mZlwiKX1cbiAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHsgaWYgKCFERU1PICYmIG5ldC53aWZpKSBuZXQud2lmaS5lbmFibGVkID0gIW5ldC53aWZpLmVuYWJsZWQgfX1cbiAgICAgICAgICBvbkRyaWxsPXsoKSA9PiBkcmlsbC5zZXQoXCJ3aWZpXCIpfSAvPn1cbiAgICAgICAgPENoaXAgaWQ9XCJidFwiIGxhYmVsPVwiQmx1ZXRvb3RoXCIgaWNvbj1cImtvYmVsLWJsdWV0b290aC1zeW1ib2xpY1wiXG4gICAgICAgICAgYWN0aXZlPXtERU1PID8gVmFyaWFibGUodHJ1ZSkgOiBiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoZCA9PiBkLnNvbWUoeCA9PiB4LmNvbm5lY3RlZCkpfVxuICAgICAgICAgIHN1Yj17REVNTyA/IEQuYnREZXZpY2UgOiBiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoZCA9PlxuICAgICAgICAgICAgZC5maW5kKHggPT4geC5jb25uZWN0ZWQpPy5hbGlhcyA/PyBcIk9mZlwiKX1cbiAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHsgaWYgKCFERU1PKSBidC50b2dnbGUoKSB9fVxuICAgICAgICAgIG9uRHJpbGw9eygpID0+IGRyaWxsLnNldChcImJ0XCIpfSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgPFRvZ2dsZUNoaXAgbGFiZWw9XCJQb3dlciBTYXZlclwiIGljb249XCJrb2JlbC1ib2x0LXN5bWJvbGljXCIgdj17dFNhdmV9IC8+XG4gICAgICAgIDxUb2dnbGVDaGlwIGxhYmVsPVwiRGFyayBTdHlsZVwiIGljb249XCJrb2JlbC1tb29uLXN5bWJvbGljXCIgdj17dERhcmt9IC8+XG4gICAgICA8L2JveD5cbiAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICA8VG9nZ2xlQ2hpcCBsYWJlbD1cIlNpbGVudFwiIGljb249XCJrb2JlbC1iZWxsLXNsYXNoLXN5bWJvbGljXCIgdj17dFNpbGVudH0gLz5cbiAgICAgICAgPFRvZ2dsZUNoaXAgbGFiZWw9XCJOaWdodCBMaWdodFwiIGljb249XCJrb2JlbC1zdW4tc3ltYm9saWNcIiB2PXt0TmlnaHR9IC8+XG4gICAgICA8L2JveD5cbiAgICA8L2JveD5cbiAgICA8U2xpZGVycyAvPlxuICA8L2JveD5cbn1cblxuLy8gU2lnbmFsLXN0cmVuZ3RoIGdseXBoIGZvciBhbiBhY2Nlc3MgcG9pbnQgKDBcdTIwMTMxMDAgXHUyMTkyIHdpZmkgdGllcnMpLlxuZnVuY3Rpb24gd2lmaUljb24oc3RyZW5ndGg6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiBcImtvYmVsLXdpZmktc3ltYm9saWNcIiAgIC8vIHNpbmdsZSBnbHlwaDsgc3RyZW5ndGggc2hvd24gYXMgdGV4dCBtZXRhXG59XG5cbi8vIFdpLUZpIEFQIGxpc3QgXHUyMDE0IHJlYWwgQXN0YWxOZXR3b3JrIGFjY2VzcyBwb2ludHMsIGNvbm5lY3RlZCBvbmUgbWFya2VkIC5hY3RpdmUuXG5mdW5jdGlvbiBXaWZpTGlzdCgpIHtcbiAgY29uc3Qgd2lmaSA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKS53aWZpXG4gIGlmICghd2lmaSkgcmV0dXJuIDxib3ggLz5cbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgIHtiaW5kKHdpZmksIFwiYWNjZXNzUG9pbnRzXCIpLmFzKGFwcyA9PiB7XG4gICAgICBjb25zdCBhY3RpdmUgPSB3aWZpLmFjdGl2ZUFjY2Vzc1BvaW50XG4gICAgICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICAgIHJldHVybiBhcHNcbiAgICAgICAgLmZpbHRlcihhcCA9PiBhcC5zc2lkICYmICFzZWVuLmhhcyhhcC5zc2lkKSAmJiBzZWVuLmFkZChhcC5zc2lkKSlcbiAgICAgICAgLnNvcnQoKGEsIGIpID0+IGIuc3RyZW5ndGggLSBhLnN0cmVuZ3RoKVxuICAgICAgICAuc2xpY2UoMCwgNilcbiAgICAgICAgLm1hcChhcCA9PiB7XG4gICAgICAgICAgY29uc3Qgb24gPSBhY3RpdmUgJiYgYXAuc3NpZCA9PT0gYWN0aXZlLnNzaWRcbiAgICAgICAgICByZXR1cm4gPGJ1dHRvbiBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gd2lmaS5hY3RpdmF0ZV9jb25uZWN0aW9uKGFwLCBudWxsKX0+XG4gICAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXt3aWZpSWNvbihhcC5zdHJlbmd0aCl9IC8+XG4gICAgICAgICAgICAgIDxsYWJlbCBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17YXAuc3NpZH0gLz5cbiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwieHNcIiBsYWJlbD17b24gPyBcIkNvbm5lY3RlZFwiIDogYCR7YXAuc3RyZW5ndGh9JWB9IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgfSlcbiAgICB9KX1cbiAgPC9ib3g+XG59XG5cbi8vIEJsdWV0b290aCBkZXZpY2UgbGlzdCBcdTIwMTQgc2FtZSAueHJvdyBncmFtbWFyIGFzIFdpLUZpOyBjb25uZWN0ZWQgZGV2aWNlIGlzIC5hY3RpdmUuXG5mdW5jdGlvbiBCdExpc3QoKSB7XG4gIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgIHtiaW5kKGJ0LCBcImRldmljZXNcIikuYXMoZGV2aWNlcyA9PiBkZXZpY2VzXG4gICAgICAuZmlsdGVyKGQgPT4gZC5uYW1lIHx8IGQuYWxpYXMpXG4gICAgICAuc29ydCgoYSwgYikgPT4gTnVtYmVyKGIuY29ubmVjdGVkKSAtIE51bWJlcihhLmNvbm5lY3RlZCkpXG4gICAgICAuc2xpY2UoMCwgNilcbiAgICAgIC5tYXAoZGV2ID0+IHtcbiAgICAgICAgY29uc3Qgb24gPSBkZXYuY29ubmVjdGVkXG4gICAgICAgIHJldHVybiA8YnV0dG9uIGNsYXNzPXtvbiA/IFwieHJvdyBhY3RpdmVcIiA6IFwieHJvd1wifVxuICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gb24gPyBkZXYuZGlzY29ubmVjdF9kZXZpY2UoKSA6IGRldi5jb25uZWN0X2RldmljZSgpfT5cbiAgICAgICAgICA8Ym94IHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJsdWV0b290aC1zeW1ib2xpY1wiIC8+XG4gICAgICAgICAgICA8bGFiZWwgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2Rldi5hbGlhcyB8fCBkZXYubmFtZX0gLz5cbiAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInhzXCIgbGFiZWw9e29uID8gXCJDb25uZWN0ZWRcIiA6IGRldi5wYWlyZWQgPyBcIlBhaXJlZFwiIDogXCJBdmFpbGFibGVcIn0gLz5cbiAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9idXR0b24+XG4gICAgICB9KSl9XG4gIDwvYm94PlxufVxuXG4vLyBPbmUgbWl4ZXIgcm93ICgubWl4cm93KSBcdTIwMTQgaG9yaXpvbnRhbDogMjZcdTAwRDcyNiBpY29uIHRpbGUgXHUwMEI3IDcycHggbmFtZSBcdTAwQjcgc2xpZGVyIGZpbGxzLlxuZnVuY3Rpb24gTWl4Um93KHByb3BzOiB7IGljb246IHN0cmluZywgdGl0bGU6IHN0cmluZywgdGFyZ2V0OiBhbnkgfSkge1xuICByZXR1cm4gPGJveCBjbGFzcz1cIm1peHJvd1wiIHNwYWNpbmc9ezEwfT5cbiAgICA8Ym94IGNsYXNzPVwibWlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgPGltYWdlIGljb25OYW1lPXtwcm9wcy5pY29ufSAvPjwvYm94PlxuICAgIDxsYWJlbCBjbGFzcz1cIm1uYW1lXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgIGVsbGlwc2l6ZT17M30gbGFiZWw9e3Byb3BzLnRpdGxlfSAvPlxuICAgIDxzbGlkZXIgY2xhc3M9XCJzbGlkZXJcIiBoZXhwYW5kIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgIHZhbHVlPXtiaW5kKHByb3BzLnRhcmdldCwgXCJ2b2x1bWVcIil9XG4gICAgICBvbkNoYW5nZVZhbHVlPXsoX3MsIHYpID0+IHsgcHJvcHMudGFyZ2V0LnZvbHVtZSA9IHYgfX0gLz5cbiAgPC9ib3g+XG59XG5cbi8vIFBlci1hcHAgdm9sdW1lIG1peGVyIFx1MjAxNCBNYXN0ZXIgKGRlZmF1bHQgc3BlYWtlcikgKyBlYWNoIGF1ZGlvIHN0cmVhbSAoQXN0YWxXcCkuXG5mdW5jdGlvbiBNaXhMaXN0KCkge1xuICBjb25zdCB3cCA9IFdwLmdldF9kZWZhdWx0KClcbiAgaWYgKCF3cCkgcmV0dXJuIDxib3ggLz5cbiAgY29uc3Qgc3BlYWtlciA9IHdwLmRlZmF1bHRfc3BlYWtlclxuICByZXR1cm4gPGJveCBjbGFzcz1cImRsaXN0XCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAge3NwZWFrZXIgJiYgPE1peFJvdyBpY29uPVwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIgdGl0bGU9XCJPdXRwdXRcIiB0YXJnZXQ9e3NwZWFrZXJ9IC8+fVxuICAgIHtiaW5kKHdwLmF1ZGlvLCBcInN0cmVhbXNcIikuYXMoc3RyZWFtcyA9PiBzdHJlYW1zLnNsaWNlKDAsIDUpLm1hcChzID0+XG4gICAgICA8TWl4Um93IGljb249XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgIHRpdGxlPXtzLmRlc2NyaXB0aW9uIHx8IHMubmFtZSB8fCBcIkFwcGxpY2F0aW9uXCJ9IHRhcmdldD17c30gLz4pKX1cbiAgPC9ib3g+XG59XG5cbmZ1bmN0aW9uIERyaWxsVmlldyh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgY29uc3QgbmV0ID0gTmV0d29yay5nZXRfZGVmYXVsdCgpXG4gIHJldHVybiA8Ym94IG5hbWU9e25hbWV9IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgIDxjZW50ZXJib3ggY2xhc3M9XCJkaGVhZFwiPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG5cIiBvbkNsaWNrZWQ9eygpID0+IGRyaWxsLnNldChudWxsKX0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tbGVmdC1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8bGFiZWwgbGFiZWw9e2JpbmQoZHJpbGwpLmFzKGQgPT5cbiAgICAgICAgZCA9PT0gXCJ3aWZpXCIgPyBcIldpLUZpXCIgOiBkID09PSBcImJ0XCIgPyBcIkJsdWV0b290aFwiIDogXCJWb2x1bWVcIil9IC8+XG4gICAgICA8Ym94IHdpZHRoUmVxdWVzdD17NDZ9IGhhbGlnbj17R3RrLkFsaWduLkVORH0+XG4gICAgICAgIHtuZXQud2lmaSAmJiA8c3dpdGNoIGFjdGl2ZT17YmluZChuZXQud2lmaSwgXCJlbmFibGVkXCIpfVxuICAgICAgICAgIHZpc2libGU9e2JpbmQoZHJpbGwpLmFzKGQgPT4gZCA9PT0gXCJ3aWZpXCIpfVxuICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXtzID0+IHsgbmV0LndpZmkhLmVuYWJsZWQgPSBzLmFjdGl2ZSB9fSAvPn1cbiAgICAgICAgPHN3aXRjaCBhY3RpdmU9e2JpbmQoQmx1ZXRvb3RoLmdldF9kZWZhdWx0KCksIFwicG93ZXJlZFwiKX1cbiAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcyhkID0+IGQgPT09IFwiYnRcIil9XG4gICAgICAgICAgb25Ob3RpZnlBY3RpdmU9e3MgPT4geyBCbHVldG9vdGguZ2V0X2RlZmF1bHQoKS5hZGFwdGVyLnBvd2VyZWQgPSBzLmFjdGl2ZSB9fSAvPlxuICAgICAgPC9ib3g+XG4gICAgPC9jZW50ZXJib3g+XG4gICAge2JpbmQoZHJpbGwpLmFzKGQgPT5cbiAgICAgIGQgPT09IFwid2lmaVwiID8gPFdpZmlMaXN0IC8+IDogZCA9PT0gXCJidFwiID8gPEJ0TGlzdCAvPiA6XG4gICAgICBkID09PSBcIm1peFwiID8gPE1peExpc3QgLz4gOiA8Ym94IC8+KX1cbiAgPC9ib3g+XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFF1aWNrU2V0dGluZ3MoKSB7XG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cInF1aWNrc2V0dGluZ3NcIiBuYW1lc3BhY2U9XCJrb2JlbC1xc1wiIGNsYXNzPVwicXMtd2luZG93XCIgdmlzaWJsZT17ZmFsc2V9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUfVxuICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgb25LZXlQcmVzc2VkPXsoc2VsZiwga2V5KSA9PiB7XG4gICAgICBpZiAoa2V5ICE9PSBHZGsuS0VZX0VzY2FwZSkgcmV0dXJuIGZhbHNlXG4gICAgICBpZiAoZHJpbGwuZ2V0KCkpIHsgZHJpbGwuc2V0KG51bGwpOyByZXR1cm4gdHJ1ZSB9ICAgLy8gRXNjIHN0ZXBzIGJhY2sgZmlyc3RcbiAgICAgIHNlbGYuaGlkZSgpOyByZXR1cm4gdHJ1ZVxuICAgIH19PlxuICAgIDxib3ggY2xhc3M9XCJzaGVldCBxc1wiPlxuICAgICAgey8qIEd0ay5TdGFjayB3aXRoIHNsaWRlLWxlZnQvcmlnaHQgPSB0aGUgbXVsdGl2aWV3OyBoZWlnaHQgYW5pbWF0ZXNcbiAgICAgICAgICB2aWEgQWR3IHNwcmluZyBvbiBhIHNpemUtZ3JvdXAgd3JhcHBlciAoTU9USU9OLmRyaWxsIC8gZHJpbGxCYWNrKSAqL31cbiAgICAgIDxzdGFja1xuICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlN0YWNrVHJhbnNpdGlvblR5cGUuU0xJREVfTEVGVF9SSUdIVH1cbiAgICAgICAgdHJhbnNpdGlvbkR1cmF0aW9uPXsyMjB9XG4gICAgICAgIHZpc2libGVDaGlsZE5hbWU9e2JpbmQoZHJpbGwpLmFzKGQgPT4gZCA/IFwiZHJpbGxcIiA6IFwicm9vdFwiKX0+XG4gICAgICAgIDxSb290IG5hbWU9XCJyb290XCIgLz5cbiAgICAgICAgPERyaWxsVmlldyBuYW1lPVwiZHJpbGxcIiAvPlxuICAgICAgPC9zdGFjaz5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gVGlueVNsaWRlciBcdTIwMTQgR3RrLlNjYWxlIHN1YmNsYXNzIHRoYXQgcmVwb3J0cyBuZWFyLXplcm8gbmF0dXJhbCB3aWR0aCBzbyBpdFxuLy8gbmV2ZXIgZm9yY2VzIGl0cyBwYXJlbnQgY29udGFpbmVyIHdpZGVyIHRoYW4gdGhlIGNoaXAtZ3JpZCdzIG5hdHVyYWwgd2lkdGguXG4vLyBXZSBleHRlbmQgR3RrLlNjYWxlIGRpcmVjdGx5IChub3QgQXN0YWwuU2xpZGVyKSBiZWNhdXNlIEFzdGFsLlNsaWRlcidzIFZhbGFcbi8vIEMgdmZ1bmNzIGNhbiBpbnRlcmNlcHQgdGhlIG1lYXN1cmUgY2hhaW4gYmVmb3JlIHRoZSBHSlMgb3ZlcnJpZGUgaXMgcmVhY2hlZC5cbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGtcIlxuXG5leHBvcnQgY29uc3QgVGlueVNsaWRlciA9IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7XG4gIEdUeXBlTmFtZTogXCJLb2JlbFRpbnlTY2FsZVwiLFxufSwgY2xhc3MgVGlueVNsaWRlciBleHRlbmRzIEd0ay5TY2FsZSB7XG4gIGNvbnN0cnVjdG9yKHBhcmFtcz86IFBhcnRpYWw8R3RrLlNjYWxlLkNvbnN0cnVjdG9yUHJvcHMgJiB7IHZhbHVlPzogbnVtYmVyIH0+KSB7XG4gICAgY29uc3QgeyB2YWx1ZSwgLi4ucmVzdCB9ID0gKHBhcmFtcyA/PyB7fSkgYXMgYW55XG4gICAgc3VwZXIoe1xuICAgICAgb3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbi5IT1JJWk9OVEFMLFxuICAgICAgYWRqdXN0bWVudDogbmV3IEd0ay5BZGp1c3RtZW50KHtcbiAgICAgICAgbG93ZXI6IDAsIHVwcGVyOiAxLFxuICAgICAgICBzdGVwX2luY3JlbWVudDogMC4wMSwgcGFnZV9pbmNyZW1lbnQ6IDAuMSwgcGFnZV9zaXplOiAwLFxuICAgICAgICB2YWx1ZTogdmFsdWUgPz8gMCxcbiAgICAgIH0pLFxuICAgICAgZHJhd192YWx1ZTogZmFsc2UsXG4gICAgICAuLi5yZXN0LFxuICAgIH0pXG4gIH1cblxuICB2ZnVuY19tZWFzdXJlKG9yaWVudGF0aW9uOiBHdGsuT3JpZW50YXRpb24sIGZvcl9zaXplOiBudW1iZXIpOiBbbnVtYmVyLCBudW1iZXIsIG51bWJlciwgbnVtYmVyXSB7XG4gICAgaWYgKG9yaWVudGF0aW9uID09PSBHdGsuT3JpZW50YXRpb24uSE9SSVpPTlRBTCkge1xuICAgICAgLy8gUmVwb3J0IG5hdHVyYWw9MSBzbyB0aGUgc3Jvdy9zbGlkZXJzIGNvbnRhaW5lciBkb2Vzbid0IGluZmxhdGUgdGhlIFFTIHBhbmVsXG4gICAgICAvLyBiZXlvbmQgdGhlIGNoaXAtZ3JpZCBuYXR1cmFsIHdpZHRoLiBUaGUgc2xpZGVyIHN0aWxsIGhleHBhbmRzIHRvIGZpbGwgdGhlXG4gICAgICAvLyBhdmFpbGFibGUgc3BhY2UgYXQgYWxsb2NhdGlvbiB0aW1lIFx1MjAxNCBvbmx5IHRoZSBuYXR1cmFsIHNpemUgaXMgb3ZlcnJpZGRlbi5cbiAgICAgIHJldHVybiBbMCwgMSwgLTEsIC0xXTtcbiAgICB9XG4gICAgcmV0dXJuIHN1cGVyLnZmdW5jX21lYXN1cmUob3JpZW50YXRpb24sIGZvcl9zaXplKTtcbiAgfVxufSlcbiIsICIvLyBOb3RpZmljYXRpb25zLiBQcm90b3R5cGUtZmluYWw6IGZsb2F0aW5nIGJsdXJyZWQgdG9hc3RzICh0b3AtcmlnaHQsIHRoZSBPTkVcbi8vIHNhbmN0aW9uZWQgdHJhbnNsdWNlbmN5KSArIHJpZ2h0IGRyYXdlciAobWVkaWEgY2FyZCBvbiB0b3AsIHBhbmVsLWxlc3MgY2FyZHNcbi8vIGZsb2F0aW5nIG9uIHdhbGxwYXBlciwgaGVhZGVyIGNoaXApLiBUaGUgdW5pZmllZCBwaXBlbGluZTogb3BlbiB0aGUgZHJhd2VyIHdoaWxlXG4vLyBhIHRvYXN0IGlzIGxpdmUgYW5kIGl0J3MgQURPUFRFRCBpbnRvIHRoZSBzdGFjazsgdG9hc3RzIGFycml2aW5nIHdoaWxlIG9wZW5cbi8vIGluc2VydCBhcyBjYXJkczsgU2lsZW50IHJvdXRlcyBzdHJhaWdodCB0byB0aGUgc3RvcmUuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCB0aW1lb3V0LCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuXG4vLyBMYXp5IHNpbmdsZXRvbiBcdTIwMTQgY2FsbGluZyBnZXRfZGVmYXVsdCgpIGF0IG1vZHVsZSBzY29wZSBibG9ja3MgdGhlIGltcG9ydCB3aGlsZVxuLy8gQXN0YWxOb3RpZmQgdHJpZXMgdG8gYWNxdWlyZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyAoaGFuZ3MgaWYgZ25vbWUtc2hlbGxcbi8vIHN0aWxsIG93bnMgaXQpLiBEZWZlcnJpbmcgdG8gZmlyc3QgdXNlIGxldHMgdGhlIG1vZHVsZSBpbXBvcnQgY2xlYW5seTsgdGhlIGJ1cyBpc1xuLy8gcmVsZWFzZWQgYnkgYGdub2JsaW5jdGwgZGlzYWJsZSBub3RpZmljYXRpb25zYCBiZWZvcmUgdGhlIGRhZW1vbiBhY3R1YWxseSBjbGFpbXMgaXQuXG5sZXQgX25vdGlmZDogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5jb25zdCBuZCA9ICgpID0+IChfbm90aWZkID8/PSBOb3RpZmQuZ2V0X2RlZmF1bHQoKSlcbmNvbnN0IHNraXAgPSAoKSA9PiAhIUdMaWIuZ2V0ZW52KFwiS09CRUxfU0tJUF9OT1RJRkRcIilcbmNvbnN0IFRPQVNUX01TID0gMzgwMFxuLy8gUmVhY3RpdmUgZHJhd2VyLW9wZW4gc3RhdGUgc28gdGhlIHRvYXN0cyBjYW4gYmUgQURPUFRFRCAoaGlkZGVuKSB0aGUgaW5zdGFudCB0aGVcbi8vIGRyYXdlciBvcGVucywgd2l0aG91dCBwb2xsaW5nIGEgbG9va2VkLXVwIHdpbmRvdydzIHZpc2liaWxpdHkuXG5jb25zdCBkcmF3ZXJPcGVuID0gVmFyaWFibGUoZmFsc2UpXG5cbi8vIE5vdGlmaWNhdGlvbiBjYXJkcyBhcmUgYSBkZWZpbmVkIHdpZHRoIChwcm90b3R5cGUgYHB3YCBcdTIyNDggUVMgcGFuZWwpIHNvIHRoZSB0b2FzdFxuLy8gZG9lc24ndCBzdHJldGNoIHRvIHRoZSBoZXhwYW5kIHRleHQgY29sdW1uOyB0aGUgZHJhd2VyIGNhcmRzIGZpbGwgdGhlIHNhbWUgd2lkdGguXG5jb25zdCBOQ0FSRF9XID0gMzI3XG5mdW5jdGlvbiBDYXJkKHsgbiB9OiB7IG46IE5vdGlmZC5Ob3RpZmljYXRpb24gfSkge1xuICByZXR1cm4gPGJveCBjbGFzcz1cIm5jYXJkXCIgc3BhY2luZz17MTB9IHdpZHRoUmVxdWVzdD17TkNBUkRfV30+XG4gICAgey8qIGFwcCBpY29uIGluIGEgMzBcdTAwRDczMCByOSB0aWxlIChwcm90b3R5cGUgLm5pYykgKi99XG4gICAgPGJveCBjbGFzcz1cIm5pY1wiIHZhbGlnbj17R3RrLkFsaWduLlNUQVJUfT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17bi5hcHBfaWNvbiB8fCBcImRpYWxvZy1pbmZvcm1hdGlvbi1zeW1ib2xpY1wifSBwaXhlbFNpemU9ezIwfSAvPlxuICAgIDwvYm94PlxuICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gaGV4cGFuZD5cbiAgICAgIDxib3g+XG4gICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gaGV4cGFuZCBlbGxpcHNpemU9ezN9IGxhYmVsPXtuLnN1bW1hcnl9IC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cIndoZW4gdG5cIiBsYWJlbD17bmV3IERhdGUobi50aW1lICogMTAwMClcbiAgICAgICAgICAudG9Mb2NhbGVUaW1lU3RyaW5nKFwiZW4tR0JcIiwgeyBob3VyOiBcIjItZGlnaXRcIiwgbWludXRlOiBcIjItZGlnaXRcIiB9KX0gLz5cbiAgICAgIDwvYm94PlxuICAgICAgPGxhYmVsIGNsYXNzPVwiYm9keVwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSB4YWxpZ249ezB9IHdyYXBcbiAgICAgICAgbWF4V2lkdGhDaGFycz17NDB9IGxhYmVsPXtuLmJvZHl9IC8+XG4gICAgPC9ib3g+XG4gICAgPGJ1dHRvbiBjbGFzcz1cIm54XCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IG9uQ2xpY2tlZD17KCkgPT4gbi5kaXNtaXNzKCl9PlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2xvc2Utc3ltYm9saWNcIiAvPlxuICAgIDwvYnV0dG9uPlxuICA8L2JveD5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIFRvYXN0cyhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICAvLyBPbmx5IHJlbmRlciBub3RpZmljYXRpb25zIHlvdW5nZXIgdGhhbiBUT0FTVF9NUyB3aGlsZSB0aGUgZHJhd2VyIGlzIENMT1NFRCBcdTIwMTRcbiAgLy8gb3BlbmluZyB0aGUgZHJhd2VyIFwiYWRvcHRzXCIgdGhlbSAodGhleSBzaW1wbHkgY29udGludWUgbGlmZSBhcyBkcmF3ZXIgY2FyZHMsXG4gIC8vIHdoaWNoIGlzIHRoZSBGTElQIGhhbmRvZmYgZXhwcmVzc2VkIGluIHJldGFpbmVkLW1vZGUgdGVybXMpLlxuICBjb25zdCBsaXZlID0gVmFyaWFibGU8bnVtYmVyW10+KFtdKVxuICAvLyBgc2hvd25gID0gd2hhdCB0aGUgdG9hc3QgY29sdW1uIHJlbmRlcnMuIFJlY29tcHV0ZWQgZXhwbGljaXRseSBvbiBldmVyeSBpbnB1dFxuICAvLyBjaGFuZ2UgKFZhcmlhYmxlLmRlcml2ZSBkaWRuJ3QgcHJvZHVjZSBhIHJlYWN0aXZlIGJpbmRpbmcgaGVyZSkuIEVtcHR5IHdoaWxlIHRoZVxuICAvLyBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG8gdGhlIGRyYXdlciBzdGFjaykuXG4gIGNvbnN0IHNob3duID0gVmFyaWFibGU8bnVtYmVyW10+KFtdKVxuICBjb25zdCByZWNvbXB1dGUgPSAoKSA9PiBzaG93bi5zZXQoZHJhd2VyT3Blbi5nZXQoKSA/IFtdIDogbGl2ZS5nZXQoKSlcbiAgbGl2ZS5zdWJzY3JpYmUocmVjb21wdXRlKVxuICBkcmF3ZXJPcGVuLnN1YnNjcmliZShyZWNvbXB1dGUpXG4gIG5kKCkuY29ubmVjdChcIm5vdGlmaWVkXCIsIChfbiwgaWQpID0+IHtcbiAgICBpZiAoZHJhd2VyT3Blbi5nZXQoKSB8fCBuZCgpLmRvbnRfZGlzdHVyYikgcmV0dXJuXG4gICAgbGl2ZS5zZXQoWy4uLmxpdmUuZ2V0KCksIGlkXSlcbiAgICB0aW1lb3V0KFRPQVNUX01TLCAoKSA9PiBsaXZlLnNldChsaXZlLmdldCgpLmZpbHRlcih4ID0+IHggIT09IGlkKSkpXG4gIH0pXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cInRvYXN0c1wiIG5hbWVzcGFjZT1cImtvYmVsLXRvYXN0c1wiIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgLy8gSGlkZSB0aGUgd2hvbGUgdG9hc3Qgc3VyZmFjZSB3aGlsZSB0aGUgZHJhd2VyIGlzIG9wZW4gKHRvYXN0cyBhcmUgQURPUFRFRCBpbnRvXG4gICAgLy8gdGhlIGRyYXdlcikgXHUyMDE0IGEgcmVhY3RpdmUgd2luZG93LXZpc2liaWxpdHkgYmluZCwgcm9idXN0IHJlZ2FyZGxlc3Mgb2YgdGhlXG4gICAgLy8gcGVyLWl0ZW0gbGlzdCByZWNvbmNpbGlhdGlvbi5cbiAgICB2aXNpYmxlPXtiaW5kKGRyYXdlck9wZW4pLmFzKG8gPT4gIW8pfVxuICAgIC8vIFRvYXN0cyBhcmUgYSBmbG9hdGluZyBvdmVybGF5IChsaWtlIHRoZSBwcm90b3R5cGUncyBhYnNvbHV0ZSB0b3AvcmlnaHQpOyB0aGVcbiAgICAvLyBmbG9hdCBpbnNldCBjbGVhcnMgdGhlIGZsb2F0aW5nIGJhciAobWFyZ2luVG9wIDEwICsgaGVpZ2h0IDQyKSArIGEgc21hbGwgZ2FwLFxuICAgIC8vIGFuZCB0aGUgcmlnaHQgaW5zZXQgbWF0Y2hlcyB0aGUgYmFyJ3MgZWRnZSBtYXJnaW4uXG4gICAgbWFyZ2luVG9wPXs1OH0gbWFyZ2luUmlnaHQ9ezEyfVxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH0+XG4gICAgey8qIGZpeGVkIHRvYXN0IGNvbHVtbiB3aWR0aCBzbyB0aGUgY2FyZCBjYW4ndCBzdHJldGNoIHRvIGl0cyBoZXhwYW5kIHRleHQgY29sdW1uICovfVxuICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH1cbiAgICAgIHdpZHRoUmVxdWVzdD17TkNBUkRfVyArIDI2fSBoYWxpZ249e0d0ay5BbGlnbi5FTkR9PlxuICAgICAge2JpbmQoc2hvd24pLmFzKGlkcyA9PiBpZHMubWFwKGlkID0+IHtcbiAgICAgICAgY29uc3QgbiA9IG5kKCkuZ2V0X25vdGlmaWNhdGlvbihpZClcbiAgICAgICAgcmV0dXJuIG4gPyA8Ym94IGNsYXNzPVwidG9hc3RcIj48Q2FyZCBuPXtufSAvPjwvYm94PiA6IDxib3ggLz5cbiAgICAgIH0pKX1cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG5cbmZ1bmN0aW9uIE1lZGlhQ2FyZCgpIHtcbiAgbGV0IHBsYXllcjogYW55ID0gbnVsbFxuICB0cnkgeyBwbGF5ZXIgPSBNcHJpcy5nZXRfZGVmYXVsdCgpPy5wbGF5ZXJzPy5bMF0gPz8gbnVsbCB9IGNhdGNoIHsgcGxheWVyID0gbnVsbCB9XG4gIGlmICghcGxheWVyKSByZXR1cm4gPGJveCB2aXNpYmxlPXtmYWxzZX0gLz5cbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJuY2FyZCBtZWRpYVwiIHNwYWNpbmc9ezExfT5cbiAgICA8aW1hZ2UgcGl4ZWxTaXplPXs0Nn0gaWNvbk5hbWU9XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiIC8+XG4gICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBoZXhwYW5kIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e2JpbmQocGxheWVyLCBcInRpdGxlXCIpfSAvPlxuICAgICAgPGxhYmVsIGNsYXNzPVwic3ViXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtiaW5kKHBsYXllciwgXCJhcnRpc3RcIil9IC8+XG4gICAgPC9ib3g+XG4gICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IHBsYXllci5wcmV2aW91cygpfT48aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1za2lwLWJhY2stc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgIDxidXR0b24gb25DbGlja2VkPXsoKSA9PiBwbGF5ZXIucGxheV9wYXVzZSgpfT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17YmluZChwbGF5ZXIsIFwicGxheWJhY2tfc3RhdHVzXCIpLmFzKHMgPT5cbiAgICAgICAgcyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORyA/IFwia29iZWwtcGF1c2Utc3ltYm9saWNcIiA6IFwia29iZWwtcGxheS1zeW1ib2xpY1wiKX0gLz5cbiAgICA8L2J1dHRvbj5cbiAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4gcGxheWVyLm5leHQoKX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1md2Qtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICA8L2JveD5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIERyYXdlcigpIHtcbiAgaWYgKHNraXAoKSkgcmV0dXJuIG51bGxcbiAgY29uc3QgbmZkID0gbmQoKVxuICAvLyBEcml2ZSB0aGUgbGlzdCBmcm9tIGEgVmFyaWFibGUgb2ZmIGdldF9ub3RpZmljYXRpb25zKCkgKyBzaWduYWxzLCBub3QgYSBwcm9wZXJ0eVxuICAvLyBiaW5kIFx1MjAxNCBBc3RhbE5vdGlmZCdzIGBub3RpZmljYXRpb25zYCBpc24ndCByZWxpYWJseSBiaW5kYWJsZSBhY3Jvc3MgR0pTIHZlcnNpb25zLlxuICBjb25zdCBsaXN0ID0gVmFyaWFibGU8Tm90aWZkLk5vdGlmaWNhdGlvbltdPihuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKSA/PyBbXSlcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGxpc3Quc2V0KG5mZC5nZXRfbm90aWZpY2F0aW9ucygpID8/IFtdKVxuICBuZmQuY29ubmVjdChcIm5vdGlmaWVkXCIsIHJlZnJlc2gpXG4gIG5mZC5jb25uZWN0KFwicmVzb2x2ZWRcIiwgcmVmcmVzaClcbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwiZHJhd2VyXCIgbmFtZXNwYWNlPVwia29iZWwtZHJhd2VyXCIgY2xhc3M9XCJkcmF3ZXItd2luZG93XCIgdmlzaWJsZT17ZmFsc2V9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX1cbiAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLk9OX0RFTUFORH1cbiAgICBzZXR1cD17KHNlbGY6IEd0ay5XaW5kb3cpID0+IHNlbGYuY29ubmVjdChcIm5vdGlmeTo6dmlzaWJsZVwiLFxuICAgICAgKCkgPT4gZHJhd2VyT3Blbi5zZXQoc2VsZi52aXNpYmxlKSl9XG4gICAgb25LZXlQcmVzc2VkPXsoc2VsZiwga2V5KSA9PiBrZXkgPT09IEdkay5LRVlfRXNjYXBlID8gKHNlbGYuaGlkZSgpLCB0cnVlKSA6IGZhbHNlfT5cbiAgICA8Ym94IGNsYXNzPVwiZHJhd2VyXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICA8TWVkaWFDYXJkIC8+XG4gICAgICA8Ym94IGNsYXNzPVwibmhlYWRcIiBzcGFjaW5nPXs4fT5cbiAgICAgICAgPGxhYmVsIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPVwiTm90aWZpY2F0aW9uc1wiIC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cInRuIHN1YlwiIGxhYmVsPXtiaW5kKGxpc3QpLmFzKG4gPT4gYCR7bi5sZW5ndGggfHwgXCJcIn1gKX0gLz5cbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm5jbGVhclwiIG9uQ2xpY2tlZD17KCkgPT5cbiAgICAgICAgICBuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKS5mb3JFYWNoKG4gPT4gbi5kaXNtaXNzKCkpfT5cbiAgICAgICAgICA8Ym94IHNwYWNpbmc9ezV9PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXRyYXNoLXN5bWJvbGljXCIgLz48bGFiZWwgbGFiZWw9XCJDbGVhclwiIC8+PC9ib3g+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgPC9ib3g+XG4gICAgICB7LyogZnVsbC1oZWlnaHQgZHJhd2VyLCBzbyBjYXJkcyBqdXN0IHN0YWNrIChob2xkcyBtYW55KS4gQSBHdGsuU2Nyb2xsZWRXaW5kb3dcbiAgICAgICAgICB3cmFwcGVyIGNvbGxhcHNlcyBoZXJlIFx1MjAxNCBhc3RhbCdzIHJlYWN0aXZlIGJpbmQoKSBjaGlsZHJlbiBkb24ndCByZW5kZXIgaW5zaWRlXG4gICAgICAgICAgYSBtYW51YWxseS1jb25zdHJ1Y3RlZCBTY3JvbGxlZFdpbmRvdyBjaGlsZCwgc28gaXQgcmVwb3J0cyAwIG5hdHVyYWwgc2l6ZS5cbiAgICAgICAgICBQcm9wZXIgc2Nyb2xsaW5nIGZvciAyMCsgbm90aWZpY2F0aW9ucyBpcyBhIGZvbGxvdy11cC4gKi99XG4gICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9IHZleHBhbmQ+XG4gICAgICAgIHtiaW5kKGxpc3QpLmFzKG5zID0+IChucyAmJiBucy5sZW5ndGgpXG4gICAgICAgICAgPyBucy5tYXAobiA9PiA8Q2FyZCBuPXtufSAvPilcbiAgICAgICAgICA6IFs8Ym94IGNsYXNzPVwibmNhcmQgZW1wdHlcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9XCJBbGwgY2F1Z2h0IHVwIFx1MjcxM1wiIC8+XG4gICAgICAgICAgICA8L2JveD5dKX1cbiAgICAgIDwvYm94PlxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBPU0QgXHUyMDE0IGRpc3BsYXktb25seSB2b2x1bWUgcGlsbCBhYm92ZSB0aGUgZG9jay4gUHJvdG90eXBlOiBwb2ludGVyLWV2ZW50cyBub25lLFxuLy8gYXV0by1oaWRlIDEuNHMsIHRyYW5zbHVjZW50IChibHVyIHZpYSBnbm9ibGluIHdpbmRvdy1ydWxlKS5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBXcCBmcm9tIFwiZ2k6Ly9Bc3RhbFdwXCJcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gT1NEKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICBjb25zdCB2aXNpYmxlID0gVmFyaWFibGUoZmFsc2UpXG4gIGxldCBoaWRlOiBSZXR1cm5UeXBlPHR5cGVvZiB0aW1lb3V0PiB8IG51bGwgPSBudWxsXG4gIGlmICghc3BlYWtlcikgcmV0dXJuIG51bGxcblxuICBzcGVha2VyLmNvbm5lY3QoXCJub3RpZnk6OnZvbHVtZVwiLCAoKSA9PiB7XG4gICAgdmlzaWJsZS5zZXQodHJ1ZSlcbiAgICBoaWRlPy5jYW5jZWwoKVxuICAgIGhpZGUgPSB0aW1lb3V0KDE0MDAsICgpID0+IHZpc2libGUuc2V0KGZhbHNlKSlcbiAgfSlcblxuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJvc2RcIiBuYW1lc3BhY2U9XCJrb2JlbC1vc2RcIiBnZGttb25pdG9yPXttb25pdG9yfVxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX0gbWFyZ2luQm90dG9tPXs3MH1cbiAgICBjbGlja1Rocm91Z2ggdmlzaWJsZT17YmluZCh2aXNpYmxlKX0+XG4gICAgPGJveCBjbGFzcz1cIm9zZFwiIHNwYWNpbmc9ezExfSB3aWR0aFJlcXVlc3Q9ezIzMH0+XG4gICAgICA8aW1hZ2UgaWNvbk5hbWU9e2JpbmQoc3BlYWtlciwgXCJ2b2x1bWVfaWNvblwiKX0gLz5cbiAgICAgIDxsZXZlbGJhciBoZXhwYW5kIHZhbHVlPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpfSAvPlxuICAgICAgPGxhYmVsIGNsYXNzPVwidG5cIiBsYWJlbD17YmluZChzcGVha2VyLCBcInZvbHVtZVwiKS5hcyh2ID0+XG4gICAgICAgIGAke01hdGgucm91bmQodiAqIDEwMCl9JWApfSAvPlxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBTZXNzaW9uIG92ZXJsYXkgXHUyMDE0IGRpbW1lZCAoMC44KSwgNCBidXR0b25zLCBhcnJvdy1uYXYsIFBSRVNTLUFHQUlOIGNvbmZpcm0gb25cbi8vIFJlc3RhcnQvU2h1dCBkb3duIChhdXRvLXJldmVydCA0cyksIHJlc3Rpbmcgcm9zZSBvbiBTaHV0IGRvd24uXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgZXhlY0FzeW5jLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbi8vIFBpbiBhIGRldGVybWluaXN0aWMgcmVuZGVyIGZvciB0aGUgRE9NLXZzLUdUSyBvdmVybGF5IGRpZmYgKGxhYmVscy9pY29ucyBhbHJlYWR5XG4vLyBmaXhlZDsgaW1wb3J0aW5nIERFTU8ga2VlcHMgdGhlIHN1cmZhY2UgcmVuZGVyIGNvbnNpc3RlbnQgdW5kZXIgS09CRUxfREVNTykuXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbnZvaWQgREVNTzsgdm9pZCBEXG5cbmNvbnN0IEFDVElPTlMgPSBbXG4gIHsgaWQ6IFwibG9ja1wiLCBsYWJlbDogXCJMb2NrXCIsIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLFxuICAgIGNvbmZpcm06IGZhbHNlLCBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSB9LFxuICB7IGlkOiBcImxvZ291dFwiLCBsYWJlbDogXCJMb2cgb3V0XCIsIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsXG4gICAgY29uZmlybTogZmFsc2UsIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwiZ25vbWUtc2Vzc2lvbi1xdWl0IC0tbG9nb3V0IC0tbm8tcHJvbXB0XCIpIH0sXG4gIHsgaWQ6IFwicmVzdGFydFwiLCBsYWJlbDogXCJSZXN0YXJ0XCIsIGljb246IFwia29iZWwtcmVsb2FkLXN5bWJvbGljXCIsXG4gICAgY29uZmlybTogdHJ1ZSwgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgcmVib290XCIpIH0sXG4gIHsgaWQ6IFwic2h1dGRvd25cIiwgbGFiZWw6IFwiU2h1dCBkb3duXCIsIGljb246IFwia29iZWwtcG93ZXItc3ltYm9saWNcIixcbiAgICBjb25maXJtOiB0cnVlLCByZWQ6IHRydWUsIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwic3lzdGVtY3RsIHBvd2Vyb2ZmXCIpIH0sXG5dXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIFNlc3Npb24oKSB7XG4gIGNvbnN0IGFybWVkID0gVmFyaWFibGU8c3RyaW5nIHwgbnVsbD4obnVsbClcbiAgbGV0IHJldmVydDogUmV0dXJuVHlwZTx0eXBlb2YgdGltZW91dD4gfCBudWxsID0gbnVsbFxuXG4gIGNvbnN0IHByZXNzID0gKGE6IHR5cGVvZiBBQ1RJT05TW251bWJlcl0sIGhpZGU6ICgpID0+IHZvaWQpID0+IHtcbiAgICBpZiAoYS5jb25maXJtICYmIGFybWVkLmdldCgpICE9PSBhLmlkKSB7XG4gICAgICBhcm1lZC5zZXQoYS5pZClcbiAgICAgIHJldmVydD8uY2FuY2VsKClcbiAgICAgIHJldmVydCA9IHRpbWVvdXQoNDAwMCwgKCkgPT4gYXJtZWQuc2V0KG51bGwpKSAgIC8vIGF1dG8tcmV2ZXJ0IChjcml0aXF1ZSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBhcm1lZC5zZXQobnVsbCk7IGhpZGUoKTsgYS5ydW4oKVxuICB9XG5cbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwic2Vzc2lvblwiIG5hbWVzcGFjZT1cImtvYmVsLXNlc3Npb25cIiBjbGFzcz1cInNlc3Npb24td2luZG93XCIgdmlzaWJsZT17ZmFsc2V9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTSB8XG4gICAgICAgICAgICBBc3RhbC5XaW5kb3dBbmNob3IuTEVGVCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICBrZXltb2RlPXtBc3RhbC5LZXltb2RlLkVYQ0xVU0lWRX0gZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LklHTk9SRX1cbiAgICBvbktleVByZXNzZWQ9eyhzZWxmLCBrZXkpID0+IHtcbiAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfRXNjYXBlKSB7IGFybWVkLnNldChudWxsKTsgc2VsZi5oaWRlKCk7IHJldHVybiB0cnVlIH1cbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH19PlxuICAgIHsvKiAuc2Vzc2lvbiBmaWxscyB0aGUgd2hvbGUgd2luZG93ICh0aGUgZGltKTsgYnV0dG9ucyBjZW50ZXJlZCBpbnNpZGUgKi99XG4gICAgPGJveCBjbGFzcz1cInNlc3Npb25cIiBoZXhwYW5kIHZleHBhbmQ+XG4gICAgICA8Ym94IGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBzcGFjaW5nPXsyMH0gaGV4cGFuZD5cbiAgICAgICAge0FDVElPTlMubWFwKGEgPT5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPXthLnJlZCA/IFwic2J0biByZWRcIiA6IFwic2J0blwifVxuICAgICAgICAgICAgb25DbGlja2VkPXtzZWxmID0+IHByZXNzKGEsICgpID0+IHNlbGYuZ2V0X3Jvb3QoKT8uaGlkZT8uKCkpfT5cbiAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MTB9XG4gICAgICAgICAgICAgIGNsYXNzPXtiaW5kKGFybWVkKS5hcyh4ID0+IHggPT09IGEuaWQgPyBcImNvbmZpcm1cIiA6IFwiXCIpfT5cbiAgICAgICAgICAgICAgPGJveCBjbGFzcz1cInNpY1wiIGhleHBhbmQ9e2ZhbHNlfSB2ZXhwYW5kPXtmYWxzZX1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgey8qIGhvcml6b250YWwgR3RrQm94IGlnbm9yZXMgYSBjaGlsZCdzIG1haW4tYXhpcyBoYWxpZ24sIHNvIHRoZSBpY29uXG4gICAgICAgICAgICAgICAgICAgIGxlZnQtcGFja3M7IGhleHBhbmQgbWFrZXMgdGhlIGltYWdlIGZpbGwgdGhlIDU5cHggdGlsZSBcdTIxOTIgR3RrSW1hZ2VcbiAgICAgICAgICAgICAgICAgICAgY2VudHJlcyB0aGUgZ2x5cGguIGhleHBhbmQ9e2ZhbHNlfSBvbiAuc2ljIGJsb2NrcyBwcm9wYWdhdGlvbiBzbyB0aGVcbiAgICAgICAgICAgICAgICAgICAgdGlsZSBzdGF5cyA1OSB3aWRlIGluc3RlYWQgb2Ygc3RyZXRjaGluZyB0aGUgcm93LiAqL31cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e2EuaWNvbn0gcGl4ZWxTaXplPXsyMn0gaGV4cGFuZFxuICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9e2JpbmQoYXJtZWQpLmFzKHggPT4geCA9PT0gYS5pZCA/IFwiUHJlc3MgYWdhaW5cIiA6IGEubGFiZWwpfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgPC9idXR0b24+KX1cbiAgICAgIDwvYm94PlxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxPQUFPQSxZQUFXO0FBQ2xCLE9BQU9DLFVBQVM7QUFDaEIsT0FBT0MsVUFBUzs7O0FDRmhCLE9BQU9DLFlBQVc7OztBQ0FYLElBQU0sV0FBVyxDQUFDLFFBQWdCLElBQ3BDLFFBQVEsbUJBQW1CLE9BQU8sRUFDbEMsV0FBVyxLQUFLLEdBQUcsRUFDbkIsWUFBWTtBQUVWLElBQU0sV0FBVyxDQUFDLFFBQWdCLElBQ3BDLFFBQVEsbUJBQW1CLE9BQU8sRUFDbEMsV0FBVyxLQUFLLEdBQUcsRUFDbkIsWUFBWTtBQWNWLElBQU0sVUFBTixNQUFNLFNBQWU7QUFBQSxFQUNoQixjQUFjLENBQUMsTUFBVztBQUFBLEVBRWxDO0FBQUEsRUFDQTtBQUFBLEVBU0EsT0FBTyxLQUFLLFNBQXFDLE1BQWU7QUFDNUQsV0FBTyxJQUFJLFNBQVEsU0FBUyxJQUFJO0FBQUEsRUFDcEM7QUFBQSxFQUVRLFlBQVksU0FBNEMsTUFBZTtBQUMzRSxTQUFLLFdBQVc7QUFDaEIsU0FBSyxRQUFRLFFBQVEsU0FBUyxJQUFJO0FBQUEsRUFDdEM7QUFBQSxFQUVBLFdBQVc7QUFDUCxXQUFPLFdBQVcsS0FBSyxRQUFRLEdBQUcsS0FBSyxRQUFRLE1BQU0sS0FBSyxLQUFLLE1BQU0sRUFBRTtBQUFBLEVBQzNFO0FBQUEsRUFFQSxHQUFNLElBQWlDO0FBQ25DLFVBQU1DLFFBQU8sSUFBSSxTQUFRLEtBQUssVUFBVSxLQUFLLEtBQUs7QUFDbEQsSUFBQUEsTUFBSyxj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dXQiLCAiQXN0YWwiLCAiQXN0YWwiLCAiaW5pdCIsICJBc3RhbCIsICJ2IiwgImludGVydmFsIiwgImtleSIsICJjdG9ycyIsICJrZXkiLCAiR3RrIiwgIkFzdGFsIiwgInNuYWtlaWZ5IiwgInBhdGNoIiwgIkFwcHMiLCAiQmx1ZXRvb3RoIiwgIk1wcmlzIiwgIk5vdGlmZCIsICJXcCIsICJBcHAiLCAiR3RrIiwgIkFzdGFsIiwgIkFzdGFsIiwgIkd0ayIsICJHdGsiLCAiQXN0YWwiLCAiY2giLCAiR3RrIiwgIkdkayIsICJHaW8iLCAiR0xpYiIsICJkZWZhdWx0IiwgIkFzdGFsIiwgIkdPYmplY3QiLCAiZGVmYXVsdCIsICJHT2JqZWN0IiwgIkdpbyIsICJHTGliIiwgIkdpbyIsICJHTGliIiwgImluaXQiLCAiR0xpYiIsICJHTGliIiwgInR5cGUiLCAiR0xpYiIsICJBc3RhbCIsICJHdGsiLCAiR09iamVjdCIsICJBc3RhbCIsICJHdGsiLCAiR09iamVjdCIsICJhc3RhbGlmeSIsICJBc3RhbCIsICJHdGsiLCAiR09iamVjdCIsICJmaWx0ZXIiLCAiR3RrIiwgIkFzdGFsIiwgIkJveCIsICJhc3RhbGlmeSIsICJHT2JqZWN0IiwgIkJ1dHRvbiIsICJDZW50ZXJCb3giLCAiRW50cnkiLCAiTGFiZWwiLCAiTGV2ZWxCYXIiLCAiTWVudUJ1dHRvbiIsICJPdmVybGF5IiwgIlJldmVhbGVyIiwgIlNsaWRlciIsICJTdGFjayIsICJTd2l0Y2giLCAiV2luZG93IiwgImpzeCIsICJCb3giLCAiQnV0dG9uIiwgIkNlbnRlckJveCIsICJFbnRyeSIsICJMYWJlbCIsICJMZXZlbEJhciIsICJNZW51QnV0dG9uIiwgIk92ZXJsYXkiLCAiUmV2ZWFsZXIiLCAiU2xpZGVyIiwgIlN0YWNrIiwgIlN3aXRjaCIsICJXaW5kb3ciLCAiZGVmYXVsdCIsICJqc3giLCAiR3RrIiwgIm4iLCAiQXN0YWwiLCAiR2lvIiwgImpzeCIsICJHdGsiLCAibiIsICJHZGsiLCAiR2lvIiwgIkFzdGFsIiwgIkFwcHMiLCAiR0xpYiIsICJqc3giLCAiR3RrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiUElOTkVEIiwgIkFwcHMiLCAiZGVmYXVsdCIsICJuIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJOZXR3b3JrIiwgIldwIiwgIkdPYmplY3QiLCAiR3RrIiwgIlRpbnlTbGlkZXIiLCAiZGVmYXVsdCIsICJTVE9SRSIsICJqc3giLCAiR3RrIiwgIldwIiwgIk5ldHdvcmsiLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJOb3RpZmQiLCAiTm90aWZkIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiR3RrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiV3AiLCAiV3AiLCAianN4IiwgIkFzdGFsIiwgIkFDVElPTlMiLCAianN4IiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiR3RrIiwgIkd0ayIsICJpbml0IiwgIkdkayJdCn0K
