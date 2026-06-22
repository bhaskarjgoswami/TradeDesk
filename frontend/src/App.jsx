import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import Auth from "./pages/Auth";
import DailyJournal from "./pages/DailyJournal";
import AllTrades from "./pages/AllTrades";
import Performance from "./pages/Performance";
import Settings from "./pages/Settings";

function ThemeToggle() {
  const toggle = () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next === "light" ? "" : next);
    localStorage.setItem("td_theme", next === "light" ? "" : next);
  };
  return <button onClick={toggle} style={{ width: "100%" }}>🌓 Theme</button>;
}

function Shell() {
  const { user, tier, signOut } = useAuth();
  const nav = useNavigate();
  const links = [
    { to: "/journal", label: "📓 Daily Journal" },
    { to: "/trades", label: "📊 All Trades" },
    { to: "/performance", label: "📈 Performance" },
    { to: "/settings", label: "⚙️ Settings" },
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Trade<span>Desk</span></div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}>
            {l.label}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          <div style={{ marginBottom: 10 }}>
            {tier === "pro" ? <span className="badge-pro">PRO</span> : <span className="pill">Free</span>}
          </div>
          <div style={{ marginBottom: 8, wordBreak: "break-all" }}>{user?.email}</div>
          <div style={{ marginBottom: 8 }}><ThemeToggle /></div>
          <button style={{ width: "100%" }} onClick={async () => { await signOut(); nav("/login"); }}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/journal" element={<DailyJournal />} />
          <Route path="/trades" element={<AllTrades />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/journal" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const { session, loading } = useAuth();
  if (loading) return <div className="auth-wrap">Loading…</div>;
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
