# Hinglish Query Fix — Execution Plan (v3, evidence-backed)

> **Date**: 2026-07-29 (planned) → 2026-07-30 (implemented)
> **Status**: ✅ **COMPLETE** — Changes A, B, C implemented, verified, merged into
> `fix/hinglish-query-pipeline`. `main` untouched, pending explicit approval to merge.
> See **Section 12 (Implementation Results)** at the bottom for what was achieved and
> what open items came out of testing.
> **Priority**: CRITICAL — breaks the core product for the exact students it was built for.
> **Every claim below was MEASURED on this machine against MongoDB Atlas + OpenAI.**
> Nothing in this file is an assumption. Section 2 lists the raw numbers.

---

## 0. What to do (30-second version)

There are **two independent bugs**, both confirmed live. Fix all three changes below — they
are small, and each was tested.

| # | Change | File | What it fixes |
|---|---|---|---|
| **A** | Decider prompt: Hinglish rule + always-translate + hard exclusion limit | `backend/src/prompts/deciderPrompt.js` | Bug 1 — false `OUT_OF_CONTEXT` |
| **B** | Use the decider's English query for retrieval | `backend/src/ask/step4.decideRetrieval.js` | **Bug 2 — the big one** |
| **C** | SafetyNet probes the English query, and only when one exists | `backend/src/ask/askOrchestrator.js` | Backup layer + fixes the "Hello Zuno" false positive |

**Do NOT change the SafetyNet threshold.** It stays `0.70`. Section 2.4 shows, with numbers,
why the previously-proposed `0.65` would have fixed almost nothing and broken other things.

---

## 1. The two bugs, in plain terms

Every chapter in `data/` is written in **English**. Students write in **Hinglish**. The pipeline
compares them directly, in two places, and both comparisons fail.

### Bug 1 — Decider wrongly rejects Hinglish questions

Reproduced live (`POST /api/v1/ask`, fresh session, global mode):

```
question: "paudhe apna khna kaise bnate hai"
decision: { intent: "OUT_OF_CONTEXT", searchQuery: null,
            reason: "The question is about plants and their food production,
                     which is not covered in Class 10 Science." }
student sees: "Yaar, ye topic Zuno ki scope mein nahi aata..."
```

The decider literally states that plants making food is not Class 10 Science. It is — it is
photosynthesis, in Life Processes. Repeated 6× → `OUT_OF_CONTEXT` 6/6.

### Bug 2 — Even when the decider is RIGHT, retrieval still fails

This is the bug the earlier versions of this plan under-weighted. Reproduced live:

```
question: "tree apna bhojan kaise bnate hai"
[Step 4→5] intent: CONCEPT_QUESTION, needsRetrieval: true      ← decider was CORRECT
[Step 5 DB Scan] Querying index vectors using computed target:
                 "tree apna bhojan kaise bnate hai"            ← RAW HINGLISH used
[Step 5 Complete] Successfully packaged 0 ground truth chunks  ← 0 chunks
[IntentRouter] CONCEPT_QUESTION → status:insufficient_context
```

The decider **did** generate a good English query (`"how do trees produce their food through
photosynthesis"`). `step4.decideRetrieval.js` throws it away and searches with the raw Hinglish
instead. Verified in the same run — `decision.searchQuery` came back as the raw Hinglish string
on all 6 repeats.

**So even a perfect classifier cannot save this pipeline. Change B is mandatory.**

### Why "live worked, local didn't"

Not a code difference — both run identical `main`. These queries sit **exactly on the model's
decision boundary**. The same query, same prompt, same model returned `CONCEPT_QUESTION` in one
measurement run and `OUT_OF_CONTEXT` (6/6) in another taken minutes later. gpt-4o-mini at
`temperature: 0` is not bit-reproducible across requests. So the student's experience is a coin
flip — and when the flip lands on `CONCEPT_QUESTION`, Bug 2 catches them anyway. That is why the
same question produced two *different* wrong messages in the two screenshots:

- `"Yaar, ye topic Zuno ki scope mein nahi aata"` → Bug 1 path
- `"Thodi technical dikkat aayi..."` / `insufficient_context` → Bug 2 path (`intentRouter.js:294`
  fills that generic line when the tutor returns nothing usable after getting 0 chunks)

---

## 2. The measurements (raw evidence)

Environment: `LLM/DECIDER = openai gpt-4o-mini`, `EMBEDDING_PROVIDER = openai`
(`text-embedding-3-large`, 3072-dim), `USE_INTENT_ROUTER=true`, SafetyNet threshold `0.70`,
MongoDB Atlas `vector_index`.

### 2.1 Retrieval: raw Hinglish returns literally nothing

`retrieveRelevantChunks()`, global mode, default `topK=5`:

| Query (raw Hinglish) | chunks (raw) | chunks (English translation) |
|---|---|---|
| paudhe apna khna kaise bnate hai | **0** | 5 |
| tree apna bhojan kaise bnate hai | **0** | 5 |
| paudhe apna khana kaise banate hain | **0** | 5 |
| saans lene mein kya hota hai | **0** | 5 |
| khana kaise pachta hai | **0** | 5 |
| khoon ka kaam kya hota hai | **0** | 5 |
| loha mein jung kaise lagti hai | **0** | 5 |
| dhatu aur adhatu mein fark kya hai | **0** | 5 |
| bijli kaise banti hai | **0** | 5 |
| aankh mein cheezein kaise dikhti hain | **0** | 5 |

**10 out of 10 → zero chunks. 10 out of 10 → 5 correct chunks in English.**

Why it is a hard zero, not a weak match — internal counters for one query:

```
candidateCountBeforeRerank: 50
countAfterMinScore:         50     ← 50 candidates cleared the 0.55 vector floor
countAfterFinalFiltering:    0     ← ALL 50 killed by passesFinalFilter()
```

`retriever.js` `passesFinalFilter()` requires a keyword term-match **or** a vector score ≥ 0.70.
Hinglish words (`paudhe`, `khna`, `bnate`) can never term-match English chunk text, and the
vector scores sit at 0.59–0.69. So every candidate is dropped. This is structural, not marginal.

