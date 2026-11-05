# Backend Readability Refactor — Plan v2

Written 2026-11-05 on branch `backend-readability-refactor`.
This replaces v1, which was comments-only and wrong.

---

## STATUS — read this first, update it at the end of every batch

**Branch:** `backend-readability-refactor`
**Last updated:** 2026-11-05

| Batch | State |
|---|---|
| 0 — Shared duplicates | ⏳ partly done — `utils/text.js` created, 1 of 5 `cleanText` copies removed (step1). Remaining: step7, chapterResolver, sourceFormatter, promptHelpers (`compactText`). Token helpers not started. |
| **1 — The spine** | ✅ **done 2026-11-05.** 575 → 526 lines, comments 147 → 61 (26% → 11%), internal refs 6 → 0. 4 renames. Offline 4/4 green, golden set PASS, owner read all 4 files. |
| 2 — The brain | ⬜ next |
| 3 — Retrieval + answer | ⬜ |
| 4 — `step7` alone | ⬜ |
| 5 — Edges + file rename | ⬜ |
| 6 — Auth (optional) | ⬜ |

### Decisions taken while working — do not re-litigate

- **`effectiveCount` rename: rejected.** Grep found 2 files (`askOrchestrator.js`,
  `utils/providerErrors.js`). Cross-file, so it waits for the batch that includes
  `providerErrors.js`.
- **`currentStudyContext` rename: rejected.** 2 files, and it is a returned object
  key, not a local. Riskier than a local rename.
- **LLM prompt strings: out of scope.** `step3` holds strings that go straight into
  the prompt (e.g. `'No active study topic selected...'`). They read like AI text, but
  changing them is prompt tuning, not refactoring. Not touched in any batch.
