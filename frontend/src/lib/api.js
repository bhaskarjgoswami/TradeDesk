import { supabase } from "./supabase";
import { config } from "./config";

const BASE = config.apiUrl;

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  const send = () => fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let res;
  try {
    res = await send();
  } catch (e) {
    // A dropped connection (e.g. while the API redeploys) surfaces as a TypeError.
    // Retry reads once; never writes, which could otherwise be applied twice.
    if (method !== "GET") throw new Error("Network error, please check your connection and try again.");
    await new Promise((r) => setTimeout(r, 800));
    try { res = await send(); }
    catch { throw new Error("Can't reach the server right now. Please try again in a moment."); }
  }
  if (res.status === 401) {
    await supabase.auth.signOut().catch(() => {});
    throw Object.assign(new Error("Your session expired. Please sign in again."), { status: 401 });
  }
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
  pageTrades: (params) => request("GET", `/api/trades/page?${new URLSearchParams(params)}`),
  analytics: () => request("GET", "/api/trades/analytics"),
  createTrade: (t) => request("POST", "/api/trades", t),
  updateTrade: (id, t) => request("PUT", `/api/trades/${id}`, t),
  deleteTrade: (id) => request("DELETE", `/api/trades/${id}`),
  uploadImage: (dataUrl) => request("POST", "/api/trades/upload", { data: dataUrl }),
  reviewOptions: () => request("GET", "/api/trades/review-options"),
  importTrades: (rows, dryRun) => request("POST", "/api/trades/import", { rows, dry_run: dryRun }),
  imageUrls: (paths) => request("POST", "/api/trades/image-urls", { paths }),

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
  // date = journal day to import (YYYY-MM-DD, local); tz lets the server bucket fills by the user's day
  deltaToday: (date) =>
    request("GET", `/api/delta/today?tz=${new Date().getTimezoneOffset()}${date ? "&date=" + encodeURIComponent(date) : ""}`),

  // playbooks
  listPlaybooks: () => request("GET", "/api/playbooks"),
  createPlaybook: (p) => request("POST", "/api/playbooks", p),
  updatePlaybook: (id, p) => request("PUT", `/api/playbooks/${id}`, p),
  deletePlaybook: (id) => request("DELETE", `/api/playbooks/${id}`),

  // account
  exportAccount: () => request("GET", "/api/account/export"),
  deleteAccount: () => request("DELETE", "/api/account"),

  // subscription (Razorpay)
  subStatus: () => request("GET", "/api/subscription/status"),
  checkout: (plan, currency) => request("POST", "/api/subscription/checkout", { plan, currency }),
  verifyPayment: (payload) => request("POST", "/api/subscription/verify", payload),
};
