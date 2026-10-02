import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { MainnetWalletProvider, useMainnetWallet } from "@/features/wallet/MainnetWalletProvider";
import type { MainnetPortfolioSnapshot } from "@/domain/wallet/storedSigner";
import type { MainnetWalletSession } from "@/services/access";
import { deferred } from "../../support/renderApp";
import { mainnetPortfolio } from "../../support/mainnetWallet";

function Balance() {
  const { snapshot, error } = useMainnetWallet();
  return <Text>{error || (snapshot ? `${snapshot.totalAtoms} atoms` : "Loading wallet")}</Text>;
}

test("replacing a mounted wallet discards its snapshot and rejects its late completion", async () => {
  const address = "0x" + "1".repeat(40);
  const session: MainnetWalletSession = {
    kind: "mainnet",
    walletId: "first",
    address,
    accountId: address,
    accountIndex: 1,
    chainId: 143,
    method: "Passkey",
  };
  const pending = deferred<MainnetPortfolioSnapshot>();
  const first = { getMainnetPortfolio: jest.fn().mockReturnValue(pending.promise) };
  const second = {
    getMainnetPortfolio: jest.fn().mockResolvedValue(mainnetPortfolio("second", address, "42")),
  };
  const view = render(
    <MainnetWalletProvider session={session} service={first}>
      <Balance />
    </MainnetWalletProvider>,
  );
  await act(async () => {});
  view.rerender(
    <MainnetWalletProvider session={{ ...session, walletId: "second" }} service={second}>
      <Balance />
    </MainnetWalletProvider>,
  );
  expect(await screen.findByText("42 atoms")).toBeVisible();
  await act(async () => pending.resolve(mainnetPortfolio("first", address, "1000000")));
  expect(screen.getByText("42 atoms")).toBeVisible();
  expect(screen.queryByText("1000000 atoms")).toBeNull();
});
