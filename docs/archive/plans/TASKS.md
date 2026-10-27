# TASKS.md

## Project

Bihar Board Class 10 Science AI Tutor

## Current Direction

The project uses curated English Markdown files as the primary knowledge source for RAG.

Hindi PDFs are reference material only.

The app should not depend on raw PDF parsing quality for production RAG content.

The active Ask API architecture is now LLM-first:

```text
User message
-> compact DB memory + recent history
-> LLM scope/retrieval decider
-> optional RAG retrieval
-> tutor response LLM with strong system prompt
-> structured sections + sources
-> saved history/state
```

The old deterministic planner/router/executor runtime path has been removed.

## Current Active Task

Status, active work, and pending items are **not tracked in this file** — see `PRE_LAUNCH_BLOCKERS.md`'s "Active Task Workspace" section and whatever plan file is newest in the repo root (e.g. `HINGLISH_QUERY_FIX_PLAN.md`). This section previously said "no active task" long after work had moved on — duplicating live status here is what caused that.

Known performance backlog:
TASK-020: Performance Known Issues Backlog (still backlog — not yet started)

## Completed Tasks

### TASK-001: Minimal Backend Foundation

Status: DONE

Task file:
tasks/TASK-001-minimal-backend-foundation.md

Completed:
- Created minimal backend folder structure.
- Added health route.
- Added basic Express app/server setup.
- Added config, middleware, utils, and route structure.
- Backend runs successfully.

### TASK-002: Curated Content Foundation

Status: DONE

Task file:
tasks/TASK-002-curated-content-foundation.md

Completed:
- Confirmed curated Markdown content path.
- Established curated English Markdown as the primary RAG source.
- Kept Hindi PDFs as reference material only.
- Confirmed no embeddings, chunking, vector DB, or RAG were added.

### TASK-003: Curated Content Loader

Status: DONE

Task file:
tasks/TASK-003-curated-content-loader.md

Completed:
- Created curated Markdown loader.
- Loaded Markdown files recursively.
- Parsed frontmatter metadata.
- Added preview command for loaded curated content.

### TASK-004: Chunking Strategy

Status: DONE

Task file:
tasks/TASK-004-chunking-strategy.md

Completed:
- Split curated Markdown into RAG-friendly chunks.
- Preserved chapter, section, heading, and source metadata.
- Verified chunker behavior with 27/27 tests passing.
- Generated 600 valid chunks from 16 Science documents.

### TASK-006: LangChain Embeddings and Vector Store Fix

Status: DONE

Task file:
tasks/TASK-006-langchain-embeddings-vector-store-fix.md

Completed:
- Rejected the earlier manual embedding/search approach.
- Moved active embedding and retrieval implementation to LangChain primitives.
- Used LangChain `GoogleGenerativeAIEmbeddings`, `Document`, and `MemoryVectorStore`.

### TASK-007: LangChain Embedding Retrieval Tests

Status: DONE

Task file:
tasks/TASK-007-langchain-embedding-retrieval-tests.md

Completed:
- Added embedding smoke, vector-store validation, and retrieval smoke scripts.
- Verified imports, environment setup, and active pipeline wiring.

### TASK-008: LangChain Embeddings, Vector Store, and Retrieval

Status: DONE

Task file:
tasks/TASK-008-langchain-embeddings-vector-store-retrieval.md

Completed:
- Indexed 16 documents.
- Generated 600 chunks.
- Saved 600 vectors to `backend/storage/vector-store.json`.
- Verified vector store validation with embedding dimension 3072.
- Verified retrieval for Hindi, Hinglish, and English queries.

### TASK-009: RAG Query Layer and Grounded Answer Generation

Status: DONE

Task file:
tasks/TASK-009-rag-query-answer-generation.md

Completed:
- Added query-side RAG structure for retriever, reranker, prompt, chain, parser, LLM config, and answer service.
- Added lightweight reranking and final filtering after vector search.
- Added grounded prompt builder through LangChain `ChatPromptTemplate`.
- Added provider-based LLM answer generation through LangChain LCEL.
- Added simple Hinglish answer generation with sources.
- Added insufficient-context fallback.
- Added Ask API with Global Mode and Focus Mode.
- Added Study Map API for frontend chapter discovery.
- Documented Ask API and Study Map API behavior.

