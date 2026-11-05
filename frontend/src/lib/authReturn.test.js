import test from 'node:test';
import assert from 'node:assert/strict';
import {captureAuthReturn,confirmationRedirect,finishEmailConfirmation} from './authReturn.js';
test('confirmation redirect always uses the current deployment origin',()=>{
 assert.equal(confirmationRedirect('https://trade-desk-dl66.vercel.app/app'),'https://trade-desk-dl66.vercel.app/auth/confirm');
 assert.equal(confirmationRedirect('http://localhost:5173'),'http://localhost:5173/auth/confirm');
 assert.throws(()=>confirmationRedirect('javascript:alert(1)'));
});
test('capture stores only flags and error codes, never access or refresh tokens',()=>{
 const state=captureAuthReturn('https://example.com/auth/confirm#access_token=secret-a&refresh_token=secret-b');
 assert.deepEqual(state,{error:'',hasCredentials:true});assert.ok(!JSON.stringify(state).includes('secret'));
});
test('an expired verification returns to live sign-in without logging out an existing session',async()=>{
 let touched=false;const auth={getSession(){touched=true;},signOut(){touched=true;}};
 const path=await finishEmailConfirmation(auth,{error:'otp_expired',hasCredentials:false});assert.equal(path,'/app?auth_error=expired');assert.equal(touched,false);
});
test('valid confirmation returns to sign-in and signs out only the local verification session',async()=>{
 let scope;const auth={getSession:async()=>({data:{session:{}},error:null}),signOut:async options=>{scope=options.scope;return {error:null};}};
 assert.equal(await finishEmailConfirmation(auth,{error:'',hasCredentials:true}),'/app?confirmed=1');assert.equal(scope,'local');
});
test('a direct callback visit cannot sign out a previously signed-in account',async()=>{
 const auth={getSession:()=>{throw Error('Should not read session');}};assert.equal(await finishEmailConfirmation(auth,{error:'',hasCredentials:false}),'/app?auth_error=invalid');
});
test('missing or failed auth sessions return a safe error rather than false confirmation',async()=>{
 for(const auth of [{getSession:async()=>({data:{session:null},error:null})},{getSession:async()=>{throw Error('network');}}])assert.equal(await finishEmailConfirmation(auth,{error:'',hasCredentials:true}),'/app?auth_error=invalid');
});

test('empty callback credential parameters are treated as an invalid direct visit',()=>{
 assert.equal(captureAuthReturn('https://example.com/auth/confirm?code=').hasCredentials,false);
 assert.equal(captureAuthReturn('https://example.com/auth/confirm#access_token=&refresh_token=').hasCredentials,false);
});
