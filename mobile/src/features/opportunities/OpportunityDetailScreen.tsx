import { View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "@/components/atoms/Button";
import { FadeIn } from "@/components/molecules/FadeIn";
import { Screen } from "@/components/templates/Screen";
import { safeExternalUrl } from "@/domain/opportunities";
import { BackAction } from "@/navigation/BackAction";
import type { RootStackParamList } from "@/navigation/types";
import { sectionDelay } from "@/theme/motion";
import { CatalogStatus } from "./components/CatalogStatus";
import { DepositLink } from "./detail/DepositLink";
import { MetricTiles } from "./detail/MetricTiles";
import { OpportunityHero } from "./detail/OpportunityHero";
import { OpportunitySections } from "./detail/OpportunitySections";
import { TvlChart } from "./detail/TvlChart";
import { useOpportunityDetail } from "./useOpportunityDetail";

// Frontend OpportunityDetail, browse-only: header 0, hero 1, chart 2, stats 3, sections 4+.
// Screen already applies a 16 px gap, so `mt-*` below tops up to the frontend rhythm.
export function OpportunityDetailScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, "OpportunityDetail">) {
  const { load, history, retry } = useOpportunityDetail(route.params.id);
  const depositUrl = load.kind === "ready" ? safeExternalUrl(load.opportunity.depositUrl) : null;
  return (
    <Screen>
      <FadeIn delay={sectionDelay(0)} className="flex-row items-center justify-between">
        <BackAction fallback="Vaults" />
        {depositUrl && <DepositLink url={depositUrl} />}
      </FadeIn>
      {load.kind === "loading" && (
        <CatalogStatus accessibilityLiveRegion="polite">Loading vault…</CatalogStatus>
      )}
      {load.kind === "failed" && (
        <View className="gap-3">
          <CatalogStatus accessibilityRole="alert">Vault unavailable. Please retry.</CatalogStatus>
          <Button label="Retry vault" variant="secondary" onPress={retry} />
        </View>
      )}
      {load.kind === "ready" && (
        <>
          <OpportunityHero opportunity={load.opportunity} />
          <FadeIn delay={sectionDelay(2)} className="mt-2">
            <TvlChart history={history} />
          </FadeIn>
          <View className="mt-4">
            <MetricTiles opportunity={load.opportunity} enterDelay={sectionDelay(3)} />
          </View>
          <OpportunitySections opportunity={load.opportunity} />
        </>
      )}
    </Screen>
  );
}
