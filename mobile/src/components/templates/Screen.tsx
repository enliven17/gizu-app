import { useContext, useState, type PropsWithChildren } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollLockContext } from "./ScrollLock";

export function Screen({
  children,
  scrollable = true,
}: PropsWithChildren<{ scrollable?: boolean }>) {
  const tabHeight = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  const [scrollLocked, setScrollLocked] = useState(false);
  return (
    <View
      className={`flex-1 bg-ink pt-safe pl-safe pr-safe ${tabHeight === undefined ? "pb-safe" : "pb-0"}`}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top}
      >
        {scrollable ? (
          <ScrollView
            scrollEnabled={!scrollLocked}
            contentContainerClassName="grow gap-4 px-5 py-4"
            contentContainerStyle={
              tabHeight === undefined ? undefined : { paddingBottom: tabHeight + 16 }
            }
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          >
            <ScrollLockContext.Provider value={setScrollLocked}>
              {children}
            </ScrollLockContext.Provider>
          </ScrollView>
        ) : (
          <View className="flex-1 gap-4 px-5 py-4" style={{ paddingBottom: (tabHeight ?? 0) + 16 }}>
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
