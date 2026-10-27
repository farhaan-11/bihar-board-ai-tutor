# Quiz System — Build Log

> **Ye living state hai.** Har session ke end mein update hoti hai.
> Rules `QUIZ_EXECUTION_PROTOCOL.md` mein hain · Spec `QUIZ_SYSTEM_BLUEPRINT.md` mein hai
>
> **Ye file hamesha chhoti rahegi.** Purana session history neeche collapse hota jayega.

---

## 📍 ABHI KAHAN HAIN

| | |
|---|---|
| **Current Phase** | **Phase 5** — Practice Quiz Hub (Frontend). Not started yet. |
| **Status** | 🟢 **Phase 4 COMPLETE.** All 3 steps committed (`7f995b8`, `2c2a0ef`, `4c09bb2`). Manual browser click-through done by user — full gate flow (chapter complete → quiz chip → answer → pass → chapter shows completed) confirmed working. UI polish issues found during that test (see Parking Lot P-12) — explicitly deferred, not blocking. Baseline green (`test:chunks`/`test:study-map`/`test:curriculum-resolvers`), re-confirmed at phase close. |
| **Branch** | `quiz-phase4` (Phase 0/1 on `quiz-phase1`, Phase 2 on `quiz-phase2`, Phase 3 on `quiz-phase3`) — Phase 5 will need a new branch |
| **Last session** | 2026-08-14 — Phase 4 closed out: manual browser test confirmed the flow works, UI polish deferred to Parking Lot |

### ⚠️ Read before starting Phase 2 code

Phase 1 field names deviate from `QUIZ_SYSTEM_BLUEPRINT.md` §5/§12 — the user asked for more
human-readable names during Phase 1's Beat 1 review. **The blueprint text itself was not updated**
(out of scope for a Phase 1 session — updating spec docs is not code). Use this mapping, not the
blueprint's literal field names, when writing Phase 2:

| Blueprint name (§5/§12) | Actual field in code |
|---|---|
| `seedKey` | `questionCode` |
| `options[].key` | `options[].label` |
| `correctAnswer` (Question) | `correctOptionLabel` |
| `shuffledCorrectKey` (Session/Attempt) | `correctOptionLabel` (same name everywhere now) |
| `yearAsked` | `askedInYears` |
| `servedQuestions` | `questions` |
| `submittedAttemptId` | `attemptId` |
| `quizSessionId` (Attempt) | `sessionId` |
| `idempotencyKey` | `submissionKey` |
| `*Snapshot` suffixes (`topicIdSnapshot`) | shortened to just `topicId` (context implies snapshot) |

`userId`, `guestId`, `subjectId`, `chapterId`, `topicId` were **not** renamed — kept matching the
app-wide convention from `chapterProgress`/`studyEvent`. Full field-by-field schema for all 3
models is in this session's history entry below.

### ✅ Baseline (established 2026-08-02, before any Phase 0 code)

| Test | Result |
|---|---|
| `test:chunks` | 🟢 PASS (17/17) |
| `test:study-map` | 🟢 PASS |
| `test:curriculum-resolvers` | 🟢 PASS |
| `test:chat-db-models` | 🔴 RED — pre-existing, unrelated (parked P-6) |
| `test:golden` | 🟢 PASS (100% intent accuracy, 34P/6W/0F) — 2 stale fixture bugs fixed first, see below |

---

## 🎯 PHASE 0 — Definition of Done

> Full analysis: `QUIZ_SYSTEM_BLUEPRINT.md` §7 · Phase spec: §17 Phase 0
> **Ye quiz feature nahi hai** — ye shipped code ka ek bug hai jiske bina quiz gate ban hi nahi sakta.

**Blast radius — sirf ye file:**
- `backend/src/ask/step7.saveAndRespond.js`

**Code:**
- [x] Line ~192: step-5 destructure mein `retrievedContext` add kiya
- [x] Line ~309: `isComplete` ab `retrievedContext === 'CHAPTER_COMPLETE'` test karta hai

**Verify (dekha gaya, maana nahi gaya):**
- [x] Real DB test: chapter ke last topic pe seed karke NEXT_STEP call kiya → `chapter_progress.status` = `'completed'` bana, `progressPercent` = 100
- [x] `study_events` mein `chapter_completed` document confirm hua
- [x] Regression: mid-chapter (first topic pe) NEXT_STEP call kiya → status `'in_progress'` hi raha, `currentTopicId` sahi se agle topic pe advance hua, koi galat `chapter_completed` event nahi bana

**Regression:**
- [x] `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — sab waise hi jaise baseline mein the
- [x] `npm run test:golden` — 33P/7W/0F, 100% intent accuracy (baseline: 34P/6W/0F, same 0 FAIL, same 100%). Fark sirf 1 query PASS→WARN, wo LLM phrasing variance hai, intent bug nahi.

**Bahar — is phase mein ye NAHI karenge:**
- ❌ Koi quiz model / route / seed file — wo Phase 1 hai
- ❌ `awaiting_quiz` status add karna — wo Phase 3 hai
- ❌ `chapterProgress` ka `user_chapter_unique` index bug — 🅿️ parked (P-1)
- ❌ Purane stuck `in_progress` chapters ko retroactively theek karna — grandfathering rule chalega (blueprint §15)

---

## 🎯 PHASE 1 — Definition of Done

> Full plan: `QUIZ_SYSTEM_BLUEPRINT.md` §19 · Phase spec: §17 Phase 1

**Blast radius:**
- `backend/scripts/transform-bulk-to-seed.js` (new)
- `backend/scripts/seed-quiz-bank.js` (new)
- `backend/src/models/question.model.js`, `quizSession.model.js`, `quizAttempt.model.js` (new)
- `data/quiz-bank/science/**/*.json` (16 new seed files)
- `backend/package.json` (`quiz:seed`, `quiz:seed:dry-run`)

**Code:**
- [x] Bulk bank (`data/quiz-bank/bank/questions.json`) brought onto `quiz-phase1` from `quiz-phase0.5-bulk`
- [x] Transform script written — bulk → 16 per-chapter seed files, human-readable field names (see mapping table above)
- [x] 3 Mongoose models written with field names finalized after user review
- [x] Seed engine written — validate (localized text, 4 unique A-D labels, correctOptionLabel matches, real+browsable chapterId, valid topicId if present, no duplicate questionCode) then upsert by questionCode, deactivate anything dropped from seed set

**Verify (dekha gaya, maana nahi gaya):**
- [x] `quiz:seed:dry-run` — 16 files, 743 questions, 0 errors
- [x] `quiz:seed` — 743 inserted, 0 updated, 0 deactivated
- [x] `Question.countDocuments({})` = 743, `isActive: true` count = 743
- [x] `chapterId: 'science.biology.chapter-01'` = 103 (max), `chapterId: 'science.biology.chapter-06'` = 16 (min)
- [x] 16 distinct `chapterId` values in DB
- [x] Sample document shape correct (4 options, `createdBy: 'seed-script'`, timestamps present)

**Regression:**
- [x] `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — same as baseline
- [x] `test:chat-db-models` — same pre-existing red (P-6), unrelated

**Bahar — is phase mein ye NAHI kiya:**
- ❌ Quiz API/routes/controller — Phase 2
- ❌ Koi UI — Phase 4/5
- ❌ Chapter gate / `awaiting_quiz` — Phase 3
- ❌ `explanation`, `topicId`, `difficulty` backfill — data mein nahi hai abhi, sab `null` seeded
- ❌ Redis quiz-cache clearing in seed script (blueprint §12 step 5) — 🅿️ parked (P-7), cache infra khud Phase 2 mein banegi

---

## 🎯 PHASE 2 — Checkpoint 1/4: `POST /quiz/generate`

> Full plan discussed live in-session (not pre-written in blueprint §17 at this granularity).
> Blueprint §11 assumed a single-language response — **superseded below.**

**[BUG FOUND + FIXED during Postman verification]** Response's `text` objects (`questionText`
and every `options[].text`) leaked Mongoose's auto-generated subdocument `_id` — e.g.
`"text": {"en": "...", "hi": "...", "hinglish": "...", "_id": "6a78..."}`. Root cause:
`toClientQuestion`/`applyOptionOrder` forwarded the localized-text subdocument as-is instead of
picking only `en`/`hi`/`hinglish` off it — the "whitelist, never blacklist" rule from Checkpoint
1's design was stated but not actually followed for this one field. Fixed with a
`pickLocalizedText()` helper in `optionShuffler.js`, used by both `toClientQuestion` and
`applyOptionOrder`. Not a security leak (no secret data), but real response-shape noise that
went to production shape without this fix. `test-quiz-generate.js` now also asserts no literal
`"_id"` key appears anywhere in the response. Re-verified green after the fix, both via the
automated test and manually in the user's own Postman workspace.

