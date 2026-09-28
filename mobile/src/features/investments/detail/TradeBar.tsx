import { useContext, useId } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Button } from "@/components/atoms/Button";
import colors from "@/theme/colors.json";

/** Frontend `pt-10` gradient lead-in above the buttons. */
const GRADIENT_LEAD = 40;
/** Frontend `pb-8` below the buttons; also the minimum over a zero inset. */
const BOTTOM_SPACE = 32;
/** Approximate settled height, used until the bar reports its measured layout. */
export const TRADE_BAR_ESTIMATE = GRADIENT_LEAD + 56 + BOTTOM_SPACE;

/** Bottom padding the bar needs beyond the device inset or floating tab bar it sits on. */
function useBottomSpacing() {
  const tabHeight = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  return {
    offset: tabHeight ?? 0,
    paddingBottom: tabHeight === undefined ? Math.max(insets.bottom, BOTTOM_SPACE) : 16,
    paddingHorizontal: Math.max(insets.left, insets.right) + 20,
  };
}

/** Frontend `bg-gradient-to-t from-ink via-ink/90 to-transparent`, painted top → bottom. */
function InkGradient() {
  const id = `trade-bar-fade-${useId().replace(/:/g, "")}`;
  return (
    <Svg
      pointerEvents="none"
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
          <Stop offset="0.5" stopColor={colors.ink} stopOpacity={0.9} />
          <Stop offset="1" stopColor={colors.ink} stopOpacity={1} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** Sticky Buy / Sell actions over an ink fade, above the safe area or floating tabs. */
export function TradeBar({
  onBuy,
  onSell,
  onHeight,
}: {
  onBuy: () => void;
  onSell: () => void;
  onHeight: (height: number) => void;
}) {
  const { offset, paddingBottom, paddingHorizontal } = useBottomSpacing();
  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0"
      style={{ bottom: offset, paddingTop: GRADIENT_LEAD, paddingBottom, paddingHorizontal }}
      onLayout={(event: LayoutChangeEvent) => onHeight(event.nativeEvent.layout.height)}
    >
      <InkGradient />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Button label="Buy" onPress={onBuy} />
        </View>
        <View className="flex-1">
          <Button label="Sell" variant="sell" onPress={onSell} />
        </View>
      </View>
    </View>
  );
}
