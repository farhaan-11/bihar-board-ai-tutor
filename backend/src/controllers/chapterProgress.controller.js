/**
 * chapterProgress.controller.js
 *
 * HTTP handlers for the /api/v1/chapter-progress routes.
 * Reads userId from req.user (auth middleware) or guestId from req.guest (attachGuest).
 */

import {
  getChapterProgress,
  listUserChapterProgress,
  resetChapterProgress,
} from '../services/chapterProgress.service.js';
import { loadCurriculumIndex }  from '../curriculum/curriculumIndexLoader.js';
import { getChapterCoreTopics } from '../curriculum/topicResolver.js';
import { sendResponse }         from '../utils/sendResponse.js';
import ApiError                 from '../utils/ApiError.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const extractIdentity = (req) => ({
  userId:  req.user?.id  || null,
  guestId: req.guest?.id || null, // req.guest set by attachGuest, null when req.user present
});

/**
 * Builds a recommendation object based on current progress state.
 * Used by the frontend to render context-aware welcome messages + chips.
 */
const buildRecommendation = (progress, topics) => {
  if (!progress) {
    const firstTopic = topics[0];
    return {
      action:  'start',
      message: firstTopic
        ? `Chalo shuru karte hain! Pehla topic hai '${firstTopic.title}'.`
        : 'Chalo shuru karte hain!',
      chips: [
        { type: 'next_step',       label: 'Shuru karo'       },
        { type: 'chapter_overview', label: 'Pehle overview do' },
      ],
    };
  }

  if (progress.status === 'awaiting_quiz') {
    return {
      action:  'quiz_gate',
      message: 'Saare topics ho gaye! Ab is chapter ka quiz do — 70% ya usse zyada laane par chapter complete hoga.',
      chips: [
        { type: 'start_gate_quiz', label: 'Quiz shuru karo' },
      ],
    };
  }

  if (progress.status === 'completed') {
    return {
      action:  'revise',
      message: 'Yeh chapter tune pehle complete kar liya hai! Revision karein ya agla chapter?',
      chips: [
        { type: 'revise_chapter', label: 'Revision karo'  },
        { type: 'switch_chapter', label: 'Agla chapter'   },
      ],
    };
  }

  if (progress.status === 'revising') {
    // A revision reset always clears currentTopicId to null (see resetChapterProgress),
    // so this state is reached only right after "Revision karo" — there is never a
    // partial revision position to resume. Same shape as not_started, distinct wording.
    const firstTopic = topics[0];
    return {
      action:  'start',
      message: firstTopic
        ? `Revision shuru! Pehla topic hai '${firstTopic.title}'.`
        : 'Revision shuru karte hain!',
      chips: [
        { type: 'next_step',       label: 'Shuru karo'       },
        { type: 'chapter_overview', label: 'Pehle overview do' },
      ],
    };
  }

  // in_progress
  const currentTopic = topics.find((t) => t.topicId === progress.currentTopicId);
  const topicLabel = currentTopic ? `'${currentTopic.title}'` : 'pichle topic';
  const completedCount = progress.completedTopicIds?.length || 0;

  return {
    action:  'resume',
    message: `Wapas aaye! ${topicLabel} tak pahuche the — wahan se chalein?`,
    chips: [
      // NOT 'next_step' — that type means "genuinely start the chapter" (used by
      // not_started/revising) and maps to the canonical phrase "Chapter shuru karein"
      // on the frontend. Reusing it here made the student's own message literally say
      // "start the chapter" when they meant "continue" — confusing even though the
      // backend advanced correctly. 'continue_step' maps to "Aage badhao" instead.
      { type: 'continue_step', label: 'Haan, wahan se chalein'            },
      { type: 'restart_topic', label: `Topic 1 se fresh shuru`           },
      { type: 'roadmap',      label: `Roadmap dikhao (${completedCount}/${progress.totalCoreTopics || '?'} done)` },
    ],
  };
};

// ─── GET /api/v1/chapter-progress/:chapterId ─────────────────────────────────

