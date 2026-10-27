# STREAM_FAILURE_FIX_PLAN.md

> **Branch:** `STREAM_FAILURE_FIX` (main ke upar banaya gaya)
> **Author role:** Senior Architect + Senior Engineer (design pehle, approval ke baad code)
> **Status:** DESIGN — abhi koi code nahi likha gaya. Sirf plan.
> **Date:** 2026-08-24
> **Golden rule for this doc:** har claim code se proven hai. Koi assumption nahi.

---

## 0. Trigger — kya hua tha

Screenshot mein do galat cheezein dikhi:

1. Student ne `hii` bola → Zuno ne "kaunsa chapter padhna hai" wala **study-answer** jaisa reply diya (greeting nahi).
2. Student ne `Aage badho` bola → Zuno ne literally **`Explanation here`** dikha diya, aur us message par **koi chip nahi** thi.

Ye ek **silent failure in a streaming system** hai — sabse mushkil type, kyunki app ne koi error nahi dikhaya; toota hua adhura jawaab ek **complete answer** jaisa dikh gaya.

---

## 1. Difficulty & Category

**Category:** Reliability / robustness bug in a distributed streaming pipeline (feature bug nahi).

**Difficulty:** **Medium.** Algorithm mushkil nahi. Mushkil ye 3 baatein hain:

- **Do independent layers** ne alag-alag fail kiya (LLM behaviour + network/stream handling).
- **Intermittent** — hamesha nahi hota (live re-test mein `hii` sahi gaya).
- **Invisible** — koi error surface nahi hua; failure complete-answer jaisa dikha.

Isliye fix ek hi jagah nahi ho sakta — **defense-in-depth** chahiye: har layer apne aap ko validate kare.

---

## 2. Evidence-based Root Cause (sab code se proven)

### Pehle: ye baat jispe poora analysis tika hai

`askOrchestrator.js` ka `catch` block **hamesha** `streamCallbacks.onComplete(payload)` call karta hai — yaani ek `event:'end'` frame bhejta hai — chahe provider fail ho ya unexpected error ho. Aur `intentRouter.js` ka JSON-parse fail hone par output `"Thodi technical dikkat aayi..."` hota hai, **kabhi `"Explanation here"` nahi**.

- Proof: `backend/src/ask/askOrchestrator.js` (dono catch branches `onComplete` call karte hain).
- Proof: `backend/src/ask/intentRouter.js` — parse-error fallback (`status:'error'`, curated message).

**Nateeja:** `"Explanation here"` sirf tab aa sakta hai jab **LLM ne valid JSON ke andar placeholder bhar diya** — kyunki ye string poore repo mein sirf 3 prompt files mein example ke roop mein maujood hai, aur kahin aur nahi.

- Proof (grep): `backend/src/prompts/intents/conceptQuestionPrompt.js` (2 jagah), `backend/src/prompts/intents/nextStepPrompt.js` (1 jagah). Baaki poore codebase mein zero.

### Defect list

| # | Defect | Layer | Evidence (file) | Severity |
|---|--------|-------|-----------------|----------|
| **D1** | LLM example-JSON ka placeholder `"Explanation here"` literally copy kar deta hai; backend mein koi guard nahi jo isse pakde | Backend (prompt + validation gap) | `intentRouter.js` `normalizeSections` sirf empty content filter karta hai — placeholder ko rakh leta hai | **High** |
| **D2** | Stream toote toh adhura (partial) message **complete answer** jaisa render hota hai | Frontend (render) | `frontend/src/components/ChatMessage.jsx` sirf `thinking` aur `focus_context_not_found` status handle karta hai; `error`/`cancelled`/partial normal render hote hain | **Highest** (isne bug ko chhupaya) |
| **D3** | SSE read-loop mein `JSON.parse(dataStr)` bina try/catch (defense-in-depth) | Frontend (hardening) | `frontend/src/api/tutorApi.js` — SSE loop | **Medium** |
| **D4** | Agar `'end'` frame na aaye toh `finalPayload` null; `payload.session?...` par crash | Frontend | `frontend/src/pages/ChatPage.jsx` `handleAsk` — `const backendSessionId = payload.session?.sessionId` (payload khud null ho toh throw) | **Medium** |
| **D5** | `hii` kabhi-kabhi `CONCEPT_QUESTION` classify ho jaata hai (GREETING ke bajaye) | Backend (decider) | Message-1 mein copy/share icons (`responseMode==='study_tutor'`) + chapter-list wording = `CONCEPT_QUESTION_NO_CHUNKS` path, GREETING nahi | **Medium** (alag scope) |

