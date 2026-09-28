// @ts-check
// Build-time values only. Wallet authority is enforced by the signed native binary.
const { isIP } = require("node:net");
const testFlightBundleIdentifier = "io.gizo.ios";

/** @param {Record<string, string | undefined>} env */
function distributionConfig(env) {
  if (env.EAS_BUILD_PROFILE === "production") {
    throw new Error(
      "Production builds remain blocked. Use the testflight profile for testnet beta testing.",
    );
  }
  // Profile env is available during local EAS credential/config resolution too.
  const testflight =
    env.GIZU_BUILD_VARIANT === "testflight" || env.EAS_BUILD_PROFILE === "testflight";
  if (testflight && env.EXPO_PUBLIC_DEBUG_SCREEN) {
    throw new Error("TestFlight builds cannot select diagnostic screens.");
  }
  if (testflight && env.EAS_BUILD_PLATFORM && env.EAS_BUILD_PLATFORM !== "ios") {
    throw new Error("The TestFlight profile is iOS-only.");
  }
  if (testflight && env.EXPO_PUBLIC_API_URL) {
    const url = new URL(env.EXPO_PUBLIC_API_URL);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      isIP(host) ||
      !host.includes(".") ||
      /\.(localhost|local|internal|test)$/.test(host)
    ) {
      throw new Error(
        "TestFlight requires a public HTTPS backend URL without credentials, query or fragment.",
      );
    }
  }
  return { testflight, testFlightBundleIdentifier };
}
module.exports = { distributionConfig, testFlightBundleIdentifier };
