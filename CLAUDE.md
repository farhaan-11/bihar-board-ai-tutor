# Bihar Board AI Tutor — CLAUDE.md

---

## ⛔ READ THESE FIRST — before any work, audit, or review

These four files govern how work happens on this repo. They exist because this
project spent months in a fix-audit-rebreak loop. They are not optional reading.

| File | What it is | When |
|---|---|---|
| **`PROJECT_STATE.md`** | The single source of truth for what exists right now, which branch has it, and what is broken. | **Always read first.** Never describe project state from memory or from an old doc. |
| **`AUDIT_RULES.md`** | Binding rules for any review work. 3 severity buckets, max 7 BROKEN, audit `main` only, no new layer without removing a cause. | Before any audit, review, or "let me check what's wrong" task. |
| **`STAGE1_DONE.md`** | The written definition of "done" for the current stage. | Before starting any task — if it is not in here, it is not current work. |
| **`BACKLOG.md`** | Parked items. Opinions and future ideas live here. | When tempted to propose work outside the current stage. |

**`docs/decisions/`** holds the ADRs — why each architectural decision was made.
If a finding contradicts an ADR, say so explicitly (`AUDIT_RULES.md` Rule 7).
Never silently re-litigate a settled decision.

---

## Your role on this repo — do not re-derive this each session

You are the **senior engineer**. The owner is a junior developer who has
explicitly asked you to hold the architectural judgment so he does not have to.
He should never have to re-explain any of the following:

- **You make the call, then state it with the reason.** No menus. The only
  exception is a genuine *business* call — money, timeline, user impact — where
  he holds information you do not. Everything else (which fix, which approach,
  whether something is a real bug): you decide. (`AUDIT_RULES.md` Rule 6.)
- **Every fix must remove a cause, never patch a symptom.** Before proposing
  *any* fix, answer out loud: *"Which cause does this remove?"* If the honest
  answer is "none, it just catches the symptom" — **do not offer it, not even as
  an option.** A symptom patch is not a fast path; it is the exact move that put
  this project in a months-long loop. Trace to the root, fix the root.
  (`AUDIT_RULES.md` Rule 4.)
- **No new guard / wrapper / fallback / override without deleting the cause it
  guards.** The pipeline already carries ~12 such layers from the loop. Adding
  layer 13 is a regression even if it makes a test pass.
- **Explain before you build.** Plain Hinglish, one idea at a time, real spacing.
  What, why, which files, what "done" means, what is out of scope. Wait for
  "samajh aa gaya" before writing code. Then one step at a time, confirming after
  each.
- **Analysis before code. One task at a time.** If you find something else
  broken mid-task, note it (BACKLOG / PROJECT_STATE) — do not fix it now.

**Two more hard rules:**

1. **Audit `main`, and check branch divergence first.** On 2026-08-28 a full
   audit ran on a branch 30 commits behind `main` and reported already-fixed
   code as live bugs. `git diff` is not `git merge` — test a real merge before
   calling one risky.
2. **Never work on `main` directly.** New branch for every change, even a
   one-line doc edit. Merge only when the owner says so.

**How the current work is structured:** Stage 1 = launch (`STAGE1_DONE.md`).
Sections A (repo hygiene) ✅ and B (infra) triaged. Section C = 8 verified bugs
(`PROJECT_STATE.md` §4), fixed one per branch, failing-test → fix → passing-test.
BUG-1 + BUG-2 done (ADR-011). BUG-3…BUG-8 remain. Do not start Stage 2 / BACKLOG
items — but a Stage-1 bug whose only Rule-4-compliant fix lives in BACKLOG may
pull that slice forward *with a new ADR* (precedent: ADR-011 pulled the decider
slice of O2).

---

## Project Name and Purpose

**Zuno** — an AI-powered personal tutor for Bihar Board Class 10 Science students. Students ask questions in Hindi, Hinglish, or simple English and receive simple Hinglish answers grounded only in curated approved study content. The core rule: Zuno must never answer from general LLM knowledge when retrieved source content is insufficient — it must clearly say so.

## Target User

Bihar Board Class 10 students studying Science (Physics, Chemistry, Biology). They may write in Hindi (Devanagari), Hinglish (Roman-script Hindi), or simple English. Answers must always be in simple Roman-script Hinglish.

