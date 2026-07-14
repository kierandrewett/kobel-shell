// input.rs -- decode sctk pointer/keyboard events into freya_core::PlatformEvent.
//
// Everything here is pure (no Wayland object handles, no I/O) so the conversions
// are unit-testable. conn.rs owns the sctk handlers and calls into these helpers
// with cursor coordinates already converted to surface-local *physical* pixels
// (logical position * the surface scale_factor -- integer buffer scale, or the
// wp_fractional_scale_v1 fraction), matching the space measure_layout and
// RenderPipeline render into. See docs/FREYA-PLAN.md section 3.

use freya_core::integration::{MouseEventName, PlatformEvent, WheelEventName};
use freya_core::events::data::{MouseButton, WheelSource};
use keyboard_types::{Code, Key, Modifiers, NamedKey};
use smithay_client_toolkit::seat::keyboard::{Keysym, Modifiers as SctkModifiers};
use torin::prelude::CursorPoint;

// Linux evdev button codes (linux/input-event-codes.h).
const BTN_LEFT: u32 = 0x110;
const BTN_RIGHT: u32 = 0x111;
const BTN_MIDDLE: u32 = 0x112;
const BTN_SIDE: u32 = 0x113;
const BTN_EXTRA: u32 = 0x114;

/// Map a Wayland pointer button code to a freya [`MouseButton`].
pub fn map_button(code: u32) -> MouseButton {
    match code {
        BTN_LEFT => MouseButton::Left,
        BTN_RIGHT => MouseButton::Right,
        BTN_MIDDLE => MouseButton::Middle,
        BTN_SIDE => MouseButton::Back,
        BTN_EXTRA => MouseButton::Forward,
        other => MouseButton::Other((other & 0xffff) as u16),
    }
}

/// Build a pointer move event.
pub fn mouse_move(cursor: CursorPoint) -> PlatformEvent {
    PlatformEvent::Mouse { name: MouseEventName::MouseMove, cursor, button: None }
}

/// A synthetic move to a point no real content occupies, for when the
/// compositor reports the pointer LEAVING the surface entirely.
/// `freya_core::PlatformEvent` has no dedicated "pointer left" variant --
/// `on_pointer_enter`/`on_pointer_leave` are synthesized purely by diffing
/// which element consecutive `MouseMove` events hit-test against, so the only
/// way to make that diff resolve to "nothing is hovered" is a move whose
/// target genuinely has no content (a negative coordinate, since real content
/// only ever occupies non-negative surface-local space).
///
/// Without this, a pointer that leaves a surface WITHOUT first crossing onto
/// a different element inside it (e.g. straight off the dock's bottom edge
/// onto the desktop, rather than sliding across to a sibling tile) leaves
/// whatever it was last hovering PERMANENTLY stuck in its hovered visual
/// state -- confirmed live: a dock tile's hover highlight/tooltip that never
/// clears after the cursor moves off the dock. Real hardware, not a
/// synthetic-input artifact: `PointerEventKind::Leave` was previously a
/// documented no-op ("hover state clears on the next enter"), which is only
/// true if the next enter lands on the SAME surface -- it is not, once the
/// pointer has actually left.
pub fn mouse_leave() -> PlatformEvent {
    mouse_move(CursorPoint::new(-1.0, -1.0))
}

/// Build a pointer press/release event. `pressed` selects down vs up.
pub fn mouse_button(cursor: CursorPoint, button: u32, pressed: bool) -> PlatformEvent {
    PlatformEvent::Mouse {
        name: if pressed { MouseEventName::MouseDown } else { MouseEventName::MouseUp },
        cursor,
        button: Some(map_button(button)),
    }
}

/// Approximate pixels advanced per high-resolution/discrete wheel notch.
pub const WHEEL_LINE_PX: f64 = 20.0;

/// Resolve one axis of a Wayland axis event to a pixel delta. Prefers the
/// continuous `absolute` value (touchpads, hi-res wheels); falls back to
/// `value120` notches, then legacy `discrete` steps.
pub fn axis_pixels(absolute: f64, value120: i32, discrete: i32) -> f64 {
    if absolute != 0.0 {
        absolute
    } else if value120 != 0 {
        (value120 as f64 / 120.0) * WHEEL_LINE_PX
    } else {
        discrete as f64 * WHEEL_LINE_PX
    }
}

/// Build a wheel event. `scroll` deltas are in physical pixels; positive `y`
/// follows the Wayland convention (fingers/wheel moving content upward).
pub fn wheel(cursor: CursorPoint, scroll_x: f64, scroll_y: f64) -> PlatformEvent {
    PlatformEvent::Wheel {
        name: WheelEventName::Wheel,
        scroll: CursorPoint::new(scroll_x, scroll_y),
        cursor,
        source: WheelSource::Device,
    }
}

