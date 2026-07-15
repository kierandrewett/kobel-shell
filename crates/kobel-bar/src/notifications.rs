//! Service-backed notification history popup for the top bar.

use chrono::{Local, TimeZone};
use freya_components::button::{Button, ButtonLayoutThemePartial};
use freya_components::scrollviews::ScrollView;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{Command, Notification};
use kobel_theme::{TOKENS, icons};
use torin::prelude::{Alignment, Content, Size};

use super::{BarActionSink, BarContext, button_colours, button_layout, popover_frame, use_popover_layout};

pub fn notifications_popup_app() -> impl IntoElement {
    NotificationsPanel
}

#[derive(PartialEq)]
struct NotificationsPanel;

impl Component for NotificationsPanel {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let sink = use_consume::<BarActionSink>();
        let layout = use_popover_layout();
        let snapshot = context.notifications.read().clone();
        let count = snapshot.notifications.len();
        let dnd = snapshot.dnd;
        let dnd_sink = sink.clone();
        let clear_sink = sink.clone();

        let dnd_button = Button::new()
            .flat()
            .theme_colors(button_colours(
                if dnd {
                    TOKENS.colours.surface_active.rgba().into()
                } else {
                    Color::TRANSPARENT
                },
                TOKENS.colours.surface_hover.rgba().into(),
            ))
            .theme_layout(button_layout(
                Size::auto(),
                TOKENS.popover.control_height,
                (0.0, TOKENS.popover.control_padding),
                TOKENS.popover.row_radius,
            ))
            .on_press(move |_| dnd_sink.service(Command::SetDnd(!dnd)))
            .child(
                label()
                    .text(if dnd { "Resume alerts" } else { "Do not disturb" })
                    .a11y_alt(if dnd {
                        "Resume notification alerts"
                    } else {
                        "Pause notification alerts"
                    })
                    .font_size(TOKENS.typography.small_size),
            );

        let clear_button = Button::new()
            .flat()
            .theme_colors(button_colours(
                Color::TRANSPARENT,
                TOKENS.colours.surface_hover.rgba().into(),
            ))
            .theme_layout(button_layout(
                Size::auto(),
                TOKENS.popover.control_height,
                (0.0, TOKENS.popover.control_padding),
                TOKENS.popover.row_radius,
            ))
            .on_press(move |_| clear_sink.service(Command::ClearNotifications))
            .child(
                label()
                    .text("Clear")
                    .a11y_alt("Clear all notifications")
                    .font_size(TOKENS.typography.small_size),
            );

        let heading = |width| {
            rect()
                .width(width)
                .spacing(TOKENS.notifications.header_text_gap)
                .child(
                    label()
                        .text("Notifications")
                        .font_size(TOKENS.typography.title_size)
                        .font_weight(TOKENS.typography.semibold_weight),
                )
                .child(
                    label()
                        .text(notification_count_label(count))
                        .font_size(TOKENS.typography.small_size)
                        .color(TOKENS.colours.text_muted.rgba()),
                )
        };
        let actions = rect()
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(TOKENS.popover.row_gap)
            .child(dnd_button)
            .child(clear_button);
        let compact = layout.compact();
        let header_height = if compact {
            TOKENS.notifications.header_height + TOKENS.popover.control_height + TOKENS.popover.row_gap
        } else {
            TOKENS.notifications.header_height
        };
        let header = if compact {
            rect()
                .width(Size::fill())
                .height(Size::px(header_height))
                .vertical()
                .spacing(TOKENS.popover.row_gap)
                .child(heading(Size::fill()))
                .child(actions)
        } else {
            rect()
                .width(Size::fill())
                .height(Size::px(header_height))
                .horizontal()
                .cross_align(Alignment::Center)
                .content(Content::Flex)
                .child(heading(Size::flex(1.0)))
                .child(actions)
        };

        let unavailable_height = if snapshot.serving {
            0.0
        } else {
            TOKENS.popover.control_height + TOKENS.popover.section_gap
        };
        let history_max_height =
            (layout.inner_max_height() - TOKENS.popover.section_gap - header_height - unavailable_height).max(1.0);
        let content = if snapshot.notifications.is_empty() {
            rect()
                .width(Size::fill())
                .height(Size::px(
                    TOKENS.notifications.empty_state_height.min(history_max_height),
                ))
                .center()
                .child(
                    label()
                        .text("All caught up")
                        .font_size(TOKENS.typography.body_size)
                        .color(TOKENS.colours.text_muted.rgba()),
                )
                .into_element()
        } else {
            ScrollView::new()
                .height(Size::auto())
                .max_height(Size::px(history_max_height))
                .show_scrollbar(true)
                .scroll_with_arrows(true)
                .spacing(TOKENS.popover.row_gap)
                .children(
                    snapshot
                        .notifications
                        .into_iter()
                        .map(|notification| NotificationCard { notification, compact }.into_element()),
                )
                .into_element()
        };

        let mut root = popover_frame()
            .height(Size::auto())
            .vertical()
            .spacing(TOKENS.popover.section_gap)
            .child(header);

