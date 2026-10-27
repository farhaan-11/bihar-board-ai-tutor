# BUG-1 / BUG-2 FIX PLAN — Decider structured output

> **STATUS: ✅ DONE — merged to `main` 2026-08-28 (ADR-011).**
> Kept as the record of how it was done. Nothing here is pending.
> Verified by `npm run test:decider-structured` + a live dev-server run
> against real OpenAI (`strict: true` accepted; Hinglish→English `searchQuery`
> translation still works). Baseline unchanged.
>
> Stage 1, Section C. Followed `AUDIT_RULES.md` Rule 4 (cause removed, no new
> layer) and the explain → confirm → one-step-at-a-time discipline.

---

## 1. Simple mein — problem kya hai

Zuno har sawaal pe pehle **decider** LLM ko bulata hai. Decider batata hai: yeh
sawaal kis type ka hai (science question? greeting? bakwaas?).

LLM sirf **text** wapas bhejta hai. Humein chahiye **saaf data**:

```json
{ "intent": "CONCEPT_QUESTION", "searchQuery": "...", "examEntity": null, "reason": "..." }
```

Toh hum LLM se request karte hain "yeh JSON likhna", phir `jsonParser.js` us
text ko padh ke object banata hai.

**Kabhi-kabhi woh text toota hua aata hai** — adhoora, ya beech mein extra
baatein. Tab `parseJsonObject()` crash karta hai. Crash pe
`step4.decideRetrieval.js` ghabra ke ek "safe guess" laga deta hai:

```js
// step4.decideRetrieval.js:207-216 — aaj ka code
return {
  intent: 'CONCEPT_QUESTION',
  needsRetrieval: false,   // ← yeh line bug hai
  searchQuery: null,
  ...
};
```

`CONCEPT_QUESTION` + `needsRetrieval: false` ek saath rakhi hi nahi ja sakti.
Aage jaake ([step5:181](backend/src/ask/step5.retrieveContent.js:181) →
[intentRouter resolveChainKey](backend/src/ask/intentRouter.js:216)) student ko
`CONCEPT_QUESTION_NO_CHUNKS` prompt milta hai, jiska output hardcoded hai:

> "Yeh topic aapke Class 10 Bihar Board Science material mein nahi hai."

**Topic syllabus mein hota hai. Sirf LLM ka text ek second ke liye toota tha.**
Yeh BUG-1.

**BUG-2** issi jagah se aata hai: agar LLM ka JSON theek hai par `intent` ki
value galat/typo hai ("CONCEPT_QUESTON"), toh
[step4:77](backend/src/ask/step4.decideRetrieval.js:77) use `GREETING` maan
leta hai → science sawaal small-talk ban jaata hai → drift counter badhta hai →
10 turn baad student hard-block ho jaata hai.

---

## 2. Kyun yeh Rule 4 ka mamla hai (aur symptom patch kyun mana hai)

`AUDIT_RULES.md` Rule 4:

> "Koi bhi fix jo fallback/guard/override *add* karta hai, use woh **cause**
> hatana padega. Sawaal: 'yeh kaunsa cause hata raha hai?' Agar jawab 'koi nahi,
> sirf symptom' — fix rejected."

Ek symptom patch hota: "safe guess ko smart banao — `needsRetrieval: true` kar
do." Isse message theek ho jaata **par crash phir bhi hota rehta.** Yeh woh loop
hai jisne project ko mahino phasaaye rakha. Isliye yeh option table pe hai hi
nahi.

**Cause:** LLM ko free-text likhne diya jaata hai, phir us text se JSON scrape
kiya jaata hai. Woh scrape kabhi-kabhi fail hota hai.

**Cause hatane wala fix:** LLM ko free-text likhne hi mat do.

---

## 3. Asli fix — `.withStructuredOutput()` (BACKLOG mein isko O2 kaha hai)

`BACKLOG.md` O2 already yeh likh chuka hai:

> "Switching to `.withStructuredOutput(schema, { strict: true })` would make parse
> errors **structurally impossible** ... removes the cause behind BUG-1 and BUG-2."

### Yeh LangChain ka method hai — OpenAI ka nahi

`model.withStructuredOutput(schema)` har LangChain chat model pe hai (`ChatOpenAI`,
`ChatGroq`, `ChatGoogleGenerativeAI`). LangChain andar se provider ke hisaab se
sahi mechanism chunta hai:

| Provider | LangChain andar |
|---|---|
| OpenAI (abhi active) | `response_format: json_schema`, `strict: true` — server-side guarantee |
| Groq | function calling |
| Gemini | `responseSchema` |

Tumhare code mein **ek line**. `LLM_PROVIDER` badlo — line waise ki waise.
Model-switch capability tooti nahi. (Honest note: OpenAI pe guarantee 100% pakka;
Groq/Gemini pe bahut achha par utna bulletproof nahi. Abhi active OpenAI hi hai.)

### Naya npm package chahiye?

**Nahi.** `withStructuredOutput` ek plain **JSON Schema object** accept karta hai
(Zod optional hai, aur Zod install nahi hai). Hum raw JSON schema denge — zero
new dependency. `CLAUDE.md` ka "no new packages" rule intact.

---

## 4. SCOPE — kya karenge, kya NAHI karenge

### ✅ IN SCOPE (yeh plan)

Sirf **decider chain** ko structured output pe le jaana.

1. **`backend/src/llm/decisionSchema.js`** (naya) — decider output ka JSON Schema:
   `intent` (9-value enum), `searchQuery` (string|null), `examEntity`
   (string|null), `reason` (string). Enum hone se BUG-2 apne aap khatam — LLM
   enum ke bahar value de hi nahi sakta.

2. **`backend/src/ask/step4.decideRetrieval.js`** —
   - `getDeciderChain()` ab `...deciderPrompt → model.withStructuredOutput(schema) `
     (no `stringParser`, no `parseJsonObject`).
   - `.invoke()` seedha parsed object deta hai.
   - **`parse_error` fallback branch delete** ([lines 204-217](backend/src/ask/step4.decideRetrieval.js:204)).
     `classifyProviderError` se `parse_error` case hat jaata hai — ab sirf asli
     provider errors (`rate_limit` / `auth_error` / `network_error`) bचte hain,
     jo pehle se sahi tarah `ProviderUnavailableError` throw karte hain.
   - `normalizeDecision()` ka `isKnownIntent` check ([line 75-77](backend/src/ask/step4.decideRetrieval.js:75))
     — enum ki wajah se ab yeh kabhi false nahi hoga. Check hataana hai ya
     `console.error('should be unreachable')` banana hai — plan step mein decide.

3. **`backend/src/prompts/deciderPrompt.js`** — end mein jo `Return ONLY this
   JSON...` line hai use hata dena (schema ab woh kaam karta hai). Baaki prompt
   (intent definitions, disambiguation rules) waise ka waisa — woh classification
   quality ke liye hai, format ke liye nahi.

4. **`backend/src/utils/providerErrors.js`** — `classifyProviderError` ka comment
   `// JSON parse failure or unknown` update; agar ab bhi ek "unknown → kya karein"
   case chahiye toh woh explicit `network_error` (safe throw) ho, silent
   "parse_error" nahi.

### ❌ OUT OF SCOPE (Stage 2 mein rahega — BACKLOG O2 ka bचa hua hissa)

- **Tutor / intentRouter chains** (`step6`, `intentRouter.js`, 10 intent prompts).
  Yeh **stream** karte hain (`.stream()`), aur structured output + streaming
  delicate hai (partial parsing). BUG-1/BUG-2 se iska koi lena-dena nahi.
- `jsonParser.js` **delete nahi** karenge — tutor side abhi bhi use karta hai.
  Sirf decider usse hat jaayega.
- Baaki 6 bugs (BUG-3 se BUG-8) — apne turn pe.

---

## 5. Governance changes (code se pehle)