### TASK-010: LangChain-First Tutor Engine Architecture and Curriculum Foundation

Status: DONE

Task file:
tasks/TASK-010-tutor-engine-langchain-planning-layer.md

Completed:
- Documented the LangChain-first Tutor Engine architecture.
- Marked the existing rule/hybrid router as a temporary compatibility layer.
- Curriculum Brain foundation from curated Markdown.
- Chapter/topic resolver foundation.
- Resolver regression tests.
- Loader/chunker test path correction so the deterministic regression suite points at root `data/class-10/science`.
- DB-backed Tutor State was completed later in TASK-011 through TASK-014.
- Deterministic lesson flow and grounded lesson generation were completed later in TASK-015 and TASK-016.

Remaining Tutor Engine work is tracked as the next recommended implementation task:
- LangChain structured planner.
- Action executor.
- Conversation regression tests.

### TASK-011: MongoDB/Mongoose Foundation

Status: DONE

Task file:
tasks/TASK-011-mongodb-mongoose-foundation.md

Current scope:
- Add Mongoose dependency.
- Add `MONGODB_URI` environment config.
- Add MongoDB connect/disconnect helper.
- Wire server startup to MongoDB connection.
- Add a DB ping script for Atlas connection verification.
- Add beginner-friendly Mongoose schemas/services for `chat_sessions`, `chat_history`, and `chat_states`.

Verified:
- `npm.cmd run test:chat-db-models` passed against MongoDB Atlas.

### TASK-012: DB-backed Ask API Integration

Status: DONE

Task file:
tasks/TASK-012-db-backed-ask-api-integration.md

Completed:
- Ask API creates a DB chat session when `sessionId` is missing.
- Ask API reuses a DB chat session when `sessionId` is provided.
- Student messages are saved in `chat_history`.
- Tutor responses are saved in `chat_history`.
- `chat_states` is created/updated with basic current state.
- Ask response still returns `session.sessionId`.
- `npm.cmd run test:ask-db` passed against MongoDB Atlas.

### TASK-013: Frontend Session Handling

Status: DONE

Task file:
tasks/TASK-013-frontend-session-handling.md

Completed:
- Frontend reads saved `sessionId` from localStorage.
- First Ask request can be sent without `sessionId`.
- Frontend saves backend returned `session.sessionId`.
- Later Ask requests send saved `sessionId`.
- `npm.cmd run build` passed.
- `npm.cmd run test:ask-db` passed.

### TASK-014: DB-backed Tutor State Context

Status: DONE

Task file:
tasks/TASK-014-db-backed-tutor-state-context.md

Current scope:
- Load saved `chat_states` into Ask API context before routing.
- Save last topic/answer/sources/intent back into `chat_states`.
- Use DB-backed state for metadata follow-up context.

Verified:
- `npm.cmd run test:ask-db` passed with DB state hydration.
- `npm.cmd run test:chat-db-models` passed.
- `npm.cmd run test:study-map` passed.
- `npm.cmd run test:curriculum-resolvers` passed.

### TASK-015: Lesson Start / Continue Backend Flow

Status: DONE

Task file:
tasks/TASK-015-lesson-start-continue-backend-flow.md

Current scope:
- Start lesson from chapter request.
- Continue lesson from DB state.
- Save current topic and completed topics.
- Add lesson flow regression test.

Verified:
- `npm.cmd run test:lesson-flow` passed.
- `npm.cmd run test:ask-db` passed.
- `npm.cmd run test:chat-db-models` passed.
- `npm.cmd run test:study-map` passed.
- `npm.cmd run test:curriculum-resolvers` passed.

### TASK-016: Grounded Lesson Generation from Retrieved Topic Context

Status: DONE

Task file:
tasks/TASK-016-grounded-lesson-generation.md

