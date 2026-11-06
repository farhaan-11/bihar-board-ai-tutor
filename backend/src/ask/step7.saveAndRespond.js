// Step 7: saves the turn to the database and builds the response payload for the client.

import { addChatMessages } from '../services/chatHistory.service.js';
import { updateChatSession, updateChatSessionState, setSessionTitleIfDefault, setFirstQuestionIfEmpty } from '../services/chatSession.service.js';
import { upsertChapterProgress, setChapterAwaitingQuiz, logStudyEvent } from '../services/chapterProgress.service.js';
import { env } from '../config/env.js';
import redis from '../config/redisClient.js';
import { logTurnSummary, recordIntentSample, logIntentAggregates } from '../utils/tokenLogger.js';
import { cleanText } from '../utils/text.js';

const isDev = process.env.NODE_ENV !== 'production';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ChapterProgress is the single source of truth for topic progress, so a lost write means
// the student's advance is saved nowhere. Retry once after a short delay, and log loudly
// (not silently) if it still fails.
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

const VALID_LEARNING_MODES = new Set(['idle', 'lesson', 'doubt', 'quiz']);

// Titles the pipeline makes itself. They should never become a session label in the sidebar.
const SYSTEM_TITLES = new Set(['Chapter Complete!', 'Quiz Time!']);

// Study turns reset the drift streak. Drift turns count toward the drift block.
// UNSAFE_OR_ABUSIVE is in neither: abuse has its own abuseCount.
const ACADEMIC_INTENTS = new Set(['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'NEXT_STEP', 'CHOOSE_COURSE']);
const DRIFT_INTENTS    = new Set(['GREETING', 'OUT_OF_CONTEXT']);

// The fields the LLM may write when the intent has no entry in INTENT_MEMORY_WHITELIST.
const ALLOWED_STATE_FIELDS = [
  'status', 'learningMode', 'currentSubjectId', 'currentSectionId',
  'currentChapterId', 'abuseCount', 'answerLanguage',
  'sessionTopicsProgress', 'pendingAction',
  'lastTopic', 'lastDoubtTopic', 'lastDoubtQuestion',
  'consecutiveErrors', 'lastErrorAt'
];

// The memoryUpdate fields the LLM may write, per intent (used when USE_INTENT_ROUTER=true).
// Everything else is set by this file's code, or must never come from the LLM.
// CHOOSE_COURSE writes nothing: the chapter comes from the request (step2), learningMode is set by
// code, and the focus/global sync in saveAndRespond overwrote its old fields anyway.
export const INTENT_MEMORY_WHITELIST = {
  GREETING:          [],
  EMOTIONAL_SUPPORT: [],
  OUT_OF_CONTEXT:    [],
  UNSAFE_OR_ABUSIVE: [],
  CHOOSE_COURSE:     [],
  EXPLAIN_MORE:      ['lastDoubtTopic', 'lastDoubtQuestion'],     // not lastTopic, so it cannot cause drift
  CONCEPT_QUESTION:  ['lastTopic', 'lastDoubtTopic', 'lastDoubtQuestion', 'learningMode'],
  NEXT_STEP:         ['lastTopic', 'learningMode'],               // currentTopicId is saved by code
  EXAM_INFO:         [],                                          // plain lookup, the LLM writes nothing
};

// Keeps only the memoryUpdate fields this intent may write, with text values cleaned.
// An intent with no whitelist entry falls back to ALLOWED_STATE_FIELDS.
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

      if (typeof cleanValue === 'string') {
        cleanUpdate[field] = cleanText(cleanValue);
      } else {
        cleanUpdate[field] = cleanValue;
      }

      // An unknown learningMode becomes 'idle'.
      if (field === 'learningMode' && cleanUpdate[field] && !VALID_LEARNING_MODES.has(cleanUpdate[field])) {
        cleanUpdate[field] = 'idle';
      }
    }
  }

  return cleanUpdate;
};

// MongoDB updates must not contain undefined values.
const removeUndefinedFields = (data) => {
  const cleanData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) cleanData[key] = value;
  }
  return cleanData;
};

