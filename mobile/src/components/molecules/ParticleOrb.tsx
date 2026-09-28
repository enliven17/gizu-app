import { useEffect, useMemo, useState } from "react";
import { AppState, PixelRatio, View, type StyleProp, type ViewStyle } from "react-native";
import {
  Atlas,
  Canvas,
  FilterMode,
  MipmapMode,
  Skia,
  TileMode,
  useRSXformBuffer,
  type SkColor,
  type SkImage,
} from "@shopify/react-native-skia";
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import colors from "@/theme/colors.json";

// Frontend ParticleDotOrb (three.js points + shader) ported to one Skia Atlas draw.
const RADIUS = 1.15;
const FOV_TAN = Math.tan((35 * Math.PI) / 360); // PerspectiveCamera(35°), half angle
const ROTATION_SPEED = 0.21; // web: 0.0035 rad per 60Hz frame
const MAX_DT = 0.05;
const BURST_OUT = 1.5;
const BURST_BACK = 0.55;
const WOBBLE = 0.05;
const SPRITE = 32;
const DPR = Math.min(PixelRatio.get(), 2.5);
const STATIC_ROTATION = 0.6;

type OrbData = {
  /** base position, normal, burst direction and noise phases, 13 numbers per dot */
  dots: number[];
  /** per-dot colour: accent with the web depth alpha baked in */
  tints: SkColor[];
  count: number;
};

// Deterministic PRNG so layouts are stable between renders and runs.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, x: number) {
  "worklet";
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Fibonacci sphere; directions jitter the normal like the web orb.
function buildOrb(count: number, color: string): OrbData {
  const rand = random(7);
  const phi = Math.PI * (3 - Math.sqrt(5));
  const base = Skia.Color(color);
  const dots: number[] = [];
  const tints: SkColor[] = [];
  for (let i = 0; i < count; i++) {
    const ny = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(1 - ny * ny);
    const nx = Math.cos(phi * i) * ring;
    const nz = Math.sin(phi * i) * ring;
    const jx = nx + (rand() - 0.5) * 0.45;
    const jy = ny + (rand() - 0.5) * 0.45;
    const jz = nz + (rand() - 0.5) * 0.45;
    const len = Math.hypot(jx, jy, jz) || 1;
    const spread = 0.6 + rand() * 0.8;
    const size = 0.85 + rand() * 0.5;
    // Three fixed wave directions over the normal stand in for the web simplex field;
    // the y term drifts them over time like `norm * 1.6 + vec3(0, t * 0.4, 0)`.
    const p1 = 1.6 * (1.9 * nx + 0.7 * ny + 1.1 * nz);
    const p2 = 1.6 * (-1.3 * nx + 1.7 * ny + 0.6 * nz);
    const p3 = 1.6 * (0.4 * nx - 1.2 * ny + 2.1 * nz);
    dots.push(nx, ny, nz, (jx / len) * spread, (jy / len) * spread, (jz / len) * spread);
    dots.push(size, p1, p2, p3, 0.7, 1.7, -1.2);
    // Web: smoothstep(-1.1, 1.0, norm.z) * 0.72 + 0.28, in object space.
    const alpha = smoothstep(-1.1, 1, nz) * 0.72 + 0.28;
    tints.push(Float32Array.of(base[0] ?? 0, base[1] ?? 0, base[2] ?? 0, alpha));
  }
  return { dots, tints, count };
}

let sprite: SkImage | null | undefined;
// Soft round dot: web fragment `smoothstep(0.5, 0.18, dist)`, drawn once and shared.
function dotSprite(): SkImage | null {
  if (sprite !== undefined) return sprite;
  const surface = Skia.Surface.Make(SPRITE, SPRITE);
  if (!surface) return (sprite = null);
  const half = SPRITE / 2;
  const stops = [0, 0.36, 0.52, 0.68, 0.84, 1];
  const shader = Skia.Shader.MakeRadialGradient(
    { x: half, y: half },
    half,
    stops.map((r) => Float32Array.of(1, 1, 1, smoothstep(1, 0.36, r))),
    stops,
    TileMode.Clamp,
  );
  const paint = Skia.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawCircle(half, half, half, paint);
  surface.flush();
  sprite = surface.makeImageSnapshot();
  return sprite;
}

