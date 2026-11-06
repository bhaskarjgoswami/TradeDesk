import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../../../',import.meta.url);
const runtime=readFileSync(new URL('language.js',root),'utf8');
const codes=['en','hi','es','fr','de','pt','ar','zh-CN'];
export function catalog(code){return JSON.parse(readFileSync(new URL('locales/'+code+'.json',root),'utf8'));}
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function setup(html=''){
 const dom=new JSDOM('<!doctype html><html><body>'+html+'</body></html>',{url:'https://tradedesk.example/app',runScripts:'outside-only',pretendToBeVisual:true});
 dom.window.fetch=async path=>({ok:true,json:async()=>catalog(path.split('/').at(-1).replace('.json',''))});
 dom.window.alert=()=>{};dom.window.confirm=()=>false;dom.window.prompt=()=>null;
 dom.window.eval(runtime);await tick();return dom;
}
test('all eight languages have complete matching catalogs and native names',()=>{
 const keys=Object.keys(catalog('hi')).sort();assert.ok(keys.length>=290);
 for(const code of codes.slice(1)){const data=catalog(code);assert.deepEqual(Object.keys(data).sort(),keys);assert.ok(Object.values(data).every(value=>typeof value==='string'&&value.trim()));}
});
test('language switching is reversible, preserves form values and translates accessible labels',async()=>{
 const dom=await setup('<button aria-label="Save profile">Save profile</button><input value="Save" placeholder="Your full name"><textarea>Save</textarea>');
 try{const {window:w}=dom;const button=w.document.querySelector('button');const original=button.firstChild;
 for(const code of codes){assert.equal(await w.TDLocale.setLanguage(code),true);assert.equal(button.firstChild,original);assert.equal(button.textContent,code==='en'?'Save profile':catalog(code)['Save profile']);assert.equal(button.getAttribute('aria-label'),button.textContent);assert.equal(w.document.querySelector('input').value,'Save');assert.equal(w.document.querySelector('textarea').value,'Save');assert.equal(w.document.documentElement.dir,code==='ar'?'rtl':'ltr');}
 assert.equal(w.localStorage.getItem('td_language'),'zh-CN');
 }finally{dom.window.close();}
});
test('dynamic UI updates are translated without replacing nodes or treating translations as HTML',async()=>{
 const dom=await setup('<div id="status">Saving…</div>');try{const w=dom.window;await w.TDLocale.setLanguage('es');const status=w.document.querySelector('#status');status.textContent='Profile saved.';await tick();assert.equal(status.textContent,catalog('es')['Profile saved.']);await w.TDLocale.setLanguage('en');assert.equal(status.textContent,'Profile saved.');w.fetch=async()=>({ok:true,json:async()=>({'Save profile':'<img src=x onerror=alert(1)>'})});await w.TDLocale.setLanguage('fr');status.textContent='Save profile';await tick();assert.equal(status.querySelector('img'),null);assert.ok(status.textContent.includes('<img'));}finally{dom.window.close();}
});
test('user content, identifiers, native language names and financial values remain untouched',async()=>{
 const dom=await setup('<p data-user-content>Save</p><p id="note">Journal</p><span>$699.00</span><select translate="no"><option>English</option></select>');try{const w=dom.window;w.TDLocale.protect({notes:'Journal',symbol:'BTCUSD'});await w.TDLocale.setLanguage('hi');assert.equal(w.document.querySelector('[data-user-content]').textContent,'Save');assert.equal(w.document.querySelector('#note').textContent,'Journal');assert.equal(w.document.querySelector('span').textContent,'$699.00');assert.equal(w.document.querySelector('option').textContent,'English');assert.equal(w.TDLocale.normalize('pt-BR'),'pt');assert.equal(w.TDLocale.normalize('zh-Hans'),'zh-CN');assert.equal(w.TDLocale.normalize('zz'),'en');}finally{dom.window.close();}
});
test('a failed locale download keeps the prior language and saved preference',async()=>{
 const dom=await setup('<button>Save</button>');try{const w=dom.window;await w.TDLocale.setLanguage('es');w.fetch=async()=>{throw Error('offline');};assert.equal(await w.TDLocale.setLanguage('ar'),false);assert.equal(w.TDLocale.language,'es');assert.equal(w.localStorage.getItem('td_language'),'es');assert.equal(w.document.documentElement.dir,'ltr');}finally{dom.window.close();}
});

test('translated option labels keep canonical trading values in FormData',async()=>{
 const dom=await setup('<form><select name="direction"><option>Long</option><option>Short</option></select><select name="outcome"><option>Win</option><option>Loss</option></select></form>');
 try{const w=dom.window;for(const code of codes){await w.TDLocale.setLanguage(code);const data=new w.FormData(w.document.querySelector('form'));assert.equal(data.get('direction'),'Long');assert.equal(data.get('outcome'),'Win');w.document.querySelector('[name=direction]').value='Short';assert.equal(new w.FormData(w.document.querySelector('form')).get('direction'),'Short');w.document.querySelector('[name=direction]').value='Long';}}finally{dom.window.close();}
});

test('dynamic translations preserve counts, names and text-only rendering',async()=>{
 const dom=await setup('<p id="page">Page 3 of 12</p><p id="remove"></p>');try{const w=dom.window;w.document.querySelector('#remove').textContent='Remove <img src=x> $&?';w.fetch=async()=>({ok:true,json:async()=>({'Page {count} of {total}':'Página {count} de {total}','Remove {name}?':'¿Quitar {name}?'})});assert.equal(await w.TDLocale.setLanguage('es'),true);assert.equal(w.document.querySelector('#page').textContent,'Página 3 de 12');assert.equal(w.document.querySelector('#remove').textContent,'¿Quitar <img src=x> $&?');assert.equal(w.document.querySelector('img'),null);await w.TDLocale.setLanguage('en');assert.equal(w.document.querySelector('#page').textContent,'Page 3 of 12');}finally{dom.window.close();}
});
test('invalid catalogs cannot change the active language, direction or preference',async()=>{
 for(const invalid of [null,[],42,{'Save':{}},{'Page {count}':'Page'}]){const dom=await setup('<button>Save</button>');try{const w=dom.window;await w.TDLocale.setLanguage('es');const before=w.document.querySelector('button').textContent;w.fetch=async()=>({ok:true,json:async()=>invalid});assert.equal(await w.TDLocale.setLanguage('ar'),false);assert.equal(w.TDLocale.language,'es');assert.equal(w.localStorage.getItem('td_language'),'es');assert.equal(w.document.documentElement.dir,'ltr');assert.equal(w.document.querySelector('button').textContent,before);}finally{dom.window.close();}}
});
