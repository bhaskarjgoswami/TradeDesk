from dotenv import load_dotenv
import os

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]
DATABASE_URL = os.environ["DATABASE_URL"]

# ── Razorpay ──────────────────────────────────────────────
# Works for India + international (enable "International Payments" in the
# Razorpay dashboard). One-time period payments — no auto-renew.
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
# Region pricing in the smallest currency unit (paise for INR, cents for USD).
# India: ₹199/mo, ₹1,990/yr.  International: $9/mo, $90/yr.
RAZORPAY_PRICE_INR_MONTHLY = int(os.environ.get("RAZORPAY_PRICE_INR_MONTHLY", "19900"))
RAZORPAY_PRICE_INR_ANNUAL = int(os.environ.get("RAZORPAY_PRICE_INR_ANNUAL", "199000"))
RAZORPAY_PRICE_USD_MONTHLY = int(os.environ.get("RAZORPAY_PRICE_USD_MONTHLY", "900"))
RAZORPAY_PRICE_USD_ANNUAL = int(os.environ.get("RAZORPAY_PRICE_USD_ANNUAL", "9000"))

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
PORT = int(os.environ.get("PORT", "8787"))
