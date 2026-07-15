//! Keyboard and pointer driven session controls opened from the top bar.

use std::time::Duration;

use async_io::Timer;
use freya_components::button::{Button, ButtonLayoutThemePartial};
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{Command, SessionVerb};
use kobel_theme::{TOKENS, icons};
use kobel_wayland::KeyPress;
use torin::prelude::{Alignment, Size};

use super::{BarActionSink, BarContext, BarPanel, button_colours, popover_frame};

const ACTIONS: [SessionAction; 4] = [
    SessionAction::Lock,
    SessionAction::Logout,
    SessionAction::Restart,
    SessionAction::Shutdown,
];
const REVERT_MS: u64 = 4000;

pub fn session_popup_app() -> impl IntoElement {
    SessionPanel
}

#[derive(PartialEq)]
struct SessionPanel;

impl Component for SessionPanel {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let sink = use_consume::<BarActionSink>();
        let selected = use_state(|| 0_usize);
        let armed = use_state(|| None::<SessionAction>);
        let generation = use_state(|| 0_u64);
        let key_sequence = context.session_key.read().as_ref().map(|event| event.sequence);

        {
            let sink = sink.clone();
            use_side_effect_with_deps(&key_sequence, move |_| {
                let Some(event) = context.session_key.peek().clone() else {
                    return;
                };
                handle_key(&event.press, selected, armed, generation, &sink);
            });
        }

        let selected_now = *selected.read();
        let armed_now = *armed.read();
        let actions = ACTIONS.iter().copied().enumerate().map(|(index, action)| {
            session_action_button(
                index,
                action,
                selected_now == index,
                armed_now == Some(action),
                selected,
                armed,
                generation,
                sink.clone(),
            )
            .into_element()
        });

        popover_frame()
            .vertical()
            .spacing(TOKENS.popover.section_gap)
            .child(
                label()
                    .text("Session")
                    .font_size(TOKENS.typography.title_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            )
            .child(
                rect()
                    .width(Size::fill())
                    .horizontal()
                    .cross_align(Alignment::Start)
                    .main_align(Alignment::Center)
                    .spacing(TOKENS.session.tile_gap)
                    .children(actions),
            )
    }
}

#[allow(clippy::too_many_arguments)]
fn session_action_button(
    index: usize,
    action: SessionAction,
    selected: bool,
    armed: bool,
    selection: State<usize>,
    armed_action: State<Option<SessionAction>>,
    generation: State<u64>,
    sink: BarActionSink,
) -> impl IntoElement {
    let mut hover_selection = selection;
    let mut click_selection = selection;
    let label_text = if armed { "Press again" } else { action.label() };
    let background = if armed || selected {
        TOKENS.colours.surface_active.rgba().into()
    } else {
        TOKENS.colours.surface_elevated.rgba().into()
    };
    let glyph_colour = if action.destructive() || armed {
        TOKENS.colours.danger.rgba()
    } else {
        TOKENS.colours.text.rgba()
    };

    rect()
        .width(Size::px(TOKENS.session.tile_width))
        .cross_align(Alignment::Center)
        .spacing(TOKENS.session.tile_gap)
        .on_pointer_enter(move |_| hover_selection.set(index))
        .child(
            Button::new()
                .flat()
                .theme_colors(button_colours(background, TOKENS.colours.surface_hover.rgba().into()))
                .theme_layout(
                    ButtonLayoutThemePartial::new()
                        .margin(0.0)
                        .corner_radius(TOKENS.session.tile_radius)
                        .width(Size::px(TOKENS.session.tile_size))
                        .height(Size::px(TOKENS.session.tile_size))
                        .padding(0.0),
                )
                .on_press(move |_| {
                    click_selection.set(index);
                    press_action(action, armed_action, generation, &sink);
                })
                .child(
                    SvgViewer::new(action.icon())
                        .color(glyph_colour)
                        .width(Size::px(TOKENS.session.glyph_size))
                        .height(Size::px(TOKENS.session.glyph_size)),
                ),
        )
        .child(
            label()
                .text(label_text)
                .a11y_alt(action.accessibility_label(armed))
                .font_size(TOKENS.typography.small_size)
                .font_weight(TOKENS.typography.semibold_weight)
                .color(if armed {
                    TOKENS.colours.danger.rgba()
                } else {
                    TOKENS.colours.text.rgba()
                }),
        )
}

