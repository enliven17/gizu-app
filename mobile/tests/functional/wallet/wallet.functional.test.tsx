import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { WalletDebugApp } from "@/development/WalletDebugApp";
import { createNativeWalletAccess } from "@/development/legacySigner/access";
import { type NativeWalletBridge } from "@/development/legacySigner/nativeBridge";
import { deferred } from "../../support/renderApp";

const address = "0x" + "1".repeat(40);
const publicResult = { address, accountIndex: 0, chainId: 10143 };
beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());
function setup(
  bridge: NativeWalletBridge = {
    openWallet: jest.fn().mockResolvedValue(publicResult),
    lock: jest.fn(),
  },
) {
  const balance = { getBalance: jest.fn().mockResolvedValue("1000000000000001") };
  const clipboard = { copy: jest.fn().mockResolvedValue(undefined) };
  const view = render(
    <WalletDebugApp
      accessService={createNativeWalletAccess(() => bridge)}
      walletDependencies={{
        balance,
        clipboard,
        transfers: {
          history: async () => ({ entries: [], blocked: false }),
          send: jest.fn(),
          cancel: jest.fn(),
        },
      }}
    />,
  );
  return { bridge, balance, clipboard, view };
}
async function open() {
  await userEvent.press(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.press(screen.getByRole("button", { name: "Continue with passkey" }));
}
test("opens a real-address testnet view, copies, refreshes and disconnects without demo balances", async () => {
  const { bridge, balance, clipboard } = setup();
  expect(screen.queryByRole("button", { name: "Request access" })).toBeNull();
  await open();
  expect(await screen.findByText("0.001000000000000001 MON")).toBeVisible();
  expect(screen.getByLabelText("Wallet address: " + address)).toBeVisible();
  expect(screen.queryByRole("header", { name: "Your portfolio" })).toBeNull();
  expect(bridge.openWallet).toHaveBeenCalledTimes(1);
  await userEvent.press(screen.getByRole("button", { name: "Copy wallet address" }));
  expect(clipboard.copy).toHaveBeenCalledWith(address);
  expect(await screen.findByText("Wallet address copied.")).toBeVisible();
  balance.getBalance.mockResolvedValue("0");
  await userEvent.press(screen.getByRole("button", { name: "Refresh balance" }));
  expect(await screen.findByText("0 MON")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Disconnect wallet" }));
  expect(await screen.findByRole("button", { name: "Get started" })).toBeVisible();
  expect(screen.queryByText(address)).toBeNull();
  expect(bridge.lock).toHaveBeenCalled();
});
test("cancel access invalidates late native success and never loads a balance", async () => {
  const pending = deferred<unknown>();
  const bridge = { openWallet: jest.fn(() => pending.promise), lock: jest.fn() };
  const { balance } = setup(bridge);
  await open();
  await userEvent.press(screen.getByRole("button", { name: "Cancel access" }));
  await act(async () => pending.resolve(publicResult));
  expect(screen.queryByText("Your wallet")).toBeNull();
  expect(balance.getBalance).not.toHaveBeenCalled();
  expect(bridge.openWallet).toHaveBeenCalledTimes(1);
  expect(bridge.lock).toHaveBeenCalled();
});
test("native errors are sanitized and existing-passkey retry is available", async () => {
  const bridge = {
    openWallet: jest
      .fn()
      .mockRejectedValueOnce(new Error("private provider diagnostics"))
      .mockResolvedValue(publicResult),
    lock: jest.fn(),
  };
  setup(bridge);
  await open();
  expect(await screen.findByText(/Continue to retry the same wallet/)).toBeVisible();
  expect(screen.queryByText(/private provider diagnostics/)).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Continue with passkey" }));
  expect(await screen.findByText("0.001000000000000001 MON")).toBeVisible();
});
test("balance failure replaces stale data and retry recovers without another unlock", async () => {
  const { balance, bridge, clipboard } = setup();
  balance.getBalance.mockRejectedValueOnce(new Error("RPC"));
  await open();
  expect(await screen.findByText(/Could not load the testnet balance/)).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Refresh balance" }));
  expect(await screen.findByText("0.001000000000000001 MON")).toBeVisible();
  balance.getBalance.mockRejectedValueOnce(new Error("offline"));
  await userEvent.press(screen.getByRole("button", { name: "Refresh balance" }));
  expect(await screen.findByText(/Could not load the testnet balance/)).toBeVisible();
  expect(screen.queryByText("0.001000000000000001 MON")).toBeNull();
  expect(bridge.openWallet).toHaveBeenCalledTimes(1);
  clipboard.copy.mockRejectedValueOnce(new Error("denied"));
  await userEvent.press(screen.getByRole("button", { name: "Copy wallet address" }));
  expect(await screen.findByText(/Could not copy the address/)).toBeVisible();
});
test("disconnect aborts an outstanding balance fetch and ignores late results", async () => {
  const pending = deferred<string>();
  const { balance } = setup();
  balance.getBalance.mockImplementation(() => pending.promise);
  await open();
  expect(await screen.findByText("Loading testnet balance…")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Disconnect wallet" }));
  expect(balance.getBalance.mock.calls[0][1].aborted).toBe(true);
  await act(async () => pending.resolve("1000000000000000000"));
  expect(screen.queryByText("1 MON")).toBeNull();
});
