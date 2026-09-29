import { useContext, type PropsWithChildren } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function useScreenBottomPadding() {
  const tabHeight = useContext(BottomTabBarHeightContext);
  return tabHeight === undefined ? undefined : tabHeight + 16;
}
export function ScreenFrame({ children }: PropsWithChildren) {
  const tabHeight = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`flex-1 bg-ink pt-safe pl-safe pr-safe ${tabHeight === undefined ? "pb-safe" : "pb-0"}`}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
