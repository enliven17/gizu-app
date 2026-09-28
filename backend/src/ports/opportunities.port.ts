import type { ProtocolSelection } from "../domain/protocol.ts";

export type Opportunity = {
  id: string;
  name: string;
  status: string;
  apr: number;
  totalApr: number;
  tvl: number;
  chainId: number;
  chain: {
    id: number;
    name: string;
  };
  protocol: {
    id: string;
    name: string;
  };
};

export type TvlRecord = {
  total: number;
};

export type ListOpportunitiesQuery = {
  protocol: ProtocolSelection;
  search: string;
  page: number;
  items: number;
  chainId: number;
};

export type OpportunityPage = {
  list: Opportunity[];
  total: number;
};

export type TvlRecordsQuery = {
  id: string;
  items: number;
};

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
  startTimestamp: number;
  endTimestamp: number;
  creatorAddress: string;
};

export type OpportunityDetail = Opportunity & {
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

export interface Opportunities {
  list(query: ListOpportunitiesQuery): Promise<OpportunityPage>;
  getById(id: string): Promise<OpportunityDetail>;
  tvlRecords(query: TvlRecordsQuery): Promise<TvlRecord[]>;
}
