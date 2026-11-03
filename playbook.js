'use strict';
// Playbook: plan list on the left, the selected plan on the right (view or inline edit).
// The active plan (body.primary) is preselected on new trades and drives the pre-market checklist.
const PB={collapsed:false,sel:null,draft:null,dirty:false,busy:false};
try{PB.collapsed=localStorage.getItem('tj_pb_collapsed')==='1';}catch{}
const PB_DOTS=['#e0457b','#7c5cff','#1f9d6b','#e08a1e','#2f80ed','#c2410c'];
const PB_LISTS={charting:['Charting process','Add next step'],criteria:['Entry criteria','Add criterion'],management:['Trade management rules','Add rule'],notes:['Trading notes','Add note']};
const PB_IC={
  trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  pen:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  dots:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  grip:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  fold:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>',
  info:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  clock:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/></svg>',
  check:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  camera:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l2-2h4l2 2"/></svg>',
  list:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  exit:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/></svg>',
  note:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>'};
const pbPayload=(item,patch)=>({kind:'strategy',title:item.title,body:{...item.body,...patch},revision:item.revision});
const pbDot=item=>PB_DOTS[Math.max(0,WS.items.strategy.indexOf(item))%PB_DOTS.length];
const pbSub=body=>body.description||`${(body.criteria||[]).length} entry criteria`;
const pbLimits=body=>({maxTrades:null,maxLoss:null,maxProfit:null,riskPct:null,start:null,end:null,tz:'UTC',...(body.limits||{})});
const pbPresetBody=t=>({charting:t.charting||[],criteria:t.criteria||[],management:t.management||[],exitRules:t.exitRules||'',notes:t.notes||[],setupImages:t.setupImages||[],entryImages:t.entryImages||[],description:t.name});
function pbSelected(){const all=WS.items.strategy,presets=PLAN_SETTINGS.templates;
  if(typeof PB.sel==='string'&&presets[PB.sel.slice(2)])return {preset:PB.sel.slice(2)};
  const item=all.find(i=>i.id===PB.sel)||all.find(i=>i.body.active&&i.body.primary)||all.find(i=>i.body.active)||all[0];
  if(item){PB.sel=item.id;return {item};}
  const key=Object.keys(presets)[0];if(key){PB.sel='p:'+key;return {preset:key};}return {};}

function renderPlaybook(){const all=WS.items.strategy,plans=all.filter(i=>i.body.active).sort((a,b)=>(b.body.primary?1:0)-(a.body.primary?1:0)),archived=all.filter(i=>!i.body.active),presets=Object.entries(PLAN_SETTINGS.templates),cur=pbSelected();
  const row=(item)=>`<div class="pbv-item ${PB.sel===item.id?'on':''}"><button type="button" class="pbv-pick" data-pb-sel="${item.id}" title="${esc(item.title)}"><i class="pbv-dot" style="--dot:${pbDot(item)}"></i><span class="pbv-name"><b>${esc(item.title)}</b><small>${esc(pbSub(item.body))}</small></span>${item.body.primary?'<em class="pbv-pill">Active</em>':''}</button><button type="button" class="pbv-icon pbv-more" data-pb-menu="${item.id}" aria-label="More actions for ${esc(item.title)}" aria-haspopup="menu">${PB_IC.dots}</button></div>`;
  const prow=([key,t])=>`<div class="pbv-item ${PB.sel==='p:'+key?'on':''}"><button type="button" class="pbv-pick" data-pb-sel="p:${esc(key)}" title="${esc(t.name)}"><i class="pbv-dot preset"></i><span class="pbv-name"><b>${esc(t.name)}</b><small>${esc(t.criteria.length+' criteria · preset')}</small></span></button></div>`;
  const side=`<aside class="pbv-side" aria-label="Plans"><div class="pbv-side-head"><span class="pbv-cap">My plans</span><button type="button" class="pbv-icon pbv-fold" id="pbFold" aria-label="${PB.collapsed?'Expand':'Collapse'} plan list" aria-expanded="${!PB.collapsed}">${PB_IC.fold}</button></div>
    <div class="pb-new pbv-new"><button type="button" class="pbv-newbtn" id="pbNew" aria-haspopup="menu" aria-expanded="false" title="New plan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>New plan</span></button><div class="pb-menu" id="pbNewMenu" role="menu" hidden><button type="button" role="menuitem" data-pb-blank>Blank plan</button>${presets.map(([key,t])=>`<button type="button" role="menuitem" data-pb-preset="${esc(key)}">From preset: ${esc(t.name)}</button>`).join('')}</div></div>
    ${plans.length?plans.map(row).join(''):'<p class="pbv-none">No plans yet. Start blank or from a preset.</p>'}
    ${presets.length?`<p class="pbv-cap pbv-sec">Presets</p>${presets.map(prow).join('')}`:''}
    ${archived.length?`<p class="pbv-cap pbv-sec">Archived</p>${archived.map(row).join('')}`:''}</aside>`;
  const main=cur.item?(PB.draft&&PB.draft.id===cur.item.id?pbEditView(cur.item):pbPlanView(cur.item)):cur.preset?pbPresetView(cur.preset):`<div class="pbv-main">${wsEmpty('Write down your edge','Create a plan with your charting process, entry criteria and example charts.','new-strategy','+ New plan')}</div>`;
  $('#ws-strategies').innerHTML=`${wsErrorBanner()}<div class="pbv ${PB.collapsed?'collapsed':''}">${side}${main}</div>`;
  pbBind(cur);}

// ---------- view mode ----------
function pbSection(icon,title,inner){return `<section class="pbv-sec-block"><h3 class="pbv-cap">${PB_IC[icon]}${title}</h3>${inner}</section>`;}
function pbShots(body,editable=false){const tile=(key,label)=>`<div><p class="pbv-label">${label}</p><div class="pbv-shots">${(body[key]||[]).map((src,i)=>`<figure class="pbv-shot"><a href="/${esc(src)}" target="_blank" rel="noopener"><img src="/${esc(src)}" alt="${label} ${i+1}"></a>${editable?`<button type="button" class="pbv-icon pbv-x" data-pb-img-del="${key}:${i}" aria-label="Remove ${label.toLowerCase()} ${i+1}">×</button>`:''}</figure>`).join('')}${editable&&(body[key]||[]).length<8?`<label class="pbv-shot pbv-upload">+ Upload chart<input type="file" accept="image/*" data-pb-img-add="${key}" hidden></label>`:''}${!editable&&!(body[key]||[]).length?'<div class="pbv-shot pbv-empty-shot">No chart yet</div>':''}</div></div>`;
  return `<div class="pbv-models">${tile('setupImages','Setup screenshot')}${tile('entryImages','Entry examples')}</div>`;}
function pbRead(body){const none=t=>`<p class="pbv-ph">${t}</p>`,lines=a=>(a||[]).filter(Boolean);
  return `<section class="pbv-sec-block"><p class="pbv-label">Plan type</p><p class="pbv-type">${body.description?esc(body.description):'<span class="pbv-ph">Not set</span>'}</p></section>
   ${pbSection('chart','Charting process',lines(body.charting).length?`<ol class="pbv-steps">${lines(body.charting).map((s,i)=>`<li><span class="pbv-num">${i+1}</span>${esc(s)}</li>`).join('')}</ol>`:none('Add the steps you follow to mark up a chart'))}
   ${pbSection('check','Entry criteria',`<div class="pbv-checks">${lines(body.criteria).map(s=>`<label><input type="checkbox"><span>${esc(s)}</span></label>`).join('')}</div>`)}
   ${pbSection('camera','Entry models',pbShots(body))}
   ${pbSection('list','Trade management rules',lines(body.management).length?`<div class="pbv-lines">${lines(body.management).map(s=>`<p>${esc(s)}</p>`).join('')}</div>`:none('How you manage a trade once you are in'))}
   ${pbSection('exit','Exit criteria',body.exitRules?`<p class="pbv-pre">${esc(body.exitRules)}</p>`:none('Add your exit rules so you don\'t freestyle'))}
   ${pbSection('note','Trading notes',lines(body.notes).length?`<ul class="pbv-bullets">${lines(body.notes).map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:none('Reminders you want in front of you'))}`;}
function pbAside(item,editing=false){const trades=allTrades.filter(t=>Number(t.strategy_id)===item.id),s=wsSummary(trades),L=editing?pbLimits(PB.draft.body):pbLimits(item.body),pct=v=>v==null?'—':wsNum(v)+'%',cash=v=>v==null?'—':money(v);
  const stat=(v,l,cls='')=>`<div><b class="${cls}">${v}</b><small>${l}</small></div>`;
  const inp=(key,label,attrs)=>`<label class="pbv-lim"><small>${label}</small><input type="number" min="0" ${attrs} data-pb-limit="${key}" value="${L[key]??''}" placeholder="—"></label>`;
  const stats=`<div class="pbv-card pbv-stats"><h3 class="pbv-cap">Plan stats<span class="pbv-tip" title="From trades logged with this plan. Win rate uses closed trades. Compliance is the share of reviewed trades where you followed the plan.">${PB_IC.info}</span></h3><div class="pbv-kv">${stat(trades.length,'Trades taken')}${stat(s.closed.length?wsNum(s.winRate)+'%':'—','Win rate')}${stat(s.closed.length?money(s.net):'—','Net P&L',s.closed.length?wsSign(s.net):'')}${stat(s.compliance==null?'—':wsNum(s.compliance)+'%','Compliance')}</div></div>`;
  const risk=`<div class="pbv-card pbv-risk"><h3 class="pbv-cap">Risk controls<span class="pbv-tip" title="Your limits for days you trade this plan. They are reminders and do not block trades.">${PB_IC.info}</span>${editing?'':`<button type="button" class="pbv-icon pbv-card-edit" data-pb-edit-limits aria-label="Edit risk controls">${PB_IC.pen}</button>`}</h3>
    <div class="pbv-kv">${editing?inp('maxTrades','Max trades per day','step="1"')+inp('maxLoss','Max daily loss','step="any"')+inp('maxProfit','Max daily profit','step="any"')+inp('riskPct','Risk per trade (%)','step="0.01" max="100"'):stat(L.maxTrades??'—','Max trades per day')+stat(cash(L.maxLoss),'Max daily loss')+stat(cash(L.maxProfit),'Max daily profit')+stat(pct(L.riskPct),'Risk per trade')}</div></div>`;
  const win=`<div class="pbv-card pbv-window"><h3 class="pbv-cap">${PB_IC.clock}Trading window</h3>${editing?`<div class="pbv-win-edit"><input type="time" data-pb-limit="start" value="${esc(L.start||'')}" aria-label="Window start"><span>to</span><input type="time" data-pb-limit="end" value="${esc(L.end||'')}" aria-label="Window end"><input type="text" data-pb-limit="tz" value="${esc(L.tz||'UTC')}" maxlength="40" aria-label="Timezone" class="pbv-tz"></div>`:`<p class="pbv-win">${L.start&&L.end?`${esc(L.start)} - ${esc(L.end)} (${esc(L.tz||'UTC')})`:'<span class="pbv-ph">Not set</span>'}</p>`}</div>`;
  return `<aside class="pbv-aside">${stats}${risk}${win}</aside>`;}
function pbToggle(item){return `<div class="pbv-active"><button type="button" class="pbv-switch" role="switch" aria-checked="${!!item.body.primary}" data-pb-primary="${item.id}" ${item.body.active?'':'disabled'}><span></span></button><span>Active</span><span class="pbv-tip" title="The active plan is preselected on new trades and used for the pre-market checklist. Only one plan is active at a time.">${PB_IC.info}</span>${item.body.active?'':'<span class="pbv-ph">Archived. Restore it to make it active.</span>'}</div>`;}
function pbPlanView(item){return `<div class="pbv-main"><header class="pbv-head"><h2><i class="pbv-dot" style="--dot:${pbDot(item)}"></i>${esc(item.title)}</h2><div class="pbv-acts">
    <button type="button" class="pbv-icon pbv-box" data-pb-delete="${item.id}" aria-label="Delete plan" title="Delete">${PB_IC.trash}</button>
    <button type="button" class="pbv-icon pbv-box" data-pb-dup="${item.id}" aria-label="Duplicate plan" title="Duplicate">${PB_IC.copy}</button>
    ${item.body.active?`<button type="button" class="btn ghost pbv-edit" data-pb-edit="${item.id}">${PB_IC.pen}Edit</button>`:`<button type="button" class="btn ghost" data-pb-restore="${item.id}">Restore</button>`}</div></header>
   ${pbToggle(item)}<div class="pbv-body"><div class="pbv-col">${pbRead(item.body)}</div>${pbAside(item)}</div></div>`;}
function pbPresetView(key){const t=PLAN_SETTINGS.templates[key];return `<div class="pbv-main"><header class="pbv-head"><h2><i class="pbv-dot preset"></i>${esc(t.name)}</h2><div class="pbv-acts"><button type="button" class="btn" data-pb-preset="${esc(key)}">Use preset</button></div></header>
   <div class="pbv-active pbv-note">Presets are starting points. Using one creates an editable copy in My plans.</div><div class="pbv-body"><div class="pbv-col">${pbRead(pbPresetBody(t))}</div></div></div>`;}

// ---------- edit mode ----------
function pbStartEdit(item,focus){PB.draft={id:item.id,title:item.title,body:clonePlan({...item.body,limits:pbLimits(item.body)})};PB.dirty=false;for(const key of Object.keys(PB_LISTS))PB.draft.body[key]=[...(PB.draft.body[key]||[])];renderPlaybook();
  const target=focus?$(`#ws-strategies ${focus}`):$('#pbTitle');target?.focus();}
function pbListEdit(key){const [title,ph]=PB_LISTS[key],rows=PB.draft.body[key],num=key==='charting';
  return `<section class="pbv-sec-block"><h3 class="pbv-cap">${PB_IC[{charting:'chart',criteria:'check',management:'list',notes:'note'}[key]]}${title}<button type="button" class="pbv-add" data-pb-add="${key}">+ Add</button></h3>
   <div class="pbv-rows" data-pb-list="${key}">${rows.map((v,i)=>`<div class="pbv-row" data-i="${i}">${num?`<span class="pbv-num">${i+1}</span>`:''}<span class="pbv-grip" data-pb-grip title="Drag to reorder" aria-hidden="true">${PB_IC.grip}</span><div class="pbv-field"><input data-pb-row="${key}:${i}" value="${esc(v)}" maxlength="500" aria-label="${title} ${i+1}"><span class="pbv-row-acts"><button type="button" class="pbv-icon" data-pb-row-dup="${key}:${i}" aria-label="Duplicate">${PB_IC.copy}</button><button type="button" class="pbv-icon danger" data-pb-row-del="${key}:${i}" aria-label="Delete">${PB_IC.trash}</button></span></div></div>`).join('')}
    <div class="pbv-row pbv-next">${num?`<span class="pbv-num">${rows.length+1}</span>`:''}<span class="pbv-grip" aria-hidden="true">${PB_IC.grip}</span><div class="pbv-field"><input data-pb-next="${key}" placeholder="${ph}" maxlength="500" aria-label="${ph}"></div></div></div></section>`;}
function pbEditView(item){const d=PB.draft;return `<div class="pbv-main is-editing"><header class="pbv-head"><h2><i class="pbv-dot" style="--dot:${pbDot(item)}"></i><input id="pbTitle" class="pbv-title-in" value="${esc(d.title)}" maxlength="200" aria-label="Plan name"></h2><div class="pbv-acts"><span class="pbv-status" id="pbStatus" role="status"></span><button type="button" class="btn ghost" data-pb-cancel>Cancel</button><button type="button" class="btn" data-pb-save ${PB.busy?'disabled':''}>Save</button></div></header>
   ${pbToggle(item)}<div class="pbv-body"><div class="pbv-col">
   <section class="pbv-sec-block"><p class="pbv-label">Plan type</p><input class="pbv-input" id="pbType" value="${esc(d.body.description||'')}" maxlength="2000" placeholder="e.g. LQ Sweep Entry Model"></section>
   ${pbListEdit('charting')}${pbListEdit('criteria')}
   ${pbSection('camera','Entry models',pbShots(d.body,true))}
   ${pbListEdit('management')}
   ${pbSection('exit','Exit criteria',`<textarea class="pbv-input" id="pbExit" rows="3" maxlength="4000" placeholder="Add your exit rules so you don't freestyle">${esc(d.body.exitRules||'')}</textarea>`)}
   ${pbListEdit('notes')}</div>${pbAside(item,true)}</div></div>`;}
function pbFocusRow(key,i){const el=$(`#ws-strategies [data-pb-row="${key}:${i}"]`)||$(`#ws-strategies [data-pb-next="${key}"]`);if(el){el.focus();el.setSelectionRange?.(el.value.length,el.value.length);}}
function pbRerender(key,i){PB.dirty=true;renderPlaybook();if(key)pbFocusRow(key,i);}
async function pbSave(){const d=PB.draft,item=WS.items.strategy.find(i=>i.id===d.id),status=$('#pbStatus');if(!item)return;
  const body={...d.body};for(const key of Object.keys(PB_LISTS))body[key]=body[key].map(s=>s.trim()).filter(Boolean);
  const title=d.title.trim();if(!title){status.textContent='Give the plan a name';$('#pbTitle').focus();return;}
  if(!body.criteria.length){status.textContent='Add at least one entry criterion';pbFocusRow('criteria',0);return;}
  const L=body.limits;if(L.start&&!L.end||!L.start&&L.end){status.textContent='Set both window times, or neither';return;}
  PB.busy=true;status.textContent='Saving…';
  try{await wsApi('items/'+item.id,'PUT',{kind:'strategy',title,body,revision:item.revision});await wsReload('strategy');PB.draft=null;PB.dirty=false;toast('Plan saved');}
  catch(error){toast(error.message);}finally{PB.busy=false;renderPlaybook();}}
async function pbUpload(key,file){const status=$('#pbStatus');if(!file)return;if(!file.type.startsWith('image/')){status.textContent='Choose an image file';return;}status.textContent='Uploading chart…';
  try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const response=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});const result=await response.json();if(!response.ok||!result.path)throw Error('Chart upload failed');
    PB.draft.body[key]=[...(PB.draft.body[key]||[]),result.path];pbRerender();$('#pbStatus').textContent='Chart attached. Save the plan to keep it.';}
  catch(error){status.textContent=error.message;}}

