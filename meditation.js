'use strict';
// Meditation ("Sanctuary"): scenic session card with interval bells + generated ambient audio, guided
// breathing templates (Mental Toolkit), weekly progress, and templates reused by the pre-market routine.

// ---------- templates ----------
// pattern: breathing phases [label, seconds, orbScale]; null = free meditation.
const MED_PATTERNS={
  box:[['Breathe in',4,1.05],['Hold',4,1.05],['Breathe out',4,.82],['Hold',4,.82]],
  sigh:[['Breathe in',2,.98],['Sip in',1,1.06],['Long breath out',6,.8]],
  b478:[['Breathe in',4,1.05],['Hold',7,1.05],['Breathe out',8,.8]],
  focus:[['Breathe in',4,1.05],['Hold',2,1.05],['Breathe out',6,.82]],
  calm:[['Breathe in',4,1.05],['Breathe out',6,.82]]};
const MED_TEMPLATES=[
  {id:'open-10',name:'Open meditation',cat:'session',minutes:10,pattern:null,ambient:'none',bells:1,scene:'city',desc:'A quiet timer with optional bells and ambient sound.'},
  {id:'reboot-60',name:'60 Second Reboot',cat:'reboot',minutes:1,pattern:'sigh',ambient:'none',bells:0,scene:'dawn',desc:'Two quick sips in, one long breath out. Fast reset between trades.'},
  {id:'box-breathing',name:'Box Breathing',cat:'reboot',minutes:5,pattern:'box',ambient:'ocean',bells:0,scene:'ocean',desc:'4 in, 4 hold, 4 out, 4 hold. Steadies the nervous system.'},
  {id:'reset-4',name:'Reset',cat:'reboot',minutes:4,pattern:'calm',ambient:'brown',bells:0,scene:'aurora',desc:'Slow exhales to drop your heart rate before the next decision.'},
  {id:'pretrade-focus',name:'Pre-Trade Focus',cat:'rewire',minutes:5,pattern:'focus',ambient:'bowl',bells:0,scene:'dawn',desc:'Center attention on your plan and invalidation before entering.'},
  {id:'visualize-plan',name:'Visualize the Plan',cat:'rewire',minutes:8,pattern:null,ambient:'forest',bells:2,scene:'forest',desc:'Rehearse your A+ setup and how you will manage it.'},
  {id:'breath-478',name:'4-7-8 Breathing',cat:'rewire',minutes:4,pattern:'b478',ambient:'none',bells:0,scene:'aurora',desc:'Long holds and exhales to calm anticipation.'},
  {id:'patience-10',name:'Patience Practice',cat:'rewire',minutes:10,pattern:null,ambient:'rain',bells:2,scene:'city',desc:'Sit with the urge to act. Let setups come to you.'},
  {id:'post-loss',name:'Post-Loss Reset',cat:'recovery',minutes:5,pattern:'calm',ambient:'ocean',bells:0,scene:'ocean',desc:'Release the last trade so it does not drive the next one.'},
  {id:'tilt-breaker',name:'Tilt Breaker',cat:'recovery',minutes:3,pattern:'box',ambient:'none',bells:0,scene:'city',desc:'Interrupt revenge-trading impulses with structured breathing.'},
  {id:'body-scan',name:'Body Scan',cat:'recovery',minutes:10,pattern:null,ambient:'brown',bells:2,scene:'forest',desc:'Notice and release tension from head to toe.'},
  {id:'wind-down',name:'Evening Wind-down',cat:'recovery',minutes:15,pattern:'calm',ambient:'rain',bells:5,scene:'aurora',desc:'Close the trading day and leave the screens behind.'}];
const MED_CATS=[['all','All'],['reboot','Reboot'],['rewire','Rewire'],['recovery','Recovery']];
const MED_AMBIENT=[['none','None'],['rain','Rain'],['ocean','Ocean waves'],['forest','Forest wind'],['brown','Brown noise'],['bowl','Singing bowl']];
const medTemplate=id=>MED_TEMPLATES.find(t=>t.id===id);

