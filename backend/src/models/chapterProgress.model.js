import mongoose from 'mongoose';

const topicEngagementSchema = new mongoose.Schema(
  {
    topicId:          { type: String, required: true },
    firstVisitedAt:   { type: Date,   default: null  },
    completedAt:      { type: Date,   default: null  },
    doubtsAsked:      { type: Number, default: 0     },
    explainMoreCount: { type: Number, default: 0     },
    timeSpentSec:     { type: Number, default: 0     },
    revisitCount:     { type: Number, default: 0     },
  },
  { _id: false }
);

const chapterProgressSchema = new mongoose.Schema(
  {
    // ─── Identity ────────────────────────────────────────────────────────────
    userId:       { type: String, default: null, index: true },
    guestId:      { type: String, default: null },
    chapterId:    { type: String, required: true },
    subjectId:    { type: String, default: null }, // denormalized for subject-level queries
    sectionId:    { type: String, default: null }, // denormalized
    chapterTitle: { type: String, default: null }, // English title from curriculum-index

    // ─── Status ──────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['not_started', 'in_progress', 'awaiting_quiz', 'completed', 'revising'],
      default: 'in_progress',
    },

    // ─── Quiz Gate ───────────────────────────────────────────────────────────
    quizGateBestScore: { type: Number, default: null }, // best percentage achieved on this chapter's gate quiz
    quizGateAttempts:  { type: Number, default: 0    }, // total gate quiz attempts
    lastQuizAttemptId: { type: mongoose.Schema.Types.ObjectId, default: null }, // -> QuizAttempt._id

    // ─── Progress Pointers ───────────────────────────────────────────────────
    currentTopicId:    { type: String,   default: null },
    completedTopicIds: { type: [String], default: []   },
    skippedTopicIds:   { type: [String], default: []   },
    totalCoreTopics:   { type: Number,   default: 0    }, // snapshot at first access
    progressPercent:   { type: Number,   default: 0    }, // computed on every write

    // ─── Engagement Totals ───────────────────────────────────────────────────
    totalTimeSpentSec:      { type: Number, default: 0 },
    totalMessagesExchanged: { type: Number, default: 0 },
    totalDoubtsAsked:       { type: Number, default: 0 },
    totalExplainMoreCount:  { type: Number, default: 0 },
    totalSessionsCount:     { type: Number, default: 0 },

    // ─── Topic-Level Engagement (sparse — only visited topics appear) ─────────
    topicEngagement: { type: [topicEngagementSchema], default: [] },

    // ─── Session Linkage ─────────────────────────────────────────────────────
    linkedSessionIds: { type: [String], default: [] }, // all sessions that touched this chapter
    primarySessionId: { type: String,  default: null }, // most recent active session

    // ─── Timestamps ──────────────────────────────────────────────────────────
    startedAt:    { type: Date, default: Date.now },
    lastStudiedAt: { type: Date, default: Date.now },
    completedAt:  { type: Date, default: null },

    // ─── Versioning ──────────────────────────────────────────────────────────
    curriculumVersion: { type: Number, default: 1 },
    schemaVersion:     { type: Number, default: 1 },
  },
  {
    timestamps: true,
    collection: 'chapter_progress',
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────────

// One document per logged-in user per chapter, enforced by the database itself.
// userId is stored as a STRING, not an ObjectId, because the controller passes
// req.user.id and this schema types the field as String. So the partial filter has
// to say $type:'string' — if it says 'objectId' it matches no document at all and
// the unique constraint quietly enforces nothing. That is exactly what happened
// here until 2026-11-04; scripts/fix-chapter-progress-user-index.js rebuilds the
// index on databases that still carry the broken version.
chapterProgressSchema.index(
  { userId: 1, chapterId: 1 },
  {
    unique: true,
    name: 'user_chapter_unique',
    partialFilterExpression: { userId: { $type: 'string' } },
  }
);

// The same uniqueness for guests. This must use a type-checking partial filter and
// NOT `sparse: true`: sparse skips documents where the field is missing, but every
// logged-in document here stores guestId as an explicit null (the schema default,
// applied on upsert). With a sparse index all of those nulls collided on
// { guestId: null, chapterId }, and in July 2026 that cost a real student their
// progress write with an E11000 duplicate key error.
chapterProgressSchema.index(
  { guestId: 1, chapterId: 1 },
  {
    unique: true,
    name: 'guest_chapter_unique',
    partialFilterExpression: { guestId: { $type: 'string' } },
  }
);

// LIST path: FocusModal "Continue" section — user's chapters by recency + status
chapterProgressSchema.index(
  { userId: 1, status: 1, lastStudiedAt: -1 },
  { name: 'user_status_recency' }
);

// SUBJECT path: future subject-level coverage dashboard
chapterProgressSchema.index(
  { userId: 1, subjectId: 1 },
  { name: 'user_subject' }
);

// SESSION linkage: find which chapter_progress belongs to a session
chapterProgressSchema.index(
  { primarySessionId: 1 },
  { name: 'primary_session' }
);

export const ChapterProgress =
  mongoose.models.ChapterProgress ||
  mongoose.model('ChapterProgress', chapterProgressSchema);
