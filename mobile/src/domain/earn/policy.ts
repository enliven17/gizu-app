/** Research handover policy v1. All money and gas arithmetic is integer-only. */
export const earnPolicyVersion = "confidential-earn-2026-09-v1";
const UINT256 = (1n << 256n) - 1n;
function uint(n: bigint, positive = false): bigint {
  if (typeof n !== "bigint" || n < 0n || n > UINT256 || (positive && n === 0n))
    throw new Error("Invalid base-unit quantity.");
  return n;
}
export function ceilDiv(a: bigint, b: bigint) {
  if (a < 0n || b <= 0n) throw new Error("Invalid rounding operands.");
  return (a + b - 1n) / b;
}
export function fixedDecimal(value: string, decimals: number): bigint {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ||
    value.length > 100
  )
    throw new Error("Invalid decimal quantity.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("Too many decimal places.");
  return uint(BigInt(whole + fraction.padEnd(decimals, "0")));
}
export function splitCredit(confirmedUsdc: bigint) {
  uint(confirmedUsdc, true);
  const hold = confirmedUsdc / 10n;
  return { hold, invest: confirmedUsdc - hold };
}
export function sampledPriorityFee(rewards: readonly bigint[]) {
  if (rewards.length !== 8) throw new Error("Eight 25th-percentile fee samples required.");
  const sorted = [...rewards].map((n) => uint(n)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[4]! > 10000n ? sorted[4]! : 10000n;
}
export type EthereumBlockGas = { baseFee: bigint; gasUsed: bigint; gasLimit: bigint };
export function nextBaseFee(block: EthereumBlockGas) {
  const { baseFee, gasUsed, gasLimit } = block;
  uint(baseFee);
  uint(gasUsed);
  uint(gasLimit, true);
  const target = gasLimit / 2n;
  if (!target || gasUsed > gasLimit) throw new Error("Invalid Ethereum block gas data.");
  if (gasUsed === target) return baseFee;
  if (gasUsed < target) return baseFee - (baseFee * (target - gasUsed)) / target / 8n;
  const increase = (baseFee * (gasUsed - target)) / target / 8n;
  return uint(baseFee + (increase > 0n ? increase : 1n));
}
export function ethereumBudget(
  block: EthereumBlockGas,
  priorityFee: bigint,
  depositGas: readonly bigint[],
  withdrawalGas: readonly bigint[],
) {
  uint(priorityFee, true);
  if (priorityFee < 10000n) throw new Error("Priority fee below policy floor.");
  const next = nextBaseFee(block);
  const delta = next / 8n;
  const depositFee = uint(next + (delta > 0n ? delta : 1n) + priorityFee);
  const withdrawFee = uint(depositFee * 2n);
  function limits(values: readonly bigint[], bps: bigint) {
    if (!values.length) throw new Error("Post-state gas simulation required.");
    return values.map((n) => uint(ceilDiv(uint(n, true) * bps, 10000n)));
  }
  const depositLimits = limits(depositGas, 11000n),
    withdrawLimits = limits(withdrawalGas, 13000n);
  const depositWei = uint(depositLimits.reduce((a, b) => a + b, 0n) * depositFee);
  const withdrawalWei = uint(withdrawLimits.reduce((a, b) => a + b, 0n) * withdrawFee);
  return {
    depositFee,
    withdrawFee,
    priorityFee,
    depositLimits,
    withdrawLimits,
    depositWei,
    withdrawalWei,
    totalWei: uint(depositWei + withdrawalWei),
  };
}
export function resolverBudget(input: {
  inputUsdc: bigint;
  usdcUsd18: bigint;
  ethUsd18: bigint;
  providerGas: readonly bigint[];
  carriedGas: bigint;
  depositFee: bigint;
  protocolFeeBps: bigint;
}) {
  const { inputUsdc, usdcUsd18, ethUsd18, providerGas, carriedGas, depositFee, protocolFeeBps } =
    input;
  for (const n of [inputUsdc, usdcUsd18, ethUsd18, depositFee]) uint(n, true);
  uint(carriedGas);
  uint(protocolFeeBps);
  if (!providerGas.length || protocolFeeBps > 10000n)
    throw new Error("Invalid resolver estimates or fee.");
  const rawGas = [...providerGas.map((n) => uint(n, true)), carriedGas, 202859n].reduce((a, b) =>
    a > b ? a : b,
  );
  const gasUnits = uint(ceilDiv(rawGas * 120n, 100n)),
    gasPrice = uint(ceilDiv(depositFee * 125n, 100n));
  const gasCostWei = uint(gasUnits * gasPrice),
    profitWei = ceilDiv(gasCostWei, 10n);
  const allowanceWei = uint(gasCostWei + profitWei);
  const inputValueWei = uint((inputUsdc * usdcUsd18 * 10n ** 12n) / ethUsd18);
  const maximumGrossEth = inputValueWei - allowanceWei;
  const auctionAmount = (maximumGrossEth * 9950n) / (10000n + protocolFeeBps) - 2n;
  if (auctionAmount <= 0n) throw new Error("Input cannot cover resolver execution.");
  return {
    rawGas,
    gasUnits,
    gasPrice,
    gasCostWei,
    profitWei,
    allowanceWei,
    inputValueWei,
    maximumGrossEth,
    auctionAmount,
  };
}
export function fusionCostSummary(input: {
  depositWei: bigint;
  withdrawalWei: bigint;
  inputValueWei: bigint;
  minimumNetEth: bigint;
  existingEth: bigint;
}) {
  Object.values(input).forEach((n) => uint(n));
  const { depositWei, withdrawalWei, inputValueWei, minimumNetEth, existingEth } = input;
  const overhead = inputValueWei > minimumNetEth ? inputValueWei - minimumNetEth : 0n;
  const nativeBudget = uint(depositWei + withdrawalWei);
  const totalFunding = uint(existingEth + minimumNetEth);
  return {
    fusionOverheadWei: overhead,
    combinedBudgetWei: uint(nativeBudget + overhead),
    extraFundingWei: totalFunding > nativeBudget ? totalFunding - nativeBudget : 0n,
  };
}
export type SponsoredGas = {
  preVerificationGas: bigint;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  paymasterVerificationGasLimit: bigint;
  maxFeePerGas: bigint;
};
export function tokenPaymasterCap(op: SponsoredGas, paymasterData: string, expectedToken: string) {
  if (
    !/^0x[0-9a-f]+$/i.test(paymasterData) ||
    paymasterData.length % 2 !== 0 ||
    paymasterData.length < 366 ||
    paymasterData.length > 8194 ||
    !/^0x[0-9a-f]{40}$/i.test(expectedToken)
  )
    throw new Error("Malformed token paymaster data.");
  const hex = paymasterData.slice(2);
  // Supported allowance/direct-token mode only. Optional pricing, prefunding and
  // recipient extensions are forbidden until their semantics are implemented.
  if (
    !["02", "03"].includes(hex.slice(0, 2)) ||
    hex.slice(2, 4) !== "00" ||
    `0x${hex.slice(28, 68)}`.toLowerCase() !== expectedToken.toLowerCase()
  )
    throw new Error("Unsupported token paymaster configuration.");
  const rate = uint(BigInt(`0x${hex.slice(100, 164)}`), true),
    postOpTerm = uint(BigInt(`0x${hex.slice(68, 100)}`));
  const { maxFeePerGas, ...gas } = op;
  const sum = Object.values(gas).reduce((a, b) => a + uint(b), 0n);
  uint(sum, true);
  uint(maxFeePerGas, true);
  return uint(ceilDiv((sum + postOpTerm) * maxFeePerGas * rate, 10n ** 18n));
}
export function tokenBudgets(
  operationCap: bigint,
  withdrawalCap: bigint,
  fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint },
) {
  for (const n of [operationCap, withdrawalCap, fees.maxFeePerGas, fees.maxPriorityFeePerGas])
    uint(n, true);
  if (fees.maxPriorityFeePerGas > fees.maxFeePerGas) throw new Error("Invalid sponsored fee bid.");
  return {
    operation: uint(ceilDiv(operationCap * 105n, 100n)),
    withdrawalReserve: uint(ceilDiv(withdrawalCap * 260n, 100n)),
    fees: {
      maxFeePerGas: uint(ceilDiv(fees.maxFeePerGas * 110n, 100n)),
      maxPriorityFeePerGas: uint(ceilDiv(fees.maxPriorityFeePerGas * 110n, 100n)),
    },
  };
}
export function assertFresh({
  timestampMs,
  nowMs,
  maxAgeMs = 60000,
}: {
  timestampMs: number;
  nowMs: number;
  maxAgeMs?: 60000 | 300000;
}) {
  if (
    !Number.isSafeInteger(timestampMs) ||
    !Number.isSafeInteger(nowMs) ||
    timestampMs < 0 ||
    nowMs < 0 ||
    ![60000, 300000].includes(maxAgeMs) ||
    nowMs - timestampMs > maxAgeMs ||
    timestampMs - nowMs > 5000
  )
    throw new Error("Stale or invalid quote/price timestamp.");
}
export function conservativeResidual(
  assets: readonly { atoms: bigint; decimals: number; usdPrice18: bigint }[],
  usdcUsd18: bigint,
  freshness: { timestampMs: number; nowMs: number; maxAgeMs?: 60000 | 300000 },
) {
  assertFresh(freshness);
  uint(usdcUsd18, true);
  if (!assets.length) throw new Error("Fresh asset balances required.");
  let usdcAtoms = 0n;
  for (const asset of assets) {
    uint(asset.atoms);
    uint(asset.usdPrice18, true);
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18)
      throw new Error("Invalid asset precision.");
    usdcAtoms += ceilDiv(
      asset.atoms * asset.usdPrice18 * 10n ** 6n,
      10n ** BigInt(asset.decimals) * usdcUsd18,
    );
  }
  uint(usdcAtoms);
  return { usdcAtoms, accepted: usdcAtoms < 500000n, optimal: usdcAtoms < 100000n };
}

