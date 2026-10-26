# BACKLOG.md

> Everything here is **parked**. Nothing in this file is Stage 1 work.
> Items are only picked up when the current stage's `*_DONE.md` is fully ticked.
>
> Classification follows `AUDIT_RULES.md` Rule 2.

Source: full Ask-pipeline audit, 2026-08-28. That audit produced 25 findings.
8 were BROKEN and moved to `STAGE1_DONE.md`. The rest are below, honestly
re-classified — most were opinions presented as problems.

**Addendum 2026-10-26** (found during the `PROJECT_STATE.md` §8 sync, after the
Python retriever / Docker / EC2 work): **B1**, **R7**, **O16**, **O17**, **A1**.
Each carries its Rule 2 bucket and its evidence. Nothing here was fixed.

---

## 🔴 BROKEN — found after the Stage 1 list was frozen

### B1. `deploy-ec2.yml` deploys even when CI is red
**Trigger:** a push to `main` while `ci.yml` fails (`test:chunks`, `test:study-map`,
the curriculum-resolver tests, or the frontend build).
**Wrong result:** `deploy-ec2.yml` still SSHes in and runs `deploy-zuno.sh`. The
file's own comment says "after CI passes", but both workflows trigger
independently on `push: branches: [main]`, with no `needs` / `workflow_run`.
**Where:** `.github/workflows/deploy-ec2.yml`, `.github/workflows/ci.yml`
**Evidence:** read from the workflow files on `main` (`2a04c05`) — config-verified,
not reproduced live (reproducing it would trigger a real deploy).

**Fix direction (Rule 4 — removes the cause):** make the deploy depend on CI — a
`workflow_run` trigger gated on `conclusion == 'success'`, or move the deploy into
`ci.yml` behind `needs:`. Do **not** add a "check CI status" step inside the
deploy; the cause is two independent triggers.
**Stage:** not in `STAGE1_DONE.md` by default. The owner decides whether it joins
Section G. Context: the EC2 instance is stopped today (`PROJECT_STATE.md` §8.3),
so right now this deploy job would fail at the SSH step anyway.

---

## 🟡 RISK — works today, fails at a named threshold

### R1. Answer truncation destroys the whole response
**Threshold:** any answer longer than `maxTokens: 1500`
**Where:** `ask/intentRouter.js` streaming block

Raw JSON is streamed to the browser and parsed only at the end. If the model
hits the token cap, the JSON is cut mid-string, `findJsonEnd()` returns `-1`,
and the student — who just watched a complete answer stream in — gets
"Thodi technical dikkat aayi."

**Fix direction:** check `finish_reason === 'length'` and salvage the partial
`sections[0].content` instead of discarding everything.
**Note:** Stage 2's structured output removes most of this class.

---

### R2. Redis free tier ceiling
**Threshold:** ~2,000 turns/day (roughly 5 Redis ops per turn on ~10k/day free tier)
**Impact:** rate limiting and caching degrade or fail
**Fix direction:** paid Upstash tier before ~500 daily users

---

### R3. LLM cost at scale
**Threshold:** measured ~$0.00125/turn → ~$2,800/month at 5,000 DAU, ~$28,000/month at 50,000 DAU
**Fix direction:** O1 (answer cache) is the largest lever, then O2, then O3.
This does not block launch, but it must shape Stage 2 and 3 design.

---

### R4. MongoDB Atlas tier
**Threshold:** vector search on a shared/free tier degrades well before 50k users
**Fix direction:** M10+ when daily actives cross ~1,000

---

### R5. NEXT_STEP chunk fetch is unbounded
**Threshold:** any topic with many linked chunks
**Where:** `rag/retriever.js:105` — no `.limit()`, no ordering
**Impact:** floods the prompt, dilutes the answer, pushes toward R1
**Fix direction:** `.limit(6)` + sort by `chunk_index`
*(Partially addressed by Stage 1 bug BUG-5, which adds the projection and index.)*

---

### R6. `globalApiLimiter` still keyed by raw IP — same cause as BUG-8, second location
**Threshold:** ~10–15 concurrent students on one shared/NAT IP (school wifi, coaching centre)
**Where:** `middlewares/rateLimiters.js` `globalApiLimiter` (150 req / 15 min per IP), mounted app-wide at `app.js:60` on every `/api` route

BUG-8 fixed `askApiLimiter` (now keyed by `identityKeyGenerator`). `globalApiLimiter`
has the **identical defect** — keyed by client IP — and because it covers every
route and its effective rate (~10/min for the whole IP) is lower than the ask
limiter's, it becomes the binding constraint for a classroom. So "one student
blocks the whole class" is reduced by BUG-8 but not fully removed.

It was left out of BUG-8 deliberately: `globalApiLimiter` runs **before**
`optionalAuth` (it is app-level, not route-level), so `req.user` is not populated
there. A proper fix needs `optionalAuth` (or a lighter verified-identity read)
moved ahead of the global limiter — a change with blast radius across all routes,
which deserves its own branch + failing-test → fix → passing-test cycle, not a
piggyback on BUG-8.

