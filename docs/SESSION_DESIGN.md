# SESSION_DESIGN.md — Zuno Session Architecture

## Decided On: June 2026
## Status: LOCKED — Do not change without discussion

---

## Completed Steps

- [x] Step 1: Install all required packages (backend + frontend) — DONE
- [x] Step 2: Redis client setup (redisClient.js, Upstash) — DONE
- [x] Step 3: User model (user.model.js) — DONE
- [x] Step 4: tokenHelpers.js — generateAccessToken, generateRefreshToken, verifyAccessToken, verifyRefreshToken — DONE
- [x] Step 5: authMiddleware.js — optionalAuth, requireAuth, requireAdmin — DONE

---

## Core Architecture: Bounded Multi-Session

- One user can have multiple sessions (like GPT/Claude sidebar)
- Each session has a max token limit (context window)
- When limit is reached → session is locked, no more chat allowed
- User must start a new session to continue
- Sidebar shows session history (with a max display limit)

---

## Token Counting Strategy

- Use LLM provider's actual usage data (e.g. Groq: usage.total_tokens)
- After every query: session.totalTokensUsed += usage.total_tokens
- This counts EVERYTHING — system prompt + RAG chunks + history + query + response
- Before every query: check if totalTokensUsed >= TOKEN_LIMIT
- If limit reached → do NOT call LLM → return informative message to user

### Token Limit
- Default: 15,000 tokens per session
- Stored as env variable: SESSION_TOKEN_LIMIT=15000

### When Session is Locked — User Message:
"Is session ki limit reach ho gayi hai. Nayi chat shuru karo wahan se continue kar sakte ho."
- Frontend should highlight "New Chat" button when this happens
- This is NOT shown as an error — it is an informative message

---

## Session Types

| Type    | chapterId | Purpose                        |
|---------|-----------|--------------------------------|
| focus   | Fixed     | Deep study of one chapter      |
| global  | null      | Free exploration, all subjects |

---

## Focus Mode — One Session, One Chapter (LOCKED)

- A Focus Mode session is permanently bound to ONE chapter
- Chapter cannot be changed within a session
- This is a PRODUCT decision, not just technical:
  → Student should deeply study one chapter — questions, explanations, quiz
  → Chapter completion can be tracked per session
  → Future: quiz + exam questions will also live in this session
- 15k token window is intentionally generous for deep single-chapter study

---

## Session Title Generation

- Title is generated ONLY on the first query of a session (messageCount === 0)
- Generated inside Step 6/7 (main LLM call) — NOT a separate API call
- LLM instruction added to existing prompt:
  "If this is the first query, return a sessionTitle key (5-7 words) in your JSON response"
- Title stored in DB → user can rename later (future feature)
- Zero extra cost — same LLM call, extra output key

---

## Session History Sidebar

- Shows all sessions for logged-in user
- Ordered by: most recent first
- Display limit: TBD (decide before frontend implementation)
- Each session shows: title + date + session type (focus/global)
- Focus sessions also show: chapter name

---

## Guest Users

- Guests CAN chat (limited to GUEST_DAILY_LIMIT queries)
- Guest sessions are NOT saved to DB
- Guest has NO sidebar history
- On sidebar area, guests see:
  "Apni study history save karne ke liye login karo."
- Guest session merge after login: DEFERRED (tracked as FET in PROBLEMS.md)
- Reason for deferral: complex edge cases, auth not yet stable, not needed for MVP

---

## ChatSession Schema (target design)

> Current implementation note (2026-06-08): A `ChatSession` model already exists today
> at `backend/src/models/chatSession.model.js`. It is the tutor-state version
> (`sessionId`, `userId`, `mode`, `title`, `lastMessageAt`, and a nested `chatState`
> object), and chat messages live in a **separate** `chatHistory` collection — i.e.
> Option B below was chosen. The token-bounded fields listed here (`totalTokensUsed`,
> `isLocked`, `sessionType`, etc.) are the planned target and are **not yet merged**
> into that model. This section stays LOCKED as the design goal.

Fields to include:
- userId         → ref: User (required)
- sessionType    → enum: ['focus', 'global']
- chapterId      → ref: Chapter, null for global sessions
- title          → String, auto-generated on first query
- totalTokensUsed → Number, default 0
- isLocked       → Boolean, default false (true when token limit reached)
- messages       → Array (or separate collection — TBD)
- createdAt / updatedAt → auto timestamps

### Message Storage — Decided: Option B
  Option A: Embed messages array inside ChatSession document
  Option B: Separate ChatMessage collection with sessionId reference  ← chosen
The current code uses Option B: a separate `chatHistory` collection keyed by
`sessionId` (see `backend/src/models/chatHistory.model.js`).

---

## Decisions Deferred / Not Yet Made

- [ ] Max sessions displayed in sidebar (number TBD)
- [ ] Message storage: embedded vs separate collection (discuss before impl)
- [ ] Session soft-delete or hard-delete (when user deletes from sidebar)
- [ ] Guest session merge after login (FET — future feature)
- [ ] Quiz/exam integration with focus sessions (future feature)
- [ ] Chapter completion marking logic (future feature)
- [ ] chatSession + chatHistory model migration to ObjectId refs — DEFERRED until auth is fully complete. Reason: pipeline-wide breaking change, safer to do as one coordinated update after auth is stable.

---

## Implementation Order (for when we get there)

1. Update ChatSession model with new fields
2. Link ChatSession to User model
3. Token counting in pipeline (step6/step7)
4. Session lock check before LLM call
5. Session title generation on first query
6. Frontend: sidebar session list
7. Frontend: new chat button + locked session message
8. Guest: no history, show login prompt in sidebar
