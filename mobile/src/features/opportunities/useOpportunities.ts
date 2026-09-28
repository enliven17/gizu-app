import { createContext, useContext, useEffect, useState } from "react";
import type { OpportunityPage, OpportunityQuery, OpportunityService } from "@/domain/opportunities";
import { opportunityService } from "@/services/opportunities";
export const OpportunityServiceContext = createContext<OpportunityService>(opportunityService);
type Load = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: OpportunityPage };
export function useOpportunities() {
  const service = useContext(OpportunityServiceContext);
  const [query, setQuery] = useState<OpportunityQuery>({ search: "", protocol: "all", page: 0 });
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void service.list(query, controller.signal).then(
        (data) => {
          if (!controller.signal.aborted) setLoad({ kind: "ready", data });
        },
        () => {
          if (!controller.signal.aborted) setLoad({ kind: "failed" });
        },
      );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, service]);
  function change(next: OpportunityQuery) {
    setLoad({ kind: "loading" });
    setQuery(next);
  }
  return {
    query,
    load,
    change,
    retry() {
      setLoad({ kind: "loading" });
      setRevision((n) => n + 1);
    },
  };
}
