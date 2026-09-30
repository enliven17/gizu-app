import assert from "node:assert/strict";
import { test } from "node:test";
import { priceImpactBps } from "../../src/adapters/oneinch/fusion.ts";
import { signedErc20FeeCap } from "../../src/adapters/pimlico/monad-funding.ts";

test("source fee cap comes from the signed mainnet paymaster data", () => {
  const paymasterData = "0x020000006ab68777000000000000754704bc059f8c67012fed69bc8a327a5aafb6030000000000000000000000000000907e0000000000000000000000000000000000000000000000000000000000006db300000000000000000000000000012b5fd8baa107006c93a030d1455a2ef43261b384f21cf93982eb796e157a62533b16bbaa83939855d16a9c1d28bb320f0035fceca56631936f8f7d63efdf5e5d55bd1a78fa2f337e0e72240cb026889f40a6e43a29541b";
  const operation = {
    paymasterData: paymasterData as `0x${string}`,
    callGasLimit: 122_690n,
    verificationGasLimit: 91_249n,
    preVerificationGas: 317_416n,
    paymasterPostOpGasLimit: 86_990n,
    paymasterVerificationGasLimit: 95_799n,
    maxFeePerGas: 128_100_000_000n,
  };
  assert.equal(signedErc20FeeCap(operation), 2_702n);
  const otherToken = paymasterData.replace("754704bc059f8c67012fed69bc8a327a5aafb603", "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") as `0x${string}`;
  assert.throws(() => signedErc20FeeCap({ ...operation, paymasterData: otherToken }), /mode or token/);
});

test("liquidity rule compares the reference-size rate with a small probe", () => {
  const probe = { amountIn: 10_000_000n, amountOut: 40_000_000_000_000_000n };
  assert.equal(priceImpactBps(probe, { amountIn: 1_000_000_000n, amountOut: 3_960_000_000_000_000_000n }), 100n);
  assert.equal(priceImpactBps(probe, { amountIn: 1_000_000_000n, amountOut: 3_900_000_000_000_000_000n }), 250n);
  assert.equal(priceImpactBps(probe, { amountIn: 1_000_000_000n, amountOut: 4_100_000_000_000_000_000n }), 0n);
  assert.throws(() => priceImpactBps(probe, { amountIn: 1n, amountOut: 0n }), /positive/);
});