        if !snapshot.serving {
            root = root.child(
                rect()
                    .width(Size::fill())
                    .padding((TOKENS.notifications.card_gap, TOKENS.notifications.card_padding))
                    .corner_radius(TOKENS.popover.row_radius)
                    .background(TOKENS.colours.surface_active.rgba())
                    .child(
                        label()
                            .text("Notification service unavailable")
                            .font_size(TOKENS.typography.small_size),
                    ),
            );
        }

        root.child(content)
    }
}

#[derive(PartialEq)]
struct NotificationCard {
    notification: Notification,
    compact: bool,
}

impl Component for NotificationCard {
    fn render(&self) -> impl IntoElement {
        let sink = use_consume::<BarActionSink>();
        let notification = &self.notification;
        let id = notification.id;
        let close_sink = sink.clone();
        let title = if notification.app_name.is_empty() {
            notification.summary.clone()
        } else {
            format!("{} - {}", notification.app_name, notification.summary)
        };

        let close = Button::new()
            .flat()
            .theme_colors(button_colours(
                Color::TRANSPARENT,
                TOKENS.colours.surface_hover.rgba().into(),
            ))
            .theme_layout(
                ButtonLayoutThemePartial::new()
                    .margin(0.0)
                    .corner_radius(TOKENS.popover.row_radius)
                    .width(Size::px(TOKENS.notifications.dismiss_size))
                    .height(Size::px(TOKENS.notifications.dismiss_size))
                    .padding(0.0),
            )
            .on_press(move |_| close_sink.service(Command::CloseNotification(id)))
            .child(label().text("x").a11y_alt(format!("Dismiss {}", notification.summary)));

        let mut text = rect()
            .width(Size::flex(1.0))
            .spacing(TOKENS.notifications.body_text_gap)
            .child(
                label()
                    .text(title)
                    .max_lines(1)
                    .text_overflow(TextOverflow::Ellipsis)
                    .font_size(TOKENS.typography.label_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            )
            .child(
                label()
                    .text(format_when(notification.time))
                    .font_size(TOKENS.typography.small_size)
                    .color(TOKENS.colours.text_muted.rgba()),
            );
        if !notification.body.is_empty() {
            text = text.child(
                label()
                    .text(notification.body.clone())
                    .max_lines(3)
                    .text_overflow(TextOverflow::Ellipsis)
                    .font_size(TOKENS.typography.body_size)
                    .color(TOKENS.colours.text_muted.rgba()),
            );
        }

        let body = rect()
            .width(Size::fill())
            .horizontal()
            .content(Content::Flex)
            .cross_align(Alignment::Start)
            .spacing(TOKENS.notifications.card_gap)
            .child(
                SvgViewer::new(icons::BELL)
                    .color(TOKENS.colours.text_muted.rgba())
                    .width(Size::px(TOKENS.popover.icon_size))
                    .height(Size::px(TOKENS.popover.icon_size)),
            )
            .child(text)
            .child(close);

        let actions = notification.actions.iter().map(|(action_key, action_label)| {
            let action_sink = sink.clone();
            let action_key = action_key.clone();
            let mut label = label()
                .text(action_label.clone())
                .font_size(TOKENS.typography.small_size);
            if self.compact {
                label = label
                    .width(Size::fill())
                    .max_lines(1)
                    .text_overflow(TextOverflow::Ellipsis);
            }
            Button::new()
                .flat()
                .theme_colors(button_colours(
                    TOKENS.colours.surface_elevated.rgba().into(),
                    TOKENS.colours.surface_hover.rgba().into(),
                ))
                .theme_layout(button_layout(
                    if self.compact { Size::fill() } else { Size::auto() },
                    TOKENS.popover.control_height,
                    (0.0, TOKENS.popover.control_padding),
                    TOKENS.popover.row_radius,
                ))
                .on_press(move |_| {
                    action_sink.service(Command::InvokeNotificationAction {
                        id,
                        action_key: action_key.clone(),
                    });
                })
                .child(label)
                .into_element()
        });
        let mut action_list = rect().width(Size::fill()).spacing(TOKENS.notifications.card_gap);
        action_list = if self.compact {
            action_list.vertical()
        } else {
            action_list.horizontal()
        };
        rect()
            .width(Size::fill())
            .padding(TOKENS.notifications.card_padding)
            .corner_radius(TOKENS.popover.row_radius)
            .background(TOKENS.colours.surface_elevated.rgba())
            .border(
                Border::new()
                    .fill(TOKENS.colours.border.rgba())
                    .width(TOKENS.popover.border_width),
            )
            .vertical()
            .spacing(TOKENS.notifications.card_gap)
            .child(body)
            .child(action_list.children(actions))
    }
}

fn notification_count_label(count: usize) -> String {
    match count {
        0 => "No notifications".to_string(),
        1 => "1 notification".to_string(),
        count => format!("{count} notifications"),
    }
}

fn format_when(time: i64) -> String {
    Local
        .timestamp_opt(time, 0)
        .single()
        .map(|value| value.format("%H:%M").to_string())
        .unwrap_or_default()
}