**Do NOT fix by raising 150** — that is a cap patch (`AUDIT_RULES.md` Rule 4).
The cause is the key, not the number.

**Blocking condition:** must be fixed before onboarding any single-classroom /
single-school-wifi group. Fine for a launch cohort on separate home connections.
(Also noted in `PROJECT_STATE.md` §4 + §7.)

---

### R7. JWT secrets shorter than the server's own 32-character minimum
**Threshold:** secret length < 32 characters — the backend prints this warning on
every boot.
**Where:** `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`. The local
`backend/.env` triggers it (seen in the 2026-10-26 Docker boot log); the exact
lengths are deliberately not recorded here.
**Production (Render):** checked by the owner on 2026-10-26 and reported fine
(**owner-reported**; the values were never shared or recorded). **EC2:** not
checked — the EC2 services are deployed but not active. Never paste secrets into
chat or notes.

**Why it matters:** an HS256 token signed with a short secret can be brute-forced
offline, and whoever has the secret can forge a login for any user. Zuno stores
minors' names, emails and chats.
**Fix direction:** generate 32+ random characters per secret. Rotating logs every
student out — that is a business call for the owner.
**Promotion condition:** if the *production* secrets are < 32 characters, this
becomes a Stage 1 item (Section F, student safety). Render (the only live backend)
is checked and fine, so this stays here. Re-check the EC2 values before EC2 is
ever activated.

---

## ⚪ OPINION — design improvements, not bugs

These are things a reviewer would design differently. **None of them is a defect.**
None may be presented as urgent or as a problem during an active stage.

### O1. Answer cache (highest value item in this file)
Students repeat the same questions constantly. "Photosynthesis kya hai" may be
asked thousands of times and is recomputed from scratch every time.
A semantic answer cache could serve an estimated 40–60% of traffic at near-zero cost.
**Stage 2.**

### O2. Structured output / JSON schema
`chatModel.js` creates `ChatOpenAI` with no `response_format`. All JSON is
scraped from free text by `utils/jsonParser.js`. Three parse-error fallback
branches exist because this fails in practice.
Switching to `.withStructuredOutput(schema, { strict: true })` would make parse
errors structurally impossible and allow deleting `jsonParser.js` plus all three
fallbacks. It also removes the cause behind Stage 1 bugs BUG-1 and BUG-2 — satisfying
`AUDIT_RULES.md` Rule 4.

**Partially pulled into Stage 1 (2026-08-28, ADR-011):** the **decider chain**
slice is being converted now, because BUG-1/BUG-2 have no Rule 4-compliant fix
without it. **Remaining Stage 2 scope:** the tutor / intentRouter chains
(`step6`, `intentRouter.js`, the 10 intent prompts) — these stream, which makes
structured output materially harder, and `utils/jsonParser.js` stays until they
are converted too.
**Stage 2 — highest priority in this list.**

### O3. Hybrid search (BM25 + vector + RRF)
Retrieval is vector-only. `reranker.js` hand-simulates a keyword leg using 14
tuned constants, interacting with 4 more thresholds in `retriever.js`. Atlas
already provides `$search` (BM25) next to `$vectorSearch`; Reciprocal Rank
Fusion would replace most of `reranker.js` with a zero-tuning-constant algorithm.
**Stage 2.**

### O4. Keyword match should be a boost, not a gate
`step5.retrieveContent.js:24` sets `requireTermMatchForLatinQuery: true`, which
hard-rejects any chunk with zero keyword overlap regardless of vector score.
Since the search query is a paraphrase the decider invented, vocabulary mismatch
can produce zero chunks and a false "this topic is in another chapter" message.
**Stage 2 — pairs with O3.**

### O5. Remove the 12 defensive layers
SafetyNet, DriftCap, Guard 1–4, Title Rescue, Intent Firewall, Out-of-Focus
Fallback, 3 parse-error fallbacks. Many become unnecessary once O2 and Stage 1
bug BUG-4 land.
**Stage 2.**

### O6. Deterministic pre-router
Every "hi", "ok", "thanks", "bye" currently costs a full decider LLM call with a
~2,000-token prompt. A small exact-match/regex router for the top ~30 phrases
would skip the LLM on roughly 30–40% of turns and be more reliable than the
model for those exact cases.
**Stage 3.**

### O7. Prompt caching
System prompts (`corePersona` + per-intent rules) are static and therefore
cacheable. Structuring them as a stable prefix would cut input cost significantly.
**Stage 3.**

### O8. Trim the science glossary per turn
The full glossary (~1,200 tokens) is injected into every study prompt. Only the
terms actually present in the retrieved chunks are needed — typically 5–10.
**Stage 3.**

### O9. Decider is blind to Focus Mode
`ask/step4.decideRetrieval.js:157` destructures only `{ deciderHistory, language }`.
Its own JSDoc claims it uses `focusChapterPrompt` and `currentStudyContext`, but
neither is passed. The classifier does not know which chapter the student is in.
**Stage 2.**

