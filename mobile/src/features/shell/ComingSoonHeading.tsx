import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { ComingSoonGlitch } from "./ComingSoonGlitch";
import { Typography } from "@/components/atoms/Typography";

export function ComingSoonHeading() {
  const { fontScale } = useWindowDimensions();
  const [animationWidth, setAnimationWidth] = useState(0);
  const focused = useIsFocused();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    let changed = false;
    const preference = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      setReduceMotion(value);
    });
    const appState = AppState.addEventListener("change", (value) =>
      setForeground(value === "active"),
    );
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (current && !changed) setReduceMotion(value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      preference.remove();
      appState.remove();
    };
  }, []);
  // Measure the NativeWind-sized canvas to keep text and glitch slices aligned.
  const size = animationWidth > 0 ? Math.min(48, animationWidth / 6.4) : 48;
  // Native text preserves Dynamic Type; only normal-size display text is animated.
  const animate = focused && foreground && !reduceMotion && !failed && fontScale <= 1.2;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="Swap coming soon"
      className="w-full items-center"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        className="w-full max-w-[360px] items-center"
        onLayout={({ nativeEvent }) => setAnimationWidth(nativeEvent.layout.width)}
      >
        <Typography
          variant="title"
          className="text-center"
          style={{ fontSize: size, lineHeight: Math.ceil(size * 1.25) }}
        >
          Swap
        </Typography>
        <View style={{ minHeight: Math.ceil(size * 1.25) }} className="w-full justify-center">
          <Typography
            variant="title"
            className="text-center !text-accent"
            style={{
              fontSize: size,
              lineHeight: Math.ceil(size * 1.25),
            }}
          >
            coming soon
          </Typography>
          {animate && animationWidth > 0 && (
            <ComingSoonGlitch
              width={animationWidth}
              size={size}
              onFailure={() => setFailed(true)}
            />
          )}
        </View>
      </View>
    </View>
  );
}