**[SUPERSEDES blueprint §11 for this endpoint]** Blueprint said server picks one language
(default hinglish) before responding, session stores flat `{label, text}` options. User's language-toggle
requirement (client picks language, no re-fetch) makes that impossible — a session that only remembers
hinglish text can't serve English later. **New design:** server sends all 3 languages in every response;
`quiz_sessions.questions[]` stores `optionOrder` (label array) instead of full text — language-independent,
~90% smaller, no text-comparison risk. `quizSession.model.js` changed with user's explicit permission
(model was empty, zero-cost to change).

**Blast radius:**
- `backend/src/models/quizSession.model.js` (`options[]` → `optionOrder[]`, `questionVersionSnapshot` → `questionVersion`)
- `backend/src/services/quiz/optionShuffler.js`, `questionSelector.js`, `quizGenerator.js` (new)
- `backend/src/controllers/quiz.controller.js`, `backend/src/routes/quiz.routes.js` (new)
- `backend/src/constants/quizConstants.js`, `backend/src/utils/quizResponse.js` (new)
- `backend/src/app.js` (route registered), `backend/src/middlewares/rateLimiters.js` (`quizGenerateLimiter`)
- `backend/scripts/test-quiz-generate.js` (new), `backend/package.json` (`test:quiz-generate`)

**Code:**
- [x] `quizSession.model.js` — `optionOrder`/`questionVersion` rename
- [x] `optionShuffler.js` — `shuffle()`, `shuffleOptions()`, `applyOptionOrder()`, `isQuestionUsable()` — pure functions
- [x] `questionSelector.js` — covered-index candidate query, seen-set aggregation (identity-only, no chapterId filter — §4 audit), chapter selection, mix-quiz proportional-with-baseline-1 distribution
- [x] `quizGenerator.js` — orchestrates all 3 `quizType`s, persists `QuizSession`
- [x] `quiz.controller.js` — identity extraction (mirrors `chapterProgress.controller.js`), validation
- [x] `quiz.routes.js` — `POST /generate`, `optionalAuth` + `quizGenerateLimiter`
- [x] `quizResponse.js` — whitelist-based client shape (never blacklist)
- [x] `rateLimiters.js` — `quizGenerateLimiter`, 10/min, keyed by identity not IP

