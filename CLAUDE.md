# CLAUDE.md — Zuno

@AGENTS.md

> This file says **what the project is**.
> `AGENTS.md` says **how the work must be done**.

---

## Project

**Zuno** is an AI tutor for Bihar Board Class 10 Science.

A student asks in Hindi, Hinglish, or simple English.
The answer always comes back in simple Roman-script Hinglish.

It is a RAG system:
curated Markdown content → chunks → embeddings → MongoDB Atlas Vector
Search → retrieved context → LLM answer.

---

## System laws — these never change

1. **Answer only from retrieved content.** If the retrieved context is not
   enough, return `status: insufficient_context` and tell the student
   clearly. Never answer from general LLM knowledge.

2. **Student answers are always simple Roman-script Hinglish.** Use
   Devanagari only when `answerLanguageInstruction` asks for it.

3. **One vector store, one embedding provider.** Indexing never falls back
   to another provider. If the provider changes, re-index everything.

4. **Never hardcode chapter names in code.** They come from the Study Map
   API.

5. **Indexing and retrieval stay separate.** Do not mix the two.

---

## Map — where to start reading

| Task | First file |
|---|---|
| Ask pipeline (the product itself) | `backend/src/ask/askOrchestrator.js` |
| RAG retrieval | `backend/src/rag/retriever.js` |
| RAG indexing (offline) | `backend/src/rag/indexPipeline.js` |
| Prompts | `backend/src/prompts/` |
| API routes | `backend/src/routes/` |
| DB schemas | `backend/src/models/` |
| Frontend pages | `frontend/src/pages/` |
| Streaming call | `frontend/src/api/tutorApi.js` |
| Study content | `data/class-10/science/` |

---

## Home — where each thing lives

None of this is ever copied into this file.

| Thing | Home |
|---|---|
| How to run an audit | `AUDIT_RULES.md` |
| Why a decision was made | `docs/decisions/` |
| Environment variables | `backend/.env.example` |
| Commands (test, rag, db) | the `scripts` block in `backend/package.json` |
| Tech stack and versions | `package.json` |
| How quiz work is run | `docs/quiz/QUIZ_EXECUTION_PROTOCOL.md` |

**The project's current status is not here — and do not trust any doc for
it.** Read the code, or ask the owner. The owner will say which file the
work is in.

---

## Three rules for this file

1. **Never let it grow past 100 lines.**
2. **Never copy anything the repo already holds.** Folder tree, env list,
   API list, versions — each stays in its own home.
3. **Nothing that changes day to day belongs here.**
