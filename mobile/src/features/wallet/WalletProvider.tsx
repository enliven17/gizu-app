import { createStoredTransfers } from "@/services/wallet/storedTransfers";
import { AppState } from "react-native";
import { useWalletTransfers } from "./useWalletTransfers";
import { type WalletTransferService } from "@/domain/wallet/types";
import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import type { WalletSession } from "@/services/access";
import { monadBalanceService, type WalletBalanceService } from "@/services/wallet/balance";
import { clipboardService } from "@/services/clipboard";
import { useWalletController } from "./useWalletController";

const WalletContext = createContext<
  | (ReturnType<typeof useWalletController> & {
      session: WalletSession;
      transfers: ReturnType<typeof useWalletTransfers>;
    })
  | null
>(null);
export function WalletProvider({
  session,
  balance = monadBalanceService,
  children,
  transfers,
}: PropsWithChildren<{
  session: WalletSession;
  balance?: WalletBalanceService;
  transfers?: WalletTransferService;
}>) {
  const state = useWalletController(session.address, balance, clipboardService);
  const service = useMemo(() => {
    if (transfers) return transfers;
    if (!session.walletId) throw new Error("Stored wallet identity required");
    return createStoredTransfers(session.walletId);
  }, [session.walletId, transfers]);
  const operations = useWalletTransfers(session.address, service, state.refresh);
  const { refresh } = operations;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  return (
    <WalletContext.Provider value={{ ...state, session, transfers: operations }}>
      {children}
    </WalletContext.Provider>
  );
}
export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("WalletProvider is required");
  return value;
}
