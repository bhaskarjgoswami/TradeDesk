'use strict';
// Playbook: tabs (My plans / Presets / Archived), search, compact plan cards with activation.
// The active plan (body.primary) is preselected on new trades.
const PB={collapsed:false,archivedOpen:false,menu:null,tab:'plans',q:''};
try{PB.collapsed=localStorage.getItem('tj_pb_collapsed')==='1';}catch{}
const pbPayload=(item,patch)=>({kind:'strategy',title:item.title,body:{...item.body,...patch},revision:item.revision});

function renderPlaybook(){const all=WS.items.strategy,plans=all.filter(i=>i.body.active).sort((a,b)=>(b.body.primary?1:0)-(a.body.primary?1:0)),archived=all.filter(i=>!i.body.active),presets=Object.entries(PLAN_SETTINGS.templates);
  if(PB.tab==='archived'&&!archived.length)PB.tab='plans';const q=(PB.q||'').trim().toLowerCase(),match=item=>!q||[item.title,item.body.description,...item.body.criteria].join(' ').toLowerCase().includes(q);
  const tabs=[['plans','My plans',plans.length],['presets','Presets',presets.length],...(archived.length?[['archived','Archived',archived.length]]:[])];
  let grid='';
  if(PB.tab==='plans'){const list=plans.filter(match);grid=list.length?list.map(x=>pbCard(x)).join(''):(plans.length?`<p class="pbx-none">No plan matches “${esc(PB.q)}”.</p>`:wsEmpty('Write down your edge','Create a plan with your charting process, entry criteria and example charts.','new-strategy','+ New plan'));}
  if(PB.tab==='presets')grid=presets.filter(([,t])=>!q||[t.name,...t.criteria].join(' ').toLowerCase().includes(q)).map(([key,t])=>pbPresetCard(key,t)).join('');
  if(PB.tab==='archived')grid=archived.filter(match).map(x=>pbCard(x,true)).join('');
  $('#ws-strategies').innerHTML=`${wsErrorBanner()}<div class="pbx-bar"><div class="pbx-tabs" role="tablist">${tabs.map(([k,l,n])=>`<button type="button" role="tab" data-pb-tab="${k}" aria-selected="${PB.tab===k}">${l}<span>${n}</span></button>`).join('')}</div>
   <label class="pbx-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="pbSearch" placeholder="Search plans" value="${esc(PB.q||'')}" aria-label="Search plans"></label>
   <div class="pb-new"><button type="button" class="btn" id="pbNew" aria-haspopup="menu" aria-expanded="false">+ New plan</button><div class="pb-menu" id="pbNewMenu" role="menu" hidden><button type="button" role="menuitem" data-pb-blank>Blank plan</button>${presets.map(([key,t])=>`<button type="button" role="menuitem" data-pb-preset="${esc(key)}">From preset: ${esc(t.name)}</button>`).join('')}</div></div></div>
  ${PB.tab==='presets'?'<p class="pbx-hint">Presets are starting points. Using one creates an editable copy in My plans.</p>':''}
  <div class="pbx-grid">${grid}</div>`;
  const newBtn=$('#pbNew'),newMenu=$('#pbNewMenu');newBtn.onclick=event=>{event.stopPropagation();pbCloseMenus();newMenu.hidden=false;newBtn.setAttribute('aria-expanded','true');newMenu.querySelector('button')?.focus();};
  $$('#ws-strategies [data-pb-tab]').forEach(b=>b.onclick=()=>{PB.tab=b.dataset.pbTab;renderPlaybook();});
  const search=$('#pbSearch');search.oninput=()=>{PB.q=search.value;const pos=search.selectionStart;renderPlaybook();const s2=$('#pbSearch');s2.focus();s2.setSelectionRange(pos,pos);};
  $$('#ws-strategies [data-pb-blank]').forEach(b=>b.onclick=()=>{pbCloseMenus();wsOpenItemEditor('strategy');});
  $$('#ws-strategies [data-pb-preset]').forEach(b=>b.onclick=event=>{event.stopPropagation();pbFromPreset(b.dataset.pbPreset,b);});
  $$('#ws-strategies [data-pb-card]').forEach(card=>{const open=()=>wsOpenItemEditor('strategy',WS.items.strategy.find(i=>i.id===Number(card.dataset.pbCard)));card.onclick=event=>{if(!event.target.closest('button'))open();};card.onkeydown=event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();open();}};});
  $$('#ws-strategies [data-pb-menu]').forEach(b=>b.onclick=event=>{event.stopPropagation();pbOpenMenu(b);});
  $$('#ws-strategies [data-pb-restore]').forEach(b=>b.onclick=async event=>{event.stopPropagation();const item=WS.items.strategy.find(i=>i.id===Number(b.dataset.pbRestore));b.disabled=true;try{await wsApi('items/'+item.id,'PUT',pbPayload(item,{active:true}));await wsReload('strategy');PB.tab='plans';renderPlaybook();toast(`${item.title} restored`);}catch(error){toast(error.message);b.disabled=false;}});
  $$('#ws-strategies [data-pb-primary]').forEach(b=>b.onclick=async event=>{event.stopPropagation();const item=WS.items.strategy.find(i=>i.id===Number(b.dataset.pbPrimary));if(!item)return;b.disabled=true;b.textContent='Setting…';
    try{await pbSetPrimary(item);await wsReload('strategy');renderPlaybook();toast(`${item.title} is now your active plan`);if(typeof routineState!=='undefined'&&routineState)renderRoutinePanel();}catch(error){toast(error.message);b.disabled=false;b.textContent='Set as active';}});}

