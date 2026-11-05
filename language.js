/* Shared UI localization for the desktop journal and React public pages.
 * Translates text nodes in place (never innerHTML), preserves original text,
 * form values and user content, and observes dynamically rendered UI. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) root.TDLocale = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';
  const languages = Object.freeze([
    ['en', 'English'], ['hi', 'हिन्दी'], ['es', 'Español'], ['fr', 'Français'],
    ['de', 'Deutsch'], ['pt', 'Português'], ['ar', 'العربية'], ['zh-CN', '简体中文']
  ]);
  const supported = new Set(languages.map(([code]) => code));
  const normalize = value => {
    const code = String(value || '').replace('_', '-').toLowerCase();
    if (code.startsWith('zh')) return 'zh-CN';
    const base = code.split('-')[0];
    return supported.has(base) ? base : 'en';
  };
  function initialLanguage() {
    try { const saved = root.localStorage?.getItem('td_language'); if (saved && supported.has(saved)) return saved; } catch {}
    return normalize(root.navigator?.languages?.[0] || root.navigator?.language || 'en');
  }
  let language = initialLanguage(), catalog = {}, requestVersion = 0, observer = null, scheduled = false;
  const cache = new Map([['en', {}]]), originals = new WeakMap(), attributes = new WeakMap(), listeners = new Set(), protectedText = new Set();
  const catalogIndexes=new WeakMap();
  const key = value => String(value).replace(/\s+/g, ' ').trim();
  function translate(source, dictionary = catalog) {
    if (!source || language === 'en') return source;
    const normalized = key(source);
    if (protectedText.has(normalized)) return source;
    let index=catalogIndexes.get(dictionary);
    if(!index){index=new Map(Object.entries(dictionary).map(([k,v])=>[k.toLowerCase(),v]));catalogIndexes.set(dictionary,index);}
    const lookup = text => Object.hasOwn(dictionary,text) ? dictionary[text] : index.get(text.toLowerCase());
    const result = lookup(normalized);
    if (result) return source.replace(source.trim(), result);
    const sentences=normalized.split(/(?<=[.!?])\s+/);
    if(sentences.length>1 && sentences.every(sentence=>lookup(sentence))) return sentences.map(lookup).join(' ');
    // Keep punctuation and counts separate from translated UI labels.
    const prefix = normalized.match(/^([+←→‹›«»✓⚡🎉]\s*)(.+)$/u);
    if(prefix && lookup(prefix[2])) return prefix[1]+lookup(prefix[2]);
    const decorated = normalized.match(/^([+←→‹›«»✓⚡🎉]?\s*)(.+?)(\s*(?:[.…:?!]|→|←))$/u);
    if (decorated && lookup(decorated[2])) return decorated[1] + lookup(decorated[2]) + decorated[3];
    const patterns = [
      [/^Today (\d+)$/, 'Today {count}'], [/^Week (\d+)$/, 'Week {count}'],
      [/^(\d+) Trades$/, '{count} trades'], [/^(\d+) trades$/, '{count} trades'],
      [/^(\d+) day$/, '{count} day'], [/^(\d+) days$/, '{count} days'],
      [/^(\d+) of (\d+) steps done$/, '{count} of {total} steps done'],
      [/^(\d+) of (\d+) complete$/, '{count} of {total} complete']
    ];
    for (const [pattern, template] of patterns) {
      const match=normalized.match(pattern);
      if (match && dictionary[template]) return dictionary[template].replace('{count}',match[1]).replace('{total}',match[2]||'');
    }
    const counted = normalized.match(/^(.*?)\s*\((\d+)\)$/);
    if (counted && lookup(counted[1])) return lookup(counted[1]) + ' (' + counted[2] + ')';
    return source;
  }
  // Never translate saved content, API keys, identifiers, or editable text.
  const userKeys = new Set(['firstName','lastName','displayName','email','mobile','zip','bio','symbol','setup','tf_bias','notes','logic','tags','title','content','description','overall','market','watchlist','mistakes','did_great','reinforcement','name','charting','criteria','management','exitRules']);
  function protect(data) {
    if (!data || typeof data !== 'object') return;
    for (const [field, value] of Object.entries(data)) {
      if (userKeys.has(field)) {
        const add = v => { if (typeof v === 'string' && v.trim()) protectedText.add(key(v)); else if (Array.isArray(v)) v.forEach(add); };
        add(value);
      }
      if (value && typeof value === 'object') protect(value);
    }
  }
  function skipped(element) {
    return !element || !!element.closest('script,style,textarea,code,pre,[contenteditable="true"],[translate="no"],[data-user-content],.notranslate,#exSelect option');
  }
  function apply(scope = root.document?.body) {
    if (!scope || !root.document) return;
    observer?.disconnect();
    try {
      // A native option without a value uses its label as its submitted value.
      // Freeze that original value before translating the visible label.
      scope.querySelectorAll('option:not([value])').forEach(option=>{option.value=option.textContent;});
      const walker = root.document.createTreeWalker(scope, 4);
      let node;
      while ((node = walker.nextNode())) {
        if (skipped(node.parentElement) || !node.nodeValue.trim()) continue;
        const old = originals.get(node);
        // React or the journal may have replaced the rendered text since last pass.
        const source = old && node.nodeValue === old.output ? old.source : node.nodeValue;
        const output = translate(source);
        originals.set(node, {source, output});
        if (node.nodeValue !== output) node.nodeValue = output;
      }
      const elements = [...scope.querySelectorAll('[placeholder],[title],[aria-label],[data-tip],img[alt]')];
      for (const element of elements) {
        if (skipped(element)) continue;
        const saved = attributes.get(element) || {};
        for (const attr of ['placeholder','title','aria-label','data-tip','alt']) {
          if (!element.hasAttribute(attr)) continue;
          const current = element.getAttribute(attr), old = saved[attr];
          const source = old && current === old.output ? old.source : current;
          const output = translate(source);
          saved[attr] = {source,output};
          if (current !== output) element.setAttribute(attr,output);
        }
        attributes.set(element,saved);
      }
    } finally { observe(); }
  }
  function observe() {
    if (observer && root.document?.body) observer.observe(root.document.body, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label','data-tip','alt']});
  }
  function queueApply() {
    if (scheduled) return;
    scheduled = true;
    (root.requestAnimationFrame || (callback => setTimeout(callback,0)))(() => { scheduled = false; apply(); });
  }
  async function setLanguage(value, {persist = true} = {}) {
    const next = normalize(value), version = ++requestVersion;
    let dictionary = cache.get(next);
    if (!dictionary) {
      try {
        const response = await root.fetch('/locales/' + next + '.json');
        if (!response.ok) throw Error('Language could not load');
        dictionary = await response.json();
        cache.set(next,dictionary);
      } catch (error) {
        if (version === requestVersion) root.dispatchEvent?.(new CustomEvent('td-language-error', {detail:{language:next}}));
        return false;
      }
    }
    if (version !== requestVersion) return false;
    language = next; catalog = dictionary;
    if (persist) { try { root.localStorage?.setItem('td_language',next); } catch {} }
    if (root.document) {
      root.document.documentElement.lang = next;
      root.document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
      apply();
      root.document.querySelectorAll('[data-language-selector]').forEach(select => {select.value=language;});
      try {
        const names=new Intl.DisplayNames([language],{type:'region'});
        root.document.querySelectorAll('select[name="country"] option').forEach(option=>{if (/^[A-Z]{2}$/.test(option.value)) option.textContent=names.of(option.value);});
      } catch {}
      root.dispatchEvent(new CustomEvent('td-language-change', {detail:{language:next}}));
    }
    listeners.forEach(listener => listener());
    return true;
  }
  function start() {
    observer = new MutationObserver(queueApply);
    observe();
    root.document.addEventListener('change', event => {
      if (event.target.matches('[data-language-selector]')) {
        setLanguage(event.target.value).then(ok => { if (!ok) { event.target.value = language; root.alert(translate('Language could not load. Please try again.')); } });
      }
    });
    for (const method of ['confirm','alert','prompt']) {
      const original = root[method]?.bind(root);
      if (original) root[method] = (message, ...args) => original(translate(String(message)),...args);
    }
    root.addEventListener('storage', event => { if (event.key === 'td_language' && event.newValue) setLanguage(event.newValue,{persist:false}); });
    setLanguage(language,{persist:false});
  }
  const api = {languages, normalize, translate, protect, setLanguage, apply, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, get language() { return language; }};
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
  return api;
});
