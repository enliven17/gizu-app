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
};
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
      accessibilityRole={variant === "title" || variant === "heading" ? "header" : undefined}
      {...props}
      className={`${variants[variant]} ${className}`}
    />
  );
}
