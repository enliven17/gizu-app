import type { ComponentProps } from "react";
import { render } from "@testing-library/react-native";
import { AppRoot } from "@/application/AppRoot";
import { mockOpportunityService } from "./opportunities";

export function renderApp(options: ComponentProps<typeof AppRoot> = {}) {
  return render(<AppRoot opportunityService={mockOpportunityService([])} {...options} />);
}