// ---------- events ----------
function pbBind(cur){const root=$('#ws-strategies'),on=(sel,fn)=>root.querySelectorAll(sel).forEach(el=>fn(el));
  const guard=()=>!PB.draft||!PB.dirty||confirm('Discard your unsaved changes to this plan?');
  const newBtn=$('#pbNew'),newMenu=$('#pbNewMenu');newBtn.onclick=event=>{event.stopPropagation();pbCloseMenus();newMenu.hidden=false;newBtn.setAttribute('aria-expanded','true');newMenu.querySelector('button')?.focus();};
  $('#pbFold').onclick=()=>{PB.collapsed=!PB.collapsed;try{localStorage.setItem('tj_pb_collapsed',PB.collapsed?'1':'0');}catch{}renderPlaybook();};
  on('[data-pb-sel]',b=>b.onclick=()=>{const v=b.dataset.pbSel,next=v.startsWith('p:')?v:Number(v);if(next===PB.sel||!guard())return;PB.draft=null;PB.dirty=false;PB.sel=next;renderPlaybook();});
  on('[data-pb-blank]',b=>b.onclick=()=>{pbCloseMenus();wsOpenItemEditor('strategy');});
  on('[data-pb-preset]',b=>b.onclick=event=>{event.stopPropagation();pbFromPreset(b.dataset.pbPreset,b);});
  on('[data-pb-menu]',b=>b.onclick=event=>{event.stopPropagation();pbOpenMenu(b);});
  on('[data-pb-edit]',b=>b.onclick=()=>pbStartEdit(cur.item));
  on('[data-pb-edit-limits]',b=>b.onclick=()=>pbStartEdit(cur.item,'[data-pb-limit="maxTrades"]'));
  on('[data-pb-dup]',b=>b.onclick=()=>pbDuplicate(cur.item,b));
  on('[data-pb-delete]',b=>b.onclick=()=>pbDelete(cur.item,b));
  on('[data-pb-restore]',b=>b.onclick=async()=>{const item=cur.item;b.disabled=true;try{await wsApi('items/'+item.id,'PUT',pbPayload(item,{active:true}));await wsReload('strategy');renderPlaybook();toast(`${item.title} restored`);}catch(error){toast(error.message);b.disabled=false;}});
  on('[data-pb-primary]',b=>b.onclick=async()=>{const item=cur.item,turnOn=!item.body.primary;b.disabled=true;
    try{if(turnOn)await pbSetPrimary(item);else await wsApi('items/'+item.id,'PUT',pbPayload(item,{primary:false}));await wsReload('strategy');
      const fresh=WS.items.strategy.find(i=>i.id===item.id);if(PB.draft&&fresh){PB.draft.body.primary=fresh.body.primary;}
      renderPlaybook();toast(turnOn?`${item.title} is now your active plan`:'No plan is active now');if(typeof routineState!=='undefined'&&routineState)renderRoutinePanel();}
    catch(error){toast(error.message);b.disabled=false;}});
  if(!PB.draft||!cur.item||PB.draft.id!==cur.item.id)return;
  const d=PB.draft,dirty=()=>{PB.dirty=true;};
  $('#pbTitle').oninput=e=>{d.title=e.target.value;dirty();};
  $('#pbType').oninput=e=>{d.body.description=e.target.value;dirty();};
  $('#pbExit').oninput=e=>{d.body.exitRules=e.target.value;dirty();};
  on('[data-pb-limit]',el=>el.oninput=()=>{const k=el.dataset.pbLimit;d.body.limits[k]=['start','end','tz'].includes(k)?(el.value||(k==='tz'?'UTC':null)):(el.value===''?null:Number(el.value));dirty();});
  on('[data-pb-cancel]',b=>b.onclick=()=>{if(!guard())return;PB.draft=null;PB.dirty=false;renderPlaybook();});
  on('[data-pb-save]',b=>b.onclick=pbSave);
  on('[data-pb-add]',b=>b.onclick=()=>pbFocusRow(b.dataset.pbAdd,-1));
  on('[data-pb-row]',el=>{const [key,i]=el.dataset.pbRow.split(':'),n=Number(i);
    el.oninput=()=>{d.body[key][n]=el.value;dirty();};
    el.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();d.body[key].splice(n+1,0,'');pbRerender(key,n+1);}
      else if(e.key==='Backspace'&&!el.value){e.preventDefault();d.body[key].splice(n,1);pbRerender(key,Math.max(0,n-1));}
      else if(e.key==='ArrowUp'&&n>0){e.preventDefault();pbFocusRow(key,n-1);}else if(e.key==='ArrowDown'){e.preventDefault();pbFocusRow(key,n+1);}};});
  on('[data-pb-next]',el=>{const key=el.dataset.pbNext;
    el.oninput=()=>{d.body[key].push(el.value);pbRerender(key,d.body[key].length-1);};
    el.onkeydown=e=>{if(e.key==='ArrowUp'&&d.body[key].length){e.preventDefault();pbFocusRow(key,d.body[key].length-1);}};});
  on('[data-pb-row-dup]',b=>b.onclick=()=>{const [key,i]=b.dataset.pbRowDup.split(':'),n=Number(i);d.body[key].splice(n+1,0,d.body[key][n]);pbRerender(key,n+1);});
  on('[data-pb-row-del]',b=>b.onclick=()=>{const [key,i]=b.dataset.pbRowDel.split(':'),n=Number(i);d.body[key].splice(n,1);pbRerender(key,Math.min(n,d.body[key].length-1));});
  on('[data-pb-img-del]',b=>b.onclick=()=>{const [key,i]=b.dataset.pbImgDel.split(':');d.body[key].splice(Number(i),1);pbRerender();});
  on('[data-pb-img-add]',el=>el.onchange=()=>pbUpload(el.dataset.pbImgAdd,el.files[0]));
  // Drag a row by its grip to reorder within the same list.
  on('[data-pb-list]',list=>{const key=list.dataset.pbList;let from=null;
    list.querySelectorAll('.pbv-row[data-i]').forEach(row=>{const grip=row.querySelector('[data-pb-grip]');
      grip.onpointerdown=()=>{row.draggable=true;};
      row.ondragstart=e=>{from=Number(row.dataset.i);row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(from));};
      row.ondragend=()=>{row.draggable=false;row.classList.remove('dragging');list.querySelectorAll('.drop').forEach(r=>r.classList.remove('drop'));};
      row.ondragover=e=>{if(from===null)return;e.preventDefault();list.querySelectorAll('.drop').forEach(r=>r.classList.remove('drop'));row.classList.add('drop');};
      row.ondrop=e=>{e.preventDefault();if(from===null)return;const to=Number(row.dataset.i);if(to!==from){const [moved]=d.body[key].splice(from,1);d.body[key].splice(to,0,moved);}from=null;pbRerender(key,to);};});});}

