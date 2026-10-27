# Zuno: Pre-Launch Master Problem Breakdown & Execution Tracker

> **Last Updated:** 2026-06-23
> **Owner:** Senior Engineer & Product Manager (AI Assistant)
> **Goal:** Track and execute all remaining blockers before making Zuno live.
> **Codebase Read:** Complete — Backend + Frontend both fully audited on 2026-06-23.

---

## How to Use This File (Execution Protocol)

Yeh file AI Assistant ke liye ek Master Guide hai. Jab bhi user kisi problem par kaam shuru karne bole, yeh rules strict order mein follow karne hain:

**Execution Steps (For Every Single Task):**

1. **Step 1: Deep Explanation & Breakdown** — Problem ka deep explanation, examples ke saath, kyu hai aur agar fix na ki toh kya hoga. User se confirm karo.
2. **Step 2: Multiple Solutions & Tradeoff Analysis** — 2-3 solutions, har ek ke hidden challenges + edge cases ke saath.
3. **Step 3: PM/Architect Suggestion** — Best recommended solution with strong reasoning.
4. **Step 4: Robust Implementation Plan** — Detailed plan present karo. User approval ke baad hi code likhna shuru karo.
5. **Step 5: Code Implementation** — Simple code jo junior engineer bhi samajhe. Existing architectural patterns match karo. No over-engineering.

---

## Status Tracker

`[ ]` = pending | `[~]` = in progress | `[x]` = done | `[!]` = blocked

---

## P0: CRITICAL — Production Deploy Se Pehle Fix Zaroori (Ye Baaki Sab Se Pehle)

---

### [x] P0.1 — No Streaming API (DONE)
**Status:** Complete. Backend SSE streaming + Frontend incremental render working.

---

### [x] P0.2 — Missing Rate Limiter & DDoS Protection (DONE)
**Status:** Complete. Three-tier rate limiting added (global/ask/auth).
> ⚠️ Note: Rate limiters exist but use in-memory store — see C-2 below for production fix needed.

---

### [x] P0.3 — Missing Request Timeout (DONE)
**Status:** Complete. 60-second AbortController timeout in ask.controller.js.

---

### [x] P0.4 — Vector Store JSON → MongoDB Atlas (DONE)
**Status:** Complete. MongoDB Atlas Vector Search ($vectorSearch) with Chunk model in use.

---

### [~] P0.5 — Deployment / CI-CD Pipeline (IN PROGRESS — Last Step)
**Status:** Pending. Docker + Railway/Render deployment not yet set up.
**Blocked by:** All CRITICAL and HIGH issues below must be fixed first.

---

## CRITICAL — Launch Se Pehle Fix Karo (App Break Kar Denge Production Mein)

---

### [x] C-1 — Google OAuth Access Token URL Mein Exposed Hai

**Files:** `backend/src/controllers/auth.controller.js:547` | `frontend/src/pages/AuthCallback.jsx:39`

**Core Problem:**
Google OAuth login complete hone ke baad, backend frontend ko redirect karta hai is URL ke saath:
```
https://zuno.app/auth/callback?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
Full JWT access token — GET parameter ke roop mein — URL mein clearly visible hai.

**Kahan hai code mein:**
```js
// auth.controller.js line 547
return res.redirect(`${FRONTEND_URL}/auth/callback?token=${accessToken}`);

