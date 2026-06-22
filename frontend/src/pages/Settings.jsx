import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

export default function Settings() {
  const { user, tier, isPro, refreshTier } = useAuth();
  const [ex, setEx] = useState({ has_creds: false, key_masked: "" });
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [exMsg, setExMsg] = useState("");
  const [billMsg, setBillMsg] = useState("");

  useEffect(() => {
    api.getExchange().then(setEx).catch(() => {});
    // Stripe success redirect → refresh tier
    if (new URLSearchParams(location.search).get("upgraded")) {
      setBillMsg("🎉 Welcome to Pro!");
      refreshTier();
    }
    /* eslint-disable-next-line */
  }, []);

  async function saveKeys() {
    setExMsg("Saving…");
    try {
      await api.saveExchange({ exchange: "delta", key, secret });
      setExMsg("✓ Saved.");
      setKey(""); setSecret("");
      setEx(await api.getExchange());
    } catch (e) { setExMsg(e.message); }
  }

  async function upgrade() {
    setBillMsg("Redirecting to checkout…");
    try {
      const { url } = await api.checkout();
      location.href = url;
    } catch (e) { setBillMsg(e.message); }
  }

  async function manage() {
    try {
      const { url } = await api.portal();
      location.href = url;
    } catch (e) { setBillMsg(e.message); }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      {/* Subscription */}
      <div className="panel" style={{ marginBottom: 18, maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Subscription</h3>
        <p>Current plan: <strong>{isPro ? "Pro" : "Free"}</strong></p>
        {!isPro ? (
          <>
            <ul className="muted" style={{ lineHeight: 1.7 }}>
              <li>Free: 50 trades / month, manual entry only</li>
              <li><strong>Pro ($9/mo):</strong> unlimited trades, Delta auto-sync, screenshot uploads, mobile app</li>
            </ul>
            <button className="primary" onClick={upgrade}>Upgrade to Pro</button>
          </>
        ) : (
          <button onClick={manage}>Manage billing</button>
        )}
        {billMsg && <div className="muted" style={{ marginTop: 10 }}>{billMsg}</div>}
      </div>

      {/* Delta keys */}
      <div className="panel" style={{ marginBottom: 18, maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Delta Exchange API {!isPro && <span className="pill">Pro to sync</span>}</h3>
        <p className="muted">
          {ex.has_creds ? `Connected · key ${ex.key_masked}` : "No keys saved. Add your Delta India API key to auto-pull fills."}
        </p>
        <label className="field"><span>API Key</span><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="••••" /></label>
        <label className="field"><span>API Secret</span><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
        <button onClick={saveKeys}>Save keys</button>
        {exMsg && <div className="muted" style={{ marginTop: 10 }}>{exMsg}</div>}
        <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Note: Delta whitelists API keys by IP. Whitelist the server's IP on your key for sync to work.
        </p>
      </div>

      {/* Account */}
      <div className="panel" style={{ maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Account</h3>
        <p className="muted">Signed in as {user?.email}</p>
      </div>
    </>
  );
}
