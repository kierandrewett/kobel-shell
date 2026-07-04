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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYWdzL2FwcC50cyIsICJzYXNzOi9ob21lL2tpZXJhbi9kZXYva29iZWwtc2hlbGwvYWdzL3N0eWxlL21haW4uc2NzcyIsICIuLi9hZ3MvY29uZmlnLnRzIiwgIi4uL2Fncy9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9hZ3Mvc2VydmljZXMvbm90aWZkLnRzIiwgIi4uL2Fncy9saWIvaW5zcGVjdC50cyIsICIuLi9hZ3Mvd2lkZ2V0L0Jhci50c3giLCAiLi4vYWdzL2xpYi9kZW1vLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrMy93aWRnZXQudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGszL2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrMy9qc3gtcnVudGltZS50cyIsICIuLi9hZ3Mvd2lkZ2V0L0RvY2sudHN4IiwgIi4uL2Fncy93aWRnZXQvTGF1bmNoZXIudHN4IiwgIi4uL2Fncy9saWIvZnV6enkudHMiLCAiLi4vYWdzL3dpZGdldC9DYWxlbmRhci50c3giLCAiLi4vYWdzL3dpZGdldC9RdWlja1NldHRpbmdzLnRzeCIsICIuLi9hZ3MvbGliL3RpbnlzbGlkZXIudHMiLCAiLi4vYWdzL3dpZGdldC9Ob3RpZmljYXRpb25zLnRzeCIsICIuLi9hZ3Mvd2lkZ2V0L09TRC50c3giLCAiLi4vYWdzL3dpZGdldC9TZXNzaW9uLnRzeCJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBhc3RhbGlmeSwgeyB0eXBlIENvbnN0cnVjdFByb3BzIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuXG5leHBvcnQgeyBBc3RhbCwgR3RrLCBHZGsgfVxuZXhwb3J0IHsgZGVmYXVsdCBhcyBBcHAgfSBmcm9tIFwiLi9hcHAuanNcIlxuZXhwb3J0IHsgYXN0YWxpZnksIENvbnN0cnVjdFByb3BzIH1cbmV4cG9ydCAqIGFzIFdpZGdldCBmcm9tIFwiLi93aWRnZXQuanNcIlxuZXhwb3J0IHsgaG9vayB9IGZyb20gXCIuLi9fYXN0YWxcIlxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBCaW5kaW5nLCB7IHR5cGUgQ29ubmVjdGFibGUsIHR5cGUgU3Vic2NyaWJhYmxlIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5pbXBvcnQgeyBpbnRlcnZhbCB9IGZyb20gXCIuL3RpbWUuanNcIlxuaW1wb3J0IHsgZXhlY0FzeW5jLCBzdWJwcm9jZXNzIH0gZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5cbmNsYXNzIFZhcmlhYmxlV3JhcHBlcjxUPiBleHRlbmRzIEZ1bmN0aW9uIHtcbiAgICBwcml2YXRlIHZhcmlhYmxlITogQXN0YWwuVmFyaWFibGVCYXNlXG4gICAgcHJpdmF0ZSBlcnJIYW5kbGVyPyA9IGNvbnNvbGUuZXJyb3JcblxuICAgIHByaXZhdGUgX3ZhbHVlOiBUXG4gICAgcHJpdmF0ZSBfcG9sbD86IEFzdGFsLlRpbWVcbiAgICBwcml2YXRlIF93YXRjaD86IEFzdGFsLlByb2Nlc3NcblxuICAgIHByaXZhdGUgcG9sbEludGVydmFsID0gMTAwMFxuICAgIHByaXZhdGUgcG9sbEV4ZWM/OiBzdHJpbmdbXSB8IHN0cmluZ1xuICAgIHByaXZhdGUgcG9sbFRyYW5zZm9ybT86IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVFxuICAgIHByaXZhdGUgcG9sbEZuPzogKHByZXY6IFQpID0+IFQgfCBQcm9taXNlPFQ+XG5cbiAgICBwcml2YXRlIHdhdGNoVHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgcHJpdmF0ZSB3YXRjaEV4ZWM/OiBzdHJpbmdbXSB8IHN0cmluZ1xuXG4gICAgY29uc3RydWN0b3IoaW5pdDogVCkge1xuICAgICAgICBzdXBlcigpXG4gICAgICAgIHRoaXMuX3ZhbHVlID0gaW5pdFxuICAgICAgICB0aGlzLnZhcmlhYmxlID0gbmV3IEFzdGFsLlZhcmlhYmxlQmFzZSgpXG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImRyb3BwZWRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdG9wV2F0Y2goKVxuICAgICAgICAgICAgdGhpcy5zdG9wUG9sbCgpXG4gICAgICAgIH0pXG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImVycm9yXCIsIChfLCBlcnIpID0+IHRoaXMuZXJySGFuZGxlcj8uKGVycikpXG4gICAgICAgIHJldHVybiBuZXcgUHJveHkodGhpcywge1xuICAgICAgICAgICAgYXBwbHk6ICh0YXJnZXQsIF8sIGFyZ3MpID0+IHRhcmdldC5fY2FsbChhcmdzWzBdKSxcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBwcml2YXRlIF9jYWxsPFIgPSBUPih0cmFuc2Zvcm0/OiAodmFsdWU6IFQpID0+IFIpOiBCaW5kaW5nPFI+IHtcbiAgICAgICAgY29uc3QgYiA9IEJpbmRpbmcuYmluZCh0aGlzKVxuICAgICAgICByZXR1cm4gdHJhbnNmb3JtID8gYi5hcyh0cmFuc2Zvcm0pIDogYiBhcyB1bmtub3duIGFzIEJpbmRpbmc8Uj5cbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIFN0cmluZyhgVmFyaWFibGU8JHt0aGlzLmdldCgpfT5gKVxuICAgIH1cblxuICAgIGdldCgpOiBUIHsgcmV0dXJuIHRoaXMuX3ZhbHVlIH1cbiAgICBzZXQodmFsdWU6IFQpIHtcbiAgICAgICAgaWYgKHZhbHVlICE9PSB0aGlzLl92YWx1ZSkge1xuICAgICAgICAgICAgdGhpcy5fdmFsdWUgPSB2YWx1ZVxuICAgICAgICAgICAgdGhpcy52YXJpYWJsZS5lbWl0KFwiY2hhbmdlZFwiKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc3RhcnRQb2xsKCkge1xuICAgICAgICBpZiAodGhpcy5fcG9sbClcbiAgICAgICAgICAgIHJldHVyblxuXG4gICAgICAgIGlmICh0aGlzLnBvbGxGbikge1xuICAgICAgICAgICAgdGhpcy5fcG9sbCA9IGludGVydmFsKHRoaXMucG9sbEludGVydmFsLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdiA9IHRoaXMucG9sbEZuISh0aGlzLmdldCgpKVxuICAgICAgICAgICAgICAgIGlmICh2IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgICAgICAgICAgICB2LnRoZW4odiA9PiB0aGlzLnNldCh2KSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSlcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnNldCh2KVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5wb2xsRXhlYykge1xuICAgICAgICAgICAgdGhpcy5fcG9sbCA9IGludGVydmFsKHRoaXMucG9sbEludGVydmFsLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgZXhlY0FzeW5jKHRoaXMucG9sbEV4ZWMhKVxuICAgICAgICAgICAgICAgICAgICAudGhlbih2ID0+IHRoaXMuc2V0KHRoaXMucG9sbFRyYW5zZm9ybSEodiwgdGhpcy5nZXQoKSkpKVxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVycikpXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgc3RhcnRXYXRjaCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3dhdGNoKVxuICAgICAgICAgICAgcmV0dXJuXG5cbiAgICAgICAgdGhpcy5fd2F0Y2ggPSBzdWJwcm9jZXNzKHtcbiAgICAgICAgICAgIGNtZDogdGhpcy53YXRjaEV4ZWMhLFxuICAgICAgICAgICAgb3V0OiBvdXQgPT4gdGhpcy5zZXQodGhpcy53YXRjaFRyYW5zZm9ybSEob3V0LCB0aGlzLmdldCgpKSksXG4gICAgICAgICAgICBlcnI6IGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpLFxuICAgICAgICB9KVxuICAgIH1cblxuICAgIHN0b3BQb2xsKCkge1xuICAgICAgICB0aGlzLl9wb2xsPy5jYW5jZWwoKVxuICAgICAgICBkZWxldGUgdGhpcy5fcG9sbFxuICAgIH1cblxuICAgIHN0b3BXYXRjaCgpIHtcbiAgICAgICAgdGhpcy5fd2F0Y2g/LmtpbGwoKVxuICAgICAgICBkZWxldGUgdGhpcy5fd2F0Y2hcbiAgICB9XG5cbiAgICBpc1BvbGxpbmcoKSB7IHJldHVybiAhIXRoaXMuX3BvbGwgfVxuICAgIGlzV2F0Y2hpbmcoKSB7IHJldHVybiAhIXRoaXMuX3dhdGNoIH1cblxuICAgIGRyb3AoKSB7XG4gICAgICAgIHRoaXMudmFyaWFibGUuZW1pdChcImRyb3BwZWRcIilcbiAgICB9XG5cbiAgICBvbkRyb3BwZWQoY2FsbGJhY2s6ICgpID0+IHZvaWQpIHtcbiAgICAgICAgdGhpcy52YXJpYWJsZS5jb25uZWN0KFwiZHJvcHBlZFwiLCBjYWxsYmFjaylcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIG9uRXJyb3IoY2FsbGJhY2s6IChlcnI6IHN0cmluZykgPT4gdm9pZCkge1xuICAgICAgICBkZWxldGUgdGhpcy5lcnJIYW5kbGVyXG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImVycm9yXCIsIChfLCBlcnIpID0+IGNhbGxiYWNrKGVycikpXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVCkgPT4gdm9pZCkge1xuICAgICAgICBjb25zdCBpZCA9IHRoaXMudmFyaWFibGUuY29ubmVjdChcImNoYW5nZWRcIiwgKCkgPT4ge1xuICAgICAgICAgICAgY2FsbGJhY2sodGhpcy5nZXQoKSlcbiAgICAgICAgfSlcbiAgICAgICAgcmV0dXJuICgpID0+IHRoaXMudmFyaWFibGUuZGlzY29ubmVjdChpZClcbiAgICB9XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICAgICAgdHJhbnNmb3JtPzogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGNhbGxiYWNrOiAocHJldjogVCkgPT4gVCB8IFByb21pc2U8VD5cbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgZXhlYzogc3RyaW5nIHwgc3RyaW5nW10gfCAoKHByZXY6IFQpID0+IFQgfCBQcm9taXNlPFQ+KSxcbiAgICAgICAgdHJhbnNmb3JtOiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFQgPSBvdXQgPT4gb3V0IGFzIFQsXG4gICAgKSB7XG4gICAgICAgIHRoaXMuc3RvcFBvbGwoKVxuICAgICAgICB0aGlzLnBvbGxJbnRlcnZhbCA9IGludGVydmFsXG4gICAgICAgIHRoaXMucG9sbFRyYW5zZm9ybSA9IHRyYW5zZm9ybVxuICAgICAgICBpZiAodHlwZW9mIGV4ZWMgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhpcy5wb2xsRm4gPSBleGVjXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5wb2xsRXhlY1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5wb2xsRXhlYyA9IGV4ZWNcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBvbGxGblxuICAgICAgICB9XG4gICAgICAgIHRoaXMuc3RhcnRQb2xsKClcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHdhdGNoKFxuICAgICAgICBleGVjOiBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICAgICAgdHJhbnNmb3JtOiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFQgPSBvdXQgPT4gb3V0IGFzIFQsXG4gICAgKSB7XG4gICAgICAgIHRoaXMuc3RvcFdhdGNoKClcbiAgICAgICAgdGhpcy53YXRjaEV4ZWMgPSBleGVjXG4gICAgICAgIHRoaXMud2F0Y2hUcmFuc2Zvcm0gPSB0cmFuc2Zvcm1cbiAgICAgICAgdGhpcy5zdGFydFdhdGNoKClcbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9ianM6IEFycmF5PFtvYmo6IENvbm5lY3RhYmxlLCBzaWduYWw6IHN0cmluZ10+LFxuICAgICAgICBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmo6IENvbm5lY3RhYmxlLFxuICAgICAgICBzaWduYWw6IHN0cmluZyxcbiAgICAgICAgY2FsbGJhY2s6ICguLi5hcmdzOiBhbnlbXSkgPT4gVCxcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqczogQ29ubmVjdGFibGUgfCBBcnJheTxbb2JqOiBDb25uZWN0YWJsZSwgc2lnbmFsOiBzdHJpbmddPixcbiAgICAgICAgc2lnT3JGbjogc3RyaW5nIHwgKChvYmo6IENvbm5lY3RhYmxlLCAuLi5hcmdzOiBhbnlbXSkgPT4gVCksXG4gICAgICAgIGNhbGxiYWNrPzogKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiBULFxuICAgICkge1xuICAgICAgICBjb25zdCBmID0gdHlwZW9mIHNpZ09yRm4gPT09IFwiZnVuY3Rpb25cIiA/IHNpZ09yRm4gOiBjYWxsYmFjayA/PyAoKCkgPT4gdGhpcy5nZXQoKSlcbiAgICAgICAgY29uc3Qgc2V0ID0gKG9iajogQ29ubmVjdGFibGUsIC4uLmFyZ3M6IGFueVtdKSA9PiB0aGlzLnNldChmKG9iaiwgLi4uYXJncykpXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob2JqcykpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qgb2JqIG9mIG9ianMpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBbbywgc10gPSBvYmpcbiAgICAgICAgICAgICAgICBjb25zdCBpZCA9IG8uY29ubmVjdChzLCBzZXQpXG4gICAgICAgICAgICAgICAgdGhpcy5vbkRyb3BwZWQoKCkgPT4gby5kaXNjb25uZWN0KGlkKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2Ygc2lnT3JGbiA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgICAgIGNvbnN0IGlkID0gb2Jqcy5jb25uZWN0KHNpZ09yRm4sIHNldClcbiAgICAgICAgICAgICAgICB0aGlzLm9uRHJvcHBlZCgoKSA9PiBvYmpzLmRpc2Nvbm5lY3QoaWQpKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMgYXMgdW5rbm93biBhcyBWYXJpYWJsZTxUPlxuICAgIH1cblxuICAgIHN0YXRpYyBkZXJpdmU8XG4gICAgICAgIGNvbnN0IERlcHMgZXh0ZW5kcyBBcnJheTxTdWJzY3JpYmFibGU8YW55Pj4sXG4gICAgICAgIEFyZ3MgZXh0ZW5kcyB7XG4gICAgICAgICAgICBbSyBpbiBrZXlvZiBEZXBzXTogRGVwc1tLXSBleHRlbmRzIFN1YnNjcmliYWJsZTxpbmZlciBUPiA/IFQgOiBuZXZlclxuICAgICAgICB9LFxuICAgICAgICBWID0gQXJncyxcbiAgICA+KGRlcHM6IERlcHMsIGZuOiAoLi4uYXJnczogQXJncykgPT4gViA9ICguLi5hcmdzKSA9PiBhcmdzIGFzIHVua25vd24gYXMgVikge1xuICAgICAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiBmbiguLi5kZXBzLm1hcChkID0+IGQuZ2V0KCkpIGFzIEFyZ3MpXG4gICAgICAgIGNvbnN0IGRlcml2ZWQgPSBuZXcgVmFyaWFibGUodXBkYXRlKCkpXG4gICAgICAgIGNvbnN0IHVuc3VicyA9IGRlcHMubWFwKGRlcCA9PiBkZXAuc3Vic2NyaWJlKCgpID0+IGRlcml2ZWQuc2V0KHVwZGF0ZSgpKSkpXG4gICAgICAgIGRlcml2ZWQub25Ecm9wcGVkKCgpID0+IHVuc3Vicy5tYXAodW5zdWIgPT4gdW5zdWIoKSkpXG4gICAgICAgIHJldHVybiBkZXJpdmVkXG4gICAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFZhcmlhYmxlPFQ+IGV4dGVuZHMgT21pdDxWYXJpYWJsZVdyYXBwZXI8VD4sIFwiYmluZFwiPiB7XG4gICAgPFI+KHRyYW5zZm9ybTogKHZhbHVlOiBUKSA9PiBSKTogQmluZGluZzxSPlxuICAgICgpOiBCaW5kaW5nPFQ+XG59XG5cbmV4cG9ydCBjb25zdCBWYXJpYWJsZSA9IG5ldyBQcm94eShWYXJpYWJsZVdyYXBwZXIgYXMgYW55LCB7XG4gICAgYXBwbHk6IChfdCwgX2EsIGFyZ3MpID0+IG5ldyBWYXJpYWJsZVdyYXBwZXIoYXJnc1swXSksXG59KSBhcyB7XG4gICAgZGVyaXZlOiB0eXBlb2YgVmFyaWFibGVXcmFwcGVyW1wiZGVyaXZlXCJdXG4gICAgPFQ+KGluaXQ6IFQpOiBWYXJpYWJsZTxUPlxuICAgIG5ldzxUPihpbml0OiBUKTogVmFyaWFibGU8VD5cbn1cblxuZXhwb3J0IGNvbnN0IHsgZGVyaXZlIH0gPSBWYXJpYWJsZVxuZXhwb3J0IGRlZmF1bHQgVmFyaWFibGVcbiIsICJleHBvcnQgY29uc3Qgc25ha2VpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxXyQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbmV4cG9ydCBjb25zdCBrZWJhYmlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDEtJDJcIilcbiAgICAucmVwbGFjZUFsbChcIl9cIiwgXCItXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxuZXhwb3J0IGludGVyZmFjZSBTdWJzY3JpYmFibGU8VCA9IHVua25vd24+IHtcbiAgICBzdWJzY3JpYmUoY2FsbGJhY2s6ICh2YWx1ZTogVCkgPT4gdm9pZCk6ICgpID0+IHZvaWRcbiAgICBnZXQoKTogVFxuICAgIFtrZXk6IHN0cmluZ106IGFueVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbm5lY3RhYmxlIHtcbiAgICBjb25uZWN0KHNpZ25hbDogc3RyaW5nLCBjYWxsYmFjazogKC4uLmFyZ3M6IGFueVtdKSA9PiB1bmtub3duKTogbnVtYmVyXG4gICAgZGlzY29ubmVjdChpZDogbnVtYmVyKTogdm9pZFxuICAgIFtrZXk6IHN0cmluZ106IGFueVxufVxuXG5leHBvcnQgY2xhc3MgQmluZGluZzxWYWx1ZT4ge1xuICAgIHByaXZhdGUgdHJhbnNmb3JtRm4gPSAodjogYW55KSA9PiB2XG5cbiAgICAjZW1pdHRlcjogU3Vic2NyaWJhYmxlPFZhbHVlPiB8IENvbm5lY3RhYmxlXG4gICAgI3Byb3A/OiBzdHJpbmdcblxuICAgIHN0YXRpYyBiaW5kPFxuICAgICAgICBUIGV4dGVuZHMgQ29ubmVjdGFibGUsXG4gICAgICAgIFAgZXh0ZW5kcyBrZXlvZiBULFxuICAgID4ob2JqZWN0OiBULCBwcm9wZXJ0eTogUCk6IEJpbmRpbmc8VFtQXT5cblxuICAgIHN0YXRpYyBiaW5kPFQ+KG9iamVjdDogU3Vic2NyaWJhYmxlPFQ+KTogQmluZGluZzxUPlxuXG4gICAgc3RhdGljIGJpbmQoZW1pdHRlcjogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGUsIHByb3A/OiBzdHJpbmcpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBCaW5kaW5nKGVtaXR0ZXIsIHByb3ApXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBjb25zdHJ1Y3RvcihlbWl0dGVyOiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZTxWYWx1ZT4sIHByb3A/OiBzdHJpbmcpIHtcbiAgICAgICAgdGhpcy4jZW1pdHRlciA9IGVtaXR0ZXJcbiAgICAgICAgdGhpcy4jcHJvcCA9IHByb3AgJiYga2ViYWJpZnkocHJvcClcbiAgICB9XG5cbiAgICB0b1N0cmluZygpIHtcbiAgICAgICAgcmV0dXJuIGBCaW5kaW5nPCR7dGhpcy4jZW1pdHRlcn0ke3RoaXMuI3Byb3AgPyBgLCBcIiR7dGhpcy4jcHJvcH1cImAgOiBcIlwifT5gXG4gICAgfVxuXG4gICAgYXM8VD4oZm46ICh2OiBWYWx1ZSkgPT4gVCk6IEJpbmRpbmc8VD4ge1xuICAgICAgICBjb25zdCBiaW5kID0gbmV3IEJpbmRpbmcodGhpcy4jZW1pdHRlciwgdGhpcy4jcHJvcClcbiAgICAgICAgYmluZC50cmFuc2Zvcm1GbiA9ICh2OiBWYWx1ZSkgPT4gZm4odGhpcy50cmFuc2Zvcm1Gbih2KSlcbiAgICAgICAgcmV0dXJuIGJpbmQgYXMgdW5rbm93biBhcyBCaW5kaW5nPFQ+XG4gICAgfVxuXG4gICAgZ2V0KCk6IFZhbHVlIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyLmdldCA9PT0gXCJmdW5jdGlvblwiKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlci5nZXQoKSlcblxuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI3Byb3AgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGdldHRlciA9IGBnZXRfJHtzbmFrZWlmeSh0aGlzLiNwcm9wKX1gXG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXJbZ2V0dGVyXSA9PT0gXCJmdW5jdGlvblwiKVxuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXJbZ2V0dGVyXSgpKVxuXG4gICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyW3RoaXMuI3Byb3BdKVxuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgRXJyb3IoXCJjYW4gbm90IGdldCB2YWx1ZSBvZiBiaW5kaW5nXCIpXG4gICAgfVxuXG4gICAgc3Vic2NyaWJlKGNhbGxiYWNrOiAodmFsdWU6IFZhbHVlKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlci5zdWJzY3JpYmUgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuI2VtaXR0ZXIuc3Vic2NyaWJlKCgpID0+IHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlci5jb25uZWN0ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IHNpZ25hbCA9IGBub3RpZnk6OiR7dGhpcy4jcHJvcH1gXG4gICAgICAgICAgICBjb25zdCBpZCA9IHRoaXMuI2VtaXR0ZXIuY29ubmVjdChzaWduYWwsICgpID0+IHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayh0aGlzLmdldCgpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgKHRoaXMuI2VtaXR0ZXIuZGlzY29ubmVjdCBhcyBDb25uZWN0YWJsZVtcImRpc2Nvbm5lY3RcIl0pKGlkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRocm93IEVycm9yKGAke3RoaXMuI2VtaXR0ZXJ9IGlzIG5vdCBiaW5kYWJsZWApXG4gICAgfVxufVxuXG5leHBvcnQgY29uc3QgeyBiaW5kIH0gPSBCaW5kaW5nXG5leHBvcnQgZGVmYXVsdCBCaW5kaW5nXG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuXG5leHBvcnQgdHlwZSBUaW1lID0gQXN0YWwuVGltZVxuZXhwb3J0IGNvbnN0IFRpbWUgPSBBc3RhbC5UaW1lXG5cbmV4cG9ydCBmdW5jdGlvbiBpbnRlcnZhbChpbnRlcnZhbDogbnVtYmVyLCBjYWxsYmFjaz86ICgpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gQXN0YWwuVGltZS5pbnRlcnZhbChpbnRlcnZhbCwgKCkgPT4gdm9pZCBjYWxsYmFjaz8uKCkpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0KHRpbWVvdXQ6IG51bWJlciwgY2FsbGJhY2s/OiAoKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIEFzdGFsLlRpbWUudGltZW91dCh0aW1lb3V0LCAoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlkbGUoY2FsbGJhY2s/OiAoKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIEFzdGFsLlRpbWUuaWRsZSgoKSA9PiB2b2lkIGNhbGxiYWNrPy4oKSlcbn1cbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5cbnR5cGUgQXJncyA9IHtcbiAgICBjbWQ6IHN0cmluZyB8IHN0cmluZ1tdXG4gICAgb3V0PzogKHN0ZG91dDogc3RyaW5nKSA9PiB2b2lkXG4gICAgZXJyPzogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkXG59XG5cbmV4cG9ydCB0eXBlIFByb2Nlc3MgPSBBc3RhbC5Qcm9jZXNzXG5leHBvcnQgY29uc3QgUHJvY2VzcyA9IEFzdGFsLlByb2Nlc3NcblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnByb2Nlc3MoYXJnczogQXJncyk6IEFzdGFsLlByb2Nlc3NcblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnByb2Nlc3MoXG4gICAgY21kOiBzdHJpbmcgfCBzdHJpbmdbXSxcbiAgICBvbk91dD86IChzdGRvdXQ6IHN0cmluZykgPT4gdm9pZCxcbiAgICBvbkVycj86IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZCxcbik6IEFzdGFsLlByb2Nlc3NcblxuZXhwb3J0IGZ1bmN0aW9uIHN1YnByb2Nlc3MoXG4gICAgYXJnc09yQ21kOiBBcmdzIHwgc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgb25PdXQ6IChzdGRvdXQ6IHN0cmluZykgPT4gdm9pZCA9IHByaW50LFxuICAgIG9uRXJyOiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWQgPSBwcmludGVycixcbikge1xuICAgIGNvbnN0IGFyZ3MgPSBBcnJheS5pc0FycmF5KGFyZ3NPckNtZCkgfHwgdHlwZW9mIGFyZ3NPckNtZCA9PT0gXCJzdHJpbmdcIlxuICAgIGNvbnN0IHsgY21kLCBlcnIsIG91dCB9ID0ge1xuICAgICAgICBjbWQ6IGFyZ3MgPyBhcmdzT3JDbWQgOiBhcmdzT3JDbWQuY21kLFxuICAgICAgICBlcnI6IGFyZ3MgPyBvbkVyciA6IGFyZ3NPckNtZC5lcnIgfHwgb25FcnIsXG4gICAgICAgIG91dDogYXJncyA/IG9uT3V0IDogYXJnc09yQ21kLm91dCB8fCBvbk91dCxcbiAgICB9XG5cbiAgICBjb25zdCBwcm9jID0gQXJyYXkuaXNBcnJheShjbWQpXG4gICAgICAgID8gQXN0YWwuUHJvY2Vzcy5zdWJwcm9jZXNzdihjbWQpXG4gICAgICAgIDogQXN0YWwuUHJvY2Vzcy5zdWJwcm9jZXNzKGNtZClcblxuICAgIHByb2MuY29ubmVjdChcInN0ZG91dFwiLCAoXywgc3Rkb3V0OiBzdHJpbmcpID0+IG91dChzdGRvdXQpKVxuICAgIHByb2MuY29ubmVjdChcInN0ZGVyclwiLCAoXywgc3RkZXJyOiBzdHJpbmcpID0+IGVycihzdGRlcnIpKVxuICAgIHJldHVybiBwcm9jXG59XG5cbi8qKiBAdGhyb3dzIHtHTGliLkVycm9yfSBUaHJvd3Mgc3RkZXJyICovXG5leHBvcnQgZnVuY3Rpb24gZXhlYyhjbWQ6IHN0cmluZyB8IHN0cmluZ1tdKSB7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkoY21kKVxuICAgICAgICA/IEFzdGFsLlByb2Nlc3MuZXhlY3YoY21kKVxuICAgICAgICA6IEFzdGFsLlByb2Nlc3MuZXhlYyhjbWQpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBleGVjQXN5bmMoY21kOiBzdHJpbmcgfCBzdHJpbmdbXSk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY21kKSkge1xuICAgICAgICAgICAgQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jdihjbWQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLlByb2Nlc3MuZXhlY19hc3luY3ZfZmluaXNoKHJlcykpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmMoY21kLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5Qcm9jZXNzLmV4ZWNfZmluaXNoKHJlcykpXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9KVxufVxuIiwgImltcG9ydCBWYXJpYWJsZSBmcm9tIFwiLi92YXJpYWJsZS5qc1wiXG5pbXBvcnQgeyBleGVjQXN5bmMgfSBmcm9tIFwiLi9wcm9jZXNzLmpzXCJcbmltcG9ydCBCaW5kaW5nLCB7IENvbm5lY3RhYmxlLCBrZWJhYmlmeSwgc25ha2VpZnksIFN1YnNjcmliYWJsZSB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuXG5leHBvcnQgY29uc3Qgbm9JbXBsaWNpdERlc3Ryb3kgPSBTeW1ib2woXCJubyBubyBpbXBsaWNpdCBkZXN0cm95XCIpXG5leHBvcnQgY29uc3Qgc2V0Q2hpbGRyZW4gPSBTeW1ib2woXCJjaGlsZHJlbiBzZXR0ZXIgbWV0aG9kXCIpXG5cbmV4cG9ydCBmdW5jdGlvbiBtZXJnZUJpbmRpbmdzKGFycmF5OiBhbnlbXSkge1xuICAgIGZ1bmN0aW9uIGdldFZhbHVlcyguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICBsZXQgaSA9IDBcbiAgICAgICAgcmV0dXJuIGFycmF5Lm1hcCh2YWx1ZSA9PiB2YWx1ZSBpbnN0YW5jZW9mIEJpbmRpbmdcbiAgICAgICAgICAgID8gYXJnc1tpKytdXG4gICAgICAgICAgICA6IHZhbHVlLFxuICAgICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgYmluZGluZ3MgPSBhcnJheS5maWx0ZXIoaSA9PiBpIGluc3RhbmNlb2YgQmluZGluZylcblxuICAgIGlmIChiaW5kaW5ncy5sZW5ndGggPT09IDApXG4gICAgICAgIHJldHVybiBhcnJheVxuXG4gICAgaWYgKGJpbmRpbmdzLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgcmV0dXJuIGJpbmRpbmdzWzBdLmFzKGdldFZhbHVlcylcblxuICAgIHJldHVybiBWYXJpYWJsZS5kZXJpdmUoYmluZGluZ3MsIGdldFZhbHVlcykoKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0UHJvcChvYmo6IGFueSwgcHJvcDogc3RyaW5nLCB2YWx1ZTogYW55KSB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc2V0dGVyID0gYHNldF8ke3NuYWtlaWZ5KHByb3ApfWBcbiAgICAgICAgaWYgKHR5cGVvZiBvYmpbc2V0dGVyXSA9PT0gXCJmdW5jdGlvblwiKVxuICAgICAgICAgICAgcmV0dXJuIG9ialtzZXR0ZXJdKHZhbHVlKVxuXG4gICAgICAgIHJldHVybiAob2JqW3Byb3BdID0gdmFsdWUpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgY291bGQgbm90IHNldCBwcm9wZXJ0eSBcIiR7cHJvcH1cIiBvbiAke29ian06YCwgZXJyb3IpXG4gICAgfVxufVxuXG5leHBvcnQgdHlwZSBCaW5kYWJsZVByb3BzPFQ+ID0ge1xuICAgIFtLIGluIGtleW9mIFRdOiBCaW5kaW5nPFRbS10+IHwgVFtLXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGhvb2s8V2lkZ2V0IGV4dGVuZHMgQ29ubmVjdGFibGU+KFxuICAgIHdpZGdldDogV2lkZ2V0LFxuICAgIG9iamVjdDogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGUsXG4gICAgc2lnbmFsT3JDYWxsYmFjazogc3RyaW5nIHwgKChzZWxmOiBXaWRnZXQsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkKSxcbiAgICBjYWxsYmFjaz86IChzZWxmOiBXaWRnZXQsIC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuKSB7XG4gICAgaWYgKHR5cGVvZiBvYmplY3QuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiICYmIGNhbGxiYWNrKSB7XG4gICAgICAgIGNvbnN0IGlkID0gb2JqZWN0LmNvbm5lY3Qoc2lnbmFsT3JDYWxsYmFjaywgKF86IGFueSwgLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2sod2lkZ2V0LCAuLi5hcmdzKVxuICAgICAgICB9KVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgKCkgPT4ge1xuICAgICAgICAgICAgKG9iamVjdC5kaXNjb25uZWN0IGFzIENvbm5lY3RhYmxlW1wiZGlzY29ubmVjdFwiXSkoaWQpXG4gICAgICAgIH0pXG4gICAgfSBlbHNlIGlmICh0eXBlb2Ygb2JqZWN0LnN1YnNjcmliZSA9PT0gXCJmdW5jdGlvblwiICYmIHR5cGVvZiBzaWduYWxPckNhbGxiYWNrID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgY29uc3QgdW5zdWIgPSBvYmplY3Quc3Vic2NyaWJlKCguLi5hcmdzOiB1bmtub3duW10pID0+IHtcbiAgICAgICAgICAgIHNpZ25hbE9yQ2FsbGJhY2sod2lkZ2V0LCAuLi5hcmdzKVxuICAgICAgICB9KVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgdW5zdWIpXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29uc3RydWN0PFdpZGdldCBleHRlbmRzIENvbm5lY3RhYmxlICYgeyBbc2V0Q2hpbGRyZW5dOiAoY2hpbGRyZW46IGFueVtdKSA9PiB2b2lkIH0+KHdpZGdldDogV2lkZ2V0LCBjb25maWc6IGFueSkge1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBwcmVmZXItY29uc3RcbiAgICBsZXQgeyBzZXR1cCwgY2hpbGQsIGNoaWxkcmVuID0gW10sIC4uLnByb3BzIH0gPSBjb25maWdcblxuICAgIGlmIChjaGlsZHJlbiBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgY2hpbGRyZW4gPSBbY2hpbGRyZW5dXG4gICAgfVxuXG4gICAgaWYgKGNoaWxkKSB7XG4gICAgICAgIGNoaWxkcmVuLnVuc2hpZnQoY2hpbGQpXG4gICAgfVxuXG4gICAgLy8gcmVtb3ZlIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1trZXldXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjb2xsZWN0IGJpbmRpbmdzXG4gICAgY29uc3QgYmluZGluZ3M6IEFycmF5PFtzdHJpbmcsIEJpbmRpbmc8YW55Pl0+ID0gT2JqZWN0XG4gICAgICAgIC5rZXlzKHByb3BzKVxuICAgICAgICAucmVkdWNlKChhY2M6IGFueSwgcHJvcCkgPT4ge1xuICAgICAgICAgICAgaWYgKHByb3BzW3Byb3BdIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGJpbmRpbmcgPSBwcm9wc1twcm9wXVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1twcm9wXVxuICAgICAgICAgICAgICAgIHJldHVybiBbLi4uYWNjLCBbcHJvcCwgYmluZGluZ11dXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjXG4gICAgICAgIH0sIFtdKVxuXG4gICAgLy8gY29sbGVjdCBzaWduYWwgaGFuZGxlcnNcbiAgICBjb25zdCBvbkhhbmRsZXJzOiBBcnJheTxbc3RyaW5nLCBzdHJpbmcgfCAoKCkgPT4gdW5rbm93bildPiA9IE9iamVjdFxuICAgICAgICAua2V5cyhwcm9wcylcbiAgICAgICAgLnJlZHVjZSgoYWNjOiBhbnksIGtleSkgPT4ge1xuICAgICAgICAgICAgaWYgKGtleS5zdGFydHNXaXRoKFwib25cIikpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzaWcgPSBrZWJhYmlmeShrZXkpLnNwbGl0KFwiLVwiKS5zbGljZSgxKS5qb2luKFwiLVwiKVxuICAgICAgICAgICAgICAgIGNvbnN0IGhhbmRsZXIgPSBwcm9wc1trZXldXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgICAgICAgICByZXR1cm4gWy4uLmFjYywgW3NpZywgaGFuZGxlcl1dXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjXG4gICAgICAgIH0sIFtdKVxuXG4gICAgLy8gc2V0IGNoaWxkcmVuXG4gICAgY29uc3QgbWVyZ2VkQ2hpbGRyZW4gPSBtZXJnZUJpbmRpbmdzKGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpKVxuICAgIGlmIChtZXJnZWRDaGlsZHJlbiBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXShtZXJnZWRDaGlsZHJlbi5nZXQoKSlcbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIG1lcmdlZENoaWxkcmVuLnN1YnNjcmliZSgodikgPT4ge1xuICAgICAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXSh2KVxuICAgICAgICB9KSlcbiAgICB9IGVsc2Uge1xuICAgICAgICBpZiAobWVyZ2VkQ2hpbGRyZW4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXShtZXJnZWRDaGlsZHJlbilcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNldHVwIHNpZ25hbCBoYW5kbGVyc1xuICAgIGZvciAoY29uc3QgW3NpZ25hbCwgY2FsbGJhY2tdIG9mIG9uSGFuZGxlcnMpIHtcbiAgICAgICAgY29uc3Qgc2lnID0gc2lnbmFsLnN0YXJ0c1dpdGgoXCJub3RpZnlcIilcbiAgICAgICAgICAgID8gc2lnbmFsLnJlcGxhY2UoXCItXCIsIFwiOjpcIilcbiAgICAgICAgICAgIDogc2lnbmFsXG5cbiAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICB3aWRnZXQuY29ubmVjdChzaWcsIGNhbGxiYWNrKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgd2lkZ2V0LmNvbm5lY3Qoc2lnLCAoKSA9PiBleGVjQXN5bmMoY2FsbGJhY2spXG4gICAgICAgICAgICAgICAgLnRoZW4ocHJpbnQpLmNhdGNoKGNvbnNvbGUuZXJyb3IpKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gc2V0dXAgYmluZGluZ3MgaGFuZGxlcnNcbiAgICBmb3IgKGNvbnN0IFtwcm9wLCBiaW5kaW5nXSBvZiBiaW5kaW5ncykge1xuICAgICAgICBpZiAocHJvcCA9PT0gXCJjaGlsZFwiIHx8IHByb3AgPT09IFwiY2hpbGRyZW5cIikge1xuICAgICAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIGJpbmRpbmcuc3Vic2NyaWJlKCh2OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgICB3aWRnZXRbc2V0Q2hpbGRyZW5dKHYpXG4gICAgICAgICAgICB9KSlcbiAgICAgICAgfVxuICAgICAgICB3aWRnZXQuY29ubmVjdChcImRlc3Ryb3lcIiwgYmluZGluZy5zdWJzY3JpYmUoKHY6IGFueSkgPT4ge1xuICAgICAgICAgICAgc2V0UHJvcCh3aWRnZXQsIHByb3AsIHYpXG4gICAgICAgIH0pKVxuICAgICAgICBzZXRQcm9wKHdpZGdldCwgcHJvcCwgYmluZGluZy5nZXQoKSlcbiAgICB9XG5cbiAgICAvLyBmaWx0ZXIgdW5kZWZpbmVkIHZhbHVlc1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHByb3BzKSkge1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZGVsZXRlIHByb3BzW2tleV1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCBwcm9wcylcbiAgICBzZXR1cD8uKHdpZGdldClcbiAgICByZXR1cm4gd2lkZ2V0XG59XG5cbmZ1bmN0aW9uIGlzQXJyb3dGdW5jdGlvbihmdW5jOiBhbnkpOiBmdW5jIGlzIChhcmdzOiBhbnkpID0+IGFueSB7XG4gICAgcmV0dXJuICFPYmplY3QuaGFzT3duKGZ1bmMsIFwicHJvdG90eXBlXCIpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBqc3goXG4gICAgY3RvcnM6IFJlY29yZDxzdHJpbmcsIHsgbmV3KHByb3BzOiBhbnkpOiBhbnkgfSB8ICgocHJvcHM6IGFueSkgPT4gYW55KT4sXG4gICAgY3Rvcjogc3RyaW5nIHwgKChwcm9wczogYW55KSA9PiBhbnkpIHwgeyBuZXcocHJvcHM6IGFueSk6IGFueSB9LFxuICAgIHsgY2hpbGRyZW4sIC4uLnByb3BzIH06IGFueSxcbikge1xuICAgIGNoaWxkcmVuID8/PSBbXVxuXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGNoaWxkcmVuKSlcbiAgICAgICAgY2hpbGRyZW4gPSBbY2hpbGRyZW5dXG5cbiAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZpbHRlcihCb29sZWFuKVxuXG4gICAgaWYgKGNoaWxkcmVuLmxlbmd0aCA9PT0gMSlcbiAgICAgICAgcHJvcHMuY2hpbGQgPSBjaGlsZHJlblswXVxuICAgIGVsc2UgaWYgKGNoaWxkcmVuLmxlbmd0aCA+IDEpXG4gICAgICAgIHByb3BzLmNoaWxkcmVuID0gY2hpbGRyZW5cblxuICAgIGlmICh0eXBlb2YgY3RvciA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICBpZiAoaXNBcnJvd0Z1bmN0aW9uKGN0b3JzW2N0b3JdKSlcbiAgICAgICAgICAgIHJldHVybiBjdG9yc1tjdG9yXShwcm9wcylcblxuICAgICAgICByZXR1cm4gbmV3IGN0b3JzW2N0b3JdKHByb3BzKVxuICAgIH1cblxuICAgIGlmIChpc0Fycm93RnVuY3Rpb24oY3RvcikpXG4gICAgICAgIHJldHVybiBjdG9yKHByb3BzKVxuXG4gICAgcmV0dXJuIG5ldyBjdG9yKHByb3BzKVxufVxuIiwgImltcG9ydCB7IG5vSW1wbGljaXREZXN0cm95LCBzZXRDaGlsZHJlbiwgdHlwZSBCaW5kYWJsZVByb3BzLCBjb25zdHJ1Y3QgfSBmcm9tIFwiLi4vX2FzdGFsLmpzXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBCaW5kaW5nIGZyb20gXCIuLi9iaW5kaW5nLmpzXCJcblxuZXhwb3J0IGNvbnN0IHR5cGUgPSBTeW1ib2woXCJjaGlsZCB0eXBlXCIpXG5jb25zdCBkdW1teUJ1bGRlciA9IG5ldyBHdGsuQnVpbGRlclxuXG5mdW5jdGlvbiBfZ2V0Q2hpbGRyZW4od2lkZ2V0OiBHdGsuV2lkZ2V0KTogQXJyYXk8R3RrLldpZGdldD4ge1xuICAgIGlmIChcImdldF9jaGlsZFwiIGluIHdpZGdldCAmJiB0eXBlb2Ygd2lkZ2V0LmdldF9jaGlsZCA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIHdpZGdldC5nZXRfY2hpbGQoKSA/IFt3aWRnZXQuZ2V0X2NoaWxkKCldIDogW11cbiAgICB9XG5cbiAgICBjb25zdCBjaGlsZHJlbjogQXJyYXk8R3RrLldpZGdldD4gPSBbXVxuICAgIGxldCBjaCA9IHdpZGdldC5nZXRfZmlyc3RfY2hpbGQoKVxuICAgIHdoaWxlIChjaCAhPT0gbnVsbCkge1xuICAgICAgICBjaGlsZHJlbi5wdXNoKGNoKVxuICAgICAgICBjaCA9IGNoLmdldF9uZXh0X3NpYmxpbmcoKVxuICAgIH1cbiAgICByZXR1cm4gY2hpbGRyZW5cbn1cblxuZnVuY3Rpb24gX3NldENoaWxkcmVuKHdpZGdldDogR3RrLldpZGdldCwgY2hpbGRyZW46IGFueVtdKSB7XG4gICAgY2hpbGRyZW4gPSBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG5cblxuICAgIGZvciAoY29uc3QgY2hpbGQgb2YgY2hpbGRyZW4pIHtcbiAgICAgICAgd2lkZ2V0LnZmdW5jX2FkZF9jaGlsZChcbiAgICAgICAgICAgIGR1bW15QnVsZGVyLFxuICAgICAgICAgICAgY2hpbGQsXG4gICAgICAgICAgICB0eXBlIGluIGNoaWxkID8gY2hpbGRbdHlwZV0gOiBudWxsLFxuICAgICAgICApXG4gICAgfVxufVxuXG50eXBlIENvbmZpZzxUIGV4dGVuZHMgR3RrLldpZGdldD4gPSB7XG4gICAgc2V0Q2hpbGRyZW4od2lkZ2V0OiBULCBjaGlsZHJlbjogYW55W10pOiB2b2lkXG4gICAgZ2V0Q2hpbGRyZW4od2lkZ2V0OiBUKTogQXJyYXk8R3RrLldpZGdldD5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYXN0YWxpZnk8XG4gICAgV2lkZ2V0IGV4dGVuZHMgR3RrLldpZGdldCxcbiAgICBQcm9wcyBleHRlbmRzIEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyA9IEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyxcbiAgICBTaWduYWxzIGV4dGVuZHMgUmVjb3JkPGBvbiR7c3RyaW5nfWAsIEFycmF5PHVua25vd24+PiA9IFJlY29yZDxgb24ke3N0cmluZ31gLCBhbnlbXT4sXG4+KGNsczogeyBuZXcoLi4uYXJnczogYW55W10pOiBXaWRnZXQgfSwgY29uZmlnOiBQYXJ0aWFsPENvbmZpZzxXaWRnZXQ+PiA9IHt9KSB7XG4gICAgT2JqZWN0LmFzc2lnbihjbHMucHJvdG90eXBlLCB7XG4gICAgICAgIFtzZXRDaGlsZHJlbl0oY2hpbGRyZW46IGFueVtdKSB7XG4gICAgICAgICAgICBjb25zdCB3ID0gdGhpcyBhcyB1bmtub3duIGFzIFdpZGdldFxuICAgICAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiAoY29uZmlnLmdldENoaWxkcmVuPy4odykgfHwgX2dldENoaWxkcmVuKHcpKSkge1xuICAgICAgICAgICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEd0ay5XaWRnZXQpIHtcbiAgICAgICAgICAgICAgICAgICAgY2hpbGQudW5wYXJlbnQoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoIWNoaWxkcmVuLmluY2x1ZGVzKGNoaWxkKSAmJiBub0ltcGxpY2l0RGVzdHJveSBpbiB0aGlzKVxuICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGQucnVuX2Rpc3Bvc2UoKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNvbmZpZy5zZXRDaGlsZHJlbikge1xuICAgICAgICAgICAgICAgIGNvbmZpZy5zZXRDaGlsZHJlbih3LCBjaGlsZHJlbilcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgX3NldENoaWxkcmVuKHcsIGNoaWxkcmVuKVxuICAgICAgICAgICAgfVxuICAgICAgICB9LFxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgICBbY2xzLm5hbWVdOiAoXG4gICAgICAgICAgICBwcm9wczogQ29uc3RydWN0UHJvcHM8V2lkZ2V0LCBQcm9wcywgU2lnbmFscz4gPSB7fSxcbiAgICAgICAgICAgIC4uLmNoaWxkcmVuOiBhbnlbXVxuICAgICAgICApOiBXaWRnZXQgPT4ge1xuICAgICAgICAgICAgY29uc3Qgd2lkZ2V0ID0gbmV3IGNscyhcImNzc05hbWVcIiBpbiBwcm9wcyA/IHsgY3NzTmFtZTogcHJvcHMuY3NzTmFtZSB9IDoge30pXG5cbiAgICAgICAgICAgIGlmIChcImNzc05hbWVcIiBpbiBwcm9wcykge1xuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wcy5jc3NOYW1lXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChwcm9wcy5ub0ltcGxpY2l0RGVzdHJveSkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24od2lkZ2V0LCB7IFtub0ltcGxpY2l0RGVzdHJveV06IHRydWUgfSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMubm9JbXBsaWNpdERlc3Ryb3lcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKHByb3BzLnR5cGUpIHtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHdpZGdldCwgeyBbdHlwZV06IHByb3BzLnR5cGUgfSlcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMudHlwZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY2hpbGRyZW4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIE9iamVjdC5hc3NpZ24ocHJvcHMsIHsgY2hpbGRyZW4gfSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGNvbnN0cnVjdCh3aWRnZXQgYXMgYW55LCBzZXR1cENvbnRyb2xsZXJzKHdpZGdldCwgcHJvcHMgYXMgYW55KSlcbiAgICAgICAgfSxcbiAgICB9W2Nscy5uYW1lXVxufVxuXG50eXBlIFNpZ0hhbmRsZXI8XG4gICAgVyBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgQXJncyBleHRlbmRzIEFycmF5PHVua25vd24+LFxuPiA9ICgoc2VsZjogVywgLi4uYXJnczogQXJncykgPT4gdW5rbm93bikgfCBzdHJpbmcgfCBzdHJpbmdbXVxuXG5leHBvcnQgeyBCaW5kYWJsZVByb3BzIH1cbmV4cG9ydCB0eXBlIEJpbmRhYmxlQ2hpbGQgPSBHdGsuV2lkZ2V0IHwgQmluZGluZzxHdGsuV2lkZ2V0PlxuXG5leHBvcnQgdHlwZSBDb25zdHJ1Y3RQcm9wczxcbiAgICBTZWxmIGV4dGVuZHMgSW5zdGFuY2VUeXBlPHR5cGVvZiBHdGsuV2lkZ2V0PixcbiAgICBQcm9wcyBleHRlbmRzIEd0ay5XaWRnZXQuQ29uc3RydWN0b3JQcm9wcyxcbiAgICBTaWduYWxzIGV4dGVuZHMgUmVjb3JkPGBvbiR7c3RyaW5nfWAsIEFycmF5PHVua25vd24+PiA9IFJlY29yZDxgb24ke3N0cmluZ31gLCBhbnlbXT4sXG4+ID0gUGFydGlhbDx7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjYW4ndCBhc3NpZ24gdG8gdW5rbm93biwgYnV0IGl0IHdvcmtzIGFzIGV4cGVjdGVkIHRob3VnaFxuICAgIFtTIGluIGtleW9mIFNpZ25hbHNdOiBTaWdIYW5kbGVyPFNlbGYsIFNpZ25hbHNbU10+XG59PiAmIFBhcnRpYWw8e1xuICAgIFtLZXkgaW4gYG9uJHtzdHJpbmd9YF06IFNpZ0hhbmRsZXI8U2VsZiwgYW55W10+XG59PiAmIFBhcnRpYWw8QmluZGFibGVQcm9wczxPbWl0PFByb3BzLCBcImNzc05hbWVcIiB8IFwiY3NzX25hbWVcIj4+PiAmIHtcbiAgICBub0ltcGxpY2l0RGVzdHJveT86IHRydWVcbiAgICB0eXBlPzogc3RyaW5nXG4gICAgY3NzTmFtZT86IHN0cmluZ1xufSAmIEV2ZW50Q29udHJvbGxlcjxTZWxmPiAmIHtcbiAgICBvbkRlc3Ryb3k/OiAoc2VsZjogU2VsZikgPT4gdW5rbm93blxuICAgIHNldHVwPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcbn1cblxudHlwZSBFdmVudENvbnRyb2xsZXI8U2VsZiBleHRlbmRzIEd0ay5XaWRnZXQ+ID0ge1xuICAgIG9uRm9jdXNFbnRlcj86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG4gICAgb25Gb2N1c0xlYXZlPzogKHNlbGY6IFNlbGYpID0+IHZvaWRcblxuICAgIG9uS2V5UHJlc3NlZD86IChzZWxmOiBTZWxmLCBrZXl2YWw6IG51bWJlciwga2V5Y29kZTogbnVtYmVyLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuICAgIG9uS2V5UmVsZWFzZWQ/OiAoc2VsZjogU2VsZiwga2V5dmFsOiBudW1iZXIsIGtleWNvZGU6IG51bWJlciwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcbiAgICBvbktleU1vZGlmaWVyPzogKHNlbGY6IFNlbGYsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG5cbiAgICBvbkxlZ2FjeT86IChzZWxmOiBTZWxmLCBldmVudDogR2RrLkV2ZW50KSA9PiB2b2lkXG4gICAgb25CdXR0b25QcmVzc2VkPzogKHNlbGY6IFNlbGYsIHN0YXRlOiBHZGsuQnV0dG9uRXZlbnQpID0+IHZvaWRcbiAgICBvbkJ1dHRvblJlbGVhc2VkPzogKHNlbGY6IFNlbGYsIHN0YXRlOiBHZGsuQnV0dG9uRXZlbnQpID0+IHZvaWRcblxuICAgIG9uSG92ZXJFbnRlcj86IChzZWxmOiBTZWxmLCB4OiBudW1iZXIsIHk6IG51bWJlcikgPT4gdm9pZFxuICAgIG9uSG92ZXJMZWF2ZT86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG4gICAgb25Nb3Rpb24/OiAoc2VsZjogU2VsZiwgeDogbnVtYmVyLCB5OiBudW1iZXIpID0+IHZvaWRcblxuICAgIG9uU2Nyb2xsPzogKHNlbGY6IFNlbGYsIGR4OiBudW1iZXIsIGR5OiBudW1iZXIpID0+IHZvaWRcbiAgICBvblNjcm9sbERlY2VsZXJhdGU/OiAoc2VsZjogU2VsZiwgdmVsX3g6IG51bWJlciwgdmVsX3k6IG51bWJlcikgPT4gdm9pZFxufVxuXG5mdW5jdGlvbiBzZXR1cENvbnRyb2xsZXJzPFQ+KHdpZGdldDogR3RrLldpZGdldCwge1xuICAgIG9uRm9jdXNFbnRlcixcbiAgICBvbkZvY3VzTGVhdmUsXG4gICAgb25LZXlQcmVzc2VkLFxuICAgIG9uS2V5UmVsZWFzZWQsXG4gICAgb25LZXlNb2RpZmllcixcbiAgICBvbkxlZ2FjeSxcbiAgICBvbkJ1dHRvblByZXNzZWQsXG4gICAgb25CdXR0b25SZWxlYXNlZCxcbiAgICBvbkhvdmVyRW50ZXIsXG4gICAgb25Ib3ZlckxlYXZlLFxuICAgIG9uTW90aW9uLFxuICAgIG9uU2Nyb2xsLFxuICAgIG9uU2Nyb2xsRGVjZWxlcmF0ZSxcbiAgICAuLi5wcm9wc1xufTogRXZlbnRDb250cm9sbGVyPEd0ay5XaWRnZXQ+ICYgVCkge1xuICAgIGlmIChvbkZvY3VzRW50ZXIgfHwgb25Gb2N1c0xlYXZlKSB7XG4gICAgICAgIGNvbnN0IGZvY3VzID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJGb2N1c1xuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoZm9jdXMpXG5cbiAgICAgICAgaWYgKG9uRm9jdXNFbnRlcilcbiAgICAgICAgICAgIGZvY3VzLmNvbm5lY3QoXCJlbnRlclwiLCAoKSA9PiBvbkZvY3VzRW50ZXIod2lkZ2V0KSlcblxuICAgICAgICBpZiAob25Gb2N1c0xlYXZlKVxuICAgICAgICAgICAgZm9jdXMuY29ubmVjdChcImxlYXZlXCIsICgpID0+IG9uRm9jdXNMZWF2ZSh3aWRnZXQpKVxuICAgIH1cblxuICAgIGlmIChvbktleVByZXNzZWQgfHwgb25LZXlSZWxlYXNlZCB8fCBvbktleU1vZGlmaWVyKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyS2V5XG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihrZXkpXG5cbiAgICAgICAgaWYgKG9uS2V5UHJlc3NlZClcbiAgICAgICAgICAgIGtleS5jb25uZWN0KFwia2V5LXByZXNzZWRcIiwgKF8sIHZhbCwgY29kZSwgc3RhdGUpID0+IG9uS2V5UHJlc3NlZCh3aWRnZXQsIHZhbCwgY29kZSwgc3RhdGUpKVxuXG4gICAgICAgIGlmIChvbktleVJlbGVhc2VkKVxuICAgICAgICAgICAga2V5LmNvbm5lY3QoXCJrZXktcmVsZWFzZWRcIiwgKF8sIHZhbCwgY29kZSwgc3RhdGUpID0+IG9uS2V5UmVsZWFzZWQod2lkZ2V0LCB2YWwsIGNvZGUsIHN0YXRlKSlcblxuICAgICAgICBpZiAob25LZXlNb2RpZmllcilcbiAgICAgICAgICAgIGtleS5jb25uZWN0KFwibW9kaWZpZXJzXCIsIChfLCBzdGF0ZSkgPT4gb25LZXlNb2RpZmllcih3aWRnZXQsIHN0YXRlKSlcbiAgICB9XG5cbiAgICBpZiAob25MZWdhY3kgfHwgb25CdXR0b25QcmVzc2VkIHx8IG9uQnV0dG9uUmVsZWFzZWQpIHtcbiAgICAgICAgY29uc3QgbGVnYWN5ID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJMZWdhY3lcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGxlZ2FjeSlcblxuICAgICAgICBsZWdhY3kuY29ubmVjdChcImV2ZW50XCIsIChfLCBldmVudCkgPT4ge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmdldF9ldmVudF90eXBlKCkgPT09IEdkay5FdmVudFR5cGUuQlVUVE9OX1BSRVNTKSB7XG4gICAgICAgICAgICAgICAgb25CdXR0b25QcmVzc2VkPy4od2lkZ2V0LCBldmVudCBhcyBHZGsuQnV0dG9uRXZlbnQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChldmVudC5nZXRfZXZlbnRfdHlwZSgpID09PSBHZGsuRXZlbnRUeXBlLkJVVFRPTl9SRUxFQVNFKSB7XG4gICAgICAgICAgICAgICAgb25CdXR0b25SZWxlYXNlZD8uKHdpZGdldCwgZXZlbnQgYXMgR2RrLkJ1dHRvbkV2ZW50KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBvbkxlZ2FjeT8uKHdpZGdldCwgZXZlbnQpXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKG9uTW90aW9uIHx8IG9uSG92ZXJFbnRlciB8fCBvbkhvdmVyTGVhdmUpIHtcbiAgICAgICAgY29uc3QgaG92ZXIgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlck1vdGlvblxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoaG92ZXIpXG5cbiAgICAgICAgaWYgKG9uSG92ZXJFbnRlcilcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJlbnRlclwiLCAoXywgeCwgeSkgPT4gb25Ib3ZlckVudGVyKHdpZGdldCwgeCwgeSkpXG5cbiAgICAgICAgaWYgKG9uSG92ZXJMZWF2ZSlcbiAgICAgICAgICAgIGhvdmVyLmNvbm5lY3QoXCJsZWF2ZVwiLCAoKSA9PiBvbkhvdmVyTGVhdmUod2lkZ2V0KSlcblxuICAgICAgICBpZiAob25Nb3Rpb24pXG4gICAgICAgICAgICBob3Zlci5jb25uZWN0KFwibW90aW9uXCIsIChfLCB4LCB5KSA9PiBvbk1vdGlvbih3aWRnZXQsIHgsIHkpKVxuICAgIH1cblxuICAgIGlmIChvblNjcm9sbCB8fCBvblNjcm9sbERlY2VsZXJhdGUpIHtcbiAgICAgICAgY29uc3Qgc2Nyb2xsID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJTY3JvbGxcbiAgICAgICAgc2Nyb2xsLmZsYWdzID0gR3RrLkV2ZW50Q29udHJvbGxlclNjcm9sbEZsYWdzLkJPVEhfQVhFUyB8IEd0ay5FdmVudENvbnRyb2xsZXJTY3JvbGxGbGFncy5LSU5FVElDXG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihzY3JvbGwpXG5cbiAgICAgICAgaWYgKG9uU2Nyb2xsKVxuICAgICAgICAgICAgc2Nyb2xsLmNvbm5lY3QoXCJzY3JvbGxcIiwgKF8sIHgsIHkpID0+IG9uU2Nyb2xsKHdpZGdldCwgeCwgeSkpXG5cbiAgICAgICAgaWYgKG9uU2Nyb2xsRGVjZWxlcmF0ZSlcbiAgICAgICAgICAgIHNjcm9sbC5jb25uZWN0KFwiZGVjZWxlcmF0ZVwiLCAoXywgeCwgeSkgPT4gb25TY3JvbGxEZWNlbGVyYXRlKHdpZGdldCwgeCwgeSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHByb3BzXG59XG4iLCAiaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYj92ZXJzaW9uPTIuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IHsgbWtBcHAgfSBmcm9tIFwiLi4vX2FwcFwiXG5cbkd0ay5pbml0KClcblxuLy8gc3RvcCB0aGlzIGZyb20gbGVha2luZyBpbnRvIHN1YnByb2Nlc3Nlc1xuLy8gYW5kIGdpbyBsYXVuY2ggaW52b2NhdGlvbnNcbkdMaWIudW5zZXRlbnYoXCJMRF9QUkVMT0FEXCIpXG5cbi8vIHVzZXJzIG1pZ2h0IHdhbnQgdG8gdXNlIEFkd2FpdGEgaW4gd2hpY2ggY2FzZSBpdCBoYXMgdG8gYmUgaW5pdGlhbGl6ZWRcbi8vIGl0IG1pZ2h0IGJlIGNvbW1vbiBwaXRmYWxsIHRvIGZvcmdldCBpdCBiZWNhdXNlIGBBcHBgIGlzIG5vdCBgQWR3LkFwcGxpY2F0aW9uYFxuYXdhaXQgaW1wb3J0KFwiZ2k6Ly9BZHc/dmVyc2lvbj0xXCIpXG4gICAgLnRoZW4oKHsgZGVmYXVsdDogQWR3IH0pID0+IEFkdy5pbml0KCkpXG4gICAgLmNhdGNoKCgpID0+IHZvaWQgMClcblxuZXhwb3J0IGRlZmF1bHQgbWtBcHAoQXN0YWwuQXBwbGljYXRpb24pXG4iLCAiLyoqXG4gKiBXb3JrYXJvdW5kIGZvciBcIkNhbid0IGNvbnZlcnQgbm9uLW51bGwgcG9pbnRlciB0byBKUyB2YWx1ZSBcIlxuICovXG5cbmV4cG9ydCB7IH1cblxuY29uc3Qgc25ha2VpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxXyQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCItXCIsIFwiX1wiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbmFzeW5jIGZ1bmN0aW9uIHN1cHByZXNzPFQ+KG1vZDogUHJvbWlzZTx7IGRlZmF1bHQ6IFQgfT4sIHBhdGNoOiAobTogVCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBtb2QudGhlbihtID0+IHBhdGNoKG0uZGVmYXVsdCkpLmNhdGNoKCgpID0+IHZvaWQgMClcbn1cblxuZnVuY3Rpb24gcGF0Y2g8UCBleHRlbmRzIG9iamVjdD4ocHJvdG86IFAsIHByb3A6IEV4dHJhY3Q8a2V5b2YgUCwgc3RyaW5nPikge1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwcm90bywgcHJvcCwge1xuICAgICAgICBnZXQoKSB7IHJldHVybiB0aGlzW2BnZXRfJHtzbmFrZWlmeShwcm9wKX1gXSgpIH0sXG4gICAgfSlcbn1cblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEFwcHNcIiksICh7IEFwcHMsIEFwcGxpY2F0aW9uIH0pID0+IHtcbiAgICBwYXRjaChBcHBzLnByb3RvdHlwZSwgXCJsaXN0XCIpXG4gICAgcGF0Y2goQXBwbGljYXRpb24ucHJvdG90eXBlLCBcImtleXdvcmRzXCIpXG4gICAgcGF0Y2goQXBwbGljYXRpb24ucHJvdG90eXBlLCBcImNhdGVnb3JpZXNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxCYXR0ZXJ5XCIpLCAoeyBVUG93ZXIgfSkgPT4ge1xuICAgIHBhdGNoKFVQb3dlci5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiKSwgKHsgQWRhcHRlciwgQmx1ZXRvb3RoLCBEZXZpY2UgfSkgPT4ge1xuICAgIHBhdGNoKEFkYXB0ZXIucHJvdG90eXBlLCBcInV1aWRzXCIpXG4gICAgcGF0Y2goQmx1ZXRvb3RoLnByb3RvdHlwZSwgXCJhZGFwdGVyc1wiKVxuICAgIHBhdGNoKEJsdWV0b290aC5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKERldmljZS5wcm90b3R5cGUsIFwidXVpZHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxIeXBybGFuZFwiKSwgKHsgSHlwcmxhbmQsIE1vbml0b3IsIFdvcmtzcGFjZSB9KSA9PiB7XG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcImJpbmRzXCIpXG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcIm1vbml0b3JzXCIpXG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcIndvcmtzcGFjZXNcIilcbiAgICBwYXRjaChIeXBybGFuZC5wcm90b3R5cGUsIFwiY2xpZW50c1wiKVxuICAgIHBhdGNoKE1vbml0b3IucHJvdG90eXBlLCBcImF2YWlsYWJsZU1vZGVzXCIpXG4gICAgcGF0Y2goTW9uaXRvci5wcm90b3R5cGUsIFwiYXZhaWxhYmxlX21vZGVzXCIpXG4gICAgcGF0Y2goV29ya3NwYWNlLnByb3RvdHlwZSwgXCJjbGllbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTXByaXNcIiksICh7IE1wcmlzLCBQbGF5ZXIgfSkgPT4ge1xuICAgIHBhdGNoKE1wcmlzLnByb3RvdHlwZSwgXCJwbGF5ZXJzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRfdXJpX3NjaGVtZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZFVyaVNjaGVtZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcInN1cHBvcnRlZF9taW1lX3R5cGVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRNaW1lVHlwZXNcIilcbiAgICBwYXRjaChQbGF5ZXIucHJvdG90eXBlLCBcImNvbW1lbnRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsTmV0d29ya1wiKSwgKHsgV2lmaSB9KSA9PiB7XG4gICAgcGF0Y2goV2lmaS5wcm90b3R5cGUsIFwiYWNjZXNzX3BvaW50c1wiKVxuICAgIHBhdGNoKFdpZmkucHJvdG90eXBlLCBcImFjY2Vzc1BvaW50c1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbE5vdGlmZFwiKSwgKHsgTm90aWZkLCBOb3RpZmljYXRpb24gfSkgPT4ge1xuICAgIHBhdGNoKE5vdGlmZC5wcm90b3R5cGUsIFwibm90aWZpY2F0aW9uc1wiKVxuICAgIHBhdGNoKE5vdGlmaWNhdGlvbi5wcm90b3R5cGUsIFwiYWN0aW9uc1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbFBvd2VyUHJvZmlsZXNcIiksICh7IFBvd2VyUHJvZmlsZXMgfSkgPT4ge1xuICAgIHBhdGNoKFBvd2VyUHJvZmlsZXMucHJvdG90eXBlLCBcImFjdGlvbnNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxXcFwiKSwgKHsgV3AsIEF1ZGlvLCBWaWRlbyB9KSA9PiB7XG4gICAgcGF0Y2goV3AucHJvdG90eXBlLCBcImVuZHBvaW50c1wiKVxuICAgIHBhdGNoKFdwLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcInN0cmVhbXNcIilcbiAgICBwYXRjaChBdWRpby5wcm90b3R5cGUsIFwicmVjb3JkZXJzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcIm1pY3JvcGhvbmVzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcInNwZWFrZXJzXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwic3RyZWFtc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJyZWNvcmRlcnNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwic2lua3NcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwic291cmNlc1wiKVxuICAgIHBhdGNoKFZpZGVvLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG59KVxuIiwgImltcG9ydCBcIi4vb3ZlcnJpZGVzLmpzXCJcbmltcG9ydCB7IHNldENvbnNvbGVMb2dEb21haW4gfSBmcm9tIFwiY29uc29sZVwiXG5pbXBvcnQgeyBleGl0LCBwcm9ncmFtQXJncyB9IGZyb20gXCJzeXN0ZW1cIlxuaW1wb3J0IElPIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5pbXBvcnQgdHlwZSBBc3RhbDMgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj0zLjBcIlxuaW1wb3J0IHR5cGUgQXN0YWw0IGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcblxudHlwZSBDb25maWcgPSBQYXJ0aWFsPHtcbiAgICBpbnN0YW5jZU5hbWU6IHN0cmluZ1xuICAgIGNzczogc3RyaW5nXG4gICAgaWNvbnM6IHN0cmluZ1xuICAgIGd0a1RoZW1lOiBzdHJpbmdcbiAgICBpY29uVGhlbWU6IHN0cmluZ1xuICAgIGN1cnNvclRoZW1lOiBzdHJpbmdcbiAgICBob2xkOiBib29sZWFuXG4gICAgcmVxdWVzdEhhbmRsZXIocmVxdWVzdDogc3RyaW5nLCByZXM6IChyZXNwb25zZTogYW55KSA9PiB2b2lkKTogdm9pZFxuICAgIG1haW4oLi4uYXJnczogc3RyaW5nW10pOiB2b2lkXG4gICAgY2xpZW50KG1lc3NhZ2U6IChtc2c6IHN0cmluZykgPT4gc3RyaW5nLCAuLi5hcmdzOiBzdHJpbmdbXSk6IHZvaWRcbn0+XG5cbmludGVyZmFjZSBBc3RhbDNKUyBleHRlbmRzIEFzdGFsMy5BcHBsaWNhdGlvbiB7XG4gICAgZXZhbChib2R5OiBzdHJpbmcpOiBQcm9taXNlPGFueT5cbiAgICByZXF1ZXN0SGFuZGxlcjogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cbiAgICBhcHBseV9jc3Moc3R5bGU6IHN0cmluZywgcmVzZXQ/OiBib29sZWFuKTogdm9pZFxuICAgIHF1aXQoY29kZT86IG51bWJlcik6IHZvaWRcbiAgICBzdGFydChjb25maWc/OiBDb25maWcpOiB2b2lkXG59XG5cbmludGVyZmFjZSBBc3RhbDRKUyBleHRlbmRzIEFzdGFsNC5BcHBsaWNhdGlvbiB7XG4gICAgZXZhbChib2R5OiBzdHJpbmcpOiBQcm9taXNlPGFueT5cbiAgICByZXF1ZXN0SGFuZGxlcj86IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG4gICAgYXBwbHlfY3NzKHN0eWxlOiBzdHJpbmcsIHJlc2V0PzogYm9vbGVhbik6IHZvaWRcbiAgICBxdWl0KGNvZGU/OiBudW1iZXIpOiB2b2lkXG4gICAgc3RhcnQoY29uZmlnPzogQ29uZmlnKTogdm9pZFxufVxuXG50eXBlIEFwcDMgPSB0eXBlb2YgQXN0YWwzLkFwcGxpY2F0aW9uXG50eXBlIEFwcDQgPSB0eXBlb2YgQXN0YWw0LkFwcGxpY2F0aW9uXG5cbmV4cG9ydCBmdW5jdGlvbiBta0FwcDxBcHAgZXh0ZW5kcyBBcHAzPihBcHA6IEFwcCk6IEFzdGFsM0pTXG5leHBvcnQgZnVuY3Rpb24gbWtBcHA8QXBwIGV4dGVuZHMgQXBwND4oQXBwOiBBcHApOiBBc3RhbDRKU1xuXG5leHBvcnQgZnVuY3Rpb24gbWtBcHAoQXBwOiBBcHAzIHwgQXBwNCkge1xuICAgIHJldHVybiBuZXcgKGNsYXNzIEFzdGFsSlMgZXh0ZW5kcyBBcHAge1xuICAgICAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQXN0YWxKU1wiIH0sIHRoaXMgYXMgYW55KSB9XG5cbiAgICAgICAgZXZhbChib2R5OiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMsIHJlaikgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZuID0gRnVuY3Rpb24oYHJldHVybiAoYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAke2JvZHkuaW5jbHVkZXMoXCI7XCIpID8gYm9keSA6IGByZXR1cm4gJHtib2R5fTtgfVxuICAgICAgICAgICAgICAgICAgICB9KWApXG4gICAgICAgICAgICAgICAgICAgIGZuKCkoKS50aGVuKHJlcykuY2F0Y2gocmVqKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlaihlcnJvcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG5cbiAgICAgICAgcmVxdWVzdEhhbmRsZXI/OiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuXG4gICAgICAgIHZmdW5jX3JlcXVlc3QobXNnOiBzdHJpbmcsIGNvbm46IEdpby5Tb2NrZXRDb25uZWN0aW9uKTogdm9pZCB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHRoaXMucmVxdWVzdEhhbmRsZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgICAgIHRoaXMucmVxdWVzdEhhbmRsZXIobXNnLCAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgSU8ud3JpdGVfc29jayhjb25uLCBTdHJpbmcocmVzcG9uc2UpLCAoXywgcmVzKSA9PlxuICAgICAgICAgICAgICAgICAgICAgICAgSU8ud3JpdGVfc29ja19maW5pc2gocmVzKSxcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHN1cGVyLnZmdW5jX3JlcXVlc3QobXNnLCBjb25uKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYXBwbHlfY3NzKHN0eWxlOiBzdHJpbmcsIHJlc2V0ID0gZmFsc2UpIHtcbiAgICAgICAgICAgIHN1cGVyLmFwcGx5X2NzcyhzdHlsZSwgcmVzZXQpXG4gICAgICAgIH1cblxuICAgICAgICBxdWl0KGNvZGU/OiBudW1iZXIpOiB2b2lkIHtcbiAgICAgICAgICAgIHN1cGVyLnF1aXQoKVxuICAgICAgICAgICAgZXhpdChjb2RlID8/IDApXG4gICAgICAgIH1cblxuICAgICAgICBzdGFydCh7IHJlcXVlc3RIYW5kbGVyLCBjc3MsIGhvbGQsIG1haW4sIGNsaWVudCwgaWNvbnMsIC4uLmNmZyB9OiBDb25maWcgPSB7fSkge1xuICAgICAgICAgICAgY29uc3QgYXBwID0gdGhpcyBhcyB1bmtub3duIGFzIEluc3RhbmNlVHlwZTxBcHAzIHwgQXBwND5cblxuICAgICAgICAgICAgY2xpZW50ID8/PSAoKSA9PiB7XG4gICAgICAgICAgICAgICAgcHJpbnQoYEFzdGFsIGluc3RhbmNlIFwiJHthcHAuaW5zdGFuY2VOYW1lfVwiIGFscmVhZHkgcnVubmluZ2ApXG4gICAgICAgICAgICAgICAgZXhpdCgxKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKHRoaXMsIGNmZylcbiAgICAgICAgICAgIHNldENvbnNvbGVMb2dEb21haW4oYXBwLmluc3RhbmNlTmFtZSlcblxuICAgICAgICAgICAgdGhpcy5yZXF1ZXN0SGFuZGxlciA9IHJlcXVlc3RIYW5kbGVyXG4gICAgICAgICAgICBhcHAuY29ubmVjdChcImFjdGl2YXRlXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICBtYWluPy4oLi4ucHJvZ3JhbUFyZ3MpXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGFwcC5hY3F1aXJlX3NvY2tldCgpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBjbGllbnQobXNnID0+IElPLnNlbmRfcmVxdWVzdChhcHAuaW5zdGFuY2VOYW1lLCBtc2cpISwgLi4ucHJvZ3JhbUFyZ3MpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjc3MpXG4gICAgICAgICAgICAgICAgdGhpcy5hcHBseV9jc3MoY3NzLCBmYWxzZSlcblxuICAgICAgICAgICAgaWYgKGljb25zKVxuICAgICAgICAgICAgICAgIGFwcC5hZGRfaWNvbnMoaWNvbnMpXG5cbiAgICAgICAgICAgIGhvbGQgPz89IHRydWVcbiAgICAgICAgICAgIGlmIChob2xkKVxuICAgICAgICAgICAgICAgIGFwcC5ob2xkKClcblxuICAgICAgICAgICAgYXBwLnJ1bkFzeW5jKFtdKVxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWw/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUsIHR5cGUgQ29uc3RydWN0UHJvcHMgfSBmcm9tIFwiLi9hc3RhbGlmeS5qc1wiXG5cbmZ1bmN0aW9uIGZpbHRlcihjaGlsZHJlbjogYW55W10pIHtcbiAgICByZXR1cm4gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICA/IGNoXG4gICAgICAgIDogbmV3IEd0ay5MYWJlbCh7IHZpc2libGU6IHRydWUsIGxhYmVsOiBTdHJpbmcoY2gpIH0pKVxufVxuXG4vLyBCb3hcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShBc3RhbC5Cb3gucHJvdG90eXBlLCBcImNoaWxkcmVuXCIsIHtcbiAgICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9jaGlsZHJlbigpIH0sXG4gICAgc2V0KHYpIHsgdGhpcy5zZXRfY2hpbGRyZW4odikgfSxcbn0pXG5cbmV4cG9ydCB0eXBlIEJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8QXN0YWwuQm94LCBBc3RhbC5Cb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBCb3ggPSBhc3RhbGlmeTxBc3RhbC5Cb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPihBc3RhbC5Cb3gsIHtcbiAgICBnZXRDaGlsZHJlbihzZWxmKSB7IHJldHVybiBzZWxmLmdldF9jaGlsZHJlbigpIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHsgcmV0dXJuIHNlbGYuc2V0X2NoaWxkcmVuKGZpbHRlcihjaGlsZHJlbikpIH0sXG59KVxuXG4vLyBCdXR0b25cbnR5cGUgQnV0dG9uU2lnbmFscyA9IHtcbiAgICBvbkNsaWNrZWQ6IFtdXG59XG5cbmV4cG9ydCB0eXBlIEJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkJ1dHRvbiwgR3RrLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCBCdXR0b25TaWduYWxzPlxuZXhwb3J0IGNvbnN0IEJ1dHRvbiA9IGFzdGFsaWZ5PEd0ay5CdXR0b24sIEd0ay5CdXR0b24uQ29uc3RydWN0b3JQcm9wcywgQnV0dG9uU2lnbmFscz4oR3RrLkJ1dHRvbilcblxuLy8gQ2VudGVyQm94XG5leHBvcnQgdHlwZSBDZW50ZXJCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5DZW50ZXJCb3gsIEd0ay5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBDZW50ZXJCb3ggPSBhc3RhbGlmeTxHdGsuQ2VudGVyQm94LCBHdGsuQ2VudGVyQm94LkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5DZW50ZXJCb3gsIHtcbiAgICBnZXRDaGlsZHJlbihib3gpIHtcbiAgICAgICAgcmV0dXJuIFtib3guc3RhcnRXaWRnZXQsIGJveC5jZW50ZXJXaWRnZXQsIGJveC5lbmRXaWRnZXRdXG4gICAgfSxcbiAgICBzZXRDaGlsZHJlbihib3gsIGNoaWxkcmVuKSB7XG4gICAgICAgIGNvbnN0IGNoID0gZmlsdGVyKGNoaWxkcmVuKVxuICAgICAgICBib3guc3RhcnRXaWRnZXQgPSBjaFswXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICBib3guY2VudGVyV2lkZ2V0ID0gY2hbMV0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgYm94LmVuZFdpZGdldCA9IGNoWzJdIHx8IG5ldyBHdGsuQm94XG4gICAgfSxcbn0pXG5cbi8vIFRPRE86IENpcmN1bGFyUHJvZ3Jlc3Ncbi8vIFRPRE86IERyYXdpbmdBcmVhXG5cbi8vIEVudHJ5XG50eXBlIEVudHJ5U2lnbmFscyA9IHtcbiAgICBvbkFjdGl2YXRlOiBbXVxuICAgIG9uTm90aWZ5VGV4dDogW11cbn1cblxuZXhwb3J0IHR5cGUgRW50cnlQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5FbnRyeSwgR3RrLkVudHJ5LkNvbnN0cnVjdG9yUHJvcHMsIEVudHJ5U2lnbmFscz5cbmV4cG9ydCBjb25zdCBFbnRyeSA9IGFzdGFsaWZ5PEd0ay5FbnRyeSwgR3RrLkVudHJ5LkNvbnN0cnVjdG9yUHJvcHMsIEVudHJ5U2lnbmFscz4oR3RrLkVudHJ5LCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gSW1hZ2VcbmV4cG9ydCB0eXBlIEltYWdlUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuSW1hZ2UsIEd0ay5JbWFnZS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IEltYWdlID0gYXN0YWxpZnk8R3RrLkltYWdlLCBHdGsuSW1hZ2UuQ29uc3RydWN0b3JQcm9wcz4oR3RrLkltYWdlLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gTGFiZWxcbmV4cG9ydCB0eXBlIExhYmVsUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuTGFiZWwsIEd0ay5MYWJlbC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IExhYmVsID0gYXN0YWxpZnk8R3RrLkxhYmVsLCBHdGsuTGFiZWwuQ29uc3RydWN0b3JQcm9wcz4oR3RrLkxhYmVsLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7IHNlbGYubGFiZWwgPSBTdHJpbmcoY2hpbGRyZW4pIH0sXG59KVxuXG4vLyBMZXZlbEJhclxuZXhwb3J0IHR5cGUgTGV2ZWxCYXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5MZXZlbEJhciwgR3RrLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgTGV2ZWxCYXIgPSBhc3RhbGlmeTxHdGsuTGV2ZWxCYXIsIEd0ay5MZXZlbEJhci5Db25zdHJ1Y3RvclByb3BzPihHdGsuTGV2ZWxCYXIsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBUT0RPOiBMaXN0Qm94XG5cbi8vIE92ZXJsYXlcbmV4cG9ydCB0eXBlIE92ZXJsYXlQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5PdmVybGF5LCBHdGsuT3ZlcmxheS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IE92ZXJsYXkgPSBhc3RhbGlmeTxHdGsuT3ZlcmxheSwgR3RrLk92ZXJsYXkuQ29uc3RydWN0b3JQcm9wcz4oR3RrLk92ZXJsYXksIHtcbiAgICBnZXRDaGlsZHJlbihzZWxmKSB7XG4gICAgICAgIGNvbnN0IGNoaWxkcmVuOiBBcnJheTxHdGsuV2lkZ2V0PiA9IFtdXG4gICAgICAgIGxldCBjaCA9IHNlbGYuZ2V0X2ZpcnN0X2NoaWxkKClcbiAgICAgICAgd2hpbGUgKGNoICE9PSBudWxsKSB7XG4gICAgICAgICAgICBjaGlsZHJlbi5wdXNoKGNoKVxuICAgICAgICAgICAgY2ggPSBjaC5nZXRfbmV4dF9zaWJsaW5nKClcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjaGlsZHJlbi5maWx0ZXIoY2ggPT4gY2ggIT09IHNlbGYuY2hpbGQpXG4gICAgfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZpbHRlcihjaGlsZHJlbikpIHtcbiAgICAgICAgICAgIGNvbnN0IHR5cGVzID0gdHlwZSBpbiBjaGlsZFxuICAgICAgICAgICAgICAgID8gKGNoaWxkW3R5cGVdIGFzIHN0cmluZykuc3BsaXQoL1xccysvKVxuICAgICAgICAgICAgICAgIDogW11cblxuICAgICAgICAgICAgaWYgKHR5cGVzLmluY2x1ZGVzKFwib3ZlcmxheVwiKSkge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX292ZXJsYXkoY2hpbGQpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuc2V0X2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZWxmLnNldF9tZWFzdXJlX292ZXJsYXkoY2hpbGQsIHR5cGVzLmluY2x1ZGVzKFwibWVhc3VyZVwiKSlcbiAgICAgICAgICAgIHNlbGYuc2V0X2NsaXBfb3ZlcmxheShjaGlsZCwgdHlwZXMuaW5jbHVkZXMoXCJjbGlwXCIpKVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFJldmVhbGVyXG5leHBvcnQgdHlwZSBSZXZlYWxlclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlJldmVhbGVyLCBHdGsuUmV2ZWFsZXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBSZXZlYWxlciA9IGFzdGFsaWZ5PEd0ay5SZXZlYWxlciwgR3RrLlJldmVhbGVyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5SZXZlYWxlcilcblxuLy8gU2xpZGVyXG50eXBlIFNsaWRlclNpZ25hbHMgPSB7XG4gICAgb25DaGFuZ2VWYWx1ZTogW11cbn1cblxuZXhwb3J0IHR5cGUgU2xpZGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxBc3RhbC5TbGlkZXIsIEFzdGFsLlNsaWRlci5Db25zdHJ1Y3RvclByb3BzLCBTbGlkZXJTaWduYWxzPlxuZXhwb3J0IGNvbnN0IFNsaWRlciA9IGFzdGFsaWZ5PEFzdGFsLlNsaWRlciwgQXN0YWwuU2xpZGVyLkNvbnN0cnVjdG9yUHJvcHMsIFNsaWRlclNpZ25hbHM+KEFzdGFsLlNsaWRlciwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIFN0YWNrXG5leHBvcnQgdHlwZSBTdGFja1Byb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlN0YWNrLCBHdGsuU3RhY2suQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBTdGFjayA9IGFzdGFsaWZ5PEd0ay5TdGFjaywgR3RrLlN0YWNrLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5TdGFjaywge1xuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgaWYgKGNoaWxkLm5hbWUgIT0gXCJcIiAmJiBjaGlsZC5uYW1lICE9IG51bGwpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9uYW1lZChjaGlsZCwgY2hpbGQubmFtZSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gU3dpdGNoXG5leHBvcnQgdHlwZSBTd2l0Y2hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5Td2l0Y2gsIEd0ay5Td2l0Y2guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBTd2l0Y2ggPSBhc3RhbGlmeTxHdGsuU3dpdGNoLCBHdGsuU3dpdGNoLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5Td2l0Y2gsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBXaW5kb3dcbmV4cG9ydCB0eXBlIFdpbmRvd1Byb3BzID0gQ29uc3RydWN0UHJvcHM8QXN0YWwuV2luZG93LCBBc3RhbC5XaW5kb3cuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBXaW5kb3cgPSBhc3RhbGlmeTxBc3RhbC5XaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPihBc3RhbC5XaW5kb3cpXG5cbi8vIE1lbnVCdXR0b25cbmV4cG9ydCB0eXBlIE1lbnVCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5NZW51QnV0dG9uLCBHdGsuTWVudUJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IE1lbnVCdXR0b24gPSBhc3RhbGlmeTxHdGsuTWVudUJ1dHRvbiwgR3RrLk1lbnVCdXR0b24uQ29uc3RydWN0b3JQcm9wcz4oR3RrLk1lbnVCdXR0b24sIHtcbiAgICBnZXRDaGlsZHJlbihzZWxmKSB7IHJldHVybiBbc2VsZi5wb3BvdmVyLCBzZWxmLmNoaWxkXSB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7XG4gICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgZmlsdGVyKGNoaWxkcmVuKSkge1xuICAgICAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgR3RrLlBvcG92ZXIpIHtcbiAgICAgICAgICAgICAgICBzZWxmLnNldF9wb3BvdmVyKGNoaWxkKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLnNldF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBQb3BvcGVyXG5leHBvcnQgdHlwZSBQb3BvdmVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuUG9wb3ZlciwgR3RrLlBvcG92ZXIuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBQb3BvdmVyID0gYXN0YWxpZnk8R3RrLlBvcG92ZXIsIEd0ay5Qb3BvdmVyLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5Qb3BvdmVyKVxuIiwgIi8vIGtvYmVsLXNoZWxsIGVudHJ5IFx1MjAxNCBBR1MgdjIgLyBhc3RhbDRcbmltcG9ydCB7IEFwcCB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249NC4wXCJcbi8vIGFzdGFsIGBjb25zdHJ1Y3RgIHNldHMgc3RhdGljIHByb3BzIHZpYSBPYmplY3QuYXNzaWduKHdpZGdldCwgcHJvcHMpIGFuZCBiaW5kaW5ncyB2aWFcbi8vIHNldFByb3AgXHUyMTkyIHNldF9jbGFzcy4gR3RrV2lkZ2V0IGhhcyBuZWl0aGVyIGEgYGNsYXNzYCBHT2JqZWN0IHByb3Agbm9yIHNldF9jbGFzcywgc29cbi8vIGBjbGFzcz1cIi4uLlwiYCBzaWxlbnRseSBuby1vcHMgKHRoZSByZWFsIHByb3AgaXMgYGNzcy1jbGFzc2VzYCwgYW4gYXJyYXkpLiBEZWZpbmUgYVxuLy8gYGNsYXNzYCBhY2Nlc3NvciByb3V0aW5nIEJPVEggcGF0aHMgdG8gc2V0X2Nzc19jbGFzc2VzLCBzbyBgY2xhc3M9XCJhIGJcImAgd29ya3MuXG5PYmplY3QuZGVmaW5lUHJvcGVydHkoKEd0ay5XaWRnZXQgYXMgYW55KS5wcm90b3R5cGUsIFwiY2xhc3NcIiwge1xuICBjb25maWd1cmFibGU6IHRydWUsXG4gIHNldCh2OiBzdHJpbmcpIHsgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKSB9LFxuICBnZXQoKSB7IHJldHVybiB0aGlzLmdldF9jc3NfY2xhc3NlcygpLmpvaW4oXCIgXCIpIH0sXG59KVxuOyhHdGsuV2lkZ2V0LnByb3RvdHlwZSBhcyBhbnkpLnNldF9jbGFzcyA9IGZ1bmN0aW9uICh2OiBzdHJpbmcpIHtcbiAgdGhpcy5zZXRfY3NzX2NsYXNzZXMoU3RyaW5nKHYpLnNwbGl0KC9cXHMrLykuZmlsdGVyKEJvb2xlYW4pKVxufVxuaW1wb3J0IHN0eWxlIGZyb20gXCIuL3N0eWxlL21haW4uc2Nzc1wiXG5pbXBvcnQgeyB0b2tlbkNzcywgdG9rZW5zIH0gZnJvbSBcIi4vY29uZmlnXCJcbmltcG9ydCAqIGFzIGdub2JsaW4gZnJvbSBcIi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgKiBhcyBub3RpZmRTdmMgZnJvbSBcIi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IGFybUR1bXAgfSBmcm9tIFwiLi9saWIvaW5zcGVjdFwiXG5pbXBvcnQgQmFyIGZyb20gXCIuL3dpZGdldC9CYXJcIlxuaW1wb3J0IERvY2sgZnJvbSBcIi4vd2lkZ2V0L0RvY2tcIlxuaW1wb3J0IExhdW5jaGVyIGZyb20gXCIuL3dpZGdldC9MYXVuY2hlclwiXG5pbXBvcnQgUXVpY2tTZXR0aW5ncyBmcm9tIFwiLi93aWRnZXQvUXVpY2tTZXR0aW5nc1wiXG5pbXBvcnQgQ2FsZW5kYXIgZnJvbSBcIi4vd2lkZ2V0L0NhbGVuZGFyXCJcbmltcG9ydCB7IFRvYXN0cywgRHJhd2VyIH0gZnJvbSBcIi4vd2lkZ2V0L05vdGlmaWNhdGlvbnNcIlxuaW1wb3J0IE9TRCBmcm9tIFwiLi93aWRnZXQvT1NEXCJcbmltcG9ydCBTZXNzaW9uIGZyb20gXCIuL3dpZGdldC9TZXNzaW9uXCJcblxucHJpbnRlcnIoXCJLT0JFTDogbW9kdWxlIHRvcCByZWFjaGVkXCIpXG5cbi8vIEN1c3RvbSBpY29uIHNldCBcdTIwMTQgdGhlIGV4YWN0IEhlcm9pY29ucy9MdWNpZGUvVGFibGVyIHRoZSBwcm90b3R5cGUgdXNlcywgYXNcbi8vIHJlY29sb3JhYmxlIHN5bWJvbGljIFNWR3MuIFJlZ2lzdGVyZWQgb24gdGhlIGRlZmF1bHQgaWNvbiB0aGVtZSBzbyBpY29uTmFtZVxuLy8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgZXRjLiByZXNvbHZlLiBQYXRoIG92ZXJyaWRlIHZpYSBLT0JFTF9JQ09OUyBmb3IgdGhlIGRldmtpdC5cbmltcG9ydCBHTGliSWNvbnMgZnJvbSBcImdpOi8vR0xpYlwiXG5jb25zdCBJQ09OX0RJUiA9IEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKVxuICA/PyBHTGliSWNvbnMuYnVpbGRfZmlsZW5hbWV2KFtHTGliSWNvbnMuZ2V0X2N1cnJlbnRfZGlyKCksIFwiaWNvbnNcIl0pXG5cbkFwcC5zdGFydCh7XG4gIGluc3RhbmNlTmFtZTogXCJrb2JlbFwiLFxuICBpY29uczogSUNPTl9ESVIsXG4gIG1haW4oKSB7XG4gICAgZ25vYmxpbi5pbml0KClcbiAgICBub3RpZmRTdmMuaW5pdCgpXG4gICAgLy8gTG9hZCBvdXIgc3R5bGVzaGVldCBhdCBVU0VSIHByaW9yaXR5IChoaWdoZXN0KSBzbyBpdCBiZWF0cyBBZHdhaXRhJ3MgdGhlbWVcbiAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgIC8vIGBzY2FsZSA+IHRyb3VnaGAgKGZhdCBzbGlkZXJzKS4gVGhpcyBwcm92aWRlciBpcyBhdXRob3JpdGF0aXZlLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm92ID0gbmV3IEd0ay5Dc3NQcm92aWRlcigpXG4gICAgICBwcm92LmxvYWRfZnJvbV9zdHJpbmcoc3R5bGUgKyB0b2tlbkNzcyh0b2tlbnMpKVxuICAgICAgR3RrLlN0eWxlQ29udGV4dC5hZGRfcHJvdmlkZXJfZm9yX2Rpc3BsYXkoXG4gICAgICAgIEdkay5EaXNwbGF5LmdldF9kZWZhdWx0KCkhLCBwcm92LCA4MDAgLyogVVNFUiBwcmlvcml0eSAqLylcbiAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApIH1cbiAgICAvLyBhc3RhbDQgSlNYIDx3aW5kb3c+IGlzIGNyZWF0ZWQgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gUGVyc2lzdGVudCBjaHJvbWUgbXVzdFxuICAgIC8vIGJlIHByZXNlbnQoKWVkOyBvbi1kZW1hbmQgc3VyZmFjZXMgc3RheSBoaWRkZW4gYW5kIGFyZSBzaG93biBieSB0b2dnbGVfd2luZG93LlxuICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB3ID0gZm4oKVxuICAgICAgICBpZiAodyAmJiB0eXBlb2Ygdy5wcmVzZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICBBcHAuYWRkX3dpbmRvdz8uKHcpXG4gICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHsgcHJpbnRlcnIoYGtvYmVsOiAke25hbWV9IEZBSUxFRDogJHtlfVxcbiR7KGUgYXMgYW55KT8uc3RhY2sgPz8gXCJcIn1gKSB9XG4gICAgfVxuICAgIGNvbnN0IG1vbml0b3JzID0gQXBwLmdldF9tb25pdG9ycygpXG4gICAgY29uc3QgdGFyZ2V0cyA9IG1vbml0b3JzLmxlbmd0aCA/IG1vbml0b3JzIDogW3VuZGVmaW5lZCBhcyBhbnldXG4gICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgfVxuICAgIG1ha2UoXCJsYXVuY2hlclwiLCAoKSA9PiBMYXVuY2hlcigpLCBmYWxzZSlcbiAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgIG1ha2UoXCJjYWxlbmRhclwiLCAoKSA9PiBDYWxlbmRhcigpLCBmYWxzZSlcbiAgICBtYWtlKFwiZHJhd2VyXCIsICgpID0+IERyYXdlcigpLCBmYWxzZSlcbiAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgIC8vIEtPQkVMX0RVTVA9PHdpbmRvdz46IGR1bXAgdGhlIGxpdmUgR1RLIGdlb21ldHJ5IHRyZWUgZm9yIERPTS12cy1HVEsgZGlmZmluZy5cbiAgICBhcm1EdW1wKChuYW1lKSA9PiBBcHAuZ2V0X3dpbmRvdyhuYW1lKSBhcyBhbnkpXG4gIH0sXG4gIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0LCByZXMpIHtcbiAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICBpZiAoY21kID09PSBcInRvZ2dsZVwiKSB7IEFwcC50b2dnbGVfd2luZG93KGFyZyk7IHJldHVybiByZXMoXCJva1wiKSB9XG4gICAgaWYgKGNtZCA9PT0gXCJyZWxvYWQtY3NzXCIpIHsgQXBwLmFwcGx5X2NzcyhzdHlsZSArIHRva2VuQ3NzKHRva2VucyksIHRydWUpOyByZXR1cm4gcmVzKFwib2tcIikgfVxuICAgIHJlcyhcInVua25vd25cIilcbiAgfSxcbn0pXG4iLCAiQGNoYXJzZXQgXCJVVEYtOFwiO1xud2luZG93IHtcbiAgZm9udC1mYW1pbHk6IFwiSW50ZXJcIiwgXCJJbnRlciBWYXJpYWJsZVwiLCBcIkludGVyVmFyaWFibGVcIiwgc2Fucy1zZXJpZjtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLnRuIHtcbiAgZm9udC1mZWF0dXJlLXNldHRpbmdzOiBcInRudW1cIjtcbn1cblxud2luZG93IHtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG59XG5cbmJ1dHRvbiB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXI6IG5vbmU7XG4gIGJveC1zaGFkb3c6IG5vbmU7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zLCBjb2xvciAxNjBtcztcbn1cblxuaW1hZ2Uge1xuICAtZ3RrLWljb24tc3R5bGU6IHJlZ3VsYXI7XG59XG5cbi5iYXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxNHB4O1xuICBwYWRkaW5nOiAwIDdweDtcbiAgbWluLWhlaWdodDogNDJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC50aXRsZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luOiAwIDlweDtcbn1cbi5iYXIgLmNsb2NrIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmJhciAuZGF0ZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLmlidG4ge1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAuaWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuaWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmJhciAuYmNlbnRlciB7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweCAxMnB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG59XG4uYmFyIC5iY2VudGVyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1cyB7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIHBhZGRpbmc6IDAgMTNweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uYmFyIC5zdGF0dXM6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLmJhciAuc3RhdHVzIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmJhciAuc3RhdHVzIC5wY3QgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTNweDtcbn1cbi5iYXIgLnN0YXR1cyBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5iYXIgLnN0YXR1cy5lcnIgLm5ldC1pY29uIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG4uYmFyIC5iYWRnZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogMCAzcHg7XG4gIG1hcmdpbjogMnB4O1xuICBtaW4taGVpZ2h0OiAxNHB4O1xuICBtaW4td2lkdGg6IDhweDtcbn1cbi5iYXIgLnRyYXktaWNvbiB7XG4gIG1pbi13aWR0aDogMjhweDtcbn1cbi5iYXIgLnRyYXktaWNvbiBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5iYXIgLnRyYXktbGFuZyB7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIG1hcmdpbjogMCA4cHg7XG59XG5cbi5kb2NrIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgcGFkZGluZzogNXB4O1xuICBib3JkZXItcmFkaXVzOiAxNnB4O1xufVxuLmRvY2sgLmRidG4ge1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xufVxuLmRvY2sgLmljb24tdGlsZSB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgcGFkZGluZzogNnB4O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDE2MG1zO1xufVxuLmRvY2sgLmRidG46aG92ZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC4wOSk7XG59XG4uZG9jayAucGxhY2Vob2xkZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLmRvY2sgLmRvdHMge1xuICBtYXJnaW4tYm90dG9tOiAzcHg7XG59XG4uZG9jayAuZG90IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWluLXdpZHRoOiA0cHg7XG4gIG1pbi1oZWlnaHQ6IDRweDtcbiAgdHJhbnNpdGlvbjogbWluLXdpZHRoIDI2MG1zIGN1YmljLWJlemllcigwLjI0LCAxLjM2LCAwLjM1LCAxKSwgYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5kb2NrIC5kb3Qub24ge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBtaW4td2lkdGg6IDEycHg7XG59XG4uZG9jayAuZG90Lm1pbmkge1xuICBtaW4td2lkdGg6IDNweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBvcGFjaXR5OiAwLjc7XG59XG4uZG9jayAuc2VwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgbWluLXdpZHRoOiAxcHg7XG4gIG1pbi1oZWlnaHQ6IDMzcHg7XG4gIG1hcmdpbjogMCAzcHg7XG59XG4uZG9jayAuZHRpbGUge1xuICBtaW4td2lkdGg6IDQycHg7XG4gIG1pbi1oZWlnaHQ6IDQycHg7XG59XG4uZG9jayAuZHdpZGdldCAuZGcge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBwYWRkaW5nOiA2cHg7XG59XG4uZG9jayAubXByb2cge1xuICBtaW4td2lkdGg6IDI1cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmRvY2sgLm1wcm9nIHRyb3VnaCB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1pbi1oZWlnaHQ6IDNweDtcbn1cbi5kb2NrIC5tcHJvZyBibG9jay5maWxsZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xufVxuLmRvY2sgLm1wcm9nIGJsb2NrLmVtcHR5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG59XG5cbi5zaGVldCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDEycHg7XG4gIG1hcmdpbjogMzhweDtcbiAgYm94LXNoYWRvdzogMCAxNXB4IDM0cHggcmdiYSg4LCA1LCAxNiwgMC40NSksIDAgMnB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMzUpO1xufVxuXG4ucXMge1xuICBtaW4td2lkdGg6IDMyOHB4O1xufSAvKiBtYXRjaGVzIHBhbmVsVygzNTIpXHUyMjEyMjQ7IG92ZXJyaWRkZW4gYnkgY29uZmlnLnRzIHRva2VuQ3NzIGF0IHJ1bnRpbWUgKi9cbi5xcy10b3Age1xuICBtYXJnaW4tYm90dG9tOiAxMnB4O1xuICBwYWRkaW5nOiAwIDJweDtcbn1cbi5xcy10b3AgLm1ldGEge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucXMtdG9wIC5tZXRhIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG59XG4ucXMtdG9wIC5yYnRuIHtcbiAgcGFkZGluZzogOXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luLWxlZnQ6IDdweDtcbn1cbi5xcy10b3AgLnJidG4gaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTRweDtcbn1cbi5xcy10b3AgLnJidG46aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5xcy10b3AgLnJidG4uZGFuZ2VyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4ucXMtdG9wIC5yYnRuLmxlYWYgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLmNoaXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLWhlaWdodDogNTRweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMjBtcztcbn1cbi5jaGlwIC5jaGlwYiB7XG4gIHBhZGRpbmc6IDlweCA4cHggOXB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xufVxuLmNoaXAgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE3cHg7XG59XG4uY2hpcCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jaGlwIC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIG1hcmdpbi10b3A6IDA7XG59XG4uY2hpcDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uY2hpcC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2hpcC5vbiBpbWFnZSB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gbGFiZWwge1xuICBjb2xvcjogIzE5MjAwMztcbn1cbi5jaGlwLm9uIC5zdWIge1xuICBjb2xvcjogcmdiYSgyNSwgMzIsIDMsIDAuNyk7XG59XG4uY2hpcC5vbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG4uY2hpcC5vbiAuY2hldiB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAgLmNoZXYge1xuICBtaW4td2lkdGg6IDMycHg7XG4gIGJvcmRlci1yYWRpdXM6IDAgOTk5cHggOTk5cHggMDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1sZWZ0OiAxcHggc29saWQgcmdiYSgwLCAwLCAwLCAwLjE4KTtcbn1cbi5jaGlwIC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIGNvbG9yOiBpbmhlcml0O1xufVxuLmNoaXAgLmNoZXY6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDAsIDAsIDAsIDAuMTQpO1xufVxuXG4uY2hpcHMge1xuICBtYXJnaW4tYm90dG9tOiAwO1xufVxuXG4uY2hpcHMgPiBib3g6bGFzdC1jaGlsZCB7XG4gIG1hcmdpbi1yaWdodDogMXB4O1xufVxuXG4uY2hpcC1ncmlkIHtcbiAgbWFyZ2luLWJvdHRvbTogMTBweDtcbn1cblxuc2NhbGUsIHNjYWxlOmhvcml6b250YWwsIHNjYWxlOnZlcnRpY2FsIHtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDZweCAwO1xufVxuXG5zY2FsZSA+IHRyb3VnaCwgc2NhbGU6aG9yaXpvbnRhbCA+IHRyb3VnaCwgc2NhbGU6dmVydGljYWwgPiB0cm91Z2gge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIG1pbi13aWR0aDogMDtcbiAgbWFyZ2luOiAwO1xuICBwYWRkaW5nOiAwO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQsXG5zY2FsZSA+IHRyb3VnaCA+IHByb2dyZXNzIHtcbiAgbWluLWhlaWdodDogNnB4O1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cblxuc2NhbGUgPiB0cm91Z2ggPiBzbGlkZXIge1xuICBtaW4td2lkdGg6IDE3cHg7XG4gIG1pbi1oZWlnaHQ6IDE3cHg7XG4gIG1hcmdpbjogLTZweDsgLyogcHJvdG90eXBlIGtub2IgMTdcdTAwRDcxNyAqL1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2YzZWVmMztcbiAgYm94LXNoYWRvdzogMCAxcHggNHB4IHJnYmEoMCwgMCwgMCwgMC41KTtcbn1cblxuLnNyb3cge1xuICBwYWRkaW5nOiAwIDJweCAwIDJweDtcbiAgbWluLWhlaWdodDogNDJweDtcbn1cblxuLnNyb3cgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMCAtMTJweCAwIDEycHg7XG59XG5cbi5zcm93IC5jaGV2IHtcbiAgcGFkZGluZzogNnB4IDhweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5zcm93IC5jaGV2IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMDtcbn1cbi5zcm93IC5jaGV2OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLmdiYW5uZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbn1cbi5nYmFubmVyIC50IHtcbiAgY29sb3I6ICNlZGJiNjQ7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmdiYW5uZXIgLnMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG59XG4uZ2Jhbm5lciBpbWFnZSB7XG4gIGNvbG9yOiAjZWRiYjY0O1xufVxuXG4uZ2J0biB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGNvbG9yOiAjMTkyMDAzO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDExLjVweDtcbiAgcGFkZGluZzogN3B4IDEycHg7XG59XG4uZ2J0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM5NmFlMzA7XG59XG5cbi5kaGVhZCB7XG4gIHBhZGRpbmctYm90dG9tOiAxMHB4O1xufVxuLmRoZWFkIGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDdweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5kaGVhZCBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5kaGVhZCBsYWJlbCB7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTRweDtcbn1cblxuc3dpdGNoIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG4gIG1pbi13aWR0aDogNDJweDtcbiAgbWluLWhlaWdodDogMjRweDtcbn1cbnN3aXRjaDpjaGVja2VkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbnN3aXRjaCBzbGlkZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiAyMHB4O1xuICBtaW4taGVpZ2h0OiAyMHB4O1xufVxuXG4ueHJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgcGFkZGluZzogOXB4IDExcHg7XG59XG4ueHJvdyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTdweDtcbn1cbi54cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnhyb3cgLnhzIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLnhyb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuLnhyb3cuYWN0aXZlIGltYWdlIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG4ueHJvdy5hY3RpdmUgLnhzIHtcbiAgY29sb3I6ICNiNWNiNDg7XG59XG5cbi5taXhyb3cge1xuICBwYWRkaW5nOiA0cHggMnB4O1xufVxuLm1peHJvdyAubWkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbn1cbi5taXhyb3cgLm1pIGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xufVxuLm1peHJvdyAubW5hbWUge1xuICBmb250LXNpemU6IDEycHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtaW4td2lkdGg6IDcycHg7XG59XG5cbi5zaGVldC5sYXVuY2hlciB7XG4gIG1pbi13aWR0aDogNTUxcHg7XG59XG5cbi5sYXVuY2hlciB7XG4gIHBhZGRpbmc6IDhweDtcbn1cblxuLmZpZWxkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogM3B4IDEycHg7XG4gIG1hcmdpbi1ib3R0b206IDZweDtcbn1cbi5maWVsZCBpbWFnZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbn1cbi5maWVsZCBlbnRyeSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm94LXNoYWRvdzogbm9uZTtcbiAgb3V0bGluZTogbm9uZTtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xuICBjYXJldC1jb2xvcjogI2I1Y2I0ODtcbiAgcGFkZGluZzogOHB4IDA7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIG1pbi13aWR0aDogMDtcbn1cbi5maWVsZCBlbnRyeSB0ZXh0IHtcbiAgbWluLWhlaWdodDogMDtcbn1cbi5maWVsZCAubHBsYWNlaG9sZGVyIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5naG9zdCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDE0LjVweDtcbn1cbi5maWVsZCAua2JkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGJvcmRlci1yYWRpdXM6IDVweDtcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIHBhZGRpbmc6IDNweCA3cHg7XG59XG5cbi50aWxlcyB7XG4gIHBhZGRpbmc6IDhweCAycHggMTBweDtcbn1cblxuLnRpbGUge1xuICBwYWRkaW5nOiA1cHggMDtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgbWluLXdpZHRoOiA2MnB4O1xuICBtYXgtd2lkdGg6IDYycHg7XG59XG4udGlsZSAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAwO1xuICBtaW4taGVpZ2h0OiAwO1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4udGlsZSBsYWJlbCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi50aWxlOmhvdmVyIC5pY29uLXRpbGUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMDkpO1xufVxuLnRpbGU6aG92ZXIgbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbn1cblxuLmxmb290IHtcbiAgcGFkZGluZzogN3B4IDEwcHggM3B4O1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMXB4O1xufVxuLmxmb290IGIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmx3aWRnZXRzIHtcbiAgcGFkZGluZzogMCAycHggNnB4O1xufVxuXG4ud2lkZ2V0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweCAxMnB4O1xufVxuLndpZGdldCBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi53aWRnZXQgLmhpbnQge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xufVxuXG4ubHdtIC5sd2FydCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBtaW4taGVpZ2h0OiAzNHB4O1xufVxuLmx3bSAubHdhcnQgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDExcHg7XG59XG4ubHdtIC5tYnRuIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgbWluLXdpZHRoOiAyOXB4O1xuICBtaW4taGVpZ2h0OiAyOXB4O1xufVxuLmx3bSAubWJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLmx3bSAubWJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5zZWMge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBwYWRkaW5nOiA4cHggMTBweCAycHg7XG59XG5cbi5yb3cge1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA3cHggMTBweDtcbn1cbi5yb3cgLnJpIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiAycHg7XG59XG4ucm93IGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDI0cHg7XG59XG4ucm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxM3B4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLnJvdyAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5yb3cgLnJ1bmsge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMzIyZTM5O1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogMnB4IDdweDtcbn1cbi5yb3c6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLnJvdy5zZWwge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG4uY2FsIHtcbiAgbWluLXdpZHRoOiAzMDlweDtcbn1cbi5jYWwgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbn1cbi5jYWwgLmhlcm8ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxOXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuY2FsaGVybyB7XG4gIHBhZGRpbmc6IDVweCA4cHggOHB4IDhweDtcbn1cbi5jYWwgLmNhbC1ncmlkIHtcbiAgbWFyZ2luLXRvcDogOHB4O1xufVxuLmNhbCAubW9udGgge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxM3B4O1xufVxuLmNhbCAubW9udGg6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b24ge1xuICBwYWRkaW5nOiA2cHggNXB4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmNhbCBjZW50ZXJib3ggPiBidXR0b246aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5jYWwgLmRvdyB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDkuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBwYWRkaW5nOiAzcHggMCA2cHg7XG59XG4uY2FsIC53ayB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5jYWwgLmRheSB7XG4gIGJhY2tncm91bmQ6IG5vbmU7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBtaW4td2lkdGg6IDI0cHg7XG4gIG1pbi1oZWlnaHQ6IDI0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIG1hcmdpbjogMXB4O1xufVxuLmNhbCAuZGF5OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5jYWwgLmRheS53ZSB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLmNhbCAuZGF5Lm91dCB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXdlaWdodDogNDAwO1xufVxuLmNhbCAuZGF5LnRvZGF5IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG59XG4uY2FsIC5kYXkudG9kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuLmNhbCAuZGF5LnNlbDpub3QoLnRvZGF5KSB7XG4gIGJveC1zaGFkb3c6IGluc2V0IDAgMCAwIDEuNXB4ICNiNWFkYmM7XG59XG4uY2FsIC5kYXkudG9kYXkuc2VsIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggIzE5MjAwMztcbn1cbi5jYWwgLmRheSAuZXZkb3Qge1xuICBtaW4td2lkdGg6IDNweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBtYXJnaW4tYm90dG9tOiAycHg7XG59XG4uY2FsIC5kYXkudG9kYXkgLmV2ZG90IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzE5MjAwMztcbn1cbi5jYWwgLmV2Y2FyZCB7XG4gIG1hcmdpbi10b3A6IDEwcHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDEwcHg7XG59XG4uY2FsIC5ldmhlYWQge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIHBhZGRpbmc6IDFweCAzcHggOHB4O1xufVxuLmNhbCAuZXZyb3cge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA4cHggMTBweDtcbiAgbWFyZ2luLWJvdHRvbTogNHB4O1xufVxuLmNhbCAuZXZyb3c6bGFzdC1jaGlsZCB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICM2Mjg5MzM7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLmNhbCAuZXZyb3cgLmV2aWMgaW1hZ2Uge1xuICBjb2xvcjogI2ZmZjtcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4uY2FsIC5ldnJvdyBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5jYWwgLmV2cm93IC5zdWIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5kcmF3ZXIge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbn1cblxuLnRvYXN0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgxNiwgMTMsIDIwLCAwLjgyKTtcbiAgYm9yZGVyLXJhZGl1czogMjBweDtcbiAgcGFkZGluZzogMTFweCAxM3B4O1xuICBib3gtc2hhZG93OiAwIDE4cHggNDBweCByZ2JhKDUsIDMsIDEwLCAwLjQ1KTtcbn1cblxuLm5jYXJkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMjBweDtcbiAgcGFkZGluZzogMTFweCAxMnB4O1xufVxuLm5jYXJkIC5uaWMge1xuICBtaW4td2lkdGg6IDMwcHg7XG4gIG1pbi1oZWlnaHQ6IDMwcHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5uY2FyZCB7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xufVxuLm5jYXJkIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4ubmNhcmQgLmJvZHkge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMS44cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ubmNhcmQgLndoZW4ge1xuICBjb2xvcjogIzhkODY5MztcbiAgZm9udC1zaXplOiAxMHB4O1xufVxuLm5jYXJkIC5ueCB7XG4gIHBhZGRpbmc6IDVweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4ubmNhcmQgLm54OmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgY29sb3I6ICNlZjg2YTA7XG59XG5cbi5uaGVhZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDhweCA4cHggOHB4IDE0cHg7XG4gIG1hcmdpbi1ib3R0b206IDhweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG4ubmhlYWQgbGFiZWwge1xuICBmb250LXNpemU6IDEzLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5uaGVhZCAuc3ViIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNDAwO1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uaGVhZCAubmNsZWFyIHtcbiAgY29sb3I6ICNlZjg2YTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIHBhZGRpbmc6IDRweCA5cHg7XG59XG4ubmhlYWQgLm5jbGVhcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG5cbi5vc2Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgcGFkZGluZzogMTBweCAxNXB4O1xufVxuLm9zZCBpbWFnZSB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5vc2Qgc2NhbGUgPiB0cm91Z2gsIC5vc2Qgc2NhbGUgPiB0cm91Z2ggPiBoaWdobGlnaHQge1xuICBtaW4taGVpZ2h0OiA4cHg7XG59XG4ub3NkIC5zdmFsIHtcbiAgbWluLXdpZHRoOiAzNHB4O1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuXG4uc2Vzc2lvbiB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoOSwgMywgMTQsIDAuOCk7XG59XG4uc2Vzc2lvbiAuc2J0biB7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5zZXNzaW9uIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyNHB4O1xuICBtaW4td2lkdGg6IDU5cHg7XG4gIG1pbi1oZWlnaHQ6IDU5cHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDE4cHggcmdiYSgwLCAwLCAwLCAwLjMpO1xuICBjb2xvcjogI2YzZWVmMztcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAyMDBtcywgY29sb3IgMjAwbXM7XG59XG4uc2Vzc2lvbiAucmVkIC5zaWMge1xuICBjb2xvcjogI2VmODZhMDtcbn1cbi5zZXNzaW9uIC5zYnRuOmhvdmVyIC5zaWMge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBjb2xvcjogI2YzZWVmMztcbn1cbi5zZXNzaW9uIC5yZWQ6aG92ZXIgLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLnNlc3Npb24gbGFiZWwge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgZm9udC1zaXplOiAxMnB4O1xufVxuLnNlc3Npb24gLmNvbmZpcm0gbGFiZWwge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cblxuLmNtZW51IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLmNtZW51IC5jbWkge1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uY21lbnUgLmNtaTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY21lbnUgLmNtaS5kYW5nZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5jbWVudSAuY3NlcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIG1pbi1oZWlnaHQ6IDFweDtcbiAgbWFyZ2luOiA0cHggOHB4O1xufVxuXG4uZHRpcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBwYWRkaW5nOiA2cHggMTFweDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59IiwgIi8vIFRoZSB0b2tlbiBsYXllciBcdTIwMTQgdGhlIHNpbmdsZSBwbGFjZSB0aGUgc2hlbGwncyBnZW9tZXRyeSBjb21lcyBmcm9tLlxuLy8gUHJvdG90eXBlIGVxdWl2YWxlbnQ6IHRoZSBDU1MgY3VzdG9tIHByb3BlcnRpZXMgb24gLmRlc2t0b3AgKDA0YmU3MmUpLlxuLy8gQ2hhbmdlIGEgdmFsdWUgaGVyZSBhbmQgYmFyLCBwYW5lbHMsIGRvY2ssIHNuYXAtYW5jaG9yZWQgc3VyZmFjZXMgYWxsIHJlZmxvdy5cblxuZXhwb3J0IGludGVyZmFjZSBUb2tlbnMge1xuICBiYXJIOiBudW1iZXIgICAgICAvLyBweCBcdTIwMTQgYmFyIGhlaWdodDsgY29udHJvbHMgZGVyaXZlIGZyb20gaXRcbiAgYmFyUjogbnVtYmVyICAgICAgLy8gYmFyIGNvcm5lciByYWRpdXNcbiAgZ2FwOiBudW1iZXIgICAgICAgLy8gc2NyZWVuIGdhcCAoYmFyIHRvcCBvZmZzZXQsIGRvY2sgYm90dG9tIG9mZnNldClcbiAgZWRnZTogbnVtYmVyICAgICAgLy8gc2lkZSBpbnNldHNcbiAgaWNvbjogbnVtYmVyICAgICAgLy8gZG9jay9sYXVuY2hlciBpY29uIHRpbGUgc2l6ZVxuICBkb2NrUGFkOiBudW1iZXIgICAvLyBkb2NrIHBhZGRpbmcgKGNvbmNlbnRyaWMgcmFkaXVzIGRlcml2ZXMpXG4gIHRpbGVIOiBudW1iZXIgICAgIC8vIFFTIHRpbGUgaGVpZ2h0XG4gIHBhbmVsVzogbnVtYmVyICAgIC8vIFFTL25vdGlmaWNhdGlvbnMvdG9hc3RzIHdpZHRoXG4gIGxhdW5jaGVyVzogbnVtYmVyXG4gIGNhbGVuZGFyVzogbnVtYmVyXG59XG5cbmV4cG9ydCBjb25zdCBmbG9hdGluZzogVG9rZW5zID0ge1xuICBiYXJIOiA0MiwgYmFyUjogMTQsIGdhcDogMTAsIGVkZ2U6IDEyLFxuICBpY29uOiA0NCwgZG9ja1BhZDogNSwgdGlsZUg6IDU0LFxuICBwYW5lbFc6IDM1MiwgbGF1bmNoZXJXOiA1NjAsIGNhbGVuZGFyVzogMzMwLFxufVxuXG4vLyBnYXBsZXNzID0gYSB0b2tlbiBwcmVzZXQsIGV4YWN0bHkgbGlrZSB0aGUgcHJvdG90eXBlJ3MgLmdhcGxlc3MgY2xhc3NcbmV4cG9ydCBjb25zdCBnYXBsZXNzOiBUb2tlbnMgPSB7XG4gIC4uLmZsb2F0aW5nLCBiYXJIOiAzOCwgYmFyUjogMCwgZ2FwOiAwLCBlZGdlOiAwLFxufVxuXG5leHBvcnQgbGV0IHRva2VuczogVG9rZW5zID0gZmxvYXRpbmdcblxuZXhwb3J0IGNvbnN0IGN0bCA9ICgpID0+IHRva2Vucy5iYXJIIC0gMTEgICAgICAgICAgICAgIC8vIGJhciBjb250cm9sIHNpemVcbmV4cG9ydCBjb25zdCBwYW5lbFRvcCA9ICgpID0+IHRva2Vucy5nYXAgKyB0b2tlbnMuYmFySCArIDZcblxuLy8gR1RLIENTUyBjYW4ndCBjYWxjKCkgZnJvbSBKUyBzdGF0ZTsgd2UgcmVnZW5lcmF0ZSBhIDpyb290LWlzaCBibG9jayBhbmRcbi8vIGxldCBBcHAuYXBwbHlfY3NzIHJlLXNraW4gbGl2ZSAodGhlIFwiYmFyIDQyIGN5Y2xlclwiIG9mIHRoZSBRTUwvQUdTIHdvcmxkKS5cbmV4cG9ydCBmdW5jdGlvbiB0b2tlbkNzcyh0OiBUb2tlbnMgPSB0b2tlbnMpOiBzdHJpbmcge1xuICByZXR1cm4gYFxuICAuYmFyIHsgbWluLWhlaWdodDogJHt0LmJhckh9cHg7IGJvcmRlci1yYWRpdXM6ICR7dC5iYXJSfXB4O1xuICAgICAgICAgbWFyZ2luOiAwOyB9XG4gIC5iYXIgYnV0dG9uIHsgbWluLXdpZHRoOiAke2N0bCgpfXB4OyBtaW4taGVpZ2h0OiAke2N0bCgpfXB4OyB9XG4gIC5kb2NrIHsgcGFkZGluZzogJHt0LmRvY2tQYWR9cHg7IGJvcmRlci1yYWRpdXM6ICR7MTIgKyB0LmRvY2tQYWQgLSAxfXB4O1xuICAgICAgICAgIG1hcmdpbi1ib3R0b206ICR7dC5nYXB9cHg7IH1cbiAgLmljb24tdGlsZSB7IG1pbi13aWR0aDogJHt0Lmljb259cHg7IG1pbi1oZWlnaHQ6ICR7dC5pY29ufXB4OyB9XG4gIC5xcywgLmRyYXdlciwgLmNhbGVuZGFyIHsgbWFyZ2luLXRvcDogJHtwYW5lbFRvcCgpfXB4OyB9XG4gIC5xcyB7IG1pbi13aWR0aDogJHt0LnBhbmVsVyAtIDI0fXB4OyB9ICAvKiBwYW5lbFcgaXMgb3V0ZXI7IHN1YnRyYWN0IC5zaGVldCBwYWRkaW5nIDEycHhcdTAwRDcyICovXG4gIC5sYXVuY2hlciB7IG1pbi13aWR0aDogJHt0LmxhdW5jaGVyV31weDsgfVxuICAuY2FsZW5kYXIgeyBtaW4td2lkdGg6ICR7dC5jYWxlbmRhcld9cHg7IH1cbiAgLmNoaXAgeyBtaW4taGVpZ2h0OiAke3QudGlsZUh9cHg7IH1cbiAgYFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2V0VG9rZW5zKG5leHQ6IFBhcnRpYWw8VG9rZW5zPiwgYXBwbHk6IChjc3M6IHN0cmluZykgPT4gdm9pZCkge1xuICB0b2tlbnMgPSB7IC4uLnRva2VucywgLi4ubmV4dCB9XG4gIGFwcGx5KHRva2VuQ3NzKHRva2VucykpXG59XG4iLCAiLy8gb3JnLmdub2JsaW4uU2hlbGwgXHUyMDE0IHRoZSBjb21wb3NpdG9yIGxpbmsuIERyaXZlczogc29mdC1yZWxvYWQsIGZlYXR1cmUgdG9nZ2xlcyxcbi8vIHRoZSBXSU5ET1cgTElTVCB0aGF0IG1ha2VzIHRoZSBkb2NrIHRydXRoZnVsLCBhbmQgdGhlIGNvbm5lY3RlZC9hbWJlciBzdGF0ZS5cbi8vIFByb3RvdHlwZTogc2VydmljZXMgJ2dub2InIGJhbm5lciArIGJhciBhbWJlciBzZWdtZW50ICsgV00gaW50ZWdyYXRpb24uXG5cbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuaW1wb3J0IHsgVmFyaWFibGUgfSBmcm9tIFwiYXN0YWxcIlxuXG5jb25zdCBCVVMgPSBcIm9yZy5nbm9ibGluLlNoZWxsXCJcbmNvbnN0IFBBVEggPSBcIi9vcmcvZ25vYmxpbi9TaGVsbFwiXG5jb25zdCBJRkFDRSA9IFwib3JnLmdub2JsaW4uU2hlbGxcIlxuXG5leHBvcnQgaW50ZXJmYWNlIEdub2JsaW5XaW5kb3cge1xuICBpZDogc3RyaW5nXG4gIGFwcElkOiBzdHJpbmdcbiAgdGl0bGU6IHN0cmluZ1xuICBmb2N1c2VkOiBib29sZWFuXG4gIG1pbmltaXplZDogYm9vbGVhblxufVxuXG5leHBvcnQgY29uc3QgY29ubmVjdGVkID0gVmFyaWFibGUoZmFsc2UpXG5leHBvcnQgY29uc3Qgd2luZG93cyA9IFZhcmlhYmxlPEdub2JsaW5XaW5kb3dbXT4oW10pXG5cbmxldCBwcm94eTogR2lvLkRCdXNQcm94eSB8IG51bGwgPSBudWxsXG5cbmZ1bmN0aW9uIGNhbGwobWV0aG9kOiBzdHJpbmcsIHBhcmFtczogR0xpYi5WYXJpYW50IHwgbnVsbCA9IG51bGwpOiBQcm9taXNlPEdMaWIuVmFyaWFudCB8IG51bGw+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXMsIHJlaikgPT4ge1xuICAgIGlmICghcHJveHkpIHJldHVybiByZWoobmV3IEVycm9yKFwiZ25vYmxpbjogbm90IGNvbm5lY3RlZFwiKSlcbiAgICBwcm94eS5jYWxsKG1ldGhvZCwgcGFyYW1zLCBHaW8uREJ1c0NhbGxGbGFncy5OT05FLCAyMDAwLCBudWxsLCAoXywgcikgPT4ge1xuICAgICAgdHJ5IHsgcmVzKHByb3h5IS5jYWxsX2ZpbmlzaChyKSkgfSBjYXRjaCAoZSkgeyByZWooZSkgfVxuICAgIH0pXG4gIH0pXG59XG5cbmV4cG9ydCBjb25zdCByZWxvYWQgPSAoKSA9PiBjYWxsKFwiUmVsb2FkXCIpXG5leHBvcnQgY29uc3Qgc2V0RmVhdHVyZSA9IChuYW1lOiBzdHJpbmcsIG9uOiBib29sZWFuKSA9PlxuICBjYWxsKFwiU2V0RmVhdHVyZVwiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHNiKVwiLCBbbmFtZSwgb25dKSlcblxuLy8gV2luZG93IHZlcmJzICh0aGUgZG9jayBjbGljayBtb2RlbClcbmV4cG9ydCBjb25zdCBhY3RpdmF0ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiQWN0aXZhdGVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcbmV4cG9ydCBjb25zdCBtaW5pbWl6ZSA9IChpZDogc3RyaW5nKSA9PiBjYWxsKFwiTWluaW1pemVXaW5kb3dcIiwgbmV3IEdMaWIuVmFyaWFudChcIihzKVwiLCBbaWRdKSlcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hXaW5kb3dzKCkge1xuICB0cnkge1xuICAgIGNvbnN0IHYgPSBhd2FpdCBjYWxsKFwiTGlzdFdpbmRvd3NcIilcbiAgICBpZiAoIXYpIHJldHVyblxuICAgIGNvbnN0IFtsaXN0XSA9IHYuZGVlcF91bnBhY2soKSBhcyBbR25vYmxpbldpbmRvd1tdXVxuICAgIHdpbmRvd3Muc2V0KGxpc3QpXG4gIH0gY2F0Y2ggeyAvKiBzdGF5IG9uIGxhc3Qta25vd24gbGlzdDsgY29ubmVjdGVkIGZsYWcgY2FycmllcyB0aGUgdHJ1dGggKi8gfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwV2luZG93cyhhcHBJZDogc3RyaW5nKTogR25vYmxpbldpbmRvd1tdIHtcbiAgcmV0dXJuIHdpbmRvd3MuZ2V0KCkuZmlsdGVyKHcgPT4gdy5hcHBJZCA9PT0gYXBwSWQpXG59XG5cbi8vIEN5Y2xlID0gdGhlIGRvY2sgY2Fyb3VzZWw6IGZvY3VzIHRoZSBuZXh0IHdpbmRvdyBvZiB0aGUgYXBwXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3ljbGUoYXBwSWQ6IHN0cmluZywgZGlyOiAxIHwgLTEpIHtcbiAgY29uc3Qgd3MgPSBhcHBXaW5kb3dzKGFwcElkKVxuICBpZiAod3MubGVuZ3RoIDwgMikgcmV0dXJuXG4gIGNvbnN0IGkgPSB3cy5maW5kSW5kZXgodyA9PiB3LmZvY3VzZWQpXG4gIGF3YWl0IGFjdGl2YXRlKHdzWygoaSA8IDAgPyAwIDogaSkgKyBkaXIgKyB3cy5sZW5ndGgpICUgd3MubGVuZ3RoXS5pZClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gIEdpby5idXNfd2F0Y2hfbmFtZShcbiAgICBHaW8uQnVzVHlwZS5TRVNTSU9OLCBCVVMsIEdpby5CdXNOYW1lV2F0Y2hlckZsYWdzLk5PTkUsXG4gICAgKCkgPT4geyAgLy8gYXBwZWFyZWRcbiAgICAgIEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXMoXG4gICAgICAgIEdpby5CdXNUeXBlLlNFU1NJT04sIEdpby5EQnVzUHJveHlGbGFncy5OT05FLCBudWxsLFxuICAgICAgICBCVVMsIFBBVEgsIElGQUNFLCBudWxsLFxuICAgICAgICAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgcHJveHkgPSBHaW8uREJ1c1Byb3h5Lm5ld19mb3JfYnVzX2ZpbmlzaChyZXMpXG4gICAgICAgICAgcHJveHkuY29ubmVjdChcImctc2lnbmFsXCIsIChfcCwgX3MsIHNpZykgPT4ge1xuICAgICAgICAgICAgaWYgKHNpZyA9PT0gXCJXaW5kb3dzQ2hhbmdlZFwiKSByZWZyZXNoV2luZG93cygpXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb25uZWN0ZWQuc2V0KHRydWUpXG4gICAgICAgICAgcmVmcmVzaFdpbmRvd3MoKVxuICAgICAgICB9KVxuICAgIH0sXG4gICAgKCkgPT4geyAgLy8gdmFuaXNoZWQgXHUyMTkyIGFtYmVyIGV2ZXJ5d2hlcmUgdGhhdCBsaXN0ZW5zXG4gICAgICBwcm94eSA9IG51bGxcbiAgICAgIGNvbm5lY3RlZC5zZXQoZmFsc2UpXG4gICAgfSlcbn1cbiIsICJpbXBvcnQgXCIuL292ZXJyaWRlcy5qc1wiXG5leHBvcnQgeyBkZWZhdWx0IGFzIEFzdGFsSU8gfSBmcm9tIFwiZ2k6Ly9Bc3RhbElPP3ZlcnNpb249MC4xXCJcbmV4cG9ydCAqIGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vdGltZS5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi9maWxlLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL2dvYmplY3QuanNcIlxuZXhwb3J0IHsgQmluZGluZywgYmluZCB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuZXhwb3J0IHsgVmFyaWFibGUsIGRlcml2ZSB9IGZyb20gXCIuL3ZhcmlhYmxlLmpzXCJcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpbz92ZXJzaW9uPTIuMFwiXG5cbmV4cG9ydCB7IEdpbyB9XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkRmlsZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBBc3RhbC5yZWFkX2ZpbGUocGF0aCkgfHwgXCJcIlxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVhZEZpbGVBc3luYyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIEFzdGFsLnJlYWRfZmlsZV9hc3luYyhwYXRoLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwucmVhZF9maWxlX2ZpbmlzaChyZXMpIHx8IFwiXCIpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgY29udGVudDogc3RyaW5nKTogdm9pZCB7XG4gICAgQXN0YWwud3JpdGVfZmlsZShwYXRoLCBjb250ZW50KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVGaWxlQXN5bmMocGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBBc3RhbC53cml0ZV9maWxlX2FzeW5jKHBhdGgsIGNvbnRlbnQsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC53cml0ZV9maWxlX2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgfSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1vbml0b3JGaWxlKFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBjYWxsYmFjazogKGZpbGU6IHN0cmluZywgZXZlbnQ6IEdpby5GaWxlTW9uaXRvckV2ZW50KSA9PiB2b2lkLFxuKTogR2lvLkZpbGVNb25pdG9yIHtcbiAgICByZXR1cm4gQXN0YWwubW9uaXRvcl9maWxlKHBhdGgsIChmaWxlOiBzdHJpbmcsIGV2ZW50OiBHaW8uRmlsZU1vbml0b3JFdmVudCkgPT4ge1xuICAgICAgICBjYWxsYmFjayhmaWxlLCBldmVudClcbiAgICB9KSFcbn1cbiIsICJpbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcblxuZXhwb3J0IHsgZGVmYXVsdCBhcyBHTGliIH0gZnJvbSBcImdpOi8vR0xpYj92ZXJzaW9uPTIuMFwiXG5leHBvcnQgeyBHT2JqZWN0LCBHT2JqZWN0IGFzIGRlZmF1bHQgfVxuXG5jb25zdCBtZXRhID0gU3ltYm9sKFwibWV0YVwiKVxuY29uc3QgcHJpdiA9IFN5bWJvbChcInByaXZcIilcblxuY29uc3QgeyBQYXJhbVNwZWMsIFBhcmFtRmxhZ3MgfSA9IEdPYmplY3RcblxuY29uc3Qga2ViYWJpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxLSQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJfXCIsIFwiLVwiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbnR5cGUgU2lnbmFsRGVjbGFyYXRpb24gPSB7XG4gICAgZmxhZ3M/OiBHT2JqZWN0LlNpZ25hbEZsYWdzXG4gICAgYWNjdW11bGF0b3I/OiBHT2JqZWN0LkFjY3VtdWxhdG9yVHlwZVxuICAgIHJldHVybl90eXBlPzogR09iamVjdC5HVHlwZVxuICAgIHBhcmFtX3R5cGVzPzogQXJyYXk8R09iamVjdC5HVHlwZT5cbn1cblxudHlwZSBQcm9wZXJ0eURlY2xhcmF0aW9uID1cbiAgICB8IEluc3RhbmNlVHlwZTx0eXBlb2YgR09iamVjdC5QYXJhbVNwZWM+XG4gICAgfCB7ICRndHlwZTogR09iamVjdC5HVHlwZSB9XG4gICAgfCB0eXBlb2YgU3RyaW5nXG4gICAgfCB0eXBlb2YgTnVtYmVyXG4gICAgfCB0eXBlb2YgQm9vbGVhblxuICAgIHwgdHlwZW9mIE9iamVjdFxuXG50eXBlIEdPYmplY3RDb25zdHJ1Y3RvciA9IHtcbiAgICBbbWV0YV0/OiB7XG4gICAgICAgIFByb3BlcnRpZXM/OiB7IFtrZXk6IHN0cmluZ106IEdPYmplY3QuUGFyYW1TcGVjIH1cbiAgICAgICAgU2lnbmFscz86IHsgW2tleTogc3RyaW5nXTogR09iamVjdC5TaWduYWxEZWZpbml0aW9uIH1cbiAgICB9XG4gICAgbmV3KC4uLmFyZ3M6IGFueVtdKTogYW55XG59XG5cbnR5cGUgTWV0YUluZm8gPSBHT2JqZWN0Lk1ldGFJbmZvPG5ldmVyLCBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9PiwgbmV2ZXI+XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlcihvcHRpb25zOiBNZXRhSW5mbyA9IHt9KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChjbHM6IEdPYmplY3RDb25zdHJ1Y3Rvcikge1xuICAgICAgICBjb25zdCB0ID0gb3B0aW9ucy5UZW1wbGF0ZVxuICAgICAgICBpZiAodHlwZW9mIHQgPT09IFwic3RyaW5nXCIgJiYgIXQuc3RhcnRzV2l0aChcInJlc291cmNlOi8vXCIpICYmICF0LnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpKSB7XG4gICAgICAgICAgICAvLyBhc3N1bWUgeG1sIHRlbXBsYXRlXG4gICAgICAgICAgICBvcHRpb25zLlRlbXBsYXRlID0gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHQpXG4gICAgICAgIH1cblxuICAgICAgICBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3Moe1xuICAgICAgICAgICAgU2lnbmFsczogeyAuLi5jbHNbbWV0YV0/LlNpZ25hbHMgfSxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHsgLi4uY2xzW21ldGFdPy5Qcm9wZXJ0aWVzIH0sXG4gICAgICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB9LCBjbHMpXG5cbiAgICAgICAgZGVsZXRlIGNsc1ttZXRhXVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHByb3BlcnR5KGRlY2xhcmF0aW9uOiBQcm9wZXJ0eURlY2xhcmF0aW9uID0gT2JqZWN0KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgcHJvcDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSB7XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXSA/Pz0ge31cbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlByb3BlcnRpZXMgPz89IHt9XG5cbiAgICAgICAgY29uc3QgbmFtZSA9IGtlYmFiaWZ5KHByb3ApXG5cbiAgICAgICAgaWYgKCFkZXNjKSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBwcm9wLCB7XG4gICAgICAgICAgICAgICAgZ2V0KCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1twcml2XT8uW3Byb3BdID8/IGRlZmF1bHRWYWx1ZShkZWNsYXJhdGlvbilcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHNldCh2OiBhbnkpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHYgIT09IHRoaXNbcHJvcF0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJpdl0gPz89IHt9XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzW3ByaXZdW3Byb3BdID0gdlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5ub3RpZnkobmFtZSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgc2V0XyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlKHY6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzW3Byb3BdID0gdlxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgZ2V0XyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpc1twcm9wXVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllc1trZWJhYmlmeShwcm9wKV0gPSBwc3BlYyhuYW1lLCBQYXJhbUZsYWdzLlJFQURXUklURSwgZGVjbGFyYXRpb24pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBsZXQgZmxhZ3MgPSAwXG4gICAgICAgICAgICBpZiAoZGVzYy5nZXQpIGZsYWdzIHw9IFBhcmFtRmxhZ3MuUkVBREFCTEVcbiAgICAgICAgICAgIGlmIChkZXNjLnNldCkgZmxhZ3MgfD0gUGFyYW1GbGFncy5XUklUQUJMRVxuXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllc1trZWJhYmlmeShwcm9wKV0gPSBwc3BlYyhuYW1lLCBmbGFncywgZGVjbGFyYXRpb24pXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoLi4ucGFyYW1zOiBBcnJheTx7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdD4pOlxuKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikgPT4gdm9pZFxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKGRlY2xhcmF0aW9uPzogU2lnbmFsRGVjbGFyYXRpb24pOlxuKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikgPT4gdm9pZFxuXG5leHBvcnQgZnVuY3Rpb24gc2lnbmFsKFxuICAgIGRlY2xhcmF0aW9uPzogU2lnbmFsRGVjbGFyYXRpb24gfCB7ICRndHlwZTogR09iamVjdC5HVHlwZSB9IHwgdHlwZW9mIE9iamVjdCxcbiAgICAuLi5wYXJhbXM6IEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0PlxuKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICh0YXJnZXQ6IGFueSwgc2lnbmFsOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpIHtcbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdID8/PSB7fVxuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFscyA/Pz0ge31cblxuICAgICAgICBjb25zdCBuYW1lID0ga2ViYWJpZnkoc2lnbmFsKVxuXG4gICAgICAgIGlmIChkZWNsYXJhdGlvbiB8fCBwYXJhbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBUT0RPOiB0eXBlIGFzc2VydFxuICAgICAgICAgICAgY29uc3QgYXJyID0gW2RlY2xhcmF0aW9uLCAuLi5wYXJhbXNdLm1hcCh2ID0+IHYuJGd0eXBlKVxuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHNbbmFtZV0gPSB7XG4gICAgICAgICAgICAgICAgcGFyYW1fdHlwZXM6IGFycixcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzW25hbWVdID0gZGVjbGFyYXRpb24gfHwge1xuICAgICAgICAgICAgICAgIHBhcmFtX3R5cGVzOiBbXSxcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZGVzYykge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgc2lnbmFsLCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXQobmFtZSwgLi4uYXJncylcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IG9nOiAoKC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkKSA9IGRlc2MudmFsdWVcbiAgICAgICAgICAgIGRlc2MudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG5vdCB0eXBlZFxuICAgICAgICAgICAgICAgIHRoaXMuZW1pdChuYW1lLCAuLi5hcmdzKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgYG9uXyR7bmFtZS5yZXBsYWNlKFwiLVwiLCBcIl9cIil9YCwge1xuICAgICAgICAgICAgICAgIHZhbHVlOiBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG9nLmFwcGx5KHRoaXMsIGFyZ3MpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbiAgICB9XG59XG5cbmZ1bmN0aW9uIHBzcGVjKG5hbWU6IHN0cmluZywgZmxhZ3M6IG51bWJlciwgZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24pIHtcbiAgICBpZiAoZGVjbGFyYXRpb24gaW5zdGFuY2VvZiBQYXJhbVNwZWMpXG4gICAgICAgIHJldHVybiBkZWNsYXJhdGlvblxuXG4gICAgc3dpdGNoIChkZWNsYXJhdGlvbikge1xuICAgICAgICBjYXNlIFN0cmluZzpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuc3RyaW5nKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBcIlwiKVxuICAgICAgICBjYXNlIE51bWJlcjpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuZG91YmxlKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCAtTnVtYmVyLk1BWF9WQUxVRSwgTnVtYmVyLk1BWF9WQUxVRSwgMClcbiAgICAgICAgY2FzZSBCb29sZWFuOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5ib29sZWFuKG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBmYWxzZSlcbiAgICAgICAgY2FzZSBPYmplY3Q6XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmpzb2JqZWN0KG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzKVxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBtaXNzdHlwZWRcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMub2JqZWN0KG5hbWUsIFwiXCIsIFwiXCIsIGZsYWdzLCBkZWNsYXJhdGlvbi4kZ3R5cGUpXG4gICAgfVxufVxuXG5mdW5jdGlvbiBkZWZhdWx0VmFsdWUoZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24pIHtcbiAgICBpZiAoZGVjbGFyYXRpb24gaW5zdGFuY2VvZiBQYXJhbVNwZWMpXG4gICAgICAgIHJldHVybiBkZWNsYXJhdGlvbi5nZXRfZGVmYXVsdF92YWx1ZSgpXG5cbiAgICBzd2l0Y2ggKGRlY2xhcmF0aW9uKSB7XG4gICAgICAgIGNhc2UgU3RyaW5nOlxuICAgICAgICAgICAgcmV0dXJuIFwiXCJcbiAgICAgICAgY2FzZSBOdW1iZXI6XG4gICAgICAgICAgICByZXR1cm4gMFxuICAgICAgICBjYXNlIEJvb2xlYW46XG4gICAgICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgICAgY2FzZSBPYmplY3Q6XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuICAgIH1cbn1cbiIsICIvLyBEZWZlcnJlZCwgbm9uLWJsb2NraW5nIEFzdGFsTm90aWZkIGFjY2Vzcy4gZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYSBoZWFkbGVzcyBvclxuLy8gY29udGVuZGVkIHNlc3Npb24gYnVzIChpdCB0cmllcyB0byBiZWNvbWUgb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnMgYW5kIHdhaXRzKSxcbi8vIHNvIHdlIE5FVkVSIHRvdWNoIGl0IGR1cmluZyB3aWRnZXQgY29uc3RydWN0aW9uLiBpbml0KCkgaXMgY2FsbGVkIG9uY2UgZnJvbSBhbiBpZGxlXG4vLyBhZnRlciB0aGUgc2hlbGwgaXMgbWFwcGVkOyBvbiByZWFsIGhhcmR3YXJlIGl0IHJldHVybnMgZmFzdCwgaW4gdGhlIHN0cmlwcGVkIGRldmtpdFxuLy8gaXQgbWF5IG5vLW9wLiBXaWRnZXRzIGJpbmQgdG8gYHVucmVhZGAvYGxpc3RgIGFuZCBoeWRyYXRlIHdoZW4gaXQgbGFuZHMuXG5pbXBvcnQgeyBWYXJpYWJsZSwgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgR0xpYiBmcm9tIFwiZ2k6Ly9HTGliXCJcbi8vIEltcG9ydGluZyB0aGUgdHlwZWxpYiBpcyBjaGVhcCArIG5vbi1ibG9ja2luZzsgb25seSBnZXRfZGVmYXVsdCgpIG1heSBibG9jayAoaXQgdHJpZXNcbi8vIHRvIGJlY29tZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyksIHNvIHdlIGNhbGwgVEhBVCBsYXppbHkgZnJvbSBhbiBpZGxlLiBUaGUgb2xkXG4vLyBgaW1wb3J0cy5naS5Bc3RhbE5vdGlmZGAgdGhyb3dzIHVuZGVyIGBnanMgLW1gIChFU00gaGFzIG5vIGxlZ2FjeSBgaW1wb3J0c2AgZ2xvYmFsKS5cbmltcG9ydCBOb3RpZmQgZnJvbSBcImdpOi8vQXN0YWxOb3RpZmRcIlxuXG5leHBvcnQgY29uc3QgdW5yZWFkID0gVmFyaWFibGUoMClcbmV4cG9ydCBjb25zdCByZWFkeSA9IFZhcmlhYmxlKGZhbHNlKVxubGV0IG46IE5vdGlmZC5Ob3RpZmQgfCBudWxsID0gbnVsbFxuXG5leHBvcnQgZnVuY3Rpb24gbm90aWZkKCkgeyByZXR1cm4gbiB9XG5cbmV4cG9ydCBmdW5jdGlvbiBpbml0KCkge1xuICAvLyBnZXRlbnYgcmV0dXJucyBcIlwiIChmYWxzeSkgd2hlbiB0aGUgdmFyIGlzIHNldC1idXQtZW1wdHksIG51bGwgd2hlbiB1bnNldCBcdTIwMTQgYm90aCBza2lwXG4gIC8vIGNvcnJlY3RseSBvbmx5IHdoZW4gdGhlIHZhbHVlIGlzIHRydXRoeSAoXCIxXCIpLlxuICBpZiAoR0xpYi5nZXRlbnYoXCJLT0JFTF9TS0lQX05PVElGRFwiKSkgcmV0dXJuXG4gIC8vIGRlZmVyIHBhc3QgZmlyc3QgcGFpbnQ7IGlmIGdldF9kZWZhdWx0IGJsb2NrcywgaXQgYmxvY2tzIG9ubHkgdGhpcyBpZGxlIHRpY2ssXG4gIC8vIG5ldmVyIGNvbnN0cnVjdGlvbi9maXJzdCByZW5kZXIuXG4gIHRpbWVvdXQoNTAsICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgbiA9IE5vdGlmZC5nZXRfZGVmYXVsdCgpXG4gICAgICByZWFkeS5zZXQodHJ1ZSlcbiAgICAgIGNvbnN0IHN5bmMgPSAoKSA9PiB1bnJlYWQuc2V0KG4hLm5vdGlmaWNhdGlvbnMubGVuZ3RoKVxuICAgICAgbi5jb25uZWN0KFwibm90aWZpZWRcIiwgc3luYyk7IG4uY29ubmVjdChcInJlc29sdmVkXCIsIHN5bmMpOyBzeW5jKClcbiAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogbm90aWZkIGluaXQgc2tpcHBlZDogJHtlfWApIH1cbiAgfSlcbn1cbiIsICIvLyBHVEsgd2lkZ2V0LXRyZWUgZ2VvbWV0cnkgZHVtcGVyIFx1MjAxNCB0aGUgbWlycm9yIG9mIHRoZSBET00ncyBnZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5cbi8vIFdhbGtzIGEgbWFwcGVkIHdpbmRvdyBhbmQgcmVjb3JkcyBldmVyeSB3aWRnZXQncyByZWFsIGFsbG9jYXRpb24gKHgveS93L2ggcmVsYXRpdmVcbi8vIHRvIHRoZSB3aW5kb3cgY29udGVudCkgKyBDU1MgY2xhc3NlcyArIHRleHQsIHNvIGEgcmVuZGVyZWQgR1RLIHN1cmZhY2UgY2FuIGJlIGRpZmZlZFxuLy8gMToxIGFnYWluc3QgdGhlIHByb3RvdHlwZSBET00uIEdhdGVkIGJ5IEtPQkVMX0RVTVA9PHdpbmRvdz4gaW4gYXBwLnRzLlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEdyYXBoZW5lIGZyb20gXCJnaTovL0dyYXBoZW5lXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE5vZGUge1xuICBkOiBudW1iZXI7IHR5cGU6IHN0cmluZzsgY2xzOiBzdHJpbmdcbiAgeDogbnVtYmVyOyB5OiBudW1iZXI7IHc6IG51bWJlcjsgaDogbnVtYmVyOyB0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGR1bXBXaW5kb3cod2luOiBHdGsuV2luZG93KTogTm9kZVtdIHtcbiAgY29uc3Qgb3V0OiBOb2RlW10gPSBbXVxuICBjb25zdCByb290OiBhbnkgPSB3aW5cbiAgY29uc3Qgd2FsayA9ICh3OiBhbnksIGRlcHRoOiBudW1iZXIpID0+IHtcbiAgICAvLyBjb21wdXRlX2JvdW5kcyBnaXZlcyB0aGUgd2lkZ2V0J3MgRlVMTCByZW5kZXJlZCByZWN0IChpbmNsLiBpdHMgb3duIHBhZGRpbmcpIGluXG4gICAgLy8gdGhlIHJvb3QncyBjb29yZHMgXHUyMDE0IG1vcmUgcmVsaWFibGUgdGhhbiBjb21wdXRlX3BvaW50ICsgZ2V0X3dpZHRoICh3aGljaCBjYW4gcmVwb3J0XG4gICAgLy8gdGhlIGNoaWxkL2NvbnRlbnQgc2l6ZSBmb3IgcGFkZGVkIGJ1dHRvbnMpLlxuICAgIGxldCB4ID0gMCwgeSA9IDAsIHdpZHRoID0gMCwgaGVpZ2h0ID0gMFxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSB3LmNvbXB1dGVfYm91bmRzKHJvb3QpXG4gICAgICBjb25zdCByZWN0ID0gQXJyYXkuaXNBcnJheShyZXMpID8gcmVzWzFdIDogcmVzXG4gICAgICBpZiAocmVjdCkge1xuICAgICAgICB4ID0gcmVjdC5vcmlnaW4ueDsgeSA9IHJlY3Qub3JpZ2luLnlcbiAgICAgICAgd2lkdGggPSByZWN0LnNpemUud2lkdGg7IGhlaWdodCA9IHJlY3Quc2l6ZS5oZWlnaHRcbiAgICAgIH1cbiAgICB9IGNhdGNoIHsgfVxuICAgIGlmICghd2lkdGgpIHsgd2lkdGggPSB3LmdldF93aWR0aD8uKCkgPz8gMDsgaGVpZ2h0ID0gdy5nZXRfaGVpZ2h0Py4oKSA/PyAwIH1cbiAgICBjb25zdCBjbHMgPSAody5nZXRfY3NzX2NsYXNzZXM/LigpID8/IFtdKS5qb2luKFwiLlwiKVxuICAgIGNvbnN0IHR5cGUgPSAody5jb25zdHJ1Y3Rvcj8ubmFtZSA/PyBcIj9cIikucmVwbGFjZSgvXy9nLCBcIlwiKVxuICAgIGxldCB0ID0gXCJcIlxuICAgIHRyeSB7IHQgPSAody5nZXRfbGFiZWw/LigpID8/IHcuZ2V0X3RleHQ/LigpID8/IFwiXCIpLnRvU3RyaW5nKCkuc2xpY2UoMCwgMjgpIH0gY2F0Y2ggeyB9XG4gICAgb3V0LnB1c2goe1xuICAgICAgZDogZGVwdGgsIHR5cGUsIGNscyxcbiAgICAgIHg6IE1hdGgucm91bmQoeCksIHk6IE1hdGgucm91bmQoeSksXG4gICAgICB3OiBNYXRoLnJvdW5kKHdpZHRoKSwgaDogTWF0aC5yb3VuZChoZWlnaHQpLCB0LFxuICAgIH0pXG4gICAgbGV0IGMgPSB3LmdldF9maXJzdF9jaGlsZD8uKClcbiAgICB3aGlsZSAoYykgeyB3YWxrKGMsIGRlcHRoICsgMSk7IGMgPSBjLmdldF9uZXh0X3NpYmxpbmcoKSB9XG4gIH1cbiAgY29uc3QgY2hpbGQgPSB3aW4uZ2V0X2NoaWxkPy4oKVxuICBpZiAoY2hpbGQpIHdhbGsoY2hpbGQsIDApXG4gIHJldHVybiBvdXRcbn1cblxuLy8gUG9sbCB1bnRpbCB0aGUgbmFtZWQgd2luZG93IGlzIHZpc2libGUgKyBsYWlkIG91dCwgdGhlbiBkdW1wIG9uY2UgdG8gS09CRUxfRFVNUF9PVVQuXG5leHBvcnQgZnVuY3Rpb24gYXJtRHVtcChnZXRXaW5kb3c6IChuYW1lOiBzdHJpbmcpID0+IEd0ay5XaW5kb3cgfCBudWxsKSB7XG4gIGNvbnN0IG5hbWUgPSBHTGliLmdldGVudihcIktPQkVMX0RVTVBcIilcbiAgaWYgKCFuYW1lKSByZXR1cm5cbiAgY29uc3QgcGF0aCA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUF9PVVRcIikgfHwgXCIvdG1wL2tvYmVsLWR1bXAuanNvblwiXG4gIGxldCBkb25lID0gZmFsc2VcbiAgR0xpYi50aW1lb3V0X2FkZChHTGliLlBSSU9SSVRZX0RFRkFVTFQsIDQwMCwgKCkgPT4ge1xuICAgIGlmIChkb25lKSByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgY29uc3QgdyA9IGdldFdpbmRvdyhuYW1lKVxuICAgIGlmICh3ICYmIHcuZ2V0X21hcHBlZD8uKCkgJiYgKHcuZ2V0X3dpZHRoPy4oKSA/PyAwKSA+IDApIHtcbiAgICAgIC8vIG9uZSBtb3JlIHRpY2sgc28gZmluYWwgYWxsb2NhdGlvbiBzZXR0bGVzXG4gICAgICBHTGliLnRpbWVvdXRfYWRkKEdMaWIuUFJJT1JJVFlfREVGQVVMVCwgMjUwLCAoKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgdHJlZSA9IGR1bXBXaW5kb3codylcbiAgICAgICAgICBHTGliLmZpbGVfc2V0X2NvbnRlbnRzKHBhdGgsIEpTT04uc3RyaW5naWZ5KHRyZWUpKVxuICAgICAgICAgIHByaW50ZXJyKGBrb2JlbDogZHVtcGVkICR7dHJlZS5sZW5ndGh9IHdpZGdldHMgb2YgXCIke25hbWV9XCIgXHUyMTkyICR7cGF0aH1gKVxuICAgICAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogZHVtcCBmYWlsZWQ6ICR7ZX1gKSB9XG4gICAgICAgIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICAgIH0pXG4gICAgICBkb25lID0gdHJ1ZVxuICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgIH1cbiAgICByZXR1cm4gR0xpYi5TT1VSQ0VfQ09OVElOVUVcbiAgfSlcbn1cbiIsICIvLyBUaGUgYmFyLiBQcm90b3R5cGU6IGxhdW5jaGVyIGJ1dHRvbiBcdTAwQjcgZm9jdXNlZCB0aXRsZSBcdTAwQjcgY2VudGVyZWQgY2xvY2sgKFx1MjE5MiBjYWxlbmRhcilcbi8vIFx1MDBCNyB0cmF5IFx1MDBCNyBzdGF0dXMgcGlsbCAod2lmaS92b2wvYmF0dGVyeTsgYW1iZXIgbmV0LWdseXBoIHdoZW4gZ25vYmxpbiBpcyBkb3duKVxuLy8gXHUwMEI3IGJlbGwrYmFkZ2UgKFx1MjE5MiBkcmF3ZXIpIFx1MDBCNyBwb3dlciAoXHUyMTkyIHNlc3Npb24pLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBUcmF5IGZyb20gXCJnaTovL0FzdGFsVHJheVwiXG5pbXBvcnQgeyBjb25uZWN0ZWQsIHdpbmRvd3MgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyB1bnJlYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCB0aW1lID0gVmFyaWFibGUoR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKCkpLnBvbGwoMTBfMDAwLFxuICAoKSA9PiBHTGliLkRhdGVUaW1lLm5ld19ub3dfbG9jYWwoKSlcblxuZnVuY3Rpb24gRm9jdXNlZFRpdGxlKCkge1xuICByZXR1cm4gPGxhYmVsXG4gICAgY2xhc3M9XCJ0aXRsZVwiXG4gICAgZWxsaXBzaXplPXszIC8qIFBhbmdvLkVsbGlwc2l6ZU1vZGUuRU5EICovfVxuICAgIG1heFdpZHRoQ2hhcnM9ezI4fVxuICAgIGxhYmVsPXtERU1PID8gRC50aXRsZSA6IGJpbmQod2luZG93cykuYXMod3MgPT4ge1xuICAgICAgY29uc3QgZiA9IHdzLmZpbmQodyA9PiB3LmZvY3VzZWQpXG4gICAgICBpZiAoIWYpIHJldHVybiBcImRlc2t0b3BcIlxuICAgICAgY29uc3Qgc2libGluZ3MgPSB3cy5maWx0ZXIodyA9PiB3LmFwcElkID09PSBmLmFwcElkKVxuICAgICAgcmV0dXJuIHNpYmxpbmdzLmxlbmd0aCA+IDFcbiAgICAgICAgPyBgJHtmLnRpdGxlfSBcdTIwMTQgd2luZG93ICR7c2libGluZ3MuaW5kZXhPZihmKSArIDF9LyR7c2libGluZ3MubGVuZ3RofWBcbiAgICAgICAgOiBmLnRpdGxlXG4gICAgfSl9IC8+XG59XG5cbmZ1bmN0aW9uIFN0YXR1c1BpbGwoKSB7XG4gIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgY29uc3QgYmF0ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpXG4gIHJldHVybiA8YnV0dG9uIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICBjbGFzcz17YmluZChjb25uZWN0ZWQpLmFzKGMgPT4gYyA/IFwic3RhdHVzXCIgOiBcInN0YXR1cyBlcnJcIil9XG4gICAgb25DbGlja2VkPXsoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcInF1aWNrc2V0dGluZ3NcIil9PlxuICAgIDxib3ggc3BhY2luZz17MTB9PlxuICAgICAgPGltYWdlIGNsYXNzPVwibmV0LWljb25cIiBpY29uTmFtZT1cImtvYmVsLXdpZmktc3ltYm9saWNcIiAvPlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIgLz5cbiAgICAgIDxib3ggY2xhc3M9XCJwY3RcIiBzcGFjaW5nPXs2fT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e0RFTU8gPyBELmJhdHRlcnlQY3QgOiAoYmF0XG4gICAgICAgICAgPyBiaW5kKGJhdCwgXCJwZXJjZW50YWdlXCIpLmFzKHAgPT4gYCR7TWF0aC5yb3VuZChwICogMTAwKX0lYClcbiAgICAgICAgICA6IFwiMTAwJVwiKX0gLz5cbiAgICAgIDwvYm94PlxuICAgIDwvYm94PlxuICA8L2J1dHRvbj5cbn1cblxuZnVuY3Rpb24gQmVsbCgpIHtcbiAgLy8gQmFkZ2UgaHlkcmF0ZXMgb25jZSBub3RpZmQgaXMgYXZhaWxhYmxlIChkZWZlcnJlZCBcdTIwMTQgZ2V0X2RlZmF1bHQoKSBjYW4gYmxvY2sgb24gYVxuICAvLyBoZWFkbGVzcy9jb250ZW5kZWQgYnVzOyBuZXZlciBjYWxsIGl0IGR1cmluZyBjb25zdHJ1Y3Rpb24pLiB1bnJlYWQoKSBpcyBhIHBsYWluXG4gIC8vIFZhcmlhYmxlIGFuIGFzeW5jIGluaXQgZmlsbHMgaW4uXG4gIHJldHVybiA8YnV0dG9uIGNsYXNzPVwiaWJ0biBiZWxsXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgIG9uQ2xpY2tlZD17KCkgPT4gQXBwLnRvZ2dsZV93aW5kb3coXCJkcmF3ZXJcIil9PlxuICAgIDxvdmVybGF5PlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmVsbC1zeW1ib2xpY1wiIC8+XG4gICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBoYWxpZ249e0d0ay5BbGlnbi5FTkR9IHZhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICBjbGFzcz1cImJhZGdlIHRuXCIgdmlzaWJsZT17REVNTyA/IHRydWUgOiBiaW5kKHVucmVhZCkuYXMobiA9PiBuID4gMCl9XG4gICAgICAgIGxhYmVsPXtERU1PID8gXCIxXCIgOiBiaW5kKHVucmVhZCkuYXMobiA9PiBuID4gOSA/IFwiOStcIiA6IGAke259YCl9IC8+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQmFyKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIGNvbnN0IHsgVE9QLCBMRUZULCBSSUdIVCB9ID0gQXN0YWwuV2luZG93QW5jaG9yXG4gIC8vIEZsb2F0aW5nIGJhcjogbGF5ZXItc2hlbGwgbWFyZ2lucyBpbnNldCBpdCBmcm9tIHRoZSBlZGdlczsgdGhlIC5iYXIgY2hpbGQgaXMgdGhlXG4gIC8vIHJvdW5kZWQgc3VyZmFjZS4gRXhjbHVzaXZlIHNvIHRpbGVkIHdpbmRvd3MgcmVzcGVjdCBpdCAoem9uZSA9IG1hcmdpbiArIGhlaWdodCkuXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImJhclwiIG5hbWVzcGFjZT1cImtvYmVsLWJhclwiIGNsYXNzPVwiYmFyLXdpbmRvd1wiXG4gICAgZ2RrbW9uaXRvcj17bW9uaXRvcn0gZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LkVYQ0xVU0lWRX1cbiAgICBtYXJnaW5Ub3A9ezEwfSBtYXJnaW5MZWZ0PXsxMn0gbWFyZ2luUmlnaHQ9ezEyfVxuICAgIGFuY2hvcj17VE9QIHwgTEVGVCB8IFJJR0hUfT5cbiAgICA8Y2VudGVyYm94IGNsYXNzPVwiYmFyXCI+XG4gICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IEFwcC50b2dnbGVfd2luZG93KFwibGF1bmNoZXJcIil9PlxuICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW1hZ25pZnlpbmctZ2xhc3Mtc3ltYm9saWNcIiAvPlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgPEZvY3VzZWRUaXRsZSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwiYmNlbnRlclwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgb25DbGlja2VkPXsoKSA9PiBBcHAudG9nZ2xlX3dpbmRvdyhcImNhbGVuZGFyXCIpfT5cbiAgICAgICAgPGJveCBzcGFjaW5nPXs4fT5cbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJjbG9jayB0blwiIHZhbGlnbj17R3RrLkFsaWduLkJBU0VMSU5FfVxuICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmNsb2NrIDogYmluZCh0aW1lKS5hcyh0ID0+IHQuZm9ybWF0KFwiJUg6JU1cIikhKX0gLz5cbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJkYXRlXCIgdmFsaWduPXtHdGsuQWxpZ24uQkFTRUxJTkV9XG4gICAgICAgICAgICBsYWJlbD17REVNTyA/IEQuZGF0ZSA6IGJpbmQodGltZSkuYXModCA9PiB0LmZvcm1hdChcIiVhICUtZCAlYlwiKSEpfSAvPlxuICAgICAgICA8L2JveD5cbiAgICAgIDwvYnV0dG9uPlxuICAgICAgPGJveCBzcGFjaW5nPXs0fT5cbiAgICAgICAge0RFTU9cbiAgICAgICAgICA/IDxib3ggc3BhY2luZz17MX0gbWFyZ2luRW5kPXszfT5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG4gdHJheS1pY29uXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB0b29sdGlwVGV4dD1cIkRpc2NvcmRcIj5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGF0LXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG4gdHJheS1pY29uXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB0b29sdGlwVGV4dD1cIlN0ZWFtXCI+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtZ2FtZS1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdG9vbHRpcFRleHQ9XCJUZWxlZ3JhbVwiPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBhcGVyLXBsYW5lLXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gdHJheS1sYW5nXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBsYWJlbD1cImVuXCIgLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgIDogYmluZChUcmF5LmdldF9kZWZhdWx0KCksIFwiaXRlbXNcIikuYXMoaXRlbXMgPT4gaXRlbXMubWFwKGl0ZW0gPT5cbiAgICAgICAgICAgICAgPG1lbnVidXR0b24gdG9vbHRpcFRleHQ9e2l0ZW0udG9vbHRpcF9tYXJrdXB9IG1lbnVNb2RlbD17aXRlbS5tZW51X21vZGVsfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgZ2ljb249e2JpbmQoaXRlbSwgXCJnaWNvblwiKX0gLz5cbiAgICAgICAgICAgICAgPC9tZW51YnV0dG9uPikpfVxuICAgICAgICA8U3RhdHVzUGlsbCAvPlxuICAgICAgICA8QmVsbCAvPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IEFwcC50b2dnbGVfd2luZG93KFwic2Vzc2lvblwiKX0+XG4gICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgIDwvYm94PlxuICAgIDwvY2VudGVyYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBEZW1vLWRhdGEgbW9kZSAoS09CRUxfREVNTz0xKTogbWFrZSBldmVyeSBzdXJmYWNlIHJlbmRlciB0aGUgRVhBQ1QgbW9jayB2YWx1ZXMgZnJvbVxuLy8gZG9jcy9wcm90b3R5cGUuaHRtbCwgc28gYW4gQUdTIHJlbmRlciBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXJcbi8vIGZvciBhIGZhaXIgMToxIGNvbXBhcmlzb24uIFRoaXMgaXMgTk9UIGNoZWF0aW5nIFx1MjAxNCByZWFsIEdUSyB3aWRnZXRzLCByZWFsIHJlbmRlcmluZztcbi8vIG9ubHkgdGhlICpjb250ZW50KiBpcyBwaW5uZWQgdG8gdGhlIHByb3RvdHlwZSdzIHNvIHRoZSBjaHJvbWUgY2FuIGJlIGRpZmZlZCBkaXJlY3RseS5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgY29uc3QgREVNTyA9ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9ERU1PXCIpXG5cbi8vIFZhbHVlcyB0cmFuc2NyaWJlZCBmcm9tIHByb3RvdHlwZS5odG1sJ3MgbW9jayBzdGF0ZSAodGhlIHJlZmVyZW5jZSBzY3JlZW5zaG90cykuXG5leHBvcnQgY29uc3QgRCA9IHtcbiAgLy8gYmFyXG4gIGNsb2NrOiBcIjE0OjIzXCIsXG4gIGRhdGU6IFwiU2F0IDQgSnVsXCIsXG4gIHRpdGxlOiBcIlRlcm1pbmFsIFx1MjAxNCB3aW5kb3cgMS8yXCIsXG4gIGJhdHRlcnlQY3Q6IFwiMTAwJVwiLFxuICAvLyBxdWljayBzZXR0aW5nc1xuICBtZXRhOiBcIjEwMCUgXHUwMEI3IEZ1bGx5IGNoYXJnZWRcIixcbiAgd2lmaVNzaWQ6IFwiY2hvbXBlcnMtNUdcIixcbiAgYnREZXZpY2U6IFwiV0gtMTAwMFhNNVwiLFxuICB2b2x1bWU6IDAuNjc1LCAgICAgLy8gdHJvdWdoIDUxLi4yODUgd2lkdGg9MjM0OyBrbm9iPSgyMDktNTEpLzIzND0wLjY3NSBcdTIxOTIgeFx1MjI0ODIwOSBtYXRjaGVzIHByb3RvXG4gIGJyaWdodG5lc3M6IDAuODAwLCAvLyBtZWFzdXJlZDogQUdTIHRyb3VnaCAycHggbmFycm93ZXIgdGhhbiBwcm90bzsgMC44MDAgYWxpZ25zIGtub2IgY2VudGVyXG4gIGRhcms6IHRydWUsIHNhdmU6IGZhbHNlLCBzaWxlbnQ6IGZhbHNlLCBuaWdodDogZmFsc2UsXG4gIC8vIGNhbGVuZGFyIFx1MjAxNCBwaW5uZWQgXCJ0b2RheVwiIHNvIHRoZSBncmlkICsgaGVybyBtYXRjaCB0aGUgcHJvdG90eXBlIGV4YWN0bHlcbiAgdG9kYXk6IHsgeTogMjAyNiwgbTogNiAvKiBKdWx5LCAwLWluZGV4ZWQgKi8sIGQ6IDQgfSwgIC8vIFNhdHVyZGF5IDQgSnVseSAyMDI2XG4gIC8vIGxhdW5jaGVyIHBpbm5lZCB0aWxlcyArIHRvZGF5IHdpZGdldFxuICBhcHBzOiBbXCJUZXJtaW5hbFwiLCBcIkZpbGVzXCIsIFwiRmlyZWZveFwiLCBcIlplZFwiLCBcIlNwb3RpZnlcIiwgXCJTZXR0aW5nc1wiXSxcbiAgd2lkZ2V0RGF0ZTogXCJTYXR1cmRheSA0IEp1bHlcIixcbiAgd2lkZ2V0RXZlbnQ6IFwiMDk6NDUgXHUwMEI3IERhaWx5IFN0YW5kdXBcIixcbiAgbWVkaWE6IHsgdGl0bGU6IFwiV2VpZ2h0bGVzc1wiLCBhcnRpc3Q6IFwiTWFyY29uaSBVbmlvblwiIH0sXG59XG4iLCAiLyogZXNsaW50LWRpc2FibGUgbWF4LWxlbiAqL1xuaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249My4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249My4wXCJcbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUgQ29uc3RydWN0UHJvcHMsIHR5cGUgQmluZGFibGVDaGlsZCB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZnVuY3Rpb24gZmlsdGVyKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIHJldHVybiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG59XG5cbi8vIEJveFxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLkJveC5wcm90b3R5cGUsIFwiY2hpbGRyZW5cIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9jaGlsZHJlbih2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxCb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIEJveCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkJveCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJCb3hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBCb3hQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQgeyB0aGlzLnNldF9jaGlsZHJlbihmaWx0ZXIoY2hpbGRyZW4pKSB9XG59XG5cbi8vIEJ1dHRvblxuZXhwb3J0IHR5cGUgQnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxCdXR0b24sIEFzdGFsLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25DbGlja2VkOiBbXVxuICAgIG9uQ2xpY2s6IFtldmVudDogQXN0YWwuQ2xpY2tFdmVudF1cbiAgICBvbkNsaWNrUmVsZWFzZTogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uSG92ZXI6IFtldmVudDogQXN0YWwuSG92ZXJFdmVudF1cbiAgICBvbkhvdmVyTG9zdDogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uU2Nyb2xsOiBbZXZlbnQ6IEFzdGFsLlNjcm9sbEV2ZW50XVxufT5cbmV4cG9ydCBjbGFzcyBCdXR0b24gZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5CdXR0b24pIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQnV0dG9uXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQnV0dG9uUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBDZW50ZXJCb3hcbmV4cG9ydCB0eXBlIENlbnRlckJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8Q2VudGVyQm94LCBBc3RhbC5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBDZW50ZXJCb3ggZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5DZW50ZXJCb3gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQ2VudGVyQm94XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQ2VudGVyQm94UHJvcHMsIC4uLmNoaWxkcmVuOiBBcnJheTxCaW5kYWJsZUNoaWxkPikgeyBzdXBlcih7IGNoaWxkcmVuLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY2ggPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIHRoaXMuc3RhcnRXaWRnZXQgPSBjaFswXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICB0aGlzLmNlbnRlcldpZGdldCA9IGNoWzFdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIHRoaXMuZW5kV2lkZ2V0ID0gY2hbMl0gfHwgbmV3IEd0ay5Cb3hcbiAgICB9XG59XG5cbi8vIENpcmN1bGFyUHJvZ3Jlc3NcbmV4cG9ydCB0eXBlIENpcmN1bGFyUHJvZ3Jlc3NQcm9wcyA9IENvbnN0cnVjdFByb3BzPENpcmN1bGFyUHJvZ3Jlc3MsIEFzdGFsLkNpcmN1bGFyUHJvZ3Jlc3MuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBDaXJjdWxhclByb2dyZXNzIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuQ2lyY3VsYXJQcm9ncmVzcykge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJDaXJjdWxhclByb2dyZXNzXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQ2lyY3VsYXJQcm9ncmVzc1Byb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gRHJhd2luZ0FyZWFcbmV4cG9ydCB0eXBlIERyYXdpbmdBcmVhUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxEcmF3aW5nQXJlYSwgR3RrLkRyYXdpbmdBcmVhLkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkRyYXc6IFtjcjogYW55XSAvLyBUT0RPOiBjYWlybyB0eXBlc1xufT5cbmV4cG9ydCBjbGFzcyBEcmF3aW5nQXJlYSBleHRlbmRzIGFzdGFsaWZ5KEd0ay5EcmF3aW5nQXJlYSkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJEcmF3aW5nQXJlYVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IERyYXdpbmdBcmVhUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIEVudHJ5XG5leHBvcnQgdHlwZSBFbnRyeVByb3BzID0gQ29uc3RydWN0UHJvcHM8RW50cnksIEd0ay5FbnRyeS5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25DaGFuZ2VkOiBbXVxuICAgIG9uQWN0aXZhdGU6IFtdXG59PlxuZXhwb3J0IGNsYXNzIEVudHJ5IGV4dGVuZHMgYXN0YWxpZnkoR3RrLkVudHJ5KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkVudHJ5XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogRW50cnlQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gRXZlbnRCb3hcbmV4cG9ydCB0eXBlIEV2ZW50Qm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxFdmVudEJveCwgQXN0YWwuRXZlbnRCb3guQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uQ2xpY2s6IFtldmVudDogQXN0YWwuQ2xpY2tFdmVudF1cbiAgICBvbkNsaWNrUmVsZWFzZTogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uSG92ZXI6IFtldmVudDogQXN0YWwuSG92ZXJFdmVudF1cbiAgICBvbkhvdmVyTG9zdDogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uU2Nyb2xsOiBbZXZlbnQ6IEFzdGFsLlNjcm9sbEV2ZW50XVxufT5cbmV4cG9ydCBjbGFzcyBFdmVudEJveCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkV2ZW50Qm94KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkV2ZW50Qm94XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogRXZlbnRCb3hQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIC8vIFRPRE86IEZpeGVkXG4vLyAvLyBUT0RPOiBGbG93Qm94XG4vL1xuLy8gSWNvblxuZXhwb3J0IHR5cGUgSWNvblByb3BzID0gQ29uc3RydWN0UHJvcHM8SWNvbiwgQXN0YWwuSWNvbi5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIEljb24gZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5JY29uKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkljb25cIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBJY29uUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIExhYmVsXG5leHBvcnQgdHlwZSBMYWJlbFByb3BzID0gQ29uc3RydWN0UHJvcHM8TGFiZWwsIEFzdGFsLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgTGFiZWwgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5MYWJlbCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJMYWJlbFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IExhYmVsUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQgeyB0aGlzLmxhYmVsID0gU3RyaW5nKGNoaWxkcmVuKSB9XG59XG5cbi8vIExldmVsQmFyXG5leHBvcnQgdHlwZSBMZXZlbEJhclByb3BzID0gQ29uc3RydWN0UHJvcHM8TGV2ZWxCYXIsIEFzdGFsLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgTGV2ZWxCYXIgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5MZXZlbEJhcikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJMZXZlbEJhclwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IExldmVsQmFyUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIFRPRE86IExpc3RCb3hcblxuLy8gTWVudUJ1dHRvblxuZXhwb3J0IHR5cGUgTWVudUJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8TWVudUJ1dHRvbiwgR3RrLk1lbnVCdXR0b24uQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBNZW51QnV0dG9uIGV4dGVuZHMgYXN0YWxpZnkoR3RrLk1lbnVCdXR0b24pIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiTWVudUJ1dHRvblwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IE1lbnVCdXR0b25Qcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIE92ZXJsYXlcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShBc3RhbC5PdmVybGF5LnByb3RvdHlwZSwgXCJvdmVybGF5c1wiLCB7XG4gICAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfb3ZlcmxheXMoKSB9LFxuICAgIHNldCh2KSB7IHRoaXMuc2V0X292ZXJsYXlzKHYpIH0sXG59KVxuXG5leHBvcnQgdHlwZSBPdmVybGF5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxPdmVybGF5LCBBc3RhbC5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgT3ZlcmxheSBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLk92ZXJsYXkpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiT3ZlcmxheVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IE92ZXJsYXlQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQge1xuICAgICAgICBjb25zdCBbY2hpbGQsIC4uLm92ZXJsYXlzXSA9IGZpbHRlcihjaGlsZHJlbilcbiAgICAgICAgdGhpcy5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgIHRoaXMuc2V0X292ZXJsYXlzKG92ZXJsYXlzKVxuICAgIH1cbn1cblxuLy8gUmV2ZWFsZXJcbmV4cG9ydCB0eXBlIFJldmVhbGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxSZXZlYWxlciwgR3RrLlJldmVhbGVyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgUmV2ZWFsZXIgZXh0ZW5kcyBhc3RhbGlmeShHdGsuUmV2ZWFsZXIpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiUmV2ZWFsZXJcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBSZXZlYWxlclByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gU2Nyb2xsYWJsZVxuZXhwb3J0IHR5cGUgU2Nyb2xsYWJsZVByb3BzID0gQ29uc3RydWN0UHJvcHM8U2Nyb2xsYWJsZSwgQXN0YWwuU2Nyb2xsYWJsZS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFNjcm9sbGFibGUgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5TY3JvbGxhYmxlKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlNjcm9sbGFibGVcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTY3JvbGxhYmxlUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBTbGlkZXJcbmV4cG9ydCB0eXBlIFNsaWRlclByb3BzID0gQ29uc3RydWN0UHJvcHM8U2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uRHJhZ2dlZDogW11cbn0+XG5leHBvcnQgY2xhc3MgU2xpZGVyIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuU2xpZGVyKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlNsaWRlclwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFNsaWRlclByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBTdGFja1xuZXhwb3J0IHR5cGUgU3RhY2tQcm9wcyA9IENvbnN0cnVjdFByb3BzPFN0YWNrLCBBc3RhbC5TdGFjay5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFN0YWNrIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuU3RhY2spIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU3RhY2tcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTdGFja1Byb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7IHRoaXMuc2V0X2NoaWxkcmVuKGZpbHRlcihjaGlsZHJlbikpIH1cbn1cblxuLy8gU3dpdGNoXG5leHBvcnQgdHlwZSBTd2l0Y2hQcm9wcyA9IENvbnN0cnVjdFByb3BzPFN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFN3aXRjaCBleHRlbmRzIGFzdGFsaWZ5KEd0ay5Td2l0Y2gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU3dpdGNoXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogU3dpdGNoUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIFdpbmRvd1xuZXhwb3J0IHR5cGUgV2luZG93UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxXaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFdpbmRvdyBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLldpbmRvdykge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJXaW5kb3dcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBXaW5kb3dQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG4iLCAiaW1wb3J0IHsgaG9vaywgbm9JbXBsaWNpdERlc3Ryb3ksIHNldENoaWxkcmVuLCBtZXJnZUJpbmRpbmdzLCB0eXBlIEJpbmRhYmxlUHJvcHMsIGNvbnN0cnVjdCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249My4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249My4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249My4wXCJcbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW8/dmVyc2lvbj0yLjBcIlxuaW1wb3J0IEJpbmRpbmcsIHsgdHlwZSBDb25uZWN0YWJsZSwgdHlwZSBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCB7IEJpbmRhYmxlUHJvcHMsIG1lcmdlQmluZGluZ3MgfVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhc3RhbGlmeTxcbiAgICBDIGV4dGVuZHMgeyBuZXcoLi4uYXJnczogYW55W10pOiBHdGsuV2lkZ2V0IH0sXG4+KGNsczogQywgY2xzTmFtZSA9IGNscy5uYW1lKSB7XG4gICAgY2xhc3MgV2lkZ2V0IGV4dGVuZHMgY2xzIHtcbiAgICAgICAgZ2V0IGNzcygpOiBzdHJpbmcgeyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jc3ModGhpcykgfVxuICAgICAgICBzZXQgY3NzKGNzczogc3RyaW5nKSB7IEFzdGFsLndpZGdldF9zZXRfY3NzKHRoaXMsIGNzcykgfVxuICAgICAgICBnZXRfY3NzKCk6IHN0cmluZyB7IHJldHVybiB0aGlzLmNzcyB9XG4gICAgICAgIHNldF9jc3MoY3NzOiBzdHJpbmcpIHsgdGhpcy5jc3MgPSBjc3MgfVxuXG4gICAgICAgIGdldCBjbGFzc05hbWUoKTogc3RyaW5nIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY2xhc3NfbmFtZXModGhpcykuam9pbihcIiBcIikgfVxuICAgICAgICBzZXQgY2xhc3NOYW1lKGNsYXNzTmFtZTogc3RyaW5nKSB7IEFzdGFsLndpZGdldF9zZXRfY2xhc3NfbmFtZXModGhpcywgY2xhc3NOYW1lLnNwbGl0KC9cXHMrLykpIH1cbiAgICAgICAgZ2V0X2NsYXNzX25hbWUoKTogc3RyaW5nIHsgcmV0dXJuIHRoaXMuY2xhc3NOYW1lIH1cbiAgICAgICAgc2V0X2NsYXNzX25hbWUoY2xhc3NOYW1lOiBzdHJpbmcpIHsgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWUgfVxuXG4gICAgICAgIGdldCBjdXJzb3IoKTogQ3Vyc29yIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY3Vyc29yKHRoaXMpIGFzIEN1cnNvciB9XG4gICAgICAgIHNldCBjdXJzb3IoY3Vyc29yOiBDdXJzb3IpIHsgQXN0YWwud2lkZ2V0X3NldF9jdXJzb3IodGhpcywgY3Vyc29yKSB9XG4gICAgICAgIGdldF9jdXJzb3IoKTogQ3Vyc29yIHsgcmV0dXJuIHRoaXMuY3Vyc29yIH1cbiAgICAgICAgc2V0X2N1cnNvcihjdXJzb3I6IEN1cnNvcikgeyB0aGlzLmN1cnNvciA9IGN1cnNvciB9XG5cbiAgICAgICAgZ2V0IGNsaWNrVGhyb3VnaCgpOiBib29sZWFuIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY2xpY2tfdGhyb3VnaCh0aGlzKSB9XG4gICAgICAgIHNldCBjbGlja1Rocm91Z2goY2xpY2tUaHJvdWdoOiBib29sZWFuKSB7IEFzdGFsLndpZGdldF9zZXRfY2xpY2tfdGhyb3VnaCh0aGlzLCBjbGlja1Rocm91Z2gpIH1cbiAgICAgICAgZ2V0X2NsaWNrX3Rocm91Z2goKTogYm9vbGVhbiB7IHJldHVybiB0aGlzLmNsaWNrVGhyb3VnaCB9XG4gICAgICAgIHNldF9jbGlja190aHJvdWdoKGNsaWNrVGhyb3VnaDogYm9vbGVhbikgeyB0aGlzLmNsaWNrVGhyb3VnaCA9IGNsaWNrVGhyb3VnaCB9XG5cbiAgICAgICAgZGVjbGFyZSBwcml2YXRlIFtub0ltcGxpY2l0RGVzdHJveV06IGJvb2xlYW5cbiAgICAgICAgZ2V0IG5vSW1wbGljaXREZXN0cm95KCk6IGJvb2xlYW4geyByZXR1cm4gdGhpc1tub0ltcGxpY2l0RGVzdHJveV0gfVxuICAgICAgICBzZXQgbm9JbXBsaWNpdERlc3Ryb3kodmFsdWU6IGJvb2xlYW4pIHsgdGhpc1tub0ltcGxpY2l0RGVzdHJveV0gPSB2YWx1ZSB9XG5cbiAgICAgICAgc2V0IGFjdGlvbkdyb3VwKFtwcmVmaXgsIGdyb3VwXTogQWN0aW9uR3JvdXApIHsgdGhpcy5pbnNlcnRfYWN0aW9uX2dyb3VwKHByZWZpeCwgZ3JvdXApIH1cbiAgICAgICAgc2V0X2FjdGlvbl9ncm91cChhY3Rpb25Hcm91cDogQWN0aW9uR3JvdXApIHsgdGhpcy5hY3Rpb25Hcm91cCA9IGFjdGlvbkdyb3VwIH1cblxuICAgICAgICBwcm90ZWN0ZWQgZ2V0Q2hpbGRyZW4oKTogQXJyYXk8R3RrLldpZGdldD4ge1xuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQmluKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkKCkgPyBbdGhpcy5nZXRfY2hpbGQoKSFdIDogW11cbiAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcyBpbnN0YW5jZW9mIEd0ay5Db250YWluZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRfY2hpbGRyZW4oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgIH1cblxuICAgICAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKSB7XG4gICAgICAgICAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgICAgICAgICA/IGNoXG4gICAgICAgICAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG5cbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkNvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY2ggb2YgY2hpbGRyZW4pXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkKGNoKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBFcnJvcihgY2FuIG5vdCBhZGQgY2hpbGRyZW4gdG8gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIFtzZXRDaGlsZHJlbl0oY2hpbGRyZW46IGFueVtdKSB7XG4gICAgICAgICAgICAvLyByZW1vdmVcbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkNvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY2ggb2YgdGhpcy5nZXRDaGlsZHJlbigpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVtb3ZlKGNoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoIWNoaWxkcmVuLmluY2x1ZGVzKGNoKSAmJiAhdGhpcy5ub0ltcGxpY2l0RGVzdHJveSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoPy5kZXN0cm95KClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGFwcGVuZFxuICAgICAgICAgICAgdGhpcy5zZXRDaGlsZHJlbihjaGlsZHJlbilcbiAgICAgICAgfVxuXG4gICAgICAgIHRvZ2dsZUNsYXNzTmFtZShjbjogc3RyaW5nLCBjb25kID0gdHJ1ZSkge1xuICAgICAgICAgICAgQXN0YWwud2lkZ2V0X3RvZ2dsZV9jbGFzc19uYW1lKHRoaXMsIGNuLCBjb25kKVxuICAgICAgICB9XG5cbiAgICAgICAgaG9vayhcbiAgICAgICAgICAgIG9iamVjdDogQ29ubmVjdGFibGUsXG4gICAgICAgICAgICBzaWduYWw6IHN0cmluZyxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4gICAgICAgICk6IHRoaXNcbiAgICAgICAgaG9vayhcbiAgICAgICAgICAgIG9iamVjdDogU3Vic2NyaWJhYmxlLFxuICAgICAgICAgICAgY2FsbGJhY2s6IChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgICAgICAgKTogdGhpc1xuICAgICAgICBob29rKFxuICAgICAgICAgICAgb2JqZWN0OiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSxcbiAgICAgICAgICAgIHNpZ25hbE9yQ2FsbGJhY2s6IHN0cmluZyB8ICgoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQpLFxuICAgICAgICAgICAgY2FsbGJhY2s/OiAoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4gICAgICAgICkge1xuICAgICAgICAgICAgaG9vayh0aGlzLCBvYmplY3QsIHNpZ25hbE9yQ2FsbGJhY2ssIGNhbGxiYWNrKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXNcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0cnVjdG9yKC4uLnBhcmFtczogYW55W10pIHtcbiAgICAgICAgICAgIHN1cGVyKClcbiAgICAgICAgICAgIGNvbnN0IHByb3BzID0gcGFyYW1zWzBdIHx8IHt9XG4gICAgICAgICAgICBwcm9wcy52aXNpYmxlID8/PSB0cnVlXG4gICAgICAgICAgICBjb25zdHJ1Y3QodGhpcywgcHJvcHMpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3Moe1xuICAgICAgICBHVHlwZU5hbWU6IGBBc3RhbF8ke2Nsc05hbWV9YCxcbiAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgXCJjbGFzcy1uYW1lXCI6IEdPYmplY3QuUGFyYW1TcGVjLnN0cmluZyhcbiAgICAgICAgICAgICAgICBcImNsYXNzLW5hbWVcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgXCJcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcImNzc1wiOiBHT2JqZWN0LlBhcmFtU3BlYy5zdHJpbmcoXG4gICAgICAgICAgICAgICAgXCJjc3NcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgXCJcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcImN1cnNvclwiOiBHT2JqZWN0LlBhcmFtU3BlYy5zdHJpbmcoXG4gICAgICAgICAgICAgICAgXCJjdXJzb3JcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgXCJkZWZhdWx0XCIsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgXCJjbGljay10aHJvdWdoXCI6IEdPYmplY3QuUGFyYW1TcGVjLmJvb2xlYW4oXG4gICAgICAgICAgICAgICAgXCJjbGljay10aHJvdWdoXCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIGZhbHNlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwibm8taW1wbGljaXQtZGVzdHJveVwiOiBHT2JqZWN0LlBhcmFtU3BlYy5ib29sZWFuKFxuICAgICAgICAgICAgICAgIFwibm8taW1wbGljaXQtZGVzdHJveVwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBmYWxzZSxcbiAgICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgfSwgV2lkZ2V0KVxuXG4gICAgcmV0dXJuIFdpZGdldFxufVxuXG50eXBlIFNpZ0hhbmRsZXI8XG4gICAgVyBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgQXJncyBleHRlbmRzIEFycmF5PHVua25vd24+LFxuPiA9ICgoc2VsZjogVywgLi4uYXJnczogQXJncykgPT4gdW5rbm93bikgfCBzdHJpbmcgfCBzdHJpbmdbXVxuXG5leHBvcnQgdHlwZSBCaW5kYWJsZUNoaWxkID0gR3RrLldpZGdldCB8IEJpbmRpbmc8R3RrLldpZGdldD5cblxuZXhwb3J0IHR5cGUgQ29uc3RydWN0UHJvcHM8XG4gICAgU2VsZiBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgUHJvcHMgZXh0ZW5kcyBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMsXG4gICAgU2lnbmFscyBleHRlbmRzIFJlY29yZDxgb24ke3N0cmluZ31gLCBBcnJheTx1bmtub3duPj4gPSBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgYW55W10+LFxuPiA9IFBhcnRpYWw8e1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY2FuJ3QgYXNzaWduIHRvIHVua25vd24sIGJ1dCBpdCB3b3JrcyBhcyBleHBlY3RlZCB0aG91Z2hcbiAgICBbUyBpbiBrZXlvZiBTaWduYWxzXTogU2lnSGFuZGxlcjxTZWxmLCBTaWduYWxzW1NdPlxufT4gJiBQYXJ0aWFsPHtcbiAgICBbS2V5IGluIGBvbiR7c3RyaW5nfWBdOiBTaWdIYW5kbGVyPFNlbGYsIGFueVtdPlxufT4gJiBCaW5kYWJsZVByb3BzPFBhcnRpYWw8UHJvcHMgJiB7XG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICAgY3NzPzogc3RyaW5nXG4gICAgY3Vyc29yPzogc3RyaW5nXG4gICAgY2xpY2tUaHJvdWdoPzogYm9vbGVhblxuICAgIGFjdGlvbkdyb3VwPzogQWN0aW9uR3JvdXBcbn0+PiAmIFBhcnRpYWw8e1xuICAgIG9uRGVzdHJveTogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBvbkRyYXc6IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgb25LZXlQcmVzc0V2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uS2V5UmVsZWFzZUV2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uQnV0dG9uUHJlc3NFdmVudDogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHVua25vd25cbiAgICBvbkJ1dHRvblJlbGVhc2VFdmVudDogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHVua25vd25cbiAgICBvblJlYWxpemU6IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgc2V0dXA6IChzZWxmOiBTZWxmKSA9PiB2b2lkXG59PlxuXG50eXBlIEN1cnNvciA9XG4gICAgfCBcImRlZmF1bHRcIlxuICAgIHwgXCJoZWxwXCJcbiAgICB8IFwicG9pbnRlclwiXG4gICAgfCBcImNvbnRleHQtbWVudVwiXG4gICAgfCBcInByb2dyZXNzXCJcbiAgICB8IFwid2FpdFwiXG4gICAgfCBcImNlbGxcIlxuICAgIHwgXCJjcm9zc2hhaXJcIlxuICAgIHwgXCJ0ZXh0XCJcbiAgICB8IFwidmVydGljYWwtdGV4dFwiXG4gICAgfCBcImFsaWFzXCJcbiAgICB8IFwiY29weVwiXG4gICAgfCBcIm5vLWRyb3BcIlxuICAgIHwgXCJtb3ZlXCJcbiAgICB8IFwibm90LWFsbG93ZWRcIlxuICAgIHwgXCJncmFiXCJcbiAgICB8IFwiZ3JhYmJpbmdcIlxuICAgIHwgXCJhbGwtc2Nyb2xsXCJcbiAgICB8IFwiY29sLXJlc2l6ZVwiXG4gICAgfCBcInJvdy1yZXNpemVcIlxuICAgIHwgXCJuLXJlc2l6ZVwiXG4gICAgfCBcImUtcmVzaXplXCJcbiAgICB8IFwicy1yZXNpemVcIlxuICAgIHwgXCJ3LXJlc2l6ZVwiXG4gICAgfCBcIm5lLXJlc2l6ZVwiXG4gICAgfCBcIm53LXJlc2l6ZVwiXG4gICAgfCBcInN3LXJlc2l6ZVwiXG4gICAgfCBcInNlLXJlc2l6ZVwiXG4gICAgfCBcImV3LXJlc2l6ZVwiXG4gICAgfCBcIm5zLXJlc2l6ZVwiXG4gICAgfCBcIm5lc3ctcmVzaXplXCJcbiAgICB8IFwibndzZS1yZXNpemVcIlxuICAgIHwgXCJ6b29tLWluXCJcbiAgICB8IFwiem9vbS1vdXRcIlxuXG50eXBlIEFjdGlvbkdyb3VwID0gW3ByZWZpeDogc3RyaW5nLCBhY3Rpb25Hcm91cDogR2lvLkFjdGlvbkdyb3VwXVxuIiwgImltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249My4wXCJcbmltcG9ydCB7IHR5cGUgQmluZGFibGVDaGlsZCB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcbmltcG9ydCB7IG1lcmdlQmluZGluZ3MsIGpzeCBhcyBfanN4IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgKiBhcyBXaWRnZXQgZnJvbSBcIi4vd2lkZ2V0LmpzXCJcblxuZXhwb3J0IGZ1bmN0aW9uIEZyYWdtZW50KHsgY2hpbGRyZW4gPSBbXSwgY2hpbGQgfToge1xuICAgIGNoaWxkPzogQmluZGFibGVDaGlsZFxuICAgIGNoaWxkcmVuPzogQXJyYXk8QmluZGFibGVDaGlsZD5cbn0pIHtcbiAgICBpZiAoY2hpbGQpIGNoaWxkcmVuLnB1c2goY2hpbGQpXG4gICAgcmV0dXJuIG1lcmdlQmluZGluZ3MoY2hpbGRyZW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBqc3goXG4gICAgY3Rvcjoga2V5b2YgdHlwZW9mIGN0b3JzIHwgdHlwZW9mIEd0ay5XaWRnZXQsXG4gICAgcHJvcHM6IGFueSxcbikge1xuICAgIHJldHVybiBfanN4KGN0b3JzLCBjdG9yIGFzIGFueSwgcHJvcHMpXG59XG5cbmNvbnN0IGN0b3JzID0ge1xuICAgIGJveDogV2lkZ2V0LkJveCxcbiAgICBidXR0b246IFdpZGdldC5CdXR0b24sXG4gICAgY2VudGVyYm94OiBXaWRnZXQuQ2VudGVyQm94LFxuICAgIGNpcmN1bGFycHJvZ3Jlc3M6IFdpZGdldC5DaXJjdWxhclByb2dyZXNzLFxuICAgIGRyYXdpbmdhcmVhOiBXaWRnZXQuRHJhd2luZ0FyZWEsXG4gICAgZW50cnk6IFdpZGdldC5FbnRyeSxcbiAgICBldmVudGJveDogV2lkZ2V0LkV2ZW50Qm94LFxuICAgIC8vIFRPRE86IGZpeGVkXG4gICAgLy8gVE9ETzogZmxvd2JveFxuICAgIGljb246IFdpZGdldC5JY29uLFxuICAgIGxhYmVsOiBXaWRnZXQuTGFiZWwsXG4gICAgbGV2ZWxiYXI6IFdpZGdldC5MZXZlbEJhcixcbiAgICAvLyBUT0RPOiBsaXN0Ym94XG4gICAgbWVudWJ1dHRvbjogV2lkZ2V0Lk1lbnVCdXR0b24sXG4gICAgb3ZlcmxheTogV2lkZ2V0Lk92ZXJsYXksXG4gICAgcmV2ZWFsZXI6IFdpZGdldC5SZXZlYWxlcixcbiAgICBzY3JvbGxhYmxlOiBXaWRnZXQuU2Nyb2xsYWJsZSxcbiAgICBzbGlkZXI6IFdpZGdldC5TbGlkZXIsXG4gICAgc3RhY2s6IFdpZGdldC5TdGFjayxcbiAgICBzd2l0Y2g6IFdpZGdldC5Td2l0Y2gsXG4gICAgd2luZG93OiBXaWRnZXQuV2luZG93LFxufVxuXG5kZWNsYXJlIGdsb2JhbCB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1uYW1lc3BhY2VcbiAgICBuYW1lc3BhY2UgSlNYIHtcbiAgICAgICAgdHlwZSBFbGVtZW50ID0gR3RrLldpZGdldFxuICAgICAgICB0eXBlIEVsZW1lbnRDbGFzcyA9IEd0ay5XaWRnZXRcbiAgICAgICAgaW50ZXJmYWNlIEludHJpbnNpY0VsZW1lbnRzIHtcbiAgICAgICAgICAgIGJveDogV2lkZ2V0LkJveFByb3BzXG4gICAgICAgICAgICBidXR0b246IFdpZGdldC5CdXR0b25Qcm9wc1xuICAgICAgICAgICAgY2VudGVyYm94OiBXaWRnZXQuQ2VudGVyQm94UHJvcHNcbiAgICAgICAgICAgIGNpcmN1bGFycHJvZ3Jlc3M6IFdpZGdldC5DaXJjdWxhclByb2dyZXNzUHJvcHNcbiAgICAgICAgICAgIGRyYXdpbmdhcmVhOiBXaWRnZXQuRHJhd2luZ0FyZWFQcm9wc1xuICAgICAgICAgICAgZW50cnk6IFdpZGdldC5FbnRyeVByb3BzXG4gICAgICAgICAgICBldmVudGJveDogV2lkZ2V0LkV2ZW50Qm94UHJvcHNcbiAgICAgICAgICAgIC8vIFRPRE86IGZpeGVkXG4gICAgICAgICAgICAvLyBUT0RPOiBmbG93Ym94XG4gICAgICAgICAgICBpY29uOiBXaWRnZXQuSWNvblByb3BzXG4gICAgICAgICAgICBsYWJlbDogV2lkZ2V0LkxhYmVsUHJvcHNcbiAgICAgICAgICAgIGxldmVsYmFyOiBXaWRnZXQuTGV2ZWxCYXJQcm9wc1xuICAgICAgICAgICAgLy8gVE9ETzogbGlzdGJveFxuICAgICAgICAgICAgbWVudWJ1dHRvbjogV2lkZ2V0Lk1lbnVCdXR0b25Qcm9wc1xuICAgICAgICAgICAgb3ZlcmxheTogV2lkZ2V0Lk92ZXJsYXlQcm9wc1xuICAgICAgICAgICAgcmV2ZWFsZXI6IFdpZGdldC5SZXZlYWxlclByb3BzXG4gICAgICAgICAgICBzY3JvbGxhYmxlOiBXaWRnZXQuU2Nyb2xsYWJsZVByb3BzXG4gICAgICAgICAgICBzbGlkZXI6IFdpZGdldC5TbGlkZXJQcm9wc1xuICAgICAgICAgICAgc3RhY2s6IFdpZGdldC5TdGFja1Byb3BzXG4gICAgICAgICAgICBzd2l0Y2g6IFdpZGdldC5Td2l0Y2hQcm9wc1xuICAgICAgICAgICAgd2luZG93OiBXaWRnZXQuV2luZG93UHJvcHNcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGpzeHMgPSBqc3hcbiIsICIvLyBUaGUgZG9jay4gQmVoYXZpb3IgbW9kZWwgKHByb3RvdHlwZS1maW5hbCk6XG4vLyAgIGNsaWNrICBcdTIwMTQgbm8gd2luZG93czogbGF1bmNoIChnaG9zdCB6b29tKSBcdTAwQjcgdW5mb2N1c2VkOiBmb2N1cyB0b3Agd2luZG93IChwdWxzZSlcbi8vICAgICAgICAgICAgZm9jdXNlZCArIG11bHRpOiBjeWNsZSBcdTAwQjcgZm9jdXNlZCArIHNpbmdsZTogbWluaW1pemVcbi8vICAgc2Nyb2xsIFx1MjAxNCBzaW5nbGU6IGZvY3VzIFx1MDBCNyBtdWx0aTogY3ljbGUgKGNhcm91c2VsIG51ZGdlLCBzdGFuZGFyZCBkaXJlY3Rpb24pXG4vLyAgIG1pZGRsZS1jbGljayBcdTIwMTQgbmV3IHdpbmRvdyBcdTAwQjcgcmlnaHQtY2xpY2sgXHUyMDE0IGNvbnRleHQgbWVudSAod2luZG93cyBsaXN0ICsgUXVpdClcbi8vIERPVFM6IGFic29sdXRlIG92ZXJsYXkgKEd0ay5PdmVybGF5KSwgc2xpZGluZyA0LWRvdCB2aWV3cG9ydCwgZWRnZSBtaW5pcyBwYXN0IDQsXG4vLyBkeWluZy1kb3QgY2xvc2UgYW5pbWF0aW9uLiBJY29ucyBvd24gQUxMIGdlb21ldHJ5LlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBiaW5kLCBWYXJpYWJsZSwgZXhlY0FzeW5jIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgeyBNT1RJT04sIHNwcmluZywgc3ByaW5nVG8gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgKiBhcyBnbm9ibGluIGZyb20gXCIuLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCB7IERFTU8gfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCBQSU5ORUQgPSBbXG4gIFwib3JnLmdub21lLlB0eXhpc1wiLCBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiLCBcImZpcmVmb3hcIixcbiAgXCJkZXYuemVkLlplZFwiLCBcImNvbS5zcG90aWZ5LkNsaWVudFwiLCBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiLFxuXVxuXG5mdW5jdGlvbiBEb3RzKHsgYXBwSWQgfTogeyBhcHBJZDogc3RyaW5nIH0pIHtcbiAgLy8gU2xpZGluZyB2aWV3cG9ydCBpZGVudGljYWwgdG8gdGhlIHByb3RvdHlwZTogXHUyMjY0NCBkb3RzLCBmb2N1c2VkIHBpbGwsXG4gIC8vIG1pbmlzIHdoZW4gd2luZG93cyBleGlzdCBiZXlvbmQgdGhlIHZpc2libGUgc2xpY2UuXG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZG90c1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfSBzcGFjaW5nPXszfT5cbiAgICB7YmluZChnbm9ibGluLndpbmRvd3MpLmFzKCgpID0+IHtcbiAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgY29uc3QgdG90YWwgPSB3cy5sZW5ndGhcbiAgICAgIGNvbnN0IG4gPSBNYXRoLm1pbih0b3RhbCwgNClcbiAgICAgIGNvbnN0IGN1ciA9IHdzLmZpbmRJbmRleCh3ID0+IHcuZm9jdXNlZClcbiAgICAgIGxldCBzdGFydCA9IDBcbiAgICAgIGlmICh0b3RhbCA+IDQpIHN0YXJ0ID0gTWF0aC5taW4oTWF0aC5tYXgoKGN1ciA8IDAgPyAwIDogY3VyKSAtIDEsIDApLCB0b3RhbCAtIDQpXG4gICAgICByZXR1cm4gQXJyYXkuZnJvbSh7IGxlbmd0aDogbiB9LCAoXywgaSkgPT4ge1xuICAgICAgICBjb25zdCBpZHggPSBzdGFydCArIGlcbiAgICAgICAgY29uc3QgY2xzID0gW1wiZG90XCJdXG4gICAgICAgIGlmIChjdXIgPj0gMCAmJiBpZHggPT09IGN1cikgY2xzLnB1c2goXCJvblwiKVxuICAgICAgICBpZiAodG90YWwgPiA0ICYmICgoaSA9PT0gMCAmJiBzdGFydCA+IDApIHx8IChpID09PSBuIC0gMSAmJiBzdGFydCArIDQgPCB0b3RhbCkpKVxuICAgICAgICAgIGNscy5wdXNoKFwibWluaVwiKVxuICAgICAgICByZXR1cm4gPGJveCBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgfSlcbiAgICB9KX1cbiAgPC9ib3g+XG59XG5cbmZ1bmN0aW9uIERvY2tCdXR0b24oeyBhcHAgfTogeyBhcHA6IEFwcHMuQXBwbGljYXRpb24gfSkge1xuICBjb25zdCBhcHBJZCA9IGFwcC5lbnRyeS5yZXBsYWNlKC9cXC5kZXNrdG9wJC8sIFwiXCIpXG5cbiAgY29uc3Qgb25DbGljayA9ICgpID0+IHtcbiAgICBjb25zdCB3cyA9IGdub2JsaW4uYXBwV2luZG93cyhhcHBJZClcbiAgICBpZiAoIXdzLmxlbmd0aCkgcmV0dXJuIHZvaWQgYXBwLmxhdW5jaCgpICAgICAgICAgIC8vICsgZ2hvc3Qgem9vbSAocmV2ZWFsZXIgc2NhbGUgYW5pbSlcbiAgICBjb25zdCBmb2N1c2VkID0gd3MuZmluZCh3ID0+IHcuZm9jdXNlZClcbiAgICBpZiAoIWZvY3VzZWQpIHJldHVybiB2b2lkIGdub2JsaW4uYWN0aXZhdGUoXG4gICAgICB3cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmZvY3VzZWQpIC0gTnVtYmVyKGEuZm9jdXNlZCkpWzBdLmlkKVxuICAgIGlmICh3cy5sZW5ndGggPiAxKSByZXR1cm4gdm9pZCBnbm9ibGluLmN5Y2xlKGFwcElkLCAxKVxuICAgIGdub2JsaW4ubWluaW1pemUoZm9jdXNlZC5pZClcbiAgfVxuXG4gIHJldHVybiA8YnV0dG9uXG4gICAgY2xhc3M9XCJkYnRuXCIgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfVxuICAgIG9uQ2xpY2tlZD17b25DbGlja31cbiAgICBvbkJ1dHRvblByZXNzZWQ9eyhfdywgZSkgPT4geyAgICAgICAgICAgLy8gbWlkZGxlLWNsaWNrIFx1MjE5MiBuZXcgd2luZG93XG4gICAgICBpZiAoZS5nZXRfYnV0dG9uKCkgPT09IEdkay5CVVRUT05fTUlERExFKSBhcHAubGF1bmNoKClcbiAgICB9fVxuICAgIG9uU2Nyb2xsPXsoX3csIF9keCwgZHkpID0+IHtcbiAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgaWYgKCF3cy5sZW5ndGgpIHJldHVyblxuICAgICAgaWYgKHdzLmxlbmd0aCA+IDEpIGdub2JsaW4uY3ljbGUoYXBwSWQsIGR5ID4gMCA/IDEgOiAtMSlcbiAgICAgIGVsc2UgaWYgKCF3c1swXS5mb2N1c2VkKSBnbm9ibGluLmFjdGl2YXRlKHdzWzBdLmlkKVxuICAgIH19PlxuICAgIDxvdmVybGF5PlxuICAgICAgPGltYWdlIGNsYXNzPVwiaWNvbi10aWxlXCIgaWNvbk5hbWU9e2FwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIn1cbiAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfSAvPlxuICAgICAgey8qIGRvdHMgYXMgT1ZFUkxBWSBcdTIwMTQgemVybyBsYXlvdXQgZm9vdHByaW50ICovfVxuICAgICAgPERvdHMgdHlwZT1cIm92ZXJsYXlcIiBhcHBJZD17YXBwSWR9IC8+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuZnVuY3Rpb24gTWVkaWFXaWRnZXQoKSB7XG4gIC8vIGRvY2sgd2lkZ2V0IHByb29mLW9mLWNvbmNlcHQ6IGFsYnVtIGdseXBoIChyb3VuZGVkIGNoaXApICsgbGl2ZSBwcm9ncmVzcywgY2xpY2sgPSBwbGF5L3BhdXNlXG4gIHJldHVybiA8YnV0dG9uIGNsYXNzPVwiZGJ0biBkd2lkZ2V0XCIgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJwbGF5ZXJjdGwgcGxheS1wYXVzZVwiKX0+XG4gICAgPG92ZXJsYXk+XG4gICAgICA8Ym94IGNsYXNzPVwiZHRpbGVcIj5cbiAgICAgICAgPGltYWdlIGNsYXNzPVwiZGdcIiBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCIgcGl4ZWxTaXplPXsxOH1cbiAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBoZXhwYW5kIHZleHBhbmQgLz5cbiAgICAgIDwvYm94PlxuICAgICAgPGxldmVsYmFyIHR5cGU9XCJvdmVybGF5XCIgY2xhc3M9XCJtcHJvZ1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgIHZhbHVlPXswLjM0fSAvPlxuICAgIDwvb3ZlcmxheT5cbiAgPC9idXR0b24+XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gREVNTyBtb2RlOiByZW5kZXIgdGhlIHByb3RvdHlwZSdzIEVYQUNUIGRvY2sgKGRvY3MvcHJvdG90eXBlLmh0bWwpIHdpdGggcmVhbCBHVEtcbi8vIHdpZGdldHMsIHNvIGl0IGNhbiBiZSBwaXhlbC1vdmVybGFpZCBvbiB0aGUgcHJvdG90eXBlIHJlbmRlciAxOjEuIEljb25zIGxvYWQgZnJvbSB0aGVcbi8vIFNBTUUgb24tZGlzayBmaWxlcyB0aGUgcHJvdG90eXBlIHJlZmVyZW5jZXMgKHZpYSBhIEZpbGVJY29uIGdpY29uKSByYXRoZXIgdGhhbiBieVxuLy8gdGhlbWVkIG5hbWUgXHUyMDE0IGEgdGhlbWVkIGxvb2t1cCBzbmFwcyB0byBhIGRpZmZlcmVudCBzaXplIHZhcmlhbnQgKGUuZy4gdGhlIDMycHggZmlyZWZveFxuLy8gaW5zdGVhZCBvZiB0aGUgcHJvdG90eXBlJ3MgMjU2cHggcG5nKSBhbmQgZG93bnNjYWxlcyBkaWZmZXJlbnRseS4gU2FtZSBzb3VyY2UgZmlsZSBcdTIxOTJcbi8vIGNsb3Nlc3QgY3Jvc3MtZW5naW5lIG1hdGNoLiAocGl4ZWwtc2l6ZSBpcyBob25vdXJlZCBub3cgdGhlIGljb24tdGlsZSBtaW4gaXMgMzAuKVxuY29uc3QgREVNT19BUFBTID0gW1xuICB7IG5hbWU6IFwiVGVybWluYWxcIiwgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuUHR5eGlzLnN2Z1wiLCAgICAgICAgICAgZG90czogW1wib25cIiwgXCJkb3RcIl0gfSxcbiAgeyBuYW1lOiBcIkZpbGVzXCIsICAgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLk5hdXRpbHVzLnN2Z1wiLCAgICAgICAgIGRvdHM6IFtcImRvdFwiXSB9LFxuICB7IG5hbWU6IFwiRmlyZWZveFwiLCAgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3IvMjU2eDI1Ni9hcHBzL2ZpcmVmb3gucG5nXCIsICAgICAgICAgICAgICAgICAgICAgZG90czogW10gfSxcbiAgeyBuYW1lOiBcIlplZFwiLCAgICAgIGljb246IFwiL2hvbWUva2llcmFuLy5sb2NhbC96ZWQuYXBwL3NoYXJlL2ljb25zL2hpY29sb3IvNTEyeDUxMi9hcHBzL3plZC5wbmdcIiwgIGRvdHM6IFtdIH0sXG4gIHsgbmFtZTogXCJTcG90aWZ5XCIsICBpY29uOiBcIi92YXIvbGliL2ZsYXRwYWsvZXhwb3J0cy9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvY29tLnNwb3RpZnkuQ2xpZW50LnN2Z1wiLCBkb3RzOiBbXSB9LFxuICB7IG5hbWU6IFwiU2V0dGluZ3NcIiwgaWNvbjogXCIvdXNyL3NoYXJlL2ljb25zL2hpY29sb3Ivc2NhbGFibGUvYXBwcy9vcmcuZ25vbWUuU2V0dGluZ3Muc3ZnXCIsICAgICAgICAgZG90czogW10gfSxcbl1cblxuZnVuY3Rpb24gZmlsZUljb24ocGF0aDogc3RyaW5nKTogR2lvLkljb24ge1xuICByZXR1cm4gR2lvLkZpbGVJY29uLm5ldyhHaW8uRmlsZS5uZXdfZm9yX3BhdGgocGF0aCkpXG59XG5cbmZ1bmN0aW9uIERlbW9CdXR0b24oeyBhcHAgfTogeyBhcHA6ICh0eXBlb2YgREVNT19BUFBTKVtudW1iZXJdIH0pIHtcbiAgLy8gTkI6IHRoZSBkb3RzIGJveCBjYXJyaWVzIGB0eXBlPVwib3ZlcmxheVwiYCBESVJFQ1RMWSAoaW50cmluc2ljIGVsZW1lbnQpIFx1MjAxNCBhIGZ1bmN0aW9uXG4gIC8vIGNvbXBvbmVudCB3b3VsZCBzd2FsbG93IHRoZSBwcm9wLCBsZXR0aW5nIHRoZSB1bnR5cGVkIGJveCByZXBsYWNlIHRoZSBpY29uIGFzIHRoZVxuICAvLyBvdmVybGF5J3MgbWFpbiBjaGlsZCAoR3RrT3ZlcmxheS5zZXRfY2hpbGQpLiBJY29uIHN0YXlzIG1haW47IGRvdHMgb3ZlcmxheSBvbiB0b3AuXG4gIHJldHVybiA8YnV0dG9uIGNsYXNzPVwiZGJ0blwiIHRvb2x0aXBUZXh0PXthcHAubmFtZX0+XG4gICAgPG92ZXJsYXk+XG4gICAgICA8aW1hZ2UgY2xhc3M9XCJpY29uLXRpbGVcIiBnaWNvbj17ZmlsZUljb24oYXBwLmljb24pfSBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgPGJveCB0eXBlPVwib3ZlcmxheVwiIGNsYXNzPVwiZG90c1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfSBzcGFjaW5nPXszfT5cbiAgICAgICAge2FwcC5kb3RzLm1hcChjbHMgPT4gPGJveCBjbGFzcz17Y2xzID09PSBcIm9uXCIgPyBcImRvdCBvblwiIDogXCJkb3RcIn0gLz4pfVxuICAgICAgPC9ib3g+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuZnVuY3Rpb24gRGVtb0RvY2sobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwiZG9ja1wiIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIiBjbGFzcz1cImRvY2std2luZG93XCJcbiAgICBnZGttb25pdG9yPXttb25pdG9yfSBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5CT1RUT019PlxuICAgIDxib3ggY2xhc3M9XCJkb2NrXCIgc3BhY2luZz17NH0+XG4gICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1swXX0gLz5cbiAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzFdfSAvPlxuICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMl19IC8+XG4gICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1szXX0gLz5cbiAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1s0XX0gLz5cbiAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzVdfSAvPlxuICAgICAgPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgIDxNZWRpYVdpZGdldCAvPlxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gRG9jayhtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICBpZiAoREVNTykgcmV0dXJuIERlbW9Eb2NrKG1vbml0b3IpXG5cbiAgY29uc3QgYXBwcyA9IG5ldyBBcHBzLkFwcHMoKVxuICAvLyBQaW5uZWQgZW50cmllcyByZXNvbHZlZCBieSBkZXNrdG9wLWlkOyB0aGUgZG9jayBuZXZlciBzaXRzIGVtcHR5LCBzbyBmaWxsIGFueVxuICAvLyB1bnJlc29sdmVkIHNsb3RzIChlLmcuIGFuIGFwcCBub3QgaW5zdGFsbGVkIGluIHRoZSBkZXZraXQpIGZyb20gdGhlIGluc3RhbGxlZFxuICAvLyBsaXN0LiBPbiByZWFsIGhhcmR3YXJlIHRoZSBwaW5zIHJlc29sdmUgYW5kIHRoZSBmaWxsIGlzIHVudXNlZC5cbiAgY29uc3QgYWxsID0gYXBwcy5nZXRfbGlzdCgpXG4gIGNvbnN0IHJlc29sdmUgPSAoaWQ6IHN0cmluZyk6IEFwcHMuQXBwbGljYXRpb24gfCB1bmRlZmluZWQgPT5cbiAgICBhbGwuZmluZChhID0+IGEuZW50cnkgPT09IGAke2lkfS5kZXNrdG9wYCB8fCBhLmVudHJ5ID09PSBpZClcbiAgICA/PyBhbGwuZmluZChhID0+IGEuZW50cnk/LnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMoaWQudG9Mb3dlckNhc2UoKS5zcGxpdChcIi5cIikucG9wKCkhKSlcbiAgLy8gQWx3YXlzIHJlbmRlciBvbmUgc2xvdCBwZXIgcGluIHNvIHRoZSBkb2NrIGtlZXBzIGl0cyBzaGFwZTsgcmVzb2x2ZWQgcGlucyBnZXQgdGhlXG4gIC8vIHJlYWwgYXBwICsgYmVoYXZpb3IsIHVucmVzb2x2ZWQgb25lcyBhIGxhYmVsbGVkIHBsYWNlaG9sZGVyIHRpbGUuIEEgc2VwYXJhdG9yIHNpdHNcbiAgLy8gYmV0d2VlbiB0aGUgZm91cnRoIGFuZCBmaWZ0aCBwaW5zIChwcm90b3R5cGUgcGFyaXR5KSwgdGhlbiBiZWZvcmUgdGhlIG1lZGlhIHdpZGdldC5cbiAgY29uc3Qgc2xvdHMgPSBQSU5ORUQubWFwKGlkID0+ICh7IGlkLCBhcHA6IHJlc29sdmUoaWQpIH0pKVxuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJkb2NrXCIgbmFtZXNwYWNlPVwia29iZWwtZG9ja1wiIGNsYXNzPVwiZG9jay13aW5kb3dcIlxuICAgIGdka21vbml0b3I9e21vbml0b3J9IGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLkJPVFRPTX0+XG4gICAgPGJveCBjbGFzcz1cImRvY2tcIiBzcGFjaW5nPXs0fT5cbiAgICAgIHtzbG90cy5tYXAoKHsgaWQsIGFwcCB9LCBpKSA9PiBbXG4gICAgICAgIGkgPT09IDQgPyA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPiA6IG51bGwsXG4gICAgICAgIGFwcFxuICAgICAgICAgID8gPERvY2tCdXR0b24gYXBwPXthcHB9IC8+XG4gICAgICAgICAgOiA8YnV0dG9uIGNsYXNzPVwiZGJ0biBwbGFjZWhvbGRlclwiIHRvb2x0aXBUZXh0PXtpZC5zcGxpdChcIi5cIikucG9wKCl9PlxuICAgICAgICAgICAgICA8aW1hZ2UgY2xhc3M9XCJpY29uLXRpbGVcIiBpY29uTmFtZT1cImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZS1zeW1ib2xpY1wiIHBpeGVsU2l6ZT17MzB9IC8+XG4gICAgICAgICAgICA8L2J1dHRvbj4sXG4gICAgICBdKX1cbiAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICA8TWVkaWFXaWRnZXQgLz5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gVGhlIHNwb3RsaWdodC4gUHJvdG90eXBlLWZpbmFsIGJlaGF2aW9yOlxuLy8gICBTdXBlciByZWxlYXNlIG9wZW5zIChjb21wb3NpdG9yIGtleWJpbmQgXHUyMTkyIGBhc3RhbCAtaSBrb2JlbCAtdCBsYXVuY2hlcmApXG4vLyAgIGZ1enp5ICsgbGVhZiBoaWdobGlnaHQgXHUwMEI3IGdsb2JhbCBCRVNULU1BVENIIHNsb3QgKHNjb3JlLXJhbmtlZCBhY3Jvc3MgcHJvdmlkZXJzLFxuLy8gICB0eXBlIHdlaWdodHMgYXBwcyAxIC8gYWN0aW9ucyAuOTUgLyBmaWxlcyAuOSkgXHUwMEI3IGNhcHBlZCBsb2cyIGZyZWNlbmN5XG4vLyAgIGdob3N0IGF1dG9jb21wbGV0ZSA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXJcbi8vICAgVGFiIGFsd2F5cyBvd25lZCAoZ2hvc3QgZWxzZSBuZXh0OyBTaGlmdCtUYWIgcHJldikgXHUwMEI3IEN0cmwrTi9QIFx1MDBCNyBFc2MgY2xlYXJzIGZpcnN0XG4vLyAgIHNlY3Rpb25zOiBiZXN0IG1hdGNoIC8gYXBwcyAvIGFjdGlvbnMgLyBmaWxlcyAvIHdlYiAoYWx3YXlzLWxhc3QgcmVhbCByb3cpXG4vLyAgICc9JyBjYWxjdWxhdG9yIFx1MDBCNyAnOicgZ25vYmxpbmN0bCBjb21tYW5kcyBcdTAwQjcgZW1wdHkgc3RhdGU6IGRvY2stdGlsZSBncmlkICsgd2lkZ2V0c1xuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgZXhlY0FzeW5jLCBHTGliIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgeyBmdXp6eSwgaGwsIGJvb3N0LCBidW1wLCBmcmVxdWVuY3kgfSBmcm9tIFwiLi4vbGliL2Z1enp5XCJcbmltcG9ydCB7IEVWRU5UUyB9IGZyb20gXCIuL0NhbGVuZGFyXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG4vLyBDdXJhdGVkIGdyaWQ6IHRoZSBkb2NrJ3MgcGlubmVkIGFwcHMgZmlyc3QgKHJlc29sdmVkIGJ5IGRlc2t0b3AtaWQpLCB0aGVuIGZpbGwgdGhlXG4vLyByZW1haW5pbmcgc2xvdHMgYnkgZnJlY2VuY3kuIE1hdGNoZXMgdGhlIHByb3RvdHlwZSdzIGxhdW5jaGVyIGVtcHR5LXN0YXRlLlxuY29uc3QgUElOTkVEID0gW1wib3JnLmdub21lLlB0eXhpc1wiLCBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiLCBcImZpcmVmb3hcIixcbiAgXCJkZXYuemVkLlplZFwiLCBcImNvbS5zcG90aWZ5LkNsaWVudFwiLCBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiXVxuLy8gRGVtbyBncmlkOiBmaXhlZCBvcmRlciArIGxhYmVscyB0cmFuc2NyaWJlZCBmcm9tIHRoZSBwcm90b3R5cGUgKEQuYXBwcyksIGVhY2ggbWFwcGVkXG4vLyB0byB0aGUgcmVhbCAuZGVza3RvcCBpZCBzbyBpdHMgdGhlbWVkIGljb24gcmVuZGVycyAoUHR5eGlzL05hdXRpbHVzL1x1MjAyNikuXG5jb25zdCBERU1PX1RJTEVTID0gW1xuICB7IG5hbWU6IFwiVGVybWluYWxcIiwgaWQ6IFwib3JnLmdub21lLlB0eXhpc1wiIH0sXG4gIHsgbmFtZTogXCJGaWxlc1wiLCBpZDogXCJvcmcuZ25vbWUuTmF1dGlsdXNcIiB9LFxuICB7IG5hbWU6IFwiRmlyZWZveFwiLCBpZDogXCJmaXJlZm94XCIgfSxcbiAgeyBuYW1lOiBcIlplZFwiLCBpZDogXCJkZXYuemVkLlplZFwiIH0sXG4gIHsgbmFtZTogXCJTcG90aWZ5XCIsIGlkOiBcImNvbS5zcG90aWZ5LkNsaWVudFwiIH0sXG4gIHsgbmFtZTogXCJTZXR0aW5nc1wiLCBpZDogXCJvcmcuZ25vbWUuU2V0dGluZ3NcIiB9LFxuXVxuXG5pbnRlcmZhY2UgVGlsZSB7IG5hbWU6IHN0cmluZzsgaWNvbk5hbWU6IHN0cmluZzsgbGF1bmNoOiAoKSA9PiB2b2lkIH1cbmZ1bmN0aW9uIGdyaWRUaWxlcyhhcHBzOiBBcHBzLkFwcHMpOiBUaWxlW10ge1xuICBjb25zdCBhbGwgPSBhcHBzLmdldF9saXN0KClcbiAgY29uc3QgcmVzb2x2ZSA9IChpZDogc3RyaW5nKTogQXBwcy5BcHBsaWNhdGlvbiB8IHVuZGVmaW5lZCA9PlxuICAgIGFsbC5maW5kKGEgPT4gYS5lbnRyeSA9PT0gYCR7aWR9LmRlc2t0b3BgIHx8IGEuZW50cnkgPT09IGlkKVxuICAgID8/IGFsbC5maW5kKGEgPT4gYS5lbnRyeT8udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhpZC50b0xvd2VyQ2FzZSgpLnNwbGl0KFwiLlwiKS5wb3AoKSEpKVxuICBjb25zdCBmcm9tQXBwID0gKGFwcDogQXBwcy5BcHBsaWNhdGlvbik6IFRpbGUgPT4gKHtcbiAgICBuYW1lOiBhcHAubmFtZSwgaWNvbk5hbWU6IGFwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIixcbiAgICBsYXVuY2g6ICgpID0+IHsgYnVtcChhcHAubmFtZSk7IGFwcC5sYXVuY2goKSB9LFxuICB9KVxuICBpZiAoREVNTykgcmV0dXJuIERFTU9fVElMRVMubWFwKCh7IG5hbWUsIGlkIH0pID0+IHtcbiAgICBjb25zdCBhcHAgPSByZXNvbHZlKGlkKVxuICAgIHJldHVybiB7IG5hbWUsIGljb25OYW1lOiBhcHA/Lmljb25fbmFtZSB8fCBpZCB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgbGF1bmNoOiAoKSA9PiB7IGJ1bXAobmFtZSk7IGFwcD8ubGF1bmNoKCkgfSB9XG4gIH0pXG4gIGNvbnN0IHBpbm5lZCA9IFBJTk5FRC5tYXAocmVzb2x2ZSkuZmlsdGVyKEJvb2xlYW4pIGFzIEFwcHMuQXBwbGljYXRpb25bXVxuICBjb25zdCByZXN0ID0gYWxsLmZpbHRlcihhID0+ICFwaW5uZWQuaW5jbHVkZXMoYSkpXG4gICAgLnNvcnQoKHgsIHkpID0+IGZyZXF1ZW5jeSh5Lm5hbWUpIC0gZnJlcXVlbmN5KHgubmFtZSkpXG4gIHJldHVybiBbLi4ucGlubmVkLCAuLi5yZXN0XS5zbGljZSgwLCA2KS5tYXAoZnJvbUFwcClcbn1cbmZ1bmN0aW9uIHRvZGF5RXZlbnRMYWJlbCgpOiBzdHJpbmcge1xuICBpZiAoREVNTykgcmV0dXJuIEQud2lkZ2V0RXZlbnRcbiAgY29uc3QgZCA9IG5ldyBEYXRlKClcbiAgY29uc3QgZXZzID0gRVZFTlRTW2Ake2QuZ2V0RnVsbFllYXIoKX0tJHtkLmdldE1vbnRoKCkgKyAxfS0ke2QuZ2V0RGF0ZSgpfWBdID8/IFtdXG4gIHJldHVybiBldnMubGVuZ3RoID8gYCR7ZXZzWzBdLnR9IFx1MDBCNyAke2V2c1swXS5ufWAgOiBcIk5vIGV2ZW50cyB0b2RheVwiXG59XG5mdW5jdGlvbiB0b2RheURhdGVMYWJlbCgpOiBzdHJpbmcge1xuICByZXR1cm4gREVNTyA/IEQud2lkZ2V0RGF0ZVxuICAgIDogbmV3IERhdGUoKS50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7IHdlZWtkYXk6IFwibG9uZ1wiLCBkYXk6IFwibnVtZXJpY1wiLCBtb250aDogXCJsb25nXCIgfSlcbn1cblxuaW50ZXJmYWNlIFJvdyB7XG4gIG5hbWU6IHN0cmluZzsgaWNvbjogc3RyaW5nOyBoaW50OiBzdHJpbmc7IHNjb3JlOiBudW1iZXJcbiAgbWFya3VwOiBzdHJpbmc7IHJ1bjogKCkgPT4gdm9pZFxufVxuXG5jb25zdCBBQ1RJT05TID0gW1xuICB7IG46IFwiU3VzcGVuZFwiLCBpY29uOiBcImtvYmVsLW1vb24tc3ltYm9saWNcIiwgZDogXCJTbGVlcCBcdTIwMTQgcmVzdW1lIGluc3RhbnRseVwiLFxuICAgIGFsOiBbXCJzbGVlcFwiXSwgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgc3VzcGVuZFwiKSB9LFxuICB7IG46IFwiTG9ja1wiLCBpY29uOiBcImtvYmVsLWxvY2stc3ltYm9saWNcIiwgZDogXCJMb2NrIHRoZSBzZXNzaW9uXCIsXG4gICAgYWw6IFtcImxvY2sgc2NyZWVuXCJdLCBydW46ICgpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKSB9LFxuICB7IG46IFwiTG9nIE91dFwiLCBpY29uOiBcImtvYmVsLWxvZ291dC1zeW1ib2xpY1wiLCBkOiBcIkVuZCB0aGlzIHNlc3Npb25cIixcbiAgICBhbDogW1wiZXhpdFwiLCBcInNpZ24gb3V0XCIsIFwibG9nb3V0XCJdLCBydW46ICgpID0+IEFwcC50b2dnbGVfd2luZG93KFwic2Vzc2lvblwiKSB9LFxuICB7IG46IFwiUmVzdGFydFwiLCBpY29uOiBcImtvYmVsLXJlbG9hZC1zeW1ib2xpY1wiLCBkOiBcIlJlYm9vdCB0aGUgbWFjaGluZVwiLFxuICAgIGFsOiBbXCJyZWJvb3RcIl0sIHJ1bjogKCkgPT4gQXBwLnRvZ2dsZV93aW5kb3coXCJzZXNzaW9uXCIpIH0sXG4gIHsgbjogXCJTaHV0IERvd25cIiwgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLCBkOiBcIlBvd2VyIG9mZlwiLFxuICAgIGFsOiBbXCJwb3dlcm9mZlwiLCBcImhhbHRcIl0sIHJ1bjogKCkgPT4gQXBwLnRvZ2dsZV93aW5kb3coXCJzZXNzaW9uXCIpIH0sXG4gIHsgbjogXCJTb2Z0LXJlbG9hZCBnbm9ibGluXCIsIGljb246IFwia29iZWwtcmVsb2FkLXN5bWJvbGljXCIsXG4gICAgZDogXCJSZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIiwgYWw6IFtdLFxuICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwiZ25vYmxpbmN0bCByZWxvYWRcIikgfSxcbl1cblxuY29uc3QgQ01EUyA9IFtcbiAgeyBjOiBcInJlbG9hZFwiLCBkOiBcIlNvZnQtcmVsb2FkIHRoZSBzaGVsbCBcdTIwMTQgd2luZG93cyBzdXJ2aXZlXCIgfSxcbiAgeyBjOiBcIm9zZCBvZmZcIiwgZDogXCJrb2JlbCBvd25zIHZvbHVtZS9icmlnaHRuZXNzIHBvcHVwc1wiIH0sXG4gIHsgYzogXCJub3RpZnMgb2ZmXCIsIGQ6IFwiUmVsZWFzZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9uc1wiIH0sXG4gIHsgYzogXCJncmFudHNcIiwgZDogXCJTY3JlZW4tcmVjb3JkaW5nIGFjY2VzcyBwZXIgYXBwXCIgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gTGF1bmNoZXIoKSB7XG4gIGNvbnN0IGFwcHMgPSBuZXcgQXBwcy5BcHBzKClcbiAgLy8gS09CRUxfUVVFUlkgcHJlLWZpbGxzIHRoZSBzZWFyY2ggc28gdGhlIGRldmtpdCBjYW4gcmVuZGVyIHRoZSByZXN1bHRzIHN0YXRlLlxuICBjb25zdCBxdWVyeSA9IFZhcmlhYmxlKEdMaWIuZ2V0ZW52KFwiS09CRUxfUVVFUllcIikgfHwgXCJcIilcbiAgY29uc3Qgc2VsZWN0ZWQgPSBWYXJpYWJsZSgwKVxuICBjb25zdCBnaG9zdCA9IFZhcmlhYmxlKFwiXCIpXG5cbiAgZnVuY3Rpb24gcmVzdWx0cyhxOiBzdHJpbmcpOiB7IHNlY3Rpb246IHN0cmluZywgcm93czogUm93W10gfVtdIHtcbiAgICBjb25zdCBxdCA9IHEudHJpbSgpXG4gICAgaWYgKCFxdCkgcmV0dXJuIFtdXG4gICAgaWYgKHF0LnN0YXJ0c1dpdGgoXCI6XCIpKSB7XG4gICAgICBjb25zdCBjcSA9IHF0LnNsaWNlKDEpLnRyaW0oKVxuICAgICAgcmV0dXJuIFt7XG4gICAgICAgIHNlY3Rpb246IFwiZ25vYmxpbmN0bFwiLFxuICAgICAgICByb3dzOiBDTURTLmZpbHRlcihjID0+IGMuYy5zdGFydHNXaXRoKGNxKSkubWFwKGMgPT4gKHtcbiAgICAgICAgICBuYW1lOiBgOiR7Yy5jfWAsIGljb246IFwia29iZWwtdGVybWluYWwtc3ltYm9saWNcIiwgaGludDogYy5kLCBzY29yZTogOTksXG4gICAgICAgICAgbWFya3VwOiBgOiR7Yy5jfWAsIHJ1bjogKCkgPT4gZXhlY0FzeW5jKGBnbm9ibGluY3RsICR7Yy5jfWApLFxuICAgICAgICB9KSksXG4gICAgICB9XVxuICAgIH1cbiAgICBjb25zdCBvdXQ6IHsgc2VjdGlvbjogc3RyaW5nLCByb3dzOiBSb3dbXSB9W10gPSBbXVxuICAgIC8vICc9JyBjYWxjdWxhdG9yIChjaGFyc2V0LWd1YXJkZWQsIHNhbWUgYXMgcHJvdG90eXBlKVxuICAgIGlmICgvXj0/WzAtOStcXC0qLygpLiBdKyQvLnRlc3QocXQpICYmIC9bMC05XS8udGVzdChxdCkgJiYgL1srXFwtKi9dLy50ZXN0KHF0KSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgdiA9IEZ1bmN0aW9uKGBcInVzZSBzdHJpY3RcIjtyZXR1cm4oJHtxdC5yZXBsYWNlKC9ePS8sIFwiXCIpfSlgKSgpXG4gICAgICAgIGlmIChOdW1iZXIuaXNGaW5pdGUodikpIG91dC5wdXNoKHtcbiAgICAgICAgICBzZWN0aW9uOiBcImNhbGN1bGF0b3JcIixcbiAgICAgICAgICByb3dzOiBbeyBuYW1lOiBTdHJpbmcodiksIGljb246IFwia29iZWwtY2FsY3VsYXRvci1zeW1ib2xpY1wiLFxuICAgICAgICAgICAgaGludDogYCR7cXQucmVwbGFjZSgvXj0vLCBcIlwiKX0gPWAsIHNjb3JlOiA5OCwgbWFya3VwOiBTdHJpbmcodiksXG4gICAgICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhbXCJ3bC1jb3B5XCIsIFN0cmluZyh2KV0pIH1dLFxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCB7IH1cbiAgICB9XG4gICAgY29uc3QgYXBwUm93czogUm93W10gPSBhcHBzLmZ1enp5X3F1ZXJ5KHF0KS5zbGljZSgwLCA1KS5tYXAoYSA9PiB7XG4gICAgICBjb25zdCBtID0gZnV6enkocXQsIGEubmFtZSkgPz8geyBzY29yZTogMSwgbWFya3M6IG51bGwgYXMgYW55IH1cbiAgICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IGEubmFtZSwgaWNvbjogYS5pY29uX25hbWUgPz8gXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIixcbiAgICAgICAgaGludDogXCJBcHBsaWNhdGlvblwiLCBzY29yZTogbS5zY29yZSArIGJvb3N0KGEubmFtZSksXG4gICAgICAgIG1hcmt1cDogaGwoYS5uYW1lLCBtLm1hcmtzKSxcbiAgICAgICAgcnVuOiAoKSA9PiB7IGJ1bXAoYS5uYW1lKTsgYS5sYXVuY2goKSB9LFxuICAgICAgfVxuICAgIH0pXG4gICAgY29uc3QgYWN0Um93czogUm93W10gPSBBQ1RJT05TLm1hcCh4ID0+IHtcbiAgICAgIGxldCBtID0gZnV6enkocXQsIHgubilcbiAgICAgIGlmICghbSkgZm9yIChjb25zdCBhbCBvZiB4LmFsKSB7IGNvbnN0IGFtID0gZnV6enkocXQsIGFsKTsgaWYgKGFtKSB7IG0gPSB7IHNjb3JlOiBhbS5zY29yZSAtIC41LCBtYXJrczogbnVsbCBhcyBhbnkgfTsgYnJlYWsgfSB9XG4gICAgICByZXR1cm4gbSA/IHsgbmFtZTogeC5uLCBpY29uOiB4Lmljb24sIGhpbnQ6IHguZCwgc2NvcmU6IG0uc2NvcmUgKiAuOTUsXG4gICAgICAgIG1hcmt1cDogaGwoeC5uLCAobSBhcyBhbnkpLm1hcmtzKSwgcnVuOiB4LnJ1biB9IGFzIFJvdyA6IG51bGxcbiAgICB9KS5maWx0ZXIoQm9vbGVhbikgYXMgUm93W11cbiAgICAvLyBnbG9iYWwgYmVzdC1tYXRjaCBzbG90IChjcml0aXF1ZSBBMSlcbiAgICBjb25zdCBhbGwgPSBbLi4uYXBwUm93cywgLi4uYWN0Um93c10uc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpXG4gICAgY29uc3QgYmVzdCA9IGFsbFswXVxuICAgIGlmIChiZXN0KSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYmVzdCBtYXRjaFwiLCByb3dzOiBbYmVzdF0gfSlcbiAgICBjb25zdCByZXN0ID0gKHJvd3M6IFJvd1tdKSA9PiByb3dzLmZpbHRlcihyID0+IHIgIT09IGJlc3QpXG4gICAgaWYgKHJlc3QoYXBwUm93cykubGVuZ3RoKSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYXBwc1wiLCByb3dzOiByZXN0KGFwcFJvd3MpIH0pXG4gICAgaWYgKHJlc3QoYWN0Um93cykubGVuZ3RoKSBvdXQucHVzaCh7IHNlY3Rpb246IFwiYWN0aW9uc1wiLCByb3dzOiByZXN0KGFjdFJvd3MpLnNsaWNlKDAsIDMpIH0pXG4gICAgb3V0LnB1c2goe1xuICAgICAgc2VjdGlvbjogXCJ3ZWJcIixcbiAgICAgIHJvd3M6IFt7IG5hbWU6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLCBpY29uOiBcImtvYmVsLWdsb2JlLXN5bWJvbGljXCIsXG4gICAgICAgIGhpbnQ6IFwiXCIsIHNjb3JlOiAwLCBtYXJrdXA6IGBTZWFyY2ggdGhlIHdlYiBmb3IgXHUyMDFDJHtxdH1cdTIwMURgLFxuICAgICAgICBydW46ICgpID0+IGV4ZWNBc3luYyhbXCJ4ZGctb3BlblwiLCBgaHR0cHM6Ly9kdWNrZHVja2dvLmNvbS8/cT0ke2VuY29kZVVSSUNvbXBvbmVudChxdCl9YF0pIH1dLFxuICAgIH0pXG4gICAgLy8gZ2hvc3QgPSBmaXJzdCBwcmVmaXgtY29tcGxldGFibGUgbmFtZSBpbiBkaXNwbGF5IG9yZGVyIChjcml0aXF1ZSBBNClcbiAgICBjb25zdCBnID0gb3V0LmZsYXRNYXAocyA9PiBzLnJvd3MpLm1hcChyID0+IHIubmFtZSlcbiAgICAgIC5maW5kKG4gPT4gbi50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocXQudG9Mb3dlckNhc2UoKSkgJiYgbi5sZW5ndGggPiBxdC5sZW5ndGgpXG4gICAgZ2hvc3Quc2V0KGcgPz8gXCJcIilcbiAgICByZXR1cm4gb3V0XG4gIH1cblxuICBjb25zdCBzZWN0aW9ucyA9IGJpbmQocXVlcnkpLmFzKHJlc3VsdHMpXG5cbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwibGF1bmNoZXJcIiBuYW1lc3BhY2U9XCJrb2JlbC1sYXVuY2hlclwiIGNsYXNzPVwibGF1bmNoZXItd2luZG93XCJcbiAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1B9IGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5FWENMVVNJVkV9IHZpc2libGU9e2ZhbHNlfVxuICAgIG9uS2V5UHJlc3NlZD17KHNlbGYsIGtleSwgX2NvZGUsIG1vZHMpID0+IHtcbiAgICAgIGNvbnN0IGZsYXQgPSByZXN1bHRzKHF1ZXJ5LmdldCgpKS5mbGF0TWFwKHMgPT4gcy5yb3dzKVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgaWYgKHF1ZXJ5LmdldCgpKSB7IHF1ZXJ5LnNldChcIlwiKTsgcmV0dXJuIHRydWUgfVxuICAgICAgICBzZWxmLmhpZGUoKTsgcmV0dXJuIHRydWVcbiAgICAgIH1cbiAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfVGFiKSB7ICAgICAgICAgICAgICAgICAgICAgICAvLyBUYWIgaXMgQUxXQVlTIG93bmVkXG4gICAgICAgIGNvbnN0IGcgPSBnaG9zdC5nZXQoKSwgcSA9IHF1ZXJ5LmdldCgpXG4gICAgICAgIGlmIChnICYmICEobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSykpIHsgcXVlcnkuc2V0KGcpOyByZXR1cm4gdHJ1ZSB9XG4gICAgICAgIHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgKyAoKG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLlNISUZUX01BU0spID8gLTEgOiAxKVxuICAgICAgICAgICsgZmxhdC5sZW5ndGgpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKChtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5DT05UUk9MX01BU0spICYmXG4gICAgICAgICAgKGtleSA9PT0gR2RrLktFWV9uIHx8IGtleSA9PT0gR2RrLktFWV9wKSkge1xuICAgICAgICBzZWxlY3RlZC5zZXQoKHNlbGVjdGVkLmdldCgpICsgKGtleSA9PT0gR2RrLktFWV9uID8gMSA6IC0xKSArIGZsYXQubGVuZ3RoKVxuICAgICAgICAgICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Eb3duKSB7IHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgKyAxKSAlIE1hdGgubWF4KGZsYXQubGVuZ3RoLCAxKSk7IHJldHVybiB0cnVlIH1cbiAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfVXApIHsgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSAtIDEgKyBmbGF0Lmxlbmd0aCkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpOyByZXR1cm4gdHJ1ZSB9XG4gICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX1JldHVybikge1xuICAgICAgICBmbGF0W3NlbGVjdGVkLmdldCgpXT8ucnVuKCk7IHNlbGYuaGlkZSgpOyBxdWVyeS5zZXQoXCJcIik7IHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9fT5cbiAgICA8Ym94IGNsYXNzPVwic2hlZXQgbGF1bmNoZXJcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgIDxib3ggY2xhc3M9XCJmaWVsZFwiIHNwYWNpbmc9ezExfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbWFnbmlmeWluZy1nbGFzcy1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDxvdmVybGF5IGhleHBhbmQ+XG4gICAgICAgICAgPGVudHJ5XG4gICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICBzZXR1cD17KHNlbGY6IGFueSkgPT4geyBzZWxmLnNldF9tYXhfd2lkdGhfY2hhcnMoMSk7IHNlbGYuc2V0X3dpZHRoX2NoYXJzKDEpIH19XG4gICAgICAgICAgICB0ZXh0PXtiaW5kKHF1ZXJ5KX1cbiAgICAgICAgICAgIG9uTm90aWZ5VGV4dD17ZSA9PiB7IHF1ZXJ5LnNldChlLnRleHQpOyBzZWxlY3RlZC5zZXQoMCkgfX0gLz5cbiAgICAgICAgICB7LyogcGxhY2Vob2xkZXIgYXMgYW4gT1ZFUkxBWSBsYWJlbCAobm90IGVudHJ5IHBsYWNlaG9sZGVyVGV4dCkgc28gaXRzIHRleHRcbiAgICAgICAgICAgICAgd2lkdGggY2FuJ3QgaW5mbGF0ZSB0aGUgZW50cnkncyBuYXR1cmFsIHNpemUgXHUyMTkyIHBhbmVsIHN0YXlzIGF0IG1pbi13aWR0aCAqL31cbiAgICAgICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cImxwbGFjZWhvbGRlclwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBlbGxpcHNpemU9ezN9IGhleHBhbmRcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQocXVlcnkpLmFzKHEgPT4gIXEpfVxuICAgICAgICAgICAgbGFiZWw9XCJTZWFyY2ggXHUyMDE0IGFwcHMsIGZpbGVzLCBhY3Rpb25zIFx1MDBCNyAnOicgY21kcyBcdTAwQjcgJz0nIG1hdGhzXCIgLz5cbiAgICAgICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cImdob3N0XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICBsYWJlbD17YmluZChnaG9zdCkuYXMoZyA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHEgPSBxdWVyeS5nZXQoKVxuICAgICAgICAgICAgICByZXR1cm4gZy50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocS50b0xvd2VyQ2FzZSgpKSAmJiBxID8gZyA6IFwiXCJcbiAgICAgICAgICAgIH0pfSAvPlxuICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cImtiZFwiIGxhYmVsPVwic3VwZXJcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICA8L2JveD5cblxuICAgICAgey8qIGVtcHR5IHN0YXRlOiBjdXJhdGVkIGZyZWNlbmN5IHRpbGUgZ3JpZCArIHdpZGdldCByb3cgKi99XG4gICAgICA8cmV2ZWFsZXIgcmV2ZWFsQ2hpbGQ9e2JpbmQocXVlcnkpLmFzKHEgPT4gIXEudHJpbSgpKX0+XG4gICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgPGJveCBjbGFzcz1cInRpbGVzXCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBzcGFjaW5nPXs2fT5cbiAgICAgICAgICAgIHtncmlkVGlsZXMoYXBwcykubWFwKHQgPT5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInRpbGVcIiBvbkNsaWNrZWQ9eygpID0+IHsgdC5sYXVuY2goKTsgQXBwLmdldF93aW5kb3coXCJsYXVuY2hlclwiKT8uaGlkZSgpIH19PlxuICAgICAgICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgIDxpbWFnZSBjbGFzcz1cImljb24tdGlsZVwiIGljb25OYW1lPXt0Lmljb25OYW1lfSBwaXhlbFNpemU9ezMwfVxuICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD17dC5uYW1lfSBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICAgICAgICAgIGVsbGlwc2l6ZT17M30gbWF4V2lkdGhDaGFycz17OX0gLz5cbiAgICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgPC9idXR0b24+KX1cbiAgICAgICAgICA8L2JveD5cbiAgICAgICAgICB7LyogdHdvIGNhcmRzIHNwbGl0IHRoZSByb3cgZXhhY3RseSBpbiBoYWxmIFx1MjAxNCBwcm90byBmbGV4OjEvZmxleDoxICovfVxuICAgICAgICAgIDxib3ggY2xhc3M9XCJsd2lkZ2V0c1wiIHNwYWNpbmc9ezd9IGhvbW9nZW5lb3VzPlxuICAgICAgICAgICAgey8qIGxlZnQgY2FyZCBcdTIwMTQgZGF0ZSArIHRvZGF5J3MgZmlyc3QgZXZlbnQgKi99XG4gICAgICAgICAgICA8Ym94IGNsYXNzPVwid2lkZ2V0IGx3XCIgaGV4cGFuZCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfVxuICAgICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0blwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17dG9kYXlEYXRlTGFiZWwoKX0gLz5cbiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiaGludFwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17dG9kYXlFdmVudExhYmVsKCl9IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgIHsvKiByaWdodCBjYXJkIFx1MjAxNCBtZWRpYSBtaW5pLWNhcmQ6IGFydCBcdTAwQjcgdGl0bGUvYXJ0aXN0IFx1MDBCNyBwbGF5ICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cIndpZGdldCBsd21cIiBoZXhwYW5kIHNwYWNpbmc9ezEwfT5cbiAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3YXJ0XCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1tdXNpYy1zeW1ib2xpY1wiXG4gICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJsd3RcIiBoZXhwYW5kIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9XG4gICAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJtdGl0bGVcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17RC5tZWRpYS50aXRsZX0gLz5cbiAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJoaW50XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGVsbGlwc2l6ZT17M30gbGFiZWw9e0QubWVkaWEuYXJ0aXN0fSAvPlxuICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm1idG4gcGxheVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcInBsYXllcmN0bCBwbGF5LXBhdXNlXCIpfT5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wbGF5LXN5bWJvbGljXCIgLz5cbiAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9ib3g+XG4gICAgICA8L3JldmVhbGVyPlxuXG4gICAgICB7LyogcmVzdWx0cyAqL31cbiAgICAgIDxib3ggY2xhc3M9XCJscm93c1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgICAgICB7c2VjdGlvbnMuYXMoc2VjcyA9PiBzZWNzLmZsYXRNYXAoc2VjID0+IFtcbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJzZWNcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3NlYy5zZWN0aW9ufSAvPixcbiAgICAgICAgICAuLi5zZWMucm93cy5tYXAociA9PiB7XG4gICAgICAgICAgICBjb25zdCBmbGF0SWR4ID0gc2Vjcy5mbGF0TWFwKHMgPT4gcy5yb3dzKS5pbmRleE9mKHIpXG4gICAgICAgICAgICByZXR1cm4gPGJ1dHRvblxuICAgICAgICAgICAgICBjbGFzcz17YmluZChzZWxlY3RlZCkuYXMocyA9PiBzID09PSBmbGF0SWR4ID8gXCJyb3cgc2VsXCIgOiBcInJvd1wiKX1cbiAgICAgICAgICAgICAgb25DbGlja2VkPXsoKSA9PiB7IHIucnVuKCk7IEFwcC5nZXRfd2luZG93KFwibGF1bmNoZXJcIik/LmhpZGUoKSB9fT5cbiAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgey8qIDI4XHUwMEQ3MjggcjggcGFuZWwyIGZyYW1lIGFyb3VuZCB0aGUgMjRweCBpY29uIChwcm90b3R5cGUgLnJpKSAqL31cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwicmlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtyLmljb259IHBpeGVsU2l6ZT17MjR9IC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD17ci5tYXJrdXB9IC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiaGludFwiIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9IGxhYmVsPXtyLmhpbnR9IC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwicnVua1wiIGxhYmVsPVwiXHUyMUI1XCJcbiAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoc2VsZWN0ZWQpLmFzKHMgPT4gcyA9PT0gZmxhdElkeCl9IC8+XG4gICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgfSksXG4gICAgICAgIF0pKX1cbiAgICAgIDwvYm94PlxuXG4gICAgICB7LyogZm9vdGVyIGhpbnQgcm93IFx1MjAxNCBtYXRjaGVzIHByb3RvdHlwZSAubGZvb3QgKi99XG4gICAgICA8Ym94IGNsYXNzPVwibGZvb3RcIj5cbiAgICAgICAgPGJveCBzcGFjaW5nPXsxNH0gaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0+XG4gICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD1cIjxiPjpyZWxvYWQ8L2I+IHNvZnQtcmVsb2FkXCIgLz5cbiAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+Om9zZDwvYj4gdG9nZ2xlXCIgLz5cbiAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OmdyYW50czwvYj4gc2NyZWVuIGFjY2Vzc1wiIC8+XG4gICAgICAgIDwvYm94PlxuICAgICAgICA8bGFiZWwgbGFiZWw9XCJcdTIxOTFcdTIxOTMgc2VsZWN0IFx1MDBCNyBcdTIxQjUgcnVuXCIgaGFsaWduPXtHdGsuQWxpZ24uRU5EfSAvPlxuICAgICAgPC9ib3g+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuIiwgIi8vIExhdW5jaGVyIG1hdGNoaW5nIFx1MjAxNCBzdHJhaWdodCBwb3J0IG9mIHRoZSBwcm90b3R5cGUgKHBvc3QtY3JpdGlxdWUgdmVyc2lvbik6XG4vLyBzdWJzZXF1ZW5jZSBmdXp6eSB3aXRoIHdvcmQtYm91bmRhcnkgYm9udXMsIGNhcHBlZCBsb2cyIGZyZWNlbmN5LCBwcmVmaXggZ2hvc3QuXG5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgaW50ZXJmYWNlIE1hdGNoIHsgc2NvcmU6IG51bWJlcjsgbWFya3M6IG51bWJlcltdIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGZ1enp5KHE6IHN0cmluZywgdDogc3RyaW5nKTogTWF0Y2ggfCBudWxsIHtcbiAgY29uc3QgcWwgPSBxLnRvTG93ZXJDYXNlKCksIHRsID0gdC50b0xvd2VyQ2FzZSgpXG4gIGxldCBxaSA9IDAsIHNjb3JlID0gMCwgbGFzdCA9IC0yXG4gIGNvbnN0IG1hcmtzOiBudW1iZXJbXSA9IFtdXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdGwubGVuZ3RoICYmIHFpIDwgcWwubGVuZ3RoOyBpKyspIHtcbiAgICBpZiAodGxbaV0gPT09IHFsW3FpXSkge1xuICAgICAgbWFya3MucHVzaChpKVxuICAgICAgc2NvcmUgKz0gKGkgPT09IDAgfHwgXCIgLV8uL1wiLmluY2x1ZGVzKHRbaSAtIDFdKSkgPyA0IDogKGxhc3QgPT09IGkgLSAxID8gMiA6IDEpXG4gICAgICBsYXN0ID0gaTsgcWkrK1xuICAgIH1cbiAgfVxuICByZXR1cm4gcWkgPT09IHFsLmxlbmd0aCA/IHsgc2NvcmU6IHNjb3JlIC0gdC5sZW5ndGggKiAwLjAyLCBtYXJrcyB9IDogbnVsbFxufVxuXG4vLyBQYW5nbyBtYXJrdXAgaGlnaGxpZ2h0IChlc2NhcGVzOyBsZWFmIGFjY2VudCBvbiBtYXRjaGVkIGNoYXJzKVxuZXhwb3J0IGZ1bmN0aW9uIGhsKHQ6IHN0cmluZywgbWFya3M6IG51bWJlcltdIHwgbnVsbCk6IHN0cmluZyB7XG4gIGNvbnN0IGVzYyA9IChjOiBzdHJpbmcpID0+IEdMaWIubWFya3VwX2VzY2FwZV90ZXh0KGMsIC0xKVxuICBpZiAoIW1hcmtzKSByZXR1cm4gZXNjKHQpXG4gIGNvbnN0IG0gPSBuZXcgU2V0KG1hcmtzKVxuICBsZXQgb3V0ID0gXCJcIlxuICBmb3IgKGxldCBpID0gMDsgaSA8IHQubGVuZ3RoOyBpKyspXG4gICAgb3V0ICs9IG0uaGFzKGkpID8gYDxzcGFuIGZvcmVncm91bmQ9XCIjYjVjYjQ4XCI+JHtlc2ModFtpXSl9PC9zcGFuPmAgOiBlc2ModFtpXSlcbiAgcmV0dXJuIG91dFxufVxuXG4vLyBGcmVjZW5jeTogY2FwcGVkIHNvIGFuIGV4YWN0IHByZWZpeCBtYXRjaCBBTFdBWVMgYmVhdHMgaGFiaXQgKGNyaXRpcXVlIEEyKS5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvZnJlcS5qc29uYFxubGV0IGZyZXE6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7fVxudHJ5IHsgZnJlcSA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKEdMaWIuZmlsZV9nZXRfY29udGVudHMoU1RPUkUpWzFdKSkgfSBjYXRjaCB7IH1cblxuZXhwb3J0IGNvbnN0IGJvb3N0ID0gKGlkOiBzdHJpbmcpID0+IE1hdGgubWluKE1hdGgubG9nMigxICsgKGZyZXFbaWRdID8/IDApKSwgMylcblxuZXhwb3J0IGZ1bmN0aW9uIGJ1bXAoaWQ6IHN0cmluZykge1xuICBmcmVxW2lkXSA9IChmcmVxW2lkXSA/PyAwKSArIDFcbiAgR0xpYi5ta2Rpcl93aXRoX3BhcmVudHMoR0xpYi5wYXRoX2dldF9kaXJuYW1lKFNUT1JFKSwgMG83NTUpXG4gIEdMaWIuZmlsZV9zZXRfY29udGVudHMoU1RPUkUsIEpTT04uc3RyaW5naWZ5KGZyZXEpKVxufVxuXG5leHBvcnQgY29uc3QgZnJlcXVlbmN5ID0gKGlkOiBzdHJpbmcpID0+IGZyZXFbaWRdID8/IDBcbiIsICIvLyBDYWxlbmRhciBwb3BvdmVyIFx1MjAxNCBHTk9NRSByZXBsaWNhIHBlciB0aGUgcHJvdG90eXBlOiBoZXJvIGRhdGUsIFx1MjAzOSBtb250aCBcdTIwM0EgbmF2XG4vLyAodGl0bGUgY2xpY2sgPSB0b2RheSksIElTTyB3ZWVrIG51bWJlcnMgYXMgcXVpZXQgZGltIHRleHQsIERJTU1FRCBXRUVLRU5EUyxcbi8vIGNsaWNrYWJsZSBkYXlzIHcvIHNlbGVjdGlvbiByaW5nIChpbmsgcmluZyBvbiB0b2RheSksIGV2ZW50LWRvdCBtYXJrZXJzLFxuLy8gZXZlbnRzIGNhcmQgaW4gdGhlIG5vdGlmaWNhdGlvbi1jYXJkIGxhbmd1YWdlLiBNb250aHMgc2xpZGUgKG11bHRpdmlldyBtb3Rpb24pLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcblxuaW50ZXJmYWNlIEV2IHsgdDogc3RyaW5nOyBuOiBzdHJpbmc7IGljb246IHN0cmluZyB9XG4vLyBcInRvZGF5XCIgXHUyMDE0IHVuZGVyIEtPQkVMX0RFTU8sIHBpbm5lZCB0byBELnRvZGF5ICh0aGUgZGVtbydzIG1vY2sgXCJ0b2RheVwiLCBrZXB0IGluIHN5bmNcbi8vIHdpdGggdGhlIHByb3RvdHlwZSBzbyB0aGUgaGVybywgZ3JpZCBoaWdobGlnaHQsIGV2ZW50LWRvdHMgYW5kIGV2ZW50cyBjYXJkIG92ZXJsYXkgaXRcbi8vIDE6MSk7IHJlYWwgY2xvY2sgb3RoZXJ3aXNlLiBFdmVyeSBcInRvZGF5XCIvc2VsZWN0ZWQgZGVmYXVsdCBmbG93cyBmcm9tIHRoaXMgc2luZ2xlIGBub3dgLlxuY29uc3Qgbm93ID0gREVNTyA/IG5ldyBEYXRlKEQudG9kYXkueSwgRC50b2RheS5tLCBELnRvZGF5LmQpIDogbmV3IERhdGUoKVxuY29uc3Qga2V5ID0gKHk6IG51bWJlciwgbTogbnVtYmVyLCBkOiBudW1iZXIpID0+IGAke3l9LSR7bSArIDF9LSR7ZH1gXG5leHBvcnQgY29uc3QgRVZFTlRTOiBSZWNvcmQ8c3RyaW5nLCBFdltdPiA9IHtcbiAgW2tleShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpXTpcbiAgICBbeyB0OiBcIjA5OjQ1XCIsIG46IFwiRGFpbHkgU3RhbmR1cFwiLCBpY29uOiBcImtvYmVsLXZpZGVvLXN5bWJvbGljXCIgfV0sXG4gIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxMSldOlxuICAgIFt7IHQ6IFwiMTA6MzBcIiwgbjogXCJLaWVyYW4gQmlydGhkYXlcIiwgaWNvbjogXCJrb2JlbC1jYWtlLXN5bWJvbGljXCIgfSxcbiAgICAgeyB0OiBcIjEzOjAwXCIsIG46IFwiTG9uZG9uIFRoaW5nXCIsIGljb246IFwia29iZWwtcGluLXN5bWJvbGljXCIgfV0sXG4gIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCAxMyldOlxuICAgIFt7IHQ6IFwiQWxsIGRheVwiLCBuOiBcIk15IEJpcnRoZGF5XCIsIGljb246IFwia29iZWwtY2FrZS1zeW1ib2xpY1wiIH1dLFxufVxuXG5jb25zdCB2aWV3ID0gVmFyaWFibGUoeyB5OiBub3cuZ2V0RnVsbFllYXIoKSwgbTogbm93LmdldE1vbnRoKCkgfSlcbmNvbnN0IHNlbCA9IFZhcmlhYmxlKG5ldyBEYXRlKG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgbm93LmdldERhdGUoKSkpXG5cbmZ1bmN0aW9uIGlzb1dlZWsoZDogRGF0ZSk6IG51bWJlciB7XG4gIGNvbnN0IHQgPSBuZXcgRGF0ZShEYXRlLlVUQyhkLmdldEZ1bGxZZWFyKCksIGQuZ2V0TW9udGgoKSwgZC5nZXREYXRlKCkpKVxuICBjb25zdCBkbiA9ICh0LmdldFVUQ0RheSgpICsgNikgJSA3XG4gIHQuc2V0VVRDRGF0ZSh0LmdldFVUQ0RhdGUoKSAtIGRuICsgMylcbiAgY29uc3QgZiA9IG5ldyBEYXRlKERhdGUuVVRDKHQuZ2V0VVRDRnVsbFllYXIoKSwgMCwgNCkpXG4gIHJldHVybiAxICsgTWF0aC5yb3VuZCgoKCt0IC0gK2YpIC8gODY0ZTUgLSAzICsgKChmLmdldFVUQ0RheSgpICsgNikgJSA3KSkgLyA3KVxufVxuXG5mdW5jdGlvbiBHcmlkKCkge1xuICByZXR1cm4gPGJveCBjbGFzcz1cImNhbC1ncmlkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0+XG4gICAge2JpbmQoVmFyaWFibGUuZGVyaXZlKFt2aWV3LCBzZWxdLCAodiwgcykgPT4gKHsgdiwgcyB9KSkpLmFzKCh7IHYsIHMgfSkgPT4ge1xuICAgICAgY29uc3QgZmlyc3QgPSBuZXcgRGF0ZSh2LnksIHYubSwgMSlcbiAgICAgIGNvbnN0IHN0YXJ0ID0gKGZpcnN0LmdldERheSgpICsgNikgJSA3XG4gICAgICBjb25zdCBkYXlzID0gbmV3IERhdGUodi55LCB2Lm0gKyAxLCAwKS5nZXREYXRlKClcbiAgICAgIGNvbnN0IHByZXZEYXlzID0gbmV3IERhdGUodi55LCB2Lm0sIDApLmdldERhdGUoKVxuICAgICAgY29uc3Qgcm93cyA9IFtdXG4gICAgICByb3dzLnB1c2goPGJveCBob21vZ2VuZW91cz5cbiAgICAgICAge1tcIlwiLCBcIk1cIiwgXCJUXCIsIFwiV1wiLCBcIlRcIiwgXCJGXCIsIFwiU1wiLCBcIlNcIl0ubWFwKGQgPT5cbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJkb3dcIiBsYWJlbD17ZH0gLz4pfVxuICAgICAgPC9ib3g+KVxuICAgICAgZm9yIChsZXQgciA9IDA7IHIgPCA2OyByKyspIHtcbiAgICAgICAgY29uc3QgY2VsbHMgPSBbPGxhYmVsIGNsYXNzPVwid2sgdG5cIlxuICAgICAgICAgIGxhYmVsPXtgJHtpc29XZWVrKG5ldyBEYXRlKHYueSwgdi5tLCByICogNyAtIHN0YXJ0ICsgMSkpfWB9IC8+XVxuICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDc7IGMrKykge1xuICAgICAgICAgIGNvbnN0IGkgPSByICogNyArIGMsIGQgPSBpIC0gc3RhcnQgKyAxXG4gICAgICAgICAgY29uc3Qgb3V0ID0gZCA8IDEgfHwgZCA+IGRheXNcbiAgICAgICAgICBjb25zdCBsYWJlbCA9IG91dCA/IChkIDwgMSA/IHByZXZEYXlzICsgZCA6IGQgLSBkYXlzKSA6IGRcbiAgICAgICAgICBjb25zdCBjbHMgPSBbXCJkYXlcIl1cbiAgICAgICAgICBpZiAoYyA+PSA1KSBjbHMucHVzaChcIndlXCIpICAgICAgICAgICAgICAgICAgICAgICAvLyBXRUVLRU5EUyBESU1NRURcbiAgICAgICAgICBpZiAob3V0KSBjbHMucHVzaChcIm91dFwiKVxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgdG9kYXkgPSBub3dcbiAgICAgICAgICAgIGlmIChkID09PSB0b2RheS5nZXREYXRlKCkgJiYgdi5tID09PSB0b2RheS5nZXRNb250aCgpICYmIHYueSA9PT0gdG9kYXkuZ2V0RnVsbFllYXIoKSlcbiAgICAgICAgICAgICAgY2xzLnB1c2goXCJ0b2RheVwiKVxuICAgICAgICAgICAgaWYgKEVWRU5UU1trZXkodi55LCB2Lm0sIGQpXSkgY2xzLnB1c2goXCJldlwiKSAgIC8vIGV2ZW50LWRvdCAoQ1NTIDo6YWZ0ZXIgXHUyMTkyIHVuZGVybGluZSBkb3QpXG4gICAgICAgICAgICBpZiAocy5nZXREYXRlKCkgPT09IGQgJiYgcy5nZXRNb250aCgpID09PSB2Lm0gJiYgcy5nZXRGdWxsWWVhcigpID09PSB2LnkpXG4gICAgICAgICAgICAgIGNscy5wdXNoKFwic2VsXCIpXG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGhhc0V2ID0gIW91dCAmJiAhIUVWRU5UU1trZXkodi55LCB2Lm0sIGQpXVxuICAgICAgICAgIC8vIGRheSBzaXRzIGF0IGl0cyBuYXR1cmFsIDI0XHUwMEQ3MjQgY2VudHJlZCBpbiB0aGUgZ3JpZCBjb2x1bW4gKG5vdCBmaWxsaW5nIGl0KSxcbiAgICAgICAgICAvLyBzbyB0b2RheSdzIGxlYWYgZmlsbCBpcyBhIHRpZ2h0IGNpcmNsZSByYXRoZXIgdGhhbiBhIGNvbHVtbi13aWRlIG92YWxcbiAgICAgICAgICBjZWxscy5wdXNoKG91dFxuICAgICAgICAgICAgPyA8bGFiZWwgY2xhc3M9e2Nscy5qb2luKFwiIFwiKX0gaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBsYWJlbD17YCR7bGFiZWx9YH0gLz5cbiAgICAgICAgICAgIDogPGJ1dHRvbiBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfVxuICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gc2VsLnNldChuZXcgRGF0ZSh2LnksIHYubSwgZCkpfT5cbiAgICAgICAgICAgICAgICB7aGFzRXZcbiAgICAgICAgICAgICAgICAgID8gPG92ZXJsYXk+XG4gICAgICAgICAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXtgJHtsYWJlbH1gfSAvPlxuICAgICAgICAgICAgICAgICAgICAgIHsvKiAzcHggZXZlbnQgZG90LCBhYnNvbHV0ZSBib3R0b20tY2VudGVyIChHVEsgaGFzIG5vIDo6YWZ0ZXIpICovfVxuICAgICAgICAgICAgICAgICAgICAgIDxib3ggdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cImV2ZG90XCJcbiAgICAgICAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfSAvPlxuICAgICAgICAgICAgICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgICAgICAgICAgICA6IDxsYWJlbCBsYWJlbD17YCR7bGFiZWx9YH0gLz59XG4gICAgICAgICAgICAgIDwvYnV0dG9uPilcbiAgICAgICAgfVxuICAgICAgICByb3dzLnB1c2goPGJveCBob21vZ2VuZW91cz57Y2VsbHN9PC9ib3g+KVxuICAgICAgfVxuICAgICAgcmV0dXJuIHJvd3NcbiAgICB9KX1cbiAgPC9ib3g+XG59XG5cbmZ1bmN0aW9uIEV2ZW50c0NhcmQoKSB7XG4gIC8vIFByb3RvdHlwZSAuY2FsZXY6IGEgcGFuZWwyIGNhcmQgKHBhZDEwL3IxMikgd3JhcHBpbmcgdGhlIGRhdGUgaGVhZGVyICsgZGFya2VyXG4gIC8vICgtLXBhbmVsKSBldmVudCByb3dzOyBoZWFkZXIncyBvd24gYm90dG9tIHBhZGRpbmcgaXMgdGhlIGhlYWRlclx1MjE5MnJvdyBnYXAgKHNwYWNpbmcgMCkuXG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZXZjYXJkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAge2JpbmQoc2VsKS5hcyhkID0+IHtcbiAgICAgIGNvbnN0IGV2cyA9IEVWRU5UU1trZXkoZC5nZXRGdWxsWWVhcigpLCBkLmdldE1vbnRoKCksIGQuZ2V0RGF0ZSgpKV0gPz8gW11cbiAgICAgIGNvbnN0IGhlYWQgPSA8bGFiZWwgY2xhc3M9XCJldmhlYWRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgbGFiZWw9e2QudG9Mb2NhbGVEYXRlU3RyaW5nKFwiZW4tR0JcIiwgeyB3ZWVrZGF5OiBcImxvbmdcIiwgZGF5OiBcIm51bWVyaWNcIiwgbW9udGg6IFwibG9uZ1wiIH0pfSAvPlxuICAgICAgaWYgKCFldnMubGVuZ3RoKSByZXR1cm4gW2hlYWQsXG4gICAgICAgIDxib3ggc3BhY2luZz17OH0+PGltYWdlIGljb25OYW1lPVwia29iZWwtY2FsZW5kYXItc3ltYm9saWNcIiAvPlxuICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YlwiIGxhYmVsPVwiTm8gZXZlbnRzXCIgLz48L2JveD5dXG4gICAgICByZXR1cm4gW2hlYWQsIC4uLmV2cy5tYXAoZSA9PlxuICAgICAgICA8Ym94IGNsYXNzPVwiZXZyb3dcIiBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgey8qIDI2XHUwMEQ3MjYgcjggY29sb3JlZCBpY29uIHRpbGUgKHByb3RvdHlwZSAuZXZpYyksIHdoaXRlIGdseXBoICovfVxuICAgICAgICAgIDxib3ggY2xhc3M9XCJldmljXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17ZS5pY29ufSAvPjwvYm94PlxuICAgICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2Uubn0gLz5cbiAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInN1YiB0blwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17ZS50fSAvPlxuICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD4pXVxuICAgIH0pfVxuICA8L2JveD5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQ2FsZW5kYXIoKSB7XG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImNhbGVuZGFyXCIgbmFtZXNwYWNlPVwia29iZWwtY2FsZW5kYXJcIiBjbGFzcz1cImNhbGVuZGFyLXdpbmRvd1wiIHZpc2libGU9e2ZhbHNlfVxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUH0gZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5Lk5PUk1BTH0ga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgb25LZXlQcmVzc2VkPXsoc2VsZiwga2V5KSA9PiBrZXkgPT09IEdkay5LRVlfRXNjYXBlID8gKHNlbGYuaGlkZSgpLCB0cnVlKSA6IGZhbHNlfT5cbiAgICA8Ym94IGNsYXNzPVwic2hlZXQgY2FsXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICA8Ym94IGNsYXNzPVwiY2FsaGVyb1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9PlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJzdWJcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICBsYWJlbD17bm93LnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIgfSl9IC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cImhlcm9cIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICBsYWJlbD17bm93LnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgZGF5OiBcIm51bWVyaWNcIiwgbW9udGg6IFwibG9uZ1wiLCB5ZWFyOiBcIm51bWVyaWNcIiB9KX0gLz5cbiAgICAgIDwvYm94PlxuICAgICAgPGNlbnRlcmJveD5cbiAgICAgICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICBjb25zdCB2ID0gdmlldy5nZXQoKVxuICAgICAgICAgIHZpZXcuc2V0KHYubSA/IHsgeTogdi55LCBtOiB2Lm0gLSAxIH0gOiB7IHk6IHYueSAtIDEsIG06IDExIH0pXG4gICAgICAgIH19PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tbGVmdC1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJtb250aFwiIG9uQ2xpY2tlZD17KCkgPT5cbiAgICAgICAgICB2aWV3LnNldCh7IHk6IG5vdy5nZXRGdWxsWWVhcigpLCBtOiBub3cuZ2V0TW9udGgoKSB9KX0+XG4gICAgICAgICAgPGxhYmVsIGxhYmVsPXtiaW5kKHZpZXcpLmFzKHYgPT5cbiAgICAgICAgICAgIG5ldyBEYXRlKHYueSwgdi5tKS50b0xvY2FsZVN0cmluZyhcImVuXCIsIHsgbW9udGg6IFwibG9uZ1wiIH0pXG4gICAgICAgICAgICArICh2LnkgIT09IG5vdy5nZXRGdWxsWWVhcigpID8gYCAke3YueX1gIDogXCJcIikpfSAvPlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IHtcbiAgICAgICAgICBjb25zdCB2ID0gdmlldy5nZXQoKVxuICAgICAgICAgIHZpZXcuc2V0KHYubSA9PT0gMTEgPyB7IHk6IHYueSArIDEsIG06IDAgfSA6IHsgeTogdi55LCBtOiB2Lm0gKyAxIH0pXG4gICAgICAgIH19PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPC9jZW50ZXJib3g+XG4gICAgICA8R3JpZCAvPlxuICAgICAgPEV2ZW50c0NhcmQgLz5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gUXVpY2sgc2V0dGluZ3MuIFByb3RvdHlwZS1maW5hbDogdW5pZm9ybSBwaWxsIHRpbGVzIGZyb20gYSBDQVRBTE9HIChjdXN0b21pc2FibGUsXG4vLyBwZXJzaXN0ZWQpLCBHTk9NRSB0aGluIHNsaWRlcnMsIGRyaWxsZG93bnMgYXMgYSBzcHJpbmctc2xpZCB0d28tdmlldyBzdGFja1xuLy8gKFdpLUZpIG5ldHdvcmtzIC8gQlQgZGV2aWNlcyAvIHBlci1hcHAgbWl4ZXIgd2l0aCBhIE1hc3RlciByb3cpLCBjb21wYWN0IHRvcCByb3dcbi8vIChiYXR0ZXJ5IFx1MDBCNyBwZW5jaWwvbGVhZi9sb2NrL3Bvd2VyKSwgZ25vYmxpbiBiYW5uZXIgKyByZWNvbm5lY3Qgd2hpbGUgZGVncmFkZWQuXG5pbXBvcnQgeyBBcHAsIEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBCbHVldG9vdGggZnJvbSBcImdpOi8vQXN0YWxCbHVldG9vdGhcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE1wcmlzIGZyb20gXCJnaTovL0FzdGFsTXByaXNcIlxuaW1wb3J0IHsgY29ubmVjdGVkLCByZWxvYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBNT1RJT04gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbmltcG9ydCB7IFRpbnlTbGlkZXIgfSBmcm9tIFwiLi4vbGliL3RpbnlzbGlkZXJcIlxuaW1wb3J0IHsgRml4ZWRDaGV2IH0gZnJvbSBcIi4uL2xpYi9maXhlZGNoZXZcIlxuXG50eXBlIERyaWxsID0gbnVsbCB8IFwid2lmaVwiIHwgXCJidFwiIHwgXCJtaXhcIlxuLy8gS09CRUxfRFJJTEwgbGV0cyB0aGUgZGV2a2l0IHJlbmRlciBhIGRyaWxsZG93biBkaXJlY3RseSAobm8gcG9pbnRlciB0byBjbGljayB0aGVcbi8vIGNoZXZyb24gaW4gaGVhZGxlc3MpOyBwcm9kdWN0aW9uIGRlZmF1bHQgaXMgbnVsbC5cbmNvbnN0IGRyaWxsID0gVmFyaWFibGU8RHJpbGw+KChHTGliLmdldGVudihcIktPQkVMX0RSSUxMXCIpIGFzIERyaWxsKSB8fCBudWxsKVxuXG4vLyBUaWxlIGNhdGFsb2cgXHUyMDE0IG1pcnJvcnMgcHJvdG90eXBlIENBVEFMT0c7IHBlcnNpc3RlZCBsYXlvdXQgaW4gc3RhdGUgZGlyLlxuY29uc3QgU1RPUkUgPSBgJHtHTGliLmdldF91c2VyX3N0YXRlX2RpcigpfS9rb2JlbC9xcy10aWxlcy5qc29uYFxubGV0IHRpbGVzOiBzdHJpbmdbXSA9IFtcIndpZmlcIiwgXCJidFwiLCBcInNhdmVcIiwgXCJkYXJrXCIsIFwic2lsZW50XCIsIFwibmlnaHRcIiwgXCJ2b2x1bWVcIiwgXCJicmlnaHRuZXNzXCJdXG50cnkgeyB0aWxlcyA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKEdMaWIuZmlsZV9nZXRfY29udGVudHMoU1RPUkUpWzFdKSkgfSBjYXRjaCB7IH1cblxuZnVuY3Rpb24gQ2hpcChwcm9wczoge1xuICBpZDogc3RyaW5nLCBsYWJlbDogc3RyaW5nLCBpY29uOiBzdHJpbmcsXG4gIGFjdGl2ZTogYW55LCBzdWI/OiBhbnksIG9uVG9nZ2xlZDogKCkgPT4gdm9pZCwgb25EcmlsbD86ICgpID0+IHZvaWQsXG59KSB7XG4gIHJldHVybiA8Ym94IGNsYXNzPXtiaW5kKHByb3BzLmFjdGl2ZSkuYXMoKGE6IGJvb2xlYW4pID0+IGEgPyBcImNoaXAgcGlsbCBvblwiIDogXCJjaGlwIHBpbGxcIil9PlxuICAgIDxidXR0b24gY2xhc3M9XCJjaGlwYlwiIGhleHBhbmQ9e3RydWV9IG9uQ2xpY2tlZD17cHJvcHMub25Ub2dnbGVkfT5cbiAgICAgIDxib3ggc3BhY2luZz17OX0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT17cHJvcHMuaWNvbn0gLz5cbiAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3Byb3BzLmxhYmVsfSAvPlxuICAgICAgICAgIHtwcm9wcy5zdWIgJiYgPGxhYmVsIGNsYXNzPVwic3ViXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICBlbGxpcHNpemU9ezN9IGxhYmVsPXtwcm9wcy5zdWJ9IC8+fVxuICAgICAgICA8L2JveD5cbiAgICAgIDwvYm94PlxuICAgIDwvYnV0dG9uPlxuICAgIHsvKiBmaXhlZCAzMnB4IHNlYW0rY2hldnJvbiAocHJvdG8gLmNoZXZiKSBcdTIwMTQgaGV4cGFuZD1mYWxzZSBzbyB0aGUgbWFpbiBidXR0b24gb3ducyBzbGFjayAqL31cbiAgICB7cHJvcHMub25EcmlsbCAmJlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImNoZXZcIiBoZXhwYW5kPXtmYWxzZX0gd2lkdGhSZXF1ZXN0PXszMn0gb25DbGlja2VkPXtwcm9wcy5vbkRyaWxsfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+XG4gICAgICA8L2J1dHRvbj59XG4gIDwvYm94PlxufVxuXG5mdW5jdGlvbiBTbGlkZXJzKCkge1xuICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgLy8gSW4gREVNTyBtb2RlIHJlbmRlciB0aGUgdHdvIHNsaWRlcnMgcmVnYXJkbGVzcyBvZiBhIHJlYWwgc3BlYWtlciwgcGlubmVkIHRvIHRoZVxuICAvLyBwcm90b3R5cGUncyBtb2NrIHZhbHVlcyAodm9sdW1lIDAuNjQsIGJyaWdodG5lc3MgMC44MCkgZm9yIGEgZmFpciBvdmVybGF5LlxuICBpZiAoIXNwZWFrZXIgJiYgIURFTU8pIHJldHVybiA8Ym94IC8+XG4gIGNvbnN0IHZvbEljb24gPSBzcGVha2VyXG4gICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoaSA9PiBpID8/IFwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIpXG4gICAgOiBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiXG4gIGNvbnN0IHZvbFZhbHVlOiBhbnkgPSBERU1PID8gRC52b2x1bWUgOiBiaW5kKHNwZWFrZXIhLCBcInZvbHVtZVwiKVxuICAvLyBwcm90byAuc2xpZGVycyBpcyBhIGZsZXggY29sdW1uIHdpdGggTk8gZ2FwIGJldHdlZW4gdGhlIHR3byBzcm93cyAoZWFjaCBtaW4taCA0MikuXG4gIC8vIFRpbnlTbGlkZXIgb3ZlcnJpZGVzIHZmdW5jX21lYXN1cmUgdG8gcmVwb3J0IG5hdHVyYWw9MXB4IHNvIHRoZSBzcm93IGRvZXNuJ3RcbiAgLy8gaW5mbGF0ZSB0aGUgcGFuZWwgYmV5b25kIHRoZSBjaGlwLWdyaWQgd2lkdGggKEdUSyBDU1MgbWF4LXdpZHRoIGlzIG5vdCByZXNwZWN0ZWQpLlxuICBjb25zdCBpbml0Vm9sID0gREVNTyA/IEQudm9sdW1lIDogKHNwZWFrZXI/LnZvbHVtZSA/PyAwLjY0KVxuICBjb25zdCB2b2xTbGlkZXIgPSBuZXcgVGlueVNsaWRlcih7IGhleHBhbmQ6IHRydWUsIGNzc0NsYXNzZXM6IFtcInNsaWRlclwiXSwgdmFsdWU6IGluaXRWb2wgfSlcbiAgaWYgKCFERU1PICYmIHNwZWFrZXIpIGJpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIikuc3Vic2NyaWJlKCh2OiBudW1iZXIpID0+IHsgdm9sU2xpZGVyLmdldF9hZGp1c3RtZW50KCkudmFsdWUgPSB2IH0pXG4gIC8vIEd0a1JhbmdlOjpjaGFuZ2UtdmFsdWUgYXJnczogKHJhbmdlLCBzY3JvbGxUeXBlLCB2YWx1ZSlcbiAgdm9sU2xpZGVyLmNvbm5lY3QoXCJjaGFuZ2UtdmFsdWVcIiwgKF9zOiBhbnksIF90OiBhbnksIHY6IG51bWJlcikgPT4geyBpZiAoc3BlYWtlcikgc3BlYWtlci52b2x1bWUgPSB2IH0pXG5cbiAgY29uc3QgYnJpZ2h0U2xpZGVyID0gbmV3IFRpbnlTbGlkZXIoeyBoZXhwYW5kOiB0cnVlLCBjc3NDbGFzc2VzOiBbXCJzbGlkZXJcIl0sIHZhbHVlOiBERU1PID8gRC5icmlnaHRuZXNzIDogMC44IH0pXG4gIGJyaWdodFNsaWRlci5jb25uZWN0KFwiY2hhbmdlLXZhbHVlXCIsIChfczogYW55LCBfdDogYW55LCB2OiBudW1iZXIpID0+XG4gICAgZXhlY0FzeW5jKGBicmlnaHRuZXNzY3RsIHNldCAke01hdGgucm91bmQodiAqIDEwMCl9JWApKVxuXG4gIHJldHVybiA8Ym94IGNsYXNzPVwic2xpZGVyc1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgIDxib3ggY2xhc3M9XCJzcm93XCIgc3BhY2luZz17OX0+XG4gICAgICA8aW1hZ2UgaWNvbk5hbWU9e3ZvbEljb259IC8+XG4gICAgICB7dm9sU2xpZGVyfVxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImNoZXZcIiB3aWR0aFJlcXVlc3Q9ezMxfSBvbkNsaWNrZWQ9eygpID0+IGRyaWxsLnNldChcIm1peFwiKX0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgPC9idXR0b24+XG4gICAgPC9ib3g+XG4gICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJyaWdodG5lc3Mtc3ltYm9saWNcIiAvPlxuICAgICAge2JyaWdodFNsaWRlcn1cbiAgICAgIHsvKiBndXR0ZXI6IHdpZHRoUmVxdWVzdD0xNyArIH4xM3B4IEFkd2FpdGEgb3ZlcmhlYWQgXHUyMjQ4IDMwcHgsIG1hdGNoaW5nIGNoZXYgd2lkdGggKi99XG4gICAgICA8Ym94IHdpZHRoUmVxdWVzdD17MTd9IC8+XG4gICAgPC9ib3g+XG4gIDwvYm94PlxufVxuXG5mdW5jdGlvbiBHbm9ibGluQmFubmVyKCkge1xuICByZXR1cm4gPGJveCBjbGFzcz1cImdiYW5uZXJcIiB2aXNpYmxlPXtERU1PID8gZmFsc2UgOiBiaW5kKGNvbm5lY3RlZCkuYXMoYyA9PiAhYyl9IHNwYWNpbmc9ezEwfT5cbiAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC13YXJuaW5nLXN5bWJvbGljXCIgLz5cbiAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJ0XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPVwib3JnLmdub2JsaW4uU2hlbGwgZGlzY29ubmVjdGVkXCIgLz5cbiAgICAgIDxsYWJlbCBjbGFzcz1cInNcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJvc2QgKyBub3RpZnMgaGFuZGVkIGJhY2sgdG8gZ25vbWVcIiAvPlxuICAgIDwvYm94PlxuICAgIDxidXR0b24gY2xhc3M9XCJnYnRuXCIgbGFiZWw9XCJSZWNvbm5lY3RcIiBvbkNsaWNrZWQ9eygpID0+IHJlbG9hZCgpLmNhdGNoKCgpID0+IHsgfSl9IC8+XG4gIDwvYm94PlxufVxuXG4vLyBsb2NhbC1zdGF0ZSB0b2dnbGVzIChubyByZWFsIGJhY2tlbmQgZm9yIHRoZXNlIGluIHRoZSBkZXZraXQpXG5jb25zdCB0U2F2ZSA9IFZhcmlhYmxlKGZhbHNlKSwgdERhcmsgPSBWYXJpYWJsZSh0cnVlKSwgdFNpbGVudCA9IFZhcmlhYmxlKGZhbHNlKSwgdE5pZ2h0ID0gVmFyaWFibGUoZmFsc2UpXG4vLyBlZGl0LW1vZGUgZm9yIHRoZSB0aWxlIGNhdGFsb2cgKHBlbmNpbCBidXR0b24pIFx1MjAxNCBob29rIGZvciB0aWxlIHJlYXJyYW5nZS9jdXN0b21pc2UuXG5jb25zdCBlZGl0TW9kZSA9IFZhcmlhYmxlKGZhbHNlKVxuXG4vLyBQcm90b3R5cGUgdG9nZ2xlIGNoaXBzIGFyZSBsYWJlbC1vbmx5LCB2ZXJ0aWNhbGx5IGNlbnRlcmVkIFx1MjAxNCBzdGF0ZSBpcyBzaG93biBieSB0aGVcbi8vIGxlYWYgZmlsbCwgbm90IGEgc3ViLWxpbmUgKG9ubHkgV2ktRmkvQmx1ZXRvb3RoIGNhcnJ5IGEgc3ViKS5cbmZ1bmN0aW9uIFRvZ2dsZUNoaXAocHJvcHM6IHsgbGFiZWw6IHN0cmluZywgaWNvbjogc3RyaW5nLCB2OiBWYXJpYWJsZTxib29sZWFuPiB9KSB7XG4gIHJldHVybiA8Q2hpcCBpZD17cHJvcHMubGFiZWx9IGxhYmVsPXtwcm9wcy5sYWJlbH0gaWNvbj17cHJvcHMuaWNvbn1cbiAgICBhY3RpdmU9e2JpbmQocHJvcHMudil9XG4gICAgb25Ub2dnbGVkPXsoKSA9PiBwcm9wcy52LnNldCghcHJvcHMudi5nZXQoKSl9IC8+XG59XG5cbmZ1bmN0aW9uIFJvb3QoeyBuYW1lIH06IHsgbmFtZT86IHN0cmluZyB9KSB7XG4gIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gIC8vIHNwYWNpbmcgMDogZXhhY3Qgc2VjdGlvbiBnYXBzIGNvbWUgZnJvbSBtYXJnaW5zIChxdG9wXHUyMTkyY2hpcHMgMSwgY2hpcCByb3dzIDgsXG4gIC8vIGNoaXBzXHUyMTkyc2xpZGVycyAxMCkgXHUyMDE0IGEgdW5pZm9ybSBib3ggc3BhY2luZyBjYW4ndCBleHByZXNzIGFsbCB0aHJlZS5cbiAgcmV0dXJuIDxib3ggbmFtZT17bmFtZX0gb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgey8qIHRvcCByb3c6IGJhdHRlcnkgXHUwMEI3IHJlbG9hZCBcdTAwQjcgbG9jayBcdTAwQjcgcG93ZXIgKi99XG4gICAgPGJveCBjbGFzcz1cInFzLXRvcFwiIHNwYWNpbmc9ezB9PlxuICAgICAgey8qIGJhdHRlcnkgcGlsbDogZ2x5cGggKyB0YWJ1bGFyIG1ldGEgKG1hdGNoZXMgcHJvdG90eXBlIC5xYikgKi99XG4gICAgICA8Ym94IGNsYXNzPVwibWV0YVwiIHNwYWNpbmc9ezZ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJhdHRlcnktc3ltYm9saWNcIiAvPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0blwiIGxhYmVsPXtERU1PID8gRC5tZXRhIDogXCIxMDAlIFx1MDBCNyBGdWxseSBjaGFyZ2VkXCJ9IC8+XG4gICAgICA8L2JveD5cbiAgICAgIDxib3ggaGV4cGFuZCAvPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG4gbGVhZlwiIG9uQ2xpY2tlZD17KCkgPT4gcmVsb2FkKCl9PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWxlYWYtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG5cIiBvbkNsaWNrZWQ9eygpID0+IGV4ZWNBc3luYyhcImxvZ2luY3RsIGxvY2stc2Vzc2lvblwiKX0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWxvY2stc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG5cIiBvbkNsaWNrZWQ9eygpID0+IGVkaXRNb2RlLnNldCghZWRpdE1vZGUuZ2V0KCkpfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcGVuY2lsLXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJyYnRuIGRhbmdlclwiIG9uQ2xpY2tlZD17KCkgPT4gQXBwLnRvZ2dsZV93aW5kb3coXCJzZXNzaW9uXCIpfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgIDwvYm94PlxuICAgIDxHbm9ibGluQmFubmVyIC8+XG4gICAgey8qIG9uZSBjaGlwcyBncmlkOiAzIHJvd3MgYXQgOHB4LCBtYXJnaW4tYm90dG9tIDEwIGJlZm9yZSB0aGUgc2xpZGVycyAqL31cbiAgICA8Ym94IGNsYXNzPVwiY2hpcC1ncmlkXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0+XG4gICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgeyhERU1PIHx8IG5ldC53aWZpKSAmJiA8Q2hpcCBpZD1cIndpZmlcIiBsYWJlbD1cIldpLUZpXCIgaWNvbj1cImtvYmVsLXdpZmktc3ltYm9saWNcIlxuICAgICAgICAgIGFjdGl2ZT17REVNTyA/IFZhcmlhYmxlKHRydWUpIDogYmluZChuZXQud2lmaSEsIFwiZW5hYmxlZFwiKX1cbiAgICAgICAgICBzdWI9e0RFTU8gPyBELndpZmlTc2lkIDogYmluZChuZXQud2lmaSEsIFwic3NpZFwiKS5hcyhzID0+IHMgPz8gXCJPZmZcIil9XG4gICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7IGlmICghREVNTyAmJiBuZXQud2lmaSkgbmV0LndpZmkuZW5hYmxlZCA9ICFuZXQud2lmaS5lbmFibGVkIH19XG4gICAgICAgICAgb25EcmlsbD17KCkgPT4gZHJpbGwuc2V0KFwid2lmaVwiKX0gLz59XG4gICAgICAgIDxDaGlwIGlkPVwiYnRcIiBsYWJlbD1cIkJsdWV0b290aFwiIGljb249XCJrb2JlbC1ibHVldG9vdGgtc3ltYm9saWNcIlxuICAgICAgICAgIGFjdGl2ZT17REVNTyA/IFZhcmlhYmxlKHRydWUpIDogYmluZChidCwgXCJkZXZpY2VzXCIpLmFzKGQgPT4gZC5zb21lKHggPT4geC5jb25uZWN0ZWQpKX1cbiAgICAgICAgICBzdWI9e0RFTU8gPyBELmJ0RGV2aWNlIDogYmluZChidCwgXCJkZXZpY2VzXCIpLmFzKGQgPT5cbiAgICAgICAgICAgIGQuZmluZCh4ID0+IHguY29ubmVjdGVkKT8uYWxpYXMgPz8gXCJPZmZcIil9XG4gICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7IGlmICghREVNTykgYnQudG9nZ2xlKCkgfX1cbiAgICAgICAgICBvbkRyaWxsPXsoKSA9PiBkcmlsbC5zZXQoXCJidFwiKX0gLz5cbiAgICAgIDwvYm94PlxuICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgIDxUb2dnbGVDaGlwIGxhYmVsPVwiUG93ZXIgU2F2ZXJcIiBpY29uPVwia29iZWwtYm9sdC1zeW1ib2xpY1wiIHY9e3RTYXZlfSAvPlxuICAgICAgICA8VG9nZ2xlQ2hpcCBsYWJlbD1cIkRhcmsgU3R5bGVcIiBpY29uPVwia29iZWwtbW9vbi1zeW1ib2xpY1wiIHY9e3REYXJrfSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8Ym94IGNsYXNzPVwiY2hpcHNcIiBob21vZ2VuZW91cyBzcGFjaW5nPXs4fT5cbiAgICAgICAgPFRvZ2dsZUNoaXAgbGFiZWw9XCJTaWxlbnRcIiBpY29uPVwia29iZWwtYmVsbC1zbGFzaC1zeW1ib2xpY1wiIHY9e3RTaWxlbnR9IC8+XG4gICAgICAgIDxUb2dnbGVDaGlwIGxhYmVsPVwiTmlnaHQgTGlnaHRcIiBpY29uPVwia29iZWwtc3VuLXN5bWJvbGljXCIgdj17dE5pZ2h0fSAvPlxuICAgICAgPC9ib3g+XG4gICAgPC9ib3g+XG4gICAgPFNsaWRlcnMgLz5cbiAgPC9ib3g+XG59XG5cbi8vIFNpZ25hbC1zdHJlbmd0aCBnbHlwaCBmb3IgYW4gYWNjZXNzIHBvaW50ICgwXHUyMDEzMTAwIFx1MjE5MiB3aWZpIHRpZXJzKS5cbmZ1bmN0aW9uIHdpZmlJY29uKHN0cmVuZ3RoOiBudW1iZXIpOiBzdHJpbmcge1xuICByZXR1cm4gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgICAvLyBzaW5nbGUgZ2x5cGg7IHN0cmVuZ3RoIHNob3duIGFzIHRleHQgbWV0YVxufVxuXG4vLyBXaS1GaSBBUCBsaXN0IFx1MjAxNCByZWFsIEFzdGFsTmV0d29yayBhY2Nlc3MgcG9pbnRzLCBjb25uZWN0ZWQgb25lIG1hcmtlZCAuYWN0aXZlLlxuZnVuY3Rpb24gV2lmaUxpc3QoKSB7XG4gIGNvbnN0IHdpZmkgPSBOZXR3b3JrLmdldF9kZWZhdWx0KCkud2lmaVxuICBpZiAoIXdpZmkpIHJldHVybiA8Ym94IC8+XG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICB7YmluZCh3aWZpLCBcImFjY2Vzc1BvaW50c1wiKS5hcyhhcHMgPT4ge1xuICAgICAgY29uc3QgYWN0aXZlID0gd2lmaS5hY3RpdmVBY2Nlc3NQb2ludFxuICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgICByZXR1cm4gYXBzXG4gICAgICAgIC5maWx0ZXIoYXAgPT4gYXAuc3NpZCAmJiAhc2Vlbi5oYXMoYXAuc3NpZCkgJiYgc2Vlbi5hZGQoYXAuc3NpZCkpXG4gICAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnN0cmVuZ3RoIC0gYS5zdHJlbmd0aClcbiAgICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAgIC5tYXAoYXAgPT4ge1xuICAgICAgICAgIGNvbnN0IG9uID0gYWN0aXZlICYmIGFwLnNzaWQgPT09IGFjdGl2ZS5zc2lkXG4gICAgICAgICAgcmV0dXJuIDxidXR0b24gY2xhc3M9e29uID8gXCJ4cm93IGFjdGl2ZVwiIDogXCJ4cm93XCJ9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHdpZmkuYWN0aXZhdGVfY29ubmVjdGlvbihhcCwgbnVsbCl9PlxuICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17d2lmaUljb24oYXAuc3RyZW5ndGgpfSAvPlxuICAgICAgICAgICAgICA8bGFiZWwgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2FwLnNzaWR9IC8+XG4gICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInhzXCIgbGFiZWw9e29uID8gXCJDb25uZWN0ZWRcIiA6IGAke2FwLnN0cmVuZ3RofSVgfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgPC9idXR0b24+XG4gICAgICAgIH0pXG4gICAgfSl9XG4gIDwvYm94PlxufVxuXG4vLyBCbHVldG9vdGggZGV2aWNlIGxpc3QgXHUyMDE0IHNhbWUgLnhyb3cgZ3JhbW1hciBhcyBXaS1GaTsgY29ubmVjdGVkIGRldmljZSBpcyAuYWN0aXZlLlxuZnVuY3Rpb24gQnRMaXN0KCkge1xuICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICB7YmluZChidCwgXCJkZXZpY2VzXCIpLmFzKGRldmljZXMgPT4gZGV2aWNlc1xuICAgICAgLmZpbHRlcihkID0+IGQubmFtZSB8fCBkLmFsaWFzKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmNvbm5lY3RlZCkgLSBOdW1iZXIoYS5jb25uZWN0ZWQpKVxuICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAubWFwKGRldiA9PiB7XG4gICAgICAgIGNvbnN0IG9uID0gZGV2LmNvbm5lY3RlZFxuICAgICAgICByZXR1cm4gPGJ1dHRvbiBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IG9uID8gZGV2LmRpc2Nvbm5lY3RfZGV2aWNlKCkgOiBkZXYuY29ubmVjdF9kZXZpY2UoKX0+XG4gICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1ibHVldG9vdGgtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgPGxhYmVsIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtkZXYuYWxpYXMgfHwgZGV2Lm5hbWV9IC8+XG4gICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ4c1wiIGxhYmVsPXtvbiA/IFwiQ29ubmVjdGVkXCIgOiBkZXYucGFpcmVkID8gXCJQYWlyZWRcIiA6IFwiQXZhaWxhYmxlXCJ9IC8+XG4gICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgfSkpfVxuICA8L2JveD5cbn1cblxuLy8gT25lIG1peGVyIHJvdyAoLm1peHJvdykgXHUyMDE0IGhvcml6b250YWw6IDI2XHUwMEQ3MjYgaWNvbiB0aWxlIFx1MDBCNyA3MnB4IG5hbWUgXHUwMEI3IHNsaWRlciBmaWxscy5cbmZ1bmN0aW9uIE1peFJvdyhwcm9wczogeyBpY29uOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcsIHRhcmdldDogYW55IH0pIHtcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJtaXhyb3dcIiBzcGFjaW5nPXsxMH0+XG4gICAgPGJveCBjbGFzcz1cIm1pXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17cHJvcHMuaWNvbn0gLz48L2JveD5cbiAgICA8bGFiZWwgY2xhc3M9XCJtbmFtZVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICBlbGxpcHNpemU9ezN9IGxhYmVsPXtwcm9wcy50aXRsZX0gLz5cbiAgICA8c2xpZGVyIGNsYXNzPVwic2xpZGVyXCIgaGV4cGFuZCB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICB2YWx1ZT17YmluZChwcm9wcy50YXJnZXQsIFwidm9sdW1lXCIpfVxuICAgICAgb25DaGFuZ2VWYWx1ZT17KF9zLCB2KSA9PiB7IHByb3BzLnRhcmdldC52b2x1bWUgPSB2IH19IC8+XG4gIDwvYm94PlxufVxuXG4vLyBQZXItYXBwIHZvbHVtZSBtaXhlciBcdTIwMTQgTWFzdGVyIChkZWZhdWx0IHNwZWFrZXIpICsgZWFjaCBhdWRpbyBzdHJlYW0gKEFzdGFsV3ApLlxuZnVuY3Rpb24gTWl4TGlzdCgpIHtcbiAgY29uc3Qgd3AgPSBXcC5nZXRfZGVmYXVsdCgpXG4gIGlmICghd3ApIHJldHVybiA8Ym94IC8+XG4gIGNvbnN0IHNwZWFrZXIgPSB3cC5kZWZhdWx0X3NwZWFrZXJcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgIHtzcGVha2VyICYmIDxNaXhSb3cgaWNvbj1cImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiIHRpdGxlPVwiT3V0cHV0XCIgdGFyZ2V0PXtzcGVha2VyfSAvPn1cbiAgICB7YmluZCh3cC5hdWRpbywgXCJzdHJlYW1zXCIpLmFzKHN0cmVhbXMgPT4gc3RyZWFtcy5zbGljZSgwLCA1KS5tYXAocyA9PlxuICAgICAgPE1peFJvdyBpY29uPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICB0aXRsZT17cy5kZXNjcmlwdGlvbiB8fCBzLm5hbWUgfHwgXCJBcHBsaWNhdGlvblwifSB0YXJnZXQ9e3N9IC8+KSl9XG4gIDwvYm94PlxufVxuXG5mdW5jdGlvbiBEcmlsbFZpZXcoeyBuYW1lIH06IHsgbmFtZT86IHN0cmluZyB9KSB7XG4gIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICByZXR1cm4gPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICA8Y2VudGVyYm94IGNsYXNzPVwiZGhlYWRcIj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuXCIgb25DbGlja2VkPXsoKSA9PiBkcmlsbC5zZXQobnVsbCl9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLWxlZnQtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPGxhYmVsIGxhYmVsPXtiaW5kKGRyaWxsKS5hcyhkID0+XG4gICAgICAgIGQgPT09IFwid2lmaVwiID8gXCJXaS1GaVwiIDogZCA9PT0gXCJidFwiID8gXCJCbHVldG9vdGhcIiA6IFwiVm9sdW1lXCIpfSAvPlxuICAgICAgPGJveCB3aWR0aFJlcXVlc3Q9ezQ2fSBoYWxpZ249e0d0ay5BbGlnbi5FTkR9PlxuICAgICAgICB7bmV0LndpZmkgJiYgPHN3aXRjaCBhY3RpdmU9e2JpbmQobmV0LndpZmksIFwiZW5hYmxlZFwiKX1cbiAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcyhkID0+IGQgPT09IFwid2lmaVwiKX1cbiAgICAgICAgICBvbk5vdGlmeUFjdGl2ZT17cyA9PiB7IG5ldC53aWZpIS5lbmFibGVkID0gcy5hY3RpdmUgfX0gLz59XG4gICAgICAgIDxzd2l0Y2ggYWN0aXZlPXtiaW5kKEJsdWV0b290aC5nZXRfZGVmYXVsdCgpLCBcInBvd2VyZWRcIil9XG4gICAgICAgICAgdmlzaWJsZT17YmluZChkcmlsbCkuYXMoZCA9PiBkID09PSBcImJ0XCIpfVxuICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXtzID0+IHsgQmx1ZXRvb3RoLmdldF9kZWZhdWx0KCkuYWRhcHRlci5wb3dlcmVkID0gcy5hY3RpdmUgfX0gLz5cbiAgICAgIDwvYm94PlxuICAgIDwvY2VudGVyYm94PlxuICAgIHtiaW5kKGRyaWxsKS5hcyhkID0+XG4gICAgICBkID09PSBcIndpZmlcIiA/IDxXaWZpTGlzdCAvPiA6IGQgPT09IFwiYnRcIiA/IDxCdExpc3QgLz4gOlxuICAgICAgZCA9PT0gXCJtaXhcIiA/IDxNaXhMaXN0IC8+IDogPGJveCAvPil9XG4gIDwvYm94PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBRdWlja1NldHRpbmdzKCkge1xuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJxdWlja3NldHRpbmdzXCIgbmFtZXNwYWNlPVwia29iZWwtcXNcIiBjbGFzcz1cInFzLXdpbmRvd1wiIHZpc2libGU9e2ZhbHNlfVxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVH1cbiAgICBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgIG9uS2V5UHJlc3NlZD17KHNlbGYsIGtleSkgPT4ge1xuICAgICAgaWYgKGtleSAhPT0gR2RrLktFWV9Fc2NhcGUpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKGRyaWxsLmdldCgpKSB7IGRyaWxsLnNldChudWxsKTsgcmV0dXJuIHRydWUgfSAgIC8vIEVzYyBzdGVwcyBiYWNrIGZpcnN0XG4gICAgICBzZWxmLmhpZGUoKTsgcmV0dXJuIHRydWVcbiAgICB9fT5cbiAgICA8Ym94IGNsYXNzPVwic2hlZXQgcXNcIj5cbiAgICAgIHsvKiBHdGsuU3RhY2sgd2l0aCBzbGlkZS1sZWZ0L3JpZ2h0ID0gdGhlIG11bHRpdmlldzsgaGVpZ2h0IGFuaW1hdGVzXG4gICAgICAgICAgdmlhIEFkdyBzcHJpbmcgb24gYSBzaXplLWdyb3VwIHdyYXBwZXIgKE1PVElPTi5kcmlsbCAvIGRyaWxsQmFjaykgKi99XG4gICAgICA8c3RhY2tcbiAgICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5TdGFja1RyYW5zaXRpb25UeXBlLlNMSURFX0xFRlRfUklHSFR9XG4gICAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgICB2aXNpYmxlQ2hpbGROYW1lPXtiaW5kKGRyaWxsKS5hcyhkID0+IGQgPyBcImRyaWxsXCIgOiBcInJvb3RcIil9PlxuICAgICAgICA8Um9vdCBuYW1lPVwicm9vdFwiIC8+XG4gICAgICAgIDxEcmlsbFZpZXcgbmFtZT1cImRyaWxsXCIgLz5cbiAgICAgIDwvc3RhY2s+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuIiwgIi8vIFRpbnlTbGlkZXIgXHUyMDE0IEd0ay5TY2FsZSBzdWJjbGFzcyB0aGF0IHJlcG9ydHMgbmVhci16ZXJvIG5hdHVyYWwgd2lkdGggc28gaXRcbi8vIG5ldmVyIGZvcmNlcyBpdHMgcGFyZW50IGNvbnRhaW5lciB3aWRlciB0aGFuIHRoZSBjaGlwLWdyaWQncyBuYXR1cmFsIHdpZHRoLlxuLy8gV2UgZXh0ZW5kIEd0ay5TY2FsZSBkaXJlY3RseSAobm90IEFzdGFsLlNsaWRlcikgYmVjYXVzZSBBc3RhbC5TbGlkZXIncyBWYWxhXG4vLyBDIHZmdW5jcyBjYW4gaW50ZXJjZXB0IHRoZSBtZWFzdXJlIGNoYWluIGJlZm9yZSB0aGUgR0pTIG92ZXJyaWRlIGlzIHJlYWNoZWQuXG5pbXBvcnQgR09iamVjdCBmcm9tIFwiZ2k6Ly9HT2JqZWN0XCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrXCJcblxuZXhwb3J0IGNvbnN0IFRpbnlTbGlkZXIgPSBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3Moe1xuICBHVHlwZU5hbWU6IFwiS29iZWxUaW55U2NhbGVcIixcbn0sIGNsYXNzIFRpbnlTbGlkZXIgZXh0ZW5kcyBHdGsuU2NhbGUge1xuICBjb25zdHJ1Y3RvcihwYXJhbXM/OiBQYXJ0aWFsPEd0ay5TY2FsZS5Db25zdHJ1Y3RvclByb3BzICYgeyB2YWx1ZT86IG51bWJlciB9Pikge1xuICAgIGNvbnN0IHsgdmFsdWUsIC4uLnJlc3QgfSA9IChwYXJhbXMgPz8ge30pIGFzIGFueVxuICAgIHN1cGVyKHtcbiAgICAgIG9yaWVudGF0aW9uOiBHdGsuT3JpZW50YXRpb24uSE9SSVpPTlRBTCxcbiAgICAgIGFkanVzdG1lbnQ6IG5ldyBHdGsuQWRqdXN0bWVudCh7XG4gICAgICAgIGxvd2VyOiAwLCB1cHBlcjogMSxcbiAgICAgICAgc3RlcF9pbmNyZW1lbnQ6IDAuMDEsIHBhZ2VfaW5jcmVtZW50OiAwLjEsIHBhZ2Vfc2l6ZTogMCxcbiAgICAgICAgdmFsdWU6IHZhbHVlID8/IDAsXG4gICAgICB9KSxcbiAgICAgIGRyYXdfdmFsdWU6IGZhbHNlLFxuICAgICAgLi4ucmVzdCxcbiAgICB9KVxuICB9XG5cbiAgdmZ1bmNfbWVhc3VyZShvcmllbnRhdGlvbjogR3RrLk9yaWVudGF0aW9uLCBmb3Jfc2l6ZTogbnVtYmVyKTogW251bWJlciwgbnVtYmVyLCBudW1iZXIsIG51bWJlcl0ge1xuICAgIGlmIChvcmllbnRhdGlvbiA9PT0gR3RrLk9yaWVudGF0aW9uLkhPUklaT05UQUwpIHtcbiAgICAgIC8vIFJlcG9ydCBuYXR1cmFsPTEgc28gdGhlIHNyb3cvc2xpZGVycyBjb250YWluZXIgZG9lc24ndCBpbmZsYXRlIHRoZSBRUyBwYW5lbFxuICAgICAgLy8gYmV5b25kIHRoZSBjaGlwLWdyaWQgbmF0dXJhbCB3aWR0aC4gVGhlIHNsaWRlciBzdGlsbCBoZXhwYW5kcyB0byBmaWxsIHRoZVxuICAgICAgLy8gYXZhaWxhYmxlIHNwYWNlIGF0IGFsbG9jYXRpb24gdGltZSBcdTIwMTQgb25seSB0aGUgbmF0dXJhbCBzaXplIGlzIG92ZXJyaWRkZW4uXG4gICAgICByZXR1cm4gWzAsIDEsIC0xLCAtMV07XG4gICAgfVxuICAgIHJldHVybiBzdXBlci52ZnVuY19tZWFzdXJlKG9yaWVudGF0aW9uLCBmb3Jfc2l6ZSk7XG4gIH1cbn0pXG4iLCAiLy8gTm90aWZpY2F0aW9ucy4gUHJvdG90eXBlLWZpbmFsOiBmbG9hdGluZyBibHVycmVkIHRvYXN0cyAodG9wLXJpZ2h0LCB0aGUgT05FXG4vLyBzYW5jdGlvbmVkIHRyYW5zbHVjZW5jeSkgKyByaWdodCBkcmF3ZXIgKG1lZGlhIGNhcmQgb24gdG9wLCBwYW5lbC1sZXNzIGNhcmRzXG4vLyBmbG9hdGluZyBvbiB3YWxscGFwZXIsIGhlYWRlciBjaGlwKS4gVGhlIHVuaWZpZWQgcGlwZWxpbmU6IG9wZW4gdGhlIGRyYXdlciB3aGlsZVxuLy8gYSB0b2FzdCBpcyBsaXZlIGFuZCBpdCdzIEFET1BURUQgaW50byB0aGUgc3RhY2s7IHRvYXN0cyBhcnJpdmluZyB3aGlsZSBvcGVuXG4vLyBpbnNlcnQgYXMgY2FyZHM7IFNpbGVudCByb3V0ZXMgc3RyYWlnaHQgdG8gdGhlIHN0b3JlLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgdGltZW91dCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTm90aWZkIGZyb20gXCJnaTovL0FzdGFsTm90aWZkXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcblxuLy8gTGF6eSBzaW5nbGV0b24gXHUyMDE0IGNhbGxpbmcgZ2V0X2RlZmF1bHQoKSBhdCBtb2R1bGUgc2NvcGUgYmxvY2tzIHRoZSBpbXBvcnQgd2hpbGVcbi8vIEFzdGFsTm90aWZkIHRyaWVzIHRvIGFjcXVpcmUgb3JnLmZyZWVkZXNrdG9wLk5vdGlmaWNhdGlvbnMgKGhhbmdzIGlmIGdub21lLXNoZWxsXG4vLyBzdGlsbCBvd25zIGl0KS4gRGVmZXJyaW5nIHRvIGZpcnN0IHVzZSBsZXRzIHRoZSBtb2R1bGUgaW1wb3J0IGNsZWFubHk7IHRoZSBidXMgaXNcbi8vIHJlbGVhc2VkIGJ5IGBnbm9ibGluY3RsIGRpc2FibGUgbm90aWZpY2F0aW9uc2AgYmVmb3JlIHRoZSBkYWVtb24gYWN0dWFsbHkgY2xhaW1zIGl0LlxubGV0IF9ub3RpZmQ6IE5vdGlmZC5Ob3RpZmQgfCBudWxsID0gbnVsbFxuY29uc3QgbmQgPSAoKSA9PiAoX25vdGlmZCA/Pz0gTm90aWZkLmdldF9kZWZhdWx0KCkpXG5jb25zdCBza2lwID0gKCkgPT4gISFHTGliLmdldGVudihcIktPQkVMX1NLSVBfTk9USUZEXCIpXG5jb25zdCBUT0FTVF9NUyA9IDM4MDBcbi8vIFJlYWN0aXZlIGRyYXdlci1vcGVuIHN0YXRlIHNvIHRoZSB0b2FzdHMgY2FuIGJlIEFET1BURUQgKGhpZGRlbikgdGhlIGluc3RhbnQgdGhlXG4vLyBkcmF3ZXIgb3BlbnMsIHdpdGhvdXQgcG9sbGluZyBhIGxvb2tlZC11cCB3aW5kb3cncyB2aXNpYmlsaXR5LlxuY29uc3QgZHJhd2VyT3BlbiA9IFZhcmlhYmxlKGZhbHNlKVxuXG4vLyBOb3RpZmljYXRpb24gY2FyZHMgYXJlIGEgZGVmaW5lZCB3aWR0aCAocHJvdG90eXBlIGBwd2AgXHUyMjQ4IFFTIHBhbmVsKSBzbyB0aGUgdG9hc3Rcbi8vIGRvZXNuJ3Qgc3RyZXRjaCB0byB0aGUgaGV4cGFuZCB0ZXh0IGNvbHVtbjsgdGhlIGRyYXdlciBjYXJkcyBmaWxsIHRoZSBzYW1lIHdpZHRoLlxuY29uc3QgTkNBUkRfVyA9IDMyN1xuZnVuY3Rpb24gQ2FyZCh7IG4gfTogeyBuOiBOb3RpZmQuTm90aWZpY2F0aW9uIH0pIHtcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJuY2FyZFwiIHNwYWNpbmc9ezEwfSB3aWR0aFJlcXVlc3Q9e05DQVJEX1d9PlxuICAgIHsvKiBhcHAgaWNvbiBpbiBhIDMwXHUwMEQ3MzAgcjkgdGlsZSAocHJvdG90eXBlIC5uaWMpICovfVxuICAgIDxib3ggY2xhc3M9XCJuaWNcIiB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH0+XG4gICAgICA8aW1hZ2UgaWNvbk5hbWU9e24uYXBwX2ljb24gfHwgXCJkaWFsb2ctaW5mb3JtYXRpb24tc3ltYm9saWNcIn0gcGl4ZWxTaXplPXsyMH0gLz5cbiAgICA8L2JveD5cbiAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICA8Ym94PlxuICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGhleHBhbmQgZWxsaXBzaXplPXszfSBsYWJlbD17bi5zdW1tYXJ5fSAvPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJ3aGVuIHRuXCIgbGFiZWw9e25ldyBEYXRlKG4udGltZSAqIDEwMDApXG4gICAgICAgICAgLnRvTG9jYWxlVGltZVN0cmluZyhcImVuLUdCXCIsIHsgaG91cjogXCIyLWRpZ2l0XCIsIG1pbnV0ZTogXCIyLWRpZ2l0XCIgfSl9IC8+XG4gICAgICA8L2JveD5cbiAgICAgIDxsYWJlbCBjbGFzcz1cImJvZHlcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0geGFsaWduPXswfSB3cmFwXG4gICAgICAgIG1heFdpZHRoQ2hhcnM9ezQwfSBsYWJlbD17bi5ib2R5fSAvPlxuICAgIDwvYm94PlxuICAgIDxidXR0b24gY2xhc3M9XCJueFwiIHZhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBvbkNsaWNrZWQ9eygpID0+IG4uZGlzbWlzcygpfT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNsb3NlLXN5bWJvbGljXCIgLz5cbiAgICA8L2J1dHRvbj5cbiAgPC9ib3g+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBUb2FzdHMobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgaWYgKHNraXAoKSkgcmV0dXJuIG51bGxcbiAgLy8gT25seSByZW5kZXIgbm90aWZpY2F0aW9ucyB5b3VuZ2VyIHRoYW4gVE9BU1RfTVMgd2hpbGUgdGhlIGRyYXdlciBpcyBDTE9TRUQgXHUyMDE0XG4gIC8vIG9wZW5pbmcgdGhlIGRyYXdlciBcImFkb3B0c1wiIHRoZW0gKHRoZXkgc2ltcGx5IGNvbnRpbnVlIGxpZmUgYXMgZHJhd2VyIGNhcmRzLFxuICAvLyB3aGljaCBpcyB0aGUgRkxJUCBoYW5kb2ZmIGV4cHJlc3NlZCBpbiByZXRhaW5lZC1tb2RlIHRlcm1zKS5cbiAgY29uc3QgbGl2ZSA9IFZhcmlhYmxlPG51bWJlcltdPihbXSlcbiAgLy8gYHNob3duYCA9IHdoYXQgdGhlIHRvYXN0IGNvbHVtbiByZW5kZXJzLiBSZWNvbXB1dGVkIGV4cGxpY2l0bHkgb24gZXZlcnkgaW5wdXRcbiAgLy8gY2hhbmdlIChWYXJpYWJsZS5kZXJpdmUgZGlkbid0IHByb2R1Y2UgYSByZWFjdGl2ZSBiaW5kaW5nIGhlcmUpLiBFbXB0eSB3aGlsZSB0aGVcbiAgLy8gZHJhd2VyIGlzIG9wZW4gKHRvYXN0cyBhcmUgQURPUFRFRCBpbnRvIHRoZSBkcmF3ZXIgc3RhY2spLlxuICBjb25zdCBzaG93biA9IFZhcmlhYmxlPG51bWJlcltdPihbXSlcbiAgY29uc3QgcmVjb21wdXRlID0gKCkgPT4gc2hvd24uc2V0KGRyYXdlck9wZW4uZ2V0KCkgPyBbXSA6IGxpdmUuZ2V0KCkpXG4gIGxpdmUuc3Vic2NyaWJlKHJlY29tcHV0ZSlcbiAgZHJhd2VyT3Blbi5zdWJzY3JpYmUocmVjb21wdXRlKVxuICBuZCgpLmNvbm5lY3QoXCJub3RpZmllZFwiLCAoX24sIGlkKSA9PiB7XG4gICAgaWYgKGRyYXdlck9wZW4uZ2V0KCkgfHwgbmQoKS5kb250X2Rpc3R1cmIpIHJldHVyblxuICAgIGxpdmUuc2V0KFsuLi5saXZlLmdldCgpLCBpZF0pXG4gICAgdGltZW91dChUT0FTVF9NUywgKCkgPT4gbGl2ZS5zZXQobGl2ZS5nZXQoKS5maWx0ZXIoeCA9PiB4ICE9PSBpZCkpKVxuICB9KVxuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJ0b2FzdHNcIiBuYW1lc3BhY2U9XCJrb2JlbC10b2FzdHNcIiBnZGttb25pdG9yPXttb25pdG9yfVxuICAgIC8vIEhpZGUgdGhlIHdob2xlIHRvYXN0IHN1cmZhY2Ugd2hpbGUgdGhlIGRyYXdlciBpcyBvcGVuICh0b2FzdHMgYXJlIEFET1BURUQgaW50b1xuICAgIC8vIHRoZSBkcmF3ZXIpIFx1MjAxNCBhIHJlYWN0aXZlIHdpbmRvdy12aXNpYmlsaXR5IGJpbmQsIHJvYnVzdCByZWdhcmRsZXNzIG9mIHRoZVxuICAgIC8vIHBlci1pdGVtIGxpc3QgcmVjb25jaWxpYXRpb24uXG4gICAgdmlzaWJsZT17YmluZChkcmF3ZXJPcGVuKS5hcyhvID0+ICFvKX1cbiAgICAvLyBUb2FzdHMgYXJlIGEgZmxvYXRpbmcgb3ZlcmxheSAobGlrZSB0aGUgcHJvdG90eXBlJ3MgYWJzb2x1dGUgdG9wL3JpZ2h0KTsgdGhlXG4gICAgLy8gZmxvYXQgaW5zZXQgY2xlYXJzIHRoZSBmbG9hdGluZyBiYXIgKG1hcmdpblRvcCAxMCArIGhlaWdodCA0MikgKyBhIHNtYWxsIGdhcCxcbiAgICAvLyBhbmQgdGhlIHJpZ2h0IGluc2V0IG1hdGNoZXMgdGhlIGJhcidzIGVkZ2UgbWFyZ2luLlxuICAgIG1hcmdpblRvcD17NTh9IG1hcmdpblJpZ2h0PXsxMn1cbiAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFR9PlxuICAgIHsvKiBmaXhlZCB0b2FzdCBjb2x1bW4gd2lkdGggc28gdGhlIGNhcmQgY2FuJ3Qgc3RyZXRjaCB0byBpdHMgaGV4cGFuZCB0ZXh0IGNvbHVtbiAqL31cbiAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9XG4gICAgICB3aWR0aFJlcXVlc3Q9e05DQVJEX1cgKyAyNn0gaGFsaWduPXtHdGsuQWxpZ24uRU5EfT5cbiAgICAgIHtiaW5kKHNob3duKS5hcyhpZHMgPT4gaWRzLm1hcChpZCA9PiB7XG4gICAgICAgIGNvbnN0IG4gPSBuZCgpLmdldF9ub3RpZmljYXRpb24oaWQpXG4gICAgICAgIHJldHVybiBuID8gPGJveCBjbGFzcz1cInRvYXN0XCI+PENhcmQgbj17bn0gLz48L2JveD4gOiA8Ym94IC8+XG4gICAgICB9KSl9XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuXG5mdW5jdGlvbiBNZWRpYUNhcmQoKSB7XG4gIGxldCBwbGF5ZXI6IGFueSA9IG51bGxcbiAgdHJ5IHsgcGxheWVyID0gTXByaXMuZ2V0X2RlZmF1bHQoKT8ucGxheWVycz8uWzBdID8/IG51bGwgfSBjYXRjaCB7IHBsYXllciA9IG51bGwgfVxuICBpZiAoIXBsYXllcikgcmV0dXJuIDxib3ggdmlzaWJsZT17ZmFsc2V9IC8+XG4gIHJldHVybiA8Ym94IGNsYXNzPVwibmNhcmQgbWVkaWFcIiBzcGFjaW5nPXsxMX0+XG4gICAgPGltYWdlIHBpeGVsU2l6ZT17NDZ9IGljb25OYW1lPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIiAvPlxuICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gaGV4cGFuZCB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBlbGxpcHNpemU9ezN9IGxhYmVsPXtiaW5kKHBsYXllciwgXCJ0aXRsZVwiKX0gLz5cbiAgICAgIDxsYWJlbCBjbGFzcz1cInN1YlwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17YmluZChwbGF5ZXIsIFwiYXJ0aXN0XCIpfSAvPlxuICAgIDwvYm94PlxuICAgIDxidXR0b24gb25DbGlja2VkPXsoKSA9PiBwbGF5ZXIucHJldmlvdXMoKX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtc2tpcC1iYWNrLXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4gcGxheWVyLnBsYXlfcGF1c2UoKX0+XG4gICAgICA8aW1hZ2UgaWNvbk5hbWU9e2JpbmQocGxheWVyLCBcInBsYXliYWNrX3N0YXR1c1wiKS5hcyhzID0+XG4gICAgICAgIHMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCIgOiBcImtvYmVsLXBsYXktc3ltYm9saWNcIil9IC8+XG4gICAgPC9idXR0b24+XG4gICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IHBsYXllci5uZXh0KCl9PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXNraXAtZndkLXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgPC9ib3g+XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBEcmF3ZXIoKSB7XG4gIGlmIChza2lwKCkpIHJldHVybiBudWxsXG4gIGNvbnN0IG5mZCA9IG5kKClcbiAgLy8gRHJpdmUgdGhlIGxpc3QgZnJvbSBhIFZhcmlhYmxlIG9mZiBnZXRfbm90aWZpY2F0aW9ucygpICsgc2lnbmFscywgbm90IGEgcHJvcGVydHlcbiAgLy8gYmluZCBcdTIwMTQgQXN0YWxOb3RpZmQncyBgbm90aWZpY2F0aW9uc2AgaXNuJ3QgcmVsaWFibHkgYmluZGFibGUgYWNyb3NzIEdKUyB2ZXJzaW9ucy5cbiAgY29uc3QgbGlzdCA9IFZhcmlhYmxlPE5vdGlmZC5Ob3RpZmljYXRpb25bXT4obmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBsaXN0LnNldChuZmQuZ2V0X25vdGlmaWNhdGlvbnMoKSA/PyBbXSlcbiAgbmZkLmNvbm5lY3QoXCJub3RpZmllZFwiLCByZWZyZXNoKVxuICBuZmQuY29ubmVjdChcInJlc29sdmVkXCIsIHJlZnJlc2gpXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImRyYXdlclwiIG5hbWVzcGFjZT1cImtvYmVsLWRyYXdlclwiIGNsYXNzPVwiZHJhd2VyLXdpbmRvd1wiIHZpc2libGU9e2ZhbHNlfVxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5SSUdIVCB8IEFzdGFsLldpbmRvd0FuY2hvci5CT1RUT019XG4gICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgc2V0dXA9eyhzZWxmOiBHdGsuV2luZG93KSA9PiBzZWxmLmNvbm5lY3QoXCJub3RpZnk6OnZpc2libGVcIixcbiAgICAgICgpID0+IGRyYXdlck9wZW4uc2V0KHNlbGYudmlzaWJsZSkpfVxuICAgIG9uS2V5UHJlc3NlZD17KHNlbGYsIGtleSkgPT4ga2V5ID09PSBHZGsuS0VZX0VzY2FwZSA/IChzZWxmLmhpZGUoKSwgdHJ1ZSkgOiBmYWxzZX0+XG4gICAgPGJveCBjbGFzcz1cImRyYXdlclwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgPE1lZGlhQ2FyZCAvPlxuICAgICAgPGJveCBjbGFzcz1cIm5oZWFkXCIgc3BhY2luZz17OH0+XG4gICAgICAgIDxsYWJlbCBoZXhwYW5kIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD1cIk5vdGlmaWNhdGlvbnNcIiAvPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0biBzdWJcIiBsYWJlbD17YmluZChsaXN0KS5hcyhuID0+IGAke24ubGVuZ3RoIHx8IFwiXCJ9YCl9IC8+XG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJuY2xlYXJcIiBvbkNsaWNrZWQ9eygpID0+XG4gICAgICAgICAgbmZkLmdldF9ub3RpZmljYXRpb25zKCkuZm9yRWFjaChuID0+IG4uZGlzbWlzcygpKX0+XG4gICAgICAgICAgPGJveCBzcGFjaW5nPXs1fT48aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC10cmFzaC1zeW1ib2xpY1wiIC8+PGxhYmVsIGxhYmVsPVwiQ2xlYXJcIiAvPjwvYm94PlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgIDwvYm94PlxuICAgICAgey8qIGZ1bGwtaGVpZ2h0IGRyYXdlciwgc28gY2FyZHMganVzdCBzdGFjayAoaG9sZHMgbWFueSkuIEEgR3RrLlNjcm9sbGVkV2luZG93XG4gICAgICAgICAgd3JhcHBlciBjb2xsYXBzZXMgaGVyZSBcdTIwMTQgYXN0YWwncyByZWFjdGl2ZSBiaW5kKCkgY2hpbGRyZW4gZG9uJ3QgcmVuZGVyIGluc2lkZVxuICAgICAgICAgIGEgbWFudWFsbHktY29uc3RydWN0ZWQgU2Nyb2xsZWRXaW5kb3cgY2hpbGQsIHNvIGl0IHJlcG9ydHMgMCBuYXR1cmFsIHNpemUuXG4gICAgICAgICAgUHJvcGVyIHNjcm9sbGluZyBmb3IgMjArIG5vdGlmaWNhdGlvbnMgaXMgYSBmb2xsb3ctdXAuICovfVxuICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fSB2ZXhwYW5kPlxuICAgICAgICB7YmluZChsaXN0KS5hcyhucyA9PiAobnMgJiYgbnMubGVuZ3RoKVxuICAgICAgICAgID8gbnMubWFwKG4gPT4gPENhcmQgbj17bn0gLz4pXG4gICAgICAgICAgOiBbPGJveCBjbGFzcz1cIm5jYXJkIGVtcHR5XCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPVwiQWxsIGNhdWdodCB1cCBcdTI3MTNcIiAvPlxuICAgICAgICAgICAgPC9ib3g+XSl9XG4gICAgICA8L2JveD5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gT1NEIFx1MjAxNCBkaXNwbGF5LW9ubHkgdm9sdW1lIHBpbGwgYWJvdmUgdGhlIGRvY2suIFByb3RvdHlwZTogcG9pbnRlci1ldmVudHMgbm9uZSxcbi8vIGF1dG8taGlkZSAxLjRzLCB0cmFuc2x1Y2VudCAoYmx1ciB2aWEgZ25vYmxpbiB3aW5kb3ctcnVsZSkuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIE9TRChtb25pdG9yOiBHZGsuTW9uaXRvcikge1xuICBjb25zdCBzcGVha2VyID0gV3AuZ2V0X2RlZmF1bHQoKT8uZGVmYXVsdF9zcGVha2VyID8/IG51bGxcbiAgY29uc3QgdmlzaWJsZSA9IFZhcmlhYmxlKGZhbHNlKVxuICBsZXQgaGlkZTogUmV0dXJuVHlwZTx0eXBlb2YgdGltZW91dD4gfCBudWxsID0gbnVsbFxuICBpZiAoIXNwZWFrZXIpIHJldHVybiBudWxsXG5cbiAgc3BlYWtlci5jb25uZWN0KFwibm90aWZ5Ojp2b2x1bWVcIiwgKCkgPT4ge1xuICAgIHZpc2libGUuc2V0KHRydWUpXG4gICAgaGlkZT8uY2FuY2VsKClcbiAgICBoaWRlID0gdGltZW91dCgxNDAwLCAoKSA9PiB2aXNpYmxlLnNldChmYWxzZSkpXG4gIH0pXG5cbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwib3NkXCIgbmFtZXNwYWNlPVwia29iZWwtb3NkXCIgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5CT1RUT019IG1hcmdpbkJvdHRvbT17NzB9XG4gICAgY2xpY2tUaHJvdWdoIHZpc2libGU9e2JpbmQodmlzaWJsZSl9PlxuICAgIDxib3ggY2xhc3M9XCJvc2RcIiBzcGFjaW5nPXsxMX0gd2lkdGhSZXF1ZXN0PXsyMzB9PlxuICAgICAgPGltYWdlIGljb25OYW1lPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIil9IC8+XG4gICAgICA8bGV2ZWxiYXIgaGV4cGFuZCB2YWx1ZT17YmluZChzcGVha2VyLCBcInZvbHVtZVwiKX0gLz5cbiAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e2JpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIikuYXModiA9PlxuICAgICAgICBgJHtNYXRoLnJvdW5kKHYgKiAxMDApfSVgKX0gLz5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gU2Vzc2lvbiBvdmVybGF5IFx1MjAxNCBkaW1tZWQgKDAuOCksIDQgYnV0dG9ucywgYXJyb3ctbmF2LCBQUkVTUy1BR0FJTiBjb25maXJtIG9uXG4vLyBSZXN0YXJ0L1NodXQgZG93biAoYXV0by1yZXZlcnQgNHMpLCByZXN0aW5nIHJvc2Ugb24gU2h1dCBkb3duLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgdGltZW91dCB9IGZyb20gXCJhc3RhbFwiXG4vLyBQaW4gYSBkZXRlcm1pbmlzdGljIHJlbmRlciBmb3IgdGhlIERPTS12cy1HVEsgb3ZlcmxheSBkaWZmIChsYWJlbHMvaWNvbnMgYWxyZWFkeVxuLy8gZml4ZWQ7IGltcG9ydGluZyBERU1PIGtlZXBzIHRoZSBzdXJmYWNlIHJlbmRlciBjb25zaXN0ZW50IHVuZGVyIEtPQkVMX0RFTU8pLlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG52b2lkIERFTU87IHZvaWQgRFxuXG5jb25zdCBBQ1RJT05TID0gW1xuICB7IGlkOiBcImxvY2tcIiwgbGFiZWw6IFwiTG9ja1wiLCBpY29uOiBcImtvYmVsLWxvY2stc3ltYm9saWNcIixcbiAgICBjb25maXJtOiBmYWxzZSwgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJsb2dpbmN0bCBsb2NrLXNlc3Npb25cIikgfSxcbiAgeyBpZDogXCJsb2dvdXRcIiwgbGFiZWw6IFwiTG9nIG91dFwiLCBpY29uOiBcImtvYmVsLWxvZ291dC1zeW1ib2xpY1wiLFxuICAgIGNvbmZpcm06IGZhbHNlLCBydW46ICgpID0+IGV4ZWNBc3luYyhcImdub21lLXNlc3Npb24tcXVpdCAtLWxvZ291dCAtLW5vLXByb21wdFwiKSB9LFxuICB7IGlkOiBcInJlc3RhcnRcIiwgbGFiZWw6IFwiUmVzdGFydFwiLCBpY29uOiBcImtvYmVsLXJlbG9hZC1zeW1ib2xpY1wiLFxuICAgIGNvbmZpcm06IHRydWUsIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwic3lzdGVtY3RsIHJlYm9vdFwiKSB9LFxuICB7IGlkOiBcInNodXRkb3duXCIsIGxhYmVsOiBcIlNodXQgZG93blwiLCBpY29uOiBcImtvYmVsLXBvd2VyLXN5bWJvbGljXCIsXG4gICAgY29uZmlybTogdHJ1ZSwgcmVkOiB0cnVlLCBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCBwb3dlcm9mZlwiKSB9LFxuXVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBTZXNzaW9uKCkge1xuICBjb25zdCBhcm1lZCA9IFZhcmlhYmxlPHN0cmluZyB8IG51bGw+KG51bGwpXG4gIGxldCByZXZlcnQ6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcblxuICBjb25zdCBwcmVzcyA9IChhOiB0eXBlb2YgQUNUSU9OU1tudW1iZXJdLCBoaWRlOiAoKSA9PiB2b2lkKSA9PiB7XG4gICAgaWYgKGEuY29uZmlybSAmJiBhcm1lZC5nZXQoKSAhPT0gYS5pZCkge1xuICAgICAgYXJtZWQuc2V0KGEuaWQpXG4gICAgICByZXZlcnQ/LmNhbmNlbCgpXG4gICAgICByZXZlcnQgPSB0aW1lb3V0KDQwMDAsICgpID0+IGFybWVkLnNldChudWxsKSkgICAvLyBhdXRvLXJldmVydCAoY3JpdGlxdWUpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgYXJtZWQuc2V0KG51bGwpOyBoaWRlKCk7IGEucnVuKClcbiAgfVxuXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cInNlc3Npb25cIiBuYW1lc3BhY2U9XCJrb2JlbC1zZXNzaW9uXCIgY2xhc3M9XCJzZXNzaW9uLXdpbmRvd1wiIHZpc2libGU9e2ZhbHNlfVxuICAgIGFuY2hvcj17QXN0YWwuV2luZG93QW5jaG9yLlRPUCB8IEFzdGFsLldpbmRvd0FuY2hvci5CT1RUT00gfFxuICAgICAgICAgICAgQXN0YWwuV2luZG93QW5jaG9yLkxFRlQgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFR9XG4gICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5FWENMVVNJVkV9IGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5JR05PUkV9XG4gICAgb25LZXlQcmVzc2VkPXsoc2VsZiwga2V5KSA9PiB7XG4gICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0VzY2FwZSkgeyBhcm1lZC5zZXQobnVsbCk7IHNlbGYuaGlkZSgpOyByZXR1cm4gdHJ1ZSB9XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9fT5cbiAgICB7LyogLnNlc3Npb24gZmlsbHMgdGhlIHdob2xlIHdpbmRvdyAodGhlIGRpbSk7IGJ1dHRvbnMgY2VudGVyZWQgaW5zaWRlICovfVxuICAgIDxib3ggY2xhc3M9XCJzZXNzaW9uXCIgaGV4cGFuZCB2ZXhwYW5kPlxuICAgICAgPGJveCBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gc3BhY2luZz17MjB9IGhleHBhbmQ+XG4gICAgICAgIHtBQ1RJT05TLm1hcChhID0+XG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz17YS5yZWQgPyBcInNidG4gcmVkXCIgOiBcInNidG5cIn1cbiAgICAgICAgICAgIG9uQ2xpY2tlZD17c2VsZiA9PiBwcmVzcyhhLCAoKSA9PiBzZWxmLmdldF9yb290KCk/LmhpZGU/LigpKX0+XG4gICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezEwfVxuICAgICAgICAgICAgICBjbGFzcz17YmluZChhcm1lZCkuYXMoeCA9PiB4ID09PSBhLmlkID8gXCJjb25maXJtXCIgOiBcIlwiKX0+XG4gICAgICAgICAgICAgIDxib3ggY2xhc3M9XCJzaWNcIiBoZXhwYW5kPXtmYWxzZX0gdmV4cGFuZD17ZmFsc2V9XG4gICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgIHsvKiBob3Jpem9udGFsIEd0a0JveCBpZ25vcmVzIGEgY2hpbGQncyBtYWluLWF4aXMgaGFsaWduLCBzbyB0aGUgaWNvblxuICAgICAgICAgICAgICAgICAgICBsZWZ0LXBhY2tzOyBoZXhwYW5kIG1ha2VzIHRoZSBpbWFnZSBmaWxsIHRoZSA1OXB4IHRpbGUgXHUyMTkyIEd0a0ltYWdlXG4gICAgICAgICAgICAgICAgICAgIGNlbnRyZXMgdGhlIGdseXBoLiBoZXhwYW5kPXtmYWxzZX0gb24gLnNpYyBibG9ja3MgcHJvcGFnYXRpb24gc28gdGhlXG4gICAgICAgICAgICAgICAgICAgIHRpbGUgc3RheXMgNTkgd2lkZSBpbnN0ZWFkIG9mIHN0cmV0Y2hpbmcgdGhlIHJvdy4gKi99XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXthLmljb259IHBpeGVsU2l6ZT17MjJ9IGhleHBhbmRcbiAgICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICAgICAgPGxhYmVsIGxhYmVsPXtiaW5kKGFybWVkKS5hcyh4ID0+IHggPT09IGEuaWQgPyBcIlByZXNzIGFnYWluXCIgOiBhLmxhYmVsKX0gLz5cbiAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgIDwvYnV0dG9uPil9XG4gICAgICA8L2JveD5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsT0FBT0EsWUFBVztBQUNsQixPQUFPQyxVQUFTO0FBQ2hCLE9BQU9DLFVBQVM7OztBQ0ZoQixPQUFPQyxZQUFXOzs7QUNBWCxJQUFNLFdBQVcsQ0FBQyxRQUFnQixJQUNwQyxRQUFRLG1CQUFtQixPQUFPLEVBQ2xDLFdBQVcsS0FBSyxHQUFHLEVBQ25CLFlBQVk7QUFFVixJQUFNLFdBQVcsQ0FBQyxRQUFnQixJQUNwQyxRQUFRLG1CQUFtQixPQUFPLEVBQ2xDLFdBQVcsS0FBSyxHQUFHLEVBQ25CLFlBQVk7QUFjVixJQUFNLFVBQU4sTUFBTSxTQUFlO0FBQUEsRUFDaEIsY0FBYyxDQUFDLE1BQVc7QUFBQSxFQUVsQztBQUFBLEVBQ0E7QUFBQSxFQVNBLE9BQU8sS0FBSyxTQUFxQyxNQUFlO0FBQzVELFdBQU8sSUFBSSxTQUFRLFNBQVMsSUFBSTtBQUFBLEVBQ3BDO0FBQUEsRUFFUSxZQUFZLFNBQTRDLE1BQWU7QUFDM0UsU0FBSyxXQUFXO0FBQ2hCLFNBQUssUUFBUSxRQUFRLFNBQVMsSUFBSTtBQUFBLEVBQ3RDO0FBQUEsRUFFQSxXQUFXO0FBQ1AsV0FBTyxXQUFXLEtBQUssUUFBUSxHQUFHLEtBQUssUUFBUSxNQUFNLEtBQUssS0FBSyxNQUFNLEVBQUU7QUFBQSxFQUMzRTtBQUFBLEVBRUEsR0FBTSxJQUFpQztBQUNuQyxVQUFNQyxRQUFPLElBQUksU0FBUSxLQUFLLFVBQVUsS0FBSyxLQUFLO0FBQ2xELElBQUFBLE1BQUssY0FBYyxDQUFDLE1BQWEsR0FBRyxLQUFLLFlBQVksQ0FBQyxDQUFDO0FBQ3ZELFdBQU9BO0FBQUEsRUFDWDtBQUFBLEVBRUEsTUFBYTtBQUNULFFBQUksT0FBTyxLQUFLLFNBQVMsUUFBUTtBQUM3QixhQUFPLEtBQUssWUFBWSxLQUFLLFNBQVMsSUFBSSxDQUFDO0FBRS9DLFFBQUksT0FBTyxLQUFLLFVBQVUsVUFBVTtBQUNoQyxZQUFNLFNBQVMsT0FBTyxTQUFTLEtBQUssS0FBSyxDQUFDO0FBQzFDLFVBQUksT0FBTyxLQUFLLFNBQVMsTUFBTSxNQUFNO0FBQ2pDLGVBQU8sS0FBSyxZQUFZLEtBQUssU0FBUyxNQUFNLEVBQUUsQ0FBQztBQUVuRCxhQUFPLEtBQUssWUFBWSxLQUFLLFNBQVMsS0FBSyxLQUFLLENBQUM7QUFBQSxJQUNyRDtBQUVBLFVBQU0sTUFBTSw4QkFBOEI7QUFBQSxFQUM5QztBQUFBLEVBRUEsVUFBVSxVQUE4QztBQUNwRCxRQUFJLE9BQU8sS0FBSyxTQUFTLGNBQWMsWUFBWTtBQUMvQyxhQUFPLEtBQUssU0FBUyxVQUFVLE1BQU07QUFDakMsaUJBQVMsS0FBSyxJQUFJLENBQUM7QUFBQSxNQUN2QixDQUFDO0FBQUEsSUFDTCxXQUFXLE9BQU8sS0FBSyxTQUFTLFlBQVksWUFBWTtBQUNwRCxZQUFNLFNBQVMsV0FBVyxLQUFLLEtBQUs7QUFDcEMsWUFBTSxLQUFLLEtBQUssU0FBUyxRQUFRLFFBQVEsTUFBTTtBQUMzQyxpQkFBUyxLQUFLLElBQUksQ0FBQztBQUFBLE1BQ3ZCLENBQUM7QUFDRCxhQUFPLE1BQU07QUFDVCxRQUFDLEtBQUssU0FBUyxXQUF5QyxFQUFFO0FBQUEsTUFDOUQ7QUFBQSxJQUNKO0FBQ0EsVUFBTSxNQUFNLEdBQUcsS0FBSyxRQUFRLGtCQUFrQjtBQUFBLEVBQ2xEO0FBQ0o7QUFFTyxJQUFNLEVBQUUsS0FBSyxJQUFJO0FBQ3hCLElBQU8sa0JBQVE7OztBQ3hGZixPQUFPLFdBQVc7QUFHWCxJQUFNLE9BQU8sTUFBTTtBQUVuQixTQUFTLFNBQVNDLFdBQWtCLFVBQXVCO0FBQzlELFNBQU8sTUFBTSxLQUFLLFNBQVNBLFdBQVUsTUFBTSxLQUFLLFdBQVcsQ0FBQztBQUNoRTtBQUVPLFNBQVMsUUFBUUMsVUFBaUIsVUFBdUI7QUFDNUQsU0FBTyxNQUFNLEtBQUssUUFBUUEsVUFBUyxNQUFNLEtBQUssV0FBVyxDQUFDO0FBQzlEOzs7QUNYQSxPQUFPQyxZQUFXO0FBU1gsSUFBTSxVQUFVQSxPQUFNO0FBVXRCLFNBQVMsV0FDWixXQUNBLFFBQWtDLE9BQ2xDLFFBQWtDLFVBQ3BDO0FBQ0UsUUFBTSxPQUFPLE1BQU0sUUFBUSxTQUFTLEtBQUssT0FBTyxjQUFjO0FBQzlELFFBQU0sRUFBRSxLQUFLLEtBQUssSUFBSSxJQUFJO0FBQUEsSUFDdEIsS0FBSyxPQUFPLFlBQVksVUFBVTtBQUFBLElBQ2xDLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTztBQUFBLElBQ3JDLEtBQUssT0FBTyxRQUFRLFVBQVUsT0FBTztBQUFBLEVBQ3pDO0FBRUEsUUFBTSxPQUFPLE1BQU0sUUFBUSxHQUFHLElBQ3hCQSxPQUFNLFFBQVEsWUFBWSxHQUFHLElBQzdCQSxPQUFNLFFBQVEsV0FBVyxHQUFHO0FBRWxDLE9BQUssUUFBUSxVQUFVLENBQUMsR0FBRyxXQUFtQixJQUFJLE1BQU0sQ0FBQztBQUN6RCxPQUFLLFFBQVEsVUFBVSxDQUFDLEdBQUcsV0FBbUIsSUFBSSxNQUFNLENBQUM7QUFDekQsU0FBTztBQUNYO0FBU08sU0FBUyxVQUFVLEtBQXlDO0FBQy9ELFNBQU8sSUFBSSxRQUFRLENBQUMsU0FBUyxXQUFXO0FBQ3BDLFFBQUksTUFBTSxRQUFRLEdBQUcsR0FBRztBQUNwQixNQUFBQyxPQUFNLFFBQVEsWUFBWSxLQUFLLENBQUMsR0FBRyxRQUFRO0FBQ3ZDLFlBQUk7QUFDQSxrQkFBUUEsT0FBTSxRQUFRLG1CQUFtQixHQUFHLENBQUM7QUFBQSxRQUNqRCxTQUFTLE9BQU87QUFDWixpQkFBTyxLQUFLO0FBQUEsUUFDaEI7QUFBQSxNQUNKLENBQUM7QUFBQSxJQUNMLE9BQU87QUFDSCxNQUFBQSxPQUFNLFFBQVEsV0FBVyxLQUFLLENBQUMsR0FBRyxRQUFRO0FBQ3RDLFlBQUk7QUFDQSxrQkFBUUEsT0FBTSxRQUFRLFlBQVksR0FBRyxDQUFDO0FBQUEsUUFDMUMsU0FBUyxPQUFPO0FBQ1osaUJBQU8sS0FBSztBQUFBLFFBQ2hCO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0osQ0FBQztBQUNMOzs7QUg5REEsSUFBTSxrQkFBTixjQUFpQyxTQUFTO0FBQUEsRUFDOUI7QUFBQSxFQUNBLGFBQWMsUUFBUTtBQUFBLEVBRXRCO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUVBLGVBQWU7QUFBQSxFQUNmO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUVBO0FBQUEsRUFDQTtBQUFBLEVBRVIsWUFBWUMsT0FBUztBQUNqQixVQUFNO0FBQ04sU0FBSyxTQUFTQTtBQUNkLFNBQUssV0FBVyxJQUFJQyxPQUFNLGFBQWE7QUFDdkMsU0FBSyxTQUFTLFFBQVEsV0FBVyxNQUFNO0FBQ25DLFdBQUssVUFBVTtBQUNmLFdBQUssU0FBUztBQUFBLElBQ2xCLENBQUM7QUFDRCxTQUFLLFNBQVMsUUFBUSxTQUFTLENBQUMsR0FBRyxRQUFRLEtBQUssYUFBYSxHQUFHLENBQUM7QUFDakUsV0FBTyxJQUFJLE1BQU0sTUFBTTtBQUFBLE1BQ25CLE9BQU8sQ0FBQyxRQUFRLEdBQUcsU0FBUyxPQUFPLE1BQU0sS0FBSyxDQUFDLENBQUM7QUFBQSxJQUNwRCxDQUFDO0FBQUEsRUFDTDtBQUFBLEVBRVEsTUFBYSxXQUF5QztBQUMxRCxVQUFNLElBQUksZ0JBQVEsS0FBSyxJQUFJO0FBQzNCLFdBQU8sWUFBWSxFQUFFLEdBQUcsU0FBUyxJQUFJO0FBQUEsRUFDekM7QUFBQSxFQUVBLFdBQVc7QUFDUCxXQUFPLE9BQU8sWUFBWSxLQUFLLElBQUksQ0FBQyxHQUFHO0FBQUEsRUFDM0M7QUFBQSxFQUVBLE1BQVM7QUFBRSxXQUFPLEtBQUs7QUFBQSxFQUFPO0FBQUEsRUFDOUIsSUFBSSxPQUFVO0FBQ1YsUUFBSSxVQUFVLEtBQUssUUFBUTtBQUN2QixXQUFLLFNBQVM7QUFDZCxXQUFLLFNBQVMsS0FBSyxTQUFTO0FBQUEsSUFDaEM7QUFBQSxFQUNKO0FBQUEsRUFFQSxZQUFZO0FBQ1IsUUFBSSxLQUFLO0FBQ0w7QUFFSixRQUFJLEtBQUssUUFBUTtBQUNiLFdBQUssUUFBUSxTQUFTLEtBQUssY0FBYyxNQUFNO0FBQzNDLGNBQU0sSUFBSSxLQUFLLE9BQVEsS0FBSyxJQUFJLENBQUM7QUFDakMsWUFBSSxhQUFhLFNBQVM7QUFDdEIsWUFBRSxLQUFLLENBQUFDLE9BQUssS0FBSyxJQUFJQSxFQUFDLENBQUMsRUFDbEIsTUFBTSxTQUFPLEtBQUssU0FBUyxLQUFLLFNBQVMsR0FBRyxDQUFDO0FBQUEsUUFDdEQsT0FBTztBQUNILGVBQUssSUFBSSxDQUFDO0FBQUEsUUFDZDtBQUFBLE1BQ0osQ0FBQztBQUFBLElBQ0wsV0FBVyxLQUFLLFVBQVU7QUFDdEIsV0FBSyxRQUFRLFNBQVMsS0FBSyxjQUFjLE1BQU07QUFDM0Msa0JBQVUsS0FBSyxRQUFTLEVBQ25CLEtBQUssT0FBSyxLQUFLLElBQUksS0FBSyxjQUFlLEdBQUcsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQ3RELE1BQU0sU0FBTyxLQUFLLFNBQVMsS0FBSyxTQUFTLEdBQUcsQ0FBQztBQUFBLE1BQ3RELENBQUM7QUFBQSxJQUNMO0FBQUEsRUFDSjtBQUFBLEVBRUEsYUFBYTtBQUNULFFBQUksS0FBSztBQUNMO0FBRUosU0FBSyxTQUFTLFdBQVc7QUFBQSxNQUNyQixLQUFLLEtBQUs7QUFBQSxNQUNWLEtBQUssU0FBTyxLQUFLLElBQUksS0FBSyxlQUFnQixLQUFLLEtBQUssSUFBSSxDQUFDLENBQUM7QUFBQSxNQUMxRCxLQUFLLFNBQU8sS0FBSyxTQUFTLEtBQUssU0FBUyxHQUFHO0FBQUEsSUFDL0MsQ0FBQztBQUFBLEVBQ0w7QUFBQSxFQUVBLFdBQVc7QUFDUCxTQUFLLE9BQU8sT0FBTztBQUNuQixXQUFPLEtBQUs7QUFBQSxFQUNoQjtBQUFBLEVBRUEsWUFBWTtBQUNSLFNBQUssUUFBUSxLQUFLO0FBQ2xCLFdBQU8sS0FBSztBQUFBLEVBQ2hCO0FBQUEsRUFFQSxZQUFZO0FBQUUsV0FBTyxDQUFDLENBQUMsS0FBSztBQUFBLEVBQU07QUFBQSxFQUNsQyxhQUFhO0FBQUUsV0FBTyxDQUFDLENBQUMsS0FBSztBQUFBLEVBQU87QUFBQSxFQUVwQyxPQUFPO0FBQ0gsU0FBSyxTQUFTLEtBQUssU0FBUztBQUFBLEVBQ2hDO0FBQUEsRUFFQSxVQUFVLFVBQXNCO0FBQzVCLFNBQUssU0FBUyxRQUFRLFdBQVcsUUFBUTtBQUN6QyxXQUFPO0FBQUEsRUFDWDtBQUFBLEVBRUEsUUFBUSxVQUFpQztBQUNyQyxXQUFPLEtBQUs7QUFDWixTQUFLLFNBQVMsUUFBUSxTQUFTLENBQUMsR0FBRyxRQUFRLFNBQVMsR0FBRyxDQUFDO0FBQ3hELFdBQU87QUFBQSxFQUNYO0FBQUEsRUFFQSxVQUFVLFVBQThCO0FBQ3BDLFVBQU0sS0FBSyxLQUFLLFNBQVMsUUFBUSxXQUFXLE1BQU07QUFDOUMsZUFBUyxLQUFLLElBQUksQ0FBQztBQUFBLElBQ3ZCLENBQUM7QUFDRCxXQUFPLE1BQU0sS0FBSyxTQUFTLFdBQVcsRUFBRTtBQUFBLEVBQzVDO0FBQUEsRUFhQSxLQUNJQyxXQUNBLE1BQ0EsWUFBNEMsU0FBTyxLQUNyRDtBQUNFLFNBQUssU0FBUztBQUNkLFNBQUssZUFBZUE7QUFDcEIsU0FBSyxnQkFBZ0I7QUFDckIsUUFBSSxPQUFPLFNBQVMsWUFBWTtBQUM1QixXQUFLLFNBQVM7QUFDZCxhQUFPLEtBQUs7QUFBQSxJQUNoQixPQUFPO0FBQ0gsV0FBSyxXQUFXO0FBQ2hCLGFBQU8sS0FBSztBQUFBLElBQ2hCO0FBQ0EsU0FBSyxVQUFVO0FBQ2YsV0FBTztBQUFBLEVBQ1g7QUFBQSxFQUVBLE1BQ0ksTUFDQSxZQUE0QyxTQUFPLEtBQ3JEO0FBQ0UsU0FBSyxVQUFVO0FBQ2YsU0FBSyxZQUFZO0FBQ2pCLFNBQUssaUJBQWlCO0FBQ3RCLFNBQUssV0FBVztBQUNoQixXQUFPO0FBQUEsRUFDWDtBQUFBLEVBYUEsUUFDSSxNQUNBLFNBQ0EsVUFDRjtBQUNFLFVBQU0sSUFBSSxPQUFPLFlBQVksYUFBYSxVQUFVLGFBQWEsTUFBTSxLQUFLLElBQUk7QUFDaEYsVUFBTSxNQUFNLENBQUMsUUFBcUIsU0FBZ0IsS0FBSyxJQUFJLEVBQUUsS0FBSyxHQUFHLElBQUksQ0FBQztBQUUxRSxRQUFJLE1BQU0sUUFBUSxJQUFJLEdBQUc7QUFDckIsaUJBQVcsT0FBTyxNQUFNO0FBQ3BCLGNBQU0sQ0FBQyxHQUFHLENBQUMsSUFBSTtBQUNmLGNBQU0sS0FBSyxFQUFFLFFBQVEsR0FBRyxHQUFHO0FBQzNCLGFBQUssVUFBVSxNQUFNLEVBQUUsV0FBVyxFQUFFLENBQUM7QUFBQSxNQUN6QztBQUFBLElBQ0osT0FBTztBQUNILFVBQUksT0FBTyxZQUFZLFVBQVU7QUFDN0IsY0FBTSxLQUFLLEtBQUssUUFBUSxTQUFTLEdBQUc7QUFDcEMsYUFBSyxVQUFVLE1BQU0sS0FBSyxXQUFXLEVBQUUsQ0FBQztBQUFBLE1BQzVDO0FBQUEsSUFDSjtBQUVBLFdBQU87QUFBQSxFQUNYO0FBQUEsRUFFQSxPQUFPLE9BTUwsTUFBWSxLQUEyQixJQUFJLFNBQVMsTUFBc0I7QUFDeEUsVUFBTSxTQUFTLE1BQU0sR0FBRyxHQUFHLEtBQUssSUFBSSxPQUFLLEVBQUUsSUFBSSxDQUFDLENBQVM7QUFDekQsVUFBTSxVQUFVLElBQUksU0FBUyxPQUFPLENBQUM7QUFDckMsVUFBTSxTQUFTLEtBQUssSUFBSSxTQUFPLElBQUksVUFBVSxNQUFNLFFBQVEsSUFBSSxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQ3pFLFlBQVEsVUFBVSxNQUFNLE9BQU8sSUFBSSxXQUFTLE1BQU0sQ0FBQyxDQUFDO0FBQ3BELFdBQU87QUFBQSxFQUNYO0FBQ0o7QUFPTyxJQUFNLFdBQVcsSUFBSSxNQUFNLGlCQUF3QjtBQUFBLEVBQ3RELE9BQU8sQ0FBQyxJQUFJLElBQUksU0FBUyxJQUFJLGdCQUFnQixLQUFLLENBQUMsQ0FBQztBQUN4RCxDQUFDO0FBTU0sSUFBTSxFQUFFLE9BQU8sSUFBSTtBQUMxQixJQUFPLG1CQUFROzs7QUk5TlIsSUFBTSxvQkFBb0IsT0FBTyx3QkFBd0I7QUFDekQsSUFBTSxjQUFjLE9BQU8sd0JBQXdCO0FBRW5ELFNBQVMsY0FBYyxPQUFjO0FBQ3hDLFdBQVMsYUFBYSxNQUFhO0FBQy9CLFFBQUksSUFBSTtBQUNSLFdBQU8sTUFBTTtBQUFBLE1BQUksV0FBUyxpQkFBaUIsa0JBQ3JDLEtBQUssR0FBRyxJQUNSO0FBQUEsSUFDTjtBQUFBLEVBQ0o7QUFFQSxRQUFNLFdBQVcsTUFBTSxPQUFPLE9BQUssYUFBYSxlQUFPO0FBRXZELE1BQUksU0FBUyxXQUFXO0FBQ3BCLFdBQU87QUFFWCxNQUFJLFNBQVMsV0FBVztBQUNwQixXQUFPLFNBQVMsQ0FBQyxFQUFFLEdBQUcsU0FBUztBQUVuQyxTQUFPLGlCQUFTLE9BQU8sVUFBVSxTQUFTLEVBQUU7QUFDaEQ7QUFFTyxTQUFTLFFBQVEsS0FBVSxNQUFjLE9BQVk7QUFDeEQsTUFBSTtBQUNBLFVBQU0sU0FBUyxPQUFPLFNBQVMsSUFBSSxDQUFDO0FBQ3BDLFFBQUksT0FBTyxJQUFJLE1BQU0sTUFBTTtBQUN2QixhQUFPLElBQUksTUFBTSxFQUFFLEtBQUs7QUFFNUIsV0FBUSxJQUFJLElBQUksSUFBSTtBQUFBLEVBQ3hCLFNBQVMsT0FBTztBQUNaLFlBQVEsTUFBTSwyQkFBMkIsSUFBSSxRQUFRLEdBQUcsS0FBSyxLQUFLO0FBQUEsRUFDdEU7QUFDSjtBQU1PLFNBQVMsS0FDWixRQUNBLFFBQ0Esa0JBQ0EsVUFDRjtBQUNFLE1BQUksT0FBTyxPQUFPLFlBQVksY0FBYyxVQUFVO0FBQ2xELFVBQU0sS0FBSyxPQUFPLFFBQVEsa0JBQWtCLENBQUMsTUFBVyxTQUFvQjtBQUN4RSxhQUFPLFNBQVMsUUFBUSxHQUFHLElBQUk7QUFBQSxJQUNuQyxDQUFDO0FBQ0QsV0FBTyxRQUFRLFdBQVcsTUFBTTtBQUM1QixNQUFDLE9BQU8sV0FBeUMsRUFBRTtBQUFBLElBQ3ZELENBQUM7QUFBQSxFQUNMLFdBQVcsT0FBTyxPQUFPLGNBQWMsY0FBYyxPQUFPLHFCQUFxQixZQUFZO0FBQ3pGLFVBQU0sUUFBUSxPQUFPLFVBQVUsSUFBSSxTQUFvQjtBQUNuRCx1QkFBaUIsUUFBUSxHQUFHLElBQUk7QUFBQSxJQUNwQyxDQUFDO0FBQ0QsV0FBTyxRQUFRLFdBQVcsS0FBSztBQUFBLEVBQ25DO0FBQ0o7QUFFTyxTQUFTLFVBQXFGLFFBQWdCLFFBQWE7QUFFOUgsTUFBSSxFQUFFLE9BQU8sT0FBTyxXQUFXLENBQUMsR0FBRyxHQUFHLE1BQU0sSUFBSTtBQUVoRCxNQUFJLG9CQUFvQixpQkFBUztBQUM3QixlQUFXLENBQUMsUUFBUTtBQUFBLEVBQ3hCO0FBRUEsTUFBSSxPQUFPO0FBQ1AsYUFBUyxRQUFRLEtBQUs7QUFBQSxFQUMxQjtBQUdBLGFBQVcsQ0FBQ0MsTUFBSyxLQUFLLEtBQUssT0FBTyxRQUFRLEtBQUssR0FBRztBQUM5QyxRQUFJLFVBQVUsUUFBVztBQUNyQixhQUFPLE1BQU1BLElBQUc7QUFBQSxJQUNwQjtBQUFBLEVBQ0o7QUFHQSxRQUFNLFdBQTBDLE9BQzNDLEtBQUssS0FBSyxFQUNWLE9BQU8sQ0FBQyxLQUFVLFNBQVM7QUFDeEIsUUFBSSxNQUFNLElBQUksYUFBYSxpQkFBUztBQUNoQyxZQUFNLFVBQVUsTUFBTSxJQUFJO0FBQzFCLGFBQU8sTUFBTSxJQUFJO0FBQ2pCLGFBQU8sQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLE9BQU8sQ0FBQztBQUFBLElBQ25DO0FBQ0EsV0FBTztBQUFBLEVBQ1gsR0FBRyxDQUFDLENBQUM7QUFHVCxRQUFNLGFBQXdELE9BQ3pELEtBQUssS0FBSyxFQUNWLE9BQU8sQ0FBQyxLQUFVQSxTQUFRO0FBQ3ZCLFFBQUlBLEtBQUksV0FBVyxJQUFJLEdBQUc7QUFDdEIsWUFBTSxNQUFNLFNBQVNBLElBQUcsRUFBRSxNQUFNLEdBQUcsRUFBRSxNQUFNLENBQUMsRUFBRSxLQUFLLEdBQUc7QUFDdEQsWUFBTSxVQUFVLE1BQU1BLElBQUc7QUFDekIsYUFBTyxNQUFNQSxJQUFHO0FBQ2hCLGFBQU8sQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFLLE9BQU8sQ0FBQztBQUFBLElBQ2xDO0FBQ0EsV0FBTztBQUFBLEVBQ1gsR0FBRyxDQUFDLENBQUM7QUFHVCxRQUFNLGlCQUFpQixjQUFjLFNBQVMsS0FBSyxRQUFRLENBQUM7QUFDNUQsTUFBSSwwQkFBMEIsaUJBQVM7QUFDbkMsV0FBTyxXQUFXLEVBQUUsZUFBZSxJQUFJLENBQUM7QUFDeEMsV0FBTyxRQUFRLFdBQVcsZUFBZSxVQUFVLENBQUMsTUFBTTtBQUN0RCxhQUFPLFdBQVcsRUFBRSxDQUFDO0FBQUEsSUFDekIsQ0FBQyxDQUFDO0FBQUEsRUFDTixPQUFPO0FBQ0gsUUFBSSxlQUFlLFNBQVMsR0FBRztBQUMzQixhQUFPLFdBQVcsRUFBRSxjQUFjO0FBQUEsSUFDdEM7QUFBQSxFQUNKO0FBR0EsYUFBVyxDQUFDLFFBQVEsUUFBUSxLQUFLLFlBQVk7QUFDekMsVUFBTSxNQUFNLE9BQU8sV0FBVyxRQUFRLElBQ2hDLE9BQU8sUUFBUSxLQUFLLElBQUksSUFDeEI7QUFFTixRQUFJLE9BQU8sYUFBYSxZQUFZO0FBQ2hDLGFBQU8sUUFBUSxLQUFLLFFBQVE7QUFBQSxJQUNoQyxPQUFPO0FBQ0gsYUFBTyxRQUFRLEtBQUssTUFBTSxVQUFVLFFBQVEsRUFDdkMsS0FBSyxLQUFLLEVBQUUsTUFBTSxRQUFRLEtBQUssQ0FBQztBQUFBLElBQ3pDO0FBQUEsRUFDSjtBQUdBLGFBQVcsQ0FBQyxNQUFNLE9BQU8sS0FBSyxVQUFVO0FBQ3BDLFFBQUksU0FBUyxXQUFXLFNBQVMsWUFBWTtBQUN6QyxhQUFPLFFBQVEsV0FBVyxRQUFRLFVBQVUsQ0FBQyxNQUFXO0FBQ3BELGVBQU8sV0FBVyxFQUFFLENBQUM7QUFBQSxNQUN6QixDQUFDLENBQUM7QUFBQSxJQUNOO0FBQ0EsV0FBTyxRQUFRLFdBQVcsUUFBUSxVQUFVLENBQUMsTUFBVztBQUNwRCxjQUFRLFFBQVEsTUFBTSxDQUFDO0FBQUEsSUFDM0IsQ0FBQyxDQUFDO0FBQ0YsWUFBUSxRQUFRLE1BQU0sUUFBUSxJQUFJLENBQUM7QUFBQSxFQUN2QztBQUdBLGFBQVcsQ0FBQ0EsTUFBSyxLQUFLLEtBQUssT0FBTyxRQUFRLEtBQUssR0FBRztBQUM5QyxRQUFJLFVBQVUsUUFBVztBQUNyQixhQUFPLE1BQU1BLElBQUc7QUFBQSxJQUNwQjtBQUFBLEVBQ0o7QUFFQSxTQUFPLE9BQU8sUUFBUSxLQUFLO0FBQzNCLFVBQVEsTUFBTTtBQUNkLFNBQU87QUFDWDtBQUVBLFNBQVMsZ0JBQWdCLE1BQXVDO0FBQzVELFNBQU8sQ0FBQyxPQUFPLE9BQU8sTUFBTSxXQUFXO0FBQzNDO0FBRU8sU0FBUyxJQUNaQyxRQUNBLE1BQ0EsRUFBRSxVQUFVLEdBQUcsTUFBTSxHQUN2QjtBQUNFLGVBQWEsQ0FBQztBQUVkLE1BQUksQ0FBQyxNQUFNLFFBQVEsUUFBUTtBQUN2QixlQUFXLENBQUMsUUFBUTtBQUV4QixhQUFXLFNBQVMsT0FBTyxPQUFPO0FBRWxDLE1BQUksU0FBUyxXQUFXO0FBQ3BCLFVBQU0sUUFBUSxTQUFTLENBQUM7QUFBQSxXQUNuQixTQUFTLFNBQVM7QUFDdkIsVUFBTSxXQUFXO0FBRXJCLE1BQUksT0FBTyxTQUFTLFVBQVU7QUFDMUIsUUFBSSxnQkFBZ0JBLE9BQU0sSUFBSSxDQUFDO0FBQzNCLGFBQU9BLE9BQU0sSUFBSSxFQUFFLEtBQUs7QUFFNUIsV0FBTyxJQUFJQSxPQUFNLElBQUksRUFBRSxLQUFLO0FBQUEsRUFDaEM7QUFFQSxNQUFJLGdCQUFnQixJQUFJO0FBQ3BCLFdBQU8sS0FBSyxLQUFLO0FBRXJCLFNBQU8sSUFBSSxLQUFLLEtBQUs7QUFDekI7OztBQy9MQSxPQUFPLFNBQVM7QUFDaEIsT0FBTyxTQUFTO0FBR1QsSUFBTSxPQUFPLE9BQU8sWUFBWTtBQUN2QyxJQUFNLGNBQWMsSUFBSSxJQUFJO0FBRTVCLFNBQVMsYUFBYSxRQUF1QztBQUN6RCxNQUFJLGVBQWUsVUFBVSxPQUFPLE9BQU8sYUFBYSxZQUFZO0FBQ2hFLFdBQU8sT0FBTyxVQUFVLElBQUksQ0FBQyxPQUFPLFVBQVUsQ0FBQyxJQUFJLENBQUM7QUFBQSxFQUN4RDtBQUVBLFFBQU0sV0FBOEIsQ0FBQztBQUNyQyxNQUFJLEtBQUssT0FBTyxnQkFBZ0I7QUFDaEMsU0FBTyxPQUFPLE1BQU07QUFDaEIsYUFBUyxLQUFLLEVBQUU7QUFDaEIsU0FBSyxHQUFHLGlCQUFpQjtBQUFBLEVBQzdCO0FBQ0EsU0FBTztBQUNYO0FBRUEsU0FBUyxhQUFhLFFBQW9CLFVBQWlCO0FBQ3ZELGFBQVcsU0FBUyxLQUFLLFFBQVEsRUFBRSxJQUFJLFFBQU0sY0FBYyxJQUFJLFNBQ3pELEtBQ0EsSUFBSSxJQUFJLE1BQU0sRUFBRSxTQUFTLE1BQU0sT0FBTyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7QUFHekQsYUFBVyxTQUFTLFVBQVU7QUFDMUIsV0FBTztBQUFBLE1BQ0g7QUFBQSxNQUNBO0FBQUEsTUFDQSxRQUFRLFFBQVEsTUFBTSxJQUFJLElBQUk7QUFBQSxJQUNsQztBQUFBLEVBQ0o7QUFDSjtBQU9lLFNBQVIsU0FJTCxLQUFzQyxTQUFrQyxDQUFDLEdBQUc7QUFDMUUsU0FBTyxPQUFPLElBQUksV0FBVztBQUFBLElBQ3pCLENBQUMsV0FBVyxFQUFFLFVBQWlCO0FBQzNCLFlBQU0sSUFBSTtBQUNWLGlCQUFXLFNBQVUsT0FBTyxjQUFjLENBQUMsS0FBSyxhQUFhLENBQUMsR0FBSTtBQUM5RCxZQUFJLGlCQUFpQixJQUFJLFFBQVE7QUFDN0IsZ0JBQU0sU0FBUztBQUNmLGNBQUksQ0FBQyxTQUFTLFNBQVMsS0FBSyxLQUFLLHFCQUFxQjtBQUNsRCxrQkFBTSxZQUFZO0FBQUEsUUFDMUI7QUFBQSxNQUNKO0FBRUEsVUFBSSxPQUFPLGFBQWE7QUFDcEIsZUFBTyxZQUFZLEdBQUcsUUFBUTtBQUFBLE1BQ2xDLE9BQU87QUFDSCxxQkFBYSxHQUFHLFFBQVE7QUFBQSxNQUM1QjtBQUFBLElBQ0o7QUFBQSxFQUNKLENBQUM7QUFFRCxTQUFPO0FBQUEsSUFDSCxDQUFDLElBQUksSUFBSSxHQUFHLENBQ1IsUUFBZ0QsQ0FBQyxNQUM5QyxhQUNNO0FBQ1QsWUFBTSxTQUFTLElBQUksSUFBSSxhQUFhLFFBQVEsRUFBRSxTQUFTLE1BQU0sUUFBUSxJQUFJLENBQUMsQ0FBQztBQUUzRSxVQUFJLGFBQWEsT0FBTztBQUNwQixlQUFPLE1BQU07QUFBQSxNQUNqQjtBQUVBLFVBQUksTUFBTSxtQkFBbUI7QUFDekIsZUFBTyxPQUFPLFFBQVEsRUFBRSxDQUFDLGlCQUFpQixHQUFHLEtBQUssQ0FBQztBQUNuRCxlQUFPLE1BQU07QUFBQSxNQUNqQjtBQUVBLFVBQUksTUFBTSxNQUFNO0FBQ1osZUFBTyxPQUFPLFFBQVEsRUFBRSxDQUFDLElBQUksR0FBRyxNQUFNLEtBQUssQ0FBQztBQUM1QyxlQUFPLE1BQU07QUFBQSxNQUNqQjtBQUVBLFVBQUksU0FBUyxTQUFTLEdBQUc7QUFDckIsZUFBTyxPQUFPLE9BQU8sRUFBRSxTQUFTLENBQUM7QUFBQSxNQUNyQztBQUVBLGFBQU8sVUFBVSxRQUFlLGlCQUFpQixRQUFRLEtBQVksQ0FBQztBQUFBLElBQzFFO0FBQUEsRUFDSixFQUFFLElBQUksSUFBSTtBQUNkO0FBZ0RBLFNBQVMsaUJBQW9CLFFBQW9CO0FBQUEsRUFDN0M7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBLEdBQUc7QUFDUCxHQUFvQztBQUNoQyxNQUFJLGdCQUFnQixjQUFjO0FBQzlCLFVBQU0sUUFBUSxJQUFJLElBQUk7QUFDdEIsV0FBTyxlQUFlLEtBQUs7QUFFM0IsUUFBSTtBQUNBLFlBQU0sUUFBUSxTQUFTLE1BQU0sYUFBYSxNQUFNLENBQUM7QUFFckQsUUFBSTtBQUNBLFlBQU0sUUFBUSxTQUFTLE1BQU0sYUFBYSxNQUFNLENBQUM7QUFBQSxFQUN6RDtBQUVBLE1BQUksZ0JBQWdCLGlCQUFpQixlQUFlO0FBQ2hELFVBQU1DLE9BQU0sSUFBSSxJQUFJO0FBQ3BCLFdBQU8sZUFBZUEsSUFBRztBQUV6QixRQUFJO0FBQ0EsTUFBQUEsS0FBSSxRQUFRLGVBQWUsQ0FBQyxHQUFHLEtBQUssTUFBTSxVQUFVLGFBQWEsUUFBUSxLQUFLLE1BQU0sS0FBSyxDQUFDO0FBRTlGLFFBQUk7QUFDQSxNQUFBQSxLQUFJLFFBQVEsZ0JBQWdCLENBQUMsR0FBRyxLQUFLLE1BQU0sVUFBVSxjQUFjLFFBQVEsS0FBSyxNQUFNLEtBQUssQ0FBQztBQUVoRyxRQUFJO0FBQ0EsTUFBQUEsS0FBSSxRQUFRLGFBQWEsQ0FBQyxHQUFHLFVBQVUsY0FBYyxRQUFRLEtBQUssQ0FBQztBQUFBLEVBQzNFO0FBRUEsTUFBSSxZQUFZLG1CQUFtQixrQkFBa0I7QUFDakQsVUFBTSxTQUFTLElBQUksSUFBSTtBQUN2QixXQUFPLGVBQWUsTUFBTTtBQUU1QixXQUFPLFFBQVEsU0FBUyxDQUFDLEdBQUcsVUFBVTtBQUNsQyxVQUFJLE1BQU0sZUFBZSxNQUFNLElBQUksVUFBVSxjQUFjO0FBQ3ZELDBCQUFrQixRQUFRLEtBQXdCO0FBQUEsTUFDdEQ7QUFFQSxVQUFJLE1BQU0sZUFBZSxNQUFNLElBQUksVUFBVSxnQkFBZ0I7QUFDekQsMkJBQW1CLFFBQVEsS0FBd0I7QUFBQSxNQUN2RDtBQUVBLGlCQUFXLFFBQVEsS0FBSztBQUFBLElBQzVCLENBQUM7QUFBQSxFQUNMO0FBRUEsTUFBSSxZQUFZLGdCQUFnQixjQUFjO0FBQzFDLFVBQU0sUUFBUSxJQUFJLElBQUk7QUFDdEIsV0FBTyxlQUFlLEtBQUs7QUFFM0IsUUFBSTtBQUNBLFlBQU0sUUFBUSxTQUFTLENBQUMsR0FBRyxHQUFHLE1BQU0sYUFBYSxRQUFRLEdBQUcsQ0FBQyxDQUFDO0FBRWxFLFFBQUk7QUFDQSxZQUFNLFFBQVEsU0FBUyxNQUFNLGFBQWEsTUFBTSxDQUFDO0FBRXJELFFBQUk7QUFDQSxZQUFNLFFBQVEsVUFBVSxDQUFDLEdBQUcsR0FBRyxNQUFNLFNBQVMsUUFBUSxHQUFHLENBQUMsQ0FBQztBQUFBLEVBQ25FO0FBRUEsTUFBSSxZQUFZLG9CQUFvQjtBQUNoQyxVQUFNLFNBQVMsSUFBSSxJQUFJO0FBQ3ZCLFdBQU8sUUFBUSxJQUFJLDJCQUEyQixZQUFZLElBQUksMkJBQTJCO0FBQ3pGLFdBQU8sZUFBZSxNQUFNO0FBRTVCLFFBQUk7QUFDQSxhQUFPLFFBQVEsVUFBVSxDQUFDLEdBQUcsR0FBRyxNQUFNLFNBQVMsUUFBUSxHQUFHLENBQUMsQ0FBQztBQUVoRSxRQUFJO0FBQ0EsYUFBTyxRQUFRLGNBQWMsQ0FBQyxHQUFHLEdBQUcsTUFBTSxtQkFBbUIsUUFBUSxHQUFHLENBQUMsQ0FBQztBQUFBLEVBQ2xGO0FBRUEsU0FBTztBQUNYOzs7QUNuT0EsT0FBTyxVQUFVO0FBQ2pCLE9BQU9DLFVBQVM7QUFDaEIsT0FBT0MsWUFBVzs7O0FDSWxCLElBQU1DLFlBQVcsQ0FBQyxRQUFnQixJQUM3QixRQUFRLG1CQUFtQixPQUFPLEVBQ2xDLFdBQVcsS0FBSyxHQUFHLEVBQ25CLFlBQVk7QUFFakIsZUFBZSxTQUFZLEtBQThCQyxRQUF1QjtBQUM1RSxTQUFPLElBQUksS0FBSyxPQUFLQSxPQUFNLEVBQUUsT0FBTyxDQUFDLEVBQUUsTUFBTSxNQUFNLE1BQU07QUFDN0Q7QUFFQSxTQUFTLE1BQXdCLE9BQVUsTUFBZ0M7QUFDdkUsU0FBTyxlQUFlLE9BQU8sTUFBTTtBQUFBLElBQy9CLE1BQU07QUFBRSxhQUFPLEtBQUssT0FBT0QsVUFBUyxJQUFJLENBQUMsRUFBRSxFQUFFO0FBQUEsSUFBRTtBQUFBLEVBQ25ELENBQUM7QUFDTDtBQUVBLE1BQU0sU0FBUyxPQUFPLGdCQUFnQixHQUFHLENBQUMsRUFBRSxNQUFBRSxPQUFNLFlBQVksTUFBTTtBQUNoRSxRQUFNQSxNQUFLLFdBQVcsTUFBTTtBQUM1QixRQUFNLFlBQVksV0FBVyxVQUFVO0FBQ3ZDLFFBQU0sWUFBWSxXQUFXLFlBQVk7QUFDN0MsQ0FBQztBQUVELE1BQU0sU0FBUyxPQUFPLG1CQUFtQixHQUFHLENBQUMsRUFBRSxPQUFPLE1BQU07QUFDeEQsUUFBTSxPQUFPLFdBQVcsU0FBUztBQUNyQyxDQUFDO0FBRUQsTUFBTSxTQUFTLE9BQU8scUJBQXFCLEdBQUcsQ0FBQyxFQUFFLFNBQVMsV0FBQUMsWUFBVyxPQUFPLE1BQU07QUFDOUUsUUFBTSxRQUFRLFdBQVcsT0FBTztBQUNoQyxRQUFNQSxXQUFVLFdBQVcsVUFBVTtBQUNyQyxRQUFNQSxXQUFVLFdBQVcsU0FBUztBQUNwQyxRQUFNLE9BQU8sV0FBVyxPQUFPO0FBQ25DLENBQUM7QUFFRCxNQUFNLFNBQVMsT0FBTyxvQkFBb0IsR0FBRyxDQUFDLEVBQUUsVUFBVSxTQUFTLFVBQVUsTUFBTTtBQUMvRSxRQUFNLFNBQVMsV0FBVyxPQUFPO0FBQ2pDLFFBQU0sU0FBUyxXQUFXLFVBQVU7QUFDcEMsUUFBTSxTQUFTLFdBQVcsWUFBWTtBQUN0QyxRQUFNLFNBQVMsV0FBVyxTQUFTO0FBQ25DLFFBQU0sUUFBUSxXQUFXLGdCQUFnQjtBQUN6QyxRQUFNLFFBQVEsV0FBVyxpQkFBaUI7QUFDMUMsUUFBTSxVQUFVLFdBQVcsU0FBUztBQUN4QyxDQUFDO0FBRUQsTUFBTSxTQUFTLE9BQU8saUJBQWlCLEdBQUcsQ0FBQyxFQUFFLE9BQUFDLFFBQU8sT0FBTyxNQUFNO0FBQzdELFFBQU1BLE9BQU0sV0FBVyxTQUFTO0FBQ2hDLFFBQU0sT0FBTyxXQUFXLHVCQUF1QjtBQUMvQyxRQUFNLE9BQU8sV0FBVyxxQkFBcUI7QUFDN0MsUUFBTSxPQUFPLFdBQVcsc0JBQXNCO0FBQzlDLFFBQU0sT0FBTyxXQUFXLG9CQUFvQjtBQUM1QyxRQUFNLE9BQU8sV0FBVyxVQUFVO0FBQ3RDLENBQUM7QUFFRCxNQUFNLFNBQVMsT0FBTyxtQkFBbUIsR0FBRyxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3RELFFBQU0sS0FBSyxXQUFXLGVBQWU7QUFDckMsUUFBTSxLQUFLLFdBQVcsY0FBYztBQUN4QyxDQUFDO0FBRUQsTUFBTSxTQUFTLE9BQU8sa0JBQWtCLEdBQUcsQ0FBQyxFQUFFLFFBQUFDLFNBQVEsYUFBYSxNQUFNO0FBQ3JFLFFBQU1BLFFBQU8sV0FBVyxlQUFlO0FBQ3ZDLFFBQU0sYUFBYSxXQUFXLFNBQVM7QUFDM0MsQ0FBQztBQUVELE1BQU0sU0FBUyxPQUFPLHlCQUF5QixHQUFHLENBQUMsRUFBRSxjQUFjLE1BQU07QUFDckUsUUFBTSxjQUFjLFdBQVcsU0FBUztBQUM1QyxDQUFDO0FBRUQsTUFBTSxTQUFTLE9BQU8sY0FBYyxHQUFHLENBQUMsRUFBRSxJQUFBQyxLQUFJLE9BQU8sTUFBTSxNQUFNO0FBQzdELFFBQU1BLElBQUcsV0FBVyxXQUFXO0FBQy9CLFFBQU1BLElBQUcsV0FBVyxTQUFTO0FBQzdCLFFBQU0sTUFBTSxXQUFXLFNBQVM7QUFDaEMsUUFBTSxNQUFNLFdBQVcsV0FBVztBQUNsQyxRQUFNLE1BQU0sV0FBVyxhQUFhO0FBQ3BDLFFBQU0sTUFBTSxXQUFXLFVBQVU7QUFDakMsUUFBTSxNQUFNLFdBQVcsU0FBUztBQUNoQyxRQUFNLE1BQU0sV0FBVyxTQUFTO0FBQ2hDLFFBQU0sTUFBTSxXQUFXLFdBQVc7QUFDbEMsUUFBTSxNQUFNLFdBQVcsT0FBTztBQUM5QixRQUFNLE1BQU0sV0FBVyxTQUFTO0FBQ2hDLFFBQU0sTUFBTSxXQUFXLFNBQVM7QUFDcEMsQ0FBQzs7O0FDbkZELFNBQVMsMkJBQTJCO0FBQ3BDLFNBQVMsTUFBTSxtQkFBbUI7QUFDbEMsT0FBTyxRQUFRO0FBQ2YsT0FBTyxhQUFhO0FBd0NiLFNBQVMsTUFBTUMsTUFBa0I7QUFDcEMsU0FBTyxJQUFLLE1BQU0sZ0JBQWdCQSxLQUFJO0FBQUEsSUFDbEMsT0FBTztBQUFFLGNBQVEsY0FBYyxFQUFFLFdBQVcsVUFBVSxHQUFHLElBQVc7QUFBQSxJQUFFO0FBQUEsSUFFdEUsS0FBSyxNQUE0QjtBQUM3QixhQUFPLElBQUksUUFBUSxDQUFDLEtBQUssUUFBUTtBQUM3QixZQUFJO0FBQ0EsZ0JBQU0sS0FBSyxTQUFTO0FBQUEsMEJBQ2QsS0FBSyxTQUFTLEdBQUcsSUFBSSxPQUFPLFVBQVUsSUFBSSxHQUFHO0FBQUEsdUJBQ2hEO0FBQ0gsYUFBRyxFQUFFLEVBQUUsS0FBSyxHQUFHLEVBQUUsTUFBTSxHQUFHO0FBQUEsUUFDOUIsU0FBUyxPQUFPO0FBQ1osY0FBSSxLQUFLO0FBQUEsUUFDYjtBQUFBLE1BQ0osQ0FBQztBQUFBLElBQ0w7QUFBQSxJQUVBO0FBQUEsSUFFQSxjQUFjLEtBQWEsTUFBa0M7QUFDekQsVUFBSSxPQUFPLEtBQUssbUJBQW1CLFlBQVk7QUFDM0MsYUFBSyxlQUFlLEtBQUssQ0FBQyxhQUFhO0FBQ25DLGFBQUc7QUFBQSxZQUFXO0FBQUEsWUFBTSxPQUFPLFFBQVE7QUFBQSxZQUFHLENBQUMsR0FBRyxRQUN0QyxHQUFHLGtCQUFrQixHQUFHO0FBQUEsVUFDNUI7QUFBQSxRQUNKLENBQUM7QUFBQSxNQUNMLE9BQU87QUFDSCxjQUFNLGNBQWMsS0FBSyxJQUFJO0FBQUEsTUFDakM7QUFBQSxJQUNKO0FBQUEsSUFFQSxVQUFVLE9BQWUsUUFBUSxPQUFPO0FBQ3BDLFlBQU0sVUFBVSxPQUFPLEtBQUs7QUFBQSxJQUNoQztBQUFBLElBRUEsS0FBSyxNQUFxQjtBQUN0QixZQUFNLEtBQUs7QUFDWCxXQUFLLFFBQVEsQ0FBQztBQUFBLElBQ2xCO0FBQUEsSUFFQSxNQUFNLEVBQUUsZ0JBQWdCLEtBQUssTUFBTSxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUksSUFBWSxDQUFDLEdBQUc7QUFDM0UsWUFBTSxNQUFNO0FBRVosaUJBQVcsTUFBTTtBQUNiLGNBQU0sbUJBQW1CLElBQUksWUFBWSxtQkFBbUI7QUFDNUQsYUFBSyxDQUFDO0FBQUEsTUFDVjtBQUVBLGFBQU8sT0FBTyxNQUFNLEdBQUc7QUFDdkIsMEJBQW9CLElBQUksWUFBWTtBQUVwQyxXQUFLLGlCQUFpQjtBQUN0QixVQUFJLFFBQVEsWUFBWSxNQUFNO0FBQzFCLGVBQU8sR0FBRyxXQUFXO0FBQUEsTUFDekIsQ0FBQztBQUVELFVBQUk7QUFDQSxZQUFJLGVBQWU7QUFBQSxNQUN2QixTQUFTLE9BQU87QUFDWixlQUFPLE9BQU8sU0FBTyxHQUFHLGFBQWEsSUFBSSxjQUFjLEdBQUcsR0FBSSxHQUFHLFdBQVc7QUFBQSxNQUNoRjtBQUVBLFVBQUk7QUFDQSxhQUFLLFVBQVUsS0FBSyxLQUFLO0FBRTdCLFVBQUk7QUFDQSxZQUFJLFVBQVUsS0FBSztBQUV2QixlQUFTO0FBQ1QsVUFBSTtBQUNBLFlBQUksS0FBSztBQUViLFVBQUksU0FBUyxDQUFDLENBQUM7QUFBQSxJQUNuQjtBQUFBLEVBQ0o7QUFDSjs7O0FGbEhBQyxLQUFJLEtBQUs7QUFJVCxLQUFLLFNBQVMsWUFBWTtBQUkxQixNQUFNLE9BQU8sb0JBQW9CLEVBQzVCLEtBQUssQ0FBQyxFQUFFLFNBQVMsSUFBSSxNQUFNLElBQUksS0FBSyxDQUFDLEVBQ3JDLE1BQU0sTUFBTSxNQUFNO0FBRXZCLElBQU8sY0FBUSxNQUFNQyxPQUFNLFdBQVc7OztBR2pCdEMsT0FBT0MsWUFBVztBQUNsQixPQUFPQyxVQUFTO0FBR2hCLFNBQVMsT0FBTyxVQUFpQjtBQUM3QixTQUFPLFNBQVMsS0FBSyxRQUFRLEVBQUUsSUFBSSxRQUFNLGNBQWNDLEtBQUksU0FDckQsS0FDQSxJQUFJQSxLQUFJLE1BQU0sRUFBRSxTQUFTLE1BQU0sT0FBTyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7QUFDN0Q7QUFHQSxPQUFPLGVBQWVDLE9BQU0sSUFBSSxXQUFXLFlBQVk7QUFBQSxFQUNuRCxNQUFNO0FBQUUsV0FBTyxLQUFLLGFBQWE7QUFBQSxFQUFFO0FBQUEsRUFDbkMsSUFBSSxHQUFHO0FBQUUsU0FBSyxhQUFhLENBQUM7QUFBQSxFQUFFO0FBQ2xDLENBQUM7QUFHTSxJQUFNLE1BQU0sU0FBZ0RBLE9BQU0sS0FBSztBQUFBLEVBQzFFLFlBQVksTUFBTTtBQUFFLFdBQU8sS0FBSyxhQUFhO0FBQUEsRUFBRTtBQUFBLEVBQy9DLFlBQVksTUFBTSxVQUFVO0FBQUUsV0FBTyxLQUFLLGFBQWEsT0FBTyxRQUFRLENBQUM7QUFBQSxFQUFFO0FBQzdFLENBQUM7QUFRTSxJQUFNLFNBQVMsU0FBaUVELEtBQUksTUFBTTtBQUkxRixJQUFNLFlBQVksU0FBd0RBLEtBQUksV0FBVztBQUFBLEVBQzVGLFlBQVksS0FBSztBQUNiLFdBQU8sQ0FBQyxJQUFJLGFBQWEsSUFBSSxjQUFjLElBQUksU0FBUztBQUFBLEVBQzVEO0FBQUEsRUFDQSxZQUFZLEtBQUssVUFBVTtBQUN2QixVQUFNLEtBQUssT0FBTyxRQUFRO0FBQzFCLFFBQUksY0FBYyxHQUFHLENBQUMsS0FBSyxJQUFJQSxLQUFJO0FBQ25DLFFBQUksZUFBZSxHQUFHLENBQUMsS0FBSyxJQUFJQSxLQUFJO0FBQ3BDLFFBQUksWUFBWSxHQUFHLENBQUMsS0FBSyxJQUFJQSxLQUFJO0FBQUEsRUFDckM7QUFDSixDQUFDO0FBWU0sSUFBTSxRQUFRLFNBQThEQSxLQUFJLE9BQU87QUFBQSxFQUMxRixjQUFjO0FBQUUsV0FBTyxDQUFDO0FBQUEsRUFBRTtBQUM5QixDQUFDO0FBSU0sSUFBTSxRQUFRLFNBQWdEQSxLQUFJLE9BQU87QUFBQSxFQUM1RSxjQUFjO0FBQUUsV0FBTyxDQUFDO0FBQUEsRUFBRTtBQUM5QixDQUFDO0FBSU0sSUFBTSxRQUFRLFNBQWdEQSxLQUFJLE9BQU87QUFBQSxFQUM1RSxjQUFjO0FBQUUsV0FBTyxDQUFDO0FBQUEsRUFBRTtBQUFBLEVBQzFCLFlBQVksTUFBTSxVQUFVO0FBQUUsU0FBSyxRQUFRLE9BQU8sUUFBUTtBQUFBLEVBQUU7QUFDaEUsQ0FBQztBQUlNLElBQU0sV0FBVyxTQUFzREEsS0FBSSxVQUFVO0FBQUEsRUFDeEYsY0FBYztBQUFFLFdBQU8sQ0FBQztBQUFBLEVBQUU7QUFDOUIsQ0FBQztBQU1NLElBQU0sVUFBVSxTQUFvREEsS0FBSSxTQUFTO0FBQUEsRUFDcEYsWUFBWSxNQUFNO0FBQ2QsVUFBTSxXQUE4QixDQUFDO0FBQ3JDLFFBQUksS0FBSyxLQUFLLGdCQUFnQjtBQUM5QixXQUFPLE9BQU8sTUFBTTtBQUNoQixlQUFTLEtBQUssRUFBRTtBQUNoQixXQUFLLEdBQUcsaUJBQWlCO0FBQUEsSUFDN0I7QUFFQSxXQUFPLFNBQVMsT0FBTyxDQUFBRSxRQUFNQSxRQUFPLEtBQUssS0FBSztBQUFBLEVBQ2xEO0FBQUEsRUFDQSxZQUFZLE1BQU0sVUFBVTtBQUN4QixlQUFXLFNBQVMsT0FBTyxRQUFRLEdBQUc7QUFDbEMsWUFBTSxRQUFRLFFBQVEsUUFDZixNQUFNLElBQUksRUFBYSxNQUFNLEtBQUssSUFDbkMsQ0FBQztBQUVQLFVBQUksTUFBTSxTQUFTLFNBQVMsR0FBRztBQUMzQixhQUFLLFlBQVksS0FBSztBQUFBLE1BQzFCLE9BQU87QUFDSCxhQUFLLFVBQVUsS0FBSztBQUFBLE1BQ3hCO0FBRUEsV0FBSyxvQkFBb0IsT0FBTyxNQUFNLFNBQVMsU0FBUyxDQUFDO0FBQ3pELFdBQUssaUJBQWlCLE9BQU8sTUFBTSxTQUFTLE1BQU0sQ0FBQztBQUFBLElBQ3ZEO0FBQUEsRUFDSjtBQUNKLENBQUM7QUFJTSxJQUFNLFdBQVcsU0FBc0RGLEtBQUksUUFBUTtBQVFuRixJQUFNLFNBQVMsU0FBcUVDLE9BQU0sUUFBUTtBQUFBLEVBQ3JHLGNBQWM7QUFBRSxXQUFPLENBQUM7QUFBQSxFQUFFO0FBQzlCLENBQUM7QUFJTSxJQUFNLFFBQVEsU0FBZ0RELEtBQUksT0FBTztBQUFBLEVBQzVFLFlBQVksTUFBTSxVQUFVO0FBQ3hCLGVBQVcsU0FBUyxPQUFPLFFBQVEsR0FBRztBQUNsQyxVQUFJLE1BQU0sUUFBUSxNQUFNLE1BQU0sUUFBUSxNQUFNO0FBQ3hDLGFBQUssVUFBVSxPQUFPLE1BQU0sSUFBSTtBQUFBLE1BQ3BDLE9BQU87QUFDSCxhQUFLLFVBQVUsS0FBSztBQUFBLE1BQ3hCO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFDSixDQUFDO0FBSU0sSUFBTSxTQUFTLFNBQWtEQSxLQUFJLFFBQVE7QUFBQSxFQUNoRixjQUFjO0FBQUUsV0FBTyxDQUFDO0FBQUEsRUFBRTtBQUM5QixDQUFDO0FBSU0sSUFBTSxTQUFTLFNBQXNEQyxPQUFNLE1BQU07QUFJakYsSUFBTSxhQUFhLFNBQTBERCxLQUFJLFlBQVk7QUFBQSxFQUNoRyxZQUFZLE1BQU07QUFBRSxXQUFPLENBQUMsS0FBSyxTQUFTLEtBQUssS0FBSztBQUFBLEVBQUU7QUFBQSxFQUN0RCxZQUFZLE1BQU0sVUFBVTtBQUN4QixlQUFXLFNBQVMsT0FBTyxRQUFRLEdBQUc7QUFDbEMsVUFBSSxpQkFBaUJBLEtBQUksU0FBUztBQUM5QixhQUFLLFlBQVksS0FBSztBQUFBLE1BQzFCLE9BQU87QUFDSCxhQUFLLFVBQVUsS0FBSztBQUFBLE1BQ3hCO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFDSixDQUFDO0FBSU0sSUFBTSxVQUFVLFNBQW9EQSxLQUFJLE9BQU87OztBQ25LdEYsT0FBT0csVUFBUztBQUNoQixPQUFPQyxVQUFTOzs7QUNIaEI7OztBQ2lCTyxJQUFNLFdBQW1CO0FBQUEsRUFDOUIsTUFBTTtBQUFBLEVBQUksTUFBTTtBQUFBLEVBQUksS0FBSztBQUFBLEVBQUksTUFBTTtBQUFBLEVBQ25DLE1BQU07QUFBQSxFQUFJLFNBQVM7QUFBQSxFQUFHLE9BQU87QUFBQSxFQUM3QixRQUFRO0FBQUEsRUFBSyxXQUFXO0FBQUEsRUFBSyxXQUFXO0FBQzFDO0FBR08sSUFBTSxVQUFrQjtBQUFBLEVBQzdCLEdBQUc7QUFBQSxFQUFVLE1BQU07QUFBQSxFQUFJLE1BQU07QUFBQSxFQUFHLEtBQUs7QUFBQSxFQUFHLE1BQU07QUFDaEQ7QUFFTyxJQUFJLFNBQWlCO0FBRXJCLElBQU0sTUFBTSxNQUFNLE9BQU8sT0FBTztBQUNoQyxJQUFNLFdBQVcsTUFBTSxPQUFPLE1BQU0sT0FBTyxPQUFPO0FBSWxELFNBQVMsU0FBUyxJQUFZLFFBQWdCO0FBQ25ELFNBQU87QUFBQSx1QkFDYyxFQUFFLElBQUksc0JBQXNCLEVBQUUsSUFBSTtBQUFBO0FBQUEsNkJBRTVCLElBQUksQ0FBQyxtQkFBbUIsSUFBSSxDQUFDO0FBQUEscUJBQ3JDLEVBQUUsT0FBTyxzQkFBc0IsS0FBSyxFQUFFLFVBQVUsQ0FBQztBQUFBLDJCQUMzQyxFQUFFLEdBQUc7QUFBQSw0QkFDSixFQUFFLElBQUksbUJBQW1CLEVBQUUsSUFBSTtBQUFBLDBDQUNqQixTQUFTLENBQUM7QUFBQSxxQkFDL0IsRUFBRSxTQUFTLEVBQUU7QUFBQSwyQkFDUCxFQUFFLFNBQVM7QUFBQSwyQkFDWCxFQUFFLFNBQVM7QUFBQSx3QkFDZCxFQUFFLEtBQUs7QUFBQTtBQUUvQjs7O0FDN0NBLE9BQU9DLFVBQVM7QUFDaEIsT0FBT0MsV0FBVTs7O0FDSmpCLFNBQW9CLFdBQVhDLGdCQUEwQjs7O0FDRG5DLE9BQU9DLFlBQVc7QUFDbEIsT0FBTyxTQUFTOzs7QUNEaEIsT0FBT0MsY0FBYTtBQUVwQixTQUFvQixXQUFYQyxnQkFBdUI7QUFHaEMsSUFBTSxPQUFPLE9BQU8sTUFBTTtBQUMxQixJQUFNLE9BQU8sT0FBTyxNQUFNO0FBRTFCLElBQU0sRUFBRSxXQUFXLFdBQVcsSUFBSUM7OztBSEFsQyxJQUFNLE1BQU07QUFDWixJQUFNLE9BQU87QUFDYixJQUFNLFFBQVE7QUFVUCxJQUFNLFlBQVksU0FBUyxLQUFLO0FBQ2hDLElBQU0sVUFBVSxTQUEwQixDQUFDLENBQUM7QUFFbkQsSUFBSSxRQUE4QjtBQUVsQyxTQUFTLEtBQUssUUFBZ0IsU0FBOEIsTUFBb0M7QUFDOUYsU0FBTyxJQUFJLFFBQVEsQ0FBQyxLQUFLLFFBQVE7QUFDL0IsUUFBSSxDQUFDLE1BQU8sUUFBTyxJQUFJLElBQUksTUFBTSx3QkFBd0IsQ0FBQztBQUMxRCxVQUFNLEtBQUssUUFBUSxRQUFRQyxLQUFJLGNBQWMsTUFBTSxLQUFNLE1BQU0sQ0FBQyxHQUFHLE1BQU07QUFDdkUsVUFBSTtBQUFFLFlBQUksTUFBTyxZQUFZLENBQUMsQ0FBQztBQUFBLE1BQUUsU0FBUyxHQUFHO0FBQUUsWUFBSSxDQUFDO0FBQUEsTUFBRTtBQUFBLElBQ3hELENBQUM7QUFBQSxFQUNILENBQUM7QUFDSDtBQUVPLElBQU0sU0FBUyxNQUFNLEtBQUssUUFBUTtBQUtsQyxJQUFNLFdBQVcsQ0FBQyxPQUFlLEtBQUssa0JBQWtCLElBQUlDLE1BQUssUUFBUSxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDckYsSUFBTSxXQUFXLENBQUMsT0FBZSxLQUFLLGtCQUFrQixJQUFJQSxNQUFLLFFBQVEsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBRTVGLGVBQXNCLGlCQUFpQjtBQUNyQyxNQUFJO0FBQ0YsVUFBTSxJQUFJLE1BQU0sS0FBSyxhQUFhO0FBQ2xDLFFBQUksQ0FBQyxFQUFHO0FBQ1IsVUFBTSxDQUFDLElBQUksSUFBSSxFQUFFLFlBQVk7QUFDN0IsWUFBUSxJQUFJLElBQUk7QUFBQSxFQUNsQixRQUFRO0FBQUEsRUFBa0U7QUFDNUU7QUFFTyxTQUFTLFdBQVcsT0FBZ0M7QUFDekQsU0FBTyxRQUFRLElBQUksRUFBRSxPQUFPLE9BQUssRUFBRSxVQUFVLEtBQUs7QUFDcEQ7QUFHQSxlQUFzQixNQUFNLE9BQWUsS0FBYTtBQUN0RCxRQUFNLEtBQUssV0FBVyxLQUFLO0FBQzNCLE1BQUksR0FBRyxTQUFTLEVBQUc7QUFDbkIsUUFBTSxJQUFJLEdBQUcsVUFBVSxPQUFLLEVBQUUsT0FBTztBQUNyQyxRQUFNLFNBQVMsS0FBSyxJQUFJLElBQUksSUFBSSxLQUFLLE1BQU0sR0FBRyxVQUFVLEdBQUcsTUFBTSxFQUFFLEVBQUU7QUFDdkU7QUFFTyxTQUFTLE9BQU87QUFDckIsRUFBQUMsS0FBSTtBQUFBLElBQ0ZBLEtBQUksUUFBUTtBQUFBLElBQVM7QUFBQSxJQUFLQSxLQUFJLG9CQUFvQjtBQUFBLElBQ2xELE1BQU07QUFDSixNQUFBQSxLQUFJLFVBQVU7QUFBQSxRQUNaQSxLQUFJLFFBQVE7QUFBQSxRQUFTQSxLQUFJLGVBQWU7QUFBQSxRQUFNO0FBQUEsUUFDOUM7QUFBQSxRQUFLO0FBQUEsUUFBTTtBQUFBLFFBQU87QUFBQSxRQUNsQixDQUFDLEdBQUcsUUFBUTtBQUNWLGtCQUFRQSxLQUFJLFVBQVUsbUJBQW1CLEdBQUc7QUFDNUMsZ0JBQU0sUUFBUSxZQUFZLENBQUMsSUFBSSxJQUFJLFFBQVE7QUFDekMsZ0JBQUksUUFBUSxpQkFBa0IsZ0JBQWU7QUFBQSxVQUMvQyxDQUFDO0FBQ0Qsb0JBQVUsSUFBSSxJQUFJO0FBQ2xCLHlCQUFlO0FBQUEsUUFDakI7QUFBQSxNQUFDO0FBQUEsSUFDTDtBQUFBLElBQ0EsTUFBTTtBQUNKLGNBQVE7QUFDUixnQkFBVSxJQUFJLEtBQUs7QUFBQSxJQUNyQjtBQUFBLEVBQUM7QUFDTDs7O0FJN0VBLE9BQU9DLFdBQVU7QUFJakIsT0FBTyxZQUFZO0FBRVosSUFBTSxTQUFTLFNBQVMsQ0FBQztBQUN6QixJQUFNLFFBQVEsU0FBUyxLQUFLO0FBQ25DLElBQUksSUFBMEI7QUFJdkIsU0FBU0MsUUFBTztBQUdyQixNQUFJQyxNQUFLLE9BQU8sbUJBQW1CLEVBQUc7QUFHdEMsVUFBUSxJQUFJLE1BQU07QUFDaEIsUUFBSTtBQUNGLFVBQUksT0FBTyxZQUFZO0FBQ3ZCLFlBQU0sSUFBSSxJQUFJO0FBQ2QsWUFBTSxPQUFPLE1BQU0sT0FBTyxJQUFJLEVBQUcsY0FBYyxNQUFNO0FBQ3JELFFBQUUsUUFBUSxZQUFZLElBQUk7QUFBRyxRQUFFLFFBQVEsWUFBWSxJQUFJO0FBQUcsV0FBSztBQUFBLElBQ2pFLFNBQVMsR0FBRztBQUFFLGVBQVMsK0JBQStCLENBQUMsRUFBRTtBQUFBLElBQUU7QUFBQSxFQUM3RCxDQUFDO0FBQ0g7OztBQzFCQSxPQUFPQyxXQUFVO0FBT1YsU0FBUyxXQUFXLEtBQXlCO0FBQ2xELFFBQU0sTUFBYyxDQUFDO0FBQ3JCLFFBQU0sT0FBWTtBQUNsQixRQUFNLE9BQU8sQ0FBQyxHQUFRLFVBQWtCO0FBSXRDLFFBQUksSUFBSSxHQUFHLElBQUksR0FBRyxRQUFRLEdBQUcsU0FBUztBQUN0QyxRQUFJO0FBQ0YsWUFBTSxNQUFNLEVBQUUsZUFBZSxJQUFJO0FBQ2pDLFlBQU0sT0FBTyxNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxJQUFJO0FBQzNDLFVBQUksTUFBTTtBQUNSLFlBQUksS0FBSyxPQUFPO0FBQUcsWUFBSSxLQUFLLE9BQU87QUFDbkMsZ0JBQVEsS0FBSyxLQUFLO0FBQU8saUJBQVMsS0FBSyxLQUFLO0FBQUEsTUFDOUM7QUFBQSxJQUNGLFFBQVE7QUFBQSxJQUFFO0FBQ1YsUUFBSSxDQUFDLE9BQU87QUFBRSxjQUFRLEVBQUUsWUFBWSxLQUFLO0FBQUcsZUFBUyxFQUFFLGFBQWEsS0FBSztBQUFBLElBQUU7QUFDM0UsVUFBTSxPQUFPLEVBQUUsa0JBQWtCLEtBQUssQ0FBQyxHQUFHLEtBQUssR0FBRztBQUNsRCxVQUFNQyxTQUFRLEVBQUUsYUFBYSxRQUFRLEtBQUssUUFBUSxNQUFNLEVBQUU7QUFDMUQsUUFBSSxJQUFJO0FBQ1IsUUFBSTtBQUFFLFdBQUssRUFBRSxZQUFZLEtBQUssRUFBRSxXQUFXLEtBQUssSUFBSSxTQUFTLEVBQUUsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUFFLFFBQVE7QUFBQSxJQUFFO0FBQ3RGLFFBQUksS0FBSztBQUFBLE1BQ1AsR0FBRztBQUFBLE1BQU8sTUFBQUE7QUFBQSxNQUFNO0FBQUEsTUFDaEIsR0FBRyxLQUFLLE1BQU0sQ0FBQztBQUFBLE1BQUcsR0FBRyxLQUFLLE1BQU0sQ0FBQztBQUFBLE1BQ2pDLEdBQUcsS0FBSyxNQUFNLEtBQUs7QUFBQSxNQUFHLEdBQUcsS0FBSyxNQUFNLE1BQU07QUFBQSxNQUFHO0FBQUEsSUFDL0MsQ0FBQztBQUNELFFBQUksSUFBSSxFQUFFLGtCQUFrQjtBQUM1QixXQUFPLEdBQUc7QUFBRSxXQUFLLEdBQUcsUUFBUSxDQUFDO0FBQUcsVUFBSSxFQUFFLGlCQUFpQjtBQUFBLElBQUU7QUFBQSxFQUMzRDtBQUNBLFFBQU0sUUFBUSxJQUFJLFlBQVk7QUFDOUIsTUFBSSxNQUFPLE1BQUssT0FBTyxDQUFDO0FBQ3hCLFNBQU87QUFDVDtBQUdPLFNBQVMsUUFBUSxXQUFnRDtBQUN0RSxRQUFNLE9BQU9ELE1BQUssT0FBTyxZQUFZO0FBQ3JDLE1BQUksQ0FBQyxLQUFNO0FBQ1gsUUFBTSxPQUFPQSxNQUFLLE9BQU8sZ0JBQWdCLEtBQUs7QUFDOUMsTUFBSSxPQUFPO0FBQ1gsRUFBQUEsTUFBSyxZQUFZQSxNQUFLLGtCQUFrQixLQUFLLE1BQU07QUFDakQsUUFBSSxLQUFNLFFBQU9BLE1BQUs7QUFDdEIsVUFBTSxJQUFJLFVBQVUsSUFBSTtBQUN4QixRQUFJLEtBQUssRUFBRSxhQUFhLE1BQU0sRUFBRSxZQUFZLEtBQUssS0FBSyxHQUFHO0FBRXZELE1BQUFBLE1BQUssWUFBWUEsTUFBSyxrQkFBa0IsS0FBSyxNQUFNO0FBQ2pELFlBQUk7QUFDRixnQkFBTSxPQUFPLFdBQVcsQ0FBQztBQUN6QixVQUFBQSxNQUFLLGtCQUFrQixNQUFNLEtBQUssVUFBVSxJQUFJLENBQUM7QUFDakQsbUJBQVMsaUJBQWlCLEtBQUssTUFBTSxnQkFBZ0IsSUFBSSxZQUFPLElBQUksRUFBRTtBQUFBLFFBQ3hFLFNBQVMsR0FBRztBQUFFLG1CQUFTLHVCQUF1QixDQUFDLEVBQUU7QUFBQSxRQUFFO0FBQ25ELGVBQU9BLE1BQUs7QUFBQSxNQUNkLENBQUM7QUFDRCxhQUFPO0FBQ1AsYUFBT0EsTUFBSztBQUFBLElBQ2Q7QUFDQSxXQUFPQSxNQUFLO0FBQUEsRUFDZCxDQUFDO0FBQ0g7OztBQ2xFQSxPQUFPLGFBQWE7QUFDcEIsT0FBTyxRQUFRO0FBQ2YsT0FBTyxhQUFhO0FBQ3BCLE9BQU8sVUFBVTs7O0FDSmpCLE9BQU9FLFdBQVU7QUFFVixJQUFNLE9BQU8sQ0FBQyxDQUFDQSxNQUFLLE9BQU8sWUFBWTtBQUd2QyxJQUFNLElBQUk7QUFBQTtBQUFBLEVBRWYsT0FBTztBQUFBLEVBQ1AsTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLEVBQ1AsWUFBWTtBQUFBO0FBQUEsRUFFWixNQUFNO0FBQUEsRUFDTixVQUFVO0FBQUEsRUFDVixVQUFVO0FBQUEsRUFDVixRQUFRO0FBQUE7QUFBQSxFQUNSLFlBQVk7QUFBQTtBQUFBLEVBQ1osTUFBTTtBQUFBLEVBQU0sTUFBTTtBQUFBLEVBQU8sUUFBUTtBQUFBLEVBQU8sT0FBTztBQUFBO0FBQUEsRUFFL0MsT0FBTyxFQUFFLEdBQUcsTUFBTSxHQUFHLEdBQXlCLEdBQUcsRUFBRTtBQUFBO0FBQUE7QUFBQSxFQUVuRCxNQUFNLENBQUMsWUFBWSxTQUFTLFdBQVcsT0FBTyxXQUFXLFVBQVU7QUFBQSxFQUNuRSxZQUFZO0FBQUEsRUFDWixhQUFhO0FBQUEsRUFDYixPQUFPLEVBQUUsT0FBTyxjQUFjLFFBQVEsZ0JBQWdCO0FBQ3hEOzs7QUM1QkEsT0FBT0MsWUFBVztBQUNsQixPQUFPQyxVQUFTO0FBQ2hCLE9BQU9DLGNBQWE7OztBQ0ZwQixPQUFPQyxZQUFXO0FBQ2xCLE9BQU9DLFVBQVM7QUFFaEIsT0FBT0MsY0FBYTtBQU1MLFNBQVJDLFVBRUwsS0FBUSxVQUFVLElBQUksTUFBTTtBQUFBLEVBQzFCLE1BQU0sZUFBZSxJQUFJO0FBQUEsSUFDckIsSUFBSSxNQUFjO0FBQUUsYUFBT0MsT0FBTSxlQUFlLElBQUk7QUFBQSxJQUFFO0FBQUEsSUFDdEQsSUFBSSxJQUFJLEtBQWE7QUFBRSxNQUFBQSxPQUFNLGVBQWUsTUFBTSxHQUFHO0FBQUEsSUFBRTtBQUFBLElBQ3ZELFVBQWtCO0FBQUUsYUFBTyxLQUFLO0FBQUEsSUFBSTtBQUFBLElBQ3BDLFFBQVEsS0FBYTtBQUFFLFdBQUssTUFBTTtBQUFBLElBQUk7QUFBQSxJQUV0QyxJQUFJLFlBQW9CO0FBQUUsYUFBT0EsT0FBTSx1QkFBdUIsSUFBSSxFQUFFLEtBQUssR0FBRztBQUFBLElBQUU7QUFBQSxJQUM5RSxJQUFJLFVBQVUsV0FBbUI7QUFBRSxNQUFBQSxPQUFNLHVCQUF1QixNQUFNLFVBQVUsTUFBTSxLQUFLLENBQUM7QUFBQSxJQUFFO0FBQUEsSUFDOUYsaUJBQXlCO0FBQUUsYUFBTyxLQUFLO0FBQUEsSUFBVTtBQUFBLElBQ2pELGVBQWUsV0FBbUI7QUFBRSxXQUFLLFlBQVk7QUFBQSxJQUFVO0FBQUEsSUFFL0QsSUFBSSxTQUFpQjtBQUFFLGFBQU9BLE9BQU0sa0JBQWtCLElBQUk7QUFBQSxJQUFZO0FBQUEsSUFDdEUsSUFBSSxPQUFPLFFBQWdCO0FBQUUsTUFBQUEsT0FBTSxrQkFBa0IsTUFBTSxNQUFNO0FBQUEsSUFBRTtBQUFBLElBQ25FLGFBQXFCO0FBQUUsYUFBTyxLQUFLO0FBQUEsSUFBTztBQUFBLElBQzFDLFdBQVcsUUFBZ0I7QUFBRSxXQUFLLFNBQVM7QUFBQSxJQUFPO0FBQUEsSUFFbEQsSUFBSSxlQUF3QjtBQUFFLGFBQU9BLE9BQU0seUJBQXlCLElBQUk7QUFBQSxJQUFFO0FBQUEsSUFDMUUsSUFBSSxhQUFhLGNBQXVCO0FBQUUsTUFBQUEsT0FBTSx5QkFBeUIsTUFBTSxZQUFZO0FBQUEsSUFBRTtBQUFBLElBQzdGLG9CQUE2QjtBQUFFLGFBQU8sS0FBSztBQUFBLElBQWE7QUFBQSxJQUN4RCxrQkFBa0IsY0FBdUI7QUFBRSxXQUFLLGVBQWU7QUFBQSxJQUFhO0FBQUEsSUFHNUUsSUFBSSxvQkFBNkI7QUFBRSxhQUFPLEtBQUssaUJBQWlCO0FBQUEsSUFBRTtBQUFBLElBQ2xFLElBQUksa0JBQWtCLE9BQWdCO0FBQUUsV0FBSyxpQkFBaUIsSUFBSTtBQUFBLElBQU07QUFBQSxJQUV4RSxJQUFJLFlBQVksQ0FBQyxRQUFRLEtBQUssR0FBZ0I7QUFBRSxXQUFLLG9CQUFvQixRQUFRLEtBQUs7QUFBQSxJQUFFO0FBQUEsSUFDeEYsaUJBQWlCLGFBQTBCO0FBQUUsV0FBSyxjQUFjO0FBQUEsSUFBWTtBQUFBLElBRWxFLGNBQWlDO0FBQ3ZDLFVBQUksZ0JBQWdCQyxLQUFJLEtBQUs7QUFDekIsZUFBTyxLQUFLLFVBQVUsSUFBSSxDQUFDLEtBQUssVUFBVSxDQUFFLElBQUksQ0FBQztBQUFBLE1BQ3JELFdBQVcsZ0JBQWdCQSxLQUFJLFdBQVc7QUFDdEMsZUFBTyxLQUFLLGFBQWE7QUFBQSxNQUM3QjtBQUNBLGFBQU8sQ0FBQztBQUFBLElBQ1o7QUFBQSxJQUVVLFlBQVksVUFBaUI7QUFDbkMsaUJBQVcsU0FBUyxLQUFLLFFBQVEsRUFBRSxJQUFJLFFBQU0sY0FBY0EsS0FBSSxTQUN6RCxLQUNBLElBQUlBLEtBQUksTUFBTSxFQUFFLFNBQVMsTUFBTSxPQUFPLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztBQUV6RCxVQUFJLGdCQUFnQkEsS0FBSSxXQUFXO0FBQy9CLG1CQUFXLE1BQU07QUFDYixlQUFLLElBQUksRUFBRTtBQUFBLE1BQ25CLE9BQU87QUFDSCxjQUFNLE1BQU0sMkJBQTJCLEtBQUssWUFBWSxJQUFJLEVBQUU7QUFBQSxNQUNsRTtBQUFBLElBQ0o7QUFBQSxJQUVBLENBQUMsV0FBVyxFQUFFLFVBQWlCO0FBRTNCLFVBQUksZ0JBQWdCQSxLQUFJLFdBQVc7QUFDL0IsbUJBQVcsTUFBTSxLQUFLLFlBQVksR0FBRztBQUNqQyxlQUFLLE9BQU8sRUFBRTtBQUNkLGNBQUksQ0FBQyxTQUFTLFNBQVMsRUFBRSxLQUFLLENBQUMsS0FBSztBQUNoQyxnQkFBSSxRQUFRO0FBQUEsUUFDcEI7QUFBQSxNQUNKO0FBR0EsV0FBSyxZQUFZLFFBQVE7QUFBQSxJQUM3QjtBQUFBLElBRUEsZ0JBQWdCLElBQVksT0FBTyxNQUFNO0FBQ3JDLE1BQUFELE9BQU0seUJBQXlCLE1BQU0sSUFBSSxJQUFJO0FBQUEsSUFDakQ7QUFBQSxJQVdBLEtBQ0ksUUFDQSxrQkFDQSxVQUNGO0FBQ0UsV0FBSyxNQUFNLFFBQVEsa0JBQWtCLFFBQVE7QUFDN0MsYUFBTztBQUFBLElBQ1g7QUFBQSxJQUVBLGVBQWUsUUFBZTtBQUMxQixZQUFNO0FBQ04sWUFBTSxRQUFRLE9BQU8sQ0FBQyxLQUFLLENBQUM7QUFDNUIsWUFBTSxZQUFZO0FBQ2xCLGdCQUFVLE1BQU0sS0FBSztBQUFBLElBQ3pCO0FBQUEsRUFDSjtBQUVBLEVBQUFFLFNBQVEsY0FBYztBQUFBLElBQ2xCLFdBQVcsU0FBUyxPQUFPO0FBQUEsSUFDM0IsWUFBWTtBQUFBLE1BQ1IsY0FBY0EsU0FBUSxVQUFVO0FBQUEsUUFDNUI7QUFBQSxRQUFjO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUN4RDtBQUFBLE1BQ0EsT0FBT0EsU0FBUSxVQUFVO0FBQUEsUUFDckI7QUFBQSxRQUFPO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUNqRDtBQUFBLE1BQ0EsVUFBVUEsU0FBUSxVQUFVO0FBQUEsUUFDeEI7QUFBQSxRQUFVO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUNwRDtBQUFBLE1BQ0EsaUJBQWlCQSxTQUFRLFVBQVU7QUFBQSxRQUMvQjtBQUFBLFFBQWlCO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUMzRDtBQUFBLE1BQ0EsdUJBQXVCQSxTQUFRLFVBQVU7QUFBQSxRQUNyQztBQUFBLFFBQXVCO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUNqRTtBQUFBLElBQ0o7QUFBQSxFQUNKLEdBQUcsTUFBTTtBQUVULFNBQU87QUFDWDs7O0FEM0hBLFNBQVNDLFFBQU8sVUFBaUI7QUFDN0IsU0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLElBQUksUUFBTSxjQUFjQyxLQUFJLFNBQ3JELEtBQ0EsSUFBSUEsS0FBSSxNQUFNLEVBQUUsU0FBUyxNQUFNLE9BQU8sT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQzdEO0FBR0EsT0FBTyxlQUFlQyxPQUFNLElBQUksV0FBVyxZQUFZO0FBQUEsRUFDbkQsTUFBTTtBQUFFLFdBQU8sS0FBSyxhQUFhO0FBQUEsRUFBRTtBQUFBLEVBQ25DLElBQUksR0FBRztBQUFFLFNBQUssYUFBYSxDQUFDO0FBQUEsRUFBRTtBQUNsQyxDQUFDO0FBR00sSUFBTUMsT0FBTixjQUFrQkMsVUFBU0YsT0FBTSxHQUFHLEVBQUU7QUFBQSxFQUN6QyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxNQUFNLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUMzRCxZQUFZLFVBQXFCLFVBQWdDO0FBQUUsVUFBTSxFQUFFLFVBQVUsR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQUEsRUFDOUYsWUFBWSxVQUF1QjtBQUFFLFNBQUssYUFBYUwsUUFBTyxRQUFRLENBQUM7QUFBQSxFQUFFO0FBQ3ZGO0FBV08sSUFBTU0sVUFBTixjQUFxQkYsVUFBU0YsT0FBTSxNQUFNLEVBQUU7QUFBQSxFQUMvQyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxTQUFTLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM5RCxZQUFZLE9BQXFCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQ2hHO0FBSU8sSUFBTUUsYUFBTixjQUF3QkgsVUFBU0YsT0FBTSxTQUFTLEVBQUU7QUFBQSxFQUNyRCxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxZQUFZLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUNqRSxZQUFZLFVBQTJCLFVBQWdDO0FBQUUsVUFBTSxFQUFFLFVBQVUsR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQUEsRUFDcEcsWUFBWSxVQUF1QjtBQUN6QyxVQUFNLEtBQUtMLFFBQU8sUUFBUTtBQUMxQixTQUFLLGNBQWMsR0FBRyxDQUFDLEtBQUssSUFBSUMsS0FBSTtBQUNwQyxTQUFLLGVBQWUsR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUNyQyxTQUFLLFlBQVksR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUFBLEVBQ3RDO0FBQ0o7QUFJTyxJQUFNLG1CQUFOLGNBQStCRyxVQUFTRixPQUFNLGdCQUFnQixFQUFFO0FBQUEsRUFDbkUsT0FBTztBQUFFLElBQUFHLFNBQVEsY0FBYyxFQUFFLFdBQVcsbUJBQW1CLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUN4RSxZQUFZLE9BQStCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQzFHO0FBTU8sSUFBTSxjQUFOLGNBQTBCRCxVQUFTSCxLQUFJLFdBQVcsRUFBRTtBQUFBLEVBQ3ZELE9BQU87QUFBRSxJQUFBSSxTQUFRLGNBQWMsRUFBRSxXQUFXLGNBQWMsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQ25FLFlBQVksT0FBMEI7QUFBRSxVQUFNLEtBQVk7QUFBQSxFQUFFO0FBQ2hFO0FBT08sSUFBTUcsU0FBTixjQUFvQkosVUFBU0gsS0FBSSxLQUFLLEVBQUU7QUFBQSxFQUMzQyxPQUFPO0FBQUUsSUFBQUksU0FBUSxjQUFjLEVBQUUsV0FBVyxRQUFRLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM3RCxZQUFZLE9BQW9CO0FBQUUsVUFBTSxLQUFZO0FBQUEsRUFBRTtBQUMxRDtBQVVPLElBQU0sV0FBTixjQUF1QkQsVUFBU0YsT0FBTSxRQUFRLEVBQUU7QUFBQSxFQUNuRCxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxXQUFXLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUNoRSxZQUFZLE9BQXVCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQ2xHO0FBT08sSUFBTSxPQUFOLGNBQW1CRCxVQUFTRixPQUFNLElBQUksRUFBRTtBQUFBLEVBQzNDLE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLE9BQU8sR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQzVELFlBQVksT0FBbUI7QUFBRSxVQUFNLEtBQVk7QUFBQSxFQUFFO0FBQ3pEO0FBSU8sSUFBTUksU0FBTixjQUFvQkwsVUFBU0YsT0FBTSxLQUFLLEVBQUU7QUFBQSxFQUM3QyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxRQUFRLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM3RCxZQUFZLE9BQW9CO0FBQUUsVUFBTSxLQUFZO0FBQUEsRUFBRTtBQUFBLEVBQzVDLFlBQVksVUFBdUI7QUFBRSxTQUFLLFFBQVEsT0FBTyxRQUFRO0FBQUEsRUFBRTtBQUNqRjtBQUlPLElBQU1LLFlBQU4sY0FBdUJOLFVBQVNGLE9BQU0sUUFBUSxFQUFFO0FBQUEsRUFDbkQsT0FBTztBQUFFLElBQUFHLFNBQVEsY0FBYyxFQUFFLFdBQVcsV0FBVyxHQUFHLElBQUk7QUFBQSxFQUFFO0FBQUEsRUFDaEUsWUFBWSxPQUF1QjtBQUFFLFVBQU0sS0FBWTtBQUFBLEVBQUU7QUFDN0Q7QUFNTyxJQUFNTSxjQUFOLGNBQXlCUCxVQUFTSCxLQUFJLFVBQVUsRUFBRTtBQUFBLEVBQ3JELE9BQU87QUFBRSxJQUFBSSxTQUFRLGNBQWMsRUFBRSxXQUFXLGFBQWEsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQ2xFLFlBQVksT0FBeUIsT0FBdUI7QUFBRSxVQUFNLEVBQUUsT0FBTyxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFDcEc7QUFHQSxPQUFPLGVBQWVILE9BQU0sUUFBUSxXQUFXLFlBQVk7QUFBQSxFQUN2RCxNQUFNO0FBQUUsV0FBTyxLQUFLLGFBQWE7QUFBQSxFQUFFO0FBQUEsRUFDbkMsSUFBSSxHQUFHO0FBQUUsU0FBSyxhQUFhLENBQUM7QUFBQSxFQUFFO0FBQ2xDLENBQUM7QUFHTSxJQUFNVSxXQUFOLGNBQXNCUixVQUFTRixPQUFNLE9BQU8sRUFBRTtBQUFBLEVBQ2pELE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLFVBQVUsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQy9ELFlBQVksVUFBeUIsVUFBZ0M7QUFBRSxVQUFNLEVBQUUsVUFBVSxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFBQSxFQUNsRyxZQUFZLFVBQXVCO0FBQ3pDLFVBQU0sQ0FBQyxPQUFPLEdBQUcsUUFBUSxJQUFJTCxRQUFPLFFBQVE7QUFDNUMsU0FBSyxVQUFVLEtBQUs7QUFDcEIsU0FBSyxhQUFhLFFBQVE7QUFBQSxFQUM5QjtBQUNKO0FBSU8sSUFBTWEsWUFBTixjQUF1QlQsVUFBU0gsS0FBSSxRQUFRLEVBQUU7QUFBQSxFQUNqRCxPQUFPO0FBQUUsSUFBQUksU0FBUSxjQUFjLEVBQUUsV0FBVyxXQUFXLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUNoRSxZQUFZLE9BQXVCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQ2xHO0FBSU8sSUFBTSxhQUFOLGNBQXlCRCxVQUFTRixPQUFNLFVBQVUsRUFBRTtBQUFBLEVBQ3ZELE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLGFBQWEsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQ2xFLFlBQVksT0FBeUIsT0FBdUI7QUFBRSxVQUFNLEVBQUUsT0FBTyxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFDcEc7QUFNTyxJQUFNUyxVQUFOLGNBQXFCVixVQUFTRixPQUFNLE1BQU0sRUFBRTtBQUFBLEVBQy9DLE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLFNBQVMsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQzlELFlBQVksT0FBcUI7QUFBRSxVQUFNLEtBQVk7QUFBQSxFQUFFO0FBQzNEO0FBSU8sSUFBTVUsU0FBTixjQUFvQlgsVUFBU0YsT0FBTSxLQUFLLEVBQUU7QUFBQSxFQUM3QyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxRQUFRLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM3RCxZQUFZLFVBQXVCLFVBQWdDO0FBQUUsVUFBTSxFQUFFLFVBQVUsR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQUEsRUFDaEcsWUFBWSxVQUF1QjtBQUFFLFNBQUssYUFBYUwsUUFBTyxRQUFRLENBQUM7QUFBQSxFQUFFO0FBQ3ZGO0FBSU8sSUFBTWdCLFVBQU4sY0FBcUJaLFVBQVNILEtBQUksTUFBTSxFQUFFO0FBQUEsRUFDN0MsT0FBTztBQUFFLElBQUFJLFNBQVEsY0FBYyxFQUFFLFdBQVcsU0FBUyxHQUFHLElBQUk7QUFBQSxFQUFFO0FBQUEsRUFDOUQsWUFBWSxPQUFxQjtBQUFFLFVBQU0sS0FBWTtBQUFBLEVBQUU7QUFDM0Q7QUFJTyxJQUFNWSxVQUFOLGNBQXFCYixVQUFTRixPQUFNLE1BQU0sRUFBRTtBQUFBLEVBQy9DLE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLFNBQVMsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQzlELFlBQVksT0FBcUIsT0FBdUI7QUFBRSxVQUFNLEVBQUUsT0FBTyxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFDaEc7OztBRTVLTyxTQUFTYSxLQUNaLE1BQ0EsT0FDRjtBQUNFLFNBQU8sSUFBSyxPQUFPLE1BQWEsS0FBSztBQUN6QztBQUVBLElBQU0sUUFBUTtBQUFBLEVBQ1YsS0FBWUM7QUFBQSxFQUNaLFFBQWVDO0FBQUEsRUFDZixXQUFrQkM7QUFBQSxFQUNsQixrQkFBeUI7QUFBQSxFQUN6QixhQUFvQjtBQUFBLEVBQ3BCLE9BQWNDO0FBQUEsRUFDZCxVQUFpQjtBQUFBO0FBQUE7QUFBQSxFQUdqQixNQUFhO0FBQUEsRUFDYixPQUFjQztBQUFBLEVBQ2QsVUFBaUJDO0FBQUE7QUFBQSxFQUVqQixZQUFtQkM7QUFBQSxFQUNuQixTQUFnQkM7QUFBQSxFQUNoQixVQUFpQkM7QUFBQSxFQUNqQixZQUFtQjtBQUFBLEVBQ25CLFFBQWVDO0FBQUEsRUFDZixPQUFjQztBQUFBLEVBQ2QsUUFBZUM7QUFBQSxFQUNmLFFBQWVDO0FBQ25CO0FBaUNPLElBQU0sT0FBT2I7OztBSjlEcEIsSUFBTSxPQUFPLFNBQVNjLFNBQUssU0FBUyxjQUFjLENBQUMsRUFBRTtBQUFBLEVBQUs7QUFBQSxFQUN4RCxNQUFNQSxTQUFLLFNBQVMsY0FBYztBQUFDO0FBRXJDLFNBQVMsZUFBZTtBQUN0QixTQUFPLGdCQUFBQztBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sT0FBTTtBQUFBLE1BQ04sV0FBVztBQUFBLE1BQ1gsZUFBZTtBQUFBLE1BQ2YsT0FBTyxPQUFPLEVBQUUsUUFBUSxLQUFLLE9BQU8sRUFBRSxHQUFHLFFBQU07QUFDN0MsY0FBTSxJQUFJLEdBQUcsS0FBSyxPQUFLLEVBQUUsT0FBTztBQUNoQyxZQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsY0FBTSxXQUFXLEdBQUcsT0FBTyxPQUFLLEVBQUUsVUFBVSxFQUFFLEtBQUs7QUFDbkQsZUFBTyxTQUFTLFNBQVMsSUFDckIsR0FBRyxFQUFFLEtBQUssa0JBQWEsU0FBUyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyxNQUFNLEtBQ2pFLEVBQUU7QUFBQSxNQUNSLENBQUM7QUFBQTtBQUFBLEVBQUc7QUFDUjtBQUVBLFNBQVMsYUFBYTtBQUNwQixRQUFNLFVBQVUsR0FBRyxZQUFZLEdBQUcsbUJBQW1CO0FBQ3JELFFBQU0sTUFBTSxRQUFRLFlBQVk7QUFDaEMsUUFBTSxNQUFNLFFBQVEsWUFBWTtBQUNoQyxTQUFPLGdCQUFBQTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQU8sUUFBUUMsS0FBSSxNQUFNO0FBQUEsTUFDL0IsT0FBTyxLQUFLLFNBQVMsRUFBRSxHQUFHLE9BQUssSUFBSSxXQUFXLFlBQVk7QUFBQSxNQUMxRCxXQUFXLE1BQU0sWUFBSSxjQUFjLGVBQWU7QUFBQSxNQUNsRCwrQkFBQyxTQUFJLFNBQVMsSUFDWjtBQUFBLHdCQUFBRCxLQUFDLFdBQU0sT0FBTSxZQUFXLFVBQVMsdUJBQXNCO0FBQUEsUUFDdkQsZ0JBQUFBLEtBQUMsV0FBTSxVQUFTLCtCQUE4QjtBQUFBLFFBQzlDLHFCQUFDLFNBQUksT0FBTSxPQUFNLFNBQVMsR0FDeEI7QUFBQSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsMEJBQXlCO0FBQUEsVUFDekMsZ0JBQUFBLEtBQUMsV0FBTSxPQUFNLE1BQUssT0FBTyxPQUFPLEVBQUUsYUFBYyxNQUM1QyxLQUFLLEtBQUssWUFBWSxFQUFFLEdBQUcsT0FBSyxHQUFHLEtBQUssTUFBTSxJQUFJLEdBQUcsQ0FBQyxHQUFHLElBQ3pELFFBQVM7QUFBQSxXQUNmO0FBQUEsU0FDRjtBQUFBO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxPQUFPO0FBSWQsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUFPLE9BQU07QUFBQSxNQUFZLFFBQVFDLEtBQUksTUFBTTtBQUFBLE1BQ2pELFdBQVcsTUFBTSxZQUFJLGNBQWMsUUFBUTtBQUFBLE1BQzNDLCtCQUFDLGFBQ0M7QUFBQSx3QkFBQUQsS0FBQyxXQUFNLFVBQVMsdUJBQXNCO0FBQUEsUUFDdEMsZ0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBTSxNQUFLO0FBQUEsWUFBVSxRQUFRQyxLQUFJLE1BQU07QUFBQSxZQUFLLFFBQVFBLEtBQUksTUFBTTtBQUFBLFlBQzdELE9BQU07QUFBQSxZQUFXLFNBQVMsT0FBTyxPQUFPLEtBQUssTUFBTSxFQUFFLEdBQUcsQ0FBQUMsT0FBS0EsS0FBSSxDQUFDO0FBQUEsWUFDbEUsT0FBTyxPQUFPLE1BQU0sS0FBSyxNQUFNLEVBQUUsR0FBRyxDQUFBQSxPQUFLQSxLQUFJLElBQUksT0FBTyxHQUFHQSxFQUFDLEVBQUU7QUFBQTtBQUFBLFFBQUc7QUFBQSxTQUNyRTtBQUFBO0FBQUEsRUFDRjtBQUNGO0FBRWUsU0FBUixJQUFxQixTQUFzQjtBQUNoRCxRQUFNLEVBQUUsS0FBSyxNQUFNLE1BQU0sSUFBSUMsT0FBTTtBQUduQyxTQUFPLGdCQUFBSDtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sTUFBSztBQUFBLE1BQU0sV0FBVTtBQUFBLE1BQVksT0FBTTtBQUFBLE1BQ3ZDLFlBQVk7QUFBQSxNQUFTLGFBQWFHLE9BQU0sWUFBWTtBQUFBLE1BQ3BELFdBQVc7QUFBQSxNQUFJLFlBQVk7QUFBQSxNQUFJLGFBQWE7QUFBQSxNQUM1QyxRQUFRLE1BQU0sT0FBTztBQUFBLE1BQ3JCLCtCQUFDLGVBQVUsT0FBTSxPQUNmO0FBQUEsNkJBQUMsU0FBSSxTQUFTLEdBQ1o7QUFBQSwwQkFBQUg7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUFPLE9BQU07QUFBQSxjQUFPLFFBQVFDLEtBQUksTUFBTTtBQUFBLGNBQ3JDLFdBQVcsTUFBTSxZQUFJLGNBQWMsVUFBVTtBQUFBLGNBQzdDLDBCQUFBRCxLQUFDLFdBQU0sVUFBUyxtQ0FBa0M7QUFBQTtBQUFBLFVBQ3BEO0FBQUEsVUFDQSxnQkFBQUEsS0FBQyxnQkFBYTtBQUFBLFdBQ2hCO0FBQUEsUUFDQSxnQkFBQUE7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFPLE9BQU07QUFBQSxZQUFVLFFBQVFDLEtBQUksTUFBTTtBQUFBLFlBQ3hDLFdBQVcsTUFBTSxZQUFJLGNBQWMsVUFBVTtBQUFBLFlBQzdDLCtCQUFDLFNBQUksU0FBUyxHQUNaO0FBQUEsOEJBQUFEO0FBQUEsZ0JBQUM7QUFBQTtBQUFBLGtCQUFNLE9BQU07QUFBQSxrQkFBVyxRQUFRQyxLQUFJLE1BQU07QUFBQSxrQkFDeEMsT0FBTyxPQUFPLEVBQUUsUUFBUSxLQUFLLElBQUksRUFBRSxHQUFHLE9BQUssRUFBRSxPQUFPLE9BQU8sQ0FBRTtBQUFBO0FBQUEsY0FBRztBQUFBLGNBQ2xFLGdCQUFBRDtBQUFBLGdCQUFDO0FBQUE7QUFBQSxrQkFBTSxPQUFNO0FBQUEsa0JBQU8sUUFBUUMsS0FBSSxNQUFNO0FBQUEsa0JBQ3BDLE9BQU8sT0FBTyxFQUFFLE9BQU8sS0FBSyxJQUFJLEVBQUUsR0FBRyxPQUFLLEVBQUUsT0FBTyxXQUFXLENBQUU7QUFBQTtBQUFBLGNBQUc7QUFBQSxlQUN2RTtBQUFBO0FBQUEsUUFDRjtBQUFBLFFBQ0EscUJBQUMsU0FBSSxTQUFTLEdBQ1g7QUFBQSxpQkFDRyxxQkFBQyxTQUFJLFNBQVMsR0FBRyxXQUFXLEdBQzFCO0FBQUEsNEJBQUFELEtBQUMsWUFBTyxPQUFNLGtCQUFpQixRQUFRQyxLQUFJLE1BQU0sUUFBUSxhQUFZLFdBQ25FLDBCQUFBRCxLQUFDLFdBQU0sVUFBUyx1QkFBc0IsR0FBRTtBQUFBLFlBQzFDLGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxrQkFBaUIsUUFBUUMsS0FBSSxNQUFNLFFBQVEsYUFBWSxTQUNuRSwwQkFBQUQsS0FBQyxXQUFNLFVBQVMsdUJBQXNCLEdBQUU7QUFBQSxZQUMxQyxnQkFBQUEsS0FBQyxZQUFPLE9BQU0sa0JBQWlCLFFBQVFDLEtBQUksTUFBTSxRQUFRLGFBQVksWUFDbkUsMEJBQUFELEtBQUMsV0FBTSxVQUFTLDhCQUE2QixHQUFFO0FBQUEsWUFDakQsZ0JBQUFBLEtBQUMsV0FBTSxPQUFNLGdCQUFlLFFBQVFDLEtBQUksTUFBTSxRQUFRLE9BQU0sTUFBSztBQUFBLGFBQ25FLElBQ0EsS0FBSyxLQUFLLFlBQVksR0FBRyxPQUFPLEVBQUUsR0FBRyxXQUFTLE1BQU0sSUFBSSxVQUN0RCxnQkFBQUQsS0FBQyxnQkFBVyxhQUFhLEtBQUssZ0JBQWdCLFdBQVcsS0FBSyxZQUM1RCwwQkFBQUEsS0FBQyxXQUFNLE9BQU8sS0FBSyxNQUFNLE9BQU8sR0FBRyxHQUNyQyxDQUFhLENBQUM7QUFBQSxVQUNwQixnQkFBQUEsS0FBQyxjQUFXO0FBQUEsVUFDWixnQkFBQUEsS0FBQyxRQUFLO0FBQUEsVUFDTixnQkFBQUE7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUFPLE9BQU07QUFBQSxjQUFPLFFBQVFDLEtBQUksTUFBTTtBQUFBLGNBQ3JDLFdBQVcsTUFBTSxZQUFJLGNBQWMsU0FBUztBQUFBLGNBQzVDLDBCQUFBRCxLQUFDLFdBQU0sVUFBUyx3QkFBdUI7QUFBQTtBQUFBLFVBQ3pDO0FBQUEsV0FDRjtBQUFBLFNBQ0Y7QUFBQTtBQUFBLEVBQ0Y7QUFDRjs7O0FLM0dBLE9BQU8sVUFBVTtBQUNqQixPQUFPSSxVQUFTO0FBS2hCLElBQU0sU0FBUztBQUFBLEVBQ2I7QUFBQSxFQUFvQjtBQUFBLEVBQXNCO0FBQUEsRUFDMUM7QUFBQSxFQUFlO0FBQUEsRUFBc0I7QUFDdkM7QUFFQSxTQUFTLEtBQUssRUFBRSxNQUFNLEdBQXNCO0FBRzFDLFNBQU8sZ0JBQUFDLEtBQUMsU0FBSSxPQUFNLFFBQU8sUUFBUUMsS0FBSSxNQUFNLFFBQVEsUUFBUUEsS0FBSSxNQUFNLEtBQUssU0FBUyxHQUNoRixlQUFhLE9BQU8sRUFBRSxHQUFHLE1BQU07QUFDOUIsVUFBTSxLQUFhLFdBQVcsS0FBSztBQUNuQyxVQUFNLFFBQVEsR0FBRztBQUNqQixVQUFNQyxLQUFJLEtBQUssSUFBSSxPQUFPLENBQUM7QUFDM0IsVUFBTSxNQUFNLEdBQUcsVUFBVSxPQUFLLEVBQUUsT0FBTztBQUN2QyxRQUFJLFFBQVE7QUFDWixRQUFJLFFBQVEsRUFBRyxTQUFRLEtBQUssSUFBSSxLQUFLLEtBQUssTUFBTSxJQUFJLElBQUksT0FBTyxHQUFHLENBQUMsR0FBRyxRQUFRLENBQUM7QUFDL0UsV0FBTyxNQUFNLEtBQUssRUFBRSxRQUFRQSxHQUFFLEdBQUcsQ0FBQyxHQUFHLE1BQU07QUFDekMsWUFBTSxNQUFNLFFBQVE7QUFDcEIsWUFBTSxNQUFNLENBQUMsS0FBSztBQUNsQixVQUFJLE9BQU8sS0FBSyxRQUFRLElBQUssS0FBSSxLQUFLLElBQUk7QUFDMUMsVUFBSSxRQUFRLE1BQU8sTUFBTSxLQUFLLFFBQVEsS0FBTyxNQUFNQSxLQUFJLEtBQUssUUFBUSxJQUFJO0FBQ3RFLFlBQUksS0FBSyxNQUFNO0FBQ2pCLGFBQU8sZ0JBQUFGLEtBQUMsU0FBSSxPQUFPLElBQUksS0FBSyxHQUFHLEdBQUc7QUFBQSxJQUNwQyxDQUFDO0FBQUEsRUFDSCxDQUFDLEdBQ0g7QUFDRjtBQUVBLFNBQVMsV0FBVyxFQUFFLElBQUksR0FBOEI7QUFDdEQsUUFBTSxRQUFRLElBQUksTUFBTSxRQUFRLGNBQWMsRUFBRTtBQUVoRCxRQUFNLFVBQVUsTUFBTTtBQUNwQixVQUFNLEtBQWEsV0FBVyxLQUFLO0FBQ25DLFFBQUksQ0FBQyxHQUFHLE9BQVEsUUFBTyxLQUFLLElBQUksT0FBTztBQUN2QyxVQUFNLFVBQVUsR0FBRyxLQUFLLE9BQUssRUFBRSxPQUFPO0FBQ3RDLFFBQUksQ0FBQyxRQUFTLFFBQU8sS0FBYTtBQUFBLE1BQ2hDLEdBQUcsTUFBTSxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sT0FBTyxFQUFFLE9BQU8sSUFBSSxPQUFPLEVBQUUsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFO0FBQUEsSUFBRTtBQUN4RSxRQUFJLEdBQUcsU0FBUyxFQUFHLFFBQU8sS0FBYSxNQUFNLE9BQU8sQ0FBQztBQUNyRCxJQUFRLFNBQVMsUUFBUSxFQUFFO0FBQUEsRUFDN0I7QUFFQSxTQUFPLGdCQUFBQTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sT0FBTTtBQUFBLE1BQU8sYUFBYSxJQUFJO0FBQUEsTUFDOUIsV0FBVztBQUFBLE1BQ1gsaUJBQWlCLENBQUMsSUFBSSxNQUFNO0FBQzFCLFlBQUksRUFBRSxXQUFXLE1BQU1HLEtBQUksY0FBZSxLQUFJLE9BQU87QUFBQSxNQUN2RDtBQUFBLE1BQ0EsVUFBVSxDQUFDLElBQUksS0FBSyxPQUFPO0FBQ3pCLGNBQU0sS0FBYSxXQUFXLEtBQUs7QUFDbkMsWUFBSSxDQUFDLEdBQUcsT0FBUTtBQUNoQixZQUFJLEdBQUcsU0FBUyxFQUFHLENBQVEsTUFBTSxPQUFPLEtBQUssSUFBSSxJQUFJLEVBQUU7QUFBQSxpQkFDOUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxRQUFTLENBQVEsU0FBUyxHQUFHLENBQUMsRUFBRSxFQUFFO0FBQUEsTUFDcEQ7QUFBQSxNQUNBLCtCQUFDLGFBQ0M7QUFBQSx3QkFBQUg7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFNLE9BQU07QUFBQSxZQUFZLFVBQVUsSUFBSSxhQUFhO0FBQUEsWUFDN0MsV0FBVztBQUFBO0FBQUEsUUFBSTtBQUFBLFFBRXRCLGdCQUFBQSxLQUFDLFFBQUssTUFBSyxXQUFVLE9BQWM7QUFBQSxTQUNyQztBQUFBO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxjQUFjO0FBRXJCLFNBQU8sZ0JBQUFBLEtBQUMsWUFBTyxPQUFNLGdCQUFlLFdBQVcsTUFBTSxVQUFVLHNCQUFzQixHQUNuRiwrQkFBQyxhQUNDO0FBQUEsb0JBQUFBLEtBQUMsU0FBSSxPQUFNLFNBQ1QsMEJBQUFBO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFBTSxPQUFNO0FBQUEsUUFBSyxVQUFTO0FBQUEsUUFBdUIsV0FBVztBQUFBLFFBQ3RELFFBQVFDLEtBQUksTUFBTTtBQUFBLFFBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsUUFBUSxTQUFPO0FBQUEsUUFBQyxTQUFPO0FBQUE7QUFBQSxJQUFDLEdBQzdFO0FBQUEsSUFDQSxnQkFBQUQ7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUFTLE1BQUs7QUFBQSxRQUFVLE9BQU07QUFBQSxRQUFRLFFBQVFDLEtBQUksTUFBTTtBQUFBLFFBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsUUFDekUsT0FBTztBQUFBO0FBQUEsSUFBTTtBQUFBLEtBQ3pCLEdBQ0Y7QUFDRjtBQVNBLElBQU0sWUFBWTtBQUFBLEVBQ2hCLEVBQUUsTUFBTSxZQUFZLE1BQU0sK0RBQXlFLE1BQU0sQ0FBQyxNQUFNLEtBQUssRUFBRTtBQUFBLEVBQ3ZILEVBQUUsTUFBTSxTQUFZLE1BQU0saUVBQXlFLE1BQU0sQ0FBQyxLQUFLLEVBQUU7QUFBQSxFQUNqSCxFQUFFLE1BQU0sV0FBWSxNQUFNLHFEQUF5RSxNQUFNLENBQUMsRUFBRTtBQUFBLEVBQzVHLEVBQUUsTUFBTSxPQUFZLE1BQU0sd0VBQXlFLE1BQU0sQ0FBQyxFQUFFO0FBQUEsRUFDNUcsRUFBRSxNQUFNLFdBQVksTUFBTSxxRkFBcUYsTUFBTSxDQUFDLEVBQUU7QUFBQSxFQUN4SCxFQUFFLE1BQU0sWUFBWSxNQUFNLGlFQUF5RSxNQUFNLENBQUMsRUFBRTtBQUM5RztBQUVBLFNBQVMsU0FBUyxNQUF3QjtBQUN4QyxTQUFPRyxLQUFJLFNBQVMsSUFBSUEsS0FBSSxLQUFLLGFBQWEsSUFBSSxDQUFDO0FBQ3JEO0FBRUEsU0FBUyxXQUFXLEVBQUUsSUFBSSxHQUF3QztBQUloRSxTQUFPLGdCQUFBSixLQUFDLFlBQU8sT0FBTSxRQUFPLGFBQWEsSUFBSSxNQUMzQywrQkFBQyxhQUNDO0FBQUEsb0JBQUFBO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFBTSxPQUFNO0FBQUEsUUFBWSxPQUFPLFNBQVMsSUFBSSxJQUFJO0FBQUEsUUFBRyxXQUFXO0FBQUEsUUFDeEQsUUFBUUMsS0FBSSxNQUFNO0FBQUEsUUFBUSxRQUFRQSxLQUFJLE1BQU07QUFBQTtBQUFBLElBQVE7QUFBQSxJQUMzRCxnQkFBQUQsS0FBQyxTQUFJLE1BQUssV0FBVSxPQUFNLFFBQU8sUUFBUUMsS0FBSSxNQUFNLFFBQVEsUUFBUUEsS0FBSSxNQUFNLEtBQUssU0FBUyxHQUN4RixjQUFJLEtBQUssSUFBSSxTQUFPLGdCQUFBRCxLQUFDLFNBQUksT0FBTyxRQUFRLE9BQU8sV0FBVyxPQUFPLENBQUUsR0FDdEU7QUFBQSxLQUNGLEdBQ0Y7QUFDRjtBQUVBLFNBQVMsU0FBUyxTQUFzQjtBQUN0QyxTQUFPLGdCQUFBQTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sTUFBSztBQUFBLE1BQU8sV0FBVTtBQUFBLE1BQWEsT0FBTTtBQUFBLE1BQ3pDLFlBQVk7QUFBQSxNQUFTLFFBQVFLLE9BQU0sYUFBYTtBQUFBLE1BQ2hELCtCQUFDLFNBQUksT0FBTSxRQUFPLFNBQVMsR0FDekI7QUFBQSx3QkFBQUwsS0FBQyxjQUFXLEtBQUssVUFBVSxDQUFDLEdBQUc7QUFBQSxRQUMvQixnQkFBQUEsS0FBQyxjQUFXLEtBQUssVUFBVSxDQUFDLEdBQUc7QUFBQSxRQUMvQixnQkFBQUEsS0FBQyxjQUFXLEtBQUssVUFBVSxDQUFDLEdBQUc7QUFBQSxRQUMvQixnQkFBQUEsS0FBQyxjQUFXLEtBQUssVUFBVSxDQUFDLEdBQUc7QUFBQSxRQUMvQixnQkFBQUEsS0FBQyxTQUFJLE9BQU0sT0FBTSxRQUFRQyxLQUFJLE1BQU0sUUFBUTtBQUFBLFFBQzNDLGdCQUFBRCxLQUFDLGNBQVcsS0FBSyxVQUFVLENBQUMsR0FBRztBQUFBLFFBQy9CLGdCQUFBQSxLQUFDLGNBQVcsS0FBSyxVQUFVLENBQUMsR0FBRztBQUFBLFFBQy9CLGdCQUFBQSxLQUFDLFNBQUksT0FBTSxPQUFNLFFBQVFDLEtBQUksTUFBTSxRQUFRO0FBQUEsUUFDM0MsZ0JBQUFELEtBQUMsZUFBWTtBQUFBLFNBQ2Y7QUFBQTtBQUFBLEVBQ0Y7QUFDRjtBQUVlLFNBQVIsS0FBc0IsU0FBc0I7QUFDakQsTUFBSSxLQUFNLFFBQU8sU0FBUyxPQUFPO0FBRWpDLFFBQU0sT0FBTyxJQUFJLEtBQUssS0FBSztBQUkzQixRQUFNLE1BQU0sS0FBSyxTQUFTO0FBQzFCLFFBQU0sVUFBVSxDQUFDLE9BQ2YsSUFBSSxLQUFLLE9BQUssRUFBRSxVQUFVLEdBQUcsRUFBRSxjQUFjLEVBQUUsVUFBVSxFQUFFLEtBQ3hELElBQUksS0FBSyxPQUFLLEVBQUUsT0FBTyxZQUFZLEVBQUUsU0FBUyxHQUFHLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRSxJQUFJLENBQUUsQ0FBQztBQUl0RixRQUFNLFFBQVEsT0FBTyxJQUFJLFNBQU8sRUFBRSxJQUFJLEtBQUssUUFBUSxFQUFFLEVBQUUsRUFBRTtBQUN6RCxTQUFPLGdCQUFBQTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sTUFBSztBQUFBLE1BQU8sV0FBVTtBQUFBLE1BQWEsT0FBTTtBQUFBLE1BQ3pDLFlBQVk7QUFBQSxNQUFTLFFBQVFLLE9BQU0sYUFBYTtBQUFBLE1BQ2hELCtCQUFDLFNBQUksT0FBTSxRQUFPLFNBQVMsR0FDeEI7QUFBQSxjQUFNLElBQUksQ0FBQyxFQUFFLElBQUksSUFBSSxHQUFHLE1BQU07QUFBQSxVQUM3QixNQUFNLElBQUksZ0JBQUFMLEtBQUMsU0FBSSxPQUFNLE9BQU0sUUFBUUMsS0FBSSxNQUFNLFFBQVEsSUFBSztBQUFBLFVBQzFELE1BQ0ksZ0JBQUFELEtBQUMsY0FBVyxLQUFVLElBQ3RCLGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxvQkFBbUIsYUFBYSxHQUFHLE1BQU0sR0FBRyxFQUFFLElBQUksR0FDOUQsMEJBQUFBLEtBQUMsV0FBTSxPQUFNLGFBQVksVUFBUyxxQ0FBb0MsV0FBVyxJQUFJLEdBQ3ZGO0FBQUEsUUFDTixDQUFDO0FBQUEsUUFDRCxnQkFBQUEsS0FBQyxTQUFJLE9BQU0sT0FBTSxRQUFRQyxLQUFJLE1BQU0sUUFBUTtBQUFBLFFBQzNDLGdCQUFBRCxLQUFDLGVBQVk7QUFBQSxTQUNmO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7OztBQ3JLQSxPQUFPTSxXQUFVOzs7QUNQakIsT0FBT0MsV0FBVTtBQUlWLFNBQVMsTUFBTSxHQUFXLEdBQXlCO0FBQ3hELFFBQU0sS0FBSyxFQUFFLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWTtBQUMvQyxNQUFJLEtBQUssR0FBRyxRQUFRLEdBQUcsT0FBTztBQUM5QixRQUFNLFFBQWtCLENBQUM7QUFDekIsV0FBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLFVBQVUsS0FBSyxHQUFHLFFBQVEsS0FBSztBQUNwRCxRQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHO0FBQ3BCLFlBQU0sS0FBSyxDQUFDO0FBQ1osZUFBVSxNQUFNLEtBQUssUUFBUSxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSyxJQUFLLFNBQVMsSUFBSSxJQUFJLElBQUk7QUFDN0UsYUFBTztBQUFHO0FBQUEsSUFDWjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLE9BQU8sR0FBRyxTQUFTLEVBQUUsT0FBTyxRQUFRLEVBQUUsU0FBUyxNQUFNLE1BQU0sSUFBSTtBQUN4RTtBQUdPLFNBQVMsR0FBRyxHQUFXLE9BQWdDO0FBQzVELFFBQU0sTUFBTSxDQUFDLE1BQWNBLE1BQUssbUJBQW1CLEdBQUcsRUFBRTtBQUN4RCxNQUFJLENBQUMsTUFBTyxRQUFPLElBQUksQ0FBQztBQUN4QixRQUFNLElBQUksSUFBSSxJQUFJLEtBQUs7QUFDdkIsTUFBSSxNQUFNO0FBQ1YsV0FBUyxJQUFJLEdBQUcsSUFBSSxFQUFFLFFBQVE7QUFDNUIsV0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJLDhCQUE4QixJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQy9FLFNBQU87QUFDVDtBQUdBLElBQU0sUUFBUSxHQUFHQSxNQUFLLG1CQUFtQixDQUFDO0FBQzFDLElBQUksT0FBK0IsQ0FBQztBQUNwQyxJQUFJO0FBQUUsU0FBTyxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBT0EsTUFBSyxrQkFBa0IsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQUUsUUFBUTtBQUFFO0FBRXZGLElBQU0sUUFBUSxDQUFDLE9BQWUsS0FBSyxJQUFJLEtBQUssS0FBSyxLQUFLLEtBQUssRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDO0FBRXhFLFNBQVMsS0FBSyxJQUFZO0FBQy9CLE9BQUssRUFBRSxLQUFLLEtBQUssRUFBRSxLQUFLLEtBQUs7QUFDN0IsRUFBQUEsTUFBSyxtQkFBbUJBLE1BQUssaUJBQWlCLEtBQUssR0FBRyxHQUFLO0FBQzNELEVBQUFBLE1BQUssa0JBQWtCLE9BQU8sS0FBSyxVQUFVLElBQUksQ0FBQztBQUNwRDtBQUVPLElBQU0sWUFBWSxDQUFDLE9BQWUsS0FBSyxFQUFFLEtBQUs7OztBQ2pDckQsSUFBTSxNQUFNLE9BQU8sSUFBSSxLQUFLLEVBQUUsTUFBTSxHQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsTUFBTSxDQUFDLElBQUksb0JBQUksS0FBSztBQUN4RSxJQUFNLE1BQU0sQ0FBQyxHQUFXLEdBQVcsTUFBYyxHQUFHLENBQUMsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDO0FBQzVELElBQU0sU0FBK0I7QUFBQSxFQUMxQyxDQUFDLElBQUksSUFBSSxZQUFZLEdBQUcsSUFBSSxTQUFTLEdBQUcsSUFBSSxRQUFRLENBQUMsQ0FBQyxHQUNwRCxDQUFDLEVBQUUsR0FBRyxTQUFTLEdBQUcsaUJBQWlCLE1BQU0sdUJBQXVCLENBQUM7QUFBQSxFQUNuRSxDQUFDLElBQUksSUFBSSxZQUFZLEdBQUcsSUFBSSxTQUFTLEdBQUcsRUFBRSxDQUFDLEdBQ3pDO0FBQUEsSUFBQyxFQUFFLEdBQUcsU0FBUyxHQUFHLG1CQUFtQixNQUFNLHNCQUFzQjtBQUFBLElBQ2hFLEVBQUUsR0FBRyxTQUFTLEdBQUcsZ0JBQWdCLE1BQU0scUJBQXFCO0FBQUEsRUFBQztBQUFBLEVBQ2hFLENBQUMsSUFBSSxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsR0FBRyxFQUFFLENBQUMsR0FDekMsQ0FBQyxFQUFFLEdBQUcsV0FBVyxHQUFHLGVBQWUsTUFBTSxzQkFBc0IsQ0FBQztBQUNwRTtBQUVBLElBQU0sT0FBTyxTQUFTLEVBQUUsR0FBRyxJQUFJLFlBQVksR0FBRyxHQUFHLElBQUksU0FBUyxFQUFFLENBQUM7QUFDakUsSUFBTSxNQUFNLFNBQVMsSUFBSSxLQUFLLElBQUksWUFBWSxHQUFHLElBQUksU0FBUyxHQUFHLElBQUksUUFBUSxDQUFDLENBQUM7QUFFL0UsU0FBUyxRQUFRLEdBQWlCO0FBQ2hDLFFBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsWUFBWSxHQUFHLEVBQUUsU0FBUyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7QUFDdkUsUUFBTSxNQUFNLEVBQUUsVUFBVSxJQUFJLEtBQUs7QUFDakMsSUFBRSxXQUFXLEVBQUUsV0FBVyxJQUFJLEtBQUssQ0FBQztBQUNwQyxRQUFNLElBQUksSUFBSSxLQUFLLEtBQUssSUFBSSxFQUFFLGVBQWUsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUNyRCxTQUFPLElBQUksS0FBSyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssUUFBUSxLQUFNLEVBQUUsVUFBVSxJQUFJLEtBQUssS0FBTSxDQUFDO0FBQy9FO0FBRUEsU0FBUyxPQUFPO0FBQ2QsU0FBTyxnQkFBQUMsS0FBQyxTQUFJLE9BQU0sWUFBVyxhQUFhQyxLQUFJLFlBQVksVUFDdkQsZUFBSyxTQUFTLE9BQU8sQ0FBQyxNQUFNLEdBQUcsR0FBRyxDQUFDLEdBQUcsT0FBTyxFQUFFLEdBQUcsRUFBRSxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsTUFBTTtBQUN6RSxVQUFNLFFBQVEsSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQztBQUNsQyxVQUFNLFNBQVMsTUFBTSxPQUFPLElBQUksS0FBSztBQUNyQyxVQUFNLE9BQU8sSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLElBQUksR0FBRyxDQUFDLEVBQUUsUUFBUTtBQUMvQyxVQUFNLFdBQVcsSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxFQUFFLFFBQVE7QUFDL0MsVUFBTSxPQUFPLENBQUM7QUFDZCxTQUFLLEtBQUssZ0JBQUFELEtBQUMsU0FBSSxhQUFXLE1BQ3ZCLFdBQUMsSUFBSSxLQUFLLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxHQUFHLEVBQUUsSUFBSSxPQUMzQyxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sT0FBTSxPQUFPLEdBQUcsQ0FBRSxHQUNuQyxDQUFNO0FBQ04sYUFBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLEtBQUs7QUFDMUIsWUFBTSxRQUFRLENBQUMsZ0JBQUFBO0FBQUEsUUFBQztBQUFBO0FBQUEsVUFBTSxPQUFNO0FBQUEsVUFDMUIsT0FBTyxHQUFHLFFBQVEsSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxJQUFJLFFBQVEsQ0FBQyxDQUFDLENBQUM7QUFBQTtBQUFBLE1BQUksQ0FBRTtBQUNoRSxlQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUMxQixjQUFNLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxJQUFJLFFBQVE7QUFDckMsY0FBTSxNQUFNLElBQUksS0FBSyxJQUFJO0FBQ3pCLGNBQU0sUUFBUSxNQUFPLElBQUksSUFBSSxXQUFXLElBQUksSUFBSSxPQUFRO0FBQ3hELGNBQU0sTUFBTSxDQUFDLEtBQUs7QUFDbEIsWUFBSSxLQUFLLEVBQUcsS0FBSSxLQUFLLElBQUk7QUFDekIsWUFBSSxJQUFLLEtBQUksS0FBSyxLQUFLO0FBQUEsYUFDbEI7QUFDSCxnQkFBTSxRQUFRO0FBQ2QsY0FBSSxNQUFNLE1BQU0sUUFBUSxLQUFLLEVBQUUsTUFBTSxNQUFNLFNBQVMsS0FBSyxFQUFFLE1BQU0sTUFBTSxZQUFZO0FBQ2pGLGdCQUFJLEtBQUssT0FBTztBQUNsQixjQUFJLE9BQU8sSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQyxFQUFHLEtBQUksS0FBSyxJQUFJO0FBQzNDLGNBQUksRUFBRSxRQUFRLE1BQU0sS0FBSyxFQUFFLFNBQVMsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLE1BQU0sRUFBRTtBQUNyRSxnQkFBSSxLQUFLLEtBQUs7QUFBQSxRQUNsQjtBQUNBLGNBQU0sUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE9BQU8sSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUcvQyxjQUFNLEtBQUssTUFDUCxnQkFBQUEsS0FBQyxXQUFNLE9BQU8sSUFBSSxLQUFLLEdBQUcsR0FBRyxRQUFRQyxLQUFJLE1BQU0sUUFBUSxPQUFPLEdBQUcsS0FBSyxJQUFJLElBQzFFLGdCQUFBRDtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQU8sT0FBTyxJQUFJLEtBQUssR0FBRztBQUFBLFlBQ3pCLFFBQVFDLEtBQUksTUFBTTtBQUFBLFlBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsWUFDNUMsV0FBVyxNQUFNLElBQUksSUFBSSxJQUFJLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFBQSxZQUM3QyxrQkFDRyxxQkFBQyxhQUNDO0FBQUEsOEJBQUFELEtBQUMsV0FBTSxPQUFPLEdBQUcsS0FBSyxJQUFJO0FBQUEsY0FFMUIsZ0JBQUFBO0FBQUEsZ0JBQUM7QUFBQTtBQUFBLGtCQUFJLE1BQUs7QUFBQSxrQkFBVSxPQUFNO0FBQUEsa0JBQ3hCLFFBQVFDLEtBQUksTUFBTTtBQUFBLGtCQUFRLFFBQVFBLEtBQUksTUFBTTtBQUFBO0FBQUEsY0FBSztBQUFBLGVBQ3JELElBQ0EsZ0JBQUFELEtBQUMsV0FBTSxPQUFPLEdBQUcsS0FBSyxJQUFJO0FBQUE7QUFBQSxRQUNoQyxDQUFTO0FBQUEsTUFDZjtBQUNBLFdBQUssS0FBSyxnQkFBQUEsS0FBQyxTQUFJLGFBQVcsTUFBRSxpQkFBTSxDQUFNO0FBQUEsSUFDMUM7QUFDQSxXQUFPO0FBQUEsRUFDVCxDQUFDLEdBQ0g7QUFDRjtBQUVBLFNBQVMsYUFBYTtBQUdwQixTQUFPLGdCQUFBQSxLQUFDLFNBQUksT0FBTSxVQUFTLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQVMsR0FDeEUsZUFBSyxHQUFHLEVBQUUsR0FBRyxPQUFLO0FBQ2pCLFVBQU0sTUFBTSxPQUFPLElBQUksRUFBRSxZQUFZLEdBQUcsRUFBRSxTQUFTLEdBQUcsRUFBRSxRQUFRLENBQUMsQ0FBQyxLQUFLLENBQUM7QUFDeEUsVUFBTSxPQUFPLGdCQUFBRDtBQUFBLE1BQUM7QUFBQTtBQUFBLFFBQU0sT0FBTTtBQUFBLFFBQVMsUUFBUUMsS0FBSSxNQUFNO0FBQUEsUUFDbkQsT0FBTyxFQUFFLG1CQUFtQixTQUFTLEVBQUUsU0FBUyxRQUFRLEtBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQztBQUFBO0FBQUEsSUFBRztBQUM1RixRQUFJLENBQUMsSUFBSSxPQUFRLFFBQU87QUFBQSxNQUFDO0FBQUEsTUFDdkIscUJBQUMsU0FBSSxTQUFTLEdBQUc7QUFBQSx3QkFBQUQsS0FBQyxXQUFNLFVBQVMsMkJBQTBCO0FBQUEsUUFDekQsZ0JBQUFBLEtBQUMsV0FBTSxPQUFNLE9BQU0sT0FBTSxhQUFZO0FBQUEsU0FBRTtBQUFBLElBQU07QUFDakQsV0FBTyxDQUFDLE1BQU0sR0FBRyxJQUFJLElBQUksT0FDdkIscUJBQUMsU0FBSSxPQUFNLFNBQVEsU0FBUyxJQUUxQjtBQUFBLHNCQUFBQSxLQUFDLFNBQUksT0FBTSxRQUFPLFFBQVFDLEtBQUksTUFBTSxRQUNsQywwQkFBQUQsS0FBQyxXQUFNLFVBQVUsRUFBRSxNQUFNLEdBQUU7QUFBQSxNQUM3QixxQkFBQyxTQUFJLGFBQWFDLEtBQUksWUFBWSxVQUFVLFFBQVFBLEtBQUksTUFBTSxRQUM1RDtBQUFBLHdCQUFBRCxLQUFDLFdBQU0sUUFBUUMsS0FBSSxNQUFNLE9BQU8sT0FBTyxFQUFFLEdBQUc7QUFBQSxRQUM1QyxnQkFBQUQsS0FBQyxXQUFNLE9BQU0sVUFBUyxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFPLEVBQUUsR0FBRztBQUFBLFNBQzdEO0FBQUEsT0FDRixDQUFNLENBQUM7QUFBQSxFQUNYLENBQUMsR0FDSDtBQUNGO0FBRWUsU0FBUixXQUE0QjtBQUNqQyxTQUFPLGdCQUFBRDtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sTUFBSztBQUFBLE1BQVcsV0FBVTtBQUFBLE1BQWlCLE9BQU07QUFBQSxNQUFrQixTQUFTO0FBQUEsTUFDNUUsUUFBUUUsT0FBTSxhQUFhO0FBQUEsTUFBSyxhQUFhQSxPQUFNLFlBQVk7QUFBQSxNQUFRLFNBQVNBLE9BQU0sUUFBUTtBQUFBLE1BQzlGLGNBQWMsQ0FBQyxNQUFNQyxTQUFRQSxTQUFRQyxLQUFJLGNBQWMsS0FBSyxLQUFLLEdBQUcsUUFBUTtBQUFBLE1BQzVFLCtCQUFDLFNBQUksT0FBTSxhQUFZLGFBQWFILEtBQUksWUFBWSxVQUFVLFNBQVMsR0FDckU7QUFBQSw2QkFBQyxTQUFJLE9BQU0sV0FBVSxhQUFhQSxLQUFJLFlBQVksVUFDaEQ7QUFBQSwwQkFBQUQ7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUFNLE9BQU07QUFBQSxjQUFNLFFBQVFDLEtBQUksTUFBTTtBQUFBLGNBQ25DLE9BQU8sSUFBSSxtQkFBbUIsU0FBUyxFQUFFLFNBQVMsT0FBTyxDQUFDO0FBQUE7QUFBQSxVQUFHO0FBQUEsVUFDL0QsZ0JBQUFEO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FBTSxPQUFNO0FBQUEsY0FBTyxRQUFRQyxLQUFJLE1BQU07QUFBQSxjQUNwQyxPQUFPLElBQUksbUJBQW1CLFNBQVMsRUFBRSxLQUFLLFdBQVcsT0FBTyxRQUFRLE1BQU0sVUFBVSxDQUFDO0FBQUE7QUFBQSxVQUFHO0FBQUEsV0FDaEc7QUFBQSxRQUNBLHFCQUFDLGVBQ0M7QUFBQSwwQkFBQUQsS0FBQyxZQUFPLFdBQVcsTUFBTTtBQUN2QixrQkFBTSxJQUFJLEtBQUssSUFBSTtBQUNuQixpQkFBSyxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLEdBQUcsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFBQSxVQUMvRCxHQUFHLDBCQUFBQSxLQUFDLFdBQU0sVUFBUywrQkFBOEIsR0FBRTtBQUFBLFVBQ25ELGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxTQUFRLFdBQVcsTUFDL0IsS0FBSyxJQUFJLEVBQUUsR0FBRyxJQUFJLFlBQVksR0FBRyxHQUFHLElBQUksU0FBUyxFQUFFLENBQUMsR0FDcEQsMEJBQUFBLEtBQUMsV0FBTSxPQUFPLEtBQUssSUFBSSxFQUFFLEdBQUcsT0FDMUIsSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxlQUFlLE1BQU0sRUFBRSxPQUFPLE9BQU8sQ0FBQyxLQUN0RCxFQUFFLE1BQU0sSUFBSSxZQUFZLElBQUksSUFBSSxFQUFFLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FDckQ7QUFBQSxVQUNBLGdCQUFBQSxLQUFDLFlBQU8sV0FBVyxNQUFNO0FBQ3ZCLGtCQUFNLElBQUksS0FBSyxJQUFJO0FBQ25CLGlCQUFLLElBQUksRUFBRSxNQUFNLEtBQUssRUFBRSxHQUFHLEVBQUUsSUFBSSxHQUFHLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLEdBQUcsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDO0FBQUEsVUFDckUsR0FBRywwQkFBQUEsS0FBQyxXQUFNLFVBQVMsZ0NBQStCLEdBQUU7QUFBQSxXQUN0RDtBQUFBLFFBQ0EsZ0JBQUFBLEtBQUMsUUFBSztBQUFBLFFBQ04sZ0JBQUFBLEtBQUMsY0FBVztBQUFBLFNBQ2Q7QUFBQTtBQUFBLEVBQ0Y7QUFDRjs7O0FGbElBLElBQU1LLFVBQVM7QUFBQSxFQUFDO0FBQUEsRUFBb0I7QUFBQSxFQUFzQjtBQUFBLEVBQ3hEO0FBQUEsRUFBZTtBQUFBLEVBQXNCO0FBQW9CO0FBRzNELElBQU0sYUFBYTtBQUFBLEVBQ2pCLEVBQUUsTUFBTSxZQUFZLElBQUksbUJBQW1CO0FBQUEsRUFDM0MsRUFBRSxNQUFNLFNBQVMsSUFBSSxxQkFBcUI7QUFBQSxFQUMxQyxFQUFFLE1BQU0sV0FBVyxJQUFJLFVBQVU7QUFBQSxFQUNqQyxFQUFFLE1BQU0sT0FBTyxJQUFJLGNBQWM7QUFBQSxFQUNqQyxFQUFFLE1BQU0sV0FBVyxJQUFJLHFCQUFxQjtBQUFBLEVBQzVDLEVBQUUsTUFBTSxZQUFZLElBQUkscUJBQXFCO0FBQy9DO0FBR0EsU0FBUyxVQUFVLE1BQXlCO0FBQzFDLFFBQU0sTUFBTSxLQUFLLFNBQVM7QUFDMUIsUUFBTSxVQUFVLENBQUMsT0FDZixJQUFJLEtBQUssT0FBSyxFQUFFLFVBQVUsR0FBRyxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsS0FDeEQsSUFBSSxLQUFLLE9BQUssRUFBRSxPQUFPLFlBQVksRUFBRSxTQUFTLEdBQUcsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBRSxDQUFDO0FBQ3RGLFFBQU0sVUFBVSxDQUFDLFNBQWlDO0FBQUEsSUFDaEQsTUFBTSxJQUFJO0FBQUEsSUFBTSxVQUFVLElBQUksYUFBYTtBQUFBLElBQzNDLFFBQVEsTUFBTTtBQUFFLFdBQUssSUFBSSxJQUFJO0FBQUcsVUFBSSxPQUFPO0FBQUEsSUFBRTtBQUFBLEVBQy9DO0FBQ0EsTUFBSSxLQUFNLFFBQU8sV0FBVyxJQUFJLENBQUMsRUFBRSxNQUFNLEdBQUcsTUFBTTtBQUNoRCxVQUFNLE1BQU0sUUFBUSxFQUFFO0FBQ3RCLFdBQU87QUFBQSxNQUFFO0FBQUEsTUFBTSxVQUFVLEtBQUssYUFBYSxNQUFNO0FBQUEsTUFDL0MsUUFBUSxNQUFNO0FBQUUsYUFBSyxJQUFJO0FBQUcsYUFBSyxPQUFPO0FBQUEsTUFBRTtBQUFBLElBQUU7QUFBQSxFQUNoRCxDQUFDO0FBQ0QsUUFBTSxTQUFTQSxRQUFPLElBQUksT0FBTyxFQUFFLE9BQU8sT0FBTztBQUNqRCxRQUFNLE9BQU8sSUFBSSxPQUFPLE9BQUssQ0FBQyxPQUFPLFNBQVMsQ0FBQyxDQUFDLEVBQzdDLEtBQUssQ0FBQyxHQUFHLE1BQU0sVUFBVSxFQUFFLElBQUksSUFBSSxVQUFVLEVBQUUsSUFBSSxDQUFDO0FBQ3ZELFNBQU8sQ0FBQyxHQUFHLFFBQVEsR0FBRyxJQUFJLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRSxJQUFJLE9BQU87QUFDckQ7QUFDQSxTQUFTLGtCQUEwQjtBQUNqQyxNQUFJLEtBQU0sUUFBTyxFQUFFO0FBQ25CLFFBQU0sSUFBSSxvQkFBSSxLQUFLO0FBQ25CLFFBQU0sTUFBTSxPQUFPLEdBQUcsRUFBRSxZQUFZLENBQUMsSUFBSSxFQUFFLFNBQVMsSUFBSSxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsRUFBRSxLQUFLLENBQUM7QUFDaEYsU0FBTyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLFNBQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxLQUFLO0FBQ3BEO0FBQ0EsU0FBUyxpQkFBeUI7QUFDaEMsU0FBTyxPQUFPLEVBQUUsY0FDWixvQkFBSSxLQUFLLEdBQUUsbUJBQW1CLFNBQVMsRUFBRSxTQUFTLFFBQVEsS0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDO0FBQy9GO0FBT0EsSUFBTSxVQUFVO0FBQUEsRUFDZDtBQUFBLElBQUUsR0FBRztBQUFBLElBQVcsTUFBTTtBQUFBLElBQXVCLEdBQUc7QUFBQSxJQUM5QyxJQUFJLENBQUMsT0FBTztBQUFBLElBQUcsS0FBSyxNQUFNLFVBQVUsbUJBQW1CO0FBQUEsRUFBRTtBQUFBLEVBQzNEO0FBQUEsSUFBRSxHQUFHO0FBQUEsSUFBUSxNQUFNO0FBQUEsSUFBdUIsR0FBRztBQUFBLElBQzNDLElBQUksQ0FBQyxhQUFhO0FBQUEsSUFBRyxLQUFLLE1BQU0sVUFBVSx1QkFBdUI7QUFBQSxFQUFFO0FBQUEsRUFDckU7QUFBQSxJQUFFLEdBQUc7QUFBQSxJQUFXLE1BQU07QUFBQSxJQUF5QixHQUFHO0FBQUEsSUFDaEQsSUFBSSxDQUFDLFFBQVEsWUFBWSxRQUFRO0FBQUEsSUFBRyxLQUFLLE1BQU0sWUFBSSxjQUFjLFNBQVM7QUFBQSxFQUFFO0FBQUEsRUFDOUU7QUFBQSxJQUFFLEdBQUc7QUFBQSxJQUFXLE1BQU07QUFBQSxJQUF5QixHQUFHO0FBQUEsSUFDaEQsSUFBSSxDQUFDLFFBQVE7QUFBQSxJQUFHLEtBQUssTUFBTSxZQUFJLGNBQWMsU0FBUztBQUFBLEVBQUU7QUFBQSxFQUMxRDtBQUFBLElBQUUsR0FBRztBQUFBLElBQWEsTUFBTTtBQUFBLElBQXdCLEdBQUc7QUFBQSxJQUNqRCxJQUFJLENBQUMsWUFBWSxNQUFNO0FBQUEsSUFBRyxLQUFLLE1BQU0sWUFBSSxjQUFjLFNBQVM7QUFBQSxFQUFFO0FBQUEsRUFDcEU7QUFBQSxJQUFFLEdBQUc7QUFBQSxJQUF1QixNQUFNO0FBQUEsSUFDaEMsR0FBRztBQUFBLElBQXNDLElBQUksQ0FBQztBQUFBLElBQzlDLEtBQUssTUFBTSxVQUFVLG1CQUFtQjtBQUFBLEVBQUU7QUFDOUM7QUFFQSxJQUFNLE9BQU87QUFBQSxFQUNYLEVBQUUsR0FBRyxVQUFVLEdBQUcsK0NBQTBDO0FBQUEsRUFDNUQsRUFBRSxHQUFHLFdBQVcsR0FBRyxzQ0FBc0M7QUFBQSxFQUN6RCxFQUFFLEdBQUcsY0FBYyxHQUFHLHdDQUF3QztBQUFBLEVBQzlELEVBQUUsR0FBRyxVQUFVLEdBQUcsa0NBQWtDO0FBQ3REO0FBRWUsU0FBUixXQUE0QjtBQUNqQyxRQUFNLE9BQU8sSUFBSUMsTUFBSyxLQUFLO0FBRTNCLFFBQU0sUUFBUSxTQUFTQyxTQUFLLE9BQU8sYUFBYSxLQUFLLEVBQUU7QUFDdkQsUUFBTSxXQUFXLFNBQVMsQ0FBQztBQUMzQixRQUFNLFFBQVEsU0FBUyxFQUFFO0FBRXpCLFdBQVMsUUFBUSxHQUErQztBQUM5RCxVQUFNLEtBQUssRUFBRSxLQUFLO0FBQ2xCLFFBQUksQ0FBQyxHQUFJLFFBQU8sQ0FBQztBQUNqQixRQUFJLEdBQUcsV0FBVyxHQUFHLEdBQUc7QUFDdEIsWUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUM1QixhQUFPLENBQUM7QUFBQSxRQUNOLFNBQVM7QUFBQSxRQUNULE1BQU0sS0FBSyxPQUFPLE9BQUssRUFBRSxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsSUFBSSxRQUFNO0FBQUEsVUFDbkQsTUFBTSxJQUFJLEVBQUUsQ0FBQztBQUFBLFVBQUksTUFBTTtBQUFBLFVBQTJCLE1BQU0sRUFBRTtBQUFBLFVBQUcsT0FBTztBQUFBLFVBQ3BFLFFBQVEsSUFBSSxFQUFFLENBQUM7QUFBQSxVQUFJLEtBQUssTUFBTSxVQUFVLGNBQWMsRUFBRSxDQUFDLEVBQUU7QUFBQSxRQUM3RCxFQUFFO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDSDtBQUNBLFVBQU0sTUFBMEMsQ0FBQztBQUVqRCxRQUFJLHNCQUFzQixLQUFLLEVBQUUsS0FBSyxRQUFRLEtBQUssRUFBRSxLQUFLLFVBQVUsS0FBSyxFQUFFLEdBQUc7QUFDNUUsVUFBSTtBQUNGLGNBQU0sSUFBSSxTQUFTLHVCQUF1QixHQUFHLFFBQVEsTUFBTSxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQ25FLFlBQUksT0FBTyxTQUFTLENBQUMsRUFBRyxLQUFJLEtBQUs7QUFBQSxVQUMvQixTQUFTO0FBQUEsVUFDVCxNQUFNLENBQUM7QUFBQSxZQUFFLE1BQU0sT0FBTyxDQUFDO0FBQUEsWUFBRyxNQUFNO0FBQUEsWUFDOUIsTUFBTSxHQUFHLEdBQUcsUUFBUSxNQUFNLEVBQUUsQ0FBQztBQUFBLFlBQU0sT0FBTztBQUFBLFlBQUksUUFBUSxPQUFPLENBQUM7QUFBQSxZQUM5RCxLQUFLLE1BQU0sVUFBVSxDQUFDLFdBQVcsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUFBLFVBQUUsQ0FBQztBQUFBLFFBQ2xELENBQUM7QUFBQSxNQUNILFFBQVE7QUFBQSxNQUFFO0FBQUEsSUFDWjtBQUNBLFVBQU0sVUFBaUIsS0FBSyxZQUFZLEVBQUUsRUFBRSxNQUFNLEdBQUcsQ0FBQyxFQUFFLElBQUksT0FBSztBQUMvRCxZQUFNLElBQUksTUFBTSxJQUFJLEVBQUUsSUFBSSxLQUFLLEVBQUUsT0FBTyxHQUFHLE9BQU8sS0FBWTtBQUM5RCxhQUFPO0FBQUEsUUFDTCxNQUFNLEVBQUU7QUFBQSxRQUFNLE1BQU0sRUFBRSxhQUFhO0FBQUEsUUFDbkMsTUFBTTtBQUFBLFFBQWUsT0FBTyxFQUFFLFFBQVEsTUFBTSxFQUFFLElBQUk7QUFBQSxRQUNsRCxRQUFRLEdBQUcsRUFBRSxNQUFNLEVBQUUsS0FBSztBQUFBLFFBQzFCLEtBQUssTUFBTTtBQUFFLGVBQUssRUFBRSxJQUFJO0FBQUcsWUFBRSxPQUFPO0FBQUEsUUFBRTtBQUFBLE1BQ3hDO0FBQUEsSUFDRixDQUFDO0FBQ0QsVUFBTSxVQUFpQixRQUFRLElBQUksT0FBSztBQUN0QyxVQUFJLElBQUksTUFBTSxJQUFJLEVBQUUsQ0FBQztBQUNyQixVQUFJLENBQUMsRUFBRyxZQUFXLE1BQU0sRUFBRSxJQUFJO0FBQUUsY0FBTSxLQUFLLE1BQU0sSUFBSSxFQUFFO0FBQUcsWUFBSSxJQUFJO0FBQUUsY0FBSSxFQUFFLE9BQU8sR0FBRyxRQUFRLEtBQUksT0FBTyxLQUFZO0FBQUc7QUFBQSxRQUFNO0FBQUEsTUFBRTtBQUMvSCxhQUFPLElBQUk7QUFBQSxRQUFFLE1BQU0sRUFBRTtBQUFBLFFBQUcsTUFBTSxFQUFFO0FBQUEsUUFBTSxNQUFNLEVBQUU7QUFBQSxRQUFHLE9BQU8sRUFBRSxRQUFRO0FBQUEsUUFDaEUsUUFBUSxHQUFHLEVBQUUsR0FBSSxFQUFVLEtBQUs7QUFBQSxRQUFHLEtBQUssRUFBRTtBQUFBLE1BQUksSUFBVztBQUFBLElBQzdELENBQUMsRUFBRSxPQUFPLE9BQU87QUFFakIsVUFBTSxNQUFNLENBQUMsR0FBRyxTQUFTLEdBQUcsT0FBTyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxRQUFRLEVBQUUsS0FBSztBQUNyRSxVQUFNLE9BQU8sSUFBSSxDQUFDO0FBQ2xCLFFBQUksS0FBTSxLQUFJLEtBQUssRUFBRSxTQUFTLGNBQWMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO0FBQzFELFVBQU0sT0FBTyxDQUFDLFNBQWdCLEtBQUssT0FBTyxPQUFLLE1BQU0sSUFBSTtBQUN6RCxRQUFJLEtBQUssT0FBTyxFQUFFLE9BQVEsS0FBSSxLQUFLLEVBQUUsU0FBUyxRQUFRLE1BQU0sS0FBSyxPQUFPLEVBQUUsQ0FBQztBQUMzRSxRQUFJLEtBQUssT0FBTyxFQUFFLE9BQVEsS0FBSSxLQUFLLEVBQUUsU0FBUyxXQUFXLE1BQU0sS0FBSyxPQUFPLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO0FBQzFGLFFBQUksS0FBSztBQUFBLE1BQ1AsU0FBUztBQUFBLE1BQ1QsTUFBTSxDQUFDO0FBQUEsUUFBRSxNQUFNLDRCQUF1QixFQUFFO0FBQUEsUUFBSyxNQUFNO0FBQUEsUUFDakQsTUFBTTtBQUFBLFFBQUksT0FBTztBQUFBLFFBQUcsUUFBUSw0QkFBdUIsRUFBRTtBQUFBLFFBQ3JELEtBQUssTUFBTSxVQUFVLENBQUMsWUFBWSw2QkFBNkIsbUJBQW1CLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUFFLENBQUM7QUFBQSxJQUMvRixDQUFDO0FBRUQsVUFBTSxJQUFJLElBQUksUUFBUSxPQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksT0FBSyxFQUFFLElBQUksRUFDL0MsS0FBSyxDQUFBQyxPQUFLQSxHQUFFLFlBQVksRUFBRSxXQUFXLEdBQUcsWUFBWSxDQUFDLEtBQUtBLEdBQUUsU0FBUyxHQUFHLE1BQU07QUFDakYsVUFBTSxJQUFJLEtBQUssRUFBRTtBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQU87QUFFdkMsU0FBTyxnQkFBQUM7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFXLFdBQVU7QUFBQSxNQUFpQixPQUFNO0FBQUEsTUFDakQsUUFBUUMsT0FBTSxhQUFhO0FBQUEsTUFBSyxhQUFhQSxPQUFNLFlBQVk7QUFBQSxNQUMvRCxTQUFTQSxPQUFNLFFBQVE7QUFBQSxNQUFXLFNBQVM7QUFBQSxNQUMzQyxjQUFjLENBQUMsTUFBTUMsTUFBSyxPQUFPLFNBQVM7QUFDeEMsY0FBTSxPQUFPLFFBQVEsTUFBTSxJQUFJLENBQUMsRUFBRSxRQUFRLE9BQUssRUFBRSxJQUFJO0FBQ3JELFlBQUlBLFNBQVFDLEtBQUksWUFBWTtBQUMxQixjQUFJLE1BQU0sSUFBSSxHQUFHO0FBQUUsa0JBQU0sSUFBSSxFQUFFO0FBQUcsbUJBQU87QUFBQSxVQUFLO0FBQzlDLGVBQUssS0FBSztBQUFHLGlCQUFPO0FBQUEsUUFDdEI7QUFDQSxZQUFJRCxTQUFRQyxLQUFJLFNBQVM7QUFDdkIsZ0JBQU0sSUFBSSxNQUFNLElBQUksR0FBRyxJQUFJLE1BQU0sSUFBSTtBQUNyQyxjQUFJLEtBQUssRUFBRSxPQUFPQSxLQUFJLGFBQWEsYUFBYTtBQUFFLGtCQUFNLElBQUksQ0FBQztBQUFHLG1CQUFPO0FBQUEsVUFBSztBQUM1RSxtQkFBUyxLQUFLLFNBQVMsSUFBSSxLQUFNLE9BQU9BLEtBQUksYUFBYSxhQUFjLEtBQUssS0FDeEUsS0FBSyxVQUFVLEtBQUssSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDO0FBQzNDLGlCQUFPO0FBQUEsUUFDVDtBQUNBLFlBQUssT0FBT0EsS0FBSSxhQUFhLGlCQUN4QkQsU0FBUUMsS0FBSSxTQUFTRCxTQUFRQyxLQUFJLFFBQVE7QUFDNUMsbUJBQVMsS0FBSyxTQUFTLElBQUksS0FBS0QsU0FBUUMsS0FBSSxRQUFRLElBQUksTUFBTSxLQUFLLFVBQy9ELEtBQUssSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDO0FBQzVCLGlCQUFPO0FBQUEsUUFDVDtBQUNBLFlBQUlELFNBQVFDLEtBQUksVUFBVTtBQUFFLG1CQUFTLEtBQUssU0FBUyxJQUFJLElBQUksS0FBSyxLQUFLLElBQUksS0FBSyxRQUFRLENBQUMsQ0FBQztBQUFHLGlCQUFPO0FBQUEsUUFBSztBQUN2RyxZQUFJRCxTQUFRQyxLQUFJLFFBQVE7QUFBRSxtQkFBUyxLQUFLLFNBQVMsSUFBSSxJQUFJLElBQUksS0FBSyxVQUFVLEtBQUssSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDO0FBQUcsaUJBQU87QUFBQSxRQUFLO0FBQ25ILFlBQUlELFNBQVFDLEtBQUksWUFBWTtBQUMxQixlQUFLLFNBQVMsSUFBSSxDQUFDLEdBQUcsSUFBSTtBQUFHLGVBQUssS0FBSztBQUFHLGdCQUFNLElBQUksRUFBRTtBQUFHLGlCQUFPO0FBQUEsUUFDbEU7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUFBLE1BQ0EsK0JBQUMsU0FBSSxPQUFNLGtCQUFpQixhQUFhQyxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQzFFO0FBQUEsNkJBQUMsU0FBSSxPQUFNLFNBQVEsU0FBUyxJQUMxQjtBQUFBLDBCQUFBSixLQUFDLFdBQU0sVUFBUyxtQ0FBa0M7QUFBQSxVQUNsRCxxQkFBQyxhQUFRLFNBQU8sTUFDZDtBQUFBLDRCQUFBQTtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNDLFNBQU87QUFBQSxnQkFDUCxPQUFPLENBQUMsU0FBYztBQUFFLHVCQUFLLG9CQUFvQixDQUFDO0FBQUcsdUJBQUssZ0JBQWdCLENBQUM7QUFBQSxnQkFBRTtBQUFBLGdCQUM3RSxNQUFNLEtBQUssS0FBSztBQUFBLGdCQUNoQixjQUFjLE9BQUs7QUFBRSx3QkFBTSxJQUFJLEVBQUUsSUFBSTtBQUFHLDJCQUFTLElBQUksQ0FBQztBQUFBLGdCQUFFO0FBQUE7QUFBQSxZQUFHO0FBQUEsWUFHN0QsZ0JBQUFBO0FBQUEsY0FBQztBQUFBO0FBQUEsZ0JBQU0sTUFBSztBQUFBLGdCQUFVLE9BQU07QUFBQSxnQkFBZSxRQUFRSSxLQUFJLE1BQU07QUFBQSxnQkFDM0QsUUFBUUEsS0FBSSxNQUFNO0FBQUEsZ0JBQVEsV0FBVztBQUFBLGdCQUFHLFNBQU87QUFBQSxnQkFDL0MsU0FBUyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQUssQ0FBQyxDQUFDO0FBQUEsZ0JBQy9CLE9BQU07QUFBQTtBQUFBLFlBQXVEO0FBQUEsWUFDL0QsZ0JBQUFKO0FBQUEsY0FBQztBQUFBO0FBQUEsZ0JBQU0sTUFBSztBQUFBLGdCQUFVLE9BQU07QUFBQSxnQkFBUSxRQUFRSSxLQUFJLE1BQU07QUFBQSxnQkFDcEQsUUFBUUEsS0FBSSxNQUFNO0FBQUEsZ0JBQ2xCLE9BQU8sS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLO0FBQ3pCLHdCQUFNLElBQUksTUFBTSxJQUFJO0FBQ3BCLHlCQUFPLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBRSxZQUFZLENBQUMsS0FBSyxJQUFJLElBQUk7QUFBQSxnQkFDaEUsQ0FBQztBQUFBO0FBQUEsWUFBRztBQUFBLGFBQ1I7QUFBQSxVQUNBLGdCQUFBSixLQUFDLFdBQU0sT0FBTSxPQUFNLE9BQU0sU0FBUSxRQUFRSSxLQUFJLE1BQU0sUUFBUTtBQUFBLFdBQzdEO0FBQUEsUUFHQSxnQkFBQUosS0FBQyxjQUFTLGFBQWEsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLENBQUMsRUFBRSxLQUFLLENBQUMsR0FDbEQsK0JBQUMsU0FBSSxhQUFhSSxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ25EO0FBQUEsMEJBQUFKLEtBQUMsU0FBSSxPQUFNLFNBQVEsUUFBUUksS0FBSSxNQUFNLFFBQVEsU0FBUyxHQUNuRCxvQkFBVSxJQUFJLEVBQUUsSUFBSSxPQUNuQixnQkFBQUosS0FBQyxZQUFPLE9BQU0sUUFBTyxXQUFXLE1BQU07QUFBRSxjQUFFLE9BQU87QUFBRyx3QkFBSSxXQUFXLFVBQVUsR0FBRyxLQUFLO0FBQUEsVUFBRSxHQUNyRiwrQkFBQyxTQUFJLGFBQWFJLEtBQUksWUFBWSxVQUFVLFNBQVMsR0FBRyxRQUFRQSxLQUFJLE1BQU0sUUFDeEU7QUFBQSw0QkFBQUo7QUFBQSxjQUFDO0FBQUE7QUFBQSxnQkFBTSxPQUFNO0FBQUEsZ0JBQVksVUFBVSxFQUFFO0FBQUEsZ0JBQVUsV0FBVztBQUFBLGdCQUN4RCxRQUFRSSxLQUFJLE1BQU07QUFBQSxnQkFBUSxRQUFRQSxLQUFJLE1BQU07QUFBQTtBQUFBLFlBQVE7QUFBQSxZQUN0RCxnQkFBQUo7QUFBQSxjQUFDO0FBQUE7QUFBQSxnQkFBTSxPQUFPLEVBQUU7QUFBQSxnQkFBTSxRQUFRSSxLQUFJLE1BQU07QUFBQSxnQkFDdEMsV0FBVztBQUFBLGdCQUFHLGVBQWU7QUFBQTtBQUFBLFlBQUc7QUFBQSxhQUNwQyxHQUNGLENBQVMsR0FDYjtBQUFBLFVBRUEscUJBQUMsU0FBSSxPQUFNLFlBQVcsU0FBUyxHQUFHLGFBQVcsTUFFM0M7QUFBQTtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUFJLE9BQU07QUFBQSxnQkFBWSxTQUFPO0FBQUEsZ0JBQUMsYUFBYUEsS0FBSSxZQUFZO0FBQUEsZ0JBQVUsU0FBUztBQUFBLGdCQUM3RSxRQUFRQSxLQUFJLE1BQU07QUFBQSxnQkFDbEI7QUFBQSxrQ0FBQUosS0FBQyxXQUFNLE9BQU0sTUFBSyxRQUFRSSxLQUFJLE1BQU0sT0FBTyxPQUFPLGVBQWUsR0FBRztBQUFBLGtCQUNwRSxnQkFBQUosS0FBQyxXQUFNLE9BQU0sUUFBTyxRQUFRSSxLQUFJLE1BQU0sT0FBTyxPQUFPLGdCQUFnQixHQUFHO0FBQUE7QUFBQTtBQUFBLFlBQ3pFO0FBQUEsWUFFQSxxQkFBQyxTQUFJLE9BQU0sY0FBYSxTQUFPLE1BQUMsU0FBUyxJQUN2QztBQUFBLDhCQUFBSixLQUFDLFNBQUksT0FBTSxTQUFRLFFBQVFJLEtBQUksTUFBTSxRQUNuQywwQkFBQUo7QUFBQSxnQkFBQztBQUFBO0FBQUEsa0JBQU0sVUFBUztBQUFBLGtCQUNkLFFBQVFJLEtBQUksTUFBTTtBQUFBLGtCQUFRLFFBQVFBLEtBQUksTUFBTTtBQUFBO0FBQUEsY0FBUSxHQUN4RDtBQUFBLGNBQ0E7QUFBQSxnQkFBQztBQUFBO0FBQUEsa0JBQUksT0FBTTtBQUFBLGtCQUFNLFNBQU87QUFBQSxrQkFBQyxhQUFhQSxLQUFJLFlBQVk7QUFBQSxrQkFDcEQsUUFBUUEsS0FBSSxNQUFNO0FBQUEsa0JBQ2xCO0FBQUEsb0NBQUFKLEtBQUMsV0FBTSxPQUFNLFVBQVMsUUFBUUksS0FBSSxNQUFNLE9BQU8sV0FBVyxHQUFHLE9BQU8sRUFBRSxNQUFNLE9BQU87QUFBQSxvQkFDbkYsZ0JBQUFKLEtBQUMsV0FBTSxPQUFNLFFBQU8sUUFBUUksS0FBSSxNQUFNLE9BQU8sV0FBVyxHQUFHLE9BQU8sRUFBRSxNQUFNLFFBQVE7QUFBQTtBQUFBO0FBQUEsY0FDcEY7QUFBQSxjQUNBLGdCQUFBSjtBQUFBLGdCQUFDO0FBQUE7QUFBQSxrQkFBTyxPQUFNO0FBQUEsa0JBQVksUUFBUUksS0FBSSxNQUFNO0FBQUEsa0JBQzFDLFdBQVcsTUFBTSxVQUFVLHNCQUFzQjtBQUFBLGtCQUNqRCwwQkFBQUosS0FBQyxXQUFNLFVBQVMsdUJBQXNCO0FBQUE7QUFBQSxjQUN4QztBQUFBLGVBQ0Y7QUFBQSxhQUNGO0FBQUEsV0FDRixHQUNGO0FBQUEsUUFHQSxnQkFBQUEsS0FBQyxTQUFJLE9BQU0sU0FBUSxhQUFhSSxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ2hFLG1CQUFTLEdBQUcsVUFBUSxLQUFLLFFBQVEsU0FBTztBQUFBLFVBQ3ZDLGdCQUFBSixLQUFDLFdBQU0sT0FBTSxPQUFNLFFBQVFJLEtBQUksTUFBTSxPQUFPLE9BQU8sSUFBSSxTQUFTO0FBQUEsVUFDaEUsR0FBRyxJQUFJLEtBQUssSUFBSSxPQUFLO0FBQ25CLGtCQUFNLFVBQVUsS0FBSyxRQUFRLE9BQUssRUFBRSxJQUFJLEVBQUUsUUFBUSxDQUFDO0FBQ25ELG1CQUFPLGdCQUFBSjtBQUFBLGNBQUM7QUFBQTtBQUFBLGdCQUNOLE9BQU8sS0FBSyxRQUFRLEVBQUUsR0FBRyxPQUFLLE1BQU0sVUFBVSxZQUFZLEtBQUs7QUFBQSxnQkFDL0QsV0FBVyxNQUFNO0FBQUUsb0JBQUUsSUFBSTtBQUFHLDhCQUFJLFdBQVcsVUFBVSxHQUFHLEtBQUs7QUFBQSxnQkFBRTtBQUFBLGdCQUMvRCwrQkFBQyxTQUFJLFNBQVMsSUFFWjtBQUFBLGtDQUFBQSxLQUFDLFNBQUksT0FBTSxNQUFLLFFBQVFJLEtBQUksTUFBTSxRQUNoQywwQkFBQUosS0FBQyxXQUFNLFVBQVUsRUFBRSxNQUFNLFdBQVcsSUFBSSxHQUMxQztBQUFBLGtCQUNBLGdCQUFBQSxLQUFDLFdBQU0sV0FBUyxNQUFDLE9BQU8sRUFBRSxRQUFRO0FBQUEsa0JBQ2xDLGdCQUFBQTtBQUFBLG9CQUFDO0FBQUE7QUFBQSxzQkFBTSxPQUFNO0FBQUEsc0JBQU8sU0FBTztBQUFBLHNCQUFDLFFBQVFJLEtBQUksTUFBTTtBQUFBLHNCQUM1QyxXQUFXO0FBQUEsc0JBQUcsT0FBTyxFQUFFO0FBQUE7QUFBQSxrQkFBTTtBQUFBLGtCQUMvQixnQkFBQUo7QUFBQSxvQkFBQztBQUFBO0FBQUEsc0JBQU0sT0FBTTtBQUFBLHNCQUFPLE9BQU07QUFBQSxzQkFDeEIsU0FBUyxLQUFLLFFBQVEsRUFBRSxHQUFHLE9BQUssTUFBTSxPQUFPO0FBQUE7QUFBQSxrQkFBRztBQUFBLG1CQUNwRDtBQUFBO0FBQUEsWUFDRjtBQUFBLFVBQ0YsQ0FBQztBQUFBLFFBQ0gsQ0FBQyxDQUFDLEdBQ0o7QUFBQSxRQUdBLHFCQUFDLFNBQUksT0FBTSxTQUNUO0FBQUEsK0JBQUMsU0FBSSxTQUFTLElBQUksU0FBTyxNQUFDLFFBQVFJLEtBQUksTUFBTSxPQUMxQztBQUFBLDRCQUFBSixLQUFDLFdBQU0sV0FBUyxNQUFDLE9BQU0sOEJBQTZCO0FBQUEsWUFDcEQsZ0JBQUFBLEtBQUMsV0FBTSxXQUFTLE1BQUMsT0FBTSxzQkFBcUI7QUFBQSxZQUM1QyxnQkFBQUEsS0FBQyxXQUFNLFdBQVMsTUFBQyxPQUFNLGdDQUErQjtBQUFBLGFBQ3hEO0FBQUEsVUFDQSxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sdUNBQW9CLFFBQVFJLEtBQUksTUFBTSxLQUFLO0FBQUEsV0FDMUQ7QUFBQSxTQUNGO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7OztBRzlSQSxPQUFPQyxjQUFhO0FBQ3BCLE9BQU8sZUFBZTtBQUN0QixPQUFPQyxTQUFROzs7QUNKZixPQUFPQyxjQUFhO0FBQ3BCLE9BQU9DLFVBQVM7QUFFVCxJQUFNLGFBQWFELFNBQVEsY0FBYztBQUFBLEVBQzlDLFdBQVc7QUFDYixHQUFHLE1BQU1FLG9CQUFtQkQsS0FBSSxNQUFNO0FBQUEsRUFDcEMsWUFBWSxRQUFtRTtBQUM3RSxVQUFNLEVBQUUsT0FBTyxHQUFHLEtBQUssSUFBSyxVQUFVLENBQUM7QUFDdkMsVUFBTTtBQUFBLE1BQ0osYUFBYUEsS0FBSSxZQUFZO0FBQUEsTUFDN0IsWUFBWSxJQUFJQSxLQUFJLFdBQVc7QUFBQSxRQUM3QixPQUFPO0FBQUEsUUFBRyxPQUFPO0FBQUEsUUFDakIsZ0JBQWdCO0FBQUEsUUFBTSxnQkFBZ0I7QUFBQSxRQUFLLFdBQVc7QUFBQSxRQUN0RCxPQUFPLFNBQVM7QUFBQSxNQUNsQixDQUFDO0FBQUEsTUFDRCxZQUFZO0FBQUEsTUFDWixHQUFHO0FBQUEsSUFDTCxDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsY0FBYyxhQUE4QixVQUFvRDtBQUM5RixRQUFJLGdCQUFnQkEsS0FBSSxZQUFZLFlBQVk7QUFJOUMsYUFBTyxDQUFDLEdBQUcsR0FBRyxJQUFJLEVBQUU7QUFBQSxJQUN0QjtBQUNBLFdBQU8sTUFBTSxjQUFjLGFBQWEsUUFBUTtBQUFBLEVBQ2xEO0FBQ0YsQ0FBQzs7O0FEZEQsSUFBTSxRQUFRLFNBQWlCRSxTQUFLLE9BQU8sYUFBYSxLQUFlLElBQUk7QUFHM0UsSUFBTUMsU0FBUSxHQUFHRCxTQUFLLG1CQUFtQixDQUFDO0FBQzFDLElBQUksUUFBa0IsQ0FBQyxRQUFRLE1BQU0sUUFBUSxRQUFRLFVBQVUsU0FBUyxVQUFVLFlBQVk7QUFDOUYsSUFBSTtBQUFFLFVBQVEsS0FBSyxNQUFNLElBQUksWUFBWSxFQUFFLE9BQU9BLFNBQUssa0JBQWtCQyxNQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFBRSxRQUFRO0FBQUU7QUFFL0YsU0FBUyxLQUFLLE9BR1g7QUFDRCxTQUFPLHFCQUFDLFNBQUksT0FBTyxLQUFLLE1BQU0sTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFlLElBQUksaUJBQWlCLFdBQVcsR0FDdkY7QUFBQSxvQkFBQUMsS0FBQyxZQUFPLE9BQU0sU0FBUSxTQUFTLE1BQU0sV0FBVyxNQUFNLFdBQ3BELCtCQUFDLFNBQUksU0FBUyxHQUNaO0FBQUEsc0JBQUFBLEtBQUMsV0FBTSxVQUFVLE1BQU0sTUFBTTtBQUFBLE1BQzdCLHFCQUFDLFNBQUksYUFBYUMsS0FBSSxZQUFZLFVBQVUsUUFBUUEsS0FBSSxNQUFNLFFBQzVEO0FBQUEsd0JBQUFELEtBQUMsV0FBTSxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFPLE1BQU0sT0FBTztBQUFBLFFBQ25ELE1BQU0sT0FBTyxnQkFBQUQ7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFNLE9BQU07QUFBQSxZQUFNLFFBQVFDLEtBQUksTUFBTTtBQUFBLFlBQ2pELFdBQVc7QUFBQSxZQUFHLE9BQU8sTUFBTTtBQUFBO0FBQUEsUUFBSztBQUFBLFNBQ3BDO0FBQUEsT0FDRixHQUNGO0FBQUEsSUFFQyxNQUFNLFdBQ0wsZ0JBQUFELEtBQUMsWUFBTyxPQUFNLFFBQU8sU0FBUyxPQUFPLGNBQWMsSUFBSSxXQUFXLE1BQU0sU0FDdEUsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLGdDQUErQixHQUNqRDtBQUFBLEtBQ0o7QUFDRjtBQUVBLFNBQVMsVUFBVTtBQUNqQixRQUFNLFVBQVVFLElBQUcsWUFBWSxHQUFHLG1CQUFtQjtBQUdyRCxNQUFJLENBQUMsV0FBVyxDQUFDLEtBQU0sUUFBTyxnQkFBQUYsS0FBQyxTQUFJO0FBQ25DLFFBQU0sVUFBVSxVQUNaLEtBQUssU0FBUyxhQUFhLEVBQUUsR0FBRyxPQUFLLEtBQUssNkJBQTZCLElBQ3ZFO0FBQ0osUUFBTSxXQUFnQixPQUFPLEVBQUUsU0FBUyxLQUFLLFNBQVUsUUFBUTtBQUkvRCxRQUFNLFVBQVUsT0FBTyxFQUFFLFNBQVUsU0FBUyxVQUFVO0FBQ3RELFFBQU0sWUFBWSxJQUFJLFdBQVcsRUFBRSxTQUFTLE1BQU0sWUFBWSxDQUFDLFFBQVEsR0FBRyxPQUFPLFFBQVEsQ0FBQztBQUMxRixNQUFJLENBQUMsUUFBUSxRQUFTLE1BQUssU0FBUyxRQUFRLEVBQUUsVUFBVSxDQUFDLE1BQWM7QUFBRSxjQUFVLGVBQWUsRUFBRSxRQUFRO0FBQUEsRUFBRSxDQUFDO0FBRS9HLFlBQVUsUUFBUSxnQkFBZ0IsQ0FBQyxJQUFTLElBQVMsTUFBYztBQUFFLFFBQUksUUFBUyxTQUFRLFNBQVM7QUFBQSxFQUFFLENBQUM7QUFFdEcsUUFBTSxlQUFlLElBQUksV0FBVyxFQUFFLFNBQVMsTUFBTSxZQUFZLENBQUMsUUFBUSxHQUFHLE9BQU8sT0FBTyxFQUFFLGFBQWEsSUFBSSxDQUFDO0FBQy9HLGVBQWEsUUFBUSxnQkFBZ0IsQ0FBQyxJQUFTLElBQVMsTUFDdEQsVUFBVSxxQkFBcUIsS0FBSyxNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUV4RCxTQUFPLHFCQUFDLFNBQUksT0FBTSxXQUFVLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQVMsR0FDMUU7QUFBQSx5QkFBQyxTQUFJLE9BQU0sUUFBTyxTQUFTLEdBQ3pCO0FBQUEsc0JBQUFELEtBQUMsV0FBTSxVQUFVLFNBQVM7QUFBQSxNQUN6QjtBQUFBLE1BQ0QsZ0JBQUFBLEtBQUMsWUFBTyxPQUFNLFFBQU8sY0FBYyxJQUFJLFdBQVcsTUFBTSxNQUFNLElBQUksS0FBSyxHQUNyRSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsZ0NBQStCLEdBQ2pEO0FBQUEsT0FDRjtBQUFBLElBQ0EscUJBQUMsU0FBSSxPQUFNLFFBQU8sU0FBUyxHQUN6QjtBQUFBLHNCQUFBQSxLQUFDLFdBQU0sVUFBUyw2QkFBNEI7QUFBQSxNQUMzQztBQUFBLE1BRUQsZ0JBQUFBLEtBQUMsU0FBSSxjQUFjLElBQUk7QUFBQSxPQUN6QjtBQUFBLEtBQ0Y7QUFDRjtBQUVBLFNBQVMsZ0JBQWdCO0FBQ3ZCLFNBQU8scUJBQUMsU0FBSSxPQUFNLFdBQVUsU0FBUyxPQUFPLFFBQVEsS0FBSyxTQUFTLEVBQUUsR0FBRyxPQUFLLENBQUMsQ0FBQyxHQUFHLFNBQVMsSUFDeEY7QUFBQSxvQkFBQUEsS0FBQyxXQUFNLFVBQVMsMEJBQXlCO0FBQUEsSUFDekMscUJBQUMsU0FBSSxhQUFhQyxLQUFJLFlBQVksVUFBVSxTQUFPLE1BQ2pEO0FBQUEsc0JBQUFELEtBQUMsV0FBTSxPQUFNLEtBQUksUUFBUUMsS0FBSSxNQUFNLE9BQU8sT0FBTSxrQ0FBaUM7QUFBQSxNQUNqRixnQkFBQUQsS0FBQyxXQUFNLE9BQU0sS0FBSSxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFNLHFDQUFvQztBQUFBLE9BQ3RGO0FBQUEsSUFDQSxnQkFBQUQsS0FBQyxZQUFPLE9BQU0sUUFBTyxPQUFNLGFBQVksV0FBVyxNQUFNLE9BQU8sRUFBRSxNQUFNLE1BQU07QUFBQSxJQUFFLENBQUMsR0FBRztBQUFBLEtBQ3JGO0FBQ0Y7QUFHQSxJQUFNLFFBQVEsU0FBUyxLQUFLO0FBQTVCLElBQStCLFFBQVEsU0FBUyxJQUFJO0FBQXBELElBQXVELFVBQVUsU0FBUyxLQUFLO0FBQS9FLElBQWtGLFNBQVMsU0FBUyxLQUFLO0FBRXpHLElBQU0sV0FBVyxTQUFTLEtBQUs7QUFJL0IsU0FBUyxXQUFXLE9BQThEO0FBQ2hGLFNBQU8sZ0JBQUFBO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFBSyxJQUFJLE1BQU07QUFBQSxNQUFPLE9BQU8sTUFBTTtBQUFBLE1BQU8sTUFBTSxNQUFNO0FBQUEsTUFDNUQsUUFBUSxLQUFLLE1BQU0sQ0FBQztBQUFBLE1BQ3BCLFdBQVcsTUFBTSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFBQTtBQUFBLEVBQUc7QUFDbEQ7QUFFQSxTQUFTLEtBQUssRUFBRSxLQUFLLEdBQXNCO0FBQ3pDLFFBQU0sTUFBTUcsU0FBUSxZQUFZO0FBQ2hDLFFBQU0sS0FBSyxVQUFVLFlBQVk7QUFHakMsU0FBTyxxQkFBQyxTQUFJLE1BQVksYUFBYUYsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUV0RTtBQUFBLHlCQUFDLFNBQUksT0FBTSxVQUFTLFNBQVMsR0FFM0I7QUFBQSwyQkFBQyxTQUFJLE9BQU0sUUFBTyxTQUFTLEdBQUcsUUFBUUEsS0FBSSxNQUFNLFFBQzlDO0FBQUEsd0JBQUFELEtBQUMsV0FBTSxVQUFTLDBCQUF5QjtBQUFBLFFBQ3pDLGdCQUFBQSxLQUFDLFdBQU0sT0FBTSxNQUFLLE9BQU8sT0FBTyxFQUFFLE9BQU8sMkJBQXdCO0FBQUEsU0FDbkU7QUFBQSxNQUNBLGdCQUFBQSxLQUFDLFNBQUksU0FBTyxNQUFDO0FBQUEsTUFDYixnQkFBQUEsS0FBQyxZQUFPLE9BQU0sYUFBWSxXQUFXLE1BQU0sT0FBTyxHQUFHLDBCQUFBQSxLQUFDLFdBQU0sVUFBUyx1QkFBc0IsR0FBRTtBQUFBLE1BQzdGLGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxRQUFPLFdBQVcsTUFBTSxVQUFVLHVCQUF1QixHQUNyRSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsdUJBQXNCLEdBQUU7QUFBQSxNQUMxQyxnQkFBQUEsS0FBQyxZQUFPLE9BQU0sUUFBTyxXQUFXLE1BQU0sU0FBUyxJQUFJLENBQUMsU0FBUyxJQUFJLENBQUMsR0FDaEUsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLHlCQUF3QixHQUFFO0FBQUEsTUFDNUMsZ0JBQUFBLEtBQUMsWUFBTyxPQUFNLGVBQWMsV0FBVyxNQUFNLFlBQUksY0FBYyxTQUFTLEdBQ3RFLDBCQUFBQSxLQUFDLFdBQU0sVUFBUyx3QkFBdUIsR0FBRTtBQUFBLE9BQzdDO0FBQUEsSUFDQSxnQkFBQUEsS0FBQyxpQkFBYztBQUFBLElBRWYscUJBQUMsU0FBSSxPQUFNLGFBQVksYUFBYUMsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUNyRTtBQUFBLDJCQUFDLFNBQUksT0FBTSxTQUFRLGFBQVcsTUFBQyxTQUFTLEdBQ3BDO0FBQUEsaUJBQVEsSUFBSSxTQUFTLGdCQUFBRDtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQUssSUFBRztBQUFBLFlBQU8sT0FBTTtBQUFBLFlBQVEsTUFBSztBQUFBLFlBQ3hELFFBQVEsT0FBTyxTQUFTLElBQUksSUFBSSxLQUFLLElBQUksTUFBTyxTQUFTO0FBQUEsWUFDekQsS0FBSyxPQUFPLEVBQUUsV0FBVyxLQUFLLElBQUksTUFBTyxNQUFNLEVBQUUsR0FBRyxPQUFLLEtBQUssS0FBSztBQUFBLFlBQ25FLFdBQVcsTUFBTTtBQUFFLGtCQUFJLENBQUMsUUFBUSxJQUFJLEtBQU0sS0FBSSxLQUFLLFVBQVUsQ0FBQyxJQUFJLEtBQUs7QUFBQSxZQUFRO0FBQUEsWUFDL0UsU0FBUyxNQUFNLE1BQU0sSUFBSSxNQUFNO0FBQUE7QUFBQSxRQUFHO0FBQUEsUUFDcEMsZ0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBSyxJQUFHO0FBQUEsWUFBSyxPQUFNO0FBQUEsWUFBWSxNQUFLO0FBQUEsWUFDbkMsUUFBUSxPQUFPLFNBQVMsSUFBSSxJQUFJLEtBQUssSUFBSSxTQUFTLEVBQUUsR0FBRyxPQUFLLEVBQUUsS0FBSyxPQUFLLEVBQUUsU0FBUyxDQUFDO0FBQUEsWUFDcEYsS0FBSyxPQUFPLEVBQUUsV0FBVyxLQUFLLElBQUksU0FBUyxFQUFFLEdBQUcsT0FDOUMsRUFBRSxLQUFLLE9BQUssRUFBRSxTQUFTLEdBQUcsU0FBUyxLQUFLO0FBQUEsWUFDMUMsV0FBVyxNQUFNO0FBQUUsa0JBQUksQ0FBQyxLQUFNLElBQUcsT0FBTztBQUFBLFlBQUU7QUFBQSxZQUMxQyxTQUFTLE1BQU0sTUFBTSxJQUFJLElBQUk7QUFBQTtBQUFBLFFBQUc7QUFBQSxTQUNwQztBQUFBLE1BQ0EscUJBQUMsU0FBSSxPQUFNLFNBQVEsYUFBVyxNQUFDLFNBQVMsR0FDdEM7QUFBQSx3QkFBQUEsS0FBQyxjQUFXLE9BQU0sZUFBYyxNQUFLLHVCQUFzQixHQUFHLE9BQU87QUFBQSxRQUNyRSxnQkFBQUEsS0FBQyxjQUFXLE9BQU0sY0FBYSxNQUFLLHVCQUFzQixHQUFHLE9BQU87QUFBQSxTQUN0RTtBQUFBLE1BQ0EscUJBQUMsU0FBSSxPQUFNLFNBQVEsYUFBVyxNQUFDLFNBQVMsR0FDdEM7QUFBQSx3QkFBQUEsS0FBQyxjQUFXLE9BQU0sVUFBUyxNQUFLLDZCQUE0QixHQUFHLFNBQVM7QUFBQSxRQUN4RSxnQkFBQUEsS0FBQyxjQUFXLE9BQU0sZUFBYyxNQUFLLHNCQUFxQixHQUFHLFFBQVE7QUFBQSxTQUN2RTtBQUFBLE9BQ0Y7QUFBQSxJQUNBLGdCQUFBQSxLQUFDLFdBQVE7QUFBQSxLQUNYO0FBQ0Y7QUFHQSxTQUFTLFNBQVMsVUFBMEI7QUFDMUMsU0FBTztBQUNUO0FBR0EsU0FBUyxXQUFXO0FBQ2xCLFFBQU0sT0FBT0csU0FBUSxZQUFZLEVBQUU7QUFDbkMsTUFBSSxDQUFDLEtBQU0sUUFBTyxnQkFBQUgsS0FBQyxTQUFJO0FBQ3ZCLFNBQU8sZ0JBQUFBLEtBQUMsU0FBSSxPQUFNLFNBQVEsYUFBYUMsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUN2RSxlQUFLLE1BQU0sY0FBYyxFQUFFLEdBQUcsU0FBTztBQUNwQyxVQUFNLFNBQVMsS0FBSztBQUNwQixVQUFNLE9BQU8sb0JBQUksSUFBWTtBQUM3QixXQUFPLElBQ0osT0FBTyxRQUFNLEdBQUcsUUFBUSxDQUFDLEtBQUssSUFBSSxHQUFHLElBQUksS0FBSyxLQUFLLElBQUksR0FBRyxJQUFJLENBQUMsRUFDL0QsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQ3RDLE1BQU0sR0FBRyxDQUFDLEVBQ1YsSUFBSSxRQUFNO0FBQ1QsWUFBTSxLQUFLLFVBQVUsR0FBRyxTQUFTLE9BQU87QUFDeEMsYUFBTyxnQkFBQUQ7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUFPLE9BQU8sS0FBSyxnQkFBZ0I7QUFBQSxVQUN6QyxXQUFXLE1BQU0sS0FBSyxvQkFBb0IsSUFBSSxJQUFJO0FBQUEsVUFDbEQsK0JBQUMsU0FBSSxTQUFTLElBQ1o7QUFBQSw0QkFBQUEsS0FBQyxXQUFNLFVBQVUsU0FBUyxHQUFHLFFBQVEsR0FBRztBQUFBLFlBQ3hDLGdCQUFBQSxLQUFDLFdBQU0sU0FBTyxNQUFDLFFBQVFDLEtBQUksTUFBTSxPQUFPLE9BQU8sR0FBRyxNQUFNO0FBQUEsWUFDeEQsZ0JBQUFELEtBQUMsV0FBTSxPQUFNLE1BQUssT0FBTyxLQUFLLGNBQWMsR0FBRyxHQUFHLFFBQVEsS0FBSztBQUFBLGFBQ2pFO0FBQUE7QUFBQSxNQUNGO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDTCxDQUFDLEdBQ0g7QUFDRjtBQUdBLFNBQVMsU0FBUztBQUNoQixRQUFNLEtBQUssVUFBVSxZQUFZO0FBQ2pDLFNBQU8sZ0JBQUFBLEtBQUMsU0FBSSxPQUFNLFNBQVEsYUFBYUMsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUN2RSxlQUFLLElBQUksU0FBUyxFQUFFLEdBQUcsYUFBVyxRQUNoQyxPQUFPLE9BQUssRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUM3QixLQUFLLENBQUMsR0FBRyxNQUFNLE9BQU8sRUFBRSxTQUFTLElBQUksT0FBTyxFQUFFLFNBQVMsQ0FBQyxFQUN4RCxNQUFNLEdBQUcsQ0FBQyxFQUNWLElBQUksU0FBTztBQUNWLFVBQU0sS0FBSyxJQUFJO0FBQ2YsV0FBTyxnQkFBQUQ7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUFPLE9BQU8sS0FBSyxnQkFBZ0I7QUFBQSxRQUN6QyxXQUFXLE1BQU0sS0FBSyxJQUFJLGtCQUFrQixJQUFJLElBQUksZUFBZTtBQUFBLFFBQ25FLCtCQUFDLFNBQUksU0FBUyxJQUNaO0FBQUEsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLDRCQUEyQjtBQUFBLFVBQzNDLGdCQUFBQSxLQUFDLFdBQU0sU0FBTyxNQUFDLFFBQVFDLEtBQUksTUFBTSxPQUFPLE9BQU8sSUFBSSxTQUFTLElBQUksTUFBTTtBQUFBLFVBQ3RFLGdCQUFBRCxLQUFDLFdBQU0sT0FBTSxNQUFLLE9BQU8sS0FBSyxjQUFjLElBQUksU0FBUyxXQUFXLGFBQWE7QUFBQSxXQUNuRjtBQUFBO0FBQUEsSUFDRjtBQUFBLEVBQ0YsQ0FBQyxDQUFDLEdBQ047QUFDRjtBQUdBLFNBQVMsT0FBTyxPQUFxRDtBQUNuRSxTQUFPLHFCQUFDLFNBQUksT0FBTSxVQUFTLFNBQVMsSUFDbEM7QUFBQSxvQkFBQUEsS0FBQyxTQUFJLE9BQU0sTUFBSyxRQUFRQyxLQUFJLE1BQU0sUUFDaEMsMEJBQUFELEtBQUMsV0FBTSxVQUFVLE1BQU0sTUFBTSxHQUFFO0FBQUEsSUFDakMsZ0JBQUFBO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFBTSxPQUFNO0FBQUEsUUFBUSxRQUFRQyxLQUFJLE1BQU07QUFBQSxRQUFRLFFBQVFBLEtBQUksTUFBTTtBQUFBLFFBQy9ELFdBQVc7QUFBQSxRQUFHLE9BQU8sTUFBTTtBQUFBO0FBQUEsSUFBTztBQUFBLElBQ3BDLGdCQUFBRDtBQUFBLE1BQUM7QUFBQTtBQUFBLFFBQU8sT0FBTTtBQUFBLFFBQVMsU0FBTztBQUFBLFFBQUMsUUFBUUMsS0FBSSxNQUFNO0FBQUEsUUFDL0MsT0FBTyxLQUFLLE1BQU0sUUFBUSxRQUFRO0FBQUEsUUFDbEMsZUFBZSxDQUFDLElBQUksTUFBTTtBQUFFLGdCQUFNLE9BQU8sU0FBUztBQUFBLFFBQUU7QUFBQTtBQUFBLElBQUc7QUFBQSxLQUMzRDtBQUNGO0FBR0EsU0FBUyxVQUFVO0FBQ2pCLFFBQU0sS0FBS0MsSUFBRyxZQUFZO0FBQzFCLE1BQUksQ0FBQyxHQUFJLFFBQU8sZ0JBQUFGLEtBQUMsU0FBSTtBQUNyQixRQUFNLFVBQVUsR0FBRztBQUNuQixTQUFPLHFCQUFDLFNBQUksT0FBTSxTQUFRLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQVMsR0FDdkU7QUFBQSxlQUFXLGdCQUFBRCxLQUFDLFVBQU8sTUFBSywrQkFBOEIsT0FBTSxVQUFTLFFBQVEsU0FBUztBQUFBLElBQ3RGLEtBQUssR0FBRyxPQUFPLFNBQVMsRUFBRSxHQUFHLGFBQVcsUUFBUSxNQUFNLEdBQUcsQ0FBQyxFQUFFLElBQUksT0FDL0QsZ0JBQUFBO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFBTyxNQUFLO0FBQUEsUUFDWCxPQUFPLEVBQUUsZUFBZSxFQUFFLFFBQVE7QUFBQSxRQUFlLFFBQVE7QUFBQTtBQUFBLElBQUcsQ0FBRSxDQUFDO0FBQUEsS0FDckU7QUFDRjtBQUVBLFNBQVMsVUFBVSxFQUFFLEtBQUssR0FBc0I7QUFDOUMsUUFBTSxNQUFNRyxTQUFRLFlBQVk7QUFDaEMsU0FBTyxxQkFBQyxTQUFJLE1BQVksYUFBYUYsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUN0RTtBQUFBLHlCQUFDLGVBQVUsT0FBTSxTQUNmO0FBQUEsc0JBQUFELEtBQUMsWUFBTyxPQUFNLFFBQU8sV0FBVyxNQUFNLE1BQU0sSUFBSSxJQUFJLEdBQ2xELDBCQUFBQSxLQUFDLFdBQU0sVUFBUywrQkFBOEIsR0FBRTtBQUFBLE1BQ2xELGdCQUFBQSxLQUFDLFdBQU0sT0FBTyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQzNCLE1BQU0sU0FBUyxVQUFVLE1BQU0sT0FBTyxjQUFjLFFBQVEsR0FBRztBQUFBLE1BQ2pFLHFCQUFDLFNBQUksY0FBYyxJQUFJLFFBQVFDLEtBQUksTUFBTSxLQUN0QztBQUFBLFlBQUksUUFBUSxnQkFBQUQ7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFPLFFBQVEsS0FBSyxJQUFJLE1BQU0sU0FBUztBQUFBLFlBQ25ELFNBQVMsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLE1BQU0sTUFBTTtBQUFBLFlBQ3pDLGdCQUFnQixPQUFLO0FBQUUsa0JBQUksS0FBTSxVQUFVLEVBQUU7QUFBQSxZQUFPO0FBQUE7QUFBQSxRQUFHO0FBQUEsUUFDekQsZ0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBTyxRQUFRLEtBQUssVUFBVSxZQUFZLEdBQUcsU0FBUztBQUFBLFlBQ3JELFNBQVMsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLE1BQU0sSUFBSTtBQUFBLFlBQ3ZDLGdCQUFnQixPQUFLO0FBQUUsd0JBQVUsWUFBWSxFQUFFLFFBQVEsVUFBVSxFQUFFO0FBQUEsWUFBTztBQUFBO0FBQUEsUUFBRztBQUFBLFNBQ2pGO0FBQUEsT0FDRjtBQUFBLElBQ0MsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUNkLE1BQU0sU0FBUyxnQkFBQUEsS0FBQyxZQUFTLElBQUssTUFBTSxPQUFPLGdCQUFBQSxLQUFDLFVBQU8sSUFDbkQsTUFBTSxRQUFRLGdCQUFBQSxLQUFDLFdBQVEsSUFBSyxnQkFBQUEsS0FBQyxTQUFJLENBQUU7QUFBQSxLQUN2QztBQUNGO0FBRWUsU0FBUixnQkFBaUM7QUFDdEMsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFnQixXQUFVO0FBQUEsTUFBVyxPQUFNO0FBQUEsTUFBWSxTQUFTO0FBQUEsTUFDckUsUUFBUUksT0FBTSxhQUFhLE1BQU1BLE9BQU0sYUFBYTtBQUFBLE1BQ3BELGFBQWFBLE9BQU0sWUFBWTtBQUFBLE1BQy9CLFNBQVNBLE9BQU0sUUFBUTtBQUFBLE1BQ3ZCLGNBQWMsQ0FBQyxNQUFNQyxTQUFRO0FBQzNCLFlBQUlBLFNBQVFDLEtBQUksV0FBWSxRQUFPO0FBQ25DLFlBQUksTUFBTSxJQUFJLEdBQUc7QUFBRSxnQkFBTSxJQUFJLElBQUk7QUFBRyxpQkFBTztBQUFBLFFBQUs7QUFDaEQsYUFBSyxLQUFLO0FBQUcsZUFBTztBQUFBLE1BQ3RCO0FBQUEsTUFDQSwwQkFBQU4sS0FBQyxTQUFJLE9BQU0sWUFHVDtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQ0MsZ0JBQWdCQyxLQUFJLG9CQUFvQjtBQUFBLFVBQ3hDLG9CQUFvQjtBQUFBLFVBQ3BCLGtCQUFrQixLQUFLLEtBQUssRUFBRSxHQUFHLE9BQUssSUFBSSxVQUFVLE1BQU07QUFBQSxVQUMxRDtBQUFBLDRCQUFBRCxLQUFDLFFBQUssTUFBSyxRQUFPO0FBQUEsWUFDbEIsZ0JBQUFBLEtBQUMsYUFBVSxNQUFLLFNBQVE7QUFBQTtBQUFBO0FBQUEsTUFDMUIsR0FDRjtBQUFBO0FBQUEsRUFDRjtBQUNGOzs7QUUxUkEsT0FBT08sYUFBWTtBQUNuQixPQUFPLFdBQVc7QUFNbEIsSUFBSSxVQUFnQztBQUNwQyxJQUFNLEtBQUssTUFBTyxZQUFZQyxRQUFPLFlBQVk7QUFDakQsSUFBTSxPQUFPLE1BQU0sQ0FBQyxDQUFDQyxTQUFLLE9BQU8sbUJBQW1CO0FBQ3BELElBQU0sV0FBVztBQUdqQixJQUFNLGFBQWEsU0FBUyxLQUFLO0FBSWpDLElBQU0sVUFBVTtBQUNoQixTQUFTLEtBQUssRUFBRSxHQUFBQyxHQUFFLEdBQStCO0FBQy9DLFNBQU8scUJBQUMsU0FBSSxPQUFNLFNBQVEsU0FBUyxJQUFJLGNBQWMsU0FFbkQ7QUFBQSxvQkFBQUMsS0FBQyxTQUFJLE9BQU0sT0FBTSxRQUFRQyxLQUFJLE1BQU0sT0FDakMsMEJBQUFELEtBQUMsV0FBTSxVQUFVRCxHQUFFLFlBQVksK0JBQStCLFdBQVcsSUFBSSxHQUMvRTtBQUFBLElBQ0EscUJBQUMsU0FBSSxhQUFhRSxLQUFJLFlBQVksVUFBVSxTQUFPLE1BQ2pEO0FBQUEsMkJBQUMsU0FDQztBQUFBLHdCQUFBRCxLQUFDLFdBQU0sUUFBUUMsS0FBSSxNQUFNLE9BQU8sU0FBTyxNQUFDLFdBQVcsR0FBRyxPQUFPRixHQUFFLFNBQVM7QUFBQSxRQUN4RSxnQkFBQUMsS0FBQyxXQUFNLE9BQU0sV0FBVSxPQUFPLElBQUksS0FBS0QsR0FBRSxPQUFPLEdBQUksRUFDakQsbUJBQW1CLFNBQVMsRUFBRSxNQUFNLFdBQVcsUUFBUSxVQUFVLENBQUMsR0FBRztBQUFBLFNBQzFFO0FBQUEsTUFDQSxnQkFBQUM7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUFNLE9BQU07QUFBQSxVQUFPLFFBQVFDLEtBQUksTUFBTTtBQUFBLFVBQU8sUUFBUTtBQUFBLFVBQUcsTUFBSTtBQUFBLFVBQzFELGVBQWU7QUFBQSxVQUFJLE9BQU9GLEdBQUU7QUFBQTtBQUFBLE1BQU07QUFBQSxPQUN0QztBQUFBLElBQ0EsZ0JBQUFDLEtBQUMsWUFBTyxPQUFNLE1BQUssUUFBUUMsS0FBSSxNQUFNLE9BQU8sV0FBVyxNQUFNRixHQUFFLFFBQVEsR0FDckUsMEJBQUFDLEtBQUMsV0FBTSxVQUFTLHdCQUF1QixHQUN6QztBQUFBLEtBQ0Y7QUFDRjtBQUVPLFNBQVMsT0FBTyxTQUFzQjtBQUMzQyxNQUFJLEtBQUssRUFBRyxRQUFPO0FBSW5CLFFBQU0sT0FBTyxTQUFtQixDQUFDLENBQUM7QUFJbEMsUUFBTSxRQUFRLFNBQW1CLENBQUMsQ0FBQztBQUNuQyxRQUFNLFlBQVksTUFBTSxNQUFNLElBQUksV0FBVyxJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDO0FBQ3BFLE9BQUssVUFBVSxTQUFTO0FBQ3hCLGFBQVcsVUFBVSxTQUFTO0FBQzlCLEtBQUcsRUFBRSxRQUFRLFlBQVksQ0FBQyxJQUFJLE9BQU87QUFDbkMsUUFBSSxXQUFXLElBQUksS0FBSyxHQUFHLEVBQUUsYUFBYztBQUMzQyxTQUFLLElBQUksQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQztBQUM1QixZQUFRLFVBQVUsTUFBTSxLQUFLLElBQUksS0FBSyxJQUFJLEVBQUUsT0FBTyxPQUFLLE1BQU0sRUFBRSxDQUFDLENBQUM7QUFBQSxFQUNwRSxDQUFDO0FBQ0QsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFTLFdBQVU7QUFBQSxNQUFlLFlBQVk7QUFBQSxNQUluRCxTQUFTLEtBQUssVUFBVSxFQUFFLEdBQUcsT0FBSyxDQUFDLENBQUM7QUFBQSxNQUlwQyxXQUFXO0FBQUEsTUFBSSxhQUFhO0FBQUEsTUFDNUIsUUFBUUUsT0FBTSxhQUFhLE1BQU1BLE9BQU0sYUFBYTtBQUFBLE1BRXBELDBCQUFBRjtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQUksYUFBYUMsS0FBSSxZQUFZO0FBQUEsVUFBVSxTQUFTO0FBQUEsVUFDbkQsY0FBYyxVQUFVO0FBQUEsVUFBSSxRQUFRQSxLQUFJLE1BQU07QUFBQSxVQUM3QyxlQUFLLEtBQUssRUFBRSxHQUFHLFNBQU8sSUFBSSxJQUFJLFFBQU07QUFDbkMsa0JBQU1GLEtBQUksR0FBRyxFQUFFLGlCQUFpQixFQUFFO0FBQ2xDLG1CQUFPQSxLQUFJLGdCQUFBQyxLQUFDLFNBQUksT0FBTSxTQUFRLDBCQUFBQSxLQUFDLFFBQUssR0FBR0QsSUFBRyxHQUFFLElBQVMsZ0JBQUFDLEtBQUMsU0FBSTtBQUFBLFVBQzVELENBQUMsQ0FBQztBQUFBO0FBQUEsTUFDSjtBQUFBO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxZQUFZO0FBQ25CLE1BQUksU0FBYztBQUNsQixNQUFJO0FBQUUsYUFBUyxNQUFNLFlBQVksR0FBRyxVQUFVLENBQUMsS0FBSztBQUFBLEVBQUssUUFBUTtBQUFFLGFBQVM7QUFBQSxFQUFLO0FBQ2pGLE1BQUksQ0FBQyxPQUFRLFFBQU8sZ0JBQUFBLEtBQUMsU0FBSSxTQUFTLE9BQU87QUFDekMsU0FBTyxxQkFBQyxTQUFJLE9BQU0sZUFBYyxTQUFTLElBQ3ZDO0FBQUEsb0JBQUFBLEtBQUMsV0FBTSxXQUFXLElBQUksVUFBUyx3QkFBdUI7QUFBQSxJQUN0RCxxQkFBQyxTQUFJLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQU8sTUFBQyxRQUFRQSxLQUFJLE1BQU0sUUFDcEU7QUFBQSxzQkFBQUQsS0FBQyxXQUFNLFFBQVFDLEtBQUksTUFBTSxPQUFPLFdBQVcsR0FBRyxPQUFPLEtBQUssUUFBUSxPQUFPLEdBQUc7QUFBQSxNQUM1RSxnQkFBQUQsS0FBQyxXQUFNLE9BQU0sT0FBTSxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFPLEtBQUssUUFBUSxRQUFRLEdBQUc7QUFBQSxPQUM3RTtBQUFBLElBQ0EsZ0JBQUFELEtBQUMsWUFBTyxXQUFXLE1BQU0sT0FBTyxTQUFTLEdBQUcsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLDRCQUEyQixHQUFFO0FBQUEsSUFDekYsZ0JBQUFBLEtBQUMsWUFBTyxXQUFXLE1BQU0sT0FBTyxXQUFXLEdBQ3pDLDBCQUFBQSxLQUFDLFdBQU0sVUFBVSxLQUFLLFFBQVEsaUJBQWlCLEVBQUUsR0FBRyxPQUNsRCxNQUFNLE1BQU0sZUFBZSxVQUFVLHlCQUF5QixxQkFBcUIsR0FBRyxHQUMxRjtBQUFBLElBQ0EsZ0JBQUFBLEtBQUMsWUFBTyxXQUFXLE1BQU0sT0FBTyxLQUFLLEdBQUcsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLDJCQUEwQixHQUFFO0FBQUEsS0FDdEY7QUFDRjtBQUVPLFNBQVMsU0FBUztBQUN2QixNQUFJLEtBQUssRUFBRyxRQUFPO0FBQ25CLFFBQU0sTUFBTSxHQUFHO0FBR2YsUUFBTSxPQUFPLFNBQWdDLElBQUksa0JBQWtCLEtBQUssQ0FBQyxDQUFDO0FBQzFFLFFBQU0sVUFBVSxNQUFNLEtBQUssSUFBSSxJQUFJLGtCQUFrQixLQUFLLENBQUMsQ0FBQztBQUM1RCxNQUFJLFFBQVEsWUFBWSxPQUFPO0FBQy9CLE1BQUksUUFBUSxZQUFZLE9BQU87QUFDL0IsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFTLFdBQVU7QUFBQSxNQUFlLE9BQU07QUFBQSxNQUFnQixTQUFTO0FBQUEsTUFDdEUsUUFBUUUsT0FBTSxhQUFhLE1BQU1BLE9BQU0sYUFBYSxRQUFRQSxPQUFNLGFBQWE7QUFBQSxNQUMvRSxTQUFTQSxPQUFNLFFBQVE7QUFBQSxNQUN2QixPQUFPLENBQUMsU0FBcUIsS0FBSztBQUFBLFFBQVE7QUFBQSxRQUN4QyxNQUFNLFdBQVcsSUFBSSxLQUFLLE9BQU87QUFBQSxNQUFDO0FBQUEsTUFDcEMsY0FBYyxDQUFDLE1BQU1DLFNBQVFBLFNBQVFDLEtBQUksY0FBYyxLQUFLLEtBQUssR0FBRyxRQUFRO0FBQUEsTUFDNUUsK0JBQUMsU0FBSSxPQUFNLFVBQVMsYUFBYUgsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUNsRTtBQUFBLHdCQUFBRCxLQUFDLGFBQVU7QUFBQSxRQUNYLHFCQUFDLFNBQUksT0FBTSxTQUFRLFNBQVMsR0FDMUI7QUFBQSwwQkFBQUEsS0FBQyxXQUFNLFNBQU8sTUFBQyxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFNLGlCQUFnQjtBQUFBLFVBQzlELGdCQUFBRCxLQUFDLFdBQU0sT0FBTSxVQUFTLE9BQU8sS0FBSyxJQUFJLEVBQUUsR0FBRyxDQUFBRCxPQUFLLEdBQUdBLEdBQUUsVUFBVSxFQUFFLEVBQUUsR0FBRztBQUFBLFVBQ3RFLGdCQUFBQyxLQUFDLFlBQU8sT0FBTSxVQUFTLFdBQVcsTUFDaEMsSUFBSSxrQkFBa0IsRUFBRSxRQUFRLENBQUFELE9BQUtBLEdBQUUsUUFBUSxDQUFDLEdBQ2hELCtCQUFDLFNBQUksU0FBUyxHQUFHO0FBQUEsNEJBQUFDLEtBQUMsV0FBTSxVQUFTLHdCQUF1QjtBQUFBLFlBQUUsZ0JBQUFBLEtBQUMsV0FBTSxPQUFNLFNBQVE7QUFBQSxhQUFFLEdBQ25GO0FBQUEsV0FDRjtBQUFBLFFBS0EsZ0JBQUFBLEtBQUMsU0FBSSxhQUFhQyxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQUcsU0FBTyxNQUM1RCxlQUFLLElBQUksRUFBRSxHQUFHLFFBQU8sTUFBTSxHQUFHLFNBQzNCLEdBQUcsSUFBSSxDQUFBRixPQUFLLGdCQUFBQyxLQUFDLFFBQUssR0FBR0QsSUFBRyxDQUFFLElBQzFCLENBQUMsZ0JBQUFDLEtBQUMsU0FBSSxPQUFNLGVBQWMsUUFBUUMsS0FBSSxNQUFNLFFBQzFDLDBCQUFBRCxLQUFDLFdBQU0sT0FBTSx3QkFBa0IsR0FDakMsQ0FBTSxDQUFDLEdBQ2I7QUFBQSxTQUNGO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7OztBQzVJQSxPQUFPSyxTQUFRO0FBRUEsU0FBUixJQUFxQixTQUFzQjtBQUNoRCxRQUFNLFVBQVVDLElBQUcsWUFBWSxHQUFHLG1CQUFtQjtBQUNyRCxRQUFNLFVBQVUsU0FBUyxLQUFLO0FBQzlCLE1BQUksT0FBMEM7QUFDOUMsTUFBSSxDQUFDLFFBQVMsUUFBTztBQUVyQixVQUFRLFFBQVEsa0JBQWtCLE1BQU07QUFDdEMsWUFBUSxJQUFJLElBQUk7QUFDaEIsVUFBTSxPQUFPO0FBQ2IsV0FBTyxRQUFRLE1BQU0sTUFBTSxRQUFRLElBQUksS0FBSyxDQUFDO0FBQUEsRUFDL0MsQ0FBQztBQUVELFNBQU8sZ0JBQUFDO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFDTixNQUFLO0FBQUEsTUFBTSxXQUFVO0FBQUEsTUFBWSxZQUFZO0FBQUEsTUFDN0MsUUFBUUMsT0FBTSxhQUFhO0FBQUEsTUFBUSxjQUFjO0FBQUEsTUFDakQsY0FBWTtBQUFBLE1BQUMsU0FBUyxLQUFLLE9BQU87QUFBQSxNQUNsQywrQkFBQyxTQUFJLE9BQU0sT0FBTSxTQUFTLElBQUksY0FBYyxLQUMxQztBQUFBLHdCQUFBRCxLQUFDLFdBQU0sVUFBVSxLQUFLLFNBQVMsYUFBYSxHQUFHO0FBQUEsUUFDL0MsZ0JBQUFBLEtBQUMsY0FBUyxTQUFPLE1BQUMsT0FBTyxLQUFLLFNBQVMsUUFBUSxHQUFHO0FBQUEsUUFDbEQsZ0JBQUFBLEtBQUMsV0FBTSxPQUFNLE1BQUssT0FBTyxLQUFLLFNBQVMsUUFBUSxFQUFFLEdBQUcsT0FDbEQsR0FBRyxLQUFLLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxHQUFHO0FBQUEsU0FDaEM7QUFBQTtBQUFBLEVBQ0Y7QUFDRjs7O0FDcEJBLElBQU1FLFdBQVU7QUFBQSxFQUNkO0FBQUEsSUFBRSxJQUFJO0FBQUEsSUFBUSxPQUFPO0FBQUEsSUFBUSxNQUFNO0FBQUEsSUFDakMsU0FBUztBQUFBLElBQU8sS0FBSyxNQUFNLFVBQVUsdUJBQXVCO0FBQUEsRUFBRTtBQUFBLEVBQ2hFO0FBQUEsSUFBRSxJQUFJO0FBQUEsSUFBVSxPQUFPO0FBQUEsSUFBVyxNQUFNO0FBQUEsSUFDdEMsU0FBUztBQUFBLElBQU8sS0FBSyxNQUFNLFVBQVUseUNBQXlDO0FBQUEsRUFBRTtBQUFBLEVBQ2xGO0FBQUEsSUFBRSxJQUFJO0FBQUEsSUFBVyxPQUFPO0FBQUEsSUFBVyxNQUFNO0FBQUEsSUFDdkMsU0FBUztBQUFBLElBQU0sS0FBSyxNQUFNLFVBQVUsa0JBQWtCO0FBQUEsRUFBRTtBQUFBLEVBQzFEO0FBQUEsSUFBRSxJQUFJO0FBQUEsSUFBWSxPQUFPO0FBQUEsSUFBYSxNQUFNO0FBQUEsSUFDMUMsU0FBUztBQUFBLElBQU0sS0FBSztBQUFBLElBQU0sS0FBSyxNQUFNLFVBQVUsb0JBQW9CO0FBQUEsRUFBRTtBQUN6RTtBQUVlLFNBQVIsVUFBMkI7QUFDaEMsUUFBTSxRQUFRLFNBQXdCLElBQUk7QUFDMUMsTUFBSSxTQUE0QztBQUVoRCxRQUFNLFFBQVEsQ0FBQyxHQUEyQixTQUFxQjtBQUM3RCxRQUFJLEVBQUUsV0FBVyxNQUFNLElBQUksTUFBTSxFQUFFLElBQUk7QUFDckMsWUFBTSxJQUFJLEVBQUUsRUFBRTtBQUNkLGNBQVEsT0FBTztBQUNmLGVBQVMsUUFBUSxLQUFNLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQztBQUM1QztBQUFBLElBQ0Y7QUFDQSxVQUFNLElBQUksSUFBSTtBQUFHLFNBQUs7QUFBRyxNQUFFLElBQUk7QUFBQSxFQUNqQztBQUVBLFNBQU8sZ0JBQUFDO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFDTixNQUFLO0FBQUEsTUFBVSxXQUFVO0FBQUEsTUFBZ0IsT0FBTTtBQUFBLE1BQWlCLFNBQVM7QUFBQSxNQUN6RSxRQUFRQyxPQUFNLGFBQWEsTUFBTUEsT0FBTSxhQUFhLFNBQzVDQSxPQUFNLGFBQWEsT0FBT0EsT0FBTSxhQUFhO0FBQUEsTUFDckQsU0FBU0EsT0FBTSxRQUFRO0FBQUEsTUFBVyxhQUFhQSxPQUFNLFlBQVk7QUFBQSxNQUNqRSxjQUFjLENBQUMsTUFBTUMsU0FBUTtBQUMzQixZQUFJQSxTQUFRQyxLQUFJLFlBQVk7QUFBRSxnQkFBTSxJQUFJLElBQUk7QUFBRyxlQUFLLEtBQUs7QUFBRyxpQkFBTztBQUFBLFFBQUs7QUFDeEUsZUFBTztBQUFBLE1BQ1Q7QUFBQSxNQUVBLDBCQUFBSCxLQUFDLFNBQUksT0FBTSxXQUFVLFNBQU8sTUFBQyxTQUFPLE1BQ2xDLDBCQUFBQSxLQUFDLFNBQUksUUFBUUksS0FBSSxNQUFNLFFBQVEsUUFBUUEsS0FBSSxNQUFNLFFBQVEsU0FBUyxJQUFJLFNBQU8sTUFDMUUsVUFBQUwsU0FBUSxJQUFJLE9BQ1gsZ0JBQUFDO0FBQUEsUUFBQztBQUFBO0FBQUEsVUFBTyxPQUFPLEVBQUUsTUFBTSxhQUFhO0FBQUEsVUFDbEMsV0FBVyxVQUFRLE1BQU0sR0FBRyxNQUFNLEtBQUssU0FBUyxHQUFHLE9BQU8sQ0FBQztBQUFBLFVBQzNEO0FBQUEsWUFBQztBQUFBO0FBQUEsY0FBSSxhQUFhSSxLQUFJLFlBQVk7QUFBQSxjQUFVLFNBQVM7QUFBQSxjQUNuRCxPQUFPLEtBQUssS0FBSyxFQUFFLEdBQUcsT0FBSyxNQUFNLEVBQUUsS0FBSyxZQUFZLEVBQUU7QUFBQSxjQUN0RDtBQUFBLGdDQUFBSjtBQUFBLGtCQUFDO0FBQUE7QUFBQSxvQkFBSSxPQUFNO0FBQUEsb0JBQU0sU0FBUztBQUFBLG9CQUFPLFNBQVM7QUFBQSxvQkFDeEMsUUFBUUksS0FBSSxNQUFNO0FBQUEsb0JBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsb0JBSzVDLDBCQUFBSjtBQUFBLHNCQUFDO0FBQUE7QUFBQSx3QkFBTSxVQUFVLEVBQUU7QUFBQSx3QkFBTSxXQUFXO0FBQUEsd0JBQUksU0FBTztBQUFBLHdCQUM3QyxRQUFRSSxLQUFJLE1BQU07QUFBQSx3QkFBUSxRQUFRQSxLQUFJLE1BQU07QUFBQTtBQUFBLG9CQUFRO0FBQUE7QUFBQSxnQkFDeEQ7QUFBQSxnQkFDQSxnQkFBQUosS0FBQyxXQUFNLE9BQU8sS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLE1BQU0sRUFBRSxLQUFLLGdCQUFnQixFQUFFLEtBQUssR0FBRztBQUFBO0FBQUE7QUFBQSxVQUMzRTtBQUFBO0FBQUEsTUFDRixDQUFTLEdBQ2IsR0FDRjtBQUFBO0FBQUEsRUFDRjtBQUNGOzs7QXRCL0JBLE9BQU8sZUFBZTtBQTNCdEIsT0FBTyxlQUFnQkssS0FBSSxPQUFlLFdBQVcsU0FBUztBQUFBLEVBQzVELGNBQWM7QUFBQSxFQUNkLElBQUksR0FBVztBQUFFLFNBQUssZ0JBQWdCLE9BQU8sQ0FBQyxFQUFFLE1BQU0sS0FBSyxFQUFFLE9BQU8sT0FBTyxDQUFDO0FBQUEsRUFBRTtBQUFBLEVBQzlFLE1BQU07QUFBRSxXQUFPLEtBQUssZ0JBQWdCLEVBQUUsS0FBSyxHQUFHO0FBQUEsRUFBRTtBQUNsRCxDQUFDO0FBQ0NBLEtBQUksT0FBTyxVQUFrQixZQUFZLFNBQVUsR0FBVztBQUM5RCxPQUFLLGdCQUFnQixPQUFPLENBQUMsRUFBRSxNQUFNLEtBQUssRUFBRSxPQUFPLE9BQU8sQ0FBQztBQUM3RDtBQWVBLFNBQVMsMkJBQTJCO0FBTXBDLElBQU0sV0FBVyxVQUFVLE9BQU8sYUFBYSxLQUMxQyxVQUFVLGdCQUFnQixDQUFDLFVBQVUsZ0JBQWdCLEdBQUcsT0FBTyxDQUFDO0FBRXJFLFlBQUksTUFBTTtBQUFBLEVBQ1IsY0FBYztBQUFBLEVBQ2QsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUNMLElBQVEsS0FBSztBQUNiLElBQVVDLE1BQUs7QUFJZixRQUFJO0FBQ0YsWUFBTSxPQUFPLElBQUlELEtBQUksWUFBWTtBQUNqQyxXQUFLLGlCQUFpQixlQUFRLFNBQVMsTUFBTSxDQUFDO0FBQzlDLE1BQUFBLEtBQUksYUFBYTtBQUFBLFFBQ2ZFLEtBQUksUUFBUSxZQUFZO0FBQUEsUUFBSTtBQUFBLFFBQU07QUFBQTtBQUFBLE1BQXVCO0FBQUEsSUFDN0QsU0FBUyxHQUFHO0FBQUUsZUFBUywrQkFBK0IsQ0FBQyxFQUFFO0FBQUEsSUFBRTtBQUczRCxVQUFNLE9BQU8sQ0FBQyxNQUFjLElBQWUsU0FBa0I7QUFDM0QsVUFBSTtBQUNGLGNBQU0sSUFBSSxHQUFHO0FBQ2IsWUFBSSxLQUFLLE9BQU8sRUFBRSxZQUFZLFlBQVk7QUFDeEMsc0JBQUksYUFBYSxDQUFDO0FBQ2xCLGNBQUksS0FBTSxHQUFFLFFBQVE7QUFBQSxRQUN0QjtBQUFBLE1BQ0YsU0FBUyxHQUFHO0FBQUUsaUJBQVMsVUFBVSxJQUFJLFlBQVksQ0FBQztBQUFBLEVBQU0sR0FBVyxTQUFTLEVBQUUsRUFBRTtBQUFBLE1BQUU7QUFBQSxJQUNwRjtBQUNBLFVBQU0sV0FBVyxZQUFJLGFBQWE7QUFDbEMsVUFBTSxVQUFVLFNBQVMsU0FBUyxXQUFXLENBQUMsTUFBZ0I7QUFDOUQsZUFBVyxXQUFXLFNBQVM7QUFDN0IsV0FBSyxPQUFPLE1BQU0sSUFBSSxPQUFPLEdBQUcsSUFBSTtBQUNwQyxXQUFLLFFBQVEsTUFBTSxLQUFLLE9BQU8sR0FBRyxJQUFJO0FBQ3RDLFdBQUssVUFBVSxNQUFNLE9BQU8sT0FBTyxHQUFHLElBQUk7QUFDMUMsV0FBSyxPQUFPLE1BQU0sSUFBSSxPQUFPLEdBQUcsSUFBSTtBQUFBLElBQ3RDO0FBQ0EsU0FBSyxZQUFZLE1BQU0sU0FBUyxHQUFHLEtBQUs7QUFDeEMsU0FBSyxpQkFBaUIsTUFBTSxjQUFjLEdBQUcsS0FBSztBQUNsRCxTQUFLLFlBQVksTUFBTSxTQUFTLEdBQUcsS0FBSztBQUN4QyxTQUFLLFVBQVUsTUFBTSxPQUFPLEdBQUcsS0FBSztBQUNwQyxTQUFLLFdBQVcsTUFBTSxRQUFRLEdBQUcsS0FBSztBQUV0QyxZQUFRLENBQUMsU0FBUyxZQUFJLFdBQVcsSUFBSSxDQUFRO0FBQUEsRUFDL0M7QUFBQTtBQUFBLEVBRUEsZUFBZSxTQUFTLEtBQUs7QUFDM0IsVUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLFFBQVEsTUFBTSxHQUFHO0FBQ3BDLFFBQUksUUFBUSxVQUFVO0FBQUUsa0JBQUksY0FBYyxHQUFHO0FBQUcsYUFBTyxJQUFJLElBQUk7QUFBQSxJQUFFO0FBQ2pFLFFBQUksUUFBUSxjQUFjO0FBQUUsa0JBQUksVUFBVSxlQUFRLFNBQVMsTUFBTSxHQUFHLElBQUk7QUFBRyxhQUFPLElBQUksSUFBSTtBQUFBLElBQUU7QUFDNUYsUUFBSSxTQUFTO0FBQUEsRUFDZjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbIkFzdGFsIiwgIkd0ayIsICJHZGsiLCAiQXN0YWwiLCAiYmluZCIsICJpbnRlcnZhbCIsICJ0aW1lb3V0IiwgIkFzdGFsIiwgIkFzdGFsIiwgImluaXQiLCAiQXN0YWwiLCAidiIsICJpbnRlcnZhbCIsICJrZXkiLCAiY3RvcnMiLCAia2V5IiwgIkd0ayIsICJBc3RhbCIsICJzbmFrZWlmeSIsICJwYXRjaCIsICJBcHBzIiwgIkJsdWV0b290aCIsICJNcHJpcyIsICJOb3RpZmQiLCAiV3AiLCAiQXBwIiwgIkd0ayIsICJBc3RhbCIsICJBc3RhbCIsICJHdGsiLCAiR3RrIiwgIkFzdGFsIiwgImNoIiwgIkd0ayIsICJHZGsiLCAiR2lvIiwgIkdMaWIiLCAiZGVmYXVsdCIsICJBc3RhbCIsICJHT2JqZWN0IiwgImRlZmF1bHQiLCAiR09iamVjdCIsICJHaW8iLCAiR0xpYiIsICJHaW8iLCAiR0xpYiIsICJpbml0IiwgIkdMaWIiLCAiR0xpYiIsICJ0eXBlIiwgIkdMaWIiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiYXN0YWxpZnkiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiZmlsdGVyIiwgIkd0ayIsICJBc3RhbCIsICJCb3giLCAiYXN0YWxpZnkiLCAiR09iamVjdCIsICJCdXR0b24iLCAiQ2VudGVyQm94IiwgIkVudHJ5IiwgIkxhYmVsIiwgIkxldmVsQmFyIiwgIk1lbnVCdXR0b24iLCAiT3ZlcmxheSIsICJSZXZlYWxlciIsICJTbGlkZXIiLCAiU3RhY2siLCAiU3dpdGNoIiwgIldpbmRvdyIsICJqc3giLCAiQm94IiwgIkJ1dHRvbiIsICJDZW50ZXJCb3giLCAiRW50cnkiLCAiTGFiZWwiLCAiTGV2ZWxCYXIiLCAiTWVudUJ1dHRvbiIsICJPdmVybGF5IiwgIlJldmVhbGVyIiwgIlNsaWRlciIsICJTdGFjayIsICJTd2l0Y2giLCAiV2luZG93IiwgImRlZmF1bHQiLCAianN4IiwgIkd0ayIsICJuIiwgIkFzdGFsIiwgIkdpbyIsICJqc3giLCAiR3RrIiwgIm4iLCAiR2RrIiwgIkdpbyIsICJBc3RhbCIsICJBcHBzIiwgIkdMaWIiLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIlBJTk5FRCIsICJBcHBzIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJHdGsiLCAiTmV0d29yayIsICJXcCIsICJHT2JqZWN0IiwgIkd0ayIsICJUaW55U2xpZGVyIiwgImRlZmF1bHQiLCAiU1RPUkUiLCAianN4IiwgIkd0ayIsICJXcCIsICJOZXR3b3JrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiTm90aWZkIiwgIk5vdGlmZCIsICJkZWZhdWx0IiwgIm4iLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIldwIiwgIldwIiwgImpzeCIsICJBc3RhbCIsICJBQ1RJT05TIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJHdGsiLCAiaW5pdCIsICJHZGsiXQp9Cg==
