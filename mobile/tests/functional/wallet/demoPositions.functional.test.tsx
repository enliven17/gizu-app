import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
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