Completed:
- Added topic-based lesson retrieval scoped to the current chapter.
- Added grounded lesson prompt and LangChain lesson chain.
- Replaced lesson placeholder text with generated lesson content from retrieved chunks.
- Returned sources in lesson start/continue responses.
- Saved lesson sources in session context.
- Strengthened lesson-flow regression test to require sources and reject old placeholder text.

Verified:
- `npm.cmd run test:lesson-flow` passed.
- `npm.cmd run test:ask-db` passed.

### TASK-017: Tutor Engine Planner and Action Executor Foundation

Status: DONE

Task file:
tasks/TASK-017-tutor-engine-planner-executor-foundation.md

Completed:
- Create a small planner/executor foundation so Ask API decisions move out of scattered router/handler logic.
- Add shared tutor action names.
- Add deterministic planner that returns validated action plans.
- Add action executor that owns dispatch to existing handlers, RAG, metadata, and lesson services.
- Add conversation regression tests for core tutor flows.
- Fix state patching so normal doubts and no-context answers do not clear active lesson state.
- Keep current frontend-compatible response behavior.

Verified:
- `npm.cmd run test:tutor-conversations` passed.
- `npm.cmd run test:lesson-flow` passed.
- `npm.cmd run test:ask-db` passed.
- `npm.cmd run test:curriculum-resolvers` passed.
- `npm.cmd run test:study-map` passed.

### TASK-018: Conversation Regression Coverage

Status: DONE

Task file:
tasks/TASK-018-conversation-regression-coverage.md

Completed:
- Expanded backend conversation regression coverage from 3 to 10 multi-turn scenarios.
- Covered Biology subject selection followed by chapter number and next-topic continuation.
- Covered Focus Mode out-of-chapter refusal.
- Covered follow-up doubt context resolution.
- Covered ambiguous chapter-number clarification.
- Covered subject change during an active lesson.
- Covered out-of-scope question during an active lesson without clearing lesson state.
- Covered the tough chapter / difficulty-ranking guardrail so the backend does not guess unsupported rankings.
- Added deterministic extractive-only regression mode for lesson and RAG test scripts.
- Tightened Focus Mode retrieval for Latin/Hinglish questions so unrelated selected-chapter context is refused.

Verified:
- `npm.cmd run test:chunks` passed.
- `npm.cmd run test:study-map` passed.
- `npm.cmd run test:curriculum-resolvers` passed.
- `npm.cmd run test:vector-store` passed.
- `npm.cmd run test:chat-db-models` passed.
- `npm.cmd run test:ask-db` passed.
- `npm.cmd run test:lesson-flow` passed.
- `npm.cmd run test:tutor-conversations` passed.
- `npm.cmd run test:retrieval` passed.
- `npm.cmd run rag:test-retriever` passed.
- Frontend `npm.cmd run build` passed.

### TASK-019: Tutor State and Planner Edge-case Cleanup

Status: DONE

Task file:
tasks/TASK-019-tutor-state-planner-edge-cleanup.md

Completed:
- Added separate `lastDoubtTopic`, `lastDoubtQuestion`, and `lastDoubtSources` fields to chat state.
- Added matching in-memory session context fields.
- Updated DB state hydration so follow-up routing can use saved doubt context.
- Updated follow-up routing and context resolution to prefer last grounded doubt context before lesson topic context.
- Updated Ask API state saving so side doubts during active lessons do not overwrite the active lesson topic.
- Cleared stale doubt context when the student changes learning target or starts a new lesson.
- Strengthened conversation regression tests for side-doubt follow-ups and active lesson state stability.
- Strengthened chat DB model tests for the new state fields.

Verified:
- `npm.cmd run test:chat-db-models` passed.
- `npm.cmd run test:tutor-conversations` passed.
- `npm.cmd run test:lesson-flow` passed.
- `npm.cmd run test:ask-db` passed.
- `npm.cmd run test:curriculum-resolvers` passed.

### TASK-020: Performance Known Issues Backlog

Status: BACKLOG

Task file:
tasks/TASK-020-performance-known-issues-backlog.md