---

## Full Tech Stack

### Backend
- **Runtime**: Node.js (ESM, `"type": "module"`)
- **Framework**: Express.js
- **LLM Provider**: Two providers configured — Groq and OpenAI (Google Gemini also supported but unused) — switchable via `LLM_PROVIDER` env var. **Currently active: OpenAI (`gpt-4o-mini`)** — Groq was the original default but is disabled due to repeated 429 rate-limit errors. Decider (intent classifier) can run on a separate model via `DECIDER_PROVIDER`/`DECIDER_MODEL` — currently also OpenAI `gpt-4o-mini`. See `backend/src/llm/llm.config.js`.
- **Embeddings**: Two providers configured in `backend/src/rag/geminiEmbeddings.js` (filename is legacy — logic now defaults to OpenAI). **Primary: OpenAI `text-embedding-3-large`** (3072-dim). **Fallback: Gemini `gemini-embedding-001`** (3072-dim, query-time only, only fires when OpenAI is down — indexing NEVER falls back, since mixing providers in one vector store silently breaks retrieval). Controlled via `EMBEDDING_PROVIDER` env var.
- **Vector Store**: MongoDB Atlas Vector Search (`$vectorSearch` on the `Chunk` model, `chunk.model.js`) — migrated off the old JSON-persisted `LangChain MemoryVectorStore` approach. `retriever.js` queries MongoDB directly; there is no JSON vector file in the runtime path anymore.
- **RAG Framework**: LangChain (`@langchain/core`, `@langchain/classic`, `@langchain/google-genai`, `@langchain/groq`, `@langchain/openai`, `@langchain/textsplitters`) — still used for chunking/embeddings/prompt orchestration, just not for vector storage
- **Database**: MongoDB Atlas via Mongoose (`^9.6.2`)
- **Auth**: JWT (`jsonwebtoken`) access + refresh tokens, `bcrypt` password hashing, Google OAuth (`google-auth-library`) — full login/register/email-verification/password-reset/Google-login flow, see `backend/src/auth/` and `backend/src/controllers/auth.controller.js`
- **Caching**: Redis (`ioredis`) via Upstash — two-layer embedding + retrieval cache (`backend/src/cache/`), also backs rate limiting (`rate-limit-redis`) and JWT session state. Falls back to in-memory only if `REDIS_URL` is not set.
- **Rate limiting**: `express-rate-limit` (+ Redis store) — three tiers: global, ask-specific, auth-specific
- **Security headers**: `helmet`
- **Email**: `nodemailer` (verification + password reset emails) — see `docs/archive/plans/PRE_LAUNCH_BLOCKERS.md` P1 for a pending migration to Resend API (Render blocks outbound SMTP)
- **Markdown parsing**: `gray-matter` (frontmatter), custom heading-based chunker
- **Env config**: `dotenv`
- **HTTP logging**: `morgan`
- **Dev server**: `nodemon`

