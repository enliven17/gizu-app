import { createContext, useCallback, useContext, useState } from "react";
import {
  tokenIdentity,
  type TokenCatalogService,
  type TokenQuery,
  type TokenCategory,
} from "@/domain/tokenCatalog";
import { tokenCatalogService } from "@/services/tokenCatalog";
import { useInfiniteList } from "@/hooks/useInfiniteList";
export const TokenCatalogContext = createContext<TokenCatalogService>(tokenCatalogService);
export function useTokenCatalog(initialCategory: TokenCategory = "rwa") {
  const service = useContext(TokenCatalogContext);
  const [query, setQuery] = useState<Omit<TokenQuery, "page">>({
    chainId: 4663,
    category: initialCategory,
    search: "",
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
    getIdentity: tokenIdentity,
    debounceMs,
  });
  function change(patch: Partial<typeof query>) {
    list.invalidate();
    setDebounceMs(patch.search !== undefined && patch.search !== query.search ? 300 : 0);
    setQuery({ ...query, ...patch });
  }
  return { query, queryKey, list, change };
}
