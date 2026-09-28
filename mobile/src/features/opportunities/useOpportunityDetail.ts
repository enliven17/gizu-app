import { useContext, useEffect, useState } from "react";
import type { OpportunityDetail } from "@/domain/opportunities";
import { OpportunityServiceContext } from "./useOpportunities";
import { useTvlSeries } from "./useTvlSeries";

export type DetailLoad =
  { kind: "loading" } | { kind: "failed" } | { kind: "ready"; opportunity: OpportunityDetail };

/** Loads one mainnet vault plus its TVL history; stale results are ignored. */
export function useOpportunityDetail(id: string) {
  const service = useContext(OpportunityServiceContext);
  const [state, setState] = useState<{ key: string; load: DetailLoad }>({
    key: "",
    load: { kind: "loading" },
  });
  const [revision, setRevision] = useState(0);
  const key = `${id}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    const done = (load: DetailLoad) => {
      if (!controller.signal.aborted) setState({ key, load });
    };
    Promise.resolve()
      .then(() => service.detail(id, controller.signal))
      .then(
        (opportunity) => done({ kind: "ready", opportunity }),
        () => done({ kind: "failed" }),
      );
    return () => controller.abort();
  }, [id, key, service]);
  return {
    load: state.key === key ? state.load : ({ kind: "loading" } as const),
    history: useTvlSeries(id, revision),
    retry: () => setRevision((n) => n + 1),
  };
}
