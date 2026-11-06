import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const html=readFileSync(new URL('../../../index.html',import.meta.url),'utf8');
function setup(cached=true){
  const dom=new JSDOM('<button id="routineOpen"></button><button id="routineMobileOpen"></button><div id="routinePanel" hidden></div>',{runScripts:'outside-only'}),w=dom.window;
  let resolve,requests=0,syncs=0;
  w.$=selector=>w.document.querySelector(selector);
  w.routineState=cached?{period:'today'}:null;w.routineForced=false;w.routineHiddenPeriod=null;
  w.renderRoutinePanel=()=>{w.$('#routinePanel').hidden=!w.routineForced;};
  w.loadRoutine=()=>{requests++;return new Promise(done=>{resolve=ok=>{if(ok)w.routineState={period:'today'};w.renderRoutinePanel();done(ok);};});};
  w.routineQuietSync=()=>{syncs++;};w.toast=()=>{};
  w.eval(html.slice(html.indexOf('let routineOpening=false;'),html.indexOf('// ---------- boot ----------')));
  return {w,finish:ok=>resolve(ok),requests:()=>requests,syncs:()=>syncs};
}
test('cached routine opens before a slow API response and stays open on refresh failure',async()=>{
  const {w,finish}=setup();try{const pending=w.$('#routineOpen').onclick();assert.equal(w.$('#routinePanel').hidden,false);finish(false);await pending;assert.equal(w.$('#routinePanel').hidden,false);}finally{w.close();}
});
test('closing during refresh is immediate and its response does not reopen the popup',async()=>{
  const {w,finish,requests,syncs}=setup();try{const pending=w.$('#routineOpen').onclick();await w.$('#routineOpen').onclick();assert.equal(w.$('#routinePanel').hidden,true);assert.equal(requests(),1);finish(true);await pending;assert.equal(w.$('#routinePanel').hidden,true);assert.equal(syncs(),0);}finally{w.close();}
});
test('first load prevents duplicate requests and restores both CTAs after failure and retry',async()=>{
  const {w,finish,requests}=setup(false);try{let pending=w.$('#routineOpen').onclick();assert.equal(w.$('#routineOpen').disabled,true);assert.equal(w.$('#routineMobileOpen').getAttribute('aria-busy'),'true');await w.$('#routineOpen').onclick();assert.equal(requests(),1);finish(false);await pending;assert.equal(w.$('#routineOpen').disabled,false);assert.equal(w.$('#routineMobileOpen').hasAttribute('aria-busy'),false);pending=w.$('#routineOpen').onclick();finish(true);await pending;assert.equal(w.$('#routinePanel').hidden,false);}finally{w.close();}
});
