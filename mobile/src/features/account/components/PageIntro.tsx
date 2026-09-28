import { Typography } from "@/components/atoms/Typography";
import { FadeIn } from "@/components/molecules/FadeIn";
import { sectionDelay } from "@/theme/motion";

/** Frontend SubPage heading: 30px title with an optional short 14px body below. */
export function PageIntro({ title, body }: { title: string; body?: string }) {
  return (
    <FadeIn delay={sectionDelay(0)} className="mt-4 gap-3">
      <Typography variant="pageTitle">{title}</Typography>
      {body !== undefined && (
        <Typography variant="rowValue" className="leading-[22px] !text-fg-45">
          {body}
        </Typography>
      )}
    </FadeIn>
  );
}
