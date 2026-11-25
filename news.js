'use strict';
// News: market headlines (crypto, India, global macro/FX/gold) and this week's economic calendar.
// Data comes from /api/news and /api/news/calendar (public feeds, cached by the server).
// Headlines and event names are third-party text: always escaped and never translated.

const NEWS={cat:'breaking',impact:'medium',items:null,failed:[],events:null,error:'',calError:'',loading:false,fetchedAt:0,tick:null};
// Headline topics: [key, label, description]. Keys match FEEDS in news.py and NEWS_REGIONS in workspace.py.
const NEWS_TOPICS=[
  ['stocks','Stock markets','Share market and index news for the country in your Account.'],
  ['forex','Currencies','Currency pairs and the US dollar.'],
  ['commodities','Commodities','Gold, silver, crude oil and metals.'],
  ['crypto','Crypto','Bitcoin, Ethereum and the wider crypto market.'],
  ['macro','Macro & rates','Central banks, inflation, bonds and the economy.'],
  ['ipo','IPO','Upcoming listings, subscriptions and debuts.'],
  ['funds','Funds & ETFs','Mutual funds, ETFs and long-term investing.']];
// Region whose local sources feed Stock market news (and IPO, funds, macro where available).
// [key, label, flag]. Keys match COUNTRIES in news.py and NEWS_COUNTRIES in workspace.py.
const NEWS_COUNTRIES=[['global','Global','🌐'],['in','India','🇮🇳'],['us','United States','🇺🇸'],['gb','United Kingdom','🇬🇧'],
  ['eu','Europe','🇪🇺'],['ca','Canada','🇨🇦'],['au','Australia','🇦🇺'],['sg','Singapore','🇸🇬'],
  ['cn','China & Hong Kong','🇨🇳'],['asia','Asia','🌏'],['ae','Middle East','🇦🇪'],['za','South Africa','🇿🇦']];
const newsCountryInfo=key=>NEWS_COUNTRIES.find(([k])=>k===key)||NEWS_COUNTRIES[0];
const NEWS_CAT_LABEL=Object.fromEntries(NEWS_TOPICS.map(([key,label])=>[key,label]));
const NEWS_REFRESH_MS=5*60*1000;
const NEWS_HIGH_IMPACT=3;  // matches HIGH_IMPACT in news.py
const newsIsHigh=i=>(Number(i.impact)||0)>=NEWS_HIGH_IMPACT;
const NEWS_REGIONS=NEWS_TOPICS.map(([key])=>key),NEWS_DEFAULT_REGIONS=['stocks','forex','commodities','crypto'];
const NEWS_LEGACY={india:'stocks',us:'stocks',global:'macro',bonds:'macro'};
// The news region follows the country set in Account (profile.js, ISO codes). Countries without
// their own local sources use the nearest region, or Global.
const NEWS_EU=['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','CH','NO','IS','LI'];
const NEWS_ASIA=['JP','KR','ID','MY','TH','VN','PH','PK','BD','LK','NP','TW','MO','KH','MM','MN'];
const NEWS_GULF=['AE','SA','QA','KW','BH','OM','JO','EG','IL','TR'];
function newsRegionForCountry(code){
  code=String(code||'').toUpperCase();
  const direct={IN:'in',US:'us',GB:'gb',CA:'ca',AU:'au',NZ:'au',SG:'sg',CN:'cn',HK:'cn',ZA:'za'};
  return direct[code]||(NEWS_EU.includes(code)?'eu':NEWS_ASIA.includes(code)?'asia':NEWS_GULF.includes(code)?'ae':'global');
}
function newsCountry(){return newsRegionForCountry(typeof PF!=='undefined'?PF.data?.settings?.country:'');}
// Topics chosen in Settings > Journal (saved with journal preferences as newsRegions).
function newsRegions(){
  const saved=typeof WS!=='undefined'?WS.prefs?.settings?.newsRegions:null;
  const mapped=Array.isArray(saved)?saved.map(r=>NEWS_LEGACY[r]||r):[],list=NEWS_REGIONS.filter(r=>mapped.includes(r));
  return list.length?list:NEWS_DEFAULT_REGIONS;
}
const NEWS_STORE='td_news_cache',NEWS_STORE_MAX_AGE=6*60*60*1000;

