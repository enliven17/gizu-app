import { hoodIntent } from "./robinhoodEarn";
const owner = { walletId: hoodIntent.walletId };
export const depositNow = 1_800_000_000_000;
const now = depositNow;
export function depositSnapshot() {
  return {
    version: 1,
    journeyId: "deposit_1",
    revision: 1,
    walletId: owner.walletId,
    intentId: hoodIntent.intentId,
    profileId: "robinhood-usdg",
    phase: "review",
    destinations: hoodIntent.destinations,
    budgetAtoms: "3000000",
    creditedAtoms: "0",
    holdReceivedAtoms: "0",
    investReceivedAtoms: "0",
    depositedAtoms: "0",
    sharesAtoms: "0",
    completedSteps: [],
    review: {
      policyVersion: "robinhood-usdg-v1-price10-budget5-withdraw260",
      quotedAtMs: now,
      expiresAtMs: now + 45000,
      sourceBudgetAtoms: "3000000",
      sources: [
        {
          operationId: "source_1",
          accountIndex: 1,
          address: hoodIntent.sourceAddress,
          budgetAtoms: "3000000",
          amountAtoms: "2980000",
          maximumFeeAtoms: "10000",
          retainedAtoms: "10000",
          minimumCreditAtoms: "2970000",
          hold: {
            recipient: hoodIntent.destinations[0].address,
            inputAtoms: "297000",
            estimatedOutputAtoms: "290000",
            minimumOutputAtoms: "280000",
            providerFeeBps: 2,
          },
          invest: {
            recipient: hoodIntent.destinations[1].address,
            inputAtoms: "2673000",
            estimatedOutputAtoms: "2650000",
            minimumOutputAtoms: "2600000",
            providerFeeBps: 2,
          },
        },
      ],
      deposit: {
        estimatedAssetsAtoms: "2498000",
        minimumAssetsAtoms: "2495000",
        minimumSharesAtoms: "2490000000000000000",
        shareDecimals: 18,
        maximumFeeAtoms: "50000",
        withdrawalReserveAtoms: "52000",
      },
    },
  };
}
