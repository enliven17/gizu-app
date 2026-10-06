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
    const tokens = [
      { ...catalogToken, chainId: query.chainId, address: token, symbol: "COIN", name: "Coinbase" },
      {
        ...catalogToken,
        chainId: query.chainId,
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

test("picker browses all three networks but only selects supported Robinhood targets", async () => {
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  fireEvent.press(screen.getByRole("button", { name: "Choose receive token" }));
  expect(await screen.findByRole("radio", { name: "COIN · Coinbase" })).toBeEnabled();
  for (const [name, chainId] of [
    ["Ethereum", 1],
    ["Monad", 143],
  ] as const) {
    fireEvent.press(screen.getByRole("radio", { name }));
    expect(await screen.findByRole("radio", { name: "COIN · Coinbase" })).toBeDisabled();
    expect(tokenCatalogService.list).toHaveBeenCalledWith(
      expect.objectContaining({ chainId, category: "all", page: 0 }),
      expect.anything(),
    );
  }
  expect(start).not.toHaveBeenCalled();
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

test("USDG can be selected without a 1inch listing and starts a bridge with no recovery purchase", async () => {
  const usdg = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
  jest.mocked(tokenCatalogService.list).mockImplementation(async (query) => ({
    list: [
      {
        ...catalogToken,
        chainId: 4663,
        address: usdg,
        symbol: "USDG",
        name: "Global Dollar",
        decimals: 6,
        swapListed: false,
      },
    ],
    total: 1,
    items: 20,
    page: query.page,
  }));
  start.mockResolvedValue({
    ...status,
    phase: "COMPLETE",
    bridgeOnly: true,
    targetSymbol: "USDG",
    deliveriesComplete: 3,
    ordersComplete: 0,
    receivedTargetAtoms: "1900000",
  });
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText("COIN");
  fireEvent.press(screen.getByRole("button", { name: "Choose receive token" }));
  const choice = await screen.findByRole("radio", { name: "USDG · Global Dollar" });
  expect(choice).toBeEnabled();
  fireEvent.press(choice);
  expect(screen.queryByRole("button", { name: /Finish unfinished buys as USDG/ })).toBeNull();
  expect(screen.getByText(/Returning it requires ETH/)).toBeVisible();
  fireEvent.changeText(screen.getByLabelText("Amount in USDC"), "2");
  fireEvent.press(screen.getByRole("button", { name: "Review bridge" }));
  await waitFor(() => expect(start).toHaveBeenCalledWith(usdg, "2000000", expect.any(String)));
  expect(await screen.findByText("Bridge completed")).toBeVisible();
  expect(screen.getByRole("button", { name: "Return to Monad USDC" })).toBeVisible();
  fireEvent.press(screen.getByRole("button", { name: "Swap details" }));
  expect(screen.getByText("Deliveries 3/3")).toBeVisible();
  expect(screen.queryByText(/orders 0/)).toBeNull();
});

test("a return missing gas identifies Robinhood and the receiving wallets", async () => {
  readStatus.mockResolvedValue({
    ...status,
    phase: "PAUSED",
    bridgeOnly: true,
    direction: "sell",
    pausedCode: "USDG_RETURN_GAS_REQUIRED_1",
    gasFundingAddresses: [status.fundingAddress],
  });
  render(
    <SafeAreaProvider>
      <NativeSwapScreen />
    </SafeAreaProvider>,
  );
  expect(await screen.findByText(/Returning USDG requires ETH for gas on Robinhood/)).toBeVisible();
  expect(screen.getByText(new RegExp(status.fundingAddress))).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel swap" })).toBeVisible();
});
