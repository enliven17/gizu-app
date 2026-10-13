import type { CatalogChain, OpportunityQuery, OpportunityService } from "@/domain/opportunities";

type Position = { chainId?: number; page: number };

/** Each supported chain keeps its own cursor; exhausted chains leave subsequent requests. */
export function catalogCursor(chains?: CatalogChain[], page = 0): string {
  return JSON.stringify(chains ? chains.map(({ id }) => ({ chainId: id, page })) : [{ page }]);
}

export async function readCatalogPage(
  service: OpportunityService,
  query: Pick<OpportunityQuery, "search" | "protocol">,
  cursor: string,
  signal: AbortSignal,
) {
  const positions: Position[] = JSON.parse(cursor);
  const results = await Promise.allSettled(
    positions.map((position) => service.list({ ...query, ...position }, signal)),
  );
  if (signal.aborted) throw new Error("Catalog request cancelled.");
  const pages = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (!pages.length) {
    const failure = results.find((result) => result.status === "rejected");
    throw failure?.status === "rejected" ? failure.reason : new Error("Vault catalog unavailable.");
  }
  // Interleave so the Home preview and first screen include the supported chains together.
  const items = Array.from(
    { length: Math.max(0, ...pages.map((page) => page.list.length)) },
    (_, i) => pages.flatMap((page) => (page.list[i] ? [page.list[i]!] : [])),
  ).flat();
  const remaining = positions.flatMap((position, i) => {
    const result = results[i]!;
    // A failed chain stays at its current cursor for an explicit retry/load more.
    if (result.status === "rejected") return [position];
    const page = result.value;
    return (page.page + 1) * page.items < page.total ? [{ ...position, page: page.page + 1 }] : [];
  });
  return {
    items,
    nextCursor: remaining.length ? JSON.stringify(remaining) : null,
    total: pages.reduce((total, page) => total + page.total, 0),
    partial: pages.length !== positions.length || pages.some((page) => page.partial === true),
  };
}
