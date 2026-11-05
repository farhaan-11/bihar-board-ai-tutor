import { retrieveRelevantChunks, retrieveChunksByTopicId, hasHeadingOrChapterTermMatch } from '../rag/retriever.js';
import { retrieveFromPython } from '../rag/pythonRetrieverClient.js';
import { formatSources } from '../rag/sourceFormatter.js';
import { formatRetrievedContext } from './promptHelpers.js';
import { getNextTopic } from '../curriculum/nextTopicResolver.js';
import { getExamContext, resolveExamEntity, formatEntityFact } from '../knowledge/examKnowledgeService.js';

const isDev = process.env.NODE_ENV !== 'production';

// Global mode searches everything. Focus mode is limited to the focus chapter.
const getRetrieverOptions = (focusChapter) => {
  if (!focusChapter) {
    return {};
  }

  return {
    metadataFilter: focusChapter.metadataFilter,
    requireTermMatchForLatinQuery: true,          // stops loose embedding matches
  };
};

// The "found nothing" result. Each branch adds the extra keys it needs on top.
const noContent = (extra = {}) => ({
  retrieval: null,
  chunks: [],
  sources: [],
  retrievedContext: 'NO_RETRIEVED_CONTEXT',
  ...extra,
});

// Shadow mode: runs the Python retriever too, but its result only goes to the log.
// If Python fails we stay silent, the student never notices.
// A test can pass its own fetchPython; otherwise the real Python client runs.
export const compareWithPython = async (query, options, nodeResult, fetchPython = retrieveFromPython) => {
  try {
    const startedAt = Date.now();
    const pythonResult = await fetchPython(query, options);
    const pythonMs = Date.now() - startedAt;

    const nodeIds = [];
    for (const chunk of nodeResult.results) {
      nodeIds.push(chunk.id);
    }

    const pythonIds = [];
    for (const chunk of pythonResult.results) {
      pythonIds.push(chunk.id);
    }

    if (nodeIds.join(',') === pythonIds.join(',')) {
      console.log(`[Shadow] same ids (python ${pythonMs}ms) for "${query.slice(0, 60)}"`);
    } else {
      console.warn(`[Shadow] DIFF (python ${pythonMs}ms) for "${query.slice(0, 60)}"`, { node: nodeIds, python: pythonIds });
    }
  } catch (error) {
    console.log(`[Shadow] python failed, student ko kuch nahi dikha: ${error.message}`);
  }
};

// One switch for every search below. .env values are text, so we compare with text.
// false = Node only, true = Python only, shadow = Node answers and Python only logs.
const searchChunks = async (query, options) => {
  const mode = String(process.env.USE_PYTHON_RETRIEVER).toLowerCase();

  if (mode === 'true') {
    return retrieveFromPython(query, options);
  }

  const nodeResult = await retrieveRelevantChunks(query, options);

  if (mode === 'shadow') {
    // No await, so the student does not wait for Python.
    compareWithPython(query, options, nodeResult);
  }

  return nodeResult;
};

