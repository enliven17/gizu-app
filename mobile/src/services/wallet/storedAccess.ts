import type { AccessService, WalletSession } from "../access";
import type { StoredSignerContract, StoredWalletState } from "@/domain/wallet/storedSigner";
import { WalletUnavailableError } from "./nativeBridge";

export type StoredWalletBridge = Pick<
  StoredSignerContract,
  "getWalletState" | "createWallet" | "openWallet" | "backupWallet" | "restoreWallet" | "lock"
>;

function session(state: StoredWalletState): WalletSession {
  if (state.status !== "ready" || !/^[0-9a-f-]{36}$/i.test(state.walletId))
    throw new Error("Verified backup required");
  const account = state.accounts?.find((item) => item.accountIndex === 0);
  if (!account || account.chainId !== 10143 || !/^0x[0-9a-f]{40}$/i.test(account.address))
    throw new Error("Invalid native wallet");
  return {
    kind: "testnet",
    method: "Passkey",
    accountId: account.address.toLowerCase(),
    address: account.address,
    accountIndex: 0,
    chainId: 10143,
    walletId: state.walletId,
  };
}
export function createStoredWalletAccess(
  getBridge: () => StoredWalletBridge | null,
): AccessService {
  let generation = 0;
  function bridge() {
    const value = getBridge();
    if (!value) throw new WalletUnavailableError();
    return value;
  }
  return {
    method: "Passkey",
    async canRestore() {
      const state = await bridge().getWalletState();
      return state.status === "absent" || state.status === "recoveryRequired";
    },
    async request() {
      const attempt = ++generation;
      const native = bridge();
      const active = () => {
        if (generation !== attempt) throw new Error("Cancelled");
      };
      let state = await native.getWalletState();
      active();
      if (state.status === "absent") {
        state = await native.createWallet();
        active();
      } else if (state.status === "ready") {
        state = await native.openWallet();
        active();
      }
      if (state.status === "backupRequired") {
        state = await native.backupWallet();
        active();
      }
      return session(state);
    },
    async restore() {
      const attempt = ++generation;
      const result = await bridge().restoreWallet();
      if (generation !== attempt) throw new Error("Cancelled");
      return session(result);
    },
    cancel() {
      generation++;
      getBridge()?.lock();
    },
  };
}
