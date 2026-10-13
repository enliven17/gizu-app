import type { ReactNode } from "react";
import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { ErrorNotice } from "@/components/molecules/ErrorNotice";
import { Notice } from "@/components/molecules/Notice";
import { demoModeEnabled } from "@/config/demo";
import type { OwnedPortfolioAsset } from "@/domain/wallet/storedSigner";
import { useSwapHoldings } from "@/features/swap/useSwapHoldings";
import { SwapHoldingsTools } from "@/features/swap/SwapHoldingsTools";
import { demoVaultMetadata } from "@/services/demo/opportunities";
import { useMainnetWallet } from "./MainnetWalletProvider";
import { PortfolioHoldingCard } from "./PortfolioHoldingCard";

/** One portfolio list; native aggregates own balances and saved swap batches own sales. */
export function PortfolioHoldingsSection({
  emptyContent,
  onReviewSale,
  onWithdraw,
}: {
  emptyContent: ReactNode;
  onReviewSale: () => void;
  onWithdraw: (opportunityId: string) => void;
}) {
  const wallet = useMainnetWallet();
  const holdings = useSwapHoldings();
  const snapshot = wallet.snapshot;
  const owned = snapshot?.ownedAssets ?? [];
  const positions = snapshot?.positions ?? [];
  const swapped = holdings.snapshot?.holdings ?? [];
  const match = (asset: OwnedPortfolioAsset) =>
    swapped.find(
      (holding) =>
        holding.chainId === asset.chainId &&
        holding.token.toLowerCase() === asset.token.toLowerCase(),
    );
  const fallback = swapped.filter(
    (holding) =>
      !owned.some(
        (asset) =>
          asset.chainId === holding.chainId &&
          asset.token.toLowerCase() === holding.token.toLowerCase(),
      ),
  );
  const tokens: { asset: OwnedPortfolioAsset; swapOnly: boolean }[] = [
    ...owned.map((asset) => ({ asset, swapOnly: false })),
    ...fallback.map((holding) => ({
      swapOnly: true,
      asset: {
        assetId: `swap:${holding.chainId}:${holding.token}`,
        chainId: holding.chainId,
        token: holding.token,
        symbol: holding.symbol,
        decimals: holding.decimals,
        balanceAtoms: holding.balanceAtoms,
        observedAtoms: holding.balanceAtoms,
        complete: true,
        stale: !!holdings.error,
        checkedAt: holdings.snapshot!.checkedAt,
        valueUsdcAtoms: null,
        valuationUnavailable: true,
      },
    })),
  ];
  const hasEntries = tokens.length + positions.length > 0;
  const refresh = async (target = "") => {
    await holdings.refresh(target);
    await wallet.refresh();
  };

  return (
    <View className="gap-3">
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
          busy={holdings.busy}
          onAction={onReviewSale}
        />
      )}
      {holdings.notice && <Notice message={holdings.notice} />}
      {hasEntries && (
        <>
          <View className="gap-1 py-2">
            <Typography variant="section">Tokens and vault positions</Typography>
            <Typography variant="micro">
              {tokens.length} {tokens.length === 1 ? "token" : "tokens"} · {positions.length}{" "}
              {positions.length === 1 ? "vault" : "vaults"}
            </Typography>
          </View>
          <View className="gap-3">
            {snapshot?.confidentialReadState === "locked" && !wallet.loading && (
              <Typography variant="micro">
                Private USDC needs wallet unlock before refresh.
              </Typography>
            )}
            {snapshot?.ownedBalanceComplete === false && (
              <>
                <Typography variant="micro">
                  {wallet.loading
                    ? "Checking owned token balances and positions…"
                    : "Some token balances or positions are unavailable. Refresh to retry."}
                </Typography>
                {!wallet.loading && (
                  <Button
                    label="Retry token balances and positions"
                    variant="quiet"
                    onPress={() => void wallet.refresh()}
                  />
                )}
              </>
            )}
            {snapshot?.valuationComplete === false && (
              <Typography variant="micro">
                Some assets have no verified USDC value. Token amounts are shown separately.
              </Typography>
            )}
            {tokens.length > 0 && <Typography variant="eyebrow">Tokens</Typography>}
            {tokens.length > 0 && (
              <View className="-mx-1.5 flex-row flex-wrap">
                {tokens.map(({ asset, swapOnly }) => {
                  const holding = match(asset);
                  const batch = holding?.batches[0];
                  return (
                    <View key={asset.assetId} className="w-1/2 px-1.5 pb-3">
                      <PortfolioHoldingCard
                        asset={asset}
                        swapOnly={swapOnly}
                        swapBalance={
                          !asset.complete && holding
                            ? {
                                atoms: holding.balanceAtoms,
                                decimals: holding.decimals,
                              }
                            : undefined
                        }
                        loading={wallet.loading}
                        action={
                          holding
                            ? {
                                label: "Sell",
                                disabled:
                                  holdings.busy ||
                                  !!holdings.error ||
                                  holdings.saleFailed ||
                                  !batch,
                                onPress: () => {
                                  if (batch) void holdings.sell(batch.id);
                                },
                              }
                            : undefined
                        }
                      />
                    </View>
                  );
                })}
              </View>
            )}
            {positions.length > 0 && (
              <Typography variant="eyebrow" className="pt-2">
                Vault positions
              </Typography>
            )}
            {positions.length > 0 && (
              <View className="-mx-1.5 flex-row flex-wrap">
                {positions.map((asset) => {
                  const vault = demoModeEnabled() ? demoVaultMetadata(asset.assetId) : undefined;
                  return (
                    <View key={asset.assetId} className="w-1/2 px-1.5 pb-3">
                      <PortfolioHoldingCard
                        asset={asset}
                        position
                        loading={wallet.loading}
                        action={
                          vault
                            ? {
                                label: "Withdraw",
                                disabled:
                                  !asset.complete || asset.stale || wallet.loading || holdings.busy,
                                onPress: () => onWithdraw(vault.id),
                              }
                            : undefined
                        }
                      />
                    </View>
                  );
                })}
              </View>
            )}
            {!demoModeEnabled() && <SwapHoldingsTools holdings={holdings} onRefresh={refresh} />}
          </View>
        </>
      )}
      {!hasEntries && holdings.snapshot && !holdings.error && !holdings.saleFailed && emptyContent}
    </View>
  );
}
