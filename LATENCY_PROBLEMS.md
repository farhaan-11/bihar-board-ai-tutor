# LATENCY_PROBLEMS.md — Zuno

> **This file lists PROBLEMS ONLY. There are no solutions in here, by design.**
> Solutions, trade-offs and code go in a separate file (`LATENCY_SOLUTIONS.md`),
> written after this one is agreed.
>
> **Scope:** why a student waits so long after pressing send on `POST /api/v1/ask`.
> Not "database optimization" alone — the whole path: middleware → 7 steps →
> 2 LLM calls → cache → MongoDB → SSE → browser render.
>
> **Audited:** 2026-09-10
> **Branch:** `latency-audit`, cut from `main` @ `a27f793`
> **Divergence at audit time:** ahead 0, behind 0 ✅ (`AUDIT_RULES.md` Rule 1)
> **Working tree at audit time:** clean

---

## 0. How to read this file

### 0.1 The trust rule

You said you want to trust this file blindly later. So every single claim
below carries one of three labels. Nothing else is allowed in this file.

| Label | Meaning |
|---|---|
| 📏 **MEASURED** | A number produced by actually running something on 2026-09-10. The exact command is included so you can re-run it. |
| 🔍 **CODE FACT** | Something read directly out of the repo. `file:line` given. You can open it and see it. |
| 🧮 **DERIVED** | Arithmetic on top of a MEASURED or CODE FACT value. The arithmetic is shown. |
| ❓ **UNKNOWN** | Honestly not known. Listed in §5 with what is needed to find out. |

If a statement has no label, it is a heading or a definition — not a claim.

### 0.2 Where the measurements came from (read this before quoting any ms)

All 📏 MEASURED millisecond numbers were taken on **2026-09-10** from:

- **Machine:** the owner's Windows laptop, on his home/office internet in India
- **To:** MongoDB Atlas cluster `ac-safovil-shard-00-*.t6fzfdw.mongodb.net`, database `zuno_prod`
- **To:** the Upstash Redis instance in `REDIS_URL`

**This is NOT the production network path.** Production runs on Render, which
sits in a different region with a different link to Atlas and Upstash. The
absolute millisecond numbers on Render will be different — possibly much lower.

**But the database itself IS production.** `backend/.env` points at `zuno_prod` —
the same database Render uses (confirmed by the owner, 2026-09-10). So every
payload size, collection count, index plan and document-shape number in this file
is production-accurate. Only the app→DB round-trip time differs between "audit
laptop in India" and "Render".

**So which numbers are safe to trust anywhere?**

| Type of number | Location-dependent? | Safe to trust? |
|---|---|---|
| Round-trip **counts** (how many times we talk to Mongo/Redis per turn) | No | ✅ Yes |
| **Payload sizes** in KB | No | ✅ Yes |
| **Ratios** between two operations measured back-to-back on the same link | Mostly no | ✅ Yes |
| Absolute **ms** figures | **Yes** | ⚠️ Treat as "shape of the problem", not as production truth |

Everywhere below, the reasoning is built on counts, sizes and ratios — never on
absolute ms alone.

### 0.3 What was deliberately NOT measured

**The two LLM calls were not timed.** Timing them means spending the owner's
OpenAI credits without asking first. They are almost certainly the largest single
block of time in the request — and that is exactly the problem: **nobody has
measured them, and today the code cannot measure them** (see `A-1`).

This is listed as ❓ UNKNOWN, not guessed at.

### 0.4 How to reproduce every measurement here

All measurements were run as throwaway `.mjs` scripts inside `backend/`
(so `node_modules` resolves) and deleted afterwards. Nothing was committed.
The exact script body for each measurement is given inline with the finding.

---

## 1. The measured baseline

These are the raw numbers everything else refers back to.

### 1.1 Network round trips

📏 MEASURED — 10 samples each, sorted, median reported.

| Operation | Samples (ms) | Median |
|---|---|---|
| MongoDB `findOne` by indexed field, `.lean()` | 269, 293, 298, 307, 308, 314, 316, 322, 343, 1800 | **314 ms** |
| Redis `GET` (tiny key, Upstash) | 25, 28, 39, 40, 55, 61, 85, 103, 103, 122 | **61 ms** |
| `mongoose.connect()` (cold) | single run | **2,524 ms** |
| Redis connect (cold) | single run | **263 ms** |

**Note the 1800 ms outlier on Mongo.** 1 sample in 10. That is a real tail —
Atlas connections occasionally stall. It matters because the pipeline has no
per-operation timeout (see `I-2`).

### 1.2 Atlas Vector Search — the important one

📏 MEASURED. Same random 3072-dim query vector used for every variant, so the
vector maths is identical across rows and only the shape changes.

Script used:
```js
const fake = Array.from({length:3072},()=>Math.random()-0.5);
await Chunk.aggregate([
  { $vectorSearch:{ index:'vector_index', path:'embedding',
                    queryVector: fake, numCandidates: N, limit: N } },
  { $project: PROJECTION },
]);
```

| Variant | numCandidates / limit | Projection | Median | Payload |
|---|---|---|---|---|
| **What production actually runs** | 50 / 50 | `pageContent` + `metadata` | **872 ms** | **132.2 KB** |
| Same, but only 5 results | 5 / 5 | `pageContent` + `metadata` | 289 ms | 15.1 KB |
| Same 50, but scores only | 50 / 50 | `chunk_id` + score | 310 ms | 3.5 KB |

🧮 **DERIVED — this is the single most important derivation in this file:**

```
50 candidates, scores only ......... 310 ms   (≈ the plain findOne baseline of 314 ms)
50 candidates, full text ........... 872 ms
                                     -------
difference .......................... 562 ms
```

The vector maths for 50 candidates costs **almost nothing above a normal round
trip** (310 ms vs 314 ms baseline). **Effectively all of the extra ~562 ms is the
cost of moving 132 KB of chunk text across the network.**

Plain Hinglish: `$vectorSearch` slow nahi hai. **Data ka size slow hai.**

### 1.3 What is inside that 132 KB

📏 MEASURED — byte breakdown of one real 50-candidate response.

```
docs returned                                       : 50
TOTAL payload                                       : 136.8 KB
  pageContent only                                  :  59.4 KB
  metadata only                                     :  72.8 KB   ← bigger than the content
    of which metadata.originalText                  :  38.2 KB   ← never read at query time
  metadata IF trimmed to only the fields code reads :  14.6 KB
```

🔍 CODE FACT — the pipeline keeps **5** of those 50.
`backend/src/rag/retriever.config.js:9` → `defaultTopK: 5`
`backend/src/rag/retriever.js:220` → `filteredResults.slice(0, topK)`

📏 MEASURED — the 5 kept chunks are **10.5 KB**.

🧮 DERIVED: **136.8 KB is fetched. 10.5 KB survives. ~126 KB (92%) is discarded
after crossing the network.**

### 1.4 Other measured facts

| What | Value | How |
|---|---|---|
| `getStudyMap()` cold (parses 17 markdown files) | 📏 **235 ms** | first call after process start |
| `getStudyMap()` warm | 📏 **0 ms** | in-memory cache |
| `loadCurriculumIndex()` cold | 📏 **10 ms** | reads + parses `curriculum-index.json` |
| `Chunk.countDocuments()` (runs at every boot) | 📏 **303 ms** | `server.js:17` |
| `Chunk.estimatedDocumentCount()` (same answer, 629) | 📏 **312 ms** | comparison |
| One `embeddingCache` L2 entry, JSON-serialized | 📏 **59.1 KB** | `JSON.stringify(3072 floats)` |
| `retrieveChunksByTopicId` (plain indexed find) | 📏 266–323 ms | 5 samples |

---

## 2. The full request map

This is one `/ask` turn: logged-in student, Focus Mode, a real
`CONCEPT_QUESTION`, cold caches. Every line is 🔍 CODE FACT with its location.

Read the **`Wait?`** column. `BLOCKING` means the student is sitting there and
nothing is on screen yet.

