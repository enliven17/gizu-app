import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import {
  getSignerCapabilities,
  getStoredSigner,
  getStoredTransferSigner,
  getStoredSwapSigner,
} from "@/services/wallet/nativeBridge";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));

test("iOS release reads public portfolio without enabling unsupported execution", async () => {
  const development = __DEV__;
  Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: false });
  const native = {
    getCapabilities: jest.fn().mockResolvedValue({
      contractVersion: 1,
      available: true,
      walletStorage: true,
      earnVaultExecution: false,
    }),
    getMainnetPortfolio: jest.fn().mockResolvedValue({ walletId: "wallet" }),
  };
  try {
    jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
    await expect(getStoredSwapSigner()!.getMainnetPortfolio()).resolves.toEqual({
      walletId: "wallet",
    });
    expect(native.getMainnetPortfolio).toHaveBeenCalledTimes(1);
    jest
      .mocked(requireOptionalNativeModule)
      .mockReturnValue({ getCapabilities: native.getCapabilities });
    await expect(getStoredSwapSigner()!.getMainnetPortfolio()).rejects.toThrow(
      /updated native build/,
    );
  } finally {
    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: development });
  }
});
const originalOS = Platform.OS;
const originalVersion = Platform.Version;
beforeEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  Object.defineProperty(Platform, "Version", { configurable: true, value: "18.5" });
});
afterEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
  Object.defineProperty(Platform, "Version", { configurable: true, value: originalVersion });
});
test("iOS consults native capabilities and never enables an unfinished transfer method", async () => {
  const native = {
    getCapabilities: jest.fn().mockResolvedValue({
      contractVersion: 1,
      available: true,
      walletStorage: true,
      backup: true,
      transfers: false,
    }),
    getWalletState: jest.fn().mockResolvedValue({ status: "backupRequired", walletId: "wallet" }),
    executeOperation: jest.fn(),
  };
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  expect((await getSignerCapabilities()).transfers).toBe(false);
  expect(await getStoredSigner()!.getWalletState()).toEqual({
    status: "backupRequired",
    walletId: "wallet",
  });
  await expect(
    getStoredTransferSigner()!.executeOperation({
      walletId: "wallet",
      chainId: 10143,
      transfers: [],
    }),
  ).rejects.toThrow(/capabilities/);
  expect(native.executeOperation).not.toHaveBeenCalled();
  expect(requireOptionalNativeModule).toHaveBeenCalledWith("GizuStoredSigner");
});
test("old iOS and missing or invalid native capabilities fail closed", async () => {
  Object.defineProperty(Platform, "Version", { configurable: true, value: "17.6" });
  expect(getStoredSigner()).toBeNull();
  expect(requireOptionalNativeModule).not.toHaveBeenCalled();
  Object.defineProperty(Platform, "Version", { configurable: true, value: "18.0" });
  jest
    .mocked(requireOptionalNativeModule)
    .mockReturnValue({ getCapabilities: jest.fn().mockRejectedValue(new Error("unavailable")) });
  expect((await getSignerCapabilities()).available).toBe(false);
  jest.mocked(requireOptionalNativeModule).mockReturnValue({
    getCapabilities: jest.fn().mockResolvedValue({ contractVersion: 2, available: true }),
  });
  expect((await getSignerCapabilities()).available).toBe(false);
});

test("locking while capabilities load prevents a late native ceremony", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const native = {
    getCapabilities: jest.fn().mockReturnValue(pending),
    createWallet: jest.fn(),
    lock: jest.fn(),
  };
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  const creation = getStoredSigner()!.createWallet();
  getStoredSigner()!.lock();
  resolve({ contractVersion: 1, available: true, walletStorage: true });
  await expect(creation).rejects.toThrow(/cancelled/);
  expect(native.createWallet).not.toHaveBeenCalled();
});

test.each([
  ["ios", "18.5"],
  ["android", 35],
])(
  "%s Release opens the wallet through native authorization and respects capabilities",
  async (os, version) => {
    const development = __DEV__;
    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: false });
    Object.defineProperty(Platform, "OS", { configurable: true, value: os });
    Object.defineProperty(Platform, "Version", { configurable: true, value: version });
    const capabilities = {
      contractVersion: 1,
      available: true,
      walletStorage: true,
      backup: true,
      transfers: false,
    };
    const native = {
      getCapabilities: jest.fn().mockResolvedValue(capabilities),
      openWallet: jest.fn().mockResolvedValue({ status: "ready", walletId: "wallet" }),
      executeOperation: jest.fn(),
    };
    try {
      jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
      expect((await getSignerCapabilities()).available).toBe(true);
      await expect(getStoredSigner()!.openWallet()).resolves.toEqual({
        status: "ready",
        walletId: "wallet",
      });
      expect(native.openWallet).toHaveBeenCalledTimes(1);
      await expect(
        getStoredTransferSigner()!.executeOperation({
          walletId: "wallet",
          chainId: 10143,
          transfers: [],
        }),
      ).rejects.toThrow(/capabilities/);
      expect(native.executeOperation).not.toHaveBeenCalled();
      native.getCapabilities.mockResolvedValue({ ...capabilities, available: false });
      expect((await getSignerCapabilities()).available).toBe(false);
      await expect(getStoredSigner()!.openWallet()).rejects.toThrow(/capabilities/);
      expect(native.openWallet).toHaveBeenCalledTimes(1);
      jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
      expect(getStoredSigner()).toBeNull();
      expect((await getSignerCapabilities()).available).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: development });
    }
  },
);

test("iOS exposes holdings and explicit sell/recovery actions through native capability gates", async () => {
  const target = "0x" + "11".repeat(20);
  const gateway = "https://gizu-backend.onrender.com";
  const native = {
    getCapabilities: jest
      .fn()
      .mockResolvedValue({ contractVersion: 1, available: true, swaps: true }),
    getSwapHoldings: jest.fn().mockResolvedValue({ holdings: [], block: "0x123", checkedAt: 1 }),
    sellSwapHolding: jest.fn().mockResolvedValue({ phase: "PAUSED" }),
    startRecovery: jest.fn().mockResolvedValue({ phase: "PAUSED" }),
    startPayout: jest.fn().mockResolvedValue({ phase: "PAUSED" }),
  };
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  const signer = getStoredSwapSigner()!;
  await expect(signer.getSwapHoldings(target)).resolves.toEqual({
    holdings: [],
    block: "0x123",
    checkedAt: 1,
  });
  expect(native.sellSwapHolding).not.toHaveBeenCalled();
  expect(native.startRecovery).not.toHaveBeenCalled();
  await signer.sellSwapHolding(`${target}:3`, gateway);
  await signer.startRecovery(target, gateway);
  await signer.startPayout(target, gateway);
  expect(native.sellSwapHolding).toHaveBeenCalledWith(`${target}:3`, gateway);
  expect(native.startRecovery).toHaveBeenCalledWith(target, gateway);
  expect(native.startPayout).toHaveBeenCalledWith(target, gateway);
  native.getCapabilities.mockResolvedValue({ contractVersion: 1, available: true, swaps: false });
  await expect(signer.sellSwapHolding(`${target}:3`, gateway)).rejects.toThrow(/capabilities/);
  await expect(signer.startRecovery(target, gateway)).rejects.toThrow(/capabilities/);
  expect(native.sellSwapHolding).toHaveBeenCalledTimes(1);
  expect(native.startRecovery).toHaveBeenCalledTimes(1);
});
