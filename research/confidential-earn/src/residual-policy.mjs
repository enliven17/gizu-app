export const residualLimitAtoms=500_000n;
export const optimalResidualAtoms=100_000n;

// For a successful deposit and an unchanged starting balance:
// residual = balance - amount - actualCharge <= balance - amount.
// This deliberately makes no optimistic assumption about consumed gas or refunds.
// It is not protection against unsolicited incoming transfers after the balance read.
export function circleResidualBound({balance,amount}) {
  if(typeof balance!=='bigint'||typeof amount!=='bigint'||balance<=0n||amount<=0n||amount>balance) throw new Error('Invalid residual accounting');
  const maximumResidualAtoms=balance-amount;
  return {maximumResidualAtoms,accepted:maximumResidualAtoms<residualLimitAtoms,optimal:maximumResidualAtoms<optimalResidualAtoms};
}

export function assertCircleResidualBound(plan) {
  const result=circleResidualBound(plan);
  if(!result.accepted) throw new Error(`Circle residual bound ${result.maximumResidualAtoms} atoms is not below 500000; a projected refund is insufficient. No operation should be signed or submitted.`);
  return result;
}

export function settledVaultStatus(afterBalance) {
  if(typeof afterBalance!=='bigint'||afterBalance<0n) throw new Error('Invalid settled USDC balance');
  return afterBalance<residualLimitAtoms?'complete':'residual_exceeded';
}

export function refreshStoredResidualStatus(state) {
  const deposit=state.vaultDeposits?.[1];
  if(deposit?.status==='complete'&&deposit.afterBalanceAtoms!==undefined) {
    deposit.status=settledVaultStatus(BigInt(deposit.afterBalanceAtoms));
    if(state.phase==='completed'&&deposit.status==='residual_exceeded') state.phase='residual_exceeded';
  }
}
