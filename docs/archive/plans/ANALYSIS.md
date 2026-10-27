# Bihar Board AI Tutor — Codebase Analysis

Generated: 2026-06-03  
Analyst: Claude Sonnet 4.6 (read-only pass)

---

## 1. What This Project Is

An AI-powered personal tutor for Bihar Board Class 10 Science students. Students ask questions in Hindi, Hinglish, or English via a React chat UI. The backend retrieves relevant chunks from 16 curated Science Markdown files using LangChain-based RAG (Gemini embeddings + MemoryVectorStore), runs two sequential LLM calls (a scope/retrieval decider, then a tutor response generator), and returns structured Hinglish answers with source attribution. All conversation state is persisted in MongoDB Atlas. The project is in active MVP development — backend RAG and DB-backed session flow work, frontend exists but is not production-ready.

---

## 2. Architecture Map

### Components

```
Frontend (React + Vite + MUI)
  frontend/src/App.jsx              — main state, ask flow, session handling
  frontend/src/api/tutorApi.js      — fetch wrapper for /api/v1/ask and /api/v1/study-map
  frontend/src/components/          — AppHeader, AskBar, ChatMessage, FocusModal, Sidebar, etc.

Backend (Node.js + Express)
  backend/src/server.js             — starts Express, connects MongoDB
  backend/src/app.js                — routes: /health, /api/v1/ask, /api/v1/study-map
  backend/src/ask/askOrchestrator.js — 7-step pipeline (main entry point)
  backend/src/llm/                  — chatModel (Groq/OpenAI/Gemini factory), llm.config
  backend/src/rag/                  — indexPipeline, markdownLoader, markdownChunker,
                                      geminiEmbeddings, vectorStoreLoader,
                                      vectorStorePersistence, retriever, reranker, sourceFormatter
  backend/src/prompts/              — deciderPrompt, tutorPrompt (LangChain ChatPromptTemplate)
  backend/src/models/               — chatSession.model, chatHistory.model (Mongoose)
  backend/src/services/             — chatSession.service, chatHistory.service, studyMap.service
  backend/src/curriculum/           — chapterResolver, topicResolver, curriculumIndexBuilder/Store

Data
  data/class-10/science/            — 16 curated Markdown chapters (Physics 7, Chemistry 5, Biology 4)
  backend/storage/vector-store.json — pre-built vector store (600 vectors, 3072 dimensions)
  backend/storage/curriculum-index.json — chapter/topic index for curriculum resolvers
```

### Data Flow: "User Question" → Final Answer

```
1. Student types question in browser (App.jsx → AskBar)
2. askTutor() POSTs to /api/v1/ask with { question, studyMode, chapterId?, sessionId? }

3. STEP 1 — validateInput.js
   - Validates question length, emoji/gibberish guard, studyMode, chapterId
   - Looks up focusChapter from StudyMap if studyMode=focus

4. STEP 2 — loadSession.js
   - Reads sessionId from request (or generates a new UUID)
   - Parallel: findChatSession(sessionId) + getRecentChatHistory(sessionId, 14)
   - Builds in-memory chatState (either from DB or fresh defaults)
   - Resets learningMode to idle after 15-min inactivity

5. STEP 3 — buildContext.js
   - Detects input language (Hindi/Hinglish/English) via regex
   - Fetches StudyMap (curriculum summary)
   - Builds: memory JSON, formatted history string, lastTutorResponse,
     curriculumSummary, focusChapterPrompt, currentStudyContext (semantic hydration)

6. STEP 4 — decideRetrieval.js  [LLM CALL #1 — Groq/Gemini/OpenAI]
   - Sends: question + history + lastTutorResponse + focusChapter + currentStudyContext
   - Decider prompt classifies into one of 7 intents:
     UNSAFE_OR_ABUSIVE, GREETING, CHOOSE_COURSE, NEXT_STEP, EXPLAIN_MORE,
     CONCEPT_QUESTION, OUT_OF_CONTEXT
   - Returns: { intent, inScope, needsRetrieval, responseMode, searchQuery, reason }
   - Only CONCEPT_QUESTION triggers needsRetrieval=true

7. STEP 5 — retrieveContent.js  [conditional — only if needsRetrieval=true]
   - Loads vector store from disk (cached in-memory after first load)
   - Embeds searchQuery via Gemini gemini-embedding-001
   - Runs similaritySearchWithScore (LangChain MemoryVectorStore)
   - Converts cosine distance → cosine similarity (1 - distance)
   - Reranks via custom keyword + intent boost/penalty (reranker.js)
   - Applies final score filter (FINAL_SCORE_THRESHOLD=0.65)
   - Returns top-K chunks with sources

8. STEP 6 — generateResponse.js  [LLM CALL #2 — same provider]
   - Sends: question + language instruction + responseMode + memory + history +
     lastTutorResponse + curriculumSummary + focusChapter + retrievedContext
   - Tutor prompt returns strict JSON:
     { status, responseMode, title, sections[], suggestedActions[], memoryUpdate{} }
   - Normalizes sections (max 5), validates status, applies intent firewall
   - Falls back to hardcoded Hinglish message on parse error

9. STEP 7 — saveAndRespond.js
   - Sanitizes LLM memoryUpdate against ALLOWED_STATE_FIELDS allowlist
   - updateChatSessionState (upsert via MongoDB dot-notation $set)
   - addChatMessages (saves student message + tutor reply to chat_history)
   - Returns final API payload to client

10. Frontend receives payload, renders ChatMessage with sections[], shows sources
    Saves sessionId to localStorage if new
```

