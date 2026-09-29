// One immutable source-balance snapshot for both tests, including source gas.
const cap=10000000n;
export function createTestBudget({balance,source,token,block}){
 if(typeof balance!=='bigint'||balance<=0n)throw new Error('No Monad USDC balance to allocate');
 const ethereum=balance*7n/10n,robinhood=balance-ethereum;
 if(ethereum<=0n||robinhood<=0n)throw new Error('Balance must fund both tests');
 if(ethereum>cap||robinhood>cap)throw new Error('70/30 allocation exceeds the existing 10 USDC per-test cap');
 return {version:1,chainId:143,source,token,block:String(block),balanceAtoms:String(balance),weights:'70/30',payoutWeights:'10/90',allocations:{ethereum:String(ethereum),robinhood:String(robinhood)},createdAt:new Date().toISOString()};
}
export function allocatedBudget(plan,{route,source,token,balance}){
 if(plan.version!==1||plan.chainId!==143||plan.weights!=='70/30'||plan.payoutWeights!=='10/90')throw new Error('Unsupported saved test allocation');
 if(plan.source.toLowerCase()!==source.toLowerCase())throw new Error('Saved allocation source changed');
 if(plan.token.toLowerCase()!==token.toLowerCase())throw new Error('Saved allocation token changed');
 if(!['ethereum','robinhood'].includes(route))throw new Error('Unknown allocation route');
 const expected=createTestBudget({balance:BigInt(plan.balanceAtoms),source,token,block:plan.block});
 if(plan.allocations.ethereum!==expected.allocations.ethereum||plan.allocations.robinhood!==expected.allocations.robinhood)throw new Error('Saved allocations do not match the 70/30 snapshot');
 const amount=BigInt(plan.allocations[route]);
 if(balance<amount)throw new Error('Current source balance cannot cover this reserved test budget');
 return amount;
}
