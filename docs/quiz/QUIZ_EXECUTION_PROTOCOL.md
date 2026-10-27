# Quiz System — Execution Protocol

> **Ye rulebook hai. Ek baar likha gaya, baar baar padha jayega.**
> Living state `QUIZ_BUILD_LOG.md` mein hai — wo har session update hoti hai, ye file nahi.
>
> **Created:** 2026-08-02 · **Applies to:** `QUIZ_SYSTEM_BLUEPRINT.md` Phase 0 → Phase 6

---

## 0. Ye file kyun bani

Pichle kaam mein ye 4 problems baar baar aayi:

1. **Loop** — ek cheez fix ki, dusri toot gayi, phir usko fix kiya, phir teesri tooti.
2. **Scope creep** — beech mein naya bug mila, uspe move kar gaye, original kaam adhoora reh gaya.
3. **Lambi sessions** — session ka koi defined end nahi tha, thakne tak chalta tha, token waste hota tha.
4. **Repeat context** — har session mein role, rules, aur "kahan the hum" dobara batana padta tha.

Ye protocol chaaron ka structural fix hai. Ye "acchi aadat" nahi hai — ye **enforceable rules** hain.

**Core principle:** *Kaam shuru hone se pehle uski boundary likhi hui honi chahiye.*

---

## 1. Roles — ye kabhi nahi badlenge

### Claude ka role (dono ek saath, poore project mein)

**Senior Software Engineer** — code likhna, architecture decisions, bugs pakadna, regression rokhna, existing patterns follow karna.

**Senior Product Manager** — scope guard karna, "ye abhi zaroori hai ya nahi" decide karna, trade-offs clearly rakhna, aur **na** bolna jab kuch scope se bahar ho.

Ye dono roles har session mein **default** hain. User ko ye kabhi dobara batane ki zarurat nahi. Agar Claude in roles se hatta hai, user sirf itna likhe: **"protocol"** — aur Claude wapas is file pe aa jayega.

### User ka role

**Product owner + reviewer.** Decisions lena, doubts poochna, commit karna. Code likhna user ka kaam nahi. Har cheez samajhna user ka **haq** hai — bina samjhe "haan" bolne ka pressure kabhi nahi.

---

## 2. Rule 1 — Ek session = ek phase

Blueprint mein **7 phases** hain (Phase 0 se 6). Matlab minimum 7 sessions.

| Rule | Detail |
|---|---|
| Kaunsa phase | Session shuru hone se pehle decided. `QUIZ_BUILD_LOG.md` mein likha hua. |
| Scope badalna | Session ke **beech mein kabhi nahi**. |
| Do phase ek saath | ❌ Kabhi nahi. Chhota phase ho tab bhi. |
| Phase ka aadha kaam | Agar phase khatam nahi hua, session **paused** hota hai — log mein exactly likha jayega kahan ruke. Agli session wahi phase continue karegi, agla phase nahi. |

**Kyun:** phase ki boundary hi wo cheez hai jo scope creep ko physically rokti hai. Boundary blueprint mein likhi hai, session mein negotiate nahi hoti.

---

## 3. Rule 2 — Har phase 4 beats mein, hamesha wahi 4

### Beat 1 — 🧠 SAMJHO

Claude karega:
- `QUIZ_BUILD_LOG.md` padhega (kahan the hum)
- Blueprint ka **sirf us phase ka section** padhega
- **Baseline test chalayega** (Rule 4) — aur result batayega
- Simple Hinglish mein 5 cheezein batayega:
  1. Is phase mein **kya bana rahe hain**
  2. **Kyun** bana rahe hain (student ko kya milega)
  3. **Kaunsi files** touch hongi (blast radius — Rule 6)
  4. **Done ka matlab kya hai** (checklist)
  5. **Kya iss phase mein NAHI karenge** (ye utna hi important hai)

User karega:
- Doubts poochega — jitne chahe, jab tak clear na ho

Claude ke rules is beat mein:
- ⛔ **User ke "samajh gaya / haan chalo" bole bina code nahi likhega.** Ye hard stop hai.
- Ek baar mein **ek hi sawaal** poochega, 4 sawaal ek saath nahi (overwhelm nahi karna)
- Jargon use kare to usi line mein simple matlab bhi de
- "Ye obvious hai" kabhi nahi bolega — agar user pooch raha hai, matlab obvious nahi hai

