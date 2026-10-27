# Quiz Phase 4 — Quiz Runner Modal UI (Frontend)

> **Ye file living reference hai is poore phase ke liye.** Har naye session mein isse padho —
> kya banana hai, kyun, kaise, kitne files, kya challenges, aur step plan sab yahan hai.
> Dobara explain karne ki zaroorat nahi. Rules `QUIZ_EXECUTION_PROTOCOL.md` mein hain,
> living state `QUIZ_BUILD_LOG.md` mein hai.
>
> Full evidence-based analysis (2026-08-10 ko banaya, real code se verify karke — koi assumption nahi).

---

## Scope

Chapter gate quiz ka poora frontend experience. Student chapter khatam kare → gate quiz prompt
aaye → modal mein quiz de → score dekhe. **Practice quiz ka entry point is phase mein NAHI hai —
wo Phase 5 (Practice Quiz Hub) ka kaam hai.**

---

## Kya Banana Hai — The Deliverables

**Sirf 4 cheezein.** Deliberately chhota scope — quiz lena aur result dikhana, bas.

1. **Quiz API Functions** — `tutorApi.js` mein `generateQuiz()` aur `submitQuiz()`. History APIs
   (`fetchQuizHistory`, `fetchQuizAttemptDetail`) Phase 5 mein aayengi. `axiosInstance` use hoga
   (fetch nahi — sirf `askTutor` streaming ke liye fetch use hoti hai, baki sab axios hai).
2. **QuizModal Component** — MUI `<Dialog>` (same pattern jo `FocusModal.jsx`/`GuestLimitModal.jsx`
   use karte hain). 4 internal screens: Loading → Question → Confirm Submit → Result.
3. **Gate Quiz Trigger in ChatPage** — jab `chapterProgress.status === 'awaiting_quiz'`, backend
   se `start_gate_quiz` suggestion chip aata hai. `handleSuggestedAction` mein naya case add karna.
4. **FocusModal mein Quiz Status Chip** — "Jahan Chhoda Tha" section mein `awaiting_quiz` chapters
   ke liye "Quiz Pending" badge.

---

## Kyun Banana Hai — The Reasoning

Phase 3 ne backend poora kar diya: chapter complete → `awaiting_quiz`, quiz pass → `completed`.
Lekin **abhi student ke liye koi raasta nahi hai ye quiz dene ka**:

- Backend `start_gate_quiz` chip bhejta hai, par `handleSuggestedAction` mein iska case nahi hai
  → default branch chalti hai → text ek normal question ki tarah `askTutor()` ko chala jaata hai
  → decider galat classify karta hai → galat answer aata hai
- Quiz generate/submit APIs exist karte hain, par frontend mein unhe call karne wala koi code nahi
- FocusModal mein `awaiting_quiz` chapters `in_progress` jaisi hi dikhti hain — koi distinction nahi

**Backend ready hai, frontend us tak pahunch nahi pa raha.** Ye phase gap band karta hai.

---

## User Flow — Start to End

### Flow A: Gate Quiz (chapter khatam karne ke baad)

1. Student Focus Mode mein chapter ka last topic complete karta hai
2. `step7.saveAndRespond.js` detect karta hai `CHAPTER_COMPLETE` → status `in_progress` → `awaiting_quiz`
3. Ask API response mein `chapterProgress.status = 'awaiting_quiz'` aata hai → ChatPage state update
4. Zuno ka response dikhta hai + `suggestedActions` mein "Quiz shuru karo" chip (`start_gate_quiz`)
5. Student click karta hai → `handleSuggestedAction` naya case fire → **QuizModal open**
6. QuizModal `POST /api/v1/quiz/generate` (`quizType: 'chapter_gate'`) → 10 questions
7. Student answer karta hai → Submit → `POST /api/v1/quiz/submit`
8. **Pass (≥70%):** Score card + confetti. Backend ne chapter `completed` bana diya. Modal close
   par ChatPage `chapterStatus` refresh → next chapter recommendation
9. **Fail (<70%):** Score card + weak topics (agar data available) + "Dobara quiz do" button.
   Unlimited retries. Chapter `awaiting_quiz` hi rehta hai

### Flow B: FocusModal se quiz resume (agar pehle skip kar diya)

1. Student ne pehle quiz nahi diya, modal band kar diya, kahin aur chala gaya
2. Wapas FocusModal kholta hai → "Jahan Chhoda Tha" mein "Quiz Pending" chip ke saath chapter dikhta hai
3. Chapter select → welcome message (backend `buildRecommendation`) with "Quiz shuru karo" chip → same flow as above

