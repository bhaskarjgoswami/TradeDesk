'use strict';
// Trades page: every trade in one sortable list, plus a "To review" queue that
// reviews one trade at a time. Reviews are stored in trade.review (JSON), the same
// shape the trade form and Performance breakdowns already use.
const TL_TAB_IDS={all:'tlTabAll',review:'tlTabReview',week:'tlTabWeek'};
const TL={tab:'all',weekOffset:0,q:'',dir:'',result:'',sort:'date',desc:true,limit:50,reviewIdx:0,skipped:new Set(),busy:false};
const TL_QUALITY=['A+','A','B','C','F'];
const TL_EMO_IN=['Calm','Confident','Anxious','FOMO','Frustrated','Tired'];
const TL_EMO_OUT=['Satisfied','Calm','Relieved','Frustrated','Regretful'];
const tlDir=t=>{const d=String(t.direction||'').toLowerCase();return d==='buy'||d==='long'?'Long':d==='sell'||d==='short'?'Short':(t.direction||'');};
const tlNeedsReview=t=>wsClosed(t)&&!wsReviewed(t);
const tlR=t=>{const r=Number(t.r_multiple);return t.r_multiple===null||t.r_multiple===''||t.r_multiple===undefined||!Number.isFinite(r)?null:r;};

function tlFiltered(){const q=TL.q.trim().toLowerCase();
  return allTrades.filter(t=>{
    if(q&&![t.symbol,t.setup,t.notes,t.tags,t.direction].some(v=>String(v||'').toLowerCase().includes(q)))return false;
    if(TL.dir&&tlDir(t)!==TL.dir)return false;
    if(TL.result==='win'&&!(wsClosed(t)&&wsNet(t)>0))return false;
    if(TL.result==='loss'&&!(wsClosed(t)&&wsNet(t)<0))return false;
    if(TL.result==='open'&&wsClosed(t))return false;
    return true;});}
function tlSorted(list){const key=TL.sort,dir=TL.desc?-1:1;
  const val=t=>key==='date'?`${t.date||''} ${t.entry_time||''} ${String(t.id).padStart(9,'0')}`:key==='symbol'?String(t.symbol||'').toLowerCase():key==='pnl'?(wsClosed(t)?wsNet(t):-Infinity):key==='r'?(tlR(t)??-Infinity):'';
  return [...list].sort((a,b)=>{const x=val(a),y=val(b);return x<y?-dir:x>y?dir:0;});}
window.tradesToReviewCount=()=>(typeof allTrades==='undefined'?0:allTrades.filter(tlNeedsReview).length);

window.renderTradesList=function(){const root=$('#ws-trades');if(!root)return;
  const queue=allTrades.filter(tlNeedsReview).length;
  root.innerHTML=`<header class="ws-header"><div><span class="ws-eyebrow">Your trades</span><h1>Trades</h1><p class="ws-subtitle">Find any trade, and review the ones you haven't looked at yet.</p></div><div class="tl-head-actions">${wsBtn('Import trades','import',true)}${wsBtn('Export CSV','export',true)}<button type="button" class="btn" id="tlAdd">+ Add trade</button></div></header>
  <div class="tl-tabs" role="tablist" aria-label="Trades views"><button type="button" role="tab" id="tlTabAll" aria-selected="${TL.tab==='all'}" aria-controls="tlPanel" data-tl-tab="all">All trades <span class="tl-n">${allTrades.length}</span></button><button type="button" role="tab" id="tlTabReview" aria-selected="${TL.tab==='review'}" aria-controls="tlPanel" data-tl-tab="review">To review <span class="tl-n ${queue?'on':''}">${queue}</span></button><button type="button" role="tab" id="tlTabWeek" aria-selected="${TL.tab==='week'}" aria-controls="tlPanel" data-tl-tab="week">Weekly review</button></div>
  <div id="tlPanel" role="tabpanel" aria-labelledby="${TL_TAB_IDS[TL.tab]}"></div>`;
  $('#tlAdd').onclick=()=>openTradePage(null,wsLocalDate());
  root.querySelectorAll('[data-tl-tab]').forEach(b=>b.onclick=()=>{TL.tab=b.dataset.tlTab;TL.reviewIdx=0;renderTradesList();});
  root.querySelector('.tl-tabs').onkeydown=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const tabs=Object.keys(TL_TAB_IDS),i=tabs.indexOf(TL.tab);TL.tab=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];renderTradesList();$('#'+TL_TAB_IDS[TL.tab]).focus();};
  if(TL.tab==='all')tlRenderAll();else if(TL.tab==='review')tlRenderReview();else tlRenderWeek();};

