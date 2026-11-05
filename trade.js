'use strict';
// Add / edit trade page: the journal entry written (or pulled from Delta) after a trade is exited.
// The pre-trade checklist lives in the Playbook and is kept off this page on purpose.
const TF={trade:null,draft:null,queue:[],queueIdx:0,date:null,charts:{htf:'',mtf:'',ltf:''},uploads:0,back:'month',autoPnl:true,autoRisk:true,autoR:true,busy:false,clientId:null,dirty:false,contractEdited:false,pendingBody:null,reviewedAt:null,restore:null,timezone:null,draftStorageKey:null};
const TF_CHARTS=[['htf','HTF','Higher timeframe: bias, range and key levels'],['mtf','MTF','Middle timeframe: structure and the setup forming'],['ltf','LTF','Lower timeframe: the entry trigger and execution']];
const TF_EMOTION_IN=['Calm','Confident','Anxious','FOMO','Frustrated','Tired'],TF_EMOTION_OUT=['Satisfied','Calm','Relieved','Frustrated','Regretful'];
const TF_MISTAKES=['Entered before confirmation','Chased the entry','Moved stop wider','Exited too early','Oversized position','Traded outside my session','Revenge trade','No stop loss'];
const tfNum=name=>{const v=$('#tfForm [name='+name+']')?.value;return v===''||v==null?null:Number(v);};
const tfZoneName=()=>{try{return (typeof PF!=='undefined'&&PF.data.settings.timezone)||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}};
const tfSplit=(value,zone=tfZoneName())=>{if(!value)return ['',''];if(!/[zZ]|[+-]\d\d:\d\d$/.test(value))return String(value).split('T');try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));return [`${p.year}-${p.month}-${p.day}`,`${p.hour}:${p.minute}`];}catch{return String(value).split('T');}};
const tfPlans=()=>WS.items.strategy.filter(i=>i.body.active||i.id===Number(TF.trade?.strategy_id));
function tfTemplate(id){const item=WS.items.strategy.find(i=>i.id===Number(id));if(item)return{...clonePlan(item.body),name:item.title};const base=PLAN_SETTINGS.templates[PLAN_SETTINGS.defaultType];return base?clonePlan(base):{name:'Default checklist',criteria:[]};}
// Contract size from the last trade on the same symbol (Delta lots are fractions of a coin).
function tfContract(symbol){const key=String(symbol||'').trim().toUpperCase(),seed=TF.trade||TF.draft;if(seed&&String(seed.symbol||'').trim().toUpperCase()===key&&Number(seed.contract_value)>0)return Number(seed.contract_value);const prior=allTrades.find(t=>String(t.symbol||'').trim().toUpperCase()===key&&Number(t.contract_value)>0);return prior?Number(prior.contract_value):null;}

window.openTradePage=async function(trade=null,date=null,strategyId=null,draft=null){if(TF.busy||TF.uploads){toast('Wait for the current save or upload to finish.');return;}if(view==='trade'&&TF.dirty&&!tfPersistDraft()&&!confirm('Leave this trade and discard unsaved changes?'))return;if(!settingsLoaded&&!await loadPlanSettings())return;
  if(!draft){TF.queue=[];TF.queueIdx=0;}TF.back=view==='trade'?TF.back:view;TF.trade=trade;TF.draft=draft;TF.date=trade?.date||draft?.date||date||wsLocalDate();const plan=wsJson(trade?.plan),charts=plan.charts||{},images=wsJson(trade?.images,[]);
  TF.charts={htf:charts.htf||(!plan.charts&&images[0])||'',mtf:charts.mtf||(!plan.charts&&images[1])||'',ltf:charts.ltf||(!plan.charts&&images[2])||''};
  const primaryKey=trade?.id||(draft?.source_id?'broker:'+draft.source_id:'new'),brokerKey=trade?.source_id?'broker:'+trade.source_id:null;let recovered=window.TradeDeskDrafts?.load(primaryKey);TF.draftStorageKey=primaryKey;if(!recovered&&brokerKey){recovered=window.TradeDeskDrafts?.load(brokerKey);if(recovered)TF.draftStorageKey=brokerKey;}TF.timezone=recovered?.timezone||tfZoneName();
  if(recovered){TF.restore=recovered;TF.charts=recovered.charts||TF.charts;if(recovered.trade?.id===trade?.id&&trade)TF.trade=recovered.trade;else if(trade&&recovered.pendingBody&&!recovered.trade){TF.trade={...trade,revision:1};recovered.pendingBody=null;}TF.draft=recovered.seed||TF.draft;}else TF.restore=null;
  const seed=TF.trade||TF.draft;TF.autoPnl=seed?.pnl==null;TF.autoRisk=seed?.risk==null;TF.autoR=seed?.r_multiple==null;TF.uploads=0;TF.busy=false;TF.dirty=false;TF.contractEdited=false;TF.clientId=trade?null:(recovered?.clientId||crypto.randomUUID());TF.pendingBody=recovered?.pendingBody||null;TF.reviewedAt=recovered?.reviewedAt||wsReview(seed||{}).reviewedAt||null;TF.dirty=!!recovered;
  TF.strategy=strategyId??trade?.strategy_id??(trade?'':(WS.items.strategy.find(i=>i.body.primary&&i.body.active)?.id??''));setView('trade');};

