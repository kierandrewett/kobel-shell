// Demo-data mode (KOBEL_DEMO=1): make every surface render the EXACT mock values from
// docs/prototype.html, so an AGS render can be pixel-overlaid on the prototype render
// for a fair 1:1 comparison. This is NOT cheating — real GTK widgets, real rendering;
// only the *content* is pinned to the prototype's so the chrome can be diffed directly.
import GLib from "gi://GLib"

export const DEMO = !!GLib.getenv("KOBEL_DEMO")

// Values transcribed from prototype.html's mock state (the reference screenshots).
export const D = {
  // bar
  clock: "14:23",
  date: "Sat 4 Jul",
  title: "Terminal — window 1/2",
  batteryPct: "100%",
  // quick settings
  meta: "100% · Fully charged",
  wifiSsid: "chompers-5G",
  btDevice: "WH-1000XM5",
  volume: 0.675,     // trough 51..285 width=234; knob=(209-51)/234=0.675 → x≈209 matches proto
  brightness: 0.794, // trough 51..299 width=248; knob=(248-51)/248=0.794 → x≈248 matches proto
  dark: true, save: false, silent: false, night: false,
  // calendar — pinned "today" so the grid + hero match the prototype exactly
  today: { y: 2026, m: 6 /* July, 0-indexed */, d: 4 },  // Saturday 4 July 2026
  // launcher pinned tiles + today widget
  apps: ["Terminal", "Files", "Firefox", "Zed", "Spotify", "Settings"],
  widgetDate: "Saturday 4 July",
  widgetEvent: "09:45 · Daily Standup",
  media: { title: "Weightless", artist: "Marconi Union" },
}
