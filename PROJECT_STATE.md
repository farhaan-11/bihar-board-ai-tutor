# PROJECT_STATE.md — Zuno

> **This is the single source of truth for "what exists right now".**
> Any AI agent or developer starting work on this repo MUST read this file first.
> Last verified: §1–§7 as of 2026-08-28 (verified against `main`, not from memory).
> **§8 added 2026-10-26** — covers everything since 2026-09-10 (Python retriever,
> Docker, EC2). Latest merge to `main`: `2a04c05` (2026-10-25), the Python retriever
> client behind a flag + shadow mode. Re-verify §1–§7 before relying on them.
> Previous merge (Section C): BUG-8 — `askApiLimiter` now keyed by identity (`identityKeyGenerator`),
> not raw IP. Section C (all 8 verified bugs) complete. Merged to `main`
> 2026-09-09 (`--no-ff`, `1086b36`). `globalApiLimiter` (same raw-IP cause)
> parked in `BACKLOG.md` R6 with a blocking condition. Prior merges: frontend
> build fix (`0253427`), BUG-7 (`e0f9d69`).

---

## 1. What Zuno is

An AI tutor for **Bihar Board Class 10 Science** students.

Students ask in Hindi / Hinglish / English. Zuno answers in simple Roman-script
Hinglish, using **only** curated study content. It never answers from general
LLM knowledge.

