import assert from "node:assert/strict";
import test from "node:test";
import { toHex, type PublicClient } from "viem";
import { fundProspectiveRobinhoodBalance } from "../../../src/adapters/earn/robinhood-simulation.ts";
import { ROBINHOOD_PROFILE } from "../../../src/adapters/earn/robinhood-vault.ts";
const owner = "0x1000000000000000000000000000000000000001" as const;
const bad = toHex(1n, { size: 32 }),
  good = toHex(2n, { size: 32 });
function clientFixture(includeGood = true) {
  const storage = new Map<string, string>([
    [bad, toHex(0n, { size: 32 })],
    [good, toHex(0n, { size: 32 })],
  ]);
  const client = {
    async request({ method, params }: { method: string; params: unknown[] }) {
      if (method === "debug_traceCall")
        return {
          [ROBINHOOD_PROFILE.token]: {
            storage: includeGood
              ? { [bad]: "0x0", [good]: "0x0" }
              : { [bad]: "0x0" },
          },
        };
      assert.equal(method, "anvil_setStorageAt");
      assert.equal(params[0], ROBINHOOD_PROFILE.token);
      storage.set(params[1] as string, params[2] as string);
      return true;
    },
    async getStorageAt({ slot }: { slot: string }) {
      return storage.get(slot);
    },
    async readContract({ args }: { args: readonly string[] }) {
      if (BigInt(storage.get(bad)!) !== 0n)
        throw new Error("A traced implementation slot is not a balance slot");
      return args[0]!.toLowerCase() === owner.toLowerCase()
        ? BigInt(storage.get(good)!)
        : 99n;
    },
  } as unknown as PublicClient;
  return { client, storage };
}
test("prospective storage discovery restores a reverting candidate and proves the owner slot", async () => {
  const { client, storage } = clientFixture();
  const result = await fundProspectiveRobinhoodBalance(client, owner, 1000000n);
  assert.equal(BigInt(storage.get(bad)!), 0n);
  assert.equal(BigInt(storage.get(good)!), 1000000n);
  assert.deepEqual(result, [
    {
      address: ROBINHOOD_PROFILE.token,
      stateDiff: [{ slot: good, value: toHex(1000000n, { size: 32 }) }],
    },
  ]);
});
test("an unprovable layout fails closed with the original traced storage restored", async () => {
  const { client, storage } = clientFixture(false);
  await assert.rejects(
    fundProspectiveRobinhoodBalance(client, owner, 1000000n),
    /Unverified/,
  );
  assert.equal(BigInt(storage.get(bad)!), 0n);
  assert.equal(BigInt(storage.get(good)!), 0n);
});
