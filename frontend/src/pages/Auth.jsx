import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, check your inbox — otherwise you're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e2) {
      setErr(e2.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email) return setErr("Enter your email first");
    setErr(""); setMsg(""); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("Password reset link sent to your email.");
  }

  return (
    <div className="auth-wrap">
      <div className="panel auth-card">
        <h1>Trade<span style={{ color: "var(--accent)" }}>Desk</span></h1>
        <div className="sub">{mode === "login" ? "Sign in to your journal" : "Create your account"}</div>
        <form onSubmit={submit}>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
          {err && <div className="error">{err}</div>}
          {msg && <div style={{ color: "var(--green)", fontSize: 13, margin: "8px 0" }}>{msg}</div>}
          <button className="primary" style={{ width: "100%" }} disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <a onClick={() => setMode(mode === "login" ? "signup" : "login")} style={{ cursor: "pointer" }}>
            {mode === "login" ? "Create an account" : "Have an account? Sign in"}
          </a>
          {mode === "login" && <a onClick={reset} style={{ cursor: "pointer" }}>Forgot password?</a>}
        </div>
      </div>
    </div>
  );
}
