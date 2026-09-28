import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import {
  getSignerCapabilities,
  getStoredSigner,
  getStoredTransferSigner,
} from "@/services/wallet/nativeBridge";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
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