**Final goal (owner's words):** production-grade app serving 50,000+ users, helping
students learn concepts, prepare for exams, track progress, and get light emotional
support when stressed.

**Current stage:** pre-launch. Launching to a small group of real students within days.

---

## 2. Verified state — what is actually built

Everything below was verified by reading `main` on 2026-08-28. Not assumed.

### Backend — 108 JS files in `backend/src/`

| System | Status | Where |
|---|---|---|
| Ask pipeline (7 steps, 9 intents) | ✅ Working | `backend/src/ask/` (11 files) |
| RAG (Atlas `$vectorSearch` + reranker) | ✅ Working | `backend/src/rag/` (8 files) |
| Intent Router (per-intent prompts) | ✅ Working | `backend/src/ask/intentRouter.js` |
| Auth (JWT + Google OAuth + email verify) | ✅ Working | `backend/src/auth/`, `controllers/auth.controller.js` |
| Quiz system (generate/submit/history/detail) | ✅ Working | `backend/src/services/quiz/` (5 files) |
| Exam knowledge (marks, weightage) | ✅ Working | `backend/src/knowledge/examKnowledgeService.js` |
| Chapter progress tracking | ✅ Working | `models/chapterProgress.model.js` |
| Support / feedback | ✅ Working | `routes/support.routes.js` |
| Redis cache (embedding + retrieval) | ✅ Working | `backend/src/cache/` (4 files) |
| Rate limiting (8 limiters) | ⚠️ Partial | `middlewares/rateLimiters.js` — see Known Issues |
| Guest identity (server-signed token) | ✅ Working | `auth/guestTokenHelpers.js`, `auth/guestMiddleware.js` — `ADR-012` |

**Routes (8):** ask, auth, chapterProgress, health, quiz, session, studyMap, support

**Models (10):** chapterProgress, chatHistory, chatSession, chunk, question,
quizAttempt, quizSession, studyEvent, supportRequest, user

### Frontend — 51 files in `frontend/src/`

**Pages (10):** Landing, Login, Register, ForgotPassword, ResetPassword,
VerifyEmail, AuthCallback, Chat, Quiz, Support

**Stack:** React 19 + Vite 6 + MUI v9 + Redux Toolkit + react-router v7

### Content

| Type | Count | Location |
|---|---|---|
| Science chapter files (Markdown) | **16 chapters** + 1 overview = 17 files | `data/class-10/science/` |
| Quiz questions (raw bank) | **1,126** | `data/quiz-bank/bank/questions.json` |
| Quiz chapter seed files | 16 | `data/quiz-bank/science/` |
| Exam pattern data | 1 | `data/class-10/global/exam_patterns.json` |

**Subject coverage:** Science only. Maths, Hindi, English, Social Science,
Sanskrit = **0**. This is a deliberate v1 scope decision — see `ADR-007`.

### Infrastructure

| Piece | Current | Note |
|---|---|---|
| Backend | Render **FREE** | ⚠️ Sleeps after 15 min. Cold start ~50s. Must upgrade before launch. |
| Backend (EC2, GitHub-Actions deploy) | ⚠️ Instance **stopped** (owner-reported, 2026-10-26) | `deploy-zuno.sh` lives on the box, not in this repo. Which backend serves real students is an open question — see §8.3. |
| Python retrieval service | Render | Separate repo `zuno-retrieval-service`. Shadow mode only — see §8.1. |
| Frontend | Vercel | ✅ Deploys again after the prerender revert (2026-08-29). |
| Database | MongoDB Atlas | OK for now |
| Cache / rate limit | Upstash Redis **free** | ⚠️ ~10k commands/day ceiling |
| Domain | Purchased | — |
| Email | Official mail set up | — |
| SEO | ✅ Merged to `main` 2026-08-28 | Sitemap, meta tags, OG image, robots.txt, build-time pre-rendering of `/` and `/support` for crawlers |

### Deployment

| What | From | Notes |
|---|---|---|
| Backend | Render, from `main` | Start command: `node scripts/build-curriculum-index.js && node src/server.js` |
| Frontend | Vercel, from `main` | Build is plain `vite build`. (A Playwright prerender step was added 2026-08-28 and reverted 2026-08-29 — it failed every Vercel deploy, `chrome-headless-shell` exit 127. See `SEO_PLAN.md` Phase 6 status note + `BACKLOG.md` S1.) |
| Health check | `GET /health` | Note: **not** under `/api/v1` — known inconsistency, kept as-is |

⚠️ Deploying from any branch other than `main` risks shipping a partial product.

### Verified clean (2026-08-28)

- `.env` has never been committed to git history
- `.env`, `.env.local`, `.env.*.local` are all gitignored
- No API keys (`sk-*`, `AIza*`) found anywhere in tracked files

### Missing — flagged, not yet decided

| Gap | Why it matters |
|---|---|
| **No privacy policy / terms page** | Users are ~15-year-old minors. Name, email, and full chat history are collected. India's DPDP Act 2023 has specific provisions for children's data. Verified: no such route in `frontend/src/App.jsx`. |
| **No usage reporting** | `models/studyEvent.model.js` logs events, but nothing reads them. There is currently no way to know whether students are actually using Zuno. |
| **No documented rollback** | No written procedure to revert a bad Render/Vercel deploy |
| **No OpenAI spend cap noted** | An abuse loop or bug could produce an unbounded bill |

All four are tracked in `STAGE1_DONE.md` sections F and G.

---

## 3. Branch state — READ THIS BEFORE ANY WORK

**`main` is the source of truth.** All audits and fixes happen on branches cut
from `main`.

Updated 2026-08-28 (rows for 2026-09-10 and 2026-10-26 added later):

| Branch | Status |
|---|---|
| `main` | ✅ Source of truth. Quiz system + SEO + governance system + BUG-1/BUG-2 + BUG-3 + BUG-4 fixes. |
| `guestID` | ✅ **Merged into `main`** 2026-09-10 (`--no-ff`, `5d2da99`). Server-side guest identity — the client-generated guest UUID is replaced by a server-signed token (`ADR-012`); the separate bug where a guest's chat was never claimed on login (P2) is fixed too. 6 phases, owner ran the browser acceptance. `GUEST_TOKEN_SECRET` set in Render + EC2 envs by owner (server refuses to boot without it). The partial `{ guestId: 1 }` index on `chat_sessions` is auto-created by Mongoose `autoIndex`; `backend/scripts/create-chat-session-guest-index.js` does it explicitly if needed. Plan + evidence: `GUEST_SERVERSIDE_PLAN.md`. Safe to delete the branch. |
| `bug1-decider-structured-output` | ✅ **Merged into `main`** 2026-08-28 (`--no-ff`). Carried the Stage 1 Section B triage + BUG-1/BUG-2 fix (ADR-011). Safe to delete. |
| `quiz-phase0.5-bulk` | 🧊 **Frozen — will not be merged.** See `docs/decisions/010-freeze-quiz-bulk-branch.md`. Its finished output (the 1,126-question bank) already reached `main` via `quiz-phase1`; a byte-diff confirmed `data/quiz-bank/bank/questions.json` is identical on both branches. Kept as a rebuildable pipeline for later, not deleted. Pushed to GitHub 2026-08-28 as a backup, still frozen and unmerged. |
| `docker-local-compose` | 🟡 **Pushed to `origin` 2026-10-26 (`d51a74d`), not merged — on purpose.** Local 3-service compose stack + hardened `backend/Dockerfile`. A push to `main` auto-deploys via `deploy-ec2.yml`, and the EC2 deploy script has not been read, so merge waits for that check. Details: §8.2. |
| `python-retriever` | ✅ **Merged into `main`** 2026-10-25 (fast-forward, `2a04c05`) and deleted locally + on GitHub. See §8.1. |

**Merged and safe to delete:** `quiz`, `quiz-phase1..4`, `global`, `profile`,
`logo`, `feat/support-page`, `stalefilefixes`, `DECIDER_GREETING_FIX`,
`STREAM_FAILURE_FIX`, `codex-curriculum-resolvers`, `seo-work`,
`bug1-decider-structured-output`, `bug3-choose-course-dead-whitelist`,
`bug4-decider-stale-scope-exclusions`, `bug5-topic-id-projection-index`

### ⚠️ Lesson learned (2026-08-28) — two, from the same day

**1. Audit the wrong branch.** A full pipeline audit ran on `seo-work`, 30
commits behind `main`. Two findings were reported as bugs that were **already
fixed** on `main` (frontend SSE `JSON.parse` guard, null-payload handling).
This is why `AUDIT_RULES.md` Rule 1 exists — always audit `main`, always check
divergence first.

**2. `git diff` is not `git merge`.** The first read of `seo-work` and
`quiz-phase0.5-bulk` used raw `git diff --stat` against `main`, which shows
files as "deleted" whenever the *other* branch never touched them — not
because merging would delete anything. This was reported as a real risk
("quiz system could disappear"). A real three-way merge test
(`git merge --no-commit --no-ff`, inspected, then aborted) showed both merges
were safe, with only small, resolvable conflicts. **Always test a real merge
before describing one as risky — a diff alone can't tell you what a merge
will do.**

---

## 4. Known issues — verified on `main`, 2026-08-28

These are **BROKEN** (reproducible), not opinions. See `STAGE1_DONE.md`.

| # | Issue | Location |
|---|---|---|
| ~~BUG-1~~ | ✅ **Fixed** on branch `bug1-decider-structured-output` (pending merge). Decider now uses `withStructuredOutput`; the parse-error fallback is deleted. See ADR-011. |
| ~~BUG-2~~ | ✅ **Fixed** — same commit. `decisionSchema` `intent` enum + `normalizeDecision` fallback changed `GREETING` → `CONCEPT_QUESTION`. See ADR-011. |

> **BUG-1 + BUG-2 — fixed, pending merge** (branch `bug1-decider-structured-output`).
> Decider chain converted to `withStructuredOutput(decisionSchema, { strict: true })`;
> parse-error and unknown-intent fallbacks removed. Verified by
> `npm run test:decider-structured` and a live dev-server run. See `BUG1_FIX_PLAN.md`
> + `ADR-011`. Stage 1 slice of `BACKLOG.md` O2; the tutor/intentRouter side of O2
> remains Stage 2.
| ~~BUG-3~~ | ✅ **Fixed** — merged to `main` 2026-08-28 (`--no-ff`). `INTENT_MEMORY_WHITELIST.CHOOSE_COURSE` → `[]`; its fields were dead (overwritten every turn by the `studyMode` force-sync block). Chapter switching works only via the request `chapterId` param — untouched. Verified by `npm run test:choose-course-memory`. See `STAGE1_DONE.md` Section C. |
| ~~BUG-4~~ | ✅ **Fixed** — merged to `main` 2026-08-28 (`--no-ff`). Stale "Cell structure" / "Atomic structure" entries removed from the decider prompt's OUT_OF_CONTEXT list + rule-8 HARD LIMIT block; both are covered by indexed content (`### Atomic number` ch-05 chemistry, `## 4. Neuron / Nerve Cell` ch-02 biology). Genuinely-absent topics (Newton, Gravitation, Thermodynamics, …) stay excluded. Removes the cause (a stale hardcoded list) per Rule 4 — no guard added. Verified by `npm run test:decider-scope`. See `STAGE1_DONE.md` Section C. |
| ~~BUG-5~~ | ✅ **Fixed** — merged to `main` 2026-08-28 (`--no-ff`). `chunk.model.js` declares `index({ 'metadata.topic_ids': 1 })`; `retrieveChunksByTopicId` `.find()` passes `{ embedding: 0 }`. `explain` confirms COLLSCAN(629) → IXSCAN(4). Migration `scripts/create-chunk-topic-id-index.js`. Verified by `npm run test:topic-id-lookup`. See `STAGE1_DONE.md` Section C. |
| ~~BUG-6~~ | ✅ **Fixed** — merged to `main` 2026-08-29 (`--no-ff`, `b576d70`). Fallback-provider embeddings and anything derived from them are never persisted: `geminiEmbeddings.js` `embedQueryWithMeta()` reports `usedFallback`; `embeddingCache` skips L1+L2 when `cacheable:false`; `retrievalCache` skips its 24h write when `result.usedFallback`. Query-time fallback itself untouched. Verified by `npm run test:no-cache-fallback`. See `STAGE1_DONE.md` Section C. |
| ~~BUG-7~~ | ✅ **Fixed** — merged to `main` 2026-08-29 (`--no-ff`, `e0f9d69`). `getAnswerLanguageInstruction()` returned the Hindi/Devanagari instruction from an early `return` (`languageDetector.js:98`) sitting before the tail glossary-append (TASK-024), so only Hinglish answers ever got the `scienceGlossary.js` term vocabulary. Fix (Rule 4): `wantsGlossary` decided once, independent of the language branch; glossary appended to whichever base instruction is returned; Hindi header instructs Devanagari rendering. Verified by `npm run test:glossary-devanagari`. See `STAGE1_DONE.md` Section C. |
| BUG-7b (noted, deferred) | Legacy `step6.generateResponse.js:160` calls `getAnswerLanguageInstruction(language.answerLanguage)` with no `intent` → glossary never applied on that path for any language. Path is dead in prod (`USE_INTENT_ROUTER=true`). Not a Section C bug; fold into a Stage 2 cleanup of the legacy tutor path. | `ask/step6.generateResponse.js:160` |
| ~~BUG-8~~ | ✅ **Fixed** — merged to `main` 2026-09-09 (`--no-ff`, `1086b36`). The quiz limiters' inline identity-keyer is extracted to one shared `identityKeyGenerator` export; `askApiLimiter` now uses it (the 3 quiz limiters switched to the shared fn too — byte-identical behaviour). 30/min is unchanged but now measured per `user_<id>` / `guest_<id>`, falling back to IP only when neither is present — so it never has to grow with user count (Rule 4: fixed the key, not the cap). Verified by `npm run test:ask-limiter-identity` (failing-test → passing-test); baseline (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`) unchanged. See `STAGE1_DONE.md` Section C. |
| BUG-8b (noted, deferred → `BACKLOG.md` R6) | `globalApiLimiter` (150 req / 15 min, app-wide on every `/api` route at `app.js:60`) has the **same raw-IP defect** and, being lower-rate and route-wide, is the binding constraint for a classroom — so BUG-8 reduces but does not fully remove "one student blocks the class". Left out of BUG-8 on purpose: `globalApiLimiter` runs before `optionalAuth`, so `req.user` is unavailable there; the fix needs auth moved ahead of it (blast radius across all routes) and its own test cycle. **Must NOT be fixed by raising 150** (cap patch). **Blocking condition:** fix before onboarding any single-classroom / single-school-wifi group; fine for a cohort on separate home connections. | `middlewares/rateLimiters.js` `globalApiLimiter` |

---

## 5. Testing

| What | State |
|---|---|
| Golden set | **42 cases** in `backend/test/golden-queries.json` |
| Intents covered | GREETING 8, CONCEPT_QUESTION 13, OUT_OF_CONTEXT 6, EXPLAIN_MORE 5, NEXT_STEP 4, CHOOSE_COURSE 4, UNSAFE_OR_ABUSIVE 2 |
| **Not covered** | `EXAM_INFO` (0), `EMOTIONAL_SUPPORT` (0), multi-turn (0) |
| Quality checks | Substring matching only — **warns, never fails** |

Other test scripts: `test:chunks`, `test:study-map`, `test:curriculum-resolvers`,
`test:chat-db-models`, `rag:test-retriever`, `test:golden`,
`test:decider-structured` (BUG-1/2), `test:choose-course-memory` (BUG-3),
`test:decider-scope` (BUG-4), `test:topic-id-lookup` (BUG-5),
`test:no-cache-fallback` (BUG-6), `test:glossary-devanagari` (BUG-7),
`test:ask-limiter-identity` (BUG-8)

### ⚠️ Two prescribed test commands are broken on `main` (verified 2026-08-28)

Both are pre-existing and tracked in `STAGE1_DONE.md` Section D (D4, D5) — not new.

| Command | Problem |
|---|---|
| `test:chat-db-models` | `scripts/test-chat-db-models.js:4` imports `src/models/chatState.model.js`, which does not exist (state was folded into `chatSession.model.js`). Test crashes on load with `ERR_MODULE_NOT_FOUND`. |
| `test:golden` | `scripts/run-golden-set.js` needs a live server on `localhost:5001` — it is **not** mocked, despite CLAUDE.md describing it as "mocked decider/responder scenarios". Without a running dev server it reports 0 queries and exits 0 (a silent no-op). |

Working baseline (the 3 that pass): `test:chunks`, `test:study-map`,
`test:curriculum-resolvers`.

---

## 6. Cost model — measured, not guessed

From the project's own config: `SESSION_TOKEN_LIMIT = 55,000` over roughly
9 turns → **~6,100 tokens per turn** (~5,500 input + ~700 output).

At gpt-4o-mini rates ($0.15/1M input, $0.60/1M output):

**~$0.00125 per turn (~₹0.11)**

| Daily active users | Turns/day (@15) | LLM cost/month |
|---|---|---|
| 500 | 7,500 | ~$280 |
| 5,000 | 75,000 | ~$2,800 |
| 50,000 | 750,000 | **~$28,000** |

**Biggest available lever: an answer cache.** Students repeat the same questions.
Not built yet. Estimated 40–60% traffic reduction. Tracked in `BACKLOG.md`.

Secondary levers: prompt caching (static system prefix), and a deterministic
pre-router so greetings never reach an LLM.

---

## 7. Where the current stage is

See `STAGE1_DONE.md` for the launch checklist and the definition of "done".
Do not start Stage 2 work before every Stage 1 box is ticked.

**Progress (2026-08-28):**

| Section | State |
|---|---|
| A — Repository hygiene | ✅ 5/5 |
| B — Infrastructure | I2, I3 ✅ verified. I1 (Render paid), I4 (error monitoring), I5 (Redis paid) **deferred by owner** with accepted-risk notes in `STAGE1_DONE.md`. |
| C — The 8 bugs | ✅ **Complete.** BUG-1..BUG-8 all merged to `main`. Follow-on `globalApiLimiter` (BUG-8b) parked in `BACKLOG.md` R6. |
| D — Testing | Not started. Note: `test:chat-db-models` and `test:golden` are broken/no-op on `main` — see §5. |
| E — Real students | Not started. |
| F — Legal & student safety | Not started. |
| G — Operations | Not started. |

**Next task:** Section C is done. **Section D (testing)** is the next Stage 1
block — note `test:chat-db-models` and `test:golden` are broken/no-op on `main`
(see §5, and STAGE1_DONE.md D4/D5). **Before any single-classroom / school-wifi
onboarding:** fix `globalApiLimiter` (BACKLOG R6 / BUG-8b) — same raw-IP cause,
must not be patched by raising the number.

**Alongside Stage 1 (2026-10):** the AI Track work — the Python retrieval service
in shadow mode and the local Docker compose stack — ran in parallel. It ticks no
Stage 1 box and changes no Stage 1 scope. Details and open items: §8.

**Frontend build break — FIXED 2026-08-29** (branch `frontend-vercel-build-fix`).
Every Vercel deploy since the 2026-08-28 `seo-work` merge failed: the build ran
`vite build && npx playwright install chromium && node scripts/prerender.js`, and
`chrome-headless-shell` exits with code 127 on Vercel (missing system shared
libraries; the build sandbox has no browser libs and no root/apt to add them).
It passed locally, so it was never caught. Root cause: a real browser process on
the critical deploy path in an environment that cannot run browsers. Fix (Rule 4
— remove the cause, not a try/catch guard): build script back to plain
`vite build`; `playwright` devDependency, `frontend/scripts/prerender.js`, and the
`/support → /support.html` rewrite removed. All browser-free SEO still ships
(static OG/Twitter/JSON-LD in `index.html`, `sitemap.xml`, `robots.txt`,
`og-image.png`, per-route helmet tags). Proper prerendering → `BACKLOG.md` S1
(must be verified on a Vercel preview deploy, never local-only, next time).
Verified: `cd frontend && npm run build` clean; `dist/` has `index.html` +
assets + the static SEO files, no `support.html`.

---

## 8. Since 2026-09-10 — Python retriever, Docker, EC2 *(added 2026-10-26)*

> Verified 2026-10-26 against `main` at `2a04c05`, plus the live Docker run in 8.2.
> Items marked **owner-reported** come from the owner's own checks (Render logs,
> AWS console), not from this repo.

