import { useEffect, useState } from "react";
import type { MainnetPortfolioSnapshot } from "@/domain/wallet/storedSigner";
import { appendBalancePoint, type BalancePoint } from "@/domain/wallet/balanceHistory";
import { balanceHistoryStore } from "@/storage/balanceHistory";
import { swapDemoEnabled } from "@/features/swap/demo/swapDemo";

/** Loads this wallet's observed balances and records each complete, fresh snapshot. */
export function useBalanceHistory(snapshot: MainnetPortfolioSnapshot | null) {
  // Demo balances keep their own history, so a demo never shows up in the real chart.
  const walletId =
    snapshot?.walletId && swapDemoEnabled() ? `${snapshot.walletId}:swap-demo` : snapshot?.walletId;
  const [state, setState] = useState<{ walletId?: string; history: BalancePoint[] }>({
    history: [],
  });
  const fresh = snapshot && snapshot.balanceComplete !== false && !snapshot.stale;
  const at = fresh ? snapshot.checkedAt : undefined;
  const atoms = fresh ? snapshot.totalAtoms : undefined;
  useEffect(() => {
    if (!walletId) return;
    let active = true;
    void balanceHistoryStore.load(walletId).then((loaded) => {
      if (!active) return;
      const next =
        at !== undefined && atoms !== undefined
          ? appendBalancePoint(loaded, { at, atoms })
          : loaded;
      setState({ walletId, history: next });
      if (next !== loaded) void balanceHistoryStore.save(walletId, next).catch(() => undefined);
    });
    return () => {
      active = false;
    };
  }, [walletId, at, atoms]);
  return state.walletId === walletId ? state.history : [];
}
