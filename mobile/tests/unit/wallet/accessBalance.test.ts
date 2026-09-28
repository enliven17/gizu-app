import { createNativeWalletAccess } from "@/development/legacySigner/access";
import { formatMon } from "@/domain/wallet/amounts";
import { monadBalanceService } from "@/services/wallet/balance";
const address = "0x" + "1".repeat(40);
test("native results are explicitly allowlisted and invalid chains/accounts fail", async () => {
  for (const result of [
    null,
    {},
    { address, accountIndex: 1, chainId: 10143 },
    { address, accountIndex: 0, chainId: 1 },
  ]) {
    const service = createNativeWalletAccess(() => ({ openWallet: async () => result, lock() {} }));
    await expect(service.request("Passkey")).rejects.toThrow("Invalid native wallet");
  }
  const service = createNativeWalletAccess(() => ({
    openWallet: async () => ({ address, accountIndex: 0, chainId: 10143, extra: "discard" }),
    lock() {},
  }));
  expect(await service.request("Passkey")).toEqual({
    kind: "testnet",
    method: "Passkey",
    address,
    accountIndex: 0,
    chainId: 10143,
    accountId: address,
  });
  await expect(createNativeWalletAccess(() => null).request("Passkey")).rejects.toThrow(
    "unavailable",
  );
});
test("formats integer wei exactly", () => {
  expect(formatMon("0")).toBe("0");
  expect(formatMon("1")).toBe("0.000000000000000001");
  expect(formatMon("123456789123456789123456789")).toBe("123456789.123456789123456789");
  expect(() => formatMon("1e18")).toThrow();
});
const rpc = (chain = "0x279f", balance = "0x1") => [
  { jsonrpc: "2.0", id: 2, result: balance },
  { jsonrpc: "2.0", id: 1, result: chain },
];
test("balance service validates chain, response and quantity without signing", async () => {
  const fetchMock = jest.spyOn(global, "fetch");
  try {
    for (const [index, rows] of [
      rpc(),
      rpc("0x1"),
      rpc("0x279f", "0xgg"),
      [],
      [{ id: 1, error: {} }],
    ].entries()) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => rows } as Response);
      const result = monadBalanceService.getBalance(address, new AbortController().signal);
      if (index === 0) await expect(result).resolves.toBe("1");
      else await expect(result).rejects.toThrow();
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://testnet-rpc.monad.xyz",
      expect.objectContaining({ method: "POST" }),
    );
  } finally {
    fetchMock.mockRestore();
  }
});

test("balance requests abort on timeout and caller cancellation", async () => {
  jest.useFakeTimers();
  const fetchMock = jest.spyOn(global, "fetch").mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  try {
    const controller = new AbortController();
    const timed = monadBalanceService.getBalance(address, controller.signal);
    const timeoutResult = expect(timed).rejects.toThrow("aborted");
    await jest.advanceTimersByTimeAsync(12_000);
    await timeoutResult;
    const pending = monadBalanceService.getBalance(address, controller.signal);
    const cancelled = expect(pending).rejects.toThrow("aborted");
    controller.abort();
    await cancelled;
  } finally {
    fetchMock.mockRestore();
    jest.useRealTimers();
  }
});
