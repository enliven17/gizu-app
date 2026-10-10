import { useContext, useEffect, useState } from "react";
import type { OpportunityDetail, OpportunityService } from "@/domain/opportunities";
import { OpportunityServiceContext } from "./useOpportunities";
import { useTvlSeries } from "./useTvlSeries";

export type DetailLoad =
  { kind: "loading" } | { kind: "failed" } | { kind: "ready"; opportunity: OpportunityDetail };

// Public display metadata only. Native review always fetches fresh execution terms.
const caches = new WeakMap<
  OpportunityService,
  Map<string, { expires: number; vault: OpportunityDetail }>
>();
function cached(service: OpportunityService, id: string) {
  const entry = caches.get(service)?.get(id);
  return entry && entry.expires > Date.now() ? entry.vault : undefined;
}

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
    const hit = revision === 0 ? cached(service, id) : undefined;
    const done = (load: DetailLoad) => {
      if (!controller.signal.aborted) setState({ key, load });
    };
    Promise.resolve()
      .then(() => hit ?? service.detail(id, controller.signal))
      .then(
        (opportunity) => {
          if (controller.signal.aborted) return;
          let cache = caches.get(service);
          if (!cache) {
            cache = new Map();
            caches.set(service, cache);
          }
          if (!hit) {
            if (cache.size >= 128) cache.delete(cache.keys().next().value!);
            cache.set(id, { expires: Date.now() + 60_000, vault: opportunity });
          }
          done({ kind: "ready", opportunity });
        },
        () => done({ kind: "failed" }),
      );
    return () => controller.abort();
  }, [id, key, revision, service]);
  return {
    load: state.key === key ? state.load : ({ kind: "loading" } as const),
    history: useTvlSeries(id, revision),
    retry: () => setRevision((n) => n + 1),
  };
}