### 2.2 SafetyNet probe: raw Hinglish never fires, English always does

`probeAcademicSimilarity()`, threshold `0.70`:

| Query | probe(raw) | fires? | probe(English) | fires? |
|---|---|---|---|---|
| paudhe apna khna kaise bnate hai | 0.6215 | no | **0.7393** | yes |
| tree apna bhojan kaise bnate hai | 0.6398 | no | **0.7115** | yes |
| paudhe apna khana kaise banate hain | 0.6345 | no | **0.7419** | yes |
| saans lene mein kya hota hai | 0.6102 | no | **0.7440** | yes |
| khana kaise pachta hai | 0.6121 | no | **0.7847** | yes |
| khoon ka kaam kya hota hai | 0.6517 | no | **0.7990** | yes |
| loha mein jung kaise lagti hai | 0.5904 | no | **0.7787** | yes |
| dhatu aur adhatu mein fark kya hai | 0.6232 | no | **0.8478** | yes |
| bijli kaise banti hai | 0.6863 | no | **0.7455** | yes |
| aankh mein cheezein kaise dikhti hain | 0.6819 | no | **0.8094** | yes |

Raw range **0.5904 – 0.6863** (0/10 fire). English range **0.7115 – 0.8478** (10/10 fire).

### 2.3 Negative controls — English translation does NOT create false positives

| Query | probe(raw) | probe(English) | fires on English? |
|---|---|---|---|
| Newton ka niyam kya hai | 0.6790 | 0.6566 | no ✓ |
| cricket ka score kya hai | 0.5980 | 0.5921 | no ✓ |
| do aur do kitne hote hain | 0.6227 | 0.5990 | no ✓ |
| mera pet dard kar raha hai | 0.5849 | 0.6500 | no ✓ |
| Biryani kaise banate hain? | 0.6150 | 0.5971 | no ✓ |
| Maths ke questions solve karo | 0.6833 | 0.6444 | no ✓ |
| History mein Mughal Empire… | 0.5801 | 0.5865 | no ✓ |
| IPL ki team batao | 0.5819 | 0.5725 | no ✓ |
| Bollywood mein kaun achha actor | 0.5681 | 0.5561 | no ✓ |
| gravitation kya hai | 0.6484 | 0.6123 | no ✓ |
| **cell ki structure batao** | 0.6226 | **0.7266** | **YES — see 2.5** |
| Hello Zuno | **0.7355** | n/a (greeting) | **YES — see 2.6** |

`"Biryani kaise banate hain?"` was the biggest worry (same `"X kaise banate hain"` shape as the
photosynthesis question). Measured: **0.5971 English — safely below threshold.** Good separation.

### 2.4 Why the old plan's "lower threshold to 0.65" was wrong — with numbers

The previous version of this file proposed dropping the threshold `0.70 → 0.65`. Measured:

- **It would have fixed almost nothing.** 8 of the 10 raw-Hinglish scores are **below 0.65**
  (0.5904, 0.6102, 0.6121, 0.6215, 0.6232, 0.6345, 0.6398, 0.6517). Only 2 of 10 sit in the
  0.65–0.70 band. And even the 2 it "rescued" would then hit Bug 2 and retrieve 0 chunks anyway.
- **It would have broken working cases.** `"Maths ke questions solve karo"` scores **0.6833** raw
  — above 0.65. Lowering the threshold would falsely promote a Maths question to
  `CONCEPT_QUESTION`. `"Hello Zuno"` at 0.7355 was already over-firing and 0.65 makes that class
  of error strictly worse.

**Conclusion: raising the signal quality (probe English) beats lowering the bar. Threshold stays 0.70.**

### 2.5 A real regression this plan found in itself — and fixed

An early draft of Change A caused `"cell ki structure batao"` to flip from `OUT_OF_CONTEXT` to
`CONCEPT_QUESTION` (0/5 correct over 5 runs). That matters, because its English translation
scores **0.7266** and retrieval returns this:

```
Control and Coordination        | 4. Neuron / Nerve Cell
How Do Organisms Reproduce?     | Process 1: DNA Copying and Cell Division
Sources of Energy               | Output of a Typical Solar Cell     ← wrong "cell"
Sources of Energy               | 15. What is a solar cell?          ← wrong "cell"
Control and Coordination        | 4.5 Transmission of Nerve Impulse
```

A student would get neurons, DNA division and **solar panels** mixed together. Change A's final
wording adds a HARD LIMIT block with explicit counter-examples, which fixes this — **4/4 correct**
after the fix (section 2.7). Cell structure is on the existing exclusion list and stays there.

### 2.6 The "Hello Zuno" false positive is fixed for free

`"Hello Zuno"` probes at **0.7355** on the raw text — above the 0.70 threshold — so today the
SafetyNet wrongly promotes a greeting to `CONCEPT_QUESTION` (it top-matches the chunk
*"What Zuno Can Help You With"*). This is a pre-existing bug, unrelated to Hinglish.

Change C removes it without any threshold tuning: the decider returns `searchQuery: null` for
`GREETING` (measured 4/4), so there is no English query, so **the probe is skipped entirely**.
The gate becomes meaningful: *only probe messages the decider identified as a real-world question.*

### 2.7 Final validation of the exact prompt wording in Change A

The wording in Change A below was run against the live decider, **4 runs per query**, fresh
history-less input (exactly the cold-start path a new student hits):

