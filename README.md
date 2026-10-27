# Bihar Board AI Tutor

## Goal

Build a Bihar Board Class 10 Science AI Tutor that answers student questions using approved study content through Retrieval-Augmented Generation (RAG).

Students may ask questions in Hindi, Hinglish, or simple English. The final answer should be simple Hinglish and must be grounded only in retrieved/indexed source content.

## Current Status

Backend RAG MVP is working, and the Ask API has been rebuilt around a simpler LLM-first tutor flow.

Completed:

- Curated Science Markdown loader.
- RAG chunker.
- LangChain-based embeddings — OpenAI `text-embedding-3-large` primary, Gemini `gemini-embedding-001` as query-time fallback only (see `CLAUDE.md` for details).
- MongoDB Atlas Vector Search (`$vectorSearch`) retrieval — replaced the earlier local JSON `MemoryVectorStore` approach.
- Lightweight reranking and final retrieval filtering.
- Grounded LLM answer generation.
- Simple Hinglish answers with source attribution.
- Safe fallback when retrieved context is insufficient.
- Study Map API for available chapters.
- Ask API with Global Mode and Focus Mode.
- MongoDB-backed chat sessions, chat history, and tutor state.
- LLM-first scope/retrieval decider.
- Optional RAG retrieval only when study content is needed.
- Main tutor response LLM with a strong tutoring system prompt.
- Flexible structured response sections for frontend rendering.
- Zuno React frontend (React Router + Redux Toolkit), not just a foundation.
- MongoDB-backed compact memory and chat history.
- Full auth system, Redis caching, and production deployment (see below and `CLAUDE.md`).

Not included yet:

- Formal evaluation question set beyond the current golden-set regression tests (`npm run test:golden`).
- Curated foundation/orientation content (see `docs/archive/plans/PRE_LAUNCH_BLOCKERS.md`).
- Frontend lesson-specific UI polish.

## Initial Scope

- Class 10 Science only.
- Current curated content includes 16 Science chapter Markdown files across Physics, Chemistry, and Biology.
- Backend RAG pipeline first.
- Source content stored locally as clean text files first.
- Started with a local JSON-persisted vector store; since migrated to MongoDB Atlas Vector Search for production.
- Ask API is implemented for question answering and lesson flow.

## Architecture Summary

```text
Study Content
-> Data Loader
-> Text Cleaner
-> Chunker
-> Metadata Builder
-> Embedding Generator
-> MongoDB Atlas Vector Store
-> Retriever
-> Grounded Prompt Builder
-> LLM Answer Generator
-> Hinglish Answer with Sources
```

Student question flow:

```text
Student Question
-> API Endpoint
-> Query Processing
-> Vector Search
-> Relevant Chunks
-> Grounded Hinglish Prompt
-> LLM
-> Answer + Sources + Status
```

Current Ask API direction:

```text
User Message
-> Compact Memory + Recent History
-> LLM Scope/Retrieval Decider
-> Optional RAG Retrieval
-> Tutor Response LLM
-> Structured Sections + Sources
-> Saved History/Memory
```

See:

```text
docs/tutor-engine-langchain-architecture.md
```

## RAG Commands

Run commands from the `backend/` folder.

Create or refresh the vector index:

```bash
npm run rag:index
```

This command loads the curated Science documents, chunks them, creates LangChain documents, generates embeddings (OpenAI primary, Gemini fallback — see `CLAUDE.md`), and writes them into the `Chunk` collection in MongoDB Atlas, which has a Vector Search index (`vector_index`) configured on the `embedding` field.

Retrieve relevant chunks for a question (retriever smoke test):

```bash
npm run rag:test-retriever
```

Run a full grounded-answer smoke test:

```bash
npm run rag:test-answer
```

These commands query MongoDB Atlas directly via `$vectorSearch` — there is no local JSON vector file anymore. They do not re-embed all chunks; they embed only the query and print the retrieved chunks (with scores and metadata) and, for `rag:test-answer`, the generated Hinglish answer.

## First Milestone

The original first milestone was to create a minimal backend pipeline that can:

1. Load curated Class 10 Science chapter text files.
2. Clean and normalize text.
3. Chunk content with useful metadata.
4. Generate embeddings.
5. Persist chunks in a local vector store or JSON-based store.
6. Retrieve relevant chunks for a student question.
7. Generate a simple Hinglish answer grounded only in retrieved chunks.
8. Return answer, sources, and status from one API endpoint.

Current backend status:

- Steps 1-8 are implemented for local backend testing.
- The active curated dataset contains 16 Science chapters.
- The vector index is generated directly into MongoDB Atlas (`Chunk` collection) via `npm run rag:index`.
- The Ask API is available at `POST /api/v1/ask`.
- The Study Map API is available at `GET /api/v1/study-map`.
- MongoDB-backed session/history/state is implemented.
- The Zuno frontend foundation exists under `frontend/`.
- The Ask API now uses the LLM-first scope/retrieval decider and tutor response prompt.
- The old deterministic planner/router/executor runtime path has been removed.
- The frontend can render structured Zuno response sections.
- The next work is curated foundation/orientation Markdown content plus live prompt QA.

## Intentionally Not Included Yet

- Admin panel.
- Analytics.
- Quiz system.
- PDF/OCR pipeline.

MongoDB Atlas Vector Search is the production vector database — see "Current Status" above.

Authentication is fully built and security-stabilized (JWT access/refresh tokens,
Redis session whitelist, bcrypt, email register + verification, Google OAuth,
guest-to-user progress migration). See
[`docs/archive/auth/AUTH_SECURITY_PLAN.md`](docs/archive/auth/AUTH_SECURITY_PLAN.md)
for the full audit and current status, and
[`docs/archive/auth/AUTH_PLAN.md`](docs/archive/auth/AUTH_PLAN.md) for the original
architecture design.