// AuthCallback.jsx line 39
const tokenParam = params.get('token');  // directly URL se token read
```

**Kaise exploit hota hai — 5 real attack scenarios:**

1. **Shared Computer Attack (Most likely for Bihar students):** Cyber café ya school computer pe student Google se login karta hai. Token browser history mein save ho jata hai. Agla student `Ctrl+H` karta hai, URL copy karta hai, apne browser mein paste karta hai — student #1 ka account completely hijack.

2. **Browser Extension Attack:** Koi malicious Chrome extension jaise "Free Recharge", "Exam Tips" (jo students frequently install karte hain) jo page URLs track karta hai — woh token silently steal kar sakta hai.

3. **Server Log Leak:** Railway/Render ke access logs mein har request ka full URL store hota hai. Agar log dashboard ka password weak hai ya koi team member ko access hai — token visible.

4. **HTTP Referer Leak:** Agar student callback URL pe hai aur kisi external link pe click karta hai, browser HTTP Referer header mein us URL ko bhejta hai — token third-party server ke logs mein ja sakta hai.

5. **Screenshot/Screen Recording:** Student screen record kar raha tha ya screenshot liya — token clearly visible address bar mein.

**Impact:**
- JWT access token 15 minute valid rahta hai
- Is 15 minute ki window mein attacker full account access kar sakta hai
- `/api/v1/sessions` se sari chat history, `/api/v1/ask` se Zuno ko questions — sab access

**Sahi Solution:**
Backend URL mein token nahi dega. Ek one-time `code` (random 32-char string) Redis mein store karega (30 second TTL). Frontend woh code se token exchange karega via POST — token kabhi URL mein aayega hi nahi.

```
Current:  backend → redirect to /auth/callback?token=JWT
Fixed:    backend → Redis.set("oauth_code:abc123", JWT, EX=30)
                  → redirect to /auth/callback?code=abc123
          frontend → POST /api/v1/auth/exchange { code: "abc123" }
                   → server: Redis.get("oauth_code:abc123") → returns JWT in JSON body
```

---

### [x] C-2 — Cookie `sameSite: 'strict'` — Cross-Domain Production Deployment Mein Token Refresh Completely Broken

**Files:** `backend/src/controllers/auth.controller.js` (lines 185, 279, 321, 540 — ALL cookie sets)

**Core Problem:**
Refresh token HttpOnly cookie har jagah `sameSite: 'strict'` ke saath set hota hai:
```js
res.cookie('refreshToken', refreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',   // ← PROBLEM
  maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
});
```

`sameSite: 'strict'` ka matlab browser ke liye yeh hai:
> "Yeh cookie sirf tab bhejo jab request same site se aaye jahan cookie set hui thi."

**Deployment Reality:**
```
Frontend: https://zuno.vercel.app        (Vercel)
Backend:  https://api.zuno.railway.app   (Railway)
```
Yeh alag domains hain — cross-origin requests hain.

**Kya break hota hai:**
Jab student ka 15-min access token expire hota hai, `axiosInstance.js` ka interceptor silently `POST /api/v1/auth/refresh` call karta hai. Yeh request `zuno.vercel.app` se `api.zuno.railway.app` ko jaati hai — cross-origin.

Browser ki rule: `sameSite: 'strict'` ke saath, cross-origin POST mein cookie NAHI bhejega.

Server ko refreshToken cookie nahi milti → 401 error → `clearCredentials()` dispatch → **student logout ho jata hai bich session mein.**

**Real User Experience:**
1. Student login karta hai (8 PM)
2. 30 minute padhai karta hai
3. 8:15 PM — access token expire
4. 8:15 PM mein koi bhi non-ask request (sidebar load, etc.) → axios interceptor refresh try karta hai → cookie nahi milti → logout
5. Student ka poora session history wahan tha, ab home page par landed
6. Student sochta hai "Zuno kharab hai" — chala jata hai

**4 jagah yeh bug hai (sab fix hone chahiye):**
- `login()` controller mein refresh token set
- `register()` controller mein (after auto-login)
- `refreshToken()` controller mein (rotation pe)
- Google OAuth `googleCallback()` mein

**Fix:**
```js
// Har cookie set mein yeh change karo:
sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
// secure: true already production mein set hai — 'none' needs secure:true, so this works
```

---

## HIGH — Launch Se Pehle Fix Strongly Recommended

---

### [x] H-1 — Rate Limiters In-Memory Store — Multi-Instance Par DDoS Protection Bypass

**File:** `backend/src/middlewares/rateLimiters.js`

**Core Problem:**
Teeno rate limiters mein koi `store:` option specify nahi kiya gaya:
```js
export const askApiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  // store: ???  ← koi store nahi = MemoryStore (default)
});
```

Default `MemoryStore` = counters Node.js process ki RAM mein store hote hain.

**Problem with scaling:**
Agar Railway pe 2 instances hain (automatic scaling):
```
Attacker → Instance A: 29 requests (not blocked, counter = 29)
Attacker → Instance B: 29 requests (not blocked, counter = 29)
Total actual requests: 58 in 1 minute
Actual limit: 30 per minute
Bypassed: YES
```

Har new instance fresh counter se start karta hai — attackers ko pata hota hai yeh trick.

**LLM cost impact:**
Ek Groq `llama-3.3-70b` call ~₹0.5-2 cost karta hai. 58 unthrottled calls/minute = ₹30-120/minute wasted.

**Fix:** `rate-limit-redis` package. Same Redis client already available hai — sirf `store` option add karna hai.

---

### [x] H-2 — `askTutor` Raw Fetch — Access Token Expiry Pe Auto-Refresh Nahi Hota (Real Bug)

**File:** `frontend/src/api/tutorApi.js:66`

**Core Problem:**
App mein do alag request paths hain:

```
Path A (axiosInstance): fetchStudyMap, fetchSessions, fetchSessionHistory, etc.
  → Axios interceptor: 401 detect karta hai → silent token refresh → request retry → user ko pata hi nahi chala