function renderTradePage(){const t=TF.trade||TF.draft||{},review=wsReview(t),[entryDate,entryTime]=tfSplit(t.entry_time,TF.timezone),[exitDate,exitTime]=tfSplit(t.exit_time,TF.timezone),swap=Number(t.swap)||0,commission=t.fee==null?'':Math.max(0,Number(t.fee)-swap);
  const symbols=[...new Set(allTrades.map(x=>x.symbol).filter(Boolean))],mistakes=[...new Set([...TF_MISTAKES,...allTrades.map(x=>wsReview(x).mistakes).filter(m=>m&&m.length<80)])];
  const f=(label,name,value,type='number',extra='')=>`<label class="tf-field">${label}<input name="${name}" type="${type}" value="${esc(value??'')}" ${type==='number'?'step="any"':''} ${extra}></label>`;
  const sel=(label,name,options,current,placeholder='Select')=>`<label class="tf-field">${label}<select name="${name}"><option value="">${placeholder}</option>${options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(current??'')===String(v)?'selected':''}>${esc(l)}</option>`;}).join('')}</select></label>`;
  const item=TF.queue[TF.queueIdx];
  $('#ws-trade').innerHTML=`<div class="tf-head"><div class="tf-title"><h1>${TF.trade?'Edit Trade':'Add Trade'}</h1><p>Record the trade after you exit. Write it by hand or pull your fills from Delta.</p></div>${TF.trade?`<span class="ws-tag">${esc(t.symbol||'')} · ${esc(t.date||'')}</span>`:`<button type="button" class="btn ghost" id="tfPull">↧ Pull from Delta</button>`}</div>
  ${item?`<div class="tf-import"><b>Delta import · ${TF.queueIdx+1} of ${TF.queue.length}</b><span>${esc(item.symbol||'')}${item.time?' · '+esc(item.time):''}</span>${item.open?'<span class="ws-tag amber">Still open · journal it after you exit</span>':''}<button type="button" class="ws-link" id="tfSkip">Skip ›</button></div>`:''}
  <form id="tfForm" class="tf-grid" novalidate>
   <section class="ws-card tf-left"><h2>Trade Details</h2><p class="tf-hint">${esc(TF.timezone||tfZoneName())} · Leave times blank if unknown.</p>
    <div class="tf-row">${f('Entry Date','date',TF.date,'date','required')}${f('Entry Time','entry_clock',entryTime||'','time')}</div>
    <div class="tf-row">${f('Exit Date','exit_date',exitDate||'','date')}${f('Exit Time','exit_clock',exitTime||'','time')}</div>
    <div class="tf-row"><label class="tf-field">Instrument<input name="symbol" list="tfSymbols" value="${esc(t.symbol||'')}" placeholder="Search for a symbol" autocomplete="off" required><datalist id="tfSymbols">${symbols.map(s=>`<option value="${esc(s)}">`).join('')}</datalist></label>${sel('Direction','direction',['Long','Short'],t.direction)}</div>
    <div class="tf-row">${f('Quantity / lots','qty',t.qty,'number','min="0" placeholder="0.00"')}${f('Units per lot / contract','contract_value',tfContract(t.symbol),'number','min="0.00000001" placeholder="e.g. 1 or 100000"')}</div><p class="tf-hint">Use 1 for shares or units. For contracts, enter the instrument’s units per lot.</p>
    <h3>Execution</h3>
    <div class="tf-row">${f('Entry Price','entry',t.entry,'number','placeholder="0.00000"')}${f('Exit Price','exit',t.exit,'number','placeholder="0.00000"')}</div>
    <div class="tf-row">${f('Stop Loss','stop',t.stop,'number','placeholder="0.00000"')}${f('Take Profit','target',t.target,'number','placeholder="0.00000"')}</div>
    ${f('PnL','pnl',t.pnl,'number','placeholder="0.00"')}<p class="tf-hint" id="tfPnlHint"></p>
    <h3>Performance</h3>
    <div class="tf-row">${f('Risk ('+esc(WS.prefs.settings.currency)+')','risk',t.risk,'number','min="0" placeholder="0.00"')}${f('Return (R)','r_multiple',t.r_multiple,'number','placeholder="0.0R"')}</div>
    <h3>Costs</h3>
    <div class="tf-row">${f('Swap','swap',t.swap??'','number','placeholder="0.00"')}${f('Commission','commission',commission,'number','min="0" placeholder="0.00"')}</div>
    <div class="tf-foot">${TF.trade?'<button type="button" class="tf-delete" id="tfDelete">Delete</button>':''}<button type="button" class="btn ghost" id="tfCancel">Cancel</button><button type="submit" class="btn" id="tfSave">${TF.trade?'Save Changes':'Save Manual Trade'}</button></div>
    <p class="tf-status" id="tfStatus" role="status" aria-live="polite"></p>
   </section>
   <div class="tf-right">
    <section class="ws-card"><h2>Charts</h2><p class="ws-subtitle">Add screenshots to review context + execution. Click, drop or paste an image. Hover an uploaded chart to preview or delete it.</p>
     <div class="tf-charts">${TF_CHARTS.map(([key,label,tip])=>`<div><div class="tf-chart-label">${label}<span class="tf-info" title="${esc(tip)}" aria-label="${esc(tip)}">i</span></div><div class="tf-chart" id="tfChart-${key}" data-chart="${key}" tabindex="0" role="button" aria-label="Upload ${label} chart"></div></div>`).join('')}<input type="file" id="tfFile" accept="image/*" hidden></div></section>
    <section class="ws-card"><h2>Review &amp; Reflection</h2>
     <div class="tf-row">
      <div class="tf-field">Plan<label class="tf-check"><input type="checkbox" name="followed" ${review.followedPlan===true?'checked':''}>I followed my trade plan</label></div>
      ${sel('Which plan did you intend to follow?','strategy',[['','Default checklist'],...tfPlans().map(i=>[i.id,i.title])],TF.strategy,'Select').replace('<option value="">Select</option>','')}</div>
     <div class="tf-row"><label class="tf-field">Trade Management<input name="management" value="${esc(review.management||'')}" placeholder="e.g. Partial at 1R, move SL to BE after 1R, set and forget etc."></label>
      <label class="tf-field">Mistakes<input name="mistakes" list="tfMistakes" value="${esc(review.mistakes||'')}" placeholder="Start typing" autocomplete="off"><datalist id="tfMistakes">${mistakes.map(m=>`<option value="${esc(m)}">`).join('')}</datalist></label></div>
     <div class="tf-row">${sel('Entry Emotion','emotionIn',TF_EMOTION_IN,review.emotionIn)}${sel('Exit Emotion','emotionOut',TF_EMOTION_OUT,review.emotionOut)}</div>
     <label class="tf-field">Add a note or reflection<textarea name="notes" rows="4" placeholder="What went well? What will you do differently next time?">${esc(t.notes||'')}</textarea></label>
    </section></div></form>`;
  const form=$('#tfForm');
  if(TF.restore){for(const [name,value] of Object.entries(TF.restore.fields)){const control=form.elements.namedItem(name);if(!control||!['INPUT','TEXTAREA','SELECT'].includes(control.tagName))continue;if(control.type==='checkbox')control.checked=!!value;else control.value=String(value??'');}for(const key of ['autoPnl','autoRisk','autoR'])if(typeof TF.restore.auto?.[key]==='boolean')TF[key]=TF.restore.auto[key];TF.restore=null;$('#tfStatus').textContent='Unsaved draft restored on this device.';}
  TF.strategy=form.elements.strategy.value;TF_CHARTS.forEach(([key])=>tfRenderChart(key));tfRecalc();
  form.oninput=event=>{TF.dirty=true;const name=event.target.name;if(name==='symbol'){form.elements.contract_value.value=tfContract(event.target.value)??'';TF.contractEdited=false;}if(name==='contract_value')TF.contractEdited=true;if(name==='pnl')TF.autoPnl=event.target.value==='';if(name==='risk')TF.autoRisk=event.target.value==='';if(name==='r_multiple')TF.autoR=event.target.value==='';if(name==='date'&&!form.exit_date.value)form.exit_date.placeholder=form.date.value;tfRecalc();tfPersistDraft();};
  form.strategy.onchange=()=>{TF.strategy=form.strategy.value;};
  if($('#tfPull'))$('#tfPull').onclick=tfPull;if($('#tfSkip'))$('#tfSkip').onclick=tfNextImport;
  form.onsubmit=event=>{event.preventDefault();tfSave();};
  $('#tfCancel').onclick=()=>tfLeave();
  if($('#tfDelete'))$('#tfDelete').onclick=tfDelete;
  $$('#ws-trade [data-chart]').forEach(zone=>{const pick=()=>{TF.target=zone.dataset.chart;$('#tfFile').click();};const act=()=>TF.charts[zone.dataset.chart]?tfPreview(TF.charts[zone.dataset.chart],zone.dataset.chart.toUpperCase()):pick();zone.onclick=event=>{if(event.target.closest('button'))return;act();};zone.onkeydown=event=>{if(event.target!==zone)return;if(['Enter',' '].includes(event.key)){event.preventDefault();act();}};zone.onfocus=()=>TF.target=zone.dataset.chart;
    zone.ondragover=event=>{event.preventDefault();zone.classList.add('drag');};zone.ondragleave=()=>zone.classList.remove('drag');zone.ondrop=event=>{event.preventDefault();zone.classList.remove('drag');tfUpload(event.dataTransfer.files[0],zone.dataset.chart);};});
  $('#tfFile').onchange=event=>{tfUpload(event.target.files[0],TF.target||'htf');event.target.value='';};}

function tfRenderChart(key){const zone=$('#tfChart-'+key),path=TF.charts[key];zone.classList.toggle('filled',Boolean(path));
  zone.innerHTML=path?`<img src="/${esc(path)}" alt="${key.toUpperCase()} chart">${tfChartActions(key,true)}`:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>`;
  zone.querySelector('[data-chart-preview]')?.addEventListener('click',()=>tfPreview(path,key.toUpperCase()));
  zone.querySelector('[data-chart-remove]')?.addEventListener('click',()=>{TF.charts[key]='';TF.dirty=true;tfRenderChart(key);tfPersistDraft();zone.focus();});}