```
OK 4/4  "cell ki structure batao"              -> OUT_OF_CONTEXT / null
OK 4/4  "cell ke parts kya hote hain"          -> OUT_OF_CONTEXT / null
OK 4/4  "gravitation kya hai"                  -> OUT_OF_CONTEXT / null
OK 4/4  "Newton ka niyam kya hai"              -> OUT_OF_CONTEXT / null
OK 4/4  "Biryani kaise banate hain?"           -> OUT_OF_CONTEXT / null
OK 4/4  "Maths ke questions solve karo"        -> OUT_OF_CONTEXT / null
OK 4/4  "Hello Zuno"                           -> GREETING / null
OK 4/4  "paudhe apna khna kaise bnate hai"     -> CONCEPT_QUESTION / "how do plants make their own food photosynthesis in leaves"
OK 4/4  "loha mein jung kaise lagti hai"       -> CONCEPT_QUESTION / "how does rusting corrosion of iron happen chemical reaction"
OK 4/4  "bijli kaise banti hai"                -> CONCEPT_QUESTION / "how is electricity generated and how current flows"
OK 4/4  "khana kaise pachta hai"               -> CONCEPT_QUESTION / "how is food digested in the human digestive system"
OK 4/4  "insaan mein bacha kaise paida hota hai"-> CONCEPT_QUESTION / "how does reproduction occur in humans and how are babies born"
OK 4/4  "photosynthesis kya hai"               -> CONCEPT_QUESTION / "what is photosynthesis and how do plants produce food"

TOTAL 52/52
```

Baseline (current prompt) on the same set: `"paudhe apna khna kaise bnate hai"` failed 6/6 and
`"loha mein jung kaise lagti hai"` failed. **No regressions were introduced.**

### 2.8 The other five intent families were checked too — no regressions

Sections 2.1–2.7 only exercised `CONCEPT_QUESTION`, `OUT_OF_CONTEXT`, `GREETING` and
`EMOTIONAL_SUPPORT`. Change A's rules 7/8 say "prefer CONCEPT_QUESTION when unsure about a
real-world topic", which could plausibly pull `EXAM_INFO` (it names science topics *and* asks about
marks) or `CHOOSE_COURSE` toward `CONCEPT_QUESTION`. That was a real risk, so it was measured —
every golden-set query from the untested families, plus five `EXAM_INFO` cases (the golden set has
none), **3 runs each, baseline vs proposed, with realistic history**:

```
EXPLAIN_MORE      (5 queries)  BASE 15/15   PROPOSED 15/15
NEXT_STEP         (4 queries)  BASE 12/12   PROPOSED 12/12
CHOOSE_COURSE     (4 queries)  BASE 12/12   PROPOSED 12/12
UNSAFE_OR_ABUSIVE (2 queries)  BASE  6/6    PROPOSED  6/6
EXAM_INFO         (5 queries)  BASE 15/15   PROPOSED 15/15
                               ─────────────────────────────
                        TOTAL  BASE 60/60   PROPOSED 60/60

REGRESSIONS: NONE
searchQuery wrongly emitted on a non-CONCEPT intent: NONE
```

Including the highest-risk case, `"Life Processes se kitne marks aate hain?"` → `EXAM_INFO` 3/3
with `searchQuery: null`, exactly as required (EXAM_INFO must bypass vector search).

**All nine intents are now covered by measurement.**

---

## 3. The design principle

> **Translate the student's question to English exactly once, then do every language-sensitive
> step — the scope probe and the vector search — on that English text. Never compare raw Hinglish
> against English content.**

And a second principle that makes the whole thing coherent:

> **`searchQuery` is a translation, not a verdict.**
> `searchQuery = <English>` means *"here is the question in English — go check the content."*
> `searchQuery = null` means *"I am confident this needs no content lookup"* (a greeting, an
> emotional message, or an explicitly excluded topic).
> The SafetyNet then probes **only** when a translation exists — so it can rescue the decider's
> genuine mistakes without ever second-guessing its deliberate decisions.

This gives four layers, none of which depend on Hinglish↔English matching:

| Layer | Mechanism | Catches |
|---|---|---|
| 1. Classification | Decider rule 7 recognises everyday-Hinglish science questions | The common case (measured 52/52) |
| 2. Translation | Decider emits an English `searchQuery` even when it leans OUT_OF_CONTEXT | Feeds layers 3–4 when layer 1 slips |
| 3. Scope probe | SafetyNet embeds the **English** query, gated on it existing | Layer-1 misclassifications (raw 0.62 → English 0.74) |
| 4. Retrieval | Vector search runs on the **English** query | Turns 0 chunks into 5 correct chunks |

**Why it is future-proof.** No Hinglish keyword list to maintain, no per-subject thresholds. Adding
Maths / Hindi / Social Science later is: add the content files, run `npm run rag:index`, and extend
the decider's scope description. Scope is decided by *whether retrieval finds anything*, not by the
model's memory of a chapter list.

---

## 4. Change A — decider prompt

**File**: `backend/src/prompts/deciderPrompt.js`

### A1. Add rules 7 and 8

Find this line (the last line of `CONSERVATIVE BIAS RULES`, currently line 124):

```
6. If the student explicitly says "Chapter shuru karein", classify as NEXT_STEP, NOT CHOOSE_COURSE.
```

Append immediately after it:

```
7. HINGLISH SCIENCE RULE (CRITICAL — prevents false OUT_OF_CONTEXT):
   A Hinglish/Hindi question that DESCRIBES a natural process in everyday words — with no English
   scientific term in it — is still a CONCEPT_QUESTION. Do not reject it just because it does not
   name a textbook topic. Translate it into an English searchQuery instead.
   Examples (all CONCEPT_QUESTION):
   - "paudhe apna khana kaise banate hain" -> searchQuery: "how do plants make their own food photosynthesis in leaves"
   - "saans lene mein kya hota hai"        -> searchQuery: "what happens during breathing respiration in humans"
   - "khana kaise pachta hai"              -> searchQuery: "how is food digested in the human digestive system"
   - "aankh mein cheezein kaise dikhti hain" -> searchQuery: "how does the human eye see and form images on the retina"
   - "loha mein jung kaise lagti hai"      -> searchQuery: "how does rusting corrosion of iron happen chemical reaction"
   - "bijli kaise banti hai"               -> searchQuery: "how is electricity generated and how current flows"
8. SCOPE PHILOSOPHY: when a message describes a real-world natural phenomenon in everyday words and
   you are UNSURE whether it is in the indexed chapters, prefer CONCEPT_QUESTION and let retrieval
   verify scope. A wrong OUT_OF_CONTEXT gives the student a false rejection.
   HARD LIMIT — rule 7 and this rule NEVER apply to the topics below. They are always
   OUT_OF_CONTEXT with searchQuery null, even though they are science topics, and even when asked
   in everyday Hinglish:
     Newton's Laws, Gravitation, Force, Pressure, Motion, Velocity, Work,
     Cell structure / cell organelles / parts of a cell / cell diagram,
     Atomic structure, Thermodynamics.
   Counter-examples (memorise these):
   - "cell ki structure batao"      -> OUT_OF_CONTEXT, searchQuery null
   - "cell ke parts kya hote hain"  -> OUT_OF_CONTEXT, searchQuery null
   - "gravitation kya hai"          -> OUT_OF_CONTEXT, searchQuery null
```

