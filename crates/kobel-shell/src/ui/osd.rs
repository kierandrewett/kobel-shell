//! OSD -- display-only volume pill above the dock (ags/widget/OSD.tsx).
//!
//! The one sanctioned translucency (DESIGN.md "Elevation & translucency"):
//! `rgba(16,13,20,0.82)`, contingent on a gnoblin blur window-rule. A ~230px row:
//! speaker glyph, a CHIP-track / LEAF-fill level bar (8px), and a tabular percent
//! label with a fixed min-width so the digits never shift.
//!
//! Visibility is opacity-driven. The first `AudioSnapshot` is baselined silently;
//! only a change to the *default sink* volume or mute (stream-list churn from the
//! mixer is deliberately excluded) reveals the pill. It is display-only: no
//! handlers, and the host gives the surface an empty input region (click-through).

use freya_core::prelude::*;
use torin::prelude::{Alignment, Size};

use kobel_services::AudioSnapshot;

use super::{ICON_SPEAKER_MUTE, ICON_SPEAKER_WAVE, icon};
use crate::motion::{self, use_spring};
use crate::theme;

/// The OSD volume pill. Returns a full-surface, click-through overlay that centers
/// the translucent pill; the pill's opacity springs to 1 on a volume/mute change.
pub fn osd() -> impl IntoElement {
    let audio = use_consume::<State<AudioSnapshot>>();
    let mut opacity = use_spring(0.0);
    let mut seeded = use_state(|| false);

    let (volume, muted) = {
        let a = audio.read();
        (a.volume, a.muted)
    };

    // Reveal only when the default-sink volume or mute *changes* vs the previous
    // snapshot. The dependency intentionally excludes `streams`, so per-app mixer
    // changes never flash the OSD (fixes the AGS mute-change gap: mute is in here).
    let dep = (volume.to_bits(), muted);
    use_side_effect_with_deps(&dep, move |_| {
        if !*seeded.peek() {
            // Baseline the first snapshot silently -- no reveal on startup.
            seeded.set(true);
            return;
        }
        opacity.to(1.0, motion::PANEL_OPACITY);
        // TODO(async-timer): restart a 1400ms auto-hide (opacity.to(0.0, ...)).
        // Blocked on a freya-task wall-clock timer -- see the module TODO below.
    });

    // Volume is normalized (1.0 == 100%); AGS caps the display at 100%.
    let level = (volume.clamp(0.0, 1.0) * 100.0).round();
    let speaker = if muted || volume <= 0.0 {
        ICON_SPEAKER_MUTE
    } else {
        ICON_SPEAKER_WAVE
    };
    let osd_bg = Color::from_af32rgb(0.82, 16, 13, 20);

    // Continuous level bar: CHIP track, LEAF fill sized to the volume fraction.
    let track = rect()
        .width(Size::flex(1.0))
        .height(Size::px(8.0))
        .corner_radius(theme::RADIUS_PILL)
        .background(theme::CHIP.rgb())
        .child(
            rect()
                .width(Size::percent(level))
                .height(Size::px(8.0))
                .corner_radius(theme::RADIUS_PILL)
                .background(theme::LEAF.rgb()),
        );

    let pill = rect()
        .horizontal()
        .width(Size::px(230.0))
        .cross_align(Alignment::Center)
        .spacing(11.0)
        .padding((10.0, 15.0))
        .corner_radius(theme::RADIUS_PILL)
        .background(osd_bg)
        .opacity(opacity.value())
        .child(icon(speaker, 15.0, theme::TX))
        .child(track)
        .child(
            label()
                .text(format!("{}%", level as i64))
                .color(theme::TX.rgb())
                .font_size(11.0)
                .font_weight(theme::FONT_WEIGHT_SEMIBOLD as i32)
                .font_family(theme::FONT_FAMILY_DATA)
                .min_width(Size::px(34.0))
                .text_align(TextAlign::Right),
        );

    // Full-surface overlay that centers the pill; transparent, so the surface is
    // effectively invisible while the pill's opacity is 0.
    rect().expanded().center().child(pill)
}