| # | What happens | Where | Kind | Wait? |
|---|---|---|---|---|
| 1 | `globalApiLimiter` | `app.js:60` | Redis | BLOCKING |
| 2 | `optionalAuth` → `User.findById` | `auth/authMiddleware.js:22` | **Mongo** | BLOCKING |
| 3 | `attachGuest` → JWT verify | `auth/guestMiddleware.js:26` | CPU only ✅ | — |
| 4 | `askApiLimiter` | `routes/ask.routes.js:14` | Redis | BLOCKING |
| 5 | `guestRateLimit` — returns early for logged-in ✅ | `middlewares/guestRateLimit.js:6` | none | — |
| 6 | `queryCountMiddleware` → `redis.set` then `redis.incr` | `middlewares/queryCount.js:31-32` | **Redis ×2, sequential** | BLOCKING |
| 7 | **Step 1** `validateInput` → `findStudyMapChapter` | `ask/step1.validateInput.js:74` | cached after boot | BLOCKING (cold: 235 ms) |
| 8 | **Step 2** `Promise.all([findChatSession, getRecentChatHistory])` ✅ | `ask/step2.loadSession.js:21-24` | **Mongo ×2 in parallel** | BLOCKING |
| 9 | **Step 2** `getChapterProgress` → Redis GET | `services/chapterProgress.service.js:99` | Redis | BLOCKING |
| 10 | **Step 2** → cache miss → `ChapterProgress.findOne` | `services/chapterProgress.service.js:102` | Mongo | BLOCKING |
| 11 | **Step 2** → `redisSetex` | `services/chapterProgress.service.js:104` | Redis | BLOCKING |
| 12 | **Step 3** `buildContext` → `getStudyMap()` (cached) | `ask/step3.buildContext.js:80` | memory ✅ | — |
| 13 | 📡 first SSE byte: `stage: "deciding"` | `askOrchestrator.js:82` | — | student finally sees *something* |
| 14 | **Step 4** 🤖 **LLM CALL #1 — decider, NOT streamed** | `ask/step4.decideRetrieval.js:172` | OpenAI | BLOCKING ❓ |
| 15 | *(conditional)* SafetyNet → **2nd embedding API call** | `ask/intentSafetyNet.js:41` | OpenAI | BLOCKING |
| 16 | *(conditional)* SafetyNet → 2nd `$vectorSearch` | `ask/intentSafetyNet.js:62` | Mongo | BLOCKING |
| 17 | **Step 5** `retrievalCache` → Redis GET | `cache/retrievalCache.js:114` | Redis | BLOCKING |
| 18 | **Step 5** `embeddingCache` → Redis GET | `cache/embeddingCache.js:65` | Redis | BLOCKING |
| 19 | **Step 5** 🤖 **embedding API call** | `cache/embeddingCache.js:87` | OpenAI | BLOCKING ❓ |
| 20 | **Step 5** `$vectorSearch`, 50 candidates, full text | `rag/retriever.js:194` | **Mongo, 136.8 KB** | BLOCKING (📏 872 ms) |
| 21 | *(conditional)* out-of-focus fallback → **whole retrieval again** | `ask/step5.retrieveContent.js:213` | Redis + Mongo | BLOCKING |
| 22 | **Step 6** 🤖 **LLM CALL #2 — tutor, streamed** | `ask/intentRouter.js:302` | OpenAI | streams ✅ |
| 23 | **Step 7** `updateChatSession` | `ask/step7.saveAndRespond.js:291` | Mongo | after last token |
| 24 | **Step 7** `upsertChapterProgress` → `findOne` #1 | `services/chapterProgress.service.js:146` | Mongo | after last token |
| 25 | **Step 7** `upsertChapterProgress` → `findOne` #2 | `services/chapterProgress.service.js:155` | Mongo | after last token |
| 26 | **Step 7** `upsertChapterProgress` → `findOneAndUpdate` | `services/chapterProgress.service.js:194` | Mongo | after last token |
| 27 | **Step 7** `invalidateCache` → Redis DEL | `services/chapterProgress.service.js:215` | Redis | after last token |
| 28 | **Step 7** `addChatMessages` → `chat_history` write | `services/chatHistory.service.js:23` | Mongo | after last token |
| 29 | **Step 7** `updateChatSessionLastMessageTime` → `chat_sessions` **again** | `services/chatHistory.service.js:41` | Mongo | after last token |
| 30 | 📡 SSE `end` event → UI unlocks | `askOrchestrator.js:174-177` | — | student finally free |

### 2.1 Round-trip count (🧮 DERIVED from the table above)

| Phase | Mongo | Redis | LLM / embedding API |
|---|---|---|---|
| Before Step 4 (nothing on screen) | **3** | **5** | 0 |
| Step 4 → Step 6 | 1 (+1 if SafetyNet) | 2 | **2–4** |
| Step 7 (after the answer finished) | **5** | 1 | 0 |
| **Total per turn** | **9–10** | **8** | **2–4** |

**17–18 network round trips to our own infrastructure, plus 2–4 to OpenAI,
for one student question.** Almost all of them one after another.

### 2.2 The three waits a student actually feels

🧮 DERIVED from the table:

```
WAIT 1  "I pressed send and nothing happened"
        = rows 1..13   (8 round trips, all sequential, zero UI feedback)

WAIT 2  "It says 'deciding'/'searching' but no answer yet"
        = rows 14..21  (LLM #1 fully blocking + embedding + 136.8 KB vector search)

WAIT 3  "The answer stopped but the app is still busy"
        = rows 23..30  (6 more round trips before the SSE 'end' event)
```

---

## 3. The problems

---

## Group A — You cannot see where the time goes

### A-1 · There is no timing instrumentation anywhere in the request path

**What:** Not a single one of the 7 steps records how long it took. There is no
per-request total. The two LLM calls — very likely the biggest cost — are not
timed at all.

**Location:** absence, verified across `backend/src/`.

**Evidence** — 🔍 CODE FACT. Repo-wide search for any timing primitive:

```bash
grep -rn "Date.now()\|performance.now()\|console.time\|hrtime\|durationMs\|elapsed\|latency" \
     --include=*.js backend/src | grep -vi "expiresAt\|createdAt\|new Date()"
```

Every single hit is inside `cache/embeddingCache.js` or `cache/retrievalCache.js`.
There are **zero** hits in `ask/`, `controllers/`, `services/`, `rag/retriever.js`.

**And even those two are invisible in production** — 🔍 CODE FACT, every timing
log line is wrapped in the `isDev` guard:
- `cache/retrievalCache.js:25` → `const isDev = process.env.NODE_ENV !== 'production'`
- `cache/retrievalCache.js:109, 122, 136` → all `if (isDev) console.log(...)`
- `cache/embeddingCache.js:61, 74, 88` → same

**What `tokenLogger` does and does not do** — 🔍 CODE FACT: `utils/tokenLogger.js`
logs token counts (`logCallTokens`, `logTurnSummary`, `logContextSizes`).
It contains no time measurement of any kind.

**Why this is problem number one:** every other item in this file is a
*structural* problem — provable by reading code and counting round trips. But
nobody can currently say "the decider takes X ms in production". Any fix shipped
today cannot be proven to have worked.

**Confidence:** 🔍 CODE FACT — certain.

---

### A-2 · Two cache files document a Redis latency that does not match reality

**What:** Both cache files state Redis fetch is `~3ms`. Measured from the audit
machine it is 61 ms median for a *tiny* key.

**Location** — 🔍 CODE FACT, 4 places:
- `backend/src/cache/embeddingCache.js:10` → `L2 (Redis): Persistent across restarts. ~3ms fetch.`
- `backend/src/cache/embeddingCache.js:65` → `// L2 check — Redis, ~3ms, persistent across restarts`
- `backend/src/cache/retrievalCache.js:11` → `L2 (Redis): Persistent. ~3ms fetch. 24-hour TTL.`
- `backend/src/cache/retrievalCache.js:113` → `// L2 check — Redis, ~3ms, persistent across restarts`

**Evidence** — 📏 MEASURED (§1.1): Redis `GET` median **61 ms**, samples 25–122 ms.

**Important honesty note:** `~3ms` may well be accurate *from inside Render's
region*. This is not proof the comment is wrong in production — it is proof that
**the number in the comment was never verified on the audit machine and is not
verified anywhere in the repo.** It is an unsourced number being used to justify
design decisions.

**Why it costs latency:** the whole two-layer cache design assumes "L2 is nearly
free, so always check it". If L2 is 61 ms and not 3 ms, then on a **cache miss**
the code pays 61 ms *before* starting the real work — and the retrieval path
checks L2 twice (retrieval cache + embedding cache, rows 17 and 18).

**Confidence:** 🔍 CODE FACT for the comments. 📏 MEASURED for the audit-machine
number. ❓ UNKNOWN for the production number — see §5 Q4.

---

## Group B — Work that happens before the pipeline even starts

### B-1 · 8 sequential network round trips fire before the student sees anything

**What:** rows 1–13 of §2. Five Redis round trips and three MongoDB round trips
run one after another before the first SSE byte (`stage: "deciding"`) is written.

**Location** — 🔍 CODE FACT:

| Round trip | File:line |
|---|---|
| `globalApiLimiter` (Redis) | `backend/src/app.js:60` |
| `User.findById` (Mongo) | `backend/src/auth/authMiddleware.js:22` |
| `askApiLimiter` (Redis) | `backend/src/routes/ask.routes.js:14` |
| `redis.set(key, 0, 'EX', ttl, 'NX')` | `backend/src/middlewares/queryCount.js:31` |
| `redis.incr(key)` | `backend/src/middlewares/queryCount.js:32` |
| `ChatSession.findOne` ‖ `ChatHistory.findOne` (parallel ✅) | `backend/src/ask/step2.loadSession.js:21-24` |
| `redis.get` chapter progress | `backend/src/services/chapterProgress.service.js:99` |
| `ChapterProgress.findOne` | `backend/src/services/chapterProgress.service.js:102` |
| `redis.setex` chapter progress | `backend/src/services/chapterProgress.service.js:104` |

