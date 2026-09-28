import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  PixelRatio,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { reduceMotion } from "@/theme/motion";

// Port of the web GradientWaves fragment shader (same raymarch, same constants).
const source: SkRuntimeEffect | null = Skia.RuntimeEffect.Make(`
uniform float2 uResolution;
uniform float uTime;
uniform float3 uHorizon;
uniform float3 uWave;
uniform float3 uCrest;

const float SPEED = 0.22;
const float AMPLITUDE = 1.9;
const float WAVE_SCALE = 0.45;
const float WAVE_RATIO = 0.9;
const float SWELL = 26.0;
const float TURBULENCE = 11.0;
const float TILT = 1.11;
const float HEIGHT = 5.5;
const float FOG_DEPTH = 18.0;
const float STEPS = 70.0;
const float MAX_DIST = 20000.0;

float plasma(float3 r, float2 freq, float4 tc) {
  float mx = r.x + tc.x;
  mx += SWELL * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += TURBULENCE * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * AMPLITUDE + sin(my * freq.y) * AMPLITUDE + HEIGHT);
}

half4 main(float2 fragCoord) {
  float T = uTime * SPEED;
  float2 freq = float2(WAVE_SCALE / 7.0, (WAVE_SCALE * WAVE_RATIO) / 3.0);
  float4 tc = float4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);

  float vfov = 3.14159 / 2.3;
  float3 cam = float3(0.0, 0.0, 30.0);

  float2 uv = float2(fragCoord.x / uResolution.x, 1.0 - fragCoord.y / uResolution.y) - 0.5;
  uv.x *= uResolution.x / uResolution.y;
  uv.y *= -1.0;

  float3 dir = float3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  float c = cos(xrot);
  float s = sin(xrot);
  dir = float3x3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;

  float2 nuv = ulen > 1e-5 ? uv / ulen : float2(1.0, 0.0);
  c = nuv.x;
  s = nuv.y;
  dir = float3x3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;

  c = cos(TILT);
  s = sin(TILT);
  dir = float3x3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  float dist = 0.0;
  for (int i = 0; i < 70; i++) {
    if (float(i) >= STEPS) break;
    float dscene = plasma(cam + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) {
      dist = MAX_DIST;
      break;
    }
  }

  float3 pos = cam + dist * dir;
  float t = clamp(FOG_DEPTH / max(dist, 0.001), 0.0, 1.0);
  float3 body = mix(uWave, uCrest, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  float3 col = clamp(mix(uHorizon, body, t), 0.0, 1.0);
  float alpha = clamp(t, 0.0, 1.0);
  return half4(half3(col * alpha), half(alpha));
}
`);

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  const [, r, g, b] = m;
  return [
    parseInt(r ?? "ff", 16) / 255,
    parseInt(g ?? "ff", 16) / 255,
    parseInt(b ?? "ff", 16) / 255,
  ];
};

const HORIZON = rgb("#070d0a");
const WAVE = rgb("#2aa471");
const CREST = rgb("#5fe0a6");

/** Frontend GradientWaves caps the drawing buffer at 1.5x device pixels. */
const MAX_PIXEL_RATIO = 1.5;
/** Frame shown under reduced motion. */
const STATIC_TIME = 9.5;
/** Time ping-pongs over this span so float precision stays bounded in the shader. */
const LOOP_SECONDS = 3600;

type Size = { width: number; height: number };

type WaveBackdropProps = {
  /** Fixed height; ignored when `fill` is set. */
  height?: number;
  /** Fill the parent absolutely (full-screen backdrops). */
  fill?: boolean;
  /** Pause motion, e.g. while the owning screen is unfocused. The last frame stays. */
  paused?: boolean;
  testID?: string;
};

function useReducedMotionPreference() {
  // Assume reduced until the OS answers so motion never flashes on.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let mounted = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      setReduced(value);
    });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted && !changed) setReduced(value);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return active;
}

/**
 * Same wave field as the web onboarding screen. The shader renders into a smaller
 * canvas that is scaled up, keeping the work near 1.5 device pixels per point like the
 * frontend. Motion stops while paused or backgrounded; reduced motion shows a still
 * frame. Falls back to a flat ink panel when the runtime effect is unavailable.
 */
export function WaveBackdrop({
  height = 220,
  fill = false,
  paused = false,
  testID = "gizu-wave-backdrop",
}: WaveBackdropProps) {
  const reduced = useReducedMotionPreference();
  const appActive = useAppActive();
  const running = !paused && appActive && !reduced;
  const time = useSharedValue(STATIC_TIME);
  const [size, setSize] = useState<Size | null>(null);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height: measured } = event.nativeEvent.layout;
    setSize({ width, height: measured });
  }, []);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(time);
      time.set(STATIC_TIME);
      return undefined;
    }
    if (!running) {
      // Cancelling keeps the current value, so resuming continues from this frame.
      cancelAnimation(time);
      return undefined;
    }
    const from = time.get();
    time.set(
      withRepeat(
        withTiming(from + LOOP_SECONDS, {
          duration: LOOP_SECONDS * 1000,
          easing: Easing.linear,
          reduceMotion,
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(time);
  }, [reduced, running, time]);

  // Render at reduced resolution and scale the canvas up to the measured box.
  const scale = Math.max(1, PixelRatio.get() / MAX_PIXEL_RATIO);
  const canvasWidth = (size?.width ?? 1) / scale;
  const canvasHeight = (size?.height ?? 1) / scale;
  const uniforms = useDerivedValue(
    () => ({
      uResolution: [canvasWidth, canvasHeight],
      uTime: time.get(),
      uHorizon: HORIZON,
      uWave: WAVE,
      uCrest: CREST,
    }),
    [canvasWidth, canvasHeight],
  );

  const box = fill ? StyleSheet.absoluteFill : { height };
  if (!source) {
    return <View testID={testID} className="bg-ink" style={box} />;
  }

  return (
    <View
      testID={testID}
      style={box}
      className="overflow-hidden"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayout}
    >
      {size && (
        <Canvas
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: canvasWidth,
            height: canvasHeight,
            transformOrigin: [0, 0, 0],
            transform: [{ scale }],
          }}
        >
          <Fill>
            <Shader source={source} uniforms={uniforms} />
          </Fill>
        </Canvas>
      )}
    </View>
  );
}
