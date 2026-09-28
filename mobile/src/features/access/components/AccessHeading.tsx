import { View, type TextStyle } from "react-native";
import { GlitchLabel } from "@/components/atoms/GlitchLabel";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";
import { tracking } from "./tracking";

// Frontend Auth: `text-[34px] font-semibold leading-tight`, tracking -0.01em for the
// system font. Native styles so the title variant cannot override them and the glitch
// copies (which merge `style`) match.
const display: TextStyle = {
  fontSize: 34,
  lineHeight: 42,
  letterSpacing: tracking(-0.34),
  fontWeight: "600",
};
const lead: TextStyle = { ...display, color: colors.text };
const accentStyle: TextStyle = { ...display, color: colors.neon.DEFAULT };

/**
 * Frontend Auth heading: a glitching white first word, remaining white words and a
 * neon accent, read as one header. Every word is its own text node so a heading can
 * only wrap between words, never clip a word inside a one-line box.
 */
export function AccessHeading({ lead: leadText, accent }: { lead: string; accent: string }) {
  const [first = "", ...rest] = leadText.split(" ");
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`${leadText} ${accent}`}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="flex-row flex-wrap gap-x-2"
      >
        <GlitchLabel variant="title" text={first} style={lead} />
        {rest.map((word, index) => (
          <Typography key={`${index}-${word}`} variant="title" style={lead}>
            {word}
          </Typography>
        ))}
        <Typography variant="title" style={accentStyle}>
          {accent}
        </Typography>
      </View>
    </View>
  );
}
