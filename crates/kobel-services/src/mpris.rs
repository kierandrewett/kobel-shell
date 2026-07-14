//! MPRIS media service: active-player snapshot + native control (no playerctl
//! shelling -- docs/FREYA-PLAN.md section 5). CONTRACT TYPES are stable; the
//! machinery behind them is implemented by the mpris service task (phase 3).

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream::BoxStream;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::task::JoinHandle;
use zbus::fdo::{DBusProxy, PropertiesProxy};
use zbus::names::InterfaceName;
use zbus::proxy::CacheProperties;
use zbus::zvariant::OwnedValue;
use zbus::{Connection, proxy};

use crate::ServiceEvent;

/// MPRIS well-known name prefix; every player owns `org.mpris.MediaPlayer2.<x>`.
const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
/// The object path every MPRIS player exposes.
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
/// The player-control interface we proxy for status/metadata/position/control.
const PLAYER_INTERFACE: &str = "org.mpris.MediaPlayer2.Player";

/// The player the shell surfaces should show: the playing player if any, else
/// the first available. `None` when no MPRIS player is on the bus.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MediaSnapshot {
    pub player: Option<PlayerInfo>,
}

/// Snapshot of one MPRIS player.
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerInfo {
    /// Bus name, e.g. `org.mpris.MediaPlayer2.spotify`.
    pub bus_name: String,
    pub playing: bool,
    pub title: String,
    pub artist: String,
    /// Local art file when the art URL is a file:// path (remote art is not
    /// fetched by this service).
    pub art_path: Option<PathBuf>,
    pub position_secs: f64,
    /// Zero when the player does not report a length.
    pub length_secs: f64,
}

/// Command routed to the mpris task; acts on the active player.
pub(crate) enum MprisCommand {
    PlayPause,
    Next,
    Previous,
}

#[proxy(
    interface = "org.mpris.MediaPlayer2.Player",
    default_path = "/org/mpris/MediaPlayer2"
)]
trait Player {
    fn play_pause(&self) -> zbus::Result<()>;
    fn next(&self) -> zbus::Result<()>;
    fn previous(&self) -> zbus::Result<()>;

    #[zbus(property)]
    fn playback_status(&self) -> zbus::Result<String>;
    #[zbus(property)]
    fn metadata(&self) -> zbus::Result<HashMap<String, OwnedValue>>;
    #[zbus(property)]
    fn position(&self) -> zbus::Result<i64>;

    #[zbus(signal)]
    fn seeked(&self, position: i64) -> zbus::Result<()>;
}

/// One tracked player: its watcher task and latest snapshot (None until the
/// task delivers its first read).
struct PlayerSlot {
    handle: JoinHandle<()>,
    info: Option<PlayerInfo>,
}