**Evidence that they are sequential, not parallel:** every one is a bare `await`
on its own line, in its own middleware or step. The only `Promise.all` in the
entire pre-LLM path is `step2.loadSession.js:21`.

**Why it costs latency:** these 8 trips have to finish before `askOrchestrator.js:82`
opens the SSE pipe. Until then the student's screen shows nothing at all.

🧮 DERIVED using the audit machine's numbers (5 × 61 ms Redis + 3 × 314 ms Mongo,
minus one saved by the `Promise.all`) ≈ **~990 ms of pure waiting** on the audit
link. On Render this number will be smaller — but **the count of 8 sequential
trips is the same everywhere.**

**Confidence:** 🔍 CODE FACT for the count and ordering. 🧮 DERIVED for the ms.

---

### B-2 · The two `queryCount` Redis calls are sequential and always both run

**What:** `redis.set(...,'NX')` then `redis.incr(...)` — two separate awaits, two
round trips, on every logged-in request.

**Location:** `backend/src/middlewares/queryCount.js:31-32`

🔍 CODE FACT:
```js
const ttl = secondsTillMidnightIST();
await redis.set(key, 0, 'EX', ttl, 'NX');
const count = Number(await redis.incr(key));
```

**Why it costs latency:** the `SET ... NX` is a no-op on every request except the
day's first, but the round trip is paid every time. Two blocking trips where the
information needed is one number.

**Confidence:** 🔍 CODE FACT.

---

### B-3 · `optionalAuth` loads the entire user document, unprojected and unlean, on every request

**What:** a full Mongoose-hydrated `User` document is fetched for every
authenticated request to any endpoint.

**Location:** `backend/src/auth/authMiddleware.js:22`

🔍 CODE FACT:
```js
const user = await User.findById(decoded.userId);
```

No `.lean()`, no projection. 🔍 CODE FACT — `backend/src/models/user.model.js` shows
the document includes `passwordHash` (line 19), `googleId` (line 30) and 9 other fields.

🔍 CODE FACT — what the request actually uses downstream:
- `controllers/ask.controller.js:18` → `req.user?.id`
- `middlewares/queryCount.js:24` → `req.user.plan`
- `middlewares/queryCount.js:26` → `req.user._id`
- `auth/authMiddleware.js:24` → `user.isActive`
- `auth/authMiddleware.js:51` → `user.role`

Five scalar fields. The rest of the document — including the bcrypt hash — is
fetched and hydrated into a Mongoose model instance on every request.

**Why it costs latency:** one blocking Mongo round trip (📏 314 ms median on the
audit link) plus Mongoose document hydration, per request, for data that barely
changes.

**Confidence:** 🔍 CODE FACT.

---

## Group C — The chain is serial by construction

### C-1 · The decider (LLM call #1) is fully blocking and cannot stream

**What:** Step 4 uses `.invoke()`, not `.stream()`. The student waits for the
entire classification to complete with no output at all.

**Location:** `backend/src/ask/step4.decideRetrieval.js:172`

🔍 CODE FACT:
```js
const decision = await getDeciderChain().invoke( { ... } );
```

🔍 CODE FACT — the chain is built with `withStructuredOutput` at
`step4.decideRetrieval.js:64`, and a budget of 350 output tokens at line 61:
```js
const model = createChatModel({ ...getDeciderConfig(), maxTokens: 350 });
```

**Why streaming is not simply available here:** `withStructuredOutput` produces a
single validated object. There is no partial object to emit. This is a real
constraint of the current design (ADR-011), not an oversight — recorded here as
a *cost*, not as a mistake.

**Why it costs latency:** the tutor call (Step 6) cannot start until this finishes,
because `retrieveContent` needs `decision.searchQuery`
(`askOrchestrator.js:164` consumes `decision` produced at line 83). **Two LLM
round trips are strictly one after the other**, and the first one is invisible.

**Duration:** ❓ UNKNOWN — never measured (see `A-1`, §5 Q1).

**Confidence:** 🔍 CODE FACT for the structure. ❓ UNKNOWN for the cost.

---

### C-2 · Step 7's database writes run after the answer finishes, and block the SSE `end` event

**What:** after the last token of the answer has streamed, the pipeline performs
5 more MongoDB round trips and 1 Redis round trip before telling the frontend
the turn is over.

**Location** — 🔍 CODE FACT, the ordering in `backend/src/ask/askOrchestrator.js`:
```
line 172:  const response     = await generateResponse(...)   ← streaming ends here
line 174:  const finalPayload = await saveAndRespond(...)     ← all of Step 7 runs here
line 177:  streamCallbacks.onComplete(finalPayload)           ← SSE 'end' fires here
```

And `backend/src/controllers/ask.controller.js:53-57` — `onComplete` is what writes
the `end` frame and calls `res.end()`.

🔍 CODE FACT — what runs between line 172 and line 177:

| Write | Location |
|---|---|
| `updateChatSession` (Mongo) | `ask/step7.saveAndRespond.js:291` |
| `upsertChapterProgress` → `findOne` #1 | `services/chapterProgress.service.js:146` |
| `upsertChapterProgress` → `findOne` #2 | `services/chapterProgress.service.js:155` |
| `upsertChapterProgress` → `findOneAndUpdate` | `services/chapterProgress.service.js:194` |
| `invalidateCache` → Redis `DEL` | `services/chapterProgress.service.js:215` |
| `addChatMessages` → `chat_history` write | `services/chatHistory.service.js:23` |
| `addChatMessages` → `chat_sessions` write **again** | `services/chatHistory.service.js:41` |

**Every one is a bare sequential `await`.** There is no `Promise.all` anywhere in
Step 7.

🧮 DERIVED on the audit link: 6 × ~314 ms + 1 × ~61 ms ≈ **~1.9 seconds** of dead
time *after* the student has already finished reading the answer.

**Why the student feels it** — 🔍 CODE FACT: the frontend only receives
`suggestedActions`, `sources`, `chapterProgress` and the session lock state in the
`end` payload (`step7.saveAndRespond.js:433-464`). Until `end` arrives, the action
chips and the source pills cannot render, and the UI cannot mark the turn complete.

**Confidence:** 🔍 CODE FACT for the ordering and the count. 🧮 DERIVED for the ms.

---

### C-3 · The out-of-focus fallback silently runs a second full retrieval

**What:** in Focus Mode, if the chapter-scoped search returns 0 chunks *or* only
weak matches, the pipeline runs the entire retrieval again with no chapter filter.

**Location:** `backend/src/ask/step5.retrieveContent.js:213`

🔍 CODE FACT:
```js
const globalRetrieval = await retrieveRelevantChunks(searchQuery, { topK: 3 });
```

🔍 CODE FACT — the trigger condition, `step5.retrieveContent.js:208-210`:
```js
const hasOnlyWeakMatches = chunks.length > 0 && chunks.every((chunk) => !hasHeadingOrChapterTermMatch(chunk));

if (intent === 'CONCEPT_QUESTION' && focusChapter && (chunks.length === 0 || hasOnlyWeakMatches)) {
```

**Why it costs latency:** `retrieveRelevantChunks` is the *whole* retrieval path —
`retriever.js:131` (retrieval cache) → `retriever.js:145` (embedding cache) →
`retriever.js:194` (`$vectorSearch`). So this branch costs a second Redis GET, a
second embedding cache lookup, and a **second 136.8 KB vector search**.

🧮 DERIVED: this branch roughly **doubles** the entire Step 5 cost, and it fires
precisely when the student asked something the chapter doesn't cover — the case
where they are already most likely to be frustrated.

**How often does it fire?** ❓ UNKNOWN — there is no production counter (`A-1`).

**Confidence:** 🔍 CODE FACT for the code path. ❓ UNKNOWN for frequency.

---

### C-4 · The Academic Safety Net makes an extra embedding call that bypasses the embedding cache

**What:** `probeAcademicSimilarity` calls the embedding provider directly instead
of going through `embeddingCache`, so the same query gets embedded twice — once
uncached here, once cached in Step 5.

**Location:** `backend/src/ask/intentSafetyNet.js:40-41`

🔍 CODE FACT:
```js
const embeddings = createQueryEmbeddings();
const queryEmbedding = await embeddings.embedQuery(String(query || ''));
```

🔍 CODE FACT — compare with the cached path used everywhere else,
`backend/src/rag/retriever.js:145`:
```js
const queryEmbedding = await embeddingCache.getOrFetch(query, async () => { ... });
```

`intentSafetyNet.js` does not import `embeddingCache` at all — 🔍 CODE FACT,
verified against its import block (lines 1–10 contain no cache import).

