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
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    let live = true;
    loadSwapTokens()
      .then((list) => {
        if (!live) return;
        setTokens(list);
        setTarget((current) => current || list[0]?.address || "");
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "Token list unavailable.");
      });
    queueMicrotask(() => {
      if (live) refresh().catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Swap stopped.");
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
      run(async () => {
        if (!atoms) throw new Error("Enter from 0.000001 to 10 USDC.");
        setStatus(parseSwapView(await swapSigner().startSwap(target, atoms, swapGateway)));
      }),
    // Only after a finished operation: a private balance left in C is spent without new funding.
    canPayout:
      (status?.phase === "CANCELLED" || status?.phase === "COMPLETE") &&
      /^[1-9]\d*$/.test(status.creditedAtoms) &&
      /^0x[0-9a-fA-F]{40}$/.test(target) &&
      !busy,
    sell: () =>
      run(async () => {
        setStatus(parseSwapView(await swapSigner().startSell(swapGateway)));
      }),
    payout: () =>
      run(async () => {
        setStatus(parseSwapView(await swapSigner().startPayout(target, swapGateway)));
      }),
    // Temporary recovery: no active operation to resume, and a token chosen for the leftover USDG.
    canRecover:
      SWAP_RECOVERY_ENABLED &&
      (status === null || status.phase === "CANCELLED" || status.phase === "COMPLETE") &&
      /^0x[0-9a-fA-F]{40}$/.test(target) &&
      !busy,
    recover: () =>
      run(async () => {
        setStatus(parseSwapView(await swapSigner().startRecovery(target, swapGateway)));
      }),
    resume: () =>
      run(async () => setStatus(parseSwapView(await swapSigner().resumeSwap(swapGateway)))),
    cancel: () =>
      run(async () => setStatus(parseSwapView(await swapSigner().cancelSwap(swapGateway)))),
    refresh: () => run(refresh),
  };
}