---

## 3. What Is COMPLETE vs INCOMPLETE vs BROKEN

### COMPLETE

- RAG indexing pipeline (load → chunk → embed → persist vector store)
- LangChain MemoryVectorStore retrieval with cosine similarity fix
- Custom keyword + intent reranker
- LLM-first Ask flow: 7-step pipeline wired end-to-end
- MongoDB Atlas session, history, and state persistence
- Study Map API (`GET /api/v1/study-map`)
- Ask API (`POST /api/v1/ask`) — global and focus modes
- Frontend: dark MUI UI, chat panel, FocusModal subject→section→chapter drill-down
- LocalStorage session ID persistence in frontend
- Source deduplication and compact source contract
- 16 curated Science Markdown chapters (Physics, Chemistry, Biology)
- Curriculum Brain (index + resolvers)

### INCOMPLETE

- **No curated foundation/orientation content** — broad questions like "Science kya hai?", "Physics kya hai?", "main padhta hoon par yaad nahi rehta" have no RAG content to ground them. The LLM currently answers from general knowledge, violating the core product rule.
- **No regression test suite** — old `test:lesson-flow` and `test:tutor-conversations` scripts were deleted in TASK-023 and not replaced. Current `test:ask-db` is a shallow persistence-only check.
- **Frontend lesson state display missing** — no "continue lesson" UI, no lesson progress display.
- **No streaming** — frontend shows loading spinner until full response arrives (can be 30-90s).
- **No deployment config** — no Dockerfile, no CI/CD, no production env setup.
- **Math subject content** — only Science is indexed. Schema supports broader subjects but no content exists.

### BROKEN / LIKELY FAILING

- **`npm run rag:query` is broken** — `package.json` points to `src/rag/query/pipelines/queryPipeline.js`, which does not exist in the repo. The path is a leftover reference from an older architecture.
- **`lastTopic` is silently dropped** — `step7.saveAndRespond.js` only allows fields in `ALLOWED_STATE_FIELDS`. `lastTopic` is NOT in this list. The tutor prompt explicitly sets `memoryUpdate.lastTopic`, but step7 discards it. `buildSessionPayload` then reads `chatState.lastTopic` and always returns null. The `lastTopic` context shown to the LLM in subsequent turns is always null.
- **`lastDoubtTopic`, `lastDoubtQuestion`, `lastDoubtSources`** — referenced in TASK-019 as added fields, and used in `formatMemoryForPrompt`, but also not in `ALLOWED_STATE_FIELDS`. These are never persisted; LLM context for doubt follow-ups is always empty.
- **No LLM error handling** — if Groq/Gemini/OpenAI returns a rate-limit error, auth error, or timeout, the raw provider error message surfaces to the student (confirmed by QA report P0 finding). No catch/fallback exists at the provider call boundary in steps 4 and 6.
- **Frontend can hang indefinitely** — `fetch()` in `tutorApi.js` has no timeout or AbortController. A slow or rate-limited backend leaves the UI in a permanent loading state (confirmed by QA report, 37+ seconds observed).

---

## 4. Bugs and Errors

### Bug 1 — `lastTopic` never persisted (file: `step7.saveAndRespond.js:15-19`)
`ALLOWED_STATE_FIELDS` does not include `lastTopic`, `lastDoubtTopic`, `lastDoubtQuestion`, or `lastDoubtSources`. The LLM includes these in `memoryUpdate` per the prompt contract, but `sanitizeMemoryUpdate()` silently drops them. The tutor context in every turn shows `lastTopic: null`, degrading follow-up quality.

### Bug 2 — `rag:query` script path does not exist (`package.json:16`)
```json
"rag:query": "node src/rag/query/pipelines/queryPipeline.js"
```
That file does not exist. Running `npm run rag:query` will always fail with MODULE_NOT_FOUND.

