/** Circle's native USDC deployment; never infer a token from its symbol alone. */
export const monadUsdc = {
  chainId: 143,
  network: "Monad mainnet",
  symbol: "USDC",
  decimals: 6,
  contract: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  rpcUrl: "https://rpc.monad.xyz",
} as const;

/** Retained solely for existing testnet transfer diagnostics. */
export const monadTestnetMon = {
  chainId: 10143,
  network: "Monad testnet",
  symbol: "MON",
  decimals: 18,
} as const;
