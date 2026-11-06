// Only publish a support address after the mailbox is configured.
export const BRAND = "TradeDesk";
export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || "";
export const SUPPORT_URL = SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : "/contact";
export const SUPPORT_LABEL = SUPPORT_EMAIL || "Contact support";
export const LEGAL_UPDATED = "5 November 2026";
