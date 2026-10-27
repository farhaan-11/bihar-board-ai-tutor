# GUEST_SERVERSIDE_PLAN.md — Server-side Guest Identity + Guest Claim

> **Branch:** `guestID` (confirmed current branch; NOT `main`).
> **Author role:** senior engineer holds every technical call here. Owner only
> makes genuine *business* calls (timeline / scope / money). Every "which fix,
> which approach, is this a real bug" decision is made in this document, with the
> reason stated.
> **Discipline:** every fix removes a *cause*, never patches a symptom
> (`AUDIT_RULES.md` Rule 4). No new guard/wrapper without deleting the cause it
> guards. One phase at a time, each phase has a failing-test → fix → passing-test
> cycle and its own rollback.
> **Status:** PLAN — no code written yet. Evidence gathered 2026-09-10 by reading
> `main`/`guestID` directly. Every claim below is anchored to a real `file:line`.

---

## 0. Why this document exists

The owner asked for a permanent, server-side guest identity — replacing the
current design where the browser invents its own guest id. While tracing the
code for that, a **second, separate bug** surfaced: a guest's chat does not
appear after they log in. This document covers **both**, because they touch the
same claim code and must be built together to avoid editing that code twice.

Two problems, kept strictly separate so the fixes don't blur:

| # | Problem | Nature |
|---|---|---|
| **P1** | Guest identity is **client-generated** → can be forged / rotated infinitely → guest rate-limit + cost controls are bypassable | security / cost |
| **P2** | A guest's **chat history is never claimed on login** → it stays invisible forever | data-continuity bug |

---

## 1. Evidence — exactly how guest identity works today (no assumptions)

### 1.1 Frontend generates the id itself

`crypto.randomUUID()`, stored in `localStorage` under `zuno-guest-id`, sent as the
`X-Guest-Id` header. Two independent copies of the generator exist:

- [`frontend/src/services/axios/axiosInstance.js:39-55`](frontend/src/services/axios/axiosInstance.js) — attaches `X-Guest-Id` on every axios request when no auth token is present.
- [`frontend/src/api/tutorApi.js:7-14`](frontend/src/api/tutorApi.js) and [`:242`](frontend/src/api/tutorApi.js) — the `/ask` SSE call uses a **raw `fetch`** (not axios) and sets the same header manually.

Both read/write the **same** key `zuno-guest-id`, so they agree. The server only
checks that the value *looks like* a UUID — never that it issued it.

### 1.2 Backend trusts that header in 6 places

- [`ask.controller.js:19`](backend/src/controllers/ask.controller.js) — `req.headers['x-guest-id']`
- [`quiz.controller.js:24`](backend/src/controllers/quiz.controller.js) — via `extractIdentity`, capped at `GUEST_ID_MAX_LENGTH` ([`quizConstants.js:14`](backend/src/constants/quizConstants.js))
- [`chapterProgress.controller.js:22`](backend/src/controllers/chapterProgress.controller.js)
- [`support.controller.js:16`](backend/src/controllers/support.controller.js)
- [`guestRateLimit.js:14`](backend/src/middlewares/guestRateLimit.js) — validates UUID shape ([`:5`](backend/src/middlewares/guestRateLimit.js)), reads counter `guest_turns:<guestId>` ([`:30`](backend/src/middlewares/guestRateLimit.js))
- [`rateLimiters.js:24`](backend/src/middlewares/rateLimiters.js) — `identityKeyGenerator` builds the rate-limit key `guest_<guestId>`

### 1.3 The abuse (P1), concretely

`guest_turns:<guestId>` is keyed by a value the client picks. A trivial script:

```
for each request:  X-Guest-Id = crypto.randomUUID()   // brand-new id every time
```

gives a brand-new counter every request → the 5-turn cap
([`env.js:24`](backend/src/config/env.js), `guestTurnLimit`) never fires → unlimited
RAG + 2× LLM calls (~₹0.11 each). **The 5-turn cap is a login nudge, never a
security control.** Today the *only* thing bounding this is `globalApiLimiter`'s
raw-IP key — which is itself the separate R6 issue.

### 1.4 What login currently claims — and what it forgets (P2)

[`claimGuestData` — `chapterProgress.service.js:380-457`](backend/src/services/chapterProgress.service.js) migrates, by `guestId`:

- ✅ `ChapterProgress` ([`:383`](backend/src/services/chapterProgress.service.js))
- ✅ `StudyEvent` ([`:443`](backend/src/services/chapterProgress.service.js))
- ✅ `QuizAttempt` ([`:447`](backend/src/services/chapterProgress.service.js))
- ✅ `QuizSession` (pending) ([`:451`](backend/src/services/chapterProgress.service.js))

It **never touches chat.** And it *cannot*, because:

- [`chatSession.model.js:10-14`](backend/src/models/chatSession.model.js) — `chat_sessions` has `userId` (null for guests) and **no `guestId` field at all**.
- [`chatHistory.model.js:47-57`](backend/src/models/chatHistory.model.js) — `chat_history` is keyed by `sessionId` (unique), has `userId` (null), **no `guestId`**.

So a guest's chat session is written with `userId: null` and **zero link to the
guest**. The sidebar list query
[`getSessionsByUser` — `chatSession.service.js:136-137`](backend/src/services/chatSession.service.js)
filters `{ userId }`. Guest chats (`userId: null`) can never match → invisible
after login, forever.

> **Good news that shrinks P2:** because `chat_history` is keyed purely by
> `sessionId` ([`chatHistory.model.js:47`](backend/src/models/chatHistory.model.js)),
> if we claim the **session** (flip its owner to `userId`), the history follows
> automatically by `sessionId` — it needs no separate migration.

