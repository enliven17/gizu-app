import { useEffect, useState, type ComponentProps } from "react";
import { useReducedMotion } from "react-native-reanimated";
import { Typography } from "./Typography";

const GLYPHS = "01<>/\\[]{}#$%&*ABCDEFXZ";
/** Frontend Scramble reveals one character every four animation frames. */
const FRAMES_PER_CHAR = 4;
const skipAnimation = typeof process !== "undefined" && Boolean(process.env.JEST_WORKER_ID);

type TypographyProps = ComponentProps<typeof Typography>;

export type ScrambleTextProps = Omit<TypographyProps, "children" | "accessibilityLabel"> & {
  text: string;
  /** Milliseconds before the reveal starts. */
  delay?: number;
};

function scrambled(text: string, revealed: number): string {
  return text
    .split("")
    .map((char, index) => {
      if (char === " " || index < revealed) return char;
      return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? char;
    })
    .join("");
}

/** Port of the frontend Scramble text; the accessible name is always the final text. */
export function ScrambleText({ text, delay = 0, style, ...props }: ScrambleTextProps) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion && !skipAnimation;
  const [output, setOutput] = useState(() => (animate ? text.replace(/\S/g, "0") : text));

  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let raf = 0;
    const timer = setTimeout(() => {
      const run = () => {
        frame += 1;
        const revealed = Math.floor(frame / FRAMES_PER_CHAR);
        if (revealed >= text.length) {
          setOutput(text);
          return;
        }
        setOutput(scrambled(text, revealed));
        raf = requestAnimationFrame(run);
      };
      raf = requestAnimationFrame(run);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [animate, delay, text]);

  return (
    <Typography
      {...props}
      accessibilityLabel={text}
      style={[{ fontVariant: ["tabular-nums"] }, style]}
    >
      {animate ? output : text}
    </Typography>
  );
}