// For these intents the LLM's own chips can leave the student with no way to advance the
// chapter (CONCEPT_QUESTION's follow-ups never include one). So code adds the "next_topic"
// chip, instead of trusting the prompt to.
const GUARANTEED_NEXT_TOPIC_INTENTS = new Set(['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'EXAM_INFO']);
const DEFAULT_NEXT_TOPIC_ACTION = { type: 'next_topic', label: 'Aage badhein' };

// Cleans the action chips. In Focus Mode it also guarantees a "next_topic" chip for the intents
// above. NEXT_STEP only gets it when nextTopicSignal is set: the chapter-complete and no-chapter
// replies also have intent NEXT_STEP, and there is no next topic then.
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
    ? [DEFAULT_NEXT_TOPIC_ACTION, ...cleaned] // first, so it survives the slice(0, 4) below
    : cleaned;

  return withGuarantee.slice(0, 4);
};

// The session part of the response. Topic progress is not here, it is in payload.chapterProgress.
const buildSessionPayload = (sessionId, updatedSession) => {
  const chatState = updatedSession?.chatState || {};
  return {
    sessionId,
    title: updatedSession?.title || 'New Chat',
    status: chatState.status || 'active',
    isLocked: chatState.status === 'exhausted', // there is no separate isLocked field
    learningMode: chatState.learningMode || 'idle',
    lastTopic: chatState.lastTopic || null,
    lastSubject: chatState.currentSubjectId || null,
    lastSection: chatState.currentSectionId || null,
    lastChapterId: chatState.currentChapterId || null,
    sessionType: updatedSession?.sessionType || 'global',
    messageCount: chatState.messageCount || 0,
    totalTokensUsed: updatedSession?.totalTokensUsed ?? 0,
  };
};

// Builds the chatState changes for this turn: what to $set, and what to $inc.
const buildStateUpdates = ({ decision, response, intent, studyMode, chatState, language, sources, lastRetrievalQuery, isOutOfFocusAnswer }) => {
  // The intent picks the per-intent whitelist (USE_INTENT_ROUTER=true).
  // Without one, the broad ALLOWED_STATE_FIELDS list is used (legacy path).
  const stateUpdates = sanitizeMemoryUpdate({
    memoryUpdate: response.memoryUpdate,
    intent: decision?.intent,
  });

  // The NEXT_STEP topic advance is saved in ChapterProgress, not in chatState.

  // Save the query that was used. It comes from code, never from the LLM. Only turns that taught
  // from retrieved content count: CONCEPT_QUESTION and NEXT_STEP, with sources found.
  // Skip the out-of-focus redirect: it found sources but taught nothing, and a later EXPLAIN_MORE
  // would reuse its query and teach the wrong chapter.
  const rawIntent = decision?.intent;
  if (
    ['CONCEPT_QUESTION', 'NEXT_STEP'].includes(rawIntent) &&
    lastRetrievalQuery &&
    sources?.length > 0 &&
    !isOutOfFocusAnswer
  ) {
    stateUpdates.lastRetrievalQuery = lastRetrievalQuery;
  }

  // Save the last real study explanation. It comes from code, never from the LLM.
  // EXPLAIN_MORE and CONCEPT_QUESTION compare against it, so they do not repeat themselves.
  // Only for an answered turn with retrieved content and a non-empty answer, and not for
  // an out-of-focus redirect (same reason as above).
  const isRealStudyAnswer = (
    ['CONCEPT_QUESTION', 'EXPLAIN_MORE', 'NEXT_STEP'].includes(rawIntent) &&
    response?.status === 'answered' &&
    sources?.length > 0 &&
    response?.answer?.trim() &&
    !isOutOfFocusAnswer
  );
  if (isRealStudyAnswer) {
    stateUpdates.lastStudyResponse = response.answer.trim().slice(0, 800);
  }

  // The provider worked, so reset the error count.
  stateUpdates.consecutiveErrors = 0;
  stateUpdates.lastErrorAt = null;

  // The chapter fields always come from chatState (step2 sets it from the request), never from
  // the LLM, which does not know chapter ids. Global mode clears them. Focus mode saves them,
  // so the session can be restored after a refresh.
  if (studyMode === 'global') {
    stateUpdates.learningMode = 'idle';
    stateUpdates.currentSubjectId = null;
    stateUpdates.currentSectionId = null;
    stateUpdates.currentChapterId = null;
  } else if (studyMode === 'focus') {
    stateUpdates.currentSubjectId = chatState.currentSubjectId || null;
    stateUpdates.currentSectionId = chatState.currentSectionId || null;
    stateUpdates.currentChapterId = chatState.currentChapterId || null;
  }

  // Save the language the answer was written in.
  if (response.responseMode) {
    stateUpdates.answerLanguage = language.answerLanguage;
  }

  // Drift counters, saved in the same atomic write. A study turn resets the streak.
  // A drift turn adds to both counters.
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

  return { stateUpdates, chatStateInc };
};

// Writes the ChapterProgress for a focus-mode turn and returns the saved document (or null).
// ChapterProgress owns currentTopicId and completedTopicIds (chatState no longer has them).
// The prior state comes from `chapterProgress` (loaded in step2). nextTopicSignal (from step5)
// says whether NEXT_STEP moved to a new topic this turn. Both writes use withRetry, because a
// failed write is saved nowhere else.
const saveChapterProgress = async ({ studyMode, focusChapter, sessionId, chatState, chapterProgress, retrievedContext, nextTopicSignal, intent, userId, guestId }) => {
  let chapterProgressDoc = null;
  if (studyMode === 'focus' && chatState.currentChapterId) {
    const chapterId  = chatState.currentChapterId;
    const isComplete = retrievedContext === 'CHAPTER_COMPLETE';

    if (isComplete) {
      // Chapter finished: a milestone that must not be lost silently. It becomes 'awaiting_quiz'
      // and only reaches 'completed' when the gate quiz is passed (handleGateQuizResult in quizSubmitter.js).
      chapterProgressDoc = await withRetry(
        () => setChapterAwaitingQuiz(userId, guestId, chapterId, chapterProgress?.currentTopicId),
        'setChapterAwaitingQuiz'
      );
      logStudyEvent(userId, guestId, sessionId, chapterId, 'chapter_completed');
    } else {
      const priorCurrentTopicId = chapterProgress?.currentTopicId ?? null;
      const priorCompleted      = chapterProgress?.completedTopicIds ?? [];

      // If NEXT_STEP found a new topic, move the pointer and record the topic just finished.
      // $addToSet in upsertChapterProgress is idempotent, so a retry is safe.
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
          // Counts doubts and explain-more turns. Kept apart from completedTopicIds and progressPercent.
          intent,
        }),
        'upsertChapterProgress'
      );

      if (nextTopicSignal) {
        logStudyEvent(userId, guestId, sessionId, chapterId, 'topic_completed', {
          topicId:     priorCurrentTopicId, // the one just completed
          nextTopicId: nextTopicSignal.topicId,
        });
      }
    }
  }
  return chapterProgressDoc;
};

