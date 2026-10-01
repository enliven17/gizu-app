import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { vaultV2Deposit, vaultV2Redeem } from "@morpho-org/morpho-sdk";
import { vaultV2Abi } from "@morpho-org/morpho-sdk/abis";
import { ceilDiv } from "./policy.ts";
export const ETHEREUM_PROFILE = {
  chainId: 1,
  usdc: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
  weth: getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
  vault: getAddress("0x55C1B6e461a6334B567bAF0FEb5D728715446f05"),
  router: getAddress("0x02912516d49dE997db75B9D7858faAE59209650B"),
  nativeToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  settlement: "0x399740157391a9f1bf4e9921a8834f9bc8f2678e",
  resolverFeeReceiver: "0x90cbe4bdd538d6e9b379bff5fe72c3d67a521de5",
} as const;
export type ExactCall = { to: Address; data: Hex; value?: bigint };
export async function balance(
  client: PublicClient,
  token: Address,
  owner: Address,
  blockNumber?: bigint,
) {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
    blockNumber,
  });
}
async function withApproval(
  client: PublicClient,
  token: Address,
  owner: Address,
  amount: bigint,
  tx: ExactCall,
) {
  if (
    tx.to.toLowerCase() !== ETHEREUM_PROFILE.router.toLowerCase() ||
    (tx.value ?? 0n) !== 0n
  )
    throw new Error("Unapproved vault router semantics");
  const allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, tx.to],
  });
  return [
    ...(allowance < amount
      ? [
          {
            to: token,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [tx.to, amount],
            }),
            value: 0n,
          },
        ]
      : []),
    { to: tx.to, data: tx.data, value: 0n },
  ];
}
export async function depositCalls(
  client: PublicClient,
  owner: Address,
  amount: bigint,
  deadline: bigint,
) {
  if (amount <= 0n) throw new Error("Invalid deposit");
  const previewShares = await client.readContract({
    address: ETHEREUM_PROFILE.vault,
    abi: vaultV2Abi,
    functionName: "previewDeposit",
    args: [amount],
  });
  if (previewShares <= 0n) throw new Error("No shares preview");
  const maxSharePrice = ceilDiv(
    amount * 10n ** 27n * 10010n,
    previewShares * 10000n,
  );
  const tx = vaultV2Deposit({
    vault: {
      chainId: 1,
      address: ETHEREUM_PROFILE.vault,
      asset: ETHEREUM_PROFILE.usdc,
    },
    args: { amount, userAddress: owner, maxSharePrice, deadline },
  });
  return {
    calls: await withApproval(client, ETHEREUM_PROFILE.usdc, owner, amount, tx),
    previewShares,
    maxSharePrice,
  };
}
export async function redeemCalls(
  client: PublicClient,
  owner: Address,
  shares: bigint,
  deadline: bigint,
) {
  if (shares <= 0n) throw new Error("No redeemable shares");
  const tx = vaultV2Redeem({
    vault: { chainId: 1, address: ETHEREUM_PROFILE.vault },
    args: { shares, userAddress: owner, deadline },
  });
  return withApproval(client, ETHEREUM_PROFILE.vault, owner, shares, tx);
}
