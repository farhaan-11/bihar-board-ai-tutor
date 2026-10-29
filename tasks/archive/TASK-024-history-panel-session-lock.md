# TASK-024 — History Panel + Session Lock (P2-T6)

## Status: DONE — verified against code 2026-07-29 (see TASKS.md)

## Audit: 2026-06-16
Bugs 1–6 have been identified and corrected below before implementation.
This is the authoritative implementation spec. Do not implement from the earlier draft.

---

## What This Task Builds

1. **Session History Panel** — FAB-triggered panel showing the user's past sessions.
   - Logged-in users: date-grouped list of sessions, clickable to switch.
   - Guest users: inline prompt to log in (not a floating Dialog — an inline Box).

2. **Session Lock UI** — When a session hits the token limit (`isLocked: true`):
   - AskBar shows a lock notice banner and disables input.
   - Topbar "Focus" button is disabled.
   - A `role: 'system'` message appears in the chat.
   - "New Chat" button is visually highlighted to guide the user.

---

## Files — 3 New, 5 Modified

| Step | File | Type |
|------|------|------|
| 1 | `frontend/src/api/tutorApi.js` | Modify |
| 2 | `frontend/src/hooks/useSessionList.js` | **New** |
| 3 | `frontend/src/components/GuestLoginPrompt.jsx` | **New** |
| 4 | `frontend/src/components/Topbar.jsx` | Modify |
| 5 | `frontend/src/components/AskBar.jsx` | Modify |
| 6 | `frontend/src/components/ChatMessage.jsx` | Modify |
| 7 | `frontend/src/components/HistoryPanel.jsx` | **New** |
| 8 | `frontend/src/pages/ChatPage.jsx` | Modify |

Implement in this order — each step depends on the previous ones.

---

## Step 1 — `frontend/src/api/tutorApi.js`

Add `fetchSessions` export. Uses `axiosInstance` (auth interceptors already wired —
Bearer token auto-attached, 401 triggers silent refresh).

```js
export const fetchSessions = async () => {
  try {
    const { data } = await axiosInstance.get('/api/v1/sessions');
    return data.data; // shape: { sessions: [...] }
  } catch {
    return { sessions: [] }; // silent fail — guest or network error
  }
};
```

Backend returns per-session: `{ sessionId, title, sessionType, lastMessageAt, isLocked, messageCount, currentChapterId }`.
The endpoint has `requireAuth` — guests will get 401, caught silently above.

---

## Step 2 — `frontend/src/hooks/useSessionList.js` (NEW)

```js
import { useState, useRef, useCallback } from 'react';
import { fetchSessions } from '../api/tutorApi.js';

export default function useSessionList({ enabled }) {
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const hasFetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchSessions();
      setSessions(result?.sessions ?? []);
    } catch {
      setError('Sessions load nahi hui.');
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  // Panel pehli baar khule tab sirf ek baar fetch karta hai.
  // enabled: false (guest) → hasFetchedRef never sets → fetchOnce is always a no-op for guests.
  const fetchOnce = useCallback(() => {
    if (hasFetchedRef.current || !enabled) return;
    hasFetchedRef.current = true;
    refresh();
  }, [enabled, refresh]);

  return { sessions, isLoading, error, refresh, fetchOnce };
}
```

---

## Step 3 — `frontend/src/components/GuestLoginPrompt.jsx` (NEW)

**Not** a MUI Dialog — an inline `Box` rendered inside HistoryPanel.
Named `GuestLoginPrompt`, not `GuestLoginDialog` (avoids confusion with MUI Dialog).

```jsx
import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useNavigate } from 'react-router-dom';

export default function GuestLoginPrompt() {
  const navigate = useNavigate();

  return (
    <Box sx={{ p: 3, textAlign: 'center' }}>
      <LockOutlined sx={{ fontSize: 32, color: 'var(--text-muted)', mb: 1 }} />
      <Typography variant="body2" sx={{ color: 'var(--text-secondary)', mb: 0.5 }}>
        Login karo to apni chats save ho jaayengi
      </Typography>
      <Typography variant="caption" sx={{ color: 'var(--text-muted)', display: 'block', mb: 2 }}>
        Guest chats abhi save nahi hoti — yeh feature jald aa raha hai!
      </Typography>
      <Button
        variant="contained"
        size="small"
        onClick={() => navigate('/login')}
        sx={{ textTransform: 'none', fontWeight: 600 }}
      >
        Login karo →
      </Button>
    </Box>
  );
}
```

