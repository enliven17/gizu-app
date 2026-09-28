import { useId, useMemo } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { areaPath, plotSeries, smoothPath } from "@/components/molecules/chart/path";
import {
  chartColors,
  chartStroke,
  fillOpacity,
  sparkPad,
  svgId,
} from "@/components/molecules/chart/tokens";

// Fluid sparkline (frontend `fluid`): a fixed-width viewBox stretched to the container.
const W = 300;

export function Sparkline({
  series,
  negative = false,
  height = 48,
}: {
  series: number[];
  negative?: boolean;
  height?: number;
}) {
  const fillId = svgId(negative ? "spark-down" : "spark-up", useId());
  const paths = useMemo(() => {
    if (series.length < 2) return null;
    const line = smoothPath(plotSeries(series, W, height, sparkPad).points);
    return { line, area: areaPath(line, W, height) };
  }, [series, height]);
  if (!paths) return null;
  const color = negative ? chartColors.down : chartColors.up;
  return (
    <Svg
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      testID="sparkline"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity={fillOpacity.spark} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={paths.area} fill={`url(#${fillId})`} />
      <Path
        d={paths.line}
        fill="none"
        stroke={color}
        strokeWidth={chartStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </Svg>
  );
}
