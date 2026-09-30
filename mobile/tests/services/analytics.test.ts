import PostHog from "posthog-react-native";
import { createAnalytics } from "@/services/analytics";

jest.mock("posthog-react-native", () => ({ __esModule: true, default: jest.fn() }));
const constructor = jest.mocked(PostHog);
const screen = jest.fn().mockResolvedValue(undefined);
beforeEach(() => {
  constructor.mockReset();
  screen.mockReset().mockResolvedValue(undefined);
  constructor.mockImplementation(() => ({ screen }) as unknown as PostHog);
});

test.each([undefined, "", "phx_private", "phc_", "phc_has spaces"])(
  "does not initialize analytics for invalid key %s",
  async (key) => {
    await createAnalytics({ key }).trackScreen("Home");
    expect(constructor).not.toHaveBeenCalled();
  },
);
test.each([
  "http://example.com",
  "invalid",
  "https://user:pass@example.com",
  "https://example.com/?key=secret",
  "https://example.com/#secret",
  "https://example.com/path",
])("rejects unsafe or malformed host %s", async (host) => {
  await createAnalytics({ key: "phc_test", host }).trackScreen("Home");
  expect(constructor).not.toHaveBeenCalled();
});
test("lazily creates one client and sends only allowed screen names", async () => {
  const service = createAnalytics({ key: " phc_test ", host: " https://eu.i.posthog.com/ " });
  expect(constructor).not.toHaveBeenCalled();
  await service.trackScreen("Home");
  await service.trackScreen("Exchange");
  await service.trackScreen("gizu-dev://access?wallet=secret");
  expect(constructor).toHaveBeenCalledTimes(1);
  expect(constructor).toHaveBeenCalledWith(
    "phc_test",
    expect.objectContaining({
      host: "https://eu.i.posthog.com",
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      errorTracking: { autocapture: false },
      disableSurveys: true,
      preloadFeatureFlags: false,
      personProfiles: "identified_only",
    }),
  );
  expect(screen.mock.calls).toEqual([["Home"], ["Exchange"]]);
  const beforeSend = constructor.mock.calls[0]![1]!.before_send;
  if (typeof beforeSend !== "function") throw new Error("Missing event filter");
  expect(
    beforeSend({
      event: "Application Opened",
      properties: { url: "gizu-dev://access?wallet=secret" },
    }),
  ).toBeNull();
  expect(beforeSend({ event: "$exception", properties: { message: "secret" } })).toBeNull();
  expect(beforeSend(null)).toBeNull();
  const event = { event: "$screen", properties: { $screen_name: "Home" } };
  expect(beforeSend(event)).toEqual(event);
});
test("defaults to the US host", async () => {
  await createAnalytics({ key: "phc_test" }).trackScreen("Home");
  expect(constructor.mock.calls[0]![1]?.host).toBe("https://us.i.posthog.com");
});
test.each(["constructor", "sync", "async"])(
  "contains %s failures without repeated attempts",
  async (failure) => {
    if (failure === "constructor")
      constructor.mockImplementation(() => {
        throw new Error("failed");
      });
    else if (failure === "sync")
      screen.mockImplementation(() => {
        throw new Error("failed");
      });
    else screen.mockRejectedValue(new Error("failed"));
    const service = createAnalytics({ key: "phc_test" });
    await expect(service.trackScreen("Home")).resolves.toBeUndefined();
    await expect(service.trackScreen("Exchange")).resolves.toBeUndefined();
    expect(constructor).toHaveBeenCalledTimes(1);
  },
);
test("default service is disabled in tests even when environment contains a key", async () => {
  const previous = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  try {
    process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";
    let service!: ReturnType<typeof createAnalytics>;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      service = require("@/services/analytics").analytics;
    });
    await service.trackScreen("Home");
    expect(constructor).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    else process.env.EXPO_PUBLIC_POSTHOG_KEY = previous;
  }
});
