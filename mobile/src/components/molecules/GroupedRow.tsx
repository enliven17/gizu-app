import { View } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";
export function GroupedRow({
  label,
  value,
  detail,
  onPress,
  accessibilityLabel,
  disabled = false,
  icon: Icon,
  last = false,
}: {
  label: string;
  value?: string;
  detail?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  icon?: LucideIcon;
  /** Last row of a group: no bottom divider. */
  last?: boolean;
}) {
  // Frontend: rows inside `glass divide-y divide-white/5`, 14px titles, faint mono details.
  const content = (
    <View
      className={`min-h-14 flex-row flex-wrap items-center gap-3 px-5 py-4 ${last ? "" : "border-b border-divider"}`}
    >
      {Icon && <Icon size={18} color={colors.fg["45"]} />}
      <View className="min-w-0 flex-1 gap-1">
        <Typography variant="rowTitle">{label}</Typography>
        {detail && <Typography variant="micro">{detail}</Typography>}
      </View>
      {value && (
        <View className="max-w-full shrink">
          <Typography variant="rowValue" className="!text-fg-70">
            {value}
          </Typography>
        </View>
      )}
      {onPress && <ChevronRight size={16} color={colors.fg["35"]} />}
    </View>
  );
  return onPress ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      pressedScale={0.99}
      className={disabled ? "opacity-50" : undefined}
    >
      {content}
    </PressableScale>
  ) : (
    content
  );
}
