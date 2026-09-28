import type { ExpoConfig } from "expo/config";
import { identity, validatePasskeyMode } from "./src/config/passkeys";

validatePasskeyMode(process.env.EXPO_PUBLIC_PASSKEY_MODE);

// Release identity and real services must be selected before shipping this demo.
if (process.env.EAS_BUILD_PROFILE === "production") {
  throw new Error(
    "Production builds are blocked until release identity and services are configured.",
  );
}

const config: ExpoConfig = {
  name: "Gizu Dev",
  slug: "gizu-mobile",
  version: "0.1.0",
  scheme: "gizu-dev",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: identity.iosBundleIdentifier,
    appleTeamId: identity.appleTeamId,
    supportsTablet: false,
    associatedDomains: [`webcredentials:${identity.rpId}`],
  },
  android: { package: identity.androidPackage },
  plugins: [
    [
      "expo-splash-screen",
      {
        backgroundColor: "#050706",
        android: { image: "./assets/splash-logo.png", imageWidth: 80 },
      },
    ],
    "./plugins/withAndroidDevelopmentSigning.cjs",
    "./plugins/withStoredSignerIos.cjs",
  ],
};
export default config;
