import type { ComponentProps } from "react";
import { Image, Pressable, View } from "react-native";
import { Layers } from "lucide-react-native";
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
import { HoldingDetails } from "./HoldingDetails";

/** Public portfolio display only; the owner provides every financial action. */
export function PortfolioHoldingCard({
  asset,
  position = false,
  loading,
  swapOnly = false,
  swapBalance,
  action,
  expanded,
  onToggleExpanded,
  layout,
}: {
  asset: OwnedPortfolioAsset | OwnedPortfolioPosition;
  position?: boolean;
  loading: boolean;
  swapOnly?: boolean;
  swapBalance?: { atoms: string; decimals: number };
  action?: { label: "Sell" | "Withdraw"; disabled: boolean; onPress: () => void };
  expanded: boolean;
  onToggleExpanded: () => void;
  layout?: ComponentProps<typeof Surface>["layout"];
}) {
  const vault = position && demoModeEnabled() ? demoVaultMetadata(asset.assetId) : undefined;
  const logo = vault ? protocolLogo(vault.protocol.name, vault.protocol.id) : undefined;
  const name = vault?.name ?? asset.symbol;
  const compactToken = !expanded && !position;
  const compactVault = !expanded && position;
  const estimated = position && "conversionEstimated" in asset && asset.conversionEstimated;
  const amount =
    position && "underlyingAtoms" in asset ? asset.underlyingAtoms : asset.balanceAtoms;

  const balance =
    asset.complete && amount !== null && asset.decimals !== null
      ? `${estimated ? "Estimated underlying: " : ""}${holdingAmount(amount, asset.decimals)} ${asset.symbol}`
      : loading
        ? `Checking ${asset.symbol} balance…`
        : `${asset.symbol} balance unavailable. Refresh to retry.`;
  const valuation = asset.valueUsdcAtoms !== null && (
    <View className={expanded ? "shrink items-end gap-1" : "w-full items-end gap-1"}>
      <Typography
        variant="value"
        className={expanded ? "text-right !text-[22px]" : "text-right !text-[18px]"}
      >
        {holdingAmount(asset.valueUsdcAtoms, 6)} USDC
      </Typography>
    </View>
  );

  return (
    <Surface className="flex-1" layout={layout}>
      <Pressable accessible={false} onPress={onToggleExpanded} className="flex-1 gap-3 p-4">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${name} ${position ? "vault position" : "token holding"}`}
          accessibilityHint={expanded ? "Collapse holding details" : "Expand holding details"}
          accessibilityState={{ expanded }}
          accessibilityValue={{ text: balance }}
          onPress={(event) => {
            event?.stopPropagation();
            onToggleExpanded();
          }}
          pressedScale={0.99}
          className={
            expanded
              ? "flex-row flex-wrap items-center gap-3"
              : position
                ? "gap-3"
                : "flex-row flex-wrap items-start gap-x-2 gap-y-3"
          }
        >
          <View className="shrink-0 items-start">
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
          <View className={expanded || !position ? "min-w-0 flex-1 gap-1" : "gap-1"}>
            <Typography
              variant="cardTitle"
              className={expanded ? "!text-[20px]" : compactToken ? "text-left" : ""}
            >
              {name}
            </Typography>
            <Typography variant="caption" className={compactToken ? "text-left" : ""}>
              {balance}
            </Typography>
          </View>
          {!compactVault && valuation}
        </PressableScale>
        {expanded && <HoldingDetails asset={asset} position={position} />}
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
        {expanded && (
          <HoldingPerformance
            assetId={asset.assetId}
            valueUsdcAtoms={asset.valueUsdcAtoms}
            position={position}
            name={name}
            height={160}
          />
        )}
        {(action || compactVault) && (
          <View className="mt-auto gap-3">
            {compactVault && valuation}
            {action && (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`${action.label} ${name}`}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={(event) => {
                  event?.stopPropagation();
                  action.onPress();
                }}
                className={`min-h-11 items-center justify-center rounded-full px-3 ${action.disabled ? "bg-well" : "bg-neon/10"}`}
              >
                <Typography variant="label" className={action.disabled ? "!text-fg-35" : ""}>
                  {action.label}
                </Typography>
              </PressableScale>
            )}
          </View>
        )}
      </Pressable>
    </Surface>
  );
}
