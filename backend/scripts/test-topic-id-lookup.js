/**
 * test-topic-id-lookup.js
 *
 * Regression test for BUG-5 (STAGE1_DONE.md Section C).
 *
 * BUG-5: retrieveChunksByTopicId() (rag/retriever.js) runs the NEXT_STEP
 * deterministic chunk lookup as `Chunk.find({ 'metadata.topic_ids': id }).lean()`
 * with:
 *   1. no index on metadata.topic_ids -> full COLLSCAN of the chunks collection
 *      on every NEXT_STEP (confirmed via explain: totalDocsExamined 629,
 *      totalKeysExamined 0). The metadata.topic_ids entry in the Atlas
 *      "vector_index" is a $vectorSearch filter field only — a plain .find()
 *      cannot use it.
 *   2. no projection -> every matched doc is pulled with its 3072-float
 *      `embedding` field (~24 KB BSON each), which this function never reads
 *      (return shape is id / content / metadata / score:1).
 *
 * Fix (Rule 4 — remove both causes, no guard):
 *   - chunk.model.js declares chunkSchema.index({ 'metadata.topic_ids': 1 })
 *   - retrieveChunksByTopicId passes { embedding: 0 } as the find projection
 *
 * Offline — no DB / network. Stubs Chunk.find to capture the projection arg,
 * and reads the declared schema indexes directly.
 */

import assert from 'node:assert/strict';

import { Chunk } from '../src/models/chunk.model.js';
import { retrieveChunksByTopicId } from '../src/rag/retriever.js';

// ── 1. metadata.topic_ids must be a declared schema index ────────────────────
const declaredIndexes = Chunk.schema.indexes(); // [ [keys, options], ... ]
const hasTopicIdIndex = declaredIndexes.some(
  ([keys]) => keys && keys['metadata.topic_ids'] === 1,
);
assert.ok(
  hasTopicIdIndex,
  'BUG-5: chunk.model.js declares no index on metadata.topic_ids — every ' +
  'NEXT_STEP does a full COLLSCAN of the chunks collection.',
);

// ── 2. retrieveChunksByTopicId must exclude the embedding field ──────────────
const originalFind = Chunk.find;
let capturedProjection = 'NOT_CALLED';
Chunk.find = (_query, projection) => {
  capturedProjection = projection;
  return { lean: async () => [] };
};

try {
  await retrieveChunksByTopicId('science.biology.chapter-01.topic-04');
} finally {
  Chunk.find = originalFind;
}

assert.notEqual(capturedProjection, 'NOT_CALLED', 'Chunk.find was never called.');
assert.ok(
  capturedProjection && capturedProjection.embedding === 0,
  'BUG-5: retrieveChunksByTopicId does not exclude the `embedding` field — ' +
  'each matched chunk is pulled with its 3072-float vector (~24 KB) for a ' +
  'lookup that never reads it.',
);

console.log('\x1b[32m✓ All topic-id-lookup (BUG-5) tests passed\x1b[0m');
