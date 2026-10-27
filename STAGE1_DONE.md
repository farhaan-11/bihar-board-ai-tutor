# STAGE 1 — LAUNCH

> **This file is the definition of "done" for Stage 1.**
> When every box is ticked, Stage 1 is finished. It does not get reopened.
> Nothing outside this file is Stage 1 work. Everything else lives in `BACKLOG.md`.

**Goal:** 20–50 real Bihar Board students use Zuno for a week without it breaking.

**Explicitly NOT the goal:** 50,000 users. Perfect code. New subjects. New features.
Those are Stage 2 and Stage 3.

**Target date:** _____________ (owner fills in)

---

## A. Repository hygiene

- [x] **A1.** `seo-work` merged into `main` (2026-08-28). One conflict in
      `ChatPage.jsx` resolved by keeping both the Helmet SEO wrapper and the
      QuizModal. Real merge tested with `--no-commit --no-ff` before committing.
- [x] **A2.** `quiz-phase0.5-bulk` decision made and recorded — **ADR-010: freeze,
      do not merge.** Its finished output (1,126 questions) was confirmed
      byte-identical to `main`'s already, via `quiz-phase1`.
- [x] **A3.** Merged branches deleted (2026-08-28): `quiz`, `quiz-phase1..4`,
      `global`, `profile`, `logo`, `feat/support-page`, `stalefilefixes`,
      `DECIDER_GREETING_FIX`, `STREAM_FAILURE_FIX`, `codex-curriculum-resolvers`,
      `seo-work`, plus a redundant branch `seo` (a superseded checkpoint of
      `quiz-phase0.5-bulk` — every commit on it already existed there).
      Local branches now: `main`, `quiz-phase0.5-bulk` only.
- [x] **A4.** `main` builds clean: `cd frontend && npm run build` — verified
      2026-08-28, including the new Playwright pre-render step. Quiz components
      (`QuizModal`, `QuizPage`) confirmed present in the build output.
- [x] **A5.** `PROJECT_STATE.md` matches reality after the merges — updated
      2026-08-28

---

## B. Infrastructure

- [~] **I1.** Render upgraded off the free tier — cold start under 3 seconds
      *(Free tier sleeps after 15 min. The first student each morning waits ~50s and leaves.)*
      **DEFERRED by owner 2026-08-28** — stay on free tier for the initial small-group
      launch; paid plan to be taken later. Accepted risk: first request after 15 min
      idle has a ~50s cold start. Acceptable for 20–50 known students who are told to
      wait; revisit before any wider launch.
- [x] **I2.** `USE_INTENT_ROUTER=true` confirmed in Render's environment
      — verified by owner 2026-08-28, present and correct in production env.
- [x] **I3.** All required env vars present on Render (compare against `backend/.env.example`)
      — verified by owner 2026-08-28, all present.
- [~] **I4.** Error monitoring live (Sentry free tier, or structured error logging you actually read)
      **DEFERRED by owner 2026-08-28** — to be decided later. Accepted risk: during the
      initial small-group launch there is no automatic alert when the backend errors;
      relying on students reporting problems and manual Render log checks. Revisit
      before wider launch — a student-facing product should have this.
- [~] **I5.** Upstash Redis usage checked against the free-tier ceiling; upgrade path known
      **DEFERRED by owner 2026-08-28** — stay on Upstash free tier for now; upgrade
      plan to be decided later. Accepted risk: ~10k commands/day ceiling. At 20–50
      students this is unlikely to be hit; revisit if usage grows.

---

## C. The 8 verified bugs

Each one follows the same protocol: **failing test first → fix → passing test.**
No fix is marked done on assertion alone.

- [x] **BUG-1 fix** — decider parse error must not produce a false "not in syllabus"
      (branch `bug1-decider-structured-output`, pending merge to `main`).
      Decider chain converted to `model.withStructuredOutput(decisionSchema, { strict: true })`;
      the `parse_error` fallback branch in `step4.decideRetrieval.js` is deleted. A
      genuine decider failure now throws `ProviderUnavailableError` → honest "try again"
      message, never a false scope rejection. Removes the cause (fallible free-text JSON
      parsing) per `AUDIT_RULES.md` Rule 4. See `docs/archive/plans/BUG1_FIX_PLAN.md` + **ADR-011**.
      Verified: `npm run test:decider-structured` (mocked, failing-test → passing-test)
      **and** a live dev-server run (real OpenAI, `strict: true` accepted; Hinglish →
      English `searchQuery` translation still works).
