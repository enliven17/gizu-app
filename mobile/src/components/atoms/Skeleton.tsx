import { useEffect } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/** Shared pulse: opacity 0.55 → 1 → 0.55 over 1.8 s; static under reduced motion. */
function usePulse() {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 0.8 : 0.55);
  useEffect(() => {
    if (reduced) return;
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity, reduced]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

/** Placeholder block shaped like the content it stands in for. Size it with className. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  const style = usePulse();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`rounded-lg bg-skeleton ${className}`}
      style={style}
    />
  );
}