/** Native TLS proof; JavaScript displays it but cannot authorize it. */
export type EarnFeeProof = {
  version: string;
  route: string;
  totalBps: number;
  appFees: { recipient: string; fee: number }[];
  referral: string | null;
  integratorFeeBps: 0;
  applicationFeeAtoms: "0";
};
export function parseEarnFeeProof(
  value: unknown,
  total: unknown,
  route: string,
): EarnFeeProof | undefined {
  if (value === undefined && total === 2) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unverified Earn fees.");
  const p = value as EarnFeeProof;
  const identity = (v: unknown): v is string =>
    typeof v === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v);
  if (
    !identity(p.version) ||
    p.route !== route ||
    !Number.isSafeInteger(p.totalBps) ||
    p.totalBps < 0 ||
    p.totalBps > 100 ||
    p.totalBps !== total ||
    p.integratorFeeBps !== 0 ||
    p.applicationFeeAtoms !== "0" ||
    !(p.referral === null || identity(p.referral)) ||
    !Array.isArray(p.appFees) ||
    p.appFees.length > 8 ||
    p.appFees.some(
      (f) =>
        !f || !identity(f.recipient) || !Number.isSafeInteger(f.fee) || f.fee < 0 || f.fee > 100,
    ) ||
    new Set(p.appFees.map((f) => f.recipient)).size !== p.appFees.length ||
    p.appFees.reduce((sum, f) => sum + f.fee, 0) !== p.totalBps
  )
    throw new Error("Unverified Earn fees.");
  return p;
}
