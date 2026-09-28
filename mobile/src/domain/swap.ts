export type SwapAsset = { symbol: string; name: string; price: bigint };
export const swapAssets: readonly SwapAsset[] = [
  { symbol: "AMZN", name: "Amazon", price: 200n },
  { symbol: "NVDA", name: "NVIDIA", price: 150n },
  { symbol: "SPY", name: "S&P 500", price: 600n },
];
export const mockSwapBalance = 1000_000000n;
export function parseSwapAmount(value: string): bigint | null {
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"));
}
export function formatSwapAmount(value: bigint): string {
  const fraction = (value % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${value / 1000000n}${fraction ? `.${fraction}` : ""}`;
}
export type SwapQuote = {
  id: string;
  symbol: string;
  input: string;
  output: string;
  minimum: string;
  expiresAt: number;
};
export type SwapOrder = { id: string; quote: SwapQuote; status: "pending" | "filled" };
export interface SwapService {
  quote(symbol: string, amount: string): Promise<SwapQuote>;
  submit(quote: SwapQuote): Promise<SwapOrder>;
  status(id: string): Promise<SwapOrder>;
}
