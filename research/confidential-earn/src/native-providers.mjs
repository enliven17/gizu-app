import {orderFromQuote,quoteNativeEth,typedDataForViem,usdcPermit} from './fusion-bootstrap.mjs';
export async function prepareFusion({client,owner,input,requiredEth,apiKey,before,fees,economics}) {
 if(typeof fees?.depositFee!=='bigint'||fees.depositFee<=0n)throw new Error('Fusion resolver fee plan is required before signing');
 const block=await client.getBlock();
 const deadline=(block.timestamp>BigInt(Math.floor(Date.now()/1000))?block.timestamp:BigInt(Math.floor(Date.now()/1000)))+1800n;
 const permit=await usdcPermit({client,owner,amount:input,deadline});
 const quote=await quoteNativeEth({owner:owner.address,input,apiKey,permit,enableEstimate:true,resolverGasPrice:fees.depositFee,minimumResolverGas:economics?.estimatedGas});
 if(!quote.response.quoteId)throw new Error('Fusion estimated quote has no quoteId; no order submitted');
 const {order,minimumEth}=orderFromQuote({...quote,permit});
 if(minimumEth<requiredEth)throw new Error('Executable Fusion quote no longer covers the ETH requirement; re-plan');
 const signature=await owner.signTypedData(typedDataForViem(order.getTypedData(1)));
 return {hash:order.getOrderHash(1),deadline:order.deadline,input,minimumEth,before,fromBlock:block.number,nonce:order.nonce,economics:quote.economics,quoteSnapshot:quote.response,
  payload:{order:order.build(),signature,quoteId:quote.response.quoteId,extension:order.extension.encode()}};
}
export async function submitFusion({apiKey,payload,fetcher=fetch}) {
 if(!payload.quoteId)throw new Error('Fusion submission requires quoteId');
 let result;
 try{result=await fetcher('https://api.1inch.com/fusion/relayer/v2.0/1/order/submit',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});}
 catch{throw new Error('Fusion submission uncertain; saved order must be reconciled before another order');}
 if(!result.ok)throw new Error(`Fusion submission HTTP ${result.status}; retain saved order until reconciled or expired`);
}
export async function fusionStatus({apiKey,hash,fetcher=fetch}) {
 let result;try{result=await fetcher(`https://api.1inch.com/fusion/orders/v2.0/1/order/status/${hash}`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(20000)});}catch{throw new Error('Fusion status unavailable');}
 if(result.status===404)return null;
 if(!result.ok)throw new Error(`Fusion status HTTP ${result.status}`);
 return result.json();
}
export async function auroraStatus({apiKey,route,fetcher=fetch}) {
 const url=new URL(`https://intents-api.aurora.dev/api/status/${encodeURIComponent(apiKey)}`);url.searchParams.set('depositAddress',route.recipient);
 let result;try{result=await fetcher(url,{signal:AbortSignal.timeout(20000)});}catch{throw new Error('Aurora status unavailable');}
 if(!result.ok)throw new Error(`Aurora status HTTP ${result.status}`);
 const data=await result.json();
 if(typeof data.status!=='string')throw new Error('Invalid Aurora route status');
 return {status:data.status,checkedAt:new Date().toISOString()};
}