**When it fires** — 🔍 CODE FACT, `askOrchestrator.js:95-97`:
```js
const SAFETY_NET_TARGETS = new Set(['GREETING', 'OUT_OF_CONTEXT']);
if (SAFETY_NET_TARGETS.has(decision.intent) && decision.englishQuery) {
  const { score, fired } = await probeAcademicSimilarity(decision.englishQuery);
```

**Why it costs latency:** on every `GREETING` / `OUT_OF_CONTEXT` turn that carries
an English translation, the student pays an extra full embedding API round trip
plus an extra `$vectorSearch` (`intentSafetyNet.js:62`) — **and it is charged to
their wait time even when the probe decides to do nothing.**

Extra cost: if the probe *does* fire, the query is then embedded a second time in
Step 5 (that one is cached, so at least it can be an L1 hit within the same
process — but only if the L1 key matches, and 🔍 the safety net never populated L1).

**Confidence:** 🔍 CODE FACT.

---

### C-5 · The tutor streams JSON, so the first visible character is delayed by the JSON scaffolding

**What:** the tutor LLM streams a JSON document. The student's actual answer text
lives at `sections[0].content`, which is the **fifth** field. Everything before it
must be generated and transmitted first.

**Location** — 🔍 CODE FACT, the output contract the model is told to produce,
`backend/src/prompts/intents/conceptQuestionPrompt.js:86`:
```
{"status": "answered", "responseMode": "study_tutor", "title": "<...>",
 "sections": [{"heading": "<...>", "content": "<the actual answer>"}], ...}
```

🔍 CODE FACT — the frontend can only display what `partial-json` has parsed:
`frontend/src/api/tutorApi.js:305-311`
```js
if (dataObj.token) {
  accumulatedText += dataObj.token;
  ...
  const partialObj = parse(accumulatedText);
  onUpdate(partialObj);
```

📏 MEASURED — the fixed JSON scaffolding that must be emitted before the first
character of the answer:
```
{"status": "answered", "responseMode": "study_tutor", "title": "", "sections": [{"heading": "", "content": "
= 108 characters
```
🧮 DERIVED using the repo's own approximation (`utils/tokenLogger.js:16`,
`1 token ≈ 4 chars`): **≈ 27 tokens of pure scaffolding**, *plus* the
model-generated `title` and `heading` text, before a single word of the answer
can appear.

**Why it costs latency:** this is perceived latency, not server latency. The
server is streaming; the student's screen is not moving.

**How many ms is that?** ❓ UNKNOWN — depends on the model's tokens-per-second,
which has never been measured (`A-1`).

**Confidence:** 🔍 CODE FACT + 📏 MEASURED for the character count.
❓ UNKNOWN for the wall-clock cost.

---

## Group D — Payload waste

### D-1 · Every vector search transfers 136.8 KB and throws away 126 KB of it

**What:** `$vectorSearch` fetches 50 candidates with full text and full metadata.
The pipeline keeps 5.

**Location** — 🔍 CODE FACT, `backend/src/rag/retriever.js`:
```
line 137:  const candidateTopK = options.candidateTopK || Math.max(topK * 10, 50);
line 168:    numCandidates: candidateTopK,
line 169:    limit: candidateTopK,
line 181-186:  $project: { _id: 0, chunk_id: 1, pageContent: 1, metadata: 1, score: {...} }
line 194:  resultsWithScores = await Chunk.aggregate(pipeline);
line 220:  const results = filteredResults.slice(0, topK);
```
And `backend/src/rag/retriever.config.js:9` → `defaultTopK: 5`.

**Evidence** — 📏 MEASURED, §1.2 and §1.3:
```
fetched : 50 docs, 136.8 KB, 872 ms median
kept    :  5 docs,  10.5 KB
wasted  : 45 docs, ~126 KB  (92% of the payload)
```
And the isolation test that proves it is transfer cost, not compute cost:
```
same 50 candidates, scores only → 310 ms, 3.5 KB   (baseline findOne = 314 ms)
same 50 candidates, full text   → 872 ms, 132.2 KB
```

**Honest counter-point that belongs in this file:** the reranker genuinely needs
candidate *text* to work — 🔍 CODE FACT, `backend/src/rag/reranker.js` scores on
heading and content keyword matches. So "just fetch 5" is not a free fix. This is
recorded as a real design tension, and it belongs in the solutions file, not here.

**But part of the waste has no counter-argument at all** — see `D-2`.

**Confidence:** 📏 MEASURED + 🔍 CODE FACT.

---

### D-2 · Metadata is larger than the content itself, and half of it is never read at query time

**What:** `metadata` is 72.8 KB of the 136.8 KB payload — more than `pageContent`
(59.4 KB). Most of its fields are indexing bookkeeping that no query-time code
ever touches.

**Location:** `backend/src/rag/retriever.js:185` → `metadata: 1` (whole object projected)

**Evidence** — 📏 MEASURED, §1.3:
```
metadata total                                    : 72.8 KB
  of which metadata.originalText                  : 38.2 KB
metadata trimmed to only the fields code reads    : 14.6 KB
```

🔍 CODE FACT — the complete list of metadata keys stored on every chunk, read from
a live document in `zuno_prod`:
```
chunk_id, board, class, subject, section, chapter_no,
original_science_chapter_no, chapter_title, source_path, file_name,
chunk_index, heading_path, heading_level, content_type, char_count,
word_count, line_count, splitter, chunk_size_config, chunk_overlap_config,
topic_ids, originalText
```

🔍 CODE FACT — the complete list of metadata fields any query-time code actually
reads. Verified with:
```bash
grep -rn "metadata\.\|metadata\[" backend/src/rag/reranker.js backend/src/rag/sourceFormatter.js \
     backend/src/ask/promptHelpers.js backend/src/rag/retriever.js backend/src/ask/step5.retrieveContent.js \
  | grep -o "metadata\.[a-z_]*" | sort -u
```
Result: `chapter_title`, `chunk_id`, `content_type`, `heading_path`,
`hinglish_title`, `section`, `topic_ids`, `chapter_no`.

**Eight fields are read. Twenty-two are shipped.**

🔍 CODE FACT — `metadata.originalText` (the single biggest field, 38.2 KB per query)
is used **only at index time**, `backend/src/rag/indexPipeline.js:162`:
```js
const batchTexts = batch.map((doc) => doc.metadata.originalText || doc.pageContent);
```
There is no query-time reader of it anywhere in `backend/src/`.

🧮 DERIVED: trimming the projection to the 8 fields the code reads removes
**58.2 KB from every single retrieval** — 43% of the total payload — with no
behavioural change whatsoever, because nothing reads the removed fields.

**Confidence:** 📏 MEASURED + 🔍 CODE FACT. This is the highest-confidence
latency finding in this file.

---

### D-3 · One embedding cache hit pulls 59 KB back from Redis

**What:** the embedding L2 cache stores a 3072-float vector as a JSON string.

**Location:** `backend/src/cache/embeddingCache.js:111`

🔍 CODE FACT:
```js
redisSetex(key, L2_TTL, JSON.stringify(embedding)).catch(() => {});
```
and the read side, `backend/src/cache/embeddingCache.js:65-70`:
```js
const cached = await redisGet(key);
if (cached) {
  const embedding = JSON.parse(cached);
```

**Evidence** — 📏 MEASURED: `JSON.stringify` of a real 3072-dim embedding from
`zuno_prod` = **59.1 KB**.

**Why it costs latency:** an L2 embedding "hit" — which the code treats as the fast
path — moves 59.1 KB across the network from Upstash, then runs `JSON.parse` on it.
This is only faster than calling the embedding API if the Upstash link is fast. The
comment claiming it is `~3ms` (`A-2`) has never been verified.

**Secondary cost, worth recording:** 🔍 PROJECT_STATE.md §2 records the Upstash plan
as **free tier**, noted as a "~10k commands/day ceiling". Each 59 KB value also
consumes bandwidth quota, not just a command count.

**Confidence:** 🔍 CODE FACT + 📏 MEASURED for the size. ❓ UNKNOWN whether the
L2 hit is actually faster than a fresh embedding call in production.

---

## Group E — Repeated and redundant work

### E-1 · `upsertChapterProgress` re-reads a document the caller is already holding

**What:** to perform one write, the function issues two extra reads for data that
Step 2 already fetched and Step 7 already has in a local variable.

**Location:** `backend/src/services/chapterProgress.service.js:146` and `:155`

🔍 CODE FACT — the two redundant reads:
```js
:146   const existing = await ChapterProgress.findOne(filter, { totalCoreTopics: 1 }).lean();
:155   const existingCompleted = await ChapterProgress.findOne(filter, { completedTopicIds: 1 }).lean();
:194   const doc = await ChapterProgress.findOneAndUpdate(filter, { ... });
```

