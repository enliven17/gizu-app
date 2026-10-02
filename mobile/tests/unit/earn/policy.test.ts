import {
  splitCredit,
  sampledPriorityFee,
  nextBaseFee,
  ethereumBudget,
  resolverBudget,
  fusionCostSummary,
  tokenPaymasterCap,
  tokenBudgets,
  conservativeResidual,
  fixedDecimal,
  assertFresh,
} from "@/domain/earn/policy";
test("confirmed credit conserves base units with a floored 10% hold", () => {
  for (const credit of [1n, 9n, 10n, 19990574n, (1n << 256n) - 1n]) {
    const s = splitCredit(credit);
    expect(s.hold + s.invest).toBe(credit);
    expect(s.hold).toBe(credit / 10n);
  }
  expect(() => splitCredit(0n)).toThrow();
  expect(() => splitCredit(-1n)).toThrow();
});
test("eight-block 25th-percentile policy chooses upper middle and 10000 wei floor", () => {
  expect(sampledPriorityFee([10000n, 80000n, 20000n, 70000n, 30000n, 60000n, 40000n, 50000n])).toBe(
    50000n,
  );
  expect(sampledPriorityFee(Array(8).fill(1n))).toBe(10000n);
  expect(() => sampledPriorityFee([1n])).toThrow();
});
test("exact EIP1559 next block and two-block budget round gas margins upward", () => {
  expect(nextBaseFee({ baseFee: 100n, gasUsed: 200n, gasLimit: 200n })).toBe(112n);
  expect(nextBaseFee({ baseFee: 1n, gasUsed: 200n, gasLimit: 200n })).toBe(2n);
  expect(nextBaseFee({ baseFee: 100n, gasUsed: 0n, gasLimit: 200n })).toBe(88n);
  const b = ethereumBudget(
    { baseFee: 100n, gasUsed: 200n, gasLimit: 200n },
    10000n,
    [1n, 101n],
    [101n],
  );
  expect(b.depositFee).toBe(10126n);
  expect(b.withdrawFee).toBe(20252n);
  expect(b.depositLimits).toEqual([2n, 112n]);
  expect(b.withdrawLimits).toEqual([132n]);
  expect(b.totalWei).toBe(114n * 10126n + 132n * 20252n);
  expect(() =>
    ethereumBudget({ baseFee: 100n, gasUsed: 201n, gasLimit: 200n }, 10000n, [1n], [1n]),
  ).toThrow();
});
test("resolver budget carries measured gas and consistent depeg prices; overhead counted once", () => {
  const b = resolverBudget({
    inputUsdc: 4000000n,
    usdcUsd18: fixedDecimal("0.98", 18),
    ethUsd18: fixedDecimal("2000", 18),
    providerGas: [100000n, 250000n],
    carriedGas: 300000n,
    depositFee: 1000000000n,
    protocolFeeBps: 100n,
  });
  expect(b.inputValueWei).toBe(1960000000000000n);
  expect(b.gasUnits).toBe(360000n);
  expect(b.gasPrice).toBe(1250000000n);
  expect(b.allowanceWei).toBe(495000000000000n);
  expect(b.auctionAmount).toBe(((b.inputValueWei - b.allowanceWei) * 9950n) / 10100n - 2n);
  const s = fusionCostSummary({
    depositWei: 10n,
    withdrawalWei: 20n,
    inputValueWei: 100n,
    minimumNetEth: 60n,
    existingEth: 0n,
  });
  expect(s.combinedBudgetWei).toBe(70n);
  expect(s.extraFundingWei).toBe(30n);
  expect(() =>
    resolverBudget({
      inputUsdc: 1n,
      usdcUsd18: 1n,
      ethUsd18: 1n,
      providerGas: [],
      carriedGas: 0n,
      depositFee: 1n,
      protocolFeeBps: 0n,
    }),
  ).toThrow();
});
function paymaster(token = "ab".repeat(20)) {
  return (
    "0x02" +
    "00" +
    "00".repeat(12) +
    token +
    "00".repeat(15) +
    "01" +
    (10n ** 18n).toString(16).padStart(64, "0") +
    "00".repeat(100)
  );
}
const op = {
  preVerificationGas: 1n,
  callGasLimit: 1n,
  verificationGasLimit: 1n,
  paymasterPostOpGasLimit: 1n,
  paymasterVerificationGasLimit: 1n,
  maxFeePerGas: 1n,
};
test("paymaster signed token cap uses ceiling, all gas terms, post term and rejects changed data", () => {
  const token = "0x" + "ab".repeat(20);
  expect(tokenPaymasterCap(op, paymaster(), token)).toBe(6n);
  const fractional = paymaster().slice(0, 102) + "1".padStart(64, "0") + "00".repeat(100);
  expect(tokenPaymasterCap(op, fractional, token)).toBe(1n);
  expect(() => tokenPaymasterCap(op, "0x", token)).toThrow();
  expect(() => tokenPaymasterCap(op, paymaster("cd".repeat(20)), token)).toThrow();
  expect(() => tokenPaymasterCap(op, paymaster().replace("0x02", "0x04"), token)).toThrow();
  expect(() => tokenPaymasterCap(op, paymaster().replace("0x0200", "0x0201"), token)).toThrow();
  expect(tokenBudgets(1n, 1n, { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n })).toEqual({
    operation: 2n,
    withdrawalReserve: 3n,
    fees: { maxFeePerGas: 2n, maxPriorityFeePerGas: 2n },
  });
});
test("residual counts WETH and depegged tokens conservatively with strict thresholds", () => {
  const fresh = { timestampMs: 1000, nowMs: 1000 };
  const value = [{ atoms: 499999n, decimals: 6, usdPrice18: 10n ** 18n }];
  expect(conservativeResidual(value, 10n ** 18n, fresh)).toEqual({
    usdcAtoms: 499999n,
    accepted: true,
    optimal: false,
  });
  expect(conservativeResidual([{ ...value[0]!, atoms: 500000n }], 10n ** 18n, fresh).accepted).toBe(
    false,
  );
  expect(conservativeResidual([{ ...value[0]!, atoms: 100000n }], 10n ** 18n, fresh).optimal).toBe(
    false,
  );
  expect(
    conservativeResidual(
      [{ atoms: 1n, decimals: 18, usdPrice18: 2000n * 10n ** 18n }],
      10n ** 18n,
      fresh,
    ).usdcAtoms,
  ).toBe(1n);
  expect(conservativeResidual(value, fixedDecimal("0.98", 18), fresh).accepted).toBe(false);
  expect(() =>
    conservativeResidual(value, 10n ** 18n, { timestampMs: 1000, nowMs: 61001 }),
  ).toThrow();
  expect(() => assertFresh({ timestampMs: 6001, nowMs: 1000 })).toThrow();
  for (const bad of ["1e-6", "-1", "01", "1.0000001"]) expect(() => fixedDecimal(bad, 6)).toThrow();
});
