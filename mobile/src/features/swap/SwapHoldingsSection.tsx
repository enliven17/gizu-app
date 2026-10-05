import { View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Typography } from "@/components/atoms/Typography";
import { Notice } from "@/components/molecules/Notice";
import { Surface } from "@/components/molecules/Surface";
import { useSwapHoldings } from "./useSwapHoldings";

export function holdingAmount(atoms: string, decimals: number): string {
  const digits = atoms.padStart(decimals + 1, "0");
  if (!decimals) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}

export function SwapHoldingsSection() {
  const holdings = useSwapHoldings();
  const query = holdings.search.trim().toLowerCase();
  const matches = query
    ? holdings.tokens
        .filter((token) => `${token.symbol} ${token.name}`.toLowerCase().includes(query))
        .slice(0, 8)
    : [];
  return (
    <View className="gap-3">
      <Typography variant="section">Token holdings</Typography>
      <Typography variant="micro">
        Robinhood · mainnet. Balances across your allocated receiving wallets.
      </Typography>
      {holdings.busy ? (
        <Typography accessibilityLiveRegion="polite" variant="micro">
          Checking holdings or waiting for native approval…
        </Typography>
      ) : null}
      {holdings.error ? (
        <Notice
          message={
            holdings.error + (holdings.snapshot ? " Previously loaded balances may be stale." : "")
          }
          error
        />
      ) : null}
      {holdings.notice ? <Notice message={holdings.notice} /> : null}
      {holdings.snapshot?.holdings.map((holding) => (
        <Surface key={holding.token}>
          <View className="gap-3 p-5">
            <Typography variant="rowTitle">{holding.symbol}</Typography>
            <Typography variant="body">
              {holdingAmount(holding.balanceAtoms, holding.decimals)} {holding.symbol}
            </Typography>
            {holding.batches.length > 1 ? (
              <Typography variant="micro">
                Each sale handles up to three receiving wallets. Refresh after selling to see what
                remains.
              </Typography>
            ) : null}
            {!holding.batches.length ? (
              <Typography variant="micro">
                Balance found, but no complete receiving-wallet group is available to sell.
              </Typography>
            ) : null}
            <Button
              label={`Sell ${holding.symbol} back to Monad USDC`}
              disabled={holdings.busy || !!holdings.error || !holding.batches.length}
              onPress={() => {
                const batch = holding.batches[0];
                if (batch) void holdings.sell(batch.id);
              }}
            />
          </View>
        </Surface>
      ))}
      {holdings.snapshot && !holdings.snapshot.holdings.length ? (
        <Typography variant="micro">
          No balances found for tracked tokens. Recover an earlier purchase below.
        </Typography>
      ) : null}
      {holdings.snapshot ? (
        <Typography variant="micro">
          Last checked {new Date(holdings.snapshot.checkedAt).toLocaleTimeString()}
        </Typography>
      ) : null}
      <Button
        label="Refresh token holdings"
        variant="secondary"
        disabled={holdings.busy}
        onPress={() => void holdings.refresh()}
      />
      <Button
        label="Find an earlier purchase"
        variant="quiet"
        disabled={holdings.busy}
        onPress={() => void holdings.findTokens()}
      />
      {holdings.tokens.length > 0 ? (
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
              onPress={() => void holdings.refresh(token.address)}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}
