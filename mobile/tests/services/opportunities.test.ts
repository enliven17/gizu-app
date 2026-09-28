import { createOpportunityService } from "@/services/opportunities";
const row = {
  id: "1",
  name: "Aave USDC",
  chainId: 143,
  protocol: { id: "aave", name: "Aave" },
  status: "LIVE",
  totalApr: 6,
  tvl: 10,
};
const body = { list: [row], page: 0, items: 8, total: 1 };
const query = { search: "USDC & MON", protocol: "all" as const, page: 0 };
const originalFetch = global.fetch;
const fetchMock = jest.fn();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => body });
});
afterEach(() => {
  global.fetch = originalFetch;
});
test("pins mainnet and encodes search with no signing or secret headers", async () => {
  expect(
    await createOpportunityService("http://localhost:3000/").list(
      query,
      new AbortController().signal,
    ),
  ).toEqual(body);
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:3000/v1/opportunities?chainId=143&page=0&items=8&search=USDC%20%26%20MON",
    { signal: expect.anything() },
  );
  await createOpportunityService("http://localhost:3000").list(
    { ...query, protocol: "morpho" },
    new AbortController().signal,
  );
  expect(fetchMock.mock.calls[1][0]).toContain("/v1/protocols/morpho/opportunities?");
});
test.each([
  { ...body, list: [{ ...row, chainId: 10143 }] },
  { ...body, list: [{ ...row, totalApr: "6" }] },
  { ...body, list: [{ ...row, tvl: -1 }] },
  { ...body, list: [row, row] },
  { ...body, total: -1 },
  { ...body, page: 1 },
  { ...body, items: 100 },
  null,
])("rejects malformed or wrong-network response %#", async (value) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => value });
  await expect(
    createOpportunityService("http://localhost:3000").list(query, new AbortController().signal),
  ).rejects.toThrow("Invalid vault catalog response");
});
test("propagates cancellation to the request", async () => {
  const parent = new AbortController();
  let requestSignal: AbortSignal | undefined;
  fetchMock.mockImplementation(
    (_url, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        requestSignal = signal;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const request = createOpportunityService("http://localhost:3000").list(query, parent.signal);
  parent.abort();
  await expect(request).rejects.toThrow("aborted");
  expect(requestSignal?.aborted).toBe(true);
});
test("HTTP failure is rejected and missing configuration makes no request", async () => {
  fetchMock.mockResolvedValue({ ok: false });
  await expect(
    createOpportunityService("http://localhost:3000").list(query, new AbortController().signal),
  ).rejects.toThrow("Vault catalog unavailable");
  fetchMock.mockClear();
  await expect(
    createOpportunityService("").list(query, new AbortController().signal),
  ).rejects.toThrow("not configured");
  expect(fetchMock).not.toHaveBeenCalled();
});
const detail = {
  ...row,
  apr: 4,
  chain: { id: 143, name: "Monad" },
  description: "Supply USDC.",
  action: "LEND",
  type: "AAVE_SUPPLY",
  dailyRewards: 10,
  liveCampaigns: 1,
  nativeApr: 2,
  explorerAddress: "0xabc",
  howToSteps: ["Supply"],
  depositUrl: "https://app.aave.com",
  identifier: "0xdef",
  tags: ["stable"],
  tokens: [{ id: "t", name: "USD Coin", symbol: "USDC", address: "0x1", decimals: 6, price: 1 }],
  campaigns: [
    {
      id: "c",
      campaignId: "0x2",
      type: "Incentive",
      apr: 1,
      dailyRewards: 5,
      startTimestamp: 1,
      endTimestamp: 2,
      creatorAddress: "0x3",
    },
  ],
};
test("detail reads one encoded mainnet opportunity", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ opportunity: detail }) });
  const service = createOpportunityService("http://localhost:3000/");
  expect(await service.detail("1", new AbortController().signal)).toEqual(detail);
  expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/v1/opportunities/1", {
    signal: expect.anything(),
  });
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ opportunity: { ...detail, id: "a/b" } }),
  });
  await service.detail("a/b", new AbortController().signal);
  expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:3000/v1/opportunities/a%2Fb");
});
test.each([
  { opportunity: { ...detail, id: "2" } },
  { opportunity: { ...detail, chainId: 10143 } },
  { opportunity: { ...detail, apr: "4" } },
  { opportunity: { ...detail, tags: [1] } },
  { opportunity: { ...detail, tokens: [{ symbol: "USDC" }] } },
  { opportunity: { ...detail, campaigns: [{ ...detail.campaigns[0], apr: null }] } },
  { opportunity: { ...detail, chain: undefined } },
  detail,
  null,
])("detail rejects malformed or mismatched response %#", async (value) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => value });
  await expect(
    createOpportunityService("http://localhost:3000").detail("1", new AbortController().signal),
  ).rejects.toThrow("Invalid vault response");
});
test("tvl records request the latest 30 and keep only totals", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ list: [{ total: 2, timestamp: 9 }, { total: 1 }] }),
  });
  expect(
    await createOpportunityService("http://localhost:3000").tvlRecords(
      "1",
      new AbortController().signal,
    ),
  ).toEqual([{ total: 2 }, { total: 1 }]);
  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:3000/v1/opportunities/1/tvl-records?items=30",
    { signal: expect.anything() },
  );
});
test.each([
  { list: [{ total: "2" }] },
  { list: [{ total: -1 }] },
  { list: Array.from({ length: 31 }, () => ({ total: 1 })) },
  { list: null },
  null,
])("tvl records reject malformed response %#", async (value) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => value });
  await expect(
    createOpportunityService("http://localhost:3000").tvlRecords("1", new AbortController().signal),
  ).rejects.toThrow("Invalid vault history response");
});
test("detail and history HTTP failures and missing configuration are rejected", async () => {
  fetchMock.mockResolvedValue({ ok: false });
  const service = createOpportunityService("http://localhost:3000");
  await expect(service.detail("1", new AbortController().signal)).rejects.toThrow(
    "Vault unavailable",
  );
  await expect(service.tvlRecords("1", new AbortController().signal)).rejects.toThrow(
    "Vault history unavailable",
  );
  fetchMock.mockClear();
  const unconfigured = createOpportunityService("");
  await expect(unconfigured.detail("1", new AbortController().signal)).rejects.toThrow(
    "not configured",
  );
  await expect(unconfigured.tvlRecords("1", new AbortController().signal)).rejects.toThrow(
    "not configured",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