// Counts this guest turn in Redis, after the DB write worked.
// Not critical, so a failure is only logged.
const countGuestTurn = async (guestId) => {
  if (guestId) {
    try {
      const key = `guest_turns:${guestId}`;
      const newCount = await redis.incr(key);
      if (newCount === 1) {
        // First turn ever: the counter expires after 30 days, so it cleans itself up.
        await redis.expire(key, 30 * 24 * 60 * 60);
      }
    } catch (err) {
      console.error('[Step7] Guest counter increment failed (non-critical):', err.message);
    }
  }
};

// Logs the turn (decider and tutor token usage, session health), then locks the session
// if this turn pushed it over the token limit.
const logTurnAndLockIfExhausted = async ({ sessionId, userId, decision, response, intent, tokenUsage, updatedSession, driftSignal }) => {
  const newTotal = updatedSession?.totalTokensUsed ?? 0;
  const turnNumber = updatedSession?.chatState?.messageCount ?? 1;

  const deciderTokens = decision?.tokenBreakdown ?? { input: 0, output: 0, total: decision?.tokenUsage ?? 0 };
  const tutorTokens   = response?.tokenBreakdown ?? { input: 0, output: 0, total: response?.tokenUsage ?? 0 };
  logTurnSummary({
    sessionId,
    turnNumber,
    intent:     decision?.intent ?? 'UNKNOWN',
    overridden: decision?._overridden ?? false,
    decider: deciderTokens,
    tutor:   tutorTokens,
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
      // Not critical: the session gets locked on the next DB read anyway.
    }
  }
};

// Saves what the sidebar shows for this session: the first question, and an auto-title.
const saveSidebarLabels = async (updatedSession, { sessionId, question, response }) => {
  // Save the first question as the sidebar preview. Only on turn 1:
  // setFirstQuestionIfEmpty does nothing after that.
  if ((updatedSession?.chatState?.messageCount ?? 0) === 1) {
    setFirstQuestionIfEmpty(sessionId, question).catch(() => {}); // not critical, fire and forget
  }

  // Auto-title from the answer heading step6 already made, so there is no extra LLM call.
  // Only when the title is still 'New Chat', the reply is an answered study_tutor one, and the
  // heading is not a system label. The { title: 'New Chat' } condition inside
  // setSessionTitleIfDefault keeps this safe if two requests race.
  if (
    updatedSession.title === 'New Chat' &&
    response.responseMode === 'study_tutor' &&
    response.status === 'answered' &&
    response.title &&
    !SYSTEM_TITLES.has(response.title)
  ) {
    try {
      await setSessionTitleIfDefault(sessionId, response.title.trim());
      updatedSession.title = response.title.trim(); // so buildSessionPayload sees the new title
    } catch {
      // Not critical: the title stays 'New Chat'.
    }
  }
};