### Message-2 ka decisive proof (no-chips signal)

`step7.saveAndRespond.js` ka `sanitizeSuggestedActions` Focus Mode mein `CONCEPT_QUESTION`/`EXPLAIN_MORE`/`EXAM_INFO` (aur `NEXT_STEP` + `nextTopicSignal`) par `"Aage badhein"` chip **force** karta hai (prepend).

- Message-2 par **koi chip nahi** thi ⟹ ye response step7 se **guzra hi nahi** ⟹ **stranded partial** (stream beech mein toota, backend ne complete karke save nahi kiya).
- Ye conclusion `NEXT_STEP` ya `CONCEPT_QUESTION` — dono intents ke liye hold karta hai (focus mode dono par chip force karta), isliye exact intent guess karne ki zaroorat nahi. **Koi assumption nahi.**

Iska matlab message-2 = **D1 (LLM ne placeholder emit kiya) + D2 (stream toota, adhura render hua)** — dono zaroori. Design dono ko cover karta hai.

---

## 3. Re-audit: pehle draft se kya refine/correct hua

Transparency ke liye — final design pehle wale verbal design se in jagah alag hai (evidence ke against re-check karke):

1. **CORRECTION:** "token content mein `\n\n` frame tod deta hai" wali theory **galat** thi. Backend `res.write(\`data: ${JSON.stringify({token})}\n\n\`)` karta hai — `JSON.stringify` newlines ko `\\n` escape kar deta hai, isliye token content SSE frame boundary nahi tod sakta. Isliye **D3 ek defense-in-depth hardening hai, confirmed trigger nahi.**
2. **CONFIRMED TRIGGER:** stranded partial ka asli kaaran = **stream interruption** (network drop / client disconnect / 60s timeout abort) jiske baad `'end'` frame nahi aata → `finalPayload` null → crash (D4) → catch → adhura message (D2).
3. **REFINEMENT:** kai alag failure-status hain — `error` (intentRouter curated fallback), `provider_error` (orchestrator curated), `cancelled` (frontend abort). Inme se `error`/`provider_error` backend ke **intentional complete messages** hain jo theek render hone chahiye. Isliye D2 mein **naya frontend-only status `stream_incomplete`** banega — purane statuses ko overload nahi karenge (warna curated messages regress ho jaayenge).
4. **CONFIRMED:** D4 (null crash) D3 ke null-guard se hi solve ho jaata hai — dereference se pehle `StreamIncompleteError` throw karke.
5. **CONFIRMED:** Fix-A guard existing **proven** `status:'error'` fallback path reuse karta hai (parse-error already yahi return karta hai aur step6→step7 se safely guzarta hai) → zero naya risk.

---

## 4. Solution Design (layer by layer, defense-in-depth)

**Core principle:** LLM galti kare toh backend pakde. Stream toote toh frontend saaf dikhaye + retry de. Ek bhi galat/adhuri cheez student ko complete answer jaisi na dikhe.

### Fix A — Backend: Placeholder Guard (D1)

**Reasoning:** Prompt ko sirf "better instruction" dena kaafi nahi — LLM probabilistic hai, kabhi bhi phir echo kar sakta hai. Asli fix ek **deterministic code guard** hai.

- **File:** `backend/src/ask/intentRouter.js`
- **Function modify:** `routeToIntentHandler` (parse block, `sections` normalize hone ke turant baad)
- **Naya banega:** `PLACEHOLDER_SIGNATURES` (Set) + `isPlaceholderResponse()` helper