**Verify (dekha gaya, maana nahi gaya):**
- [x] `chapter_practice` → 10 questions, every `text`/`option.text` carries `en`+`hi`+`hinglish`
- [x] Response JSON string-searched — zero occurrences of `correctOptionLabel`/`explanation`/`topicId`/`optionOrder`
- [x] `mix_practice` → 20 questions across >1 chapter, `science.meta.chapter-00` excluded (0 seeded questions there → natural 404 if ever targeted directly)
- [x] Repeated `generate` → at least one question's `optionOrder` differs (shuffle proof)
- [x] DB `correctOptionLabel` manually mapped back to `Question.correctOptionLabel` — same option, different position
- [x] Guest without `X-Guest-Id` → `400` (real HTTP test)
- [x] Fake `chapterId` → `404`; unseeded `science.meta.chapter-00` → `404`
- [x] `chapter_gate` on non-`awaiting_quiz` chapter → `409` (expected permanently until Phase 3)
- [x] Rate limit: 11th request in 1 min → `429`; second identity same window → own bucket, `200` (real HTTP test)
- [x] **Postman manual test** (real requests from user's own Postman workspace, not curl) — Scenario 1 (no identity → `400`) and Scenario 2 (`chapter_practice` happy path → `200`, 10 questions) both run and confirmed by user

**Regression:**
- [x] `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — green, same as Phase 1 baseline

**Bahar (Checkpoint 1 mein NAHI):**
- ❌ Submit API — Checkpoint 2
- ❌ History APIs — Checkpoint 3, 4
- ❌ Redis cache for question reads — parked (P-7), current queries are index-covered and fast without it
- ❌ `awaiting_quiz` status enum — Phase 3 (this is *why* `chapter_gate` always 409s right now — expected)
- ❌ Any frontend — Phase 4/5
- ❌ `studyEvent` logging for quiz — Phase 6

---

## 🎯 PHASE 2 — Checkpoint 2/4: `POST /quiz/submit`

**Blast radius:**
- `backend/src/services/quiz/quizSubmitter.js` (new)
- `backend/src/controllers/quiz.controller.js`, `backend/src/routes/quiz.routes.js` (edit)
- `backend/src/utils/quizResponse.js` (`toSubmitResultQuestion`, `toSubmitResponse` added)
- `backend/src/constants/quizConstants.js` (`PASS_PERCENTAGE`, `MAX_TIME_TAKEN_SEC` added)
- `backend/src/middlewares/rateLimiters.js` (`quizSubmitLimiter` added)
- `backend/scripts/test-quiz-submit.js` (new), `backend/package.json` (`test:quiz-submit`)

**Code:**
- [x] `quizSubmitter.js` — idempotency fast path, atomic session lock (`pending`→`submitted`), scoring against `session.questions[i].correctOptionLabel` (never `Question.correctOptionLabel`), E11000 race handling, `attemptId` link-back to session
- [x] `quiz.controller.js` — `submitQuizController`: identity + `quizId`/`submissionKey`/`answers` shape validation
- [x] `quiz.routes.js` — `POST /submit`, `quizSubmitLimiter`
- [x] `quizResponse.js` — `toSubmitResultQuestion` (options in served order + explanation, whitelist-based), `toSubmitResponse`
- [x] `rateLimiters.js` — `quizSubmitLimiter`, 10/min per identity (same keying as generate)

**Verify (dekha gaya, maana nahi gaya) — all via `test:quiz-submit`, real DB, 17/17 green:**
- [x] All-correct submission → score 10/10, percentage 100, every result `isCorrect: true`
- [x] `passed` is `null` for `chapter_practice` (gate-only field)
- [x] Result options re-labeled A-D in the SAME order the student was served (session `optionOrder`, not DB order)
- [x] Every result carries `text` + `explanation` (absent at generate time, present only here)
- [x] Idempotency: same `submissionKey` resubmitted → same `attemptId`, original `timeTakenSec` wins, exactly 1 `QuizAttempt` doc exists
- [x] New `submissionKey` on an already-submitted session → `409`
- [x] Wrong identity on someone else's `quizId` → `404`
- [x] Fake `quizId` → `404`
- [x] Mixed correct/wrong/skipped answers → exact expected score; skipped → `selectedOption: null`, `isCorrect: false`
- [x] Absurd `timeTakenSec` (999999999) → clamped to 3-hour max, no crash

**[BUG FOUND + FIXED during post-implementation code review]** Concurrent requests carrying the
SAME `submissionKey` (double-click, network retry) raced the session lock: the loser read
`status: 'submitted'` (the winner had just flipped it) and threw a plain `409`, even though it
was the identical submission, not a genuine conflict — violating the idempotency contract
`QUIZ_SYSTEM_BLUEPRINT.md` §6 explicitly requires ("second attempt gets... the original
attempt's result", not a bare error). Confirmed with a real concurrent-request test
(`Promise.allSettled`, same `submissionKey`, same `quizId`) before fixing — reproduced 1/1.
**Fix:** before throwing 409, a short bounded poll (`findRacedAttempt`, up to 4 tries / 75ms
apart) checks whether the winner's `QuizAttempt` has committed yet; if so, its result is
returned (200) instead of an error. Narrows the race window from "the whole request" down to
"the DB round-trip between lock and create" — not a mathematical guarantee under extreme
scheduling delay, but covers the realistic case. Re-ran the same concurrent test 5/5 rounds
after the fix — all passed (same `attemptId` both sides, exactly 1 `QuizAttempt` created). Data
integrity was never at risk (no duplicate attempts in either version) — this was a client-facing
false-error bug only.

**Regression:**
- [x] `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — green, same as Checkpoint 1 baseline

**Bahar (Checkpoint 2 mein NAHI):**
- ❌ `handleGateQuizResult` / `ChapterProgress` update on gate-quiz pass — Phase 3 (code has a comment marking exactly where it plugs in)
- ❌ History APIs — Checkpoint 3, 4
- ❌ Postman manual verification — code + automated DB test done, Postman scenarios for this endpoint not yet run
- ❌ Any frontend — Phase 4/5
- ❌ Fix for P-11 (found during this checkpoint, not blocking) — see Parking Lot

---

## 🎯 PHASE 2 — Checkpoint 3/4: `GET /quiz/history`

**Blast radius:**
- `backend/src/services/quiz/quizHistoryService.js` (new)
- `backend/src/controllers/quiz.controller.js`, `backend/src/routes/quiz.routes.js` (edit)
- `backend/src/utils/quizResponse.js` (`toHistoryListItem`, `toHistoryListResponse` added)
- `backend/src/constants/quizConstants.js` (`HISTORY_DEFAULT_LIMIT`, `HISTORY_MAX_LIMIT` added)
- `backend/src/middlewares/rateLimiters.js` (`quizHistoryLimiter` added)
- `backend/scripts/test-quiz-history.js` (new), `backend/package.json` (`test:quiz-history`)

**Code:**
- [x] `quizHistoryService.js` — `getQuizHistory()`: cursor-based pagination (`createdAt` cursor, `$lt`), identity filter, optional `quizType`/`chapterId` filters, `hasMore`/`nextCursor` via fetch-one-extra pattern
- [x] `quiz.controller.js` — `historyListController`: identity check, `quizType` validation, cursor date validation, limit clamp
- [x] `quiz.routes.js` — `GET /history`, `quizHistoryLimiter`
- [x] `quizResponse.js` — `toHistoryListItem` (whitelist: attemptId/quizType/subjectId/chapterId/chapterIds/score/totalQuestions/percentage/passed/timeTakenSec/createdAt — never `answers`/`submissionKey`/`sessionId`/`userId`/`guestId`), `toHistoryListResponse`
- [x] `rateLimiters.js` — `quizHistoryLimiter`, 30/min per identity (more generous than generate/submit — read-only)

**[BUG FOUND + FIXED during post-implementation code review]** Two bugs found reviewing the fresh
code, same pattern as Checkpoint 2's race-condition review. **User said fix both in this
checkpoint** (not parked):
1. **Limit clamp gap** — `parseInt(rawLimit) || HISTORY_DEFAULT_LIMIT` only falls back on `0`/`NaN`;
   a negative value like `-5` is truthy in JS and passed through unclamped. Confirmed live against
   MongoDB: `.limit(-4)` doesn't throw, just quietly returns fewer docs — but the service's own
   `hasMore = docs.length > limit` (`1 > -5` = always true) and `docs.slice(0, limit)`
   (`slice(0, -5)` on a short array = empty) combined to produce a broken response shape:
   `{ attempts: [], hasMore: true, nextCursor: null }`. Fixed with an explicit `Math.max(..., 1)`
   floor in the controller.
2. **`chapterId` filter missed `mix_practice` attempts** — `QuizAttempt` stores the chapter in
   `chapterId` for `chapter_gate`/`chapter_practice` but in `chapterIds[]` for `mix_practice`
   (`chapterId` is `null` there). The filter only checked `chapterId`, so a chapter-scoped history
   view would silently omit mix-quiz attempts that covered that chapter — no error, just an
   incomplete list. Fixed with `$or: [{ chapterId }, { chapterIds: chapterId }]`.

Both fixes covered by new assertions in `test:quiz-history` (limit-clamp formula check for
`-5`/`0`/`9999`/garbage/missing; a real `mix_practice` attempt created and found via the
`chapterIds[]` path).

**Verify (dekha gaya, maana nahi gaya) — all via `test:quiz-history`, real DB, 21/21 green:**
- [x] Happy path: 3 attempts seeded → all 3 returned, newest first
- [x] Pagination: `limit=2` across 3 attempts → page 1 has 2 + `hasMore: true` + `nextCursor`; page 2 (with cursor) has the remaining 1 + `hasMore: false`
- [x] `chapterId` filter → only matching-chapter attempts returned
- [x] `chapterId` filter also matches `mix_practice` attempts via `chapterIds[]` (bug fix coverage)
- [x] `quizType` filter → only matching-type attempts returned
- [x] Identity isolation → unrelated guest sees 0 attempts (no error)
- [x] Empty history → clean `{ attempts: [], hasMore: false, nextCursor: null }`, no crash
- [x] Response shape → `passed` correctly `null` for `chapter_practice`; zero leak of `answers`/`submissionKey`/`sessionId`/`userId`/`guestId`
- [x] Limit clamp formula → negative/zero/oversized/garbage/missing all resolve to a safe positive value (bug fix coverage)

**Regression:**
- [x] `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — green, same as Checkpoint 2 baseline
- [x] `test:chat-db-models` — same pre-existing red (P-6), unrelated

**Bahar (Checkpoint 3 mein NAHI):**
- ❌ Detail endpoint (`GET /history/:attemptId`, full `results`/`answers`) — Checkpoint 4
- ❌ Chapter title enrichment in response — frontend resolves via curriculum index (existing pattern), history only returns `chapterId`
- ❌ Postman manual verification — automated DB test done, Postman scenarios not created this session
- ❌ Guest-to-user history migration on claim — out of scope, `QuizAttempt` has no TTL so it's naturally preserved, migration itself is a future/unscheduled concern
- ❌ Redis caching — parked (P-7)
- ❌ Any frontend — Phase 4/5

---

## 🎯 PHASE 2 — Checkpoint 4/4: `GET /quiz/history/:attemptId`

> Full plan discussed live in-session, deep line-by-line audit of Checkpoints 1-3 done first (payload,
> response shape, flow, hidden challenges, robustness checklist) — approval taken before code.

**Blast radius:**
- `backend/src/services/quiz/quizHistoryService.js` (edit — `getQuizAttemptDetail()` added)
- `backend/src/services/quiz/quizSubmitter.js` (edit — `fetchQuestionsById` exported for reuse, no logic change to the export itself)
- `backend/src/controllers/quiz.controller.js`, `backend/src/routes/quiz.routes.js` (edit)
- `backend/src/utils/quizResponse.js` (`toAttemptDetailResponse` added)
- `backend/src/middlewares/rateLimiters.js` — **reused** `quizHistoryLimiter`, no new limiter
- `backend/scripts/test-quiz-history-detail.js` (new), `backend/package.json` (`test:quiz-history-detail`)

**Code:**
- [x] `quizHistoryService.js` — `getQuizAttemptDetail()`: identity-checked `QuizAttempt.findOne()`, question content fetch (reused `fetchQuestionsById` from `quizSubmitter.js`), session lookup for served option order (same TTL-expiry fallback rule as submit's replay path), result-shaping via **reused** `toSubmitResultQuestion()` — no new question-rendering logic written, only new orchestration
- [x] `quiz.controller.js` — `historyDetailController`: identity + `mongoose.isValidObjectId(attemptId)` validation, single generic `404` whether the attempt doesn't exist or isn't owned (never distinguishes, matches submit's IDOR-safe pattern)
- [x] `quiz.routes.js` — `GET /history/:attemptId`, reuses `quizHistoryLimiter`
- [x] `quizResponse.js` — `toAttemptDetailResponse()` (whitelist: same top-level fields as `toHistoryListItem` plus full `results[]`)

**[BUG FOUND + FIXED during post-implementation code review]** While writing `getQuizAttemptDetail()`'s
defensive missing-question guard (a question could theoretically be missing from `Question.find()` if
ever hard-deleted — never happens via the seed script, only `isActive: false`, but not physically
impossible), review of the **existing** `quizSubmitter.js:buildResponseForExistingAttempt()` (submit's
idempotent-replay path, near-identical logic reused via `toSubmitResultQuestion`) found it had **no such
guard** — `question.options.map(...)` would throw `TypeError` on a missing question instead of degrading
gracefully. Pre-existing gap, not introduced this checkpoint, found only because this checkpoint's fresh
eyes were on the same code path. **User said fix it in this checkpoint.** Fixed with the same
`if (!question) return null` + `.filter(Boolean)` pattern now used in `getQuizAttemptDetail()`. Re-ran
`test:quiz-submit` (16/16), `test:quiz-history` (21/21), `test:quiz-history-detail` (24/24), and the
baseline suite — all green, no regression from the fix.

**Verify (dekha gaya, maana nahi gaya) — all via `test:quiz-history-detail`, real DB, 24/24 green:**
- [x] Happy path: full attempt detail returned, `score`/`percentage`/`totalQuestions` match the submit response, `results.length === totalQuestions`
- [x] Every result carries `text`, 4 `options`, `selectedOption`, `correctOption`, `isCorrect`, `explanation`, `timeSpentMs`
- [x] `passed` is `null` for `chapter_practice` (gate-only field, same contract as submit/history-list)
- [x] Mixed correct/wrong/skipped answers all reflected correctly in `results[]`
- [x] Sensitive field leak check — zero occurrences of `userId`/`guestId`/`submissionKey`/`sessionId`/raw `correctOptionLabel` key in the response
- [x] Wrong identity on someone else's `attemptId` → service returns `null` (controller maps to generic `404`, no existence leak)
- [x] Fake `attemptId` → `null` → `404`
- [x] `mix_practice` attempt → `chapterId: null`, `chapterIds[]` populated on the detail response

**Regression:**
- [x] `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — green, same as Checkpoint 3 baseline
- [x] `test:chat-db-models` — same pre-existing red (P-6), unrelated
- [x] `test:quiz-submit` (16/16) and `test:quiz-history` (21/21) re-run after the bug fix — both still fully green

**Bahar (Checkpoint 4 mein NAHI):**
- ❌ Postman manual verification — automated DB test done, Postman scenarios not created this session
- ❌ Refactor to fully de-duplicate `buildResponseForExistingAttempt()` (submit) and `getQuizAttemptDetail()`
  (history detail) — both now share `fetchQuestionsById` and `toSubmitResultQuestion`, but the outer
  orchestration (~15 lines: session lookup, option-order fallback, map-and-filter) is still near-identical
  between the two. Not extracted to a shared helper — would touch `quizSubmitter.js` further beyond this
  checkpoint's declared scope. Flagged as a future cleanup, not a bug.
- ❌ Redis caching — parked (P-7)
- ❌ Any frontend — Phase 4/5
- ❌ `studyEvent` logging for quiz — Phase 6

**🎉 Phase 2 (Quiz Engine & APIs) is now fully complete — all 4 checkpoints built, DB-verified, and
regression-clean.**

---

## 🎯 PHASE 3 — Chapter Gate Integration

> Depends on Phase 0 (dead `CHAPTER_COMPLETE` branch fix — already done) and Phase 2 (submit API).
> Done in 3 steps within one continuous session, committed separately per step.

**Blast radius:**
- `backend/src/models/chapterProgress.model.js` (`awaiting_quiz` added to status enum, 3 quiz-gate fields added)
- `backend/src/services/chapterProgress.service.js` (`setChapterAwaitingQuiz`, `recordGateQuizResult` added; `claimGuestData` extended)
- `backend/src/ask/step7.saveAndRespond.js` (edit — `markChapterComplete` → `setChapterAwaitingQuiz`)
- `backend/src/services/quiz/quizSubmitter.js` (edit — `handleGateQuizResult` added, wired into `submitQuiz`)
- `backend/src/controllers/chapterProgress.controller.js` (edit — summary count + recommendation branch)
- `backend/scripts/test-quiz-gate.js` (new), `backend/package.json` (`test:quiz-gate`)

### Step 1 — `7120f87` — Model groundwork
**Code:**
- [x] `chapterProgress.model.js` — `status` enum gets `awaiting_quiz` (between `in_progress` and `completed`)
- [x] 3 new fields: `quizGateBestScore` (default `null`), `quizGateAttempts` (default `0`), `lastQuizAttemptId` (→ `QuizAttempt._id`)
- [x] `chapterProgress.service.js` — `setChapterAwaitingQuiz(userId, guestId, chapterId)`: guarded `findOneAndUpdate` that only transitions FROM `in_progress`; if chapter is already `awaiting_quiz`/`completed` (e.g. student revisits last topic and `CHAPTER_COMPLETE` refires), it's a no-op — returns current state unchanged instead of clobbering it

### Step 2 — `ccc5dd3` — Wire the gate into the completion + submit flow
**Code:**
- [x] `step7.saveAndRespond.js:309` — `CHAPTER_COMPLETE` now calls `setChapterAwaitingQuiz` instead of `markChapterComplete`; chapter no longer auto-completes on last topic
- [x] `chapterProgress.service.js` — `recordGateQuizResult(userId, guestId, chapterId, { attemptId, percentage, passed })`: always bumps `quizGateAttempts` (+1) and raises `quizGateBestScore` (`Math.max`, never lowered); on `passed` also sets `status: 'completed'`, `completedAt`, `progressPercent: 100` in the same write; on fail, status is left untouched (stays `awaiting_quiz` — unlimited retries, no cooldown)
- [x] `quizSubmitter.js` — `handleGateQuizResult()` added, called from `submitQuiz` only when `session.quizType === 'chapter_gate'` (never for `chapter_practice`/`mix_practice`); fire-after-create (not inside the `QuizAttempt` write) — attempt is the source of truth, `ChapterProgress` is a derived projection, so a failure here would leave scoring correct and only the gate bookkeeping stale (self-heals on next attempt)

**Verify (dekha gaya, maana nahi gaya) — real DB, described in commit message:**
- [x] Pass → `ChapterProgress.status` becomes `completed`
- [x] Fail → stays `awaiting_quiz`, best score never lowered by a worse later attempt
- [x] `chapter_practice` submit leaves `ChapterProgress` completely untouched
- [x] Baseline + golden suite green, no regression

### Step 3 — `2789ee1` — Summary/recommendation fixes + guest claim + gate test
**Code:**
- [x] `chapterProgress.controller.js` — `listChapterProgressController`'s summary: `inProgressCount` now counts `in_progress` **or** `awaiting_quiz` (a chapter waiting on its gate quiz is still "in progress" from the student's point of view, not invisible)
- [x] `chapterProgress.controller.js` — `buildRecommendation()` gets an `awaiting_quiz` branch: `action: 'quiz_gate'`, Hinglish message telling the student to take the gate quiz (70%+ to pass), instead of silently falling through to the `in_progress` "continue studying" message
- [x] `chapterProgress.service.js` — `claimGuestData()` extended: quiz-gate fields (`quizGateBestScore`/`quizGateAttempts`/`lastQuizAttemptId`) merge independently of the topic-progress "winner" pick — best score = `max`, attempts = `sum`, `lastQuizAttemptId` taken from whichever side has the higher best score (never lost just because the other side was further along on topics)
- [x] `claimGuestData()` — `QuizAttempt` docs reassigned `guestId → userId` (permanent history, always transferred); pending `QuizSession` docs also reassigned (rare — usually TTL-expired before claim happens)
- [x] `test-quiz-gate.js` (`npm run test:quiz-gate`) — new real-DB regression test, chosen over golden-set scenarios because golden tests LLM intent classification and doesn't fit DB-state gate-flow verification

