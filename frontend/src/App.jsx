import { useEffect, useRef, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { api } from "./lib/api";
import { Icon } from "./lib/ui";
import Auth from "./pages/Auth";
import DailyJournal from "./pages/DailyJournal";
import AllTrades from "./pages/AllTrades";
import Performance from "./pages/Performance";
import Settings from "./pages/Settings";

const NAV = [
  { to: "/journal", label: "Daily Journal", icon: Icon.book, bg: "rgba(108,92,231,.15)", fg: "#6c5ce7" },
  { to: "/trades", label: "All Trades", icon: Icon.folder, bg: "rgba(22,163,74,.14)", fg: "#16a34a" },
  { to: "/performance", label: "Performance", icon: Icon.chart, bg: "rgba(59,130,246,.14)", fg: "#3b82f6" },
  { to: "/settings", label: "Settings", icon: Icon.gear, bg: "rgba(217,119,6,.15)", fg: "#d97706" },
];
const TICK = ["BTCUSD", "ETHUSD"];

function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function Ticker() {
  const [rows, setRows] = useState(TICK.map((s) => [s, null]));
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await Promise.all(
        TICK.map(async (s) => {
          try { return [s, await api.price(s)]; } catch { return [s, null]; }
        })
      );
      if (alive) setRows(r);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return (
    <div className="tk-row">
      {rows.map(([s, r]) => {
        if (!r || r.error) return (
          <div className="tk" key={s}><div className="s">{s.replace("USD", "")}</div><div className="p muted">—</div></div>
        );
        const p = Number(r.mark_price || r.spot_price || r.close);
        const ch = r.change != null ? Number(r.change) : null;
        const cls = ch == null ? "muted" : ch >= 0 ? "pos" : "neg";
        return (
          <div className="tk" key={s}>
            <div className="s">{s.replace("USD", "")}</div>
            <div className="p">${p.toLocaleString("en-US", { maximumFractionDigits: p < 10 ? 3 : 0 })}</div>
            <div className={"c " + cls}>{ch == null ? "" : (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%"}</div>
          </div>
        );
      })}
    </div>
  );
}

function Shell() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(isDark());
  const [collapsed, setCollapsed] = useState(localStorage.getItem("td_sidebar") === "collapsed");
  const [search, setSearch] = useState(new URLSearchParams(loc.search).get("q") || "");
  const acctRef = useRef(null);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("td_sidebar", next ? "collapsed" : "open");
      return next;
    });
  }

  useEffect(() => {
    const onDoc = (e) => { if (acctRef.current && !acctRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // keep the box in sync when navigating away from a search
  useEffect(() => {
    if (loc.pathname !== "/trades") setSearch(new URLSearchParams(loc.search).get("q") || "");
  }, [loc.pathname]); // eslint-disable-line

  function toggleTheme() {
    const next = isDark() ? "" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("td_theme", next);
    setDark(next === "dark");
  }
  function onSearch(v) {
    setSearch(v);
    nav("/trades?q=" + encodeURIComponent(v));
  }
  const initial = (user?.email || "T").trim()[0].toUpperCase();

  return (
    <div className={"app" + (collapsed ? " collapsed" : "")}>
      <div className="topbar">
        <div className="tb-brand"><div className="logo">{Icon.book}</div> Trade Journal</div>
        <div className="tb-search">{Icon.search}
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search trades, setups, notes…" />
        </div>
        <div className="tb-right">
          <div className="tb-bell">{Icon.bell}</div>
          <div className="tb-acct" ref={acctRef}>
            <div className="tb-avatar" title="Account" onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}>{initial}</div>
            <div className={"tb-menu" + (menuOpen ? " show" : "")}>
              <div className="tb-menu-item" onClick={() => { setMenuOpen(false); nav("/settings"); }}>{Icon.gear} Settings</div>
              <div className="tb-menu-item danger" onClick={async () => { setMenuOpen(false); await signOut(); nav("/login"); }}>{Icon.logout} Log out</div>
            </div>
          </div>
        </div>
      </div>

      <div className="appbody">
        <aside className="sidebar">
          <div className="side-h">Folders</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} data-label={n.label} className={({ isActive }) => "navitem" + (isActive ? " on" : "")}>
              <span className="ic" style={{ background: n.bg, color: n.fg }}>{n.icon}</span>
              <span className="nav-lbl">{n.label}</span>
            </NavLink>
          ))}
          <div className="sidefoot">
            <Ticker />
            <button className="themebtn" onClick={toggleTheme} title={dark ? "Light mode" : "Dark mode"}>
              {dark ? Icon.sun : Icon.moon}<span className="tgl-lbl">{dark ? "Light mode" : "Dark mode"}</span>
            </button>
            <button className="tb-toggle" onClick={toggleCollapse} title="Collapse / expand">
              {Icon.menu}<span className="tgl-lbl">{collapsed ? "Expand" : "Collapse"}</span>
            </button>
          </div>
        </aside>

        <div className="content-card">
          <div className="pagefold" />
          <Routes>
            <Route path="/journal" element={<DailyJournal />} />
            <Route path="/trades" element={<AllTrades />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/journal" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="login"><div style={{ color: "#7e7e82" }}>Loading…</div></div>;
  }
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return <Shell />;
}