**Illustrative (proposed, abhi implement nahi):**

```js
const PLACEHOLDER_SIGNATURES = new Set([
  'explanation here', 'section heading', 'short topic title',
  'topic title from retrieved content', 'simple hinglish question',
  'your hinglish question here',
]);

const isPlaceholderResponse = (sections) =>
  sections.length > 0 &&
  sections.every((s) => PLACEHOLDER_SIGNATURES.has(s.content.trim().toLowerCase()));
```

`sections` normalize hone ke baad:

```js
if (isPlaceholderResponse(sections)) {
  console.error(`[IntentRouter] Placeholder leak for "${intent}" — falling back`);
  logCallTokens('TUTOR', capturedBreakdown, { mode: responseMode, intent, status: 'PLACEHOLDER_LEAK' });
  return {
    status: 'error', responseMode: responseMode || 'study_tutor', title: null,
    sections: [{ heading: '', content: 'Thodi technical dikkat aayi. Apna sawaal ek baar aur poochho.' }],
    suggestedActions: [], memoryUpdate: {},
    tokenUsage: capturedBreakdown.total, tokenBreakdown: capturedBreakdown,
  };
}
```

**Prompt hardening (secondary):** `conceptQuestionPrompt.js` aur `nextStepPrompt.js` mein `"Explanation here"` ko `"<yahan asli answer likho — ye words mat likho>"` se replace + ek explicit rule "Never copy the literal words from the example." Ye leak-rate ghatata hai; par asli safety code guard hi hai.

**Safety:** Guard **exact lowercase match** par chalta hai. Hinglish answers kabhi literally `"explanation here"` nahi honge → false-positive ~0. `"Aage badhein"` ko list mein **nahi** rakha (wo asli hardcoded chip hai — `DEFAULT_NEXT_TOPIC_ACTION`).

---

### Fix B — Frontend: Stranded partial ko VISIBLE + retryable banao (D2) — *sabse zaroori*

**Reasoning:** Backend perfect ho jaye tab bhi network kabhi bhi toot sakta hai (mobile, tab background, 60s timeout). Jab toote, student ko saaf pata chale — adhura message complete jaisa **kabhi** nahi dikhna chahiye.

- **File 1:** `frontend/src/pages/ChatPage.jsx`
  - **Function modify:** `handleAsk` ka `catch` block — jab `!isFirstUpdate` (yaani partial screen par aa chuka), stranded message ka status ek **naye** `'stream_incomplete'` par set karo (na ki chup-chaap `error`/`cancelled`).
  - **Naya:** `handleRetry(failedMessage)` callback — pichhla student question dobara `handleAsk(question, studyModeRef.current)` se bhejta hai. (`question` pehle se har `ChatMessage` ko prop milti hai — ChatPage render loop use compute karta hai.)
- **File 2:** `frontend/src/components/ChatMessage.jsx`
  - **Function modify:** render — `stream_incomplete` (aur `cancelled` jinme partial ho) ke liye ek visible banner + retry button. Backend ke curated `error`/`provider_error` messages waise ke waise render honge (unke paas already helpful text hai) → **zero regression**.
  - **Naya prop:** `onRetry`.

**Illustrative (proposed):**

```jsx
// ChatMessage.jsx
const isIncomplete = message.status === 'stream_incomplete';
// ...render, sections/prose ke neeche:
{isIncomplete && (
  <div className="message-failed">
    <span>⚠️ Ye jawaab poora nahi aa paaya.</span>
    <button className="retry-chip" onClick={() => onRetry?.(message)}>Dobara try karo</button>
  </div>
)}
```

- **File 3:** `frontend/src/styles/global.css` — naya `.message-failed`, `.retry-chip` (existing `.action-chip` ke paas, ~line 1378).

---

### Fix C — Frontend: SSE parse harden karo (D3 + D4)

**Reasoning:** Ek kharab frame poora stream na maare; aur `'end'` na aaye toh clean error state banao (crash nahi).

