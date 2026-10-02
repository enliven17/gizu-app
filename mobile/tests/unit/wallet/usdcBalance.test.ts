import { monadUsdcBalanceService } from "@/services/wallet/usdcBalance";
import { formatUsdc } from "@/domain/wallet/amounts";

const address = "0x" + "1".repeat(40);
const token = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
const word = (amount: bigint) => "0x" + amount.toString(16).padStart(64, "0");
const rows = (amount = 19_990_574n) => [
  { jsonrpc: "2.0", id: 4, result: word(amount) },
  { jsonrpc: "2.0", id: 1, result: "0x8f" },
  { jsonrpc: "2.0", id: 3, result: word(6n) },
  { jsonrpc: "2.0", id: 2, result: "0x60806040" },
];
let request: jest.SpyInstance;
beforeEach(() => {
  request = jest.spyOn(global, "fetch");
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test.each([0n, 1n, 19_990_574n, (1n << 256n) - 1n])(
  "reads USDC atoms exactly: %s",
  async (amount) => {
    request.mockResolvedValue({ ok: true, json: async () => rows(amount) });
    await expect(
      monadUsdcBalanceService.getBalance(address, new AbortController().signal),
    ).resolves.toBe(amount.toString());
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("https://rpc.monad.xyz");
    const calls = JSON.parse(init.body);
    expect(calls).toEqual([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [token, "latest"] },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "eth_call",
        params: [{ to: token, data: "0x313ce567" }, "latest"],
      },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "eth_call",
        params: [{ to: token, data: "0x70a08231" + address.slice(2).padStart(64, "0") }, "latest"],
      },
    ]);
  },
);

test.each([
  ["wrong chain", 1, "0x279f"],
  ["wrong decimals", 3, word(18n)],
  ["missing contract", 2, "0x"],
  ["malformed code", 2, "0x123"],
  ["short balance word", 4, "0x1"],
  ["overflow balance word", 4, "0x" + "f".repeat(66)],
  ["nonhex balance", 4, "0x" + "z".repeat(64)],
])("rejects %s instead of showing zero", async (_name, id, result) => {
  request.mockResolvedValue({
    ok: true,
    json: async () => rows().map((row) => (row.id === id ? { ...row, result } : row)),
  });
  await expect(
    monadUsdcBalanceService.getBalance(address, new AbortController().signal),
  ).rejects.toThrow();
});

test("rejects duplicate IDs, malformed rows, RPC errors and HTTP errors", async () => {
  const good = rows();
  for (const invalid of [
    null,
    {},
    [],
    [...good, good[0]],
    [good[0], good[0], good[2], good[3]],
    [null, ...good.slice(1)],
    good.map((r) => (r.id === 4 ? { ...r, error: { code: -1 } } : r)),
    good.map((r) => ({ ...r, jsonrpc: "1.0" })),
  ]) {
    request.mockResolvedValueOnce({ ok: true, json: async () => invalid });
    await expect(
      monadUsdcBalanceService.getBalance(address, new AbortController().signal),
    ).rejects.toThrow();
  }
  request.mockResolvedValueOnce({ ok: false });
  await expect(
    monadUsdcBalanceService.getBalance(address, new AbortController().signal),
  ).rejects.toThrow();
});

test("invalid address and prior cancellation do not make an RPC request", async () => {
  await expect(
    monadUsdcBalanceService.getBalance("0x123", new AbortController().signal),
  ).rejects.toThrow();
  const c = new AbortController();
  c.abort();
  await expect(monadUsdcBalanceService.getBalance(address, c.signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

test("timeout and caller cancellation abort the RPC request", async () => {
  jest.useFakeTimers();
  request.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      ),
  );
  const c = new AbortController();
  const timeout = expect(monadUsdcBalanceService.getBalance(address, c.signal)).rejects.toThrow(
    "aborted",
  );
  await jest.advanceTimersByTimeAsync(12_000);
  await timeout;
  const pending = expect(monadUsdcBalanceService.getBalance(address, c.signal)).rejects.toThrow(
    "aborted",
  );
  c.abort();
  await pending;
});

test("formats six-decimal USDC without rounding or floating point", () => {
  expect(formatUsdc("0")).toBe("0");
  expect(formatUsdc("1")).toBe("0.000001");
  expect(formatUsdc("19990574")).toBe("19.990574");
  expect(formatUsdc("123456789123456789123456789")).toBe("123456789123456789123.456789");
  for (const invalid of ["-1", "1.5", "1e6", "01", (1n << 256n).toString()])
    expect(() => formatUsdc(invalid)).toThrow();
});
