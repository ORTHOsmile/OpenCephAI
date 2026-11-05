//! CephTrace model catalogue and on-Mac conversion (spec 2026-10-01 Part 2). No network and no ONNX Runtime here.
pub mod catalog;
pub mod best;
pub mod fill;
pub mod fingerprint;
pub mod install;
pub mod linalg;
pub mod pointcheck;
pub mod pth;
pub mod regress;
pub mod scores;
pub mod shape;
pub mod source;
pub mod upgrade;
#[doc(hidden)] pub mod testing;
