// GTK widget-tree geometry dumper — the mirror of the DOM's getBoundingClientRect().
// Walks a mapped window and records every widget's real allocation (x/y/w/h relative
// to the window content) + CSS classes + text, so a rendered GTK surface can be diffed
// 1:1 against the prototype DOM. Gated by KOBEL_DUMP=<window> in app.ts.
import Gtk from "gi://Gtk?version=4.0"
import Graphene from "gi://Graphene"
import GLib from "gi://GLib"

export interface Node {
  d: number; type: string; cls: string
  x: number; y: number; w: number; h: number; t: string
}

export function dumpWindow(win: Gtk.Window): Node[] {
  const out: Node[] = []
  const root: any = win
  const walk = (w: any, depth: number) => {
    // compute_bounds gives the widget's FULL rendered rect (incl. its own padding) in
    // the root's coords — more reliable than compute_point + get_width (which can report
    // the child/content size for padded buttons).
    let x = 0, y = 0, width = 0, height = 0
    try {
      const res = w.compute_bounds(root)
      const rect = Array.isArray(res) ? res[1] : res
      if (rect) {
        x = rect.origin.x; y = rect.origin.y
        width = rect.size.width; height = rect.size.height
      }
    } catch { }
    if (!width) { width = w.get_width?.() ?? 0; height = w.get_height?.() ?? 0 }
    const cls = (w.get_css_classes?.() ?? []).join(".")
    const type = (w.constructor?.name ?? "?").replace(/_/g, "")
    let t = ""
    try { t = (w.get_label?.() ?? w.get_text?.() ?? "").toString().slice(0, 28) } catch { }
    out.push({
      d: depth, type, cls,
      x: Math.round(x), y: Math.round(y),
      w: Math.round(width), h: Math.round(height), t,
    })
    let c = w.get_first_child?.()
    while (c) { walk(c, depth + 1); c = c.get_next_sibling() }
  }
  const child = win.get_child?.()
  if (child) walk(child, 0)
  return out
}

// Poll until the named window is visible + laid out, then dump once to KOBEL_DUMP_OUT.
export function armDump(getWindow: (name: string) => Gtk.Window | null) {
  const name = GLib.getenv("KOBEL_DUMP")
  if (!name) return
  const path = GLib.getenv("KOBEL_DUMP_OUT") || "/tmp/kobel-dump.json"
  let done = false
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
    if (done) return GLib.SOURCE_REMOVE
    const w = getWindow(name)
    if (w && w.get_mapped?.() && (w.get_width?.() ?? 0) > 0) {
      // one more tick so final allocation settles
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        try {
          const tree = dumpWindow(w)
          GLib.file_set_contents(path, JSON.stringify(tree))
          printerr(`kobel: dumped ${tree.length} widgets of "${name}" → ${path}`)
        } catch (e) { printerr(`kobel: dump failed: ${e}`) }
        return GLib.SOURCE_REMOVE
      })
      done = true
      return GLib.SOURCE_REMOVE
    }
    return GLib.SOURCE_CONTINUE
  })
}
