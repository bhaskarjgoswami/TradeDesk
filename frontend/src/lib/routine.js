// Pre-market routine: up to 6 steps ticked off each trading day.
// Definition + today's progress live in user prefs (Supabase user_metadata).
export const MAX_STEPS = 6;

export const ROUTINE_DEFAULT = {
  enabled: true,
  popup: false,       // open as a popup when the app starts and steps are unchecked
  resetTime: "00:00", // the routine "day" starts here (e.g. 06:00 for an early session)
  steps: [
    { title: "Check the economic calendar", link: "" },
    { title: "Mark HTF levels and liquidity", link: "" },
    { title: "Write today's bias and plan", link: "" },
    { title: "Set max loss for the day", link: "" },
  ],
};

export function normalizeRoutine(r) {
  const base = { ...ROUTINE_DEFAULT, ...(r && typeof r === "object" ? r : {}) };
  const steps = Array.isArray(base.steps) ? base.steps : ROUTINE_DEFAULT.steps;
  return {
    ...base,
    resetTime: /^\d{2}:\d{2}$/.test(base.resetTime) ? base.resetTime : "00:00",
    steps: steps
      .map((s) => ({ title: String(s?.title || "").trim().slice(0, 140), link: safeLink(s?.link) }))
      .filter((s) => s.title)
      .slice(0, MAX_STEPS),
  };
}

// Only http(s) links, so a saved step can never run script.
export function safeLink(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^[a-z]+:/i.test(s) ? s : "https://" + s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch { return ""; }
}

// The routine day: before resetTime it still counts as the previous day.
export function routineDay(resetTime = "00:00", now = new Date()) {
  const [h, m] = resetTime.split(":").map(Number);
  const d = new Date(now);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}

// Titles checked today (progress from an earlier day doesn't count).
export function doneToday(progress, routine, now = new Date()) {
  if (!progress || progress.day !== routineDay(routine.resetTime, now)) return [];
  const titles = new Set(routine.steps.map((s) => s.title));
  return (progress.done || []).filter((t) => titles.has(t));
}
