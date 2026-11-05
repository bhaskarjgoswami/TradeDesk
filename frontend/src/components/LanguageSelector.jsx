import { useSyncExternalStore, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";

const subscribe = (listener) => window.TDLocale?.subscribe(listener) || (() => {});
const snapshot = () => window.TDLocale?.language || "en";
export default function LanguageSelector() {
  const {session}=useAuth();
  const [busy,setBusy]=useState(false);
  const language = useSyncExternalStore(subscribe, snapshot, () => "en");
  return <label className="language-control"><span>Language</span><select aria-label="Language" translate="no" disabled={busy} value={language} onChange={async event => {
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
