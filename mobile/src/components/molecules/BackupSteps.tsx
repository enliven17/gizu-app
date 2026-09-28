import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";

type Props = { steps: readonly string[]; completed: boolean };

/** Wallet backup progress. Presentation only: the native ceremony owns each step. */
export function BackupSteps({ steps, completed }: Props) {
  return (
    <View className="gap-1">
      {steps.map((label, index) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`Step ${index + 1} of ${steps.length}: ${label}${completed ? ", complete" : ""}`}
          className="min-h-11 flex-row items-center gap-3"
        >
          <View
            className={`h-7 w-7 items-center justify-center rounded-full ${completed ? "bg-neon-deep" : "border border-glassBorder bg-glassSoft"}`}
          >
            <Typography
              variant="rowTitle"
              className={`!text-[13px] ${completed ? "!text-accent" : "!text-fg-55"}`}
            >
              {completed ? "✓" : index + 1}
            </Typography>
          </View>
          <Typography variant="rowValue" className={`flex-1 ${completed ? "" : "!text-fg-70"}`}>
            {label}
          </Typography>
        </View>
      ))}
    </View>
  );
}

/** Calm result panel; failures are announced as alerts. */
export function BackupResult({ message, failed }: { message: string; failed: boolean }) {
  return (
    <View
      className={`rounded-2xl border bg-glassSoft p-4 ${failed ? "border-danger/30" : "border-glassBorder"}`}
    >
      <Typography
        variant="caption"
        className={failed ? "!text-danger" : "!text-text"}
        accessibilityRole={failed ? "alert" : "text"}
        accessibilityLiveRegion="polite"
      >
        {message}
      </Typography>
    </View>
  );
}