Tracked issues:
- Real LLM-mode QA conversation did not finish within a 10-minute timeout.
- Deterministic regression mode still takes roughly 3-8 seconds per Ask turn.
- Ask API latency likely comes from vector-store loading, embedding calls, LLM calls, MongoDB round trips, and lack of caching/streaming.
- Keep this as a later optimization backlog after the core product goal is stable.

Later expected work:
- Add timing logs.
- Cache loaded vector store in process.
- Reuse embedding/vector-store clients.
- Keep metadata/clarification paths free of RAG/LLM work.
- Consider streaming and production vector DB later.

### TASK-021: Source Dedupe and Compact Backend Source Contract

Status: DONE

Task file:
tasks/TASK-021-source-dedupe-compact-contract.md

Completed:
- Deduplicated RAG/lesson sources by chapter and heading path.
- Added compact source fields: `sourceId`, `label`, `sourceTitle`, `chapterTitle`, `topicTitle`, `sectionTitle`, and `chunkIds`.
- Preserved compatibility fields: `sourceNumber`, `section`, `headingPath`, and `chunkId`.
- Updated doubt answer API formatting to preserve compact source fields.
- Updated lesson sources through the shared formatter.
- Updated follow-up context extraction to prefer source `topicTitle`.
- Updated frontend source chips to display `label` / `sourceTitle` when available.
- Strengthened regression tests for compact, deduplicated source shape.

Verified:
- `npm.cmd run test:lesson-flow` passed.
- `npm.cmd run test:tutor-conversations` passed.
- `npm.cmd run test:ask-db` passed.
- `npm.cmd run test:chat-db-models` passed.
- Frontend `npm.cmd run build` passed.
- Manual source payload QA confirmed compact source fields are returned.

### TASK-022: Premium Dark Frontend Tutor UI Refresh

Status: DONE

Task file:
tasks/TASK-022-premium-dark-frontend-ui-refresh.md

Completed:
- Reworked Zuno frontend into a premium dark personal tutor interface.
- Added Material UI, Emotion, and MUI icons as the frontend component foundation.
- Replaced the old segmented Global/Focus mode switch with default Global behavior plus a focused chapter-selection modal.
- Added a future-ready sidebar for Tutor, History, Tracking, Quiz, and Account.
- Moved Account to the bottom of the sidebar.
- Rebuilt Focus Mode selection as a subject -> section -> chapter flow.
- Added subject-specific and section-specific icons.
- Removed the old large empty-state hero panel from the chat surface.
- Added compact Focus Mode state in the header after chapter selection.
- Added a contextual Zuno message when a Focus Mode chapter is selected.
- Fixed page scroll behavior so the page shell stays fixed and only the chat panel scrolls.
- Added chat auto-scroll after new student/tutor messages.
- Reworked chat bubbles, input bar, status alert, and loading state using Material UI components.
- Replaced the old loading text with an animated thinking indicator.
- Hid source chips from the student-facing chat UI while preserving backend source payloads.
- Removed old `ModeSwitch`, `ChapterPicker`, and `EmptyState` frontend components.

Verified:
- Frontend `npm.cmd run build` passed.

### TASK-023: LLM-first Ask Flow Rebuild

Status: DONE

Task file:
tasks/TASK-023-llm-first-ask-flow-rebuild.md

Completed:
- Replaced the old deterministic Ask API planner/router/executor path with a simpler LLM-first flow.
- Added LLM scope/retrieval decider.
- Added main tutor response LLM with flexible structured `sections`.
- Kept existing RAG retriever and source formatting.
- Simplified session/state get-or-create helpers and turn-level history persistence.
- Removed old lesson-flow, planner, router, executor, handler, and session-context files.
- Removed old regression scripts tied to the previous response contract.
- Strengthened tutor prompt with Roman Hinglish lock, silent self-check, last-response awareness, no fake physical identity, and repair behavior for robotic/repetitive replies.
- Added frontend rendering for structured Zuno `sections`.

Known issues:
- Broad foundation questions such as `Science kya hai?`, `Physics kya hai?`, `Chemistry kya hai?`, and `Biology kya hai?` need curated Markdown content.
- Study-support questions such as `main padhta hu par yaad nahi rehta` need curated study-skill/learning-support content.
- Until that content exists, LLM may answer from general knowledge or repeat weak broad explanations.

