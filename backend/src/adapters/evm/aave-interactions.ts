import { encodeFunctionData, parseAbi } from "viem";
import type { AaveInteractions, ContractCall, DepositInput, PreparedDeposit, WithdrawInput } from "../../ports/protocol-interactions.port.ts";
import { checkedAddress, checkedAmount, contractCall } from "./contract-call.ts";

const poolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

export class AaveV3Interactions implements AaveInteractions {
  prepareSupply(input: DepositInput): PreparedDeposit {
    const asset = checkedAddress(input.asset);
    const account = checkedAddress(input.account);
    const contract = checkedAddress(input.contract);
    const assets = checkedAmount(input.assets);
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: "supply",
      args: [asset, assets, account, 0],
    });
    return {
      approval: { token: asset, spender: contract, amount: assets },
      call: contractCall(input.chainId, contract, data),
    };
  }

  prepareWithdraw(input: WithdrawInput): ContractCall {
    const data = encodeFunctionData({
      abi: poolAbi,
      functionName: "withdraw",
      args: [checkedAddress(input.asset), checkedAmount(input.assets), checkedAddress(input.account)],
    });
    return contractCall(input.chainId, input.contract, data);
  }
}