🔍 CODE FACT — the same document was already loaded in Step 2:
```
backend/src/ask/step2.loadSession.js:102
    chapterProgress = await getChapterProgress(userId, guestId, focusChapter.id);
backend/src/ask/step2.loadSession.js:135
    return { sessionId, chatState, recentMessages, chapterProgress };
```

🔍 CODE FACT — and Step 7 is already reading `completedTopicIds` off that very
object, immediately before calling the function that goes and re-fetches it:
```
backend/src/ask/step7.saveAndRespond.js:325-326
    const priorCurrentTopicId = chapterProgress?.currentTopicId ?? null;
    const priorCompleted      = chapterProgress?.completedTopicIds ?? [];

backend/src/ask/step7.saveAndRespond.js:337-338
    chapterProgressDoc = await withRetry(
      () => upsertChapterProgress(userId, guestId, chapterId, { ... }),
```

**Why it costs latency:** 2 extra sequential MongoDB round trips on every Focus
Mode turn, for data that is already in memory two stack frames up.
🧮 DERIVED on the audit link: ~628 ms per turn.

**Confidence:** 🔍 CODE FACT.

---

### E-2 · `chat_sessions` is written 2–4 times per turn, and one of the writes is hidden inside a history helper

**What:** the same `chat_sessions` document is updated more than once per turn.
The second write is not visible from Step 7 — it lives inside `addChatMessages`.

**Location** — 🔍 CODE FACT:

```
WRITE #1  backend/src/ask/step7.saveAndRespond.js:291
            const updatedSession = await updateChatSession(sessionId, {...})

WRITE #2  backend/src/ask/step7.saveAndRespond.js:467
            await addChatMessages(sessionId, [...], userId)
          └── backend/src/services/chatHistory.service.js:41
                await updateChatSessionLastMessageTime(sessionId);
              └── backend/src/services/chatSession.service.js:44
                    return ChatSession.findOneAndUpdate({ sessionId }, { lastMessageAt: new Date() }, ...)

WRITE #3  backend/src/ask/step7.saveAndRespond.js:410   (turn 1 only)
            setFirstQuestionIfEmpty(sessionId, question)

WRITE #4  backend/src/ask/step7.saveAndRespond.js:425   (turn 1 only)
            await setSessionTitleIfDefault(sessionId, response.title.trim())
```

**Why write #2 is avoidable in principle:** `lastMessageAt` is a plain field on the
same document that write #1 already `$set`s. 🔍 CODE FACT —
`chatSession.service.js:94` shows write #1 builds a `$set` object and applies it in
a single `findOneAndUpdate`.

**Why it costs latency:** 1 extra blocking MongoDB round trip on every turn, 3 extra
on turn 1 — and all of them land in `WAIT 3`, after the answer is already on screen.

**Confidence:** 🔍 CODE FACT.

---

### E-3 · `addChatMessages` pulls back the full 30-message array and discards it

**What:** the history write asks MongoDB to return the updated document, which
contains the whole capped message array. The caller ignores the return value.

**Location:** `backend/src/services/chatHistory.service.js:23-38`

🔍 CODE FACT — the write:
```js
const historyDoc = await ChatHistory.findOneAndUpdate(
  { sessionId },
  { $setOnInsert: { userId },
    $push: { messages: { $each: formattedMessages, $slice: -30 } } },
  { upsert: true, returnDocument: 'after' }    // ← returns the whole document
).lean();
...
return historyDoc?.messages || [];
```

🔍 CODE FACT — the caller, `backend/src/ask/step7.saveAndRespond.js:467`:
```js
await addChatMessages(sessionId, [ ... ], userId);
```
No assignment. The return value is dropped.

**Evidence for the size** — 📏 MEASURED against `zuno_prod`:
```
chat_history: 34 documents, 135.2 KB total  →  ≈ 4 KB per session document
```
A mature session sits at the 30-message cap, so ~4 KB is transferred back and
discarded on every turn.

**Confidence:** 🔍 CODE FACT + 📏 MEASURED.

---

### E-4 · `listChapterProgressController` queries the same collection twice for one response

**What:** the endpoint runs `listUserChapterProgress` once for the list and again
for the summary counts — two sequential queries, same filter, full documents.

**Location:** `backend/src/controllers/chapterProgress.controller.js:163` and `:195`

🔍 CODE FACT:
```js
:163   const docs = await listUserChapterProgress(userId, guestId, { status: status || undefined, limit: parsedLimit });
...
:195   const allDocs = await listUserChapterProgress(userId, guestId, { limit: 50 });
:197   const summary = {
:200     inProgressCount: allDocs.filter((d) => d.status === 'in_progress' || d.status === 'awaiting_quiz').length,
:201     completedCount:  allDocs.filter((d) => d.status === 'completed').length,
```

🔍 CODE FACT — neither call projects anything, `backend/src/services/chapterProgress.service.js:119-123`:
```js
return ChapterProgress.find(query).sort({ lastStudiedAt: -1 }).limit(limit).lean();
```
So full documents are fetched — including the `topicEngagement` array
(`models/chapterProgress.model.js:53`) and `linkedSessionIds`
(`models/chapterProgress.model.js:56`) — to produce three integers.

**Why it costs latency:** this endpoint is called by the FocusModal. It is not on
the `/ask` path, but it is on the path the student walks *before* asking anything.

**Confidence:** 🔍 CODE FACT.

---

### E-5 · Mix Quiz generation issues one query per chapter (N+1)

**What:** a `for` loop with an `await` inside issues one `Question.find()` per
eligible chapter.

**Location:** `backend/src/services/quiz/questionSelector.js:114-122`

🔍 CODE FACT:
```js
for (const { chapterId, quota } of quotas) {
  if (quota <= 0) continue;
  const { questionIds: picked } = await selectChapterQuestionIds(subjectId, chapterId, seenSet, quota);
```
and `selectChapterQuestionIds` at `questionSelector.js:43` is a `Question.find()`.

🔍 CODE FACT — chapter count: `PROJECT_STATE.md` §2 records **16 chapters**.

🧮 DERIVED: up to **16 sequential MongoDB round trips** to build one Mix Quiz.
On the audit link that is ~5 seconds. On Render it will be less, but it is still
16 serial trips where the data could come from one.

**Confidence:** 🔍 CODE FACT for the loop. 🧮 DERIVED for the trip count.

---

### E-6 · `getSeenQuestionIds` unwinds a student's entire answer history on every quiz generation

**What:** an aggregation that unwinds every answer of every past attempt, for one
student, every time they start a quiz.

**Location:** `backend/src/services/quiz/questionSelector.js:26-31`

🔍 CODE FACT:
```js
const [result] = await QuizAttempt.aggregate([
  { $match: buildIdentityFilter(userId, guestId) },
  { $unwind: '$answers' },
  { $match: { 'answers.isCorrect': true } },
  { $group: { _id: null, ids: { $addToSet: '$answers.questionId' } } },
]);
```

**Why it costs latency, and grows:** the work is proportional to
`attempts × answers per attempt`, and both only ever increase for an active
student. There is no cache and no bound.

🧮 DERIVED: a student with 100 attempts of 20 questions makes MongoDB unwind
2,000 sub-documents before every new quiz.

**Current real-world size:** 📏 MEASURED — `zuno_prod.quiz_attempts` = **0 documents**.
So this costs nothing today. It is recorded because it is on the quiz hot path and
its cost only goes up.

**Confidence:** 🔍 CODE FACT for the query. 🧮 DERIVED for growth.

---

## Group F — Caches that don't cache

### F-1 · The ChapterProgress Redis cache has a 0% hit rate on the `/ask` path

**What:** Step 2 writes the cache entry, and Step 7 of the *same turn* deletes it.
By the time Step 2 of the next turn looks, it is always gone.

**Location:**
- Read + populate: `backend/src/services/chapterProgress.service.js:95-107`
- Delete: `backend/src/services/chapterProgress.service.js:215`

🔍 CODE FACT — the read path:
```js
:98    const cacheKey = progressKey(userId, guestId, chapterId);
:99    const cached = await redisGet(cacheKey);
:100   if (cached) return cached;
:102   const doc = await ChapterProgress.findOne(buildFilter(...)).lean();
:104   if (doc) await redisSetex(cacheKey, CACHE_TTL_SEC, doc);
```
with `CACHE_TTL_SEC = 60` at line 23.

🔍 CODE FACT — the delete, at the end of every `upsertChapterProgress`:
```js
:215   await invalidateCache(userId, guestId, chapterId);
```
and `invalidateCache` at lines 79-86:
```js
await redis.del(progressKey(userId, guestId, chapterId), listKey(userId, guestId));
```

🔍 CODE FACT — both run on every Focus Mode turn:
- Step 2 read: `ask/step2.loadSession.js:102`, inside `if (studyMode === 'focus' && focusChapter?.id)`
- Step 7 write: `ask/step7.saveAndRespond.js:337`, inside `if (studyMode === 'focus' && chatState.currentChapterId)`