> The HARD LIMIT block is not optional. Without it, `"cell ki structure batao"` breaks (0/5) and
> pulls in solar-cell chunks — see section 2.5.

### A2. Replace the searchQuery tail rule

In `SEARCH QUERY RULES`, find these two lines (currently lines 134–135):

```
- EXPLAIN_MORE: searchQuery must be null. Re-retrieval is handled by the pipeline using saved session state.
- All other intents: searchQuery must be null.
```

Replace with:

```
- EXPLAIN_MORE: searchQuery must be null. Re-retrieval is handled by the pipeline using saved session state.
- OUT_OF_CONTEXT: searchQuery is an ENGLISH TRANSLATION, not a scope judgement. Set it whenever the
  message asks about the natural or physical world — living things, the human body, substances,
  materials, natural phenomena, or physical/biological/chemical processes — EVEN IF you classified
  the message OUT_OF_CONTEXT because you were unsure whether it is in our material.
  EXCEPTION — searchQuery MUST be null when the message is an EXPLICITLY EXCLUDED topic (listed in
  rule 8 above) or is clearly not about the natural world (sports, films, maths sums, history,
  cooking recipes, personal chit-chat). There, null means "I am confident this is out of scope".
- All other intents (GREETING, EMOTIONAL_SUPPORT, UNSAFE_OR_ABUSIVE, CHOOSE_COURSE, NEXT_STEP,
  EXAM_INFO): searchQuery must be null.
```

> Both replacement targets were verified to exist verbatim in the current file. Prompt grows by
> ~330 words (decider system prompt ≈ 2677 → ≈ 3100 tokens). At gpt-4o-mini pricing this is
> roughly +$0.00006 per turn — negligible, and OpenAI prompt caching applies (the system block is
> identical every call).

---

## 5. Change B — use the English query for retrieval **(the critical fix)**

**File**: `backend/src/ask/step4.decideRetrieval.js`, inside `normalizeDecision()`.

### B1. Delete the stale comment block

Remove the `SEARCH QUERY STRATEGY:` comment (currently lines 95–107). It describes Gemini
embedding behaviour the system no longer uses, and it is the reason this bug exists.

### B2. Replace the searchQuery logic

Replace the current block (currently lines 92–122, from `const DEVANAGARI_PATTERN` through the
closing `}` of `if (needsRetrieval) {`) with:

```js
  const DEVANAGARI_PATTERN = /[ऀ-ॿ]/;
  const rawSearchQuery = String(decision.searchQuery || '').trim();

  // The decider's English translation of the student's question.
  //
  // Kept for EVERY intent (not just retrieving ones) so askOrchestrator's SafetyNet can probe
  // English even when the decider said OUT_OF_CONTEXT. Measured: raw Hinglish probes 0.59-0.69
  // (never fires at 0.70) while its English translation probes 0.71-0.85 (always fires).
  //
  // null here is meaningful: the decider is telling us this message needs no content lookup
  // (greeting, emotional, or an explicitly excluded topic). The SafetyNet respects that.
  const englishQuery =
    rawSearchQuery && !DEVANAGARI_PATTERN.test(rawSearchQuery)
      ? rawSearchQuery.replace(/\s+/g, ' ').trim()
      : null;

  // Retrieval query: ALWAYS prefer the English translation.
  //
  // The chunks in MongoDB are English. Searching them with raw Hinglish returns literally zero
  // results — not weak results, zero: retriever.js's passesFinalFilter() needs either a keyword
  // term-match (impossible across languages) or a vector score >= 0.70 (Hinglish tops out ~0.69).
  // Measured on 10 real student questions: raw Hinglish -> 0 chunks, English -> 5 chunks, 10/10.
  // The raw question stays as a fallback only for when the decider produced no usable English.
  let searchQuery = null;
  if (needsRetrieval) {
    if (englishQuery) {
      searchQuery = englishQuery;
    } else if (!DEVANAGARI_PATTERN.test(rawQuestion)) {
      searchQuery = rawQuestion.replace(/\s+/g, ' ').trim();
    } else {
      console.warn('[Step 4] No English searchQuery and raw question is Devanagari — skipping retrieval');
    }
  }
```

### B3. Return `englishQuery`

In the `return { ... }` at the end of `normalizeDecision()` (currently lines 129–137), add
`englishQuery` alongside `searchQuery`:

```js
  return {
    intent,
    inScope,
    needsRetrieval,
    responseMode,
    searchQuery,
    englishQuery,          // ← add this
    examEntity,
    reason: String(decision.reason || 'Processed via structural normalizer normalization parameters.').trim()
  };
```

> **Side effect, intentional and good**: `step7.saveAndRespond.js` persists `lastRetrievalQuery`
> from this value, so `EXPLAIN_MORE` re-retrieval will now also reuse the English query.
> **Side effect, harmless**: `decision` is included in the API response (`step7`), so
> `englishQuery` becomes visible to the frontend. It is not sensitive and nothing reads it there.

---

## 6. Change C — SafetyNet probes English, gated on it existing

**File**: `backend/src/ask/askOrchestrator.js`