// Hover / focus overlay on a filled chart slot.
function tfChartActions(key,removable){const label=key.toUpperCase();return `<div class="tf-chart-actions"><button type="button" data-chart-preview="${key}" aria-label="Preview ${label} chart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>Preview</button>${removable?`<button type="button" class="danger" data-chart-remove="${key}" aria-label="Delete ${label} chart"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Delete</button>`:''}</div>`;}
function tfPreview(path,label){let box=$('#tfLightbox');if(!box){box=document.createElement('dialog');box.id='tfLightbox';box.className='tf-lightbox';document.body.appendChild(box);box.onclick=event=>{if(event.target===box||event.target.closest('[data-lightbox-close]'))box.close();};}
  box.innerHTML=`<div class="tf-lightbox-bar"><b>${esc(label)} chart</b><a href="/${esc(path)}" target="_blank" rel="noopener noreferrer">Open in new tab ↗</a><button type="button" data-lightbox-close aria-label="Close preview">×</button></div><img src="/${esc(path)}" alt="${esc(label)} chart">`;if(!box.open)box.showModal();}
async function tfUpload(file,key){if(!file)return;if(!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type)||file.size>5*1024*1024){toast('Choose a PNG, JPG, GIF or WebP image under 5 MB.');return;}TF.uploads++;$('#tfSave').disabled=true;const zone=$('#tfChart-'+key);zone.classList.add('busy');
  try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const response=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})});const result=await response.json();if(!response.ok||!result.path)throw Error(result.error||'Upload failed');TF.charts[key]=result.path;TF.dirty=true;tfRenderChart(key);tfPersistDraft();}
  catch(error){toast(error.message||'Upload failed');}finally{TF.uploads--;zone.classList.remove('busy');if(!TF.uploads&&$('#tfSave'))$('#tfSave').disabled=false;}}
