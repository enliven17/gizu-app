import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import colors from "@/theme/colors.json";

const sizes = { sm: 16, md: 24, lg: 36 } as const;

/** Ring spinner: a 25% track with an accent arc, one turn per 800 ms. */
export function Spinner({
  size = "md",
  color = colors.neon.DEFAULT,
  label,
}: {
  size?: keyof typeof sizes;
  color?: string;
  /** Announced as a progress indicator; omit when the parent already reports busy state. */
  label?: string;
}) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    turn.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(turn);
  }, [turn, reduced]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const px = sizes[size];
  return (
    <View
      accessible={label !== undefined}
      accessibilityRole={label === undefined ? undefined : "progressbar"}
      accessibilityLabel={label}
      accessibilityElementsHidden={label === undefined}
      importantForAccessibility={label === undefined ? "no-hide-descendants" : "yes"}
    >
      <Animated.View
        style={[
          {
            width: px,
            height: px,
            borderRadius: px / 2,
            borderWidth: Math.max(2, Math.round(px / 10)),
            borderColor: `${color}40`,
            borderTopColor: color,
          },
          style,
        ]}
      />
    </View>
  );
}