- [x] **BUG-2 fix** — unknown intent falls back to `CONCEPT_QUESTION`, never `GREETING`
      (same branch/commit as BUG-1).
      The `intent` enum in `decisionSchema` makes an unrecognised value structurally
      impossible; `normalizeDecision()`'s fallback is now unreachable **and** its target
      changed `GREETING` → `CONCEPT_QUESTION` as a defence-in-depth default. Verified by
      `test:decider-structured` (forces a bad value through the mock).
- [x] **BUG-3 fix** — dead whitelist entry removed. `INTENT_MEMORY_WHITELIST.CHOOSE_COURSE`
      is now `[]` (`ask/step7.saveAndRespond.js:68`). Its old fields
      (`currentSubjectId` / `currentSectionId` / `currentChapterId`) were unconditionally
      overwritten every turn by the `studyMode` force-sync block (`:248-262`), which
      persists chapter context from `chatState` — set by step2 from the request
      `chapterId`, never the LLM. `learningMode` is code-managed. Chapter switching only
      ever worked through the request `chapterId` param (frontend FocusModal path); that
      path is untouched. Removes the cause (a whitelist entry promising a capability that
      does not exist) per `AUDIT_RULES.md` Rule 4 — no guard added, force-sync block not
      touched. Verified by `npm run test:choose-course-memory` (failing-test → passing-test);
      baseline (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`) unchanged.
- [x] **BUG-4 fix** — stale out-of-scope entries removed from the decider prompt
      (merged to `main` 2026-08-28, `--no-ff`).
      `prompts/deciderPrompt.js` hardcoded "Cell structure" and "Atomic structure" as
      always-OUT_OF_CONTEXT (both in the intent-8 exclusion list and the rule-8 HARD
      LIMIT block that forces `searchQuery: null`). Both topics are in fact covered by
      indexed Class 10 content — `chapter-05-periodic-classification` ("### Atomic
      number", electronic configuration, K/L/M shells, valence electrons) and
      `chapter-02-control-and-coordination` ("## 4. Neuron / Nerve Cell", full structure
      + parts). With `searchQuery` nulled the SafetyNet English probe
      (`askOrchestrator.js:96`) never ran, so "atomic number kya hai" / "neuron ki
      structure batao" got a hardcoded false "not in your syllabus" reply and a drift-
      counter increment. Fix (Rule 4 — remove the cause): deleted both entries from the
      exclusion list, the HARD LIMIT block, and the two "cell ..." counter-examples.
      Genuinely-absent topics (Newton, Gravitation, Force, Pressure, Motion, Velocity,
      Work, Thermodynamics) stay excluded; generic Class 9 cell-organelle questions now
      fail safely via retrieval (insufficient content) instead of a decider reject. No
      guard/bypass added; no ADR needed (in-scope Section C fix, no BACKLOG pull).
      Verified by `npm run test:decider-scope` (failing-test → passing-test); baseline
      (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`) unchanged.