export const getChapterProgressController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    const { chapterId } = req.params;

    if (!chapterId) return next(new ApiError(400, 'chapterId is required.'));

    // Load progress and topics in parallel
    const [progress, curriculumIndex] = await Promise.all([
      getChapterProgress(userId, guestId, chapterId),
      loadCurriculumIndex(),
    ]);

    const topics = getChapterCoreTopics(curriculumIndex, chapterId);

    if (topics.length === 0 && !progress) {
      return next(new ApiError(404, `Chapter '${chapterId}' not found in curriculum.`));
    }

    // Attach Hinglish title to each topic if available (from chapter frontmatter)
    const chapterTitle = topics[0]?.chapterTitle || progress?.chapterTitle || null;
    const hinglishTitle = topics[0]?.chapterHinglishTitle || chapterTitle;

    const recommendation = buildRecommendation(progress, topics);

    return sendResponse(res, 200, {
      message: 'Chapter progress fetched.',
      data: {
        progress:     progress || null,
        topics,
        totalTopics:  topics.length,
        chapterId,
        chapterTitle,
        hinglishTitle,
        recommendation,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/v1/chapter-progress ────────────────────────────────────────────

export const listChapterProgressController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);

    if (!userId && !guestId) {
      return sendResponse(res, 200, {
        message: 'No identity — returning empty list.',
        data: { chapters: [], summary: { inProgressCount: 0, completedCount: 0, notStartedCount: 16 } },
      });
    }

    const { status, limit = '10' } = req.query;
    const parsedLimit = Math.min(parseInt(limit, 10) || 10, 20); // max 20

    const docs = await listUserChapterProgress(userId, guestId, {
      status: status || undefined,
      limit:  parsedLimit,
    });

    // Load curriculum index once to get Hinglish titles and topic counts
    const curriculumIndex = await loadCurriculumIndex();

    const chapters = docs.map((doc) => {
      const topics       = getChapterCoreTopics(curriculumIndex, doc.chapterId);
      const totalCount   = doc.totalCoreTopics || topics.length;
      const hinglishTitle = topics[0]?.chapterHinglishTitle || doc.chapterTitle;

      // Resolve current topic title for the "continue" card subtitle
      const currentTopic = topics.find((t) => t.topicId === doc.currentTopicId);

      return {
        chapterId:         doc.chapterId,
        chapterTitle:      doc.chapterTitle,
        hinglishTitle,
        status:            doc.status,
        progressPercent:   doc.progressPercent,
        currentTopicId:    doc.currentTopicId,
        currentTopicTitle: currentTopic?.title || null,
        completedCount:    doc.completedTopicIds?.length || 0,
        totalCount,
        lastStudiedAt:     doc.lastStudiedAt,
        totalTimeSpentMin: Math.round((doc.totalTimeSpentSec || 0) / 60),
      };
    });

    // Summary counts across all user progress (not limited by query)
    const allDocs = await listUserChapterProgress(userId, guestId, { limit: 50 });
    const summary = {
      // awaiting_quiz counted alongside in_progress — the student's work on
      // this chapter isn't finished yet (Decision 13, QUIZ_BUILD_LOG.md Phase Board).
      inProgressCount: allDocs.filter((d) => d.status === 'in_progress' || d.status === 'awaiting_quiz').length,
      completedCount:  allDocs.filter((d) => d.status === 'completed').length,
      notStartedCount: Math.max(0, 16 - allDocs.length), // 16 total chapters
    };

    return sendResponse(res, 200, {
      message: 'Chapter progress list fetched.',
      data: { chapters, summary },
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/v1/chapter-progress/:chapterId/action ─────────────────────────

const ALLOWED_RESET_STATUSES = new Set(['in_progress', 'revising']);

export const chapterActionController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    const { chapterId } = req.params;
    const { action, status } = req.body;

    if (!chapterId) return next(new ApiError(400, 'chapterId is required.'));
    if (!action)    return next(new ApiError(400, 'action is required.'));

    let updatedDoc;

    switch (action) {
      case 'reset': {
        // status defaults to 'in_progress' (plain restart). Pass status: 'revising'
        // for the "revise a completed chapter" flow — resetChapterProgress never
        // touches completedAt, so the original completion timestamp survives.
        const resetStatus = ALLOWED_RESET_STATUSES.has(status) ? status : 'in_progress';
        updatedDoc = await resetChapterProgress(userId, guestId, chapterId, { status: resetStatus });
        break;
      }

      default:
        return next(new ApiError(400, `Unknown action: '${action}'. Allowed: reset`));
    }

    if (!updatedDoc) {
      return next(new ApiError(404, `No progress found for chapter '${chapterId}'.`));
    }

    return sendResponse(res, 200, {
      message: `Action '${action}' applied to chapter '${chapterId}'.`,
      data: { progress: updatedDoc },
    });
  } catch (error) {
    next(error);
  }
};
