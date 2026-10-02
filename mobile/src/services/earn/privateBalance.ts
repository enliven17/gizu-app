import { monadConfidentialUsdcAssetId } from "@/domain/earn/types";
import type { EarnPrivateBalanceService } from "@/domain/earn/types";
import { getStoredEarnBalanceSigner } from "@/services/wallet/nativeBridge";
import { assertFresh } from "@/domain/earn/policy";
type Bridge = { readEarnBalance(walletId: string): Promise<unknown>; lock(): void };
export function createEarnPrivateBalanceService(
  getBridge: () => Bridge | null = getStoredEarnBalanceSigner,
): EarnPrivateBalanceService {
  let generation = 0,
    occupied = false;
  return {
    async read(intent) {
      if (occupied) throw new Error("A confidential balance check is in progress.");
      const native = getBridge();
      if (!native) throw new Error("Confidential balances require the updated native build.");
      const attempt = generation;
      occupied = true;
      try {
        const value = await native.readEarnBalance(intent.walletId);
        if (attempt !== generation) throw new Error("Confidential balance check cancelled.");
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Invalid native balance.");
        const row = value as Record<string, unknown>;
        if (
          typeof row.confidentialAddress !== "string" ||
          row.confidentialAddress.toLowerCase() !== intent.confidentialAddress.toLowerCase() ||
          row.authenticated !== true ||
          row.operationScoped !== false ||
          typeof row.assetId !== "string" ||
          row.assetId !== monadConfidentialUsdcAssetId ||
          typeof row.available !== "string" ||
          !/^(0|[1-9][0-9]{0,77})$/.test(row.available) ||
          BigInt(row.available) >= 1n << 256n ||
          typeof row.timestampMs !== "number"
        )
          throw new Error("Confidential balance binding changed.");
        assertFresh({ timestampMs: row.timestampMs, nowMs: Date.now() });
        return {
          confidentialAddress: intent.confidentialAddress,
          assetId: row.assetId,
          available: row.available,
          timestampMs: row.timestampMs,
          authenticated: true,
          operationScoped: false,
        };
      } finally {
        occupied = false;
      }
    },
    cancel() {
      generation++;
      if (occupied) getBridge()?.lock();
    },
  };
}