/// Map an xkb keysym to a freya [`Key`], preferring named keys and otherwise the
/// composed UTF-8 text the compositor already resolved (locale/modifier aware).
pub fn map_key(keysym: Keysym, utf8: Option<&str>) -> Key {
    if let Some(named) = named_key(keysym) {
        return Key::Named(named);
    }
    if let Some(text) = utf8 {
        if !text.is_empty() && !text.chars().all(char::is_control) {
            return Key::Character(text.to_owned());
        }
    }
    Key::Named(NamedKey::Unidentified)
}

/// Named-key subset. Returns `None` for keys that should be treated as text.
pub fn named_key(k: Keysym) -> Option<NamedKey> {
    Some(if k == Keysym::Escape {
        NamedKey::Escape
    } else if k == Keysym::Return || k == Keysym::KP_Enter {
        NamedKey::Enter
    } else if k == Keysym::Tab || k == Keysym::ISO_Left_Tab {
        NamedKey::Tab
    } else if k == Keysym::BackSpace {
        NamedKey::Backspace
    } else if k == Keysym::Delete {
        NamedKey::Delete
    } else if k == Keysym::Left {
        NamedKey::ArrowLeft
    } else if k == Keysym::Right {
        NamedKey::ArrowRight
    } else if k == Keysym::Up {
        NamedKey::ArrowUp
    } else if k == Keysym::Down {
        NamedKey::ArrowDown
    } else if k == Keysym::Home {
        NamedKey::Home
    } else if k == Keysym::End {
        NamedKey::End
    } else if k == Keysym::Page_Up {
        NamedKey::PageUp
    } else if k == Keysym::Page_Down {
        NamedKey::PageDown
    } else if k == Keysym::Insert {
        NamedKey::Insert
    } else if k == Keysym::Shift_L || k == Keysym::Shift_R {
        NamedKey::Shift
    } else if k == Keysym::Control_L || k == Keysym::Control_R {
        NamedKey::Control
    } else if k == Keysym::Alt_L || k == Keysym::Alt_R {
        NamedKey::Alt
    } else if k == Keysym::Super_L || k == Keysym::Super_R {
        NamedKey::Meta
    } else if k == Keysym::Caps_Lock {
        NamedKey::CapsLock
    } else if k == Keysym::F1 {
        NamedKey::F1
    } else if k == Keysym::F2 {
        NamedKey::F2
    } else if k == Keysym::F3 {
        NamedKey::F3
    } else if k == Keysym::F4 {
        NamedKey::F4
    } else if k == Keysym::F5 {
        NamedKey::F5
    } else if k == Keysym::F6 {
        NamedKey::F6
    } else if k == Keysym::F7 {
        NamedKey::F7
    } else if k == Keysym::F8 {
        NamedKey::F8
    } else if k == Keysym::F9 {
        NamedKey::F9
    } else if k == Keysym::F10 {
        NamedKey::F10
    } else if k == Keysym::F11 {
        NamedKey::F11
    } else if k == Keysym::F12 {
        NamedKey::F12
    } else {
        return None;
    })
}

/// Map sctk modifier state to keyboard_types [`Modifiers`].
pub fn map_modifiers(m: SctkModifiers) -> Modifiers {
    let mut out = Modifiers::empty();
    if m.ctrl {
        out |= Modifiers::CONTROL;
    }
    if m.alt {
        out |= Modifiers::ALT;
    }
    if m.shift {
        out |= Modifiers::SHIFT;
    }
    if m.logo {
        out |= Modifiers::META;
    }
    if m.caps_lock {
        out |= Modifiers::CAPS_LOCK;
    }
    if m.num_lock {
        out |= Modifiers::NUM_LOCK;
    }
    out
}

