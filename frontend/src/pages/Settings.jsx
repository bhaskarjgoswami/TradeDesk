import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import PlanCards from "../lib/PlanCards";

function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }

// Supported exchanges. `pass` = exchange also requires an API passphrase.
// Auto-sync of fills is live for Delta today; other exchanges securely store keys.
const EXCHANGES = [
  { id: "delta", name: "Delta Exchange (India)", pass: false, note: "Delta whitelists API keys by IP — whitelist the server's IP on your key for sync to work." },
  { id: "binance", name: "Binance", pass: false },
  { id: "bybit", name: "Bybit", pass: false },
  { id: "okx", name: "OKX", pass: true, note: "OKX requires the API passphrase you set when creating the key." },
  { id: "coinbase", name: "Coinbase Advanced", pass: true, note: "Use an Advanced Trade API key (key, secret & passphrase)." },
  { id: "kucoin", name: "KuCoin", pass: true, note: "KuCoin requires the API passphrase you set when creating the key." },
  { id: "kraken", name: "Kraken", pass: false },
  { id: "bitget", name: "Bitget", pass: true, note: "Bitget requires the API passphrase you set when creating the key." },
  { id: "mexc", name: "MEXC", pass: false },
];

export default function Settings() {
  const { user, isPro, expiresAt, signOut } = useAuth();
  const [ex, setEx] = useState({ has_creds: false, key_masked: "" });
  const [exId, setExId] = useState("delta");
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [pass, setPass] = useState("");
  const [exMsg, setExMsg] = useState("");
  const [dark, setDark] = useState(isDark());
  const exDef = EXCHANGES.find((e) => e.id === exId) || EXCHANGES[0];

  useEffect(() => {
    api.getExchange(exId).then(setEx).catch(() => setEx({ has_creds: false, key_masked: "" }));
  }, [exId]);

  function setTheme(d) {
    document.documentElement.setAttribute("data-theme", d ? "dark" : "");
    localStorage.setItem("td_theme", d ? "dark" : "");
    setDark(d);
  }
  function pickExchange(id) {
    setExId(id); setExMsg(""); setKey(""); setSecret(""); setPass("");
  }
  async function saveKeys() {
    setExMsg("Saving…");
    try {
      await api.saveExchange({ exchange: exId, key, secret, passphrase: pass });
      setExMsg("✓ Saved."); setKey(""); setSecret(""); setPass(""); setEx(await api.getExchange(exId));
    } catch (e) { setExMsg(e.message); }
  }

  return (
    <main className="main">
      <div className="pane-pad" style={{ maxWidth: 760 }}>
        <h1>Settings</h1>
        <div className="settings-card" style={{ maxWidth: "none" }}>
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
            <div className="set-label">Exchange</div>
            <div className="ex-creds">
              <label>Exchange</label>
              <select value={exId} onChange={(e) => pickExchange(e.target.value)}>
                {EXCHANGES.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                {ex.has_creds
                  ? `Connected · key ${ex.key_masked}`
                  : `No keys saved. Add your ${exDef.name} API key to auto-pull fills.`}
              </div>
              <label>API Key</label><input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter API key" />
              <label>API Secret</label><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Enter API secret" />
              {exDef.pass && (<>
                <label>API Passphrase</label><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Enter API passphrase" />
              </>)}
              <div className="set-row" style={{ marginTop: 14 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{exMsg}</span>
                <button className="btn" onClick={saveKeys}>Save</button>
              </div>
              {exDef.note && <div className="ex-note">{exDef.note}</div>}
            </div>
          </div>

          <div className="set-sec">
            <div className="set-label">Subscription {isPro ? <span className="pill">Pro</span> : <span className="pill setup">Free</span>}</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
              {isPro
                ? `You're on Pro${expiresAt ? ` — active until ${new Date(expiresAt).toLocaleDateString()}` : ""}. Paid securely via Razorpay; renew anytime before it lapses.`
                : "You're on the Free plan. Upgrade anytime to unlock everything."}
            </div>
            <PlanCards />
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
