import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../../../index.html',import.meta.url),'utf8');
test('billing navigation stays inside the journal and selects its existing pane',()=>{
 const dom=new JSDOM('<div id="app"><div id="middle"></div><aside id="sidebar"></aside><div id="backdrop"></div><a class="navitem" data-view="billing"></a><div class="pane on" id="pane-month"></div><div class="pane" id="pane-billing"></div></div>',{url:'https://tradedesk.example/app',runScripts:'outside-only'}),w=dom.window;
 try{
  w.$=s=>w.document.querySelector(s);w.$$=s=>Array.from(w.document.querySelectorAll(s));w.closeDrawer=()=>{};let mounts=0;w.renderBilling=()=>mounts++;
  const source=html.slice(html.indexOf('function setView(v){'),html.indexOf('function openDrawer()'));
  w.eval('let view;'+source+'setView("billing")');
  assert.equal(mounts,1);assert.equal(w.location.hash,'#billing');assert.ok(w.document.querySelector('#pane-billing').classList.contains('on'));assert.ok(w.document.querySelector('[data-view=billing]').classList.contains('on'));assert.ok(w.document.querySelector('#app'));
  assert.match(html,/id="sidebarMembership" href="#billing"/);
 }finally{w.close();}
});
test('legacy billing URL redirects into the journal billing pane',()=>{
 const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
 assert.equal(config.redirects.find(row=>row.source==='/billing').destination,'/app#billing');
});
test('billing styles remain isolated while its content follows language changes',async()=>{
 const dom=new JSDOM('<div id="panel"></div><h1>Journal</h1>',{url:'https://tradedesk.example/app',pretendToBeVisual:true,runScripts:'outside-only'}),w=dom.window;
 try{
  const source=readFileSync(new URL('../cloud/billingHost.js',import.meta.url),'utf8').replace('export function','function');
  let language='en';w.testLocale={apply:scope=>{for(const node of scope.querySelectorAll('h1'))node.textContent=language==='en'?'Plans':'Planes';}};
  w.eval(source+';window.testHost=createBillingHost(document.querySelector("#panel"),"h1{color:red}",window.testLocale)');
  w.testHost.mount.innerHTML='<h1>Plans</h1>';await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(w.document.querySelectorAll('style').length,0);assert.equal(w.document.querySelector('h1').textContent,'Journal');
  language='es';w.dispatchEvent(new w.Event('td-language-change'));assert.equal(w.testHost.mount.querySelector('h1').textContent,'Planes');w.testHost.dispose();
 }finally{w.close();}
});

test('billing translates accessible labels when only an attribute changes',async()=>{
 const dom=new JSDOM('<div id="panel"></div>',{url:'https://tradedesk.example/app',pretendToBeVisual:true,runScripts:'outside-only'}),w=dom.window;
 try{
  const source=readFileSync(new URL('../cloud/billingHost.js',import.meta.url),'utf8').replace('export function','function');
  w.testLocale={apply:scope=>{for(const node of scope.querySelectorAll('[aria-label]')){const value=node.getAttribute('aria-label');if(value==='Plans')node.setAttribute('aria-label','Planes');if(value==='Current plan')node.setAttribute('aria-label','Plan actual');}}};
  w.eval(source+';window.testHost=createBillingHost(document.querySelector("#panel"),"",window.testLocale)');
  w.testHost.mount.innerHTML='<button aria-label="Plans">Pro</button>';await new Promise(resolve=>setTimeout(resolve,40));
  const button=w.testHost.mount.querySelector('button');assert.equal(button.getAttribute('aria-label'),'Planes');button.setAttribute('aria-label','Current plan');await new Promise(resolve=>setTimeout(resolve,40));assert.equal(button.getAttribute('aria-label'),'Plan actual');assert.equal(button.textContent,'Pro');w.testHost.dispose();
 }finally{w.close();}
});