---

## Step 4 — `frontend/src/components/Topbar.jsx`

Add `isSessionLocked` prop.

```jsx
export default function Topbar({
  theme,
  onToggleTheme,
  selectedChapter,
  isFocusLoading,
  onOpenFocus,
  onClearFocus,
  onNewChat,
  isSessionLocked,   // ← ADD THIS
}) {
```

Focus button — disable when locked (session is exhausted, focus change is pointless):
```jsx
<Button
  variant="outlined"
  size="small"
  disabled={isFocusLoading || isSessionLocked}   // ← add isSessionLocked
  onClick={onOpenFocus}
  ...
>
  Focus
</Button>
```

New Chat button — highlight when locked to guide user to their only action:
```jsx
<Button
  variant={isSessionLocked ? 'contained' : 'outlined'}
  size="small"
  color={isSessionLocked ? 'primary' : 'inherit'}
  onClick={onNewChat}
  ...
>
  New Chat
</Button>
```

The mobile `AddCommentOutlined` IconButton variant stays as-is (no contained variant for icon buttons).

---

## Step 5 — `frontend/src/components/AskBar.jsx`

Add `isLocked` prop. Keep `disabled` as-is — it controls the cancel button for in-flight
requests. `isLocked` is a separate concern: session is exhausted.

**BUG-1 FIX:** Do NOT drop `isHistoryLoading` from `disabled`. ChatPage passes
`disabled={isAsking || isHistoryLoading}` — keep that exact prop value.

```jsx
function AskBar({ disabled, isLocked, onAsk, onCancel, studyMode }) {
```

Lock notice banner — shown above the input Paper when session is locked:
```jsx
{isLocked && (
  <Box sx={{
    display: 'flex',
    alignItems: 'center',
    gap: 0.5,
    px: 1,
    py: 0.75,
    mb: 0.5,
    borderRadius: 'var(--radius-md)',
    bgcolor: 'var(--bg-surface)',
    border: '1px solid var(--border)',
  }}>
    <LockOutlined sx={{ fontSize: 14, color: 'var(--text-muted)' }} />
    <Typography variant="caption" sx={{ color: 'var(--text-muted)' }}>
      Is session ki limit reach ho gayi. Nayi chat shuru karo.
    </Typography>
  </Box>
)}
```

When locked, InputBase and send button are disabled:
```jsx
<InputBase
  fullWidth
  id="question"
  value={question}
  onChange={(event) => setQuestion(event.target.value)}
  disabled={isLocked}   // ← ADD: prevents typing when locked
  placeholder={
    isLocked
      ? 'Nayi chat shuru karo'
      : studyMode === 'focus'
        ? 'Is chapter ka topic ya question likho...'
        : 'Aaj kya padhna hai? Topic ya question likho...'
  }
  ...
/>
```

When locked: hide both Send and Cancel buttons (session is over, no action possible):
```jsx
{isLocked ? null : disabled ? (
  /* Cancel button — existing code */
) : (
  /* Send button — existing code */
)}
```

Imports to add: `LockOutlined` from `@mui/icons-material/LockOutlined`, `Typography` from `@mui/material/Typography`.

---

## Step 6 — `frontend/src/components/ChatMessage.jsx`

Add `role: 'system'` rendering for lock/cap notice messages.
These are centered, muted, icon-prefixed — visually distinct from tutor bubbles.

```jsx
import LockOutlined from '@mui/icons-material/LockOutlined';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

function ChatMessage({ message, onSwitchToGlobal }) {
  const isStudent = message.role === 'student';
  const isSystem = message.role === 'system';        // ← ADD
  const isFocusMiss = message.status === 'focus_context_not_found';
  const isThinking = message.status === 'thinking';
  // ...

  // System notice — centered muted row (lock, cap notices)
  if (isSystem) {
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        py: 2,
        color: 'var(--text-muted)',
      }}>
        <LockOutlined sx={{ fontSize: 14 }} />
        <Typography variant="caption">{message.answer}</Typography>
      </Box>
    );
  }

  // ... rest of existing rendering unchanged
```

---