export type ParticleOrbProps = {
  /** scatter the dots outwards (1.5s ease-out), false gathers them back (0.55s) */
  burst?: boolean;
  /** fixed square size; omit to fill the parent */
  size?: number;
  color?: string;
  count?: number;
  /** camera distance, larger renders a smaller orb */
  distance?: number;
  /** how far dots fly on burst */
  spread?: number;
  /** dot size multiplier */
  dotScale?: number;
  /** noise speed multiplier */
  speed?: number;
  /** stops the frame loop, e.g. when the host screen is covered */
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

type Frame = {
  cx: number;
  cy: number;
  focal: number;
  cos: number;
  sin: number;
  burst: number;
  wave: number;
};

/**
 * Native port of the web ParticleDotOrb. Dot data is built once; a worklet writes
 * the per-frame transforms into a reused RSXform buffer drawn by a single Atlas.
 */
export function ParticleOrb({
  burst = false,
  size,
  color = colors.accent,
  count = 340,
  distance = 4.4,
  spread = 5,
  dotScale = 1,
  speed = 1,
  paused = false,
  style,
  testID = "gizu-particle-orb",
}: ParticleOrbProps) {
  const { dots, tints } = useMemo(() => buildOrb(count, color), [count, color]);
  const image = useMemo(() => dotSprite(), []);
  const reduceMotion = useReducedMotion();
  const [appActive, setAppActive] = useState(AppState.currentState !== "background");

  const canvas = useSharedValue({ width: 0, height: 0 });
  const bursting = useSharedValue(burst);
  const clock = useSharedValue({ time: 0, rotation: STATIC_ROTATION, progress: burst ? 1 : 0 });

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) =>
      setAppActive(next === "active"),
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    bursting.set(burst);
    if (reduceMotion) clock.set((current) => ({ ...current, progress: burst ? 1 : 0 }));
  }, [burst, reduceMotion, bursting, clock]);

  const loop = useFrameCallback((info) => {
    "worklet";
    const current = clock.value;
    const out = bursting.value;
    // Fully scattered dots are invisible; stop writing so Skia stops redrawing.
    if (out && current.progress >= 1) return;
    const dt = Math.min((info.timeSincePreviousFrame ?? 16) / 1000, MAX_DT);
    const step = (out ? dt : -dt) / (out ? BURST_OUT : BURST_BACK);
    clock.set({
      time: current.time + dt * speed * 1.4,
      rotation: current.rotation + ROTATION_SPEED * dt,
      progress: Math.min(1, Math.max(0, current.progress + step)),
    });
  }, false);

  const running = !paused && appActive && !reduceMotion;
  useEffect(() => {
    loop.setActive(running);
    return () => loop.setActive(false);
  }, [loop, running]);

  const frame = useDerivedValue<Frame>(() => {
    const { time, rotation, progress: p } = clock.value;
    const { width, height } = canvas.value;
    // Web easing: cubic ease-out apart, smoothstep back together.
    const eased = bursting.value ? 1 - Math.pow(1 - p, 3) : p * p * (3 - 2 * p);
    return {
      cx: width / 2,
      cy: height / 2,
      focal: height / 2 / FOV_TAN,
      cos: Math.cos(rotation),
      sin: Math.sin(rotation),
      burst: eased,
      wave: time * 0.4,
    };
  });

  const opacity = useDerivedValue(() => 1 - smoothstep(0.35, 1, frame.value.burst));

  const transforms = useRSXformBuffer(count, (xf, i) => {
    "worklet";
    const f = frame.value;
    const o = i * 13;
    const nx = dots[o]!;
    const ny = dots[o + 1]!;
    const nz = dots[o + 2]!;
    const w = f.wave;
    const n =
      WOBBLE *
      (0.5 * Math.sin(dots[o + 7]! + dots[o + 10]! * w) +
        0.3 * Math.sin(dots[o + 8]! + dots[o + 11]! * w) +
        0.2 * Math.sin(dots[o + 9]! + dots[o + 12]! * w));
    const r = RADIUS + n;
    const fly = f.burst * spread;
    const x = nx * r + dots[o + 3]! * fly;
    const y = ny * r + dots[o + 4]! * fly;
    const z = nz * r + dots[o + 5]! * fly;
    // group.rotation.y, then the camera sits at +distance looking down -z.
    const rx = x * f.cos + z * f.sin;
    const rz = -x * f.sin + z * f.cos;
    const depth = distance - rz;
    if (depth < 0.1 || f.focal === 0) {
      xf.set(0, 0, -SPRITE, -SPRITE);
      return;
    }
    const diameter = (dots[o + 6]! * dotScale * (13.5 / depth) * (1 + f.burst * 0.6)) / DPR;
    const scale = diameter / SPRITE;
    xf.set(
      scale,
      0,
      f.cx + (rx / depth) * f.focal - diameter / 2,
      f.cy - (y / depth) * f.focal - diameter / 2,
    );
  });

  const sprites = useMemo(
    () => Array.from({ length: count }, () => Skia.XYWHRect(0, 0, SPRITE, SPRITE)),
    [count],
  );

  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[size === undefined ? { flex: 1 } : { width: size, height: size }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Canvas style={{ flex: 1 }} onSize={canvas}>
        <Atlas
          image={image}
          sprites={sprites}
          transforms={transforms}
          colors={tints}
          colorBlendMode="modulate"
          opacity={opacity}
          sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}
        />
      </Canvas>
    </View>
  );
}
