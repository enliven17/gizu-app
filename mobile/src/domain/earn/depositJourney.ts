import { earnProfiles, type EarnDestination, type EarnOwner, type EarnProfileId } from "./types";

export type DepositPhase =
  | "draft"
  | "preparing"
  | "review"
  | "authorizing"
  | "funding"
  | "settlingCredit"
  | "payouts"
  | "depositing"
  | "paused"
  | "invested";
export type DepositStage = "funding" | "credit" | "payouts" | "deposit";
export type DepositPauseCode =
  | "quoteUnavailable"
  | "previewUnavailable"
  | "sponsorshipUnavailable"
  | "insufficientFunds"
  | "uneconomicAmount"
  | "termsChanged"
  | "approvalExpired"
  | "settlementPending"
  | "submissionUnknown"
  | "recoveryRequired"
  | "unsupportedCapability"
  | "cancelled";
export type DepositLegReview = {
  recipient: string;
  inputAtoms: string;
  estimatedOutputAtoms: string;
  minimumOutputAtoms: string;
  providerFeeBps: number;
};
export type DepositSourceReview = {
  operationId: string;
  accountIndex: number;
  address: string;
  budgetAtoms: string;
  amountAtoms: string;
  maximumFeeAtoms: string;
  retainedAtoms: string;
  minimumCreditAtoms: string;
  hold: DepositLegReview;
  invest: DepositLegReview;
};
export type DepositReview = {
  policyVersion: string;
  quotedAtMs: number;
  expiresAtMs: number;
  sourceBudgetAtoms: string;
  sources: DepositSourceReview[];
  deposit: {
    estimatedAssetsAtoms: string;
    minimumAssetsAtoms: string;
    minimumSharesAtoms: string;
    shareDecimals: number;
    maximumFeeAtoms: string;
    withdrawalReserveAtoms: string;
  };
};
export type DepositIndicativeReview = {
  quotedAtMs: number;
  sourceBudgetAtoms: string;
  holdEstimatedAtoms: string;
  investEstimatedAtoms: string;
  sourceMaximumFeeAtoms: string;
};
export type DepositSnapshot = {
  version: 1;
  journeyId: string;
  revision: number;
  walletId: string;
  intentId: string;
  profileId: EarnProfileId;
  phase: DepositPhase;
  destinations: [EarnDestination, EarnDestination];
  budgetAtoms: string;
  creditedAtoms: string;
  holdReceivedAtoms: string;
  investReceivedAtoms: string;
  depositedAtoms: string;
  sharesAtoms: string;
  completedSteps: DepositStage[];
  review?: DepositReview;
  indicativeReview?: DepositIndicativeReview;
  pauseReason?: DepositPauseCode;
  message?: string;
  depositTransactionHash?: string;
};
export interface EarnDepositService {
  available(): Promise<boolean>;
  prepare(
    owner: EarnOwner,
    profileId: EarnProfileId,
    budgetAtoms: string,
    draftId?: string,
  ): Promise<DepositSnapshot>;
  confirm(owner: EarnOwner, journeyId: string, revision: number): Promise<DepositSnapshot>;
  status(owner: EarnOwner, journeyId: string): Promise<DepositSnapshot>;
  resume(owner: EarnOwner, journeyId: string, revision: number): Promise<DepositSnapshot>;
  cancel(owner: EarnOwner, journeyId: string, revision: number): Promise<DepositSnapshot>;
}
const phases: DepositPhase[] = [
  "draft",
  "preparing",
  "review",
  "authorizing",
  "funding",
  "settlingCredit",
  "payouts",
  "depositing",
  "paused",
  "invested",
];
const stages: DepositStage[] = ["funding", "credit", "payouts", "deposit"];
const pauses: DepositPauseCode[] = [
  "quoteUnavailable",
  "previewUnavailable",
  "sponsorshipUnavailable",
  "insufficientFunds",
  "uneconomicAmount",
  "termsChanged",
  "approvalExpired",
  "settlementPending",
  "submissionUnknown",
  "recoveryRequired",
  "unsupportedCapability",
  "cancelled",
];
function fail(): never {
  throw new Error("Invalid native deposit progress. Check saved activity before retrying.");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, pattern = /^[-a-zA-Z0-9_:]{1,256}$/): string {
  if (typeof value !== "string" || !pattern.test(value)) fail();
  return value;
}
function atoms(value: unknown, positive = false): string {
  const result = text(value, /^(0|[1-9][0-9]{0,77})$/),
    n = BigInt(result);
  if (n >= 1n << 256n || (positive && n === 0n)) fail();
  return result;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    fail();
  return value;
}
function address(value: unknown): string {
  const result = text(value, /^0x[0-9a-f]{40}$/i);
  if (/^0x0{40}$/i.test(result)) fail();
  return result;
}
function leg(value: unknown, recipient: string, expectedInput: bigint): DepositLegReview {
  const row = object(value),
    result = {
      recipient: address(row.recipient),
      inputAtoms: atoms(row.inputAtoms, true),
      estimatedOutputAtoms: atoms(row.estimatedOutputAtoms, true),
      minimumOutputAtoms: atoms(row.minimumOutputAtoms, true),
      providerFeeBps: integer(row.providerFeeBps, 0, 100),
    };
  if (
    result.recipient.toLowerCase() !== recipient.toLowerCase() ||
    BigInt(result.inputAtoms) !== expectedInput ||
    BigInt(result.minimumOutputAtoms) > BigInt(result.estimatedOutputAtoms)
  )
    fail();
  return result;
}
function review(value: unknown, snapshot: DepositSnapshot): DepositReview {
  const r = object(value),
    d = object(r.deposit),
    sources = r.sources;
  if (!Array.isArray(sources) || !sources.length || sources.length > 256) fail();
  const result: DepositReview = {
    policyVersion: text(r.policyVersion),
    quotedAtMs: integer(r.quotedAtMs),
    expiresAtMs: integer(r.expiresAtMs),
    sourceBudgetAtoms: atoms(r.sourceBudgetAtoms, true),
    sources: [],
    deposit: {
      estimatedAssetsAtoms: atoms(d.estimatedAssetsAtoms, true),
      minimumAssetsAtoms: atoms(d.minimumAssetsAtoms, true),
      minimumSharesAtoms: atoms(d.minimumSharesAtoms, true),
      shareDecimals: integer(d.shareDecimals, 0, 18),
      maximumFeeAtoms: atoms(d.maximumFeeAtoms, true),
      withdrawalReserveAtoms: atoms(d.withdrawalReserveAtoms, true),
    },
  };
  if (
    result.expiresAtMs <= result.quotedAtMs ||
    result.expiresAtMs > result.quotedAtMs + 60000 ||
    result.sourceBudgetAtoms !== snapshot.budgetAtoms
  )
    fail();
  const ids = new Set<string>(),
    indices = new Set<number>(),
    addresses = new Set<string>();
  let offset = 0n,
    budget = 0n,
    minimumInvest = 0n,
    estimatedInvest = 0n;
  for (const raw of sources) {
    const s = object(raw),
      credit = BigInt(atoms(s.minimumCreditAtoms, true)),
      hold = (offset + credit) / 10n - offset / 10n;
    const source: DepositSourceReview = {
      operationId: text(s.operationId),
      accountIndex: integer(s.accountIndex, 0, 2147483647),
      address: address(s.address),
      budgetAtoms: atoms(s.budgetAtoms, true),
      amountAtoms: atoms(s.amountAtoms, true),
      maximumFeeAtoms: atoms(s.maximumFeeAtoms, true),
      retainedAtoms: atoms(s.retainedAtoms),
      minimumCreditAtoms: credit.toString(),
      hold: leg(s.hold, snapshot.destinations[0].address, hold),
      invest: leg(s.invest, snapshot.destinations[1].address, credit - hold),
    };
    if (
      ids.has(source.operationId) ||
      indices.has(source.accountIndex) ||
      addresses.has(source.address.toLowerCase()) ||
      snapshot.destinations.some(
        (dest) => dest.address.toLowerCase() === source.address.toLowerCase(),
      ) ||
      credit > BigInt(source.amountAtoms) ||
      BigInt(source.retainedAtoms) < 10000n ||
      BigInt(source.amountAtoms) + BigInt(source.maximumFeeAtoms) + BigInt(source.retainedAtoms) !==
        BigInt(source.budgetAtoms)
    )
      fail();
    ids.add(source.operationId);
    indices.add(source.accountIndex);
    addresses.add(source.address.toLowerCase());
    offset += credit;
    budget += BigInt(source.budgetAtoms);
    minimumInvest += BigInt(source.invest.minimumOutputAtoms);
    estimatedInvest += BigInt(source.invest.estimatedOutputAtoms);
    result.sources.push(source);
  }
  const costs =
    BigInt(result.deposit.maximumFeeAtoms) + BigInt(result.deposit.withdrawalReserveAtoms);
  if (
    budget !== BigInt(snapshot.budgetAtoms) ||
    BigInt(result.deposit.minimumAssetsAtoms) + costs > minimumInvest ||
    BigInt(result.deposit.minimumAssetsAtoms) > BigInt(result.deposit.estimatedAssetsAtoms) ||
    BigInt(result.deposit.estimatedAssetsAtoms) + costs > estimatedInvest
  )
    fail();
  return result;
}
/** Public results are decoded by allowlist; native-private payloads never enter screen state. */
export function parseDepositSnapshot(value: unknown, owner: EarnOwner): DepositSnapshot {
  const row = object(value),
    profileId = row.profileId;
  if (
    row.version !== 1 ||
    row.walletId !== owner.walletId ||
    (profileId !== "robinhood-usdg" && profileId !== "ethereum-usdc") ||
    !phases.includes(row.phase as DepositPhase) ||
    !Array.isArray(row.destinations) ||
    row.destinations.length !== 2
  )
    fail();
  const destinations = row.destinations.map((value, i) => {
    const d = object(value);
    if (d.role !== (i === 0 ? "hold" : "invest") || d.chainId !== earnProfiles[profileId].chainId)
      fail();
    return { role: d.role, chainId: d.chainId, address: address(d.address) } as EarnDestination;
  }) as [EarnDestination, EarnDestination];
  if (destinations[0].address.toLowerCase() === destinations[1].address.toLowerCase()) fail();
  if (
    !Array.isArray(row.completedSteps) ||
    row.completedSteps.some((s) => !stages.includes(s as DepositStage)) ||
    new Set(row.completedSteps).size !== row.completedSteps.length
  )
    fail();
  const result: DepositSnapshot = {
    version: 1,
    journeyId: text(row.journeyId),
    revision: integer(row.revision, 1),
    walletId: owner.walletId,
    intentId: text(row.intentId),
    profileId,
    phase: row.phase as DepositPhase,
    destinations,
    budgetAtoms: atoms(row.budgetAtoms, true),
    creditedAtoms: atoms(row.creditedAtoms),
    holdReceivedAtoms: atoms(row.holdReceivedAtoms),
    investReceivedAtoms: atoms(row.investReceivedAtoms),
    depositedAtoms: atoms(row.depositedAtoms),
    sharesAtoms: atoms(row.sharesAtoms),
    completedSteps: row.completedSteps as DepositStage[],
  };
  if (row.review !== undefined && row.review !== null) result.review = review(row.review, result);
  if (row.indicativeReview !== undefined && row.indicativeReview !== null) {
    const i = object(row.indicativeReview);
    const indicative: DepositIndicativeReview = {
      quotedAtMs: integer(i.quotedAtMs),
      sourceBudgetAtoms: atoms(i.sourceBudgetAtoms, true),
      holdEstimatedAtoms: atoms(i.holdEstimatedAtoms, true),
      investEstimatedAtoms: atoms(i.investEstimatedAtoms, true),
      sourceMaximumFeeAtoms: atoms(i.sourceMaximumFeeAtoms),
    };
    if (
      indicative.sourceBudgetAtoms !== result.budgetAtoms ||
      BigInt(indicative.sourceMaximumFeeAtoms) >= BigInt(result.budgetAtoms)
    )
      fail();
    result.indicativeReview = indicative;
  }
  if ((result.phase === "review" || result.phase === "authorizing") && !result.review) fail();
  if (row.pauseReason !== undefined && row.pauseReason !== null) {
    if (!pauses.includes(row.pauseReason as DepositPauseCode)) fail();
    result.pauseReason = row.pauseReason as DepositPauseCode;
  }
  if (row.message !== undefined) result.message = text(row.message, /^[\s\S]{0,1024}$/);
  if (row.depositTransactionHash)
    result.depositTransactionHash = text(row.depositTransactionHash, /^0x[0-9a-f]{64}$/i);
  if (result.phase === "paused" && !result.pauseReason) fail();
  if (
    result.phase === "invested" &&
    (!result.depositTransactionHash ||
      result.completedSteps.length !== 4 ||
      [
        result.holdReceivedAtoms,
        result.investReceivedAtoms,
        result.depositedAtoms,
        result.sharesAtoms,
      ].some((a) => BigInt(a) === 0n) ||
      BigInt(result.depositedAtoms) > BigInt(result.investReceivedAtoms))
  )
    fail();
  return result;
}
export function canConfirmDeposit(snapshot: DepositSnapshot, nowMs: number): boolean {
  return (
    snapshot.phase === "review" &&
    !snapshot.pauseReason &&
    !!snapshot.review &&
    Number.isSafeInteger(nowMs) &&
    nowMs >= snapshot.review.quotedAtMs - 5000 &&
    nowMs < snapshot.review.expiresAtMs
  );
}
