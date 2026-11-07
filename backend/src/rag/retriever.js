// I find the study content that matches a student's question.
// Atlas $vectorSearch gives me candidates, reranker.js scores them on keywords,
// and the score bars below decide which ones are good enough to keep.

import path from 'node:path';
import { createQueryEmbeddings } from './embeddings.js';
import { rerankResults } from './reranker.js';
import { retrieverConfig } from './retriever.config.js';
import { Chunk } from '../models/chunk.model.js';
import { embeddingCache } from '../cache/embeddingCache.js';
import { retrievalCache } from '../cache/retrievalCache.js';

// I build the embedding client once and reuse it, not once per request.
let cachedQueryEmbeddings = null;
const getQueryEmbeddings = () => {
  if (!cachedQueryEmbeddings) cachedQueryEmbeddings = createQueryEmbeddings();
  return cachedQueryEmbeddings;
};

// These bars are measured, not guessed: both embedding providers score relevant
// content at 0.55-0.80, but only because chunks are embedded without the [Context]
// preamble. Change what markdownChunker embeds and every number here moves.
const STRONG_VECTOR_SCORE_THRESHOLD = 0.7;
const FINAL_SCORE_THRESHOLD = 0.65;
const HEADING_MATCH_VECTOR_THRESHOLD = 0.62;
// A keyword found only in the chunk body is a weak signal, so it clears a higher bar.
// "Newton" appears in the Human Eye chapter while explaining prisms, but that chunk
// is about light, not Newton's Laws.
const CONTENT_ONLY_VECTOR_THRESHOLD = 0.70;
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

const readSearchLimits = ({ topK, minScore } = {}) => {
  const parsedTopK = Number(topK);
  const parsedMinScore = Number(minScore);
  return {
    topK: Number.isInteger(parsedTopK) && parsedTopK > 0 ? parsedTopK : retrieverConfig.defaultTopK,
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : retrieverConfig.defaultMinScore,
  };
};

const hasMatchedTerms = (result) =>
  Array.isArray(result.rerankDebug?.matchedTerms) && result.rerankDebug.matchedTerms.length > 0;

// True when a keyword hit the chunk's heading or chapter title. That means the chunk
// is really about what was asked, not just mentioning the word in passing.
export const hasHeadingOrChapterTermMatch = (result) => {
  const matchedTerms = result.rerankDebug?.matchedTerms || [];
  return matchedTerms.some(
    (match) => match.fields.includes('heading_path') || match.fields.includes('chapter_title')
  );
};

const hasHighVectorScore = (result) => result.score >= STRONG_VECTOR_SCORE_THRESHOLD;

const isDevanagariQuery = (query) => DEVANAGARI_PATTERN.test(query);

const shouldKeepResult = (result, query, options = {}) => {
  if (options.requireTermMatchForLatinQuery && !isDevanagariQuery(query) && !hasMatchedTerms(result)) {
    return false;
  }

  // A heading match clears the lower bar; a body-only match has to clear the higher one.
  const termMatchPass = hasMatchedTerms(result) && (
    hasHeadingOrChapterTermMatch(result)
      ? result.score >= HEADING_MATCH_VECTOR_THRESHOLD
      : result.score >= CONTENT_ONLY_VECTOR_THRESHOLD
  );

  return (
    (result.finalScore >= FINAL_SCORE_THRESHOLD || termMatchPass) &&
    (hasMatchedTerms(result) || hasHighVectorScore(result) || isDevanagariQuery(query))
  );
};

// The NEXT_STEP path already knows which topic to teach, so there is nothing to guess:
// I fetch every chunk tagged with that topicId. No embedding, no $vectorSearch, no
// reranking — all of that exists to handle uncertainty, and there is none here.
// chapterMetadataFilter narrows it further. topic_ids are already unique, so that
// filter is a second lock rather than the only one.
export const retrieveChunksByTopicId = async (topicId, chapterMetadataFilter = {}) => {
  const query = { 'metadata.topic_ids': topicId };
  for (const [key, value] of Object.entries(chapterMetadataFilter || {})) {
    query[`metadata.${key}`] = value;
  }

  // I leave out the 3072-float `embedding` field (~24 KB per doc). This lookup never
  // reads it, so fetching it would be pure wasted bandwidth.
  const docs = await Chunk.find(query, { embedding: 0 }).lean();

  return docs.map((document) => ({
    id: document.metadata?.chunk_id,
    content: document.pageContent,
    metadata: document.metadata || {},
    score: 1, // deterministic membership match, not a similarity score
  }));
};