function tlRenderAll(){const panel=$('#tlPanel');
  panel.innerHTML=`<div class="tl-filters"><label class="tl-search"><span class="sr-only">Search trades</span><input id="tlQ" type="search" placeholder="Symbol, setup, notes or tag" value="${esc(TL.q)}"></label>
   <label><span class="sr-only">Direction</span><select id="tlDir"><option value="">All directions</option><option ${TL.dir==='Long'?'selected':''} value="Long">Long</option><option ${TL.dir==='Short'?'selected':''} value="Short">Short</option></select></label>
   <label><span class="sr-only">Result</span><select id="tlRes"><option value="">All results</option><option ${TL.result==='win'?'selected':''} value="win">Wins</option><option ${TL.result==='loss'?'selected':''} value="loss">Losses</option><option ${TL.result==='open'?'selected':''} value="open">Open</option></select></label>
   <label class="tl-sort"><span class="sr-only">Sort</span><select id="tlSort">${[['date:1','Newest first'],['date:0','Oldest first'],['pnl:1','Biggest win first'],['pnl:0','Biggest loss first']].map(([v,l])=>`<option value="${v}" ${v===TL.sort+':'+(TL.desc?1:0)?'selected':''}>${l}</option>`).join('')}</select></label></div>
   <div id="tlResults"></div>`;
  let timer=null;
  $('#tlQ').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{TL.q=e.target.value;TL.limit=50;tlRenderRows();},200);};
  $('#tlDir').onchange=e=>{TL.dir=e.target.value;TL.limit=50;tlRenderRows();};
  $('#tlRes').onchange=e=>{TL.result=e.target.value;TL.limit=50;tlRenderRows();};
  $('#tlSort').onchange=e=>{const [k,d]=e.target.value.split(':');TL.sort=k;TL.desc=d==='1';tlRenderRows();};
  tlRenderRows();}