## Step 7 — `frontend/src/components/HistoryPanel.jsx` (NEW)

### Layout

- **Mobile** (`useMediaQuery(theme.breakpoints.down('sm'))`): MUI `Drawer` `anchor="bottom"`.
- **Desktop/Tablet**: Absolutely-positioned panel (fixed, above FAB).

### FAB position

**BUG-6 FIX:** `bottom: 80` is too close — when the lock banner is visible in AskBar, it
adds ~40px to the input zone. Use `bottom: 128` to safely clear both AskBar and the banner.

```jsx
<Fab
  onClick={handleFabClick}
  size="medium"
  sx={{ position: 'fixed', bottom: 128, right: 16, zIndex: 1200 }}
>
  <HistoryRounded />
  {isLoggedIn && sessions.length > 0 && (
    <Badge
      badgeContent={sessions.length}
      color="primary"
      sx={{ position: 'absolute', top: 6, right: 6 }}
    />
  )}
</Fab>
```

### Panel content — 4 states (in render order)

```
isAuthLoading   → <CircularProgress /> centered
!isLoggedIn     → <GuestLoginPrompt />
isLoading       → 3x skeleton rows
sessions empty  → "Koi purani chat nahi hai. Pehla sawaal poochho!"
sessions exist  → date-grouped list
```

### Date grouping

```js
const groupByDate = (sessions) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = { Today: [], Yesterday: [], 'This Week': [], Earlier: [] };
  for (const s of sessions) {
    const d = new Date(s.lastMessageAt);
    if (d >= today) groups['Today'].push(s);
    else if (d >= yesterday) groups['Yesterday'].push(s);
    else if (d >= weekAgo) groups['This Week'].push(s);
    else groups['Earlier'].push(s);
  }
  return groups;
};
```

### Per-session row

Each row shows: title (truncated), lock icon if `s.isLocked`, relative time.
Highlighted if `s.sessionId === activeSessionId`.

### Props

```jsx
<HistoryPanel
  isLoggedIn={isLoggedIn}
  isAuthLoading={isAuthLoading}
  sessions={sessions}
  isLoading={sessionsLoading}
  activeSessionId={sessionId}
  isSessionLocked={isSessionLocked}
  onSessionSelect={handleSessionSwitch}
  onNewChat={handleNewChat}
  fetchOnce={fetchOnce}
/>
```

### Panel open handler

```jsx
const handleFabClick = () => {
  setIsOpen(prev => {
    if (!prev) fetchOnce(); // fetch on first open only
    return !prev;
  });
};
```

---

## Step 8 — `frontend/src/pages/ChatPage.jsx`

### New state

```js
const [isSessionLocked, setIsSessionLocked] = useState(false);
```

### New refs (add alongside existing refs)

```js
const isSwitchingRef = useRef(false);   // BUG-2 FIX: abort race guard
```

### New hook

```js
const { sessions, isLoading: sessionsLoading, refresh, fetchOnce } =
  useSessionList({ enabled: isLoggedIn });
```

### New factory helpers (add alongside createWelcomeMessage etc.)

**BUG-4 FIX:** Three helpers that the plan referenced but never defined.

```js
const createLockSystemMessage = () => ({
  id: crypto.randomUUID(),
  role: 'system',
  answer: 'Is session ki limit reach ho gayi. Nayi chat shuru karo.',
  sources: [],
});

const createCapNoticeMessage = () => ({
  id: crypto.randomUUID(),
  role: 'system',
  answer: 'Purani 30 messages load ki gayi hain.',
  sources: [],
});

const dbMessageToUiMessage = (m) => ({
  id: crypto.randomUUID(),
  role: m.role === 'student' ? 'student' : 'zuno',
  answer: m.text,
  status: m.metadata?.status || 'answered',
  sources: m.sources || [],
  sections: m.metadata?.sections || [],
  responseMode: m.metadata?.responseMode || null,
});
```

### Refactor existing history useEffect to use `dbMessageToUiMessage`

Replace the existing inline map (lines 114–122) with:
```js
setMessages(dbMessages.map(dbMessageToUiMessage));
```

Also add lock state restore on initial load:

