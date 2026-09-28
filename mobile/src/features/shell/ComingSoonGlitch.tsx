import { useEffect } from "react";
import { View } from "react-native";
import LottieView from "lottie-react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Typography } from "@/components/atoms/Typography";
import { comingSoonGlitch } from "@/animations/comingSoonGlitch";
const AnimatedLottie = Animated.createAnimatedComponent(LottieView);
const bands = [
  { top: 0.22, height: 0.2, direction: 1, color: "#29e7df" },
  { top: 0.46, height: 0.18, direction: -1, color: "#e575c9" },
  { top: 0.7, height: 0.15, direction: 1, color: "#b1ffd0" },
];

function Slice({
  progress,
  width,
  size,
  lineHeight,
  band,
}: {
  progress: SharedValue<number>;
  width: number;
  size: number;
  lineHeight: number;
  band: (typeof bands)[number];
}) {
  const top = lineHeight * band.top;
  const visibility = useAnimatedStyle(() => {
    const frame = progress.value * 150;
    const active = (frame >= 21 && frame < 33) || (frame >= 78 && frame < 90);
    return { opacity: active ? 1 : 0 };
  });
  const tear = useAnimatedStyle(() => {
    const frame = progress.value * 150;
    const phase = frame < 78 ? frame - 21 : frame - 78;
    const offset = phase < 4 ? 8 : phase < 8 ? -6 : 3;
    return { transform: [{ translateX: offset * band.direction }] };
  });
  return (
    <Animated.View
      className="absolute left-0 overflow-hidden bg-ink"
      style={[
        {
          top,
          width,
          height: lineHeight * band.height,
        },
        visibility,
      ]}
    >
      <Animated.View className="absolute" style={[{ top: -top, width }, tear]}>
        <Typography
          variant="title"
          className="text-center !text-accent"
          style={{
            fontSize: size,
            lineHeight,
            textShadowColor: band.color,
            textShadowOffset: { width: -3 * band.direction, height: 0 },
            textShadowRadius: 0,
          }}
        >
          coming soon
        </Typography>
      </Animated.View>
    </Animated.View>
  );
}

// One native-driven clock keeps the letter tears and Lottie fragments in phase.
export function ComingSoonGlitch({
  width,
  size,
  onFailure,
}: {
  width: number;
  size: number;
  onFailure: () => void;
}) {
  const progress = useSharedValue(0);
  const lineHeight = Math.ceil(size * 1.25);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 5000, easing: Easing.linear, reduceMotion: ReduceMotion.System }),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(progress);
  }, [progress]);
  const animatedProps = useAnimatedProps(() => ({ progress: progress.value }));
  return (
    <View className="absolute left-0 top-0" style={{ width, height: lineHeight }}>
      {bands.map((band) => (
        <Slice
          key={band.top}
          progress={progress}
          width={width}
          size={size}
          lineHeight={lineHeight}
          band={band}
        />
      ))}
      <AnimatedLottie
        source={comingSoonGlitch}
        animatedProps={animatedProps}
        autoPlay={false}
        loop={false}
        resizeMode="contain"
        onAnimationFailure={onFailure}
        style={{ width, height: lineHeight }}
      />
    </View>
  );
}
