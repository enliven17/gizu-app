import { z } from "zod";

const httpsUrl = z.url().refine((value) => value.startsWith("https://"));
export const catalogAddress = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .refine((value) => !/^0x0{40}$/i.test(value));
export const catalogChainSchema = z.strictObject({
  id: z.number().int().positive().safe(),
  name: z.string().trim().min(1).max(80),
  explorerUrl: httpsUrl.optional(),
});
export const catalogVaultSchema = z.strictObject({
  chainId: z.number().int().positive().safe(),
  address: catalogAddress,
  name: z.string().trim().min(1).max(160).optional(),
  symbol: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(4000).optional(),
  depositUrl: httpsUrl.optional(),
  howToSteps: z.array(z.string().min(1).max(1000)).max(20).optional(),
  tags: z.array(z.string().min(1).max(80)).max(20).optional(),
  asset: z
    .strictObject({
      address: catalogAddress,
      name: z.string().min(1).max(160),
      symbol: z.string().min(1).max(40),
      decimals: z.number().int().min(0).max(36),
    })
    .optional(),
});
export type CatalogChain = z.infer<typeof catalogChainSchema>;
export type CatalogVault = z.infer<typeof catalogVaultSchema>;
/** Featured is assigned by server configuration, never a native execution capability. */
export type CatalogEntry = CatalogVault & { featured?: boolean };
export type CatalogAsset = NonNullable<CatalogVault["asset"]>;
export const defaultCatalogChains: CatalogChain[] = [
  { id: 4663, name: "Robinhood" },
  { id: 1, name: "Ethereum" },
  { id: 143, name: "Monad" },
];
export const vaultChainsEnvironment = z
  .string()
  .max(1024)
  .transform((value) => value.split(",").map((id) => id.trim()))
  .pipe(
    z
      .array(z.string().regex(/^[1-9][0-9]*$/))
      .min(1)
      .max(64),
  )
  .transform((ids) => ids.map(Number))
  .pipe(z.array(z.number().int().positive().safe()))
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "chain IDs must be unique",
  );

export function resolveCatalogChains(config: {
  VAULT_CHAINS?: number[];
  CATALOG_CHAINS_JSON?: CatalogChain[];
}): CatalogChain[] {
  if (!config.VAULT_CHAINS)
    return config.CATALOG_CHAINS_JSON ?? defaultCatalogChains;
  const known = new Map(
    [...defaultCatalogChains, ...(config.CATALOG_CHAINS_JSON ?? [])].map(
      (chain) => [chain.id, chain],
    ),
  );
  return config.VAULT_CHAINS.map((id) => {
    const chain = known.get(id);
    if (!chain) throw new Error(`VAULT_CHAINS: unknown chain ID ${id}`);
    return chain;
  });
}
const catalogAssets: Record<number, CatalogAsset[]> = {
  1: [
    {
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
    },
    {
      address: "0xe343167631d89B6Ffc58B88d6b7fB0228795491D",
      name: "Global Dollar",
      symbol: "USDG",
      decimals: 6,
    },
  ],
  4663: [
    {
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      name: "Global Dollar",
      symbol: "USDG",
      decimals: 6,
    },
  ],
  143: [
    {
      address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
      name: "USD Coin",
      symbol: "USDC",
      decimals: 6,
    },
  ],
};
/** Match the actual underlying contract, never a receipt symbol or reward token. */
export function catalogAsset(
  chainId: number,
  asset?: CatalogAsset,
): CatalogAsset | undefined {
  return catalogAssets[chainId]?.find(
    (known) =>
      known.address.toLowerCase() === asset?.address.toLowerCase() &&
      known.decimals === asset.decimals,
  );
}
export const defaultCatalogVaults: CatalogVault[] = [
  {
    chainId: 4663,
    address: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd",
    name: "Steakhouse USDG",
    asset: catalogAssets[4663]![0]!,
  },
  {
    chainId: 1,
    address: "0x55C1B6e461a6334B567bAF0FEb5D728715446f05",
    name: "Pendle USDC",
    asset: catalogAssets[1]![0]!,
  },
];

export function resolveCatalogVaults(
  config: { CATALOG_VAULTS_JSON?: CatalogVault[] },
  chains: CatalogChain[],
): CatalogEntry[] {
  const key = (vault: CatalogVault) =>
    `${vault.chainId}:${vault.address.toLowerCase()}`;
  const entries = new Map<string, CatalogEntry>(
    defaultCatalogVaults.map((vault) => [key(vault), vault]),
  );
  for (const vault of config.CATALOG_VAULTS_JSON ?? []) {
    entries.set(key(vault), {
      ...entries.get(key(vault)),
      ...vault,
      featured: true,
    });
  }
  const enabled = new Set(chains.map((chain) => chain.id));
  return [...entries.values()].filter((vault) => enabled.has(vault.chainId));
}

export function jsonEnvironment<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .max(65536)
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({
          code: "custom",
          message: "must contain valid JSON",
        });
        return z.NEVER;
      }
    })
    .pipe(schema);
}
export const catalogChainsSchema = z
  .array(catalogChainSchema)
  .min(1)
  .max(64)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "chain IDs must be unique",
  );
export const catalogVaultsSchema = z
  .array(catalogVaultSchema)
  .max(64)
  .refine(
    (rows) =>
      new Set(rows.map((row) => `${row.chainId}:${row.address.toLowerCase()}`))
        .size === rows.length,
    "vault chain/address pairs must be unique",
  );
