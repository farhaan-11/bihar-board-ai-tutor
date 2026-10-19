/**
 * shadow-bulk-compare.js
 *
 * Har sawaal Node ke retriever ko aur Python service ko bhejta hai, aur dono ke top-k milata hai.
 * Cache band hai, dono taraf taaza jawab aata hai. Sirf padhta hai, Atlas ya Redis mein kuch nahi likhta.
 *
 * Chalane ka tareeka (backend folder se):
 *   node scripts/shadow-bulk-compare.js --limit 5          pehle chhota trial
 *   node scripts/shadow-bulk-compare.js --kind trap        sirf jis kind ka naam "trap" se shuru ho
 *   node scripts/shadow-bulk-compare.js --out <folder>     report kahan rakhni hai
 *
 * Python service chalu honi chahiye (PYTHON_RETRIEVER_URL, INTERNAL_API_KEY .env se aate hain).
 */

import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectDB, disconnectDB } from '../src/db/mongooseClient.js';
import { retrieveRelevantChunks } from '../src/rag/retriever.js';
import { retrieveFromPython } from '../src/rag/pythonRetrieverClient.js';
import { retrievalCache } from '../src/cache/retrievalCache.js';
import { embeddingCache } from '../src/cache/embeddingCache.js';

const SCORE_LIMIT = 0.0001; // isse kam farak = same (Parity Rule: 4 decimal)

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const BANK_FILE = path.resolve(scriptDir, '../test/shadow-queries.json');

// ---------- cache band karna (sirf is script ke process mein) ----------
// Redis mein na padhna hai na likhna hai, aur jawab har baar taaza chahiye.
const turnOffCaches = () => {
  retrievalCache.getOrFetch = async (query, options, fetchFn) => {
    return fetchFn();
  };

  // fetchFn kabhi seedhi list deta hai, kabhi { embedding, cacheable }. Dono mein se list nikaalni hai.
  embeddingCache.getOrFetch = async (query, fetchFn) => {
    const fetched = await fetchFn();
    if (Array.isArray(fetched)) {
      return fetched;
    }
    return fetched.embedding;
  };
};

// ---------- command line ----------
const readArgs = () => {
  const args = { limit: 0, kind: '', self: false, out: path.resolve(scriptDir, '../test') };
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '--self') {
      args.self = true;   // A/A test: doosri taraf bhi Node, Python nahi
    } else if (list[i] === '--limit') {
      args.limit = Number(list[i + 1]);
      i++;
    } else if (list[i] === '--kind') {
      args.kind = list[i + 1];
      i++;
    } else if (list[i] === '--out') {
      args.out = path.resolve(list[i + 1]);
      i++;
    }
  }
  return args;
};

// ---------- comparison ----------
const getIds = (results) => {
  const ids = [];
  for (const item of results) {
    ids.push(item.id);
  }
  return ids;
};

const compareResults = (nodeResults, pythonResults) => {
  const nodeIds = getIds(nodeResults);
  const pythonIds = getIds(pythonResults);

  const onlyNode = [];
  for (const id of nodeIds) {
    if (pythonIds.indexOf(id) === -1) onlyNode.push(id);
  }
  const onlyPython = [];
  for (const id of pythonIds) {
    if (nodeIds.indexOf(id) === -1) onlyPython.push(id);
  }

  let label = 'PASS';
  let maxGap = 0;

  if (nodeIds.length !== pythonIds.length) {
    label = 'COUNT_DIFF';
  } else if (onlyNode.length > 0 || onlyPython.length > 0) {
    label = 'ID_DIFF';
  } else if (nodeIds.join(',') !== pythonIds.join(',')) {
    label = 'ORDER_DIFF';
  } else {
    for (let i = 0; i < nodeResults.length; i++) {
      const gap = Math.abs(nodeResults[i].finalScore - pythonResults[i].finalScore);
      if (Number.isNaN(gap)) {
        maxGap = Infinity;
      } else if (gap > maxGap) {
        maxGap = gap;
      }
    }
    if (maxGap >= SCORE_LIMIT) label = 'SCORE_DIFF';
  }

  return { label, maxGap, onlyNode, onlyPython };
};

const shortList = (results) => {
  const list = [];
  for (const item of results) {
    list.push({ id: item.id, score: item.score, finalScore: item.finalScore });
  }
  return list;
};

