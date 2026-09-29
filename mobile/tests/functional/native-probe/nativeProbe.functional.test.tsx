import { act, render, screen, userEvent } from "@testing-library/react-native";
import { NativeProbeScreen, type NativeProbe } from "@/development/native-probe/NativeProbeScreen";
import { deferred } from "../../support/deferred";

test("reports unavailable native builds without offering an action", () => {
  render(<NativeProbeScreen service={null} />);
  expect(screen.getByRole("button", { name: "Open native test prompt" })).toBeDisabled();
  expect(screen.getByText(/Native module unavailable/)).toBeVisible();
});

test("opens one native operation and renders public results", async () => {
  const pending = deferred<Awaited<ReturnType<NativeProbe["openNativeProbe"]>>>();
  const service = { openNativeProbe: jest.fn(() => pending.promise), cancelProbe: jest.fn() };
  render(<NativeProbeScreen service={service} />);
  const button = screen.getByRole("button", { name: "Open native test prompt" });
  await userEvent.press(button);
  await userEvent.press(button);
  expect(service.openNativeProbe).toHaveBeenCalledTimes(1);
  expect(service.openNativeProbe).toHaveBeenCalledWith();
  await act(async () =>
    pending.resolve([
      {
        accountIndex: 0,
        address: "0xpublic",
        message: "fixed test",
        signature: "public signature",
      },
    ]),
  );
  expect(screen.getByText("Account 0: 0xpublic")).toBeVisible();
});

test("sanitizes failures and permits an explicit retry", async () => {
  const service = {
    openNativeProbe: jest.fn().mockRejectedValue(new Error("private native diagnostic")),
    cancelProbe: jest.fn(),
  };
  render(<NativeProbeScreen service={service} />);
  await userEvent.press(screen.getByRole("button", { name: "Open native test prompt" }));
  expect(await screen.findByText(/Native probe cancelled or failed/)).toBeVisible();
  expect(screen.queryByText(/private native diagnostic/)).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Open native test prompt" }));
  expect(service.openNativeProbe).toHaveBeenCalledTimes(2);
});

test("cancels the native operation on unmount and ignores its late result", async () => {
  const pending = deferred<Awaited<ReturnType<NativeProbe["openNativeProbe"]>>>();
  const service = { openNativeProbe: jest.fn(() => pending.promise), cancelProbe: jest.fn() };
  const view = render(<NativeProbeScreen service={service} />);
  await userEvent.press(screen.getByRole("button", { name: "Open native test prompt" }));
  view.unmount();
  expect(service.cancelProbe).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve([]));
});
