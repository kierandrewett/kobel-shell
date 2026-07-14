//! The complete presentation and layer-shell policy for the independent top bar.

use std::time::Duration;

use async_io::Timer;
use chrono::Local;
use freya_components::svg_viewer::SvgViewer;
use freya_core::prelude::*;
use kobel_services::{AudioSnapshot, BatterySnapshot, NetworkSnapshot, ServiceEvent};
use kobel_theme::{TOKENS, icons};
use kobel_wayland::{Anchor, KeyboardInteractivity, Margins, SurfaceConfig, SurfaceSize};
use torin::prelude::{Alignment, Content, Size};

pub const SURFACE_HEIGHT: u32 = TOKENS.bar.height;

/// Latest service values retained independently of mounted output surfaces.
///
/// Output hot-plug can happen after providers have emitted their initial
/// snapshots. Keeping those values here lets a newly mounted bar start from
/// current state instead of waiting for another battery or network change.
#[derive(Clone, Debug, PartialEq)]
pub struct BarSnapshots {
    audio: AudioSnapshot,
    battery: BatterySnapshot,
    network: NetworkSnapshot,
}

impl Default for BarSnapshots {
    fn default() -> Self {
        Self {
            audio: AudioSnapshot {
                volume: 0.0,
                muted: false,
                streams: Vec::new(),
            },
            battery: BatterySnapshot::default(),
            network: NetworkSnapshot::default(),
        }
    }
}

impl BarSnapshots {
    pub fn apply(&mut self, event: &ServiceEvent) {
        match event {
            ServiceEvent::Audio(snapshot) => self.audio = snapshot.clone(),
            ServiceEvent::Battery(snapshot) => self.battery = snapshot.clone(),
            ServiceEvent::Network(snapshot) => self.network = snapshot.clone(),
            _ => {}
        }
    }
}

/// Reactive service state installed independently in every output's Freya tree.
#[derive(Clone)]
pub struct BarContext {
    audio: State<AudioSnapshot>,
    battery: State<BatterySnapshot>,
    network: State<NetworkSnapshot>,
}

impl BarContext {
    pub fn create() -> Self {
        Self::from_snapshots(&BarSnapshots::default())
    }

    pub fn from_snapshots(snapshots: &BarSnapshots) -> Self {
        Self {
            audio: State::create(snapshots.audio.clone()),
            battery: State::create(snapshots.battery.clone()),
            network: State::create(snapshots.network.clone()),
        }
    }

