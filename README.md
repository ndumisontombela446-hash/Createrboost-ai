# CreateBoost AI + Paystack starter

This starter adds server-side Paystack checkout to the CreateBoost AI prototype.

## What is wired up
- Quick Start Pack: one-off R99 checkout (ZAR 9900 cents).
- Content Starter: monthly subscription using `PAYSTACK_PLAN_STARTER`.
- Content Plus: monthly subscription using `PAYSTACK_PLAN_PLUS`.
- Server-side transaction initialization and verification.
- Signed Paystack webhook endpoint at `/api/payments/webhook`.
- Orders are written to a local JSON file for prototype testing.

## Important limitations before launch
- This is a starter, not production-ready billing infrastructure. JSON file storage is not suitable for multiple instances or high-volume production; replace it with a database.
- User login and admin roles from the HTML are still local demo-only. They are not secure, and this project does not yet grant paid features based on verified orders.
- Use HTTPS in deployment and set `APP_BASE_URL` to the exact public HTTPS origin.
- Create recurring plans in Paystack Dashboard and configure their plan codes. Do not assume subscription checkout works until plan codes are set and tested.
- Test with Paystack test keys first. Switch to live keys only after completing test transactions, webhook verification, refund/cancellation policies, and security review.

## Run locally
Requires Node.js 18 or newer.

1. Copy `.env.example` to `.env`.
2. Fill in `PAYSTACK_SECRET_KEY` with a Paystack **test** secret key. Keep it on the server only.
3. Create monthly plans in Paystack Dashboard with the same amounts/currency as the site, then fill in the two plan codes. If not configured, monthly checkout intentionally returns an error.
4. Install dependencies: `npm install`
5. Start: `npm start`
6. Open `http://localhost:3000`.

## Paystack dashboard setup
- Add your deployed callback URL if needed; this app passes a callback URL per transaction.
- Set webhook URL to `https://YOUR-DOMAIN.example/api/payments/webhook`.
- Use the same Paystack integration for test transactions and test keys.

## Security
- Never paste secret keys into chat, HTML, frontend JavaScript, screenshots, or public repositories.
- If a secret key was exposed, rotate it in Paystack Dashboard.
- The webhook validates `x-paystack-signature` using HMAC SHA-512 and verifies successful transactions against Paystack again.
- Before production, add durable database storage, rate limiting, stronger logging, admin authentication/authorization, order idempotency, and paid-access provisioning after server verification.
