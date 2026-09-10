/**
 * chapterProgress.service.js
 *
 * Cross-session chapter progress persistence layer.
 * One document per (user × chapter) in the chapter_progress collection.
 *
 * Redis cache: 60s TTL, invalidated on every write.
 * All write operations use atomic MongoDB operators ($set, $addToSet, $inc, $setOnInsert)
 * to be safe under concurrent tabs / multi-device use.
 */

import { ChapterProgress } from '../models/chapterProgress.model.js';
import { StudyEvent }      from '../models/studyEvent.model.js';
import { QuizAttempt }     from '../models/quizAttempt.model.js';
import { QuizSession }     from '../models/quizSession.model.js';
import { ChatSession }     from '../models/chatSession.model.js';
import { ChatHistory }     from '../models/chatHistory.model.js';
import redis               from '../config/redisClient.js';
import { loadCurriculumIndex } from '../curriculum/curriculumIndexLoader.js';
import { getChapterCoreTopics } from '../curriculum/topicResolver.js';

const isDev = process.env.NODE_ENV !== 'production';
const CACHE_TTL_SEC = 60; // invalidated on every write; 60s max staleness

// Which intents count as "engagement" beyond just NEXT_STEP, and which ChapterProgress
// counter each one increments. Single source of truth — add a new intent here only,
// never inline the mapping at the call site. See FOCUS_MODE_PROGRESS_FIX_PLAN.md ISSUE-1:
// this is deliberately kept separate from completedTopicIds/progressPercent (NEXT_STEP-only)
// so a student who asks doubts without tapping "aage badhao" still gets visible credit,
// without the two systems ever blending into one ambiguous number.
const ENGAGEMENT_INTENT_FIELDS = {
  CONCEPT_QUESTION: 'totalDoubtsAsked',
  EXPLAIN_MORE:     'totalExplainMoreCount',
};

// ─── Cache key builders ──────────────────────────────────────────────────────