---

## Kitne Files Touch Honge

| File | Type | Kya hoga |
|---|---|---|
| `frontend/src/api/tutorApi.js` | Edit | `generateQuiz()`, `submitQuiz()` — 2 axios wrappers, ~40 lines |
| `frontend/src/components/QuizModal.jsx` | **New** | Poora quiz runner. 4 screens. ~400-500 lines |
| `frontend/src/pages/ChatPage.jsx` | Edit | `start_gate_quiz` case, `isQuizModalOpen` state, QuizModal render, post-quiz status refresh. ~30 lines |
| `frontend/src/components/FocusModal.jsx` | Edit | `awaiting_quiz` chip in "Jahan Chhoda Tha". ~15 lines |
| `frontend/src/styles/global.css` | Edit | QuizModal internal screens ke CSS classes. ~80-100 lines |

**Total: 1 new file, 4 edits.** Koi backend change nahi. Koi naya route nahi (QuizModal ek modal
hai, page nahi). Koi naya npm package nahi.

---

## API Contracts — Frontend Ko Kya Milega

### `POST /api/v1/quiz/generate`

Request:
```json
{
  "quizType": "chapter_gate",
  "subjectId": "science",
  "chapterId": "science.physics.chapter-01"
}
```

Response (`data`):
```json
{
  "quizId": "66b8a...",
  "quizType": "chapter_gate",
  "questionCount": 10,
  "expectedCount": 10,
  "isPartial": false,
  "expiresAt": "2026-08-10T...",
  "questions": [
    {
      "questionId": "66b7...",
      "text": { "en": "...", "hi": "...", "hinglish": "..." },
      "options": [
        { "label": "A", "text": { "en": "...", "hi": "...", "hinglish": "..." } }
      ],
      "askedInYears": [2019, 2022]
    }
  ]
}
```

**Language:** API teeno languages bhejta hai. Frontend default: **hinglish**
(`question.text.hinglish || question.text.en`). Language toggle is phase mein nahi hai.

### `POST /api/v1/quiz/submit`

Request:
```json
{
  "quizId": "66b8a...",
  "submissionKey": "crypto.randomUUID()",
  "timeTakenSec": 185,
  "answers": [
    { "questionId": "66b7...", "selectedOption": "B", "timeSpentMs": 12000 }
  ]
}
```

Response (`data`):
```json
{
  "attemptId": "66b8b...",
  "score": 8,
  "totalQuestions": 10,
  "percentage": 80,
  "passed": true,
  "timeTakenSec": 185,
  "results": [
    {
      "questionId": "66b7...",
      "text": { "en": "...", "hi": "...", "hinglish": "..." },
      "options": [ { "label": "A", "text": { "..." } } ],
      "selectedOption": "B",
      "correctOption": "C",
      "isCorrect": false,
      "explanation": { "en": null, "hi": null, "hinglish": null },
      "timeSpentMs": 12000
    }
  ]
}
```

**Idempotency:** `submissionKey` ek baar generate karo (quiz start pe), har submit attempt mein
wahi bhejo. Retry/double-click → same key → same result, naya attempt nahi banega. Naya key on an
already-submitted session → `409`.

### Errors Frontend Ko Handle Karne Honge

| Code | Kab | UI Action |
|---|---|---|
| 400 | Missing identity / invalid params | Should never happen if code correct — generic error |
| 404 | Chapter not found / no questions | "Is chapter ke liye abhi quiz available nahi hai" |
| 409 (generate) | Chapter not `awaiting_quiz` | "Pehle saare topics complete karo" — rare edge case |
| 409 (submit) | Already submitted, different key | "Ye quiz pehle se submit ho chuki hai" — stale tab |
| 429 | Rate limit (10/min generate, 10/min submit) | "Thoda ruko, bahut tez quiz generate ho rahe hain" |

---

## QuizModal — Internal Architecture

### State Model (React local state, NOT Redux)

Blueprint §8: *"Quiz state is local (React state), not Redux/persisted."* Quiz ek 2-5 min
interaction hai. Mid-quiz refresh = restart. Acceptable for 10 questions.

