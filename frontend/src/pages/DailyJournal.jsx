import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { fmt } from "../lib/calc";
import { fmtDate, fmtDateLong, TODAY } from "../lib/ui";
import { useAuth } from "../lib/AuthContext";
import TradeForm from "../components/TradeForm";
import UpgradeModal from "../lib/UpgradeModal";

const FREE_DAILY_LIMIT = 2;

function pnlCls(n) { return n > 0 ? "pos" : n < 0 ? "neg" : "muted"; }

export default function DailyJournal() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { isPro } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [days, setDays] = useState([]);
  const [active, setActive] = useState(null);
  const [detail, setDetail] = useState(null);
  const [formMode, setFormMode] = useState(null); // null | "new" | <tradeId>
  const [pullMsg, setPullMsg] = useState("");
  const newSlotRef = useRef(null);

  async function loadDays() {
    const d = await api.listDaylogs();
    setDays(d);
    return d;
  }

  async function selectDay(date) {
    setActive(date);
    const d = await api.getDaylog(date);
    setDetail(d);
    return d;
  }

  // initial load — honor ?date=&edit= coming from the All Trades page
  useEffect(() => {
    (async () => {
      const list = await loadDays();
      const d = params.get("date");
      const e = params.get("edit");
      const target = d || (list.length ? list[0].date : TODAY());
      await selectDay(target);
      if (e) setFormMode(e === "new" ? "new" : Number(e));
      if (d || e) setParams({}, { replace: true });
    })();
    /* eslint-disable-next-line */
  }, []);

  function pickDay(date) { setFormMode(null); selectDay(date); }

  function addTrade() {
    // Free tier: max 2 trades per day → prompt to upgrade instead of opening the form.
    if (!isPro && (detail?.trades?.length || 0) >= FREE_DAILY_LIMIT) {
      setShowUpgrade(true);
      return;
    }
    setFormMode("new");
    setTimeout(() => newSlotRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  async function pullDelta() {
    setPullMsg("Pulling…");
    try {
      const { trades } = await api.deltaToday();
      let n = 0;
      for (const t of (trades || []).filter((x) => !x.open)) { await api.createTrade(t); n++; }
      setPullMsg(`Imported ${n} round-trip trade(s).`);
      await selectDay(active); loadDays();
    } catch (e) {
      const msg = e.message || "";
      // Map the backend's raw gating codes to actionable prompts.
      if (/free-daily-limit/i.test(msg)) { setPullMsg(""); setShowUpgrade(true); await selectDay(active); loadDays(); }
      else if (/no.?credentials/i.test(msg)) setPullMsg("__NO_CREDS__");
      else if (/pro subscription/i.test(msg)) setPullMsg("__NEED_PRO__");
      else setPullMsg(msg);
    }
  }

  async function afterSave() {
    setFormMode(null);
    await selectDay(active); loadDays();
  }
  async function delTrade(id) {
    if (!confirm("Delete this trade permanently?")) return;
    await api.deleteTrade(id);
    setFormMode(null);
    await selectDay(active); loadDays();
  }

  const s = detail?.stats || {};
  const pf = s.profit_factor === 999 ? "∞" : s.profit_factor;

  return (
    <>
      {/* MIDDLE — day list */}
      <section className="middle">
        <div className="midhead"><h2>Days Logged ({days.length})</h2></div>
        <div className="daycards">
          {days.length === 0 && <div className="emptyday">No days yet. Hit <b>+ Add trade</b> to start.</div>}
          {days.map((d) => (
            <div key={d.date} className={"daycard" + (d.date === active ? " sel" : "") + (!d.has_log && d.total_trades === 0 ? " missing" : "")}
                 onClick={() => pickDay(d.date)}>
              <div className="dc-date">{fmtDate(d.date)}</div>
              {d.has_log || d.total_trades > 0 ? (
                <div className={"dc-pnl " + pnlCls(d.net_pnl)}>Net P&L {d.net_pnl > 0 ? "+" : ""}{fmt.money(d.net_pnl)}</div>
              ) : (
                <div className="dc-missing">Day log is missing.<span>Fill the log →</span></div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* MAIN — day view */}
      <main className="main">
        <div className="dv-top">
          <div className="dv-title">{active ? fmtDateLong(active) : "Select a day"}</div>
          <div className="dv-actions">
            <button className="btn" onClick={addTrade} disabled={!active}>+ Add trade</button>
          </div>
        </div>
        <hr className="div" />

        {!detail ? (
          <div className="dv-grid"><div className="muted">Loading…</div></div>
        ) : (
          <div className="dv-grid" style={detail.trades.length === 0 ? { gridTemplateColumns: "1fr" } : undefined}>
            <div className="dv-main">
              {pullMsg && (
                <div className="muted" style={{ marginBottom: 12 }}>
                  {pullMsg === "__NO_CREDS__" ? (
                    <>
                      No exchange API keys saved.{" "}
                      <a
                        href="/settings"
                        onClick={(ev) => { ev.preventDefault(); nav("/settings"); }}
                        style={{ color: "#d97706", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}
                      >
                        Add your API credentials in Settings →
                      </a>{" "}
                      to auto-pull fills.
                    </>
                  ) : pullMsg === "__NEED_PRO__" ? (
                    <>
                      Auto-sync is a Pro feature.{" "}
                      <a
                        href="/settings"
                        onClick={(ev) => { ev.preventDefault(); nav("/settings"); }}
                        style={{ color: "#d97706", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}
                      >
                        Upgrade to Pro in Settings →
                      </a>{" "}
                      to connect your exchange.
                    </>
                  ) : pullMsg}
                </div>
              )}

              {/* trades */}
              {detail.trades.length === 0 && formMode !== "new" ? (
                <div className="empty-state">
                  <svg width="140" height="104" viewBox="0 0 140 104" fill="none">
                    <line x1="12" y1="90" x2="128" y2="90" stroke="currentColor" strokeWidth="1.5" opacity=".25" />
                    <rect x="24" y="44" width="12" height="24" rx="2.5" fill="var(--red)" opacity=".55" />
                    <rect x="50" y="32" width="12" height="22" rx="2.5" fill="var(--grn)" opacity=".55" />
                    <rect x="76" y="52" width="12" height="20" rx="2.5" fill="var(--red)" opacity=".55" />
                    <rect x="102" y="28" width="12" height="24" rx="2.5" fill="var(--grn)" opacity=".55" />
                    <circle cx="120" cy="22" r="14" fill="var(--accent)" />
                    <path d="M120 15.5v13M113.5 22h13" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                  <h3>No trades logged yet</h3>
                  <p>Record your first trade of the day — add it manually, or pull your fills from Delta.</p>
                  <button className="btn" onClick={addTrade}>+ Add trade</button>
                </div>
              ) : (
                detail.trades.map((t) => {
                  const open = formMode === t.id;
                  return (
                    <div className={"acc" + (open ? " open" : "")} key={t.id}>
                      <div className="acc-head" onClick={() => setFormMode(open ? null : t.id)}>
                        <span className="t-sym">{t.symbol || "—"}</span>
                        <span className="t-tags">
                          {t.direction && <span className={"pill " + t.direction.toLowerCase()}>{t.direction}</span>}
                          {t.setup && <span className="pill setup">{t.setup}</span>}
                        </span>
                        <span className="t-note">{t.logic || t.notes || ""}</span>
                        <span className={"t-r " + pnlCls(t.r_multiple)}>{t.r_multiple == null || t.r_multiple === "" ? "" : fmt.num(t.r_multiple, 2) + "R"}</span>
                        <span className={"t-pnl " + pnlCls(t.pnl)}>{fmt.money(t.pnl)}</span>
                        <span className="t-out">{t.outcome && <span className={"pill " + t.outcome.toLowerCase()}>{t.outcome}</span>}</span>
                        <span className="acc-caret">{open ? "▾" : "▸"}</span>
                      </div>
                      {open && (
                        <div className="acc-body">
                          <TradeForm initial={t} onClose={() => setFormMode(null)} onSaved={afterSave} />
                          <div className="acc-actions">
                            <button className="btn danger" onClick={() => delTrade(t.id)}>Delete trade</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* inline new-trade form */}
              {formMode === "new" && (
                <div className="newtrade-slot" ref={newSlotRef}>
                  <TradeForm initial={{ date: active, direction: "Long" }} onClose={() => setFormMode(null)} onSaved={afterSave} onPull={pullDelta} onLimit={() => { setFormMode(null); setShowUpgrade(true); }} />
                </div>
              )}
            </div>

            {/* RAIL — stats (hidden until the day has trades) */}
            {detail.trades.length > 0 && (
            <div className="rail">
              <div className="rail-group">
                <div className="rail-row"><span className="k">Gross P&L</span><span className={"v " + pnlCls(s.gross_pnl)}>{fmt.money(s.gross_pnl)}</span></div>
                <div className="rail-row"><span className="k">Platform fee</span><span className="v muted">{fmt.money(s.platform_fee)}</span></div>
                <div className="rail-row"><span className="k">Net P&L</span><span className={"v " + pnlCls(s.net_pnl)}>{fmt.money(s.net_pnl)}</span></div>
              </div>
              <div className="rail-group">
                {s.volume != null && <div className="rail-row"><span className="k">Volume</span><span className="v">{fmt.num(s.volume, 0)}</span></div>}
                <div className="rail-row"><span className="k">Profit Factor</span><span className="v">{pf ?? "—"}</span></div>
              </div>
              <div className="rail-group">
                <div className="rail-row"><span className="k">Total Trades</span><span className="v">{s.total_trades ?? 0}</span></div>
                <div className="rail-row"><span className="k">Winners</span><span className="v pos">{s.winners ?? 0}</span></div>
                <div className="rail-row"><span className="k">Losers</span><span className="v neg">{s.losers ?? 0}</span></div>
                <div className="rail-row"><span className="k">Winrate</span><span className="v">{s.winrate ?? 0}%</span></div>
              </div>
            </div>
            )}
          </div>
        )}
      </main>

      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  );
}
