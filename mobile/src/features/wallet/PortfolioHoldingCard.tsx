import { useState } from "react";
import { Image, View } from "react-native";
import { ChevronDown, ChevronUp, Layers } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import type { OwnedPortfolioAsset, OwnedPortfolioPosition } from "@/domain/wallet/storedSigner";
import { holdingAmount } from "@/features/swap/SwapHoldingsSection";
import { protocolLogo } from "@/features/opportunities/protocolLogos";
import { demoModeEnabled } from "@/config/demo";
import { demoVaultMetadata } from "@/services/demo/opportunities";
import colors from "@/theme/colors.json";
import { HoldingPerformance } from "./HoldingPerformance";

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
  const [performance, setPerformance] = useState(false);
  const vault = position && demoModeEnabled() ? demoVaultMetadata(asset.assetId) : undefined;
  const logo = vault ? protocolLogo(vault.protocol.name, vault.protocol.id) : undefined;
  const name = vault?.name ?? asset.symbol;
  const estimated = position && "conversionEstimated" in asset && asset.conversionEstimated;
  const amount =
    position && "underlyingAtoms" in asset ? asset.underlyingAtoms : asset.balanceAtoms;

  return (
    <Surface className="flex-1">
      <View className="flex-1 gap-3 p-4">
        <View className="items-start">
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
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${name} performance`}
          accessibilityState={{ expanded: performance }}
          onPress={() => setPerformance((value) => !value)}
          className="min-h-11 flex-row items-center justify-between gap-1 rounded-full bg-well px-3"
        >
          <Typography variant="caption" className="shrink !text-[12px]">
            Performance
          </Typography>
          {performance ? (
            <ChevronUp size={14} color={colors.muted} />
          ) : (
            <ChevronDown size={14} color={colors.muted} />
          )}
        </PressableScale>
        {performance && (
          <HoldingPerformance
            assetId={asset.assetId}
            valueUsdcAtoms={asset.valueUsdcAtoms}
            position={position}
            name={name}
          />
        )}
        {action && (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${action.label} ${name}`}
            accessibilityState={{ disabled: action.disabled }}
            disabled={action.disabled}
            onPress={action.onPress}
            className={`mt-auto min-h-11 items-center justify-center rounded-full px-3 ${action.disabled ? "bg-well" : "bg-neon/10"}`}
          >
            <Typography variant="label" className={action.disabled ? "!text-fg-35" : ""}>
              {action.label}
            </Typography>
          </PressableScale>
        )}
      </View>
    </Surface>
  );
}
