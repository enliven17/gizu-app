import type {
  Opportunity,
  OpportunityDetail,
  OpportunityPage,
  OpportunityService,
  TvlRecord,
} from "@/domain/opportunities";

export const mainnetOpportunity = (n: number): Opportunity => ({
  id: `op-${n}`,
  name: `Mainnet vault ${n}`,
  chainId: 143,
  protocol: { id: "aave", name: "Aave" },
  status: "LIVE",
  totalApr: 6.1,
  tvl: 1_000_000,
});

export const opportunityPage = (list: Opportunity[]): OpportunityPage => ({
  list,
  page: 0,
  items: 8,
  total: list.length,
});

export const opportunityDetail = (n: number): OpportunityDetail => ({
  ...mainnetOpportunity(n),
  apr: 4.25,
  chain: { name: "Monad" },
  description: "Supply USDC to earn lending yield.",
  action: "LEND",
  type: "AAVE_SUPPLY",
  dailyRewards: 1500,
  liveCampaigns: 2,
  nativeApr: 1.85,
  explorerAddress: "0x" + "a".repeat(40),
  howToSteps: ["Supply USDC on Aave", "Hold the receipt token"],
  depositUrl: "https://app.aave.com/reserve",
  identifier: "0x" + "b".repeat(40),
  tags: ["stable", "lending"],
  tokens: [
    {
      id: "t-1",
      name: "USD Coin",
      symbol: "USDC",
      address: "0x" + "c".repeat(40),
      decimals: 6,
      price: 1,
    },
  ],
  campaigns: [
    {
      id: "c-1",
      campaignId: "0x" + "d".repeat(64),
      type: "Lending incentive",
      apr: 1.2,
      dailyRewards: 250,
      startTimestamp: 1_767_225_600,
      endTimestamp: 1_769_904_000,
      creatorAddress: "0x" + "e".repeat(40),
    },
  ],
});

/** Newest first, as the backend returns them: TVL grew from 900k to 1M. */
export const tvlRecords: TvlRecord[] = [
  { total: 1_000_000 },
  { total: 950_000 },
  { total: 900_000 },
];

type Mocked<K extends keyof OpportunityService> = jest.Mock<
  ReturnType<NonNullable<OpportunityService[K]>>,
  Parameters<NonNullable<OpportunityService[K]>>
>;
export type MockOpportunityService = {
  list: Mocked<"list">;
  detail: Mocked<"detail">;
  tvlRecords: Mocked<"tvlRecords">;
};

/** Fresh mocked catalog adapter (a new instance also means an empty TVL cache). */
export function mockOpportunityService(list: Opportunity[] = [mainnetOpportunity(1)]) {
  const service: MockOpportunityService = {
    list: jest.fn<ReturnType<OpportunityService["list"]>, Parameters<OpportunityService["list"]>>(),
    detail: jest.fn<
      ReturnType<OpportunityService["detail"]>,
      Parameters<OpportunityService["detail"]>
    >(),
    tvlRecords: jest.fn<
      ReturnType<OpportunityService["tvlRecords"]>,
      Parameters<OpportunityService["tvlRecords"]>
    >(),
  };
  service.list.mockResolvedValue(opportunityPage(list));
  service.detail.mockImplementation(async (id) => opportunityDetail(Number(id.slice(3))));
  service.tvlRecords.mockResolvedValue(tvlRecords);
  return service;
}
