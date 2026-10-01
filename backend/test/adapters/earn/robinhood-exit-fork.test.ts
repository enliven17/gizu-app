import test from "node:test";
import assert from "node:assert/strict";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  toHex,
  getAddress,
} from "viem";
import type { Hex } from "viem";
import {
  withPinnedFork,
  simulateForkSequence,
} from "../../../src/adapters/earn/fork-simulation.ts";
import { simulateRobinhoodExit } from "../../../src/adapters/earn/robinhood-exit-planner.ts";
import {
  ROBINHOOD_PROFILE,
  robinhoodChain,
  robinhoodCalls,
} from "../../../src/adapters/earn/robinhood-vault.ts";
import { balance } from "../../../src/adapters/earn/vault.ts";
import type { RobinhoodState } from "../../../src/adapters/earn/robinhood-deposit-planner.ts";
const rpcUrl = process.env.EARN_TEST_ROBINHOOD_RPC_URL,
  anvilPath = process.env.EARN_TEST_ANVIL_PATH;
test(
  "real Robinhood fork withdraws all current shares and transfers actual remaining USDG without live sends",
  { skip: !rpcUrl || !anvilPath, timeout: 60000 },
  async (t) => {
    const upstream = createPublicClient({
      chain: robinhoodChain,
      transport: http(rpcUrl!, { retryCount: 0, timeout: 12000 }),
    });
    const block = await upstream.getBlock();
    const ref = (b: typeof block) => ({
      number: b.number,
      hash: b.hash,
      timestamp: b.timestamp,
      baseFeePerGas: b.baseFeePerGas ?? 0n,
      gasUsed: b.gasUsed,
      gasLimit: b.gasLimit,
    });
    const owner = getAddress("0x1000000000000000000000000000000000000001"),
      donor = getAddress("0x14eEa32eaAfb58C2C33206bec86C7689cE44887E");
    await withPinnedFork(
      {
        rpcUrl: rpcUrl!,
        anvilPath: anvilPath!,
        block: ref(block),
        chain: robinhoodChain,
        timeoutMs: 55000,
      },
      async (client, signal) => {
        const rpc = (method: string, params: unknown[]) =>
          client.request({ method, params } as never);
        await rpc("anvil_setBlockTimestampInterval", [0]);
        await rpc("anvil_impersonateAccount", [donor]);
        await rpc("anvil_setBalance", [donor, toHex(10n ** 20n)]);
        const hash = await rpc("eth_sendTransaction", [
          {
            from: donor,
            to: ROBINHOOD_PROFILE.token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "transfer",
              args: [owner, 10000000n],
            }),
            gas: "0x186a0",
          },
        ]);
        assert.equal(
          (
            await client.waitForTransactionReceipt({
              hash: hash as Hex,
              timeout: 10000,
              pollingInterval: 50,
            })
          ).status,
          "success",
        );
        await rpc("anvil_impersonateAccount", [owner]);
        await rpc("anvil_setBalance", [owner, toHex(10n ** 24n)]);
        await simulateForkSequence(
          client,
          owner,
          (
            await robinhoodCalls(
              client,
              owner,
              "deposit",
              8000000n,
              block.timestamp + 600n,
            )
          ).calls,
          signal,
        );
        const state = async (): Promise<RobinhoodState> => ({
          owner,
          block: ref(await client.getBlock()),
          token: await balance(client, ROBINHOOD_PROFILE.token, owner),
          shares: await balance(client, ROBINHOOD_PROFILE.vault, owner),
          native: 0n,
          wrappedNative: 0n,
          nonce: BigInt(await client.getTransactionCount({ address: owner })),
          ownerCode: "0x",
          shareDecimals: 18,
        });
        const invested = await state();
        assert.ok(invested.shares > 0n);
        const withdrawalCalls = (
          await robinhoodCalls(
            client,
            owner,
            "withdraw",
            invested.shares,
            block.timestamp + 600n,
          )
        ).calls;
        const paymasterApproval = {
          to: ROBINHOOD_PROFILE.token,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [ROBINHOOD_PROFILE.paymaster, 50000n],
          }),
        };
        const config = {
          rpcUrl: String(client.transport.url),
          anvilPath: anvilPath!,
          timeoutMs: 25000,
        };
        const withdrawal = await simulateRobinhoodExit(
          config,
          invested,
          [paymasterApproval, ...withdrawalCalls],
          "withdrawal",
          invested.shares,
        );
        assert.equal(withdrawal.remainingShares, 0n);
        assert.ok(withdrawal.receivedToken > 0n);
        assert.equal(withdrawal.rows.length, 3);
        assert.equal(
          await balance(client, ROBINHOOD_PROFILE.vault, owner),
          invested.shares,
        );
        await simulateForkSequence(client, owner, withdrawalCalls, signal);
        const exited = await state();
        assert.equal(exited.shares, 0n);
        const amount = exited.token - 50000n;
        const returns = await simulateRobinhoodExit(
          config,
          exited,
          [
            paymasterApproval,
            {
              to: ROBINHOOD_PROFILE.token,
              value: 0n,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [
                  getAddress("0x3000000000000000000000000000000000000003"),
                  amount,
                ],
              }),
            },
          ],
          "return",
          amount,
        );
        assert.equal(returns.remainingToken, 50000n);
        assert.equal(returns.remainingShares, 0n);
        assert.equal(
          await balance(client, ROBINHOOD_PROFILE.token, owner),
          exited.token,
        );
        t.diagnostic(
          JSON.stringify({
            referenceBlock: block.number.toString(),
            referenceHash: block.hash,
            withdrawalGas: withdrawal.rows.map((r) => r.actualGas.toString()),
            returnGas: returns.rows.map((r) => r.actualGas.toString()),
            shares: invested.shares.toString(),
            redeemed: withdrawal.receivedToken.toString(),
          }),
        );
      },
    );
  },
);
