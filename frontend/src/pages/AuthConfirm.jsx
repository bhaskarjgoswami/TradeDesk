import {useEffect} from "react";
import {loadSupabase} from "../lib/supabaseLoader";
import {finishEmailConfirmation,initialAuthReturn} from "../lib/authReturn";
let pending;
export default function AuthConfirm(){
  useEffect(()=>{
    let active=true;
    pending ||= loadSupabase().then(supabase=>finishEmailConfirmation(supabase.auth,initialAuthReturn)).catch(()=>"/app?auth_error=invalid");
    pending.then(path=>{if(active)window.location.replace(path);});
    return()=>{active=false;};
  },[]);
  return <div className="page-loading" role="status">Confirming your email…</div>;
}
