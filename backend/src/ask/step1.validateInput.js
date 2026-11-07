import ApiError from '../utils/ApiError.js';
import { cleanText } from '../utils/text.js';
import { findStudyMapChapter } from '../services/studyMap.service.js';

const VALID_STUDY_MODES = ['global', 'focus'];
const isDev = process.env.NODE_ENV !== 'production';

// A real question has at least one letter or digit. This blocks pure emoji and "?????".
const VALID_TEXT_PATTERN = /[a-zA-Z0-9\u0900-\u097F]/;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// I check the request body before anything else runs. Every problem throws from here,
// with a Hinglish message the student can actually read.
export const validateInput = async (body = {}) => {
  const question = cleanText(body.question);
  const studyMode = cleanText(body.studyMode);
  const requestedSessionId = cleanText(body.sessionId);

  if (isDev) console.log(`[Step 1] Validating input — studyMode: ${studyMode}, sessionId: ${requestedSessionId}`);

  // A brand new session sends no id, so I only check the format when one is there.
  if (requestedSessionId && !UUID_REGEX.test(requestedSessionId)) {
    throw new ApiError(400, 'Invalid session ID format.');
  }

  // These checks are all cheap and run before any DB or LLM call, so junk input costs nothing.
  if (!question) {
    throw new ApiError(400, 'Sawal khali nahi ho sakta! Kripya kuch poochiye.');
  }

  if (question.length > 500) {
    throw new ApiError(400, 'Aapka sawal bahut bada hai! Kripya apne sawal ko 500 characters se kam me likhein.');
  }

  if (!VALID_TEXT_PATTERN.test(question)) {
    throw new ApiError(400, 'Kripya padhai se juda koi sarthak sawal ya shabd likhiye. Sirf emojis ya symbols allowed nahi hain.');
  }

  if (!VALID_STUDY_MODES.includes(studyMode)) {
    throw new ApiError(400, 'studyMode galat hai. Yeh sirf "global" ya "focus" ho sakta hai.');
  }

  if (studyMode === 'global' && body.chapterId) {
    throw new ApiError(400, 'Global Mode me chapterId bhejna allowed nahi hai.');
  }

  let focusChapter = null;

  // Focus mode is the only mode that needs a chapter, and it has to be a real one.
  if (studyMode === 'focus') {
    const chapterId = cleanText(body.chapterId);

    if (!chapterId) {
      throw new ApiError(400, 'Focus Mode ke liye chapterId dena zaroori hai.');
    }

    // I look the chapter up in the study map instead of keeping a hardcoded list here,
    // so a new chapter works the moment it is indexed.
    focusChapter = await findStudyMapChapter(chapterId);

    if (!focusChapter) {
      throw new ApiError(404, `Diya gaya chapterId system me nahi mila: ${chapterId}`);
    }
  }

  return {
    question,
    studyMode,
    requestedSessionId,
    focusChapter, // null in global mode, the real chapter object in focus mode
  };
};