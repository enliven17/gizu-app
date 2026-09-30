import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { SwapHoldingsSnapshot } from "@/domain/wallet/storedSigner";
import { loadSwapTokens, swapGateway, swapSigner, type ListedToken } from "./confidentialSwap";

/** Public balances only. Native storage owns discovery and native review owns every sale. */
export function useSwapHoldings() {
  const [snapshot, setSnapshot] = useState<SwapHoldingsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tokens, setTokens] = useState<ListedToken[]>([]);
  const [search, setSearch] = useState("");
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (target = "") => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await swapSigner().getSwapHoldings(target);
      if (alive.current) {
        setSnapshot(next);
        if (target)
          setNotice(
            next.holdings.some((holding) => holding.token === target.toLowerCase())
              ? "Recovered token balances from your allocated wallets."
              : "No balance for this token in your locally allocated wallets.",
          );
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Holdings unavailable. Retry.");
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const findTokens = async () => {
    try {
      const result = await loadSwapTokens();
      if (alive.current) setTokens(result);
    } catch {
      if (alive.current) setError("Token catalog unavailable. Retry finding tokens.");
    }
  };

  const sell = async (id: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const status = await swapSigner().sellSwapHolding(id, swapGateway);
      if (alive.current)
        setNotice(
          status.phase === "COMPLETE"
            ? "Sale completed. Proceeds returned to the new Monad wallets shown in Swap."
            : `Sale ${status.phase.toLowerCase()}. Open Swap to review or resume it.`,
        );
    } catch (cause) {
      if (alive.current)
        setNotice(
          cause instanceof Error ? cause.message : "Sale stopped. Check Swap before retrying.",
        );
    } finally {
      running.current = false;
      if (alive.current) {
        setBusy(false);
        void refresh();
      }
    }
  };

  return { snapshot, busy, error, notice, refresh, sell, findTokens, tokens, search, setSearch };
}
