/**
 * step5.retrieveContent.js — Step 5 of the Ask API flow
 * * PRODUCTION-GRADE ORCHESTRATOR COMPONENT
 */

import { retrieveRelevantChunks, retrieveChunksByTopicId, hasHeadingOrChapterTermMatch } from '../rag/retriever.js';
import { retrieveFromPython } from '../rag/pythonRetrieverClient.js';
import { formatSources } from '../rag/sourceFormatter.js';
import { formatRetrievedContext } from './promptHelpers.js';
import { getNextTopic } from '../curriculum/nextTopicResolver.js';
import { getExamContext, resolveExamEntity, formatEntityFact } from '../knowledge/examKnowledgeService.js';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Builds retriever options with explicit boundaries.
 */
const getRetrieverOptions = (focusChapter) => {
  if (!focusChapter) {
    return {}; // Global Mode: search across all branches
  }

  return {
    metadataFilter: focusChapter.metadataFilter, // Scopes to e.g. { subject: 'Science', section: 'Biology', chapter_no: 1 }
    requireTermMatchForLatinQuery: true,          // Restricts loose embedding drifts
  };
};

// One switch for all search calls below. .env values are text, so we compare with 'true'.
const searchChunks = (query, options) => {
  if (String(process.env.USE_PYTHON_RETRIEVER).toLowerCase() === 'true') {
    return retrieveFromPython(query, options);
  }
  return retrieveRelevantChunks(query, options);
};

/**
 * Step 5: Search the vector store for relevant content.
 * Bypasses immediately if Step 4 router evaluated needsRetrieval as false.
 */
