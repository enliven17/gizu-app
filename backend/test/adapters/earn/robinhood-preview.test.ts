import assert from "node:assert/strict";
import test from "node:test";
import { RobinhoodDepositPreviewPlanner } from "../../../src/adapters/earn/robinhood-deposit-preview.ts";
import { RobinhoodDepositPlanner } from "../../../src/adapters/earn/robinhood-deposit-planner.ts";
import { deps, owner, state } from "./robinhood-preview-fixture.ts";

const request = {
  owner,
  expectedUsdgAtoms: "1000000",
  operationId: "preview_1",
  revision: 1,
};
test("an unfunded prospective preview retains reserve math but exposes no executable operation", async () => {
  const providers = {
    ...deps,
    readState: async () => ({ ...state, token: 0n }),
  };
  const planner = new RobinhoodDepositPreviewPlanner(
    { rpcUrl: "http://rpc.invalid" },
    providers,
    () => 1000000,
  );
  const result = await planner.preview(request);
  assert.equal(result.kind, "preview");
  assert.equal(result.readOnly, true);
  assert.equal(result.executionAvailable, false);
  assert.equal(result.depositAmount, "999635");
  assert.equal(result.depositFeeBudget, "105");
  assert.equal(result.withdrawalReserve, "260");
  assert.equal("operation" in result, false);
  assert.equal("calldata" in result, false);
  assert.equal(result.assumption, "hypothetical-USDG-funding-isolated-fork");
  await assert.rejects(
    new RobinhoodDepositPlanner(
      { rpcUrl: "http://rpc.invalid" },
      providers,
      () => 1000000,
    ).plan({ owner, operationId: "real", revision: 1 }),
  );
});
test("prospective planning rejects stale data, unrelated existing funds, invalid budget and exhausted gas economics", async () => {
  for (const change of [
    { token: 1n },
    { shares: 1n },
    { block: { ...state.block, timestamp: 900n } },
  ]) {
    const planner = new RobinhoodDepositPreviewPlanner(
      { rpcUrl: "http://rpc.invalid" },
      { ...deps, readState: async () => ({ ...state, token: 0n, ...change }) },
      () => 1000000,
    );
    await assert.rejects(planner.preview(request));
  }
  const planner = new RobinhoodDepositPreviewPlanner(
    { rpcUrl: "http://rpc.invalid" },
    { ...deps, readState: async () => ({ ...state, token: 0n }) },
    () => 1000000,
  );
  for (const amount of ["0", "-1", "01", "1", "100", (1n << 256n).toString()])
    await assert.rejects(
      planner.preview({ ...request, expectedUsdgAtoms: amount }),
    );
});
