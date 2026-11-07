// I load the session, its state and the recent messages from MongoDB.
// If there is no session yet, I start a fresh one in memory.

import { randomUUID } from 'node:crypto';
import ApiError from '../utils/ApiError.js';
import { findChatSession } from '../services/chatSession.service.js';
import { getRecentChatHistory } from '../services/chatHistory.service.js';
import { getDefaultChatState } from '../models/chatSession.model.js';
import { getChapterProgress } from '../services/chapterProgress.service.js';

const INACTIVITY_THRESHOLD_MS = 15 * 60 * 1000; // 15 Mins
const isDev = process.env.NODE_ENV !== 'production';

export const loadSession = async ({ requestedSessionId, userId, guestId, studyMode, focusChapter }) => {
  const sessionId = requestedSessionId || randomUUID();
  if (isDev) console.log(`[Step 2] loadSession — sessionId: ${sessionId}, isNew: ${!requestedSessionId}`);

  // Both reads hit an indexed field, so I run them together instead of one after the other.
  const [dbSession, dbMessages] = await Promise.all([
    findChatSession(sessionId),
    getRecentChatHistory(sessionId, 14),
  ]);

  const recentMessages = Array.isArray(dbMessages) ? dbMessages : [];

  let chatState = null;

  if (dbSession) {
    const sessionOwner = dbSession.userId?.toString();
    // A logged-in user's session can only be opened by that same user. A guest session
    // has no owner at all, so it skips this check — a null userId does not bypass it.
    if (sessionOwner && sessionOwner !== userId) {
      throw new ApiError(403, 'Yeh session aapka nahi hai.');
    }

    // A session's type is fixed when it is created, but studyMode arrives fresh on every
    // request. Reusing a focus session for a global turn corrupted its chapter fields, so
    // instead of patching every UI button that could send a mismatch, I handle it here:
    // a mismatch is treated as if no session was asked for. The old one is left untouched.
    if (dbSession.sessionType && dbSession.sessionType !== studyMode) {
      if (isDev) console.warn(
        `[Step 2] Mode mismatch — session ${sessionId} is sessionType="${dbSession.sessionType}" ` +
        `but request is studyMode="${studyMode}". Starting a fresh session instead.`
      );
      return loadSession({ requestedSessionId: null, userId, guestId, studyMode, focusChapter });
    }
  }

  if (!dbSession) {
    if (isDev) console.log('[Step 2] Cold start — new session instantiated.');
    chatState = {
      ...getDefaultChatState(),
      isNewSession: true,
    };
  } else {
    const plainSession = dbSession.toObject ? dbSession.toObject() : { ...dbSession };
    chatState = plainSession.chatState ? { ...plainSession.chatState } : {};
    chatState.isNewSession = false;

    if (chatState.status === 'blocked') {
      throw new ApiError(403, 'Aapka yeh session temporary block kar diya gaya hai, babu. Kripya naya fresh chat room shuru karein.');
    }

    if (chatState.status === 'exhausted') {
      throw new ApiError(429, 'Hamari baat bahut lambi ho gayi! Ek nayi chat shuru karo — fresh start mein aur clearly padh sakte hain.');
    }

    const lastActiveTime = dbSession.updatedAt ? new Date(dbSession.updatedAt).getTime() : Date.now();
    if (Date.now() - lastActiveTime > INACTIVITY_THRESHOLD_MS) {
      if (isDev) console.log('[Step 2] Inactivity gap detected — resetting learningMode to idle.');
      chatState.learningMode = 'idle';
      chatState.pendingAction = null;
      // The student came back after a break, so I forgive the small-talk streak. The
      // lifetime total stays, because the hard cap is counted over the whole session.
      chatState.consecutiveNonAcademicTurns = 0;
    }
  }

  // Topic progress lives in ChapterProgress, not in chatState, so it survives across
  // sessions. I read it fresh on every focus turn — Redis caches it for 60s, so it is
  // cheap — because step5 and step7 both need the current value.
  // If the read fails I carry on with null instead of killing the whole turn.
  let chapterProgress = null;
  if (studyMode === 'focus' && focusChapter?.id) {
    try {
      chapterProgress = await getChapterProgress(userId, guestId, focusChapter.id);
      if (isDev) console.log(
        `[Step 2] ChapterProgress loaded — currentTopicId: ${chapterProgress?.currentTopicId ?? 'none'}, ` +
        `completedTopicIds: ${(chapterProgress?.completedTopicIds || []).length} topics`
      );
    } catch (err) {
      console.error('[Step 2] getChapterProgress failed (non-fatal, continuing with null):', err.message);
      chapterProgress = null;
    }
  }

  if (studyMode === 'focus' && focusChapter) {
    if (isDev) console.log(`[Step 2] Focus mode — syncing chapter: ${focusChapter.id}`);

    chatState.currentSubjectId = focusChapter.subjectId;
    chatState.currentSectionId = focusChapter.sectionId;
    chatState.currentChapterId = focusChapter.id;

    if (chatState.learningMode === 'idle') {
      chatState.learningMode = 'lesson';
    }
  } else if (studyMode === 'global') {
    if (isDev) console.log('[Step 2] Global mode — resetting chapter/topic state to idle.');
    chatState.learningMode = 'idle';
    chatState.currentSubjectId = null;
    chatState.currentSectionId = null;
    chatState.currentChapterId = null;
  }

  return {
    sessionId,
    chatState,
    recentMessages,
    chapterProgress, // null for global mode or first-time chapter
  };
};