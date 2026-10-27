# ZUNO — Verified Facts for Resume (evidence-only)

Audited on branch `phase1-golden-dump`, which is **at the same commit as `main`**
(`git rev-list --left-right --count main...HEAD` → `0 0`). So "on main" below means
genuinely merged, except where noted as untracked working-tree files.

Labels: **MEASURED** / **COMPUTED** / **DESIGN** / **NOT FOUND**

---

## 1. Cost per turn — "$0.00125"

**Where it came from: `PROJECT_STATE.md:206-218`** (§6 "Cost model — measured, not guessed").
Despite that heading, the derivation there is arithmetic from config, not a logged spend figure.

> `SESSION_TOKEN_LIMIT = 55,000` over ~9 turns → ~6,100 tokens/turn (~5,500 in + ~700 out)
> at `$0.15/1M` in + `$0.60/1M` out → **~$0.00125/turn**

| Input to that math | Status | Proof |
|---|---|---|
| `SESSION_TOKEN_LIMIT=55000` | MEASURED (config) | `backend/.env:86` (note: `backend/.env.example:68` says `15000`, `src/config/env.js:22` defaults to `15000`) |
| "~9 turns" | NOT FOUND | no script or log derives this; it is an assumption |
| "~5,500 in / ~700 out" | NOT FOUND as a log | no saved token log in the repo. The *instrumentation* exists and prints real provider counts per turn: `backend/src/utils/tokenLogger.js:72` `logCallTokens()`, `:130` `logTurnSummary()`, `:106` `logIntentAggregates()`. Nothing persists the output. |
| gpt-4o-mini $0.15/$0.60 per 1M | assumption stated in-repo | `PROJECT_STATE.md:212` |

**Verdict on "$0.00125": COMPUTED, not MEASURED.** It is a config-derived average, and the
per-turn token split inside it is an estimate. Do not call it "measured" on a resume.

### Independent recompute — COMPUTED

Live-measured prompt sizes (ran `approxTokens` = `chars/4` from `tokenLogger.js:16` against the
real exported prompt strings):

```
deciderSystemText : 13,572 chars → ~3,393 tokens   (src/prompts/deciderPrompt.js)
tutorSystemText   : 15,386 chars → ~3,847 tokens   (src/prompts/tutorPrompt.js — legacy path)
```

With `USE_INTENT_ROUTER=true` (`backend/.env:80`) the 2nd call uses a per-intent prompt instead:
`corePersona.js` 2,261 chars (~565 tok) + e.g. `conceptQuestionPrompt.js` 9,428 chars (~2,357 tok)
≈ **~2,900 system tokens**.

A worst-case retrieval turn (`CONCEPT_QUESTION_WITH_CHUNKS`):

```
Call 1 decider : ~3,400 sys + ~500 dyn = ~3,900 in, ~60 out  (maxTokens 350, step4:61)
Call 2 tutor   : ~2,900 sys + ~3,300 retrieved + ~800 history
                 = ~7,000 in, ~1,000 out
                 (5 chunks; 50 chunks measured at 132.2 KB → ~2.6 KB/chunk,
                  LATENCY_PROBLEMS.md:117)
Embeddings     : 2 calls x ~20 tokens, text-embedding-3-large
                 (SafetyNet probe askOrchestrator.js:97 + retrieval in retriever.js)
```

```
input  : 10,900 x $0.15/1M = $0.001635
output :  1,060 x $0.60/1M = $0.000636
embeds :     40 x $0.13/1M = $0.0000052   (negligible)
TOTAL  ~ $0.0023 per retrieval turn
```

**Safe resume phrasing: "~$0.001–0.002 per turn (config-derived)".** `$0.00125` is defensible as
a session *average* across cheap intents (GREETING caps at `maxTokens: 300`) but understates a
full retrieval turn.

---

## 2. Cache layers

**Two cache subsystems x 2 layers each = 4 layers. Plus a third, separate Redis cache.** DESIGN.

| # | Cache | L1 | L2 | TTL | File |
|---|---|---|---|---|---|
| 1 | Embedding | `new Map()`, `L1_MAX = 1000` (FIFO evict), ~24 KB/entry → ~24 MB max | Redis (`ioredis`) | **30 days** (`30*24*60*60`) | `backend/src/cache/embeddingCache.js:25-27` |
| 2 | Retrieval (post-rerank) | `new Map()`, `L1_MAX = 300` | Redis | **24 hours** | `backend/src/cache/retrievalCache.js:27-29` |
| 3 | Chapter progress | — | Redis only | **60 s** (`CACHE_TTL_SEC`) | `backend/src/services/chapterProgress.service.js:23` |

