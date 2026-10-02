import type { Address, Hex, PublicClient, StateOverride } from "viem";
import { toHex } from "viem";
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
export async function simulateRobinhoodDeposit(options: {
  rpcUrl: string;
  anvilPath: string;
  timeoutMs?: number;
  block: ReferenceBlock;
  owner: Address;
  amount: bigint;
}): Promise<RobinhoodSimulation> {
  return withPinnedFork(
    { ...options, chain: robinhoodChain },
    async (client, signal) => {
      const rpc = (method: string, params: unknown[]) =>
        client.request({ method, params } as never) as Promise<unknown>;
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
      };
    },
  );
}