### 1.5 Where a guest chat session is created

[`step7.saveAndRespond.js:289-296`](backend/src/ask/step7.saveAndRespond.js):

```js
const updatedSession = await updateChatSession(
  sessionId,
  { /* chatStateSet, chatStateInc, topLevelInc */ },
  { userId, sessionType }          // ← guestId is in scope here (param :196) but NOT passed
);
```

The upsert that actually creates the row is
[`updateChatSession` — `chatSession.service.js:64-104`](backend/src/services/chatSession.service.js),
whose `$setOnInsert` writes `userId` / `mode` / `sessionType`
([`:85-89`](backend/src/services/chatSession.service.js)). This is the single
creation point where a `guestId` must be stamped.

### 1.6 The proven cross-domain cookie config (reference for any cookie decision)

Refresh-token cookie (C-2 fix) is set identically in 3 places
([`auth.controller.js:195-199`](backend/src/controllers/auth.controller.js),
[`:354-358`](backend/src/controllers/auth.controller.js),
[`:578-582`](backend/src/controllers/auth.controller.js)) and cleared at
[`:294-297`](backend/src/controllers/auth.controller.js):

```js
sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
secure:   process.env.NODE_ENV === 'production',
httpOnly: true,
```

Read via `req.cookies?.refreshToken` ([`:279`](backend/src/controllers/auth.controller.js)),
which works because `cookie-parser` is mounted at
[`app.js:47`](backend/src/app.js). CORS allows credentials + an origin allowlist
([`app.js:33-46`](backend/src/app.js)).

### 1.7 Where claim is called from the frontend

- [`AuthCallback.jsx:47-51`](frontend/src/pages/AuthCallback.jsx) (Google OAuth)
- [`LoginPage.jsx:105-109`](frontend/src/pages/LoginPage.jsx) (email login)
- Service: [`authService.js:88-99`](frontend/src/services/axios/authService.js) — posts `{ guestId }` from localStorage.
- Route: [`auth.routes.js:19`](backend/src/routes/auth.routes.js) — `requireAuth`.
- Controller: [`auth.controller.js:644-664`](backend/src/controllers/auth.controller.js) — reads `req.body.guestId`, validates UUID shape ([`:633`](backend/src/controllers/auth.controller.js)).

---

## 2. Target architecture — and the key senior decision

### 2.1 DECISION: signed, server-minted token — carried in the header, NOT a cross-domain cookie

The obvious instinct is "HttpOnly cookie like the refresh token." **I am
deciding against a cookie here, on purpose.** Reasoning:

- The entire abuse in §1.3 is that the client can *fabricate* ids. A token that
  is **signed with a server secret** cannot be fabricated — you cannot forge a
  valid signature. To get a *new* valid identity you must call a mint endpoint,
  which we IP-rate-limit. **That closes the hole regardless of whether the token
  rides in a cookie or a header.** The signature is the fix, not the cookie.
- A cookie re-introduces the entire C-2 cross-domain class of bug (§1.6):
  `sameSite:'none'`, `secure`, `credentials:'include'` on the **raw fetch** in
  [`tutorApi.js`](frontend/src/api/tutorApi.js), and a prod-only failure mode
  that passes locally (exactly how C-2 and the Playwright prerender both bit us).
- What a cookie buys extra — HttpOnly hides the token from JS — is near-worthless
  here: a guest token grants no account, just a 5-turn allowance. Stealing it is
  pointless.
- The header path **already exists** for `X-Guest-Id` in both axios and the raw
  fetch. We replace the *value* (client UUID → server-signed token). Minimal
  blast radius.

So: **keep the existing `X-Guest-Id` header plumbing; change the value from a
self-generated UUID to a server-signed token.** The inner id stays a UUID, so the
DB shape (`guestId` column, claim matching) is unchanged.

If, in Stage 2+, we ever want HttpOnly hardening, we can layer a cookie on top
later — but it is not needed to fix P1.

### 2.2 The new flow

```
First guest visit (no token):
  frontend  →  POST /api/v1/auth/guest        (IP-rate-limited, cheap, no LLM)
  backend   →  gid = randomUUID()
               token = jwt.sign({ t:'guest', gid }, GUEST_TOKEN_SECRET)   // long expiry
  frontend  →  localStorage['zuno-guest-token'] = token

Every later request:
  frontend  →  header  X-Guest-Id: <token>
  backend   →  attachGuest middleware verifies signature → req.guest = { id: gid }
               (invalid/absent → req.guest = null, same as optionalAuth does for users)

All 6 read sites (§1.2):  req.headers['x-guest-id']  →  req.guest?.id

Login:
  claim reads gid from the verified token (not body) → migrates everything,
  now including chat_sessions → guest chat appears in the sidebar (fixes P2)
```

### 2.3 Secondary decisions (senior calls, with reasons)

1. **Mint endpoint limit is generous, not tight.** Minting is a cheap, LLM-free
   op; the expensive path (`/ask`) is still bounded by the per-token 5-turn cap,
   which is now un-forgeable. So one IP minting many tokens still only yields
   `tokens × 5` ask-turns — bounded and modest. A tight mint limit would re-break
   the classroom case (30 students behind one IP each need one token). Start at
   e.g. **60 / hour / IP**, tune from real logs.
2. **Inner `gid` stays a UUID.** DB `guestId` columns, indexes
   ([`chapterProgress.model.js:101-105`](backend/src/models/chapterProgress.model.js),
   [`quizAttempt.model.js:48-49`](backend/src/models/quizAttempt.model.js)) and
   `claimGuestData`'s matching all keep working unchanged.
