export type EvmAddress = `0x${string}`;
export type EvmData = `0x${string}`;

export type ContractCall = {
  chainId: number;
  to: EvmAddress;
  data: EvmData;
  value: bigint;
};

export type TokenApproval = {
  token: EvmAddress;
  spender: EvmAddress;
  amount: bigint;
};

export interface TokenInteractions {
  prepareApproval(chainId: number, approval: TokenApproval): ContractCall;
}

export type PreparedDeposit = {
  approval: TokenApproval;
  call: ContractCall;
};

export type DepositInput = {
  chainId: number;
  contract: EvmAddress;
  asset: EvmAddress;
  account: EvmAddress;
  assets: bigint;
};

export type WithdrawInput = DepositInput;

export type VaultWithdrawInput = {
  chainId: number;
  contract: EvmAddress;
  account: EvmAddress;
  assets: bigint;
};

export interface AaveInteractions {
  prepareSupply(input: DepositInput): PreparedDeposit;
  prepareWithdraw(input: WithdrawInput): ContractCall;
}

export interface MorphoVaultInteractions {
  prepareDeposit(input: DepositInput): PreparedDeposit;
  prepareWithdraw(input: VaultWithdrawInput): ContractCall;
}

export type MorphoMarketParams = {
  loanToken: EvmAddress;
  collateralToken: EvmAddress;
  oracle: EvmAddress;
  irm: EvmAddress;
  lltv: bigint;
};

export type MorphoMarketInput = {
  chainId: number;
  contract: EvmAddress;
  account: EvmAddress;
  assets: bigint;
  market: MorphoMarketParams;
};

export interface MorphoMarketInteractions {
  prepareSupply(input: MorphoMarketInput): PreparedDeposit;
  prepareWithdraw(input: MorphoMarketInput): ContractCall;
}

export interface CurvanceInteractions {
  prepareDeposit(input: DepositInput): PreparedDeposit;
  prepareRedeem(input: {
    chainId: number;
    contract: EvmAddress;
    account: EvmAddress;
    shares: bigint;
  }): ContractCall;
}
