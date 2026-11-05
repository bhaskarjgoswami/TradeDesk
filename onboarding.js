'use strict';
// A brief, optional welcome flow. Values use the existing per-account profile.
window.maybeOnboarding = function () {
  if (!window.tdNewAccount || PF.data.settings.onboardingCompleted || document.querySelector('#welcomeDialog')) return;
  const previousFocus = document.activeElement, initial = {...PF.data.settings};
  const dialog = document.createElement('dialog');
  dialog.id = 'welcomeDialog'; dialog.className = 'welcome-dialog';
  dialog.setAttribute('aria-labelledby','welcomeTitle');
  const options = (items,current) => '<option value="">'+esc('Prefer not to say')+'</option>'+items.map(([value,label])=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`).join('');
  const countries = '<option value="">Select country</option>'+pfCountries().map(([value,label])=>`<option value="${value}" ${value===initial.country?'selected':''}>${esc(label)}</option>`).join('');
  dialog.innerHTML = `<form id="welcomeForm"><header class="welcome-head"><div><p class="welcome-eyebrow">TradeDesk</p><h2 id="welcomeTitle">Welcome to TradeDesk</h2><p>A few details to make your journal feel like yours.</p></div><button type="button" class="welcome-close" aria-label="Close" data-welcome-skip>×</button></header>
    <div class="welcome-progress" aria-hidden="true"><span class="on"></span><span></span></div>
    <div class="welcome-scroll">
      <section class="welcome-card" data-welcome-step="0" aria-labelledby="welcomePreferences"><p class="welcome-step-count">1 / 2</p><h3 id="welcomePreferences" tabindex="-1">Your preferences</h3><div class="welcome-fields">
        <label class="tf-field">Country<select name="country">${countries}</select></label>
        <label class="tf-field">Preferred language<select name="language" data-language-selector translate="no">${TDLocale.languages.map(([value,label])=>`<option value="${value}" ${value===TDLocale.language?'selected':''}>${label}</option>`).join('')}</select></label>
      </div></section>
      <section class="welcome-card" data-welcome-step="1" aria-labelledby="welcomeAbout" hidden><p class="welcome-step-count">2 / 2</p><h3 id="welcomeAbout" tabindex="-1">About you</h3><div class="welcome-fields">
        <label class="tf-field">Trading experience<select name="tradingLevel">${options([['beginner','Beginner'],['intermediate','Intermediate'],['experienced','Experienced'],['professional','Professional']],initial.tradingLevel)}</select></label>
        <label class="tf-field">Age group <span class="muted">(Optional)</span><select name="ageGroup">${options([['under18','Under 18'],['18-24','18–24'],['25-34','25–34'],['35-44','35–44'],['45-54','45–54'],['55-64','55–64'],['65+','65+']],initial.ageGroup)}</select></label>
        <label class="tf-field">Gender <span class="muted">(Optional)</span><select name="gender">${options([['man','Man'],['woman','Woman'],['non-binary','Non-binary'],['prefer-not-to-say','Prefer not to say']],initial.gender)}</select></label>
      </div></section>
      <p class="welcome-optional">All fields are optional. You can change these later in Settings.</p>
      <p id="welcomeStatus" class="ws-form-status" role="status" aria-live="polite"></p>
    </div><footer class="welcome-footer"><button type="button" class="btn ghost" data-welcome-skip>Skip for now</button><div><button type="button" class="btn ghost" id="welcomeBack" hidden>Back</button><button type="button" class="btn" id="welcomeNext">Continue</button><button type="submit" class="btn" id="welcomeFinish" hidden>Finish setup</button></div></footer></form>`;
  document.body.append(dialog);
  let step = 0, busy = false;
  const form = dialog.querySelector('form');
  function showStep(next) {
    step = next;
    dialog.querySelectorAll('[data-welcome-step]').forEach(card => {card.hidden=Number(card.dataset.welcomeStep)!==step;});
    dialog.querySelectorAll('.welcome-progress span').forEach((part,index)=>part.classList.toggle('on',index<=step));
    dialog.querySelector('#welcomeBack').hidden=step===0;
    dialog.querySelector('#welcomeNext').hidden=step===1;
    dialog.querySelector('#welcomeFinish').hidden=step===0;
    dialog.querySelector(step ? '#welcomeAbout' : '#welcomePreferences').focus();
    dialog.querySelector('.welcome-scroll').scrollTop=0;
  }
  async function finish() {
    if (busy) return;
    busy = true;
    const values=Object.fromEntries(new FormData(form));
    const settings={...initial,...values,onboardingCompleted:true,onboardingVersion:1};
    if (!settings.displayName && window.tdSignupName) settings.displayName=String(window.tdSignupName).slice(0,60);
    if (!settings.timezone) settings.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    dialog.querySelectorAll('button,input,select').forEach(button=>button.disabled=true);
    dialog.querySelector('#welcomeStatus').textContent='Saving…';
    try {
      const result=await wsApi('profile','PUT',{settings,revision:PF.data.revision});
      PF.data=result;window.tdNewAccount=false;pfPaintAvatar();
      await TDLocale.setLanguage(result.settings.language||TDLocale.language);
      dialog.close();
    } catch(error) {
      dialog.querySelector('#welcomeStatus').textContent=error.message||'Could not save your profile. Please try again.';
      dialog.querySelectorAll('button,input,select').forEach(button=>button.disabled=false);
      busy=false;
    }
  }
  dialog.querySelector('#welcomeNext').onclick=()=>showStep(1);
  dialog.querySelector('#welcomeBack').onclick=()=>showStep(0);
  dialog.querySelectorAll('[data-welcome-skip]').forEach(button=>button.onclick=()=>finish());
  form.onsubmit=event=>{event.preventDefault();if(step===0)showStep(1);else finish();};
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish();});
  dialog.addEventListener('close',()=>{dialog.remove();previousFocus?.focus();},{once:true});
  dialog.showModal();TDLocale.apply(dialog);dialog.querySelector('#welcomeNext').focus();
};
