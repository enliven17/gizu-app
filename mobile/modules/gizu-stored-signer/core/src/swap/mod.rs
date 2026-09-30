//! Confidential swap policy: Monad USDC -> Aurora confidential balance -> Robinhood USDG -> 1inch Fusion stock, and the reverse for sells.
pub mod allocation;
pub mod aurora;
mod engine;
pub mod evm;
pub mod funding;
pub mod fusion;
pub mod pins;
pub use engine::{SwapOperation, SwapStep};
