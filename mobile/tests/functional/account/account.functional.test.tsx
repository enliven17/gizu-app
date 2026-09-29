import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Linking } from "react-native";
import { profileFixture } from "@/services/fixtures/profile";
import { defaultPreferences } from "@/domain/preferences";
import { deferred } from "../../support/deferred";
import { renderApp } from "../../support/renderApp";
import { memoryPreferences, openSettings, signInToAccount } from "../../support/account";
beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());
async function open(name: string) {
  await userEvent.press(screen.getByRole("button", { name }));
  await screen.findByRole("header", { name });
}
test("copies the complete address with feedback and retries clipboard failure", async () => {
  jest
    .mocked(Clipboard.setStringAsync)
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValue(true);
  renderApp();
  await signInToAccount();
  await openSettings();
  await userEvent.press(screen.getByRole("button", { name: "Copy account address" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy address. Try again.");
  await userEvent.press(screen.getByRole("button", { name: "Copy account address" }));
  expect(await screen.findByText("Address copied.")).toBeVisible();
  expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(profileFixture.address);
  expect(profileFixture.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
});
test("clipboard false result fails and a pending copy cannot duplicate or update a dismissed page", async () => {
  jest.mocked(Clipboard.setStringAsync).mockResolvedValueOnce(false);
  const pending = deferred<void>();
  const copy = jest.fn().mockReturnValue(pending.promise);
  const app = renderApp();
  await signInToAccount();
  await openSettings();
  await userEvent.press(screen.getByRole("button", { name: "Copy account address" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  app.unmount();
  renderApp({ accountDependencies: { clipboard: { copy } } });
  await signInToAccount();
  await openSettings();
  await open("Passkey wallet");
  const button = screen.getByRole("button", { name: "Copy account address" });
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(copy).toHaveBeenCalledTimes(1);
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await act(async () => pending.resolve());
  expect(screen.queryByText("Address copied.")).toBeNull();
});
test("alerts and statement frequency persist across app remount and clear on disconnect", async () => {
  const { store, storage } = memoryPreferences();
  const dependencies = { store };
  const app = renderApp({ accountDependencies: dependencies });
  await signInToAccount();
  await openSettings();
  await open("Push alerts");
  expect(screen.getByRole("switch", { name: "Receive push alerts" })).not.toBeChecked();
  fireEvent(screen.getByRole("switch"), "valueChange", true);
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  expect(screen.getByText(/does not request system permission/)).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await open("Statements");
  await userEvent.press(screen.getByRole("radio", { name: "Quarterly" }));
  expect(await screen.findByRole("radio", { name: "Quarterly", checked: true })).toBeVisible();
  app.unmount();
  renderApp({ accountDependencies: dependencies });
  await signInToAccount();
  await openSettings();
  await open("Statements");
  expect(await screen.findByRole("radio", { name: "Quarterly", checked: true })).toBeVisible();
  await userEvent.press(screen.getByRole("radio", { name: "On request" }));
  expect(await screen.findByRole("radio", { name: "On request", checked: true })).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await open("Push alerts");
  expect(screen.getByRole("switch")).toBeChecked();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await userEvent.press(screen.getByRole("button", { name: "Disconnect" }));
  expect(await screen.findByRole("button", { name: "Get started" })).toBeVisible();
  expect(storage.removeItem).toHaveBeenCalledWith(`gizu:preferences:v1:${profileFixture.id}`);
  await signInToAccount();
  await openSettings();
  await open("Push alerts");
  expect(screen.getByRole("switch")).not.toBeChecked();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  await open("Statements");
  expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
});
test("failed preference hydration blocks edits until retry; failed save preserves the last committed value", async () => {
  const { store, storage } = memoryPreferences();
  storage.getItem.mockRejectedValueOnce(new Error("read failed"));
  renderApp({ accountDependencies: { store } });
  await signInToAccount();
  await openSettings();
  await open("Statements");
  expect(screen.getByRole("radio", { name: "Quarterly" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Retry preferences" }));
  expect(await screen.findByRole("radio", { name: "Monthly", checked: true })).toBeEnabled();
  storage.setItem.mockRejectedValueOnce(new Error("disk full"));
  await userEvent.press(screen.getByRole("radio", { name: "Quarterly" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/Preference was not saved/);
  expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
  await userEvent.press(screen.getByRole("radio", { name: "Quarterly" }));
  expect(await screen.findByRole("radio", { name: "Quarterly", checked: true })).toBeVisible();
});
test("pending writes disable changes and disconnect until persistence completes", async () => {
  const { store, storage } = memoryPreferences();
  const pending = deferred<void>();
  storage.setItem.mockReturnValueOnce(pending.promise);
  renderApp({ accountDependencies: { store } });
  await signInToAccount();
  await openSettings();
  await open("Statements");
  const quarterly = screen.getByRole("radio", { name: "Quarterly" });
  act(() => {
    fireEvent.press(quarterly);
    fireEvent.press(quarterly);
  });
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("radio", { name: "Monthly" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
  await act(async () => pending.resolve());
  expect(screen.getByRole("button", { name: "Disconnect" })).toBeEnabled();
});
test("logout cleanup failure stays signed in with retry and duplicate cleanup is blocked", async () => {
  const { store, storage } = memoryPreferences();
  const pending = deferred<void>();
  storage.removeItem
    .mockRejectedValueOnce(new Error("failed"))
    .mockReturnValueOnce(pending.promise);
  renderApp({ accountDependencies: { store } });
  await signInToAccount();
  await openSettings();
  await userEvent.press(screen.getByRole("button", { name: "Disconnect" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/You are still signed in/);
  const button = screen.getByRole("button", { name: "Disconnect" });
  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  expect(storage.removeItem).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve());
  expect(await screen.findByRole("button", { name: "Get started" })).toBeVisible();
});
test("disconnect during hydration discards its late result for the next session", async () => {
  const { store } = memoryPreferences();
  const pending = deferred<typeof defaultPreferences>();
  jest.spyOn(store, "load").mockReturnValueOnce(pending.promise);
  renderApp({ accountDependencies: { store } });
  await signInToAccount();
  await openSettings();
  expect(screen.getByText("Loading preferences…")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Disconnect" }));
  await screen.findByRole("button", { name: "Get started" });
  await signInToAccount();
  await openSettings();
  await open("Statements");
  await act(async () => pending.resolve({ ...defaultPreferences, statements: "Quarterly" }));
  expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
});
test("currency, security, statements, support and disclosure actions have explicit availability", async () => {
  renderApp();
  await signInToAccount();
  await openSettings();
  await open("Currency");
  expect(screen.getByRole("radio", { name: "USD" })).toBeChecked();
  for (const name of ["EUR", "GBP", "TRY"])
    expect(screen.getByRole("radio", { name })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  for (const [title, actions] of [
    ["Passkey wallet", ["Add backup passkey"]],
    ["Transaction signing", ["Change signing policy"]],
    ["Statements", ["Request statement"]],
    ["Contact desk", ["Start secure message", "Book callback"]],
    [
      "Terms and disclosures",
      ["Member agreement", "Risk disclosure", "Privacy policy", "Fee schedule"],
    ],
  ] as const) {
    await open(title);
    for (const name of actions) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
      await userEvent.press(screen.getByRole("button", { name }));
      expect(screen.getByRole("header", { name: title })).toBeVisible();
    }
    await userEvent.press(screen.getByRole("button", { name: "Back" }));
  }
});
