export const QUIZ_TYPES = ['chapter_gate', 'chapter_practice', 'mix_practice'];

// Decisions 1-4, QUIZ_SYSTEM_BLUEPRINT.md §16 — never accept a client-supplied count,
// server always decides how many questions a quiz has.
export const QUESTION_COUNTS = {
  chapter_gate: 10,
  chapter_practice: 10,
  mix_practice: 20,
};

export const SESSION_TTL_MIN = 50;

// chapter_gate passes at >= 70% (QUIZ_SYSTEM_BLUEPRINT.md §2). Not meaningful
// for chapter_practice/mix_practice — `passed` is null for those quizTypes.
export const PASS_PERCENTAGE = 70;

// Clamp for client-reported timeTakenSec — informational only, never trusted
// for scoring/pass logic. 3 hours is an absurd upper bound for a 10-20 question quiz.
export const MAX_TIME_TAKEN_SEC = 3 * 60 * 60;

// GET /quiz/history pagination — server always caps the page size regardless
// of what the client requests in ?limit=.
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;
