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
export interface OpportunityService {
  list(query: OpportunityQuery, signal: AbortSignal): Promise<OpportunityPage>;
}