document.addEventListener('paste',event=>{if(view!=='trade')return;const item=[...(event.clipboardData?.items||[])].find(it=>it.type.startsWith('image/'));if(!item)return;event.preventDefault();const key=TF.target||TF_CHARTS.map(c=>c[0]).find(k=>!TF.charts[k])||'htf';tfUpload(item.getAsFile(),key);});

// P&L, risk and R fill themselves from prices until the user types a value.
function tfRecalc(){const form=$('#tfForm');if(!form)return;const entry=tfNum('entry'),exit=tfNum('exit'),stop=tfNum('stop'),qty=tfNum('qty'),sign=form.direction.value==='Short'?-1:1,cv=tfNum('contract_value');
  if(TF.autoPnl){const pnl=entry!=null&&exit!=null&&qty&&cv>0?Math.round((exit-entry)*sign*qty*cv*100)/100:null;form.pnl.value=pnl??'';}
  if(TF.autoRisk){const risk=entry!=null&&stop!=null&&qty&&cv>0?Math.round(Math.abs(entry-stop)*qty*cv*100)/100:null;form.risk.value=risk||'';}
  if(TF.autoR){const pnl=tfNum('pnl'),risk=tfNum('risk');let r=null;if(entry!=null&&stop!=null&&exit!=null&&entry!==stop)r=(exit-entry)*sign/Math.abs(entry-stop);else if(pnl!=null&&risk>0)r=pnl/risk;form.r_multiple.value=r==null?'':Math.round(r*100)/100;}
  $('#tfPnlHint').textContent=cv==null||cv<=0?'Enter units per lot / contract to calculate P&L and risk, or type your broker’s values.':TF.autoPnl&&entry!=null&&exit!=null&&qty?`Calculated: (exit − entry) × lots × contract size ${cv}. Type a value to override.`:'';}

