import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  toHex,
} from "viem";
import type { Hex } from "viem";
import { withPinnedFork } from "../../../src/adapters/earn/fork-simulation.ts";
import {
  ROBINHOOD_PROFILE,
  robinhoodChain,
} from "../../../src/adapters/earn/robinhood-vault.ts";
import { simulateRobinhoodDeposit } from "../../../src/adapters/earn/robinhood-simulation.ts";
import { balance } from "../../../src/adapters/earn/vault.ts";
const rpcUrl = process.env.EARN_TEST_ROBINHOOD_RPC_URL,
  anvilPath = process.env.EARN_TEST_ANVIL_PATH;
test(
  "Robinhood real local funding, exact deposit/redemption and post-state storage overlay",
  { skip: !rpcUrl || !anvilPath, timeout: 60000 },
  async (t) => {
    const upstream = createPublicClient({
      chain: robinhoodChain,
      transport: http(rpcUrl!, { retryCount: 0, timeout: 12000 }),
    });
    const block = await upstream.getBlock();
    const reference = {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
      baseFeePerGas: block.baseFeePerGas ?? 0n,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
    };
    // Public holder only impersonated on verified local Anvil. This test never requests upstream eth_sendTransaction.
    const owner = "0x1000000000000000000000000000000000000001",
      donor = "0x14eEa32eaAfb58C2C33206bec86C7689cE44887E";
    await withPinnedFork(
      {
        rpcUrl: rpcUrl!,
        anvilPath: anvilPath!,
        chain: robinhoodChain,
        block: reference,
        timeoutMs: 50000,
      },
      async (client) => {
        const rpc = (method: string, params: unknown[]) =>
          client.request({ method, params } as never);
        const before = await balance(client, ROBINHOOD_PROFILE.token, owner);
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
        const receipt = await client.waitForTransactionReceipt({
          hash: hash as Hex,
          timeout: 10000,
          pollingInterval: 50,
        });
        assert.equal(receipt.status, "success");
        assert.equal(
          await balance(client, ROBINHOOD_PROFILE.token, owner),
          before + 10000000n,
        );
        const funded = await client.getBlock(),
          fundedReference = {
            number: funded.number,
            hash: funded.hash,
            timestamp: funded.timestamp,
            baseFeePerGas: funded.baseFeePerGas ?? 0n,
            gasUsed: funded.gasUsed,
            gasLimit: funded.gasLimit,
          };
        const result = await simulateRobinhoodDeposit({
          rpcUrl: String(client.transport.url),
          anvilPath: anvilPath!,
          block: fundedReference,
          owner,
          amount: 9500000n,
          timeoutMs: 40000,
        });
        assert.ok(result.shares > 0n);
        assert.equal(result.deposit.length, 2);
        assert.equal(result.withdrawal.length, 2);
        assert.ok(result.stateOverride.length > 0);
        assert.equal(
          await client.readContract({
            address: ROBINHOOD_PROFILE.vault,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
            stateOverride: result.stateOverride,
          }),
          result.shares,
        );
        assert.ok(
          result.stateOverride.every(
            (o) => !("balance" in o) && !("code" in o),
          ),
        );
        t.diagnostic(
          JSON.stringify({
            referenceBlock: String(block.number),
            referenceHash: block.hash,
            depositGas: result.deposit.map((r) => String(r.actualGas)),
            withdrawalGas: result.withdrawal.map((r) => String(r.actualGas)),
            overrideAccounts: result.stateOverride.length,
          }),
        );
      },
    );
  },
);
