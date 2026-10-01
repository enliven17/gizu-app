import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  toHex,
} from "viem";
import { mainnet } from "viem/chains";
import {
  withPinnedFork,
  simulateDepositOnFork,
} from "../../../src/adapters/earn/fork-simulation.ts";
import { ETHEREUM_PROFILE, balance } from "../../../src/adapters/earn/vault.ts";
const rpcUrl = process.env.EARN_TEST_ETHEREUM_RPC_URL;
const anvilPath = process.env.EARN_TEST_ANVIL_PATH;
test(
  "real pinned fork deposits and measures separate redemption, then tears down",
  { skip: !rpcUrl || !anvilPath, timeout: 60000 },
  async () => {
    const upstream = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl!, { retryCount: 0, timeout: 10000 }),
    });
    const block = await upstream.getBlock(
      process.env.EARN_TEST_BLOCK_NUMBER
        ? { blockNumber: BigInt(process.env.EARN_TEST_BLOCK_NUMBER) }
        : {},
    );
    assert.notEqual(block.baseFeePerGas, null);
    const reference = {
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
      baseFeePerGas: block.baseFeePerGas!,
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
    };
    // This wallet has no signing key in the test. All donor and native funds below exist ONLY in the disposable verified Anvil fork.
    const owner = "0x1000000000000000000000000000000000000001",
      donor = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
    let forkUrl = "";
    await withPinnedFork(
      {
        rpcUrl: rpcUrl!,
        anvilPath: anvilPath!,
        block: reference,
        timeoutMs: 45000,
      },
      async (client, signal) => {
        forkUrl = String(client.transport.url);
        const rpc = (method: string, params: unknown[]) =>
          client.request({ method, params } as never);
        const before = await balance(client, ETHEREUM_PROFILE.usdc, owner);
        await rpc("anvil_impersonateAccount", [donor]);
        await rpc("anvil_setBalance", [donor, toHex(10n ** 20n)]);
        const data = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [owner, 10000000n],
        });
        const fundingHash = await rpc("eth_sendTransaction", [
          { from: donor, to: ETHEREUM_PROFILE.usdc, data, gas: "0x186a0" },
        ]);
        const fundingReceipt = await client.waitForTransactionReceipt({
          hash: fundingHash as `0x${string}`,
          timeout: 10000,
          pollingInterval: 50,
        });
        assert.equal(fundingReceipt.status, "success");
        assert.equal(
          await balance(client, ETHEREUM_PROFILE.usdc, owner),
          before + 10000000n,
        );
        const result = await simulateDepositOnFork(
          client,
          {
            block: reference,
            owner,
            amount: 9500000n,
            initialShares: await balance(client, ETHEREUM_PROFILE.vault, owner),
          },
          signal,
        );
        assert.ok(result.deposit.length >= 2);
        assert.ok(result.withdrawal.length >= 2);
        assert.ok(
          result.deposit.every((r) => r.estimatedGas > 0n && r.actualGas > 0n),
        );
        assert.ok(
          result.withdrawal.every(
            (r) => r.estimatedGas > 0n && r.actualGas > 0n,
          ),
        );
        assert.equal(await balance(client, ETHEREUM_PROFILE.vault, owner), 0n);
        const depositCall = result.deposit.at(-1)!;
        assert.equal(depositCall.to, ETHEREUM_PROFILE.router);
      },
    );
    assert.ok(forkUrl);
    await assert.rejects(fetch(forkUrl, { signal: AbortSignal.timeout(1000) }));
  },
);
test("missing server binary fails closed without credentials in returned planner errors", async () => {
  const ref = {
    number: 1n,
    hash: "0x" + "a".repeat(64),
    timestamp: 1n,
    baseFeePerGas: 1n,
    gasUsed: 1n,
    gasLimit: 2n,
  };
  await assert.rejects(
    withPinnedFork(
      {
        rpcUrl: "http://127.0.0.1:1",
        anvilPath: "/nonexistent/anvil",
        block: ref,
        timeoutMs: 1000,
      },
      async () => true,
    ),
  );
});
test("exported simulation sequence refuses a non-local provider before any send", async () => {
  const { simulateForkSequence } =
    await import("../../../src/adapters/earn/fork-simulation.ts");
  const client = createPublicClient({
    chain: mainnet,
    transport: http("https://no-send.invalid", { retryCount: 0 }),
  });
  await assert.rejects(
    simulateForkSequence(
      client,
      "0x1000000000000000000000000000000000000001",
      [],
      new AbortController().signal,
    ),
    /server-local/,
  );
});
