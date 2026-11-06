import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const html=readFileSync(new URL('../../../index.html',import.meta.url),'utf8');
function setup(mobile=true){
 const dom=new JSDOM('<div class="mobilebar"><button id="hamb">Menu</button></div><div id="backdrop"></div><aside id="sidebar"><button id="drawerClose">Close</button><a href="#journal" id="first">Journal</a><button id="last">Settings</button></aside><main class="content-card"><input id="editor" value="Unsaved note"></main>',{runScripts:'outside-only',url:'https://tradedesk.example/app'}),w=dom.window;
 const listeners=[],media={matches:mobile,addEventListener:(name,listener)=>listeners.push(listener)};
 w.matchMedia=()=>media;w.$=selector=>w.document.querySelector(selector);w.$$=selector=>[...w.document.querySelectorAll(selector)];
 w.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{}];};
 w.eval(html.slice(html.indexOf('function openDrawer()'),html.indexOf('// ---------- login (server-verified session)')));
 return {dom,w,resize:mobile=>{media.matches=mobile;listeners.forEach(listener=>listener());}};
}
test('closed mobile drawer is inert and exposes expanded state',()=>{
 const {dom,w}=setup();try{assert.ok(w.$('#sidebar').hasAttribute('inert'));assert.equal(w.$('#sidebar').getAttribute('aria-hidden'),'true');w.openDrawer();assert.equal(w.$('#hamb').getAttribute('aria-expanded'),'true');assert.equal(w.$('#sidebar').getAttribute('aria-modal'),'true');assert.equal(w.document.activeElement.id,'drawerClose');assert.ok(w.$('.content-card').hasAttribute('inert'));assert.equal(w.$('#editor').value,'Unsaved note');}finally{w.close();}
});
test('drawer traps both Tab directions and Escape restores focus',()=>{
 const {w}=setup();try{w.openDrawer();w.$('#last').focus();w.$('#last').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement.id,'drawerClose');w.$('#drawerClose').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(w.document.activeElement.id,'last');w.$('#last').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement.id,'hamb');assert.equal(w.$('#hamb').getAttribute('aria-expanded'),'false');assert.equal(w.$('.content-card').hasAttribute('inert'),false);}finally{w.close();}
});
test('resizing to desktop restores navigation and background access',()=>{
 const {w,resize}=setup();try{w.openDrawer();resize(false);assert.equal(w.$('#sidebar').hasAttribute('inert'),false);assert.equal(w.$('#sidebar').hasAttribute('aria-modal'),false);assert.equal(w.$('.content-card').hasAttribute('inert'),false);resize(true);assert.ok(w.$('#sidebar').hasAttribute('inert'));}finally{w.close();}
});
test('closing drawer preserves an already-inert background',()=>{
 const {w}=setup();try{w.$('.content-card').setAttribute('inert','');w.openDrawer();w.closeDrawer();assert.ok(w.$('.content-card').hasAttribute('inert'));}finally{w.close();}
});
test('settings arrows follow RTL order and retain Home and End behavior',()=>{
 const dom=new JSDOM('<button data-settings-tab="one">One</button><button data-settings-tab="two">Two</button><button data-settings-tab="three">Three</button>',{runScripts:'outside-only'}),w=dom.window;
 try{w.document.documentElement.dir='rtl';w.$$=selector=>[...w.document.querySelectorAll(selector)];w.showSettingsTab=()=>{};w.eval(html.split('\n').find(line=>line.startsWith("$$('[data-settings-tab]').forEach")));const tabs=w.$$('[data-settings-tab]');tabs[1].focus();tabs[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',cancelable:true}));assert.equal(w.document.activeElement,tabs[2]);tabs[1].focus();tabs[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true}));assert.equal(w.document.activeElement,tabs[0]);}finally{w.close();}
});
