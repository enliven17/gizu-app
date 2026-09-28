import { useEffect, useId, useState } from "react";
import { View } from "react-native";
import { Defs, LinearGradient, Stop } from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import colors from "@/theme/colors.json";

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

export function WelcomeArtwork({ animate }: { animate: boolean }) {
  // NativeWind owns the layout; measured height preserves the SVG aspect ratio.
  const [height, setHeight] = useState(0);
  const id = `welcome-${useId().replace(/:/g, "")}`;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = 0;
    if (animate)
      progress.value = withRepeat(
        withTiming(1, { duration: 5000, easing: Easing.linear, reduceMotion: ReduceMotion.System }),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      );
    return () => cancelAnimation(progress);
  }, [animate, progress]);
  const sweep = useAnimatedProps(() => {
    // A broad light band travels over the mark, leaving its silhouette visible.
    const center = -450 + progress.value * 1550;
    return { x1: center - 300, x2: center + 300 };
  });
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="hidden h-[25vh] max-h-[230px] items-center justify-center tall:flex"
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
    >
      <GizuLogo width={(height * 638) / 866} height={height} fill={`url(#${id})`}>
        <Defs>
          {animate ? (
            <AnimatedGradient
              id={id}
              gradientUnits="userSpaceOnUse"
              y1={0}
              y2={250}
              animatedProps={sweep}
            >
              <Stop offset="0" stopColor={colors.accent} stopOpacity={0.18} />
              <Stop offset="0.5" stopColor="#86efbe" stopOpacity={0.8} />
              <Stop offset="1" stopColor={colors.accent} stopOpacity={0.18} />
            </AnimatedGradient>
          ) : (
            <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0" stopColor={colors.accent} stopOpacity={0.55} />
              <Stop offset="1" stopColor={colors.accent} stopOpacity={0.18} />
            </LinearGradient>
          )}
        </Defs>
      </GizuLogo>
    </View>
  );
}