const scopeKey      = (userId, guestId) => userId || guestId || 'anon';
const progressKey   = (userId, guestId, chapterId) => `cp:${scopeKey(userId, guestId)}:${chapterId}`;
const listKey       = (userId, guestId) => `cp_list:${scopeKey(userId, guestId)}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the number of core topics for a chapter — used to compute progressPercent. */
const fetchTotalCoreTopics = async (chapterId) => {
  try {
    const index = await loadCurriculumIndex();
    const topics = getChapterCoreTopics(index, chapterId);
    return topics.length;
  } catch {
    return 0; // non-critical — progressPercent will show 0 until index is readable
  }
};

/** Build the MongoDB filter for user or guest. */
const buildFilter = (userId, guestId, chapterId) =>
  userId
    ? { userId, chapterId }
    : { guestId, chapterId };

/** Safely read from Redis. Returns null on any error. */
const redisGet = async (key) => {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/** Safely write to Redis. Fails silently — cache is optional. */
const redisSetex = async (key, ttl, value) => {
  try {
    await redis.setex(key, ttl, JSON.stringify(value));
  } catch { /* non-critical */ }
};

/** Invalidate all cache keys related to a user+chapter write. */
const invalidateCache = async (userId, guestId, chapterId) => {
  try {
    await redis.del(
      progressKey(userId, guestId, chapterId),
      listKey(userId, guestId)
    );
  } catch { /* non-critical */ }
};

// ─── READ ────────────────────────────────────────────────────────────────────

/**
 * Get cross-session chapter progress for one chapter.
 * Returns null if the student has never studied this chapter.
 * Cached in Redis for 60s.
 */
export const getChapterProgress = async (userId, guestId, chapterId) => {
  if (!chapterId) return null;

  const cacheKey = progressKey(userId, guestId, chapterId);
  const cached = await redisGet(cacheKey);
  if (cached) return cached;

  const doc = await ChapterProgress.findOne(buildFilter(userId, guestId, chapterId)).lean();

  if (doc) await redisSetex(cacheKey, CACHE_TTL_SEC, doc);

  return doc; // null = not started
};

/**
 * List a user's chapter progress records, sorted by recency.
 * Used by FocusModal "Continue" section.
 */
export const listUserChapterProgress = async (userId, guestId, { status, limit = 10 } = {}) => {
  if (!userId && !guestId) return [];

  const query = userId ? { userId } : { guestId };
  if (status) query.status = status;

  return ChapterProgress
    .find(query)
    .sort({ lastStudiedAt: -1 })
    .limit(limit)
    .lean();
};

// ─── WRITE ───────────────────────────────────────────────────────────────────

/**
 * Upsert chapter progress — creates on first /ask, updates on subsequent.
 * Called from step7 on every focus-mode /ask response.
 *
 * @param {string|null} userId
 * @param {string|null} guestId
 * @param {string}      chapterId
 * @param {object}      updates   — fields from step7: currentTopicId, completedTopicIds, etc.
 * @returns {object}    Updated chapter_progress document
 */
export const upsertChapterProgress = async (userId, guestId, chapterId, updates = {}) => {
  if (!chapterId) return null;

  const filter = buildFilter(userId, guestId, chapterId);

  // Get totalCoreTopics: prefer from updates, else from DB, else from curriculum-index
  let totalCoreTopics = updates.totalCoreTopics;
  if (!totalCoreTopics) {
    const existing = await ChapterProgress.findOne(filter, { totalCoreTopics: 1 }).lean();
    totalCoreTopics = existing?.totalCoreTopics || 0;
  }
  if (!totalCoreTopics) {
    totalCoreTopics = await fetchTotalCoreTopics(chapterId);
  }

  // Compute updated progress percent
  // completedTopicIds in $addToSet will be applied by Mongo — we approximate here
  const existingCompleted = await ChapterProgress.findOne(filter, { completedTopicIds: 1 }).lean();
  const currentCompleted = new Set([
    ...(existingCompleted?.completedTopicIds || []),
    ...(updates.completedTopicIds || []),
  ]);
  const progressPercent = totalCoreTopics > 0
    ? Math.round((currentCompleted.size / totalCoreTopics) * 100)
    : 0;

  // Build the $set payload — never include completedTopicIds here (handled by $addToSet)
  const setFields = {
    lastStudiedAt:   new Date(),
    progressPercent,
    totalCoreTopics,
  };
  if (updates.currentTopicId !== undefined) setFields.currentTopicId = updates.currentTopicId;
  if (updates.subjectId)                   setFields.subjectId       = updates.subjectId;
  if (updates.sectionId)                   setFields.sectionId       = updates.sectionId;
  if (updates.chapterTitle)                setFields.chapterTitle     = updates.chapterTitle;
  if (updates.primarySessionId)            setFields.primarySessionId = updates.primarySessionId;

  // Build array update operators
  const arrayUpdates = {};
  if (updates.completedTopicIds?.length) {
    arrayUpdates.$addToSet = { completedTopicIds: { $each: updates.completedTopicIds } };
  }
  if (updates.linkedSessionId) {
    arrayUpdates.$addToSet = {
      ...(arrayUpdates.$addToSet || {}),
      linkedSessionIds: updates.linkedSessionId,
    };
  }

  // Engagement counter — separate from completedTopicIds/progressPercent (NEXT_STEP-only).
  // See ENGAGEMENT_INTENT_FIELDS above.
  const incFields = { totalMessagesExchanged: 1 };
  const engagementField = ENGAGEMENT_INTENT_FIELDS[updates.intent];
  if (engagementField) incFields[engagementField] = 1;

  const doc = await ChapterProgress.findOneAndUpdate(
    filter,
    {
      $set: setFields,
      $setOnInsert: {
        // Only set userId when it's a real value — never store null explicitly.
        // The sparse index on { userId, chapterId } skips documents where userId
        // is ABSENT; storing null makes the field exist and triggers dup-key conflicts
        // across different guest users who all share userId=null.
        ...(userId ? { userId } : {}),
        ...(guestId ? { guestId } : {}),
        chapterId,
        startedAt: new Date(),
        status:    'in_progress',
      },
      $inc: incFields,
      ...arrayUpdates,
    },
    { upsert: true, returnDocument: 'after', new: true }
  );

  await invalidateCache(userId, guestId, chapterId);

  return doc;
};

/**
 * Mark chapter as completed.
 * Called synchronously from step7 when nextTopicSignal.status === 'chapter_complete'.
 */
export const markChapterComplete = async (userId, guestId, chapterId) => {
  if (!chapterId) return null;

  const doc = await ChapterProgress.findOneAndUpdate(
    buildFilter(userId, guestId, chapterId),
    {
      $set: {
        status:           'completed',
        progressPercent:  100,
        completedAt:      new Date(),
        lastStudiedAt:    new Date(),
      },
    },
    { returnDocument: 'after', new: true }
  );

  await invalidateCache(userId, guestId, chapterId);

  if (isDev) console.log(`[ChapterProgress] Chapter completed: ${chapterId}`);
  return doc;
};

/**
 * Move a chapter from in_progress to awaiting_quiz — called from step7 when
 * CHAPTER_COMPLETE fires (Phase 3 gate, replaces the old auto-complete).
 *
 * Guarded to only transition FROM in_progress: if the chapter is already
 * awaiting_quiz or completed (e.g. student revisits the last topic and
 * CHAPTER_COMPLETE fires again), this is a no-op — the filter simply won't
 * match and findOneAndUpdate returns null, so we re-fetch and return the
 * unchanged doc instead of clobbering real state.
 */
export const setChapterAwaitingQuiz = async (userId, guestId, chapterId, currentTopicId = null) => {
  if (!chapterId) return null;

  const filter = buildFilter(userId, guestId, chapterId);

  const updateOp = {
    $set: {
      status:          'awaiting_quiz',
      progressPercent: 100,
      lastStudiedAt:   new Date(),
    },
  };

  if (currentTopicId) {
    updateOp.$addToSet = { completedTopicIds: currentTopicId };
  }

  const doc = await ChapterProgress.findOneAndUpdate(
    { ...filter, status: 'in_progress' },
    updateOp,
    { returnDocument: 'after', new: true }
  );

  await invalidateCache(userId, guestId, chapterId);

  if (doc) {
    if (isDev) console.log(`[ChapterProgress] Chapter awaiting quiz: ${chapterId}`);
    return doc;
  }

  // Already past in_progress (awaiting_quiz/completed) — return current state as-is.
  return ChapterProgress.findOne(filter).lean();
};

/**
 * Record the result of a chapter_gate quiz attempt against ChapterProgress.
 * Called from quizSubmitter.js's handleGateQuizResult() after a chapter_gate
 * QuizAttempt is created — never for chapter_practice/mix_practice.
 *
 * Always: increments quizGateAttempts, raises quizGateBestScore if this
 * attempt beat it, remembers lastQuizAttemptId.
 * On pass: transitions awaiting_quiz -> completed in the same write.
 * On fail: status is left untouched (stays awaiting_quiz — no change needed,
 * matching the "unlimited retries, no cooldown" rule).
 */
export const recordGateQuizResult = async (userId, guestId, chapterId, { attemptId, percentage, passed }) => {
  if (!chapterId) return null;

  const filter = buildFilter(userId, guestId, chapterId);

  const current = await ChapterProgress.findOne(filter, { quizGateBestScore: 1 }).lean();
  const currentBest = current?.quizGateBestScore ?? 0;
  const newBest = Math.max(currentBest, percentage);

  const setFields = {
    quizGateBestScore: newBest,
    lastQuizAttemptId: attemptId,
    lastStudiedAt:     new Date(),
  };

  if (passed) {
    setFields.status = 'completed';
    setFields.completedAt = new Date();
    setFields.progressPercent = 100;
  }

  const doc = await ChapterProgress.findOneAndUpdate(
    filter,
    { $set: setFields, $inc: { quizGateAttempts: 1 } },
    { returnDocument: 'after', new: true }
  );

  await invalidateCache(userId, guestId, chapterId);

  if (isDev) console.log(`[ChapterProgress] Gate quiz result recorded: ${chapterId} passed=${Boolean(passed)} best=${newBest}`);
  return doc;
};

/**
 * Reset chapter progress — clears the topic pointer and completed list so the
 * student starts fresh from topic 1.
 * Called from chapterProgress.controller POST /:chapterId/action { action: 'reset', status? }.
 *
 * `status` defaults to 'in_progress' (mid-chapter restart, discarding partial progress).
 * Pass status: 'revising' for the "revise a completed chapter" flow — note completedAt
 * is intentionally NEVER touched here, so a chapter's original completion timestamp
 * survives a later revision reset.
 */
export const resetChapterProgress = async (userId, guestId, chapterId, { status = 'in_progress' } = {}) => {
  if (!chapterId) return null;

  const doc = await ChapterProgress.findOneAndUpdate(
    buildFilter(userId, guestId, chapterId),
    {
      $set: {
        status,
        currentTopicId:    null,
        completedTopicIds: [],
        progressPercent:   0,
        lastStudiedAt:     new Date(),
      },
    },
    { returnDocument: 'after', new: true }
  );

  await invalidateCache(userId, guestId, chapterId);
  return doc;
};

// ─── EVENTS ──────────────────────────────────────────────────────────────────

// ─── GUEST → USER CLAIM (post-login) ────────────────────────────────────────

/**
 * Transfers a guest's chapter_progress + study_events into a newly-logged-in
 * user's identity. Called once, right after login/register/OAuth success.
 *
 * Per chapter, if the user has no existing progress there, the guest doc is
 * simply reassigned. If both exist (user studied this chapter before as a
 * guest on a different device, or already has an account with progress),
 * the more-advanced one (by completedTopicIds count) wins — its fields
 * overwrite the surviving doc, engagement counters are summed, and the
 * loser is deleted. This mirrors the same "one doc per owner per chapter"
 * invariant the unique indexes already enforce, so no index conflict is
 * possible at any step.
 */
export const claimGuestData = async (userId, guestId) => {
  if (!userId || !guestId) return { chaptersTransferred: 0, chaptersMerged: 0 };

  const guestDocs = await ChapterProgress.find({ guestId }).lean();
  let chaptersTransferred = 0;
  let chaptersMerged = 0;

  for (const guestDoc of guestDocs) {
    const existing = await ChapterProgress.findOne({ userId, chapterId: guestDoc.chapterId }).lean();

    if (!existing) {
      // No conflict — this chapter has no userId doc yet, just reassign ownership.
      await ChapterProgress.updateOne(
        { _id: guestDoc._id },
        { $set: { userId, guestId: null } }
      );
      chaptersTransferred++;
    } else {
      // Conflict — keep whichever side is further along, sum engagement counters,
      // then delete the loser so only one doc per (userId, chapterId) remains.
      const guestIsFurther = (guestDoc.completedTopicIds?.length || 0) > (existing.completedTopicIds?.length || 0);
      const winner = guestIsFurther ? guestDoc : existing;

      // Quiz gate fields merge independently of the topic-progress "winner" —
      // a student's best quiz score/attempt count should never be lost just
      // because the other side happened to be further along on topics.
      const guestBest    = guestDoc.quizGateBestScore ?? 0;
      const existingBest = existing.quizGateBestScore ?? 0;
      const mergedBestScore = Math.max(guestBest, existingBest);
      const mergedAttempts  = (guestDoc.quizGateAttempts || 0) + (existing.quizGateAttempts || 0);
      // Blueprint §9: lastQuizAttemptId comes from whichever side has the higher best score.
      const mergedLastAttemptId = guestBest >= existingBest
        ? (guestDoc.lastQuizAttemptId ?? existing.lastQuizAttemptId ?? null)
        : (existing.lastQuizAttemptId ?? guestDoc.lastQuizAttemptId ?? null);

      await ChapterProgress.updateOne(
        { _id: existing._id },
        {
          $set: {
            status:             winner.status,
            currentTopicId:     winner.currentTopicId,
            completedTopicIds:  winner.completedTopicIds,
            progressPercent:    winner.progressPercent,
            lastStudiedAt:      new Date(),
            quizGateBestScore:  mergedBestScore || null,
            quizGateAttempts:   mergedAttempts,
            lastQuizAttemptId:  mergedLastAttemptId,
          },
          $inc: {
            totalTimeSpentSec:      guestDoc.totalTimeSpentSec      || 0,
            totalMessagesExchanged: guestDoc.totalMessagesExchanged || 0,
            totalDoubtsAsked:       guestDoc.totalDoubtsAsked       || 0,
            totalExplainMoreCount: guestDoc.totalExplainMoreCount || 0,
          },
        }
      );
      await ChapterProgress.deleteOne({ _id: guestDoc._id });
      chaptersMerged++;
    }

    await invalidateCache(userId, guestId, guestDoc.chapterId);
  }

  await StudyEvent.updateMany({ guestId }, { $set: { userId, guestId: null } });

  // Quiz attempts (permanent history) and any still-pending quiz sessions
  // (rare — usually TTL-expired before claim happens) move to the new identity.
  const quizAttemptResult = await QuizAttempt.updateMany(
    { guestId },
    { $set: { userId, guestId: null } }
  );
  await QuizSession.updateMany(
    { guestId, status: 'pending' },
    { $set: { userId, guestId: null } }
  );

  // Chat sessions — flip ownership to the user so the guest's chats appear in
  // their sidebar. sessionId is a globally-unique UUID, so a guest session can
  // never collide with an existing user session — a plain ownership flip is
  // safe, no merge logic needed (unlike chapter_progress above).
  // chat_history is keyed only by sessionId, so its messages follow
  // automatically; we still sync its denormalised userId for later analytics.
  const guestSessions = await ChatSession
    .find({ guestId, userId: null })
    .select('sessionId')
    .lean();
  const claimedSessionIds = guestSessions.map((s) => s.sessionId);

  let chatSessionsTransferred = 0;
  if (claimedSessionIds.length) {
    const chatRes = await ChatSession.updateMany(
      { guestId, userId: null },
      { $set: { userId, guestId: null, mode: 'logged_in' } }
    );
    chatSessionsTransferred = chatRes.modifiedCount;
    await ChatHistory.updateMany(
      { sessionId: { $in: claimedSessionIds } },
      { $set: { userId } }
    );
  }

  return {
    chaptersTransferred,
    chaptersMerged,
    quizAttemptsTransferred: quizAttemptResult.modifiedCount,
    chatSessionsTransferred,
  };
};

/**
 * Append a study event to the study_events collection.
 * ALWAYS fire-and-forget — never await this in the hot path.
 * study_events must never slow down /ask.
 */
export const logStudyEvent = (userId, guestId, sessionId, chapterId, eventType, metadata = {}) => {
  const dayBucket = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
  StudyEvent.create({
    userId:    userId    || null,
    guestId:   guestId   || null,
    sessionId,
    chapterId,
    topicId:   metadata.topicId || null,
    eventType,
    metadata,
    dayBucket,
  }).catch((err) =>
    console.error('[StudyEvent] Log failed (non-critical):', err.message)
  );
  // No await — intentional. Caller must NOT await this function.
};
