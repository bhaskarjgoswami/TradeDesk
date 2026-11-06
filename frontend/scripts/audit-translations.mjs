import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import * as parser from '@babel/parser';

export function auditTranslations(root,code='hi'){
const known=new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root,'locales/'+code+'.json'),'utf8'))).map(s=>s.replace(/\s+/g,' ').trim().toLowerCase()));
const rows=new Map();
function expression(n,state={next:0}){if(!n)return '';if(n.type==='StringLiteral')return n.value;if(n.type==='BinaryExpression'&&n.operator==='+')return expression(n.left,state)+expression(n.right,state);if(n.type==='TemplateLiteral'){let result='';n.quasis.forEach((q,i)=>{result+=q.value.cooked??q.value.raw;if(i<n.expressions.length)result+=expression(n.expressions[i],state);});return result;}if(n.type==='Identifier'&&n.name==='BRAND')return 'TradeDesk';return '{value'+(++state.next)+'}';}
function visible(n,parent){if(!parent)return false;if(parent.type==='AssignmentExpression'&&parent.right===n&&['textContent','innerText','innerHTML'].includes(parent.left?.property?.name))return true;if(parent.type==='JSXExpressionContainer')return true;if(['CallExpression','NewExpression'].includes(parent.type)){if(parent.callee?.property?.name==='setAttribute')return ['aria-label','title','placeholder','alt'].includes(parent.arguments[0]?.value)&&parent.arguments[1]===n;return ['Error','alert','confirm','prompt','toast','wsHeader','wsField','wsTextField','wsBtn'].includes(parent.callee?.name)&&parent.arguments.indexOf(n)<(parent.callee.name==='wsHeader'?3:1)||parent.callee?.property?.name==='translate'&&parent.arguments[0]===n;}return false;}
function visibleExpression(n,file){if(n.type==='ConditionalExpression'){visibleExpression(n.consequent,file);visibleExpression(n.alternate,file);return;}if(!['StringLiteral','TemplateLiteral','BinaryExpression'].includes(n.type))return;const text=expression(n);if(/<[a-z][a-z0-9:-]*(?:\s|>)/i.test(text))html(text,file);else add(text,file);}
function add(text,file){text=text.replace(/\s+/g,' ').trim();if(!text||!/[A-Za-z]{2}/.test(text.replace(/\{value\d*\}/g,''))||/^(?:https?:|\/|#[\w-]+$)/.test(text)||text.includes('display:none}')||text==='you@example.com')return;if(!rows.has(text))rows.set(text,new Set());rows.get(text).add(file);}
function html(text,file){const doc=new JSDOM(text).window.document;doc.querySelectorAll('script,style,svg,code,pre,[translate=no],[data-user-content]').forEach(n=>n.remove());const walker=doc.createTreeWalker(doc.body,4);let n;while(n=walker.nextNode())add(n.nodeValue,file);for(const n of doc.querySelectorAll('[aria-label],[placeholder],[title],img[alt]'))for(const a of ['aria-label','placeholder','title','alt'])if(n.hasAttribute(a))add(n.getAttribute(a),file);}
function walk(n,file,parent){if(!n||typeof n!=='object')return;
 if(visible(n,parent))visibleExpression(n,file);
 if(n.type==='JSXText')add(n.value,file);
 if(n.type==='JSXAttribute'&&['placeholder','title','aria-label','alt'].includes(n.name.name)&&n.value?.type==='StringLiteral')add(n.value.value,file);
 if(n.type==='TemplateLiteral'){let text='';n.quasis.forEach((q,i)=>{text+=q.value.cooked??q.value.raw;if(i<n.expressions.length)text+=n.expressions[i].type==='Identifier'&&n.expressions[i].name==='BRAND'?'TradeDesk':'{value'+(i+1)+'}';});if(/<[a-z][\s>]/i.test(text)||/<(?:div|button|span|form|section|input|label|article)/.test(text))html(text,file);else if(parent?.type==='JSXExpressionContainer'||parent?.type==='AssignmentExpression'&&['textContent','innerText'].includes(parent.left?.property?.name))add(text,file);}
 if(n.type==='StringLiteral'){
  if(/<(?:div|button|span|form|section|input|label|article|p|h[1-6])\b/.test(n.value))html(n.value,file);
  else if(parent?.type==='AssignmentExpression'&&['textContent','innerText'].includes(parent.left?.property?.name))add(n.value,file);
  else if(parent?.type==='ObjectProperty'&&['title','text','label','message'].includes(parent.key?.name))add(n.value,file);
  else if(['CallExpression','NewExpression'].includes(parent?.type)&&['Error','alert','confirm','prompt','toast','wsHeader','wsField','wsTextField','wsBtn'].includes(parent.callee?.name)&&parent.arguments.indexOf(n)<(parent.callee.name==='wsHeader'?3:1))add(n.value,file);
 }
 for(const [key,value]of Object.entries(n))if(!['loc','start','end','extra','comments','tokens'].includes(key)){if(Array.isArray(value))value.forEach(x=>walk(x,file,n));else if(value&&typeof value==='object')walk(value,file,n);}
}
const files=['workspace.js','trade.js','calendar.js','profile.js','playbook.js','meditation.js','onboarding.js','feedback-page.js','broker-import.js','frontend/src/cloud/shim.js','frontend/src/cloud/EmbeddedBilling.jsx','frontend/src/pages/Legal.jsx','frontend/src/pages/Landing.jsx','frontend/src/pages/Billing.jsx','frontend/src/lib/PlanCards.jsx','frontend/src/components/ErrorBoundary.jsx','frontend/src/components/LanguageSelector.jsx','frontend/src/lib/api.js','frontend/src/lib/feedback.jsx'];
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');html(index,'index.html');
for(const script of new JSDOM(index).window.document.querySelectorAll('script:not([src])'))if(script.textContent.trim())walk(parser.parse(script.textContent,{sourceType:'unambiguous',plugins:['jsx']}),'index.html');
for(const file of files)walk(parser.parse(fs.readFileSync(path.join(root,file),'utf8'),{sourceType:'unambiguous',plugins:['jsx']}),file);
const proper=new Set('TradeDesk|Vercel|Mercury|Zerodha|Upstox|Angel One|Groww|Dhan|5paisa|ICICI Direct|HDFC Securities|Kotak Neo|Motilal Oswal|IC Markets|Pepperstone|OANDA|FXCM|IG|Exness|XM|FXTM|Eightcap|AvaTrade|Delta Exchange (India)|Binance|Bybit|Coinbase|OKX|Kraken|KuCoin|Bitget|MEXC|Gate|Crypto.com|CoinDCX|CoinSwitch|BTCUSD|ETHUSD|SOLUSD|BANKNIFTY|NIFTY|BE|QML|EMF|FOMO|USD|INR|OpenAI'.split('|'));
const missing=[...rows].filter(([s])=>!known.has(s.toLowerCase())&&!proper.has(s)).map(([text,files])=>({text,files:[...files]}));
return {total:rows.size,missing};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 let failed=false;for(const code of ['hi','es','fr','de','pt','ar','zh-CN']){const result=auditTranslations(root,code);console.log(code+': '+result.total+' UI strings; '+result.missing.length+' missing');if(result.missing.length){failed=true;console.error(result.missing.slice(0,8).map(row=>row.text).join('\n'));}}if(failed)process.exitCode=1;
}