async function pbDuplicate(item,button){button.disabled=true;
  try{const created=await wsApi('items','POST',{kind:'strategy',title:item.title+' (copy)',body:{...clonePlan(item.body),primary:false,active:true},clientId:crypto.randomUUID()});await wsReload('strategy');PB.sel=created.id;PB.draft=null;renderPlaybook();toast('Plan duplicated');}
  catch(error){toast(error.message);button.disabled=false;}}
async function pbDelete(item,button){if(!confirm(`Delete "${item.title}"? Trades logged with it keep their saved copy of the plan.`))return;button.disabled=true;
  try{await wsApi('items/'+item.id,'DELETE',{revision:item.revision});await wsReload('strategy');PB.sel=null;PB.draft=null;renderPlaybook();toast('Plan deleted');}
  catch(error){toast(error.message);button.disabled=false;}}
function pbCloseMenus(){$$('#ws-strategies .pb-menu').forEach(m=>{if(m.id==='pbNewMenu')m.hidden=true;else m.remove();});$('#pbNew')?.setAttribute('aria-expanded','false');}
function pbOpenMenu(button){pbCloseMenus();const item=WS.items.strategy.find(i=>i.id===Number(button.dataset.pbMenu));if(!item)return;
  const menu=document.createElement('div');menu.className='pb-menu pb-item-menu';menu.setAttribute('role','menu');
  menu.innerHTML=item.body.active?`<button type="button" role="menuitem" data-a="edit">Edit plan</button><button type="button" role="menuitem" data-a="use">Use for a trade</button>${item.body.primary?'':'<button type="button" role="menuitem" data-a="primary">Set as active plan</button>'}<button type="button" role="menuitem" data-a="dup">Duplicate</button><button type="button" role="menuitem" data-a="archive">Archive</button><button type="button" role="menuitem" class="danger" data-a="delete">Delete</button>`:`<button type="button" role="menuitem" data-a="restore">Restore</button><button type="button" role="menuitem" class="danger" data-a="delete">Delete</button>`;
  button.parentElement.appendChild(menu);menu.querySelector('button').focus();
  menu.onclick=async event=>{const target=event.target.closest('[data-a]'),a=target?.dataset.a;if(!a)return;event.stopPropagation();pbCloseMenus();
    if(PB.draft&&PB.dirty&&PB.draft.id!==item.id&&['edit','delete'].includes(a)&&!confirm('Discard your unsaved changes to this plan?'))return;
    if(a==='edit'){PB.sel=item.id;return pbStartEdit(item);}if(a==='use')return openTradePage(null,wsLocalDate(),item.id);
    if(a==='dup')return pbDuplicate(item,button);if(a==='delete')return pbDelete(item,button);
    try{if(a==='primary')await pbSetPrimary(item);if(a==='archive')await wsApi('items/'+item.id,'PUT',pbPayload(item,{active:false,primary:false}));if(a==='restore')await wsApi('items/'+item.id,'PUT',pbPayload(item,{active:true}));
      await wsReload('strategy');if(PB.draft?.id===item.id&&a==='archive')PB.draft=null;renderPlaybook();toast({primary:'Active plan set',archive:'Plan archived',restore:'Plan restored'}[a]);}catch(error){toast(error.message);}};}
