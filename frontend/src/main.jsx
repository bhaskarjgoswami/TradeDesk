import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { FeedbackProvider } from "./lib/feedback";
import App from "./App";
import "./styles.css";

// restore theme
const saved = localStorage.getItem("td_theme");
if (saved) document.documentElement.setAttribute("data-theme", saved);

try { sessionStorage.removeItem("td_chunk_reload"); } catch {}

// Installable app + offline shell (production only; dev uses Vite's HMR).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
