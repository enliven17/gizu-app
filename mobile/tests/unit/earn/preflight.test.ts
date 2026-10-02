import { createEarnPreflightService } from "@/services/earn/preflight";
import { earnProfiles } from "@/domain/earn/types";
const owner = "0x" + "2".repeat(40);
const response = {
  profileId: "ethereum-usdc",
  chainId: 1,
  owner,
  token: earnProfiles["ethereum-usdc"].token,
  vault: earnProfiles["ethereum-usdc"].vault,
  tokenDecimals: 6,
  blockNumber: "256",
  blockHash: "0x" + "a".repeat(64),
  timestampMs: 1000000,
  tokenBalance: "0",
  nativeBalance: "0",
  shares: "0",
  newCycleReady: true,
  blockGas: { baseFee: "100", gasUsed: "100", gasLimit: "200" },
  feeHistoryReward: Array(8).fill("1"),
  readOnly: true,
  executionAvailable: false,
  simulationAvailable: false,
};
beforeEach(() =>
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, json: async () => response } as Response),
);
afterEach(() => jest.restoreAllMocks());
test("preflight sends only selected profile and destination wallet, and accepts verified read-only state", async () => {
  const service = createEarnPreflightService("https://example.test", () => 1000000);
  const result = await service.check("ethereum-usdc", owner, new AbortController().signal);
  expect(result.tokenBalance).toBe("0");
  expect(result.executionAvailable).toBe(false);
  expect(JSON.parse(jest.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({
    profileId: "ethereum-usdc",
    owner,
  });
});
test.each([
  { chainId: 143 },
  { blockHash: "0x1" },
  { blockHash: "0x" + "0".repeat(64) },
  { token: "0x" + "3".repeat(40) },
  { vault: "0x" + "3".repeat(40) },
  { owner: "0x" + "3".repeat(40) },
  { tokenDecimals: 18 },
  { executionAvailable: true },
  { readOnly: false },
  { timestampMs: 939999 },
  { tokenBalance: "1e6" },
  { shares: "-1" },
  { feeHistoryReward: [] },
  { newCycleReady: false },
  { blockGas: { baseFee: "100", gasUsed: "300", gasLimit: "200" } },
])("rejects changed/malformed preflight %j", async (change) => {
  jest
    .mocked(fetch)
    .mockResolvedValue({ ok: true, json: async () => ({ ...response, ...change }) } as Response);
  await expect(
    createEarnPreflightService("https://example.test", () => 1000000).check(
      "ethereum-usdc",
      owner,
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});
test("unconfigured endpoint, cancellation, old server and HTTP failures are explicit", async () => {
  await expect(
    createEarnPreflightService("").check("ethereum-usdc", owner, new AbortController().signal),
  ).rejects.toThrow(/configured/);
  const abort = new AbortController();
  abort.abort();
  await expect(
    createEarnPreflightService("https://example.test").check("ethereum-usdc", owner, abort.signal),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  jest.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
  await expect(
    createEarnPreflightService("https://example.test").check(
      "ethereum-usdc",
      owner,
      new AbortController().signal,
    ),
  ).rejects.toThrow(/deployed/);
});
