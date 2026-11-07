// I turn a free-text message like "chapter 3 padhao" into one chapter from the
// curriculum index. Nothing here is an exact lookup: I score every chapter on
// chapter numbers, title words and subject hints, then return the best one.
// This does run on the live server — topicResolver and quizGenerator both call in.

import { cleanText } from '../utils/text.js';

const SUBJECT_KEYWORDS = {
  'science.physics': ['physics', 'physic', 'bijli', 'electricity', 'light', 'wave', 'force', 'refraction'],
  'science.chemistry': ['chemistry', 'rasayan', 'reaction', 'acid', 'base', 'metal', 'nonmetal'],
  'science.biology': ['biology', 'jeev', 'life', 'digestion', 'reproduction', 'genetics', 'ecosystem'],
};

const SECTION_KEYWORDS = {
  'science.physics.section-01': ['physics', 'physic', 'bijli', 'electricity', 'light', 'force'],
  'science.chemistry.section-01': ['chemistry', 'rasayan', 'reaction', 'acid', 'metal'],
  'science.biology.section-01': ['biology', 'jeev', 'life', 'digestion', 'reproduction'],
};

const detectSubjectHint = (normalizedText) => {
  for (const [subjectId, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (keywords.some((kw) => normalizedText.includes(kw))) return subjectId;
  }
  return null;
};

const detectSectionHint = (normalizedText) => {
  for (const [sectionId, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some((kw) => normalizedText.includes(kw))) return sectionId;
  }
  return null;
};

// I lower-case the message and pull out whatever subject/section hints it carries.
const prepareMessage = (message) => {
  const originalText = cleanText(message);
  const normalizedText = cleanText(originalText.toLowerCase());
  return {
    originalText,
    normalizedText,
    aliasesApplied: [],
    subjectHint: detectSubjectHint(normalizedText),
    sectionHint: detectSectionHint(normalizedText),
  };
};

// -- Chapter resolver --

const NUMBER_WORDS = new Map([
  ['one', 1], ['first', 1], ['ek', 1], ['pehla', 1], ['pahla', 1],
  ['do', 2], ['two', 2], ['second', 2], ['dusra', 2],
  ['teen', 3], ['three', 3], ['third', 3], ['teesra', 3],
  ['char', 4], ['four', 4], ['fourth', 4],
  ['panch', 5], ['five', 5], ['fifth', 5],
  ['chhe', 6], ['six', 6], ['sixth', 6],
  ['saat', 7], ['seven', 7], ['seventh', 7],
]);

const normalizeSearchText = (value) =>
  String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const tokenize = (value) => normalizeSearchText(value).split(' ').filter((token) => token.length > 2);
const unique = (values) => [...new Set(values.filter((value) => value !== null))];

const extractChapterNumbers = (text) => {
  const normalized = normalizeSearchText(text);
  const numbers = [];
  const patterns = [
    /\bchapter\s+(\d{1,2})\b/g,
    /\bchapter\s+number\s+(\d{1,2})\b/g,
    /\bch\s+(\d{1,2})\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) numbers.push(Number.parseInt(match[1], 10));
  }
  for (const [word, number] of NUMBER_WORDS.entries()) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) numbers.push(number);
  }
  return unique(numbers);
};

const flattenChapters = (curriculumIndex) => {
  const chapters = [];
  for (const subject of curriculumIndex.subjects || []) {
    for (const section of subject.sections || []) {
      for (const chapter of section.chapters || []) {
        chapters.push({ ...chapter, subjectId: subject.subjectId, subjectTitle: subject.title, sectionId: section.sectionId, sectionTitle: section.title });
      }
    }
  }
  return chapters;
};

// I score one chapter against the message. Higher means a better match: an exact
// title hit counts most, then a chapter number, then loose word overlap.
const scoreChapter = ({ chapter, normalizedText, sectionHint, subjectHint, chapterNumbers }) => {
  const titleText = normalizeSearchText(chapter.title);
  const messageTokens = tokenize(normalizedText);
  const titleTokens = tokenize(chapter.title);
  const overlap = messageTokens.filter((t) => new Set(titleTokens).has(t)).length;
  let score = 0;
  const reasons = [];
  if (chapterNumbers.includes(chapter.number)) { score += 60; reasons.push('chapter_number'); }
  if (chapter.originalScienceChapterNumber && chapter.originalScienceChapterNumber !== chapter.number && chapterNumbers.includes(chapter.originalScienceChapterNumber)) { score += 45; reasons.push('original_science_chapter_number'); }
  if (titleText && normalizedText.includes(titleText)) { score += 90; reasons.push('chapter_title'); }
  else if (overlap > 0) { score += overlap * 20; reasons.push('chapter_title_tokens'); }
  if (sectionHint && sectionHint.includes(chapter.sectionId)) { score += 35; reasons.push('section_hint'); }
  else if (sectionHint) { score -= 25; }
  if (subjectHint && subjectHint.includes(chapter.subjectId)) { score += 10; reasons.push('subject_hint'); }
  return { chapter, score, reasons };
};

const toPublicChapter = (chapter) => ({
  chapterId: chapter.chapterId, number: chapter.number,
  originalScienceChapterNumber: chapter.originalScienceChapterNumber || null,
  title: chapter.title, subjectId: chapter.subjectId, subjectTitle: chapter.subjectTitle,
  sectionId: chapter.sectionId, sectionTitle: chapter.sectionTitle,
  sourcePath: chapter.sourcePath, topicCount: chapter.topicCount, coreTopicCount: chapter.coreTopicCount,
});

const buildResult = ({ status, match = null, matches = [], reason }) => ({
  status,
  chapter: match ? toPublicChapter(match.chapter) : null,
  matches: matches.map((item) => ({ chapter: toPublicChapter(item.chapter), score: item.score, reasons: item.reasons })),
  reason,
});

export const resolveChapter = (curriculumIndex, message) => {
  const normalized = prepareMessage(message);
  const normalizedText = normalizeSearchText(normalized.normalizedText);
  const chapterNumbers = extractChapterNumbers(normalizedText);

  if (!normalizedText) return buildResult({ status: 'not_found', reason: 'Empty message.' });

  const matches = flattenChapters(curriculumIndex)
    .map((chapter) => scoreChapter({ chapter, normalizedText, sectionHint: normalized.sectionHint, subjectHint: normalized.subjectHint, chapterNumbers }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) return buildResult({ status: 'not_found', reason: 'No chapter matched the message.' });

  const bestScore = matches[0].score;
  const topMatches = matches.filter((match) => match.score === bestScore);

  if (topMatches.length > 1) return buildResult({ status: 'ambiguous', matches: topMatches, reason: 'Multiple chapters matched equally well.' });

  return buildResult({ status: 'resolved', match: matches[0], matches: matches.slice(0, 5), reason: 'Best chapter match selected.' });
};

export const findChapterById = (curriculumIndex, chapterId) =>
  flattenChapters(curriculumIndex).find((chapter) => chapter.chapterId === chapterId) || null;