// Step 5: finds the study content for this question.
// Returns an empty result straight away when step 4 said no retrieval is needed.
export const retrieveContent = async ({ needsRetrieval, searchQuery, intent, examEntity }, { focusChapter }, { chatState, chapterProgress }, abortSignal = null) => {
  if (abortSignal?.aborted) {
    if (isDev) console.log(`[Step 5] Aborting vector search early due to AbortSignal`);
    const error = new Error('AbortError');
    error.name = 'AbortError';
    throw error;
  }

  if (isDev) console.log(`[Step 5 Execution] Initiating Retrieval Decision Verification. Required: ${needsRetrieval}`);

  // NEXT_STEP: find the next topic first, then fetch the content for it.
  // The current topic comes from ChapterProgress, not chatState.
  if (intent === 'NEXT_STEP') {
    const currentTopicId = chapterProgress?.currentTopicId ?? null;
    const result = await getNextTopic(chatState.currentChapterId, currentTopicId);

    if (result.status === 'no_chapter') {
      return noContent({ nextTopicSignal: null });
    }

    if (result.status === 'chapter_complete') {
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'CHAPTER_COMPLETE',
        nextTopicSignal: null,
      };
    }

    // The topic is already known, so fetch its linked chunks directly by topic id.
    // A semantic search could pick an unrelated chunk when a short overview section
    // shared wording with the topic being taught.
    if (isDev) console.log(`[Step 5 NEXT_STEP] Fetching linked chunks for topic: "${result.topic.title}" (${result.topic.topicId})`);

    const nextChunks = await retrieveChunksByTopicId(result.topic.topicId, focusChapter?.metadataFilter);
    // Only saved for EXPLAIN_MORE, which reads chatState.lastRetrievalQuery. Not used as a search here.
    const lastRetrievalQuery = `${result.topic.chapterTitle} ${result.topic.title}`;

    if (nextChunks.length === 0) {
      // Should not happen if verify-topic-chunk-coverage.js passed after the last index update.
      // If it does, never silently teach nothing.
      if (isDev) console.error(`[Step 5 NEXT_STEP] 0 chunks linked to topic ${result.topic.topicId} — coverage gap, see verify-topic-chunk-coverage.js`);
      return noContent({
        nextTopicSignal: { topicId: result.topic.topicId, title: result.topic.title },
        lastRetrievalQuery,
      });
    }

    return {
      // step7's debug summary reads retrieval.question and retrieval.debug.returnedCount.
      // This is a direct lookup, so there is no real question.
      retrieval: { question: lastRetrievalQuery, debug: { returnedCount: nextChunks.length } },
      chunks: nextChunks,
      sources: formatSources(nextChunks),
      retrievedContext: formatRetrievedContext(nextChunks),
      nextTopicSignal: { topicId: result.topic.topicId, title: result.topic.title },
      lastRetrievalQuery,
    };
  }

  // EXPLAIN_MORE: fetch the content for the topic the student wants explained again.
  // The decider always gives searchQuery=null here (see deciderPrompt.js), so we reuse the
  // saved lastRetrievalQuery, then lastTopic. The search is limited to the focus chapter, so
  // it cannot teach another chapter. If the saved query is not from this chapter, the
  // 0-chunks branch below asks the student to clarify.
  if (intent === 'EXPLAIN_MORE') {
    const topicQuery = searchQuery || chatState?.lastRetrievalQuery || chatState?.lastTopic || null;

    if (!topicQuery) {
      if (isDev) console.log('[Step 5 EXPLAIN_MORE] No query available (searchQuery=null, lastTopic=null) — empty context, tutor will ask student to clarify topic.');
      return noContent({ nextTopicSignal: null });
    }

    const querySource = chatState?.lastRetrievalQuery ? 'chatState.lastRetrievalQuery' : 'chatState.lastTopic';
    if (isDev) console.log(`[Step 5 EXPLAIN_MORE] Re-retrieving via ${querySource}: "${topicQuery}"`);

    const explainRetrieval = await searchChunks(topicQuery, getRetrieverOptions(focusChapter));
    const explainChunks = explainRetrieval.results || [];

    if (!explainChunks.length) {
      if (isDev) console.log(`[Step 5 EXPLAIN_MORE] 0 chunks returned for "${topicQuery}" — empty context, tutor will ask student to clarify.`);
      return noContent({ nextTopicSignal: null });
    }

    if (isDev) console.log(`[Step 5 EXPLAIN_MORE] ${explainChunks.length} chunks retrieved for re-explanation.`);
    return {
      retrieval: explainRetrieval,
      chunks: explainChunks,
      sources: formatSources(explainChunks),
      retrievedContext: formatRetrievedContext(explainChunks),
      nextTopicSignal: null,
    };
  }

  // EXAM_INFO: reads exam facts from a JSON file (examKnowledgeService), no vector search.
  // The text goes into the tutor prompt as retrievedContext.
  if (intent === 'EXAM_INFO') {
    if (isDev) console.log('[Step 5 EXAM_INFO] Knowledge Service lookup — no vector search');
    const examContext = getExamContext();

    // If the decider named a specific subject/branch/chapter/unit, its exact marks are worked
    // out in code and put first, so the tutor repeats the number instead of composing it.
    // If it does not resolve, the tutor gets the full exam text.
    const resolvedEntity = examEntity ? resolveExamEntity(examEntity) : null;
    if (isDev && examEntity) console.log(`[Step 5 EXAM_INFO] examEntity="${examEntity}" → ${resolvedEntity ? `resolved (${resolvedEntity.level}, ${resolvedEntity.ownMarks} marks)` : 'unresolved, falling back to full context'}`);
    const retrievedContext = resolvedEntity
      ? `${formatEntityFact(resolvedEntity)}\n\n${examContext}`
      : examContext;

    return {
      retrieval: null,
      chunks: [],
      sources: [],
      retrievedContext,
      nextTopicSignal: null,
      lastRetrievalQuery: null,
    };
  }

  if (!needsRetrieval) {
    if (isDev) console.log('[Step 5 Bypassed] Skipping vector database lookups due to conversational context routing rule.');
    return noContent();
  }

  if (isDev) console.log(`[Step 5 DB Scan] Querying index vectors using computed target: "${searchQuery}"`);

  const retrieval = await searchChunks(
    searchQuery,
    getRetrieverOptions(focusChapter)
  );

  const chunks = retrieval.results || [];

  // Out-of-focus fallback, CONCEPT_QUESTION in focus mode only.
  // Runs when the focus search found nothing, or only weak matches (content words only,
  // no heading or chapter-title match). Real case: a Biology "Life Processes" question asked
  // in the Light chapter weakly matched one unrelated Light chunk and was taught from it.
  const hasOnlyWeakMatches = chunks.length > 0 && chunks.every((chunk) => !hasHeadingOrChapterTermMatch(chunk));

  if (intent === 'CONCEPT_QUESTION' && focusChapter && (chunks.length === 0 || hasOnlyWeakMatches)) {
    if (isDev) console.log(`[Step 5 OOF] Focus retrieval ${chunks.length === 0 ? 'returned 0' : 'found only weak content-only matches'} — running global fallback for: "${searchQuery}"`);

    const globalRetrieval = await searchChunks(searchQuery, { topK: 3 });
    const globalChunks = globalRetrieval.results || [];
    const globalHasStrongMatch = globalChunks.some((chunk) => hasHeadingOrChapterTermMatch(chunk));

    // If focus found 0 chunks, any global match redirects the student.
    // If focus found a weak match, only a strong global match (heading or chapter-title) overrides it.
    // Weak against weak keeps the in-focus answer: the question may just be worded
    // differently than the headings in the student's own chapter.
    if (globalChunks.length > 0 && (chunks.length === 0 || globalHasStrongMatch)) {
      if (isDev) console.log(`[Step 5 OOF] Global fallback found ${globalChunks.length} chunk(s) — topic exists outside focus chapter.`);
      return {
        retrieval: globalRetrieval,
        chunks: globalChunks,
        sources: formatSources(globalChunks),
        retrievedContext: formatRetrievedContext(globalChunks),
        isOutOfFocusAnswer: true,
        outOfFocusChapter: {
          section:   globalChunks[0]?.metadata?.section   || null,
          chapterNo: globalChunks[0]?.metadata?.chapter_no || null,
        },
        lastRetrievalQuery: searchQuery,
      };
    }

    if (chunks.length === 0) {
      if (isDev) console.log(`[Step 5 OOF] Global fallback also returned 0 — topic not in material.`);
      return noContent({ lastRetrievalQuery: searchQuery });
    }

    // Weak against weak: fall through and keep the in-focus chunks.
    if (isDev) console.log(`[Step 5 OOF] Global fallback found nothing confidently stronger — keeping weak in-focus match.`);
  }

  const sources = formatSources(chunks);
  const retrievedContext = formatRetrievedContext(chunks);

  if (isDev) console.log(`[Step 5 Complete] Successfully packaged ${chunks.length} ground truth chunks for text generation layer.`);

  return {
    retrieval,
    chunks,
    sources,
    retrievedContext,
    lastRetrievalQuery: searchQuery,
  };
};
