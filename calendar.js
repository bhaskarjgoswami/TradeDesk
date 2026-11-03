'use strict';
// Journal home: month calendar of daily results, monthly summary and weekly breakdown.
// Clicking a day opens the existing day view (trades, stats, trade form).
const CAL={month:null,mode:'$',selected:null,filter:'all',search:'',notes:{}};
try{CAL.mode=localStorage.getItem('tj_cal_mode')||'$';}catch{}
const calIso=d=>d.toLocaleDateString('en-CA');
const calMonday=d=>{const x=new Date(d);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;};
const calCapital=()=>Number(WS.prefs.settings.capital)||0;
// Toggle shows the display currency's own symbol ($, ₹, €...).
const calSymbol=()=>{try{return (0).toLocaleString(undefined,{style:'currency',currency:wsDisplayCurrency()==='USDT'?'USD':wsDisplayCurrency(),currencyDisplay:'narrowSymbol'}).replace(/[\d.,\s]/g,'')||'$';}catch{return '$';}};
const calR=t=>t.r_multiple===null||t.r_multiple===''||!Number.isFinite(Number(t.r_multiple))?null:Number(t.r_multiple);
const calSigned=(text,value)=>value>0?'+'+text:text;
// One day/week value in the selected unit: net money, % of starting balance, or summed R.
function calValue(trades){const closed=trades.filter(wsClosed);if(!closed.length)return null;
  if(CAL.mode==='R'){const rs=closed.map(calR).filter(v=>v!==null);return rs.length?rs.reduce((a,b)=>a+b,0):null;}
  const net=closed.reduce((a,t)=>a+wsNet(t),0);return CAL.mode==='%'?net/calCapital()*100:net;}
function calFormat(value){if(value===null)return '—';if(CAL.mode==='R')return calSigned(wsNum(value,2)+'R',value);if(CAL.mode==='%')return calSigned(wsNum(value,2)+'%',value);return calSigned(money(value),value);}
function calByDate(){const map=new Map();allTrades.forEach(t=>{if(!t.date)return;const list=map.get(t.date)||[];list.push(t);map.set(t.date,list);});return map;}

