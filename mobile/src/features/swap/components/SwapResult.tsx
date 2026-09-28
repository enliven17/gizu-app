import { View } from "react-native";
import Animated, {
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";
import { Check, Clock } from "lucide-react-native";
import { ScrambleText } from "@/components/atoms/ScrambleText";
import colors from "@/theme/colors.json";
import { springs, timing } from "@/theme/motion";

// Frontend SignOverlay check: scale 0.4 → 1 on a 220/18 spring.
const checkEntering: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.4 }] },
    animations: {
      opacity: withTiming(1, timing.press),
      transform: [{ scale: withSpring(1, springs.check) }],
    },
  };
};

/** Status mark and scrambled heading for a simulated order. */
export function SwapResult({ filled }: { filled: boolean }) {
  const title = filled ? "Swap simulated" : "Simulation pending";
  return (
    <View className="items-center gap-4 py-2">
      <Animated.View
        key={filled ? "filled" : "pending"}
        entering={filled ? checkEntering : undefined}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={`h-16 w-16 items-center justify-center rounded-full ${filled ? "bg-neon/10" : "border border-borderSoft bg-glassSoft"}`}
      >
        {filled ? (
          <Check size={28} strokeWidth={2.2} color={colors.neon.DEFAULT} />
        ) : (
          <Clock size={24} color={colors.fg["55"]} />
        )}
      </Animated.View>
      <ScrambleText
        key={title}
        text={title}
        variant="section"
        className="text-center"
        accessibilityLiveRegion="polite"
      />
    </View>
  );
}
