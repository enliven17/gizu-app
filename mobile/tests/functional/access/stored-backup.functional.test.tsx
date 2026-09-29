import { storedWalletBridge, readyWallet, testWalletId } from "../../support/storedWallet";
import { mockOpportunityService } from "../../support/opportunities";
import * as nativeBridge from "@/services/wallet/nativeBridge";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { AppRoot } from "@/application/AppRoot";
import { createStoredWalletAccess } from "@/services/wallet/storedAccess";
import type { StoredWalletState } from "@/domain/wallet/storedSigner";
import { deferred } from "../../support/deferred";

const required: StoredWalletState = { status: "backupRequired", walletId: testWalletId };
const ready = readyWallet();
function setup() {
  const native = storedWalletBridge({ status: "absent" });
  native.openWallet.mockResolvedValue(ready);
  native.createWallet.mockImplementation(async () => {
    native.getWalletState.mockResolvedValue(required);
    return required;
  });
  render(
    <AppRoot
      opportunityService={mockOpportunityService([])}
      accessService={createStoredWalletAccess(() => native)}
      walletBalanceService={{ getBalance: jest.fn().mockResolvedValue("0") }}
    />,
  );
  return native;
}
beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());
async function access() {
  await userEvent.press(await screen.findByRole("button", { name: "Get started" }));
}
async function proceed() {
  await userEvent.press(screen.getByRole("button", { name: "Continue with passkey" }));
}

test("onboarding waits for verified backup then opens existing Home", async () => {
  const native = setup();
  const backup = deferred<StoredWalletState>();
  native.backupWallet.mockReturnValue(backup.promise);
  await access();
  await proceed();
  expect(await screen.findByRole("button", { name: "Cancel access" })).toBeVisible();
  expect(screen.queryByRole("header", { name: "Your portfolio" })).toBeNull();
  await act(async () => backup.resolve(ready));
  expect(await screen.findByRole("header", { name: "Your portfolio" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  await userEvent.press(screen.getByLabelText("Settings tab"));
  expect(
    await screen.findByRole("button", { name: "Save and verify wallet backup" }),
  ).toBeVisible();
});

test("failed backup retries the same wallet without creating new entropy", async () => {
  const native = setup();
  native.backupWallet.mockRejectedValueOnce(new Error("cancelled"));
  await access();
  await proceed();
  expect(await screen.findByRole("alert")).toHaveTextContent(/backup was not completed/);
  expect(screen.queryByRole("header", { name: "Your portfolio" })).toBeNull();
  await proceed();
  expect(await screen.findByRole("header", { name: "Your portfolio" })).toBeVisible();
  expect(native.createWallet).toHaveBeenCalledTimes(1);
  expect(native.backupWallet).toHaveBeenCalledTimes(2);
});

test("restore uses the native ceremony and never creates a replacement wallet", async () => {
  const native = setup();
  await access();
  await userEvent.press(await screen.findByRole("button", { name: "Restore wallet from backup" }));
  expect(await screen.findByRole("header", { name: "Your portfolio" })).toBeVisible();
  expect(native.restoreWallet).toHaveBeenCalledTimes(1);
  expect(native.createWallet).not.toHaveBeenCalled();
});

test("cancel ignores a late backup result and keeps protected screens closed", async () => {
  const native = setup();
  const backup = deferred<StoredWalletState>();
  native.backupWallet.mockReturnValue(backup.promise);
  await access();
  await proceed();
  await userEvent.press(await screen.findByRole("button", { name: "Cancel access" }));
  await act(async () => backup.resolve(ready));
  expect(native.lock).toHaveBeenCalled();
  expect(screen.queryByRole("header", { name: "Your portfolio" })).toBeNull();
  expect(screen.getByRole("button", { name: "Continue with passkey" })).toBeVisible();
});

test("Account can reverify backup and recover from cancellation without disconnecting", async () => {
  const native = setup();
  jest.spyOn(nativeBridge, "getStoredSigner").mockReturnValue(native);
  await access();
  await proceed();
  expect(await screen.findByRole("header", { name: "Your portfolio" })).toBeVisible();
  await userEvent.press(screen.getByLabelText("Settings tab"));
  native.backupWallet.mockRejectedValueOnce(new Error("cancelled"));
  await userEvent.press(
    await screen.findByRole("button", { name: "Save and verify wallet backup" }),
  );
  expect(await screen.findByText(/Your existing wallet remains available/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Save and verify wallet backup" }));
  expect(await screen.findByText(/Backup saved and verified/)).toBeVisible();
  expect(native.createWallet).toHaveBeenCalledTimes(1);
});
