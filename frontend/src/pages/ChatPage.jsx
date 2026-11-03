import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import Box from '@mui/material/Box';
import { useLocation, useNavigate } from 'react-router-dom';
import { askTutor, fetchSessionHistory, fetchStudyMap, fetchChapterProgress, chapterProgressAction } from '../api/tutorApi.js';
import AskBar from '../components/AskBar.jsx';
import ChatMessage from '../components/ChatMessage.jsx';
import FocusModal from '../components/FocusModal.jsx';
import StatusNotice from '../components/StatusNotice.jsx';
import Toast from '../components/Toast.jsx';
import Topbar from '../components/Topbar.jsx';
import { STUDY_MODES } from '../constants/studyModes.js';
import { clearSessionId, getSavedSessionId, saveSessionId } from '../utils/session.js';
import { findFirstChapter } from '../utils/studyMap.js';
import { useChapterTopics } from '../hooks/useChapterTopics.js';
import {
  getGuestTurnCount,
  incrementGuestTurnCount,
  isGuestLimitReached,
  setGuestTurnCountToLimit,
  GUEST_TURN_LIMIT,
} from '../utils/guestLimit.js';
import GuestLimitModal from '../components/GuestLimitModal.jsx';
import QuizModal from '../components/QuizModal.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { useToast } from '../hooks/useToast.js';
import useSessionList from '../hooks/useSessionList.js';
import HistoryPanel from '../components/HistoryPanel.jsx';
import Sidebar from '../components/Sidebar.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

// --- Message factory helpers ---


const createQuestionMessage = (question) => ({
  id: crypto.randomUUID(),
  role: 'student',
  answer: question,
});

const createAnswerMessage = (payload) => ({
  id: crypto.randomUUID(),
  role: 'zuno',
  ...payload,
});

