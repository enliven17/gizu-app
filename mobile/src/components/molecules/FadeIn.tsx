import type { PropsWithChildren } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { durations, easeOut, reduceMotion } from "@/theme/motion";

export type FadeInProps = PropsWithChildren<{
  /** Milliseconds before entering; see `sectionDelay` / `cardDelay` in theme/motion. */
  delay?: number;
  className?: string;
  style?: StyleProp<ViewStyle>;
}>;

/** Frontend entrance: opacity 0 → 1 and translateY 16 → 0 over 450ms. */
export function FadeIn({ delay = 0, className, style, children }: FadeInProps) {
  const entering = FadeInUp.duration(durations.fadeIn)
    .delay(delay)
    .easing(easeOut)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 16 }] })
    .reduceMotion(reduceMotion);
  return (
    <Animated.View entering={entering} className={className} style={style}>
      {children}
    </Animated.View>
  );
}
