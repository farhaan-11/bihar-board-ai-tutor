# ADR-012: Guest identity is a server-signed token in the X-Guest-Id header (not a client UUID, not a cookie)

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

A guest (unauthenticated visitor) is identified by an `X-Guest-Id` header. That
id keys the 5-turn guest cap (`guest_turns:<gid>`), the ask/quiz rate-limit
buckets, and the `guestId` columns on `chapter_progress`, `quiz_attempt`,
`quiz_session`, `study_event`, and (added in this work) `chat_sessions`.

Originally the **browser generated that id itself** (`crypto.randomUUID()` in
`localStorage`). The server only checked that it looked like a UUID. This meant:

- **The 5-turn cap was not an abuse control.** A script that sends a fresh random
  UUID per request gets a fresh counter every request → unlimited RAG + 2×LLM
  calls. The only thing bounding this was `globalApiLimiter`'s raw-IP key (a
  separate issue, `BACKLOG.md` R6).
- **A guest's chat could never be claimed on login.** `chat_sessions` had no
  guest link at all (`userId` only, `null` for guests), and `claimGuestData()`
  never touched chat. A guest who chatted then signed up lost that history.

This was known when the client-UUID design was built — it was a deliberate
"ship fast, fix later" shortcut. This ADR records the permanent fix.

## Decision

The server mints a **signed JWT** (`{ t: 'guest', gid }`, `GUEST_TOKEN_SECRET`,
180-day expiry) via `POST /api/v1/auth/guest` (IP-rate-limited). The browser
stores it under the existing `zuno-guest-id` key and sends it as `X-Guest-Id`.
One backend middleware (`attachGuest`) verifies it and sets `req.guest`; every
consumer reads `req.guest?.id`. `claimGuestData()` now also transfers
`chat_sessions` (and syncs `chat_history.userId`). The login claim reads the
identity only from the verified header token, never a request body.

The token rides in a **header**, not an HttpOnly cookie.

## Why

- **The signature is the fix, not the transport.** A forged/rotated id fails
  `jwt.verify` → `req.guest = null` → the request is IP-keyed and the 5-turn cap
  can no longer be farmed. To get a *new* valid identity you must call the
  rate-limited mint endpoint. This holds whether the token is in a header or a
  cookie.
- **A cookie would re-introduce the C-2 cross-domain class of bug.** Frontend
  (Vercel) and backend (Render) are different domains, so a guest cookie would
  need `sameSite:'none'; Secure`, `credentials:'include'` on the raw `fetch` in
  `tutorApi.js`, and would carry a prod-only failure mode that passes locally —
  exactly how C-2 and the Playwright prerender both bit this project.
- **HttpOnly buys almost nothing here.** A guest token grants no account, just a
  5-turn allowance. Stealing it is pointless.
- **The header path already existed.** `X-Guest-Id` was already wired through
  axios and the raw fetch; only the *value* changed (UUID → token). Minimal
  blast radius.
- **The inner `gid` stays a UUID**, so every `guestId` column, index, and the
  claim logic keep working unchanged.

## Rejected alternatives

| Option | Why not |
|---|---|
| Keep the client-generated UUID, just raise the 5-turn cap | Cap patch (`AUDIT_RULES.md` Rule 4). The forgeable key is the cause; the number is not. |
| Server-signed token in an HttpOnly cookie | Re-opens the C-2 cross-domain cookie failure class for a near-zero security gain (see Why). |
| Move `optionalAuth` to app-level so `globalApiLimiter` can see identity | Blast radius across all 8 route files + `requireAuth`'s internal `optionalAuth` call; deserves its own branch. Out of scope — this ADR does not touch `globalApiLimiter` (still `BACKLOG.md` R6). |
| Keep a permanent legacy-UUID acceptance path for old browsers | Leaving a disabled/ां narrow forgeable path is the cruft Rule 4 forbids. A one-release transition window was used, then removed (Phase 6). |

## Consequences

**Easy now:**
- Guest rate limits and the 5-turn cap are real — an unauthenticated abuser on
  one machine is bounded.
- A guest's chat, chapter progress, and quiz history all transfer to their
  account on login.
- One trusted reader of `X-Guest-Id` (`attachGuest`); adding a new guest-aware
  endpoint is a one-line `req.guest?.id` read.

**Cost / hard:**
- `GUEST_TOKEN_SECRET` is now a required env var — the server refuses to boot
  without it (same as the JWT secrets). Must be set on Render.
- Any guest who had progress under a *client-generated UUID* before this shipped
  and had **not yet logged in** loses that guest progress (their browser mints a
  fresh token). Accepted: this shipped pre-launch with ~0 real guest data, and
  the transition window covered the immediate switch-over.
- A brand-new visitor has no identity for the few ms between page load and the
  first mint; `askTutor` awaits the mint before firing to close that race for
  the one endpoint that can't degrade.

## Revisit when

- Guest volume becomes significant AND guest-token theft turns out to matter →
  reconsider HttpOnly cookie hardening (layer it on; the signature stays the
  primary control).
- `globalApiLimiter` (R6) is fixed — at that point it could also key by
  `req.guest.id`, since the token is now trustworthy.
