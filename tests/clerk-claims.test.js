const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync}=require('node:crypto');
const jwt=require('jsonwebtoken');
const load=require('./load-module');
test('Clerk sessions require the configured issuer, subject, expiry and approved authorized party', async()=>{
    const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    const Provider=load('src/services/auth/ClerkAuthProvider.js',{
        'jwks-rsa':()=>({getSigningKey(kid,callback){callback(null,{getPublicKey:()=>publicKey});}}),
        '../../config/cors':{origin(origin,callback){callback(null,origin==='https://grammarflowt.vercel.app');}}
    },{process:{env:{CLERK_JWKS_URI:'https://clerk.example/.well-known/jwks.json'}},console:{log(){},warn(){},error(){}}});
    const provider=new Provider();
    const sign=(claims={})=>jwt.sign(Object.fromEntries(Object.entries({sub:'user_test',iss:'https://clerk.example',exp:Math.floor(Date.now()/1000)+60,azp:'https://grammarflowt.vercel.app',...claims}).filter(([,value])=>value!==undefined)),privateKey,{algorithm:'RS256',keyid:'test'});
    assert.equal((await provider.verifyToken(sign())).id,'user_test');
    for(const claims of [{iss:'https://other.example'},{azp:'https://untrusted.example'},{azp:''},{azp:[]},{sub:''},{exp:undefined},{exp:1}]){
        await assert.rejects(provider.verifyToken(sign(claims)));
    }
    assert.equal((await provider.verifyToken(sign({azp:undefined}))).id,'user_test');
    provider.jwksUri='https://api.clerk.com/v1/jwks';
    assert.equal((await provider.verifyToken(sign())).id,'user_test');
    await assert.rejects(provider.verifyToken(sign({iss:'https://api.clerk.com'})));
});
