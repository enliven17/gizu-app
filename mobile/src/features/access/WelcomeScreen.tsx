import { Pressable, View, type TextStyle } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowRight } from "lucide-react-native";
import { useSession } from "@/application/SessionProvider";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { Typography } from "@/components/atoms/Typography";
import type { RootStackParamList } from "@/navigation/types";
import colors from "@/theme/colors.json";
import { BubbleUpButton } from "./components/BubbleUpButton";
import { Reveal } from "./components/Reveal";
import { WelcomeBackdrop } from "./components/WelcomeBackdrop";
import { WelcomeHeading } from "./components/WelcomeHeading";
import { tracking } from "./components/tracking";
import { useWelcomeMotion } from "./useWelcomeMotion";

// Frontend: logo `h-7`, wordmark `text-[16px] font-medium tracking-tight`,
// tagline `text-[15px] leading-relaxed text-white/45`.
const LOGO_HEIGHT = 28;
const wordmark: TextStyle = {
  fontSize: 16,
  lineHeight: 20,
  fontWeight: "500",
  letterSpacing: tracking(-0.16),
};
// Secondary text action: sentence case, normal tracking (owner decision over the
// frontend uppercase mono link).
const link: TextStyle = { fontSize: 13, lineHeight: 18, fontWeight: "500", color: colors.fg["55"] };
const tagline: TextStyle = { fontSize: 15, lineHeight: 24, color: colors.fg["45"] };

/**
 * Frontend Onboarding. Welcome is a fixed, full-bleed screen with no keyboard or tab
 * bar, so it owns its safe-area padding instead of the opaque Screen template.
 */
export function WelcomeScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Welcome">) {
  const native = useSession().accessService.method === "Passkey";
  const animate = useWelcomeMotion();
  return (
    <View className="flex-1 bg-ink">
      <WelcomeBackdrop paused={!animate} />
      <View className="flex-1 pb-safe pl-safe pr-safe pt-safe">
        <View className="flex-1 px-6 pb-6 pt-6">
          <Reveal offset={-8} className="flex-row items-center gap-2.5">
            <GizuLogo width={(LOGO_HEIGHT * 638) / 866} height={LOGO_HEIGHT} />
            <Typography variant="row" style={wordmark}>
              Gizu
            </Typography>
          </Reveal>
          <View className="mt-auto">
            <WelcomeHeading animate={animate} />
            <Reveal delay={1500} duration={300} offset={0}>
              <Typography className="mt-6 max-w-[310px]" style={tagline}>
                {native
                  ? "Your passkey wallet on Monad testnet. Test tokens only."
                  : "Explore curated confidential vaults and investment strategies."}
              </Typography>
            </Reveal>
          </View>
          <View className="mt-10">
            <Reveal delay={1700} offset={20}>
              <BubbleUpButton
                label="Get started"
                icon={ArrowRight}
                onPress={() => navigation.navigate("Access")}
              />
            </Reveal>
            {!native && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Request access"
                onPress={() => navigation.navigate("RequestAccess")}
                className="mt-3 min-h-11 items-center justify-center active:opacity-60"
              >
                <Typography style={link}>Request access</Typography>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
