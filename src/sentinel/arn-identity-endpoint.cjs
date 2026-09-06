'use strict';
const crypto=require('node:crypto');
const {ArkIdentityStore}=require('./ark-identity-store.cjs');
function resolveArnIdentity(discordUserId,store=new ArkIdentityStore()) {
  if(!/^\d{5,25}$/.test(discordUserId))throw new Error('INVALID_DISCORD_ID');
  const profile=store.profileByDiscord(discordUserId);
  const accounts=(profile?.arkAccounts || []).filter(a=>Number.isFinite(Date.parse(a.verifiedAt)) && /^[A-Za-z0-9_-]{8,128}$/.test(a.eosId));
  const ids=[...new Set(accounts.map(a=>a.eosId))];
  if(ids.length!==1)throw new Error('SINGLE_VERIFIED_ACCOUNT_REQUIRED');
  return {discordUserId,playerId:ids[0],verified:true};
}
function arnAuthorized(header,secret) {
 if(typeof secret!=='string'||secret.length<32)return false;
 const a=Buffer.from(String(header||'')),b=Buffer.from(`Bearer ${secret}`);
 return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function handleArnIdentity(req,res,url,{secret=process.env.ARN_SENTINAL_JOB_SECRET,store}={}) {
 if(url.pathname!=='/arn/identity')return false;
 const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
 if(!arnAuthorized(req.headers.authorization,secret)){send(401,{error:'UNAUTHORIZED'});return true;}
 if(req.method!=='GET'){send(405,{error:'METHOD_NOT_ALLOWED'});return true;}
 try{send(200,resolveArnIdentity(url.searchParams.get('discordUserId'),store));}
 catch{send(409,{error:'VERIFIED_IDENTITY_UNAVAILABLE'});}
 return true;
}
module.exports={resolveArnIdentity,arnAuthorized,handleArnIdentity};
