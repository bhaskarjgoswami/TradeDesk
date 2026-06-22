import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState("free");

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
      api.subStatus().then((s) => setTier(s.tier)).catch(() => {});
    } else {
      setTier("free");
    }
  }, [session]);

  const value = {
    session,
    user: session?.user || null,
    tier,
    isPro: tier === "pro",
    loading,
    refreshTier: () => api.subStatus().then((s) => setTier(s.tier)).catch(() => {}),
    signOut: () => supabase.auth.signOut(),
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
