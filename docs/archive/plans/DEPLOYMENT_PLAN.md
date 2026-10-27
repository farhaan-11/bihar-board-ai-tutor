# Zuno: Deployment Plan — Making the App Live

> **Created:** 2026-07-27
> **Goal:** Take Zuno from `localhost` to a live, public URL students can actually use.
> **Status:** Live and verified. Zuno is deployed and working end-to-end. Only Phase 10 (optional custom domain) remains.

---

## How to Use This File (Execution Protocol)

Same pattern as `PRE_LAUNCH_BLOCKERS.md` and the Focus Mode / Global Mode / Auth
stabilization work — proven to work well for this project:

1. Work through phases **in order** — each phase assumes the previous one is done.
2. Before starting a phase: explain what/why in simple terms, confirm with Farhan.
3. After finishing a phase: mark it `[x]`, verify it actually works (not just "should work"),
   then move to the next phase in a **new** conversation turn if needed.
4. If a session ends mid-phase, this file has enough detail to resume without
   re-deriving context from scratch.

`[ ]` = pending | `[~]` = in progress | `[x]` = done | `[!]` = blocked

---

## Why No Docker (For Now)

Railway and Render both auto-detect a plain Node.js / Vite project and build+deploy
it without a Dockerfile. Docker adds a real skill requirement (writing/debugging a
Dockerfile, image layers, etc.) that buys nothing for a single-service app at this
stage. It can be added later if multi-container orchestration or more deploy control
is ever needed — not a blocker for launch.

---

## Railway vs Render — Full Comparison

Both were checked live (2026-07-27). Here's a detailed side-by-side for Zuno's needs:

### Pricing (What We'd Actually Pay)

| Factor | Railway (Hobby — $5/mo) | Render (Free → Starter $7/mo) |
|--------|------------------------|-------------------------------|
| **Base cost** | $5/mo minimum (includes $5 usage credits) | Free tier available; Starter web service $7/mo |
| **How billing works** | Pay-per-second for CPU/RAM/egress. $5 credit covers light usage | Fixed instance size per month (not usage-based) |
| **Free tier** | 30-day trial with $5 credit, then $1/mo (very limited: 1 vCPU, 0.5GB RAM) | Free web service (0.1 CPU, 512MB RAM) but **spins down after 15 min inactivity** — cold start ~30-60s |
| **Estimated monthly for Zuno** | ~$3-5 (low traffic student app, most of $5 credit covers it) | $0 on free (with cold starts) or $7/mo on Starter (always-on) |
| **Egress** | $0.05/GB (first few GB usually within credits) | 5GB free, then $0.15/GB |

### Developer Experience

| Factor | Railway | Render |
|--------|---------|--------|
| **Deploy from GitHub** | Yes — connect repo, auto-deploys on push | Yes — connect repo, auto-deploys on push |
| **Monorepo support** | Yes — set root directory to `backend/` | Yes — set root directory to `backend/` |
| **Build system** | Railpack (auto-detect) or Dockerfile | Native runtimes (auto-detect) or Dockerfile |
| **Environment variables** | Dashboard UI — easy to add/edit | Dashboard UI — easy to add/edit |
| **Custom domains** | 2 free on Hobby | 2 free on Hobby |
| **Preview environments** | Yes (PR-based) | Yes (PR-based, single-service on free) |
| **Rollbacks** | 1-click rollback | 1-click rollback (5 builds retained on free) |
| **CLI tool** | Yes (Rust-based, fast) | Yes |
| **Deploy speed** | ~30-60s typical | ~60-120s typical |
| **Dashboard UX** | Modern, real-time canvas view, very intuitive | Clean but more traditional |

### Infrastructure

| Factor | Railway | Render |
|--------|---------|--------|
| **Always-on (free tier)** | Yes — no sleep/spin-down | **No** — free tier sleeps after 15 min inactivity |
| **SSL/TLS** | Automatic, free | Automatic, free |
| **Regions** | US East, US West, EU West, Southeast Asia | US (Oregon), EU (Frankfurt), Singapore |
| **Private networking** | Yes (free) | Yes (free) |
| **Health checks** | Configurable | Configurable |
| **DDoS protection** | Yes | Yes |
| **Vertical autoscaling** | Yes (automatic) | Manual (choose instance size) |
| **Log retention** | 7 days (Hobby) | 7 days (Hobby/Free) |