3. **Transition compatibility (one release window).** Right after deploy, existing
   browsers hold a raw UUID in `zuno-guest-id`, not a signed token. During a
   transition flag window, `attachGuest` will *also* accept a legacy bare-UUID
   header and the mint endpoint will **adopt** a supplied legacy id into a signed
   token once, preserving any early guest's progress. The legacy acceptance is
   removed in the final phase. (Pre-launch guest population is ~0, so even pure
   orphaning would be acceptable — but adoption is cheap and safe.)
4. **Chat claim is bundled into this branch.** `claimGuestData` is edited anyway;
   editing it twice (once now for P1 plumbing, once later for P2) is the exact
   "touch it twice" waste we avoid.
5. **`globalApiLimiter` (R6 / Solution A) is NOT in this branch.** That is a
   separate Stage-1 quick fix on its own branch. Noted only because, once guest
   tokens are trustworthy, that limiter could later also key by `req.guest.id` —
   but that is out of scope here. Do not mix the two.

---

## 3. Risk register — each risk anchored to real code, each with a tackle

| # | Risk | Evidence | Tackle |
|---|---|---|---|
| R-a | Miss one of the 6 read sites → that endpoint reads a different identity than the rest | §1.2 list | Central `attachGuest` middleware is the *only* reader of the raw header; all 6 sites read `req.guest?.id`. Grep-audit `x-guest-id` to zero non-middleware hits before Phase 2 closes. |
| R-b | Raw `fetch` for `/ask` doesn't go through axios | [`tutorApi.js:242`](frontend/src/api/tutorApi.js) | Token is a header value (our decision §2.1), so the existing header set just changes value. No `credentials` change needed — this is a direct payoff of not using a cookie. |
| R-c | Existing guests' in-flight progress orphaned on switch | §1.1, §2.3.3 | Transition adoption window (§2.3.3). Pre-launch population ~0. |
| R-d | Claim reads forgeable body id | [`auth.controller.js:646`](backend/src/controllers/auth.controller.js) | Claim reads `gid` from the **verified** token, not `req.body`. Invalid/missing token → harmless no-op (preserve current never-fail-login behavior). |
| R-e | Chat claim correctness (duplicate/owned sessions) | [`getSessionsByUser:137`](backend/src/services/chatSession.service.js) | Claim migrates only `{ guestId: gid, userId: null }` sessions → set `userId`, unset `guestId`. History follows by `sessionId` (§1.4). Test with a guest session + a pre-existing user session in one claim. |
| R-f | `guestRateLimit` / `GUEST_ID_REGEX` assume a UUID shape | [`guestRateLimit.js:5,18`](backend/src/middlewares/guestRateLimit.js), [`auth.controller.js:633`](backend/src/controllers/auth.controller.js) | These now consume `req.guest?.id` (the inner UUID), so the UUID regex still holds on the *inner* id. The token is parsed only inside `attachGuest`. |
| R-g | Mint endpoint becomes a new abuse/DoS surface | new code | IP-limit the mint route (reuse `rateLimit` + `ipKeyGenerator`), cheap op, generous limit (§2.3.1). No DB write on mint (stateless token) → nothing to flood. |
| R-h | First guest action fires before a token exists → treated as no-identity | new bootstrap | App-init bootstraps the token (mint-if-absent) before the first guest action, mirroring how auth bootstraps. Lazy re-mint on a missing-token response as a backstop. |
| R-i | `GUEST_TOKEN_SECRET` missing in prod → all guests break | [`env.js:67-154`](backend/src/config/env.js) | Add it to `validateEnv()` so the server refuses to start without it (same pattern as JWT secrets, [`:126-131`](backend/src/config/env.js)). Add to `.env.example`. |

---

## 4. Phased execution plan

Each phase: **Goal → Files → Code sketch (grounded in real signatures) → Test
(failing→passing) → Definition of Done → Rollback.** Phases 1–4 are backend and
additive (old path keeps working). The frontend only cuts over in Phase 5. Legacy
acceptance is removed in Phase 6. This ordering means `main` is never broken if we
stop between phases.

> Code blocks are implementation **sketches** grounded in the exact current
> signatures cited in §1. Final code is written phase-by-phase, confirming each
> line against the file at that moment.

### Phase 0 — Baseline (no code)

- **Goal:** prove green starting point so any later red is *ours*.
- **Do:** confirm on branch `guestID`; run the working baseline:
  `npm run test:chunks`, `npm run test:study-map`, `npm run test:curriculum-resolvers`.
  (`test:chat-db-models` and `test:golden` are known-broken on `main` per
  `PROJECT_STATE.md` §5 — do not treat their failure as caused here.)
- **DoD:** the 3 baseline tests green, recorded.
- **Rollback:** n/a.

**✅ RESULT — 2026-09-10, branch `guestID` @ `9f2af3d` (clean tree, only
`GUEST_SERVERSIDE_PLAN.md` untracked):**

| Command | Result |
|---|---|
| `npm run test:chunks` | PASS — 17/17 chapters, chunker status READY |
| `npm run test:study-map` | PASS — 1 subject, 16 chapters (Phy 5 / Chem 5 / Bio 6) |
| `npm run test:curriculum-resolvers` | PASS — "Curriculum resolver tests passed." |

Baseline is green. Any red in later phases is caused by this branch's changes.

### Phase 1 — Guest-token helpers + mint endpoint (backend, additive)

