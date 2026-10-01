import { getJson } from "@/services/http";

const originalFetch = global.fetch;
const url = "https://example.com/private?token=secret";
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

test.each([404, 429, 503])(
  "HTTP %s uses a safe context message without reading the body",
  async (status) => {
    const json = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status, json });
    await expect(
      getJson(url, new AbortController().signal, "Catalog unavailable."),
    ).rejects.toMatchObject({
      code: "unavailable",
      userMessage: "Catalog unavailable.",
    });
    expect(json).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  },
);
test("network failures strip URLs and raw error descriptions", async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error(url));
  const result = getJson(url, new AbortController().signal, "Catalog unavailable.");
  await expect(result).rejects.toMatchObject({ code: "network" });
  await expect(result).rejects.not.toThrow("secret");
  expect(jest.getTimerCount()).toBe(0);
});
test("pre-cancelled requests never call fetch", async () => {
  global.fetch = jest.fn();
  const controller = new AbortController();
  controller.abort();
  await expect(getJson(url, controller.signal, "Unavailable")).rejects.toMatchObject({
    code: "cancelled",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test.each(["cancelled", "timeout"])(
  "%s during body reading wins over a late success",
  async (code) => {
    let finish!: (value: unknown) => void;
    const body = new Promise((resolve) => {
      finish = resolve;
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => body });
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, "removeEventListener");
    const result = getJson(url, controller.signal, "Unavailable");
    const assertion = expect(result).rejects.toMatchObject({ code });
    await Promise.resolve();
    if (code === "cancelled") controller.abort();
    else await jest.advanceTimersByTimeAsync(12000);
    finish({ data: "late" });
    await assertion;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  },
);
test("malformed JSON is classified without exposing its contents", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => {
      throw new SyntaxError("secret");
    },
  });
  const result = getJson(url, new AbortController().signal, "Unavailable");
  await expect(result).rejects.toMatchObject({ code: "invalid-response" });
  await expect(result).rejects.not.toThrow("secret");
});
