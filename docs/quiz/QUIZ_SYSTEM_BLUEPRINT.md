# Quiz System — Complete Product & Engineering Blueprint

> **Project:** Bihar Board Class 10 AI Tutor ("Zuno")
> **Status:** Draft v3 — audited against the live codebase 2026-08-02, re-audited against the real
> question bank 2026-08-09, not yet locked for execution
>
> **Audit note (2026-08-02):** every claim in this file was checked against the actual code.
> Corrections are inline and marked **[AUDIT]**. The most important one: the chapter-completion
> hook this whole quiz gate hangs off (§7) is **dead code in the current build** — see
> **Phase 0** in §17, which must ship before Phase 3 or the gate silently never fires.
>
> **Audit note (2026-08-09):** a separate branch (`quiz-phase0.5-bulk`) finished extracting a real
> 744-question bank from 2016-2026 Bihar Board papers, covering all 16 chapters — this happened
> *after* the 2026-08-02 audit and makes several Phase 1 assumptions (§3, §5, §12, §16, §17) stale.
> Corrections marked **[AUDIT 2026-08-09]**, full story in the new **§19**. Read §19 first if you
> only have time for one section — it explains why every other change exists.

---

## Table of Contents
1. [Core Product Vision & Multi-Subject Rule](#1-core-product-vision--multi-subject-rule)
2. [The 2 Main Quiz Systems](#2-the-2-main-quiz-systems)
3. [Question Bank Strategy](#3-question-bank-strategy)
4. [Question Variation Engine — 3-Layer System](#4-question-variation-engine--3-layer-system)
5. [Database & State Design](#5-database--state-design)
6. [Anti-Cheat & Security Contract](#6-anti-cheat--security-contract)
7. [State Machine: Chapter Completion + Quiz Gate](#7-state-machine-chapter-completion--quiz-gate)
8. [User Flow, UX & Exam Rules](#8-user-flow-ux--exam-rules)
9. [Guest Data & Claim Path](#9-guest-data--claim-path)
10. [Code & Architecture Blueprint](#10-code--architecture-blueprint)
11. [API Contract — Request/Response Specs](#11-api-contract--requestresponse-specs)
12. [JSON Seed File Format](#12-json-seed-file-format)
13. [Testing Plan](#13-testing-plan)
14. [Caching & Rate Limiting](#14-caching--rate-limiting)
15. [Migration Plan for Existing Users](#15-migration-plan-for-existing-users)
16. [Open Product Decisions (Confirm Before Phase 1)](#16-open-product-decisions-confirm-before-phase-1)
17. [Phased Execution Roadmap](#17-phased-execution-roadmap)
18. [Audit Changelog (2026-08-02)](#18-audit-changelog-2026-08-02)
19. [Audit Changelog (2026-08-09) — Real question bank supersedes the hand-curation plan](#19-audit-changelog-2026-08-09--real-question-bank-supersedes-the-hand-curation-plan)

---

## 1. Core Product Vision & Multi-Subject Rule

Bihar Board Class 10 examination has a **50% Objective (MCQ) weightage** across EVERY subject:
* **Science:** 40 Theory + 40 Objective + 20 Practical = 100 Marks
* **Social Science:** 40 Theory + 40 Objective + 20 Practical = 100 Marks
* **Mathematics:** 50 Theory + 50 Objective = 100 Marks
* **Hindi / English / Sanskrit:** 50 Theory + 50 Objective = 100 Marks

### Subject-Agnostic Architecture Rule

The Quiz Engine MUST be **subject-agnostic** from Day 1. No subject names (like `science` or `physics`) hardcoded in quiz models, routes, or algorithms. Every component consumes dynamic parameters (`subjectId`, `sectionId`, `chapterId`). When a new subject is added in the future, only seeding new questions activates quizzes for it — zero code changes.

**ID format alignment** — Quiz IDs must follow the existing curriculum-index pattern:
- `subjectId`: `"science"` (matches `curriculum-index.json`)
- `sectionId`: `"physics"` (matches `curriculum-index.json`)
- `chapterId`: `"science.physics.chapter-01"` (matches `curriculum-index.json`)
- `topicId`: `"science.physics.chapter-01.topic-03"` (matches `curriculum-index.json`)

**[AUDIT] Verified correct** — these exact ID strings were checked against
`backend/storage/curriculum-index.json`. No change needed.

### [AUDIT] Non-quizzable chapters must be excluded everywhere

`curriculum-index.json` contains **17 chapters, not 16**. The extra one is
`science.meta.chapter-00` — the orientation/overview content added by TASK-025
(`data/class-10/science/meta/science-overview.md`). It is real curriculum-index data but is
**not a quizzable chapter**.

The existing precedent is `backend/src/services/studyMap.service.js`, which filters it out via:

```js
const NON_BROWSABLE_SECTIONS = ['Meta'];
```

`curriculum-index.json` itself does **not** apply this filter. So any quiz code that iterates
"all chapters for a subject" straight from the index will pick up the meta chapter.

**Rule:** the quiz engine must apply the same exclusion in **both** places it touches chapters:
1. Mix Quiz chapter enumeration (§2)
2. Seed-file chapter validation (§12)

Reuse the section-based exclusion rather than hardcoding the chapter ID, so a future
non-browsable section is handled automatically.

---

## 2. The 2 Main Quiz Systems

### System A: Chapter Gate Quiz (Focus Mode Completion Lock)

**Problem:** Currently, Zuno marks a chapter as `completed` as soon as all topics are advanced via `NEXT_STEP`. Topic advancement does not guarantee student mastery.

**Solution:** The Chapter Gate Quiz acts as an academic gatekeeper.

* When a student finishes all topics of a chapter in Focus Mode, `status` changes to `awaiting_quiz` (not `completed`).
* Zuno prompts: *"Bahot badhiya! Tumne saare topics padh liye. Ab is chapter ka 10-question ka Test do!"*
* Student must achieve >= 70% (7/10 correct) to pass.
* **On Pass (>= 70%):** `status` -> `'completed'`.
* **On Fail (< 70%):** `status` stays `'awaiting_quiz'`, displays weak topics, allows unlimited retries with zero penalty.

### System B: Standalone Practice Quiz Hub

Objective practice is the #1 student demand for Bihar Board preparation. Practice Hub gives students freedom to practice anytime.

* Accessible directly from the Sidebar / Navigation.
* **Chapter-Wise Quiz:** Pick any subject -> Pick any chapter -> 10 MCQs.
* **Mix Quiz (Mock Exam):** Pick any subject -> 20 MCQs balanced across chapters.

**Mix Quiz Balancing Algorithm:**
```
1. Get all chapters for the subject (from curriculum-index.json),
   EXCLUDING non-browsable sections (see §1) — 16 quizzable Science chapters, not 17
2. Keep only chapters that actually have seeded questions  ← [AUDIT] see note below
3. Compute per-chapter allocation: perChapter = Math.ceil(20 / numChapters)
   Example: Science fully seeded = 16 chapters → perChapter = ceil(20/16) = 2
   → 16 × 2 = 32 candidates, we take 20 (random subset)
4. For each chapter:
   a. Fetch all active questions (via the Redis-cached reader, §14)
   b. Partition into PYQ pool (yearAsked.length > 0) and non-PYQ pool
   c. Try to fill 60% from PYQ pool, 40% from non-PYQ pool
      (if PYQ pool has less, take all + fill rest from non-PYQ)
   d. Apply Layer 2 (seen-question deprioritization)
   e. Return perChapter questions
5. Randomize final order across all chapters (Fisher-Yates)
6. Take first 20 — or fewer if the bank cannot supply 20 (see below)
```
This is a fixed algorithm — no weighting configuration. If BSEB releases official chapter weightage in future, add it as a `chapterWeights` map in code.

#### [AUDIT] Mix Quiz must degrade gracefully — it cannot serve 20 in Phase 1

Phase 1 seeds only **3 pilot chapters** (§16 decision #10). With `perChapter = 2`, that yields
**6 questions, not 20**. The original draft assumed a fully-seeded subject and had no behaviour
defined for a partially-seeded one — so Phase 5's manual verification step ("Take Mix Quiz →
20 MCQs") was unachievable as written.

**Required behaviour when the bank cannot supply the requested count:**

- Serve however many questions genuinely exist (never pad, never repeat within one quiz).
- `totalQuestions` in the response is the **actual** served count — the client must render from
  that, never from a hardcoded 20.
- If the served count is below the requested count, include a flag in the generate response so
  the UI can be honest with the student:
  ```json
  { "totalQuestions": 6, "requestedCount": 20, "partialBank": true }
  ```
  UI copy: *"Abhi is subject ke liye 6 hi questions ready hain. Aur jald aa rahe hain!"*
- If **zero** questions exist for the whole subject, return `409` with a clear message rather
  than an empty quiz.

This is distinct from the "student exhausted the pool" case in §8 — that one is about a student
having *seen* everything; this one is about the bank not being *authored* yet.

---

## 3. Question Bank Strategy

### Design Decisions

**Q: Should MCQs use Embeddings / RAG Vector Store?**
No. Vector search is probabilistic and designed for unstructured text retrieval. Quizzes require exact structured filtering (indexed DB queries by `chapterId`/`topicId`). Standard MongoDB compound index queries return in 2-5ms.

**Q: Should MCQs be inside chapter markdown files?**
No. Placing MCQs inside study markdown files corrupts RAG chunking and makes content updates error-prone. Questions belong in dedicated JSON seed files and a MongoDB collection.

**Q: After seeding MongoDB, can we delete the JSON files?**
No. The JSON files are the developer source-of-truth stored in Git. If the database is ever wiped or migrated, `npm run quiz:seed` restores the complete question bank.

### [AUDIT 2026-08-09] The 2-source plan below is superseded — read this first

Everything in this section (the "50 curated + PYQ" plan) was written on 2026-08-02, before any
real question extraction existed. Between 2026-08-03 and 2026-08-09, a **separate data pipeline**
(`QUIZ_DATA_PIPELINE.md`, branch `quiz-phase0.5-bulk`) OCR'd all 26 Bihar Board Science papers
from 2016-2026, tagged every question to a chapter, and hand-verified answers. That work is
**done** — it produced a real bank, not a plan for one. Full detail in the new **§19 Audit
Changelog (2026-08-09)**. The numbers below are historical context for why a 2-source design was
originally proposed; they are not the current plan.

### The 2-Source Static Bank (original design intent — see §19 for what actually shipped)

```
Quiz Request (10-20 Questions)
       |
       v
 MongoDB `question_bank` Query
 (compound index: subjectId + chapterId + isActive)
       |
       ├── Source 1: 10-Year BSEB PYQs
       |   Tagged: "yearAsked": [2022, 2024]
       |
       └── Source 2: Curated Chapter MCQs
           Extra topic coverage (minimum 50 per chapter)
       |
       v
 Option-order shuffle (randomize A/B/C/D positions)
 + Question-order shuffle (randomize question sequence)
       |
       v
 Serve to Student (strip correctAnswer before sending)
```

1. **Source 1 (Primary):** 10-Year Official Bihar Board Previous Year Questions (PYQs) tagged with `yearAsked` and `boardRelevance: "HIGH"`. Seeing *"Bihar Board 2023 Mein Pucha Gaya"* boosts student motivation.
2. **Source 2 (Chapter Coverage):** Extra curated MCQs per chapter ensuring at least **50 questions per chapter** (not 20-30 — larger bank reduces repetition, see Section 4).

**What actually happened:** Source 1 alone produced 744 usable MCQs (all real PYQs, 2016-2026),
covering all 16 chapters. Source 2 ("curated MCQs" written by hand) was **never built and is no
longer planned** — the real PYQ volume made a synthetic-question source unnecessary for the
initial launch. See §19 for exact per-chapter counts, including which chapters fall short of the
50-per-chapter target and what that means.

### Seed Data Volume Plan — [AUDIT 2026-08-09] superseded, see §19

~~Phase 1 target: 50 questions minimum per chapter for Science.~~ This was the pre-extraction
target. Actual Phase 1 seed volume is **744 real PYQ questions across all 16 chapters**
(16 to 103 per chapter — uneven, because it reflects how often each chapter was actually examined
2016-2026, not a hand-picked quota). Format is JSON files in `data/quiz-bank/science/<section>/`,
one file per chapter — that part of the original plan is unchanged, only the *content and origin*
of those files changed. Full schema and example in the updated §12.

---

## 4. Question Variation Engine — 3-Layer System

The core challenge: a static question bank eventually gets exhausted. A student who attempts a chapter quiz 5+ times will start recognizing questions and the quiz becomes a memory test, not a knowledge test.

### Layer 1: Option Shuffling (Always Active, Zero Risk)

Every time a question is served, the A/B/C/D option order is randomized. The correct answer's NEW position (post-shuffle) is stored server-side in a `quiz_sessions` document — the client never sees it.

**Critical: Scoring must use the shuffled position, not the DB's original `correctAnswer`.**

Without this, scoring breaks silently: server shuffles → client sees the correct answer at position "D" → student picks "D" → server compares against DB's original `correctAnswer: "B"` → student marked wrong even though they were right. This is a real bug; the shuffle map MUST be persisted.

**Correct flow:**
```javascript
// At generateQuiz time (server-side):
function shuffleOptions(question) {
  const shuffled = fisherYatesShuffle([...question.options]);
  const correctText = question.options.find(o => o.key === question.correctAnswer).text;
  // The key that now points to the correct option AFTER shuffle
  const shuffledCorrectKey = shuffled.find(o => o.text === correctText).key;
  return {
    optionsToSendClient: shuffled,   // client sees these
    shuffledCorrectKey,              // stored in quiz_sessions, NEVER sent to client
  };
}

// Server persists per-question shuffle result in quiz_sessions.servedQuestions[]:
// {
//   questionId: <ObjectId>,
//   questionVersion: 1,
//   shuffledCorrectKey: "D",   // authoritative for scoring this attempt
//   topicIdSnapshot: "science.physics.chapter-01.topic-03",
// }

// At submitQuiz time (server-side):
// Compare student's selectedAnswer against session.servedQuestions[i].shuffledCorrectKey,
// NEVER against Question.correctAnswer directly.
```

**Risk:** Zero. Correct answer text never changes, only its position — and the position is remembered server-side.
**Variation gained:** Same 50 questions feel different every attempt because the "B" the student memorized is now at "D".

### Layer 2: Seen-Question Deprioritization (Always Active, Zero Risk)

Track which `questionId`s a student has already answered correctly. On subsequent attempts, prioritize unseen/incorrectly-answered questions first, then backfill with seen questions (with shuffled options).

**Works for both logged-in users and guests.** The identity filter uses `userId` when present, else `guestId` — same pattern as `chapterProgress.service.js` (`buildFilter` helper).

#### [AUDIT] The seen-set must NOT be filtered by chapterId

The original draft filtered past attempts with `{ ...identityFilter, chapterId }`. That is a
real bug: **`mix_practice` attempts store `chapterId: null`** and put the chapters in the
separate `chapterIds` array (see §5). So a `chapterId`-filtered query silently misses every
question the student already answered inside a Mix Quiz — and vice versa, a Mix Quiz would
never know what the student answered in chapter quizzes.

Result: a student could finish a Mix Quiz and then immediately get the exact same questions
again in a chapter quiz, marked as "unseen".

**Fix: scope the seen-set by identity only, and match on `questionId`.** The questionIds
themselves already carry the chapter (a question belongs to exactly one chapter), so the
chapter filter adds nothing except the bug. The `$elemMatch` guard stays — it is correct and
necessary.

```javascript
// quiz.service.js — question selection logic
async function selectQuestions(chapterId, userId, guestId, count) {
  // 1. Get all active questions for this chapter.
  //    Goes through the Redis-cached reader (§14), NOT a raw Question.find() —
  //    [AUDIT] the original draft defined that cache but never put it on this path.
  const allQuestions = await getChapterQuestions(chapterId);

  // 2. Identity filter — same buildFilter pattern used across the codebase.
  //    NOTE: userId is a STRING here, not an ObjectId — see §5 identity-type note.
  const identityFilter = userId ? { userId } : { guestId };

  // 3. Get questionIds this student answered correctly before — across ALL quiz types.
  //    No chapterId filter: mix_practice attempts have chapterId: null and would be
  //    missed entirely. $elemMatch ensures the same subdoc satisfies both conditions.
  const pastAttempts = await QuizAttempt.find(
    {
      ...identityFilter,
      answers: { $elemMatch: { isCorrect: true } },
    },
    { 'answers.questionId': 1, 'answers.isCorrect': 1 }
  ).lean();

  const seenCorrectSet = new Set();
  for (const attempt of pastAttempts) {
    for (const ans of attempt.answers) {
      if (ans.isCorrect) seenCorrectSet.add(String(ans.questionId));
    }
  }

  // 4. Partition: unseen/wrong first, then seen-correct
  const unseen = allQuestions.filter(q => !seenCorrectSet.has(String(q._id)));
  const seen   = allQuestions.filter(q =>  seenCorrectSet.has(String(q._id)));

  // 5. Fill from unseen first, then seen (both shuffled)
  const pool = [...fisherYatesShuffle(unseen), ...fisherYatesShuffle(seen)];
  return pool.slice(0, count);
}
```

**Index note:** because the seen-set query no longer filters by `chapterId`, the useful index
is `{ userId: 1 }` / `{ guestId: 1 }` (both already specified in §5), not the compound
`{ userId, chapterId }`. Keep the compound ones for history views; they are not what this
query uses.

**Scale note:** this loads every past attempt for the student. At the realistic ceiling for one
student (a few hundred attempts) that is fine. If it ever becomes hot, the fix is a cached
per-student `seenQuestionIds` set invalidated on submit — not a chapter filter.

**Risk:** Zero. Only changes selection priority, not question content.
**Variation gained:** Student sees questions they got wrong or haven't seen before first.

### Layer 3: AI-Assisted Question Generation (Phase 6+, Review Queue)

This is the long-term variation solution. Important: **AI-generated questions are NEVER served directly to students.** They go through a review queue first.

#### Why direct AI generation is dangerous

The core Zuno rule: "Never answer from general LLM knowledge." This applies even more strictly to MCQs because:

1. **No escape hatch** — A tutor answer can say "I don't know." An MCQ has exactly one correct answer. If the LLM picks the wrong one, the student either un-learns correct knowledge or learns incorrect facts.
2. **Science precision** — LLM can generate "prakash ka veg 3 × 10⁸ km/s hai" instead of "3 × 10⁸ m/s". Both appear in chapter text, the unit gets confused in context window. Student marks correct answer, system says wrong.
3. **Distractor quality** — Wrong options might be accidentally correct, or so obviously wrong that the question has no learning value.

#### The Review Queue Architecture

```
Developer triggers: npm run quiz:generate --chapter=science.physics.chapter-01

    |
    v
LLM reads chapter markdown content (same RAG source files)
    |
    v
Generates 10-20 candidate MCQs with:
  - questionText (Hinglish)
  - 4 options
  - correctAnswer
  - explanation
  - topicId (mapped to curriculum-index)
    |
    v
Saved to `question_review_queue` collection with status: "pending"
    |
    v
Developer reviews in a simple CLI tool or admin script:
  npm run quiz:review
  - Shows question + options + marked answer
  - Developer verifies: [approve] [reject] [edit]
    |
    v
Approved questions get status: "approved" → copied to `question_bank`
Rejected questions get status: "rejected" → logged for LLM prompt improvement
```

#### Why this is safe

- **Human verifies every answer** before it reaches any student.
- **Batch process** — not real-time. Developer runs it weekly/monthly when bank needs expansion.
- **LLM is only a drafting tool** — it saves the developer from writing questions from scratch but never makes the final correctness decision.
- **Grounded in chapter content** — LLM prompt includes the actual chapter markdown, limiting hallucination surface (but not eliminating it, hence human review).

#### Generation prompt guardrails

```
System: You are creating MCQs for Bihar Board Class 10 students.
Rules:
- Use ONLY the chapter content provided below. Do NOT use any external knowledge.
- Every correct answer MUST be directly verifiable from the provided text.
- All 3 wrong options must be plausible but clearly wrong per the text.
- Write in simple Hinglish (Roman script).
- Tag each question with the topicId it tests.
- Include a 1-line explanation citing the exact line from the chapter.

Chapter content:
{chapter_markdown_content}
```

#### When to activate Layer 3

NOT in Phase 1-5. Only consider when:
- Analytics show students are exhausting question banks (>5 attempts per chapter)
- Static bank per chapter < 30 remaining unseen questions for active users
- Developer has bandwidth for weekly review cycles

**Phase 1-5 rely entirely on Layer 1 + Layer 2.** With 50 questions per chapter + option shuffling + seen-question deprioritization, this gives a student approximately **8-10 meaningfully different quiz experiences** per chapter before significant repetition.

---

## 5. Database & State Design

### [AUDIT] Identity field type — use `String`, not `ObjectId`

The original draft said *"`userId` type note: uses `ObjectId` to match existing codebase
pattern"*. **That is factually wrong.** Checked against the live code:

| Where | Declared type |
|---|---|
| `backend/src/models/chapterProgress.model.js:19` | `userId: { type: String, default: null, index: true }` |
| `backend/src/models/studyEvent.model.js:5` | `userId: { type: String, default: null, index: true }` |
| `backend/src/controllers/chapterProgress.controller.js:21` | `userId: req.user?.id` → a **string** (Mongoose `.id` virtual) |
| `backend/src/controllers/ask.controller.js:18` | `const userId = req.user?.id \|\| null` → same |

**Decision: quiz collections use `{ type: String, default: null }` for `userId`**, matching
every other collection. Mongoose would happily cast a 24-hex string into an `ObjectId` field,
so an `ObjectId` schema would appear to work — which is exactly why this would have gone
unnoticed until something did a cross-collection lookup or a raw aggregation and silently
matched nothing.

**Related pre-existing bug — do not copy this pattern.** `chapterProgress.model.js` declares
`userId` as a `String` but its unique index uses:

```js
partialFilterExpression: { userId: { $type: 'objectId' } }
```

A `String`-typed field never satisfies `$type: 'objectId'`, so `user_chapter_unique` covers
**zero documents** and enforces nothing today. The *guest* index on the same model uses
`$type: 'string'`, which is correct and does work. When writing the quiz indexes, use
`$type: 'string'` for both `userId` and `guestId` partial filters. (Fixing the
`chapterProgress` index is out of scope for the quiz work — logged here so it isn't cargo-culted.)

### Collection 1: `question_bank`

**[AUDIT 2026-08-09] Schema changed from single-language strings to 3-language objects.** The
original draft below assumed `questionText`/`options[].text`/`explanation` were plain strings.
That was correct only because no real question data existed yet. The bulk-extraction pipeline
(`quiz-phase0.5-bulk`) produces every question in **three languages simultaneously** — English,
Hindi (Devanagari), and Hinglish — because a future language-toggle in the UI is a known
requirement (see `CLAUDE.md` target-user section: students may read Hindi or English, even though
Zuno currently *answers* only in Hinglish). Migrating a single-language schema to 3-language later
would mean re-touching all 744+ documents; doing it now costs nothing extra, since the source
data already has all three. Full reasoning and worked example in §19.

```javascript
const localizedTextSchema = {
  en:       { type: String, default: null },
  hi:       { type: String, default: null },
  hinglish: { type: String, default: null },
};
// _id: false — this is always embedded, never queried or referenced directly

const questionSchema = new mongoose.Schema({
  seedKey:        { type: String, required: true, unique: true },  // human-readable, used by seed script + re-seed matching
  subjectId:      { type: String, required: true, index: true },
  sectionId:      { type: String, default: null },
  chapterId:      { type: String, required: true, index: true },
  topicId:        { type: String, default: null, index: true },   // [AUDIT] not yet populated in real data — see §19 gap list

  questionText:   { type: localizedTextSchema, required: true },  // { en, hi, hinglish } — at least one must be non-null (app-level check, not schema-level)
  options: [{
    key:          { type: String, required: true },   // 'A', 'B', 'C', 'D'
    text:         { type: localizedTextSchema, required: true }
  }],
  correctAnswer:  { type: String, required: true },   // 'B' — one of the option keys
  explanation:    { type: localizedTextSchema, default: () => ({}) },  // [AUDIT] optional, not required — see §19, 0/744 real questions have one yet

  difficulty:     { type: String, enum: ['easy', 'medium', 'hard'], default: null },  // [AUDIT] nullable now — 0/744 real questions are tagged yet
  yearAsked:      { type: [Number], default: [] },    // [2021, 2023] — PYQ tagging
  isActive:       { type: Boolean, default: true },
  version:        { type: Number, default: 1 },       // Increment on content fix
}, { timestamps: true, collection: 'question_bank' });

// Primary query index — all quiz generation queries use this
questionSchema.index({ subjectId: 1, chapterId: 1, isActive: 1 });
// Topic-level queries for weak-topic analysis + Layer 2 dedup
questionSchema.index({ chapterId: 1, topicId: 1 });
```

**Changes from original draft:**
- `questionId` (custom string ID) removed — Mongoose `_id` (ObjectId) is already unique + indexed.
- `seedKey` **does need `unique: true`** — [AUDIT] the original draft contradicted itself here,
  declaring `unique: true` in the schema above but then saying "no unique index needed, just a
  plain field" in both this list and §12. The schema is the correct one: the seed script upserts
  **by** `seedKey` (§12 step 3), so without a unique index two runs can race and insert
  duplicates of the same question. Keep `unique: true`. **[AUDIT 2026-08-09]** a future
  question-management API (see §11's new "Future: Question Management API" note) may insert
  single questions without a hand-picked `seedKey` — in that case the controller generates one
  (e.g. `` `api-${chapterId}-${Date.now()}` ``) so the field is always populated; it is never
  optional at the schema level.
- `topicId` added — required for weak-topic analysis (Section 8). Maps to `curriculum-index.json` topic IDs. **[AUDIT 2026-08-09]** stays `default: null` — real data has no topic mapping yet (§19). Weak-topic analysis (§8) will only be as granular as the data allows until this is backfilled.
- **[AUDIT 2026-08-09]** `questionText`, `options[].text`, `explanation` changed from `String` to `localizedTextSchema` ( `{ en, hi, hinglish }` ) — see rationale above and §19.
- **[AUDIT 2026-08-09]** `explanation` changed from `required: true` back to **optional** (`default: () => ({})`, all three sub-fields nullable). The original draft's reasoning — "this is a learning tool, every question must explain why" — is still the *goal*, but 0 of the 744 real seed questions have one today. Making it required would block seeding entirely. The quiz UI must handle a question with no explanation (skip that part of the results screen) rather than assume it always exists.
- **[AUDIT 2026-08-09]** `difficulty` changed from `default: 'medium'` to `default: null` — 0 of the 744 real questions are difficulty-tagged. A fake default of `'medium'` on every question would be misleading data, not a real value.
- `boardRelevance` removed — derivable from `yearAsked.length > 0`. No need for a subjective enum.
- `version` added — for question correction tracking.

### Collection 2: `quiz_sessions` (the missing piece — required for correct scoring)

A short-lived server-side record of which questions were served to which student, with the shuffled correct-answer key per question. Without this, option shuffling (Layer 1) silently breaks scoring — server has no memory of the shuffle it did at generate time.

```javascript
const quizSessionSchema = new mongoose.Schema({
  // [AUDIT] String, not ObjectId — matches chapterProgress/studyEvent. See identity note above.
  userId:      { type: String, default: null, index: true },
  guestId:     { type: String, default: null },

  quizType:    { type: String, enum: ['chapter_gate', 'chapter_practice', 'mix_practice'], required: true },
  subjectId:   { type: String, required: true },
  chapterId:   { type: String, default: null },
  chapterIds:  { type: [String], default: [] },

  servedQuestions: [{
    questionId:         { type: mongoose.Schema.Types.ObjectId, required: true },
    questionVersion:    { type: Number, required: true },      // snapshot of question.version at serve time
    shuffledOptions:    [{ key: String, text: String }],       // exact options sent to client (post-shuffle)
    shuffledCorrectKey: { type: String, required: true },      // authoritative key for scoring THIS session
    topicIdSnapshot:    { type: String, default: null },       // frozen topicId at serve time (for weak-topic report)
  }],

  status: {
    type: String,
    enum: ['pending', 'submitted', 'expired'],
    default: 'pending',
  },
  submittedAttemptId: { type: mongoose.Schema.Types.ObjectId, default: null }, // set after submit
  expiresAt: { type: Date, required: true },   // Now + 30 min — TTL index deletes stale sessions
}, { timestamps: true, collection: 'quiz_sessions' });

// TTL: MongoDB auto-deletes expired sessions
quizSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

The `quizId` returned by `generateQuiz` is this document's `_id`. On submit, the client sends `{ quizId, answers }`; server loads the session, matches student answers against `shuffledCorrectKey` per question, and marks the session `submitted` so it cannot be replayed.

### Collection 3: `quiz_attempts`

```javascript
const quizAttemptSchema = new mongoose.Schema({
  // [AUDIT] String, not ObjectId — matches chapterProgress/studyEvent. See identity note above.
  userId:         { type: String, default: null, index: true },
  guestId:        { type: String, default: null },

  quizSessionId:   { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, // FK to quiz_sessions
  idempotencyKey:  { type: String, required: true, unique: true },                        // client-generated UUID
  quizType:       { type: String, enum: ['chapter_gate', 'chapter_practice', 'mix_practice'], required: true },
  subjectId:      { type: String, required: true, index: true },
  chapterId:      { type: String, default: null },        // For chapter_gate and chapter_practice
  chapterIds:     { type: [String], default: [] },         // For mix_practice

  totalQuestions:  { type: Number, required: true },
  score:          { type: Number, required: true },
  percentage:     { type: Number, required: true },

  answers: [{
    questionId:        { type: mongoose.Schema.Types.ObjectId, required: true },
    questionVersion:   { type: Number, default: 1 },       // Snapshot of question.version at attempt time
    topicIdSnapshot:   { type: String, default: null },    // Snapshot of question.topicId at attempt time
    selectedAnswer:    { type: String, default: null },     // null = skipped/unanswered
    shuffledCorrectKey:{ type: String, required: true },   // the key that was correct FOR THIS ATTEMPT (post-shuffle)
    isCorrect:         { type: Boolean, required: true },
    timeSpentMs:       { type: Number, default: 0 },        // Per-question timing
  }],

  timeTakenSec:   { type: Number, default: 0 },          // Total quiz duration
}, { timestamps: true, collection: 'quiz_attempts' });

// History views (Quiz Hub attempt list), newest first
quizAttemptSchema.index({ userId: 1, quizType: 1, createdAt: -1 });

// [AUDIT] Layer 2 (seen-question deprioritization) queries by IDENTITY ONLY — no chapterId
// (see §4: mix_practice attempts have chapterId: null and a compound index would not serve
// them). userId already has index: true on the field. This is the guest equivalent.
quizAttemptSchema.index(
  { guestId: 1 },
  { partialFilterExpression: { guestId: { $type: 'string' } } }
);

// [AUDIT] The original draft also declared { guestId: 1, chapterId: 1 } "for Layer 2".
// Removed: Layer 2 no longer filters by chapterId, and { guestId: 1 } is a prefix of it —
// keeping both would mean paying for two indexes where no query uses the wider one.
```

**Notes:**
- `idempotencyKey` has a unique index — a duplicate submit reuses the existing attempt (see Section 6). **It must always be looked up together with the identity filter** — see the security note in §6.
- `topicIdSnapshot` per answer — required for weak-topic analysis (Section 8) even if a question is later re-tagged.
- `shuffledCorrectKey` per answer — makes the attempt self-contained; history views don't need to join `quiz_sessions` (which will have been TTL-deleted).

### Existing Collection Changes: `chapter_progress`

```javascript
// ADD to chapterProgressSchema status enum:
status: {
  type: String,
  enum: ['not_started', 'in_progress', 'awaiting_quiz', 'completed', 'revising'],
  //                                    ^^^^^^^^^^^^^^ NEW
  default: 'in_progress',
},

// ADD new fields:
quizGateBestScore:   { type: Number, default: null },  // Best percentage achieved
quizGateAttempts:    { type: Number, default: 0 },     // Total attempts
lastQuizAttemptId:   { type: mongoose.Schema.Types.ObjectId, default: null },
```

**Key decision: single `status` field, no separate `quizGateStatus`.**

The original draft had two overlapping state fields (`status` + `quizGateStatus`). This creates ambiguous states (what does `status: 'completed'` + `quizGateStatus: 'failed'` mean?). Instead, we extend the existing `status` enum with `'awaiting_quiz'` — one field, one source of truth.

**Impact on existing code that reads `status`:**
- `listUserChapterProgress` (FocusModal "Continue" list) — `awaiting_quiz` chapters should appear alongside `in_progress` in the "Continue" section (not treated as "Completed"). Frontend chip: 📝 Quiz Pending.
- `progressPercent` — remains at 100% when status is `awaiting_quiz` (all topics done). Only `completed` state triggers the "chapter complete" confetti.
- `resetChapterProgress` — if called on an `awaiting_quiz` chapter, resets to `in_progress` (existing behavior).

**[AUDIT] One more reader the original draft missed —
`backend/src/controllers/chapterProgress.controller.js:186-190`:**

```js
const summary = {
  inProgressCount: allDocs.filter((d) => d.status === 'in_progress').length,
  completedCount:  allDocs.filter((d) => d.status === 'completed').length,
  notStartedCount: Math.max(0, 16 - allDocs.length), // 16 total chapters
};
```

Adding `awaiting_quiz` makes these counts wrong: a chapter sitting in `awaiting_quiz` falls out
of `inProgressCount` **and** out of `completedCount` — it vanishes from the summary entirely
while still consuming a slot in `allDocs.length`, so `notStartedCount` under-reports too.

Required change in Phase 3: count `awaiting_quiz` alongside `in_progress` (the student's work
on it is not finished), or add an explicit `awaitingQuizCount`. Decide once and make the
frontend match.

Also note the hardcoded `16` in `notStartedCount` — it is correct today only because the meta
chapter is excluded from the browsable set (§1). Leave it alone, but do not copy the hardcoded
number into quiz code; derive chapter counts from the filtered curriculum index instead.

---

## 6. Anti-Cheat & Security Contract

### Rule: `correctAnswer` never leaves the server before submission

This is a critical security requirement. Without it, any student can open browser DevTools, inspect the API response, and see all correct answers before answering.

**`generateQuiz` API response (what the client receives):**
```json
{
  "quizId": "temp-session-id",
  "questions": [
    {
      "_id": "...",
      "questionText": "Prakash ka veg kitna hota hai?",
      "options": [
        { "key": "A", "text": "3 × 10⁸ km/s" },
        { "key": "B", "text": "3 × 10⁸ m/s" },
        { "key": "C", "text": "3 × 10⁶ m/s" },
        { "key": "D", "text": "3 × 10¹⁰ m/s" }
      ]
    }
  ]
}
```
No `correctAnswer`. No `explanation`. These are served ONLY in the `submitQuiz` response.

**`submitQuiz` API response (after student submits all answers):**
```json
{
  "score": 7,
  "percentage": 70,
  "passed": true,
  "results": [
    {
      "questionId": "...",
      "selectedAnswer": "A",
      "correctAnswer": "B",
      "isCorrect": false,
      "explanation": "Prakash ka veg 3 × 10⁸ m/s hota hai, km/s nahi."
    }
  ]
}
```

### Server-Side Scoring Only

The client sends: `{ quizId, idempotencyKey, answers: [{ questionId, selectedAnswer }] }`
The server:
1. Loads the **`quiz_sessions` document** by `quizId` (scoped to this student's identity)
2. Compares each `selectedAnswer` with that session's `servedQuestions[i].shuffledCorrectKey`
3. Computes score, percentage, pass/fail
4. Saves the attempt
5. Returns results with explanations (explanations are read from `question_bank` at this point — they are needed only now, never at generate time)

The client NEVER computes scores. The client NEVER receives correct answers before submission.

> **[AUDIT] Corrected.** The original draft said step 1–2 were *"load the original questions by
> `questionId`"* and *"compare `selectedAnswer` with `correctAnswer`"*. That is the **pre-shuffle**
> design and it directly contradicts §4 Layer 1, the `submitQuiz` code below, and Phase 2's own
> non-negotiable acceptance criteria. Scoring against `question.correctAnswer` after the options
> were shuffled marks correct answers wrong — the exact bug §4 was written to prevent. The
> authoritative rule is: **score only against `quiz_sessions.servedQuestions[i].shuffledCorrectKey`.**

### Idempotency

A quiz submission must be idempotent — network retry or double-click must not create duplicate attempts or double-increment `quizGateAttempts`.

**Two layers of protection:**

1. **quiz_sessions.status** — a session already marked `submitted` cannot be re-submitted. Second attempt gets a 409 with the original attempt's result.
2. **quizAttempt.idempotencyKey** — client generates a UUID per submit action; unique index in the schema means a duplicate insert throws E11000 which we catch and reply with the original attempt.

> **[AUDIT] Security fix — the idempotency fast path must be identity-scoped.**
> The original draft looked up `QuizAttempt.findOne({ idempotencyKey })` with **no identity
> filter** and returned `formatResult(existing)` — which contains the full answer key and every
> explanation. Because `idempotencyKey` is globally unique, any student who replayed or guessed
> another student's key would receive that student's complete graded attempt. The lookup must
> always carry the identity filter, exactly like every other read in this service.

```javascript
// quiz.service.js
async function submitQuiz({ quizId, idempotencyKey, timeTakenSec, answers, userIdOrGuest }) {
  const identityFilter = identityFilterOf(userIdOrGuest); // { userId } or { guestId }

  // Fast path: previously-submitted key returns the same result.
  // [AUDIT] identityFilter is REQUIRED here — see security note above.
  const existing = await QuizAttempt.findOne({ idempotencyKey, ...identityFilter }).lean();
  if (existing) return formatResult(existing);

  // Load the session and lock it via findOneAndUpdate (status → submitted)
  const session = await QuizSession.findOneAndUpdate(
    { _id: quizId, ...identityFilter, status: 'pending' },
    { $set: { status: 'submitted' } },
    { returnDocument: 'before' }  // 'before' so we see the served questions unchanged
  );
  if (!session) throw new HttpError(409, 'Quiz already submitted or expired');

  // Score using session.servedQuestions[i].shuffledCorrectKey — NOT Question.correctAnswer
  const scoredAnswers = session.servedQuestions.map(sq => {
    const submitted = answers.find(a => String(a.questionId) === String(sq.questionId));
    return {
      questionId:         sq.questionId,
      questionVersion:    sq.questionVersion,
      topicIdSnapshot:    sq.topicIdSnapshot,
      selectedAnswer:     submitted?.selectedAnswer ?? null,
      shuffledCorrectKey: sq.shuffledCorrectKey,
      isCorrect:          submitted?.selectedAnswer === sq.shuffledCorrectKey,
      timeSpentMs:        submitted?.timeSpentMs ?? 0,
    };
  });

  const score = scoredAnswers.filter(a => a.isCorrect).length;
  const percentage = Math.round((score / scoredAnswers.length) * 100);
  const passed = session.quizType === 'chapter_gate' && percentage >= 70;

  const attempt = await QuizAttempt.create({
    ...identityFilter,
    quizSessionId: session._id,
    idempotencyKey,
    quizType: session.quizType,
    subjectId: session.subjectId,
    chapterId: session.chapterId,
    chapterIds: session.chapterIds,
    totalQuestions: scoredAnswers.length,
    score, percentage, answers: scoredAnswers,
    // [AUDIT] The original draft hardcoded 0 here while §11 documented timeTakenSec as a
    // request field — so the value would always have been discarded. Take it from the
    // request, clamped: it is client-measured and informational, never trusted for logic.
    timeTakenSec: Math.max(0, Math.min(Number(timeTakenSec) || 0, 3 * 60 * 60)),
  });

  await QuizSession.updateOne({ _id: session._id }, { $set: { submittedAttemptId: attempt._id } });

  // If this is a gate quiz, update chapter_progress (see Section 7)
  if (session.quizType === 'chapter_gate') {
    await handleGateQuizResult(userIdOrGuest, session.chapterId, attempt, passed);
  }

  return formatResult(attempt, { passed });
}
```

**Pass/fail derivation:** `passed` is NOT stored in `quiz_attempts` schema (only `chapter_gate` cares about it, and it's trivially derivable). Computed at submit time and returned in the response.

---

## 7. State Machine: Chapter Completion + Quiz Gate

### 🔴 [AUDIT] BLOCKER — the hook this entire gate hangs off is dead code today

The original draft stated: *"Currently in `step7.saveAndRespond.js` (line 311-317), when
`CHAPTER_COMPLETE` fires, `markChapterComplete()` is called immediately — setting
`status: 'completed'`. The quiz gate needs to intercept this."*

**That branch never executes in the current build.** `markChapterComplete()` is never called,
and no chapter ever reaches `status: 'completed'` through the ask pipeline.

**Root cause — two files disagree on what `retrieval` means.**

`step5.retrieveContent.js` returns `retrievedContext` as a **sibling** of `retrieval`, and in
the chapter-complete case sets `retrieval` to `null` outright:

```js
// step5.retrieveContent.js:57-63
if (result.status === 'chapter_complete') {
  return {
    retrieval: null, chunks: [], sources: [],
    retrievedContext: 'CHAPTER_COMPLETE',   // ← sibling of `retrieval`, not inside it
    nextTopicSignal: null,
  };
}
```

`askOrchestrator.js` reads it correctly, off the whole step5 return object:

```js
// askOrchestrator.js:164-174
const retrieval = await retrieveContent(...);        // the WHOLE object
if (retrieval.retrievedContext !== 'CHAPTER_COMPLETE') { ... }   // ✅ correct
await saveAndRespond(input, session, context, decision, retrieval, response, ...);
```

But `step7.saveAndRespond.js` destructures the **inner** `retrieval` out of that same object,
then reads `retrievedContext` off the inner one:

```js
// step7.saveAndRespond.js:192  — 5th parameter
{ retrieval, sources, nextTopicSignal, lastRetrievalQuery, isOutOfFocusAnswer }
// step7.saveAndRespond.js:309
const isComplete = retrieval?.retrievedContext === 'CHAPTER_COMPLETE';
```

`retrieval` here is `null` (chapter-complete case) or `{ question, debug }` / the raw retriever
result — **none of which ever carry a `retrievedContext` key**. So `isComplete` is permanently
`false`.

Verified by replaying the exact objects:

```
orchestrator sees: CHAPTER_COMPLETE
step7 isComplete  = false   <-- markChapterComplete only runs if true
```

Grep confirms `markChapterComplete` has exactly one caller — inside that dead branch. The
`logStudyEvent(..., 'chapter_completed')` on the next line is dead for the same reason.

**Why this matters for the quiz gate specifically:** §10 instructs replacing
`markChapterComplete()` with `setChapterAwaitingQuiz()` **in this same branch**. Doing that as
written would put the new call inside the same unreachable code path — no chapter would ever
enter `awaiting_quiz`, and `POST /quiz/generate` with `quizType: 'chapter_gate'` would return
`409` forever, with nothing in the logs to explain why. This is precisely the kind of silent
failure that is very expensive to debug weeks later.

**Therefore: fixing this is Phase 0 — it ships and is verified BEFORE Phase 3 starts.** See §17.
The fix itself is one line (destructure `retrievedContext` in step7 and test against it), but it
is a **behaviour change to shipped code** — chapters that silently never completed will start
completing — so it gets its own branch, its own verification, and its own commit, separate from
any quiz work.

### State Transition Table

```
Current Status    | Event                    | New Status       | Action
------------------|--------------------------|------------------|---------------------------
in_progress       | All topics completed     | awaiting_quiz    | Prompt student to take quiz
awaiting_quiz     | Quiz score >= 70%        | completed        | Confetti, unlock next chapter
awaiting_quiz     | Quiz score < 70%         | awaiting_quiz    | Show weak topics, allow retry
awaiting_quiz     | Student starts studying  | awaiting_quiz    | Quiz still required (no escape)
completed         | Student revisits         | revising         | (existing behavior)
```

### Code Change in step7.saveAndRespond.js

**Phase 0 (prerequisite — makes the branch reachable at all):**

```javascript
// step7.saveAndRespond.js:192 — add retrievedContext to the destructure
{ retrieval, retrievedContext, sources, nextTopicSignal, lastRetrievalQuery, isOutOfFocusAnswer }

// step7.saveAndRespond.js:309 — test the sibling field, not the inner object
const isComplete = retrievedContext === 'CHAPTER_COMPLETE';
```

After this, `markChapterComplete()` runs for real and chapters reach `status: 'completed'` —
which is the behaviour the rest of the app (FocusModal "Completed" state, the `completed`
recommendation branch in `chapterProgress.controller.js:44`) has always assumed.

**Phase 3 (the actual gate) — only after Phase 0 is verified:**

```javascript
// BEFORE (post-Phase-0 code):
if (isComplete) {
  chapterProgressDoc = await markChapterComplete(userId, guestId, chapterId);
  logStudyEvent(userId, guestId, sessionId, chapterId, 'chapter_completed');
}

// AFTER (with quiz gate):
if (isComplete) {
  // Don't auto-complete — move to awaiting_quiz instead
  chapterProgressDoc = await setChapterAwaitingQuiz(userId, guestId, chapterId);
  logStudyEvent(userId, guestId, sessionId, chapterId, 'chapter_completed');
  // step7 response will include a quiz prompt action
}
```

Keep `markChapterComplete()` exported — it is still the function `handleGateQuizResult` uses
conceptually when the student passes (see below), and Phase 0 restores it to working order.

### Guarding Against Re-triggering

If a student is already in `awaiting_quiz` or `completed` state and somehow triggers `CHAPTER_COMPLETE` again (e.g., revisiting the last topic):

```javascript
async function setChapterAwaitingQuiz(userId, guestId, chapterId) {
  // Only transition from in_progress → awaiting_quiz
  // If already awaiting_quiz or completed, no-op (return existing doc)
  const doc = await ChapterProgress.findOneAndUpdate(
    { ...buildFilter(userId, guestId, chapterId), status: 'in_progress' },
    { $set: { status: 'awaiting_quiz' } },
    { new: true }
  );
  // If no doc returned (already past this state), fetch current for the caller
  return doc || ChapterProgress.findOne(buildFilter(userId, guestId, chapterId));
}
```

### Handling Gate Quiz Result — chapter_progress update

Called from `submitQuiz` when `quizType === 'chapter_gate'`.

```javascript
async function handleGateQuizResult(identity, chapterId, attempt, passed) {
  const { userId, guestId } = identity;
  const filter = buildFilter(userId, guestId, chapterId);

  // Always: increment attempts, update best score if improved, remember last attempt
  const currentDoc = await ChapterProgress.findOne(filter, { quizGateBestScore: 1 }).lean();
  const currentBest = currentDoc?.quizGateBestScore ?? 0;
  const newBest = Math.max(currentBest, attempt.percentage);

  const setFields = {
    quizGateBestScore: newBest,
    lastQuizAttemptId: attempt._id,
    lastStudiedAt: new Date(),
  };

  // On pass, transition awaiting_quiz → completed
  if (passed) {
    setFields.status = 'completed';
    setFields.completedAt = new Date();
    setFields.progressPercent = 100;
  }
  // On fail, status stays awaiting_quiz (no change needed)

  await ChapterProgress.findOneAndUpdate(
    filter,
    { $set: setFields, $inc: { quizGateAttempts: 1 } }
  );

  // Cache invalidation same as any other chapter_progress write
  await invalidateChapterProgressCache(userId, guestId, chapterId);
}
```

### Retry Cool-Down

No cool-down between gate quiz retries. Students can retry immediately.

**Reasoning:** Bihar Board students often have limited study time. Forcing a 5-minute wait after a failed attempt would feel punitive and slow down learning momentum. The seen-question deprioritization (Layer 2) already ensures each retry feels different.

**If abuse becomes a problem** (e.g., a student brute-forces by picking random answers repeatedly to pass): add a soft "Kya tum sach mein padh ke aaye ho?" nudge after 5 consecutive failures. Not part of Phase 1-5.

---

## 8. User Flow, UX & Exam Rules

### Gate Quiz Flow

1. **Trigger:** Activated when `step7` detects `CHAPTER_COMPLETE` for a chapter in Focus Mode.
2. **Format:** 1 Question per screen with A/B/C/D option buttons.
3. **Passing Threshold:** 70% (7 out of 10).
4. **Timer:** No per-question timer. Total quiz time recorded for analytics.
5. **Explanations:** Shown at the **End of Quiz** on the Scoreboard (simulating real exam — no mid-quiz answers).
6. **Pass Outcome:** Confetti animation -> `status: 'completed'` -> Recommendation: *"Agla Chapter Shuru Karein?"*
7. **Fail Outcome:** Scoreboard -> Weak Topics Breakdown (per-topicId analysis) -> Unlimited Retries button.

### Weak Topic Analysis (uses `topicIdSnapshot` frozen in the attempt)

On quiz failure, group incorrect answers by the topicId snapshot stored in the attempt (not the current question.topicId — questions may be re-tagged later):

```javascript
function getWeakTopics(attempt) {
  const topicStats = {};
  for (const ans of attempt.answers) {
    const topicId = ans.topicIdSnapshot;
    if (!topicId) continue;
    if (!topicStats[topicId]) topicStats[topicId] = { total: 0, wrong: 0 };
    topicStats[topicId].total++;
    if (!ans.isCorrect) topicStats[topicId].wrong++;
  }
  return Object.entries(topicStats)
    // Weak topic threshold: >= 50% wrong AND at least 2 questions seen on that topic
    // (avoids "1/1 wrong = weak topic" noise on tiny samples)
    .filter(([, s]) => s.total >= 2 && (s.wrong / s.total) >= 0.5)
    .sort((a, b) => (b[1].wrong / b[1].total) - (a[1].wrong / a[1].total))
    .map(([topicId, s]) => ({ topicId, wrongCount: s.wrong, totalCount: s.total }));
}
```

**Weak topic threshold:** >= 50% wrong on a topic AND at least 2 questions seen on that topic in the same attempt. This avoids the noisy "1/1 wrong → weak topic" case.

Display: *"Tumhe Refraction par dhyan dene ki zarurat hai (3/4 galat)"*

**[AUDIT] The API must return topic *titles*, not just IDs.** `getWeakTopics()` above returns
`{ topicId, wrongCount, totalCount }`, and §11's response spec shows only `topicId` — but the
display copy needs a human title ("Refraction"), and `topicIdSnapshot` is an opaque string like
`science.physics.chapter-01.topic-03`. The frontend has no topic dictionary to resolve it.

Resolve it server-side before responding, using the loaders that already exist:

```js
import { loadCurriculumIndex }  from '../curriculum/curriculumIndexLoader.js';
import { getChapterCoreTopics } from '../curriculum/topicResolver.js';

// after computing weak topics:
const index  = await loadCurriculumIndex();
const topics = getChapterCoreTopics(index, chapterId);
const withTitles = weakTopics.map((w) => ({
  ...w,
  topicTitle: topics.find((t) => t.topicId === w.topicId)?.title ?? null,
}));
```

Note `getChapterCoreTopics` returns only `role: 'core'` topics. A question may be tagged to a
non-core topic, in which case the lookup yields `null` — the UI must fall back to a generic
line ("Kuch topics par aur practice chahiye") rather than rendering a raw ID at the student.

### Guest Gate Quiz Flow (same as logged-in, guest is fully supported)

Guests are first-class in Focus Mode already — they have `chapter_progress` docs keyed by `guestId`. The gate quiz flow is identical:

1. Guest completes all topics → `status: 'awaiting_quiz'` on their guest chapter_progress doc.
2. Guest takes the gate quiz → `quiz_sessions` and `quiz_attempts` written with `guestId`.
3. On pass → guest's `chapter_progress.status` → `'completed'`, `quizGateBestScore` updated.
4. If the guest later signs up, `claimGuestData` (extended, see Section 9) migrates all quiz data to `userId`.

No code branches for guest vs user — the `identityFilter` helper (`userId ? { userId } : { guestId }`) handles both.

### Practice Quiz Flow

1. Student opens Quiz Hub from Sidebar.
2. Selects subject -> chapter (chapter-wise) or subject only (mix).
3. **Chapter-wise:** 10 MCQs from that chapter.
4. **Mix:** 20 MCQs distributed across chapters of that subject.
5. No pass/fail gating — score shown for self-assessment only.
6. History of all attempts visible in Quiz Hub.

### Mix Quiz Repetition Rule

Student taking the same Mix Quiz multiple times:
- Layer 2 (seen-question deprioritization) applies — unseen questions served first.
- If all questions in the subject are exhausted, serve seen questions with shuffled options.
- Display a note: *"Tumne saare available questions try kar liye hain. Options shuffle kiye gaye hain."*

### Frontend State: Quiz In-Progress

Quiz state is **local (React state), not Redux/persisted.** Reasoning:
- Quiz is a short interaction (2-5 minutes). Mid-quiz refresh = restart quiz.
- The client holds the served question list and the student's in-progress selections in memory, and sends them on submit.
- Simpler implementation, fewer edge cases.

If the student refreshes mid-quiz, the quiz resets — the client's in-memory selections are
lost and the student generates a fresh quiz. This is acceptable for a 10-question quiz.

> **[AUDIT] Corrected.** The original draft said *"No server-side quiz session needed"* here.
> That is wrong and contradicts §5 (Collection 2 `quiz_sessions`), §6, and §11 (where `quizId`
> **is** `quiz_sessions._id`). A server-side session is mandatory — it is the only place the
> per-question shuffle map lives, and without it scoring is impossible (§4 Layer 1). What is
> genuinely client-side is only the **in-progress UI state** (which question is on screen, which
> options are selected so far). The abandoned server session is harmless: it stays `pending` and
> the 30-minute TTL index reaps it.

---

## 9. Guest Data & Claim Path

### How Guest Quizzes Work

Unauthenticated users take quizzes under their `guestId` (same localStorage-based ID used for chat sessions).

- `quiz_attempts.guestId` stores the guest identifier.
- `quiz_attempts.userId` is null for guests.

### Claim on Registration/Login

The existing `claimGuestData()` in `backend/src/services/chapterProgress.service.js` (line ~290) handles chapter_progress + study_events. We **extend that same function** in place — no new function. This keeps the claim atomic and matches how the existing `POST /api/v1/auth/claim-guest-progress` endpoint already calls it.

**Changes needed to `claimGuestData(userId, guestId)`:**

```javascript
// Add at the end of the existing function, before the return statement:

// [AUDIT] Use `$set: { guestId: null }`, NOT `$unset` — the existing claimGuestData already
// does `{ $set: { userId, guestId: null } }` for chapter_progress (service line ~304) and
// StudyEvent.updateMany (line ~338). Both work with the `$type: 'string'` partial indexes,
// but mixing the two styles across collections means a future maintainer cannot tell whether
// "guestId absent" and "guestId null" mean different things. They don't — keep one style.

// 1. Reassign quiz attempts
const quizResult = await QuizAttempt.updateMany(
  { guestId },
  { $set: { userId, guestId: null } }
);

// 2. Reassign any pending quiz sessions (rare — usually TTL-expired before claim)
await QuizSession.updateMany(
  { guestId, status: 'pending' },
  { $set: { userId, guestId: null } }
);

// 3. Merge quizGateBestScore/quizGateAttempts inside the existing per-chapter merge loop
//    (in the "if (existing)" branch above):
//    - quizGateBestScore: take Math.max of both sides
//    - quizGateAttempts: sum of both sides
//    - lastQuizAttemptId: take whichever side has the higher best score
```

Extend the existing return object with `{ quizAttemptsTransferred: quizResult.modifiedCount }`.

### Merging Conflict — Same Chapter, Both Guest and User Attempts

The existing `claimGuestData` already handles "same chapter has both a guestDoc and an existing userDoc" for chapter_progress. The rule extends naturally to quiz gate fields — see step 3 above.

**Example:** Guest scored 60% on Ch01 gate quiz (twice, best 60%). Then signs up. Turns out they already had an account where they scored 80% on Ch01. After claim:
- `quizGateBestScore` = max(60, 80) = 80
- `quizGateAttempts` = 2 + old_attempts
- `status` = whichever side is 'completed' (existing merge logic picks the further-along one)

### Race Condition: Signup Mid-Quiz

If a guest starts a quiz, then signs up in another tab before submitting:
- The quiz submit endpoint receives `guestId` (from the tab that started the quiz).
- `claimGuestData` has already migrated previous attempts but this new session/attempt isn't in the DB yet.
- Solution: `submitQuiz` uses whichever identity is on the request (auth token wins over guestId if both present). If the attempt saves under `guestId`, a re-claim on next login sweeps it up.
- Frontend: on successful login, always call `/api/v1/auth/claim-guest-progress` (this happens today for chapter_progress; nothing new needed).

---

## 10. Code & Architecture Blueprint

### Backend — New Files

| File | Purpose |
|------|---------|
| `backend/src/models/question.model.js` | Question Bank schema (Section 5) |
| `backend/src/models/quizSession.model.js` | QuizSession schema (Section 5) — required for shuffle-aware scoring |
| `backend/src/models/quizAttempt.model.js` | QuizAttempt History schema (Section 5) |
| `backend/src/services/quiz.service.js` | Core logic: generateQuiz, submitQuiz, getHistory, getWeakTopics, Layer 1 shuffle, Layer 2 selection |
| `backend/src/controllers/quiz.controller.js` | HTTP handlers |
| `backend/src/routes/quiz.routes.js` | Routes: `/api/v1/quiz/*` |
| `backend/scripts/seed-quiz-bank.js` | Seeding engine: `npm run quiz:seed` (behavior in Section 12) |
| `data/quiz-bank/science/physics/science.physics.chapter-01.json` | Seed data (one file per chapter, format in Section 12) |

### Backend — Modified Files

| File | Change |
|------|--------|
| `backend/src/models/chapterProgress.model.js` | Add `awaiting_quiz` to status enum, add `quizGateBestScore`, `quizGateAttempts`, `lastQuizAttemptId` |
| `backend/src/ask/step7.saveAndRespond.js` | **Phase 0:** destructure `retrievedContext` and fix the always-false `isComplete` check (§7). **Phase 3:** call `setChapterAwaitingQuiz()` instead of `markChapterComplete()` in that now-reachable branch |
| `backend/src/services/chapterProgress.service.js` | Add `setChapterAwaitingQuiz()` helper. Extend existing `claimGuestData()` (line ~290) to also claim quiz_attempts + quiz_sessions and merge gate score fields |
| `backend/src/controllers/chapterProgress.controller.js` | **[AUDIT]** Handle `awaiting_quiz` in the `summary` counts (line ~186) — see §5 |
| `backend/src/models/studyEvent.model.js` | **[AUDIT]** Add quiz event types to the `eventType` enum and relax `chapterId` — see below (Phase 6) |
| `backend/src/app.js` | Register `/api/v1/quiz` routes |
| `backend/src/middlewares/rateLimiters.js` | Add `quizGenerateLimiter`, `quizSubmitLimiter` (Section 14) |
| `backend/package.json` | Add npm scripts: `quiz:seed`, `quiz:seed:dry-run`, `test:quiz`, `test:quiz-api` |

### [AUDIT] Identity middleware — the original draft never specified it

Quiz routes are guest-capable, so they must follow the exact pattern every other guest-capable
route already uses. From `backend/src/routes/chapterProgress.routes.js`:

```js
import { optionalAuth } from '../auth/authMiddleware.js';
router.use(optionalAuth);   // attaches req.user for logged-in users, never blocks guests
```

and in the controller (`chapterProgress.controller.js:20-23`):

```js
const extractIdentity = (req) => ({
  userId:  req.user?.id   || null,                                   // STRING, see §5
  guestId: req.user ? null : (req.headers['x-guest-id'] || null),
});
```

`quiz.routes.js` and `quiz.controller.js` must reuse this verbatim. Note the mutual exclusion:
a logged-in user **never** also gets a `guestId`, which is what makes `identityFilterOf()`
unambiguous and resolves the §9 "signup mid-quiz" race in favour of the authenticated identity.

**Frontend side needs no work** — `services/axios/axiosInstance.js` already attaches
`X-Guest-Id` automatically on every request when no bearer token is present.

### [AUDIT] studyEvent cannot accept quiz events as currently specified

Phase 6 logs `quiz_started` / `quiz_submitted` / `quiz_passed` / `quiz_failed` via
`logStudyEvent`. Two blockers in `backend/src/models/studyEvent.model.js`:

1. `eventType` is a **strict enum** (lines 11-27) and contains none of these four.
2. `chapterId` is `required: true` (line 8) — a `mix_practice` attempt has no single chapter.

And critically, `logStudyEvent` is **fire-and-forget with a `.catch()`**
(`chapterProgress.service.js:348-363`), so both failures would be swallowed into a console line
and the analytics would simply be empty with no visible error.

Required before Phase 6 logs anything: add the four event types to the enum, and make
`chapterId` optional (`default: null`) or pass the subject-level id for mix quizzes.

### Frontend — New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/QuizModal.jsx` | 1-question-at-a-time quiz runner + scoreboard |
| `frontend/src/pages/QuizPage.jsx` | Standalone Practice Quiz Hub |
| `frontend/src/components/QuizResultCard.jsx` | Reusable score + weak topic summary |

### Frontend — Modified Files

| File | Change |
|------|--------|
| `frontend/src/api/tutorApi.js` | Add `generateQuiz()`, `submitQuiz()`, `fetchQuizHistory()` |
| `frontend/src/components/FocusModal.jsx` | Show quiz status chip on `awaiting_quiz` chapters |
| `frontend/src/pages/ChatPage.jsx` | Handle gate quiz trigger from Ask API response |
| `frontend/src/components/Sidebar.jsx` | Add a Quiz Practice entry point — **[AUDIT] see note below, this is not a "tab"** |
| `frontend/src/App.jsx` | Register `/quiz` route (unguarded, like `/chat` — guests are supported) |

#### [AUDIT] Sidebar has no navigation-tab concept anymore

The original draft said "Add 'Quiz Practice' navigation tab", which described the **old**
sidebar — the one with a `navItems` array of Tutor / History / Tracking / Quiz entries marked
"Soon". That sidebar no longer exists. The current `frontend/src/components/Sidebar.jsx` is a
session-list rail: collapse toggle, `ZunoMark`, new-chat button, a session search box, the
`SessionListBody`, and `AccountMenu` pinned at the footer. There is no `navItems` array and no
tab strip to add an item to.

So Phase 5 has an actual design decision to make, not a one-line insert. Options:
- a dedicated icon button in the collapsed rail (consistent with how the rail already works), or
- an entry in the `AccountMenu` / `AccountSheet` (the pattern `/support` already uses), or
- a persistent item above the session list.

Decide this before starting Phase 5 — it changes the component's layout contract, and the
mobile `AccountSheet` needs the matching treatment either way.

### API Endpoints

Single unified endpoint set — `quizType` distinguishes gate vs practice. No separate `/gate/*` routes needed (simpler routing, one code path).

```
POST   /api/v1/quiz/generate      — Generate quiz (returns questions without answers)
POST   /api/v1/quiz/submit         — Submit answers, get score + explanations
GET    /api/v1/quiz/history        — User's quiz attempt history (paginated)
GET    /api/v1/quiz/history/:id    — Single attempt detail with explanations
```

Full request/response specs in Section 11.

---

## 11. API Contract — Request/Response Specs

**[AUDIT 2026-08-09] Response bodies below show `questionText`/`options[].text`/`explanation` as
plain strings — that assumed the old single-language schema.** Since §5's `question_bank` schema
is now 3-language (`{ en, hi, hinglish }`), Phase 2's `generateQuiz`/`submitQuiz` must pick one
language before sending to the client — they can never forward the localized object as-is (the
non-negotiable "response omits `correctAnswer`, `explanation`" rule stays, this is only about
which single string represents `questionText`/`options[].text` in the trimmed response). **Default:
`hinglish`** (matches the rest of the app — see `CLAUDE.md` language rules), with `en`/`hi` as
fallback if `hinglish` is null for that question. This is a Phase 2 decision, not a Phase 1 one —
flagged here so it isn't rediscovered as a surprise mid-phase. If/when a language toggle ships in
the UI, `generateQuiz` gains an optional `lang` param and picks that language's string instead.

### POST /api/v1/quiz/generate

**Request:**
```json
{
  "quizType": "chapter_gate" | "chapter_practice" | "mix_practice",
  "subjectId": "science",
  "chapterId": "science.physics.chapter-01"   // required for chapter_gate & chapter_practice; omit for mix_practice
}
```

**Server validation:**
- `chapter_gate` — verify chapter_progress.status === 'awaiting_quiz' for this student. Else 409.
- `chapter_practice` — no status check. Any chapter allowed anytime.
- `mix_practice` — chapterId ignored, uses balancing algorithm from Section 2.

**Identity:** `optionalAuth` + `X-Guest-Id` header, exactly as §10 specifies. No request body
field carries identity — it always comes from the middleware.

**Response (200):**
```json
{
  "quizId": "<quiz_sessions._id>",
  "quizType": "chapter_gate",
  "totalQuestions": 10,
  "requestedCount": 10,
  "partialBank": false,
  "expiresAt": "2026-07-29T14:30:00Z",
  "questions": [
    {
      "questionId": "<question._id>",
      "questionText": "Prakash ka veg kitna hota hai?",
      "options": [
        { "key": "A", "text": "3 × 10⁸ km/s" },
        { "key": "B", "text": "3 × 10⁸ m/s" },
        { "key": "C", "text": "3 × 10⁶ m/s" },
        { "key": "D", "text": "3 × 10¹⁰ m/s" }
      ]
    }
  ]
}
```

**Response omits:** `correctAnswer`, `explanation`, `topicId`, `shuffledCorrectKey`. These NEVER leave the server before submit.

### POST /api/v1/quiz/submit

**Request:**
```json
{
  "quizId": "<quiz_sessions._id>",
  "idempotencyKey": "<client-generated uuid>",
  "timeTakenSec": 240,
  "answers": [
    { "questionId": "<qid>", "selectedAnswer": "B", "timeSpentMs": 15000 },
    { "questionId": "<qid>", "selectedAnswer": null, "timeSpentMs": 3000 }
  ]
}
```

`selectedAnswer: null` means the student skipped that question. `timeSpentMs` is client-measured (informational only, not validated).

**Response (200):**
```json
{
  "attemptId": "<quiz_attempts._id>",
  "quizType": "chapter_gate",
  "score": 7,
  "totalQuestions": 10,
  "percentage": 70,
  "passed": true,
  "chapterStatusAfter": "completed",
  "weakTopics": [
    {
      "topicId": "science.physics.chapter-01.topic-03",
      "topicTitle": "Refraction of Light",
      "wrongCount": 2,
      "totalCount": 3
    }
  ],
  "results": [
    {
      "questionId": "<qid>",
      "questionText": "…",
      "options": [ … ],
      "selectedAnswer": "A",
      "correctAnswer": "B",
      "isCorrect": false,
      "explanation": "Prakash ka veg 3 × 10⁸ m/s hota hai, km/s nahi."
    }
  ]
}
```

`chapterStatusAfter` is only present when `quizType === 'chapter_gate'` — tells frontend whether to celebrate or show "try again".

**Response codes:**
- `200` — first successful submit
- `200 + same body` — duplicate submit (same idempotencyKey **from the same student**) → returns original result
- `409` — quiz already submitted with different idempotencyKey / session expired
- `404` — quizId not found or doesn't belong to this student

**[AUDIT]** A duplicate `idempotencyKey` submitted by a *different* identity must never return
the original student's result — it is treated as a plain miss and falls through to the normal
session lookup, which then 404s because the session isn't theirs. See the security note in §6.

### GET /api/v1/quiz/history

**Query params:** `?limit=20&cursor=<createdAt>&quizType=chapter_gate&chapterId=…`

**Response:** paginated list, each item summarized (no full `results` — fetch via /history/:id for details).

### GET /api/v1/quiz/history/:attemptId

**Response:** full attempt including all `results` with explanations. 404 if not owned by this student.

### [AUDIT 2026-08-09] Future: Question Management API — concept only, not scheduled to a phase

Real data gaps exist today (§19): 0/744 questions have an `explanation`, a `topicId`, or a
`difficulty`. Bulk JSON re-seeding (§12) is the only way to fix that right now — edit the JSON
file, re-run `quiz:seed`. That is fine for the initial 744, but is the wrong tool for ongoing
one-off fixes ("this one question's Hindi text has a typo") or for adding freshly-written
questions outside the PYQ pipeline.

The `question_bank` schema (§5) is deliberately shaped so a thin admin CRUD layer can be added
later **without another schema change**:

| Endpoint (future, unscheduled) | Does |
|---|---|
| `POST /api/v1/admin/quiz/questions` | Insert one question. `seedKey` optional — server generates one if omitted (see §5's seedKey note). |
| `PATCH /api/v1/admin/quiz/questions/:id` | Edit any field — e.g. backfill `explanation`, fix a Hindi typo, set `difficulty`. Bumps `version`. |
| `PATCH /api/v1/admin/quiz/questions/:id/deactivate` | Sets `isActive: false`. **Never a real delete** — see §12's note on why deletion breaks attempt history. |

**Why this is written down now, not built now:** documenting the shape prevents Phase 1's schema
from accidentally choosing a design (e.g. required `explanation`, string-only text) that this
future API couldn't work with later. It is explicitly **out of scope for every phase currently on
the board (0-6)** — no phase number is assigned yet. Building it is a product call for a later
session, once it's clear how much ongoing question-bank maintenance is actually needed.

---

## 12. JSON Seed File Format

**[AUDIT 2026-08-09] Format changed to 3-language (`{ en, hi, hinglish }`) fields** — matches the
§5 schema change. Also: this format is no longer hand-authored. It is the **output of a transform
script**, not something anyone types by hand. See the new "Where the seed files come from" note
below and §19 for the full reasoning.

One file per chapter at `data/quiz-bank/<subject>/<section>/<chapter-id>.json`.

Example: `data/quiz-bank/science/physics/science.physics.chapter-01.json`

```json
{
  "subjectId": "science",
  "sectionId": "physics",
  "chapterId": "science.physics.chapter-01",
  "chapterTitle": "Light - Reflection and Refraction",
  "questions": [
    {
      "seedKey": "sci-phy-ch01-q000033",
      "topicId": null,
      "questionText": {
        "en": "The image formed by plane mirror is",
        "hi": "समतल दर्पण द्वारा बना प्रतिबिम्ब होता है",
        "hinglish": "Samtal darpan dwara bana pratibimb hota hai"
      },
      "options": [
        { "key": "A", "text": { "en": "virtual", "hi": "काल्पनिक", "hinglish": "Kalpanik" } },
        { "key": "B", "text": { "en": "real", "hi": "वास्तविक", "hinglish": "Vastavik" } },
        { "key": "C", "text": { "en": "both (a) and (b)", "hi": "(a) और (b) दोनों", "hinglish": "(a) aur (b) dono" } },
        { "key": "D", "text": { "en": "none of these", "hi": "इनमें से कोई नहीं", "hinglish": "Inmein se koi nahi" } }
      ],
      "correctAnswer": "A",
      "explanation": { "en": null, "hi": null, "hinglish": null },
      "difficulty": null,
      "yearAsked": [2016]
    }
  ]
}
```

**`seedKey`** is a human-readable stable ID used only for re-seeding (so `quiz:seed` can update an existing question by matching seedKey rather than creating a duplicate). It is stored on the Question document and **carries a unique index** — [AUDIT] the original text said "no unique index needed, just a plain field", which contradicted the schema in §5 and would let two seed runs race into duplicate questions. It is never used by the runtime quiz service. **[AUDIT 2026-08-09]** real seed keys follow `<subject-abbr>-<section-abbr>-<chapter-num>-<original questionId>`, e.g. `sci-phy-ch01-q000033` — the suffix traces straight back to the bulk pipeline's `q-000033` for debugging, without exposing that pipeline's internal ID scheme to the runtime schema.

### [AUDIT 2026-08-09] Where the seed files come from — one-time transform, not hand-authoring

The 16 chapter JSON files above are **generated once** from `data/quiz-bank/bank/questions.json`
on branch `quiz-phase0.5-bulk` (744 usable questions, all 16 chapters, produced by the pipeline in
`QUIZ_DATA_PIPELINE.md`). Phase 1's actual data work is:

1. Bring `quiz-phase0.5-bulk`'s `data/quiz-bank/bank/questions.json` onto this branch.
2. Write a one-time transform script that reads that single bulk file and writes the 16 per-chapter
   files in the format above — renaming fields (`questionId` → `seedKey` prefix, `canonical.text` →
   `questionText`, `canonical.options` → `options`, `canonical.answer.correctOption` → uppercased
   `correctAnswer`), splitting by `chapter.chapterId`, and leaving `explanation`/`topicId`/
   `difficulty` as `null` since the source data doesn't have them yet (§19).
3. From that point on, the 16 files are what `quiz:seed` reads — the transform script is not part
   of the ongoing pipeline, it runs once to produce them.

This replaces every earlier mention in this document of "hand-write 50 questions per chapter" —
that plan predates the bulk extraction and is no longer how Phase 1 gets its data.

### Seed Script Behavior (`npm run quiz:seed`)

1. Reads all `data/quiz-bank/**/*.json` files
2. Validates every question:
   - `questionText`, `correctAnswer` non-empty (at least one of `en`/`hi`/`hinglish` set on `questionText` and on every option's `text`) — **[AUDIT 2026-08-09]** `explanation` is NOT required (§5) — real data has none yet
   - Exactly 4 options with unique keys A/B/C/D
   - `correctAnswer` is one of the option keys
   - `chapterId` exists in `curriculum-index.json` **and is not in a non-browsable section**
     ([AUDIT] see §1 — `science.meta.chapter-00` passes a naive index check but is orientation
     content, not a quizzable chapter; seeding questions against it must be rejected)
   - `topicId` (if present) exists in that chapter
   - No duplicate `seedKey` across files
3. For each question: `upsert` by `seedKey` — updates existing (bumps `version` if content changed) or inserts new
4. Marks questions in DB but NOT in seed as `isActive: false` (soft delete — preserves history)
5. Clears Redis quiz cache (`quiz:questions:*`)
6. Prints summary: `X inserted, Y updated, Z deactivated`

### `--dry-run` mode

Runs steps 1-2 (parse + validate) without writing to DB. Exits non-zero on any validation error. Used in CI and pre-commit.

---

## 13. Testing Plan

### Unit Tests (Phase 2)

- `quiz.service.test.js` — test question selection, option shuffling, scoring logic, seen-question deprioritization, idempotency
- Seed script dry-run test — verify JSON files parse correctly, required fields present, no duplicate questions

### Integration Tests (Phase 2-3)

- `test:quiz-api` — hit quiz endpoints via HTTP, verify:
  - `generateQuiz` response contains NO `correctAnswer` or `explanation`
  - `submitQuiz` response contains correct scoring
  - Gate submit updates `chapter_progress.status` correctly
  - Idempotent submit returns same result

### Regression Tests (Phase 3)

- Existing `test:golden` suite — add quiz gate scenarios:
  - Chapter complete -> status becomes `awaiting_quiz` (not `completed`)
  - Quiz pass -> status becomes `completed`
  - Quiz fail -> status stays `awaiting_quiz`

### npm scripts to add to `backend/package.json`

```json
{
  "quiz:seed": "node scripts/seed-quiz-bank.js",
  "quiz:seed:dry-run": "node scripts/seed-quiz-bank.js --dry-run",
  "test:quiz": "node scripts/test-quiz-service.js",
  "test:quiz-api": "node scripts/test-quiz-api.js"
}
```

---

## 14. Caching & Rate Limiting

### Redis Cache for Question Bank

Questions change rarely (only on seed updates). Cache the entire chapter question set in Redis:

```javascript
const QUIZ_CACHE_TTL = 3600; // 1 hour — questions are static

async function getChapterQuestions(chapterId) {
  const cacheKey = `quiz:questions:${chapterId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const questions = await Question.find({ chapterId, isActive: true }).lean();
  if (questions.length) await redis.setex(cacheKey, QUIZ_CACHE_TTL, JSON.stringify(questions));
  return questions;
}
```

Cache invalidation: `npm run quiz:seed` clears all `quiz:questions:*` keys at the end. Follow the existing `chapterProgress.service.js` pattern: wrap Redis calls in try/catch — cache is optional, never blocks the request.

**[AUDIT] This reader must actually be on the hot path.** The original draft defined
`getChapterQuestions()` here but §4's `selectQuestions()` called `Question.find({ chapterId,
isActive: true })` directly — so the cache existed on paper and was never used. §4 has been
corrected to call `getChapterQuestions()`. Every read of the question bank goes through this
function; no raw `Question.find()` in the request path.

### Rate Limiting

Add quiz-specific tiers in `backend/src/middlewares/rateLimiters.js`, following the existing pattern (uses the `createRedisStore` factory).

> **[AUDIT] Key on identity, not IP.** The original draft limited by IP. Zuno's own threat model
> (see `PRE_LAUNCH_BLOCKERS.md` C-1) explicitly assumes students on **shared computers and
> networks** — school labs and cyber cafés. A whole class behind one NAT would share a single
> 10/min bucket and start getting 429s while doing exactly what the product wants them to do.
> `supportApiLimiter` already solved this in this same file: key on `userId` when present, fall
> back to IP otherwise. Do the same, and add `guestId` to the fallback chain since quiz is
> guest-capable. Note the global limiter (150 req / 15 min per IP, `app.js:59`) still applies on
> top and is itself IP-keyed — worth watching in a classroom pilot.

```javascript
// Shared identity-aware key: userId → guestId → IP (last resort)
const quizKey = (req) =>
  req.user ? `user_${req.user.id}`
  : req.headers['x-guest-id'] ? `guest_${req.headers['x-guest-id']}`
  : ipKeyGenerator(req.ip);

// Quiz generation — prevent brute-force question harvesting
export const quizGenerateLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 10,                  // 10 quiz generations per minute per student
  keyGenerator: quizKey,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_quiz_gen:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Bahut zyada quiz requests. 1 minute baad try karo.')
    );
  },
});

// Quiz submission — tighter (submitting more than once per session is odd)
export const quizSubmitLimiter = rateLimit({
  windowMs: 10 * 1000,     // 10 seconds
  max: 5,                   // idempotencyKey layer catches dup submits; this is just belt-and-suspenders
  keyGenerator: quizKey,    // [AUDIT] identity-keyed, same reasoning as above
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore('rl_quiz_submit:'),
  handler: (req, res) => {
    res.status(429).json(
      createRateLimitResponse('Ruko thodi der, quiz submit ho raha hai.')
    );
  },
});
```

Wire these in `quiz.routes.js` — `quizGenerateLimiter` on `POST /generate`, `quizSubmitLimiter` on `POST /submit`.

---

## 15. Migration Plan for Existing Users

### Problem

Some users already have chapters with `status: 'completed'` (completed before quiz gate existed). These should NOT be forced to take a quiz retroactively.

### Solution

Existing `completed` chapters are **grandfathered in**:
- `quizGateBestScore: null` + `quizGateAttempts: 0` + `status: 'completed'` = completed before quiz gate existed.
- No migration script needed — the new quiz gate only triggers on fresh `CHAPTER_COMPLETE` events going forward.
- Frontend: chapters with `status: 'completed'` and `quizGateAttempts: 0` show a "Completed" badge, not a "Quiz Passed" badge.
- Optional: show a chip *"Quiz dena chahte ho? (Optional)"* on grandfathered chapters — allowing students to test themselves if they want, but not gating.

---

## 16. Open Product Decisions (Confirm Before Phase 1)

These are the only judgment calls left in the blueprint. Confirm once and this doc has no ambiguity left.

| # | Decision | Recommendation | Impact if changed later |
|---|----------|----------------|--------------------------|
| 1 | Passing threshold for gate quiz | **70%** (7/10) | Trivial — one constant in code |
| 2 | Gate quiz question count | **10** | One constant |
| 3 | Practice chapter-wise question count | **10** | One constant |
| 4 | Mix practice question count | **20** | One constant |
| 5 | ~~Minimum questions per chapter (Phase 1)~~ | **[AUDIT 2026-08-09] SUPERSEDED — see decision 16 below** | — |
| 6 | ~~PYQ vs curated ratio in seed~~ | **[AUDIT 2026-08-09] SUPERSEDED — see decision 16 below** | — |
| 7 | Retry cool-down after fail | **None** (unlimited) | Add rate-limit rule |
| 8 | Weak-topic threshold | **>= 50% wrong AND >= 2 questions on that topic** | One function — **[AUDIT 2026-08-09]** real data has no `topicId` yet (§19), so this threshold cannot actually run until topics are backfilled. Decision stands, just not exercisable on day one. |
| 9 | Grandfathered chapters get optional quiz? | **Yes, show optional "test yourself" chip** | Frontend UX only |
| 10 | ~~Phase 1 pilot chapters~~ | **[AUDIT 2026-08-09] SUPERSEDED — see decision 17 below** | — |
| 11 | Question timer per-quiz? | **No timer** (Bihar Board exam has time limits but our practice tool shouldn't add pressure) | UX + one schema field if changed |

### [AUDIT] Additional decisions surfaced by the 2026-08-02 audit

| # | Decision | Recommendation | Why it needs a call |
|---|----------|----------------|----------------------|
| 12 | Ship the Phase 0 `isComplete` fix as its own commit before any quiz work? | **Yes** | It changes live behaviour (chapters start completing that never did). Bundling it into a quiz commit makes it impossible to roll back independently. |
| 13 | Does `awaiting_quiz` count as "in progress" in the summary API? | **Yes** — count it with `in_progress` | The student's work isn't done. Alternative is a separate `awaitingQuizCount`; either is fine, but frontend and backend must agree. |
| 14 | Where does the Quiz Practice entry point live in the sidebar? | **Rail icon button** (matches how the rail already works) | The old nav-tab strip the draft assumed no longer exists — see §10. |
| 15 | Mix Quiz with a partially-seeded subject | **[AUDIT 2026-08-09] Original call ("serve fewer + `partialBank: true`") stands, but the trigger changed** | Originally worried about only 3 of 16 chapters being seeded. Now all 16 are seeded, but per-chapter counts are uneven (16 to 103 — see §19) — the same `partialBank` mechanism still needs to exist for whichever chapter combination is thin, it just won't fire as often as first thought. |

### [AUDIT 2026-08-09] Decisions superseded by the real question bank (§19)

Decisions 5, 6, and 10 above were written before any real question data existed. The bulk
extraction pipeline (`quiz-phase0.5-bulk`) made them moot — not by answering them differently, but
by making the underlying question no longer apply. Replaced with:

| # | Decision | What actually happened | Anything to confirm? |
|---|----------|-------------------------|------------------------|
| 16 | Minimum questions per chapter / PYQ-vs-curated ratio (was 5 & 6) | Not a decision anymore — it's a measured fact. All 744 usable questions are real PYQs (100%, not 60%); curated/hand-written questions were never built. Per-chapter counts range **16 (biology ch06) to 103 (biology ch01)** — 6 of 16 chapters fall below the old 50-question target (chemistry ch01: 24, biology ch04: 23, biology ch06: 16, physics ch04: 34, physics ch05: 32, biology ch03: 40). | **Yes — one open call:** ship Phase 1 with these real, uneven counts as-is (a 16-question chapter still supports a 10-question gate quiz, just with less variety on repeat attempts), or hold off launch for the thin chapters until more PYQs/curated questions are added? Recommendation: **ship as-is** — 16 is still enough for every quiz type in §2, "less variety on retake" is a minor UX gap not a launch blocker, and this can be revisited per-chapter later without a schema change. |
| 17 | Phase 1 pilot chapters (was 10) | Not applicable — the bulk pipeline extracted and chapter-tagged questions for **all 16 chapters** in one pass, not 3. There is no cheaper "pilot only" version of this work available now; picking 3 chapters would mean *discarding* 2/3 of already-finished work. | **No — recommendation is unambiguous:** seed all 16 chapters in Phase 1. |

If you disagree with any recommendation, tell me before Phase 1 starts — code will bake these in.

---

## 17. Phased Execution Roadmap

Per project guidelines, work proceeds **ONE PHASE PER SESSION**. Each phase ends with the tests specified for it passing, and a commit on a feature branch (never on `main`).

### Phase 0: [AUDIT] Prerequisite — make chapter completion actually fire

**This is not quiz work.** It is a pre-existing bug in shipped code (full analysis in §7) that
the quiz gate cannot be built on top of. It ships on its **own branch, its own commit**, and is
verified before Phase 1 begins, so that a behaviour change to the live app is never entangled
with a new feature.

**Deliverables:**
- `backend/src/ask/step7.saveAndRespond.js` — add `retrievedContext` to the step-5 destructure
  (line ~192) and change `isComplete` (line ~309) to test it directly instead of
  `retrieval?.retrievedContext`, which is permanently `undefined`.

**Verification — must be observed, not assumed:**
- Finish every core topic of one chapter in Focus Mode → `chapter_progress.status` becomes
  `'completed'` in MongoDB (today it silently stays `in_progress`).
- A `chapter_completed` document appears in `study_events` (today it never does).
- Regression: a normal mid-chapter turn still writes progress through
  `upsertChapterProgress` and does **not** mark the chapter complete.

**Existing tests that must still pass:** `test:chunks`, `test:study-map`,
`test:curriculum-resolvers`, `test:chat-db-models`, `test:golden`

**Note on grandfathered data:** students whose chapters were stuck at `in_progress` purely
because of this bug will now complete them going forward. Nothing retroactively repairs old
records — and §15's grandfathering rule still holds, since those chapters have
`quizGateAttempts: 0`.

### Phase 1: Question Models & Seed Data (Backend)

**[AUDIT 2026-08-09] Fully rewritten — see §19 for the full reasoning.** The original plan
(hand-write 50 questions per chapter, 3 pilot chapters only) is replaced: real PYQ data already
exists for all 16 chapters (744 usable questions, branch `quiz-phase0.5-bulk`). Phase 1 is now a
data-migration-and-modeling phase, not a content-authoring one.

**Deliverables:**
- Bring `data/quiz-bank/bank/questions.json` from branch `quiz-phase0.5-bulk` onto this branch
  (the 744-question bulk bank — see §12's "Where the seed files come from")
- `backend/scripts/transform-bulk-to-seed.js` — **one-time** transform script: reads the bulk
  bank, writes the 16 per-chapter seed files below in the §12 format (3-language, `null` for
  `explanation`/`topicId`/`difficulty` since the source has none yet). Not part of the ongoing
  pipeline — runs once, its output is what gets committed and what `quiz:seed` reads from then on.
- `backend/src/models/question.model.js` — Question schema, **3-language fields** (§5)
- `backend/src/models/quizSession.model.js` — QuizSession schema (§5, unchanged from original plan)
- `backend/src/models/quizAttempt.model.js` — QuizAttempt schema (§5, unchanged from original plan)
- 16 seed JSON files, one per chapter, `data/quiz-bank/science/<section>/<chapterId>.json`:
  physics ch01-ch05 (86/48/48/34/32 questions), chemistry ch01-ch05 (24/67/57/50/40), biology
  ch01-ch06 (103/49/40/23/26/16) — exact counts from the real bank, not a hand-picked target
- `backend/scripts/seed-quiz-bank.js` — seed engine (see §12 for behavior)
- npm scripts in `backend/package.json`: `quiz:seed`, `quiz:seed:dry-run`

**Verification:**
- `npm run quiz:seed:dry-run` passes on all 16 seed files
- `npm run quiz:seed` populates DB, indexes visible in Atlas
- Manual query in `mongosh`: `db.question_bank.countDocuments({})` returns **744**
- Manual query in `mongosh`: `db.question_bank.find({ chapterId: 'science.biology.chapter-01' }).count()` returns **103** (largest chapter)
- Manual query in `mongosh`: `db.question_bank.find({ chapterId: 'science.biology.chapter-06' }).count()` returns **16** (smallest chapter — confirms uneven real counts made it through correctly, not silently dropped)

**Existing tests that must still pass:** `test:chunks`, `test:study-map`, `test:curriculum-resolvers`, `test:chat-db-models`

**Still NOT in scope for Phase 1** (unchanged from before, restated for clarity): quiz API/routes/controller (Phase 2), any UI (Phase 4-5), chapter gate integration or `awaiting_quiz` status (Phase 3), the future Question Management API concept (§11 — unscheduled).

### Phase 2: Quiz Engine & APIs (Backend)

**Deliverables:**
- `backend/src/services/quiz.service.js` — generateQuiz, submitQuiz, getHistory, getWeakTopics, option shuffle, Layer 2 selection
- `backend/src/controllers/quiz.controller.js`
- `backend/src/routes/quiz.routes.js` — endpoints from Section 11
- `backend/src/app.js` — register routes
- `backend/src/middlewares/rateLimiters.js` — add `quizGenerateLimiter`, `quizSubmitLimiter`
- Redis caching per Section 14
- `backend/scripts/test-quiz-service.js` — unit tests
- `backend/scripts/test-quiz-api.js` — API integration test that hits live endpoints
- npm scripts: `test:quiz`, `test:quiz-api`

**Non-negotiable acceptance criteria:**
- `generateQuiz` response object contains ZERO of these keys: `correctAnswer`, `explanation`, `shuffledCorrectKey`, `topicId` (topicId is on the question docs but stripped in the response)
- `submitQuiz` scores using `quiz_sessions.servedQuestions[i].shuffledCorrectKey`, never `question.correctAnswer` directly
- Duplicate submit (same `idempotencyKey`, **same identity**) returns the same body without a second DB write
- **[AUDIT]** Same `idempotencyKey` from a *different* identity does **not** return the first student's result (§6 security note)
- **[AUDIT]** Layer 2 seen-set is not filtered by `chapterId` — a question answered correctly in a Mix Quiz is deprioritized in a later chapter quiz too (§4)
- Rate limiter fires at the 11th generate/min **from the same student identity**, and two different students behind one IP do not share a bucket (§14)

**Existing tests that must still pass:** all Phase 1 tests + `test:ask-db`

### Phase 3: Chapter Gate Integration (Backend)

**Deliverables:**
- `backend/src/models/chapterProgress.model.js` — add `'awaiting_quiz'` to status enum, add `quizGateBestScore`, `quizGateAttempts`, `lastQuizAttemptId`
- `backend/src/services/chapterProgress.service.js` — add `setChapterAwaitingQuiz()` helper, extend `claimGuestData()` per Section 9
- `backend/src/ask/step7.saveAndRespond.js` — when `retrievedContext === 'CHAPTER_COMPLETE'`, call `setChapterAwaitingQuiz` instead of `markChapterComplete`
- `quiz.service.js` — implement `handleGateQuizResult` (Section 7) called from submitQuiz for `chapter_gate` type
- Golden test scenarios added: gate flow (complete → awaiting_quiz → pass → completed) and (complete → awaiting_quiz → fail → still awaiting_quiz)

**Prerequisite:** Phase 0 must be merged and verified first — without it the `isComplete` branch
this phase edits never executes and no chapter can ever enter `awaiting_quiz` (§7).

**Non-negotiable acceptance criteria:**
- **[AUDIT]** Finishing a chapter's topics moves it to `awaiting_quiz` — observed in the DB, not inferred. If this fails, re-check Phase 0 before debugging quiz code.
- Existing chapters with `status: 'completed'` and `quizGateAttempts: 0` remain untouched (grandfathered)
- `generateQuiz` with `quizType: 'chapter_gate'` returns 409 if student's chapter is not in `awaiting_quiz` state
- On pass, `chapter_progress.status` transitions to `completed` in the SAME `submitQuiz` transaction (not eventually consistent)
- **[AUDIT]** `GET /api/v1/chapter-progress` summary counts stay correct with `awaiting_quiz` chapters present (§5)

**Existing tests that must still pass:** all previous + `test:golden` + `rag:test-answer`

### Phase 4: Quiz Runner Modal UI (Frontend)

**Deliverables:**
- `frontend/src/api/tutorApi.js` — add `generateQuiz`, `submitQuiz`, `fetchQuizHistory` (axios, not fetch — matches existing api pattern)
- `frontend/src/components/QuizModal.jsx` — one question per screen, progress bar, option buttons, skip button, submit button on last
- `frontend/src/components/QuizResultCard.jsx` — score display, per-question review with explanations, weak topics chip list, retry button (for gate) / close (for practice)
- `frontend/src/components/FocusModal.jsx` — display "Quiz Pending" chip when `chapter_progress.status === 'awaiting_quiz'`
- `frontend/src/pages/ChatPage.jsx` — when API response indicates `chapterStatusAfter === 'awaiting_quiz'`, prompt student to open QuizModal
- Client generates `idempotencyKey` (via `crypto.randomUUID()`) on submit — never re-uses it

**Manual verification:**
- Complete a chapter in Focus Mode → prompt appears → open modal → pass → chapter shows "Completed" → recommendation for next chapter appears
- Fail → weak topics shown → retry button works, generates a new quiz session
- Refresh mid-quiz → modal closes, quiz session left as `pending` in DB (TTL-cleaned in 30 min)

**Frontend build:** `npm run build` from `frontend/` must succeed with zero warnings.

### Phase 5: Standalone Practice Quiz Hub (Frontend)

**Deliverables:**
- `frontend/src/pages/QuizPage.jsx` — three views: subject picker → chapter picker (or "Mix Quiz") → QuizModal
- `frontend/src/components/Sidebar.jsx` — add "Quiz Practice" nav tab, icon
- `frontend/src/App.jsx` — register `/quiz` route
- Quiz history view: list of past attempts (paginated), click to see full result with explanations

**[AUDIT] Decide first:** where the Quiz entry point lives in the redesigned sidebar (§10,
decision #14) — there is no nav-tab strip to add to.

**Manual verification:**
- Navigate to /quiz → pick Science → pick Physics ch01 → 10 MCQs → submit → score shown
- Take Mix Quiz → **[AUDIT]** with only the 3 pilot chapters seeded this yields ~6 questions,
  not 20. Verify the `partialBank: true` path renders honestly and the per-chapter distribution
  matches §2 across the chapters that *are* seeded. The full 20-question check belongs to
  whenever the subject is fully seeded, not Phase 5.
- History view lists attempts, clicking one shows explanations
- Guest path: take a quiz logged out, then register → `claimGuestData` moves the attempts (§9)

### Phase 6: Polish & Analytics (Fullstack)

**Deliverables:**
- **[AUDIT] First:** widen `backend/src/models/studyEvent.model.js` — add the four quiz event
  types to the `eventType` enum and make `chapterId` optional. Without this, every quiz event
  fails schema validation and `logStudyEvent`'s fire-and-forget `.catch()` swallows it, leaving
  analytics silently empty (§10).
- Extend `logStudyEvent` calls for quiz events: `quiz_started`, `quiz_submitted`, `quiz_passed`, `quiz_failed`
- Per-question timing rolled up in an aggregation script for identifying "confusing" questions (weekly cron out of scope, script only)
- Performance audit: seed 800 questions, run 100 concurrent generateQuiz calls, verify p95 < 100ms
- Decide: activate Layer 3 (AI generation with review queue) or defer? Based on usage data from real users. If deferred, this phase ends here.

**Layer 3 (only if activated in Phase 6):**
- `backend/scripts/generate-quiz-candidates.js` (`npm run quiz:generate`)
- `backend/scripts/review-quiz-candidates.js` (`npm run quiz:review`) — CLI tool for developer to approve/reject/edit
- `backend/src/models/questionReviewQueue.model.js`
- Prompt template per Section 4 guardrails

---

## 18. Audit Changelog (2026-08-02)

Every claim in the v1 draft was checked against the live codebase. This is what changed and why.

### Blockers (would have failed silently in production)

| # | Finding | Section | Status |
|---|---------|---------|--------|
| B1 | **The chapter-completion hook is dead code.** `step7.saveAndRespond.js:309` reads `retrieval?.retrievedContext`, but step5 returns `retrievedContext` as a *sibling* of `retrieval` (and sets `retrieval: null` in that very case). `isComplete` is permanently `false`, so `markChapterComplete()` and the `chapter_completed` event never fire. The gate quiz would have been built on an unreachable branch. | §7, §17 | Fixed — new **Phase 0** |
| B2 | **Layer 2 seen-set filtered by `chapterId`**, which `mix_practice` attempts store as `null`. Mix-quiz answers were invisible to chapter quizzes and vice versa. | §4, §5 | Fixed — identity-only query |
| B3 | **Idempotency fast path had no identity filter.** A replayed/guessed `idempotencyKey` returned another student's full graded attempt including the answer key. | §6, §11 | Fixed — identity-scoped lookup |

### Internal contradictions (the doc disagreed with itself)

| # | Finding | Section |
|---|---------|---------|
| C1 | "Server-Side Scoring Only" told the implementer to compare against `question.correctAnswer` — the exact bug Layer 1 exists to prevent, and contrary to Phase 2's own acceptance criteria. | §6 |
| C2 | "No server-side quiz session needed" contradicted §5, §6 and §11, where `quizId` **is** `quiz_sessions._id`. | §8 |
| C3 | `seedKey` declared `unique: true` in the schema but described as needing no unique index in two other places. | §5, §12 |

### Factual mismatches with the codebase

| # | Finding | Section |
|---|---------|---------|
| F1 | `userId` claimed to be `ObjectId` "matching the existing pattern" — every existing collection uses `String`, and controllers pass `req.user?.id` (a string). Also documents the pre-existing `chapterProgress` index bug so it isn't copied. | §5 |
| F2 | curriculum-index has **17** chapters, not 16 — `science.meta.chapter-00` is orientation content that must be excluded from Mix Quiz and seed validation. | §1, §2, §12 |
| F3 | "Add a Quiz Practice nav tab to Sidebar" — that sidebar was redesigned; there is no `navItems` array anymore. | §10, §17 |
| F4 | `studyEvent.eventType` is a strict enum without the quiz events, and `chapterId` is required — quiz analytics would have failed validation and been swallowed by the fire-and-forget `.catch()`. | §10, §17 |
| F5 | Guest identity middleware (`optionalAuth` + `X-Guest-Id`) was never specified for quiz routes. | §10, §11 |

### Gaps closed

`partialBank` behaviour for a partially-seeded Mix Quiz (§2, §11, §17) · Redis question cache
actually wired onto the read path (§4, §14) · `topicTitle` resolution for weak topics (§8, §11) ·
`timeTakenSec` no longer hardcoded to 0 (§6) · `awaiting_quiz` handled in the chapter-progress
summary counts (§5, §10) · rate limiters keyed on student identity instead of IP, since the
product's own threat model assumes shared computers (§14) · redundant `{ guestId, chapterId }`
index dropped (§5) · guest-claim `$unset` vs `$set: null` unified with the existing
`claimGuestData` style (§9).

### Verified correct — do not re-litigate

Chapter/topic ID string formats match `curriculum-index.json` exactly · `claimGuestData` is at
`chapterProgress.service.js:290` and does handle chapter_progress + study_events as described ·
the `step7.saveAndRespond.js` line references (311-317) are accurate · the rate-limiter code
pattern (`createRedisStore`, `createRateLimitResponse`, `passOnStoreError`) matches
`rateLimiters.js` exactly · every npm script named in the phase gates exists in
`backend/package.json` · `buildFilter(userId, guestId, chapterId)` exists as described · the
step7 response already carries a `chapterProgress` snapshot to the frontend, so
`chapterStatusAfter` wiring is realistic · **the Layer 1 shuffle-map persistence design (§4 +
`quiz_sessions`) is correct and is the strongest part of this document.**

---

## 19. Audit Changelog (2026-08-09) — Real question bank supersedes the hand-curation plan

**Context:** everything in this document through §18 was written/audited on 2026-08-02, when no
real quiz question existed anywhere in the project. Between 2026-08-03 and 2026-08-09, a separate
effort on branch `quiz-phase0.5-bulk` (spec: `QUIZ_DATA_PIPELINE.md`) OCR'd and hand-verified all
26 available Bihar Board Class 10 Science papers, 2016 through 2026. That work finished
(`git log quiz-phase0.5-bulk`, commit `7b45b1b`, "Phase 0.5 — human review, golden set, L3+ to
98.5%") **before** this Phase 1 session started. This changelog documents what that means for
every section above.

### What exists now — measured, not estimated

Counted directly from `data/quiz-bank/bank/questions.json` on `quiz-phase0.5-bulk`
(`data.questions`, filtered to `usableInQuiz === true`):

| Metric | Value |
|---|---|
| Total questions extracted (all types) | 1126 |
| Usable as quiz MCQs (`usableInQuiz: true`) | **744** |
| Chapters covered | **16 / 16** (all of them — `science.meta.chapter-00` correctly excluded, matches §1 F2) |
| Answer confidence | 171 human-verified (`L4`), 573 auto-verified via RAG grounding (`L3`) — 0 unverified |
| Languages per question | 3 — `en`, `hi` (Devanagari), `hinglish` — all populated on every usable question |
| Questions with `explanation` text | **0 / 744** |
| Questions with `topicId` | **0 / 744** |
| Questions with `difficulty` tag | **0 / 744** |

Per-chapter breakdown (usable MCQs):

```
physics.chapter-01   86      chemistry.chapter-01   24      biology.chapter-01   103
physics.chapter-02   48      chemistry.chapter-02   67      biology.chapter-02    49
physics.chapter-03   48      chemistry.chapter-03   57      biology.chapter-03    40
physics.chapter-04   34      chemistry.chapter-04   50      biology.chapter-04    23
physics.chapter-05   32      chemistry.chapter-05   40      biology.chapter-05    26
                                                              biology.chapter-06    16
```

### Why this changes Phase 1 specifically (not later phases)

Phase 1's job was always "get questions into MongoDB, in a query-able shape." The original plan
assumed that meant *writing* questions (§3's "50 curated + PYQ" design, §16 decisions 5/6/10). It
now means *importing and reshaping already-extracted* questions. Phases 2 onward (quiz engine,
gate integration, UI) are **unaffected in their own logic** — they consume whatever is in
`question_bank` regardless of how it got there. The only phase-2+ ripple is the response-language
choice noted in the updated §11 (DB now stores 3 languages, API must pick one to serve).

### Every section touched, in one place

| Section | What changed |
|---|---|
| §3 Question Bank Strategy | "2-source" design (PYQ + curated) marked as superseded; Source 2 (curated) never got built and isn't planned; real per-chapter counts documented |
| §5 `question_bank` schema | `questionText`/`options[].text`/`explanation` changed from `String` to `{ en, hi, hinglish }`; `explanation` changed from required to optional; `difficulty` default changed from `'medium'` to `null`; `topicId` stays nullable (no source data yet); seedKey note extended for future single-question inserts |
| §11 API Contract | Added note: `generateQuiz`/`submitQuiz` must pick one language (default `hinglish`) from the now-3-language DB fields before responding — a Phase 2 concern, flagged early; added "Future: Question Management API" concept (unscheduled) for ongoing CRUD on individual questions, addressing how fixes/additions happen after the initial 744-question bulk seed |
| §12 Seed file format | Example rewritten to 3-language shape; added "Where the seed files come from" — the 16 files are the output of a one-time transform script reading the bulk bank, not hand-authored; seed script validation updated to not require `explanation` |
| §16 Open decisions | Decisions 5 (min Qs/chapter), 6 (PYQ/curated ratio), 10 (3 pilot chapters) marked superseded; replaced with decisions 16 (uneven real per-chapter counts — recommend ship as-is, one open call) and 17 (seed all 16 chapters, not 3 — unambiguous) |
| §17 Phase 1 roadmap | Deliverables rewritten: branch merge + one-time transform script + 3 models + 16 real seed files (not 3 hand-written ones) + seed engine; verification queries updated to real counts (744 total, 103 max, 16 min) |

### Still open — needs a call before Phase 1 code starts

**Decision 16** (§16): six chapters land below the old 50-question informal target — chemistry
ch01 (24), biology ch04 (23), biology ch06 (16), physics ch04 (34), physics ch05 (32), biology
ch03 (40). Recommendation is to ship Phase 1 with these real counts as-is; a 16-question chapter
still supports every quiz type in §2, just with less variety across repeat attempts. This is
flagged, not resolved — confirm before Phase 1 implementation begins.

### Gaps carried forward honestly (not fixed by this changelog, just made visible)

`explanation`, `topicId`, and `difficulty` are 0% populated in the real 744-question bank. Phase 1
ships with all three nullable/optional — the quiz UI (Phase 4-5) and weak-topic analysis (§8) must
degrade gracefully when they're absent, not assume they exist. Backfilling them is future work,
most likely through the §11 "Future: Question Management API" once it's built, or another bulk
JSON edit + re-seed pass.
