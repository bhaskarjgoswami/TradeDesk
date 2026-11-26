import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

function setup({fail=false}={}){
  const dom=new JSDOM('<button id="addTradeBtn"></button><div id="ws-trades"></div><div id="ws-tradeview"></div><div id="ws-trade"></div>',{url:'https://example.com/app#trades',runScripts:'outside-only'}),w=dom.window,calls=[];
  for(const name of ['notes','management','mistakes','strategy'])Object.defineProperty(w.HTMLFormElement.prototype,name,{get(){return this.elements.namedItem(name);}});
  w.$=s=>w.document.querySelector(s);w.$$=s=>Array.from(w.document.querySelectorAll(s));w.esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  w.allTrades=[1,2].map(id=>({id,revision:1,date:'2026-11-26',symbol:'BTCUSD',direction:'Short',pnl:-id,entry:100,exit:101,images:JSON.stringify(['images/chart.png']),plan:JSON.stringify({charts:{htf:'images/chart.png'}}),review:JSON.stringify({execution:'Good'})}));
  w.WS={items:{strategy:[]},prefs:{settings:{currency:'USD'}}};w.view='trades';w.selectedDate=null;w.settingsLoaded=true;w.wsActions={};w.wsNewTrade=()=>{};w.wsJson=(v,f={})=>v?JSON.parse(v):f;w.wsReview=t=>w.wsJson(t.review);w.wsClosed=t=>t.pnl!=null;w.wsReviewed=t=>!!w.wsReview(t).reviewed;w.wsNet=t=>t.pnl;w.wsSign=n=>n<0?'neg':'pos';w.wsNum=String;w.money=n=>n.toFixed(2);w.wsBtn=()=>'';w.wsLocalDate=()=> '2026-11-26';w.wsDate=String;w.toast=()=>{};w.confirm=()=>true;w.calShowDay=()=>{};
  w.renderWorkspaceView=key=>{if(key==='trades')w.renderTradesList();};w.setView=v=>{w.view=v;w.renderWorkspaceView(v);};
  w.upsertTrade=row=>{w.allTrades=w.allTrades.map(t=>t.id===row.id?row:t);w.renderTradesList();};
  w.fetch=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {ok:!fail,json:async()=>fail?{error:'This trade changed in another tab.'}:{...body,id:Number(url.split('/').at(-1)),revision:2}};};
  w.eval(['trade.js','trades-list.js'].map(file=>readFileSync(new URL('../../../'+file,import.meta.url),'utf8')).join('\n')+'\nwindow.reviewState=TD;window.queueState=TL;');w.queueState.tab='review';w.renderTradesList();
  return {dom,w,calls};
}

test('review queue reuses full trade details, chart previews and reflection fields',()=>{
  const {dom,w}=setup();try{const panel=w.$('#tlPanel');assert.ok(panel.querySelector('.td-left'));assert.equal(panel.querySelector('.tf-charts img').getAttribute('src'),'/images/chart.png');assert.equal(panel.querySelector('fieldset').disabled,false);assert.ok(panel.querySelector('[name=management]'));assert.equal(panel.querySelector('#tdSave').textContent,'Save and next');assert.equal(panel.querySelector('#tdNext'),null);}finally{dom.window.close();}
});
test('save and next preserves trade facts and advances only after a confirmed save',async()=>{
  const {dom,w,calls}=setup();try{const id=w.reviewState.id,original=w.allTrades.find(t=>t.id===id),form=w.$('#tdForm');form.notes.value='Wait for confirmation';await form.onsubmit(new w.Event('submit',{cancelable:true}));assert.equal(calls.length,1);assert.equal(calls[0].body.expectedRevision,1);assert.equal(calls[0].body.images,original.images);assert.equal(calls[0].body.entry,100);assert.equal(JSON.parse(calls[0].body.review).execution,'Good');assert.equal(JSON.parse(calls[0].body.review).reviewed,true);assert.notEqual(w.reviewState.id,id);await w.$('#tdForm').onsubmit(new w.Event('submit',{cancelable:true}));assert.match(w.$('#tlPanel').textContent,/All caught up/);}finally{dom.window.close();}
});
test('a rejected review keeps edits and does not advance',async()=>{
  const {dom,w}=setup({fail:true});try{const id=w.reviewState.id,form=w.$('#tdForm');form.notes.value='Keep this draft';await form.onsubmit(new w.Event('submit',{cancelable:true}));assert.equal(w.reviewState.id,id);assert.equal(w.$('#tdForm').notes.value,'Keep this draft');assert.match(w.$('#tdStatus').textContent,/changed in another tab/);assert.equal(w.$('#tdSave').disabled,false);}finally{dom.window.close();}
});
test('skip respects unsaved changes, keeps trades unreviewed and supports restarting',()=>{
  const {dom,w,calls}=setup();try{const id=w.reviewState.id;w.reviewState.dirty=true;w.confirm=()=>false;w.$('#tdSkip').click();assert.equal(w.reviewState.id,id);w.confirm=()=>true;w.$('#tdSkip').click();assert.notEqual(w.reviewState.id,id);w.$('#tdSkip').click();assert.ok(w.$('#tlRestart'));assert.equal(calls.length,0);w.$('#tlRestart').click();assert.ok(w.$('#tdForm'));}finally{dom.window.close();}
});
test('normal trade details are read only until Edit trade is clicked',async()=>{
  const {dom,w,calls}=setup();try{w.openTradeDetail(1);const form=w.$('#ws-tradeview #tdForm');assert.equal(form.querySelector('fieldset').disabled,true);assert.ok(form.notes.matches(':disabled'));assert.equal(w.$('#ws-tradeview #tdSave'),null);assert.ok(w.$('#ws-tradeview [data-td-add]').disabled);await form.onsubmit(new w.Event('submit',{cancelable:true}));assert.equal(calls.length,0);let edited;w.openTradePage=t=>{edited=t.id;};w.$('#ws-tradeview #tdEdit').click();assert.equal(edited,1);}finally{dom.window.close();}
});