function renderMonth(){const now=new Date(),today=calIso(now);if(!CAL.month)CAL.month=new Date(now.getFullYear(),now.getMonth(),1);if(CAL.mode==='%')CAL.mode='$';
  const first=CAL.month,year=first.getFullYear(),month=first.getMonth(),start=calMonday(first),byDate=calByDate(),isCurrent=year===now.getFullYear()&&month===now.getMonth();
  const cells=[];for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);cells.push(d);}
  const grid=cells.map(d=>{const iso=calIso(d),inMonth=d.getMonth()===month,trades=byDate.get(iso)||[],value=calValue(trades),tone=value>0?'pos':value<0?'neg':trades.length?'flat':'';
    return `<button type="button" class="cal-day ${inMonth?'':'out'} ${tone} ${iso===today?'today':''} ${iso===CAL.selected?'sel':''}" aria-pressed="${iso===CAL.selected}" data-cal-day="${iso}" aria-label="${esc(d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}))}${trades.length?`, ${trades.length} trades, ${calFormat(value)}`:''}"><span class="cal-num">${iso===today?`<span class="cal-today">Today ${d.getDate()}</span>`:d.getDate()}</span>${trades.length?`<span class="cal-count">${trades.length} Trade${trades.length===1?'':'s'}</span><b class="cal-val">${value===null?'Open':calFormat(value)}</b>`:''}</button>`;}).join('');
  const monthTrades=allTrades.filter(t=>t.date&&t.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
  $('#ws-month').innerHTML=`<div class="cal-head"><div class="cal-title"><h1>Journal</h1><p>Review your trades, emotions, and patterns to build consistency and self-awareness.</p></div><div class="ws-actions"><div class="cal-seg" role="group" aria-label="Show values as">${[['$','Net P&L in money'],['R','R-multiple']].map(([m,label])=>`<button type="button" data-cal-mode="${m}" aria-pressed="${CAL.mode===m}" title="${label}">${m==='$'?esc(calSymbol()):m}</button>`).join('')}</div><button type="button" class="cal-sync" id="calSync" aria-label="Sync trades from broker" data-tip="Sync trades from broker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg></button>${wsBtn('+ Add Manual Trade','cal-add',true)}<button type="button" class="cal-arrow cal-toggle" id="calPanelToggle" aria-label="${CAL.selected?'Close day panel':'Open day panel'}" aria-expanded="${Boolean(CAL.selected)}">${CAL.selected?'»':'«'}</button></div></div><div class="cal-layout ${CAL.selected?'with-panel':''}"><div class="cal-main">
  <section class="ws-card cal-card"><div class="cal-bar"><div class="cal-nav"><button type="button" class="cal-arrow" data-cal-shift="-1" aria-label="Previous month">‹</button><button type="button" class="cal-arrow" data-cal-shift="1" aria-label="Next month">›</button><h2>${esc(first.toLocaleDateString(undefined,{month:'long',year:'numeric'}))}</h2></div><button type="button" class="cal-this" data-cal-shift="0" ${isCurrent?'disabled':''}>This Month</button></div>
  <div class="cal-week">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div><div class="cal-grid">${grid}</div></section>
  <div class="cal-bottom"><section class="ws-card">${calSummary(monthTrades)}</section><section class="ws-card">${calWeeks(cells,byDate,month,today)}</section></div></div>${CAL.selected?'<aside class="ws-card cal-panel" id="calPanel" aria-label="Day details"></aside>':''}</div>`;
  $$('#ws-month [data-cal-day]').forEach(cell=>cell.onclick=()=>calSelect(cell.dataset.calDay));
  $('#calSync').onclick=calSyncBroker;
  $('#calPanelToggle').onclick=()=>{if(CAL.selected)CAL.selected=null;else CAL.selected=isCurrent?today:calIso(first);renderMonth();};
  if(CAL.selected)renderDayPanel();
  $$('#ws-month [data-cal-shift]').forEach(button=>button.onclick=()=>{const shift=Number(button.dataset.calShift);CAL.month=shift?new Date(year,month+shift,1):new Date(now.getFullYear(),now.getMonth(),1);renderMonth();});
  $$('#ws-month [data-cal-mode]').forEach(button=>button.onclick=()=>{CAL.mode=button.dataset.calMode;try{localStorage.setItem('tj_cal_mode',CAL.mode);}catch{}renderMonth();});}

function calSummary(trades){const closed=trades.filter(wsClosed),s=wsSummary(closed),rs=closed.map(calR).filter(v=>v!==null),nets=closed.map(wsNet);
  if(!closed.length)return `<h2>Monthly Summary</h2>${wsEmpty('No closed trades this month','Results, R distribution and win rate appear after your first closed trade.')}`;
  const buckets=[['≤-2R',r=>r<=-2],['-2R to -1R',r=>r>-2&&r<=-1],['-1R to 0',r=>r>-1&&r<0],['0 to 1R',r=>r>=0&&r<1],['1R to 2R',r=>r>=1&&r<2],['≥2R',r=>r>=2]].map(([label,test])=>[label,rs.filter(test).length]);
  const max=Math.max(1,...buckets.map(b=>b[1])),step=max<=5?1:max<=10?2:max<=25?5:10,top=Math.ceil(max/step)*step,ticks=[];for(let v=0;v<=top;v+=step)ticks.push(v);
  const chart=rs.length?`<div class="cal-hist" role="img" aria-label="R-multiple distribution: ${buckets.map(([l,n])=>`${l} ${n}`).join(', ')}"><div class="cal-hist-y">${ticks.slice().reverse().map(v=>`<span>${v}</span>`).join('')}</div><div class="cal-hist-plot">${ticks.map(v=>`<i class="cal-grid-line" style="bottom:${v/top*100}%"></i>`).join('')}${buckets.map(([label,n])=>`<div class="cal-hist-col" data-tip="${esc(label)}: ${n} trade${n===1?'':'s'}" tabindex="0"><b style="height:${n/top*100}%"></b></div>`).join('')}</div><div class="cal-hist-x">${buckets.map(([label])=>`<span>${esc(label)}</span>`).join('')}</div></div>`:wsEmpty('No R recorded','Add a stop price to your trades to see the R distribution.');
  const rows=[['Expectancy',rs.length?wsNum(rs.reduce((a,b)=>a+b,0)/rs.length,2)+'R':'—'],['Win rate',wsNum(s.winRate,1)+'%'],['Avg Win',s.wins?calSigned(money(s.avgWin),s.avgWin):'—'],['Avg Loss',s.losses?money(s.avgLoss):'—'],['Best trade',calSigned(money(Math.max(...nets)),Math.max(...nets))],['Worst trade',money(Math.min(...nets))],['Total trades',`${closed.length}`]];
  return `<h2>Monthly Summary</h2><div class="cal-summary">${chart}<div class="cal-stats">${rows.map(([label,value],i)=>`<div class="cal-stat ${i===0?'lead':''}"><span>${label}</span><b class="num">${value}</b></div>`).join('')}<div class="cal-wl">${s.wins}W/${s.losses}L</div></div></div>`;}