**The proof, as a sequence:**
```
turn 1  step2: GET  → miss → Mongo findOne → SETEX (ttl 60s)
turn 1  step7: DEL                                  ← key destroyed, same turn
turn 2  step2: GET  → miss → Mongo findOne → SETEX
turn 2  step7: DEL
turn 3  ... identical
```

**Why it costs latency:** the cache does not save the Mongo read it was built to
save. It **adds** two Redis round trips per turn (a GET that always misses at
`:99`, a SETEX at `:104`) and a third in Step 7 (the DEL at `:215`) — all of them
blocking.

🧮 DERIVED on the audit link: ~183 ms per turn spent on a cache that never hits.

**Where the cache does work:** ✅ 🔍 CODE FACT — `getSessionHistory`
(`controllers/session.controller.js:114`) and `getChapterProgressController`
(`controllers/chapterProgress.controller.js:114`) are pure reads with no write
after them, so they can hit. The 0% claim is specific to the `/ask` path.

**Confidence:** 🔍 CODE FACT — the sequence is fully determined by the code.

---

### F-2 · The retrieval cache can only help when two students ask a near-identical question

**What:** the cache key is a hash of the normalized query text. Free-form student
questions rarely repeat exactly.

**Location:** `backend/src/cache/retrievalCache.js:75-86`

🔍 CODE FACT:
```js
const buildKey = async (query, options) => {
  const normalizedQ = normalizeQuery(query);
  const optionsStr = JSON.stringify({ f: metadataFilter || null, k: topK || 5, r: requireTermMatchForLatinQuery || false });
  const hash = hashString(normalizedQ + optionsStr);
  const version = await getRagVersion();
  return `zuno:retrieval:v1:${hash}:${version}`;
};
```

🔍 CODE FACT — the L1 layer is per-process and small:
`retrievalCache.js:27-28` → `const L1 = new Map(); const L1_MAX = 300;`

🔍 CODE FACT — L1 is lost on every restart, and `PROJECT_STATE.md` §2 records the
backend as **Render FREE**, which "Sleeps after 15 min".

**This is not a bug.** It is recorded because the code comment at
`retrievalCache.js:6-8` presents the cache as the answer to the ~400-700 ms Atlas
cost, and that framing is only true for repeated queries. Actual hit rate is
❓ UNKNOWN — there is no counter (`A-1`).

**Confidence:** 🔍 CODE FACT for the mechanism. ❓ UNKNOWN for the real hit rate.

---

### F-3 · The first retrieval after every restart pays an extra Redis round trip for the RAG version

**What:** `_ragVersion` starts as `null`, so the first `buildKey` of a process
fetches it from Redis before it can even construct the cache key.

**Location:** `backend/src/cache/retrievalCache.js:35-45`

🔍 CODE FACT:
```js
let _ragVersion = null;
let _ragVersionFetchedAt = 0;
const RAG_VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const getRagVersion = async () => {
  const now = Date.now();
  if (_ragVersion && (now - _ragVersionFetchedAt) < RAG_VERSION_CHECK_INTERVAL_MS) return _ragVersion;
  const stored = await redisGet(RAG_VERSION_REDIS_KEY);
```

**Why it costs latency:** one extra blocking Redis GET on the first retrieval after
boot, and again every 5 minutes. Small on its own — recorded because on Render
Free the process restarts constantly, so "first retrieval after boot" is a common
case, not a rare one.

**Confidence:** 🔍 CODE FACT.

---

## Group G — Cold start

### G-1 · The study map is parsed lazily, so the first request after every boot pays for it

**What:** `getStudyMap()` reads and parses 17 markdown files on first call. Nothing
warms it at startup, so the first student to ask a question pays.

**Location:**
- Lazy cache: `backend/src/services/studyMap.service.js:137-146`
- First caller in the request path: `backend/src/ask/step1.validateInput.js:74`

🔍 CODE FACT:
```js
// studyMap.service.js:137
export const getStudyMap = async ({ refresh = false } = {}) => {
  if (cachedStudyMap && !refresh) return cachedStudyMap;
  const documents = await loadMarkdownDocuments(scienceContentDir);
  cachedStudyMap = buildStudyMapFromDocuments(documents);
```

🔍 CODE FACT — `backend/src/server.js` never calls `getStudyMap()`. Verified by
reading the whole file (64 lines); its startup work is `connectDB()`,
`Chunk.countDocuments()`, `connectRedis()`, `app.listen()`, `connectMailer()`.

**Evidence** — 📏 MEASURED: `getStudyMap()` cold = **235 ms**, warm = **0 ms**.

**Why it matters more than it looks:** 🔍 `PROJECT_STATE.md` §2 records the backend
as Render **FREE**, "Sleeps after 15 min. Cold start ~50s." So this 235 ms is paid
by a real student, repeatedly, throughout the day — not once at deploy.

**Confidence:** 🔍 CODE FACT + 📏 MEASURED.

---

### G-2 · Startup runs a full `countDocuments()` on the chunks collection

**What:** every boot performs an exact count of `chunks` before the port is bound.

**Location:** `backend/src/server.js:17`

🔍 CODE FACT:
```js
const totalVectors = await Chunk.countDocuments();
console.log(`[Zuno] MongoDB vector chunks connected. Total chunks indexed: ${totalVectors}`);
```

**Evidence** — 📏 MEASURED against `zuno_prod`:
```
Chunk.countDocuments()      : 303 ms   (629 docs)
Chunk.estimatedDocumentCount(): 312 ms   (629 docs, same answer)
```

**Honest note:** at 629 documents the two are the same speed — the cost here is
dominated by the network round trip, not the counting. So this is **not** currently
a meaningful cost. It is recorded because it is boot-path work that blocks
`app.listen()` on a platform that boots constantly, and because
`countDocuments()` is the variant whose cost grows with collection size.

**Confidence:** 📏 MEASURED. Impact today: small.

---

### G-3 · `mongoose.connect()` is called with no options at all

**What:** no timeouts, no pool sizing, no compression, no `autoIndex: false`.

**Location:** `backend/src/db/mongooseClient.js:10`

🔍 CODE FACT — the entire connect call:
```js
await mongoose.connect(env.mongodbUri);
```

🔍 CODE FACT — repo-wide search for `autoIndex` in `backend/src/` returns **no
hits**. The only references are in two scripts (`backend/scripts/create-chat-session-guest-index.js:11`,
`backend/scripts/fix-guest-chapter-index.js:11`), both describing Mongoose's
default auto-create behaviour as the mechanism they rely on.

🔍 CODE FACT — index count on the live database: `zuno_prod` has **47 indexes**
across 10 collections (from `db.stats()`).

**Evidence** — 📏 MEASURED: `mongoose.connect()` cold = **2,524 ms**.

**Why it costs latency:**
1. Mongoose's `autoIndex` default is `true`, so **every boot** issues index-creation
   commands for all schema-declared indexes. They are no-ops when the index exists,
   but they are round trips, on a platform that boots constantly.
2. There is no `serverSelectionTimeoutMS`. The driver default is 30 seconds. If
   Atlas is briefly unreachable, a student's request waits up to 30 s.
3. There is no `compressors` setting, so the 136.8 KB vector-search payload (`D-1`)
   crosses the wire uncompressed.

**Confidence:** 🔍 CODE FACT for the absence of options. 📏 MEASURED for connect time.

---

## Group H — Frontend cost

### H-1 · The browser re-parses the entire accumulated JSON on every single streamed token

**What:** on each token, the frontend concatenates it and runs `partial-json`'s
`parse()` over the *whole* accumulated string from the beginning.

**Location:** `frontend/src/api/tutorApi.js:305-311`

🔍 CODE FACT:
```js
if (dataObj.token) {
  accumulatedText += dataObj.token;
  ...
      const partialObj = parse(accumulatedText);
      onUpdate(partialObj);
```

**Why it costs latency:** this is O(n²) over the length of the answer. Token 1
parses ~5 characters; the last token of a long answer parses the entire response.

🧮 DERIVED from 🔍 CODE FACT: the tutor's token budget for
`CONCEPT_QUESTION_WITH_CHUNKS` is **1500** (`backend/src/ask/intentRouter.js:67`).
So a full-length answer triggers up to **1,500 full parses** of a string growing
toward ~6,000 characters, plus 1,500 React state updates via `onUpdate`.

**Why this matters for Zuno specifically:** 🔍 `CLAUDE.md` → the target user is a
Bihar Board Class 10 student. That is a low-end Android phone, not a laptop.

**Actual measured cost on a real device:** ❓ UNKNOWN — not measured. Needs a
Chrome DevTools performance profile with CPU throttling.

**Confidence:** 🔍 CODE FACT for the algorithm. ❓ UNKNOWN for the real-device cost.

---

### H-2 · There is no `res.flush()` after SSE writes

**What:** each SSE frame is written with `res.write()` and never explicitly flushed.

