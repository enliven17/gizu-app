import type { PropsWithChildren } from "react";
import { Typography } from "@/components/atoms/Typography";
import { FadeIn } from "@/components/molecules/FadeIn";
import { Surface } from "@/components/molecules/Surface";

/** Frontend Settings group: small normal-case label over a glass panel of rows. */
export function SettingsGroup({
  title,
  delay,
  children,
}: PropsWithChildren<{ title?: string; delay: number }>) {
  return (
    <FadeIn delay={delay} className="mt-3 gap-3">
      {title !== undefined && (
        <Typography variant="eyebrow" className="px-1" accessibilityRole="header">
          {title}
        </Typography>
      )}
      <Surface>{children}</Surface>
    </FadeIn>
  );
}
