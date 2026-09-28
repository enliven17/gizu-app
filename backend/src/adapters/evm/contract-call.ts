import { getAddress, type Address, type Hex } from "viem";
import type { ContractCall, EvmAddress, EvmData } from "../../ports/protocol-interactions.port.ts";

export function checkedAddress(address: EvmAddress): Address {
  return getAddress(address);
}

export function checkedAmount(amount: bigint): bigint {
  if (amount <= 0n) {
    throw new RangeError("amount must be positive");
  }
  return amount;
}

export function checkedChainId(chainId: number): number {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new RangeError("chainId must be a positive safe integer");
  }
  return chainId;
}

export function contractCall(chainId: number, to: EvmAddress, data: Hex): ContractCall {
  return {
    chainId: checkedChainId(chainId),
    to: checkedAddress(to),
    data: data as EvmData,
    value: 0n,
  };
}
