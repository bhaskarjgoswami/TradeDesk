import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../../onboarding.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup({existing=false,completed=false,fail=false,initialProfile={}}={}){
 const dom=new JSDOM('<!doctype html><button id="home">Journal</button>',{url:'https://tradedesk.example/app',runScripts:'outside-only'});const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 w.PF={data:{revision:4,settings:{firstName:'Alex',country:'GB',bio:'My strategy',onboardingCompleted:completed,...initialProfile}}};w.tdNewAccount=!existing;w.tdSignupName='Alex Trader';w.esc=s=>String(s).replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]));w.pfCountries=()=>[['GB','United Kingdom'],['IN','India']];w.pfPaintAvatar=()=>{};
 w.TDLocale={languages:[['en','English'],['hi','हिन्दी']],language:'en',apply:()=>{},setLanguage:async code=>{w.TDLocale.language=code;return true;}};const writes=[];w.wsApi=async(path,method,body)=>{writes.push({path,method,body});if(fail)throw Error('Try again');return {settings:body.settings,revision:5};};w.eval(source);w.maybeOnboarding();return {dom,w,writes};
}
test('existing accounts and completed onboarding do not get a signup modal',()=>{for(const options of [{existing:true},{completed:true}]){const {dom,w}=setup(options);assert.equal(w.document.querySelector('#welcomeDialog'),null);dom.window.close();}});
test('single-question cards retain choices and save every answer to the existing profile',async()=>{
 const {dom,w,writes}=setup();try{
  const d=w.document.querySelector('#welcomeDialog');assert.ok(d.open);
  const active=()=>d.querySelector('[data-welcome-step][data-active="true"]').dataset.question;
  assert.equal(active(),'country');d.querySelector('input[name=countryChoice][value=IN]').click();
  d.querySelector('#welcomeNext').click();assert.equal(active(),'language');d.querySelector('input[name=language][value=hi]').click();await tick();
  d.querySelector('#welcomeNext').click();assert.equal(active(),'tradingLevel');d.querySelector('input[name=tradingLevel][value=professional]').click();
  d.querySelector('#welcomeNext').click();assert.equal(active(),'ageGroup');d.querySelector('input[name=ageGroup][value="25-34"]').click();
  d.querySelector('#welcomeNext').click();assert.equal(active(),'gender');d.querySelector('input[name=gender][value=woman]').click();
  d.querySelector('#welcomeBack').click();assert.equal(active(),'ageGroup');assert.equal(d.querySelector('input[name=ageGroup]:checked').value,'25-34');
  d.querySelector('#welcomeNext').click();assert.equal(d.querySelector('input[name=gender]:checked').value,'woman');assert.equal(d.querySelector('.welcome-progress').getAttribute('aria-valuenow'),'5');
  d.querySelector('#welcomeNext').click();assert.equal(active(),'name');d.querySelector('[name=displayName]').value='Alex T';
  d.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();assert.equal(writes.length,1);
  const {body}=writes[0];assert.equal(body.revision,4);assert.equal(body.settings.bio,'My strategy');assert.equal(body.settings.displayName,'Alex T');assert.equal(body.settings.lastName,'Trader');assert.equal(body.settings.country,'IN');assert.equal(body.settings.language,'hi');assert.equal(body.settings.tradingLevel,'professional');assert.equal(body.settings.gender,'woman');assert.equal(body.settings.ageGroup,'25-34');assert.equal(body.settings.onboardingCompleted,true);assert.equal('countryChoice' in body.settings,false);assert.equal(w.document.querySelector('#welcomeDialog'),null);w.maybeOnboarding();assert.equal(w.document.querySelector('#welcomeDialog'),null);
 }finally{dom.window.close();}
});
test('searching countries preserves the selected country when its row is filtered out',async()=>{
 const {dom,w,writes}=setup();try{
  const d=w.document.querySelector('#welcomeDialog'),search=d.querySelector('#welcomeCountrySearch');
  search.value='India';search.dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('[name=countryChoice]').length,1);d.querySelector('[name=countryChoice]').click();
  search.value='United';search.dispatchEvent(new w.Event('input'));assert.equal(d.querySelector('[name=countryChoice]').value,'GB');assert.equal(d.querySelector('[name=country]').value,'IN');
  d.querySelector('[data-welcome-skip]').click();await tick();assert.equal(writes[0].body.settings.country,'IN');
 }finally{dom.window.close();}
});
test('choosing not to share age clears a previously saved age group',async()=>{
 const {dom,w,writes}=setup({initialProfile:{ageGroup:'25-34'}});try{
  const d=w.document.querySelector('#welcomeDialog');for(let i=0;i<3;i++)d.querySelector('#welcomeNext').click();
  d.querySelector('input[name=ageGroup][value=""]').click();d.querySelector('[data-welcome-skip]').click();await tick();assert.equal(writes[0].body.settings.ageGroup,'');
 }finally{dom.window.close();}
});
test('skip saves optional blanks once and does not ask again',async()=>{const {dom,w,writes}=setup();try{w.document.querySelector('[data-welcome-skip]').click();await tick();assert.equal(writes.length,1);assert.equal(writes[0].body.settings.gender,'');assert.equal(writes[0].body.settings.ageGroup,'');assert.equal(writes[0].body.settings.onboardingCompleted,true);assert.equal(w.PF.data.settings.firstName,'Alex');assert.equal(w.document.querySelector('#welcomeDialog'),null);}finally{dom.window.close();}});
test('save failure retains the entered answers and allows retry without completing onboarding',async()=>{const {dom,w,writes}=setup({fail:true});try{w.document.querySelector('[name=country]').value='IN';w.document.querySelector('[data-welcome-skip]').click();await tick();assert.equal(writes.length,1);const d=w.document.querySelector('#welcomeDialog');assert.ok(d);assert.equal(d.querySelector('[name=country]').value,'IN');assert.equal(d.querySelector('#welcomeStatus').textContent,'Try again');assert.equal(d.querySelector('#welcomeNext').disabled,false);assert.equal(w.PF.data.settings.onboardingCompleted,false);}finally{dom.window.close();}});