// ---------- audio (Web Audio; generated, no files) ----------
const MA={ctx:null,master:null,amb:[],timers:[],volume:.5};
function maCtx(){if(!MA.ctx){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;MA.ctx=new C();MA.master=MA.ctx.createGain();MA.master.gain.value=MA.volume;MA.master.connect(MA.ctx.destination);}if(MA.ctx.state==='suspended')MA.ctx.resume();return MA.ctx;}
function maNoise(kind){const ctx=MA.ctx,len=ctx.sampleRate*4,buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);let last=0,b=[0,0,0,0,0,0,0];
  for(let i=0;i<len;i++){const w=Math.random()*2-1;
    if(kind==='brown'){last=(last+.02*w)/1.02;d[i]=last*3.5;}
    else if(kind==='pink'){b[0]=.99886*b[0]+w*.0555179;b[1]=.99332*b[1]+w*.0750759;b[2]=.969*b[2]+w*.153852;b[3]=.8665*b[3]+w*.3104856;b[4]=.55*b[4]+w*.5329522;b[5]=-.7616*b[5]-w*.016898;d[i]=(b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+w*.5362)*.11;b[6]=w*.115926;}
    else d[i]=w;}
  const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;return src;}
function maLfo(target,rate,depth,base){const ctx=MA.ctx,o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=rate;g.gain.value=depth;o.connect(g).connect(target);target.value=base;o.start();MA.amb.push(o);}
function maAmbient(kind){maStopAmbient();if(kind==='none'||!maCtx())return;const ctx=MA.ctx,out=ctx.createGain();out.connect(MA.master);MA.amb.push(out);
  const chain=(src,...nodes)=>{let n=src;nodes.forEach(x=>{n.connect(x);n=x;});n.connect(out);src.start();MA.amb.push(src,...nodes);};
  const filt=(type,f,q=.7)=>{const x=ctx.createBiquadFilter();x.type=type;x.frequency.value=f;x.Q.value=q;return x;};
  if(kind==='rain'){out.gain.value=.22;chain(maNoise('white'),filt('highpass',900),filt('lowpass',7000));const g=ctx.createGain();g.gain.value=.12;chain(maNoise('pink'),filt('lowpass',500),g);}
  if(kind==='ocean'){const g=ctx.createGain();out.gain.value=.9;chain(maNoise('brown'),filt('lowpass',650),g);maLfo(g.gain,.075,.35,.45);}
  if(kind==='forest'){const f=filt('bandpass',450,.6),g=ctx.createGain();out.gain.value=.6;chain(maNoise('pink'),f,g);maLfo(f.frequency,.05,180,450);maLfo(g.gain,.11,.15,.35);
    const chirp=()=>{if(!MA.amb.length)return;const o=ctx.createOscillator(),e=ctx.createGain(),t=ctx.currentTime,f0=2200+Math.random()*1600;o.type='sine';o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f0*1.35,t+.09);o.frequency.exponentialRampToValueAtTime(f0*.9,t+.18);e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(.05,t+.02);e.gain.exponentialRampToValueAtTime(.0001,t+.22);o.connect(e).connect(out);o.start(t);o.stop(t+.25);MA.timers.push(setTimeout(chirp,2500+Math.random()*6000));};
    MA.timers.push(setTimeout(chirp,1500));}
  if(kind==='brown'){out.gain.value=.7;chain(maNoise('brown'),filt('lowpass',420));}
  if(kind==='bowl'){out.gain.value=.16;[[136.1,1],[204.2,.5],[272.2,.35],[408.3,.18]].forEach(([f,a])=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;g.gain.value=a;o.connect(g).connect(out);o.start();MA.amb.push(o,g);maLfo(g.gain,.13+Math.random()*.1,a*.35,a);});}}
function maStopAmbient(){MA.timers.forEach(clearTimeout);MA.timers=[];MA.amb.forEach(n=>{try{n.stop&&n.stop();}catch{}try{n.disconnect();}catch{}});MA.amb=[];}
function maBell(soft=false){if(!maCtx())return;const ctx=MA.ctx,t=ctx.currentTime,out=ctx.createGain();out.gain.value=soft?.25:.45;out.connect(MA.master);
  [[1,1],[2.76,.45],[5.4,.22],[8.93,.1]].forEach(([r,a])=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=528*r;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(a,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+4.5/r**.3);o.connect(g).connect(out);o.start(t);o.stop(t+5);});}
