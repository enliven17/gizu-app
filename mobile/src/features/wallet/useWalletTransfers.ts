import { useCallback, useEffect, useRef, useState } from "react";
import type { WalletHistory, WalletTransferService } from "@/domain/wallet/types";
import { transferProposal } from "@/domain/wallet/transfers";

type TransferPhase =
  | "loading"
  | "refreshing"
  | "ready"
  | "needsAttention"
  | "awaitingNative"
  | "cancelling"
  | "recoveryRequired";
type TransferState = { phase: TransferPhase; history: WalletHistory; message: string };
const initialState: TransferState = {
  phase: "loading",
  history: { entries: [], blocked: false },
  message: "Loading transfer history…",
};
function settledState(history: WalletHistory, message: string): TransferState {
  return { history, message, phase: history.blocked ? "needsAttention" : "ready" };
}

export function useWalletTransfers(
  address: string,
  service: WalletTransferService,
  onSettled: () => Promise<void>,
  enabled = true,
) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [state, setState] = useState<TransferState>(initialState);
  const [owner, setOwner] = useState({ address, service, enabled });
  // Reset before children render so a replacement wallet never displays the old form/history.
  if (owner.address !== address || owner.service !== service || owner.enabled !== enabled) {
    setOwner({ address, service, enabled });
    setState(initialState);
    setRecipient("");
    setAmount("0.001");
  }

  // The synchronous guard prevents duplicate presses before React renders the next phase.
  // Generation checks also reject late results from a previous wallet/service or unmount.
  const generation = useRef(0);
  const running = useRef<number | null>(null);
  const ready = state.phase === "ready" || state.phase === "needsAttention";
  const busy = ["loading", "refreshing", "awaitingNative", "cancelling"].includes(state.phase);

  const load = useCallback(() => {
    if (!enabled || running.current !== null) return Promise.resolve(false);
    const attempt = generation.current;
    running.current = attempt;
    return Promise.resolve()
      .then(() => service.history(address))
      .then((history) => {
        if (generation.current !== attempt) return false;
        setState(
          settledState(
            history,
            history.blocked
              ? "An operation needs attention. Refresh status, then resume or cancel its remaining steps."
              : "",
          ),
        );
        return true;
      })
      .catch(() => {
        if (generation.current !== attempt) return false;
        setState((current) => ({
          ...current,
          phase: "recoveryRequired",
          message:
            "Could not refresh history. Refresh again before sending; shown results may be out of date.",
        }));
        return true;
      })
      .finally(() => {
        if (running.current === attempt) running.current = null;
      });
  }, [address, service, enabled]);

  useEffect(() => {
    const lifetime = ++generation.current;
    running.current = null;
    void load();
    return () => {
      generation.current = lifetime + 1;
      running.current = null;
      service.cancel();
    };
  }, [load, service]);

  const refresh = useCallback(async () => {
    if (!enabled || running.current !== null) return;
    setState((current) => ({ ...current, phase: "refreshing" }));
    if (await load()) await onSettled();
  }, [load, onSettled, enabled]);

  async function runNativeAction(
    action: () => Promise<WalletHistory>,
    phase: "awaitingNative" | "cancelling",
    pendingMessage: string,
    resultMessage: (history: WalletHistory) => string,
    failureMessage: string,
  ) {
    if (!enabled || running.current !== null || !ready) return;
    const attempt = generation.current;
    running.current = attempt;
    setState((current) => ({ ...current, phase, message: pendingMessage }));
    try {
      const history = await action();
      if (generation.current === attempt) setState(settledState(history, resultMessage(history)));
    } catch {
      if (generation.current === attempt) {
        setState((current) => ({ ...current, phase: "recoveryRequired", message: failureMessage }));
      }
    } finally {
      if (running.current === attempt) running.current = null;
      if (generation.current === attempt) await onSettled();
    }
  }

  async function send() {
    if (!enabled || running.current !== null || !ready || state.history.blocked) return;
    try {
      transferProposal("0", recipient.trim(), amount.trim());
    } catch {
      setState((current) => ({
        ...current,
        message: "Enter a full recipient address and an amount above 0 up to 0.1 MON.",
      }));
      return;
    }
    // Native owns review, signing and submission; the bridge exposes only the final result.
    await runNativeAction(
      () => service.send(address, recipient.trim(), amount.trim()),
      "awaitingNative",
      "Review the exact transfer in the native screen, then approve with your passkey.",
      (history) =>
        history.blocked
          ? "Transfer pending or unknown. Refresh status; do not submit again."
          : "Native operation finished. Check the transaction status below.",
      "Transfer stopped or cancelled. Refresh history before retrying. Use this wallet’s passkey and check testnet funds. A submitted transfer cannot be undone.",
    );
  }

  function operationMessage(history: WalletHistory) {
    return history.blocked
      ? "Operation needs attention. Refresh status before continuing."
      : "Operation updated.";
  }
  const operationFailure =
    "Operation paused or changed. Refresh status before retrying. Submitted transfers cannot be undone.";
  async function resume(id: string, revision: number) {
    const resumeOperation = service.resume;
    if (!resumeOperation) return;
    await runNativeAction(
      () => resumeOperation.call(service, address, id, revision),
      "awaitingNative",
      "Opening native operation…",
      operationMessage,
      operationFailure,
    );
  }
  async function cancelOperation(id: string) {
    const cancel = service.cancelOperation;
    if (!cancel) return;
    await runNativeAction(
      () => cancel.call(service, address, id),
      "cancelling",
      "Opening native operation…",
      operationMessage,
      operationFailure,
    );
  }
  return {
    resume,
    cancelOperation,
    recipient,
    setRecipient,
    amount,
    setAmount,
    history: state.history,
    phase: state.phase,
    busy,
    ready,
    message: state.message,
    refresh,
    send,
  };
}
