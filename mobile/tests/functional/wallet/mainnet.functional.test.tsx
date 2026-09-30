import { fireEvent, render, screen } from "@testing-library/react-native";
import { AppRoot } from "@/application/AppRoot";
import * as nativeBridge from "@/services/wallet/nativeBridge";
import type { MainnetPortfolioSnapshot } from "@/domain/wallet/storedSigner";
import { validateMainnetPortfolio } from "@/features/wallet/MainnetWalletProvider";

const funding = "0x" + "1".repeat(40);
const returned = "0x" + "2".repeat(40);
const walletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12";
const snapshot: MainnetPortfolioSnapshot = {
  walletId,
  chainId: 143,
  asset: "USDC",
  decimals: 6,
  fundingAddress: funding,
  fundingAtoms: "500000",
  returnAtoms: "2500000",
  totalAtoms: "3000000",
  checkedAt: 1_790_000_000_000,
  block: "0x123",
  accounts: [
    { address: funding, role: "funding", accountIndex: 1, balanceAtoms: "500000" },
    { address: returned, role: "receiving", accountIndex: 9, balanceAtoms: "2500000" },
  ],
  history: [
    {
      operationId: "sell-1",
      phase: "COMPLETE",
      direction: "sell",
      symbol: "GOOGL",
      receivedAtoms: "2500000",
      recordedAt: 1_790_000_000_000,
    },
  ],
};
async function open() {
  const read = jest.fn().mockResolvedValue(snapshot);
  const transfers = jest.spyOn(nativeBridge, "getStoredTransferSigner");
  jest
    .spyOn(nativeBridge, "getStoredSwapSigner")
    .mockReturnValue({ getMainnetPortfolio: read } as unknown as NonNullable<
      ReturnType<typeof nativeBridge.getStoredSwapSigner>
    >);
  render(
    <AppRoot
      accessService={{
        method: "Passkey",
        request: async () => ({
          kind: "mainnet",
          method: "Passkey",
          accountId: funding,
          address: funding,
          accountIndex: 1,
          chainId: 143,
          walletId,
        }),
      }}
    />,
  );
  fireEvent.press(await screen.findByRole("button", { name: "Get started" }));
  fireEvent.press(await screen.findByRole("button", { name: "Continue with passkey" }));
  await screen.findByText("3 USDC");
  return { read, transfers };
}
afterEach(() => jest.restoreAllMocks());

test("mainnet Home includes receiving USDC, Deposit uses funding address, Withdraw never signs", async () => {
  const { transfers } = await open();
  expect(screen.getByText("Swap funding: 0.5 USDC")).toBeVisible();
  expect(screen.getByText("Receiving wallets: 2.5 USDC")).toBeVisible();
  expect(screen.queryByText(/testnet MON/)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Deposit" }));
  expect(
    await screen.findByText("Send USDC on Monad mainnet to your swap funding address."),
  ).toBeVisible();
  expect(screen.getByLabelText(`Account address: ${funding}`)).toBeVisible();
  fireEvent.press(screen.getByRole("button", { name: "Back" }));
  fireEvent.press(await screen.findByRole("button", { name: "Withdraw" }));
  expect(await screen.findByText(/Direct mainnet withdrawals are not available/)).toBeVisible();
  expect(screen.queryByLabelText("Amount in MON")).toBeNull();
  expect(screen.queryByRole("button", { name: /Review withdrawal/ })).toBeNull();
  expect(transfers).not.toHaveBeenCalled();
});

test("Activity displays completed sale proceeds and no testnet transfer journal", async () => {
  await open();
  fireEvent.press(screen.getByRole("button", { name: "View activity" }));
  expect(await screen.findByText("Sell GOOGL")).toBeVisible();
  expect(screen.getByText("Returned 2.5 USDC on Monad")).toBeVisible();
  expect(screen.queryByText(/Monad testnet/)).toBeNull();
});

test("rejects cross-wallet/network snapshots, inconsistent sums and duplicate accounts", () => {
  expect(validateMainnetPortfolio(snapshot, walletId)).toBe(snapshot);
  for (const invalid of [
    { ...snapshot, walletId: "other" },
    { ...snapshot, chainId: 10143 },
    { ...snapshot, totalAtoms: "999" },
    { ...snapshot, fundingAtoms: "0.5" },
    { ...snapshot, accounts: [snapshot.accounts[0], snapshot.accounts[0]] },
  ])
    expect(() => validateMainnetPortfolio(invalid as MainnetPortfolioSnapshot, walletId)).toThrow();
});
