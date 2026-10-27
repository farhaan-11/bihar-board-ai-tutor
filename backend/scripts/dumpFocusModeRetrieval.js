/**
 * Focus mode ka golden dump.
 *
 * dumpGoldenRetrieval.js ka chhota bhai. Farak sirf itna ki yahan retriever ko
 * focus mode ke do option bhi jaate hain, jo Step 5 chapter khulne par bhejta hai:
 *   metadataFilter + requireTermMatchForLatinQuery
 *
 * Ye script sirf padhti hai. Naya file likhti hai: backend/golden/baseline-focus.json
 * (baseline.json ko chhuti nahi).
 */

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';

import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import { retrieveRelevantChunks } from '../src/rag/retriever.js';
import { createQueryEmbeddings } from '../src/rag/geminiEmbeddings.js';
import { extractQueryTerms } from '../src/rag/reranker.js';
import { Chunk } from '../src/models/chunk.model.js';

// Student ne ye chapter khola hua hai (step5.retrieveContent.js ka focusChapter.metadataFilter)
const metadataFilter = {
  subject: 'Science',
  section: 'Biology',
  chapter_no: 1,
};

const queries = [
  'define nutrition in humans', // jawab isi chapter mein hai
  'human eye function',         // jawab doosre chapter (Physics 2) mein hai
];

// retriever.js ke step 2-4 ki copy, filter ke saath. minScore yahan nahi lagta —
// Atlas ne jo diya, poora chahiye.
const getRawCandidates = async (embedding) => {
  const candidateTopK = 50; // max(topK * 10, 50) with topK = 5

  const filter = {};
  for (const [key, value] of Object.entries(metadataFilter)) {
    filter[`metadata.${key}`] = value;
  }

  const docs = await Chunk.aggregate([
    {
      $vectorSearch: {
        index: 'vector_index',
        path: 'embedding',
        queryVector: embedding,
        numCandidates: candidateTopK,
        limit: candidateTopK,
        filter,
      },
    },
    {
      $project: {
        _id: 0,
        chunk_id: 1,
        metadata: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);

  return docs.map((doc) => ({
    id: doc.chunk_id || doc.metadata?.chunk_id,
    score: doc.score,
  }));
};

const run = async () => {
  // Redis band: baseline hamesha live Atlas se bane, purane saved jawab se nahi.
  delete process.env.REDIS_URL;

  await connectDB();

  const embedder = createQueryEmbeddings();
  const entries = [];

  for (const query of queries) {
    const { embedding, usedFallback } = await embedder.embedQueryWithMeta(query.trim());

    // Gemini fallback = alag vector space. Aisa baseline Python se kabhi match nahi karega.
    if (usedFallback) {
      throw new Error(`Gemini fallback fired for "${query}". Fix OpenAI and run again.`);
    }

    const retrieval = await retrieveRelevantChunks(query, {
      topK: 5,
      metadataFilter,
      requireTermMatchForLatinQuery: true,
      embeddings: { embedQuery: async () => embedding },
    });

    const rawCandidates = await getRawCandidates(embedding);

    entries.push({
      query,
      metadataFilter,
      requireTermMatchForLatinQuery: true,
      queryTerms: extractQueryTerms(query.trim()),
      debug: retrieval.debug,
      rawCandidates,
      finalTop5: retrieval.results,
    });

    console.log(
      `${retrieval.debug.candidateCountBeforeRerank} -> ${retrieval.debug.returnedCount} | raw=${rawCandidates.length} | terms=[${entries.at(-1).queryTerms.join(', ')}] | ${query}`
    );
  }

  const baseline = {
    generatedAt: new Date().toISOString(),
    embeddingModel: 'text-embedding-3-large',
    topK: 5,
    candidateTopK: 50,
    minScore: 0.55,
    mode: 'focus',
    entries,
  };

  const outputPath = new URL('../golden/baseline-focus.json', import.meta.url);
  await mkdir(new URL('../golden/', import.meta.url), { recursive: true });
  await writeFile(outputPath, JSON.stringify(baseline, null, 2), 'utf8');
  console.log(`\nWrote ${entries.length} entries to backend/golden/baseline-focus.json`);

  await disconnectDB();
};

run().catch((error) => {
  console.error(`Focus dump failed: ${error.message}`);
  process.exitCode = 1;
});
