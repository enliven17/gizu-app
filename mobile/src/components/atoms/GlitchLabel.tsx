import { useEffect, useState, type ComponentProps } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import colors from "@/theme/colors.json";
import { Typography } from "./Typography";

/** One stepped slice: visible from `at` (0–1 of the cycle), clip insets as fractions. */
type Slice = { at: number; top: number; bottom: number; x: number; y: number };
type Layer = { color: string; opacity: number; duration: number; end: number; slices: Slice[] };

// Mirrors index.css `glitchTop` (3.2s) and `glitchBottom` (2.7s) keyframes.
const layers: Layer[] = [
  {
    color: colors.glitchTop,
    opacity: 0.85,
    duration: 3200,
    end: 0.97,
    slices: [
      { at: 0.86, top: 0, bottom: 0.62, x: -3, y: -1 },
      { at: 0.9, top: 0.22, bottom: 0.48, x: 3, y: 1 },
      { at: 0.94, top: 0.08, bottom: 0.76, x: -2, y: 0 },
    ],
  },
  {
    color: colors.glitchBottom,
    opacity: 0.7,
    duration: 2700,
    end: 1,
    slices: [
      { at: 0.9, top: 0.66, bottom: 0.08, x: 3, y: 1 },
      { at: 0.93, top: 0.48, bottom: 0.3, x: -3, y: -1 },
      { at: 0.97, top: 0.78, bottom: 0.04, x: 2, y: 0 },
    ],
  },
];

type TypographyProps = ComponentProps<typeof Typography>;

export type GlitchLabelProps = Omit<TypographyProps, "children"> & { text: string };

function activeSlice(slices: Slice[], end: number, progress: number): Slice | null {
  "worklet";
  if (progress >= end) return null;
  for (let index = slices.length - 1; index >= 0; index -= 1) {
    const slice = slices[index];
    if (slice && progress >= slice.at) return slice;
  }
  return null;
}

function GlitchCopy({
  layer,
  progress,
  height,
  typography,
  text,
}: {
  layer: Layer;
  progress: SharedValue<number>;
  height: number;
  typography: Omit<TypographyProps, "children">;
  text: string;
}) {
  const clip = useAnimatedStyle(() => {
    const slice = activeSlice(layer.slices, layer.end, progress.value);
    if (!slice) return { opacity: 0, top: 0, height: 0 };
    return {
      opacity: layer.opacity,
      top: slice.top * height,
      height: Math.max(0, (1 - slice.top - slice.bottom) * height),
      transform: [{ translateX: slice.x }, { translateY: slice.y }],
    };
  });
  const offset = useAnimatedStyle(() => {
    const slice = activeSlice(layer.slices, layer.end, progress.value);
    return { top: slice ? -slice.top * height : 0 };
  });
  return (
    <Animated.View className="absolute left-0 right-0 overflow-hidden" style={clip}>
      <Animated.View className="absolute left-0 right-0" style={offset}>
        <Typography {...typography} style={[typography.style, { color: layer.color }]}>
          {text}
        </Typography>
      </Animated.View>
    </Animated.View>
  );
}

function GlitchLayer({
  layer,
  height,
  typography,
  text,
}: {
  layer: Layer;
  height: number;
  typography: Omit<TypographyProps, "children">;
  text: string;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, {
        duration: layer.duration,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(progress);
  }, [layer.duration, progress]);
  return (
    <GlitchCopy
      layer={layer}
      progress={progress}
      height={height}
      typography={typography}
      text={text}
    />
  );
}

/** Port of the frontend `.glitch` text: two offset colour slices over static text. */
export function GlitchLabel({ text, ...typography }: GlitchLabelProps) {
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState(0);
  const copyProps = { ...typography, testID: undefined, accessibilityLabel: undefined };
  return (
    <View
      className="relative self-start"
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
    >
      <Typography {...typography} accessibilityLabel={typography.accessibilityLabel ?? text}>
        {text}
      </Typography>
      {!reduceMotion && height > 0 && (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute inset-0"
        >
          {layers.map((layer) => (
            <GlitchLayer
              key={layer.color}
              layer={layer}
              height={height}
              typography={copyProps}
              text={text}
            />
          ))}
        </View>
      )}
    </View>
  );
}