async function tfSave(){if(TF.busy||TF.uploads)return;const form=$('#tfForm'),status=$('#tfStatus');
  if(!form.date.value||!form.symbol.value.trim()||!form.direction.value){status.textContent='Entry date, instrument and direction are required.';(!form.date.value?form.date:!form.symbol.value.trim()?form.symbol:form.direction).focus();return;}
  const contract=tfNum('contract_value');if(contract!==null&&(!Number.isFinite(contract)||contract<=0)){status.textContent='Enter a positive number of units per lot / contract.';return;}if(TF.autoPnl&&tfNum('entry')!==null&&tfNum('exit')!==null&&tfNum('qty')>0&&!contract){status.textContent='Enter units per lot / contract, or enter your broker’s P&L.';form.elements.contract_value.focus();return;}
  const t=TF.trade||TF.draft||{},old=wsReview(t),pnl=tfNum('pnl'),swap=tfNum('swap')||0,commission=tfNum('commission')||0,stamp=(d,clock,previous)=>{const [oldDate,oldClock]=tfSplit(previous,TF.timezone);return d&&d===oldDate&&clock===oldClock?previous:d?(clock?`${d}T${clock}`:d):null;};
  const template=tfTemplate(TF.strategy),charts={...TF.charts},images=TF_CHARTS.map(([k])=>charts[k]).filter(Boolean),hasReview=Boolean(form.emotionIn.value||form.emotionOut.value||form.mistakes.value.trim()||form.management.value.trim()||form.followed.checked);
  const body={date:form.date.value,symbol:form.symbol.value.trim().toUpperCase(),direction:form.direction.value,setup:t.setup||template.name||'',tf_bias:t.tf_bias||'',logic:t.logic||'',
    entry:tfNum('entry'),stop:tfNum('stop'),exit:tfNum('exit'),target:tfNum('target'),qty:tfNum('qty'),risk:tfNum('risk'),pnl,r_multiple:tfNum('r_multiple'),
    outcome:pnl==null?null:pnl>0?'Win':pnl<0?'Loss':'BE',rating:t.rating||null,tags:t.tags||'',notes:form.notes.value.trim(),images:images.length?JSON.stringify(images):null,
    checklist:t.checklist||null,fee:swap+commission||null,swap:swap||null,
    plan:JSON.stringify({...wsJson(t.plan),version:2,template,type:'custom',active:true,exitRules:template.exitRules||'',charts}),
    review:JSON.stringify({version:1,followedPlan:hasReview?form.followed.checked:(old.followedPlan??null),quality:old.quality||'',execution:old.execution||'',emotionIn:form.emotionIn.value,emotionOut:form.emotionOut.value,management:form.management.value.trim(),mistakes:form.mistakes.value.trim(),reviewed:hasReview||old.reviewed===true,reviewedAt:hasReview?(old.reviewedAt||(TF.reviewedAt ||= new Date().toISOString())):(old.reviewedAt||null)}),
    strategy_id:TF.strategy?Number(TF.strategy):null,entry_time:stamp(form.date.value,form.entry_clock.value,t.entry_time),exit_time:stamp(form.exit_date.value||(form.exit_clock.value?form.date.value:''),form.exit_clock.value,t.exit_time),contract_value:contract,timezone:TF.timezone||tfZoneName(),sourceId:TF.draft?.source_id,clientId:TF.clientId,expectedRevision:TF.trade?.revision};
  const draftKey=TF.draftStorageKey||TF.trade?.id||'new',requestBody=TF.pendingBody||body,changedSinceAttempt=!!TF.pendingBody&&JSON.stringify(body)!==JSON.stringify(TF.pendingBody);TF.pendingBody=requestBody;tfPersistDraft();
  TF.busy=true;$('#tfSave').disabled=true;status.textContent='Saving…';
  let saved;
  try{
    const response=await fetch(TF.trade?'/api/trades/'+TF.trade.id:'/api/trades',{method:TF.trade?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(requestBody)});
    const result=await response.json().catch(()=>null);
    if(!response.ok){
      if(response.status<500){TF.pendingBody=null;tfPersistDraft();}
      if(response.status===402){status.textContent='Your Free plan allows 2 trades per day. Your draft is kept. ';const link=document.createElement('a');link.href='#billing';link.textContent='View plans';link.onclick=event=>{event.preventDefault();setView('billing');};status.append(link);return;}
      if(response.status===409){status.textContent=(result?.error||'This trade changed in another tab.')+' ';const button=document.createElement('button');button.type='button';button.className='ws-link';button.textContent='Reload saved trade';button.onclick=tfReloadSaved;status.append(button);return;}
      throw Error(result?.error||result?.detail||'Could not save. Your entries are still here.');
    }
    if(!result||!Number.isInteger(result.id))throw Error('Could not confirm the save. Retry to check this same save request.');
    saved=result;
  }catch(error){status.textContent=error.message||'Could not confirm the save. Retry safely; your entries are still here.';return;}
  finally{TF.busy=false;if($('#tfSave'))$('#tfSave').disabled=false;}
  window.TradeDeskDrafts?.clear(draftKey);TF.draftStorageKey=saved.id;TF.trade=saved;TF.clientId=null;TF.pendingBody=null;TF.dirty=changedSinceAttempt;
  // The write is complete. A failed refresh must never turn this into a new POST.
  const index=allTrades.findIndex(trade=>trade.id===saved.id);if(index<0)allTrades.unshift(saved);else allTrades[index]=saved;
  if(changedSinceAttempt){tfPersistDraft();status.textContent='Previous save confirmed. Your newer changes are still here; save again to apply them.';$('#tfSave').textContent='Save Changes';return;}
  try{await loadAll();}catch{toast('Trade saved. Could not refresh the journal; try again shortly.');status.textContent='Trade saved. Could not refresh the journal; try again shortly.';$('#tfSave').textContent='Save Changes';return;}
  toast(t.id?'Trade updated':'Trade saved ✓');if(TF.queue.length){tfNextImport();return;}if(t.id&&TF.back==='tradeview'){openTradeDetail(saved.id);return;}calShowDay(body.date);
}
// Delta: pull today's fills, then journal them one at a time on this page.
async function tfPull(){const button=$('#tfPull');button.disabled=true;try{const r=await(await fetch('/api/delta/today?timezone='+encodeURIComponent(tfZoneName()))).json();
    if(r.error==='no-credentials'){toast('No Delta API keys. Add your read-only keys in Settings → Integrations.');return;}if(r.error){toast('Delta: '+r.error);return;}
    if(!r.trades?.length){toast('No closed Delta trades for today');return;}TF.queue=r.trades.filter(t=>!t.source_id||!allTrades.some(saved=>saved.source_id===t.source_id));if(!TF.queue.length){toast('These broker trades are already in your journal.');return;}TF.queueIdx=-1;tfNextImport();}
  catch(error){toast('Could not reach Delta');}finally{if(button.isConnected)button.disabled=false;}}
