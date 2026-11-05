// Safety net for the decider. When it says GREETING or OUT_OF_CONTEXT, we still check the
// message against the indexed chapters (top-1 vector search). If it matches well, the caller
// upgrades the intent to CONCEPT_QUESTION.
// Any error returns { fired: false }, so a failed check never blocks the pipeline.

import { Chunk } from '../models/chunk.model.js';
import { createQueryEmbeddings } from '../rag/geminiEmbeddings.js';

// Default is 0.70, tunable through SAFETY_NET_SIMILARITY_THRESHOLD.
// This check gets the decider's English translation, not the student's raw Hinglish.
// English: real Class 10 questions score 0.71-0.85, out-of-scope topics score 0.66 or less.
// Raw Hinglish scored only 0.59-0.69, so it never fired at all.
// Do not lower this to 0.65: "Maths ke questions solve karo" scores 0.683 and would fire wrongly.
const getSimilarityThreshold = () =>
  parseFloat(process.env.SAFETY_NET_SIMILARITY_THRESHOLD ?? '0.70');

/**
 * Checks if a query matches any indexed chapter content.
 *
 * @param {string} query - The decider's English translation of the student's message
 * @returns {Promise<{ score: number, fired: boolean }>}
 *   score - top-1 cosine similarity (0-1)
 *   fired - true if score >= threshold, so the caller should upgrade the intent
 */
export const checkSyllabusMatch = async (query) => {
  try {
    const embeddings = createQueryEmbeddings();
    const queryEmbedding = await embeddings.embedQuery(String(query || ''));

    const pipeline = [
      {
        $vectorSearch: {
          index: "vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: 5,
          limit: 1
        }
      },
      {
        $project: {
          _id: 0,
          score: { $meta: "vectorSearchScore" }
        }
      }
    ];

    const results = await Chunk.aggregate(pipeline);
    const score = results?.[0]?.score ?? 0;
    const threshold = getSimilarityThreshold();

    return { score, fired: score >= threshold };
  } catch (err) {
    console.warn('[SafetyNet] Probe failed, skipping override:', err.message);
    return { score: 0, fired: false };
  }
};