const createLockSystemMessage = () => ({
  id: crypto.randomUUID(),
  role: 'system',
  answer: 'Session yahan tak. Nayi chat mein aage badho.',
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

const createFocusMessage = (chapter) => ({
  id: crypto.randomUUID(),
  role: 'zuno',
  status: 'focus_selected',
  answer: `Ab hum "${chapter.hinglishTitle || chapter.title}" padhenge. Chaho toh main seedha chapter start karu, ya iska overview janna chahte ho?`,
  sources: [],
  suggestedActions: [
    { type: 'next_topic', label: 'Chapter shuru karein' },
    { type: 'related_concept', label: 'Chapter overview batao' }
  ]
});

// Builds a "roadmap" message purely from already-loaded client state — no backend/LLM
// call. Shows a small window around the student's current position (mirrors the
// windowing FocusProgressHeader's tooltip already uses) rather than the full topic
// list, since some chapters have 40+ core topics.
const buildRoadmapMessage = (topics, currentTopicId, completedTopicIds) => {
  if (!Array.isArray(topics) || topics.length === 0) {
    return {
      id: crypto.randomUUID(),
      role: 'zuno',
      sections: [{ heading: '', content: 'Roadmap abhi load nahi ho paayi. Thodi der mein try karo.' }],
      sources: [],
    };
  }

  const currentIndex = topics.findIndex((t) => t.topicId === currentTopicId);
  const anchor = currentIndex === -1 ? 0 : currentIndex;
  const windowTopics = topics.slice(Math.max(0, anchor - 2), Math.min(topics.length, anchor + 4));

  const sections = [
    { heading: '', content: `${completedTopicIds.length} / ${topics.length} topics complete` },
    ...windowTopics.map((t) => {
      const isDone = completedTopicIds.includes(t.topicId);
      const isCurrent = t.topicId === currentTopicId;
      const icon = isDone ? '✅' : isCurrent ? '🟢' : '🔒';
      return { heading: '', content: `${icon} ${t.title}` };
    }),
  ];

  return { id: crypto.randomUUID(), role: 'zuno', sections, sources: [] };
};

// --- ChatPage component ---

function ChatPage({ theme, toggleTheme }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, showToast, hideToast } = useToast();
  const { isLoggedIn, isLoading: isAuthLoading } = useAuth();
  const { sessions, isLoading: sessionsLoading, refresh, fetchOnce } =
    useSessionList({ enabled: isLoggedIn });

  useEffect(() => {
    if (location.state?.toastSuccess) {
      showToast(location.state.toastSuccess, 'success');
    } else if (location.state?.toastError) {
      showToast(location.state.toastError, 'error');
    }
    
    if (location.state) {
      // Clear via React Router (not raw window.history) so its internal state
      // is actually cleared too, not just the browser history entry.
      navigate(location.pathname, { replace: true, state: null });
    }
  }, []);

  const [studyMode, setStudyMode] = useState(STUDY_MODES.global);
  const [isFocusModalOpen, setIsFocusModalOpen] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState(null);
  
  // Focus Progress State
  const [completedTopicIds, setCompletedTopicIds] = useState([]);
  const [currentTopicId, setCurrentTopicId] = useState(null);
  // ISSUE-1 (FOCUS_MODE_PROGRESS_FIX_PLAN.md): separate "engagement" stat — how many
  // doubt/explain-more turns the student has had in this chapter. Deliberately never
  // blended into completedTopicIds/progressPercent — see the plan file for reasoning.
  const [engagementCount, setEngagementCount] = useState(0);
  // ISSUE-2 (FOCUS_MODE_PROGRESS_FIX_PLAN.md): real ChapterProgress.status, so
  // FocusProgressHeader never has to guess chapter-complete from array lengths.
  const [chapterStatus, setChapterStatus] = useState(null);

  // Loaded for the "roadmap" suggested action — built purely client-side, no LLM call.
  const { topics: chapterTopics } = useChapterTopics(selectedChapterId);

  const [studyMap, setStudyMap] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [sessionId, setSessionId] = useState(() => getSavedSessionId());
  const [isStudyMapLoading, setIsStudyMapLoading] = useState(true);
  const [isAsking, setIsAsking] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [hasNewResponse, setHasNewResponse] = useState(false);
  const [error, setError] = useState('');
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [isGuestLimited, setIsGuestLimited] = useState(false);
  const [guestLimitModal, setGuestLimitModal] = useState({ open: false, trigger: 'turn_limit' });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isQuizModalOpen, setIsQuizModalOpen] = useState(false);

  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const controllerRef = useRef(null);
  const timeoutRef = useRef(null);
  const wasTimeoutAbortRef = useRef(false);
  const isSwitchingRef = useRef(false); // BUG-2 FIX: abort race guard

  // Refs so async callbacks always read the latest state values
  const sessionIdRef = useRef(sessionId);
  const selectedChapterIdRef = useRef(selectedChapterId);
  const studyModeRef = useRef(studyMode);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { selectedChapterIdRef.current = selectedChapterId; }, [selectedChapterId]);
  useEffect(() => { studyModeRef.current = studyMode; }, [studyMode]);

  // Cleanup on unmount — abort any in-flight request
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      clearTimeout(timeoutRef.current);
    };
  }, []);

  // On mount: if guest already hit the limit (e.g. came back after closing tab), lock AskBar immediately
  useEffect(() => {
    if (!isAuthLoading && !isLoggedIn && isGuestLimitReached()) {
      setIsGuestLimited(true);
    }
  }, [isAuthLoading, isLoggedIn]);

  // Load chat history from DB on mount — restores messages after page refresh
  // Waits for auth to initialize before deciding (race condition guard)
  useEffect(() => {
    if (isAuthLoading) return;

    const savedId = getSavedSessionId();

    if (!savedId || !isLoggedIn) {
      setMessages([]);
      setIsHistoryLoading(false);
      return;
    }

    let cancelled = false;
    fetchSessionHistory(savedId).then((result) => {
      if (cancelled) return;
      // result is null only on 401 (silent) — show welcome and keep sessionId as-is
      if (!result) {
        setMessages([]);
        return;
      }
      const dbMessages = result?.messages ?? [];
      const converted = dbMessages.map(dbMessageToUiMessage).map(msg => ({ ...msg, isNew: false }));
      setMessages(converted);
      setIsSessionLocked(result?.sessionMeta?.isLocked === true);

      // Restore focus mode state from session meta (fixes refresh-loss bug)
      const meta = result?.sessionMeta;
      if (meta?.sessionType === 'focus' && meta.currentChapterId) {
        setStudyMode(STUDY_MODES.focus);
        setSelectedChapterId(meta.currentChapterId);
        setCompletedTopicIds(meta.completedTopicIds || []);
        setCurrentTopicId(meta.currentTopicId ?? null);
        setEngagementCount((meta.totalDoubtsAsked || 0) + (meta.totalExplainMoreCount || 0));
        setChapterStatus(meta.chapterStatus ?? null);
      }
    }).catch((err) => {
      if (cancelled) return;
      // SESSION_USER_MISMATCH = logged-in user's localStorage has a stale guest sessionId.
      // Clear it so the next question creates a fresh session instead of hitting a 403.
      if (err.code === 'SESSION_USER_MISMATCH') {
        clearSessionId();
        setSessionId('');
      }
      setMessages([]);
    }).finally(() => {
      if (!cancelled) setIsHistoryLoading(false);
    });

    return () => { cancelled = true; };
  }, [isAuthLoading]);

  // Load study map on mount
  useEffect(() => {
    let isMounted = true;
    fetchStudyMap()
      .then((map) => { if (isMounted) { setStudyMap(map); setSelectedChapterId(null); } })
      .catch((err) => { if (isMounted) setError(err.message); })
      .finally(() => { if (isMounted) setIsStudyMapLoading(false); });
    return () => { isMounted = false; };
  }, []);

  // Auto-scroll to latest message — useLayoutEffect (not useEffect) so the scroll
  // position is corrected in the same frame as the DOM update, before the browser
  // paints. useEffect runs after paint, which shows one frame of the pre-scroll
  // position and then snaps on the next frame — a visible micro-jitter during
  // rapid streaming updates.
  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current || !chatContainerRef.current) return;
    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages, isAsking]);

  // Derive full chapter object from selected chapter ID
  const selectedChapter = useMemo(() => {
    const subjects = studyMap?.focusStudy?.subjects || [];
    for (const subject of subjects) {
      for (const section of subject.sections || []) {
        const chapter = (section.chapters || []).find((c) => c.id === selectedChapterId);
        if (chapter) return { ...chapter, sectionTitle: section.title, subjectTitle: subject.title };
      }
    }
    return null;
  }, [selectedChapterId, studyMap]);

  // Find chapter by ID — used when user selects a chapter from FocusModal
  const findChapterById = (chapterId) => {
    const subjects = studyMap?.focusStudy?.subjects || [];
    for (const subject of subjects) {
      for (const section of subject.sections || []) {
        const chapter = (section.chapters || []).find((c) => c.id === chapterId);
        if (chapter) return { ...chapter, sectionTitle: section.title, subjectTitle: subject.title };
      }
    }
    return null;
  };

  const handleFocusChapterSelect = async (chapterId) => {
    const nextChapter = findChapterById(chapterId);

    // Auto-start a new session if we are already in an active chat.
    // This prevents a 'global' session from being illegally converted to a 'focus' session.
    if (messages.length > 0) {
      clearSessionId();
      setSessionId('');
      setIsSessionLocked(false);
      setMessages([]);
      setIsAsking(false);
      setCompletedTopicIds([]);
      setCurrentTopicId(null);
      setEngagementCount(0);
      setChapterStatus(null);
      refresh();
    }

    setSelectedChapterId(chapterId);
    setStudyMode(STUDY_MODES.focus);
    setIsFocusModalOpen(false);
    setError('');

    if (!nextChapter) return;

    // Fetch real cross-session progress so the welcome message + chips reflect where
    // the student actually left off, instead of always showing the generic "start"
    // text regardless of progress. Falls back to the static message on any failure.
    let progressData = null;
    try {
      progressData = await fetchChapterProgress(chapterId);
    } catch {
      progressData = null;
    }

    // Staleness guard: the student may have picked a different chapter, or left focus
    // mode entirely, while this fetch was in flight — don't apply a stale result.
    if (selectedChapterIdRef.current !== chapterId || studyModeRef.current !== STUDY_MODES.focus) {
      return;
    }

    // Sync the actual progress pointers too — not just the welcome text. Without this,
    // the header and the "roadmap" action would keep showing the pre-fetch [] /null
    // state (everything locked, 0%) until the next ask() response corrected it.
    if (progressData?.progress) {
      setCompletedTopicIds(progressData.progress.completedTopicIds || []);
      setCurrentTopicId(progressData.progress.currentTopicId || null);
      setEngagementCount(
        (progressData.progress.totalDoubtsAsked || 0) + (progressData.progress.totalExplainMoreCount || 0)
      );
      setChapterStatus(progressData.progress.status || null);
    }

    const recommendation = progressData?.recommendation;
    const focusMessage = recommendation
      ? {
          id: crypto.randomUUID(),
          role: 'zuno',
          status: 'focus_selected',
          answer: recommendation.message,
          sources: [],
          suggestedActions: recommendation.chips || [],
        }
      : createFocusMessage(nextChapter);

    setMessages([{ ...focusMessage, isNew: true }]);
  };

  const handleClearFocus = () => {
    setStudyMode(STUDY_MODES.global);
    setSelectedChapterId(null);
    setError('');
  };

  const handleNewChat = useCallback(() => {
    // Guests who have had at least 1 turn must log in to start a new chat (history won't be saved otherwise)
    if (!isLoggedIn && getGuestTurnCount() >= 1) {
      setGuestLimitModal({ open: true, trigger: 'new_chat' });
      return;
    }

    controllerRef.current?.abort();
    clearTimeout(timeoutRef.current);
    controllerRef.current = null;

    clearSessionId();
    setSessionId('');
    shouldAutoScrollRef.current = true;
    setUserScrolledUp(false);
    setHasNewResponse(false);
    setIsSessionLocked(false);
    setIsHistoryLoading(false);    // BUG-3 FIX: prevent stuck loading if switch was in progress
    isSwitchingRef.current = false; // BUG-2 FIX: release abort guard

    setMessages([]);
    setStudyMode(STUDY_MODES.global);
    setSelectedChapterId(null);
    setError('');
    setIsAsking(false);
    refresh();
  }, [refresh, isLoggedIn]);

  const handleAsk = useCallback(async (question, requestMode) => {
    const cleanQuestion = question.trim();
    const currentMode = requestMode ?? studyModeRef.current;

    if (!cleanQuestion || controllerRef.current) return;

    if (currentMode === STUDY_MODES.focus && !selectedChapterIdRef.current) {
      setError('Focus mode ke liye pehle chapter select karo.');
      return;
    }

    // Pre-flight guest limit check (frontend gate before API call)
    if (!isLoggedIn && isGuestLimitReached()) {
      setIsGuestLimited(true);
      setGuestLimitModal({ open: true, trigger: 'turn_limit' });
      return;
    }

    setError('');
    setIsAsking(true);
    setThinkingStage(null);
    setMessages((prev) => [...prev, { ...createQuestionMessage(cleanQuestion), isNew: true }]);

    const controller = new AbortController();
    controllerRef.current = controller;
    wasTimeoutAbortRef.current = false;

    timeoutRef.current = setTimeout(() => {
      wasTimeoutAbortRef.current = true;
      controller.abort();
    }, 60000);

    try {
      let isFirstUpdate = true;
      const tempMessageId = crypto.randomUUID();

      const payload = await askTutor(
        {
          question: cleanQuestion,
          studyMode: currentMode,
          chapterId: selectedChapterIdRef.current,
          sessionId: sessionIdRef.current,
        },
        controller.signal,
        (partialData) => {
          if (isFirstUpdate) {
            setIsAsking(false); // hide thinking dots early
            setHasNewResponse(true); // real content has started — safe to show the "scroll down" pill now
            isFirstUpdate = false;
            setMessages((prev) => [
              ...prev,
              { id: tempMessageId, role: 'zuno', ...partialData, status: partialData.status || 'answered', isNew: true }
            ]);
          } else {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempMessageId
                  ? { ...msg, ...partialData, status: partialData.status || 'answered' }
                  : msg
              )
            );
          }
        },
        (stage) => setThinkingStage(stage)
      );

      const backendSessionId = payload.session?.sessionId;
      if (backendSessionId && backendSessionId !== sessionIdRef.current) {
        setSessionId(backendSessionId);
        saveSessionId(backendSessionId);
      }

      const isNowLocked = payload.session?.isLocked === true;
      
      // Update Focus progress from the response's chapterProgress payload —
      // ChapterProgress is the single source of truth for topic progress now,
      // not session.completedTopicIds/currentTopicId (removed in the BUG-1 fix).
      if (payload.chapterProgress) {
        setCompletedTopicIds(payload.chapterProgress.completedTopicIds ?? []);
        setCurrentTopicId(payload.chapterProgress.currentTopicId ?? null);
        setEngagementCount(
          (payload.chapterProgress.totalDoubtsAsked ?? 0) + (payload.chapterProgress.totalExplainMoreCount ?? 0)
        );
        setChapterStatus(payload.chapterProgress.status ?? null);
      }

      // Bust the useChapterProgress hook cache so FocusModal shows fresh data next open
      if (payload.chapterProgress?.chapterId || selectedChapterIdRef.current) {
        const updatedChapterId = payload.chapterProgress?.chapterId ?? selectedChapterIdRef.current;
        window.dispatchEvent(
          new CustomEvent('chapter-progress-updated', { detail: { chapterId: updatedChapterId } })
        );
      }

      setMessages((prev) => {
        const withoutTemp = isFirstUpdate ? prev : prev.filter(m => m.id !== tempMessageId);
        if (isNowLocked) {
          return [...withoutTemp, createAnswerMessage(payload), createLockSystemMessage()];
        }
        return [...withoutTemp, createAnswerMessage(payload)];
      });
      
      if (isNowLocked) {
        setIsSessionLocked(true);
      }

      // Increment guest turn counter after a confirmed successful response
      if (!isLoggedIn) {
        const newCount = incrementGuestTurnCount();
        if (newCount >= GUEST_TURN_LIMIT) {
          setIsGuestLimited(true);
          setGuestLimitModal({ open: true, trigger: 'turn_limit' });
        }
      }

      refresh(); // reorder sidebar after every successful response
    } catch (askError) {
      // BUG-2 FIX: session switch caused this abort — do not pollute new session
      if (isSwitchingRef.current) return;

      // Backend safety net fired (e.g. localStorage was cleared) — sync frontend state
      if (askError.code === 'GUEST_LIMIT_REACHED') {
        setGuestTurnCountToLimit();
        setIsGuestLimited(true);
        setGuestLimitModal({ open: true, trigger: 'turn_limit' });
        return;
      }

      if (askError.name === 'AbortError' || askError.name === 'CanceledError') {
        const answer = wasTimeoutAbortRef.current
          ? 'Zuno thoda slow hai abhi — connection slow ho sakta hai ya server busy hai. Ek baar aur try karo!'
          : 'Request cancel kar di. Koi aur sawaal poochho!';

        if (!isFirstUpdate) {
          // Streaming had started — update the partial message in-place instead of appending.
          // User keeps the partial content and sees it's incomplete.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempMessageId
                ? { ...m, status: 'cancelled', answer: m.answer || answer }
                : m
            )
          );
        } else {
          setMessages((prev) => [...prev, { ...createAnswerMessage({ status: 'cancelled', answer, sources: [] }), isNew: true }]);
        }
      } else if (askError.name === 'StreamIncompleteError') {
        // Connection dropped mid-stream (no 'end' event ever arrived). Whatever partial
        // content rendered so far must NOT be shown as a finished answer (that was the
        // root cause of the "Explanation here" bug) — mark it clearly incomplete and let
        // the student retry via the ChatMessage banner instead of silently trusting it.
        if (!isFirstUpdate) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempMessageId
                ? { ...m, status: 'stream_incomplete' }
                : m
            )
          );
        } else {
          setMessages((prev) => [
            ...prev,
            { ...createAnswerMessage({ status: 'stream_incomplete', answer: '', sources: [] }), isNew: true },
          ]);
        }
      } else {
        if (!isFirstUpdate) {
          // Streaming had started — mark partial message as errored, preserve what arrived.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempMessageId
                ? { ...m, status: 'error' }
                : m
            )
          );
        } else {
          setMessages((prev) => [...prev, { ...createAnswerMessage({ status: 'error', answer: askError.message, sources: [] }), isNew: true }]);
        }
      }
    } finally {
      clearTimeout(timeoutRef.current);
      controllerRef.current = null;
      setIsAsking(false);
      setThinkingStage(null);
    }
  }, [isLoggedIn]);

  // Re-sends a failed/incomplete question — always in the CURRENT study mode
  // (not whatever mode the failed turn happened to be in), same as a fresh ask.
  const handleRetry = useCallback((question) => {
    if (!question) return;
    handleAsk(question);
  }, [handleAsk]);

  const handleCancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const handleScroll = useCallback((e) => {
    const { scrollHeight, scrollTop, clientHeight } = e.currentTarget;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom > 100) {
      shouldAutoScrollRef.current = false;
      setUserScrolledUp(true);
    } else if (distanceFromBottom <= 30) {
      shouldAutoScrollRef.current = true;
      setUserScrolledUp(false);
      setHasNewResponse(false); // user is back at the bottom — they've seen it
    }
  }, []);

  const handleGuestLimitLogin = useCallback(() => {
    setGuestLimitModal((m) => ({ ...m, open: false }));
    navigate('/login');
  }, [navigate]);

  const handleGuestLimitRegister = useCallback(() => {
    setGuestLimitModal((m) => ({ ...m, open: false }));
    navigate('/register');
  }, [navigate]);

  const handleOpenGuestLimitModal = useCallback(() => {
    setGuestLimitModal({ open: true, trigger: 'turn_limit' });
  }, []);

  const handleSwitchToGlobal = useCallback(async (question) => {
    let q = question;
    if (!q) {
      const lastStudentMsg = [...messages].reverse().find(m => m.role === 'student');
      if (lastStudentMsg) q = lastStudentMsg.answer;
    }
    if (!q) return;

    setStudyMode(STUDY_MODES.global);
    await handleAsk(q, STUDY_MODES.global);
  }, [messages, handleAsk]);

  const handleSuggestedAction = useCallback(async (action) => {
    if (controllerRef.current) return; // block if request already in-flight

    switch (action.type) {
      case 'switch_chapter':
        setIsFocusModalOpen(true);
        break;

      case 'global_mode':
        handleClearFocus();
        break;

      // These come from buildRecommendation() on the backend. The label shown to the
      // student varies by progress state, but we always send this same proven-safe
      // canonical phrase as the actual question — decouples display copy from
      // decider-intent routing so a future wording change can never silently
      // misclassify the request.
      // 'next_step' = genuinely starting the chapter (not_started/revising states) —
      // "Chapter shuru karein" is accurate here.
      case 'next_step':
        handleAsk('Chapter shuru karein', studyModeRef.current);
        break;
      // 'continue_step' = resuming mid-chapter (in_progress state). Must NOT reuse
      // "Chapter shuru karein" — the backend advances correctly either way (NEXT_STEP
      // always reads chapterProgress.currentTopicId regardless of phrasing), but the
      // student's own message would misleadingly read "start the chapter" when they
      // clicked "continue". "Aage badhao" is decider-safe (its first NEXT_STEP example).
      case 'continue_step':
        handleAsk('Aage badhao', studyModeRef.current);
        break;
      // Backend-guaranteed advance chip (see sanitizeSuggestedActions in
      // step7.saveAndRespond.js) — always injected for CONCEPT_QUESTION/
      // EXPLAIN_MORE/EXAM_INFO/mid-chapter NEXT_STEP turns in Focus Mode, so
      // it must route the same decider-safe way as 'continue_step', not fall
      // through to the generic label-as-question default.
      case 'next_topic':
        handleAsk('Aage badhao', studyModeRef.current);
        break;
      case 'chapter_overview':
        handleAsk('Chapter overview batao', studyModeRef.current);
        break;

      // Sent when chapterProgress.status === 'awaiting_quiz' (buildRecommendation
      // on the backend). Opens QuizModal directly — this is a pure frontend
      // action, no /ask call, since the modal makes its own generate/submit
      // requests once it's open.
      case 'start_gate_quiz':
        setIsQuizModalOpen(true);
        break;

      // Discards progress and starts over — needs a backend reset BEFORE asking,
      // otherwise NEXT_STEP would resolve from the old (unreset) topic pointer.
      case 'restart_topic':
      case 'revise_chapter': {
        const chapterId = selectedChapterIdRef.current;
        if (!chapterId) return;
        const resetStatus = action.type === 'revise_chapter' ? 'revising' : 'in_progress';
        try {
          await chapterProgressAction(chapterId, 'reset', { status: resetStatus });
          window.dispatchEvent(new CustomEvent('chapter-progress-updated', { detail: { chapterId } }));
          handleAsk('Chapter shuru karein', studyModeRef.current);
        } catch {
          showToast('Progress reset nahi hua. Dobara try karo.', 'error');
        }
        break;
      }

      // Pure frontend — built from already-loaded topics/progress, no backend/LLM call.
      case 'roadmap': {
        const roadmapMessage = buildRoadmapMessage(chapterTopics, currentTopicId, completedTopicIds);
        setMessages((prev) => [...prev, { ...roadmapMessage, isNew: true }]);
        break;
      }

      default:
        handleAsk(action.label, studyModeRef.current);
    }
  }, [handleAsk, handleClearFocus, showToast, chapterTopics, currentTopicId, completedTopicIds]);

  // QuizModal's state is local to itself — it doesn't know about chapterStatus or
  // the FocusModal "Quiz Pending" chip. On a gate-quiz pass, we sync both: flip
  // the header's status locally (same field NEXT_STEP responses already update)
  // and bust useChapterProgress's cache so FocusModal drops the pending badge
  // next time it's opened (same event handleAsk already fires on every response).
  const handleQuizComplete = useCallback((result) => {
    if (!result?.passed) return;
    setChapterStatus('completed');
    const chapterId = selectedChapterIdRef.current;
    if (chapterId) {
      window.dispatchEvent(new CustomEvent('chapter-progress-updated', { detail: { chapterId } }));
    }
  }, []);

  const handleSessionSwitch = useCallback(async (session) => {
    if (session.sessionId === sessionId) return; // already on this session

    // BUG-2 FIX: signal handleAsk catch block — do not append cancel message
    isSwitchingRef.current = true;

    // Abort any in-flight request
    controllerRef.current?.abort();
    clearTimeout(timeoutRef.current);
    controllerRef.current = null;

    // Immediate UI reset
    setIsSessionLocked(false);
    setSessionId(session.sessionId);
    saveSessionId(session.sessionId);
    shouldAutoScrollRef.current = true;
    setUserScrolledUp(false);
    setHasNewResponse(false);
    // Optional: optimistic set if session object has them, otherwise we will set them after fetch
    setStudyMode(session.sessionType === 'focus' ? STUDY_MODES.focus : STUDY_MODES.global);
    if (session.currentChapterId) {
      setSelectedChapterId(session.currentChapterId);
    }
    setError('');
    setIsAsking(false);

    // BUG-3 FIX: show skeleton while fetching new session's history
    setIsHistoryLoading(true);
    setMessages([]);

    try {
      const result = await fetchSessionHistory(session.sessionId);

      // Stale check: user may have switched again while fetch was in-flight
      if (session.sessionId !== sessionIdRef.current) return;

      const dbMessages = result?.messages ?? [];
      const displayMessages = dbMessages.map(dbMessageToUiMessage).map(msg => ({ ...msg, isNew: false }));

      // Show cap notice if history is at the 30-message limit
      if (dbMessages.length === 30) {
        displayMessages.unshift(createCapNoticeMessage());
      }

      setMessages(displayMessages);
      setIsSessionLocked(result?.sessionMeta?.isLocked === true);
      
      if (result?.sessionMeta) {
        setStudyMode(result.sessionMeta.sessionType === 'focus' ? STUDY_MODES.focus : STUDY_MODES.global);
        if (result.sessionMeta.sessionType === 'focus' && result.sessionMeta.currentChapterId) {
          setSelectedChapterId(result.sessionMeta.currentChapterId);
          setCompletedTopicIds(result.sessionMeta.completedTopicIds || []);
          setCurrentTopicId(result.sessionMeta.currentTopicId || null);
          setEngagementCount(
            (result.sessionMeta.totalDoubtsAsked || 0) + (result.sessionMeta.totalExplainMoreCount || 0)
          );
          setChapterStatus(result.sessionMeta.chapterStatus ?? null);
        } else if (result.sessionMeta.sessionType === 'global') {
          setSelectedChapterId(null);
          setCompletedTopicIds([]);
          setCurrentTopicId(null);
          setEngagementCount(0);
          setChapterStatus(null);
        }
      }
    } catch {
      if (session.sessionId !== sessionIdRef.current) return;
      setMessages([]);
      showToast('Session load nahi hui. Dobara try karo.', 'error'); // Missing-1 FIX
    } finally {
      if (session.sessionId === sessionIdRef.current) {
        setIsHistoryLoading(false); // BUG-3 FIX
      }
      isSwitchingRef.current = false; // BUG-2 FIX: release abort guard
    }
  }, [sessionId, showToast]);

  return (
    <>
      <Helmet>
        <title>Apna Sawaal Poochho — Zuno AI Tutor | Class 10 Science</title>
        <meta
          name="description"
          content="Bihar Board Class 10 Science ka koi bhi doubt seedha poochho. Zuno AI Tutor Hinglish mein grounded jawab deta hai — Physics, Chemistry, Biology sab cover."
        />
        <link rel="canonical" href="https://learnzuno.in/chat" />
      </Helmet>
      <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        height: '100vh',
        bgcolor: 'var(--bg-page)',
        overflow: 'hidden',
      }}
    >
      <Sidebar
        isLoggedIn={isLoggedIn}
        isAuthLoading={isAuthLoading}
        sessions={sessions}
        isSessionsLoading={sessionsLoading}
        fetchOnce={fetchOnce}
        activeSessionId={sessionId}
        onSessionSelect={handleSessionSwitch}
        onNewChat={handleNewChat}
        onSessionDelete={(deletedId) => {
          if (deletedId === sessionId) handleNewChat();
          refresh();
        }}
        onSessionRename={() => refresh()}
      />

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
        }}
      >
      <Topbar
        theme={theme}
        onToggleTheme={toggleTheme}
        selectedChapter={selectedChapter}
        isFocusLoading={isStudyMapLoading}
        onOpenFocus={() => setIsFocusModalOpen(true)}
        onClearFocus={handleClearFocus}
        onNewChat={handleNewChat}
        onOpenHistory={() => setHistoryOpen(true)}
        isSessionLocked={isSessionLocked}
        focusTopics={studyMode === STUDY_MODES.focus ? chapterTopics : []}
        currentTopicId={currentTopicId}
        completedTopicIds={completedTopicIds}
        engagementCount={engagementCount}
        chapterStatus={chapterStatus}
      />

      {/* key=sessionId: when session changes, ErrorBoundary remounts and clears any crashed state */}
      <ErrorBoundary key={sessionId}>
        {/* Chat area — scrollable */}
        <Box
          component="main"
          ref={chatContainerRef}
          onScroll={handleScroll}
          aria-live="polite"
          sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2, position: 'relative' }}
        >
          <Box sx={{
            maxWidth: 'var(--chat-max-width)',
            mx: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}>
            {isHistoryLoading ? (
              <ChatMessage
                message={{ id: 'loading', role: 'zuno', answer: '', status: 'thinking', sources: [] }}
              />
            ) : messages.length === 0 ? (
              studyMode === STUDY_MODES.focus && selectedChapterId && selectedChapter ? (
                <div className="chat-empty-state">
                  <div className="chat-empty-illustration">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="9" stroke="url(#focus-grad)" strokeWidth="2.2"/>
                      <circle cx="12" cy="12" r="4" fill="url(#focus-grad)"/>
                      <defs>
                        <linearGradient id="focus-grad" x1="1" y1="3" x2="23" y2="21" gradientUnits="userSpaceOnUse">
                          <stop stopColor="var(--primary-accent, #F0A500)"/>
                          <stop offset="1" stopColor="#C6570F"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <div className="chat-empty-title">Focus Mode: {selectedChapter.hinglishTitle || selectedChapter.title}</div>
                  <div className="chat-empty-sub">Pehla sawaal poochho ya chapter seedha start karo!</div>
                  <div className="chat-empty-chips">
                    <button className="chat-empty-chip" onClick={() => handleAsk('Chapter shuru karein', STUDY_MODES.focus)}>▶ Chapter shuru karein</button>
                    <button className="chat-empty-chip" onClick={() => handleAsk('Is chapter ka overview batao', STUDY_MODES.focus)}>📖 Overview batao</button>
                    <button className="chat-empty-chip" onClick={() => handleAsk('Koi important question poochho is chapter se', STUDY_MODES.focus)}>❓ Exam question dikhao</button>
                  </div>
                </div>
              ) : (
                <div className="chat-empty-state">
                  <div className="chat-empty-illustration">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 3L1 9L5 11.18V17.18L12 21L19 17.18V11.18L21 10.09V17H23V9L12 3ZM18.82 9L12 12.72L5.18 9L12 5.28L18.82 9ZM17 15.99L12 18.72L7 15.99V12.27L12 15L17 12.27V15.99Z" fill="url(#zuno-grad)"/>
                      <defs>
                        <linearGradient id="zuno-grad" x1="1" y1="3" x2="23" y2="21" gradientUnits="userSpaceOnUse">
                          <stop stopColor="var(--primary-accent, #F0A500)"/>
                          <stop offset="1" stopColor="#C6570F"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                  <div className="chat-empty-title">Zuno: Aapka AI Tutor</div>
                  <div className="chat-empty-sub">Bina dare sawaal poochho. Hum milkar exam fodenge!</div>
                  <div className="chat-empty-chips">
                    <button className="chat-empty-chip" onClick={() => handleAsk('Newton ka pehla niyam kya hai?')}>⚡ Newton ka pehla niyam kya hai?</button>
                    <button className="chat-empty-chip" onClick={() => handleAsk('Carbon dioxide kaise banta hai?')}>🧪 Carbon dioxide kaise banta hai?</button>
                    <button className="chat-empty-chip" onClick={() => handleAsk('Photosynthesis kya hota hai?')}>🌿 Photosynthesis kya hota hai?</button>
                  </div>
                </div>
              )
            ) : messages.map((message, index) => {
              let question = message.question;
              if (!question && message.role === 'zuno') {
                for (let i = index - 1; i >= 0; i--) {
                  if (messages[i].role === 'student') {
                    question = messages[i].answer;
                    break;
                  }
                }
              }
              // Avatar + "Zuno" label only on the first message of a consecutive
              // Zuno run — a follow-up message (e.g. the roadmap chip) right after
              // a response doesn't need to re-announce who's speaking.
              const showHeader = index === 0 || messages[index - 1].role !== 'zuno';
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  question={question}
                  onSwitchToGlobal={handleSwitchToGlobal}
                  onSuggestedAction={handleSuggestedAction}
                  onRetry={handleRetry}
                  showHeader={showHeader}
                />
              );
            })}
            {isAsking && (
              <ChatMessage
                message={{ id: 'thinking', role: 'zuno', answer: '', status: 'thinking', stage: thinkingStage, sources: [] }}
              />
            )}
            <div ref={chatEndRef} />
            {userScrolledUp && hasNewResponse && (
              <button
                className="scroll-to-bottom-pill"
                onClick={() => {
                  shouldAutoScrollRef.current = true;
                  setUserScrolledUp(false);
                  setHasNewResponse(false);
                  chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
                }}
              >
                ↓ New answer
              </button>
            )}
          </Box>
        </Box>

        {/* Input zone — fixed at bottom */}
        <Box sx={{
          flexShrink: 0,
          bgcolor: 'var(--bg-surface)',
          px: { xs: 2, sm: 3 },
          py: 1.5,
        }}>
          <Box sx={{ maxWidth: 'var(--chat-max-width)', mx: 'auto' }}>
            <StatusNotice error={error} />
            <AskBar
              disabled={isAsking}
              isHistoryLoading={isHistoryLoading}
              isLocked={isSessionLocked}
              isGuestLimited={isGuestLimited}
              onGuestLimitClick={handleOpenGuestLimitModal}
              onAsk={handleAsk}
              onCancel={handleCancel}
              studyMode={studyMode}
              showHint={messages.length === 0}
              isGuest={!isLoggedIn}
            />
          </Box>
        </Box>
      </ErrorBoundary>
      </Box>

      <FocusModal
        isOpen={isFocusModalOpen}
        isLoading={isStudyMapLoading}
        selectedChapterId={selectedChapterId}
        studyMap={studyMap}
        onClose={() => setIsFocusModalOpen(false)}
        onSelectChapter={handleFocusChapterSelect}
      />

      <HistoryPanel
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        isLoggedIn={isLoggedIn}
        isAuthLoading={isAuthLoading}
        sessions={sessions}
        isLoading={sessionsLoading}
        activeSessionId={sessionId}
        onSessionSelect={handleSessionSwitch}
        onNewChat={handleNewChat}
        fetchOnce={fetchOnce}
        onSessionDelete={(deletedId) => {
          if (deletedId === sessionId) handleNewChat();
          refresh();
        }}
        onSessionRename={() => refresh()}
      />

      <GuestLimitModal
        open={guestLimitModal.open}
        trigger={guestLimitModal.trigger}
        onLogin={handleGuestLimitLogin}
        onRegister={handleGuestLimitRegister}
        onClose={() => setGuestLimitModal((m) => ({ ...m, open: false }))}
      />

      <Toast open={toast.open} message={toast.message} severity={toast.severity} onClose={hideToast} />

      <QuizModal
        isOpen={isQuizModalOpen}
        quizType="chapter_gate"
        subjectId="science"
        chapterId={selectedChapterId}
        contextTitle={selectedChapter?.hinglishTitle || selectedChapter?.title}
        onQuizComplete={handleQuizComplete}
        onClose={() => setIsQuizModalOpen(false)}
      />
    </Box>
    </>
  );
}

export default ChatPage;
