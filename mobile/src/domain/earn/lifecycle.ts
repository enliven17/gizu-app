import { conservativeResidual } from "./policy";
export type EarnAsset =
  | "monad-usdc"
  | "ethereum-usdc"
  | "ethereum-eth"
  | "ethereum-weth"
  | "robinhood-usdg"
  | "robinhood-eth";
const assets = new Set<EarnAsset>([
  "monad-usdc",
  "ethereum-usdc",
  "ethereum-eth",
  "ethereum-weth",
  "robinhood-usdg",
  "robinhood-eth",
]);
type Cost = {
  id: string;
  legId: string;
  asset: EarnAsset;
  atoms: string;
  category: "network-fee" | "provider-fee" | "fusion-overhead";
};
type Estimate = { legId: string; asset: EarnAsset; atoms: string; kind: "reserve" | "estimate" };
export type CostLedger = {
  readonly originalApproval: Readonly<{ id: string; maxSourceUsdc: string }>;
  readonly spent: readonly Readonly<Cost>[];
  readonly remaining: readonly Readonly<Estimate>[];
  readonly revision: number;
};
function quantity(atoms: string) {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(atoms) || BigInt(atoms) >= 1n << 256n)
    throw new Error("Invalid ledger amount.");
}
function validateCost(cost: { legId: string; asset: EarnAsset; atoms: string }) {
  if (!cost.legId || cost.legId.length > 200 || !assets.has(cost.asset))
    throw new Error("Invalid cost asset or leg.");
  quantity(cost.atoms);
}
/** Repricing replaces estimates only. Settled Fusion overhead remains an actual cost. */
export function replanCosts(
  ledger: CostLedger,
  revision: number,
  remaining: readonly Estimate[],
): CostLedger {
  if (!Number.isSafeInteger(revision) || revision <= ledger.revision)
    throw new Error("Cost revision must advance.");
  quantity(ledger.originalApproval.maxSourceUsdc);
  remaining.forEach((c) => {
    validateCost(c);
    if (c.kind !== "reserve" && c.kind !== "estimate") throw new Error("Invalid estimate kind.");
  });
  return Object.freeze({
    ...ledger,
    revision,
    remaining: Object.freeze(remaining.map((c) => Object.freeze({ ...c }))),
  });
}
export function recordCost(ledger: CostLedger, cost: Cost): CostLedger {
  validateCost(cost);
  if (!cost.id || !["network-fee", "provider-fee", "fusion-overhead"].includes(cost.category))
    throw new Error("Invalid settled cost.");
  const existing = ledger.spent.find((c) => c.id === cost.id);
  if (existing) {
    if (
      existing.legId !== cost.legId ||
      existing.asset !== cost.asset ||
      existing.atoms !== cost.atoms ||
      existing.category !== cost.category
    )
      throw new Error("Settled cost identity changed.");
    return ledger;
  }
  return Object.freeze({
    ...ledger,
    spent: Object.freeze([...ledger.spent, Object.freeze({ ...cost })]),
  });
}
export type Leg = {
  id: string;
  revision: number;
  status: "planned" | "authorized" | "signed" | "submitted" | "unknown" | "settled" | "unfilled";
  transactionHash?: string;
  canRetry?: boolean;
};
type Evidence = { legId: string; revision: number } & (
  | { type: "providerExpired" | "unknown" | "reorg" }
  | { type: "chainProvenUnfilled"; finalized: boolean; observedAtMs: number; deadlineMs: number }
  | { type: "chainFinalized"; finalized: boolean; transactionHash: string }
);
/** Semantic policy only: evidence must be verified by a trusted chain adapter.
 * Provider reports never grant retry authority, and this module cannot sign. */
export function applyLegEvidence(leg: Leg, evidence: Evidence): Leg {
  if (evidence.legId !== leg.id || evidence.revision !== leg.revision)
    throw new Error("Operation/revision changed.");
  if (evidence.type === "chainProvenUnfilled") {
    if (
      !evidence.finalized ||
      !Number.isSafeInteger(evidence.observedAtMs) ||
      !Number.isSafeInteger(evidence.deadlineMs) ||
      evidence.deadlineMs < 0 ||
      evidence.observedAtMs <= evidence.deadlineMs ||
      leg.status === "settled"
    )
      throw new Error("Finalized non-fill proof after expiry required.");
    return { ...leg, status: "unfilled", canRetry: true };
  }
  if (evidence.type === "chainFinalized") {
    if (
      !evidence.finalized ||
      !/^0x[0-9a-f]{64}$/i.test(evidence.transactionHash) ||
      evidence.transactionHash.toLowerCase() !== leg.transactionHash?.toLowerCase()
    )
      throw new Error("Finalized transaction binding required.");
    return { ...leg, status: "settled", canRetry: false };
  }
  return { ...leg, status: "unknown", canRetry: false };
}
/** Caller must authenticate operation-scoped confidential credits independently.
 * Snapshot order is [hold wallet, investment wallet]. Wallet 1's intentional
 * payout is excluded from wallet 2's exit; it must never be swept to pass dust.
 * Explicit WETH balances are required, even when zero.
 * This pure checker does not authenticate provider responses or authorize spending. */
export function assertComplete(evidence: {
  expectedOperationId: string;
  authenticatedOperationId: string;
  expectedReturnLegIds: readonly string[];
  creditedReturnLegIds: readonly string[];
  shares: readonly bigint[];
  balances: { token: readonly bigint[]; native: readonly bigint[]; weth: readonly bigint[] };
  tokenDecimals: number;
  tokenUsd18: bigint;
  ethUsd18: bigint;
  usdcUsd18: bigint;
  timestampMs: number;
  nowMs: number;
}) {
  const {
    expectedOperationId,
    authenticatedOperationId,
    expectedReturnLegIds,
    creditedReturnLegIds,
  } = evidence;
  if (
    !expectedOperationId ||
    authenticatedOperationId !== expectedOperationId ||
    !expectedReturnLegIds.length ||
    expectedReturnLegIds.some((id) => !id) ||
    new Set(expectedReturnLegIds).size !== expectedReturnLegIds.length ||
    new Set(creditedReturnLegIds).size !== creditedReturnLegIds.length ||
    expectedReturnLegIds.length !== creditedReturnLegIds.length ||
    expectedReturnLegIds.some((id) => !creditedReturnLegIds.includes(id))
  )
    throw new Error("Authenticated credit for every expected return leg required.");
  if (evidence.shares.length !== 2 || evidence.shares[1] !== 0n)
    throw new Error("Investment wallet must have zero vault shares.");
  const values: { atoms: bigint; decimals: number; usdPrice18: bigint }[] = [];
  for (const [kind, balances] of Object.entries(evidence.balances)) {
    if (balances.length !== 2)
      throw new Error("Explicit fresh token, ETH and WETH balances for both wallets required.");
    values.push({
      atoms: balances[1]!,
      decimals: kind === "token" ? evidence.tokenDecimals : 18,
      usdPrice18: kind === "token" ? evidence.tokenUsd18 : evidence.ethUsd18,
    });
  }
  if (Object.keys(evidence.balances).sort().join(",") !== "native,token,weth")
    throw new Error("Missing residual asset.");
  const result = conservativeResidual(values, evidence.usdcUsd18, evidence);
  if (!result.accepted)
    throw new Error("Final residual is not strictly below 0.5 USDC equivalent.");
  return result;
}
