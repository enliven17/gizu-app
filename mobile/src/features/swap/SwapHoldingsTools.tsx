import { Button } from "@/components/atoms/Button";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Typography } from "@/components/atoms/Typography";
import { HoldingDetails } from "@/components/molecules/HoldingDetails";
import type { useSwapHoldings } from "./useSwapHoldings";

/** Read-only recovery for purchases missing from the local token index. */
export function SwapHoldingsTools({
  holdings,
  onRefresh,
}: {
  holdings: ReturnType<typeof useSwapHoldings>;
  onRefresh: (target?: string) => Promise<void>;
}) {
  const query = holdings.search.trim().toLowerCase();
  const matches = query
    ? holdings.tokens
        .filter((token) => `${token.symbol} ${token.name}`.toLowerCase().includes(query))
        .slice(0, 8)
    : [];
  return (
    <HoldingDetails label="Holdings tools" accessibilityLabel="Holdings tools">
      {holdings.snapshot && (
        <Typography variant="micro">
          Last checked {new Date(holdings.snapshot.checkedAt).toLocaleTimeString()}
        </Typography>
      )}
      <Button
        label="Refresh token holdings"
        variant="secondary"
        disabled={holdings.busy}
        onPress={() => void onRefresh()}
      />
      <Button
        label="Find an earlier purchase"
        variant="quiet"
        disabled={holdings.busy}
        onPress={() => void holdings.findTokens()}
      />
      {holdings.tokens.length > 0 && (
        <>
          <Typography variant="micro">
            Choose the token you bought. This only checks balances; it does not start a swap.
          </Typography>
          <SearchInput
            label="Find purchased token"
            value={holdings.search}
            onChangeText={holdings.setSearch}
          />
          {matches.map((token) => (
            <Button
              key={token.address}
              variant="secondary"
              label={`Check ${token.symbol} holdings`}
              disabled={holdings.busy}
              onPress={() => void onRefresh(token.address)}
            />
          ))}
        </>
      )}
    </HoldingDetails>
  );
}