### What Matters for Zuno Specifically

| Zuno Need | Railway | Render |
|-----------|---------|--------|
| **Node.js backend (always-on)** | Always-on even on cheapest plan | Free tier sleeps — students would wait 30-60s for first response |
| **Vite React frontend** | Can host but not optimized for static | Better option: use **Vercel** for frontend regardless |
| **MongoDB Atlas** | No built-in Mongo (we use Atlas anyway) | Has managed Postgres but no Mongo (Atlas anyway) |
| **Redis** | No built-in Redis — use Upstash | Has "Render Key Value" (Redis-compatible, $10/mo minimum for persistence) |
| **WebSockets** | Supported | Supported |
| **CORS cross-domain** | Works fine (tested by many) | Works fine |

### My Recommendation: **Railway for Backend**

**Why Railway wins for Zuno:**

1. **No cold starts** — Even the cheapest tier keeps the server running. Render's free
   tier spins down after 15 minutes of inactivity, meaning the first student to ask a
   question after a quiet period waits 30-60 seconds. For a tutor app, that's terrible UX.

2. **Usage-based billing is perfect for a student app** — Zuno won't have constant
   high traffic. Railway charges per-second, so quiet hours cost almost nothing. The $5
   monthly credit will likely cover most/all usage. On Render, you'd pay a flat $7/mo
   for the Starter tier to avoid cold starts.

3. **Simpler scaling path** — Railway auto-scales vertically. As Zuno grows, costs
   grow proportionally without manual instance-size changes.

4. **Better DX** — Railway's real-time dashboard, instant deploys, and canvas UI make
   debugging faster.

**Frontend: Vercel regardless** — Both Railway and Render can serve static files,
but Vercel is purpose-built for Vite/React with global CDN, instant cache invalidation,
and zero config. Free tier is more than enough.

**Redis: Upstash regardless** — Cheaper than Render Key Value ($0 for 10K commands/day
on free tier vs $10/mo minimum on Render). Already referenced in our `.env.example`.

### Final Stack Decision

| Service | Provider | Plan | Estimated Cost |
|---------|----------|------|----------------|
| Backend | Railway | Hobby ($5/mo) | ~$3-5/mo |
| Frontend | Vercel | Free | $0/mo |
| Database | MongoDB Atlas | Free (M0) | $0/mo |
| Cache/Auth | Upstash Redis | Free | $0/mo |
| **Total** | | | **~$3-5/mo** |

---

## Environment Variables — Complete Reference

This is the scariest part of deployment, so here's every single env var, what it
does, where to get the value, and whether the production value should differ from
development.

### Backend Environment Variables (set in Railway dashboard)

#### Core App Config
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `PORT` | `5000` | **Don't set** — Railway auto-assigns `PORT` | Railway auto-injects | Railway sets this automatically. Your `server.js` already reads `process.env.PORT` |
| `NODE_ENV` | `development` | `production` | Railway dashboard | **Critical** — controls cookie `secure` flag, morgan log format, mailer/Redis fatal-vs-warn behavior |

#### Database
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `MONGODB_URI` | Your local/dev Atlas connection string | **Same Atlas URI** (or create a separate prod DB) | Railway dashboard | If using the same Atlas cluster, no change needed. For true production, create a separate database name (e.g. `bihar_board_ai_tutor_prod`) |

#### LLM & Embeddings
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `GEMINI_API_KEY` | Your Gemini key | **Same key** | Railway dashboard | Used for embeddings. Same key works in prod |
| `LLM_PROVIDER` | `groq` | `groq` (same) | Railway dashboard | No change needed |
| `LLM_MODEL` | `llama-3.3-70b-versatile` | Same | Railway dashboard | No change needed |
| `LLM_TEMPERATURE` | `0` | `0` | Railway dashboard | No change needed |
| `GROQ_API_KEY` | Your Groq key | **Same key** | Railway dashboard | Same key works in prod |
| `OPENAI_API_KEY` | (placeholder) | Not needed if using Groq | Skip | Only needed if `LLM_PROVIDER=openai` |
| `GOOGLE_API_KEY` | (placeholder) | Not needed if using Groq | Skip | Only needed if `LLM_PROVIDER=google` |

