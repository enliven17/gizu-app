import { Image, Text, View, useWindowDimensions } from "react-native";
import { Lock } from "lucide-react-native";
import { GlitchLabel } from "@/components/atoms/GlitchLabel";
import { Typography } from "@/components/atoms/Typography";
import { FadeIn } from "@/components/molecules/FadeIn";
import type { OpportunityDetail } from "@/domain/opportunities";
import colors from "@/theme/colors.json";
import { sectionDelay } from "@/theme/motion";
import { percent } from "../format";
import { protocolLogo } from "../protocolLogos";

const tabular = { fontVariant: ["tabular-nums" as const] };

/** Frontend OpportunityDetail hero: glass protocol tile, glitch name, 40px total APR. */
export function OpportunityHero({ opportunity }: { opportunity: OpportunityDetail }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  const apr = `${percent.format(opportunity.totalApr)}%`;
  const logo = protocolLogo(opportunity.protocol.name);
  return (
    <FadeIn delay={sectionDelay(1)} className="mt-4 gap-7">
      <View className="flex-row items-center gap-3">
        <View className="h-14 min-w-14 max-w-[88px] items-center justify-center rounded-2xl border border-glassBorder bg-glass px-3">
          {logo ? (
            <Image source={logo} className="h-9 w-9 rounded-xl" accessibilityIgnoresInvertColors />
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
        <View className="min-w-0 flex-1 gap-1">
          <GlitchLabel
            variant="heading"
            className="!text-[26px] !leading-[32px] ios:tracking-tight"
            text={opportunity.name}
          />
          <View className="flex-row items-center gap-1.5">
            <Lock size={10} color={colors.fg["35"]} />
            <Typography variant="eyebrow" className="shrink">
              {`${opportunity.protocol.name} · ${opportunity.chain.name} · ${opportunity.status}`}
            </Typography>
          </View>
        </View>
      </View>
      <View
        className="flex-row flex-wrap items-end gap-3"
        accessible
        accessibilityLabel={`Total APR ${apr}`}
      >
        <Text
          key={fontScale}
          className="font-sans text-[40px] font-normal leading-[44px] ios:tracking-tight text-neon"
          style={tabular}
        >
          {apr}
        </Text>
        <Text key={`${fontScale}-suffix`} className="font-sans mb-1.5 text-[13px] text-fg-45">
          Total APR
        </Text>
      </View>
    </FadeIn>
  );
}
