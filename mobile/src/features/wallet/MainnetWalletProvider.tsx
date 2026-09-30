import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { MainnetWalletSession } from "@/services/access";
import type { MainnetPortfolioSnapshot } from "@/domain/wallet/storedSigner";
import { getStoredSwapSigner } from "@/services/wallet/nativeBridge";

export function validateMainnetPortfolio(
  value: MainnetPortfolioSnapshot,
  walletId: string | undefined,
) {
  if (
    value.walletId !== walletId ||
    value.chainId !== 143 ||
    value.asset !== "USDC" ||
    value.decimals !== 6
  )
    throw new Error("Invalid mainnet portfolio identity");
  const atoms = (value: string) => {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid USDC balance");
    return BigInt(value);
  };
  if (atoms(value.fundingAtoms) + atoms(value.returnAtoms) !== atoms(value.totalAtoms))
    throw new Error("Inconsistent USDC balances");
  const seen = new Set<string>();
  const total = value.accounts.reduce((sum, account) => {
    const address = account.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address) || seen.has(address))
      throw new Error("Invalid portfolio account");
    seen.add(address);
    return sum + atoms(account.balanceAtoms);
  }, 0n);
  if (total !== atoms(value.totalAtoms)) throw new Error("Inconsistent account balances");
  return value;
}

function useMainnetState(session: MainnetWalletSession) {
  const [snapshot, setSnapshot] = useState<MainnetPortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const signer = getStoredSwapSigner();
      if (!signer) throw new Error("Native mainnet portfolio is unavailable in this build.");
      const result = validateMainnetPortfolio(await signer.getMainnetPortfolio(), session.walletId);
      if (result.fundingAddress.toLowerCase() !== session.address.toLowerCase())
        throw new Error("Funding account mismatch");
      if (alive.current) setSnapshot(result);
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Mainnet balance unavailable. Retry.");
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [session.walletId, session.address]);
  return { session, snapshot, loading, error, refresh };
}
const Context = createContext<ReturnType<typeof useMainnetState> | null>(null);
export function MainnetWalletProvider({
  session,
  children,
}: PropsWithChildren<{ session: MainnetWalletSession }>) {
  const value = useMainnetState(session);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMainnetWallet() {
  const value = useContext(Context);
  if (!value) throw new Error("Mainnet wallet provider required");
  return value;
}