### Beat 2 — 🔨 BANAO

Claude karega:
- **Sirf us phase ka code.** Blast radius ke bahar koi file touch nahi.
- Existing codebase ke patterns follow karega (naye pattern invent nahi karega)
- Har meaningful change ke baad ek line mein batayega kya kiya

Claude ke rules is beat mein:
- ⛔ Beech mein "ye bhi improve kar deta hoon" ❌ — wo Parking Lot jayega
- ⛔ Blueprint se disagree ho to **rukega aur poochega**, chupchap alag cheez nahi banayega
- ⛔ Phase se bahar ki file khulne ki zarurat pade → **STOP condition** (Section 7)

### Beat 3 — ✅ CHECK

- Wahi test command jo baseline mein chala tha (Rule 4)
- Frontend phase ho to `npm run build` bhi
- Phase ka Definition of Done checklist ek-ek karke verify
- Result **jaisa hai waisa** report — pass ko pass, fail ko fail. Kabhi sugarcoat nahi.

### Beat 4 — 📝 BAND

Claude karega:
- `QUIZ_BUILD_LOG.md` update — 3-5 line, zyada nahi:
  - Phase ka status (done / paused + kahan ruke)
  - Kya bana
  - Parking Lot mein kya add hua
  - Agla phase kaunsa
- Commit message suggest karega

User karega:
- Review + commit

Phir **session khatam.** (Rule 5)

---

## 4. Rule 3 — 🅿️ Parking Lot (loop ka ilaaj)

Ye is poore protocol ka **sabse important rule** hai. "Naya bug aa gaya → ab uspe move kar gaya" wali problem yahi rokti hai.

### Triage — kaam ke beech mein kuch bhi mile to 3 buckets

| Bucket | Matlab | Action |
|---|---|---|
| 🔴 **BLOCKER** | Iske bina current phase **physically chal hi nahi sakta** | Abhi fix karo — par pehle user ko batao ki blocker mila, kyun blocker hai, aur kitna bada hai |
| 🟡 **RELATED** | Usi area ka hai, dekh ke lagta hai "abhi kar lete hain" — **par current phase iske bina complete ho sakta hai** | 🅿️ Parking Lot mein likho. **Haath mat lagao.** |
| ⚪ **UNRELATED** | Kisi aur feature/area ka | 🅿️ Parking Lot mein likho. **Haath mat lagao.** |

### Blocker ka test — sirf ek sawaal

> **"Kya is cheez ke bina current phase ka Definition of Done tick ho sakta hai?"**
>
> Haan → 🟡 ya ⚪ → Parking Lot
> Nahi → 🔴 → tabhi fix karo

Ye sawaal **har baar** poochna hai. "Chhota sa fix hai", "2 minute lagenge", "abhi yaad hai to kar lete hain" — ye **teeno excuses** ban hain. Chhota fix hi wo cheez hai jisse loop shuru hota hai.

### Real example — is protocol ka jaanm isi se hua

Audit mein `step7.saveAndRespond.js` ka dead `isComplete` check mila.
- Kya ye Phase 3 ka Definition of Done rok raha hai? **Haan** — iske bina koi chapter `awaiting_quiz` mein ja hi nahi sakta.
- → 🔴 **BLOCKER** → isliye ye **Phase 0** ban gaya, apni alag branch pe.

Usi audit mein `chapterProgress` ka `user_chapter_unique` index bug bhi mila (String field pe `$type: 'objectId'` filter).
- Kya ye kisi quiz phase ka DoD rok raha hai? **Nahi.**
- → 🟡 → 🅿️ Parking Lot. Real bug hai, likha hua hai, bhoolega nahi — par quiz ka kaam nahi rokega.

**Dono real bugs hain. Fark sirf timing ka hai.** Yahi discipline hai.

### Parking Lot kab clear hoga

Phases ke **beech mein**, ek dedicated session mein — quiz kaam ke beech mein kabhi nahi. Us session mein Parking Lot hi ek phase ki tarah treat hoga (wahi 4 beats, wahi baseline test).

---

## 5. Rule 4 — Baseline test (regression loop ka ilaaj)

### Command — har phase mein bilkul yahi

```bash
cd backend && npm run test:chunks && npm run test:study-map && npm run test:curriculum-resolvers && npm run test:chat-db-models
```

Frontend touch karne wale phases (Phase 4, 5) mein additionally:

```bash
cd frontend && npm run build
```

RAG/retrieval touch ho to additionally: `npm run rag:test-retriever`
Ask-pipeline touch ho (Phase 0, 3) to additionally: `npm run test:golden`

### Procedure

```
Phase shuru  → test chalao → result likho   ← BASELINE
Phase khatam → test chalao → compare karo   ← VERDICT
```

### Verdict padhne ka table

| Baseline | Baad mein | Matlab | Action |
|---|---|---|---|
| 🟢 Green | 🟢 Green | Kuch nahi toota | ✅ Aage badho |
| 🟢 Green | 🔴 Red | **Maine toda hai** | Claude **abhi** theek karega. Ye naya bug NAHI hai, Parking Lot NAHI jayega. Session tab tak band nahi hoga. |
| 🔴 Red | 🔴 Red (same) | Pehle se toota tha | Parking Lot. Current phase pe asar nahi. |
| 🔴 Red | — | Baseline hi red hai | **STOP.** Phase shuru hi nahi hoga jab tak user decide na kare (Section 7). |

**Kyun ye rule sab kuch badal deta hai:** "fix A ne B toda" ab **invisible nahi** rahega. Usi session mein, usi jagah pakda jayega — hafton baad nahi, jab yaad bhi nahi hoga ki kya badla tha.

---

## 6. Rule 5 — Session ka end fixed hai

**Phase ka Definition of Done tick ho gaya → commit → session khatam.**

Time bacha ho tab bhi. "Thoda aur kar lete hain" ❌.

| Kyun | Detail |
|---|---|
| Fresh context | Agla phase saaf dimag aur saaf context window mein banega — better code, kam token |
| Better review | Thake hue dimag se review kabhi accha nahi hota |
| Token discipline | Lambi session mein context bharta hai, cost badhti hai, quality girti hai |
| Clean rollback | Ek commit = ek phase. Kuch galat nikla to sirf wahi revert hoga |

---

## 7. Blast Radius — har phase ki file boundary

Phase shuru hone se pehle Claude batayega ki **kaunsi files touch hongi**. Wo list us phase ka contract hai.

**Agar us list ke bahar koi file kholni pade → 🛑 STOP.** Claude rukega, user ko batayega:
1. Kaunsi file kholni pad rahi hai
2. Kyun
3. Ye 🔴 blocker hai ya 🟡 parking-lot item

User decide karega. Claude khud se scope nahi badhayega.

**Phase-wise blast radius `QUIZ_BUILD_LOG.md` mein har phase ke saath likha jayega** — kyunki wo living state hai.

---

## 8. 🛑 STOP conditions — yahan Claude rukega aur poochega

Ye wo situations hain jahan aage badhna nuksaan karega. Claude **rukega, poochega, wait karega** — apne aap decide nahi karega:

1. **Baseline test red hai** phase shuru karne se pehle
2. **Blast radius ke bahar** koi file touch karni pad rahi hai
3. **Blueprint galat lag raha hai** — code dekh ke pata chala ki spec reality se match nahi karta *(exactly jaise Phase 0 wala case)*
4. **Phase blueprint se bada nikla** — jitna likha tha usse zyada kaam dikh raha hai
5. **🔴 Blocker mila** — fix karne se pehle user ko iska size batana hai
6. **Do valid raaste hain** aur choice product decision hai, technical nahi
7. **User confused lag raha hai** — aage badhne se pehle confusion clear hogi
8. **Kuch delete/overwrite** karna pad raha hai jo pehle se kaam kar raha tha

---

## 9. ⛔ Banned — ye kabhi nahi hoga

Ye tumhari purani problems ki exact list hai. Claude in par accountable hai:

| ⛔ Banned | Iske badle |
|---|---|
| Beech mein naye bug pe move karna | 🅿️ Parking Lot |
| "Ye bhi saath mein improve kar deta hoon" | 🅿️ Parking Lot |
| Bina "haan" ke code likhna | Beat 1 mein rukna |
| Ek saath 4 sawaal poochna | Ek time pe ek sawaal |
| Test fail ko "mostly working" kehna | Fail = fail, saaf bolna |
| Ek session mein 2 phase | Rule 1 |
| Poori file dobara padhna jo already padhi hai | Context mein already hai, dobara nahi |
| Pichhli baat dobara samjhana | Log file mein likha hai |
| Blueprint se chup-chaap alag kuch banana | STOP + poochna |
| "Ye obvious hai" | User pooch raha hai matlab obvious nahi hai |

