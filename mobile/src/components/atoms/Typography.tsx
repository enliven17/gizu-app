import { Text, useWindowDimensions, type TextProps } from "react-native";
const variants = {
  title: "text-4xl font-medium text-text",
  heading: "text-2xl font-medium text-text",
  body: "text-base leading-6 text-muted",
  balance: "text-5xl font-normal text-text",
  value: "text-xl font-semibold text-text",
  row: "text-base font-medium text-text",
  negative: "text-sm font-medium text-danger",
  caption: "text-sm leading-5 text-muted",
  label: "text-sm font-semibold text-accent",
  // Frontend scale (additive; existing variants above are unchanged).
  pageTitle: "text-[30px] font-medium ios:tracking-tight text-text",
  section: "text-[20px] font-medium ios:tracking-tight text-text",
  rowTitle: "text-[14px] font-medium text-text",
  rowValue: "text-[14px] font-normal text-text",
  micro: "text-[11px] text-fg-45",
  eyebrow: "text-[12px] font-medium text-fg-55",
  eyebrowSmall: "text-[11px] font-medium text-fg-55",
};
export type TypographyVariant = keyof typeof variants;
const headers = new Set<TypographyVariant>(["title", "heading", "pageTitle", "section"]);
export function Typography({
  variant = "body",
  className = "",
  ...props
}: TextProps & { variant?: keyof typeof variants }) {
  // Remeasure native text after Dynamic Type changes, including on inactive screens.
  // Remount only the text node so feature and navigation state are retained.
  const { fontScale } = useWindowDimensions();
  return (
    <Text
      key={fontScale}
      accessibilityRole={headers.has(variant) ? "header" : undefined}
      {...props}
      className={`font-sans ${variants[variant]} ${className}`}
    />
  );
}
