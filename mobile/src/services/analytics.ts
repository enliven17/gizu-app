import PostHog from "posthog-react-native";

export interface AnalyticsService {
  trackScreen(name: string): Promise<void>;
}

// Only navigation names are accepted; callers cannot attach properties.
const screens = new Set([
  "Welcome",
  "Access",
  "RequestAccess",
  "Home",
  "Vaults",
  "Exchange",
  "Settings",
  "VaultDetail",
  "OpportunityDetail",
  "Activity",
  "Notifications",
  "AccountPage",
  "Transaction",
]);

export function createAnalytics(config: { key?: string; host?: string }): AnalyticsService {
  const key = config.key?.trim();
  let host: string | undefined;
  try {
    const url = new URL(config.host?.trim() || "https://us.i.posthog.com");
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    )
      host = url.origin;
  } catch {
    /* Invalid configuration keeps analytics off. */
  }

  let client: PostHog | undefined;
  let failed = false;
  return {
    async trackScreen(name) {
      if (!key || !/^phc_[a-zA-Z0-9]+$/.test(key) || !host || failed || !screens.has(name)) return;
      try {
        client ??= new PostHog(key, {
          host,
          captureAppLifecycleEvents: false,
          enableSessionReplay: false,
          errorTracking: { autocapture: false },
          disableSurveys: true,
          preloadFeatureFlags: false,
          personProfiles: "identified_only",
          before_send: (event) => (event?.event === "$screen" ? event : null),
        });
        await client.screen(name);
      } catch {
        // Telemetry must never interrupt navigation or log wallet context.
        failed = true;
      }
    },
  };
}

// Ordinary tests never initialize the SDK, even with local environment keys.
export const analytics = createAnalytics({
  key: process.env.NODE_ENV === "test" ? undefined : process.env.EXPO_PUBLIC_POSTHOG_KEY,
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
});
