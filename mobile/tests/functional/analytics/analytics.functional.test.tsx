import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Button } from "react-native";
import { useScreenTracking } from "@/navigation/useScreenTracking";
import { AppRoot } from "@/application/AppRoot";
import type { AnalyticsService } from "@/services/analytics";

type Routes = { Home: undefined; Exchange: undefined; OpportunityDetail: { id: string } };
const Stack = createNativeStackNavigator<Routes>();
function Placeholder() {
  return null;
}
function Harness({ service, session = "guest" }: { service: AnalyticsService; session?: string }) {
  const navigation = useNavigationContainerRef<Routes>();
  const tracking = useScreenTracking(navigation, service);
  return (
    <>
      <Button title="Open Swap" onPress={() => navigation.navigate("Exchange")} />
      <Button
        title="Open detail"
        onPress={() => navigation.navigate("OpportunityDetail", { id: "private-id" })}
      />
      <Button
        title="Change params"
        onPress={() => navigation.setParams({ id: "another-private-id" })}
      />
      <Button title="Back" onPress={() => navigation.goBack()} />
      <NavigationContainer key={session} ref={navigation} {...tracking}>
        <Stack.Navigator screenOptions={{ animation: "none" }}>
          <Stack.Screen name="Home" component={Placeholder} />
          <Stack.Screen name="Exchange" component={Placeholder} />
          <Stack.Screen name="OpportunityDetail" component={Placeholder} />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
test("tracks focused transitions, ignores parameter changes and resets for replacement sessions", async () => {
  const trackScreen = jest.fn().mockResolvedValue(undefined);
  const service = { trackScreen };
  const view = render(<Harness service={service} />);
  await waitFor(() => expect(trackScreen.mock.calls).toEqual([["Home"]]));
  fireEvent.press(screen.getByText("Open Swap"));
  await waitFor(() => expect(trackScreen).toHaveBeenLastCalledWith("Exchange"));
  fireEvent.press(screen.getByText("Open detail"));
  await waitFor(() => expect(trackScreen).toHaveBeenLastCalledWith("OpportunityDetail"));
  fireEvent.press(screen.getByText("Change params"));
  await act(async () => {});
  expect(trackScreen).toHaveBeenCalledTimes(3);
  fireEvent.press(screen.getByText("Back"));
  await waitFor(() => expect(trackScreen).toHaveBeenLastCalledWith("Exchange"));
  fireEvent.press(screen.getByText("Open detail"));
  await waitFor(() => expect(trackScreen).toHaveBeenCalledTimes(5));
  view.rerender(<Harness service={service} session="signed-in" />);
  await waitFor(() =>
    expect(trackScreen.mock.calls).toEqual([
      ["Home"],
      ["Exchange"],
      ["OpportunityDetail"],
      ["Exchange"],
      ["OpportunityDetail"],
      ["Home"],
    ]),
  );
});
test.each(["sync", "async"])(
  "navigation continues when injected analytics fails %s",
  async (mode) => {
    const trackScreen =
      mode === "sync"
        ? jest.fn(() => {
            throw new Error("SDK failure");
          })
        : jest.fn().mockRejectedValue(new Error("SDK failure"));
    render(<Harness service={{ trackScreen }} />);
    fireEvent.press(screen.getByText("Open Swap"));
    await waitFor(() => expect(trackScreen).toHaveBeenLastCalledWith("Exchange"));
  },
);
test("real app composition uses injected analytics on initial screen and navigation", async () => {
  const trackScreen = jest.fn().mockResolvedValue(undefined);
  render(<AppRoot analyticsService={{ trackScreen }} />);
  await waitFor(() => expect(trackScreen).toHaveBeenCalledWith("Welcome"));
  fireEvent.press(screen.getByRole("button", { name: /get started/i }));
  await waitFor(() => expect(trackScreen).toHaveBeenCalledWith("Access"));
});
