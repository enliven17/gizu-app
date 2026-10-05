import { act, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { deferred, renderApp } from "../../support/renderApp";
import type { EarlyAccessService } from "@/services/earlyAccess";

beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());
async function open(service?: EarlyAccessService) {
  renderApp(undefined, undefined, service);
  await userEvent.press(await screen.findByRole("button", { name: "Request access" }));
  await screen.findByRole("header", { name: "Request early access" });
}
async function fill() {
  await userEvent.type(screen.getByLabelText("Email address"), "member@example.com");
  await userEvent.press(screen.getByRole("radio", { name: "Just exploring" }));
  await userEvent.press(screen.getByRole("checkbox", { name: "Aave" }));
}
test("validates required answers and submits the selected payload once", async () => {
  const pending = deferred<void>();
  const submit = jest.fn().mockReturnValue(pending.promise);
  await open({ submit });
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.");
  await userEvent.type(screen.getByLabelText("Email address"), "member@example.com");
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an investment range.");
  await userEvent.press(screen.getByRole("radio", { name: "Just exploring" }));
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose a platform or enter another platform.",
  );
  await userEvent.press(screen.getByRole("checkbox", { name: "Aave" }));
  await userEvent.press(screen.getByRole("checkbox", { name: "Morpho" }));
  await userEvent.press(screen.getByRole("checkbox", { name: "Morpho" }));
  expect(screen.getByRole("checkbox", { name: "Morpho" })).not.toBeChecked();
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(screen.getByRole("button", { name: "Sending request" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Just exploring" })).toBeDisabled();
  await userEvent.press(screen.getByRole("button", { name: "Sending request" }));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith({
    email: "member@example.com",
    amount: "Just exploring",
    platforms: ["Aave"],
    other: "",
  });
  await act(async () => pending.resolve());
  expect(await screen.findByRole("header", { name: "Request complete" })).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("button", { name: "Continue with passkey" })).toBeVisible();
  expect(screen.queryByLabelText("Home tab")).toBeNull();
});
test("retains answers after failure and retries with an other-platform answer", async () => {
  const submit = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  await open({ submit });
  await fill();
  await userEvent.press(screen.getByRole("checkbox", { name: "Aave" }));
  await userEvent.type(screen.getByLabelText("Other platform"), "Other protocol");
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your request could not be completed. Please try again.",
  );
  expect(screen.getByLabelText("Email address")).toHaveDisplayValue("member@example.com");
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(await screen.findByRole("header", { name: "Request complete" })).toBeVisible();
  expect(submit).toHaveBeenLastCalledWith({
    email: "member@example.com",
    amount: "Just exploring",
    platforms: [],
    other: "Other protocol",
  });
});
test.each(["resolve", "reject"] as const)(
  "closing ignores late %s and reopening clears answers",
  async (outcome) => {
    const pending = deferred<void>();
    await open({ submit: () => pending.promise });
    await fill();
    await userEvent.press(screen.getByRole("button", { name: "Request access" }));
    await userEvent.press(screen.getByRole("button", { name: "Close request access" }));
    await screen.findByRole("button", { name: "Continue with passkey" });
    await act(async () =>
      outcome === "resolve" ? pending.resolve() : pending.reject(new Error("late")),
    );
    expect(screen.queryByRole("header", { name: "Request complete" })).toBeNull();
    await userEvent.press(screen.getByRole("button", { name: "Request access" }));
    expect(await screen.findByLabelText("Email address")).toHaveDisplayValue("");
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
test("default development adapter completes the form without granting access", async () => {
  await open();
  await fill();
  await userEvent.press(screen.getByRole("button", { name: "Request access" }));
  expect(await screen.findByRole("header", { name: "Request complete" })).toBeVisible();
  expect(screen.queryByLabelText("Home tab")).toBeNull();
});