**Location:** `backend/src/controllers/ask.controller.js:46, 50, 55`

🔍 CODE FACT:
```js
:46   res.write(`data: ${JSON.stringify({ event: 'stage', stage })}\n\n`);
:50   res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
:55   res.write(`data: ${JSON.stringify({ event: 'end', payload: finalPayload })}\n\n`);
```

**Current status: this is probably fine.** 🔍 CODE FACT — `backend/src/app.js` has
no `compression` middleware (verified against its full `app.use` list, lines 24-74).
Without compression, Node flushes small writes promptly.

**Why it is recorded anyway:** the moment anyone adds `compression()` — a normal,
obvious-looking performance improvement — every SSE token will be buffered and the
streaming will silently stop working. This is a **latency trap**, not a current
latency cost.

**Confidence:** 🔍 CODE FACT.

---

## Group I — Configuration uncertainty that changes the whole analysis

### I-1 · [RESOLVED] Production streams the tutor answer — `USE_INTENT_ROUTER=true` on Render

**Status:** answered by the owner on 2026-09-10. Render has `USE_INTENT_ROUTER=true`,
so production runs the streaming router path. The large alarm this finding
originally raised — "maybe production doesn't stream at all" — is closed. The
detail below is kept as a record and because two residual facts still matter.

**What (original finding):** the same code base has two completely different Step 6
implementations. One streams. One does not. Which one runs in production was not
knowable from the repo.

**Location:** `backend/src/ask/step6.generateResponse.js:125`

🔍 CODE FACT — the fork:
```js
if (process.env.USE_INTENT_ROUTER === 'true') {
  const result = await routeToIntentHandler(input, context, decision, retrieval, streamCallbacks, abortSignal);
  return { ...result, answer: sectionsToAnswerText(result) };
}
// LEGACY PATH below
```

🔍 CODE FACT — **the new path streams**, `backend/src/ask/intentRouter.js:302-312`:
```js
const stream = await chain.stream(promptInput, { ... });
for await (const chunk of stream) {
  rawResponse += chunk;
  if (streamCallbacks?.onToken) streamCallbacks.onToken(chunk);
}
```

🔍 CODE FACT — **the legacy path does not stream**, `backend/src/ask/step6.generateResponse.js:171`:
```js
const rawResponse = await getResponseChain().invoke( { ... } );
```
And `streamCallbacks` appears in exactly two places in that file — the parameter
declaration at line 120 and the hand-off to the router at line 126. Verified:
```bash
grep -n "streamCallbacks" backend/src/ask/step6.generateResponse.js
# 120:  export const generateResponse = async (input, context, decision, retrieval, streamCallbacks = null, abortSignal = null) => {
# 126:    const result = await routeToIntentHandler(input, context, decision, retrieval, streamCallbacks, abortSignal);
```
**The legacy path receives the streaming callbacks and never uses them.**

🔍 CODE FACT — the repo disagrees with itself about the default:

| Source | Value |
|---|---|
| `backend/.env` (local, gitignored) | `USE_INTENT_ROUTER=true` (line 80) |
| `backend/.env.example` | `USE_INTENT_ROUTER=false` (line 72) |
| `CLAUDE.md`, env section | `false` — "(true = intent-specific prompts; false = legacy monolithic tutorPrompt)" |
| Render environment | ❓ **UNKNOWN** |

**Residual latency-relevant facts (still true after resolution):**

1. The legacy path (`step6.generateResponse.js:171`, `.invoke()`) is **dead code
   in production**. It still accepts `streamCallbacks` and silently ignores them
   (`step6.generateResponse.js:120, 126`). Zero runtime cost today, but it is a
   trap: if the flag is ever flipped, or the `USE_INTENT_ROUTER` check is
   refactored, streaming silently stops with no error — and local testing would
   not catch it because local `.env` has the flag `true` too.
2. Because streaming **is** on, `C-5` (JSON scaffolding before the first visible
   word) and `H-1` (browser re-parses the JSON on every token) are both on the
   live path — they are real perceived-latency costs, not hypotheticals.

**Confidence:** 🔍 CODE FACT for both code paths. Production value now
🔍 CONFIRMED (owner, 2026-09-10).

---

### I-2 · The only timeout in the entire pipeline is a single 60-second budget for everything

**What:** there is one `AbortController` covering the whole request. No individual
LLM call, embedding call, MongoDB query or Redis command has its own timeout.

**Location:** `backend/src/controllers/ask.controller.js:23-26`

🔍 CODE FACT:
```js
timeoutId = setTimeout(() => {
  console.warn(`[Ask API] Request hit 60s hard timeout. Aborting...`);
  abortController.abort(new Error('Timeout'));
}, 60000);
```

🔍 CODE FACT — the LLM models are created with **no timeout option**,
`backend/src/llm/chatModel.js:47-77`. Each provider block sets `apiKey`, `model`,
`temperature`, `maxRetries: 0` and optionally `maxTokens`. There is no `timeout`
and no `configuration.timeout`.

🔍 CODE FACT — `mongoose.connect()` sets no `serverSelectionTimeoutMS` or
`socketTimeoutMS` (see `G-3`).

**Why it costs latency:** the 60 s budget is shared, not divided. If the decider
(`C-1`) stalls for 50 s, retrieval and the tutor call have 10 s between them. The
student then waits the *full* 60 s and receives the timeout message at
`ask.controller.js:84`:
> "Sorry, lagta hai network thoda slow hai..."

There is no mechanism to fail one slow stage fast and still serve the turn.

**Supporting evidence that stalls are real** — 📏 MEASURED, §1.1: 1 of 10 Mongo
`findOne` samples took **1,800 ms** against a 314 ms median. And in §1.2, one
`$vectorSearch` sample hit **3,084 ms** against an 872 ms median. Tails exist on
this link.

**Confidence:** 🔍 CODE FACT + 📏 MEASURED.

---

### I-3 · Local development connects to the production database (against the owner's intent)

**What:** `backend/.env`'s `MONGO_URI` points at `zuno_prod` — the same database
Render uses. The owner's stated setup (2026-09-10: "prod ke liye `zuno_prod`,
dev ke liye `bihar_board_ai_tutor`") does **not** match the actual file. Local
dev is hitting prod right now.

**Location:** `backend/.env` (gitignored — value not reproduced here).

🔍 CODE FACT — the connection string ends in `/zuno_prod?tls=true&replicaSet=...`.
🔍 CODE FACT — `backend/src/config/env.js:21` → `process.env.MONGODB_URI || process.env.MONGO_URI`.
`grep -i mongo backend/.env` returns only the one `MONGO_URI` line — there is no
`MONGODB_URI` override that could redirect it to the dev database.

🔍 CODE FACT — 📏 MEASURED, the Atlas cluster holds **21 databases**, two of which
are Zuno's:

| Database | Objects | Data size | question_bank |
|---|---|---|---|
| `zuno_prod` | 710 | 28.4 MB | **0** |
| `bihar_board_ai_tutor` | 4,489 | 36.1 MB | 743 |

**Why this is in a latency file:** every local test, script and `nodemon` restart
issues real queries against the same database and the same cluster resources that
serve students. It also means **no local performance measurement is trustworthy**,
because the numbers include whatever production is doing at that moment — and the
reverse: local work adds load to production.

**Separate, non-latency finding that must not be lost — NOW CONFIRMED AS LIVE:**
Render points at `zuno_prod` (owner, 2026-09-10), and 📏 MEASURED
`zuno_prod.question_bank` has **0 documents** (`bihar_board_ai_tutor.question_bank`
has 743). So quiz generation returns 404 for every student **in production today**
— 🔍 CODE FACT, `backend/src/services/quiz/quizGenerator.js:69-70`:
```js
if (questionIds.length === 0) {
  throw new ApiError(404, 'No questions available for this quiz.');
}
```
This is out of scope for this file but is a launch blocker. See §5 Q3.

**Also noted, out of scope:** the connection string uses a low-strength password
for what appears to be an Atlas admin user, embedded in a non-SRV URI. Recorded so
it is not forgotten; belongs in a security task, not here.

**Confidence:** 🔍 CODE FACT + 📏 MEASURED.

---

## 4. What is NOT a problem — do not spend time here

Recorded so that a future audit does not "discover" these and reopen settled work
(`AUDIT_RULES.md` Rule 7).

