/**
 * indexPipeline.js
 *
 * The RAG indexing pipeline — run via: npm run rag:index
 *
 * WHAT IT DOES (in order):
 *   1. Connects to MongoDB Atlas
 *   2. Load all Markdown study files from the data directory
 *   3. Split each file into chunks using the markdown chunker
 *   4. Generate ALL embeddings (with retry on rate limit)
 *   5. Only then delete old chunks — old store is safe if step 4 fails
 *   6. Insert all new chunks into MongoDB
 *
 * Run this script whenever study content changes.
 * This file is NOT part of the runtime server — it runs offline only.
 */

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Document } from '@langchain/core/documents';

import {
  createDocumentEmbeddings,
  EMBEDDING_PROVIDER,
  GEMINI_EMBEDDING_MODEL,
} from './embeddings.js';
import { createMarkdownChunks } from './markdownChunker.js';
import { loadMarkdownDocuments } from './markdownLoader.js';

import { connectDB, disconnectDB } from '../db/mongooseClient.js';
import { Chunk } from '../models/chunk.model.js';
import { bumpRagVersion } from '../cache/retrievalCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/rag/ → backend root (2 levels up)
const backendRoot = path.resolve(__dirname, '..', '..');
const baseDataDir = path.resolve(backendRoot, '..', 'data', 'class-10', 'science');

const getMetadataValue = (metadata, key, fallback = 'Unknown') => {
  const value = metadata?.[key];
  return value === undefined || value === null || value === '' ? fallback : value;
};

// Each chunk's page content includes a structured header so the LLM has full context
const buildLangChainPageContent = (chunk) => {
  const metadata = chunk.metadata || {};
  return `Bihar Board Class 10 ${getMetadataValue(metadata, 'subject')}
Section: ${getMetadataValue(metadata, 'section')}
Chapter: ${getMetadataValue(metadata, 'chapter_title')}
Topic/Heading: ${getMetadataValue(metadata, 'heading_path')}

Content:
${chunk.pageContent}`;
};