// Minimal plan card: name, one muted meta line, optional chart, quiet footer.
function pbCard(item,archived=false){const b=item.body,trades=allTrades.filter(t=>Number(t.strategy_id)===item.id),closed=trades.filter(wsClosed),net=wsSummary(trades).net,img=b.setupImages[0]||b.entryImages[0];
  const meta=[b.description&&b.description!==item.title?esc(b.description):'',`${b.criteria.length} criteri${b.criteria.length===1?'on':'a'}`,`${b.charting.length} step${b.charting.length===1?'':'s'}`].filter(Boolean).join(' · ');
  return `<article class="pb-card pbx-card ${b.primary?'is-active':''} ${archived?'is-archived':''}" data-pb-card="${item.id}" tabindex="0" aria-label="Edit ${esc(item.title)}">
   <header class="pbc-head"><div><b>${esc(item.title)}</b><span>${meta}</span></div>${archived?'':`<button type="button" class="pbc-menu-btn" data-pb-menu="${item.id}" aria-label="More actions for ${esc(item.title)}" aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>`}</header>
   ${img?`<div class="pbx-shot"><img src="/${esc(img)}" alt="${esc(item.title)} reference chart"></div>`:`<div class="pbx-shot empty"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg><span>${archived?'No reference chart':'Add a reference chart'}</span></div>`}
   <footer class="pbx-foot"><span>${trades.length} trade${trades.length===1?'':'s'}${closed.length?` · <span class="${wsSign(net)}">${money(net)}</span>`:''}</span>${archived?`<button type="button" class="pbx-act" data-pb-restore="${item.id}">Restore</button>`:b.primary?'<span class="pbx-on" title="Used for the pre-market checklist and new trades">Active</span>':`<button type="button" class="pbx-act" data-pb-primary="${item.id}">Set as active</button>`}</footer></article>`;}
function pbPresetCard(key,t){return `<article class="pb-card pbx-card is-preset"><header class="pbc-head"><div><b>${esc(t.name)}</b><span>Preset · ${t.criteria.length} criteria · ${(t.charting||[]).length} steps</span></div></header>
   <footer class="pbx-foot"><span>Starting point</span><button type="button" class="pbx-act" data-pb-preset="${esc(key)}">Use preset</button></footer></article>`;}