- **Goal:** server can issue and verify a signed guest token. Nothing consumes it yet.
- **Files:**
  - new `backend/src/auth/guestTokenHelpers.js` — `generateGuestToken()`, `verifyGuestToken(token)` (mirror [`tokenHelpers.js`](backend/src/auth/tokenHelpers.js) exactly).
  - new controller `issueGuestToken` in [`auth.controller.js`](backend/src/controllers/auth.controller.js).
  - route `POST /api/v1/auth/guest` in [`auth.routes.js`](backend/src/routes/auth.routes.js), wrapped in a new IP-limited `guestMintLimiter` in [`rateLimiters.js`](backend/src/middlewares/rateLimiters.js).
  - [`env.js`](backend/src/config/env.js) — require `GUEST_TOKEN_SECRET`; `.env.example` entry.
- **Sketch:**
  ```js
  // guestTokenHelpers.js  (pattern copied from tokenHelpers.js:18-25)
  import jwt from 'jsonwebtoken';
  import { randomUUID } from 'node:crypto';
  const SECRET = () => process.env.GUEST_TOKEN_SECRET;
  export const generateGuestToken = (gid = randomUUID()) =>
    jwt.sign({ t: 'guest', gid }, SECRET(), { expiresIn: '180d' });
  export const verifyGuestToken = (token) => {
    try { const d = jwt.verify(token, SECRET()); return d?.t === 'guest' ? d.gid : null; }
    catch { return null; }
  };
  ```
  ```js
  // auth.controller.js — issueGuestToken (adoption per §2.3.3)
  export const issueGuestToken = async (req, res) => {
    const legacy = req.body?.legacyGuestId;
    const gid = (legacy && GUEST_ID_REGEX.test(String(legacy).trim()))
      ? legacy.trim() : undefined;                 // adopt once, else fresh
    return sendResponse(res, 200, { data: { guestToken: generateGuestToken(gid) } });
  };
  ```
  ```js
  // rateLimiters.js — mint limiter (pattern from authApiLimiter:74-86, IP-keyed)
  export const guestMintLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    passOnStoreError: true, store: createRedisStore('rl_guest_mint:'),
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json(
      createRateLimitResponse('Thodi der baad dobara try karein.')),
  });
  ```
- **Test (new `scripts/test-guest-token.js`):** sign→verify round-trips to the
  same gid; a tampered/!`t:guest`/expired token → `null`; adoption returns the
  supplied legacy gid. Failing first (helpers absent) → passing.
- **DoD:** test passes; server boots and refuses to start with `GUEST_TOKEN_SECRET` unset; baseline still green.
- **Rollback:** delete the new files + the route line + the env check. Nothing consumes them, so removal is clean.

**✅ RESULT — 2026-09-10, branch `guestID`:**