function calWeeks(cells,byDate,month,today){const weeks=[];for(let w=0;w<6;w++){const days=cells.slice(w*7,w*7+7);if(!days.some(d=>d.getMonth()===month))continue;
    const inMonth=days.filter(d=>d.getMonth()===month),trades=inMonth.flatMap(d=>byDate.get(calIso(d))||[]),traded=inMonth.filter(d=>(byDate.get(calIso(d))||[]).length).length;
    weeks.push({n:weeks.length+1,current:days.some(d=>calIso(d)===today),traded,value:calValue(trades),count:trades.length});}
  return `<h2>Weekly Breakdown</h2><div class="cal-weeks">${weeks.map(w=>`<div class="cal-wk ${w.current?'current':''}"><span class="cal-wk-label">${w.current?'Current':'Week '+w.n}</span>${w.count?`<span class="ws-tag">${w.traded} day${w.traded===1?'':'s'}</span><b class="${w.value>0?'pos':w.value<0?'neg':''}">${calFormat(w.value)}</b>`:'<b class="muted">-</b>'}</div>`).join('')}</div>`;}

// Broker sync: import every closed Delta round-trip into the journal, then refill the calendar.
async function calSyncBroker(){const button=$('#calSync');if(button.classList.contains('busy'))return;button.classList.add('busy');button.disabled=true;button.dataset.tip='Syncing…';
  try{const response=await fetch('/api/delta/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const r=await response.json();
    if(r.error==='no-credentials'){toast('No broker API keys. Add your Delta keys in Settings → Integrations.');return;}
    if(!response.ok||r.error){toast(r.error||'Sync failed');return;}
    await loadAll();
    if(r.imported&&r.latest){const d=new Date(r.latest+'T12:00:00');CAL.month=new Date(d.getFullYear(),d.getMonth(),1);CAL.selected=r.latest;}
    renderMonth();
    toast(r.imported?`Synced ${r.imported} new trade${r.imported===1?'':'s'} from Delta${r.skipped?` · ${r.skipped} already in journal`:''}`:`Up to date · ${r.closed} closed trade${r.closed===1?'':'s'} already in journal`);}
  catch{toast('Could not reach the broker. Check your connection and try again.');}
  finally{const b=$('#calSync');if(b){b.classList.remove('busy');b.disabled=false;b.dataset.tip='Sync trades from broker';}}}
// ---------- day panel ----------
const CAL_EMOJI={Calm:'😌',Confident:'😎',Anxious:'😰',FOMO:'😬',Frustrated:'😤',Tired:'😴',Satisfied:'😊',Relieved:'😮‍💨',Regretful:'😞'};
function calSelect(date){const d=new Date(date+'T12:00:00');CAL.selected=date;CAL.filter='all';CAL.search='';if(d.getMonth()!==CAL.month?.getMonth()||d.getFullYear()!==CAL.month?.getFullYear())CAL.month=new Date(d.getFullYear(),d.getMonth(),1);renderMonth();}
window.calShowDay=date=>{calSelect(date);if(view!=='month')setView('month');};
function calRow(label,value,action=''){return `<div class="cal-prow"><span>${label}</span>${action?`<button type="button" class="ws-link" ${action}>${value}</button>`:`<b>${value}</b>`}</div>`;}
function renderDayPanel(){const panel=$('#calPanel');if(!panel)return;const date=CAL.selected,today=wsLocalDate(),trades=allTrades.filter(t=>t.date===date),closed=trades.filter(wsClosed),s=wsSummary(trades);
  const rs=closed.map(calR).filter(v=>v!==null),avgR=rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null;
  const answered=trades.map(t=>wsReview(t).followedPlan).filter(v=>v===true||v===false),plan=!answered.length?'—':answered.every(Boolean)?'Yes':answered.some(Boolean)?'Partial':'No';
  const reviewed=trades.filter(wsReviewed).length,journaled=trades.length?`${reviewed===trades.length?'Complete':'Incomplete'} ${reviewed}/${trades.length}`:'—';
  let routine='—',routineAction='';if(date===today&&routineState){const done=routineState.checked.length,total=routineState.settings.steps.length;routine=`${done>=total?'Complete':done?'In progress':'Not started'} ${done}/${total}`;routineAction='data-cal-routine';}
  const net=s.net,[whole,cents]=money(net).split(/(?=[.,]\d{2}(?:\D*)$)/);
  panel.innerHTML=`<div class="cal-phead"><button type="button" class="cal-arrow" data-cal-step="-1" aria-label="Previous day">‹</button><button type="button" class="cal-arrow" data-cal-step="1" aria-label="Next day">›</button><h2>${esc(new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'long',day:'numeric'}))}${date===today?' <span class="cal-ptoday">· Today</span>':''}</h2><button type="button" class="cal-this" data-cal-today ${date===today?'disabled':''}>Today</button><button type="button" class="cal-arrow cal-pclose" data-cal-close aria-label="Close day panel">×</button></div>
  <div class="cal-pnet ${closed.length?wsSign(net):'muted'}">${closed.length?`${esc(whole)}<small>${esc(cents||'')}</small>`:'—'}</div><div class="cal-plabel">NET PNL</div>
  <div class="cal-pstats"><div><b>${closed.length?wsNum(s.winRate,1)+'%':'—'}</b><span>WIN RATE</span></div><div><b>${avgR===null?'—':wsNum(avgR,2)+'R'}</b><span>AVERAGE R</span></div><div></div>
   <div><b>${trades.length}</b><span>TOTAL TRADES</span></div><div><b class="pos">${s.wins}</b><span>WINS</span></div><div><b class="neg">${s.losses}</b><span>LOSSES</span></div></div>
  <div class="cal-prows">${calRow('Plan Followed',plan)}${calRow('Pre-Market Routine',routine,routineAction)}${calRow('Trades Journaled',journaled)}</div>
  <label class="cal-note"><span aria-hidden="true">✎</span><input id="calNote" placeholder="Add a note" value="${esc(CAL.notes[date]??'')}" aria-label="Note for this day"><span class="cal-note-status" id="calNoteStatus" role="status"></span></label>
  <div class="cal-ptrades-head"><h2>Trades</h2><span>Tap a trade to see details</span></div>
  <div class="cal-pfilter"><div class="cal-seg cal-tabs">${[['all','All'],['wins','Wins'],['losses','Losses']].map(([k,l])=>`<button type="button" data-cal-filter="${k}" aria-pressed="${CAL.filter===k}">${l}</button>`).join('')}</div><input id="calSearch" placeholder="Instrument" value="${esc(CAL.search)}" aria-label="Filter by instrument"></div>
  <div id="calTrades"></div><button type="button" class="btn ghost cal-padd" data-cal-add-day>+ Add trade for this day</button>`;
  renderPanelTrades();
  panel.querySelectorAll('[data-cal-step]').forEach(b=>b.onclick=()=>calSelect(calIso(new Date(new Date(date+'T12:00:00').getTime()+Number(b.dataset.calStep)*864e5))));
  panel.querySelector('[data-cal-today]').onclick=()=>calSelect(today);panel.querySelector('[data-cal-close]').onclick=()=>{CAL.selected=null;renderMonth();};
  panel.querySelector('[data-cal-routine]')?.addEventListener('click',()=>$('#routineOpen').click());
  panel.querySelectorAll('[data-cal-filter]').forEach(b=>b.onclick=()=>{CAL.filter=b.dataset.calFilter;panel.querySelectorAll('[data-cal-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderPanelTrades();});
  $('#calSearch').oninput=event=>{CAL.search=event.target.value;renderPanelTrades();};
  panel.querySelector('[data-cal-add-day]').onclick=()=>openTradePage(null,date);
  const note=$('#calNote');note.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();note.blur();}};note.onchange=()=>calSaveNote(date,note.value.trim());
  if(!(date in CAL.notes))fetch('/api/daylog?date='+encodeURIComponent(date)).then(r=>r.json()).then(d=>{CAL.notes[date]=d.log?.overall||'';const input=$('#calNote');if(input&&CAL.selected===date&&document.activeElement!==input)input.value=CAL.notes[date];}).catch(()=>{});}
function renderPanelTrades(){const target=$('#calTrades');if(!target)return;const q=CAL.search.trim().toLowerCase();
  const list=allTrades.filter(t=>t.date===CAL.selected).filter(t=>CAL.filter==='all'||(CAL.filter==='wins'?wsClosed(t)&&wsNet(t)>0:wsClosed(t)&&wsNet(t)<0)).filter(t=>!q||String(t.symbol||'').toLowerCase().includes(q)).sort((a,b)=>String(a.entry_time||'').localeCompare(String(b.entry_time||''))||a.id-b.id);
  if(!list.length){target.innerHTML=`<p class="cal-pempty">${allTrades.some(t=>t.date===CAL.selected)?'No trades match this filter.':'No trades on this day.'}</p>`;return;}
  target.innerHTML=`<table class="cal-ptable"><thead><tr><th>Instrument</th><th>Time</th><th>Direction</th><th>Emotions</th><th class="right">PnL</th></tr></thead><tbody>${list.map(t=>{const r=wsReview(t),time=String(t.entry_time||'').split('T')[1]||'—',long=t.direction==='Long';
    return `<tr tabindex="0" data-cal-trade="${t.id}" aria-label="Open ${esc(t.symbol||'trade')}"><td class="cal-inst">${wsReviewed(t)?'':'<span class="cal-missing" tabindex="0" role="img" aria-label="Journal is missing" data-tip="Journal is missing"></span>'}<b>${esc(t.symbol||'—')}</b></td><td class="num muted">${esc(time.slice(0,5))}</td><td class="${long?'pos':'neg'}">${long?'↑ Buy':'↓ Sell'}</td><td title="${esc([r.emotionIn,r.emotionOut].filter(Boolean).join(' → ')||'Not recorded')}">${r.emotionIn||r.emotionOut?`${CAL_EMOJI[r.emotionIn]||'·'} → ${CAL_EMOJI[r.emotionOut]||'·'}`:'<span class="muted">—</span>'}</td><td class="right num ${wsClosed(t)?wsSign(wsNet(t)):''}">${wsClosed(t)?money(wsNet(t)):'Open'}</td></tr>`;}).join('')}</tbody></table>`;
  target.querySelectorAll('[data-cal-trade]').forEach(row=>{const open=()=>openTradeDetail(Number(row.dataset.calTrade));row.onclick=open;row.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();open();}};});}
