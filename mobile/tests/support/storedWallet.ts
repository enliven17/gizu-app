import type { StoredWalletState } from "@/domain/wallet/storedSigner";
import type { StoredWalletBridge } from "@/services/wallet/storedAccess";

export const testWalletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12";
export function readyWallet(address = "0x" + "1".repeat(40)): StoredWalletState {
  return {
    status: "ready",
    walletId: testWalletId,
    accounts: [{ accountIndex: 0, address, chainId: 10143 }],
  };
}

// Fresh boundary mocks per journey; access/session logic stays real.
export function storedWalletBridge(state: StoredWalletState = readyWallet()) {
  return {
    getWalletState: jest.fn<Promise<StoredWalletState>, []>().mockResolvedValue(state),
    createWallet: jest.fn<Promise<StoredWalletState>, []>().mockResolvedValue({
      status: "backupRequired",
      walletId: testWalletId,
    }),
    openWallet: jest.fn<Promise<StoredWalletState>, []>().mockResolvedValue(state),
    backupWallet: jest.fn<Promise<StoredWalletState>, []>().mockResolvedValue(readyWallet()),
    restoreWallet: jest.fn<Promise<StoredWalletState>, []>().mockResolvedValue(readyWallet()),
    lock: jest.fn(),
  } satisfies StoredWalletBridge;
}