| Check | Result |
|---|---|
| `npm run test:guest-token` | PASS — 9 groups: round-trip, distinct mints, legacy adoption, garbage→null, tamper→null, foreign-secret→null, wrong/missing type→null, expired→null, route+limiter+env wiring |
| `validateEnv()` with `GUEST_TOKEN_SECRET` unset | Exits: `❌ Server startup failed — missing required environment variables: * GUEST_TOKEN_SECRET` |
| Module import smoke (`auth.routes.js` → `auth.controller.js` → `guestTokenHelpers.js`, `rateLimiters.js`) | All import clean |
| Baseline (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`) | Still green |
| `npm run test:ask-limiter-identity` (BUG-8 regression) | Still green |

**Files created:** `backend/src/auth/guestTokenHelpers.js`, `backend/scripts/test-guest-token.js`.
**Files edited:** `backend/src/middlewares/rateLimiters.js` (+`guestMintLimiter`, #8),
`backend/src/controllers/auth.controller.js` (+`issueGuestToken`),
`backend/src/routes/auth.routes.js` (+`POST /guest`),
`backend/src/config/env.js` (require `GUEST_TOKEN_SECRET` + weak-secret warning),
`backend/.env.example` (+entry), `backend/package.json` (+`test:guest-token` script).

**Owner action done for local dev:** a 64-hex `GUEST_TOKEN_SECRET` was generated and
appended to `backend/.env` (gitignored — not committed). **Owner business step for
Phase 6 / deploy:** set `GUEST_TOKEN_SECRET` in the Render environment (same as the
BUG-8 env step) — the server will refuse to boot without it.

**Nothing consumes the token yet** — the client-UUID `X-Guest-Id` path is fully
intact. Additive only.

### Phase 2 — `attachGuest` middleware + switch the 6 read sites (backend, additive)

- **Goal:** one trusted place resolves guest identity; all consumers read `req.guest?.id`.
- **Files:** new `backend/src/auth/guestMiddleware.js`; edits to [`ask.controller.js:19`](backend/src/controllers/ask.controller.js), [`quiz.controller.js:24`](backend/src/controllers/quiz.controller.js), [`chapterProgress.controller.js:22`](backend/src/controllers/chapterProgress.controller.js), [`support.controller.js:16`](backend/src/controllers/support.controller.js), [`guestRateLimit.js:14`](backend/src/middlewares/guestRateLimit.js), [`rateLimiters.js:24`](backend/src/middlewares/rateLimiters.js); mount `attachGuest` where routes currently run `optionalAuth`.
- **Sketch:**
  ```js
  // guestMiddleware.js — never blocks; sets req.guest (mirrors optionalAuth shape)
  import { verifyGuestToken } from './guestTokenHelpers.js';
  const LEGACY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  export const attachGuest = (req, _res, next) => {
    if (req.user) { req.guest = null; return next(); }     // logged-in wins
    const raw = req.headers['x-guest-id'];
    let gid = raw ? verifyGuestToken(raw) : null;          // signed token path
    if (!gid && process.env.GUEST_LEGACY_ACCEPT === 'true'
        && raw && LEGACY_UUID.test(raw.trim())) gid = raw.trim(); // transition only
    req.guest = gid ? { id: gid } : null;
    next();
  };
  ```
  Then e.g. [`ask.controller.js:19`](backend/src/controllers/ask.controller.js)
  becomes `const guestId = req.user ? null : (req.guest?.id || null);` and
  [`rateLimiters.js:24-25`](backend/src/middlewares/rateLimiters.js) becomes
  `const gid = req.guest?.id; return gid ? \`guest_${gid}\` : ipKeyGenerator(req.ip);`
  **Ordering constraint:** `attachGuest` must run after `optionalAuth` and before
  any limiter that keys on identity (see [`ask.routes.js:11`](backend/src/routes/ask.routes.js)).
- **Test (`scripts/test-attach-guest.js`, mocked req):** valid token → `req.guest.id`=gid; no header → `null`; logged-in → `null`; legacy UUID honored only when `GUEST_LEGACY_ACCEPT=true`. Plus extend `test:ask-limiter-identity` so two different guest *tokens* on one IP get separate buckets and a rotated *unsigned* id does **not** (that's the P1 proof).
- **DoD:** new tests + `test:ask-limiter-identity` pass; grep shows no `x-guest-id` read outside `guestMiddleware.js`; baseline green.
- **Rollback:** revert the 6 one-line reads to `req.headers['x-guest-id']`; remove `attachGuest`. Old behavior restored.

**✅ RESULT — 2026-09-10, branch `guestID`:**

| Check | Result |
|---|---|
| `npm run test:attach-guest` *(new)* | PASS — 8 groups: valid token→`{id}`, no header→null, logged-in→null, garbage/foreign→null, legacy UUID adopted while flag≠`false`, legacy UUID rejected at flag=`false`, two mints=two ids, rotated fake ids→null. Also asserts `next()` always called with no error. |
| `npm run test:ask-limiter-identity` (BUG-8, updated) | PASS — guest cases now feed `req.guest` (not the raw header); case 5 documents that a rotated unsigned id lands on the IP key. |
| `npm run test:guest-token` (Phase 1) | Still PASS |
| grep `x-guest-id` read outside `guestMiddleware.js` | **Zero.** Only remaining hits are comments/docstrings + `guestMiddleware.js:32` (the one trusted read). |
| Baseline (`test:chunks` 17/17, `test:study-map`, `test:curriculum-resolvers`) | Still green |
| `node --check` on all 12 edited files + import-smoke of the 4 touched route modules + `guestMiddleware` | All clean |

**Files created:** `backend/src/auth/guestMiddleware.js` (`attachGuest`),
`backend/scripts/test-attach-guest.js`.
**Files edited:** `rateLimiters.js` (`identityKeyGenerator` reads `req.guest?.id`),
`guestRateLimit.js` (reads `req.guest?.id`, dropped the now-dead UUID regex),
`ask.controller.js` / `quiz.controller.js` / `chapterProgress.controller.js` /
`support.controller.js` (all read `req.guest?.id`),
`quizConstants.js` (removed now-unused `GUEST_ID_MAX_LENGTH` + its import),
`ask.routes.js` / `quiz.routes.js` / `chapterProgress.routes.js` / `support.routes.js`
(mount `attachGuest` right after `optionalAuth`, before any identity-keyed limiter),
`.env.example` (+`GUEST_LEGACY_ACCEPT=true`), `package.json` (+`test:attach-guest`).

**Behaviour now:** a signed guest token OR (transition) a legacy bare UUID resolves
to `req.guest.id`; a forged/rotated unsigned id resolves to **no identity** →
the request is IP-keyed, so the 5-turn cap can no longer be farmed. **P1 is
functionally closed** on the backend; the forgeable legacy path stays open only
until Phase 6 flips `GUEST_LEGACY_ACCEPT=false`. Frontend still sends the old
client UUID — accepted via the legacy path — until Phase 5.

### Phase 3 — Stamp `guestId` onto chat sessions (backend, additive)

- **Goal:** every guest chat session carries its `gid`, so it can be claimed later.
- **Files:** [`chatSession.model.js`](backend/src/models/chatSession.model.js) (+`guestId` field, partial index like [`chapterProgress.model.js:101-105`](backend/src/models/chapterProgress.model.js)); [`chatSession.service.js:64-104`](backend/src/services/chatSession.service.js) (`updateChatSession` accepts + `$setOnInsert`s `guestId`); [`step7.saveAndRespond.js:289-296`](backend/src/ask/step7.saveAndRespond.js) (pass `guestId` into meta — it is already in scope at [`:196`](backend/src/ask/step7.saveAndRespond.js)).
- **Sketch:**
  ```js
  // chatSession.service.js updateChatSession(meta) — add guestId to $setOnInsert
  $setOnInsert: { userId, guestId, mode: userId ? 'logged_in' : 'guest', sessionType }
  // step7 call site:
  { userId, guestId, sessionType }
  ```
- **Test (`scripts/test-guest-session-stamp.js`, live DB):** a guest turn creates a
  `chat_sessions` doc with `guestId=gid, userId=null`; a logged-in turn writes
  `userId` and `guestId=null`. Failing first (field absent) → passing.
- **DoD:** test passes; existing session tests unaffected; baseline green.
- **Rollback:** remove the field + the two threaded args. Old rows simply never had `guestId` — no migration needed.

**✅ RESULT — 2026-09-10, branch `guestID`:**

| Check | Result |
|---|---|
| `npm run test:guest-session-stamp` *(new, live DB)* | PASS — guest turn → `{guestId, userId:null, mode:"guest"}`; logged-in turn → `{userId, guestId:null, mode:"logged_in"}`; `guestId` immutable across turns (`$setOnInsert`); identity-less turn → `guestId:null`, no error; partial index declared |
| `node scripts/test-p2-t2-schema.js` (existing session schema — regression) | PASS — all 16 assertions, incl. sessionType immutability + compound index |
| Migration `scripts/create-chat-session-guest-index.js` run on dev DB | `guestId_1` present and **partial**: `{"key":{"guestId":1},"partialFilterExpression":{"guestId":{"$type":"string"}}}` |
| `test:guest-token`, `test:attach-guest`, `test:ask-limiter-identity` | Still PASS |
| Baseline (`test:chunks` 17/17, `test:study-map`, `test:curriculum-resolvers`) | Still green |
| `node --check` (4 edited/new files) + import-smoke `step7` | Clean |

**Files created:** `backend/scripts/test-guest-session-stamp.js`,
`backend/scripts/create-chat-session-guest-index.js` (matches the BUG-5
`create-*-index.js` precedent — idempotent).
**Files edited:** `chatSession.model.js` (+`guestId` field, +partial `{guestId:1}`
index), `chatSession.service.js` (`updateChatSession` accepts + `$setOnInsert`s
`guestId`), `step7.saveAndRespond.js` (passes `guestId` into the meta — already in
scope from the pipeline identity), `package.json` (+`test:guest-session-stamp`).

**Behaviour:** every guest chat session created from here on carries its `gid`,
immutable, ready for the login claim in Phase 4. Pre-Phase-3 guest sessions have
no `guestId` and are not claimable — acceptable (pre-launch guest chat volume
is ~0). Nothing reads `guestId` yet.

**Owner deploy step:** run `node scripts/create-chat-session-guest-index.js`
against prod once (or rely on Mongoose `autoIndex` on next boot) — same as the
BUG-5 index step.

### Phase 4 — Claim chat sessions on login → fixes P2 (backend)

- **Goal:** login transfers guest chat (and everything else) to the user; guest chat appears in the sidebar.
- **Files:** [`chapterProgress.service.js:443-456`](backend/src/services/chapterProgress.service.js) (`claimGuestData` also migrates `ChatSession`); [`auth.controller.js:644-664`](backend/src/controllers/auth.controller.js) (read `gid` from verified token, not `req.body`).
- **Sketch:**
  ```js
  // claimGuestData — add alongside the StudyEvent/Quiz updateMany calls
  await ChatSession.updateMany({ guestId, userId: null },
                               { $set: { userId, guestId: null, mode: 'logged_in' } });
  // chat_history follows automatically: it is keyed by sessionId (chatHistory.model.js:47)
  ```
  ```js
  // claimGuestProgress controller — trust the token, not the body
  const gid = verifyGuestToken(req.headers['x-guest-id']); // signed path
  if (!gid) return sendResponse(res, 200, { message: 'Nothing to claim.', data: {...} });
  const result = await claimGuestData(req.user.id, gid);
  ```
- **Test (`scripts/test-claim-chat.js`, live DB):** seed a guest `chat_sessions` +
  `chat_history` under gid → claim → assert the session now has `userId`,
  `guestId:null`, and `getSessionsByUser(userId)` returns it; history still reads
  by `sessionId`. Also the existing conflict path (user already had a session)
  stays intact. Failing first (claim ignores chat) → passing.
- **DoD:** test passes — **P2 fixed**; chapter/quiz claim still passes; baseline green.
- **Rollback:** remove the `ChatSession.updateMany` line and revert the controller to `req.body`. P1 phases unaffected.

**✅ RESULT — 2026-09-10, branch `guestID`:**

| Check | Result |
|---|---|
| `npm run test:claim-chat` *(new, live DB)* | PASS — 3 groups: (1) two guest sessions + their history flip to the user (`userId` set, `guestId` cleared, `mode: logged_in`, `chat_history.userId` synced, messages intact) and both appear in `getSessionsByUser`; (2) a pre-existing user session is untouched, no collision, user sees exactly own + claimed; (3) no guest chat → `chatSessionsTransferred: 0`, no error |
| `npm run test:attach-guest` (now Phase 2/4) | PASS — +4 assertions on the shared `resolveGuestIdFromHeader` (token→gid, garbage→null, legacy UUID gated on the flag) |
| `node scripts/test-p2-t2-schema.js` (session schema regression) | PASS |
| `test:guest-token`, `test:guest-session-stamp`, `test:ask-limiter-identity` | Still PASS |
| Baseline (`test:chunks` 17/17, `test:study-map`, `test:curriculum-resolvers`) | Still green |
| `node --check` (5 files) + import-smoke (`auth.controller`, `chapterProgress.service`, `auth.routes`, `guestMiddleware`) — no import cycle | Clean |

**Files created:** `backend/scripts/test-claim-chat.js`.
**Files edited:**
- `guestMiddleware.js` — extracted `resolveGuestIdFromHeader(raw)` (verified token → gid; legacy bare UUID while flag ≠ `false` → gid; else null); `attachGuest` now calls it.
- `chapterProgress.service.js` — `claimGuestData` also migrates `chat_sessions` (`find` guest sessions → `updateMany` ownership flip → `mode: logged_in`) and syncs `chat_history.userId` by `sessionId`. `sessionId` is a unique UUID so no merge logic is needed (unlike chapter_progress). Return value gains `chatSessionsTransferred`.
- `auth.controller.js` — `claimGuestProgress` resolves the guest id from the **X-Guest-Id header** (verified token, or legacy UUID during transition), with `req.body.guestId` kept as a **UUID-only transition fallback** for the pre-Phase-5 frontend — both legacy paths gated on `GUEST_LEGACY_ACCEPT !== 'false'`, removed in Phase 6. `GUEST_ID_REGEX` comment updated.
- `package.json` — `+test:claim-chat`.

**Behaviour — P2 is functionally fixed now:** the current frontend still POSTs
`{ guestId }` in the body; the controller's transition fallback accepts it and
`claimGuestData` now transfers chat sessions too. So a guest who chats (session
created Phase 3+), then logs in, sees those chats in the sidebar — **without
waiting for Phase 5.** Pre-Phase-3 guest sessions have no `guestId` and remain
unclaimable (accepted — pre-launch guest chat volume ~0).

**Known transition weakness (closed in Phase 6):** while `GUEST_LEGACY_ACCEPT !==
'false'`, a logged-in caller could POST a *guessed* bare-UUID `guestId` to claim
a stranger's guest data. This is not new — the pre-Phase-4 code had the same
body-UUID trust — guest ids are unguessable random UUIDs, and Phase 6 removes the
body/legacy paths entirely, leaving only the unforgeable signed token.

### Phase 5 — Frontend cutover (mint + send token + claim by token)

- **Goal:** browser stops inventing ids; uses the server token end-to-end.
- **Files:** new `frontend/src/utils/guestToken.js` (bootstrap: if no `zuno-guest-token`, POST `/auth/guest` with any legacy `zuno-guest-id` for adoption, store token); [`axiosInstance.js:39-56`](frontend/src/services/axios/axiosInstance.js) and [`tutorApi.js:7-14,242`](frontend/src/api/tutorApi.js) (send the token as `X-Guest-Id`); app bootstrap (mint-if-absent before first guest action, per R-h); [`authService.js:88-99`](frontend/src/services/axios/authService.js) / [`AuthCallback.jsx:47-51`](frontend/src/pages/AuthCallback.jsx) / [`LoginPage.jsx:105-109`](frontend/src/pages/LoginPage.jsx) (claim no longer needs to pass the id in the body — the header token carries it; keep the best-effort, never-throw contract).
- **Test:** `cd frontend && npm run build` clean; manual dev-server pass — guest asks a question, logs in, **guest chat appears in the sidebar** (the P2 acceptance check). (Per the owner's standing rule, interactive verification is done by the owner; Claude does build/syntax only.)
- **DoD:** build clean; owner confirms the sidebar shows the claimed guest chat.
- **Rollback:** frontend revert restores the client-UUID header; backend still accepts it because `GUEST_LEGACY_ACCEPT=true` until Phase 6.

**✅ RESULT — 2026-09-10, branch `guestID` (frontend only — backend untouched):**

| Check | Result |
|---|---|
| `cd frontend && npm run build` | Clean — `✓ built in ~5s`, no errors/warnings |

**Design:** the localStorage key `zuno-guest-id` is **reused** — its *value* changes
from a client UUID to a server-signed token. Every existing reader
(`axiosInstance`, `tutorApi`, `AuthCallback`, `LoginPage`, `useLogout`) keeps
working; it just carries a token now. The backend accepts a stale UUID during the
transition, so nothing breaks between deploy and the first mint.

**Files created:** `frontend/src/utils/guestToken.js` — `ensureGuestToken()`
(idempotent; POSTs `/api/v1/auth/guest`, hands any stored legacy UUID over as
`legacyGuestId` for adoption; on any failure leaves what was there),
`getGuestIdHeader()`, `clearGuestToken()`.
**Files edited:**
- `main.jsx` — `ensureGuestToken()` fire-and-forget right after `injectStore`, earliest point, never blocks render.
- `axiosInstance.js` — `getGuestId()` now just reads `zuno-guest-id` (no UUID generation); the interceptor sets `X-Guest-Id` only when a value exists.
- `tutorApi.js` — same `getGuestId()` change; `askTutor` `await ensureGuestToken()` when a guest has no id yet (the backend rejects a guest `/ask` with no `X-Guest-Id`, so this closes the first-paint race deterministically for the one endpoint that can't degrade).
- `authService.js` — `claimGuestProgress` sends the identity in the `X-Guest-Id` header (token or legacy UUID), not the body.
- `useLogout.js` — `ensureGuestToken()` after clearing, so a logged-out visitor gets a fresh identity without a reload.

`AuthCallback.jsx` / `LoginPage.jsx` unchanged — they read the key, pass it to
`claimGuestProgress`, remove it; all value-agnostic.

**Owner interactive test (P2 acceptance):**
1. Fresh browser / cleared storage → open app as guest. In devtools, `localStorage['zuno-guest-id']` should become a long JWT (three dot-separated parts), and `POST /api/v1/auth/guest` should show `200` in the network tab.
2. Ask 1–2 questions as guest.
3. Log in (email or Google).
4. **The guest chat should appear in the sidebar.** Also check `POST /claim-guest-progress` `200` with `chatSessionsTransferred ≥ 1` in the response.
5. Log out → `zuno-guest-id` re-mints to a new token; guest ask still works.

### Phase 6 — Remove legacy acceptance + finalize (backend + frontend + docs)

- **Goal:** close the forgeable path for good.
- **Do:** delete the legacy paths (not just flag them off); ADR + doc updates.
- **Test:** full baseline + the new suites; a bare-UUID header now resolves to `req.guest = null` — prove the forge path is dead.
- **DoD:** forge path closed; docs + ADR updated; **prod env has `GUEST_TOKEN_SECRET`**.

**✅ RESULT — 2026-09-10, branch `guestID` (after the owner's Phase-5 browser acceptance passed):**

Legacy paths **deleted**, not disabled (Rule 4 — no lingering guard):
- `guestMiddleware.js` — `LEGACY_GUEST_UUID` regex and `resolveGuestIdFromHeader` removed; `attachGuest` calls `verifyGuestToken` directly. Only a signed token is an identity now.
- `auth.controller.js` — `claimGuestProgress` reads `verifyGuestToken(header)` only (no body fallback); `issueGuestToken` always mints a fresh gid (no `legacyGuestId` adoption); `GUEST_ID_REGEX` removed (unused).
- `guestTokenHelpers.js` — `generateGuestToken()` no longer takes an explicit gid.
- `.env.example` — `GUEST_LEGACY_ACCEPT` removed.
- Frontend `guestToken.js` — no longer sends `legacyGuestId`; a stale UUID in storage is just replaced by a fresh mint. `axiosInstance` / `tutorApi` / `AuthCallback` / `LoginPage` / `useLogout` use `getGuestIdHeader()` / `clearGuestToken()` (which treat a non-token value as "no identity").
- Tests — `test-attach-guest.js` rewritten (bare UUID → null always; no flag toggling); `test-guest-token.js` legacy-adoption case removed.

| Check | Result |
|---|---|
| `grep -rn "GUEST_LEGACY_ACCEPT\|resolveGuestIdFromHeader\|legacyGuestId\|GUEST_ID_REGEX" backend/src backend/scripts` | **Zero hits** |
| `grep -rn "zuno-guest-id" frontend/src` | Only `guestToken.js` (the `GUEST_KEY` const) |
| `test:guest-token` / `test:attach-guest` / `test:guest-session-stamp` / `test:claim-chat` / `test:ask-limiter-identity` | All PASS |
| Baseline (`test:chunks` 17/17, `test:study-map`, `test:curriculum-resolvers`) | Green |
| `cd frontend && npm run build` | Clean |
| `node --check` (5 files) + backend import-smoke | Clean |

**Docs:** `docs/decisions/012-server-side-guest-identity.md` (new — the
signed-token-in-header decision + rejected alternatives), `docs/decisions/README.md`
index row, `PROJECT_STATE.md` §3 branch entry (deploy needs `GUEST_TOKEN_SECRET`
+ the index migration).

---

## 7. Whole-branch status — ✅ MERGED to `main` 2026-09-10 (`--no-ff`, `5d2da99`)

All 6 phases committed on `guestID`, merged to `main`. `GUEST_TOKEN_SECRET` set
in the Render + EC2 backend envs by the owner before merge. Owner ran the browser
acceptance (Test 1/2/3) on 2026-09-10 — token mints, guest chat claims onto the
account and shows in the sidebar (P2 fixed), logout re-mints. DoD (§6) met:

1. ✅ Guest identity is server-issued only; a forged/rotated/bare-UUID id → no identity.
2. ✅ After login, guest chat + chapter progress + quiz history transfer; chat appears in the sidebar.
3. ✅ New tests green; baseline green; `frontend` builds clean.
4. ✅ `.env.example`, `PROJECT_STATE.md`, ADR-012 updated. `GUEST_TOKEN_SECRET` set in Render + EC2 envs. The `{ guestId: 1 }` partial index auto-creates via Mongoose `autoIndex` on boot; `backend/scripts/create-chat-session-guest-index.js` does it explicitly if needed.
5. ✅ Merged to `main` 2026-09-10 (`5d2da99`), pushed to `origin/main`. Render + Vercel + EC2 deploy from `main`.

**Post-deploy smoke (prod):** open the site as a guest → `zuno-guest-id` in
localStorage becomes a JWT + `POST /api/v1/auth/guest` → 200; ask a question →
answer streams; log in → `claim-guest-progress` returns `chatSessionsTransferred`
and the guest chat appears in the sidebar.

**Accepted limitation:** guest sessions created before Phase 3 have no `guestId`
and are not claimable (pre-launch guest volume ~0). One such orphan was seen in
the owner's own test data ("Photosynthesis Kya Hai") — expected, harmless.

---

## 5. What this plan deliberately does NOT do

- **No cross-domain cookie for the guest token** — §2.1 decision (avoids the C-2 failure class).
- **No `globalApiLimiter` / Solution A change** — separate Stage-1 branch; do not mix.
- **No change to the 5-turn cap number** — the cap was never the problem; the
  forgeable key was. We fix the key (Rule 4), not the number.
- **No admin/analytics/other-subject scope creep** — out of stage.

---

## 6. Definition of Done (whole branch)

1. A guest identity can only be **issued by the server** (signed); a fabricated or
   rotated bare id resolves to no identity. (P1 closed — proven by the Phase-2
   limiter test.)
2. After login, a guest's **chat history appears in the sidebar**, alongside
   chapter progress and quiz history. (P2 closed — proven by the Phase-4 claim
   test + owner's Phase-5 manual check.)
3. All new tests green; the 3 baseline tests still green; `frontend` builds clean.
4. `GUEST_TOKEN_SECRET` is set in prod; `.env.example`, `PROJECT_STATE.md`,
   `BACKLOG.md`, and a new ADR are updated.
5. Merge to `main` only on the owner's say-so (`AUDIT_RULES.md` — never work on / auto-merge `main`).
