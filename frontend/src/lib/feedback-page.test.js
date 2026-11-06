import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../../feedback-page.js',import.meta.url),'utf8');
function setup({failUpload=false,failSave=false,history=[]}={}){
 const dom=new JSDOM('<main id="feedbackPage"></main>',{url:'https://tradedesk.example/app#feedback',runScripts:'outside-only'}),w=dom.window,writes=[],uploads=[];
 w.esc=value=>String(value);w.crypto.randomUUID=()=> 'feedback-request-1';w.URL.createObjectURL=()=> 'blob:preview';w.URL.revokeObjectURL=()=>{};
 w.wsApi=async(...args)=>{if(args[0].includes("?"))return history;writes.push(args);if(failSave)throw Error('Please try again');return {id:1};};w.fetch=async(url,options)=>{uploads.push({url,options});return {ok:!failUpload,json:async()=>failUpload?{error:'Upload failed'}:{path:'images/example.png'}};};
 w.eval(source+'\nrenderFeedback()');return {dom,w,writes,uploads};
}
function attach(w,files){const input=w.document.querySelector('#feedbackFiles');Object.defineProperty(input,'files',{value:files,configurable:true});input.dispatchEvent(new w.Event('change'));}
test('feedback uploads an image on submission and saves its path with the message',async()=>{
 const {dom,w,writes,uploads}=setup();try{
  attach(w,[new w.File(['image'],'chart.png',{type:'image/png'})]);assert.equal(uploads.length,0);assert.equal(w.document.querySelectorAll('figure').length,1);
  w.document.querySelector('[name=message]').value='  Please improve chart zoom.  ';
  await w.document.querySelector('form').onsubmit(new w.Event('submit',{cancelable:true}));
  assert.equal(uploads.length,1);assert.equal(writes[0][0],'items');assert.equal(writes[0][2].kind,'feedback');assert.equal(writes[0][2].body.message,'Please improve chart zoom.');assert.deepEqual(Array.from(writes[0][2].body.images),['images/example.png']);assert.ok(w.document.querySelector('#feedbackAgain'));
 }finally{dom.window.close();}
});
test('images can be removed and invalid attachments are rejected',()=>{
 const {dom,w}=setup();try{
  attach(w,[new w.File(['x'],'bad.svg',{type:'image/svg+xml'})]);assert.equal(w.document.querySelectorAll('figure').length,0);
  attach(w,Array.from({length:4},(_,i)=>new w.File(['x'],i+'.png',{type:'image/png'})));assert.equal(w.document.querySelectorAll('figure').length,0);
  attach(w,[new w.File(['x'],'photo.png',{type:'image/png'})]);w.document.querySelector('figure button').click();assert.equal(w.document.querySelectorAll('figure').length,0);
 }finally{dom.window.close();}
});
test('failed uploads preserve the draft and never submit feedback without the image',async()=>{
 const {dom,w,writes}=setup({failUpload:true});try{
  attach(w,[new w.File(['x'],'photo.png',{type:'image/png'})]);w.document.querySelector('[name=message]').value='Something broke';
  await w.document.querySelector('form').onsubmit(new w.Event('submit',{cancelable:true}));assert.equal(writes.length,0);assert.equal(w.document.querySelector('[name=message]').value,'Something broke');assert.equal(w.document.querySelector('[type=submit]').disabled,false);assert.equal(w.document.querySelectorAll('figure').length,1);
 }finally{dom.window.close();}
});
test('failed saves retry without uploading the same image again',async()=>{
 const {dom,w,writes,uploads}=setup({failSave:true});try{
  attach(w,[new w.File(['x'],'photo.png',{type:'image/png'})]);w.document.querySelector('[name=message]').value='My suggestion';
  const form=w.document.querySelector('form');await form.onsubmit(new w.Event('submit',{cancelable:true}));await form.onsubmit(new w.Event('submit',{cancelable:true}));assert.equal(uploads.length,1);assert.equal(writes.length,2);assert.equal(writes[0][2].clientId,writes[1][2].clientId);
 }finally{dom.window.close();}
});


test('private support history renders replies as text and never interprets HTML',async()=>{
 const {dom,w}=setup({history:[{id:1,created_at:'2026-11-05',body:{message:'<img src=x onerror=alert(1)>'},support:{status:'triaged',reply:'<script>private reply</script>'}}]});try{await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(w.document.querySelector('article script'),null);
  assert.equal(w.document.querySelector('article img'),null);
  assert.equal(w.document.querySelector('blockquote').textContent,'<script>private reply</script>');
 }finally{dom.window.close();}
});