#### Auth — JWT (MUST CHANGE FOR PRODUCTION)
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `JWT_ACCESS_SECRET` | Dev secret | **Generate new** — `openssl rand -hex 32` | Railway dashboard | **MUST be different from dev**. Min 32 chars. Anyone with this can forge auth tokens |
| `JWT_REFRESH_SECRET` | Dev secret | **Generate new** — `openssl rand -hex 32` | Railway dashboard | **MUST be different from dev**. Min 32 chars |
| `JWT_ACCESS_EXPIRY` | `15m` | `15m` (same) | Railway dashboard | No change needed |
| `JWT_REFRESH_EXPIRY` | `7d` | `7d` (same) | Railway dashboard | No change needed |

#### Auth — Google OAuth (MUST UPDATE)
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `GOOGLE_CLIENT_ID` | Your OAuth client ID | **Same client ID** | Railway dashboard | Same Google Cloud project, same client |
| `GOOGLE_CLIENT_SECRET` | Your OAuth client secret | **Same secret** | Railway dashboard | Same client |
| `GOOGLE_CALLBACK_URL` | `http://localhost:5001/api/v1/auth/google/callback` | `https://<railway-url>/api/v1/auth/google/callback` | Railway dashboard | **MUST change** — and add this URL in Google Cloud Console → Authorized redirect URIs |

#### Auth — Email (Nodemailer)
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `EMAIL_HOST` | `smtp.gmail.com` | `smtp.gmail.com` (same) | Railway dashboard | No change |
| `EMAIL_PORT` | `587` | `587` | Railway dashboard | No change |
| `EMAIL_USER` | Your Gmail | **Same** | Railway dashboard | Same email account |
| `EMAIL_PASS` | App password | **Same app password** | Railway dashboard | Same app password works |
| `EMAIL_FROM` | `Zuno <noreply@zuno.com>` | Same | Railway dashboard | No change |

#### Redis
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `REDIS_URL` | Your Upstash URL | **Same Upstash URL** (or create separate prod instance) | Railway dashboard | Upstash is already cloud-hosted, same URL works. For true isolation, create a second Upstash database |

#### Frontend URL (MUST CHANGE)
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `FRONTEND_URL` | `http://localhost:5173` | `https://<your-app>.vercel.app` | Railway dashboard | **MUST change** — used for CORS allowlist AND email verification links. Supports comma-separated: `https://zuno.vercel.app,http://localhost:5173` (keep localhost for local dev against prod backend) |

#### Rate Limiting & Behavior
| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `GUEST_DAILY_LIMIT` | `5` | `5` (same or adjust) | Railway dashboard | Fine as-is |
| `USER_DAILY_LIMIT` | `20` | `20` (same or adjust) | Railway dashboard | Fine as-is |
| `SESSION_TOKEN_LIMIT` | `15000` | `15000` | Railway dashboard | No change |
| `GUEST_TURN_LIMIT` | `5` | `5` | Railway dashboard | No change |
| `MAX_NON_ACADEMIC_TURNS` | `10` | `10` | Railway dashboard | No change |
| `USE_INTENT_ROUTER` | `false` | `false` | Railway dashboard | Keep false until intent router is tested |
| `BCRYPT_SALT_ROUNDS` | `12` | `12` | Railway dashboard | No change |

### Frontend Environment Variables (set in Vercel dashboard)

| Variable | Dev Value | Production Value | Where to Set | Notes |
|----------|-----------|-----------------|--------------|-------|
| `VITE_API_BASE_URL` | `http://localhost:5000` | `https://<railway-backend-url>` | Vercel dashboard → Environment Variables | **MUST change** — this is how the frontend knows where the backend lives |

### How to Generate Secure Secrets

Run this in your terminal to generate random secrets for JWT:

```bash
# For JWT_ACCESS_SECRET
openssl rand -hex 32

# For JWT_REFRESH_SECRET (run again for a different value)
openssl rand -hex 32
```

