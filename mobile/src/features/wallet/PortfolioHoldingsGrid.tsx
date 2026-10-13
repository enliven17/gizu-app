import type { ComponentProps } from "react";
import Animated from "react-native-reanimated";
import { PortfolioHoldingCell, holdingLayout } from "./PortfolioHoldingCell";

type HoldingItem = Omit<
  ComponentProps<typeof PortfolioHoldingCell>,
  "expanded" | "onToggleExpanded"
>;

/** Keep expanded cards at row starts, moving a compact left neighbor below them. */
export function PortfolioHoldingsGrid({
  items,
  expandedId,
  onToggle,
}: {
  items: HoldingItem[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const ordered: HoldingItem[] = [];
  let leftIndex: number | null = null;
  for (const item of items) {
    if (expandedId === item.asset.assetId) {
      if (leftIndex === null) ordered.push(item);
      else {
        ordered.splice(leftIndex, 0, item);
        leftIndex += 1;
      }
    } else {
      ordered.push(item);
      leftIndex = leftIndex === null ? ordered.length - 1 : null;
    }
  }

  return (
    <Animated.View layout={holdingLayout} className="-mx-1.5 flex-row flex-wrap">
      {ordered.map((item) => (
        <PortfolioHoldingCell
          key={item.asset.assetId}
          {...item}
          expanded={expandedId === item.asset.assetId}
          onToggleExpanded={() => onToggle(item.asset.assetId)}
        />
      ))}
    </Animated.View>
  );
}
