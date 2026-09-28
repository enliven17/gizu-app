import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { WalletTransfers } from "@/development/wallet/WalletTransfers";
import type { WalletHistory } from "@/domain/wallet/types";
import { deferred } from "../../support/renderApp";
const address = "0x" + "1".repeat(40);
const recipient = "0x" + "2".repeat(40);
const hash = "0x" + "a".repeat(64);
const result: WalletHistory = {
  blocked: false,
  entries: [
    {
      transactionHash: hash,
      status: "finalized",
      nonce: "1",
      to: recipient,
      valueWei: "1000000000000000",
    },
  ],
};
function setup() {
  const service = {
    history: jest.fn().mockResolvedValue({ entries: [], blocked: false }),
    send: jest.fn().mockResolvedValue(result),
    cancel: jest.fn(),
  };
  const onSettled = jest.fn().mockResolvedValue(undefined);
  const view = render(
    <WalletTransfers address={address} service={service} onSettled={onSettled} />,
  );
  return { service, onSettled, view };
}
async function enter() {
  await screen.findByText("No outgoing transfers recorded for this wallet.");
  fireEvent.changeText(screen.getByLabelText("Transfer recipient"), recipient);
}
test("validates input then renders exact successful transfer details and refreshes balance", async () => {
  const { service, onSettled } = setup();
  await screen.findByText("No outgoing transfers recorded for this wallet.");
  await userEvent.press(screen.getByRole("button", { name: "Review transfer" }));
  expect(service.send).not.toHaveBeenCalled();
  expect(screen.getByText(/Enter a full recipient/)).toBeVisible();
  await enter();
  await userEvent.press(screen.getByRole("button", { name: "Review transfer" }));
  expect(service.send).toHaveBeenCalledWith(address, recipient, "0.001");
  expect(await screen.findByText("Finalized")).toBeVisible();
  expect(screen.getByText("0.001 MON")).toBeVisible();
  expect(screen.getByLabelText("Transaction hash: " + hash)).toBeVisible();
  expect(onSettled).toHaveBeenCalledTimes(1);
});
test("prevents duplicate submission and cancels on disconnect/unmount", async () => {
  const { service, view } = setup();
  const pending = deferred<WalletHistory>();
  service.send.mockImplementation(() => pending.promise);
  await enter();
  await userEvent.press(screen.getByRole("button", { name: "Review transfer" }));
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh history" })).toBeDisabled();
  view.unmount();
  expect(service.cancel).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve(result));
  expect(service.send).toHaveBeenCalledTimes(1);
});
test("a cancellation/error requires reconciliation before retry and never automatically resends", async () => {
  const { service } = setup();
  service.send.mockRejectedValueOnce(new Error("native-private-error"));
  await enter();
  await userEvent.press(screen.getByRole("button", { name: "Review transfer" }));
  expect(await screen.findByText(/Transfer stopped or cancelled/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeDisabled();
  expect(screen.queryByText("native-private-error")).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Refresh history" }));
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeEnabled();
  expect(service.send).toHaveBeenCalledTimes(1);
});
test("unknown outcomes block new transfers until refresh confirms finality", async () => {
  const { service } = setup();
  service.send.mockResolvedValueOnce({
    blocked: true,
    entries: [{ ...result.entries[0], status: "unknown" }],
  });
  await enter();
  await userEvent.press(screen.getByRole("button", { name: "Review transfer" }));
  expect(await screen.findByText("Unknown — refresh status")).toBeVisible();
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeDisabled();
  service.history.mockResolvedValue(result);
  await userEvent.press(screen.getByRole("button", { name: "Refresh history" }));
  expect(await screen.findByText("Finalized")).toBeVisible();
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeEnabled();
  expect(service.send).toHaveBeenCalledTimes(1);
});
test("history failure blocks signing; recovery renders a reverted legacy record honestly", async () => {
  const { service } = setup();
  await enter();
  service.history.mockRejectedValueOnce(new Error("offline"));
  await userEvent.press(screen.getByRole("button", { name: "Refresh history" }));
  expect(await screen.findByText(/Could not refresh history/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeDisabled();
  service.history.mockResolvedValue({
    blocked: false,
    entries: [{ transactionHash: hash, nonce: "0", status: "reverted" }],
  });
  await userEvent.press(screen.getByRole("button", { name: "Refresh history" }));
  expect(await screen.findByText("Failed on-chain")).toBeVisible();
  expect(screen.getByText(/Earlier transfer/)).toBeVisible();
  expect(service.send).not.toHaveBeenCalled();
});

test("late history from a previous wallet cannot replace the current wallet history", async () => {
  const oldHistory = deferred<WalletHistory>();
  const oldService = {
    history: jest.fn(() => oldHistory.promise),
    send: jest.fn(),
    cancel: jest.fn(),
  };
  const currentService = {
    history: jest.fn().mockResolvedValue({ entries: [], blocked: false }),
    send: jest.fn(),
    cancel: jest.fn(),
  };
  const onSettled = jest.fn().mockResolvedValue(undefined);
  const view = render(
    <WalletTransfers address={address} service={oldService} onSettled={onSettled} />,
  );
  view.rerender(
    <WalletTransfers address={recipient} service={currentService} onSettled={onSettled} />,
  );
  expect(await screen.findByText("No outgoing transfers recorded for this wallet.")).toBeVisible();
  await act(async () => oldHistory.resolve(result));
  expect(screen.queryByLabelText("Transaction hash: " + hash)).toBeNull();
  expect(screen.getByRole("button", { name: "Review transfer" })).toBeEnabled();
  expect(oldService.cancel).toHaveBeenCalledTimes(1);
});

test("late transfer completion cannot update a replacement wallet or refresh its balance", async () => {
  const { service, onSettled, view } = setup();
  const pending = deferred<WalletHistory>();
  service.send.mockReturnValueOnce(pending.promise);
  await enter();
  await userEvent.press(screen.getByRole("button", { name: "Review transfer" }));
  const currentService = {
    history: jest.fn().mockResolvedValue({ entries: [], blocked: false }),
    send: jest.fn(),
    cancel: jest.fn(),
  };
  view.rerender(
    <WalletTransfers address={recipient} service={currentService} onSettled={onSettled} />,
  );
  expect(await screen.findByText("No outgoing transfers recorded for this wallet.")).toBeVisible();
  await act(async () => pending.resolve(result));
  expect(screen.queryByLabelText("Transaction hash: " + hash)).toBeNull();
  expect(screen.getByLabelText("Transfer recipient")).toHaveDisplayValue("");
  expect(onSettled).not.toHaveBeenCalled();
});
