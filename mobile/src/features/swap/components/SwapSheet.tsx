import type { PropsWithChildren } from "react";
import { View } from "react-native";
import Animated, {
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";
import { Typography } from "@/components/atoms/Typography";
import { springs, timing } from "@/theme/motion";

// Frontend SwapSheet: rises from the bottom edge on a 250/30 spring.
const sheetEntering: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 320 }] },
    animations: {
      opacity: withTiming(1, timing.screen),
      transform: [{ translateY: withSpring(0, springs.sheet) }],
    },
  };
};

/** Glass review sheet with the 36px sheet radius; floats above the tab bar. */
export function SwapSheet({ children }: PropsWithChildren) {
  return (
    <Animated.View
      entering={sheetEntering}
      className="mt-2 gap-4 rounded-sheet border border-glassBorder bg-glass px-5 pb-6 pt-5"
    >
      {children}
    </Animated.View>
  );
}

/** Soft glass amount tile inside the sheet (frontend From / Receive panels). */
export function SheetAmount({ label, value }: { label: string; value: string }) {
  return (
    <View className="gap-2 rounded-3xl border border-borderSoft bg-glassSoft px-5 py-4">
      <Typography variant="micro">{label}</Typography>
      <Typography
        className="!text-[30px] !leading-9 !text-fg-85"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Typography>
    </View>
  );
}

/** Quiet key/value rows (frontend review list). */
export function QuoteRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <View className="gap-2.5 px-1">
      {rows.map(([label, value]) => (
        <View key={label} className="flex-row flex-wrap justify-between gap-x-4 gap-y-1">
          <Typography variant="rowValue" className="!text-fg-45">
            {label}
          </Typography>
          <Typography
            variant="rowValue"
            className="shrink text-right !text-fg-70"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {value}
          </Typography>
        </View>
      ))}
    </View>
  );
}
