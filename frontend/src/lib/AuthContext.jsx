import { createContext, useContext, useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "./supabase";
import { api } from "./api";
import { setCurrency } from "./calc";
import { CHECKLIST_DEFAULT, legacyChecklist } from "./ui";
import { normalizeRoutine } from "./routine";

// Per-user preferences live in Supabase Auth user_metadata so they follow the
// user across devices without a DB table.
function prefsFrom(user) {
  const m = user?.user_metadata || {};
  return {
    currency: m.currency || "USD",
    checklist: Array.isArray(m.checklist) ? m.checklist : legacyChecklist() || CHECKLIST_DEFAULT.slice(),
    routine: normalizeRoutine(m.routine),
    routine_progress: m.routine_progress || null, // { day, done: [step titles] }
  };
}

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState(null);
  const [tierStatus, setTierStatus] = useState("loading");
  const requestVersion = useRef(0);
  const [sub, setSub] = useState({ plan: null, expiresAt: null });

  const applyStatus = (s) => {
    setTier(s.tier);
    setTierStatus("ready");
    setSub({ plan: s.plan || null, expiresAt: s.expires_at || null });
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function refreshTier() {
    const version = ++requestVersion.current;
    setTierStatus("loading");
    try {
      const status = await api.subStatus();
      if (version === requestVersion.current) applyStatus(status);
    } catch (error) {
      if (version === requestVersion.current) setTierStatus("error");
      throw error;
    }
  }

  useEffect(() => {
    if (session) {
      refreshTier().catch(() => {});
    } else {
      ++requestVersion.current;
      setTier(null);
      setTierStatus("signed-out");
      setSub({ plan: null, expiresAt: null });
    }
    return () => { ++requestVersion.current; };
  }, [session?.user?.id]);

  useEffect(() => {
    let active=true;
    if (session?.user) api.journalProfile().then(profile => {
      if (!active) return;
      window.TDLocale?.protect(profile);
      const language=profile.settings?.language || session.user.user_metadata?.preferred_language;
      if (language) window.TDLocale?.setLanguage(language);
    }).catch(() => {});
    return () => {active=false;};
  }, [session?.user?.id]);

  // Memoised: consumers use prefs.* as effect dependencies.
  const prefs = useMemo(() => prefsFrom(session?.user), [session?.user]);
  setCurrency(prefs.currency);

  async function savePrefs(patch) {
    const { data, error } = await supabase.auth.updateUser({ data: { ...prefs, ...patch } });
    if (error) throw error;
    setSession((s) => (s ? { ...s, user: data.user } : s));
  }

  const value = {
    session,
    user: session?.user || null,
    prefs,
    savePrefs,
    tier,
    tierStatus,
    isPro: tier === "pro",
    plan: sub.plan,
    expiresAt: sub.expiresAt,
    loading,
    refreshTier,
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