```js
screen: 'loading' | 'quiz' | 'confirm' | 'result'
quizData: null | { quizId, questions[], questionCount, expiresAt, ... }
answers: Map<questionId, { selectedOption, timeSpentMs }>
currentIndex: number
startTime: Date              // quiz start, for total timeTakenSec
questionStartTime: Date      // current question start, for per-Q timeSpentMs
submissionKey: string        // crypto.randomUUID(), generated ONCE
result: null | { score, totalQuestions, percentage, passed, results[] }
isSubmitting: boolean
error: string | null
```

### Screens

1. **Loading** — `generateQuiz()` on mount. Spinner + "Quiz tayyar ho raha hai...". Fail → retry/close.
2. **Question** — 1 at a time. Progress bar. 4 options (click = select, click again = deselect).
   Prev/Next/Skip. Last question → "Agla" becomes "Review & Submit". PYQ badge if `askedInYears` populated.
3. **Confirm Submit** — "10 mein se 8 answered, 2 skipped." Warning if skips. "Wapas jaao" / "Submit karo".
4. **Result** — Score header (score/total, %, pass/fail badge). Gate pass: confetti + "Chapter
   complete ho gaya!". Gate fail: "70% chahiye tha, X% aaya" + "Dobara quiz do". Per-question review:
   selected (green/red), correct option highlighted, explanation (only if present — handle `null`).

---

## Challenges, Edge Cases, Hidden Problems

1. **`submissionKey` lifecycle** — generate ONCE at quiz start, never regenerate, even on retry.
   Store in state, disable submit button on click + `isSubmitting` flag to prevent double-call/409.

2. **Session TTL expiry (50 min)** — soft check `Date.now() > expiresAt` before submit. Expired →
   "Quiz ka time khatam ho gaya, nayi quiz generate karo" + "Naya quiz" button. Don't call submit at all.

3. **`explanation` field is null** — Blueprint §19 AUDIT: *"explanation, topicId, difficulty are 0%
   populated in the real 744-question bank."* Explanation section shows ONLY if data exists — never
   assume it's there.

4. **Weak topic analysis not available** — `getWeakTopics()` depends on `topicId`, which is 0%
   populated currently. Build the UI structure but conditionally hide it when data is absent.

5. **`chapterStatus` refresh after quiz** — modal has its own local state, ChatPage doesn't
   auto-know quiz passed. Fix: `onQuizComplete` callback prop → `setChapterStatus('completed')` +
   dispatch `chapter-progress-updated` CustomEvent (same pattern as `handleAsk` line 486-491).

6. **`isPartial` quiz** — if chapter has <10 questions, backend sends `isPartial: true`. Show a
   note: "Is chapter mein [X] questions available hain."

7. **Guest identity** — already handled by `axiosInstance` request interceptor (`X-Guest-Id`
   header). No extra work — just use `axiosInstance`, not raw axios/fetch.

8. **Modal close mid-quiz** — confirm dialog before closing ("Progress save nahi hogi"). Server
   session stays `pending`, 50-min TTL auto-cleans it.

**Not a challenge:** option shuffling — backend already handles it fully (generate response has
shuffled A/B/C/D, submit response returns results in the SAME shuffled order). Frontend just renders.

---

## Time Tracking

- **Total time:** `startTime = Date.now()` when generate response arrives (loading → quiz
  transition). On submit: `Math.round((Date.now() - startTime) / 1000)`. Backend clamps to 3hr max.
- **Per-question time:** `questionStartTime` resets on `currentIndex` change. On navigating away:
  `answers.get(questionId).timeSpentMs += (Date.now() - questionStartTime)` — **additive**, because
  student can revisit a question via prev/next.

---

## Step-by-Step Implementation Plan

**Har step = ek session.** Discuss → implement → review → commit → next step.

### Step 1 — API Layer + QuizModal Skeleton

**Files:** `tutorApi.js` (edit), `QuizModal.jsx` (new)

- `generateQuiz({ quizType, subjectId, chapterId })` + `submitQuiz({ quizId, submissionKey, timeTakenSec, answers })` in `tutorApi.js` — `axiosInstance.post()`, existing error-handling pattern
- `QuizModal.jsx` skeleton — MUI `<Dialog>`, 4 screen states, generate API call on mount, loading screen
- Question screen basic render — question text, 4 option buttons, next/prev, answer tracking in local state
- Confirm submit screen — answered/skipped count, submit button (wiring only, API call is Step 2)

**Kyun alag step:** QuizModal is step ke baad independently testable hoga (manual render with
props), bina ChatPage integration ke bhi navigation verify ho sakti hai.

