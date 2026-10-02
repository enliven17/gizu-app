import { getSignerCapabilities, getStoredEarnPayoutSigner } from "@/services/wallet/nativeBridge";
import {
  parsePayoutOperations,
  payoutRequest,
  type EarnPayoutService,
} from "@/domain/earn/privatePayout";
import type { EarnIntent } from "@/domain/earn/types";
export function createEarnPayoutService(
  bridgeFactory = getStoredEarnPayoutSigner,
): EarnPayoutService {
  let occupied = false,
    generation = 0;
  const bridge = () => {
    const b = bridgeFactory();
    if (!b) throw new Error("Native confidential payouts are unavailable in this build.");
    return b;
  };
  async function action(
    intent: EarnIntent,
    task: (b: NonNullable<ReturnType<typeof bridgeFactory>>) => Promise<unknown>,
    array = false,
  ) {
    if (occupied) throw new Error("Another confidential payout is running.");
    occupied = true;
    const attempt = generation;
    try {
      const raw = await task(bridge());
      if (attempt !== generation)
        throw new Error("Payout closed. Check saved progress before retrying.");
      return parsePayoutOperations(array ? raw : [raw], intent);
    } finally {
      occupied = false;
    }
  }
  return {
    async available() {
      return (await getSignerCapabilities()).earnPrivatePayoutExecution === true;
    },
    async list(intent) {
      return action(intent, (b) => b.listEarnPrivatePayoutOperations(intent.walletId), true);
    },
    async execute(intent, source, leg) {
      const request = payoutRequest(intent, source, leg);
      return (await action(intent, (b) => b.executeEarnPrivatePayout(request)))[0]!;
    },
    async resume(intent, op) {
      parsePayoutOperations([op], intent);
      return (
        await action(intent, (b) =>
          b.resumeEarnPrivatePayoutOperation(intent.walletId, op.operationId, op.revision),
        )
      )[0]!;
    },
    async reconcile(intent, op) {
      parsePayoutOperations([op], intent);
      return (
        await action(intent, (b) =>
          b.readEarnPrivatePayoutSettlement(intent.walletId, op.operationId, op.revision),
        )
      )[0]!;
    },
    async cancelUnsigned(intent, op) {
      parsePayoutOperations([op], intent);
      if (op.status !== "planned") throw new Error("Signed payout authority must be reconciled.");
      return (
        await action(intent, (b) =>
          b.cancelEarnPrivatePayoutOperation(intent.walletId, op.operationId, op.revision),
        )
      )[0]!;
    },
    cancel() {
      generation++;
      if (occupied) bridgeFactory()?.lock();
    },
  };
}
export const earnPayoutService = createEarnPayoutService();
