import { useState } from "react";
import { Image, View } from "react-native";
import { Info, Layers } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import type { OwnedPortfolioAsset, OwnedPortfolioPosition } from "@/domain/wallet/storedSigner";
import { holdingAmount } from "@/features/swap/SwapHoldingsSection";
import { protocolLogo } from "@/features/opportunities/protocolLogos";
import { demoModeEnabled } from "@/config/demo";
import { demoVaultMetadata } from "@/services/demo/opportunities";
import colors from "@/theme/colors.json";

function networkName(chainId: number) {
  return { 1: "Ethereum", 143: "Monad", 4663: "Robinhood" }[chainId] ?? `Chain ${chainId}`;
}

/** Public portfolio display only; the owner provides every financial action. */
export function PortfolioHoldingCard({
  asset,
  position = false,
  loading,
  swapOnly = false,
  swapBalance,
  action,
}: {
  asset: OwnedPortfolioAsset | OwnedPortfolioPosition;
  position?: boolean;
  loading: boolean;
  swapOnly?: boolean;
  swapBalance?: { atoms: string; decimals: number };
  action?: { label: "Sell" | "Withdraw"; disabled: boolean; onPress: () => void };
}) {
  const [details, setDetails] = useState(false);
  const vault = position && demoModeEnabled() ? demoVaultMetadata(asset.assetId) : undefined;
  const logo = vault ? protocolLogo(vault.protocol.name, vault.protocol.id) : undefined;
  const name = vault?.name ?? asset.symbol;
  const estimated = position && "conversionEstimated" in asset && asset.conversionEstimated;
  const amount =
    position && "underlyingAtoms" in asset ? asset.underlyingAtoms : asset.balanceAtoms;
  const observed = position
    ? "observedUnderlyingAtoms" in asset
      ? asset.observedUnderlyingAtoms
      : null
    : asset.observedAtoms;
  const detailsLabel = `${name} ${position ? "position" : "holding"} details`;

  return (
    <Surface className="flex-1">
      <View className="flex-1 gap-3 p-4">
        <View className="flex-row items-center justify-between gap-1">
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-11 w-11 items-center justify-center rounded-2xl bg-neon/10"
          >
            {logo ? (
              <Image source={logo} className="h-7 w-7" resizeMode="contain" />
            ) : position ? (
              <Layers size={20} color={colors.accent} />
            ) : (
              <Typography variant="label">{asset.symbol.slice(0, 2)}</Typography>
            )}
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={detailsLabel}
            accessibilityState={{ expanded: details }}
            onPress={() => setDetails((value) => !value)}
            className="h-11 w-11 items-center justify-center rounded-full"
          >
            <Info size={18} color={details ? colors.accent : colors.fg["45"]} />
          </PressableScale>
        </View>
        <View className="gap-1">
          <Typography variant="cardTitle">{name}</Typography>
          <Typography variant="caption">
            {asset.complete && amount !== null && asset.decimals !== null
              ? `${estimated ? "Estimated underlying: " : ""}${holdingAmount(amount, asset.decimals)} ${asset.symbol}`
              : loading
                ? `Checking ${asset.symbol} balance…`
                : `${asset.symbol} balance unavailable. Refresh to retry.`}
          </Typography>
        </View>
        {asset.valueUsdcAtoms !== null && (
          <Typography variant="value" className="!text-[18px]">
            {holdingAmount(asset.valueUsdcAtoms, 6)} USDC
          </Typography>
        )}
        {swapBalance && (
          <View className="gap-1">
            <Typography variant="micro">Swap receiving wallets</Typography>
            <Typography variant="caption">
              {holdingAmount(swapBalance.atoms, swapBalance.decimals)} {asset.symbol}
            </Typography>
          </View>
        )}
        {asset.stale && (
          <Typography variant="micro">
            {loading ? "Cached amount awaiting refresh." : "Showing a cached observation."}
          </Typography>
        )}
        {swapOnly && <Typography variant="micro">Swap receiving wallets</Typography>}
        <View className="mt-auto gap-3 border-t border-divider pt-3">
          <Typography variant="micro">
            {vault
              ? `${vault.protocol.name} · ${vault.chain.name}`
              : `${position ? "Vault position · " : ""}${networkName(asset.chainId)}`}
          </Typography>
          {action && (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${action.label} ${name}`}
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              onPress={action.onPress}
              className={`min-h-11 items-center justify-center rounded-full px-3 ${action.disabled ? "bg-well" : "bg-neon/10"}`}
            >
              <Typography variant="label" className={action.disabled ? "!text-fg-35" : ""}>
                {action.label}
              </Typography>
            </PressableScale>
          )}
        </View>
        {details && (
          <View className="gap-2 border-t border-divider pt-3">
            <Typography variant="micro">Chain {asset.chainId}</Typography>
            {asset.token && (
              <Typography variant="micro" selectable>
                {asset.token}
              </Typography>
            )}
            {!asset.complete &&
              typeof observed === "string" &&
              observed !== "0" &&
              asset.decimals !== null && (
                <Typography variant="micro">
                  Previously observed: {holdingAmount(observed, asset.decimals)} {asset.symbol}
                </Typography>
              )}
            {asset.valueUsdcAtoms === null && (
              <Typography variant="micro">
                {asset.valuationUnavailable || !loading
                  ? "USDC value unavailable."
                  : "Checking USDC value…"}
              </Typography>
            )}
            {action?.label === "Sell" && (
              <Typography variant="micro">Sales use only swap receiving wallets.</Typography>
            )}
          </View>
        )}
      </View>
    </Surface>
  );
}
