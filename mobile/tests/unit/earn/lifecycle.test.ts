import { recordCost, replanCosts, applyLegEvidence, assertComplete } from "@/domain/earn/lifecycle";
const approval = { id: "review-1", maxSourceUsdc: "10000000" };
const ledger = { originalApproval: approval, spent: [], remaining: [], revision: 1 };
test("re-planning retains already spent Fusion costs and the original approval", () => {
  const cost = {
    id: "fusion-fill-1",
    legId: "wallet2-fusion",
    asset: "ethereum-usdc" as const,
    atoms: "100000",
    category: "fusion-overhead" as const,
  };
  const paid = recordCost(ledger, cost);
  const repriced = replanCosts(paid, 2, [
    { legId: "withdraw", asset: "ethereum-eth", atoms: "200", kind: "reserve" },
  ]);
  expect(repriced.originalApproval).toBe(approval);
  expect(repriced.spent).toEqual([cost]);
  expect(recordCost(repriced, cost)).toBe(repriced);
  expect(() => recordCost(repriced, { ...cost, atoms: "2" })).toThrow();
  expect(() => replanCosts(repriced, 2, [])).toThrow();
});
const leg = {
  id: "fusion-1",
  revision: 1,
  status: "submitted" as const,
  transactionHash: "0x" + "ab".repeat(32),
};
test("public expiry, unknown responses and reorgs never permit replacement", () => {
  for (const type of ["providerExpired", "unknown", "reorg"] as const) {
    const state = applyLegEvidence(leg, { legId: leg.id, revision: 1, type });
    expect(state.canRetry).toBe(false);
    expect(state.status).toBe("unknown");
  }
  expect(() => applyLegEvidence(leg, { legId: "other", revision: 1, type: "unknown" })).toThrow();
  expect(() => applyLegEvidence(leg, { legId: leg.id, revision: 2, type: "unknown" })).toThrow();
  expect(
    applyLegEvidence(leg, {
      legId: leg.id,
      revision: 1,
      type: "chainProvenUnfilled",
      finalized: true,
      observedAtMs: 1000,
      deadlineMs: 999,
    }).canRetry,
  ).toBe(true);
  expect(() =>
    applyLegEvidence(leg, {
      legId: leg.id,
      revision: 1,
      type: "chainProvenUnfilled",
      finalized: false,
      observedAtMs: 1000,
      deadlineMs: 999,
    }),
  ).toThrow();
});
function complete() {
  return {
    expectedOperationId: "cycle-1",
    authenticatedOperationId: "cycle-1",
    expectedReturnLegIds: ["hold-usdc", "invest-usdc", "invest-eth"],
    creditedReturnLegIds: ["hold-usdc", "invest-usdc", "invest-eth"],
    shares: [0n, 0n],
    balances: { token: [0n, 0n], native: [0n, 0n], weth: [0n, 0n] },
    tokenDecimals: 6,
    tokenUsd18: 10n ** 18n,
    ethUsd18: 2000n * 10n ** 18n,
    usdcUsd18: 10n ** 18n,
    timestampMs: 1000,
    nowMs: 1000,
  };
}
test("cycle completion requires scoped authenticated credits, zero shares and explicit fresh WETH", () => {
  expect(assertComplete(complete()).optimal).toBe(true);
  expect(() => assertComplete({ ...complete(), authenticatedOperationId: "other" })).toThrow();
  expect(() =>
    assertComplete({ ...complete(), creditedReturnLegIds: ["hold-usdc", "invest-usdc"] }),
  ).toThrow();
  expect(() => assertComplete({ ...complete(), shares: [0n, 1n] })).toThrow();
  expect(() => assertComplete({ ...complete(), nowMs: 61001 })).toThrow();
  const withWeth = complete();
  withWeth.balances.weth[1] = 250000000000000n;
  expect(() => assertComplete(withWeth)).toThrow();
  expect(() =>
    assertComplete({ ...complete(), balances: { ...complete().balances, weth: [] } }),
  ).toThrow();
});

test("wallet 1's intentional hold payout is excluded from wallet 2 exit dust", () => {
  const state = complete();
  state.expectedReturnLegIds = ["invest-usdc", "invest-eth"];
  state.creditedReturnLegIds = ["invest-usdc", "invest-eth"];
  state.balances.token[0] = 100000000n;
  state.balances.native[0] = 10n ** 18n;
  state.balances.weth[0] = 10n ** 18n;
  state.shares[0] = 123n;
  expect(assertComplete(state).optimal).toBe(true);
  state.balances.token[1] = 500000n;
  expect(() => assertComplete(state)).toThrow("0.5");
});
