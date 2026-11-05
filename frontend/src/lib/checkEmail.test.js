import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{JSDOM}from'jsdom';
import{confirmationRedirect}from'./authReturn.js';
const shim=readFileSync(new URL('../cloud/shim.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const index=readFileSync(new URL('../../../index.html',import.meta.url),'utf8');
const submit=index.match(/\$\('#loginForm'\)\.addEventListener\('submit',async e=>\{[\s\S]*?\n\}\);/)[0];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(query='?signup=1'){
 const dom=new JSDOM('<div id="loginScreen"><div class="login-left"><h1></h1><p class="sub"></p><form id="loginForm"><div id="loginNameField"><input id="loginName"></div><input id="loginEmail" type="email"><input id="loginPass" type="password"><a class="forgot"></a><div id="loginErr"></div><button class="login-btn"></button></form><div class="login-foot"></div></div></div>',{runScripts:'outside-only',url:'https://tradedesk.example/app'+query});
 const w=dom.window,calls={signup:[],resend:[],boot:0};let bridge;
 w.Headers=Headers;w.Response=Response;w.config={apiUrl:'https://api.example'};w.SUPPORT_EMAIL='support@example.com';w.confirmationRedirect=confirmationRedirect;w.initialAuthReturn={error:'',hasCredentials:false};w.api={};w.__td={resolve:value=>bridge=value};
 w.TDLocale={language:'en',languages:[['en','English']],translate:text=>text};
 w.supabase={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>{},signUp:async value=>{calls.signup.push(value);return{data:{session:null},error:null};},resend:async value=>{calls.resend.push(value);return{error:null};}}};
 w.eval(shim);await tick();w.$=selector=>w.document.querySelector(selector);w.setAvatar=()=>{};w.hideLogin=()=>{};w.boot=()=>{calls.boot++;};w.userEmail='';w.fetch=(url,init)=>bridge.handle(url,init||{},()=>{});w.eval(submit);
 return{dom,w,calls};
}
test('a new signup shows the illustrated inbox card with the actual email and no password retained',async()=>{
 const {dom,w,calls}=await setup();try{w.document.querySelector('#loginEmail').value='trader@gmail.com';w.document.querySelector('#loginName').value='Trader';w.document.querySelector('#loginPass').value='StrongPassword123';w.document.querySelector('#loginForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(calls.signup[0].options.emailRedirectTo,'https://tradedesk.example/auth/confirm');assert.equal(calls.boot,0);assert.equal(w.document.querySelector('.auth-check').hidden,false);assert.equal(w.document.querySelector('#checkEmailAddress').textContent,'trader@gmail.com');assert.equal(w.document.querySelector('#loginPass').value,'');assert.equal(w.document.querySelector('#checkEmailOpen').href,'https://mail.google.com/mail/u/0/#inbox');assert.equal(w.location.search,'?check_email=1');}finally{dom.window.close();}
});
test('resend uses the production callback and throttles repeat clicks',async()=>{
 const {dom,w,calls}=await setup();try{w.showCheckEmail('trader@example.com');w.document.querySelector('#checkEmailResend').click();await tick();assert.equal(calls.resend.length,1);assert.equal(calls.resend[0].options.emailRedirectTo,'https://tradedesk.example/auth/confirm');w.document.querySelector('#checkEmailResend').click();await tick();assert.equal(calls.resend.length,1);assert.ok(w.document.querySelector('#checkEmailStatus').textContent.includes('wait'));}finally{dom.window.close();}
});
test('the email address is text-only and users can return to sign-in',async()=>{
 const {dom,w}=await setup();try{w.showCheckEmail('<img src=x onerror=alert(1)>@example.com');assert.equal(w.document.querySelector('#checkEmailAddress img'),null);w.document.querySelector('#checkEmailBack').click();assert.equal(w.document.querySelector('.auth-check').hidden,true);assert.equal(w.document.querySelector('.login-left').classList.contains('show-check-email'),false);assert.equal(w.document.querySelector('h1').textContent,'Welcome back');}finally{dom.window.close();}
});
test('expired confirmation returns display a clear message and resend control',async()=>{
 const {dom,w}=await setup('?auth_error=expired');try{assert.ok(w.document.querySelector('#loginErr').textContent.includes('expired'));assert.equal(w.document.querySelector('.auth-form-resend').hidden,false);assert.equal(w.document.querySelector('h1').textContent,'Welcome back');assert.equal(w.location.search,'');}finally{dom.window.close();}
});
