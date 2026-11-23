import test from 'node:test';import assert from 'node:assert/strict';
import{hasStoredSession,needsAuthClient}from'./supabaseLoader.js';
const store=keys=>({length:keys.length,key:i=>keys[i]});
test('signed-out landing visitors do not need the Auth client',()=>{
 assert.equal(needsAuthClient(store(['td_theme','td_lang']),{error:'',hasCredentials:false}),false);
 assert.equal(needsAuthClient(null,{error:'',hasCredentials:false}),false);
});
test('a saved session or auth return in the URL loads the Auth client',()=>{
 assert.equal(hasStoredSession(store(['sb-abcd-auth-token'])),true);
 assert.equal(needsAuthClient(store([]),{error:'',hasCredentials:true}),true);
 assert.equal(needsAuthClient(store([]),{error:'otp_expired',hasCredentials:false}),true);
 assert.equal(hasStoredSession({get length(){throw Error('blocked');}}),false);
});
