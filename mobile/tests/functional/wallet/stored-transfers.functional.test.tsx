import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { AppRoot } from "@/application/AppRoot";
import * as nativeBridge from "@/services/wallet/nativeBridge";
import { createStoredTransfers } from "@/services/wallet/storedTransfers";
import { createStoredWalletAccess } from "@/services/wallet/storedAccess";
import type { StoredOperation } from "@/domain/wallet/storedSigner";
import { deferred } from "../../support/renderApp";
const walletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12";
const id = "7aafcc2e-0891-4e31-a7d4-03780d7b4f13";
const address = "0x" + "1".repeat(40),
  to = "0x" + "2".repeat(40),
  hash = "0x" + "a".repeat(64);
function operation(
  status: StoredOperation["steps"][number]["status"] = "signed",
  revision = 3,
): StoredOperation {
  return {
    operationId: id,
    walletId,
    revision,
    status: status === "finalized" ? "completed" : "needsAuthorization",
    canResume: status === "signed" || status === "planned",
    blocked: status !== "finalized",
    steps: [
      {
        index: 0,
        accountIndex: 0,
        from: address,
        to,
        valueWei: "1000000000000000",
        status,
        nonce: "0",
        ...(status !== "planned" ? { transactionHash: hash } : {}),
      },
    ],
  };
}
function setup(initial: StoredOperation[] = [], useDefaultSigner = false) {
  let records = initial;
  const native = {
    listOperations: jest.fn(async () => records),
    getOperationStatus: jest.fn(async () => records[0]!),
    executeOperation: jest.fn(async () => {
      records = [operation("finalized", 5)];
      return records[0]!;
    }),
    resumeOperation: jest.fn(async () => {
      records = [operation("finalized", 5)];
      return records[0]!;
    }),
    cancelOperation: jest.fn(async () => {
      records = [
        {
          ...operation("planned", 4),
          status: "cancelled" as const,
          blocked: false,
          canResume: false,
        },
      ];
      return records[0]!;
    }),
    lock: jest.fn(),
  };
  const state = {
    status: "ready" as const,
    walletId,
    accounts: [{ accountIndex: 0, address, chainId: 10143 as const }],
  };
  const access = createStoredWalletAccess(() => ({
    getWalletState: async () => state,
    createWallet: jest.fn(),
    backupWallet: jest.fn(),
    openWallet: async () => state,
    restoreWallet: jest.fn(),
    lock: jest.fn(),
  }));
  if (useDefaultSigner) jest.spyOn(nativeBridge, "getStoredTransferSigner").mockReturnValue(native);
  const element = (
    <AppRoot
      accessService={access}
      walletBalanceService={{ getBalance: async () => "1000000000000000000" }}
      walletTransferService={
        useDefaultSigner ? undefined : createStoredTransfers(walletId, () => native)
      }
    />
  );
  return {
    native,
    view: render(element),
    element,
    setRecords: (value: StoredOperation[]) => {
      records = value;
    },
  };
}
beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());
async function open() {
  await userEvent.press(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.press(await screen.findByRole("button", { name: "Continue with passkey" }));
  await screen.findByRole("header", { name: "Your portfolio" });
}
async function activity() {
  await userEvent.press(screen.getByRole("button", { name: "View activity" }));
}

test("existing Withdraw submits a bound proposal and renders finalized history", async () => {
  const { native } = setup();
  await open();
  await userEvent.press(screen.getByRole("button", { name: "Withdraw" }));
  fireEvent.changeText(await screen.findByLabelText("Recipient address"), to);
  await userEvent.press(await screen.findByRole("button", { name: "Review withdrawal" }));
  expect(await screen.findByText("Finalized")).toBeVisible();
  expect(native.executeOperation).toHaveBeenCalledTimes(1);
  expect(native.executeOperation).toHaveBeenCalledWith({
    walletId,
    chainId: 10143,
    transfers: [{ accountIndex: 0, expectedFrom: address, to, valueWei: "1000000000000000" }],
  });
});
test("cold history only reads; explicit resume uses the displayed revision once", async () => {
  const { native, setRecords } = setup([operation()]);
  await open();
  await activity();
  expect(await screen.findByRole("button", { name: "Review and resume" })).toBeVisible();
  expect(native.resumeOperation).not.toHaveBeenCalled();
  expect(native.executeOperation).not.toHaveBeenCalled();
  const pending = deferred<StoredOperation>();
  native.resumeOperation.mockReturnValueOnce(pending.promise);
  await userEvent.press(screen.getByRole("button", { name: "Review and resume" }));
  expect(screen.getByRole("button", { name: "Review and resume" })).toBeDisabled();
  expect(native.resumeOperation).toHaveBeenCalledWith(id, 3);
  setRecords([operation("finalized", 5)]);
  await act(async () => pending.resolve(operation("finalized", 5)));
  expect(await screen.findByText("Finalized")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review and resume" })).toBeNull();
});
test("stale or cancelled resume requires refreshing before another approval", async () => {
  const { native, setRecords } = setup([operation()]);
  await open();
  await activity();
  native.resumeOperation.mockRejectedValueOnce(new Error("stale"));
  await userEvent.press(await screen.findByRole("button", { name: "Review and resume" }));
  expect(await screen.findByText(/Operation paused or changed/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Review and resume" })).toBeDisabled();
  setRecords([operation("signed", 7)]);
  await userEvent.press(screen.getByRole("button", { name: "Refresh activity" }));
  await userEvent.press(screen.getByRole("button", { name: "Review and resume" }));
  expect(native.resumeOperation).toHaveBeenLastCalledWith(id, 7);
});
test("cancelling unsigned steps removes resume without executing a transfer", async () => {
  const { native } = setup([operation("planned")]);
  await open();
  await activity();
  await userEvent.press(await screen.findByRole("button", { name: "Cancel remaining transfers" }));
  expect(await screen.findByText("Operation updated.")).toBeVisible();
  expect(native.cancelOperation).toHaveBeenCalledWith(id);
  expect(screen.queryByRole("button", { name: "Review and resume" })).toBeNull();
  expect(native.executeOperation).not.toHaveBeenCalled();
  expect(native.resumeOperation).not.toHaveBeenCalled();
});
test("unknown nonce conflicts remain visible and cannot be resumed", async () => {
  const op = operation("unknown");
  op.steps[0]!.nonceConflict = true;
  const { native } = setup([op]);
  await open();
  await activity();
  expect(await screen.findByText(/Account nonce changed/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review and resume" })).toBeNull();
  expect(native.resumeOperation).not.toHaveBeenCalled();
});

test("cancellation failure requires refresh and prevents another operation", async () => {
  const { native } = setup([operation("planned")]);
  await open();
  await activity();
  const pending = deferred<StoredOperation>();
  native.cancelOperation.mockReturnValueOnce(pending.promise);
  await userEvent.press(await screen.findByRole("button", { name: "Cancel remaining transfers" }));
  expect(screen.getByRole("button", { name: "Review and resume" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel remaining transfers" })).toBeDisabled();
  await act(async () => pending.reject(new Error("cancel failed")));
  expect(await screen.findByText(/Operation paused or changed/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel remaining transfers" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Refresh activity" }));
  expect(screen.getByRole("button", { name: "Cancel remaining transfers" })).toBeEnabled();
  expect(native.cancelOperation).toHaveBeenCalledTimes(1);
  expect(native.executeOperation).not.toHaveBeenCalled();
});

test("normal wallet composition uses the stored signer without a transfer-service override", async () => {
  const { native } = setup([], true);
  await open();
  await userEvent.press(screen.getByRole("button", { name: "Withdraw" }));
  fireEvent.changeText(await screen.findByLabelText("Recipient address"), to);
  await userEvent.press(screen.getByRole("button", { name: "Review withdrawal" }));
  expect(await screen.findByText("Finalized")).toBeVisible();
  expect(native.executeOperation).toHaveBeenCalledWith(expect.objectContaining({ walletId }));
});