Non-trivial details worth citing (all DESIGN, all code-verified):

- **Redis is optional and never fatal** — every op wrapped so it returns `null` on failure:
  `cache/cacheClient.js:48-78`, with `enableOfflineQueue: false`, `commandTimeout: 2000`.
- **Key normalization** so `"Ohm's Law kya hai?"` and `"ohm's law kya hai"` collide:
  `cache/cacheUtils.js:5-11`; key = first 16 hex chars of SHA-256 (`:15`).
- **Provider-switch auto-bust** — the model name is inside the embedding key, so changing
  `EMBEDDING_PROVIDER` invalidates every entry: `embeddingCache.js:29-32`.
- **Cross-process invalidation** — `rag:index` calls `bumpRagVersion()`; running servers re-poll
  the version every 5 min and clear their own L1: `retrievalCache.js:36-72`.
- **Never cache a fallback-provider vector** (vector-space poisoning guard, BUG-6):
  `embeddingCache.js:107-111` and `retrievalCache.js:147-152`.

### The "600ms" number — DESIGN/estimate, NOT measured

Source is a **code comment**: `backend/src/rag/retriever.js:130`

> `// On a cache hit, Atlas vector search + rerank are skipped entirely (~600-1000ms saved).`

What *is* MEASURED, in `LATENCY_PROBLEMS.md` §1.2 (`:117-127`):

```
production $vectorSearch, 50 candidates, full text : 872 ms median, 132.2 KB
same 50 candidates, scores only                    : 310 ms
plain indexed findOne baseline                     : 314 ms
Redis GET median                                   :  61 ms  (§1.1, :296)
```

So "a retrieval cache hit avoids a **measured 872 ms median** Atlas round trip, paying ~61 ms of
Redis instead" is defensible. "600ms saved" is not — it is an unmeasured comment.

**Honest caveat you should know before an interviewer finds it:** `LATENCY_PROBLEMS.md` F-1
(`:960-995`) proves cache #3 has a **0% hit rate on the `/ask` path** — Step 7 `DEL`s the key the
same turn Step 2 `SETEX`s it, costing ~183 ms/turn (derived). And F-2 (`:999-1032`) records that
the retrieval cache's **real hit rate is UNKNOWN — there is no hit counter anywhere in the repo.**
Do not put a cache hit-rate percentage on your resume.

---

## 3. Frontend / React — strongest work

### a. SSE streaming client with incremental partial-JSON parsing — DESIGN, non-trivial

`frontend/src/api/tutorApi.js:263-330`, inside `askTutor()`.

- Reads `response.body.getReader()` + `TextDecoder('utf-8', {stream:true})`, splits on `\n\n`,
  keeps the trailing fragment in `buffer` so a frame split across TCP packets isn't lost (`:276-278`).
- The LLM streams **raw JSON**, so tokens can't be appended to the DOM directly. It accumulates
  text and runs `parse()` from `partial-json` on the incomplete string each tick, rendering the
  partially-valid object (`:305-316`).
- **Throttled at 33 ms** (~30 fps) to cap React re-renders:
  `if (onUpdate && (now - lastUpdateTime > 33))` (`:308`).
- Three event types on one channel: `token`, `stage` (pipeline progress), `end` (final payload)
  — `:295-305`.
- **Malformed-frame resilience**: one bad frame is skipped, the stream survives — `:285-293`.
- **`StreamIncompleteError`**: reader finished without an `end` event → throws instead of letting
  the caller dereference `payload.session` on `null` — `:321-328`.
- Server side: `backend/src/controllers/ask.controller.js:31-59` — `openStream()` is idempotent via
  a `streamStarted` guard, because both an early `onStage` and Step 6's `onStreamStart` call it.

### b. AbortController cancel — YES, it really aborts end-to-end — DESIGN, code-verified

The full chain exists:

