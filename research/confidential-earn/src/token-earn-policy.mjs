import {getAddress,size,sliceHex} from 'viem';
import {ceilDiv} from './native-gas.mjs';
export function tokenCostCap(op,token){
 const d=op.paymasterData;
 // Reject optional constant-fee, prefunding and recipient extensions until
 // their charging semantics are implemented and tested explicitly.
 if(!d||size(d)<182||Number(BigInt(sliceHex(d,0,1)))>>1!==1||sliceHex(d,1,2)!=='0x00')throw new Error('Unsupported token paymaster configuration');
 if(getAddress(sliceHex(d,14,34))!==getAddress(token))throw new Error('Paymaster token changed');
 const gas=['preVerificationGas','callGasLimit','verificationGasLimit','paymasterPostOpGasLimit','paymasterVerificationGasLimit'].reduce((sum,k)=>sum+op[k],0n);
 const rate=BigInt(sliceHex(d,50,82)),post=BigInt(sliceHex(d,34,50));
 if(rate<=0n||op.maxFeePerGas<=0n||gas<=0n)throw new Error('Invalid paymaster price/gas');
 return ceilDiv((gas+post)*op.maxFeePerGas*rate,10n**18n);
}
export async function planTokenDeposit({balance,estimate}){
 let amount=balance>1n?balance-1n:0n;
 for(let i=0;i<8;i++){
  if(amount<=0n)throw new Error('Insufficient balance for deposit and withdrawal reserve');
  const plan=await estimate(amount);
  const next=balance-plan.feeCap-plan.withdrawalReserve;
  if(next<=0n)throw new Error('Insufficient balance for deposit and withdrawal reserve');
  if(amount<=next)return {...plan,amount};
  amount=next;
 }
 throw new Error('Deposit gas budget did not converge');
}
export async function planTokenReturn({balance,estimate,price,nativeValue=0n,initialAmount}){
 if(initialAmount!==undefined&&(typeof initialAmount!=='bigint'||initialAmount<=0n||initialAmount>balance))throw new Error('Invalid quoted return amount');
 let amount=initialAmount??(balance>1n?balance-1n:0n);
 for(let i=0;i<8;i++){
  if(amount<=0n)throw new Error('Insufficient token balance for return');
  const plan=await estimate(amount),reserve=balance-amount;
  if(plan.feeCap<=reserve){
   if(ceilDiv(reserve*price,1000000n)+nativeValue>=500000n)throw new Error('Final residual upper bound is >=0.5 USDC; wait for a fresh market quote');
   return {...plan,amount,reserve,optimalUpperBound:ceilDiv(reserve*price,1000000n)+nativeValue<100000n};
  }
  amount=balance-plan.feeCap;
 }
 throw new Error('Return gas budget did not converge');
}
export function assertFinalResidual({token,native,tokenPrice,nativePrice}){
 const usdcValue=ceilDiv(token*tokenPrice,1000000n)+ceilDiv(native*nativePrice,10n**18n);
 if(usdcValue>=500000n)throw new Error('Combined final residual is >=0.5 USDC');
 return {usdcValue,optimal:usdcValue<100000n};
}
