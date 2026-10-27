# AGENTS.md

## Project

Bihar Board Class 10 Science AI Tutor ("Zuno").

This project is an education-focused RAG system. It helps Bihar Board Class 10 students ask Science questions in Hindi, Hinglish, or simple English and receive simple Hinglish answers grounded only in approved study content.

## Current Phase

Post-MVP. The core pipeline, auth system, and frontend are built and deployed live. Work now is pre-launch polish, bugfixes, and content gaps.

Status, known bugs, and pending work are **not tracked in this file** — see `PROJECT_STATE.md` and `STAGE1_DONE.md` (same reasoning as `CLAUDE.md`'s "Current Project Status" section: duplicating live status here is what makes files like this go stale).

Application code may be written when the user explicitly asks for implementation. Keep changes scoped to the active task.

## Core Product Rule

The tutor must answer only from retrieved/indexed source content. If the available retrieved content is not enough to answer, it must clearly say that the available material does not contain the answer.

## Working Rules

- Always read `CLAUDE.md` first for current architecture — this file covers working rules and protocol, `CLAUDE.md` covers what's actually built and how.
- Read `PROJECT_STATE.md` and `STAGE1_DONE.md` before starting any new task.
- Work on one task at a time.
- Do not overbuild — no admin panel, analytics, or quiz system unless explicitly asked.
- MongoDB/Mongoose is used for chat sessions, chat history, tutor state, user accounts, and chunk vectors (MongoDB Atlas Vector Search — not a local JSON store).
- A full React frontend exists (React Router + Redux Toolkit, multiple pages) — not a minimal single-component app.
- A full auth system exists (JWT access/refresh tokens, Google OAuth, email verification, bcrypt) — treat it as an existing subsystem to respect, not something to avoid adding.
- LangChain and the RAG framework are core dependencies already in use, not something to introduce later.
- Do not install packages without a clear reason.
- Do not change the documented architecture without permission.
- Keep source attribution in every RAG output.
- Keep final student-facing answers in simple Hinglish.
- Do not hardcode chapter names — read available content from the Study Map API or Curriculum Brain.
- **Never work directly on `main`** — it's live/deployed. Always create a new branch first, even for tiny changes; merge only when explicitly told to.
- Default to no code comments unless they explain a non-obvious *why* (a hidden constraint, a workaround, a subtle invariant) — not what the code does.

## Current Architecture (high level)

```text
Study Content
-> Data Loader
-> Text Cleaner
-> Chunker
-> Metadata Builder
-> Embedding Generator (OpenAI primary, Gemini fallback)
-> MongoDB Atlas Vector Search
-> Retriever
-> Grounded Prompt Builder
-> LLM Answer Generator
-> Hinglish Answer with Sources
```

See `CLAUDE.md` for the full tech stack, folder structure, and env vars.

The curated Science set has 16 Markdown chapters across Physics, Chemistry, and Biology. Do not hardcode chapter lists in frontend/router logic; read available content from the Study Map API or Curriculum Brain.

## After Each Task

At the end of each task, report:

- Files changed.
- Commands to run.
- What was verified.
- The next recommended step.

## Deployment & Execution Protocol (User Rule)

- Work on **ONE Phase per session**.
- Before executing any Phase, **explain the Phase in simple Hinglish first** (What & Why).
- Wait for the user to confirm they fully understand the concept.
- Once confirmed, give execution instructions **STRICTLY ONE STEP AT A TIME**. Never dump multiple steps at once.
- Wait for user confirmation, screenshot, or output after each step before giving the next step.
