/**
 * embeddings.js
 *
 * Embedding provider for indexing AND query time.
 *
 * NEW STRATEGY (2026-06-25):
 *   Primary  : OpenAI text-embedding-3-large (3072 dims) — higher quality, lower variance
 *   Fallback : Gemini gemini-embedding-001 (3072 dims) — only when OpenAI is hard-down
 *
 * Both providers output 3072-dim vectors → MongoDB Atlas Vector Search index does NOT
 * need reconfiguration when fallback fires.
 *
 * ⚠️ CRITICAL CAVEAT on the fallback:
 *   OpenAI and Gemini embeddings live in DIFFERENT vector spaces. A query embedded
 *   with one provider will NOT meaningfully match documents embedded with the other.
 *   Cosine similarity becomes noise.
 *
 *   Therefore:
 *     - QUERY-time fallback is allowed (degraded results > total outage), but flagged
 *       behind EMBEDDING_FALLBACK_ENABLED=true and logged loudly so it can be detected.
 *     - INDEXING-time fallback is NEVER allowed — would produce mixed-provider chunks
 *       in MongoDB and break retrieval silently. Indexing throws on OpenAI exhaustion.
 *
 *   The OPERATIONAL RULE: if OpenAI is dying, take the system to maintenance mode,
 *   do NOT rely on fallback for production traffic for more than a short window.
 *
 * Provider selection legacy:
 *   EMBEDDING_PROVIDER=openai  (DEFAULT now) → OpenAI primary + optional Gemini fallback
 *   EMBEDDING_PROVIDER=google             → Gemini primary only (no fallback) — kept for
 *                                           emergency rollback if OpenAI billing fails
 *
 * IMPORTANT: indexing and runtime queries must always use the SAME primary provider.
 * If you switch EMBEDDING_PROVIDER, re-run `npm run rag:index`.
 */

import { TaskType } from '@google/generative-ai';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { OpenAIEmbeddings } from '@langchain/openai';

const PROVIDER = (process.env.EMBEDDING_PROVIDER || 'openai').toLowerCase();
const FALLBACK_ENABLED = String(process.env.EMBEDDING_FALLBACK_ENABLED || 'true').toLowerCase() === 'true';

export const GEMINI_EMBEDDING_MODEL =
  PROVIDER === 'google' ? 'gemini-embedding-001' : 'text-embedding-3-large';

export const EMBEDDING_PROVIDER =
  PROVIDER === 'google' ? 'google-generative-ai-langchain' : 'openai';

// ─── Retry config ────────────────────────────────────────────────────────────

const MAX_PRIMARY_ATTEMPTS = 3;            // OpenAI primary: 3 attempts before fallback/throw
const BASE_BACKOFF_MS = 1000;              // 1s, 2s, 4s exponential
const MAX_FALLBACK_ATTEMPTS = 3;           // Gemini fallback: 3 attempts before throw

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableEmbeddingError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('[429') ||                  // rate limit
    message.includes('[500') ||                  // server error
    message.includes('[502') ||
    message.includes('[503') ||
    message.includes('[504') ||
    message.includes('fetch failed') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('timeout')
  );
};

// ─── Google / Gemini primitives (used as fallback OR primary in google mode) ─

class SequentialGoogleGenerativeAIEmbeddings extends GoogleGenerativeAIEmbeddings {
  async embedQuery(document) {
    for (let attempt = 1; attempt <= MAX_FALLBACK_ATTEMPTS; attempt += 1) {
      try {
        return await super.embedQuery(document);
      } catch (error) {
        if (!isRetryableEmbeddingError(error) || attempt === MAX_FALLBACK_ATTEMPTS) {
          throw error;
        }
        await wait(BASE_BACKOFF_MS * attempt);
      }
    }
    throw new Error('Gemini query embedding failed after retry attempts.');
  }

  // In google-only mode Gemini IS the primary provider — one vector space, safe
  // to cache. usedFallback is always false here. (See ResilientEmbeddings for
  // the OpenAI-primary case where this actually matters.)
  async embedQueryWithMeta(document) {
    return { embedding: await this.embedQuery(document), usedFallback: false };
  }

  async embedOneDocument(document, documentNumber) {
    for (let attempt = 1; attempt <= MAX_FALLBACK_ATTEMPTS; attempt += 1) {
      try {
        const embedding = await super.embedQuery(document);
        if (Array.isArray(embedding) && embedding.length > 0) {
          return embedding;
        }
      } catch (error) {
        if (!isRetryableEmbeddingError(error) || attempt === MAX_FALLBACK_ATTEMPTS) {
          throw error;
        }
      }
      if (attempt < MAX_FALLBACK_ATTEMPTS) {
        await wait(BASE_BACKOFF_MS * attempt);
      }
    }
    throw new Error(
      `Gemini embeddings returned an empty/failed vector for document ${documentNumber}.`
    );
  }

  async embedDocuments(documents) {
    const embeddings = [];
    for (const [index, document] of documents.entries()) {
      embeddings.push(await this.embedOneDocument(document, index + 1));
    }
    return embeddings;
  }
}

