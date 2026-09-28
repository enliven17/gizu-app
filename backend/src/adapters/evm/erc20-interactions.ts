import { encodeFunctionData, parseAbi } from "viem";
import type { ContractCall, TokenApproval, TokenInteractions } from "../../ports/protocol-interactions.port.ts";
import { checkedAddress, checkedAmount, contractCall } from "./contract-call.ts";

const erc20Abi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

export class Erc20Interactions implements TokenInteractions {
  prepareApproval(chainId: number, approval: TokenApproval): ContractCall {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [checkedAddress(approval.spender), checkedAmount(approval.amount)],
    });
    return contractCall(chainId, approval.token, data);
  }
}
