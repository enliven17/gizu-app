/**
 * Temporary debug mode for old balances that are too small to sell through Aurora: each holder
 * wallet's tokens are sold with Fusion and the USDG is paid straight to this public address
 * (Robinhood Chain). Only development builds expose it, and the native review shows the address
 * before a passkey approval. Remove once no old balances remain.
 */
export const DEBUG_SWEEP_ADDRESS = "0x4b4FC9122E79C06e279FD8E3c612056ea61c856F";
/** Off in swap demo mode: a demo shows only what users get. */
export const DEBUG_SWEEP_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_SWAP_DEMO !== "1";