/// MPRIS aggregator task. Discovers players (ListNames + NameOwnerChanged),
/// spawns a watcher per player, folds their updates into the active-player
/// snapshot, and routes control commands.
pub(crate) async fn run(events: UnboundedSender<ServiceEvent>, mut cmd_rx: UnboundedReceiver<MprisCommand>) {
    let conn = match Connection::session().await {
        Ok(conn) => conn,
        Err(e) => {
            tracing::warn!("[mpris] no session bus: {e}");
            let _ = events.send(ServiceEvent::Media(MediaSnapshot::default()));
            return;
        }
    };
    let dbus = match DBusProxy::new(&conn).await {
        Ok(dbus) => dbus,
        Err(e) => {
            tracing::warn!("[mpris] DBus proxy: {e}");
            let _ = events.send(ServiceEvent::Media(MediaSnapshot::default()));
            return;
        }
    };

    // Per-player watchers push (bus_name, PlayerInfo) here.
    let (upd_tx, mut upd_rx) = unbounded_channel::<(String, PlayerInfo)>();
    let mut slots: HashMap<String, PlayerSlot> = HashMap::new();
    // Discovery order: "first present" must be deterministic, and HashMap
    // iteration is not, so track appearance order explicitly.
    let mut order: Vec<String> = Vec::new();
    let mut last = MediaSnapshot::default();
    let mut active: Option<String> = None;

    let mut name_changes: BoxStream<'static, _> = match dbus.receive_name_owner_changed().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[mpris] name-owner watch failed: {e}");
            futures_util::stream::pending().boxed()
        }
    };

    match dbus.list_names().await {
        Ok(names) => {
            for name in names {
                let name = name.as_str();
                if name.starts_with(MPRIS_PREFIX) {
                    spawn_player(&conn, name, &upd_tx, &mut slots, &mut order);
                }
            }
        }
        Err(e) => tracing::warn!("[mpris] ListNames failed: {e}"),
    }
    tracing::info!("[mpris] tracking {} player(s) at startup", slots.len());
    // Baseline emit so the UI has an initial (possibly empty) snapshot; real
    // content follows as watchers deliver their first reads.
    let _ = events.send(ServiceEvent::Media(MediaSnapshot::default()));

    loop {
        tokio::select! {
            Some(signal) = name_changes.next() => {
                if let Ok(args) = signal.args() {
                    let name = args.name().as_str();
                    if name.starts_with(MPRIS_PREFIX) {
                        let name = name.to_owned();
                        // Owner change: drop any existing slot, then respawn if a
                        // new owner is present. Covers appear, vanish and restart.
                        if let Some(slot) = slots.remove(&name) {
                            slot.handle.abort();
                            order.retain(|n| n != &name);
                            tracing::info!("[mpris] dropped player {name}");
                        }
                        if args.new_owner().as_ref().is_some() {
                            spawn_player(&conn, &name, &upd_tx, &mut slots, &mut order);
                        }
                        emit_if_changed(&events, &slots, &order, &mut last, &mut active);
                    }
                }
            }
            Some((bus, info)) = upd_rx.recv() => {
                if let Some(slot) = slots.get_mut(&bus) {
                    slot.info = Some(info);
                    emit_if_changed(&events, &slots, &order, &mut last, &mut active);
                }
                // else: update from an already-removed player; ignore.
            }
            Some(cmd) = cmd_rx.recv() => {
                // A hung/frozen player (an unresponsive PlayPause/Next/
                // Previous call) would otherwise block this whole select! --
                // including discovery of NEW players (name_changes) and
                // snapshot updates from OTHER already-tracked players
                // (upd_rx) -- for as long as the bad player stays wedged.
                // crate::with_command_timeout bounds it so one frozen player
                // degrades to "this control did nothing", not "the whole
                // media service stalled".
                crate::with_command_timeout("mpris", handle_command(&conn, active.as_deref(), cmd)).await;
            }
            else => break,
        }
    }

    for slot in slots.into_values() {
        slot.handle.abort();
    }
}

/// Spawn a watcher task for `bus_name` unless already tracked.
fn spawn_player(
    conn: &Connection,
    bus_name: &str,
    updates: &UnboundedSender<(String, PlayerInfo)>,
    slots: &mut HashMap<String, PlayerSlot>,
    order: &mut Vec<String>,
) {
    if slots.contains_key(bus_name) {
        return;
    }
    let handle = tokio::spawn(player_task(conn.clone(), bus_name.to_owned(), updates.clone()));
    slots.insert(bus_name.to_owned(), PlayerSlot { handle, info: None });
    order.push(bus_name.to_owned());
    tracing::info!("[mpris] tracking player {bus_name}");
}

/// Choose the active player (first Playing, else first present, in discovery
/// order) and emit `ServiceEvent::Media` when the snapshot changed.
fn emit_if_changed(
    events: &UnboundedSender<ServiceEvent>,
    slots: &HashMap<String, PlayerSlot>,
    order: &[String],
    last: &mut MediaSnapshot,
    active: &mut Option<String>,
) {
    let snapshot = recompute(slots, order);
    *active = snapshot.player.as_ref().map(|p| p.bus_name.clone());
    if snapshot != *last {
        *last = snapshot.clone();
        let _ = events.send(ServiceEvent::Media(snapshot));
    }
}

fn recompute(slots: &HashMap<String, PlayerSlot>, order: &[String]) -> MediaSnapshot {
    let infos = order
        .iter()
        .map(|name| slots.get(name).and_then(|slot| slot.info.as_ref()));
    MediaSnapshot {
        player: pick_active(infos).cloned(),
    }
}

/// Pure priority selection: given player snapshots in discovery order (`None`
/// where a slot exists but its watcher hasn't delivered a first read yet),
/// pick the first Playing one, or the first present (possibly-paused) one if
/// none are playing, or `None` if nothing is present at all. Extracted from
/// [`recompute`] so the actual selection priority is unit-testable without
/// `PlayerSlot`'s real `JoinHandle` (which needs a live tokio runtime to
/// construct).
fn pick_active<'a>(infos: impl Iterator<Item = Option<&'a PlayerInfo>>) -> Option<&'a PlayerInfo> {
    let mut first_present: Option<&PlayerInfo> = None;
    let mut first_playing: Option<&PlayerInfo> = None;
    for info in infos.flatten() {
        if first_present.is_none() {
            first_present = Some(info);
        }
        if info.playing {
            first_playing = Some(info);
            break;
        }
    }
    first_playing.or(first_present)
}

