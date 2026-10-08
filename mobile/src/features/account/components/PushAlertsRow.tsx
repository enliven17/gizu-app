import { Switch, View } from "react-native";
import { Bell } from "lucide-react-native";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";
import { useAccount } from "../AccountProvider";

export function PushAlertsRow() {
  const { preferences, loading, busy, save } = useAccount();
  const disabled = loading || busy || !preferences;
  const enabled = preferences?.alerts ?? false;
  return (
    <View className="min-h-14 flex-row items-center gap-3 px-5 py-4">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-well">
        <Bell size={17} color={colors.fg["70"]} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Typography variant="rowTitle">Push alerts</Typography>
        <Typography variant="micro">
          Device preference only. Push delivery is not available yet.
        </Typography>
      </View>
      <Switch
        style={{ alignSelf: "center" }}
        accessible
        accessibilityRole="switch"
        accessibilityLabel="Receive push alerts"
        accessibilityHint="Saves a device preference; does not request system permission."
        accessibilityState={{ checked: enabled, disabled }}
        value={enabled}
        disabled={disabled}
        trackColor={{ false: colors.fg["20"], true: colors.neon.DEFAULT }}
        thumbColor={enabled ? colors.ink : colors.fg["85"]}
        ios_backgroundColor={colors.fg["20"]}
        onValueChange={(alerts) => void save({ alerts })}
      />
    </View>
  );
}
