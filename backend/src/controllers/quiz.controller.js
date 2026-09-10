/**
 * quiz.controller.js
 *
 * HTTP handlers for the /api/v1/quiz routes.
 * Reads userId from req.user (auth middleware) or guestId from req.guest (attachGuest)
 * — same identity pattern as chapterProgress.controller.js.
 */

import mongoose from 'mongoose';
import { generateQuiz } from '../services/quiz/quizGenerator.js';
import { submitQuiz } from '../services/quiz/quizSubmitter.js';
import { getQuizHistory, getQuizAttemptDetail } from '../services/quiz/quizHistoryService.js';
import { QUIZ_TYPES, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT } from '../constants/quizConstants.js';
import { sendResponse } from '../utils/sendResponse.js';
import { toHistoryListResponse } from '../utils/quizResponse.js';
import ApiError from '../utils/ApiError.js';

const VALID_OPTION_LABELS = ['A', 'B', 'C', 'D'];

const extractIdentity = (req) => {
  const userId = req.user?.id || null;
  if (userId) return { userId, guestId: null };

  // req.guest is set by attachGuest — a verified signed-token gid or a legacy
  // UUID, already shape-validated, so no length/format guard is needed here.
  return { userId: null, guestId: req.guest?.id || null };
};

// ─── POST /api/v1/quiz/generate ───────────────────────────────────────────────

export const generateQuizController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    if (!userId && !guestId) {
      return next(new ApiError(400, 'Identity required — login or a valid X-Guest-Id header is missing.'));
    }

    const { quizType, subjectId, chapterId } = req.body;

    if (!QUIZ_TYPES.includes(quizType)) {
      return next(new ApiError(400, `quizType must be one of: ${QUIZ_TYPES.join(', ')}`));
    }
    if (!subjectId) {
      return next(new ApiError(400, 'subjectId is required.'));
    }
    if (quizType !== 'mix_practice' && !chapterId) {
      return next(new ApiError(400, 'chapterId is required for this quizType.'));
    }

    const quiz = await generateQuiz({ userId, guestId, quizType, subjectId, chapterId });

    return sendResponse(res, 200, {
      message: 'Quiz generated.',
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/v1/quiz/submit ─────────────────────────────────────────────────

export const submitQuizController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    if (!userId && !guestId) {
      return next(new ApiError(400, 'Identity required — login or a valid X-Guest-Id header is missing.'));
    }

    const { quizId, submissionKey, timeTakenSec, answers } = req.body;

    if (!quizId || typeof quizId !== 'string' || !mongoose.isValidObjectId(quizId)) {
      return next(new ApiError(400, 'A valid quizId is required.'));
    }
    if (!submissionKey || typeof submissionKey !== 'string') {
      return next(new ApiError(400, 'submissionKey is required.'));
    }
    if (!Array.isArray(answers)) {
      return next(new ApiError(400, 'answers must be an array.'));
    }
    for (const answer of answers) {
      if (!answer || typeof answer.questionId !== 'string') {
        return next(new ApiError(400, 'Each answer requires a questionId.'));
      }
      if (answer.selectedOption != null && !VALID_OPTION_LABELS.includes(answer.selectedOption)) {
        return next(new ApiError(400, `Invalid selectedOption for questionId ${answer.questionId}.`));
      }
    }

    const result = await submitQuiz({
      quizId,
      submissionKey,
      timeTakenSec,
      answers,
      userId,
      guestId,
    });

    return sendResponse(res, 200, {
      message: 'Quiz submitted.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/v1/quiz/history ─────────────────────────────────────────────────

export const historyListController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    if (!userId && !guestId) {
      return next(new ApiError(400, 'Identity required — login or a valid X-Guest-Id header is missing.'));
    }

    const { quizType, chapterId, cursor: rawCursor, limit: rawLimit } = req.query;

    if (quizType && !QUIZ_TYPES.includes(quizType)) {
      return next(new ApiError(400, `quizType must be one of: ${QUIZ_TYPES.join(', ')}`));
    }

    let cursor = null;
    if (rawCursor) {
      const parsed = new Date(rawCursor);
      if (Number.isNaN(parsed.getTime())) {
        return next(new ApiError(400, 'cursor must be a valid date string.'));
      }
      cursor = parsed;
    }

    const parsedLimit = parseInt(rawLimit, 10);
    const limit = Math.min(
      Math.max(Number.isNaN(parsedLimit) ? HISTORY_DEFAULT_LIMIT : parsedLimit, 1),
      HISTORY_MAX_LIMIT
    );

    const { attempts, nextCursor, hasMore } = await getQuizHistory({
      userId,
      guestId,
      quizType: quizType || null,
      chapterId: chapterId || null,
      cursor,
      limit,
    });

    return sendResponse(res, 200, {
      message: 'Quiz history fetched.',
      data: toHistoryListResponse(attempts, nextCursor, hasMore),
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/v1/quiz/history/:attemptId ──────────────────────────────────────

export const historyDetailController = async (req, res, next) => {
  try {
    const { userId, guestId } = extractIdentity(req);
    if (!userId && !guestId) {
      return next(new ApiError(400, 'Identity required — login or a valid X-Guest-Id header is missing.'));
    }

    const { attemptId } = req.params;
    if (!attemptId || !mongoose.isValidObjectId(attemptId)) {
      return next(new ApiError(400, 'A valid attemptId is required.'));
    }

    const detail = await getQuizAttemptDetail({ attemptId, userId, guestId });
    if (!detail) {
      // Same 404 whether the attempt doesn't exist or belongs to someone
      // else — never reveal which, matching the submit endpoint's pattern.
      return next(new ApiError(404, 'Quiz attempt not found.'));
    }

    return sendResponse(res, 200, {
      message: 'Quiz attempt detail fetched.',
      data: detail,
    });
  } catch (error) {
    next(error);
  }
};
