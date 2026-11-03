import { api } from "./api";

// Review choices come from the server (single source of truth); fetched once.
let cached;
export function loadReviewOptions() {
  cached = cached || api.reviewOptions().catch(() => { cached = null; return { mistakes: [], emotions: [] }; });
  return cached;
}
export const QUALITIES = ["A+", "A", "B", "C", "F"];
