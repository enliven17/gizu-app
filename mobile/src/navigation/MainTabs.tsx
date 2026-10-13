import { AccountScreen } from "@/features/account/AccountScreen";
import { PortfolioScreen } from "@/features/investments/PortfolioScreen";
import { VaultsScreen } from "@/features/investments/VaultsScreen";
import { NativeSwapScreen } from "@/features/swap/NativeSwapScreen";
import { DemoSwapSheet } from "@/features/swap/demo/DemoSwapSheet";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { FloatingTabs } from "./FloatingTabs";
import type { MainTabParamList } from "./types";
const Tabs = createBottomTabNavigator<MainTabParamList>();
export function MainTabs() {
  return (
    <>
      {/* Swap demo mode only: the simulated review and progress screens, over any tab. */}
      <DemoSwapSheet />
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
        <Tabs.Screen name="Exchange" component={NativeSwapScreen} />
        <Tabs.Screen name="Settings" component={AccountScreen} />
      </Tabs.Navigator>
    </>
  );
}
