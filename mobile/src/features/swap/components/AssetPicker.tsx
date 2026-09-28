import { Text, View, useWindowDimensions } from "react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Sparkline } from "@/components/molecules/Sparkline";
import type { SwapAsset } from "@/domain/swap";

const tabular = { fontVariant: ["tabular-nums" as const] };
/** Sample prices have no history: a flat line rather than an invented trend. */
const flat = [0, 0];

function AssetTile({
  asset,
  selected,
  disabled,
  onPress,
}: {
  asset: SwapAsset;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  // Frontend vault chip: selected `bg-neon/10 text-neon`, otherwise `glass-soft`.
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={`${asset.symbol} · ${asset.name}`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-w-[96px] flex-1 gap-2 rounded-2xl border px-4 py-3 ${selected ? "border-neon/25 bg-neon/10" : "border-borderSoft bg-glassSoft"} ${disabled ? "opacity-50" : ""}`}
    >
      <View key={fontScale} className="flex-row items-baseline justify-between gap-2">
        <Text
          className={`font-sans text-[13px] font-semibold ${selected ? "text-neon" : "text-fg-70"}`}
        >
          {asset.symbol}
        </Text>
        <Text className="font-sans shrink text-[11px] text-fg-35" style={tabular}>
          {asset.price.toString()} USDG
        </Text>
      </View>
      <Sparkline series={flat} height={20} />
      <Text key={`n${fontScale}`} numberOfLines={1} className="font-sans text-[11px] text-fg-45">
        {asset.name}
      </Text>
    </PressableScale>
  );
}

/** Token to receive: glass tiles with ticker, sample price and sparkline. */
export function AssetPicker({
  assets,
  selected,
  disabled,
  onSelect,
}: {
  assets: readonly SwapAsset[];
  selected: string;
  disabled: boolean;
  onSelect: (symbol: string) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
      {assets.map((asset) => (
        <AssetTile
          key={asset.symbol}
          asset={asset}
          selected={selected === asset.symbol}
          disabled={disabled}
          onPress={() => onSelect(asset.symbol)}
        />
      ))}
    </View>
  );
}
