import { useContext, useEffect, useRef, useState } from "react";
import { View, Pressable, type LayoutRectangle } from "react-native";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { House, PieChart, ArrowLeftRight, Settings, type LucideIcon } from "lucide-react-native";
import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import colors from "@/theme/colors.json";
const icons = { Home: House, Vaults: PieChart, Exchange: ArrowLeftRight, Settings };
const spring = {
  damping: 24,
  stiffness: 300,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

function TabIcon({ icon: Icon, selected }: { icon: LucideIcon; selected: boolean }) {
  const scale = useSharedValue(1);
  const wasSelected = useRef(selected);
  useEffect(() => {
    // Selection comes from navigation, never from the press before it is accepted.
    if (selected && !wasSelected.current) {
      scale.value = withSequence(
        ReduceMotion.System,
        withTiming(1.14, { duration: 100, reduceMotion: ReduceMotion.System }),
        withSpring(1, spring),
      );
    } else if (!selected) {
      scale.value = withTiming(1, { duration: 90, reduceMotion: ReduceMotion.System });
    }
    wasSelected.current = selected;
    return () => cancelAnimation(scale);
  }, [selected, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={style}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon
        size={22}
        color={selected ? colors.ink : colors.muted}
        strokeWidth={selected ? 2.4 : 1.8}
      />
    </Animated.View>
  );
}

export function FloatingTabs({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const [layouts, setLayouts] = useState<Record<string, LayoutRectangle>>({});
  const selectedKey = state.routes[state.index]!.key;
  const bounds = layouts[selectedKey];
  const previousKey = useRef<string | null>(null);
  const previousBounds = useRef<LayoutRectangle | null>(null);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  const outgoing = useSharedValue({ x: 0, y: 0, width: 0, height: 0 });
  const outgoingOpacity = useSharedValue(0);
  useEffect(() => {
    if (!bounds) return;
    const switched = previousKey.current !== null && previousKey.current !== selectedKey;
    // A single outgoing layer is replaced on interruption, never queued.
    cancelAnimation(opacity);
    cancelAnimation(outgoingOpacity);
    if (switched && previousBounds.current) {
      outgoing.value = previousBounds.current;
      outgoingOpacity.value = 1;
      outgoingOpacity.value = withTiming(0, { duration: 150, reduceMotion: ReduceMotion.System });
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: 180, reduceMotion: ReduceMotion.System });
    } else {
      // Mount/relayout has no entrance animation or leftover highlight.
      opacity.value = 1;
      outgoingOpacity.value = 0;
    }
    // Initial measurement and geometry changes snap; only navigation slides.
    x.value = switched ? withSpring(bounds.x, spring) : bounds.x;
    y.value = switched ? withSpring(bounds.y, spring) : bounds.y;
    previousKey.current = selectedKey;
    previousBounds.current = bounds;
  }, [bounds, selectedKey, x, y, opacity, outgoing, outgoingOpacity]);
  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));
  const outgoingStyle = useAnimatedStyle(() => ({
    opacity: outgoingOpacity.value,
    width: outgoing.value.width,
    height: outgoing.value.height,
    transform: [{ translateX: outgoing.value.x }, { translateY: outgoing.value.y }],
  }));
  return (
    <View
      pointerEvents="box-none"
      onLayout={({ nativeEvent }) => reportHeight?.(nativeEvent.layout.height)}
      className="absolute inset-x-0 bottom-0 bg-transparent pt-3"
      style={{
        paddingBottom: Math.max(insets.bottom, 12),
        paddingHorizontal: Math.max(insets.left, insets.right, 20),
      }}
    >
      <View className="self-center rounded-full border border-border bg-surface p-2.5">
        {/* Keep measured tabs and absolute circles in the same border-free coordinates. */}
        <View className="relative flex-row gap-1">
          {bounds && (
            <>
              <Animated.View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="absolute left-0 top-0 rounded-full bg-accent"
                style={outgoingStyle}
              />
              <Animated.View
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="absolute left-0 top-0 rounded-full bg-accent"
                style={[{ width: bounds.width, height: bounds.height }, indicatorStyle]}
              />
            </>
          )}
          {state.routes.map((route, index) => {
            const selected = state.index === index;
            const Icon = icons[route.name as keyof typeof icons];
            return (
              <Pressable
                key={route.key}
                onLayout={({ nativeEvent: { layout } }) => {
                  // Keep the full touch target; center a circle inside its measured bounds.
                  const diameter = Math.min(layout.width, layout.height);
                  const circle = {
                    x: layout.x + (layout.width - diameter) / 2,
                    y: layout.y + (layout.height - diameter) / 2,
                    width: diameter,
                    height: diameter,
                  };
                  setLayouts((current) => {
                    const previous = current[route.key];
                    return previous &&
                      previous.x === circle.x &&
                      previous.y === circle.y &&
                      previous.width === circle.width &&
                      previous.height === circle.height
                      ? current
                      : { ...current, [route.key]: circle };
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  descriptors[route.key]!.options.tabBarAccessibilityLabel ?? `${route.name} tab`
                }
                accessibilityState={{ selected }}
                onPress={() => {
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!selected && !event.defaultPrevented)
                    navigation.navigate(route.name, route.params);
                }}
                onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
                className="h-12 w-14 items-center justify-center rounded-full"
              >
                <TabIcon icon={Icon} selected={selected} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