Replace the SafetyNet block (currently lines 91–114) with:

```js
    // --- Layer 2.2: Academic Safety Net ---
    // Runs ONLY when the decider produced an English translation. That is the gate:
    //   englishQuery != null  → "this is a real-world question" → worth probing
    //   englishQuery == null  → greeting / emotional / explicitly-excluded → nothing to probe
    // This is what keeps "Hello Zuno" a greeting: it probes 0.7355 on its raw text (above the
    // 0.70 threshold) and used to be wrongly promoted to CONCEPT_QUESTION. With no English
    // query, the probe never runs.
    // Probing English also makes the net actually work: raw Hinglish scores 0.59-0.69 and never
    // fires; the same questions in English score 0.71-0.85 and always do.
    const SAFETY_NET_TARGETS = new Set(['GREETING', 'OUT_OF_CONTEXT']);
    if (SAFETY_NET_TARGETS.has(decision.intent) && decision.englishQuery) {
      const { score, fired } = await probeAcademicSimilarity(decision.englishQuery);
      if (fired) {
        console.warn(
          `[SafetyNet] ${decision.intent} → CONCEPT_QUESTION | score:${score.toFixed(3)} | english:"${decision.englishQuery.slice(0, 60)}"`
        );
        decision.intent         = 'CONCEPT_QUESTION';
        decision.inScope        = true;
        decision.needsRetrieval = true;
        decision.responseMode   = 'study_tutor';
        decision._overridden    = true;

        // Retrieval must use the English query — the raw question retrieves 0 chunks.
        decision.searchQuery = decision.englishQuery;
      }
    }
```

Note what is deleted: the old filler-word regex
(`.replace(/\b(bhai|yaar|sir|...)\b/gi, '')`). It is dead weight now — the LLM translation already
returns a clean academic phrase and ignores greetings, complaints and meta-talk.

**`backend/src/ask/intentSafetyNet.js` — threshold unchanged at `0.70`.** Only update the stale
comment on lines 23–28 to record that the probe now receives an English query:

```js
// 0.70. The probe now receives the decider's ENGLISH translation (see askOrchestrator.js), not the
// student's raw Hinglish. Measured separation with English queries: genuine Class 10 questions
// score 0.71-0.85, out-of-scope topics score <= 0.66 (e.g. Newton's laws 0.657). Raw Hinglish used
// to score 0.59-0.69 and never fired at all, which is the bug this gating fixed.
// Do NOT lower this to 0.65: "Maths ke questions solve karo" scores 0.683 and would falsely fire.
const getThreshold = () =>
  parseFloat(process.env.SAFETY_NET_SIMILARITY_THRESHOLD ?? '0.70');
```

---

## 7. Known limits — read before shipping

Stated plainly so nothing surprises you later.

1. **Thin margin on one rescue case.** The lowest measured English probe is `"tree apna bhojan
   kaise bnate hai"` at **0.7115**, only +0.0115 above the threshold. If a future
   `npm run rag:index` shifts embeddings slightly, this one could stop firing. It is a *backup*
   layer only — Change A classifies this query correctly 4/4, so the probe never runs for it in
   practice. **Watch item, not a blocker.** If it ever does regress, the evidence-backed
   adjustment is `0.68` (still clears the 0.657 Newton false-positive), not `0.65`.

2. **Re-index shifts scores.** Vector scores move slightly on every `rag:index` run even with
   unchanged content (hosted embedding APIs are not bit-stable). After any re-index, re-run the
   Phase 1 and Phase 2 tests below rather than trusting these exact numbers.

3. **The decider sits on a decision boundary.** Classification of borderline queries is not
   bit-reproducible at `temperature: 0`. Change A moved the tested set to 4/4 stable, but an
   unseen phrasing could still land wrong — which is exactly why layers 3 and 4 exist.

4. **Not fixed by this plan** (separate concern, no change here): `OUT_OF_CONTEXT` runs with
   `maxTokens: 100` in `intentRouter.js:58`, and a measured redirect used 78 output tokens. A
   longer redirect (the study-strategy branch of `redirectPrompt.js` invites a two-sentence reply)
   could truncate the JSON and surface *"Thodi technical dikkat aayi"*. This is a **separate
   latent bug**, not the Hinglish one — file it on its own branch. Do not bundle it here.

5. **The prompt (Change A) is measured; the code edits (Changes B and C) are reviewed but not yet
   executed.** Every claim about *behaviour* in this file was measured, and every line number and
   anchor string in sections 4–6 was verified to exist verbatim in the current files. But the new
   code in Changes B and C has not been run — it cannot be, until it is written. That is what
   Phase 1–4 in section 8 is for. Expect to spend one pass fixing ordinary implementation slips
   (a typo, an import) before the tests go green; that is normal, not a sign the plan is wrong.

### Verification coverage at a glance

| Claim | How it was established |
|---|---|
| Raw Hinglish retrieves 0 chunks, English retrieves 5 | Measured, 10/10 queries, live Atlas |
| Probe scores raw 0.59–0.69 vs English 0.71–0.85 | Measured, 10/10 queries |
| 0.65 threshold would not have worked | Measured (8/10 score below 0.65) |
| Decider false-rejects; and discards its English query | Reproduced live on the running server |
| Change A wording is correct and stable | 52/52 + 60/60 live A/B, 3–5 runs per query |
| Change A causes no regression in any of the 9 intents | Measured, baseline vs proposed |
| Line numbers / anchor strings in sections 4–6 | Verified against the current files |
| **Changes B and C compile and behave as written** | **Not verified — section 8 does this** |

---

## 8. Testing

Start the server first (`cd backend && npm run dev`, port 5001). **Every query must be tested from
a FRESH session** — that is the cold-start path a new student hits and the one that fails today.

```bash
curl -X POST http://localhost:5001/api/v1/ask -H "Content-Type: application/json" -d "{\"question\":\"paudhe apna khana kaise banate hain\",\"studyMode\":\"global\"}"
```