// ---------- ek sawaal ----------
const runOne = async (record, args) => {
  const row = {
    id: record.id,
    kind: record.kind,
    query: record.query,
    mode: record.mode,
    topK: record.topK,
    metadataFilter: record.metadataFilter,
    why: record.why || null,
    sourceChunkId: record.sourceChunkId || null,
  };

  // Node ke getRetrieverOptions jaisa: focus mode mein filter ke saath term-match wala switch bhi on
  const nodeOptions = { topK: record.topK };
  const pythonOptions = { topK: record.topK };
  if (record.mode === 'focus') {
    nodeOptions.metadataFilter = record.metadataFilter;
    nodeOptions.requireTermMatchForLatinQuery = true;
    pythonOptions.metadataFilter = record.metadataFilter;
  }

  let nodeResponse = null;
  const nodeStart = performance.now();
  try {
    nodeResponse = await retrieveRelevantChunks(record.query, nodeOptions);
  } catch (error) {
    row.nodeError = error.message;
  }
  row.nodeMs = Math.round(performance.now() - nodeStart);

  let pythonResponse = null;
  const pythonStart = performance.now();
  try {
    if (args.self) {
      // A/A test: doosri baar bhi Node, bilkul alag options object ke saath
      const secondOptions = { topK: record.topK };
      if (record.mode === 'focus') {
        secondOptions.metadataFilter = record.metadataFilter;
        secondOptions.requireTermMatchForLatinQuery = true;
      }
      pythonResponse = await retrieveRelevantChunks(record.query, secondOptions);
    } else {
      pythonResponse = await retrieveFromPython(record.query, pythonOptions);
    }
  } catch (error) {
    row.pythonError = error.message;
  }
  row.pythonMs = Math.round(performance.now() - pythonStart);

  if (nodeResponse && nodeResponse.usedFallback) {
    row.nodeError = 'Node ne fallback embedding use kiya, is sawaal ka mukabla galat hoga';
  }
  if (pythonResponse && !Array.isArray(pythonResponse.results)) {
    row.pythonError = 'Python ke jawab mein results list nahi hai';
  }
  if (row.nodeError || row.pythonError) {
    row.label = 'ERROR';
    return row;
  }

  const comparison = compareResults(nodeResponse.results, pythonResponse.results);
  row.label = comparison.label;
  row.maxGap = comparison.maxGap;
  row.onlyNode = comparison.onlyNode;
  row.onlyPython = comparison.onlyPython;
  row.node = shortList(nodeResponse.results);
  row.python = shortList(pythonResponse.results);

  // jis chunk se sawaal bana tha, wo kis number pe aaya (1 se shuru, na mila to null)
  if (row.sourceChunkId) {
    const nodeIndex = getIds(nodeResponse.results).indexOf(row.sourceChunkId);
    const pythonIndex = getIds(pythonResponse.results).indexOf(row.sourceChunkId);
    row.sourceRankNode = nodeIndex === -1 ? null : nodeIndex + 1;
    row.sourceRankPython = pythonIndex === -1 ? null : pythonIndex + 1;
  }

  return row;
};

// ---------- ginti aur report ----------
const percentile = (numbers, p) => {
  if (numbers.length === 0) return 0;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(index, 0)];
};

const buildSummary = (rows) => {
  const summary = { total: rows.length, labels: {}, byKind: {}, kindOrder: [] };
  const nodeTimes = [];
  const pythonTimes = [];
  let maxGapOverall = 0;
  let recallNode = 0;
  let recallPython = 0;
  let recallTotal = 0;
  let recallDifferent = 0;

  for (const row of rows) {
    summary.labels[row.label] = (summary.labels[row.label] || 0) + 1;

    if (!summary.byKind[row.kind]) {
      summary.byKind[row.kind] = { total: 0, pass: 0 };
      summary.kindOrder.push(row.kind);
    }
    summary.byKind[row.kind].total++;
    if (row.label === 'PASS') summary.byKind[row.kind].pass++;

    nodeTimes.push(row.nodeMs);
    pythonTimes.push(row.pythonMs);

    if (typeof row.maxGap === 'number' && row.maxGap !== Infinity && row.maxGap > maxGapOverall) {
      maxGapOverall = row.maxGap;
    }

    if (row.sourceChunkId && row.label !== 'ERROR') {
      recallTotal++;
      if (row.sourceRankNode !== null) recallNode++;
      if (row.sourceRankPython !== null) recallPython++;
      if (row.sourceRankNode !== row.sourceRankPython) recallDifferent++;
    }
  }

  summary.maxGapOverall = maxGapOverall;
  summary.timing = {
    nodeP50: percentile(nodeTimes, 50),
    nodeP95: percentile(nodeTimes, 95),
    pythonP50: percentile(pythonTimes, 50),
    pythonP95: percentile(pythonTimes, 95),
  };
  summary.recall = { total: recallTotal, node: recallNode, python: recallPython, differentRank: recallDifferent };
  return summary;
};