function pbCloseMenus(){$$('#ws-strategies .pb-menu').forEach(m=>{if(m.id==='pbNewMenu')m.hidden=true;else m.remove();});$('#pbNew')?.setAttribute('aria-expanded','false');}
function pbOpenMenu(button){pbCloseMenus();const item=WS.items.strategy.find(i=>i.id===Number(button.dataset.pbMenu));if(!item)return;
  const menu=document.createElement('div');menu.className='pb-menu pb-item-menu';menu.setAttribute('role','menu');
  menu.innerHTML=`<button type="button" role="menuitem" data-a="edit">Edit plan</button><button type="button" role="menuitem" data-a="use">Use for a trade</button>${item.body.primary?'':'<button type="button" role="menuitem" data-a="primary">Set as active plan</button>'}<button type="button" role="menuitem" data-a="archive">Archive</button><button type="button" role="menuitem" class="danger" data-a="delete" data-kind="strategy" data-id="${item.id}">Delete</button>`;
  button.parentElement.appendChild(menu);menu.querySelector('button').focus();
  menu.onclick=async event=>{const a=event.target.closest('[data-a]')?.dataset.a;if(!a)return;event.stopPropagation();
    if(a==='delete'){menu.remove();return wsActions['delete-item'](event.target.closest('[data-a]'));}
    pbCloseMenus();if(a==='edit')return wsOpenItemEditor('strategy',item);if(a==='use')return openTradePage(null,wsLocalDate(),item.id);
    try{if(a==='primary')await pbSetPrimary(item);if(a==='archive')await wsApi('items/'+item.id,'PUT',pbPayload(item,{active:false,primary:false}));await wsReload('strategy');renderPlaybook();toast(a==='primary'?'Active plan set':'Plan archived');}catch(error){toast(error.message);}};}
async function pbSetPrimary(item){for(const other of WS.items.strategy.filter(i=>i.body.primary&&i.id!==item.id))await wsApi('items/'+other.id,'PUT',pbPayload(other,{primary:false}));await wsApi('items/'+item.id,'PUT',pbPayload(item,{primary:true,active:true}));}
// A preset becomes an editable copy in My Plans.
async function pbFromPreset(key,button){pbCloseMenus();const t=PLAN_SETTINGS.templates[key];if(!t)return;button.disabled=true;
  try{const body={charting:t.charting||[],criteria:t.criteria.length?t.criteria:['Define your first entry criterion'],management:t.management||[],exitRules:t.exitRules||'',notes:t.notes||[],setupImages:t.setupImages||[],entryImages:t.entryImages||[],description:t.name,active:true,primary:!WS.items.strategy.some(i=>i.body.primary)};
    const created=await wsApi('items','POST',{kind:'strategy',title:t.name,body,clientId:crypto.randomUUID()});await wsReload('strategy');renderPlaybook();toast('Plan created from preset');wsOpenItemEditor('strategy',WS.items.strategy.find(i=>i.id===created.id));}
  catch(error){toast(error.message);button.disabled=false;}}
document.addEventListener('click',event=>{if(view==='edge'&&!event.target.closest('.pb-menu'))pbCloseMenus();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&view==='edge'&&$('#ws-strategies .pb-menu:not([hidden])')){pbCloseMenus();}});

// Archived plans can be restored from the editor ("Available for new trades").
const pbBaseRender=window.renderWorkspaceView;
// Playbook now lives in the Trading Edge page as its first tab.
window.renderWorkspaceView=function(key){if(key==='strategies'){settingsTab='playbook';setView('edge');}else if(key==='edge'){if(settingsTab==='playbook')renderPlaybook();}else pbBaseRender(key);};
wsActions.strategies=()=>{settingsTab='playbook';setView('edge');};
$('#settings-tab-playbook')?.addEventListener('click',()=>renderPlaybook());
