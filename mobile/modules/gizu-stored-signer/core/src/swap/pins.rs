//! Mainnet addresses the swap policy accepts. A provider payload naming anything else is rejected.
use alloy_primitives::{Address, address};

pub const MONAD_CHAIN_ID: u64 = 143;
pub const ROBINHOOD_CHAIN_ID: u64 = 4663;
pub const MONAD_RPC: &str = "https://rpc.monad.xyz";
pub const ROBINHOOD_RPC: &str = "https://rpc.mainnet.chain.robinhood.com";

pub const MONAD_USDC: Address = address!("0x754704bc059f8c67012fed69bc8a327a5aafb603");
pub const ENTRY_POINT_V08: Address = address!("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108");
pub const SIMPLE_7702: Address = address!("0xe6Cae83BdE06E4c305530e199D7217f42808555B");
pub const PIMLICO_ERC20_PAYMASTER: Address = address!("0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402");
pub const CONFIDENTIAL_CONTRACT: &str = "intents.far";
pub const AUTH_VERIFYING_CONTRACT: &str = "intents.near";
pub const ROBINHOOD_USDG: Address = address!("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
pub const ONEINCH_LOP: Address = address!("0x5A705DE8982235a7fa45bB83dCaCf03a211389C7");
pub const FUSION_SETTLEMENT: Address = address!("0xb55ba9617dafae1236313c3cb7806439ceefbd13");

pub const USDC_DECIMALS: u8 = 6;
// Numeric representability bound; production budgets have no ten-USDC test cap.
pub const MAX_SOURCE_ATOMS: u64 = u64::MAX;
pub const QUOTE_SLIPPAGE_BPS: u32 = 100;
pub const FUSION_SLIPPAGE_BPS: u64 = 100;
pub const PERMIT_LIFETIME_SECS: u64 = 3_600;
pub const SESSION_MS: u64 = 900_000;
pub const OPERATION_MS: u64 = 24 * 3_600_000;
