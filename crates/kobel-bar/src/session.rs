//! Keyboard and pointer driven session controls opened from the top bar.

use std::time::Duration;

use async_io::Timer;
use freya_components::button::{Button, ButtonLayoutThemePartial};
use freya_components::scrollviews::ScrollView;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{Command, SessionVerb};
use kobel_theme::{TOKENS, icons};
use kobel_wayland::KeyPress;
use torin::prelude::{Alignment, Size};

use super::{BarActionSink, BarContext, BarPanel, PopoverLayout, button_colours, popover_frame, use_popover_layout};

const ACTIONS: [SessionAction; 4] = [
    SessionAction::Lock,
    SessionAction::Logout,
    SessionAction::Restart,
    SessionAction::Shutdown,
];
const REVERT_MS: u64 = 4000;

fn session_columns(layout: PopoverLayout) -> usize {
    let inner_width = (layout.width as f32 - TOKENS.popover.padding * 2.0).max(0.0);
    let four_columns = TOKENS.session.tile_width * 4.0 + TOKENS.session.tile_gap * 3.0;
    let two_columns = TOKENS.session.tile_width * 2.0 + TOKENS.session.tile_gap;

    if inner_width >= four_columns {
        4
    } else if inner_width >= two_columns {
        2
    } else {
        1
    }
}

pub fn session_popup_app() -> impl IntoElement {
    SessionPanel
}

#[derive(PartialEq)]
struct SessionPanel;

impl Component for SessionPanel {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let sink = use_consume::<BarActionSink>();
        let layout = use_popover_layout();
        let selected = use_state(|| 0_usize);
        let armed = use_state(|| None::<SessionAction>);
        let generation = use_state(|| 0_u64);
        let key_sequence = context.session_key.read().as_ref().map(|event| event.sequence);
        let columns = session_columns(layout);

        {
            let sink = sink.clone();
            use_side_effect_with_deps(&key_sequence, move |_| {
                let Some(event) = context.session_key.peek().clone() else {
                    return;
                };
                handle_key(&event.press, selected, armed, generation, columns, &sink);
            });
        }

        let selected_now = *selected.read();
        let armed_now = *armed.read();
        let mut action_grid = rect()
            .width(Size::fill())
            .vertical()
            .cross_align(Alignment::Center)
            .spacing(TOKENS.session.tile_gap);
        for row_start in (0..ACTIONS.len()).step_by(columns) {
            let mut row = rect()
                .width(Size::fill())
                .horizontal()
                .cross_align(Alignment::Start)
                .main_align(Alignment::Center)
                .spacing(TOKENS.session.tile_gap);
            for (index, action) in ACTIONS.iter().copied().enumerate().skip(row_start).take(columns) {
                row = row.child(session_action_button(
                    index,
                    action,
                    selected_now == index,
                    armed_now == Some(action),
                    selected,
                    armed,
                    generation,
                    sink.clone(),
                ));
            }
            action_grid = action_grid.child(row);
        }

        let content = rect()
            .width(Size::fill())
            .vertical()
            .spacing(TOKENS.popover.section_gap)
            .child(
                label()
                    .text("Session")
                    .font_size(TOKENS.typography.title_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            )
            .child(action_grid);

        popover_frame().child(
            ScrollView::new()
                .height(Size::auto())
                .max_height(Size::px(layout.inner_max_height()))
                .show_scrollbar(true)
                .scroll_with_arrows(true)
                .child(content),
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Navigation {
    Left,
    Right,
    Up,
    Down,
}

fn handle_key(
    press: &KeyPress,
    mut selected: State<usize>,
    armed: State<Option<SessionAction>>,
    generation: State<u64>,
    columns: usize,
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

    let direction = match &press.key {
        Key::Named(NamedKey::ArrowRight) => Some(Navigation::Right),
        Key::Named(NamedKey::ArrowDown) => Some(Navigation::Down),
        Key::Named(NamedKey::ArrowLeft) => Some(Navigation::Left),
        Key::Named(NamedKey::ArrowUp) => Some(Navigation::Up),
        _ => None,
    };
    if let Some(direction) = direction {
        let current = *selected.peek();
        selected.set(move_selection(current, direction, columns, ACTIONS.len()));
        return;
    }

    match &press.key {
        Key::Named(NamedKey::Enter) if !press.repeat => {
            press_action(ACTIONS[*selected.peek()], armed, generation, sink);
        }
        _ => {}
    }
}

fn move_selection(current: usize, direction: Navigation, columns: usize, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let current = current.min(len - 1);
    let columns = columns.clamp(1, len);
    let row_start = current / columns * columns;
    let row_len = (len - row_start).min(columns);
    let column = current - row_start;

    match direction {
        Navigation::Left => row_start + (column + row_len - 1) % row_len,
        Navigation::Right => row_start + (column + 1) % row_len,
        Navigation::Up => {
            if current >= columns {
                current - columns
            } else {
                let last_row_start = (len - 1) / columns * columns;
                (last_row_start + column).min(len - 1)
            }
        }
        Navigation::Down => {
            if current + columns < len {
                current + columns
            } else {
                column.min(len - 1)
            }
        }
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

    use super::{
        Navigation, PopoverLayout, PressOutcome, SessionAction, decide_press, move_selection, session_columns,
    };

    #[test]
    fn selection_tracks_the_resolved_grid_in_every_direction() {
        assert_eq!(move_selection(0, Navigation::Right, 4, 4), 1);
        assert_eq!(move_selection(3, Navigation::Right, 4, 4), 0);
        assert_eq!(move_selection(0, Navigation::Left, 4, 4), 3);
        assert_eq!(move_selection(2, Navigation::Down, 4, 4), 2);

        assert_eq!(move_selection(0, Navigation::Down, 2, 4), 2);
        assert_eq!(move_selection(1, Navigation::Down, 2, 4), 3);
        assert_eq!(move_selection(2, Navigation::Down, 2, 4), 0);
        assert_eq!(move_selection(3, Navigation::Up, 2, 4), 1);
        assert_eq!(move_selection(1, Navigation::Right, 2, 4), 0);

        assert_eq!(move_selection(0, Navigation::Down, 1, 4), 1);
        assert_eq!(move_selection(0, Navigation::Up, 1, 4), 3);
        assert_eq!(move_selection(2, Navigation::Right, 1, 4), 2);
    }

    #[test]
    fn actions_reflow_without_creating_a_three_column_or_overflowing_row() {
        assert_eq!(
            session_columns(PopoverLayout {
                width: 384,
                max_height: 620,
            }),
            4,
        );
        assert_eq!(
            session_columns(PopoverLayout {
                width: 367,
                max_height: 620,
            }),
            2,
        );
        assert_eq!(
            session_columns(PopoverLayout {
                width: 180,
                max_height: 620,
            }),
            1,
        );
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
