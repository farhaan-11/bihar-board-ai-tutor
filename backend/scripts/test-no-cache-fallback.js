/**
 * test-no-cache-fallback.js
 *
 * Regression test for BUG-6 (PROJECT_STATE.md §4 / STAGE1_DONE.md Section C).
 *
 * BUG-6: embeddingCache.getOrFetch() caches whatever vector fetchFn returns,
 * with no knowledge of which provider produced it. During an OpenAI outage,
 * ResilientEmbeddings.embedQuery() silently falls back to Gemini — a vector in
 * a DIFFERENT vector space. That Gemini vector was then stored:
 *   - in embeddingCache under the OpenAI model's key for 30 days, and
 *   - (downstream) in retrievalCache as the chunks it retrieved, for 24 hours.
 * After OpenAI recovered, retrieval stayed silently corrupted until those TTLs
 * expired (or rag:index ran).
 *
 * Fix (Rule 4 — remove the cause, no read-side guard):
 *   - embeddings.js exposes embedQueryWithMeta() → { embedding, usedFallback }
 *   - embeddingCache.getOrFetch() accepts fetchFn returning
 *     { embedding, cacheable } and skips BOTH L1 and L2 writes when cacheable===false
 *   - retriever.js propagates usedFallback; retrievalCache skips its write too
 *
 * Offline — no DB / network / Redis. Uses a fake fetchFn.
 */

import assert from 'node:assert/strict';

import { embeddingCache } from '../src/cache/embeddingCache.js';
import { retrievalCache } from '../src/cache/retrievalCache.js';

const fakeVector = () => Array.from({ length: 8 }, (_, i) => i / 10);

// ── 1. embeddingCache: a non-cacheable (fallback) result is never stored ─────
{
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { embedding: fakeVector(), cacheable: false };
  };

  const q = 'bug6 fallback embedding must not be cached';
  const a = await embeddingCache.getOrFetch(q, fetchFn);
  const b = await embeddingCache.getOrFetch(q, fetchFn);

  assert.deepEqual(a, fakeVector(), 'getOrFetch must still return the fallback embedding to the caller');
  assert.deepEqual(b, fakeVector(), 'second call must also return a valid embedding');
  assert.equal(
    calls,
    2,
    'BUG-6: fallback embedding was served from cache on the 2nd call — ' +
    'a foreign-vector-space vector is being persisted under the primary key.',
  );
  assert.equal(
    embeddingCache.getStats().l1Size,
    0,
    'BUG-6: fallback embedding landed in the L1 map — it must never be cached.',
  );
}

// ── 2. embeddingCache: a normal (cacheable) result still caches ──────────────
{
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { embedding: fakeVector(), cacheable: true };
  };

  const q = 'bug6 normal embedding still caches';
  await embeddingCache.getOrFetch(q, fetchFn);
  await embeddingCache.getOrFetch(q, fetchFn);

  assert.equal(calls, 1, 'a cacheable embedding must be served from cache on the 2nd call');
}

// ── 3. embeddingCache: legacy plain-array fetchFn still caches (back-compat) ──
{
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return fakeVector();
  };

  const q = 'bug6 legacy plain-array fetchFn still caches';
  await embeddingCache.getOrFetch(q, fetchFn);
  await embeddingCache.getOrFetch(q, fetchFn);

  assert.equal(calls, 1, 'a plain number[] fetchFn result must still be cached (backward compatible)');
}

// ── 4. retrievalCache: a usedFallback result is never stored ─────────────────
{
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { results: [{ id: 'x', content: 'c', metadata: {}, score: 0.9 }], usedFallback: true };
  };

  const q = 'bug6 retrieval derived from fallback must not be cached';
  await retrievalCache.getOrFetch(q, {}, fetchFn);
  await retrievalCache.getOrFetch(q, {}, fetchFn);

  assert.equal(
    calls,
    2,
    'BUG-6: retrieval results derived from a fallback embedding were cached — ' +
    'they stay served for the 24h L2 TTL after OpenAI recovers.',
  );
}

// ── 5. retrievalCache: a normal result still caches ─────────────────────────
{
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return { results: [{ id: 'y', content: 'c', metadata: {}, score: 0.9 }] };
  };

  const q = 'bug6 normal retrieval still caches';
  await retrievalCache.getOrFetch(q, {}, fetchFn);
  await retrievalCache.getOrFetch(q, {}, fetchFn);

  assert.equal(calls, 1, 'a normal retrieval result must be served from cache on the 2nd call');
}

console.log('\x1b[32m✓ All no-cache-fallback (BUG-6) tests passed\x1b[0m');
