import { act, cleanup, fireEvent, within, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastHost } from "@/components/organisms/toast/ToastHost";
import { dismissToast, showToast } from "@/services/toast";

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});
async function mount() {
  const view = render(
    <SafeAreaProvider>
      <ToastHost />
    </SafeAreaProvider>,
  );
  await act(async () => {});
  return view;
}
function show(message: Parameters<typeof showToast>[0]) {
  act(() => showToast(message));
  // Native-driver opacity is not simulated by Jest; assert mounted content below.
  // Supply native layout so the library can place the banner onscreen in Jest.
  fireEvent(screen.getByTestId("toastAnimatedContainer"), "layout", {
    nativeEvent: { layout: { width: 390, height: 120, x: 0, y: 0 } },
  });
  act(() => jest.advanceTimersByTime(400));
}
test.each(["success", "error", "info", "warning"] as const)(
  "renders and dismisses %s feedback",
  async (variant) => {
    await mount();
    expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
    show({ variant, title: "Feedback title", description: "Readable details" });
    expect(screen.getByText("Feedback title")).toBeOnTheScreen();
    expect(screen.getByText("Readable details")).toBeOnTheScreen();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Feedback title. Readable details",
    );
    fireEvent.press(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Feedback title")).toBeNull();
  },
);
test("replaces previous feedback and expires after the configured duration", async () => {
  await mount();
  show({ title: "First", duration: 1000 });
  show({ title: "Second", duration: 2000 });
  expect(screen.queryByText("First")).toBeNull();
  act(() => jest.advanceTimersByTime(2000));
  expect(screen.queryByText("Second")).toBeNull();
});
test("actions stay available and run once after dismissing the toast", async () => {
  await mount();
  const onPress = jest.fn();
  show({ title: "Could not refresh", action: { label: "Retry", onPress } });
  act(() => jest.advanceTimersByTime(60000));
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Could not refresh")).toBeNull();
});
test("screen-reader feedback does not expire automatically", async () => {
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
  await mount();
  show({ title: "Address copied" });
  act(() => jest.advanceTimersByTime(60000));
  expect(screen.getByText("Address copied")).toBeOnTheScreen();
  act(() => dismissToast());
  expect(screen.queryByText("Address copied")).toBeNull();
});
test("a fresh host does not replay previous messages and ignores blank titles", async () => {
  const view = await mount();
  show({ title: "Previous session", duration: 0 });
  view.unmount();
  await mount();
  act(() => showToast({ title: "  " }));
  expect(screen.queryByText("Previous session")).toBeNull();
  expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
});

test("routes feedback to a modal host and returns to the root host after dismissal", async () => {
  function Hosts({ modal }: { modal: boolean }) {
    return (
      <SafeAreaProvider>
        <View testID="root-host">
          <ToastHost />
        </View>
        {modal ? (
          <View testID="modal-host">
            <ToastHost />
          </View>
        ) : null}
      </SafeAreaProvider>
    );
  }
  const app = render(<Hosts modal />);
  await act(async () => {});
  act(() => showToast({ title: "Inside modal" }));
  expect(within(screen.getByTestId("modal-host")).getByText("Inside modal")).toBeOnTheScreen();
  expect(within(screen.getByTestId("root-host")).queryByText("Inside modal")).toBeNull();
  app.rerender(<Hosts modal={false} />);
  act(() => showToast({ title: "Back on root" }));
  expect(screen.getByText("Back on root")).toBeOnTheScreen();
});
