import { useCallback, useContext, useState } from "react";
import type { Opportunity, OpportunityQuery } from "@/domain/opportunities";
import { useInfiniteList } from "@/hooks/useInfiniteList";
import { OpportunityServiceContext } from "./useOpportunities";
export const opportunityIdentity = (item: Opportunity) => item.id;
export function useInfiniteOpportunities() {
  const service = useContext(OpportunityServiceContext);
  const [query, setQuery] = useState<Omit<OpportunityQuery, "page">>({
    search: "",
    protocol: "all",
  });
  const [debounceMs, setDebounceMs] = useState(0);
  const queryKey = JSON.stringify(query);
  const loadPage = useCallback(
    async (page: number, signal: AbortSignal) => {
      const data = await service.list({ ...query, page }, signal);
      return {
        items: data.list,
        nextCursor: (data.page + 1) * data.items < data.total ? data.page + 1 : null,
      };
    },
    [query, service],
  );
  const list = useInfiniteList({
    queryKey,
    initialCursor: 0,
    loadPage,
    getIdentity: opportunityIdentity,
    debounceMs,
  });
  function change(next: typeof query) {
    list.invalidate();
    setDebounceMs(next.search !== query.search ? 300 : 0);
    setQuery(next);
  }
  return { query, queryKey, list, change };
}
