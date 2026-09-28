export const opportunityProtocols = ["all", "aave", "morpho", "curvance"] as const;
export type OpportunityProtocol = (typeof opportunityProtocols)[number];
export type Opportunity = {
  id: string;
  name: string;
  chainId: 143;
  protocol: { id: string; name: string };
  status: string;
  totalApr: number;
  tvl: number;
};
export type OpportunityQuery = { search: string; protocol: OpportunityProtocol; page: number };
export type OpportunityPage = { list: Opportunity[]; total: number; page: number; items: number };
export type OpportunityToken = {
  id: string;
  name: string;
  symbol: string;
  address: string;
  decimals: number;
  price: number;
};
export type OpportunityCampaign = {
  id: string;
  campaignId: string;
  type: string;
  apr: number;
  dailyRewards: number;
  /** Unix seconds. */
  startTimestamp: number;
  /** Unix seconds. */
  endTimestamp: number;
  creatorAddress: string;
};
/** Backend `GET /v1/opportunities/:id` → `{ opportunity }`. */
export type OpportunityDetail = Opportunity & {
  apr: number;
  chain: { name: string };
  description: string;
  action: string;
  type: string;
  dailyRewards: number;
  liveCampaigns: number;
  nativeApr: number;
  explorerAddress: string;
  howToSteps: string[];
  depositUrl: string;
  identifier: string;
  tags: string[];
  tokens: OpportunityToken[];
  campaigns: OpportunityCampaign[];
};
/** Backend `GET /v1/opportunities/:id/tvl-records` row, newest first. */
export type TvlRecord = { total: number };
export interface OpportunityService {
  list(query: OpportunityQuery, signal: AbortSignal): Promise<OpportunityPage>;
  detail(id: string, signal: AbortSignal): Promise<OpportunityDetail>;
  tvlRecords(id: string, signal: AbortSignal): Promise<TvlRecord[]>;
}

/** TVL records arrive newest first; charts plot oldest → newest (frontend reverses). */
export function tvlSeries(records: TvlRecord[]): number[] {
  return records.map((row) => row.total).reverse();
}

/** Frontend card change: last sample vs the one before, in percent; null when undefined. */
export function tvlChange(series: number[]): number | null {
  const previous = series[series.length - 2];
  const latest = series[series.length - 1];
  if (previous === undefined || latest === undefined || previous === 0) return null;
  return ((latest - previous) / previous) * 100;
}

/** Only plain https deposit pages are offered as external links. */
export function safeExternalUrl(url: string): string | null {
  return /^https:\/\/[^\s]+$/i.test(url) ? url : null;
}
