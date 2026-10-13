import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MainnetWalletProvider } from "@/features/wallet/MainnetWalletProvider";
import { OpportunityDetailScreen } from "@/features/opportunities/OpportunityDetailScreen";
import { VaultWithdrawScreen } from "@/features/earn/VaultWithdrawScreen";
import { EarnScreen } from "@/features/earn/EarnScreen";
import type { RootStackParamList } from "@/navigation/types";
import { swapDemo } from "@/features/swap/demo/swapDemo";
import { demoVaults } from "@/services/demo/vaults";

jest.mock("@/services/wallet/nativeBridge", () => ({
  getStoredEarnDepositSigner: jest.fn(() => {
    throw new Error("Unexpected native deposit");
  }),
  getStoredSwapSigner: jest.fn(() => {
    throw new Error("Unexpected native portfolio");
  }),
}));

const Stack = createNativeStackNavigator<RootStackParamList>();
const vaultId = "demo-morpho-steakhouse-usdg";
const session = {
  kind: "mainnet" as const,
  method: "Passkey" as const,
  accountId: "demo",
  address: "0x" + "1".repeat(40),
  accountIndex: 1 as const,
  chainId: 143 as const,
  walletId: "7aafcc2e-0891-4e31-a7d4-03780d7b4f12",
};
const owner = { walletId: session.walletId, address: session.address };
const originalFlag = process.env.EXPO_PUBLIC_SWAP_DEMO;
beforeEach(() => {
  process.env.EXPO_PUBLIC_SWAP_DEMO = "1";
  jest.useFakeTimers();
  swapDemo.reset();
  demoVaults.reset();
});
afterEach(() => {
  swapDemo.reset();
  demoVaults.reset();
  jest.useRealTimers();
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_SWAP_DEMO;
  else process.env.EXPO_PUBLIC_SWAP_DEMO = originalFlag;
  jest.restoreAllMocks();
});
function setup(id = vaultId, direct = false) {
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  render(
    <MainnetWalletProvider session={session}>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName={direct ? "VaultWithdraw" : "OpportunityDetail"}
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen
            name="OpportunityDetail"
            component={OpportunityDetailScreen}
            initialParams={{ id }}
          />
          <Stack.Screen
            name="VaultWithdraw"
            component={VaultWithdrawScreen}
            initialParams={{ opportunityId: id }}
          />
          <Stack.Screen name="Earn" component={EarnScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </MainnetWalletProvider>,
  );
  return network;
}
async function openWithdrawal() {
  fireEvent.press(await screen.findByRole("button", { name: "Withdraw" }));
  await screen.findByLabelText("USDC withdrawal amount");
}

test("Withdraw keeps the selected vault and skips deposit preparation", async () => {
  const network = setup();
  await openWithdrawal();
  expect(screen.getByText("Steakhouse USDG")).toBeVisible();
  expect(screen.getByText("Available: 250 USDC")).toBeVisible();
  expect(screen.queryByText("Confidential earn")).toBeNull();
  expect(screen.queryByText("Choose destination")).toBeNull();
  expect(screen.queryByRole("button", { name: /Prepare/ })).toBeNull();
  const input = screen.getByLabelText("USDC withdrawal amount");
  const button = () => screen.getByRole("button", { name: "Review withdrawal" });
  expect(button()).toBeDisabled();
  for (const invalid of ["0", "-5", "abc", "1.2345678", "251"]) {
    fireEvent.changeText(input, invalid);
    expect(button()).toBeDisabled();
  }
  fireEvent.press(screen.getByRole("button", { name: "Max" }));
  expect(screen.getByDisplayValue("250")).toBeVisible();
  expect(button()).toBeEnabled();
  fireEvent.press(button());
  expect(screen.getByText("249.75")).toBeVisible();
  expect(screen.getByText("0.25 USDC")).toBeVisible();
  expect(screen.getByText("USDC on Monad")).toBeVisible();
  fireEvent.press(screen.getByRole("button", { name: "Edit amount" }));
  expect(screen.getByDisplayValue("250")).toBeVisible();
  fireEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("button", { name: "Withdraw" })).toBeVisible();
  expect(demoVaults.balance(owner, vaultId)).toBe("250000000");
  expect(swapDemo.usdcAtoms()).toBe(250000000n);
  expect(network).not.toHaveBeenCalled();
});

test("confirmation updates the mock investment and cash exactly once", async () => {
  const network = setup();
  await openWithdrawal();
  fireEvent.changeText(screen.getByLabelText("USDC withdrawal amount"), "100");
  fireEvent.press(screen.getByRole("button", { name: "Review withdrawal" }));
  const confirm = screen.getByRole("button", { name: "Confirm withdrawal" });
  await act(async () => {
    fireEvent.press(confirm);
    fireEvent.press(confirm);
  });
  expect(screen.getByText("Withdrawing")).toBeVisible();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(700);
  });
  expect(screen.getByText("Withdrawal complete")).toBeVisible();
  expect(screen.getByText("99.9")).toBeVisible();
  expect(swapDemo.usdcAtoms()).toBe(349900000n);
  expect(demoVaults.balance(owner, vaultId)).toBe("150000000");
  fireEvent.press(screen.getByRole("button", { name: "Done" }));
  await openWithdrawal();
  expect(screen.getByText("Available: 150 USDC")).toBeVisible();
  expect(network).not.toHaveBeenCalled();
});

test("empty positions show a simple empty state instead of wallet preparation", async () => {
  demoVaults.confirm(owner, demoVaults.review(owner, vaultId, "250000000").id);
  setup();
  await openWithdrawal();
  expect(screen.getByText("No balance left to withdraw from this vault.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review withdrawal" })).toBeDisabled();
});

test("withdrawing Max finishes without an insufficient-balance warning", async () => {
  setup();
  await openWithdrawal();
  fireEvent.press(screen.getByRole("button", { name: "Max" }));
  fireEvent.press(screen.getByRole("button", { name: "Review withdrawal" }));
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await jest.advanceTimersByTimeAsync(700);
  });
  expect(screen.getByText("Withdrawal complete")).toBeVisible();
  expect(screen.getByText("249.75")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(swapDemo.usdcAtoms()).toBe(499750000n);
});

test("expired review can be refreshed without moving mock funds", async () => {
  setup();
  await openWithdrawal();
  fireEvent.changeText(screen.getByLabelText("USDC withdrawal amount"), "25,5");
  fireEvent.press(screen.getByRole("button", { name: "Review withdrawal" }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_001);
  });
  fireEvent.press(screen.getByRole("button", { name: "Confirm withdrawal" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/estimate expired/);
  expect(swapDemo.usdcAtoms()).toBe(250000000n);
  fireEvent.press(screen.getByRole("button", { name: "Edit amount" }));
  fireEvent.press(screen.getByRole("button", { name: "Review withdrawal" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Confirm withdrawal" })).toBeEnabled();
});

test("unknown vaults can be retried without any funding or withdrawal action", async () => {
  const network = setup("demo-morpho-unknown", true);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this vault.");
  fireEvent.press(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this vault.");
  expect(screen.queryByRole("button", { name: "Review withdrawal" })).toBeNull();
  expect(network).not.toHaveBeenCalled();
});