**Done ka matlab:** Modal open → loading → questions dikhte hain → select/deselect/navigate kaam
karta hai → confirm screen dikhti hai. Submit API abhi nahi chalti.

### Step 2 — Submit + Result Screen

**Files:** `QuizModal.jsx` (edit), `global.css` (edit)

- Confirm screen Submit button wire karna — `submitQuiz()` call, `submissionKey` + `timeTakenSec` + `answers[]` assemble
- Result screen — score card, per-question review (correct/wrong/skipped coloring, explanation with null handling)
- Gate pass: CSS confetti animation
- Gate fail: "Dobara quiz do" (fresh `generateQuiz()`, resets to loading screen)
- Error states: TTL expiry check, 409, 404, network errors, rate limit
- Close confirmation dialog (mid-quiz close)

**Kyun alag step:** Sabse complex screen (result mein per-question review, conditional explanation,
conditional weak topics placeholder) — apni jagah deserve karta hai.

**Done ka matlab:** Full cycle manually testable — generate → answer → submit → score → pass/fail
sahi → retry works → errors handled → close confirmation works.

### Step 3 — ChatPage Integration + FocusModal Chip

**Files:** `ChatPage.jsx` (edit), `FocusModal.jsx` (edit), `useChapterProgress.js` (maybe edit)

- ChatPage: `isQuizModalOpen` state + QuizModal render + `onQuizComplete`/`onClose` handlers
- `handleSuggestedAction`: `start_gate_quiz` case → opens modal with `quizType: 'chapter_gate'`, current `selectedChapterId`/`subjectId`
- `onQuizComplete`: pass → `setChapterStatus('completed')` + `chapter-progress-updated` event + optional chat system message
- FocusModal: `awaiting_quiz` chapters get "Quiz Pending" badge in "Jahan Chhoda Tha"
- `useChapterProgress` hook currently filters only `status: 'in_progress'` — needs to include `awaiting_quiz` too (or FocusModal rendering changes)

**Kyun alag step:** Step 1-2 completed QuizModal standalone. Step 3 is pure integration —
different concern (state routing, event propagation, cross-component wiring).

**Done ka matlab:** Complete chapter in Focus Mode → "Quiz shuru karo" chip → click → modal opens →
quiz → pass → modal closes → chapter shows "completed" → FocusModal no longer shows "Quiz Pending"
for it. **Full end-to-end flow.**

---

## Phase 4 Mein Kya NAHI Hai

| Feature | Phase | Kyun nahi |
|---|---|---|
| Practice Quiz Hub (standalone page) | 5 | Separate page + routing + history UI = different scope |
| Quiz History list/detail view | 5 | APIs exist (Phase 2), UI is a Practice Hub concern |
| Sidebar Quiz entry point | 5 | Blueprint AUDIT: sidebar redesign decision needed first (§10) |
| `/quiz` route in App.jsx | 5 | No standalone page in Phase 4 — everything is in the modal |
| Language toggle (en/hi/hinglish) | Future | Default hinglish, toggle is a future feature |
| Weak topic analysis display | Phase 4* | UI structure ready but hidden — `topicId` 0% populated |
| studyEvent logging for quiz | 6 | Requires `studyEvent.model.js` schema changes first |
| `mix_practice` quiz from ChatPage | 5 | Mix quiz has no gate trigger — always from Practice Hub |
| Any backend changes | — | Phase 2-3 already covered all API + business logic |

---

## Existing Patterns to Follow (No New Patterns)

- **Modal:** MUI `<Dialog>` with `PaperProps` CSS-variable styling — same as `FocusModal.jsx`/`GuestLimitModal.jsx`
- **API calls:** `axiosInstance.post/get()` — same as rest of `tutorApi.js`. `fetch()` is ONLY for `askTutor`'s SSE stream.
- **Identity:** automatic via `axiosInstance` request interceptor (`Authorization` or `X-Guest-Id`) — no manual passing needed
- **Suggested action chips:** backend sends `suggestedActions[]` → `ChatMessage.jsx` renders `action-chip` buttons → `onSuggestedAction(action)` → ChatPage's `handleSuggestedAction` switch
- **Cross-component sync:** `chapter-progress-updated` CustomEvent (already used in `ChatPage.jsx:488`, `useChapterProgress.js:48-51`)
- **CSS:** `global.css` with CSS variables for chat-specific classes; MUI `sx` for component-scoped styling