- **File:** `frontend/src/api/tutorApi.js`
- **Function modify:** SSE reading loop

**Illustrative (proposed):**

```js
// D3 — ek kharab frame poora stream na maare
let dataObj;
try { dataObj = JSON.parse(dataStr); }
catch { continue; }              // is frame ko skip karo, agla padho

// D4 — loop ke baad, agar 'end' aaya hi nahi:
if (finalPayload === null) {
  const e = new Error('Stream incomplete');
  e.name = 'StreamIncompleteError';
  throw e;                        // payload.session dereference se PEHLE
}
```

`ChatPage.handleAsk` ka catch is `StreamIncompleteError` ko pakad kar `stream_incomplete` state set karega (Fix B). Isse D4 ka null-crash automatically fix ho jaata hai.

---

### Fix D — Backend: Decider ko `hii` sikhāo (D5) — *alag scope, chhota*

- **File:** `backend/src/prompts/deciderPrompt.js` — greeting examples strong karo (`hii/hi/hlo/hey/namaste → GREETING`).
- **Note:** Ye standalone hai. Quiz-protocol/"ek cheez ek baar" discipline ke hisaab se ise is stream-failure fix ke saath **bundle nahi karenge**. Alag chhoti PR / follow-up.

---

## 5. Files touched — ek nazar mein

| File | Kya hoga | Fix |
|------|----------|-----|
| `backend/src/ask/intentRouter.js` | **Modify** `routeToIntentHandler` + **naya** `PLACEHOLDER_SIGNATURES`, `isPlaceholderResponse()` | A |
| `backend/src/prompts/intents/conceptQuestionPrompt.js` | **Modify** example placeholder + rule | A |
| `backend/src/prompts/intents/nextStepPrompt.js` | **Modify** example placeholder + rule | A |
| `frontend/src/pages/ChatPage.jsx` | **Modify** `handleAsk` catch + **naya** `handleRetry`; `onRetry` prop pass | B |
| `frontend/src/components/ChatMessage.jsx` | **Modify** render (incomplete state) + **naya** `onRetry` prop | B |
| `frontend/src/styles/global.css` | **Naya** `.message-failed`, `.retry-chip` | B |
| `frontend/src/api/tutorApi.js` | **Modify** SSE loop (try/catch + null-guard) | C |
| `backend/src/prompts/deciderPrompt.js` | **Modify** greeting examples | D (alag) |
| Test (naya) | Placeholder-guard golden test | A |

---

## 6. Existing flow par impact

| Fix | Happy-path impact | Backward compat |
|-----|-------------------|-----------------|
| A | **Zero** — sirf exact-placeholder match par chalta hai; normal answer chhua nahi jaata; negligible CPU. Reuse existing `status:'error'` path. | DB schema same, API same, koi naya env var nahi |
| B | **Zero** — sirf naya `stream_incomplete` state add hota hai; backend curated messages waise render honge; streaming render waisa hi | Purely additive UI + naya optional prop |
| C | **Zero** — sirf malformed frame skip + null-guard | Additive |
| D | Greeting classification behtar | Prompt-only |

**Regression surface chhota.** Sabse zyada dhyan Fix-A ke false-positive par — par exact lowercase match + Hinglish answers = practically impossible. Golden test isko lock karega.

---

## 7. Future / Scalability impact

1. **Scale par network drops badhenge** (zyada mobile/weak-network students). Fix B/C aaj se hi us load ke liye ready — invisible failure ka silsila khatam.
2. **Guard pattern generalize hota hai** — naye intents/prompts (Quiz System bhi aa raha hai) automatically usi `isPlaceholderResponse` se protected.
3. **Observability — sabse bada long-term win.** Abhi ye failure kisi counter mein aata hi nahi. `PLACEHOLDER_LEAK` log + `stream_incomplete` count se aap **measure** kar paoge ki prod mein kitni baar hota hai. Launch se pehle zaroori.
4. **Retry ek shared utility** ban sakta hai — aage har failed action reuse karega.

---

## 8. Testing & Verification (baseline before + after — same command dono baar)

