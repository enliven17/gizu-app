import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { registerEarnPlanningRoutes } from "../../src/http/routes/earn-planning.routes.ts";
test("deposit planning binds operation/revision and has no withdrawal or submission side effects",async()=>{
  const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  const calls:unknown[]=[];
  registerEarnPlanningRoutes(app,{plan:async(input)=>{calls.push(input);return {readOnly:true,executionAvailable:false} as never;}});
  const payload={owner:"0x"+"1".repeat(40),operationId:"earn-wallet1-ethereum",revision:1};
  const good=await app.inject({method:"POST",url:"/v1/earn/ethereum/deposit-plan",payload});
  assert.equal(good.statusCode,200);assert.equal(good.headers["cache-control"],"no-store");assert.deepEqual(calls,[payload]);
  for(const p of [{...payload,revision:0},{...payload,operationId:"x".repeat(129)},{...payload,withdraw:true},{...payload,existingSharesScope:"implicit"}])assert.equal((await app.inject({method:"POST",url:"/v1/earn/ethereum/deposit-plan",payload:p})).statusCode,400);
  assert.equal(calls.length,1);
  assert.equal((await app.inject({method:"POST",url:"/v1/earn/ethereum/withdraw",payload})).statusCode,404);
  await app.close();
});
test("source fee preview accepts only public exact-budget fields",async()=>{
  const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  const calls:unknown[]=[];
  registerEarnPlanningRoutes(app,undefined,{prepare:async(input)=>{calls.push(input);return {executionAvailable:false} as never;}});
  const payload={owner:"0x"+"1".repeat(40),recipient:"0x"+"2".repeat(40),amount:"100",budget:"200"};
  assert.equal((await app.inject({method:"POST",url:"/v1/earn/monad/funding-plan",payload})).statusCode,200);
  for(const p of [{...payload,amount:100},{...payload,budget:"1e6"},{...payload,privateKey:"secret"}])assert.equal((await app.inject({method:"POST",url:"/v1/earn/monad/funding-plan",payload:p})).statusCode,400);
  assert.deepEqual(calls,[payload]);await app.close();
});
