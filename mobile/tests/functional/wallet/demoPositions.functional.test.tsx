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

test("Home shows named sample holdings and vault positions on demand, with shared withdrawal values", async () => {
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
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
  await userEvent.press(await screen.findByRole("button", { name: "Continue with passkey" }));
  const toggle = await screen.findByRole("button", {
    name: "Tokens and vault positions",
    expanded: false,
  });
  expect(screen.queryByText("1.25 AMZN")).toBeNull();
  fireEvent.press(toggle);
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
  expect(screen.getByText("Value: 150 USDC")).toBeVisible();
  expect(network).not.toHaveBeenCalled();
});
