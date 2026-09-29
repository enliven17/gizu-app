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

export function promoteWinningAttempt(record,winning) {
  if(winning===record) return record;
  const attempts=[...(record.attempts??[]),record].filter(attempt=>attempt!==winning).map(({attempts:_nested,...attempt})=>attempt);
  return {...winning,attempts};
}
