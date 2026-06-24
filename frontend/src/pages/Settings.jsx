import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }

export default function Settings() {
  const { user, isPro, refreshTier, signOut } = useAuth();
  const [ex, setEx] = useState({ has_creds: false, key_masked: "" });
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [exMsg, setExMsg] = useState("");
  const [billMsg, setBillMsg] = useState("");
  const [dark, setDark] = useState(isDark());

  useEffect(() => {
    api.getExchange().then(setEx).catch(() => {});
    if (new URLSearchParams(location.search).get("upgraded")) { setBillMsg("🎉 Welcome to Pro!"); refreshTier(); }
    /* eslint-disable-next-line */
  }, []);

  function setTheme(d) {
    document.documentElement.setAttribute("data-theme", d ? "dark" : "");
    localStorage.setItem("td_theme", d ? "dark" : "");
    setDark(d);
  }
  async function saveKeys() {
    setExMsg("Saving…");
    try { await api.saveExchange({ exchange: "delta", key, secret }); setExMsg("✓ Saved."); setKey(""); setSecret(""); setEx(await api.getExchange()); }
    catch (e) { setExMsg(e.message); }
  }
  async function upgrade() {
    setBillMsg("Redirecting to checkout…");
    try { const { url } = await api.checkout(); location.href = url; } catch (e) { setBillMsg(e.message); }
  }
  async function manage() {
    try { const { url } = await api.portal(); location.href = url; } catch (e) { setBillMsg(e.message); }
  }

  return (
    <main className="main">
      <div className="pane-pad" style={{ maxWidth: 600 }}>
        <h1>Settings</h1>
        <div className="settings-card">
          <div className="set-sec">
            <div className="set-label">Appearance</div>
            <div className="set-row"><span>Theme</span>
              <div className="seg" style={{ width: 180 }}>
                <button className={!dark ? "on" : ""} onClick={() => setTheme(false)}>Light</button>
                <button className={dark ? "on" : ""} onClick={() => setTheme(true)}>Dark</button>
              </div>
            </div>
          </div>

          <div className="set-sec">
            <div className="set-label">Subscription</div>
            <div className="set-row"><span>Current plan: <strong>{isPro ? "Pro" : "Free"}</strong></span>
              {isPro ? <button className="btn ghost" onClick={manage}>Manage billing</button>
                     : <button className="btn" onClick={upgrade}>Upgrade to Pro</button>}
            </div>
            {!isPro && (
              <ul className="set-list" style={{ marginTop: 10 }}>
                <li>Free — 50 trades / month, manual entry only</li>
                <li><strong>Pro ($9/mo)</strong> — unlimited trades, Delta auto-sync, screenshots, mobile</li>
              </ul>
            )}
            {billMsg && <div className="ex-note">{billMsg}</div>}
          </div>

          <div className="set-sec">
            <div className="set-label">Exchange — Delta {!isPro && <span className="pill setup">Pro to sync</span>}</div>
            <div className="ex-creds">
              <div className="muted" style={{ fontSize: 12.5 }}>
                {ex.has_creds ? `Connected · key ${ex.key_masked}` : "No keys saved. Add your Delta India API key to auto-pull fills."}
              </div>
              <label>API Key</label><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter API key" />
              <label>API Secret</label><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Enter API secret" />
              <div className="set-row" style={{ marginTop: 14 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{exMsg}</span>
                <button className="btn" onClick={saveKeys}>Save</button>
              </div>
              <div className="ex-note">Delta whitelists API keys by IP — whitelist the server's IP on your key for sync to work.</div>
            </div>
          </div>

          <div className="set-sec">
            <div className="set-label">Account</div>
            <div className="set-row"><span className="muted">{user?.email}</span><button className="btn ghost" onClick={signOut}>Log out</button></div>
          </div>
        </div>
      </div>
    </main>
  );
}
