import { Pressable, View } from "react-native";
import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from "lucide-react-native";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";
import type { ToastAction, ToastVariant } from "@/services/toast";

// Keep visual variants here; features supply meaning and copy, never library styling props.
const variants = {
  success: { Icon: CircleCheck, color: colors.accent, label: "Success" },
  error: { Icon: CircleAlert, color: colors.danger, label: "Error" },
  info: { Icon: Info, color: colors.text, label: "Information" },
  warning: { Icon: TriangleAlert, color: colors.danger, label: "Warning" },
};

export function ToastBanner({
  variant,
  title,
  description,
  action,
  onDismiss,
}: {
  variant: ToastVariant;
  title: string;
  description?: string;
  action?: ToastAction;
  onDismiss: () => void;
}) {
  const { Icon, color, label } = variants[variant];
  return (
    <View className="w-full max-w-lg px-4">
      <View className="flex-row items-start gap-3 rounded-2xl border border-border bg-surface p-4">
        <View
          className="pt-1"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon size={22} color={color} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View
            accessible
            accessibilityLabel={`${label}: ${title}${description ? `. ${description}` : ""}`}
          >
            <Typography variant="row">{title}</Typography>
            {description ? <Typography variant="caption">{description}</Typography> : null}
          </View>
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              className="min-h-11 justify-center"
              onPress={() => {
                onDismiss();
                action.onPress();
              }}
            >
              <Typography variant="label">{action.label}</Typography>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={onDismiss}
          className="min-h-11 min-w-11 items-center justify-center"
        >
          <X size={20} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}
