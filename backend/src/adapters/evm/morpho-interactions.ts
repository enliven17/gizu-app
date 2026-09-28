import { encodeFunctionData, parseAbi } from "viem";
import type { ContractCall, DepositInput, MorphoMarketInput, MorphoMarketInteractions, MorphoVaultInteractions, PreparedDeposit, VaultWithdrawInput } from "../../ports/protocol-interactions.port.ts";
import { checkedAddress, checkedAmount, contractCall } from "./contract-call.ts";

const vaultAbi = parseAbi([
  "function deposit(uint256 assets, address onBehalf) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address onBehalf) returns (uint256)",
]);

const marketAbi = parseAbi([
  "function supply((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,bytes data) returns (uint256,uint256)",
  "function withdraw((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams,uint256 assets,uint256 shares,address onBehalf,address receiver) returns (uint256,uint256)",
]);

export class MorphoVaultV2Interactions implements MorphoVaultInteractions {
  prepareDeposit(input: DepositInput): PreparedDeposit {
    const asset = checkedAddress(input.asset);
    const account = checkedAddress(input.account);
    const contract = checkedAddress(input.contract);
    const assets = checkedAmount(input.assets);
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [assets, account] });
    return {
      approval: { token: asset, spender: contract, amount: assets },
      call: contractCall(input.chainId, contract, data),
    };
  }

  prepareWithdraw(input: VaultWithdrawInput): ContractCall {
    const account = checkedAddress(input.account);
    const data = encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdraw",
      args: [checkedAmount(input.assets), account, account],
    });
    return contractCall(input.chainId, input.contract, data);
  }
}

export class MorphoBlueInteractions implements MorphoMarketInteractions {
  prepareSupply(input: MorphoMarketInput): PreparedDeposit {
    const contract = checkedAddress(input.contract);
    const account = checkedAddress(input.account);
    const assets = checkedAmount(input.assets);
    const market = this.marketParams(input);
    const data = encodeFunctionData({
      abi: marketAbi,
      functionName: "supply",
      args: [market, assets, 0n, account, "0x"],
    });
    return {
      approval: { token: market.loanToken, spender: contract, amount: assets },
      call: contractCall(input.chainId, contract, data),
    };
  }

  prepareWithdraw(input: MorphoMarketInput): ContractCall {
    const account = checkedAddress(input.account);
    const data = encodeFunctionData({
      abi: marketAbi,
      functionName: "withdraw",
      args: [this.marketParams(input), checkedAmount(input.assets), 0n, account, account],
    });
    return contractCall(input.chainId, input.contract, data);
  }

  private marketParams(input: MorphoMarketInput) {
    if (input.market.lltv < 0n) {
      throw new RangeError("lltv must not be negative");
    }
    return {
      loanToken: checkedAddress(input.market.loanToken),
      collateralToken: checkedAddress(input.market.collateralToken),
      oracle: checkedAddress(input.market.oracle),
      irm: checkedAddress(input.market.irm),
      lltv: input.market.lltv,
    };
  }
}
