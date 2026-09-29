import {encodeFunctionData,erc20Abi,getAddress} from 'viem';
import {vaultV2Deposit,vaultV2Redeem} from '@morpho-org/morpho-sdk';
import {vaultV2Abi} from '@morpho-org/morpho-sdk/abis';
import {vaultAddress} from './vault-deposit.mjs';
import {ceilDiv} from './native-gas.mjs';

export const usdc=getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
export const vault=vaultAddress;
const plain=tx=>({to:tx.to,data:tx.data,value:tx.value??0n});
export async function tokenBalance(client,token,owner) {
 return client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
}
async function withApproval(client,token,owner,amount,tx) {
 const allowance=await client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[owner,tx.to]});
 return [...(allowance<amount?[{to:token,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[tx.to,amount]}),value:0n}]:[]),plain(tx)];
}
export async function depositCalls({client,owner,amount,deadline,slippageBps=10n}) {
 if(amount<=0n||slippageBps<0n||slippageBps>100n)throw new Error('Invalid deposit or slippage');
 const shares=await client.readContract({address:vault,abi:vaultV2Abi,functionName:'previewDeposit',args:[amount]});
 if(shares<=0n)throw new Error('Deposit would produce no shares');
 const maxSharePrice=ceilDiv(amount*10n**27n*(10000n+slippageBps),shares*10000n);
 const tx=vaultV2Deposit({vault:{chainId:1,address:vault,asset:usdc},args:{amount,userAddress:owner,maxSharePrice,deadline}});
 return {calls:await withApproval(client,usdc,owner,amount,tx),previewShares:shares,maxSharePrice};
}
export async function redeemCalls({client,owner,shares,deadline}) {
 if(shares<=0n)throw new Error('No shares to redeem');
 const tx=vaultV2Redeem({vault:{chainId:1,address:vault},args:{shares,userAddress:owner,deadline}});
 return {calls:await withApproval(client,vault,owner,shares,tx)};
}
export function auroraTransfer({recipient,amount}) {
 if(amount<=0n)throw new Error('No USDC to return');
 return {to:usdc,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[getAddress(recipient),amount]}),value:0n};
}
