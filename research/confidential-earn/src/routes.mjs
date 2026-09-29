import {defineChain,getAddress,erc20Abi,parseAbi} from 'viem';
import {mainnet} from 'viem/chains';
export const robinhood=defineChain({id:4663,name:'Robinhood',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.mainnet.chain.robinhood.com']}}});
const profiles={
 ethereum:{id:'ethereum',chain:mainnet,blockchain:'eth',symbol:'USDC',token:getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),vault:getAddress('0x55C1B6e461a6334B567bAF0FEb5D728715446f05'),directory:'.local/ethereum',rpcEnv:'ETHEREUM_RPC_URL',rpc:'https://ethereum-rpc.publicnode.com'},
 robinhood:{id:'robinhood',chain:robinhood,blockchain:'hood',symbol:'USDG',token:getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),vault:getAddress('0xBeEff033F34C046626B8D0A041844C5d1A5409dd'),directory:'.local/robinhood',rpcEnv:'ROBINHOOD_RPC_URL',rpc:'https://rpc.mainnet.chain.robinhood.com'},
};
export function routeProfile(name){if(!Object.hasOwn(profiles,name))throw new Error('Route must be ethereum or robinhood');return profiles[name];}
export function routeEnvironment(name,env){
 const profile=routeProfile(name),next={...env,EARN_ROUTE:profile.id};
 // Both routes intentionally use DEST1/DEST2, as requested by the user.
 // Each new route creates its own confidential signer; never reuse legacy C.
 delete next.CONFIDENTIAL_PK;
 return next;
}
export function assertRouteState(state,profile){if(state.route!==profile.id||state.chainId!==profile.chain.id)throw new Error('Routing state belongs to a different route/chain');}

export async function assertNewRouteVaultReady(profile,client,owner,{allowExisting=false,expectedShares}={}){
 const asset=await client.readContract({address:profile.vault,abi:parseAbi(['function asset() view returns(address)']),functionName:'asset'});
 if(getAddress(asset)!==profile.token)throw new Error('Selected vault underlying differs from route token');
 const shares=await client.readContract({address:profile.vault,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
 if(shares!==0n&&!(allowExisting&&profile.id==='ethereum'))throw new Error('Destination wallet 2 already owns vault shares; resolve its existing cycle or use a fresh wallet before funding');
 if(expectedShares!==undefined&&shares!==expectedShares)throw new Error('Existing vault share baseline changed before funding');
 if(profile.id==='robinhood'&&await client.getBalance({address:owner})!==0n)throw new Error('New Robinhood cycle requires zero destination ETH before funding');
 return shares;
}