Verified:
- `node --check` passed for changed Ask/LLM flow files.
- `npm.cmd run test:study-map` passed.
- `npm.cmd run test:chunks` passed.
- `npm.cmd run test:curriculum-resolvers` passed.
- `npm.cmd run test:vector-store` passed.
- Frontend `npm.cmd run build` passed.
- `npm.cmd run test:chat-db-models` passed when network access was allowed.
- `npm.cmd run test:retrieval` passed when Gemini network access was allowed.
- `npm.cmd run rag:test-retriever` passed when Gemini network access was allowed.
- `npm.cmd run test:ask-db` passed earlier when provider quota was available; latest pre-push rerun reached Groq daily token rate limit.

QA:
- Added `docs/qa-report-2026-05-21.md` with detailed findings, possible solutions, and tradeoffs.

### TASK-024: History Panel + Session Lock

Status: DONE (verified against code 2026-07-29 — the task spec file itself still says "READY TO IMPLEMENT" and needs its own header updated separately)

Task file:
tasks/TASK-024-history-panel-session-lock.md

Completed:
- Session History Panel — `HistoryPanel.jsx` component, `useSessionList.js` hook, date-grouped session list for logged-in users.
- Session Lock UI — `AskBar.jsx` shows a lock banner and disables input via `isLocked`; `Topbar.jsx` disables the Focus button via `isSessionLocked`.

### TASK-025: Exam Knowledge Layer + Science Overview

Status: DONE (verified against code 2026-07-29 — the task spec file itself still says "READY TO IMPLEMENT" and needs its own header updated separately)

Task file:
tasks/TASK-025-exam-knowledge-and-overview-layer.md

Completed:
- `EXAM_INFO` intent added to the decider (`step4.decideRetrieval.js`), with `examEntity` extraction.
- `backend/src/knowledge/examKnowledgeService.js` — deterministic knowledge-base lookup (`getExamContext`, `resolveExamEntity`, `formatEntityFact`), bypassing vector search entirely for exam-pattern questions.
- Wired into `step5.retrieveContent.js` for `EXAM_INFO` intent.

Known remaining gap (not part of this task): general "Science kya hai?" / orientation-style overview content is still missing — tracked as `Content-1` in `PRE_LAUNCH_BLOCKERS.md`.

## Staged Project Roadmap

### Stage 0: Documentation and Project Control

Status: DONE

Completed:
- AGENTS.md
- README.md
- DECISIONS.md
- TASKS.md
- tasks/ folder

### Stage 1: Minimal Backend Foundation

Status: DONE

Completed:
- backend/
- backend/src/
- health API
- env setup
- error handling foundation
- response helper foundation

### Stage 2: Curated Content Foundation

Status: DONE

Completed:
- Clean curated Markdown content path established.
- Hindi PDFs kept as reference only.
- Curated Markdown confirmed as the real RAG source.

### Stage 3: Curated Content Loader

Status: DONE

Completed:
- Markdown files load recursively.
- Metadata is extracted and validated.
- Loader inspection and test scripts exist.

### Stage 4: Chunking Strategy

Status: DONE

Completed:
- Chunker tests passed.
- 600 valid chunks generated from 16 Science documents.

### Stage 5: Embeddings and Vector Store

Status: DONE

Completed:
- Gemini `gemini-embedding-001` selected.
- LangChain `GoogleGenerativeAIEmbeddings` used.
- LangChain `MemoryVectorStore` used.
- Local JSON persistence added at `backend/storage/vector-store.json`.
- 600 vectors saved.

### Stage 6: Retrieval Pipeline

Status: DONE

Completed:
- Query loads saved vector store.
- Query embeds only the user question.
- LangChain `similaritySearchWithScore` retrieves matching chunks.
- Retrieval tested with Hindi, Hinglish, and English queries.

### Stage 7: Grounded Answer Generation

Status: DONE

Completed:
- Retrieved chunks are formatted into grounded context.
- Sources are formatted and attached to answers.
- Grounded tutor prompt is implemented.
- LangChain LCEL answer chain is implemented.
- Simple Hinglish answers are generated.
- Insufficient-context fallback is implemented.
- Extractive fallback exists for model errors.

