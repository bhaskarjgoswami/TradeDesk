import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import App from "./App";
import "./styles.css";

// restore theme
const saved = localStorage.getItem("td_theme");
if (saved) document.documentElement.setAttribute("data-theme", saved);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