Path B (raw fetch): askTutor (line 66-171)
  → Koi interceptor nahi → 401 aaya → directly error throw → student ko error message
```

**Sabse critical function sabse vulnerable path use karta hai.**

**Real Failure Timeline:**
```
8:00 PM  — Student login karta hai (access token valid until 8:15 PM)
8:14 PM  — Student kuch padhta hai, sidebar load hota hai (axios → auto-refresh होता है, naya token milta hai)
8:16 PM  — Student ek question type karta hai, Send dabata hai
8:16 PM  — askTutor() Redux store se token read karta hai
           Problem: Redux store mein purana 8:14 PM wala token tha jo already refresh hua tha
           Wait — actually after refresh, setCredentials dispatch hota hai — store update hota hai ✓
           
NEW scenario:
8:00 PM  — Login (token valid until 8:15)
8:15 PM  — Student tab pe focus nahi karta (background mein open)
           Koi axios request nahi hoti → koi auto-refresh nahi hota
8:20 PM  — Student wapas aata hai, question type karta hai
8:20 PM  — askTutor() expired token ke saath fetch karta hai → 401
           Axios interceptor: NEVER runs (yeh fetch call hai, axios nahi)
           Error catch block: "Something went wrong while talking to Zuno."
           Student confused
```

**AppInitializer ke baad bhi yeh bug exist karta hai:** AppInitializer sirf page load pe ek baar refresh karta hai. Agar user tab 16+ minute baad active kare, token expire ho chuka hai aur koi background refresh nahi hoga — ask call fail karega.

**Fix Option A (Recommended):** `askTutor` ko bhi `axiosInstance` pe migrate karo. SSE streaming ke liye `axiosInstance` `responseType: 'stream'` support karta hai.

**Fix Option B:** `askTutor` mein manual 401 check add karo — refresh endpoint call karo, naya token lo, retry karo.

---

### [x] H-3 — Missing Helmet.js — Koi HTTP Security Headers Nahi

**File:** `backend/src/app.js`

**Core Problem:**
`app.js` mein sirf yeh headers set hain (CORS wale):
```js
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
// Koi aur security header nahi
```

Yeh important security headers completely absent hain:

| Missing Header | Real World Attack |
|---|---|
| `X-Frame-Options: DENY` | Zuno ko ek malicious site iframe mein embed kar sakti hai — clickjacking |
| `X-Content-Type-Options: nosniff` | Browser JS file ko image samajh ke execute karne ki koshish kar sakta hai |
| `Strict-Transport-Security` | User HTTPS se HTTP pe redirect ho sakta hai (downgrade attack) |
| `Referrer-Policy: strict-origin` | `/api/v1/ask` jaisi internal URLs Referer header mein third-party sites ko leak ho sakti hain |
| `X-XSS-Protection: 1; mode=block` | Older browsers (Chrome 60 era) pe basic XSS protection nahi |

**Clickjacking Example (Most Likely Attack):**
```html
<!-- Attacker ki website -->
<div style="position: relative">
  <button style="position: absolute; z-index: 100; top: 50px">
    Free Bihar Board Notes Download Karo!
  </button>
  <iframe src="https://zuno.app" 
          style="opacity: 0.01; position: absolute; top: 0; left: 0; 
                 width: 500px; height: 300px">
  </iframe>