test('an unavailable profile is not mistaken for a fresh signup',()=>{
 const {dom,w}=setup({existing:true});try{w.tdNewAccount=true;w.PF.data={settings:{},revision:0};w.maybeOnboarding();assert.equal(w.document.querySelector('#welcomeDialog'),null);}finally{dom.window.close();}
});

test('country search accepts English country names while the interface is localized',()=>{
 const {dom,w}=setup();try{
  w.pfCountries=()=>[['GB','यूनाइटेड किंगडम'],['IN','भारत']];
  const search=w.document.querySelector('#welcomeCountrySearch');search.value='India';search.dispatchEvent(new w.Event('input'));
  assert.equal(w.document.querySelectorAll('[name=countryChoice]').length,1);assert.equal(w.document.querySelector('[name=countryChoice]').value,'IN');
 }finally{dom.window.close();}
});

test('carousel has no visible top bar and exposes only the active card to keyboard navigation',()=>{
 const {dom,w,writes}=setup();try{
  const d=w.document.querySelector('#welcomeDialog');
  assert.equal(d.querySelector('.welcome-head'),null);assert.equal(d.querySelector('.welcome-brand'),null);assert.equal(d.querySelector('.welcome-close'),null);
  assert.equal(d.querySelectorAll('.welcome-slide').length,6);assert.equal(d.querySelector('#welcomeBack').disabled,true);assert.equal(d.dataset.edge,'start');
  d.querySelector('#welcomeAdvance').click();assert.equal(d.querySelector('[data-active="true"]').dataset.question,'language');
  assert.equal(d.querySelector('[data-question="country"]').inert,true);assert.equal(d.querySelector('[data-question="language"]').inert,false);
  d.querySelector('[data-welcome-peek="5"]').click();assert.equal(d.querySelector('[data-active="true"]').dataset.question,'name');assert.equal(d.querySelector('#welcomeAdvance').disabled,true);assert.equal(d.dataset.edge,'end');assert.equal(writes.length,0);
 }finally{dom.window.close();}
});
test('carousel arrow keys navigate cards without taking over text-input arrow keys',()=>{
 const {dom,w}=setup();try{
  const d=w.document.querySelector('#welcomeDialog'),search=d.querySelector('#welcomeCountrySearch');
  search.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(d.querySelector('[data-active="true"]').dataset.question,'country');
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(d.querySelector('[data-active="true"]').dataset.question,'language');
  w.document.documentElement.dir='rtl';d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.equal(d.querySelector('[data-active="true"]').dataset.question,'tradingLevel');
 }finally{dom.window.close();}
});