```
ChatPage.jsx:425  new AbortController()
ChatPage.jsx:445  passed as controller.signal into askTutor(...)
tutorApi.js:251   signal handed to fetch()
   ↓ fetch abort / tab close → TCP close
ask.controller.js:10-15  req.on('close') → abortController.abort(new Error('Client disconnected'))
ask.controller.js:65     abortController.signal → askQuestion(...)
   ↓ threaded into every provider call:
step4.decideRetrieval.js:179   signal: abortSignal   ← decider LLM call cancelled
step6.generateResponse.js:184  signal: abortSignal   ← tutor LLM call cancelled
intentRouter.js:303            signal: abortSignal   ← per-intent LLM call cancelled
step5.retrieveContent.js:33-34 early-exit if abortSignal.aborted (skips vector search)
```

Also a **hard 60s server-side timeout** on the same controller: `ask.controller.js:23-26`, with a
distinct student-facing message per abort reason at `:82-95`, and a graceful `event:'end'` frame
carrying `status:'cancelled'` if headers were already flushed (`:89`).
Four client call sites abort: `ChatPage.jsx:192, 381, 597, 740`.

**Caveat for interviews:** "the OpenAI HTTP request is cancelled" is proven by the signal
threading; nobody in this repo measured whether OpenAI stops *billing* at that point.

### c. 401 refresh + request queueing — DESIGN, two independent implementations

`frontend/src/services/axios/axiosInstance.js:17-112`:

- `isRefreshing` flag + `failedQueue` array: concurrent 401s park as promises and all replay with
  the new token (`:74-80`, `processQueue` `:23-32`) — one refresh call, not N.
- Loop guards: `/auth/refresh` and `/auth/login` are excluded from retry (`:66-71`).
- Refresh uses **bare `axios`, not `axiosInstance`**, so the response interceptor can't recurse
  (`:85-91`).
- `injectStore()` (`:10`) breaks the `store → authSlice → axiosInstance → store` import cycle.
- Refresh token is an HttpOnly cookie (`withCredentials: true`, `:14`).

The streaming `/ask` call uses `fetch`, not axios, so it needs its own: `fetchWithTokenRefresh()`
in `tutorApi.js:190-216` — recursive with a `retried` flag, skips refresh for guests
(`store.getState().auth?.accessToken` check, `:193`), and on failure writes a `sessionStorage`
redirect message before `clearCredentials()` (`:209-210`).

### d. Lazy routes / code splitting — DESIGN

`frontend/src/App.jsx:9-18` — **all 10 pages** are `React.lazy()`, one `<Suspense>` boundary at
`:49` with a branded fallback. `isLoading` from `useAuth()` holds the whole tree until the silent
startup refresh resolves, so there is no flash of the wrong page (`:43-45`).

### e. Other non-trivial frontend work

- `frontend/src/utils/guestToken.js` — `ensureGuestToken()` mints a **server-signed** guest token;
  `tutorApi.js:232-237` handles the race where a brand-new guest reaches `/ask` before `main.jsx`'s
  mint resolves. (ADR-012, `docs/decisions/012-server-side-guest-identity.md`.)
- Error **codes**, not strings, drive UI branching: `error.code` / `error.status` attached in
  `tutorApi.js:61-62, 129-131` so `ChatPage` can distinguish `SESSION_USER_MISMATCH` (clear stale
  localStorage) from a network failure, and `QuizModal` can branch 404 / 409 / 429.
- Redux Toolkit + `redux-persist`; `components/ErrorBoundary.jsx`.

---

## 4. Grounding / anti-hallucination — DESIGN (6 independent layers)

1. **Scope list inside the classifier prompt.** The decider is told the exact indexed topic set and
   must emit `OUT_OF_CONTEXT` for anything else: `backend/src/prompts/deciderPrompt.js:85-102`
   (e.g. `:101` → `"Gravitation" = OUT_OF_CONTEXT (not in our Class 10 indexed material)`).
2. **Strict grounding + "material not available" path in the tutor prompt.**
   `backend/src/prompts/tutorPrompt.js:106` — if context is empty, state the active material does
   not contain the topic. `:108` carves out the one exception: an opening hook is framing, not a
   factual claim, and all facts after it still come only from retrieved context. Intents that must
   *not* trigger it are enumerated explicitly: `:46, :61, :67, :75, :96`.
3. **A dedicated no-chunks prompt with no escape hatch.**
   `src/prompts/intents/conceptQuestionPrompt.js:109-110` — when retrieval returned nothing, the
   model is routed to a prompt whose status is **hard-coded** `"insufficient_context"`. The
   with-chunks prompt is deliberately given *no* `insufficient_context` option (`:10-12`), which is
   what stopped it claiming "no material" while holding 5 correct chunks.