function maVolume(v){MA.volume=v;if(MA.master)MA.master.gain.value=v;}

// ---------- scenes (vector, no photos) ----------
const MED_SCENES=['city','dawn','ocean','forest','aurora'];
function medScene(name){const W=1200,H=700;let r=0;const rnd=()=>{r=(r*9301+49297)%233280;return r/233280;};
  const sky={city:['#0b1d2e','#2b5d73','#8fb3b8'],dawn:['#1e2a4a','#c76d5e','#f4c27a'],ocean:['#16324f','#3d7ea6','#a8d0db'],forest:['#10261d','#2e5a46','#8fb59a'],aurora:['#050b1a','#0f2a3d','#1d5b5a']}[name]||['#111','#333','#555'];
  let art='';
  if(name==='city'){r=7;let x=0;while(x<W){const w=40+rnd()*70,h=120+rnd()*360;art+=`<rect x="${x}" y="${H-h}" width="${w}" height="${h}" fill="#0a1622"/>`;for(let yy=H-h+14;yy<H-10;yy+=18)for(let xx=x+8;xx<x+w-8;xx+=14)if(rnd()<.32)art+=`<rect x="${xx}" y="${yy}" width="6" height="8" fill="#ffd27a" opacity="${.4+rnd()*.6}"/>`;x+=w+4;}
    art+=`<rect x="560" y="120" width="70" height="580" fill="#0a1622"/><polygon points="595,40 580,120 610,120" fill="#0a1622"/>`;}
  if(name==='dawn'){art=`<circle cx="830" cy="430" r="90" fill="#ffd89a" opacity=".9"/><polygon points="0,700 0,470 180,330 330,450 520,280 720,470 900,350 1200,520 1200,700" fill="#2c2440"/><polygon points="0,700 0,560 240,450 460,560 700,430 980,580 1200,500 1200,700" fill="#1a1530"/>`;}
  if(name==='ocean'){art=`<circle cx="300" cy="200" r="60" fill="#fff" opacity=".55"/>`;for(let i=0;i<7;i++){const y=420+i*42;art+=`<path d="M0 ${y} Q 150 ${y-18} 300 ${y} T 600 ${y} T 900 ${y} T 1200 ${y} V 700 H 0 Z" fill="#0e3a5c" opacity="${.25+i*.1}"/>`;}}
  if(name==='forest'){r=3;art=`<circle cx="900" cy="170" r="70" fill="#fff6d8" opacity=".6"/>`;for(let layer=0;layer<3;layer++){const base=470+layer*80,c=['#1d3d30','#14302a','#0b1f1a'][layer];for(let x=-40;x<W+40;x+=46+rnd()*30){const h=120+rnd()*120;art+=`<polygon points="${x},${base} ${x+30},${base-h} ${x+60},${base}" fill="${c}"/>`;}art+=`<rect x="0" y="${base}" width="${W}" height="${H-base}" fill="${c}"/>`;}}
  if(name==='aurora'){r=11;for(let i=0;i<120;i++)art+=`<circle cx="${rnd()*W}" cy="${rnd()*380}" r="${rnd()*1.6}" fill="#fff" opacity="${rnd()}"/>`;art+=`<path d="M-50 260 C 250 120, 480 330, 760 170 S 1150 220, 1260 120" stroke="#5cf2c2" stroke-width="70" fill="none" opacity=".28" filter="url(#mb)"/><path d="M-50 320 C 300 200, 520 380, 820 240 S 1150 300, 1260 200" stroke="#7c9cff" stroke-width="50" fill="none" opacity=".22" filter="url(#mb)"/><polygon points="0,700 0,560 260,470 520,560 820,450 1200,560 1200,700" fill="#03060d"/>`;}
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="sk-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".6" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient><filter id="mb"><feGaussianBlur stdDeviation="22"/></filter></defs><rect width="${W}" height="${H}" fill="url(#sk-${name})"/>${art}</svg>`;}

// ---------- session engine (shared by page and pre-market popup) ----------
const MS={template:null,minutes:10,bells:true,bellEvery:1,ambient:'none',running:false,remaining:600,deadline:0,timer:null,phase:0,phaseEnd:0,done:false,onTick:null,onDone:null,lastBell:0};
function msLoad(t){Object.assign(MS,{template:t,minutes:t.minutes,bells:t.bells>0,bellEvery:t.bells||1,ambient:t.ambient,remaining:t.minutes*60,running:false,done:false,phase:0});}
function msStart(){MS.running=true;MS.done=false;MS.deadline=Date.now()+MS.remaining*1000;MS.lastBell=MS.minutes*60-MS.remaining;MS.phase=0;MS.phaseEnd=Date.now()+msPattern()[0]?.[1]*1000||0;maCtx();maAmbient(MS.ambient);maBell(true);
  clearInterval(MS.timer);MS.timer=setInterval(msTick,200);msTick();}
function msPause(){MS.running=false;clearInterval(MS.timer);MS.remaining=Math.max(0,Math.ceil((MS.deadline-Date.now())/1000));maStopAmbient();MS.onTick&&MS.onTick();}
function msStop(){MS.running=false;clearInterval(MS.timer);maStopAmbient();MS.remaining=MS.minutes*60;MS.onTick&&MS.onTick();}
const msPattern=()=>MS.template&&MS.template.pattern?MED_PATTERNS[MS.template.pattern]:[];
function msCue(){const p=msPattern();if(!p.length)return{label:'Breathe naturally',scale:1,secs:4};if(Date.now()>=MS.phaseEnd){MS.phase=(MS.phase+1)%p.length;MS.phaseEnd=Date.now()+p[MS.phase][1]*1000;}const [label,secs,scale]=p[MS.phase];return{label,scale,secs};}
function msTick(){if(!MS.running)return;MS.remaining=Math.max(0,Math.ceil((MS.deadline-Date.now())/1000));const elapsed=MS.minutes*60-MS.remaining;
  if(MS.bells&&MS.bellEvery&&elapsed>0&&elapsed%(MS.bellEvery*60)===0&&elapsed!==MS.lastBell&&MS.remaining>0){MS.lastBell=elapsed;maBell();}
  MS.onTick&&MS.onTick();if(MS.remaining<=0)msFinish();}
async function msFinish(){clearInterval(MS.timer);MS.running=false;MS.done=true;maStopAmbient();maBell();
  try{await wsApi('items','POST',{kind:'session',title:MS.template?MS.template.name:`${MS.minutes}-minute meditation`,body:{duration:Math.max(1,Math.round(MS.minutes)),reflection:MS.template?MS.template.name:'Meditation',completed:true},clientId:crypto.randomUUID()});await wsReload('session');}catch{}
  toast('Meditation complete ✓');MS.onDone&&MS.onDone();}
const msFmt=sec=>`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;

// ---------- stats ----------
function medStats(){const items=WS.items.session.filter(i=>i.body.completed!==false),day=i=>new Date(i.created_at).toLocaleDateString('en-CA'),days=new Set(items.map(day));
  const now=new Date(),start=new Date(now);start.setDate(now.getDate()-now.getDay());start.setHours(0,0,0,0);
  const week=[...Array(7)].map((_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const k=d.toLocaleDateString('en-CA');return{k,label:d.toLocaleDateString(undefined,{weekday:'narrow'}),done:days.has(k),today:k===now.toLocaleDateString('en-CA')};});
  const weekMin=items.filter(i=>new Date(i.created_at)>=start).reduce((a,i)=>a+Number(i.body.duration||0),0);
  const sorted=[...days].sort();let longest=0,run=0,prev=null;sorted.forEach(k=>{const d=new Date(k+'T12:00:00');run=prev&&(d-prev)/864e5===1?run+1:1;longest=Math.max(longest,run);prev=d;});
  let current=0;const c=new Date();if(!days.has(c.toLocaleDateString('en-CA')))c.setDate(c.getDate()-1);while(days.has(c.toLocaleDateString('en-CA'))){current++;c.setDate(c.getDate()-1);}
  return{week,weekMin,current,longest,totalMin:items.reduce((a,i)=>a+Number(i.body.duration||0),0),total:items.length,items};}

// ---------- page ----------
const MP={scene:0,cat:'all',intent:null};
try{MP.scene=Math.max(0,MED_SCENES.indexOf(localStorage.getItem('tj_med_scene')));MS.ambient=localStorage.getItem('tj_med_ambient')||'none';maVolume(Number(localStorage.getItem('tj_med_vol')||.5));}catch{}
const medFavs=()=>{try{return JSON.parse(localStorage.getItem('tj_med_favs')||'[]');}catch{return [];}};
function renderSanctuary(){if(!MS.template)msLoad(MED_TEMPLATES[0]);const st=medStats(),favs=medFavs(),t=MS.template,list=MED_TEMPLATES.filter(x=>x.cat!=='session'&&(MP.cat==='all'||x.cat===MP.cat));
  $('#ws-focus').innerHTML=`<div class="med-head"><h1>Meditation</h1><p>Reset your mind before or after a session.</p></div>
  <div class="med-top"><section class="med-hero" aria-label="Meditation session"><div class="med-scene">${medScene(MED_SCENES[MP.scene])}</div>
    <button type="button" class="med-arrow l" data-med-scene="-1" aria-label="Previous scene">‹</button><button type="button" class="med-arrow r" data-med-scene="1" aria-label="Next scene">›</button>
    <div class="med-dots">${MED_SCENES.map((s,i)=>`<i class="${i===MP.scene?'on':''}"></i>`).join('')}</div>
    <div class="med-card" id="medCard">${medCard()}</div></section>
   <aside class="med-side"><div class="med-box"><span class="med-label">TODAY I WILL</span><input id="medIntent" placeholder="e.g. journal every trade" maxlength="140" value="${esc(MP.intent??'')}"></div>
    <div class="med-box"><span class="med-label">YOUR PROGRESS</span><button type="button" class="med-link" id="medSessions">View sessions</button>
     <div class="med-stat"><span>This Week Sessions</span><div class="med-week">${st.week.map(d=>`<span class="${d.done?'done':''} ${d.today?'today':''}" title="${d.k}"><i>${d.done?'✓':''}</i>${d.label}</span>`).join('')}</div></div>
     <div class="med-stat"><span>Minutes This Week</span><b>${st.weekMin} m</b></div><div class="med-stat"><span>Current Streak</span><b>${st.current} Day${st.current===1?'':'s'}</b></div>
     <div class="med-stat"><span>Longest Streak</span><b>${st.longest} Day${st.longest===1?'':'s'}</b></div><div class="med-stat"><span>Total Meditation Minutes</span><b>${st.totalMin} m</b></div><div class="med-stat"><span>Total Sessions</span><b>${st.total} Session${st.total===1?'':'s'}</b></div></div></aside></div>
  <section class="med-kit"><div class="med-kit-head"><h2>Mental Toolkit</h2><p>Guided exercises to reset, rewire and recover your trading mind.</p></div>
   <div class="med-tabs" role="tablist">${MED_CATS.map(([k,l])=>`<button type="button" role="tab" data-med-cat="${k}" aria-selected="${MP.cat===k}">${l} <small>${MED_TEMPLATES.filter(x=>x.cat!=='session'&&(k==='all'||x.cat===k)).length}</small></button>`).join('')}</div>
   <div class="med-grid">${MP.cat==='reboot'?'<div class="med-tip"><b>⚡ Quick Reset Tools</b><p>Use these before or after a trade to get back into flow fast.</p></div>':''}${list.map(x=>`<button type="button" class="med-tile ${t&&t.id===x.id?'on':''}" data-med-tpl="${x.id}"><span class="med-tile-scene">${medScene(x.scene)}</span><span class="med-chip">${MED_CATS.find(c=>c[0]===x.cat)[1]}</span><span class="med-fav ${favs.includes(x.id)?'on':''}" data-med-fav="${x.id}" role="button" aria-label="Favourite ${esc(x.name)}">★</span><b>${esc(x.name)}</b><small>${msFmt(x.minutes*60)}</small></button>`).join('')}</div></section>`;
  if(MP.intent===null)medLoadIntent();
  medWire();}
function medCard(){const t=MS.template,p=msPattern(),total=MS.minutes*60;
  if(MS.running||(!MS.done&&MS.remaining<total)){const cue=MS.running?msCue():{label:'Paused',scale:1,secs:.3};
    return `<div class="med-run"><span class="med-run-name">${esc(t?t.name:'Meditation')}</span><div class="med-orb" id="medOrb" style="transform:scale(${cue.scale});transition-duration:${cue.secs}s"><span id="medCue">${cue.label}</span></div><div class="med-time" id="medTime">${msFmt(MS.remaining)}</div>
     <div class="med-actions">${MS.running?'<button type="button" class="btn" data-med="pause">Pause</button>':'<button type="button" class="btn" data-med="resume">Resume</button>'}<button type="button" class="btn ghost" data-med="end">End</button></div></div>`;}
  if(MS.done)return `<div class="med-run"><div class="med-orb done"><span>✓</span></div><h3>Session complete</h3><p class="med-sub">Carry this calm into your next trade.</p><div class="med-actions"><button type="button" class="btn" data-med="again">Start another</button></div></div>`;
  return `<div class="med-lotus" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4c-2.2 2.6-2.2 5.4 0 8 2.2-2.6 2.2-5.4 0-8zM4 11c1.8 3.8 4.6 5.6 8 5.6s6.2-1.8 8-5.6M8 20h8"/></svg></div>
   <h3>${esc(t&&t.cat!=='session'?t.name:'Meditation Session')}</h3>${t&&t.cat!=='session'?`<p class="med-sub">${esc(t.desc)}</p>`:''}
   <label class="med-l">Duration:</label><div class="med-dur"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 3h6"/></svg>${msFmt(MS.minutes*60)}</div>
   <div class="med-chips">${[5,10,15,30,60].map(m=>`<button type="button" data-med-min="${m}" aria-pressed="${MS.minutes===m}">${m===60?'1 hour':m+' min'}</button>`).join('')}</div>
   ${p.length?`<p class="med-pattern">Breathing: ${p.map(x=>`${x[0].toLowerCase()} ${x[1]}s`).join(' · ')}</p>`:''}
   <div class="med-row"><label class="med-l" for="medBells">Interval Bells:</label><button type="button" class="med-switch" id="medBells" role="switch" aria-checked="${MS.bells}"><i></i></button></div>
   <select class="med-sel" id="medBellEvery" ${MS.bells?'':'disabled'}>${[1,2,5,10].map(m=>`<option value="${m}" ${MS.bellEvery===m?'selected':''}>Every ${m} Minute${m===1?'':'s'}</option>`).join('')}</select>
   <label class="med-l" for="medAmbient">Ambient Sound:</label><select class="med-sel" id="medAmbient">${MED_AMBIENT.map(([k,l])=>`<option value="${k}" ${MS.ambient===k?'selected':''}>${l}</option>`).join('')}</select>
   <div class="med-vol"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/></svg><input type="range" id="medVol" min="0" max="1" step=".05" value="${MA.volume}" aria-label="Volume"><button type="button" class="med-link" id="medPreview">Preview</button></div>
   <button type="button" class="btn med-start" data-med="start">Start</button>`;}
function medPaintRun(){const time=$('#medTime'),orb=$('#medOrb'),cue=$('#medCue');if(!time){return;}time.textContent=msFmt(MS.remaining);if(MS.running&&orb){const c=msCue();if(cue.textContent!==c.label){cue.textContent=c.label;orb.style.transitionDuration=c.secs+'s';orb.style.transform=`scale(${c.scale})`;}}}
function medWire(){const root=$('#ws-focus');
  root.querySelectorAll('[data-med-scene]').forEach(b=>b.onclick=()=>{MP.scene=(MP.scene+Number(b.dataset.medScene)+MED_SCENES.length)%MED_SCENES.length;try{localStorage.setItem('tj_med_scene',MED_SCENES[MP.scene]);}catch{}$('#ws-focus .med-scene').innerHTML=medScene(MED_SCENES[MP.scene]);root.querySelectorAll('.med-dots i').forEach((d,i)=>d.classList.toggle('on',i===MP.scene));});
  root.querySelectorAll('[data-med-cat]').forEach(b=>b.onclick=()=>{MP.cat=b.dataset.medCat;renderSanctuary();});
  root.querySelectorAll('[data-med-tpl]').forEach(b=>b.onclick=e=>{const id=b.dataset.medTpl;if(e.target.closest('[data-med-fav]')){const f=medFavs(),i=f.indexOf(id);i<0?f.push(id):f.splice(i,1);try{localStorage.setItem('tj_med_favs',JSON.stringify(f));}catch{}renderSanctuary();return;}
    if(MS.running&&!confirm('End the current session and load this exercise?'))return;msStop();msLoad(medTemplate(id));MP.scene=Math.max(0,MED_SCENES.indexOf(MS.template.scene));renderSanctuary();$('#medCard')?.scrollIntoView({behavior:'smooth',block:'center'});});
  root.querySelectorAll('[data-med-min]').forEach(b=>b.onclick=()=>{MS.minutes=+b.dataset.medMin;MS.remaining=MS.minutes*60;$('#medCard').innerHTML=medCard();medWire();});
  $('#medBells')?.addEventListener('click',()=>{MS.bells=!MS.bells;$('#medCard').innerHTML=medCard();medWire();});
  $('#medBellEvery')?.addEventListener('change',e=>MS.bellEvery=+e.target.value);
  $('#medAmbient')?.addEventListener('change',e=>{MS.ambient=e.target.value;try{localStorage.setItem('tj_med_ambient',MS.ambient);}catch{}if(MA.amb.length)maAmbient(MS.ambient);});
  $('#medVol')?.addEventListener('input',e=>{maVolume(+e.target.value);try{localStorage.setItem('tj_med_vol',e.target.value);}catch{}});
  $('#medPreview')?.addEventListener('click',e=>{if(MA.amb.length&&!MS.running){maStopAmbient();e.target.textContent='Preview';return;}maCtx();if(MS.ambient==='none')maBell(true);else{maAmbient(MS.ambient);e.target.textContent='Stop preview';}});
  root.querySelectorAll('[data-med]').forEach(b=>b.onclick=()=>{const a=b.dataset.med;if(a==='start'){MS.remaining=MS.minutes*60;msStart();medFsOpen();return;}if(a==='pause')msPause();if(a==='resume')msStart();if(a==='end')msStop();if(a==='again'){MS.done=false;MS.remaining=MS.minutes*60;}$('#medCard').innerHTML=medCard();medWire();});
  $('#medSessions')?.addEventListener('click',medSessionsDialog);
  const intent=$('#medIntent');if(intent){intent.onchange=()=>medSaveIntent(intent.value.trim());intent.onkeydown=e=>{if(e.key==='Enter')intent.blur();};}
  MS.onTick=()=>{medFsPaint();if(view==='focus')medPaintRun();};MS.onDone=()=>{medFsPaint();if(view==='focus')renderSanctuary();};}
function medSessionsDialog(){const st=medStats();wsShowDialog('Meditation sessions',`${st.total} sessions · ${st.totalMin} minutes`,st.items.length?`<div class="med-hist">${st.items.slice(0,60).map(i=>`<div><b>${esc(i.title)}</b><span>${wsNum(Number(i.body.duration),0)} min · ${esc(new Date(i.created_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}))}</span></div>`).join('')}</div>`:wsEmpty('No sessions yet','Completed meditations will appear here.'));}
// "Today I will" lives in today's day log (reinforcement = one action for the day).
async function medLoadIntent(){try{const d=await (await fetch('/api/daylog?date='+wsLocalDate())).json();MP.intent=d.log?.reinforcement||'';const i=$('#medIntent');if(i&&document.activeElement!==i)i.value=MP.intent;}catch{MP.intent='';}}
async function medSaveIntent(v){MP.intent=v;try{const fresh=(await (await fetch('/api/daylog?date='+wsLocalDate())).json()).log||{};await fetch('/api/daylog',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fresh,reinforcement:v,date:wsLocalDate()})});toast('Intention saved');}catch{toast('Could not save');}}

// ---------- full-screen session (opens on Start) ----------
let medMuted=false,medPrevVol=.5;
const MED_ICON={restart:'<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',pause:'<path d="M9 6v12M15 6v12"/>',play:'<path d="M8 5l11 7-11 7z"/>',vol:'<path d="M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6"/>',mute:'<path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6"/>',close:'<path d="M6 6l12 12M18 6 6 18"/>'};
const medIcon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${MED_ICON[k]}</svg>`;
function medFsOpen(){medFsClose(true);const t=MS.template,el=document.createElement('div');el.id='medFs';el.className='med-fs';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label',(t?t.name:'Meditation')+' session');
  el.innerHTML=`<div class="med-fs-scene">${medScene(MED_SCENES[MP.scene])}</div><div class="med-fs-card"><button type="button" class="med-fs-x" data-fs="close" aria-label="End session">${medIcon('close')}</button>
   <div class="med-fs-ring"><svg viewBox="0 0 220 220" aria-hidden="true"><circle class="med-fs-track" cx="110" cy="110" r="100"/><circle class="med-fs-prog" id="medFsProg" cx="110" cy="110" r="100"/></svg><div class="med-fs-center"><span class="med-fs-time" id="medFsTime">${msFmt(MS.remaining)}</span><span class="med-fs-cue" id="medFsCue"></span></div></div>
   <div class="med-fs-name">${esc(t?t.name:'Meditation')}</div>
   <div class="med-fs-ctrl"><button type="button" data-fs="restart" aria-label="Restart">${medIcon('restart')}</button><button type="button" data-fs="toggle" id="medFsToggle" aria-label="Pause">${medIcon('pause')}</button><button type="button" data-fs="mute" id="medFsMute" aria-label="Mute">${medIcon(medMuted?'mute':'vol')}</button></div></div>`;
  document.body.appendChild(el);
  el.querySelectorAll('[data-fs]').forEach(b=>b.onclick=()=>{const a=b.dataset.fs;
    if(a==='close'){if(MS.running||MS.remaining<MS.minutes*60&&!MS.done)msStop();medFsClose();if(view==='focus')renderSanctuary();return;}
    if(a==='restart'){msStop();MS.remaining=MS.minutes*60;msStart();}
    if(a==='toggle'){if(MS.done){medFsClose();return;}MS.running?msPause():msStart();}
    if(a==='mute'){medMuted=!medMuted;if(medMuted){medPrevVol=MA.volume||.5;if(MA.master)MA.master.gain.value=0;}else if(MA.master)MA.master.gain.value=medPrevVol;}
    medFsPaint();});
  el.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.fullscreenElement){e.preventDefault();el.querySelector('[data-fs="close"]').click();}});
  try{el.requestFullscreen&&el.requestFullscreen().catch(()=>{});}catch{}
  el.querySelector('[data-fs="toggle"]').focus();medFsPaint();}
