import {useEffect} from "react";
import {supabase} from "../lib/supabase";
import {finishEmailConfirmation,initialAuthReturn} from "../lib/authReturn";
let pending;
export default function AuthConfirm(){
  useEffect(()=>{
    let active=true;
    pending ||= finishEmailConfirmation(supabase.auth,initialAuthReturn);
    pending.then(path=>{if(active)window.location.replace(path);});
    return()=>{active=false;};
  },[]);
  return <div className="page-loading" role="status">Confirming your email…</div>;
}
