// Keep the shared billing styles inside its panel, away from journal styles.
export function createBillingHost(host, css, locale = window.TDLocale) {
  const shadow = host.shadowRoot || host.attachShadow({mode:'open'});
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  shadow.replaceChildren(style, mount);
  let pending = false;
  const observer = new MutationObserver(() => {
    if(pending)return;
    pending = true;
    requestAnimationFrame(() => {pending=false;translate();});
  });
  function translate() {
    observer.disconnect();
    locale?.apply(mount);
    observer.observe(mount,{childList:true,subtree:true,characterData:true});
  }
  window.addEventListener('td-language-change',translate);
  observer.observe(mount,{childList:true,subtree:true,characterData:true});
  return {mount,dispose(){observer.disconnect();window.removeEventListener('td-language-change',translate);}};
}