</div>
```
Student "Free Notes" button dekhta hai, click karta hai — actually Zuno ki "Delete Chat" button pe click ho jata hai. Yeh basic clickjacking hai.

**Fix:** `npm install helmet` + `app.use(helmet())` — ek line, poori OWASP security header checklist cover ho jati hai.

---

### [x] H-4 — Production Code Mein Debug `console.log` Statements

**Files:** `step5.retrieveContent.js:52-54`, `step3.buildContext.js`, `step4.decideRetrieval.js:130`, `step6.generateResponse.js:150`, `step7.saveAndRespond.js:142`, `intentRouter.js:251`, `ask.controller.js:12`

**Core Problem:**
Har request pe 15-20 console.log statements fire hote hain:
```
[DEBUG step5] intent: CONCEPT_QUESTION
[DEBUG step5] chatState.currentChapterId: ch_electricity
[DEBUG step5] chatState.currentTopicId: t_electric_current
step3.buildContext.js: Pre-processing contextual runtime serialization...
Language Verification Matrix -> Target Response Script: hinglish
[Step 4] Running intent classifier...
[Step 7 Commiting] Writing updates atomically for Session ID: 64abc123def456...
[Drift] GREETING → consecutive 3 → 4
```

**3 Real Problems:**

1. **Privacy:** Session IDs, user queries, intent decisions sab server logs mein permanent record hote hain. Railway/Render log dashboards mein yeh visible hote hain — GDPR/privacy concern.

2. **Cost:** Railway/Render log storage ke liye charge karte hain after free tier. 100 students × 10 questions × 15 log lines = 15,000 log lines/hour. Zyada costly.

3. **Debuggability:** Real errors (actual exceptions, stack traces) is noise mein dub jaate hain. Production incident mein actual problem dhundhna bahut mushkil ho jaata hai.

**Fix:** Debug-specific logs ko production mein hide karo:
```js
// Option A: Guard with NODE_ENV
if (process.env.NODE_ENV !== 'production') console.log('[DEBUG step5]...');

// Option B: Remove [DEBUG ...] lines completely (real error logs rakhna zaroori hai)
```

---

## P2: MEDIUM — Technical Debt (Core Functionality Mein Improvement)

---

### [x] P2.1 — No Embedding API Caching — Double Gemini Call on Academic Queries

**Files:** `backend/src/rag/retriever.js` | `backend/src/cache/embeddingCache.js` | `backend/src/cache/retrievalCache.js`

**Status:** Complete. Two-layer cache (L1 in-memory Map + L2 Redis 30-day TTL) implemented in `src/cache/`. `retriever.js` wraps full pipeline in `retrievalCache.getOrFetch()`. `embeddingCache` covers embedding API calls.

**Core Problem (archived):**
Jab koi academic query safety net se guzarti hai (decider ne galti se GREETING classify kiya), pipeline yeh karta hai:

```
Student: "photosynthesis kaise hoti hai?"
Step 4: Decider → GREETING (wrong classification)
Safety Net: embeddings.embedQuery("photosynthesis...") → Gemini API Call #1
            score = 0.82 (high) → override to CONCEPT_QUESTION
