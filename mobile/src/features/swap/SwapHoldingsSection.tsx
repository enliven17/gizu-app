import type { ReactNode } from "react";
import { View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { ErrorNotice } from "@/components/molecules/ErrorNotice";
import { Notice } from "@/components/molecules/Notice";
import { HoldingDetails } from "@/components/molecules/HoldingDetails";
import { Surface } from "@/components/molecules/Surface";
import { useSwapHoldings } from "./useSwapHoldings";
import { SwapHoldingsTools } from "./SwapHoldingsTools";
import { swapDemoEnabled } from "./demo/swapDemo";
import { useOptionalMainnetWallet } from "@/features/wallet/MainnetWalletProvider";
import { groupDigits } from "@/domain/wallet/amounts";

export function holdingAmount(atoms: string, decimals: number): string {
  const digits = atoms.padStart(decimals + 1, "0");
  if (!decimals) return groupDigits(digits);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return groupDigits(digits.slice(0, -decimals) + (fraction ? `.${fraction}` : ""));
}

export function SwapHoldingsSection({
  onReviewSale,
  onSaleSettled,
  emptyContent,
}: {
  onReviewSale?: () => void;
  onSaleSettled?: () => void;
  emptyContent?: ReactNode;
}) {
  const holdings = useSwapHoldings(onSaleSettled);
  const mainnet = useOptionalMainnetWallet();
  const ownedAsset = (chainId: number, token: string) =>
    mainnet?.snapshot?.ownedAssets?.find(
      (asset) => asset.chainId === chainId && asset.token.toLowerCase() === token.toLowerCase(),
    );
  const includedInOwnedBalances = (chainId: number, token: string) => {
    const asset = ownedAsset(chainId, token);
    return !!asset?.complete && asset.balanceAtoms !== null && asset.decimals !== null;
  };
  const refreshHoldings = async (target = "") => {
    await holdings.refresh(target);
    if (mainnet) await mainnet.refresh();
  };
  // Only a successful empty read establishes that discovery should replace holdings.
  // Keep errors visible and retain existing cards while refreshing.
  if (
    emptyContent &&
    holdings.snapshot &&
    !holdings.snapshot.holdings.length &&
    !holdings.error &&
    !holdings.saleFailed
  ) {
    return <>{emptyContent}</>;
  }
  return (
    <View className="gap-3">
      {(!emptyContent || !!holdings.snapshot?.holdings.length) && (
        <Typography variant="section">
          {holdings.snapshot?.holdings.length &&
          holdings.snapshot.holdings.every((holding) =>
            includedInOwnedBalances(holding.chainId, holding.token),
          )
            ? "Swap holdings tools"
            : "Token holdings"}
        </Typography>
      )}
      {holdings.busy ? (
        <Typography accessibilityLiveRegion="polite" variant="micro">
          Checking holdings or waiting for native approval…
        </Typography>
      ) : null}
      {holdings.error && (
        <ErrorNotice
          kind="holdings"
          message="Couldn’t refresh your holdings."
          stale={!!holdings.snapshot}
          actionLabel="Retry holdings"
          busy={holdings.busy}
          onAction={() => void holdings.retryRead()}
        />
      )}
      {holdings.catalogError && (
        <ErrorNotice
          kind="tokenSearch"
          message="Couldn’t load the token search."
          actionLabel="Retry token search"
          busy={holdings.busy}
          onAction={() => void holdings.findTokens()}
        />
      )}
      {holdings.saleFailed && (
        <ErrorNotice
          kind="sale"
          message="Couldn’t finish the sale. Check its status in Swap before trying again."
          actionLabel="Review swap"
          onAction={onReviewSale}
          busy={holdings.busy}
        />
      )}
      {holdings.notice ? <Notice message={holdings.notice} /> : null}
      {holdings.snapshot?.holdings.map((holding) => {
        // Owned balances include Earn accounts as well as swapped tokens. Keep that native
        // aggregate intact and expose only the swap subset’s sale tools here.
        const included = includedInOwnedBalances(holding.chainId, holding.token);
        return (
          <Surface key={`${holding.chainId}:${holding.token}`}>
            <View className="gap-3 p-5">
              {!included && (
                <>
                  <Typography variant="rowTitle">{holding.symbol}</Typography>
                  {ownedAsset(holding.chainId, holding.token) && (
                    <Typography variant="micro">Swap receiving wallets</Typography>
                  )}
                  <Typography variant="body">
                    {holdingAmount(holding.balanceAtoms, holding.decimals)} {holding.symbol}
                  </Typography>
                </>
              )}
              <HoldingDetails
                label={included ? `Manage swapped ${holding.symbol}` : undefined}
                accessibilityLabel={`${holding.symbol} ${included ? "swap tools" : "holding details"}`}
              >
                {included && (
                  <Typography variant="micro">
                    Included in your token balances. Sales use only swap receiving wallets.
                  </Typography>
                )}
                <Typography variant="micro">Robinhood mainnet</Typography>
                <Typography variant="micro" selectable>
                  {holding.token}
                </Typography>
                <Typography variant="micro">A verified USDC value is not available.</Typography>
                {holding.batches.length > 1 ? (
                  <Typography variant="micro">
                    Each sale handles up to three receiving wallets. Refresh after selling to see
                    what remains.
                  </Typography>
                ) : null}
                {!holding.batches.length ? (
                  <Typography variant="micro">
                    Balance found, but no complete receiving-wallet group is available to sell.
                  </Typography>
                ) : null}
                <Button
                  label={swapDemoEnabled() ? "Swap" : `Sell ${holding.symbol} back to Monad USDC`}
                  disabled={
                    holdings.busy ||
                    !!holdings.error ||
                    holdings.saleFailed ||
                    !holding.batches.length
                  }
                  onPress={() => {
                    const batch = holding.batches[0];
                    if (batch) void holdings.sell(batch.id);
                  }}
                />
                <Button
                  label={`Check ${holding.symbol} balance`}
                  variant="quiet"
                  disabled={holdings.busy}
                  onPress={() => void refreshHoldings(holding.token)}
                />
              </HoldingDetails>
            </View>
          </Surface>
        );
      })}
      {holdings.snapshot && !holdings.snapshot.holdings.length ? (
        <Typography variant="micro">
          No balances found for tracked tokens. Use Holdings tools to find an earlier purchase.
        </Typography>
      ) : null}
      <SwapHoldingsTools holdings={holdings} onRefresh={refreshHoldings} />
    </View>
  );
}
