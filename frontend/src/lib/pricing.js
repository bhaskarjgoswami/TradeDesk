// Prices shown to the user. Keep in sync with backend RAZORPAY_PRICE_* config.
// Shared by the billing cards and the public landing page.
export const PRICING = {
  INR: {
    monthly: { amt: "₹99", unit: ["INR / 30 days", "one-time payment"], desc: "Pro, 30 days" },
    annual: { amt: "₹699", unit: ["INR / 365 days", "one-time payment"], desc: "Pro, 365 days" },
  },
  USD: {
    monthly: { amt: "$9", unit: ["USD / 30 days", "one-time payment"], desc: "Pro, 30 days" },
    annual: { amt: "$90", unit: ["USD / 365 days", "2 months free"], desc: "Pro, 365 days" },
  },
};

// Signed-out visitors can preview either currency. Signed-in accounts see the currency the
// server will charge, which comes from the Account country (INR is for India only).
export function defaultCurrency() {
  try {
    const saved = localStorage.getItem("tradedesk_billing_currency");
    if (["USD", "INR"].includes(saved)) return saved;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return tz === "Asia/Kolkata" || tz === "Asia/Calcutta" ? "INR" : "USD";
  } catch { return "USD"; }
}
