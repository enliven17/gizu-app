import type { CatalogChain, CatalogVault } from "../../domain/catalog.ts";
import { catalogAddress } from "../../domain/catalog.ts";
import { DomainError } from "../../domain/errors/domain-error.ts";
import { NotFoundError } from "../../domain/errors/not-found-error.ts";
import type {
  Opportunities,
  Opportunity,
  OpportunityDetail,
  OpportunityPage,
  ListOpportunitiesQuery,
  TvlRecordsQuery,
} from "../../ports/opportunities.port.ts";
import type { VaultMetadataSource } from "./morpho-vaults.ts";

const TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_ITEMS = 100;
const MAX_SNAPSHOT_PAGES = 10;
export function contractAddress(row: Opportunity): string | undefined {
  const fields = row as Opportunity & {
    explorerAddress?: string;
    identifier?: string;
  };
  for (const value of [
    fields.vaultAddress,
    fields.explorerAddress,
    fields.identifier,
  ]) {
    if (catalogAddress.safeParse(value).success) return value;
  }
  return undefined;
}
const configuredId = (vault: CatalogVault) =>
  `configured:${vault.chainId}:${vault.address.toLowerCase()}`;

export class ConfiguredOpportunities implements Opportunities {
  private readonly snapshots = new Map<
    number,
    { expires: number; promise: Promise<OpportunityPage> }
  >();
  private readonly details = new Map<
    string,
    { expires: number; promise: Promise<OpportunityDetail> }
  >();
  constructor(
    private readonly chains: CatalogChain[],
    private readonly vaults: CatalogVault[],
    private readonly merkl: Opportunities,
    private readonly morpho: VaultMetadataSource,
  ) {}

  private chain(id: number): CatalogChain {
    const chain = this.chains.find((chain) => chain.id === id);
    if (!chain)
      throw new DomainError(
        "CATALOG_CHAIN_DISABLED",
        "catalog chain is not enabled",
      );
    return chain;
  }

  async list(query: ListOpportunitiesQuery): Promise<OpportunityPage> {
    this.chain(query.chainId);
    const configured = this.vaults.filter(
      (vault) => vault.chainId === query.chainId,
    );
    if (!configured.length) {
      const page = await this.merkl.list(query);
      return {
        ...page,
        list: page.list
          .filter((row) => row.chainId === query.chainId)
          .map((row) => ({ ...row, vaultAddress: contractAddress(row) })),
      };
    }
    const [snapshot, additions] = await Promise.all([
      this.snapshot(query.chainId),
      Promise.all(configured.map((vault) => this.configuredDetail(vault))),
    ]);
    const addresses = new Set(
      configured.map((vault) => vault.address.toLowerCase()),
    );
    const combined = [
      ...additions,
      ...snapshot.list.filter(
        (row) => !addresses.has(contractAddress(row)?.toLowerCase() ?? ""),
      ),
    ];
    const search = query.search.toLowerCase().trim();
    const filtered = combined.filter(
      (row) =>
        (query.protocol === "all" || row.protocol.id === query.protocol) &&
        (!search ||
          `${row.name} ${contractAddress(row) ?? ""}`
            .toLowerCase()
            .includes(search)),
    );
    return {
      list: filtered.slice(
        query.page * query.items,
        (query.page + 1) * query.items,
      ),
      total: filtered.length,
      ...(snapshot.partial ? { partial: true } : {}),
    };
  }

  private snapshot(chainId: number): Promise<OpportunityPage> {
    const cached = this.snapshots.get(chainId);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async () => {
      const rows = new Map<string, Opportunity>();
      const signal = AbortSignal.timeout(8_000);
      const read = (page: number) =>
        this.merkl.list({
          chainId,
          protocol: "all",
          search: "",
          page,
          items: SNAPSHOT_ITEMS,
          signal,
        });
      const append = (result: OpportunityPage) => {
        for (const row of result.list)
          if (row.chainId === chainId)
            rows.set(row.id, { ...row, vaultAddress: contractAddress(row) });
      };
      try {
        const first = await read(0);
        append(first);
        const pages = Math.min(
          MAX_SNAPSHOT_PAGES,
          Math.ceil(first.total / SNAPSHOT_ITEMS),
        );
        const results = await Promise.allSettled(
          Array.from({ length: Math.max(0, pages - 1) }, (_, i) => read(i + 1)),
        );
        let partial =
          first.total > MAX_SNAPSHOT_PAGES * SNAPSHOT_ITEMS ||
          first.partial === true;
        for (const result of results) {
          if (result.status === "fulfilled") {
            append(result.value);
            if (result.value.partial) partial = true;
          } else partial = true;
        }
        return {
          list: [...rows.values()],
          total: rows.size,
          ...(partial ? { partial: true } : {}),
        };
      } catch {
        /* Keep configured entries accessible when Merkl is unavailable. */
      }
      return { list: [...rows.values()], total: rows.size, partial: true };
    })();
    this.snapshots.set(chainId, { expires: Date.now() + TTL_MS, promise });
    return promise;
  }

  private configuredDetail(vault: CatalogVault): Promise<OpportunityDetail> {
    const id = configuredId(vault);
    const cached = this.details.get(id);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = (async (): Promise<OpportunityDetail> => {
      const metadata = await this.morpho.lookup(vault.chainId, vault.address);
      const chain = this.chain(vault.chainId);
      const asset = metadata?.asset ?? vault.asset;
      const rate =
        metadata?.netApy === undefined ? null : metadata.netApy * 100;
      return {
        id,
        name:
          metadata?.name ??
          vault.name ??
          metadata?.symbol ??
          vault.symbol ??
          `${chain.name} vault ${vault.address.slice(0, 6)}…${vault.address.slice(-4)}`,
        status: "LISTED",
        symbol: metadata?.symbol ?? vault.symbol,
        chainId: chain.id,
        chain,
        protocol: { id: "morpho", name: "Morpho" },
        vaultAddress: vault.address,
        rateType: "apy",
        apr: rate,
        totalApr: rate,
        tvl: metadata?.totalAssetsUsd ?? null,
        nativeApr: null,
        dailyRewards: null,
        liveCampaigns: 0,
        description: metadata?.description ?? vault.description ?? "",
        action: "LEND",
        type: "VAULT",
        explorerAddress: vault.address,
        identifier: vault.address,
        depositUrl: vault.depositUrl ?? "",
        howToSteps: vault.howToSteps ?? [],
        tags: vault.tags ?? [],
        tokens: asset ? [{ id: asset.address, ...asset, price: null }] : [],
        campaigns: [],
      };
    })();
    this.details.set(id, { expires: Date.now() + TTL_MS, promise });
    return promise;
  }

  async getById(id: string): Promise<OpportunityDetail> {
    if (id.startsWith("configured:")) {
      const vault = this.vaults.find((vault) => configuredId(vault) === id);
      if (!vault) throw new NotFoundError({ name: "opportunity" }, id);
      return this.configuredDetail(vault);
    }
    const detail = await this.merkl.getById(id);
    this.chain(detail.chainId);
    return { ...detail, vaultAddress: contractAddress(detail) };
  }

  async tvlRecords(query: TvlRecordsQuery) {
    await this.getById(query.id); // Same enabled-chain / configured-contract boundary as detail.
    return query.id.startsWith("configured:")
      ? []
      : this.merkl.tvlRecords(query);
  }
}
