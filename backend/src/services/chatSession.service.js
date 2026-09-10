import { randomUUID } from 'node:crypto';
import { ChatSession } from '../models/chatSession.model.js';

export const createChatSession = async ({
  sessionId = randomUUID(),
  userId = null,
  mode = 'guest',
  title = 'New Chat',
} = {}) => {
  const session = await ChatSession.create({
    sessionId,
    userId,
    mode,
    title,
  });

  return session;
};

export const findChatSession = async (sessionId) => {
  return ChatSession.findOne({ sessionId });
};

export const getOrCreateChatSession = async (sessionId, { sessionType = 'global', userId = null } = {}) => {
  return ChatSession.findOneAndUpdate(
    { sessionId },
    {
      $setOnInsert: {
        sessionId,
        mode: userId ? 'logged_in' : 'guest',
        title: 'New Chat',
        sessionType, // immutable after first write
        userId,
      },
    },
    {
      returnDocument: 'after',
      upsert: true,
    }
  );
};

export const updateChatSessionLastMessageTime = async (sessionId) => {
  return ChatSession.findOneAndUpdate(
    { sessionId },
    { lastMessageAt: new Date() },
    { returnDocument: 'after' }
  );
};

/**
 * Unified session update — handles chatState fields, top-level $inc, and
 * $setOnInsert of immutable fields (sessionType, userId, mode) in one atomic op.
 *
 * @param {string} sessionId
 * @param {object} ops
 * @param {object} ops.chatStateSet    - Fields to $set inside chatState (dot-notation added internally)
 * @param {object} ops.chatStateInc    - Fields to $inc inside chatState (e.g. { messageCount: 1 })
 * @param {object} ops.topLevelInc     - Top-level fields to $inc (e.g. { totalTokensUsed: 450 })
 * @param {object} meta
 * @param {string|null} meta.userId
 * @param {string|null} meta.guestId  - guest id for a guest's session — set once via $setOnInsert
 * @param {string} meta.sessionType    - 'focus' | 'global' — set once via $setOnInsert, never overwritten
 */
export const updateChatSession = async (
  sessionId,
  { chatStateSet = {}, chatStateInc = {}, topLevelInc = {} },
  { userId = null, guestId = null, sessionType = 'global' } = {}
) => {
  const setFields = {};
  const incFields = {};

  for (const [key, value] of Object.entries(chatStateSet)) {
    setFields[`chatState.${key}`] = value;
  }

  for (const [key, value] of Object.entries(chatStateInc)) {
    incFields[`chatState.${key}`] = value;
  }

  for (const [key, value] of Object.entries(topLevelInc)) {
    incFields[key] = value;
  }

  const update = {
    $setOnInsert: {
      userId,
      guestId, // immutable — a guest's session keeps its guest id until login claim nulls it
      mode: userId ? 'logged_in' : 'guest',
      sessionType, // immutable — only applied on document creation
    },
  };

  if (Object.keys(setFields).length > 0) update.$set = setFields;
  if (Object.keys(incFields).length > 0) update.$inc = incFields;

  return ChatSession.findOneAndUpdate(
    { sessionId },
    update,
    {
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
};

/**
 * Saves the first student question as a sidebar preview fallback.
 * { firstQuestion: null } filter = race-condition safe — only the first turn
 * ever writes this; all subsequent calls are silent no-ops.
 */
export const setFirstQuestionIfEmpty = async (sessionId, question) => {
  return ChatSession.updateOne(
    { sessionId, firstQuestion: null },
    { $set: { firstQuestion: String(question).slice(0, 60).trim() } }
  );
};

/**
 * P2-T3: Set session title only if it is still the default 'New Chat'.
 * The { title: 'New Chat' } filter makes this race-condition safe across
 * concurrent tabs — only the first writer succeeds; subsequent calls no-op.
 * Also protects user-renamed titles from being overwritten.
 */
export const setSessionTitleIfDefault = async (sessionId, title) => {
  return ChatSession.updateOne(
    { sessionId, title: 'New Chat' },
    { $set: { title } }
  );
};

/**
 * P2-T5: Returns the most recent sessions for a logged-in user, for the sidebar.
 * Excludes ghost sessions (lastMessageAt: null) — those were never actually used.
 * Secondary sort on _id ensures stable order when two sessions share the same timestamp.
 */
export const getSessionsByUser = async (userId, { limit = 20 } = {}) => {
  return ChatSession.find({ userId, lastMessageAt: { $ne: null } })
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit)
    .select(
      'sessionId title firstQuestion sessionType lastMessageAt totalTokensUsed chatState.status chatState.messageCount chatState.currentChapterId'
    )
    .lean();
};

export const deleteSessionById = async (sessionId) => {
  return ChatSession.deleteOne({ sessionId });
};

export const renameSessionById = async (sessionId, title) => {
  return ChatSession.findOneAndUpdate(
    { sessionId },
    { $set: { title: String(title).trim().slice(0, 100) } },
    { returnDocument: 'after' }
  );
};

/**
 * Updates fields inside the nested chatState object safely.
 * Uses MongoDB dot-notation ($set) so only the given fields change and the
 * other chatState fields are left untouched.
 *
 * Deliberately NOT an upsert: this function only ever tracks metadata
 * (provider-error counts, the "exhausted" flag) on a session that has
 * already gone through a real, successful turn. If no session exists yet
 * for this sessionId, there's nothing meaningful to update — session
 * *creation* is exclusively updateChatSession()'s job (via step7), because
 * that function is the only one that derives sessionType correctly from the
 * request's actual studyMode. Upserting here used to silently create a
 * session with sessionType defaulted to 'global' by the Mongoose schema
 * whenever a provider error hit on a session's very first turn — permanently
 * mislabeling a focus-mode session (see GLOBAL_MODE_VERIFICATION_CHECKLIST.md).
 */
export const updateChatSessionState = async (sessionId, updates) => {
  const updateFields = {};

  // Turn { key: value } into { 'chatState.key': value } for a dot-notation $set
  for (const [key, value] of Object.entries(updates)) {
    updateFields[`chatState.${key}`] = value;
  }

  return ChatSession.findOneAndUpdate(
    { sessionId },
    { $set: updateFields },
    { returnDocument: 'after' }
  );
};
