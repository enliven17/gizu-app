import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
import { useOpportunityDetail } from "@/features/opportunities/useOpportunityDetail";
import { mockOpportunityService, opportunityDetail } from "../support/opportunities";
import { deferred } from "../support/renderApp";
import type { OpportunityDetail } from "@/domain/opportunities";

test("Deposit reuses successful display metadata and explicit Retry gets fresh details", async () => {
  const service = mockOpportunityService();
  const wrapper = ({ children }: PropsWithChildren) => (
    <OpportunityServiceContext.Provider value={service}>
      {children}
    </OpportunityServiceContext.Provider>
  );
  const first = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
  await waitFor(() => expect(first.result.current.load.kind).toBe("ready"));
  first.unmount();
  const deposit = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
  await waitFor(() => expect(deposit.result.current.load.kind).toBe("ready"));
  expect(service.detail).toHaveBeenCalledTimes(1);
  act(() => deposit.result.current.retry());
  await waitFor(() => expect(service.detail).toHaveBeenCalledTimes(2));
});

test("late details from a dismissed screen cannot seed a later Deposit", async () => {
  const service = mockOpportunityService();
  const pending = deferred<OpportunityDetail>();
  service.detail.mockReturnValueOnce(pending.promise);
  const wrapper = ({ children }: PropsWithChildren) => (
    <OpportunityServiceContext.Provider value={service}>
      {children}
    </OpportunityServiceContext.Provider>
  );
  const first = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
  await waitFor(() => expect(service.detail).toHaveBeenCalledTimes(1));
  first.unmount();
  await act(async () => pending.resolve(opportunityDetail(1)));
  const deposit = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
  await waitFor(() => expect(deposit.result.current.load.kind).toBe("ready"));
  expect(service.detail).toHaveBeenCalledTimes(2);
});

test("reopening details does not extend the display cache freshness window", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  try {
    const service = mockOpportunityService();
    const wrapper = ({ children }: PropsWithChildren) => (
      <OpportunityServiceContext.Provider value={service}>
        {children}
      </OpportunityServiceContext.Provider>
    );
    const first = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
    await waitFor(() => expect(first.result.current.load.kind).toBe("ready"));
    first.unmount();
    now.mockReturnValue(1_800_000_040_000);
    const second = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
    await waitFor(() => expect(second.result.current.load.kind).toBe("ready"));
    second.unmount();
    expect(service.detail).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_800_000_060_001);
    const third = renderHook(() => useOpportunityDetail("op-1"), { wrapper });
    await waitFor(() => expect(third.result.current.load.kind).toBe("ready"));
    expect(service.detail).toHaveBeenCalledTimes(2);
  } finally {
    now.mockRestore();
  }
});
