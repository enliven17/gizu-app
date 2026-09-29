const USDC_DECIMALS = 6;

/** Decimal USDC text to 6-decimal atoms. Extra fraction digits and non-canonical forms are rejected. */
export function parseSwapAmount(amount: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(`${whole}${fraction.padEnd(USDC_DECIMALS, "0")}`);
}