| Thing | Status | Evidence |
|---|---|---|
| `$vectorSearch` compute speed | ✅ Fine | 📏 50 candidates scored in 310 ms vs a 314 ms baseline findOne — the vector maths is effectively free. The cost is payload (`D-1`). |
| Step 2's two reads | ✅ Already parallel | 🔍 `ask/step2.loadSession.js:21-24` uses `Promise.all` |
| `attachGuest` | ✅ Zero I/O | 🔍 `auth/guestMiddleware.js:26` — pure JWT verification |
| `getRecentChatHistory` | ✅ Correctly projected | 🔍 `services/chatHistory.service.js:70` uses `{ messages: { $slice: -limit } }` — only 14 messages leave the DB |
| `chat_history` growth | ✅ Bounded | 🔍 `services/chatHistory.service.js:30` — `$slice: -30` caps the array |
| `retrieveChunksByTopicId` | ✅ Correctly projected | 🔍 `rag/retriever.js:107` — `{ embedding: 0 }` excludes the 3072-float vector |
| `chunks.metadata.topic_ids` index | ✅ Correct and needed | 🔍 `models/chunk.model.js:40`; 📏 lookup measured 266–323 ms (pure round trip) |
| `curriculum-index.json` loading | ✅ Cached correctly | 🔍 `curriculum/curriculumIndexLoader.js:26` singleton promise; 📏 10 ms once |
| `maxRetries: 0` on LLM calls | ✅ Deliberate and right | 🔍 `llm/chatModel.js:51` with the reason in the comment — retries would hide rate limits for 60 s |
| Quiz submit concurrency | ✅ Well designed | 🔍 `services/quiz/quizSubmitter.js:127` atomic compare-and-set + unique `submissionKey` index — no transaction needed |
| `selectChapterQuestionIds` | ✅ Index-covered | 🔍 `questionSelector.js:43-46` projects `{_id: 1}` against the `{subjectId, chapterId, isActive}` index |
| `quiz_sessions` TTL | ✅ Correct | 🔍 `models/quizSession.model.js:46` |
| `retrievalCache` L2 write | ✅ Non-blocking | 🔍 `cache/retrievalCache.js:145` — fire-and-forget |
| `logStudyEvent` | ✅ Non-blocking | 🔍 `services/chapterProgress.service.js:496-510` — deliberately not awaited, with the reason in the comment |
| SSE frames buffering | ✅ Fine today | 🔍 `app.js` has no `compression` middleware — but see `H-2`, this is a trap for later |

---

## 5. Open questions — these need the owner, not the code

These cannot be answered by reading the repository. Each one changes how the
problems above should be ranked.

### Q1 · How long do the two LLM calls actually take in production?
**Why it matters:** they are almost certainly the largest single block of the wait,
and every problem in Groups B, D, E and F is small in comparison — or isn't.
Nobody knows which.
**Blocked by:** `A-1` — there is no instrumentation to measure them.
**Not measured during this audit because:** it would spend the owner's OpenAI
credits without asking.

### Q2 · ✅ ANSWERED (owner, 2026-09-10) — `USE_INTENT_ROUTER=true` on Render
Production runs the streaming router path. The "maybe production doesn't stream"
alarm in `I-1` is closed. `C-5` and `H-1` stay open — they are on the live
streaming path.

### Q3 · ✅ ANSWERED (owner, 2026-09-10) — Render → `zuno_prod`; dev intended for `bihar_board_ai_tutor`
Two confirmed consequences:
1. `zuno_prod.question_bank` is empty (📏 0 docs) → **quiz is a live launch
   blocker in production today** (`I-3`). Out of scope for latency, but must be
   tracked somewhere — `PRE_LAUNCH_BLOCKERS.md`.
2. The local `backend/.env` actually points at `zuno_prod`, not
   `bihar_board_ai_tutor` — local dev is currently hitting prod, against the
   owner's stated intent (`I-3`).

### Q4 · What is the real Render → Upstash and Render → Atlas round-trip time?
**Why it matters:** every 🧮 DERIVED ms figure in this file is scaled off the audit
machine's numbers. With the real ones, the whole table can be recomputed honestly —
and the `~3ms` claim in `A-2` can finally be confirmed or removed.
**Blocked by:** `A-1`.

### Q5 · How often does the out-of-focus fallback (`C-3`) actually fire?
**Why it matters:** it roughly doubles Step 5's cost. If it fires on 2% of turns it
is noise; if it fires on 40% it is a top-three problem.
**Blocked by:** `A-1` — there is no counter.

---

## 6. Problem index

Sorted by confidence, so the most trustworthy items are at the top.

| ID | Problem | Confidence | Costs time in |
|---|---|---|---|
| `D-2` | 58.2 KB of unread metadata shipped per retrieval | 📏 + 🔍 | WAIT 2 |
| `D-1` | 136.8 KB fetched, 10.5 KB kept per retrieval | 📏 + 🔍 | WAIT 2 |
| `F-1` | ChapterProgress cache has 0% hit rate on `/ask` | 🔍 | WAIT 1 + WAIT 3 |
| `E-1` | `upsertChapterProgress` re-reads data already in memory | 🔍 | WAIT 3 |
| `E-2` | `chat_sessions` written 2–4× per turn | 🔍 | WAIT 3 |
| `C-2` | Step 7's 6 writes block the SSE `end` event | 🔍 | WAIT 3 |
| `B-1` | 8 sequential round trips before any UI feedback | 🔍 | WAIT 1 |
| `A-1` | No timing instrumentation anywhere | 🔍 | everywhere |
| `E-3` | 4 KB message array returned and discarded per turn | 🔍 + 📏 | WAIT 3 |
| `C-1` | Decider LLM call is blocking and unstreamable | 🔍 | WAIT 2 |
| `C-4` | SafetyNet bypasses the embedding cache | 🔍 | WAIT 2 |
| `C-3` | Out-of-focus fallback repeats the whole retrieval | 🔍 | WAIT 2 |
| `C-5` | 27+ tokens of JSON scaffolding before the first visible word | 🔍 + 📏 | WAIT 2 |
| `E-4` | Chapter list endpoint queries twice for one response | 🔍 | before `/ask` |
| `E-5` | Mix Quiz N+1 — up to 16 sequential queries | 🔍 | quiz path |
| `G-3` | `mongoose.connect()` with no options | 🔍 + 📏 | boot + tails |
| `G-1` | Study map parsed lazily on first request after boot | 🔍 + 📏 | WAIT 1, after every sleep |
| `B-3` | Full unprojected `User` document on every request | 🔍 | WAIT 1 |
| `B-2` | Two sequential Redis calls in `queryCount` | 🔍 | WAIT 1 |
| `D-3` | 59.1 KB per embedding cache entry | 🔍 + 📏 | WAIT 2 |
| `I-2` | One shared 60 s budget, no per-call timeouts | 🔍 + 📏 | worst case |
| `H-1` | Browser re-parses full JSON on every token | 🔍 | WAIT 2, on-device |
| `F-3` | Extra Redis GET on first retrieval after boot | 🔍 | WAIT 2, after every sleep |
| `A-2` | Cache files document an unverified `~3ms` Redis latency | 🔍 + 📏 | documentation |
| `G-2` | `countDocuments()` at boot | 📏 | boot only, small today |
| `E-6` | `getSeenQuestionIds` unwinds full answer history | 🔍 | quiz path, grows |
| `F-2` | Retrieval cache only helps on repeated questions | 🔍 | by design |
| `H-2` | No `res.flush()` — a trap if compression is ever added | 🔍 | future |
| `I-1` | [RESOLVED] Production streams (`USE_INTENT_ROUTER=true`); legacy path is dead code | 🔍 CONFIRMED | — |
| `I-3` | Local dev connected to the production database | 🔍 + 📏 | measurement trust |

**Total: 30 problems. `I-1` is resolved (production streams — owner confirmed
2026-09-10). Of the rest, 25 are 🔍 CODE FACT or 📏 MEASURED. The remaining
❓ components all trace back to §5 Q1 (LLM call timing), Q4 (Render→infra RTT)
and Q5 (fallback frequency), plus one on-device profile for `H-1`.**

---

## 7. Audit log

| Date | What | By |
|---|---|---|
| 2026-09-10 | File created on branch `latency-audit` from `main` @ `a27f793`. Full read of `backend/src/ask/` (all 7 steps + orchestrator + intentRouter + intentSafetyNet), `backend/src/services/` (chatSession, chatHistory, chapterProgress, quiz/*), `backend/src/rag/` (retriever, reranker, config), `backend/src/cache/` (both), `backend/src/auth/authMiddleware.js`, `backend/src/middlewares/`, `backend/src/llm/`, `backend/src/db/`, `backend/src/server.js`, `backend/src/app.js`, `frontend/src/api/tutorApi.js`. Live inspection of the Atlas cluster (`zuno_prod`, 10 collections, 47 indexes) and 5 measurement runs. | Claude (Opus 5) |
| 2026-09-10 | Owner answered §5 Q2 (`USE_INTENT_ROUTER=true` on Render) and Q3 (Render→`zuno_prod`, dev intended for `bihar_board_ai_tutor`). `I-1` resolved. `I-3` quiz-blocker confirmed as live, plus the local `.env`↔intent mismatch confirmed. Updated §0.2, §I-1, §I-3, §5 Q2/Q3, problem index. No code changed. | Claude (Sonnet 5) |

**Nothing in this file was changed in the codebase. This branch contains this
document only.**
