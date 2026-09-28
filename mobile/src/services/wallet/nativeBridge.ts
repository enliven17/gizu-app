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
  return __DEV__ && supportedPlatform()
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
  capability: "walletStorage" | "backup" | "transfers",
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