Step 5: retrieveRelevantChunks() → embeddings.embedQuery("photosynthesis...") → Gemini API Call #2
```

SAME query ke liye 2x Gemini embedding calls. Koi bhi cache nahi hai.

**Cost/Latency Impact:**
- Gemini embedding: ~100-300ms latency per call
- If 20% academic queries are misclassified by decider: 20% of all requests = 1.5x embedding cost
- 500 users/day × 5 questions × 20% misclassified × 2x cost = 500 extra Gemini calls/day unnecessary

**Fix:** Redis cache wrapper:
```js
// key: "embed:" + sha256(query), TTL: 1 hour
// Same query → cache hit → zero Gemini cost, near-zero latency
```
Redis already installed — sirf ek helper function banana hai.

---

### [x] P2.2 — `sessionId` UUID Validation Missing

**File:** `backend/src/ask/step1.validateInput.js`

**Core Problem:**
```js
// step1.validateInput.js — sessionId validation:
if (sessionId !== undefined && sessionId !== null && String(sessionId).trim()) {
  validated.sessionId = String(sessionId).trim();
  // koi format check nahi — koi bhi string accept
}
```

Koi UUID format validation nahi. Attacker kuch bhi bhej sakta hai:
```json
{ "sessionId": "' OR '1'='1" }
{ "sessionId": "../../etc/passwd" }
{ "sessionId": "aaaa...aaaa (2000 characters)" }
{ "sessionId": "<script>alert(1)</script>" }
```

**Kya actually hota hai:** MongoDB Mongoose `findOne({ sessionId: maliciousString })` run karta hai — query injection nahi hoti (MongoDB ke saath NoSQL injection ka yeh pattern kaam nahi karta), but:
- 2000-char session ID ke saath unnecessary DB roundtrip hoti hai
- Log mein garbage appear hoti hai
- Future mein agar sessionId processing code change hua — attack surface khul sakta hai

**Fix:** 3-line UUID regex check:
```js
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (sessionId && !UUID_REGEX.test(sessionId)) {
  throw new ApiError(400, 'Invalid session ID format.');
}
```

---

### [ ] P2.3 — Helmet.js & Security Headers Missing

*(Already detailed above in H-3 — same issue, tracked here for P2 list continuity)*

---

### [x] P2.4 — Frontend Error Boundaries Missing

**Files:** `frontend/src/App.jsx`, `frontend/src/pages/ChatPage.jsx`

**Core Problem:**
React 19 mein koi `<ErrorBoundary>` component nahi wrap kiya gaya. Agar kisi component mein uncaught runtime error aata hai, React pura component tree unmount kar deta hai.

Result: **Blank white screen. Koi message nahi. Student ke paas koi recovery option nahi.**

**Real Failure Example:**
Backend response mein `sections` field null aaye:
```json
{ "status": "answered", "sections": null, "answer": "..." }
```

`ChatMessage.jsx` render karta hai:
```js
message.sections.filter(s => s?.heading || s?.content)
// TypeError: Cannot read properties of null (reading 'filter')
```

React 19: Error boundary nahi hai → pura ChatPage crash → white screen → student ko reload karna padta hai, saari state bhi kho jati hai.

**Impact:** Yeh "what if" nahi hai — malformed LLM responses baar baar hote hain (parse errors, partial JSON, etc.). Error boundary ke bina har such error = student ko white screen dikhta hai.

**Fix:** `ErrorBoundary.jsx` class component banao (sirf class components error boundary ban sakte hain React mein), `ChatPage` ko wrap karo:
```jsx
<ErrorBoundary fallback={<RecoveryScreen />}>
  <ChatPage />
</ErrorBoundary>
```
Recovery screen mein: "Kuch technical problem aayi. Page reload karo." + Reload button.

---

## LOW — Minor Correctness Issues

---

### [x] L-1 — Timeout Comment Mismatch (45s Says, 60s Does)

**File:** `backend/src/controllers/ask.controller.js:21-25`

```js
// Set a hard 45-second timeout for the LLM pipeline  ← comment: 45s
timeoutId = setTimeout(() => {
  abortController.abort(new Error('Timeout'));
}, 60000);  // ← actual code: 60s
```

Comment aur implementation mein 15 second ka gap hai. Future developer timeout "55s" pe set karna chahega, comment padh ke 45+10=55s mein change karega but actually 75s ho jaayega.

**Fix:** `// Set a hard 60-second timeout` — ek word change.

