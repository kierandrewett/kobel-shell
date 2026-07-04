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
function mkApp(App5) {
  return new class AstalJS extends App5 {
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
  const wifiIcon2 = net.wifi ? bind(net.wifi, "enabled").as((on) => on ? "kobel-wifi-symbolic" : "kobel-wifi-off-symbolic") : "kobel-wifi-off-symbolic";
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
          /* @__PURE__ */ jsx2("label", { class: "tn", label: DEMO ? D.batteryPct : bat ? bind(bat, "percentage").as((p) => `${Math.round(p * 100)}%`) : "" })
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
  const mpris = Mpris.get_default();
  const player = bind(mpris, "players").as((ps) => ps.find((p) => p.playback_status === Mpris.PlaybackStatus.PLAYING) ?? ps[0] ?? null);
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
  return /* @__PURE__ */ jsx2(
    "button",
    {
      class: "dbtn dwidget",
      onClicked: () => execAsync("playerctl play-pause"),
      children: /* @__PURE__ */ jsxs("overlay", { children: [
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
      ] })
    }
  );
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
                  label: bind(todayVar).as((d) => d.toLocaleDateString("en-GB", { weekday: "long" }))
                }
              ),
              /* @__PURE__ */ jsx2(
                "label",
                {
                  class: "hero",
                  halign: Gtk4.Align.START,
                  label: bind(todayVar).as((d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))
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
  const { winVisible, revealed: launchRevealed, setRevealer: setLaunchRevealer, close: launchClose, toggle: toggleFn } = makeReveal(220, 150);
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
              /* @__PURE__ */ jsx2("box", { class: "tiles", halign: Gtk4.Align.CENTER, spacing: 6, children: gridTiles(apps).map((t) => /* @__PURE__ */ jsx2("button", { class: "tile", onClicked: () => {
                t.launch();
                launchClose();
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
                (() => {
                  const mpris = Mpris2.get_default();
                  const activePlayer = bind(mpris, "players").as((ps) => ps.find((p) => p.playback_status === Mpris2.PlaybackStatus.PLAYING) ?? ps[0] ?? null);
                  const mediaTitle = DEMO ? D.media.title : bind(mpris, "players").as((ps) => {
                    const p = ps.find((q) => q.playback_status === Mpris2.PlaybackStatus.PLAYING) ?? ps[0];
                    return p?.title ?? "Nothing playing";
                  });
                  const mediaArtist = DEMO ? D.media.artist : bind(mpris, "players").as((ps) => {
                    const p = ps.find((q) => q.playback_status === Mpris2.PlaybackStatus.PLAYING) ?? ps[0];
                    return p?.artist ?? "";
                  });
                  const playIcon = DEMO ? "kobel-play-symbolic" : bind(mpris, "players").as((ps) => {
                    const p = ps.find((q) => q.playback_status === Mpris2.PlaybackStatus.PLAYING) ?? ps[0];
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
                          /* @__PURE__ */ jsx2("label", { class: "mtitle", halign: Gtk4.Align.START, ellipsize: 3, label: mediaTitle }),
                          /* @__PURE__ */ jsx2("label", { class: "hint", halign: Gtk4.Align.START, ellipsize: 3, label: mediaArtist })
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
  const brightValue = Variable(DEMO ? D.brightness : 0.8);
  if (!DEMO) {
    Promise.all([execAsync("brightnessctl get"), execAsync("brightnessctl max")]).then(([cur, max]) => brightValue.set(parseInt(cur.trim()) / parseInt(max.trim()))).catch(() => {
    });
  }
  const brightSlider = new TinySlider({ hexpand: true, cssClasses: ["slider"], value: brightValue.get() });
  brightValue.subscribe((v) => {
    brightSlider.get_adjustment().value = v;
  });
  brightSlider.connect("change-value", (_s, _t, v) => execAsync(`brightnessctl set ${Math.round(v * 100)}%`).then(() => brightValue.set(v)).catch(() => {
  }));
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
var ifaceSettings = new Gio4.Settings({ schema: "org.gnome.desktop.interface" });
var tDark = Variable(ifaceSettings.get_string("color-scheme") === "prefer-dark");
ifaceSettings.connect("changed::color-scheme", () => tDark.set(ifaceSettings.get_string("color-scheme") === "prefer-dark"));
var colorSettings = null;
var tNight = Variable(false);
try {
  colorSettings = new Gio4.Settings({ schema: "org.gnome.settings-daemon.plugins.color" });
  tNight.set(colorSettings.get_boolean("night-light-enabled"));
  colorSettings.connect("changed::night-light-enabled", () => tNight.set(colorSettings.get_boolean("night-light-enabled")));
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
            sub: DEMO ? D.btDevice : bind(bt, "devices").as((d) => d.find((x) => x.connected)?.alias ?? "Off"),
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
              ifaceSettings.set_string("color-scheme", next ? "prefer-dark" : "default");
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
    /* @__PURE__ */ jsx2("button", { onClicked: () => player.play_pause(), children: /* @__PURE__ */ jsx2("image", { iconName: bind(player, "playback_status").as((s) => s === Mpris3.PlaybackStatus.PLAYING ? "kobel-pause-symbolic" : "kobel-play-symbolic") }) }),
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2luZGV4LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdmFyaWFibGUudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9iaW5kaW5nLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvdGltZS50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL3Byb2Nlc3MudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXN0YWwudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9ndGs0L2FzdGFsaWZ5LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC9hcHAudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9vdmVycmlkZXMudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9fYXBwLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrNC93aWRnZXQudHMiLCAiLi4vYWdzL2FwcC50cyIsICJzYXNzOi9ob21lL2tpZXJhbi9kZXYva29iZWwtc2hlbGwvYWdzL3N0eWxlL21haW4uc2NzcyIsICIuLi9hZ3MvY29uZmlnLnRzIiwgIi4uL2Fncy9zZXJ2aWNlcy9nbm9ibGluLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvaW5kZXgudHMiLCAiLi4vLi4vLi4vLi4vLi4vdXNyL3NoYXJlL2FzdGFsL2dqcy9maWxlLnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ29iamVjdC50cyIsICIuLi9hZ3Mvc2VydmljZXMvbm90aWZkLnRzIiwgIi4uL2Fncy9saWIvaW5zcGVjdC50cyIsICIuLi9hZ3MvbGliL3N1cmZhY2UudHMiLCAiLi4vYWdzL3dpZGdldC9CYXIudHN4IiwgIi4uL2Fncy9saWIvZGVtby50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL2d0azMvd2lkZ2V0LnRzIiwgIi4uLy4uLy4uLy4uLy4uL3Vzci9zaGFyZS9hc3RhbC9nanMvZ3RrMy9hc3RhbGlmeS50cyIsICIuLi8uLi8uLi8uLi8uLi91c3Ivc2hhcmUvYXN0YWwvZ2pzL2d0azMvanN4LXJ1bnRpbWUudHMiLCAiLi4vYWdzL3dpZGdldC9Eb2NrLnRzeCIsICIuLi9hZ3Mvd2lkZ2V0L0xhdW5jaGVyLnRzeCIsICIuLi9hZ3MvbGliL2Z1enp5LnRzIiwgIi4uL2Fncy93aWRnZXQvQ2FsZW5kYXIudHN4IiwgIi4uL2Fncy93aWRnZXQvUXVpY2tTZXR0aW5ncy50c3giLCAiLi4vYWdzL2xpYi90aW55c2xpZGVyLnRzIiwgIi4uL2Fncy93aWRnZXQvTm90aWZpY2F0aW9ucy50c3giLCAiLi4vYWdzL3dpZGdldC9PU0QudHN4IiwgIi4uL2Fncy93aWRnZXQvU2Vzc2lvbi50c3giXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgYXN0YWxpZnksIHsgdHlwZSBDb25zdHJ1Y3RQcm9wcyB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZXhwb3J0IHsgQXN0YWwsIEd0aywgR2RrIH1cbmV4cG9ydCB7IGRlZmF1bHQgYXMgQXBwIH0gZnJvbSBcIi4vYXBwLmpzXCJcbmV4cG9ydCB7IGFzdGFsaWZ5LCBDb25zdHJ1Y3RQcm9wcyB9XG5leHBvcnQgKiBhcyBXaWRnZXQgZnJvbSBcIi4vd2lkZ2V0LmpzXCJcbmV4cG9ydCB7IGhvb2sgfSBmcm9tIFwiLi4vX2FzdGFsXCJcbiIsICJpbXBvcnQgQXN0YWwgZnJvbSBcImdpOi8vQXN0YWxJT1wiXG5pbXBvcnQgQmluZGluZywgeyB0eXBlIENvbm5lY3RhYmxlLCB0eXBlIFN1YnNjcmliYWJsZSB9IGZyb20gXCIuL2JpbmRpbmcuanNcIlxuaW1wb3J0IHsgaW50ZXJ2YWwgfSBmcm9tIFwiLi90aW1lLmpzXCJcbmltcG9ydCB7IGV4ZWNBc3luYywgc3VicHJvY2VzcyB9IGZyb20gXCIuL3Byb2Nlc3MuanNcIlxuXG5jbGFzcyBWYXJpYWJsZVdyYXBwZXI8VD4gZXh0ZW5kcyBGdW5jdGlvbiB7XG4gICAgcHJpdmF0ZSB2YXJpYWJsZSE6IEFzdGFsLlZhcmlhYmxlQmFzZVxuICAgIHByaXZhdGUgZXJySGFuZGxlcj8gPSBjb25zb2xlLmVycm9yXG5cbiAgICBwcml2YXRlIF92YWx1ZTogVFxuICAgIHByaXZhdGUgX3BvbGw/OiBBc3RhbC5UaW1lXG4gICAgcHJpdmF0ZSBfd2F0Y2g/OiBBc3RhbC5Qcm9jZXNzXG5cbiAgICBwcml2YXRlIHBvbGxJbnRlcnZhbCA9IDEwMDBcbiAgICBwcml2YXRlIHBvbGxFeGVjPzogc3RyaW5nW10gfCBzdHJpbmdcbiAgICBwcml2YXRlIHBvbGxUcmFuc2Zvcm0/OiAoc3Rkb3V0OiBzdHJpbmcsIHByZXY6IFQpID0+IFRcbiAgICBwcml2YXRlIHBvbGxGbj86IChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPlxuXG4gICAgcHJpdmF0ZSB3YXRjaFRyYW5zZm9ybT86IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVFxuICAgIHByaXZhdGUgd2F0Y2hFeGVjPzogc3RyaW5nW10gfCBzdHJpbmdcblxuICAgIGNvbnN0cnVjdG9yKGluaXQ6IFQpIHtcbiAgICAgICAgc3VwZXIoKVxuICAgICAgICB0aGlzLl92YWx1ZSA9IGluaXRcbiAgICAgICAgdGhpcy52YXJpYWJsZSA9IG5ldyBBc3RhbC5WYXJpYWJsZUJhc2UoKVxuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJkcm9wcGVkXCIsICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3RvcFdhdGNoKClcbiAgICAgICAgICAgIHRoaXMuc3RvcFBvbGwoKVxuICAgICAgICB9KVxuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJlcnJvclwiLCAoXywgZXJyKSA9PiB0aGlzLmVyckhhbmRsZXI/LihlcnIpKVxuICAgICAgICByZXR1cm4gbmV3IFByb3h5KHRoaXMsIHtcbiAgICAgICAgICAgIGFwcGx5OiAodGFyZ2V0LCBfLCBhcmdzKSA9PiB0YXJnZXQuX2NhbGwoYXJnc1swXSksXG4gICAgICAgIH0pXG4gICAgfVxuXG4gICAgcHJpdmF0ZSBfY2FsbDxSID0gVD4odHJhbnNmb3JtPzogKHZhbHVlOiBUKSA9PiBSKTogQmluZGluZzxSPiB7XG4gICAgICAgIGNvbnN0IGIgPSBCaW5kaW5nLmJpbmQodGhpcylcbiAgICAgICAgcmV0dXJuIHRyYW5zZm9ybSA/IGIuYXModHJhbnNmb3JtKSA6IGIgYXMgdW5rbm93biBhcyBCaW5kaW5nPFI+XG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBTdHJpbmcoYFZhcmlhYmxlPCR7dGhpcy5nZXQoKX0+YClcbiAgICB9XG5cbiAgICBnZXQoKTogVCB7IHJldHVybiB0aGlzLl92YWx1ZSB9XG4gICAgc2V0KHZhbHVlOiBUKSB7XG4gICAgICAgIGlmICh2YWx1ZSAhPT0gdGhpcy5fdmFsdWUpIHtcbiAgICAgICAgICAgIHRoaXMuX3ZhbHVlID0gdmFsdWVcbiAgICAgICAgICAgIHRoaXMudmFyaWFibGUuZW1pdChcImNoYW5nZWRcIilcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXJ0UG9sbCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3BvbGwpXG4gICAgICAgICAgICByZXR1cm5cblxuICAgICAgICBpZiAodGhpcy5wb2xsRm4pIHtcbiAgICAgICAgICAgIHRoaXMuX3BvbGwgPSBpbnRlcnZhbCh0aGlzLnBvbGxJbnRlcnZhbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHYgPSB0aGlzLnBvbGxGbiEodGhpcy5nZXQoKSlcbiAgICAgICAgICAgICAgICBpZiAodiBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgICAgICAgICAgICAgdi50aGVuKHYgPT4gdGhpcy5zZXQodikpXG4gICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goZXJyID0+IHRoaXMudmFyaWFibGUuZW1pdChcImVycm9yXCIsIGVycikpXG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXQodilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMucG9sbEV4ZWMpIHtcbiAgICAgICAgICAgIHRoaXMuX3BvbGwgPSBpbnRlcnZhbCh0aGlzLnBvbGxJbnRlcnZhbCwgKCkgPT4ge1xuICAgICAgICAgICAgICAgIGV4ZWNBc3luYyh0aGlzLnBvbGxFeGVjISlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4odiA9PiB0aGlzLnNldCh0aGlzLnBvbGxUcmFuc2Zvcm0hKHYsIHRoaXMuZ2V0KCkpKSlcbiAgICAgICAgICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLnZhcmlhYmxlLmVtaXQoXCJlcnJvclwiLCBlcnIpKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHN0YXJ0V2F0Y2goKSB7XG4gICAgICAgIGlmICh0aGlzLl93YXRjaClcbiAgICAgICAgICAgIHJldHVyblxuXG4gICAgICAgIHRoaXMuX3dhdGNoID0gc3VicHJvY2Vzcyh7XG4gICAgICAgICAgICBjbWQ6IHRoaXMud2F0Y2hFeGVjISxcbiAgICAgICAgICAgIG91dDogb3V0ID0+IHRoaXMuc2V0KHRoaXMud2F0Y2hUcmFuc2Zvcm0hKG91dCwgdGhpcy5nZXQoKSkpLFxuICAgICAgICAgICAgZXJyOiBlcnIgPT4gdGhpcy52YXJpYWJsZS5lbWl0KFwiZXJyb3JcIiwgZXJyKSxcbiAgICAgICAgfSlcbiAgICB9XG5cbiAgICBzdG9wUG9sbCgpIHtcbiAgICAgICAgdGhpcy5fcG9sbD8uY2FuY2VsKClcbiAgICAgICAgZGVsZXRlIHRoaXMuX3BvbGxcbiAgICB9XG5cbiAgICBzdG9wV2F0Y2goKSB7XG4gICAgICAgIHRoaXMuX3dhdGNoPy5raWxsKClcbiAgICAgICAgZGVsZXRlIHRoaXMuX3dhdGNoXG4gICAgfVxuXG4gICAgaXNQb2xsaW5nKCkgeyByZXR1cm4gISF0aGlzLl9wb2xsIH1cbiAgICBpc1dhdGNoaW5nKCkgeyByZXR1cm4gISF0aGlzLl93YXRjaCB9XG5cbiAgICBkcm9wKCkge1xuICAgICAgICB0aGlzLnZhcmlhYmxlLmVtaXQoXCJkcm9wcGVkXCIpXG4gICAgfVxuXG4gICAgb25Ecm9wcGVkKGNhbGxiYWNrOiAoKSA9PiB2b2lkKSB7XG4gICAgICAgIHRoaXMudmFyaWFibGUuY29ubmVjdChcImRyb3BwZWRcIiwgY2FsbGJhY2spXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBvbkVycm9yKGNhbGxiYWNrOiAoZXJyOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuZXJySGFuZGxlclxuICAgICAgICB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJlcnJvclwiLCAoXywgZXJyKSA9PiBjYWxsYmFjayhlcnIpKVxuICAgICAgICByZXR1cm4gdGhpcyBhcyB1bmtub3duIGFzIFZhcmlhYmxlPFQ+XG4gICAgfVxuXG4gICAgc3Vic2NyaWJlKGNhbGxiYWNrOiAodmFsdWU6IFQpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgaWQgPSB0aGlzLnZhcmlhYmxlLmNvbm5lY3QoXCJjaGFuZ2VkXCIsICgpID0+IHtcbiAgICAgICAgICAgIGNhbGxiYWNrKHRoaXMuZ2V0KCkpXG4gICAgICAgIH0pXG4gICAgICAgIHJldHVybiAoKSA9PiB0aGlzLnZhcmlhYmxlLmRpc2Nvbm5lY3QoaWQpXG4gICAgfVxuXG4gICAgcG9sbChcbiAgICAgICAgaW50ZXJ2YWw6IG51bWJlcixcbiAgICAgICAgZXhlYzogc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgICAgIHRyYW5zZm9ybT86IChzdGRvdXQ6IHN0cmluZywgcHJldjogVCkgPT4gVFxuICAgICk6IFZhcmlhYmxlPFQ+XG5cbiAgICBwb2xsKFxuICAgICAgICBpbnRlcnZhbDogbnVtYmVyLFxuICAgICAgICBjYWxsYmFjazogKHByZXY6IFQpID0+IFQgfCBQcm9taXNlPFQ+XG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIHBvbGwoXG4gICAgICAgIGludGVydmFsOiBudW1iZXIsXG4gICAgICAgIGV4ZWM6IHN0cmluZyB8IHN0cmluZ1tdIHwgKChwcmV2OiBUKSA9PiBUIHwgUHJvbWlzZTxUPiksXG4gICAgICAgIHRyYW5zZm9ybTogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUID0gb3V0ID0+IG91dCBhcyBULFxuICAgICkge1xuICAgICAgICB0aGlzLnN0b3BQb2xsKClcbiAgICAgICAgdGhpcy5wb2xsSW50ZXJ2YWwgPSBpbnRlcnZhbFxuICAgICAgICB0aGlzLnBvbGxUcmFuc2Zvcm0gPSB0cmFuc2Zvcm1cbiAgICAgICAgaWYgKHR5cGVvZiBleGVjID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHRoaXMucG9sbEZuID0gZXhlY1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMucG9sbEV4ZWNcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucG9sbEV4ZWMgPSBleGVjXG4gICAgICAgICAgICBkZWxldGUgdGhpcy5wb2xsRm5cbiAgICAgICAgfVxuICAgICAgICB0aGlzLnN0YXJ0UG9sbCgpXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICB3YXRjaChcbiAgICAgICAgZXhlYzogc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgICAgIHRyYW5zZm9ybTogKHN0ZG91dDogc3RyaW5nLCBwcmV2OiBUKSA9PiBUID0gb3V0ID0+IG91dCBhcyBULFxuICAgICkge1xuICAgICAgICB0aGlzLnN0b3BXYXRjaCgpXG4gICAgICAgIHRoaXMud2F0Y2hFeGVjID0gZXhlY1xuICAgICAgICB0aGlzLndhdGNoVHJhbnNmb3JtID0gdHJhbnNmb3JtXG4gICAgICAgIHRoaXMuc3RhcnRXYXRjaCgpXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBvYnNlcnZlKFxuICAgICAgICBvYmpzOiBBcnJheTxbb2JqOiBDb25uZWN0YWJsZSwgc2lnbmFsOiBzdHJpbmddPixcbiAgICAgICAgY2FsbGJhY2s6ICguLi5hcmdzOiBhbnlbXSkgPT4gVCxcbiAgICApOiBWYXJpYWJsZTxUPlxuXG4gICAgb2JzZXJ2ZShcbiAgICAgICAgb2JqOiBDb25uZWN0YWJsZSxcbiAgICAgICAgc2lnbmFsOiBzdHJpbmcsXG4gICAgICAgIGNhbGxiYWNrOiAoLi4uYXJnczogYW55W10pID0+IFQsXG4gICAgKTogVmFyaWFibGU8VD5cblxuICAgIG9ic2VydmUoXG4gICAgICAgIG9ianM6IENvbm5lY3RhYmxlIHwgQXJyYXk8W29iajogQ29ubmVjdGFibGUsIHNpZ25hbDogc3RyaW5nXT4sXG4gICAgICAgIHNpZ09yRm46IHN0cmluZyB8ICgob2JqOiBDb25uZWN0YWJsZSwgLi4uYXJnczogYW55W10pID0+IFQpLFxuICAgICAgICBjYWxsYmFjaz86IChvYmo6IENvbm5lY3RhYmxlLCAuLi5hcmdzOiBhbnlbXSkgPT4gVCxcbiAgICApIHtcbiAgICAgICAgY29uc3QgZiA9IHR5cGVvZiBzaWdPckZuID09PSBcImZ1bmN0aW9uXCIgPyBzaWdPckZuIDogY2FsbGJhY2sgPz8gKCgpID0+IHRoaXMuZ2V0KCkpXG4gICAgICAgIGNvbnN0IHNldCA9IChvYmo6IENvbm5lY3RhYmxlLCAuLi5hcmdzOiBhbnlbXSkgPT4gdGhpcy5zZXQoZihvYmosIC4uLmFyZ3MpKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9ianMpKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IG9iaiBvZiBvYmpzKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgW28sIHNdID0gb2JqXG4gICAgICAgICAgICAgICAgY29uc3QgaWQgPSBvLmNvbm5lY3Qocywgc2V0KVxuICAgICAgICAgICAgICAgIHRoaXMub25Ecm9wcGVkKCgpID0+IG8uZGlzY29ubmVjdChpZCkpXG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHNpZ09yRm4gPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpZCA9IG9ianMuY29ubmVjdChzaWdPckZuLCBzZXQpXG4gICAgICAgICAgICAgICAgdGhpcy5vbkRyb3BwZWQoKCkgPT4gb2Jqcy5kaXNjb25uZWN0KGlkKSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzIGFzIHVua25vd24gYXMgVmFyaWFibGU8VD5cbiAgICB9XG5cbiAgICBzdGF0aWMgZGVyaXZlPFxuICAgICAgICBjb25zdCBEZXBzIGV4dGVuZHMgQXJyYXk8U3Vic2NyaWJhYmxlPGFueT4+LFxuICAgICAgICBBcmdzIGV4dGVuZHMge1xuICAgICAgICAgICAgW0sgaW4ga2V5b2YgRGVwc106IERlcHNbS10gZXh0ZW5kcyBTdWJzY3JpYmFibGU8aW5mZXIgVD4gPyBUIDogbmV2ZXJcbiAgICAgICAgfSxcbiAgICAgICAgViA9IEFyZ3MsXG4gICAgPihkZXBzOiBEZXBzLCBmbjogKC4uLmFyZ3M6IEFyZ3MpID0+IFYgPSAoLi4uYXJncykgPT4gYXJncyBhcyB1bmtub3duIGFzIFYpIHtcbiAgICAgICAgY29uc3QgdXBkYXRlID0gKCkgPT4gZm4oLi4uZGVwcy5tYXAoZCA9PiBkLmdldCgpKSBhcyBBcmdzKVxuICAgICAgICBjb25zdCBkZXJpdmVkID0gbmV3IFZhcmlhYmxlKHVwZGF0ZSgpKVxuICAgICAgICBjb25zdCB1bnN1YnMgPSBkZXBzLm1hcChkZXAgPT4gZGVwLnN1YnNjcmliZSgoKSA9PiBkZXJpdmVkLnNldCh1cGRhdGUoKSkpKVxuICAgICAgICBkZXJpdmVkLm9uRHJvcHBlZCgoKSA9PiB1bnN1YnMubWFwKHVuc3ViID0+IHVuc3ViKCkpKVxuICAgICAgICByZXR1cm4gZGVyaXZlZFxuICAgIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBWYXJpYWJsZTxUPiBleHRlbmRzIE9taXQ8VmFyaWFibGVXcmFwcGVyPFQ+LCBcImJpbmRcIj4ge1xuICAgIDxSPih0cmFuc2Zvcm06ICh2YWx1ZTogVCkgPT4gUik6IEJpbmRpbmc8Uj5cbiAgICAoKTogQmluZGluZzxUPlxufVxuXG5leHBvcnQgY29uc3QgVmFyaWFibGUgPSBuZXcgUHJveHkoVmFyaWFibGVXcmFwcGVyIGFzIGFueSwge1xuICAgIGFwcGx5OiAoX3QsIF9hLCBhcmdzKSA9PiBuZXcgVmFyaWFibGVXcmFwcGVyKGFyZ3NbMF0pLFxufSkgYXMge1xuICAgIGRlcml2ZTogdHlwZW9mIFZhcmlhYmxlV3JhcHBlcltcImRlcml2ZVwiXVxuICAgIDxUPihpbml0OiBUKTogVmFyaWFibGU8VD5cbiAgICBuZXc8VD4oaW5pdDogVCk6IFZhcmlhYmxlPFQ+XG59XG5cbmV4cG9ydCBjb25zdCB7IGRlcml2ZSB9ID0gVmFyaWFibGVcbmV4cG9ydCBkZWZhdWx0IFZhcmlhYmxlXG4iLCAiZXhwb3J0IGNvbnN0IHNuYWtlaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMV8kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5leHBvcnQgY29uc3Qga2ViYWJpZnkgPSAoc3RyOiBzdHJpbmcpID0+IHN0clxuICAgIC5yZXBsYWNlKC8oW2Etel0pKFtBLVpdKS9nLCBcIiQxLSQyXCIpXG4gICAgLnJlcGxhY2VBbGwoXCJfXCIsIFwiLVwiKVxuICAgIC50b0xvd2VyQ2FzZSgpXG5cbmV4cG9ydCBpbnRlcmZhY2UgU3Vic2NyaWJhYmxlPFQgPSB1bmtub3duPiB7XG4gICAgc3Vic2NyaWJlKGNhbGxiYWNrOiAodmFsdWU6IFQpID0+IHZvaWQpOiAoKSA9PiB2b2lkXG4gICAgZ2V0KCk6IFRcbiAgICBba2V5OiBzdHJpbmddOiBhbnlcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb25uZWN0YWJsZSB7XG4gICAgY29ubmVjdChzaWduYWw6IHN0cmluZywgY2FsbGJhY2s6ICguLi5hcmdzOiBhbnlbXSkgPT4gdW5rbm93bik6IG51bWJlclxuICAgIGRpc2Nvbm5lY3QoaWQ6IG51bWJlcik6IHZvaWRcbiAgICBba2V5OiBzdHJpbmddOiBhbnlcbn1cblxuZXhwb3J0IGNsYXNzIEJpbmRpbmc8VmFsdWU+IHtcbiAgICBwcml2YXRlIHRyYW5zZm9ybUZuID0gKHY6IGFueSkgPT4gdlxuXG4gICAgI2VtaXR0ZXI6IFN1YnNjcmliYWJsZTxWYWx1ZT4gfCBDb25uZWN0YWJsZVxuICAgICNwcm9wPzogc3RyaW5nXG5cbiAgICBzdGF0aWMgYmluZDxcbiAgICAgICAgVCBleHRlbmRzIENvbm5lY3RhYmxlLFxuICAgICAgICBQIGV4dGVuZHMga2V5b2YgVCxcbiAgICA+KG9iamVjdDogVCwgcHJvcGVydHk6IFApOiBCaW5kaW5nPFRbUF0+XG5cbiAgICBzdGF0aWMgYmluZDxUPihvYmplY3Q6IFN1YnNjcmliYWJsZTxUPik6IEJpbmRpbmc8VD5cblxuICAgIHN0YXRpYyBiaW5kKGVtaXR0ZXI6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlLCBwcm9wPzogc3RyaW5nKSB7XG4gICAgICAgIHJldHVybiBuZXcgQmluZGluZyhlbWl0dGVyLCBwcm9wKVxuICAgIH1cblxuICAgIHByaXZhdGUgY29uc3RydWN0b3IoZW1pdHRlcjogQ29ubmVjdGFibGUgfCBTdWJzY3JpYmFibGU8VmFsdWU+LCBwcm9wPzogc3RyaW5nKSB7XG4gICAgICAgIHRoaXMuI2VtaXR0ZXIgPSBlbWl0dGVyXG4gICAgICAgIHRoaXMuI3Byb3AgPSBwcm9wICYmIGtlYmFiaWZ5KHByb3ApXG4gICAgfVxuXG4gICAgdG9TdHJpbmcoKSB7XG4gICAgICAgIHJldHVybiBgQmluZGluZzwke3RoaXMuI2VtaXR0ZXJ9JHt0aGlzLiNwcm9wID8gYCwgXCIke3RoaXMuI3Byb3B9XCJgIDogXCJcIn0+YFxuICAgIH1cblxuICAgIGFzPFQ+KGZuOiAodjogVmFsdWUpID0+IFQpOiBCaW5kaW5nPFQ+IHtcbiAgICAgICAgY29uc3QgYmluZCA9IG5ldyBCaW5kaW5nKHRoaXMuI2VtaXR0ZXIsIHRoaXMuI3Byb3ApXG4gICAgICAgIGJpbmQudHJhbnNmb3JtRm4gPSAodjogVmFsdWUpID0+IGZuKHRoaXMudHJhbnNmb3JtRm4odikpXG4gICAgICAgIHJldHVybiBiaW5kIGFzIHVua25vd24gYXMgQmluZGluZzxUPlxuICAgIH1cblxuICAgIGdldCgpOiBWYWx1ZSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy4jZW1pdHRlci5nZXQgPT09IFwiZnVuY3Rpb25cIilcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybUZuKHRoaXMuI2VtaXR0ZXIuZ2V0KCkpXG5cbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNwcm9wID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBjb25zdCBnZXR0ZXIgPSBgZ2V0XyR7c25ha2VpZnkodGhpcy4jcHJvcCl9YFxuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzLiNlbWl0dGVyW2dldHRlcl0gPT09IFwiZnVuY3Rpb25cIilcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy50cmFuc2Zvcm1Gbih0aGlzLiNlbWl0dGVyW2dldHRlcl0oKSlcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtRm4odGhpcy4jZW1pdHRlclt0aGlzLiNwcm9wXSlcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IEVycm9yKFwiY2FuIG5vdCBnZXQgdmFsdWUgb2YgYmluZGluZ1wiKVxuICAgIH1cblxuICAgIHN1YnNjcmliZShjYWxsYmFjazogKHZhbHVlOiBWYWx1ZSkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuc3Vic2NyaWJlID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLiNlbWl0dGVyLnN1YnNjcmliZSgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sodGhpcy5nZXQoKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHRoaXMuI2VtaXR0ZXIuY29ubmVjdCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICBjb25zdCBzaWduYWwgPSBgbm90aWZ5Ojoke3RoaXMuI3Byb3B9YFxuICAgICAgICAgICAgY29uc3QgaWQgPSB0aGlzLiNlbWl0dGVyLmNvbm5lY3Qoc2lnbmFsLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2sodGhpcy5nZXQoKSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgICAgICAgICAgICh0aGlzLiNlbWl0dGVyLmRpc2Nvbm5lY3QgYXMgQ29ubmVjdGFibGVbXCJkaXNjb25uZWN0XCJdKShpZClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBFcnJvcihgJHt0aGlzLiNlbWl0dGVyfSBpcyBub3QgYmluZGFibGVgKVxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IHsgYmluZCB9ID0gQmluZGluZ1xuZXhwb3J0IGRlZmF1bHQgQmluZGluZ1xuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcblxuZXhwb3J0IHR5cGUgVGltZSA9IEFzdGFsLlRpbWVcbmV4cG9ydCBjb25zdCBUaW1lID0gQXN0YWwuVGltZVxuXG5leHBvcnQgZnVuY3Rpb24gaW50ZXJ2YWwoaW50ZXJ2YWw6IG51bWJlciwgY2FsbGJhY2s/OiAoKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIEFzdGFsLlRpbWUuaW50ZXJ2YWwoaW50ZXJ2YWwsICgpID0+IHZvaWQgY2FsbGJhY2s/LigpKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZW91dCh0aW1lb3V0OiBudW1iZXIsIGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLnRpbWVvdXQodGltZW91dCwgKCkgPT4gdm9pZCBjYWxsYmFjaz8uKCkpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpZGxlKGNhbGxiYWNrPzogKCkgPT4gdm9pZCkge1xuICAgIHJldHVybiBBc3RhbC5UaW1lLmlkbGUoKCkgPT4gdm9pZCBjYWxsYmFjaz8uKCkpXG59XG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsSU9cIlxuXG50eXBlIEFyZ3MgPSB7XG4gICAgY21kOiBzdHJpbmcgfCBzdHJpbmdbXVxuICAgIG91dD86IChzdGRvdXQ6IHN0cmluZykgPT4gdm9pZFxuICAgIGVycj86IChzdGRlcnI6IHN0cmluZykgPT4gdm9pZFxufVxuXG5leHBvcnQgdHlwZSBQcm9jZXNzID0gQXN0YWwuUHJvY2Vzc1xuZXhwb3J0IGNvbnN0IFByb2Nlc3MgPSBBc3RhbC5Qcm9jZXNzXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJwcm9jZXNzKGFyZ3M6IEFyZ3MpOiBBc3RhbC5Qcm9jZXNzXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJwcm9jZXNzKFxuICAgIGNtZDogc3RyaW5nIHwgc3RyaW5nW10sXG4gICAgb25PdXQ/OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWQsXG4gICAgb25FcnI/OiAoc3RkZXJyOiBzdHJpbmcpID0+IHZvaWQsXG4pOiBBc3RhbC5Qcm9jZXNzXG5cbmV4cG9ydCBmdW5jdGlvbiBzdWJwcm9jZXNzKFxuICAgIGFyZ3NPckNtZDogQXJncyB8IHN0cmluZyB8IHN0cmluZ1tdLFxuICAgIG9uT3V0OiAoc3Rkb3V0OiBzdHJpbmcpID0+IHZvaWQgPSBwcmludCxcbiAgICBvbkVycjogKHN0ZGVycjogc3RyaW5nKSA9PiB2b2lkID0gcHJpbnRlcnIsXG4pIHtcbiAgICBjb25zdCBhcmdzID0gQXJyYXkuaXNBcnJheShhcmdzT3JDbWQpIHx8IHR5cGVvZiBhcmdzT3JDbWQgPT09IFwic3RyaW5nXCJcbiAgICBjb25zdCB7IGNtZCwgZXJyLCBvdXQgfSA9IHtcbiAgICAgICAgY21kOiBhcmdzID8gYXJnc09yQ21kIDogYXJnc09yQ21kLmNtZCxcbiAgICAgICAgZXJyOiBhcmdzID8gb25FcnIgOiBhcmdzT3JDbWQuZXJyIHx8IG9uRXJyLFxuICAgICAgICBvdXQ6IGFyZ3MgPyBvbk91dCA6IGFyZ3NPckNtZC5vdXQgfHwgb25PdXQsXG4gICAgfVxuXG4gICAgY29uc3QgcHJvYyA9IEFycmF5LmlzQXJyYXkoY21kKVxuICAgICAgICA/IEFzdGFsLlByb2Nlc3Muc3VicHJvY2Vzc3YoY21kKVxuICAgICAgICA6IEFzdGFsLlByb2Nlc3Muc3VicHJvY2VzcyhjbWQpXG5cbiAgICBwcm9jLmNvbm5lY3QoXCJzdGRvdXRcIiwgKF8sIHN0ZG91dDogc3RyaW5nKSA9PiBvdXQoc3Rkb3V0KSlcbiAgICBwcm9jLmNvbm5lY3QoXCJzdGRlcnJcIiwgKF8sIHN0ZGVycjogc3RyaW5nKSA9PiBlcnIoc3RkZXJyKSlcbiAgICByZXR1cm4gcHJvY1xufVxuXG4vKiogQHRocm93cyB7R0xpYi5FcnJvcn0gVGhyb3dzIHN0ZGVyciAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV4ZWMoY21kOiBzdHJpbmcgfCBzdHJpbmdbXSkge1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KGNtZClcbiAgICAgICAgPyBBc3RhbC5Qcm9jZXNzLmV4ZWN2KGNtZClcbiAgICAgICAgOiBBc3RhbC5Qcm9jZXNzLmV4ZWMoY21kKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZXhlY0FzeW5jKGNtZDogc3RyaW5nIHwgc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGNtZCkpIHtcbiAgICAgICAgICAgIEFzdGFsLlByb2Nlc3MuZXhlY19hc3luY3YoY21kLCAoXywgcmVzKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5Qcm9jZXNzLmV4ZWNfYXN5bmN2X2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgQXN0YWwuUHJvY2Vzcy5leGVjX2FzeW5jKGNtZCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoQXN0YWwuUHJvY2Vzcy5leGVjX2ZpbmlzaChyZXMpKVxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgfSlcbn1cbiIsICJpbXBvcnQgVmFyaWFibGUgZnJvbSBcIi4vdmFyaWFibGUuanNcIlxuaW1wb3J0IHsgZXhlY0FzeW5jIH0gZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5pbXBvcnQgQmluZGluZywgeyBDb25uZWN0YWJsZSwga2ViYWJpZnksIHNuYWtlaWZ5LCBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi9iaW5kaW5nLmpzXCJcblxuZXhwb3J0IGNvbnN0IG5vSW1wbGljaXREZXN0cm95ID0gU3ltYm9sKFwibm8gbm8gaW1wbGljaXQgZGVzdHJveVwiKVxuZXhwb3J0IGNvbnN0IHNldENoaWxkcmVuID0gU3ltYm9sKFwiY2hpbGRyZW4gc2V0dGVyIG1ldGhvZFwiKVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VCaW5kaW5ncyhhcnJheTogYW55W10pIHtcbiAgICBmdW5jdGlvbiBnZXRWYWx1ZXMoLi4uYXJnczogYW55W10pIHtcbiAgICAgICAgbGV0IGkgPSAwXG4gICAgICAgIHJldHVybiBhcnJheS5tYXAodmFsdWUgPT4gdmFsdWUgaW5zdGFuY2VvZiBCaW5kaW5nXG4gICAgICAgICAgICA/IGFyZ3NbaSsrXVxuICAgICAgICAgICAgOiB2YWx1ZSxcbiAgICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGJpbmRpbmdzID0gYXJyYXkuZmlsdGVyKGkgPT4gaSBpbnN0YW5jZW9mIEJpbmRpbmcpXG5cbiAgICBpZiAoYmluZGluZ3MubGVuZ3RoID09PSAwKVxuICAgICAgICByZXR1cm4gYXJyYXlcblxuICAgIGlmIChiaW5kaW5ncy5sZW5ndGggPT09IDEpXG4gICAgICAgIHJldHVybiBiaW5kaW5nc1swXS5hcyhnZXRWYWx1ZXMpXG5cbiAgICByZXR1cm4gVmFyaWFibGUuZGVyaXZlKGJpbmRpbmdzLCBnZXRWYWx1ZXMpKClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNldFByb3Aob2JqOiBhbnksIHByb3A6IHN0cmluZywgdmFsdWU6IGFueSkge1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHNldHRlciA9IGBzZXRfJHtzbmFrZWlmeShwcm9wKX1gXG4gICAgICAgIGlmICh0eXBlb2Ygb2JqW3NldHRlcl0gPT09IFwiZnVuY3Rpb25cIilcbiAgICAgICAgICAgIHJldHVybiBvYmpbc2V0dGVyXSh2YWx1ZSlcblxuICAgICAgICByZXR1cm4gKG9ialtwcm9wXSA9IHZhbHVlKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYGNvdWxkIG5vdCBzZXQgcHJvcGVydHkgXCIke3Byb3B9XCIgb24gJHtvYmp9OmAsIGVycm9yKVxuICAgIH1cbn1cblxuZXhwb3J0IHR5cGUgQmluZGFibGVQcm9wczxUPiA9IHtcbiAgICBbSyBpbiBrZXlvZiBUXTogQmluZGluZzxUW0tdPiB8IFRbS107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBob29rPFdpZGdldCBleHRlbmRzIENvbm5lY3RhYmxlPihcbiAgICB3aWRnZXQ6IFdpZGdldCxcbiAgICBvYmplY3Q6IENvbm5lY3RhYmxlIHwgU3Vic2NyaWJhYmxlLFxuICAgIHNpZ25hbE9yQ2FsbGJhY2s6IHN0cmluZyB8ICgoc2VsZjogV2lkZ2V0LCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCksXG4gICAgY2FsbGJhY2s/OiAoc2VsZjogV2lkZ2V0LCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbikge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0LmNvbm5lY3QgPT09IFwiZnVuY3Rpb25cIiAmJiBjYWxsYmFjaykge1xuICAgICAgICBjb25zdCBpZCA9IG9iamVjdC5jb25uZWN0KHNpZ25hbE9yQ2FsbGJhY2ssIChfOiBhbnksIC4uLmFyZ3M6IHVua25vd25bXSkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHdpZGdldCwgLi4uYXJncylcbiAgICAgICAgfSlcbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsICgpID0+IHtcbiAgICAgICAgICAgIChvYmplY3QuZGlzY29ubmVjdCBhcyBDb25uZWN0YWJsZVtcImRpc2Nvbm5lY3RcIl0pKGlkKVxuICAgICAgICB9KVxuICAgIH0gZWxzZSBpZiAodHlwZW9mIG9iamVjdC5zdWJzY3JpYmUgPT09IFwiZnVuY3Rpb25cIiAmJiB0eXBlb2Ygc2lnbmFsT3JDYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGNvbnN0IHVuc3ViID0gb2JqZWN0LnN1YnNjcmliZSgoLi4uYXJnczogdW5rbm93bltdKSA9PiB7XG4gICAgICAgICAgICBzaWduYWxPckNhbGxiYWNrKHdpZGdldCwgLi4uYXJncylcbiAgICAgICAgfSlcbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIHVuc3ViKVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbnN0cnVjdDxXaWRnZXQgZXh0ZW5kcyBDb25uZWN0YWJsZSAmIHsgW3NldENoaWxkcmVuXTogKGNoaWxkcmVuOiBhbnlbXSkgPT4gdm9pZCB9Pih3aWRnZXQ6IFdpZGdldCwgY29uZmlnOiBhbnkpIHtcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgcHJlZmVyLWNvbnN0XG4gICAgbGV0IHsgc2V0dXAsIGNoaWxkLCBjaGlsZHJlbiA9IFtdLCAuLi5wcm9wcyB9ID0gY29uZmlnXG5cbiAgICBpZiAoY2hpbGRyZW4gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIGNoaWxkcmVuID0gW2NoaWxkcmVuXVxuICAgIH1cblxuICAgIGlmIChjaGlsZCkge1xuICAgICAgICBjaGlsZHJlbi51bnNoaWZ0KGNoaWxkKVxuICAgIH1cblxuICAgIC8vIHJlbW92ZSB1bmRlZmluZWQgdmFsdWVzXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocHJvcHMpKSB7XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkZWxldGUgcHJvcHNba2V5XVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLy8gY29sbGVjdCBiaW5kaW5nc1xuICAgIGNvbnN0IGJpbmRpbmdzOiBBcnJheTxbc3RyaW5nLCBCaW5kaW5nPGFueT5dPiA9IE9iamVjdFxuICAgICAgICAua2V5cyhwcm9wcylcbiAgICAgICAgLnJlZHVjZSgoYWNjOiBhbnksIHByb3ApID0+IHtcbiAgICAgICAgICAgIGlmIChwcm9wc1twcm9wXSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBiaW5kaW5nID0gcHJvcHNbcHJvcF1cbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHNbcHJvcF1cbiAgICAgICAgICAgICAgICByZXR1cm4gWy4uLmFjYywgW3Byb3AsIGJpbmRpbmddXVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjY1xuICAgICAgICB9LCBbXSlcblxuICAgIC8vIGNvbGxlY3Qgc2lnbmFsIGhhbmRsZXJzXG4gICAgY29uc3Qgb25IYW5kbGVyczogQXJyYXk8W3N0cmluZywgc3RyaW5nIHwgKCgpID0+IHVua25vd24pXT4gPSBPYmplY3RcbiAgICAgICAgLmtleXMocHJvcHMpXG4gICAgICAgIC5yZWR1Y2UoKGFjYzogYW55LCBrZXkpID0+IHtcbiAgICAgICAgICAgIGlmIChrZXkuc3RhcnRzV2l0aChcIm9uXCIpKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgc2lnID0ga2ViYWJpZnkoa2V5KS5zcGxpdChcIi1cIikuc2xpY2UoMSkuam9pbihcIi1cIilcbiAgICAgICAgICAgICAgICBjb25zdCBoYW5kbGVyID0gcHJvcHNba2V5XVxuICAgICAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1trZXldXG4gICAgICAgICAgICAgICAgcmV0dXJuIFsuLi5hY2MsIFtzaWcsIGhhbmRsZXJdXVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjY1xuICAgICAgICB9LCBbXSlcblxuICAgIC8vIHNldCBjaGlsZHJlblxuICAgIGNvbnN0IG1lcmdlZENoaWxkcmVuID0gbWVyZ2VCaW5kaW5ncyhjaGlsZHJlbi5mbGF0KEluZmluaXR5KSlcbiAgICBpZiAobWVyZ2VkQ2hpbGRyZW4gaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0obWVyZ2VkQ2hpbGRyZW4uZ2V0KCkpXG4gICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBtZXJnZWRDaGlsZHJlbi5zdWJzY3JpYmUoKHYpID0+IHtcbiAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0odilcbiAgICAgICAgfSkpXG4gICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKG1lcmdlZENoaWxkcmVuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHdpZGdldFtzZXRDaGlsZHJlbl0obWVyZ2VkQ2hpbGRyZW4pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBzZXR1cCBzaWduYWwgaGFuZGxlcnNcbiAgICBmb3IgKGNvbnN0IFtzaWduYWwsIGNhbGxiYWNrXSBvZiBvbkhhbmRsZXJzKSB7XG4gICAgICAgIGNvbnN0IHNpZyA9IHNpZ25hbC5zdGFydHNXaXRoKFwibm90aWZ5XCIpXG4gICAgICAgICAgICA/IHNpZ25hbC5yZXBsYWNlKFwiLVwiLCBcIjo6XCIpXG4gICAgICAgICAgICA6IHNpZ25hbFxuXG4gICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgd2lkZ2V0LmNvbm5lY3Qoc2lnLCBjYWxsYmFjaylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KHNpZywgKCkgPT4gZXhlY0FzeW5jKGNhbGxiYWNrKVxuICAgICAgICAgICAgICAgIC50aGVuKHByaW50KS5jYXRjaChjb25zb2xlLmVycm9yKSlcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIHNldHVwIGJpbmRpbmdzIGhhbmRsZXJzXG4gICAgZm9yIChjb25zdCBbcHJvcCwgYmluZGluZ10gb2YgYmluZGluZ3MpIHtcbiAgICAgICAgaWYgKHByb3AgPT09IFwiY2hpbGRcIiB8fCBwcm9wID09PSBcImNoaWxkcmVuXCIpIHtcbiAgICAgICAgICAgIHdpZGdldC5jb25uZWN0KFwiZGVzdHJveVwiLCBiaW5kaW5nLnN1YnNjcmliZSgodjogYW55KSA9PiB7XG4gICAgICAgICAgICAgICAgd2lkZ2V0W3NldENoaWxkcmVuXSh2KVxuICAgICAgICAgICAgfSkpXG4gICAgICAgIH1cbiAgICAgICAgd2lkZ2V0LmNvbm5lY3QoXCJkZXN0cm95XCIsIGJpbmRpbmcuc3Vic2NyaWJlKCh2OiBhbnkpID0+IHtcbiAgICAgICAgICAgIHNldFByb3Aod2lkZ2V0LCBwcm9wLCB2KVxuICAgICAgICB9KSlcbiAgICAgICAgc2V0UHJvcCh3aWRnZXQsIHByb3AsIGJpbmRpbmcuZ2V0KCkpXG4gICAgfVxuXG4gICAgLy8gZmlsdGVyIHVuZGVmaW5lZCB2YWx1ZXNcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhwcm9wcykpIHtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwcm9wc1trZXldXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBPYmplY3QuYXNzaWduKHdpZGdldCwgcHJvcHMpXG4gICAgc2V0dXA/Lih3aWRnZXQpXG4gICAgcmV0dXJuIHdpZGdldFxufVxuXG5mdW5jdGlvbiBpc0Fycm93RnVuY3Rpb24oZnVuYzogYW55KTogZnVuYyBpcyAoYXJnczogYW55KSA9PiBhbnkge1xuICAgIHJldHVybiAhT2JqZWN0Lmhhc093bihmdW5jLCBcInByb3RvdHlwZVwiKVxufVxuXG5leHBvcnQgZnVuY3Rpb24ganN4KFxuICAgIGN0b3JzOiBSZWNvcmQ8c3RyaW5nLCB7IG5ldyhwcm9wczogYW55KTogYW55IH0gfCAoKHByb3BzOiBhbnkpID0+IGFueSk+LFxuICAgIGN0b3I6IHN0cmluZyB8ICgocHJvcHM6IGFueSkgPT4gYW55KSB8IHsgbmV3KHByb3BzOiBhbnkpOiBhbnkgfSxcbiAgICB7IGNoaWxkcmVuLCAuLi5wcm9wcyB9OiBhbnksXG4pIHtcbiAgICBjaGlsZHJlbiA/Pz0gW11cblxuICAgIGlmICghQXJyYXkuaXNBcnJheShjaGlsZHJlbikpXG4gICAgICAgIGNoaWxkcmVuID0gW2NoaWxkcmVuXVxuXG4gICAgY2hpbGRyZW4gPSBjaGlsZHJlbi5maWx0ZXIoQm9vbGVhbilcblxuICAgIGlmIChjaGlsZHJlbi5sZW5ndGggPT09IDEpXG4gICAgICAgIHByb3BzLmNoaWxkID0gY2hpbGRyZW5bMF1cbiAgICBlbHNlIGlmIChjaGlsZHJlbi5sZW5ndGggPiAxKVxuICAgICAgICBwcm9wcy5jaGlsZHJlbiA9IGNoaWxkcmVuXG5cbiAgICBpZiAodHlwZW9mIGN0b3IgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaWYgKGlzQXJyb3dGdW5jdGlvbihjdG9yc1tjdG9yXSkpXG4gICAgICAgICAgICByZXR1cm4gY3RvcnNbY3Rvcl0ocHJvcHMpXG5cbiAgICAgICAgcmV0dXJuIG5ldyBjdG9yc1tjdG9yXShwcm9wcylcbiAgICB9XG5cbiAgICBpZiAoaXNBcnJvd0Z1bmN0aW9uKGN0b3IpKVxuICAgICAgICByZXR1cm4gY3Rvcihwcm9wcylcblxuICAgIHJldHVybiBuZXcgY3Rvcihwcm9wcylcbn1cbiIsICJpbXBvcnQgeyBub0ltcGxpY2l0RGVzdHJveSwgc2V0Q2hpbGRyZW4sIHR5cGUgQmluZGFibGVQcm9wcywgY29uc3RydWN0IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgQmluZGluZyBmcm9tIFwiLi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCBjb25zdCB0eXBlID0gU3ltYm9sKFwiY2hpbGQgdHlwZVwiKVxuY29uc3QgZHVtbXlCdWxkZXIgPSBuZXcgR3RrLkJ1aWxkZXJcblxuZnVuY3Rpb24gX2dldENoaWxkcmVuKHdpZGdldDogR3RrLldpZGdldCk6IEFycmF5PEd0ay5XaWRnZXQ+IHtcbiAgICBpZiAoXCJnZXRfY2hpbGRcIiBpbiB3aWRnZXQgJiYgdHlwZW9mIHdpZGdldC5nZXRfY2hpbGQgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiB3aWRnZXQuZ2V0X2NoaWxkKCkgPyBbd2lkZ2V0LmdldF9jaGlsZCgpXSA6IFtdXG4gICAgfVxuXG4gICAgY29uc3QgY2hpbGRyZW46IEFycmF5PEd0ay5XaWRnZXQ+ID0gW11cbiAgICBsZXQgY2ggPSB3aWRnZXQuZ2V0X2ZpcnN0X2NoaWxkKClcbiAgICB3aGlsZSAoY2ggIT09IG51bGwpIHtcbiAgICAgICAgY2hpbGRyZW4ucHVzaChjaClcbiAgICAgICAgY2ggPSBjaC5nZXRfbmV4dF9zaWJsaW5nKClcbiAgICB9XG4gICAgcmV0dXJuIGNoaWxkcmVuXG59XG5cbmZ1bmN0aW9uIF9zZXRDaGlsZHJlbih3aWRnZXQ6IEd0ay5XaWRnZXQsIGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIGNoaWxkcmVuID0gY2hpbGRyZW4uZmxhdChJbmZpbml0eSkubWFwKGNoID0+IGNoIGluc3RhbmNlb2YgR3RrLldpZGdldFxuICAgICAgICA/IGNoXG4gICAgICAgIDogbmV3IEd0ay5MYWJlbCh7IHZpc2libGU6IHRydWUsIGxhYmVsOiBTdHJpbmcoY2gpIH0pKVxuXG5cbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGNoaWxkcmVuKSB7XG4gICAgICAgIHdpZGdldC52ZnVuY19hZGRfY2hpbGQoXG4gICAgICAgICAgICBkdW1teUJ1bGRlcixcbiAgICAgICAgICAgIGNoaWxkLFxuICAgICAgICAgICAgdHlwZSBpbiBjaGlsZCA/IGNoaWxkW3R5cGVdIDogbnVsbCxcbiAgICAgICAgKVxuICAgIH1cbn1cblxudHlwZSBDb25maWc8VCBleHRlbmRzIEd0ay5XaWRnZXQ+ID0ge1xuICAgIHNldENoaWxkcmVuKHdpZGdldDogVCwgY2hpbGRyZW46IGFueVtdKTogdm9pZFxuICAgIGdldENoaWxkcmVuKHdpZGdldDogVCk6IEFycmF5PEd0ay5XaWRnZXQ+XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGFzdGFsaWZ5PFxuICAgIFdpZGdldCBleHRlbmRzIEd0ay5XaWRnZXQsXG4gICAgUHJvcHMgZXh0ZW5kcyBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMgPSBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMsXG4gICAgU2lnbmFscyBleHRlbmRzIFJlY29yZDxgb24ke3N0cmluZ31gLCBBcnJheTx1bmtub3duPj4gPSBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgYW55W10+LFxuPihjbHM6IHsgbmV3KC4uLmFyZ3M6IGFueVtdKTogV2lkZ2V0IH0sIGNvbmZpZzogUGFydGlhbDxDb25maWc8V2lkZ2V0Pj4gPSB7fSkge1xuICAgIE9iamVjdC5hc3NpZ24oY2xzLnByb3RvdHlwZSwge1xuICAgICAgICBbc2V0Q2hpbGRyZW5dKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgICAgICAgICAgY29uc3QgdyA9IHRoaXMgYXMgdW5rbm93biBhcyBXaWRnZXRcbiAgICAgICAgICAgIGZvciAoY29uc3QgY2hpbGQgb2YgKGNvbmZpZy5nZXRDaGlsZHJlbj8uKHcpIHx8IF9nZXRDaGlsZHJlbih3KSkpIHtcbiAgICAgICAgICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBHdGsuV2lkZ2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIGNoaWxkLnVucGFyZW50KClcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFjaGlsZHJlbi5pbmNsdWRlcyhjaGlsZCkgJiYgbm9JbXBsaWNpdERlc3Ryb3kgaW4gdGhpcylcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkLnJ1bl9kaXNwb3NlKClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjb25maWcuc2V0Q2hpbGRyZW4pIHtcbiAgICAgICAgICAgICAgICBjb25maWcuc2V0Q2hpbGRyZW4odywgY2hpbGRyZW4pXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIF9zZXRDaGlsZHJlbih3LCBjaGlsZHJlbilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgW2Nscy5uYW1lXTogKFxuICAgICAgICAgICAgcHJvcHM6IENvbnN0cnVjdFByb3BzPFdpZGdldCwgUHJvcHMsIFNpZ25hbHM+ID0ge30sXG4gICAgICAgICAgICAuLi5jaGlsZHJlbjogYW55W11cbiAgICAgICAgKTogV2lkZ2V0ID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHdpZGdldCA9IG5ldyBjbHMoXCJjc3NOYW1lXCIgaW4gcHJvcHMgPyB7IGNzc05hbWU6IHByb3BzLmNzc05hbWUgfSA6IHt9KVxuXG4gICAgICAgICAgICBpZiAoXCJjc3NOYW1lXCIgaW4gcHJvcHMpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgcHJvcHMuY3NzTmFtZVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAocHJvcHMubm9JbXBsaWNpdERlc3Ryb3kpIHtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHdpZGdldCwgeyBbbm9JbXBsaWNpdERlc3Ryb3ldOiB0cnVlIH0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLm5vSW1wbGljaXREZXN0cm95XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChwcm9wcy50eXBlKSB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHsgW3R5cGVdOiBwcm9wcy50eXBlIH0pXG4gICAgICAgICAgICAgICAgZGVsZXRlIHByb3BzLnR5cGVcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGNoaWxkcmVuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICBPYmplY3QuYXNzaWduKHByb3BzLCB7IGNoaWxkcmVuIH0pXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBjb25zdHJ1Y3Qod2lkZ2V0IGFzIGFueSwgc2V0dXBDb250cm9sbGVycyh3aWRnZXQsIHByb3BzIGFzIGFueSkpXG4gICAgICAgIH0sXG4gICAgfVtjbHMubmFtZV1cbn1cblxudHlwZSBTaWdIYW5kbGVyPFxuICAgIFcgZXh0ZW5kcyBJbnN0YW5jZVR5cGU8dHlwZW9mIEd0ay5XaWRnZXQ+LFxuICAgIEFyZ3MgZXh0ZW5kcyBBcnJheTx1bmtub3duPixcbj4gPSAoKHNlbGY6IFcsIC4uLmFyZ3M6IEFyZ3MpID0+IHVua25vd24pIHwgc3RyaW5nIHwgc3RyaW5nW11cblxuZXhwb3J0IHsgQmluZGFibGVQcm9wcyB9XG5leHBvcnQgdHlwZSBCaW5kYWJsZUNoaWxkID0gR3RrLldpZGdldCB8IEJpbmRpbmc8R3RrLldpZGdldD5cblxuZXhwb3J0IHR5cGUgQ29uc3RydWN0UHJvcHM8XG4gICAgU2VsZiBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgUHJvcHMgZXh0ZW5kcyBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMsXG4gICAgU2lnbmFscyBleHRlbmRzIFJlY29yZDxgb24ke3N0cmluZ31gLCBBcnJheTx1bmtub3duPj4gPSBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgYW55W10+LFxuPiA9IFBhcnRpYWw8e1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY2FuJ3QgYXNzaWduIHRvIHVua25vd24sIGJ1dCBpdCB3b3JrcyBhcyBleHBlY3RlZCB0aG91Z2hcbiAgICBbUyBpbiBrZXlvZiBTaWduYWxzXTogU2lnSGFuZGxlcjxTZWxmLCBTaWduYWxzW1NdPlxufT4gJiBQYXJ0aWFsPHtcbiAgICBbS2V5IGluIGBvbiR7c3RyaW5nfWBdOiBTaWdIYW5kbGVyPFNlbGYsIGFueVtdPlxufT4gJiBQYXJ0aWFsPEJpbmRhYmxlUHJvcHM8T21pdDxQcm9wcywgXCJjc3NOYW1lXCIgfCBcImNzc19uYW1lXCI+Pj4gJiB7XG4gICAgbm9JbXBsaWNpdERlc3Ryb3k/OiB0cnVlXG4gICAgdHlwZT86IHN0cmluZ1xuICAgIGNzc05hbWU/OiBzdHJpbmdcbn0gJiBFdmVudENvbnRyb2xsZXI8U2VsZj4gJiB7XG4gICAgb25EZXN0cm95PzogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBzZXR1cD86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG59XG5cbnR5cGUgRXZlbnRDb250cm9sbGVyPFNlbGYgZXh0ZW5kcyBHdGsuV2lkZ2V0PiA9IHtcbiAgICBvbkZvY3VzRW50ZXI/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuICAgIG9uRm9jdXNMZWF2ZT86IChzZWxmOiBTZWxmKSA9PiB2b2lkXG5cbiAgICBvbktleVByZXNzZWQ/OiAoc2VsZjogU2VsZiwga2V5dmFsOiBudW1iZXIsIGtleWNvZGU6IG51bWJlciwgc3RhdGU6IEdkay5Nb2RpZmllclR5cGUpID0+IHZvaWRcbiAgICBvbktleVJlbGVhc2VkPzogKHNlbGY6IFNlbGYsIGtleXZhbDogbnVtYmVyLCBrZXljb2RlOiBudW1iZXIsIHN0YXRlOiBHZGsuTW9kaWZpZXJUeXBlKSA9PiB2b2lkXG4gICAgb25LZXlNb2RpZmllcj86IChzZWxmOiBTZWxmLCBzdGF0ZTogR2RrLk1vZGlmaWVyVHlwZSkgPT4gdm9pZFxuXG4gICAgb25MZWdhY3k/OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdm9pZFxuICAgIG9uQnV0dG9uUHJlc3NlZD86IChzZWxmOiBTZWxmLCBzdGF0ZTogR2RrLkJ1dHRvbkV2ZW50KSA9PiB2b2lkXG4gICAgb25CdXR0b25SZWxlYXNlZD86IChzZWxmOiBTZWxmLCBzdGF0ZTogR2RrLkJ1dHRvbkV2ZW50KSA9PiB2b2lkXG5cbiAgICBvbkhvdmVyRW50ZXI/OiAoc2VsZjogU2VsZiwgeDogbnVtYmVyLCB5OiBudW1iZXIpID0+IHZvaWRcbiAgICBvbkhvdmVyTGVhdmU/OiAoc2VsZjogU2VsZikgPT4gdm9pZFxuICAgIG9uTW90aW9uPzogKHNlbGY6IFNlbGYsIHg6IG51bWJlciwgeTogbnVtYmVyKSA9PiB2b2lkXG5cbiAgICBvblNjcm9sbD86IChzZWxmOiBTZWxmLCBkeDogbnVtYmVyLCBkeTogbnVtYmVyKSA9PiB2b2lkXG4gICAgb25TY3JvbGxEZWNlbGVyYXRlPzogKHNlbGY6IFNlbGYsIHZlbF94OiBudW1iZXIsIHZlbF95OiBudW1iZXIpID0+IHZvaWRcbn1cblxuZnVuY3Rpb24gc2V0dXBDb250cm9sbGVyczxUPih3aWRnZXQ6IEd0ay5XaWRnZXQsIHtcbiAgICBvbkZvY3VzRW50ZXIsXG4gICAgb25Gb2N1c0xlYXZlLFxuICAgIG9uS2V5UHJlc3NlZCxcbiAgICBvbktleVJlbGVhc2VkLFxuICAgIG9uS2V5TW9kaWZpZXIsXG4gICAgb25MZWdhY3ksXG4gICAgb25CdXR0b25QcmVzc2VkLFxuICAgIG9uQnV0dG9uUmVsZWFzZWQsXG4gICAgb25Ib3ZlckVudGVyLFxuICAgIG9uSG92ZXJMZWF2ZSxcbiAgICBvbk1vdGlvbixcbiAgICBvblNjcm9sbCxcbiAgICBvblNjcm9sbERlY2VsZXJhdGUsXG4gICAgLi4ucHJvcHNcbn06IEV2ZW50Q29udHJvbGxlcjxHdGsuV2lkZ2V0PiAmIFQpIHtcbiAgICBpZiAob25Gb2N1c0VudGVyIHx8IG9uRm9jdXNMZWF2ZSkge1xuICAgICAgICBjb25zdCBmb2N1cyA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyRm9jdXNcbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGZvY3VzKVxuXG4gICAgICAgIGlmIChvbkZvY3VzRW50ZXIpXG4gICAgICAgICAgICBmb2N1cy5jb25uZWN0KFwiZW50ZXJcIiwgKCkgPT4gb25Gb2N1c0VudGVyKHdpZGdldCkpXG5cbiAgICAgICAgaWYgKG9uRm9jdXNMZWF2ZSlcbiAgICAgICAgICAgIGZvY3VzLmNvbm5lY3QoXCJsZWF2ZVwiLCAoKSA9PiBvbkZvY3VzTGVhdmUod2lkZ2V0KSlcbiAgICB9XG5cbiAgICBpZiAob25LZXlQcmVzc2VkIHx8IG9uS2V5UmVsZWFzZWQgfHwgb25LZXlNb2RpZmllcikge1xuICAgICAgICBjb25zdCBrZXkgPSBuZXcgR3RrLkV2ZW50Q29udHJvbGxlcktleVxuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoa2V5KVxuXG4gICAgICAgIGlmIChvbktleVByZXNzZWQpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcImtleS1wcmVzc2VkXCIsIChfLCB2YWwsIGNvZGUsIHN0YXRlKSA9PiBvbktleVByZXNzZWQod2lkZ2V0LCB2YWwsIGNvZGUsIHN0YXRlKSlcblxuICAgICAgICBpZiAob25LZXlSZWxlYXNlZClcbiAgICAgICAgICAgIGtleS5jb25uZWN0KFwia2V5LXJlbGVhc2VkXCIsIChfLCB2YWwsIGNvZGUsIHN0YXRlKSA9PiBvbktleVJlbGVhc2VkKHdpZGdldCwgdmFsLCBjb2RlLCBzdGF0ZSkpXG5cbiAgICAgICAgaWYgKG9uS2V5TW9kaWZpZXIpXG4gICAgICAgICAgICBrZXkuY29ubmVjdChcIm1vZGlmaWVyc1wiLCAoXywgc3RhdGUpID0+IG9uS2V5TW9kaWZpZXIod2lkZ2V0LCBzdGF0ZSkpXG4gICAgfVxuXG4gICAgaWYgKG9uTGVnYWN5IHx8IG9uQnV0dG9uUHJlc3NlZCB8fCBvbkJ1dHRvblJlbGVhc2VkKSB7XG4gICAgICAgIGNvbnN0IGxlZ2FjeSA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyTGVnYWN5XG4gICAgICAgIHdpZGdldC5hZGRfY29udHJvbGxlcihsZWdhY3kpXG5cbiAgICAgICAgbGVnYWN5LmNvbm5lY3QoXCJldmVudFwiLCAoXywgZXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmIChldmVudC5nZXRfZXZlbnRfdHlwZSgpID09PSBHZGsuRXZlbnRUeXBlLkJVVFRPTl9QUkVTUykge1xuICAgICAgICAgICAgICAgIG9uQnV0dG9uUHJlc3NlZD8uKHdpZGdldCwgZXZlbnQgYXMgR2RrLkJ1dHRvbkV2ZW50KVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZXZlbnQuZ2V0X2V2ZW50X3R5cGUoKSA9PT0gR2RrLkV2ZW50VHlwZS5CVVRUT05fUkVMRUFTRSkge1xuICAgICAgICAgICAgICAgIG9uQnV0dG9uUmVsZWFzZWQ/Lih3aWRnZXQsIGV2ZW50IGFzIEdkay5CdXR0b25FdmVudClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb25MZWdhY3k/Lih3aWRnZXQsIGV2ZW50KVxuICAgICAgICB9KVxuICAgIH1cblxuICAgIGlmIChvbk1vdGlvbiB8fCBvbkhvdmVyRW50ZXIgfHwgb25Ib3ZlckxlYXZlKSB7XG4gICAgICAgIGNvbnN0IGhvdmVyID0gbmV3IEd0ay5FdmVudENvbnRyb2xsZXJNb3Rpb25cbiAgICAgICAgd2lkZ2V0LmFkZF9jb250cm9sbGVyKGhvdmVyKVxuXG4gICAgICAgIGlmIChvbkhvdmVyRW50ZXIpXG4gICAgICAgICAgICBob3Zlci5jb25uZWN0KFwiZW50ZXJcIiwgKF8sIHgsIHkpID0+IG9uSG92ZXJFbnRlcih3aWRnZXQsIHgsIHkpKVxuXG4gICAgICAgIGlmIChvbkhvdmVyTGVhdmUpXG4gICAgICAgICAgICBob3Zlci5jb25uZWN0KFwibGVhdmVcIiwgKCkgPT4gb25Ib3ZlckxlYXZlKHdpZGdldCkpXG5cbiAgICAgICAgaWYgKG9uTW90aW9uKVxuICAgICAgICAgICAgaG92ZXIuY29ubmVjdChcIm1vdGlvblwiLCAoXywgeCwgeSkgPT4gb25Nb3Rpb24od2lkZ2V0LCB4LCB5KSlcbiAgICB9XG5cbiAgICBpZiAob25TY3JvbGwgfHwgb25TY3JvbGxEZWNlbGVyYXRlKSB7XG4gICAgICAgIGNvbnN0IHNjcm9sbCA9IG5ldyBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsXG4gICAgICAgIHNjcm9sbC5mbGFncyA9IEd0ay5FdmVudENvbnRyb2xsZXJTY3JvbGxGbGFncy5CT1RIX0FYRVMgfCBHdGsuRXZlbnRDb250cm9sbGVyU2Nyb2xsRmxhZ3MuS0lORVRJQ1xuICAgICAgICB3aWRnZXQuYWRkX2NvbnRyb2xsZXIoc2Nyb2xsKVxuXG4gICAgICAgIGlmIChvblNjcm9sbClcbiAgICAgICAgICAgIHNjcm9sbC5jb25uZWN0KFwic2Nyb2xsXCIsIChfLCB4LCB5KSA9PiBvblNjcm9sbCh3aWRnZXQsIHgsIHkpKVxuXG4gICAgICAgIGlmIChvblNjcm9sbERlY2VsZXJhdGUpXG4gICAgICAgICAgICBzY3JvbGwuY29ubmVjdChcImRlY2VsZXJhdGVcIiwgKF8sIHgsIHkpID0+IG9uU2Nyb2xsRGVjZWxlcmF0ZSh3aWRnZXQsIHgsIHkpKVxuICAgIH1cblxuICAgIHJldHVybiBwcm9wc1xufVxuIiwgImltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWI/dmVyc2lvbj0yLjBcIlxuaW1wb3J0IEd0ayBmcm9tIFwiZ2k6Ly9HdGs/dmVyc2lvbj00LjBcIlxuaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcbmltcG9ydCB7IG1rQXBwIH0gZnJvbSBcIi4uL19hcHBcIlxuXG5HdGsuaW5pdCgpXG5cbi8vIHN0b3AgdGhpcyBmcm9tIGxlYWtpbmcgaW50byBzdWJwcm9jZXNzZXNcbi8vIGFuZCBnaW8gbGF1bmNoIGludm9jYXRpb25zXG5HTGliLnVuc2V0ZW52KFwiTERfUFJFTE9BRFwiKVxuXG4vLyB1c2VycyBtaWdodCB3YW50IHRvIHVzZSBBZHdhaXRhIGluIHdoaWNoIGNhc2UgaXQgaGFzIHRvIGJlIGluaXRpYWxpemVkXG4vLyBpdCBtaWdodCBiZSBjb21tb24gcGl0ZmFsbCB0byBmb3JnZXQgaXQgYmVjYXVzZSBgQXBwYCBpcyBub3QgYEFkdy5BcHBsaWNhdGlvbmBcbmF3YWl0IGltcG9ydChcImdpOi8vQWR3P3ZlcnNpb249MVwiKVxuICAgIC50aGVuKCh7IGRlZmF1bHQ6IEFkdyB9KSA9PiBBZHcuaW5pdCgpKVxuICAgIC5jYXRjaCgoKSA9PiB2b2lkIDApXG5cbmV4cG9ydCBkZWZhdWx0IG1rQXBwKEFzdGFsLkFwcGxpY2F0aW9uKVxuIiwgIi8qKlxuICogV29ya2Fyb3VuZCBmb3IgXCJDYW4ndCBjb252ZXJ0IG5vbi1udWxsIHBvaW50ZXIgdG8gSlMgdmFsdWUgXCJcbiAqL1xuXG5leHBvcnQgeyB9XG5cbmNvbnN0IHNuYWtlaWZ5ID0gKHN0cjogc3RyaW5nKSA9PiBzdHJcbiAgICAucmVwbGFjZSgvKFthLXpdKShbQS1aXSkvZywgXCIkMV8kMlwiKVxuICAgIC5yZXBsYWNlQWxsKFwiLVwiLCBcIl9cIilcbiAgICAudG9Mb3dlckNhc2UoKVxuXG5hc3luYyBmdW5jdGlvbiBzdXBwcmVzczxUPihtb2Q6IFByb21pc2U8eyBkZWZhdWx0OiBUIH0+LCBwYXRjaDogKG06IFQpID0+IHZvaWQpIHtcbiAgICByZXR1cm4gbW9kLnRoZW4obSA9PiBwYXRjaChtLmRlZmF1bHQpKS5jYXRjaCgoKSA9PiB2b2lkIDApXG59XG5cbmZ1bmN0aW9uIHBhdGNoPFAgZXh0ZW5kcyBvYmplY3Q+KHByb3RvOiBQLCBwcm9wOiBFeHRyYWN0PGtleW9mIFAsIHN0cmluZz4pIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG8sIHByb3AsIHtcbiAgICAgICAgZ2V0KCkgeyByZXR1cm4gdGhpc1tgZ2V0XyR7c25ha2VpZnkocHJvcCl9YF0oKSB9LFxuICAgIH0pXG59XG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxBcHBzXCIpLCAoeyBBcHBzLCBBcHBsaWNhdGlvbiB9KSA9PiB7XG4gICAgcGF0Y2goQXBwcy5wcm90b3R5cGUsIFwibGlzdFwiKVxuICAgIHBhdGNoKEFwcGxpY2F0aW9uLnByb3RvdHlwZSwgXCJrZXl3b3Jkc1wiKVxuICAgIHBhdGNoKEFwcGxpY2F0aW9uLnByb3RvdHlwZSwgXCJjYXRlZ29yaWVzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsQmF0dGVyeVwiKSwgKHsgVVBvd2VyIH0pID0+IHtcbiAgICBwYXRjaChVUG93ZXIucHJvdG90eXBlLCBcImRldmljZXNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxCbHVldG9vdGhcIiksICh7IEFkYXB0ZXIsIEJsdWV0b290aCwgRGV2aWNlIH0pID0+IHtcbiAgICBwYXRjaChBZGFwdGVyLnByb3RvdHlwZSwgXCJ1dWlkc1wiKVxuICAgIHBhdGNoKEJsdWV0b290aC5wcm90b3R5cGUsIFwiYWRhcHRlcnNcIilcbiAgICBwYXRjaChCbHVldG9vdGgucHJvdG90eXBlLCBcImRldmljZXNcIilcbiAgICBwYXRjaChEZXZpY2UucHJvdG90eXBlLCBcInV1aWRzXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsSHlwcmxhbmRcIiksICh7IEh5cHJsYW5kLCBNb25pdG9yLCBXb3Jrc3BhY2UgfSkgPT4ge1xuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJiaW5kc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJtb25pdG9yc1wiKVxuICAgIHBhdGNoKEh5cHJsYW5kLnByb3RvdHlwZSwgXCJ3b3Jrc3BhY2VzXCIpXG4gICAgcGF0Y2goSHlwcmxhbmQucHJvdG90eXBlLCBcImNsaWVudHNcIilcbiAgICBwYXRjaChNb25pdG9yLnByb3RvdHlwZSwgXCJhdmFpbGFibGVNb2Rlc1wiKVxuICAgIHBhdGNoKE1vbml0b3IucHJvdG90eXBlLCBcImF2YWlsYWJsZV9tb2Rlc1wiKVxuICAgIHBhdGNoKFdvcmtzcGFjZS5wcm90b3R5cGUsIFwiY2xpZW50c1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbE1wcmlzXCIpLCAoeyBNcHJpcywgUGxheWVyIH0pID0+IHtcbiAgICBwYXRjaChNcHJpcy5wcm90b3R5cGUsIFwicGxheWVyc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkX3VyaV9zY2hlbWVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRVcmlTY2hlbWVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJzdXBwb3J0ZWRfbWltZV90eXBlc1wiKVxuICAgIHBhdGNoKFBsYXllci5wcm90b3R5cGUsIFwic3VwcG9ydGVkTWltZVR5cGVzXCIpXG4gICAgcGF0Y2goUGxheWVyLnByb3RvdHlwZSwgXCJjb21tZW50c1wiKVxufSlcblxuYXdhaXQgc3VwcHJlc3MoaW1wb3J0KFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIiksICh7IFdpZmkgfSkgPT4ge1xuICAgIHBhdGNoKFdpZmkucHJvdG90eXBlLCBcImFjY2Vzc19wb2ludHNcIilcbiAgICBwYXRjaChXaWZpLnByb3RvdHlwZSwgXCJhY2Nlc3NQb2ludHNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxOb3RpZmRcIiksICh7IE5vdGlmZCwgTm90aWZpY2F0aW9uIH0pID0+IHtcbiAgICBwYXRjaChOb3RpZmQucHJvdG90eXBlLCBcIm5vdGlmaWNhdGlvbnNcIilcbiAgICBwYXRjaChOb3RpZmljYXRpb24ucHJvdG90eXBlLCBcImFjdGlvbnNcIilcbn0pXG5cbmF3YWl0IHN1cHByZXNzKGltcG9ydChcImdpOi8vQXN0YWxQb3dlclByb2ZpbGVzXCIpLCAoeyBQb3dlclByb2ZpbGVzIH0pID0+IHtcbiAgICBwYXRjaChQb3dlclByb2ZpbGVzLnByb3RvdHlwZSwgXCJhY3Rpb25zXCIpXG59KVxuXG5hd2FpdCBzdXBwcmVzcyhpbXBvcnQoXCJnaTovL0FzdGFsV3BcIiksICh7IFdwLCBBdWRpbywgVmlkZW8gfSkgPT4ge1xuICAgIHBhdGNoKFdwLnByb3RvdHlwZSwgXCJlbmRwb2ludHNcIilcbiAgICBwYXRjaChXcC5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJzdHJlYW1zXCIpXG4gICAgcGF0Y2goQXVkaW8ucHJvdG90eXBlLCBcInJlY29yZGVyc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJtaWNyb3Bob25lc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJzcGVha2Vyc1wiKVxuICAgIHBhdGNoKEF1ZGlvLnByb3RvdHlwZSwgXCJkZXZpY2VzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInN0cmVhbXNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwicmVjb3JkZXJzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInNpbmtzXCIpXG4gICAgcGF0Y2goVmlkZW8ucHJvdG90eXBlLCBcInNvdXJjZXNcIilcbiAgICBwYXRjaChWaWRlby5wcm90b3R5cGUsIFwiZGV2aWNlc1wiKVxufSlcbiIsICJpbXBvcnQgXCIuL292ZXJyaWRlcy5qc1wiXG5pbXBvcnQgeyBzZXRDb25zb2xlTG9nRG9tYWluIH0gZnJvbSBcImNvbnNvbGVcIlxuaW1wb3J0IHsgZXhpdCwgcHJvZ3JhbUFyZ3MgfSBmcm9tIFwic3lzdGVtXCJcbmltcG9ydCBJTyBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW8/dmVyc2lvbj0yLjBcIlxuaW1wb3J0IHR5cGUgQXN0YWwzIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249My4wXCJcbmltcG9ydCB0eXBlIEFzdGFsNCBmcm9tIFwiZ2k6Ly9Bc3RhbD92ZXJzaW9uPTQuMFwiXG5cbnR5cGUgQ29uZmlnID0gUGFydGlhbDx7XG4gICAgaW5zdGFuY2VOYW1lOiBzdHJpbmdcbiAgICBjc3M6IHN0cmluZ1xuICAgIGljb25zOiBzdHJpbmdcbiAgICBndGtUaGVtZTogc3RyaW5nXG4gICAgaWNvblRoZW1lOiBzdHJpbmdcbiAgICBjdXJzb3JUaGVtZTogc3RyaW5nXG4gICAgaG9sZDogYm9vbGVhblxuICAgIHJlcXVlc3RIYW5kbGVyKHJlcXVlc3Q6IHN0cmluZywgcmVzOiAocmVzcG9uc2U6IGFueSkgPT4gdm9pZCk6IHZvaWRcbiAgICBtYWluKC4uLmFyZ3M6IHN0cmluZ1tdKTogdm9pZFxuICAgIGNsaWVudChtZXNzYWdlOiAobXNnOiBzdHJpbmcpID0+IHN0cmluZywgLi4uYXJnczogc3RyaW5nW10pOiB2b2lkXG59PlxuXG5pbnRlcmZhY2UgQXN0YWwzSlMgZXh0ZW5kcyBBc3RhbDMuQXBwbGljYXRpb24ge1xuICAgIGV2YWwoYm9keTogc3RyaW5nKTogUHJvbWlzZTxhbnk+XG4gICAgcmVxdWVzdEhhbmRsZXI6IENvbmZpZ1tcInJlcXVlc3RIYW5kbGVyXCJdXG4gICAgYXBwbHlfY3NzKHN0eWxlOiBzdHJpbmcsIHJlc2V0PzogYm9vbGVhbik6IHZvaWRcbiAgICBxdWl0KGNvZGU/OiBudW1iZXIpOiB2b2lkXG4gICAgc3RhcnQoY29uZmlnPzogQ29uZmlnKTogdm9pZFxufVxuXG5pbnRlcmZhY2UgQXN0YWw0SlMgZXh0ZW5kcyBBc3RhbDQuQXBwbGljYXRpb24ge1xuICAgIGV2YWwoYm9keTogc3RyaW5nKTogUHJvbWlzZTxhbnk+XG4gICAgcmVxdWVzdEhhbmRsZXI/OiBDb25maWdbXCJyZXF1ZXN0SGFuZGxlclwiXVxuICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldD86IGJvb2xlYW4pOiB2b2lkXG4gICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZFxuICAgIHN0YXJ0KGNvbmZpZz86IENvbmZpZyk6IHZvaWRcbn1cblxudHlwZSBBcHAzID0gdHlwZW9mIEFzdGFsMy5BcHBsaWNhdGlvblxudHlwZSBBcHA0ID0gdHlwZW9mIEFzdGFsNC5BcHBsaWNhdGlvblxuXG5leHBvcnQgZnVuY3Rpb24gbWtBcHA8QXBwIGV4dGVuZHMgQXBwMz4oQXBwOiBBcHApOiBBc3RhbDNKU1xuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwPEFwcCBleHRlbmRzIEFwcDQ+KEFwcDogQXBwKTogQXN0YWw0SlNcblxuZXhwb3J0IGZ1bmN0aW9uIG1rQXBwKEFwcDogQXBwMyB8IEFwcDQpIHtcbiAgICByZXR1cm4gbmV3IChjbGFzcyBBc3RhbEpTIGV4dGVuZHMgQXBwIHtcbiAgICAgICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkFzdGFsSlNcIiB9LCB0aGlzIGFzIGFueSkgfVxuXG4gICAgICAgIGV2YWwoYm9keTogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzLCByZWopID0+IHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmbiA9IEZ1bmN0aW9uKGByZXR1cm4gKGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgJHtib2R5LmluY2x1ZGVzKFwiO1wiKSA/IGJvZHkgOiBgcmV0dXJuICR7Ym9keX07YH1cbiAgICAgICAgICAgICAgICAgICAgfSlgKVxuICAgICAgICAgICAgICAgICAgICBmbigpKCkudGhlbihyZXMpLmNhdGNoKHJlailcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgICAgICByZWooZXJyb3IpXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJlcXVlc3RIYW5kbGVyPzogQ29uZmlnW1wicmVxdWVzdEhhbmRsZXJcIl1cblxuICAgICAgICB2ZnVuY19yZXF1ZXN0KG1zZzogc3RyaW5nLCBjb25uOiBHaW8uU29ja2V0Q29ubmVjdGlvbik6IHZvaWQge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB0aGlzLnJlcXVlc3RIYW5kbGVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnJlcXVlc3RIYW5kbGVyKG1zZywgKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIElPLndyaXRlX3NvY2soY29ubiwgU3RyaW5nKHJlc3BvbnNlKSwgKF8sIHJlcykgPT5cbiAgICAgICAgICAgICAgICAgICAgICAgIElPLndyaXRlX3NvY2tfZmluaXNoKHJlcyksXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdXBlci52ZnVuY19yZXF1ZXN0KG1zZywgY29ubilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFwcGx5X2NzcyhzdHlsZTogc3RyaW5nLCByZXNldCA9IGZhbHNlKSB7XG4gICAgICAgICAgICBzdXBlci5hcHBseV9jc3Moc3R5bGUsIHJlc2V0KVxuICAgICAgICB9XG5cbiAgICAgICAgcXVpdChjb2RlPzogbnVtYmVyKTogdm9pZCB7XG4gICAgICAgICAgICBzdXBlci5xdWl0KClcbiAgICAgICAgICAgIGV4aXQoY29kZSA/PyAwKVxuICAgICAgICB9XG5cbiAgICAgICAgc3RhcnQoeyByZXF1ZXN0SGFuZGxlciwgY3NzLCBob2xkLCBtYWluLCBjbGllbnQsIGljb25zLCAuLi5jZmcgfTogQ29uZmlnID0ge30pIHtcbiAgICAgICAgICAgIGNvbnN0IGFwcCA9IHRoaXMgYXMgdW5rbm93biBhcyBJbnN0YW5jZVR5cGU8QXBwMyB8IEFwcDQ+XG5cbiAgICAgICAgICAgIGNsaWVudCA/Pz0gKCkgPT4ge1xuICAgICAgICAgICAgICAgIHByaW50KGBBc3RhbCBpbnN0YW5jZSBcIiR7YXBwLmluc3RhbmNlTmFtZX1cIiBhbHJlYWR5IHJ1bm5pbmdgKVxuICAgICAgICAgICAgICAgIGV4aXQoMSlcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbih0aGlzLCBjZmcpXG4gICAgICAgICAgICBzZXRDb25zb2xlTG9nRG9tYWluKGFwcC5pbnN0YW5jZU5hbWUpXG5cbiAgICAgICAgICAgIHRoaXMucmVxdWVzdEhhbmRsZXIgPSByZXF1ZXN0SGFuZGxlclxuICAgICAgICAgICAgYXBwLmNvbm5lY3QoXCJhY3RpdmF0ZVwiLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgbWFpbj8uKC4uLnByb2dyYW1BcmdzKVxuICAgICAgICAgICAgfSlcblxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBhcHAuYWNxdWlyZV9zb2NrZXQoKVxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY2xpZW50KG1zZyA9PiBJTy5zZW5kX3JlcXVlc3QoYXBwLmluc3RhbmNlTmFtZSwgbXNnKSEsIC4uLnByb2dyYW1BcmdzKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoY3NzKVxuICAgICAgICAgICAgICAgIHRoaXMuYXBwbHlfY3NzKGNzcywgZmFsc2UpXG5cbiAgICAgICAgICAgIGlmIChpY29ucylcbiAgICAgICAgICAgICAgICBhcHAuYWRkX2ljb25zKGljb25zKVxuXG4gICAgICAgICAgICBob2xkID8/PSB0cnVlXG4gICAgICAgICAgICBpZiAoaG9sZClcbiAgICAgICAgICAgICAgICBhcHAuaG9sZCgpXG5cbiAgICAgICAgICAgIGFwcC5ydW5Bc3luYyhbXSlcbiAgICAgICAgfVxuICAgIH0pXG59XG4iLCAiaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249NC4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcbmltcG9ydCBhc3RhbGlmeSwgeyB0eXBlLCB0eXBlIENvbnN0cnVjdFByb3BzIH0gZnJvbSBcIi4vYXN0YWxpZnkuanNcIlxuXG5mdW5jdGlvbiBmaWx0ZXIoY2hpbGRyZW46IGFueVtdKSB7XG4gICAgcmV0dXJuIGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgPyBjaFxuICAgICAgICA6IG5ldyBHdGsuTGFiZWwoeyB2aXNpYmxlOiB0cnVlLCBsYWJlbDogU3RyaW5nKGNoKSB9KSlcbn1cblxuLy8gQm94XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoQXN0YWwuQm94LnByb3RvdHlwZSwgXCJjaGlsZHJlblwiLCB7XG4gICAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfY2hpbGRyZW4oKSB9LFxuICAgIHNldCh2KSB7IHRoaXMuc2V0X2NoaWxkcmVuKHYpIH0sXG59KVxuXG5leHBvcnQgdHlwZSBCb3hQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLkJveCwgQXN0YWwuQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgQm94ID0gYXN0YWxpZnk8QXN0YWwuQm94LCBBc3RhbC5Cb3guQ29uc3RydWN0b3JQcm9wcz4oQXN0YWwuQm94LCB7XG4gICAgZ2V0Q2hpbGRyZW4oc2VsZikgeyByZXR1cm4gc2VsZi5nZXRfY2hpbGRyZW4oKSB9LFxuICAgIHNldENoaWxkcmVuKHNlbGYsIGNoaWxkcmVuKSB7IHJldHVybiBzZWxmLnNldF9jaGlsZHJlbihmaWx0ZXIoY2hpbGRyZW4pKSB9LFxufSlcblxuLy8gQnV0dG9uXG50eXBlIEJ1dHRvblNpZ25hbHMgPSB7XG4gICAgb25DbGlja2VkOiBbXVxufVxuXG5leHBvcnQgdHlwZSBCdXR0b25Qcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5CdXR0b24sIEd0ay5CdXR0b24uQ29uc3RydWN0b3JQcm9wcywgQnV0dG9uU2lnbmFscz5cbmV4cG9ydCBjb25zdCBCdXR0b24gPSBhc3RhbGlmeTxHdGsuQnV0dG9uLCBHdGsuQnV0dG9uLkNvbnN0cnVjdG9yUHJvcHMsIEJ1dHRvblNpZ25hbHM+KEd0ay5CdXR0b24pXG5cbi8vIENlbnRlckJveFxuZXhwb3J0IHR5cGUgQ2VudGVyQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuQ2VudGVyQm94LCBHdGsuQ2VudGVyQm94LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgQ2VudGVyQm94ID0gYXN0YWxpZnk8R3RrLkNlbnRlckJveCwgR3RrLkNlbnRlckJveC5Db25zdHJ1Y3RvclByb3BzPihHdGsuQ2VudGVyQm94LCB7XG4gICAgZ2V0Q2hpbGRyZW4oYm94KSB7XG4gICAgICAgIHJldHVybiBbYm94LnN0YXJ0V2lkZ2V0LCBib3guY2VudGVyV2lkZ2V0LCBib3guZW5kV2lkZ2V0XVxuICAgIH0sXG4gICAgc2V0Q2hpbGRyZW4oYm94LCBjaGlsZHJlbikge1xuICAgICAgICBjb25zdCBjaCA9IGZpbHRlcihjaGlsZHJlbilcbiAgICAgICAgYm94LnN0YXJ0V2lkZ2V0ID0gY2hbMF0gfHwgbmV3IEd0ay5Cb3hcbiAgICAgICAgYm94LmNlbnRlcldpZGdldCA9IGNoWzFdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIGJveC5lbmRXaWRnZXQgPSBjaFsyXSB8fCBuZXcgR3RrLkJveFxuICAgIH0sXG59KVxuXG4vLyBUT0RPOiBDaXJjdWxhclByb2dyZXNzXG4vLyBUT0RPOiBEcmF3aW5nQXJlYVxuXG4vLyBFbnRyeVxudHlwZSBFbnRyeVNpZ25hbHMgPSB7XG4gICAgb25BY3RpdmF0ZTogW11cbiAgICBvbk5vdGlmeVRleHQ6IFtdXG59XG5cbmV4cG9ydCB0eXBlIEVudHJ5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuRW50cnksIEd0ay5FbnRyeS5Db25zdHJ1Y3RvclByb3BzLCBFbnRyeVNpZ25hbHM+XG5leHBvcnQgY29uc3QgRW50cnkgPSBhc3RhbGlmeTxHdGsuRW50cnksIEd0ay5FbnRyeS5Db25zdHJ1Y3RvclByb3BzLCBFbnRyeVNpZ25hbHM+KEd0ay5FbnRyeSwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIEltYWdlXG5leHBvcnQgdHlwZSBJbWFnZVByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkltYWdlLCBHdGsuSW1hZ2UuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBJbWFnZSA9IGFzdGFsaWZ5PEd0ay5JbWFnZSwgR3RrLkltYWdlLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5JbWFnZSwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbn0pXG5cbi8vIExhYmVsXG5leHBvcnQgdHlwZSBMYWJlbFByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLkxhYmVsLCBHdGsuTGFiZWwuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBMYWJlbCA9IGFzdGFsaWZ5PEd0ay5MYWJlbCwgR3RrLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5MYWJlbCwge1xuICAgIGdldENoaWxkcmVuKCkgeyByZXR1cm4gW10gfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikgeyBzZWxmLmxhYmVsID0gU3RyaW5nKGNoaWxkcmVuKSB9LFxufSlcblxuLy8gTGV2ZWxCYXJcbmV4cG9ydCB0eXBlIExldmVsQmFyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuTGV2ZWxCYXIsIEd0ay5MZXZlbEJhci5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNvbnN0IExldmVsQmFyID0gYXN0YWxpZnk8R3RrLkxldmVsQmFyLCBHdGsuTGV2ZWxCYXIuQ29uc3RydWN0b3JQcm9wcz4oR3RrLkxldmVsQmFyLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gVE9ETzogTGlzdEJveFxuXG4vLyBPdmVybGF5XG5leHBvcnQgdHlwZSBPdmVybGF5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuT3ZlcmxheSwgR3RrLk92ZXJsYXkuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBPdmVybGF5ID0gYXN0YWxpZnk8R3RrLk92ZXJsYXksIEd0ay5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5PdmVybGF5LCB7XG4gICAgZ2V0Q2hpbGRyZW4oc2VsZikge1xuICAgICAgICBjb25zdCBjaGlsZHJlbjogQXJyYXk8R3RrLldpZGdldD4gPSBbXVxuICAgICAgICBsZXQgY2ggPSBzZWxmLmdldF9maXJzdF9jaGlsZCgpXG4gICAgICAgIHdoaWxlIChjaCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgY2hpbGRyZW4ucHVzaChjaClcbiAgICAgICAgICAgIGNoID0gY2guZ2V0X25leHRfc2libGluZygpXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY2hpbGRyZW4uZmlsdGVyKGNoID0+IGNoICE9PSBzZWxmLmNoaWxkKVxuICAgIH0sXG4gICAgc2V0Q2hpbGRyZW4oc2VsZiwgY2hpbGRyZW4pIHtcbiAgICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBmaWx0ZXIoY2hpbGRyZW4pKSB7XG4gICAgICAgICAgICBjb25zdCB0eXBlcyA9IHR5cGUgaW4gY2hpbGRcbiAgICAgICAgICAgICAgICA/IChjaGlsZFt0eXBlXSBhcyBzdHJpbmcpLnNwbGl0KC9cXHMrLylcbiAgICAgICAgICAgICAgICA6IFtdXG5cbiAgICAgICAgICAgIGlmICh0eXBlcy5pbmNsdWRlcyhcIm92ZXJsYXlcIikpIHtcbiAgICAgICAgICAgICAgICBzZWxmLmFkZF9vdmVybGF5KGNoaWxkKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZWxmLnNldF9jaGlsZChjaGlsZClcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2VsZi5zZXRfbWVhc3VyZV9vdmVybGF5KGNoaWxkLCB0eXBlcy5pbmNsdWRlcyhcIm1lYXN1cmVcIikpXG4gICAgICAgICAgICBzZWxmLnNldF9jbGlwX292ZXJsYXkoY2hpbGQsIHR5cGVzLmluY2x1ZGVzKFwiY2xpcFwiKSlcbiAgICAgICAgfVxuICAgIH0sXG59KVxuXG4vLyBSZXZlYWxlclxuZXhwb3J0IHR5cGUgUmV2ZWFsZXJQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5SZXZlYWxlciwgR3RrLlJldmVhbGVyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgUmV2ZWFsZXIgPSBhc3RhbGlmeTxHdGsuUmV2ZWFsZXIsIEd0ay5SZXZlYWxlci5Db25zdHJ1Y3RvclByb3BzPihHdGsuUmV2ZWFsZXIpXG5cbi8vIFNsaWRlclxudHlwZSBTbGlkZXJTaWduYWxzID0ge1xuICAgIG9uQ2hhbmdlVmFsdWU6IFtdXG59XG5cbmV4cG9ydCB0eXBlIFNsaWRlclByb3BzID0gQ29uc3RydWN0UHJvcHM8QXN0YWwuU2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywgU2xpZGVyU2lnbmFscz5cbmV4cG9ydCBjb25zdCBTbGlkZXIgPSBhc3RhbGlmeTxBc3RhbC5TbGlkZXIsIEFzdGFsLlNsaWRlci5Db25zdHJ1Y3RvclByb3BzLCBTbGlkZXJTaWduYWxzPihBc3RhbC5TbGlkZXIsIHtcbiAgICBnZXRDaGlsZHJlbigpIHsgcmV0dXJuIFtdIH0sXG59KVxuXG4vLyBTdGFja1xuZXhwb3J0IHR5cGUgU3RhY2tQcm9wcyA9IENvbnN0cnVjdFByb3BzPEd0ay5TdGFjaywgR3RrLlN0YWNrLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgU3RhY2sgPSBhc3RhbGlmeTxHdGsuU3RhY2ssIEd0ay5TdGFjay5Db25zdHJ1Y3RvclByb3BzPihHdGsuU3RhY2ssIHtcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZpbHRlcihjaGlsZHJlbikpIHtcbiAgICAgICAgICAgIGlmIChjaGlsZC5uYW1lICE9IFwiXCIgJiYgY2hpbGQubmFtZSAhPSBudWxsKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGRfbmFtZWQoY2hpbGQsIGNoaWxkLm5hbWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHNlbGYuYWRkX2NoaWxkKGNoaWxkKVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSxcbn0pXG5cbi8vIFN3aXRjaFxuZXhwb3J0IHR5cGUgU3dpdGNoUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuU3dpdGNoLCBHdGsuU3dpdGNoLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgU3dpdGNoID0gYXN0YWxpZnk8R3RrLlN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPihHdGsuU3dpdGNoLCB7XG4gICAgZ2V0Q2hpbGRyZW4oKSB7IHJldHVybiBbXSB9LFxufSlcblxuLy8gV2luZG93XG5leHBvcnQgdHlwZSBXaW5kb3dQcm9wcyA9IENvbnN0cnVjdFByb3BzPEFzdGFsLldpbmRvdywgQXN0YWwuV2luZG93LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgV2luZG93ID0gYXN0YWxpZnk8QXN0YWwuV2luZG93LCBBc3RhbC5XaW5kb3cuQ29uc3RydWN0b3JQcm9wcz4oQXN0YWwuV2luZG93KVxuXG4vLyBNZW51QnV0dG9uXG5leHBvcnQgdHlwZSBNZW51QnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxHdGsuTWVudUJ1dHRvbiwgR3RrLk1lbnVCdXR0b24uQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjb25zdCBNZW51QnV0dG9uID0gYXN0YWxpZnk8R3RrLk1lbnVCdXR0b24sIEd0ay5NZW51QnV0dG9uLkNvbnN0cnVjdG9yUHJvcHM+KEd0ay5NZW51QnV0dG9uLCB7XG4gICAgZ2V0Q2hpbGRyZW4oc2VsZikgeyByZXR1cm4gW3NlbGYucG9wb3Zlciwgc2VsZi5jaGlsZF0gfSxcbiAgICBzZXRDaGlsZHJlbihzZWxmLCBjaGlsZHJlbikge1xuICAgICAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIGZpbHRlcihjaGlsZHJlbikpIHtcbiAgICAgICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIEd0ay5Qb3BvdmVyKSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfcG9wb3ZlcihjaGlsZClcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VsZi5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxufSlcblxuLy8gUG9wb3BlclxuZXhwb3J0IHR5cGUgUG9wb3ZlclByb3BzID0gQ29uc3RydWN0UHJvcHM8R3RrLlBvcG92ZXIsIEd0ay5Qb3BvdmVyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY29uc3QgUG9wb3ZlciA9IGFzdGFsaWZ5PEd0ay5Qb3BvdmVyLCBHdGsuUG9wb3Zlci5Db25zdHJ1Y3RvclByb3BzPihHdGsuUG9wb3ZlcilcbiIsICIvLyBrb2JlbC1zaGVsbCBlbnRyeSBcdTIwMTQgQUdTIHYyIC8gYXN0YWw0XG5pbXBvcnQgeyBBcHAgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR2RrIGZyb20gXCJnaTovL0dkaz92ZXJzaW9uPTQuMFwiXG4vLyBhc3RhbCBgY29uc3RydWN0YCBzZXRzIHN0YXRpYyBwcm9wcyB2aWEgT2JqZWN0LmFzc2lnbih3aWRnZXQsIHByb3BzKSBhbmQgYmluZGluZ3MgdmlhXG4vLyBzZXRQcm9wIFx1MjE5MiBzZXRfY2xhc3MuIEd0a1dpZGdldCBoYXMgbmVpdGhlciBhIGBjbGFzc2AgR09iamVjdCBwcm9wIG5vciBzZXRfY2xhc3MsIHNvXG4vLyBgY2xhc3M9XCIuLi5cImAgc2lsZW50bHkgbm8tb3BzICh0aGUgcmVhbCBwcm9wIGlzIGBjc3MtY2xhc3Nlc2AsIGFuIGFycmF5KS4gRGVmaW5lIGFcbi8vIGBjbGFzc2AgYWNjZXNzb3Igcm91dGluZyBCT1RIIHBhdGhzIHRvIHNldF9jc3NfY2xhc3Nlcywgc28gYGNsYXNzPVwiYSBiXCJgIHdvcmtzLlxuT2JqZWN0LmRlZmluZVByb3BlcnR5KChHdGsuV2lkZ2V0IGFzIGFueSkucHJvdG90eXBlLCBcImNsYXNzXCIsIHtcbiAgY29uZmlndXJhYmxlOiB0cnVlLFxuICBzZXQodjogc3RyaW5nKSB7IHRoaXMuc2V0X2Nzc19jbGFzc2VzKFN0cmluZyh2KS5zcGxpdCgvXFxzKy8pLmZpbHRlcihCb29sZWFuKSkgfSxcbiAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfY3NzX2NsYXNzZXMoKS5qb2luKFwiIFwiKSB9LFxufSlcbjsoR3RrLldpZGdldC5wcm90b3R5cGUgYXMgYW55KS5zZXRfY2xhc3MgPSBmdW5jdGlvbiAodjogc3RyaW5nKSB7XG4gIHRoaXMuc2V0X2Nzc19jbGFzc2VzKFN0cmluZyh2KS5zcGxpdCgvXFxzKy8pLmZpbHRlcihCb29sZWFuKSlcbn1cbmltcG9ydCBzdHlsZSBmcm9tIFwiLi9zdHlsZS9tYWluLnNjc3NcIlxuaW1wb3J0IHsgdG9rZW5Dc3MsIHRva2VucyB9IGZyb20gXCIuL2NvbmZpZ1wiXG5pbXBvcnQgKiBhcyBnbm9ibGluIGZyb20gXCIuL3NlcnZpY2VzL2dub2JsaW5cIlxuaW1wb3J0ICogYXMgbm90aWZkU3ZjIGZyb20gXCIuL3NlcnZpY2VzL25vdGlmZFwiXG5pbXBvcnQgeyBhcm1EdW1wIH0gZnJvbSBcIi4vbGliL2luc3BlY3RcIlxuaW1wb3J0IHsgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi9saWIvc3VyZmFjZVwiXG5pbXBvcnQgQmFyIGZyb20gXCIuL3dpZGdldC9CYXJcIlxuaW1wb3J0IERvY2sgZnJvbSBcIi4vd2lkZ2V0L0RvY2tcIlxuaW1wb3J0IExhdW5jaGVyIGZyb20gXCIuL3dpZGdldC9MYXVuY2hlclwiXG5pbXBvcnQgUXVpY2tTZXR0aW5ncyBmcm9tIFwiLi93aWRnZXQvUXVpY2tTZXR0aW5nc1wiXG5pbXBvcnQgQ2FsZW5kYXIgZnJvbSBcIi4vd2lkZ2V0L0NhbGVuZGFyXCJcbmltcG9ydCB7IFRvYXN0cywgRHJhd2VyIH0gZnJvbSBcIi4vd2lkZ2V0L05vdGlmaWNhdGlvbnNcIlxuaW1wb3J0IE9TRCBmcm9tIFwiLi93aWRnZXQvT1NEXCJcbmltcG9ydCBTZXNzaW9uIGZyb20gXCIuL3dpZGdldC9TZXNzaW9uXCJcblxucHJpbnRlcnIoXCJLT0JFTDogbW9kdWxlIHRvcCByZWFjaGVkXCIpXG5cbi8vIEN1c3RvbSBpY29uIHNldCBcdTIwMTQgdGhlIGV4YWN0IEhlcm9pY29ucy9MdWNpZGUvVGFibGVyIHRoZSBwcm90b3R5cGUgdXNlcywgYXNcbi8vIHJlY29sb3JhYmxlIHN5bWJvbGljIFNWR3MuIFJlZ2lzdGVyZWQgb24gdGhlIGRlZmF1bHQgaWNvbiB0aGVtZSBzbyBpY29uTmFtZVxuLy8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgZXRjLiByZXNvbHZlLiBQYXRoIG92ZXJyaWRlIHZpYSBLT0JFTF9JQ09OUyBmb3IgdGhlIGRldmtpdC5cbmltcG9ydCBHTGliSWNvbnMgZnJvbSBcImdpOi8vR0xpYlwiXG5jb25zdCBJQ09OX0RJUiA9IEdMaWJJY29ucy5nZXRlbnYoXCJLT0JFTF9JQ09OU1wiKVxuICA/PyBHTGliSWNvbnMuYnVpbGRfZmlsZW5hbWV2KFtHTGliSWNvbnMuZ2V0X2N1cnJlbnRfZGlyKCksIFwiaWNvbnNcIl0pXG5cbkFwcC5zdGFydCh7XG4gIGluc3RhbmNlTmFtZTogXCJrb2JlbFwiLFxuICBpY29uczogSUNPTl9ESVIsXG4gIG1haW4oKSB7XG4gICAgZ25vYmxpbi5pbml0KClcbiAgICBub3RpZmRTdmMuaW5pdCgpXG4gICAgLy8gTG9hZCBvdXIgc3R5bGVzaGVldCBhdCBVU0VSIHByaW9yaXR5IChoaWdoZXN0KSBzbyBpdCBiZWF0cyBBZHdhaXRhJ3MgdGhlbWVcbiAgICAvLyBydWxlcyBcdTIwMTQgYXN0YWwncyBvd24gY3NzIG9wdGlvbiBhcHBsaWVzIHRvbyBsb3csIGxldHRpbmcgQWR3YWl0YSB3aW4gb24gZS5nLlxuICAgIC8vIGBzY2FsZSA+IHRyb3VnaGAgKGZhdCBzbGlkZXJzKS4gVGhpcyBwcm92aWRlciBpcyBhdXRob3JpdGF0aXZlLlxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwcm92ID0gbmV3IEd0ay5Dc3NQcm92aWRlcigpXG4gICAgICBwcm92LmxvYWRfZnJvbV9zdHJpbmcoc3R5bGUgKyB0b2tlbkNzcyh0b2tlbnMpKVxuICAgICAgR3RrLlN0eWxlQ29udGV4dC5hZGRfcHJvdmlkZXJfZm9yX2Rpc3BsYXkoXG4gICAgICAgIEdkay5EaXNwbGF5LmdldF9kZWZhdWx0KCkhLCBwcm92LCA4MDAgLyogVVNFUiBwcmlvcml0eSAqLylcbiAgICB9IGNhdGNoIChlKSB7IHByaW50ZXJyKGBrb2JlbDogY3NzIHByb3ZpZGVyIGZhaWxlZDogJHtlfWApIH1cbiAgICAvLyBhc3RhbDQgSlNYIDx3aW5kb3c+IGlzIGNyZWF0ZWQgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gUGVyc2lzdGVudCBjaHJvbWUgbXVzdFxuICAgIC8vIGJlIHByZXNlbnQoKWVkOyBvbi1kZW1hbmQgc3VyZmFjZXMgc3RheSBoaWRkZW4gYW5kIGFyZSBzaG93biBieSB0b2dnbGVfd2luZG93LlxuICAgIGNvbnN0IG1ha2UgPSAobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gYW55LCBzaG93OiBib29sZWFuKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB3ID0gZm4oKVxuICAgICAgICBpZiAodyAmJiB0eXBlb2Ygdy5wcmVzZW50ID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICBBcHAuYWRkX3dpbmRvdz8uKHcpXG4gICAgICAgICAgaWYgKHNob3cpIHcucHJlc2VudCgpXG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHsgcHJpbnRlcnIoYGtvYmVsOiAke25hbWV9IEZBSUxFRDogJHtlfVxcbiR7KGUgYXMgYW55KT8uc3RhY2sgPz8gXCJcIn1gKSB9XG4gICAgfVxuICAgIGNvbnN0IG1vbml0b3JzID0gQXBwLmdldF9tb25pdG9ycygpXG4gICAgY29uc3QgdGFyZ2V0cyA9IG1vbml0b3JzLmxlbmd0aCA/IG1vbml0b3JzIDogW3VuZGVmaW5lZCBhcyBhbnldXG4gICAgZm9yIChjb25zdCBtb25pdG9yIG9mIHRhcmdldHMpIHtcbiAgICAgIG1ha2UoXCJiYXJcIiwgKCkgPT4gQmFyKG1vbml0b3IpLCB0cnVlKVxuICAgICAgbWFrZShcImRvY2tcIiwgKCkgPT4gRG9jayhtb25pdG9yKSwgdHJ1ZSlcbiAgICAgIG1ha2UoXCJ0b2FzdHNcIiwgKCkgPT4gVG9hc3RzKG1vbml0b3IpLCB0cnVlKVxuICAgICAgbWFrZShcIm9zZFwiLCAoKSA9PiBPU0QobW9uaXRvciksIHRydWUpXG4gICAgfVxuICAgIG1ha2UoXCJsYXVuY2hlclwiLCAoKSA9PiBMYXVuY2hlcigpLCBmYWxzZSlcbiAgICBtYWtlKFwicXVpY2tzZXR0aW5nc1wiLCAoKSA9PiBRdWlja1NldHRpbmdzKCksIGZhbHNlKVxuICAgIG1ha2UoXCJjYWxlbmRhclwiLCAoKSA9PiBDYWxlbmRhcigpLCBmYWxzZSlcbiAgICBtYWtlKFwiZHJhd2VyXCIsICgpID0+IERyYXdlcigpLCBmYWxzZSlcbiAgICBtYWtlKFwic2Vzc2lvblwiLCAoKSA9PiBTZXNzaW9uKCksIGZhbHNlKVxuICAgIC8vIEtPQkVMX0RVTVA9PHdpbmRvdz46IGR1bXAgdGhlIGxpdmUgR1RLIGdlb21ldHJ5IHRyZWUgZm9yIERPTS12cy1HVEsgZGlmZmluZy5cbiAgICBhcm1EdW1wKChuYW1lKSA9PiBBcHAuZ2V0X3dpbmRvdyhuYW1lKSBhcyBhbnkpXG4gIH0sXG4gIC8vIGBhc3RhbCAtaSBrb2JlbCAtdCA8d2luZG93PmAgaGFuZGxlZCBieSBBcHAncyByZXF1ZXN0IGZyYW1ld29ya1xuICByZXF1ZXN0SGFuZGxlcihyZXF1ZXN0LCByZXMpIHtcbiAgICBjb25zdCBbY21kLCBhcmddID0gcmVxdWVzdC5zcGxpdChcIiBcIilcbiAgICBpZiAoY21kID09PSBcInRvZ2dsZVwiKSB7IHN1cmZhY2VUb2dnbGUoYXJnKTsgcmV0dXJuIHJlcyhcIm9rXCIpIH1cbiAgICBpZiAoY21kID09PSBcInJlbG9hZC1jc3NcIikgeyBBcHAuYXBwbHlfY3NzKHN0eWxlICsgdG9rZW5Dc3ModG9rZW5zKSwgdHJ1ZSk7IHJldHVybiByZXMoXCJva1wiKSB9XG4gICAgcmVzKFwidW5rbm93blwiKVxuICB9LFxufSlcbiIsICJAY2hhcnNldCBcIlVURi04XCI7XG53aW5kb3cge1xuICBmb250LWZhbWlseTogXCJJbnRlclwiLCBcIkludGVyIFZhcmlhYmxlXCIsIFwiSW50ZXJWYXJpYWJsZVwiLCBzYW5zLXNlcmlmO1xuICBmb250LXNpemU6IDEzcHg7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuXG4udG4ge1xuICBmb250LWZlYXR1cmUtc2V0dGluZ3M6IFwidG51bVwiO1xufVxuXG53aW5kb3cge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbn1cblxuYnV0dG9uIHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm94LXNoYWRvdzogbm9uZTtcbiAgb3V0bGluZTogbm9uZTtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xuICBwYWRkaW5nOiAwO1xuICBtYXJnaW46IDA7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXMsIGNvbG9yIDE2MG1zO1xufVxuXG5pbWFnZSB7XG4gIC1ndGstaWNvbi1zdHlsZTogcmVndWxhcjtcbn1cblxuLmJhciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDE0cHg7XG4gIHBhZGRpbmc6IDAgN3B4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xuICBjb2xvcjogI2I1YWRiYztcbn1cbi5iYXIgLnRpdGxlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNDAwO1xuICBtYXJnaW46IDAgOXB4O1xufVxuLmJhciAuY2xvY2sge1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxMy41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4uYmFyIC5kYXRlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmJhciAuaWJ0biB7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uYmFyIC5pYnRuIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4uYmFyIC5pYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4uYmFyIC5iY2VudGVyIHtcbiAgbWluLWhlaWdodDogMDtcbiAgcGFkZGluZzogNnB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbn1cbi5iYXIgLmJjZW50ZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmJhciAuc3RhdHVzIHtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgcGFkZGluZzogMCAxM3B4O1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5iYXIgLnN0YXR1czpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4uYmFyIC5zdGF0dXMgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE2cHg7XG59XG4uYmFyIC5zdGF0dXMgLnBjdCBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxM3B4O1xufVxuLmJhciAuc3RhdHVzIGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmJhciAuc3RhdHVzLmVyciAubmV0LWljb24ge1xuICBjb2xvcjogI2VkYmI2NDtcbn1cbi5iYXIgLmJhZGdlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBwYWRkaW5nOiAwIDNweDtcbiAgbWFyZ2luOiAycHg7XG4gIG1pbi1oZWlnaHQ6IDE0cHg7XG4gIG1pbi13aWR0aDogOHB4O1xufVxuLmJhciAudHJheS1pY29uIHtcbiAgbWluLXdpZHRoOiAyOHB4O1xufVxuLmJhciAudHJheS1pY29uIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmJhciAudHJheS1sYW5nIHtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBjb2xvcjogI2I1YWRiYztcbiAgbWFyZ2luOiAwIDhweDtcbn1cblxuLmRvY2sge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBwYWRkaW5nOiA1cHg7XG4gIGJvcmRlci1yYWRpdXM6IDE2cHg7XG59XG4uZG9jayAuZGJ0biB7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG59XG4uZG9jayAuaWNvbi10aWxlIHtcbiAgbWluLXdpZHRoOiAzMHB4O1xuICBtaW4taGVpZ2h0OiAzMHB4O1xuICBwYWRkaW5nOiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMTYwbXM7XG59XG4uZG9jayAuZGJ0bjpob3ZlciAuaWNvbi10aWxlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgyNTUsIDI1NSwgMjU1LCAwLjA5KTtcbn1cbi5kb2NrIC5wbGFjZWhvbGRlciAuaWNvbi10aWxlIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uZG9jayAuZG90cyB7XG4gIG1hcmdpbi1ib3R0b206IDNweDtcbn1cbi5kb2NrIC5kb3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjOGQ4NjkzO1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBtaW4td2lkdGg6IDRweDtcbiAgbWluLWhlaWdodDogNHB4O1xuICB0cmFuc2l0aW9uOiBtaW4td2lkdGggMjYwbXMgY3ViaWMtYmV6aWVyKDAuMjQsIDEuMzYsIDAuMzUsIDEpLCBiYWNrZ3JvdW5kLWNvbG9yIDIyMG1zO1xufVxuLmRvY2sgLmRvdC5vbiB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIG1pbi13aWR0aDogMTJweDtcbn1cbi5kb2NrIC5kb3QubWluaSB7XG4gIG1pbi13aWR0aDogM3B4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG4gIG9wYWNpdHk6IDAuNztcbn1cbi5kb2NrIC5zZXAge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBtaW4td2lkdGg6IDFweDtcbiAgbWluLWhlaWdodDogMzNweDtcbiAgbWFyZ2luOiAwIDNweDtcbn1cbi5kb2NrIC5kdGlsZSB7XG4gIG1pbi13aWR0aDogNDJweDtcbiAgbWluLWhlaWdodDogNDJweDtcbn1cbi5kb2NrIC5kd2lkZ2V0IC5kZyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIHBhZGRpbmc6IDZweDtcbn1cbi5kb2NrIC5tcHJvZyB7XG4gIG1pbi13aWR0aDogMjVweDtcbiAgbWluLWhlaWdodDogM3B4O1xuICBtYXJnaW4tYm90dG9tOiA2cHg7XG59XG4uZG9jayAubXByb2cgdHJvdWdoIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSgwLCAwLCAwLCAwLjM1KTtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWluLWhlaWdodDogM3B4O1xufVxuLmRvY2sgLm1wcm9nIGJsb2NrLmZpbGxlZCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG59XG4uZG9jayAubXByb2cgYmxvY2suZW1wdHkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiB0cmFuc3BhcmVudDtcbn1cblxuLnNoZWV0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTRweDtcbiAgcGFkZGluZzogMTJweDtcbiAgbWFyZ2luOiAzOHB4O1xuICBib3gtc2hhZG93OiAwIDE1cHggMzRweCByZ2JhKDgsIDUsIDE2LCAwLjQ1KSwgMCAycHggOHB4IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG59XG5cbi5xcyB7XG4gIG1pbi13aWR0aDogMzI4cHg7XG59IC8qIG1hdGNoZXMgcGFuZWxXKDM1MilcdTIyMTIyNDsgb3ZlcnJpZGRlbiBieSBjb25maWcudHMgdG9rZW5Dc3MgYXQgcnVudGltZSAqL1xuLnFzLXRvcCB7XG4gIG1hcmdpbi1ib3R0b206IDEycHg7XG4gIHBhZGRpbmc6IDAgMnB4O1xufVxuLnFzLXRvcCAubWV0YSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5xcy10b3AgLm1ldGEgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogMDtcbn1cbi5xcy10b3AgLnJidG4ge1xuICBwYWRkaW5nOiA5cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBtYXJnaW4tbGVmdDogN3B4O1xufVxuLnFzLXRvcCAucmJ0biBpbWFnZSB7XG4gIC1ndGstaWNvbi1zaXplOiAxNHB4O1xufVxuLnFzLXRvcCAucmJ0bjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMzMjJlMzk7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnFzLXRvcCAucmJ0bi5kYW5nZXI6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZWY4NmEwO1xuICBjb2xvcjogIzRiMGYxZjtcbn1cbi5xcy10b3AgLnJidG4ubGVhZiBpbWFnZSB7XG4gIGNvbG9yOiAjYjVjYjQ4O1xufVxuXG4uY2hpcCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4taGVpZ2h0OiA1NHB4O1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDIyMG1zO1xufVxuLmNoaXAgLmNoaXBiIHtcbiAgcGFkZGluZzogOXB4IDhweCA5cHggMTJweDtcbiAgYm9yZGVyLXJhZGl1czogOTk5cHg7XG59XG4uY2hpcCBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTdweDtcbn1cbi5jaGlwIGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMi41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmNoaXAgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbiAgbWFyZ2luLXRvcDogMDtcbn1cbi5jaGlwOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cbi5jaGlwLm9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbn1cbi5jaGlwLm9uIGltYWdlIHtcbiAgY29sb3I6ICMxOTIwMDM7XG59XG4uY2hpcC5vbiBsYWJlbCB7XG4gIGNvbG9yOiAjMTkyMDAzO1xufVxuLmNoaXAub24gLnN1YiB7XG4gIGNvbG9yOiByZ2JhKDI1LCAzMiwgMywgMC43KTtcbn1cbi5jaGlwLm9uOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cbi5jaGlwLm9uIC5jaGV2IHtcbiAgY29sb3I6ICMxOTIwMDM7XG59XG4uY2hpcCAuY2hldiB7XG4gIG1pbi13aWR0aDogMzJweDtcbiAgYm9yZGVyLXJhZGl1czogMCA5OTlweCA5OTlweCAwO1xuICBjb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLWxlZnQ6IDFweCBzb2xpZCByZ2JhKDAsIDAsIDAsIDAuMTgpO1xufVxuLmNoaXAgLmNoZXYgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgY29sb3I6IGluaGVyaXQ7XG59XG4uY2hpcCAuY2hldjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMCwgMCwgMCwgMC4xNCk7XG59XG5cbi5jaGlwcyB7XG4gIG1hcmdpbi1ib3R0b206IDA7XG59XG5cbi5jaGlwcyA+IGJveDpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLXJpZ2h0OiAxcHg7XG59XG5cbi5jaGlwLWdyaWQge1xuICBtYXJnaW4tYm90dG9tOiAxMHB4O1xufVxuXG5zY2FsZSwgc2NhbGU6aG9yaXpvbnRhbCwgc2NhbGU6dmVydGljYWwge1xuICBtaW4taGVpZ2h0OiAwO1xuICBtaW4td2lkdGg6IDA7XG4gIHBhZGRpbmc6IDA7XG4gIG1hcmdpbjogNnB4IDA7XG59XG5cbnNjYWxlID4gdHJvdWdoLCBzY2FsZTpob3Jpem9udGFsID4gdHJvdWdoLCBzY2FsZTp2ZXJ0aWNhbCA+IHRyb3VnaCB7XG4gIG1pbi1oZWlnaHQ6IDZweDtcbiAgbWluLXdpZHRoOiAwO1xuICBtYXJnaW46IDA7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IGhpZ2hsaWdodCxcbnNjYWxlID4gdHJvdWdoID4gcHJvZ3Jlc3Mge1xuICBtaW4taGVpZ2h0OiA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuXG5zY2FsZSA+IHRyb3VnaCA+IHNsaWRlciB7XG4gIG1pbi13aWR0aDogMTdweDtcbiAgbWluLWhlaWdodDogMTdweDtcbiAgbWFyZ2luOiAtNnB4OyAvKiBwcm90b3R5cGUga25vYiAxN1x1MDBENzE3ICovXG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjZjNlZWYzO1xuICBib3gtc2hhZG93OiAwIDFweCA0cHggcmdiYSgwLCAwLCAwLCAwLjUpO1xufVxuXG4uc3JvdyB7XG4gIHBhZGRpbmc6IDAgMnB4IDAgMnB4O1xuICBtaW4taGVpZ2h0OiA0MnB4O1xufVxuXG4uc3JvdyBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTZweDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwIC0xMnB4IDAgMTJweDtcbn1cblxuLnNyb3cgLmNoZXYge1xuICBwYWRkaW5nOiA2cHggOHB4O1xuICBjb2xvcjogIzhkODY5MztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xufVxuLnNyb3cgLmNoZXYgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbiAgcGFkZGluZzogMDtcbiAgbWFyZ2luOiAwO1xufVxuLnNyb3cgLmNoZXY6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuXG4uZ2Jhbm5lciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG4gIHBhZGRpbmc6IDEwcHggMTJweDtcbiAgbWFyZ2luLWJvdHRvbTogOHB4O1xufVxuLmdiYW5uZXIgLnQge1xuICBjb2xvcjogI2VkYmI2NDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG59XG4uZ2Jhbm5lciAucyB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbn1cbi5nYmFubmVyIGltYWdlIHtcbiAgY29sb3I6ICNlZGJiNjQ7XG59XG5cbi5nYnRuIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2I1Y2I0ODtcbiAgY29sb3I6ICMxOTIwMDM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBwYWRkaW5nOiA3cHggMTJweDtcbn1cbi5nYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzk2YWUzMDtcbn1cblxuLmRoZWFkIHtcbiAgcGFkZGluZy1ib3R0b206IDEwcHg7XG59XG4uZGhlYWQgYnV0dG9uIHtcbiAgcGFkZGluZzogN3B4O1xuICBib3JkZXItcmFkaXVzOiA5cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xufVxuLmRoZWFkIGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmRoZWFkIGxhYmVsIHtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgZm9udC1zaXplOiAxNHB4O1xufVxuXG5zd2l0Y2gge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBib3JkZXItcmFkaXVzOiA5OTlweDtcbiAgbWluLXdpZHRoOiA0MnB4O1xuICBtaW4taGVpZ2h0OiAyNHB4O1xufVxuc3dpdGNoOmNoZWNrZWQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xufVxuc3dpdGNoIHNsaWRlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBtaW4td2lkdGg6IDIwcHg7XG4gIG1pbi1oZWlnaHQ6IDIwcHg7XG59XG5cbi54cm93IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBwYWRkaW5nOiA5cHggMTFweDtcbn1cbi54cm93IGltYWdlIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIC1ndGstaWNvbi1zaXplOiAxN3B4O1xufVxuLnhyb3cgbGFiZWwge1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgY29sb3I6ICNmM2VlZjM7XG59XG4ueHJvdyAueHMge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxMC41cHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4ueHJvdzpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG4ueHJvdy5hY3RpdmUgaW1hZ2Uge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cbi54cm93LmFjdGl2ZSAueHMge1xuICBjb2xvcjogI2I1Y2I0ODtcbn1cblxuLm1peHJvdyB7XG4gIHBhZGRpbmc6IDRweCAycHg7XG59XG4ubWl4cm93IC5taSB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xufVxuLm1peHJvdyAubWkgaW1hZ2Uge1xuICBjb2xvcjogI2I1YWRiYztcbiAgLWd0ay1pY29uLXNpemU6IDE1cHg7XG59XG4ubWl4cm93IC5tbmFtZSB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIG1pbi13aWR0aDogNzJweDtcbn1cblxuLnNoZWV0LmxhdW5jaGVyIHtcbiAgbWluLXdpZHRoOiA1NTFweDtcbn1cblxuLmxhdW5jaGVyIHtcbiAgcGFkZGluZzogOHB4O1xufVxuXG4uZmllbGQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAzcHggMTJweDtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmZpZWxkIGltYWdlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIC1ndGstaWNvbi1zaXplOiAxNnB4O1xufVxuLmZpZWxkIGVudHJ5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYm9yZGVyOiBub25lO1xuICBib3gtc2hhZG93OiBub25lO1xuICBvdXRsaW5lOiBub25lO1xuICBjb2xvcjogI2YzZWVmMztcbiAgZm9udC1zaXplOiAxNC41cHg7XG4gIGNhcmV0LWNvbG9yOiAjYjVjYjQ4O1xuICBwYWRkaW5nOiA4cHggMDtcbiAgbWluLWhlaWdodDogMDtcbiAgbWluLXdpZHRoOiAwO1xufVxuLmZpZWxkIGVudHJ5IHRleHQge1xuICBtaW4taGVpZ2h0OiAwO1xufVxuLmZpZWxkIC5scGxhY2Vob2xkZXIge1xuICBjb2xvcjogI2I1YWRiYztcbiAgZm9udC1zaXplOiAxNC41cHg7XG59XG4uZmllbGQgLmdob3N0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogMTQuNXB4O1xufVxuLmZpZWxkIC5rYmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2I1YWRiYztcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgcGFkZGluZzogM3B4IDdweDtcbn1cblxuLnRpbGVzIHtcbiAgcGFkZGluZzogOHB4IDJweCAxMHB4O1xufVxuXG4udGlsZSB7XG4gIHBhZGRpbmc6IDVweCAwO1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBtaW4td2lkdGg6IDYycHg7XG4gIG1heC13aWR0aDogNjJweDtcbn1cbi50aWxlIC5pY29uLXRpbGUge1xuICBtaW4td2lkdGg6IDA7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIHBhZGRpbmc6IDZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgdHJhbnNpdGlvbjogYmFja2dyb3VuZC1jb2xvciAxNjBtcztcbn1cbi50aWxlIGxhYmVsIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xufVxuLnRpbGU6aG92ZXIgLmljb24tdGlsZSB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMjU1LCAyNTUsIDI1NSwgMC4wOSk7XG59XG4udGlsZTpob3ZlciBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuXG4ubGZvb3Qge1xuICBwYWRkaW5nOiA3cHggMTBweCAzcHg7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDExcHg7XG59XG4ubGZvb3QgYiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXdlaWdodDogNjUwO1xufVxuXG4ubHdpZGdldHMge1xuICBwYWRkaW5nOiAwIDJweCA2cHg7XG59XG5cbi53aWRnZXQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiAxMHB4IDEycHg7XG59XG4ud2lkZ2V0IGxhYmVsIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGZvbnQtc2l6ZTogMTIuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLndpZGdldCAuaGludCB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG5cbi5sd20gLmx3YXJ0IHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xuICBtaW4td2lkdGg6IDM0cHg7XG4gIG1pbi1oZWlnaHQ6IDM0cHg7XG59XG4ubHdtIC5sd2FydCBpbWFnZSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICAtZ3RrLWljb24tc2l6ZTogMTFweDtcbn1cbi5sd20gLm1idG4ge1xuICBjb2xvcjogI2YzZWVmMztcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBtaW4td2lkdGg6IDI5cHg7XG4gIG1pbi1oZWlnaHQ6IDI5cHg7XG59XG4ubHdtIC5tYnRuIGltYWdlIHtcbiAgLWd0ay1pY29uLXNpemU6IDE0cHg7XG59XG4ubHdtIC5tYnRuOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzI2MjMyYztcbn1cblxuLnNlYyB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG4gIHBhZGRpbmc6IDhweCAxMHB4IDJweDtcbn1cblxuLnJvdyB7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDdweCAxMHB4O1xufVxuLnJvdyAucmkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xuICBib3JkZXItcmFkaXVzOiA4cHg7XG4gIHBhZGRpbmc6IDJweDtcbn1cbi5yb3cgaW1hZ2Uge1xuICAtZ3RrLWljb24tc2l6ZTogMjRweDtcbn1cbi5yb3cgbGFiZWwge1xuICBmb250LXNpemU6IDEzcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG59XG4ucm93IC5oaW50IHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLnJvdyAucnVuayB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMzMjJlMzk7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBib3JkZXItcmFkaXVzOiA2cHg7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBwYWRkaW5nOiAycHggN3B4O1xufVxuLnJvdzpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4ucm93LnNlbCB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMyNjIzMmM7XG59XG5cbi5jYWwge1xuICBtaW4td2lkdGg6IDMwOXB4O1xufVxuLmNhbCAuc3ViIHtcbiAgY29sb3I6ICNiNWFkYmM7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xufVxuLmNhbCAuaGVybyB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDE5cHg7XG4gIGZvbnQtd2VpZ2h0OiA2NTA7XG59XG4uY2FsIC5jYWxoZXJvIHtcbiAgcGFkZGluZzogNXB4IDhweCA4cHggOHB4O1xufVxuLmNhbCAuY2FsLWdyaWQge1xuICBtYXJnaW4tdG9wOiA4cHg7XG59XG4uY2FsIC5tb250aCB7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xuICBmb250LXNpemU6IDEzcHg7XG59XG4uY2FsIC5tb250aDpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbiB7XG4gIHBhZGRpbmc6IDZweCA1cHg7XG4gIGJvcmRlci1yYWRpdXM6IDlweDtcbiAgY29sb3I6ICNiNWFkYmM7XG59XG4uY2FsIGNlbnRlcmJveCA+IGJ1dHRvbjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLmNhbCAuZG93IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIHBhZGRpbmc6IDNweCAwIDZweDtcbn1cbi5jYWwgLndrIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmNhbCAuZGF5IHtcbiAgYmFja2dyb3VuZDogbm9uZTtcbiAgYmFja2dyb3VuZC1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIG1pbi13aWR0aDogMjRweDtcbiAgbWluLWhlaWdodDogMjRweDtcbiAgYm9yZGVyLXJhZGl1czogOTlweDtcbiAgbWFyZ2luOiAxcHg7XG59XG4uY2FsIC5kYXk6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMWQxYTIyO1xufVxuLmNhbCAuZGF5LndlIHtcbiAgY29sb3I6ICM4ZDg2OTM7XG59XG4uY2FsIC5kYXkub3V0IHtcbiAgY29sb3I6ICM4ZDg2OTM7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG59XG4uY2FsIC5kYXkudG9kYXkge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjYjVjYjQ4O1xuICBjb2xvcjogIzE5MjAwMztcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbn1cbi5jYWwgLmRheS50b2RheTpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG59XG4uY2FsIC5kYXkuc2VsOm5vdCgudG9kYXkpIHtcbiAgYm94LXNoYWRvdzogaW5zZXQgMCAwIDAgMS41cHggI2I1YWRiYztcbn1cbi5jYWwgLmRheS50b2RheS5zZWwge1xuICBib3gtc2hhZG93OiBpbnNldCAwIDAgMCAxLjVweCAjMTkyMDAzO1xufVxuLmNhbCAuZGF5IC5ldmRvdCB7XG4gIG1pbi13aWR0aDogM3B4O1xuICBtaW4taGVpZ2h0OiAzcHg7XG4gIGJvcmRlci1yYWRpdXM6IDk5cHg7XG4gIGJhY2tncm91bmQtY29sb3I6ICNiNWNiNDg7XG4gIG1hcmdpbi1ib3R0b206IDJweDtcbn1cbi5jYWwgLmRheS50b2RheSAuZXZkb3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTkyMDAzO1xufVxuLmNhbCAuZXZjYXJkIHtcbiAgbWFyZ2luLXRvcDogMTBweDtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgcGFkZGluZzogMTBweDtcbn1cbi5jYWwgLmV2aGVhZCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbiAgcGFkZGluZzogMXB4IDNweCA4cHg7XG59XG4uY2FsIC5ldnJvdyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBtYXJnaW4tYm90dG9tOiA0cHg7XG59XG4uY2FsIC5ldnJvdzpsYXN0LWNoaWxkIHtcbiAgbWFyZ2luLWJvdHRvbTogMDtcbn1cbi5jYWwgLmV2cm93IC5ldmljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzYyODkzMztcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA1cHg7XG59XG4uY2FsIC5ldnJvdyAuZXZpYyBpbWFnZSB7XG4gIGNvbG9yOiAjZmZmO1xuICAtZ3RrLWljb24tc2l6ZTogMTVweDtcbn1cbi5jYWwgLmV2cm93IGxhYmVsIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLmNhbCAuZXZyb3cgLnN1YiB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cblxuLmRyYXdlciB7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xufVxuXG4udG9hc3Qge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiByZ2JhKDE2LCAxMywgMjAsIDAuODIpO1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEzcHg7XG4gIGJveC1zaGFkb3c6IDAgMThweCA0MHB4IHJnYmEoNSwgMywgMTAsIDAuNDUpO1xufVxuXG4ubmNhcmQge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAyMHB4O1xuICBwYWRkaW5nOiAxMXB4IDEycHg7XG59XG4ubmNhcmQgLm5pYyB7XG4gIG1pbi13aWR0aDogMzBweDtcbiAgbWluLWhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogOXB4O1xufVxuLm5jYXJkIHtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG4ubmNhcmQgbGFiZWwge1xuICBmb250LXNpemU6IDEyLjVweDtcbiAgZm9udC13ZWlnaHQ6IDY1MDtcbn1cbi5uY2FyZCAuYm9keSB7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDExLjhweDtcbiAgZm9udC13ZWlnaHQ6IDQwMDtcbn1cbi5uY2FyZCAud2hlbiB7XG4gIGNvbG9yOiAjOGQ4NjkzO1xuICBmb250LXNpemU6IDEwcHg7XG59XG4ubmNhcmQgLm54IHtcbiAgcGFkZGluZzogNXB4O1xuICBib3JkZXItcmFkaXVzOiA5OXB4O1xuICBjb2xvcjogIzhkODY5Mztcbn1cbi5uY2FyZCAubng6aG92ZXIge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMjYyMzJjO1xuICBjb2xvcjogI2VmODZhMDtcbn1cblxuLm5oZWFkIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgYm9yZGVyLXJhZGl1czogMTRweDtcbiAgcGFkZGluZzogOHB4IDhweCA4cHggMTRweDtcbiAgbWFyZ2luLWJvdHRvbTogOHB4O1xuICBib3gtc2hhZG93OiAwIDZweCAxOHB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi5uaGVhZCBsYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTMuNXB4O1xuICBmb250LXdlaWdodDogNjUwO1xufVxuLm5oZWFkIC5zdWIge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA0MDA7XG4gIGNvbG9yOiAjOGQ4NjkzO1xufVxuLm5oZWFkIC5uY2xlYXIge1xuICBjb2xvcjogI2VmODZhMDtcbiAgZm9udC1zaXplOiAxMS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGJvcmRlci1yYWRpdXM6IDdweDtcbiAgcGFkZGluZzogNHB4IDlweDtcbn1cbi5uaGVhZCAubmNsZWFyOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cblxuLm9zZCB7XG4gIGJhY2tncm91bmQtY29sb3I6IHJnYmEoMTYsIDEzLCAyMCwgMC44Mik7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBwYWRkaW5nOiAxMHB4IDE1cHg7XG59XG4ub3NkIGltYWdlIHtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIC1ndGstaWNvbi1zaXplOiAxNXB4O1xufVxuLm9zZCBzY2FsZSA+IHRyb3VnaCwgLm9zZCBzY2FsZSA+IHRyb3VnaCA+IGhpZ2hsaWdodCB7XG4gIG1pbi1oZWlnaHQ6IDhweDtcbn1cbi5vc2QgLnN2YWwge1xuICBtaW4td2lkdGg6IDM0cHg7XG4gIGNvbG9yOiAjYjVhZGJjO1xuICBmb250LXNpemU6IDEycHg7XG59XG5cbi5zZXNzaW9uIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogcmdiYSg5LCAzLCAxNCwgMC44KTtcbn1cbi5zZXNzaW9uIC5zYnRuIHtcbiAgcGFkZGluZzogNnB4O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xufVxuLnNlc3Npb24gLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxMDBlMTQ7XG4gIGJvcmRlci1yYWRpdXM6IDI0cHg7XG4gIG1pbi13aWR0aDogNTlweDtcbiAgbWluLWhlaWdodDogNTlweDtcbiAgYm94LXNoYWRvdzogMCA2cHggMThweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICB0cmFuc2l0aW9uOiBiYWNrZ3JvdW5kLWNvbG9yIDIwMG1zLCBjb2xvciAyMDBtcztcbn1cbi5zZXNzaW9uIC5yZWQgLnNpYyB7XG4gIGNvbG9yOiAjZWY4NmEwO1xufVxuLnNlc3Npb24gLnNidG46aG92ZXIgLnNpYyB7XG4gIGJhY2tncm91bmQtY29sb3I6ICMxZDFhMjI7XG4gIGNvbG9yOiAjZjNlZWYzO1xufVxuLnNlc3Npb24gLnJlZDpob3ZlciAuc2ljIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogI2VmODZhMDtcbiAgY29sb3I6ICM0YjBmMWY7XG59XG4uc2Vzc2lvbiBsYWJlbCB7XG4gIGNvbG9yOiAjZjNlZWYzO1xuICBmb250LXdlaWdodDogNjAwO1xuICBmb250LXNpemU6IDEycHg7XG59XG4uc2Vzc2lvbiAuY29uZmlybSBsYWJlbCB7XG4gIGNvbG9yOiAjZWY4NmEwO1xuICBmb250LXdlaWdodDogNjUwO1xufVxuXG4uY21lbnUge1xuICBiYWNrZ3JvdW5kLWNvbG9yOiAjMTAwZTE0O1xuICBib3JkZXItcmFkaXVzOiAxMnB4O1xuICBwYWRkaW5nOiA1cHg7XG59XG4uY21lbnUgLmNtaSB7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogOHB4IDEwcHg7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5jbWVudSAuY21pOmhvdmVyIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbn1cbi5jbWVudSAuY21pLmRhbmdlcjpob3ZlciB7XG4gIGJhY2tncm91bmQtY29sb3I6ICNlZjg2YTA7XG4gIGNvbG9yOiAjNGIwZjFmO1xufVxuLmNtZW51IC5jc2VwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzFkMWEyMjtcbiAgbWluLWhlaWdodDogMXB4O1xuICBtYXJnaW46IDRweCA4cHg7XG59XG5cbi5kdGlwIHtcbiAgYmFja2dyb3VuZC1jb2xvcjogIzEwMGUxNDtcbiAgY29sb3I6ICNmM2VlZjM7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDZweCAxMXB4O1xuICBmb250LXNpemU6IDExLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn0iLCAiLy8gVGhlIHRva2VuIGxheWVyIFx1MjAxNCB0aGUgc2luZ2xlIHBsYWNlIHRoZSBzaGVsbCdzIGdlb21ldHJ5IGNvbWVzIGZyb20uXG4vLyBQcm90b3R5cGUgZXF1aXZhbGVudDogdGhlIENTUyBjdXN0b20gcHJvcGVydGllcyBvbiAuZGVza3RvcCAoMDRiZTcyZSkuXG4vLyBDaGFuZ2UgYSB2YWx1ZSBoZXJlIGFuZCBiYXIsIHBhbmVscywgZG9jaywgc25hcC1hbmNob3JlZCBzdXJmYWNlcyBhbGwgcmVmbG93LlxuXG5leHBvcnQgaW50ZXJmYWNlIFRva2VucyB7XG4gIGJhckg6IG51bWJlciAgICAgIC8vIHB4IFx1MjAxNCBiYXIgaGVpZ2h0OyBjb250cm9scyBkZXJpdmUgZnJvbSBpdFxuICBiYXJSOiBudW1iZXIgICAgICAvLyBiYXIgY29ybmVyIHJhZGl1c1xuICBnYXA6IG51bWJlciAgICAgICAvLyBzY3JlZW4gZ2FwIChiYXIgdG9wIG9mZnNldCwgZG9jayBib3R0b20gb2Zmc2V0KVxuICBlZGdlOiBudW1iZXIgICAgICAvLyBzaWRlIGluc2V0c1xuICBpY29uOiBudW1iZXIgICAgICAvLyBkb2NrL2xhdW5jaGVyIGljb24gdGlsZSBzaXplXG4gIGRvY2tQYWQ6IG51bWJlciAgIC8vIGRvY2sgcGFkZGluZyAoY29uY2VudHJpYyByYWRpdXMgZGVyaXZlcylcbiAgdGlsZUg6IG51bWJlciAgICAgLy8gUVMgdGlsZSBoZWlnaHRcbiAgcGFuZWxXOiBudW1iZXIgICAgLy8gUVMvbm90aWZpY2F0aW9ucy90b2FzdHMgd2lkdGhcbiAgbGF1bmNoZXJXOiBudW1iZXJcbiAgY2FsZW5kYXJXOiBudW1iZXJcbn1cblxuZXhwb3J0IGNvbnN0IGZsb2F0aW5nOiBUb2tlbnMgPSB7XG4gIGJhckg6IDQyLCBiYXJSOiAxNCwgZ2FwOiAxMCwgZWRnZTogMTIsXG4gIGljb246IDQ0LCBkb2NrUGFkOiA1LCB0aWxlSDogNTQsXG4gIHBhbmVsVzogMzUyLCBsYXVuY2hlclc6IDU2MCwgY2FsZW5kYXJXOiAzMzAsXG59XG5cbi8vIGdhcGxlc3MgPSBhIHRva2VuIHByZXNldCwgZXhhY3RseSBsaWtlIHRoZSBwcm90b3R5cGUncyAuZ2FwbGVzcyBjbGFzc1xuZXhwb3J0IGNvbnN0IGdhcGxlc3M6IFRva2VucyA9IHtcbiAgLi4uZmxvYXRpbmcsIGJhckg6IDM4LCBiYXJSOiAwLCBnYXA6IDAsIGVkZ2U6IDAsXG59XG5cbmV4cG9ydCBsZXQgdG9rZW5zOiBUb2tlbnMgPSBmbG9hdGluZ1xuXG5leHBvcnQgY29uc3QgY3RsID0gKCkgPT4gdG9rZW5zLmJhckggLSAxMSAgICAgICAgICAgICAgLy8gYmFyIGNvbnRyb2wgc2l6ZVxuZXhwb3J0IGNvbnN0IHBhbmVsVG9wID0gKCkgPT4gdG9rZW5zLmdhcCArIHRva2Vucy5iYXJIICsgNlxuXG4vLyBHVEsgQ1NTIGNhbid0IGNhbGMoKSBmcm9tIEpTIHN0YXRlOyB3ZSByZWdlbmVyYXRlIGEgOnJvb3QtaXNoIGJsb2NrIGFuZFxuLy8gbGV0IEFwcC5hcHBseV9jc3MgcmUtc2tpbiBsaXZlICh0aGUgXCJiYXIgNDIgY3ljbGVyXCIgb2YgdGhlIFFNTC9BR1Mgd29ybGQpLlxuZXhwb3J0IGZ1bmN0aW9uIHRva2VuQ3NzKHQ6IFRva2VucyA9IHRva2Vucyk6IHN0cmluZyB7XG4gIHJldHVybiBgXG4gIC5iYXIgeyBtaW4taGVpZ2h0OiAke3QuYmFySH1weDsgYm9yZGVyLXJhZGl1czogJHt0LmJhclJ9cHg7XG4gICAgICAgICBtYXJnaW46IDA7IH1cbiAgLmJhciBidXR0b24geyBtaW4td2lkdGg6ICR7Y3RsKCl9cHg7IG1pbi1oZWlnaHQ6ICR7Y3RsKCl9cHg7IH1cbiAgLmRvY2sgeyBwYWRkaW5nOiAke3QuZG9ja1BhZH1weDsgYm9yZGVyLXJhZGl1czogJHsxMiArIHQuZG9ja1BhZCAtIDF9cHg7XG4gICAgICAgICAgbWFyZ2luLWJvdHRvbTogJHt0LmdhcH1weDsgfVxuICAuaWNvbi10aWxlIHsgbWluLXdpZHRoOiAke3QuaWNvbn1weDsgbWluLWhlaWdodDogJHt0Lmljb259cHg7IH1cbiAgLnFzLCAuZHJhd2VyLCAuY2FsZW5kYXIgeyBtYXJnaW4tdG9wOiAke3BhbmVsVG9wKCl9cHg7IH1cbiAgLnFzIHsgbWluLXdpZHRoOiAke3QucGFuZWxXIC0gMjR9cHg7IH0gIC8qIHBhbmVsVyBpcyBvdXRlcjsgc3VidHJhY3QgLnNoZWV0IHBhZGRpbmcgMTJweFx1MDBENzIgKi9cbiAgLmxhdW5jaGVyIHsgbWluLXdpZHRoOiAke3QubGF1bmNoZXJXfXB4OyB9XG4gIC5jYWxlbmRhciB7IG1pbi13aWR0aDogJHt0LmNhbGVuZGFyV31weDsgfVxuICAuY2hpcCB7IG1pbi1oZWlnaHQ6ICR7dC50aWxlSH1weDsgfVxuICBgXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRUb2tlbnMobmV4dDogUGFydGlhbDxUb2tlbnM+LCBhcHBseTogKGNzczogc3RyaW5nKSA9PiB2b2lkKSB7XG4gIHRva2VucyA9IHsgLi4udG9rZW5zLCAuLi5uZXh0IH1cbiAgYXBwbHkodG9rZW5Dc3ModG9rZW5zKSlcbn1cbiIsICIvLyBvcmcuZ25vYmxpbi5TaGVsbCBcdTIwMTQgdGhlIGNvbXBvc2l0b3IgbGluay4gRHJpdmVzOiBzb2Z0LXJlbG9hZCwgZmVhdHVyZSB0b2dnbGVzLFxuLy8gdGhlIFdJTkRPVyBMSVNUIHRoYXQgbWFrZXMgdGhlIGRvY2sgdHJ1dGhmdWwsIGFuZCB0aGUgY29ubmVjdGVkL2FtYmVyIHN0YXRlLlxuLy8gUHJvdG90eXBlOiBzZXJ2aWNlcyAnZ25vYicgYmFubmVyICsgYmFyIGFtYmVyIHNlZ21lbnQgKyBXTSBpbnRlZ3JhdGlvbi5cblxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW9cIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5pbXBvcnQgeyBWYXJpYWJsZSB9IGZyb20gXCJhc3RhbFwiXG5cbmNvbnN0IEJVUyA9IFwib3JnLmdub2JsaW4uU2hlbGxcIlxuY29uc3QgUEFUSCA9IFwiL29yZy9nbm9ibGluL1NoZWxsXCJcbmNvbnN0IElGQUNFID0gXCJvcmcuZ25vYmxpbi5TaGVsbFwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgR25vYmxpbldpbmRvdyB7XG4gIGlkOiBzdHJpbmdcbiAgYXBwSWQ6IHN0cmluZ1xuICB0aXRsZTogc3RyaW5nXG4gIGZvY3VzZWQ6IGJvb2xlYW5cbiAgbWluaW1pemVkOiBib29sZWFuXG59XG5cbmV4cG9ydCBjb25zdCBjb25uZWN0ZWQgPSBWYXJpYWJsZShmYWxzZSlcbmV4cG9ydCBjb25zdCB3aW5kb3dzID0gVmFyaWFibGU8R25vYmxpbldpbmRvd1tdPihbXSlcblxubGV0IHByb3h5OiBHaW8uREJ1c1Byb3h5IHwgbnVsbCA9IG51bGxcblxuZnVuY3Rpb24gY2FsbChtZXRob2Q6IHN0cmluZywgcGFyYW1zOiBHTGliLlZhcmlhbnQgfCBudWxsID0gbnVsbCk6IFByb21pc2U8R0xpYi5WYXJpYW50IHwgbnVsbD4ge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlcywgcmVqKSA9PiB7XG4gICAgaWYgKCFwcm94eSkgcmV0dXJuIHJlaihuZXcgRXJyb3IoXCJnbm9ibGluOiBub3QgY29ubmVjdGVkXCIpKVxuICAgIHByb3h5LmNhbGwobWV0aG9kLCBwYXJhbXMsIEdpby5EQnVzQ2FsbEZsYWdzLk5PTkUsIDIwMDAsIG51bGwsIChfLCByKSA9PiB7XG4gICAgICB0cnkgeyByZXMocHJveHkhLmNhbGxfZmluaXNoKHIpKSB9IGNhdGNoIChlKSB7IHJlaihlKSB9XG4gICAgfSlcbiAgfSlcbn1cblxuZXhwb3J0IGNvbnN0IHJlbG9hZCA9ICgpID0+IGNhbGwoXCJSZWxvYWRcIilcbmV4cG9ydCBjb25zdCBzZXRGZWF0dXJlID0gKG5hbWU6IHN0cmluZywgb246IGJvb2xlYW4pID0+XG4gIGNhbGwoXCJTZXRGZWF0dXJlXCIsIG5ldyBHTGliLlZhcmlhbnQoXCIoc2IpXCIsIFtuYW1lLCBvbl0pKVxuXG4vLyBXaW5kb3cgdmVyYnMgKHRoZSBkb2NrIGNsaWNrIG1vZGVsKVxuZXhwb3J0IGNvbnN0IGFjdGl2YXRlID0gKGlkOiBzdHJpbmcpID0+IGNhbGwoXCJBY3RpdmF0ZVdpbmRvd1wiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHMpXCIsIFtpZF0pKVxuZXhwb3J0IGNvbnN0IG1pbmltaXplID0gKGlkOiBzdHJpbmcpID0+IGNhbGwoXCJNaW5pbWl6ZVdpbmRvd1wiLCBuZXcgR0xpYi5WYXJpYW50KFwiKHMpXCIsIFtpZF0pKVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFdpbmRvd3MoKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdiA9IGF3YWl0IGNhbGwoXCJMaXN0V2luZG93c1wiKVxuICAgIGlmICghdikgcmV0dXJuXG4gICAgY29uc3QgW2xpc3RdID0gdi5kZWVwX3VucGFjaygpIGFzIFtHbm9ibGluV2luZG93W11dXG4gICAgd2luZG93cy5zZXQobGlzdClcbiAgfSBjYXRjaCB7IC8qIHN0YXkgb24gbGFzdC1rbm93biBsaXN0OyBjb25uZWN0ZWQgZmxhZyBjYXJyaWVzIHRoZSB0cnV0aCAqLyB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBXaW5kb3dzKGFwcElkOiBzdHJpbmcpOiBHbm9ibGluV2luZG93W10ge1xuICByZXR1cm4gd2luZG93cy5nZXQoKS5maWx0ZXIodyA9PiB3LmFwcElkID09PSBhcHBJZClcbn1cblxuLy8gQ3ljbGUgPSB0aGUgZG9jayBjYXJvdXNlbDogZm9jdXMgdGhlIG5leHQgd2luZG93IG9mIHRoZSBhcHBcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjeWNsZShhcHBJZDogc3RyaW5nLCBkaXI6IDEgfCAtMSkge1xuICBjb25zdCB3cyA9IGFwcFdpbmRvd3MoYXBwSWQpXG4gIGlmICh3cy5sZW5ndGggPCAyKSByZXR1cm5cbiAgY29uc3QgaSA9IHdzLmZpbmRJbmRleCh3ID0+IHcuZm9jdXNlZClcbiAgYXdhaXQgYWN0aXZhdGUod3NbKChpIDwgMCA/IDAgOiBpKSArIGRpciArIHdzLmxlbmd0aCkgJSB3cy5sZW5ndGhdLmlkKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaW5pdCgpIHtcbiAgR2lvLmJ1c193YXRjaF9uYW1lKFxuICAgIEdpby5CdXNUeXBlLlNFU1NJT04sIEJVUywgR2lvLkJ1c05hbWVXYXRjaGVyRmxhZ3MuTk9ORSxcbiAgICAoKSA9PiB7ICAvLyBhcHBlYXJlZFxuICAgICAgR2lvLkRCdXNQcm94eS5uZXdfZm9yX2J1cyhcbiAgICAgICAgR2lvLkJ1c1R5cGUuU0VTU0lPTiwgR2lvLkRCdXNQcm94eUZsYWdzLk5PTkUsIG51bGwsXG4gICAgICAgIEJVUywgUEFUSCwgSUZBQ0UsIG51bGwsXG4gICAgICAgIChfLCByZXMpID0+IHtcbiAgICAgICAgICBwcm94eSA9IEdpby5EQnVzUHJveHkubmV3X2Zvcl9idXNfZmluaXNoKHJlcylcbiAgICAgICAgICBwcm94eS5jb25uZWN0KFwiZy1zaWduYWxcIiwgKF9wLCBfcywgc2lnKSA9PiB7XG4gICAgICAgICAgICBpZiAoc2lnID09PSBcIldpbmRvd3NDaGFuZ2VkXCIpIHJlZnJlc2hXaW5kb3dzKClcbiAgICAgICAgICB9KVxuICAgICAgICAgIGNvbm5lY3RlZC5zZXQodHJ1ZSlcbiAgICAgICAgICByZWZyZXNoV2luZG93cygpXG4gICAgICAgIH0pXG4gICAgfSxcbiAgICAoKSA9PiB7ICAvLyB2YW5pc2hlZCBcdTIxOTIgYW1iZXIgZXZlcnl3aGVyZSB0aGF0IGxpc3RlbnNcbiAgICAgIHByb3h5ID0gbnVsbFxuICAgICAgY29ubmVjdGVkLnNldChmYWxzZSlcbiAgICB9KVxufVxuIiwgImltcG9ydCBcIi4vb3ZlcnJpZGVzLmpzXCJcbmV4cG9ydCB7IGRlZmF1bHQgYXMgQXN0YWxJTyB9IGZyb20gXCJnaTovL0FzdGFsSU8/dmVyc2lvbj0wLjFcIlxuZXhwb3J0ICogZnJvbSBcIi4vcHJvY2Vzcy5qc1wiXG5leHBvcnQgKiBmcm9tIFwiLi90aW1lLmpzXCJcbmV4cG9ydCAqIGZyb20gXCIuL2ZpbGUuanNcIlxuZXhwb3J0ICogZnJvbSBcIi4vZ29iamVjdC5qc1wiXG5leHBvcnQgeyBCaW5kaW5nLCBiaW5kIH0gZnJvbSBcIi4vYmluZGluZy5qc1wiXG5leHBvcnQgeyBWYXJpYWJsZSwgZGVyaXZlIH0gZnJvbSBcIi4vdmFyaWFibGUuanNcIlxuIiwgImltcG9ydCBBc3RhbCBmcm9tIFwiZ2k6Ly9Bc3RhbElPXCJcbmltcG9ydCBHaW8gZnJvbSBcImdpOi8vR2lvP3ZlcnNpb249Mi4wXCJcblxuZXhwb3J0IHsgR2lvIH1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGaWxlKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEFzdGFsLnJlYWRfZmlsZShwYXRoKSB8fCBcIlwiXG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWFkRmlsZUFzeW5jKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgQXN0YWwucmVhZF9maWxlX2FzeW5jKHBhdGgsIChfLCByZXMpID0+IHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZShBc3RhbC5yZWFkX2ZpbGVfZmluaXNoKHJlcykgfHwgXCJcIilcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKVxuICAgICAgICAgICAgfVxuICAgICAgICB9KVxuICAgIH0pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUZpbGUocGF0aDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBBc3RhbC53cml0ZV9maWxlKHBhdGgsIGNvbnRlbnQpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB3cml0ZUZpbGVBc3luYyhwYXRoOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIEFzdGFsLndyaXRlX2ZpbGVfYXN5bmMocGF0aCwgY29udGVudCwgKF8sIHJlcykgPT4ge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICByZXNvbHZlKEFzdGFsLndyaXRlX2ZpbGVfZmluaXNoKHJlcykpXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIHJlamVjdChlcnJvcilcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICB9KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbW9uaXRvckZpbGUoXG4gICAgcGF0aDogc3RyaW5nLFxuICAgIGNhbGxiYWNrOiAoZmlsZTogc3RyaW5nLCBldmVudDogR2lvLkZpbGVNb25pdG9yRXZlbnQpID0+IHZvaWQsXG4pOiBHaW8uRmlsZU1vbml0b3Ige1xuICAgIHJldHVybiBBc3RhbC5tb25pdG9yX2ZpbGUocGF0aCwgKGZpbGU6IHN0cmluZywgZXZlbnQ6IEdpby5GaWxlTW9uaXRvckV2ZW50KSA9PiB7XG4gICAgICAgIGNhbGxiYWNrKGZpbGUsIGV2ZW50KVxuICAgIH0pIVxufVxuIiwgImltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuXG5leHBvcnQgeyBkZWZhdWx0IGFzIEdMaWIgfSBmcm9tIFwiZ2k6Ly9HTGliP3ZlcnNpb249Mi4wXCJcbmV4cG9ydCB7IEdPYmplY3QsIEdPYmplY3QgYXMgZGVmYXVsdCB9XG5cbmNvbnN0IG1ldGEgPSBTeW1ib2woXCJtZXRhXCIpXG5jb25zdCBwcml2ID0gU3ltYm9sKFwicHJpdlwiKVxuXG5jb25zdCB7IFBhcmFtU3BlYywgUGFyYW1GbGFncyB9ID0gR09iamVjdFxuXG5jb25zdCBrZWJhYmlmeSA9IChzdHI6IHN0cmluZykgPT4gc3RyXG4gICAgLnJlcGxhY2UoLyhbYS16XSkoW0EtWl0pL2csIFwiJDEtJDJcIilcbiAgICAucmVwbGFjZUFsbChcIl9cIiwgXCItXCIpXG4gICAgLnRvTG93ZXJDYXNlKClcblxudHlwZSBTaWduYWxEZWNsYXJhdGlvbiA9IHtcbiAgICBmbGFncz86IEdPYmplY3QuU2lnbmFsRmxhZ3NcbiAgICBhY2N1bXVsYXRvcj86IEdPYmplY3QuQWNjdW11bGF0b3JUeXBlXG4gICAgcmV0dXJuX3R5cGU/OiBHT2JqZWN0LkdUeXBlXG4gICAgcGFyYW1fdHlwZXM/OiBBcnJheTxHT2JqZWN0LkdUeXBlPlxufVxuXG50eXBlIFByb3BlcnR5RGVjbGFyYXRpb24gPVxuICAgIHwgSW5zdGFuY2VUeXBlPHR5cGVvZiBHT2JqZWN0LlBhcmFtU3BlYz5cbiAgICB8IHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH1cbiAgICB8IHR5cGVvZiBTdHJpbmdcbiAgICB8IHR5cGVvZiBOdW1iZXJcbiAgICB8IHR5cGVvZiBCb29sZWFuXG4gICAgfCB0eXBlb2YgT2JqZWN0XG5cbnR5cGUgR09iamVjdENvbnN0cnVjdG9yID0ge1xuICAgIFttZXRhXT86IHtcbiAgICAgICAgUHJvcGVydGllcz86IHsgW2tleTogc3RyaW5nXTogR09iamVjdC5QYXJhbVNwZWMgfVxuICAgICAgICBTaWduYWxzPzogeyBba2V5OiBzdHJpbmddOiBHT2JqZWN0LlNpZ25hbERlZmluaXRpb24gfVxuICAgIH1cbiAgICBuZXcoLi4uYXJnczogYW55W10pOiBhbnlcbn1cblxudHlwZSBNZXRhSW5mbyA9IEdPYmplY3QuTWV0YUluZm88bmV2ZXIsIEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0+LCBuZXZlcj5cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyKG9wdGlvbnM6IE1ldGFJbmZvID0ge30pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKGNsczogR09iamVjdENvbnN0cnVjdG9yKSB7XG4gICAgICAgIGNvbnN0IHQgPSBvcHRpb25zLlRlbXBsYXRlXG4gICAgICAgIGlmICh0eXBlb2YgdCA9PT0gXCJzdHJpbmdcIiAmJiAhdC5zdGFydHNXaXRoKFwicmVzb3VyY2U6Ly9cIikgJiYgIXQuc3RhcnRzV2l0aChcImZpbGU6Ly9cIikpIHtcbiAgICAgICAgICAgIC8vIGFzc3VtZSB4bWwgdGVtcGxhdGVcbiAgICAgICAgICAgIG9wdGlvbnMuVGVtcGxhdGUgPSBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUodClcbiAgICAgICAgfVxuXG4gICAgICAgIEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7XG4gICAgICAgICAgICBTaWduYWxzOiB7IC4uLmNsc1ttZXRhXT8uU2lnbmFscyB9LFxuICAgICAgICAgICAgUHJvcGVydGllczogeyAuLi5jbHNbbWV0YV0/LlByb3BlcnRpZXMgfSxcbiAgICAgICAgICAgIC4uLm9wdGlvbnMsXG4gICAgICAgIH0sIGNscylcblxuICAgICAgICBkZWxldGUgY2xzW21ldGFdXG4gICAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcHJvcGVydHkoZGVjbGFyYXRpb246IFByb3BlcnR5RGVjbGFyYXRpb24gPSBPYmplY3QpIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldDogYW55LCBwcm9wOiBhbnksIGRlc2M/OiBQcm9wZXJ0eURlc2NyaXB0b3IpIHtcbiAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdID8/PSB7fVxuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uUHJvcGVydGllcyA/Pz0ge31cblxuICAgICAgICBjb25zdCBuYW1lID0ga2ViYWJpZnkocHJvcClcblxuICAgICAgICBpZiAoIWRlc2MpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIHByb3AsIHtcbiAgICAgICAgICAgICAgICBnZXQoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW3ByaXZdPy5bcHJvcF0gPz8gZGVmYXVsdFZhbHVlKGRlY2xhcmF0aW9uKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgc2V0KHY6IGFueSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodiAhPT0gdGhpc1twcm9wXSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpc1twcml2XSA/Pz0ge31cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXNbcHJpdl1bcHJvcF0gPSB2XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeShuYW1lKVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBzZXRfJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWUodjogYW55KSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXNbcHJvcF0gPSB2XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0YXJnZXQsIGBnZXRfJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWUoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzW3Byb3BdXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0pXG5cbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzW2tlYmFiaWZ5KHByb3ApXSA9IHBzcGVjKG5hbWUsIFBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBkZWNsYXJhdGlvbilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBmbGFncyA9IDBcbiAgICAgICAgICAgIGlmIChkZXNjLmdldCkgZmxhZ3MgfD0gUGFyYW1GbGFncy5SRUFEQUJMRVxuICAgICAgICAgICAgaWYgKGRlc2Muc2V0KSBmbGFncyB8PSBQYXJhbUZsYWdzLldSSVRBQkxFXG5cbiAgICAgICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5Qcm9wZXJ0aWVzW2tlYmFiaWZ5KHByb3ApXSA9IHBzcGVjKG5hbWUsIGZsYWdzLCBkZWNsYXJhdGlvbilcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNpZ25hbCguLi5wYXJhbXM6IEFycmF5PHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0Pik6XG4odGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB2b2lkXG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoZGVjbGFyYXRpb24/OiBTaWduYWxEZWNsYXJhdGlvbik6XG4odGFyZ2V0OiBhbnksIHNpZ25hbDogYW55LCBkZXNjPzogUHJvcGVydHlEZXNjcmlwdG9yKSA9PiB2b2lkXG5cbmV4cG9ydCBmdW5jdGlvbiBzaWduYWwoXG4gICAgZGVjbGFyYXRpb24/OiBTaWduYWxEZWNsYXJhdGlvbiB8IHsgJGd0eXBlOiBHT2JqZWN0LkdUeXBlIH0gfCB0eXBlb2YgT2JqZWN0LFxuICAgIC4uLnBhcmFtczogQXJyYXk8eyAkZ3R5cGU6IEdPYmplY3QuR1R5cGUgfSB8IHR5cGVvZiBPYmplY3Q+XG4pIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldDogYW55LCBzaWduYWw6IGFueSwgZGVzYz86IFByb3BlcnR5RGVzY3JpcHRvcikge1xuICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0gPz89IHt9XG4gICAgICAgIHRhcmdldC5jb25zdHJ1Y3RvclttZXRhXS5TaWduYWxzID8/PSB7fVxuXG4gICAgICAgIGNvbnN0IG5hbWUgPSBrZWJhYmlmeShzaWduYWwpXG5cbiAgICAgICAgaWYgKGRlY2xhcmF0aW9uIHx8IHBhcmFtcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIFRPRE86IHR5cGUgYXNzZXJ0XG4gICAgICAgICAgICBjb25zdCBhcnIgPSBbZGVjbGFyYXRpb24sIC4uLnBhcmFtc10ubWFwKHYgPT4gdi4kZ3R5cGUpXG4gICAgICAgICAgICB0YXJnZXQuY29uc3RydWN0b3JbbWV0YV0uU2lnbmFsc1tuYW1lXSA9IHtcbiAgICAgICAgICAgICAgICBwYXJhbV90eXBlczogYXJyLFxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGFyZ2V0LmNvbnN0cnVjdG9yW21ldGFdLlNpZ25hbHNbbmFtZV0gPSBkZWNsYXJhdGlvbiB8fCB7XG4gICAgICAgICAgICAgICAgcGFyYW1fdHlwZXM6IFtdLFxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFkZXNjKSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBzaWduYWwsIHtcbiAgICAgICAgICAgICAgICB2YWx1ZTogZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdChuYW1lLCAuLi5hcmdzKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgb2c6ICgoLi4uYXJnczogYW55W10pID0+IHZvaWQpID0gZGVzYy52YWx1ZVxuICAgICAgICAgICAgZGVzYy52YWx1ZSA9IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igbm90IHR5cGVkXG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0KG5hbWUsIC4uLmFyZ3MpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGFyZ2V0LCBgb25fJHtuYW1lLnJlcGxhY2UoXCItXCIsIFwiX1wiKX1gLCB7XG4gICAgICAgICAgICAgICAgdmFsdWU6IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gb2cuYXBwbHkodGhpcywgYXJncylcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gcHNwZWMobmFtZTogc3RyaW5nLCBmbGFnczogbnVtYmVyLCBkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbikge1xuICAgIGlmIChkZWNsYXJhdGlvbiBpbnN0YW5jZW9mIFBhcmFtU3BlYylcbiAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uXG5cbiAgICBzd2l0Y2ggKGRlY2xhcmF0aW9uKSB7XG4gICAgICAgIGNhc2UgU3RyaW5nOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5zdHJpbmcobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIFwiXCIpXG4gICAgICAgIGNhc2UgTnVtYmVyOlxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5kb3VibGUobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIC1OdW1iZXIuTUFYX1ZBTFVFLCBOdW1iZXIuTUFYX1ZBTFVFLCAwKVxuICAgICAgICBjYXNlIEJvb2xlYW46XG4gICAgICAgICAgICByZXR1cm4gUGFyYW1TcGVjLmJvb2xlYW4obmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIGZhbHNlKVxuICAgICAgICBjYXNlIE9iamVjdDpcbiAgICAgICAgICAgIHJldHVybiBQYXJhbVNwZWMuanNvYmplY3QobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MpXG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG1pc3N0eXBlZFxuICAgICAgICAgICAgcmV0dXJuIFBhcmFtU3BlYy5vYmplY3QobmFtZSwgXCJcIiwgXCJcIiwgZmxhZ3MsIGRlY2xhcmF0aW9uLiRndHlwZSlcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRWYWx1ZShkZWNsYXJhdGlvbjogUHJvcGVydHlEZWNsYXJhdGlvbikge1xuICAgIGlmIChkZWNsYXJhdGlvbiBpbnN0YW5jZW9mIFBhcmFtU3BlYylcbiAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uLmdldF9kZWZhdWx0X3ZhbHVlKClcblxuICAgIHN3aXRjaCAoZGVjbGFyYXRpb24pIHtcbiAgICAgICAgY2FzZSBTdHJpbmc6XG4gICAgICAgICAgICByZXR1cm4gXCJcIlxuICAgICAgICBjYXNlIE51bWJlcjpcbiAgICAgICAgICAgIHJldHVybiAwXG4gICAgICAgIGNhc2UgQm9vbGVhbjpcbiAgICAgICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgICBjYXNlIE9iamVjdDpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHJldHVybiBudWxsXG4gICAgfVxufVxuIiwgIi8vIERlZmVycmVkLCBub24tYmxvY2tpbmcgQXN0YWxOb3RpZmQgYWNjZXNzLiBnZXRfZGVmYXVsdCgpIGNhbiBibG9jayBvbiBhIGhlYWRsZXNzIG9yXG4vLyBjb250ZW5kZWQgc2Vzc2lvbiBidXMgKGl0IHRyaWVzIHRvIGJlY29tZSBvcmcuZnJlZWRlc2t0b3AuTm90aWZpY2F0aW9ucyBhbmQgd2FpdHMpLFxuLy8gc28gd2UgTkVWRVIgdG91Y2ggaXQgZHVyaW5nIHdpZGdldCBjb25zdHJ1Y3Rpb24uIGluaXQoKSBpcyBjYWxsZWQgb25jZSBmcm9tIGFuIGlkbGVcbi8vIGFmdGVyIHRoZSBzaGVsbCBpcyBtYXBwZWQ7IG9uIHJlYWwgaGFyZHdhcmUgaXQgcmV0dXJucyBmYXN0LCBpbiB0aGUgc3RyaXBwZWQgZGV2a2l0XG4vLyBpdCBtYXkgbm8tb3AuIFdpZGdldHMgYmluZCB0byBgdW5yZWFkYC9gbGlzdGAgYW5kIGh5ZHJhdGUgd2hlbiBpdCBsYW5kcy5cbmltcG9ydCB7IFZhcmlhYmxlLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuLy8gSW1wb3J0aW5nIHRoZSB0eXBlbGliIGlzIGNoZWFwICsgbm9uLWJsb2NraW5nOyBvbmx5IGdldF9kZWZhdWx0KCkgbWF5IGJsb2NrIChpdCB0cmllc1xuLy8gdG8gYmVjb21lIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zKSwgc28gd2UgY2FsbCBUSEFUIGxhemlseSBmcm9tIGFuIGlkbGUuIFRoZSBvbGRcbi8vIGBpbXBvcnRzLmdpLkFzdGFsTm90aWZkYCB0aHJvd3MgdW5kZXIgYGdqcyAtbWAgKEVTTSBoYXMgbm8gbGVnYWN5IGBpbXBvcnRzYCBnbG9iYWwpLlxuaW1wb3J0IE5vdGlmZCBmcm9tIFwiZ2k6Ly9Bc3RhbE5vdGlmZFwiXG5cbmV4cG9ydCBjb25zdCB1bnJlYWQgPSBWYXJpYWJsZSgwKVxuZXhwb3J0IGNvbnN0IHJlYWR5ID0gVmFyaWFibGUoZmFsc2UpXG5sZXQgbjogTm90aWZkLk5vdGlmZCB8IG51bGwgPSBudWxsXG5cbmV4cG9ydCBmdW5jdGlvbiBub3RpZmQoKSB7IHJldHVybiBuIH1cblxuZXhwb3J0IGZ1bmN0aW9uIGluaXQoKSB7XG4gIC8vIGdldGVudiByZXR1cm5zIFwiXCIgKGZhbHN5KSB3aGVuIHRoZSB2YXIgaXMgc2V0LWJ1dC1lbXB0eSwgbnVsbCB3aGVuIHVuc2V0IFx1MjAxNCBib3RoIHNraXBcbiAgLy8gY29ycmVjdGx5IG9ubHkgd2hlbiB0aGUgdmFsdWUgaXMgdHJ1dGh5IChcIjFcIikuXG4gIGlmIChHTGliLmdldGVudihcIktPQkVMX1NLSVBfTk9USUZEXCIpKSByZXR1cm5cbiAgLy8gZGVmZXIgcGFzdCBmaXJzdCBwYWludDsgaWYgZ2V0X2RlZmF1bHQgYmxvY2tzLCBpdCBibG9ja3Mgb25seSB0aGlzIGlkbGUgdGljayxcbiAgLy8gbmV2ZXIgY29uc3RydWN0aW9uL2ZpcnN0IHJlbmRlci5cbiAgdGltZW91dCg1MCwgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBuID0gTm90aWZkLmdldF9kZWZhdWx0KClcbiAgICAgIHJlYWR5LnNldCh0cnVlKVxuICAgICAgY29uc3Qgc3luYyA9ICgpID0+IHVucmVhZC5zZXQobiEubm90aWZpY2F0aW9ucy5sZW5ndGgpXG4gICAgICBuLmNvbm5lY3QoXCJub3RpZmllZFwiLCBzeW5jKTsgbi5jb25uZWN0KFwicmVzb2x2ZWRcIiwgc3luYyk7IHN5bmMoKVxuICAgIH0gY2F0Y2ggKGUpIHsgcHJpbnRlcnIoYGtvYmVsOiBub3RpZmQgaW5pdCBza2lwcGVkOiAke2V9YCkgfVxuICB9KVxufVxuIiwgIi8vIEdUSyB3aWRnZXQtdHJlZSBnZW9tZXRyeSBkdW1wZXIgXHUyMDE0IHRoZSBtaXJyb3Igb2YgdGhlIERPTSdzIGdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLlxuLy8gV2Fsa3MgYSBtYXBwZWQgd2luZG93IGFuZCByZWNvcmRzIGV2ZXJ5IHdpZGdldCdzIHJlYWwgYWxsb2NhdGlvbiAoeC95L3cvaCByZWxhdGl2ZVxuLy8gdG8gdGhlIHdpbmRvdyBjb250ZW50KSArIENTUyBjbGFzc2VzICsgdGV4dCwgc28gYSByZW5kZXJlZCBHVEsgc3VyZmFjZSBjYW4gYmUgZGlmZmVkXG4vLyAxOjEgYWdhaW5zdCB0aGUgcHJvdG90eXBlIERPTS4gR2F0ZWQgYnkgS09CRUxfRFVNUD08d2luZG93PiBpbiBhcHAudHMuXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0az92ZXJzaW9uPTQuMFwiXG5pbXBvcnQgR3JhcGhlbmUgZnJvbSBcImdpOi8vR3JhcGhlbmVcIlxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgTm9kZSB7XG4gIGQ6IG51bWJlcjsgdHlwZTogc3RyaW5nOyBjbHM6IHN0cmluZ1xuICB4OiBudW1iZXI7IHk6IG51bWJlcjsgdzogbnVtYmVyOyBoOiBudW1iZXI7IHQ6IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZHVtcFdpbmRvdyh3aW46IEd0ay5XaW5kb3cpOiBOb2RlW10ge1xuICBjb25zdCBvdXQ6IE5vZGVbXSA9IFtdXG4gIGNvbnN0IHJvb3Q6IGFueSA9IHdpblxuICBjb25zdCB3YWxrID0gKHc6IGFueSwgZGVwdGg6IG51bWJlcikgPT4ge1xuICAgIC8vIGNvbXB1dGVfYm91bmRzIGdpdmVzIHRoZSB3aWRnZXQncyBGVUxMIHJlbmRlcmVkIHJlY3QgKGluY2wuIGl0cyBvd24gcGFkZGluZykgaW5cbiAgICAvLyB0aGUgcm9vdCdzIGNvb3JkcyBcdTIwMTQgbW9yZSByZWxpYWJsZSB0aGFuIGNvbXB1dGVfcG9pbnQgKyBnZXRfd2lkdGggKHdoaWNoIGNhbiByZXBvcnRcbiAgICAvLyB0aGUgY2hpbGQvY29udGVudCBzaXplIGZvciBwYWRkZWQgYnV0dG9ucykuXG4gICAgbGV0IHggPSAwLCB5ID0gMCwgd2lkdGggPSAwLCBoZWlnaHQgPSAwXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlcyA9IHcuY29tcHV0ZV9ib3VuZHMocm9vdClcbiAgICAgIGNvbnN0IHJlY3QgPSBBcnJheS5pc0FycmF5KHJlcykgPyByZXNbMV0gOiByZXNcbiAgICAgIGlmIChyZWN0KSB7XG4gICAgICAgIHggPSByZWN0Lm9yaWdpbi54OyB5ID0gcmVjdC5vcmlnaW4ueVxuICAgICAgICB3aWR0aCA9IHJlY3Quc2l6ZS53aWR0aDsgaGVpZ2h0ID0gcmVjdC5zaXplLmhlaWdodFxuICAgICAgfVxuICAgIH0gY2F0Y2ggeyB9XG4gICAgaWYgKCF3aWR0aCkgeyB3aWR0aCA9IHcuZ2V0X3dpZHRoPy4oKSA/PyAwOyBoZWlnaHQgPSB3LmdldF9oZWlnaHQ/LigpID8/IDAgfVxuICAgIGNvbnN0IGNscyA9ICh3LmdldF9jc3NfY2xhc3Nlcz8uKCkgPz8gW10pLmpvaW4oXCIuXCIpXG4gICAgY29uc3QgdHlwZSA9ICh3LmNvbnN0cnVjdG9yPy5uYW1lID8/IFwiP1wiKS5yZXBsYWNlKC9fL2csIFwiXCIpXG4gICAgbGV0IHQgPSBcIlwiXG4gICAgdHJ5IHsgdCA9ICh3LmdldF9sYWJlbD8uKCkgPz8gdy5nZXRfdGV4dD8uKCkgPz8gXCJcIikudG9TdHJpbmcoKS5zbGljZSgwLCAyOCkgfSBjYXRjaCB7IH1cbiAgICBvdXQucHVzaCh7XG4gICAgICBkOiBkZXB0aCwgdHlwZSwgY2xzLFxuICAgICAgeDogTWF0aC5yb3VuZCh4KSwgeTogTWF0aC5yb3VuZCh5KSxcbiAgICAgIHc6IE1hdGgucm91bmQod2lkdGgpLCBoOiBNYXRoLnJvdW5kKGhlaWdodCksIHQsXG4gICAgfSlcbiAgICBsZXQgYyA9IHcuZ2V0X2ZpcnN0X2NoaWxkPy4oKVxuICAgIHdoaWxlIChjKSB7IHdhbGsoYywgZGVwdGggKyAxKTsgYyA9IGMuZ2V0X25leHRfc2libGluZygpIH1cbiAgfVxuICBjb25zdCBjaGlsZCA9IHdpbi5nZXRfY2hpbGQ/LigpXG4gIGlmIChjaGlsZCkgd2FsayhjaGlsZCwgMClcbiAgcmV0dXJuIG91dFxufVxuXG4vLyBQb2xsIHVudGlsIHRoZSBuYW1lZCB3aW5kb3cgaXMgdmlzaWJsZSArIGxhaWQgb3V0LCB0aGVuIGR1bXAgb25jZSB0byBLT0JFTF9EVU1QX09VVC5cbmV4cG9ydCBmdW5jdGlvbiBhcm1EdW1wKGdldFdpbmRvdzogKG5hbWU6IHN0cmluZykgPT4gR3RrLldpbmRvdyB8IG51bGwpIHtcbiAgY29uc3QgbmFtZSA9IEdMaWIuZ2V0ZW52KFwiS09CRUxfRFVNUFwiKVxuICBpZiAoIW5hbWUpIHJldHVyblxuICBjb25zdCBwYXRoID0gR0xpYi5nZXRlbnYoXCJLT0JFTF9EVU1QX09VVFwiKSB8fCBcIi90bXAva29iZWwtZHVtcC5qc29uXCJcbiAgbGV0IGRvbmUgPSBmYWxzZVxuICBHTGliLnRpbWVvdXRfYWRkKEdMaWIuUFJJT1JJVFlfREVGQVVMVCwgNDAwLCAoKSA9PiB7XG4gICAgaWYgKGRvbmUpIHJldHVybiBHTGliLlNPVVJDRV9SRU1PVkVcbiAgICBjb25zdCB3ID0gZ2V0V2luZG93KG5hbWUpXG4gICAgaWYgKHcgJiYgdy5nZXRfbWFwcGVkPy4oKSAmJiAody5nZXRfd2lkdGg/LigpID8/IDApID4gMCkge1xuICAgICAgLy8gb25lIG1vcmUgdGljayBzbyBmaW5hbCBhbGxvY2F0aW9uIHNldHRsZXNcbiAgICAgIEdMaWIudGltZW91dF9hZGQoR0xpYi5QUklPUklUWV9ERUZBVUxULCAyNTAsICgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB0cmVlID0gZHVtcFdpbmRvdyh3KVxuICAgICAgICAgIEdMaWIuZmlsZV9zZXRfY29udGVudHMocGF0aCwgSlNPTi5zdHJpbmdpZnkodHJlZSkpXG4gICAgICAgICAgcHJpbnRlcnIoYGtvYmVsOiBkdW1wZWQgJHt0cmVlLmxlbmd0aH0gd2lkZ2V0cyBvZiBcIiR7bmFtZX1cIiBcdTIxOTIgJHtwYXRofWApXG4gICAgICAgIH0gY2F0Y2ggKGUpIHsgcHJpbnRlcnIoYGtvYmVsOiBkdW1wIGZhaWxlZDogJHtlfWApIH1cbiAgICAgICAgcmV0dXJuIEdMaWIuU09VUkNFX1JFTU9WRVxuICAgICAgfSlcbiAgICAgIGRvbmUgPSB0cnVlXG4gICAgICByZXR1cm4gR0xpYi5TT1VSQ0VfUkVNT1ZFXG4gICAgfVxuICAgIHJldHVybiBHTGliLlNPVVJDRV9DT05USU5VRVxuICB9KVxufVxuIiwgIi8vIEFuaW1hdGVkIHN1cmZhY2UgcmVnaXN0cnkgXHUyMDE0IHJlcGxhY2VzIEFwcC50b2dnbGVfd2luZG93IGZvciBzdXJmYWNlcyB0aGF0IHdhbnRcbi8vIGEgcmV2ZWFsIGFuaW1hdGlvbi4gRWFjaCBzdXJmYWNlIGNhbGxzIHJlZ2lzdGVyKCkgb25jZSwgdGhlbiBCYXIvYXBwLnRzIGNhbGwgdG9nZ2xlKCkuXG4vL1xuLy8gUGF0dGVybjogd2luZG93IGFsd2F5cyBzdGFydHMgaGlkZGVuICh2aXNpYmxlPWZhbHNlKS4gT3BlbmluZyBtYWtlcyBpdCB2aXNpYmxlLFxuLy8gdGhlbiB0cmlnZ2VycyB0aGUgcmV2ZWFsZXI7IGNsb3NpbmcgdHJpZ2dlcnMgdGhlIHJldmVhbGVyIHRoZW4gaGlkZXMgYWZ0ZXIgdHJhbnNpdGlvbi5cbmltcG9ydCB7IEFwcCB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCB0aW1lb3V0IH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249NC4wXCJcblxuZXhwb3J0IHR5cGUgVHJhbnNpdGlvblR5cGUgPSBHdGsuUmV2ZWFsZXJUcmFuc2l0aW9uVHlwZVxuXG5jb25zdCByZWdpc3RyeTogUmVjb3JkPHN0cmluZywgKCkgPT4gdm9pZD4gPSB7fVxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXIobmFtZTogc3RyaW5nLCBmbjogKCkgPT4gdm9pZCkge1xuICByZWdpc3RyeVtuYW1lXSA9IGZuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b2dnbGUobmFtZTogc3RyaW5nKSB7XG4gIGlmIChyZWdpc3RyeVtuYW1lXSkge1xuICAgIHJlZ2lzdHJ5W25hbWVdKClcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjayBmb3Igc3VyZmFjZXMgd2l0aG91dCBhbmltYXRlZCByZXZlYWxzIChzZXNzaW9uLCBkcmF3ZXIpXG4gICAgQXBwLnRvZ2dsZV93aW5kb3cobmFtZSlcbiAgfVxufVxuXG4vLyBtYWtlUmV2ZWFsOiBjcmVhdGVzIHRoZSBzdGF0ZSB2YXJpYWJsZXMgYW5kIHRvZ2dsZSBmdW5jdGlvbiBmb3IgYW4gYW5pbWF0ZWQgc3VyZmFjZS5cbi8vICAgLSBvcGVuTXM6IHJldmVhbC1pbiBkdXJhdGlvbiBpbiBtcyAoZGVmYXVsdCAyMjApXG4vLyAgIC0gY2xvc2VNczogcmV2ZWFsLW91dCArIHdpbmRvdy1oaWRlIGRlbGF5IGluIG1zIChkZWZhdWx0IDE1MClcbi8vICAgLSByZXZlYWxlclJlZjogc2V0IHRoaXMgdG8gdGhlIFJldmVhbGVyIHdpZGdldCBpbiBgc2V0dXBgIHNvIHRoZSB0b2dnbGUgY2FuXG4vLyAgICAgZGlyZWN0bHkgY29udHJvbCB0cmFuc2l0aW9uRHVyYXRpb24gcGVyIGRpcmVjdGlvblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VSZXZlYWwob3Blbk1zID0gMjIwLCBjbG9zZU1zID0gMTUwKSB7XG4gIGNvbnN0IHdpblZpc2libGUgPSBWYXJpYWJsZShmYWxzZSlcbiAgY29uc3QgcmV2ZWFsZWQgPSBWYXJpYWJsZShmYWxzZSlcbiAgbGV0IHJldmVhbGVyV2lkZ2V0OiBHdGsuUmV2ZWFsZXIgfCBudWxsID0gbnVsbFxuICBsZXQgY2xvc2VUaW1lcjogYW55ID0gbnVsbFxuXG4gIGNvbnN0IHNldFJldmVhbGVyID0gKHI6IEd0ay5SZXZlYWxlcikgPT4geyByZXZlYWxlcldpZGdldCA9IHIgfVxuXG4gIGNvbnN0IG9wZW4gPSAoKSA9PiB7XG4gICAgaWYgKGNsb3NlVGltZXIpIHsgY2xvc2VUaW1lci5jYW5jZWw/LigpOyBjbG9zZVRpbWVyID0gbnVsbCB9XG4gICAgaWYgKHJldmVhbGVyV2lkZ2V0KSByZXZlYWxlcldpZGdldC50cmFuc2l0aW9uRHVyYXRpb24gPSBvcGVuTXNcbiAgICB3aW5WaXNpYmxlLnNldCh0cnVlKVxuICAgIC8vIE9uZSBpZGxlIGZyYW1lIHNvIEdUSyBjYW4gcmVhbGl6ZSB0aGUgd2luZG93IGJlZm9yZSBhbmltYXRpbmdcbiAgICB0aW1lb3V0KDE2LCAoKSA9PiByZXZlYWxlZC5zZXQodHJ1ZSkpXG4gIH1cblxuICBjb25zdCBjbG9zZSA9ICgpID0+IHtcbiAgICBpZiAocmV2ZWFsZXJXaWRnZXQpIHJldmVhbGVyV2lkZ2V0LnRyYW5zaXRpb25EdXJhdGlvbiA9IGNsb3NlTXNcbiAgICByZXZlYWxlZC5zZXQoZmFsc2UpXG4gICAgY2xvc2VUaW1lciA9IHRpbWVvdXQoY2xvc2VNcyArIDIwLCAoKSA9PiB7XG4gICAgICB3aW5WaXNpYmxlLnNldChmYWxzZSlcbiAgICAgIGNsb3NlVGltZXIgPSBudWxsXG4gICAgfSlcbiAgfVxuXG4gIGNvbnN0IHRvZ2dsZUZuID0gKCkgPT4gKHJldmVhbGVkLmdldCgpID8gY2xvc2UoKSA6IG9wZW4oKSlcblxuICByZXR1cm4geyB3aW5WaXNpYmxlLCByZXZlYWxlZCwgc2V0UmV2ZWFsZXIsIG9wZW4sIGNsb3NlLCB0b2dnbGU6IHRvZ2dsZUZuIH1cbn1cbiIsICIvLyBUaGUgYmFyLiBQcm90b3R5cGU6IGxhdW5jaGVyIGJ1dHRvbiBcdTAwQjcgZm9jdXNlZCB0aXRsZSBcdTAwQjcgY2VudGVyZWQgY2xvY2sgKFx1MjE5MiBjYWxlbmRhcilcbi8vIFx1MDBCNyB0cmF5IFx1MDBCNyBzdGF0dXMgcGlsbCAod2lmaS92b2wvYmF0dGVyeTsgYW1iZXIgbmV0LWdseXBoIHdoZW4gZ25vYmxpbiBpcyBkb3duKVxuLy8gXHUwMEI3IGJlbGwrYmFkZ2UgKFx1MjE5MiBkcmF3ZXIpIFx1MDBCNyBwb3dlciAoXHUyMTkyIHNlc3Npb24pLlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuaW1wb3J0IE5ldHdvcmsgZnJvbSBcImdpOi8vQXN0YWxOZXR3b3JrXCJcbmltcG9ydCBUcmF5IGZyb20gXCJnaTovL0FzdGFsVHJheVwiXG5pbXBvcnQgeyBjb25uZWN0ZWQsIHdpbmRvd3MgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyB0b2dnbGUgYXMgc3VyZmFjZVRvZ2dsZSB9IGZyb20gXCIuLi9saWIvc3VyZmFjZVwiXG5pbXBvcnQgeyB1bnJlYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvbm90aWZkXCJcbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCB0aW1lID0gVmFyaWFibGUoR0xpYi5EYXRlVGltZS5uZXdfbm93X2xvY2FsKCkpLnBvbGwoMTBfMDAwLFxuICAoKSA9PiBHTGliLkRhdGVUaW1lLm5ld19ub3dfbG9jYWwoKSlcblxuZnVuY3Rpb24gRm9jdXNlZFRpdGxlKCkge1xuICByZXR1cm4gPGxhYmVsXG4gICAgY2xhc3M9XCJ0aXRsZVwiXG4gICAgZWxsaXBzaXplPXszIC8qIFBhbmdvLkVsbGlwc2l6ZU1vZGUuRU5EICovfVxuICAgIG1heFdpZHRoQ2hhcnM9ezI4fVxuICAgIGxhYmVsPXtERU1PID8gRC50aXRsZSA6IGJpbmQod2luZG93cykuYXMod3MgPT4ge1xuICAgICAgY29uc3QgZiA9IHdzLmZpbmQodyA9PiB3LmZvY3VzZWQpXG4gICAgICBpZiAoIWYpIHJldHVybiBcImRlc2t0b3BcIlxuICAgICAgY29uc3Qgc2libGluZ3MgPSB3cy5maWx0ZXIodyA9PiB3LmFwcElkID09PSBmLmFwcElkKVxuICAgICAgcmV0dXJuIHNpYmxpbmdzLmxlbmd0aCA+IDFcbiAgICAgICAgPyBgJHtmLnRpdGxlfSBcdTIwMTQgd2luZG93ICR7c2libGluZ3MuaW5kZXhPZihmKSArIDF9LyR7c2libGluZ3MubGVuZ3RofWBcbiAgICAgICAgOiBmLnRpdGxlXG4gICAgfSl9IC8+XG59XG5cbmZ1bmN0aW9uIFN0YXR1c1BpbGwoKSB7XG4gIGNvbnN0IHNwZWFrZXIgPSBXcC5nZXRfZGVmYXVsdCgpPy5kZWZhdWx0X3NwZWFrZXIgPz8gbnVsbFxuICBjb25zdCBuZXQgPSBOZXR3b3JrLmdldF9kZWZhdWx0KClcbiAgY29uc3QgYmF0ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpXG4gIC8vIFdpZmkgaWNvbjogdmFyaWVzIHdpdGggY29ubmVjdGlvbiBzdGF0ZSAvIHR5cGVcbiAgY29uc3Qgd2lmaUljb24gPSBuZXQud2lmaVxuICAgID8gYmluZChuZXQud2lmaSwgXCJlbmFibGVkXCIpLmFzKG9uID0+XG4gICAgICAgIG9uID8gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgOiBcImtvYmVsLXdpZmktb2ZmLXN5bWJvbGljXCIpXG4gICAgOiBcImtvYmVsLXdpZmktb2ZmLXN5bWJvbGljXCJcbiAgLy8gVm9sdW1lIGljb246IHRyYWNrIHRoZSBzcGVha2VyJ3Mgb3duIHZvbHVtZV9pY29uIHByb3BlcnR5XG4gIGNvbnN0IHZvbEljb24gPSBzcGVha2VyXG4gICAgPyBiaW5kKHNwZWFrZXIsIFwidm9sdW1lX2ljb25cIikuYXMoaSA9PiBpID8/IFwia29iZWwtc3BlYWtlci13YXZlLXN5bWJvbGljXCIpXG4gICAgOiBcImtvYmVsLXNwZWFrZXItbXV0ZS1zeW1ib2xpY1wiXG4gIHJldHVybiA8YnV0dG9uIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICBjbGFzcz17YmluZChjb25uZWN0ZWQpLmFzKGMgPT4gYyA/IFwic3RhdHVzXCIgOiBcInN0YXR1cyBlcnJcIil9XG4gICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwicXVpY2tzZXR0aW5nc1wiKX0+XG4gICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICA8aW1hZ2UgY2xhc3M9XCJuZXQtaWNvblwiIGljb25OYW1lPXt3aWZpSWNvbn0gLz5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17dm9sSWNvbn0gLz5cbiAgICAgIHsvKiBCYXR0ZXJ5OiBvbmx5IHJlbmRlcmVkIHdoZW4gYSBiYXR0ZXJ5IGlzIHByZXNlbnQgKi99XG4gICAgICB7KERFTU8gfHwgYmF0KSAmJiA8Ym94IGNsYXNzPVwicGN0XCIgc3BhY2luZz17Nn0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJhdHRlcnktc3ltYm9saWNcIiAvPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0blwiIGxhYmVsPXtERU1PID8gRC5iYXR0ZXJ5UGN0IDogKGJhdFxuICAgICAgICAgID8gYmluZChiYXQsIFwicGVyY2VudGFnZVwiKS5hcyhwID0+IGAke01hdGgucm91bmQocCAqIDEwMCl9JWApXG4gICAgICAgICAgOiBcIlwiKX0gLz5cbiAgICAgIDwvYm94Pn1cbiAgICA8L2JveD5cbiAgPC9idXR0b24+XG59XG5cbmZ1bmN0aW9uIEJlbGwoKSB7XG4gIC8vIEJhZGdlIGh5ZHJhdGVzIG9uY2Ugbm90aWZkIGlzIGF2YWlsYWJsZSAoZGVmZXJyZWQgXHUyMDE0IGdldF9kZWZhdWx0KCkgY2FuIGJsb2NrIG9uIGFcbiAgLy8gaGVhZGxlc3MvY29udGVuZGVkIGJ1czsgbmV2ZXIgY2FsbCBpdCBkdXJpbmcgY29uc3RydWN0aW9uKS4gdW5yZWFkKCkgaXMgYSBwbGFpblxuICAvLyBWYXJpYWJsZSBhbiBhc3luYyBpbml0IGZpbGxzIGluLlxuICByZXR1cm4gPGJ1dHRvbiBjbGFzcz1cImlidG4gYmVsbFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJkcmF3ZXJcIil9PlxuICAgIDxvdmVybGF5PlxuICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmVsbC1zeW1ib2xpY1wiIC8+XG4gICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBoYWxpZ249e0d0ay5BbGlnbi5FTkR9IHZhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICBjbGFzcz1cImJhZGdlIHRuXCIgdmlzaWJsZT17REVNTyA/IHRydWUgOiBiaW5kKHVucmVhZCkuYXMobiA9PiBuID4gMCl9XG4gICAgICAgIGxhYmVsPXtERU1PID8gXCIxXCIgOiBiaW5kKHVucmVhZCkuYXMobiA9PiBuID4gOSA/IFwiOStcIiA6IGAke259YCl9IC8+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gQmFyKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIGNvbnN0IHsgVE9QLCBMRUZULCBSSUdIVCB9ID0gQXN0YWwuV2luZG93QW5jaG9yXG4gIC8vIEZsb2F0aW5nIGJhcjogbGF5ZXItc2hlbGwgbWFyZ2lucyBpbnNldCBpdCBmcm9tIHRoZSBlZGdlczsgdGhlIC5iYXIgY2hpbGQgaXMgdGhlXG4gIC8vIHJvdW5kZWQgc3VyZmFjZS4gRXhjbHVzaXZlIHNvIHRpbGVkIHdpbmRvd3MgcmVzcGVjdCBpdCAoem9uZSA9IG1hcmdpbiArIGhlaWdodCkuXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImJhclwiIG5hbWVzcGFjZT1cImtvYmVsLWJhclwiIGNsYXNzPVwiYmFyLXdpbmRvd1wiXG4gICAgZ2RrbW9uaXRvcj17bW9uaXRvcn0gZXhjbHVzaXZpdHk9e0FzdGFsLkV4Y2x1c2l2aXR5LkVYQ0xVU0lWRX1cbiAgICBtYXJnaW5Ub3A9ezEwfSBtYXJnaW5MZWZ0PXsxMn0gbWFyZ2luUmlnaHQ9ezEyfVxuICAgIGFuY2hvcj17VE9QIHwgTEVGVCB8IFJJR0hUfT5cbiAgICA8Y2VudGVyYm94IGNsYXNzPVwiYmFyXCI+XG4gICAgICA8Ym94IHNwYWNpbmc9ezR9PlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0blwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJsYXVuY2hlclwiKX0+XG4gICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbWFnbmlmeWluZy1nbGFzcy1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8Rm9jdXNlZFRpdGxlIC8+XG4gICAgICA8L2JveD5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJiY2VudGVyXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHN1cmZhY2VUb2dnbGUoXCJjYWxlbmRhclwiKX0+XG4gICAgICAgIDxib3ggc3BhY2luZz17OH0+XG4gICAgICAgICAgPGxhYmVsIGNsYXNzPVwiY2xvY2sgdG5cIiB2YWxpZ249e0d0ay5BbGlnbi5CQVNFTElORX1cbiAgICAgICAgICAgIGxhYmVsPXtERU1PID8gRC5jbG9jayA6IGJpbmQodGltZSkuYXModCA9PiB0LmZvcm1hdChcIiVIOiVNXCIpISl9IC8+XG4gICAgICAgICAgPGxhYmVsIGNsYXNzPVwiZGF0ZVwiIHZhbGlnbj17R3RrLkFsaWduLkJBU0VMSU5FfVxuICAgICAgICAgICAgbGFiZWw9e0RFTU8gPyBELmRhdGUgOiBiaW5kKHRpbWUpLmFzKHQgPT4gdC5mb3JtYXQoXCIlYSAlLWQgJWJcIikhKX0gLz5cbiAgICAgICAgPC9ib3g+XG4gICAgICA8L2J1dHRvbj5cbiAgICAgIDxib3ggc3BhY2luZz17NH0+XG4gICAgICAgIHtERU1PXG4gICAgICAgICAgPyA8Ym94IHNwYWNpbmc9ezF9IG1hcmdpbkVuZD17M30+XG4gICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdG9vbHRpcFRleHQ9XCJEaXNjb3JkXCI+XG4gICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtY2hhdC1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuIHRyYXktaWNvblwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdG9vbHRpcFRleHQ9XCJTdGVhbVwiPlxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWdhbWUtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWJ0biB0cmF5LWljb25cIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHRvb2x0aXBUZXh0PVwiVGVsZWdyYW1cIj5cbiAgICAgICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wYXBlci1wbGFuZS1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInRuIHRyYXktbGFuZ1wiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gbGFiZWw9XCJlblwiIC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICA6IGJpbmQoVHJheS5nZXRfZGVmYXVsdCgpLCBcIml0ZW1zXCIpLmFzKGl0ZW1zID0+IGl0ZW1zLm1hcChpdGVtID0+XG4gICAgICAgICAgICAgIDxtZW51YnV0dG9uIHRvb2x0aXBUZXh0PXtpdGVtLnRvb2x0aXBfbWFya3VwfSBtZW51TW9kZWw9e2l0ZW0ubWVudV9tb2RlbH0+XG4gICAgICAgICAgICAgICAgPGltYWdlIGdpY29uPXtiaW5kKGl0ZW0sIFwiZ2ljb25cIil9IC8+XG4gICAgICAgICAgICAgIDwvbWVudWJ1dHRvbj4pKX1cbiAgICAgICAgPFN0YXR1c1BpbGwgLz5cbiAgICAgICAgPEJlbGwgLz5cbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImlidG5cIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKX0+XG4gICAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtcG93ZXItc3ltYm9saWNcIiAvPlxuICAgICAgICA8L2J1dHRvbj5cbiAgICAgIDwvYm94PlxuICAgIDwvY2VudGVyYm94PlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBEZW1vLWRhdGEgbW9kZSAoS09CRUxfREVNTz0xKTogbWFrZSBldmVyeSBzdXJmYWNlIHJlbmRlciB0aGUgRVhBQ1QgbW9jayB2YWx1ZXMgZnJvbVxuLy8gZG9jcy9wcm90b3R5cGUuaHRtbCwgc28gYW4gQUdTIHJlbmRlciBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXJcbi8vIGZvciBhIGZhaXIgMToxIGNvbXBhcmlzb24uIFRoaXMgaXMgTk9UIGNoZWF0aW5nIFx1MjAxNCByZWFsIEdUSyB3aWRnZXRzLCByZWFsIHJlbmRlcmluZztcbi8vIG9ubHkgdGhlICpjb250ZW50KiBpcyBwaW5uZWQgdG8gdGhlIHByb3RvdHlwZSdzIHNvIHRoZSBjaHJvbWUgY2FuIGJlIGRpZmZlZCBkaXJlY3RseS5cbmltcG9ydCBHTGliIGZyb20gXCJnaTovL0dMaWJcIlxuXG5leHBvcnQgY29uc3QgREVNTyA9ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9ERU1PXCIpXG5cbi8vIFZhbHVlcyB0cmFuc2NyaWJlZCBmcm9tIHByb3RvdHlwZS5odG1sJ3MgbW9jayBzdGF0ZSAodGhlIHJlZmVyZW5jZSBzY3JlZW5zaG90cykuXG5leHBvcnQgY29uc3QgRCA9IHtcbiAgLy8gYmFyXG4gIGNsb2NrOiBcIjE0OjIzXCIsXG4gIGRhdGU6IFwiU2F0IDQgSnVsXCIsXG4gIHRpdGxlOiBcIlRlcm1pbmFsIFx1MjAxNCB3aW5kb3cgMS8yXCIsXG4gIGJhdHRlcnlQY3Q6IFwiMTAwJVwiLFxuICAvLyBxdWljayBzZXR0aW5nc1xuICBtZXRhOiBcIjEwMCUgXHUwMEI3IEZ1bGx5IGNoYXJnZWRcIixcbiAgd2lmaVNzaWQ6IFwiY2hvbXBlcnMtNUdcIixcbiAgYnREZXZpY2U6IFwiV0gtMTAwMFhNNVwiLFxuICB2b2x1bWU6IDAuNjc1LCAgICAgLy8gdHJvdWdoIDUxLi4yODUgd2lkdGg9MjM0OyBrbm9iPSgyMDktNTEpLzIzND0wLjY3NSBcdTIxOTIgeFx1MjI0ODIwOSBtYXRjaGVzIHByb3RvXG4gIGJyaWdodG5lc3M6IDAuODAwLCAvLyBtZWFzdXJlZDogQUdTIHRyb3VnaCAycHggbmFycm93ZXIgdGhhbiBwcm90bzsgMC44MDAgYWxpZ25zIGtub2IgY2VudGVyXG4gIGRhcms6IHRydWUsIHNhdmU6IGZhbHNlLCBzaWxlbnQ6IGZhbHNlLCBuaWdodDogZmFsc2UsXG4gIC8vIGNhbGVuZGFyIFx1MjAxNCBwaW5uZWQgXCJ0b2RheVwiIHNvIHRoZSBncmlkICsgaGVybyBtYXRjaCB0aGUgcHJvdG90eXBlIGV4YWN0bHlcbiAgdG9kYXk6IHsgeTogMjAyNiwgbTogNiAvKiBKdWx5LCAwLWluZGV4ZWQgKi8sIGQ6IDQgfSwgIC8vIFNhdHVyZGF5IDQgSnVseSAyMDI2XG4gIC8vIGxhdW5jaGVyIHBpbm5lZCB0aWxlcyArIHRvZGF5IHdpZGdldFxuICBhcHBzOiBbXCJUZXJtaW5hbFwiLCBcIkZpbGVzXCIsIFwiRmlyZWZveFwiLCBcIlplZFwiLCBcIlNwb3RpZnlcIiwgXCJTZXR0aW5nc1wiXSxcbiAgd2lkZ2V0RGF0ZTogXCJTYXR1cmRheSA0IEp1bHlcIixcbiAgd2lkZ2V0RXZlbnQ6IFwiMDk6NDUgXHUwMEI3IERhaWx5IFN0YW5kdXBcIixcbiAgbWVkaWE6IHsgdGl0bGU6IFwiV2VpZ2h0bGVzc1wiLCBhcnRpc3Q6IFwiTWFyY29uaSBVbmlvblwiIH0sXG59XG4iLCAiLyogZXNsaW50LWRpc2FibGUgbWF4LWxlbiAqL1xuaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249My4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249My4wXCJcbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IGFzdGFsaWZ5LCB7IHR5cGUgQ29uc3RydWN0UHJvcHMsIHR5cGUgQmluZGFibGVDaGlsZCB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcblxuZnVuY3Rpb24gZmlsdGVyKGNoaWxkcmVuOiBhbnlbXSkge1xuICAgIHJldHVybiBjaGlsZHJlbi5mbGF0KEluZmluaXR5KS5tYXAoY2ggPT4gY2ggaW5zdGFuY2VvZiBHdGsuV2lkZ2V0XG4gICAgICAgID8gY2hcbiAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG59XG5cbi8vIEJveFxuT2JqZWN0LmRlZmluZVByb3BlcnR5KEFzdGFsLkJveC5wcm90b3R5cGUsIFwiY2hpbGRyZW5cIiwge1xuICAgIGdldCgpIHsgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkcmVuKCkgfSxcbiAgICBzZXQodikgeyB0aGlzLnNldF9jaGlsZHJlbih2KSB9LFxufSlcblxuZXhwb3J0IHR5cGUgQm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxCb3gsIEFzdGFsLkJveC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIEJveCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkJveCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJCb3hcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBCb3hQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQgeyB0aGlzLnNldF9jaGlsZHJlbihmaWx0ZXIoY2hpbGRyZW4pKSB9XG59XG5cbi8vIEJ1dHRvblxuZXhwb3J0IHR5cGUgQnV0dG9uUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxCdXR0b24sIEFzdGFsLkJ1dHRvbi5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25DbGlja2VkOiBbXVxuICAgIG9uQ2xpY2s6IFtldmVudDogQXN0YWwuQ2xpY2tFdmVudF1cbiAgICBvbkNsaWNrUmVsZWFzZTogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uSG92ZXI6IFtldmVudDogQXN0YWwuSG92ZXJFdmVudF1cbiAgICBvbkhvdmVyTG9zdDogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uU2Nyb2xsOiBbZXZlbnQ6IEFzdGFsLlNjcm9sbEV2ZW50XVxufT5cbmV4cG9ydCBjbGFzcyBCdXR0b24gZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5CdXR0b24pIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQnV0dG9uXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQnV0dG9uUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBDZW50ZXJCb3hcbmV4cG9ydCB0eXBlIENlbnRlckJveFByb3BzID0gQ29uc3RydWN0UHJvcHM8Q2VudGVyQm94LCBBc3RhbC5DZW50ZXJCb3guQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBDZW50ZXJCb3ggZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5DZW50ZXJCb3gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiQ2VudGVyQm94XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQ2VudGVyQm94UHJvcHMsIC4uLmNoaWxkcmVuOiBBcnJheTxCaW5kYWJsZUNoaWxkPikgeyBzdXBlcih7IGNoaWxkcmVuLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxuICAgIHByb3RlY3RlZCBzZXRDaGlsZHJlbihjaGlsZHJlbjogYW55W10pOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY2ggPSBmaWx0ZXIoY2hpbGRyZW4pXG4gICAgICAgIHRoaXMuc3RhcnRXaWRnZXQgPSBjaFswXSB8fCBuZXcgR3RrLkJveFxuICAgICAgICB0aGlzLmNlbnRlcldpZGdldCA9IGNoWzFdIHx8IG5ldyBHdGsuQm94XG4gICAgICAgIHRoaXMuZW5kV2lkZ2V0ID0gY2hbMl0gfHwgbmV3IEd0ay5Cb3hcbiAgICB9XG59XG5cbi8vIENpcmN1bGFyUHJvZ3Jlc3NcbmV4cG9ydCB0eXBlIENpcmN1bGFyUHJvZ3Jlc3NQcm9wcyA9IENvbnN0cnVjdFByb3BzPENpcmN1bGFyUHJvZ3Jlc3MsIEFzdGFsLkNpcmN1bGFyUHJvZ3Jlc3MuQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBDaXJjdWxhclByb2dyZXNzIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuQ2lyY3VsYXJQcm9ncmVzcykge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJDaXJjdWxhclByb2dyZXNzXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogQ2lyY3VsYXJQcm9ncmVzc1Byb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gRHJhd2luZ0FyZWFcbmV4cG9ydCB0eXBlIERyYXdpbmdBcmVhUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxEcmF3aW5nQXJlYSwgR3RrLkRyYXdpbmdBcmVhLkNvbnN0cnVjdG9yUHJvcHMsIHtcbiAgICBvbkRyYXc6IFtjcjogYW55XSAvLyBUT0RPOiBjYWlybyB0eXBlc1xufT5cbmV4cG9ydCBjbGFzcyBEcmF3aW5nQXJlYSBleHRlbmRzIGFzdGFsaWZ5KEd0ay5EcmF3aW5nQXJlYSkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJEcmF3aW5nQXJlYVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IERyYXdpbmdBcmVhUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIEVudHJ5XG5leHBvcnQgdHlwZSBFbnRyeVByb3BzID0gQ29uc3RydWN0UHJvcHM8RW50cnksIEd0ay5FbnRyeS5Db25zdHJ1Y3RvclByb3BzLCB7XG4gICAgb25DaGFuZ2VkOiBbXVxuICAgIG9uQWN0aXZhdGU6IFtdXG59PlxuZXhwb3J0IGNsYXNzIEVudHJ5IGV4dGVuZHMgYXN0YWxpZnkoR3RrLkVudHJ5KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkVudHJ5XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogRW50cnlQcm9wcykgeyBzdXBlcihwcm9wcyBhcyBhbnkpIH1cbn1cblxuLy8gRXZlbnRCb3hcbmV4cG9ydCB0eXBlIEV2ZW50Qm94UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxFdmVudEJveCwgQXN0YWwuRXZlbnRCb3guQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uQ2xpY2s6IFtldmVudDogQXN0YWwuQ2xpY2tFdmVudF1cbiAgICBvbkNsaWNrUmVsZWFzZTogW2V2ZW50OiBBc3RhbC5DbGlja0V2ZW50XVxuICAgIG9uSG92ZXI6IFtldmVudDogQXN0YWwuSG92ZXJFdmVudF1cbiAgICBvbkhvdmVyTG9zdDogW2V2ZW50OiBBc3RhbC5Ib3ZlckV2ZW50XVxuICAgIG9uU2Nyb2xsOiBbZXZlbnQ6IEFzdGFsLlNjcm9sbEV2ZW50XVxufT5cbmV4cG9ydCBjbGFzcyBFdmVudEJveCBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLkV2ZW50Qm94KSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkV2ZW50Qm94XCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogRXZlbnRCb3hQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIC8vIFRPRE86IEZpeGVkXG4vLyAvLyBUT0RPOiBGbG93Qm94XG4vL1xuLy8gSWNvblxuZXhwb3J0IHR5cGUgSWNvblByb3BzID0gQ29uc3RydWN0UHJvcHM8SWNvbiwgQXN0YWwuSWNvbi5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIEljb24gZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5JY29uKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIkljb25cIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBJY29uUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIExhYmVsXG5leHBvcnQgdHlwZSBMYWJlbFByb3BzID0gQ29uc3RydWN0UHJvcHM8TGFiZWwsIEFzdGFsLkxhYmVsLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgTGFiZWwgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5MYWJlbCkge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJMYWJlbFwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IExhYmVsUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQgeyB0aGlzLmxhYmVsID0gU3RyaW5nKGNoaWxkcmVuKSB9XG59XG5cbi8vIExldmVsQmFyXG5leHBvcnQgdHlwZSBMZXZlbEJhclByb3BzID0gQ29uc3RydWN0UHJvcHM8TGV2ZWxCYXIsIEFzdGFsLkxldmVsQmFyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgTGV2ZWxCYXIgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5MZXZlbEJhcikge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJMZXZlbEJhclwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IExldmVsQmFyUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIFRPRE86IExpc3RCb3hcblxuLy8gTWVudUJ1dHRvblxuZXhwb3J0IHR5cGUgTWVudUJ1dHRvblByb3BzID0gQ29uc3RydWN0UHJvcHM8TWVudUJ1dHRvbiwgR3RrLk1lbnVCdXR0b24uQ29uc3RydWN0b3JQcm9wcz5cbmV4cG9ydCBjbGFzcyBNZW51QnV0dG9uIGV4dGVuZHMgYXN0YWxpZnkoR3RrLk1lbnVCdXR0b24pIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiTWVudUJ1dHRvblwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IE1lbnVCdXR0b25Qcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG5cbi8vIE92ZXJsYXlcbk9iamVjdC5kZWZpbmVQcm9wZXJ0eShBc3RhbC5PdmVybGF5LnByb3RvdHlwZSwgXCJvdmVybGF5c1wiLCB7XG4gICAgZ2V0KCkgeyByZXR1cm4gdGhpcy5nZXRfb3ZlcmxheXMoKSB9LFxuICAgIHNldCh2KSB7IHRoaXMuc2V0X292ZXJsYXlzKHYpIH0sXG59KVxuXG5leHBvcnQgdHlwZSBPdmVybGF5UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxPdmVybGF5LCBBc3RhbC5PdmVybGF5LkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgT3ZlcmxheSBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLk92ZXJsYXkpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiT3ZlcmxheVwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IE92ZXJsYXlQcm9wcywgLi4uY2hpbGRyZW46IEFycmF5PEJpbmRhYmxlQ2hpbGQ+KSB7IHN1cGVyKHsgY2hpbGRyZW4sIC4uLnByb3BzIH0gYXMgYW55KSB9XG4gICAgcHJvdGVjdGVkIHNldENoaWxkcmVuKGNoaWxkcmVuOiBhbnlbXSk6IHZvaWQge1xuICAgICAgICBjb25zdCBbY2hpbGQsIC4uLm92ZXJsYXlzXSA9IGZpbHRlcihjaGlsZHJlbilcbiAgICAgICAgdGhpcy5zZXRfY2hpbGQoY2hpbGQpXG4gICAgICAgIHRoaXMuc2V0X292ZXJsYXlzKG92ZXJsYXlzKVxuICAgIH1cbn1cblxuLy8gUmV2ZWFsZXJcbmV4cG9ydCB0eXBlIFJldmVhbGVyUHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxSZXZlYWxlciwgR3RrLlJldmVhbGVyLkNvbnN0cnVjdG9yUHJvcHM+XG5leHBvcnQgY2xhc3MgUmV2ZWFsZXIgZXh0ZW5kcyBhc3RhbGlmeShHdGsuUmV2ZWFsZXIpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiUmV2ZWFsZXJcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBSZXZlYWxlclByb3BzLCBjaGlsZD86IEJpbmRhYmxlQ2hpbGQpIHsgc3VwZXIoeyBjaGlsZCwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbn1cblxuLy8gU2Nyb2xsYWJsZVxuZXhwb3J0IHR5cGUgU2Nyb2xsYWJsZVByb3BzID0gQ29uc3RydWN0UHJvcHM8U2Nyb2xsYWJsZSwgQXN0YWwuU2Nyb2xsYWJsZS5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFNjcm9sbGFibGUgZXh0ZW5kcyBhc3RhbGlmeShBc3RhbC5TY3JvbGxhYmxlKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlNjcm9sbGFibGVcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTY3JvbGxhYmxlUHJvcHMsIGNoaWxkPzogQmluZGFibGVDaGlsZCkgeyBzdXBlcih7IGNoaWxkLCAuLi5wcm9wcyB9IGFzIGFueSkgfVxufVxuXG4vLyBTbGlkZXJcbmV4cG9ydCB0eXBlIFNsaWRlclByb3BzID0gQ29uc3RydWN0UHJvcHM8U2xpZGVyLCBBc3RhbC5TbGlkZXIuQ29uc3RydWN0b3JQcm9wcywge1xuICAgIG9uRHJhZ2dlZDogW11cbn0+XG5leHBvcnQgY2xhc3MgU2xpZGVyIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuU2xpZGVyKSB7XG4gICAgc3RhdGljIHsgR09iamVjdC5yZWdpc3RlckNsYXNzKHsgR1R5cGVOYW1lOiBcIlNsaWRlclwiIH0sIHRoaXMpIH1cbiAgICBjb25zdHJ1Y3Rvcihwcm9wcz86IFNsaWRlclByb3BzKSB7IHN1cGVyKHByb3BzIGFzIGFueSkgfVxufVxuXG4vLyBTdGFja1xuZXhwb3J0IHR5cGUgU3RhY2tQcm9wcyA9IENvbnN0cnVjdFByb3BzPFN0YWNrLCBBc3RhbC5TdGFjay5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFN0YWNrIGV4dGVuZHMgYXN0YWxpZnkoQXN0YWwuU3RhY2spIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU3RhY2tcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBTdGFja1Byb3BzLCAuLi5jaGlsZHJlbjogQXJyYXk8QmluZGFibGVDaGlsZD4pIHsgc3VwZXIoeyBjaGlsZHJlbiwgLi4ucHJvcHMgfSBhcyBhbnkpIH1cbiAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKTogdm9pZCB7IHRoaXMuc2V0X2NoaWxkcmVuKGZpbHRlcihjaGlsZHJlbikpIH1cbn1cblxuLy8gU3dpdGNoXG5leHBvcnQgdHlwZSBTd2l0Y2hQcm9wcyA9IENvbnN0cnVjdFByb3BzPFN3aXRjaCwgR3RrLlN3aXRjaC5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFN3aXRjaCBleHRlbmRzIGFzdGFsaWZ5KEd0ay5Td2l0Y2gpIHtcbiAgICBzdGF0aWMgeyBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3MoeyBHVHlwZU5hbWU6IFwiU3dpdGNoXCIgfSwgdGhpcykgfVxuICAgIGNvbnN0cnVjdG9yKHByb3BzPzogU3dpdGNoUHJvcHMpIHsgc3VwZXIocHJvcHMgYXMgYW55KSB9XG59XG5cbi8vIFdpbmRvd1xuZXhwb3J0IHR5cGUgV2luZG93UHJvcHMgPSBDb25zdHJ1Y3RQcm9wczxXaW5kb3csIEFzdGFsLldpbmRvdy5Db25zdHJ1Y3RvclByb3BzPlxuZXhwb3J0IGNsYXNzIFdpbmRvdyBleHRlbmRzIGFzdGFsaWZ5KEFzdGFsLldpbmRvdykge1xuICAgIHN0YXRpYyB7IEdPYmplY3QucmVnaXN0ZXJDbGFzcyh7IEdUeXBlTmFtZTogXCJXaW5kb3dcIiB9LCB0aGlzKSB9XG4gICAgY29uc3RydWN0b3IocHJvcHM/OiBXaW5kb3dQcm9wcywgY2hpbGQ/OiBCaW5kYWJsZUNoaWxkKSB7IHN1cGVyKHsgY2hpbGQsIC4uLnByb3BzIH0gYXMgYW55KSB9XG59XG4iLCAiaW1wb3J0IHsgaG9vaywgbm9JbXBsaWNpdERlc3Ryb3ksIHNldENoaWxkcmVuLCBtZXJnZUJpbmRpbmdzLCB0eXBlIEJpbmRhYmxlUHJvcHMsIGNvbnN0cnVjdCB9IGZyb20gXCIuLi9fYXN0YWwuanNcIlxuaW1wb3J0IEFzdGFsIGZyb20gXCJnaTovL0FzdGFsP3ZlcnNpb249My4wXCJcbmltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249My4wXCJcbmltcG9ydCBHZGsgZnJvbSBcImdpOi8vR2RrP3ZlcnNpb249My4wXCJcbmltcG9ydCBHT2JqZWN0IGZyb20gXCJnaTovL0dPYmplY3RcIlxuaW1wb3J0IEdpbyBmcm9tIFwiZ2k6Ly9HaW8/dmVyc2lvbj0yLjBcIlxuaW1wb3J0IEJpbmRpbmcsIHsgdHlwZSBDb25uZWN0YWJsZSwgdHlwZSBTdWJzY3JpYmFibGUgfSBmcm9tIFwiLi4vYmluZGluZy5qc1wiXG5cbmV4cG9ydCB7IEJpbmRhYmxlUHJvcHMsIG1lcmdlQmluZGluZ3MgfVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBhc3RhbGlmeTxcbiAgICBDIGV4dGVuZHMgeyBuZXcoLi4uYXJnczogYW55W10pOiBHdGsuV2lkZ2V0IH0sXG4+KGNsczogQywgY2xzTmFtZSA9IGNscy5uYW1lKSB7XG4gICAgY2xhc3MgV2lkZ2V0IGV4dGVuZHMgY2xzIHtcbiAgICAgICAgZ2V0IGNzcygpOiBzdHJpbmcgeyByZXR1cm4gQXN0YWwud2lkZ2V0X2dldF9jc3ModGhpcykgfVxuICAgICAgICBzZXQgY3NzKGNzczogc3RyaW5nKSB7IEFzdGFsLndpZGdldF9zZXRfY3NzKHRoaXMsIGNzcykgfVxuICAgICAgICBnZXRfY3NzKCk6IHN0cmluZyB7IHJldHVybiB0aGlzLmNzcyB9XG4gICAgICAgIHNldF9jc3MoY3NzOiBzdHJpbmcpIHsgdGhpcy5jc3MgPSBjc3MgfVxuXG4gICAgICAgIGdldCBjbGFzc05hbWUoKTogc3RyaW5nIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY2xhc3NfbmFtZXModGhpcykuam9pbihcIiBcIikgfVxuICAgICAgICBzZXQgY2xhc3NOYW1lKGNsYXNzTmFtZTogc3RyaW5nKSB7IEFzdGFsLndpZGdldF9zZXRfY2xhc3NfbmFtZXModGhpcywgY2xhc3NOYW1lLnNwbGl0KC9cXHMrLykpIH1cbiAgICAgICAgZ2V0X2NsYXNzX25hbWUoKTogc3RyaW5nIHsgcmV0dXJuIHRoaXMuY2xhc3NOYW1lIH1cbiAgICAgICAgc2V0X2NsYXNzX25hbWUoY2xhc3NOYW1lOiBzdHJpbmcpIHsgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWUgfVxuXG4gICAgICAgIGdldCBjdXJzb3IoKTogQ3Vyc29yIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY3Vyc29yKHRoaXMpIGFzIEN1cnNvciB9XG4gICAgICAgIHNldCBjdXJzb3IoY3Vyc29yOiBDdXJzb3IpIHsgQXN0YWwud2lkZ2V0X3NldF9jdXJzb3IodGhpcywgY3Vyc29yKSB9XG4gICAgICAgIGdldF9jdXJzb3IoKTogQ3Vyc29yIHsgcmV0dXJuIHRoaXMuY3Vyc29yIH1cbiAgICAgICAgc2V0X2N1cnNvcihjdXJzb3I6IEN1cnNvcikgeyB0aGlzLmN1cnNvciA9IGN1cnNvciB9XG5cbiAgICAgICAgZ2V0IGNsaWNrVGhyb3VnaCgpOiBib29sZWFuIHsgcmV0dXJuIEFzdGFsLndpZGdldF9nZXRfY2xpY2tfdGhyb3VnaCh0aGlzKSB9XG4gICAgICAgIHNldCBjbGlja1Rocm91Z2goY2xpY2tUaHJvdWdoOiBib29sZWFuKSB7IEFzdGFsLndpZGdldF9zZXRfY2xpY2tfdGhyb3VnaCh0aGlzLCBjbGlja1Rocm91Z2gpIH1cbiAgICAgICAgZ2V0X2NsaWNrX3Rocm91Z2goKTogYm9vbGVhbiB7IHJldHVybiB0aGlzLmNsaWNrVGhyb3VnaCB9XG4gICAgICAgIHNldF9jbGlja190aHJvdWdoKGNsaWNrVGhyb3VnaDogYm9vbGVhbikgeyB0aGlzLmNsaWNrVGhyb3VnaCA9IGNsaWNrVGhyb3VnaCB9XG5cbiAgICAgICAgZGVjbGFyZSBwcml2YXRlIFtub0ltcGxpY2l0RGVzdHJveV06IGJvb2xlYW5cbiAgICAgICAgZ2V0IG5vSW1wbGljaXREZXN0cm95KCk6IGJvb2xlYW4geyByZXR1cm4gdGhpc1tub0ltcGxpY2l0RGVzdHJveV0gfVxuICAgICAgICBzZXQgbm9JbXBsaWNpdERlc3Ryb3kodmFsdWU6IGJvb2xlYW4pIHsgdGhpc1tub0ltcGxpY2l0RGVzdHJveV0gPSB2YWx1ZSB9XG5cbiAgICAgICAgc2V0IGFjdGlvbkdyb3VwKFtwcmVmaXgsIGdyb3VwXTogQWN0aW9uR3JvdXApIHsgdGhpcy5pbnNlcnRfYWN0aW9uX2dyb3VwKHByZWZpeCwgZ3JvdXApIH1cbiAgICAgICAgc2V0X2FjdGlvbl9ncm91cChhY3Rpb25Hcm91cDogQWN0aW9uR3JvdXApIHsgdGhpcy5hY3Rpb25Hcm91cCA9IGFjdGlvbkdyb3VwIH1cblxuICAgICAgICBwcm90ZWN0ZWQgZ2V0Q2hpbGRyZW4oKTogQXJyYXk8R3RrLldpZGdldD4ge1xuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBHdGsuQmluKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZ2V0X2NoaWxkKCkgPyBbdGhpcy5nZXRfY2hpbGQoKSFdIDogW11cbiAgICAgICAgICAgIH0gZWxzZSBpZiAodGhpcyBpbnN0YW5jZW9mIEd0ay5Db250YWluZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRfY2hpbGRyZW4oKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIFtdXG4gICAgICAgIH1cblxuICAgICAgICBwcm90ZWN0ZWQgc2V0Q2hpbGRyZW4oY2hpbGRyZW46IGFueVtdKSB7XG4gICAgICAgICAgICBjaGlsZHJlbiA9IGNoaWxkcmVuLmZsYXQoSW5maW5pdHkpLm1hcChjaCA9PiBjaCBpbnN0YW5jZW9mIEd0ay5XaWRnZXRcbiAgICAgICAgICAgICAgICA/IGNoXG4gICAgICAgICAgICAgICAgOiBuZXcgR3RrLkxhYmVsKHsgdmlzaWJsZTogdHJ1ZSwgbGFiZWw6IFN0cmluZyhjaCkgfSkpXG5cbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkNvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY2ggb2YgY2hpbGRyZW4pXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuYWRkKGNoKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBFcnJvcihgY2FuIG5vdCBhZGQgY2hpbGRyZW4gdG8gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIFtzZXRDaGlsZHJlbl0oY2hpbGRyZW46IGFueVtdKSB7XG4gICAgICAgICAgICAvLyByZW1vdmVcbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgR3RrLkNvbnRhaW5lcikge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY2ggb2YgdGhpcy5nZXRDaGlsZHJlbigpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMucmVtb3ZlKGNoKVxuICAgICAgICAgICAgICAgICAgICBpZiAoIWNoaWxkcmVuLmluY2x1ZGVzKGNoKSAmJiAhdGhpcy5ub0ltcGxpY2l0RGVzdHJveSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGNoPy5kZXN0cm95KClcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIGFwcGVuZFxuICAgICAgICAgICAgdGhpcy5zZXRDaGlsZHJlbihjaGlsZHJlbilcbiAgICAgICAgfVxuXG4gICAgICAgIHRvZ2dsZUNsYXNzTmFtZShjbjogc3RyaW5nLCBjb25kID0gdHJ1ZSkge1xuICAgICAgICAgICAgQXN0YWwud2lkZ2V0X3RvZ2dsZV9jbGFzc19uYW1lKHRoaXMsIGNuLCBjb25kKVxuICAgICAgICB9XG5cbiAgICAgICAgaG9vayhcbiAgICAgICAgICAgIG9iamVjdDogQ29ubmVjdGFibGUsXG4gICAgICAgICAgICBzaWduYWw6IHN0cmluZyxcbiAgICAgICAgICAgIGNhbGxiYWNrOiAoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4gICAgICAgICk6IHRoaXNcbiAgICAgICAgaG9vayhcbiAgICAgICAgICAgIG9iamVjdDogU3Vic2NyaWJhYmxlLFxuICAgICAgICAgICAgY2FsbGJhY2s6IChzZWxmOiB0aGlzLCAuLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgICAgICAgKTogdGhpc1xuICAgICAgICBob29rKFxuICAgICAgICAgICAgb2JqZWN0OiBDb25uZWN0YWJsZSB8IFN1YnNjcmliYWJsZSxcbiAgICAgICAgICAgIHNpZ25hbE9yQ2FsbGJhY2s6IHN0cmluZyB8ICgoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQpLFxuICAgICAgICAgICAgY2FsbGJhY2s/OiAoc2VsZjogdGhpcywgLi4uYXJnczogYW55W10pID0+IHZvaWQsXG4gICAgICAgICkge1xuICAgICAgICAgICAgaG9vayh0aGlzLCBvYmplY3QsIHNpZ25hbE9yQ2FsbGJhY2ssIGNhbGxiYWNrKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXNcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0cnVjdG9yKC4uLnBhcmFtczogYW55W10pIHtcbiAgICAgICAgICAgIHN1cGVyKClcbiAgICAgICAgICAgIGNvbnN0IHByb3BzID0gcGFyYW1zWzBdIHx8IHt9XG4gICAgICAgICAgICBwcm9wcy52aXNpYmxlID8/PSB0cnVlXG4gICAgICAgICAgICBjb25zdHJ1Y3QodGhpcywgcHJvcHMpXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBHT2JqZWN0LnJlZ2lzdGVyQ2xhc3Moe1xuICAgICAgICBHVHlwZU5hbWU6IGBBc3RhbF8ke2Nsc05hbWV9YCxcbiAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgXCJjbGFzcy1uYW1lXCI6IEdPYmplY3QuUGFyYW1TcGVjLnN0cmluZyhcbiAgICAgICAgICAgICAgICBcImNsYXNzLW5hbWVcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgXCJcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcImNzc1wiOiBHT2JqZWN0LlBhcmFtU3BlYy5zdHJpbmcoXG4gICAgICAgICAgICAgICAgXCJjc3NcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgXCJcIixcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICBcImN1cnNvclwiOiBHT2JqZWN0LlBhcmFtU3BlYy5zdHJpbmcoXG4gICAgICAgICAgICAgICAgXCJjdXJzb3JcIiwgXCJcIiwgXCJcIiwgR09iamVjdC5QYXJhbUZsYWdzLlJFQURXUklURSwgXCJkZWZhdWx0XCIsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICAgXCJjbGljay10aHJvdWdoXCI6IEdPYmplY3QuUGFyYW1TcGVjLmJvb2xlYW4oXG4gICAgICAgICAgICAgICAgXCJjbGljay10aHJvdWdoXCIsIFwiXCIsIFwiXCIsIEdPYmplY3QuUGFyYW1GbGFncy5SRUFEV1JJVEUsIGZhbHNlLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIFwibm8taW1wbGljaXQtZGVzdHJveVwiOiBHT2JqZWN0LlBhcmFtU3BlYy5ib29sZWFuKFxuICAgICAgICAgICAgICAgIFwibm8taW1wbGljaXQtZGVzdHJveVwiLCBcIlwiLCBcIlwiLCBHT2JqZWN0LlBhcmFtRmxhZ3MuUkVBRFdSSVRFLCBmYWxzZSxcbiAgICAgICAgICAgICksXG4gICAgICAgIH0sXG4gICAgfSwgV2lkZ2V0KVxuXG4gICAgcmV0dXJuIFdpZGdldFxufVxuXG50eXBlIFNpZ0hhbmRsZXI8XG4gICAgVyBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgQXJncyBleHRlbmRzIEFycmF5PHVua25vd24+LFxuPiA9ICgoc2VsZjogVywgLi4uYXJnczogQXJncykgPT4gdW5rbm93bikgfCBzdHJpbmcgfCBzdHJpbmdbXVxuXG5leHBvcnQgdHlwZSBCaW5kYWJsZUNoaWxkID0gR3RrLldpZGdldCB8IEJpbmRpbmc8R3RrLldpZGdldD5cblxuZXhwb3J0IHR5cGUgQ29uc3RydWN0UHJvcHM8XG4gICAgU2VsZiBleHRlbmRzIEluc3RhbmNlVHlwZTx0eXBlb2YgR3RrLldpZGdldD4sXG4gICAgUHJvcHMgZXh0ZW5kcyBHdGsuV2lkZ2V0LkNvbnN0cnVjdG9yUHJvcHMsXG4gICAgU2lnbmFscyBleHRlbmRzIFJlY29yZDxgb24ke3N0cmluZ31gLCBBcnJheTx1bmtub3duPj4gPSBSZWNvcmQ8YG9uJHtzdHJpbmd9YCwgYW55W10+LFxuPiA9IFBhcnRpYWw8e1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY2FuJ3QgYXNzaWduIHRvIHVua25vd24sIGJ1dCBpdCB3b3JrcyBhcyBleHBlY3RlZCB0aG91Z2hcbiAgICBbUyBpbiBrZXlvZiBTaWduYWxzXTogU2lnSGFuZGxlcjxTZWxmLCBTaWduYWxzW1NdPlxufT4gJiBQYXJ0aWFsPHtcbiAgICBbS2V5IGluIGBvbiR7c3RyaW5nfWBdOiBTaWdIYW5kbGVyPFNlbGYsIGFueVtdPlxufT4gJiBCaW5kYWJsZVByb3BzPFBhcnRpYWw8UHJvcHMgJiB7XG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICAgY3NzPzogc3RyaW5nXG4gICAgY3Vyc29yPzogc3RyaW5nXG4gICAgY2xpY2tUaHJvdWdoPzogYm9vbGVhblxuICAgIGFjdGlvbkdyb3VwPzogQWN0aW9uR3JvdXBcbn0+PiAmIFBhcnRpYWw8e1xuICAgIG9uRGVzdHJveTogKHNlbGY6IFNlbGYpID0+IHVua25vd25cbiAgICBvbkRyYXc6IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgb25LZXlQcmVzc0V2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uS2V5UmVsZWFzZUV2ZW50OiAoc2VsZjogU2VsZiwgZXZlbnQ6IEdkay5FdmVudCkgPT4gdW5rbm93blxuICAgIG9uQnV0dG9uUHJlc3NFdmVudDogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHVua25vd25cbiAgICBvbkJ1dHRvblJlbGVhc2VFdmVudDogKHNlbGY6IFNlbGYsIGV2ZW50OiBHZGsuRXZlbnQpID0+IHVua25vd25cbiAgICBvblJlYWxpemU6IChzZWxmOiBTZWxmKSA9PiB1bmtub3duXG4gICAgc2V0dXA6IChzZWxmOiBTZWxmKSA9PiB2b2lkXG59PlxuXG50eXBlIEN1cnNvciA9XG4gICAgfCBcImRlZmF1bHRcIlxuICAgIHwgXCJoZWxwXCJcbiAgICB8IFwicG9pbnRlclwiXG4gICAgfCBcImNvbnRleHQtbWVudVwiXG4gICAgfCBcInByb2dyZXNzXCJcbiAgICB8IFwid2FpdFwiXG4gICAgfCBcImNlbGxcIlxuICAgIHwgXCJjcm9zc2hhaXJcIlxuICAgIHwgXCJ0ZXh0XCJcbiAgICB8IFwidmVydGljYWwtdGV4dFwiXG4gICAgfCBcImFsaWFzXCJcbiAgICB8IFwiY29weVwiXG4gICAgfCBcIm5vLWRyb3BcIlxuICAgIHwgXCJtb3ZlXCJcbiAgICB8IFwibm90LWFsbG93ZWRcIlxuICAgIHwgXCJncmFiXCJcbiAgICB8IFwiZ3JhYmJpbmdcIlxuICAgIHwgXCJhbGwtc2Nyb2xsXCJcbiAgICB8IFwiY29sLXJlc2l6ZVwiXG4gICAgfCBcInJvdy1yZXNpemVcIlxuICAgIHwgXCJuLXJlc2l6ZVwiXG4gICAgfCBcImUtcmVzaXplXCJcbiAgICB8IFwicy1yZXNpemVcIlxuICAgIHwgXCJ3LXJlc2l6ZVwiXG4gICAgfCBcIm5lLXJlc2l6ZVwiXG4gICAgfCBcIm53LXJlc2l6ZVwiXG4gICAgfCBcInN3LXJlc2l6ZVwiXG4gICAgfCBcInNlLXJlc2l6ZVwiXG4gICAgfCBcImV3LXJlc2l6ZVwiXG4gICAgfCBcIm5zLXJlc2l6ZVwiXG4gICAgfCBcIm5lc3ctcmVzaXplXCJcbiAgICB8IFwibndzZS1yZXNpemVcIlxuICAgIHwgXCJ6b29tLWluXCJcbiAgICB8IFwiem9vbS1vdXRcIlxuXG50eXBlIEFjdGlvbkdyb3VwID0gW3ByZWZpeDogc3RyaW5nLCBhY3Rpb25Hcm91cDogR2lvLkFjdGlvbkdyb3VwXVxuIiwgImltcG9ydCBHdGsgZnJvbSBcImdpOi8vR3RrP3ZlcnNpb249My4wXCJcbmltcG9ydCB7IHR5cGUgQmluZGFibGVDaGlsZCB9IGZyb20gXCIuL2FzdGFsaWZ5LmpzXCJcbmltcG9ydCB7IG1lcmdlQmluZGluZ3MsIGpzeCBhcyBfanN4IH0gZnJvbSBcIi4uL19hc3RhbC5qc1wiXG5pbXBvcnQgKiBhcyBXaWRnZXQgZnJvbSBcIi4vd2lkZ2V0LmpzXCJcblxuZXhwb3J0IGZ1bmN0aW9uIEZyYWdtZW50KHsgY2hpbGRyZW4gPSBbXSwgY2hpbGQgfToge1xuICAgIGNoaWxkPzogQmluZGFibGVDaGlsZFxuICAgIGNoaWxkcmVuPzogQXJyYXk8QmluZGFibGVDaGlsZD5cbn0pIHtcbiAgICBpZiAoY2hpbGQpIGNoaWxkcmVuLnB1c2goY2hpbGQpXG4gICAgcmV0dXJuIG1lcmdlQmluZGluZ3MoY2hpbGRyZW4pXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBqc3goXG4gICAgY3Rvcjoga2V5b2YgdHlwZW9mIGN0b3JzIHwgdHlwZW9mIEd0ay5XaWRnZXQsXG4gICAgcHJvcHM6IGFueSxcbikge1xuICAgIHJldHVybiBfanN4KGN0b3JzLCBjdG9yIGFzIGFueSwgcHJvcHMpXG59XG5cbmNvbnN0IGN0b3JzID0ge1xuICAgIGJveDogV2lkZ2V0LkJveCxcbiAgICBidXR0b246IFdpZGdldC5CdXR0b24sXG4gICAgY2VudGVyYm94OiBXaWRnZXQuQ2VudGVyQm94LFxuICAgIGNpcmN1bGFycHJvZ3Jlc3M6IFdpZGdldC5DaXJjdWxhclByb2dyZXNzLFxuICAgIGRyYXdpbmdhcmVhOiBXaWRnZXQuRHJhd2luZ0FyZWEsXG4gICAgZW50cnk6IFdpZGdldC5FbnRyeSxcbiAgICBldmVudGJveDogV2lkZ2V0LkV2ZW50Qm94LFxuICAgIC8vIFRPRE86IGZpeGVkXG4gICAgLy8gVE9ETzogZmxvd2JveFxuICAgIGljb246IFdpZGdldC5JY29uLFxuICAgIGxhYmVsOiBXaWRnZXQuTGFiZWwsXG4gICAgbGV2ZWxiYXI6IFdpZGdldC5MZXZlbEJhcixcbiAgICAvLyBUT0RPOiBsaXN0Ym94XG4gICAgbWVudWJ1dHRvbjogV2lkZ2V0Lk1lbnVCdXR0b24sXG4gICAgb3ZlcmxheTogV2lkZ2V0Lk92ZXJsYXksXG4gICAgcmV2ZWFsZXI6IFdpZGdldC5SZXZlYWxlcixcbiAgICBzY3JvbGxhYmxlOiBXaWRnZXQuU2Nyb2xsYWJsZSxcbiAgICBzbGlkZXI6IFdpZGdldC5TbGlkZXIsXG4gICAgc3RhY2s6IFdpZGdldC5TdGFjayxcbiAgICBzd2l0Y2g6IFdpZGdldC5Td2l0Y2gsXG4gICAgd2luZG93OiBXaWRnZXQuV2luZG93LFxufVxuXG5kZWNsYXJlIGdsb2JhbCB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1uYW1lc3BhY2VcbiAgICBuYW1lc3BhY2UgSlNYIHtcbiAgICAgICAgdHlwZSBFbGVtZW50ID0gR3RrLldpZGdldFxuICAgICAgICB0eXBlIEVsZW1lbnRDbGFzcyA9IEd0ay5XaWRnZXRcbiAgICAgICAgaW50ZXJmYWNlIEludHJpbnNpY0VsZW1lbnRzIHtcbiAgICAgICAgICAgIGJveDogV2lkZ2V0LkJveFByb3BzXG4gICAgICAgICAgICBidXR0b246IFdpZGdldC5CdXR0b25Qcm9wc1xuICAgICAgICAgICAgY2VudGVyYm94OiBXaWRnZXQuQ2VudGVyQm94UHJvcHNcbiAgICAgICAgICAgIGNpcmN1bGFycHJvZ3Jlc3M6IFdpZGdldC5DaXJjdWxhclByb2dyZXNzUHJvcHNcbiAgICAgICAgICAgIGRyYXdpbmdhcmVhOiBXaWRnZXQuRHJhd2luZ0FyZWFQcm9wc1xuICAgICAgICAgICAgZW50cnk6IFdpZGdldC5FbnRyeVByb3BzXG4gICAgICAgICAgICBldmVudGJveDogV2lkZ2V0LkV2ZW50Qm94UHJvcHNcbiAgICAgICAgICAgIC8vIFRPRE86IGZpeGVkXG4gICAgICAgICAgICAvLyBUT0RPOiBmbG93Ym94XG4gICAgICAgICAgICBpY29uOiBXaWRnZXQuSWNvblByb3BzXG4gICAgICAgICAgICBsYWJlbDogV2lkZ2V0LkxhYmVsUHJvcHNcbiAgICAgICAgICAgIGxldmVsYmFyOiBXaWRnZXQuTGV2ZWxCYXJQcm9wc1xuICAgICAgICAgICAgLy8gVE9ETzogbGlzdGJveFxuICAgICAgICAgICAgbWVudWJ1dHRvbjogV2lkZ2V0Lk1lbnVCdXR0b25Qcm9wc1xuICAgICAgICAgICAgb3ZlcmxheTogV2lkZ2V0Lk92ZXJsYXlQcm9wc1xuICAgICAgICAgICAgcmV2ZWFsZXI6IFdpZGdldC5SZXZlYWxlclByb3BzXG4gICAgICAgICAgICBzY3JvbGxhYmxlOiBXaWRnZXQuU2Nyb2xsYWJsZVByb3BzXG4gICAgICAgICAgICBzbGlkZXI6IFdpZGdldC5TbGlkZXJQcm9wc1xuICAgICAgICAgICAgc3RhY2s6IFdpZGdldC5TdGFja1Byb3BzXG4gICAgICAgICAgICBzd2l0Y2g6IFdpZGdldC5Td2l0Y2hQcm9wc1xuICAgICAgICAgICAgd2luZG93OiBXaWRnZXQuV2luZG93UHJvcHNcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZXhwb3J0IGNvbnN0IGpzeHMgPSBqc3hcbiIsICIvLyBUaGUgZG9jay4gQmVoYXZpb3IgbW9kZWwgKHByb3RvdHlwZS1maW5hbCk6XG4vLyAgIGNsaWNrICBcdTIwMTQgbm8gd2luZG93czogbGF1bmNoIChnaG9zdCB6b29tKSBcdTAwQjcgdW5mb2N1c2VkOiBmb2N1cyB0b3Agd2luZG93IChwdWxzZSlcbi8vICAgICAgICAgICAgZm9jdXNlZCArIG11bHRpOiBjeWNsZSBcdTAwQjcgZm9jdXNlZCArIHNpbmdsZTogbWluaW1pemVcbi8vICAgc2Nyb2xsIFx1MjAxNCBzaW5nbGU6IGZvY3VzIFx1MDBCNyBtdWx0aTogY3ljbGUgKGNhcm91c2VsIG51ZGdlLCBzdGFuZGFyZCBkaXJlY3Rpb24pXG4vLyAgIG1pZGRsZS1jbGljayBcdTIwMTQgbmV3IHdpbmRvdyBcdTAwQjcgcmlnaHQtY2xpY2sgXHUyMDE0IGNvbnRleHQgbWVudSAod2luZG93cyBsaXN0ICsgUXVpdClcbi8vIERPVFM6IGFic29sdXRlIG92ZXJsYXkgKEd0ay5PdmVybGF5KSwgc2xpZGluZyA0LWRvdCB2aWV3cG9ydCwgZWRnZSBtaW5pcyBwYXN0IDQsXG4vLyBkeWluZy1kb3QgY2xvc2UgYW5pbWF0aW9uLiBJY29ucyBvd24gQUxMIGdlb21ldHJ5LlxuaW1wb3J0IHsgQXBwLCBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBiaW5kLCBWYXJpYWJsZSwgZXhlY0FzeW5jIH0gZnJvbSBcImFzdGFsXCJcbmltcG9ydCBBcHBzIGZyb20gXCJnaTovL0FzdGFsQXBwc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgeyBNT1RJT04sIHNwcmluZywgc3ByaW5nVG8gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgKiBhcyBnbm9ibGluIGZyb20gXCIuLi9zZXJ2aWNlcy9nbm9ibGluXCJcbmltcG9ydCB7IERFTU8gfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxuXG5jb25zdCBQSU5ORUQgPSBbXG4gIFwib3JnLmdub21lLlB0eXhpc1wiLCBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiLCBcImZpcmVmb3hcIixcbiAgXCJkZXYuemVkLlplZFwiLCBcImNvbS5zcG90aWZ5LkNsaWVudFwiLCBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiLFxuXVxuXG5mdW5jdGlvbiBEb3RzKHsgYXBwSWQgfTogeyBhcHBJZDogc3RyaW5nIH0pIHtcbiAgLy8gU2xpZGluZyB2aWV3cG9ydCBpZGVudGljYWwgdG8gdGhlIHByb3RvdHlwZTogXHUyMjY0NCBkb3RzLCBmb2N1c2VkIHBpbGwsXG4gIC8vIG1pbmlzIHdoZW4gd2luZG93cyBleGlzdCBiZXlvbmQgdGhlIHZpc2libGUgc2xpY2UuXG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZG90c1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfSBzcGFjaW5nPXszfT5cbiAgICB7YmluZChnbm9ibGluLndpbmRvd3MpLmFzKCgpID0+IHtcbiAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgY29uc3QgdG90YWwgPSB3cy5sZW5ndGhcbiAgICAgIGNvbnN0IG4gPSBNYXRoLm1pbih0b3RhbCwgNClcbiAgICAgIGNvbnN0IGN1ciA9IHdzLmZpbmRJbmRleCh3ID0+IHcuZm9jdXNlZClcbiAgICAgIGxldCBzdGFydCA9IDBcbiAgICAgIGlmICh0b3RhbCA+IDQpIHN0YXJ0ID0gTWF0aC5taW4oTWF0aC5tYXgoKGN1ciA8IDAgPyAwIDogY3VyKSAtIDEsIDApLCB0b3RhbCAtIDQpXG4gICAgICByZXR1cm4gQXJyYXkuZnJvbSh7IGxlbmd0aDogbiB9LCAoXywgaSkgPT4ge1xuICAgICAgICBjb25zdCBpZHggPSBzdGFydCArIGlcbiAgICAgICAgY29uc3QgY2xzID0gW1wiZG90XCJdXG4gICAgICAgIGlmIChjdXIgPj0gMCAmJiBpZHggPT09IGN1cikgY2xzLnB1c2goXCJvblwiKVxuICAgICAgICBpZiAodG90YWwgPiA0ICYmICgoaSA9PT0gMCAmJiBzdGFydCA+IDApIHx8IChpID09PSBuIC0gMSAmJiBzdGFydCArIDQgPCB0b3RhbCkpKVxuICAgICAgICAgIGNscy5wdXNoKFwibWluaVwiKVxuICAgICAgICByZXR1cm4gPGJveCBjbGFzcz17Y2xzLmpvaW4oXCIgXCIpfSAvPlxuICAgICAgfSlcbiAgICB9KX1cbiAgPC9ib3g+XG59XG5cbmZ1bmN0aW9uIERvY2tCdXR0b24oeyBhcHAgfTogeyBhcHA6IEFwcHMuQXBwbGljYXRpb24gfSkge1xuICBjb25zdCBhcHBJZCA9IGFwcC5lbnRyeS5yZXBsYWNlKC9cXC5kZXNrdG9wJC8sIFwiXCIpXG5cbiAgY29uc3Qgb25DbGljayA9ICgpID0+IHtcbiAgICBjb25zdCB3cyA9IGdub2JsaW4uYXBwV2luZG93cyhhcHBJZClcbiAgICBpZiAoIXdzLmxlbmd0aCkgcmV0dXJuIHZvaWQgYXBwLmxhdW5jaCgpICAgICAgICAgIC8vICsgZ2hvc3Qgem9vbSAocmV2ZWFsZXIgc2NhbGUgYW5pbSlcbiAgICBjb25zdCBmb2N1c2VkID0gd3MuZmluZCh3ID0+IHcuZm9jdXNlZClcbiAgICBpZiAoIWZvY3VzZWQpIHJldHVybiB2b2lkIGdub2JsaW4uYWN0aXZhdGUoXG4gICAgICB3cy5zbGljZSgpLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmZvY3VzZWQpIC0gTnVtYmVyKGEuZm9jdXNlZCkpWzBdLmlkKVxuICAgIGlmICh3cy5sZW5ndGggPiAxKSByZXR1cm4gdm9pZCBnbm9ibGluLmN5Y2xlKGFwcElkLCAxKVxuICAgIGdub2JsaW4ubWluaW1pemUoZm9jdXNlZC5pZClcbiAgfVxuXG4gIHJldHVybiA8YnV0dG9uXG4gICAgY2xhc3M9XCJkYnRuXCIgdG9vbHRpcFRleHQ9e2FwcC5uYW1lfVxuICAgIG9uQ2xpY2tlZD17b25DbGlja31cbiAgICBvbkJ1dHRvblByZXNzZWQ9eyhfdywgZSkgPT4geyAgICAgICAgICAgLy8gbWlkZGxlLWNsaWNrIFx1MjE5MiBuZXcgd2luZG93XG4gICAgICBpZiAoZS5nZXRfYnV0dG9uKCkgPT09IEdkay5CVVRUT05fTUlERExFKSBhcHAubGF1bmNoKClcbiAgICB9fVxuICAgIG9uU2Nyb2xsPXsoX3csIF9keCwgZHkpID0+IHtcbiAgICAgIGNvbnN0IHdzID0gZ25vYmxpbi5hcHBXaW5kb3dzKGFwcElkKVxuICAgICAgaWYgKCF3cy5sZW5ndGgpIHJldHVyblxuICAgICAgaWYgKHdzLmxlbmd0aCA+IDEpIGdub2JsaW4uY3ljbGUoYXBwSWQsIGR5ID4gMCA/IDEgOiAtMSlcbiAgICAgIGVsc2UgaWYgKCF3c1swXS5mb2N1c2VkKSBnbm9ibGluLmFjdGl2YXRlKHdzWzBdLmlkKVxuICAgIH19PlxuICAgIDxvdmVybGF5PlxuICAgICAgPGltYWdlIGNsYXNzPVwiaWNvbi10aWxlXCIgaWNvbk5hbWU9e2FwcC5pY29uX25hbWUgfHwgXCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGVcIn1cbiAgICAgICAgICAgICBwaXhlbFNpemU9ezMwfSAvPlxuICAgICAgey8qIGRvdHMgYXMgT1ZFUkxBWSBcdTIwMTQgemVybyBsYXlvdXQgZm9vdHByaW50ICovfVxuICAgICAgPERvdHMgdHlwZT1cIm92ZXJsYXlcIiBhcHBJZD17YXBwSWR9IC8+XG4gICAgPC9vdmVybGF5PlxuICA8L2J1dHRvbj5cbn1cblxuZnVuY3Rpb24gTWVkaWFXaWRnZXQoKSB7XG4gIGNvbnN0IG1wcmlzID0gTXByaXMuZ2V0X2RlZmF1bHQoKVxuICAvLyBQaWNrIHRoZSBmaXJzdCBhY3RpdmUgcGxheWVyLCBvciBudWxsIGlmIG5vdGhpbmcgaXMgcGxheWluZ1xuICBjb25zdCBwbGF5ZXIgPSBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMocHMgPT4gcHMuZmluZChwID0+IHAucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXSA/PyBudWxsKVxuICBjb25zdCBwcm9ncmVzcyA9IGJpbmQobXByaXMsIFwicGxheWVyc1wiKS5hcyhwcyA9PiB7XG4gICAgY29uc3QgcCA9IHBzLmZpbmQocSA9PiBxLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlORykgPz8gcHNbMF1cbiAgICBpZiAoIXAgfHwgIXAubGVuZ3RoIHx8IHAubGVuZ3RoIDw9IDApIHJldHVybiAwXG4gICAgcmV0dXJuIHAucG9zaXRpb24gLyBwLmxlbmd0aFxuICB9KVxuICBjb25zdCBpY29uID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKHBzID0+IHtcbiAgICBjb25zdCBwID0gcHMuZmluZChxID0+IHEucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXVxuICAgIGlmICghcCkgcmV0dXJuIFwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgIHJldHVybiBwLnBsYXliYWNrX3N0YXR1cyA9PT0gTXByaXMuUGxheWJhY2tTdGF0dXMuUExBWUlOR1xuICAgICAgPyBcImtvYmVsLXBhdXNlLXN5bWJvbGljXCIgOiBcImtvYmVsLXBsYXktc3ltYm9saWNcIlxuICB9KVxuICByZXR1cm4gPGJ1dHRvbiBjbGFzcz1cImRidG4gZHdpZGdldFwiXG4gICAgb25DbGlja2VkPXsoKSA9PiBleGVjQXN5bmMoXCJwbGF5ZXJjdGwgcGxheS1wYXVzZVwiKX0+XG4gICAgPG92ZXJsYXk+XG4gICAgICA8Ym94IGNsYXNzPVwiZHRpbGVcIj5cbiAgICAgICAgPGltYWdlIGNsYXNzPVwiZGdcIiBpY29uTmFtZT17aWNvbn0gcGl4ZWxTaXplPXsxOH1cbiAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBoZXhwYW5kIHZleHBhbmQgLz5cbiAgICAgIDwvYm94PlxuICAgICAgPGxldmVsYmFyIHR5cGU9XCJvdmVybGF5XCIgY2xhc3M9XCJtcHJvZ1wiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uRU5EfVxuICAgICAgICAgICAgICAgIHZhbHVlPXtwcm9ncmVzc30gLz5cbiAgICA8L292ZXJsYXk+XG4gIDwvYnV0dG9uPlxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIERFTU8gbW9kZTogcmVuZGVyIHRoZSBwcm90b3R5cGUncyBFWEFDVCBkb2NrIChkb2NzL3Byb3RvdHlwZS5odG1sKSB3aXRoIHJlYWwgR1RLXG4vLyB3aWRnZXRzLCBzbyBpdCBjYW4gYmUgcGl4ZWwtb3ZlcmxhaWQgb24gdGhlIHByb3RvdHlwZSByZW5kZXIgMToxLiBJY29ucyBsb2FkIGZyb20gdGhlXG4vLyBTQU1FIG9uLWRpc2sgZmlsZXMgdGhlIHByb3RvdHlwZSByZWZlcmVuY2VzICh2aWEgYSBGaWxlSWNvbiBnaWNvbikgcmF0aGVyIHRoYW4gYnlcbi8vIHRoZW1lZCBuYW1lIFx1MjAxNCBhIHRoZW1lZCBsb29rdXAgc25hcHMgdG8gYSBkaWZmZXJlbnQgc2l6ZSB2YXJpYW50IChlLmcuIHRoZSAzMnB4IGZpcmVmb3hcbi8vIGluc3RlYWQgb2YgdGhlIHByb3RvdHlwZSdzIDI1NnB4IHBuZykgYW5kIGRvd25zY2FsZXMgZGlmZmVyZW50bHkuIFNhbWUgc291cmNlIGZpbGUgXHUyMTkyXG4vLyBjbG9zZXN0IGNyb3NzLWVuZ2luZSBtYXRjaC4gKHBpeGVsLXNpemUgaXMgaG9ub3VyZWQgbm93IHRoZSBpY29uLXRpbGUgbWluIGlzIDMwLilcbmNvbnN0IERFTU9fQVBQUyA9IFtcbiAgeyBuYW1lOiBcIlRlcm1pbmFsXCIsIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlB0eXhpcy5zdmdcIiwgICAgICAgICAgIGRvdHM6IFtcIm9uXCIsIFwiZG90XCJdIH0sXG4gIHsgbmFtZTogXCJGaWxlc1wiLCAgICBpY29uOiBcIi91c3Ivc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL29yZy5nbm9tZS5OYXV0aWx1cy5zdmdcIiwgICAgICAgICBkb3RzOiBbXCJkb3RcIl0gfSxcbiAgeyBuYW1lOiBcIkZpcmVmb3hcIiwgIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yLzI1NngyNTYvYXBwcy9maXJlZm94LnBuZ1wiLCAgICAgICAgICAgICAgICAgICAgIGRvdHM6IFtdIH0sXG4gIHsgbmFtZTogXCJaZWRcIiwgICAgICBpY29uOiBcIi9ob21lL2tpZXJhbi8ubG9jYWwvemVkLmFwcC9zaGFyZS9pY29ucy9oaWNvbG9yLzUxMng1MTIvYXBwcy96ZWQucG5nXCIsICBkb3RzOiBbXSB9LFxuICB7IG5hbWU6IFwiU3BvdGlmeVwiLCAgaWNvbjogXCIvdmFyL2xpYi9mbGF0cGFrL2V4cG9ydHMvc2hhcmUvaWNvbnMvaGljb2xvci9zY2FsYWJsZS9hcHBzL2NvbS5zcG90aWZ5LkNsaWVudC5zdmdcIiwgZG90czogW10gfSxcbiAgeyBuYW1lOiBcIlNldHRpbmdzXCIsIGljb246IFwiL3Vzci9zaGFyZS9pY29ucy9oaWNvbG9yL3NjYWxhYmxlL2FwcHMvb3JnLmdub21lLlNldHRpbmdzLnN2Z1wiLCAgICAgICAgIGRvdHM6IFtdIH0sXG5dXG5cbmZ1bmN0aW9uIGZpbGVJY29uKHBhdGg6IHN0cmluZyk6IEdpby5JY29uIHtcbiAgcmV0dXJuIEdpby5GaWxlSWNvbi5uZXcoR2lvLkZpbGUubmV3X2Zvcl9wYXRoKHBhdGgpKVxufVxuXG5mdW5jdGlvbiBEZW1vQnV0dG9uKHsgYXBwIH06IHsgYXBwOiAodHlwZW9mIERFTU9fQVBQUylbbnVtYmVyXSB9KSB7XG4gIC8vIE5COiB0aGUgZG90cyBib3ggY2FycmllcyBgdHlwZT1cIm92ZXJsYXlcImAgRElSRUNUTFkgKGludHJpbnNpYyBlbGVtZW50KSBcdTIwMTQgYSBmdW5jdGlvblxuICAvLyBjb21wb25lbnQgd291bGQgc3dhbGxvdyB0aGUgcHJvcCwgbGV0dGluZyB0aGUgdW50eXBlZCBib3ggcmVwbGFjZSB0aGUgaWNvbiBhcyB0aGVcbiAgLy8gb3ZlcmxheSdzIG1haW4gY2hpbGQgKEd0a092ZXJsYXkuc2V0X2NoaWxkKS4gSWNvbiBzdGF5cyBtYWluOyBkb3RzIG92ZXJsYXkgb24gdG9wLlxuICByZXR1cm4gPGJ1dHRvbiBjbGFzcz1cImRidG5cIiB0b29sdGlwVGV4dD17YXBwLm5hbWV9PlxuICAgIDxvdmVybGF5PlxuICAgICAgPGltYWdlIGNsYXNzPVwiaWNvbi10aWxlXCIgZ2ljb249e2ZpbGVJY29uKGFwcC5pY29uKX0gcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgIDxib3ggdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cImRvdHNcIiBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkVORH0gc3BhY2luZz17M30+XG4gICAgICAgIHthcHAuZG90cy5tYXAoY2xzID0+IDxib3ggY2xhc3M9e2NscyA9PT0gXCJvblwiID8gXCJkb3Qgb25cIiA6IFwiZG90XCJ9IC8+KX1cbiAgICAgIDwvYm94PlxuICAgIDwvb3ZlcmxheT5cbiAgPC9idXR0b24+XG59XG5cbmZ1bmN0aW9uIERlbW9Eb2NrKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImRvY2tcIiBuYW1lc3BhY2U9XCJrb2JlbC1kb2NrXCIgY2xhc3M9XCJkb2NrLXdpbmRvd1wiXG4gICAgZ2RrbW9uaXRvcj17bW9uaXRvcn0gYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfT5cbiAgICA8Ym94IGNsYXNzPVwiZG9ja1wiIHNwYWNpbmc9ezR9PlxuICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbMF19IC8+XG4gICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1sxXX0gLz5cbiAgICAgIDxEZW1vQnV0dG9uIGFwcD17REVNT19BUFBTWzJdfSAvPlxuICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbM119IC8+XG4gICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgPERlbW9CdXR0b24gYXBwPXtERU1PX0FQUFNbNF19IC8+XG4gICAgICA8RGVtb0J1dHRvbiBhcHA9e0RFTU9fQVBQU1s1XX0gLz5cbiAgICAgIDxib3ggY2xhc3M9XCJzZXBcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICA8TWVkaWFXaWRnZXQgLz5cbiAgICA8L2JveD5cbiAgPC93aW5kb3c+XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIERvY2sobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgaWYgKERFTU8pIHJldHVybiBEZW1vRG9jayhtb25pdG9yKVxuXG4gIGNvbnN0IGFwcHMgPSBuZXcgQXBwcy5BcHBzKClcbiAgLy8gUGlubmVkIGVudHJpZXMgcmVzb2x2ZWQgYnkgZGVza3RvcC1pZDsgdGhlIGRvY2sgbmV2ZXIgc2l0cyBlbXB0eSwgc28gZmlsbCBhbnlcbiAgLy8gdW5yZXNvbHZlZCBzbG90cyAoZS5nLiBhbiBhcHAgbm90IGluc3RhbGxlZCBpbiB0aGUgZGV2a2l0KSBmcm9tIHRoZSBpbnN0YWxsZWRcbiAgLy8gbGlzdC4gT24gcmVhbCBoYXJkd2FyZSB0aGUgcGlucyByZXNvbHZlIGFuZCB0aGUgZmlsbCBpcyB1bnVzZWQuXG4gIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICBjb25zdCByZXNvbHZlID0gKGlkOiBzdHJpbmcpOiBBcHBzLkFwcGxpY2F0aW9uIHwgdW5kZWZpbmVkID0+XG4gICAgYWxsLmZpbmQoYSA9PiBhLmVudHJ5ID09PSBgJHtpZH0uZGVza3RvcGAgfHwgYS5lbnRyeSA9PT0gaWQpXG4gICAgPz8gYWxsLmZpbmQoYSA9PiBhLmVudHJ5Py50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGlkLnRvTG93ZXJDYXNlKCkuc3BsaXQoXCIuXCIpLnBvcCgpISkpXG4gIC8vIEFsd2F5cyByZW5kZXIgb25lIHNsb3QgcGVyIHBpbiBzbyB0aGUgZG9jayBrZWVwcyBpdHMgc2hhcGU7IHJlc29sdmVkIHBpbnMgZ2V0IHRoZVxuICAvLyByZWFsIGFwcCArIGJlaGF2aW9yLCB1bnJlc29sdmVkIG9uZXMgYSBsYWJlbGxlZCBwbGFjZWhvbGRlciB0aWxlLiBBIHNlcGFyYXRvciBzaXRzXG4gIC8vIGJldHdlZW4gdGhlIGZvdXJ0aCBhbmQgZmlmdGggcGlucyAocHJvdG90eXBlIHBhcml0eSksIHRoZW4gYmVmb3JlIHRoZSBtZWRpYSB3aWRnZXQuXG4gIGNvbnN0IHNsb3RzID0gUElOTkVELm1hcChpZCA9PiAoeyBpZCwgYXBwOiByZXNvbHZlKGlkKSB9KSlcbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwiZG9ja1wiIG5hbWVzcGFjZT1cImtvYmVsLWRvY2tcIiBjbGFzcz1cImRvY2std2luZG93XCJcbiAgICBnZGttb25pdG9yPXttb25pdG9yfSBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5CT1RUT019PlxuICAgIDxib3ggY2xhc3M9XCJkb2NrXCIgc3BhY2luZz17NH0+XG4gICAgICB7c2xvdHMubWFwKCh7IGlkLCBhcHAgfSwgaSkgPT4gW1xuICAgICAgICBpID09PSA0ID8gPGJveCBjbGFzcz1cInNlcFwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz4gOiBudWxsLFxuICAgICAgICBhcHBcbiAgICAgICAgICA/IDxEb2NrQnV0dG9uIGFwcD17YXBwfSAvPlxuICAgICAgICAgIDogPGJ1dHRvbiBjbGFzcz1cImRidG4gcGxhY2Vob2xkZXJcIiB0b29sdGlwVGV4dD17aWQuc3BsaXQoXCIuXCIpLnBvcCgpfT5cbiAgICAgICAgICAgICAgPGltYWdlIGNsYXNzPVwiaWNvbi10aWxlXCIgaWNvbk5hbWU9XCJhcHBsaWNhdGlvbi14LWV4ZWN1dGFibGUtc3ltYm9saWNcIiBwaXhlbFNpemU9ezMwfSAvPlxuICAgICAgICAgICAgPC9idXR0b24+LFxuICAgICAgXSl9XG4gICAgICA8Ym94IGNsYXNzPVwic2VwXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSAvPlxuICAgICAgPE1lZGlhV2lkZ2V0IC8+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuIiwgIi8vIFRoZSBzcG90bGlnaHQuIFByb3RvdHlwZS1maW5hbCBiZWhhdmlvcjpcbi8vICAgU3VwZXIgcmVsZWFzZSBvcGVucyAoY29tcG9zaXRvciBrZXliaW5kIFx1MjE5MiBgYXN0YWwgLWkga29iZWwgLXQgbGF1bmNoZXJgKVxuLy8gICBmdXp6eSArIGxlYWYgaGlnaGxpZ2h0IFx1MDBCNyBnbG9iYWwgQkVTVC1NQVRDSCBzbG90IChzY29yZS1yYW5rZWQgYWNyb3NzIHByb3ZpZGVycyxcbi8vICAgdHlwZSB3ZWlnaHRzIGFwcHMgMSAvIGFjdGlvbnMgLjk1IC8gZmlsZXMgLjkpIFx1MDBCNyBjYXBwZWQgbG9nMiBmcmVjZW5jeVxuLy8gICBnaG9zdCBhdXRvY29tcGxldGUgPSBmaXJzdCBwcmVmaXgtY29tcGxldGFibGUgbmFtZSBpbiBkaXNwbGF5IG9yZGVyXG4vLyAgIFRhYiBhbHdheXMgb3duZWQgKGdob3N0IGVsc2UgbmV4dDsgU2hpZnQrVGFiIHByZXYpIFx1MDBCNyBDdHJsK04vUCBcdTAwQjcgRXNjIGNsZWFycyBmaXJzdFxuLy8gICBzZWN0aW9uczogYmVzdCBtYXRjaCAvIGFwcHMgLyBhY3Rpb25zIC8gZmlsZXMgLyB3ZWIgKGFsd2F5cy1sYXN0IHJlYWwgcm93KVxuLy8gICAnPScgY2FsY3VsYXRvciBcdTAwQjcgJzonIGdub2JsaW5jdGwgY29tbWFuZHMgXHUwMEI3IGVtcHR5IHN0YXRlOiBkb2NrLXRpbGUgZ3JpZCArIHdpZGdldHNcbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciwgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IEFwcHMgZnJvbSBcImdpOi8vQXN0YWxBcHBzXCJcbmltcG9ydCBNcHJpcyBmcm9tIFwiZ2k6Ly9Bc3RhbE1wcmlzXCJcbmltcG9ydCB7IGZ1enp5LCBobCwgYm9vc3QsIGJ1bXAsIGZyZXF1ZW5jeSB9IGZyb20gXCIuLi9saWIvZnV6enlcIlxuaW1wb3J0IHsgRVZFTlRTIH0gZnJvbSBcIi4vQ2FsZW5kYXJcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5cbi8vIEN1cmF0ZWQgZ3JpZDogdGhlIGRvY2sncyBwaW5uZWQgYXBwcyBmaXJzdCAocmVzb2x2ZWQgYnkgZGVza3RvcC1pZCksIHRoZW4gZmlsbCB0aGVcbi8vIHJlbWFpbmluZyBzbG90cyBieSBmcmVjZW5jeS4gTWF0Y2hlcyB0aGUgcHJvdG90eXBlJ3MgbGF1bmNoZXIgZW1wdHktc3RhdGUuXG5jb25zdCBQSU5ORUQgPSBbXCJvcmcuZ25vbWUuUHR5eGlzXCIsIFwib3JnLmdub21lLk5hdXRpbHVzXCIsIFwiZmlyZWZveFwiLFxuICBcImRldi56ZWQuWmVkXCIsIFwiY29tLnNwb3RpZnkuQ2xpZW50XCIsIFwib3JnLmdub21lLlNldHRpbmdzXCJdXG4vLyBEZW1vIGdyaWQ6IGZpeGVkIG9yZGVyICsgbGFiZWxzIHRyYW5zY3JpYmVkIGZyb20gdGhlIHByb3RvdHlwZSAoRC5hcHBzKSwgZWFjaCBtYXBwZWRcbi8vIHRvIHRoZSByZWFsIC5kZXNrdG9wIGlkIHNvIGl0cyB0aGVtZWQgaWNvbiByZW5kZXJzIChQdHl4aXMvTmF1dGlsdXMvXHUyMDI2KS5cbmNvbnN0IERFTU9fVElMRVMgPSBbXG4gIHsgbmFtZTogXCJUZXJtaW5hbFwiLCBpZDogXCJvcmcuZ25vbWUuUHR5eGlzXCIgfSxcbiAgeyBuYW1lOiBcIkZpbGVzXCIsIGlkOiBcIm9yZy5nbm9tZS5OYXV0aWx1c1wiIH0sXG4gIHsgbmFtZTogXCJGaXJlZm94XCIsIGlkOiBcImZpcmVmb3hcIiB9LFxuICB7IG5hbWU6IFwiWmVkXCIsIGlkOiBcImRldi56ZWQuWmVkXCIgfSxcbiAgeyBuYW1lOiBcIlNwb3RpZnlcIiwgaWQ6IFwiY29tLnNwb3RpZnkuQ2xpZW50XCIgfSxcbiAgeyBuYW1lOiBcIlNldHRpbmdzXCIsIGlkOiBcIm9yZy5nbm9tZS5TZXR0aW5nc1wiIH0sXG5dXG5cbmludGVyZmFjZSBUaWxlIHsgbmFtZTogc3RyaW5nOyBpY29uTmFtZTogc3RyaW5nOyBsYXVuY2g6ICgpID0+IHZvaWQgfVxuZnVuY3Rpb24gZ3JpZFRpbGVzKGFwcHM6IEFwcHMuQXBwcyk6IFRpbGVbXSB7XG4gIGNvbnN0IGFsbCA9IGFwcHMuZ2V0X2xpc3QoKVxuICBjb25zdCByZXNvbHZlID0gKGlkOiBzdHJpbmcpOiBBcHBzLkFwcGxpY2F0aW9uIHwgdW5kZWZpbmVkID0+XG4gICAgYWxsLmZpbmQoYSA9PiBhLmVudHJ5ID09PSBgJHtpZH0uZGVza3RvcGAgfHwgYS5lbnRyeSA9PT0gaWQpXG4gICAgPz8gYWxsLmZpbmQoYSA9PiBhLmVudHJ5Py50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKGlkLnRvTG93ZXJDYXNlKCkuc3BsaXQoXCIuXCIpLnBvcCgpISkpXG4gIGNvbnN0IGZyb21BcHAgPSAoYXBwOiBBcHBzLkFwcGxpY2F0aW9uKTogVGlsZSA9PiAoe1xuICAgIG5hbWU6IGFwcC5uYW1lLCBpY29uTmFtZTogYXBwLmljb25fbmFtZSB8fCBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgIGxhdW5jaDogKCkgPT4geyBidW1wKGFwcC5uYW1lKTsgYXBwLmxhdW5jaCgpIH0sXG4gIH0pXG4gIGlmIChERU1PKSByZXR1cm4gREVNT19USUxFUy5tYXAoKHsgbmFtZSwgaWQgfSkgPT4ge1xuICAgIGNvbnN0IGFwcCA9IHJlc29sdmUoaWQpXG4gICAgcmV0dXJuIHsgbmFtZSwgaWNvbk5hbWU6IGFwcD8uaWNvbl9uYW1lIHx8IGlkIHx8IFwiYXBwbGljYXRpb24teC1leGVjdXRhYmxlXCIsXG4gICAgICBsYXVuY2g6ICgpID0+IHsgYnVtcChuYW1lKTsgYXBwPy5sYXVuY2goKSB9IH1cbiAgfSlcbiAgY29uc3QgcGlubmVkID0gUElOTkVELm1hcChyZXNvbHZlKS5maWx0ZXIoQm9vbGVhbikgYXMgQXBwcy5BcHBsaWNhdGlvbltdXG4gIGNvbnN0IHJlc3QgPSBhbGwuZmlsdGVyKGEgPT4gIXBpbm5lZC5pbmNsdWRlcyhhKSlcbiAgICAuc29ydCgoeCwgeSkgPT4gZnJlcXVlbmN5KHkubmFtZSkgLSBmcmVxdWVuY3koeC5uYW1lKSlcbiAgcmV0dXJuIFsuLi5waW5uZWQsIC4uLnJlc3RdLnNsaWNlKDAsIDYpLm1hcChmcm9tQXBwKVxufVxuZnVuY3Rpb24gdG9kYXlFdmVudExhYmVsKCk6IHN0cmluZyB7XG4gIGlmIChERU1PKSByZXR1cm4gRC53aWRnZXRFdmVudFxuICBjb25zdCBkID0gbmV3IERhdGUoKVxuICBjb25zdCBldnMgPSBFVkVOVFNbYCR7ZC5nZXRGdWxsWWVhcigpfS0ke2QuZ2V0TW9udGgoKSArIDF9LSR7ZC5nZXREYXRlKCl9YF0gPz8gW11cbiAgcmV0dXJuIGV2cy5sZW5ndGggPyBgJHtldnNbMF0udH0gXHUwMEI3ICR7ZXZzWzBdLm59YCA6IFwiTm8gZXZlbnRzIHRvZGF5XCJcbn1cbmZ1bmN0aW9uIHRvZGF5RGF0ZUxhYmVsKCk6IHN0cmluZyB7XG4gIHJldHVybiBERU1PID8gRC53aWRnZXREYXRlXG4gICAgOiBuZXcgRGF0ZSgpLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIsIGRheTogXCJudW1lcmljXCIsIG1vbnRoOiBcImxvbmdcIiB9KVxufVxuXG5pbnRlcmZhY2UgUm93IHtcbiAgbmFtZTogc3RyaW5nOyBpY29uOiBzdHJpbmc7IGhpbnQ6IHN0cmluZzsgc2NvcmU6IG51bWJlclxuICBtYXJrdXA6IHN0cmluZzsgcnVuOiAoKSA9PiB2b2lkXG59XG5cbmNvbnN0IEFDVElPTlMgPSBbXG4gIHsgbjogXCJTdXNwZW5kXCIsIGljb246IFwia29iZWwtbW9vbi1zeW1ib2xpY1wiLCBkOiBcIlNsZWVwIFx1MjAxNCByZXN1bWUgaW5zdGFudGx5XCIsXG4gICAgYWw6IFtcInNsZWVwXCJdLCBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCBzdXNwZW5kXCIpIH0sXG4gIHsgbjogXCJMb2NrXCIsIGljb246IFwia29iZWwtbG9jay1zeW1ib2xpY1wiLCBkOiBcIkxvY2sgdGhlIHNlc3Npb25cIixcbiAgICBhbDogW1wibG9jayBzY3JlZW5cIl0sIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpIH0sXG4gIHsgbjogXCJMb2cgT3V0XCIsIGljb246IFwia29iZWwtbG9nb3V0LXN5bWJvbGljXCIsIGQ6IFwiRW5kIHRoaXMgc2Vzc2lvblwiLFxuICAgIGFsOiBbXCJleGl0XCIsIFwic2lnbiBvdXRcIiwgXCJsb2dvdXRcIl0sIHJ1bjogKCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIikgfSxcbiAgeyBuOiBcIlJlc3RhcnRcIiwgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIiwgZDogXCJSZWJvb3QgdGhlIG1hY2hpbmVcIixcbiAgICBhbDogW1wicmVib290XCJdLCBydW46ICgpID0+IHN1cmZhY2VUb2dnbGUoXCJzZXNzaW9uXCIpIH0sXG4gIHsgbjogXCJTaHV0IERvd25cIiwgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLCBkOiBcIlBvd2VyIG9mZlwiLFxuICAgIGFsOiBbXCJwb3dlcm9mZlwiLCBcImhhbHRcIl0sIHJ1bjogKCkgPT4gc3VyZmFjZVRvZ2dsZShcInNlc3Npb25cIikgfSxcbiAgeyBuOiBcIlNvZnQtcmVsb2FkIGdub2JsaW5cIiwgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICBkOiBcIlJlbG9hZCB0aGUgc2hlbGwgXHUyMDE0IHdpbmRvd3Mgc3Vydml2ZVwiLCBhbDogW10sXG4gICAgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJnbm9ibGluY3RsIHJlbG9hZFwiKSB9LFxuXVxuXG5jb25zdCBDTURTID0gW1xuICB7IGM6IFwicmVsb2FkXCIsIGQ6IFwiU29mdC1yZWxvYWQgdGhlIHNoZWxsIFx1MjAxNCB3aW5kb3dzIHN1cnZpdmVcIiB9LFxuICB7IGM6IFwib3NkIG9mZlwiLCBkOiBcImtvYmVsIG93bnMgdm9sdW1lL2JyaWdodG5lc3MgcG9wdXBzXCIgfSxcbiAgeyBjOiBcIm5vdGlmcyBvZmZcIiwgZDogXCJSZWxlYXNlIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zXCIgfSxcbiAgeyBjOiBcImdyYW50c1wiLCBkOiBcIlNjcmVlbi1yZWNvcmRpbmcgYWNjZXNzIHBlciBhcHBcIiB9LFxuXVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBMYXVuY2hlcigpIHtcbiAgY29uc3QgYXBwcyA9IG5ldyBBcHBzLkFwcHMoKVxuICAvLyBLT0JFTF9RVUVSWSBwcmUtZmlsbHMgdGhlIHNlYXJjaCBzbyB0aGUgZGV2a2l0IGNhbiByZW5kZXIgdGhlIHJlc3VsdHMgc3RhdGUuXG4gIGNvbnN0IHF1ZXJ5ID0gVmFyaWFibGUoR0xpYi5nZXRlbnYoXCJLT0JFTF9RVUVSWVwiKSB8fCBcIlwiKVxuICBjb25zdCBzZWxlY3RlZCA9IFZhcmlhYmxlKDApXG4gIGNvbnN0IGdob3N0ID0gVmFyaWFibGUoXCJcIilcblxuICBmdW5jdGlvbiByZXN1bHRzKHE6IHN0cmluZyk6IHsgc2VjdGlvbjogc3RyaW5nLCByb3dzOiBSb3dbXSB9W10ge1xuICAgIGNvbnN0IHF0ID0gcS50cmltKClcbiAgICBpZiAoIXF0KSByZXR1cm4gW11cbiAgICBpZiAocXQuc3RhcnRzV2l0aChcIjpcIikpIHtcbiAgICAgIGNvbnN0IGNxID0gcXQuc2xpY2UoMSkudHJpbSgpXG4gICAgICByZXR1cm4gW3tcbiAgICAgICAgc2VjdGlvbjogXCJnbm9ibGluY3RsXCIsXG4gICAgICAgIHJvd3M6IENNRFMuZmlsdGVyKGMgPT4gYy5jLnN0YXJ0c1dpdGgoY3EpKS5tYXAoYyA9PiAoe1xuICAgICAgICAgIG5hbWU6IGA6JHtjLmN9YCwgaWNvbjogXCJrb2JlbC10ZXJtaW5hbC1zeW1ib2xpY1wiLCBoaW50OiBjLmQsIHNjb3JlOiA5OSxcbiAgICAgICAgICBtYXJrdXA6IGA6JHtjLmN9YCwgcnVuOiAoKSA9PiBleGVjQXN5bmMoYGdub2JsaW5jdGwgJHtjLmN9YCksXG4gICAgICAgIH0pKSxcbiAgICAgIH1dXG4gICAgfVxuICAgIGNvbnN0IG91dDogeyBzZWN0aW9uOiBzdHJpbmcsIHJvd3M6IFJvd1tdIH1bXSA9IFtdXG4gICAgLy8gJz0nIGNhbGN1bGF0b3IgKGNoYXJzZXQtZ3VhcmRlZCwgc2FtZSBhcyBwcm90b3R5cGUpXG4gICAgaWYgKC9ePT9bMC05K1xcLSovKCkuIF0rJC8udGVzdChxdCkgJiYgL1swLTldLy50ZXN0KHF0KSAmJiAvWytcXC0qL10vLnRlc3QocXQpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB2ID0gRnVuY3Rpb24oYFwidXNlIHN0cmljdFwiO3JldHVybigke3F0LnJlcGxhY2UoL149LywgXCJcIil9KWApKClcbiAgICAgICAgaWYgKE51bWJlci5pc0Zpbml0ZSh2KSkgb3V0LnB1c2goe1xuICAgICAgICAgIHNlY3Rpb246IFwiY2FsY3VsYXRvclwiLFxuICAgICAgICAgIHJvd3M6IFt7IG5hbWU6IFN0cmluZyh2KSwgaWNvbjogXCJrb2JlbC1jYWxjdWxhdG9yLXN5bWJvbGljXCIsXG4gICAgICAgICAgICBoaW50OiBgJHtxdC5yZXBsYWNlKC9ePS8sIFwiXCIpfSA9YCwgc2NvcmU6IDk4LCBtYXJrdXA6IFN0cmluZyh2KSxcbiAgICAgICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcIndsLWNvcHlcIiwgU3RyaW5nKHYpXSkgfV0sXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIHsgfVxuICAgIH1cbiAgICBjb25zdCBhcHBSb3dzOiBSb3dbXSA9IGFwcHMuZnV6enlfcXVlcnkocXQpLnNsaWNlKDAsIDUpLm1hcChhID0+IHtcbiAgICAgIGNvbnN0IG0gPSBmdXp6eShxdCwgYS5uYW1lKSA/PyB7IHNjb3JlOiAxLCBtYXJrczogbnVsbCBhcyBhbnkgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogYS5uYW1lLCBpY29uOiBhLmljb25fbmFtZSA/PyBcImFwcGxpY2F0aW9uLXgtZXhlY3V0YWJsZVwiLFxuICAgICAgICBoaW50OiBcIkFwcGxpY2F0aW9uXCIsIHNjb3JlOiBtLnNjb3JlICsgYm9vc3QoYS5uYW1lKSxcbiAgICAgICAgbWFya3VwOiBobChhLm5hbWUsIG0ubWFya3MpLFxuICAgICAgICBydW46ICgpID0+IHsgYnVtcChhLm5hbWUpOyBhLmxhdW5jaCgpIH0sXG4gICAgICB9XG4gICAgfSlcbiAgICBjb25zdCBhY3RSb3dzOiBSb3dbXSA9IEFDVElPTlMubWFwKHggPT4ge1xuICAgICAgbGV0IG0gPSBmdXp6eShxdCwgeC5uKVxuICAgICAgaWYgKCFtKSBmb3IgKGNvbnN0IGFsIG9mIHguYWwpIHsgY29uc3QgYW0gPSBmdXp6eShxdCwgYWwpOyBpZiAoYW0pIHsgbSA9IHsgc2NvcmU6IGFtLnNjb3JlIC0gLjUsIG1hcmtzOiBudWxsIGFzIGFueSB9OyBicmVhayB9IH1cbiAgICAgIHJldHVybiBtID8geyBuYW1lOiB4Lm4sIGljb246IHguaWNvbiwgaGludDogeC5kLCBzY29yZTogbS5zY29yZSAqIC45NSxcbiAgICAgICAgbWFya3VwOiBobCh4Lm4sIChtIGFzIGFueSkubWFya3MpLCBydW46IHgucnVuIH0gYXMgUm93IDogbnVsbFxuICAgIH0pLmZpbHRlcihCb29sZWFuKSBhcyBSb3dbXVxuICAgIC8vIGdsb2JhbCBiZXN0LW1hdGNoIHNsb3QgKGNyaXRpcXVlIEExKVxuICAgIGNvbnN0IGFsbCA9IFsuLi5hcHBSb3dzLCAuLi5hY3RSb3dzXS5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSlcbiAgICBjb25zdCBiZXN0ID0gYWxsWzBdXG4gICAgaWYgKGJlc3QpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJiZXN0IG1hdGNoXCIsIHJvd3M6IFtiZXN0XSB9KVxuICAgIGNvbnN0IHJlc3QgPSAocm93czogUm93W10pID0+IHJvd3MuZmlsdGVyKHIgPT4gciAhPT0gYmVzdClcbiAgICBpZiAocmVzdChhcHBSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhcHBzXCIsIHJvd3M6IHJlc3QoYXBwUm93cykgfSlcbiAgICBpZiAocmVzdChhY3RSb3dzKS5sZW5ndGgpIG91dC5wdXNoKHsgc2VjdGlvbjogXCJhY3Rpb25zXCIsIHJvd3M6IHJlc3QoYWN0Um93cykuc2xpY2UoMCwgMykgfSlcbiAgICBvdXQucHVzaCh7XG4gICAgICBzZWN0aW9uOiBcIndlYlwiLFxuICAgICAgcm93czogW3sgbmFtZTogYFNlYXJjaCB0aGUgd2ViIGZvciBcdTIwMUMke3F0fVx1MjAxRGAsIGljb246IFwia29iZWwtZ2xvYmUtc3ltYm9saWNcIixcbiAgICAgICAgaGludDogXCJcIiwgc2NvcmU6IDAsIG1hcmt1cDogYFNlYXJjaCB0aGUgd2ViIGZvciBcdTIwMUMke3F0fVx1MjAxRGAsXG4gICAgICAgIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFtcInhkZy1vcGVuXCIsIGBodHRwczovL2R1Y2tkdWNrZ28uY29tLz9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHF0KX1gXSkgfV0sXG4gICAgfSlcbiAgICAvLyBnaG9zdCA9IGZpcnN0IHByZWZpeC1jb21wbGV0YWJsZSBuYW1lIGluIGRpc3BsYXkgb3JkZXIgKGNyaXRpcXVlIEE0KVxuICAgIGNvbnN0IGcgPSBvdXQuZmxhdE1hcChzID0+IHMucm93cykubWFwKHIgPT4gci5uYW1lKVxuICAgICAgLmZpbmQobiA9PiBuLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChxdC50b0xvd2VyQ2FzZSgpKSAmJiBuLmxlbmd0aCA+IHF0Lmxlbmd0aClcbiAgICBnaG9zdC5zZXQoZyA/PyBcIlwiKVxuICAgIHJldHVybiBvdXRcbiAgfVxuXG4gIGNvbnN0IHNlY3Rpb25zID0gYmluZChxdWVyeSkuYXMocmVzdWx0cylcblxuICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkOiBsYXVuY2hSZXZlYWxlZCwgc2V0UmV2ZWFsZXI6IHNldExhdW5jaFJldmVhbGVyLCBjbG9zZTogbGF1bmNoQ2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjIwLCAxNTApXG4gIHJlZ2lzdGVyKFwibGF1bmNoZXJcIiwgdG9nZ2xlRm4pXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImxhdW5jaGVyXCIgbmFtZXNwYWNlPVwia29iZWwtbGF1bmNoZXJcIiBjbGFzcz1cImxhdW5jaGVyLXdpbmRvd1wiXG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QfSBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuTk9STUFMfVxuICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuRVhDTFVTSVZFfVxuICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSwgX2NvZGUsIG1vZHMpID0+IHtcbiAgICAgIGNvbnN0IGZsYXQgPSByZXN1bHRzKHF1ZXJ5LmdldCgpKS5mbGF0TWFwKHMgPT4gcy5yb3dzKVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHtcbiAgICAgICAgaWYgKHF1ZXJ5LmdldCgpKSB7IHF1ZXJ5LnNldChcIlwiKTsgcmV0dXJuIHRydWUgfVxuICAgICAgICBsYXVuY2hDbG9zZSgpOyByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9UYWIpIHsgICAgICAgICAgICAgICAgICAgICAgIC8vIFRhYiBpcyBBTFdBWVMgb3duZWRcbiAgICAgICAgY29uc3QgZyA9IGdob3N0LmdldCgpLCBxID0gcXVlcnkuZ2V0KClcbiAgICAgICAgaWYgKGcgJiYgIShtb2RzICYgR2RrLk1vZGlmaWVyVHlwZS5TSElGVF9NQVNLKSkgeyBxdWVyeS5zZXQoZyk7IHJldHVybiB0cnVlIH1cbiAgICAgICAgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArICgobW9kcyAmIEdkay5Nb2RpZmllclR5cGUuU0hJRlRfTUFTSykgPyAtMSA6IDEpXG4gICAgICAgICAgKyBmbGF0Lmxlbmd0aCkgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoKG1vZHMgJiBHZGsuTW9kaWZpZXJUeXBlLkNPTlRST0xfTUFTSykgJiZcbiAgICAgICAgICAoa2V5ID09PSBHZGsuS0VZX24gfHwga2V5ID09PSBHZGsuS0VZX3ApKSB7XG4gICAgICAgIHNlbGVjdGVkLnNldCgoc2VsZWN0ZWQuZ2V0KCkgKyAoa2V5ID09PSBHZGsuS0VZX24gPyAxIDogLTEpICsgZmxhdC5sZW5ndGgpXG4gICAgICAgICAgJSBNYXRoLm1heChmbGF0Lmxlbmd0aCwgMSkpXG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9XG4gICAgICBpZiAoa2V5ID09PSBHZGsuS0VZX0Rvd24pIHsgc2VsZWN0ZWQuc2V0KChzZWxlY3RlZC5nZXQoKSArIDEpICUgTWF0aC5tYXgoZmxhdC5sZW5ndGgsIDEpKTsgcmV0dXJuIHRydWUgfVxuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9VcCkgeyBzZWxlY3RlZC5zZXQoKHNlbGVjdGVkLmdldCgpIC0gMSArIGZsYXQubGVuZ3RoKSAlIE1hdGgubWF4KGZsYXQubGVuZ3RoLCAxKSk7IHJldHVybiB0cnVlIH1cbiAgICAgIGlmIChrZXkgPT09IEdkay5LRVlfUmV0dXJuKSB7XG4gICAgICAgIGZsYXRbc2VsZWN0ZWQuZ2V0KCldPy5ydW4oKTsgbGF1bmNoQ2xvc2UoKTsgcXVlcnkuc2V0KFwiXCIpOyByZXR1cm4gdHJ1ZVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfX0+XG4gICAgPHJldmVhbGVyXG4gICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQobGF1bmNoUmV2ZWFsZWQpfVxuICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldExhdW5jaFJldmVhbGVyKHIpfT5cbiAgICA8Ym94IGNsYXNzPVwic2hlZXQgbGF1bmNoZXJcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICAgIDxib3ggY2xhc3M9XCJmaWVsZFwiIHNwYWNpbmc9ezExfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbWFnbmlmeWluZy1nbGFzcy1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDxvdmVybGF5IGhleHBhbmQ+XG4gICAgICAgICAgPGVudHJ5XG4gICAgICAgICAgICBoZXhwYW5kXG4gICAgICAgICAgICBzZXR1cD17KHNlbGY6IGFueSkgPT4geyBzZWxmLnNldF9tYXhfd2lkdGhfY2hhcnMoMSk7IHNlbGYuc2V0X3dpZHRoX2NoYXJzKDEpIH19XG4gICAgICAgICAgICB0ZXh0PXtiaW5kKHF1ZXJ5KX1cbiAgICAgICAgICAgIG9uTm90aWZ5VGV4dD17ZSA9PiB7IHF1ZXJ5LnNldChlLnRleHQpOyBzZWxlY3RlZC5zZXQoMCkgfX0gLz5cbiAgICAgICAgICB7LyogcGxhY2Vob2xkZXIgYXMgYW4gT1ZFUkxBWSBsYWJlbCAobm90IGVudHJ5IHBsYWNlaG9sZGVyVGV4dCkgc28gaXRzIHRleHRcbiAgICAgICAgICAgICAgd2lkdGggY2FuJ3QgaW5mbGF0ZSB0aGUgZW50cnkncyBuYXR1cmFsIHNpemUgXHUyMTkyIHBhbmVsIHN0YXlzIGF0IG1pbi13aWR0aCAqL31cbiAgICAgICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cImxwbGFjZWhvbGRlclwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBlbGxpcHNpemU9ezN9IGhleHBhbmRcbiAgICAgICAgICAgIHZpc2libGU9e2JpbmQocXVlcnkpLmFzKHEgPT4gIXEpfVxuICAgICAgICAgICAgbGFiZWw9XCJTZWFyY2ggXHUyMDE0IGFwcHMsIGZpbGVzLCBhY3Rpb25zIFx1MDBCNyAnOicgY21kcyBcdTAwQjcgJz0nIG1hdGhzXCIgLz5cbiAgICAgICAgICA8bGFiZWwgdHlwZT1cIm92ZXJsYXlcIiBjbGFzcz1cImdob3N0XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICAgICAgICBsYWJlbD17YmluZChnaG9zdCkuYXMoZyA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHEgPSBxdWVyeS5nZXQoKVxuICAgICAgICAgICAgICByZXR1cm4gZy50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgocS50b0xvd2VyQ2FzZSgpKSAmJiBxID8gZyA6IFwiXCJcbiAgICAgICAgICAgIH0pfSAvPlxuICAgICAgICA8L292ZXJsYXk+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cImtiZFwiIGxhYmVsPVwic3VwZXJcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICA8L2JveD5cblxuICAgICAgey8qIGVtcHR5IHN0YXRlOiBjdXJhdGVkIGZyZWNlbmN5IHRpbGUgZ3JpZCArIHdpZGdldCByb3cgKi99XG4gICAgICA8cmV2ZWFsZXIgcmV2ZWFsQ2hpbGQ9e2JpbmQocXVlcnkpLmFzKHEgPT4gIXEudHJpbSgpKX0+XG4gICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICAgICAgPGJveCBjbGFzcz1cInRpbGVzXCIgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSBzcGFjaW5nPXs2fT5cbiAgICAgICAgICAgIHtncmlkVGlsZXMoYXBwcykubWFwKHQgPT5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInRpbGVcIiBvbkNsaWNrZWQ9eygpID0+IHsgdC5sYXVuY2goKTsgbGF1bmNoQ2xvc2UoKSB9fT5cbiAgICAgICAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9IGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICA8aW1hZ2UgY2xhc3M9XCJpY29uLXRpbGVcIiBpY29uTmFtZT17dC5pY29uTmFtZX0gcGl4ZWxTaXplPXszMH1cbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgICAgICA8bGFiZWwgbGFiZWw9e3QubmFtZX0gaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfVxuICAgICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9IG1heFdpZHRoQ2hhcnM9ezl9IC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgIDwvYnV0dG9uPil9XG4gICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgey8qIHR3byBjYXJkcyBzcGxpdCB0aGUgcm93IGV4YWN0bHkgaW4gaGFsZiBcdTIwMTQgcHJvdG8gZmxleDoxL2ZsZXg6MSAqL31cbiAgICAgICAgICA8Ym94IGNsYXNzPVwibHdpZGdldHNcIiBzcGFjaW5nPXs3fSBob21vZ2VuZW91cz5cbiAgICAgICAgICAgIHsvKiBsZWZ0IGNhcmQgXHUyMDE0IGRhdGUgKyB0b2RheSdzIGZpcnN0IGV2ZW50ICovfVxuICAgICAgICAgICAgPGJveCBjbGFzcz1cIndpZGdldCBsd1wiIGhleHBhbmQgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn1cbiAgICAgICAgICAgICAgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwidG5cIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3RvZGF5RGF0ZUxhYmVsKCl9IC8+XG4gICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImhpbnRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e3RvZGF5RXZlbnRMYWJlbCgpfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICB7LyogcmlnaHQgY2FyZCBcdTIwMTQgbWVkaWEgbWluaS1jYXJkOiBhcnQgXHUwMEI3IHRpdGxlL2FydGlzdCBcdTAwQjcgcGxheSAqL31cbiAgICAgICAgICAgIHsoKCkgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBtcHJpcyA9IE1wcmlzLmdldF9kZWZhdWx0KClcbiAgICAgICAgICAgICAgY29uc3QgYWN0aXZlUGxheWVyID0gYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKHBzID0+XG4gICAgICAgICAgICAgICAgcHMuZmluZChwID0+IHAucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXSA/PyBudWxsKVxuICAgICAgICAgICAgICBjb25zdCBtZWRpYVRpdGxlID0gREVNTyA/IEQubWVkaWEudGl0bGUgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMocHMgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBwcy5maW5kKHEgPT4gcS5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgcmV0dXJuIHA/LnRpdGxlID8/IFwiTm90aGluZyBwbGF5aW5nXCJcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgY29uc3QgbWVkaWFBcnRpc3QgPSBERU1PID8gRC5tZWRpYS5hcnRpc3QgOiBiaW5kKG1wcmlzLCBcInBsYXllcnNcIikuYXMocHMgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHAgPSBwcy5maW5kKHEgPT4gcS5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkcpID8/IHBzWzBdXG4gICAgICAgICAgICAgICAgcmV0dXJuIHA/LmFydGlzdCA/PyBcIlwiXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIGNvbnN0IHBsYXlJY29uID0gREVNTyA/IFwia29iZWwtcGxheS1zeW1ib2xpY1wiIDogYmluZChtcHJpcywgXCJwbGF5ZXJzXCIpLmFzKHBzID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBwID0gcHMuZmluZChxID0+IHEucGxheWJhY2tfc3RhdHVzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HKSA/PyBwc1swXVxuICAgICAgICAgICAgICAgIHJldHVybiBwPy5wbGF5YmFja19zdGF0dXMgPT09IE1wcmlzLlBsYXliYWNrU3RhdHVzLlBMQVlJTkdcbiAgICAgICAgICAgICAgICAgID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgcmV0dXJuIDxib3ggY2xhc3M9XCJ3aWRnZXQgbHdtXCIgaGV4cGFuZCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3YXJ0XCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCJcbiAgICAgICAgICAgICAgICAgICAgaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJveCBjbGFzcz1cImx3dFwiIGhleHBhbmQgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH1cbiAgICAgICAgICAgICAgICAgIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJtdGl0bGVcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17bWVkaWFUaXRsZX0gLz5cbiAgICAgICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImhpbnRcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17bWVkaWFBcnRpc3R9IC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm1idG4gcGxheVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICAgIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwicGxheWVyY3RsIHBsYXktcGF1c2VcIil9PlxuICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtwbGF5SWNvbn0gLz5cbiAgICAgICAgICAgICAgICA8L2J1dHRvbj5cbiAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICB9KSgpfVxuICAgICAgICAgIDwvYm94PlxuICAgICAgICA8L2JveD5cbiAgICAgIDwvcmV2ZWFsZXI+XG5cbiAgICAgIHsvKiByZXN1bHRzICovfVxuICAgICAgPGJveCBjbGFzcz1cImxyb3dzXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17Mn0+XG4gICAgICAgIHtzZWN0aW9ucy5hcyhzZWNzID0+IHNlY3MuZmxhdE1hcChzZWMgPT4gW1xuICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInNlY1wiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBsYWJlbD17c2VjLnNlY3Rpb259IC8+LFxuICAgICAgICAgIC4uLnNlYy5yb3dzLm1hcChyID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGZsYXRJZHggPSBzZWNzLmZsYXRNYXAocyA9PiBzLnJvd3MpLmluZGV4T2YocilcbiAgICAgICAgICAgIHJldHVybiA8YnV0dG9uXG4gICAgICAgICAgICAgIGNsYXNzPXtiaW5kKHNlbGVjdGVkKS5hcyhzID0+IHMgPT09IGZsYXRJZHggPyBcInJvdyBzZWxcIiA6IFwicm93XCIpfVxuICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHsgci5ydW4oKTsgbGF1bmNoQ2xvc2UoKSB9fT5cbiAgICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMX0+XG4gICAgICAgICAgICAgICAgey8qIDI4XHUwMEQ3MjggcjggcGFuZWwyIGZyYW1lIGFyb3VuZCB0aGUgMjRweCBpY29uIChwcm90b3R5cGUgLnJpKSAqL31cbiAgICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwicmlcIiB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9PlxuICAgICAgICAgICAgICAgICAgPGltYWdlIGljb25OYW1lPXtyLmljb259IHBpeGVsU2l6ZT17MjR9IC8+XG4gICAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD17ci5tYXJrdXB9IC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiaGludFwiIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgICAgICAgICBlbGxpcHNpemU9ezN9IGxhYmVsPXtyLmhpbnR9IC8+XG4gICAgICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwicnVua1wiIGxhYmVsPVwiXHUyMUI1XCJcbiAgICAgICAgICAgICAgICAgIHZpc2libGU9e2JpbmQoc2VsZWN0ZWQpLmFzKHMgPT4gcyA9PT0gZmxhdElkeCl9IC8+XG4gICAgICAgICAgICAgIDwvYm94PlxuICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgfSksXG4gICAgICAgIF0pKX1cbiAgICAgIDwvYm94PlxuXG4gICAgICB7LyogZm9vdGVyIGhpbnQgcm93IFx1MjAxNCBtYXRjaGVzIHByb3RvdHlwZSAubGZvb3QgKi99XG4gICAgICA8Ym94IGNsYXNzPVwibGZvb3RcIj5cbiAgICAgICAgPGJveCBzcGFjaW5nPXsxNH0gaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0+XG4gICAgICAgICAgPGxhYmVsIHVzZU1hcmt1cCBsYWJlbD1cIjxiPjpyZWxvYWQ8L2I+IHNvZnQtcmVsb2FkXCIgLz5cbiAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+Om9zZDwvYj4gdG9nZ2xlXCIgLz5cbiAgICAgICAgICA8bGFiZWwgdXNlTWFya3VwIGxhYmVsPVwiPGI+OmdyYW50czwvYj4gc2NyZWVuIGFjY2Vzc1wiIC8+XG4gICAgICAgIDwvYm94PlxuICAgICAgICA8bGFiZWwgbGFiZWw9XCJcdTIxOTFcdTIxOTMgc2VsZWN0IFx1MDBCNyBcdTIxQjUgcnVuXCIgaGFsaWduPXtHdGsuQWxpZ24uRU5EfSAvPlxuICAgICAgPC9ib3g+XG4gICAgPC9ib3g+XG4gICAgPC9yZXZlYWxlcj5cbiAgPC93aW5kb3c+XG59XG4iLCAiLy8gTGF1bmNoZXIgbWF0Y2hpbmcgXHUyMDE0IHN0cmFpZ2h0IHBvcnQgb2YgdGhlIHByb3RvdHlwZSAocG9zdC1jcml0aXF1ZSB2ZXJzaW9uKTpcbi8vIHN1YnNlcXVlbmNlIGZ1enp5IHdpdGggd29yZC1ib3VuZGFyeSBib251cywgY2FwcGVkIGxvZzIgZnJlY2VuY3ksIHByZWZpeCBnaG9zdC5cblxuaW1wb3J0IEdMaWIgZnJvbSBcImdpOi8vR0xpYlwiXG5cbmV4cG9ydCBpbnRlcmZhY2UgTWF0Y2ggeyBzY29yZTogbnVtYmVyOyBtYXJrczogbnVtYmVyW10gfVxuXG5leHBvcnQgZnVuY3Rpb24gZnV6enkocTogc3RyaW5nLCB0OiBzdHJpbmcpOiBNYXRjaCB8IG51bGwge1xuICBjb25zdCBxbCA9IHEudG9Mb3dlckNhc2UoKSwgdGwgPSB0LnRvTG93ZXJDYXNlKClcbiAgbGV0IHFpID0gMCwgc2NvcmUgPSAwLCBsYXN0ID0gLTJcbiAgY29uc3QgbWFya3M6IG51bWJlcltdID0gW11cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCB0bC5sZW5ndGggJiYgcWkgPCBxbC5sZW5ndGg7IGkrKykge1xuICAgIGlmICh0bFtpXSA9PT0gcWxbcWldKSB7XG4gICAgICBtYXJrcy5wdXNoKGkpXG4gICAgICBzY29yZSArPSAoaSA9PT0gMCB8fCBcIiAtXy4vXCIuaW5jbHVkZXModFtpIC0gMV0pKSA/IDQgOiAobGFzdCA9PT0gaSAtIDEgPyAyIDogMSlcbiAgICAgIGxhc3QgPSBpOyBxaSsrXG4gICAgfVxuICB9XG4gIHJldHVybiBxaSA9PT0gcWwubGVuZ3RoID8geyBzY29yZTogc2NvcmUgLSB0Lmxlbmd0aCAqIDAuMDIsIG1hcmtzIH0gOiBudWxsXG59XG5cbi8vIFBhbmdvIG1hcmt1cCBoaWdobGlnaHQgKGVzY2FwZXM7IGxlYWYgYWNjZW50IG9uIG1hdGNoZWQgY2hhcnMpXG5leHBvcnQgZnVuY3Rpb24gaGwodDogc3RyaW5nLCBtYXJrczogbnVtYmVyW10gfCBudWxsKTogc3RyaW5nIHtcbiAgY29uc3QgZXNjID0gKGM6IHN0cmluZykgPT4gR0xpYi5tYXJrdXBfZXNjYXBlX3RleHQoYywgLTEpXG4gIGlmICghbWFya3MpIHJldHVybiBlc2ModClcbiAgY29uc3QgbSA9IG5ldyBTZXQobWFya3MpXG4gIGxldCBvdXQgPSBcIlwiXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgdC5sZW5ndGg7IGkrKylcbiAgICBvdXQgKz0gbS5oYXMoaSkgPyBgPHNwYW4gZm9yZWdyb3VuZD1cIiNiNWNiNDhcIj4ke2VzYyh0W2ldKX08L3NwYW4+YCA6IGVzYyh0W2ldKVxuICByZXR1cm4gb3V0XG59XG5cbi8vIEZyZWNlbmN5OiBjYXBwZWQgc28gYW4gZXhhY3QgcHJlZml4IG1hdGNoIEFMV0FZUyBiZWF0cyBoYWJpdCAoY3JpdGlxdWUgQTIpLlxuY29uc3QgU1RPUkUgPSBgJHtHTGliLmdldF91c2VyX3N0YXRlX2RpcigpfS9rb2JlbC9mcmVxLmpzb25gXG5sZXQgZnJlcTogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9XG50cnkgeyBmcmVxID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoR0xpYi5maWxlX2dldF9jb250ZW50cyhTVE9SRSlbMV0pKSB9IGNhdGNoIHsgfVxuXG5leHBvcnQgY29uc3QgYm9vc3QgPSAoaWQ6IHN0cmluZykgPT4gTWF0aC5taW4oTWF0aC5sb2cyKDEgKyAoZnJlcVtpZF0gPz8gMCkpLCAzKVxuXG5leHBvcnQgZnVuY3Rpb24gYnVtcChpZDogc3RyaW5nKSB7XG4gIGZyZXFbaWRdID0gKGZyZXFbaWRdID8/IDApICsgMVxuICBHTGliLm1rZGlyX3dpdGhfcGFyZW50cyhHTGliLnBhdGhfZ2V0X2Rpcm5hbWUoU1RPUkUpLCAwbzc1NSlcbiAgR0xpYi5maWxlX3NldF9jb250ZW50cyhTVE9SRSwgSlNPTi5zdHJpbmdpZnkoZnJlcSkpXG59XG5cbmV4cG9ydCBjb25zdCBmcmVxdWVuY3kgPSAoaWQ6IHN0cmluZykgPT4gZnJlcVtpZF0gPz8gMFxuIiwgIi8vIENhbGVuZGFyIHBvcG92ZXIgXHUyMDE0IEdOT01FIHJlcGxpY2EgcGVyIHRoZSBwcm90b3R5cGU6IGhlcm8gZGF0ZSwgXHUyMDM5IG1vbnRoIFx1MjAzQSBuYXZcbi8vICh0aXRsZSBjbGljayA9IHRvZGF5KSwgSVNPIHdlZWsgbnVtYmVycyBhcyBxdWlldCBkaW0gdGV4dCwgRElNTUVEIFdFRUtFTkRTLFxuLy8gY2xpY2thYmxlIGRheXMgdy8gc2VsZWN0aW9uIHJpbmcgKGluayByaW5nIG9uIHRvZGF5KSwgZXZlbnQtZG90IG1hcmtlcnMsXG4vLyBldmVudHMgY2FyZCBpbiB0aGUgbm90aWZpY2F0aW9uLWNhcmQgbGFuZ3VhZ2UuIE1vbnRocyBzbGlkZSAobXVsdGl2aWV3IG1vdGlvbikuXG5pbXBvcnQgeyBBc3RhbCwgR2RrLCBHdGsgfSBmcm9tIFwiYXN0YWwvZ3RrNFwiXG5pbXBvcnQgeyBWYXJpYWJsZSwgYmluZCwgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgeyBERU1PLCBEIH0gZnJvbSBcIi4uL2xpYi9kZW1vXCJcbmltcG9ydCB7IG1ha2VSZXZlYWwsIHJlZ2lzdGVyIH0gZnJvbSBcIi4uL2xpYi9zdXJmYWNlXCJcblxuaW50ZXJmYWNlIEV2IHsgdDogc3RyaW5nOyBuOiBzdHJpbmc7IGljb246IHN0cmluZyB9XG4vLyBcInRvZGF5XCIgXHUyMDE0IHVuZGVyIEtPQkVMX0RFTU8sIHBpbm5lZCB0byBELnRvZGF5OyByZWFsIGNsb2NrIG90aGVyd2lzZS5cbi8vIHRvZGF5VmFyIHBvbGxzIGV2ZXJ5IDYwcyBzbyB0aGUgaGVybyBkYXRlIHVwZGF0ZXMgd2l0aG91dCBhIHJlbG9hZC5cbmNvbnN0IHRvZGF5VmFyID0gREVNT1xuICA/IFZhcmlhYmxlKG5ldyBEYXRlKEQudG9kYXkueSwgRC50b2RheS5tLCBELnRvZGF5LmQpKVxuICA6IFZhcmlhYmxlKG5ldyBEYXRlKCkpLnBvbGwoNjBfMDAwLCAoKSA9PiBuZXcgRGF0ZSgpKVxuY29uc3Qgbm93ID0gdG9kYXlWYXIuZ2V0KClcbmNvbnN0IGtleSA9ICh5OiBudW1iZXIsIG06IG51bWJlciwgZDogbnVtYmVyKSA9PiBgJHt5fS0ke20gKyAxfS0ke2R9YFxuZXhwb3J0IGNvbnN0IEVWRU5UUzogUmVjb3JkPHN0cmluZywgRXZbXT4gPSB7XG4gIFtrZXkobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpKV06XG4gICAgW3sgdDogXCIwOTo0NVwiLCBuOiBcIkRhaWx5IFN0YW5kdXBcIiwgaWNvbjogXCJrb2JlbC12aWRlby1zeW1ib2xpY1wiIH1dLFxuICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMTEpXTpcbiAgICBbeyB0OiBcIjEwOjMwXCIsIG46IFwiS2llcmFuIEJpcnRoZGF5XCIsIGljb246IFwia29iZWwtY2FrZS1zeW1ib2xpY1wiIH0sXG4gICAgIHsgdDogXCIxMzowMFwiLCBuOiBcIkxvbmRvbiBUaGluZ1wiLCBpY29uOiBcImtvYmVsLXBpbi1zeW1ib2xpY1wiIH1dLFxuICBba2V5KG5vdy5nZXRGdWxsWWVhcigpLCBub3cuZ2V0TW9udGgoKSwgMTMpXTpcbiAgICBbeyB0OiBcIkFsbCBkYXlcIiwgbjogXCJNeSBCaXJ0aGRheVwiLCBpY29uOiBcImtvYmVsLWNha2Utc3ltYm9saWNcIiB9XSxcbn1cblxuY29uc3QgdmlldyA9IFZhcmlhYmxlKHsgeTogbm93LmdldEZ1bGxZZWFyKCksIG06IG5vdy5nZXRNb250aCgpIH0pXG5jb25zdCBzZWwgPSBWYXJpYWJsZShuZXcgRGF0ZShub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpKVxuXG5mdW5jdGlvbiBpc29XZWVrKGQ6IERhdGUpOiBudW1iZXIge1xuICBjb25zdCB0ID0gbmV3IERhdGUoRGF0ZS5VVEMoZC5nZXRGdWxsWWVhcigpLCBkLmdldE1vbnRoKCksIGQuZ2V0RGF0ZSgpKSlcbiAgY29uc3QgZG4gPSAodC5nZXRVVENEYXkoKSArIDYpICUgN1xuICB0LnNldFVUQ0RhdGUodC5nZXRVVENEYXRlKCkgLSBkbiArIDMpXG4gIGNvbnN0IGYgPSBuZXcgRGF0ZShEYXRlLlVUQyh0LmdldFVUQ0Z1bGxZZWFyKCksIDAsIDQpKVxuICByZXR1cm4gMSArIE1hdGgucm91bmQoKCgrdCAtICtmKSAvIDg2NGU1IC0gMyArICgoZi5nZXRVVENEYXkoKSArIDYpICUgNykpIC8gNylcbn1cblxuZnVuY3Rpb24gR3JpZCgpIHtcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJjYWwtZ3JpZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9PlxuICAgIHtiaW5kKFZhcmlhYmxlLmRlcml2ZShbdmlldywgc2VsXSwgKHYsIHMpID0+ICh7IHYsIHMgfSkpKS5hcygoeyB2LCBzIH0pID0+IHtcbiAgICAgIGNvbnN0IGZpcnN0ID0gbmV3IERhdGUodi55LCB2Lm0sIDEpXG4gICAgICBjb25zdCBzdGFydCA9IChmaXJzdC5nZXREYXkoKSArIDYpICUgN1xuICAgICAgY29uc3QgZGF5cyA9IG5ldyBEYXRlKHYueSwgdi5tICsgMSwgMCkuZ2V0RGF0ZSgpXG4gICAgICBjb25zdCBwcmV2RGF5cyA9IG5ldyBEYXRlKHYueSwgdi5tLCAwKS5nZXREYXRlKClcbiAgICAgIGNvbnN0IHJvd3MgPSBbXVxuICAgICAgcm93cy5wdXNoKDxib3ggaG9tb2dlbmVvdXM+XG4gICAgICAgIHtbXCJcIiwgXCJNXCIsIFwiVFwiLCBcIldcIiwgXCJUXCIsIFwiRlwiLCBcIlNcIiwgXCJTXCJdLm1hcChkID0+XG4gICAgICAgICAgPGxhYmVsIGNsYXNzPVwiZG93XCIgbGFiZWw9e2R9IC8+KX1cbiAgICAgIDwvYm94PilcbiAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgNjsgcisrKSB7XG4gICAgICAgIGNvbnN0IGNlbGxzID0gWzxsYWJlbCBjbGFzcz1cIndrIHRuXCJcbiAgICAgICAgICBsYWJlbD17YCR7aXNvV2VlayhuZXcgRGF0ZSh2LnksIHYubSwgciAqIDcgLSBzdGFydCArIDEpKX1gfSAvPl1cbiAgICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCA3OyBjKyspIHtcbiAgICAgICAgICBjb25zdCBpID0gciAqIDcgKyBjLCBkID0gaSAtIHN0YXJ0ICsgMVxuICAgICAgICAgIGNvbnN0IG91dCA9IGQgPCAxIHx8IGQgPiBkYXlzXG4gICAgICAgICAgY29uc3QgbGFiZWwgPSBvdXQgPyAoZCA8IDEgPyBwcmV2RGF5cyArIGQgOiBkIC0gZGF5cykgOiBkXG4gICAgICAgICAgY29uc3QgY2xzID0gW1wiZGF5XCJdXG4gICAgICAgICAgaWYgKGMgPj0gNSkgY2xzLnB1c2goXCJ3ZVwiKSAgICAgICAgICAgICAgICAgICAgICAgLy8gV0VFS0VORFMgRElNTUVEXG4gICAgICAgICAgaWYgKG91dCkgY2xzLnB1c2goXCJvdXRcIilcbiAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHRvZGF5ID0gbm93XG4gICAgICAgICAgICBpZiAoZCA9PT0gdG9kYXkuZ2V0RGF0ZSgpICYmIHYubSA9PT0gdG9kYXkuZ2V0TW9udGgoKSAmJiB2LnkgPT09IHRvZGF5LmdldEZ1bGxZZWFyKCkpXG4gICAgICAgICAgICAgIGNscy5wdXNoKFwidG9kYXlcIilcbiAgICAgICAgICAgIGlmIChFVkVOVFNba2V5KHYueSwgdi5tLCBkKV0pIGNscy5wdXNoKFwiZXZcIikgICAvLyBldmVudC1kb3QgKENTUyA6OmFmdGVyIFx1MjE5MiB1bmRlcmxpbmUgZG90KVxuICAgICAgICAgICAgaWYgKHMuZ2V0RGF0ZSgpID09PSBkICYmIHMuZ2V0TW9udGgoKSA9PT0gdi5tICYmIHMuZ2V0RnVsbFllYXIoKSA9PT0gdi55KVxuICAgICAgICAgICAgICBjbHMucHVzaChcInNlbFwiKVxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBoYXNFdiA9ICFvdXQgJiYgISFFVkVOVFNba2V5KHYueSwgdi5tLCBkKV1cbiAgICAgICAgICAvLyBkYXkgc2l0cyBhdCBpdHMgbmF0dXJhbCAyNFx1MDBENzI0IGNlbnRyZWQgaW4gdGhlIGdyaWQgY29sdW1uIChub3QgZmlsbGluZyBpdCksXG4gICAgICAgICAgLy8gc28gdG9kYXkncyBsZWFmIGZpbGwgaXMgYSB0aWdodCBjaXJjbGUgcmF0aGVyIHRoYW4gYSBjb2x1bW4td2lkZSBvdmFsXG4gICAgICAgICAgY2VsbHMucHVzaChvdXRcbiAgICAgICAgICAgID8gPGxhYmVsIGNsYXNzPXtjbHMuam9pbihcIiBcIil9IGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gbGFiZWw9e2Ake2xhYmVsfWB9IC8+XG4gICAgICAgICAgICA6IDxidXR0b24gY2xhc3M9e2Nscy5qb2luKFwiIFwiKX1cbiAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn1cbiAgICAgICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHNlbC5zZXQobmV3IERhdGUodi55LCB2Lm0sIGQpKX0+XG4gICAgICAgICAgICAgICAge2hhc0V2XG4gICAgICAgICAgICAgICAgICA/IDxvdmVybGF5PlxuICAgICAgICAgICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD17YCR7bGFiZWx9YH0gLz5cbiAgICAgICAgICAgICAgICAgICAgICB7LyogM3B4IGV2ZW50IGRvdCwgYWJzb2x1dGUgYm90dG9tLWNlbnRlciAoR1RLIGhhcyBubyA6OmFmdGVyKSAqL31cbiAgICAgICAgICAgICAgICAgICAgICA8Ym94IHR5cGU9XCJvdmVybGF5XCIgY2xhc3M9XCJldmRvdFwiXG4gICAgICAgICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkVORH0gLz5cbiAgICAgICAgICAgICAgICAgICAgPC9vdmVybGF5PlxuICAgICAgICAgICAgICAgICAgOiA8bGFiZWwgbGFiZWw9e2Ake2xhYmVsfWB9IC8+fVxuICAgICAgICAgICAgICA8L2J1dHRvbj4pXG4gICAgICAgIH1cbiAgICAgICAgcm93cy5wdXNoKDxib3ggaG9tb2dlbmVvdXM+e2NlbGxzfTwvYm94PilcbiAgICAgIH1cbiAgICAgIHJldHVybiByb3dzXG4gICAgfSl9XG4gIDwvYm94PlxufVxuXG5mdW5jdGlvbiBFdmVudHNDYXJkKCkge1xuICAvLyBQcm90b3R5cGUgLmNhbGV2OiBhIHBhbmVsMiBjYXJkIChwYWQxMC9yMTIpIHdyYXBwaW5nIHRoZSBkYXRlIGhlYWRlciArIGRhcmtlclxuICAvLyAoLS1wYW5lbCkgZXZlbnQgcm93czsgaGVhZGVyJ3Mgb3duIGJvdHRvbSBwYWRkaW5nIGlzIHRoZSBoZWFkZXJcdTIxOTJyb3cgZ2FwIChzcGFjaW5nIDApLlxuICByZXR1cm4gPGJveCBjbGFzcz1cImV2Y2FyZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgIHtiaW5kKHNlbCkuYXMoZCA9PiB7XG4gICAgICBjb25zdCBldnMgPSBFVkVOVFNba2V5KGQuZ2V0RnVsbFllYXIoKSwgZC5nZXRNb250aCgpLCBkLmdldERhdGUoKSldID8/IFtdXG4gICAgICBjb25zdCBoZWFkID0gPGxhYmVsIGNsYXNzPVwiZXZoZWFkXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgIGxhYmVsPXtkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIsIGRheTogXCJudW1lcmljXCIsIG1vbnRoOiBcImxvbmdcIiB9KX0gLz5cbiAgICAgIGlmICghZXZzLmxlbmd0aCkgcmV0dXJuIFtoZWFkLFxuICAgICAgICA8Ym94IHNwYWNpbmc9ezh9PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNhbGVuZGFyLXN5bWJvbGljXCIgLz5cbiAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJzdWJcIiBsYWJlbD1cIk5vIGV2ZW50c1wiIC8+PC9ib3g+XVxuICAgICAgcmV0dXJuIFtoZWFkLCAuLi5ldnMubWFwKGUgPT5cbiAgICAgICAgPGJveCBjbGFzcz1cImV2cm93XCIgc3BhY2luZz17MTB9PlxuICAgICAgICAgIHsvKiAyNlx1MDBENzI2IHI4IGNvbG9yZWQgaWNvbiB0aWxlIChwcm90b3R5cGUgLmV2aWMpLCB3aGl0ZSBnbHlwaCAqL31cbiAgICAgICAgICA8Ym94IGNsYXNzPVwiZXZpY1wiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e2UuaWNvbn0gLz48L2JveD5cbiAgICAgICAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtlLm59IC8+XG4gICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJzdWIgdG5cIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2UudH0gLz5cbiAgICAgICAgICA8L2JveD5cbiAgICAgICAgPC9ib3g+KV1cbiAgICB9KX1cbiAgPC9ib3g+XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIENhbGVuZGFyKCkge1xuICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjIwLCAxNTApXG4gIHJlZ2lzdGVyKFwiY2FsZW5kYXJcIiwgdG9nZ2xlRm4pXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cImNhbGVuZGFyXCIgbmFtZXNwYWNlPVwia29iZWwtY2FsZW5kYXJcIiBjbGFzcz1cImNhbGVuZGFyLXdpbmRvd1wiXG4gICAgdmlzaWJsZT17YmluZCh3aW5WaXNpYmxlKX1cbiAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1B9IGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9IGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgIG9uS2V5UHJlc3NlZD17KF9zZWxmLCBrZXkpID0+IGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoY2xvc2UoKSwgdHJ1ZSkgOiBmYWxzZX0+XG4gICAgPHJldmVhbGVyXG4gICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlJldmVhbGVyVHJhbnNpdGlvblR5cGUuU0xJREVfRE9XTn1cbiAgICAgIHRyYW5zaXRpb25EdXJhdGlvbj17MjIwfVxuICAgICAgcmV2ZWFsQ2hpbGQ9e2JpbmQocmV2ZWFsZWQpfVxuICAgICAgc2V0dXA9eyhyOiBHdGsuUmV2ZWFsZXIpID0+IHNldFJldmVhbGVyKHIpfT5cbiAgICA8Ym94IGNsYXNzPVwic2hlZXQgY2FsXCIgb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17MH0+XG4gICAgICA8Ym94IGNsYXNzPVwiY2FsaGVyb1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9PlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJzdWJcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH1cbiAgICAgICAgICBsYWJlbD17YmluZCh0b2RheVZhcikuYXMoZCA9PiBkLnRvTG9jYWxlRGF0ZVN0cmluZyhcImVuLUdCXCIsIHsgd2Vla2RheTogXCJsb25nXCIgfSkpfSAvPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJoZXJvXCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICAgICAgbGFiZWw9e2JpbmQodG9kYXlWYXIpLmFzKGQgPT4gZC50b0xvY2FsZURhdGVTdHJpbmcoXCJlbi1HQlwiLCB7IGRheTogXCJudW1lcmljXCIsIG1vbnRoOiBcImxvbmdcIiwgeWVhcjogXCJudW1lcmljXCIgfSkpfSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8Y2VudGVyYm94PlxuICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgdmlldy5zZXQodi5tID8geyB5OiB2LnksIG06IHYubSAtIDEgfSA6IHsgeTogdi55IC0gMSwgbTogMTEgfSlcbiAgICAgICAgfX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1sZWZ0LXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cIm1vbnRoXCIgb25DbGlja2VkPXsoKSA9PlxuICAgICAgICAgIHZpZXcuc2V0KHsgeTogbm93LmdldEZ1bGxZZWFyKCksIG06IG5vdy5nZXRNb250aCgpIH0pfT5cbiAgICAgICAgICA8bGFiZWwgbGFiZWw9e2JpbmQodmlldykuYXModiA9PlxuICAgICAgICAgICAgbmV3IERhdGUodi55LCB2Lm0pLnRvTG9jYWxlU3RyaW5nKFwiZW5cIiwgeyBtb250aDogXCJsb25nXCIgfSlcbiAgICAgICAgICAgICsgKHYueSAhPT0gbm93LmdldEZ1bGxZZWFyKCkgPyBgICR7di55fWAgOiBcIlwiKSl9IC8+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHYgPSB2aWV3LmdldCgpXG4gICAgICAgICAgdmlldy5zZXQodi5tID09PSAxMSA/IHsgeTogdi55ICsgMSwgbTogMCB9IDogeyB5OiB2LnksIG06IHYubSArIDEgfSlcbiAgICAgICAgfX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtY2hldnJvbi1yaWdodC1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8L2NlbnRlcmJveD5cbiAgICAgIDxHcmlkIC8+XG4gICAgICA8RXZlbnRzQ2FyZCAvPlxuICAgIDwvYm94PlxuICAgIDwvcmV2ZWFsZXI+XG4gIDwvd2luZG93PlxufVxuIiwgIi8vIFF1aWNrIHNldHRpbmdzLiBQcm90b3R5cGUtZmluYWw6IHVuaWZvcm0gcGlsbCB0aWxlcyBmcm9tIGEgQ0FUQUxPRyAoY3VzdG9taXNhYmxlLFxuLy8gcGVyc2lzdGVkKSwgR05PTUUgdGhpbiBzbGlkZXJzLCBkcmlsbGRvd25zIGFzIGEgc3ByaW5nLXNsaWQgdHdvLXZpZXcgc3RhY2tcbi8vIChXaS1GaSBuZXR3b3JrcyAvIEJUIGRldmljZXMgLyBwZXItYXBwIG1peGVyIHdpdGggYSBNYXN0ZXIgcm93KSwgY29tcGFjdCB0b3Agcm93XG4vLyAoYmF0dGVyeSBcdTAwQjcgcGVuY2lsL2xlYWYvbG9jay9wb3dlciksIGdub2JsaW4gYmFubmVyICsgcmVjb25uZWN0IHdoaWxlIGRlZ3JhZGVkLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIGV4ZWNBc3luYywgR0xpYiB9IGZyb20gXCJhc3RhbFwiXG5pbXBvcnQgTmV0d29yayBmcm9tIFwiZ2k6Ly9Bc3RhbE5ldHdvcmtcIlxuaW1wb3J0IEJsdWV0b290aCBmcm9tIFwiZ2k6Ly9Bc3RhbEJsdWV0b290aFwiXG5pbXBvcnQgV3AgZnJvbSBcImdpOi8vQXN0YWxXcFwiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5pbXBvcnQgR2lvIGZyb20gXCJnaTovL0dpb1wiXG5pbXBvcnQgQmF0dGVyeSBmcm9tIFwiZ2k6Ly9Bc3RhbEJhdHRlcnlcIlxuaW1wb3J0IHsgY29ubmVjdGVkLCByZWxvYWQgfSBmcm9tIFwiLi4vc2VydmljZXMvZ25vYmxpblwiXG5pbXBvcnQgeyBNT1RJT04gfSBmcm9tIFwiLi4vbGliL3NwcmluZ1wiXG5pbXBvcnQgeyBtYWtlUmV2ZWFsLCByZWdpc3RlciwgdG9nZ2xlIGFzIHN1cmZhY2VUb2dnbGUgfSBmcm9tIFwiLi4vbGliL3N1cmZhY2VcIlxuaW1wb3J0IHsgREVNTywgRCB9IGZyb20gXCIuLi9saWIvZGVtb1wiXG5pbXBvcnQgeyBUaW55U2xpZGVyIH0gZnJvbSBcIi4uL2xpYi90aW55c2xpZGVyXCJcbmltcG9ydCB7IEZpeGVkQ2hldiB9IGZyb20gXCIuLi9saWIvZml4ZWRjaGV2XCJcblxudHlwZSBEcmlsbCA9IG51bGwgfCBcIndpZmlcIiB8IFwiYnRcIiB8IFwibWl4XCJcbi8vIEtPQkVMX0RSSUxMIGxldHMgdGhlIGRldmtpdCByZW5kZXIgYSBkcmlsbGRvd24gZGlyZWN0bHkgKG5vIHBvaW50ZXIgdG8gY2xpY2sgdGhlXG4vLyBjaGV2cm9uIGluIGhlYWRsZXNzKTsgcHJvZHVjdGlvbiBkZWZhdWx0IGlzIG51bGwuXG5jb25zdCBkcmlsbCA9IFZhcmlhYmxlPERyaWxsPigoR0xpYi5nZXRlbnYoXCJLT0JFTF9EUklMTFwiKSBhcyBEcmlsbCkgfHwgbnVsbClcblxuLy8gVGlsZSBjYXRhbG9nIFx1MjAxNCBtaXJyb3JzIHByb3RvdHlwZSBDQVRBTE9HOyBwZXJzaXN0ZWQgbGF5b3V0IGluIHN0YXRlIGRpci5cbmNvbnN0IFNUT1JFID0gYCR7R0xpYi5nZXRfdXNlcl9zdGF0ZV9kaXIoKX0va29iZWwvcXMtdGlsZXMuanNvbmBcbmxldCB0aWxlczogc3RyaW5nW10gPSBbXCJ3aWZpXCIsIFwiYnRcIiwgXCJzYXZlXCIsIFwiZGFya1wiLCBcInNpbGVudFwiLCBcIm5pZ2h0XCIsIFwidm9sdW1lXCIsIFwiYnJpZ2h0bmVzc1wiXVxudHJ5IHsgdGlsZXMgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShHTGliLmZpbGVfZ2V0X2NvbnRlbnRzKFNUT1JFKVsxXSkpIH0gY2F0Y2ggeyB9XG5cbmZ1bmN0aW9uIENoaXAocHJvcHM6IHtcbiAgaWQ6IHN0cmluZywgbGFiZWw6IHN0cmluZywgaWNvbjogc3RyaW5nLFxuICBhY3RpdmU6IGFueSwgc3ViPzogYW55LCBvblRvZ2dsZWQ6ICgpID0+IHZvaWQsIG9uRHJpbGw/OiAoKSA9PiB2b2lkLFxufSkge1xuICByZXR1cm4gPGJveCBjbGFzcz17YmluZChwcm9wcy5hY3RpdmUpLmFzKChhOiBib29sZWFuKSA9PiBhID8gXCJjaGlwIHBpbGwgb25cIiA6IFwiY2hpcCBwaWxsXCIpfT5cbiAgICA8YnV0dG9uIGNsYXNzPVwiY2hpcGJcIiBoZXhwYW5kPXt0cnVlfSBvbkNsaWNrZWQ9e3Byb3BzLm9uVG9nZ2xlZH0+XG4gICAgICA8Ym94IHNwYWNpbmc9ezl9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9e3Byb3BzLmljb259IC8+XG4gICAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICA8bGFiZWwgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtwcm9wcy5sYWJlbH0gLz5cbiAgICAgICAgICB7cHJvcHMuc3ViICYmIDxsYWJlbCBjbGFzcz1cInN1YlwiIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfVxuICAgICAgICAgICAgZWxsaXBzaXplPXszfSBsYWJlbD17cHJvcHMuc3VifSAvPn1cbiAgICAgICAgPC9ib3g+XG4gICAgICA8L2JveD5cbiAgICA8L2J1dHRvbj5cbiAgICB7LyogZml4ZWQgMzJweCBzZWFtK2NoZXZyb24gKHByb3RvIC5jaGV2YikgXHUyMDE0IGhleHBhbmQ9ZmFsc2Ugc28gdGhlIG1haW4gYnV0dG9uIG93bnMgc2xhY2sgKi99XG4gICAge3Byb3BzLm9uRHJpbGwgJiZcbiAgICAgIDxidXR0b24gY2xhc3M9XCJjaGV2XCIgaGV4cGFuZD17ZmFsc2V9IHdpZHRoUmVxdWVzdD17MzJ9IG9uQ2xpY2tlZD17cHJvcHMub25EcmlsbH0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgPC9idXR0b24+fVxuICA8L2JveD5cbn1cblxuZnVuY3Rpb24gU2xpZGVycygpIHtcbiAgY29uc3Qgc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG4gIC8vIEluIERFTU8gbW9kZSByZW5kZXIgdGhlIHR3byBzbGlkZXJzIHJlZ2FyZGxlc3Mgb2YgYSByZWFsIHNwZWFrZXIsIHBpbm5lZCB0byB0aGVcbiAgLy8gcHJvdG90eXBlJ3MgbW9jayB2YWx1ZXMgKHZvbHVtZSAwLjY0LCBicmlnaHRuZXNzIDAuODApIGZvciBhIGZhaXIgb3ZlcmxheS5cbiAgaWYgKCFzcGVha2VyICYmICFERU1PKSByZXR1cm4gPGJveCAvPlxuICBjb25zdCB2b2xJY29uID0gc3BlYWtlclxuICAgID8gYmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpLmFzKGkgPT4gaSA/PyBcImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiKVxuICAgIDogXCJrb2JlbC1zcGVha2VyLXdhdmUtc3ltYm9saWNcIlxuICBjb25zdCB2b2xWYWx1ZTogYW55ID0gREVNTyA/IEQudm9sdW1lIDogYmluZChzcGVha2VyISwgXCJ2b2x1bWVcIilcbiAgLy8gcHJvdG8gLnNsaWRlcnMgaXMgYSBmbGV4IGNvbHVtbiB3aXRoIE5PIGdhcCBiZXR3ZWVuIHRoZSB0d28gc3Jvd3MgKGVhY2ggbWluLWggNDIpLlxuICAvLyBUaW55U2xpZGVyIG92ZXJyaWRlcyB2ZnVuY19tZWFzdXJlIHRvIHJlcG9ydCBuYXR1cmFsPTFweCBzbyB0aGUgc3JvdyBkb2Vzbid0XG4gIC8vIGluZmxhdGUgdGhlIHBhbmVsIGJleW9uZCB0aGUgY2hpcC1ncmlkIHdpZHRoIChHVEsgQ1NTIG1heC13aWR0aCBpcyBub3QgcmVzcGVjdGVkKS5cbiAgY29uc3QgaW5pdFZvbCA9IERFTU8gPyBELnZvbHVtZSA6IChzcGVha2VyPy52b2x1bWUgPz8gMC42NClcbiAgY29uc3Qgdm9sU2xpZGVyID0gbmV3IFRpbnlTbGlkZXIoeyBoZXhwYW5kOiB0cnVlLCBjc3NDbGFzc2VzOiBbXCJzbGlkZXJcIl0sIHZhbHVlOiBpbml0Vm9sIH0pXG4gIGlmICghREVNTyAmJiBzcGVha2VyKSBiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpLnN1YnNjcmliZSgodjogbnVtYmVyKSA9PiB7IHZvbFNsaWRlci5nZXRfYWRqdXN0bWVudCgpLnZhbHVlID0gdiB9KVxuICAvLyBHdGtSYW5nZTo6Y2hhbmdlLXZhbHVlIGFyZ3M6IChyYW5nZSwgc2Nyb2xsVHlwZSwgdmFsdWUpXG4gIHZvbFNsaWRlci5jb25uZWN0KFwiY2hhbmdlLXZhbHVlXCIsIChfczogYW55LCBfdDogYW55LCB2OiBudW1iZXIpID0+IHsgaWYgKHNwZWFrZXIpIHNwZWFrZXIudm9sdW1lID0gdiB9KVxuXG4gIGNvbnN0IGJyaWdodFZhbHVlID0gVmFyaWFibGUoREVNTyA/IEQuYnJpZ2h0bmVzcyA6IDAuOClcbiAgaWYgKCFERU1PKSB7XG4gICAgUHJvbWlzZS5hbGwoW2V4ZWNBc3luYyhcImJyaWdodG5lc3NjdGwgZ2V0XCIpLCBleGVjQXN5bmMoXCJicmlnaHRuZXNzY3RsIG1heFwiKV0pXG4gICAgICAudGhlbigoW2N1ciwgbWF4XSkgPT4gYnJpZ2h0VmFsdWUuc2V0KHBhcnNlSW50KGN1ci50cmltKCkpIC8gcGFyc2VJbnQobWF4LnRyaW0oKSkpKVxuICAgICAgLmNhdGNoKCgpID0+IHsgLyogYnJpZ2h0bmVzc2N0bCBhYnNlbnQgb24gZGVza3RvcCAqLyB9KVxuICB9XG4gIGNvbnN0IGJyaWdodFNsaWRlciA9IG5ldyBUaW55U2xpZGVyKHsgaGV4cGFuZDogdHJ1ZSwgY3NzQ2xhc3NlczogW1wic2xpZGVyXCJdLCB2YWx1ZTogYnJpZ2h0VmFsdWUuZ2V0KCkgfSlcbiAgYnJpZ2h0VmFsdWUuc3Vic2NyaWJlKHYgPT4geyBicmlnaHRTbGlkZXIuZ2V0X2FkanVzdG1lbnQoKS52YWx1ZSA9IHYgfSlcbiAgYnJpZ2h0U2xpZGVyLmNvbm5lY3QoXCJjaGFuZ2UtdmFsdWVcIiwgKF9zOiBhbnksIF90OiBhbnksIHY6IG51bWJlcikgPT5cbiAgICBleGVjQXN5bmMoYGJyaWdodG5lc3NjdGwgc2V0ICR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYClcbiAgICAgIC50aGVuKCgpID0+IGJyaWdodFZhbHVlLnNldCh2KSkuY2F0Y2goKCkgPT4ge30pKVxuXG4gIHJldHVybiA8Ym94IGNsYXNzPVwic2xpZGVyc1wiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezB9PlxuICAgIDxib3ggY2xhc3M9XCJzcm93XCIgc3BhY2luZz17OX0+XG4gICAgICA8aW1hZ2UgaWNvbk5hbWU9e3ZvbEljb259IC8+XG4gICAgICB7dm9sU2xpZGVyfVxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImNoZXZcIiB3aWR0aFJlcXVlc3Q9ezMxfSBvbkNsaWNrZWQ9eygpID0+IGRyaWxsLnNldChcIm1peFwiKX0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWNoZXZyb24tcmlnaHQtc3ltYm9saWNcIiAvPlxuICAgICAgPC9idXR0b24+XG4gICAgPC9ib3g+XG4gICAgPGJveCBjbGFzcz1cInNyb3dcIiBzcGFjaW5nPXs5fT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLWJyaWdodG5lc3Mtc3ltYm9saWNcIiAvPlxuICAgICAge2JyaWdodFNsaWRlcn1cbiAgICAgIHsvKiBndXR0ZXI6IHdpZHRoUmVxdWVzdD0xNyArIH4xM3B4IEFkd2FpdGEgb3ZlcmhlYWQgXHUyMjQ4IDMwcHgsIG1hdGNoaW5nIGNoZXYgd2lkdGggKi99XG4gICAgICA8Ym94IHdpZHRoUmVxdWVzdD17MTd9IC8+XG4gICAgPC9ib3g+XG4gIDwvYm94PlxufVxuXG5mdW5jdGlvbiBHbm9ibGluQmFubmVyKCkge1xuICByZXR1cm4gPGJveCBjbGFzcz1cImdiYW5uZXJcIiB2aXNpYmxlPXtERU1PID8gZmFsc2UgOiBiaW5kKGNvbm5lY3RlZCkuYXMoYyA9PiAhYyl9IHNwYWNpbmc9ezEwfT5cbiAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC13YXJuaW5nLXN5bWJvbGljXCIgLz5cbiAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQ+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJ0XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPVwib3JnLmdub2JsaW4uU2hlbGwgZGlzY29ubmVjdGVkXCIgLz5cbiAgICAgIDxsYWJlbCBjbGFzcz1cInNcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJvc2QgKyBub3RpZnMgaGFuZGVkIGJhY2sgdG8gZ25vbWVcIiAvPlxuICAgIDwvYm94PlxuICAgIDxidXR0b24gY2xhc3M9XCJnYnRuXCIgbGFiZWw9XCJSZWNvbm5lY3RcIiBvbkNsaWNrZWQ9eygpID0+IHJlbG9hZCgpLmNhdGNoKCgpID0+IHsgfSl9IC8+XG4gIDwvYm94PlxufVxuXG4vLyBcdTI1MDBcdTI1MDAgcmVhbC1iYWNrZW5kIHRvZ2dsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4vLyBEYXJrIFN0eWxlOiBvcmcuZ25vbWUuZGVza3RvcC5pbnRlcmZhY2UgY29sb3Itc2NoZW1lXG5jb25zdCBpZmFjZVNldHRpbmdzID0gbmV3IEdpby5TZXR0aW5ncyh7IHNjaGVtYTogXCJvcmcuZ25vbWUuZGVza3RvcC5pbnRlcmZhY2VcIiB9KVxuY29uc3QgdERhcmsgPSBWYXJpYWJsZShpZmFjZVNldHRpbmdzLmdldF9zdHJpbmcoXCJjb2xvci1zY2hlbWVcIikgPT09IFwicHJlZmVyLWRhcmtcIilcbmlmYWNlU2V0dGluZ3MuY29ubmVjdChcImNoYW5nZWQ6OmNvbG9yLXNjaGVtZVwiLCAoKSA9PlxuICB0RGFyay5zZXQoaWZhY2VTZXR0aW5ncy5nZXRfc3RyaW5nKFwiY29sb3Itc2NoZW1lXCIpID09PSBcInByZWZlci1kYXJrXCIpKVxuXG4vLyBOaWdodCBMaWdodDogb3JnLmdub21lLnNldHRpbmdzLWRhZW1vbi5wbHVnaW5zLmNvbG9yXG5sZXQgY29sb3JTZXR0aW5nczogR2lvLlNldHRpbmdzIHwgbnVsbCA9IG51bGxcbmNvbnN0IHROaWdodCA9IFZhcmlhYmxlKGZhbHNlKVxudHJ5IHtcbiAgY29sb3JTZXR0aW5ncyA9IG5ldyBHaW8uU2V0dGluZ3MoeyBzY2hlbWE6IFwib3JnLmdub21lLnNldHRpbmdzLWRhZW1vbi5wbHVnaW5zLmNvbG9yXCIgfSlcbiAgdE5pZ2h0LnNldChjb2xvclNldHRpbmdzLmdldF9ib29sZWFuKFwibmlnaHQtbGlnaHQtZW5hYmxlZFwiKSlcbiAgY29sb3JTZXR0aW5ncy5jb25uZWN0KFwiY2hhbmdlZDo6bmlnaHQtbGlnaHQtZW5hYmxlZFwiLCAoKSA9PlxuICAgIHROaWdodC5zZXQoY29sb3JTZXR0aW5ncyEuZ2V0X2Jvb2xlYW4oXCJuaWdodC1saWdodC1lbmFibGVkXCIpKSlcbn0gY2F0Y2ggeyAvKiBzY2hlbWEgYWJzZW50IG9uIHNvbWUgc3lzdGVtcyAqLyB9XG5cbi8vIFNpbGVudDogbXV0ZSBvbiB0aGUgZGVmYXVsdCBXaXJlUGx1bWJlciBzcGVha2VyXG5jb25zdCBfc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG5jb25zdCB0U2lsZW50ID0gX3NwZWFrZXJcbiAgPyAoYmluZChfc3BlYWtlciwgXCJtdXRlXCIpIGFzIHVua25vd24gYXMgVmFyaWFibGU8Ym9vbGVhbj4pXG4gIDogVmFyaWFibGUoZmFsc2UpXG5cbi8vIFBvd2VyIFNhdmVyOiBwb3dlcnByb2ZpbGVzY3RsIChmYWxscyBiYWNrIHRvIGZhbHNlIGlmIHVuYXZhaWxhYmxlKVxuY29uc3QgdFNhdmUgPSBWYXJpYWJsZShmYWxzZSlcbmV4ZWNBc3luYyhcInBvd2VycHJvZmlsZXNjdGwgZ2V0XCIpXG4gIC50aGVuKHYgPT4gdFNhdmUuc2V0KHYudHJpbSgpID09PSBcInBvd2VyLXNhdmVyXCIpKVxuICAuY2F0Y2goKCkgPT4geyAvKiBwb3dlcnByb2ZpbGVzY3RsIGFic2VudCAqLyB9KVxuXG4vLyBlZGl0LW1vZGUgZm9yIHRoZSB0aWxlIGNhdGFsb2cgKHBlbmNpbCBidXR0b24pIFx1MjAxNCBob29rIGZvciB0aWxlIHJlYXJyYW5nZS9jdXN0b21pc2UuXG5jb25zdCBlZGl0TW9kZSA9IFZhcmlhYmxlKGZhbHNlKVxuXG4vLyBQcm90b3R5cGUgdG9nZ2xlIGNoaXBzIGFyZSBsYWJlbC1vbmx5LCB2ZXJ0aWNhbGx5IGNlbnRlcmVkIFx1MjAxNCBzdGF0ZSBpcyBzaG93biBieSB0aGVcbi8vIGxlYWYgZmlsbCwgbm90IGEgc3ViLWxpbmUgKG9ubHkgV2ktRmkvQmx1ZXRvb3RoIGNhcnJ5IGEgc3ViKS5cbmZ1bmN0aW9uIFRvZ2dsZUNoaXAocHJvcHM6IHsgbGFiZWw6IHN0cmluZywgaWNvbjogc3RyaW5nLCB2OiBWYXJpYWJsZTxib29sZWFuPiwgb25Ub2dnbGVkPzogKCkgPT4gdm9pZCB9KSB7XG4gIHJldHVybiA8Q2hpcCBpZD17cHJvcHMubGFiZWx9IGxhYmVsPXtwcm9wcy5sYWJlbH0gaWNvbj17cHJvcHMuaWNvbn1cbiAgICBhY3RpdmU9e2JpbmQocHJvcHMudil9XG4gICAgb25Ub2dnbGVkPXtwcm9wcy5vblRvZ2dsZWQgPz8gKCgpID0+IHByb3BzLnYuc2V0KCFwcm9wcy52LmdldCgpKSl9IC8+XG59XG5cbmZ1bmN0aW9uIGJhdHRlcnlNZXRhKCk6IGFueSB7XG4gIGNvbnN0IGJhdCA9IEJhdHRlcnkuZ2V0X2RlZmF1bHQoKVxuICBpZiAoIWJhdCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIGJpbmQoYmF0LCBcInBlcmNlbnRhZ2VcIikuYXMocCA9PiB7XG4gICAgY29uc3QgcGN0ID0gTWF0aC5yb3VuZChwICogMTAwKVxuICAgIGNvbnN0IHN0YXRlID0gYmF0LmZ1bGwgPyBcIkZ1bGx5IGNoYXJnZWRcIiA6IGJhdC5jaGFyZ2luZyA/IFwiQ2hhcmdpbmdcIiA6IFwiRGlzY2hhcmdpbmdcIlxuICAgIHJldHVybiBgJHtwY3R9JSBcdTAwQjcgJHtzdGF0ZX1gXG4gIH0pXG59XG5jb25zdCBoYXNCYXR0ZXJ5ID0gQmF0dGVyeS5nZXRfZGVmYXVsdCgpICE9IG51bGxcblxuZnVuY3Rpb24gUm9vdCh7IG5hbWUgfTogeyBuYW1lPzogc3RyaW5nIH0pIHtcbiAgY29uc3QgbmV0ID0gTmV0d29yay5nZXRfZGVmYXVsdCgpXG4gIGNvbnN0IGJ0ID0gQmx1ZXRvb3RoLmdldF9kZWZhdWx0KClcbiAgLy8gc3BhY2luZyAwOiBleGFjdCBzZWN0aW9uIGdhcHMgY29tZSBmcm9tIG1hcmdpbnMgKHF0b3BcdTIxOTJjaGlwcyAxLCBjaGlwIHJvd3MgOCxcbiAgLy8gY2hpcHNcdTIxOTJzbGlkZXJzIDEwKSBcdTIwMTQgYSB1bmlmb3JtIGJveCBzcGFjaW5nIGNhbid0IGV4cHJlc3MgYWxsIHRocmVlLlxuICByZXR1cm4gPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXswfT5cbiAgICB7LyogdG9wIHJvdzogYmF0dGVyeSBcdTAwQjcgcmVsb2FkIFx1MDBCNyBsb2NrIFx1MDBCNyBwb3dlciAqL31cbiAgICA8Ym94IGNsYXNzPVwicXMtdG9wXCIgc3BhY2luZz17MH0+XG4gICAgICB7LyogYmF0dGVyeSBwaWxsOiBnbHlwaCArIHRhYnVsYXIgbWV0YSBcdTIwMTQgaGlkZGVuIHdoZW4gbm8gYmF0dGVyeSBwcmVzZW50ICovfVxuICAgICAgeyhERU1PIHx8IGhhc0JhdHRlcnkpICYmIDxib3ggY2xhc3M9XCJtZXRhXCIgc3BhY2luZz17Nn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtYmF0dGVyeS1zeW1ib2xpY1wiIC8+XG4gICAgICAgIDxsYWJlbCBjbGFzcz1cInRuXCIgbGFiZWw9e0RFTU8gPyBELm1ldGEgOiBiYXR0ZXJ5TWV0YSgpfSAvPlxuICAgICAgPC9ib3g+fVxuICAgICAgPGJveCBoZXhwYW5kIC8+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0biBsZWFmXCIgb25DbGlja2VkPXsoKSA9PiByZWxvYWQoKX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtbGVhZi1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpfT5cbiAgICAgICAgPGltYWdlIGljb25OYW1lPVwia29iZWwtbG9jay1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwicmJ0blwiIG9uQ2xpY2tlZD17KCkgPT4gZWRpdE1vZGUuc2V0KCFlZGl0TW9kZS5nZXQoKSl9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1wZW5jaWwtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInJidG4gZGFuZ2VyXCIgb25DbGlja2VkPXsoKSA9PiBzdXJmYWNlVG9nZ2xlKFwic2Vzc2lvblwiKX0+XG4gICAgICAgIDxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXBvd2VyLXN5bWJvbGljXCIgLz48L2J1dHRvbj5cbiAgICA8L2JveD5cbiAgICA8R25vYmxpbkJhbm5lciAvPlxuICAgIHsvKiBvbmUgY2hpcHMgZ3JpZDogMyByb3dzIGF0IDhweCwgbWFyZ2luLWJvdHRvbSAxMCBiZWZvcmUgdGhlIHNsaWRlcnMgKi99XG4gICAgPGJveCBjbGFzcz1cImNoaXAtZ3JpZFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezh9PlxuICAgICAgPGJveCBjbGFzcz1cImNoaXBzXCIgaG9tb2dlbmVvdXMgc3BhY2luZz17OH0+XG4gICAgICAgIHsoREVNTyB8fCBuZXQud2lmaSkgJiYgPENoaXAgaWQ9XCJ3aWZpXCIgbGFiZWw9XCJXaS1GaVwiIGljb249XCJrb2JlbC13aWZpLXN5bWJvbGljXCJcbiAgICAgICAgICBhY3RpdmU9e0RFTU8gPyBWYXJpYWJsZSh0cnVlKSA6IGJpbmQobmV0LndpZmkhLCBcImVuYWJsZWRcIil9XG4gICAgICAgICAgc3ViPXtERU1PID8gRC53aWZpU3NpZCA6IGJpbmQobmV0LndpZmkhLCBcInNzaWRcIikuYXMocyA9PiBzID8/IFwiT2ZmXCIpfVxuICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4geyBpZiAoIURFTU8gJiYgbmV0LndpZmkpIG5ldC53aWZpLmVuYWJsZWQgPSAhbmV0LndpZmkuZW5hYmxlZCB9fVxuICAgICAgICAgIG9uRHJpbGw9eygpID0+IGRyaWxsLnNldChcIndpZmlcIil9IC8+fVxuICAgICAgICA8Q2hpcCBpZD1cImJ0XCIgbGFiZWw9XCJCbHVldG9vdGhcIiBpY29uPVwia29iZWwtYmx1ZXRvb3RoLXN5bWJvbGljXCJcbiAgICAgICAgICBhY3RpdmU9e0RFTU8gPyBWYXJpYWJsZSh0cnVlKSA6IGJpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcyhkID0+IGQuc29tZSh4ID0+IHguY29ubmVjdGVkKSl9XG4gICAgICAgICAgc3ViPXtERU1PID8gRC5idERldmljZSA6IGJpbmQoYnQsIFwiZGV2aWNlc1wiKS5hcyhkID0+XG4gICAgICAgICAgICBkLmZpbmQoeCA9PiB4LmNvbm5lY3RlZCk/LmFsaWFzID8/IFwiT2ZmXCIpfVxuICAgICAgICAgIG9uVG9nZ2xlZD17KCkgPT4geyBpZiAoIURFTU8pIGJ0LnRvZ2dsZSgpIH19XG4gICAgICAgICAgb25EcmlsbD17KCkgPT4gZHJpbGwuc2V0KFwiYnRcIil9IC8+XG4gICAgICA8L2JveD5cbiAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICA8VG9nZ2xlQ2hpcCBsYWJlbD1cIlBvd2VyIFNhdmVyXCIgaWNvbj1cImtvYmVsLWJvbHQtc3ltYm9saWNcIiB2PXt0U2F2ZX1cbiAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IG5leHQgPSAhdFNhdmUuZ2V0KClcbiAgICAgICAgICAgIGV4ZWNBc3luYyhgcG93ZXJwcm9maWxlc2N0bCBzZXQgJHtuZXh0ID8gXCJwb3dlci1zYXZlclwiIDogXCJiYWxhbmNlZFwifWApXG4gICAgICAgICAgICAgIC50aGVuKCgpID0+IHRTYXZlLnNldChuZXh0KSkuY2F0Y2goKCkgPT4gdFNhdmUuc2V0KG5leHQpKVxuICAgICAgICAgIH19IC8+XG4gICAgICAgIDxUb2dnbGVDaGlwIGxhYmVsPVwiRGFyayBTdHlsZVwiIGljb249XCJrb2JlbC1tb29uLXN5bWJvbGljXCIgdj17dERhcmt9XG4gICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBuZXh0ID0gIXREYXJrLmdldCgpXG4gICAgICAgICAgICBpZmFjZVNldHRpbmdzLnNldF9zdHJpbmcoXCJjb2xvci1zY2hlbWVcIiwgbmV4dCA/IFwicHJlZmVyLWRhcmtcIiA6IFwiZGVmYXVsdFwiKVxuICAgICAgICAgIH19IC8+XG4gICAgICA8L2JveD5cbiAgICAgIDxib3ggY2xhc3M9XCJjaGlwc1wiIGhvbW9nZW5lb3VzIHNwYWNpbmc9ezh9PlxuICAgICAgICA8VG9nZ2xlQ2hpcCBsYWJlbD1cIlNpbGVudFwiIGljb249XCJrb2JlbC1iZWxsLXNsYXNoLXN5bWJvbGljXCIgdj17dFNpbGVudH1cbiAgICAgICAgICBvblRvZ2dsZWQ9eygpID0+IHsgaWYgKF9zcGVha2VyKSBfc3BlYWtlci5tdXRlID0gIV9zcGVha2VyLm11dGUgfX0gLz5cbiAgICAgICAgPFRvZ2dsZUNoaXAgbGFiZWw9XCJOaWdodCBMaWdodFwiIGljb249XCJrb2JlbC1zdW4tc3ltYm9saWNcIiB2PXt0TmlnaHR9XG4gICAgICAgICAgb25Ub2dnbGVkPXsoKSA9PiB7XG4gICAgICAgICAgICBpZiAoY29sb3JTZXR0aW5ncylcbiAgICAgICAgICAgICAgY29sb3JTZXR0aW5ncy5zZXRfYm9vbGVhbihcIm5pZ2h0LWxpZ2h0LWVuYWJsZWRcIiwgIXROaWdodC5nZXQoKSlcbiAgICAgICAgICB9fSAvPlxuICAgICAgPC9ib3g+XG4gICAgPC9ib3g+XG4gICAgPFNsaWRlcnMgLz5cbiAgPC9ib3g+XG59XG5cbi8vIFNpZ25hbC1zdHJlbmd0aCBnbHlwaCBmb3IgYW4gYWNjZXNzIHBvaW50ICgwXHUyMDEzMTAwIFx1MjE5MiB3aWZpIHRpZXJzKS5cbmZ1bmN0aW9uIHdpZmlJY29uKHN0cmVuZ3RoOiBudW1iZXIpOiBzdHJpbmcge1xuICByZXR1cm4gXCJrb2JlbC13aWZpLXN5bWJvbGljXCIgICAvLyBzaW5nbGUgZ2x5cGg7IHN0cmVuZ3RoIHNob3duIGFzIHRleHQgbWV0YVxufVxuXG4vLyBXaS1GaSBBUCBsaXN0IFx1MjAxNCByZWFsIEFzdGFsTmV0d29yayBhY2Nlc3MgcG9pbnRzLCBjb25uZWN0ZWQgb25lIG1hcmtlZCAuYWN0aXZlLlxuZnVuY3Rpb24gV2lmaUxpc3QoKSB7XG4gIGNvbnN0IHdpZmkgPSBOZXR3b3JrLmdldF9kZWZhdWx0KCkud2lmaVxuICBpZiAoIXdpZmkpIHJldHVybiA8Ym94IC8+XG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICB7YmluZCh3aWZpLCBcImFjY2Vzc1BvaW50c1wiKS5hcyhhcHMgPT4ge1xuICAgICAgY29uc3QgYWN0aXZlID0gd2lmaS5hY3RpdmVBY2Nlc3NQb2ludFxuICAgICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgICByZXR1cm4gYXBzXG4gICAgICAgIC5maWx0ZXIoYXAgPT4gYXAuc3NpZCAmJiAhc2Vlbi5oYXMoYXAuc3NpZCkgJiYgc2Vlbi5hZGQoYXAuc3NpZCkpXG4gICAgICAgIC5zb3J0KChhLCBiKSA9PiBiLnN0cmVuZ3RoIC0gYS5zdHJlbmd0aClcbiAgICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAgIC5tYXAoYXAgPT4ge1xuICAgICAgICAgIGNvbnN0IG9uID0gYWN0aXZlICYmIGFwLnNzaWQgPT09IGFjdGl2ZS5zc2lkXG4gICAgICAgICAgcmV0dXJuIDxidXR0b24gY2xhc3M9e29uID8gXCJ4cm93IGFjdGl2ZVwiIDogXCJ4cm93XCJ9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IHdpZmkuYWN0aXZhdGVfY29ubmVjdGlvbihhcCwgbnVsbCl9PlxuICAgICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17d2lmaUljb24oYXAuc3RyZW5ndGgpfSAvPlxuICAgICAgICAgICAgICA8bGFiZWwgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2FwLnNzaWR9IC8+XG4gICAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cInhzXCIgbGFiZWw9e29uID8gXCJDb25uZWN0ZWRcIiA6IGAke2FwLnN0cmVuZ3RofSVgfSAvPlxuICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgPC9idXR0b24+XG4gICAgICAgIH0pXG4gICAgfSl9XG4gIDwvYm94PlxufVxuXG4vLyBCbHVldG9vdGggZGV2aWNlIGxpc3QgXHUyMDE0IHNhbWUgLnhyb3cgZ3JhbW1hciBhcyBXaS1GaTsgY29ubmVjdGVkIGRldmljZSBpcyAuYWN0aXZlLlxuZnVuY3Rpb24gQnRMaXN0KCkge1xuICBjb25zdCBidCA9IEJsdWV0b290aC5nZXRfZGVmYXVsdCgpXG4gIHJldHVybiA8Ym94IGNsYXNzPVwiZGxpc3RcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsyfT5cbiAgICB7YmluZChidCwgXCJkZXZpY2VzXCIpLmFzKGRldmljZXMgPT4gZGV2aWNlc1xuICAgICAgLmZpbHRlcihkID0+IGQubmFtZSB8fCBkLmFsaWFzKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IE51bWJlcihiLmNvbm5lY3RlZCkgLSBOdW1iZXIoYS5jb25uZWN0ZWQpKVxuICAgICAgLnNsaWNlKDAsIDYpXG4gICAgICAubWFwKGRldiA9PiB7XG4gICAgICAgIGNvbnN0IG9uID0gZGV2LmNvbm5lY3RlZFxuICAgICAgICByZXR1cm4gPGJ1dHRvbiBjbGFzcz17b24gPyBcInhyb3cgYWN0aXZlXCIgOiBcInhyb3dcIn1cbiAgICAgICAgICBvbkNsaWNrZWQ9eygpID0+IG9uID8gZGV2LmRpc2Nvbm5lY3RfZGV2aWNlKCkgOiBkZXYuY29ubmVjdF9kZXZpY2UoKX0+XG4gICAgICAgICAgPGJveCBzcGFjaW5nPXsxMH0+XG4gICAgICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1ibHVldG9vdGgtc3ltYm9saWNcIiAvPlxuICAgICAgICAgICAgPGxhYmVsIGhleHBhbmQgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IGxhYmVsPXtkZXYuYWxpYXMgfHwgZGV2Lm5hbWV9IC8+XG4gICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJ4c1wiIGxhYmVsPXtvbiA/IFwiQ29ubmVjdGVkXCIgOiBkZXYucGFpcmVkID8gXCJQYWlyZWRcIiA6IFwiQXZhaWxhYmxlXCJ9IC8+XG4gICAgICAgICAgPC9ib3g+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgfSkpfVxuICA8L2JveD5cbn1cblxuLy8gT25lIG1peGVyIHJvdyAoLm1peHJvdykgXHUyMDE0IGhvcml6b250YWw6IDI2XHUwMEQ3MjYgaWNvbiB0aWxlIFx1MDBCNyA3MnB4IG5hbWUgXHUwMEI3IHNsaWRlciBmaWxscy5cbmZ1bmN0aW9uIE1peFJvdyhwcm9wczogeyBpY29uOiBzdHJpbmcsIHRpdGxlOiBzdHJpbmcsIHRhcmdldDogYW55IH0pIHtcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJtaXhyb3dcIiBzcGFjaW5nPXsxMH0+XG4gICAgPGJveCBjbGFzcz1cIm1pXCIgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17cHJvcHMuaWNvbn0gLz48L2JveD5cbiAgICA8bGFiZWwgY2xhc3M9XCJtbmFtZVwiIHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9XG4gICAgICBlbGxpcHNpemU9ezN9IGxhYmVsPXtwcm9wcy50aXRsZX0gLz5cbiAgICA8c2xpZGVyIGNsYXNzPVwic2xpZGVyXCIgaGV4cGFuZCB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9XG4gICAgICB2YWx1ZT17YmluZChwcm9wcy50YXJnZXQsIFwidm9sdW1lXCIpfVxuICAgICAgb25DaGFuZ2VWYWx1ZT17KF9zLCB2KSA9PiB7IHByb3BzLnRhcmdldC52b2x1bWUgPSB2IH19IC8+XG4gIDwvYm94PlxufVxuXG4vLyBQZXItYXBwIHZvbHVtZSBtaXhlciBcdTIwMTQgTWFzdGVyIChkZWZhdWx0IHNwZWFrZXIpICsgZWFjaCBhdWRpbyBzdHJlYW0gKEFzdGFsV3ApLlxuZnVuY3Rpb24gTWl4TGlzdCgpIHtcbiAgY29uc3Qgd3AgPSBXcC5nZXRfZGVmYXVsdCgpXG4gIGlmICghd3ApIHJldHVybiA8Ym94IC8+XG4gIGNvbnN0IHNwZWFrZXIgPSB3cC5kZWZhdWx0X3NwZWFrZXJcbiAgcmV0dXJuIDxib3ggY2xhc3M9XCJkbGlzdFwiIG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IHNwYWNpbmc9ezJ9PlxuICAgIHtzcGVha2VyICYmIDxNaXhSb3cgaWNvbj1cImtvYmVsLXNwZWFrZXItd2F2ZS1zeW1ib2xpY1wiIHRpdGxlPVwiT3V0cHV0XCIgdGFyZ2V0PXtzcGVha2VyfSAvPn1cbiAgICB7YmluZCh3cC5hdWRpbywgXCJzdHJlYW1zXCIpLmFzKHN0cmVhbXMgPT4gc3RyZWFtcy5zbGljZSgwLCA1KS5tYXAocyA9PlxuICAgICAgPE1peFJvdyBpY29uPVwia29iZWwtbXVzaWMtc3ltYm9saWNcIlxuICAgICAgICB0aXRsZT17cy5kZXNjcmlwdGlvbiB8fCBzLm5hbWUgfHwgXCJBcHBsaWNhdGlvblwifSB0YXJnZXQ9e3N9IC8+KSl9XG4gIDwvYm94PlxufVxuXG5mdW5jdGlvbiBEcmlsbFZpZXcoeyBuYW1lIH06IHsgbmFtZT86IHN0cmluZyB9KSB7XG4gIGNvbnN0IG5ldCA9IE5ldHdvcmsuZ2V0X2RlZmF1bHQoKVxuICByZXR1cm4gPGJveCBuYW1lPXtuYW1lfSBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICA8Y2VudGVyYm94IGNsYXNzPVwiZGhlYWRcIj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJpYnRuXCIgb25DbGlja2VkPXsoKSA9PiBkcmlsbC5zZXQobnVsbCl9PlxuICAgICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jaGV2cm9uLWxlZnQtc3ltYm9saWNcIiAvPjwvYnV0dG9uPlxuICAgICAgPGxhYmVsIGxhYmVsPXtiaW5kKGRyaWxsKS5hcyhkID0+XG4gICAgICAgIGQgPT09IFwid2lmaVwiID8gXCJXaS1GaVwiIDogZCA9PT0gXCJidFwiID8gXCJCbHVldG9vdGhcIiA6IFwiVm9sdW1lXCIpfSAvPlxuICAgICAgPGJveCB3aWR0aFJlcXVlc3Q9ezQ2fSBoYWxpZ249e0d0ay5BbGlnbi5FTkR9PlxuICAgICAgICB7bmV0LndpZmkgJiYgPHN3aXRjaCBhY3RpdmU9e2JpbmQobmV0LndpZmksIFwiZW5hYmxlZFwiKX1cbiAgICAgICAgICB2aXNpYmxlPXtiaW5kKGRyaWxsKS5hcyhkID0+IGQgPT09IFwid2lmaVwiKX1cbiAgICAgICAgICBvbk5vdGlmeUFjdGl2ZT17cyA9PiB7IG5ldC53aWZpIS5lbmFibGVkID0gcy5hY3RpdmUgfX0gLz59XG4gICAgICAgIDxzd2l0Y2ggYWN0aXZlPXtiaW5kKEJsdWV0b290aC5nZXRfZGVmYXVsdCgpLCBcInBvd2VyZWRcIil9XG4gICAgICAgICAgdmlzaWJsZT17YmluZChkcmlsbCkuYXMoZCA9PiBkID09PSBcImJ0XCIpfVxuICAgICAgICAgIG9uTm90aWZ5QWN0aXZlPXtzID0+IHsgQmx1ZXRvb3RoLmdldF9kZWZhdWx0KCkuYWRhcHRlci5wb3dlcmVkID0gcy5hY3RpdmUgfX0gLz5cbiAgICAgIDwvYm94PlxuICAgIDwvY2VudGVyYm94PlxuICAgIHtiaW5kKGRyaWxsKS5hcyhkID0+XG4gICAgICBkID09PSBcIndpZmlcIiA/IDxXaWZpTGlzdCAvPiA6IGQgPT09IFwiYnRcIiA/IDxCdExpc3QgLz4gOlxuICAgICAgZCA9PT0gXCJtaXhcIiA/IDxNaXhMaXN0IC8+IDogPGJveCAvPil9XG4gIDwvYm94PlxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBRdWlja1NldHRpbmdzKCkge1xuICBjb25zdCB7IHdpblZpc2libGUsIHJldmVhbGVkLCBzZXRSZXZlYWxlciwgY2xvc2UsIHRvZ2dsZTogdG9nZ2xlRm4gfSA9IG1ha2VSZXZlYWwoMjIwLCAxNTApXG4gIHJlZ2lzdGVyKFwicXVpY2tzZXR0aW5nc1wiLCB0b2dnbGVGbilcbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwicXVpY2tzZXR0aW5nc1wiIG5hbWVzcGFjZT1cImtvYmVsLXFzXCIgY2xhc3M9XCJxcy13aW5kb3dcIlxuICAgIHZpc2libGU9e2JpbmQod2luVmlzaWJsZSl9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUfVxuICAgIGV4Y2x1c2l2aXR5PXtBc3RhbC5FeGNsdXNpdml0eS5OT1JNQUx9XG4gICAga2V5bW9kZT17QXN0YWwuS2V5bW9kZS5PTl9ERU1BTkR9XG4gICAgb25LZXlQcmVzc2VkPXsoX3NlbGYsIGtleSkgPT4ge1xuICAgICAgaWYgKGtleSAhPT0gR2RrLktFWV9Fc2NhcGUpIHJldHVybiBmYWxzZVxuICAgICAgaWYgKGRyaWxsLmdldCgpKSB7IGRyaWxsLnNldChudWxsKTsgcmV0dXJuIHRydWUgfSAgIC8vIEVzYyBzdGVwcyBiYWNrIGZpcnN0XG4gICAgICBjbG9zZSgpOyByZXR1cm4gdHJ1ZVxuICAgIH19PlxuICAgIDxyZXZlYWxlclxuICAgICAgdHJhbnNpdGlvblR5cGU9e0d0ay5SZXZlYWxlclRyYW5zaXRpb25UeXBlLlNMSURFX0RPV059XG4gICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgIHJldmVhbENoaWxkPXtiaW5kKHJldmVhbGVkKX1cbiAgICAgIHNldHVwPXsocjogR3RrLlJldmVhbGVyKSA9PiBzZXRSZXZlYWxlcihyKX0+XG4gICAgICA8Ym94IGNsYXNzPVwic2hlZXQgcXNcIj5cbiAgICAgICAgey8qIEd0ay5TdGFjayB3aXRoIHNsaWRlLWxlZnQvcmlnaHQgPSB0aGUgbXVsdGl2aWV3OyBoZWlnaHQgYW5pbWF0ZXNcbiAgICAgICAgICAgIHZpYSBBZHcgc3ByaW5nIG9uIGEgc2l6ZS1ncm91cCB3cmFwcGVyIChNT1RJT04uZHJpbGwgLyBkcmlsbEJhY2spICovfVxuICAgICAgICA8c3RhY2tcbiAgICAgICAgICB0cmFuc2l0aW9uVHlwZT17R3RrLlN0YWNrVHJhbnNpdGlvblR5cGUuU0xJREVfTEVGVF9SSUdIVH1cbiAgICAgICAgICB0cmFuc2l0aW9uRHVyYXRpb249ezIyMH1cbiAgICAgICAgICB2aXNpYmxlQ2hpbGROYW1lPXtiaW5kKGRyaWxsKS5hcyhkID0+IGQgPyBcImRyaWxsXCIgOiBcInJvb3RcIil9PlxuICAgICAgICAgIDxSb290IG5hbWU9XCJyb290XCIgLz5cbiAgICAgICAgICA8RHJpbGxWaWV3IG5hbWU9XCJkcmlsbFwiIC8+XG4gICAgICAgIDwvc3RhY2s+XG4gICAgICA8L2JveD5cbiAgICA8L3JldmVhbGVyPlxuICA8L3dpbmRvdz5cbn1cbiIsICIvLyBUaW55U2xpZGVyIFx1MjAxNCBHdGsuU2NhbGUgc3ViY2xhc3MgdGhhdCByZXBvcnRzIG5lYXItemVybyBuYXR1cmFsIHdpZHRoIHNvIGl0XG4vLyBuZXZlciBmb3JjZXMgaXRzIHBhcmVudCBjb250YWluZXIgd2lkZXIgdGhhbiB0aGUgY2hpcC1ncmlkJ3MgbmF0dXJhbCB3aWR0aC5cbi8vIFdlIGV4dGVuZCBHdGsuU2NhbGUgZGlyZWN0bHkgKG5vdCBBc3RhbC5TbGlkZXIpIGJlY2F1c2UgQXN0YWwuU2xpZGVyJ3MgVmFsYVxuLy8gQyB2ZnVuY3MgY2FuIGludGVyY2VwdCB0aGUgbWVhc3VyZSBjaGFpbiBiZWZvcmUgdGhlIEdKUyBvdmVycmlkZSBpcyByZWFjaGVkLlxuaW1wb3J0IEdPYmplY3QgZnJvbSBcImdpOi8vR09iamVjdFwiXG5pbXBvcnQgR3RrIGZyb20gXCJnaTovL0d0a1wiXG5cbmV4cG9ydCBjb25zdCBUaW55U2xpZGVyID0gR09iamVjdC5yZWdpc3RlckNsYXNzKHtcbiAgR1R5cGVOYW1lOiBcIktvYmVsVGlueVNjYWxlXCIsXG59LCBjbGFzcyBUaW55U2xpZGVyIGV4dGVuZHMgR3RrLlNjYWxlIHtcbiAgY29uc3RydWN0b3IocGFyYW1zPzogUGFydGlhbDxHdGsuU2NhbGUuQ29uc3RydWN0b3JQcm9wcyAmIHsgdmFsdWU/OiBudW1iZXIgfT4pIHtcbiAgICBjb25zdCB7IHZhbHVlLCAuLi5yZXN0IH0gPSAocGFyYW1zID8/IHt9KSBhcyBhbnlcbiAgICBzdXBlcih7XG4gICAgICBvcmllbnRhdGlvbjogR3RrLk9yaWVudGF0aW9uLkhPUklaT05UQUwsXG4gICAgICBhZGp1c3RtZW50OiBuZXcgR3RrLkFkanVzdG1lbnQoe1xuICAgICAgICBsb3dlcjogMCwgdXBwZXI6IDEsXG4gICAgICAgIHN0ZXBfaW5jcmVtZW50OiAwLjAxLCBwYWdlX2luY3JlbWVudDogMC4xLCBwYWdlX3NpemU6IDAsXG4gICAgICAgIHZhbHVlOiB2YWx1ZSA/PyAwLFxuICAgICAgfSksXG4gICAgICBkcmF3X3ZhbHVlOiBmYWxzZSxcbiAgICAgIC4uLnJlc3QsXG4gICAgfSlcbiAgfVxuXG4gIHZmdW5jX21lYXN1cmUob3JpZW50YXRpb246IEd0ay5PcmllbnRhdGlvbiwgZm9yX3NpemU6IG51bWJlcik6IFtudW1iZXIsIG51bWJlciwgbnVtYmVyLCBudW1iZXJdIHtcbiAgICBpZiAob3JpZW50YXRpb24gPT09IEd0ay5PcmllbnRhdGlvbi5IT1JJWk9OVEFMKSB7XG4gICAgICAvLyBSZXBvcnQgbmF0dXJhbD0xIHNvIHRoZSBzcm93L3NsaWRlcnMgY29udGFpbmVyIGRvZXNuJ3QgaW5mbGF0ZSB0aGUgUVMgcGFuZWxcbiAgICAgIC8vIGJleW9uZCB0aGUgY2hpcC1ncmlkIG5hdHVyYWwgd2lkdGguIFRoZSBzbGlkZXIgc3RpbGwgaGV4cGFuZHMgdG8gZmlsbCB0aGVcbiAgICAgIC8vIGF2YWlsYWJsZSBzcGFjZSBhdCBhbGxvY2F0aW9uIHRpbWUgXHUyMDE0IG9ubHkgdGhlIG5hdHVyYWwgc2l6ZSBpcyBvdmVycmlkZGVuLlxuICAgICAgcmV0dXJuIFswLCAxLCAtMSwgLTFdO1xuICAgIH1cbiAgICByZXR1cm4gc3VwZXIudmZ1bmNfbWVhc3VyZShvcmllbnRhdGlvbiwgZm9yX3NpemUpO1xuICB9XG59KVxuIiwgIi8vIE5vdGlmaWNhdGlvbnMuIFByb3RvdHlwZS1maW5hbDogZmxvYXRpbmcgYmx1cnJlZCB0b2FzdHMgKHRvcC1yaWdodCwgdGhlIE9ORVxuLy8gc2FuY3Rpb25lZCB0cmFuc2x1Y2VuY3kpICsgcmlnaHQgZHJhd2VyIChtZWRpYSBjYXJkIG9uIHRvcCwgcGFuZWwtbGVzcyBjYXJkc1xuLy8gZmxvYXRpbmcgb24gd2FsbHBhcGVyLCBoZWFkZXIgY2hpcCkuIFRoZSB1bmlmaWVkIHBpcGVsaW5lOiBvcGVuIHRoZSBkcmF3ZXIgd2hpbGVcbi8vIGEgdG9hc3QgaXMgbGl2ZSBhbmQgaXQncyBBRE9QVEVEIGludG8gdGhlIHN0YWNrOyB0b2FzdHMgYXJyaXZpbmcgd2hpbGUgb3BlblxuLy8gaW5zZXJ0IGFzIGNhcmRzOyBTaWxlbnQgcm91dGVzIHN0cmFpZ2h0IHRvIHRoZSBzdG9yZS5cbmltcG9ydCB7IEFwcCwgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQsIEdMaWIgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IE5vdGlmZCBmcm9tIFwiZ2k6Ly9Bc3RhbE5vdGlmZFwiXG5pbXBvcnQgTXByaXMgZnJvbSBcImdpOi8vQXN0YWxNcHJpc1wiXG5cbi8vIExhenkgc2luZ2xldG9uIFx1MjAxNCBjYWxsaW5nIGdldF9kZWZhdWx0KCkgYXQgbW9kdWxlIHNjb3BlIGJsb2NrcyB0aGUgaW1wb3J0IHdoaWxlXG4vLyBBc3RhbE5vdGlmZCB0cmllcyB0byBhY3F1aXJlIG9yZy5mcmVlZGVza3RvcC5Ob3RpZmljYXRpb25zIChoYW5ncyBpZiBnbm9tZS1zaGVsbFxuLy8gc3RpbGwgb3ducyBpdCkuIERlZmVycmluZyB0byBmaXJzdCB1c2UgbGV0cyB0aGUgbW9kdWxlIGltcG9ydCBjbGVhbmx5OyB0aGUgYnVzIGlzXG4vLyByZWxlYXNlZCBieSBgZ25vYmxpbmN0bCBkaXNhYmxlIG5vdGlmaWNhdGlvbnNgIGJlZm9yZSB0aGUgZGFlbW9uIGFjdHVhbGx5IGNsYWltcyBpdC5cbmxldCBfbm90aWZkOiBOb3RpZmQuTm90aWZkIHwgbnVsbCA9IG51bGxcbmNvbnN0IG5kID0gKCkgPT4gKF9ub3RpZmQgPz89IE5vdGlmZC5nZXRfZGVmYXVsdCgpKVxuY29uc3Qgc2tpcCA9ICgpID0+ICEhR0xpYi5nZXRlbnYoXCJLT0JFTF9TS0lQX05PVElGRFwiKVxuY29uc3QgVE9BU1RfTVMgPSAzODAwXG4vLyBSZWFjdGl2ZSBkcmF3ZXItb3BlbiBzdGF0ZSBzbyB0aGUgdG9hc3RzIGNhbiBiZSBBRE9QVEVEIChoaWRkZW4pIHRoZSBpbnN0YW50IHRoZVxuLy8gZHJhd2VyIG9wZW5zLCB3aXRob3V0IHBvbGxpbmcgYSBsb29rZWQtdXAgd2luZG93J3MgdmlzaWJpbGl0eS5cbmNvbnN0IGRyYXdlck9wZW4gPSBWYXJpYWJsZShmYWxzZSlcblxuLy8gTm90aWZpY2F0aW9uIGNhcmRzIGFyZSBhIGRlZmluZWQgd2lkdGggKHByb3RvdHlwZSBgcHdgIFx1MjI0OCBRUyBwYW5lbCkgc28gdGhlIHRvYXN0XG4vLyBkb2Vzbid0IHN0cmV0Y2ggdG8gdGhlIGhleHBhbmQgdGV4dCBjb2x1bW47IHRoZSBkcmF3ZXIgY2FyZHMgZmlsbCB0aGUgc2FtZSB3aWR0aC5cbmNvbnN0IE5DQVJEX1cgPSAzMjdcbmZ1bmN0aW9uIENhcmQoeyBuIH06IHsgbjogTm90aWZkLk5vdGlmaWNhdGlvbiB9KSB7XG4gIHJldHVybiA8Ym94IGNsYXNzPVwibmNhcmRcIiBzcGFjaW5nPXsxMH0gd2lkdGhSZXF1ZXN0PXtOQ0FSRF9XfT5cbiAgICB7LyogYXBwIGljb24gaW4gYSAzMFx1MDBENzMwIHI5IHRpbGUgKHByb3RvdHlwZSAubmljKSAqL31cbiAgICA8Ym94IGNsYXNzPVwibmljXCIgdmFsaWduPXtHdGsuQWxpZ24uU1RBUlR9PlxuICAgICAgPGltYWdlIGljb25OYW1lPXtuLmFwcF9pY29uIHx8IFwiZGlhbG9nLWluZm9ybWF0aW9uLXN5bWJvbGljXCJ9IHBpeGVsU2l6ZT17MjB9IC8+XG4gICAgPC9ib3g+XG4gICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBoZXhwYW5kPlxuICAgICAgPGJveD5cbiAgICAgICAgPGxhYmVsIGhhbGlnbj17R3RrLkFsaWduLlNUQVJUfSBoZXhwYW5kIGVsbGlwc2l6ZT17M30gbGFiZWw9e24uc3VtbWFyeX0gLz5cbiAgICAgICAgPGxhYmVsIGNsYXNzPVwid2hlbiB0blwiIGxhYmVsPXtuZXcgRGF0ZShuLnRpbWUgKiAxMDAwKVxuICAgICAgICAgIC50b0xvY2FsZVRpbWVTdHJpbmcoXCJlbi1HQlwiLCB7IGhvdXI6IFwiMi1kaWdpdFwiLCBtaW51dGU6IFwiMi1kaWdpdFwiIH0pfSAvPlxuICAgICAgPC9ib3g+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJib2R5XCIgaGFsaWduPXtHdGsuQWxpZ24uU1RBUlR9IHhhbGlnbj17MH0gd3JhcFxuICAgICAgICBtYXhXaWR0aENoYXJzPXs0MH0gbGFiZWw9e24uYm9keX0gLz5cbiAgICA8L2JveD5cbiAgICA8YnV0dG9uIGNsYXNzPVwibnhcIiB2YWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gb25DbGlja2VkPXsoKSA9PiBuLmRpc21pc3MoKX0+XG4gICAgICA8aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1jbG9zZS1zeW1ib2xpY1wiIC8+XG4gICAgPC9idXR0b24+XG4gIDwvYm94PlxufVxuXG5leHBvcnQgZnVuY3Rpb24gVG9hc3RzKG1vbml0b3I6IEdkay5Nb25pdG9yKSB7XG4gIGlmIChza2lwKCkpIHJldHVybiBudWxsXG4gIC8vIE9ubHkgcmVuZGVyIG5vdGlmaWNhdGlvbnMgeW91bmdlciB0aGFuIFRPQVNUX01TIHdoaWxlIHRoZSBkcmF3ZXIgaXMgQ0xPU0VEIFx1MjAxNFxuICAvLyBvcGVuaW5nIHRoZSBkcmF3ZXIgXCJhZG9wdHNcIiB0aGVtICh0aGV5IHNpbXBseSBjb250aW51ZSBsaWZlIGFzIGRyYXdlciBjYXJkcyxcbiAgLy8gd2hpY2ggaXMgdGhlIEZMSVAgaGFuZG9mZiBleHByZXNzZWQgaW4gcmV0YWluZWQtbW9kZSB0ZXJtcykuXG4gIGNvbnN0IGxpdmUgPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gIC8vIGBzaG93bmAgPSB3aGF0IHRoZSB0b2FzdCBjb2x1bW4gcmVuZGVycy4gUmVjb21wdXRlZCBleHBsaWNpdGx5IG9uIGV2ZXJ5IGlucHV0XG4gIC8vIGNoYW5nZSAoVmFyaWFibGUuZGVyaXZlIGRpZG4ndCBwcm9kdWNlIGEgcmVhY3RpdmUgYmluZGluZyBoZXJlKS4gRW1wdHkgd2hpbGUgdGhlXG4gIC8vIGRyYXdlciBpcyBvcGVuICh0b2FzdHMgYXJlIEFET1BURUQgaW50byB0aGUgZHJhd2VyIHN0YWNrKS5cbiAgY29uc3Qgc2hvd24gPSBWYXJpYWJsZTxudW1iZXJbXT4oW10pXG4gIGNvbnN0IHJlY29tcHV0ZSA9ICgpID0+IHNob3duLnNldChkcmF3ZXJPcGVuLmdldCgpID8gW10gOiBsaXZlLmdldCgpKVxuICBsaXZlLnN1YnNjcmliZShyZWNvbXB1dGUpXG4gIGRyYXdlck9wZW4uc3Vic2NyaWJlKHJlY29tcHV0ZSlcbiAgbmQoKS5jb25uZWN0KFwibm90aWZpZWRcIiwgKF9uLCBpZCkgPT4ge1xuICAgIGlmIChkcmF3ZXJPcGVuLmdldCgpIHx8IG5kKCkuZG9udF9kaXN0dXJiKSByZXR1cm5cbiAgICBsaXZlLnNldChbLi4ubGl2ZS5nZXQoKSwgaWRdKVxuICAgIHRpbWVvdXQoVE9BU1RfTVMsICgpID0+IGxpdmUuc2V0KGxpdmUuZ2V0KCkuZmlsdGVyKHggPT4geCAhPT0gaWQpKSlcbiAgfSlcbiAgcmV0dXJuIDx3aW5kb3dcbiAgICBuYW1lPVwidG9hc3RzXCIgbmFtZXNwYWNlPVwia29iZWwtdG9hc3RzXCIgZ2RrbW9uaXRvcj17bW9uaXRvcn1cbiAgICAvLyBIaWRlIHRoZSB3aG9sZSB0b2FzdCBzdXJmYWNlIHdoaWxlIHRoZSBkcmF3ZXIgaXMgb3BlbiAodG9hc3RzIGFyZSBBRE9QVEVEIGludG9cbiAgICAvLyB0aGUgZHJhd2VyKSBcdTIwMTQgYSByZWFjdGl2ZSB3aW5kb3ctdmlzaWJpbGl0eSBiaW5kLCByb2J1c3QgcmVnYXJkbGVzcyBvZiB0aGVcbiAgICAvLyBwZXItaXRlbSBsaXN0IHJlY29uY2lsaWF0aW9uLlxuICAgIHZpc2libGU9e2JpbmQoZHJhd2VyT3BlbikuYXMobyA9PiAhbyl9XG4gICAgLy8gVG9hc3RzIGFyZSBhIGZsb2F0aW5nIG92ZXJsYXkgKGxpa2UgdGhlIHByb3RvdHlwZSdzIGFic29sdXRlIHRvcC9yaWdodCk7IHRoZVxuICAgIC8vIGZsb2F0IGluc2V0IGNsZWFycyB0aGUgZmxvYXRpbmcgYmFyIChtYXJnaW5Ub3AgMTAgKyBoZWlnaHQgNDIpICsgYSBzbWFsbCBnYXAsXG4gICAgLy8gYW5kIHRoZSByaWdodCBpbnNldCBtYXRjaGVzIHRoZSBiYXIncyBlZGdlIG1hcmdpbi5cbiAgICBtYXJnaW5Ub3A9ezU4fSBtYXJnaW5SaWdodD17MTJ9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuVE9QIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUfT5cbiAgICB7LyogZml4ZWQgdG9hc3QgY29sdW1uIHdpZHRoIHNvIHRoZSBjYXJkIGNhbid0IHN0cmV0Y2ggdG8gaXRzIGhleHBhbmQgdGV4dCBjb2x1bW4gKi99XG4gICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fVxuICAgICAgd2lkdGhSZXF1ZXN0PXtOQ0FSRF9XICsgMjZ9IGhhbGlnbj17R3RrLkFsaWduLkVORH0+XG4gICAgICB7YmluZChzaG93bikuYXMoaWRzID0+IGlkcy5tYXAoaWQgPT4ge1xuICAgICAgICBjb25zdCBuID0gbmQoKS5nZXRfbm90aWZpY2F0aW9uKGlkKVxuICAgICAgICByZXR1cm4gbiA/IDxib3ggY2xhc3M9XCJ0b2FzdFwiPjxDYXJkIG49e259IC8+PC9ib3g+IDogPGJveCAvPlxuICAgICAgfSkpfVxuICAgIDwvYm94PlxuICA8L3dpbmRvdz5cbn1cblxuZnVuY3Rpb24gTWVkaWFDYXJkKCkge1xuICBsZXQgcGxheWVyOiBhbnkgPSBudWxsXG4gIHRyeSB7IHBsYXllciA9IE1wcmlzLmdldF9kZWZhdWx0KCk/LnBsYXllcnM/LlswXSA/PyBudWxsIH0gY2F0Y2ggeyBwbGF5ZXIgPSBudWxsIH1cbiAgaWYgKCFwbGF5ZXIpIHJldHVybiA8Ym94IHZpc2libGU9e2ZhbHNlfSAvPlxuICByZXR1cm4gPGJveCBjbGFzcz1cIm5jYXJkIG1lZGlhXCIgc3BhY2luZz17MTF9PlxuICAgIDxpbWFnZSBwaXhlbFNpemU9ezQ2fSBpY29uTmFtZT1cImtvYmVsLW11c2ljLXN5bWJvbGljXCIgLz5cbiAgICA8Ym94IG9yaWVudGF0aW9uPXtHdGsuT3JpZW50YXRpb24uVkVSVElDQUx9IGhleHBhbmQgdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgIDxsYWJlbCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gZWxsaXBzaXplPXszfSBsYWJlbD17YmluZChwbGF5ZXIsIFwidGl0bGVcIil9IC8+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJzdWJcIiBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9e2JpbmQocGxheWVyLCBcImFydGlzdFwiKX0gLz5cbiAgICA8L2JveD5cbiAgICA8YnV0dG9uIG9uQ2xpY2tlZD17KCkgPT4gcGxheWVyLnByZXZpb3VzKCl9PjxpbWFnZSBpY29uTmFtZT1cImtvYmVsLXNraXAtYmFjay1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gICAgPGJ1dHRvbiBvbkNsaWNrZWQ9eygpID0+IHBsYXllci5wbGF5X3BhdXNlKCl9PlxuICAgICAgPGltYWdlIGljb25OYW1lPXtiaW5kKHBsYXllciwgXCJwbGF5YmFja19zdGF0dXNcIikuYXMocyA9PlxuICAgICAgICBzID09PSBNcHJpcy5QbGF5YmFja1N0YXR1cy5QTEFZSU5HID8gXCJrb2JlbC1wYXVzZS1zeW1ib2xpY1wiIDogXCJrb2JlbC1wbGF5LXN5bWJvbGljXCIpfSAvPlxuICAgIDwvYnV0dG9uPlxuICAgIDxidXR0b24gb25DbGlja2VkPXsoKSA9PiBwbGF5ZXIubmV4dCgpfT48aW1hZ2UgaWNvbk5hbWU9XCJrb2JlbC1za2lwLWZ3ZC1zeW1ib2xpY1wiIC8+PC9idXR0b24+XG4gIDwvYm94PlxufVxuXG5leHBvcnQgZnVuY3Rpb24gRHJhd2VyKCkge1xuICBpZiAoc2tpcCgpKSByZXR1cm4gbnVsbFxuICBjb25zdCBuZmQgPSBuZCgpXG4gIC8vIERyaXZlIHRoZSBsaXN0IGZyb20gYSBWYXJpYWJsZSBvZmYgZ2V0X25vdGlmaWNhdGlvbnMoKSArIHNpZ25hbHMsIG5vdCBhIHByb3BlcnR5XG4gIC8vIGJpbmQgXHUyMDE0IEFzdGFsTm90aWZkJ3MgYG5vdGlmaWNhdGlvbnNgIGlzbid0IHJlbGlhYmx5IGJpbmRhYmxlIGFjcm9zcyBHSlMgdmVyc2lvbnMuXG4gIGNvbnN0IGxpc3QgPSBWYXJpYWJsZTxOb3RpZmQuTm90aWZpY2F0aW9uW10+KG5mZC5nZXRfbm90aWZpY2F0aW9ucygpID8/IFtdKVxuICBjb25zdCByZWZyZXNoID0gKCkgPT4gbGlzdC5zZXQobmZkLmdldF9ub3RpZmljYXRpb25zKCkgPz8gW10pXG4gIG5mZC5jb25uZWN0KFwibm90aWZpZWRcIiwgcmVmcmVzaClcbiAgbmZkLmNvbm5lY3QoXCJyZXNvbHZlZFwiLCByZWZyZXNoKVxuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJkcmF3ZXJcIiBuYW1lc3BhY2U9XCJrb2JlbC1kcmF3ZXJcIiBjbGFzcz1cImRyYXdlci13aW5kb3dcIiB2aXNpYmxlPXtmYWxzZX1cbiAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuUklHSFQgfCBBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfVxuICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuT05fREVNQU5EfVxuICAgIHNldHVwPXsoc2VsZjogR3RrLldpbmRvdykgPT4gc2VsZi5jb25uZWN0KFwibm90aWZ5Ojp2aXNpYmxlXCIsXG4gICAgICAoKSA9PiBkcmF3ZXJPcGVuLnNldChzZWxmLnZpc2libGUpKX1cbiAgICBvbktleVByZXNzZWQ9eyhzZWxmLCBrZXkpID0+IGtleSA9PT0gR2RrLktFWV9Fc2NhcGUgPyAoc2VsZi5oaWRlKCksIHRydWUpIDogZmFsc2V9PlxuICAgIDxib3ggY2xhc3M9XCJkcmF3ZXJcIiBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXs4fT5cbiAgICAgIDxNZWRpYUNhcmQgLz5cbiAgICAgIDxib3ggY2xhc3M9XCJuaGVhZFwiIHNwYWNpbmc9ezh9PlxuICAgICAgICA8bGFiZWwgaGV4cGFuZCBoYWxpZ249e0d0ay5BbGlnbi5TVEFSVH0gbGFiZWw9XCJOb3RpZmljYXRpb25zXCIgLz5cbiAgICAgICAgPGxhYmVsIGNsYXNzPVwidG4gc3ViXCIgbGFiZWw9e2JpbmQobGlzdCkuYXMobiA9PiBgJHtuLmxlbmd0aCB8fCBcIlwifWApfSAvPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwibmNsZWFyXCIgb25DbGlja2VkPXsoKSA9PlxuICAgICAgICAgIG5mZC5nZXRfbm90aWZpY2F0aW9ucygpLmZvckVhY2gobiA9PiBuLmRpc21pc3MoKSl9PlxuICAgICAgICAgIDxib3ggc3BhY2luZz17NX0+PGltYWdlIGljb25OYW1lPVwia29iZWwtdHJhc2gtc3ltYm9saWNcIiAvPjxsYWJlbCBsYWJlbD1cIkNsZWFyXCIgLz48L2JveD5cbiAgICAgICAgPC9idXR0b24+XG4gICAgICA8L2JveD5cbiAgICAgIHsvKiBmdWxsLWhlaWdodCBkcmF3ZXIsIHNvIGNhcmRzIGp1c3Qgc3RhY2sgKGhvbGRzIG1hbnkpLiBBIEd0ay5TY3JvbGxlZFdpbmRvd1xuICAgICAgICAgIHdyYXBwZXIgY29sbGFwc2VzIGhlcmUgXHUyMDE0IGFzdGFsJ3MgcmVhY3RpdmUgYmluZCgpIGNoaWxkcmVuIGRvbid0IHJlbmRlciBpbnNpZGVcbiAgICAgICAgICBhIG1hbnVhbGx5LWNvbnN0cnVjdGVkIFNjcm9sbGVkV2luZG93IGNoaWxkLCBzbyBpdCByZXBvcnRzIDAgbmF0dXJhbCBzaXplLlxuICAgICAgICAgIFByb3BlciBzY3JvbGxpbmcgZm9yIDIwKyBub3RpZmljYXRpb25zIGlzIGEgZm9sbG93LXVwLiAqL31cbiAgICAgIDxib3ggb3JpZW50YXRpb249e0d0ay5PcmllbnRhdGlvbi5WRVJUSUNBTH0gc3BhY2luZz17OH0gdmV4cGFuZD5cbiAgICAgICAge2JpbmQobGlzdCkuYXMobnMgPT4gKG5zICYmIG5zLmxlbmd0aClcbiAgICAgICAgICA/IG5zLm1hcChuID0+IDxDYXJkIG49e259IC8+KVxuICAgICAgICAgIDogWzxib3ggY2xhc3M9XCJuY2FyZCBlbXB0eVwiIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0+XG4gICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD1cIkFsbCBjYXVnaHQgdXAgXHUyNzEzXCIgLz5cbiAgICAgICAgICAgIDwvYm94Pl0pfVxuICAgICAgPC9ib3g+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuIiwgIi8vIE9TRCBcdTIwMTQgZGlzcGxheS1vbmx5IHZvbHVtZSBwaWxsIGFib3ZlIHRoZSBkb2NrLiBQcm90b3R5cGU6IHBvaW50ZXItZXZlbnRzIG5vbmUsXG4vLyBhdXRvLWhpZGUgMS40cywgdHJhbnNsdWNlbnQgKGJsdXIgdmlhIGdub2JsaW4gd2luZG93LXJ1bGUpLlxuaW1wb3J0IHsgQXN0YWwsIEdkaywgR3RrIH0gZnJvbSBcImFzdGFsL2d0azRcIlxuaW1wb3J0IHsgVmFyaWFibGUsIGJpbmQsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuaW1wb3J0IFdwIGZyb20gXCJnaTovL0FzdGFsV3BcIlxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBPU0QobW9uaXRvcjogR2RrLk1vbml0b3IpIHtcbiAgY29uc3Qgc3BlYWtlciA9IFdwLmdldF9kZWZhdWx0KCk/LmRlZmF1bHRfc3BlYWtlciA/PyBudWxsXG4gIGNvbnN0IHZpc2libGUgPSBWYXJpYWJsZShmYWxzZSlcbiAgbGV0IGhpZGU6IFJldHVyblR5cGU8dHlwZW9mIHRpbWVvdXQ+IHwgbnVsbCA9IG51bGxcbiAgaWYgKCFzcGVha2VyKSByZXR1cm4gbnVsbFxuXG4gIHNwZWFrZXIuY29ubmVjdChcIm5vdGlmeTo6dm9sdW1lXCIsICgpID0+IHtcbiAgICB2aXNpYmxlLnNldCh0cnVlKVxuICAgIGhpZGU/LmNhbmNlbCgpXG4gICAgaGlkZSA9IHRpbWVvdXQoMTQwMCwgKCkgPT4gdmlzaWJsZS5zZXQoZmFsc2UpKVxuICB9KVxuXG4gIHJldHVybiA8d2luZG93XG4gICAgbmFtZT1cIm9zZFwiIG5hbWVzcGFjZT1cImtvYmVsLW9zZFwiIGdka21vbml0b3I9e21vbml0b3J9XG4gICAgYW5jaG9yPXtBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NfSBtYXJnaW5Cb3R0b209ezcwfVxuICAgIGNsaWNrVGhyb3VnaCB2aXNpYmxlPXtiaW5kKHZpc2libGUpfT5cbiAgICA8Ym94IGNsYXNzPVwib3NkXCIgc3BhY2luZz17MTF9IHdpZHRoUmVxdWVzdD17MjMwfT5cbiAgICAgIDxpbWFnZSBpY29uTmFtZT17YmluZChzcGVha2VyLCBcInZvbHVtZV9pY29uXCIpfSAvPlxuICAgICAgPGxldmVsYmFyIGhleHBhbmQgdmFsdWU9e2JpbmQoc3BlYWtlciwgXCJ2b2x1bWVcIil9IC8+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJ0blwiIGxhYmVsPXtiaW5kKHNwZWFrZXIsIFwidm9sdW1lXCIpLmFzKHYgPT5cbiAgICAgICAgYCR7TWF0aC5yb3VuZCh2ICogMTAwKX0lYCl9IC8+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuIiwgIi8vIFNlc3Npb24gb3ZlcmxheSBcdTIwMTQgZGltbWVkICgwLjgpLCA0IGJ1dHRvbnMsIGFycm93LW5hdiwgUFJFU1MtQUdBSU4gY29uZmlybSBvblxuLy8gUmVzdGFydC9TaHV0IGRvd24gKGF1dG8tcmV2ZXJ0IDRzKSwgcmVzdGluZyByb3NlIG9uIFNodXQgZG93bi5cbmltcG9ydCB7IEFzdGFsLCBHZGssIEd0ayB9IGZyb20gXCJhc3RhbC9ndGs0XCJcbmltcG9ydCB7IFZhcmlhYmxlLCBiaW5kLCBleGVjQXN5bmMsIHRpbWVvdXQgfSBmcm9tIFwiYXN0YWxcIlxuLy8gUGluIGEgZGV0ZXJtaW5pc3RpYyByZW5kZXIgZm9yIHRoZSBET00tdnMtR1RLIG92ZXJsYXkgZGlmZiAobGFiZWxzL2ljb25zIGFscmVhZHlcbi8vIGZpeGVkOyBpbXBvcnRpbmcgREVNTyBrZWVwcyB0aGUgc3VyZmFjZSByZW5kZXIgY29uc2lzdGVudCB1bmRlciBLT0JFTF9ERU1PKS5cbmltcG9ydCB7IERFTU8sIEQgfSBmcm9tIFwiLi4vbGliL2RlbW9cIlxudm9pZCBERU1POyB2b2lkIERcblxuY29uc3QgQUNUSU9OUyA9IFtcbiAgeyBpZDogXCJsb2NrXCIsIGxhYmVsOiBcIkxvY2tcIiwgaWNvbjogXCJrb2JlbC1sb2NrLXN5bWJvbGljXCIsXG4gICAgY29uZmlybTogZmFsc2UsIHJ1bjogKCkgPT4gZXhlY0FzeW5jKFwibG9naW5jdGwgbG9jay1zZXNzaW9uXCIpIH0sXG4gIHsgaWQ6IFwibG9nb3V0XCIsIGxhYmVsOiBcIkxvZyBvdXRcIiwgaWNvbjogXCJrb2JlbC1sb2dvdXQtc3ltYm9saWNcIixcbiAgICBjb25maXJtOiBmYWxzZSwgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJnbm9tZS1zZXNzaW9uLXF1aXQgLS1sb2dvdXQgLS1uby1wcm9tcHRcIikgfSxcbiAgeyBpZDogXCJyZXN0YXJ0XCIsIGxhYmVsOiBcIlJlc3RhcnRcIiwgaWNvbjogXCJrb2JlbC1yZWxvYWQtc3ltYm9saWNcIixcbiAgICBjb25maXJtOiB0cnVlLCBydW46ICgpID0+IGV4ZWNBc3luYyhcInN5c3RlbWN0bCByZWJvb3RcIikgfSxcbiAgeyBpZDogXCJzaHV0ZG93blwiLCBsYWJlbDogXCJTaHV0IGRvd25cIiwgaWNvbjogXCJrb2JlbC1wb3dlci1zeW1ib2xpY1wiLFxuICAgIGNvbmZpcm06IHRydWUsIHJlZDogdHJ1ZSwgcnVuOiAoKSA9PiBleGVjQXN5bmMoXCJzeXN0ZW1jdGwgcG93ZXJvZmZcIikgfSxcbl1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gU2Vzc2lvbigpIHtcbiAgY29uc3QgYXJtZWQgPSBWYXJpYWJsZTxzdHJpbmcgfCBudWxsPihudWxsKVxuICBsZXQgcmV2ZXJ0OiBSZXR1cm5UeXBlPHR5cGVvZiB0aW1lb3V0PiB8IG51bGwgPSBudWxsXG5cbiAgY29uc3QgcHJlc3MgPSAoYTogdHlwZW9mIEFDVElPTlNbbnVtYmVyXSwgaGlkZTogKCkgPT4gdm9pZCkgPT4ge1xuICAgIGlmIChhLmNvbmZpcm0gJiYgYXJtZWQuZ2V0KCkgIT09IGEuaWQpIHtcbiAgICAgIGFybWVkLnNldChhLmlkKVxuICAgICAgcmV2ZXJ0Py5jYW5jZWwoKVxuICAgICAgcmV2ZXJ0ID0gdGltZW91dCg0MDAwLCAoKSA9PiBhcm1lZC5zZXQobnVsbCkpICAgLy8gYXV0by1yZXZlcnQgKGNyaXRpcXVlKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGFybWVkLnNldChudWxsKTsgaGlkZSgpOyBhLnJ1bigpXG4gIH1cblxuICByZXR1cm4gPHdpbmRvd1xuICAgIG5hbWU9XCJzZXNzaW9uXCIgbmFtZXNwYWNlPVwia29iZWwtc2Vzc2lvblwiIGNsYXNzPVwic2Vzc2lvbi13aW5kb3dcIiB2aXNpYmxlPXtmYWxzZX1cbiAgICBhbmNob3I9e0FzdGFsLldpbmRvd0FuY2hvci5UT1AgfCBBc3RhbC5XaW5kb3dBbmNob3IuQk9UVE9NIHxcbiAgICAgICAgICAgIEFzdGFsLldpbmRvd0FuY2hvci5MRUZUIHwgQXN0YWwuV2luZG93QW5jaG9yLlJJR0hUfVxuICAgIGtleW1vZGU9e0FzdGFsLktleW1vZGUuRVhDTFVTSVZFfSBleGNsdXNpdml0eT17QXN0YWwuRXhjbHVzaXZpdHkuSUdOT1JFfVxuICAgIG9uS2V5UHJlc3NlZD17KHNlbGYsIGtleSkgPT4ge1xuICAgICAgaWYgKGtleSA9PT0gR2RrLktFWV9Fc2NhcGUpIHsgYXJtZWQuc2V0KG51bGwpOyBzZWxmLmhpZGUoKTsgcmV0dXJuIHRydWUgfVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfX0+XG4gICAgey8qIC5zZXNzaW9uIGZpbGxzIHRoZSB3aG9sZSB3aW5kb3cgKHRoZSBkaW0pOyBidXR0b25zIGNlbnRlcmVkIGluc2lkZSAqL31cbiAgICA8Ym94IGNsYXNzPVwic2Vzc2lvblwiIGhleHBhbmQgdmV4cGFuZD5cbiAgICAgIDxib3ggaGFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfSB2YWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHNwYWNpbmc9ezIwfSBoZXhwYW5kPlxuICAgICAgICB7QUNUSU9OUy5tYXAoYSA9PlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9e2EucmVkID8gXCJzYnRuIHJlZFwiIDogXCJzYnRuXCJ9XG4gICAgICAgICAgICBvbkNsaWNrZWQ9e3NlbGYgPT4gcHJlc3MoYSwgKCkgPT4gc2VsZi5nZXRfcm9vdCgpPy5oaWRlPy4oKSl9PlxuICAgICAgICAgICAgPGJveCBvcmllbnRhdGlvbj17R3RrLk9yaWVudGF0aW9uLlZFUlRJQ0FMfSBzcGFjaW5nPXsxMH1cbiAgICAgICAgICAgICAgY2xhc3M9e2JpbmQoYXJtZWQpLmFzKHggPT4geCA9PT0gYS5pZCA/IFwiY29uZmlybVwiIDogXCJcIil9PlxuICAgICAgICAgICAgICA8Ym94IGNsYXNzPVwic2ljXCIgaGV4cGFuZD17ZmFsc2V9IHZleHBhbmQ9e2ZhbHNlfVxuICAgICAgICAgICAgICAgIGhhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gdmFsaWduPXtHdGsuQWxpZ24uQ0VOVEVSfT5cbiAgICAgICAgICAgICAgICB7LyogaG9yaXpvbnRhbCBHdGtCb3ggaWdub3JlcyBhIGNoaWxkJ3MgbWFpbi1heGlzIGhhbGlnbiwgc28gdGhlIGljb25cbiAgICAgICAgICAgICAgICAgICAgbGVmdC1wYWNrczsgaGV4cGFuZCBtYWtlcyB0aGUgaW1hZ2UgZmlsbCB0aGUgNTlweCB0aWxlIFx1MjE5MiBHdGtJbWFnZVxuICAgICAgICAgICAgICAgICAgICBjZW50cmVzIHRoZSBnbHlwaC4gaGV4cGFuZD17ZmFsc2V9IG9uIC5zaWMgYmxvY2tzIHByb3BhZ2F0aW9uIHNvIHRoZVxuICAgICAgICAgICAgICAgICAgICB0aWxlIHN0YXlzIDU5IHdpZGUgaW5zdGVhZCBvZiBzdHJldGNoaW5nIHRoZSByb3cuICovfVxuICAgICAgICAgICAgICAgIDxpbWFnZSBpY29uTmFtZT17YS5pY29ufSBwaXhlbFNpemU9ezIyfSBoZXhwYW5kXG4gICAgICAgICAgICAgICAgICBoYWxpZ249e0d0ay5BbGlnbi5DRU5URVJ9IHZhbGlnbj17R3RrLkFsaWduLkNFTlRFUn0gLz5cbiAgICAgICAgICAgICAgPC9ib3g+XG4gICAgICAgICAgICAgIDxsYWJlbCBsYWJlbD17YmluZChhcm1lZCkuYXMoeCA9PiB4ID09PSBhLmlkID8gXCJQcmVzcyBhZ2FpblwiIDogYS5sYWJlbCl9IC8+XG4gICAgICAgICAgICA8L2JveD5cbiAgICAgICAgICA8L2J1dHRvbj4pfVxuICAgICAgPC9ib3g+XG4gICAgPC9ib3g+XG4gIDwvd2luZG93PlxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU9BLFlBQVc7QUFDbEIsT0FBT0MsVUFBUztBQUNoQixPQUFPQyxVQUFTOzs7QUNGaEIsT0FBT0MsWUFBVzs7O0FDQVgsSUFBTSxXQUFXLENBQUMsUUFBZ0IsSUFDcEMsUUFBUSxtQkFBbUIsT0FBTyxFQUNsQyxXQUFXLEtBQUssR0FBRyxFQUNuQixZQUFZO0FBRVYsSUFBTSxXQUFXLENBQUMsUUFBZ0IsSUFDcEMsUUFBUSxtQkFBbUIsT0FBTyxFQUNsQyxXQUFXLEtBQUssR0FBRyxFQUNuQixZQUFZO0FBY1YsSUFBTSxVQUFOLE1BQU0sU0FBZTtBQUFBLEVBQ2hCLGNBQWMsQ0FBQyxNQUFXO0FBQUEsRUFFbEM7QUFBQSxFQUNBO0FBQUEsRUFTQSxPQUFPLEtBQUssU0FBcUMsTUFBZTtBQUM1RCxXQUFPLElBQUksU0FBUSxTQUFTLElBQUk7QUFBQSxFQUNwQztBQUFBLEVBRVEsWUFBWSxTQUE0QyxNQUFlO0FBQzNFLFNBQUssV0FBVztBQUNoQixTQUFLLFFBQVEsUUFBUSxTQUFTLElBQUk7QUFBQSxFQUN0QztBQUFBLEVBRUEsV0FBVztBQUNQLFdBQU8sV0FBVyxLQUFLLFFBQVEsR0FBRyxLQUFLLFFBQVEsTUFBTSxLQUFLLEtBQUssTUFBTSxFQUFFO0FBQUEsRUFDM0U7QUFBQSxFQUVBLEdBQU0sSUFBaUM7QUFDbkMsVUFBTUMsUUFBTyxJQUFJLFNBQVEsS0FBSyxVQUFVLEtBQUssS0FBSztBQUNsRCxJQUFBQSxNQUFLLGNBQWMsQ0FBQyxNQUFhLEdBQUcsS0FBSyxZQUFZLENBQUMsQ0FBQztBQUN2RCxXQUFPQTtBQUFBLEVBQ1g7QUFBQSxFQUVBLE1BQWE7QUFDVCxRQUFJLE9BQU8sS0FBSyxTQUFTLFFBQVE7QUFDN0IsYUFBTyxLQUFLLFlBQVksS0FBSyxTQUFTLElBQUksQ0FBQztBQUUvQyxRQUFJLE9BQU8sS0FBSyxVQUFVLFVBQVU7QUFDaEMsWUFBTSxTQUFTLE9BQU8sU0FBUyxLQUFLLEtBQUssQ0FBQztBQUMxQyxVQUFJLE9BQU8sS0FBSyxTQUFTLE1BQU0sTUFBTTtBQUNqQyxlQUFPLEtBQUssWUFBWSxLQUFLLFNBQVMsTUFBTSxFQUFFLENBQUM7QUFFbkQsYUFBTyxLQUFLLFlBQVksS0FBSyxTQUFTLEtBQUssS0FBSyxDQUFDO0FBQUEsSUFDckQ7QUFFQSxVQUFNLE1BQU0sOEJBQThCO0FBQUEsRUFDOUM7QUFBQSxFQUVBLFVBQVUsVUFBOEM7QUFDcEQsUUFBSSxPQUFPLEtBQUssU0FBUyxjQUFjLFlBQVk7QUFDL0MsYUFBTyxLQUFLLFNBQVMsVUFBVSxNQUFNO0FBQ2pDLGlCQUFTLEtBQUssSUFBSSxDQUFDO0FBQUEsTUFDdkIsQ0FBQztBQUFBLElBQ0wsV0FBVyxPQUFPLEtBQUssU0FBUyxZQUFZLFlBQVk7QUFDcEQsWUFBTSxTQUFTLFdBQVcsS0FBSyxLQUFLO0FBQ3BDLFlBQU0sS0FBSyxLQUFLLFNBQVMsUUFBUSxRQUFRLE1BQU07QUFDM0MsaUJBQVMsS0FBSyxJQUFJLENBQUM7QUFBQSxNQUN2QixDQUFDO0FBQ0QsYUFBTyxNQUFNO0FBQ1QsUUFBQyxLQUFLLFNBQVMsV0FBeUMsRUFBRTtBQUFBLE1BQzlEO0FBQUEsSUFDSjtBQUNBLFVBQU0sTUFBTSxHQUFHLEtBQUssUUFBUSxrQkFBa0I7QUFBQSxFQUNsRDtBQUNKO0FBRU8sSUFBTSxFQUFFLEtBQUssSUFBSTtBQUN4QixJQUFPLGtCQUFROzs7QUN4RmYsT0FBTyxXQUFXO0FBR1gsSUFBTSxPQUFPLE1BQU07QUFFbkIsU0FBUyxTQUFTQyxXQUFrQixVQUF1QjtBQUM5RCxTQUFPLE1BQU0sS0FBSyxTQUFTQSxXQUFVLE1BQU0sS0FBSyxXQUFXLENBQUM7QUFDaEU7QUFFTyxTQUFTLFFBQVFDLFVBQWlCLFVBQXVCO0FBQzVELFNBQU8sTUFBTSxLQUFLLFFBQVFBLFVBQVMsTUFBTSxLQUFLLFdBQVcsQ0FBQztBQUM5RDs7O0FDWEEsT0FBT0MsWUFBVztBQVNYLElBQU0sVUFBVUEsT0FBTTtBQVV0QixTQUFTLFdBQ1osV0FDQSxRQUFrQyxPQUNsQyxRQUFrQyxVQUNwQztBQUNFLFFBQU0sT0FBTyxNQUFNLFFBQVEsU0FBUyxLQUFLLE9BQU8sY0FBYztBQUM5RCxRQUFNLEVBQUUsS0FBSyxLQUFLLElBQUksSUFBSTtBQUFBLElBQ3RCLEtBQUssT0FBTyxZQUFZLFVBQVU7QUFBQSxJQUNsQyxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU87QUFBQSxJQUNyQyxLQUFLLE9BQU8sUUFBUSxVQUFVLE9BQU87QUFBQSxFQUN6QztBQUVBLFFBQU0sT0FBTyxNQUFNLFFBQVEsR0FBRyxJQUN4QkEsT0FBTSxRQUFRLFlBQVksR0FBRyxJQUM3QkEsT0FBTSxRQUFRLFdBQVcsR0FBRztBQUVsQyxPQUFLLFFBQVEsVUFBVSxDQUFDLEdBQUcsV0FBbUIsSUFBSSxNQUFNLENBQUM7QUFDekQsT0FBSyxRQUFRLFVBQVUsQ0FBQyxHQUFHLFdBQW1CLElBQUksTUFBTSxDQUFDO0FBQ3pELFNBQU87QUFDWDtBQVNPLFNBQVMsVUFBVSxLQUF5QztBQUMvRCxTQUFPLElBQUksUUFBUSxDQUFDLFNBQVMsV0FBVztBQUNwQyxRQUFJLE1BQU0sUUFBUSxHQUFHLEdBQUc7QUFDcEIsTUFBQUMsT0FBTSxRQUFRLFlBQVksS0FBSyxDQUFDLEdBQUcsUUFBUTtBQUN2QyxZQUFJO0FBQ0Esa0JBQVFBLE9BQU0sUUFBUSxtQkFBbUIsR0FBRyxDQUFDO0FBQUEsUUFDakQsU0FBUyxPQUFPO0FBQ1osaUJBQU8sS0FBSztBQUFBLFFBQ2hCO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDTCxPQUFPO0FBQ0gsTUFBQUEsT0FBTSxRQUFRLFdBQVcsS0FBSyxDQUFDLEdBQUcsUUFBUTtBQUN0QyxZQUFJO0FBQ0Esa0JBQVFBLE9BQU0sUUFBUSxZQUFZLEdBQUcsQ0FBQztBQUFBLFFBQzFDLFNBQVMsT0FBTztBQUNaLGlCQUFPLEtBQUs7QUFBQSxRQUNoQjtBQUFBLE1BQ0osQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNKLENBQUM7QUFDTDs7O0FIOURBLElBQU0sa0JBQU4sY0FBaUMsU0FBUztBQUFBLEVBQzlCO0FBQUEsRUFDQSxhQUFjLFFBQVE7QUFBQSxFQUV0QjtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFFQSxlQUFlO0FBQUEsRUFDZjtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFFQTtBQUFBLEVBQ0E7QUFBQSxFQUVSLFlBQVlDLE9BQVM7QUFDakIsVUFBTTtBQUNOLFNBQUssU0FBU0E7QUFDZCxTQUFLLFdBQVcsSUFBSUMsT0FBTSxhQUFhO0FBQ3ZDLFNBQUssU0FBUyxRQUFRLFdBQVcsTUFBTTtBQUNuQyxXQUFLLFVBQVU7QUFDZixXQUFLLFNBQVM7QUFBQSxJQUNsQixDQUFDO0FBQ0QsU0FBSyxTQUFTLFFBQVEsU0FBUyxDQUFDLEdBQUcsUUFBUSxLQUFLLGFBQWEsR0FBRyxDQUFDO0FBQ2pFLFdBQU8sSUFBSSxNQUFNLE1BQU07QUFBQSxNQUNuQixPQUFPLENBQUMsUUFBUSxHQUFHLFNBQVMsT0FBTyxNQUFNLEtBQUssQ0FBQyxDQUFDO0FBQUEsSUFDcEQsQ0FBQztBQUFBLEVBQ0w7QUFBQSxFQUVRLE1BQWEsV0FBeUM7QUFDMUQsVUFBTSxJQUFJLGdCQUFRLEtBQUssSUFBSTtBQUMzQixXQUFPLFlBQVksRUFBRSxHQUFHLFNBQVMsSUFBSTtBQUFBLEVBQ3pDO0FBQUEsRUFFQSxXQUFXO0FBQ1AsV0FBTyxPQUFPLFlBQVksS0FBSyxJQUFJLENBQUMsR0FBRztBQUFBLEVBQzNDO0FBQUEsRUFFQSxNQUFTO0FBQUUsV0FBTyxLQUFLO0FBQUEsRUFBTztBQUFBLEVBQzlCLElBQUksT0FBVTtBQUNWLFFBQUksVUFBVSxLQUFLLFFBQVE7QUFDdkIsV0FBSyxTQUFTO0FBQ2QsV0FBSyxTQUFTLEtBQUssU0FBUztBQUFBLElBQ2hDO0FBQUEsRUFDSjtBQUFBLEVBRUEsWUFBWTtBQUNSLFFBQUksS0FBSztBQUNMO0FBRUosUUFBSSxLQUFLLFFBQVE7QUFDYixXQUFLLFFBQVEsU0FBUyxLQUFLLGNBQWMsTUFBTTtBQUMzQyxjQUFNLElBQUksS0FBSyxPQUFRLEtBQUssSUFBSSxDQUFDO0FBQ2pDLFlBQUksYUFBYSxTQUFTO0FBQ3RCLFlBQUUsS0FBSyxDQUFBQyxPQUFLLEtBQUssSUFBSUEsRUFBQyxDQUFDLEVBQ2xCLE1BQU0sU0FBTyxLQUFLLFNBQVMsS0FBSyxTQUFTLEdBQUcsQ0FBQztBQUFBLFFBQ3RELE9BQU87QUFDSCxlQUFLLElBQUksQ0FBQztBQUFBLFFBQ2Q7QUFBQSxNQUNKLENBQUM7QUFBQSxJQUNMLFdBQVcsS0FBSyxVQUFVO0FBQ3RCLFdBQUssUUFBUSxTQUFTLEtBQUssY0FBYyxNQUFNO0FBQzNDLGtCQUFVLEtBQUssUUFBUyxFQUNuQixLQUFLLE9BQUssS0FBSyxJQUFJLEtBQUssY0FBZSxHQUFHLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUN0RCxNQUFNLFNBQU8sS0FBSyxTQUFTLEtBQUssU0FBUyxHQUFHLENBQUM7QUFBQSxNQUN0RCxDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0o7QUFBQSxFQUVBLGFBQWE7QUFDVCxRQUFJLEtBQUs7QUFDTDtBQUVKLFNBQUssU0FBUyxXQUFXO0FBQUEsTUFDckIsS0FBSyxLQUFLO0FBQUEsTUFDVixLQUFLLFNBQU8sS0FBSyxJQUFJLEtBQUssZUFBZ0IsS0FBSyxLQUFLLElBQUksQ0FBQyxDQUFDO0FBQUEsTUFDMUQsS0FBSyxTQUFPLEtBQUssU0FBUyxLQUFLLFNBQVMsR0FBRztBQUFBLElBQy9DLENBQUM7QUFBQSxFQUNMO0FBQUEsRUFFQSxXQUFXO0FBQ1AsU0FBSyxPQUFPLE9BQU87QUFDbkIsV0FBTyxLQUFLO0FBQUEsRUFDaEI7QUFBQSxFQUVBLFlBQVk7QUFDUixTQUFLLFFBQVEsS0FBSztBQUNsQixXQUFPLEtBQUs7QUFBQSxFQUNoQjtBQUFBLEVBRUEsWUFBWTtBQUFFLFdBQU8sQ0FBQyxDQUFDLEtBQUs7QUFBQSxFQUFNO0FBQUEsRUFDbEMsYUFBYTtBQUFFLFdBQU8sQ0FBQyxDQUFDLEtBQUs7QUFBQSxFQUFPO0FBQUEsRUFFcEMsT0FBTztBQUNILFNBQUssU0FBUyxLQUFLLFNBQVM7QUFBQSxFQUNoQztBQUFBLEVBRUEsVUFBVSxVQUFzQjtBQUM1QixTQUFLLFNBQVMsUUFBUSxXQUFXLFFBQVE7QUFDekMsV0FBTztBQUFBLEVBQ1g7QUFBQSxFQUVBLFFBQVEsVUFBaUM7QUFDckMsV0FBTyxLQUFLO0FBQ1osU0FBSyxTQUFTLFFBQVEsU0FBUyxDQUFDLEdBQUcsUUFBUSxTQUFTLEdBQUcsQ0FBQztBQUN4RCxXQUFPO0FBQUEsRUFDWDtBQUFBLEVBRUEsVUFBVSxVQUE4QjtBQUNwQyxVQUFNLEtBQUssS0FBSyxTQUFTLFFBQVEsV0FBVyxNQUFNO0FBQzlDLGVBQVMsS0FBSyxJQUFJLENBQUM7QUFBQSxJQUN2QixDQUFDO0FBQ0QsV0FBTyxNQUFNLEtBQUssU0FBUyxXQUFXLEVBQUU7QUFBQSxFQUM1QztBQUFBLEVBYUEsS0FDSUMsV0FDQSxNQUNBLFlBQTRDLFNBQU8sS0FDckQ7QUFDRSxTQUFLLFNBQVM7QUFDZCxTQUFLLGVBQWVBO0FBQ3BCLFNBQUssZ0JBQWdCO0FBQ3JCLFFBQUksT0FBTyxTQUFTLFlBQVk7QUFDNUIsV0FBSyxTQUFTO0FBQ2QsYUFBTyxLQUFLO0FBQUEsSUFDaEIsT0FBTztBQUNILFdBQUssV0FBVztBQUNoQixhQUFPLEtBQUs7QUFBQSxJQUNoQjtBQUNBLFNBQUssVUFBVTtBQUNmLFdBQU87QUFBQSxFQUNYO0FBQUEsRUFFQSxNQUNJLE1BQ0EsWUFBNEMsU0FBTyxLQUNyRDtBQUNFLFNBQUssVUFBVTtBQUNmLFNBQUssWUFBWTtBQUNqQixTQUFLLGlCQUFpQjtBQUN0QixTQUFLLFdBQVc7QUFDaEIsV0FBTztBQUFBLEVBQ1g7QUFBQSxFQWFBLFFBQ0ksTUFDQSxTQUNBLFVBQ0Y7QUFDRSxVQUFNLElBQUksT0FBTyxZQUFZLGFBQWEsVUFBVSxhQUFhLE1BQU0sS0FBSyxJQUFJO0FBQ2hGLFVBQU0sTUFBTSxDQUFDLFFBQXFCLFNBQWdCLEtBQUssSUFBSSxFQUFFLEtBQUssR0FBRyxJQUFJLENBQUM7QUFFMUUsUUFBSSxNQUFNLFFBQVEsSUFBSSxHQUFHO0FBQ3JCLGlCQUFXLE9BQU8sTUFBTTtBQUNwQixjQUFNLENBQUMsR0FBRyxDQUFDLElBQUk7QUFDZixjQUFNLEtBQUssRUFBRSxRQUFRLEdBQUcsR0FBRztBQUMzQixhQUFLLFVBQVUsTUFBTSxFQUFFLFdBQVcsRUFBRSxDQUFDO0FBQUEsTUFDekM7QUFBQSxJQUNKLE9BQU87QUFDSCxVQUFJLE9BQU8sWUFBWSxVQUFVO0FBQzdCLGNBQU0sS0FBSyxLQUFLLFFBQVEsU0FBUyxHQUFHO0FBQ3BDLGFBQUssVUFBVSxNQUFNLEtBQUssV0FBVyxFQUFFLENBQUM7QUFBQSxNQUM1QztBQUFBLElBQ0o7QUFFQSxXQUFPO0FBQUEsRUFDWDtBQUFBLEVBRUEsT0FBTyxPQU1MLE1BQVksS0FBMkIsSUFBSSxTQUFTLE1BQXNCO0FBQ3hFLFVBQU0sU0FBUyxNQUFNLEdBQUcsR0FBRyxLQUFLLElBQUksT0FBSyxFQUFFLElBQUksQ0FBQyxDQUFTO0FBQ3pELFVBQU0sVUFBVSxJQUFJLFNBQVMsT0FBTyxDQUFDO0FBQ3JDLFVBQU0sU0FBUyxLQUFLLElBQUksU0FBTyxJQUFJLFVBQVUsTUFBTSxRQUFRLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQztBQUN6RSxZQUFRLFVBQVUsTUFBTSxPQUFPLElBQUksV0FBUyxNQUFNLENBQUMsQ0FBQztBQUNwRCxXQUFPO0FBQUEsRUFDWDtBQUNKO0FBT08sSUFBTSxXQUFXLElBQUksTUFBTSxpQkFBd0I7QUFBQSxFQUN0RCxPQUFPLENBQUMsSUFBSSxJQUFJLFNBQVMsSUFBSSxnQkFBZ0IsS0FBSyxDQUFDLENBQUM7QUFDeEQsQ0FBQztBQU1NLElBQU0sRUFBRSxPQUFPLElBQUk7QUFDMUIsSUFBTyxtQkFBUTs7O0FJOU5SLElBQU0sb0JBQW9CLE9BQU8sd0JBQXdCO0FBQ3pELElBQU0sY0FBYyxPQUFPLHdCQUF3QjtBQUVuRCxTQUFTLGNBQWMsT0FBYztBQUN4QyxXQUFTLGFBQWEsTUFBYTtBQUMvQixRQUFJLElBQUk7QUFDUixXQUFPLE1BQU07QUFBQSxNQUFJLFdBQVMsaUJBQWlCLGtCQUNyQyxLQUFLLEdBQUcsSUFDUjtBQUFBLElBQ047QUFBQSxFQUNKO0FBRUEsUUFBTSxXQUFXLE1BQU0sT0FBTyxPQUFLLGFBQWEsZUFBTztBQUV2RCxNQUFJLFNBQVMsV0FBVztBQUNwQixXQUFPO0FBRVgsTUFBSSxTQUFTLFdBQVc7QUFDcEIsV0FBTyxTQUFTLENBQUMsRUFBRSxHQUFHLFNBQVM7QUFFbkMsU0FBTyxpQkFBUyxPQUFPLFVBQVUsU0FBUyxFQUFFO0FBQ2hEO0FBRU8sU0FBUyxRQUFRLEtBQVUsTUFBYyxPQUFZO0FBQ3hELE1BQUk7QUFDQSxVQUFNLFNBQVMsT0FBTyxTQUFTLElBQUksQ0FBQztBQUNwQyxRQUFJLE9BQU8sSUFBSSxNQUFNLE1BQU07QUFDdkIsYUFBTyxJQUFJLE1BQU0sRUFBRSxLQUFLO0FBRTVCLFdBQVEsSUFBSSxJQUFJLElBQUk7QUFBQSxFQUN4QixTQUFTLE9BQU87QUFDWixZQUFRLE1BQU0sMkJBQTJCLElBQUksUUFBUSxHQUFHLEtBQUssS0FBSztBQUFBLEVBQ3RFO0FBQ0o7QUFNTyxTQUFTLEtBQ1osUUFDQSxRQUNBLGtCQUNBLFVBQ0Y7QUFDRSxNQUFJLE9BQU8sT0FBTyxZQUFZLGNBQWMsVUFBVTtBQUNsRCxVQUFNLEtBQUssT0FBTyxRQUFRLGtCQUFrQixDQUFDLE1BQVcsU0FBb0I7QUFDeEUsYUFBTyxTQUFTLFFBQVEsR0FBRyxJQUFJO0FBQUEsSUFDbkMsQ0FBQztBQUNELFdBQU8sUUFBUSxXQUFXLE1BQU07QUFDNUIsTUFBQyxPQUFPLFdBQXlDLEVBQUU7QUFBQSxJQUN2RCxDQUFDO0FBQUEsRUFDTCxXQUFXLE9BQU8sT0FBTyxjQUFjLGNBQWMsT0FBTyxxQkFBcUIsWUFBWTtBQUN6RixVQUFNLFFBQVEsT0FBTyxVQUFVLElBQUksU0FBb0I7QUFDbkQsdUJBQWlCLFFBQVEsR0FBRyxJQUFJO0FBQUEsSUFDcEMsQ0FBQztBQUNELFdBQU8sUUFBUSxXQUFXLEtBQUs7QUFBQSxFQUNuQztBQUNKO0FBRU8sU0FBUyxVQUFxRixRQUFnQixRQUFhO0FBRTlILE1BQUksRUFBRSxPQUFPLE9BQU8sV0FBVyxDQUFDLEdBQUcsR0FBRyxNQUFNLElBQUk7QUFFaEQsTUFBSSxvQkFBb0IsaUJBQVM7QUFDN0IsZUFBVyxDQUFDLFFBQVE7QUFBQSxFQUN4QjtBQUVBLE1BQUksT0FBTztBQUNQLGFBQVMsUUFBUSxLQUFLO0FBQUEsRUFDMUI7QUFHQSxhQUFXLENBQUNDLE1BQUssS0FBSyxLQUFLLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDOUMsUUFBSSxVQUFVLFFBQVc7QUFDckIsYUFBTyxNQUFNQSxJQUFHO0FBQUEsSUFDcEI7QUFBQSxFQUNKO0FBR0EsUUFBTSxXQUEwQyxPQUMzQyxLQUFLLEtBQUssRUFDVixPQUFPLENBQUMsS0FBVSxTQUFTO0FBQ3hCLFFBQUksTUFBTSxJQUFJLGFBQWEsaUJBQVM7QUFDaEMsWUFBTSxVQUFVLE1BQU0sSUFBSTtBQUMxQixhQUFPLE1BQU0sSUFBSTtBQUNqQixhQUFPLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxPQUFPLENBQUM7QUFBQSxJQUNuQztBQUNBLFdBQU87QUFBQSxFQUNYLEdBQUcsQ0FBQyxDQUFDO0FBR1QsUUFBTSxhQUF3RCxPQUN6RCxLQUFLLEtBQUssRUFDVixPQUFPLENBQUMsS0FBVUEsU0FBUTtBQUN2QixRQUFJQSxLQUFJLFdBQVcsSUFBSSxHQUFHO0FBQ3RCLFlBQU0sTUFBTSxTQUFTQSxJQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsTUFBTSxDQUFDLEVBQUUsS0FBSyxHQUFHO0FBQ3RELFlBQU0sVUFBVSxNQUFNQSxJQUFHO0FBQ3pCLGFBQU8sTUFBTUEsSUFBRztBQUNoQixhQUFPLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBSyxPQUFPLENBQUM7QUFBQSxJQUNsQztBQUNBLFdBQU87QUFBQSxFQUNYLEdBQUcsQ0FBQyxDQUFDO0FBR1QsUUFBTSxpQkFBaUIsY0FBYyxTQUFTLEtBQUssUUFBUSxDQUFDO0FBQzVELE1BQUksMEJBQTBCLGlCQUFTO0FBQ25DLFdBQU8sV0FBVyxFQUFFLGVBQWUsSUFBSSxDQUFDO0FBQ3hDLFdBQU8sUUFBUSxXQUFXLGVBQWUsVUFBVSxDQUFDLE1BQU07QUFDdEQsYUFBTyxXQUFXLEVBQUUsQ0FBQztBQUFBLElBQ3pCLENBQUMsQ0FBQztBQUFBLEVBQ04sT0FBTztBQUNILFFBQUksZUFBZSxTQUFTLEdBQUc7QUFDM0IsYUFBTyxXQUFXLEVBQUUsY0FBYztBQUFBLElBQ3RDO0FBQUEsRUFDSjtBQUdBLGFBQVcsQ0FBQyxRQUFRLFFBQVEsS0FBSyxZQUFZO0FBQ3pDLFVBQU0sTUFBTSxPQUFPLFdBQVcsUUFBUSxJQUNoQyxPQUFPLFFBQVEsS0FBSyxJQUFJLElBQ3hCO0FBRU4sUUFBSSxPQUFPLGFBQWEsWUFBWTtBQUNoQyxhQUFPLFFBQVEsS0FBSyxRQUFRO0FBQUEsSUFDaEMsT0FBTztBQUNILGFBQU8sUUFBUSxLQUFLLE1BQU0sVUFBVSxRQUFRLEVBQ3ZDLEtBQUssS0FBSyxFQUFFLE1BQU0sUUFBUSxLQUFLLENBQUM7QUFBQSxJQUN6QztBQUFBLEVBQ0o7QUFHQSxhQUFXLENBQUMsTUFBTSxPQUFPLEtBQUssVUFBVTtBQUNwQyxRQUFJLFNBQVMsV0FBVyxTQUFTLFlBQVk7QUFDekMsYUFBTyxRQUFRLFdBQVcsUUFBUSxVQUFVLENBQUMsTUFBVztBQUNwRCxlQUFPLFdBQVcsRUFBRSxDQUFDO0FBQUEsTUFDekIsQ0FBQyxDQUFDO0FBQUEsSUFDTjtBQUNBLFdBQU8sUUFBUSxXQUFXLFFBQVEsVUFBVSxDQUFDLE1BQVc7QUFDcEQsY0FBUSxRQUFRLE1BQU0sQ0FBQztBQUFBLElBQzNCLENBQUMsQ0FBQztBQUNGLFlBQVEsUUFBUSxNQUFNLFFBQVEsSUFBSSxDQUFDO0FBQUEsRUFDdkM7QUFHQSxhQUFXLENBQUNBLE1BQUssS0FBSyxLQUFLLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDOUMsUUFBSSxVQUFVLFFBQVc7QUFDckIsYUFBTyxNQUFNQSxJQUFHO0FBQUEsSUFDcEI7QUFBQSxFQUNKO0FBRUEsU0FBTyxPQUFPLFFBQVEsS0FBSztBQUMzQixVQUFRLE1BQU07QUFDZCxTQUFPO0FBQ1g7QUFFQSxTQUFTLGdCQUFnQixNQUF1QztBQUM1RCxTQUFPLENBQUMsT0FBTyxPQUFPLE1BQU0sV0FBVztBQUMzQztBQUVPLFNBQVMsSUFDWkMsUUFDQSxNQUNBLEVBQUUsVUFBVSxHQUFHLE1BQU0sR0FDdkI7QUFDRSxlQUFhLENBQUM7QUFFZCxNQUFJLENBQUMsTUFBTSxRQUFRLFFBQVE7QUFDdkIsZUFBVyxDQUFDLFFBQVE7QUFFeEIsYUFBVyxTQUFTLE9BQU8sT0FBTztBQUVsQyxNQUFJLFNBQVMsV0FBVztBQUNwQixVQUFNLFFBQVEsU0FBUyxDQUFDO0FBQUEsV0FDbkIsU0FBUyxTQUFTO0FBQ3ZCLFVBQU0sV0FBVztBQUVyQixNQUFJLE9BQU8sU0FBUyxVQUFVO0FBQzFCLFFBQUksZ0JBQWdCQSxPQUFNLElBQUksQ0FBQztBQUMzQixhQUFPQSxPQUFNLElBQUksRUFBRSxLQUFLO0FBRTVCLFdBQU8sSUFBSUEsT0FBTSxJQUFJLEVBQUUsS0FBSztBQUFBLEVBQ2hDO0FBRUEsTUFBSSxnQkFBZ0IsSUFBSTtBQUNwQixXQUFPLEtBQUssS0FBSztBQUVyQixTQUFPLElBQUksS0FBSyxLQUFLO0FBQ3pCOzs7QUMvTEEsT0FBTyxTQUFTO0FBQ2hCLE9BQU8sU0FBUztBQUdULElBQU0sT0FBTyxPQUFPLFlBQVk7QUFDdkMsSUFBTSxjQUFjLElBQUksSUFBSTtBQUU1QixTQUFTLGFBQWEsUUFBdUM7QUFDekQsTUFBSSxlQUFlLFVBQVUsT0FBTyxPQUFPLGFBQWEsWUFBWTtBQUNoRSxXQUFPLE9BQU8sVUFBVSxJQUFJLENBQUMsT0FBTyxVQUFVLENBQUMsSUFBSSxDQUFDO0FBQUEsRUFDeEQ7QUFFQSxRQUFNLFdBQThCLENBQUM7QUFDckMsTUFBSSxLQUFLLE9BQU8sZ0JBQWdCO0FBQ2hDLFNBQU8sT0FBTyxNQUFNO0FBQ2hCLGFBQVMsS0FBSyxFQUFFO0FBQ2hCLFNBQUssR0FBRyxpQkFBaUI7QUFBQSxFQUM3QjtBQUNBLFNBQU87QUFDWDtBQUVBLFNBQVMsYUFBYSxRQUFvQixVQUFpQjtBQUN2RCxhQUFXLFNBQVMsS0FBSyxRQUFRLEVBQUUsSUFBSSxRQUFNLGNBQWMsSUFBSSxTQUN6RCxLQUNBLElBQUksSUFBSSxNQUFNLEVBQUUsU0FBUyxNQUFNLE9BQU8sT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBR3pELGFBQVcsU0FBUyxVQUFVO0FBQzFCLFdBQU87QUFBQSxNQUNIO0FBQUEsTUFDQTtBQUFBLE1BQ0EsUUFBUSxRQUFRLE1BQU0sSUFBSSxJQUFJO0FBQUEsSUFDbEM7QUFBQSxFQUNKO0FBQ0o7QUFPZSxTQUFSLFNBSUwsS0FBc0MsU0FBa0MsQ0FBQyxHQUFHO0FBQzFFLFNBQU8sT0FBTyxJQUFJLFdBQVc7QUFBQSxJQUN6QixDQUFDLFdBQVcsRUFBRSxVQUFpQjtBQUMzQixZQUFNLElBQUk7QUFDVixpQkFBVyxTQUFVLE9BQU8sY0FBYyxDQUFDLEtBQUssYUFBYSxDQUFDLEdBQUk7QUFDOUQsWUFBSSxpQkFBaUIsSUFBSSxRQUFRO0FBQzdCLGdCQUFNLFNBQVM7QUFDZixjQUFJLENBQUMsU0FBUyxTQUFTLEtBQUssS0FBSyxxQkFBcUI7QUFDbEQsa0JBQU0sWUFBWTtBQUFBLFFBQzFCO0FBQUEsTUFDSjtBQUVBLFVBQUksT0FBTyxhQUFhO0FBQ3BCLGVBQU8sWUFBWSxHQUFHLFFBQVE7QUFBQSxNQUNsQyxPQUFPO0FBQ0gscUJBQWEsR0FBRyxRQUFRO0FBQUEsTUFDNUI7QUFBQSxJQUNKO0FBQUEsRUFDSixDQUFDO0FBRUQsU0FBTztBQUFBLElBQ0gsQ0FBQyxJQUFJLElBQUksR0FBRyxDQUNSLFFBQWdELENBQUMsTUFDOUMsYUFDTTtBQUNULFlBQU0sU0FBUyxJQUFJLElBQUksYUFBYSxRQUFRLEVBQUUsU0FBUyxNQUFNLFFBQVEsSUFBSSxDQUFDLENBQUM7QUFFM0UsVUFBSSxhQUFhLE9BQU87QUFDcEIsZUFBTyxNQUFNO0FBQUEsTUFDakI7QUFFQSxVQUFJLE1BQU0sbUJBQW1CO0FBQ3pCLGVBQU8sT0FBTyxRQUFRLEVBQUUsQ0FBQyxpQkFBaUIsR0FBRyxLQUFLLENBQUM7QUFDbkQsZUFBTyxNQUFNO0FBQUEsTUFDakI7QUFFQSxVQUFJLE1BQU0sTUFBTTtBQUNaLGVBQU8sT0FBTyxRQUFRLEVBQUUsQ0FBQyxJQUFJLEdBQUcsTUFBTSxLQUFLLENBQUM7QUFDNUMsZUFBTyxNQUFNO0FBQUEsTUFDakI7QUFFQSxVQUFJLFNBQVMsU0FBUyxHQUFHO0FBQ3JCLGVBQU8sT0FBTyxPQUFPLEVBQUUsU0FBUyxDQUFDO0FBQUEsTUFDckM7QUFFQSxhQUFPLFVBQVUsUUFBZSxpQkFBaUIsUUFBUSxLQUFZLENBQUM7QUFBQSxJQUMxRTtBQUFBLEVBQ0osRUFBRSxJQUFJLElBQUk7QUFDZDtBQWdEQSxTQUFTLGlCQUFvQixRQUFvQjtBQUFBLEVBQzdDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQSxHQUFHO0FBQ1AsR0FBb0M7QUFDaEMsTUFBSSxnQkFBZ0IsY0FBYztBQUM5QixVQUFNLFFBQVEsSUFBSSxJQUFJO0FBQ3RCLFdBQU8sZUFBZSxLQUFLO0FBRTNCLFFBQUk7QUFDQSxZQUFNLFFBQVEsU0FBUyxNQUFNLGFBQWEsTUFBTSxDQUFDO0FBRXJELFFBQUk7QUFDQSxZQUFNLFFBQVEsU0FBUyxNQUFNLGFBQWEsTUFBTSxDQUFDO0FBQUEsRUFDekQ7QUFFQSxNQUFJLGdCQUFnQixpQkFBaUIsZUFBZTtBQUNoRCxVQUFNQyxPQUFNLElBQUksSUFBSTtBQUNwQixXQUFPLGVBQWVBLElBQUc7QUFFekIsUUFBSTtBQUNBLE1BQUFBLEtBQUksUUFBUSxlQUFlLENBQUMsR0FBRyxLQUFLLE1BQU0sVUFBVSxhQUFhLFFBQVEsS0FBSyxNQUFNLEtBQUssQ0FBQztBQUU5RixRQUFJO0FBQ0EsTUFBQUEsS0FBSSxRQUFRLGdCQUFnQixDQUFDLEdBQUcsS0FBSyxNQUFNLFVBQVUsY0FBYyxRQUFRLEtBQUssTUFBTSxLQUFLLENBQUM7QUFFaEcsUUFBSTtBQUNBLE1BQUFBLEtBQUksUUFBUSxhQUFhLENBQUMsR0FBRyxVQUFVLGNBQWMsUUFBUSxLQUFLLENBQUM7QUFBQSxFQUMzRTtBQUVBLE1BQUksWUFBWSxtQkFBbUIsa0JBQWtCO0FBQ2pELFVBQU0sU0FBUyxJQUFJLElBQUk7QUFDdkIsV0FBTyxlQUFlLE1BQU07QUFFNUIsV0FBTyxRQUFRLFNBQVMsQ0FBQyxHQUFHLFVBQVU7QUFDbEMsVUFBSSxNQUFNLGVBQWUsTUFBTSxJQUFJLFVBQVUsY0FBYztBQUN2RCwwQkFBa0IsUUFBUSxLQUF3QjtBQUFBLE1BQ3REO0FBRUEsVUFBSSxNQUFNLGVBQWUsTUFBTSxJQUFJLFVBQVUsZ0JBQWdCO0FBQ3pELDJCQUFtQixRQUFRLEtBQXdCO0FBQUEsTUFDdkQ7QUFFQSxpQkFBVyxRQUFRLEtBQUs7QUFBQSxJQUM1QixDQUFDO0FBQUEsRUFDTDtBQUVBLE1BQUksWUFBWSxnQkFBZ0IsY0FBYztBQUMxQyxVQUFNLFFBQVEsSUFBSSxJQUFJO0FBQ3RCLFdBQU8sZUFBZSxLQUFLO0FBRTNCLFFBQUk7QUFDQSxZQUFNLFFBQVEsU0FBUyxDQUFDLEdBQUcsR0FBRyxNQUFNLGFBQWEsUUFBUSxHQUFHLENBQUMsQ0FBQztBQUVsRSxRQUFJO0FBQ0EsWUFBTSxRQUFRLFNBQVMsTUFBTSxhQUFhLE1BQU0sQ0FBQztBQUVyRCxRQUFJO0FBQ0EsWUFBTSxRQUFRLFVBQVUsQ0FBQyxHQUFHLEdBQUcsTUFBTSxTQUFTLFFBQVEsR0FBRyxDQUFDLENBQUM7QUFBQSxFQUNuRTtBQUVBLE1BQUksWUFBWSxvQkFBb0I7QUFDaEMsVUFBTSxTQUFTLElBQUksSUFBSTtBQUN2QixXQUFPLFFBQVEsSUFBSSwyQkFBMkIsWUFBWSxJQUFJLDJCQUEyQjtBQUN6RixXQUFPLGVBQWUsTUFBTTtBQUU1QixRQUFJO0FBQ0EsYUFBTyxRQUFRLFVBQVUsQ0FBQyxHQUFHLEdBQUcsTUFBTSxTQUFTLFFBQVEsR0FBRyxDQUFDLENBQUM7QUFFaEUsUUFBSTtBQUNBLGFBQU8sUUFBUSxjQUFjLENBQUMsR0FBRyxHQUFHLE1BQU0sbUJBQW1CLFFBQVEsR0FBRyxDQUFDLENBQUM7QUFBQSxFQUNsRjtBQUVBLFNBQU87QUFDWDs7O0FDbk9BLE9BQU8sVUFBVTtBQUNqQixPQUFPQyxVQUFTO0FBQ2hCLE9BQU9DLFlBQVc7OztBQ0lsQixJQUFNQyxZQUFXLENBQUMsUUFBZ0IsSUFDN0IsUUFBUSxtQkFBbUIsT0FBTyxFQUNsQyxXQUFXLEtBQUssR0FBRyxFQUNuQixZQUFZO0FBRWpCLGVBQWUsU0FBWSxLQUE4QkMsUUFBdUI7QUFDNUUsU0FBTyxJQUFJLEtBQUssT0FBS0EsT0FBTSxFQUFFLE9BQU8sQ0FBQyxFQUFFLE1BQU0sTUFBTSxNQUFNO0FBQzdEO0FBRUEsU0FBUyxNQUF3QixPQUFVLE1BQWdDO0FBQ3ZFLFNBQU8sZUFBZSxPQUFPLE1BQU07QUFBQSxJQUMvQixNQUFNO0FBQUUsYUFBTyxLQUFLLE9BQU9ELFVBQVMsSUFBSSxDQUFDLEVBQUUsRUFBRTtBQUFBLElBQUU7QUFBQSxFQUNuRCxDQUFDO0FBQ0w7QUFFQSxNQUFNLFNBQVMsT0FBTyxnQkFBZ0IsR0FBRyxDQUFDLEVBQUUsTUFBQUUsT0FBTSxZQUFZLE1BQU07QUFDaEUsUUFBTUEsTUFBSyxXQUFXLE1BQU07QUFDNUIsUUFBTSxZQUFZLFdBQVcsVUFBVTtBQUN2QyxRQUFNLFlBQVksV0FBVyxZQUFZO0FBQzdDLENBQUM7QUFFRCxNQUFNLFNBQVMsT0FBTyxtQkFBbUIsR0FBRyxDQUFDLEVBQUUsT0FBTyxNQUFNO0FBQ3hELFFBQU0sT0FBTyxXQUFXLFNBQVM7QUFDckMsQ0FBQztBQUVELE1BQU0sU0FBUyxPQUFPLHFCQUFxQixHQUFHLENBQUMsRUFBRSxTQUFTLFdBQUFDLFlBQVcsT0FBTyxNQUFNO0FBQzlFLFFBQU0sUUFBUSxXQUFXLE9BQU87QUFDaEMsUUFBTUEsV0FBVSxXQUFXLFVBQVU7QUFDckMsUUFBTUEsV0FBVSxXQUFXLFNBQVM7QUFDcEMsUUFBTSxPQUFPLFdBQVcsT0FBTztBQUNuQyxDQUFDO0FBRUQsTUFBTSxTQUFTLE9BQU8sb0JBQW9CLEdBQUcsQ0FBQyxFQUFFLFVBQVUsU0FBUyxVQUFVLE1BQU07QUFDL0UsUUFBTSxTQUFTLFdBQVcsT0FBTztBQUNqQyxRQUFNLFNBQVMsV0FBVyxVQUFVO0FBQ3BDLFFBQU0sU0FBUyxXQUFXLFlBQVk7QUFDdEMsUUFBTSxTQUFTLFdBQVcsU0FBUztBQUNuQyxRQUFNLFFBQVEsV0FBVyxnQkFBZ0I7QUFDekMsUUFBTSxRQUFRLFdBQVcsaUJBQWlCO0FBQzFDLFFBQU0sVUFBVSxXQUFXLFNBQVM7QUFDeEMsQ0FBQztBQUVELE1BQU0sU0FBUyxPQUFPLGlCQUFpQixHQUFHLENBQUMsRUFBRSxPQUFBQyxRQUFPLE9BQU8sTUFBTTtBQUM3RCxRQUFNQSxPQUFNLFdBQVcsU0FBUztBQUNoQyxRQUFNLE9BQU8sV0FBVyx1QkFBdUI7QUFDL0MsUUFBTSxPQUFPLFdBQVcscUJBQXFCO0FBQzdDLFFBQU0sT0FBTyxXQUFXLHNCQUFzQjtBQUM5QyxRQUFNLE9BQU8sV0FBVyxvQkFBb0I7QUFDNUMsUUFBTSxPQUFPLFdBQVcsVUFBVTtBQUN0QyxDQUFDO0FBRUQsTUFBTSxTQUFTLE9BQU8sbUJBQW1CLEdBQUcsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN0RCxRQUFNLEtBQUssV0FBVyxlQUFlO0FBQ3JDLFFBQU0sS0FBSyxXQUFXLGNBQWM7QUFDeEMsQ0FBQztBQUVELE1BQU0sU0FBUyxPQUFPLGtCQUFrQixHQUFHLENBQUMsRUFBRSxRQUFBQyxTQUFRLGFBQWEsTUFBTTtBQUNyRSxRQUFNQSxRQUFPLFdBQVcsZUFBZTtBQUN2QyxRQUFNLGFBQWEsV0FBVyxTQUFTO0FBQzNDLENBQUM7QUFFRCxNQUFNLFNBQVMsT0FBTyx5QkFBeUIsR0FBRyxDQUFDLEVBQUUsY0FBYyxNQUFNO0FBQ3JFLFFBQU0sY0FBYyxXQUFXLFNBQVM7QUFDNUMsQ0FBQztBQUVELE1BQU0sU0FBUyxPQUFPLGNBQWMsR0FBRyxDQUFDLEVBQUUsSUFBQUMsS0FBSSxPQUFPLE1BQU0sTUFBTTtBQUM3RCxRQUFNQSxJQUFHLFdBQVcsV0FBVztBQUMvQixRQUFNQSxJQUFHLFdBQVcsU0FBUztBQUM3QixRQUFNLE1BQU0sV0FBVyxTQUFTO0FBQ2hDLFFBQU0sTUFBTSxXQUFXLFdBQVc7QUFDbEMsUUFBTSxNQUFNLFdBQVcsYUFBYTtBQUNwQyxRQUFNLE1BQU0sV0FBVyxVQUFVO0FBQ2pDLFFBQU0sTUFBTSxXQUFXLFNBQVM7QUFDaEMsUUFBTSxNQUFNLFdBQVcsU0FBUztBQUNoQyxRQUFNLE1BQU0sV0FBVyxXQUFXO0FBQ2xDLFFBQU0sTUFBTSxXQUFXLE9BQU87QUFDOUIsUUFBTSxNQUFNLFdBQVcsU0FBUztBQUNoQyxRQUFNLE1BQU0sV0FBVyxTQUFTO0FBQ3BDLENBQUM7OztBQ25GRCxTQUFTLDJCQUEyQjtBQUNwQyxTQUFTLE1BQU0sbUJBQW1CO0FBQ2xDLE9BQU8sUUFBUTtBQUNmLE9BQU8sYUFBYTtBQXdDYixTQUFTLE1BQU1DLE1BQWtCO0FBQ3BDLFNBQU8sSUFBSyxNQUFNLGdCQUFnQkEsS0FBSTtBQUFBLElBQ2xDLE9BQU87QUFBRSxjQUFRLGNBQWMsRUFBRSxXQUFXLFVBQVUsR0FBRyxJQUFXO0FBQUEsSUFBRTtBQUFBLElBRXRFLEtBQUssTUFBNEI7QUFDN0IsYUFBTyxJQUFJLFFBQVEsQ0FBQyxLQUFLLFFBQVE7QUFDN0IsWUFBSTtBQUNBLGdCQUFNLEtBQUssU0FBUztBQUFBLDBCQUNkLEtBQUssU0FBUyxHQUFHLElBQUksT0FBTyxVQUFVLElBQUksR0FBRztBQUFBLHVCQUNoRDtBQUNILGFBQUcsRUFBRSxFQUFFLEtBQUssR0FBRyxFQUFFLE1BQU0sR0FBRztBQUFBLFFBQzlCLFNBQVMsT0FBTztBQUNaLGNBQUksS0FBSztBQUFBLFFBQ2I7QUFBQSxNQUNKLENBQUM7QUFBQSxJQUNMO0FBQUEsSUFFQTtBQUFBLElBRUEsY0FBYyxLQUFhLE1BQWtDO0FBQ3pELFVBQUksT0FBTyxLQUFLLG1CQUFtQixZQUFZO0FBQzNDLGFBQUssZUFBZSxLQUFLLENBQUMsYUFBYTtBQUNuQyxhQUFHO0FBQUEsWUFBVztBQUFBLFlBQU0sT0FBTyxRQUFRO0FBQUEsWUFBRyxDQUFDLEdBQUcsUUFDdEMsR0FBRyxrQkFBa0IsR0FBRztBQUFBLFVBQzVCO0FBQUEsUUFDSixDQUFDO0FBQUEsTUFDTCxPQUFPO0FBQ0gsY0FBTSxjQUFjLEtBQUssSUFBSTtBQUFBLE1BQ2pDO0FBQUEsSUFDSjtBQUFBLElBRUEsVUFBVSxPQUFlLFFBQVEsT0FBTztBQUNwQyxZQUFNLFVBQVUsT0FBTyxLQUFLO0FBQUEsSUFDaEM7QUFBQSxJQUVBLEtBQUssTUFBcUI7QUFDdEIsWUFBTSxLQUFLO0FBQ1gsV0FBSyxRQUFRLENBQUM7QUFBQSxJQUNsQjtBQUFBLElBRUEsTUFBTSxFQUFFLGdCQUFnQixLQUFLLE1BQU0sTUFBTSxRQUFRLE9BQU8sR0FBRyxJQUFJLElBQVksQ0FBQyxHQUFHO0FBQzNFLFlBQU0sTUFBTTtBQUVaLGlCQUFXLE1BQU07QUFDYixjQUFNLG1CQUFtQixJQUFJLFlBQVksbUJBQW1CO0FBQzVELGFBQUssQ0FBQztBQUFBLE1BQ1Y7QUFFQSxhQUFPLE9BQU8sTUFBTSxHQUFHO0FBQ3ZCLDBCQUFvQixJQUFJLFlBQVk7QUFFcEMsV0FBSyxpQkFBaUI7QUFDdEIsVUFBSSxRQUFRLFlBQVksTUFBTTtBQUMxQixlQUFPLEdBQUcsV0FBVztBQUFBLE1BQ3pCLENBQUM7QUFFRCxVQUFJO0FBQ0EsWUFBSSxlQUFlO0FBQUEsTUFDdkIsU0FBUyxPQUFPO0FBQ1osZUFBTyxPQUFPLFNBQU8sR0FBRyxhQUFhLElBQUksY0FBYyxHQUFHLEdBQUksR0FBRyxXQUFXO0FBQUEsTUFDaEY7QUFFQSxVQUFJO0FBQ0EsYUFBSyxVQUFVLEtBQUssS0FBSztBQUU3QixVQUFJO0FBQ0EsWUFBSSxVQUFVLEtBQUs7QUFFdkIsZUFBUztBQUNULFVBQUk7QUFDQSxZQUFJLEtBQUs7QUFFYixVQUFJLFNBQVMsQ0FBQyxDQUFDO0FBQUEsSUFDbkI7QUFBQSxFQUNKO0FBQ0o7OztBRmxIQUMsS0FBSSxLQUFLO0FBSVQsS0FBSyxTQUFTLFlBQVk7QUFJMUIsTUFBTSxPQUFPLG9CQUFvQixFQUM1QixLQUFLLENBQUMsRUFBRSxTQUFTLElBQUksTUFBTSxJQUFJLEtBQUssQ0FBQyxFQUNyQyxNQUFNLE1BQU0sTUFBTTtBQUV2QixJQUFPLGNBQVEsTUFBTUMsT0FBTSxXQUFXOzs7QUdqQnRDLE9BQU9DLFlBQVc7QUFDbEIsT0FBT0MsVUFBUztBQUdoQixTQUFTLE9BQU8sVUFBaUI7QUFDN0IsU0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLElBQUksUUFBTSxjQUFjQyxLQUFJLFNBQ3JELEtBQ0EsSUFBSUEsS0FBSSxNQUFNLEVBQUUsU0FBUyxNQUFNLE9BQU8sT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQzdEO0FBR0EsT0FBTyxlQUFlQyxPQUFNLElBQUksV0FBVyxZQUFZO0FBQUEsRUFDbkQsTUFBTTtBQUFFLFdBQU8sS0FBSyxhQUFhO0FBQUEsRUFBRTtBQUFBLEVBQ25DLElBQUksR0FBRztBQUFFLFNBQUssYUFBYSxDQUFDO0FBQUEsRUFBRTtBQUNsQyxDQUFDO0FBR00sSUFBTSxNQUFNLFNBQWdEQSxPQUFNLEtBQUs7QUFBQSxFQUMxRSxZQUFZLE1BQU07QUFBRSxXQUFPLEtBQUssYUFBYTtBQUFBLEVBQUU7QUFBQSxFQUMvQyxZQUFZLE1BQU0sVUFBVTtBQUFFLFdBQU8sS0FBSyxhQUFhLE9BQU8sUUFBUSxDQUFDO0FBQUEsRUFBRTtBQUM3RSxDQUFDO0FBUU0sSUFBTSxTQUFTLFNBQWlFRCxLQUFJLE1BQU07QUFJMUYsSUFBTSxZQUFZLFNBQXdEQSxLQUFJLFdBQVc7QUFBQSxFQUM1RixZQUFZLEtBQUs7QUFDYixXQUFPLENBQUMsSUFBSSxhQUFhLElBQUksY0FBYyxJQUFJLFNBQVM7QUFBQSxFQUM1RDtBQUFBLEVBQ0EsWUFBWSxLQUFLLFVBQVU7QUFDdkIsVUFBTSxLQUFLLE9BQU8sUUFBUTtBQUMxQixRQUFJLGNBQWMsR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUNuQyxRQUFJLGVBQWUsR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUNwQyxRQUFJLFlBQVksR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUFBLEVBQ3JDO0FBQ0osQ0FBQztBQVlNLElBQU0sUUFBUSxTQUE4REEsS0FBSSxPQUFPO0FBQUEsRUFDMUYsY0FBYztBQUFFLFdBQU8sQ0FBQztBQUFBLEVBQUU7QUFDOUIsQ0FBQztBQUlNLElBQU0sUUFBUSxTQUFnREEsS0FBSSxPQUFPO0FBQUEsRUFDNUUsY0FBYztBQUFFLFdBQU8sQ0FBQztBQUFBLEVBQUU7QUFDOUIsQ0FBQztBQUlNLElBQU0sUUFBUSxTQUFnREEsS0FBSSxPQUFPO0FBQUEsRUFDNUUsY0FBYztBQUFFLFdBQU8sQ0FBQztBQUFBLEVBQUU7QUFBQSxFQUMxQixZQUFZLE1BQU0sVUFBVTtBQUFFLFNBQUssUUFBUSxPQUFPLFFBQVE7QUFBQSxFQUFFO0FBQ2hFLENBQUM7QUFJTSxJQUFNLFdBQVcsU0FBc0RBLEtBQUksVUFBVTtBQUFBLEVBQ3hGLGNBQWM7QUFBRSxXQUFPLENBQUM7QUFBQSxFQUFFO0FBQzlCLENBQUM7QUFNTSxJQUFNLFVBQVUsU0FBb0RBLEtBQUksU0FBUztBQUFBLEVBQ3BGLFlBQVksTUFBTTtBQUNkLFVBQU0sV0FBOEIsQ0FBQztBQUNyQyxRQUFJLEtBQUssS0FBSyxnQkFBZ0I7QUFDOUIsV0FBTyxPQUFPLE1BQU07QUFDaEIsZUFBUyxLQUFLLEVBQUU7QUFDaEIsV0FBSyxHQUFHLGlCQUFpQjtBQUFBLElBQzdCO0FBRUEsV0FBTyxTQUFTLE9BQU8sQ0FBQUUsUUFBTUEsUUFBTyxLQUFLLEtBQUs7QUFBQSxFQUNsRDtBQUFBLEVBQ0EsWUFBWSxNQUFNLFVBQVU7QUFDeEIsZUFBVyxTQUFTLE9BQU8sUUFBUSxHQUFHO0FBQ2xDLFlBQU0sUUFBUSxRQUFRLFFBQ2YsTUFBTSxJQUFJLEVBQWEsTUFBTSxLQUFLLElBQ25DLENBQUM7QUFFUCxVQUFJLE1BQU0sU0FBUyxTQUFTLEdBQUc7QUFDM0IsYUFBSyxZQUFZLEtBQUs7QUFBQSxNQUMxQixPQUFPO0FBQ0gsYUFBSyxVQUFVLEtBQUs7QUFBQSxNQUN4QjtBQUVBLFdBQUssb0JBQW9CLE9BQU8sTUFBTSxTQUFTLFNBQVMsQ0FBQztBQUN6RCxXQUFLLGlCQUFpQixPQUFPLE1BQU0sU0FBUyxNQUFNLENBQUM7QUFBQSxJQUN2RDtBQUFBLEVBQ0o7QUFDSixDQUFDO0FBSU0sSUFBTSxXQUFXLFNBQXNERixLQUFJLFFBQVE7QUFRbkYsSUFBTSxTQUFTLFNBQXFFQyxPQUFNLFFBQVE7QUFBQSxFQUNyRyxjQUFjO0FBQUUsV0FBTyxDQUFDO0FBQUEsRUFBRTtBQUM5QixDQUFDO0FBSU0sSUFBTSxRQUFRLFNBQWdERCxLQUFJLE9BQU87QUFBQSxFQUM1RSxZQUFZLE1BQU0sVUFBVTtBQUN4QixlQUFXLFNBQVMsT0FBTyxRQUFRLEdBQUc7QUFDbEMsVUFBSSxNQUFNLFFBQVEsTUFBTSxNQUFNLFFBQVEsTUFBTTtBQUN4QyxhQUFLLFVBQVUsT0FBTyxNQUFNLElBQUk7QUFBQSxNQUNwQyxPQUFPO0FBQ0gsYUFBSyxVQUFVLEtBQUs7QUFBQSxNQUN4QjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQ0osQ0FBQztBQUlNLElBQU0sU0FBUyxTQUFrREEsS0FBSSxRQUFRO0FBQUEsRUFDaEYsY0FBYztBQUFFLFdBQU8sQ0FBQztBQUFBLEVBQUU7QUFDOUIsQ0FBQztBQUlNLElBQU0sU0FBUyxTQUFzREMsT0FBTSxNQUFNO0FBSWpGLElBQU0sYUFBYSxTQUEwREQsS0FBSSxZQUFZO0FBQUEsRUFDaEcsWUFBWSxNQUFNO0FBQUUsV0FBTyxDQUFDLEtBQUssU0FBUyxLQUFLLEtBQUs7QUFBQSxFQUFFO0FBQUEsRUFDdEQsWUFBWSxNQUFNLFVBQVU7QUFDeEIsZUFBVyxTQUFTLE9BQU8sUUFBUSxHQUFHO0FBQ2xDLFVBQUksaUJBQWlCQSxLQUFJLFNBQVM7QUFDOUIsYUFBSyxZQUFZLEtBQUs7QUFBQSxNQUMxQixPQUFPO0FBQ0gsYUFBSyxVQUFVLEtBQUs7QUFBQSxNQUN4QjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQ0osQ0FBQztBQUlNLElBQU0sVUFBVSxTQUFvREEsS0FBSSxPQUFPOzs7QUNuS3RGLE9BQU9HLFVBQVM7QUFDaEIsT0FBT0MsVUFBUzs7O0FDSGhCOzs7QUNpQk8sSUFBTSxXQUFtQjtBQUFBLEVBQzlCLE1BQU07QUFBQSxFQUFJLE1BQU07QUFBQSxFQUFJLEtBQUs7QUFBQSxFQUFJLE1BQU07QUFBQSxFQUNuQyxNQUFNO0FBQUEsRUFBSSxTQUFTO0FBQUEsRUFBRyxPQUFPO0FBQUEsRUFDN0IsUUFBUTtBQUFBLEVBQUssV0FBVztBQUFBLEVBQUssV0FBVztBQUMxQztBQUdPLElBQU0sVUFBa0I7QUFBQSxFQUM3QixHQUFHO0FBQUEsRUFBVSxNQUFNO0FBQUEsRUFBSSxNQUFNO0FBQUEsRUFBRyxLQUFLO0FBQUEsRUFBRyxNQUFNO0FBQ2hEO0FBRU8sSUFBSSxTQUFpQjtBQUVyQixJQUFNLE1BQU0sTUFBTSxPQUFPLE9BQU87QUFDaEMsSUFBTSxXQUFXLE1BQU0sT0FBTyxNQUFNLE9BQU8sT0FBTztBQUlsRCxTQUFTLFNBQVMsSUFBWSxRQUFnQjtBQUNuRCxTQUFPO0FBQUEsdUJBQ2MsRUFBRSxJQUFJLHNCQUFzQixFQUFFLElBQUk7QUFBQTtBQUFBLDZCQUU1QixJQUFJLENBQUMsbUJBQW1CLElBQUksQ0FBQztBQUFBLHFCQUNyQyxFQUFFLE9BQU8sc0JBQXNCLEtBQUssRUFBRSxVQUFVLENBQUM7QUFBQSwyQkFDM0MsRUFBRSxHQUFHO0FBQUEsNEJBQ0osRUFBRSxJQUFJLG1CQUFtQixFQUFFLElBQUk7QUFBQSwwQ0FDakIsU0FBUyxDQUFDO0FBQUEscUJBQy9CLEVBQUUsU0FBUyxFQUFFO0FBQUEsMkJBQ1AsRUFBRSxTQUFTO0FBQUEsMkJBQ1gsRUFBRSxTQUFTO0FBQUEsd0JBQ2QsRUFBRSxLQUFLO0FBQUE7QUFFL0I7OztBQzdDQSxPQUFPQyxVQUFTO0FBQ2hCLE9BQU9DLFdBQVU7OztBQ0pqQixTQUFvQixXQUFYQyxnQkFBMEI7OztBQ0RuQyxPQUFPQyxZQUFXO0FBQ2xCLE9BQU8sU0FBUzs7O0FDRGhCLE9BQU9DLGNBQWE7QUFFcEIsU0FBb0IsV0FBWEMsZ0JBQXVCO0FBR2hDLElBQU0sT0FBTyxPQUFPLE1BQU07QUFDMUIsSUFBTSxPQUFPLE9BQU8sTUFBTTtBQUUxQixJQUFNLEVBQUUsV0FBVyxXQUFXLElBQUlDOzs7QUhBbEMsSUFBTSxNQUFNO0FBQ1osSUFBTSxPQUFPO0FBQ2IsSUFBTSxRQUFRO0FBVVAsSUFBTSxZQUFZLFNBQVMsS0FBSztBQUNoQyxJQUFNLFVBQVUsU0FBMEIsQ0FBQyxDQUFDO0FBRW5ELElBQUksUUFBOEI7QUFFbEMsU0FBUyxLQUFLLFFBQWdCLFNBQThCLE1BQW9DO0FBQzlGLFNBQU8sSUFBSSxRQUFRLENBQUMsS0FBSyxRQUFRO0FBQy9CLFFBQUksQ0FBQyxNQUFPLFFBQU8sSUFBSSxJQUFJLE1BQU0sd0JBQXdCLENBQUM7QUFDMUQsVUFBTSxLQUFLLFFBQVEsUUFBUUMsS0FBSSxjQUFjLE1BQU0sS0FBTSxNQUFNLENBQUMsR0FBRyxNQUFNO0FBQ3ZFLFVBQUk7QUFBRSxZQUFJLE1BQU8sWUFBWSxDQUFDLENBQUM7QUFBQSxNQUFFLFNBQVMsR0FBRztBQUFFLFlBQUksQ0FBQztBQUFBLE1BQUU7QUFBQSxJQUN4RCxDQUFDO0FBQUEsRUFDSCxDQUFDO0FBQ0g7QUFFTyxJQUFNLFNBQVMsTUFBTSxLQUFLLFFBQVE7QUFLbEMsSUFBTSxXQUFXLENBQUMsT0FBZSxLQUFLLGtCQUFrQixJQUFJQyxNQUFLLFFBQVEsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ3JGLElBQU0sV0FBVyxDQUFDLE9BQWUsS0FBSyxrQkFBa0IsSUFBSUEsTUFBSyxRQUFRLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztBQUU1RixlQUFzQixpQkFBaUI7QUFDckMsTUFBSTtBQUNGLFVBQU0sSUFBSSxNQUFNLEtBQUssYUFBYTtBQUNsQyxRQUFJLENBQUMsRUFBRztBQUNSLFVBQU0sQ0FBQyxJQUFJLElBQUksRUFBRSxZQUFZO0FBQzdCLFlBQVEsSUFBSSxJQUFJO0FBQUEsRUFDbEIsUUFBUTtBQUFBLEVBQWtFO0FBQzVFO0FBRU8sU0FBUyxXQUFXLE9BQWdDO0FBQ3pELFNBQU8sUUFBUSxJQUFJLEVBQUUsT0FBTyxPQUFLLEVBQUUsVUFBVSxLQUFLO0FBQ3BEO0FBR0EsZUFBc0IsTUFBTSxPQUFlLEtBQWE7QUFDdEQsUUFBTSxLQUFLLFdBQVcsS0FBSztBQUMzQixNQUFJLEdBQUcsU0FBUyxFQUFHO0FBQ25CLFFBQU0sSUFBSSxHQUFHLFVBQVUsT0FBSyxFQUFFLE9BQU87QUFDckMsUUFBTSxTQUFTLEtBQUssSUFBSSxJQUFJLElBQUksS0FBSyxNQUFNLEdBQUcsVUFBVSxHQUFHLE1BQU0sRUFBRSxFQUFFO0FBQ3ZFO0FBRU8sU0FBUyxPQUFPO0FBQ3JCLEVBQUFDLEtBQUk7QUFBQSxJQUNGQSxLQUFJLFFBQVE7QUFBQSxJQUFTO0FBQUEsSUFBS0EsS0FBSSxvQkFBb0I7QUFBQSxJQUNsRCxNQUFNO0FBQ0osTUFBQUEsS0FBSSxVQUFVO0FBQUEsUUFDWkEsS0FBSSxRQUFRO0FBQUEsUUFBU0EsS0FBSSxlQUFlO0FBQUEsUUFBTTtBQUFBLFFBQzlDO0FBQUEsUUFBSztBQUFBLFFBQU07QUFBQSxRQUFPO0FBQUEsUUFDbEIsQ0FBQyxHQUFHLFFBQVE7QUFDVixrQkFBUUEsS0FBSSxVQUFVLG1CQUFtQixHQUFHO0FBQzVDLGdCQUFNLFFBQVEsWUFBWSxDQUFDLElBQUksSUFBSSxRQUFRO0FBQ3pDLGdCQUFJLFFBQVEsaUJBQWtCLGdCQUFlO0FBQUEsVUFDL0MsQ0FBQztBQUNELG9CQUFVLElBQUksSUFBSTtBQUNsQix5QkFBZTtBQUFBLFFBQ2pCO0FBQUEsTUFBQztBQUFBLElBQ0w7QUFBQSxJQUNBLE1BQU07QUFDSixjQUFRO0FBQ1IsZ0JBQVUsSUFBSSxLQUFLO0FBQUEsSUFDckI7QUFBQSxFQUFDO0FBQ0w7OztBSTdFQSxPQUFPQyxXQUFVO0FBSWpCLE9BQU8sWUFBWTtBQUVaLElBQU0sU0FBUyxTQUFTLENBQUM7QUFDekIsSUFBTSxRQUFRLFNBQVMsS0FBSztBQUNuQyxJQUFJLElBQTBCO0FBSXZCLFNBQVNDLFFBQU87QUFHckIsTUFBSUMsTUFBSyxPQUFPLG1CQUFtQixFQUFHO0FBR3RDLFVBQVEsSUFBSSxNQUFNO0FBQ2hCLFFBQUk7QUFDRixVQUFJLE9BQU8sWUFBWTtBQUN2QixZQUFNLElBQUksSUFBSTtBQUNkLFlBQU0sT0FBTyxNQUFNLE9BQU8sSUFBSSxFQUFHLGNBQWMsTUFBTTtBQUNyRCxRQUFFLFFBQVEsWUFBWSxJQUFJO0FBQUcsUUFBRSxRQUFRLFlBQVksSUFBSTtBQUFHLFdBQUs7QUFBQSxJQUNqRSxTQUFTLEdBQUc7QUFBRSxlQUFTLCtCQUErQixDQUFDLEVBQUU7QUFBQSxJQUFFO0FBQUEsRUFDN0QsQ0FBQztBQUNIOzs7QUMxQkEsT0FBT0MsV0FBVTtBQU9WLFNBQVMsV0FBVyxLQUF5QjtBQUNsRCxRQUFNLE1BQWMsQ0FBQztBQUNyQixRQUFNLE9BQVk7QUFDbEIsUUFBTSxPQUFPLENBQUMsR0FBUSxVQUFrQjtBQUl0QyxRQUFJLElBQUksR0FBRyxJQUFJLEdBQUcsUUFBUSxHQUFHLFNBQVM7QUFDdEMsUUFBSTtBQUNGLFlBQU0sTUFBTSxFQUFFLGVBQWUsSUFBSTtBQUNqQyxZQUFNLE9BQU8sTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSTtBQUMzQyxVQUFJLE1BQU07QUFDUixZQUFJLEtBQUssT0FBTztBQUFHLFlBQUksS0FBSyxPQUFPO0FBQ25DLGdCQUFRLEtBQUssS0FBSztBQUFPLGlCQUFTLEtBQUssS0FBSztBQUFBLE1BQzlDO0FBQUEsSUFDRixRQUFRO0FBQUEsSUFBRTtBQUNWLFFBQUksQ0FBQyxPQUFPO0FBQUUsY0FBUSxFQUFFLFlBQVksS0FBSztBQUFHLGVBQVMsRUFBRSxhQUFhLEtBQUs7QUFBQSxJQUFFO0FBQzNFLFVBQU0sT0FBTyxFQUFFLGtCQUFrQixLQUFLLENBQUMsR0FBRyxLQUFLLEdBQUc7QUFDbEQsVUFBTUMsU0FBUSxFQUFFLGFBQWEsUUFBUSxLQUFLLFFBQVEsTUFBTSxFQUFFO0FBQzFELFFBQUksSUFBSTtBQUNSLFFBQUk7QUFBRSxXQUFLLEVBQUUsWUFBWSxLQUFLLEVBQUUsV0FBVyxLQUFLLElBQUksU0FBUyxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQUEsSUFBRSxRQUFRO0FBQUEsSUFBRTtBQUN0RixRQUFJLEtBQUs7QUFBQSxNQUNQLEdBQUc7QUFBQSxNQUFPLE1BQUFBO0FBQUEsTUFBTTtBQUFBLE1BQ2hCLEdBQUcsS0FBSyxNQUFNLENBQUM7QUFBQSxNQUFHLEdBQUcsS0FBSyxNQUFNLENBQUM7QUFBQSxNQUNqQyxHQUFHLEtBQUssTUFBTSxLQUFLO0FBQUEsTUFBRyxHQUFHLEtBQUssTUFBTSxNQUFNO0FBQUEsTUFBRztBQUFBLElBQy9DLENBQUM7QUFDRCxRQUFJLElBQUksRUFBRSxrQkFBa0I7QUFDNUIsV0FBTyxHQUFHO0FBQUUsV0FBSyxHQUFHLFFBQVEsQ0FBQztBQUFHLFVBQUksRUFBRSxpQkFBaUI7QUFBQSxJQUFFO0FBQUEsRUFDM0Q7QUFDQSxRQUFNLFFBQVEsSUFBSSxZQUFZO0FBQzlCLE1BQUksTUFBTyxNQUFLLE9BQU8sQ0FBQztBQUN4QixTQUFPO0FBQ1Q7QUFHTyxTQUFTLFFBQVEsV0FBZ0Q7QUFDdEUsUUFBTSxPQUFPRCxNQUFLLE9BQU8sWUFBWTtBQUNyQyxNQUFJLENBQUMsS0FBTTtBQUNYLFFBQU0sT0FBT0EsTUFBSyxPQUFPLGdCQUFnQixLQUFLO0FBQzlDLE1BQUksT0FBTztBQUNYLEVBQUFBLE1BQUssWUFBWUEsTUFBSyxrQkFBa0IsS0FBSyxNQUFNO0FBQ2pELFFBQUksS0FBTSxRQUFPQSxNQUFLO0FBQ3RCLFVBQU0sSUFBSSxVQUFVLElBQUk7QUFDeEIsUUFBSSxLQUFLLEVBQUUsYUFBYSxNQUFNLEVBQUUsWUFBWSxLQUFLLEtBQUssR0FBRztBQUV2RCxNQUFBQSxNQUFLLFlBQVlBLE1BQUssa0JBQWtCLEtBQUssTUFBTTtBQUNqRCxZQUFJO0FBQ0YsZ0JBQU0sT0FBTyxXQUFXLENBQUM7QUFDekIsVUFBQUEsTUFBSyxrQkFBa0IsTUFBTSxLQUFLLFVBQVUsSUFBSSxDQUFDO0FBQ2pELG1CQUFTLGlCQUFpQixLQUFLLE1BQU0sZ0JBQWdCLElBQUksWUFBTyxJQUFJLEVBQUU7QUFBQSxRQUN4RSxTQUFTLEdBQUc7QUFBRSxtQkFBUyx1QkFBdUIsQ0FBQyxFQUFFO0FBQUEsUUFBRTtBQUNuRCxlQUFPQSxNQUFLO0FBQUEsTUFDZCxDQUFDO0FBQ0QsYUFBTztBQUNQLGFBQU9BLE1BQUs7QUFBQSxJQUNkO0FBQ0EsV0FBT0EsTUFBSztBQUFBLEVBQ2QsQ0FBQztBQUNIOzs7QUM1REEsSUFBTSxXQUF1QyxDQUFDO0FBRXZDLFNBQVMsU0FBUyxNQUFjLElBQWdCO0FBQ3JELFdBQVMsSUFBSSxJQUFJO0FBQ25CO0FBRU8sU0FBUyxPQUFPLE1BQWM7QUFDbkMsTUFBSSxTQUFTLElBQUksR0FBRztBQUNsQixhQUFTLElBQUksRUFBRTtBQUFBLEVBQ2pCLE9BQU87QUFFTCxnQkFBSSxjQUFjLElBQUk7QUFBQSxFQUN4QjtBQUNGO0FBT08sU0FBUyxXQUFXLFNBQVMsS0FBSyxVQUFVLEtBQUs7QUFDdEQsUUFBTSxhQUFhLFNBQVMsS0FBSztBQUNqQyxRQUFNLFdBQVcsU0FBUyxLQUFLO0FBQy9CLE1BQUksaUJBQXNDO0FBQzFDLE1BQUksYUFBa0I7QUFFdEIsUUFBTSxjQUFjLENBQUMsTUFBb0I7QUFBRSxxQkFBaUI7QUFBQSxFQUFFO0FBRTlELFFBQU0sT0FBTyxNQUFNO0FBQ2pCLFFBQUksWUFBWTtBQUFFLGlCQUFXLFNBQVM7QUFBRyxtQkFBYTtBQUFBLElBQUs7QUFDM0QsUUFBSSxlQUFnQixnQkFBZSxxQkFBcUI7QUFDeEQsZUFBVyxJQUFJLElBQUk7QUFFbkIsWUFBUSxJQUFJLE1BQU0sU0FBUyxJQUFJLElBQUksQ0FBQztBQUFBLEVBQ3RDO0FBRUEsUUFBTSxRQUFRLE1BQU07QUFDbEIsUUFBSSxlQUFnQixnQkFBZSxxQkFBcUI7QUFDeEQsYUFBUyxJQUFJLEtBQUs7QUFDbEIsaUJBQWEsUUFBUSxVQUFVLElBQUksTUFBTTtBQUN2QyxpQkFBVyxJQUFJLEtBQUs7QUFDcEIsbUJBQWE7QUFBQSxJQUNmLENBQUM7QUFBQSxFQUNIO0FBRUEsUUFBTSxXQUFXLE1BQU8sU0FBUyxJQUFJLElBQUksTUFBTSxJQUFJLEtBQUs7QUFFeEQsU0FBTyxFQUFFLFlBQVksVUFBVSxhQUFhLE1BQU0sT0FBTyxRQUFRLFNBQVM7QUFDNUU7OztBQ3REQSxPQUFPLGFBQWE7QUFDcEIsT0FBTyxRQUFRO0FBQ2YsT0FBTyxhQUFhO0FBQ3BCLE9BQU8sVUFBVTs7O0FDSmpCLE9BQU9FLFdBQVU7QUFFVixJQUFNLE9BQU8sQ0FBQyxDQUFDQSxNQUFLLE9BQU8sWUFBWTtBQUd2QyxJQUFNLElBQUk7QUFBQTtBQUFBLEVBRWYsT0FBTztBQUFBLEVBQ1AsTUFBTTtBQUFBLEVBQ04sT0FBTztBQUFBLEVBQ1AsWUFBWTtBQUFBO0FBQUEsRUFFWixNQUFNO0FBQUEsRUFDTixVQUFVO0FBQUEsRUFDVixVQUFVO0FBQUEsRUFDVixRQUFRO0FBQUE7QUFBQSxFQUNSLFlBQVk7QUFBQTtBQUFBLEVBQ1osTUFBTTtBQUFBLEVBQU0sTUFBTTtBQUFBLEVBQU8sUUFBUTtBQUFBLEVBQU8sT0FBTztBQUFBO0FBQUEsRUFFL0MsT0FBTyxFQUFFLEdBQUcsTUFBTSxHQUFHLEdBQXlCLEdBQUcsRUFBRTtBQUFBO0FBQUE7QUFBQSxFQUVuRCxNQUFNLENBQUMsWUFBWSxTQUFTLFdBQVcsT0FBTyxXQUFXLFVBQVU7QUFBQSxFQUNuRSxZQUFZO0FBQUEsRUFDWixhQUFhO0FBQUEsRUFDYixPQUFPLEVBQUUsT0FBTyxjQUFjLFFBQVEsZ0JBQWdCO0FBQ3hEOzs7QUM1QkEsT0FBT0MsWUFBVztBQUNsQixPQUFPQyxVQUFTO0FBQ2hCLE9BQU9DLGNBQWE7OztBQ0ZwQixPQUFPQyxZQUFXO0FBQ2xCLE9BQU9DLFVBQVM7QUFFaEIsT0FBT0MsY0FBYTtBQU1MLFNBQVJDLFVBRUwsS0FBUSxVQUFVLElBQUksTUFBTTtBQUFBLEVBQzFCLE1BQU0sZUFBZSxJQUFJO0FBQUEsSUFDckIsSUFBSSxNQUFjO0FBQUUsYUFBT0MsT0FBTSxlQUFlLElBQUk7QUFBQSxJQUFFO0FBQUEsSUFDdEQsSUFBSSxJQUFJLEtBQWE7QUFBRSxNQUFBQSxPQUFNLGVBQWUsTUFBTSxHQUFHO0FBQUEsSUFBRTtBQUFBLElBQ3ZELFVBQWtCO0FBQUUsYUFBTyxLQUFLO0FBQUEsSUFBSTtBQUFBLElBQ3BDLFFBQVEsS0FBYTtBQUFFLFdBQUssTUFBTTtBQUFBLElBQUk7QUFBQSxJQUV0QyxJQUFJLFlBQW9CO0FBQUUsYUFBT0EsT0FBTSx1QkFBdUIsSUFBSSxFQUFFLEtBQUssR0FBRztBQUFBLElBQUU7QUFBQSxJQUM5RSxJQUFJLFVBQVUsV0FBbUI7QUFBRSxNQUFBQSxPQUFNLHVCQUF1QixNQUFNLFVBQVUsTUFBTSxLQUFLLENBQUM7QUFBQSxJQUFFO0FBQUEsSUFDOUYsaUJBQXlCO0FBQUUsYUFBTyxLQUFLO0FBQUEsSUFBVTtBQUFBLElBQ2pELGVBQWUsV0FBbUI7QUFBRSxXQUFLLFlBQVk7QUFBQSxJQUFVO0FBQUEsSUFFL0QsSUFBSSxTQUFpQjtBQUFFLGFBQU9BLE9BQU0sa0JBQWtCLElBQUk7QUFBQSxJQUFZO0FBQUEsSUFDdEUsSUFBSSxPQUFPLFFBQWdCO0FBQUUsTUFBQUEsT0FBTSxrQkFBa0IsTUFBTSxNQUFNO0FBQUEsSUFBRTtBQUFBLElBQ25FLGFBQXFCO0FBQUUsYUFBTyxLQUFLO0FBQUEsSUFBTztBQUFBLElBQzFDLFdBQVcsUUFBZ0I7QUFBRSxXQUFLLFNBQVM7QUFBQSxJQUFPO0FBQUEsSUFFbEQsSUFBSSxlQUF3QjtBQUFFLGFBQU9BLE9BQU0seUJBQXlCLElBQUk7QUFBQSxJQUFFO0FBQUEsSUFDMUUsSUFBSSxhQUFhLGNBQXVCO0FBQUUsTUFBQUEsT0FBTSx5QkFBeUIsTUFBTSxZQUFZO0FBQUEsSUFBRTtBQUFBLElBQzdGLG9CQUE2QjtBQUFFLGFBQU8sS0FBSztBQUFBLElBQWE7QUFBQSxJQUN4RCxrQkFBa0IsY0FBdUI7QUFBRSxXQUFLLGVBQWU7QUFBQSxJQUFhO0FBQUEsSUFHNUUsSUFBSSxvQkFBNkI7QUFBRSxhQUFPLEtBQUssaUJBQWlCO0FBQUEsSUFBRTtBQUFBLElBQ2xFLElBQUksa0JBQWtCLE9BQWdCO0FBQUUsV0FBSyxpQkFBaUIsSUFBSTtBQUFBLElBQU07QUFBQSxJQUV4RSxJQUFJLFlBQVksQ0FBQyxRQUFRLEtBQUssR0FBZ0I7QUFBRSxXQUFLLG9CQUFvQixRQUFRLEtBQUs7QUFBQSxJQUFFO0FBQUEsSUFDeEYsaUJBQWlCLGFBQTBCO0FBQUUsV0FBSyxjQUFjO0FBQUEsSUFBWTtBQUFBLElBRWxFLGNBQWlDO0FBQ3ZDLFVBQUksZ0JBQWdCQyxLQUFJLEtBQUs7QUFDekIsZUFBTyxLQUFLLFVBQVUsSUFBSSxDQUFDLEtBQUssVUFBVSxDQUFFLElBQUksQ0FBQztBQUFBLE1BQ3JELFdBQVcsZ0JBQWdCQSxLQUFJLFdBQVc7QUFDdEMsZUFBTyxLQUFLLGFBQWE7QUFBQSxNQUM3QjtBQUNBLGFBQU8sQ0FBQztBQUFBLElBQ1o7QUFBQSxJQUVVLFlBQVksVUFBaUI7QUFDbkMsaUJBQVcsU0FBUyxLQUFLLFFBQVEsRUFBRSxJQUFJLFFBQU0sY0FBY0EsS0FBSSxTQUN6RCxLQUNBLElBQUlBLEtBQUksTUFBTSxFQUFFLFNBQVMsTUFBTSxPQUFPLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztBQUV6RCxVQUFJLGdCQUFnQkEsS0FBSSxXQUFXO0FBQy9CLG1CQUFXLE1BQU07QUFDYixlQUFLLElBQUksRUFBRTtBQUFBLE1BQ25CLE9BQU87QUFDSCxjQUFNLE1BQU0sMkJBQTJCLEtBQUssWUFBWSxJQUFJLEVBQUU7QUFBQSxNQUNsRTtBQUFBLElBQ0o7QUFBQSxJQUVBLENBQUMsV0FBVyxFQUFFLFVBQWlCO0FBRTNCLFVBQUksZ0JBQWdCQSxLQUFJLFdBQVc7QUFDL0IsbUJBQVcsTUFBTSxLQUFLLFlBQVksR0FBRztBQUNqQyxlQUFLLE9BQU8sRUFBRTtBQUNkLGNBQUksQ0FBQyxTQUFTLFNBQVMsRUFBRSxLQUFLLENBQUMsS0FBSztBQUNoQyxnQkFBSSxRQUFRO0FBQUEsUUFDcEI7QUFBQSxNQUNKO0FBR0EsV0FBSyxZQUFZLFFBQVE7QUFBQSxJQUM3QjtBQUFBLElBRUEsZ0JBQWdCLElBQVksT0FBTyxNQUFNO0FBQ3JDLE1BQUFELE9BQU0seUJBQXlCLE1BQU0sSUFBSSxJQUFJO0FBQUEsSUFDakQ7QUFBQSxJQVdBLEtBQ0ksUUFDQSxrQkFDQSxVQUNGO0FBQ0UsV0FBSyxNQUFNLFFBQVEsa0JBQWtCLFFBQVE7QUFDN0MsYUFBTztBQUFBLElBQ1g7QUFBQSxJQUVBLGVBQWUsUUFBZTtBQUMxQixZQUFNO0FBQ04sWUFBTSxRQUFRLE9BQU8sQ0FBQyxLQUFLLENBQUM7QUFDNUIsWUFBTSxZQUFZO0FBQ2xCLGdCQUFVLE1BQU0sS0FBSztBQUFBLElBQ3pCO0FBQUEsRUFDSjtBQUVBLEVBQUFFLFNBQVEsY0FBYztBQUFBLElBQ2xCLFdBQVcsU0FBUyxPQUFPO0FBQUEsSUFDM0IsWUFBWTtBQUFBLE1BQ1IsY0FBY0EsU0FBUSxVQUFVO0FBQUEsUUFDNUI7QUFBQSxRQUFjO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUN4RDtBQUFBLE1BQ0EsT0FBT0EsU0FBUSxVQUFVO0FBQUEsUUFDckI7QUFBQSxRQUFPO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUNqRDtBQUFBLE1BQ0EsVUFBVUEsU0FBUSxVQUFVO0FBQUEsUUFDeEI7QUFBQSxRQUFVO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUNwRDtBQUFBLE1BQ0EsaUJBQWlCQSxTQUFRLFVBQVU7QUFBQSxRQUMvQjtBQUFBLFFBQWlCO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUMzRDtBQUFBLE1BQ0EsdUJBQXVCQSxTQUFRLFVBQVU7QUFBQSxRQUNyQztBQUFBLFFBQXVCO0FBQUEsUUFBSTtBQUFBLFFBQUlBLFNBQVEsV0FBVztBQUFBLFFBQVc7QUFBQSxNQUNqRTtBQUFBLElBQ0o7QUFBQSxFQUNKLEdBQUcsTUFBTTtBQUVULFNBQU87QUFDWDs7O0FEM0hBLFNBQVNDLFFBQU8sVUFBaUI7QUFDN0IsU0FBTyxTQUFTLEtBQUssUUFBUSxFQUFFLElBQUksUUFBTSxjQUFjQyxLQUFJLFNBQ3JELEtBQ0EsSUFBSUEsS0FBSSxNQUFNLEVBQUUsU0FBUyxNQUFNLE9BQU8sT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0FBQzdEO0FBR0EsT0FBTyxlQUFlQyxPQUFNLElBQUksV0FBVyxZQUFZO0FBQUEsRUFDbkQsTUFBTTtBQUFFLFdBQU8sS0FBSyxhQUFhO0FBQUEsRUFBRTtBQUFBLEVBQ25DLElBQUksR0FBRztBQUFFLFNBQUssYUFBYSxDQUFDO0FBQUEsRUFBRTtBQUNsQyxDQUFDO0FBR00sSUFBTUMsT0FBTixjQUFrQkMsVUFBU0YsT0FBTSxHQUFHLEVBQUU7QUFBQSxFQUN6QyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxNQUFNLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUMzRCxZQUFZLFVBQXFCLFVBQWdDO0FBQUUsVUFBTSxFQUFFLFVBQVUsR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQUEsRUFDOUYsWUFBWSxVQUF1QjtBQUFFLFNBQUssYUFBYUwsUUFBTyxRQUFRLENBQUM7QUFBQSxFQUFFO0FBQ3ZGO0FBV08sSUFBTU0sVUFBTixjQUFxQkYsVUFBU0YsT0FBTSxNQUFNLEVBQUU7QUFBQSxFQUMvQyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxTQUFTLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM5RCxZQUFZLE9BQXFCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQ2hHO0FBSU8sSUFBTUUsYUFBTixjQUF3QkgsVUFBU0YsT0FBTSxTQUFTLEVBQUU7QUFBQSxFQUNyRCxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxZQUFZLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUNqRSxZQUFZLFVBQTJCLFVBQWdDO0FBQUUsVUFBTSxFQUFFLFVBQVUsR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQUEsRUFDcEcsWUFBWSxVQUF1QjtBQUN6QyxVQUFNLEtBQUtMLFFBQU8sUUFBUTtBQUMxQixTQUFLLGNBQWMsR0FBRyxDQUFDLEtBQUssSUFBSUMsS0FBSTtBQUNwQyxTQUFLLGVBQWUsR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUNyQyxTQUFLLFlBQVksR0FBRyxDQUFDLEtBQUssSUFBSUEsS0FBSTtBQUFBLEVBQ3RDO0FBQ0o7QUFJTyxJQUFNLG1CQUFOLGNBQStCRyxVQUFTRixPQUFNLGdCQUFnQixFQUFFO0FBQUEsRUFDbkUsT0FBTztBQUFFLElBQUFHLFNBQVEsY0FBYyxFQUFFLFdBQVcsbUJBQW1CLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUN4RSxZQUFZLE9BQStCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQzFHO0FBTU8sSUFBTSxjQUFOLGNBQTBCRCxVQUFTSCxLQUFJLFdBQVcsRUFBRTtBQUFBLEVBQ3ZELE9BQU87QUFBRSxJQUFBSSxTQUFRLGNBQWMsRUFBRSxXQUFXLGNBQWMsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQ25FLFlBQVksT0FBMEI7QUFBRSxVQUFNLEtBQVk7QUFBQSxFQUFFO0FBQ2hFO0FBT08sSUFBTUcsU0FBTixjQUFvQkosVUFBU0gsS0FBSSxLQUFLLEVBQUU7QUFBQSxFQUMzQyxPQUFPO0FBQUUsSUFBQUksU0FBUSxjQUFjLEVBQUUsV0FBVyxRQUFRLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM3RCxZQUFZLE9BQW9CO0FBQUUsVUFBTSxLQUFZO0FBQUEsRUFBRTtBQUMxRDtBQVVPLElBQU0sV0FBTixjQUF1QkQsVUFBU0YsT0FBTSxRQUFRLEVBQUU7QUFBQSxFQUNuRCxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxXQUFXLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUNoRSxZQUFZLE9BQXVCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQ2xHO0FBT08sSUFBTSxPQUFOLGNBQW1CRCxVQUFTRixPQUFNLElBQUksRUFBRTtBQUFBLEVBQzNDLE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLE9BQU8sR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQzVELFlBQVksT0FBbUI7QUFBRSxVQUFNLEtBQVk7QUFBQSxFQUFFO0FBQ3pEO0FBSU8sSUFBTUksU0FBTixjQUFvQkwsVUFBU0YsT0FBTSxLQUFLLEVBQUU7QUFBQSxFQUM3QyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxRQUFRLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM3RCxZQUFZLE9BQW9CO0FBQUUsVUFBTSxLQUFZO0FBQUEsRUFBRTtBQUFBLEVBQzVDLFlBQVksVUFBdUI7QUFBRSxTQUFLLFFBQVEsT0FBTyxRQUFRO0FBQUEsRUFBRTtBQUNqRjtBQUlPLElBQU1LLFlBQU4sY0FBdUJOLFVBQVNGLE9BQU0sUUFBUSxFQUFFO0FBQUEsRUFDbkQsT0FBTztBQUFFLElBQUFHLFNBQVEsY0FBYyxFQUFFLFdBQVcsV0FBVyxHQUFHLElBQUk7QUFBQSxFQUFFO0FBQUEsRUFDaEUsWUFBWSxPQUF1QjtBQUFFLFVBQU0sS0FBWTtBQUFBLEVBQUU7QUFDN0Q7QUFNTyxJQUFNTSxjQUFOLGNBQXlCUCxVQUFTSCxLQUFJLFVBQVUsRUFBRTtBQUFBLEVBQ3JELE9BQU87QUFBRSxJQUFBSSxTQUFRLGNBQWMsRUFBRSxXQUFXLGFBQWEsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQ2xFLFlBQVksT0FBeUIsT0FBdUI7QUFBRSxVQUFNLEVBQUUsT0FBTyxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFDcEc7QUFHQSxPQUFPLGVBQWVILE9BQU0sUUFBUSxXQUFXLFlBQVk7QUFBQSxFQUN2RCxNQUFNO0FBQUUsV0FBTyxLQUFLLGFBQWE7QUFBQSxFQUFFO0FBQUEsRUFDbkMsSUFBSSxHQUFHO0FBQUUsU0FBSyxhQUFhLENBQUM7QUFBQSxFQUFFO0FBQ2xDLENBQUM7QUFHTSxJQUFNVSxXQUFOLGNBQXNCUixVQUFTRixPQUFNLE9BQU8sRUFBRTtBQUFBLEVBQ2pELE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLFVBQVUsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQy9ELFlBQVksVUFBeUIsVUFBZ0M7QUFBRSxVQUFNLEVBQUUsVUFBVSxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFBQSxFQUNsRyxZQUFZLFVBQXVCO0FBQ3pDLFVBQU0sQ0FBQyxPQUFPLEdBQUcsUUFBUSxJQUFJTCxRQUFPLFFBQVE7QUFDNUMsU0FBSyxVQUFVLEtBQUs7QUFDcEIsU0FBSyxhQUFhLFFBQVE7QUFBQSxFQUM5QjtBQUNKO0FBSU8sSUFBTWEsWUFBTixjQUF1QlQsVUFBU0gsS0FBSSxRQUFRLEVBQUU7QUFBQSxFQUNqRCxPQUFPO0FBQUUsSUFBQUksU0FBUSxjQUFjLEVBQUUsV0FBVyxXQUFXLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUNoRSxZQUFZLE9BQXVCLE9BQXVCO0FBQUUsVUFBTSxFQUFFLE9BQU8sR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQ2xHO0FBSU8sSUFBTSxhQUFOLGNBQXlCRCxVQUFTRixPQUFNLFVBQVUsRUFBRTtBQUFBLEVBQ3ZELE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLGFBQWEsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQ2xFLFlBQVksT0FBeUIsT0FBdUI7QUFBRSxVQUFNLEVBQUUsT0FBTyxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFDcEc7QUFNTyxJQUFNUyxVQUFOLGNBQXFCVixVQUFTRixPQUFNLE1BQU0sRUFBRTtBQUFBLEVBQy9DLE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLFNBQVMsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQzlELFlBQVksT0FBcUI7QUFBRSxVQUFNLEtBQVk7QUFBQSxFQUFFO0FBQzNEO0FBSU8sSUFBTVUsU0FBTixjQUFvQlgsVUFBU0YsT0FBTSxLQUFLLEVBQUU7QUFBQSxFQUM3QyxPQUFPO0FBQUUsSUFBQUcsU0FBUSxjQUFjLEVBQUUsV0FBVyxRQUFRLEdBQUcsSUFBSTtBQUFBLEVBQUU7QUFBQSxFQUM3RCxZQUFZLFVBQXVCLFVBQWdDO0FBQUUsVUFBTSxFQUFFLFVBQVUsR0FBRyxNQUFNLENBQVE7QUFBQSxFQUFFO0FBQUEsRUFDaEcsWUFBWSxVQUF1QjtBQUFFLFNBQUssYUFBYUwsUUFBTyxRQUFRLENBQUM7QUFBQSxFQUFFO0FBQ3ZGO0FBSU8sSUFBTWdCLFVBQU4sY0FBcUJaLFVBQVNILEtBQUksTUFBTSxFQUFFO0FBQUEsRUFDN0MsT0FBTztBQUFFLElBQUFJLFNBQVEsY0FBYyxFQUFFLFdBQVcsU0FBUyxHQUFHLElBQUk7QUFBQSxFQUFFO0FBQUEsRUFDOUQsWUFBWSxPQUFxQjtBQUFFLFVBQU0sS0FBWTtBQUFBLEVBQUU7QUFDM0Q7QUFJTyxJQUFNWSxVQUFOLGNBQXFCYixVQUFTRixPQUFNLE1BQU0sRUFBRTtBQUFBLEVBQy9DLE9BQU87QUFBRSxJQUFBRyxTQUFRLGNBQWMsRUFBRSxXQUFXLFNBQVMsR0FBRyxJQUFJO0FBQUEsRUFBRTtBQUFBLEVBQzlELFlBQVksT0FBcUIsT0FBdUI7QUFBRSxVQUFNLEVBQUUsT0FBTyxHQUFHLE1BQU0sQ0FBUTtBQUFBLEVBQUU7QUFDaEc7OztBRTVLTyxTQUFTYSxLQUNaLE1BQ0EsT0FDRjtBQUNFLFNBQU8sSUFBSyxPQUFPLE1BQWEsS0FBSztBQUN6QztBQUVBLElBQU0sUUFBUTtBQUFBLEVBQ1YsS0FBWUM7QUFBQSxFQUNaLFFBQWVDO0FBQUEsRUFDZixXQUFrQkM7QUFBQSxFQUNsQixrQkFBeUI7QUFBQSxFQUN6QixhQUFvQjtBQUFBLEVBQ3BCLE9BQWNDO0FBQUEsRUFDZCxVQUFpQjtBQUFBO0FBQUE7QUFBQSxFQUdqQixNQUFhO0FBQUEsRUFDYixPQUFjQztBQUFBLEVBQ2QsVUFBaUJDO0FBQUE7QUFBQSxFQUVqQixZQUFtQkM7QUFBQSxFQUNuQixTQUFnQkM7QUFBQSxFQUNoQixVQUFpQkM7QUFBQSxFQUNqQixZQUFtQjtBQUFBLEVBQ25CLFFBQWVDO0FBQUEsRUFDZixPQUFjQztBQUFBLEVBQ2QsUUFBZUM7QUFBQSxFQUNmLFFBQWVDO0FBQ25CO0FBaUNPLElBQU0sT0FBT2I7OztBSjdEcEIsSUFBTSxPQUFPLFNBQVNjLFNBQUssU0FBUyxjQUFjLENBQUMsRUFBRTtBQUFBLEVBQUs7QUFBQSxFQUN4RCxNQUFNQSxTQUFLLFNBQVMsY0FBYztBQUFDO0FBRXJDLFNBQVMsZUFBZTtBQUN0QixTQUFPLGdCQUFBQztBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sT0FBTTtBQUFBLE1BQ04sV0FBVztBQUFBLE1BQ1gsZUFBZTtBQUFBLE1BQ2YsT0FBTyxPQUFPLEVBQUUsUUFBUSxLQUFLLE9BQU8sRUFBRSxHQUFHLFFBQU07QUFDN0MsY0FBTSxJQUFJLEdBQUcsS0FBSyxPQUFLLEVBQUUsT0FBTztBQUNoQyxZQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsY0FBTSxXQUFXLEdBQUcsT0FBTyxPQUFLLEVBQUUsVUFBVSxFQUFFLEtBQUs7QUFDbkQsZUFBTyxTQUFTLFNBQVMsSUFDckIsR0FBRyxFQUFFLEtBQUssa0JBQWEsU0FBUyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksU0FBUyxNQUFNLEtBQ2pFLEVBQUU7QUFBQSxNQUNSLENBQUM7QUFBQTtBQUFBLEVBQUc7QUFDUjtBQUVBLFNBQVMsYUFBYTtBQUNwQixRQUFNLFVBQVUsR0FBRyxZQUFZLEdBQUcsbUJBQW1CO0FBQ3JELFFBQU0sTUFBTSxRQUFRLFlBQVk7QUFDaEMsUUFBTSxNQUFNLFFBQVEsWUFBWTtBQUVoQyxRQUFNQyxZQUFXLElBQUksT0FDakIsS0FBSyxJQUFJLE1BQU0sU0FBUyxFQUFFLEdBQUcsUUFDM0IsS0FBSyx3QkFBd0IseUJBQXlCLElBQ3hEO0FBRUosUUFBTSxVQUFVLFVBQ1osS0FBSyxTQUFTLGFBQWEsRUFBRSxHQUFHLE9BQUssS0FBSyw2QkFBNkIsSUFDdkU7QUFDSixTQUFPLGdCQUFBRDtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQU8sUUFBUUUsS0FBSSxNQUFNO0FBQUEsTUFDL0IsT0FBTyxLQUFLLFNBQVMsRUFBRSxHQUFHLE9BQUssSUFBSSxXQUFXLFlBQVk7QUFBQSxNQUMxRCxXQUFXLE1BQU0sT0FBYyxlQUFlO0FBQUEsTUFDOUMsK0JBQUMsU0FBSSxTQUFTLElBQ1o7QUFBQSx3QkFBQUYsS0FBQyxXQUFNLE9BQU0sWUFBVyxVQUFVQyxXQUFVO0FBQUEsUUFDNUMsZ0JBQUFELEtBQUMsV0FBTSxVQUFVLFNBQVM7QUFBQSxTQUV4QixRQUFRLFFBQVEscUJBQUMsU0FBSSxPQUFNLE9BQU0sU0FBUyxHQUMxQztBQUFBLDBCQUFBQSxLQUFDLFdBQU0sVUFBUywwQkFBeUI7QUFBQSxVQUN6QyxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sTUFBSyxPQUFPLE9BQU8sRUFBRSxhQUFjLE1BQzVDLEtBQUssS0FBSyxZQUFZLEVBQUUsR0FBRyxPQUFLLEdBQUcsS0FBSyxNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsSUFDekQsSUFBSztBQUFBLFdBQ1g7QUFBQSxTQUNGO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLE9BQU87QUFJZCxTQUFPLGdCQUFBQTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQU8sT0FBTTtBQUFBLE1BQVksUUFBUUUsS0FBSSxNQUFNO0FBQUEsTUFDakQsV0FBVyxNQUFNLE9BQWMsUUFBUTtBQUFBLE1BQ3ZDLCtCQUFDLGFBQ0M7QUFBQSx3QkFBQUYsS0FBQyxXQUFNLFVBQVMsdUJBQXNCO0FBQUEsUUFDdEMsZ0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBTSxNQUFLO0FBQUEsWUFBVSxRQUFRRSxLQUFJLE1BQU07QUFBQSxZQUFLLFFBQVFBLEtBQUksTUFBTTtBQUFBLFlBQzdELE9BQU07QUFBQSxZQUFXLFNBQVMsT0FBTyxPQUFPLEtBQUssTUFBTSxFQUFFLEdBQUcsQ0FBQUMsT0FBS0EsS0FBSSxDQUFDO0FBQUEsWUFDbEUsT0FBTyxPQUFPLE1BQU0sS0FBSyxNQUFNLEVBQUUsR0FBRyxDQUFBQSxPQUFLQSxLQUFJLElBQUksT0FBTyxHQUFHQSxFQUFDLEVBQUU7QUFBQTtBQUFBLFFBQUc7QUFBQSxTQUNyRTtBQUFBO0FBQUEsRUFDRjtBQUNGO0FBRWUsU0FBUixJQUFxQixTQUFzQjtBQUNoRCxRQUFNLEVBQUUsS0FBSyxNQUFNLE1BQU0sSUFBSUMsT0FBTTtBQUduQyxTQUFPLGdCQUFBSjtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sTUFBSztBQUFBLE1BQU0sV0FBVTtBQUFBLE1BQVksT0FBTTtBQUFBLE1BQ3ZDLFlBQVk7QUFBQSxNQUFTLGFBQWFJLE9BQU0sWUFBWTtBQUFBLE1BQ3BELFdBQVc7QUFBQSxNQUFJLFlBQVk7QUFBQSxNQUFJLGFBQWE7QUFBQSxNQUM1QyxRQUFRLE1BQU0sT0FBTztBQUFBLE1BQ3JCLCtCQUFDLGVBQVUsT0FBTSxPQUNmO0FBQUEsNkJBQUMsU0FBSSxTQUFTLEdBQ1o7QUFBQSwwQkFBQUo7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUFPLE9BQU07QUFBQSxjQUFPLFFBQVFFLEtBQUksTUFBTTtBQUFBLGNBQ3JDLFdBQVcsTUFBTSxPQUFjLFVBQVU7QUFBQSxjQUN6QywwQkFBQUYsS0FBQyxXQUFNLFVBQVMsbUNBQWtDO0FBQUE7QUFBQSxVQUNwRDtBQUFBLFVBQ0EsZ0JBQUFBLEtBQUMsZ0JBQWE7QUFBQSxXQUNoQjtBQUFBLFFBQ0EsZ0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBTyxPQUFNO0FBQUEsWUFBVSxRQUFRRSxLQUFJLE1BQU07QUFBQSxZQUN4QyxXQUFXLE1BQU0sT0FBYyxVQUFVO0FBQUEsWUFDekMsK0JBQUMsU0FBSSxTQUFTLEdBQ1o7QUFBQSw4QkFBQUY7QUFBQSxnQkFBQztBQUFBO0FBQUEsa0JBQU0sT0FBTTtBQUFBLGtCQUFXLFFBQVFFLEtBQUksTUFBTTtBQUFBLGtCQUN4QyxPQUFPLE9BQU8sRUFBRSxRQUFRLEtBQUssSUFBSSxFQUFFLEdBQUcsT0FBSyxFQUFFLE9BQU8sT0FBTyxDQUFFO0FBQUE7QUFBQSxjQUFHO0FBQUEsY0FDbEUsZ0JBQUFGO0FBQUEsZ0JBQUM7QUFBQTtBQUFBLGtCQUFNLE9BQU07QUFBQSxrQkFBTyxRQUFRRSxLQUFJLE1BQU07QUFBQSxrQkFDcEMsT0FBTyxPQUFPLEVBQUUsT0FBTyxLQUFLLElBQUksRUFBRSxHQUFHLE9BQUssRUFBRSxPQUFPLFdBQVcsQ0FBRTtBQUFBO0FBQUEsY0FBRztBQUFBLGVBQ3ZFO0FBQUE7QUFBQSxRQUNGO0FBQUEsUUFDQSxxQkFBQyxTQUFJLFNBQVMsR0FDWDtBQUFBLGlCQUNHLHFCQUFDLFNBQUksU0FBUyxHQUFHLFdBQVcsR0FDMUI7QUFBQSw0QkFBQUYsS0FBQyxZQUFPLE9BQU0sa0JBQWlCLFFBQVFFLEtBQUksTUFBTSxRQUFRLGFBQVksV0FDbkUsMEJBQUFGLEtBQUMsV0FBTSxVQUFTLHVCQUFzQixHQUFFO0FBQUEsWUFDMUMsZ0JBQUFBLEtBQUMsWUFBTyxPQUFNLGtCQUFpQixRQUFRRSxLQUFJLE1BQU0sUUFBUSxhQUFZLFNBQ25FLDBCQUFBRixLQUFDLFdBQU0sVUFBUyx1QkFBc0IsR0FBRTtBQUFBLFlBQzFDLGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxrQkFBaUIsUUFBUUUsS0FBSSxNQUFNLFFBQVEsYUFBWSxZQUNuRSwwQkFBQUYsS0FBQyxXQUFNLFVBQVMsOEJBQTZCLEdBQUU7QUFBQSxZQUNqRCxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sZ0JBQWUsUUFBUUUsS0FBSSxNQUFNLFFBQVEsT0FBTSxNQUFLO0FBQUEsYUFDbkUsSUFDQSxLQUFLLEtBQUssWUFBWSxHQUFHLE9BQU8sRUFBRSxHQUFHLFdBQVMsTUFBTSxJQUFJLFVBQ3RELGdCQUFBRixLQUFDLGdCQUFXLGFBQWEsS0FBSyxnQkFBZ0IsV0FBVyxLQUFLLFlBQzVELDBCQUFBQSxLQUFDLFdBQU0sT0FBTyxLQUFLLE1BQU0sT0FBTyxHQUFHLEdBQ3JDLENBQWEsQ0FBQztBQUFBLFVBQ3BCLGdCQUFBQSxLQUFDLGNBQVc7QUFBQSxVQUNaLGdCQUFBQSxLQUFDLFFBQUs7QUFBQSxVQUNOLGdCQUFBQTtBQUFBLFlBQUM7QUFBQTtBQUFBLGNBQU8sT0FBTTtBQUFBLGNBQU8sUUFBUUUsS0FBSSxNQUFNO0FBQUEsY0FDckMsV0FBVyxNQUFNLE9BQWMsU0FBUztBQUFBLGNBQ3hDLDBCQUFBRixLQUFDLFdBQU0sVUFBUyx3QkFBdUI7QUFBQTtBQUFBLFVBQ3pDO0FBQUEsV0FDRjtBQUFBLFNBQ0Y7QUFBQTtBQUFBLEVBQ0Y7QUFDRjs7O0FLdEhBLE9BQU8sVUFBVTtBQUNqQixPQUFPSyxVQUFTO0FBQ2hCLE9BQU8sV0FBVztBQUtsQixJQUFNLFNBQVM7QUFBQSxFQUNiO0FBQUEsRUFBb0I7QUFBQSxFQUFzQjtBQUFBLEVBQzFDO0FBQUEsRUFBZTtBQUFBLEVBQXNCO0FBQ3ZDO0FBRUEsU0FBUyxLQUFLLEVBQUUsTUFBTSxHQUFzQjtBQUcxQyxTQUFPLGdCQUFBQyxLQUFDLFNBQUksT0FBTSxRQUFPLFFBQVFDLEtBQUksTUFBTSxRQUFRLFFBQVFBLEtBQUksTUFBTSxLQUFLLFNBQVMsR0FDaEYsZUFBYSxPQUFPLEVBQUUsR0FBRyxNQUFNO0FBQzlCLFVBQU0sS0FBYSxXQUFXLEtBQUs7QUFDbkMsVUFBTSxRQUFRLEdBQUc7QUFDakIsVUFBTUMsS0FBSSxLQUFLLElBQUksT0FBTyxDQUFDO0FBQzNCLFVBQU0sTUFBTSxHQUFHLFVBQVUsT0FBSyxFQUFFLE9BQU87QUFDdkMsUUFBSSxRQUFRO0FBQ1osUUFBSSxRQUFRLEVBQUcsU0FBUSxLQUFLLElBQUksS0FBSyxLQUFLLE1BQU0sSUFBSSxJQUFJLE9BQU8sR0FBRyxDQUFDLEdBQUcsUUFBUSxDQUFDO0FBQy9FLFdBQU8sTUFBTSxLQUFLLEVBQUUsUUFBUUEsR0FBRSxHQUFHLENBQUMsR0FBRyxNQUFNO0FBQ3pDLFlBQU0sTUFBTSxRQUFRO0FBQ3BCLFlBQU0sTUFBTSxDQUFDLEtBQUs7QUFDbEIsVUFBSSxPQUFPLEtBQUssUUFBUSxJQUFLLEtBQUksS0FBSyxJQUFJO0FBQzFDLFVBQUksUUFBUSxNQUFPLE1BQU0sS0FBSyxRQUFRLEtBQU8sTUFBTUEsS0FBSSxLQUFLLFFBQVEsSUFBSTtBQUN0RSxZQUFJLEtBQUssTUFBTTtBQUNqQixhQUFPLGdCQUFBRixLQUFDLFNBQUksT0FBTyxJQUFJLEtBQUssR0FBRyxHQUFHO0FBQUEsSUFDcEMsQ0FBQztBQUFBLEVBQ0gsQ0FBQyxHQUNIO0FBQ0Y7QUFFQSxTQUFTLFdBQVcsRUFBRSxJQUFJLEdBQThCO0FBQ3RELFFBQU0sUUFBUSxJQUFJLE1BQU0sUUFBUSxjQUFjLEVBQUU7QUFFaEQsUUFBTSxVQUFVLE1BQU07QUFDcEIsVUFBTSxLQUFhLFdBQVcsS0FBSztBQUNuQyxRQUFJLENBQUMsR0FBRyxPQUFRLFFBQU8sS0FBSyxJQUFJLE9BQU87QUFDdkMsVUFBTSxVQUFVLEdBQUcsS0FBSyxPQUFLLEVBQUUsT0FBTztBQUN0QyxRQUFJLENBQUMsUUFBUyxRQUFPLEtBQWE7QUFBQSxNQUNoQyxHQUFHLE1BQU0sRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLE9BQU8sRUFBRSxPQUFPLElBQUksT0FBTyxFQUFFLE9BQU8sQ0FBQyxFQUFFLENBQUMsRUFBRTtBQUFBLElBQUU7QUFDeEUsUUFBSSxHQUFHLFNBQVMsRUFBRyxRQUFPLEtBQWEsTUFBTSxPQUFPLENBQUM7QUFDckQsSUFBUSxTQUFTLFFBQVEsRUFBRTtBQUFBLEVBQzdCO0FBRUEsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE9BQU07QUFBQSxNQUFPLGFBQWEsSUFBSTtBQUFBLE1BQzlCLFdBQVc7QUFBQSxNQUNYLGlCQUFpQixDQUFDLElBQUksTUFBTTtBQUMxQixZQUFJLEVBQUUsV0FBVyxNQUFNRyxLQUFJLGNBQWUsS0FBSSxPQUFPO0FBQUEsTUFDdkQ7QUFBQSxNQUNBLFVBQVUsQ0FBQyxJQUFJLEtBQUssT0FBTztBQUN6QixjQUFNLEtBQWEsV0FBVyxLQUFLO0FBQ25DLFlBQUksQ0FBQyxHQUFHLE9BQVE7QUFDaEIsWUFBSSxHQUFHLFNBQVMsRUFBRyxDQUFRLE1BQU0sT0FBTyxLQUFLLElBQUksSUFBSSxFQUFFO0FBQUEsaUJBQzlDLENBQUMsR0FBRyxDQUFDLEVBQUUsUUFBUyxDQUFRLFNBQVMsR0FBRyxDQUFDLEVBQUUsRUFBRTtBQUFBLE1BQ3BEO0FBQUEsTUFDQSwrQkFBQyxhQUNDO0FBQUEsd0JBQUFIO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBTSxPQUFNO0FBQUEsWUFBWSxVQUFVLElBQUksYUFBYTtBQUFBLFlBQzdDLFdBQVc7QUFBQTtBQUFBLFFBQUk7QUFBQSxRQUV0QixnQkFBQUEsS0FBQyxRQUFLLE1BQUssV0FBVSxPQUFjO0FBQUEsU0FDckM7QUFBQTtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsY0FBYztBQUNyQixRQUFNLFFBQVEsTUFBTSxZQUFZO0FBRWhDLFFBQU0sU0FBUyxLQUFLLE9BQU8sU0FBUyxFQUFFLEdBQUcsUUFBTSxHQUFHLEtBQUssT0FBSyxFQUFFLG9CQUFvQixNQUFNLGVBQWUsT0FBTyxLQUFLLEdBQUcsQ0FBQyxLQUFLLElBQUk7QUFDaEksUUFBTSxXQUFXLEtBQUssT0FBTyxTQUFTLEVBQUUsR0FBRyxRQUFNO0FBQy9DLFVBQU0sSUFBSSxHQUFHLEtBQUssT0FBSyxFQUFFLG9CQUFvQixNQUFNLGVBQWUsT0FBTyxLQUFLLEdBQUcsQ0FBQztBQUNsRixRQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRyxRQUFPO0FBQzdDLFdBQU8sRUFBRSxXQUFXLEVBQUU7QUFBQSxFQUN4QixDQUFDO0FBQ0QsUUFBTSxPQUFPLEtBQUssT0FBTyxTQUFTLEVBQUUsR0FBRyxRQUFNO0FBQzNDLFVBQU0sSUFBSSxHQUFHLEtBQUssT0FBSyxFQUFFLG9CQUFvQixNQUFNLGVBQWUsT0FBTyxLQUFLLEdBQUcsQ0FBQztBQUNsRixRQUFJLENBQUMsRUFBRyxRQUFPO0FBQ2YsV0FBTyxFQUFFLG9CQUFvQixNQUFNLGVBQWUsVUFDOUMseUJBQXlCO0FBQUEsRUFDL0IsQ0FBQztBQUNELFNBQU8sZ0JBQUFBO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFBTyxPQUFNO0FBQUEsTUFDbkIsV0FBVyxNQUFNLFVBQVUsc0JBQXNCO0FBQUEsTUFDakQsK0JBQUMsYUFDQztBQUFBLHdCQUFBQSxLQUFDLFNBQUksT0FBTSxTQUNULDBCQUFBQTtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQU0sT0FBTTtBQUFBLFlBQUssVUFBVTtBQUFBLFlBQU0sV0FBVztBQUFBLFlBQ3RDLFFBQVFDLEtBQUksTUFBTTtBQUFBLFlBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsWUFBUSxTQUFPO0FBQUEsWUFBQyxTQUFPO0FBQUE7QUFBQSxRQUFDLEdBQzdFO0FBQUEsUUFDQSxnQkFBQUQ7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFTLE1BQUs7QUFBQSxZQUFVLE9BQU07QUFBQSxZQUFRLFFBQVFDLEtBQUksTUFBTTtBQUFBLFlBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsWUFDekUsT0FBTztBQUFBO0FBQUEsUUFBVTtBQUFBLFNBQzdCO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7QUFTQSxJQUFNLFlBQVk7QUFBQSxFQUNoQixFQUFFLE1BQU0sWUFBWSxNQUFNLCtEQUF5RSxNQUFNLENBQUMsTUFBTSxLQUFLLEVBQUU7QUFBQSxFQUN2SCxFQUFFLE1BQU0sU0FBWSxNQUFNLGlFQUF5RSxNQUFNLENBQUMsS0FBSyxFQUFFO0FBQUEsRUFDakgsRUFBRSxNQUFNLFdBQVksTUFBTSxxREFBeUUsTUFBTSxDQUFDLEVBQUU7QUFBQSxFQUM1RyxFQUFFLE1BQU0sT0FBWSxNQUFNLHdFQUF5RSxNQUFNLENBQUMsRUFBRTtBQUFBLEVBQzVHLEVBQUUsTUFBTSxXQUFZLE1BQU0scUZBQXFGLE1BQU0sQ0FBQyxFQUFFO0FBQUEsRUFDeEgsRUFBRSxNQUFNLFlBQVksTUFBTSxpRUFBeUUsTUFBTSxDQUFDLEVBQUU7QUFDOUc7QUFFQSxTQUFTLFNBQVMsTUFBd0I7QUFDeEMsU0FBT0csS0FBSSxTQUFTLElBQUlBLEtBQUksS0FBSyxhQUFhLElBQUksQ0FBQztBQUNyRDtBQUVBLFNBQVMsV0FBVyxFQUFFLElBQUksR0FBd0M7QUFJaEUsU0FBTyxnQkFBQUosS0FBQyxZQUFPLE9BQU0sUUFBTyxhQUFhLElBQUksTUFDM0MsK0JBQUMsYUFDQztBQUFBLG9CQUFBQTtBQUFBLE1BQUM7QUFBQTtBQUFBLFFBQU0sT0FBTTtBQUFBLFFBQVksT0FBTyxTQUFTLElBQUksSUFBSTtBQUFBLFFBQUcsV0FBVztBQUFBLFFBQ3hELFFBQVFDLEtBQUksTUFBTTtBQUFBLFFBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUE7QUFBQSxJQUFRO0FBQUEsSUFDM0QsZ0JBQUFELEtBQUMsU0FBSSxNQUFLLFdBQVUsT0FBTSxRQUFPLFFBQVFDLEtBQUksTUFBTSxRQUFRLFFBQVFBLEtBQUksTUFBTSxLQUFLLFNBQVMsR0FDeEYsY0FBSSxLQUFLLElBQUksU0FBTyxnQkFBQUQsS0FBQyxTQUFJLE9BQU8sUUFBUSxPQUFPLFdBQVcsT0FBTyxDQUFFLEdBQ3RFO0FBQUEsS0FDRixHQUNGO0FBQ0Y7QUFFQSxTQUFTLFNBQVMsU0FBc0I7QUFDdEMsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFPLFdBQVU7QUFBQSxNQUFhLE9BQU07QUFBQSxNQUN6QyxZQUFZO0FBQUEsTUFBUyxRQUFRSyxPQUFNLGFBQWE7QUFBQSxNQUNoRCwrQkFBQyxTQUFJLE9BQU0sUUFBTyxTQUFTLEdBQ3pCO0FBQUEsd0JBQUFMLEtBQUMsY0FBVyxLQUFLLFVBQVUsQ0FBQyxHQUFHO0FBQUEsUUFDL0IsZ0JBQUFBLEtBQUMsY0FBVyxLQUFLLFVBQVUsQ0FBQyxHQUFHO0FBQUEsUUFDL0IsZ0JBQUFBLEtBQUMsY0FBVyxLQUFLLFVBQVUsQ0FBQyxHQUFHO0FBQUEsUUFDL0IsZ0JBQUFBLEtBQUMsY0FBVyxLQUFLLFVBQVUsQ0FBQyxHQUFHO0FBQUEsUUFDL0IsZ0JBQUFBLEtBQUMsU0FBSSxPQUFNLE9BQU0sUUFBUUMsS0FBSSxNQUFNLFFBQVE7QUFBQSxRQUMzQyxnQkFBQUQsS0FBQyxjQUFXLEtBQUssVUFBVSxDQUFDLEdBQUc7QUFBQSxRQUMvQixnQkFBQUEsS0FBQyxjQUFXLEtBQUssVUFBVSxDQUFDLEdBQUc7QUFBQSxRQUMvQixnQkFBQUEsS0FBQyxTQUFJLE9BQU0sT0FBTSxRQUFRQyxLQUFJLE1BQU0sUUFBUTtBQUFBLFFBQzNDLGdCQUFBRCxLQUFDLGVBQVk7QUFBQSxTQUNmO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7QUFFZSxTQUFSLEtBQXNCLFNBQXNCO0FBQ2pELE1BQUksS0FBTSxRQUFPLFNBQVMsT0FBTztBQUVqQyxRQUFNLE9BQU8sSUFBSSxLQUFLLEtBQUs7QUFJM0IsUUFBTSxNQUFNLEtBQUssU0FBUztBQUMxQixRQUFNLFVBQVUsQ0FBQyxPQUNmLElBQUksS0FBSyxPQUFLLEVBQUUsVUFBVSxHQUFHLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxLQUN4RCxJQUFJLEtBQUssT0FBSyxFQUFFLE9BQU8sWUFBWSxFQUFFLFNBQVMsR0FBRyxZQUFZLEVBQUUsTUFBTSxHQUFHLEVBQUUsSUFBSSxDQUFFLENBQUM7QUFJdEYsUUFBTSxRQUFRLE9BQU8sSUFBSSxTQUFPLEVBQUUsSUFBSSxLQUFLLFFBQVEsRUFBRSxFQUFFLEVBQUU7QUFDekQsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFPLFdBQVU7QUFBQSxNQUFhLE9BQU07QUFBQSxNQUN6QyxZQUFZO0FBQUEsTUFBUyxRQUFRSyxPQUFNLGFBQWE7QUFBQSxNQUNoRCwrQkFBQyxTQUFJLE9BQU0sUUFBTyxTQUFTLEdBQ3hCO0FBQUEsY0FBTSxJQUFJLENBQUMsRUFBRSxJQUFJLElBQUksR0FBRyxNQUFNO0FBQUEsVUFDN0IsTUFBTSxJQUFJLGdCQUFBTCxLQUFDLFNBQUksT0FBTSxPQUFNLFFBQVFDLEtBQUksTUFBTSxRQUFRLElBQUs7QUFBQSxVQUMxRCxNQUNJLGdCQUFBRCxLQUFDLGNBQVcsS0FBVSxJQUN0QixnQkFBQUEsS0FBQyxZQUFPLE9BQU0sb0JBQW1CLGFBQWEsR0FBRyxNQUFNLEdBQUcsRUFBRSxJQUFJLEdBQzlELDBCQUFBQSxLQUFDLFdBQU0sT0FBTSxhQUFZLFVBQVMscUNBQW9DLFdBQVcsSUFBSSxHQUN2RjtBQUFBLFFBQ04sQ0FBQztBQUFBLFFBQ0QsZ0JBQUFBLEtBQUMsU0FBSSxPQUFNLE9BQU0sUUFBUUMsS0FBSSxNQUFNLFFBQVE7QUFBQSxRQUMzQyxnQkFBQUQsS0FBQyxlQUFZO0FBQUEsU0FDZjtBQUFBO0FBQUEsRUFDRjtBQUNGOzs7QUNuTEEsT0FBT00sV0FBVTtBQUNqQixPQUFPQyxZQUFXOzs7QUNUbEIsT0FBT0MsV0FBVTtBQUlWLFNBQVMsTUFBTSxHQUFXLEdBQXlCO0FBQ3hELFFBQU0sS0FBSyxFQUFFLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWTtBQUMvQyxNQUFJLEtBQUssR0FBRyxRQUFRLEdBQUcsT0FBTztBQUM5QixRQUFNLFFBQWtCLENBQUM7QUFDekIsV0FBUyxJQUFJLEdBQUcsSUFBSSxHQUFHLFVBQVUsS0FBSyxHQUFHLFFBQVEsS0FBSztBQUNwRCxRQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHO0FBQ3BCLFlBQU0sS0FBSyxDQUFDO0FBQ1osZUFBVSxNQUFNLEtBQUssUUFBUSxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUMsSUFBSyxJQUFLLFNBQVMsSUFBSSxJQUFJLElBQUk7QUFDN0UsYUFBTztBQUFHO0FBQUEsSUFDWjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLE9BQU8sR0FBRyxTQUFTLEVBQUUsT0FBTyxRQUFRLEVBQUUsU0FBUyxNQUFNLE1BQU0sSUFBSTtBQUN4RTtBQUdPLFNBQVMsR0FBRyxHQUFXLE9BQWdDO0FBQzVELFFBQU0sTUFBTSxDQUFDLE1BQWNBLE1BQUssbUJBQW1CLEdBQUcsRUFBRTtBQUN4RCxNQUFJLENBQUMsTUFBTyxRQUFPLElBQUksQ0FBQztBQUN4QixRQUFNLElBQUksSUFBSSxJQUFJLEtBQUs7QUFDdkIsTUFBSSxNQUFNO0FBQ1YsV0FBUyxJQUFJLEdBQUcsSUFBSSxFQUFFLFFBQVE7QUFDNUIsV0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJLDhCQUE4QixJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQy9FLFNBQU87QUFDVDtBQUdBLElBQU0sUUFBUSxHQUFHQSxNQUFLLG1CQUFtQixDQUFDO0FBQzFDLElBQUksT0FBK0IsQ0FBQztBQUNwQyxJQUFJO0FBQUUsU0FBTyxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBT0EsTUFBSyxrQkFBa0IsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFDO0FBQUUsUUFBUTtBQUFFO0FBRXZGLElBQU0sUUFBUSxDQUFDLE9BQWUsS0FBSyxJQUFJLEtBQUssS0FBSyxLQUFLLEtBQUssRUFBRSxLQUFLLEVBQUUsR0FBRyxDQUFDO0FBRXhFLFNBQVMsS0FBSyxJQUFZO0FBQy9CLE9BQUssRUFBRSxLQUFLLEtBQUssRUFBRSxLQUFLLEtBQUs7QUFDN0IsRUFBQUEsTUFBSyxtQkFBbUJBLE1BQUssaUJBQWlCLEtBQUssR0FBRyxHQUFLO0FBQzNELEVBQUFBLE1BQUssa0JBQWtCLE9BQU8sS0FBSyxVQUFVLElBQUksQ0FBQztBQUNwRDtBQUVPLElBQU0sWUFBWSxDQUFDLE9BQWUsS0FBSyxFQUFFLEtBQUs7OztBQ2pDckQsSUFBTSxXQUFXLE9BQ2IsU0FBUyxJQUFJLEtBQUssRUFBRSxNQUFNLEdBQUcsRUFBRSxNQUFNLEdBQUcsRUFBRSxNQUFNLENBQUMsQ0FBQyxJQUNsRCxTQUFTLG9CQUFJLEtBQUssQ0FBQyxFQUFFLEtBQUssS0FBUSxNQUFNLG9CQUFJLEtBQUssQ0FBQztBQUN0RCxJQUFNLE1BQU0sU0FBUyxJQUFJO0FBQ3pCLElBQU0sTUFBTSxDQUFDLEdBQVcsR0FBVyxNQUFjLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUM7QUFDNUQsSUFBTSxTQUErQjtBQUFBLEVBQzFDLENBQUMsSUFBSSxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsR0FBRyxJQUFJLFFBQVEsQ0FBQyxDQUFDLEdBQ3BELENBQUMsRUFBRSxHQUFHLFNBQVMsR0FBRyxpQkFBaUIsTUFBTSx1QkFBdUIsQ0FBQztBQUFBLEVBQ25FLENBQUMsSUFBSSxJQUFJLFlBQVksR0FBRyxJQUFJLFNBQVMsR0FBRyxFQUFFLENBQUMsR0FDekM7QUFBQSxJQUFDLEVBQUUsR0FBRyxTQUFTLEdBQUcsbUJBQW1CLE1BQU0sc0JBQXNCO0FBQUEsSUFDaEUsRUFBRSxHQUFHLFNBQVMsR0FBRyxnQkFBZ0IsTUFBTSxxQkFBcUI7QUFBQSxFQUFDO0FBQUEsRUFDaEUsQ0FBQyxJQUFJLElBQUksWUFBWSxHQUFHLElBQUksU0FBUyxHQUFHLEVBQUUsQ0FBQyxHQUN6QyxDQUFDLEVBQUUsR0FBRyxXQUFXLEdBQUcsZUFBZSxNQUFNLHNCQUFzQixDQUFDO0FBQ3BFO0FBRUEsSUFBTSxPQUFPLFNBQVMsRUFBRSxHQUFHLElBQUksWUFBWSxHQUFHLEdBQUcsSUFBSSxTQUFTLEVBQUUsQ0FBQztBQUNqRSxJQUFNLE1BQU0sU0FBUyxJQUFJLEtBQUssSUFBSSxZQUFZLEdBQUcsSUFBSSxTQUFTLEdBQUcsSUFBSSxRQUFRLENBQUMsQ0FBQztBQUUvRSxTQUFTLFFBQVEsR0FBaUI7QUFDaEMsUUFBTSxJQUFJLElBQUksS0FBSyxLQUFLLElBQUksRUFBRSxZQUFZLEdBQUcsRUFBRSxTQUFTLEdBQUcsRUFBRSxRQUFRLENBQUMsQ0FBQztBQUN2RSxRQUFNLE1BQU0sRUFBRSxVQUFVLElBQUksS0FBSztBQUNqQyxJQUFFLFdBQVcsRUFBRSxXQUFXLElBQUksS0FBSyxDQUFDO0FBQ3BDLFFBQU0sSUFBSSxJQUFJLEtBQUssS0FBSyxJQUFJLEVBQUUsZUFBZSxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3JELFNBQU8sSUFBSSxLQUFLLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxRQUFRLEtBQU0sRUFBRSxVQUFVLElBQUksS0FBSyxLQUFNLENBQUM7QUFDL0U7QUFFQSxTQUFTLE9BQU87QUFDZCxTQUFPLGdCQUFBQyxLQUFDLFNBQUksT0FBTSxZQUFXLGFBQWFDLEtBQUksWUFBWSxVQUN2RCxlQUFLLFNBQVMsT0FBTyxDQUFDLE1BQU0sR0FBRyxHQUFHLENBQUMsR0FBRyxPQUFPLEVBQUUsR0FBRyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxFQUFFLEdBQUcsRUFBRSxNQUFNO0FBQ3pFLFVBQU0sUUFBUSxJQUFJLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDO0FBQ2xDLFVBQU0sU0FBUyxNQUFNLE9BQU8sSUFBSSxLQUFLO0FBQ3JDLFVBQU0sT0FBTyxJQUFJLEtBQUssRUFBRSxHQUFHLEVBQUUsSUFBSSxHQUFHLENBQUMsRUFBRSxRQUFRO0FBQy9DLFVBQU0sV0FBVyxJQUFJLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLEVBQUUsUUFBUTtBQUMvQyxVQUFNLE9BQU8sQ0FBQztBQUNkLFNBQUssS0FBSyxnQkFBQUQsS0FBQyxTQUFJLGFBQVcsTUFDdkIsV0FBQyxJQUFJLEtBQUssS0FBSyxLQUFLLEtBQUssS0FBSyxLQUFLLEdBQUcsRUFBRSxJQUFJLE9BQzNDLGdCQUFBQSxLQUFDLFdBQU0sT0FBTSxPQUFNLE9BQU8sR0FBRyxDQUFFLEdBQ25DLENBQU07QUFDTixhQUFTLElBQUksR0FBRyxJQUFJLEdBQUcsS0FBSztBQUMxQixZQUFNLFFBQVEsQ0FBQyxnQkFBQUE7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUFNLE9BQU07QUFBQSxVQUMxQixPQUFPLEdBQUcsUUFBUSxJQUFJLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLElBQUksUUFBUSxDQUFDLENBQUMsQ0FBQztBQUFBO0FBQUEsTUFBSSxDQUFFO0FBQ2hFLGVBQVMsSUFBSSxHQUFHLElBQUksR0FBRyxLQUFLO0FBQzFCLGNBQU0sSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLElBQUksUUFBUTtBQUNyQyxjQUFNLE1BQU0sSUFBSSxLQUFLLElBQUk7QUFDekIsY0FBTSxRQUFRLE1BQU8sSUFBSSxJQUFJLFdBQVcsSUFBSSxJQUFJLE9BQVE7QUFDeEQsY0FBTSxNQUFNLENBQUMsS0FBSztBQUNsQixZQUFJLEtBQUssRUFBRyxLQUFJLEtBQUssSUFBSTtBQUN6QixZQUFJLElBQUssS0FBSSxLQUFLLEtBQUs7QUFBQSxhQUNsQjtBQUNILGdCQUFNLFFBQVE7QUFDZCxjQUFJLE1BQU0sTUFBTSxRQUFRLEtBQUssRUFBRSxNQUFNLE1BQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxNQUFNLFlBQVk7QUFDakYsZ0JBQUksS0FBSyxPQUFPO0FBQ2xCLGNBQUksT0FBTyxJQUFJLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDLEVBQUcsS0FBSSxLQUFLLElBQUk7QUFDM0MsY0FBSSxFQUFFLFFBQVEsTUFBTSxLQUFLLEVBQUUsU0FBUyxNQUFNLEVBQUUsS0FBSyxFQUFFLFlBQVksTUFBTSxFQUFFO0FBQ3JFLGdCQUFJLEtBQUssS0FBSztBQUFBLFFBQ2xCO0FBQ0EsY0FBTSxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxJQUFJLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxDQUFDO0FBRy9DLGNBQU0sS0FBSyxNQUNQLGdCQUFBQSxLQUFDLFdBQU0sT0FBTyxJQUFJLEtBQUssR0FBRyxHQUFHLFFBQVFDLEtBQUksTUFBTSxRQUFRLE9BQU8sR0FBRyxLQUFLLElBQUksSUFDMUUsZ0JBQUFEO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBTyxPQUFPLElBQUksS0FBSyxHQUFHO0FBQUEsWUFDekIsUUFBUUMsS0FBSSxNQUFNO0FBQUEsWUFBUSxRQUFRQSxLQUFJLE1BQU07QUFBQSxZQUM1QyxXQUFXLE1BQU0sSUFBSSxJQUFJLElBQUksS0FBSyxFQUFFLEdBQUcsRUFBRSxHQUFHLENBQUMsQ0FBQztBQUFBLFlBQzdDLGtCQUNHLHFCQUFDLGFBQ0M7QUFBQSw4QkFBQUQsS0FBQyxXQUFNLE9BQU8sR0FBRyxLQUFLLElBQUk7QUFBQSxjQUUxQixnQkFBQUE7QUFBQSxnQkFBQztBQUFBO0FBQUEsa0JBQUksTUFBSztBQUFBLGtCQUFVLE9BQU07QUFBQSxrQkFDeEIsUUFBUUMsS0FBSSxNQUFNO0FBQUEsa0JBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUE7QUFBQSxjQUFLO0FBQUEsZUFDckQsSUFDQSxnQkFBQUQsS0FBQyxXQUFNLE9BQU8sR0FBRyxLQUFLLElBQUk7QUFBQTtBQUFBLFFBQ2hDLENBQVM7QUFBQSxNQUNmO0FBQ0EsV0FBSyxLQUFLLGdCQUFBQSxLQUFDLFNBQUksYUFBVyxNQUFFLGlCQUFNLENBQU07QUFBQSxJQUMxQztBQUNBLFdBQU87QUFBQSxFQUNULENBQUMsR0FDSDtBQUNGO0FBRUEsU0FBUyxhQUFhO0FBR3BCLFNBQU8sZ0JBQUFBLEtBQUMsU0FBSSxPQUFNLFVBQVMsYUFBYUMsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUN4RSxlQUFLLEdBQUcsRUFBRSxHQUFHLE9BQUs7QUFDakIsVUFBTSxNQUFNLE9BQU8sSUFBSSxFQUFFLFlBQVksR0FBRyxFQUFFLFNBQVMsR0FBRyxFQUFFLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQztBQUN4RSxVQUFNLE9BQU8sZ0JBQUFEO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFBTSxPQUFNO0FBQUEsUUFBUyxRQUFRQyxLQUFJLE1BQU07QUFBQSxRQUNuRCxPQUFPLEVBQUUsbUJBQW1CLFNBQVMsRUFBRSxTQUFTLFFBQVEsS0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDO0FBQUE7QUFBQSxJQUFHO0FBQzVGLFFBQUksQ0FBQyxJQUFJLE9BQVEsUUFBTztBQUFBLE1BQUM7QUFBQSxNQUN2QixxQkFBQyxTQUFJLFNBQVMsR0FBRztBQUFBLHdCQUFBRCxLQUFDLFdBQU0sVUFBUywyQkFBMEI7QUFBQSxRQUN6RCxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sT0FBTSxPQUFNLGFBQVk7QUFBQSxTQUFFO0FBQUEsSUFBTTtBQUNqRCxXQUFPLENBQUMsTUFBTSxHQUFHLElBQUksSUFBSSxPQUN2QixxQkFBQyxTQUFJLE9BQU0sU0FBUSxTQUFTLElBRTFCO0FBQUEsc0JBQUFBLEtBQUMsU0FBSSxPQUFNLFFBQU8sUUFBUUMsS0FBSSxNQUFNLFFBQ2xDLDBCQUFBRCxLQUFDLFdBQU0sVUFBVSxFQUFFLE1BQU0sR0FBRTtBQUFBLE1BQzdCLHFCQUFDLFNBQUksYUFBYUMsS0FBSSxZQUFZLFVBQVUsUUFBUUEsS0FBSSxNQUFNLFFBQzVEO0FBQUEsd0JBQUFELEtBQUMsV0FBTSxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFPLEVBQUUsR0FBRztBQUFBLFFBQzVDLGdCQUFBRCxLQUFDLFdBQU0sT0FBTSxVQUFTLFFBQVFDLEtBQUksTUFBTSxPQUFPLE9BQU8sRUFBRSxHQUFHO0FBQUEsU0FDN0Q7QUFBQSxPQUNGLENBQU0sQ0FBQztBQUFBLEVBQ1gsQ0FBQyxHQUNIO0FBQ0Y7QUFFZSxTQUFSLFdBQTRCO0FBQ2pDLFFBQU0sRUFBRSxZQUFZLFVBQVUsYUFBYSxPQUFPLFFBQVEsU0FBUyxJQUFJLFdBQVcsS0FBSyxHQUFHO0FBQzFGLFdBQVMsWUFBWSxRQUFRO0FBQzdCLFNBQU8sZ0JBQUFEO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFDTixNQUFLO0FBQUEsTUFBVyxXQUFVO0FBQUEsTUFBaUIsT0FBTTtBQUFBLE1BQ2pELFNBQVMsS0FBSyxVQUFVO0FBQUEsTUFDeEIsUUFBUUUsT0FBTSxhQUFhO0FBQUEsTUFBSyxhQUFhQSxPQUFNLFlBQVk7QUFBQSxNQUFRLFNBQVNBLE9BQU0sUUFBUTtBQUFBLE1BQzlGLGNBQWMsQ0FBQyxPQUFPQyxTQUFRQSxTQUFRQyxLQUFJLGNBQWMsTUFBTSxHQUFHLFFBQVE7QUFBQSxNQUN6RSwwQkFBQUo7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUNDLGdCQUFnQkMsS0FBSSx1QkFBdUI7QUFBQSxVQUMzQyxvQkFBb0I7QUFBQSxVQUNwQixhQUFhLEtBQUssUUFBUTtBQUFBLFVBQzFCLE9BQU8sQ0FBQyxNQUFvQixZQUFZLENBQUM7QUFBQSxVQUMzQywrQkFBQyxTQUFJLE9BQU0sYUFBWSxhQUFhQSxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ3JFO0FBQUEsaUNBQUMsU0FBSSxPQUFNLFdBQVUsYUFBYUEsS0FBSSxZQUFZLFVBQ2hEO0FBQUEsOEJBQUFEO0FBQUEsZ0JBQUM7QUFBQTtBQUFBLGtCQUFNLE9BQU07QUFBQSxrQkFBTSxRQUFRQyxLQUFJLE1BQU07QUFBQSxrQkFDbkMsT0FBTyxLQUFLLFFBQVEsRUFBRSxHQUFHLE9BQUssRUFBRSxtQkFBbUIsU0FBUyxFQUFFLFNBQVMsT0FBTyxDQUFDLENBQUM7QUFBQTtBQUFBLGNBQUc7QUFBQSxjQUNyRixnQkFBQUQ7QUFBQSxnQkFBQztBQUFBO0FBQUEsa0JBQU0sT0FBTTtBQUFBLGtCQUFPLFFBQVFDLEtBQUksTUFBTTtBQUFBLGtCQUNwQyxPQUFPLEtBQUssUUFBUSxFQUFFLEdBQUcsT0FBSyxFQUFFLG1CQUFtQixTQUFTLEVBQUUsS0FBSyxXQUFXLE9BQU8sUUFBUSxNQUFNLFVBQVUsQ0FBQyxDQUFDO0FBQUE7QUFBQSxjQUFHO0FBQUEsZUFDdEg7QUFBQSxZQUNBLHFCQUFDLGVBQ0M7QUFBQSw4QkFBQUQsS0FBQyxZQUFPLFdBQVcsTUFBTTtBQUN2QixzQkFBTSxJQUFJLEtBQUssSUFBSTtBQUNuQixxQkFBSyxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFHLEdBQUcsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxJQUFJLEdBQUcsR0FBRyxHQUFHLENBQUM7QUFBQSxjQUMvRCxHQUFHLDBCQUFBQSxLQUFDLFdBQU0sVUFBUywrQkFBOEIsR0FBRTtBQUFBLGNBQ25ELGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxTQUFRLFdBQVcsTUFDL0IsS0FBSyxJQUFJLEVBQUUsR0FBRyxJQUFJLFlBQVksR0FBRyxHQUFHLElBQUksU0FBUyxFQUFFLENBQUMsR0FDcEQsMEJBQUFBLEtBQUMsV0FBTSxPQUFPLEtBQUssSUFBSSxFQUFFLEdBQUcsT0FDMUIsSUFBSSxLQUFLLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxlQUFlLE1BQU0sRUFBRSxPQUFPLE9BQU8sQ0FBQyxLQUN0RCxFQUFFLE1BQU0sSUFBSSxZQUFZLElBQUksSUFBSSxFQUFFLENBQUMsS0FBSyxHQUFHLEdBQUcsR0FDckQ7QUFBQSxjQUNBLGdCQUFBQSxLQUFDLFlBQU8sV0FBVyxNQUFNO0FBQ3ZCLHNCQUFNLElBQUksS0FBSyxJQUFJO0FBQ25CLHFCQUFLLElBQUksRUFBRSxNQUFNLEtBQUssRUFBRSxHQUFHLEVBQUUsSUFBSSxHQUFHLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLEdBQUcsR0FBRyxFQUFFLElBQUksRUFBRSxDQUFDO0FBQUEsY0FDckUsR0FBRywwQkFBQUEsS0FBQyxXQUFNLFVBQVMsZ0NBQStCLEdBQUU7QUFBQSxlQUN0RDtBQUFBLFlBQ0EsZ0JBQUFBLEtBQUMsUUFBSztBQUFBLFlBQ04sZ0JBQUFBLEtBQUMsY0FBVztBQUFBLGFBQ2Q7QUFBQTtBQUFBLE1BQ0E7QUFBQTtBQUFBLEVBQ0Y7QUFDRjs7O0FGNUlBLElBQU1LLFVBQVM7QUFBQSxFQUFDO0FBQUEsRUFBb0I7QUFBQSxFQUFzQjtBQUFBLEVBQ3hEO0FBQUEsRUFBZTtBQUFBLEVBQXNCO0FBQW9CO0FBRzNELElBQU0sYUFBYTtBQUFBLEVBQ2pCLEVBQUUsTUFBTSxZQUFZLElBQUksbUJBQW1CO0FBQUEsRUFDM0MsRUFBRSxNQUFNLFNBQVMsSUFBSSxxQkFBcUI7QUFBQSxFQUMxQyxFQUFFLE1BQU0sV0FBVyxJQUFJLFVBQVU7QUFBQSxFQUNqQyxFQUFFLE1BQU0sT0FBTyxJQUFJLGNBQWM7QUFBQSxFQUNqQyxFQUFFLE1BQU0sV0FBVyxJQUFJLHFCQUFxQjtBQUFBLEVBQzVDLEVBQUUsTUFBTSxZQUFZLElBQUkscUJBQXFCO0FBQy9DO0FBR0EsU0FBUyxVQUFVLE1BQXlCO0FBQzFDLFFBQU0sTUFBTSxLQUFLLFNBQVM7QUFDMUIsUUFBTSxVQUFVLENBQUMsT0FDZixJQUFJLEtBQUssT0FBSyxFQUFFLFVBQVUsR0FBRyxFQUFFLGNBQWMsRUFBRSxVQUFVLEVBQUUsS0FDeEQsSUFBSSxLQUFLLE9BQUssRUFBRSxPQUFPLFlBQVksRUFBRSxTQUFTLEdBQUcsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBRSxDQUFDO0FBQ3RGLFFBQU0sVUFBVSxDQUFDLFNBQWlDO0FBQUEsSUFDaEQsTUFBTSxJQUFJO0FBQUEsSUFBTSxVQUFVLElBQUksYUFBYTtBQUFBLElBQzNDLFFBQVEsTUFBTTtBQUFFLFdBQUssSUFBSSxJQUFJO0FBQUcsVUFBSSxPQUFPO0FBQUEsSUFBRTtBQUFBLEVBQy9DO0FBQ0EsTUFBSSxLQUFNLFFBQU8sV0FBVyxJQUFJLENBQUMsRUFBRSxNQUFNLEdBQUcsTUFBTTtBQUNoRCxVQUFNLE1BQU0sUUFBUSxFQUFFO0FBQ3RCLFdBQU87QUFBQSxNQUFFO0FBQUEsTUFBTSxVQUFVLEtBQUssYUFBYSxNQUFNO0FBQUEsTUFDL0MsUUFBUSxNQUFNO0FBQUUsYUFBSyxJQUFJO0FBQUcsYUFBSyxPQUFPO0FBQUEsTUFBRTtBQUFBLElBQUU7QUFBQSxFQUNoRCxDQUFDO0FBQ0QsUUFBTSxTQUFTQSxRQUFPLElBQUksT0FBTyxFQUFFLE9BQU8sT0FBTztBQUNqRCxRQUFNLE9BQU8sSUFBSSxPQUFPLE9BQUssQ0FBQyxPQUFPLFNBQVMsQ0FBQyxDQUFDLEVBQzdDLEtBQUssQ0FBQyxHQUFHLE1BQU0sVUFBVSxFQUFFLElBQUksSUFBSSxVQUFVLEVBQUUsSUFBSSxDQUFDO0FBQ3ZELFNBQU8sQ0FBQyxHQUFHLFFBQVEsR0FBRyxJQUFJLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRSxJQUFJLE9BQU87QUFDckQ7QUFDQSxTQUFTLGtCQUEwQjtBQUNqQyxNQUFJLEtBQU0sUUFBTyxFQUFFO0FBQ25CLFFBQU0sSUFBSSxvQkFBSSxLQUFLO0FBQ25CLFFBQU0sTUFBTSxPQUFPLEdBQUcsRUFBRSxZQUFZLENBQUMsSUFBSSxFQUFFLFNBQVMsSUFBSSxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsRUFBRSxLQUFLLENBQUM7QUFDaEYsU0FBTyxJQUFJLFNBQVMsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLFNBQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQyxLQUFLO0FBQ3BEO0FBQ0EsU0FBUyxpQkFBeUI7QUFDaEMsU0FBTyxPQUFPLEVBQUUsY0FDWixvQkFBSSxLQUFLLEdBQUUsbUJBQW1CLFNBQVMsRUFBRSxTQUFTLFFBQVEsS0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDO0FBQy9GO0FBT0EsSUFBTSxVQUFVO0FBQUEsRUFDZDtBQUFBLElBQUUsR0FBRztBQUFBLElBQVcsTUFBTTtBQUFBLElBQXVCLEdBQUc7QUFBQSxJQUM5QyxJQUFJLENBQUMsT0FBTztBQUFBLElBQUcsS0FBSyxNQUFNLFVBQVUsbUJBQW1CO0FBQUEsRUFBRTtBQUFBLEVBQzNEO0FBQUEsSUFBRSxHQUFHO0FBQUEsSUFBUSxNQUFNO0FBQUEsSUFBdUIsR0FBRztBQUFBLElBQzNDLElBQUksQ0FBQyxhQUFhO0FBQUEsSUFBRyxLQUFLLE1BQU0sVUFBVSx1QkFBdUI7QUFBQSxFQUFFO0FBQUEsRUFDckU7QUFBQSxJQUFFLEdBQUc7QUFBQSxJQUFXLE1BQU07QUFBQSxJQUF5QixHQUFHO0FBQUEsSUFDaEQsSUFBSSxDQUFDLFFBQVEsWUFBWSxRQUFRO0FBQUEsSUFBRyxLQUFLLE1BQU0sT0FBYyxTQUFTO0FBQUEsRUFBRTtBQUFBLEVBQzFFO0FBQUEsSUFBRSxHQUFHO0FBQUEsSUFBVyxNQUFNO0FBQUEsSUFBeUIsR0FBRztBQUFBLElBQ2hELElBQUksQ0FBQyxRQUFRO0FBQUEsSUFBRyxLQUFLLE1BQU0sT0FBYyxTQUFTO0FBQUEsRUFBRTtBQUFBLEVBQ3REO0FBQUEsSUFBRSxHQUFHO0FBQUEsSUFBYSxNQUFNO0FBQUEsSUFBd0IsR0FBRztBQUFBLElBQ2pELElBQUksQ0FBQyxZQUFZLE1BQU07QUFBQSxJQUFHLEtBQUssTUFBTSxPQUFjLFNBQVM7QUFBQSxFQUFFO0FBQUEsRUFDaEU7QUFBQSxJQUFFLEdBQUc7QUFBQSxJQUF1QixNQUFNO0FBQUEsSUFDaEMsR0FBRztBQUFBLElBQXNDLElBQUksQ0FBQztBQUFBLElBQzlDLEtBQUssTUFBTSxVQUFVLG1CQUFtQjtBQUFBLEVBQUU7QUFDOUM7QUFFQSxJQUFNLE9BQU87QUFBQSxFQUNYLEVBQUUsR0FBRyxVQUFVLEdBQUcsK0NBQTBDO0FBQUEsRUFDNUQsRUFBRSxHQUFHLFdBQVcsR0FBRyxzQ0FBc0M7QUFBQSxFQUN6RCxFQUFFLEdBQUcsY0FBYyxHQUFHLHdDQUF3QztBQUFBLEVBQzlELEVBQUUsR0FBRyxVQUFVLEdBQUcsa0NBQWtDO0FBQ3REO0FBRWUsU0FBUixXQUE0QjtBQUNqQyxRQUFNLE9BQU8sSUFBSUMsTUFBSyxLQUFLO0FBRTNCLFFBQU0sUUFBUSxTQUFTQyxTQUFLLE9BQU8sYUFBYSxLQUFLLEVBQUU7QUFDdkQsUUFBTSxXQUFXLFNBQVMsQ0FBQztBQUMzQixRQUFNLFFBQVEsU0FBUyxFQUFFO0FBRXpCLFdBQVMsUUFBUSxHQUErQztBQUM5RCxVQUFNLEtBQUssRUFBRSxLQUFLO0FBQ2xCLFFBQUksQ0FBQyxHQUFJLFFBQU8sQ0FBQztBQUNqQixRQUFJLEdBQUcsV0FBVyxHQUFHLEdBQUc7QUFDdEIsWUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLEVBQUUsS0FBSztBQUM1QixhQUFPLENBQUM7QUFBQSxRQUNOLFNBQVM7QUFBQSxRQUNULE1BQU0sS0FBSyxPQUFPLE9BQUssRUFBRSxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsSUFBSSxRQUFNO0FBQUEsVUFDbkQsTUFBTSxJQUFJLEVBQUUsQ0FBQztBQUFBLFVBQUksTUFBTTtBQUFBLFVBQTJCLE1BQU0sRUFBRTtBQUFBLFVBQUcsT0FBTztBQUFBLFVBQ3BFLFFBQVEsSUFBSSxFQUFFLENBQUM7QUFBQSxVQUFJLEtBQUssTUFBTSxVQUFVLGNBQWMsRUFBRSxDQUFDLEVBQUU7QUFBQSxRQUM3RCxFQUFFO0FBQUEsTUFDSixDQUFDO0FBQUEsSUFDSDtBQUNBLFVBQU0sTUFBMEMsQ0FBQztBQUVqRCxRQUFJLHNCQUFzQixLQUFLLEVBQUUsS0FBSyxRQUFRLEtBQUssRUFBRSxLQUFLLFVBQVUsS0FBSyxFQUFFLEdBQUc7QUFDNUUsVUFBSTtBQUNGLGNBQU0sSUFBSSxTQUFTLHVCQUF1QixHQUFHLFFBQVEsTUFBTSxFQUFFLENBQUMsR0FBRyxFQUFFO0FBQ25FLFlBQUksT0FBTyxTQUFTLENBQUMsRUFBRyxLQUFJLEtBQUs7QUFBQSxVQUMvQixTQUFTO0FBQUEsVUFDVCxNQUFNLENBQUM7QUFBQSxZQUFFLE1BQU0sT0FBTyxDQUFDO0FBQUEsWUFBRyxNQUFNO0FBQUEsWUFDOUIsTUFBTSxHQUFHLEdBQUcsUUFBUSxNQUFNLEVBQUUsQ0FBQztBQUFBLFlBQU0sT0FBTztBQUFBLFlBQUksUUFBUSxPQUFPLENBQUM7QUFBQSxZQUM5RCxLQUFLLE1BQU0sVUFBVSxDQUFDLFdBQVcsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUFBLFVBQUUsQ0FBQztBQUFBLFFBQ2xELENBQUM7QUFBQSxNQUNILFFBQVE7QUFBQSxNQUFFO0FBQUEsSUFDWjtBQUNBLFVBQU0sVUFBaUIsS0FBSyxZQUFZLEVBQUUsRUFBRSxNQUFNLEdBQUcsQ0FBQyxFQUFFLElBQUksT0FBSztBQUMvRCxZQUFNLElBQUksTUFBTSxJQUFJLEVBQUUsSUFBSSxLQUFLLEVBQUUsT0FBTyxHQUFHLE9BQU8sS0FBWTtBQUM5RCxhQUFPO0FBQUEsUUFDTCxNQUFNLEVBQUU7QUFBQSxRQUFNLE1BQU0sRUFBRSxhQUFhO0FBQUEsUUFDbkMsTUFBTTtBQUFBLFFBQWUsT0FBTyxFQUFFLFFBQVEsTUFBTSxFQUFFLElBQUk7QUFBQSxRQUNsRCxRQUFRLEdBQUcsRUFBRSxNQUFNLEVBQUUsS0FBSztBQUFBLFFBQzFCLEtBQUssTUFBTTtBQUFFLGVBQUssRUFBRSxJQUFJO0FBQUcsWUFBRSxPQUFPO0FBQUEsUUFBRTtBQUFBLE1BQ3hDO0FBQUEsSUFDRixDQUFDO0FBQ0QsVUFBTSxVQUFpQixRQUFRLElBQUksT0FBSztBQUN0QyxVQUFJLElBQUksTUFBTSxJQUFJLEVBQUUsQ0FBQztBQUNyQixVQUFJLENBQUMsRUFBRyxZQUFXLE1BQU0sRUFBRSxJQUFJO0FBQUUsY0FBTSxLQUFLLE1BQU0sSUFBSSxFQUFFO0FBQUcsWUFBSSxJQUFJO0FBQUUsY0FBSSxFQUFFLE9BQU8sR0FBRyxRQUFRLEtBQUksT0FBTyxLQUFZO0FBQUc7QUFBQSxRQUFNO0FBQUEsTUFBRTtBQUMvSCxhQUFPLElBQUk7QUFBQSxRQUFFLE1BQU0sRUFBRTtBQUFBLFFBQUcsTUFBTSxFQUFFO0FBQUEsUUFBTSxNQUFNLEVBQUU7QUFBQSxRQUFHLE9BQU8sRUFBRSxRQUFRO0FBQUEsUUFDaEUsUUFBUSxHQUFHLEVBQUUsR0FBSSxFQUFVLEtBQUs7QUFBQSxRQUFHLEtBQUssRUFBRTtBQUFBLE1BQUksSUFBVztBQUFBLElBQzdELENBQUMsRUFBRSxPQUFPLE9BQU87QUFFakIsVUFBTSxNQUFNLENBQUMsR0FBRyxTQUFTLEdBQUcsT0FBTyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxRQUFRLEVBQUUsS0FBSztBQUNyRSxVQUFNLE9BQU8sSUFBSSxDQUFDO0FBQ2xCLFFBQUksS0FBTSxLQUFJLEtBQUssRUFBRSxTQUFTLGNBQWMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO0FBQzFELFVBQU0sT0FBTyxDQUFDLFNBQWdCLEtBQUssT0FBTyxPQUFLLE1BQU0sSUFBSTtBQUN6RCxRQUFJLEtBQUssT0FBTyxFQUFFLE9BQVEsS0FBSSxLQUFLLEVBQUUsU0FBUyxRQUFRLE1BQU0sS0FBSyxPQUFPLEVBQUUsQ0FBQztBQUMzRSxRQUFJLEtBQUssT0FBTyxFQUFFLE9BQVEsS0FBSSxLQUFLLEVBQUUsU0FBUyxXQUFXLE1BQU0sS0FBSyxPQUFPLEVBQUUsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO0FBQzFGLFFBQUksS0FBSztBQUFBLE1BQ1AsU0FBUztBQUFBLE1BQ1QsTUFBTSxDQUFDO0FBQUEsUUFBRSxNQUFNLDRCQUF1QixFQUFFO0FBQUEsUUFBSyxNQUFNO0FBQUEsUUFDakQsTUFBTTtBQUFBLFFBQUksT0FBTztBQUFBLFFBQUcsUUFBUSw0QkFBdUIsRUFBRTtBQUFBLFFBQ3JELEtBQUssTUFBTSxVQUFVLENBQUMsWUFBWSw2QkFBNkIsbUJBQW1CLEVBQUUsQ0FBQyxFQUFFLENBQUM7QUFBQSxNQUFFLENBQUM7QUFBQSxJQUMvRixDQUFDO0FBRUQsVUFBTSxJQUFJLElBQUksUUFBUSxPQUFLLEVBQUUsSUFBSSxFQUFFLElBQUksT0FBSyxFQUFFLElBQUksRUFDL0MsS0FBSyxDQUFBQyxPQUFLQSxHQUFFLFlBQVksRUFBRSxXQUFXLEdBQUcsWUFBWSxDQUFDLEtBQUtBLEdBQUUsU0FBUyxHQUFHLE1BQU07QUFDakYsVUFBTSxJQUFJLEtBQUssRUFBRTtBQUNqQixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQU87QUFFdkMsUUFBTSxFQUFFLFlBQVksVUFBVSxnQkFBZ0IsYUFBYSxtQkFBbUIsT0FBTyxhQUFhLFFBQVEsU0FBUyxJQUFJLFdBQVcsS0FBSyxHQUFHO0FBQzFJLFdBQVMsWUFBWSxRQUFRO0FBQzdCLFNBQU8sZ0JBQUFDO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFDTixNQUFLO0FBQUEsTUFBVyxXQUFVO0FBQUEsTUFBaUIsT0FBTTtBQUFBLE1BQ2pELFFBQVFDLE9BQU0sYUFBYTtBQUFBLE1BQUssYUFBYUEsT0FBTSxZQUFZO0FBQUEsTUFDL0QsU0FBU0EsT0FBTSxRQUFRO0FBQUEsTUFDdkIsU0FBUyxLQUFLLFVBQVU7QUFBQSxNQUN4QixjQUFjLENBQUMsT0FBT0MsTUFBSyxPQUFPLFNBQVM7QUFDekMsY0FBTSxPQUFPLFFBQVEsTUFBTSxJQUFJLENBQUMsRUFBRSxRQUFRLE9BQUssRUFBRSxJQUFJO0FBQ3JELFlBQUlBLFNBQVFDLEtBQUksWUFBWTtBQUMxQixjQUFJLE1BQU0sSUFBSSxHQUFHO0FBQUUsa0JBQU0sSUFBSSxFQUFFO0FBQUcsbUJBQU87QUFBQSxVQUFLO0FBQzlDLHNCQUFZO0FBQUcsaUJBQU87QUFBQSxRQUN4QjtBQUNBLFlBQUlELFNBQVFDLEtBQUksU0FBUztBQUN2QixnQkFBTSxJQUFJLE1BQU0sSUFBSSxHQUFHLElBQUksTUFBTSxJQUFJO0FBQ3JDLGNBQUksS0FBSyxFQUFFLE9BQU9BLEtBQUksYUFBYSxhQUFhO0FBQUUsa0JBQU0sSUFBSSxDQUFDO0FBQUcsbUJBQU87QUFBQSxVQUFLO0FBQzVFLG1CQUFTLEtBQUssU0FBUyxJQUFJLEtBQU0sT0FBT0EsS0FBSSxhQUFhLGFBQWMsS0FBSyxLQUN4RSxLQUFLLFVBQVUsS0FBSyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUM7QUFDM0MsaUJBQU87QUFBQSxRQUNUO0FBQ0EsWUFBSyxPQUFPQSxLQUFJLGFBQWEsaUJBQ3hCRCxTQUFRQyxLQUFJLFNBQVNELFNBQVFDLEtBQUksUUFBUTtBQUM1QyxtQkFBUyxLQUFLLFNBQVMsSUFBSSxLQUFLRCxTQUFRQyxLQUFJLFFBQVEsSUFBSSxNQUFNLEtBQUssVUFDL0QsS0FBSyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUM7QUFDNUIsaUJBQU87QUFBQSxRQUNUO0FBQ0EsWUFBSUQsU0FBUUMsS0FBSSxVQUFVO0FBQUUsbUJBQVMsS0FBSyxTQUFTLElBQUksSUFBSSxLQUFLLEtBQUssSUFBSSxLQUFLLFFBQVEsQ0FBQyxDQUFDO0FBQUcsaUJBQU87QUFBQSxRQUFLO0FBQ3ZHLFlBQUlELFNBQVFDLEtBQUksUUFBUTtBQUFFLG1CQUFTLEtBQUssU0FBUyxJQUFJLElBQUksSUFBSSxLQUFLLFVBQVUsS0FBSyxJQUFJLEtBQUssUUFBUSxDQUFDLENBQUM7QUFBRyxpQkFBTztBQUFBLFFBQUs7QUFDbkgsWUFBSUQsU0FBUUMsS0FBSSxZQUFZO0FBQzFCLGVBQUssU0FBUyxJQUFJLENBQUMsR0FBRyxJQUFJO0FBQUcsc0JBQVk7QUFBRyxnQkFBTSxJQUFJLEVBQUU7QUFBRyxpQkFBTztBQUFBLFFBQ3BFO0FBQ0EsZUFBTztBQUFBLE1BQ1Q7QUFBQSxNQUNBLDBCQUFBSDtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQ0MsZ0JBQWdCSSxLQUFJLHVCQUF1QjtBQUFBLFVBQzNDLG9CQUFvQjtBQUFBLFVBQ3BCLGFBQWEsS0FBSyxjQUFjO0FBQUEsVUFDaEMsT0FBTyxDQUFDLE1BQW9CLGtCQUFrQixDQUFDO0FBQUEsVUFDakQsK0JBQUMsU0FBSSxPQUFNLGtCQUFpQixhQUFhQSxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQzFFO0FBQUEsaUNBQUMsU0FBSSxPQUFNLFNBQVEsU0FBUyxJQUMxQjtBQUFBLDhCQUFBSixLQUFDLFdBQU0sVUFBUyxtQ0FBa0M7QUFBQSxjQUNsRCxxQkFBQyxhQUFRLFNBQU8sTUFDZDtBQUFBLGdDQUFBQTtBQUFBLGtCQUFDO0FBQUE7QUFBQSxvQkFDQyxTQUFPO0FBQUEsb0JBQ1AsT0FBTyxDQUFDLFNBQWM7QUFBRSwyQkFBSyxvQkFBb0IsQ0FBQztBQUFHLDJCQUFLLGdCQUFnQixDQUFDO0FBQUEsb0JBQUU7QUFBQSxvQkFDN0UsTUFBTSxLQUFLLEtBQUs7QUFBQSxvQkFDaEIsY0FBYyxPQUFLO0FBQUUsNEJBQU0sSUFBSSxFQUFFLElBQUk7QUFBRywrQkFBUyxJQUFJLENBQUM7QUFBQSxvQkFBRTtBQUFBO0FBQUEsZ0JBQUc7QUFBQSxnQkFHN0QsZ0JBQUFBO0FBQUEsa0JBQUM7QUFBQTtBQUFBLG9CQUFNLE1BQUs7QUFBQSxvQkFBVSxPQUFNO0FBQUEsb0JBQWUsUUFBUUksS0FBSSxNQUFNO0FBQUEsb0JBQzNELFFBQVFBLEtBQUksTUFBTTtBQUFBLG9CQUFRLFdBQVc7QUFBQSxvQkFBRyxTQUFPO0FBQUEsb0JBQy9DLFNBQVMsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLENBQUMsQ0FBQztBQUFBLG9CQUMvQixPQUFNO0FBQUE7QUFBQSxnQkFBdUQ7QUFBQSxnQkFDL0QsZ0JBQUFKO0FBQUEsa0JBQUM7QUFBQTtBQUFBLG9CQUFNLE1BQUs7QUFBQSxvQkFBVSxPQUFNO0FBQUEsb0JBQVEsUUFBUUksS0FBSSxNQUFNO0FBQUEsb0JBQ3BELFFBQVFBLEtBQUksTUFBTTtBQUFBLG9CQUNsQixPQUFPLEtBQUssS0FBSyxFQUFFLEdBQUcsT0FBSztBQUN6Qiw0QkFBTSxJQUFJLE1BQU0sSUFBSTtBQUNwQiw2QkFBTyxFQUFFLFlBQVksRUFBRSxXQUFXLEVBQUUsWUFBWSxDQUFDLEtBQUssSUFBSSxJQUFJO0FBQUEsb0JBQ2hFLENBQUM7QUFBQTtBQUFBLGdCQUFHO0FBQUEsaUJBQ1I7QUFBQSxjQUNBLGdCQUFBSixLQUFDLFdBQU0sT0FBTSxPQUFNLE9BQU0sU0FBUSxRQUFRSSxLQUFJLE1BQU0sUUFBUTtBQUFBLGVBQzdEO0FBQUEsWUFHQSxnQkFBQUosS0FBQyxjQUFTLGFBQWEsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLENBQUMsRUFBRSxLQUFLLENBQUMsR0FDbEQsK0JBQUMsU0FBSSxhQUFhSSxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ25EO0FBQUEsOEJBQUFKLEtBQUMsU0FBSSxPQUFNLFNBQVEsUUFBUUksS0FBSSxNQUFNLFFBQVEsU0FBUyxHQUNuRCxvQkFBVSxJQUFJLEVBQUUsSUFBSSxPQUNuQixnQkFBQUosS0FBQyxZQUFPLE9BQU0sUUFBTyxXQUFXLE1BQU07QUFBRSxrQkFBRSxPQUFPO0FBQUcsNEJBQVk7QUFBQSxjQUFFLEdBQ2hFLCtCQUFDLFNBQUksYUFBYUksS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUFHLFFBQVFBLEtBQUksTUFBTSxRQUN4RTtBQUFBLGdDQUFBSjtBQUFBLGtCQUFDO0FBQUE7QUFBQSxvQkFBTSxPQUFNO0FBQUEsb0JBQVksVUFBVSxFQUFFO0FBQUEsb0JBQVUsV0FBVztBQUFBLG9CQUN4RCxRQUFRSSxLQUFJLE1BQU07QUFBQSxvQkFBUSxRQUFRQSxLQUFJLE1BQU07QUFBQTtBQUFBLGdCQUFRO0FBQUEsZ0JBQ3RELGdCQUFBSjtBQUFBLGtCQUFDO0FBQUE7QUFBQSxvQkFBTSxPQUFPLEVBQUU7QUFBQSxvQkFBTSxRQUFRSSxLQUFJLE1BQU07QUFBQSxvQkFDdEMsV0FBVztBQUFBLG9CQUFHLGVBQWU7QUFBQTtBQUFBLGdCQUFHO0FBQUEsaUJBQ3BDLEdBQ0YsQ0FBUyxHQUNiO0FBQUEsY0FFQSxxQkFBQyxTQUFJLE9BQU0sWUFBVyxTQUFTLEdBQUcsYUFBVyxNQUUzQztBQUFBO0FBQUEsa0JBQUM7QUFBQTtBQUFBLG9CQUFJLE9BQU07QUFBQSxvQkFBWSxTQUFPO0FBQUEsb0JBQUMsYUFBYUEsS0FBSSxZQUFZO0FBQUEsb0JBQVUsU0FBUztBQUFBLG9CQUM3RSxRQUFRQSxLQUFJLE1BQU07QUFBQSxvQkFDbEI7QUFBQSxzQ0FBQUosS0FBQyxXQUFNLE9BQU0sTUFBSyxRQUFRSSxLQUFJLE1BQU0sT0FBTyxPQUFPLGVBQWUsR0FBRztBQUFBLHNCQUNwRSxnQkFBQUosS0FBQyxXQUFNLE9BQU0sUUFBTyxRQUFRSSxLQUFJLE1BQU0sT0FBTyxPQUFPLGdCQUFnQixHQUFHO0FBQUE7QUFBQTtBQUFBLGdCQUN6RTtBQUFBLGlCQUVFLE1BQU07QUFDTix3QkFBTSxRQUFRQyxPQUFNLFlBQVk7QUFDaEMsd0JBQU0sZUFBZSxLQUFLLE9BQU8sU0FBUyxFQUFFLEdBQUcsUUFDN0MsR0FBRyxLQUFLLE9BQUssRUFBRSxvQkFBb0JBLE9BQU0sZUFBZSxPQUFPLEtBQUssR0FBRyxDQUFDLEtBQUssSUFBSTtBQUNuRix3QkFBTSxhQUFhLE9BQU8sRUFBRSxNQUFNLFFBQVEsS0FBSyxPQUFPLFNBQVMsRUFBRSxHQUFHLFFBQU07QUFDeEUsMEJBQU0sSUFBSSxHQUFHLEtBQUssT0FBSyxFQUFFLG9CQUFvQkEsT0FBTSxlQUFlLE9BQU8sS0FBSyxHQUFHLENBQUM7QUFDbEYsMkJBQU8sR0FBRyxTQUFTO0FBQUEsa0JBQ3JCLENBQUM7QUFDRCx3QkFBTSxjQUFjLE9BQU8sRUFBRSxNQUFNLFNBQVMsS0FBSyxPQUFPLFNBQVMsRUFBRSxHQUFHLFFBQU07QUFDMUUsMEJBQU0sSUFBSSxHQUFHLEtBQUssT0FBSyxFQUFFLG9CQUFvQkEsT0FBTSxlQUFlLE9BQU8sS0FBSyxHQUFHLENBQUM7QUFDbEYsMkJBQU8sR0FBRyxVQUFVO0FBQUEsa0JBQ3RCLENBQUM7QUFDRCx3QkFBTSxXQUFXLE9BQU8sd0JBQXdCLEtBQUssT0FBTyxTQUFTLEVBQUUsR0FBRyxRQUFNO0FBQzlFLDBCQUFNLElBQUksR0FBRyxLQUFLLE9BQUssRUFBRSxvQkFBb0JBLE9BQU0sZUFBZSxPQUFPLEtBQUssR0FBRyxDQUFDO0FBQ2xGLDJCQUFPLEdBQUcsb0JBQW9CQSxPQUFNLGVBQWUsVUFDL0MseUJBQXlCO0FBQUEsa0JBQy9CLENBQUM7QUFDRCx5QkFBTyxxQkFBQyxTQUFJLE9BQU0sY0FBYSxTQUFPLE1BQUMsU0FBUyxJQUM5QztBQUFBLG9DQUFBTCxLQUFDLFNBQUksT0FBTSxTQUFRLFFBQVFJLEtBQUksTUFBTSxRQUNuQywwQkFBQUo7QUFBQSxzQkFBQztBQUFBO0FBQUEsd0JBQU0sVUFBUztBQUFBLHdCQUNkLFFBQVFJLEtBQUksTUFBTTtBQUFBLHdCQUFRLFFBQVFBLEtBQUksTUFBTTtBQUFBO0FBQUEsb0JBQVEsR0FDeEQ7QUFBQSxvQkFDQTtBQUFBLHNCQUFDO0FBQUE7QUFBQSx3QkFBSSxPQUFNO0FBQUEsd0JBQU0sU0FBTztBQUFBLHdCQUFDLGFBQWFBLEtBQUksWUFBWTtBQUFBLHdCQUNwRCxRQUFRQSxLQUFJLE1BQU07QUFBQSx3QkFDbEI7QUFBQSwwQ0FBQUosS0FBQyxXQUFNLE9BQU0sVUFBUyxRQUFRSSxLQUFJLE1BQU0sT0FBTyxXQUFXLEdBQUcsT0FBTyxZQUFZO0FBQUEsMEJBQ2hGLGdCQUFBSixLQUFDLFdBQU0sT0FBTSxRQUFPLFFBQVFJLEtBQUksTUFBTSxPQUFPLFdBQVcsR0FBRyxPQUFPLGFBQWE7QUFBQTtBQUFBO0FBQUEsb0JBQ2pGO0FBQUEsb0JBQ0EsZ0JBQUFKO0FBQUEsc0JBQUM7QUFBQTtBQUFBLHdCQUFPLE9BQU07QUFBQSx3QkFBWSxRQUFRSSxLQUFJLE1BQU07QUFBQSx3QkFDMUMsV0FBVyxNQUFNLFVBQVUsc0JBQXNCO0FBQUEsd0JBQ2pELDBCQUFBSixLQUFDLFdBQU0sVUFBVSxVQUFVO0FBQUE7QUFBQSxvQkFDN0I7QUFBQSxxQkFDRjtBQUFBLGdCQUNGLEdBQUc7QUFBQSxpQkFDTDtBQUFBLGVBQ0YsR0FDRjtBQUFBLFlBR0EsZ0JBQUFBLEtBQUMsU0FBSSxPQUFNLFNBQVEsYUFBYUksS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUNoRSxtQkFBUyxHQUFHLFVBQVEsS0FBSyxRQUFRLFNBQU87QUFBQSxjQUN2QyxnQkFBQUosS0FBQyxXQUFNLE9BQU0sT0FBTSxRQUFRSSxLQUFJLE1BQU0sT0FBTyxPQUFPLElBQUksU0FBUztBQUFBLGNBQ2hFLEdBQUcsSUFBSSxLQUFLLElBQUksT0FBSztBQUNuQixzQkFBTSxVQUFVLEtBQUssUUFBUSxPQUFLLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQztBQUNuRCx1QkFBTyxnQkFBQUo7QUFBQSxrQkFBQztBQUFBO0FBQUEsb0JBQ04sT0FBTyxLQUFLLFFBQVEsRUFBRSxHQUFHLE9BQUssTUFBTSxVQUFVLFlBQVksS0FBSztBQUFBLG9CQUMvRCxXQUFXLE1BQU07QUFBRSx3QkFBRSxJQUFJO0FBQUcsa0NBQVk7QUFBQSxvQkFBRTtBQUFBLG9CQUMxQywrQkFBQyxTQUFJLFNBQVMsSUFFWjtBQUFBLHNDQUFBQSxLQUFDLFNBQUksT0FBTSxNQUFLLFFBQVFJLEtBQUksTUFBTSxRQUNoQywwQkFBQUosS0FBQyxXQUFNLFVBQVUsRUFBRSxNQUFNLFdBQVcsSUFBSSxHQUMxQztBQUFBLHNCQUNBLGdCQUFBQSxLQUFDLFdBQU0sV0FBUyxNQUFDLE9BQU8sRUFBRSxRQUFRO0FBQUEsc0JBQ2xDLGdCQUFBQTtBQUFBLHdCQUFDO0FBQUE7QUFBQSwwQkFBTSxPQUFNO0FBQUEsMEJBQU8sU0FBTztBQUFBLDBCQUFDLFFBQVFJLEtBQUksTUFBTTtBQUFBLDBCQUM1QyxXQUFXO0FBQUEsMEJBQUcsT0FBTyxFQUFFO0FBQUE7QUFBQSxzQkFBTTtBQUFBLHNCQUMvQixnQkFBQUo7QUFBQSx3QkFBQztBQUFBO0FBQUEsMEJBQU0sT0FBTTtBQUFBLDBCQUFPLE9BQU07QUFBQSwwQkFDeEIsU0FBUyxLQUFLLFFBQVEsRUFBRSxHQUFHLE9BQUssTUFBTSxPQUFPO0FBQUE7QUFBQSxzQkFBRztBQUFBLHVCQUNwRDtBQUFBO0FBQUEsZ0JBQ0Y7QUFBQSxjQUNGLENBQUM7QUFBQSxZQUNILENBQUMsQ0FBQyxHQUNKO0FBQUEsWUFHQSxxQkFBQyxTQUFJLE9BQU0sU0FDVDtBQUFBLG1DQUFDLFNBQUksU0FBUyxJQUFJLFNBQU8sTUFBQyxRQUFRSSxLQUFJLE1BQU0sT0FDMUM7QUFBQSxnQ0FBQUosS0FBQyxXQUFNLFdBQVMsTUFBQyxPQUFNLDhCQUE2QjtBQUFBLGdCQUNwRCxnQkFBQUEsS0FBQyxXQUFNLFdBQVMsTUFBQyxPQUFNLHNCQUFxQjtBQUFBLGdCQUM1QyxnQkFBQUEsS0FBQyxXQUFNLFdBQVMsTUFBQyxPQUFNLGdDQUErQjtBQUFBLGlCQUN4RDtBQUFBLGNBQ0EsZ0JBQUFBLEtBQUMsV0FBTSxPQUFNLHVDQUFvQixRQUFRSSxLQUFJLE1BQU0sS0FBSztBQUFBLGVBQzFEO0FBQUEsYUFDRjtBQUFBO0FBQUEsTUFDQTtBQUFBO0FBQUEsRUFDRjtBQUNGOzs7QUczVEEsT0FBT0UsY0FBYTtBQUNwQixPQUFPLGVBQWU7QUFDdEIsT0FBT0MsU0FBUTtBQUVmLE9BQU9DLFVBQVM7QUFDaEIsT0FBT0MsY0FBYTs7O0FDUHBCLE9BQU9DLGNBQWE7QUFDcEIsT0FBT0MsVUFBUztBQUVULElBQU0sYUFBYUQsU0FBUSxjQUFjO0FBQUEsRUFDOUMsV0FBVztBQUNiLEdBQUcsTUFBTUUsb0JBQW1CRCxLQUFJLE1BQU07QUFBQSxFQUNwQyxZQUFZLFFBQW1FO0FBQzdFLFVBQU0sRUFBRSxPQUFPLEdBQUcsS0FBSyxJQUFLLFVBQVUsQ0FBQztBQUN2QyxVQUFNO0FBQUEsTUFDSixhQUFhQSxLQUFJLFlBQVk7QUFBQSxNQUM3QixZQUFZLElBQUlBLEtBQUksV0FBVztBQUFBLFFBQzdCLE9BQU87QUFBQSxRQUFHLE9BQU87QUFBQSxRQUNqQixnQkFBZ0I7QUFBQSxRQUFNLGdCQUFnQjtBQUFBLFFBQUssV0FBVztBQUFBLFFBQ3RELE9BQU8sU0FBUztBQUFBLE1BQ2xCLENBQUM7QUFBQSxNQUNELFlBQVk7QUFBQSxNQUNaLEdBQUc7QUFBQSxJQUNMLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxjQUFjLGFBQThCLFVBQW9EO0FBQzlGLFFBQUksZ0JBQWdCQSxLQUFJLFlBQVksWUFBWTtBQUk5QyxhQUFPLENBQUMsR0FBRyxHQUFHLElBQUksRUFBRTtBQUFBLElBQ3RCO0FBQ0EsV0FBTyxNQUFNLGNBQWMsYUFBYSxRQUFRO0FBQUEsRUFDbEQ7QUFDRixDQUFDOzs7QURYRCxJQUFNLFFBQVEsU0FBaUJFLFNBQUssT0FBTyxhQUFhLEtBQWUsSUFBSTtBQUczRSxJQUFNQyxTQUFRLEdBQUdELFNBQUssbUJBQW1CLENBQUM7QUFDMUMsSUFBSSxRQUFrQixDQUFDLFFBQVEsTUFBTSxRQUFRLFFBQVEsVUFBVSxTQUFTLFVBQVUsWUFBWTtBQUM5RixJQUFJO0FBQUUsVUFBUSxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBT0EsU0FBSyxrQkFBa0JDLE1BQUssRUFBRSxDQUFDLENBQUMsQ0FBQztBQUFFLFFBQVE7QUFBRTtBQUUvRixTQUFTLEtBQUssT0FHWDtBQUNELFNBQU8scUJBQUMsU0FBSSxPQUFPLEtBQUssTUFBTSxNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQWUsSUFBSSxpQkFBaUIsV0FBVyxHQUN2RjtBQUFBLG9CQUFBQyxLQUFDLFlBQU8sT0FBTSxTQUFRLFNBQVMsTUFBTSxXQUFXLE1BQU0sV0FDcEQsK0JBQUMsU0FBSSxTQUFTLEdBQ1o7QUFBQSxzQkFBQUEsS0FBQyxXQUFNLFVBQVUsTUFBTSxNQUFNO0FBQUEsTUFDN0IscUJBQUMsU0FBSSxhQUFhQyxLQUFJLFlBQVksVUFBVSxRQUFRQSxLQUFJLE1BQU0sUUFDNUQ7QUFBQSx3QkFBQUQsS0FBQyxXQUFNLFFBQVFDLEtBQUksTUFBTSxPQUFPLE9BQU8sTUFBTSxPQUFPO0FBQUEsUUFDbkQsTUFBTSxPQUFPLGdCQUFBRDtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQU0sT0FBTTtBQUFBLFlBQU0sUUFBUUMsS0FBSSxNQUFNO0FBQUEsWUFDakQsV0FBVztBQUFBLFlBQUcsT0FBTyxNQUFNO0FBQUE7QUFBQSxRQUFLO0FBQUEsU0FDcEM7QUFBQSxPQUNGLEdBQ0Y7QUFBQSxJQUVDLE1BQU0sV0FDTCxnQkFBQUQsS0FBQyxZQUFPLE9BQU0sUUFBTyxTQUFTLE9BQU8sY0FBYyxJQUFJLFdBQVcsTUFBTSxTQUN0RSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsZ0NBQStCLEdBQ2pEO0FBQUEsS0FDSjtBQUNGO0FBRUEsU0FBUyxVQUFVO0FBQ2pCLFFBQU0sVUFBVUUsSUFBRyxZQUFZLEdBQUcsbUJBQW1CO0FBR3JELE1BQUksQ0FBQyxXQUFXLENBQUMsS0FBTSxRQUFPLGdCQUFBRixLQUFDLFNBQUk7QUFDbkMsUUFBTSxVQUFVLFVBQ1osS0FBSyxTQUFTLGFBQWEsRUFBRSxHQUFHLE9BQUssS0FBSyw2QkFBNkIsSUFDdkU7QUFDSixRQUFNLFdBQWdCLE9BQU8sRUFBRSxTQUFTLEtBQUssU0FBVSxRQUFRO0FBSS9ELFFBQU0sVUFBVSxPQUFPLEVBQUUsU0FBVSxTQUFTLFVBQVU7QUFDdEQsUUFBTSxZQUFZLElBQUksV0FBVyxFQUFFLFNBQVMsTUFBTSxZQUFZLENBQUMsUUFBUSxHQUFHLE9BQU8sUUFBUSxDQUFDO0FBQzFGLE1BQUksQ0FBQyxRQUFRLFFBQVMsTUFBSyxTQUFTLFFBQVEsRUFBRSxVQUFVLENBQUMsTUFBYztBQUFFLGNBQVUsZUFBZSxFQUFFLFFBQVE7QUFBQSxFQUFFLENBQUM7QUFFL0csWUFBVSxRQUFRLGdCQUFnQixDQUFDLElBQVMsSUFBUyxNQUFjO0FBQUUsUUFBSSxRQUFTLFNBQVEsU0FBUztBQUFBLEVBQUUsQ0FBQztBQUV0RyxRQUFNLGNBQWMsU0FBUyxPQUFPLEVBQUUsYUFBYSxHQUFHO0FBQ3RELE1BQUksQ0FBQyxNQUFNO0FBQ1QsWUFBUSxJQUFJLENBQUMsVUFBVSxtQkFBbUIsR0FBRyxVQUFVLG1CQUFtQixDQUFDLENBQUMsRUFDekUsS0FBSyxDQUFDLENBQUMsS0FBSyxHQUFHLE1BQU0sWUFBWSxJQUFJLFNBQVMsSUFBSSxLQUFLLENBQUMsSUFBSSxTQUFTLElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUNqRixNQUFNLE1BQU07QUFBQSxJQUF3QyxDQUFDO0FBQUEsRUFDMUQ7QUFDQSxRQUFNLGVBQWUsSUFBSSxXQUFXLEVBQUUsU0FBUyxNQUFNLFlBQVksQ0FBQyxRQUFRLEdBQUcsT0FBTyxZQUFZLElBQUksRUFBRSxDQUFDO0FBQ3ZHLGNBQVksVUFBVSxPQUFLO0FBQUUsaUJBQWEsZUFBZSxFQUFFLFFBQVE7QUFBQSxFQUFFLENBQUM7QUFDdEUsZUFBYSxRQUFRLGdCQUFnQixDQUFDLElBQVMsSUFBUyxNQUN0RCxVQUFVLHFCQUFxQixLQUFLLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxFQUNsRCxLQUFLLE1BQU0sWUFBWSxJQUFJLENBQUMsQ0FBQyxFQUFFLE1BQU0sTUFBTTtBQUFBLEVBQUMsQ0FBQyxDQUFDO0FBRW5ELFNBQU8scUJBQUMsU0FBSSxPQUFNLFdBQVUsYUFBYUMsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUMxRTtBQUFBLHlCQUFDLFNBQUksT0FBTSxRQUFPLFNBQVMsR0FDekI7QUFBQSxzQkFBQUQsS0FBQyxXQUFNLFVBQVUsU0FBUztBQUFBLE1BQ3pCO0FBQUEsTUFDRCxnQkFBQUEsS0FBQyxZQUFPLE9BQU0sUUFBTyxjQUFjLElBQUksV0FBVyxNQUFNLE1BQU0sSUFBSSxLQUFLLEdBQ3JFLDBCQUFBQSxLQUFDLFdBQU0sVUFBUyxnQ0FBK0IsR0FDakQ7QUFBQSxPQUNGO0FBQUEsSUFDQSxxQkFBQyxTQUFJLE9BQU0sUUFBTyxTQUFTLEdBQ3pCO0FBQUEsc0JBQUFBLEtBQUMsV0FBTSxVQUFTLDZCQUE0QjtBQUFBLE1BQzNDO0FBQUEsTUFFRCxnQkFBQUEsS0FBQyxTQUFJLGNBQWMsSUFBSTtBQUFBLE9BQ3pCO0FBQUEsS0FDRjtBQUNGO0FBRUEsU0FBUyxnQkFBZ0I7QUFDdkIsU0FBTyxxQkFBQyxTQUFJLE9BQU0sV0FBVSxTQUFTLE9BQU8sUUFBUSxLQUFLLFNBQVMsRUFBRSxHQUFHLE9BQUssQ0FBQyxDQUFDLEdBQUcsU0FBUyxJQUN4RjtBQUFBLG9CQUFBQSxLQUFDLFdBQU0sVUFBUywwQkFBeUI7QUFBQSxJQUN6QyxxQkFBQyxTQUFJLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQU8sTUFDakQ7QUFBQSxzQkFBQUQsS0FBQyxXQUFNLE9BQU0sS0FBSSxRQUFRQyxLQUFJLE1BQU0sT0FBTyxPQUFNLGtDQUFpQztBQUFBLE1BQ2pGLGdCQUFBRCxLQUFDLFdBQU0sT0FBTSxLQUFJLFFBQVFDLEtBQUksTUFBTSxPQUFPLE9BQU0scUNBQW9DO0FBQUEsT0FDdEY7QUFBQSxJQUNBLGdCQUFBRCxLQUFDLFlBQU8sT0FBTSxRQUFPLE9BQU0sYUFBWSxXQUFXLE1BQU0sT0FBTyxFQUFFLE1BQU0sTUFBTTtBQUFBLElBQUUsQ0FBQyxHQUFHO0FBQUEsS0FDckY7QUFDRjtBQUlBLElBQU0sZ0JBQWdCLElBQUlHLEtBQUksU0FBUyxFQUFFLFFBQVEsOEJBQThCLENBQUM7QUFDaEYsSUFBTSxRQUFRLFNBQVMsY0FBYyxXQUFXLGNBQWMsTUFBTSxhQUFhO0FBQ2pGLGNBQWMsUUFBUSx5QkFBeUIsTUFDN0MsTUFBTSxJQUFJLGNBQWMsV0FBVyxjQUFjLE1BQU0sYUFBYSxDQUFDO0FBR3ZFLElBQUksZ0JBQXFDO0FBQ3pDLElBQU0sU0FBUyxTQUFTLEtBQUs7QUFDN0IsSUFBSTtBQUNGLGtCQUFnQixJQUFJQSxLQUFJLFNBQVMsRUFBRSxRQUFRLDBDQUEwQyxDQUFDO0FBQ3RGLFNBQU8sSUFBSSxjQUFjLFlBQVkscUJBQXFCLENBQUM7QUFDM0QsZ0JBQWMsUUFBUSxnQ0FBZ0MsTUFDcEQsT0FBTyxJQUFJLGNBQWUsWUFBWSxxQkFBcUIsQ0FBQyxDQUFDO0FBQ2pFLFFBQVE7QUFBc0M7QUFHOUMsSUFBTSxXQUFXRCxJQUFHLFlBQVksR0FBRyxtQkFBbUI7QUFDdEQsSUFBTSxVQUFVLFdBQ1gsS0FBSyxVQUFVLE1BQU0sSUFDdEIsU0FBUyxLQUFLO0FBR2xCLElBQU0sUUFBUSxTQUFTLEtBQUs7QUFDNUIsVUFBVSxzQkFBc0IsRUFDN0IsS0FBSyxPQUFLLE1BQU0sSUFBSSxFQUFFLEtBQUssTUFBTSxhQUFhLENBQUMsRUFDL0MsTUFBTSxNQUFNO0FBQWdDLENBQUM7QUFHaEQsSUFBTSxXQUFXLFNBQVMsS0FBSztBQUkvQixTQUFTLFdBQVcsT0FBc0Y7QUFDeEcsU0FBTyxnQkFBQUY7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUFLLElBQUksTUFBTTtBQUFBLE1BQU8sT0FBTyxNQUFNO0FBQUEsTUFBTyxNQUFNLE1BQU07QUFBQSxNQUM1RCxRQUFRLEtBQUssTUFBTSxDQUFDO0FBQUEsTUFDcEIsV0FBVyxNQUFNLGNBQWMsTUFBTSxNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFBQTtBQUFBLEVBQUk7QUFDdkU7QUFFQSxTQUFTLGNBQW1CO0FBQzFCLFFBQU0sTUFBTUksU0FBUSxZQUFZO0FBQ2hDLE1BQUksQ0FBQyxJQUFLLFFBQU87QUFDakIsU0FBTyxLQUFLLEtBQUssWUFBWSxFQUFFLEdBQUcsT0FBSztBQUNyQyxVQUFNLE1BQU0sS0FBSyxNQUFNLElBQUksR0FBRztBQUM5QixVQUFNLFFBQVEsSUFBSSxPQUFPLGtCQUFrQixJQUFJLFdBQVcsYUFBYTtBQUN2RSxXQUFPLEdBQUcsR0FBRyxVQUFPLEtBQUs7QUFBQSxFQUMzQixDQUFDO0FBQ0g7QUFDQSxJQUFNLGFBQWFBLFNBQVEsWUFBWSxLQUFLO0FBRTVDLFNBQVMsS0FBSyxFQUFFLEtBQUssR0FBc0I7QUFDekMsUUFBTSxNQUFNQyxTQUFRLFlBQVk7QUFDaEMsUUFBTSxLQUFLLFVBQVUsWUFBWTtBQUdqQyxTQUFPLHFCQUFDLFNBQUksTUFBWSxhQUFhSixLQUFJLFlBQVksVUFBVSxTQUFTLEdBRXRFO0FBQUEseUJBQUMsU0FBSSxPQUFNLFVBQVMsU0FBUyxHQUV6QjtBQUFBLGVBQVEsZUFBZSxxQkFBQyxTQUFJLE9BQU0sUUFBTyxTQUFTLEdBQUcsUUFBUUEsS0FBSSxNQUFNLFFBQ3ZFO0FBQUEsd0JBQUFELEtBQUMsV0FBTSxVQUFTLDBCQUF5QjtBQUFBLFFBQ3pDLGdCQUFBQSxLQUFDLFdBQU0sT0FBTSxNQUFLLE9BQU8sT0FBTyxFQUFFLE9BQU8sWUFBWSxHQUFHO0FBQUEsU0FDMUQ7QUFBQSxNQUNBLGdCQUFBQSxLQUFDLFNBQUksU0FBTyxNQUFDO0FBQUEsTUFDYixnQkFBQUEsS0FBQyxZQUFPLE9BQU0sYUFBWSxXQUFXLE1BQU0sT0FBTyxHQUFHLDBCQUFBQSxLQUFDLFdBQU0sVUFBUyx1QkFBc0IsR0FBRTtBQUFBLE1BQzdGLGdCQUFBQSxLQUFDLFlBQU8sT0FBTSxRQUFPLFdBQVcsTUFBTSxVQUFVLHVCQUF1QixHQUNyRSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsdUJBQXNCLEdBQUU7QUFBQSxNQUMxQyxnQkFBQUEsS0FBQyxZQUFPLE9BQU0sUUFBTyxXQUFXLE1BQU0sU0FBUyxJQUFJLENBQUMsU0FBUyxJQUFJLENBQUMsR0FDaEUsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLHlCQUF3QixHQUFFO0FBQUEsTUFDNUMsZ0JBQUFBLEtBQUMsWUFBTyxPQUFNLGVBQWMsV0FBVyxNQUFNLE9BQWMsU0FBUyxHQUNsRSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsd0JBQXVCLEdBQUU7QUFBQSxPQUM3QztBQUFBLElBQ0EsZ0JBQUFBLEtBQUMsaUJBQWM7QUFBQSxJQUVmLHFCQUFDLFNBQUksT0FBTSxhQUFZLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQVMsR0FDckU7QUFBQSwyQkFBQyxTQUFJLE9BQU0sU0FBUSxhQUFXLE1BQUMsU0FBUyxHQUNwQztBQUFBLGlCQUFRLElBQUksU0FBUyxnQkFBQUQ7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFLLElBQUc7QUFBQSxZQUFPLE9BQU07QUFBQSxZQUFRLE1BQUs7QUFBQSxZQUN4RCxRQUFRLE9BQU8sU0FBUyxJQUFJLElBQUksS0FBSyxJQUFJLE1BQU8sU0FBUztBQUFBLFlBQ3pELEtBQUssT0FBTyxFQUFFLFdBQVcsS0FBSyxJQUFJLE1BQU8sTUFBTSxFQUFFLEdBQUcsT0FBSyxLQUFLLEtBQUs7QUFBQSxZQUNuRSxXQUFXLE1BQU07QUFBRSxrQkFBSSxDQUFDLFFBQVEsSUFBSSxLQUFNLEtBQUksS0FBSyxVQUFVLENBQUMsSUFBSSxLQUFLO0FBQUEsWUFBUTtBQUFBLFlBQy9FLFNBQVMsTUFBTSxNQUFNLElBQUksTUFBTTtBQUFBO0FBQUEsUUFBRztBQUFBLFFBQ3BDLGdCQUFBQTtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQUssSUFBRztBQUFBLFlBQUssT0FBTTtBQUFBLFlBQVksTUFBSztBQUFBLFlBQ25DLFFBQVEsT0FBTyxTQUFTLElBQUksSUFBSSxLQUFLLElBQUksU0FBUyxFQUFFLEdBQUcsT0FBSyxFQUFFLEtBQUssT0FBSyxFQUFFLFNBQVMsQ0FBQztBQUFBLFlBQ3BGLEtBQUssT0FBTyxFQUFFLFdBQVcsS0FBSyxJQUFJLFNBQVMsRUFBRSxHQUFHLE9BQzlDLEVBQUUsS0FBSyxPQUFLLEVBQUUsU0FBUyxHQUFHLFNBQVMsS0FBSztBQUFBLFlBQzFDLFdBQVcsTUFBTTtBQUFFLGtCQUFJLENBQUMsS0FBTSxJQUFHLE9BQU87QUFBQSxZQUFFO0FBQUEsWUFDMUMsU0FBUyxNQUFNLE1BQU0sSUFBSSxJQUFJO0FBQUE7QUFBQSxRQUFHO0FBQUEsU0FDcEM7QUFBQSxNQUNBLHFCQUFDLFNBQUksT0FBTSxTQUFRLGFBQVcsTUFBQyxTQUFTLEdBQ3RDO0FBQUEsd0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBVyxPQUFNO0FBQUEsWUFBYyxNQUFLO0FBQUEsWUFBc0IsR0FBRztBQUFBLFlBQzVELFdBQVcsTUFBTTtBQUNmLG9CQUFNLE9BQU8sQ0FBQyxNQUFNLElBQUk7QUFDeEIsd0JBQVUsd0JBQXdCLE9BQU8sZ0JBQWdCLFVBQVUsRUFBRSxFQUNsRSxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksQ0FBQyxFQUFFLE1BQU0sTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQUEsWUFDNUQ7QUFBQTtBQUFBLFFBQUc7QUFBQSxRQUNMLGdCQUFBQTtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQVcsT0FBTTtBQUFBLFlBQWEsTUFBSztBQUFBLFlBQXNCLEdBQUc7QUFBQSxZQUMzRCxXQUFXLE1BQU07QUFDZixvQkFBTSxPQUFPLENBQUMsTUFBTSxJQUFJO0FBQ3hCLDRCQUFjLFdBQVcsZ0JBQWdCLE9BQU8sZ0JBQWdCLFNBQVM7QUFBQSxZQUMzRTtBQUFBO0FBQUEsUUFBRztBQUFBLFNBQ1A7QUFBQSxNQUNBLHFCQUFDLFNBQUksT0FBTSxTQUFRLGFBQVcsTUFBQyxTQUFTLEdBQ3RDO0FBQUEsd0JBQUFBO0FBQUEsVUFBQztBQUFBO0FBQUEsWUFBVyxPQUFNO0FBQUEsWUFBUyxNQUFLO0FBQUEsWUFBNEIsR0FBRztBQUFBLFlBQzdELFdBQVcsTUFBTTtBQUFFLGtCQUFJLFNBQVUsVUFBUyxPQUFPLENBQUMsU0FBUztBQUFBLFlBQUs7QUFBQTtBQUFBLFFBQUc7QUFBQSxRQUNyRSxnQkFBQUE7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFXLE9BQU07QUFBQSxZQUFjLE1BQUs7QUFBQSxZQUFxQixHQUFHO0FBQUEsWUFDM0QsV0FBVyxNQUFNO0FBQ2Ysa0JBQUk7QUFDRiw4QkFBYyxZQUFZLHVCQUF1QixDQUFDLE9BQU8sSUFBSSxDQUFDO0FBQUEsWUFDbEU7QUFBQTtBQUFBLFFBQUc7QUFBQSxTQUNQO0FBQUEsT0FDRjtBQUFBLElBQ0EsZ0JBQUFBLEtBQUMsV0FBUTtBQUFBLEtBQ1g7QUFDRjtBQUdBLFNBQVMsU0FBUyxVQUEwQjtBQUMxQyxTQUFPO0FBQ1Q7QUFHQSxTQUFTLFdBQVc7QUFDbEIsUUFBTSxPQUFPSyxTQUFRLFlBQVksRUFBRTtBQUNuQyxNQUFJLENBQUMsS0FBTSxRQUFPLGdCQUFBTCxLQUFDLFNBQUk7QUFDdkIsU0FBTyxnQkFBQUEsS0FBQyxTQUFJLE9BQU0sU0FBUSxhQUFhQyxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ3ZFLGVBQUssTUFBTSxjQUFjLEVBQUUsR0FBRyxTQUFPO0FBQ3BDLFVBQU0sU0FBUyxLQUFLO0FBQ3BCLFVBQU0sT0FBTyxvQkFBSSxJQUFZO0FBQzdCLFdBQU8sSUFDSixPQUFPLFFBQU0sR0FBRyxRQUFRLENBQUMsS0FBSyxJQUFJLEdBQUcsSUFBSSxLQUFLLEtBQUssSUFBSSxHQUFHLElBQUksQ0FBQyxFQUMvRCxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFDdEMsTUFBTSxHQUFHLENBQUMsRUFDVixJQUFJLFFBQU07QUFDVCxZQUFNLEtBQUssVUFBVSxHQUFHLFNBQVMsT0FBTztBQUN4QyxhQUFPLGdCQUFBRDtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQU8sT0FBTyxLQUFLLGdCQUFnQjtBQUFBLFVBQ3pDLFdBQVcsTUFBTSxLQUFLLG9CQUFvQixJQUFJLElBQUk7QUFBQSxVQUNsRCwrQkFBQyxTQUFJLFNBQVMsSUFDWjtBQUFBLDRCQUFBQSxLQUFDLFdBQU0sVUFBVSxTQUFTLEdBQUcsUUFBUSxHQUFHO0FBQUEsWUFDeEMsZ0JBQUFBLEtBQUMsV0FBTSxTQUFPLE1BQUMsUUFBUUMsS0FBSSxNQUFNLE9BQU8sT0FBTyxHQUFHLE1BQU07QUFBQSxZQUN4RCxnQkFBQUQsS0FBQyxXQUFNLE9BQU0sTUFBSyxPQUFPLEtBQUssY0FBYyxHQUFHLEdBQUcsUUFBUSxLQUFLO0FBQUEsYUFDakU7QUFBQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNMLENBQUMsR0FDSDtBQUNGO0FBR0EsU0FBUyxTQUFTO0FBQ2hCLFFBQU0sS0FBSyxVQUFVLFlBQVk7QUFDakMsU0FBTyxnQkFBQUEsS0FBQyxTQUFJLE9BQU0sU0FBUSxhQUFhQyxLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ3ZFLGVBQUssSUFBSSxTQUFTLEVBQUUsR0FBRyxhQUFXLFFBQ2hDLE9BQU8sT0FBSyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQzdCLEtBQUssQ0FBQyxHQUFHLE1BQU0sT0FBTyxFQUFFLFNBQVMsSUFBSSxPQUFPLEVBQUUsU0FBUyxDQUFDLEVBQ3hELE1BQU0sR0FBRyxDQUFDLEVBQ1YsSUFBSSxTQUFPO0FBQ1YsVUFBTSxLQUFLLElBQUk7QUFDZixXQUFPLGdCQUFBRDtBQUFBLE1BQUM7QUFBQTtBQUFBLFFBQU8sT0FBTyxLQUFLLGdCQUFnQjtBQUFBLFFBQ3pDLFdBQVcsTUFBTSxLQUFLLElBQUksa0JBQWtCLElBQUksSUFBSSxlQUFlO0FBQUEsUUFDbkUsK0JBQUMsU0FBSSxTQUFTLElBQ1o7QUFBQSwwQkFBQUEsS0FBQyxXQUFNLFVBQVMsNEJBQTJCO0FBQUEsVUFDM0MsZ0JBQUFBLEtBQUMsV0FBTSxTQUFPLE1BQUMsUUFBUUMsS0FBSSxNQUFNLE9BQU8sT0FBTyxJQUFJLFNBQVMsSUFBSSxNQUFNO0FBQUEsVUFDdEUsZ0JBQUFELEtBQUMsV0FBTSxPQUFNLE1BQUssT0FBTyxLQUFLLGNBQWMsSUFBSSxTQUFTLFdBQVcsYUFBYTtBQUFBLFdBQ25GO0FBQUE7QUFBQSxJQUNGO0FBQUEsRUFDRixDQUFDLENBQUMsR0FDTjtBQUNGO0FBR0EsU0FBUyxPQUFPLE9BQXFEO0FBQ25FLFNBQU8scUJBQUMsU0FBSSxPQUFNLFVBQVMsU0FBUyxJQUNsQztBQUFBLG9CQUFBQSxLQUFDLFNBQUksT0FBTSxNQUFLLFFBQVFDLEtBQUksTUFBTSxRQUNoQywwQkFBQUQsS0FBQyxXQUFNLFVBQVUsTUFBTSxNQUFNLEdBQUU7QUFBQSxJQUNqQyxnQkFBQUE7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUFNLE9BQU07QUFBQSxRQUFRLFFBQVFDLEtBQUksTUFBTTtBQUFBLFFBQVEsUUFBUUEsS0FBSSxNQUFNO0FBQUEsUUFDL0QsV0FBVztBQUFBLFFBQUcsT0FBTyxNQUFNO0FBQUE7QUFBQSxJQUFPO0FBQUEsSUFDcEMsZ0JBQUFEO0FBQUEsTUFBQztBQUFBO0FBQUEsUUFBTyxPQUFNO0FBQUEsUUFBUyxTQUFPO0FBQUEsUUFBQyxRQUFRQyxLQUFJLE1BQU07QUFBQSxRQUMvQyxPQUFPLEtBQUssTUFBTSxRQUFRLFFBQVE7QUFBQSxRQUNsQyxlQUFlLENBQUMsSUFBSSxNQUFNO0FBQUUsZ0JBQU0sT0FBTyxTQUFTO0FBQUEsUUFBRTtBQUFBO0FBQUEsSUFBRztBQUFBLEtBQzNEO0FBQ0Y7QUFHQSxTQUFTLFVBQVU7QUFDakIsUUFBTSxLQUFLQyxJQUFHLFlBQVk7QUFDMUIsTUFBSSxDQUFDLEdBQUksUUFBTyxnQkFBQUYsS0FBQyxTQUFJO0FBQ3JCLFFBQU0sVUFBVSxHQUFHO0FBQ25CLFNBQU8scUJBQUMsU0FBSSxPQUFNLFNBQVEsYUFBYUMsS0FBSSxZQUFZLFVBQVUsU0FBUyxHQUN2RTtBQUFBLGVBQVcsZ0JBQUFELEtBQUMsVUFBTyxNQUFLLCtCQUE4QixPQUFNLFVBQVMsUUFBUSxTQUFTO0FBQUEsSUFDdEYsS0FBSyxHQUFHLE9BQU8sU0FBUyxFQUFFLEdBQUcsYUFBVyxRQUFRLE1BQU0sR0FBRyxDQUFDLEVBQUUsSUFBSSxPQUMvRCxnQkFBQUE7QUFBQSxNQUFDO0FBQUE7QUFBQSxRQUFPLE1BQUs7QUFBQSxRQUNYLE9BQU8sRUFBRSxlQUFlLEVBQUUsUUFBUTtBQUFBLFFBQWUsUUFBUTtBQUFBO0FBQUEsSUFBRyxDQUFFLENBQUM7QUFBQSxLQUNyRTtBQUNGO0FBRUEsU0FBUyxVQUFVLEVBQUUsS0FBSyxHQUFzQjtBQUM5QyxRQUFNLE1BQU1LLFNBQVEsWUFBWTtBQUNoQyxTQUFPLHFCQUFDLFNBQUksTUFBWSxhQUFhSixLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ3RFO0FBQUEseUJBQUMsZUFBVSxPQUFNLFNBQ2Y7QUFBQSxzQkFBQUQsS0FBQyxZQUFPLE9BQU0sUUFBTyxXQUFXLE1BQU0sTUFBTSxJQUFJLElBQUksR0FDbEQsMEJBQUFBLEtBQUMsV0FBTSxVQUFTLCtCQUE4QixHQUFFO0FBQUEsTUFDbEQsZ0JBQUFBLEtBQUMsV0FBTSxPQUFPLEtBQUssS0FBSyxFQUFFLEdBQUcsT0FDM0IsTUFBTSxTQUFTLFVBQVUsTUFBTSxPQUFPLGNBQWMsUUFBUSxHQUFHO0FBQUEsTUFDakUscUJBQUMsU0FBSSxjQUFjLElBQUksUUFBUUMsS0FBSSxNQUFNLEtBQ3RDO0FBQUEsWUFBSSxRQUFRLGdCQUFBRDtBQUFBLFVBQUM7QUFBQTtBQUFBLFlBQU8sUUFBUSxLQUFLLElBQUksTUFBTSxTQUFTO0FBQUEsWUFDbkQsU0FBUyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQUssTUFBTSxNQUFNO0FBQUEsWUFDekMsZ0JBQWdCLE9BQUs7QUFBRSxrQkFBSSxLQUFNLFVBQVUsRUFBRTtBQUFBLFlBQU87QUFBQTtBQUFBLFFBQUc7QUFBQSxRQUN6RCxnQkFBQUE7QUFBQSxVQUFDO0FBQUE7QUFBQSxZQUFPLFFBQVEsS0FBSyxVQUFVLFlBQVksR0FBRyxTQUFTO0FBQUEsWUFDckQsU0FBUyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQUssTUFBTSxJQUFJO0FBQUEsWUFDdkMsZ0JBQWdCLE9BQUs7QUFBRSx3QkFBVSxZQUFZLEVBQUUsUUFBUSxVQUFVLEVBQUU7QUFBQSxZQUFPO0FBQUE7QUFBQSxRQUFHO0FBQUEsU0FDakY7QUFBQSxPQUNGO0FBQUEsSUFDQyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQ2QsTUFBTSxTQUFTLGdCQUFBQSxLQUFDLFlBQVMsSUFBSyxNQUFNLE9BQU8sZ0JBQUFBLEtBQUMsVUFBTyxJQUNuRCxNQUFNLFFBQVEsZ0JBQUFBLEtBQUMsV0FBUSxJQUFLLGdCQUFBQSxLQUFDLFNBQUksQ0FBRTtBQUFBLEtBQ3ZDO0FBQ0Y7QUFFZSxTQUFSLGdCQUFpQztBQUN0QyxRQUFNLEVBQUUsWUFBWSxVQUFVLGFBQWEsT0FBTyxRQUFRLFNBQVMsSUFBSSxXQUFXLEtBQUssR0FBRztBQUMxRixXQUFTLGlCQUFpQixRQUFRO0FBQ2xDLFNBQU8sZ0JBQUFBO0FBQUEsSUFBQztBQUFBO0FBQUEsTUFDTixNQUFLO0FBQUEsTUFBZ0IsV0FBVTtBQUFBLE1BQVcsT0FBTTtBQUFBLE1BQ2hELFNBQVMsS0FBSyxVQUFVO0FBQUEsTUFDeEIsUUFBUU0sT0FBTSxhQUFhLE1BQU1BLE9BQU0sYUFBYTtBQUFBLE1BQ3BELGFBQWFBLE9BQU0sWUFBWTtBQUFBLE1BQy9CLFNBQVNBLE9BQU0sUUFBUTtBQUFBLE1BQ3ZCLGNBQWMsQ0FBQyxPQUFPQyxTQUFRO0FBQzVCLFlBQUlBLFNBQVFDLEtBQUksV0FBWSxRQUFPO0FBQ25DLFlBQUksTUFBTSxJQUFJLEdBQUc7QUFBRSxnQkFBTSxJQUFJLElBQUk7QUFBRyxpQkFBTztBQUFBLFFBQUs7QUFDaEQsY0FBTTtBQUFHLGVBQU87QUFBQSxNQUNsQjtBQUFBLE1BQ0EsMEJBQUFSO0FBQUEsUUFBQztBQUFBO0FBQUEsVUFDQyxnQkFBZ0JDLEtBQUksdUJBQXVCO0FBQUEsVUFDM0Msb0JBQW9CO0FBQUEsVUFDcEIsYUFBYSxLQUFLLFFBQVE7QUFBQSxVQUMxQixPQUFPLENBQUMsTUFBb0IsWUFBWSxDQUFDO0FBQUEsVUFDekMsMEJBQUFELEtBQUMsU0FBSSxPQUFNLFlBR1Q7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUNDLGdCQUFnQkMsS0FBSSxvQkFBb0I7QUFBQSxjQUN4QyxvQkFBb0I7QUFBQSxjQUNwQixrQkFBa0IsS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLElBQUksVUFBVSxNQUFNO0FBQUEsY0FDMUQ7QUFBQSxnQ0FBQUQsS0FBQyxRQUFLLE1BQUssUUFBTztBQUFBLGdCQUNsQixnQkFBQUEsS0FBQyxhQUFVLE1BQUssU0FBUTtBQUFBO0FBQUE7QUFBQSxVQUMxQixHQUNGO0FBQUE7QUFBQSxNQUNGO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7OztBRWxXQSxPQUFPUyxhQUFZO0FBQ25CLE9BQU9DLFlBQVc7QUFNbEIsSUFBSSxVQUFnQztBQUNwQyxJQUFNLEtBQUssTUFBTyxZQUFZQyxRQUFPLFlBQVk7QUFDakQsSUFBTSxPQUFPLE1BQU0sQ0FBQyxDQUFDQyxTQUFLLE9BQU8sbUJBQW1CO0FBQ3BELElBQU0sV0FBVztBQUdqQixJQUFNLGFBQWEsU0FBUyxLQUFLO0FBSWpDLElBQU0sVUFBVTtBQUNoQixTQUFTLEtBQUssRUFBRSxHQUFBQyxHQUFFLEdBQStCO0FBQy9DLFNBQU8scUJBQUMsU0FBSSxPQUFNLFNBQVEsU0FBUyxJQUFJLGNBQWMsU0FFbkQ7QUFBQSxvQkFBQUMsS0FBQyxTQUFJLE9BQU0sT0FBTSxRQUFRQyxLQUFJLE1BQU0sT0FDakMsMEJBQUFELEtBQUMsV0FBTSxVQUFVRCxHQUFFLFlBQVksK0JBQStCLFdBQVcsSUFBSSxHQUMvRTtBQUFBLElBQ0EscUJBQUMsU0FBSSxhQUFhRSxLQUFJLFlBQVksVUFBVSxTQUFPLE1BQ2pEO0FBQUEsMkJBQUMsU0FDQztBQUFBLHdCQUFBRCxLQUFDLFdBQU0sUUFBUUMsS0FBSSxNQUFNLE9BQU8sU0FBTyxNQUFDLFdBQVcsR0FBRyxPQUFPRixHQUFFLFNBQVM7QUFBQSxRQUN4RSxnQkFBQUMsS0FBQyxXQUFNLE9BQU0sV0FBVSxPQUFPLElBQUksS0FBS0QsR0FBRSxPQUFPLEdBQUksRUFDakQsbUJBQW1CLFNBQVMsRUFBRSxNQUFNLFdBQVcsUUFBUSxVQUFVLENBQUMsR0FBRztBQUFBLFNBQzFFO0FBQUEsTUFDQSxnQkFBQUM7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUFNLE9BQU07QUFBQSxVQUFPLFFBQVFDLEtBQUksTUFBTTtBQUFBLFVBQU8sUUFBUTtBQUFBLFVBQUcsTUFBSTtBQUFBLFVBQzFELGVBQWU7QUFBQSxVQUFJLE9BQU9GLEdBQUU7QUFBQTtBQUFBLE1BQU07QUFBQSxPQUN0QztBQUFBLElBQ0EsZ0JBQUFDLEtBQUMsWUFBTyxPQUFNLE1BQUssUUFBUUMsS0FBSSxNQUFNLE9BQU8sV0FBVyxNQUFNRixHQUFFLFFBQVEsR0FDckUsMEJBQUFDLEtBQUMsV0FBTSxVQUFTLHdCQUF1QixHQUN6QztBQUFBLEtBQ0Y7QUFDRjtBQUVPLFNBQVMsT0FBTyxTQUFzQjtBQUMzQyxNQUFJLEtBQUssRUFBRyxRQUFPO0FBSW5CLFFBQU0sT0FBTyxTQUFtQixDQUFDLENBQUM7QUFJbEMsUUFBTSxRQUFRLFNBQW1CLENBQUMsQ0FBQztBQUNuQyxRQUFNLFlBQVksTUFBTSxNQUFNLElBQUksV0FBVyxJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDO0FBQ3BFLE9BQUssVUFBVSxTQUFTO0FBQ3hCLGFBQVcsVUFBVSxTQUFTO0FBQzlCLEtBQUcsRUFBRSxRQUFRLFlBQVksQ0FBQyxJQUFJLE9BQU87QUFDbkMsUUFBSSxXQUFXLElBQUksS0FBSyxHQUFHLEVBQUUsYUFBYztBQUMzQyxTQUFLLElBQUksQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEVBQUUsQ0FBQztBQUM1QixZQUFRLFVBQVUsTUFBTSxLQUFLLElBQUksS0FBSyxJQUFJLEVBQUUsT0FBTyxPQUFLLE1BQU0sRUFBRSxDQUFDLENBQUM7QUFBQSxFQUNwRSxDQUFDO0FBQ0QsU0FBTyxnQkFBQUE7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFTLFdBQVU7QUFBQSxNQUFlLFlBQVk7QUFBQSxNQUluRCxTQUFTLEtBQUssVUFBVSxFQUFFLEdBQUcsT0FBSyxDQUFDLENBQUM7QUFBQSxNQUlwQyxXQUFXO0FBQUEsTUFBSSxhQUFhO0FBQUEsTUFDNUIsUUFBUUUsT0FBTSxhQUFhLE1BQU1BLE9BQU0sYUFBYTtBQUFBLE1BRXBELDBCQUFBRjtBQUFBLFFBQUM7QUFBQTtBQUFBLFVBQUksYUFBYUMsS0FBSSxZQUFZO0FBQUEsVUFBVSxTQUFTO0FBQUEsVUFDbkQsY0FBYyxVQUFVO0FBQUEsVUFBSSxRQUFRQSxLQUFJLE1BQU07QUFBQSxVQUM3QyxlQUFLLEtBQUssRUFBRSxHQUFHLFNBQU8sSUFBSSxJQUFJLFFBQU07QUFDbkMsa0JBQU1GLEtBQUksR0FBRyxFQUFFLGlCQUFpQixFQUFFO0FBQ2xDLG1CQUFPQSxLQUFJLGdCQUFBQyxLQUFDLFNBQUksT0FBTSxTQUFRLDBCQUFBQSxLQUFDLFFBQUssR0FBR0QsSUFBRyxHQUFFLElBQVMsZ0JBQUFDLEtBQUMsU0FBSTtBQUFBLFVBQzVELENBQUMsQ0FBQztBQUFBO0FBQUEsTUFDSjtBQUFBO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxZQUFZO0FBQ25CLE1BQUksU0FBYztBQUNsQixNQUFJO0FBQUUsYUFBU0csT0FBTSxZQUFZLEdBQUcsVUFBVSxDQUFDLEtBQUs7QUFBQSxFQUFLLFFBQVE7QUFBRSxhQUFTO0FBQUEsRUFBSztBQUNqRixNQUFJLENBQUMsT0FBUSxRQUFPLGdCQUFBSCxLQUFDLFNBQUksU0FBUyxPQUFPO0FBQ3pDLFNBQU8scUJBQUMsU0FBSSxPQUFNLGVBQWMsU0FBUyxJQUN2QztBQUFBLG9CQUFBQSxLQUFDLFdBQU0sV0FBVyxJQUFJLFVBQVMsd0JBQXVCO0FBQUEsSUFDdEQscUJBQUMsU0FBSSxhQUFhQyxLQUFJLFlBQVksVUFBVSxTQUFPLE1BQUMsUUFBUUEsS0FBSSxNQUFNLFFBQ3BFO0FBQUEsc0JBQUFELEtBQUMsV0FBTSxRQUFRQyxLQUFJLE1BQU0sT0FBTyxXQUFXLEdBQUcsT0FBTyxLQUFLLFFBQVEsT0FBTyxHQUFHO0FBQUEsTUFDNUUsZ0JBQUFELEtBQUMsV0FBTSxPQUFNLE9BQU0sUUFBUUMsS0FBSSxNQUFNLE9BQU8sT0FBTyxLQUFLLFFBQVEsUUFBUSxHQUFHO0FBQUEsT0FDN0U7QUFBQSxJQUNBLGdCQUFBRCxLQUFDLFlBQU8sV0FBVyxNQUFNLE9BQU8sU0FBUyxHQUFHLDBCQUFBQSxLQUFDLFdBQU0sVUFBUyw0QkFBMkIsR0FBRTtBQUFBLElBQ3pGLGdCQUFBQSxLQUFDLFlBQU8sV0FBVyxNQUFNLE9BQU8sV0FBVyxHQUN6QywwQkFBQUEsS0FBQyxXQUFNLFVBQVUsS0FBSyxRQUFRLGlCQUFpQixFQUFFLEdBQUcsT0FDbEQsTUFBTUcsT0FBTSxlQUFlLFVBQVUseUJBQXlCLHFCQUFxQixHQUFHLEdBQzFGO0FBQUEsSUFDQSxnQkFBQUgsS0FBQyxZQUFPLFdBQVcsTUFBTSxPQUFPLEtBQUssR0FBRywwQkFBQUEsS0FBQyxXQUFNLFVBQVMsMkJBQTBCLEdBQUU7QUFBQSxLQUN0RjtBQUNGO0FBRU8sU0FBUyxTQUFTO0FBQ3ZCLE1BQUksS0FBSyxFQUFHLFFBQU87QUFDbkIsUUFBTSxNQUFNLEdBQUc7QUFHZixRQUFNLE9BQU8sU0FBZ0MsSUFBSSxrQkFBa0IsS0FBSyxDQUFDLENBQUM7QUFDMUUsUUFBTSxVQUFVLE1BQU0sS0FBSyxJQUFJLElBQUksa0JBQWtCLEtBQUssQ0FBQyxDQUFDO0FBQzVELE1BQUksUUFBUSxZQUFZLE9BQU87QUFDL0IsTUFBSSxRQUFRLFlBQVksT0FBTztBQUMvQixTQUFPLGdCQUFBQTtBQUFBLElBQUM7QUFBQTtBQUFBLE1BQ04sTUFBSztBQUFBLE1BQVMsV0FBVTtBQUFBLE1BQWUsT0FBTTtBQUFBLE1BQWdCLFNBQVM7QUFBQSxNQUN0RSxRQUFRRSxPQUFNLGFBQWEsTUFBTUEsT0FBTSxhQUFhLFFBQVFBLE9BQU0sYUFBYTtBQUFBLE1BQy9FLFNBQVNBLE9BQU0sUUFBUTtBQUFBLE1BQ3ZCLE9BQU8sQ0FBQyxTQUFxQixLQUFLO0FBQUEsUUFBUTtBQUFBLFFBQ3hDLE1BQU0sV0FBVyxJQUFJLEtBQUssT0FBTztBQUFBLE1BQUM7QUFBQSxNQUNwQyxjQUFjLENBQUMsTUFBTUUsU0FBUUEsU0FBUUMsS0FBSSxjQUFjLEtBQUssS0FBSyxHQUFHLFFBQVE7QUFBQSxNQUM1RSwrQkFBQyxTQUFJLE9BQU0sVUFBUyxhQUFhSixLQUFJLFlBQVksVUFBVSxTQUFTLEdBQ2xFO0FBQUEsd0JBQUFELEtBQUMsYUFBVTtBQUFBLFFBQ1gscUJBQUMsU0FBSSxPQUFNLFNBQVEsU0FBUyxHQUMxQjtBQUFBLDBCQUFBQSxLQUFDLFdBQU0sU0FBTyxNQUFDLFFBQVFDLEtBQUksTUFBTSxPQUFPLE9BQU0saUJBQWdCO0FBQUEsVUFDOUQsZ0JBQUFELEtBQUMsV0FBTSxPQUFNLFVBQVMsT0FBTyxLQUFLLElBQUksRUFBRSxHQUFHLENBQUFELE9BQUssR0FBR0EsR0FBRSxVQUFVLEVBQUUsRUFBRSxHQUFHO0FBQUEsVUFDdEUsZ0JBQUFDLEtBQUMsWUFBTyxPQUFNLFVBQVMsV0FBVyxNQUNoQyxJQUFJLGtCQUFrQixFQUFFLFFBQVEsQ0FBQUQsT0FBS0EsR0FBRSxRQUFRLENBQUMsR0FDaEQsK0JBQUMsU0FBSSxTQUFTLEdBQUc7QUFBQSw0QkFBQUMsS0FBQyxXQUFNLFVBQVMsd0JBQXVCO0FBQUEsWUFBRSxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sU0FBUTtBQUFBLGFBQUUsR0FDbkY7QUFBQSxXQUNGO0FBQUEsUUFLQSxnQkFBQUEsS0FBQyxTQUFJLGFBQWFDLEtBQUksWUFBWSxVQUFVLFNBQVMsR0FBRyxTQUFPLE1BQzVELGVBQUssSUFBSSxFQUFFLEdBQUcsUUFBTyxNQUFNLEdBQUcsU0FDM0IsR0FBRyxJQUFJLENBQUFGLE9BQUssZ0JBQUFDLEtBQUMsUUFBSyxHQUFHRCxJQUFHLENBQUUsSUFDMUIsQ0FBQyxnQkFBQUMsS0FBQyxTQUFJLE9BQU0sZUFBYyxRQUFRQyxLQUFJLE1BQU0sUUFDMUMsMEJBQUFELEtBQUMsV0FBTSxPQUFNLHdCQUFrQixHQUNqQyxDQUFNLENBQUMsR0FDYjtBQUFBLFNBQ0Y7QUFBQTtBQUFBLEVBQ0Y7QUFDRjs7O0FDNUlBLE9BQU9NLFNBQVE7QUFFQSxTQUFSLElBQXFCLFNBQXNCO0FBQ2hELFFBQU0sVUFBVUMsSUFBRyxZQUFZLEdBQUcsbUJBQW1CO0FBQ3JELFFBQU0sVUFBVSxTQUFTLEtBQUs7QUFDOUIsTUFBSSxPQUEwQztBQUM5QyxNQUFJLENBQUMsUUFBUyxRQUFPO0FBRXJCLFVBQVEsUUFBUSxrQkFBa0IsTUFBTTtBQUN0QyxZQUFRLElBQUksSUFBSTtBQUNoQixVQUFNLE9BQU87QUFDYixXQUFPLFFBQVEsTUFBTSxNQUFNLFFBQVEsSUFBSSxLQUFLLENBQUM7QUFBQSxFQUMvQyxDQUFDO0FBRUQsU0FBTyxnQkFBQUM7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFNLFdBQVU7QUFBQSxNQUFZLFlBQVk7QUFBQSxNQUM3QyxRQUFRQyxPQUFNLGFBQWE7QUFBQSxNQUFRLGNBQWM7QUFBQSxNQUNqRCxjQUFZO0FBQUEsTUFBQyxTQUFTLEtBQUssT0FBTztBQUFBLE1BQ2xDLCtCQUFDLFNBQUksT0FBTSxPQUFNLFNBQVMsSUFBSSxjQUFjLEtBQzFDO0FBQUEsd0JBQUFELEtBQUMsV0FBTSxVQUFVLEtBQUssU0FBUyxhQUFhLEdBQUc7QUFBQSxRQUMvQyxnQkFBQUEsS0FBQyxjQUFTLFNBQU8sTUFBQyxPQUFPLEtBQUssU0FBUyxRQUFRLEdBQUc7QUFBQSxRQUNsRCxnQkFBQUEsS0FBQyxXQUFNLE9BQU0sTUFBSyxPQUFPLEtBQUssU0FBUyxRQUFRLEVBQUUsR0FBRyxPQUNsRCxHQUFHLEtBQUssTUFBTSxJQUFJLEdBQUcsQ0FBQyxHQUFHLEdBQUc7QUFBQSxTQUNoQztBQUFBO0FBQUEsRUFDRjtBQUNGOzs7QUNwQkEsSUFBTUUsV0FBVTtBQUFBLEVBQ2Q7QUFBQSxJQUFFLElBQUk7QUFBQSxJQUFRLE9BQU87QUFBQSxJQUFRLE1BQU07QUFBQSxJQUNqQyxTQUFTO0FBQUEsSUFBTyxLQUFLLE1BQU0sVUFBVSx1QkFBdUI7QUFBQSxFQUFFO0FBQUEsRUFDaEU7QUFBQSxJQUFFLElBQUk7QUFBQSxJQUFVLE9BQU87QUFBQSxJQUFXLE1BQU07QUFBQSxJQUN0QyxTQUFTO0FBQUEsSUFBTyxLQUFLLE1BQU0sVUFBVSx5Q0FBeUM7QUFBQSxFQUFFO0FBQUEsRUFDbEY7QUFBQSxJQUFFLElBQUk7QUFBQSxJQUFXLE9BQU87QUFBQSxJQUFXLE1BQU07QUFBQSxJQUN2QyxTQUFTO0FBQUEsSUFBTSxLQUFLLE1BQU0sVUFBVSxrQkFBa0I7QUFBQSxFQUFFO0FBQUEsRUFDMUQ7QUFBQSxJQUFFLElBQUk7QUFBQSxJQUFZLE9BQU87QUFBQSxJQUFhLE1BQU07QUFBQSxJQUMxQyxTQUFTO0FBQUEsSUFBTSxLQUFLO0FBQUEsSUFBTSxLQUFLLE1BQU0sVUFBVSxvQkFBb0I7QUFBQSxFQUFFO0FBQ3pFO0FBRWUsU0FBUixVQUEyQjtBQUNoQyxRQUFNLFFBQVEsU0FBd0IsSUFBSTtBQUMxQyxNQUFJLFNBQTRDO0FBRWhELFFBQU0sUUFBUSxDQUFDLEdBQTJCLFNBQXFCO0FBQzdELFFBQUksRUFBRSxXQUFXLE1BQU0sSUFBSSxNQUFNLEVBQUUsSUFBSTtBQUNyQyxZQUFNLElBQUksRUFBRSxFQUFFO0FBQ2QsY0FBUSxPQUFPO0FBQ2YsZUFBUyxRQUFRLEtBQU0sTUFBTSxNQUFNLElBQUksSUFBSSxDQUFDO0FBQzVDO0FBQUEsSUFDRjtBQUNBLFVBQU0sSUFBSSxJQUFJO0FBQUcsU0FBSztBQUFHLE1BQUUsSUFBSTtBQUFBLEVBQ2pDO0FBRUEsU0FBTyxnQkFBQUM7QUFBQSxJQUFDO0FBQUE7QUFBQSxNQUNOLE1BQUs7QUFBQSxNQUFVLFdBQVU7QUFBQSxNQUFnQixPQUFNO0FBQUEsTUFBaUIsU0FBUztBQUFBLE1BQ3pFLFFBQVFDLE9BQU0sYUFBYSxNQUFNQSxPQUFNLGFBQWEsU0FDNUNBLE9BQU0sYUFBYSxPQUFPQSxPQUFNLGFBQWE7QUFBQSxNQUNyRCxTQUFTQSxPQUFNLFFBQVE7QUFBQSxNQUFXLGFBQWFBLE9BQU0sWUFBWTtBQUFBLE1BQ2pFLGNBQWMsQ0FBQyxNQUFNQyxTQUFRO0FBQzNCLFlBQUlBLFNBQVFDLEtBQUksWUFBWTtBQUFFLGdCQUFNLElBQUksSUFBSTtBQUFHLGVBQUssS0FBSztBQUFHLGlCQUFPO0FBQUEsUUFBSztBQUN4RSxlQUFPO0FBQUEsTUFDVDtBQUFBLE1BRUEsMEJBQUFILEtBQUMsU0FBSSxPQUFNLFdBQVUsU0FBTyxNQUFDLFNBQU8sTUFDbEMsMEJBQUFBLEtBQUMsU0FBSSxRQUFRSSxLQUFJLE1BQU0sUUFBUSxRQUFRQSxLQUFJLE1BQU0sUUFBUSxTQUFTLElBQUksU0FBTyxNQUMxRSxVQUFBTCxTQUFRLElBQUksT0FDWCxnQkFBQUM7QUFBQSxRQUFDO0FBQUE7QUFBQSxVQUFPLE9BQU8sRUFBRSxNQUFNLGFBQWE7QUFBQSxVQUNsQyxXQUFXLFVBQVEsTUFBTSxHQUFHLE1BQU0sS0FBSyxTQUFTLEdBQUcsT0FBTyxDQUFDO0FBQUEsVUFDM0Q7QUFBQSxZQUFDO0FBQUE7QUFBQSxjQUFJLGFBQWFJLEtBQUksWUFBWTtBQUFBLGNBQVUsU0FBUztBQUFBLGNBQ25ELE9BQU8sS0FBSyxLQUFLLEVBQUUsR0FBRyxPQUFLLE1BQU0sRUFBRSxLQUFLLFlBQVksRUFBRTtBQUFBLGNBQ3REO0FBQUEsZ0NBQUFKO0FBQUEsa0JBQUM7QUFBQTtBQUFBLG9CQUFJLE9BQU07QUFBQSxvQkFBTSxTQUFTO0FBQUEsb0JBQU8sU0FBUztBQUFBLG9CQUN4QyxRQUFRSSxLQUFJLE1BQU07QUFBQSxvQkFBUSxRQUFRQSxLQUFJLE1BQU07QUFBQSxvQkFLNUMsMEJBQUFKO0FBQUEsc0JBQUM7QUFBQTtBQUFBLHdCQUFNLFVBQVUsRUFBRTtBQUFBLHdCQUFNLFdBQVc7QUFBQSx3QkFBSSxTQUFPO0FBQUEsd0JBQzdDLFFBQVFJLEtBQUksTUFBTTtBQUFBLHdCQUFRLFFBQVFBLEtBQUksTUFBTTtBQUFBO0FBQUEsb0JBQVE7QUFBQTtBQUFBLGdCQUN4RDtBQUFBLGdCQUNBLGdCQUFBSixLQUFDLFdBQU0sT0FBTyxLQUFLLEtBQUssRUFBRSxHQUFHLE9BQUssTUFBTSxFQUFFLEtBQUssZ0JBQWdCLEVBQUUsS0FBSyxHQUFHO0FBQUE7QUFBQTtBQUFBLFVBQzNFO0FBQUE7QUFBQSxNQUNGLENBQVMsR0FDYixHQUNGO0FBQUE7QUFBQSxFQUNGO0FBQ0Y7OztBdkI5QkEsT0FBTyxlQUFlO0FBNUJ0QixPQUFPLGVBQWdCSyxLQUFJLE9BQWUsV0FBVyxTQUFTO0FBQUEsRUFDNUQsY0FBYztBQUFBLEVBQ2QsSUFBSSxHQUFXO0FBQUUsU0FBSyxnQkFBZ0IsT0FBTyxDQUFDLEVBQUUsTUFBTSxLQUFLLEVBQUUsT0FBTyxPQUFPLENBQUM7QUFBQSxFQUFFO0FBQUEsRUFDOUUsTUFBTTtBQUFFLFdBQU8sS0FBSyxnQkFBZ0IsRUFBRSxLQUFLLEdBQUc7QUFBQSxFQUFFO0FBQ2xELENBQUM7QUFDQ0EsS0FBSSxPQUFPLFVBQWtCLFlBQVksU0FBVSxHQUFXO0FBQzlELE9BQUssZ0JBQWdCLE9BQU8sQ0FBQyxFQUFFLE1BQU0sS0FBSyxFQUFFLE9BQU8sT0FBTyxDQUFDO0FBQzdEO0FBZ0JBLFNBQVMsMkJBQTJCO0FBTXBDLElBQU0sV0FBVyxVQUFVLE9BQU8sYUFBYSxLQUMxQyxVQUFVLGdCQUFnQixDQUFDLFVBQVUsZ0JBQWdCLEdBQUcsT0FBTyxDQUFDO0FBRXJFLFlBQUksTUFBTTtBQUFBLEVBQ1IsY0FBYztBQUFBLEVBQ2QsT0FBTztBQUFBLEVBQ1AsT0FBTztBQUNMLElBQVEsS0FBSztBQUNiLElBQVVDLE1BQUs7QUFJZixRQUFJO0FBQ0YsWUFBTSxPQUFPLElBQUlELEtBQUksWUFBWTtBQUNqQyxXQUFLLGlCQUFpQixlQUFRLFNBQVMsTUFBTSxDQUFDO0FBQzlDLE1BQUFBLEtBQUksYUFBYTtBQUFBLFFBQ2ZFLEtBQUksUUFBUSxZQUFZO0FBQUEsUUFBSTtBQUFBLFFBQU07QUFBQTtBQUFBLE1BQXVCO0FBQUEsSUFDN0QsU0FBUyxHQUFHO0FBQUUsZUFBUywrQkFBK0IsQ0FBQyxFQUFFO0FBQUEsSUFBRTtBQUczRCxVQUFNLE9BQU8sQ0FBQyxNQUFjLElBQWUsU0FBa0I7QUFDM0QsVUFBSTtBQUNGLGNBQU0sSUFBSSxHQUFHO0FBQ2IsWUFBSSxLQUFLLE9BQU8sRUFBRSxZQUFZLFlBQVk7QUFDeEMsc0JBQUksYUFBYSxDQUFDO0FBQ2xCLGNBQUksS0FBTSxHQUFFLFFBQVE7QUFBQSxRQUN0QjtBQUFBLE1BQ0YsU0FBUyxHQUFHO0FBQUUsaUJBQVMsVUFBVSxJQUFJLFlBQVksQ0FBQztBQUFBLEVBQU0sR0FBVyxTQUFTLEVBQUUsRUFBRTtBQUFBLE1BQUU7QUFBQSxJQUNwRjtBQUNBLFVBQU0sV0FBVyxZQUFJLGFBQWE7QUFDbEMsVUFBTSxVQUFVLFNBQVMsU0FBUyxXQUFXLENBQUMsTUFBZ0I7QUFDOUQsZUFBVyxXQUFXLFNBQVM7QUFDN0IsV0FBSyxPQUFPLE1BQU0sSUFBSSxPQUFPLEdBQUcsSUFBSTtBQUNwQyxXQUFLLFFBQVEsTUFBTSxLQUFLLE9BQU8sR0FBRyxJQUFJO0FBQ3RDLFdBQUssVUFBVSxNQUFNLE9BQU8sT0FBTyxHQUFHLElBQUk7QUFDMUMsV0FBSyxPQUFPLE1BQU0sSUFBSSxPQUFPLEdBQUcsSUFBSTtBQUFBLElBQ3RDO0FBQ0EsU0FBSyxZQUFZLE1BQU0sU0FBUyxHQUFHLEtBQUs7QUFDeEMsU0FBSyxpQkFBaUIsTUFBTSxjQUFjLEdBQUcsS0FBSztBQUNsRCxTQUFLLFlBQVksTUFBTSxTQUFTLEdBQUcsS0FBSztBQUN4QyxTQUFLLFVBQVUsTUFBTSxPQUFPLEdBQUcsS0FBSztBQUNwQyxTQUFLLFdBQVcsTUFBTSxRQUFRLEdBQUcsS0FBSztBQUV0QyxZQUFRLENBQUMsU0FBUyxZQUFJLFdBQVcsSUFBSSxDQUFRO0FBQUEsRUFDL0M7QUFBQTtBQUFBLEVBRUEsZUFBZSxTQUFTLEtBQUs7QUFDM0IsVUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLFFBQVEsTUFBTSxHQUFHO0FBQ3BDLFFBQUksUUFBUSxVQUFVO0FBQUUsYUFBYyxHQUFHO0FBQUcsYUFBTyxJQUFJLElBQUk7QUFBQSxJQUFFO0FBQzdELFFBQUksUUFBUSxjQUFjO0FBQUUsa0JBQUksVUFBVSxlQUFRLFNBQVMsTUFBTSxHQUFHLElBQUk7QUFBRyxhQUFPLElBQUksSUFBSTtBQUFBLElBQUU7QUFDNUYsUUFBSSxTQUFTO0FBQUEsRUFDZjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbIkFzdGFsIiwgIkd0ayIsICJHZGsiLCAiQXN0YWwiLCAiYmluZCIsICJpbnRlcnZhbCIsICJ0aW1lb3V0IiwgIkFzdGFsIiwgIkFzdGFsIiwgImluaXQiLCAiQXN0YWwiLCAidiIsICJpbnRlcnZhbCIsICJrZXkiLCAiY3RvcnMiLCAia2V5IiwgIkd0ayIsICJBc3RhbCIsICJzbmFrZWlmeSIsICJwYXRjaCIsICJBcHBzIiwgIkJsdWV0b290aCIsICJNcHJpcyIsICJOb3RpZmQiLCAiV3AiLCAiQXBwIiwgIkd0ayIsICJBc3RhbCIsICJBc3RhbCIsICJHdGsiLCAiR3RrIiwgIkFzdGFsIiwgImNoIiwgIkd0ayIsICJHZGsiLCAiR2lvIiwgIkdMaWIiLCAiZGVmYXVsdCIsICJBc3RhbCIsICJHT2JqZWN0IiwgImRlZmF1bHQiLCAiR09iamVjdCIsICJHaW8iLCAiR0xpYiIsICJHaW8iLCAiR0xpYiIsICJpbml0IiwgIkdMaWIiLCAiR0xpYiIsICJ0eXBlIiwgIkdMaWIiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiYXN0YWxpZnkiLCAiQXN0YWwiLCAiR3RrIiwgIkdPYmplY3QiLCAiZmlsdGVyIiwgIkd0ayIsICJBc3RhbCIsICJCb3giLCAiYXN0YWxpZnkiLCAiR09iamVjdCIsICJCdXR0b24iLCAiQ2VudGVyQm94IiwgIkVudHJ5IiwgIkxhYmVsIiwgIkxldmVsQmFyIiwgIk1lbnVCdXR0b24iLCAiT3ZlcmxheSIsICJSZXZlYWxlciIsICJTbGlkZXIiLCAiU3RhY2siLCAiU3dpdGNoIiwgIldpbmRvdyIsICJqc3giLCAiQm94IiwgIkJ1dHRvbiIsICJDZW50ZXJCb3giLCAiRW50cnkiLCAiTGFiZWwiLCAiTGV2ZWxCYXIiLCAiTWVudUJ1dHRvbiIsICJPdmVybGF5IiwgIlJldmVhbGVyIiwgIlNsaWRlciIsICJTdGFjayIsICJTd2l0Y2giLCAiV2luZG93IiwgImRlZmF1bHQiLCAianN4IiwgIndpZmlJY29uIiwgIkd0ayIsICJuIiwgIkFzdGFsIiwgIkdpbyIsICJqc3giLCAiR3RrIiwgIm4iLCAiR2RrIiwgIkdpbyIsICJBc3RhbCIsICJBcHBzIiwgIk1wcmlzIiwgIkdMaWIiLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIlBJTk5FRCIsICJBcHBzIiwgImRlZmF1bHQiLCAibiIsICJqc3giLCAiQXN0YWwiLCAia2V5IiwgIkdkayIsICJHdGsiLCAiTXByaXMiLCAiTmV0d29yayIsICJXcCIsICJHaW8iLCAiQmF0dGVyeSIsICJHT2JqZWN0IiwgIkd0ayIsICJUaW55U2xpZGVyIiwgImRlZmF1bHQiLCAiU1RPUkUiLCAianN4IiwgIkd0ayIsICJXcCIsICJHaW8iLCAiQmF0dGVyeSIsICJOZXR3b3JrIiwgIkFzdGFsIiwgImtleSIsICJHZGsiLCAiTm90aWZkIiwgIk1wcmlzIiwgIk5vdGlmZCIsICJkZWZhdWx0IiwgIm4iLCAianN4IiwgIkd0ayIsICJBc3RhbCIsICJNcHJpcyIsICJrZXkiLCAiR2RrIiwgIldwIiwgIldwIiwgImpzeCIsICJBc3RhbCIsICJBQ1RJT05TIiwgImpzeCIsICJBc3RhbCIsICJrZXkiLCAiR2RrIiwgIkd0ayIsICJHdGsiLCAiaW5pdCIsICJHZGsiXQp9Cg==
