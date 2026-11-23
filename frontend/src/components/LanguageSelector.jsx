import { useSyncExternalStore, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";

const subscribe = (listener) => window.TDLocale?.subscribe(listener) || (() => {});
const snapshot = () => window.TDLocale?.language || "en";
export default function LanguageSelector() {
  const {session}=useAuth();
  const [busy,setBusy]=useState(false);
  const language = useSyncExternalStore(subscribe, snapshot, () => "en");
  const code = language.split("-")[0].toUpperCase();
  // Phones get a compact globe + code chip; the real <select> sits invisibly on top so it stays native and accessible.
  return <label className="language-control"><svg className="lc-globe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg><span className="lc-label">Language</span><span className="lc-code" aria-hidden="true" translate="no">{code}</span><select aria-label="Language" translate="no" disabled={busy} value={language} onChange={async event => {
    const selected=event.target.value;setBusy(true);
    try {
    const ok=await window.TDLocale.setLanguage(selected);
    if (!ok) {window.alert(window.TDLocale.translate("Language could not load. Please try again."));return;}
    if(session){
      const profile=await api.journalProfile();
      await api.saveJournalProfile({...profile,settings:{...profile.settings,language:selected}});
    }
    } catch {window.alert(window.TDLocale.translate("Language changed on this device. Save it in Settings to sync your account."));}
    finally {setBusy(false);}
  }}>{(window.TDLocale?.languages||[["en","English"]]).map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>;
}
