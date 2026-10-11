import type { Address, Hex, PublicClient, StateOverride } from "viem";
import { toHex, encodeFunctionData, erc20Abi } from "viem";
import { balance } from "./vault.ts";
import { withPinnedFork, simulateForkSequence } from "./fork-simulation.ts";
import type { ReferenceBlock } from "./policy.ts";
import type { SimulationRow } from "./fork-simulation.ts";
import {
  ROBINHOOD_PROFILE,
  robinhoodChain,
  robinhoodCalls,
} from "./robinhood-vault.ts";
import type { ExactCall } from "./vault.ts";
export type RobinhoodSimulation = {
  shares: bigint;
  previewShares: bigint;
  maxSharePrice: bigint;
  depositCalls: ExactCall[];
  withdrawalCalls: ExactCall[];
  stateOverride: StateOverride;
  deposit: SimulationRow[];
  withdrawal: SimulationRow[];
  fundingOverride?: StateOverride;
};
type TraceAccount = { storage?: Record<string, string> };
export function mergeRobinhoodTraces(traces: unknown[]): StateOverride {
  const changed = new Map<string, Map<string, Hex>>();
  for (const trace of traces) {
    if (
      !trace ||
      typeof trace !== "object" ||
      !("pre" in trace) ||
      !("post" in trace) ||
      !trace.pre ||
      !trace.post ||
      typeof trace.pre !== "object" ||
      typeof trace.post !== "object"
    )
      throw new Error("Malformed post-deposit trace");
    const pre = trace.pre as Record<string, TraceAccount>,
      post = trace.post as Record<string, TraceAccount>;
    const addresses = new Set([...Object.keys(pre), ...Object.keys(post)]);
    if (addresses.size > 256) throw new Error("Unbounded simulation trace");
    for (const address of addresses) {
      if (!/^0x[0-9a-f]{40}$/i.test(address))
        throw new Error("Invalid trace account");
      const previous = pre[address]?.storage ?? {},
        current = post[address]?.storage ?? {},
        slots = changed.get(address.toLowerCase()) ?? new Map<string, Hex>();
      for (const slot of new Set([
        ...Object.keys(previous),
        ...Object.keys(current),
      ])) {
        const value = current[slot] ?? "0x" + "0".repeat(64);
        if (!/^0x[0-9a-f]{64}$/i.test(slot) || !/^0x[0-9a-f]{64}$/i.test(value))
          throw new Error("Invalid post-deposit storage");
        slots.set(slot.toLowerCase(), value as Hex);
      }
      if (slots.size > 8192) throw new Error("Unbounded simulation storage");
      if (slots.size) changed.set(address.toLowerCase(), slots);
    }
  }
  if (changed.size > 256) throw new Error("Unbounded simulation accounts");
  return [...changed].map(([address, slots]) => ({
    address: address as Address,
    stateDiff: [...slots].map(([slot, value]) => ({
      slot: slot as Hex,
      value,
    })),
  }));
}
type RobinhoodSimulationOptions = {
  rpcUrl: string;
  anvilPath: string;
  timeoutMs?: number;
  block: ReferenceBlock;
  owner: Address;
  amount: bigint;
};
export async function simulateRobinhoodDeposit(
  options: RobinhoodSimulationOptions,
): Promise<RobinhoodSimulation> {
  return simulateRobinhoodSequence(options);
}
export async function simulateProspectiveRobinhoodDeposit(
  options: RobinhoodSimulationOptions & { expectedUsdg: bigint },
): Promise<RobinhoodSimulation> {
  return simulateRobinhoodSequence(options, options.expectedUsdg);
}
/** Discover, perturb and verify a balance slot on an isolated fork; never guess token storage. */
export async function fundProspectiveRobinhoodBalance(
  client: PublicClient,
  owner: Address,
  amount: bigint,
): Promise<StateOverride> {
  if (amount <= 1n || amount >= (1n << 256n) - 1n)
    throw new Error("Invalid prospective funding");
  const rpc = (method: string, params: unknown[]) =>
    client.request({ method, params } as never) as Promise<unknown>;
  const trace = (await rpc("debug_traceCall", [
    {
      to: ROBINHOOD_PROFILE.token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner],
      }),
    },
    "latest",
    { tracer: "prestateTracer" },
  ])) as Record<string, TraceAccount>;
  const account = Object.entries(trace).find(
    ([key]) => key.toLowerCase() === ROBINHOOD_PROFILE.token.toLowerCase(),
  )?.[1];
  const slots = Object.keys(account?.storage ?? {});
  if (!slots.length || slots.length > 128)
    throw new Error("Unverified USDG storage layout");
  const control = "0x000000000000000000000000000000000000dEaD" as Address;
  const controlBalance = await balance(
    client,
    ROBINHOOD_PROFILE.token,
    control,
  );
  for (const slot of slots) {
    if (!/^0x[0-9a-f]{64}$/i.test(slot))
      throw new Error("Invalid USDG storage trace");
    const original = await client.getStorageAt({
      address: ROBINHOOD_PROFILE.token,
      slot: slot as Hex,
    });
    let matched = false;
    try {
      await rpc("anvil_setStorageAt", [
        ROBINHOOD_PROFILE.token,
        slot,
        toHex(amount, { size: 32 }),
      ]);
      if ((await balance(client, ROBINHOOD_PROFILE.token, owner)) !== amount)
        continue;
      await rpc("anvil_setStorageAt", [
        ROBINHOOD_PROFILE.token,
        slot,
        toHex(amount + 1n, { size: 32 }),
      ]);
      if (
        (await balance(client, ROBINHOOD_PROFILE.token, owner)) !==
          amount + 1n ||
        (await balance(client, ROBINHOOD_PROFILE.token, control)) !==
          controlBalance
      )
        continue;
      matched = true;
    } finally {
      await rpc("anvil_setStorageAt", [
        ROBINHOOD_PROFILE.token,
        slot,
        original ?? toHex(0n, { size: 32 }),
      ]);
    }
    if (matched) {
      const value = toHex(amount, { size: 32 });
      await rpc("anvil_setStorageAt", [ROBINHOOD_PROFILE.token, slot, value]);
      if ((await balance(client, ROBINHOOD_PROFILE.token, owner)) !== amount)
        throw new Error("Changed prospective balance");
      return [
        {
          address: ROBINHOOD_PROFILE.token,
          stateDiff: [{ slot: slot as Hex, value }],
        },
      ];
    }
  }
  throw new Error("Unverified USDG owner balance storage");
}
async function simulateRobinhoodSequence(
  options: RobinhoodSimulationOptions,
  prospectiveBalance?: bigint,
): Promise<RobinhoodSimulation> {
  return withPinnedFork(
    { ...options, chain: robinhoodChain },
    async (client, signal) => {
      const rpc = (method: string, params: unknown[]) =>
        client.request({ method, params } as never) as Promise<unknown>;
      const fundingOverride =
        prospectiveBalance === undefined
          ? undefined
          : await fundProspectiveRobinhoodBalance(
              client,
              options.owner,
              prospectiveBalance,
            );
      if (
        (await balance(client, ROBINHOOD_PROFILE.vault, options.owner)) !==
          0n ||
        (await balance(client, ROBINHOOD_PROFILE.token, options.owner)) <
          options.amount
      )
        throw new Error("Changed USDG funded state");
      await rpc("anvil_setBlockTimestampInterval", [0]);
      await rpc("anvil_impersonateAccount", [options.owner]);
      await rpc("anvil_setBalance", [options.owner, toHex(10n ** 24n)]);
      const prepared = await robinhoodCalls(
        client,
        options.owner,
        "deposit",
        options.amount,
        options.block.timestamp + 600n,
      );
      const deposit = await simulateForkSequence(
        client,
        options.owner,
        prepared.calls,
        signal,
      );
      const traces = [];
      for (const row of deposit) {
        signal.throwIfAborted();
        if (!row.hash) throw new Error("Missing simulation receipt");
        traces.push(
          await rpc("debug_traceTransaction", [
            row.hash,
            { tracer: "prestateTracer", tracerConfig: { diffMode: true } },
          ]),
        );
      }
      const stateOverride = mergeRobinhoodTraces(traces),
        shares = await balance(client, ROBINHOOD_PROFILE.vault, options.owner);
      if (shares <= 0n) throw new Error("No simulated USDG shares");
      const withdrawalCalls = (
        await robinhoodCalls(
          client,
          options.owner,
          "withdraw",
          shares,
          options.block.timestamp + 600n,
        )
      ).calls;
      const withdrawal = await simulateForkSequence(
        client,
        options.owner,
        withdrawalCalls,
        signal,
      );
      if (
        (await balance(client, ROBINHOOD_PROFILE.vault, options.owner)) !== 0n
      )
        throw new Error("USDG simulation redemption left shares");
      return {
        shares,
        previewShares: prepared.previewShares,
        maxSharePrice: prepared.maxSharePrice,
        depositCalls: prepared.calls,
        withdrawalCalls,
        stateOverride,
        deposit,
        withdrawal,
        ...(fundingOverride ? { fundingOverride } : {}),
      };
    },
  );
}
