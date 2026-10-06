import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { getStoredSigner, getStoredSwapSigner } from "@/services/wallet/nativeBridge";
jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
const originalOS = Platform.OS;
const originalVersion = Platform.Version;
afterEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
  Object.defineProperty(Platform, "Version", { configurable: true, value: originalVersion });
});
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
test.each(["android", "ios"])("%s coordinates calls across separate adapters", async (os) => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
  Object.defineProperty(Platform, "Version", { configurable: true, value: 30 });
  let finish!: (value: unknown) => void;
  const observation = new Promise((resolve) => {
    finish = resolve;
  });
  const native = {
    getCapabilities: jest
      .fn()
      .mockResolvedValue({ contractVersion: 1, available: true, walletStorage: true, swaps: true }),
    getMainnetPortfolio: jest.fn(() => observation),
    getSwapStatus: jest.fn().mockResolvedValue({ phase: "NONE" }),
    startSwap: jest.fn().mockResolvedValue({ phase: "PAUSED" }),
    lock: jest.fn(),
  };
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  const a = getStoredSwapSigner()!;
  const b = getStoredSwapSigner()!;
  const first = a.getMainnetPortfolio();
  const duplicate = b.getMainnetPortfolio();
  await tick();
  expect(native.getMainnetPortfolio).toHaveBeenCalledTimes(1);
  const status = b.getSwapStatus("gateway");
  const start = a.startSwap("target", "4000000", "gateway");
  await tick();
  expect(native.startSwap).not.toHaveBeenCalled();
  finish({ totalAtoms: "4" });
  await Promise.all([first, duplicate, status, start]);
  expect(native.startSwap).toHaveBeenCalledTimes(1);
  expect(native.startSwap.mock.invocationCallOrder[0]).toBeLessThan(
    native.getSwapStatus.mock.invocationCallOrder[0]!,
  );
  getStoredSigner()!.lock();
  expect(native.lock).toHaveBeenCalledTimes(1);
});
