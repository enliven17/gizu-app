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
  const { expanded, position } = props;
  const [compactSize, setCompactSize] = useState({ width: 0, height: 0 });
  const reduced = useReducedMotion();
  const measureCompact = (event: LayoutChangeEvent) => {
    if (expanded) return;
    const width = event.nativeEvent.layout.width;
    const height = Math.ceil(event.nativeEvent.layout.height);
    if (width > 0 && height > 0)
      setCompactSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
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
        style={
          expanded && compactSize.height > 0
            ? { minHeight: compactSize.height * 2 }
            : !position && compactSize.width > 0
              ? { minHeight: compactSize.width }
              : undefined
        }
      >
        <PortfolioHoldingCard {...props} layout={holdingLayout} />
      </Animated.View>
    </Animated.View>
  );
}