---

### [x] L-2 — EXAM_INFO Intent INTENT_MEMORY_WHITELIST Mein Missing

**File:** `backend/src/ask/step7.saveAndRespond.js:37-44`

```js
const INTENT_MEMORY_WHITELIST = {
  GREETING:          [],
  OUT_OF_CONTEXT:    [],
  UNSAFE_OR_ABUSIVE: [],
  CHOOSE_COURSE:     ['currentSubjectId', 'currentSectionId', ...],
  EXPLAIN_MORE:      ['lastDoubtTopic', 'lastDoubtQuestion'],
  CONCEPT_QUESTION:  ['lastTopic', 'lastDoubtTopic', ...],
  NEXT_STEP:         ['lastTopic', 'learningMode'],
  // EXAM_INFO: ???  ← nahi hai
};
```

Currently EXAM_INFO intent `memoryUpdate: {}` return karta hai — koi field nahi — toh koi bug nahi hai aaj.

Lekin agar future mein EXAM_INFO ke prompt mein memory tracking add ki (e.g., "student ne exam year pucha"), code `ALLOWED_STATE_FIELDS` ke broad allowlist par fall through karega instead of controlled `[]`. Yeh ek latent bug hai — aaj silent, future mein unexpected chatState pollution.

**Fix:** `EXAM_INFO: []` explicitly add karo — principle of least surprise.

---

### [x] L-3 — Morgan 'dev' Format Always — Production Pe Wrong

**File:** `backend/src/app.js:26`

```js
app.use(morgan('dev'));  // always dev format — even in production
```

`morgan('dev')` = colorized, verbose, developer-friendly format. Production pe yeh problems:
- ANSI color codes log files mein garbage characters create karte hain
- Less structured — log parsing tools ke saath kaam nahi karta
- More verbose than needed

**Fix:**
```js
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
```

---

## Session System Bugs — Found via Deep Audit (2026-06-25)

---

### [x] S-1 — Login Ke Baad Stale Guest SessionId → Pehla Message Fail

**Files:** `session.controller.js` | `ApiError.js` | `error.middleware.js` | `tutorApi.js` | `ChatPage.jsx`

**Problem:** Guest session use karta hai → localStorage mein `sessionId` save hoti hai → user login karta hai → history fetch hoti hai → backend 404 deta hai (guest session, `userId: null` ≠ logged-in userId) → frontend catch block `sessionId` clear nahi karta → user pehla question bhejta hai → backend 403 "Yeh session aapka nahi hai" → confusing error.

**Fix:** `ApiError` mein optional `code` field add kiya. `getSessionHistory` mein `SESSION_USER_MISMATCH` code. `fetchSessionHistory` ab throw karta hai (null nahi). `ChatPage.jsx` catch block mein sirf is code pe `clearSessionId()` + `setSessionId('')`.

---

### [x] S-2 — Mid-Stream Error Pe Partial Message Leak

**File:** `ChatPage.jsx`

**Problem:** Streaming chalu hota hai → `tempMessageId` message UI mein add hota hai → mid-stream network error → catch block sirf new error message append karta tha, temp message nahi hatata → UI mein do messages dikhte: [partial frozen content] + [error].

**Fix:** Catch block mein `!isFirstUpdate` check. Agar streaming shuru ho chuki thi → partial message in-place `status: 'error'` ya `'cancelled'` update. No duplicate message.

---

### [x] S-3 — Teen Guest Tracking Systems (Dead Code + Security Gap)

**Files:** `guestRateLimit.js` | `queryCount.js`

**Problem:**
- `guest_turns:guestId` (lifetime, 30-day TTL) + `guest_query:guestId` (daily, midnight TTL) — dono limit = 5. Daily limit mathematically dead code tha (lifetime always fires first).
- `guestRateLimit.js` mein `if (!guestId) return next()` — no guestId = unlimited access. UUID validation sirf `queryCount.js` mein thi.
- `guestRateLimit.js` development mein skip nahi hota tha — 5 turns baad local testing block.

