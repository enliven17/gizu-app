import { AppError } from "@/domain/errors";
import {
  TOKEN_PAGE_SIZE,
  tokenIdentity,
  type CatalogToken,
  type TokenCatalogService,
  type TokenPage,
  type TokenQuery,
} from "@/domain/tokenCatalog";
import { getJson } from "./http";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isToken(value: unknown, query: TokenQuery): value is CatalogToken {
  return (
    isRecord(value) &&
    value.chainId === query.chainId &&
    typeof value.address === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(value.address) &&
    typeof value.symbol === "string" &&
    typeof value.name === "string" &&
    typeof value.decimals === "number" &&
    Number.isSafeInteger(value.decimals) &&
    value.decimals >= 0 &&
    (value.logoURI === null || typeof value.logoURI === "string") &&
    (value.category === "rwa" || value.category === "other") &&
    (query.category === "all" || value.category === "rwa") &&
    (value.issuer === null || value.issuer === "Robinhood") &&
    typeof value.swapListed === "boolean" &&
    value.fusionStatus === "quote-required"
  );
}
function validatePage(body: unknown, query: TokenQuery): TokenPage {
  if (
    !isRecord(body) ||
    !Array.isArray(body.list) ||
    !body.list.every((t) => isToken(t, query)) ||
    body.page !== query.page ||
    body.items !== TOKEN_PAGE_SIZE ||
    typeof body.total !== "number" ||
    !Number.isSafeInteger(body.total) ||
    body.total < 0 ||
    body.list.length !==
      Math.min(TOKEN_PAGE_SIZE, Math.max(0, body.total - query.page * TOKEN_PAGE_SIZE)) ||
    new Set(body.list.map(tokenIdentity)).size !== body.list.length
  ) {
    throw new AppError("invalid-response", "Invalid token catalog response.");
  }
  return body as unknown as TokenPage;
}
export function createTokenCatalogService(baseUrl: string): TokenCatalogService {
  const root = baseUrl.replace(/\/$/, "");
  return {
    async list(query, signal) {
      if (!root) throw new AppError("unavailable", "Token catalog is not configured.");
      const params = `chainId=${query.chainId}&category=${query.category}&search=${encodeURIComponent(query.search)}&page=${query.page}&items=${TOKEN_PAGE_SIZE}`;
      const body = await getJson(
        `${root}/v1/tokens?${params}`,
        signal,
        "Token catalog unavailable.",
      );
      return validatePage(body, query);
    },
  };
}
export const tokenCatalogService = createTokenCatalogService(
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://127.0.0.1:3000" : ""),
);
