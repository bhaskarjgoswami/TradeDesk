// TradeDesk cloud shim for the journal UI at /app (see public/cloud-boot.js).
// The UI is the local desktop app's own code. This module:
//   - answers /api/session, /api/login, /api/logout with Supabase Auth
//   - forwards every other /api/* call to the TradeDesk API (/j/api/*) with the token
//   - keeps a short-lived td_img cookie so <img src="/images/..."> works (Vercel proxies it)
//   - adds sign-up and password reset to the existing login card, and the TradeDesk brand
import { supabase } from "../lib/supabase";
import { config } from "../lib/config";
import { api } from "../lib/api";
import { SUPPORT_EMAIL } from "../lib/brand";

const API = config.apiUrl + "/j";
let mode = new URLSearchParams(location.search).has("signup") ? "signup" : "login";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

function setImageCookie(session) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = session
    ? `td_img=${session.access_token}; Path=/images; Max-Age=3600; SameSite=Lax${secure}`
    : `td_img=; Path=/images; Max-Age=0; SameSite=Lax${secure}`;
}

let sidebarMemberUser = null;
let sidebarMemberRevision = 0;
async function refreshSidebarMembership(session, force = false) {
  const card = document.getElementById("sidebarMembership");
  if (!card) return;
  card.hidden = !session;
  if (!session) { sidebarMemberUser = null; sidebarMemberRevision++; return; }
  if (sidebarMemberUser === session.user.id && !force) return;
  sidebarMemberUser = session.user.id;
  const revision = ++sidebarMemberRevision;
  const plan = document.getElementById("sidebarMemberPlan");
  const detail = document.getElementById("sidebarMemberDetail");
  const status = document.getElementById("sidebarMemberStatus");
  const upgrade = document.getElementById("sidebarMemberUpgrade");
  plan.textContent = "Loading plan…";
  detail.textContent = "Membership details";
  status.textContent = "";
  upgrade.hidden = true;
  try {
    const membership = await api.subStatus();
    if (revision !== sidebarMemberRevision) return;
    const pro = membership.tier === "pro";
    plan.textContent = pro ? "TradeDesk Pro" : "TradeDesk Free";
    detail.textContent = pro ? "Unlimited daily trades" : "Up to 2 trades per day";
    status.textContent = "Current plan";
    upgrade.hidden = pro;
    card.title = `${plan.textContent} · ${detail.textContent}`;
    card.setAttribute("aria-label", pro ? "TradeDesk Pro: view plan and billing" : "Upgrade your TradeDesk Free account");
  } catch {
    if (revision !== sidebarMemberRevision) return;
    sidebarMemberUser = null;
    plan.textContent = "Plan & billing";
    detail.textContent = "View membership details";
    status.textContent = "View plan";
    upgrade.hidden = true;
    card.title = "View plan and billing";
    card.setAttribute("aria-label", "View plan and billing");
  }
}

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

