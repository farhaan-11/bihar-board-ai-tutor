/**
 * step7.saveAndRespond.js — Step 7 of the Ask API flow
 * * UPGRADED PRODUCTION-GRADE STATE COMMITER
 * * CHANGES: Integrated nested state mutations via updateChatSessionState.
 */

import { addChatMessages } from '../services/chatHistory.service.js';
import { updateChatSession, updateChatSessionState, setSessionTitleIfDefault, setFirstQuestionIfEmpty } from '../services/chatSession.service.js';
import { upsertChapterProgress, setChapterAwaitingQuiz, logStudyEvent } from '../services/chapterProgress.service.js';
import { env } from '../config/env.js';
import redis from '../config/redisClient.js';
import { logTurnSummary, recordIntentSample, logIntentAggregates } from '../utils/tokenLogger.js';

const isDev = process.env.NODE_ENV !== 'production';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shared hardening wrapper for ChapterProgress writes (the single source of truth for
 * topic progress — see FOCUS_MODE_PROGRESS_FIX_PLAN.md). A silent failure here would mean
 * the student's advance is recorded nowhere, so: one retry after a short delay, and a
 * distinctly visible error log (not a silent swallow) if it still fails.
 */
const withRetry = async (fn, label) => {
  try {
    return await fn();
  } catch (err) {
    console.error(`[Step7] ${label} failed, retrying once:`, err.message);
    await wait(200);
    try {
      return await fn();
    } catch (err2) {
      console.error(`[Step7 CRITICAL] ${label} failed after retry — write lost for this turn:`, err2.message);
      return null;
    }
  }
};

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const VALID_LEARNING_MODES = new Set(['idle', 'lesson', 'doubt', 'quiz']);

// Pipeline-generated titles that should never become a session label in the sidebar.
const SYSTEM_TITLES = new Set(['Chapter Complete!', 'Quiz Time!']);

// Phase 3 — Session Integrity Guard.
// UNSAFE_OR_ABUSIVE excluded from drift — abuse is tracked by its own abuseCount field.
const ACADEMIC_INTENTS = new Set(['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'NEXT_STEP', 'CHOOSE_COURSE']);
const DRIFT_INTENTS    = new Set(['GREETING', 'OUT_OF_CONTEXT']);

// Allowed operational state properties inside our new ChatSession layout
const ALLOWED_STATE_FIELDS = [
  'status', 'learningMode', 'currentSubjectId', 'currentSectionId',
  'currentChapterId', 'abuseCount', 'answerLanguage',
  'sessionTopicsProgress', 'pendingAction',
  'lastTopic', 'lastDoubtTopic', 'lastDoubtQuestion',
  'consecutiveErrors', 'lastErrorAt'
];

// When USE_INTENT_ROUTER=true, each intent only writes the fields it is
// responsible for. Everything else is either set by step7 code directly,
// or must never come from the LLM at all.
export const INTENT_MEMORY_WHITELIST = {
  GREETING:          [],
  EMOTIONAL_SUPPORT: [],
  OUT_OF_CONTEXT:    [],
  UNSAFE_OR_ABUSIVE: [],
  CHOOSE_COURSE:     [],                                          // BUG-3: chapter context comes from the request chapterId (step2), never the LLM; learningMode is code-managed. The old entry's fields were all overwritten by the force-sync block below.
  EXPLAIN_MORE:      ['lastDoubtTopic', 'lastDoubtQuestion'],     // NOT lastTopic — prevents drift
  CONCEPT_QUESTION:  ['lastTopic', 'lastDoubtTopic', 'lastDoubtQuestion', 'learningMode'],
  NEXT_STEP:         ['lastTopic', 'learningMode'],               // currentTopicId managed by step7 code
  EXAM_INFO:         [],                                          // deterministic lookup — LLM writes nothing
};

/**
 * Sanitizes the LLM's memoryUpdate to match the new strict chatState machine.
 * When intent is provided and in the whitelist, only the fields allowed for that
 * intent are kept. Otherwise falls back to the broad ALLOWED_STATE_FIELDS list.
 */
export const sanitizeMemoryUpdate = ({ memoryUpdate, intent }) => {
  const cleanUpdate = {};
  const allowedFields = Object.hasOwn(INTENT_MEMORY_WHITELIST, intent)
    ? INTENT_MEMORY_WHITELIST[intent]
    : ALLOWED_STATE_FIELDS;

  for (const field of allowedFields) {
    if (Object.hasOwn(memoryUpdate || {}, field)) {
      const cleanValue = memoryUpdate[field] === null
        ? null
        : memoryUpdate[field];

      // Safe string normalization for scalar types
      if (typeof cleanValue === 'string') {
        cleanUpdate[field] = cleanText(cleanValue);
      } else {
        cleanUpdate[field] = cleanValue;
      }

      // Enforce learningMode boundaries safely
      if (field === 'learningMode' && cleanUpdate[field] && !VALID_LEARNING_MODES.has(cleanUpdate[field])) {
        cleanUpdate[field] = 'idle';
      }
    }
  }

  return cleanUpdate;
};

/**
 * Removes undefined fields to keep MongoDB queries compliant.
 */
const removeUndefinedFields = (data) => {
  const cleanData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) cleanData[key] = value;
  }
  return cleanData;
};

