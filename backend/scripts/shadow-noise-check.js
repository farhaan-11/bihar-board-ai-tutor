/**
 * shadow-noise-check.js
 *
 * Ek hi sawaal ko Node pe aur Python pe kai baar chalata hai, aur dekhta hai ki
 * har taraf ka score khud kitna hilta hai. Agar Node apne aap se bhi hil raha hai,
 * to Node vs Python ka chhota farak Python ki galti nahi hai, API ka shor hai.
 * Cache band, sirf padhta hai.
 *
 * Chalane ka tareeka (backend folder se):
 *   node scripts/shadow-noise-check.js S011 S021 K05
 *   node scripts/shadow-noise-check.js --runs 8 S011
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import { retrieveRelevantChunks } from '../src/rag/retriever.js';
import { retrieveFromPython } from '../src/rag/pythonRetrieverClient.js';
import { retrievalCache } from '../src/cache/retrievalCache.js';
import { embeddingCache } from '../src/cache/embeddingCache.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const BANK_FILE = path.resolve(scriptDir, '../test/shadow-queries.json');

// bulk script jaisa: cache band
retrievalCache.getOrFetch = async (query, options, fetchFn) => {
  return fetchFn();
};
embeddingCache.getOrFetch = async (query, fetchFn) => {
  const fetched = await fetchFn();
  if (Array.isArray(fetched)) {
    return fetched;
  }
  return fetched.embedding;
};

// command line: --runs N, baaki sab sawaal ke ID
let runs = 5;
const ids = [];
const argList = process.argv.slice(2);
for (let i = 0; i < argList.length; i++) {
  if (argList[i] === '--runs') {
    runs = Number(argList[i + 1]);
    i++;
  } else {
    ids.push(argList[i]);
  }
}

const bank = JSON.parse(await readFile(BANK_FILE, 'utf8'));
const records = [];
for (const id of ids) {
  let found = null;
  for (const record of bank.queries) {
    if (record.id === id) found = record;
  }
  if (!found) {
    console.error(`Bank mein ye ID nahi hai: ${id}`);
    process.exit(1);
  }
  records.push(found);
}

const show = (numbers) => {
  const parts = [];
  for (const n of numbers) {
    parts.push(n.toFixed(4));
  }
  return parts.join(' ');
};

const spreadOf = (numbers) => {
  let low = numbers[0];
  let high = numbers[0];
  for (const n of numbers) {
    if (n < low) low = n;
    if (n > high) high = n;
  }
  return high - low;
};

await connectDB();

for (const record of records) {
  const nodeOptions = { topK: record.topK };
  const pythonOptions = { topK: record.topK };
  if (record.mode === 'focus') {
    nodeOptions.metadataFilter = record.metadataFilter;
    nodeOptions.requireTermMatchForLatinQuery = true;
    pythonOptions.metadataFilter = record.metadataFilter;
  }

  // har chunk ke liye: kis run mein kitna vector score aur finalScore aaya
  const nodeScores = {};
  const pythonScores = {};
  const nodeOrders = [];
  const pythonOrders = [];
  // reranker ne kitna boost diya (aakhri run ka)
  const nodeDebug = {};
  const pythonDebug = {};

  const readDebug = (item) => {
    const info = item.rerankDebug || {};
    const names = [];
    for (const match of info.matchedTerms || []) {
      names.push(match.term + ':' + match.fields.join('+'));
    }
    return {
      keywordBoost: info.keywordBoost || 0,
      intentBoost: info.intentBoost || 0,
      diversityPenalty: info.diversityPenalty || 0,
      terms: names.join(','),
    };
  };

  for (let run = 0; run < runs; run++) {
    const nodeResponse = await retrieveRelevantChunks(record.query, nodeOptions);
    const pythonResponse = await retrieveFromPython(record.query, pythonOptions);

    const nodeOrder = [];
    for (const item of nodeResponse.results) {
      nodeOrder.push(item.id);
      if (!nodeScores[item.id]) nodeScores[item.id] = { vector: [], final: [] };
      nodeScores[item.id].vector.push(item.score);
      nodeScores[item.id].final.push(item.finalScore);
      nodeDebug[item.id] = readDebug(item);
    }
    nodeOrders.push(nodeOrder.join(' > '));

    const pythonOrder = [];
    for (const item of pythonResponse.results) {
      pythonOrder.push(item.id);
      if (!pythonScores[item.id]) pythonScores[item.id] = { vector: [], final: [] };
      pythonScores[item.id].vector.push(item.score);
      pythonScores[item.id].final.push(item.finalScore);
      pythonDebug[item.id] = readDebug(item);
    }
    pythonOrders.push(pythonOrder.join(' > '));
  }

  console.log(`\n=== ${record.id}  ${record.query}`);

  const allIds = Object.keys(nodeScores);
  for (const id of Object.keys(pythonScores)) {
    if (allIds.indexOf(id) === -1) allIds.push(id);
  }

  for (const id of allIds) {
    console.log(`  ${id}`);
    if (nodeScores[id]) {
      console.log(`    Node   vector: ${show(nodeScores[id].vector)}   (hilna ${spreadOf(nodeScores[id].vector).toFixed(4)})`);
      console.log(`    Node   final : ${show(nodeScores[id].final)}   (hilna ${spreadOf(nodeScores[id].final).toFixed(4)})`);
    }
    if (pythonScores[id]) {
      console.log(`    Python vector: ${show(pythonScores[id].vector)}   (hilna ${spreadOf(pythonScores[id].vector).toFixed(4)})`);
      console.log(`    Python final : ${show(pythonScores[id].final)}   (hilna ${spreadOf(pythonScores[id].final).toFixed(4)})`);
    }
    if (nodeDebug[id] && pythonDebug[id]) {
      console.log(`    Node   rerank: keyword ${nodeDebug[id].keywordBoost.toFixed(4)}  intent ${nodeDebug[id].intentBoost.toFixed(4)}  diversity ${nodeDebug[id].diversityPenalty}  terms ${nodeDebug[id].terms}`);
      console.log(`    Python rerank: keyword ${pythonDebug[id].keywordBoost.toFixed(4)}  intent ${pythonDebug[id].intentBoost.toFixed(4)}  diversity ${pythonDebug[id].diversityPenalty}  terms ${pythonDebug[id].terms}`);
    }
  }

  // order kitni alag-alag tarah ka aaya
  const nodeDistinct = {};
  for (const o of nodeOrders) nodeDistinct[o] = (nodeDistinct[o] || 0) + 1;
  const pythonDistinct = {};
  for (const o of pythonOrders) pythonDistinct[o] = (pythonDistinct[o] || 0) + 1;
  console.log(`  Node order ke roop  : ${Object.keys(nodeDistinct).length}`);
  console.log(`  Python order ke roop: ${Object.keys(pythonDistinct).length}`);
}

await disconnectDB();
process.exit(0);