export const retrieveContent = async ({ needsRetrieval, searchQuery, intent, examEntity }, { focusChapter }, { chatState, chapterProgress }, abortSignal = null) => {
  if (abortSignal?.aborted) {
    if (isDev) console.log(`[Step 5] Aborting vector search early due to AbortSignal`);
    const error = new Error('AbortError');
    error.name = 'AbortError';
    throw error;
  }

  if (isDev) console.log(`[Step 5 Execution] Initiating Retrieval Decision Verification. Required: ${needsRetrieval}`);

  // NEXT_STEP: resolve the next core topic first, then retrieve content for it
  // currentTopicId now comes from ChapterProgress (single source of truth for topic
  // progress) rather than chatState — see FOCUS_MODE_PROGRESS_FIX_PLAN.md.
  if (intent === 'NEXT_STEP') {
    const currentTopicId = chapterProgress?.currentTopicId ?? null;
    const result = await getNextTopic(chatState.currentChapterId, currentTopicId);

    if (result.status === 'no_chapter') {
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'NO_RETRIEVED_CONTEXT',
        nextTopicSignal: null,
      };
    }

    if (result.status === 'chapter_complete') {
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'CHAPTER_COMPLETE',
        nextTopicSignal: null,
      };
    }

    // status === 'found': the exact topic is already known with 100% certainty
    // (resolved above by getNextTopic()) — fetch its linked chunks directly by
    // topic_ids membership instead of guessing via semantic search. Replaces the
    // old buildTopicSearchQuery()+retrieveRelevantChunks() approach, which could
    // retrieve a completely unrelated chunk when a chapter had overlapping wording
    // between a short overview section and the topic actually being taught (root
    // cause + fix design: see RETRIEVAL_TOPIC_LINKING_PLAN.md).
    if (isDev) console.log(`[Step 5 NEXT_STEP] Fetching linked chunks for topic: "${result.topic.title}" (${result.topic.topicId})`);

    const nextChunks = await retrieveChunksByTopicId(result.topic.topicId, focusChapter?.metadataFilter);
    // Kept for chatState continuity (EXPLAIN_MORE's fallback chain reads
    // chatState.lastRetrievalQuery) — no longer used as an actual search query.
    const lastRetrievalQuery = `${result.topic.chapterTitle} ${result.topic.title}`;

    if (nextChunks.length === 0) {
      // Should be unreachable if verify-topic-chunk-coverage.js passed after the
      // last content/index update — but never silently teach nothing if it happens.
      if (isDev) console.error(`[Step 5 NEXT_STEP] 0 chunks linked to topic ${result.topic.topicId} — coverage gap, see verify-topic-chunk-coverage.js`);
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'NO_RETRIEVED_CONTEXT',
        nextTopicSignal: { topicId: result.topic.topicId, title: result.topic.title },
        lastRetrievalQuery,
      };
    }

    return {
      // Minimal shape preserved for step7.saveAndRespond.js's debug summary
      // (retrieval.question / retrieval.debug.returnedCount) — this is now a
      // deterministic lookup, not a scored search, so there is no real "question".
      retrieval: { question: lastRetrievalQuery, debug: { returnedCount: nextChunks.length } },
      chunks: nextChunks,
      sources: formatSources(nextChunks),
      retrievedContext: formatRetrievedContext(nextChunks),
      nextTopicSignal: { topicId: result.topic.topicId, title: result.topic.title },
      lastRetrievalQuery,
    };
  }

  // EXPLAIN_MORE: re-retrieve the topic the student wants re-explained.
  // By design (see deciderPrompt.js), the decider ALWAYS returns searchQuery=null for
  // this intent — EXPLAIN_MORE means "re-explain what you just told me", so it
  // deliberately reuses saved session state (lastRetrievalQuery → lastTopic) instead
  // of extracting a fresh query. That design is sound; the bug was that this reused
  // state was never scoped to the focus chapter, so it could retrieve (and teach)
  // content from a completely different chapter with no warning. Passing focusChapter
  // here closes that gap the same way CONCEPT_QUESTION/NEXT_STEP already are scoped —
  // and if the reused query genuinely isn't from this chapter, the 0-chunks branch
  // below already asks the student to clarify instead of guessing globally.
  if (intent === 'EXPLAIN_MORE') {
    const topicQuery = searchQuery || chatState?.lastRetrievalQuery || chatState?.lastTopic || null;

    if (!topicQuery) {
      if (isDev) console.log('[Step 5 EXPLAIN_MORE] No query available (searchQuery=null, lastTopic=null) — empty context, tutor will ask student to clarify topic.');
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'NO_RETRIEVED_CONTEXT',
        nextTopicSignal: null,
      };
    }

    const querySource = chatState?.lastRetrievalQuery ? 'chatState.lastRetrievalQuery' : 'chatState.lastTopic';
    if (isDev) console.log(`[Step 5 EXPLAIN_MORE] Re-retrieving via ${querySource}: "${topicQuery}"`);

    const explainRetrieval = await searchChunks(topicQuery, getRetrieverOptions(focusChapter));
    const explainChunks = explainRetrieval.results || [];

    if (!explainChunks.length) {
      if (isDev) console.log(`[Step 5 EXPLAIN_MORE] 0 chunks returned for "${topicQuery}" — empty context, tutor will ask student to clarify.`);
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'NO_RETRIEVED_CONTEXT',
        nextTopicSignal: null,
      };
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

  // EXAM_INFO: deterministic knowledge base lookup — bypasses vector search entirely.
  // examKnowledgeService reads data/class-10/global/exam_patterns.json (not in vector store).
  // Returns formatted context string injected into the tutor LLM as {retrievedContext}.
  // Step 6 (tutor LLM) does not need to know this came from JSON, not vector search.
  if (intent === 'EXAM_INFO') {
    if (isDev) console.log('[Step 5 EXAM_INFO] Knowledge Service lookup — no vector search');
    const examContext = getExamContext();

    // If the decider identified a specific subject/branch/chapter/unit, resolve its exact
    // marks + parent-paper relationship in code and prepend it as a fixed fact block — the
    // tutor LLM's job becomes "repeat this number", not "compose it from the full data
    // dump below". Unresolved/absent entity falls back to the full dump exactly as before
    // (safe — this is the same behavior EXAM_INFO already had for general questions).
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

  // Short-circuit routing check
  if (!needsRetrieval) {
    if (isDev) console.log('[Step 5 Bypassed] Skipping vector database lookups due to conversational context routing rule.');
    return {
      retrieval: null,
      chunks: [],
      sources: [],
      retrievedContext: 'NO_RETRIEVED_CONTEXT',
    };
  }

  if (isDev) console.log(`[Step 5 DB Scan] Querying index vectors using computed target: "${searchQuery}"`);

  const retrieval = await searchChunks(
    searchQuery,
    getRetrieverOptions(focusChapter)
  );

  const chunks = retrieval.results || [];

  // OUT-OF-FOCUS FALLBACK — CONCEPT_QUESTION only.
  // Triggers when the focus-scoped search found nothing (0 chunks), OR when everything it
  // found only matched weakly — content-only keyword hits, no heading/chapter-title match.
  // A weak in-focus result is not strong evidence the topic actually belongs to this
  // chapter: real case that surfaced this — a Biology "Life Processes" question, asked
  // while focused on the Light chapter, weakly matched 1 unrelated Light chunk (a
  // reranker keyword false-positive — see reranker.js's tokenize() comment), so the old
  // chunks.length === 0 check never fired and the wrong-chapter chunk was silently taught.
  const hasOnlyWeakMatches = chunks.length > 0 && chunks.every((chunk) => !hasHeadingOrChapterTermMatch(chunk));

  if (intent === 'CONCEPT_QUESTION' && focusChapter && (chunks.length === 0 || hasOnlyWeakMatches)) {
    if (isDev) console.log(`[Step 5 OOF] Focus retrieval ${chunks.length === 0 ? 'returned 0' : 'found only weak content-only matches'} — running global fallback for: "${searchQuery}"`);

    const globalRetrieval = await searchChunks(searchQuery, { topK: 3 });
    const globalChunks = globalRetrieval.results || [];
    const globalHasStrongMatch = globalChunks.some((chunk) => hasHeadingOrChapterTermMatch(chunk));

    // A weak-but-present in-focus result only gets overridden if the global search found
    // something CONFIDENTLY stronger elsewhere (a heading/chapter-title match) — a
    // weak-vs-weak tie keeps the original in-focus answer, since the student's question
    // may simply be phrased differently than any heading in their own chapter (not proof
    // it belongs elsewhere). The original chunks.length === 0 case is unchanged: any
    // global match at all (weak or strong) still redirects, exactly as before.
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
      return {
        retrieval: null, chunks: [], sources: [],
        retrievedContext: 'NO_RETRIEVED_CONTEXT',
        lastRetrievalQuery: searchQuery,
      };
    }

    // Weak-vs-weak tie: fall through and keep the original in-focus chunks below.
    if (isDev) console.log(`[Step 5 OOF] Global fallback found nothing confidently stronger — keeping weak in-focus match.`);
  }

  // Format candidate chunks into structural objects for user consumption
  const sources = formatSources(chunks);

  // Format document boundaries into text sections for the subsequent Tutor prompt
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