const createLangChainDocument = (chunk) =>
  new Document({
    id: chunk.id,
    pageContent: buildLangChainPageContent(chunk),
    metadata: {
      // Spread chunker metadata LAST so its `originalText` (clean text without [Context]
      // preamble, populated in markdownChunker.createChunk) wins. The previous version
      // overwrote it with `chunk.pageContent` (which carries the [Context]+[Content]
      // preamble), defeating the purpose of having a separate clean field for embedding.
      chunk_id: chunk.id,
      ...chunk.metadata,
    },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse "Please retry in 47.3s" from Gemini 429 error body
const parseRetryDelayMs = (message) => {
  const match = message.match(/retry in (\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : null;
};

// Daily quota errors cannot be retried — must wait until tomorrow
const isDailyQuota = (message) =>
  message.includes('PerDay') || message.includes('per_day') || message.includes('RequestsPerDay');

// Embed one batch with up to maxRetries automatic retries on transient 429s.
// Throws immediately on daily quota exhaustion with a clear human-readable message.
const embedBatchWithRetry = async (embeddings, batchTexts, batchNum, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await embeddings.embedDocuments(batchTexts);
    } catch (err) {
      const is429 = err.message.includes('429') || err.message.includes('Too Many Requests');

      if (is429 && isDailyQuota(err.message)) {
        console.error('\n========================================');
        console.error('DAILY QUOTA EXHAUSTED — cannot continue.');
        console.error('Gemini free tier: 1000 embedding requests/day.');
        console.error('OLD chunks are still intact in MongoDB (safe to use until tomorrow).');
        console.error('Re-run tomorrow:  npm run rag:index');
        console.error('========================================\n');
        throw err;
      }

      if (is429 && attempt < maxRetries) {
        const suggested = parseRetryDelayMs(err.message);
        // Add 5s buffer on top of Gemini's suggested delay; cap at 2 minutes
        const waitMs = Math.min((suggested ?? 30_000 * attempt) + 5_000, 120_000);
        console.log(`  [Batch ${batchNum}] Rate limit — attempt ${attempt}/${maxRetries}. Waiting ${Math.ceil(waitMs / 1000)}s...`);
        await sleep(waitMs);
        continue;
      }

      // Non-429 or out of retries
      throw err;
    }
  }
};

const runIndexPipeline = async () => {
  console.log('Starting RAG indexing pipeline...');
  console.log(`Source directory: ${baseDataDir}`);

  // 1. Connect to MongoDB
  await connectDB();

  const documents = await loadMarkdownDocuments(baseDataDir);
  console.log(`Documents loaded: ${documents.length}`);

  const chunks = await createMarkdownChunks(documents);
  console.log(`Chunks generated: ${chunks.length}`);

  const langChainDocuments = chunks.map(createLangChainDocument);
  console.log(`LangChain documents prepared: ${langChainDocuments.length}`);
  console.log(`Embedding provider: ${EMBEDDING_PROVIDER}`);
  console.log(`Embedding model: ${GEMINI_EMBEDDING_MODEL}`);

  // 2. Generate ALL embeddings BEFORE deleting old chunks.
  //    If this step fails (e.g. daily quota), the existing vector store stays intact.
  const embeddings = createDocumentEmbeddings();
  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(langChainDocuments.length / BATCH_SIZE);
  const allChunksToInsert = [];

  console.log(`\nGenerating embeddings (${langChainDocuments.length} chunks, batch size ${BATCH_SIZE})...`);
  console.log('Old chunks are preserved in MongoDB until all embeddings succeed.\n');

  for (let i = 0; i < langChainDocuments.length; i += BATCH_SIZE) {
    const batch = langChainDocuments.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`Embedding batch ${batchNum}/${totalBatches} (chunks ${i + 1}–${Math.min(i + BATCH_SIZE, langChainDocuments.length)})...`);

    // Embed metadata.originalText (clean content, no [Context] preamble — populated by
    // markdownChunker.createChunk). doc.pageContent carries a duplicated metadata header
    // (Board/Section/Chapter/Topic) that is near-identical across chunks of the same
    // chapter — embedding that header inflates similarity floor and weakens discrimination
    // between relevant and unrelated chapters. The full preamble version is still stored
    // in MongoDB (in chunk.pageContent) so the tutor LLM gets rich context at retrieval.
    // If originalText is missing for any reason, fall back to pageContent so indexing
    // does not silently break (degraded discrimination, but functional).
    const batchTexts = batch.map((doc) => doc.metadata.originalText || doc.pageContent);
    const batchEmbeddings = await embedBatchWithRetry(embeddings, batchTexts, batchNum);

    const batchChunks = batch.map((doc, idx) => ({
      chunk_id: doc.metadata.chunk_id,
      pageContent: doc.pageContent,
      embedding: batchEmbeddings[idx],
      metadata: doc.metadata,
      chapterId: doc.metadata.chapter_id,
    }));
    allChunksToInsert.push(...batchChunks);

    if (i + BATCH_SIZE < langChainDocuments.length) {
      console.log('  Sleeping 10s to stay within rate limits...');
      await sleep(10_000);
    }
  }

  // 3. All embeddings ready — now safely swap in the new chunks
  console.log(`\nAll ${allChunksToInsert.length} embeddings generated. Swapping into MongoDB...`);
  await Chunk.deleteMany({});
  console.log('Old chunks deleted.');
  await Chunk.insertMany(allChunksToInsert, { ordered: false });

  console.log(`\nIndexing complete. ${allChunksToInsert.length} vectors saved to MongoDB.`);

  // 4. Bump retrieval cache version so running servers clear stale entries within 5 minutes
  await bumpRagVersion();

  // 5. Disconnect gracefully
  await disconnectDB();
};

runIndexPipeline().catch(async (error) => {
  console.error(`Indexing failed: ${error.message}`);
  try { await disconnectDB(); } catch (e) {}
  process.exitCode = 1;
});