function medFsClose(silent){const el=$('#medFs');if(!el)return;if(document.fullscreenElement===el)document.exitFullscreen().catch(()=>{});el.remove();if(!silent&&medMuted){medMuted=false;if(MA.master)MA.master.gain.value=medPrevVol;}}
function medFsPaint(){const el=$('#medFs');if(!el)return;const total=MS.minutes*60,C=2*Math.PI*100,frac=total?MS.remaining/total:0;
  $('#medFsTime').textContent=MS.done?'Done':msFmt(MS.remaining);
  const prog=$('#medFsProg');prog.style.strokeDasharray=C;prog.style.strokeDashoffset=C*(1-frac);
  $('#medFsCue').textContent=MS.done?'Session complete':MS.running?msCue().label:'Paused';
  const tg=$('#medFsToggle');tg.innerHTML=medIcon(MS.done?'close':MS.running?'pause':'play');tg.setAttribute('aria-label',MS.done?'Close':MS.running?'Pause':'Play');
  $('#medFsMute').innerHTML=medIcon(medMuted?'mute':'vol');el.classList.toggle('done',MS.done);el.classList.toggle('paused',!MS.running&&!MS.done);}

// ---------- wiring ----------
const medBaseRender=window.renderWorkspaceView;
window.renderWorkspaceView=function(key){if(key==='focus')renderSanctuary();else medBaseRender(key);};
const medBaseSetView=setView;setView=function(v){if(view==='focus'&&v!=='focus'&&MA.amb.length&&!MS.running)maStopAmbient();medBaseSetView(v);};