If `openssl` is not available on Windows, use PowerShell:
```powershell
# Generate 32-byte random hex string
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

### Safety Checklist Before Deploying

- [ ] `.env` is in `.gitignore` (already is — double-check)
- [ ] `.env` is NOT committed in git history (`git log --all --full-history -- backend/.env` should return nothing)
- [ ] Production JWT secrets are DIFFERENT from development
- [ ] `GOOGLE_CALLBACK_URL` points to Railway URL, not localhost
- [ ] `FRONTEND_URL` points to Vercel URL, not localhost
- [ ] `VITE_API_BASE_URL` points to Railway URL, not localhost
- [ ] `NODE_ENV=production` is set in Railway

---

## Phase 1 — Prepare the Code for Production

**Status:** `[ ]` Not started

**What:** Small code/config checks so the app behaves correctly once it's not on
`localhost` anymore.

**Why:** Things that "just work" locally (like CORS allowing everything, or cookies
without `secure`) can silently break once frontend and backend are on different
real domains. Catching this now is much easier than debugging it live.

**Estimated time:** 20-30 minutes
**Difficulty:** Easy

### Checklist

- [ ] **CORS** — Already done right. `app.js:26-29` reads `FRONTEND_URL` env var, supports comma-separated origins. No code change needed — just set `FRONTEND_URL` correctly in Railway.
- [ ] **Cookie security** — Already done right. `auth.controller.js` sets `secure: true` and `sameSite: 'none'` when `NODE_ENV=production`. No code change needed.
- [ ] **Health endpoint** — Already exists at `/health`. Railway can use this for health checks.
- [ ] **`package.json` start script** — Already has `"start": "node src/server.js"`. Railway will use this automatically.
- [ ] **`trust proxy`** — Already set (`app.set('trust proxy', 1)` in `app.js:20`). Needed for Railway's reverse proxy to forward correct client IPs.
- [ ] **PORT handling** — `server.js:46` uses `env.port` which reads `process.env.PORT`. Railway injects `PORT` automatically. Works.
- [ ] **Redis fatal in production** — Already handled. `server.js:39-44` exits if Redis fails in production. Good.
- [ ] **Mailer fatal in production** — Already handled. `server.js:26-28` re-throws in production. Good.
- [ ] **Morgan logging** — `app.js:47` uses `'combined'` format in production (full Apache-style logs). Good.
- [ ] **Helmet security headers** — Already in `app.js:22`. Good.
- [ ] **Frontend `vite.config.js`** — Check it has no hardcoded localhost references.
- [ ] **Frontend API base URL** — `tutorApi.js` should read from `import.meta.env.VITE_API_BASE_URL`. Verify no hardcoded URLs.

### Expected Result
All checks pass — likely zero code changes needed. The codebase is already
production-ready from the `PRE_LAUNCH_BLOCKERS.md` work.

---

## Phase 2 — MongoDB Atlas Production Readiness

**Status:** `[x]` Completed

**What:** Make sure Railway's servers can connect to your Atlas cluster.

**Why:** Locally, your home IP is allowlisted in Atlas. Railway's servers use
dynamic IPs that aren't allowlisted — the backend will crash with a connection
timeout.

**Estimated time:** 10 minutes
**Difficulty:** Easy

### Steps

1. Go to [MongoDB Atlas](https://cloud.mongodb.com) → your cluster → **Network Access**
2. Click **Add IP Address**
3. Click **Allow Access from Anywhere** (adds `0.0.0.0/0`)
4. Confirm

**Is this safe?** Yes — your database is still protected by:
- Username/password authentication (in your `MONGODB_URI`)
- TLS encryption (Atlas enforces this)
- The `0.0.0.0/0` just means "any IP can attempt to connect" — they still need credentials

This is the standard practice for platforms like Railway, Render, Heroku, etc. that
don't have static outbound IPs. MongoDB Atlas themselves recommend this for such platforms.

**Optional (later):** If you move to Railway's Pro plan, you can use Railway's
private networking + VPC peering with Atlas for IP-restricted access. Not needed for MVP.

---

## Phase 3 — Upstash Redis Setup

**Status:** `[x]` Completed

**What:** Create a free Upstash Redis database and get the `REDIS_URL`.

**Why:** Redis is used for:
- JWT refresh token storage (auth)
- Rate limiting (via `rate-limit-redis`)
- Embedding cache (performance)

Without it, `server.js` will crash in production (`process.exit(1)` on Redis failure).

**Estimated time:** 10-15 minutes
**Difficulty:** Easy

### Steps

1. Go to [Upstash Console](https://console.upstash.com)
2. Sign up (GitHub login works)
3. Click **Create Database**
4. Name: `zuno-prod` (or whatever you want)
5. Region: **US-East-1** (closest to Railway's default US region)
6. Type: **Regional** (not Global — cheaper, sufficient for single-region)
7. Enable **TLS** (should be on by default)
8. Click **Create**
9. Copy the **Redis URL** — it looks like: `rediss://default:xxxxxx@us1-xxxx.upstash.io:6379`

