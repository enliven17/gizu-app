import { act, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { MainnetWalletProvider } from "@/features/wallet/MainnetWalletProvider";
import { EarnProvider } from "@/features/earn/EarnProvider";
import { DepositJourneyScreen } from "@/features/earn/DepositJourneyScreen";
import type { EarnDepositService, DepositSnapshot } from "@/domain/earn/depositJourney";
import { depositSnapshot } from "../../support/depositJourney";
import { hoodIntent } from "../../support/robinhoodEarn";
import { mainnetPortfolio } from "../../support/mainnetWallet";
import { deferred } from "../../support/renderApp";
const Stack = createNativeStackNavigator();
function ready(): DepositSnapshot {
  const raw = depositSnapshot();
  raw.review.quotedAtMs = Date.now();
  raw.review.expiresAtMs = Date.now() + 45000;
  return raw as DepositSnapshot;
}
function setup(overrides: Partial<EarnDepositService> = {}, id?: string) {
  const snapshot = ready();
  const service = {
    available: jest.fn().mockResolvedValue(true),
    prepare: jest.fn().mockResolvedValue(snapshot),
    confirm: jest.fn().mockResolvedValue({ ...snapshot, phase: "funding" }),
    status: jest.fn().mockResolvedValue({ ...snapshot, phase: "funding" }),
    resume: jest.fn().mockResolvedValue({ ...snapshot, phase: "funding" }),
    cancel: jest.fn().mockResolvedValue({ ...snapshot, phase: "paused", pauseReason: "cancelled" }),
    ...overrides,
  };
  const result = render(
    <MainnetWalletProvider
      session={{
        kind: "mainnet",
        walletId: hoodIntent.walletId,
        address: hoodIntent.sourceAddress,
        accountId: hoodIntent.sourceAddress,
        accountIndex: 1,
        method: "Passkey",
        chainId: 143,
      }}
      service={{
        getMainnetPortfolio: jest
          .fn()
          .mockResolvedValue(mainnetPortfolio(hoodIntent.walletId, hoodIntent.sourceAddress)),
      }}
    >
      <EarnProvider
        depositJourney={service}
        service={{
          load: jest.fn().mockResolvedValue({ status: "absent" }),
          prepare: jest.fn(),
          cancel: jest.fn(),
        }}
      >
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Deposit">
              {() => <DepositJourneyScreen profileId="robinhood-usdg" savedJourneyId={id} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </EarnProvider>
    </MainnetWalletProvider>,
  );
  return { service, snapshot, ...result };
}
async function review() {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Review deposit" })).toBeDisabled(),
  );
  await user.type(screen.getByLabelText("USDC deposit amount"), "3");
  await user.press(screen.getByRole("button", { name: "Review deposit" }));
  return user;
}
test("amount, unsigned review, one confirm and verified investment have no child or withdrawal controls", async () => {
  const { service, snapshot } = setup();
  const user = await review();
  expect(await screen.findByText("Review deposit")).toBeVisible();
  expect(screen.getByText("Source budget: 3 USDC")).toBeVisible();
  expect(screen.getByText("At least 0.28 USDG held")).toBeVisible();
  expect(screen.getByText("At least 2.495 USDG invested")).toBeVisible();
  expect(screen.getByText("Withdrawal reserve: 0.052 USDG")).toBeVisible();
  expect(service.confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /wallet 1 payout/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /withdraw/i })).toBeNull();
  await user.press(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText(hoodIntent.destinations[0].address)).toBeVisible();
  await user.press(screen.getByRole("button", { name: "Confirm deposit" }));
  expect(await screen.findByText("Converting USDC to private balance")).toBeVisible();
  expect(service.confirm).toHaveBeenCalledTimes(1);
  jest
    .mocked(service.status)
    .mockResolvedValue({
      ...snapshot,
      phase: "invested",
      revision: 5,
      completedSteps: ["funding", "credit", "payouts", "deposit"],
      creditedAtoms: "2970000",
      holdReceivedAtoms: "290000",
      investReceivedAtoms: "2650000",
      depositedAtoms: "2498000",
      sharesAtoms: "2490000000000000000",
      depositTransactionHash: "0x" + "a".repeat(64),
    });
  await user.press(screen.getByRole("button", { name: "Check progress" }));
  expect(await screen.findByText("Invested")).toBeVisible();
  expect(screen.getByText("0.29 USDG held")).toBeVisible();
  expect(screen.getByText("2.498 USDG invested")).toBeVisible();
});
test("late preparation cannot authorize an edited amount; the same draft is reused", async () => {
  const pending = deferred<DepositSnapshot>();
  const prepare = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(ready());
  setup({ prepare });
  const user = await review();
  const input = screen.getByLabelText("USDC deposit amount");
  await user.clear(input);
  await user.type(input, "4");
  await act(async () => pending.resolve(ready()));
  expect(screen.queryByRole("button", { name: "Confirm deposit" })).toBeNull();
  await user.press(screen.getByRole("button", { name: "Review deposit" }));
  expect(prepare).toHaveBeenLastCalledWith(
    expect.anything(),
    "robinhood-usdg",
    "4000000",
    "deposit_1",
  );
});
test("unavailable preview explains why and never requests signing", async () => {
  const { service } = setup({
    prepare: jest
      .fn()
      .mockResolvedValue({
        ...ready(),
        phase: "paused",
        pauseReason: "previewUnavailable",
        review: undefined,
      }),
  });
  await review();
  expect(await screen.findByText(/fresh fee estimate is unavailable/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Confirm deposit" })).toBeNull();
  expect(service.confirm).not.toHaveBeenCalled();
});
test("saved partially completed deposit resumes rather than allocating another pair", async () => {
  const row = {
    ...ready(),
    phase: "paused",
    pauseReason: "approvalExpired",
    completedSteps: ["funding", "credit"],
    creditedAtoms: "2970000",
  } as DepositSnapshot;
  const { service } = setup({ status: jest.fn().mockResolvedValue(row) }, "deposit_1");
  expect(await screen.findByText(/Approval ended/)).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Review remaining steps" }));
  expect(service.resume).toHaveBeenCalledWith(expect.anything(), "deposit_1", 1);
  expect(service.prepare).not.toHaveBeenCalled();
});
test("leaving a running deposit revokes remaining authority while preserving saved identity", async () => {
  const { service, unmount } = setup();
  const user = await review();
  await user.press(screen.getByRole("button", { name: "Confirm deposit" }));
  await screen.findByText("Converting USDC to private balance");
  unmount();
  expect(service.cancel).toHaveBeenCalledWith(expect.anything(), "deposit_1", 1);
});

test("quote expiry disables confirmation while retaining the displayed saved limits", async () => {
  jest.useFakeTimers();
  try {
    setup();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await act(async () => {});
    await user.type(screen.getByLabelText("USDC deposit amount"), "3");
    await user.press(screen.getByRole("button", { name: "Review deposit" }));
    await act(async () => {
      jest.advanceTimersByTime(45001);
    });
    expect(screen.getByRole("button", { name: "Confirm deposit" })).toBeDisabled();
    expect(screen.getByText(/review expired or the amount changed/i)).toBeVisible();
  } finally {
    jest.useRealTimers();
  }
});
test("a rejected native authorization retains saved identity and never prepares a second pair", async () => {
  const confirm = jest.fn().mockRejectedValue(new Error("Passkey declined"));
  const { service } = setup({ confirm, status: jest.fn().mockResolvedValue(ready()) });
  const user = await review();
  await user.press(screen.getByRole("button", { name: "Confirm deposit" }));
  expect(await screen.findByText("Passkey declined")).toBeVisible();
  expect(service.status).toHaveBeenCalledWith(expect.anything(), "deposit_1");
  expect(service.prepare).toHaveBeenCalledTimes(1);
});
test("duplicate confirmation taps cannot open another native approval", async () => {
  const pending = deferred<DepositSnapshot>();
  const confirm = jest.fn().mockReturnValue(pending.promise);
  setup({ confirm });
  const user = await review();
  const button = screen.getByRole("button", { name: "Confirm deposit" });
  await user.press(button);
  await user.press(button);
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ ...ready(), phase: "funding" }));
});
test("unsupported native build keeps review disabled", async () => {
  setup({ available: jest.fn().mockResolvedValue(false) });
  const user = userEvent.setup();
  expect(await screen.findByText(/updated.*native|Update the native app/)).toBeVisible();
  await user.type(screen.getByLabelText("USDC deposit amount"), "3");
  expect(screen.getByRole("button", { name: "Review deposit" })).toBeDisabled();
});
