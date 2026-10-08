import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseBalanceHistory, type BalancePoint } from "@/domain/wallet/balanceHistory";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

/** Non-secret balance observations, scoped per wallet. */
export function createBalanceHistoryStore(storage: Storage = AsyncStorage) {
  const key = (walletId: string) => `gizu:balance-history:v1:${encodeURIComponent(walletId)}`;
  return {
    async load(walletId: string): Promise<BalancePoint[]> {
      try {
        const raw = await storage.getItem(key(walletId));
        return raw === null ? [] : parseBalanceHistory(JSON.parse(raw));
      } catch {
        return [];
      }
    },
    async save(walletId: string, history: BalancePoint[]): Promise<void> {
      await storage.setItem(key(walletId), JSON.stringify(history));
    },
  };
}
export const balanceHistoryStore = createBalanceHistoryStore();
