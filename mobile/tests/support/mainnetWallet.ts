import type { MainnetPortfolioSnapshot } from "@/domain/wallet/storedSigner";
export function mainnetPortfolio(
  walletId: string,
  address: string,
  totalAtoms = "19990574",
): MainnetPortfolioSnapshot {
  return {
    walletId,
    chainId: 143,
    asset: "USDC",
    decimals: 6,
    fundingAddress: address,
    fundingAtoms: totalAtoms,
    returnAtoms: "0",
    totalAtoms,
    checkedAt: Date.now(),
    block: "100",
    accounts: [{ address, accountIndex: 1, role: "funding", balanceAtoms: totalAtoms }],
    history: [],
  };
}
