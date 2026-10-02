import { getJson } from "./http";
import type {
  Opportunity,
  OpportunityCampaign,
  OpportunityDetail,
  OpportunityPage,
  OpportunityService,
  OpportunityToken,
  TvlRecord,
  CatalogChain,
} from "@/domain/opportunities";

/** Frontend requests the latest 30 TVL records per vault. */
const TVL_ITEMS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isMetric(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}
function hasOpportunityFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    (value.symbol === undefined || typeof value.symbol === "string") &&
    typeof value.chainId === "number" &&
    Number.isSafeInteger(value.chainId) &&
    value.chainId > 0 &&
    (value.vaultAddress === undefined ||
      (typeof value.vaultAddress === "string" && /^0x[0-9a-f]{40}$/i.test(value.vaultAddress))) &&
    (value.rateType === undefined || value.rateType === "apr" || value.rateType === "apy") &&
    isRecord(value.protocol) &&
    typeof value.protocol.id === "string" &&
    typeof value.protocol.name === "string" &&
    typeof value.status === "string" &&
    isMetric(value.totalApr) &&
    isMetric(value.tvl) &&
    (value.tvl === null || value.tvl >= 0)
  );
}
function isOpportunity(value: unknown): value is Opportunity {
  return isRecord(value) && hasOpportunityFields(value);
}
function isToken(value: unknown): value is OpportunityToken {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.symbol === "string" &&
    typeof value.address === "string" &&
    isFiniteNumber(value.decimals) &&
    isMetric(value.price)
  );
}
function isCampaign(value: unknown): value is OpportunityCampaign {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.campaignId === "string" &&
    typeof value.type === "string" &&
    isFiniteNumber(value.apr) &&
    isFiniteNumber(value.dailyRewards) &&
    isFiniteNumber(value.startTimestamp) &&
    isFiniteNumber(value.endTimestamp) &&
    typeof value.creatorAddress === "string"
  );
}
function isDetail(value: unknown): value is OpportunityDetail {
  return (
    isRecord(value) &&
    hasOpportunityFields(value) &&
    isMetric(value.apr) &&
    isRecord(value.chain) &&
    typeof value.chain.name === "string" &&
    typeof value.description === "string" &&
    typeof value.action === "string" &&
    typeof value.type === "string" &&
    isMetric(value.dailyRewards) &&
    isFiniteNumber(value.liveCampaigns) &&
    isMetric(value.nativeApr) &&
    typeof value.explorerAddress === "string" &&
    isStringArray(value.howToSteps) &&
    typeof value.depositUrl === "string" &&
    typeof value.identifier === "string" &&
    isStringArray(value.tags) &&
    Array.isArray(value.tokens) &&
    value.tokens.every(isToken) &&
    Array.isArray(value.campaigns) &&
    value.campaigns.every(isCampaign)
  );
}
function isTvlRecord(value: unknown): value is TvlRecord {
  return isRecord(value) && isFiniteNumber(value.total) && value.total >= 0;
}

export function createOpportunityService(baseUrl: string): OpportunityService {
  const root = baseUrl.replace(/\/$/, "");
  let enabledChains = new Set([143]);
  let hasChainCatalog = false;
  function configured() {
    if (!baseUrl) throw new Error("Vault catalog is not configured.");
  }
  return {
    async chains(signal) {
      configured();
      const body = await getJson(`${root}/v1/chains`, signal, "Chain catalog unavailable.");
      if (
        !isRecord(body) ||
        !Array.isArray(body.list) ||
        body.list.length === 0 ||
        body.list.length > 64 ||
        !body.list.every(
          (row) =>
            isRecord(row) &&
            typeof row.id === "number" &&
            Number.isSafeInteger(row.id) &&
            row.id > 0 &&
            typeof row.name === "string" &&
            row.name.trim().length > 0 &&
            (row.explorerUrl === undefined ||
              (typeof row.explorerUrl === "string" && /^https:\/\//.test(row.explorerUrl))),
        ) ||
        new Set(body.list.map((row) => row.id)).size !== body.list.length
      ) {
        throw new Error("Invalid chain catalog response.");
      }
      enabledChains = new Set(body.list.map((row) => row.id as number));
      hasChainCatalog = true;
      return body.list as CatalogChain[];
    },
    async list(query, signal) {
      configured();
      const path =
        query.protocol === "all"
          ? "/v1/opportunities"
          : `/v1/protocols/${query.protocol}/opportunities`;
      const chainId = query.chainId ?? 143;
      if (hasChainCatalog && !enabledChains.has(chainId))
        throw new Error("Chain is not available in the vault catalog.");
      const params = `chainId=${chainId}&page=${query.page}&items=8&search=${encodeURIComponent(query.search)}`;
      const body = await getJson(`${root}${path}?${params}`, signal, "Vault catalog unavailable.");
      if (
        !isRecord(body) ||
        !Array.isArray(body.list) ||
        !body.list.every(isOpportunity) ||
        body.list.some((row) => row.chainId !== chainId) ||
        (body.partial !== undefined && typeof body.partial !== "boolean") ||
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
      enabledChains.add(chainId);
      return body as OpportunityPage;
    },
    async detail(id, signal) {
      configured();
      const body = await getJson(
        `${root}/v1/opportunities/${encodeURIComponent(id)}`,
        signal,
        "Vault unavailable.",
      );
      if (
        !isRecord(body) ||
        !isDetail(body.opportunity) ||
        body.opportunity.id !== id ||
        !enabledChains.has(body.opportunity.chainId)
      ) {
        throw new Error("Invalid vault response.");
      }
      return body.opportunity;
    },
    async tvlRecords(id, signal) {
      configured();
      const body = await getJson(
        `${root}/v1/opportunities/${encodeURIComponent(id)}/tvl-records?items=${TVL_ITEMS}`,
        signal,
        "Vault history unavailable.",
      );
      if (
        !isRecord(body) ||
        !Array.isArray(body.list) ||
        body.list.length > TVL_ITEMS ||
        !body.list.every(isTvlRecord)
      ) {
        throw new Error("Invalid vault history response.");
      }
      return body.list.map((row) => ({ total: row.total }));
    },
  };
}
// USB development uses adb reverse tcp:3000 tcp:3000. Release builds require an explicit URL.
export const opportunityService = createOpportunityService(
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://127.0.0.1:3000" : ""),
);