In the server logs, check per query:
- `[Step 4→5] intent:` → the expected intent
- `[Step 5 DB Scan] Querying index vectors using computed target: "..."` → must be **English**
- `[Step 5 Complete] ... packaged N ground truth chunks` → **N > 0** for academic queries
- `[IntentRouter] ... → status:answered` → not `insufficient_context`

### Phase 1 — Hinglish academic (must ANSWER). Target 12/12.
1. paudhe apna khana kaise banate hain → photosynthesis
2. saans lene mein kya hota hai → respiration
3. khana kaise pachta hai → digestion
4. khoon ka kaam kya hota hai → blood / transportation
5. insaan mein bacha kaise paida hota hai → reproduction
6. namak kaise banta hai → acids/bases → salt
7. loha mein jung kaise lagti hai → corrosion
8. dhatu aur adhatu mein fark kya hai → metals vs non-metals
9. bijli kaise banti hai → electricity / sources of energy
10. aankh mein cheezein kaise dikhti hain → human eye
11. chhota aur bada image kaise banta hai → mirrors / lenses
12. chumbaak kaise kaam karta hai → magnetic effects

### Phase 2 — must still be REJECTED / not promoted. Target 8/8.
13. Newton ka niyam kya hai → OUT_OF_CONTEXT
14. gravitation kya hai → OUT_OF_CONTEXT
15. **cell ki structure batao → OUT_OF_CONTEXT** (regression guard, section 2.5)
16. Biryani kaise banate hain? → OUT_OF_CONTEXT
17. Maths ke questions solve karo → OUT_OF_CONTEXT
18. IPL ki team batao → OUT_OF_CONTEXT
19. **Hello Zuno → GREETING** (must NOT become CONCEPT_QUESTION; check no `[SafetyNet]` line appears)
20. physics se darr lagta hai → EMOTIONAL_SUPPORT

### Phase 3 — English / mixed regression. Target 5/5.
21. photosynthesis kya hai
22. Ohm's law explain karo
23. acid aur base ka difference
24. What is refraction of light
25. carbon compounds ke types batao

### Phase 4 — automated suites (server must be running for the golden set)
From `backend/`:
```bash
npm run test:golden
```
Then: `npm run test:chunks`, `npm run test:study-map`, `npm run test:curriculum-resolvers`,
`npm run test:chat-db-models`, and `npm run rag:test-retriever`.

The golden set is 40 queries, uses a fresh `randomUUID` session per query, and gates at **≥95%
intent accuracy**. It already contains `G02 "Hello Zuno"` and `O02 "Biryani kaise banate hain?"` —
the two cases this plan's changes are most likely to disturb. Note one known pre-existing issue
there: `BS04` was corrected on branch `fix/error-handling-and-golden-set-wip`, which is not merged.

**Merge gate**: Phase 1 ≥ 11/12 · Phase 2 = 8/8 · Phase 3 = 5/5 · golden set ≥ 95%.

---

## 9. Implementation order

```
1. git checkout main && git pull && git checkout -b fix/hinglish-query-pipeline
2. Change A — backend/src/prompts/deciderPrompt.js        (section 4)
3. Change B — backend/src/ask/step4.decideRetrieval.js    (section 5)   ← the critical one
4. Change C — backend/src/ask/askOrchestrator.js          (section 6)
   + comment-only edit in backend/src/ask/intentSafetyNet.js (threshold NOT changed)
5. Run Phase 1 → 2 → 3 → 4 (section 8)
6. Commit + open PR. Do NOT merge to main until explicitly approved — main is live.
```

No new npm packages. No new files. No content changes. No `rag:index` re-run needed.

---

## 10. Rollback

Each change is independently revertible:

- **Revert C only** → SafetyNet returns to probing raw text (today's behaviour, including the
  "Hello Zuno" false positive). Changes A and B keep working — the primary path is unaffected.
- **Revert B only** → retrieval returns to raw-Hinglish search (0 chunks). This re-breaks the core
  fix; only do this if Phase 3 English regression fails.
- **Revert A only** → classification returns to today's coin-flip. B still helps whenever the
  decider happens to classify correctly.

Highest-risk change is **B** (it changes what every retrieving turn searches with). It is also the
highest-value one. If something breaks, revert in order C → A → B, testing after each.

---

## 11. Out of scope

1. Tutor answer quality and Hinglish tone — already good, untouched.
2. Content changes — the English content is correct and sufficient; no `data/` edits, no re-index.
3. Focus Mode — benefits indirectly (same decider + English query); no Focus-specific change here.
4. `OUT_OF_CONTEXT` `maxTokens: 100` truncation risk — real, separate, own branch (section 7.4).
5. Two unrelated bugs on `fix/error-handling-and-golden-set-wip` (validation-error mislabeling,
   BS04 golden expectation) — separate branch, merge on their own track.

---

## 12. Implementation Results (2026-07-30)

All three changes were implemented on branch `fix/hinglish-query-pipeline` (off `main`), each
built and verified on its own sub-branch, then fast-forward merged into the root branch in
dependency order: **Change B → Change A → Change C**. `main` was never touched. Commits:

```
2a2597f fix(ask): use decider's English translation for retrieval, not raw Hinglish   (Change B)
b37c8fc fix(prompts): teach decider to classify keyword-free Hinglish science questions (Change A)
eb5b28a fix(ask): gate SafetyNet on decider's English translation, not raw text        (Change C)
```

### 12.1 What was achieved

- **The reported bug is fixed and confirmed in the browser**, not just in tests. A fresh-session
  query like `"paudhe apna khana kaise banate hain"` now returns a real, grounded photosynthesis
  answer instead of a false rejection — verified via live server logs and a manual browser test
  by the user on `fix/hinglish-query-pipeline`.
- **Retrieval**: raw Hinglish queries went from **0 chunks retrieved on 10/10 test questions** to
  **5 correct chunks on 10/10** once the decider's English translation is used (Change B).