**Verify (dekha gaya, maana nahi gaya) — all via `test:quiz-gate`, real DB, 28/28 green:**
- [x] `setChapterAwaitingQuiz`: `in_progress` → `awaiting_quiz`, `quizGateAttempts` starts at 0
- [x] Re-trigger guard: calling it again on an already-`awaiting_quiz` chapter is a no-op
- [x] `generateQuiz(chapter_gate)` succeeds once chapter is `awaiting_quiz`; still `409`s on a non-`awaiting_quiz` chapter
- [x] Gate pass: all-correct submit → `passed: true`, `ChapterProgress.status` → `completed`, `quizGateBestScore` = 100, `quizGateAttempts` = 1, `completedAt` set, `lastQuizAttemptId` points to this attempt
- [x] Gate fail: all-wrong submit (after resetting to `awaiting_quiz`) → `passed: false`, status stays `awaiting_quiz`, `quizGateAttempts` = 2, best score still 100 (not lowered by the worse attempt)
- [x] `chapter_practice` submit → `passed: null`, `ChapterProgress` completely unchanged (attempts count, status both untouched)
- [x] Summary logic: `awaiting_quiz` chapter + `in_progress` chapter both count toward `inProgressCount` (2)
- [x] `claimGuestData` merge branch (both guest + user have a doc on the same chapter): `quizGateBestScore` = `max(guest 100, user 40)` = 100; `quizGateAttempts` = `sum(guest 2 + user 3)` = 5; `lastQuizAttemptId` = the higher-best-score side's own last attempt (not "the pass attempt" specifically)
- [x] `claimGuestData`: guest-side `ChapterProgress` doc deleted after merge; `QuizAttempt` docs reassigned to `userId` with `guestId: null`

**Regression:**
- [x] Baseline suite green, no regression (per commit message)

**Bahar (Phase 3 mein NAHI):**
- ❌ Postman manual verification — real-DB script (`test:quiz-gate`) used instead, same rationale as skipping golden-set for this phase
- ❌ Any frontend — Phase 4/5
- ❌ `studyEvent` logging specific to gate pass/fail (beyond the existing `chapter_completed` event already logged in step7) — Phase 6
- ❌ P-1/P-9 index bug fix (flagged as relevant to the gate's query in Checkpoint 1's audit) — still parked, no visible failure caused by it in this phase

**🎉 Phase 3 (Chapter Gate Integration) is now fully complete — all 3 steps built, committed, and
DB-verified.** Next is Phase 4 (Quiz runner modal UI, frontend).

---

## 🅿️ PARKING LOT

