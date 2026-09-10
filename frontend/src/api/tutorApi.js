import axiosInstance from '../services/axios/axiosInstance.js';
import { store } from '../store/store.js';
import { parse } from 'partial-json';
import { setCredentials, clearCredentials } from '../store/slices/authSlice.js';
import { refreshAccessToken } from '../services/axios/authService.js';
import { ensureGuestToken } from '../utils/guestToken.js';

// The guest identity is a server-minted token stored under `zuno-guest-id`.
// The browser no longer invents its own id.
const getGuestId = () => localStorage.getItem('zuno-guest-id') || null;

export const fetchStudyMap = async () => {
  try {
    const { data } = await axiosInstance.get('/api/v1/study-map');
    return data.data;
  } catch (error) {
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      'Something went wrong while loading the study map.';
    throw new Error(message);
  }
};

export const deleteSession = async (sessionId) => {
  await axiosInstance.delete(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
};

export const renameSession = async (sessionId, title) => {
  const { data } = await axiosInstance.patch(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/rename`,
    { title }
  );
  return data.data;
};

export const fetchSessions = async () => {
  try {
    const { data } = await axiosInstance.get('/api/v1/sessions');
    return data.data; // shape: { sessions: [...] }
  } catch (err) {
    if (err.response?.status !== 401) {
      console.error('[fetchSessions]', err.message);
    }
    return { sessions: [] };
  }
};

export const fetchSessionHistory = async (sessionId) => {
  try {
    const { data } = await axiosInstance.get(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/history`
    );
    return data.data;
  } catch (err) {
    // 401 is silent — axios interceptor handles token refresh / logout
    if (err.response?.status === 401) return null;

    // For all other errors, throw with the backend's machine-readable code attached.
    // ChatPage uses this to distinguish a stale guest sessionId (SESSION_USER_MISMATCH)
    // from a genuine network failure, so it only clears localStorage when appropriate.
    const error = new Error(
      err.response?.data?.error?.message || 'Session history load nahi hui.'
    );
    error.code = err.response?.data?.error?.code || null;
    error.status = err.response?.status || 0;
    throw error;
  }
};

// ─── Chapter Progress API ──────────────────────────────────────────────────
// All three functions use axiosInstance so auth token + X-Guest-Id are sent
// automatically via the request interceptor.

export const fetchChapterProgress = async (chapterId) => {
  try {
    const { data } = await axiosInstance.get(
      `/api/v1/chapter-progress/${encodeURIComponent(chapterId)}`
    );
    return data.data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(
      err.response?.data?.error?.message || 'Chapter progress load nahi hui.'
    );
  }
};

export const listChapterProgress = async ({ status, limit = 10 } = {}) => {
  try {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit)  params.set('limit', String(limit));
    const { data } = await axiosInstance.get(`/api/v1/chapter-progress?${params}`);
    return data.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.error?.message || 'Chapter progress list load nahi hui.'
    );
  }
};

export const chapterProgressAction = async (chapterId, action, extra = {}) => {
  try {
    const { data } = await axiosInstance.post(
      `/api/v1/chapter-progress/${encodeURIComponent(chapterId)}/action`,
      { action, ...extra }
    );
    return data.data;
  } catch (err) {
    throw new Error(
      err.response?.data?.error?.message || 'Chapter action fail ho gayi.'
    );
  }
};

// ─── Quiz API ───────────────────────────────────────────────────────────────
// Both use axiosInstance so auth token + X-Guest-Id are sent automatically.
// error.code/status are attached (not just message) so QuizModal can branch on
// 404 (no questions/chapter) vs 409 (not awaiting_quiz / already submitted) vs
// 429 (rate limit) instead of only showing a generic failure string.

export const generateQuiz = async ({ quizType, subjectId, chapterId }) => {
  try {
    const { data } = await axiosInstance.post('/api/v1/quiz/generate', {
      quizType, subjectId, chapterId,
    });
    return data.data;
  } catch (err) {
    const error = new Error(
      err.response?.data?.error?.message || 'Quiz generate nahi hui.'
    );
    error.code = err.response?.data?.error?.code || null;
    error.status = err.response?.status || 0;
    throw error;
  }
};

export const submitQuiz = async ({ quizId, submissionKey, timeTakenSec, answers }) => {
  try {
    const { data } = await axiosInstance.post('/api/v1/quiz/submit', {
      quizId, submissionKey, timeTakenSec, answers,
    });
    return data.data;
  } catch (err) {
    const error = new Error(
      err.response?.data?.error?.message || 'Quiz submit nahi hui.'
    );
    error.code = err.response?.data?.error?.code || null;
    error.status = err.response?.status || 0;
    throw error;
  }
};