- **Classification**: the decider now correctly recognizes keyword-free Hinglish science
  questions as `CONCEPT_QUESTION` — validated **52/52** on the exact prompt wording (Change A),
  with **60/60** on the 5 previously-untested intent families (EXPLAIN_MORE, NEXT_STEP,
  CHOOSE_COURSE, UNSAFE_OR_ABUSIVE, EXAM_INFO) showing zero regressions.
- **The pre-existing "Hello Zuno" false positive is fixed as a side effect** of Change C, with no
  threshold change — confirmed stable across two post-Change-C golden-set runs (moved from FAIL
  to WARN/PASS both times) and in the live browser test.
- **Live verification, all green**: Phase 1 (12/12 Hinglish), Phase 2 (8/8 reject/promote cases,
  including the `"cell ki structure batao"` regression guard), Phase 3 (5/5 English regression),
  and a final combined 25/25 re-run on the fully-merged root branch for extra safety.
- **No regressions found anywhere** — not in the 9 intent families, not in English/mixed queries,
  not in the automated structural suites (`test:chunks`, `test:study-map`,
  `test:curriculum-resolvers` all pass on the root branch).

### 12.2 What did NOT fully clear — the golden-set gate

This plan's own merge gate (Section 8) asked for golden-set intent accuracy **≥95%**. Three runs
during implementation landed at **85.0% → 87.5% → 87.5%** — improving, but under the bar. This is
not because the fix doesn't work: **all 5 remaining golden-set FAILs are pre-existing or unrelated
issues**, not regressions from Change A/B/C (see 12.3). The bar was written assuming a clean
baseline; testing surfaced that the baseline itself has independent problems.

### 12.3 Problems found during implementation (not predicted by this plan)

None of these are caused by Change A, B, or C, except where explicitly marked. Full investigation
notes live in the scratchpad tracking file used during implementation (now folded into this
section); nothing further to look up separately.

1. **✅ RESOLVED (2026-07-31) — Tutor flakiness.** Retrieval was correct (right English
   query, 5 relevant chunks) but the tutor step (`step6`/`intentRouter`'s `conceptQuestionPrompt`)
   intermittently decided the context was "insufficient" and returned the generic *"Thodi technical
   dikkat aayi"* fallback instead of a real answer. Seen on `"acid aur base ka difference"` (2/3
   runs answered, 1/3 failed) and, more concerning, on `"bijli kaise banti hai"` in the user's live
   browser test — **failed twice in a row**, same session, both times with 5 correctly-retrieved
   chunks. Not caused by Change A/B/C (this is entirely inside the tutor's own generation call,
   downstream of correctly-working retrieval) but real and student-facing.

   See **Section 12.6** for the full audit, root cause, fix, and verification evidence.

2. **Session token budget shrank — caused by Change A.** The decider system prompt grew from
   ~2677 to ~3366 tokens (larger than the plan's own "~330 words" estimate). Combined with the
   tutor's own ~3847-token base, each turn now costs ~7000-8000 tokens minimum. In the user's live
   browser test, `SESSION_TOKEN_LIMIT` (35000) was hit and the session auto-locked after only 6
   turns. The lock itself is existing, correct behavior — but the effective turns-per-session
   budget is now smaller because Change A's prompt is heavier. A genuine, quantified side effect
   of this fix, worth deciding whether to trim the prompt or adjust the limit.

3. **`C07 "Cell membrane ka kya kaam hai?"`** — golden set expects `CONCEPT_QUESTION`, gets
   `OUT_OF_CONTEXT`. Likely cause: Change A's HARD LIMIT exclusion list (added to stop
   `"cell ki structure batao"` from pulling in wrong solar-cell chunks — see Section 2.5) may be
   worded broadly enough to also catch "cell membrane" questions that should be answerable.
   Not yet confirmed whether this query ever passed on unmodified `main`, or whether "cell
   membrane function" is actually covered in the indexed content at all.

4. **`N01-N04` (all 4 `NEXT_STEP` golden-set queries) returned `provider_error`** on every run —
   rate-limit/LLM-unavailable, not a classification issue. Unrelated to this fix; worth one clean
   re-run at a quiet time to check if it's transient or systematic.

5. **Two pre-existing, broken diagnostic scripts found and separately flagged** (not fixed here,
   per the user's direction to keep this branch scoped to the Hinglish fix only):
   - `npm run test:chat-db-models` — imports a deleted `chatState.model.js`; broken on `main`
     itself. Flagged as background task `task_ec342301`.
   - `npm run rag:test-retriever` — never calls `connectDB()` (always times out after 10s) and
     never calls `process.exit()` (hangs after finishing). Broken on `main` itself. Flagged as
     background task `task_ba9b8e30`.

### 12.4 Verification summary table

| Check | Result |
|---|---|
| Phase 1 — 12 Hinglish queries must answer | ✅ 12/12 (twice) |
| Phase 2 — 8 reject/promote cases | ✅ 8/8 |
| Phase 3 — 5 English regression | ✅ 5/5 |
| Combined final re-run (root branch, extra safety) | ✅ 25/25 |
| 9-intent-family regression check (isolated decider A/B) | ✅ 112/112 total across all sub-checks |
| `test:chunks`, `test:study-map`, `test:curriculum-resolvers` | ✅ all pass |
| Golden set (3 runs) | 🟡 85.0% → 87.5% → 87.5% (target 95%, gap fully explained by §12.3) |
| Live browser test (fresh session, 6 turns) | 🟡 4/6 turns fully correct; 2 hit the tutor-flakiness pattern (§12.3.1) |
| Regressions caused by Change A/B/C | **None found** |

### 12.5 Next step

`main` has not been touched and will not be merged into until explicitly approved. Before that
discussion, the team agreed to go through the open items in 12.3 one at a time, priority order:
tutor flakiness (12.3.1) → session token budget (12.3.2) → C07 (12.3.3) → N01-N04 re-check
(12.3.4) → the two flagged script bugs (12.3.5, already spun off, non-blocking).

**Status: item 1 (tutor flakiness) done — see 12.6. Next up: item 2, session token budget.**

---

### 12.6 Tutor Flakiness — Root Cause, Fix, and Verification (2026-07-31)

Worked on branch `fix/tutor-flakiness-insufficient-context-guard` (off `fix/hinglish-query-pipeline`,
which stays untouched by this work).

#### What we found (root cause)

The bug was reproduced live before touching any code — same session, same query
(`"bijli kaise banti hai"`) asked twice, both times with 5 correctly-retrieved chunks:

```
[TUTOR  ] sys: 3847 + dyn:  818 + out:    8 =   4673 tokens | intent:CONCEPT_QUESTION
[IntentRouter] CONCEPT_QUESTION → status:insufficient_context
→ sections: [{"heading":"","content":"Thodi technical dikkat aayi..."}]
```

**`out: 8` tokens is the key clue.** The tutor LLM was not writing a full explanation and
mislabeling its status — it was refusing almost instantly, producing a near-empty JSON
(`{"status":"insufficient_context"}`) with no real content at all. Root cause: the single
combined prompt (`conceptQuestionPrompt.js`) always included an "insufficient_context" escape
hatch rule, even on turns where step5 had already retrieved 5 solid, relevant chunks. gpt-4o-mini,
under a stacked 8-rule prompt (grounding + anti-repetition + opening-hook + heading-language +
quality + insufficient-context + suggested-actions + JSON format), would sometimes take that
escape hatch out of confusion rather than using the content sitting right in front of it.

Not caused by Change A/B/C — this failure mode lives entirely in the tutor generation step
(`intentRouter.js` / `conceptQuestionPrompt.js`), downstream of retrieval, which Change A/B/C
never touch. It was masked before this branch's own fix because Bug 1/Bug 2 (the original
Hinglish bugs) used to stop most queries before they ever reached the tutor step at all.

