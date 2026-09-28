import { useState } from "react";
import { Pressable, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import colors from "@/theme/colors.json";
import { springs } from "@/theme/motion";

type Box = { width: number; height: number };

export type BubbleUpButtonProps = {
  label: string;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
};

/**
 * Port of the frontend BubbleUpButton: a neon fill rises from the bottom edge while
 * pressed and drains out through the top on release (300/32 spring). The springs
 * follow the system reduced-motion preference, so the fill then snaps.
 */
export function BubbleUpButton({
  label,
  onPress,
  icon: Icon,
  disabled = false,
}: BubbleUpButtonProps) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  const [box, setBox] = useState<Box | null>(null);
  const [filled, setFilled] = useState(false);
  const grow = useSharedValue(0);
  const rise = useSharedValue(0);
  const held = useSharedValue(false);

  // A circle centred on the bottom edge that covers both top corners when fully grown.
  const diameter = box ? 2.2 * Math.hypot(box.width / 2, box.height) : 0;
  const travel = box ? box.height + diameter / 2 : 0;
  const bubble = useAnimatedStyle(() => ({
    transform: [{ translateY: -rise.get() * travel }, { scale: grow.get() }],
  }));

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) =>
    setBox({ width: nativeEvent.layout.width, height: nativeEvent.layout.height });

  const fill = () => {
    held.set(true);
    setFilled(true);
    rise.set(0);
    grow.set(withSpring(1, springs.bubble));
  };
  const drain = () => {
    held.set(false);
    setFilled(false);
    rise.set(
      withSpring(1, springs.bubble, (finished) => {
        if (finished && !held.get()) {
          grow.set(0);
          rise.set(0);
        }
      }),
    );
  };

  const foreground = filled ? colors.ctaText : colors.neon.DEFAULT;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={fill}
      onPressOut={drain}
      onLayout={onLayout}
      className={`min-h-16 w-full flex-row items-center justify-center gap-2 overflow-hidden rounded-3xl border border-neon/25 bg-glassSoft px-5 py-4 ${disabled ? "opacity-50" : ""}`}
    >
      {box && (
        <Animated.View
          pointerEvents="none"
          className="absolute rounded-full bg-neon"
          style={[
            {
              width: diameter,
              height: diameter,
              left: (box.width - diameter) / 2,
              top: box.height - diameter / 2,
            },
            bubble,
          ]}
        />
      )}
      <View className="shrink flex-row items-center gap-2">
        <Text
          key={fontScale}
          className="font-sans shrink text-center text-[15px] font-semibold"
          style={{ color: foreground }}
        >
          {label}
        </Text>
        {Icon && <Icon size={18} strokeWidth={2.6} color={foreground} />}
      </View>
    </Pressable>
  );
}