> Yahan sab real cheezein hain. **Koi bhoolegi nahi.** Bas abhi nahi hongi.
> Rule: sirf 🔴 blocker hi turant fix hota hai — baaki sab yahan aata hai.
> Clear kab: phases ke **beech mein**, dedicated session mein.

| # | Kya | Kahan | Mila kab | Priority |
|---|---|---|---|---|
| P-1 | `chapterProgress` ka `user_chapter_unique` index **kuch enforce nahi karta** — field `String` hai par partial filter `$type: 'objectId'` check karta hai, jo kabhi match nahi karega. Matlab logged-in users ke liye per-chapter uniqueness DB level pe hai hi nahi. | `backend/src/models/chapterProgress.model.js:75-82` | 2026-08-02 audit | 🟠 Medium — real bug, par aaj tak visible failure nahi |
| P-2 | `CLAUDE.md` mein chapter counts galat hain — likha hai biology 4 / chemistry 5 / physics 7. Asli: **biology 6 / chemistry 5 / physics 5** (total 16 sahi hai, split galat hai). | `CLAUDE.md` folder structure section | 2026-08-02 audit | 🟢 Low — doc only |
| P-3 | `OUT_OF_CONTEXT` intent `maxTokens: 100` pe chalta hai; ek measured redirect ne 78 output tokens use kiye. Thoda lamba redirect JSON truncate kar sakta hai → parse error → student ko "Thodi technical dikkat aayi". | `backend/src/ask/intentRouter.js` | Hinglish fix investigation | 🟠 Medium — rare par student-facing |
| P-4 | Email provider abhi Nodemailer (SMTP) hai; Render free tier SMTP block karta hai, isliye email verification bypass hai. Resend API pe migrate karna hai. | `backend/src/auth/emailHelpers.js` | `PRE_LAUNCH_BLOCKERS.md` P1 | 🔴 High — par real users se pehle, quiz se independent |
| P-5 | 5 local branches (`logo`, `profile`, `feat/support-page`, `global`, `codex-curriculum-resolvers`) already `main` mein merged hain — sirf local pointer clutter hai, delete kiya ja sakta hai. | git | 2026-08-02 audit | 🟢 Low — housekeeping |
| P-6 | `test:chat-db-models` crash karta hai — `src/models/chatState.model.js` dhundhta hai jo exist nahi karti. Pre-existing (archived `PROBLEMS.md` STB-008 note ke mutabik: `chatState` purane refactor mein `chatSession` ke andar embed hua, script kabhi update nahi hui). Phase 0 baseline mein red mila, isse Phase 0 se unrelated maan ke park kiya. | `backend/scripts/test-chat-db-models.js` | Phase 0 baseline, 2026-08-02 | 🟡 Medium — ek regression test permanently disabled jaisa hai |
| P-7 | Seed script Redis quiz-cache clear nahi karta (`quiz:questions:*`) — blueprint §12 step 5 mein hai, par abhi koi cache key exist hi nahi karti (Phase 2 mein cache layer banegi). User-confirmed deferral. | `backend/scripts/seed-quiz-bank.js` | Phase 1, 2026-08-09 | 🟢 Low — Phase 2 mein cache banate waqt add karna |
| P-8 | Question bank mein near-duplicate questions ho sakte hain — Phase 1 ka dedup sirf `questionCode` se hua, text se nahi. Ek hi PYQ alag saal mein thodi alag wording ke saath aaya ho to dono ek quiz mein aa sakte hain. | `backend/scripts/transform-bulk-to-seed.js` | Checkpoint 1 audit, 2026-08-09 | 🟢 Low — data-quality, functional bug nahi |
| P-9 | `chapterProgress` ka P-1 index bug (`user_chapter_unique` kabhi enforce nahi karta) `chapter_gate` ke gate-check query ko bhi index se vanchit karta hai — partial filter `$type: 'objectId'` kabhi match nahi hota. Guest path theek hai (guest index sahi bana hai). 16 chapters pe impact negligible. | `backend/src/models/chapterProgress.model.js:75-82` | Checkpoint 1 audit, 2026-08-09 | 🟡 Medium — P-1 ka hi extension, Phase 3 mein revisit karna |
| P-11 | `quizAttempt.model.js`'s `answers[]` subdoc does **not** store `optionOrder` (only `quizSession.model.js` does). Idempotent-replay path in `quizSubmitter.js` (duplicate `submissionKey`, e.g. network retry) re-looks-up the original `QuizSession` by `attempt.sessionId` to render results in the exact order the student saw them. That session row is normally still there (`SESSION_TTL_MIN = 50`), so this works for the realistic retry case (seconds/minutes later). But if a duplicate submit is replayed **after** the session's 50-min TTL has expired and MongoDB auto-deleted it, the code falls back to the question's default DB option order — the replayed result would show options in a different order than what the student actually answered against. Score/`isCorrect`/`correctOption` are unaffected (those are already baked into `attempt.answers`), only the *option display order* in that one rare replay path could differ. Found while implementing Checkpoint 2, not blocking it — flagged, not fixed. | `backend/src/services/quiz/quizSubmitter.js` (`buildResponseForExistingAttempt`), `backend/src/models/quizAttempt.model.js` | Checkpoint 2, 2026-08-10 | 🟢 Low — extremely narrow window (duplicate-submit AND >50min-late AND same submissionKey), display-only, not a scoring bug |
| P-10 | Question bank mein kuch options ke text field mein OCR/parsing garbage leak hua hai — dusre options ka text ya extra numbering usi option ke andar chipak gaya hai (e.g. option D mein "A. ... B. ... C. ... D. ..." poora list, ya "64. (C) ... (D) ..." jaisा leftover). API/controller ka bug nahi — root cause Phase 1 ke `transform-bulk-to-seed.js`/source PDF OCR mein hai, data seed ho chuki hai. Postman Scenario 3 (`mix_practice`, 20 Q) mein kam se kam 3 confirmed cases (Q3, Q12, Q17 us response mein). Extent (kitne total questions affected) abhi unknown — grep karna baaki hai. | `data/quiz-bank/science/**/*.json` seed source; `question_bank` collection | Postman Scenario 3 test, 2026-08-10 | 🟢 Low — data-quality, functional bug nahi (P-8 se related, dono seed-quality issues) |
| P-12 | `QuizModal` ka UI polish ke level pe "impressive" nahi lag raha — user ke apne alfaz mein: question/options ka layout aur content presentation, aur submit ke baad ka result/report screen, dono weak lagte hain. Functional hai (flow kaam karta hai, manually confirm hua), sirf visual/UX quality ka gap hai — koi specific bug list nahi di gayi abhi, general impression hai. | `frontend/src/components/QuizModal.jsx` | Phase 4 close-out manual test, 2026-08-14 | 🟡 Medium — student-facing polish, functional nahi |

**FIXED (baseline setup ke dauraan, Parking Lot mein nahi gaye — turant fix kiye kyunki baseline ko accurately padhna hi Phase 0 shuru karne ki shart thi):**

- **`golden-queries.json` C07** — "Cell membrane ka kya kaam hai?" `CONCEPT_QUESTION` expect karta tha; `data/class-10/science/` mein "cell membrane" ka koi mention hi nahi (Class 9 NCERT topic hai, Class 10 Bihar Board syllabus mein nahi). Decider sahi tha (`OUT_OF_CONTEXT`), test fixture galat thi. `O06` bana ke `OUT_OF_CONTEXT` section mein move kiya, poori reasoning `note` field mein likhi.
- **`golden-queries.json` N01-N04** — `studyMode: "focus"` tha par `chapterId` missing thi. `step1.validateInput.js` Focus Mode ke liye `chapterId` required maanta hai; missing hone par `400 ApiError`, jise `askOrchestrator.js:68-69` `status: 'provider_error'` mein wrap kar deta hai — aur golden-script us status ke liye hamesha "rate limit / LLM unavailable" hardcoded print karta hai, chahe wajah kuch bhi ho. Isi wajah se ye rate-limit jaisa dikha, tha bilkul nahi. Fix: sab 4 mein `chapterId: "science.physics.chapter-01"` add kiya. 4/4 PASS confirm hua.

---

## 🗺️ PHASE BOARD