const formatList = (list) => {
  if (!list || list.length === 0) return '(khaali)';
  const parts = [];
  for (const item of list) {
    parts.push(`${item.id} (${Number(item.finalScore).toFixed(4)})`);
  }
  return parts.join(', ');
};

const filterText = (row) => {
  if (!row.metadataFilter) return 'global';
  return `focus ${row.metadataFilter.section} ch${row.metadataFilter.chapter_no}`;
};

const buildMarkdown = (summary, rows, args) => {
  const lines = [];
  const passCount = summary.labels.PASS || 0;

  if (args.self) {
    lines.push('# Node vs Node — A/A test (shor naapne ke liye)');
    lines.push('');
    lines.push('Dono taraf Node hai. "Python" wale column mein Node ki doosri baar ki call hai.');
    lines.push('Jo farak yahan aaye wo Python ki wajah se nahi, system ke apne shor se hai.');
  } else {
    lines.push('# Node vs Python — bulk compare');
  }
  lines.push('');
  lines.push(`- Report banayi : \`${new Date().toISOString()}\``);
  lines.push(`- Sawaal chale  : ${summary.total}${args.limit || args.kind ? ' (poora bank nahi, filter laga tha)' : ''}`);
  lines.push(`- Score ki limit: \`${SCORE_LIMIT}\` (isse kam farak = same)`);
  lines.push('- Cache band tha, dono taraf taaza jawab');
  lines.push('');
  lines.push('## Nateeja');
  lines.push('');
  lines.push(`**${passCount} / ${summary.total} PASS**`);
  lines.push('');
  lines.push('| Label | Kitne |');
  lines.push('|---|---|');
  const labelNames = Object.keys(summary.labels);
  for (const name of labelNames) {
    lines.push(`| ${name} | ${summary.labels[name]} |`);
  }
  lines.push('');
  lines.push(`Score ka sabse bada farak (jahan IDs same the): \`${summary.maxGapOverall.toFixed(7)}\``);
  lines.push('');
  lines.push('## Kind ke hisaab se');
  lines.push('');
  lines.push('| Kind | Pass | Total |');
  lines.push('|---|---|---|');
  for (const kind of summary.kindOrder) {
    const item = summary.byKind[kind];
    lines.push(`| ${kind} | ${item.pass} | ${item.total} |`);
  }
  lines.push('');
  lines.push('## Samay (ms)');
  lines.push('');
  lines.push('| | p50 | p95 |');
  lines.push('|---|---|---|');
  lines.push(`| Node | ${summary.timing.nodeP50} | ${summary.timing.nodeP95} |`);
  lines.push(`| Python | ${summary.timing.pythonP50} | ${summary.timing.pythonP95} |`);
  lines.push('');
  lines.push('## Jis chunk se sawaal bana, wo top-k mein aaya?');
  lines.push('');
  lines.push(`- Sawaal jinke paas sahi chunk ka ID hai: ${summary.recall.total}`);
  lines.push(`- Node ke top-k mein mila   : ${summary.recall.node}`);
  lines.push(`- Python ke top-k mein mila : ${summary.recall.python}`);
  lines.push(`- Dono mein alag number pe aaya: ${summary.recall.differentRank}`);
  lines.push('');

  lines.push('## Jahan farak ya error aaya');
  lines.push('');
  let problemCount = 0;
  for (const row of rows) {
    if (row.label === 'PASS') continue;
    problemCount++;
    lines.push(`### ${row.id} — ${row.label}`);
    lines.push('');
    lines.push(`- Sawaal : ${row.query}`);
    lines.push(`- Kind   : ${row.kind} | ${filterText(row)} | topK ${row.topK}`);
    if (row.why) lines.push(`- Kyun rakha tha: ${row.why}`);
    if (row.nodeError) lines.push(`- Node error  : ${row.nodeError}`);
    if (row.pythonError) lines.push(`- Python error: ${row.pythonError}`);
    if (!row.nodeError && !row.pythonError) {
      lines.push(`- Node   : ${formatList(row.node)}`);
      lines.push(`- Python : ${formatList(row.python)}`);
      if (row.onlyNode.length > 0) lines.push(`- Sirf Node mein  : ${row.onlyNode.join(', ')}`);
      if (row.onlyPython.length > 0) lines.push(`- Sirf Python mein: ${row.onlyPython.join(', ')}`);
      if (row.label === 'SCORE_DIFF') lines.push(`- Score ka farak: ${row.maxGap}`);
    }
    lines.push('- Wajah (haath se likhni hai): ');
    lines.push('');
  }
  if (problemCount === 0) {
    lines.push('Koi farak nahi. Saare sawaal PASS.');
    lines.push('');
  }

  lines.push('## Saare sawaal');
  lines.push('');
  lines.push('| # | Kind | Mode | Node | Python | maxGap | Result |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    const nodeCount = row.node ? row.node.length : '-';
    const pythonCount = row.python ? row.python.length : '-';
    const gap = typeof row.maxGap === 'number' ? row.maxGap.toFixed(7) : '-';
    lines.push(`| ${row.id} | ${row.kind} | ${filterText(row)} | ${nodeCount} | ${pythonCount} | ${gap} | ${row.label} |`);
  }
  lines.push('');
  return lines.join('\n');
};

