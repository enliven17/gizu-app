import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { registerEarnRoutes } from "../../src/http/routes/earn.routes.ts";
test("preflight is a bounded read-only profile request and rejects extra wallet metadata",async()=>{
  const app=Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  const calls: unknown[]=[];
  registerEarnRoutes(app,{check:async(profileId,owner)=>{calls.push({profileId,owner}); return {readOnly:true,executionAvailable:false} as never;}});
  const request={profileId:"ethereum-usdc",owner:"0x"+"1".repeat(40)};
  const good=await app.inject({method:"POST",url:"/v1/earn/preflight",payload:request});
  assert.equal(good.statusCode,200); assert.deepEqual(calls,[request]);
  for(const payload of [{...request,sourceWallet:"0x"+"2".repeat(40)},{...request,profileId:"other"},{...request,owner:"not-owner"}]){
    const bad=await app.inject({method:"POST",url:"/v1/earn/preflight",payload}); assert.equal(bad.statusCode,400);
  }
  assert.equal(calls.length,1); await app.close();
});

test("native authentication route rejects extra metadata, limits body size and does not cache balances",async()=>{
  const app=Fastify();app.setValidatorCompiler(validatorCompiler);app.setSerializerCompiler(serializerCompiler);
  const calls:unknown[]=[];
  registerEarnRoutes(app,{check:async()=>({} as never)},{read:async(auth)=>{calls.push(auth);return {authenticated:true,operationScoped:false} as never;}});
  const signedData={standard:"erc191",payload:"{}",signature:"secp256k1:test"};
  const good=await app.inject({method:"POST",url:"/v1/earn/private-balance",payload:{signedData}});
  assert.equal(good.statusCode,200);assert.equal(good.headers["cache-control"],"no-store");
  for(const payload of [{signedData,sourceAddress:"extra"},{signedData:{...signedData,operation:"spend"}},{signedData:{...signedData,standard:"raw"}},{signedData:{...signedData,payload:"x".repeat(4096)}}]) {
    const bad=await app.inject({method:"POST",url:"/v1/earn/private-balance",payload});assert.ok([400,413].includes(bad.statusCode));
  }
  assert.equal(calls.length,1);await app.close();
});


test("retired joint routing endpoint cannot be enabled by a legacy adapter argument", async () => {
  const app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  const calls: unknown[] = [];
  const legacyRegistration = registerEarnRoutes as (...args: unknown[]) => void;
  legacyRegistration(app, { check: async () => ({} as never) }, undefined, { preview: async (body: unknown) => { calls.push(body); return {}; } });
  const response = await app.inject({ method: "POST", url: "/v1/earn/routing-preview", payload: {
    profileId: "ethereum-usdc", sourceAddress: "0x" + "1".repeat(40), confidentialAddress: "0x" + "2".repeat(40),
    destinations: ["0x" + "3".repeat(40), "0x" + "4".repeat(40)], amount: "1000000",
  } });
  assert.equal(response.statusCode, 404); assert.equal(calls.length, 0); await app.close();
});
