# NexChain API

Express 5 + MongoDB backend for NexChain, a crypto paper-trading platform. Users trade with virtual money against live Binance prices: market buys and sells, limit, stop and OCO orders, price alerts, a leaderboard and KYC. Admins manage users, coins and feedback.

## Requirements

- Node.js 20 or newer
- MongoDB **running as a replica set**. Trades use multi-document transactions, which a standalone `mongod` doesn't support. MongoDB Atlas (free tier is fine) is a replica set by default. Locally, either:
  - `mongod --replSet rs0`, then run `rs.initiate()` once in `mongosh`, or
  - use Atlas for development too.

## Setup

```bash
npm install
cp .env.example .env     # then fill it in (see below)
npm run seed             # optional: local superadmin, admin and test user (password: Password123)
npm run dev              # http://localhost:4001
```

### Environment variables

`.env.example` documents each one. The server refuses to start without the **required** ones:

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URI` | yes | Replica-set connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | yes | Access and refresh token signing; must differ. Generate with `openssl rand -hex 32` |
| `OTP_SECRET` | yes | Email verification codes |
| `TOTP_ENC_KEY` | yes | Encrypts stored 2FA secrets. Changing it invalidates everyone's 2FA enrollment |
| `CLIENT_URL`, `CORS_ORIGINS` | prod | Frontend origin(s) allowed by CORS; also used in email links |
| `EMAIL_USER`, `EMAIL_PASS`, `SMTP_*` | for email | OTP, password reset and alert emails (Gmail needs an App Password) |
| `SUPPORT_EMAIL` | no | Inbox for "Contact support" (defaults to `EMAIL_USER`) |
| `GOOGLE_CLIENT_ID` | for Google login | Must equal the frontend's `VITE_GOOGLE_CLIENT_ID` |
| `CLOUDINARY_*` | **prod** | Avatars and private KYC documents. Without it files go to local disk, which Render wipes on every deploy |
| `GEMINI_API_KEY` | no | AI chat assistant |
| `CRYPTO_COMPARE_API_KEY` | no | News feed rate limit |
| `ENGINE_ENABLED` | no | `false` runs the API without the order engine |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | Start with / without auto-reload |
| `npm test` | Jest + Supertest against an in-memory MongoDB replica set |
| `npm run lint` | ESLint |
| `npm run seed` | Create local dev accounts (refuses `NODE_ENV=production`) |
| `npm run audit:balances` | **Read-only** report of data left by the pre-hardening exploits (negative amounts, spoofed symbols, OCO double refunds) |
| `npm run migrate:orders` | One-time fix-up of open orders from before the order-lock change. Dry run by default; add `-- --apply` to write |

## How it fits together

- **Routes → controllers → services.** Every route that touches user data uses `protect` (JWT + token version check against the database). User-scoped actions always use the logged-in user, never a `user_id` from the request. Admin routes add `adminOnly`, and destructive admin actions also require a 2FA code (`requireAdmin2FA`).
- **Prices** come from `services/tradingEngine.js`: one Binance WebSocket with REST fallbacks. The price symbol for a trade is always derived from the coin id on the server (`services/coinRegistry.js`).
- **Money moves** happen inside MongoDB transactions (`utils/transactionHelpers.js`), with atomic balance updates. An order is claimed and filled in the same transaction, so it can never fill twice.
- **Background jobs** (order matching every 5 s, symbol sync every 30 s, hourly portfolio snapshots) run in the web process. Run **exactly one instance** with the engine enabled.
- **Sessions:** 15-minute access tokens plus a 30-day httpOnly refresh cookie that rotates on use. Logout, password changes, freezes and role changes revoke every session by bumping `tokenVersion`.

## Deploying (Render)

`render.yaml` is a Render Blueprint for the web service:

1. Create the service from the blueprint and fill in the `sync: false` variables. The JWT/OTP/TOTP secrets are generated for you.
2. Set `CLIENT_URL` (and `CORS_ORIGINS` if there are several origins) to the deployed frontend URL.
3. Atlas: create a dedicated database user, allow Render's outbound IPs (or `0.0.0.0/0` with a strong password), and turn on backups.
4. Keep one instance. The health check is `GET /api/health`, which returns 503 when the database is unreachable. Deploys send SIGTERM, and the server finishes in-flight work before exiting.

Before the first production deploy of this hardened version: back up the database, run `npm run audit:balances`, then `npm run migrate:orders` (review the dry run, then `-- --apply`). Everyone will need to log in once, because the token format changed.