// ---------- shuruaat ki jaanch ----------
const checkSetup = async () => {
  if (!process.env.PYTHON_RETRIEVER_URL || !process.env.INTERNAL_API_KEY) {
    console.error('PYTHON_RETRIEVER_URL ya INTERNAL_API_KEY .env mein nahi hai.');
    process.exit(1);
  }
  try {
    const response = await fetch(`${process.env.PYTHON_RETRIEVER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
  } catch (error) {
    console.error(`Python service nahi mili (${process.env.PYTHON_RETRIEVER_URL}/health): ${error.message}`);
    console.error('Pehle Python service chalao: fastapi dev app/main.py');
    process.exit(1);
  }
};

const main = async () => {
  const args = readArgs();
  await checkSetup();
  turnOffCaches();

  const bank = JSON.parse(await readFile(BANK_FILE, 'utf8'));
  let records = [];
  for (const record of bank.queries) {
    if (args.kind && !record.kind.startsWith(args.kind)) continue;
    records.push(record);
  }
  if (args.limit > 0) {
    records = records.slice(0, args.limit);
  }
  console.log(`Bank: ${bank.queries.length} sawaal, ab chalenge: ${records.length}`);

  await connectDB();
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const row = await runOne(records[i], args);
    rows.push(row);
    console.log(`[${i + 1}/${records.length}] ${row.id} ${row.label}  node ${row.nodeMs}ms  python ${row.pythonMs}ms`);
  }
  await disconnectDB();

  const summary = buildSummary(rows);
  const markdown = buildMarkdown(summary, rows, args);

  let partial = args.limit > 0 || args.kind ? '-partial' : '';
  if (args.self) partial = '-aa-node-vs-node' + partial;
  await mkdir(args.out, { recursive: true });
  await writeFile(path.join(args.out, `shadow-bulk-report${partial}.md`), markdown);
  await writeFile(
    path.join(args.out, `shadow-bulk-report${partial}.json`),
    JSON.stringify({ summary, rows }, null, 2),
  );

  const passCount = summary.labels.PASS || 0;
  console.log(`\n${passCount} / ${summary.total} PASS`);
  console.log(summary.labels);
  console.log(`Report: ${path.join(args.out, `shadow-bulk-report${partial}.md`)}`);

  process.exit(passCount === summary.total ? 0 : 1);
};

main().catch((error) => {
  console.error('Script gir gayi:', error);
  process.exit(1);
});