### Bug 3 — No LLM provider error handling (`step4.decideRetrieval.js`, `step6.generateResponse.js`)
Both steps call `getDeciderChain().invoke()` / `getResponseChain().invoke()` inside a try/catch only in step6 (step4 has NO try/catch). Provider errors (429, 401, timeout, JSON parse failure) in step4 throw unhandled exceptions that become raw 500 responses. Step6 has a catch that calls `createFallbackResponse`, but the fallback checks `responseMode` which can be undefined in the error path.

### Bug 4 — CORS is fully open (`app.js:14`)
```js
app.use(cors());
```
No origin restriction. Any website can call this API. Not critical for local dev, but a problem before any production deploy.

### Bug 5 — Duplicate `PORT=5000` in `.env` (`backend/.env:1,15`)
`PORT` is defined twice. The second definition takes effect. Harmless now but confusing.

### Bug 6 — `createChatSession` is never called from the ask flow
`chatSession.service.js` exports `createChatSession`, but the actual ask flow uses `updateChatSessionState` with `upsert:true` for new sessions. The explicit create function is dead code in the runtime path (though it may be used in tests).

### Bug 7 — `chatState` schema missing `lastTopic` and doubt fields (`chatSession.model.js`)
`lastTopic`, `lastDoubtTopic`, `lastDoubtQuestion`, `lastDoubtSources`, `completedTopicIds` are used throughout the codebase but are not declared in the Mongoose schema. Mongoose will silently drop them on strict mode upserts unless the schema has `strict: false`. The default is `strict: true`, so these fields will never be stored.

### Bug 8 — `loadLangChainMemoryVectorStore` in `vectorStorePersistence.js` vs `vectorStoreLoader.js`
There are two separate implementations: `vectorStorePersistence.js` (used by `indexPipeline.js`) and `vectorStoreLoader.js` (used by `retriever.js`). They have different validation logic. If they diverge on what a "valid" vector store looks like, indexing and retrieval will mismatch silently.

---

## 5. Anti-Patterns / Bad Structure / Tech Debt

### AI-generated comment bloat in ask steps
`step4.decideRetrieval.js`, `step5.retrieveContent.js`, and `step6.generateResponse.js` are heavily bloated with AI-style filler comments ("PRODUCTION-GRADE ORCHESTRATOR COMPONENT", "Resolves reference loops by reviewing historical semantic hydration hooks", "Cryptic database IDs", "Concurrent-safe curriculum initialization zone"). These comments describe what the code obviously does rather than why. The actual code is fine; the comments reduce readability and signal.

### Two LLM calls per request with no caching
Every student message makes 2 LLM API calls (decider + tutor), plus 1 embedding call (Gemini). That's 3 external API calls per turn minimum. For conversational intents (greetings, CHOOSE_COURSE, NEXT_STEP, EXPLAIN_MORE), the decider correctly sets `needsRetrieval=false`, but the embedding call still happens if retrieval is triggered. Decider results could be cached for identical questions within the same session.

### StudyMap is fetched on every Ask request (Step 3)
`getStudyMap()` is called inside `buildContext()` on every single request. If StudyMap loads from disk or a DB each time, this is unnecessary I/O. The curriculum doesn't change at runtime.

### Decider and response chains are lazy singletons that capture provider config
`deciderChain` and `responseChain` are module-level singletons built the first time they're called. The LLM provider is baked in at first call from env vars. Changing `LLM_PROVIDER` at runtime (without restart) has no effect. This is acceptable but not obvious.

### Frontend `findChapterById` duplicates `selectedChapter` logic in `App.jsx`
`findChapterById` (line 108-128) is nearly identical to the `selectedChapter` useMemo (line 86-106). Both iterate the same nested structure. This could be one utility function.

### No input sanitization for `sessionId`
`requestedSessionId` from the request body is used directly in MongoDB queries. It's string-cleaned but not validated as a UUID. A user can pass any string as sessionId and create/access arbitrary session documents.

### `vector-store.json` is ~70MB+ and loaded into RAM
The file contains 600 vectors at 3072 floats each. Loading and parsing this synchronously on first request adds significant startup latency. The `vectorStoreLoader` caches it after first load (correct), but the first request to any fresh process will be very slow.

---

## 6. Security Issues

### CRITICAL — Real API keys are in `backend/.env` on disk
The `.env` file contains:
- `GEMINI_API_KEY=AIzaSyB658...` (real Google AI key)
- `GROQ_API_KEY=gsk_aeFEgi...` (real Groq key)  
- `MONGO_URI=mongodb://farhanraza2239:Farhan%4012345@...` (real MongoDB Atlas credentials with username and password in the connection string)

The `.env` file IS gitignored and is NOT in the git history (verified). However, the file exists on the developer's machine. If this machine or any backup is shared, all three keys are exposed. The MongoDB URI contains a plaintext password with special character encoding (`%40` = `@`). **These keys should be treated as compromised and rotated before any deployment.**