    pub fn apply(&self, event: &ServiceEvent) {
        match event {
            ServiceEvent::Audio(snapshot) => {
                let mut audio = self.audio;
                audio.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Battery(snapshot) => {
                let mut battery = self.battery;
                battery.set_if_modified(snapshot.clone());
            }
            ServiceEvent::Network(snapshot) => {
                let mut network = self.network;
                network.set_if_modified(snapshot.clone());
            }
            _ => {}
        }
    }
}

fn icon(bytes: &'static [u8]) -> SvgViewer {
    SvgViewer::new(bytes)
        .color(TOKENS.colours.text_muted.rgba())
        .width(Size::px(TOKENS.bar.icon_size))
        .height(Size::px(TOKENS.bar.icon_size))
}

/// The one component used by both the layer-shell process and native preview.
pub fn bar_app() -> impl IntoElement {
    let left = rect()
        .width(Size::flex(1.0))
        .height(Size::fill())
        .horizontal()
        .cross_align(Alignment::Center)
        .main_align(Alignment::Start)
        .child(ActivitiesButton);

    let right = rect()
        .width(Size::flex(1.0))
        .height(Size::fill())
        .horizontal()
        .cross_align(Alignment::Center)
        .main_align(Alignment::End)
        .child(StatusPill);

    rect()
        .width(Size::fill())
        .height(Size::fill())
        .background(TOKENS.colours.surface.rgba())
        .padding((0.0, TOKENS.bar.horizontal_padding))
        .horizontal()
        .content(Content::Flex)
        .cross_align(Alignment::Center)
        .font_family(TOKENS.typography.family)
        .color(TOKENS.colours.text.rgba())
        .child(left)
        .child(ClockButton)
        .child(right)
}

/// Preview wrapper with default service snapshots.
pub fn bar_preview_app() -> impl IntoElement {
    use_provide_context(BarContext::create);
    bar_app()
}

#[derive(PartialEq)]
struct ActivitiesButton;

impl Component for ActivitiesButton {
    fn render(&self) -> impl IntoElement {
        rect()
            .height(Size::px(TOKENS.bar.control_height))
            .padding((0.0, TOKENS.bar.control_padding))
            .center()
            .child(
                label()
                    .text("Activities")
                    .font_size(TOKENS.typography.label_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            )
    }
}

#[derive(PartialEq)]
struct ClockButton;

fn clock_text() -> (String, String) {
    let now = Local::now();
    (now.format("%H:%M").to_string(), now.format("%a %-d %b").to_string())
}

impl Component for ClockButton {
    fn render(&self) -> impl IntoElement {
        let clock = use_hook(|| {
            let clock = State::create(clock_text());
            let mut writer = clock;
            let platform = Platform::get();
            spawn(async move {
                loop {
                    Timer::after(Duration::from_secs(10)).await;
                    writer.set(clock_text());
                    platform.send(UserEvent::RequestRedraw);
                }
            });
            clock
        });
        let (time, date) = clock.read().clone();

        rect()
            .height(Size::px(TOKENS.bar.control_height))
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(TOKENS.bar.module_gap)
            .padding((0.0, TOKENS.bar.control_padding))
            .child(
                label()
                    .text(time)
                    .font_size(TOKENS.typography.label_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            )
            .child(
                label()
                    .text(date)
                    .font_size(TOKENS.typography.small_size)
                    .color(TOKENS.colours.text_muted.rgba()),
            )
    }
}

#[derive(PartialEq)]
struct StatusPill;

impl Component for StatusPill {
    fn render(&self) -> impl IntoElement {
        let context = use_consume::<BarContext>();
        let audio = context.audio.read();
        let battery = context.battery.read();
        let network = context.network.read();

        let mut status = rect()
            .height(Size::px(TOKENS.bar.control_height))
            .horizontal()
            .cross_align(Alignment::Center)
            .spacing(TOKENS.bar.module_gap)
            .corner_radius(TOKENS.bar.radius)
            .padding((0.0, TOKENS.bar.control_padding))
            .background(TOKENS.colours.surface_elevated.rgba())
            .child(icon(icons::WIFI_HIGH))
            .child(icon(icons::SPEAKER_HIGH));

        if battery.present {
            status = status.child(icon(icons::BATTERY_HIGH)).child(
                label()
                    .text(format!("{}%", battery.percentage.round() as i64))
                    .font_size(TOKENS.typography.small_size)
                    .font_weight(TOKENS.typography.semibold_weight),
            );
        }

        if !network.available || !network.enabled || audio.muted {
            status = status.opacity(0.65);
        }

        status
    }
}

/// Keep compositor geometry beside the component that owns it.
pub fn surface_config() -> SurfaceConfig {
    SurfaceConfig::new(
        "kobel-bar",
        SurfaceSize::Exact {
            width: 0,
            height: SURFACE_HEIGHT,
        },
        PreferredTheme::Dark,
    )
    .anchor(Anchor::TOP | Anchor::LEFT | Anchor::RIGHT)
    .margins(Margins::default())
    .exclusive_zone(SURFACE_HEIGHT as i32)
    .keyboard_interactivity(KeyboardInteractivity::None)
}

#[cfg(test)]
mod tests {
    use freya_testing::launch_test;
    use kobel_services::{AudioSnapshot, BatterySnapshot, NetworkSnapshot, ServiceEvent};
    use kobel_wayland::{Anchor, KeyboardInteractivity, SurfaceSize};

    use super::{BarSnapshots, SURFACE_HEIGHT, bar_preview_app, surface_config};

    #[test]
    fn component_mounts_in_the_headless_runner() {
        let mut runner = launch_test(bar_preview_app);
        runner.sync_and_update();
    }

    #[test]
    fn latest_snapshots_survive_without_a_mounted_surface() {
        let audio = AudioSnapshot {
            volume: 0.42,
            muted: true,
            streams: Vec::new(),
        };
        let battery = BatterySnapshot {
            present: true,
            percentage: 73.0,
            charging: true,
            ..BatterySnapshot::default()
        };
        let network = NetworkSnapshot {
            available: true,
            enabled: true,
            active_ssid: Some("Kobel".to_string()),
            active_strength: 81,
            aps: Vec::new(),
        };

        let mut latest = BarSnapshots::default();
        latest.apply(&ServiceEvent::Audio(audio.clone()));
        latest.apply(&ServiceEvent::Battery(battery.clone()));
        latest.apply(&ServiceEvent::Network(network.clone()));

        assert_eq!(latest.audio, audio);
        assert_eq!(latest.battery, battery);
        assert_eq!(latest.network, network);
    }

    #[test]
    fn surface_spans_the_top_and_reserves_its_visual_height() {
        let config = surface_config();

        assert_eq!(
            config.size,
            SurfaceSize::Exact {
                width: 0,
                height: SURFACE_HEIGHT,
            }
        );
        assert_eq!(config.anchor, Anchor::TOP | Anchor::LEFT | Anchor::RIGHT);
        assert_eq!(config.exclusive_zone, SURFACE_HEIGHT as i32);
        assert_eq!(config.keyboard_interactivity, KeyboardInteractivity::None);
    }
}
