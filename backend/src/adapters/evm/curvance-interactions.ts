import { encodeFunctionData, parseAbi } from "viem";
import type { ContractCall, CurvanceInteractions, DepositInput, PreparedDeposit } from "../../ports/protocol-interactions.port.ts";
import { checkedAddress, checkedAmount, contractCall } from "./contract-call.ts";

const cTokenAbi = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);

export class CurvanceCTokenInteractions implements CurvanceInteractions {
  prepareDeposit(input: DepositInput): PreparedDeposit {
    const asset = checkedAddress(input.asset);
    const account = checkedAddress(input.account);
    const contract = checkedAddress(input.contract);
    const assets = checkedAmount(input.assets);
    const data = encodeFunctionData({ abi: cTokenAbi, functionName: "deposit", args: [assets, account] });
    return {
      approval: { token: asset, spender: contract, amount: assets },
      call: contractCall(input.chainId, contract, data),
    };
  }

  prepareRedeem(input: { chainId: number; contract: `0x${string}`; account: `0x${string}`; shares: bigint }): ContractCall {
    const account = checkedAddress(input.account);
    const data = encodeFunctionData({
      abi: cTokenAbi,
      functionName: "redeem",
      args: [checkedAmount(input.shares), account, account],
    });
    return contractCall(input.chainId, input.contract, data);
  }
}