**Fix:** `guestRateLimit.js` mein UUID validation add + dev skip. `queryCount.js` guest branch remove → `!req.user` pe `return next()` (function hang prevented). Single source of truth: sirf `guest_turns:guestId`.

---

### [x] S-4 — `lean: true` Invalid Mongoose Option

**File:** `chatHistory.service.js`

**Problem:** `findOneAndUpdate()` options mein `lean: true` pass kiya — Mongoose silently ignore karta hai, full Mongoose document return hota hai plain object ki jagah. Extra memory overhead.

**Fix:** `lean: true` options se hata ke `.lean()` method chain kiya.

---

## Complete Priority Execution Order

```
DEPLOY SE PEHLE (NO EXCEPTIONS):
  [x] C-1  Google OAuth token URL mein exposed      auth.controller.js + AuthCallback.jsx
  [x] C-2  Cookie sameSite: strict cross-domain     auth.controller.js (4 places)
  [x] H-2  askTutor raw fetch bypass               tutorApi.js
  [x] H-3  Helmet.js missing                       app.js
  [x] H-4  Debug logs in production                step1/2/intentRouter/askOrchestrator

STRONGLY RECOMMENDED BEFORE LAUNCH:
  [x] H-1  Rate limiters in-memory store            rateLimiters.js + RedisStore
  [x] P2.4 Frontend Error Boundaries               ErrorBoundary.jsx

TECHNICAL DEBT (Post-Launch 30 Days):
  [x] P2.1 Embedding API Caching                   cache/embeddingCache.js + cache/retrievalCache.js
  [x] P2.2 sessionId UUID validation               step1.validateInput.js
  [x] P2.3 Helmet.js                               (same as H-3 — done)

MINOR FIXES:
  [x] L-1  Timeout comment mismatch                ask.controller.js
  [x] L-2  EXAM_INFO in whitelist                  step7.saveAndRespond.js
  [x] L-3  Morgan format in prod                   app.js

SESSION SYSTEM BUGS (Found via deep audit 2026-06-25):
  [x] S-1  Login baad stale guest sessionId        session.controller.js + tutorApi.js + ChatPage.jsx
  [x] S-2  Mid-stream error partial message leak   ChatPage.jsx
  [x] S-3  Teen guest tracking systems             guestRateLimit.js + queryCount.js
  [x] S-4  lean: true invalid option               chatHistory.service.js

DEPLOYMENT (Final Step):
  [~] P0.5 Docker + CI/CD                          Dockerfile + railway.toml
```

---

## Active Task Workspace

**Current Active Task:** None — awaiting user direction.

**Last Completed:** Session system deep audit + all 4 bugs fixed (2026-06-25).

---

### [ ] P1 — BLOCKER: Switch Email Provider from Nodemailer (SMTP) to Resend API

**Status:** Pending.
**Context:** Render blocks outbound SMTP ports (587, 465) on the free tier. As a result, email verification is currently bypassed in `auth.controller.js`. Must migrate to an API-based provider like Resend before real users sign up.

**Action Required:**
- Get a custom domain verified in Resend.
- Replace nodemailer code in `emailHelpers.js` with the Resend SDK.
- Re-enable email verification in `auth.controller.js`.

---

### [ ] Content-1 — Missing Foundation/Orientation Content

**Status:** Pending — carried forward from an old CLAUDE.md status note (originally flagged 2026-06-03), not tracked anywhere else until now.
**Context:** Curated foundation/orientation Markdown content (e.g. "Science kya hai?", study skills intro) was never authored. The vector store only contains the 16 chapter files (biology/chemistry/physics) — no onboarding/orientation material for students.

**Action Required (if prioritized):**
- Author orientation content in `data/class-10/science/`.
- Re-run `npm run rag:index` to rebuild the vector store.
