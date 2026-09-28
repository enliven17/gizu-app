import { Text, View, useWindowDimensions } from "react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import type { NotificationItem } from "@/services/notifications";

const tags: Record<NotificationItem["category"], string> = {
  order: "Order",
  vault: "Vault",
  report: "Report",
  security: "Security",
};

type Props = {
  item: NotificationItem;
  open: boolean;
  disabled: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onClose: () => void;
};

// Frontend Notifications card: glass panel, unread dot, title/time, one-line body, tag pill.
export function NotificationCard({ item, open, disabled, onOpen, onToggleRead, onClose }: Props) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <View className="overflow-hidden rounded-card border border-glassBorder bg-glass">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.read ? "read" : "unread"}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={onOpen}
        pressedScale={0.99}
        className="flex-row items-start gap-4 p-5"
      >
        <View className={`mt-1.5 h-2 w-2 rounded-full ${item.read ? "bg-fg-20" : "bg-neon"}`} />
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Typography variant="rowTitle" className="min-w-0 shrink !text-[15px]">
              {item.title}
            </Typography>
            <Typography
              variant="micro"
              className="!text-fg-35"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {item.time}
            </Typography>
          </View>
          {!open && (
            <Typography
              variant="rowValue"
              className="mt-1 !text-[13px] !text-fg-45"
              numberOfLines={1}
            >
              {item.body}
            </Typography>
          )}
          <View className="mt-2 self-start rounded-full bg-glassSoft px-2.5 py-1">
            <Text key={fontScale} className="font-sans text-[11px] text-fg-45">
              {tags[item.category]}
            </Text>
          </View>
        </View>
      </PressableScale>
      {open && (
        // Full text sits outside the row button so screen readers can reach it.
        <View className="gap-2 border-t border-divider px-5 pb-2 pt-4">
          <Typography variant="rowValue" className="!text-[13px] leading-5 !text-fg-70">
            {item.body}
          </Typography>
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button
              label={item.read ? "Mark as unread" : "Mark as read"}
              variant="quiet"
              disabled={disabled}
              onPress={onToggleRead}
            />
            <Button
              label="Close"
              accessibilityLabel="Close notification"
              variant="quiet"
              onPress={onClose}
            />
          </View>
        </View>
      )}
    </View>
  );
}