- [x] **BUG-5 fix** — `{ embedding: 0 }` projection + `metadata.topic_ids` index added
      (merged to `main` 2026-08-28, `--no-ff`).
      `retrieveChunksByTopicId()` (NEXT_STEP deterministic lookup) ran
      `Chunk.find({ 'metadata.topic_ids': id }).lean()` with (1) no B-tree index on
      that path → full COLLSCAN every "aage badhao" (`explain`: totalDocsExamined 629,
      totalKeysExamined 0 — the Atlas `vector_index` topic_ids entry is a
      `$vectorSearch` filter only, unusable by a plain `.find()`), and (2) no
      projection → every matched doc pulled with its 3072-float `embedding` (~24 KB),
      which the function never reads. Fix (Rule 4 — both causes removed, no guard):
      `chunk.model.js` now declares `chunkSchema.index({ 'metadata.topic_ids': 1 })`;
      the `.find()` passes `{ embedding: 0 }`. New `scripts/create-chunk-topic-id-index.js`
      (matches the repo's `fix-*-index.js` pattern) for an explicit prod build — the
      schema declaration also auto-creates it on next server start / `rag:index`.
      Verified: `npm run test:topic-id-lookup` (failing → passing); live `explain`
      now IXSCAN `metadata.topic_ids_1`, totalDocsExamined 4, `PROJECTION_SIMPLE
      { embedding: 0 }`; `verify-topic-chunk-coverage.js` PASSED; baseline unchanged.
      Prod: `metadata.topic_ids_1` created on `zuno_prod.chunks` and verified 2026-08-28.
- [x] **BUG-6 fix** — fallback-provider embeddings (and anything derived from them)
      are never persisted (merged to `main` 2026-08-29, `--no-ff`, `b576d70`).
      `embeddingCache.getOrFetch()` stored whatever vector `fetchFn` returned with no
      idea which provider produced it. During an OpenAI outage
      `ResilientEmbeddings.embedQuery()` silently falls back to Gemini — a vector in a
      *different* vector space — and that Gemini vector was written (1) into
      `embeddingCache` under the OpenAI model's key for **30 days**, and (2) downstream
      into `retrievalCache` as the chunks it retrieved for **24 hours**. After OpenAI
      recovered, retrieval stayed silently corrupted (cosine similarity across two
      vector spaces = noise) until those TTLs expired or `rag:index` ran. Same cause
      in two places: fallback-derived data being persisted. Fix (Rule 4 — remove the
      cause, no read-side guard): `geminiEmbeddings.js` adds `embedQueryWithMeta()`
      → `{ embedding, usedFallback }` (plain `embedQuery()` unchanged for the
      LangChain interface / `intentSafetyNet`); `embeddingCache.getOrFetch()` accepts
      `fetchFn` returning `{ embedding, cacheable }` and skips **both** L1 and L2
      writes when `cacheable === false`; `retriever.js` propagates `usedFallback` in
      its result; `retrievalCache.getOrFetch()` skips its write when
      `result.usedFallback`. Query-time fallback itself is untouched (accepted
      degraded-mode tradeoff, ADR-locked in `geminiEmbeddings.js` header) — only its
      *persistence* is removed. `EMBEDDING_PROVIDER=google` mode: `usedFallback` is
      always false (Gemini is the primary, single space). Verified by
      `npm run test:no-cache-fallback` (failing-test → passing-test); baseline
      (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`) unchanged.
- [x] **BUG-7 fix** — science glossary applies to Devanagari answers too
      (merged to `main` 2026-08-29, `--no-ff`, `e0f9d69`).
      `getAnswerLanguageInstruction()` returned the Hindi/Devanagari instruction
      from an early `return` (`utils/languageDetector.js:98`) that sat *before*
      the glossary-append block bolted onto the function tail (TASK-024). Only the
      Hinglish fall-through reached the append, so students who asked in Devanagari
      (`answerLanguage === 'hindi'`) never got the `scienceGlossary.js` term-
      consistency vocabulary that Hinglish students get on every study turn — the
      Hindi answer's term choices were left entirely to the LLM. Fix (Rule 4 —
      remove the cause, no guard): `wantsGlossary` is computed once, independent
      of the language branch; the glossary is appended to whichever base
      instruction (Hindi or Hinglish) is returned. The Hindi glossary header tells
      the model to render each term in Devanagari with the English term bracketed
      on first mention. Query-time behaviour for non-study intents (GREETING,
      EMOTIONAL_SUPPORT) unchanged — still glossary-free in both scripts.
      Verified by `npm run test:glossary-devanagari` (failing-test → passing-test);
      baseline (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`)
      unchanged.
      *Noted, not fixed (out of scope):* the legacy `step6.generateResponse.js:160`
      path calls `getAnswerLanguageInstruction(language.answerLanguage)` with no
      `intent`, so the glossary is never applied there for **any** language. That
      path is dead in production (`USE_INTENT_ROUTER=true`). Tracked in
      `PROJECT_STATE.md` §4.
- [x] **BUG-8 fix** — `askApiLimiter` keyed by identity, not raw IP
      (merged to `main` 2026-09-09, `--no-ff`, `1086b36`).
      `askApiLimiter` had **no** `keyGenerator`, so express-rate-limit keyed the
      30-req/min bucket by raw client IP. Under CGNAT / school / coaching /
      mobile-carrier networks, hundreds of students share one public IP — and so
      shared **one** bucket: five students asking six questions each in a minute
      429'd the sixth for what the other five did. The quiz limiters never had
      this — they key by `user_<id>` / `guest_<id>`, IP only as a last resort.
      Fix (Rule 4 — fix the key, not the cap): the quiz limiters' inline
      keyGenerator is extracted to one shared `identityKeyGenerator` export;
      `askApiLimiter` now uses it, and the 3 quiz limiters switched to the shared
      fn too (byte-identical behaviour — no 4th copy). The `max: 30` is unchanged
      — it is now measured per student, so it never has to grow with user count
      and is far above any real student's asking rate. Verified by
      `npm run test:ask-limiter-identity` (failing-test → passing-test); baseline
      (`test:chunks`, `test:study-map`, `test:curriculum-resolvers`) unchanged.
      *Noted, not fixed (deferred → `BACKLOG.md` R6 / `PROJECT_STATE.md` §4 BUG-8b):*
      `globalApiLimiter` (150 req / 15 min, app-wide on every `/api` route at
      `app.js:60`) has the **same raw-IP cause** and, being lower-rate and
      route-wide, is the binding constraint for a classroom — so BUG-8 reduces
      but does not fully remove "one student blocks the class". Out of scope
      because `globalApiLimiter` runs before `optionalAuth` (no `req.user`), so
      its fix needs auth moved ahead of it — blast radius across all routes, its
      own branch + test cycle. **Must NOT be patched by raising 150.**
      **Blocking condition:** fix before onboarding any single-classroom /
      school-wifi group; fine for a cohort on separate home connections.

---

## D. Testing

- [ ] **D1.** Golden set covers all 9 intents — `EXAM_INFO` and `EMOTIONAL_SUPPORT` currently have **zero** cases
- [ ] **D2.** At least 5 multi-turn cases (currently zero) — the pipeline is stateful and nothing tests state
- [ ] **D3.** Quality checks **fail** the run instead of only warning
- [ ] **D4.** `npm run test:golden` passes 100% on `main`
- [ ] **D5.** Baseline test suite passes: `test:chunks`, `test:study-map`, `test:curriculum-resolvers`, `test:chat-db-models`

---

## E. Real students

- [ ] **E1.** 10+ real students used Zuno for one week
- [ ] **E2.** Zero crashes and zero blank/error answers in that week
- [ ] **E3.** Their actual questions collected and added to the golden set
- [ ] **E4.** Feedback gathered — what confused them, what they liked

---

## F. Legal and student safety

> **Zuno's users are Class 10 students — roughly 15 years old. They are minors.**
> India's DPDP Act 2023 has specific provisions for processing children's data.
> Zuno currently collects name, email, and full conversation history, and has
> **no privacy policy or terms page** (verified 2026-08-28: no such route exists
> in `frontend/src/App.jsx`).
>
> This is not legal advice. It is a flag that this needs a decision before a
> public launch, not after.

- [ ] **F1.** Privacy policy page published, linked from footer and signup
- [ ] **F2.** Terms of use page published
- [ ] **F3.** Decision recorded (as an ADR) on how minors' data is handled —
      parental consent, data retention period, deletion request path
- [ ] **F4.** Account/data deletion path exists (even if manual via support email)
- [ ] **F5.** Google OAuth consent screen reviewed — scopes minimal, app name/logo correct

---

## G. Operations — "what if it breaks"

- [x] **G1.** **OpenAI hard spend cap set** on the account
      *(A loop, a bug, or abuse could otherwise produce an unbounded bill. 2-minute setting.)*
      **Done 2026-10-27 (owner-reported).** The hard cap is **Auto recharge OFF**
      (Billing, account-wide): spend can never exceed the prepaid credit balance, for
      every project and key — Zuno backend and the Python retrieval service alike.
      On top of that, a **$15/month project spend limit** is set (Project Settings →
      Limits); the page labels it as the trigger for spend alerts, so treat it as an
      alert, not the cap. When credit runs out, OpenAI calls fail and students get the
      "try again" message — the app does not crash. Raise the limit/credit when the
      student count grows (~$0.00125/turn, `PROJECT_STATE.md` §6).
- [ ] **G2.** MongoDB Atlas backup verified — free/shared tiers have no automated
      backups. Losing the DB means losing every student's progress.
- [x] **G3.** Rollback plan written down — how to revert Render and Vercel to the
      previous working deploy, in one page
      **Done 2026-10-27** — `docs/ROLLBACK.md`. Covers backend (Render rollback +
      `git revert` on `main`, so the next auto-deploy does not bring the bug back),
      frontend (Vercel promote previous deployment), env-var rollback,
      `USE_PYTHON_RETRIEVER=false`, and states that a deploy rollback never restores
      database data (that needs G2). Dashboard button names confirmed by owner
      2026-10-27.
- [ ] **G4.** A basic daily usage query or script exists — how many students,
      how many turns, how many errors.
      *(`models/studyEvent.model.js` already logs the events. Nothing reads them yet —
      verified 2026-08-28: no reporting script in `backend/scripts/`.)*
- [ ] **G5.** Support inbox confirmed working end-to-end — a student submits via
      `/support`, and a human actually sees it

---

## Exit criteria

**Every box above is ticked.**

When that happens:

1. Tag the commit `v1.0-launch`
2. Update `PROJECT_STATE.md`
3. **Stage 1 is closed.** It is not reopened by a later audit, a new idea, or a
   better approach. Those go to `BACKLOG.md` and are considered in Stage 2.

---

## Out of scope for Stage 1 — do not start these

These are real and worth doing. They are **not** Stage 1.

| Item | Stage |
|---|---|
| Structured output (JSON schema) | 2 |
| Answer cache | 2 |
| Hybrid search (BM25 + vector + RRF) | 2 |
| Removing the 12 defensive layers | 2 |
| Deterministic pre-router | 3 |
| Prompt caching | 3 |
| Maths / other subjects | 3 |
| Weakness/strength analytics | 3 |
| MongoDB / Redis scale-up | 3 |
