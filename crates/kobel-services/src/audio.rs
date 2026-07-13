//! PulseAudio (pipewire-pulse) bridge: default sink volume/mute + the sink-input
//! list for the per-app mixer. The threaded mainloop runs on this dedicated
//! owner thread; all PA API calls stay here, and subscribe callbacks only
//! enqueue a Refresh (Context is Send+Sync but the Mainloop is Rc-backed).
//! See docs/FREYA-PLAN.md section 5.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};

use libpulse_binding::callbacks::ListResult;
use libpulse_binding::context::introspect::SinkInputInfo;
use libpulse_binding::context::subscribe::InterestMaskSet;
use libpulse_binding::context::{Context, FlagSet, State};
use libpulse_binding::mainloop::threaded::Mainloop;
use libpulse_binding::proplist::properties;
use libpulse_binding::volume::{ChannelVolumes, Volume};
use tokio::sync::mpsc::UnboundedSender;

use crate::ServiceEvent;

/// One sink-input (per-app playback stream) for the mixer.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioStream {
    pub id: u32,
    pub name: String,
    pub volume: f32,
    pub muted: bool,
}

/// Default-sink volume/mute plus the sink-input list.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioSnapshot {
    pub volume: f32,
    pub muted: bool,
    pub streams: Vec<AudioStream>,
}

pub(crate) enum AudioCommand {
    SetVolume(f32),
    SetMuted(bool),
    SetStreamVolume { id: u32, volume: f32 },
}

pub(crate) enum AudioMsg {
    Command(AudioCommand),
    Refresh,
    Shutdown,
}

// --- pure volume normalization (VOLUME_NORM based) -------------------------

/// Map a PA volume to a normalized f32 where 1.0 == VOLUME_NORM (100%).
fn normalize(volume: Volume) -> f32 {
    volume.0 as f32 / Volume::NORMAL.0 as f32
}

/// Inverse of `normalize`, clamped to [0, VOLUME_MAX].
fn denormalize(norm: f32) -> Volume {
    let raw = (norm.max(0.0) * Volume::NORMAL.0 as f32).round();
    Volume(raw.min(Volume::MAX.0 as f32) as u32)
}

// --- internal owner-thread state -------------------------------------------

struct AudioState {
    default_sink: Option<String>,
    sink_volume: f32,
    sink_muted: bool,
    sink_cv: Option<ChannelVolumes>,
    streams: Vec<AudioStream>,
    stream_cv: HashMap<u32, ChannelVolumes>,
    last_sent: Option<AudioSnapshot>,
    // Gate: hold snapshots until the default sink has been resolved once, so
    // the sink-input list callback never emits a bogus default volume first.
    sink_ready: bool,
}

impl AudioState {
    fn new() -> Self {
        Self {
            default_sink: None,
            sink_volume: 0.0,
            sink_muted: false,
            sink_cv: None,
            streams: Vec::new(),
            stream_cv: HashMap::new(),
            last_sent: None,
            sink_ready: false,
        }
    }
}

/// Coalescing gate for pulse subscribe events. Returns true only on the clean
/// -> pending transition, so a burst of events between owner-loop drains
/// enqueues exactly ONE `Refresh`. The owner loop clears the flag before it
/// introspects, re-arming exactly one follow-up for events during the pass.
fn should_enqueue_refresh(pending: &AtomicBool) -> bool {
    !pending.swap(true, Ordering::AcqRel)
}