// The day note is the day log's "overall" field; merge into the saved log so other fields stay.
async function calSaveNote(date,value){const status=$('#calNoteStatus');if(status)status.textContent='Saving…';
  try{const fresh=(await (await fetch('/api/daylog?date='+encodeURIComponent(date))).json()).log||{};const response=await fetch('/api/daylog',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fresh,overall:value,date})});if(!response.ok)throw Error();CAL.notes[date]=value;if(status&&CAL.selected===date)status.textContent='Saved';}
  catch{if(status)status.textContent='Not saved';}}

// ---------- wiring ----------
const calBaseRender=window.renderWorkspaceView;
window.renderWorkspaceView=function(key){if(key==='month')renderMonth();else if(key==='performance')renderPerformanceWorkspace();else calBaseRender(key);};
const calBaseSetView=setView;
// The day view belongs to the Journal nav item and always shows the day (no day list).
setView=function(v){calBaseSetView(v);if(v==='journal'){$('#app').classList.add('detail');$$('.navitem').forEach(n=>n.classList.toggle('on',n.dataset.view==='month'));}};
$('#backBtn').textContent='‹ Calendar';$('#backBtn').onclick=()=>setView('month');
Object.assign(wsActions,{'cal-add':async()=>{await selectDay(wsLocalDate());await wsNewTrade();},calendar:()=>setView('month')});