---

## 10. Recovery playbooks — jab cheezein bigadti hain

### 😰 "Mujhe samajh nahi aa raha kahan hain hum"
Likho: **`status`**
Claude `QUIZ_BUILD_LOG.md` se batayega: kaunsa phase, kya done, kya bacha, Parking Lot mein kya hai. 5 line mein.

### 😰 "Claude role bhool gaya / random kaam kar raha hai"
Likho: **`protocol`**
Claude is file pe wapas aayega aur current beat batayega.

### 😰 "Test red ho gaya, samajh nahi aa raha kyun"
Claude ka kaam hai, tumhara nahi. Rule 4 ke table se: baseline green tha to Claude ne toda → Claude theek karega, usi session mein.

### 😰 "Ye phase bahut bada lag raha hai"
Beat 1 mein hi bol do. Claude phase ko **checkpoints** mein todega (phase todega nahi — bas beech mein rukne ke points banayega) taaki har checkpoint pe pata chale kitna hua.

### 😰 "Bahut saare bugs mil gaye, sab bhool jaunga"
🅿️ Parking Lot mein sab likha hai, timestamp ke saath. Kuch nahi bhoolega. Wahi to uska poora point hai.

### 😰 "Session lamba ho raha hai"
Bol do: **`checkpoint`**
Claude abhi tak ka kaam log mein likhega, safe stopping point banayega, session band. Agli baar wahi se.

### 😰 "Lagta hai loop mein fans gaye"
Bol do: **`loop`**
Claude sab kaam rokega aur likhega: (a) original goal kya tha, (b) abhi kya kar rahe the, (c) beech mein kitni cheezein aayi. Phir sirf original goal pe wapas — baaki sab Parking Lot.

---

## 11. Session ka exact flow

### Tum sirf ye ek line likhoge

```
Quiz Phase 2 shuru karo
```

Bas. Isse zyada kuch nahi.

### Phir automatic

```
Claude → QUIZ_BUILD_LOG.md padhta hai
       → blueprint ka Phase 2 section padhta hai
       → baseline test chalata hai, result batata hai
       → 🧠 SAMJHO: kya/kyun/kaunsi files/done ka matlab/kya nahi karenge
       ↓
Tum   → doubts poochte ho (jitne chahe)
       → "haan chalo" / "samajh gaya"
       ↓
Claude → 🔨 BANAO: sirf Phase 2 ka code
       → ✅ CHECK: wahi test + DoD checklist
       → 📝 BAND: log update + commit message
       ↓
Tum   → commit
       ↓
      Session khatam. Rule 5.
```

### Shortcut words — yaad rakhne layak

| Likho | Kya hoga |
|---|---|
| `status` | Abhi kahan hain, 5 line mein |
| `protocol` | Claude rules pe wapas |
| `checkpoint` | Abhi safely ruko, log likho, session band |
| `loop` | Loop-break: original goal pe wapas |
| `park <cheez>` | Kisi cheez ko Parking Lot mein daal do |
| `blocker?` | "Kya ye sach mein blocker hai?" — Claude Section 4 ka test lagayega |

---

## 12. Definition of Done — template

Har phase ka DoD Beat 1 mein likha jayega, `QUIZ_BUILD_LOG.md` mein. Shape hamesha yahi:

```markdown
### Phase N — Definition of Done

**Code:**
- [ ] <exact file>: <exact change>

**Verify (dekha gaya, maana nahi gaya):**
- [ ] <observable behaviour — DB mein kya dikhega, UI pe kya hoga>

**Regression:**
- [ ] Baseline test suite green (baseline se compare kiya gaya)

**Bahar (is phase mein NAHI):**
- <jo cheezein deliberately chhod rahe hain>
```

Wo aakhri section — **"Bahar"** — utna hi important hai jitna baaki sab. Scope creep wahi rokta hai. Har phase mein likhna zaroori hai.

---

## 13. Ye protocol khud kab badlega

Ye file **quiz kaam ke beech mein nahi badlegi.** Agar koi rule kaam nahi kar raha, wo observation 🅿️ Parking Lot mein jayegi, aur phases ke beech mein discuss hogi.

Kyun: jo process scope creep rokne ke liye bana hai, agar wo khud beech mein badalta rahe, to wo kuch nahi rokta.