/// Best-effort physical [`Code`] from an evdev scancode (`KeyEvent::raw_code`),
/// which is layout independent. Unmapped keys fall back to `Code::Unidentified`.
pub fn map_code(raw_code: u32) -> Code {
    match raw_code {
        1 => Code::Escape,
        2 => Code::Digit1,
        3 => Code::Digit2,
        4 => Code::Digit3,
        5 => Code::Digit4,
        6 => Code::Digit5,
        7 => Code::Digit6,
        8 => Code::Digit7,
        9 => Code::Digit8,
        10 => Code::Digit9,
        11 => Code::Digit0,
        12 => Code::Minus,
        13 => Code::Equal,
        14 => Code::Backspace,
        15 => Code::Tab,
        16 => Code::KeyQ,
        17 => Code::KeyW,
        18 => Code::KeyE,
        19 => Code::KeyR,
        20 => Code::KeyT,
        21 => Code::KeyY,
        22 => Code::KeyU,
        23 => Code::KeyI,
        24 => Code::KeyO,
        25 => Code::KeyP,
        26 => Code::BracketLeft,
        27 => Code::BracketRight,
        28 => Code::Enter,
        29 => Code::ControlLeft,
        30 => Code::KeyA,
        31 => Code::KeyS,
        32 => Code::KeyD,
        33 => Code::KeyF,
        34 => Code::KeyG,
        35 => Code::KeyH,
        36 => Code::KeyJ,
        37 => Code::KeyK,
        38 => Code::KeyL,
        39 => Code::Semicolon,
        40 => Code::Quote,
        41 => Code::Backquote,
        42 => Code::ShiftLeft,
        43 => Code::Backslash,
        44 => Code::KeyZ,
        45 => Code::KeyX,
        46 => Code::KeyC,
        47 => Code::KeyV,
        48 => Code::KeyB,
        49 => Code::KeyN,
        50 => Code::KeyM,
        51 => Code::Comma,
        52 => Code::Period,
        53 => Code::Slash,
        54 => Code::ShiftRight,
        55 => Code::NumpadMultiply,
        56 => Code::AltLeft,
        57 => Code::Space,
        58 => Code::CapsLock,
        59 => Code::F1,
        60 => Code::F2,
        61 => Code::F3,
        62 => Code::F4,
        63 => Code::F5,
        64 => Code::F6,
        65 => Code::F7,
        66 => Code::F8,
        67 => Code::F9,
        68 => Code::F10,
        87 => Code::F11,
        88 => Code::F12,
        97 => Code::ControlRight,
        100 => Code::AltRight,
        102 => Code::Home,
        103 => Code::ArrowUp,
        104 => Code::PageUp,
        105 => Code::ArrowLeft,
        106 => Code::ArrowRight,
        107 => Code::End,
        108 => Code::ArrowDown,
        109 => Code::PageDown,
        110 => Code::Insert,
        111 => Code::Delete,
        125 => Code::MetaLeft,
        126 => Code::MetaRight,
        _ => Code::Unidentified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_map_to_named_variants() {
        assert_eq!(map_button(BTN_LEFT), MouseButton::Left);
        assert_eq!(map_button(BTN_RIGHT), MouseButton::Right);
        assert_eq!(map_button(BTN_MIDDLE), MouseButton::Middle);
        assert_eq!(map_button(0x999), MouseButton::Other(0x999));
    }

    #[test]
    fn named_keys_take_priority_over_text() {
        // Enter reports "\r" as utf8 but must decode as the named key.
        assert_eq!(map_key(Keysym::Return, Some("\r")), Key::Named(NamedKey::Enter));
        assert_eq!(map_key(Keysym::Escape, Some("\u{1b}")), Key::Named(NamedKey::Escape));
    }

    #[test]
    fn printable_text_becomes_character() {
        assert_eq!(map_key(Keysym::k, Some("k")), Key::Character("k".to_owned()));
        // Uppercase / composed text is passed through verbatim.
        assert_eq!(map_key(Keysym::K, Some("K")), Key::Character("K".to_owned()));
    }

    #[test]
    fn control_only_text_is_unidentified() {
        // A control char with no named mapping should not become a Character.
        assert_eq!(map_key(Keysym::NoSymbol, Some("\u{0}")), Key::Named(NamedKey::Unidentified));
        assert_eq!(map_key(Keysym::NoSymbol, None), Key::Named(NamedKey::Unidentified));
    }

    #[test]
    fn modifiers_translate_bitwise() {
        let mut m = SctkModifiers::default();
        m.ctrl = true;
        m.shift = true;
        let out = map_modifiers(m);
        assert!(out.contains(Modifiers::CONTROL));
        assert!(out.contains(Modifiers::SHIFT));
        assert!(!out.contains(Modifiers::ALT));
    }

    #[test]
    fn code_maps_physical_scancodes() {
        assert_eq!(map_code(1), Code::Escape);
        assert_eq!(map_code(37), Code::KeyK);
        assert_eq!(map_code(28), Code::Enter);
        assert_eq!(map_code(9999), Code::Unidentified);
    }

    #[test]
    fn axis_prefers_continuous_then_notches() {
        assert_eq!(axis_pixels(12.5, 0, 0), 12.5);
        assert_eq!(axis_pixels(0.0, 120, 0), WHEEL_LINE_PX);
        assert_eq!(axis_pixels(0.0, 0, 2), 2.0 * WHEEL_LINE_PX);
        assert_eq!(axis_pixels(0.0, 0, 0), 0.0);
    }

    #[test]
    fn mouse_leave_targets_a_point_no_real_content_occupies() {
        // Real surface-local content only ever occupies non-negative space, so
        // this must land outside it on both axes for the hit-test diff to
        // resolve to "nothing hovered" (see mouse_leave's doc for why this
        // needs to exist at all).
        match mouse_leave() {
            PlatformEvent::Mouse { name, cursor, button } => {
                assert_eq!(name, MouseEventName::MouseMove);
                assert!(cursor.x < 0.0);
                assert!(cursor.y < 0.0);
                assert_eq!(button, None);
            }
            other => panic!("expected a Mouse platform event, got {other:?}"),
        }
    }
}