### 8.1 Python retriever — on `main`, shadow mode only

- **What:** `zuno-retrieval-service` (separate repo, FastAPI) is a port of
  `retriever.js` + `reranker.js`. Node reaches it through
  `backend/src/rag/pythonRetrieverClient.js`; the switch is `searchChunks()` in
  `backend/src/ask/step5.retrieveContent.js`.
- **`USE_PYTHON_RETRIEVER`:** `false` (default) = Node only · `shadow` = Node
  answers the student, Python runs un-awaited and is only logged (`[Shadow] DIFF`
  on a mismatch; a Python failure is swallowed) · `true` = Python only, and the
  client fails loudly (no silent fallback).
- **Merged:** 2026-10-25, fast-forward, 5 commits (`3db7a6f` … `2a04c05`). Branch
  `python-retriever` deleted locally and on GitHub.
- **Parity** (from the service repo's `BACKLOG.md`): 22/22 on the Day-18 gate;
  273-query bulk shadow = 269 PASS, 3 `SCORE_DIFF` (largest 0.0085), 1 `ORDER_DIFF`.
- **Production (owner-reported, 2026-10-25):** `USE_PYTHON_RETRIEVER=shadow`,
  `PYTHON_RETRIEVER_URL`, `INTERNAL_API_KEY` set on the Render backend. The Python
  service on Render answers `/health` 200 (`db=zuno_prod`,
  `text-embedding-3-large`). 4 live test questions showed parity in the logs.
- **Not decided:** flipping to `true`. Only 4 live questions of evidence so far.
  → `BACKLOG.md` A1.

### 8.2 Docker (local run) — branch `docker-local-compose`, NOT merged

- **Branch:** `docker-local-compose`, commit `d51a74d`, pushed to `origin`
  2026-10-26. One commit on top of `main` (`2a04c05`).
- **Contains:** `docker-compose.yml` (backend 5001, frontend 8080→80, retrieval
  8000; retrieval is built from the sibling repo `../zuno-retrieval-service`),
  `frontend/Dockerfile` (multi-stage → nginx) + `frontend/nginx.conf`, and a
  hardened `backend/Dockerfile` (`node:22-slim`, non-root `node` user,
  `npm ci --omit=dev`, `HEALTHCHECK`).
- **Verified 2026-10-26 (owner ran it, output reviewed):** `docker compose up
  --build` → all 3 containers up; backend and frontend `healthy`; `/health` 200 on
  5001 and 8000, `/` 200 on 8080. One bug found and fixed on the way: the frontend
  healthcheck used `localhost`, which resolves to `::1` inside the container while
  nginx listens on IPv4 only, so the container showed `unhealthy` although the site
  was fine. The healthcheck now uses `127.0.0.1`.
- **Why not merged:** a push to `main` triggers `deploy-ec2.yml`, which runs
  `/home/ubuntu/deploy-zuno.sh` on EC2. That script is **not in this repo**, so it
  is unknown whether it builds `backend/Dockerfile`. Merge after the script has
  been read on the box (the instance is stopped — see 8.3). Render is unaffected:
  it builds plain Node (`DEPLOYMENT_PLAN.md`, "Why No Docker") — the Render
  dashboard setting was not re-checked today.
- **Hazard:** `backend/.env` points at `zuno_prod` and compose injects it. A local
  compose stack is a production-database stack: hit `/health` only, never send chat
  questions through it. → `BACKLOG.md` O16.
- **Untested:** Node→Python calls inside compose (the local flag is `false`).

### 8.3 Deploy / EC2 facts

- `deploy-ec2.yml`: push to `main` → SSH → `bash /home/ubuntu/deploy-zuno.sh`.
  Secrets: `EC2_HOST`, `EC2_USERNAME`, `EC2_SSH_KEY`.
- **Not gated by CI.** `ci.yml` and `deploy-ec2.yml` both trigger on push to
  `main`, independently — no `needs` / `workflow_run` — despite the file's comment
  "after CI passes". → `BACKLOG.md` B1.
- **EC2 instance state: stopped** (owner-reported, 2026-10-26). On 2026-10-25
  `api.learnzuno.in` resolved to the EC2 address and TCP 443 timed out (cause not
  diagnosed). Do not start the instance just to read the script: a stop/start
  normally changes the public IP unless an Elastic IP is attached, which would
  stale both the DNS A record and the `EC2_HOST` secret.
- **Open question (needs the owner):** which backend serves real students —
  Render, or EC2 via `api.learnzuno.in`? Check what the Vercel build's
  `VITE_API_BASE_URL` points to. Until answered, Render is the only backend
  confirmed reachable (2026-10-25).

### 8.4 Found while doing the above — parked, not fixed

All logged in `BACKLOG.md`, bucketed per `AUDIT_RULES.md` Rule 2: **B1** deploy
not gated by CI · **R7** JWT secrets below the 32-character minimum (local `.env`;
**production values unchecked**) · **O16** local env points at the prod database · **O17**
`zuno-retrieval` container has no healthcheck · **A1** shadow → `true` cutover
criteria.

### 8.5 Not audited today

- Other local branches exist and were not inspected: `learn-track`,
  `latency-audit`, `phase1-golden-dump`, `codex-fix-chapter-progress-user-index`,
  `guestID`, `quiz-phase0.5-bulk`. `main` is the source of truth.
- Untracked in the owner's working tree (never committed, so on one disk only):
  `NEW_REPO_CLAUDE.md`, `PHASE1_PYTHON_RAG_ROADMAP.md`, `ZUNO_VERIFIED_FACTS.md`,
  `backend/golden/`, `backend/scripts/dumpFocusModeRetrieval.js`,
  `backend/scripts/dumpGoldenRetrieval.js`. Python-Phase-1 artifacts; a
  commit-or-discard decision is pending.
