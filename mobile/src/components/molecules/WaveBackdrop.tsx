import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, View, type LayoutChangeEvent } from "react-native";
import {
  Canvas,
  Fill,
  Shader,
  Skia,
  useClock,
  type SkRuntimeEffect,
} from "@shopify/react-native-skia";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";

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

type WaveBackdropProps = {
  height?: number;
  testID?: string;
};

/**
 * Same wave field as the web onboarding screen. Falls back to a flat ink panel
 * when the runtime effect is unavailable or the user asked for reduced motion.
 */
export function WaveBackdrop({ height = 220, testID = "gizu-wave-backdrop" }: WaveBackdropProps) {
  const reduceMotion = useSharedValue(false);
  const clock = useClock();
  const [size, setSize] = useState({ width: 1, height: 1 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height: measured } = event.nativeEvent.layout;
    setSize({ width, height: measured });
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) reduceMotion.value = enabled;
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      reduceMotion.value = enabled;
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [reduceMotion]);

  const uniforms = useDerivedValue(
    () => ({
      uResolution: [size.width, size.height],
      // Frozen frame keeps the artwork on screen without continuous motion.
      uTime: reduceMotion.value ? 9.5 : clock.value / 1000,
      uHorizon: HORIZON,
      uWave: WAVE,
      uCrest: CREST,
    }),
    [size],
  );

  if (!source) {
    return <View testID={testID} className="bg-ink" style={{ height }} />;
  }

  return (
    <View
      testID={testID}
      style={{ height }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayout}
    >
      <Canvas style={{ flex: 1 }}>
        <Fill>
          <Shader source={source} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}
