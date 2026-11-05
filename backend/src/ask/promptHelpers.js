import { cleanText } from '../utils/text.js';

// Turns chat messages into plain "Student: ... / Zuno: ..." lines, all in full.
// Used by the legacy step6 path, by EXPLAIN_MORE (needs the full last reply),
// and as the fallback inside formatCompressedHistory.
export const formatRecentHistory = (messages = []) => {
  if (!messages.length) {
    return 'No previous messages in this session.';
  }

  return messages
    .map((message) => `${message.role === 'student' ? 'Student' : 'Zuno'}: ${cleanText(message.text)}`)
    .join('\n');
};

// Shrinks an older Zuno reply to its first 30 words plus the word count.
// The "Zuno [prev, ~Nw]:" prefix differs from "Zuno:", so a prompt that says
// "check the most recent Zuno: entry" can only mean the one full entry at the bottom.
const compressZunoResponse = (text) => {
  const words = text.split(/\s+/);
  const preview = words.slice(0, 30).join(' ');
  const suffix = words.length > 30 ? '...' : '';
  return `Zuno [prev, ~${words.length}w]: ${preview}${suffix}`;
};

// Same as formatRecentHistory, but older Zuno replies are compressed to save tokens.
// The last Zuno reply stays full, because the anti-repetition rule (CONCEPT_QUESTION)
// and the meta-reaction handling (GREETING) both need the exact previous reply.
// Student messages are never compressed.
// Not for EXPLAIN_MORE: it needs the full last reply, so it uses formatRecentHistory.
export const formatCompressedHistory = (messages = []) => {
  if (!messages.length) return 'No previous messages in this session.';

  let lastZunoIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tutor') { lastZunoIdx = i; break; }
  }

  // No Zuno reply yet, so there is nothing to compress.
  if (lastZunoIdx < 0) return formatRecentHistory(messages);

  return messages
    .map((msg, idx) => {
      const text = cleanText(msg.text);
      if (msg.role === 'student') return `Student: ${text}`;
      if (idx === lastZunoIdx)    return `Zuno: ${text}`;
      return compressZunoResponse(text);
    })
    .join('\n');
};

// Returns Zuno's previous reply, used for repetition checks.
export const getLastTutorResponse = (messages = []) => {
  const lastTutorMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'tutor');

  return lastTutorMessage
    ? cleanText(lastTutorMessage.text)
    : 'No previous Zuno response.';
};

// Turns the study map into a short "Subject / Section: 1. Chapter; 2. Chapter" summary.
export const formatStudyMapSummary = (studyMap) => {
  const subjects = studyMap?.focusStudy?.subjects || [];

  if (!subjects.length) {
    return 'No curriculum map is available.';
  }

  return subjects.map((subject) => {
    const subjectLabel = subject.hinglishTitle || subject.title;
    const sections = (subject.sections || []).map((section) => {
      const sectionLabel = section.hinglishTitle || section.title;
      const chapters = (section.chapters || [])
        .map((chapter) => `${chapter.number}. ${chapter.hinglishTitle || chapter.title}`)
        .join('; ');
      return `${sectionLabel}: ${chapters}`;
    });

    return `${subjectLabel}\n${sections.join('\n')}`;
  }).join('\n\n');
};

// Picks the chat-state fields the prompts need, with a default for each missing one.
export const formatMemoryForPrompt = (chatState) => ({
  currentSubjectId: chatState?.currentSubjectId || null,
  currentSectionId: chatState?.currentSectionId || null,
  currentChapterId: chatState?.currentChapterId || null,
  learningMode: chatState?.learningMode || 'idle',
  pendingAction: chatState?.pendingAction || null,
  lastTopic: chatState?.lastTopic || null,
  lastDoubtTopic: chatState?.lastDoubtTopic || null,
  lastDoubtQuestion: chatState?.lastDoubtQuestion || null,
});

// Chunks start with a [Context] block (Board/Class/Subject/Chapter/Topic) added by
// markdownChunker. The [Source N] header already shows that, so we return only the
// text after the [Content] marker.
const extractChunkContent = (chunk) => {
  const raw = chunk.content || '';
  const idx = raw.indexOf('[Content]');
  if (idx !== -1) return raw.slice(idx + '[Content]'.length).trim();
  return String(raw).replace(/\s+/g, ' ').trim();
};

// Builds the "[Source 1] ... [Source 2] ..." text block that goes into the tutor prompt.
export const formatRetrievedContext = (chunks = []) => {
  if (!chunks.length) {
    return 'NO_RETRIEVED_CONTEXT';
  }

  return chunks.map((chunk, index) => {
    const metadata = chunk.metadata || {};
    const content = extractChunkContent(chunk);
    const headingPath = String(metadata.heading_path || '');
    const leafHeading = (headingPath.split('>').pop() || 'Unknown').trim();

    return `[Source ${index + 1}]
Chapter: ${metadata.chapter_title || 'Unknown'}
Heading: ${leafHeading}
Content:
${content}`;
  }).join('\n\n---\n\n');
};

// Joins the title and sections into one plain answer string.
// A section whose heading just repeats the title is added without its heading.
export const sectionsToAnswerText = ({ title, sections = [] }) => {
  const parts = [];
  const normalizedTitle = cleanText(title);

  if (normalizedTitle) {
    parts.push(normalizedTitle);
  }

  for (const section of sections) {
    const heading = cleanText(section.heading);
    const content = cleanText(section.content);
    const headingRepeatsTitle =
      normalizedTitle &&
      heading.toLowerCase() === normalizedTitle.toLowerCase();

    if (heading && content && !headingRepeatsTitle) {
      parts.push(`${heading}\n${content}`);
    } else if (content) {
      parts.push(content);
    }
  }

  return parts.join('\n\n').trim();
};
