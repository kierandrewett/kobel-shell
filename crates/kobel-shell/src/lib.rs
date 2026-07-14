//! Core shell coordination for kobel UI implementations.
//!
//! This crate owns the stable interface between a concrete UI and the rest of the
//! shell: [`manager`] coordinates surface visibility and service commands, [`ipc`]
//! serves `kobelctl` requests, and [`motion`] provides interruptible spring
//! primitives. It deliberately contains no surfaces, theme, icons, or concrete
//! Freya elements.
//!
//! UI implementations should depend on this crate together with `kobel-wayland`
//! for the embedded Freya host and `kobel-services` for system state snapshots.

pub mod ipc;
pub mod manager;
pub mod motion;

pub use manager::{CommandSink, Manager, RevealHost, RevealMotion, ShellBus, ShellMsg, SurfaceKey};
pub use motion::{SpringSim, SpringSpec, UseSpring, reduced_motion, set_reduced_motion, use_spring};
