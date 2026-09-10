# Architecture Decision Records (ADRs)

## What this is

One file per significant architectural decision. Each records **what** was
decided, **why**, **what was rejected**, and **what would make us revisit it**.

## Why this exists

An AI agent has no memory between sessions. It reads code, not reasoning. A
reviewer who does not know *why* a decision was made will treat it as a mistake
— including decisions it made itself in an earlier session.

That is exactly what happened repeatedly on this project: a decision would be
made together, implemented, and then "discovered as a problem" weeks later.

**These files are the project's memory.** They live in the repo, so they survive.

## The rule (also in `AUDIT_RULES.md`, Rule 7)

If a review finding contradicts an ADR, it must say so explicitly:

> "This contradicts ADR-00X. The new evidence is: ___"

Silently re-litigating a settled decision is not allowed.

## Writing a new ADR

Copy `TEMPLATE.md`. Number sequentially. Never edit a decision after it is
accepted — supersede it with a new ADR and mark the old one `Superseded by ADR-0XX`.

## Index

| # | Decision | Status |
|---|---|---|
| [001](001-two-llm-call-pipeline.md) | Two LLM calls: decider then tutor | Accepted |
| [002](002-mongodb-atlas-vector-search.md) | MongoDB Atlas Vector Search as the vector store | Accepted |
| [003](003-openai-as-primary-provider.md) | OpenAI as primary LLM and embedding provider | Accepted |
| [004](004-per-intent-prompts.md) | Per-intent prompts instead of one monolithic tutor prompt | Accepted |
| [005](005-chapterprogress-single-source.md) | ChapterProgress owns topic progress, not chatState | Accepted |
| [006](006-exam-data-outside-vector-store.md) | Exam pattern data stays out of the vector store | Accepted |
| [007](007-science-only-v1-scope.md) | Science only for v1 — no other subjects | Accepted |
| [008](008-hinglish-answer-language.md) | All answers in Roman-script Hinglish | Accepted |
| [009](009-staged-delivery-model.md) | Staged delivery with written exit criteria | Accepted |
| [010](010-freeze-quiz-bulk-branch.md) | Freeze `quiz-phase0.5-bulk`, do not merge — its output already reached `main` | Accepted |
| [011](011-decider-structured-output.md) | Decider LLM uses structured output; parse-error fallback removed (fixes BUG-1/BUG-2) | Accepted |
| [012](012-server-side-guest-identity.md) | Guest identity is a server-signed token in the X-Guest-Id header (not a client UUID, not a cookie) | Accepted |
