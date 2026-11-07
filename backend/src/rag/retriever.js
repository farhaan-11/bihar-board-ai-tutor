/**
 * retriever.js
 *
 * RAG retriever — Step 5 of the Ask pipeline.
 *
 * Uses MongoDB Atlas Vector Search ($vectorSearch) to retrieve similar chunks.
 * Applies optional chapter-scoped filtering (Focus Mode),
 * runs similarity search, then applies keyword + intent reranking.
 */

import path from 'node:path';
import { createQueryEmbeddings } from './embeddings.js';
import { rerankResults } from './reranker.js';
import { retrieverConfig } from './retriever.config.js';
import { Chunk } from '../models/chunk.model.js';
import { embeddingCache } from '../cache/embeddingCache.js';
import { retrievalCache } from '../cache/retrievalCache.js';

// Singleton embedding instance — avoid creating a new object on every request
let _queryEmbeddings = null;
const getQueryEmbeddings = () => {
  if (!_queryEmbeddings) _queryEmbeddings = createQueryEmbeddings();
  return _queryEmbeddings;
};

// Rerank scoring thresholds (proven values from pre-Atlas MemoryVectorStore era).
// Apply to BOTH OpenAI text-embedding-3-large and Gemini gemini-embedding-001 — both
// produce cosine scores in 0.55-0.80 for relevant content when chunks are embedded
// WITHOUT the [Context] preamble (see markdownChunker.metadata.originalText).
const STRONG_VECTOR_SCORE_THRESHOLD = 0.7;
const FINAL_SCORE_THRESHOLD = 0.65;
const TERM_MATCH_VECTOR_SCORE_THRESHOLD = 0.62;
// Content-only keyword matches (term found in chunk body but NOT in heading/chapter title)
// are a weaker signal \u2014 a higher vector score is required to compensate.
// E.g. "Newton" appears in the Human Eye chapter's body text but that chunk is about light,
// not Newton's Laws. Raising the bar here prevents such cross-topic leaks.
const CONTENT_ONLY_VECTOR_THRESHOLD = 0.70;
const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

const normalizeRetrieverOptions = ({ topK, minScore } = {}) => {
  const parsedTopK = Number(topK);
  const parsedMinScore = Number(minScore);
  return {
    topK: Number.isInteger(parsedTopK) && parsedTopK > 0 ? parsedTopK : retrieverConfig.defaultTopK,
    minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : retrieverConfig.defaultMinScore,
  };
};

const hasMatchedTerms = (result) =>
  Array.isArray(result.rerankDebug?.matchedTerms) && result.rerankDebug.matchedTerms.length > 0;

// True when at least one keyword matched in the chunk's heading or chapter title.
// Heading/chapter matches are strong signals — the topic is directly about what was asked.
// Content-only matches are weak — the word appeared in passing (e.g. "Newton" mentioned
// in a Human Eye chunk while discussing prism experiments).
export const hasHeadingOrChapterTermMatch = (result) => {
  const matchedTerms = result.rerankDebug?.matchedTerms || [];
  return matchedTerms.some(
    (match) => match.fields.includes('heading_path') || match.fields.includes('chapter_title')
  );
};

const isStrongVectorFallback = (result) =>
  result.score >= STRONG_VECTOR_SCORE_THRESHOLD;

const isDevanagariQuery = (query) => DEVANAGARI_PATTERN.test(query);

const passesFinalFilter = (result, query, options = {}) => {
  if (options.requireTermMatchForLatinQuery && !isDevanagariQuery(query) && !hasMatchedTerms(result)) {
    return false;
  }

  // Heading/chapter keyword match → lower vector bar (0.62) — strong signal
  // Content-only keyword match → higher vector bar (0.70) — weak signal, needs stronger vector confidence
  const termMatchPass = hasMatchedTerms(result) && (
    hasHeadingOrChapterTermMatch(result)
      ? result.score >= TERM_MATCH_VECTOR_SCORE_THRESHOLD
      : result.score >= CONTENT_ONLY_VECTOR_THRESHOLD
  );

  return (
    (result.finalScore >= FINAL_SCORE_THRESHOLD || termMatchPass) &&
    (hasMatchedTerms(result) || isStrongVectorFallback(result) || isDevanagariQuery(query))
  );
};