- **Second `saveAndRespond` call split too** (beyond the plan's line-131 item), so the
  same function is not called two different ways in one file.
- **4-line comment exception used once** in `askOrchestrator.js`, for the safety-net
  reason. Working as intended.

### Carried to BACKLOG, not fixed here

- `step6`'s legacy path is dead code — `USE_INTENT_ROUTER=true` in the live env.
- `_intent` / `intent` in `step7` are two different values; rename only, never merge.

---

## 0. What v1 got wrong

v1 planned **comments only**, plus a few safe renames. It parked code structure
and real renaming as "too risky".

That missed the point. The three things asked for were:

1. **Comments** — 1–2 lines, first person, simple English
2. **Code readability** — messy / clever code made simple, no shortcuts
3. **Naming** — functions and variables that sound AI-written, made human

v1 did (1) and ducked (2) and (3). But (2) and (3) are where the real
unreadability lives. Comments cannot fix a 300-line function or a variable
called `normalizedIntent` that does not hold an intent.

So: three workstreams, three different risk levels, three different gates.

---

## 1. The goal (unchanged)

**You can open any core backend file and explain it out loud — what it does and
why — without memorising anything.**

---

## 2. The critical finding — about safety, read this first

I ran the four offline tests today. All green, exit 0:

```
test:chunks  ·  test:curriculum-resolvers  ·  test:study-map  ·  test:placeholder-guard
```

**But those four do not test the ask pipeline at all.** They test the markdown
chunker, the curriculum index, the study-map API, and prompt placeholders.

So if I restructure `step5` or `step7`, **nothing in that set would catch a
mistake.** For comments that does not matter. For code structure it matters a
lot.

The real safety net is the golden set:

```bash
npm run test:golden          # 67 queries, 12 categories, full /ask pipeline
```

| Category | Queries |
|---|---|
| REAL_INPUT | 14 |
| CONCEPT_QUESTION | 10 |
| GREETING | 7 |
| EXPLAIN_MORE | 5 |
| OUT_OF_CONTEXT | 5 |
| BLIND_SPOT_TEST | 5 |
| MULTI_TURN | 5 |
| NEXT_STEP | 4 |
| CHOOSE_COURSE | 4 |
| EXAM_INFO | 3 |
| EMOTIONAL_SUPPORT | 3 |
| UNSAFE_OR_ABUSIVE | 2 |

It needs a running server + live keys, and a saved baseline already exists at
`backend/test/golden-baseline-phase1.json`.

### → The rule this creates

> **No code-structure or naming change is "done" until the golden set has run
> before and after that batch, and matches.**

Comment-only work does not need it. Everything in W2 and W3 does. You run it,
because it needs your keys.

**If you do not want to run the golden set per batch, then W3 cannot be done
safely and we should do W1 + W2 only.** That is your call, and it is the one
genuine fork in this plan.

---

## 3. The three workstreams

### W1 — Comments · risk: ZERO

Comments do not execute.

- 1–2 lines, first person, simple English
- up to 4 lines only where the *reason* genuinely needs it (not a story)
- delete anything that restates the code
- fix stale comments that state something false
- replace 83 internal references (`BUG-N`, `ADR-011`, `Phase 3`, `STEP-0`,
  `P2-T3`, `STB-008`, `ISSUE-1`, `*_PLAN.md`) with the plain reason
- target: comment lines 22–32% → 12–15%

### W2 — Naming · risk: LOW, mechanically checkable

Three kinds, worst first.

**(a) Names that lie — the name says one thing, the code does another.**

| Where | Name | What it actually holds / does |
|---|---|---|
| `step6:224` | `normalizedIntent` | **`responseMode`, uppercased. Not an intent at all.** |
| `step3:39` | `buildSemanticStudyContext` | Builds one readable "Subject > Section > Chapter" line. Nothing is "semantic" or "hydrated". |
| `step7:218` + `:275` | `_intent` and `intent` | ⚠️ **Two different values.** `_intent` = `decision?.intent`. `intent` = the same `?? 'CONCEPT_QUESTION'`. The underscore hides a real difference. Rename to `rawIntent` / `intent` — **never merge them.** |
| `rag/geminiEmbeddings.js` | the filename | OpenAI `text-embedding-3-large` is primary. Gemini is query-time fallback only. The filename is the most visible wrong name in the repo. |

**(b) Jargon names** — `probeAcademicSimilarity`, `passesFinalFilter`,
`isStrongVectorFallback`, `resolveChainKey`, `_doRetrieve`, `getThreshold`,
and four different `normalize*` functions doing four unrelated jobs
(`normalizeDecision`, `normalizeSections`, `normalizeForComparison`,
`normalizeRetrieverOptions`) plus two `sanitize*`.

**(c) One thing, many names** — see W3 below; `cleanText` and `compactText` are
the same function.

**Rules for W2:**
- one rename at a time, `grep -rn "<oldName>"` before and after
- file-local renames: free
- cross-file renames (the `geminiEmbeddings.js` file name, the shared helpers):
  allowed, but each one gets its own commit and its own grep proof
- never rename something to make two different values look the same

### W3 — Code readability · risk: MEDIUM, needs the golden set

Only **behaviour-preserving** moves. Five are allowed, nothing else.

**(1) Delete copy-paste duplication.** Measured:

- the same one-line whitespace cleaner is **defined 5 times** under 2 names:
  `cleanText` in `step1`, `step7`, `chapterResolver`, `sourceFormatter`, and
  `compactText` in `promptHelpers`
- `extractCacheTokens` **and** `extractTokenBreakdown` are **identical copies**
  in `step4.decideRetrieval.js` and `step6.generateResponse.js`

**(2) Give a repeated literal a name.** `step5` returns this same object
**6 times**:

```js
{ retrieval: null, chunks: [], sources: [], retrievedContext: 'NO_RETRIEVED_CONTEXT', ... }
```

Six copies of one idea. One named helper, `noContent()`, says it once.

**(3) Break unreadable lines.** `askOrchestrator.js:131` is a **280-character
single line** holding a 10-key object. Line 130 is 163 characters.

**(4) Un-clever the clever bits.**
- `step6:226` — `if (['CONVERSATION'].includes(normalizedIntent))` → `if (mode === 'CONVERSATION')`. An array built to check one value.
- nested `??` chains inside object literals (`step7:388-389`) → plain lines.

**(5) Split a function that is too long.** `saveAndRespond` is ~300 lines in one
function, and its signature takes **9 positional parameters**:

```js
export const saveAndRespond = async (
  { question, studyMode, focusChapter },
  { sessionId, chatState, chapterProgress },
  { language, driftSignal },
  decision,
  { retrieval, retrievedContext, sources, nextTopicSignal, lastRetrievalQuery, isOutOfFocusAnswer },
  response, userId = null, tokenUsage = 0, guestId = null
) => {
```

Nobody can hold that in their head. The function already has its own sections
written in comments (`Step 7a`, `Step 7b`, `Step 7c`) — those become real named
functions. This is the single biggest and riskiest item in the plan, so it gets
a batch of its own.

**Still NOT allowed, in any batch:**

- ❌ no logic change — not one `if`, condition, threshold or default
- ❌ no deleting dead code (the legacy `step6` path stays) — separate Stage 2 item
- ❌ no change to the API response shape
- ❌ no frontend
- ❌ no new npm packages
- ❌ no merging `_intent` and `intent`
- ❌ no new file unless it only holds code moved out of another file

---

## 4. Batches — 7 of them

Batch 0 comes first because the shared duplicates touch files that every later
batch also edits. Doing it second would mean editing the same lines twice.

| Batch | What | Files | Workstreams | Gate | Difficulty |
|---|---|---|---|---|---|
| **0** | Shared duplicates | 6 touched | W2 + W3 | golden | Medium |
| **1** | The spine | 4 | W1 + W2 + W3 | golden | Easy |
| **2** | The brain | 3 | W1 + W2 + W3 | golden | Easy |
| **3** | Retrieval + answer | 3 | W1 + W2 + W3 | golden | Medium |
| **4** | `step7` alone | 1 | W1 + W2 + W3 | golden | **Hard** |
| **5** | Edges + file rename | 8 | W1 + W2 | golden | Medium |
| **6** | Auth — optional | 1 | W1 + W2 | offline 4 | Medium |

### Batch 0 — Shared duplicates
New `utils/text.js` holding one `cleanText`; the 5 copies deleted and imported.
New `utils/tokenUsage.js` holding one token-breakdown helper; the `step4` and
`step6` copies deleted and imported. Pure move, no logic.

### Batch 1 — The spine · 575 lines
`ask/askOrchestrator.js` (225) · `step1.validateInput.js` (86) ·
`step2.loadSession.js` (136) · `step3.buildContext.js` (128)
Includes: the 24-line banner header, the 280-char object line,
`buildSemanticStudyContext` rename, step2's 12-line comment on one `if`.

### Batch 2 — The brain · 459 lines
`step4.decideRetrieval.js` (214) · `intentSafetyNet.js` (72) ·
`promptHelpers.js` (173)
Includes: the three false facts in `intentSafetyNet`'s header, `ADR-011` × 7,
the three word-salad JSDoc blocks in `promptHelpers`,
`probeAcademicSimilarity` rename.

### Batch 3 — Retrieval + answer · 1,020 lines
`step5.retrieveContent.js` (315) · `step6.generateResponse.js` (288) ·
`intentRouter.js` (417 — **your live answer path**)
Includes: `noContent()` for the 6 repeats, `normalizedIntent` → `mode`,
the `['CONVERSATION'].includes` fix, step6's wrong "default" comment.

### Batch 4 — `step7.saveAndRespond.js` alone · 491 lines
The 300-line function split into named steps. The 9-param signature becomes one
options object (its 2 call sites in `askOrchestrator` updated).
`_intent` → `rawIntent`. **This batch gets its own session.**

### Batch 5 — Edges + the file rename · 894 lines
`rag/retriever.js`, `rag/retriever.config.js`, `rag/sourceFormatter.js`,
`models/chatSession.model.js`, `models/chapterProgress.model.js`, `app.js`,
`server.js`, `controllers/ask.controller.js`
Plus: `rag/geminiEmbeddings.js` → `rag/embeddings.js`, its own commit, every
importer updated and grep-proved.

### Batch 6 — Auth · 683 lines · optional
`controllers/auth.controller.js`. Biggest single file. Comments + names only,
no structure. Default: after the interview.

---

## 5. The loop — per file, every time

1. **I summarise the file first** — 3–4 lines Hinglish: what it does, what it
   returns, why it exists. Before anything changes.
2. **I show you the planned renames for that file** — old → new, and the grep
   count for each. You approve the list before I type it.
3. **I make the edits**: W1, then W2, then W3.
4. **`node --check <file>`** — syntax.
5. **`git diff`** — you see every line.
6. **You read the cleaned file.** "Samajh aa gaya", or you ask.
7. Next file.

End of batch: `node --check` on every touched file → the 4 offline tests →
**you run `npm run test:golden`** → compare against baseline → commit.

One commit per batch. The `geminiEmbeddings` rename gets its own extra commit.

---

## 6. Risks, honestly

**Risk 1 — W3 can actually break the app.** Unlike v1, this plan changes code.
Splitting a 300-line function can drop a line. This is real.
*Handled by:* golden set before and after every W2/W3 batch, `node --check` per
file, your manual `/ask` before merge, and the hardest file (`step7`) isolated
in its own batch.

**Risk 2 — Losing the "why".** Some long comments carry root causes that took
days. Cutting them to 2 lines deletes the answer to "why is this guard here?"
*Handled by:* the 4-line exception, and you reading every file at step 6.

**Risk 3 — A rename that looks safe but is not.** `_intent` / `intent` in
`step7` is the live example: same-looking names, different values. A tidy-up
there would be a silent behaviour change.
*Handled by:* renames are listed and approved per file (loop step 2), one grep
each, never merging two values.

**Risk 4 — Prod is live.** Render + Vercel. W1 cannot touch it. W2 and W3 can.
Merge only after your manual `/ask` in both Focus and Global mode.

**Risk 5 — Scope creep.** I will find real bugs while reading. One is already
found: `step6`'s legacy path is dead because `USE_INTENT_ROUTER=true`.
**Everything found goes to `BACKLOG.md` and is not fixed now.**

**Risk 6 — Stage gate.** `PROJECT_STATE.md:262` says no Stage 2 work before
every Stage 1 box is ticked. Seven boxes are `[~]` and all seven are owner
deferrals (I1/I4/I5 infra, E1–E4 pilot), not pending engineering.
*Call:* the first commit on this branch closes Stage 1 formally with those seven
recorded as accepted deferrals.

---

## 7. Time — the honest version

v1 said 3–4 sessions. That was for comments only.

With naming and code structure in, and you reading every file, and a golden run
per batch:

**5–7 sessions.**

Refactor + interview PDF on the same day is **not realistic for all 7 batches.**

The cut that works:

> **Batches 0 → 4 = the complete `/ask` pipeline, readable.**
> That is the walkthrough an interviewer will ask for, start to finish,
> including the database write.
> Build the PDF after Batch 4. Batches 5 and 6 after the interview.

Batch 5 is edges. Batch 6 is auth. Neither is on the critical path.

---

## 8. What "done" means (Batches 0–4)

- every file read by you
- internal references in those files: **0**
- comment lines: **12–15%**, down from 22–32%
- no comment left that states something false
- no name left that holds something other than what it says
- the 5 duplicate `cleanText` copies: **1**
- the 2 duplicate token helpers: **1**
- `saveAndRespond`: one options object, sections as named functions
- 4 offline tests green
- `npm run test:golden` matches baseline
- your manual `/ask` works in Focus and Global mode
- merged only when you say so
