import type {
  CatalogChain,
  OpportunityDetail,
  OpportunityProtocol,
  OpportunityService,
} from "@/domain/opportunities";

type Protocol = Exclude<OpportunityProtocol, "all">;
type Seed = readonly [
  slug: string,
  name: string,
  symbol: string,
  chainId: number,
  apy: number,
  tvl: number,
];

// Official protocol/market names; every rate, balance and chart is a demo fixture.
// Aave: https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Ethereum.sol
// Morpho: https://curator.morpho.org/
// Curvance: https://docs.curvance.com/app/protocol-overview/monad-contract-addresses
//           https://curvance.com/ (High Yield AUSD)
const groups: Record<Protocol, { name: string; vaults: readonly Seed[] }> = {
  aave: {
    name: "Aave",
    vaults: [
      ["usdc", "Aave V3 USDC", "USDC", 1, 4.82, 478_000_000],
      ["usdt", "Aave V3 USDT", "USDT", 1, 5.36, 352_000_000],
      ["weth", "Aave V3 WETH", "WETH", 1, 2.18, 920_000_000],
      ["wbtc", "Aave V3 WBTC", "WBTC", 1, 1.74, 640_000_000],
      ["dai", "Aave V3 DAI", "DAI", 1, 4.15, 186_000_000],
      ["gho", "Aave V3 GHO", "GHO", 1, 5.92, 98_000_000],
    ],
  },
  morpho: {
    name: "Morpho",
    vaults: [
      ["pendle-usdc", "Pendle Ecosystem USDC", "USDC", 1, 6.54, 63_200_000],
      ["steakhouse-usdg", "Steakhouse USDG", "USDG", 4663, 5.17, 539_300_000],
      ["gauntlet-usdc", "Gauntlet USDC Prime", "USDC", 1, 5.82, 125_800_000],
      ["steakhouse-usdc", "Steakhouse Prime USDC", "USDC", 1, 5.46, 108_300_000],
      ["gauntlet-weth", "Gauntlet WETH Prime", "WETH", 1, 3.24, 23_100_000],
      ["steakhouse-usdt", "Steakhouse Prime USDT", "USDT", 1, 6.08, 67_100_000],
    ],
  },
  curvance: {
    name: "Curvance",
    vaults: [
      ["high-yield-ausd", "High Yield AUSD", "AUSD", 143, 12.34, 28_400_000],
      ["wmon-ausd", "WMON / AUSD", "AUSD", 143, 8.62, 19_600_000],
      ["wmon-usdc", "WMON / USDC", "USDC", 143, 7.48, 24_800_000],
      ["wbtc-usdc", "WBTC / USDC", "USDC", 143, 6.92, 16_300_000],
      ["weth-usdc", "WETH / USDC", "USDC", 143, 7.16, 21_700_000],
      ["shmon-wmon", "shMON / WMON", "WMON", 143, 9.52, 13_800_000],
    ],
  },
};
const chains: CatalogChain[] = [
  { id: 1, name: "Ethereum" },
  { id: 4663, name: "Robinhood" },
  { id: 143, name: "Monad" },
];
const decimals = (symbol: string) => (symbol === "USDC" || symbol === "USDT" ? 6 : 18);
const prices: Record<string, number> = { WETH: 3_250, WBTC: 95_000, WMON: 0.04 };

const vaults: OpportunityDetail[] = (["aave", "morpho", "curvance"] as const).flatMap((protocol) =>
  groups[protocol].vaults.map(([slug, name, symbol, chainId, apy, tvl]) => {
    const id = `demo-${protocol}-${slug}`;
    return {
      id,
      name,
      symbol,
      chainId,
      protocol: { id: protocol, name: groups[protocol].name },
      status: "LIVE",
      rateType: "apy",
      totalApr: apy,
      tvl,
      // Empty execution addresses keep these display fixtures outside native deposit policy.
      asset: { address: "", name: symbol, symbol, decimals: decimals(symbol) },
      apr: apy,
      chain: { name: chains.find((chain) => chain.id === chainId)!.name },
      description: `Earn yield with ${groups[protocol].name} using ${symbol}.`,
      action: "SUPPLY",
      type: "DEMO_VAULT",
      dailyRewards: Math.round((tvl * apy) / 100 / 365),
      liveCampaigns: 0,
      nativeApr: apy,
      explorerAddress: "",
      howToSteps: [],
      depositUrl: "",
      identifier: id,
      tags: [protocol, "lending", symbol],
      tokens: [
        {
          id: `${id}-asset`,
          name: symbol,
          symbol,
          address: "",
          decimals: decimals(symbol),
          price: prices[symbol] ?? 1,
        },
      ],
      campaigns: [],
    };
  }),
);

const PAGE_SIZE = 8;
function requireActive(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Vault catalog request cancelled.");
}
function findVault(id: string) {
  const vault = demoVaultMetadata(id);
  if (!vault) throw new Error("Vault not found.");
  return vault;
}

export function demoVaultMetadata(id: string): OpportunityDetail | undefined {
  return vaults.find((vault) => vault.id === id);
}

export function isDemoVaultId(id: string): boolean {
  return demoVaultMetadata(id) !== undefined;
}

/** Local catalog, detail and history responses: no backend or signer calls. */
export const demoOpportunityService: OpportunityService = {
  async chains(signal) {
    requireActive(signal);
    return chains;
  },
  async list(query, signal) {
    requireActive(signal);
    const search = query.search.trim().toLowerCase();
    const matches = vaults.filter(
      (vault) =>
        (query.chainId === undefined || vault.chainId === query.chainId) &&
        (query.protocol === "all" || vault.protocol.id === query.protocol) &&
        `${vault.name} ${vault.symbol} ${vault.protocol.name} ${vault.chain.name}`
          .toLowerCase()
          .includes(search),
    );
    return {
      list: matches.slice(query.page * PAGE_SIZE, (query.page + 1) * PAGE_SIZE),
      total: matches.length,
      page: query.page,
      items: PAGE_SIZE,
      partial: false,
    };
  },
  async detail(id, signal) {
    requireActive(signal);
    return findVault(id);
  },
  async tvlRecords(id, signal) {
    requireActive(signal);
    const vault = findVault(id);
    const offset = vaults.indexOf(vault);
    const trend = offset % 5 === 4 ? -0.04 : 0.12;
    // Newest first; deterministic shapes give each card a distinct, complete chart.
    return Array.from({ length: 30 }, (_, day) => ({
      total:
        day === 0
          ? vault.tvl!
          : Math.round(
              vault.tvl! *
                (1 -
                  (day / 29) * trend +
                  (Math.sin(day * 0.8 + offset) - Math.sin(offset)) * 0.003),
            ),
    }));
  },
};
