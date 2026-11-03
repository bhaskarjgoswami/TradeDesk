import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { api } from "./api";
import { setCurrency } from "./calc";
import { CHECKLIST_DEFAULT, legacyChecklist } from "./ui";

// Per-user preferences live in Supabase Auth user_metadata so they follow the
// user across devices without a DB table.
function prefsFrom(user) {
  const m = user?.user_metadata || {};
  return {
    currency: m.currency || "USD",
    checklist: Array.isArray(m.checklist) ? m.checklist : legacyChecklist() || CHECKLIST_DEFAULT.slice(),
  };
}

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("free");
  const [sub, setSub] = useState({ plan: null, expiresAt: null });

  const applyStatus = (s) => {
    setTier(s.tier);
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

  useEffect(() => {
    if (session) {
      api.subStatus().then(applyStatus).catch(() => {});
    } else {
      setTier("free");
      setSub({ plan: null, expiresAt: null });
    }
  }, [session]);

  const prefs = prefsFrom(session?.user);
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
    isPro: tier === "pro",
    plan: sub.plan,
    expiresAt: sub.expiresAt,
    loading,
    refreshTier: () => api.subStatus().then(applyStatus).catch(() => {}),
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
