import { useContext, useState } from "react";
import { View } from "react-native";
import { Share2 } from "lucide-react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackAction } from "@/navigation/BackAction";
import { MetricGroup } from "@/components/molecules/MetricGroup";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { IconButton } from "@/components/atoms/IconButton";
import { FadeIn } from "@/components/molecules/FadeIn";
import { Surface } from "@/components/molecules/Surface";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { Notice } from "@/components/molecules/Notice";
import { HistoryChart } from "@/components/organisms/HistoryChart";
import { sectionDelay } from "@/theme/motion";
import { useVaultDetailController } from "./useVaultDetailController";
import { DataStatus } from "./DataStatus";
import { AllocationCard } from "./detail/AllocationCard";
import { TRADE_BAR_ESTIMATE, TradeBar } from "./detail/TradeBar";
import { VaultHero } from "./detail/VaultHero";

// Frontend VaultDetail stagger: header 0, hero 1, chart 2, metrics 3, allocation 4, terms 5.
// Screen already applies a 16px gap, so `mt-*` below tops up to the frontend rhythm.

/** Scroll space the sticky trade bar covers beyond what Screen already reserves. */
function useTradeBarSpacer(barHeight: number) {
  const tabHeight = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  // Screen stops scrolling above the bottom inset (or pads for the tab bar itself).
  return Math.max(0, barHeight - (tabHeight === undefined ? insets.bottom : 0));
}

export function VaultDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "VaultDetail">) {
  const { data, vault, sharing, shareError, share } = useVaultDetailController(route.params.id);
  const [barHeight, setBarHeight] = useState(TRADE_BAR_ESTIMATE);
  const spacer = useTradeBarSpacer(barHeight);
  return (
    <View className="flex-1 bg-ink">
      <Screen>
        <FadeIn delay={sectionDelay(0)} className="flex-row justify-between">
          <BackAction fallback="Vaults" />
          {vault && (
            <IconButton
              icon={Share2}
              label="Share summary"
              loading={sharing}
              onPress={() => void share()}
            />
          )}
        </FadeIn>
        {!vault && <DataStatus />}
        {vault ? (
          <>
            <VaultHero vault={vault} />
            <DataStatus />
            <FadeIn delay={sectionDelay(2)} className="mt-2">
              <HistoryChart series={vault.series} height={190} up={Number(vault.change24h) >= 0} />
            </FadeIn>
            <View className="mt-4">
              <MetricGroup
                columns={3}
                enterDelay={sectionDelay(3)}
                metrics={[
                  { label: "Net APY", value: `${vault.apy}%`, accent: true },
                  { label: "TVL", value: vault.tvl },
                  { label: "Lockup", value: vault.lockup },
                ]}
              />
            </View>
            <FadeIn delay={sectionDelay(4)} className="mt-3 gap-4">
              <Typography variant="section">Allocation</Typography>
              <AllocationCard allocation={vault.allocation} />
            </FadeIn>
            <FadeIn delay={sectionDelay(5)} className="mt-3 gap-4">
              <Typography variant="section">Terms</Typography>
              <Surface>
                {[
                  ["Strategy", vault.strategy],
                  ["Risk band", vault.risk],
                  ["Minimum", vault.minimum],
                  ["Redemption", vault.lockup],
                  ["Management fee", "2.0% / 20%"],
                ].map(([label, value], index, rows) => (
                  <GroupedRow
                    key={label}
                    label={label!}
                    value={value}
                    last={index === rows.length - 1}
                  />
                ))}
              </Surface>
            </FadeIn>
            {shareError && <Notice error message="Sharing failed. Please try again." />}
            <View style={{ height: spacer }} />
          </>
        ) : (
          data && <Notice message="Vault not found in this snapshot." />
        )}
      </Screen>
      {vault && (
        <TradeBar
          onHeight={setBarHeight}
          onBuy={() => navigation.navigate("Transaction", { kind: "buy", vaultId: vault.id })}
          onSell={() => navigation.navigate("Transaction", { kind: "sell", vaultId: vault.id })}
        />
      )}
    </View>
  );
}
