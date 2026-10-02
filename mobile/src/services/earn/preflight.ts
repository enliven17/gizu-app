import { earnProfiles, type EarnPreflightService } from "@/domain/earn/types";
import { assertFresh } from "@/domain/earn/policy";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid vault readiness response.");
  return value as Record<string, unknown>;
}
function atoms(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,77})$/.test(value) ||
    BigInt(value) >= 1n << 256n
  )
    throw new Error("Invalid vault readiness amount.");
  return value;
}
export function createEarnPreflightService(
  baseUrl: string,
  now: () => number = Date.now,
): EarnPreflightService {
  return {
    async check(profileId, owner, signal) {
      if (!baseUrl) throw new Error("Earn readiness service is not configured.");
      if (signal.aborted) throw new Error("Readiness check cancelled.");
      const profile = earnProfiles[profileId];
      if (!profile || !/^0x[0-9a-f]{40}$/i.test(owner))
        throw new Error("Invalid native destination.");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort);
      const timeout = setTimeout(abort, 12000);
      try {
        const response = await fetch(baseUrl.replace(/\/$/, "") + "/v1/earn/preflight", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profileId, owner }),
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Earn readiness service is not deployed yet."
              : "Vault readiness unavailable. Retry before reviewing an investment.",
          );
        const row = object(await response.json());
        if (controller.signal.aborted) throw new Error("Readiness check cancelled.");
        if (
          row.profileId !== profileId ||
          row.chainId !== profile.chainId ||
          typeof row.owner !== "string" ||
          row.owner.toLowerCase() !== owner.toLowerCase() ||
          typeof row.token !== "string" ||
          row.token.toLowerCase() !== profile.token.toLowerCase() ||
          typeof row.vault !== "string" ||
          row.vault.toLowerCase() !== profile.vault.toLowerCase() ||
          row.tokenDecimals !== 6 ||
          row.readOnly !== true ||
          row.executionAvailable !== false ||
          row.simulationAvailable !== false ||
          typeof row.blockHash !== "string" ||
          !/^0x[0-9a-f]{64}$/i.test(row.blockHash) ||
          /^0x0{64}$/i.test(row.blockHash) ||
          typeof row.timestampMs !== "number"
        )
          throw new Error("Vault readiness binding changed.");
        assertFresh({ timestampMs: row.timestampMs, nowMs: now() });
        const blockNumber = atoms(row.blockNumber),
          tokenBalance = atoms(row.tokenBalance),
          nativeBalance = atoms(row.nativeBalance),
          shares = atoms(row.shares);
        if (
          row.newCycleReady !== (shares === "0" && (profile.chainId === 1 || nativeBalance === "0"))
        )
          throw new Error("Inconsistent wallet readiness.");
        const gas = object(row.blockGas);
        const blockGas = {
          baseFee: atoms(gas.baseFee),
          gasUsed: atoms(gas.gasUsed),
          gasLimit: atoms(gas.gasLimit),
        };
        if (BigInt(blockGas.gasLimit) < 2n || BigInt(blockGas.gasUsed) > BigInt(blockGas.gasLimit))
          throw new Error("Invalid block gas.");
        let feeHistoryReward: string[] | null = null;
        if (profile.chainId === 1) {
          if (!Array.isArray(row.feeHistoryReward) || row.feeHistoryReward.length !== 8)
            throw new Error("Eight fee samples required.");
          feeHistoryReward = row.feeHistoryReward.map(atoms);
        } else if (row.feeHistoryReward !== null)
          throw new Error("Unexpected fee sampling profile.");
        return {
          profileId,
          chainId: profile.chainId,
          owner,
          token: profile.token,
          vault: profile.vault,
          tokenDecimals: 6,
          blockNumber,
          blockHash: row.blockHash,
          timestampMs: row.timestampMs,
          tokenBalance,
          nativeBalance,
          shares,
          newCycleReady: row.newCycleReady as boolean,
          blockGas,
          feeHistoryReward,
          readOnly: true,
          executionAvailable: false,
          simulationAvailable: false,
        };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
export const earnPreflightService = createEarnPreflightService(
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://127.0.0.1:3000" : ""),
);