4. **Strict JSON contract, validated in code.** `VALID_STATUSES = {answered,
   insufficient_context, needs_clarification, out_of_scope}` — `intentRouter.js:373`,
   `step6.generateResponse.js:231`. Plus code guards that *override* an impossible model status:
   `step6:194-196` (conversation mode may never return `insufficient_context`),
   `intentRouter.js:343-367`.
5. **Score floors in retrieval — the real gate.** `backend/src/rag/retriever.js:30-37, 66-84`:
   `FINAL_SCORE_THRESHOLD 0.65`, `STRONG_VECTOR_SCORE_THRESHOLD 0.70`,
   `TERM_MATCH_VECTOR_SCORE_THRESHOLD 0.62`, `CONTENT_ONLY_VECTOR_THRESHOLD 0.70`.
   `passesFinalFilter()` requires (final ≥ 0.65 **or** a term match at the right vector bar)
   **and** (a term match **or** vector ≥ 0.70 **or** a Devanagari query). The content-only bar is
   raised specifically so "Newton" appearing in the Human Eye chapter body can't leak
   (comment `:34-37`).
6. **SafetyNet (the reverse guard).** When the decider says GREETING/OUT_OF_CONTEXT, a top-1 vector
   probe can upgrade the intent: `src/ask/intentSafetyNet.js`, threshold `0.70` (`:30`), fail-open
   (returns `fired: false` on any error). Called at `askOrchestrator.js:97`.

Core rule also stated as policy in `CLAUDE.md` ("Core product rule") and
`docs/decisions/007-science-only-v1-scope.md`.

---

## 5. Retrieval quality — Hinglish → English translation

**MEASURED. Two separate pieces of evidence.**

### a. The before/after table — `HINGLISH_QUERY_FIX_PLAN.md:95-108`

10 real raw-Hinglish student queries, `topK=5`, global mode, live Atlas,
`text-embedding-3-large` 3072-dim:

| | chunks |
|---|---|
| raw Hinglish | **0 on 10/10** |
| English translation of the same query | **5 on 10/10** |

Root cause, with the actual internal counters (`:112-118`):

```
candidateCountBeforeRerank: 50
countAfterMinScore:         50   ← cleared the 0.55 vector floor
countAfterFinalFiltering:    0   ← all 50 killed by passesFinalFilter()
```

Hinglish tokens (`paudhe`, `khna`, `bnate`) can never term-match English chunk text, and raw vector
scores sat at **0.59–0.69**, under the 0.70 bar.

SafetyNet probe, same 10 queries (`:124-137`): raw **0.5904–0.6863**, 0/10 fire; English
**0.7115–0.8478**, 10/10 fire.
Negative controls (`:141+`): `"Newton ka niyam"` raw 0.6790 → English 0.6566, still does **not**
fire — translation does not manufacture false positives.
Self-audit of what was and wasn't verified: `:529-537`. Result line: `:664-665`.
Commits `2a2597f` (Change B), `eb5b28a` (Change C) — see `:653-655`.

### b. A re-runnable golden dump — `backend/golden/baseline.json` (MEASURED 2026-10-06)

Produced by `backend/scripts/dumpGoldenRetrieval.js` (untracked working-tree file on this branch).
Header: `generatedAt 2026-10-06T16:03:59Z`, `embeddingModel text-embedding-3-large`, `topK 5`,
`minScore 0.55`, **20 queries**, each with full `rawCandidates` + `finalTop5` + debug counters.

Post-fix behaviour, verified by reading the artifact:

```
18 / 18 in-curriculum queries return 1–5 chunks
    raw Hinglish  "photosynthesis kya hai"        → 5
    raw Hinglish  "human digestion explain karo"  → 5
    Devanagari    "रक्त का कार्य क्या है"           → 5
 2 /  2 negative controls return 0 chunks
    "capital of France"                           → 0
    "who won the cricket world cup"               → 0
```

This is a **post-fix snapshot**, not a before/after run. The before/after is (a).

---

## 6. Token optimization — your two claims

### "classifier prompt reduced from ~1,336 to ~320 tokens"