async fn handle_command(conn: &Connection, active: Option<&str>, cmd: MprisCommand) {
    let Some(bus) = active else {
        tracing::debug!("[mpris] command ignored: no active player");
        return;
    };
    let Some(proxy) = build_player_proxy(conn, bus).await else {
        return;
    };
    let result = match cmd {
        MprisCommand::PlayPause => proxy.play_pause().await,
        MprisCommand::Next => proxy.next().await,
        MprisCommand::Previous => proxy.previous().await,
    };
    if let Err(e) = result {
        tracing::warn!("[mpris] control command failed on {bus}: {e}");
    }
}

/// Watch one player: initial read, then re-read on PropertiesChanged / Seeked
/// and refresh Position on a 1s tick while Playing (Position is excluded from
/// PropertiesChanged by the MPRIS spec, so it must be polled).
async fn player_task(conn: Connection, bus_name: String, updates: UnboundedSender<(String, PlayerInfo)>) {
    let Some(proxy) = build_player_proxy(&conn, &bus_name).await else {
        return;
    };
    let props = match PropertiesProxy::builder(&conn)
        .destination(bus_name.clone())
        .and_then(|b| b.path(MPRIS_PATH))
    {
        Ok(builder) => match builder.build().await {
            Ok(props) => props,
            Err(e) => {
                tracing::warn!("[mpris] {bus_name}: properties proxy: {e}");
                return;
            }
        },
        Err(e) => {
            tracing::warn!("[mpris] {bus_name}: bad properties address: {e}");
            return;
        }
    };

    let mut info = read_player_info(&proxy, &bus_name).await;
    let _ = updates.send((bus_name.clone(), info.clone()));

    let player_iface = InterfaceName::try_from(PLAYER_INTERFACE).expect("valid interface");
    let mut changes: BoxStream<'static, _> = match props.receive_properties_changed().await {
        Ok(stream) => stream.boxed(),
        Err(e) => {
            tracing::warn!("[mpris] {bus_name}: PropertiesChanged watch: {e}");
            futures_util::stream::pending().boxed()
        }
    };
    let mut seeked: BoxStream<'static, Seeked> = match proxy.receive_seeked().await {
        Ok(stream) => stream.boxed(),
        Err(_) => futures_util::stream::pending().boxed(),
    };
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    tick.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            Some(signal) = changes.next() => {
                if let Ok(args) = signal.args()
                    && args.interface_name != player_iface {
                        continue;
                    }
                let next = read_player_info(&proxy, &bus_name).await;
                if next != info {
                    info = next;
                    let _ = updates.send((bus_name.clone(), info.clone()));
                }
            }
            Some(_) = seeked.next() => {
                let position_secs = read_position(&proxy).await;
                if position_secs != info.position_secs {
                    info.position_secs = position_secs;
                    let _ = updates.send((bus_name.clone(), info.clone()));
                }
            }
            _ = tick.tick() => {
                if info.playing {
                    let position_secs = read_position(&proxy).await;
                    if position_secs != info.position_secs {
                        info.position_secs = position_secs;
                        let _ = updates.send((bus_name.clone(), info.clone()));
                    }
                }
            }
            else => break,
        }
    }
}

async fn build_player_proxy(conn: &Connection, bus_name: &str) -> Option<PlayerProxy<'static>> {
    let builder = match PlayerProxy::builder(conn).destination(bus_name.to_owned()) {
        Ok(builder) => builder,
        Err(e) => {
            tracing::warn!("[mpris] {bus_name}: bad bus name: {e}");
            return None;
        }
    };
    // Caching off: Position/Metadata must be read live (Position never appears
    // in PropertiesChanged), matching the battery service's rationale.
    match builder.cache_properties(CacheProperties::No).build().await {
        Ok(proxy) => Some(proxy),
        Err(e) => {
            tracing::warn!("[mpris] {bus_name}: player proxy: {e}");
            None
        }
    }
}

