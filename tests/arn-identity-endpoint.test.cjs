'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {handleArnIdentity,resolveArnIdentity}=require('../src/sentinel/arn-identity-endpoint.cjs');
const valid={eosId:'player0001',verifiedAt:'2026-09-05T12:00:00Z'};
const store={profileByDiscord:()=>({arkAccounts:[valid]})};
test('ARN receives only a single verified account; ambiguous/unverified links fail closed',()=>{
 assert.deepEqual(resolveArnIdentity('123456',store),{discordUserId:'123456',playerId:'player0001',verified:true});
 for(const accounts of [[],[{eosId:'player0001'}],[valid,{...valid,eosId:'player0002'}]])assert.throws(()=>resolveArnIdentity('123456',{profileByDiscord:()=>({arkAccounts:accounts})}));
});
test('dedicated ARN credential authorizes only identity route',()=>{
 const secret='x'.repeat(32),url=new URL('https://example.test/arn/identity?discordUserId=123456');
 const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
 handleArnIdentity({method:'GET',headers:{authorization:'wrong'}},res,url,{secret,store});assert.equal(res.status,401);
 handleArnIdentity({method:'GET',headers:{authorization:`Bearer ${secret}`}},res,url,{secret,store});assert.equal(res.status,200);
 assert.equal(handleArnIdentity({headers:{}},res,new URL('https://example.test/v1/ark/execute'),{secret,store}),false);
});
