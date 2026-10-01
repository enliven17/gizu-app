import assert from "node:assert/strict";
import test from "node:test";
import { EthereumDepositPlanner } from "../../../src/adapters/earn/ethereum-deposit-planner.ts";
import { ETHEREUM_PROFILE } from "../../../src/adapters/earn/vault.ts";
const owner = "0x0000000000000000000000000000000000000001";
const block = {
  number: 100n,
  hash: "0x" + "a".repeat(64),
  timestamp: 1000n,
  baseFeePerGas: 100n,
  gasUsed: 15n,
  gasLimit: 30n,
};
const state = {
  block,
  owner,
  usdc: 1000000n,
  eth: 10n ** 18n,
  weth: 0n,
  shares: 0n,
  nonce: 0n,
  usdcAllowance: 0n,
  shareAllowance: 0n,
  ownerCode: "0x",
  shareDecimals: 18,
  tips: Array(8).fill(10000n),
};
const deps = (overrides = {}) => ({
  readState: async () => state,
  assertFresh: async () => {},
  simulate: async () => ({
    deposit: [
      {
        to: ETHEREUM_PROFILE.router,
        data: "0x12",
        estimatedGas: 101n,
        actualGas: 100n,
      },
    ],
    withdrawal: [
      {
        to: ETHEREUM_PROFILE.router,
        data: "0x34",
        estimatedGas: 201n,
        actualGas: 200n,
      },
    ],
    previewShares: 100n,
    maxSharePrice: 10n,
    postDepositShares: 100n,
  }),
  ...overrides,
});
test("immutable decimal-string plan is bound to owner/revision/reference and deposits remain invested", async () => {
  const planner = new EthereumDepositPlanner(
    { rpcUrl: "https://rpc.invalid", anvilPath: "/private/tmp/anvil" },
    deps(),
    () => 1000000,
  );
  const plan = await planner.plan({
    owner,
    revision: 2,
    operationId: "cycle-2",
  });
  assert.equal(plan.depositAmount, "950000");
  assert.equal(plan.referenceBlockHash, block.hash);
  assert.equal(plan.owner, owner);
  assert.equal(plan.revision, 2);
  assert.equal(
    plan.policyVersion,
    "ethereum-native-v1-fees8-p25-uppermedian-d10-w30-r2-liquid50000",
  );
  assert.equal(plan.executionAvailable, false);
  assert.equal(plan.simulation.withdrawalPurpose, "reserve-only-isolated-fork");
  assert.equal(plan.fusion, null);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.startingBalances));
  assert.doesNotThrow(() => JSON.stringify(plan));
});
test("empty destination, WETH and implicit existing shares fail explicitly", async () => {
  for (const [overrides, code] of [
    [{ usdc: 0n }, "EARN_PREFUNDING_REQUIRED"],
    [{ weth: 1n }, "EARN_WETH_RECONCILIATION_REQUIRED"],
    [{ shares: 1n }, "EARN_EXISTING_SHARES_SCOPE_REQUIRED"],
  ] as const) {
    const planner = new EthereumDepositPlanner(
      { rpcUrl: "https://rpc.invalid", anvilPath: "/private/tmp/anvil" },
      deps({ readState: async () => ({ ...state, ...overrides }) }),
      () => 1000000,
    );
    await assert.rejects(
      planner.plan({ owner, revision: 1, operationId: "cycle" }),
      { code },
    );
  }
});
test("unavailable simulation never returns mock gas and sanitizes provider credentials", async () => {
  const planner = new EthereumDepositPlanner(
    { rpcUrl: "https://user:secret@rpc.invalid" },
    deps({
      simulate: async () => {
        throw new Error("https://secret-api-token.invalid");
      },
    }),
  );
  await assert.rejects(
    planner.plan({ owner, revision: 1, operationId: "cycle" }),
    (e: unknown) =>
      e instanceof Error &&
      "code" in e &&
      e.code === "EARN_DEPOSIT_PLAN_UNAVAILABLE" &&
      !e.message.includes("secret"),
  );
});
test("shortfall purchase resimulates smaller deposit and conserves balance without double fees", async () => {
  const planner = new EthereumDepositPlanner(
    { rpcUrl: "https://rpc.invalid", anvilPath: "/private/tmp/anvil" },
    deps({
      readState: async () => ({ ...state, eth: 0n }),
      quote: async (input: bigint) => ({
        input,
        minimumEth: input * 10000n,
        quotedAtMs: 1000000,
        expiresAtMs: 1060000,
        quoteId: null,
        orderHash: "0x" + "b".repeat(64),
        economics: {
          estimatedGas: 1n,
          gasUnits: 1n,
          gasPrice: 1n,
          gasCostWei: 1n,
          profitWei: 1n,
          allowanceWei: 2n,
          inputValueWei: input * 11000n,
          maximumGrossEth: input * 11000n - 2n,
        },
        grossEth: input * 10000n,
        priceUsdcPerEth: 10n ** 14n,
      }),
      price: async () => 10n ** 14n,
    }),
    () => 1000000,
  );
  const plan = await planner.plan({ owner, revision: 1, operationId: "cycle" });
  assert.ok(plan.fusion);
  assert.equal(
    BigInt(plan.depositAmount) +
      BigInt(plan.fusion.inputUsdc) +
      BigInt(plan.retainedLiquidUsdc),
    state.usdc,
  );
  assert.equal(
    BigInt(plan.totalBudgetWei),
    BigInt(plan.depositGasBudgetWei) +
      BigInt(plan.withdrawalReserveWei) +
      BigInt(plan.fusion.embeddedOverheadWei),
  );
});
test("changed canonical state, stale reference and wrong owner cannot produce a signing proposal", async () => {
  for (const providers of [
    deps({
      assertFresh: async () => {
        throw new Error("Reference reorg");
      },
    }),
    deps({
      readState: async () => ({
        ...state,
        owner: "0x0000000000000000000000000000000000000002",
      }),
    }),
    deps({
      readState: async () => ({
        ...state,
        block: { ...state.block, timestamp: 900n },
      }),
    }),
  ]) {
    const p = new EthereumDepositPlanner(
      { rpcUrl: "https://rpc.invalid", anvilPath: "/private/tmp/anvil" },
      providers,
      () => 1000000,
    );
    await assert.rejects(p.plan({ owner, revision: 1, operationId: "cycle" }), {
      code: "EARN_DEPOSIT_PLAN_UNAVAILABLE",
    });
  }
});
test("explicit existing-share scope records old position independently from new shares", async () => {
  const p = new EthereumDepositPlanner(
    { rpcUrl: "https://rpc.invalid", anvilPath: "/private/tmp/anvil" },
    deps({
      readState: async () => ({ ...state, shares: 50n }),
      simulate: async () => ({
        deposit: [
          {
            to: ETHEREUM_PROFILE.router,
            data: "0x12",
            estimatedGas: 101n,
            actualGas: 100n,
          },
        ],
        withdrawal: [
          {
            to: ETHEREUM_PROFILE.router,
            data: "0x34",
            estimatedGas: 201n,
            actualGas: 200n,
          },
        ],
        previewShares: 100n,
        maxSharePrice: 10n,
        postDepositShares: 150n,
      }),
    }),
    () => 1000000,
  );
  const result = await p.plan({
    owner,
    revision: 1,
    operationId: "cycle",
    existingSharesScope: "include-existing",
  });
  assert.equal(result.startingBalances.shares, "50");
  assert.equal(result.previewShares, "100");
  assert.equal(result.simulation.postDepositShares, "150");
  assert.equal(result.existingSharesScope, "include-existing");
});