```js
fetchSessionHistory(savedId).then((result) => {
  if (cancelled) return;
  const dbMessages = result?.messages ?? [];
  const converted = dbMessages.map(dbMessageToUiMessage);
  setMessages(converted.length > 0 ? converted : [createWelcomeMessage()]);
  setIsSessionLocked(result?.sessionMeta?.isLocked === true); // ← ADD
}).catch(...)
```

### `handleNewChat` — additions

**BUG-3 FIX** and **Missing-3 FIX:**
```js
const handleNewChat = useCallback(() => {
  controllerRef.current?.abort();
  clearTimeout(timeoutRef.current);
  controllerRef.current = null;

  clearSessionId();
  setSessionId('');
  setIsSessionLocked(false);     // ← ADD
  setIsHistoryLoading(false);    // ← ADD (prevents stuck loading state if switch was in progress)
  isSwitchingRef.current = false; // ← ADD (clear the abort guard)

  setMessages([createWelcomeMessage()]);
  setStudyMode(STUDY_MODES.global);
  setSelectedChapterId(null);
  setError('');
  setIsAsking(false);
  refresh();                     // ← ADD: reorder sidebar
}, [refresh]);
```

### `handleSessionSwitch` (NEW)

**BUG-2 FIX:** `isSwitchingRef` prevents aborted request's catch block from writing
a "Request cancel kar di" message into the new session.

**BUG-3 FIX:** `setIsHistoryLoading(true/false)` shows skeleton during switch.

**Missing-1 FIX:** Toast on fetch failure.

```js
const handleSessionSwitch = useCallback(async (session) => {
  if (session.sessionId === sessionId) return; // already on this session

  // Signal to handleAsk's catch block: do not append cancel messages
  isSwitchingRef.current = true;

  // Abort any in-flight request
  controllerRef.current?.abort();
  clearTimeout(timeoutRef.current);
  controllerRef.current = null;

  // Immediate UI reset
  setIsSessionLocked(false);
  setSessionId(session.sessionId);
  saveSessionId(session.sessionId);
  setStudyMode(session.sessionType === 'focus' ? STUDY_MODES.focus : STUDY_MODES.global);
  setSelectedChapterId(
    session.sessionType === 'focus' ? (session.currentChapterId || null) : null
  );
  setError('');
  setIsAsking(false);

  // Show skeleton while fetching new session's history
  setIsHistoryLoading(true);  // BUG-3 FIX
  setMessages([]);

  try {
    const result = await fetchSessionHistory(session.sessionId);

    // Stale check: user may have switched again while fetch was in-flight
    if (session.sessionId !== sessionIdRef.current) return;

    const dbMessages = result?.messages ?? [];
    const converted = dbMessages.map(dbMessageToUiMessage);

    const displayMessages = converted.length > 0 ? converted : [createWelcomeMessage()];

    // Show 30-cap notice if history is at the limit
    if (dbMessages.length === 30) {
      displayMessages.unshift(createCapNoticeMessage());
    }

    setMessages(displayMessages);
    setIsSessionLocked(result?.sessionMeta?.isLocked === true);
  } catch {
    if (session.sessionId !== sessionIdRef.current) return;
    setMessages([createWelcomeMessage()]);
    showToast('Session load nahi hui. Dobara try karo.', 'error'); // Missing-1 FIX
  } finally {
    if (session.sessionId === sessionIdRef.current) {
      setIsHistoryLoading(false); // BUG-3 FIX
    }
    isSwitchingRef.current = false; // BUG-2 FIX: release the abort guard
  }
}, [sessionId, showToast, refresh]);
```

### `handleAsk` — catch block addition

**BUG-2 FIX:** If switching sessions caused the abort, do not write a cancel message.

```js
} catch (askError) {
  // BUG-2 FIX: session switch aborted this request — do not pollute new session with cancel message
  if (isSwitchingRef.current) return;

  if (askError.name === 'AbortError' || askError.name === 'CanceledError') {
    const answer = wasTimeoutAbortRef.current
      ? 'Zuno thoda slow hai abhi — connection slow ho sakta hai ya server busy hai. Ek baar aur try karo!'
      : 'Request cancel kar di. Koi aur sawaal poochho!';
    setMessages((prev) => [...prev, createAnswerMessage({
      status: 'cancelled',
      answer,
      sources: [],
    })]);
  } else {
    setMessages((prev) => [...prev, createAnswerMessage({
      status: 'error',
      answer: askError.message,
      sources: [],
    })]);
  }
}
```