| Part | Status |
|---|---|
| ~1,336 **before** | **MEASURED.** `docs/archive/plans/PIPELINE_OPTIMIZATION_PLAN.md:678` — a real startup log line: `[SYSTEM PROMPTS] Decider: ~1336 \| Tutor: ~2502`. Produced by `backend/src/utils/tokenLogger.js:30`, where `approxTokens = chars/4` (`:16`). |
| ~320 **after** | **NOT FOUND / contradicted.** The only source is a code *comment*: `src/prompts/deciderPrompt.js:3` → `// Phase 2.1.1 — Lean decider prompt (~320 tokens vs ~1,336 before).` The same-day build log at `PIPELINE_OPTIMIZATION_PLAN.md:1830` says **"~578 tokens (vs ~1,336 before) = ~758 tokens saved/turn"** — not 320. |
| **today on `main`** | **MEASURED, just now.** `deciderSystemText` = **13,572 chars → ~3,393 tokens.** The prompt grew back past the trim as Hinglish rules, scope lists and bug-fix rules were added. |

**Do not put "1,336 → 320" on your resume.** It is not true of current `main`, and the strongest
in-repo number for the trim itself is 578, not 320.

What *is* defensible: *"instrumented per-call token accounting (`tokenLogger.js`) and used it to cut
the classifier system prompt from a measured ~1,336 to ~578 tokens (~758 tokens/turn)."*
Or the one that survived better — ADR-004 / per-intent prompts, plus the model split at
`PIPELINE_OPTIMIZATION_PLAN.md:1831`: **"GREETING turn dropped from ~5,500 to 3,494 tokens
(~36% reduction)"**, which is a MEASURED turn-level result.

### "~450 tokens saved by not sending the curriculum every turn"

- **The mechanism is live and real — DESIGN.** `backend/src/ask/step6.generateResponse.js:95-116`,
  `needsCurriculum(intent, responseMode, focusChapterPrompt, retrievedContext)` — 6 explicit
  branches. Comment at `:95-97`: *"Curriculum list (~450 tokens) is only useful in specific turns.
  Sending it on every turn is the single largest avoidable waste in the prompt."*
