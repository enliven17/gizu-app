import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi } from "viem";
import { AaveV3Interactions } from "../../../src/adapters/evm/aave-interactions.ts";
import { CurvanceCTokenInteractions } from "../../../src/adapters/evm/curvance-interactions.ts";
import { Erc20Interactions } from "../../../src/adapters/evm/erc20-interactions.ts";
import { MorphoBlueInteractions, MorphoVaultV2Interactions } from "../../../src/adapters/evm/morpho-interactions.ts";

const account = "0x1111111111111111111111111111111111111111";
const contract = "0x2222222222222222222222222222222222222222";
const asset = "0x3333333333333333333333333333333333333333";
const deposit = { chainId: 143, account, contract, asset, assets: 1_000_000n } as const;

test("Aave V3 prepares exact allowance and Pool supply/withdraw calldata", () => {
  const adapter = new AaveV3Interactions();
  const prepared = adapter.prepareSupply(deposit);
  assert.deepEqual(prepared.approval, { token: asset, spender: contract, amount: 1_000_000n });
  assert.equal(prepared.call.to, contract);
  assert.equal(prepared.call.chainId, 143);
  assert.equal(prepared.call.value, 0n);
  const abi = parseAbi(["function supply(address,uint256,address,uint16)", "function withdraw(address,uint256,address)"]);
  assert.deepEqual(decodeFunctionData({ abi, data: prepared.call.data }), {
    functionName: "supply", args: [asset, 1_000_000n, account, 0],
  });
  assert.deepEqual(decodeFunctionData({ abi, data: adapter.prepareWithdraw(deposit).data }), {
    functionName: "withdraw", args: [asset, 1_000_000n, account],
  });
});

test("ERC-20 adapter turns the exact approval requirement into calldata", () => {
  const approval = new AaveV3Interactions().prepareSupply(deposit).approval;
  const call = new Erc20Interactions().prepareApproval(143, approval);
  const abi = parseAbi(["function approve(address,uint256)"]);
  assert.equal(call.to, asset);
  assert.deepEqual(decodeFunctionData({ abi, data: call.data }), {
    functionName: "approve", args: [contract, 1_000_000n],
  });
});

test("Morpho Vault V2 prepares vault calls and asset approval", () => {
  const adapter = new MorphoVaultV2Interactions();
  const prepared = adapter.prepareDeposit(deposit);
  const abi = parseAbi(["function deposit(uint256,address)", "function withdraw(uint256,address,address)"]);
  assert.deepEqual(prepared.approval, { token: asset, spender: contract, amount: 1_000_000n });
  assert.deepEqual(decodeFunctionData({ abi, data: prepared.call.data }), {
    functionName: "deposit", args: [1_000_000n, account],
  });
  assert.deepEqual(decodeFunctionData({ abi, data: adapter.prepareWithdraw(deposit).data }), {
    functionName: "withdraw", args: [1_000_000n, account, account],
  });
});

test("Morpho Blue uses full market parameters and the loan token as approval asset", () => {
  const adapter = new MorphoBlueInteractions();
  const market = {
    loanToken: asset,
    collateralToken: "0x4444444444444444444444444444444444444444",
    oracle: "0x5555555555555555555555555555555555555555",
    irm: "0x6666666666666666666666666666666666666666",
    lltv: 860000000000000000n,
  } as const;
  const input = { chainId: 143, contract, account, assets: 1_000_000n, market } as const;
  const prepared = adapter.prepareSupply(input);
  const abi = parseAbi([
    "function supply((address,address,address,address,uint256),uint256,uint256,address,bytes)",
    "function withdraw((address,address,address,address,uint256),uint256,uint256,address,address)",
  ]);
  assert.deepEqual(prepared.approval, { token: asset, spender: contract, amount: 1_000_000n });
  assert.deepEqual(decodeFunctionData({ abi, data: prepared.call.data }), {
    functionName: "supply",
    args: [[market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv], 1_000_000n, 0n, account, "0x"],
  });
  assert.deepEqual(decodeFunctionData({ abi, data: adapter.prepareWithdraw(input).data }), {
    functionName: "withdraw",
    args: [[market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv], 1_000_000n, 0n, account, account],
  });
});

test("Curvance cToken prepares deposit and share-denominated redeem", () => {
  const adapter = new CurvanceCTokenInteractions();
  const prepared = adapter.prepareDeposit(deposit);
  const abi = parseAbi(["function deposit(uint256,address)", "function redeem(uint256,address,address)"]);
  assert.deepEqual(prepared.approval, { token: asset, spender: contract, amount: 1_000_000n });
  assert.deepEqual(decodeFunctionData({ abi, data: prepared.call.data }), {
    functionName: "deposit", args: [1_000_000n, account],
  });
  assert.deepEqual(decodeFunctionData({ abi, data: adapter.prepareRedeem({ chainId: 143, contract, account, shares: 500n }).data }), {
    functionName: "redeem", args: [500n, account, account],
  });
});

test("rejects zero amounts, malformed contract addresses and invalid chain IDs", () => {
  const adapter = new AaveV3Interactions();
  assert.throws(() => adapter.prepareSupply({ ...deposit, assets: 0n }), RangeError);
  assert.throws(() => adapter.prepareSupply({ ...deposit, contract: "0x123" }), Error);
  assert.throws(() => adapter.prepareSupply({ ...deposit, chainId: 0 }), RangeError);
});
