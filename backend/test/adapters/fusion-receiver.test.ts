import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { FusionSDK } from "@1inch/fusion-sdk";
import { OneInchFusion } from "../../src/adapters/oneinch/fusion.ts";

test("passes the native bridge receiver to the installed Fusion SDK", async () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const receiver = "0x2222222222222222222222222222222222222222";
  const token = "0x3333333333333333333333333333333333333333";
  const permit = `0x${"ab".repeat(224)}` as const;
  const create = mock.method(FusionSDK.prototype, "createOrder", async () => ({
    hash: `0x${"ab".repeat(32)}`, quoteId: "q",
    order: { build: () => ({ salt: "1", maker: wallet, receiver, makerAsset: token, takerAsset: wallet, makingAmount: "1", takingAmount: "1", makerTraits: "0" }), extension: { encode: () => "0x" } },
  }));
  try {
    const fusion = new OneInchFusion("test-only-key");
    await fusion.createOrder(wallet, wallet, 1n, permit, "fast", token, receiver);
    assert.equal(create.mock.calls[0]?.arguments[0]?.receiver, receiver);
    assert.equal(create.mock.calls[0]?.arguments[0]?.walletAddress, wallet);
    await fusion.createOrder(wallet, token, 1n, permit, "fast");
    assert.equal(create.mock.calls[1]?.arguments[0]?.receiver, undefined);
  } finally { create.mock.restore(); }
});
