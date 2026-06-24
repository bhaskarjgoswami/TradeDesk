// Shared SVG icons + date helpers, mirroring the original Trade Journal design.

export const Icon = {
  book: (
    <svg className="hi" viewBox="0 0 24 24"><path d="M6 3.5h11A1.5 1.5 0 0 1 18.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6z" /><path d="M6 3.5v17" /><path d="M9.5 8h6M9.5 12h4" /></svg>
  ),
  folder: (
    <svg className="hi" viewBox="0 0 24 24"><path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h3.2l2 2H19A1.5 1.5 0 0 1 20.5 9v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z" /></svg>
  ),
  chart: (
    <svg className="hi" viewBox="0 0 24 24"><path d="M4 4v15.5a.5.5 0 0 0 .5.5H20" /><path d="M7.5 15l3.2-4 3 2.2L20 7" /></svg>
  ),
  gear: (
    <svg className="hi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>
  ),
  search: (
    <svg className="hi" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
  ),
  bell: (
    <svg className="hi" viewBox="0 0 24 24"><path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 5.5 1.8 5.5H4.2S6 14 6 9.5" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
  ),
  moon: (
    <svg className="hi" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /></svg>
  ),
  sun: (
    <svg className="hi" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" /><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" /></svg>
  ),
  menu: (
    <svg className="hi" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  ),
};

// ---- pre-trade checklist template (persisted in localStorage, like the original) ----
const CHECKLIST_DEFAULT = [
  "High time frame bias",
  "Liquidity take",
  "Low Time frame bias sync with HTF",
  "LTF CHoCH",
  "Candle high/low cross confirmation",
];
export function loadChecklist() {
  try {
    const s = JSON.parse(localStorage.getItem("tj_checklist"));
    return Array.isArray(s) && s.length ? s : CHECKLIST_DEFAULT.slice();
  } catch { return CHECKLIST_DEFAULT.slice(); }
}
export function saveChecklist(list) {
  localStorage.setItem("tj_checklist", JSON.stringify(list));
}

export const TODAY = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local

export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
export function fmtDateLong(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
