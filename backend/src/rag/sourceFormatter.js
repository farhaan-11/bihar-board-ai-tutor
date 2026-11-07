// I turn raw retrieved chunks into the "Source 1, Source 2" list the frontend shows.
// Several chunks often come from the same chapter section, so I merge those into one
// entry instead of showing the student the same section three times.

import { cleanText } from '../utils/text.js';

const toComparisonKey = (text) =>
  cleanText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const getHeadingParts = (headingPath) =>
  String(headingPath || '')
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean);

// I take the most specific heading out of a path, so
// "Chapter 1 > Life Processes > Nutrition" becomes just "Nutrition".
const extractTopicTitle = (headingPath, chapterTitle) => {
  const parts = getHeadingParts(headingPath);
  const leaf = parts[parts.length - 1] || chapterTitle || 'Unknown topic';
  return leaf
    .replace(/^chapter\s+\d+\s*:\s*/i, '')
    .replace(/^\d+\.?\s*/, '')
    .trim() || 'Unknown topic';
};

// Two chunks from the same chapter and heading get the same key, which is how
// I spot the duplicates.
const createSourceKey = ({ chapterTitle, headingPath }) =>
  `${toComparisonKey(chapterTitle)}::${toComparisonKey(headingPath)}`;

// Reads as "Chemical Reactions and Equations - Key Definitions".
const createSourceLabel = ({ chapterTitle, topicTitle }) =>
  topicTitle && topicTitle !== chapterTitle
    ? `${chapterTitle} - ${topicTitle}`
    : chapterTitle;

// Takes what retrieveRelevantChunks() returned and gives back the numbered,
// deduplicated source list.
export const formatSources = (chunks) =>
  chunks.reduce((sources, chunk) => {
    const metadata = chunk.metadata || {};
    const chapterTitle = metadata.chapter_title || 'Unknown';
    const hinglishTitle = metadata.hinglish_title || chapterTitle;
    const headingPath = metadata.heading_path || 'Unknown';
    const topicTitle = extractTopicTitle(headingPath, chapterTitle);
    const chunkId = metadata.chunk_id || chunk.id || 'Unknown';
    const key = createSourceKey({ chapterTitle, headingPath });

    // If this heading was already added, just append the chunk ID
    const existingSource = sources.find((source) => source.sourceId === key);
    if (existingSource) {
      existingSource.chunkIds = [...new Set([...existingSource.chunkIds, chunkId])];
      return sources;
    }

    const sourceNumber = sources.length + 1;
    const source = {
      sourceNumber,
      sourceId: key,
      label: `Source ${sourceNumber}: ${createSourceLabel({ chapterTitle, topicTitle })}`,
      sourceTitle: createSourceLabel({ chapterTitle, topicTitle }),
      chapter_title: chapterTitle,
      chapterTitle,
      hinglishTitle,
      topicTitle,
      section: metadata.section || 'Unknown',
      sectionTitle: metadata.section || 'Unknown',
      heading_path: headingPath,
      headingPath,
      chunk_id: chunkId,
      chunkId,
      chunkIds: [chunkId],
    };

    return [...sources, source];
  }, []);
