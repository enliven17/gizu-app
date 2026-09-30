import { act, renderHook } from "@testing-library/react-native";
import { useScreenTracking } from "@/navigation/useScreenTracking";

test("handles missing route and separate instances of the same screen without sending keys", () => {
  const trackScreen = jest.fn().mockResolvedValue(undefined);
  let route: { key: string; name: string } | undefined;
  const { result, rerender } = renderHook(() =>
    useScreenTracking({ getCurrentRoute: () => route }, { trackScreen }),
  );
  act(() => result.current.onReady());
  expect(trackScreen).not.toHaveBeenCalled();
  route = { key: "first-private-key", name: "OpportunityDetail" };
  act(() => result.current.onStateChange());
  rerender({});
  act(() => result.current.onStateChange());
  expect(trackScreen).toHaveBeenCalledTimes(1);
  route = { key: "second-private-key", name: "OpportunityDetail" };
  act(() => result.current.onStateChange());
  expect(trackScreen.mock.calls).toEqual([["OpportunityDetail"], ["OpportunityDetail"]]);
});
