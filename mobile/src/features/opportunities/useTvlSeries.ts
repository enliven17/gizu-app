import { useContext, useEffect, useState } from "react";
import { tvlSeries, type OpportunityService } from "@/domain/opportunities";
import { OpportunityServiceContext } from "./useOpportunities";

export type TvlLoad =
  { kind: "loading" } | { kind: "failed" } | { kind: "ready"; series: number[] };

type Entry = { promise: Promise<number[]>; series?: number[] };

// Session cache per service instance: each vault's history is fetched once and shared by
// cards and the detail chart. Failures are evicted so a later mount can try again.
const caches = new WeakMap<OpportunityService, Map<string, Entry>>();

function cacheFor(service: OpportunityService) {
  let cache = caches.get(service);
  if (!cache) {
    cache = new Map();
    caches.set(service, cache);
  }
  return cache;
}

function loadSeries(service: OpportunityService, id: string): Entry {
  const cache = cacheFor(service);
  const hit = cache.get(id);
  if (hit) return hit;
  // Shared requests are not tied to one card's lifetime; the adapter still times out.
  const entry: Entry = {
    promise: Promise.resolve()
      .then(() => service.tvlRecords(id, new AbortController().signal))
      .then(tvlSeries)
      .then(
        (series) => {
          entry.series = series;
          return series;
        },
        (error: unknown) => {
          cache.delete(id);
          throw error;
        },
      ),
  };
  cache.set(id, entry);
  return entry;
}

function cachedLoad(service: OpportunityService, id: string): TvlLoad {
  const series = caches.get(service)?.get(id)?.series;
  return series ? { kind: "ready", series } : { kind: "loading" };
}

/**
 * Lazily loads one vault's TVL history (oldest → newest); never blocks the caller.
 * Bump `attempt` to retry after a failure (successful histories stay cached).
 */
export function useTvlSeries(id: string, attempt = 0): TvlLoad {
  const service = useContext(OpportunityServiceContext);
  const [state, setState] = useState(() => ({ id, service, load: cachedLoad(service, id) }));
  useEffect(() => {
    let active = true;
    loadSeries(service, id).promise.then(
      (series) => {
        if (active) setState({ id, service, load: { kind: "ready", series } });
      },
      () => {
        if (active) setState({ id, service, load: { kind: "failed" } });
      },
    );
    return () => {
      active = false;
    };
  }, [id, service, attempt]);
  // A new id renders its cached value (or loading) instead of the previous vault's history.
  return state.id === id && state.service === service ? state.load : cachedLoad(service, id);
}