pub(crate) fn run(
    events: UnboundedSender<ServiceEvent>,
    self_tx: Sender<AudioMsg>,
    rx: Receiver<AudioMsg>,
) {
    let mainloop = match Mainloop::new() {
        Some(mainloop) => Rc::new(RefCell::new(mainloop)),
        None => {
            tracing::error!("[audio] failed to create pulse mainloop");
            return;
        }
    };

    let context = match Context::new(&*mainloop.borrow(), "kobel-shell") {
        Some(context) => Rc::new(RefCell::new(context)),
        None => {
            tracing::error!("[audio] failed to create pulse context");
            return;
        }
    };

    // Signal the mainloop once the context settles.
    {
        let ml_ref = mainloop.clone();
        let ctx_ref = context.clone();
        context
            .borrow_mut()
            .set_state_callback(Some(Box::new(move || {
                let state = unsafe { (*ctx_ref.as_ptr()).get_state() };
                if matches!(state, State::Ready | State::Failed | State::Terminated) {
                    unsafe { (*ml_ref.as_ptr()).signal(false) };
                }
            })));
    }

    if let Err(e) = context
        .borrow_mut()
        .connect(None, FlagSet::NOFLAGS, None)
    {
        tracing::error!("[audio] context connect failed: {e:?}");
        return;
    }

    mainloop.borrow_mut().lock();
    if let Err(e) = mainloop.borrow_mut().start() {
        tracing::error!("[audio] mainloop start failed: {e:?}");
        mainloop.borrow_mut().unlock();
        return;
    }

    // Wait for the context to be ready (or bail).
    loop {
        match context.borrow().get_state() {
            State::Ready => break,
            State::Failed | State::Terminated => {
                tracing::error!("[audio] context failed before ready");
                mainloop.borrow_mut().unlock();
                mainloop.borrow_mut().stop();
                return;
            }
            _ => mainloop.borrow_mut().wait(),
        }
    }
    context.borrow_mut().set_state_callback(None);

    // Subscribe: any sink/sink-input/server event asks for a refresh, but a
    // burst collapses into ONE queued pass. `refresh_pending` is set on the
    // mainloop thread and cleared by the owner loop before it introspects, so
    // events arriving during a pass re-arm exactly one follow-up refresh.
    let refresh_pending = Arc::new(AtomicBool::new(false));
    {
        let tx = self_tx.clone();
        let pending = Arc::clone(&refresh_pending);
        context
            .borrow_mut()
            .set_subscribe_callback(Some(Box::new(move |_facility, _op, _index| {
                if should_enqueue_refresh(&pending) {
                    let _ = tx.send(AudioMsg::Refresh);
                }
            })));
    }
    context.borrow_mut().subscribe(
        InterestMaskSet::SINK | InterestMaskSet::SINK_INPUT | InterestMaskSet::SERVER,
        |_success| {},
    );
    mainloop.borrow_mut().unlock();

    let state = Rc::new(RefCell::new(AudioState::new()));

    // First snapshot.
    refresh(&mainloop, &context, &state, &events);
    tracing::info!("[audio] connected to pulse; watching default sink + sink-inputs");

    // Owner loop: drain refreshes/commands until shutdown.
    loop {
        match rx.recv() {
            Ok(AudioMsg::Refresh) => {
                // Clear before introspecting so any event during the pass
                // re-arms exactly one follow-up, never losing an update.
                refresh_pending.store(false, Ordering::Release);
                refresh(&mainloop, &context, &state, &events);
            }
            Ok(AudioMsg::Command(cmd)) => apply_command(&mainloop, &context, &state, cmd),
            Ok(AudioMsg::Shutdown) | Err(_) => break,
        }
    }

    // Clean shutdown: stop() must run with the mainloop UNLOCKED.
    mainloop.borrow_mut().lock();
    context.borrow_mut().disconnect();
    mainloop.borrow_mut().unlock();
    mainloop.borrow_mut().stop();
    tracing::info!("[audio] shut down");
}

/// Re-read server info (for the default sink), the default sink's volume/mute,
/// and the sink-input list. Runs under the mainloop lock; the async result
/// callbacks fire on the internal thread and emit via `maybe_emit`.
fn refresh(
    mainloop: &Rc<RefCell<Mainloop>>,
    context: &Rc<RefCell<Context>>,
    state: &Rc<RefCell<AudioState>>,
    events: &UnboundedSender<ServiceEvent>,
) {
    mainloop.borrow_mut().lock();
    let introspect = context.borrow().introspect();

    // server info -> default sink name -> that sink's volume/mute.
    {
        let ctx = context.clone();
        let st = state.clone();
        let ev = events.clone();
        introspect.get_server_info(move |info| {
            let name = info.default_sink_name.as_ref().map(|n| n.to_string());
            st.borrow_mut().default_sink = name.clone();
            let Some(name) = name else {
                // No default sink: mark resolved and emit the empty state.
                st.borrow_mut().sink_ready = true;
                maybe_emit(&st, &ev);
                return;
            };
            let st = st.clone();
            let ev = ev.clone();
            let introspect = unsafe { (*ctx.as_ptr()).introspect() };
            introspect.get_sink_info_by_name(&name, move |result| {
                if let ListResult::Item(sink) = result {
                    {
                        let mut s = st.borrow_mut();
                        s.sink_cv = Some(sink.volume);
                        s.sink_volume = normalize(sink.volume.max());
                        s.sink_muted = sink.mute;
                        s.sink_ready = true;
                    }
                    maybe_emit(&st, &ev);
                }
            });
        });
    }

    // sink-input list -> the mixer streams.
    {
        let st = state.clone();
        let ev = events.clone();
        let acc = Rc::new(RefCell::new(Vec::<AudioStream>::new()));
        let cvs = Rc::new(RefCell::new(HashMap::<u32, ChannelVolumes>::new()));
        introspect.get_sink_input_info_list(move |result| match result {
            ListResult::Item(input) => {
                acc.borrow_mut().push(AudioStream {
                    id: input.index,
                    name: stream_name(input),
                    volume: normalize(input.volume.max()),
                    muted: input.mute,
                });
                cvs.borrow_mut().insert(input.index, input.volume);
            }
            ListResult::End => {
                {
                    let mut s = st.borrow_mut();
                    s.streams = acc.borrow().clone();
                    s.stream_cv = cvs.borrow().clone();
                }
                maybe_emit(&st, &ev);
            }
            ListResult::Error => tracing::debug!("[audio] sink-input list error"),
        });
    }

    drop(introspect);
    mainloop.borrow_mut().unlock();
}

