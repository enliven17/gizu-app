import { act, fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SwapScreen } from "@/features/swap/SwapScreen";
import { createMockSwapService } from "@/services/mockSwap";
import type { SwapService } from "@/domain/swap";

function open(service?: SwapService) {
  render(
    <SafeAreaProvider>
      <SwapScreen service={service} />
    </SafeAreaProvider>,
  );
}
async function review() {
  fireEvent.changeText(screen.getByLabelText("Amount in USDG"), "100");
  await userEvent.press(screen.getByRole("button", { name: "Review swap" }));
  await screen.findByRole("button", { name: "Simulate swap" });
}
test("selects an asset, reviews, simulates completion and retains separate activity and balance", async () => {
  open();
  await userEvent.press(screen.getByRole("radio", { name: "NVDA · NVIDIA" }));
  await review();
  expect(screen.getByText("0.666666 NVDA")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Simulate swap" }));
  expect(await screen.findByText("Simulation pending")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Refresh simulated status" }));
  expect(await screen.findByText("Swap simulated")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "New swap" }));
  expect(screen.getByText("Available: 900 USDG (mock)")).toBeVisible();
  expect(screen.getByText("100 USDG → NVDA")).toBeVisible();
});
test("validates amounts and lets the user leave review without submitting", async () => {
  const service = createMockSwapService();
  const submit = jest.spyOn(service, "submit");
  open(service);
  for (const value of ["0", "-1", "1.0000001", "1001"]) {
    fireEvent.changeText(screen.getByLabelText("Amount in USDG"), value);
    expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
  }
  await review();
  await userEvent.press(screen.getByRole("button", { name: "Back to amount" }));
  expect(screen.getByLabelText("Amount in USDG")).toHaveDisplayValue("100");
  expect(submit).not.toHaveBeenCalled();
});
test("recovers from quote failure and rejects expired quotes", async () => {
  const service = createMockSwapService();
  jest.spyOn(service, "quote").mockRejectedValueOnce(new Error("Quote unavailable. Try again."));
  open(service);
  fireEvent.changeText(screen.getByLabelText("Amount in USDG"), "100");
  await userEvent.press(screen.getByRole("button", { name: "Review swap" }));
  expect(await screen.findByText("Quote unavailable. Try again.")).toBeVisible();
  await review();
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now + 61000);
  await userEvent.press(screen.getByRole("button", { name: "Simulate swap" }));
  expect(await screen.findByText("Quote expired. Go back and request a new quote.")).toBeVisible();
  clock.mockRestore();
});
test("locks duplicate submission and allows status retry without resubmitting", async () => {
  const service = createMockSwapService();
  const original = service.submit;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const submit = jest.spyOn(service, "submit").mockImplementation(async (quote) => {
    await waiting;
    return original(quote);
  });
  jest
    .spyOn(service, "status")
    .mockRejectedValueOnce(new Error("Status unavailable. Refresh again."));
  open(service);
  await review();
  fireEvent.press(screen.getByRole("button", { name: "Simulate swap" }));
  fireEvent.press(screen.getByRole("button", { name: "Simulate swap" }));
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => {
    release();
  });
  await userEvent.press(screen.getByRole("button", { name: "Refresh simulated status" }));
  expect(await screen.findByText("Status unavailable. Refresh again.")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Refresh simulated status" }));
  expect(await screen.findByText("Swap simulated")).toBeVisible();
  expect(submit).toHaveBeenCalledTimes(1);
});
