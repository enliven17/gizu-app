import { View, useWindowDimensions, type TextStyle } from "react-native";
import { GlitchLabel } from "@/components/atoms/GlitchLabel";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";
import { Reveal } from "./Reveal";
import { tracking } from "./tracking";

// Frontend: `text-[46px] font-semibold leading-[1.0] tracking-tighter`. Native styles
// (not variant overrides) so the glitch copies, which merge `style`, match exactly and
// the title variant's own size/line height can never win. Tracking is eased for the
// system font; the line box is a touch over 1.0 so Android does not clip ascenders.
const display: TextStyle = {
  fontSize: 46,
  lineHeight: 48,
  letterSpacing: tracking(-0.9),
  fontWeight: "600",
};
const accent: TextStyle = { ...display, color: colors.neon.DEFAULT };
const quiet: TextStyle = { ...display, color: colors.fg["55"] };

/** Frontend word timing: 0.85 s + 0.3 s per word, 0.28 s each. */
const WORD_START = 850;
const WORD_STEP = 300;
const WORD_DURATION = 280;
/** Above this, words may not fit one per line, so fall back to native wrapping. */
const LARGE_TEXT = 1.3;

function AccentWord({ text, animate }: { text: string; animate: boolean }) {
  if (animate) return <GlitchLabel variant="title" text={text} style={accent} />;
  return (
    <Typography variant="title" style={accent}>
      {text}
    </Typography>
  );
}

function QuietWord({ text }: { text: string }) {
  return (
    <Typography variant="title" style={quiet}>
      {text}
    </Typography>
  );
}

export function WelcomeHeading({ animate }: { animate: boolean }) {
  const { fontScale } = useWindowDimensions();
  // Large accessibility sizes keep native text wrapping, without glitch slices.
  if (fontScale > LARGE_TEXT)
    return (
      <Typography variant="title" style={display}>
        <Typography variant="title" style={accent}>
          DeFi
        </Typography>
        <Typography variant="title" style={quiet}>
          {" in\n"}
        </Typography>
        <Typography variant="title" style={accent}>
          Stealth
        </Typography>
        <Typography variant="title" style={quiet}>
          {" Mode"}
        </Typography>
      </Typography>
    );
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="DeFi in Stealth Mode">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Reveal delay={150} duration={500} className="flex-row flex-wrap gap-x-3">
          <AccentWord text="DeFi" animate={animate} />
          <QuietWord text="in" />
        </Reveal>
        <View className="flex-row flex-wrap gap-x-3">
          <Reveal delay={WORD_START} duration={WORD_DURATION} offset={10}>
            <AccentWord text="Stealth" animate={animate} />
          </Reveal>
          <Reveal delay={WORD_START + WORD_STEP} duration={WORD_DURATION} offset={10}>
            <QuietWord text="Mode" />
          </Reveal>
        </View>
      </View>
    </View>
  );
}
