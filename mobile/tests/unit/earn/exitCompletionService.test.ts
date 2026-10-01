import { createEarnExitCompletionService } from "@/services/earn/exitCompletion";
import { hoodIntent } from "../../support/robinhoodEarn";
import { exitSnapshot, returnRow } from "../../support/exitCompletion";
afterEach(() => jest.restoreAllMocks());
test("explicit check refreshes injected native journal before owner-only API and never spends", async () => {
  const now = 1000000,
    list = jest.fn().mockResolvedValue([returnRow()]),
    fetcher = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => exitSnapshot(now) } as Response);
  const s = createEarnExitCompletionService(
    "https://backend.test",
    { robinhood: { list }, liquidity: { list: jest.fn() } },
    () => now,
  );
  expect(list).not.toHaveBeenCalled();
  const r = await s.check(hoodIntent, new AbortController().signal);
  expect(r.complete).toBe(true);
  expect(list).toHaveBeenCalledWith(hoodIntent);
  expect(fetcher).toHaveBeenCalledWith(
    "https://backend.test/v1/earn/exit-snapshot",
    expect.objectContaining({
      body: JSON.stringify({
        profileId: "robinhood-usdg",
        owner: hoodIntent.destinations[1].address,
      }),
    }),
  );
  list.mockResolvedValueOnce([{ ...returnRow(), status: "pending", blocked: true }]);
  await expect(s.check(hoodIntent, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
