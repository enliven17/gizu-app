import { getStoredEarnWithdrawalSigner } from "@/services/wallet/nativeBridge";
import { parseEarnWithdrawals, type EarnWithdrawalService } from "@/domain/earn/withdrawal";
import type { EarnIntent } from "@/domain/earn/types";
export function createEarnWithdrawalService(
  bridgeFactory = getStoredEarnWithdrawalSigner,
): EarnWithdrawalService {
  let occupied = false,
    generation = 0;
  async function action(
    intent: EarnIntent,
    task: (bridge: NonNullable<ReturnType<typeof bridgeFactory>>) => Promise<unknown>,
    array = false,
  ) {
    if (occupied) throw new Error("Another native withdrawal action is running.");
    const bridge = bridgeFactory();
    if (!bridge) throw new Error("Native Earn withdrawal requires the updated build.");
    occupied = true;
    const attempt = generation;
    try {
      const raw = await task(bridge);
      if (attempt !== generation)
        throw new Error("Withdrawal closed. Check saved progress before retrying.");
      const rows = parseEarnWithdrawals(array ? raw : [raw], intent);
      if (!array && rows.length !== 1) throw new Error("Native withdrawal cycle changed.");
      return rows;
    } finally {
      occupied = false;
    }
  }
  return {
    async available() {
      return bridgeFactory() !== null;
    },
    list: (intent) =>
      action(intent, (bridge) => bridge.listEarnWithdrawalOperations(intent.walletId), true),
    async execute(intent, id, revision) {
      if (!/^[-a-zA-Z0-9_]{1,128}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1)
        throw new Error("Verified return revision required.");
      return (
        await action(intent, (bridge) =>
          bridge.executeEarnWithdrawal(intent.walletId, id, revision),
        )
      )[0]!;
    },
    async resume(intent, operation) {
      parseEarnWithdrawals([operation], intent);
      return (
        await action(intent, (bridge) =>
          bridge.resumeEarnWithdrawalOperation(
            intent.walletId,
            operation.operationId,
            operation.revision,
          ),
        )
      )[0]!;
    },
    async cancelUnsigned(intent, operation) {
      parseEarnWithdrawals([operation], intent);
      if (operation.status !== "planned")
        throw new Error("Saved withdrawal authority must be reconciled.");
      return (
        await action(intent, (bridge) =>
          bridge.cancelEarnWithdrawalOperation(
            intent.walletId,
            operation.operationId,
            operation.revision,
          ),
        )
      )[0]!;
    },
    async reconcile(intent, operation) {
      parseEarnWithdrawals([operation], intent);
      return (
        await action(intent, (bridge) =>
          bridge.readEarnWithdrawalSettlement(
            intent.walletId,
            operation.operationId,
            operation.revision,
          ),
        )
      )[0]!;
    },
    cancel() {
      generation++;
      if (occupied) bridgeFactory()?.lock();
    },
  };
}
export const earnWithdrawalService = createEarnWithdrawalService();
