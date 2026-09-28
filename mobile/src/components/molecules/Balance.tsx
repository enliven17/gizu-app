import { Text } from "react-native";
import { Typography } from "@/components/atoms/Typography";
export function Balance({ value }: { value: string }) {
  const [whole, cents] = value.split(".");
  return (
    <Typography variant="balance" accessibilityLabel={value}>
      {whole}
      {cents && <Text className="text-[26px] text-muted">.{cents}</Text>}
    </Typography>
  );
}
