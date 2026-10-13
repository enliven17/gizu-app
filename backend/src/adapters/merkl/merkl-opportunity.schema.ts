import { z } from "zod";

const publicMetric = z.number().finite().nullish().transform((value) => value ?? null);

export const opportunitySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  apr: publicMetric,
  totalApr: publicMetric,
  tvl: publicMetric,
  chainId: z.number(),
  chain: z.looseObject({
    id: z.number(),
    name: z.string(),
  }),
  protocol: z.looseObject({
    id: z.string(),
    name: z.string(),
  }),
});

export const opportunityListSchema = z.array(opportunitySchema);

export const opportunityCountSchema = z.number();

export const opportunityTokenSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  symbol: z.string(),
  address: z.string(),
  decimals: z.number(),
  price: publicMetric,
});

export const opportunityCampaignSchema = z.looseObject({
  id: z.string(),
  campaignId: z.string(),
  type: z.string(),
  apr: z.number(),
  dailyRewards: z.number(),
  startTimestamp: z.number(),
  endTimestamp: z.number(),
  creatorAddress: z.string(),
});

export const opportunityDetailSchema = opportunitySchema.extend({
  description: z.string(),
  action: z.string(),
  type: z.string(),
  dailyRewards: publicMetric,
  liveCampaigns: z.number().nullish().transform((value) => value ?? 0),
  nativeApr: publicMetric,
  explorerAddress: z.string(),
  howToSteps: z.array(z.string()),
  depositUrl: z.string(),
  identifier: z.string(),
  tags: z.array(z.string()),
  tokens: z.array(opportunityTokenSchema),
  campaigns: z.array(opportunityCampaignSchema),
});

export const tvlRecordSchema = z.looseObject({
  total: z.number(),
});

export const tvlRecordListSchema = z.array(tvlRecordSchema);

export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;
export type TvlRecord = z.infer<typeof tvlRecordSchema>;