### `handleAsk` — success path addition

When backend returns `session.isLocked: true`, append lock message and lock the UI.
Also refresh sidebar after every successful response so session reorders correctly.

```js
const backendSessionId = payload.session?.sessionId;
if (backendSessionId && backendSessionId !== sessionIdRef.current) {
  setSessionId(backendSessionId);
  saveSessionId(backendSessionId);
}

const isNowLocked = payload.session?.isLocked === true;
if (isNowLocked) {
  setMessages((prev) => [
    ...prev,
    createAnswerMessage(payload),
    createLockSystemMessage(),   // both in one setMessages call
  ]);
  setIsSessionLocked(true);
} else {
  setMessages((prev) => [...prev, createAnswerMessage(payload)]);
}

refresh(); // reorder sidebar after every response
```

### JSX changes

AskBar — **BUG-1 FIX:** Keep `isHistoryLoading` in `disabled`. Add `isLocked` separately.
```jsx
<AskBar
  disabled={isAsking || isHistoryLoading}   // ← unchanged from current
  isLocked={isSessionLocked}                // ← ADD
  onAsk={handleAsk}
  onCancel={handleCancel}
  studyMode={studyMode}
/>
```

Topbar:
```jsx
<Topbar
  theme={theme}
  onToggleTheme={toggleTheme}
  selectedChapter={selectedChapter}
  isFocusLoading={isStudyMapLoading}
  onOpenFocus={() => setIsFocusModalOpen(true)}
  onClearFocus={handleClearFocus}
  onNewChat={handleNewChat}
  isSessionLocked={isSessionLocked}   // ← ADD
/>
```

HistoryPanel (add below FocusModal):
```jsx
<HistoryPanel
  isLoggedIn={isLoggedIn}
  isAuthLoading={isAuthLoading}
  sessions={sessions}
  isLoading={sessionsLoading}
  activeSessionId={sessionId}
  isSessionLocked={isSessionLocked}
  onSessionSelect={handleSessionSwitch}
  onNewChat={handleNewChat}
  fetchOnce={fetchOnce}
/>
```

---

## Bug Fix Traceability

| Bug ID | Severity | Fix Location |
|--------|----------|-------------|
| BUG-1: `isHistoryLoading` dropped from AskBar `disabled` | CRITICAL | Step 5 + Step 8 AskBar JSX |
| BUG-2: Abort race — cancel message appears in new session | CRITICAL | Step 8 `isSwitchingRef` + `handleAsk` catch |
| BUG-3: No skeleton during session switch | MEDIUM | Step 8 `handleSessionSwitch` + `handleNewChat` |
| BUG-4: `createLockSystemMessage`, `createCapNoticeMessage`, `dbMessageToUiMessage` undefined | MEDIUM | Step 8 factory helpers |
| BUG-5: `GuestLoginDialog` name misleading (inline, not Dialog) | LOW | Step 3 renamed to `GuestLoginPrompt` |
| BUG-6: FAB `bottom: 80` too close — overlaps lock banner | LOW | Step 7 FAB `bottom: 128` |
| Missing-1: No error toast on session switch failure | MEDIUM | Step 8 `handleSessionSwitch` catch |
| Missing-3: `isHistoryLoading` stuck if New Chat during switch | MEDIUM | Step 8 `handleNewChat` |

---

## Implementation Rules

- Do not implement steps out of order.
- `dbMessageToUiMessage` — extract from the existing `useEffect` inline map, do not duplicate.
- `GuestLoginPrompt` — inline Box only, never MUI Dialog.
- `isSwitchingRef` must be released in `handleSessionSwitch`'s `finally` block — not just success path.
- After every `askTutor` success, call `refresh()` — even if session is now locked.
- `disabled={isAsking || isHistoryLoading}` in AskBar props must never be simplified.

## After Implementation

Run from `frontend/`:
```
npm run build
```

Then smoke test manually:
1. Guest user opens panel → sees GuestLoginPrompt
2. Login → panel shows sessions list
3. Switch session → skeleton shows → history loads → no "cancel" message appears
4. Ask until locked → lock banner appears → AskBar disabled → system message in chat
5. New Chat after lock → lock state resets
6. Page refresh → `isSessionLocked` restored from sessionMeta
