import { ROBINHOOD_PROFILE } from "../../../src/adapters/earn/robinhood-vault.ts";
export const owner = "0x1000000000000000000000000000000000000001" as const;
export const state = {
  owner,
  block: {
    number: 10n,
    hash: "0x" + "a".repeat(64),
    timestamp: 1000n,
    baseFeePerGas: 1n,
    gasUsed: 1n,
    gasLimit: 2n,
  },
  token: 1000000n,
  shares: 0n,
  native: 0n,
  wrappedNative: 0n,
  nonce: 0n,
  ownerCode: "0x",
  shareDecimals: 18,
};
const simulation = {
  shares: 100n,
  previewShares: 100n,
  maxSharePrice: 1n,
  depositCalls: [
    { to: ROBINHOOD_PROFILE.router, data: "0x12" as const, value: 0n },
  ],
  withdrawalCalls: [
    { to: ROBINHOOD_PROFILE.router, data: "0x34" as const, value: 0n },
  ],
  stateOverride: [],
  deposit: [
    {
      to: ROBINHOOD_PROFILE.router,
      data: "0x12",
      estimatedGas: 100n,
      actualGas: 90n,
    },
  ],
  withdrawal: [
    {
      to: ROBINHOOD_PROFILE.router,
      data: "0x34",
      estimatedGas: 100n,
      actualGas: 90n,
    },
  ],
};
export const deps = {
  readState: async () => state,
  market: async () => ({ maxFeePerGas: 100n, maxPriorityFeePerGas: 10n }),
  simulate: async () => simulation,
  prepare: async () => ({
    operation: {
      sender: owner,
      callData: "0x" as const,
      callGasLimit: "0x1" as const,
      maxFeePerGas: "0x6e" as const,
      maxPriorityFeePerGas: "0xb" as const,
      nonce: "0x0" as const,
      preVerificationGas: "0x1" as const,
      verificationGasLimit: "0x1" as const,
      signature: "0x" as const,
    },
    feeCap: 100n,
    fees: { maxFeePerGas: 110n, maxPriorityFeePerGas: 11n },
    delegation: owner,
    authorizationRequired: true,
    authorizationNonce: 0,
  }),
  assertFresh: async () => {},
};
