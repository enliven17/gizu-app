import { parseSwapAmount } from "@/domain/swap";
import type { StoredSwapView } from "@/domain/wallet/storedSigner";
import { getStoredSwapSigner } from "@/services/wallet/nativeBridge";
import {
  demoQuoteOut,
  demoSaleOut,
  demoSwapBridge,
  demoTokens,
  swapDemoEnabled,
} from "./demo/swapDemo";

export const swapGateway =
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://127.0.0.1:3000" : "");

/** Native Swap represents each explicitly chosen budget as unsigned 64-bit USDC atoms. */
export const MAX_SOURCE_ATOMS = (1n << 64n) - 1n;

export type ListedToken = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  swapListed: boolean;
};

export function sourceAtoms(amount: string): string | null {
  if (amount.length > 21) return null;
  const value = parseSwapAmount(amount);
  if (value === null || value < 1n || value > MAX_SOURCE_ATOMS) return null;
  return value.toString();
}

export function parseSwapView(value: unknown): StoredSwapView {
  if (!value || typeof value !== "object") throw new Error("Invalid swap status");
  const view = value as Record<string, unknown>;
  if (
    typeof view.operationId !== "string" ||
    typeof view.phase !== "string" ||
    typeof view.fundingAddress !== "string"
  )
    throw new Error("Invalid swap status");
  return {
    operationId: view.operationId,
    phase: view.phase,
    step: typeof view.step === "string" ? view.step : "",
    pausedCode: typeof view.pausedCode === "string" ? view.pausedCode : null,
    targetSymbol: typeof view.targetSymbol === "string" ? view.targetSymbol : "",
    targetDecimals: typeof view.targetDecimals === "number" ? view.targetDecimals : 0,
    sourceAtoms: typeof view.sourceAtoms === "string" ? view.sourceAtoms : "",
    creditedAtoms: typeof view.creditedAtoms === "string" ? view.creditedAtoms : "",
    payoutsSubmitted: typeof view.payoutsSubmitted === "number" ? view.payoutsSubmitted : 0,
    ordersComplete: typeof view.ordersComplete === "number" ? view.ordersComplete : 0,
    receivedTargetAtoms:
      typeof view.receivedTargetAtoms === "string" ? view.receivedTargetAtoms : "",
    fundingAddress: view.fundingAddress,
    direction: view.direction === "sell" ? "sell" : "buy",
    approved: view.approved === true,
    returnAddresses: Array.isArray(view.returnAddresses)
      ? view.returnAddresses.filter((item): item is string => typeof item === "string")
      : [],
    legs: typeof view.legs === "number" && view.legs > 0 ? view.legs : undefined,
    holders: typeof view.holders === "number" && view.holders > 0 ? view.holders : undefined,
    kind: typeof view.kind === "string" ? view.kind : undefined,
  };
}

export async function loadSwapTokens(fetchImpl: typeof fetch = fetch): Promise<ListedToken[]> {
  if (swapDemoEnabled())
    return demoTokens.map(({ address, symbol, name, decimals }) => ({
      address,
      symbol,
      name,
      decimals,
      swapListed: true,
    }));
  const response = await fetchImpl(
    `${swapGateway}/v1/tokens?chainId=4663&category=rwa&search=&page=0&items=100`,
  );
  if (!response.ok) throw new Error("Token list unavailable.");
  const body = (await response.json()) as { list?: unknown };
  if (!Array.isArray(body.list)) throw new Error("Token list unavailable.");
  return body.list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const token = item as Record<string, unknown>;
    if (
      token.swapListed !== true ||
      typeof token.address !== "string" ||
      typeof token.symbol !== "string" ||
      typeof token.name !== "string"
    )
      return [];
    return [
      {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: typeof token.decimals === "number" ? token.decimals : 0,
        swapListed: true,
      },
    ];
  });
}

/** Market estimate of the target token received for a USDC budget (before auction slippage). */
export async function previewSwapOut(
  wallet: string,
  target: string,
  sourceAtomsValue: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (swapDemoEnabled()) return demoQuoteOut(target, BigInt(sourceAtomsValue)).toString();
  const response = await fetchImpl(`${swapGateway}/v1/swap/fusion/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, dstToken: target, amount: sourceAtomsValue, preset: "fast" }),
  });
  if (!response.ok) throw new Error("Estimate unavailable.");
  const body = (await response.json()) as { marketOut?: unknown };
  if (typeof body.marketOut !== "string" || !/^\d+$/.test(body.marketOut))
    throw new Error("Estimate unavailable.");
  return body.marketOut;
}

/** Robinhood USDG, the stable a sale settles into before it becomes Monad USDC. */
const ROBINHOOD_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
/** Any well-formed address: a price preview does not depend on the wallet. */
const PREVIEW_WALLET = "0x000000000000000000000000000000000000dEaD";

/** Market estimate, in USDC atoms, of selling `tokenAtoms` of `target` (before route fees). */
export async function previewSaleOut(
  target: string,
  tokenAtoms: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (swapDemoEnabled()) return demoSaleOut(target, BigInt(tokenAtoms)).toString();
  const response = await fetchImpl(`${swapGateway}/v1/swap/fusion/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: PREVIEW_WALLET,
      srcToken: target,
      dstToken: ROBINHOOD_USDG,
      amount: tokenAtoms,
      preset: "fast",
    }),
  });
  if (!response.ok) throw new Error("Estimate unavailable.");
  const body = (await response.json()) as { marketOut?: unknown };
  if (typeof body.marketOut !== "string" || !/^\d+$/.test(body.marketOut))
    throw new Error("Estimate unavailable.");
  return body.marketOut;
}

export function formatTokenAtoms(atoms: string, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(atoms);
  const shown = Math.min(decimals, 6);
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, shown)
    .replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
}

export function swapSigner() {
  if (swapDemoEnabled()) return demoSwapBridge;
  const native = getStoredSwapSigner();
  if (!native) throw new Error("Confidential swap is unavailable in this build.");
  return native;
}
