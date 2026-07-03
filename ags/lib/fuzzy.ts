// Launcher matching — straight port of the prototype (post-critique version):
// subsequence fuzzy with word-boundary bonus, capped log2 frecency, prefix ghost.

import GLib from "gi://GLib"

export interface Match { score: number; marks: number[] }

export function fuzzy(q: string, t: string): Match | null {
  const ql = q.toLowerCase(), tl = t.toLowerCase()
  let qi = 0, score = 0, last = -2
  const marks: number[] = []
  for (let i = 0; i < tl.length && qi < ql.length; i++) {
    if (tl[i] === ql[qi]) {
      marks.push(i)
      score += (i === 0 || " -_./".includes(t[i - 1])) ? 4 : (last === i - 1 ? 2 : 1)
      last = i; qi++
    }
  }
  return qi === ql.length ? { score: score - t.length * 0.02, marks } : null
}

// Pango markup highlight (escapes; leaf accent on matched chars)
export function hl(t: string, marks: number[] | null): string {
  const esc = (c: string) => GLib.markup_escape_text(c, -1)
  if (!marks) return esc(t)
  const m = new Set(marks)
  let out = ""
  for (let i = 0; i < t.length; i++)
    out += m.has(i) ? `<span foreground="#b5cb48">${esc(t[i])}</span>` : esc(t[i])
  return out
}

// Frecency: capped so an exact prefix match ALWAYS beats habit (critique A2).
const STORE = `${GLib.get_user_state_dir()}/kobel/freq.json`
let freq: Record<string, number> = {}
try { freq = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(STORE)[1])) } catch { }

export const boost = (id: string) => Math.min(Math.log2(1 + (freq[id] ?? 0)), 3)

export function bump(id: string) {
  freq[id] = (freq[id] ?? 0) + 1
  GLib.mkdir_with_parents(GLib.path_get_dirname(STORE), 0o755)
  GLib.file_set_contents(STORE, JSON.stringify(freq))
}

export const frequency = (id: string) => freq[id] ?? 0
