import { Text, View, useWindowDimensions } from "react-native";
import { Bell } from "lucide-react-native";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { PressableScale } from "@/components/atoms/PressableScale";
import { ScrambleText } from "@/components/atoms/ScrambleText";
import colors from "@/theme/colors.json";

type Props = {
  /** Account initials; the Gizu mark is shown when omitted. */
  initials?: string;
  /** Optional decorative scrambled eyebrow; its accessible name is the final text. */
  eyebrow?: string;
  greeting: string;
  notificationsLabel: string;
  onNotifications: () => void;
  notificationsDisabled?: boolean;
  unread?: number;
};

// Frontend Home header: glass initials tile, scrambled member line, 44px glass-soft bell.
export function PortfolioHeader({
  initials,
  eyebrow,
  greeting,
  notificationsLabel,
  onNotifications,
  notificationsDisabled = false,
  unread = 0,
}: Props) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        {initials === undefined ? (
          // Brand header: bare Gizu mark, no tile.
          <GizuLogo width={(32 * 638) / 866} height={32} />
        ) : (
          <View className="h-11 w-11 items-center justify-center rounded-2xl border border-cardEdge bg-card">
            <Text
              key={fontScale}
              className="font-sans text-sm text-neon"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {initials}
            </Text>
          </View>
        )}
        <View className="min-w-0 flex-1">
          {eyebrow !== undefined && <ScrambleText variant="eyebrow" text={eyebrow} />}
          <Text
            key={fontScale}
            className={`font-sans font-medium text-text ${initials === undefined ? "text-[26px] leading-[32px]" : "text-[15px]"}`}
          >
            {greeting}
          </Text>
        </View>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={notificationsLabel}
        accessibilityState={{ disabled: notificationsDisabled }}
        disabled={notificationsDisabled}
        onPress={onNotifications}
        hitSlop={4}
        className={`relative h-11 w-11 items-center justify-center rounded-2xl border border-borderSoft bg-glassSoft ${notificationsDisabled ? "opacity-50" : ""}`}
      >
        <Bell size={17} color={colors.fg["55"]} />
        {unread > 0 && (
          <View className="absolute right-3 top-3 h-1.5 w-1.5 rounded-full bg-neon/70" />
        )}
      </PressableScale>
    </View>
  );
}
