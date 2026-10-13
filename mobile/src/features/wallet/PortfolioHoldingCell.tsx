import { useState, type ComponentProps } from "react";
import type { LayoutChangeEvent } from "react-native";
import Animated, { LinearTransition, useReducedMotion } from "react-native-reanimated";
import { durations, easeInOut, reduceMotion } from "@/theme/motion";
import { PortfolioHoldingCard } from "./PortfolioHoldingCard";

export const holdingLayout = LinearTransition.duration(durations.holdingExpand)
  .easing(easeInOut)
  .reduceMotion(reduceMotion);

/** A two-column cell expands in the grid to two columns and two compact rows. */
export function PortfolioHoldingCell(
  props: Omit<ComponentProps<typeof PortfolioHoldingCard>, "layout">,
) {
  const { expanded } = props;
  const [compactHeight, setCompactHeight] = useState(0);
  const reduced = useReducedMotion();
  const measureCompact = (event: LayoutChangeEvent) => {
    if (expanded) return;
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (height > 0) setCompactHeight((current) => (current === height ? current : height));
  };
  return (
    <Animated.View
      layout={reduced ? undefined : holdingLayout}
      collapsable={false}
      className={`${expanded ? "w-full" : "w-1/2"} px-1.5 pb-3`}
    >
      <Animated.View
        layout={reduced ? undefined : holdingLayout}
        collapsable={false}
        onLayout={measureCompact}
        className="flex-1"
        style={expanded && compactHeight > 0 ? { minHeight: compactHeight * 2 } : undefined}
      >
        <PortfolioHoldingCard {...props} layout={holdingLayout} />
      </Animated.View>
    </Animated.View>
  );
}
