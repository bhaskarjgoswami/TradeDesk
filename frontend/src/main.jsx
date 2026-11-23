import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { FeedbackProvider } from "./lib/feedback";
import App from "./App";
import "./styles.css";
import { config } from "./lib/config";
import { installErrorReporter } from "./lib/errorReporter";
import { registerServiceWorker } from "./lib/registerServiceWorker";

if (import.meta.env.PROD) installErrorReporter(config.apiUrl);

// restore theme (storage can throw in private mode or with site data blocked)
try {
  const saved = localStorage.getItem("td_theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
} catch {}

try { sessionStorage.removeItem("td_chunk_reload"); } catch {}

// Installable app + offline shell (production only; dev uses Vite's HMR).
if (import.meta.env.PROD) registerServiceWorker();

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
