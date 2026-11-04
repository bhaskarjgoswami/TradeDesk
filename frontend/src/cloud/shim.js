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

let imageSessionVersion = 0;
async function setImageCookie(session) {
  const version = ++imageSessionVersion;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  if (!session) {
    document.cookie = `td_img=; Path=/images; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  try {
    const response = await fetch(API + "/api/media-session", {method:"POST",headers:{Authorization:`Bearer ${session.access_token}`}});
    if (!response.ok) throw new Error("Image session unavailable");
    const data = await response.json();
    if (version !== imageSessionVersion) return;
    document.cookie = `td_img=${data.token}; Path=/images; Max-Age=300; SameSite=Lax${secure}`;
    // Retry images that loaded before the scoped credential was ready.
    document.querySelectorAll('img[src^="/images/"]').forEach(img => { if (!img.complete || !img.naturalWidth) img.src = img.getAttribute("src"); });
  } catch { /* A later renewal retries without exposing the access token. */ }
}
setInterval(() => { if (!document.hidden) supabase.auth.getSession().then(({data})=>setImageCookie(data.session)); }, 240000);

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
  const upgrade = document.getElementById("sidebarMemberUpgrade");
  plan.textContent = "Loading plan…";
  detail.textContent = "Membership details";
  upgrade.hidden = true;
  try {
    const membership = await api.subStatus();
    if (revision !== sidebarMemberRevision) return;
    const pro = membership.tier === "pro";
    plan.textContent = pro ? "TradeDesk Pro" : "TradeDesk Free";
    detail.textContent = pro ? "Unlimited daily trades" : "Up to 2 trades per day";
    upgrade.hidden = pro;
    card.title = `${plan.textContent} · ${detail.textContent}`;
    card.setAttribute("aria-label", pro ? "TradeDesk Pro: view plan and billing" : "Upgrade your TradeDesk Free account");
  } catch {
    if (revision !== sidebarMemberRevision) return;
    sidebarMemberUser = null;
    plan.textContent = "Plan & billing";
    detail.textContent = "View membership details";
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
      if (!data.session) return json({ ok:true, confirmation_required:true, message: "Account created. Check your email to confirm it, then sign in." });
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
    if (path === "/api/trades" && method === "GET") {
      const search = new URLSearchParams(url.split("?")[1] || "");
      search.set("limit","500");
      const rows=[];
      while (true) {
        const page = await nativeFetch(API + "/api/trades/page?" + search, {...init,headers});
        if (!page.ok) { if(page.status===401)window.sessionExpired?.(); return page; }
        const data=await page.json();
        rows.push(...data.rows);
        if (!data.next_cursor) break;
        search.set("before_id",data.next_cursor);
      }
      rows.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")) || b.id-a.id);
      return json(rows);
    }
    res = await nativeFetch(API + url, { ...init, headers });
  } catch (e) {
    if (path === "/api/trades" && method === "GET") return json({error:"Could not load your journal. Please try again."},503);
    if (method !== "GET") throw e; // never retry writes
    await new Promise((r) => setTimeout(r, 800)); // API redeploying: retry reads once
    res = await nativeFetch(API + url, { ...init, headers });
  }
  if (res.status === 401) {
    window.sessionExpired?.();
    return json({error:"Your session expired. Sign in again to continue; your unsaved form has been kept."},401);
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
    queueMicrotask(showPasswordRecovery);

  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) supabase.auth.getSession().then(({ data }) => refreshSidebarMembership(data.session, true));
});
window.__td.resolve({ handle, deleteAccount:async()=>{await api.deleteAccount();await supabase.auth.signOut();location.reload();} });


function showPasswordRecovery() {
  if (document.getElementById("passwordRecovery")) return;
  const dialog=document.createElement("dialog");
  dialog.id="passwordRecovery";
  dialog.setAttribute("aria-labelledby","recoveryTitle");
  dialog.style.cssText="border:1px solid #e3e1f1;border-radius:24px;padding:32px;width:min(420px,calc(100vw - 32px));color:#29283e;background:white;font-family:var(--font-ui,Inter,sans-serif)";
  dialog.innerHTML=`<form><h2 id="recoveryTitle" style="margin:0 0 12px">Set a new password</h2><p>Choose at least 8 characters for your TradeDesk account.</p><label for="recoveryPassword">New password</label><input id="recoveryPassword" type="password" autocomplete="new-password" required minlength="8" style="box-sizing:border-box;width:100%;height:42px;border-radius:32px;border:1px solid #e3e1f1;padding:0 16px;margin:8px 0 16px;font:inherit"><label for="recoveryConfirm">Confirm password</label><input id="recoveryConfirm" type="password" autocomplete="new-password" required minlength="8" style="box-sizing:border-box;width:100%;height:42px;border-radius:32px;border:1px solid #e3e1f1;padding:0 16px;margin:8px 0 16px;font:inherit"><p role="status" aria-live="polite" id="recoveryStatus"></p><button type="submit" style="height:42px;width:100%;border-radius:40px;background:#605cf3;color:white;border:0;font:inherit">Update password</button></form>`;
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector("form").onsubmit=async event=>{
    event.preventDefault();
    const password=dialog.querySelector("#recoveryPassword").value;
    const status=dialog.querySelector("#recoveryStatus"),button=dialog.querySelector("button");
    if(password!==dialog.querySelector("#recoveryConfirm").value){status.textContent="Passwords do not match.";return;}
    button.disabled=true;
    const {error}=await supabase.auth.updateUser({password});
    button.disabled=false;
    if(error){status.textContent=error.message;return;}
    dialog.close();dialog.remove();
    const notice=document.getElementById("loginErr");if(notice)notice.textContent="Password updated. You can continue to your journal.";
  };
  dialog.addEventListener("close",()=>dialog.remove());
}

document.addEventListener("visibilitychange",()=>{if(!document.hidden)supabase.auth.getSession().then(({data})=>setImageCookie(data.session));});