// Builds the response payload for the client.
const buildAnswerPayload = ({ response, decision, studyMode, question, language, sources, retrieval, nextTopicSignal, sessionId, updatedSession, chapterProgressDoc }) => {
  const rawIntent = decision?.intent;
  return {
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
    suggestedActions: sanitizeSuggestedActions(response.suggestedActions, { intent: rawIntent, studyMode, nextTopicSignal }),
    retrieval: retrieval
      ? { question: retrieval.question, returnedCount: retrieval.debug?.returnedCount || 0 }
      : null,
    decision,
    session: buildSessionPayload(sessionId, updatedSession),
    // The frontend updates the progress header from this, without another API call.
    chapterProgress: chapterProgressDoc ? {
      progressPercent:   chapterProgressDoc.progressPercent,
      currentTopicId:    chapterProgressDoc.currentTopicId,
      completedTopicIds: chapterProgressDoc.completedTopicIds,
      totalCoreTopics:   chapterProgressDoc.totalCoreTopics,
      status:            chapterProgressDoc.status,
      isChapterComplete: chapterProgressDoc.status === 'completed',
      // Engagement stats, kept apart from progressPercent.
      totalDoubtsAsked:      chapterProgressDoc.totalDoubtsAsked || 0,
      totalExplainMoreCount: chapterProgressDoc.totalExplainMoreCount || 0,
    } : null,
  };
};

// Saves the student's question and Zuno's answer to the chat history.
const saveChatMessages = ({ sessionId, question, studyMode, focusChapter, answerPayload, sources, userId }) =>
  addChatMessages(sessionId, [
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

// Step 7: saves the turn to the database and returns the payload for the client.
// input, session and context are what steps 1, 2 and 3 returned.
// retrieved is what step 5 returned, response is what step 6 returned.
export const saveAndRespond = async ({
  input,
  session,
  context,
  decision,
  retrieved,
  response,
  userId = null,
  tokenUsage = 0,
  guestId = null,
}) => {
  const { question, studyMode, focusChapter } = input;
  const { sessionId, chatState, chapterProgress } = session;
  const { language, driftSignal } = context;
  const { retrieval, retrievedContext, sources, nextTopicSignal, lastRetrievalQuery, isOutOfFocusAnswer } = retrieved;

  if (isDev) console.log(`[Step 7 Commiting] Writing updates atomically for Session ID: ${sessionId}`);

  const intent = decision?.intent ?? 'CONCEPT_QUESTION';

  const { stateUpdates, chatStateInc } = buildStateUpdates({
    decision, response, intent, studyMode, chatState, language, sources, lastRetrievalQuery, isOutOfFocusAnswer,
  });

  // Set when the session is first created, never changed after.
  const sessionType = studyMode === 'focus' ? 'focus' : 'global';

  // One atomic MongoDB write: chatState $set, messageCount and totalTokensUsed $inc, and the
  // immutable fields on insert. guestId is saved here, so a guest's chat can be claimed onto
  // their account at login.
  const updatedSession = await updateChatSession(
    sessionId,
    {
      chatStateSet: removeUndefinedFields(stateUpdates),
      chatStateInc,
      topLevelInc: { totalTokensUsed: tokenUsage },
    },
    { userId, guestId, sessionType }
  );

  const chapterProgressDoc = await saveChapterProgress({
    studyMode, focusChapter, sessionId, chatState, chapterProgress, retrievedContext, nextTopicSignal, intent, userId, guestId,
  });

  await countGuestTurn(guestId);

  await logTurnAndLockIfExhausted({
    sessionId, userId, decision, response, intent, tokenUsage, updatedSession, driftSignal,
  });

  await saveSidebarLabels(updatedSession, { sessionId, question, response });

  const answerPayload = buildAnswerPayload({
    response, decision, studyMode, question, language, sources, retrieval, nextTopicSignal, sessionId, updatedSession, chapterProgressDoc,
  });

  await saveChatMessages({ sessionId, question, studyMode, focusChapter, answerPayload, sources, userId });

  if (isDev) console.log('[Step 7 Complete] Database sync finalized successfully. Releasing payload.');
  return answerPayload;
};
