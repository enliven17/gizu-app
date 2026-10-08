import { act, render, screen } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { requireOptionalNativeModule } from "expo";
import { NativeSwapScreen } from "@/features/swap/NativeSwapScreen";
import { getStoredSigner, getStoredSwapSigner } from "@/services/wallet/nativeBridge";
import { deferred } from "../../support/renderApp";

jest.mock("expo", () => ({ requireOptionalNativeModule: jest.fn() }));
const originalOS = Platform.OS;
const originalVersion = Platform.Version;
const fundingAddress = "0x" + "1".repeat(40);
beforeEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  Object.defineProperty(Platform, "Version", { configurable: true, value: "18.5" });
  jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: true, json: async () => ({ list: [] }) } as unknown as Response);
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
  Object.defineProperty(Platform, "Version", { configurable: true, value: originalVersion });
});
function nativeWallet() {
  const pending = deferred<unknown>();
  const entered = deferred<void>();
  let occupied = false;
  const read = (value: unknown) => async () => {
    if (occupied) throw new Error("BUSY");
    return value;
  };
  const native = {
    getCapabilities: jest
      .fn()
      .mockResolvedValue({ contractVersion: 1, available: true, walletStorage: true, swaps: true }),
    getMainnetPortfolio: jest.fn(async () => {
      occupied = true;
      entered.resolve();
      try {
        return await pending.promise;
      } finally {
        occupied = false;
      }
    }),
    getSwapDeposit: jest.fn(read({ fundingAddress })),
    getSwapStatus: jest.fn(read({ operationId: "saved", phase: "PAUSED", fundingAddress })),
    lock: jest.fn(),
  };
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  return { native, pending, entered };
}
test.each([false, true])(
  "Swap waits for balance and loads saved status (RPC failure: %s)",
  async (fail) => {
    const { native, pending, entered } = nativeWallet();
    const balance = getStoredSwapSigner()!
      .getMainnetPortfolio()
      .catch(() => undefined);
    await entered.promise;
    render(
      <NavigationContainer>
        <SafeAreaProvider>
          <NativeSwapScreen />
        </SafeAreaProvider>
      </NavigationContainer>,
    );
    await act(async () => {});
    // Always release the pending read, including if an assertion fails.
    const depositCallsWhileBusy = native.getSwapDeposit.mock.calls.length;
    const statusCallsWhileBusy = native.getSwapStatus.mock.calls.length;
    await act(async () => {
      if (fail) pending.reject(new Error("RPC unavailable"));
      else pending.resolve({});
      await balance;
    });
    expect(depositCallsWhileBusy).toBe(0);
    expect(statusCallsWhileBusy).toBe(0);
    expect(await screen.findByText("Swap paused")).toBeVisible();
    expect(screen.queryByText(fundingAddress)).toBeNull();
    expect(native.getSwapDeposit).toHaveBeenCalledTimes(1);
    expect(native.getSwapStatus).toHaveBeenCalledTimes(1);
  },
);
test("locking invalidates queued reads without poisoning the next session", async () => {
  const { native, pending, entered } = nativeWallet();
  const swap = getStoredSwapSigner()!;
  const balance = swap.getMainnetPortfolio();
  await entered.promise;
  const outcomes = Promise.allSettled([
    balance,
    getStoredSigner()!.getSwapDeposit(),
    swap.getSwapDeposit(),
    swap.getSwapStatus("gateway"),
  ]);
  getStoredSigner()!.lock();
  pending.resolve({});
  for (const outcome of await outcomes) {
    expect(outcome).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: expect.stringMatching(/^Wallet operation cancelled\./),
      }),
    });
  }
  expect(native.getSwapDeposit).not.toHaveBeenCalled();
  expect(native.getSwapStatus).not.toHaveBeenCalled();
  await expect(getStoredSwapSigner()!.getSwapDeposit()).resolves.toEqual({ fundingAddress });
});