fn handle_key(
    press: &KeyPress,
    mut selected: State<usize>,
    armed: State<Option<SessionAction>>,
    generation: State<u64>,
    sink: &BarActionSink,
) {
    if press.is_escape() {
        if press.repeat {
            return;
        }
        if armed.peek().is_some() {
            disarm(armed, generation);
        } else {
            sink.close(BarPanel::Session);
        }
        return;
    }

    match &press.key {
        Key::Named(NamedKey::ArrowRight) | Key::Named(NamedKey::ArrowDown) => {
            let current = *selected.peek();
            selected.set(step_selection(current, true, ACTIONS.len()));
        }
        Key::Named(NamedKey::ArrowLeft) | Key::Named(NamedKey::ArrowUp) => {
            let current = *selected.peek();
            selected.set(step_selection(current, false, ACTIONS.len()));
        }
        Key::Named(NamedKey::Enter) if !press.repeat => {
            press_action(ACTIONS[*selected.peek()], armed, generation, sink);
        }
        _ => {}
    }
}

fn step_selection(current: usize, forward: bool, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    if forward {
        (current + 1) % len
    } else {
        (current + len - 1) % len
    }
}

fn press_action(
    action: SessionAction,
    mut armed: State<Option<SessionAction>>,
    mut generation: State<u64>,
    sink: &BarActionSink,
) {
    let outcome = decide_press(*armed.peek(), action);
    match outcome {
        PressOutcome::Arm(target) => {
            eprintln!("[bar] session armed {target:?}");
            armed.set(Some(target));
            let next_generation = generation.peek().wrapping_add(1);
            generation.set(next_generation);
            spawn(async move {
                Timer::after(Duration::from_millis(REVERT_MS)).await;
                if *generation.peek() == next_generation {
                    armed.set(None);
                }
            });
        }
        PressOutcome::Fire(verb) => {
            let next_generation = generation.peek().wrapping_add(1);
            generation.set(next_generation);
            armed.set(None);
            sink.service(Command::Session(verb));
            sink.close(BarPanel::Session);
        }
    }
}

fn disarm(mut armed: State<Option<SessionAction>>, mut generation: State<u64>) {
    if let Some(action) = *armed.peek() {
        eprintln!("[bar] session disarmed {action:?}");
    }
    let next_generation = generation.peek().wrapping_add(1);
    generation.set(next_generation);
    armed.set(None);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PressOutcome {
    Arm(SessionAction),
    Fire(SessionVerb),
}

fn decide_press(armed: Option<SessionAction>, action: SessionAction) -> PressOutcome {
    if action.confirms() && armed != Some(action) {
        PressOutcome::Arm(action)
    } else {
        PressOutcome::Fire(action.verb())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionAction {
    Lock,
    Logout,
    Restart,
    Shutdown,
}

impl SessionAction {
    fn label(self) -> &'static str {
        match self {
            Self::Lock => "Lock",
            Self::Logout => "Log out",
            Self::Restart => "Restart",
            Self::Shutdown => "Shut down",
        }
    }

    fn accessibility_label(self, armed: bool) -> String {
        if armed {
            format!("Press again to confirm {}", self.label().to_lowercase())
        } else {
            self.label().to_string()
        }
    }

    fn icon(self) -> &'static [u8] {
        match self {
            Self::Lock => icons::LOCK,
            Self::Logout => icons::SIGN_OUT,
            Self::Restart => icons::ARROW_CLOCKWISE,
            Self::Shutdown => icons::POWER,
        }
    }

    fn verb(self) -> SessionVerb {
        match self {
            Self::Lock => SessionVerb::Lock,
            Self::Logout => SessionVerb::Logout,
            Self::Restart => SessionVerb::Restart,
            Self::Shutdown => SessionVerb::Shutdown,
        }
    }

    fn confirms(self) -> bool {
        matches!(self, Self::Restart | Self::Shutdown)
    }

    fn destructive(self) -> bool {
        matches!(self, Self::Shutdown)
    }
}

#[cfg(test)]
mod tests {
    use kobel_services::SessionVerb;

    use super::{PressOutcome, SessionAction, decide_press, step_selection};

    #[test]
    fn selection_wraps_in_both_directions() {
        assert_eq!(step_selection(3, true, 4), 0);
        assert_eq!(step_selection(0, false, 4), 3);
    }

    #[test]
    fn only_restart_and_shutdown_require_confirmation() {
        assert!(!SessionAction::Lock.confirms());
        assert!(!SessionAction::Logout.confirms());
        assert!(SessionAction::Restart.confirms());
        assert!(SessionAction::Shutdown.confirms());
    }

    #[test]
    fn restart_and_shutdown_fire_only_after_matching_confirmation() {
        assert_eq!(
            decide_press(None, SessionAction::Restart),
            PressOutcome::Arm(SessionAction::Restart),
        );
        assert_eq!(
            decide_press(Some(SessionAction::Restart), SessionAction::Restart),
            PressOutcome::Fire(SessionVerb::Restart),
        );
        assert_eq!(
            decide_press(Some(SessionAction::Restart), SessionAction::Shutdown),
            PressOutcome::Arm(SessionAction::Shutdown),
        );
        assert_eq!(
            decide_press(Some(SessionAction::Shutdown), SessionAction::Lock),
            PressOutcome::Fire(SessionVerb::Lock),
        );
    }
}
