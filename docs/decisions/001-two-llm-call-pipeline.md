# ADR-001: Two LLM calls — decider, then tutor

- **Date:** 2026-05 (recorded retroactively 2026-08-28)
- **Status:** Accepted

## Context
A student message can be a science question, a greeting, an exam query, emotional
distress, abuse, or off-topic. Each needs a different response and a different cost.
Retrieval is expensive and only some intents need it.

## Decision
Two sequential LLM calls per turn:
1. **Decider** (`ask/step4.decideRetrieval.js`) — classify intent, produce an English search query
2. **Tutor** (`ask/step6.generateResponse.js` → `ask/intentRouter.js`) — write the student-facing answer

Retrieval (step 5) runs only when the decider says it is needed.

## Why
- A misclassification fails cheaply, at the decider, instead of producing a wrong lesson
- Retrieval is skipped for greetings, emotional support, exam queries, and abuse — most non-academic turns cost nothing in vector search
- The decider translates Hinglish to English, which retrieval requires: measured on 10 real student questions, raw Hinglish returned **0 chunks**, its English translation returned 5 chunks in 10/10 cases

## Rejected alternatives
| Option | Why not |
|---|---|
| One combined call | Cannot skip retrieval; a single failure produces a wrong lesson instead of a cheap misroute |
| Classifier without LLM (rules/regex) | Cannot handle Hinglish paraphrase or translate to an English search query |
| Tool/function calling | Fixed 9-way classification; a strict JSON schema is cheaper and more deterministic |

## Consequences
- **Easy:** cheap failure, cheap non-academic turns, debuggable routing
- **Hard:** two round trips add latency; per-turn token cost is ~6,100 (see `docs/ZUNO_VERIFIED_FACTS.md` §1)

## Revisit when
- End-to-end latency exceeds 3 seconds consistently, or
- LLM cost becomes the binding constraint and a deterministic pre-router (BACKLOG O6) is not enough
