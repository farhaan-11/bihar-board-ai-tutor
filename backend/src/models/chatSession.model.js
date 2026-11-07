import mongoose from 'mongoose';

const chatSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true, // Unique session id sent by the frontend
    },
    userId: {
      type: String,
      default: null,
      index: true,
    },
    // Set once when a guest's session is created, then nulled when that guest logs
    // in and claims it. This is what lets a guest's chats move to their account.
    guestId: {
      type: String,
      default: null,
    },
    mode: {
      type: String,
      enum: ['guest', 'logged_in'],
      default: 'guest',
    },
    title: {
      type: String,
      default: 'New Chat',
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    // Per-session tutor state (the "memory" Zuno keeps between turns)
    chatState: {
      status: {
        type: String,
        enum: ['active', 'exhausted', 'blocked'],
        default: 'active',
      },
      learningMode: {
        type: String,
        enum: ['idle', 'lesson', 'doubt', 'quiz'],
        default: 'idle',
      },
      currentSubjectId: {
        type: String,
        default: null, // Only Science today; the id shape leaves room for more.
      },
      currentSectionId: {
        type: String,
        default: null, // A section is Physics, Chemistry or Biology.
      },
      currentChapterId: {
        type: String,
        default: null,
      },
      abuseCount: {
        type: Number,
        default: 0,
      },
      answerLanguage: {
        type: String,
        default: 'hinglish',
      },
      sessionTopicsProgress: {
        type: [String],
        default: [], // Topics touched this session, used to summarise it.
      },
      pendingAction: {
        type: mongoose.Schema.Types.Mixed,
        default: null, // Something waiting on the student's yes, e.g. switch subject.
      },
      lastTopic: {
        type: String,
        default: null,
      },
      lastDoubtTopic: {
        type: String,
        default: null,
      },
      lastDoubtQuestion: {
        type: String,
        default: null,
      },
      lastRetrievalQuery: {
        type: String,
        default: null,
      },
      lastStudyResponse: {
        type: String,
        default: null,
      },
      consecutiveErrors: {
        type: Number,
        default: 0,
      },
      lastErrorAt: {
        type: Date,
        default: null,
      },
      // Back to 0 on any academic turn. Decides how firmly Zuno pulls a drifting
      // chat back to studying.
      consecutiveNonAcademicTurns: {
        type: Number,
        default: 0,
      },
      // Never resets, so a session that never returns to studying can be hard-blocked.
      totalNonAcademicTurns: {
        type: Number,
        default: 0,
      },
      // One per turn (student question + tutor answer = 1 turn). Step 7 spots the
      // first turn from this to auto-name the chat, and bumps it with $inc so two
      // open tabs cannot both believe they are turn one.
      messageCount: {
        type: Number,
        default: 0,
      },
    },
    // Saved on the very first student turn — used as sidebar preview when title is still 'New Chat'.
    // Never overwritten after first write (setFirstQuestionIfEmpty uses a null-filter guard).
    firstQuestion: {
      type: String,
      default: null,
    },

    // Foreign key to chapter_progress (set on first focus-mode /ask, never changes).
    // Allows fast lookup: "which chapter_progress doc belongs to this session?"
    chapterProgressId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
      index:   true,
    },

    // Snapshot of focus chapter data — avoids joining chapter_progress on session list queries.
    // Set once on first focus-mode /ask via $setOnInsert.
    focusChapterSnapshot: {
      chapterId:     { type: String, default: null },
      chapterTitle:  { type: String, default: null },
      hinglishTitle: { type: String, default: null },
      subjectId:     { type: String, default: null },
      sectionId:     { type: String, default: null },
    },

    // Set once at session creation via $setOnInsert — never overwritten.
    // Focus sessions remain Focus forever (SESSION_DESIGN.md constraint).
    sessionType: {
      type: String,
      enum: ['focus', 'global'],
      default: 'global',
    },
    // Both LLM calls of a turn (decider + tutor) add into this. Step 7 locks the
    // session once it crosses SESSION_TOKEN_LIMIT.
    totalTokensUsed: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'chat_sessions',
  }
);

// The sidebar list query: find by userId, newest first. Without this index MongoDB
// scans the whole collection on every page load.
chatSessionSchema.index({ userId: 1, lastMessageAt: -1 });

// Finds a guest's sessions when they log in and claim them. Not unique, since one
// guest can have many sessions. The partial filter on { $type: 'string' } keeps the
// null guestId that every logged-in session carries out of the index.
chatSessionSchema.index(
  { guestId: 1 },
  { partialFilterExpression: { guestId: { $type: 'string' } } }
);

export const ChatSession =
  mongoose.models.ChatSession || mongoose.model('ChatSession', chatSessionSchema);

// A fresh chatState with every default filled in. I build it from the schema itself,
// so adding a field above is enough — there is no second list to keep in step.
export const getDefaultChatState = () => {
  const doc = new ChatSession();
  return doc.chatState.toObject();
};
