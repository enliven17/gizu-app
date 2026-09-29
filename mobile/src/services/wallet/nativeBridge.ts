import { requireOptionalNativeModule } from "expo";
import type { StoredWalletBridge } from "./storedAccess";
import type { StoredSignerContract, StoredSignerCapabilities } from "@/domain/wallet/storedSigner";
import { Platform } from "react-native";

let authorizationGeneration = 0;

function supportedPlatform() {
  return (
    (Platform.OS === "android" && Number(Platform.Version) >= 28) ||
    (Platform.OS === "ios" && Number.parseInt(String(Platform.Version), 10) >= 18)
  );
}
function nativeModule(): StoredSignerContract | null {
  // iOS Release eligibility is reported by the signed native binary, not a JS flag.
  return (__DEV__ || Platform.OS === "ios") && supportedPlatform()
    ? requireOptionalNativeModule<StoredSignerContract>("GizuStoredSigner")
    : null;
}
export async function getSignerCapabilities(): Promise<StoredSignerCapabilities> {
  const unavailable: StoredSignerCapabilities = {
    contractVersion: 1,
    available: false,
    walletStorage: false,
    backup: false,
    transfers: false,
    swaps: false,
    reason: supportedPlatform() ? "notImplemented" : "unsupportedPlatform",
  };
  try {
    const native = nativeModule();
    if (!native) return unavailable;
    const result = await native.getCapabilities();
    if (result.contractVersion !== 1 || result.available !== true) return unavailable;
    return {
      contractVersion: 1,
      available: true,
      walletStorage: result.walletStorage === true,
      backup: result.backup === true,
      transfers: result.transfers === true,
      swaps: result.swaps === true,
    };
  } catch {
    return unavailable;
  }
}
export class WalletUnavailableError extends Error {
  constructor() {
    super(
      supportedPlatform()
        ? "Wallet access is temporarily unavailable in this build or its native capabilities are not ready."
        : "Wallet access is unavailable on this platform. Use Android 9+ or iOS 18+ in a development build.",
    );
  }
}
async function checked(
  native: StoredSignerContract,
  capability: "walletStorage" | "backup" | "transfers" | "swaps",
) {
  const generation = authorizationGeneration;
  const value = await native.getCapabilities();
  if (generation !== authorizationGeneration) throw new Error("Wallet operation cancelled.");
  if (value.contractVersion !== 1 || value.available !== true || value[capability] !== true)
    throw new WalletUnavailableError();
}
export function getStoredSigner(): StoredWalletBridge | null {
  const native = nativeModule();
  if (!native) return null;
  return {
    async getWalletState() {
      await checked(native, "walletStorage");
      return native.getWalletState();
    },
    async createWallet() {
      await checked(native, "walletStorage");
      return native.createWallet();
    },
    async openWallet() {
      await checked(native, "walletStorage");
      return native.openWallet();
    },
    async backupWallet() {
      await checked(native, "backup");
      return native.backupWallet();
    },
    async restoreWallet() {
      await checked(native, "backup");
      return native.restoreWallet();
    },
    lock: () => {
      authorizationGeneration++;
      native.lock();
    },
  };
}
export type StoredTransferBridge = Pick<
  StoredSignerContract,
  | "executeOperation"
  | "listOperations"
  | "getOperationStatus"
  | "resumeOperation"
  | "cancelOperation"
  | "lock"
>;
export function getStoredTransferSigner(): StoredTransferBridge | null {
  const native = nativeModule();
  if (!native) return null;
  return {
    async executeOperation(proposal) {
      await checked(native, "transfers");
      return native.executeOperation(proposal);
    },
    async listOperations() {
      await checked(native, "transfers");
      return native.listOperations();
    },
    async getOperationStatus(id) {
      await checked(native, "transfers");
      return native.getOperationStatus(id);
    },
    async resumeOperation(id, revision) {
      await checked(native, "transfers");
      return native.resumeOperation(id, revision);
    },
    async cancelOperation(id) {
      await checked(native, "transfers");
      return native.cancelOperation(id);
    },
    lock: () => {
      authorizationGeneration++;
      native.lock();
    },
  };
}
export type StoredSwapBridge = Pick<
  StoredSignerContract,
  | "getSwapDeposit"
  | "startSwap"
  | "startSell"
  | "startPayout"
  | "startRecovery"
  | "resumeSwap"
  | "getSwapStatus"
  | "cancelSwap"
  | "lock"
>;
export function getStoredSwapSigner(): StoredSwapBridge | null {
  const native = nativeModule();
  if (!native) return null;
  return {
    async getSwapDeposit() {
      await checked(native, "swaps");
      return native.getSwapDeposit();
    },
    async startSwap(target, amountAtoms, gateway) {
      await checked(native, "swaps");
      return native.startSwap(target, amountAtoms, gateway);
    },
    async startSell(gateway) {
      await checked(native, "swaps");
      return native.startSell(gateway);
    },
    async startPayout(target, gateway) {
      await checked(native, "swaps");
      if (typeof native.startPayout !== "function")
        throw new Error("Buying from the private balance is not available in this build.");
      return native.startPayout(target, gateway);
    },
    async startRecovery(target, gateway) {
      await checked(native, "swaps");
      if (typeof native.startRecovery !== "function")
        throw new Error("Swap recovery is not available in this build.");
      return native.startRecovery(target, gateway);
    },
    async resumeSwap(gateway) {
      await checked(native, "swaps");
      return native.resumeSwap(gateway);
    },
    async getSwapStatus(gateway) {
      await checked(native, "swaps");
      return native.getSwapStatus(gateway);
    },
    async cancelSwap(gateway) {
      await checked(native, "swaps");
      return native.cancelSwap(gateway);
    },
    lock: () => {
      authorizationGeneration++;
      native.lock();
    },
  };
}
