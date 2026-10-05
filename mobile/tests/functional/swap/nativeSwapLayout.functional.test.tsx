import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { RefreshControl } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NativeSwapScreen } from "@/features/swap/NativeSwapScreen";
import { getStoredSwapSigner } from "@/services/wallet/nativeBridge";

jest.mock("@/services/wallet/nativeBridge", () => ({ getStoredSwapSigner: jest.fn() }));
const token = "0x" + "a".repeat(40);
const secondToken = "0x" + "b".repeat(40);
const start = jest.fn();
const readStatus = jest.fn();
const status = {
  operationId: "previous",
  phase: "CANCELLED",
  fundingAddress: "0x" + "1".repeat(40),
};
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({
      list: [
        { address: token, symbol: "COIN", name: "Coinbase", decimals: 18, swapListed: true },
        { address: secondToken, symbol: "GOOGL", name: "Alphabet", decimals: 18, swapListed: true },
      ],
    }),
  } as Response);
  start.mockReset().mockResolvedValue({
    ...status,
    phase: "PAUSED",
    targetSymbol: "GOOGL",
    step: "payoutEstimate",
    pausedCode: "QUOTE_REJECTED",
  });
  jest.mocked(getStoredSwapSigner).mockReturnValue({
    getSwapDeposit: jest.fn().mockResolvedValue({ fundingAddress: status.fundingAddress }),
    getSwapStatus: readStatus,
    startSwap: start,
  } as unknown as NonNullable<ReturnType<typeof getStoredSwapSigner>>);
});
afterEach(() => jest.restoreAllMocks());

test("selects a searched token and reviews the exact amount without exposing technical details by default", async () => {
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  expect(screen.queryByText("Funding wallet")).toBeNull();
  expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
  fireEvent.press(screen.getByRole("button", { name: "Choose receive token" }));
  fireEvent.changeText(screen.getByLabelText("Search tokens"), "missing");
  expect(screen.getByText("No tokens found.")).toBeVisible();
  fireEvent.changeText(screen.getByLabelText("Search tokens"), "alphabet");
  expect(screen.queryByRole("radio", { name: "COIN · Coinbase" })).toBeNull();
  fireEvent.press(screen.getByRole("radio", { name: "GOOGL · Alphabet" }));
  expect(screen.queryByLabelText("Search tokens")).toBeNull();
  fireEvent.changeText(screen.getByLabelText("Amount in USDC"), "1.25");
  expect(screen.getByRole("button", { name: "Review swap" })).toBeEnabled();
  expect(start).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Review swap" }));
  await waitFor(() =>
    expect(start).toHaveBeenCalledWith(secondToken, "1250000", expect.any(String)),
  );
  expect(await screen.findByText("Swap paused")).toBeVisible();
  expect(screen.queryByText(/QUOTE_REJECTED/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Swap details", expanded: false }));
  expect(screen.getByText(/QUOTE_REJECTED/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel swap" })).toBeVisible();
});

test("a fresh wallet with no saved swap shows no status warning", async () => {
  readStatus.mockResolvedValue({ phase: "NONE" });
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  await waitFor(() => expect(readStatus).toHaveBeenCalled());
  expect(screen.queryByText(/Saved swap status unavailable/)).toBeNull();
  expect(screen.queryByText("Swap in progress")).toBeNull();
  expect(screen.getByRole("button", { name: "Review swap" })).toBeVisible();
});

test("a failed status read still shows the warning", async () => {
  readStatus.mockRejectedValue(new Error("storage failure"));
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  expect(await screen.findByText(/Saved swap status unavailable/)).toBeVisible();
});

test("pull-to-refresh reloads saved swap status without a refresh button", async () => {
  readStatus.mockResolvedValue({ phase: "NONE" });
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  await waitFor(() => expect(readStatus).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  readStatus.mockResolvedValue({ ...status, phase: "PAUSED", targetSymbol: "COIN" });
  fireEvent(screen.UNSAFE_getByType(RefreshControl), "refresh");
  expect(await screen.findByText("Swap paused")).toBeVisible();
  expect(readStatus).toHaveBeenCalledTimes(2);
});
