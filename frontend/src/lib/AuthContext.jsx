import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { api } from "./api";

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

  const value = {
    session,
    user: session?.user || null,
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
