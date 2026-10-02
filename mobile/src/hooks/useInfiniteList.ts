import { useCallback, useEffect, useRef, useState } from "react";

export type PageCursor = string | number;
export type InfinitePage<T, Cursor> = { items: T[]; nextCursor: Cursor | null };
type Operation = "initial" | "more" | "refresh";
type State<T, Cursor> = {
  items: T[];
  nextCursor: Cursor | null;
  pending: Operation | null;
  error: Operation | "stalled" | null;
};
export interface InfiniteListState<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: Operation | "stalled" | null;
  hasMore: boolean;
  loadMore(): void;
  refresh(): void;
  retry(): void;
}

/** Keep loader/identity callbacks stable. Reset query state before scheduling debounced work. */
export function useInfiniteList<T, Cursor extends PageCursor>({
  queryKey,
  initialCursor,
  loadPage,
  getIdentity,
  debounceMs = 0,
  enabled = true,
}: {
  queryKey: string;
  initialCursor: Cursor;
  loadPage: (cursor: Cursor, signal: AbortSignal) => Promise<InfinitePage<T, Cursor>>;
  getIdentity: (item: T) => string;
  debounceMs?: number;
  enabled?: boolean;
}): InfiniteListState<T> & { invalidate(): void } {
  const [state, setState] = useState<State<T, Cursor>>({
    items: [],
    nextCursor: null,
    pending: "initial",
    error: null,
  });
  const current = useRef(state);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seen = useRef(new Set<Cursor>());
  const publish = useCallback((next: State<T, Cursor>) => {
    current.current = next;
    setState(next);
  }, []);
  const cancel = useCallback(() => {
    generation.current += 1;
    clearTimeout(timer.current);
    request.current?.abort();
    request.current = null;
  }, []);
  const invalidate = useCallback(() => {
    cancel();
    seen.current.clear();
    publish({ items: [], nextCursor: null, pending: "initial", error: null });
  }, [cancel, publish]);
  const run = useCallback(
    async (operation: Operation, cursor: Cursor) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      const epoch = generation.current;
      publish({ ...current.current, pending: operation, error: null });
      try {
        const page = await loadPage(cursor, controller.signal);
        if (controller.signal.aborted || generation.current !== epoch) return;
        const previous = operation === "more" ? current.current.items : [];
        const merged = new Map(previous.map((item) => [getIdentity(item), item]));
        const previousSize = merged.size;
        for (const item of page.items) merged.set(getIdentity(item), item);
        if (operation !== "more") seen.current.clear();
        seen.current.add(cursor);
        const stalled =
          (page.nextCursor !== null && seen.current.has(page.nextCursor)) ||
          (merged.size === previousSize && (page.nextCursor !== null || page.items.length > 0));
        publish({
          items: [...merged.values()],
          nextCursor: stalled ? null : page.nextCursor,
          pending: null,
          error: stalled ? "stalled" : null,
        });
      } catch {
        if (!controller.signal.aborted && generation.current === epoch) {
          publish({ ...current.current, pending: null, error: operation });
        }
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
    [getIdentity, loadPage, publish],
  );
  useEffect(() => {
    // Query/service changes reset the state of the external request, including its cursor history.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    invalidate();
    if (!enabled) return cancel;
    if (debounceMs)
      timer.current = setTimeout(() => void run("initial", initialCursor), debounceMs);
    else void run("initial", initialCursor);
    return cancel;
  }, [queryKey, initialCursor, debounceMs, enabled, run, invalidate, cancel]);
  const loadMore = () => {
    if (!enabled) return;
    const value = current.current;
    if (value.pending || value.error || value.nextCursor === null) return;
    void run("more", value.nextCursor);
  };
  const refresh = () => {
    if (!enabled) return;
    if (current.current.pending === "refresh") return;
    cancel();
    void run("refresh", initialCursor);
  };
  const retry = () => {
    if (!enabled) return;
    const value = current.current;
    if (value.pending || !value.error) return;
    if (value.error === "refresh" || value.error === "stalled") refresh();
    else void run(value.error, value.error === "more" ? value.nextCursor! : initialCursor);
  };
  return {
    items: state.items,
    loading: state.pending === "initial",
    loadingMore: state.pending === "more",
    refreshing: state.pending === "refresh",
    error: state.error,
    hasMore: state.nextCursor !== null,
    loadMore,
    refresh,
    retry,
    invalidate,
  };
}
