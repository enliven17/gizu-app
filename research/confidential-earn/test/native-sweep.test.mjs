import test from 'node:test';
import assert from 'node:assert/strict';
import * as gas from '../src/native-gas.mjs';

test('cycle completion counts ETH as well as USDC, including the exact acceptance boundary',()=>{
 const price=3000000000n;
 assert.throws(()=>gas.assertCycleComplete({usdc:0n,eth:800000000000000n,shares:0n,ethPriceUsdc:price}),/residual/i);
 assert.throws(()=>gas.assertCycleComplete({usdc:500000n,eth:0n,shares:0n,ethPriceUsdc:price}),/residual/i);
 assert.throws(()=>gas.assertCycleComplete({usdc:0n,eth:0n,shares:1n,ethPriceUsdc:price}),/shares/i);
 const result=gas.assertCycleComplete({usdc:0n,eth:0n,shares:0n,ethPriceUsdc:price});
 assert.equal(result.totalUsdcAtoms,0n);assert.equal(result.optimal,true);
 assert.equal(gas.assertCycleComplete({usdc:1n,eth:33333333333333n,shares:0n,ethPriceUsdc:price}).optimal,false);
});
test('empty-recipient native sweep deducts the fixed inclusion price and exact measured gas',()=>{
 const p=gas.nativeSweepPlan({balance:800000000000000n,gasPrice:1000000000n,estimatedGas:21000n,recipientCode:'0x'});
 assert.equal(p.value,779000000000000n);
 assert.equal(p.value+p.gas*p.gasPrice,800000000000000n);
 assert.throws(()=>gas.nativeSweepPlan({balance:20000000000000n,gasPrice:1000000000n,estimatedGas:21000n,recipientCode:'0x'}),/shortfall/i);
 assert.throws(()=>gas.nativeSweepPlan({balance:800000000000000n,gasPrice:1000000000n,estimatedGas:25000n,recipientCode:'0x1234'}),/recipient|gas/i);
 assert.throws(()=>gas.nativeSweepPlan({balance:800000000000000n,gasPrice:1000000000n,estimatedGas:21001n,recipientCode:'0x'}),/gas/i);
});
