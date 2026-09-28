import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { distributionConfig, testFlightBundleIdentifier } from "@/config/distribution";

test("TestFlight explicitly selects the iOS beta identity", () => {
  expect(
    distributionConfig({ EAS_BUILD_PROFILE: "testflight", EAS_BUILD_PLATFORM: "ios" }),
  ).toEqual({
    testflight: true,
    testFlightBundleIdentifier: "io.gizo.ios",
  });
  expect(distributionConfig({}).testflight).toBe(false);
  expect(distributionConfig({ GIZU_BUILD_VARIANT: "testflight" }).testflight).toBe(true);
});

test("production, diagnostic entry points and Android TestFlight builds remain blocked", () => {
  expect(() => distributionConfig({ EAS_BUILD_PROFILE: "production" })).toThrow("blocked");
  expect(() =>
    distributionConfig({ EAS_BUILD_PROFILE: "testflight", EXPO_PUBLIC_DEBUG_SCREEN: "ui" }),
  ).toThrow("diagnostic");
  expect(() =>
    distributionConfig({ EAS_BUILD_PROFILE: "testflight", EAS_BUILD_PLATFORM: "android" }),
  ).toThrow("iOS-only");
});

test("the frontend association includes the TestFlight identity", () => {
  const association = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../frontend/public/.well-known/apple-app-site-association"),
      "utf8",
    ),
  );
  expect(association.webcredentials.apps).toContain(`588X2UZY3L.${testFlightBundleIdentifier}`);
});

test.each([
  "http://api.gizu.io",
  "https://localhost",
  "https://127.0.0.1",
  "https://192.168.1.2",
  "https://[::1]",
  "https://api.local",
  "https://user:password@api.gizu.io",
])("TestFlight rejects a local or unsafe catalog endpoint: %s", (url) => {
  expect(() =>
    distributionConfig({ EAS_BUILD_PROFILE: "testflight", EXPO_PUBLIC_API_URL: url }),
  ).toThrow();
});
test("TestFlight accepts a public HTTPS URL or an unconfigured catalog", () => {
  expect(
    distributionConfig({
      EAS_BUILD_PROFILE: "testflight",
      EXPO_PUBLIC_API_URL: "https://api.gizu.io",
    }).testflight,
  ).toBe(true);
  expect(distributionConfig({ EAS_BUILD_PROFILE: "testflight" }).testflight).toBe(true);
});