**Backend (Fix A):**

```
cd backend
npm run test:golden          # existing regression — pehle green, baad mein bhi green
npm run test:chunks
npm run test:study-map
npm run test:curriculum-resolvers
```

- **Naya test:** placeholder input → guard fires (fallback message aata hai); normal Hinglish answer → guard silent (kuch nahi badalta). `test:golden` ke saath add karenge.

**Frontend (Fix B/C):**

```
cd frontend
npm run build                # syntax/build clean hona chahiye
```

- Manual/interactive verification **user karega** (memory: self browser-testing nahi karni — build/syntax check bas).

**Reproduce/verify without live users:**
- Stream-break simulate: request ko beech mein abort karke dekho ki `stream_incomplete` + retry dikhta hai (complete-answer jaisa nahi).
- Placeholder guard: intentRouter ko forcibly placeholder-JSON dekar fallback confirm.

---

## 9. Rollout order (senior recommendation)

1. **Fix B + Fix C ek saath** (frontend robustness) — ye woh cheez thi jisne bug chhupaya. Isse aage koi bhi failure kam se kam **dikhega** + retry milega.
2. **Fix A** (backend placeholder guard) — root of the `"Explanation here"` text.
3. **Fix D** (decider `hii`) — baad mein, alag PR.

**Branch/PR:** ye branch `STREAM_FAILURE_FIX`. `main` par kabhi seedha commit nahi. Har fix apne logical commit mein; merge tabhi jab user explicitly bole.

---

## 10. Out of scope (abhi nahi karenge)

- Full retry/backoff framework (abhi simple single retry kaafi).
- Prod DB forensic read (refresh-test se disambiguate ho jaata hai; alag se karenge agar chahiye).
- Decider ka bada overhaul — sirf `hii` example fix (D5), wo bhi alag.
- Koi naya npm package (zaroorat nahi).

---

## 11. Decisions — LOCKED (2026-08-24)

1. **`stream_incomplete` par partial content — RAKHENGE.** Partial ko dimmed dikhaenge + "poora nahi aaya" banner + Retry button. (Student ko context dikhta rahe.)
2. **Retry current mode mein bhejega** — `studyModeRef.current`. Failed turn ka original mode capture nahi karenge (simpler; user usually same mode mein hi hota hai).
3. **Fix D (decider `hii`) — ALAG BRANCH, BAAD MEIN.** Is branch ko sirf streaming/placeholder tak tight rakhenge. Fix D ke liye baad mein naya branch `DECIDER_GREETING_FIX` (decider prompt ka blast-radius bada hai → apna focused golden-test deserve karta hai; aur A/B/C khud D5 ka nuksaan ghata dete hain, isliye defer safe hai).

---

## 12. Definition of Done

- [x] Fix B + C: stream toote toh `stream_incomplete` + Retry dikhta hai; `payload` null par crash nahi; kharab frame se loop nahi marta.
- [x] Fix A: placeholder-JSON kabhi student tak nahi pahunchti; normal answers untouched; unit test (`npm run test:placeholder-guard`) pass — `isPlaceholderResponse` exported from `intentRouter.js`, 7 cases covered.
- [x] Baseline tests: `test:chunks`, `test:study-map`, `test:curriculum-resolvers` — pehle green thay, ab bhi green. (`test:chat-db-models` pre-existing broken — stale import of a deleted `chatState.model.js`, unrelated to this fix, not touched.)
- [x] `frontend npm run build` clean. (verified 2026-08-24 — `vite build` succeeded, 811 modules transformed, no errors)
- [x] Prompt hardening done (secondary) — `conceptQuestionPrompt.js` (2 spots) + `nextStepPrompt.js` (1 spot) placeholder text replaced with non-copyable field descriptions.
- [x] Fix D alag se tracked. (deferred to `DECIDER_GREETING_FIX` branch, as planned — that branch now has Fix D committed: `hii`/`heyy`/etc. added as GREETING examples in `deciderPrompt.js`, golden set 42/42 intent accuracy, commit `77c3010`)
