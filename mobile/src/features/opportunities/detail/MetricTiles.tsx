import { View } from "react-native";
import { FadeIn } from "@/components/molecules/FadeIn";
import { Metric } from "@/components/molecules/Metric";
import type { OpportunityDetail } from "@/domain/opportunities";
import { money, percent } from "../format";

/** Frontend detail stat tiles enter 40 ms apart. */
const TILE_STAGGER = 40;

/** Frontend OpportunityDetail `grid-cols-2` stat tiles. */
export function MetricTiles({
  opportunity,
  enterDelay,
}: {
  opportunity: OpportunityDetail;
  enterDelay: number;
}) {
  const metrics = [
    { label: "TVL", value: money.format(opportunity.tvl) },
    { label: "APR", value: `${percent.format(opportunity.apr)}%` },
    { label: "Native APR", value: `${percent.format(opportunity.nativeApr)}%` },
    { label: "Daily rewards", value: money.format(opportunity.dailyRewards) },
    { label: "Live campaigns", value: String(opportunity.liveCampaigns) },
    { label: "Action", value: opportunity.action },
  ];
  return (
    <View className="flex-row flex-wrap justify-between gap-y-2">
      {metrics.map((metric, index) => (
        <FadeIn
          key={metric.label}
          delay={enterDelay + index * TILE_STAGGER}
          className="w-full xs:w-[49%]"
        >
          <Metric tile {...metric} />
        </FadeIn>
      ))}
    </View>
  );
}