// Show the last copy instantly on reload (this browser only), then refresh in the background.
(function newsHydrate(){
  try{
    const saved=JSON.parse(localStorage.getItem(NEWS_STORE)||'null');
    if(!saved||!Array.isArray(saved.items)||!(Date.now()-saved.at<NEWS_STORE_MAX_AGE))return;
    NEWS.items=saved.items;NEWS.events=Array.isArray(saved.events)?saved.events:null;NEWS.stale=true;
  }catch{}
})();
function newsStore(){
  try{localStorage.setItem(NEWS_STORE,JSON.stringify({at:Date.now(),items:NEWS.items,events:NEWS.events}));}catch{}
}

async function newsGet(path){
  const response=await fetch(path);let data={};
  try{data=await response.json();}catch{}
  if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:data.error||'Request failed');
  return data;
}

async function newsLoad(force=false){
  if(NEWS.loading)return;
  const regions=newsRegions(),country=newsCountry(),key=country+':'+regions.join(','),changed=NEWS.loadedFor!==key;
  if(!force&&!changed&&NEWS.fetchedAt&&Date.now()-NEWS.fetchedAt<NEWS_REFRESH_MS)return;
  NEWS.loading=true;if(view==='news')newsPaint();
  const [heads,cal]=await Promise.allSettled([newsGet('/api/news?cat='+encodeURIComponent(regions.join(','))+'&country='+country),newsGet('/api/news/calendar?impact=medium')]);
  if(heads.status==='fulfilled'){NEWS.items=heads.value.items||[];NEWS.failed=heads.value.failed||[];NEWS.error='';NEWS.stale=false;NEWS.fetchedAt=Date.now();NEWS.loadedFor=key;}
  else NEWS.error=heads.reason?.message||'Request failed';  // fetchedAt stays, so the next open retries
  if(cal.status==='fulfilled'){NEWS.events=cal.value.events||[];NEWS.calError='';}
  else NEWS.calError=cal.reason?.message||'Request failed';
  NEWS.loading=false;
  if(heads.status==='fulfilled')newsStore();
  if(view==='news')newsPaint();
  if(typeof RN!=='undefined'&&RN.active&&!$('#routinePanel')?.hidden)renderRoutinePanel();
}

