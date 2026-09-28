import { Linking, Text, useWindowDimensions } from "react-native";
import { ExternalLink } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import colors from "@/theme/colors.json";

/**
 * Frontend detail header `Deposit ↗` link: opens the protocol's own page in the browser.
 * It never signs or submits anything from this app.
 */
export function DepositLink({ url }: { url: string }) {
  // Remeasure native text after Dynamic Type changes.
  const { fontScale } = useWindowDimensions();
  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel="Open deposit page"
      accessibilityHint="Opens the protocol website in your browser"
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      hitSlop={4}
      className="h-11 flex-row items-center gap-2 rounded-2xl border border-borderSoft bg-glassSoft px-4"
    >
      <Text key={fontScale} className="font-sans text-[13px] text-fg-70">
        Deposit
      </Text>
      <ExternalLink size={14} color={colors.fg["55"]} />
    </PressableScale>
  );
}
