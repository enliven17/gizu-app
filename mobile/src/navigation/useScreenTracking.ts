import { useRef } from "react";
import type { AnalyticsService } from "@/services/analytics";

type Navigation = { getCurrentRoute(): { key: string; name: string } | undefined };

export function useScreenTracking(navigation: Navigation, analytics: AnalyticsService) {
  const previousKey = useRef<string | undefined>(undefined);
  const track = () => {
    const route = navigation.getCurrentRoute();
    if (!route || route.key === previousKey.current) return;
    previousKey.current = route.key;
    try {
      void analytics.trackScreen(route.name).catch(() => {});
    } catch {
      /* Optional telemetry. */
    }
  };
  return {
    onReady: () => {
      // Session replacement recreates navigation while this hook stays mounted.
      previousKey.current = undefined;
      track();
    },
    onStateChange: track,
  };
}