async fn read_player_info(proxy: &PlayerProxy<'_>, bus_name: &str) -> PlayerInfo {
    let status = proxy.playback_status().await.unwrap_or_default();
    let metadata = proxy.metadata().await.unwrap_or_default();
    let (title, artist, art_path, length_secs) = decode_metadata(metadata);
    PlayerInfo {
        bus_name: bus_name.to_owned(),
        playing: status == "Playing",
        title,
        artist,
        art_path,
        position_secs: read_position(proxy).await,
        length_secs,
    }
}

async fn read_position(proxy: &PlayerProxy<'_>) -> f64 {
    proxy.position().await.map(micros_to_secs).unwrap_or(0.0)
}

/// Decode an MPRIS metadata dict into (title, artist, art_path, length_secs).
fn decode_metadata(mut meta: HashMap<String, OwnedValue>) -> (String, String, Option<PathBuf>, f64) {
    let title = meta
        .remove("xesam:title")
        .and_then(|v| String::try_from(v).ok())
        .unwrap_or_default();
    let artist = meta.remove("xesam:artist").and_then(first_artist).unwrap_or_default();
    let art_path = meta
        .remove("mpris:artUrl")
        .and_then(|v| String::try_from(v).ok())
        .and_then(art_url_to_path);
    let length_secs = meta
        .remove("mpris:length")
        .and_then(length_micros)
        .map(micros_to_secs)
        .unwrap_or(0.0);
    (title, artist, art_path, length_secs)
}

/// `xesam:artist` is normally an array of strings; take the first non-empty
/// entry. Some players send a plain string instead, so fall back to that.
fn first_artist(value: OwnedValue) -> Option<String> {
    if let Ok(clone) = value.try_clone()
        && let Ok(list) = Vec::<String>::try_from(clone)
        && let Some(first) = list.into_iter().find(|s| !s.is_empty())
    {
        return Some(first);
    }
    String::try_from(value).ok().filter(|s| !s.is_empty())
}

/// `mpris:length` is microseconds, usually `x` (i64) but occasionally `t`
/// (u64). Never negative: a negative i64 straight off the wire, or a u64
/// above `i64::MAX` that an unchecked `as` cast would wrap into a negative
/// i64, both have no valid microsecond-length meaning here -- rejected
/// (`None`, "no length reported") rather than exposed as a garbage negative
/// track length.
fn length_micros(value: OwnedValue) -> Option<i64> {
    if let Ok(n) = i64::try_from(&value) {
        return (n >= 0).then_some(n);
    }
    u64::try_from(&value).ok().and_then(|n| i64::try_from(n).ok())
}

fn micros_to_secs(micros: i64) -> f64 {
    micros as f64 / 1_000_000.0
}

/// Convert a `file://` art URL to a local path (percent-decoded). Remote art
/// (http/https, e.g. Spotify) is not fetched, so returns None.
fn art_url_to_path(url: String) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode(rest)))
}

