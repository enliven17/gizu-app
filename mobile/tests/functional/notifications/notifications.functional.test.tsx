import { act, fireEvent, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import {
  createMockNotificationService,
  notificationFixture,
  type NotificationItem,
} from "@/services/notifications";
import { deferred, renderApp } from "../../support/renderApp";
import { openSettings, signInToAccount } from "../../support/account";
beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());
async function openInbox() {
  await userEvent.press(screen.getByRole("button", { name: /Notifications, \d+ unread/ }));
  await screen.findByRole("header", { name: "Notifications" });
}
test("opens full notification text, tracks read/unread and mark-all across navigation and refresh", async () => {
  renderApp();
  await signInToAccount();
  await openInbox();
  expect(screen.getByText("2 unread")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Order update, unread" }));
  expect(await screen.findByText("1 unread")).toBeVisible();
  expect(screen.getByText("Review your order history in Activity.")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Mark as unread" }));
  expect(await screen.findByText("2 unread")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Close notification" }));
  // Collapsed cards keep a one-line preview; the expanded actions are gone.
  expect(screen.queryByRole("button", { name: "Close notification" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Mark all as read" }));
  expect(await screen.findByText("0 unread")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Order update, read" }));
  expect(screen.getByText("Review your order history in Activity.")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Refresh notifications" }));
  expect(await screen.findByText("0 unread")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("button", { name: "Notifications, 0 unread" })).toBeVisible();
  await openInbox();
  expect(screen.getByText("0 unread")).toBeVisible();
});
test("failed initial load recovers to an empty inbox", async () => {
  const service = createMockNotificationService([]);
  jest.spyOn(service, "load").mockRejectedValueOnce(new Error("offline"));
  renderApp(undefined, undefined, undefined, undefined, { notifications: service });
  await signInToAccount();
  await openInbox();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not be loaded/);
  expect(screen.queryByText("No notifications yet.")).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Retry notifications" }));
  expect(await screen.findByText("No notifications yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
});
test("failed read-state mutation retains unread status and retries without duplicate requests", async () => {
  const service = createMockNotificationService();
  const pending = deferred<void>();
  const setRead = jest
    .spyOn(service, "setRead")
    .mockRejectedValueOnce(new Error("offline"))
    .mockReturnValueOnce(pending.promise);
  renderApp(undefined, undefined, undefined, undefined, { notifications: service });
  await signInToAccount();
  await openInbox();
  await userEvent.press(screen.getByRole("button", { name: "Order update, unread" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Read status was not saved/);
  expect(screen.getByText("2 unread")).toBeVisible();
  const button = screen.getByRole("button", { name: "Mark as read" });
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(setRead).toHaveBeenCalledTimes(2);
  expect(setRead).toHaveBeenLastCalledWith(["n1"], true);
  expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await act(async () => pending.resolve());
  expect(screen.getByText("1 unread")).toBeVisible();
});
test("mark-all submits only unread IDs once and can retry after failure", async () => {
  const service = createMockNotificationService();
  const setRead = jest.spyOn(service, "setRead").mockRejectedValueOnce(new Error("offline"));
  renderApp(undefined, undefined, undefined, undefined, { notifications: service });
  await signInToAccount();
  await openInbox();
  await userEvent.press(screen.getByRole("button", { name: "Mark all as read" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByText("2 unread")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Mark all as read" }));
  expect(await screen.findByText("0 unread")).toBeVisible();
  expect(setRead).toHaveBeenLastCalledWith(["n1", "n2"], true);
});
test("pending inbox loading disables mutations, and late results after disconnect do not cross sessions", async () => {
  const service = createMockNotificationService();
  const pending = deferred<NotificationItem[]>();
  jest.spyOn(service, "load").mockReturnValueOnce(pending.promise);
  renderApp(undefined, undefined, undefined, undefined, { notifications: service });
  await signInToAccount();
  await openInbox();
  expect(screen.getByText("Loading notifications…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await openSettings();
  await userEvent.press(screen.getByRole("button", { name: "Disconnect" }));
  await screen.findByRole("button", { name: "Continue with passkey" });
  await signInToAccount();
  await act(async () =>
    pending.resolve(notificationFixture.map((item) => ({ ...item, read: true }))),
  );
  await openInbox();
  expect(screen.getByText("2 unread")).toBeVisible();
});
test("default inbox read state resets on disconnect", async () => {
  renderApp();
  await signInToAccount();
  await openInbox();
  await userEvent.press(screen.getByRole("button", { name: "Mark all as read" }));
  await screen.findByText("0 unread");
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await openSettings();
  await userEvent.press(screen.getByRole("button", { name: "Disconnect" }));
  await screen.findByRole("button", { name: "Continue with passkey" });
  await signInToAccount();
  expect(await screen.findByRole("button", { name: "Notifications, 2 unread" })).toBeVisible();
});
