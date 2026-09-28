import { getStateFromPath, type LinkingOptions } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
export function createLinking(signedIn: boolean): LinkingOptions<RootStackParamList> {
  return {
    prefixes: ["gizu-dev://"],
    config: {
      screens: {
        Welcome: "",
        Access: "access",
        VaultDetail: "vault/:id",
        OpportunityDetail: "opportunity/:id",
        Activity: "activity",
        Notifications: "notifications",
        Main: {
          screens: { Home: "home", Vaults: "vaults", Exchange: "exchange", Settings: "settings" },
        },
      },
    },
    getStateFromPath(path, options) {
      // No protected destination or unknown input is retained while signed out.
      if (!signedIn)
        return path === "access"
          ? { index: 1, routes: [{ name: "Welcome" }, { name: "Access" }] }
          : { routes: [{ name: "Welcome" }] };
      return getStateFromPath(path, options);
    },
  };
}
