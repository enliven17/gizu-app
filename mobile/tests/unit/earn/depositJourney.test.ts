import { canConfirmDeposit, parseDepositSnapshot } from "@/domain/earn/depositJourney";
import { hoodIntent } from "../../support/robinhoodEarn";

const owner = { walletId: hoodIntent.walletId };
const now = 1_800_000_000_000;
function snapshot() {
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
        maximumFeeAtoms: "50000",
        withdrawalReserveAtoms: "52000",
      },
    },
  };
}
test("a native review enables confirmation only before its expiry", () => {
  const parsed = parseDepositSnapshot(snapshot(), owner);
  expect(canConfirmDeposit(parsed, now)).toBe(true);
  expect(canConfirmDeposit(parsed, now + 45000)).toBe(false);
  expect(parseDepositSnapshot(snapshot(), owner).review?.expiresAtMs).toBe(now + 45000);
});
test("rejects a changed owner or a payout to the other destination", () => {
  expect(() => parseDepositSnapshot(snapshot(), { walletId: "other" })).toThrow();
  const raw = snapshot();
  raw.review.sources[0]!.hold.recipient = hoodIntent.destinations[1].address;
  expect(() => parseDepositSnapshot(raw, owner)).toThrow();
});
test.each(["-1", "01", "1.5", "unavailable", (1n << 256n).toString()])(
  "rejects a malformed budget %s",
  (budgetAtoms) => {
    expect(() => parseDepositSnapshot({ ...snapshot(), budgetAtoms }, owner)).toThrow();
  },
);
test("rejects an invalid credit split or repeated source operation", () => {
  const raw = snapshot();
  raw.review.sources[0]!.hold.inputAtoms = "300000";
  expect(() => parseDepositSnapshot(raw, owner)).toThrow();
  const duplicate = snapshot();
  duplicate.review.sources.push(duplicate.review.sources[0]!);
  expect(() => parseDepositSnapshot(duplicate, owner)).toThrow();
});
test("requires positive minimum outputs and a funded minimum deposit", () => {
  const raw = snapshot();
  raw.review.deposit.minimumAssetsAtoms = "0";
  expect(() => parseDepositSnapshot(raw, owner)).toThrow();
  const expensive = snapshot();
  expensive.review.deposit.maximumFeeAtoms = "2600000";
  expect(() => parseDepositSnapshot(expensive, owner)).toThrow();
});
test("unknown phases and unverified investment results cannot look successful", () => {
  expect(() => parseDepositSnapshot({ ...snapshot(), phase: "complete" }, owner)).toThrow();
  expect(() => parseDepositSnapshot({ ...snapshot(), phase: "invested" }, owner)).toThrow();
});
test("private signing material is not returned to the public presentation", () => {
  const parsed = parseDepositSnapshot(
    { ...snapshot(), signedData: "private", entropy: "private" },
    owner,
  );
  expect(parsed).not.toHaveProperty("signedData");
  expect(parsed).not.toHaveProperty("entropy");
});