/**
 * Deterministic chunk lookup for NEXT_STEP — the topic to teach is already known
 * with 100% certainty (resolved by getNextTopic()/ChapterProgress), so this fetches
 * every chunk linked to that exact topicId via metadata.topic_ids (set at index time
 * by markdownChunker.js) instead of guessing via semantic search. No embedding call,
 * no $vectorSearch, no reranking or score thresholds — those exist to handle
 * uncertainty, and there is none here. See RETRIEVAL_TOPIC_LINKING_PLAN.md.
 *
 * chapterMetadataFilter (e.g. { subject, section, chapter_no }) is included as a
 * defense-in-depth scope even though topic_ids are already globally unique — matches
 * this codebase's established layered-safety pattern (see BUG-4's hard DB-level filter).
 */
export const retrieveChunksByTopicId = async (topicId, chapterMetadataFilter = {}) => {
  const query = { 'metadata.topic_ids': topicId };
  for (const [key, value] of Object.entries(chapterMetadataFilter || {})) {
    query[`metadata.${key}`] = value;
  }

  // BUG-5: exclude the 3072-float `embedding` (~24 KB/doc) — this deterministic
  // lookup never reads it (return shape below is id / content / metadata / score).
  const docs = await Chunk.find(query, { embedding: 0 }).lean();

  return docs.map((document) => ({
    id: document.metadata?.chunk_id,
    content: document.pageContent,
    metadata: document.metadata || {},
    score: 1, // deterministic membership match, not a similarity score
  }));
};

/**
 * Main retrieval function — called by Step 5 of the Ask API.
 * Results are cached (L1 memory → L2 Redis) keyed on query + chapter filter + topK.
 * Cache is invalidated automatically when npm run rag:index completes.
 */
export const retrieveRelevantChunks = async (question, options = {}) => {
  const query = String(question || '').trim();

  if (!query) {
    throw new Error('Question cannot be empty.');
  }

  // Wrap the full retrieval pipeline in the retrieval cache.
  // On a cache hit, Atlas vector search + rerank are skipped entirely (~600-1000ms saved).
  return retrievalCache.getOrFetch(query, options, () => _doRetrieve(query, options));
};

// Extracted so retrievalCache.getOrFetch can call it as fetchFn without recursion.
const _doRetrieve = async (query, options) => {
  const { topK, minScore } = normalizeRetrieverOptions(options);
  const candidateTopK = options.candidateTopK || Math.max(topK * 10, 50);
  const embeddings = options.embeddings || getQueryEmbeddings();

  // 1. Embed the user's query (cached: L1 memory → L2 Redis → embedding API).
  //    If the provider falls back to a different vector space, embedQueryWithMeta
  //    flags it; the embedding is used for this request but never cached, and
  //    usedFallback bubbles up so retrievalCache also skips it (see below).
  let usedFallback = false;
  const queryEmbedding = await embeddingCache.getOrFetch(query, async () => {
    if (typeof embeddings.embedQueryWithMeta === 'function') {
      const meta = await embeddings.embedQueryWithMeta(query);
      usedFallback = meta.usedFallback;
      return { embedding: meta.embedding, cacheable: !meta.usedFallback };
    }
    return embeddings.embedQuery(query);
  });

  // 2. Build pre-filter for Vector Search if metadataFilter is provided
  let filter = undefined;
  if (options.metadataFilter && Object.keys(options.metadataFilter).length > 0) {
    filter = {};
    for (const [key, value] of Object.entries(options.metadataFilter)) {
      filter[`metadata.${key}`] = value;
    }
  }

  // 3. Build MongoDB Atlas $vectorSearch Aggregation Pipeline
  const vectorSearchStage = {
    index: "vector_index", // Name of the Atlas Vector Search Index
    path: "embedding",
    queryVector: queryEmbedding,
    numCandidates: candidateTopK, // MUST be >= limit
    limit: candidateTopK,
  };

  if (filter) {
    vectorSearchStage.filter = filter;
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

  // 7. Apply final combined score filter
  const filteredResults = rerankedResults.filter((result) =>
    passesFinalFilter(result, query, options)
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
    // true → query was embedded via the fallback provider (different vector
    // space). retrievalCache uses this to skip persisting these results.
    usedFallback,
  };
};