import { render, screen, userEvent } from "@testing-library/react-native";
import { StoredWalletDebugScreen } from "@/development/stored-wallet/StoredWalletDebugApp";

test("requires state refresh before creation and remains backup-required after verified open", async () => {
  const wallet = { status: "backupRequired" as const, walletId: "test-wallet-id" };
  const service = {
    getWalletState: jest.fn().mockResolvedValue({ status: "absent" }),
    createWallet: jest.fn().mockResolvedValue(wallet),
    openWallet: jest.fn().mockResolvedValue(wallet),
    lock: jest.fn(),
  };
  render(<StoredWalletDebugScreen service={service} />);
  expect(screen.getByRole("button", { name: "Create test wallet" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Refresh wallet state" }));
  await userEvent.press(screen.getByRole("button", { name: "Create test wallet" }));
  expect(await screen.findByText("State: backupRequired")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create test wallet" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Open existing wallet" }));
  expect(await screen.findByText("Passkey verified. Wallet still requires backup.")).toBeVisible();
  expect(screen.getByText("Wallet ID: test-wallet-id")).toBeVisible();
});
