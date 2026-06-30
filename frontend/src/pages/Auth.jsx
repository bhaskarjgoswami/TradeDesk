import { useState } from "react";
import { supabase } from "../lib/supabase";

const BrandMark = (
  <span className="mark"><svg viewBox="0 0 24 24"><path d="M6 3.5h11A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6z" /><path d="M6 3.5v17" /><path d="M9.5 8h6M9.5 12h4" /></svg></span>
);

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setMsg("");
    if (!email || !password) { setErr("Enter your email and password."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, check your inbox — otherwise you're in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e2) { setErr(e2.message || "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!email) return setErr("Enter your email first");
    setErr(""); setMsg(""); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setBusy(false);
    error ? setErr(error.message) : setMsg("Password reset link sent to your email.");
  }

  return (
    <div className="login">
      <div className="login-card2">
        <div className="login-left">
          <div className="brand2">{BrandMark}<span className="brandtxt">TradeDesk</span></div>
          <h1>{mode === "login" ? "Login to your account" : "Create your account"}</h1>
          <div className="sub">{mode === "login" ? "Enter your password to continue." : "Start your private trading journal."}</div>

          <div className="seg2">
            <button type="button" className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); setMsg(""); }}>Sign in</button>
            <button type="button" className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); setMsg(""); }}>Sign up</button>
          </div>

          <form onSubmit={submit}>
            <label>Email Address</label>
            <div className="ic-field">
              <svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 5.5L20 7" /></svg>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
            </div>
            <label>Password</label>
            <div className="ic-field">
              <svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />
              <button type="button" className="eye" onClick={() => setShow((s) => !s)}>
                <svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
              </button>
            </div>
            {mode === "login" && <a className="forgot" onClick={reset}>Forgot password?</a>}
            {err && <div className="login-err">{err}</div>}
            {msg && <div className="login-msg">{msg}</div>}
            <button className="login-btn" type="submit" disabled={busy}>
              {busy ? "…" : mode === "login" ? "Sign In" : "Create account"}
              <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
          <div className="login-foot">Need help? Contact <a>support@tradejournal.app</a></div>
        </div>

        <div className="login-right">
          <div className="glowbg" /><div className="sphere" />
          <div className="right-content">
            <div className="brand2">{BrandMark}<span className="brandtxt">TradeDesk</span></div>
            <h2>Review every trade,<br />sharpen your edge</h2>
            <p>Log setups, screenshots, and P&amp;L in one private journal built for serious traders.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
