import { supabase } from "./supabase";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      const d = j.detail ?? j.message ?? j.error;
      if (typeof d === "string") detail = d;
      else if (Array.isArray(d)) detail = d.map((x) => x?.msg || (typeof x === "string" ? x : JSON.stringify(x))).join("; ");
      else if (d) detail = JSON.stringify(d);
    } catch {}
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // trades
  listTrades: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request("GET", `/api/trades${q ? "?" + q : ""}`);
  },
  createTrade: (t) => request("POST", "/api/trades", t),
  updateTrade: (id, t) => request("PUT", `/api/trades/${id}`, t),
  deleteTrade: (id) => request("DELETE", `/api/trades/${id}`),
  uploadImage: (dataUrl) => request("POST", "/api/trades/upload", { data: dataUrl }),

  // stats
  stats: () => request("GET", "/api/stats"),

  // daylogs
  listDaylogs: () => request("GET", "/api/daylogs"),
  getDaylog: (date) => request("GET", `/api/daylog?date=${encodeURIComponent(date)}`),
  saveDaylog: (log) => request("PUT", "/api/daylog", log),

  // exchange
  getExchange: (exchange = "delta") => request("GET", "/api/exchange?exchange=" + encodeURIComponent(exchange)),
  saveExchange: (e) => request("POST", "/api/exchange", e),
  price: (symbol) => request("GET", `/api/price?symbol=${encodeURIComponent(symbol)}`),
  deltaToday: () => request("GET", "/api/delta/today"),

  // subscription (Razorpay)
  subStatus: () => request("GET", "/api/subscription/status"),
  checkout: (plan, currency) => request("POST", "/api/subscription/checkout", { plan, currency }),
  verifyPayment: (payload) => request("POST", "/api/subscription/verify", payload),
};