- **The ~450 number is an ESTIMATE, not measured.** `docs/archive/plans/TOKEN_FIX_PLAN.md:229`
  says literally **"Estimated savings: ~450 tokens on ~80% of turns"**; `:233` explains it is the
  16-chapter `curriculumSummary`. `:268` records the intended check ("tutor input should drop ~450
  tokens") — **no result of that check is recorded anywhere in the repo.**

Safe phrasing: *"gated a ~450-token curriculum block behind a 6-branch intent check so it is sent
only on the turns that reference it."* Drop "measured".

---

## 7. Deployment / CI-CD — what is actually on `main`

### GitHub Actions — 2 workflows, both on `main` ✅

**`.github/workflows/ci.yml`** — "CI — Test & Build", on push + PR to `main`. Two parallel jobs:

- `backend-tests` (ubuntu-latest, Node 20, npm cache keyed on `backend/package-lock.json`):
  `npm ci` → `test:chunks` → `test:study-map` → `curriculum:build` → `test:curriculum-resolvers`.
  The `curriculum:build` step exists because `curriculum-index.json` is gitignored (comment in file).
- `frontend-build`: `npm ci` → `npm run build` with `VITE_API_BASE_URL` set to a placeholder.

**`.github/workflows/deploy-ec2.yml`** — "Deploy to EC2", on push to `main`. Uses
`appleboy/ssh-action@v1.0.3` with `secrets.EC2_HOST` / `EC2_USERNAME` / `EC2_SSH_KEY`, and runs one
command: `bash /home/ubuntu/deploy-zuno.sh`.
Introduced by commits `7e18445` "add EC2 deploy workflow", `9d947bb` "test EC2 deploy after opening
port 22", `a27f793` "test ec2 deploy again".

| Thing | Status |
|---|---|
| **AWS EC2 deploy over SSH** | ✅ on `main` — `deploy-ec2.yml`. DESIGN. |
| **Nginx** | **NOT FOUND on `main`.** Zero `nginx` hits across all `*.md` and `backend/src`. The only Nginx artifact is `frontend/nginx.conf` (12 lines, SPA `try_files` fallback) — **untracked, not committed, not on `main`.** |
| **Route 53** | **NOT FOUND.** No mention anywhere in the repo. |
| **The deploy script itself** | **NOT FOUND in repo** — `deploy-zuno.sh` lives on the EC2 box. So whatever Nginx/PM2/systemd config runs in production is **not provable from this codebase**. |
| **Render** | DESIGN/doc. `DEPLOYMENT_PLAN.md:353` → `https://zuno-backend-85ea.onrender.com`, kept awake by a 5-min UptimeRobot ping on `/health`. `PROJECT_STATE.md:78` records the tier as **Render FREE** — "sleeps after 15 min, cold start ~50s, must upgrade before launch". |
| **Vercel** | DESIGN/doc. Frontend on Vercel — `PROJECT_STATE.md:79`, `DEPLOYMENT_PLAN.md:107-119`. A build break from a Playwright prerender step was fixed in `eb9eb9e` / merge `0253427`. |
| **Docker** | **Partially merged.** `backend/Dockerfile` ✅ on `main` (commit `effc560`) — but currently **modified in the working tree, uncommitted**. `.dockerignore` ✅ on `main`. `docker-compose.yml` (2 services: `backend`, `frontend`), `frontend/Dockerfile`, `frontend/nginx.conf` are all **untracked — NOT on `main`**. |
| **Sentry** | **NO.** Not installed, not initialized, nowhere in `package.json` or `src/`. The only hit in the whole repo is `STAGE1_DONE.md:50`, an **unticked** checklist item: `- [~] I4. Error monitoring live (Sentry free tier, …)`. Do not list Sentry. |
| **Message queue (BullMQ / RabbitMQ / Kafka / SQS)** | **NO.** Zero hits outside an unrelated `package-lock.json` hash collision. |

**Resume-safe deployment line:** GitHub Actions CI (parallel backend-test + frontend-build jobs)
plus SSH-based auto-deploy to AWS EC2 on every `main` push; backend on Render, frontend on Vercel;
backend Dockerfile merged, full Compose stack in progress.
**Remove Nginx, Route 53, Sentry, and any queue** unless you can show config outside this repo.

---

## 8. Scale numbers — exact counts

| Metric | Exact | Proof |
|---|---|---|
| **Chapters** | **16** content chapters (+1 `meta/science-overview.md` = 17 loaded docs) | `find data/class-10 -name "*.md"`: biology 6, chemistry 5, physics 5. `npm run test:chunks` Test 3 → "Loader returns exactly **17** documents"; Test 14 → "covers all 17 chapters". ⚠️ `CLAUDE.md` says "16 chapters (4 bio / 5 chem / 7 physics)" — that split is **stale**; the total is right. |
| **Content chunks** | **629** | MEASURED twice. `npm run test:chunks` type distribution sums to 629 (concept 195, mixed 165, question 83, example 59, table 52, definition 41, formula 19, activity 11, diagram_reference 4). And in production: `LATENCY_PROBLEMS.md:1109-1110` → `Chunk.countDocuments() : 303 ms (629 docs)`. ⚠️ `CLAUDE.md` says "600 chunks expected" — stale. |
| **Embedding dimensions** | **3072** | `src/rag/geminiEmbeddings.js:175` `dimensions: 3072`; enforced by a schema validator at `src/models/chunk.model.js:18-21` ("Embedding must have exactly 3072 dimensions"). Both providers are 3072-dim so the Atlas index is provider-agnostic (`geminiEmbeddings.js:10`). |
| **Intent types** | **9** classifier intents → **10** routing branches | 9 numbered in `src/prompts/deciderPrompt.js:10-106` (GREETING, CHOOSE_COURSE, NEXT_STEP, EXPLAIN_MORE, CONCEPT_QUESTION, EXAM_INFO, EMOTIONAL_SUPPORT, OUT_OF_CONTEXT, UNSAFE_OR_ABUSIVE), validated by `VALID_INTENTS` at `src/ask/step4.decideRetrieval.js:36`. `INTENT_CONFIG` has 10 keys (`src/ask/intentRouter.js:61-70`) because CONCEPT_QUESTION splits into `_WITH_CHUNKS` / `_NO_CHUNKS`. |
| **Pipeline steps** | **7** | `src/ask/askOrchestrator.js:13-19`; files `step1.`…`step7.` |
| **LLM calls per turn** | **2** chat completions (+ up to 2 embedding calls) | `askOrchestrator.js:16` "← 1st LLM call", `:18` "← 2nd LLM call"; ADR-001 `docs/decisions/001-two-llm-call-pipeline.md`. Embeddings: SafetyNet probe (`askOrchestrator.js:97`) + retrieval. `CHAPTER_COMPLETE` skips call 2 entirely (`askOrchestrator.js:166`). |
| **Quiz questions** | **743** seeded (16 chapter files under `data/quiz-bank/science/`) + **1,126** in an unseeded bulk file `data/quiz-bank/bank/questions.json` = 1,869 authored total | counted by parsing every JSON file. `scripts/seed-quiz-bank.js:23` seeds **only** `data/quiz-bank/science`. **Use 743** — that is what reaches the `question_bank` collection. |
| **MongoDB collections** | **10** | `chapter_progress`, `chat_history`, `chat_sessions`, `chunks`, `question_bank`, `quiz_attempts`, `quiz_sessions`, `study_events`, `support_requests`, `users` — 10 model files in `src/models/`; explicit `collection:` names, with `chunks`/`users` using Mongoose default pluralization. |
| **Rate-limit layers** | **9** `express-rate-limit` limiters + 1 custom daily-quota middleware = **10** | `src/middlewares/rateLimiters.js`: `globalApiLimiter:40`, `askApiLimiter:59`, `authApiLimiter:76`, `quizGenerateLimiter:93`, `quizSubmitLimiter:110`, `quizHistoryLimiter:128`, `supportApiLimiter:146`, `guestMintLimiter:169`, plus the shared `identityKeyGenerator:24`. Custom: `src/middlewares/guestRateLimit.js:4`. Redis-backed via `rate-limit-redis`. ⚠️ `CLAUDE.md` says "three tiers" — stale. |

---

## TOP 5 hardest engineering problems solved

### 1. Hinglish queries retrieved literally nothing — a structural hard zero, not a weak match

**Problem.** Students type Hinglish (`"paudhe apna khna kaise bnate hai"`). The retriever returned
**0 chunks on 10/10** real queries. The filter was not marginally strict — all 50 candidates cleared
the 0.55 vector floor and then **all 50** were dropped: Hinglish tokens can never term-match English
chunk text, and raw vector scores sat at 0.59–0.69 against a 0.70 bar. Meanwhile the decider was
*already computing* an English translation and throwing it away.

**What was done.** Translate once in the classifier, then route every language-sensitive downstream
consumer through that single English `searchQuery` — retrieval, the SafetyNet probe, and the
glossary. Explicitly **not** done: lowering the 0.70 threshold (measured: 8/10 scored below 0.65, so
lowering it would have admitted cross-topic noise and still returned 0 chunks).

**Where.** `backend/src/prompts/deciderPrompt.js` (rule 7, `:126`), `src/ask/askOrchestrator.js:97`,
`src/ask/intentSafetyNet.js:22-30`, `src/rag/retriever.js`. Plan + evidence:
`HINGLISH_QUERY_FIX_PLAN.md:88-167`. Commits `2a2597f`, `eb5b28a`.

**Number.** 0 chunks on 10/10 → **5 correct chunks on 10/10**. SafetyNet probe 0/10 firing → 10/10,
while the `"Newton ka niyam"` negative control stayed below threshold (0.6566). MEASURED.

### 2. A failing embedding provider would silently poison retrieval for 30 days (BUG-6)

**Problem.** Two 3072-dim providers (OpenAI primary, Gemini fallback) live in **different vector
spaces**. The query-time fallback existed for availability — but the cache layer happily wrote a
Gemini-space vector under the normal key with a 30-day TTL. One OpenAI outage would keep returning
mismatched chunks long after OpenAI recovered, with no error surfaced anywhere.

**What was done.** Propagate a `cacheable` flag out of the embedding call and refuse to persist
fallback-derived data at **both** layers; indexing never falls back at all, since mixing providers in
one store is unrecoverable without a full re-index.

**Where.** `src/cache/embeddingCache.js:40-50` (the contract) and `:107-111` (the refusal);
`src/cache/retrievalCache.js:147-152` (`!result.usedFallback`); `src/rag/geminiEmbeddings.js`
`embedQueryWithMeta`. Test: `npm run test:no-cache-fallback`.

**Number.** Blast radius removed: the full **30-day** embedding TTL + **24-hour** retrieval TTL.

### 3. One rate-limit bucket for an entire school (BUG-8)

**Problem.** `askApiLimiter` was keyed on raw IP. Every student behind one school NAT or one
phone-carrier CGNAT shared a single quota — the first few users would lock out the rest. A limiter
that breaks precisely at the moment it matters.

**What was done.** Key on **identity** (authenticated user id → signed guest id → IP last) via a
shared `identityKeyGenerator`, rather than raising the number — raising it would have been the
symptom patch and would have re-broken under a bigger classroom.

**Where.** `src/middlewares/rateLimiters.js:24` (`identityKeyGenerator`), applied at `:59`.
Commit `c75d997`, merge `1086b36`. Test: `npm run test:ask-limiter-identity`.

**Honesty note.** `globalApiLimiter` (`rateLimiters.js:40`) **still has the same raw-IP cause** —
knowingly parked as `BACKLOG.md` R6 / BUG-8b, blocking single-classroom onboarding. Mention this if
asked; it shows you track known debt instead of claiming a clean sweep.

### 4. Migrating the vector store to Atlas, then finding the win was being eaten by payload

**Problem.** The original store was a LangChain `MemoryVectorStore` persisted to JSON — it loaded
every vector into process memory on boot and could not survive a serverless restart. Migrated to
MongoDB Atlas `$vectorSearch` (ADR-002). But the retrieval path then fetched **50 candidate documents
with full text and the 3072-float `embedding` field** — ~24 KB of useless float per doc.

**What was done.** Projection-level exclusion of `embedding` on the deterministic topic lookup; the
`$vectorSearch` payload cost was then measured rather than guessed.

**Where.** `src/rag/retriever.js:103-105` (`Chunk.find(query, { embedding: 0 }).lean()`, BUG-5),
`src/models/chunk.model.js`, `docs/decisions/002-mongodb-atlas-vector-search.md`. Evidence:
`LATENCY_PROBLEMS.md:117-131`.

**Number.** MEASURED on the same link: 50 candidates **scores only = 310 ms / 3.5 KB** vs
**full text = 872 ms / 132.2 KB** — i.e. the Atlas round trip itself is ~310 ms (≈ the 314 ms
plain-`findOne` baseline) and **~562 ms is pure payload transfer**.

### 5. A streamed answer that looked complete but arrived as unparseable JSON — and had no way to stop

**Problem.** The tutor streams a **JSON object**, so nothing can be rendered until it parses — yet
the student watches tokens arrive. Three distinct failure modes: (a) a token cap truncates the JSON
mid-string and the student who just watched a full answer gets an error; (b) one malformed SSE frame
killed the entire stream; (c) closing the tab left the LLM call running and billing.

**What was done.** Incremental `partial-json` parsing of the accumulated buffer, throttled to 33 ms
so React isn't re-rendered per token; per-frame `try/catch` so a bad frame is skipped rather than
fatal; an explicit `StreamIncompleteError` when the reader ends with no `end` event; and a single
`AbortController` threaded from the browser through `req.on('close')` into every provider call,
sharing one path with a hard 60s server timeout.

**Where.** `frontend/src/api/tutorApi.js:263-330`; `backend/src/controllers/ask.controller.js:7-26,
82-95`; signal consumed at `step4.decideRetrieval.js:179`, `step6.generateResponse.js:184`,
`intentRouter.js:303`, `step5.retrieveContent.js:33`.

**Number.** DESIGN — no latency or billing measurement exists for this. The truncation class is still
open, tracked as `BACKLOG.md` R1 (`finish_reason === 'length'` salvage not yet built).

**Honourable mentions.** ADR-011 decider structured output; ADR-012 server-signed guest identity
replacing a client-generated UUID, with guest→user session claiming on login; and
`LATENCY_PROBLEMS.md` itself — an audit that proved one of the project's own caches has a **0% hit
rate on the hot path** (F-1, `:960-995`) rather than assuming it worked.

---

## Claims to DELETE from your resume

| Claim | Why |
|---|---|
| "classifier prompt 1,336 → 320 tokens" | `320` is an unverified comment; the same-day log says 578; **current `main` measures ~3,393**. |
| "measured $0.00125/turn" | COMPUTED from config, not measured. Say "~$0.001–0.002/turn, config-derived". |
| "600ms latency saved by caching" | Code comment. Use the real measured figure: an Atlas retrieval round trip is **872 ms median**. |
| any cache hit-rate % | No counter exists — `LATENCY_PROBLEMS.md` F-2 records the hit rate as UNKNOWN. |
| Sentry | Not installed. Unticked checklist item only. |
| Nginx / Route 53 | Not provable from this repo; the only Nginx file is untracked and not on `main`. |
| BullMQ / message queue | Not present. |
| "600 chunks" | Actual **629**, measured twice. |
| "1,869 quiz questions" | Only **743** are seeded; 1,126 sit in an unseeded bulk file. |
| "3 rate-limit tiers" | Actual **9** limiters + 1 custom middleware. |