### Stage 8: Backend API Integration

Status: DONE

Completed:
- Ask question endpoint exists at `POST /api/v1/ask`.
- Study Map endpoint exists at `GET /api/v1/study-map`.
- Global Mode is supported.
- Focus Mode with chapter filter is supported.
- Request validation exists.
- Central error handling is used.
- Structured response format is documented.

### Stage 9: Evaluation and Quality Testing

Status: ONGOING (not a one-time PARTIAL — this stage doesn't fully "finish", see below)

Completed:
- Manual API and frontend tests found important tutor-flow gaps.
- Lesson-flow and conversation regression tests (see TASK-018/019 above).
- Golden-set regression harness added (`npm run test:golden`, `scripts/run-golden-set.js`) — actively maintained, see `HINGLISH_QUERY_FIX_PLAN.md` for the latest round of fixes against it.
- Polish issues from real chat testing are tracked in `docs/polish-notes.md`.

Remaining work:
- Continue expanding golden-set coverage as new query patterns are found.
- Improve answer quality, source display, and tone — ongoing, not a fixed backlog.
- Improve API latency later; details are tracked in TASK-020.

### Stage 10: LLM-first Tutor Engine

Status: DONE (core flow) — one known content gap remains

Completed:
- Curriculum Brain from curated Markdown.
- Chapter/topic resolver.
- DB-backed tutor state.
- LLM-first Ask flow.
- Scope/retrieval decider, including `EXAM_INFO` intent (TASK-025).
- Strong tutor response prompt.
- Structured response sections.
- Old deterministic planner/router/executor runtime removed.
- Exam knowledge layer (TASK-025) and history panel/session lock (TASK-024).

Remaining:
- Curated foundation/orientation Markdown content (e.g. "Science kya hai?") — tracked as `Content-1` in `PRE_LAUNCH_BLOCKERS.md`, not yet done.
- Performance optimization later; known issues are tracked in TASK-020.

### Stage 11: Frontend

Status: SUBSTANTIALLY DONE — no longer "minimal"

Completed:
- Full auth flow: login, register, forgot/reset password, verify email, Google OAuth callback (React Router, `react-oauth/google`).
- Redux Toolkit store with `redux-persist` for auth state.
- Zuno React frontend with premium dark UI (Material UI).
- Global/Focus mode with subject/section/chapter selection modal.
- Session History Panel + Session Lock UI (TASK-024).
- Lesson state display and topic-progress tracking (`currentTopicId`, roadmap messages) wired through `ChapterProgress` — sessions resume where the student left off.
- Guest limit modal, guest login prompt, guest-to-user progress migration.
- Error boundaries, toast notifications.
- Chat auto-scroll, source chips hidden from student-facing UI.

Remaining work:
- Render structured Tutor Engine actions more richly (if/when the response contract expands).
- More mobile and browser visual QA polish.

### Stage 12: Deployment

Status: LIVE — deployed and verified (see `DEPLOYMENT_PLAN.md`)

Remaining:
- Custom domain setup (last item in `DEPLOYMENT_PLAN.md`).

## Development Rules

- Work on only one task at a time.
- Do not overbuild — no admin panel, quiz, or analytics unless explicitly asked. (Auth, database, frontend, and chat history are all fully built — treat them as existing subsystems to respect, not things to avoid adding.)
- Keep backend separate from content preparation.
- Keep curated content in data folders.
- Do not commit raw PDFs unless explicitly approved.
- Retrieval must stay grounded in indexed source content.
- Never work directly on `main` — it's live/deployed. Always create a new branch first, even for tiny changes; merge only when explicitly told to.

## Next Task Rule

See "Current Active Task" above for where to find live status — this section previously named a specific next task that had long since been superseded, which is exactly the kind of thing that goes stale here.

One durable rule that's still current: do not return to large manual intent/router rules as the primary solution. Keep the LLM-first flow and solve knowledge gaps through curated Markdown content plus prompt refinement.
