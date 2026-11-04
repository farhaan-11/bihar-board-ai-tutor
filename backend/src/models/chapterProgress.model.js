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

    // ─── Quiz Gate (Phase 3) ─────────────────────────────────────────────────
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

// PRIMARY: one document per logged-in user + chapter (unique enforced at DB level).
// userId is stored as a STRING, not an ObjectId: the controller passes req.user.id
// (Mongoose's `.id` virtual returns _id.toString()) and this schema types userId as
// String, so Mongo stores the string form. The partialFilterExpression must therefore
// match $type:'string' — exactly like guest_chapter_unique below. It still excludes
// guest docs (userId is absent/null there), so guests never collide on this index.
//
// (Until 2026-11-04 this filtered $type:'objectId', which matched ZERO documents — so
// the unique constraint silently enforced nothing for logged-in users, risking
// duplicate per-user-per-chapter docs under concurrent writes. The twin guest index
// hit the same class of bug in 2026-07 and was fixed first; this one was missed.
// scripts/fix-chapter-progress-user-index.js is the one-time migration that drops the
// old objectId-filtered index on existing databases and rebuilds it correctly.)
chapterProgressSchema.index(
  { userId: 1, chapterId: 1 },
  {
    unique: true,
    name: 'user_chapter_unique',
    partialFilterExpression: { userId: { $type: 'string' } },
  }
);

// GUEST path: same uniqueness for guest users (guestId replaces userId).
// Uses a type-checking partialFilterExpression (matching user_chapter_unique above),
// NOT `sparse: true` — sparse only excludes documents where the field is truly
// ABSENT, not documents where it's explicitly stored as `null`. Mongoose's
// findOneAndUpdate(upsert:true) applies schema defaults (guestId's default is
// `null`) to every newly-inserted document, including logged-in users' documents
// that never touch guestId in code — so a plain sparse index let every first-time
// logged-in-user-per-chapter document collide on { guestId: null, chapterId }.
// Confirmed live (2026-07-10/11): a second logged-in user starting a chapter
// already started by another user got a real E11000 duplicate key error and
// silently lost that turn's progress write.
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