### O10. Remove the legacy step6 path
`ask/step6.generateResponse.js` still contains the full pre-router implementation
behind `USE_INTENT_ROUTER`. It uses a different prompt and does not stream.
Once STAGE1 I2 (env verification) confirms the router is live everywhere, delete it.
**Stage 2.**

### O11. Internal `decision` object is returned to the client
`ask/step7.saveAndRespond.js` ships intent, reason, and searchQuery to the browser.
**Stage 3.**

### O12. `EXAM_INFO` gets a forced "Aage badhein" chip
`ask/step7.saveAndRespond.js:125`. A student asking about marks receives an
advance-the-chapter button.
**Stage 3.**

### O13. Unknown-intent recursion drops streaming and abort
`ask/intentRouter.js` re-calls `routeToIntentHandler` without `streamCallbacks`
or `abortSignal`.
**Stage 2.**

### O14. `answerLanguage: 'english'` is a dead branch
`utils/languageDetector.js` can only ever return `'hindi'` or `'hinglish'`.
The comment justifying this states the vector store is "indexed in Hinglish",
which is factually wrong — `data/` is English, and `rag/retriever.js` says so.
The decision may still be correct; the stated reason is not.
**Stage 3 — fix the comment now, revisit the behaviour later.**

### O15. Documentation sprawl
16 markdown plan files in the repo root. Several are point-in-time snapshots
that contradict current code. `PROJECT_STATE.md` now supersedes most of them.
**Stage 2 — archive, don't delete.**

### O16. Local environment is wired to the production database
`backend/.env` has `MONGO_URI` → `zuno_prod` while `NODE_ENV=development`, and the
Python service's `.env` uses `zuno_prod` too. This was intentional so far — the
parity and shadow tests needed the real chunks. The design improvement is a
separate dev database.
**Until then, the working rule:** a local run (dev server, `docker compose`,
scripts) may be started and health-checked, but must not be driven with real chat
turns — those write to production `chat_sessions`.
**Stage 2.**

### O17. `zuno-retrieval` container has no healthcheck
`docker inspect zuno-retrieval` shows none, so compose or an orchestrator cannot
tell a hung process from a healthy one. The Dockerfile lives in the **other** repo
(`zuno-retrieval-service`), so fix it there. When adding one, probe `127.0.0.1`,
not `localhost` (the same `::1` trap that showed the frontend as `unhealthy` on
2026-10-26), and use Python's stdlib (`urllib`) — `python:*-slim` images do not
ship `curl` / `wget`.
**Stage 2.**

---

## AI Track — Python retrieval service

### A1. Shadow → `true` cutover
**Today:** shadow mode on production, with 4 live questions of evidence plus offline
parity (22/22 gate, 269/273 bulk). Before `USE_PYTHON_RETRIEVER=true` the owner must
settle:
1. **Evidence:** how many real-traffic queries, at what DIFF rate, count as enough.
2. **Failure behaviour:** the client fails loudly by design, so `true` has no Node
   fallback — a Python outage becomes a student-facing error. Adding a fallback is
   a new layer, so it needs an ADR and must remove a cause (Rule 4).
3. **Latency:** the free-tier Render service took 21.4 s on a cold `/health`
   (2026-10-25) against 0.37 s warm.

Not Stage 1.

---

## SEO

### S1. Pre-render `/` and `/support` for non-JS crawlers
**Where:** `frontend/` build, `SEO_PLAN.md` Phase 6

The first attempt (Playwright prerender in the build) never worked on Vercel —
`chrome-headless-shell` exits 127, missing system libs, no way to install them
in Vercel's build sandbox. It blocked all frontend deploys for a day and was
reverted on branch `frontend-vercel-build-fix` (2026-08-29).

All browser-free SEO still ships and works: static OG/Twitter/JSON-LD tags in
`index.html`, `sitemap.xml`, `robots.txt`, `og-image.png`, and per-route
react-helmet-async tags (Googlebot executes JS, so it gets these). The only
remaining gap: non-JS social unfurlers see `index.html`'s generic OG tags for
`/support` instead of support-specific ones. `/` unfurls correctly already.

**Fix direction:** `puppeteer-core` + `@sparticuz/chromium` (serverless-safe
bundled Chromium). **Must be verified on a real Vercel preview deploy before
merge** — local build success is not proof, that is exactly what went wrong
last time.
**Impact:** near-zero for the 20–50 student launch. Not Stage 1.

---

## Feature ideas (owner's stated goals, not yet scoped)

| Idea | Notes |
|---|---|
| Subjective / long-answer practice | PYQ bank on `quiz-phase0.5-bulk` already has the raw material |
| Previous-year paper mode | 2016–2026 papers exist on that stranded branch |
| Weakness / strength analytics | `studyEvent.model.js` already logs events — the data foundation exists |
| Other subjects (Maths first) | See ADR-007 — deliberately deferred until Science is proven |
| Spaced repetition / revision | Not started |