function tfNextImport(){TF.queueIdx++;const c=TF.queue[TF.queueIdx];if(!c){TF.queue=[];toast('All Delta trades reviewed ✓');const date=TF.date;loadAll().then(()=>calShowDay(date));return;}
  const back=TF.back;openTradePage(null,c.date,null,{...c,contract_value:c.contract_value||c.cv||null}).then(()=>{TF.back=back;});}
async function tfDelete(){if(!TF.trade||!confirm('Delete this trade permanently?'))return;try{const response=await fetch('/api/trades/'+TF.trade.id,{method:'DELETE'});if(!response.ok)throw Error('Could not delete this trade. Please try again.');TF.dirty=false;window.TradeDeskDrafts?.clear(TF.draftStorageKey||TF.trade.id);allTrades=allTrades.filter(t=>t.id!==TF.trade.id);toast('Trade deleted');const date=TF.trade.date;try{await loadAll();}catch{toast('Trade deleted. Refresh the journal when your connection returns.');}calShowDay(date);}catch(error){toast(error.message);}}
async function tfLeave(){if(TF.dirty&&!confirm('Discard this unsaved draft?'))return;window.TradeDeskDrafts?.clear(TF.draftStorageKey||TF.trade?.id||'new');TF.dirty=false;if(TF.trade&&TF.back==='tradeview'){openTradeDetail(TF.trade.id);return;}if(TF.back==='month'||TF.back==='journal'||!TF.back||TF.back==='trade'){calShowDay(TF.date);return;}setView(TF.back);}


