import { View } from "react-native";
import Svg, { Line } from "react-native-svg";
import {
  chartColors,
  chartPad,
  chartStroke,
  gridDash,
  gridLines,
} from "@/components/molecules/chart/tokens";

const HEIGHT = 140;
const BASELINE = HEIGHT - chartPad;

/**
 * Home chart card for a wallet with no balance history: the frontend chart grid with a
 * flat neon line at zero. Nothing is plotted or invented; there is no visible caption.
 */
export function PerformanceUnavailable() {
  return (
    <View
      accessible
      accessibilityLabel="Performance chart, no history yet"
      className="overflow-hidden rounded-card border border-glassBorder bg-glass p-4"
    >
      <Svg width="100%" height={HEIGHT}>
        {gridLines.map((line) => (
          <Line
            key={line}
            x1="0"
            x2="100%"
            y1={HEIGHT * line}
            y2={HEIGHT * line}
            stroke={chartColors.grid}
            strokeDasharray={gridDash}
          />
        ))}
        <Line
          x1="0"
          x2="100%"
          y1={BASELINE}
          y2={BASELINE}
          stroke={chartColors.up}
          strokeWidth={chartStroke}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
