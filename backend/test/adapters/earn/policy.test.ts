import assert from "node:assert/strict";
import test from "node:test";
import {
  feePolicy,
  gasBudget,
  selectBootstrapQuote,
  resolverBudget,
} from "../../../src/adapters/earn/policy.ts";

test("eight 25th percentile tips use upper median and measured gas receives exact upward margins", () => {
  const fees = feePolicy(
    {
      number: 10n,
      hash: "0x" + "a".repeat(64),
      timestamp: 100n,
      baseFeePerGas: 100n,
      gasUsed: 15n,
      gasLimit: 30n,
    },
    [80000n, 10000n, 30000n, 40000n, 50000n, 60000n, 70000n, 20000n],
  );
  assert.equal(fees.priorityFee, 50000n);
  assert.equal(fees.depositFee, 50112n);
  assert.equal(fees.withdrawFee, 100224n);
  const b = gasBudget([101n], [101n], fees);
  assert.deepEqual(b.depositLimits, [112n]);
  assert.deepEqual(b.withdrawLimits, [132n]);
  assert.equal(b.totalWei, 112n * 50112n + 132n * 100224n);
  assert.throws(() => feePolicy({ ...fees.block }, [1n]), /eight/);
});

test("Fusion resolver allowance includes provider route gas, upward headroom and profit", () => {
  const e = resolverBudget(
    {
      gas: "600000",
      gasLimit: "650000",
      prices: { usd: { fromToken: "1", toToken: "2000" } },
    },
    6000000n,
    100n,
  );
  assert.equal(e.estimatedGas, 650000n);
  assert.equal(e.gasUnits, 780000n);
  assert.equal(e.gasPrice, 125n);
  assert.equal(e.profitWei, 9750000n);
  assert.equal(e.inputValueWei, 3000000000000000n);
  assert.throws(
    () =>
      resolverBudget(
        { prices: { usd: { fromToken: "1", toToken: "2000" } } },
        1n,
        1n,
      ),
    /gas/,
  );
});

test("bootstrap expands insufficient input but rejects changed input and bounded non-convergence", async () => {
  const q = await selectBootstrapQuote({
    requiredEth: 100n,
    maxInput: 1000n,
    initialInput: 100n,
    quote: async (input) => ({ input, minimumEth: input - 80n }),
  });
  assert.ok(q.minimumEth >= 100n);
  await assert.rejects(
    selectBootstrapQuote({
      requiredEth: 100n,
      maxInput: 1000n,
      initialInput: 100n,
      quote: async (input) => ({ input: input + 1n, minimumEth: 100n }),
    }),
    /input/,
  );
  await assert.rejects(
    selectBootstrapQuote({
      requiredEth: 100n,
      maxInput: 101n,
      initialInput: 100n,
      quote: async (input) => ({ input, minimumEth: 1n }),
    }),
    /affordable/,
  );
});
test("provider numeric gas quantities are exact safe integers, not unsafe JavaScript rounding", () => {
  const e = resolverBudget(
    {
      gas: 600000,
      gasLimit: 650000,
      prices: { usd: { fromToken: "1", toToken: "2000" } },
    },
    6000000n,
    100n,
  );
  assert.equal(e.estimatedGas, 650000n);
  assert.throws(() =>
    resolverBudget(
      {
        gas: Number.MAX_SAFE_INTEGER + 1,
        prices: { usd: { fromToken: "1", toToken: "2000" } },
      },
      1n,
      1n,
    ),
  );
});
