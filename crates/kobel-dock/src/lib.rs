//! Dynamic GNOME-style application dock and layer-shell policy.

use std::path::PathBuf;
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use async_io::Timer;
use freya_animation::prelude::*;
use freya_components::image_viewer::ImageViewer;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{AppEntry, AppsSnapshot, ServiceEvent};
use kobel_theme::TOKENS;
use kobel_wayland::{Anchor, KeyboardInteractivity, LoopWaker, Margins, SurfaceConfig, SurfaceSize, ToplevelInfo};
use torin::prelude::{Alignment, Position, Size};

pub const OUTER_GAP: i32 = TOKENS.dock.edge_gap;
pub const TOOLTIP_HEADROOM: u32 = TOKENS.dock.tooltip_headroom;
pub const SURFACE_HEIGHT: u32 = TOKENS.dock.surface_height;

const FALLBACK_FAVOURITES: [&str; 4] = [
    "org.gnome.Nautilus",
    "org.mozilla.firefox",
    "org.gnome.Ptyxis",
    "org.gnome.Settings",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DockRequest {
    Launch(String),
    Activate(String),
    Minimize(String),
    ShowApplications,
}

#[derive(Clone)]
pub struct DockActionSink {
    sender: mpsc::Sender<DockRequest>,
    waker: Option<LoopWaker>,
}

impl DockActionSink {
    pub fn new(sender: mpsc::Sender<DockRequest>, waker: LoopWaker) -> Self {
        Self {
            sender,
            waker: Some(waker),
        }
    }

    fn inert() -> Self {
        let (sender, _receiver) = mpsc::channel();
        Self { sender, waker: None }
    }

    fn send(&self, request: DockRequest) {
        if self.sender.send(request).is_ok()
            && let Some(waker) = &self.waker
        {
            waker.wake();
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct DockItem {
    pub id: String,
    pub name: String,
    pub icon: Option<PathBuf>,
    pub windows: Vec<ToplevelInfo>,
    pub favourite: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DockMetrics {
    pub item_size: f32,
    pub icon_size: f32,
    pub width: f32,
    pub height: f32,
}

impl DockMetrics {
    pub fn for_output(output_width: u32, app_count: usize) -> Self {
        let slot_count = app_count.saturating_add(1) as f32;
        let fixed_width = TOKENS.dock.padding * 2.0 + TOKENS.dock.item_gap * slot_count + TOKENS.dock.separator_width;
        let max_width = output_width as f32 * TOKENS.dock.max_width_ratio;
        let available_item_size = ((max_width - fixed_width) / slot_count).max(TOKENS.dock.min_item_size);
        let item_size = TOKENS.dock.item_size.min(available_item_size);
        let icon_size = TOKENS.dock.icon_size * (item_size / TOKENS.dock.item_size);
        let width = fixed_width + slot_count * item_size;
        let height = item_size + TOKENS.dock.padding * 2.0;

        Self {
            item_size,
            icon_size,
            width,
            height,
        }
    }

    pub fn input_rect(self, output_width: u32) -> (i32, i32, i32, i32) {
        (
            ((output_width as f32 - self.width) / 2.0).floor() as i32,
            SURFACE_HEIGHT as i32 - self.height.ceil() as i32,
            self.width.ceil() as i32,
            self.height.ceil() as i32,
        )
    }
}

#[derive(Clone, PartialEq)]
pub struct DockContext {
    apps: State<AppsSnapshot>,
    windows: State<Vec<ToplevelInfo>>,
    favourites: State<Vec<String>>,
    output_width: State<u32>,
}

impl DockContext {
    pub fn create(favourites: Vec<String>, output_width: u32) -> Self {
        Self {
            apps: State::create(AppsSnapshot::default()),
            windows: State::create(Vec::new()),
            favourites: State::create(favourites),
            output_width: State::create(output_width),
        }
    }

    pub fn apply(&self, event: &ServiceEvent) {
        if let ServiceEvent::Apps(snapshot) = event {
            let mut apps = self.apps;
            apps.set_if_modified(snapshot.clone());
        }
    }

    pub fn set_windows(&self, windows: Vec<ToplevelInfo>) {
        let mut state = self.windows;
        state.set_if_modified(windows);
    }

    pub fn set_output_width(&self, output_width: u32) {
        let mut state = self.output_width;
        state.set_if_modified(output_width);
    }

    pub fn metrics(&self) -> DockMetrics {
        let item_count = dock_items(&self.favourites.peek(), &self.apps.peek(), &self.windows.peek()).len();
        DockMetrics::for_output(*self.output_width.peek(), item_count)
    }
}

pub fn load_favourite_apps() -> Vec<String> {
    let output = ProcessCommand::new("gsettings")
        .args(["get", "org.gnome.shell", "favorite-apps"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();

    output
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|value| parse_favourite_apps(&value))
        .unwrap_or_else(|| FALLBACK_FAVOURITES.iter().map(|id| (*id).to_string()).collect())
}

fn parse_favourite_apps(value: &str) -> Option<Vec<String>> {
    let start = value.find('[')?;
    let end = value.rfind(']')?;
    if end < start {
        return None;
    }

    let mut favourites = Vec::new();
    let mut chars = value[start + 1..end].chars().peekable();
    while let Some(character) = chars.next() {
        if character.is_whitespace() || character == ',' {
            continue;
        }
        if character != '\'' {
            return None;
        }

        let mut id = String::new();
        let mut closed = false;
        while let Some(character) = chars.next() {
            match character {
                '\\' => id.push(chars.next()?),
                '\'' => {
                    closed = true;
                    break;
                }
                _ => id.push(character),
            }
        }
        if !closed {
            return None;
        }
        favourites.push(id.strip_suffix(".desktop").unwrap_or(&id).to_string());
    }
    Some(favourites)
}

fn normalized_app_id(id: &str) -> &str {
    id.strip_suffix(".desktop").unwrap_or(id)
}

fn exact_app_ids_match(left: &str, right: &str) -> bool {
    normalized_app_id(left).eq_ignore_ascii_case(normalized_app_id(right))
}

pub fn app_ids_match(left: &str, right: &str) -> bool {
    if exact_app_ids_match(left, right) {
        return true;
    }

    let left = normalized_app_id(left);
    let right = normalized_app_id(right);
    if left.contains('.') && right.contains('.') {
        return false;
    }

    left.rsplit('.').next().is_some_and(|left_tail| {
        right
            .rsplit('.')
            .next()
            .is_some_and(|right_tail| left_tail.eq_ignore_ascii_case(right_tail))
    })
}

fn find_app<'a>(apps: &'a AppsSnapshot, id: &str) -> Option<&'a AppEntry> {
    apps.apps
        .iter()
        .find(|app| exact_app_ids_match(&app.id, id))
        .or_else(|| apps.apps.iter().find(|app| app_ids_match(&app.id, id)))
}

fn windows_for(id: &str, windows: &[ToplevelInfo]) -> Vec<ToplevelInfo> {
    let exact: Vec<ToplevelInfo> = windows
        .iter()
        .filter(|window| exact_app_ids_match(id, &window.app_id))
        .cloned()
        .collect();
    if !exact.is_empty() {
        return exact;
    }

    windows
        .iter()
        .filter(|window| app_ids_match(id, &window.app_id))
        .cloned()
        .collect()
}

fn resolved_item(id: &str, favourite: bool, apps: &AppsSnapshot, windows: &[ToplevelInfo]) -> DockItem {
    let app = find_app(apps, id);
    DockItem {
        id: app.map_or_else(|| normalized_app_id(id).to_string(), |app| app.id.clone()),
        name: app.map_or_else(
            || normalized_app_id(id).rsplit('.').next().unwrap_or(id).to_string(),
            |app| app.name.clone(),
        ),
        icon: app.and_then(|app| app.icon.clone()),
        windows: windows_for(id, windows),
        favourite,
    }
}

pub fn dock_items(favourites: &[String], apps: &AppsSnapshot, windows: &[ToplevelInfo]) -> Vec<DockItem> {
    let mut items: Vec<DockItem> = favourites
        .iter()
        .map(|id| resolved_item(id, true, apps, windows))
        .collect();

    for window in windows {
        if items
            .iter()
            .any(|item| item.windows.iter().any(|candidate| candidate.id == window.id))
        {
            continue;
        }
        if let Some(item) = items
            .iter_mut()
            .find(|item| exact_app_ids_match(&item.id, &window.app_id))
        {
            item.windows.push(window.clone());
            continue;
        }

        items.push(resolved_item(&window.app_id, false, apps, windows));
    }
    items
}

pub fn primary_request(app_id: &str, windows: &[ToplevelInfo]) -> DockRequest {
    if windows.is_empty() {
        return DockRequest::Launch(app_id.to_string());
    }

    match windows.iter().position(|window| window.focused) {
        None => DockRequest::Activate(windows[0].id.clone()),
        Some(index) if windows.len() > 1 => DockRequest::Activate(windows[(index + 1) % windows.len()].id.clone()),
        Some(index) => DockRequest::Minimize(windows[index].id.clone()),
    }
}

pub fn scroll_request(windows: &[ToplevelInfo], forward: bool) -> Option<DockRequest> {
    if windows.is_empty() {
        return None;
    }

    let focused = windows.iter().position(|window| window.focused);
    if windows.len() == 1 {
        return focused.is_none().then(|| DockRequest::Activate(windows[0].id.clone()));
    }

    let current = focused.unwrap_or(0);
    let next = if forward {
        (current + 1) % windows.len()
    } else {
        (current + windows.len() - 1) % windows.len()
    };
    Some(DockRequest::Activate(windows[next].id.clone()))
}

fn indicator_window(total: usize, focused: Option<usize>) -> (usize, usize) {
    let visible = total.min(4);
    if total <= 4 {
        return (0, visible);
    }

    let focused = focused.unwrap_or(0);
    (focused.saturating_sub(1).min(total - 4), visible)
}

#[derive(Clone, Copy, PartialEq)]
struct TooltipHover {
    visible: State<bool>,
    generation: State<u64>,
}

impl TooltipHover {
    fn create() -> Self {
        Self {
            visible: use_state(|| false),
            generation: use_state(|| 0),
        }
    }

    fn enter(self) {
        let mut generation = self.generation;
        *generation.write() += 1;
        let current = *generation.peek();
        let mut visible = self.visible;
        let platform = Platform::get();
        spawn(async move {
            Timer::after(Duration::from_millis(TOKENS.motion.tooltip_delay_millis)).await;
            if *generation.peek() == current {
                visible.set(true);
                platform.send(UserEvent::RequestRedraw);
            }
        });
    }

    fn leave(self) {
        let mut generation = self.generation;
        *generation.write() += 1;
        let mut visible = self.visible;
        visible.set(false);
    }
}

#[derive(PartialEq)]
struct TooltipBubble {
    text: String,
    visible: bool,
    item_size: f32,
}

impl Component for TooltipBubble {
    fn render(&self) -> impl IntoElement {
        let visible = self.visible;
        let animation = use_animation_transition(visible, |from, to| {
            let duration = if to {
                TOKENS.motion.standard_seconds
            } else {
                TOKENS.motion.fast_seconds
            };
            AnimNum::new(u8::from(from) as f32, u8::from(to) as f32)
                .time((duration * 1000.0) as u64)
                .ease(Ease::Out)
                .function(Function::Expo)
        });
        let progress = animation.read().value();

        rect()
            .position(
                Position::new_absolute()
                    .bottom(self.item_size + TOKENS.dock.tooltip_offset as f32)
                    .left(0.0),
            )
            .interactive(false)
            .opacity(progress)
            .scale(TOKENS.dock.tooltip_initial_scale + progress * (1.0 - TOKENS.dock.tooltip_initial_scale))
            .background(TOKENS.colours.card.rgba())
            .corner_radius(TOKENS.popover.row_radius)
            .padding(TOKENS.dock.tooltip_padding)
            .shadow((
                0.0,
                TOKENS.dock.tooltip_shadow_y,
                TOKENS.dock.tooltip_shadow_blur,
                0.0,
                TOKENS.colours.shadow.rgba(),
            ))
            .child(
                label()
                    .text(self.text.clone())
                    .font_size(TOKENS.typography.small_size)
                    .font_weight(TOKENS.typography.medium_weight)
                    .color(TOKENS.colours.text.rgba())
                    .max_lines(1usize),
            )
    }
}

#[derive(Clone, PartialEq)]
enum IconData {
    Svg(String, Bytes),
    Raster(String, Bytes),
    Missing,
}

fn load_icon(path: &Option<PathBuf>) -> IconData {
    let Some(path) = path else {
        return IconData::Missing;
    };
    let Ok(bytes) = std::fs::read(path) else {
        return IconData::Missing;
    };
    let key = path.to_string_lossy().into_owned();
    let bytes = Bytes::from(bytes);
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
    {
        IconData::Svg(key, bytes)
    } else {
        IconData::Raster(key, bytes)
    }
}

#[derive(PartialEq)]
struct AppIcon {
    path: Option<PathBuf>,
    fallback: String,
    size: f32,
}

impl Component for AppIcon {
    fn render(&self) -> impl IntoElement {
        let path = use_reactive(&self.path);
        let data = use_memo(move || load_icon(&path.read()));
        let size = self.size;

        match &*data.read() {
            IconData::Svg(key, bytes) => SvgViewer::new((key.clone(), bytes.clone()))
                .width(Size::px(size))
                .height(Size::px(size))
                .into_element(),
            IconData::Raster(key, bytes) => ImageViewer::new((key.clone(), bytes.clone()))
                .width(Size::px(size))
                .height(Size::px(size))
                .into_element(),
            IconData::Missing => rect()
                .width(Size::px(size))
                .height(Size::px(size))
                .center()
                .background(TOKENS.colours.card.rgba())
                .corner_radius(TOKENS.dock.radius * TOKENS.dock.fallback_radius_ratio)
                .child(
                    label()
                        .text(self.fallback.chars().next().unwrap_or('?').to_uppercase().to_string())
                        .font_size(size * TOKENS.dock.fallback_icon_scale)
                        .font_weight(TOKENS.typography.semibold_weight)
                        .color(TOKENS.colours.text.rgba()),
                )
                .into_element(),
        }
    }
}

#[derive(PartialEq)]
struct WindowDot {
    focused: bool,
}

impl Component for WindowDot {
    fn render(&self) -> impl IntoElement {
        let focused = self.focused;
        let animation = use_animation_transition(focused, |from, to| {
            AnimNum::new(u8::from(from) as f32, u8::from(to) as f32)
                .time((TOKENS.motion.dock_seconds * 1000.0) as u64)
                .ease(Ease::Out)
                .function(Function::Expo)
        });
        let progress = animation.read().value();
        let slot_width = TOKENS.dock.indicator_size * TOKENS.dock.indicator_active_scale;

        rect()
            .width(Size::px(slot_width))
            .height(Size::px(TOKENS.dock.indicator_size))
            .center()
            .child(
                rect()
                    .width(Size::px(TOKENS.dock.indicator_size))
                    .height(Size::px(TOKENS.dock.indicator_size))
                    .corner_radius(TOKENS.dock.indicator_size)
                    .background(if focused {
                        TOKENS.colours.accent.rgba()
                    } else {
                        TOKENS.colours.text_muted.rgba()
                    })
                    .scale((1.0 + progress * (TOKENS.dock.indicator_active_scale - 1.0), 1.0)),
            )
    }
}

fn window_indicators(windows: &[ToplevelInfo], item_size: f32) -> Element {
    let focused = windows.iter().position(|window| window.focused);
    let (start, count) = indicator_window(windows.len(), focused);
    let dots = (0..count)
        .map(|index| {
            WindowDot {
                focused: focused == Some(start + index),
            }
            .into_element()
        })
        .collect::<Vec<_>>();

    rect()
        .position(Position::new_absolute().bottom(TOKENS.dock.indicator_bottom).left(0.0))
        .width(Size::px(item_size))
        .horizontal()
        .main_align(Alignment::Center)
        .spacing(TOKENS.dock.indicator_gap)
        .interactive(false)
        .children(dots)
        .into_element()
}

#[derive(Clone, PartialEq)]
enum DockTileContent {
    ShowApplications,
    App(DockItem),
}

#[derive(PartialEq)]
struct DockTile {
    content: DockTileContent,
    metrics: DockMetrics,
}

impl Component for DockTile {
    fn render(&self) -> impl IntoElement {
        let sink = use_consume::<DockActionSink>();
        let mut hovered = use_state(|| false);
        let tooltip = TooltipHover::create();
        let a11y_id = use_a11y();
        let focus = use_focus(a11y_id);
        let hover_animation = use_animation_transition(hovered, |from: bool, to: bool| {
            AnimNum::new(u8::from(from) as f32, u8::from(to) as f32)
                .time((TOKENS.motion.dock_seconds * 1000.0) as u64)
                .ease(Ease::Out)
                .function(Function::Expo)
        });
        let hover_progress = hover_animation.read().value();

        let (name, primary, middle, windows, icon): (
            String,
            DockRequest,
            Option<DockRequest>,
            Vec<ToplevelInfo>,
            Element,
        ) = match &self.content {
            DockTileContent::ShowApplications => (
                "Show Applications".to_string(),
                DockRequest::ShowApplications,
                None,
                Vec::new(),
                SvgViewer::new(kobel_theme::icons::DOTS_NINE)
                    .color(TOKENS.colours.text.rgba())
                    .a11y_builder(|node| node.set_hidden())
                    .width(Size::px(TOKENS.chrome_icon_size))
                    .height(Size::px(TOKENS.chrome_icon_size))
                    .into_element(),
            ),
            DockTileContent::App(item) => (
                item.name.clone(),
                primary_request(&item.id, &item.windows),
                Some(DockRequest::Launch(item.id.clone())),
                item.windows.clone(),
                AppIcon {
                    path: item.icon.clone(),
                    fallback: item.name.clone(),
                    size: self.metrics.icon_size,
                }
                .into_element(),
            ),
        };

        let hover_alpha = (TOKENS.colours.hover.3 as f32 * hover_progress).round() as u8;
        let hover_background = (
            TOKENS.colours.hover.0,
            TOKENS.colours.hover.1,
            TOKENS.colours.hover.2,
            hover_alpha,
        );
        let scale = 1.0 + hover_progress * (TOKENS.dock.hover_scale - 1.0);
        let press_sink = sink.clone();
        let middle_sink = sink.clone();
        let wheel_sink = sink;
        let wheel_windows = windows.clone();

        let tile = rect()
            .width(Size::px(self.metrics.item_size))
            .height(Size::px(self.metrics.item_size))
            .center()
            .background(hover_background)
            .corner_radius(TOKENS.dock.radius * TOKENS.dock.item_radius_ratio)
            .a11y_id(a11y_id)
            .a11y_focusable(true)
            .a11y_role(AccessibilityRole::Button)
            .a11y_alt(name.clone())
            .on_pointer_enter(move |_| {
                hovered.set(true);
                tooltip.enter();
            })
            .on_pointer_leave(move |_| {
                hovered.set(false);
                tooltip.leave();
            })
            .on_press(move |_| press_sink.send(primary.clone()))
            .on_mouse_down(move |event: Event<MouseEventData>| {
                if event.button == Some(MouseButton::Middle)
                    && let Some(request) = &middle
                {
                    middle_sink.send(request.clone());
                }
            })
            .on_wheel(move |event: Event<WheelEventData>| {
                if let Some(request) = scroll_request(&wheel_windows, event.delta_y > 0.0) {
                    wheel_sink.send(request);
                }
            })
            .maybe(focus() == Focus::Keyboard, |el| {
                el.border(
                    Border::new()
                        .fill(TOKENS.colours.accent.rgba())
                        .width(TOKENS.dock.focus_border_width),
                )
            })
            .child(
                rect()
                    .width(Size::fill())
                    .height(Size::fill())
                    .center()
                    .scale(scale)
                    .child(icon),
            )
            .maybe(!windows.is_empty(), |el| {
                el.child(window_indicators(&windows, self.metrics.item_size))
            });

        rect()
            .width(Size::px(self.metrics.item_size))
            .height(Size::px(self.metrics.item_size))
            .child(tile)
            .child(TooltipBubble {
                text: name,
                visible: *tooltip.visible.read(),
                item_size: self.metrics.item_size,
            })
    }
}

#[derive(PartialEq)]
struct DockSlab {
    items: Vec<DockItem>,
    metrics: DockMetrics,
}

impl Component for DockSlab {
    fn render(&self) -> impl IntoElement {
        let entrance = use_animation(|config| {
            config.on_creation(OnCreation::Run);
            (
                AnimNum::new(TOKENS.dock.open_initial_scale, 1.0)
                    .time((TOKENS.motion.dock_seconds * 1000.0) as u64)
                    .ease(Ease::Out)
                    .function(Function::Expo),
                AnimNum::new(0.0, 1.0)
                    .time((TOKENS.motion.dock_seconds * 1000.0) as u64)
                    .ease(Ease::Out)
                    .function(Function::Expo),
            )
        });
        let entrance = entrance.read();
        let scale = entrance.0.value();
        let opacity = entrance.1.value();
        let mut children = Vec::with_capacity(self.items.len() + 2);
        children.push(
            rect()
                .key("show-applications")
                .width(Size::px(self.metrics.item_size))
                .height(Size::px(self.metrics.item_size))
                .child(DockTile {
                    content: DockTileContent::ShowApplications,
                    metrics: self.metrics,
                })
                .into_element(),
        );
        children.push(
            rect()
                .width(Size::px(TOKENS.dock.separator_width))
                .height(Size::px(self.metrics.icon_size))
                .background(TOKENS.colours.border.rgba())
                .into_element(),
        );
        children.extend(self.items.iter().cloned().map(|item| {
            let key = item.id.clone();
            rect()
                .key(key)
                .width(Size::px(self.metrics.item_size))
                .height(Size::px(self.metrics.item_size))
                .child(DockTile {
                    content: DockTileContent::App(item),
                    metrics: self.metrics,
                })
                .into_element()
        }));
        let background = (
            TOKENS.colours.system.0,
            TOKENS.colours.system.1,
            TOKENS.colours.system.2,
            TOKENS.dock.background_opacity,
        );

        rect()
            .width(Size::px(self.metrics.width))
            .height(Size::px(self.metrics.height))
            .horizontal()
            .main_align(Alignment::Center)
            .cross_align(Alignment::Center)
            .spacing(TOKENS.dock.item_gap)
            .padding(TOKENS.dock.padding)
            .background(background)
            .corner_radius(TOKENS.dock.radius)
            .shadow((
                0.0,
                TOKENS.dock.shadow_y,
                TOKENS.dock.shadow_blur,
                0.0,
                TOKENS.colours.shadow.rgba(),
            ))
            .scale(scale)
            .opacity(opacity)
            .children(children)
    }
}

pub fn dock_app() -> impl IntoElement {
    let context = use_consume::<DockContext>();
    let items = dock_items(
        &context.favourites.read(),
        &context.apps.read(),
        &context.windows.read(),
    );
    let metrics = DockMetrics::for_output(*context.output_width.read(), items.len());

    rect()
        .width(Size::fill())
        .height(Size::fill())
        .vertical()
        .main_align(Alignment::End)
        .cross_align(Alignment::Center)
        .font_family(TOKENS.typography.family)
        .child(DockSlab { items, metrics })
}

pub fn dock_preview_app() -> impl IntoElement {
    use_provide_context(|| {
        DockContext::create(
            vec![
                "org.gnome.Nautilus".to_string(),
                "org.mozilla.firefox".to_string(),
                "com.mitchellh.ghostty".to_string(),
            ],
            960,
        )
    });
    use_provide_context(DockActionSink::inert);
    dock_app()
}

pub fn surface_config() -> SurfaceConfig {
    SurfaceConfig::new(
        "kobel-dock",
        SurfaceSize::Exact {
            width: 0,
            height: SURFACE_HEIGHT,
        },
        PreferredTheme::Dark,
    )
    .anchor(Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT)
    .margins(Margins {
        top: 0,
        right: 0,
        bottom: OUTER_GAP,
        left: 0,
    })
    .exclusive_zone(OUTER_GAP + (TOKENS.dock.item_size + TOKENS.dock.padding * 2.0) as i32)
    .keyboard_interactivity(KeyboardInteractivity::None)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use freya_core::elements::image::Image;
    use freya_testing::launch_test;
    use kobel_services::{AppEntry, AppsSnapshot};
    use kobel_wayland::{Anchor, KeyboardInteractivity, SurfaceSize, ToplevelInfo};

    use super::{
        DockMetrics, DockRequest, OUTER_GAP, SURFACE_HEIGHT, TOKENS, app_ids_match, dock_items, dock_preview_app,
        indicator_window, parse_favourite_apps, primary_request, scroll_request, surface_config,
    };

    fn app(id: &str, name: &str) -> AppEntry {
        AppEntry {
            id: id.to_string(),
            name: name.to_string(),
            icon: Some(PathBuf::from(format!("/icons/{id}.svg"))),
            keywords: Vec::new(),
        }
    }

    fn window(id: &str, app_id: &str, focused: bool) -> ToplevelInfo {
        ToplevelInfo {
            id: id.to_string(),
            app_id: app_id.to_string(),
            title: format!("{app_id} window"),
            focused,
            minimized: false,
        }
    }

    #[test]
    fn component_mounts_in_the_headless_runner() {
        let mut runner = launch_test(dock_preview_app);
        runner.sync_and_update();
    }

    #[test]
    fn show_applications_uses_the_shared_phosphor_chrome_size() {
        let mut runner = launch_test(dock_preview_app);
        runner.sync_and_update();
        runner.sync_and_update();
        assert!(
            runner
                .find(|node, element| {
                    Image::try_downcast(element).filter(|_| {
                        node.layout().area.width() == TOKENS.chrome_icon_size
                            && node.layout().area.height() == TOKENS.chrome_icon_size
                    })
                })
                .is_some(),
            "show-applications Phosphor icon did not render at the shared chrome size",
        );
    }

    #[test]
    fn parses_gsettings_favourites_and_removes_desktop_suffixes() {
        assert_eq!(
            parse_favourite_apps("['org.gnome.Nautilus.desktop', 'com.mitchellh.ghostty.desktop', 'plain-id']"),
            Some(vec![
                "org.gnome.Nautilus".to_string(),
                "com.mitchellh.ghostty".to_string(),
                "plain-id".to_string(),
            ])
        );
        assert_eq!(parse_favourite_apps("@as []"), Some(Vec::new()));
        assert_eq!(parse_favourite_apps("not an array"), None);
    }

    #[test]
    fn app_matching_prefers_complete_ids_but_tolerates_desktop_suffixes_and_case() {
        assert!(app_ids_match("org.gnome.Nautilus.desktop", "org.gnome.Nautilus"));
        assert!(app_ids_match("firefox", "org.mozilla.Firefox"));
        assert!(!app_ids_match("org.gnome.Settings", "org.gnome.Nautilus"));
    }

    #[test]
    fn dock_keeps_favourites_order_then_groups_unpinned_running_apps() {
        let apps = AppsSnapshot {
            apps: vec![
                app("org.gnome.Nautilus", "Files"),
                app("com.spotify.Client", "Spotify"),
                app("dev.zed.Zed", "Zed"),
            ],
        };
        let windows = vec![
            window("files-1", "org.gnome.Nautilus", true),
            window("zed-1", "dev.zed.Zed", false),
            window("zed-2", "dev.zed.Zed", false),
        ];

        let items = dock_items(
            &["com.spotify.Client".to_string(), "org.gnome.Nautilus".to_string()],
            &apps,
            &windows,
        );

        assert_eq!(
            items.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(),
            vec!["com.spotify.Client", "org.gnome.Nautilus", "dev.zed.Zed"]
        );
        assert!(items[0].favourite);
        assert!(items[1].favourite);
        assert!(!items[2].favourite);
        assert_eq!(items[1].windows.len(), 1);
        assert_eq!(items[2].windows.len(), 2);
        assert_eq!(items[2].name, "Zed");
    }

    #[test]
    fn exact_window_groups_keep_apps_with_the_same_tail_separate() {
        let apps = AppsSnapshot {
            apps: vec![
                app("org.foo.Terminal", "Foo Terminal"),
                app("com.bar.Terminal", "Bar Terminal"),
            ],
        };
        let windows = vec![
            window("foo-1", "org.foo.Terminal", true),
            window("bar-1", "com.bar.Terminal", false),
        ];

        let items = dock_items(&["org.foo.Terminal".to_string()], &apps, &windows);

        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "org.foo.Terminal");
        assert_eq!(
            items[0]
                .windows
                .iter()
                .map(|window| window.id.as_str())
                .collect::<Vec<_>>(),
            vec!["foo-1"]
        );
        assert_eq!(items[1].id, "com.bar.Terminal");
        assert_eq!(
            items[1]
                .windows
                .iter()
                .map(|window| window.id.as_str())
                .collect::<Vec<_>>(),
            vec!["bar-1"]
        );
    }

    #[test]
    fn closed_favourite_does_not_claim_a_qualified_app_with_the_same_tail() {
        let apps = AppsSnapshot {
            apps: vec![
                app("org.foo.Terminal", "Foo Terminal"),
                app("com.bar.Terminal", "Bar Terminal"),
            ],
        };
        let items = dock_items(
            &["org.foo.Terminal".to_string()],
            &apps,
            &[window("bar-1", "com.bar.Terminal", true)],
        );

        assert_eq!(items.len(), 2);
        assert!(items[0].windows.is_empty());
        assert_eq!(items[1].id, "com.bar.Terminal");
        assert_eq!(items[1].windows[0].id, "bar-1");
    }

    #[test]
    fn primary_request_matches_dash_to_dock_click_action() {
        assert_eq!(
            primary_request("firefox", &[]),
            DockRequest::Launch("firefox".to_string())
        );
        assert_eq!(
            primary_request("firefox", &[window("one", "firefox", false)]),
            DockRequest::Activate("one".to_string())
        );
        assert_eq!(
            primary_request("firefox", &[window("one", "firefox", true)]),
            DockRequest::Minimize("one".to_string())
        );
        assert_eq!(
            primary_request(
                "firefox",
                &[window("one", "firefox", true), window("two", "firefox", false),],
            ),
            DockRequest::Activate("two".to_string())
        );
    }

    #[test]
    fn scroll_request_cycles_windows_in_both_directions() {
        let windows = vec![
            window("one", "firefox", false),
            window("two", "firefox", true),
            window("three", "firefox", false),
        ];

        assert_eq!(
            scroll_request(&windows, true),
            Some(DockRequest::Activate("three".to_string()))
        );
        assert_eq!(
            scroll_request(&windows, false),
            Some(DockRequest::Activate("one".to_string()))
        );
        assert_eq!(scroll_request(&[], true), None);
    }

    #[test]
    fn window_indicators_cap_at_four_and_keep_focus_visible() {
        assert_eq!(indicator_window(3, Some(2)), (0, 3));
        assert_eq!(indicator_window(7, Some(0)), (0, 4));
        assert_eq!(indicator_window(7, Some(4)), (3, 4));
        assert_eq!(indicator_window(7, Some(6)), (3, 4));
    }

    #[test]
    fn dock_metrics_shrink_items_to_fit_narrow_outputs() {
        let wide = DockMetrics::for_output(1920, 20);
        let narrow = DockMetrics::for_output(1024, 20);

        assert_eq!(wide.item_size, TOKENS.dock.item_size);
        assert!(wide.width <= 1920.0 * TOKENS.dock.max_width_ratio);
        assert!(narrow.item_size < wide.item_size);
        assert!(narrow.width <= 1024.0 * TOKENS.dock.max_width_ratio + 0.01);

        let (x, y, width, height) = narrow.input_rect(1024);
        assert_eq!(x, ((1024.0 - narrow.width) / 2.0).floor() as i32);
        assert_eq!(y, SURFACE_HEIGHT as i32 - narrow.height.ceil() as i32);
        assert_eq!(width, narrow.width.ceil() as i32);
        assert_eq!(height, narrow.height.ceil() as i32);
    }

    #[test]
    fn surface_spans_the_output_but_only_reserves_the_visual_dock_height() {
        let config = surface_config();

        assert_eq!(
            config.size,
            SurfaceSize::Exact {
                width: 0,
                height: SURFACE_HEIGHT,
            }
        );
        assert_eq!(config.anchor, Anchor::BOTTOM | Anchor::LEFT | Anchor::RIGHT);
        assert_eq!(config.exclusive_zone, OUTER_GAP + 64);
        assert_eq!(config.keyboard_interactivity, KeyboardInteractivity::None);
    }
}
