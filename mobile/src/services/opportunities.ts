import type { Opportunity, OpportunityPage, OpportunityService } from "@/domain/opportunities";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isOpportunity(value: unknown): value is Opportunity {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.chainId === 143 &&
    isRecord(value.protocol) &&
    typeof value.protocol.id === "string" &&
    typeof value.protocol.name === "string" &&
    typeof value.status === "string" &&
    typeof value.totalApr === "number" &&
    Number.isFinite(value.totalApr) &&
    typeof value.tvl === "number" &&
    Number.isFinite(value.tvl) &&
    value.tvl >= 0
  );
}
export function createOpportunityService(baseUrl: string): OpportunityService {
  return {
    async list(query, signal) {
      if (!baseUrl) throw new Error("Vault catalog is not configured.");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort);
      if (signal.aborted) abort();
      const timeout = setTimeout(abort, 12_000);
      try {
        const path =
          query.protocol === "all"
            ? "/v1/opportunities"
            : `/v1/protocols/${query.protocol}/opportunities`;
        const params = `chainId=143&page=${query.page}&items=8&search=${encodeURIComponent(query.search)}`;
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Vault catalog unavailable.");
        const body: unknown = await response.json();
        if (
          !isRecord(body) ||
          !Array.isArray(body.list) ||
          !body.list.every(isOpportunity) ||
          body.page !== query.page ||
          body.items !== 8 ||
          typeof body.total !== "number" ||
          !Number.isSafeInteger(body.total) ||
          body.total < 0 ||
          body.list.length > 8 ||
          new Set(body.list.map((row) => row.id)).size !== body.list.length
        ) {
          throw new Error("Invalid vault catalog response.");
        }
        return body as OpportunityPage;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
// USB development uses adb reverse tcp:3000 tcp:3000. Release builds require an explicit URL.
export const opportunityService = createOpportunityService(
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://127.0.0.1:3000" : ""),
);