export const fetchQuizHistory = async ({ quizType, chapterId, cursor, limit } = {}) => {
  try {
    const params = new URLSearchParams();
    if (quizType)  params.set('quizType', quizType);
    if (chapterId) params.set('chapterId', chapterId);
    if (cursor)    params.set('cursor', cursor);
    if (limit)     params.set('limit', String(limit));
    const { data } = await axiosInstance.get(`/api/v1/quiz/history?${params}`);
    return data.data; // { attempts: [...], nextCursor, hasMore }
  } catch (err) {
    const error = new Error(
      err.response?.data?.error?.message || 'Quiz history load nahi hui.'
    );
    error.code = err.response?.data?.error?.code || null;
    error.status = err.response?.status || 0;
    throw error;
  }
};

export const fetchQuizAttemptDetail = async (attemptId) => {
  try {
    const { data } = await axiosInstance.get(
      `/api/v1/quiz/history/${encodeURIComponent(attemptId)}`
    );
    return data.data;
  } catch (err) {
    const error = new Error(
      err.response?.data?.error?.message || 'Quiz attempt detail load nahi hui.'
    );
    error.code = err.response?.data?.error?.code || null;
    error.status = err.response?.status || 0;
    throw error;
  }
};

// ─── Streaming Ask API ─────────────────────────────────────────────────────
// Wraps fetch() with one silent token refresh on 401 — mirrors the axios interceptor pattern.
// Only attempts refresh for logged-in users (accessToken present); guests are skipped.
// retried flag prevents infinite refresh loops.
const fetchWithTokenRefresh = async (url, options, retried = false) => {
  const response = await fetch(url, options);

  if (response.status === 401 && !retried && store.getState().auth?.accessToken) {
    try {
      const data = await refreshAccessToken();
      const newToken = data?.data?.accessToken;
      if (!newToken) throw new Error('No token in refresh response');

      store.dispatch(
        setCredentials({ user: store.getState().auth.user, accessToken: newToken })
      );

      const newOptions = {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
      };
      return fetchWithTokenRefresh(url, newOptions, true);
    } catch {
      sessionStorage.setItem('zuno.authRedirect', 'Session expire ho gayi. Dobara login karo.');
      store.dispatch(clearCredentials());
      return response; // return original 401 — caller handles the error display
    }
  }

  return response;
};

export const askTutor = async ({ question, studyMode, chapterId, sessionId }, signal, onUpdate = null, onStage = null) => {
  const body = { question, studyMode };

  if (sessionId) {
    body.sessionId = sessionId;
  }

  if (studyMode === 'focus') {
    body.chapterId = chapterId;
  }

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001';
  const token = store.getState().auth?.accessToken;

  // A brand-new guest may reach /ask before main.jsx's ensureGuestToken() has
  // resolved — mint it now so the request carries an identity (the backend
  // rejects a guest /ask with no X-Guest-Id).
  if (!token && !getGuestId()) {
    await ensureGuestToken();
  }

  const headers = { 'Content-Type': 'application/json' };
  const guestId = getGuestId();
  if (guestId) headers['X-Guest-Id'] = guestId;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetchWithTokenRefresh(`${API_BASE_URL}/api/v1/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json();
      const error = new Error();
      error.response = { status: response.status, data: errorData };
      error.code = errorData.error?.code;
      throw error;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';
      let finalPayload = null;
      let lastUpdateTime = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.replace(/^data:\s*/, '').trim();
          if (!dataStr) continue;

          // D3 hardening: one malformed SSE frame must not kill the whole stream —
          // skip it and keep reading rather than throwing out of the loop.
          let dataObj;
          try {
            dataObj = JSON.parse(dataStr);
          } catch (parseErr) {
            console.warn('[askTutor] Skipping malformed SSE frame:', parseErr.message);
            continue;
          }

          if (dataObj.event === 'end') {
            finalPayload = dataObj.payload;
            break;
          }

          if (dataObj.event === 'stage') {
            if (onStage) onStage(dataObj.stage);
            continue;
          }

          if (dataObj.token) {
            accumulatedText += dataObj.token;
            const now = Date.now();
            if (onUpdate && (now - lastUpdateTime > 33)) {
              try {
                const partialObj = parse(accumulatedText);
                onUpdate(partialObj);
              } catch (e) {
                // Ignore transient parsing issues
              }
              lastUpdateTime = now;
            }
          }
        }
      }

      // D4 fix: stream ended (reader done) without ever seeing an 'end' event —
      // e.g. connection dropped mid-response. Fail loudly here, before the caller
      // dereferences payload.session on a null payload.
      if (finalPayload === null) {
        const incompleteError = new Error('Stream ended without a complete response');
        incompleteError.name = 'StreamIncompleteError';
        throw incompleteError;
      }

      return finalPayload;
    } else {
      const data = await response.json();
      return data.data;
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'StreamIncompleteError') {
      throw error;
    }
    if (
      error.response?.status === 429 &&
      error.response?.data?.error?.code === 'GUEST_LIMIT_REACHED'
    ) {
      const e = new Error(error.response.data.error.message);
      e.code = 'GUEST_LIMIT_REACHED';
      throw e;
    }
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      'Something went wrong while talking to Zuno.';
    throw new Error(message);
  }
};