async function pbSetPrimary(item){for(const other of WS.items.strategy.filter(i=>i.body.primary&&i.id!==item.id))await wsApi('items/'+other.id,'PUT',pbPayload(other,{primary:false}));await wsApi('items/'+item.id,'PUT',pbPayload(item,{primary:true,active:true}));}
// A preset becomes an editable copy in My Plans, opened straight into edit mode.
async function pbFromPreset(key,button){pbCloseMenus();const t=PLAN_SETTINGS.templates[key];if(!t)return;button.disabled=true;
  try{const body={...pbPresetBody(t),criteria:t.criteria.length?t.criteria:['Define your first entry criterion'],active:true,primary:!WS.items.strategy.some(i=>i.body.primary)};
    const created=await wsApi('items','POST',{kind:'strategy',title:t.name,body,clientId:crypto.randomUUID()});await wsReload('strategy');PB.sel=created.id;toast('Plan created from preset');pbStartEdit(WS.items.strategy.find(i=>i.id===created.id));}
  catch(error){toast(error.message);button.disabled=false;}}
document.addEventListener('click',event=>{if(view==='edge'&&!event.target.closest('.pb-menu'))pbCloseMenus();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view==='edge'&&$('#ws-strategies .pb-menu:not([hidden])')){pbCloseMenus();}});

const pbBaseRender=window.renderWorkspaceView;
// Playbook lives in the Trading Edge page as its first tab.
window.renderWorkspaceView=function(key){if(key==='strategies'){settingsTab='playbook';setView('edge');}else if(key==='edge'){if(settingsTab==='playbook')renderPlaybook();}else pbBaseRender(key);};
wsActions.strategies=()=>{settingsTab='playbook';setView('edge');};
$('#settings-tab-playbook')?.addEventListener('click',()=>renderPlaybook());