| File | Change |
|---|---|
| **`docs/decisions/011-decider-structured-output.md`** (naya ADR) | "O2 ka decider-slice Stage 2 se Stage 1 mein laaye. Kyun: BUG-1/BUG-2 ka Rule 4-compliant fix iske bina possible nahi. Rejected: symptom patch (Rule 4), poora O2 abhi (tutor streaming risk). Revisit: —" |
| **`docs/decisions/README.md`** | Index mein ADR-011 add |
| **`STAGE1_DONE.md`** BUG-1 / BUG-2 rows | Fix approach likhna: "decider → `withStructuredOutput`; parse_error branch removed. See ADR-011 + BUG1_FIX_PLAN.md" |
| **`BACKLOG.md`** O2 | O2 ko update: "decider-slice Stage 1 mein nikala (ADR-011). Bacha hua: tutor/intentRouter chains — Stage 2." O2 poora delete NAHI — tutor hissa abhi bhi valid backlog hai. |
| **`PROJECT_STATE.md`** | BUG-1/BUG-2 rows pe "fix in progress — ADR-011" note |

---

## 6. Test plan (Rule 4 + Section C protocol: failing test → fix → passing test)

Nayi file: **`backend/scripts/test-decider-structured.js`** (ya jo bhi existing
decider test hai usme add).

**Failing test aaj (fix se pehle):**
1. `getDeciderChain().invoke` ko mock karo → return `"{intent: BROKEN json"` (invalid).
   Assert: `decideRetrieval()` ka result aaj `needsRetrieval: false` hai. ← BUG-1 proven.
2. Mock decider return `{"intent":"CONCEPT_QUESTON", ...}` (typo).
   Assert: aaj result `intent: 'GREETING'`. ← BUG-2 proven.

**Passing test fix ke baad:**
- Structured output ke saath, provider malformed JSON return kar hi nahi sakta —
  toh test badal jaata hai: schema violation ab LangChain ke andar
  provider-error banta hai → `decideRetrieval()` ko `ProviderUnavailableError`
  throw karna chahiye (orchestrator use `rate_limit`/`network` jaise handle karta
  hai — ek honest "thodi der baad try karo", jhoota "syllabus mein nahi" nahi).
- Typo intent: possible hi nahi (enum). Test: valid enum values hi aati hain.

**Baseline (Section C rule — same command before & after):**
```bash
cd backend && npm run test:golden && npm run test:chunks && npm run test:study-map && npm run test:curriculum-resolvers && npm run test:chat-db-models
```
Green before → green after. Koi regression = isi session mein fix, Parking Lot nahi.

---

## 7. Execution order (ek step at a time, har step pe tumhari confirmation)

1. ADR-011 likho + README index + BACKLOG/STAGE1_DONE/PROJECT_STATE update → tum padho
2. Baseline test chalao, output save
3. Failing test likho (BUG-1 + BUG-2 dono) → red dikhao
4. `decisionSchema.js` banao
5. `step4.decideRetrieval.js` — chain + `.invoke()` + parse_error branch delete
6. `deciderPrompt.js` + `providerErrors.js` cleanup
7. Failing test ab pass hona chahiye (naye assertions ke saath)
8. Baseline test dubara → green confirm
9. Commit (branch: `bug1-decider-structured-output`), merge sirf jab tum bolo

---

## 8. Risk

| Risk | Mitigation |
|---|---|
| `withStructuredOutput` OpenAI pe `temperature` ya `maxTokens` ke saath conflict | Decider already `temperature:0`, `maxTokens:350` — test step 8 pakdega |
| Kisi aur jagah decider ka raw string output expect kiya ja raha ho | Grep: sirf `step4` `getDeciderChain` use karta hai — verified aaj |
| Provider switch (Groq/Gemini) pe behavior alag | Abhi OpenAI active. ADR-011 mein honest note. Switch pe re-test. |
| Streaming decider? | Decider stream nahi karta (`.invoke()`), sirf tutor karta hai — safe |
