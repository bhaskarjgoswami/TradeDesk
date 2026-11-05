# TradeDesk authentication emails

These templates use TradeDesk's purple branding, subjects, and email copy. They preserve Supabase's generated verification links and OTP values. They contain no provider-branding footer.

## Hosted setup required

Changing repository files or redeploying Vercel does **not** update hosted Supabase Auth.

1. Open Supabase → Authentication → URL Configuration.
   - Site URL: `https://trade-desk-dl66.vercel.app/app`
   - Add redirect URLs `https://trade-desk-dl66.vercel.app/auth/confirm` and `https://trade-desk-dl66.vercel.app/app`.
   - Keep email confirmation enabled.
2. In Authentication → Email → Templates, paste the matching HTML file and set the subjects listed by the setup utility.
3. Configure custom SMTP with your verified sending domain. Set Sender name to **TradeDesk**. The default Supabase mail service can retain its sender address/provider footer; a verified custom sender is needed to replace it.
4. Request a fresh confirmation email. Emails already delivered keep their old links, and expired/used links cannot be renewed by changing the redirect URL.

Alternatively, add a Supabase Management API access token with auth-configuration permissions as `SUPABASE_ACCESS_TOKEN` in the ignored `backend/.env` file, then run:

```sh
backend/.venv/bin/python backend/scripts/configure_auth_email.py
backend/.venv/bin/python backend/scripts/configure_auth_email.py --apply --site-url https://trade-desk-dl66.vercel.app/app
```

The first command previews the subjects without changing hosted settings. The second updates templates, the sender name, Site URL, and exact callback allow-list entries. It preserves existing redirect entries and all unrelated authentication settings. It verifies the saved branding and keeps a private, ignored backup. It never sends email or configures unverified SMTP credentials. A database service-role key cannot replace the Management API token.

After setup, verify one new signup, the Check your email card, a fresh confirmation returning to sign-in, resend, and password reset. Old verification links may still lead to localhost and must be replaced.

References: https://supabase.com/docs/guides/auth/auth-email-templates and https://supabase.com/docs/guides/auth/redirect-urls
