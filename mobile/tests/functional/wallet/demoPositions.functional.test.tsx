import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { AppRoot } from "@/application/AppRoot";
import { createStoredWalletAccess } from "@/services/wallet/storedAccess";
import { defaultPreferences } from "@/domain/preferences";
import { swapDemo } from "@/features/swap/demo/swapDemo";
import { demoVaults } from "@/services/demo/vaults";

const address = "0x" + "1".repeat(40);
const walletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12";
const originalFlag = process.env.EXPO_PUBLIC_SWAP_DEMO;
beforeEach(() => {
  process.env.EXPO_PUBLIC_SWAP_DEMO = "1";
  swapDemo.reset(undefined, { sampleHoldings: true });
  demoVaults.reset();
  jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null);
});
afterEach(() => {
  swapDemo.reset();
  demoVaults.reset();
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_SWAP_DEMO;
  else process.env.EXPO_PUBLIC_SWAP_DEMO = originalFlag;
  jest.mocked(useReducedMotion).mockReturnValue(false);
  jest.restoreAllMocks();
});

async function openHome() {
  const ready = {
    status: "ready",
    walletId,
    accounts: [{ accountIndex: 0, address, chainId: 10143 }],
  };
  const native = {
    getSwapDeposit: jest.fn().mockResolvedValue({ fundingAddress: address }),
    getWalletState: jest.fn().mockResolvedValue(ready),
    openWallet: jest.fn().mockResolvedValue(ready),
    createWallet: jest.fn(),
    backupWallet: jest.fn(),
    restoreWallet: jest.fn(),
    lock: jest.fn(),
  };
  render(
    <AppRoot
      accessService={createStoredWalletAccess(() => native)}
      earnWalletService={{
        load: jest.fn().mockResolvedValue({ status: "absent" }),
        prepare: jest.fn(),
        cancel: jest.fn(),
      }}
      accountDependencies={{
        clipboard: { copy: jest.fn() },
        store: {
          load: jest.fn().mockResolvedValue(defaultPreferences),
          save: jest.fn(),
          clear: jest.fn(),
        },
      }}
    />,
  );
  fireEvent.press(await screen.findByRole("button", { name: "Continue with passkey" }));
}