**Important:** The URL starts with `rediss://` (two s's) — this means TLS-encrypted.
Our `redisClient.js` handles this correctly via `ioredis`.

### Upstash Free Tier Limits
- 10,000 commands/day
- 256MB storage
- 1 database

This is plenty for Zuno's current usage. Upgrading to Pay-as-you-go ($0.2 per 100K
commands) removes the daily limit if needed later.

---

## Phase 4 — Deploy Backend to Render

**Status:** `[x]` Completed

**What:** Connect GitHub repo to Render, configure it to deploy the `backend/`
folder, add all environment variables, deploy, and set up UptimeRobot keep-alive monitor.

**Result:** Live Public URL: `https://zuno-backend-85ea.onrender.com` (Kept always-awake 24/7 via UptimeRobot 5-min ping on `/health`).
**Difficulty:** Medium

### Steps

1. Go to [Railway](https://railway.com) → Sign up with GitHub
2. Click **New Project** → **Deploy from GitHub Repo**
3. Select the `bihar-board-ai-tutor` repository
4. Railway will auto-detect it — **before it deploys**, click on the service to configure it:

   **Settings tab:**
   - **Root Directory:** Set to `backend` (tells Railway to only look at the backend folder)
   - **Build Command:** Railway auto-detects `npm install` (fine)
   - **Start Command:** Railway uses `npm start` which runs `node src/server.js` (fine)
   - **Watch Paths:** Set to `backend/**` (only redeploy when backend code changes)

   **Variables tab — Add ALL of these:**
   ```
   NODE_ENV=production
   MONGODB_URI=<your Atlas connection string>
   GEMINI_API_KEY=<your key>
   LLM_PROVIDER=groq
   LLM_MODEL=llama-3.3-70b-versatile
   LLM_TEMPERATURE=0
   GROQ_API_KEY=<your key>
   JWT_ACCESS_SECRET=<GENERATE NEW — see "How to Generate Secure Secrets" above>
   JWT_REFRESH_SECRET=<GENERATE NEW — different from above>
   JWT_ACCESS_EXPIRY=15m
   JWT_REFRESH_EXPIRY=7d
   GOOGLE_CLIENT_ID=<your Google OAuth client ID>
   GOOGLE_CLIENT_SECRET=<your Google OAuth client secret>
   GOOGLE_CALLBACK_URL=https://<railway-url>/api/v1/auth/google/callback
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=<your email>
   EMAIL_PASS=<your app password>
   EMAIL_FROM=Zuno <noreply@zuno.com>
   REDIS_URL=<Upstash URL from Phase 3>
   FRONTEND_URL=https://<vercel-url-placeholder>
   GUEST_DAILY_LIMIT=5
   USER_DAILY_LIMIT=20
   SESSION_TOKEN_LIMIT=15000
   GUEST_TURN_LIMIT=5
   MAX_NON_ACADEMIC_TURNS=10
   USE_INTENT_ROUTER=false
   BCRYPT_SALT_ROUNDS=12
   ```

   **Note:** `FRONTEND_URL` will be a placeholder until Phase 5. Update it after
   Vercel deploy. `GOOGLE_CALLBACK_URL` needs the actual Railway URL — you'll get
   this after first deploy.

5. **Deploy** — Click deploy. Watch the build logs.
6. **Get the public URL** — Railway generates a URL. Note it down.
7. **Update `GOOGLE_CALLBACK_URL`** — Now that you have the Railway URL, update
   this variable to include the actual URL.
8. **Redeploy** after variable changes (Railway does this automatically).

### First Deploy Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| Build fails with `npm install` error | Node version mismatch | Add `"engines": {"node": ">=20"}` to `backend/package.json` |
| `MONGODB_URI missing` error in logs | Env var not set or typo | Check Railway Variables tab |
| Redis connection failed → exit | `REDIS_URL` wrong or Upstash not ready | Verify Upstash URL, check TLS (`rediss://`) |
| SMTP connection failed → exit | Email credentials wrong | Verify `EMAIL_USER` and `EMAIL_PASS` |
| Health check failing | Railway hitting wrong path | Set health check path to `/health` in Railway settings |

---

## Phase 5 — Deploy Frontend to Vercel

**Status:** `[x]` Completed

**What:** Deploy the React/Vite frontend to Vercel.

**Result:** A public URL like `https://zuno.vercel.app`

**Estimated time:** 20-30 minutes
**Difficulty:** Easy

### Steps

1. Go to [Vercel](https://vercel.com) → Sign up with GitHub
2. Click **Add New Project** → Import `bihar-board-ai-tutor` repo
3. Configure:
   - **Root Directory:** Set to `frontend`
   - **Framework Preset:** Vite (Vercel auto-detects this)
   - **Build Command:** `npm run build` (default, fine)
   - **Output Directory:** `dist` (default for Vite, fine)

4. **Environment Variables:** Add:
   ```
   VITE_API_BASE_URL=https://<your-railway-backend-url>
   ```

5. Click **Deploy**

### Important: SPA Routing

If the app uses client-side routing (react-router-dom), add a `vercel.json` in
the `frontend/` folder:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This ensures direct URL access (e.g. `/login`, `/chat`) works instead of showing 404.

### After Deploy

1. Note the Vercel URL (e.g. `https://zuno.vercel.app`)
2. Go back to **Railway** → update `FRONTEND_URL` to include this URL
3. Railway will auto-redeploy with the new CORS allowlist

---

## Phase 6 — Connect Frontend ↔ Backend (CORS + Cookies)

**Status:** `[x]` Complete

**What:** Verify the frontend and backend can actually talk to each other across
domains — API calls work, cookies are set/read correctly, auth flow completes.

**Why:** This is historically the single most bug-prone step in any deployment
with separate frontend/backend domains. Our code already handles this (sameSite,
secure, CORS), but it needs a real test — not just "should work."

**Estimated time:** 20-30 minutes
**Difficulty:** Medium

### Test Checklist

- [ ] Open Vercel URL in browser
- [ ] Open DevTools → Network tab
- [ ] Try guest chat — does the `/api/v1/ask` call succeed? Check for CORS errors
- [ ] Try register → check if verification email arrives
- [ ] Try login → check if `refreshToken` cookie is set (DevTools → Application → Cookies)
- [ ] Refresh page → are you still logged in? (refresh token working)
- [ ] Try Google login → does the OAuth redirect work end-to-end?
- [ ] Check Railway logs for any errors

### Common Problems and Fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `CORS error` in browser console | `FRONTEND_URL` in Railway doesn't match Vercel URL | Update `FRONTEND_URL` in Railway. Watch for trailing slashes — `https://zuno.vercel.app` not `https://zuno.vercel.app/` |
| API calls work but cookies not set | `sameSite: 'none'` requires `secure: true` which requires HTTPS | Both Railway and Vercel serve HTTPS by default — this should just work. If not, check `NODE_ENV=production` |
| Google OAuth redirect fails | `GOOGLE_CALLBACK_URL` still points to localhost | Update in Railway env vars AND in Google Cloud Console |
| Login works but refresh fails | Cookie domain mismatch | Check the `refreshToken` cookie in DevTools — its domain should match Railway's domain |

---

## Phase 7 — Google OAuth Production Config

**Status:** `[x]` Complete

**What:** Add the production redirect URI to Google Cloud Console.

**Why:** Google OAuth strictly validates redirect URIs. The `localhost` one won't
work once deployed.

**Estimated time:** 10 minutes
**Difficulty:** Easy

### Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project
3. Go to **APIs & Services** → **Credentials**
4. Click on your OAuth 2.0 Client ID
5. Under **Authorized redirect URIs**, add:
   ```
   https://<your-railway-url>/api/v1/auth/google/callback
   ```
6. Under **Authorized JavaScript origins**, add:
   ```
   https://<your-vercel-url>
   ```
7. **Keep the localhost entries** — you still need them for local development
8. Click **Save**

**Note:** Changes take effect immediately — no propagation delay like DNS.

---

## Phase 8 — CI/CD Pipeline (GitHub Actions)

**Status:** `[x]` Completed

**Result:** `.github/workflows/ci.yml` runs `test:chunks`, `test:study-map`,
`curriculum:build` + `test:curriculum-resolvers`, and the frontend `npm run build`
on every push/PR to `main`. First run (`#1`, commit `928bf31`) passed green in 28s.
`test:vector-store` was intentionally dropped — the RAG architecture has migrated
to MongoDB Atlas Vector Search, so the JSON file it validated is no longer part of
the runtime path.

**What:** Set up automated testing and deployment via GitHub Actions so that every
push to `main` is automatically tested and deployed.

**Why:** Right now, deployment is manual — push to GitHub and Railway/Vercel pick
it up. That's fine for the initial deploy, but as the app grows:
- A broken commit can reach production without any checks
- You have to manually verify tests pass before merging
- No safety net for regressions

CI/CD adds an automated gate: code gets tested before it reaches production.

**Estimated time:** 45-60 minutes
**Difficulty:** Medium

### What the Pipeline Does

```
Push to main
    ↓
GitHub Actions triggers
    ↓
┌─────────────────────────────┐
│  1. Install dependencies    │
│  2. Run backend lint check  │
│  3. Run offline tests:      │
│     - test:chunks           │
│     - test:study-map        │
│     - test:curriculum-resolvers │
│     - test:vector-store     │
│  4. Build frontend          │
│     (catches compile errors)│
└─────────────────────────────┘
    ↓ (all pass)
Railway & Vercel auto-deploy from main
    ↓ (any fail)
Deploy is blocked, PR shows ❌
```

### File: `.github/workflows/ci.yml`

```yaml
name: CI — Test & Build

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  backend-tests:
    name: Backend Tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Run chunk validation
        run: npm run test:chunks

      - name: Run study map validation
        run: npm run test:study-map

      - name: Run curriculum resolver tests
        run: npm run test:curriculum-resolvers

      - name: Validate vector store
        run: npm run test:vector-store

  frontend-build:
    name: Frontend Build
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Build frontend
        run: npm run build
        env:
          VITE_API_BASE_URL: https://placeholder.railway.app
```

### What Tests Are NOT in CI (and why)

| Test | Why not in CI |
|------|---------------|
| `test:retrieval` | Needs live Gemini API key + network — costs money per run |
| `test:ask-db` | Needs Gemini + Groq + MongoDB — full integration test |
| `test:golden` | Needs LLM API calls — expensive, non-deterministic |
| `db:ping` | Needs MongoDB Atlas network access |

These are run manually before releases, not on every push.

### GitHub Secrets Needed

None for the CI pipeline above — all tests are offline. If you later add integration
tests, you'd add secrets via **GitHub repo → Settings → Secrets and Variables → Actions**.

### How Railway and Vercel Auto-Deploy Work With CI

- **Railway:** Watches the `main` branch. When CI passes and a push lands on main,
  Railway pulls the code and rebuilds. You can also configure Railway to only deploy
  if the GitHub Actions check passes (Settings → Deploy on push → Require CI to pass).

- **Vercel:** Same behavior — watches main, auto-deploys. Vercel also creates
  **preview deployments** for every PR automatically, so you can test changes before
  merging.

### Branch Protection (Recommended)

After CI is set up, enable branch protection on `main`:

1. GitHub → repo → **Settings** → **Branches** → **Add rule**
2. Branch name pattern: `main`
3. Check: **Require status checks to pass before merging**
4. Select the CI workflow checks
5. Check: **Require branches to be up to date before merging** (optional but good)

This prevents merging a PR unless all CI tests pass.

---

## Phase 9 — End-to-End Smoke Test on Production

**Status:** `[x]` Completed

**Result:** Guest chat, guest limit banner, login redirect, Focus Mode (study-map
+ chapter-scoped retrieval), and off-topic redirect verified directly against the
live backend/frontend. Registration, Google OAuth, and session persistence
verified manually by Farhan — all working.

**Critical bug found and fixed during this phase:** Guest/global chat was
returning `insufficient_context` for every question (`retrieval.returnedCount: 0`)
even for basic curriculum topics. Root cause: the MongoDB Atlas Vector Search
Index (`vector_index`) required by `retriever.js`'s `$vectorSearch` stage had
never been created on the `zuno_prod` cluster — it existed on the dev database
only. The 629 chunk documents were present in `zuno_prod.chunks`, but with no
matching Search Index, `$vectorSearch` matched nothing. Fixed by creating an
identical `vector_index` (vector field on `embedding`, 3072 dims, cosine +
metadata filter fields for `subject`/`section`/`chapter_no`/`topic_ids`) on
`zuno_prod.chunks` via Atlas UI. Confirmed fixed: retrieval now returns correctly
ranked sources for both global and Focus Mode questions.

**What:** On the real live URLs, manually test every golden path.

**Why:** Confirms the deployment actually works end-to-end, not just that each
piece deployed without errors.

**Estimated time:** 30-45 minutes
**Difficulty:** Easy, but don't skip it

### Test Script

#### Guest Flow (no login)
- [ ] Open Vercel URL → app loads, no console errors
- [ ] Type a Science question in Hindi/Hinglish → Zuno responds from RAG content
- [ ] Ask 5 questions → guest limit banner appears
- [ ] Click "Login karo" → redirects to login/register

#### Registration Flow
- [ ] Register with email → verification email arrives
- [ ] Click verification link → account verified
- [ ] Login with email/password → works

#### Google OAuth Flow
- [ ] Click "Continue with Google" → Google consent screen appears
- [ ] Select account → redirected back to app, logged in

#### Focus Mode
- [ ] Open Focus Mode → chapter list loads (study-map API working)
- [ ] Select a chapter → topics load
- [ ] Ask a question about the chapter → Zuno answers from chapter content
- [ ] Ask an off-topic question → Zuno says "ye is chapter me nahi hai"

#### Session Persistence
- [ ] Refresh the page → still logged in (refresh token cookie working)
- [ ] Close browser, reopen → still logged in
- [ ] Check session history → previous conversations visible

#### Edge Cases
- [ ] Ask a question outside Bihar Board syllabus → Zuno says it can't answer
- [ ] Send empty message → nothing happens (input validation)
- [ ] Rapid-fire 10+ questions → rate limiter kicks in gracefully

---

## Phase 10 — (Optional) Custom Domain

**Status:** `[ ]` Not started — deferred until after launch is stable

**What:** Buy a domain and point it to Vercel (frontend) and optionally a subdomain
to Railway (backend, e.g. `api.zuno.com`).

**Why:** Professional look instead of `.vercel.app` / `.up.railway.app`. Not a
functional requirement — the app works fine without it.

**Estimated time:** Domain purchase + DNS setup ~30 min, but DNS propagation can
take a few hours.
**Difficulty:** Easy

### Steps (when ready)

1. Buy a domain (Namecheap, Google Domains, Cloudflare Registrar — all fine)
2. **Frontend:** In Vercel → Settings → Domains → Add `zuno.com` (or whatever).
   Vercel gives you DNS records to add.
3. **Backend:** In Railway → Settings → Custom Domain → Add `api.zuno.com`.
   Railway gives you a CNAME record to add.
4. Update DNS records at your registrar
5. Update `FRONTEND_URL` in Railway to the custom domain
6. Update `VITE_API_BASE_URL` in Vercel to `https://api.zuno.com`
7. Update `GOOGLE_CALLBACK_URL` in Railway + Google Cloud Console
8. Wait for DNS propagation (can take up to 48 hours, usually <1 hour)

---

## What's Already Done (from PRE_LAUNCH_BLOCKERS.md)

All security and correctness blockers are already fixed — see
`PRE_LAUNCH_BLOCKERS.md` for full detail. Summary: OAuth token URL leak fixed,
cross-domain cookie handling fixed, Helmet.js security headers added, Redis-backed
rate limiting, debug logs gated, frontend error boundaries, embedding cache,
session bugs (S-1 through S-4) all fixed. Deployment was always the one remaining
gap — this file fills that gap.

---

## Quick Reference — All URLs After Deployment

| What | URL (placeholder) | Notes |
|------|-------------------|-------|
| Frontend (students visit this) | `https://zuno.vercel.app` | Replace with actual Vercel URL |
| Backend API | `https://zuno-backend.up.railway.app` | Replace with actual Railway URL |
| Health check | `https://zuno-backend.up.railway.app/health` | Railway can ping this |
| MongoDB Atlas | `cloud.mongodb.com` | Dashboard only — app connects via URI |
| Upstash Redis | `console.upstash.com` | Dashboard only — app connects via URL |
| Google Cloud Console | `console.cloud.google.com` | OAuth config |
| Railway Dashboard | `railway.com/dashboard` | Backend deploy management |
| Vercel Dashboard | `vercel.com/dashboard` | Frontend deploy management |
| GitHub Actions | `github.com/<repo>/actions` | CI pipeline status |

---

## Active Task Workspace

**Current Phase:** Deployment is functionally complete. Phases 2-9 done; Phase 1's
checklist items were already true in code before deployment. Phase 10 (custom
domain) remains optional/deferred until Farhan wants it.
**Last Updated:** 2026-07-28
