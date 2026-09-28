import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Button } from "@/components/atoms/Button";
import { GlitchLabel } from "@/components/atoms/GlitchLabel";
import { PressableScale } from "@/components/atoms/PressableScale";
import { ScrambleText } from "@/components/atoms/ScrambleText";
import { Typography } from "@/components/atoms/Typography";
import { Choice } from "@/components/molecules/Choice";
import { FadeIn } from "@/components/molecules/FadeIn";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { cardDelay, sectionDelay } from "@/theme/motion";

const reducedMotion = jest.mocked(useReducedMotion);

test("scrambled text is readable and announced by its final value", () => {
  render(<ScrambleText variant="pageTitle" text="Exchange" delay={120} />);
  const title = screen.getByRole("header", { name: "Exchange" });
  expect(title).toHaveTextContent("Exchange");
});

test("glitch label exposes one readable copy of its text", () => {
  render(<GlitchLabel variant="section" text="Confidential vaults" />);
  const label = screen.getByRole("header", { name: "Confidential vaults" });
  // Trigger layout so the decorative copies mount; they must stay hidden from assistive tech.
  fireEvent(label, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 24 } },
  });
  expect(screen.getAllByText("Confidential vaults")).toHaveLength(1);
  expect(screen.getAllByText("Confidential vaults", { includeHiddenElements: true })).toHaveLength(
    3,
  );
});

test("glitch label stays static when the system reduces motion", () => {
  reducedMotion.mockReturnValue(true);
  render(<GlitchLabel text="Gizu" />);
  expect(screen.getAllByText("Gizu", { includeHiddenElements: true })).toHaveLength(1);
  reducedMotion.mockReturnValue(false);
});

test("pressable scale forwards accessibility and press handlers", async () => {
  const onPress = jest.fn();
  render(
    <PressableScale accessibilityRole="button" accessibilityLabel="Open alerts" onPress={onPress}>
      <Typography>Alerts</Typography>
    </PressableScale>,
  );
  await userEvent.press(screen.getByRole("button", { name: "Open alerts" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("sell action submits and reports busy while loading", async () => {
  const onPress = jest.fn();
  const { rerender } = render(<Button label="Sell" variant="sell" onPress={onPress} />);
  await userEvent.press(screen.getByRole("button", { name: "Sell" }));
  expect(onPress).toHaveBeenCalledTimes(1);
  rerender(<Button label="Sell" variant="sell" loading onPress={onPress} />);
  expect(screen.getByRole("button", { name: "Sell" })).toBeDisabled();
});

test("choice pills and grouped rows keep their roles and states", async () => {
  const onSelect = jest.fn();
  const onRow = jest.fn();
  render(
    <FadeIn delay={sectionDelay(1)}>
      <Choice label="Stable" selected onPress={onSelect} />
      <GroupedRow label="Network" value="Testnet" onPress={onRow} />
      <GroupedRow label="Version" value="0.1.0" />
    </FadeIn>,
  );
  expect(screen.getByRole("radio", { name: "Stable" })).toBeChecked();
  await userEvent.press(screen.getByRole("button", { name: "Network" }));
  expect(onRow).toHaveBeenCalledTimes(1);
  expect(screen.getByText("0.1.0")).toBeVisible();
});

test("stagger helpers follow the frontend timings", () => {
  expect(sectionDelay(0)).toBe(0);
  expect(sectionDelay(3)).toBe(180);
  expect(cardDelay(0)).toBe(300);
  expect(cardDelay(2)).toBe(400);
});