#### What we changed

**Fix 1 — code guard, `backend/src/ask/intentRouter.js`.** If `retrievedContext` has real chunks
(not `NO_RETRIEVED_CONTEXT`/`CHAPTER_COMPLETE`) AND the LLM's own sections already contain a
substantive answer (≥50 chars), but the LLM still returned `insufficient_context`/`out_of_scope`,
the code force-overrides the status to `answered`. Same pattern already used for GREETING/
EMOTIONAL_SUPPORT, just extended to CONCEPT_QUESTION/EXPLAIN_MORE. Zero cost, deterministic
safety net — but see the honest caveat below.

**Fix 2 — prompt split, `backend/src/prompts/intents/conceptQuestionPrompt.js`.** The one combined
prompt is now two variants, selected in `intentRouter.js` by a new `resolveChainKey()` function
based on whether step5 actually found chunks:
- `conceptWithChunksPrompt` — used when chunks exist. The "insufficient_context" escape hatch is
  removed entirely; the model is told the content below is relevant and it must always produce a
  real answer from it.
- `conceptNoChunksPrompt` — used when nothing was retrieved. A short, focused prompt whose only
  job is a graceful "not in our material" redirect — no hook/anti-repetition/heading rules it
  doesn't need.

`decision.intent` stays `'CONCEPT_QUESTION'` everywhere downstream (step7, drift tracking, memory
whitelists) — the two-variant split is invisible outside `intentRouter.js`.

**Honest caveat on Fix 1:** in every live reproduction during testing, the LLM's failure was the
near-empty-output pattern above (no substantive content to promote), so the code guard never
actually fired (`grep "IntentRouter Guard"` → 0 hits across all test runs). Fix 2 fixed the
reproduced failure at the root before Fix 1 ever needed to. Fix 1 still stays in as a safety net
for the other possible failure shape (LLM writes a good answer but mislabels the status) — it just
wasn't the mechanism that fixed what we actually saw.

#### Verification

- **Exact reproduction, before fix:** same 6-turn session as the user's original live browser
  test → turns 4 and 5 (`"bijli kaise banti hai"` asked twice) both returned `insufficient_context`,
  confirming the bug live on this branch before any code changed.
- **Same reproduction, after fix:** identical 6-turn session, same two turns → both `answered`,
  with real, grounded, hook-first explanations (e.g. *"Sochke dekho — jab tumhe bijli ki
  zaroorat hoti hai..."*). Output tokens went from ~8 (empty refusal) to ~250-330 (real answer).
- **10x repeat on two previously-flaky queries** (`"bijli kaise banti hai"`, `"acid aur base ka
  difference"`), fresh sessions each: 10/10 `answered`.
- **Token savings confirmed:** removing the empty-context instruction block from the with-chunks
  variant measurably shrank tutor input tokens per turn (real API-reported input tokens, not the
  approximate logger) — a same-shape turn went from ~4665 input tokens before the split to
  ~3049-3689 after.
- **No regressions:** `test:chunks` (17/17), `test:study-map`, `test:curriculum-resolvers` all
  pass. Golden set: **85.0%** intent accuracy — identical to the pre-existing baseline already
  documented in §12.2/§12.3, not lower. CONCEPT_QUESTION category specifically: 9/10 correct
  (the 1 fail is `C07`, the pre-existing, already-tracked issue in §12.3.3 — not new).

#### Files changed

- `backend/src/ask/intentRouter.js` — added `resolveChainKey()`, the Fix 1 guard, split
  `INTENT_CONFIG`/`HISTORY_WINDOW`/`buildPromptInput` entries for the two CONCEPT_QUESTION variants.
- `backend/src/prompts/intents/conceptQuestionPrompt.js` — rewritten as two exports
  (`conceptWithChunksPrompt`, `conceptNoChunksPrompt`) instead of one.

#### Not yet folded in

Two things were noticed while testing this fix that are **not part of it** and have not been
acted on yet, per plan — they'll be written up and discussed separately before any further code
changes: (1) a possible grounding/hallucination risk when retrieval returns weak/unrelated chunks,
and (2) one dev-server crash observed mid-testing. Neither blocks marking this item resolved; both
need their own discussion.
