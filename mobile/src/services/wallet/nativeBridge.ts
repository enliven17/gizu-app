import { AppError } from "@/domain/errors";
import { callWallet } from "./errors";
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
    const result = await callWallet(() => native.getCapabilities());
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
export class WalletUnavailableError extends AppError {
  constructor() {
    super(
      "unavailable",
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
  const value = await callWallet(() => native.getCapabilities());
  if (generation !== authorizationGeneration) throw new AppError("cancelled");
  if (value.contractVersion !== 1 || value.available !== true || value[capability] !== true)
    throw new WalletUnavailableError();
}
// Native read ceremonies share one store lock. Queue portfolio/holdings reads, never signing.
let readTail: Promise<unknown> = Promise.resolve();
function readNative<T>(work: () => Promise<T>): Promise<T> {
  const generation = authorizationGeneration;
  const run = () => {
    if (generation !== authorizationGeneration) throw new AppError("cancelled");
    return work();
  };
  const result = readTail.then(run, run);
  readTail = result.catch(() => undefined);
  return result;
}
export function getStoredSigner(): StoredWalletBridge | null {
  const native = nativeModule();
  if (!native) return null;
  return {
    async getSwapDeposit() {
      await checked(native, "walletStorage");
      return callWallet(() => native.getSwapDeposit());
    },
    async getWalletState() {
      await checked(native, "walletStorage");
      return callWallet(() => native.getWalletState());
    },
    async createWallet() {
      await checked(native, "walletStorage");
      return callWallet(() => native.createWallet());
    },
    async openWallet() {
      await checked(native, "walletStorage");
      return callWallet(() => native.openWallet());
    },
    async backupWallet() {
      await checked(native, "backup");
      return callWallet(() => native.backupWallet());
    },
    async restoreWallet() {
      await checked(native, "backup");
      return callWallet(() => native.restoreWallet());
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
      return callWallet(() => native.executeOperation(proposal));
    },
    async listOperations() {
      await checked(native, "transfers");
      return callWallet(() => native.listOperations());
    },
    async getOperationStatus(id) {
      await checked(native, "transfers");
      return callWallet(() => native.getOperationStatus(id));
    },
    async resumeOperation(id, revision) {
      await checked(native, "transfers");
      return callWallet(() => native.resumeOperation(id, revision));
    },
    async cancelOperation(id) {
      await checked(native, "transfers");
      return callWallet(() => native.cancelOperation(id));
    },
    lock: () => {
      authorizationGeneration++;
      native.lock();
    },
  };
}
export type StoredSwapBridge = Pick<
  StoredSignerContract,
  | "getMainnetPortfolio"
  | "getSwapDeposit"
  | "getSwapHoldings"
  | "sellSwapHolding"
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
      return callWallet(() => native.getSwapDeposit());
    },
    async startSwap(target, amountAtoms, gateway) {
      await checked(native, "swaps");
      return callWallet(() => native.startSwap(target, amountAtoms, gateway));
    },
    getMainnetPortfolio() {
      return readNative(async () => {
        await checked(native, "walletStorage");
        if (typeof native.getMainnetPortfolio !== "function")
          throw new AppError(
            "unavailable",
            "Mainnet balances need an updated native build on this platform.",
          );
        return callWallet(() => native.getMainnetPortfolio());
      });
    },
    getSwapHoldings(target) {
      return readNative(async () => {
        await checked(native, "swaps");
        if (typeof native.getSwapHoldings !== "function")
          throw new AppError("unavailable", "Token holdings need an updated Android build.");
        return callWallet(() => native.getSwapHoldings(target));
      });
    },
    async sellSwapHolding(holdingId, gateway) {
      await checked(native, "swaps");
      if (typeof native.sellSwapHolding !== "function")
        throw new AppError("unavailable", "Selling holdings is not available in this build.");
      return callWallet(() => native.sellSwapHolding(holdingId, gateway));
    },
    async startSell(gateway) {
      await checked(native, "swaps");
      return callWallet(() => native.startSell(gateway));
    },
    async startPayout(target, gateway) {
      await checked(native, "swaps");
      if (typeof native.startPayout !== "function")
        throw new AppError(
          "unavailable",
          "Buying from the private balance is not available in this build.",
        );
      return callWallet(() => native.startPayout(target, gateway));
    },
    async startRecovery(target, gateway) {
      await checked(native, "swaps");
      if (typeof native.startRecovery !== "function")
        throw new AppError("unavailable", "Swap recovery is not available in this build.");
      return callWallet(() => native.startRecovery(target, gateway));
    },
    async resumeSwap(gateway) {
      await checked(native, "swaps");
      return callWallet(() => native.resumeSwap(gateway));
    },
    async getSwapStatus(gateway) {
      await checked(native, "swaps");
      return callWallet(() => native.getSwapStatus(gateway));
    },
    async cancelSwap(gateway) {
      await checked(native, "swaps");
      return callWallet(() => native.cancelSwap(gateway));
    },
    lock: () => {
      authorizationGeneration++;
      native.lock();
    },
  };
}