### Frontend
- **Framework**: React 19 + Vite 6
- **Routing**: `react-router-dom` v7 — multiple pages (landing, login, register, forgot/reset password, verify email, auth callback, chat), not a single-component app
- **UI Library**: Material UI v9 (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`)
- **State**: Redux Toolkit (`@reduxjs/toolkit`, `react-redux`) with `redux-persist` — auth state lives in `store/slices/authSlice.js`. Local component state (`useState`/`useEffect`) still used within pages/components.
- **API**: `axios` (`services/axios/axiosInstance.js`) for most calls, with a request/response interceptor for token refresh — native `fetch()` is still used in `api/tutorApi.js` for the streaming `/ask` call (SSE), with its own manual 401-refresh handling mirroring the axios interceptor
- **Auth**: `@react-oauth/google` for Google sign-in on the frontend
- **Streaming JSON parsing**: `partial-json` (for incremental SSE response parsing)
- **Session persistence**: `localStorage` (guest session id) + `redux-persist` (auth state)

---

## Folder Structure Overview

```
bihar-board-ai-tutor/
├── AGENTS.md                        AI agent rules for this project
├── CLAUDE.md                        This file
├── README.md                        Project overview and RAG commands
├── PROJECT_STATE.md, STAGE1_DONE.md, AUDIT_RULES.md, BACKLOG.md   The 4 governing files (see top of this file)
├── tasks/                           Individual task spec files (active: TASK-020 backlog only)
│   └── archive/                    Completed task specs (TASK-001–019, 021–025)
├── docs/                            Architecture notes, QA reports, API explanations
│   ├── decisions/                   ADRs
│   ├── SESSION_DESIGN.md            Locked session architecture doc — don't change without discussion
│   ├── ZUNO_VERIFIED_FACTS.md       Evidence-only facts about the codebase (2026-10-08 snapshot)
│   ├── quiz/                        Quiz System docs — PAUSED at Phase 5 (blueprint, protocol, build log, Phase 4 plan)
│   ├── latency/                     LATENCY_PROBLEMS.md — PAUSED (problems only, no solutions yet)
│   ├── python-track/                Python RAG roadmap + retrieval repo's CLAUDE.md (live copies in zuno-retrieval-service)
│   ├── qa-report-2026-05-21.md      QA findings (point-in-time — verify against current code before trusting)
│   ├── polish-notes.md              UX/tone issues from real chat testing
│   ├── rag-embeddings-vector-store.md
│   ├── tutor-engine-langchain-architecture.md
│   ├── api-explanations/
│   └── archive/
│       ├── plans/                  Finished plans + old trackers (BUG1/GUEST_SERVERSIDE/HINGLISH_QUERY/STREAM_FAILURE/SEO/DEPLOYMENT/UI plans, PRE_LAUNCH_BLOCKERS, TASKS, ANALYSIS, DECISIONS, plus older BRAIN_FIX, PIPELINE_OPTIMIZATION, TOKEN_FIX, UI_REDESIGN_AUDIT, SESSION_FIX, PROBLEMS) — history only, superseded by PROJECT_STATE.md
│       ├── auth/, focus-mode/, global-mode/, hinglish-consistency/   Completed feature plans/verification checklists
├── data/
│   └── class-10/science/            16 curated Markdown chapters (RAG source content)
│       ├── biology/                 4 chapters
│       ├── chemistry/               5 chapters
│       └── physics/                 7 chapters
├── backend/
│   ├── src/
│   │   ├── server.js                Entry point — starts Express + MongoDB
│   │   ├── app.js                   Express app — routes, CORS, helmet, error handler
│   │   ├── ask/                     7-step Ask API pipeline (main product logic)
│   │   │   ├── askOrchestrator.js   READ THIS FIRST to understand the flow
│   │   │   ├── step1.validateInput.js
│   │   │   ├── step2.loadSession.js
│   │   │   ├── step3.buildContext.js
│   │   │   ├── step4.decideRetrieval.js   LLM call #1 (intent classifier)
│   │   │   ├── step5.retrieveContent.js   RAG retrieval (conditional)
│   │   │   ├── step6.generateResponse.js  LLM call #2 (tutor answer)
│   │   │   ├── step7.saveAndRespond.js    DB save + API response
│   │   │   └── promptHelpers.js
│   │   ├── auth/                    authMiddleware.js — requireAuth / optionalAuth
│   │   ├── cache/                   Redis-backed embedding + retrieval cache (embeddingCache.js, retrievalCache.js, cacheClient.js)
│   │   ├── knowledge/               examKnowledgeService.js — exam-fact lookup (TASK-025 exam knowledge layer)
│   │   ├── constants/               scienceGlossary.js, subjectOrder.js
│   │   ├── prompts/                 LangChain ChatPromptTemplate definitions
│   │   │   ├── deciderPrompt.js
│   │   │   └── tutorPrompt.js
│   │   ├── rag/                     RAG indexing and retrieval
│   │   │   ├── indexPipeline.js     Offline: load → chunk → embed → save (npm run rag:index)
│   │   │   ├── markdownLoader.js
│   │   │   ├── markdownChunker.js
│   │   │   ├── geminiEmbeddings.js  Embedding provider factory — name is legacy, OpenAI is primary (see Tech Stack above)
│   │   │   ├── retriever.js           Main retrieval function (used by step5) — queries MongoDB Atlas $vectorSearch directly, wrapped in retrievalCache
│   │   │   ├── retriever.config.js
│   │   │   ├── reranker.js            Keyword + intent reranker
│   │   │   └── sourceFormatter.js
│   │   ├── llm/                     LLM provider factory (llm.config.js — Groq/OpenAI/Google, decider config)
│   │   ├── models/                  Mongoose schemas: chapterProgress, chatHistory, chatSession, chunk, studyEvent, user
│   │   ├── services/                DB service helpers
│   │   ├── curriculum/              Chapter/topic index and resolvers
│   │   ├── controllers/             Express controllers: ask, auth, chapterProgress, health, session, studyMap
│   │   ├── routes/                  Express route definitions: ask, auth, chapterProgress, health, session, studyMap
│   │   ├── config/                  env.js (loads .env, validates required vars), redisClient.js
│   │   ├── db/mongooseClient.js     MongoDB connect/disconnect
│   │   ├── middlewares/             error.middleware.js, rateLimiters.js, guestRateLimit.js, queryCount.js
│   │   ├── utils/
│   │   └── inspectors/              Local inspection scripts (not production)
│   ├── scripts/                     Test, migration, and verification scripts (run via npm run ...)
│   ├── storage/
│   │   └── curriculum-index.json   Chapter/topic index (vectors now live in MongoDB Atlas, not this folder)
│   ├── docs/curriculum-brain-foundation.md
│   ├── .env                         Local secrets (gitignored — never commit)
│   └── .env.example                 Template for required env keys
└── frontend/
    ├── src/
    │   ├── App.jsx, main.jsx        App shell + entry point (routing/state now live in pages/ and store/, not App.jsx alone)
    │   ├── pages/                   LandingPage, LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage, AuthCallback, ChatPage
    │   ├── store/                   Redux Toolkit store (store.js) + slices/authSlice.js
    │   ├── services/axios/          axiosInstance.js (interceptors: auth header + token refresh), authService.js
    │   ├── api/tutorApi.js          fetch-based wrapper for the streaming /ask endpoint
    │   ├── components/              AskBar, ChatMessage, ErrorBoundary, FocusModal, GuestLimitModal,
    │   │                            GuestLoginPrompt, GuestOnlyRoute, HistoryPanel, SessionList,
    │   │                            Sidebar, SourceChips, StatusNotice, Toast, Topbar
    │   ├── hooks/
    │   ├── constants/studyModes.js
    │   ├── utils/session.js         localStorage sessionId helpers
    │   ├── utils/studyMap.js        findFirstChapter helper
    │   ├── theme/zunoTheme.js       MUI theme
    │   └── styles/global.css
    ├── .env.example                 VITE_API_BASE_URL
    └── dist/                        Production build output (gitignored)
```

---

## Required Environment Variables

### backend/.env

```
# Core
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://...        (or MONGO_URI — both are checked)
FRONTEND_URL=http://localhost:5173   (comma-separated list allowed for multiple origins)

# LLM — currently active: openai (see Tech Stack above for why Groq is off)
LLM_PROVIDER=openai                  (groq | openai | google)
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0
DECIDER_PROVIDER=openai              (optional — defaults to LLM_PROVIDER if unset)
DECIDER_MODEL=gpt-4o-mini            (optional — defaults to LLM_MODEL if unset)
GROQ_API_KEY=...                     (required if LLM_PROVIDER or DECIDER_PROVIDER=groq)
OPENAI_API_KEY=...                   (required if LLM_PROVIDER or DECIDER_PROVIDER=openai)
GOOGLE_API_KEY=...                   (required if LLM_PROVIDER or DECIDER_PROVIDER=google)

# Embeddings — currently active: openai
EMBEDDING_PROVIDER=openai            (openai | google — see backend/src/rag/geminiEmbeddings.js)
EMBEDDING_FALLBACK_ENABLED=true      (query-time only fallback to Gemini if OpenAI is down)
GEMINI_API_KEY=...                   (required for Gemini fallback; GOOGLE_API_KEY also accepted)

# Auth — JWT
JWT_ACCESS_SECRET=...                (32+ random chars recommended)
JWT_REFRESH_SECRET=...
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
BCRYPT_SALT_ROUNDS=12

# Auth — Google OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:5000/api/v1/auth/google/callback

# Auth — Email (Nodemailer — see docs/archive/plans/PRE_LAUNCH_BLOCKERS.md P1 for pending Resend migration)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=...
EMAIL_PASS=...
EMAIL_FROM=Zuno <noreply@zuno.com>

# Redis — caching (embeddings + retrieval) AND rate limiting store. Falls back to
# in-memory only if unset (works, but no cross-restart persistence, no multi-instance safety).
REDIS_URL=rediss://default:token@host:6379

# Limits
GUEST_DAILY_LIMIT=5
USER_DAILY_LIMIT=20
GUEST_TURN_LIMIT=5
SESSION_TOKEN_LIMIT=15000            (session locks when totalTokensUsed reaches this)
MAX_NON_ACADEMIC_TURNS=10            (drift guard — hard block after N casual/off-topic turns)

# Feature flags
USE_INTENT_ROUTER=false              (true = intent-specific prompts; false = legacy monolithic tutorPrompt)
```

### frontend/.env
```
VITE_API_BASE_URL=http://localhost:5000
```

---

## Current Project Status

Status, known bugs, and pending work are **not tracked in this file** — they change too often and duplicating them here is exactly what made this file go stale before. Check these instead, in order:

- **`PROJECT_STATE.md`** — what exists right now, branch state, known issues.
- **`STAGE1_DONE.md`** — the current stage's checklist; the next unticked section is the current work.
- **`BACKLOG.md`** — everything parked.
- **`tasks/`** — active task specs not yet archived (currently: TASK-020 backlog only; TASK-024 and TASK-025 are done and archived).

`docs/archive/plans/PRE_LAUNCH_BLOCKERS.md` and `TASKS.md` are the older trackers (last updated 2026-07) — history only, superseded by the files above.

---

## Key Rules for All Future Work

### Before coding
- Read `PROJECT_STATE.md` and `STAGE1_DONE.md` before starting any new task (see "Current Project Status" above)
- `docs/qa-report-2026-05-21.md` and `docs/archive/plans/ANALYSIS.md` are point-in-time snapshots — useful for history, but verify against current code before trusting anything specific from them
- Always ask before big architectural changes
- Analysis before code

### Core product rule
Zuno must answer ONLY from retrieved/indexed source content. If retrieved context is insufficient, return `status: insufficient_context` and tell the student clearly. Never answer from general LLM knowledge.

### RAG pipeline rules
- Keep the RAG pipeline modular — indexing and retrieval are separate concerns
- Run `npm run rag:index` from `backend/` after any content changes in `data/` (rebuilds the `Chunk` collection in MongoDB Atlas)
- Do not hardcode chapter names in routing logic — read from StudyMap API
- Indexing must never fall back between embedding providers (OpenAI ↔ Gemini) — mixing providers in one vector store silently breaks retrieval, since the two live in different vector spaces. If you switch `EMBEDDING_PROVIDER`, re-run `npm run rag:index` fully.

### Language rules
- All student-facing answers must be in simple Roman-script Hinglish
- No Devanagari in answers unless the `answerLanguageInstruction` explicitly requests it
- Keep analogies local (Bihar/UP context) and use them sparingly

### Code rules
- Work on one task at a time
- Do not overbuild — no admin panel, analytics, quiz, or PDF pipeline unless explicitly asked (auth is already built — JWT + Google OAuth + email verification — treat it as an existing subsystem to respect, not something to avoid adding)
- Keep `backend/` and `data/` concerns separate
- No new npm packages without a clear reason
- Do not commit `.env` under any circumstances
- **Never work directly on `main`** — it's live/deployed. Always create a new branch first, even for tiny changes; merge only when explicitly told to.

### Testing
- After any backend change, run: `npm run test:chunks`, `npm run test:study-map`, `npm run test:curriculum-resolvers`, `npm run test:chat-db-models`
- After any RAG/retrieval change, also run: `npm run rag:test-retriever` (live, hits MongoDB Atlas + embedding provider)
- After any frontend change, run: `npm run build` from `frontend/`
- Full network-backed tests (`rag:test-retriever`, `rag:test-answer`, `test:ask-db`, `test:golden`) require live API keys and MongoDB access
- Cross-check command names against `backend/package.json`'s `scripts` block before citing them here again — this list has gone stale before

---

## 🎯 Quiz System Work — Follow the Protocol (PAUSED at Phase 5 — not Stage 1)

All Quiz docs live in **`docs/quiz/`**.

If the user's request touches the Quiz System in any way (chapter gate quiz, practice quiz hub,
question bank, `QUIZ_SYSTEM_BLUEPRINT.md`, or any "Phase N" of it), **a fixed working protocol
applies. Do not improvise a different approach.**

**Read these two files first, in this order — before doing anything else:**

1. **`docs/quiz/QUIZ_BUILD_LOG.md`** — living state: which phase we're on, its Definition of Done, the
   Parking Lot, and what happened last session. This is the resume point. Read it so the user
   never has to re-explain where things stand.
2. **`docs/quiz/QUIZ_EXECUTION_PROTOCOL.md`** — the rulebook. Roles, the 4-beat session rhythm, the
   Parking Lot triage rule, the baseline-test rule, STOP conditions, and the banned-behaviour
   list. Follow it exactly.

Spec itself is `docs/quiz/QUIZ_SYSTEM_BLUEPRINT.md` (audited 2026-08-02 — corrections are inline as
`[AUDIT]` blocks, with a summary in its §18). Read only the section for the current phase, not
the whole file.

**The non-negotiables (full detail in the protocol):**

- **Role:** act as Senior Software Engineer **and** Senior Product Manager, both, always. The
  user must never have to restate this.
- **One session = one phase.** Never two, never a partial jump ahead.
- **Never write code before the user says they've understood.** Explain in simple Hinglish
  first — what, why, which files, what "done" means, and what is explicitly out of scope.
- **🅿️ Parking Lot:** any bug or idea found mid-phase that does not physically block the current
  phase's Definition of Done goes into `QUIZ_BUILD_LOG.md`'s Parking Lot and is **not worked
  on**. "It's a small fix" is not an exception — that is exactly how the loop starts.
- **Baseline test before and after every phase**, same command both times. If it was green
  before and is red after, that is a regression the current session caused — fix it now, in
  this session; it does not go to the Parking Lot.
- **Session ends when the phase's Definition of Done is ticked** — even if there is time left.
- **One question at a time** when checking understanding. Never a batch of four.

If the user types `status`, `protocol`, `checkpoint`, `loop`, `park <thing>`, or `blocker?`,
those are defined shortcuts — see `QUIZ_EXECUTION_PROTOCOL.md` §10-11.

---

## RAG Commands (run from `backend/`)

```bash
npm run rag:index            # Build/rebuild the Chunk collection in MongoDB Atlas from data/ content
npm run test:chunks          # Validate chunker output (600 chunks expected)
npm run test:study-map       # Validate study map API
npm run rag:test-retriever   # Live retrieval smoke test against MongoDB Atlas (needs embedding key + network)
npm run rag:test-answer      # Live end-to-end RAG answer test
npm run test:golden          # Golden-set regression test (mocked decider/responder scenarios)
npm run test:ask-db          # Live ask + DB integration test (needs all keys + network)
npm run db:ping              # Test MongoDB Atlas connection
```

## API Endpoints

```
Ask
  POST   /api/v1/ask                                       — main tutor endpoint (SSE streaming)

Study Map
  GET    /api/v1/study-map                                 — list of available chapters
  GET    /api/v1/study-map/chapters/:chapterId/topics       — topics within a chapter

Auth
  POST   /api/v1/auth/register
  POST   /api/v1/auth/verify-email
  POST   /api/v1/auth/login
  POST   /api/v1/auth/logout
  POST   /api/v1/auth/refresh
  POST   /api/v1/auth/forgot-password
  POST   /api/v1/auth/reset-password
  GET    /api/v1/auth/me
  GET    /api/v1/auth/google                                — starts Google OAuth flow
  GET    /api/v1/auth/google/callback
  POST   /api/v1/auth/exchange                              — exchanges one-time OAuth code for JWT
  POST   /api/v1/auth/claim-guest-progress

Sessions
  GET    /api/v1/sessions
  GET    /api/v1/sessions/:sessionId/history
  DELETE /api/v1/sessions/:sessionId
  PATCH  /api/v1/sessions/:sessionId/rename

Chapter Progress
  GET    /api/v1/chapter-progress
  GET    /api/v1/chapter-progress/:chapterId
  POST   /api/v1/chapter-progress/:chapterId/action

Health
  GET    /health                                            — note: NOT under /api/v1 — inconsistency, kept as-is
```
