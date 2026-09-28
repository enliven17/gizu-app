import { useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { FadeIn } from "@/components/molecules/FadeIn";
import { BackAction } from "@/navigation/BackAction";
import { sectionDelay } from "@/theme/motion";
import { useNotifications } from "./NotificationProvider";
import { MarkAllButton } from "./components/MarkAllButton";
import { NotificationCard } from "./components/NotificationCard";

/** Frontend Notifications list stagger: 0.04·i seconds per card. */
const cardStep = 40;

export function NotificationsScreen() {
  const { items, loading, busy, error, reload, mark, unread } = useNotifications();
  const [opened, setOpened] = useState<string | null>(null);
  const locked = loading || busy;
  return (
    <Screen>
      <View className="flex-row items-center justify-between gap-3">
        <BackAction fallback="Home" />
        <MarkAllButton
          disabled={locked || unread === 0}
          onPress={() =>
            void mark(
              items.filter((item) => !item.read).map((item) => item.id),
              true,
            )
          }
        />
      </View>
      <FadeIn delay={sectionDelay(0)} className="mt-4 gap-1">
        <Typography variant="pageTitle">Notifications</Typography>
        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <Typography variant="eyebrow" accessibilityLiveRegion="polite">
            {unread} unread
          </Typography>
          <Button
            label={error ? "Retry" : "Refresh"}
            accessibilityLabel={error ? "Retry notifications" : "Refresh notifications"}
            variant="quiet"
            disabled={locked}
            onPress={() => void reload()}
          />
        </View>
      </FadeIn>
      {loading && <Typography variant="micro">Loading notifications…</Typography>}
      {error && (
        <Typography variant="rowTitle" className="!text-danger" accessibilityRole="alert">
          {error}
        </Typography>
      )}
      {!loading && !error && items.length === 0 && (
        <Typography variant="rowValue" className="!text-fg-45">
          No notifications yet.
        </Typography>
      )}
      <View className="gap-2">
        {items.map((item, index) => (
          <FadeIn key={item.id} delay={sectionDelay(1) + index * cardStep}>
            <NotificationCard
              item={item}
              open={opened === item.id}
              disabled={locked}
              onOpen={() => {
                setOpened(item.id);
                if (!item.read) void mark([item.id], true);
              }}
              onToggleRead={() => void mark([item.id], !item.read)}
              onClose={() => setOpened(null)}
            />
          </FadeIn>
        ))}
      </View>
    </Screen>
  );
}