test("Home automatically shows sample tokens and vault positions, with shared withdrawal values", async () => {
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  await openHome();
  expect(await screen.findByText("Tokens and vault positions")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Tokens and vault positions" })).toBeNull();
  expect(screen.queryByText("Swap holdings tools")).toBeNull();
  expect(screen.queryByText(/^Manage swapped/)).toBeNull();
  for (const amount of ["1.25 AMZN", "0.8 AAPL", "3 NVDA"])
    expect(await screen.findByText(amount)).toBeVisible();
  for (const name of [
    "Aave V3 USDC",
    "Pendle Ecosystem USDC",
    "Steakhouse USDG",
    "High Yield AUSD",
  ])
    expect(screen.getByText(name)).toBeVisible();
  expect(screen.queryByText(/balance unavailable/)).toBeNull();
  for (const symbol of ["AMZN", "AAPL", "NVDA"])
    expect(await screen.findByRole("button", { name: `Sell ${symbol}` })).toBeEnabled();
  expect(screen.queryByText("Holding details")).toBeNull();
  expect(screen.getAllByText("1.25 AMZN")).toHaveLength(1);
  const quote = demoVaults.review(
    { walletId, address },
    "demo-morpho-steakhouse-usdg",
    "100000000",
  );
  await act(async () => {
    const receipt = demoVaults.confirm({ walletId, address }, quote.id);
    swapDemo.creditVaultWithdrawal(receipt.id, BigInt(receipt.receiveAtoms));
  });
  expect(await screen.findByText("150 USDG")).toBeVisible();
  expect(screen.getByText("150 USDC")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Steakhouse USDG vault position" }));
  expect(
    screen.getByRole("button", { name: "Steakhouse USDG vault position", expanded: true }),
  ).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Withdraw Steakhouse USDG" }));
  expect(await screen.findByText("Available: 150 USDC")).toBeVisible();
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeDisabled();
  expect(network).not.toHaveBeenCalled();
});

test("selling from a Home token card reviews first and updates shared balances once", async () => {
  jest.useFakeTimers();
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  try {
    await openHome();
    await screen.findByText("Tokens and vault positions");
    fireEvent.press(await screen.findByRole("button", { name: "AMZN token holding" }));
    expect(
      screen.getByRole("button", { name: "AMZN token holding", expanded: true }),
    ).toBeVisible();
    const sell = await screen.findByRole("button", { name: "Sell AMZN" });
    fireEvent.press(sell);
    fireEvent.press(sell);
    expect(await screen.findByText("CONFIDENTIAL SELL · MAINNET")).toBeVisible();
    expect(swapDemo.usdcAtoms()).toBe(250000000n);
    fireEvent.press(screen.getByRole("button", { name: "Approve for 15 minutes" }));
    for (let i = 0; i < 80 && !screen.queryByRole("button", { name: "Done" }); i++)
      await act(() => jest.advanceTimersByTimeAsync(1_000));
    fireEvent.press(await screen.findByRole("button", { name: "Done" }));
    await act(async () => {});
    expect(screen.queryByText("1.25 AMZN")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sell AMZN" })).toBeNull();
    expect(screen.getByText("0.8 AAPL")).toBeVisible();
    expect(screen.getByText("3 NVDA")).toBeVisible();
    expect(BigInt(swapDemo.usdcAtoms())).toBeGreaterThan(250000000n);
    expect(network).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("holding cards show one chart at a time across tokens and vaults without Performance buttons", async () => {
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  await openHome();
  await screen.findByText("Tokens and vault positions");
  for (const name of [
    "AMZN",
    "AAPL",
    "NVDA",
    "Aave V3 USDC",
    "Pendle Ecosystem USDC",
    "Steakhouse USDG",
    "High Yield AUSD",
  ])
    expect(screen.queryByRole("button", { name: `${name} performance` })).toBeNull();
  expect(screen.queryByLabelText(/performance chart:/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "AMZN token holding" }));
  expect(screen.getByLabelText(/^AMZN performance chart:/)).toBeVisible();
  expect(screen.getByRole("button", { name: "AMZN token holding", expanded: true })).toBeVisible();
  expect(screen.getByRole("button", { name: "AAPL token holding", expanded: false })).toBeVisible();
  fireEvent.press(screen.getByRole("button", { name: "Steakhouse USDG vault position" }));
  expect(screen.getByRole("button", { name: "AMZN token holding", expanded: false })).toBeVisible();
  expect(screen.queryByLabelText(/^AMZN performance chart:/)).toBeNull();
  expect(screen.getByLabelText(/^Steakhouse USDG performance chart:/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Sell AMZN" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Withdraw Steakhouse USDG" })).toBeEnabled();
  fireEvent.press(screen.getByRole("button", { name: "AMZN token holding" }));
  expect(screen.getByLabelText(/^AMZN performance chart:/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Steakhouse USDG vault position", expanded: false }),
  ).toBeVisible();
  expect(screen.queryByLabelText(/^Steakhouse USDG performance chart:/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "AMZN token holding" }));
  expect(screen.queryByLabelText(/performance chart:/)).toBeNull();
  expect(network).not.toHaveBeenCalled();
});

test.each([false, true])(
  "right-column holdings expand before their left neighbor and restore order (reduced motion: %s)",
  async (reduced) => {
    jest.mocked(useReducedMotion).mockReturnValue(reduced);
    await openHome();
    await screen.findByText("Tokens and vault positions");
    const expectOrder = (kind: "token holding" | "vault position", names: readonly string[]) => {
      expect(screen.getAllByRole("button", { name: new RegExp(`${kind}$`) })).toEqual(
        names.map((name) => screen.getByRole("button", { name: `${name} ${kind}` })),
      );
    };
    expectOrder("token holding", ["AMZN", "AAPL", "NVDA"]);
    await userEvent.press(screen.getByRole("button", { name: "AAPL token holding" }));
    expectOrder("token holding", ["AAPL", "AMZN", "NVDA"]);
    expect(
      screen.getByRole("button", { name: "AAPL token holding", expanded: true }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "AMZN token holding", expanded: false }),
    ).toBeVisible();
    expect(screen.getByLabelText(/^AAPL performance chart:/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sell AAPL" })).toBeEnabled();

    // Switching cards collapses the previous card and restores its normal position.
    await userEvent.press(screen.getByRole("button", { name: "NVDA token holding" }));
    expectOrder("token holding", ["AMZN", "AAPL", "NVDA"]);
    expect(
      screen.getByRole("button", { name: "AAPL token holding", expanded: false }),
    ).toBeVisible();
    expect(screen.queryByLabelText(/^AAPL performance chart:/)).toBeNull();
    expect(screen.getByLabelText(/^NVDA performance chart:/)).toBeVisible();
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
    await userEvent.press(screen.getByRole("button", { name: "NVDA token holding" }));
    expectOrder("token holding", ["AMZN", "AAPL", "NVDA"]);
    expect(screen.queryByLabelText(/^NVDA performance chart:/)).toBeNull();

    const vaultNames = [
      "Aave V3 USDC",
      "Pendle Ecosystem USDC",
      "Steakhouse USDG",
      "High Yield AUSD",
    ] as const;
    expectOrder("vault position", vaultNames);
    await userEvent.press(screen.getByRole("button", { name: "AAPL token holding" }));
    await userEvent.press(
      screen.getByRole("button", { name: "Pendle Ecosystem USDC vault position" }),
    );
    expectOrder("token holding", ["AMZN", "AAPL", "NVDA"]);
    expect(screen.queryByLabelText(/^AAPL performance chart:/)).toBeNull();
    expectOrder("vault position", [vaultNames[1], vaultNames[0], ...vaultNames.slice(2)]);
    expect(screen.getByLabelText(/^Pendle Ecosystem USDC performance chart:/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Withdraw Pendle Ecosystem USDC" })).toBeEnabled();
    await userEvent.press(screen.getByRole("button", { name: "High Yield AUSD vault position" }));
    expectOrder("vault position", [vaultNames[0], vaultNames[1], vaultNames[3], vaultNames[2]]);
    expect(screen.queryByLabelText(/^Pendle Ecosystem USDC performance chart:/)).toBeNull();
    expect(screen.getByLabelText(/^High Yield AUSD performance chart:/)).toBeVisible();
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
    await userEvent.press(screen.getByRole("button", { name: "High Yield AUSD vault position" }));
    expectOrder("vault position", vaultNames);
    expect(screen.queryByLabelText(/performance chart:/)).toBeNull();
  },
);

test.each([false, true])(
  "holdings expand and collapse with independent action buttons (reduced motion: %s)",
  async (reduced) => {
    jest.mocked(useReducedMotion).mockReturnValue(reduced);
    const network = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network"));
    await openHome();
    const token = await screen.findByRole("button", {
      name: "AMZN token holding",
      expanded: false,
    });
    expect(screen.queryByLabelText("Value per token: 230 USDC")).toBeNull();
    await userEvent.press(token);
    expect(
      screen.getByRole("button", { name: "AMZN token holding", expanded: true }),
    ).toBeVisible();
    expect(screen.getByLabelText("Value per token: 230 USDC")).toBeVisible();
    expect(screen.getByLabelText(/^AMZN performance chart:/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "AAPL token holding", expanded: false }),
    ).toBeVisible();
    await userEvent.press(screen.getByRole("button", { name: "AMZN token holding" }));
    expect(
      screen.getByRole("button", { name: "AMZN token holding", expanded: false }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Value per token: 230 USDC")).toBeNull();
    expect(screen.queryByLabelText(/^AMZN performance chart:/)).toBeNull();
    await userEvent.press(screen.getByRole("button", { name: "Steakhouse USDG vault position" }));
    expect(
      screen.getByRole("button", { name: "Steakhouse USDG vault position", expanded: true }),
    ).toBeVisible();
    expect(screen.getByLabelText("Net APY: 5.17%")).toBeVisible();
    expect(screen.getByLabelText("Protocol: Morpho")).toBeVisible();
    expect(screen.getByLabelText(/^Steakhouse USDG performance chart:/)).toBeVisible();
    await userEvent.press(screen.getByRole("button", { name: "Steakhouse USDG vault position" }));
    expect(
      screen.getByRole("button", { name: "Steakhouse USDG vault position", expanded: false }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Net APY: 5.17%")).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw Steakhouse USDG" })).toBeEnabled();
    expect(network).not.toHaveBeenCalled();
  },
);
