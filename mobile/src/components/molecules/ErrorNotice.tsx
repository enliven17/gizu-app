import { useState } from "react";
import { Pressable, View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";

const diagnosticCodes = {
  balance: "PORTFOLIO_READ_FAILED",
  holdings: "HOLDINGS_READ_FAILED",
  tokenSearch: "TOKEN_SEARCH_FAILED",
  sale: "SALE_STATUS_REQUIRES_REVIEW",
  vault: "VAULT_READ_FAILED",
  initial: "CATALOG_READ_FAILED",
  more: "CATALOG_PAGE_FAILED",
  refresh: "CATALOG_REFRESH_FAILED",
  stalled: "CATALOG_REFRESH_REQUIRED",
} as const;

/** Display curated copy and fixed codes only, never raw provider exceptions. */
export function ErrorNotice({
  message,
  kind,
  stale = false,
  actionLabel = "Try again",
  onAction,
  busy = false,
}: {
  message: string;
  kind: keyof typeof diagnosticCodes;
  stale?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3 rounded-xl border border-border bg-surface p-4">
      <Typography accessibilityRole="alert" accessibilityLiveRegion="polite">
        {message}
        {stale ? " Previously loaded balances may be stale." : ""}
      </Typography>
      {onAction && (
        <Button label={actionLabel} variant="secondary" disabled={busy} onPress={onAction} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Error details"
        accessibilityState={{ expanded }}
        className="min-h-11 justify-center"
        onPress={() => setExpanded((value) => !value)}
      >
        <Typography variant="micro">{expanded ? "Hide error details" : "Error details"}</Typography>
      </Pressable>
      {expanded && (
        <Typography variant="micro" selectable>
          Code: {diagnosticCodes[kind]}
        </Typography>
      )}
    </View>
  );
}