| Phase | Kya | Status |
|---|---|---|
| **0** | Prerequisite — chapter completion fire karana | ✅ **DONE** (committed on `quiz-phase1`, `4b32e34`) |
| 1 | Question models + seed data (backend) — real 743-Q bank, see §19 | ✅ **DONE** (`quiz-phase1`: `2d51287`, `3ded7ca`, `b4d8072`, `3a0e51b`, `db5b442`) |
| 2 | Quiz engine + APIs (backend) — split into 4 checkpoints (1 API each) | ✅ **DONE** — all 4/4 checkpoints (`generate`, `submit`, `history`, `history/:attemptId`) |
| 3 | Chapter gate integration (backend) | ✅ **DONE** (`quiz-phase3`: `7120f87`, `ccc5dd3`, `2789ee1`) |
| **4** | Quiz runner modal UI (frontend) — see `QUIZ_PHASE4_PLAN.md` | ✅ **DONE** (`quiz-phase4`: `7f995b8`, `2c2a0ef`, `4c09bb2`) — manual browser test confirmed, UI polish deferred (P-12) |
| **5** | Practice Quiz Hub (frontend) | ⚪ Pending — next up |
| 6 | Polish + analytics (fullstack) | ⚪ Pending |

**Phase 1 se pehle 4 decisions confirm karne hain** — blueprint §16 items **12, 13, 14, 15**:
- (12) Phase 0 ka fix apne alag commit mein? → *recommend: haan*
- (13) `awaiting_quiz` summary API mein "in progress" count hoga? → *recommend: haan*
- (14) Quiz ka entry point sidebar mein kahan? → *recommend: rail icon button*
- (15) Adhoore seeded Mix Quiz ka behaviour? → *recommend: kam questions + `partialBank: true`*

---

## 📓 SESSION HISTORY

> Newest sabse upar. Har entry 3-5 line — isse zyada nahi.

### 2026-08-14 — Phase 4 closed out — **Phase 4 COMPLETE**
- **User manually tested the full flow in the browser** (chapter complete → quiz chip → answer →
  submit → pass → chapter shows completed) — confirmed working. This also confirms `4c09bb2`'s
  fix (start_gate_quiz chip + last-topic progress recording) actually resolved the issue.
- **Feedback from that test: UI is not polished** — quiz question/options layout and content
  presentation, plus the post-submit result/report screen, both feel weak. No functional bug,
  no specific list — general impression only. **User said don't fix now.** Logged as **Parking
  Lot P-12** (Medium — student-facing polish, not blocking).
- **Baseline re-run at phase close:** `test:chunks` (17/17), `test:study-map`, `test:curriculum-resolvers`
  — all green, no regression.
- **Agla:** new session — Phase 5 (Practice Quiz Hub, frontend), new branch off `quiz-phase4`/`main`.
  P-12 (quiz UI polish) can be picked up as its own dedicated session whenever the user wants —
  not bundled into Phase 5 unless it's explicitly decided to.

### 2026-08-14 — Phase 4 Step 2 committed + Step 3 built, same session
- **Step 2** (`2c2a0ef`) — Confirm screen now calls `submitQuiz()` (submissionKey/timeTakenSec/answers
  assembled from local state); result screen — score card, pass/fail badge, confetti on gate pass,
  "Dobara quiz do" retry on fail, per-question review (correct/wrong highlighting, explanation shown
  only if present); TTL-expiry soft check before submit; 404/409/429 handling; close-mid-quiz
  confirmation dialog. Also added `TYPE_CONFIG` (per-quizType icon/purpose copy) and `contextTitle`
  prop, both beyond the original plan text but small/cohesive with Step 2's scope. Backfilled a log
  entry for Step 1 (`7f995b8`, committed in an earlier session whose log entry was never written).
- **Step 3** (built, not yet committed) — real `start_gate_quiz` wiring: `handleSuggestedAction` gets
  a case that opens `QuizModal` (`quizType: 'chapter_gate'`, `chapterId`/`contextTitle` from already-
  tracked `selectedChapterId`/`selectedChapter`); `QuizModal` gained an `onQuizComplete(result)` prop,
  called right after a successful submit; ChatPage's `handleQuizComplete` sets `chapterStatus` to
  `'completed'` and fires `chapter-progress-updated` on pass (mirrors the pattern `handleAsk` already
  uses). `useChapterProgress.js` now fetches `awaiting_quiz` alongside `in_progress` (two parallel
  calls, merged + sorted by `lastStudiedAt`) since the backend's `status` filter is single-value only
  — no backend change needed. `FocusModal.jsx` shows a "Quiz Pending" pill (reused `.quiz-type-note`
  class, no new CSS) instead of the percent line for `awaiting_quiz` chapters. Removed the
  TEMP-STEP1-TESTING floating button + `isQuizTestOpen` scaffold entirely.
- **Verify:** `npm run build` clean after both steps. Backend baseline (`test:chunks`/`test:study-map`/
  `test:curriculum-resolvers` green, `test:chat-db-models` same pre-existing red, P-6) confirmed once
  this session — unaffected by Step 3 since no backend file was touched.
- **Not done yet:** manual click-through in the browser of the full flow (complete chapter → quiz
  chip → answer → pass → chapter shows completed → FocusModal chip clears) — Step 1-3 code has never
  been run against a live browser session. Per this project's standing convention the user does that
  testing, not Claude.
- **Agla:** commit Step 3, then manual browser test. If the test surfaces a bug, fix it in that same
  session (it would be closing out Phase 4's DoD, not a new phase). Once confirmed, Phase 4 is done —
  Phase 5 (Practice Quiz Hub) is next, new session.

### 2026-08-10 — Phase 3 (Chapter Gate Integration) built, committed, DB-verified — **Phase 3 COMPLETE**
- **3 steps, 1 continuous session, 1 commit per step** — new branch `quiz-phase3`.
- **Step 1** (`7120f87`) — `ChapterProgress` model groundwork: `awaiting_quiz` added to status enum, 3 new fields (`quizGateBestScore`, `quizGateAttempts`, `lastQuizAttemptId`), `setChapterAwaitingQuiz()` service function with a re-trigger guard (only transitions FROM `in_progress`, no-ops otherwise).
- **Step 2** (`ccc5dd3`) — Actual wiring: `step7.saveAndRespond.js` now moves a finished chapter to `awaiting_quiz` instead of auto-completing it (the old `markChapterComplete` call replaced). New `recordGateQuizResult()` + `quizSubmitter.js`'s `handleGateQuizResult()` pair: passing a `chapter_gate` quiz transitions `awaiting_quiz` → `completed` in the same request; failing leaves it `awaiting_quiz` with unlimited retries, best score never lowered. `chapter_practice`/`mix_practice` deliberately untouched. Verified end-to-end against real DB; baseline + golden suite green.
- **Step 3** (`2789ee1`) — Polish + guest-claim support: summary API's `inProgressCount` now includes `awaiting_quiz` chapters (were vanishing from the count before); `buildRecommendation()` gets an `awaiting_quiz` branch telling the student to take the gate quiz instead of a generic "continue" message; `claimGuestData()` extended to transfer `QuizAttempt`/pending `QuizSession` docs on guest→user claim and merge quiz-gate fields on conflict (best score = max, attempts = sum). New `test-quiz-gate.js` (`npm run test:quiz-gate`) — real-DB test chosen over golden-set (golden tests LLM intent, doesn't fit DB-state verification), covers the full `awaiting_quiz` → pass/fail → claim lifecycle, **28/28 checks green**.
- **Baseline**: green throughout, no regression across all 3 steps.
- **Agla:** new session — Phase 4 (Quiz runner modal UI, frontend). No open decisions carried over from Phase 3 into Parking Lot this session.

