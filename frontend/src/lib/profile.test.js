import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../../profile.js',import.meta.url),'utf8');
test('saving visible profile fields preserves hidden trading and age details',async()=>{
 const dom=new JSDOM('<div id="profileEditor"></div>',{url:'https://tradedesk.example/app',runScripts:'outside-only'}),w=dom.window,writes=[];
 try{
  w.$=selector=>w.document.querySelector(selector);w.esc=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');w.userEmail='alex@example.com';
  w.loadWorkspace=async()=>{};w.setAvatar=()=>{};w.renderSettings=()=>{};
  w.TDLocale={language:'en',languages:[['en','English']],setLanguage:async()=>{}};
  w.wsApi=async(path,method,body)=>{writes.push(body);return {settings:body.settings,revision:8};};
  w.eval(source+"\nPF.data={revision:7,settings:{firstName:'Alex',experience:'5+ years',markets:'BTC',tradingLevel:'professional',ageGroup:'35-44',language:'en'}};renderProfileEditor()");
  for(const name of ['experience','markets','tradingLevel','ageGroup'])assert.equal(w.document.querySelector('[name="'+name+'"]'),null);
  w.document.querySelector('[name=firstName]').value='Sam';
  await w.document.querySelector('form').onsubmit(new w.Event('submit',{cancelable:true}));
  assert.equal(writes.length,1);assert.equal(writes[0].revision,7);assert.equal(writes[0].settings.firstName,'Sam');
  for(const [key,value] of Object.entries({experience:'5+ years',markets:'BTC',tradingLevel:'professional',ageGroup:'35-44'}))assert.equal(writes[0].settings[key],value);
  assert.equal(w.document.querySelector('#pfStatus').textContent,'Profile saved.');
 }finally{w.close();}
});