// Your own events from the Market calendar (workspace items), shown beside the live feed.
// Original source for a calendar event: the Forex Factory calendar for that day (the feed has no
// per-event link; its days run on New York time), or the source link saved with the trader's own event.
function newsEventUrl(e){
  if(e.mine)return e.source||'';
  try{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric'}).formatToParts(new Date(e.at)).map(x=>[x.type,x.value]));
    return `https://www.forexfactory.com/calendar?day=${parts.month.toLowerCase()}${parts.day}.${parts.year}`;}catch{return '';}
}
function newsUserEvents(){
  const list=typeof WS!=='undefined'&&Array.isArray(WS.items?.event)?WS.items.event:[];
  const from=Date.now()-86400000,to=Date.now()+8*86400000;
  return list.filter(item=>{const at=Date.parse(item.body?.at);return at>=from&&at<=to;}).map(item=>({
    title:item.title||'',currency:String(item.body.currency||'').toUpperCase(),at:item.body.at,
    impact:String(item.body.impact||'').toLowerCase(),forecast:'',previous:'',mine:true,source:/^https?:\/\//.test(item.body.source||'')?item.body.source:''}));
}

function newsAllEvents(){
  const levels=NEWS.impact==='high'?['high']:['high','medium'];
  return [...(NEWS.events||[]).filter(e=>levels.includes(e.impact)),...newsUserEvents()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}

function newsCountdown(ms){
  const mins=Math.max(0,Math.round(ms/60000)),d=Math.floor(mins/1440),h=Math.floor(mins%1440/60),m=mins%60;
  return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`;
}
// Times follow the time zone in Account (profile.js), else the browser's, and the reader's locale ("1:45 PM").
function newsZone(){try{return (typeof PF!=='undefined'&&PF.data?.settings?.timezone)||Intl.DateTimeFormat().resolvedOptions().timeZone||undefined;}catch{return undefined;}}
function newsFmt(iso,opts){try{return new Date(iso).toLocaleString(undefined,{...opts,timeZone:newsZone()});}catch{return new Date(iso).toLocaleString(undefined,opts);}}
const newsTime=iso=>newsFmt(iso,{hour:'numeric',minute:'2-digit'});
const newsDay=iso=>newsFmt(iso,{weekday:'short',day:'numeric',month:'short'});
// YYYY-MM-DD in the reader's zone, so keys sort and compare as strings.
const newsDayKey=iso=>{try{return new Date(iso).toLocaleDateString('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:newsZone()});}catch{return new Date(iso).toLocaleDateString('en-CA');}};
// Short zone name for the calendar header ("IST", "EST"). Some locales only know "GMT+5:30"; try a few
// English locales for a proper abbreviation before falling back to the offset.
function newsZoneShort(){const zone=newsZone(),part=locale=>{try{return new Intl.DateTimeFormat(locale,{timeZone:zone,timeZoneName:'short'}).formatToParts(new Date()).find(x=>x.type==='timeZoneName')?.value||'';}catch{return '';}};
  const tries=[...(navigator.languages||[]),'en-IN','en-US','en-GB','en-AU'].map(part).filter(Boolean);
  return tries.find(x=>!/^(GMT|UTC)[+-]/.test(x))||tries[0]||'';}
function newsAgo(iso){
  if(!iso)return '';const mins=Math.round((Date.now()-Date.parse(iso))/60000);
  if(mins<1)return 'now';if(mins<60)return mins+'m';if(mins<1440)return Math.floor(mins/60)+'h';
  return newsDay(iso);
}


// ---------- Indices tab: news about the main indices of the reader's region (Account country) ----------
const NEWS_INDEX_NAMES={global:'S&P 500, Nasdaq, FTSE 100, Nikkei, Hang Seng, Sensex',in:'Nifty 50, Sensex, Bank Nifty',us:'S&P 500, Nasdaq, Dow Jones',
  gb:'FTSE 100, FTSE 250',eu:'Euro Stoxx 50, DAX, CAC 40, FTSE MIB',ca:'S&P/TSX',au:'ASX 200, All Ordinaries, NZX 50',sg:'Straits Times Index',
  cn:'Hang Seng, Shanghai Composite, CSI 300',asia:'Nikkei 225, KOSPI, Hang Seng, Taiex',ae:'Tadawul, DFM, ADX',za:'JSE All Share, JSE Top 40'};
NEWS.idx={key:null,items:null,error:'',at:0,loading:false};
async function newsLoadIndices(force=false){
  const key=newsCountry(),idx=NEWS.idx;
  if(idx.loading||(!force&&idx.key===key&&Date.now()-idx.at<NEWS_REFRESH_MS))return;
  idx.loading=true;
  try{const r=await newsGet('/api/news/indices?country='+key);Object.assign(idx,{key,items:r.items||[],error:'',at:Date.now()});}
  catch(error){Object.assign(idx,{key,error:error.message||'Request failed',at:Date.now()});}
  finally{idx.loading=false;}
  if(view==='news')newsPaint();
}
function newsItemRow(i){
  return `<li class="news-item"><div class="news-meta"><span class="ws-tag purple">${NEWS_CAT_LABEL[i.cat]||'Indices'}</span><span class="news-source" data-user-content>${esc(i.source)}</span>${i.published_at?`<time translate="no" datetime="${esc(i.published_at)}" title="${esc(new Date(i.published_at).toLocaleString())}">${esc(newsAgo(i.published_at))}</time>`:''}</div><a class="news-title" href="${esc(i.link)}" target="_blank" rel="noopener noreferrer" data-user-content>${esc(i.title)}</a>${i.summary?`<p class="news-summary" data-user-content>${esc(i.summary)}</p>`:''}</li>`;
}

function newsHeadlines(){
  if(NEWS.error&&!NEWS.items)return `<div class="ws-card">${wsEmpty('News is unavailable',esc(NEWS.error),'news-refresh','Try again')}</div>`;
  if(!NEWS.items)return `<div class="ws-card news-loading" role="status">Loading headlines…</div>`;
  // Tabs: Breaking News (market-moving stories from every topic), then one tab per topic the trader follows.
  // Stock Markets also carries the index news for the Account country.
  const regions=newsRegions();if(NEWS.cat!=='breaking'&&!regions.includes(NEWS.cat))NEWS.cat='breaking';
  if(regions.includes('stocks'))newsLoadIndices();
  const indexItems=regions.includes('stocks')&&NEWS.idx.key===newsCountry()?(NEWS.idx.items||[]).map(i=>({...i,cat:'stocks'})):[];
  const seen=new Set(),pool=[...NEWS.items.filter(i=>regions.includes(i.cat)),...indexItems].filter(i=>{const k=i.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,70);if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>(b.published_at||'').localeCompare(a.published_at||''));
  const items=NEWS.cat==='breaking'?pool.filter(newsIsHigh):pool.filter(i=>i.cat===NEWS.cat);
  const choose=`<button type="button" class="news-choose" data-news-action="regions" title="Choose news topics in Settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>Choose topics</button>`;
  const tabs=`<div class="news-tabs news-topic-tabs" role="group" aria-label="News category">${[['breaking','Breaking news'],...NEWS_TOPICS.filter(([key])=>regions.includes(key))].map(([key,label])=>`<button type="button" class="news-tab${NEWS.cat===key?' on':''}" aria-pressed="${NEWS.cat===key}" data-news-cat="${key}">${label}</button>`).join('')}</div>`;
  const failed=NEWS.failed.length?`<p class="news-muted">Some sources did not respond: <span data-user-content>${esc(NEWS.failed.join(', '))}</span></p>`:'';
  const list=items.length?`<ul class="news-list">${items.map(newsItemRow).join('')}</ul>`:NEWS.cat==='breaking'?wsEmpty('No breaking news right now','Nothing market-moving in your topics yet. Check the other tabs or refresh in a few minutes.'):wsEmpty('No headlines here yet','Try another category or refresh in a few minutes.');
  return `<section class="ws-card news-feed" aria-label="Headlines"><div class="ws-card-head"><h2>Headlines</h2>${choose}</div>${tabs}${failed}${list}</section>`;
}

function newsCalendar(){
  const toggle=`<div class="news-tabs" role="group" aria-label="Event impact"><button type="button" class="news-tab${NEWS.impact==='high'?' on':''}" aria-pressed="${NEWS.impact==='high'}" data-news-impact="high">High</button><button type="button" class="news-tab${NEWS.impact==='medium'?' on':''}" aria-pressed="${NEWS.impact==='medium'}" data-news-impact="medium">High + medium</button></div>`;
  let body;
  const events=newsAllEvents();
  if(!NEWS.events&&!NEWS.calError&&!events.length)body=`<div class="news-loading" role="status">Loading calendar…</div>`;
  else{
    // Past days are collapsed behind "Show earlier"; the next upcoming event gets a "Next" marker.
    const now=Date.now(),today=newsDayKey(now),next=events.find(e=>Date.parse(e.at)>=now);
    const shown=NEWS.showEarlier?events:events.filter(e=>newsDayKey(e.at)>=today),hiddenDays=new Set(events.filter(e=>newsDayKey(e.at)<today).map(e=>newsDayKey(e.at))).size;
    const days=new Map();shown.forEach(e=>{const key=newsDayKey(e.at);if(!days.has(key))days.set(key,[]);days.get(key).push(e);});
    const earlier=hiddenDays?`<button type="button" class="news-earlier" data-news-action="earlier" aria-expanded="${!!NEWS.showEarlier}">${NEWS.showEarlier?'Hide earlier days':'Show earlier'}</button>`:'';
    body=(NEWS.calError?`<p class="news-muted">Live calendar unavailable: ${esc(NEWS.calError)}</p>`:'')+(events.length?earlier+`<div class="news-cal-list">`+(shown.length?[...days.values()].map(list=>`<div class="news-day"><h3 translate="no">${esc(newsDay(list[0].at))}</h3>${list.map(e=>`<div class="news-ev${Date.parse(e.at)<now?' past':''}${e===next?' next':''}">${e===next?'<span class="news-next">Next</span>':''}<span class="news-ev-time" translate="no">${esc(newsTime(e.at))}</span><span class="news-dot ${e.impact==='high'?'high':'medium'}" title="${e.impact==='high'?'High impact':'Medium impact'}"></span><div class="news-ev-main"><b data-user-content>${e.currency?`<span class="news-ccy">${esc(e.currency)}</span>`:''}${esc(e.title)}</b>${e.forecast||e.previous?`<span class="news-ev-nums"><span>Forecast</span> <b translate="no">${esc(e.forecast||'—')}</b> · <span>Previous</span> <b translate="no">${esc(e.previous||'—')}</b></span>`:''}</div>${e.mine?`<span class="ws-tag purple">Yours</span>`:''}</div>`).join('')}</div>`).join(''):`<p class="news-muted">No more events this week.</p>`)+`</div>`:NEWS.calError?'':wsEmpty('No events for this filter','Switch to High + medium to see more releases.'));
  }
  return `<aside class="ws-card news-cal" aria-label="Economic calendar"><div class="ws-card-head"><h2>This week</h2>${newsZoneShort()?`<span class="news-zone">Times in <span translate="no">${esc(newsZoneShort())}</span></span>`:''}${toggle}</div>${body}<p class="news-muted news-cal-note">Some local events, such as RBI policy, are not always listed; add them in your own market calendar.</p></aside>`;
}

function newsPaint(){
  const root=$('#ws-news');if(!root)return;
  const [,regionLabel,regionFlag]=newsCountryInfo(newsCountry());
  const regionNote=`<button type="button" class="news-region-note" data-news-action="account" title="Change your country in Account"><span class="news-flag" aria-hidden="true">${regionFlag}</span><span>${regionLabel}</span></button>`;
  const updated=NEWS.fetchedAt?`<span class="ws-date">Updated <span translate="no">${esc(new Date(NEWS.fetchedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}</span></span>`:'';
  const oldList=root.querySelector('.news-cal-list'),oldTop=oldList?oldList.scrollTop:0;
  root.innerHTML=wsHeader('BEFORE · CHECK NEWS AND EVENTS','News','Headlines for the topics and country you choose, plus this week\'s economic calendar. Read-only, from public sources.',`${regionNote}${updated}<button type="button" class="btn ghost" data-news-action="refresh" ${NEWS.loading?'disabled':''}>${NEWS.loading?'Refreshing…':'Refresh'}</button>`)+`<div class="news-grid">${newsHeadlines()}${newsCalendar()}</div>`;
  newsScrollToNext(root,oldList?oldTop:null);
}
// Scroll the calendar list (not the page) so the next event sits near the top.
// Repaints keep the reader's own scroll position unless the next event changed.
function newsScrollToNext(root,oldTop){const list=root.querySelector('.news-cal-list'),next=list?.querySelector('.news-ev.next');if(!list)return;
  const key=next?next.textContent:'';if(oldTop!==null&&key===NEWS.scrolledNext){list.scrollTop=oldTop;return;}NEWS.scrolledNext=key;
  if(!next||list.scrollHeight<=list.clientHeight)return;
  const day=next.closest('.news-day'),target=day&&day.firstElementChild&&day.querySelector('.news-ev')===next?day:next;
  list.scrollTop=Math.max(0,list.scrollTop+target.getBoundingClientRect().top-list.getBoundingClientRect().top-4);}

function newsTick(){
  if(view!=='news'){clearInterval(NEWS.tick);NEWS.tick=null;return;}
  if(document.visibilityState==='visible'&&Date.now()-NEWS.fetchedAt>=NEWS_REFRESH_MS){newsLoad(true);return;}
  $$('[data-news-countdown]').forEach(el=>{const left=Date.parse(el.dataset.newsCountdown)-Date.now();if(left<=0)newsPaint();else el.textContent=newsCountdown(left);});
  if(newsRegions().includes('stocks')&&document.visibilityState==='visible')newsLoadIndices();  // refreshes every 5 minutes
}

// Called once the journal has loaded: fetch news quietly so the News page opens instantly.
window.preloadNews=function(){
  const run=()=>newsLoad(false);
  if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:3000});else setTimeout(run,800);
};

window.renderNews=function(){
  newsPaint();newsLoad(false);
  if(!NEWS.tick)NEWS.tick=setInterval(newsTick,30000);
};

document.addEventListener('click',event=>{
  const root=$('#ws-news');
  if(!root||!root.contains(event.target))return;
  const cat=event.target.closest('[data-news-cat]'),impact=event.target.closest('[data-news-impact]');
  if(cat){NEWS.cat=cat.dataset.newsCat;newsPaint();return;}
  if(impact){NEWS.impact=impact.dataset.newsImpact;newsPaint();return;}
  if(event.target.closest('[data-news-action="earlier"]')){NEWS.showEarlier=!NEWS.showEarlier;newsPaint();return;}
  if(event.target.closest('[data-news-action="regions"]')){newsOpenRegionSettings();return;}
  if(event.target.closest('[data-news-action="account"]')){setView('settings');showSettingsTab('account');return;}
  if(event.target.closest('[data-news-action="refresh"],[data-ws-action="news-refresh"]')){event.stopPropagation();newsLoad(true);if(newsRegions().includes('stocks'))newsLoadIndices(true);}
});

// ---------- inside the pre-market routine popup (left column) ----------
window.newsLoad=newsLoad;
function newsUpcomingHigh(){
  const now=Date.now();
  return [...(NEWS.events||[]),...newsUserEvents()].filter(e=>e.impact==='high'&&Date.parse(e.at)>now-15*60000).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
window.newsRoutineView=function(){
  // High-impact events only; everything else is one click away on the full News page.
  // No countdown card: just today's high-impact events (the next one included), then headlines.
  const now=Date.now(),today=newsDayKey(now),later=newsUpcomingHigh().filter(e=>newsDayKey(e.at)===today);
  const loading=!NEWS.events&&!NEWS.calError;
  const list=later.length?`<div class="rn-sec"><span class="rn-label">High-impact events today</span><ul class="rn-events">${later.map(e=>{const url=newsEventUrl(e),inner=`<span class="news-dot high" aria-hidden="true"></span><span class="rn-when" translate="no">${esc(newsTime(e.at))}</span><span class="rn-ev" data-user-content>${e.currency?`<span class="news-ccy">${esc(e.currency)}</span>`:''}${esc(e.title)}</span>${e.mine?'<span class="ws-tag purple">Yours</span>':''}${url?'<span class="rn-out" aria-hidden="true">↗</span>':''}`;
    return `<li class="${Date.parse(e.at)<now?'past':''}">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Open the original calendar">${inner}</a>`:inner}</li>`;}).join('')}</ul></div>`:`<div class="rn-sec"><span class="rn-label">High-impact events today</span><p class="rn-sub">${loading?'Loading calendar…':NEWS.calError?esc(NEWS.calError):'No more high-impact events today.'}</p></div>`;
  // Only market-moving headlines from the last 24 hours in the reader's topics; each opens the original article.
  const regions=newsRegions(),dayAgo=Date.now()-86400000,heads=(NEWS.items||[]).filter(i=>regions.includes(i.cat)&&newsIsHigh(i)&&(!i.published_at||Date.parse(i.published_at)>=dayAgo)).slice(0,4);
  const headlines=heads.length?`<div class="rn-sec"><span class="rn-label">High-impact headlines</span><ul class="rn-heads">${heads.map(i=>`<li><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer"><span class="rn-head-title" data-user-content>${esc(i.title)}</span><span class="rn-sub"><span class="rn-cat">${esc(NEWS_CAT_LABEL[i.cat]||'')}</span> · <span data-user-content>${esc(i.source)}</span>${i.published_at?` · <span translate="no">${esc(newsAgo(i.published_at))}</span>`:''} <span aria-hidden="true">↗</span></span></a></li>`).join('')}</ul></div>`:'';
  return `<aside class="rp-art rn"><div class="rp-art-copy"><span class="rp-date">Pre-market routine</span><h2>Market news</h2><p>Know what is scheduled before you trade. Avoid fresh entries just before a high-impact release.</p></div>${list}${headlines}<div class="rm-actions rn-actions"><button type="button" class="btn" data-rn="done">Mark as done</button><button type="button" class="rn-link" data-rn="all">Open News page <span aria-hidden="true">→</span></button></div></aside>`;
};
window.newsRoutineWire=function(){
  const root=$('#routinePanel .rp-art.rn');if(!root)return;
  root.querySelectorAll('[data-rn]').forEach(b=>b.onclick=()=>{const a=b.dataset.rn;
    if(a==='done')rnDone();
    else{RN.active=false;$('#routineClose')?.click();setView('news');}});
  if(!NEWS.rnTick)NEWS.rnTick=setInterval(()=>{const el=$('#routinePanel .rp-art.rn');if(!el||$('#routinePanel').hidden){clearInterval(NEWS.rnTick);NEWS.rnTick=null;return;}
    el.querySelectorAll('[data-news-countdown]').forEach(c=>{const left=Date.parse(c.dataset.newsCountdown)-Date.now();if(left<=0)renderRoutinePanel();else c.textContent=newsCountdown(left);});},30000);
};

// ---------- Settings > Journal: news regions ----------
function newsOpenRegionSettings(){setView('settings');showSettingsTab('journal');setTimeout(()=>$('#wsNewsRegions')?.scrollIntoView({behavior:'smooth',block:'center'}),50);}
window.renderNewsSettings=function(){
  const host=$('#wsJournalPrefs');if(!host||typeof WS==='undefined'||!WS.prefs)return;
  const chosen=newsRegions();
  let section=$('#wsNewsRegions');
  if(!section){section=document.createElement('div');section.id='wsNewsRegions';const prefs=$('#wsPrefsForm');prefs&&prefs.nextSibling?host.insertBefore(section,prefs.nextSibling):host.append(section);}
  section.innerHTML=`<hr class="ws-divider"><div class="news-topics-head"><h3>News</h3><span class="ws-form-status" id="wsNewsRegionsStatus" role="status"></span></div><p class="plan-settings-help muted">Choose the topics you follow. The News page shows headlines from these topics only; the country in your Account picks local sources. The economic calendar always shows every high-impact event.</p><form id="wsNewsRegionsForm"><div class="news-topic-list">${NEWS_TOPICS.map(([key,label,desc])=>`<label class="news-topic"><span class="news-topic-text"><b>${label}</b><small>${desc}</small></span><input type="checkbox" role="switch" class="news-switch" name="region" value="${key}" ${chosen.includes(key)?'checked':''}></label>`).join('')}</div></form>`;
  const form=$('#wsNewsRegionsForm');
  form.onchange=async event=>{
    const picked=[...form.querySelectorAll('input[name=region]:checked')].map(i=>i.value);
    if(!picked.length){event.target.checked=true;$('#wsNewsRegionsStatus').textContent='Choose at least one news topic';return;}
    await wsSaveSettingsForm('preferences',{...WS.prefs.settings,newsRegions:picked},WS.prefs,'wsNewsRegionsStatus',form,result=>{WS.prefs=result;NEWS.cat='breaking';});
  };
  form.onsubmit=event=>event.preventDefault();
};

