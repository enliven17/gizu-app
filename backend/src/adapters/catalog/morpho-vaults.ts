import { z } from "zod";
import { catalogAddress } from "../../domain/catalog.ts";

const vaultSchema = z.object({
  address: catalogAddress,
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  metadata: z.object({ description: z.string().nullish() }).nullish(),
  asset: z
    .object({
      address: catalogAddress,
      name: z.string(),
      symbol: z.string(),
      decimals: z.number().int().min(0).max(36),
    })
    .nullish(),
  state: z
    .object({
      netApy: z.number().finite().nullish(),
      totalAssetsUsd: z.number().nonnegative().nullish(),
    })
    .nullish(),
  netApy: z.number().finite().nullish(),
  totalAssetsUsd: z.number().nonnegative().nullish(),
});

export type VaultMetadata = {
  name?: string;
  symbol?: string;
  description?: string;
  asset?: { address: string; name: string; symbol: string; decimals: number };
  netApy?: number;
  totalAssetsUsd?: number;
};
export interface VaultMetadataSource {
  lookup(chainId: number, address: string, signal?: AbortSignal): Promise<VaultMetadata | null>;
}

/** Public metadata only. Unknown metrics remain unknown; no transaction construction. */
export class MorphoVaults implements VaultMetadataSource {
  constructor(
    private readonly url = "https://api.morpho.org/graphql",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async lookup(
    chainId: number,
    address: string,
    signal?: AbortSignal,
  ): Promise<VaultMetadata | null> {
    const fields =
      "address name symbol asset { address name symbol decimals } metadata { description }";
    const read = async (version: "v1" | "v2") => {
      const selection =
        version === "v1"
          ? `vaultByAddress(address: $address, chainId: $chainId) { ${fields} state { netApy totalAssetsUsd } }`
          : `vaultV2ByAddress(address: $address, chainId: $chainId) { ${fields} netApy totalAssetsUsd }`;
      const query = `query Vault($address: String!, $chainId: Int!) { ${version}: ${selection} }`;
      try {
        const response = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables: { address, chainId } }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as {
          data?: { v1?: unknown; v2?: unknown };
        };
        return body?.data?.[version] ?? null;
      } catch {
        return null;
      }
    };
    // These root fields are non-nullable: a missing version nulls the entire query.
    const [v2, v1] = await Promise.all([read("v2"), read("v1")]);
    for (const value of [v2, v1]) {
      const parsed = vaultSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.address.toLowerCase() !== address.toLowerCase()
      )
        continue;
      const vault = parsed.data;
      return {
        name: vault.name || undefined,
        symbol: vault.symbol || undefined,
        description: vault.metadata?.description || undefined,
        asset: vault.asset ?? undefined,
        netApy: vault.state?.netApy ?? vault.netApy ?? undefined,
        totalAssetsUsd:
          vault.state?.totalAssetsUsd ?? vault.totalAssetsUsd ?? undefined,
      };
    }
    return null;
  }
}
