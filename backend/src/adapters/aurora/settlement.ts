import { InfrastructureError } from "../../domain/errors/infrastructure-error.ts";
import { authenticateEarnRead,type ReadAuthentication } from "./confidential-balance.ts";
import { monadUsdcAssetId,ethereumUsdcAssetId,robinhoodUsdgAssetId } from "./assets.ts";
import { auroraApi } from "./http.ts";
export type SettlementExpectation={operationId:string;revision:number;depositAddress:string;sourceOwner:string;confidentialAccount:string;originAsset:string;amountAtoms:string;minimumCreditAtoms:string;transactionHash:string};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid history");return value as Record<string,unknown>;}
function same(a:unknown,b:string){return typeof a==="string"&&a.toLowerCase()===b.toLowerCase();}
function atoms(a:unknown):a is string {return typeof a==="string"&&/^[1-9][0-9]{0,77}$/.test(a)&&BigInt(a)<(1n<<256n);}
function decimalAtoms(value:unknown,decimals:number):bigint {
 if(typeof value!=="string"||value.length>100||!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))throw new Error("Invalid history quantity");
 const [whole,fraction=""]=value.split(".");if(fraction.length>decimals)throw new Error("Unexpected precision");
 const result=BigInt(whole+fraction.padEnd(decimals,"0"));if(result>=(1n<<256n))throw new Error("History quantity too large");return result;
}
/** Only a native protected journal can associate this independently authenticated
 * history evidence with an approved operation. The expectation is not a proof.
 * No aggregate balance increase or public SUCCESS status establishes credit. */
export class ConfidentialSettlement {
 private occupied=new Set<string>();
 constructor(private key?:string,private fetcher:typeof fetch=fetch,private now:()=>number=Date.now){}
 async read(auth:ReadAuthentication,expected:SettlementExpectation){
  if(!this.key)throw new InfrastructureError(503,"EARN_SETTLEMENT_UNCONFIGURED","Authenticated settlement provider is not configured.");
  let signer:string;
  try {
   const addr=(a:string)=>/^0x[0-9a-f]{40}$/i.test(a)&&!/^0x0{40}$/i.test(a);
   if(!/^[-a-zA-Z0-9_]{1,128}$/.test(expected.operationId)||!Number.isSafeInteger(expected.revision)||expected.revision<1||![expected.sourceOwner,expected.confidentialAccount,expected.depositAddress].every(addr)||new Set([expected.sourceOwner,expected.confidentialAccount,expected.depositAddress].map(a=>a.toLowerCase())).size!==3||!atoms(expected.amountAtoms)||!atoms(expected.minimumCreditAtoms)||!/^0x[0-9a-f]{64}$/i.test(expected.transactionHash)||!new Set([monadUsdcAssetId,ethereumUsdcAssetId,robinhoodUsdgAssetId,"nep141:eth.omft.near"]).has(expected.originAsset))throw new Error("Invalid settlement expectation");
   signer=await authenticateEarnRead(auth,this.now);if(!same(signer,expected.confidentialAccount))throw new Error("Wrong confidential owner");
  }catch{throw new InfrastructureError(400,"INVALID_EARN_SETTLEMENT_AUTH","A fresh native read authorization and saved origin operation are required.");}
  const scope=signer+":"+expected.depositAddress.toLowerCase();
  if(this.occupied.has(scope)||this.occupied.size>=32)throw new InfrastructureError(429,"EARN_SETTLEMENT_BUSY","Settlement reconciliation is already running.");
  this.occupied.add(scope);
  try {
   const session=await auroraApi(this.key,this.fetcher,"auth/authenticate/{key}",{signedData:auth});
   if(typeof session.accessToken!=="string"||!session.accessToken||session.accessToken.length>8192)throw new Error("Invalid session");
   const query=new URLSearchParams({depositAddress:expected.depositAddress,status:"SUCCESS",depositType:"ORIGIN_CHAIN",recipientType:"CONFIDENTIAL_INTENTS",refundType:"ORIGIN_CHAIN",limit:"100"});
   const history=await auroraApi(this.key,this.fetcher,`account/history/{key}?${query}`,undefined,session.accessToken);
   if(!Array.isArray(history.items)||history.items.length>100)throw new Error("Invalid settlement history");
   const matches=history.items.map(object).filter(row=>same(row.depositAddress,expected.depositAddress));
   if(matches.length>1)throw new Error("Ambiguous quote history");
   const row=matches[0];let creditedAtoms="0",status:"credited"|"awaitingSettlement"="awaitingSettlement";
   if(row?.status==="SUCCESS"){
    if(row.depositType!=="ORIGIN_CHAIN"||row.recipientType!=="CONFIDENTIAL_INTENTS"||row.refundType!=="ORIGIN_CHAIN"||row.originAsset!==expected.originAsset||row.destinationAsset!==monadUsdcAssetId||!same(row.recipient,signer)||!same(row.refundTo,expected.sourceOwner)||row.depositMemo!=null||!Array.isArray(row.quoteTransactions)||row.quoteTransactions.length!==1)throw new Error("Settlement route changed");
    const created=typeof row.createdAt==="string"?Date.parse(row.createdAt):NaN;
    if(!Number.isSafeInteger(created)||created>this.now()+5000)throw new Error("Invalid settlement timestamp");
    const tx=object(row.quoteTransactions[0]);
    if(!same(tx.sender,expected.sourceOwner)||!same(tx.txHash,expected.transactionHash))throw new Error("Origin settlement differs");
    if(decimalAtoms(row.amountInFormatted,expected.originAsset==="nep141:eth.omft.near"?18:6)!==BigInt(expected.amountAtoms))throw new Error("Actual input changed");
    const credit=decimalAtoms(row.amountOutFormatted,6);if(credit<BigInt(expected.minimumCreditAtoms))throw new Error("Confidential credit below reviewed minimum");
    creditedAtoms=credit.toString();status="credited";
   }
   return {operationId:expected.operationId,revision:expected.revision,confidentialAddress:signer,assetId:monadUsdcAssetId,depositAddress:expected.depositAddress,transactionHash:expected.transactionHash,creditedAtoms,timestampMs:this.now(),authenticated:true as const,operationScoped:true as const,status};
  }catch{throw new InfrastructureError(502,"EARN_SETTLEMENT_UNAVAILABLE","Could not verify operation-specific confidential credit. Reconcile before proceeding.");}
  finally{this.occupied.delete(scope);}
 }
}
