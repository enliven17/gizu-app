import { AppError, errorMessage, normalizeError } from "@/domain/errors";
import { useCallback, useEffect, useState } from "react";
import {
  loadSwapTokens,
  parseSwapView,
  sourceAtoms,
  SWAP_RECOVERY_ENABLED,
  swapGateway,
  swapSigner,
  type ListedToken,
} from "./confidentialSwap";
import type { StoredSwapView } from "@/domain/wallet/storedSigner";

type SwapAction =
  "start" | "payout" | "recover" | "sell" | "resume" | "cancel" | "refresh" | "tokens" | "status";
function diagnostic(
  action: SwapAction,
  outcome: "started" | "completed" | "failed",
  cause?: unknown,
) {
  if (__DEV__)
    console.info("[swap]", {
      action,
      outcome,
      ...(outcome === "failed" ? { code: normalizeError(cause).code } : {}),
    });
}

export function useNativeSwap() {
  const [tokens, setTokens] = useState<ListedToken[]>([]);
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [fundingAddress, setFundingAddress] = useState("");
  const [status, setStatus] = useState<StoredSwapView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const native = swapSigner();
    const deposit = await native.getSwapDeposit();
    setFundingAddress(deposit.fundingAddress);
    try {
      setStatus(parseSwapView(await native.getSwapStatus(swapGateway)));
    } catch {
      diagnostic("status", "failed");
      setError("Saved swap status unavailable. Refresh before starting another operation.");
    }
  }, []);

  useEffect(() => {
    let live = true;
    loadSwapTokens()
      .then((list) => {
        if (!live) return;
        diagnostic("tokens", "completed");
        setTokens(list);
        setTarget((current) => current || list[0]?.address || "");
      })
      .catch((cause: unknown) => {
        diagnostic("tokens", "failed", cause);
        if (live) setError(errorMessage(cause, "Token list unavailable."));
      });
    queueMicrotask(() => {
      if (live) refresh().catch(() => diagnostic("refresh", "failed"));
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  async function run(name: SwapAction, action: () => Promise<void>) {
    diagnostic(name, "started");
    setBusy(true);
    setError("");
    try {
      await action();
      diagnostic(name, "completed");
    } catch (cause) {
      diagnostic(name, "failed", cause);
      setError(
        errorMessage(cause, "Swap stopped.") +
          " Check Swap status before retrying; a submitted operation may still complete.",
      );
    } finally {
      setBusy(false);
    }
  }

  const atoms = sourceAtoms(amount);
  return {
    tokens,
    target,
    setTarget,
    amount,
    setAmount,
    fundingAddress,
    status,
    busy,
    error,
    canStart: !!atoms && /^0x[0-9a-fA-F]{40}$/.test(target) && !busy,
    canSell:
      status?.phase === "COMPLETE" &&
      status.direction === "buy" &&
      !!status.receivedTargetAtoms &&
      status.receivedTargetAtoms !== "0" &&
      !busy,
    start: () =>
      run("start", async () => {
        if (!atoms)
          throw new AppError(
            "validation",
            "Enter a positive USDC amount with at most six decimal places.",
          );
        setStatus(parseSwapView(await swapSigner().startSwap(target, atoms, swapGateway)));
      }),
    // Only after a finished operation: a private balance left in C is spent without new funding.
    canPayout:
      status?.phase === "CANCELLED" &&
      /^[1-9]\d*$/.test(status.creditedAtoms) &&
      /^0x[0-9a-fA-F]{40}$/.test(target) &&
      !busy,
    sell: () =>
      run("sell", async () => {
        setStatus(parseSwapView(await swapSigner().startSell(swapGateway)));
      }),
    payout: () =>
      run("payout", async () => {
        setStatus(parseSwapView(await swapSigner().startPayout(target, swapGateway)));
      }),
    // Temporary recovery: no active operation to resume, and a token chosen for the leftover USDG.
    canRecover:
      SWAP_RECOVERY_ENABLED &&
      (status === null || status.phase === "CANCELLED" || status.phase === "COMPLETE") &&
      /^0x[0-9a-fA-F]{40}$/.test(target) &&
      !busy,
    recover: () =>
      run("recover", async () => {
        setStatus(parseSwapView(await swapSigner().startRecovery(target, swapGateway)));
      }),
    resume: () =>
      run("resume", async () =>
        setStatus(parseSwapView(await swapSigner().resumeSwap(swapGateway))),
      ),
    cancel: () =>
      run("cancel", async () =>
        setStatus(parseSwapView(await swapSigner().cancelSwap(swapGateway))),
      ),
    refresh: () => run("refresh", refresh),
  };
}