### No authentication or authorization
There is no auth layer. Anyone who can reach the API can:
- Create unlimited sessions
- Send unlimited questions (no rate limiting)
- Read or create chat history for any sessionId they know/guess

### `sessionId` is not access-controlled
Session documents are looked up purely by sessionId string. A user who knows (or guesses) another user's sessionId can read their conversation history. UUIDs are hard to guess but there's no verification.

### Open CORS
`app.use(cors())` with no origin restriction means any website can make authenticated-looking requests to the API.

### Raw error messages exposed to clients
The error middleware (`error.middleware.js`) returns `error.message` directly. Provider errors can include API key details, rate limit quota info, internal model names, or organization IDs. This leaks internal infrastructure details to students.

---

## 7. Cost / Efficiency Issues in RAG + LLM Usage

### Two LLM calls per turn is high for a tutor MVP
- Call 1: Decider (classifies intent, ~200-400 input tokens)
- Call 2: Tutor (generates answer, ~1000-3000 input tokens including full curriculum summary, history, and retrieved context)

For greetings and meta questions, Call 2 receives `retrievedContext = 'NO_RETRIEVED_CONTEXT'` but still sends the full curriculum summary (all 16 chapters listed) in the prompt. This is wasted tokens for every non-RAG turn.

### Full curriculum summary sent on every tutor call
`curriculumSummary` (all 16 chapters listed by subject/section) is included in every tutor prompt via `formatStudyMapSummary()`. For greetings, this is irrelevant and costs ~300-500 tokens each time.

### Gemini embedding called per request (not batched)
Each retrieval turn embeds only the search query — one embedding API call. This is correct and efficient. However, there's no embedding cache, so identical questions in different sessions re-embed.

### Vector store loaded cold on first request
`vector-store.json` (~70MB+, 600 vectors at 3072 floats) is read from disk and parsed on the first retrieval request. Subsequent requests use the in-memory cache. But with Groq latency + embedding + two LLM calls, overall latency per turn is 5-30+ seconds. The QA report noted a 94-second timeout case.

### No streaming
The frontend waits for the full response before rendering anything. LLM streaming would dramatically improve perceived responsiveness at near-zero additional cost.

### `MemoryVectorStore` scales linearly
Cosine similarity is computed against all 600 vectors on every search. For 600 vectors this is fast, but it will not scale. Noted in decisions as a known limitation to fix later.

---

## 8. Open Questions About Intent

### What language should the "source of truth" content be?
Current content is curated English Markdown. The target students speak Hindi/Hinglish. The tutor answers in Hinglish. But the retrieved context is English. Is the plan to always keep the content in English and rely on the LLM to translate? Or will Hindi/Hinglish content be added later?

### What happens when students ask math questions?
The schema supports multiple subjects (`currentSubjectId`), and the sidebar has placeholder slots for future subjects, but there's no Math (or Social Science, etc.) content. If a student asks a Math question, the decider may classify it as `OUT_OF_CONTEXT`. Is that the intended behavior?

### Why does the Decider not handle NEXT_STEP and EXPLAIN_MORE with retrieval?
`NEXT_STEP` and `EXPLAIN_MORE` are routed with `needsRetrieval=false`. The comment says "we use studyMap logic downstream" for NEXT_STEP — but there is no downstream studyMap routing in the current LLM-first flow. The tutor LLM just gets `NO_RETRIEVED_CONTEXT` and must answer from memory/history. Is this intentional, or was there supposed to be cached topic retrieval for these intents?

### Is the `rag:query` CLI command intended to be restored?
`package.json` has `"rag:query": "node src/rag/query/pipelines/queryPipeline.js"` but the file doesn't exist. Was this script removed intentionally with TASK-023 (which removed the old planner/executor) or is it meant to be replaced?

### What is the intended `lastTopic` / doubt-context behavior?
TASK-019 documents adding `lastDoubtTopic`, `lastDoubtQuestion`, etc. to chatState, and the prompt and `formatMemoryForPrompt` reference these fields. But they're not in the Mongoose schema or `ALLOWED_STATE_FIELDS`. Was this work left half-done, or is there a plan to add these fields to the schema?

### What is the production deployment target?
No Dockerfile, no CI/CD config, no hosting mentions. Railway? Render? EC2? The `vector-store.json` file at ~70MB+ means it must either be bundled in the deployment or regenerated on startup — neither is handled.

### Is the `@langchain/classic` package intentional?
`@langchain/classic` is used for `MemoryVectorStore`. This package is a compatibility shim for older LangChain v0.x APIs. The rest of the codebase uses `@langchain/core` (v1.x). Is there a plan to migrate MemoryVectorStore to the non-classic package, or is this pinned intentionally?