// Intents that must never leave the student without a way to advance the
// current focus chapter — LLM-authored chips for these intents are never
// guaranteed to include a "next_topic" action (proven: CONCEPT_QUESTION's
// related_concept follow-ups never do), so it's injected here, in code,
// instead of trusted to prompt compliance. See FOCUS_MODE_PLAN.md.
const GUARANTEED_NEXT_TOPIC_INTENTS = new Set(['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'EXAM_INFO']);
const DEFAULT_NEXT_TOPIC_ACTION = { type: 'next_topic', label: 'Aage badhein' };

/**
 * Sanitizes action labels for interface cards rendering, and — in Focus Mode —
 * guarantees a "next_topic" chip is present for intents where the LLM's own
 * suggestions can otherwise leave the student with no way to advance the
 * chapter (the "loop trap" bug). NEXT_STEP only gets the guarantee when
 * nextTopicSignal is truthy — CHAPTER_COMPLETE/no_chapter responses also
 * carry intent 'NEXT_STEP' but must NOT get an "Aage badhein" chip (there is
 * no next topic in that state).
 */
const sanitizeSuggestedActions = (actions, { intent, studyMode, nextTopicSignal } = {}) => {
  const cleaned = Array.isArray(actions)
    ? actions
        .filter((action) => action && typeof action === 'object')
        .map((action) => ({
          type: cleanText(action.type).slice(0, 60),
          label: cleanText(action.label).slice(0, 80),
        }))
        .filter((action) => action.type && action.label)
    : [];

  const needsGuarantee =
    studyMode === 'focus' &&
    (GUARANTEED_NEXT_TOPIC_INTENTS.has(intent) || (intent === 'NEXT_STEP' && Boolean(nextTopicSignal)));

  const hasNextTopic = cleaned.some((action) => action.type === 'next_topic');

  const withGuarantee = (needsGuarantee && !hasNextTopic)
    ? [DEFAULT_NEXT_TOPIC_ACTION, ...cleaned] // prepend — must survive the slice(0, 4) cap below
    : cleaned;

  return withGuarantee.slice(0, 4);
};

/**
 * Formats data snapshots back to the client interface layer.
 */
const buildSessionPayload = (sessionId, updatedSession) => {
  const chatState = updatedSession?.chatState || {};
  return {
    sessionId,
    title: updatedSession?.title || 'New Chat',
    status: chatState.status || 'active',
    isLocked: chatState.status === 'exhausted', // single source of truth — no separate isLocked field
    learningMode: chatState.learningMode || 'idle',
    lastTopic: chatState.lastTopic || null,
    lastSubject: chatState.currentSubjectId || null,
    lastSection: chatState.currentSectionId || null,
    lastChapterId: chatState.currentChapterId || null,
    // currentTopicId/completedTopicIds intentionally NOT here — ChapterProgress
    // is the single source of truth for topic progress now; see payload.chapterProgress.
    sessionType: updatedSession?.sessionType || 'global',
    messageCount: chatState.messageCount || 0,
    totalTokensUsed: updatedSession?.totalTokensUsed ?? 0,
  };
};

/**
 * Step 7: Commits transaction updates to DB and responds to client.
 */
export const saveAndRespond = async (
  { question, studyMode, focusChapter },
  { sessionId, chatState, chapterProgress },
  { language, driftSignal },
  decision,
  { retrieval, retrievedContext, sources, nextTopicSignal, lastRetrievalQuery, isOutOfFocusAnswer },
  response,
  userId = null,
  tokenUsage = 0,
  guestId = null
) => {
  if (isDev) console.log(`[Step 7 Commiting] Writing updates atomically for Session ID: ${sessionId}`);

  // Step 7a: Sanitize the state updates generated during the conversation turn.
  // intent is passed so the per-intent whitelist (INTENT_MEMORY_WHITELIST) is used
  // when USE_INTENT_ROUTER=true. Falls back to ALLOWED_STATE_FIELDS for legacy path.
  const stateUpdates = sanitizeMemoryUpdate({
    memoryUpdate: response.memoryUpdate,
    intent: decision?.intent,
  });

  // Note: NEXT_STEP topic advance is no longer written to chatState/stateUpdates —
  // ChapterProgress (below) is the single source of truth for currentTopicId/completedTopicIds.

  // Save the exact retrieval query used — code-controlled, never from LLM memoryUpdate.
  // CONCEPT_QUESTION and NEXT_STEP are the only intents that retrieve content for teaching.
  // Guard: sources.length > 0 ensures we only save queries that actually returned content.
  // !isOutOfFocusAnswer excludes the out-of-focus redirect case — that turn found sources
  // globally but never taught the student anything (it declined with "yeh doosre chapter
  // mein hai"), so its query must not be remembered as "the last thing genuinely explained"
  // — otherwise a later EXPLAIN_MORE would reuse it and could teach the wrong chapter.
  const _intent = decision?.intent;
  if (
    ['CONCEPT_QUESTION', 'NEXT_STEP'].includes(_intent) &&
    lastRetrievalQuery &&
    sources?.length > 0 &&
    !isOutOfFocusAnswer
  ) {
    stateUpdates.lastRetrievalQuery = lastRetrievalQuery;
  }

  // Save the last real study explanation — code-controlled, never from LLM memoryUpdate.
  // Used by EXPLAIN_MORE (variation mandate) and CONCEPT_QUESTION (anti-repetition rule)
  // so both prompts compare against the actual study explanation, not whatever Zuno last said.
  // Guards: answered status + retrieved content used + non-empty answer text + not an
  // out-of-focus redirect (see lastRetrievalQuery guard above — same reasoning).
  const isRealStudyAnswer = (
    ['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'NEXT_STEP'].includes(_intent) &&
    response?.status === 'answered' &&
    sources?.length > 0 &&
    response?.answer?.trim() &&
    !isOutOfFocusAnswer
  );
  if (isRealStudyAnswer) {
    stateUpdates.lastStudyResponse = response.answer.trim().slice(0, 800);
  }

  // Successful response — provider is working. Reset error tracking.
  stateUpdates.consecutiveErrors = 0;
  stateUpdates.lastErrorAt = null;

  // STB-008: Force sync chapter fields — never rely on LLM memoryUpdate for these.
  // LLM prompts don't know/return chapter IDs, so we always write them from chatState
  // (which step2 correctly sets from the request's focusChapter data).
  if (studyMode === 'global') {
    stateUpdates.learningMode = 'idle';
    stateUpdates.currentSubjectId = null;
    stateUpdates.currentSectionId = null;
    stateUpdates.currentChapterId = null;
  } else if (studyMode === 'focus') {
    // Force-persist the chapter context so session restore after refresh works.
    // Symmetric to the global-mode clear above.
    stateUpdates.currentSubjectId = chatState.currentSubjectId || null;
    stateUpdates.currentSectionId = chatState.currentSectionId || null;
    stateUpdates.currentChapterId = chatState.currentChapterId || null;
  }

  // Automatically update dynamic tracking metrics on user interaction
  if (response.responseMode) {
    stateUpdates.answerLanguage = language.answerLanguage;
  }

  // sessionType derived from studyMode — set once on creation, immutable after.
  const sessionType = studyMode === 'focus' ? 'focus' : 'global';

  // Phase 3 — Session Integrity Guard: update drift counters in the same atomic op.
  // Academic turns reset the consecutive streak. Drift turns increment both counters.
  // UNSAFE_OR_ABUSIVE is excluded — abuse is tracked by its own abuseCount field.
  const intent = decision?.intent ?? 'CONCEPT_QUESTION';
  const chatStateInc = { messageCount: 1 };
  if (ACADEMIC_INTENTS.has(intent)) {
    stateUpdates.consecutiveNonAcademicTurns = 0;
    if (isDev) console.log(`[Drift] ${intent} → consecutive reset to 0`);
  } else if (DRIFT_INTENTS.has(intent)) {
    chatStateInc.consecutiveNonAcademicTurns = 1;
    chatStateInc.totalNonAcademicTurns = 1;
    const prevConsec = chatState.consecutiveNonAcademicTurns ?? 0;
    const prevTotal  = chatState.totalNonAcademicTurns       ?? 0;
    if (isDev) console.log(`[Drift] ${intent} → consecutive ${prevConsec} → ${prevConsec + 1} | total ${prevTotal} → ${prevTotal + 1}`);
  }

  // Single atomic MongoDB op: chatState $set + messageCount $inc + totalTokensUsed $inc + $setOnInsert immutables.
  // guestId is stamped here (from the ask pipeline identity) so a guest's chat
  // session can be claimed onto their account at login — see GUEST_SERVERSIDE_PLAN.md.
  const updatedSession = await updateChatSession(
    sessionId,
    {
      chatStateSet: removeUndefinedFields(stateUpdates),
      chatStateInc,
      topLevelInc: { totalTokensUsed: tokenUsage },
    },
    { userId, guestId, sessionType }
  );

  // ─── Cross-session chapter progress write (single source of truth) ──────
  // ChapterProgress owns currentTopicId/completedTopicIds — chatState no longer
  // carries these fields at all. The prior state comes from `chapterProgress`
  // (loaded fresh in step2), and nextTopicSignal (from step5) tells us whether
  // NEXT_STEP advanced the pointer this turn. Both writes are hardened with a
  // bounded retry — see withRetry() — because a silent failure here now means
  // the advance is recorded nowhere (no chatState backup copy anymore).
  let chapterProgressDoc = null;
  if (studyMode === 'focus' && chatState.currentChapterId) {
    const chapterId  = chatState.currentChapterId;
    const isComplete = retrievedContext === 'CHAPTER_COMPLETE';

    if (isComplete) {
      // CHAPTER COMPLETE — critical milestone, must not be lost silently.
      // Phase 3: don't auto-complete — move to awaiting_quiz. The chapter only
      // reaches 'completed' once the gate quiz is passed (handleGateQuizResult
      // in quizSubmitter.js).
      chapterProgressDoc = await withRetry(
        () => setChapterAwaitingQuiz(userId, guestId, chapterId, chapterProgress?.currentTopicId),
        'setChapterAwaitingQuiz'
      );
      logStudyEvent(userId, guestId, sessionId, chapterId, 'chapter_completed');
    } else {
      // Regular focus turn — upsert progress
      const priorCurrentTopicId = chapterProgress?.currentTopicId ?? null;
      const priorCompleted      = chapterProgress?.completedTopicIds ?? [];

      // If NEXT_STEP resolved a new topic this turn, advance the pointer and
      // record the topic just finished. $addToSet in upsertChapterProgress is
      // idempotent, so a retry replaying the same payload is always safe.
      const newCurrentTopicId = nextTopicSignal ? nextTopicSignal.topicId : priorCurrentTopicId;
      const newlyCompleted = (nextTopicSignal && priorCurrentTopicId)
        ? [...priorCompleted, priorCurrentTopicId]
        : priorCompleted;

      const chapterTitle = focusChapter?.title || null;
      chapterProgressDoc = await withRetry(
        () => upsertChapterProgress(userId, guestId, chapterId, {
          currentTopicId:    newCurrentTopicId,
          completedTopicIds: newlyCompleted,
          primarySessionId:  sessionId,
          linkedSessionId:   sessionId,
          subjectId:         chatState.currentSubjectId,
          sectionId:         chatState.currentSectionId,
          chapterTitle,
          // ISSUE-1 (FOCUS_MODE_PROGRESS_FIX_PLAN.md): separate "engagement" counter,
          // never blended into completedTopicIds/progressPercent above.
          intent,
        }),
        'upsertChapterProgress'
      );

      // Log topic_completed event when NEXT_STEP advances to a new topic
      if (nextTopicSignal) {
        logStudyEvent(userId, guestId, sessionId, chapterId, 'topic_completed', {
          topicId:     priorCurrentTopicId, // the one just completed
          nextTopicId: nextTopicSignal.topicId,
        });
      }
      // Log doubt events for CONCEPT_QUESTION turns (fire-and-forget, already in service)
    }
  }

  // Increment guest turn counter after confirmed DB write — non-critical, fail open.
  if (guestId) {
    try {
      const key = `guest_turns:${guestId}`;
      const newCount = await redis.incr(key);
      if (newCount === 1) {
        // First ever turn — set 30-day TTL so the counter self-expires
        await redis.expire(key, 30 * 24 * 60 * 60);
      }
    } catch (err) {
      console.error('[Step7] Guest counter increment failed (non-critical):', err.message);
    }
  }

  // P2-T4: Check if this turn pushed the session over the token limit.
  const newTotal = updatedSession?.totalTokensUsed ?? 0;
  const turnNumber = updatedSession?.chatState?.messageCount ?? 1;

  // STEP-0: Turn summary — shows decider + tutor breakdown and session health.
  logTurnSummary({
    sessionId,
    turnNumber,
    intent:     decision?.intent ?? 'UNKNOWN',
    overridden: decision?._overridden ?? false,
    decider: decision?.tokenBreakdown ?? { input: 0, output: 0, total: decision?.tokenUsage ?? 0 },
    tutor:   response?.tokenBreakdown ?? { input: 0, output: 0, total: response?.tokenUsage ?? 0 },
    sessionTotal: newTotal,
    sessionLimit: env.sessionTokenLimit,
    driftSignal,
  });
  const cachedTokens = (decision?.tokenBreakdown?.cached ?? 0) + (response?.tokenBreakdown?.cached ?? 0);
  recordIntentSample(decision?.intent, tokenUsage, cachedTokens, decision?._overridden ?? false, DRIFT_INTENTS.has(intent));
  if (turnNumber % 10 === 0) logIntentAggregates();
  if (newTotal >= env.sessionTokenLimit) {
    try {
      await updateChatSessionState(sessionId, { status: 'exhausted' }, userId);
      if (updatedSession.chatState) updatedSession.chatState.status = 'exhausted';
      if (isDev) console.log(`[Step 7] Session locked — totalTokensUsed: ${newTotal} >= limit: ${env.sessionTokenLimit}`);
    } catch {
      // Non-critical — session will be locked on next DB read anyway
    }
  }

  // Save first student question as sidebar preview — only fires on turn 1 (messageCount just became 1).
  // setFirstQuestionIfEmpty is a no-op on all subsequent turns (null-filter guard).
  if ((updatedSession?.chatState?.messageCount ?? 0) === 1) {
    setFirstQuestionIfEmpty(sessionId, question).catch(() => {}); // non-critical, fire-and-forget
  }

  // P2-T3: Auto-title using the answer heading already computed by step6 — zero extra LLM cost.
  // Only fires when: (a) session still has the default 'New Chat' title, (b) this is a real
  // study answer (study_tutor + answered), and (c) the title is not a system-generated label.
  // The { title: 'New Chat' } condition inside setSessionTitleIfDefault makes this race-safe.
  if (
    updatedSession.title === 'New Chat' &&
    response.responseMode === 'study_tutor' &&
    response.status === 'answered' &&
    response.title &&
    !SYSTEM_TITLES.has(response.title)
  ) {
    try {
      await setSessionTitleIfDefault(sessionId, response.title.trim());
      updatedSession.title = response.title.trim(); // sync in-memory so buildSessionPayload sees it
    } catch {
      // Non-critical — title stays 'New Chat', main pipeline is unaffected
    }
  }

  // Step 7b: Assemble the standardized outer structural response contract
  const answerPayload = {
    status: response.status,
    intent: response.responseMode,
    responseMode: response.responseMode,
    studyMode,
    question,
    detectedLanguage: language.detectedLanguage,
    answerLanguage: language.answerLanguage,
    title: response.title,
    sections: response.sections,
    answer: response.answer,
    sources,
    suggestedActions: sanitizeSuggestedActions(response.suggestedActions, { intent: _intent, studyMode, nextTopicSignal }),
    retrieval: retrieval
      ? { question: retrieval.question, returnedCount: retrieval.debug?.returnedCount || 0 }
      : null,
    decision,
    session: buildSessionPayload(sessionId, updatedSession),
    // Cross-session chapter progress snapshot — frontend uses this to update
    // FocusProgressHeader without a separate API call.
    chapterProgress: chapterProgressDoc ? {
      progressPercent:   chapterProgressDoc.progressPercent,
      currentTopicId:    chapterProgressDoc.currentTopicId,
      completedTopicIds: chapterProgressDoc.completedTopicIds,
      totalCoreTopics:   chapterProgressDoc.totalCoreTopics,
      status:            chapterProgressDoc.status,
      isChapterComplete: chapterProgressDoc.status === 'completed',
      // ISSUE-1: separate engagement stat — never blended into progressPercent above.
      totalDoubtsAsked:      chapterProgressDoc.totalDoubtsAsked || 0,
      totalExplainMoreCount: chapterProgressDoc.totalExplainMoreCount || 0,
    } : null,
  };

  // Step 7c: Append historical text prose into the isolated history bank log
  await addChatMessages(sessionId, [
    {
      role: 'student',
      text: question,
      metadata: {
        studyMode,
        chapterId: focusChapter?.id || null,
      },
    },
    {
      role: 'tutor',
      text: answerPayload.answer,
      action: answerPayload.intent,
      sources,
      suggestedActions: answerPayload.suggestedActions || [],
      metadata: {
        status: answerPayload.status,
        responseMode: answerPayload.responseMode,
        sections: answerPayload.sections,
      },
    },
  ], userId);

  if (isDev) console.log('[Step 7 Complete] Database sync finalized successfully. Releasing payload.');
  return answerPayload;
};