// The normal retrieval path, called by Step 5. Answers come from the cache (memory
// first, then Redis) keyed on query + chapter filter + topK; rag:index clears it.
export const retrieveRelevantChunks = async (question, options = {}) => {
  const query = String(question || '').trim();

  if (!query) {
    throw new Error('Question cannot be empty.');
  }

  // A cache hit skips Atlas vector search and reranking entirely (~600-1000ms).
  return retrievalCache.getOrFetch(query, options, () => runRetrieval(query, options));
};

// Kept separate from the function above so the cache can call it without recursing.
const runRetrieval = async (query, options) => {
  const { topK, minScore } = readSearchLimits(options);
  const candidateTopK = options.candidateTopK || Math.max(topK * 10, 50);
  const embeddings = options.embeddings || getQueryEmbeddings();

  // 1. Turn the question into a vector. If the provider fell back to Gemini, that
  //    vector lives in a different space, so I use it for this one request but never
  //    cache it — a cached cross-space vector would poison every later search.
  let usedFallback = false;
  const queryEmbedding = await embeddingCache.getOrFetch(query, async () => {
    if (typeof embeddings.embedQueryWithMeta === 'function') {
      const meta = await embeddings.embedQueryWithMeta(query);
      usedFallback = meta.usedFallback;
      return { embedding: meta.embedding, cacheable: !meta.usedFallback };
    }
    return embeddings.embedQuery(query);
  });

  // 2. Focus Mode sends a chapter filter. Atlas applies it before the vector search.
  let metadataPreFilter = undefined;
  if (options.metadataFilter && Object.keys(options.metadataFilter).length > 0) {
    metadataPreFilter = {};
    for (const [key, value] of Object.entries(options.metadataFilter)) {
      metadataPreFilter[`metadata.${key}`] = value;
    }
  }

  // 3. Build the Atlas $vectorSearch stage.
  const vectorSearchStage = {
    index: "vector_index",
    path: "embedding",
    queryVector: queryEmbedding,
    numCandidates: candidateTopK, // MUST be >= limit
    limit: candidateTopK,
  };

  if (metadataPreFilter) {
    vectorSearchStage.filter = metadataPreFilter;
  }

  const pipeline = [
    {
      $vectorSearch: vectorSearchStage
    },
    {
      $project: {
        _id: 0,
        chunk_id: 1,
        pageContent: 1,
        metadata: 1,
        score: { $meta: "vectorSearchScore" } // Cosine similarity
      }
    }
  ];

  // 4. Execute the pipeline
  let resultsWithScores = [];
  try {
    resultsWithScores = await Chunk.aggregate(pipeline);
  } catch (error) {
    console.error('[Retriever] Vector Search Failed:', error.message);
    throw new Error('Vector Search Failed. Ensure Atlas Vector Search Index "vector_index" is created.');
  }

  // 5. Format results
  const candidates = resultsWithScores
    .filter((doc) => doc.score >= minScore)
    .map((document) => ({
      id: document.chunk_id || document.metadata?.chunk_id,
      content: document.pageContent,
      metadata: document.metadata || {},
      score: document.score,
    }));

  const candidateCount = resultsWithScores.length;

  // 6. Apply custom keyword + intent reranking
  const rerankedResults = rerankResults(query, candidates);

  // 7. Drop everything that does not clear the score bars.
  const filteredResults = rerankedResults.filter((result) =>
    shouldKeepResult(result, query, options)
  );

  const results = filteredResults.slice(0, topK);

  return {
    question: query,
    topK,
    minScore,
    vectorStorePath: 'MongoDB Atlas Vector Search',
    totalVectors: -1, // Cannot easily get total count without a separate query
    embeddingDimension: 3072,
    debug: {
      candidateCountBeforeRerank: candidateCount,
      countAfterMinScore: candidates.length,
      countAfterFinalFiltering: filteredResults.length,
      returnedCount: results.length,
    },
    results,
    // retrievalCache reads this and skips saving results that came from a
    // fallback-provider vector.
    usedFallback,
  };
};