function tlRenderRows(){const box=$('#tlResults');if(!box)return;const all=tlSorted(tlFiltered()),list=all.slice(0,TL.limit);
  if(!allTrades.length){box.innerHTML=`<div class="tl-empty"><b>No trades yet</b><p>Log your first trade and it will show up here.</p></div>`;return;}
  if(!all.length){box.innerHTML=`<div class="tl-empty"><b>No trades match</b><p>Try a different search or clear the filters.</p></div>`;return;}
  const closed=all.filter(wsClosed),net=closed.reduce((s,t)=>s+wsNet(t),0);
  const head=(key,label,cls='')=>{const on=TL.sort===key;return `<th scope="col" class="${cls}" aria-sort="${on?(TL.desc?'descending':'ascending'):'none'}"><button type="button" data-tl-sort="${key}">${label}<span class="tl-arrow" aria-hidden="true">${on?(TL.desc?'↓':'↑'):''}</span></button></th>`;};
  box.innerHTML=`<p class="tl-summary"><span>${all.length} ${all.length===1?'trade':'trades'}</span> · <span class="${wsSign(net)}">${money(net)}</span> <span>net</span></p>
   <div class="tl-table-wrap"><table class="tl-table"><thead><tr>${head('date','Date')}${head('symbol','Instrument')}<th scope="col">Direction</th><th scope="col">Setup</th>${head('pnl','Net P&amp;L','right')}${head('r','R','right')}<th scope="col" class="center">Reviewed</th></tr></thead>
   <tbody>${list.map(t=>{const r=tlR(t),d=tlDir(t);return `<tr data-tl-open="${t.id}" tabindex="0" aria-label="${esc((t.symbol||'Trade')+' '+(t.date||''))}"><td data-label="Date" class="num">${esc(wsDate(t.date?t.date+'T12:00:00':''))}</td><td data-label="Instrument"><b translate="no">${esc(t.symbol||'Trade')}</b></td><td data-label="Direction">${d?`<span class="tl-dir ${d==='Long'?'long':'short'}">${esc(d)}</span>`:'<span class="muted">-</span>'}</td><td data-label="Setup">${esc(t.setup||'')}</td><td data-label="Net P&amp;L" class="right num ${wsClosed(t)?wsSign(wsNet(t)):'muted'}">${wsClosed(t)?money(wsNet(t)):'Open'}</td><td data-label="R" class="right num ${r==null?'muted':wsSign(r)}">${r==null?'-':wsNum(r)+'R'}</td><td data-label="Reviewed" class="center">${wsReviewed(t)?'<span class="tl-ok" title="Reviewed">Reviewed</span>':tlNeedsReview(t)?'<button type="button" class="tl-review-btn" data-tl-review="'+t.id+'">Review</button>':'<span class="muted">-</span>'}</td></tr>`;}).join('')}</tbody></table></div>
   ${all.length>list.length?`<button type="button" class="btn ghost tl-more" id="tlMore">Show ${Math.min(50,all.length-list.length)} more</button>`:''}`;
  box.querySelectorAll('[data-tl-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.tlSort;if(TL.sort===k)TL.desc=!TL.desc;else{TL.sort=k;TL.desc=k!=='symbol';}tlRenderRows();box.querySelector(`[data-tl-sort="${k}"]`)?.focus();});
  box.querySelectorAll('[data-tl-open]').forEach(row=>{const open=()=>openTradeDetail(Number(row.dataset.tlOpen));row.onclick=e=>{if(e.target.closest('[data-tl-review]'))return;open();};row.onkeydown=e=>{if(e.target===row&&(e.key==='Enter'||e.key===' ')){e.preventDefault();open();}};});
  box.querySelectorAll('[data-tl-review]').forEach(b=>b.onclick=()=>{const id=Number(b.dataset.tlReview);TL.tab='review';TL.skipped.clear();renderTradesList();tlFocusReview(id);});
  const more=$('#tlMore');if(more)more.onclick=()=>{TL.limit+=50;tlRenderRows();};}

function tlQueue(){return tlSorted(allTrades.filter(tlNeedsReview).filter(t=>!TL.skipped.has(t.id)));}
function tlFocusReview(id){const q=tlQueue(),i=q.findIndex(t=>t.id===id);TL.reviewIdx=i<0?0:i;tlRenderReview();}

function tlRenderReview(){const panel=$('#tlPanel'),q=tlQueue(),left=allTrades.filter(tlNeedsReview).length;
  if(!q.length){panel.innerHTML=`<div class="tl-empty tl-done"><b>${left?'Nothing left in this pass':'All caught up'}</b><p>${left?`You skipped some trades in this pass. Start again to review them.`:'Every closed trade has a review. New trades will show up here after you log them.'}</p>${left?'<button type="button" class="btn" id="tlRestart">Start again</button>':''}</div>`;
    const again=$('#tlRestart');if(again)again.onclick=()=>{TL.skipped.clear();TL.reviewIdx=0;tlRenderReview();};return;}
  const t=q[Math.min(TL.reviewIdx,q.length-1)],r=wsReview(t),d=tlDir(t),rm=tlR(t);
  const chips=(name,opts,cur,label)=>`<fieldset class="tl-chips"><legend>${label}</legend><div>${opts.map(([v,l])=>`<label class="tl-chip"><input type="radio" name="${name}" value="${esc(v)}" ${cur===v?'checked':''}><span>${esc(l)}</span></label>`).join('')}</div></fieldset>`;
  const followed=r.followedPlan===true?'yes':r.followedPlan===false?'no':'';
  panel.innerHTML=`<p class="tl-progress" aria-live="polite">${left===1?'1 trade to review':`${left} trades to review`}</p>
   <form class="tl-card" id="tlReviewForm" data-id="${t.id}">
    <div class="tl-card-head"><div><b translate="no">${esc(t.symbol||'Trade')}</b> ${d?`<span class="tl-dir ${d==='Long'?'long':'short'}">${esc(d)}</span>`:''}<span class="tl-meta">${esc(wsDate(t.date?t.date+'T12:00:00':''))}${t.setup?' · '+esc(t.setup):''}</span></div><div class="tl-result"><b class="${wsSign(wsNet(t))}">${money(wsNet(t))}</b>${rm==null?'':`<span class="${wsSign(rm)}">${wsNum(rm)}R</span>`}</div></div>
    ${chips('followed',[['yes','Yes'],['no','No']],followed,'Did you follow your plan?')}
    ${chips('quality',TL_QUALITY.map(x=>[x,x]),r.quality||'','Setup quality')}
    ${chips('emotionIn',TL_EMO_IN.map(x=>[x,x]),r.emotionIn||'','Entry emotion')}
    ${chips('emotionOut',TL_EMO_OUT.map(x=>[x,x]),r.emotionOut||'','Exit emotion')}
    <label class="tl-lesson"><span>One lesson from this trade</span><input name="mistakes" maxlength="500" value="${esc(r.mistakes||'')}" placeholder="e.g. Waited for the retest, keep doing that"></label>
    <div class="tl-actions"><button type="button" class="btn ghost" id="tlOpenTrade">Open trade</button><span class="tl-spacer"></span><button type="button" class="btn ghost" id="tlSkip">Skip</button><button type="submit" class="btn" id="tlSave">Save and next</button></div>
    <p class="ws-form-status" id="tlStatus" role="status"></p>
   </form>`;
  const form=$('#tlReviewForm');
  $('#tlOpenTrade').onclick=()=>openTradeDetail(t.id);
  $('#tlSkip').onclick=()=>{TL.skipped.add(t.id);TL.reviewIdx=0;tlRenderReview();$('#tlPanel input')?.focus();};
  form.onsubmit=async e=>{e.preventDefault();if(TL.busy)return;TL.busy=true;$('#tlSave').disabled=true;$('#tlStatus').textContent='Saving…';
    const val=n=>form.querySelector(`input[name="${n}"]:checked`)?.value||'';
    const f=val('followed'),review={...r,version:1,followedPlan:f==='yes'?true:f==='no'?false:(r.followedPlan??null),quality:val('quality'),emotionIn:val('emotionIn'),emotionOut:val('emotionOut'),mistakes:form.mistakes.value.trim(),reviewed:true,reviewedAt:r.reviewedAt||new Date().toISOString()};
    // Review-only save: never resends prices or times, and fails cleanly if another tab changed this review.
    try{await wsApi('review/'+t.id,'PUT',{review,notes:t.notes||'',expectedReview:t.review||null,expectedNotes:t.notes||null});
      await refreshTrade(t.id);window.tdTrack?.('trade_reviewed');toast('Review saved');TL.reviewIdx=0;renderTradesList();$('#tlPanel input')?.focus();}
    catch(err){$('#tlStatus').textContent=(err&&err.message)||'Could not save. Your answers are still here.';$('#tlSave').disabled=false;}
    finally{TL.busy=false;}};}

// ---------- Weekly review: last week's result, discipline and one focus for the next ----------
const tlIso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function tlWeekRange(offset){const now=new Date();now.setHours(12,0,0,0);const monday=new Date(now);monday.setDate(now.getDate()-((now.getDay()+6)%7)+offset*7);const sunday=new Date(monday);sunday.setDate(monday.getDate()+6);return{start:tlIso(monday),end:tlIso(sunday),monday,sunday};}
function tlWeekStats(range){const trades=allTrades.filter(t=>t.date>=range.start&&t.date<=range.end),closed=trades.filter(wsClosed),net=closed.reduce((s,t)=>s+wsNet(t),0),wins=closed.filter(t=>wsNet(t)>0).length,rs=closed.map(tlR).filter(r=>r!=null);
  return{trades,closed,net,wins,winRate:closed.length?wins/closed.length:null,avgR:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:null};}
function tlWeekNote(start){return (WS.items.note||[]).find(n=>n.title==='Weekly focus '+start);}
function tlRenderWeek(){const panel=$('#tlPanel'),range=tlWeekRange(TL.weekOffset),prev=tlWeekRange(TL.weekOffset-1),w=tlWeekStats(range),p=tlWeekStats(prev);
  const fmtD=d=>d.toLocaleDateString(window.TDLocale?.language||undefined,{month:'short',day:'numeric'});
  const label=TL.weekOffset===0?'This week':TL.weekOffset===-1?'Last week':`Week of ${fmtD(range.monday)}`;
  const delta=w.closed.length&&p.closed.length?w.net-p.net:null;
  const bySetup={};w.closed.forEach(t=>{const k=t.setup||'No setup';(bySetup[k]=bySetup[k]||{n:0,net:0});bySetup[k].n++;bySetup[k].net+=wsNet(t);});
  const setups=Object.entries(bySetup).sort((a,b)=>b[1].net-a[1].net);
  const reviews=w.trades.map(t=>({t,r:wsReview(t)})),reviewed=reviews.filter(x=>x.r.reviewed===true),broke=reviews.filter(x=>x.r.followedPlan===false),hot=reviews.filter(x=>['FOMO','Frustrated','Anxious'].includes(x.r.emotionIn));
  const g=WS.guard?.settings||{},perDay={};w.trades.forEach(t=>{perDay[t.date]=(perDay[t.date]||0)+1;});const overDays=g.enabled?Object.values(perDay).filter(n=>n>g.maxTrades).length:0;
  const sorted=[...w.closed].sort((a,b)=>wsNet(b)-wsNet(a)),best=sorted[0],worst=sorted.length>1?sorted.at(-1):null;
  const note=tlWeekNote(range.start),prevNote=tlWeekNote(prev.start),reviewedOf=`${reviewed.length} of ${w.trades.length}`;
  const tradeLink=(t,lab)=>t?`<button type="button" class="tl-link" data-tl-open-trade="${t.id}"><span>${lab}</span> <b translate="no">${esc(t.symbol||'Trade')}</b> <span class="${wsSign(wsNet(t))}">${money(wsNet(t))}</span></button>`:'';
  panel.innerHTML=`<div class="tl-week-nav"><button type="button" class="tl-icon" id="tlWkPrev" aria-label="Previous week">‹</button><div><b>${label}</b><span class="tl-meta">${fmtD(range.monday)} <span>to</span> ${fmtD(range.sunday)}</span></div><button type="button" class="tl-icon" id="tlWkNext" aria-label="Next week" ${TL.weekOffset>=0?'disabled':''}>›</button></div>
   ${!w.trades.length?`<div class="tl-empty"><b>No trades this week</b><p>${TL.weekOffset===0?'Your weekly review fills in as you log trades.':'Nothing was logged in this week.'}</p></div>`:`
   <div class="tl-stats">
    <div><span>Net P&amp;L</span><b class="${wsSign(w.net)}">${money(w.net)}</b>${delta==null?'':`<small class="${wsSign(delta)}">${delta>=0?'+':''}${money(delta)} vs previous week</small>`}</div>
    <div><span>Trades</span><b>${w.trades.length}</b><small>${w.closed.length} closed</small></div>
    <div><span>Win rate</span><b>${w.winRate==null?'-':Math.round(w.winRate*100)+'%'}</b><small>${w.wins} of ${w.closed.length} closed</small></div>
    <div><span>Average R</span><b class="${w.avgR==null?'':wsSign(w.avgR)}">${w.avgR==null?'-':wsNum(w.avgR)+'R'}</b><small>where risk was recorded</small></div>
   </div>
   <div class="tl-week-grid">
    <section class="tl-box"><h3>By setup</h3>${setups.length?`<ul class="tl-list">${setups.map(([k,v])=>`<li><span>${esc(k)}</span><span class="tl-meta">${v.n} ${v.n===1?'trade':'trades'}</span><b class="${wsSign(v.net)}">${money(v.net)}</b></li>`).join('')}</ul>`:'<p class="tl-meta">No closed trades yet.</p>'}${best?`<div class="tl-bw">${tradeLink(best,'Best')}${worst?tradeLink(worst,'Worst'):''}</div>`:''}</section>
    <section class="tl-box"><h3>Discipline</h3><ul class="tl-list">
     <li><span>Reviewed</span><b>${reviewedOf}</b></li>
     <li><span>Plan not followed</span><b class="${broke.length?'neg':''}">${broke.length}</b></li>
     <li><span>Entered on FOMO, fear or frustration</span><b class="${hot.length?'neg':''}">${hot.length}</b></li>
     ${g.enabled?`<li><span>Days over your ${g.maxTrades}-trade limit</span><b class="${overDays?'neg':''}">${overDays}</b></li>`:''}
    </ul>${reviewed.length<w.trades.length?`<button type="button" class="btn ghost tl-small" id="tlWkReview">${w.trades.length-reviewed.length===1?'Review 1 trade':`Review ${w.trades.length-reviewed.length} trades`}</button>`:''}</section>
   </div>`}
   <form class="tl-box tl-focus" id="tlFocusForm">
    ${prevNote?.body?.content?`<p class="tl-prev"><span>Your focus for the week before</span>${esc(prevNote.body.content)}</p>`:''}
    <label for="tlFocus"><b>${TL.weekOffset===0?'One focus for the rest of this week':'One focus for next week'}</b></label>
    <textarea id="tlFocus" rows="2" maxlength="500" placeholder="e.g. No trades in the first 15 minutes after the open">${esc(note?.body?.content||'')}</textarea>
    <div class="tl-actions"><span class="ws-form-status" id="tlFocusStatus" role="status"></span><span class="tl-spacer"></span><button type="submit" class="btn">Save focus</button></div>
   </form>`;
  $('#tlWkPrev').onclick=()=>{TL.weekOffset--;tlRenderWeek();};
  $('#tlWkNext').onclick=()=>{if(TL.weekOffset<0){TL.weekOffset++;tlRenderWeek();}};
  panel.querySelectorAll('[data-tl-open-trade]').forEach(b=>b.onclick=()=>openTradeDetail(Number(b.dataset.tlOpenTrade)));
  const rv=$('#tlWkReview');if(rv)rv.onclick=()=>{TL.tab='review';TL.skipped.clear();TL.reviewIdx=0;renderTradesList();};
  $('#tlFocusForm').onsubmit=async e=>{e.preventDefault();const content=$('#tlFocus').value.trim(),status=$('#tlFocusStatus');status.textContent='Saving…';
    try{const payload={kind:'note',title:'Weekly focus '+range.start,body:{content,tags:'weekly-review',pinned:false}};
      if(note)await wsApi('items/'+note.id,'PUT',{...payload,revision:note.revision});else await wsApi('items','POST',{...payload,clientId:crypto.randomUUID()});
      await wsReload('note');status.textContent='Saved';}
    catch(err){status.textContent=(err&&err.message)||'Could not save. Try again.';}};}
