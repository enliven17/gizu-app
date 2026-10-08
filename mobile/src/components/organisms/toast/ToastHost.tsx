import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Toast, {
  type ToastConfig,
  type ToastConfigParams,
  type ToastShowParams,
} from "react-native-toast-message";
import { toastDefaults, type ToastAction, type ToastVariant } from "@/services/toast";
import { ToastBanner } from "./ToastBanner";

function renderVariant(variant: ToastVariant) {
  return function ToastVariant({
    text1,
    text2,
    props,
    hide,
    isVisible,
  }: ToastConfigParams<{ action?: ToastAction }>) {
    if (!isVisible) return null;
    return (
      <ToastBanner
        variant={variant}
        title={text1 ?? ""}
        description={text2}
        action={props.action}
        onDismiss={hide}
      />
    );
  };
}
const config: ToastConfig = {
  success: renderVariant("success"),
  error: renderVariant("error"),
  info: renderVariant("info"),
  warning: renderVariant("warning"),
};
function announce({ text1, text2 }: ToastShowParams) {
  AccessibilityInfo.announceForAccessibility([text1, text2].filter(Boolean).join(". "));
}

/** Mount last in the app. Native modals need their own host inside the modal. */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  // Fail accessible: don't expire messages until the native preference is known.
  const [screenReader, setScreenReader] = useState(true);
  useEffect(() => {
    let active = true;
    let eventReceived = false;
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      eventReceived = true;
      setScreenReader(enabled);
    });
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (active && !eventReceived) setScreenReader(enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return (
    <Toast
      config={config}
      position="top"
      topOffset={insets.top + toastDefaults.edgeSpacing}
      autoHide={!screenReader}
      visibilityTime={toastDefaults.duration}
      onShow={announce}
      animationConfig={reducedMotion ? { type: "timing", duration: 0 } : undefined}
    />
  );
}
