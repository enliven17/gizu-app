import { useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Typography } from "@/components/atoms/Typography";

const bands = [
  { top: 10, height: 9, direction: 1 },
  { top: 22, height: 8, direction: -1 },
  { top: 33, height: 7, direction: 1 },
];
const textClassName = "leading-[45px] !text-accent";

function Tear({
  clock,
  width,
  band,
}: {
  clock: SharedValue<number>;
  width: number;
  band: (typeof bands)[number];
}) {
  const visibility = useAnimatedStyle(() => {
    const time = clock.value;
    const phase = time < 1 ? time - 0.55 : time - 7.65;
    return { opacity: phase >= 0 && phase < (time < 1 ? 0.36 : 0.24) ? 1 : 0 };
  });
  const displacement = useAnimatedStyle(() => {
    const time = clock.value;
    const phase = time < 1 ? time - 0.55 : time - 7.65;
    const amplitude = time < 1 ? 7 : 4;
    const offset = phase < 0.1 ? amplitude : phase < 0.2 ? -amplitude : 2;
    return { transform: [{ translateX: offset * band.direction }] };
  });
  return (
    <Animated.View
      className="absolute -left-2 overflow-hidden bg-ink"
      style={[
        {
          top: band.top,
          width: width + 16,
          height: band.height,
        },
        visibility,
      ]}
    >
      <Animated.View className="absolute left-2" style={[{ top: -band.top, width }, displacement]}>
        <Typography
          variant="title"
          className={textClassName}
          style={{
            textShadowColor: "#29e7df",
            textShadowOffset: { width: -3 * band.direction, height: 0 },
            textShadowRadius: 0,
          }}
        >
          Stealth
        </Typography>
      </Animated.View>
    </Animated.View>
  );
}

function StealthTears({ width }: { width: number }) {
  const clock = useSharedValue(0);
  useEffect(() => {
    clock.value = withSequence(
      ReduceMotion.System,
      withTiming(1, { duration: 1000, easing: Easing.linear }),
      withRepeat(
        withTiming(8, { duration: 7000, easing: Easing.linear }),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      ),
    );
    return () => cancelAnimation(clock);
  }, [clock]);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute left-0 top-0"
    >
      {bands.map((band) => (
        <Tear key={band.top} clock={clock} width={width} band={band} />
      ))}
    </View>
  );
}

export function WelcomeHeading({ animate }: { animate: boolean }) {
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // Preserve native text wrapping at large accessibility sizes.
  if (fontScale !== 1)
    return (
      <Typography variant="title">
        <Typography variant="title" className="!text-accent">
          DeFi
        </Typography>
        {" in\n"}
        <Typography variant="title" className="!text-accent">
          Stealth
        </Typography>
        {" Mode"}
      </Typography>
    );
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="DeFi in Stealth Mode">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Typography variant="title" className="leading-[45px]">
          <Typography variant="title" className="!text-accent">
            DeFi
          </Typography>
          {" in"}
        </Typography>
        <View className="flex-row flex-wrap items-baseline">
          <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            <Typography variant="title" className={textClassName}>
              Stealth
            </Typography>
            {animate && width > 0 && <StealthTears width={width} />}
          </View>
          <Typography variant="title" className="leading-[45px]">
            {" Mode"}
          </Typography>
        </View>
      </View>
    </View>
  );
}
