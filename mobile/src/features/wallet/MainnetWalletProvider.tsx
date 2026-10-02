import { AppState } from "react-native";
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
  const assets = [...(value.ownedAssets ?? []), ...(value.positions ?? [])];
  if (assets.length > 4096) throw new Error("Invalid owned portfolio size");
  for (const asset of assets) {
    if (
      !asset.assetId ||
      typeof asset.symbol !== "string" ||
      !asset.symbol ||
      asset.symbol.length > 32 ||
      !Number.isSafeInteger(asset.chainId) ||
      asset.chainId <= 0 ||
      (asset.decimals !== null &&
        (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36)) ||
      typeof asset.complete !== "boolean" ||
      typeof asset.stale !== "boolean" ||
      typeof asset.valuationUnavailable !== "boolean" ||
      !Number.isFinite(asset.checkedAt) ||
      asset.checkedAt < 0
    )
      throw new Error("Invalid owned portfolio asset");
    atoms(asset.observedAtoms);
    if (asset.balanceAtoms !== null) atoms(asset.balanceAtoms);
    if (asset.valueUsdcAtoms !== null) atoms(asset.valueUsdcAtoms);
    if (asset.complete && asset.balanceAtoms === null)
      throw new Error("Missing owned asset balance");
    if (
      "shareDecimals" in asset &&
      asset.shareDecimals !== undefined &&
      asset.shareDecimals !== null &&
      (!Number.isInteger(asset.shareDecimals) ||
        (asset.shareDecimals as number) < 0 ||
        (asset.shareDecimals as number) > 36)
    )
      throw new Error("Invalid native vault decimals");
    if (
      "conversionEstimated" in asset &&
      asset.conversionEstimated !== undefined &&
      typeof asset.conversionEstimated !== "boolean"
    )
      throw new Error("Invalid native vault conversion");
    if ("shareAtoms" in asset && asset.shareAtoms !== null) atoms(asset.shareAtoms as string);
    if ("underlyingAtoms" in asset && asset.underlyingAtoms !== null)
      atoms(asset.underlyingAtoms as string);
    if (
      "observedUnderlyingAtoms" in asset &&
      asset.observedUnderlyingAtoms !== undefined &&
      asset.observedUnderlyingAtoms !== null
    )
      atoms(asset.observedUnderlyingAtoms as string);
  }
  return value;
}

export type MainnetPortfolioService = { getMainnetPortfolio(): Promise<MainnetPortfolioSnapshot> };
function useMainnetState(session: MainnetWalletSession, service?: MainnetPortfolioService) {
  const [snapshot, setSnapshot] = useState<MainnetPortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      busy.current = false;
      generation.current += 1;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const requestGeneration = generation.current;
    const current = () => alive.current && generation.current === requestGeneration;
    setLoading(true);
    setError("");
    try {
      const signer = service ?? getStoredSwapSigner();
      if (!signer) throw new Error("Native mainnet portfolio is unavailable in this build.");
      const result = validateMainnetPortfolio(await signer.getMainnetPortfolio(), session.walletId);
      if (result.fundingAddress.toLowerCase() !== session.address.toLowerCase())
        throw new Error("Funding account mismatch");
      if (current()) setSnapshot(result);
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : "Mainnet balance unavailable. Retry.");
    } finally {
      if (current()) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [session.walletId, session.address, service]);
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (alive.current) return refresh();
    });
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);
  return { session, snapshot, loading, error, refresh };
}
const Context = createContext<ReturnType<typeof useMainnetState> | null>(null);
export function MainnetWalletProvider({
  session,
  children,
  service,
}: PropsWithChildren<{ session: MainnetWalletSession; service?: MainnetPortfolioService }>) {
  // Changing wallets discards both the previous snapshot and its request ownership.
  return (
    <SessionPortfolioProvider
      key={`${session.walletId}:${session.address.toLowerCase()}`}
      session={session}
      service={service}
    >
      {children}
    </SessionPortfolioProvider>
  );
}

function SessionPortfolioProvider({
  session,
  children,
  service,
}: PropsWithChildren<{ session: MainnetWalletSession; service?: MainnetPortfolioService }>) {
  const value = useMainnetState(session, service);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useMainnetWallet() {
  const value = useContext(Context);
  if (!value) throw new Error("Mainnet wallet provider required");
  return value;
}

export function useOptionalMainnetWallet() {
  return useContext(Context);
}
