import type { CatalogToken, TokenPage } from "@/domain/tokenCatalog";
export const catalogToken: CatalogToken = {
  chainId: 4663,
  address: "0xab34567890123456789012345678901234567890",
  symbol: "AMZN",
  name: "Amazon",
  decimals: 18,
  logoURI: "https://example.com/token.png",
  category: "rwa",
  issuer: "Robinhood",
  swapListed: true,
  fusionStatus: "quote-required",
};
export const catalogPage: TokenPage = { list: [catalogToken], page: 0, items: 20, total: 1 };
