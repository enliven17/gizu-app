import { tokenCatalogService } from "@/services/tokenCatalog";
import { catalogToken } from "../../support/tokenCatalog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { RefreshControl } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NativeSwapScreen } from "@/features/swap/NativeSwapScreen";
import { getStoredSwapSigner } from "@/services/wallet/nativeBridge";

jest.mock("@/services/tokenCatalog", () => ({ tokenCatalogService: { list: jest.fn() } }));
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
  readStatus.mockReset().mockResolvedValue(status);
  jest.mocked(tokenCatalogService.list).mockImplementation(async (query) => {
    const chainId = query.chainId ?? 4663;
    const category = query.category === "other" ? ("other" as const) : ("rwa" as const);
    const tokens = [
      { ...catalogToken, chainId, category, address: token, symbol: "COIN", name: "Coinbase" },
      {
        ...catalogToken,
        chainId,
        category,
        address: secondToken,
        symbol: "GOOGL",
        name: "Alphabet",
      },
    ].filter((item) =>
      `${item.symbol} ${item.name}`.toLowerCase().includes(query.search.toLowerCase()),
    );
    return { list: tokens, total: tokens.length, items: 20, page: query.page };
  });
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
  expect(await screen.findByText("No tokens found.")).toBeVisible();
  fireEvent.changeText(screen.getByLabelText("Search tokens"), "alphabet");
  expect(screen.queryByRole("radio", { name: "COIN · Coinbase" })).toBeNull();
  fireEvent.press(await screen.findByRole("radio", { name: "GOOGL · Alphabet" }));
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

test("picker opens on stocks from every network with a network badge on each token", async () => {
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  fireEvent.press(screen.getByRole("button", { name: "Choose receive token" }));
  expect(await screen.findByRole("radio", { name: "COIN · Coinbase" })).toBeEnabled();
  expect(screen.getByRole("radio", { name: "Stocks", checked: true })).toBeVisible();
  expect(screen.queryByRole("radiogroup", { name: "Token network" })).toBeNull();
  expect(screen.getAllByText("Robinhood")).toHaveLength(2);
  expect(tokenCatalogService.list).toHaveBeenCalledWith(
    expect.objectContaining({ chainId: null, category: "rwa", page: 0 }),
    expect.anything(),
  );
  expect(start).not.toHaveBeenCalled();
});

test("picker DeFi tab lists non-stock tokens that cannot be swap targets", async () => {
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  fireEvent.press(screen.getByRole("button", { name: "Choose receive token" }));
  await screen.findByRole("radio", { name: "COIN · Coinbase" });
  fireEvent.press(screen.getByRole("radio", { name: "DeFi" }));
  expect(await screen.findByRole("radio", { name: "COIN · Coinbase" })).toBeDisabled();
  expect(screen.getAllByText("Not available for swaps").length).toBeGreaterThan(0);
  expect(tokenCatalogService.list).toHaveBeenCalledWith(
    expect.objectContaining({ chainId: null, category: "other", page: 0 }),
    expect.anything(),
  );
});

test("a native HTTP failure shows actionable guidance instead of a bare code", async () => {
  start.mockRejectedValue(new Error("HTTP"));
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  fireEvent.changeText(screen.getByLabelText("Amount in USDC"), "1");
  fireEvent.press(screen.getByRole("button", { name: "Review swap" }));
  expect(
    await screen.findByText(/A balance or swap service could not complete the request/),
  ).toBeVisible();
  expect(screen.queryByText("HTTP")).toBeNull();
});
