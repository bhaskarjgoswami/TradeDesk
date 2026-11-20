import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";

// The signed-in journal is the vanilla app at /app. This React app only serves the
// public pages (landing, legal, auth confirmation) and the billing screen that the
// journal embeds (cloud/EmbeddedBilling).
const AuthConfirm = lazy(() => import("./pages/AuthConfirm"));
const Landing = lazy(() => import("./pages/Landing"));
const Legal = lazy(() => import("./pages/Legal"));
const LEGAL_PAGES = ["terms", "privacy", "refunds", "contact"];

const PageLoading = () => <div className="page-loading" role="status">Loading…</div>;

// Old in-app routes from the earlier React journal now live in /app.
const LEGACY_TARGETS = {"/billing":"/app#billing","/subscription":"/app#billing","/feedback":"/app#feedback","/settings":"/app#settings","/playbook":"/app#edge","/performance":"/app#performance","/journal":"/app","/trades":"/app","/login":"/app"};

export default function App() {
  const { session, loading } = useAuth();
  const loc = useLocation();
  if (loc.pathname === "/auth/confirm") return <ErrorBoundary><Suspense fallback={<PageLoading />}><AuthConfirm /></Suspense></ErrorBoundary>;
  const target = LEGACY_TARGETS[loc.pathname];
  if (target) { window.location.replace(target.replace("/app", "/app" + (loc.search.includes("mode=signup") ? "?signup=1" : ""))); return null; }
  // Legal pages are public and render the same for signed-in users.
  const legal = LEGAL_PAGES.find((p) => loc.pathname === "/" + p);
  if (legal) return <ErrorBoundary><Suspense fallback={<PageLoading />}><Legal page={legal} /></Suspense></ErrorBoundary>;
  if (loading) return <PageLoading />;
  // Signed-in visitors go straight to their journal.
  if (session) { window.location.replace("/app"); return null; }
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
