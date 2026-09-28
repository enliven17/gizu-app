import { Text, View, useWindowDimensions } from "react-native";
import { Lock } from "lucide-react-native";
import { Badge } from "@/components/atoms/Badge";
import { GlitchLabel } from "@/components/atoms/GlitchLabel";
import { Typography } from "@/components/atoms/Typography";
import { FadeIn } from "@/components/molecules/FadeIn";
import type { Vault } from "@/domain/investments";
import colors from "@/theme/colors.json";
import { sectionDelay } from "@/theme/motion";

const tabular = { fontVariant: ["tabular-nums" as const] };

/** Frontend VaultDetail hero: glass ticker tile, 28px glitch title, 40px price, change pill. */
export function VaultHero({ vault }: { vault: Vault }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  const up = Number(vault.change24h) >= 0;
  const change = `${up && !vault.change24h.startsWith("+") ? "+" : ""}${vault.change24h}%`;
  return (
    <FadeIn delay={sectionDelay(1)} className="mt-4 gap-7">
      <View className="flex-row items-center gap-3">
        <View className="h-14 w-14 items-center justify-center rounded-2xl border border-glassBorder bg-glass">
          <Text
            key={fontScale}
            className="font-sans text-[15px] font-bold text-neon"
            style={tabular}
          >
            {vault.ticker}
          </Text>
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <GlitchLabel
            variant="heading"
            className="!text-[28px] !leading-[34px] ios:tracking-tight"
            text={vault.name}
          />
          <View className="flex-row items-center gap-1.5">
            <Lock size={10} color={colors.fg["35"]} />
            <Typography variant="eyebrow" className="shrink !tracking-[1px]">
              {vault.managers}
            </Typography>
          </View>
        </View>
      </View>
      <View className="gap-2">
        <View className="flex-row flex-wrap items-end gap-3">
          <Text
            key={fontScale}
            className="font-sans text-[40px] font-normal leading-[44px] ios:tracking-tight text-text"
            style={tabular}
          >
            {`$${vault.price}`}
          </Text>
          <View className="mb-1">
            <Badge label={change} negative={!up} />
          </View>
        </View>
      </View>
    </FadeIn>
  );
}
