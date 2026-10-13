import { demoOpportunityService } from "@/services/demo/opportunities";
import { opportunityService } from "@/services/opportunities";
import { catalogEarnProfile } from "@/domain/earn/catalog";
import type { OpportunityProtocol } from "@/domain/opportunities";

const signal = () => new AbortController().signal;
const query = (protocol: OpportunityProtocol = "all", page = 0) => ({
  protocol,
  page,
  search: "",
});
const originalFlag = process.env.EXPO_PUBLIC_SWAP_DEMO;
afterEach(() => {
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_SWAP_DEMO;
  else process.env.EXPO_PUBLIC_SWAP_DEMO = originalFlag;
  jest.restoreAllMocks();
});

test("the demo has exactly six complete entries per protocol across 18 unique catalog IDs", async () => {
  const all = [];
  for (let page = 0; page < 3; page++) {
    const result = await demoOpportunityService.list(query("all", page), signal());
    expect(result.total).toBe(18);
    expect(result.partial).toBe(false);
    all.push(...result.list);
  }
  expect(new Set(all.map((vault) => vault.id)).size).toBe(18);
  for (const protocol of ["aave", "morpho", "curvance"] as const) {
    const result = await demoOpportunityService.list(query(protocol), signal());
    expect(result.total).toBe(6);
    expect(result.list).toHaveLength(6);
    expect(result.list.every((vault) => vault.protocol.id === protocol)).toBe(true);
  }
  for (const vault of all) {
    const detail = await demoOpportunityService.detail(vault.id, signal());
    const history = await demoOpportunityService.tvlRecords(vault.id, signal());
    expect(detail.name).toBe(vault.name);
    expect(history).toHaveLength(30);
    expect(history[0]?.total).toBe(vault.tvl);
    expect(history.every((point) => Number.isFinite(point.total) && point.total > 0)).toBe(true);
    expect(new Set(history.map((point) => point.total)).size).toBeGreaterThan(1);
    expect(catalogEarnProfile(detail)).toBeNull();
    expect(detail.depositUrl).toBe("");
  }
});

test("search and network filters compose without changing pagination totals", async () => {
  const result = await demoOpportunityService.list(
    { ...query("morpho"), search: "  steakhouse  ", chainId: 4663 },
    signal(),
  );
  expect(result.total).toBe(1);
  expect(result.list.map((vault) => vault.name)).toEqual(["Steakhouse USDG"]);
  expect(
    (await demoOpportunityService.list({ ...query(), search: "missing" }, signal())).list,
  ).toEqual([]);
});

test("default demo catalog reads never reach the network", async () => {
  process.env.EXPO_PUBLIC_SWAP_DEMO = "1";
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  const chains = await opportunityService.chains!(signal());
  expect(chains.map((chain) => chain.id)).toEqual([1, 4663, 143]);
  const page = await opportunityService.list(query("curvance"), signal());
  expect(page.list).toHaveLength(6);
  await opportunityService.detail(page.list[0]!.id, signal());
  await opportunityService.tvlRecords(page.list[0]!.id, signal());
  expect(network).not.toHaveBeenCalled();
});

test("without demo mode the default adapter still reads the hosted chain catalog", async () => {
  delete process.env.EXPO_PUBLIC_SWAP_DEMO;
  const list = [{ id: 143, name: "Monad" }];
  const network = jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ list }),
  } as Response);
  expect(await opportunityService.chains!(signal())).toEqual(list);
  expect(network).toHaveBeenCalledWith(expect.stringContaining("/v1/chains"), expect.anything());
});

test("cancelled catalog reads reject and unknown detail IDs do not fabricate entries", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(demoOpportunityService.list(query(), controller.signal)).rejects.toThrow(
    "cancelled",
  );
  await expect(demoOpportunityService.detail("unknown", signal())).rejects.toThrow(
    "Vault not found",
  );
});