/// Minimal percent-decoder for file:// paths (handles %XX escapes like %20).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use zbus::zvariant::Value;

    use super::*;

    fn owned(v: impl Into<Value<'static>>) -> OwnedValue {
        OwnedValue::try_from(v.into()).expect("value converts")
    }

    #[test]
    fn first_artist_takes_the_first_non_empty_entry_from_a_list() {
        let list = vec!["".to_string(), "Radiohead".to_string(), "Thom Yorke".to_string()];
        assert_eq!(first_artist(owned(list)), Some("Radiohead".to_string()));
    }

    #[test]
    fn first_artist_falls_back_to_a_plain_string() {
        // Some players send xesam:artist as a bare string instead of an array.
        assert_eq!(
            first_artist(owned("Boards of Canada")),
            Some("Boards of Canada".to_string())
        );
    }

    #[test]
    fn first_artist_none_for_an_all_empty_list_or_empty_string() {
        assert_eq!(first_artist(owned(vec!["".to_string(), "".to_string()])), None);
        assert_eq!(first_artist(owned("")), None);
    }

    #[test]
    fn length_micros_reads_i64_and_falls_back_to_u64() {
        assert_eq!(length_micros(owned(240_000_000_i64)), Some(240_000_000));
        // Some players send mpris:length as u64 (`t`) instead of i64 (`x`).
        assert_eq!(length_micros(owned(240_000_000_u64)), Some(240_000_000));
    }

    #[test]
    fn length_micros_rejects_negative_values_from_either_representation() {
        // A negative i64 straight off the wire (buggy/hostile player) has no
        // valid microsecond-length meaning -- must not surface as a negative
        // track length.
        assert_eq!(length_micros(owned(-1_i64)), None);
        assert_eq!(length_micros(owned(i64::MIN)), None);
        // A u64 mpris:length above i64::MAX has no valid representation as
        // microseconds here; the old `as i64` cast wrapped it into a negative
        // number (a garbage, visibly-wrong track length) instead of rejecting
        // it. u64::MAX itself, and the smallest out-of-range value, both.
        assert_eq!(length_micros(owned(u64::MAX)), None);
        assert_eq!(length_micros(owned(i64::MAX as u64 + 1)), None);
        // The boundary value (exactly i64::MAX) is still valid.
        assert_eq!(length_micros(owned(i64::MAX as u64)), Some(i64::MAX));
        // Zero (a player reporting an unknown/zero length) is valid, not negative.
        assert_eq!(length_micros(owned(0_i64)), Some(0));
    }

    #[test]
    fn length_micros_none_for_a_non_numeric_value() {
        assert_eq!(length_micros(owned("not a number")), None);
    }

    #[test]
    fn micros_to_secs_divides_by_a_million() {
        assert_eq!(micros_to_secs(240_000_000), 240.0);
        assert_eq!(micros_to_secs(0), 0.0);
        assert_eq!(micros_to_secs(1_500_000), 1.5);
    }

    #[test]
    fn percent_decode_handles_spaces_and_multiple_escapes() {
        assert_eq!(percent_decode("My%20Song%20-%20Artist"), "My Song - Artist");
        assert_eq!(percent_decode("no-escapes-here"), "no-escapes-here");
    }

    #[test]
    fn percent_decode_falls_back_to_literal_on_truncated_or_invalid_escapes() {
        // A trailing '%' with too few following bytes for a full escape.
        assert_eq!(percent_decode("truncated%2"), "truncated%2");
        assert_eq!(percent_decode("truncated%"), "truncated%");
        // Non-hex digits after '%' aren't a valid escape.
        assert_eq!(percent_decode("bad%zzescape"), "bad%zzescape");
    }

    #[test]
    fn percent_decode_handles_an_escape_at_the_very_end() {
        assert_eq!(percent_decode("file%20"), "file ");
    }

    #[test]
    fn art_url_to_path_strips_file_scheme_and_decodes() {
        assert_eq!(
            art_url_to_path("file:///home/x/My%20Song.jpg".to_string()),
            Some(PathBuf::from("/home/x/My Song.jpg"))
        );
    }

    #[test]
    fn art_url_to_path_none_for_remote_schemes() {
        // http(s) art (e.g. Spotify) isn't fetched.
        assert_eq!(art_url_to_path("https://example.com/art.jpg".to_string()), None);
    }

    fn info(bus: &str, playing: bool) -> PlayerInfo {
        PlayerInfo {
            bus_name: bus.to_string(),
            playing,
            title: String::new(),
            artist: String::new(),
            art_path: None,
            position_secs: 0.0,
            length_secs: 0.0,
        }
    }

    #[test]
    fn pick_active_none_when_nothing_present() {
        assert_eq!(pick_active([None, None].into_iter()), None);
        assert_eq!(pick_active(std::iter::empty()), None);
    }

    #[test]
    fn pick_active_falls_back_to_first_present_when_nothing_playing() {
        let a = info("a", false);
        let b = info("b", false);
        // Neither playing: the FIRST present one wins, in order.
        assert_eq!(pick_active([None, Some(&a), Some(&b)].into_iter()), Some(&a));
    }

    #[test]
    fn pick_active_prefers_a_later_playing_player_over_an_earlier_paused_one() {
        let paused = info("paused", false);
        let playing = info("playing", true);
        // "paused" appears first in discovery order but is not playing;
        // "playing" appears later but wins -- playing always beats present.
        assert_eq!(pick_active([Some(&paused), Some(&playing)].into_iter()), Some(&playing));
    }

    #[test]
    fn pick_active_returns_the_first_playing_one_when_several_are_playing() {
        let first = info("first", true);
        let second = info("second", true);
        assert_eq!(pick_active([Some(&first), Some(&second)].into_iter()), Some(&first));
    }

    #[test]
    fn pick_active_skips_not_yet_reported_slots() {
        // A slot exists (tracked in `order`) but its watcher hasn't delivered
        // a first read yet (`None`) -- must not be mistaken for "present".
        let b = info("b", false);
        assert_eq!(pick_active([None, Some(&b)].into_iter()), Some(&b));
    }
}
