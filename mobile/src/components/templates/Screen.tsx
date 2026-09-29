import { useState, type PropsWithChildren } from "react";
import { ScrollView, View } from "react-native";
import { ScreenFrame, useScreenBottomPadding } from "./ScreenFrame";
import { ScrollLockContext } from "./ScrollLock";

export function Screen({
  children,
  scrollable = true,
}: PropsWithChildren<{ scrollable?: boolean }>) {
  const bottomPadding = useScreenBottomPadding();
  const [scrollLocked, setScrollLocked] = useState(false);
  return (
    <ScreenFrame>
      {scrollable ? (
        <ScrollView
          scrollEnabled={!scrollLocked}
          contentContainerClassName="grow gap-4 px-5 py-4"
          contentContainerStyle={
            bottomPadding === undefined ? undefined : { paddingBottom: bottomPadding }
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
        <View className="flex-1 gap-4 px-5 py-4" style={{ paddingBottom: bottomPadding ?? 16 }}>
          {children}
        </View>
      )}
    </ScreenFrame>
  );
}
