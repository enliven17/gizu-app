import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import type { Vault } from "@/domain/investments";
import { easeOut, reduceMotion } from "@/theme/motion";

type Allocation = Vault["allocation"][number];

// Frontend: bars grow 0 → pct over 0.6s after 0.2 + 0.1·i s; each slice dims by 0.28.
const BAR_DURATION = 600;
const BAR_BASE_DELAY = 200;
const BAR_STEP_DELAY = 100;

function sliceOpacity(index: number): number {
  return Math.max(0.16, 1 - index * 0.28);
}

function AllocationBar({ item, index }: { item: Allocation; index: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      BAR_BASE_DELAY + index * BAR_STEP_DELAY,
      withTiming(1, { duration: BAR_DURATION, easing: easeOut, reduceMotion }),
      reduceMotion,
    );
    return () => cancelAnimation(progress);
  }, [index, progress]);
  const pct = Math.min(100, Math.max(0, item.pct));
  const style = useAnimatedStyle(() => ({ width: `${pct * progress.value}%` }));
  return (
    <Animated.View className="h-full bg-neon" style={[{ opacity: sliceOpacity(index) }, style]} />
  );
}

/** Frontend VaultDetail allocation: animated stacked bar over a dot legend. */
export function AllocationCard({ allocation }: { allocation: Allocation[] }) {
  return (
    <Surface>
      <View className="gap-5 p-5">
        <View
          className="h-2.5 flex-row overflow-hidden rounded-full bg-divider"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {allocation.map((item, index) => (
            <AllocationBar key={item.label} item={item} index={index} />
          ))}
        </View>
        <View className="gap-3">
          {allocation.map((item, index) => (
            <View
              key={item.label}
              className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                <View
                  className="h-2 w-2 rounded-full bg-neon"
                  style={{ opacity: sliceOpacity(index) }}
                />
                <Typography variant="rowTitle" className="shrink !font-normal !text-fg-70">
                  {item.label}
                </Typography>
              </View>
              <Typography
                variant="rowValue"
                className="!text-[13px] !text-fg-55"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {`${item.pct}%`}
              </Typography>
            </View>
          ))}
        </View>
      </View>
    </Surface>
  );
}