const getGoogleApiKey = () => {
  const isUsableApiKey = (value) =>
    typeof value === 'string' &&
    value.trim().length > 10 &&
    !value.includes('your_') &&
    value !== '...';

  const googleApiKey = isUsableApiKey(process.env.GOOGLE_API_KEY)
    ? process.env.GOOGLE_API_KEY
    : undefined;
  const geminiApiKey = isUsableApiKey(process.env.GEMINI_API_KEY)
    ? process.env.GEMINI_API_KEY
    : undefined;
  const apiKey = googleApiKey || geminiApiKey;

  if (!apiKey) {
    throw new Error(
      'GOOGLE_API_KEY (or GEMINI_API_KEY fallback) is missing. Required for Gemini fallback embeddings.'
    );
  }

  if (!googleApiKey && geminiApiKey) {
    process.env.GOOGLE_API_KEY = geminiApiKey;
  }

  return apiKey;
};

const createGoogleEmbeddings = (taskType) =>
  new SequentialGoogleGenerativeAIEmbeddings({
    apiKey: getGoogleApiKey(),
    modelName: 'gemini-embedding-001',
    taskType,
    maxConcurrency: 1,
    maxRetries: 0,
  });

// ─── OpenAI primitives ───────────────────────────────────────────────────────

const createRawOpenAIEmbeddings = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length < 10 || apiKey.includes('your_')) {
    throw new Error('OPENAI_API_KEY is missing or invalid. Required as the primary embedding provider.');
  }
  return new OpenAIEmbeddings({
    apiKey,
    model: 'text-embedding-3-large',
    dimensions: 3072,
    maxRetries: 0, // we handle retries explicitly below
  });
};

// ─── Resilient wrapper: OpenAI primary with retry + optional Gemini fallback ─

class ResilientEmbeddings {
  /**
   * @param {object} opts
   * @param {boolean} opts.allowFallback  When true, fall back to Gemini after primary exhaustion.
   *                                      Only safe for QUERY-time. NEVER pass true for document/index time.
   * @param {TaskType} opts.fallbackTaskType  Gemini task type to use if fallback fires.
   */
  constructor({ allowFallback, fallbackTaskType }) {
    this.primary = createRawOpenAIEmbeddings();
    this.allowFallback = allowFallback && FALLBACK_ENABLED;
    this.fallbackTaskType = fallbackTaskType;
  }

  async _runWithRetry(primaryFn) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_PRIMARY_ATTEMPTS; attempt += 1) {
      try {
        return await primaryFn();
      } catch (error) {
        lastError = error;
        const retryable = isRetryableEmbeddingError(error);
        if (!retryable || attempt === MAX_PRIMARY_ATTEMPTS) break;
        const backoff = BASE_BACKOFF_MS * (2 ** (attempt - 1)); // 1s, 2s, 4s
        console.warn(`[Embed] OpenAI attempt ${attempt}/${MAX_PRIMARY_ATTEMPTS} failed (${error.message}). Retry in ${backoff}ms.`);
        await wait(backoff);
      }
    }
    throw lastError;
  }

  /**
   * Embeds `text` and reports which vector space the result lives in.
   *
   * @returns {Promise<{ embedding: number[], usedFallback: boolean }>}
   *   usedFallback === true  → this vector came from Gemini, NOT the primary
   *   OpenAI index's space. Callers MUST NOT persist it (embedding cache,
   *   retrieval cache) — after OpenAI recovers it would keep poisoning
   *   retrieval until the TTL expired. Use it for this one live request only.
   */
  async embedQueryWithMeta(text) {
    try {
      const embedding = await this._runWithRetry(() => this.primary.embedQuery(text));
      return { embedding, usedFallback: false };
    } catch (primaryError) {
      if (!this.allowFallback) throw primaryError;
      console.error(`[Embed] ⚠️  OpenAI EXHAUSTED for query: ${primaryError.message}`);
      console.error('[Embed] ⚠️  Falling back to GEMINI for this query. Retrieval quality WILL DEGRADE — OpenAI and Gemini live in different vector spaces. This vector will NOT be cached. Investigate OpenAI billing/network NOW.');
      const fallback = createGoogleEmbeddings(this.fallbackTaskType || TaskType.RETRIEVAL_QUERY);
      return { embedding: await fallback.embedQuery(text), usedFallback: true };
    }
  }

  async embedQuery(text) {
    return (await this.embedQueryWithMeta(text)).embedding;
  }

  async embedDocuments(texts) {
    // NEVER fall back during document/index embedding. A mixed-provider index in MongoDB
    // is a silent disaster — different vector spaces means cosine similarity becomes noise.
    // Surface the failure so the operator can fix OpenAI and re-run `npm run rag:index`.
    return await this._runWithRetry(() => this.primary.embedDocuments(texts));
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Use this when embedding content chunks during indexing (npm run rag:index).
 * NO fallback — see embedDocuments comment above.
 */
export const createDocumentEmbeddings = () => {
  if (PROVIDER === 'google') {
    return createGoogleEmbeddings(TaskType.RETRIEVAL_DOCUMENT);
  }
  return new ResilientEmbeddings({
    allowFallback: false,
    fallbackTaskType: TaskType.RETRIEVAL_DOCUMENT,
  });
};

/**
 * Use this when embedding the student's search query at runtime.
 * Falls back to Gemini after OpenAI retry exhaustion (degraded mode, loud warning).
 */
export const createQueryEmbeddings = () => {
  if (PROVIDER === 'google') {
    return createGoogleEmbeddings(TaskType.RETRIEVAL_QUERY);
  }
  return new ResilientEmbeddings({
    allowFallback: true,
    fallbackTaskType: TaskType.RETRIEVAL_QUERY,
  });
};
