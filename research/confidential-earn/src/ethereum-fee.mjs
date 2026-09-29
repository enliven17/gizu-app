export function nextBlockBaseFee({baseFeePerGas,gasUsed,gasLimit}) {
  if(typeof baseFeePerGas!=='bigint'||typeof gasUsed!=='bigint'||typeof gasLimit!=='bigint'||baseFeePerGas<0n||gasLimit<=0n||gasUsed<0n||gasUsed>gasLimit) throw new Error('Invalid Ethereum block gas data');
  const target=gasLimit/2n;
  if(target===0n) throw new Error('Invalid Ethereum block gas target');
  if(gasUsed===target) return baseFeePerGas;
  if(gasUsed>target) {
    const increase=baseFeePerGas*(gasUsed-target)/target/8n;
    return baseFeePerGas+(increase>0n?increase:1n);
  }
  return baseFeePerGas-baseFeePerGas*(target-gasUsed)/target/8n;
}

export function nextBlockBid(block,priorityFeePerGas) {
  if(typeof priorityFeePerGas!=='bigint'||priorityFeePerGas<=0n) throw new Error('Invalid priority fee');
  return {maxFeePerGas:nextBlockBaseFee(block)+priorityFeePerGas,maxPriorityFeePerGas:priorityFeePerGas};
}

export function priorityFromFeeHistory(history) {
  const tips=history.reward?.map(row=>row?.[0]);
  if(!tips?.length||tips.some(tip=>typeof tip!=='bigint'||tip<0n)) throw new Error('Invalid Ethereum priority history');
  tips.sort((a,b)=>a<b?-1:a>b?1:0);
  const median=tips[Math.floor(tips.length/2)];
  return median>10_000n?median:10_000n;
}

export function assertBundlerFeeFloor(bid,floor) {
  if(bid.maxFeePerGas<floor.maxFeePerGas||bid.maxPriorityFeePerGas<floor.maxPriorityFeePerGas) {
    throw new Error(`Pimlico's slow quote is ${floor.maxFeePerGas} wei maximum fee and ${floor.maxPriorityFeePerGas} wei priority fee; the market bid is below this relay quote. No operation signed.`);
  }
}

export function bundlerMinimumFromError(error) {
  const match=/maxFeePerGas must be at least (\d+)/.exec(error?.details??'');
  return match?BigInt(match[1]):null;
}

export function bundlerVerificationFloorFromError(error,currentLimit) {
  const match=/verificationGas should have extra (\d+) gas\. has only (-?\d+)/.exec(error?.details??'');
  if(!match) return null;
  const floor=currentLimit+BigInt(match[1])-BigInt(match[2])+5_000n;
  if(floor>500_000n) throw new Error('Bundler verification gas requirement exceeds the ERC-4337 limit');
  return floor;
}

export function assertBidBlock(quotedBlock,currentBlock) {
  if(quotedBlock!==currentBlock) throw new Error('Ethereum next-block fee bid is stale; prepare a fresh operation');
}

export function replacementBid(nextBid,previousBid) {
  const minimumTip=(previousBid.maxPriorityFeePerGas*110n+99n)/100n;
  const minimumMax=(previousBid.maxFeePerGas*110n+99n)/100n;
  const tip=nextBid.maxPriorityFeePerGas>minimumTip?nextBid.maxPriorityFeePerGas:minimumTip;
  const nextBase=nextBid.maxFeePerGas-nextBid.maxPriorityFeePerGas;
  const maxFee=nextBase+tip;
  if(maxFee<minimumMax) throw new Error('Next-block fee cannot replace the pending operation with the bundler 10% bump');
  return {maxFeePerGas:maxFee,maxPriorityFeePerGas:tip};
}

export function bidForRetry(nextBid,previousBid,previousStatus) {
  return previousStatus==='rejected_by_bundler'?nextBid:replacementBid(nextBid,previousBid);
}

export function promoteWinningAttempt(record,winning) {
  if(winning===record) return record;
  const attempts=[...(record.attempts??[]),record].filter(attempt=>attempt!==winning).map(({attempts:_nested,...attempt})=>attempt);
  return {...winning,attempts};
}
