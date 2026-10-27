import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';

import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import { retrieveRelevantChunks } from '../src/rag/retriever.js';
import { createQueryEmbeddings } from '../src/rag/geminiEmbeddings.js';
import { extractQueryTerms } from '../src/rag/reranker.js';
import { Chunk } from '../src/models/chunk.model.js';

const queries = [
  // 6 simple English
  'what is photosynthesis',
  'human eye function',
  'what is asexual reproduction',
  'explain human digestion',
  'what is placenta',
  'define nutrition in humans',

  // 6 Hinglish
  'photosynthesis kya hai',
  'heart ka function kya hai',
  'placenta ka function kya hai',
  'asexual reproduction kya hota hai',
  'nutrition in humans kya hai',
  'human digestion explain karo',

  // 3 Devanagari
  'प्रकाश संश्लेषण क्या है',
  'हृदय का कार्य क्या है',
  'रक्त का कार्य क्या है',

  // 3 function-intent
  'blood ka kaam kya hai',
  'arteries ka function kya hai',
  'kidney ka kaam kya hai',

  // 2 jo fail hone chahiye
  'capital of France',
  'who won the cricket world cup',
];

// retriever.js ke step 3-4 ki exact copy. Farak sirf itna: yahan minScore nahi lagta,
// kyunki hum Atlas ke saare 50 raw results chahte hain (filter Python compare mein lagega).
const getRawCandidates = async (embedding) => {
  const candidateTopK = 50; // max(topK * 10, 50) with topK = 5

  const docs = await Chunk.aggregate([
    {
      $vectorSearch: {
        index: 'vector_index',
        path: 'embedding',
        queryVector: embedding,
        numCandidates: candidateTopK,
        limit: candidateTopK,
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
    // Query ek hi baar embed hogi. Yahi vector retriever ko bhi milega
    // (aur aage rawCandidates ke liye bhi), taaki dono ek hi sach se bane.
    const { embedding, usedFallback } = await embedder.embedQueryWithMeta(query.trim());

    // Gemini fallback = alag vector space. Aisa baseline Python se kabhi match nahi karega.
    if (usedFallback) {
      throw new Error(`Gemini fallback fired for "${query}". Fix OpenAI and run again.`);
    }

    const retrieval = await retrieveRelevantChunks(query, {
      topK: 5,
      embeddings: { embedQuery: async () => embedding },
    });

    const rawCandidates = await getRawCandidates(embedding);

    entries.push({
      query,
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
    entries,
  };

  const outputPath = new URL('../golden/baseline.json', import.meta.url);
  await mkdir(new URL('../golden/', import.meta.url), { recursive: true });
  await writeFile(outputPath, JSON.stringify(baseline, null, 2), 'utf8');
  console.log(`\nWrote ${entries.length} entries to backend/golden/baseline.json`);

  await disconnectDB();
};

run().catch((error) => {
  console.error(`Golden dump failed: ${error.message}`);
  process.exitCode = 1;
});