fn apply_command(
    mainloop: &Rc<RefCell<Mainloop>>,
    context: &Rc<RefCell<Context>>,
    state: &Rc<RefCell<AudioState>>,
    cmd: AudioCommand,
) {
    mainloop.borrow_mut().lock();
    let mut introspect = context.borrow().introspect();
    match cmd {
        AudioCommand::SetVolume(target) => {
            let (name, cv) = {
                let s = state.borrow();
                (s.default_sink.clone(), s.sink_cv)
            };
            match (name, cv) {
                (Some(name), Some(mut cv)) => {
                    cv.set(cv.len(), denormalize(target));
                    introspect.set_sink_volume_by_name(&name, &cv, None);
                }
                _ => tracing::debug!("[audio] SetVolume: no default sink yet"),
            }
        }
        AudioCommand::SetMuted(muted) => {
            if let Some(name) = state.borrow().default_sink.clone() {
                introspect.set_sink_mute_by_name(&name, muted, None);
            } else {
                tracing::debug!("[audio] SetMuted: no default sink yet");
            }
        }
        AudioCommand::SetStreamVolume { id, volume } => {
            let cv = state.borrow().stream_cv.get(&id).copied();
            match cv {
                Some(mut cv) => {
                    cv.set(cv.len(), denormalize(volume));
                    introspect.set_sink_input_volume(id, &cv, None);
                }
                None => tracing::debug!("[audio] SetStreamVolume: unknown stream {id}"),
            }
        }
    }
    drop(introspect);
    mainloop.borrow_mut().unlock();
}

/// Build the current snapshot and emit only if it differs from the last one.
fn maybe_emit(state: &Rc<RefCell<AudioState>>, events: &UnboundedSender<ServiceEvent>) {
    // Hold everything until the default sink has been resolved at least once.
    if !state.borrow().sink_ready {
        return;
    }
    let snapshot = {
        let s = state.borrow();
        AudioSnapshot {
            volume: s.sink_volume,
            muted: s.sink_muted,
            streams: s.streams.clone(),
        }
    };
    let mut s = state.borrow_mut();
    if s.last_sent.as_ref() == Some(&snapshot) {
        return;
    }
    s.last_sent = Some(snapshot.clone());
    drop(s);
    let _ = events.send(ServiceEvent::Audio(snapshot));
}

/// Prefer application.name, then media.name, then the stream's own name.
fn stream_name(input: &SinkInputInfo<'_>) -> String {
    input
        .proplist
        .get_str(properties::APPLICATION_NAME)
        .or_else(|| input.proplist.get_str(properties::MEDIA_NAME))
        .or_else(|| input.name.as_ref().map(|n| n.to_string()))
        .unwrap_or_else(|| format!("stream {}", input.index))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_endpoints() {
        assert_eq!(normalize(Volume::MUTED), 0.0);
        assert!((normalize(Volume::NORMAL) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn denormalize_endpoints() {
        assert_eq!(denormalize(0.0), Volume::MUTED);
        assert_eq!(denormalize(1.0), Volume::NORMAL);
    }

    #[test]
    fn roundtrip_is_stable() {
        for pct in [0.0f32, 0.1, 0.25, 0.5, 0.73, 1.0] {
            let back = normalize(denormalize(pct));
            assert!((back - pct).abs() < 1e-3, "pct {pct} -> {back}");
        }
    }

    #[test]
    fn clamps_below_zero() {
        assert_eq!(denormalize(-1.0), Volume::MUTED);
    }

    #[test]
    fn clamps_above_max() {
        assert!(denormalize(1000.0).0 <= Volume::MAX.0);
    }

    #[test]
    fn subscribe_events_coalesce_into_one_refresh() {
        let pending = AtomicBool::new(false);
        // A burst of five events between drains enqueues exactly one Refresh.
        let enqueued = (0..5).filter(|_| should_enqueue_refresh(&pending)).count();
        assert_eq!(enqueued, 1, "a burst coalesces into a single queued refresh");
        // The owner loop clears the flag before introspecting; the next event
        // then re-arms exactly one follow-up, and no more until cleared again.
        pending.store(false, Ordering::Release);
        assert!(should_enqueue_refresh(&pending), "first event after a drain re-arms");
        assert!(
            !should_enqueue_refresh(&pending),
            "further events in the same window are coalesced"
        );
    }
}
