import { AccountScreen } from "@/features/account/AccountScreen";
import { PortfolioScreen } from "@/features/investments/PortfolioScreen";
import { VaultsScreen } from "@/features/investments/VaultsScreen";
import { SwapComingSoonScreen } from "@/features/shell/SwapComingSoonScreen";
import { NativeSwapScreen } from "@/features/swap/NativeSwapScreen";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { FloatingTabs } from "./FloatingTabs";
import type { MainTabParamList } from "./types";
const Tabs = createBottomTabNavigator<MainTabParamList>();
export function MainTabs() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <FloatingTabs {...props} />}
      backBehavior="initialRoute"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarAccessibilityLabel: `${route.name === "Exchange" ? "Swap" : route.name} tab`,
      })}
    >
      <Tabs.Screen name="Home" component={PortfolioScreen} />
      <Tabs.Screen name="Vaults" component={VaultsScreen} />
      <Tabs.Screen name="Exchange" component={__DEV__ ? NativeSwapScreen : SwapComingSoonScreen} />
      <Tabs.Screen name="Settings" component={AccountScreen} />
    </Tabs.Navigator>
  );
}
