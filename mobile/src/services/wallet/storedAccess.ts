import { AppError } from "@/domain/errors";
import type { AccessService, WalletSession } from "../access";
import type { StoredSignerContract, StoredWalletState } from "@/domain/wallet/storedSigner";
import { WalletUnavailableError } from "./nativeBridge";

export type StoredWalletBridge = Pick<
  StoredSignerContract,
  | "getWalletState"
  | "createWallet"
  | "openWallet"
  | "backupWallet"
  | "restoreWallet"
  | "getSwapDeposit"
  | "lock"
>;

async function session(
  state: StoredWalletState,
  native: StoredWalletBridge,
): Promise<WalletSession> {
  if (state.status === "recoveryRequired")
    throw new AppError(
      "recovery-required",
      "Local wallet storage could not be read. Restore your backup using the original passkey.",
    );
  if (state.status === "backupRequired")
    throw new AppError("backup-required", "Save and verify your backup before continuing.");
  if (state.status !== "ready" || !/^[0-9a-f-]{36}$/i.test(state.walletId))
    throw new AppError("invalid-response");
  const account = state.accounts?.find((item) => item.accountIndex === 0);
  if (!account || account.chainId !== 10143 || !/^0x[0-9a-f]{40}$/i.test(account.address))
    throw new AppError("invalid-response", "Invalid native wallet");
  const { fundingAddress } = await native.getSwapDeposit();
  if (!/^0x[0-9a-f]{40}$/i.test(fundingAddress)) throw new AppError("invalid-response");
  return {
    kind: "mainnet",
    method: "Passkey",
    accountId: fundingAddress.toLowerCase(),
    address: fundingAddress,
    accountIndex: 1,
    chainId: 143,
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
        if (generation !== attempt) throw new AppError("cancelled");
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
      const result = await session(state, native);
      active();
      return result;
    },
    async restore() {
      const attempt = ++generation;
      const result = await bridge().restoreWallet();
      if (generation !== attempt) throw new AppError("cancelled");
      const restored = await session(result, bridge());
      if (generation !== attempt) throw new AppError("cancelled");
      return restored;
    },
    cancel() {
      generation++;
      getBridge()?.lock();
    },
  };
}
