'use strict';
// One optional profile question per card. Radio values remain canonical for saving.
window.maybeOnboarding = function () {
  if (!window.tdNewAccount || typeof PF.data.settings.onboardingCompleted !== 'boolean' || PF.data.settings.onboardingCompleted || document.querySelector('#welcomeDialog')) return;
  const previousFocus=document.activeElement,initial={...PF.data.settings};
  const dialog=document.createElement('dialog');dialog.id='welcomeDialog';dialog.className='welcome-dialog';dialog.setAttribute('aria-labelledby','welcomeTitle');
  const mark=(kind)=>{
    const paths={seed:'<path d="M12 21v-9M12 15C4 15 4 7 4 7s8 0 8 8ZM12 11c0-7 8-7 8-7s0 7-8 7Z"/>',chart:'<path d="M4 20h16M6 15l4-5 4 3 5-8M15 5h4v4"/>',spark:'<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/>',peak:'<path d="m3 20 7-14 4 7 3-4 5 11ZM7 12l3 2 3-2M10 6V2h6l-2 2 2 2h-6"/>',person:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',people:'<circle cx="9" cy="8" r="3.5"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M19 21v-3a6 6 0 0 0-2-4"/>',orbit:'<circle cx="12" cy="12" r="4"/><ellipse cx="12" cy="12" rx="10" ry="6" transform="rotate(-35 12 12)"/>',dash:'<path d="M6 12h12"/>'};
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[kind]||paths.spark}</svg>`;
  };
  const face=(kind)=>{
    const illustrations={
      country:`<circle cx="106" cy="87" r="62" fill="white"/><circle cx="106" cy="87" r="62" fill="currentColor" opacity=".12"/><g stroke="currentColor" stroke-width="2.5" opacity=".7"><circle cx="106" cy="87" r="62"/><ellipse cx="106" cy="87" rx="28" ry="62"/><path d="M44 87h124M53 56h106M53 118h106"/></g><path d="M144 25c-16 0-28 12-28 27 0 20 28 45 28 45s28-25 28-45c0-15-12-27-28-27Z" fill="#6279cf"/><circle cx="144" cy="52" r="10" fill="white"/><path d="m61 145 21 8 16-5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
      language:`<path d="M35 31h107a15 15 0 0 1 15 15v55a15 15 0 0 1-15 15H79l-28 22v-22H35a15 15 0 0 1-15-15V46a15 15 0 0 1 15-15Z" fill="white"/><path d="M100 78h82a14 14 0 0 1 14 14v42a14 14 0 0 1-14 14h-7v18l-25-18h-50a14 14 0 0 1-14-14V92a14 14 0 0 1 14-14Z" fill="#9b8ad6"/><g stroke="#8170be" stroke-width="4" stroke-linecap="round"><path d="m43 89 15-36 15 36M49 77h18M88 58h40M108 49v9M95 61q2 18 30 29M123 61q-4 18-30 29"/></g><g fill="white"><circle cx="115" cy="114" r="4"/><circle cx="140" cy="114" r="4"/><circle cx="165" cy="114" r="4"/></g>`,
      tradingLevel:`<rect x="32" y="28" width="161" height="127" rx="20" fill="white"/><path d="M52 132h119M52 105h119M52 78h119" stroke="currentColor" opacity=".16" stroke-width="2"/><rect x="57" y="106" width="22" height="26" rx="6" fill="currentColor" opacity=".25"/><rect x="95" y="84" width="22" height="48" rx="6" fill="currentColor" opacity=".45"/><rect x="133" y="58" width="22" height="74" rx="6" fill="currentColor" opacity=".7"/><path d="m53 89 43-30 26 10 39-38m-20 0h20v20" stroke="#a86f49" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="42" cy="145" r="19" fill="#f1ce8e"/><path d="m34 145 6 6 10-12" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
      ageGroup:`<rect x="40" y="31" width="143" height="127" rx="19" fill="white"/><path d="M40 50q0-19 19-19h105q19 0 19 19v19H40Z" fill="#8ca3cf"/><path d="M74 21v25M149 21v25" stroke="#526b9b" stroke-width="7" stroke-linecap="round"/><g fill="currentColor" opacity=".3"><rect x="62" y="86" width="19" height="17" rx="5"/><rect x="101" y="86" width="19" height="17" rx="5"/><rect x="140" y="86" width="19" height="17" rx="5"/><rect x="62" y="120" width="19" height="17" rx="5"/><rect x="101" y="120" width="19" height="17" rx="5"/></g><circle cx="164" cy="137" r="28" fill="#657faf"/><path d="M164 120v17l11 7" stroke="white" stroke-width="3" stroke-linecap="round"/>`,
      gender:`<circle cx="111" cy="89" r="70" fill="white" opacity=".5"/><circle cx="62" cy="76" r="21" fill="#cab4d2"/><path d="M24 145v-13a38 38 0 0 1 76 0v13Z" fill="#cab4d2"/><circle cx="158" cy="76" r="21" fill="#d7bad2"/><path d="M120 145v-13a38 38 0 0 1 76 0v13Z" fill="#d7bad2"/><circle cx="110" cy="63" r="25" fill="#9f7fac"/><path d="M67 153v-20a43 43 0 0 1 86 0v20Z" fill="#9f7fac"/><path d="M102 69q8 8 16 0" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="m175 28 4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1Z" fill="currentColor" opacity=".5"/>`
    };
    return `<svg class="welcome-mascot" data-illustration="${kind}" viewBox="0 0 220 180" fill="none" aria-hidden="true"><ellipse cx="110" cy="167" rx="73" ry="7" fill="currentColor" opacity=".08"/>${illustrations[kind]}<path d="M18 61h10M23 56v10M193 70h8M197 66v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/></svg>`;
  };
  const radio=(name,value,title,subtitle='',icon='')=>`<label class="welcome-choice ${name==='language'?'welcome-language-choice':''}"><input type="radio" name="${name}" value="${esc(value)}" ${value&&(value===(name==='language'?(initial.language||TDLocale.language):initial[name]))?'checked':''}><span class="welcome-choice-inner">${icon?`<span class="welcome-choice-icon">${mark(icon)}</span>`:''}<span class="welcome-choice-copy" ${name==='language'?'translate="no"':''}><strong>${esc(title)}</strong>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span><span class="welcome-choice-check" aria-hidden="true">✓</span></span></label>`;
  const steps=[
    {key:'country',title:'Where are you based?',copy:'Choose your country.',content:`<input type="hidden" name="country" value="${esc(initial.country||'')}"><label class="welcome-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="welcomeCountrySearch" type="search" placeholder="Find your country" aria-label="Find your country" autocomplete="off"></label><fieldset class="welcome-country-list" id="welcomeCountries"><legend class="sr-only">Country</legend></fieldset><p id="welcomeNoCountries" class="welcome-no-results" hidden>No countries found.</p>`},
    {key:'language',title:'Feel at home.',copy:'Choose the language for your journal.',content:`<fieldset class="welcome-choices welcome-languages"><legend class="sr-only">Preferred language</legend>${TDLocale.languages.map(([code,name])=>radio('language',code,name)).join('')}</fieldset>`},
    {key:'tradingLevel',title:'Your trading journey?',copy:'Every trader starts somewhere.',content:`<fieldset class="welcome-choices"><legend class="sr-only">Trading experience</legend>${radio('tradingLevel','beginner','Beginner','Learning the basics','seed')}${radio('tradingLevel','intermediate','Intermediate','Finding my rhythm','chart')}${radio('tradingLevel','experienced','Experienced','Building consistency','spark')}${radio('tradingLevel','professional','Professional','Trading is my craft','peak')}</fieldset>`},
    {key:'ageGroup',title:'What’s your age group?',copy:'A little more about you. Only if you’d like.',content:`<fieldset class="welcome-choices welcome-age-choices"><legend class="sr-only">Age group</legend>${[['under18','Under 18'],['18-24','18–24'],['25-34','25–34'],['35-44','35–44'],['45-54','45–54'],['55-64','55–64'],['65+','65+'],['','Prefer not to say']].map(([value,title])=>radio('ageGroup',value,title)).join('')}</fieldset>`},
    {key:'gender',title:'How do you identify?',copy:'Share what feels right for you.',content:`<fieldset class="welcome-choices"><legend class="sr-only">Gender</legend>${radio('gender','man','Man','','person')}${radio('gender','woman','Woman','','person')}${radio('gender','non-binary','Non-binary','','orbit')}${radio('gender','prefer-not-to-say','Prefer not to say','','dash')}</fieldset>`}
  ];
  dialog.innerHTML=`<form id="welcomeForm"><div class="sr-only welcome-progress" role="progressbar" aria-label="Profile setup progress" aria-valuemin="1" aria-valuemax="5" aria-valuenow="1"><span id="welcomeStepCount" aria-live="polite">1 / 5</span></div>
    <div class="welcome-scroll"><div class="welcome-carousel" aria-roledescription="carousel"><div class="welcome-rail">${steps.map((item,i)=>`<div class="welcome-slide"><section class="welcome-question" data-welcome-step="${i}" data-question="${item.key}" aria-labelledby="${i?'welcomeQuestion'+i:'welcomeTitle'}"><div class="welcome-art">${face(item.key)}</div><div class="welcome-question-content"><h2 id="${i?'welcomeQuestion'+i:'welcomeTitle'}" class="welcome-question-title" tabindex="-1">${item.title}</h2><p class="welcome-question-copy">${item.copy}</p>${item.content}</div></section><button class="welcome-peek" type="button" data-welcome-peek="${i}" tabindex="-1" aria-hidden="true"></button></div>`).join('')}</div><button type="button" class="welcome-carousel-arrow welcome-carousel-prev" id="welcomeBack" aria-label="Previous"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg></button><button type="button" class="welcome-carousel-arrow welcome-carousel-next" id="welcomeAdvance" aria-label="Next"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div><p id="welcomeStatus" class="ws-form-status" role="status" aria-live="polite"></p></div>
    <footer class="welcome-footer"><div class="welcome-footer-note"><button type="button" class="welcome-skip" data-welcome-skip>Skip for now</button><span>Optional · edit anytime in Settings</span></div><div class="welcome-footer-actions"><button type="button" class="btn" id="welcomeNext"><span>Continue</span><span aria-hidden="true">→</span></button><button type="submit" class="btn" id="welcomeFinish" hidden>Finish setup</button></div></footer></form>`;
  // The first title also labels the dialog; all later steps retain its accessible name.
  dialog.querySelector('[data-welcome-step="0"]').setAttribute('aria-labelledby','welcomeTitle');
  document.body.append(dialog);
  let step=0,busy=false;
  const form=dialog.querySelector('form');
  function renderCountries(){
    const search=dialog.querySelector('#welcomeCountrySearch').value;
    const normalize=value=>value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase(TDLocale.language);
    const query=normalize(search.trim()),selected=form.elements.country.value;
    const countries=pfCountries();
    let englishNames;try{englishNames=new Intl.DisplayNames(["en"],{type:"region"});}catch{}
    const suggested=[selected,'IN','US','GB','AE','CA','AU','SG','DE'].filter(Boolean);
    const matches=query?countries.filter(([code,name])=>normalize(name).includes(query)||normalize(englishNames?.of(code)||'').includes(query)||code.toLowerCase()===query):[...new Set(suggested)].map(code=>countries.find(row=>row[0]===code)).filter(Boolean);
    const list=dialog.querySelector('#welcomeCountries');
    list.innerHTML='<legend class="sr-only">Country</legend>'+matches.map(([code,name])=>`<label class="welcome-country-choice"><input type="radio" name="countryChoice" value="${code}" ${selected===code?'checked':''}><span><i aria-hidden="true">${String.fromCodePoint(...[...code].map(letter=>127397+letter.charCodeAt(0)))}</i><strong>${esc(name)}</strong><b aria-hidden="true">✓</b></span></label>`).join('');
    dialog.querySelector('#welcomeNoCountries').hidden=matches.length>0;
    TDLocale.apply(list);
  }
  function showStep(next){
    if(busy)return;
    step=Math.max(0,Math.min(steps.length-1,next));
    dialog.dataset.question=steps[step].key;
    dialog.dataset.edge=step===0?'start':step===steps.length-1?'end':'middle';
    dialog.querySelector('.welcome-rail').style.setProperty('--welcome-index',String(step));
    dialog.querySelectorAll('[data-welcome-step]').forEach(card=>{
      const active=Number(card.dataset.welcomeStep)===step;
      card.dataset.active=String(active);card.inert=!active;card.setAttribute('aria-hidden',String(!active));card.scrollTop=0;
      card.parentElement.classList.toggle('is-active',active);
      card.parentElement.querySelector('.welcome-peek').hidden=active;
    });
    dialog.querySelector('.welcome-progress').setAttribute('aria-valuenow',String(step+1));
    dialog.querySelector('#welcomeStepCount').textContent=(step+1)+' / '+steps.length;
    dialog.querySelector('#welcomeBack').disabled=step===0;
    dialog.querySelector('#welcomeAdvance').disabled=step===steps.length-1;
    dialog.querySelector('#welcomeNext').hidden=step===steps.length-1;
    dialog.querySelector('#welcomeFinish').hidden=step!==steps.length-1;
    const heading=dialog.querySelector(step?'#welcomeQuestion'+step:'#welcomeTitle');
    dialog.setAttribute('aria-labelledby',heading.id);heading.focus({preventScroll:true});
    dialog.querySelector('.welcome-scroll').scrollTop=0;
    if(step===0)renderCountries();
  }
  async function finish(){
    if(busy)return;busy=true;
    const values=Object.fromEntries(new FormData(form));delete values.countryChoice;
    const settings={...initial,...values,language:values.language||TDLocale.language,gender:values.gender??initial.gender??'',ageGroup:values.ageGroup??initial.ageGroup??'',tradingLevel:values.tradingLevel??initial.tradingLevel??'',onboardingCompleted:true,onboardingVersion:1};
    if(!settings.displayName&&window.tdSignupName)settings.displayName=String(window.tdSignupName).slice(0,60);
    if(!settings.timezone)settings.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    dialog.querySelectorAll('button,input,select').forEach(control=>control.disabled=true);
    dialog.querySelector('#welcomeStatus').textContent='Saving…';
    try{PF.data=await wsApi('profile','PUT',{settings,revision:PF.data.revision});window.tdNewAccount=false;pfPaintAvatar();await TDLocale.setLanguage(PF.data.settings.language||TDLocale.language);dialog.close();}
    catch(error){dialog.querySelector('#welcomeStatus').textContent=error.message||'Could not save your profile. Please try again.';dialog.querySelectorAll('button,input,select').forEach(control=>control.disabled=false);busy=false;dialog.querySelector('#welcomeBack').disabled=step===0;dialog.querySelector('#welcomeAdvance').disabled=step===steps.length-1;}
  }
  form.addEventListener('change',async event=>{
    if(event.target.name==='countryChoice')form.elements.country.value=event.target.value;
    if(event.target.name==='language'){
      const previous=TDLocale.language;
      if(!await TDLocale.setLanguage(event.target.value)){const old=form.querySelector(`input[name="language"][value="${previous}"]`);if(old)old.checked=true;dialog.querySelector('#welcomeStatus').textContent='Language could not load. Please try again.';}
    }
  });
  dialog.querySelector('#welcomeCountrySearch').oninput=renderCountries;
  dialog.querySelector('#welcomeNext').onclick=()=>showStep(step+1);
  dialog.querySelector('#welcomeBack').onclick=()=>showStep(step-1);
  dialog.querySelector('#welcomeAdvance').onclick=()=>showStep(step+1);
  dialog.querySelectorAll('[data-welcome-peek]').forEach(button=>button.onclick=()=>showStep(Number(button.dataset.welcomePeek)));
  dialog.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.target.closest('input,select,textarea'))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
      event.preventDefault();const direction=document.documentElement.dir==='rtl'?-1:1;
      showStep(step+(event.key==='ArrowRight'?direction:-direction));
    }
  });
  let swipe=null;
  const carousel=dialog.querySelector('.welcome-carousel');
  carousel.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch'||event.target.closest('input,button,label'))return;
    swipe={x:event.clientX,y:event.clientY};
  },{passive:true});
  carousel.addEventListener('pointerup',event=>{
    if(!swipe)return;const x=event.clientX-swipe.x,y=event.clientY-swipe.y;swipe=null;
    if(Math.abs(x)>40&&Math.abs(x)>Math.abs(y)*1.4){const direction=document.documentElement.dir==='rtl'?-1:1;showStep(step+(x<0?direction:-direction));}
  },{passive:true});
  carousel.addEventListener('pointercancel',()=>{swipe=null;},{passive:true});
  dialog.querySelectorAll('[data-welcome-skip]').forEach(button=>button.onclick=finish);
  form.onsubmit=event=>{event.preventDefault();if(step<steps.length-1)showStep(step+1);else finish();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
  dialog.addEventListener('close',()=>{dialog.remove();previousFocus?.focus();},{once:true});
  dialog.showModal();showStep(0);TDLocale.apply(dialog);
};
