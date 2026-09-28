import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Screen } from "@/components/templates/Screen";
import { ComingSoonHeading } from "./ComingSoonHeading";

export function SwapComingSoonScreen() {
  return (
    <Screen scrollable={false}>
      <View className="flex-1 items-center justify-center gap-6 px-4">
        <ComingSoonHeading />
        <Typography className="text-center">
          In-app swaps are not available yet. Explore confidential vaults and your portfolio.
        </Typography>
      </View>
    </Screen>
  );
}
