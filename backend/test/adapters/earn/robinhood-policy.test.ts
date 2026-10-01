import assert from "node:assert/strict";
import test from "node:test";
import {
  robinhoodTokenCap,
  stabilizeRobinhoodApproval,
} from "../../../src/adapters/earn/robinhood-paymaster.ts";
import { ROBINHOOD_PROFILE } from "../../../src/adapters/earn/robinhood-vault.ts";
import { encodeFunctionData, erc20Abi } from "viem";
const owner = "0x1000000000000000000000000000000000000001" as const;
const word = (n: bigint, bytes: number) =>
  n.toString(16).padStart(bytes * 2, "0");
const data = ("0x0200" +
  word(0n, 12) +
  ROBINHOOD_PROFILE.token.slice(2) +
  word(1n, 16) +
  word(1000000000000000001n, 32) +
  word(0n, 100)) as `0x${string}`;
const op = {
  sender: owner,
  paymaster: ROBINHOOD_PROFILE.paymaster,
  nonce: 0n,
  callData: "0x" as const,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 0n,
  preVerificationGas: 1n,
  callGasLimit: 1n,
  verificationGasLimit: 1n,
  paymasterPostOpGasLimit: 1n,
  paymasterVerificationGasLimit: 1n,
  paymasterData: data,
};
test("USDG cap rounds upward across all five gas terms and paymaster post term; unsupported modes reject", () => {
  assert.equal(robinhoodTokenCap(op), 7n);
  assert.throws(() =>
    robinhoodTokenCap({
      ...op,
      paymasterData: ("0x04" + data.slice(4)) as `0x${string}`,
    }),
  );
  assert.throws(() =>
    robinhoodTokenCap({
      ...op,
      paymasterData: ("0x0201" + data.slice(6)) as `0x${string}`,
    }),
  );
  assert.throws(() => robinhoodTokenCap({ ...op, callGasLimit: undefined }));
});
test("SDK floor approval is narrowly rebuilt using ceil and re-estimated before preview", async () => {
  const calls = [
    {
      to: ROBINHOOD_PROFILE.token,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ROBINHOOD_PROFILE.router, 1n],
      }),
    },
  ];
  const stabilized = await stabilizeRobinhoodApproval(
    op,
    calls,
    0n,
    async (encoded) =>
      ("0x" +
        Buffer.from(
          JSON.stringify(encoded, (_, v) =>
            typeof v === "bigint" ? String(v) : v,
          ),
        ).toString("hex")) as `0x${string}`,
    async (operation) => ({ ...operation, callGasLimit: 2n }),
  );
  assert.equal(robinhoodTokenCap(stabilized), 8n);
  assert.notEqual(stabilized.callData, "0x");
  await assert.rejects(
    stabilizeRobinhoodApproval(
      op,
      calls,
      0n,
      async () => "0x",
      async (operation) => ({
        ...operation,
        callGasLimit: operation.callGasLimit * 10n,
      }),
    ),
    /stabilize/,
  );
});