// ---------- trade details (read-only facts + editable reflection) ----------
const TD={id:null,dirty:false};
const tdOrdered=()=>[...allTrades].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.entry_time||'').localeCompare(String(b.entry_time||''))||a.id-b.id);
// Session from the entry time in UTC: Asia 00-07, London 07-13, New York 13-21.
function tdSession(t){if(!t.entry_time||!String(t.entry_time).includes('T'))return '—';const d=new Date(t.entry_time);if(Number.isNaN(d.getTime()))return '—';const h=d.getUTCHours();return h<7?'Asia':h<13?'London':h<21?'New York':'After hours';}
function tdDuration(t){const a=new Date(t.entry_time),b=new Date(t.exit_time),m=Math.round((b-a)/60000);if(!t.entry_time||!t.exit_time||!String(t.entry_time).includes('T')||!String(t.exit_time).includes('T')||!Number.isFinite(m)||m<0)return '—';return m<60?m+'m':m<1440?`${Math.floor(m/60)}h ${m%60}m`:`${Math.floor(m/1440)}d ${Math.floor(m%1440/60)}h`;}
const tdCost=v=>v?money(-v):money(0);
window.openTradeDetail=function(id){if(TD.dirty&&view==='tradeview'&&!confirm('Discard unsaved reflection changes?'))return;TD.id=id;TD.dirty=false;setView('tradeview');};
function renderTradeDetail(){const t=allTrades.find(x=>x.id===TD.id);if(!t){calShowDay(wsLocalDate());return;}
  const r=wsReview(t),plan=wsJson(t.plan),charts=plan.charts||{},images=wsJson(t.images,[]),order=tdOrdered(),i=order.findIndex(x=>x.id===t.id),prev=order[i-1],next=order[i+1];
  TF_CHARTS.forEach(([k],n)=>{if(!plan.charts&&images[n])charts[k]=images[n];});
  const net=wsClosed(t)?wsNet(t):null,[whole,cents]=net===null?['Open','']:money(net).split(/(?=[.,]\d{2}(?:\D*)$)/),row=(label,value)=>`<div class="td-row"><span>${label}</span><b class="num">${value}</b></div>`,price=v=>v==null||v===''?'Not set':esc(String(v));
  const strategies=WS.items.strategy.filter(x=>x.body.active||x.id===Number(t.strategy_id)),sel=(label,name,options,current)=>`<label class="tf-field">${label}<select name="${name}"><option value="">Select</option>${options.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o];return `<option value="${esc(v)}" ${String(current??'')===String(v)?'selected':''}>${esc(l)}</option>`;}).join('')}</select></label>`;
  $('#ws-tradeview').innerHTML=`<button type="button" class="ws-link td-back" id="tdBack">← Journal</button>
  <div class="td-head"><h1>${esc(t.symbol||'Trade')} <span>·</span> ${esc(new Date(t.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}))}</h1>
   <div class="ws-actions"><button type="button" class="btn ghost" id="tdEdit">Edit trade</button><div class="cal-seg td-nav"><button type="button" id="tdPrev" ${prev?'':'disabled'}>‹ Previous</button><button type="button" id="tdNext" ${next?'':'disabled'}>Next Trade ›</button></div></div></div>
  <div class="tf-grid">
   <section class="ws-card td-left"><h2>Trade Details</h2>
    <div class="cal-pnet ${net===null?'muted':wsSign(net)}">${esc(whole)}<small>${esc(cents||'')}</small></div><div class="cal-plabel">NET PNL</div>
    <div class="td-trio"><div><b>${esc(t.symbol||'—')}</b><span>INSTRUMENT</span></div><div><b class="${t.direction==='Long'?'pos':'neg'}">${t.direction==='Long'?'↑ Buy':t.direction==='Short'?'↓ Sell':'—'}</b><span>DIRECTION</span></div><div><b>${t.qty==null?'—':wsNum(Number(t.qty),4)}</b><span>LOT SIZE</span></div></div>
    <h3>Context</h3>${row('Date',esc(new Date(t.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'})))}${row('Session',tdSession(t))}${row('Duration',tdDuration(t))}${row('Plan',esc(plan.template?.name||t.setup||'—'))}${plan.pretrade?`<div class="td-row"><span>Pre-trade checklist</span><b title="${esc([...plan.pretrade.charting,...plan.pretrade.criteria].join(' · '))}">${plan.pretrade.criteria.length}/${plan.pretrade.criteriaTotal||plan.pretrade.criteria.length} criteria confirmed</b></div>`:''}
    <h3>Execution</h3>${row('Entry Price',price(t.entry))}${row('Exit Price',price(t.exit))}${row('Stop Loss',price(t.stop))}${row('Take Profit',price(t.target))}
    <h3>Performance</h3>${row('Risk',t.risk==null?'—':money(t.risk))}${row('Return (R)',t.r_multiple==null?'—':wsNum(Number(t.r_multiple),2)+'R')}${row('Gross P&L',t.pnl==null?'—':money(t.pnl))}
    <h3>Costs</h3>${row('Fees',tdCost((Number(t.fee)||0)-(Number(t.swap)||0)))}${row('Swap',tdCost(Number(t.swap)||0))}
   </section>
   <div class="tf-right">
    <section class="ws-card"><h2>Charts</h2><p class="ws-subtitle">Screenshots of the context and execution. Hover a chart to preview it.</p>
     <div class="tf-charts">${TF_CHARTS.map(([k,label,tip])=>`<div><div class="tf-chart-label">${label}<span class="tf-info" title="${esc(tip)}">i</span></div>${charts[k]?`<div class="tf-chart filled" tabindex="0" data-td-chart="${esc(charts[k])}" data-td-label="${label}" aria-label="${label} chart"><img src="/${esc(charts[k])}" alt="${label} chart">${tfChartActions(k,false)}</div>`:`<button type="button" class="tf-chart" data-td-add aria-label="Add ${label} chart in Edit trade"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg></button>`}</div>`).join('')}</div></section>
    <section class="ws-card"><h2>Review &amp; Reflection</h2><form id="tdForm">
     <div class="tf-row"><div class="tf-field">Plan<label class="tf-check"><input type="checkbox" name="followed" ${r.followedPlan===true?'checked':''}>I followed my trade plan</label></div>${sel('Which plan did you intend to follow?','strategy',strategies.map(x=>[x.id,x.title]),t.strategy_id)}</div>
     <div class="tf-row"><label class="tf-field">Trade Management<input name="management" value="${esc(r.management||'')}" placeholder="e.g. Partial at 1R, move SL to BE"></label><label class="tf-field">Mistakes<input name="mistakes" list="tfMistakes" value="${esc(r.mistakes||'')}" placeholder="Start typing" autocomplete="off"><datalist id="tfMistakes">${TF_MISTAKES.map(m=>`<option value="${esc(m)}">`).join('')}</datalist></label></div>
     <div class="tf-row">${sel('Entry Emotion','emotionIn',TF_EMOTION_IN.map(e=>[e,`${CAL_EMOJI[e]||''} ${e}`]),r.emotionIn)}${sel('Exit Emotion','emotionOut',TF_EMOTION_OUT.map(e=>[e,`${CAL_EMOJI[e]||''} ${e}`]),r.emotionOut)}</div>
     <label class="tf-field">Add a note or reflection<textarea name="notes" rows="4" placeholder="What went well? What will you do differently next time?">${esc(t.notes||'')}</textarea></label>
     <div class="td-save"><span class="ws-form-status" id="tdStatus" role="status"></span><button type="submit" class="btn" id="tdSave">Save reflection</button></div></form></section>
   </div></div>`;
  const form=$('#tdForm');form.oninput=()=>{TD.dirty=true;$('#tdStatus').textContent='Unsaved changes';};
  form.onsubmit=async event=>{event.preventDefault();const button=$('#tdSave');button.disabled=true;$('#tdStatus').textContent='Saving…';
    const review={...r,version:1,followedPlan:form.followed.checked,emotionIn:form.emotionIn.value,emotionOut:form.emotionOut.value,management:form.management.value.trim(),mistakes:form.mistakes.value.trim(),reviewed:true,reviewedAt:r.reviewedAt||new Date().toISOString()};
    const strategyId=form.strategy.value?Number(form.strategy.value):null,body={...t,review:JSON.stringify(review),notes:form.notes.value.trim(),strategy_id:strategyId};
    try{const response=await fetch('/api/trades/'+t.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error();TD.dirty=false;await loadAll();toast('Reflection saved');renderTradeDetail();}
    catch{$('#tdStatus').textContent='Could not save. Your edits are still here.';button.disabled=false;}};
  $('#tdBack').onclick=()=>{if(TD.dirty&&!confirm('Discard unsaved reflection changes?'))return;TD.dirty=false;calShowDay(t.date);};
  $('#tdEdit').onclick=()=>{if(TD.dirty&&!confirm('Discard unsaved reflection changes?'))return;TD.dirty=false;openTradePage(t);};
  if(prev)$('#tdPrev').onclick=()=>openTradeDetail(prev.id);if(next)$('#tdNext').onclick=()=>openTradeDetail(next.id);
  $$('#ws-tradeview [data-td-add]').forEach(b=>b.onclick=()=>openTradePage(t));
  $$('#ws-tradeview [data-td-chart]').forEach(zone=>{const show=()=>tfPreview(zone.dataset.tdChart,zone.dataset.tdLabel);zone.onclick=show;zone.onkeydown=event=>{if(event.target===zone&&['Enter',' '].includes(event.key)){event.preventDefault();show();}};});}

// ---------- wiring: every add / edit entry point opens this page ----------
const tfBaseRender=window.renderWorkspaceView;
window.renderWorkspaceView=function(key){if(key==='trade')renderTradePage();else if(key==='tradeview')renderTradeDetail();else tfBaseRender(key);};
const tfBaseSetView=setView;
setView=function(v){if(view==='trade'&&v!=='trade'){if(TF.busy||TF.uploads){toast('Wait for the current save or upload to finish.');return;}if(TF.dirty&&!tfPersistDraft()&&!confirm('Leave this trade and discard unsaved changes?'))return;}tfBaseSetView(v);if(v==='trade'||v==='tradeview')$$('.navitem').forEach(n=>n.classList.toggle('on',n.dataset.view==='month'));};
$('#addTradeBtn').onclick=()=>openTradePage(null,selectedDate||wsLocalDate());
window.toggleTrade=id=>{const t=dayData&&dayData.trades.find(x=>x.id===id)||allTrades.find(x=>x.id===id);if(t)openTradePage(t);};
window.editTrade=async id=>{const t=allTrades.find(x=>x.id===Number(id));if(t)openTradePage(t);};
wsNewTrade=async()=>{await openTradePage(null,wsLocalDate());return true;};
Object.assign(wsActions,{'new-trade':()=>openTradePage(null,wsLocalDate()),'cal-add':()=>openTradePage(null,wsLocalDate()),
 'use-strategy':button=>openTradePage(null,wsLocalDate(),Number(button.dataset.id)),'use-preset':()=>openTradePage(null,wsLocalDate()),
 'edit-trade':button=>{if(WS.dialogDirty&&!confirm('Discard the unsaved review and open trade details?'))return;wsCloseDialog(true);editTrade(Number(button.dataset.id));}});

function tfPersistDraft(){const form=$('#tfForm');if(!form)return !TF.dirty;const fields=Object.fromEntries(new FormData(form));fields.followed=form.elements.followed.checked;return window.TradeDeskDrafts?.save(TF.draftStorageKey||TF.trade?.id||'new',{fields,timezone:TF.timezone,trade:TF.trade,seed:TF.draft,charts:TF.charts,clientId:TF.clientId,pendingBody:TF.pendingBody,reviewedAt:TF.reviewedAt,auto:{autoPnl:TF.autoPnl,autoRisk:TF.autoRisk,autoR:TF.autoR}})===true;}
async function tfReloadSaved(){if(!TF.trade){toast('Check your journal for the completed save before starting another trade.');return;}if(!confirm('Discard this draft and load the latest saved trade?'))return;try{await loadAll();const latest=allTrades.find(t=>t.id===TF.trade.id);if(!latest){toast('This trade is no longer in your journal.');return;}window.TradeDeskDrafts?.clear(TF.draftStorageKey||TF.trade.id);TF.dirty=false;openTradePage(latest);}catch(error){toast(error.message||'Could not load the saved trade. Your draft is kept.');}}
window.addEventListener('beforeunload',event=>{if(view==='trade'&&(TF.busy||TF.uploads||(TF.dirty&&!tfPersistDraft()))){event.preventDefault();event.returnValue='';}});
