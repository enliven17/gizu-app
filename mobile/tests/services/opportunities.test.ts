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
