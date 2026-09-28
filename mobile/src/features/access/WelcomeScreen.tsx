import { useSession } from "@/application/SessionProvider";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { WelcomeHeading } from "./components/WelcomeHeading";
import { useWelcomeMotion } from "./useWelcomeMotion";
import { View, useWindowDimensions } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { WelcomeArtwork } from "./components/WelcomeArtwork";
import type { RootStackParamList } from "@/navigation/types";
export function WelcomeScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Welcome">) {
  const native = useSession().accessService.method === "Passkey";
  const animate = useWelcomeMotion();
  const { fontScale } = useWindowDimensions();
  return (
    <Screen scrollable={false}>
      <View className="flex-row items-center gap-3">
        <GizuLogo />
        <Typography variant="row">Gizu</Typography>
      </View>
      <View className="flex-1 justify-center gap-6">
        {fontScale <= 1.3 && <WelcomeArtwork animate={animate} />}
        <View className="gap-4">
          <WelcomeHeading animate={animate} />
          <Typography>
            {native
              ? "Your passkey wallet on Monad testnet. Test tokens only."
              : "Explore curated confidential vaults and investment strategies."}
          </Typography>
        </View>
      </View>
      <View className="gap-3">
        <Button label="Get started" onPress={() => navigation.navigate("Access")} />
        {!native && (
          <Button
            label="Request access"
            variant="quiet"
            onPress={() => navigation.navigate("RequestAccess")}
          />
        )}
      </View>
    </Screen>
  );
}
