import { requireOptionalNativeModule } from "expo";
import type { StoredWalletBridge } from "./storedAccess";
import type { StoredSignerContract, StoredSignerCapabilities } from "@/domain/wallet/storedSigner";
import { Platform } from "react-native";

export function getSignerCapabilities(): StoredSignerCapabilities {
  const available = getStoredSigner() !== null;
  return {
    contractVersion: 1,
    available,
    walletStorage: available,
    backup: available,
    transfers: available,
    reason: available
      ? undefined
      : Platform.OS === "android"
        ? "notImplemented"
        : "unsupportedPlatform",
  };
}
export class WalletUnavailableError extends Error {
  constructor() {
    super(
      getSignerCapabilities().reason === "unsupportedPlatform"
        ? "Wallet access is unavailable on this platform. The replacement signer targets Android."
        : "Wallet access is temporarily unavailable while the new signer is being implemented.",
    );
  }
}

export function getStoredSigner(): StoredWalletBridge | null {
  return Platform.OS === "android" && Number(Platform.Version) >= 28 && __DEV__
    ? requireOptionalNativeModule<StoredWalletBridge>("GizuStoredSigner")
    : null;
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
  return Platform.OS === "android" && Number(Platform.Version) >= 28 && __DEV__
    ? requireOptionalNativeModule<StoredTransferBridge>("GizuStoredSigner")
    : null;
}
