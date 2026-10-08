import { Image, Text, View, useWindowDimensions } from "react-native";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import type { OpportunityDetail } from "@/domain/opportunities";
import type { TvlLoad } from "../useTvlSeries";
import { money, rate } from "../format";
import { protocolLogo } from "../protocolLogos";
import { TvlChart } from "./TvlChart";

const tabular = { fontVariant: ["tabular-nums" as const] };

/** Vault summary card: identity, headline rate, TVL chart and the two vault actions. */
export function OpportunityHero({
  opportunity,
  history,
  onDeposit,
  onWithdraw,
}: {
  opportunity: OpportunityDetail;
  history: TvlLoad;
  onDeposit: () => void;
  onWithdraw: () => void;
}) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  const apr = rate(opportunity.totalApr);
  const tvl = money.format(opportunity.tvl);
  const label = opportunity.rateType === "apy" ? "Net APY" : "Total APR";
  const logo = protocolLogo(opportunity.protocol.name, opportunity.protocol.id);
  const showChart =
    opportunity.tvl !== null || (history.kind === "ready" && history.series.length >= 2);
  return (
    <Surface>
      <View className="gap-5 p-5">
        <View className="flex-row items-center gap-3">
          <View className="h-12 min-w-12 max-w-[80px] items-center justify-center rounded-2xl bg-well px-2">
            {logo ? (
              <Image
                source={logo}
                className="h-8 w-8 rounded-xl"
                resizeMode="contain"
                accessibilityLabel={`${opportunity.protocol.name} logo`}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <Text
                key={fontScale}
                numberOfLines={1}
                className="font-sans text-[13px] font-bold text-neon"
              >
                {opportunity.protocol.name.slice(0, 4)}
              </Text>
            )}
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Typography
              variant="cardTitle"
              accessibilityLabel={opportunity.name}
              numberOfLines={2}
              className="!text-[19px]"
            >
              {opportunity.name}
            </Typography>
            <Typography variant="micro">
              {`${opportunity.protocol.name} · ${opportunity.chain.name} · ${opportunity.status}`}
            </Typography>
          </View>
        </View>
        <View className="flex-row flex-wrap items-end justify-between gap-3">
          <View accessible accessibilityLabel={`${label} ${apr}`} className="gap-1">
            <Typography variant="label11">{label}</Typography>
            <Text
              key={fontScale}
              className="font-sans text-[36px] leading-[40px] ios:tracking-tight text-neon"
              style={tabular}
            >
              {apr}
            </Text>
          </View>
          <View accessible accessibilityLabel={`TVL ${tvl}`} className="items-end gap-1">
            <Typography variant="label11">TVL</Typography>
            <Text
              key={`tvl-${fontScale}`}
              className="font-sans text-[18px] text-text"
              style={tabular}
            >
              {tvl}
            </Text>
          </View>
        </View>
        {showChart && <TvlChart history={history} />}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="Deposit" onPress={onDeposit} />
          </View>
          <View className="flex-1">
            <Button label="Withdraw" variant="secondary" onPress={onWithdraw} />
          </View>
        </View>
      </View>
    </Surface>
  );
}
