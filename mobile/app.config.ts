import type { ExpoConfig } from "expo/config";
import { identity, validatePasskeyMode } from "./src/config/passkeys";

import { distributionConfig } from "./src/config/distribution";

validatePasskeyMode(process.env.EXPO_PUBLIC_PASSKEY_MODE);

const { testflight, testFlightBundleIdentifier } = distributionConfig(process.env);

const config: ExpoConfig = {
  name: testflight ? "Gizu" : "Gizu Dev",
  slug: "gizu-mobile",
  owner: "okanaslan",
  extra: {
    eas: { projectId: "6f1c36fc-416b-46ec-a3fd-0d5302cbbdce" },
  },
  version: "0.1.0",
  icon: "./assets/icon.png",
  scheme: testflight ? "gizu" : "gizu-dev",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: testflight ? testFlightBundleIdentifier : identity.iosBundleIdentifier,
    appleTeamId: identity.appleTeamId,
    supportsTablet: false,
    buildNumber: "3",
    infoPlist: {
      GizuTestnetWalletEnabled: testflight,
      // Standard cryptography only; France is excluded from distribution (see README).
      ITSAppUsesNonExemptEncryption: false,
    },
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