### 2026-08-10 — Phase 2 Checkpoint 4/4 built + DB-verified (`GET /quiz/history/:attemptId`) — **Phase 2 COMPLETE**
- **Deep line-by-line audit hui pehle** — teeno existing checkpoints (generate/submit/history), teeno models, response whitelisting pattern, rate limiters sab padhe, phir user ko Hinglish mein complete plan diya (payload, response shape, 6-step flow, hidden challenges, robustness checklist, reuse strategy) — approval milne ke baad hi code likha.
- **User ne explicit instruction di:** implement karo, koi naya-mila bug apne se fix mat karo — bas flag karo, decision user karega.
- **Built:** `getQuizAttemptDetail()` — identity-checked lookup + reused `fetchQuestionsById`/`toSubmitResultQuestion` (Checkpoint 2 se, exported for reuse) instead of writing new question-rendering logic; controller, route, `toAttemptDetailResponse()` response helper. Naya koi model/constant/middleware nahi — sabse chhota checkpoint ab tak.
- **`test:quiz-history-detail` written and run against live DB — 24/24 PASS**: happy path shape, mixed correct/wrong/skipped scoring, sensitive-field leak check, wrong-identity → null, fake attemptId → null, mix_practice chapterIds.
- **Post-implementation code review round (same discipline as Checkpoints 2-3)**: while writing this checkpoint's defensive missing-question guard, noticed the **pre-existing** `quizSubmitter.js:buildResponseForExistingAttempt()` (submit's idempotent-replay path) had no equivalent guard — `question.options.map(...)` would crash on a missing question instead of degrading. Not introduced this session, found via fresh eyes on shared logic. **User said fix it.** Fixed with the same guard pattern, re-ran `test:quiz-submit` (16/16), `test:quiz-history` (21/21), `test:quiz-history-detail` (24/24) + baseline — all green, no regression from the fix.
- **Baseline**: `test:chunks`/`test:study-map`/`test:curriculum-resolvers` green, `test:chat-db-models` same pre-existing red (P-6) — no regression, before and after the fix.
- **🎉 All 4 checkpoints of Phase 2 done.** Postman scenarios for Checkpoint 2 (`Submit 0-8`) still carried over, unrelated to Checkpoint 4's DoD.
- **Agla:** new session — Phase 3 (Chapter gate integration), depends on Phase 0 (already done). Also decide: run carried-over Postman scenarios, and whether to extract the `buildResponseForExistingAttempt`/`getQuizAttemptDetail` shared orchestration into one helper (flagged, not done — see Checkpoint 4's "Bahar" list).

### 2026-08-10 — Phase 2 Checkpoint 3/4 built + DB-verified (`GET /quiz/history`)
- **Deep line-by-line audit hui pehle** — generate/submit code, models, response whitelisting, rate limiters, controller patterns (`chapterProgress.controller.js` ke listing endpoint sameet) sab padhe before planning, phir user ko Hinglish mein complete plan diya (payload, response shape, flow, hidden challenges, index analysis, security checklist, test plan) — approval milne ke baad hi code likha.
- **User ne explicit instruction di:** implement karo, koi naya-mila bug apne se fix mat karo — bas flag karo report mein, decision user karega.
- **Built:** `quizHistoryService.js` (`getQuizHistory()` — cursor-based pagination on `createdAt`, identity filter, optional `quizType`/`chapterId` filters, fetch-one-extra-to-detect-hasMore pattern), controller validation (identity, `quizType` enum, cursor date parse, limit clamp), route, rate limiter (30/min, more generous than generate/submit since read-only), 2 new response-shaping helpers reusing the whitelist pattern from Checkpoints 1-2.
- **`test:quiz-history` written and run against live DB — first pass 17/17 PASS**: happy path ordering, pagination across pages, `chapterId`/`quizType` filters, identity isolation, empty history, response leak check, `passed` computation.
- **Post-implementation code review round (self-initiated, same discipline as Checkpoint 2's race-bug review)**: re-read all touched files fresh, found 2 real bugs. **User said fix both in this checkpoint** (not parked): (1) limit-clamp gap — `-5` is truthy in JS so `parseInt || default` let negative limits through unclamped, which combined with the `hasMore`/`slice` logic to produce a broken `{ attempts: [], hasMore: true }` response (confirmed live against MongoDB: negative `.limit()` doesn't throw, just misbehaves silently); (2) `chapterId` filter only checked the `chapterId` field, silently missing `mix_practice` attempts (which store their chapters in `chapterIds[]` instead, `chapterId` is `null` there). Both fixed, both covered by new test assertions, re-ran full suite — **21/21 PASS**.
- **Baseline**: `test:chunks`/`test:study-map`/`test:curriculum-resolvers` green, `test:chat-db-models` same pre-existing red (P-6) — no regression, before and after the fixes.
- **User reviewed the report, said fix now — done in-session.** No Postman scenarios created this session (read-only GET endpoint, lower manual-verification priority than generate/submit's request-body endpoints — can be added alongside Checkpoint 4 if user wants).
- **Agla:** new session — Checkpoint 4 (`GET /history/:attemptId`, full result detail with explanations), then Phase 2 is fully done and Phase 3 (chapter gate integration) can start. Carried-over item: Checkpoint 2's `Submit 0-8` Postman scenarios still not run.

### 2026-08-10 — Phase 2 Checkpoint 2/4 built + DB-verified (`POST /quiz/submit`)
- **Deep line-by-line audit hui pehle** — full existing code (models, generate flow, response whitelisting, rate limiters) padha before planning, phir user ko Hinglish mein complete plan diya (payload, response shape, 9-step flow, hidden challenges, robustness checklist) — approval milne ke baad hi code likha.
- **User ne explicit instruction di:** implement karo, koi naya-mila bug apne se fix mat karo — bas flag karo report mein, decision user karega.
- **Built:** `quizSubmitter.js` (idempotency fast path, atomic `pending→submitted` lock via `findOneAndUpdate`, scoring strictly against session's shuffled `correctOptionLabel`, E11000 race catch, 404-vs-409 distinguishing via a follow-up `findOne`), controller validation, route, rate limiter, 2 new response-shaping helpers (reusing Checkpoint 1's `pickLocalizedText`/`applyOptionOrder`).
- **1 low-severity gap found mid-implementation, NOT fixed (per instruction), Parking Lot P-11 added:** `quizAttempt` doesn't store `optionOrder`, so idempotent-replay after a session's TTL expiry falls back to DB option order for display only — score unaffected, narrow window, flagged for user decision.
- **`test:quiz-submit` written and run against live DB — 17/17 PASS**: all-correct scoring, idempotency (same key → same attempt, no duplicate), 409 on resubmit-with-new-key, 404 on wrong identity / fake quizId, mixed correct/wrong/skipped scoring, timeTakenSec clamp.
- **Post-implementation code review round (user asked "review quickly before I commit")**: re-read all touched files fresh, reasoned through the concurrency path, then wrote a standalone concurrent-request test to check a suspicion — confirmed a real race bug (same `submissionKey`, 2 requests at once → one incorrectly got `409` instead of the shared result). **User said fix it in this checkpoint** (not parked) — fixed with a short bounded poll before the 409 branch, re-confirmed with the same concurrent test 5/5 rounds, then reran `test:quiz-submit` (17/17) and the baseline suite — both still green.
- **Baseline**: `test:chunks`/`test:study-map`/`test:curriculum-resolvers` green — no regression, before and after the fix.
- **Postman scenarios added** (user's Postman connector, collection `af2d5f30-ca6d-4ffc-93e0-ae1a855cfd71`, `Quiz` folder `530bf2a0-edcf-4093-889f-833181888c01`): 9 requests, `Submit 0` (SETUP — generates a real quiz, auto-captures `quizId`/`questionId`/`submissionKey` into collection variables via a test script) through `Submit 8` (rate limit probe). Covers 400×3, 404, 200 happy path, 200 idempotent replay (same `attemptId`), 409 genuine conflict, 429 rate limit. Not yet run by user — planned for next session.
- **User reviewed the report, said "everything is okay," will commit manually.** Session closed here per protocol Rule 5 (checkpoint's DoD is met — code done, tested, reviewed, bug fixed, Postman scenarios ready).
- **Agla:** new session — run the 9 Postman scenarios (`Submit 0-8`), then decide on P-11 (fix or park), then Checkpoint 3 (`history` list API).

### 2026-08-09 — Phase 2 Checkpoint 1/4 built, verified (`POST /quiz/generate`)
- **User ne Phase 2 ko 4 checkpoints mein todne ko bola** (1 API = 1 discuss+implement session/beat). Naya branch `quiz-phase2`.
- **Do rethink rounds hue is checkpoint ke andar** (user ne khud dono maange): (1) robotic key names → simple relatable names (`totalQuestions`→`questionCount`, `partialBank`→`isPartial`, etc.), (2) **real schema bug pakda** — original design server-side language pick karta tha aur session mein sirf ek language freeze hoti thi; user ki language-toggle requirement se ye tootta. Fix: client teeno languages leta hai, session sirf `optionOrder` (labels) store karta hai, koi text nahi — language-independent, ~90% chhota session doc, text-comparison risk khatam.
- **Model change ki permission li gayi** — `quizSession.model.js` blast radius se bahar tha (protocol §7 STOP condition), user ne explicitly "haan" bola. `options[]`→`optionOrder[]`, `questionVersionSnapshot`→`questionVersion`.
- **Query optimization discuss + implement hui**: candidate selection sirf `_id` (index-covered), full content sirf selected 10/20 ke liye alag query; seen-set MongoDB aggregation se (500 subdocs load karne ke bajaye 1 summarized doc); `.lean()` har read pe.
- **2 naye Parking Lot items mile**: P-8 (near-duplicate questions possible, text-level dedup nahi hua tha) aur P-9 (`chapterProgress` P-1 index bug `chapter_gate` gate-check query ko bhi affect karta hai).
- **Real DB test (`test:quiz-generate`)**: 19/19 checks pass — 3-language response shape, forbidden-key leak check (`correctOptionLabel`/`explanation`/`topicId`/`optionOrder`), shuffle-correctness proof, mix-quiz multi-chapter spread, 404/409 error paths.
- **HTTP-level test** (server manually chalake): guest-missing-identity → 400, guest happy path → 200, rate limit 11th request → 429, doosri identity ko alag bucket mila. Sab confirm hua, test data cleanup hua, server band kiya.
- **Baseline**: `test:chunks`/`test:study-map`/`test:curriculum-resolvers` green, Phase 1 jaisa hi — koi regression nahi.
- **User ne apne Postman workspace se manually verify kiya** (`Ai tutor > Quiz` folder, 7 requests banaye Postman API connector se — collection ID `af2d5f30-ca6d-4ffc-93e0-ae1a855cfd71`, folder ID `530bf2a0-edcf-4093-889f-833181888c01`). Scenario 1 (no identity) aur Scenario 2 (`chapter_practice` happy path) run kiye.
- **Scenario 2 mein ek real bug pakda gaya** — `text` objects mein Mongoose ka auto `_id` leak ho raha tha. Turant fix hua (`pickLocalizedText()` helper), automated test mein permanent check add hua, dobara verify kiya (automated + Postman dono) — confirm hua `_id` ab kahin nahi hai.
- **Session yahin roka gaya** (user ne bola) — Scenario 3-7 (mix_practice, chapter_gate, invalid inputs, rate limit) Postman mein bane hue hain par abhi run nahi hue.
- **Agla:** Session shuru hote hi pehle bache hue Postman scenarios (3-7) complete karo, phir Checkpoint 2 — `POST /quiz/submit` — discuss karke implement.

### 2026-08-09 — Phase 1 built, verified, seeded (DONE)
- **User ne 5 checkpoints maange** is phase ke andar (blueprint mein already allowed hai — "checkpoints banao, phase mat todo"): (1) bulk file laana, (2) transform script + seed files, (3) 3 models, (4) seed engine, (5) real seed. Har checkpoint: build → verify → commit, ya problem discuss karke turant fix / Parking Lot.
- **Decision 16 confirm hua:** 6 kam-count chapters (16-40 questions) ship-as-is, no minimum enforce.
- **Real bug pakda gaya Step 1 mein:** blueprint §17 ka "744" verify-target khud ke §19 per-chapter table (743) se contradict karta tha — `science.meta.chapter-00` ka 1 question uss 744 mein included tha lekin per-chapter table mein nahi. User-confirmed: **743 hi sahi target**, meta chapter transform script mein skip hota hai.
- **User ne teeno models ka field naming reject kiya** — "robotic" laga. Poora rethink hua: `seedKey`→`questionCode`, `options[].key`→`options[].label`, `correctAnswer`/`shuffledCorrectKey`→ ek hi naam `correctOptionLabel` teeno models mein, `yearAsked`→`askedInYears`, `servedQuestions`→`questions`, `submittedAttemptId`→`attemptId`, `quizSessionId`→`sessionId`, `idempotencyKey`→`submissionKey`, `*Snapshot` suffixes chote kiye. `userId`/`guestId`/`subjectId`/`chapterId`/`topicId` **jaan-bujh kar nahi badle** — poore app mein already yahi naam use hote hain. `createdBy`/`updatedBy` add hue (Question mein `createdBy: 'seed-script'` default; Session/Attempt mein skip kiya, userId/guestId already creator batate hain).
- **Ek mid-phase bug pakda gaya after Step 3:** Step 2 ke seed files purane field names use kar rahe the (rename se pehle bane the). Transform script update karke 16 files regenerate hui — ab seed JSON aur DB models exact same field names use karte hain.
- **1 cheez deliberately skip hui:** blueprint §12 step 5 (Redis quiz-cache clear) — cache khud abhi exist nahi karta (Phase 2 mein banega). Parking Lot P-7.
- **Final verify:** `quiz:seed` → 743 inserted, 0 updated, 0 deactivated. DB query se confirm: 743 total, 743 active, 16 distinct chapters, biology ch01 = 103 (max), biology ch06 = 16 (min). Baseline test suite same as before (koi regression).
- **5 commits is phase mein:** `2d51287` (bulk file), `3ded7ca` (transform + seed files), `b4d8072` (3 models), `3a0e51b` (field-name fix on seed files), `db5b442` (seed engine + npm scripts).
- **Agla:** naya session, "Quiz Phase 2 shuru karo" bolna. Phase 2 shuru karne se pehle blueprint §16 decisions 12/13/14/15 confirm karni hain (Phase Board ke neeche list hai), aur naye field names (is file ke top ke mapping table se) yaad rakhne hain — blueprint text khud purane naam use karta hai.

### 2026-08-09 — Phase 1 replanned (no code written)
- **Kya hua:** User ne "Quiz pipeline continue karo" bola. Beat 1 (SAMJHO) shuru kiya — baseline test green (chat-db-models wahi red jo pehle se tha). Phase 1 explain karte waqt user confused hua "sirf 3 chapter, 50 hand-written questions kyun?" — investigate kiya toh pata chala: ek alag branch `quiz-phase0.5-bulk` pe already ek real 744-question bank ban chuka tha (2016-2026 ke Bihar Board papers se OCR + verify), saare 16 chapters cover karta hai, 3 languages (en/hi/hinglish) mein.
- **User ne implementation rokne ko bola** ("abhi kuch bhi mat karo... sirf explain karo") — do rounds mein deep-dive explanation di (widgets se): pehle "kya/kyun" high-level, phir models/seedKey/connections/3-language schema ka detailed audit jo user ne khud maanga.
- **Poora plan blueprint mein likha:** `QUIZ_SYSTEM_BLUEPRINT.md` ko v3 banaya — naya **§19** poori kahani ke saath, aur §3/§5/§11/§12/§16/§17 sab **[AUDIT 2026-08-09]** marks ke saath update kiye (3-language schema, real per-chapter counts, seed-format transform-script approach, future Question Management API concept, superseded decisions 5/6/10 → naye 16/17).
- **Koi code nahi likha is session mein** — user ne explicitly bola implementation agli session mein.
- **Ek open decision agli session ke Beat 1 mein confirm karni hai:** blueprint §16 decision 16 — 6 chapters 50-question target se kam hain (16 se 40 tak), recommend ship as-is.
- **Agla:** naya session, "Quiz Phase 1 shuru karo" bolna. Beat 1 seedha blueprint §19 se shuru hoga, phir decision 16 confirm karke Beat 2 (BANAO) mein transform script + models + seed script banega.

### 2026-08-02 — Phase 0 complete
- **Kya hua:** `step7.saveAndRespond.js` mein 2-line fix — `retrievedContext` ab sahi jagah se padha jata hai, `isComplete` check kaam karta hai.
- **Baseline detour:** golden test mein 2 stale fixture bugs mile aur fix kiye — C07 (cell membrane, syllabus mein hai hi nahi → O06 ban gaya) aur N01-N04 (missing `chapterId`, jo galti se "rate limit" jaisa dikh raha tha par asal mein 400 validation error tha). Dono `golden-queries.json` mein fix, poori reasoning `note` field mein.
- **Verify:** real DB test se confirm — chapter complete hone par status `'completed'` banta hai, `chapter_completed` event log hota hai, normal turn galti se complete nahi hota. Golden test 33P/7W/0F (baseline 34P/6W/0F, 0 FAIL dono baar) — koi regression nahi.
- **User feedback mila:** explanation style bahut complicated thi — ab short sentences, spacing, ek-ek karke. Permanent memory mein save kiya.
- **Agla:** commit karo, phir Phase 1 (`Quiz Phase 1 shuru karo` bolna).

### 2026-08-02 — Setup session (Phase 0 se pehle)
- **Kya hua:** Repo-wide stale file audit (4 orphan debug scripts delete, `PROBLEMS.md` archive, doc fixes) → commit `2d380cd` on `stalefilefixes`.
- **Phir:** `QUIZ_SYSTEM_BLUEPRINT.md` ka full audit live code ke against. **3 blocker, 3 internal contradiction, 5 factual mismatch** mile — sab file mein `[AUDIT]` blocks + naya §18 changelog ban ke inline fix ho gaye. Blueprint 1279 → 1780 lines.
- **Sabse bada finding:** chapter-completion hook (`step7:309`) dead code hai — isi wajah se naya **Phase 0** bana.
- **Setup:** `QUIZ_EXECUTION_PROTOCOL.md` + ye log file banayi, `CLAUDE.md` mein pointer add hua. User ne `stalefilefixes` ko `main` mein merge kiya aur teeno quiz files ko `quiz` branch pe commit kiya (`8673530`). `main` ka cleanup commit `quiz` mein merge kiya (`e3d65ee`, clean, no conflicts) — ab `quiz` `main` se fully sync hai.
- **Agla:** Phase 0 shuru — is file ke Phase 0 DoD section se.
