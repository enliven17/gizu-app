//! Swap policy: Monad USDC -> Aurora public bridge -> Robinhood USDG -> 1inch Fusion stock. Sell still uses C.
pub mod aurora;
mod engine;
pub mod evm;
pub mod funding;
pub mod fusion;
pub mod pins;
pub use engine::{SwapOperation, SwapStep};