async function handle(url, init, nativeFetch) {
  const path = url.split("?")[0];
  const method = (init.method || "GET").toUpperCase();

  if (path === "/api/session") {
    const { data } = await supabase.auth.getSession();
    return json(data.session ? { authed: true, email: data.session.user.email } : { authed: false });
  }
  if (path === "/api/login" && method === "POST") {
    const { email, password, name } = JSON.parse(init.body || "{}");
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: String(name || "").trim().slice(0, 100) } } });
      if (error) return json({ error: error.message }, 400);
      if (!data.session) return json({ error: "Account created. Check your email to confirm it, then sign in." }, 400);
      return json({ ok: true });
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? json({ error: error.message === "Invalid login credentials" ? "Invalid email or password" : error.message }, 401) : json({ ok: true });
  }
  if (path === "/api/logout") {
    await supabase.auth.signOut();
    return json({ ok: true });
  }

  const t = await token();
  if (!t) return json({ error: "unauthorized" }, 401);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${t}`);
  let res;
  try {
    res = await nativeFetch(API + url, { ...init, headers });
  } catch (e) {
    if (method !== "GET") throw e; // never retry writes
    await new Promise((r) => setTimeout(r, 800)); // API redeploying: retry reads once
    res = await nativeFetch(API + url, { ...init, headers });
  }
  return res;
}

// ── login card: sign-up toggle, password reset, brand ──
function decorate() {
  const card = document.querySelector("#loginScreen .login-left");
  if (!card || card.dataset.td) return;
  card.dataset.td = "1";
  document.title = "TradeDesk";
  document.querySelectorAll(".brandtxt").forEach((el) => { el.textContent = "TradeDesk"; });
  const foot = card.querySelector(".login-foot");
  if (foot) foot.innerHTML = `Need help? Contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> · <a href="/">Home</a>`;

  const h1 = card.querySelector("h1"), sub = card.querySelector(".sub"), btn = card.querySelector(".login-btn");
  const btnIcon = btn?.querySelector("svg")?.outerHTML || "";
  const toggle = card.querySelector("#authModePrompt") || document.createElement("div");
  toggle.id = "authModePrompt";
  toggle.className = "td-mode";
  if (!toggle.isConnected) card.querySelector("#loginForm")?.after(toggle);
  const render = () => {
    const up = mode === "signup";
    const nameField = document.getElementById("loginNameField");
    const nameInput = document.getElementById("loginName");
    const passwordInput = document.getElementById("loginPass");
    if (nameField) nameField.hidden = !up;
    if (nameInput) nameInput.required = up;
    if (passwordInput) { passwordInput.autocomplete = up ? "new-password" : "current-password"; passwordInput.minLength = up ? 8 : 1; }
    const resetLink = card.querySelector(".forgot");
    if (resetLink) resetLink.hidden = up;
    if (h1) h1.textContent = up ? "Get started" : "Welcome back";
    if (sub) sub.textContent = up ? "Create your account to start journaling." : "Sign in to continue your trading journal.";
    if (btn) btn.innerHTML = (up ? "Sign up " : "Sign in ") + btnIcon;
    toggle.innerHTML = up
      ? 'Already have an account? <a href="#" data-m="login">Sign in</a><br><span>By creating an account you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</span>'
      : 'New to TradeDesk? <a href="#" data-m="signup">Sign up</a>';
    const err = document.getElementById("loginErr"); if (err) err.textContent = "";
  };
  toggle.addEventListener("click", (e) => {
    const m = e.target.closest("[data-m]")?.dataset.m;
    if (m) { e.preventDefault(); mode = m; render(); }
  });
  const forgot = card.querySelector(".forgot");
  if (forgot) {
    forgot.removeAttribute("onclick");
    forgot.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail")?.value.trim();
      const err = document.getElementById("loginErr");
      if (!email) { err.textContent = "Enter your email first, then tap Forgot password."; return; }
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app" });
      err.textContent = error ? error.message : "Password reset link sent. Check your email.";
    });
  }
  render();


}

const style = document.createElement("style");
style.textContent = ".login-left .forgot[hidden]{display:none}";
document.head.appendChild(style);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", decorate); else decorate();

supabase.auth.getSession().then(({ data }) => { setImageCookie(data.session); refreshSidebarMembership(data.session); });
supabase.auth.onAuthStateChange((event, session) => {
  setImageCookie(session);
  refreshSidebarMembership(session);
  if (event === "PASSWORD_RECOVERY") {
    // Arrived from the reset email: choose a new password before continuing.
    setTimeout(async () => {
      const pw = window.prompt("Choose a new password (at least 8 characters):");
      if (!pw || pw.length < 8) return;
      const { error } = await supabase.auth.updateUser({ password: pw });
      window.alert(error ? "Couldn't update the password: " + error.message : "Password updated.");
    }, 300);
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) supabase.auth.getSession().then(({ data }) => refreshSidebarMembership(data.session, true));
});
window.__td.resolve({ handle });
