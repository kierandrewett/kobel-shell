//! Dynamic GNOME-style application dock and layer-shell policy.

use std::path::PathBuf;
use std::process::{Command as ProcessCommand, Stdio};

use freya_core::prelude::*;
use kobel_services::{AppEntry, AppsSnapshot, ServiceEvent};
use kobel_theme::TOKENS;
use kobel_wayland::{Anchor, KeyboardInteractivity, Margins, SurfaceConfig, SurfaceSize, ToplevelInfo};
use torin::prelude::{Alignment, Size};

pub const OUTER_GAP: i32 = TOKENS.dock.edge_gap;
pub const TOOLTIP_HEADROOM: u32 = 56;
pub const SURFACE_HEIGHT: u32 = 120;

const DOCK_MAX_WIDTH_RATIO: f32 = 0.9;
const MIN_ITEM_SIZE: f32 = 24.0;
const SEPARATOR_WIDTH: f32 = 1.0;
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
        let fixed_width = TOKENS.dock.padding * 2.0 + TOKENS.dock.item_gap * slot_count + SEPARATOR_WIDTH;
        let max_width = output_width as f32 * DOCK_MAX_WIDTH_RATIO;
        let available_item_size = ((max_width - fixed_width) / slot_count).max(MIN_ITEM_SIZE);
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

    normalized_app_id(left).rsplit('.').next().is_some_and(|left_tail| {
        normalized_app_id(right)
            .rsplit('.')
            .next()
            .is_some_and(|right_tail| left_tail.eq_ignore_ascii_case(right_tail))
    })
}

fn find_app<'a>(apps: &'a AppsSnapshot, id: &str) -> Option<&'a AppEntry> {
    apps.apps
        .iter()
        .find(|app| exact_app_ids_match(&app.id, id))
        .or_else(|| apps.by_id(id))
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

pub fn dock_app() -> impl IntoElement {
    let context = use_consume::<DockContext>();
    let items = dock_items(
        &context.favourites.read(),
        &context.apps.read(),
        &context.windows.read(),
    );

    rect()
        .width(Size::fill())
        .height(Size::fill())
        .vertical()
        .main_align(Alignment::End)
        .cross_align(Alignment::Center)
        .child(
            rect()
                .horizontal()
                .spacing(TOKENS.dock.item_gap)
                .padding(TOKENS.dock.padding)
                .background(TOKENS.colours.surface.rgba())
                .corner_radius(TOKENS.dock.radius)
                .children(
                    items
                        .into_iter()
                        .map(|item| item.name.into_element())
                        .collect::<Vec<_>>(),
                ),
        )
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

    use freya_testing::launch_test;
    use kobel_services::{AppEntry, AppsSnapshot};
    use kobel_wayland::{Anchor, KeyboardInteractivity, SurfaceSize, ToplevelInfo};

    use super::{
        DockMetrics, DockRequest, OUTER_GAP, SURFACE_HEIGHT, app_ids_match, dock_items, dock_preview_app,
        parse_favourite_apps, primary_request, scroll_request, surface_config,
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
    fn dock_metrics_shrink_items_to_fit_narrow_outputs() {
        let wide = DockMetrics::for_output(1920, 20);
        let narrow = DockMetrics::for_output(1024, 20);

        assert_eq!(wide.item_size, 48.0);
        assert!(wide.width <= 1920.0 * 0.9);
        assert!(narrow.item_size < wide.item_size);
        assert!(narrow.width <= 1024.0 * 0.9 + 0.01);

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
