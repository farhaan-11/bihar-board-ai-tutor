/**
 * embeddingCache.js
 *
 * Two-layer cache for Gemini embedding vectors.
 *
 * WHY: embedQuery() costs ~200-400ms + Gemini API money on every CONCEPT_QUESTION.
 * Bihar Board students repeat the same topics constantly — high cache hit rate expected.
 *
 * L1 (process memory): Map capped at 1000 entries. ~24KB per entry → ~24MB max footprint.
 * L2 (Redis): Persistent across restarts. ~3ms fetch. Survives for 30 days.
 *
 * Cache key: hash(normalizedQuery + modelName)
 * Embeddings are 100% deterministic for the same input + model, so TTL is long.
 * Switching EMBEDDING_PROVIDER auto-busts old entries (model name is in the key).
 */

import { normalizeQuery, hashString } from './cacheUtils.js';
import { redisGet, redisSetex } from './cacheClient.js';
import { GEMINI_EMBEDDING_MODEL } from '../rag/embeddings.js';

const isDev = process.env.NODE_ENV !== 'production';

const L1 = new Map();
const L1_MAX = 1000;
const L2_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

const buildKey = (normalizedQ) => {
  const hash = hashString(normalizedQ + GEMINI_EMBEDDING_MODEL);
  return `zuno:embed:v1:${hash}`;
};

// Simple FIFO eviction — deletes the oldest inserted entry when Map is full.
const evictL1 = () => {
  const oldest = L1.keys().next().value;
  if (oldest !== undefined) L1.delete(oldest);
};

export const embeddingCache = {
  /**
   * Returns the embedding for `query`, fetching from L1 → L2 → fetchFn in order.
   *
   * fetchFn: async () => number[]
   *        | async () => { embedding: number[], cacheable: boolean }
   *
   * When fetchFn reports `cacheable: false` (the query-time provider fell back
   * to a different vector space — see embeddings.embedQueryWithMeta), the
   * embedding is returned to the caller for this request but is NEVER written to
   * L1 or L2. Caching a foreign-space vector under the primary key would keep
   * corrupting retrieval for the full 30-day TTL after the primary recovered.
   *
   * Guarantees: never throws, always returns a valid non-empty number[].
   * Invalid or corrupted cache entries are silently treated as misses.
   */
  async getOrFetch(query, fetchFn) {
    const t0 = Date.now();
    const normalized = normalizeQuery(query);
    const key = buildKey(normalized);

    // L1 check — zero latency, in-process memory
    if (L1.has(key)) {
      if (isDev) console.log(`[EmbedCache] ✓ L1 HIT  (${Date.now() - t0}ms)  "${query.slice(0, 50)}"`);
      return L1.get(key);
    }

    // L2 check — Redis, ~3ms, persistent across restarts
    const cached = await redisGet(key);
    if (cached) {
      try {
        const embedding = JSON.parse(cached);
        // Validate: must be a non-empty number array (corrupted data → treat as miss)
        if (Array.isArray(embedding) && embedding.length > 0) {
          if (L1.size >= L1_MAX) evictL1();
          L1.set(key, embedding);
          if (isDev) console.log(`[EmbedCache] ✓ L2 HIT  (${Date.now() - t0}ms Redis)  "${query.slice(0, 50)}"`);
          return embedding;
        }
        if (isDev) console.warn(`[EmbedCache] Invalid data in Redis for key ${key} — cache miss`);
      } catch {
        // JSON.parse failed — corrupted Redis entry, fall through to re-fetch
        if (isDev) console.warn(`[EmbedCache] Corrupted Redis entry for key ${key} — cache miss`);
      }
    }

    // Cache miss — call embedding API (provider depends on EMBEDDING_PROVIDER env var)
    const embedStart = Date.now();
    if (isDev) console.log(`[EmbedCache] ✗ MISS — calling embedding API: "${query.slice(0, 50)}"`);
    const fetched = await fetchFn();
    if (isDev) console.log(`[EmbedCache]   done in ${Date.now() - embedStart}ms`);

    // fetchFn may return a bare number[] (always cacheable) or
    // { embedding, cacheable } (cacheable:false → provider fell back).
    const embedding = Array.isArray(fetched) ? fetched : fetched?.embedding;
    const cacheable = Array.isArray(fetched) ? true : fetched?.cacheable !== false;

    // Only cache a valid non-empty embedding — never cache an error or empty result
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return embedding; // Return as-is; let the caller decide what to do
    }

    // Fallback-provider vector: use it for this request, but never persist it.
    if (!cacheable) {
      if (isDev) console.warn(`[EmbedCache] ⚠️  not caching fallback-provider embedding: "${query.slice(0, 50)}"`);
      return embedding;
    }

    // Store in L1
    if (L1.size >= L1_MAX) evictL1();
    L1.set(key, embedding);

    // Store in L2 fire-and-forget — don't block the response on Redis write latency
    redisSetex(key, L2_TTL, JSON.stringify(embedding)).catch(() => {});

    return embedding;
  },

  getStats: () => ({ l1Size: L1.size, l1Max: L1_MAX }),
};
