import { demoModeEnabled } from "@/config/demo";
import type { EarnOwner } from "@/domain/earn/types";
import { demoVaultMetadata, isDemoVaultId } from "./opportunities";
import type { OwnedPortfolioPosition } from "@/domain/wallet/storedSigner";

export type DemoVaultQuote = {
  id: string;
  vaultId: string;
  amountAtoms: string;
  feeAtoms: string;
  receiveAtoms: string;
  expiresAt: number;
};
type Position = { balance: bigint; revision: number };
type SavedQuote = DemoVaultQuote & {
  ownerKey: string;
  revision: number;
  kind: "deposit" | "withdrawal";
};
const sampleVaultIds = [
  "demo-aave-usdc",
  "demo-morpho-pendle-usdc",
  "demo-morpho-steakhouse-usdg",
  "demo-curvance-high-yield-ausd",
];

/** Mock total route cost: 0.1%, rounded up to the next USDC atom. */
export function demoVaultFeeAtoms(amount: bigint): bigint {
  return (amount + 999n) / 1000n;
}

/** Demo-only USDC valuations: each catalog vault starts with a mock 250 USDC position. */
export function createDemoVaultService(now = () => Date.now()) {
  const startingPosition: Position = { balance: 250_000_000n, revision: 0 };
  const positions = new Map<string, Position>();
  const quotes = new Map<string, SavedQuote>();
  const completed = new Map<string, DemoVaultQuote>();
  let sequence = 0;
  function key(owner: EarnOwner, vaultId: string) {
    if (!demoModeEnabled()) throw new Error("Demo withdrawals are turned off.");
    if (!owner.walletId || !owner.address || !/^0x[0-9a-f]{40}$/i.test(owner.address))
      throw new Error("Sign in to your wallet before withdrawing.");
    if (!isDemoVaultId(vaultId)) throw new Error("This vault is not part of the demo.");
    return JSON.stringify([owner.walletId, owner.address.toLowerCase(), vaultId]);
  }
  function publicQuote(quote: DemoVaultQuote): DemoVaultQuote {
    return {
      id: quote.id,
      vaultId: quote.vaultId,
      amountAtoms: quote.amountAtoms,
      feeAtoms: quote.feeAtoms,
      receiveAtoms: quote.receiveAtoms,
      expiresAt: quote.expiresAt,
    };
  }
  return {
    balance(owner: EarnOwner, vaultId: string): string {
      return (positions.get(key(owner, vaultId)) ?? startingPosition).balance.toString();
    },
    /** Home and Withdraw read the same mock investment values for this wallet. */
    portfolioPositions(owner: EarnOwner): OwnedPortfolioPosition[] {
      const ids = new Set(sampleVaultIds);
      for (const positionKey of positions.keys()) {
        const [walletId, address, vaultId] = JSON.parse(positionKey) as [string, string, string];
        if (walletId === owner.walletId && address === owner.address?.toLowerCase())
          ids.add(vaultId);
      }
      return [...ids].flatMap((id) => {
        const balance = (positions.get(key(owner, id)) ?? startingPosition).balance;
        if (balance === 0n) return [];
        const vault = demoVaultMetadata(id)!;
        const asset = vault.asset!;
        const priceAtoms = BigInt(Math.round(vault.tokens[0]!.price! * 1_000_000));
        const underlying = ((balance * 10n ** BigInt(asset.decimals)) / priceAtoms).toString();
        return [
          {
            assetId: id,
            chainId: vault.chainId,
            token: "",
            symbol: asset.symbol,
            decimals: asset.decimals,
            balanceAtoms: underlying,
            observedAtoms: underlying,
            complete: true,
            stale: false,
            checkedAt: now(),
            valueUsdcAtoms: balance.toString(),
            valuationUnavailable: false,
            shareDecimals: asset.decimals,
            conversionEstimated: false,
            shareAtoms: underlying,
            underlyingAtoms: underlying,
            observedUnderlyingAtoms: underlying,
          },
        ];
      });
    },
    review(owner: EarnOwner, vaultId: string, amountAtoms: string): DemoVaultQuote {
      const ownerKey = key(owner, vaultId);
      const position = positions.get(ownerKey) ?? startingPosition;
      if (!/^[1-9]\d{0,77}$/.test(amountAtoms)) throw new Error("Enter a valid withdrawal amount.");
      const amount = BigInt(amountAtoms);
      if (amount > position.balance) throw new Error("This amount exceeds your vault balance.");
      const fee = demoVaultFeeAtoms(amount);
      if (amount <= fee) throw new Error("Enter a larger amount to cover the estimated fee.");
      const saved: SavedQuote = {
        id: `demo-vault-withdrawal-${now()}-${++sequence}`,
        kind: "withdrawal",
        vaultId,
        ownerKey,
        revision: position.revision,
        amountAtoms,
        feeAtoms: fee.toString(),
        receiveAtoms: (amount - fee).toString(),
        expiresAt: now() + 60_000,
      };
      quotes.set(saved.id, saved);
      return publicQuote(saved);
    },
    confirm(owner: EarnOwner, quoteId: string): DemoVaultQuote {
      const quote = quotes.get(quoteId);
      if (!quote || quote.kind !== "withdrawal" || quote.ownerKey !== key(owner, quote.vaultId))
        throw new Error("This withdrawal belongs to another wallet.");
      const receipt = completed.get(quoteId);
      if (receipt) return publicQuote(receipt);
      if (now() >= quote.expiresAt)
        throw new Error("The estimate expired. Review your withdrawal again.");
      const position = positions.get(quote.ownerKey) ?? startingPosition;
      if (position.revision !== quote.revision || position.balance < BigInt(quote.amountAtoms))
        throw new Error("Your vault balance changed. Review your withdrawal again.");
      positions.set(quote.ownerKey, {
        balance: position.balance - BigInt(quote.amountAtoms),
        revision: position.revision + 1,
      });
      const result = publicQuote(quote);
      completed.set(quoteId, result);
      return publicQuote(result);
    },
    reviewDeposit(
      owner: EarnOwner,
      vaultId: string,
      amountAtoms: string,
      cashAtoms: string,
    ): DemoVaultQuote {
      const ownerKey = key(owner, vaultId);
      if (!/^[1-9]\d{0,77}$/.test(amountAtoms)) throw new Error("Enter a valid deposit amount.");
      const amount = BigInt(amountAtoms);
      if (amount > BigInt(cashAtoms))
        throw new Error("Enter an amount within your available USDC.");
      const fee = demoVaultFeeAtoms(amount);
      if (amount <= fee) throw new Error("Enter a larger amount to cover the estimated fee.");
      const quote: SavedQuote = {
        id: `demo-vault-deposit-${now()}-${++sequence}`,
        kind: "deposit",
        ownerKey,
        revision: (positions.get(ownerKey) ?? startingPosition).revision,
        vaultId,
        amountAtoms,
        feeAtoms: fee.toString(),
        receiveAtoms: (amount - fee).toString(),
        expiresAt: now() + 60_000,
      };
      quotes.set(quote.id, quote);
      return publicQuote(quote);
    },
    confirmDeposit(owner: EarnOwner, quoteId: string, cashAtoms: string): DemoVaultQuote {
      const quote = quotes.get(quoteId);
      if (!quote || quote.kind !== "deposit" || quote.ownerKey !== key(owner, quote.vaultId))
        throw new Error("This deposit belongs to another wallet.");
      const receipt = completed.get(quoteId);
      if (receipt) return publicQuote(receipt);
      if (now() >= quote.expiresAt)
        throw new Error("The estimate expired. Review your deposit again.");
      if (BigInt(cashAtoms) < BigInt(quote.amountAtoms))
        throw new Error("Available USDC changed. Review your deposit again.");
      const position = positions.get(quote.ownerKey) ?? startingPosition;
      if (position.revision !== quote.revision)
        throw new Error("Your vault balance changed. Review your deposit again.");
      positions.set(quote.ownerKey, {
        balance: position.balance + BigInt(quote.receiveAtoms),
        revision: position.revision + 1,
      });
      const result = publicQuote(quote);
      completed.set(quoteId, result);
      return publicQuote(result);
    },
    reset() {
      positions.clear();
      quotes.clear();
      completed.clear();
    },
  };
}

export const demoVaults = createDemoVaultService();
