// frame.rs -- frame scheduling primitives.
//
// Two concerns live here:
//   * RunnerWaker: a std Waker that pings a calloop source. We poll each surface's
//     Freya runner with a Context built from this waker so that when a spawned task
//     (e.g. freya-animation's ticker/Timer loop) later becomes ready while the loop
//     is otherwise idle, its wake enqueues a message on the runner's channel, which
//     wakes *our* waker, which pings calloop back awake to pump the runner. Without
//     this, animations and delayed tasks stall once the event loop blocks. This
//     mirrors freya-winit's PollRunner + EventLoopProxy waker.
//   * FrameClock: tracks inter-present timing for the fps/frame-time readouts.

use std::sync::Arc;
use std::task::Waker;
use std::time::Instant;

use calloop::ping::Ping;
use futures_util::task::{ArcWake, waker};

/// Wraps a calloop [`Ping`]; waking it schedules another runner pump on the loop.
struct RunnerWaker {
    ping: Ping,
}

impl ArcWake for RunnerWaker {
    fn wake_by_ref(arc_self: &Arc<Self>) {
        arc_self.ping.ping();
    }
}

/// Build a [`Waker`] that pings `ping` when woken. `Ping` is `Send + Sync`, so the
/// wake may originate on a foreign thread (e.g. an async-io timer reactor).
pub fn runner_waker(ping: Ping) -> Waker {
    waker(Arc::new(RunnerWaker { ping }))
}

/// Rolling frame-time / fps tracker. `tick()` is called once per presented frame.
pub struct FrameClock {
    last_present: Option<Instant>,
    // Exponential moving average of fps for a stable readout.
    fps_ema: f32,
}

impl FrameClock {
    pub fn new() -> Self {
        Self { last_present: None, fps_ema: 0.0 }
    }

    /// Record a present. Returns the milliseconds elapsed since the previous one
    /// (0.0 for the first frame).
    pub fn tick(&mut self) -> f32 {
        let now = Instant::now();
        let dt = self.last_present.map(|t| now.duration_since(t).as_secs_f32() * 1000.0);
        self.last_present = Some(now);
        if let Some(ms) = dt
            && ms > 0.0 {
                let inst = 1000.0 / ms;
                self.fps_ema = if self.fps_ema == 0.0 { inst } else { self.fps_ema * 0.9 + inst * 0.1 };
            }
        dt.unwrap_or(0.0)
    }

    pub fn fps(&self) -> f32 {
        self.fps_ema
    }
}

impl Default for FrameClock {
    fn default() -> Self {
        Self::new()
    }
}
