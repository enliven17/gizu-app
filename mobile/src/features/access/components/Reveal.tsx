import type { PropsWithChildren } from "react";
import Animated, { FadeInUp } from "react-native-reanimated";
import { durations, easeOut, reduceMotion } from "@/theme/motion";

export type RevealProps = PropsWithChildren<{
  /** Milliseconds before entering. */
  delay?: number;
  /** Milliseconds for the entrance. */
  duration?: number;
  /** Starting vertical offset in points; negative values enter from above. */
  offset?: number;
  className?: string;
}>;

/**
 * Frontend `motion` entrance (opacity + translateY) with per-use timing. Native text
 * cannot blur cheaply, so the frontend blur-in is approximated by opacity and offset.
 * Content stays laid out and pressable while entering; reduced motion skips it.
 */
export function Reveal({
  delay = 0,
  duration = durations.fadeIn,
  offset = 16,
  className,
  children,
}: RevealProps) {
  const entering = FadeInUp.duration(duration)
    .delay(delay)
    .easing(easeOut)
    .withInitialValues({ opacity: 0, transform: [{ translateY: offset }] })
    .reduceMotion(reduceMotion);
  return (
    <Animated.View entering={entering} className={className}>
      {children}
    </Animated.View>
  );
}
