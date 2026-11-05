import { detectConversationLanguage } from '../utils/languageDetector.js';
import { getStudyMap } from '../services/studyMap.service.js';
import {
  formatMemoryForPrompt,
  formatRecentHistory,
  formatCompressedHistory,
  formatStudyMapSummary,
  getLastTutorResponse,
} from './promptHelpers.js';
import { logContextSizes } from '../utils/tokenLogger.js';

const isDev = process.env.NODE_ENV !== 'production';

// How much small talk in a row, turned into how firmly Zuno should push back.
// 0-1 turns: answer normally. 2-3: a gentle nudge. 4 or more: a firm redirect.
const getDriftTier = (n) => {
  if (n <= 1) return 0;
  if (n <= 3) return 1;
  return 2;
};

// The one line that tells the LLM which chapter the student is sitting in.
const buildFocusChapterPrompt = (focusChapter) => {
  if (!focusChapter) {
    return 'No focus chapter selected.';
  }
  const subjectName = focusChapter.subjectHinglishTitle || focusChapter.subjectTitle;
  const sectionName = focusChapter.sectionHinglishTitle || focusChapter.sectionTitle;
  const chapterName = focusChapter.hinglishTitle || focusChapter.title;
  return `${subjectName} > ${sectionName} > Adhyaay ${focusChapter.number ?? '?'}: ${chapterName}`;
};

// The LLM cannot do anything with an id like ch_01, so I turn the student's saved
// ids into real chapter and topic names before they go into the prompt.
const buildStudyContextLine = (chatState, studyMap) => {
  if (!chatState || !chatState.currentChapterId) {
    return 'No active study topic selected. Student is browsing globally or just initiated the conversation.';
  }

  let foundSubject = null;
  let foundSection = null;
  let foundChapter = null;

  const subjects = studyMap?.focusStudy?.subjects || [];
  for (const subj of subjects) {
    for (const sec of subj.sections || []) {
      const ch = (sec.chapters || []).find((c) => c.id === chatState.currentChapterId);
      if (ch) {
        foundSubject = subj.hinglishTitle || subj.title;
        foundSection = sec.hinglishTitle || sec.title;
        foundChapter = ch.hinglishTitle || ch.title;
        break;
      }
    }
    if (foundChapter) break;
  }

  if (!foundChapter) {
    return `Active Chapter ID Reference: ${chatState.currentChapterId} | Mode Status: ${chatState.learningMode}`;
  }

  return `Active Subject Group: ${foundSubject} > ${foundSection} | Active Textbook Chapter: ${foundChapter} | Active Progress Topic: ${chatState.lastTopic || 'Chapter Initialization Open Segment'} | Learning Mode Status: ${chatState.learningMode}`;
};

// I turn everything step1 and step2 gathered into the plain text blocks the two
// prompts expect. No LLM call happens here, only formatting.
export const buildContext = async ({ question, focusChapter }, { chatState, recentMessages, sessionId }) => {
  if (isDev) console.log('[Step 3] Building context...');

  const studyMap = await getStudyMap();

  const language = detectConversationLanguage({ question, recentMessages });
  if (isDev) console.log(`[Step 3] Answer language: ${language.answerLanguage}`);

  const currentStudyContext = buildStudyContextLine(chatState, studyMap);
  if (isDev) console.log(`[Step 3] Study context: ${currentStudyContext}`);

  const memory = JSON.stringify(formatMemoryForPrompt(chatState));
  const history = formatRecentHistory(recentMessages);
  // The decider only needs enough history to resolve "iska", "wo" and EXPLAIN_MORE,
  // so I send a compressed copy: last Zuno reply in full, older ones shortened.
  const deciderHistory = formatCompressedHistory(recentMessages.slice(-6));
  const lastTutorResponse = getLastTutorResponse(recentMessages);
  const curriculumSummary = formatStudyMapSummary(studyMap);
  const focusChapterPrompt = buildFocusChapterPrompt(focusChapter);

  // messageCount only goes up in step7, so the current turn is that plus one.
  const turnNumber = (chatState?.messageCount ?? 0) + 1;
  logContextSizes(sessionId, turnNumber, {
    history,
    lastTutorResponse,
    curriculumSummary,
    memory,
    focusChapterPrompt,
    currentStudyContext,
  });

  return {
    language,
    memory,
    history,
    deciderHistory,
    lastTutorResponse,
    curriculumSummary,
    focusChapterPrompt,
    currentStudyContext,
    lastStudyResponse: chatState?.lastStudyResponse || null,
    recentMessages,   // the router slices its own history window per intent, so it needs the raw list
    driftSignal: {
      consecutiveNonAcademic: chatState.consecutiveNonAcademicTurns ?? 0,
      totalNonAcademic:       chatState.totalNonAcademicTurns       ?? 0,
      tier:                   getDriftTier(chatState.consecutiveNonAcademicTurns ?? 0),
    },
  };
};