import PostHog from "posthog-react-native";

// Project key (phc_) only: it is public by design. Never use a personal key (phx_) here.
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

// No key (jest, local runs) disables capture instead of needing a no-op adapter.
// Events stay anonymous per install: never identify with or attach wallet addresses,
// amounts or transaction hashes.
export const analytics = new PostHog(apiKey || "disabled", {
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
  disabled: !apiKey?.startsWith("phc_"),
  captureAppLifecycleEvents: true,
  personProfiles: "identified_only",
});
