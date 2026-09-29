import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { TokenCatalogService, TokenPage, TokenQuery } from "@/domain/tokenCatalog";
import { tokenCatalogService } from "@/services/tokenCatalog";
export const TokenCatalogContext = createContext<TokenCatalogService>(tokenCatalogService);
type Load = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; data: TokenPage };
export function useTokenCatalog() {
  const service = useContext(TokenCatalogContext);
  const [query, setQuery] = useState<TokenQuery>({
    chainId: 4663,
    category: "rwa",
    search: "",
    page: 0,
  });
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const searchChanged = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    const fetchPage = async () => {
      try {
        const data = await service.list(query, controller.signal);
        if (!controller.signal.aborted) setLoad({ kind: "ready", data });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed" });
      }
    };
    const timer = searchChanged.current ? setTimeout(() => void fetchPage(), 300) : undefined;
    if (timer === undefined) void fetchPage();
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, service]);
  function change(patch: Partial<TokenQuery>) {
    request.current?.abort();
    searchChanged.current = patch.search !== undefined && patch.search !== query.search;
    setLoad({ kind: "loading" });
    setQuery({ ...query, page: 0, ...patch });
  }
  function retry() {
    request.current?.abort();
    searchChanged.current = false;
    setLoad({ kind: "loading" });
    setRevision((n) => n + 1);
  }
  return { query, load, change, retry };
}
