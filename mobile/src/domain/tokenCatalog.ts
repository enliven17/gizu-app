export const tokenNetworks = [
  { chainId: 1, name: "Ethereum" },
  { chainId: 143, name: "Monad" },
  { chainId: 4663, name: "Robinhood" },
] as const;
export const TOKEN_PAGE_SIZE = 20;
export type TokenChainId = (typeof tokenNetworks)[number]["chainId"];
export type TokenCategory = "all" | CatalogToken["category"];
export interface TokenQuery {
  /** `null` browses every catalog network. */
  chainId: TokenChainId | null;
  category: TokenCategory;
  search: string;
  page: number;
}
export interface CatalogToken {
  chainId: TokenChainId;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  category: "rwa" | "other";
  issuer: "Robinhood" | null;
  swapListed: boolean;
  fusionStatus: "quote-required";
}
export interface TokenPage {
  list: CatalogToken[];
  page: number;
  items: number;
  total: number;
}
export interface TokenCatalogService {
  list(query: TokenQuery, signal: AbortSignal): Promise<TokenPage>;
}
export function tokenIdentity(token: Pick<CatalogToken, "chainId" | "address">): string {
  return `${token.chainId}:${token.address.toLowerCase()}`;
}
